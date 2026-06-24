# withtoge — 个人 AI 陪伴系统

> **这个文件**：项目架构、功能清单、运维命令、待办、API 细节。
> **toge 生活 / 人设 / 课表 / 教训** → [CLAUDE.md](../../CLAUDE.md) > **迭代详情** → [docs/iteration-log.md](docs/iteration-log.md) > **闹钟文档** → [docs/alarm-system.md](docs/alarm-system.md)

目录：`C:\Users\youzi\withtoge\`

## Git 规范

> ⚠️ 项目已 git init。**每次写代码必须 commit。** 所有模型/端口都要遵守。

- **改代码前先看状态**：`git status` 确认工作区干净，`git log --oneline -5` 了解最近的改动
- **一个功能一个 commit**：改完一个完整功能就 commit（`git add <具体文件>`），commit message 用中文简短写清楚
- **commit message 格式**：`<动词><名词>：<说明>`，例如 `加转盘游戏 Canvas 实现`、`修骰子动画卡顿`
- **验收通过立刻 commit**：不要拖到下个 session
- **不提交敏感文件**：`.env`、`node_modules/` 已在 .gitignore，add 前确认
- **迭代日志 ≠ Git commit**：commit 边走边打（记账），迭代日志收工时统一写（财报）。迭代写 WHY 和故事线，commit 记 WHAT 和代码变更

## 启动与运维

```
# 安全启动（带守护，崩了自动拉起）
npm run safe

# 普通启动
npm start

# 重启：先杀再起（必须用守护模式，崩了自动拉起）
powershell -ExecutionPolicy Bypass -File scripts/kill-bridge.ps1
npm run safe
```

启动后在桌宠面板看 `youzi` session —— 它在，app+网页就在。
已知坑：Windows spawn 用 cmd.exe 引号会炸；Unix socket EACCES 不影响运行；休眠导致 bridge 掉线。

### 常见问题排查

- **APP 不回消息** → `netstat -ano | grep 9726` 看端口在不在 + `tasklist | grep cloudflared` 看隧道在不在。guardian 会 10 秒内自动拉，等几秒再试即可
- **端口炸了** → `npm run safe` 重启（guardian + cyberboss + cloudflared 全套）
- **僵尸进程多** → 跑 `powershell -ExecutionPolicy Bypass -File scripts/kill-zombies.ps1`，只杀 MCP 残留，不杀主进程和 guardian

域名：**克.withtoge.us**（永久，Cloudflare Named Tunnel，自带 HTTPS 证书）
隧道 ID：`1946653e-25b0-4622-9edf-1dc40e3c356c`，名称 `ke-tunnel`
隧道由 **guardian 自动管理**（先杀旧再启新，每 10s 检查存活），无需手动启停。原始命令 `cloudflared.exe tunnel run ke-tunnel`（`~/.cloudflared/config.yml`）
**重要**：不要用 `--url` 参数！会和 ingress 规则冲突导致 WebSocket 服务端 → 客户端帧丢失
端口：**9726**（`0.0.0.0` 监听）
**VPS**：东京 LocVPS `103.85.25.226`，Ubuntu 22.04，2核4G，¥36/月，systemd 守护
Android APK：`C:\Users\youzi\Desktop\克-apk\克-v12.apk`，versionCode 12，纯全屏 WebView，硬编码 `https://克.withtoge.us`

### 技术避坑

- **重启必须 `npm run safe`，不是 `npm start`**。`npm start` 是普通模式，崩了不会自动拉起。`npm run safe` 走 `start-guardian.ps1`，崩了自动重启，带退避（5s→15s→30s→60s）+熔断（10次/小时）+僵尸清理+cloudflared守护
- **不要手动拉 cloudflared**。`src/index.js` 已删除内部 spawn，cloudflared 只由 guardian 启动。手动拉 = 脱离 PID 追踪 + 进程堆积。之前 24 个僵尸就是这么来的
- **前端改完 bump 版本号**（CSS `?v=N`、SW.js `?v=N`）。Service Worker 会缓存旧 HTML/CSS/JS，不改版本号即使服务端更新了前端也拿不到。无痕窗口或 DevTools → Application → Unregister SW + 硬刷新才能绕过
- **`ws.onmessage` 外层有 `catch {}`**（`index.html` line ~2078），前端 JS 报错会被静默吞掉，控制台不红。排查时手动在 Console 跑函数看结果
- **绝对不要 `taskkill //F //IM node.exe`** — 会杀 IDE 端进程。用 `scripts/kill-bridge.ps1` 精准杀

## 系统架构

```
手机 APK ──→ Cloudflare Tunnel ──→ cyberboss 服务 ──┬── type=cli → Claude CLI 子进程 → DeepSeek API (DS)
电脑网页 ──→ 127.0.0.1:9726 ──┘                    │
                                                    ├── type=api → 直调 HTTP → 55api / 其他 API (Opus/Haiku/...)
                                                    │
                                                    ├── 日记 / 时间轴 / 记忆碎片
                                                    ├── 世界书 / 礼物 / 摄像头 / MCP
                                                    └── 闹钟 / 贴纸 / 定位 / 图片识别 / 奶茶记录
```

当前通道：**direct**（网页直连，微信已弃用）
模型路由：`src/core/model-routes.js` — 加模型 = 加一行（type: cli/api）
API 直调：`src/core/direct-api-client.js` — SSE 流式客户端，绕过 CCSwitch/VPN

### 加新 API 只需一步

打开 `src/core/model-routes.js`，在 `MODELS` 表里加一行：

```js
haiku: {
  type: "api",                          // "api"=直调聊天, "cli"=Claude CLI(agent)
  displayName: "Claude Haiku 4.5",
  baseUrl: process.env.CYBERBOSS_HAIKU_ENDPOINT || "https://...",
  apiKey: process.env.CYBERBOSS_HAIKU_KEY || "",
  apiModel: "claude-haiku-4-5",
  modelName: "claude-haiku-4-5",
},
```

前端自动出现（侧边栏 + 设置页），无需改 HTML。API key 放 `.env` 文件。

## 嵌入新页面（标准流程）

> 把 Gemini / 其他工具生成的独立 HTML 接入 App。案例：小手机主页。

### 文件拆法

每个页面拆独立文件，和其他页面一致：

```
js/xxx.js        ← 页面逻辑（IIFE，暴露 window.xxxInit / window.xxxDestroy）
css/xxx.css      ← 页面样式（量少可放 main.css 但加注释分隔）
```

HTML 放 `index.html` 的 `<body>` 内，和 `#chat-page` / `#memory-page` **平级**（不是嵌套）。

### CSS 7 条

1. **变量加前缀**：Gemini 的 `--bg` → `--ph-bg`，定义在 `#xxx-page {}` 上，不用 `:root`
2. **别用 `* { margin:0; padding:0 }`**——会炸 App 样式。最多留 `box-sizing: border-box`
3. **`position:fixed` 用 `top/right/bottom/left:0`**，不用 `inset`（Android WebView 兼容）
4. **SVG 属性不用 `var()`**——`stroke="var(--x)"` 无效，改 `style="stroke:var(--x)"`
5. **桌面端加 `max-width`**（Gemini 按 412px 设计），否则全屏拉伸
6. **Flex 子元素加 `min-height:0`**，否则 `overflow:auto` 部分 WebView 失效
7. **改完 run 括号平衡检查**——`node -e "..."` 一秒钟，Edit 工具常吞 `}`

### JS 接入

```js
// IIFE 暴露 API
;(function () {
  window.xxxInit = function () {
    /* 渲染 */
  }
  window.xxxDestroy = function () {
    /* 清理 */
  }
})()
```

`showPage()` 里加 case。需要动画：CSS `@keyframes` + `setTimeout` 清理 class，**保存 timeout ID + clearTimeout 防竞态**。

入口：侧边栏或更多面板 → `showPage('xxx')`。
调参台：`page-tokens.js` 加 scope + `tweak.js` `suggestScope()` 加映射。

### 调试

- **前端改动不重启**，刷新即可。手机缓存清不掉就 bump CSS/JS 版本号 `?v=N`
- **Console 逐行日志**：`phInit` 每一步加 `console.log('①')`，一秒定位崩溃

## 已完成功能一览

| 模块                  | 说明                                                                                               | 关键文件                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **网页聊天**          | WebSocket 实时通信，支持图片/文件、收藏夹                                                          | `src/adapters/channel/direct/`                                                                |
| **日历页**            | 月视图 + 日计划，本地 localStorage                                                                 | `src/adapters/channel/direct/client/js/calendar.js`                                           |
| **日记页**            | 读 cyberboss 共享日记                                                                              | `src/adapters/channel/direct/client/js/memory.js`                                             |
| **记忆碎片**          | 热度排序、类型筛选、搜索                                                                           | `src/adapters/channel/direct/client/js/memory.js`                                             |
| **冥想页**            | 4-7-8 呼吸引导 + 小猫动画                                                                          | `src/adapters/channel/direct/client/js/meditation.js`                                         |
| **涂鸦页**            | Canvas 粒子绘画                                                                                    | `src/adapters/channel/direct/client/js/graffiti.js`                                           |
| **桌宠**              | SVG 螃蟹，随机走动 + 眼球追踪                                                                      | `src/adapters/channel/direct/client/js/pet.js`                                                |
| **聊天搜索**          | 前端搜 localStorage + 服务端搜历史 JSONL                                                           | `src/adapters/channel/direct/client/js/search.js`, ws-server `/api/search`                    |
| **视觉调参台**        | CSS 变量实时调节，13 个页面独立 scope                                                              | `src/adapters/channel/direct/client/js/tweak.js`, `js/page-tokens.js`                         |
| **小手机主页**        | Gemini 生成页面集成：实时时钟、天气（杭州萧山 ↔ 余姚）、日历小组件、备忘录、拖拽应用网格、星尘粒子 | `src/adapters/channel/direct/client/index.html`（HTML+JS）、`css/main.css`（phone-home 区段） |
| **PWA**               | Service Worker 离线缓存                                                                            | `src/adapters/channel/direct/client/sw.js`, `manifest.json`                                   |
| **多模型**            | DS(CLI/agent) + Opus(直调 API/聊天) + 动态加载 + 历史隔离                                          | `src/core/model-routes.js`, `src/core/app.js`                                                 |
| **Session 管理**      | claudecode runtime（仅 DS），启动清旧 session                                                      | `src/adapters/runtime/claudecode/`                                                            |
| **主动问候**          | checkin poller，随机间隔发消息（仅 DS）                                                            | `src/app/system-checkin-poller.js`                                                            |
| **日记写入**          | MCP 工具 `cyberboss_diary_append`                                                                  | `src/services/diary-service.js`                                                               |
| **时间轴**            | MCP 工具读/写/截图                                                                                 | `src/integrations/timeline/`, `src/services/timeline-service.js`                              |
| **贴纸系统**          | APP/Web 端贴纸面板（标签编辑 + 上传/删除），API + WS 推送                                          | `src/adapters/channel/direct/ws-server.js`、`src/services/sticker-service.js`                 |
| **图片识别**          | vision-context，>500KB 自动压缩                                                                    | `src/services/vision-context.js`                                                              |
| **记忆系统**          | 碎片提取 + 热度衰减 + 倒排索引 + 梦境整合                                                          | `src/memory/`, `src/services/memory-service.js`                                               |
| **定位**              | whereabouts MCP 集成                                                                               | `.env` 里 `CYBERBOSS_ENABLE_LOCATION_SERVER=true`                                             |
| **闹钟系统**          | 自然语言解析 → HTTP → 手机原生闹钟                                                                 | 见下方"闹钟系统"，详细文档 `docs/alarm-system.md`                                             |
| **守护进程**          | 崩溃 3 秒自动拉起                                                                                  | `scripts/start-guardian.ps1`                                                                  |
| **世界书**            | 网页可视化编辑 AI 人设/用户画像/自定义规则，注入对话 prompt                                        | `src/services/worldbook-service.js`, `src/adapters/channel/direct/client/js/worldbook.js`     |
| **礼物系统**          | AI 判断送礼 + Kolors 生图 + 弹窗动画 + 礼物陈列馆                                                  | `src/services/gift-service.js`, `src/adapters/channel/direct/client/js/gifts.js`              |
| **摄像头视觉**        | 浏览器摄像头拍照 → 视觉模型分析 → 哨兵定时模式                                                     | `src/adapters/channel/direct/client/js/camera.js`                                             |
| **MCP 娱乐室**        | 管理外部 MCP Server 配置 + 行动日志                                                                | `src/adapters/channel/direct/client/js/mcp-playroom.js`                                       |
| **会话记忆库**        | 聊天记录 Markdown 存档导入，解析 15 个主题目录，thinking 折叠，搜索定位，懒加载渲染              | `src/services/chat-archive-parser.js`, `src/adapters/channel/direct/client/js/conversation-memory.js` |
| **信件区**            | iframe 同源 HTML 阅读 + app 内新建/编辑 + 分类标签 + 排序，统一 MemoryItem 架构                    | ws-server `/api/letters`, `client/index.html`（letter-detail/editor 页）                     |
| **Cloudflare Tunnel** | 内网穿透，手机外网访问电脑克                                                                       | cloudflared                                                                                   |
| **Android APK**       | WebView 壳，包名 com.cyberboss.ke，v12，桌面 `克-apk/`                                             | `ke-apk/`                                                                                     |
| **僵尸清理**          | kill-zombies.ps1，60→8 进程，保留主进程+cloudflared                                                | `scripts/kill-zombies.ps1`                                                                    |
| **奶茶记录**          | 卡通日历 + 详情卡片 + API + 克自动记录                                                             | `src/adapters/channel/direct/client/components/bubbletea/`                                    |
| **审批弹窗**          | WebSocket broadcast 推所有客户端，电脑+手机同时弹窗，点按钮审批                                    | `src/adapters/channel/direct/ws-server.js`, `index.html`                                      |
| **Thinking 流式**     | 思考过程实时显示：头像+"思考中(X 秒)"计时器+折叠展开+localStorage 缓存                             | `src/adapters/runtime/claudecode/events.js`, `index.html`                                     |

## 奶茶记录 🧋

- **数据文件**：`~\.cyberboss\bubbletea\records.json`
- **前端页面**：APP 侧边栏 → 奶茶记录（卡通日历 + 详情卡片）
- **API 端点**：
  - `GET /api/bubbletea?days=N` — 列表
  - `GET /api/bubbletea?date=YYYY-MM-DD` — 某天
  - `POST /api/bubbletea` — 新增
- **POST body**：`{ "date", "name"（必填）, "brand", "sugar", "ice", "toppings"[], "rating"(1-5), "notes", "recordedBy" }`
- **克自动记录**：toge 提到喝了奶茶 → 从对话提取品牌、品名、糖度、冰量、小料、评分，调 API 写入

## 闹钟系统（TogeAlarm）

> 详细文档 → [docs/alarm-system.md](docs/alarm-system.md)

架构：`中文时间 → alarm-parser.js → HTTP → 手机 TogeAlarm APK → AlarmManager`

**关键文件**：`src/services/alarm-parser.js`、`src/services/alarm-client.js`、`src/tools/alarm-tool.js`、`alarm-apk/`（Android 源码）

**运行**：`node "C:/Users/youzi/withtoge/src/tools/alarm-tool.js" "明天8点叫我起床"`

**华为兼容**：WiFi → "休眠时保持 WLAN 连接" → 始终；应用 → TogeAlarm → 电池 → 无限制

## 日记与记忆路径

- 日记：`~\.cyberboss\diary\` — 各模型共享
- 时间轴：`~\.cyberboss\timeline\` — 对话增量维护
- 记忆碎片：`~\.cyberboss\memory\fragments\` — 热度系统自动提取
- 周/月/年 Rollup：`~\.cyberboss\memory\rollups\`
- IDE Memory：`~\.claude\projects\C--Users-youzi\memory\`

## 配置关键项（.env）

```
CYBERBOSS_CHANNEL=direct
CYBERBOSS_DIRECT_PORT=9726
CYBERBOSS_RUNTIME=claudecode
CYBERBOSS_ENABLE_CHECKIN=true
CYBERBOSS_ALARM_PHONE_IP=192.169.0.103
CYBERBOSS_ALARM_PHONE_PORT=8765
CYBERBOSS_VISION_API_BASE_URL=https://api.siliconflow.cn
CYBERBOSS_VISION_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
```

## 待完成

**唯一待办清单入口。** 其他 docs/ 和 memory 文件里的待办已废弃，以这里为准。

### APP 端

| 项目                | 状态                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 手机端换行即发送    | 打字按换行会直接发送消息，无法换行，且无法撤回                                                                          |
| 审批弹窗            | 待验证 — WebSocket 推送弹窗替代聊天文本，电脑+手机同时弹，点按钮审批。待重启电脑后验证                                  |
| 调参台完善          | 待验证 — 所有页面独立微调（13 个 tab），点击遮罩关闭，scrollbar 可见。重启后 toge 自己验证                              |
| 三模型页面拆分      | 把当前三个模型页面拆成独立三页，各自不同主题色，可自己画配件/垫图装饰                                                   |
| 设置页去"我的昵称"  | ✅ 已修 — 删掉设置里的昵称项，统一从世界书取                                                                         |
| 世界书 ai 名字同步  | ✅ 已修 — 世界书保存/加载/切模型时自动同步标题，每个模型独立                                                             |
| 日历页去"记忆"跳转  | 删除日历页面的"记忆"跳转入口，计划栏放最底层，确认日历组件是否拆好                                                      |
| 消息气泡不能拆分    | 消息气泡无法拆分，待排查                                                                                                |
| 通知延迟+页内弹出+掉线显示在线 | 待验证 — APK v13：heartbeat 桥防页内重复弹、setOnlineStatus 同步前台通知状态、轮询 120s→60s |
| 权限申请弹到电脑端  | APP 端触发权限申请会弹窗到电脑端，导致手机端卡死。需改为 APP 内弹窗或手机端独立审批                                     |
| **APP 加强制刷新键** | 服务重启/断连后 APP localStorage 可能丢消息，加手动刷新按钮重新拉服务端历史                                            |
| COT 内行距缩短      | ✅ 已修 — line-height 1.5→1.3，事件委托防点击失效，指纹精确恢复防消失                                                                                   |
| COT 突然消失        | ✅ 已修 — 根因是 loadCachedThinking 盲匹配+全删重建，改为 msgFingerprint 精确恢复 + 事件委托 |

### 后端 / 服务

| 项目                   | 状态                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 闹钟接入聊天流程       | parser 和 APK 已就绪，需接到 Claude Code 对话里                                                                                                         |
| 僵尸进程自动清理       | kill-zombies.ps1 已重写，待 Codex 审核后测试                                                                                                            |
| 废弃微信 MCP 工具下线  | tool-mcp-server 仍暴露 `cyberboss_channel_send_file` 等已废弃的微信通道工具，IDE 端会话会误调。从 MCP server 移除这些工具或标记 deprecated 返回明确错误 |
| 前端组件化             | 记忆/涂鸦/桌宠组件化                                                                                                                                    |
| 隧道大数据响应断开     | WebSearch 多轮结果堆积，响应体过大时 cloudflared 隧道断开，手机端超时后不自动重连。可能与"消息气泡不能拆分""通知延迟"同根                               |

### 克的行为优化

| 项目                      | 优先级 | 执行方案                                                                                                                                              |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **记忆碎片：对话版 skip** | 🟢 低  | ① 找到对话版 `classifySentence`，对齐日记版的质量门控（过滤纯时间线、Markdown 噪音等）；② 改动约 1-2 行条件判断                                       |
| **记忆碎片：无主语短句**  | 🟢 低  | ① 提取碎片时识别隐含主语的短句（"有 ADHD"、"住在萧山"、"喜欢女生"）；② 方案：无主语 + 身份关键词 → 自动归类 identity；③ 改动约 5-10 行正则/关键词匹配 |
| **记忆检索精度优化**      | 🟡 中  | 每句话不盲目捞一堆碎片，只捞跟当前话题相关的。调检索精度不调量，延长窗口寿命                                                                          |

> 华为手机设置 + 生活待办 → 见 [CLAUDE.md](../../CLAUDE.md) "生活待办"

## 迭代记录

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **摘要**（此表） | 关键进展一行概括                                                                          |
| **详细版**       | [docs/iteration-log.md](docs/iteration-log.md) — 每次迭代的完整上下文、踩坑记录、架构决策 |

| 日期         | 关键进展                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **05/23**    | 项目起点：克部署到微信                                                                                                                                                                                                                                                                                                                                                        |
| **05/26**    | IDE 克和微信克共享日记和时间轴，不再"换窗口换人"                                                                                                                                                                                                                                                                                                                              |
| **05/27**    | 网页版一夜建成：6 MCP 工具 + 桌宠 + 冥想/涂鸦/日历/调参台                                                                                                                                                                                                                                                                                                                     |
| **05/30**    | 闹钟系统完成：TogeAlarm APK + alarm-parser.js                                                                                                                                                                                                                                                                                                                                 |
| **05/31**    | PWA 桌面应用 + Session 重连 + 桌宠 + 识图优化 + 进程清理                                                                                                                                                                                                                                                                                                                      |
| **06/04**    | 放弃微信端，转 direct channel + Cloudflare Tunnel + Android APK；从 AionsHome 搬世界书/礼物/摄像头/MCP                                                                                                                                                                                                                                                                        |
| **06/05**    | 购入域名 `withtoge.us`，Named Tunnel，彻底放弃微信                                                                                                                                                                                                                                                                                                                            |
| **06/06**    | APK v1→v5：纯全屏 WebView，硬编码 `https://克.withtoge.us`                                                                                                                                                                                                                                                                                                                    |
| **06/09**    | WS 不回消息根因修复（cloudflared `--url` vs ingress 冲突）                                                                                                                                                                                                                                                                                                                    |
| **06/09~11** | **奶茶记录**：卡通日历 + 详情卡片 + API + 克自动提取记录                                                                                                                                                                                                                                                                                                                      |
| **06/10**    | APK 图片上传 + 消息通知 + 礼物 CSS 信件                                                                                                                                                                                                                                                                                                                                       |
| **06/11**    | 项目改名 cyberboss→withtoge（~1600 处替换）；**文档三体系定型**（CLAUDE 纯陪伴 / WITHTOGE 技术 / 迭代日志）；**审批弹窗**（WS broadcast，电脑+手机同时弹窗审批）；**调参台页面级作用域**（13 个 tab 独立微调）；**多模型 Session 并存**（DS/Opus/Haiku 各自存活）；**手札接力**（跨 session 上下文接力）；**记忆系统 6 项改进**（GPT+Gemini 审查后落地）；收藏夹+信封+多选 UI |
| **06/12**    | Turn Gate 永久锁死修复                                                                                                                                                                                                                                                                                                                                                        |
| **06/15~16** | **贴纸系统**完整接入 APP/Web：6 API + WS + 前端面板/标签编辑/上传删除；**收藏夹服务端持久化**（bookmarks.json API）；cloudflared Windows Service 化                                                                                                                                                                                                                           |
| **06/17~18** | **多模型混合架构**：DS(CLI) + Opus(直调 API)，`model-routes.js` 一行加模型，API 直调 SSE 客户端从零写起                                                                                                                                                                                                                                                                       |
| **06/17~20** | **Thinking 流式显示**：完整链路打通（Claude Code→events→WS→ 前端），计时器+折叠+localStorage 缓存                                                                                                                                                                                                                                                                             |
| **06/20**    | **小手机主页**：Gemini 生成页面嵌入 App，CSS 7 条铁律写入接入文档                                                                                                                                                                                                                                                                                                             |
| **06/23**    | **聊天记录存档导入**：15 个 MD 存档解析器 + **记忆库统一 MemoryItem**（conversation+letter）+ **信件区**（CRUD+iframe 阅读+编辑器）；设置页去昵称 + 世界书 AI 名字按模型同步标题栏                                                                                                                     |
| **06/24~25** | **cloudflared 1033 根治**：guardian 重写 + 312 次重启循环事故 + kill-zombies 误杀 IDE MCP 止血。**VPS 东京正式上线**：LocVPS ¥36/月，systemd 守护，告别 Windows guardian |
