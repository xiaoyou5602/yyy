# 聊天页独立 UI / 皮肤架构方案（2026-07-05 立项）

> 目标：每个模型聊天页（zone）有自己独立的 UI，且支持切换 UI 风格；同时保住（并做实）"加模型只改一行"。
> 起因：toge 想给各聊天页做独立 UI，发现改一个全动；chat-ds 页"先独立做再接入"的尝试在接入期踩了一堆连接/时序坑（详见 WITHTOGE.md 07-04 dd56551 条目）。
>
> ---
>
> ⚠️ **2026-07-10 阶段 1 代码已回退至阶段 0（commit 9268e44）**。回退原因：阶段 1 实现存在三个架构级问题，下面 checklist 里的 `[x]` 虽完成但需推翻重做。**下面的 checklist 保留实现细节作为参考，Fable 接手时以此为线索对照三个根因，避免重蹈覆辙。**
>
> **三架构问题（详见代码分析）**：
> 1. **调参台 scope selector 选错父容器**：`chat` scope 绑在 `#chat-page`（五个 zone 的父容器），导致调任何 token 都漏到全部 zone。per-zone scope 虽已新增但和共享 scope 同名 token 形成混乱双层覆盖。
> 2. **tweak persist 的 inline style 碾压主题 CSS**：调参台存的值写成 `el.style.setProperty()`（inline style），优先级高于 themes.css 的 `.chat-zone[data-theme]` CSS 规则——只要 tweak 调过任何值，主题切换就失效。
> 3. **DS 页变量体系独立于主题系统**：DS 页用 `--ds-bg`/`--ds-bg-light` 等专属变量，themes.css 设的是 `--bg`/`--bg-light`——DS 页切主题纹丝不动，只有输入栏（共用 `--input-bg` 等通用变量）能变。且 `#chat-ds-page` 无 `chat-zone` class，`.chat-zone[data-theme]` 选择器根本匹配不到。

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
3. 切换 = `zoneEl.dataset.theme = "sakura"`，选择存 localStorage（并在现有 per-zone 壁纸存储旁边）

### 主题专区 UI（toge 07-05 定的参考，替代原"设置页下拉"方案）

设置页做一个「主题/背景专区」，参考 toge 提供的截图（横滑卡片式）：

- **横滑卡片列表**：每张卡片 = 一个主题/背景的实时缩略预览，当前选中的居中放大；列表末尾一张「+ 添加」卡片
- **不透明度滑条**：映射壁纸遮罩层 `body.has-wallpaper::before` 的 alpha（现硬编码 `rgba(255,255,255,0.75)`，做成变量即可调）——壁纸太抢眼就调高，想看清图就调低
- **从图库选择 / 重置** 按钮：接现有壁纸上传逻辑
- **可存档**：调参台调出的自定义主题「存为卡片」进这个列表，命名保存（localStorage 主题列表）；卡片长按/编辑可删除、重命名
- 专区按 zone 生效（每个聊天页独立选），与 per-zone 壁纸同一存储粒度

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

## 调参台：从"装饰面板"变成主题编辑器（07-05 toge 报三症状后并入）

### 病根查证（07-05，全部有代码实锤）

toge 报的三个症状，根子都是**调参台 token 注册表和真实 CSS 脱节**：

1. **「没有一个颜色对应 DS 真正的聊天背景」**——调参台「聊天」scope 绑的是 `#chat-page`（page-tokens.js:52），而 toge 常驻的 DS 页是 `#chat-ds-page`，背景走自己的 `--ds-bg`/`--ds-bg-light`（chat-ds.css:3-4），整页不在调参台注册表里。toge 猜对了：DS 页是调参台建成后才接入的，没人给它注册 scope。
2. **「全局跟聊天不知道怎么分的」**——两重混乱：①「全局」scope（:root）塞满聊天专属 token（气泡色/消息间距/气泡宽/发送按钮）；「聊天」scope 只有 3 个背景 token。②更严重：`--bubble-you/--bubble-ke`（main.css:15-18）和整套 `--model-bubble-*`（main.css:70-121）**定义了但全项目零消费，是死变量**——气泡真实底色硬编码在 `.msg.you`（main.css:285）和 `.msg.ke .msg-bubble`（main.css:299）里。调参台里调「你的气泡」「克的气泡」本来就不生效，所以怎么分都感觉不对。
3. **「换背景气泡底色消失」**——`.msg.you` 底色硬编码 `rgba(89,137,185,0.04)`，**4% 透明度**，全靠浅色页面背景衬着才看得见；壁纸一换，气泡等于隐形，字直接浮在图上。

### 定位：调参台 = 轻档主题的可视化编辑器

轻档主题是"zone 容器上的一段变量覆盖"，调参台实时改的恰好就是容器上的变量——**两者是同一机制**。所以调参台不另起炉灶，直接升级成主题系统的编辑器：

- **「全局」瘦身**：只留真正全站共享的设计系统 token（字体、圆角体系、基础色板、正文色）。聊天专属 token 全部搬出。
- **「聊天」按 zone 拆**：聊天 tab 内加 zone 切换器（DS/Opus/GLM/…），token 写到对应 zone 容器上——和 `data-theme` 变量包同一作用域。气泡色、聊天背景、消息间距、气泡宽都在这层。
- **调出来的值就是主题**：一组 per-zone 调参结果 = 一个自定义主题包，可存名字、可导出成 themes.css 条目。
- **皮肤自带 token 声明**（阶段 4 起）：`registerSkin` 时附 tokens 数组（奶茶组件 tokens.json 已有先例），调参台按当前 zone 所用皮肤动态换面板——注册表永远和真实皮肤对得上。

### 双向对齐验收标准（阶段 1 补漏的验收清单）

阶段 1"补漏未变量化的硬编码值"以调参台注册表为清单，双向验收：

- 注册表里每个 token **必须有真实 CSS 消费者**（消灭死变量：要么 `.msg` 规则改用 `var(--bubble-*)`，要么删 token）
- 每个 zone 用户可见的外观值 **必须有对应 token**（DS 页的 `--ds-*` 全套注册进来）

## 实施阶段（每步行为不变是安全网）

### 阶段 0 · 快修（不等架构改造，单独可做）
- [x] 气泡透明度兜底：`.msg.you` 的 4% 透明底色改等价实色 `#eaece9`（main.css:15，视觉零变化）——修"换壁纸气泡消失"
- [x] chat-ds 页注册调参台 scope：新增 `chat-ds` scope（page-tokens.js），`--ds-bg`/`--ds-bg-light`/`--ds-blue`/`--ds-orange`/`--ds-slate`/`--ds-border` 六个 token 挂上 page-tokens，tweak.js suggestScope 加映射（打开调参台时 DS 页自动定位到该 tab）——toge 立刻能调 DS 页背景
- [x] 气泡死变量接活：`.msg.you`/`.msg.ke .msg-bubble` 改用 `var(--bubble-you)`/`var(--bubble-ke)`（main.css:285,299，这就是阶段 1 补漏的第一刀，提前做）

> 07-05 完成，静态检查通过（`node --check` + `scripts/check-direct-client-html.js` 无报错），main.css 版本号 v31→v32。**待 toge 实机验收**：① 调参台「DS聊天」新 tab 能调出 DS 页背景/强调色/边框色 ② 换壁纸后气泡不再隐形 ③ 调参台「气泡」两个 token 现在真的能改变聊天气泡颜色。

### 阶段 1 · 轻档（几乎不动老页面）
- [ ] 补漏 main.css 未变量化的外观硬编码值 → 20+ 硬编码值转 CSS 变量，新增 wallper-alpha/send-btn 等
- [ ] 调参台「全局」瘦身 + 聊天 tab 按 zone 拆（zone 切换器）→ page-tokens 新增 5 per-zone scope，tweak.js suggestScope 自动检测活跃 zone
- [ ] 新增 themes.css + 第一个非默认主题 → 5 主题（暖瓷/樱/午夜/海洋/森林），data-theme 机制
- [ ] 设置页「主题专区」→ 独立全屏页 #theme-zone-page，横滑卡片轮播（CSS Scroll Snap），IntersectionObserver 聚焦，草稿态/应用态分离，壁纸不透明度滑条，per-zone 持久化 localStorage
- [ ] 拿 Opus zone 挂不同 data-theme 验证互不影响（⚠️ 07-10 已验证：旧实现 theme 切换会牵连其他 zone，见顶部三架构问题）

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
