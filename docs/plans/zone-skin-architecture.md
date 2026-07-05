# 聊天页独立 UI / 皮肤架构方案（2026-07-05 立项）

> 目标：每个模型聊天页（zone）有自己独立的 UI，且支持切换 UI 风格；同时保住（并做实）"加模型只改一行"。
> 起因：toge 想给各聊天页做独立 UI，发现改一个全动；chat-ds 页"先独立做再接入"的尝试在接入期踩了一堆连接/时序坑（详见 WITHTOGE.md 07-04 dd56551 条目）。

## 病根诊断：为什么改一个动全部

现状是**三层共享**，没有一层留了"按 zone 区分"的口子：

| 层 | 现状 | 位置 |
|---|---|---|
| CSS 类 | 5 个 zone 全用 `.chat-messages` / `.chat-input` / `.send-btn` 等同名类，样式集中在 main.css（3651 行） | `css/main.css` |
| DOM 模板 | zone HTML 是同一段结构复制粘贴 5 遍，只有 id 后缀不同（`-ds`/`-opus`/…） | `index.html:154-215` |
| 渲染 JS | 消息 → 气泡全走 index.html 内联的同一个 `renderMsg` | `index.html` 内联脚本 |

另外 `ZONE_KEYS = ["ds","opus","haiku","glm","openclaw"]`（index.html:1019）硬编码——所以现在"加模型一行"只对后端 model-routes.js 和侧边栏成立，前端实际要手工复制第 6 段 zone HTML + 改 ZONE_KEYS。

调参台的 page-tokens 已有页面级 CSS 变量 scope，但只覆盖变量能表达的东西（颜色/圆角/间距），表达不了结构级风格差异。

## chat-ds 的教训：隔离方向对，切错了地方

chat-ds 隔离的不只是**皮肤**，还复制了一份**引擎**：自己的 WebSocket、自己的 history 读写、自己的重连、自己的初始化时序。本质是页面里嵌了第二个完整 App。接入期的所有坑（WS 未建立、跳转路由打架、脚本加载竞态 dd56551）全是"双 App 结构"的必然产物——这些都是**时序和全局状态**问题，在独立页面里测不出来，只有塞进 index.html 和别人抢跑时才炸。

## 架构原则（一句话）

**连接和数据永远只有一份，外观每个 zone 一份。**

- **引擎层（全局唯一，谁都不许复制）**：一个 WebSocket、按 model 分桶的消息分发（已有）、一套 history 存取、滚动/未读逻辑。任何新聊天页不许再开自己的 WS。
- **皮肤层（按 zone 隔离）**，分两档：

### 轻档：主题 = CSS 变量包

原理：CSS 变量有作用域，定义在 zone 容器上就只在该 zone 生效。

1. 梳理 main.css，外观值全部走 `var()`（调参台能调的已变量化，剩下补漏）
2. 新增 `themes.css`，一个主题 = 一段变量覆盖：
   ```css
   .chat-zone[data-theme="sakura"] {
     --bubble-ke: #ffe3ec; --bubble-ke-text: #5c3a45;
     --radius: 20px; --chat-font: "LXGW WenKai", serif;
   }
   ```
3. 切换 = `zoneEl.dataset.theme = "sakura"`，选择存 localStorage（并在现有 per-zone 壁纸存储旁边），设置页每 zone 加主题下拉

**能覆盖**：配色/字体/圆角/间距/阴影/壁纸——"同一骨架换气质"。
**覆盖不了**：DOM 结构不同的风格（头像排布、装饰元素、输入栏布局）。
**对老代码的侵入**：几乎为零——themes.css 纯新增，index.html 只加 `<link>` + 设置页下拉。

### 重档：皮肤 = 渲染器

一个皮肤 = 三件东西：

1. 一份 CSS，类名带前缀防渗透（如 `ceramic-`，`ds-` 前缀已是先例）
2. 一个渲染器对象，实现固定接口：
   ```js
   registerSkin("ceramic", {
     renderMessage(msg)        { /* 数据 → DOM 节点 */ },
     renderThinking(text, sec) { /* 思考块 */ },
     appendStreamChunk(el, t)  { /* 流式追字 */ },
   });
   ```
3.（可选）zone 容器模板——输入栏布局都不同时才需要

引擎侧只改一处：`renderMsg` 变成查表转发 `skins[zones[key].skin].renderMessage(msg)`。

**铁律**：皮肤只准拿数据画 DOM，**绝不碰 ws、绝不碰 localStorage、绝不自己发请求**。守住这条，连接层 bug 永远只修一次。皮肤接入面 = 注册表多一个 key，接口全是纯函数，没有时序维度，chat-ds 那类接入坑没有对应物。

### zone 模板化（顺路做实"加模型一行"）

重档本来就要让骨架变成 JS 生成，顺路把 5 份复制粘贴的 zone HTML 改成 `loadModels()` 后循环生成：

```js
for (const m of models) createZone(m.key, m.skin || "default");
```

`ZONE_KEYS` 硬编码消失（从模型列表来）。此后才是真一行：后端 model-routes.js 加一行 → 前端 zone 自动出现（默认皮肤，设置里可换）。

### skin-dev.html 沙盒（保住"先独立做再接入"的工作流）

一个独立沙盒页：假消息数据（长文本/图片/thinking 块/流式模拟）+ 加载正在开发的皮肤文件直接预览。皮肤在沙盒调到满意，接入 = 拷 `skins/xxx.css` + `skins/xxx.js` 两个文件 + 注册一行。接口一致 ⇒ 沙盒能跑接入后就能跑。以后所有皮肤在 index.html **外面**写。

## 实施阶段（每步行为不变是安全网）

### 阶段 1 · 轻档（几乎不动老页面）
- [ ] 补漏 main.css 未变量化的外观硬编码值
- [ ] 新增 themes.css + 第一个非默认主题
- [ ] zone 设置加主题下拉，选择持久化 localStorage
- [ ] 拿 Opus zone 挂不同 data-theme 验证互不影响

### 阶段 2 · 重档第一刀（最小手术，界面零变化）
- [ ] renderMsg 改查表转发；现有样式原样注册为 "default" 皮肤
- [ ] 验证 5 个 zone 行为与改造前完全一致（历史渲染/流式/thinking/图片/未读角标）

### 阶段 3 · 模板化 + 沙盒
- [ ] zone HTML 改 JS 循环生成，删 ZONE_KEYS 硬编码
- [ ] skin-dev.html 沙盒页（假数据 + 皮肤热加载）

### 阶段 4 · 第一个真皮肤
- [ ] 回收暖瓷 UI：CSS/renderMsg 留下改造成 "ceramic" 皮肤，删掉 chat-ds.js 私有的 WS/history/重连，接回主引擎

## 风险与注意

- **阶段 2 是唯一必须动 index.html 内联脚本的一刀**——切最小，改完跑括号平衡检查（Edit 工具吞 `}` 的老坑）
- 前端改完 bump 版本号（CSS `?v=N`、SW `?v=N`），Service Worker 缓存老坑
- chat-ds 页当前已稳定（dd56551 修复后），阶段 4 之前**不要动它**；阶段 4 做的时候注意 DS 页承载 toge 主聊天，需要她配合验收
- `state.target` ≠ `state.replyTarget` 历史包袱，引擎改造时注意对齐
