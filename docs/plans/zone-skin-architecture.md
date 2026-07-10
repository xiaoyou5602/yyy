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

### 二次实现方案（2026-07-10 Fable 接手，针对三根因逐条设计）

**修根因 1 —— token 落点全部下沉到 zone 容器**：
- 删掉共享 `chat` scope（`#chat-page` 不再是任何 token 落点）。顺带删死 token `--chat-bg`（其真实消费者 `#conversation-list-page` 与 `#chat-page` 平级，挂上去从未生效过，CSS fallback 保底零变化）。
- 新增 5 个 per-zone scope：`zone-ds`/`zone-opus`/`zone-haiku`/`zone-glm`/`zone-openclaw`，selector 直绑 `#chat-zone-{key}`。命名用 `zone-` 前缀避开已被暖瓷独立页占用的 `chat-ds` scope 名。
- 「全局」瘦身：气泡/消息间距/气泡宽/消息字号/输入输发送 token 全部搬进 zone scope；全局只留 --bg/--text/--accent/--radius/--font 级别的全站设计系统 token。
- 同名 token 不再有两层落点 ⇒ 双层覆盖混乱消失。

**修根因 2 —— tweak 按 (scope, theme) 分桶，主题切换清 inline 重应用**：
- localStorage 结构升级：`{scope: {key: val}}` → `{scope: {themeBucket: {key: val}}}`，themeBucket = zone 当前主题 id 或 `base`（非 zone scope 恒为 base）。initState 做一次性旧格式迁移。
- inline style 机制保留（简单、不用管 specificity），但语义变为「当前主题下的微调补丁」：`applyZoneTheme` 切主题时先 `removeProperty` 清掉该 zone 全部 tweak inline 变量，再应用新主题桶存的值（若有）。主题规则永远可见，微调按主题记忆。
- tweak.js 暴露 `window._tweakReapplyZone(zoneKey)` 钩子供 themes.js 调用，同时重算该 scope 的 defaults（主题变了 computed 默认值也变，「重置」才能回到当前主题原貌）。

**修根因 3 —— DS 暖瓷页变量桥接进主题系统**：
- themes.css 主题块选择器三写：`.chat-zone[data-theme="X"], #chat-page[data-theme="X"], #chat-ds-page[data-theme="X"]`（变量继承无副作用，合并安全，前提是下条不变量）。
- `#chat-page` 的 data-theme 由 `activateZone()` 与活跃 zone 主题保持同步（header 是五 zone 共享的，跟活跃 zone 走）；`#chat-ds-page` 的 data-theme 由 `applyZoneTheme('ds')` 同步（DS zone 与暖瓷页共用 `withtoge-theme-ds` 存储）。
- 桥接规则一条：`#chat-ds-page[data-theme] { --ds-bg: var(--zone-bg,…); --ds-blue: var(--accent,…); --ds-orange: var(--accent-warm,…); … }`——specificity (1,1,0) 压过 chat-ds.css 的 (1,0,0)，无主题时不带 data-theme 属性、桥接不生效，DS 页零变化。主题包新增 `--accent-warm`（映射 --ds-orange）。
- 不碰 chat-ds.js 任何 JS（引擎稳定告诫仍有效），纯 CSS 桥接。

**其它设计点**：
- `.chat-zone` 补 `background-color: var(--zone-bg, transparent)`——无主题时透明透出 `#chat-page` 背景（零变化），有主题时 zone 自己铺底色；壁纸 inline backgroundImage 叠在其上不冲突。
- 自定义主题走动态 `<style id="custom-themes-style">` 注入（`.chat-zone[data-theme="custom-N"]{…}`），与内置主题完全同机制；调参台 zone scope 下新增「存为主题卡片」按钮补全「+ 添加」死胡同。
- midnight 等深色主题的 `.msg .time` 硬编码色用主题级规则补（不加 token）。

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

### 阶段 1 · 轻档（几乎不动老页面）— ✅ 二次实现完成（07-10，toge 实机验收通过）
- [x] 补漏 main.css 未变量化的外观硬编码值 → 16 个新变量 + 死变量清理（`--h1-font-size`/`--input-min-h`/`--pet-size`/`--chat-bg` 从注册表删除；`--msg-gap`/`--header-pt/pb`/`--send-btn-size`/`--footer-pb`/`--msg-padding-x` 接活消费端，:root 值对齐原硬编码保证零视觉变化）
- [x] 调参台「全局」瘦身 + 按 zone 拆 → 共享 `chat` scope 删除，5 个 `zone-*` scope 直绑 `#chat-zone-*`（工厂生成）；tweak 持久化按 (scope×主题) 分桶 + 旧格式迁移；「存为主题卡片」按钮（zone scope 限定）
- [x] 新增 themes.css + 非默认主题 → 4 主题（樱/午夜/海洋/森林；暖瓷=无 data-theme 默认态），选择器三落点（zone/#chat-page/#chat-ds-page）+ DS 桥接规则；themes.js 注册表+存取+自定义主题 `<style>` 注入
- [x] 设置页「主题专区」→ 独立全屏页 #theme-zone-page，横滑卡片轮播（CSS Scroll Snap），IntersectionObserver 聚焦，草稿态/应用态分离，壁纸遮罩浓度滑条，per-zone 持久化；zone 进入时锁定（暖瓷页进来锁 ds），返回键回来源页
- [x] 验证互不影响 → 本地端到端全过：①opus 挂樱、ds 零污染 ②header 跟活跃 zone 切换/回落 ③inline 微调残留被主题切换清除（根因 2）④DS 暖瓷页 --ds-* 桥接跟主题、脱主题回原值（根因 3）⑤存卡闭环（19 变量快照、无缝接管、列表刷新）
- 顺手修：revert 遗留 bug——chat-ds.js `searchBtn` 声明被 86efbd7 带走但引用还在，dsChatInit 必抛 ReferenceError（thinking 折叠点击绑定失效），已补回声明（chat-ds.js v41）
- 版本：main.css v34、themes.css v1、themes.js v1、SW ke-v26

### 阶段 2 · 重档第一刀（最小手术，界面零变化）— ✅ 完成（07-10 commit 04e9b3f）
- [x] renderMsg 改查表转发；现有样式原样注册为 "default" 皮肤 → js/skins.js：registerSkin 注册表 + 五接口（renderMessage/renderSticker/buildThinking/createStreamContainer/ensureBubble）；chunks 拆分留引擎（皮肤永远只收单条）；data-msg-id/history/滚动留引擎；DOM 契约锚点（.msg/.msg-bubble/.msg-inner/.thinking-*/.time）固化进 skins.js 注释
- [x] 验证 5 个 zone 行为与改造前完全一致 → 静态渲染 6 项（ke/you/图片/thinking/chunks/贴纸）+ 流式链路 7 项（placeholder/增量/工具态/补气泡/幂等/finalize）全过

### 阶段 3 · 模板化 + 沙盒 — ✅ 完成（07-10 commit ef2e1da）
- [x] zone HTML 改 JS 循环生成，删 ZONE_KEYS 硬编码 → zoneTemplate（两种 footer 结构逐字节复刻）+ createZone（DOM+状态+绑定，幂等）+ 七处 ZONE_KEYS 绑定循环收拢进 bindZoneEvents；loadModels 后 syncZonesWithModels 补建新模型 zone——后端 model-routes.js 加一行 → 前端 zone 自动出现
- [x] skin-dev.html 沙盒页 → 假数据全家桶（长文/图片/thinking/拆分/贴纸）+ 流式模拟（增量→工具态→补气泡时序）+ 主题/皮肤下拉热切换 + `?skin=xxx` 加载 /skins/xxx.js+css 热预览
- 顺手修：normalizeWallpaper 只保 ds/opus/haiku 三 key，glm/openclaw 壁纸刷新即丢 → 改为保留全部 key

### 阶段 4 · 第一个真皮肤 — ✅ 完成（07-10 commit 2a78cd5，待 toge 实机验收）
- [x] 回收暖瓷 UI 成 "ceramic" 皮肤 → skins/ceramic.js（renderMessage/renderSticker 覆盖：时间戳外置暖瓷特征；thinking/流式容器/补气泡继承 default——两边样式 06/29 就统一了）+ skins/ceramic.css（.skin-ceramic 前缀作用域：气泡吃主题通用变量、细滚条、thinking 限高、壁纸毛玻璃兜底落内层气泡）
- [x] DS 接回主引擎 → DS zone 默认 skin=ceramic，走主 WS/history/滚动未读（chat-ds.js 私有引擎不再启动）；顺带获得主页全套能力（桌宠/拖拽发图/多选收藏/搜索/刷新/审批弹窗/主题跟随）
- [x] 应急阀 → 暖瓷独立页整页保留，设置页「DS 引擎切换」开关（localStorage withtoge-ds-legacy）一键回旧页；legacy/main 双向切换 + last-page=chat-ds 启动恢复均已验证
- ⚠️ 行为变化点（验收时注意）：多段回复在新引擎下按 chunk 拆多个气泡（暖瓷页是整段一个气泡）；thinking 刷新恢复走服务端 sync + 指纹缓存（暖瓷页是本地 history 直存）

## 风险与注意

- **阶段 2 是唯一必须动 index.html 内联脚本的一刀**——切最小，改完跑括号平衡检查（Edit 工具吞 `}` 的老坑）
- 前端改完 bump 版本号（CSS `?v=N`、SW `?v=N`），Service Worker 缓存老坑
- chat-ds 页当前已稳定（dd56551 修复后），阶段 4 之前**不要动它**；阶段 4 做的时候注意 DS 页承载 toge 主聊天，需要她配合验收
- `state.target` ≠ `state.replyTarget` 历史包袱，引擎改造时注意对齐
