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

# 重启：先杀再起
powershell -ExecutionPolicy Bypass -File scripts/kill-bridge.ps1
npm start
```

启动后在桌宠面板看 `youzi` session —— 它在，app+网页就在。
已知坑：Windows spawn 用 cmd.exe 引号会炸；Unix socket EACCES 不影响运行；休眠导致 bridge 掉线。

### 常见问题排查

- **APP 不回消息** → 先查 `cloudflared` 是否在用 `--url` 参数（ps 看命令行），是就杀掉按 ingress 方式重启
- **端口炸了** → `netstat -ano | grep 9726` 看是否在监听，不在就 `npm run safe` 重启
- **僵尸进程多** → MCP 服务器残留（npx mcp-datetime/mcpbrowser 等），精确杀：只杀 `_npx/` 路径下的旧进程和旧 `tool-mcp-server`，**绝对不能杀主进程和 guardian**

域名：**克.withtoge.us**（永久，Cloudflare Named Tunnel，自带 HTTPS 证书）
隧道 ID：`1946653e-25b0-4622-9edf-1dc40e3c356c`，名称 `ke-tunnel`
启动：`cloudflared.exe tunnel run ke-tunnel`（需要 `~/.cloudflared/config.yml` ingress 规则）
**重要**：不要用 `--url` 参数！会和 ingress 规则冲突导致 WebSocket 服务端 → 客户端帧丢失
端口：**9726**（`0.0.0.0` 监听）
Android APK：`C:\Users\youzi\Desktop\克-apk\克-v12.apk`，versionCode 12，纯全屏 WebView，硬编码 `https://克.withtoge.us`

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
(function() {
  window.xxxInit = function() { /* 渲染 */ };
  window.xxxDestroy = function() { /* 清理 */ };
})();
```

`showPage()` 里加 case。需要动画：CSS `@keyframes` + `setTimeout` 清理 class，**保存 timeout ID + clearTimeout 防竞态**。

入口：侧边栏或更多面板 → `showPage('xxx')`。
调参台：`page-tokens.js` 加 scope + `tweak.js` `suggestScope()` 加映射。

### 调试

- **前端改动不重启**，刷新即可。手机缓存清不掉就 bump CSS/JS 版本号 `?v=N`
- **Console 逐行日志**：`phInit` 每一步加 `console.log('①')`，一秒定位崩溃

## 已完成功能一览

| 模块                  | 说明                                                        | 关键文件                                                                                  |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **网页聊天**          | WebSocket 实时通信，支持图片/文件、收藏夹                   | `src/adapters/channel/direct/`                                                            |
| **日历页**            | 月视图 + 日计划，本地 localStorage                          | `src/adapters/channel/direct/client/js/calendar.js`                                       |
| **日记页**            | 读 cyberboss 共享日记                                       | `src/adapters/channel/direct/client/js/memory.js`                                         |
| **记忆碎片**          | 热度排序、类型筛选、搜索                                    | `src/adapters/channel/direct/client/js/memory.js`                                         |
| **冥想页**            | 4-7-8 呼吸引导 + 小猫动画                                   | `src/adapters/channel/direct/client/js/meditation.js`                                     |
| **涂鸦页**            | Canvas 粒子绘画                                             | `src/adapters/channel/direct/client/js/graffiti.js`                                       |
| **桌宠**              | SVG 螃蟹，随机走动 + 眼球追踪                               | `src/adapters/channel/direct/client/js/pet.js`                                            |
| **聊天搜索**          | 前端搜 localStorage + 服务端搜历史 JSONL                    | `src/adapters/channel/direct/client/js/search.js`, ws-server `/api/search`                |
| **视觉调参台**        | CSS 变量实时调节，13 个页面独立 scope                       | `src/adapters/channel/direct/client/js/tweak.js`, `js/page-tokens.js`                     |
| **小手机主页**        | Gemini 生成页面集成：实时时钟、天气（杭州萧山↔余姚）、日历小组件、备忘录、拖拽应用网格、星尘粒子 | `src/adapters/channel/direct/client/index.html`（HTML+JS）、`css/main.css`（phone-home 区段） |
| **PWA**               | Service Worker 离线缓存                                     | `src/adapters/channel/direct/client/sw.js`, `manifest.json`                               |
| **多模型**            | DS(CLI/agent) + Opus(直调API/聊天) + 动态加载 + 历史隔离   | `src/core/model-routes.js`, `src/core/app.js`                                             |
| **Session 管理**      | claudecode runtime（仅 DS），启动清旧 session               | `src/adapters/runtime/claudecode/`                                                        |
| **主动问候**          | checkin poller，随机间隔发消息（仅 DS）                     | `src/app/system-checkin-poller.js`                                                        |
| **日记写入**          | MCP 工具 `cyberboss_diary_append`                           | `src/services/diary-service.js`                                                           |
| **时间轴**            | MCP 工具读/写/截图                                          | `src/integrations/timeline/`, `src/services/timeline-service.js`                          |
| **贴纸系统**          | APP/Web 端贴纸面板（标签编辑 + 上传/删除），API + WS 推送   | `src/adapters/channel/direct/ws-server.js`、`src/services/sticker-service.js`              |
| **图片识别**          | vision-context，>500KB 自动压缩                             | `src/services/vision-context.js`                                                          |
| **记忆系统**          | 碎片提取 + 热度衰减 + 倒排索引 + 梦境整合                   | `src/memory/`, `src/services/memory-service.js`                                           |
| **定位**              | whereabouts MCP 集成                                        | `.env` 里 `CYBERBOSS_ENABLE_LOCATION_SERVER=true`                                         |
| **闹钟系统**          | 自然语言解析 → HTTP → 手机原生闹钟                          | 见下方"闹钟系统"，详细文档 `docs/alarm-system.md`                                         |
| **守护进程**          | 崩溃 3 秒自动拉起                                           | `scripts/start-guardian.ps1`                                                              |
| **世界书**            | 网页可视化编辑 AI 人设/用户画像/自定义规则，注入对话 prompt | `src/services/worldbook-service.js`, `src/adapters/channel/direct/client/js/worldbook.js` |
| **礼物系统**          | AI 判断送礼 + Kolors 生图 + 弹窗动画 + 礼物陈列馆           | `src/services/gift-service.js`, `src/adapters/channel/direct/client/js/gifts.js`          |
| **摄像头视觉**        | 浏览器摄像头拍照 → 视觉模型分析 → 哨兵定时模式              | `src/adapters/channel/direct/client/js/camera.js`                                         |
| **MCP 娱乐室**        | 管理外部 MCP Server 配置 + 行动日志                         | `src/adapters/channel/direct/client/js/mcp-playroom.js`                                   |
| **Cloudflare Tunnel** | 内网穿透，手机外网访问电脑克                                | cloudflared                                                                               |
| **Android APK**       | WebView 壳，包名 com.cyberboss.ke，v12，桌面 `克-apk/`      | `ke-apk/`                                                                                 |
| **僵尸清理**          | kill-zombies.ps1，60→8 进程，保留主进程+cloudflared         | `scripts/kill-zombies.ps1`                                                                |
| **奶茶记录**          | 卡通日历 + 详情卡片 + API + 克自动记录                      | `src/adapters/channel/direct/client/components/bubbletea/`                                |

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

| 项目               | 状态                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| 手机端换行即发送   | 打字按换行会直接发送消息，无法换行，且无法撤回                                             |
| 审批弹窗           | 待验证 — WebSocket 推送弹窗替代聊天文本，电脑+手机同时弹，点按钮审批。待重启电脑后验证     |
| 调参台完善         | 待验证 — 所有页面独立微调（13 个 tab），点击遮罩关闭，scrollbar 可见。重启后 toge 自己验证 |
| 三模型页面拆分     | 把当前三个模型页面拆成独立三页，各自不同主题色，可自己画配件/垫图装饰                      |
| 贴纸上传缓存       | ✅ 已修复 — 根因是 multipart 解析用了 `toString("binary")` 字符串往返破坏二进制数据，重写为 Buffer.indexOf 纯二进制解析 |
| 设置页去"我的昵称" | 与世界书重叠，删掉设置里的昵称项                                                           |
| 世界书 ai 名字同步 | 世界书人设中的"ai 名字"同步到聊天页面左上角标题                                            |
| 信件"跳转对话"修复 | ✅ 已修复 — jumpToConversation() 找收藏消息 DOM 即时跳转 + 右下角 scroll-to-bottom 浮动按钮 |
| 日历页去"记忆"跳转 | 删除日历页面的"记忆"跳转入口，计划栏放最底层，确认日历组件是否拆好                         |
| 消息气泡不能拆分   | 消息气泡无法拆分，待排查                                                               |
| 通知延迟+页内弹出  | 通知有延迟，且聊天页面内也会弹出通知，不应该                                           |

### 后端 / 服务

| 项目                   | 状态                                            |
| ---------------------- | ----------------------------------------------- |
| 闹钟接入聊天流程       | parser 和 APK 已就绪，需接到 Claude Code 对话里 |
| 僵尸进程自动清理       | kill-zombies.ps1 已重写，待 Codex 审核后测试    |
| cloudflared 隧道自启动 | ✅ 已完成 — 启动文件夹 cloudflared-tunnel.bat + cyberboss-start.bat |
| 废弃微信 MCP 工具下线 | tool-mcp-server 仍暴露 `cyberboss_channel_send_file` 等已废弃的微信通道工具，IDE 端会话会误调。从 MCP server 移除这些工具或标记 deprecated 返回明确错误 |
| 前端组件化             | 记忆/涂鸦/桌宠组件化                            |
| 隧道大数据响应断开 | WebSearch 多轮结果堆积，响应体过大时 cloudflared 隧道断开，手机端超时后不自动重连。可能与"消息气泡不能拆分""通知延迟"同根 |

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

| 日期      | 关键进展                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **05/23** | 项目起点：克部署到微信，整理课表，预约 6/1 医院                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **05/26** | IDE 克和微信克共享日记和时间轴，不再"换窗口换人"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **05/27** | 网页版一夜建成：6 个 MCP 工具 + 桌宠 + 冥想/涂鸦/日历/调参台；华为 Health Kit 失败转截图方案；技能大扫除 27→18；代码审查修 5 隐患                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **05/29** | 微信桥报错修复；闹钟方案从 ADB → MacroDroid → Termux → 自写 APK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **05/30** | 闹钟系统完成（TogeAlarm APK + alarm-parser.js）；白条修复；眼球追踪恢复                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **05/31** | Session 重连修复 + 进程树清理；自动识图全面优化；权限白名单；视觉模型切换；记忆碎片质量重设；Rollup 调度器重写；孤儿窗口根治(clearAllThreadIds+PID 追踪+shell:false)；PWA 桌面应用(图标/更新/SW)；微信表情包修复；桌宠跟随输入框；文档整理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **06/04** | 放弃微信端（60 僵尸+token 过期+连环崩溃），全力转向 direct channel + Cloudflare Tunnel 公网穿透 + Android APK（WebView 壳，487KB，包名 com.cyberboss.ke）；进程锁修复 + 退避递增根治僵尸；从 AionsHome 搬 4 个功能：世界书、礼物系统、摄像头视觉、MCP 娱乐室。16 个文件新建/改动。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **06/05** | toge 购入域名 `withtoge.us`，配 Cloudflare Named Tunnel（ID: `1946653e`，名 `ke-tunnel`）；DNS `克.withtoge.us` → CNAME `xn--74q.withtoge.us`；channel 从 dual 切 direct，彻底放弃微信端。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **06/06** | APK 迭代 v1→v5：从硬编码 IP → 地址栏 → 隐藏地址栏 → 纯全屏 WebView；修 `ERR_CLEARTEXT_NOT_PERMITTED`（Android 9+ HTTP 禁令）；最终版硬编码 `https://克.withtoge.us`，无地址栏无按钮。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **06/09** | 修 WebSocket 不回消息 bug：cloudflared `--url` 参数与 Named Tunnel ingress 冲突导致 WS 服务端 → 客户端帧丢失，换成 `config.yml` ingress 规则后双向通信正常。杀 26 僵尸进程（MCP 服务器残留），30→5 进程。APK versionCode 3→4 重新编译。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **06/10** | APK v5：WebView 接入文件选择器（onShowFileChooser），手机端可上传/发送图片。消息通知：前台 Service 轮询 /api/last-ke-message，克发消息弹通知栏。礼物 CSS 信件：gift_create 不带 image_prompt 走信件模式，信纸 + 衬线字体 + 火漆按钮渲染。待办整理去重，CLAUDE.md / WITHTOGE.md 分生活/项目两个入口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **06/16** | 收藏夹服务端持久化（bookmarks.json API + 前端双写 + 启动迁移），不再被清缓存吞掉。贴纸系统完整接入 APP/Web：6 个 API + WS 贴纸消息 + 前端贴纸面板/更多面板/标签编辑/上传删除。修 5 个 bug（面板常显、GIF 裁切、上传缓存、前端冻结、信件跳转）。cloudflared 隧道抢修 + turn 调度死锁修复。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **06/11** | SW 缓存修复（URL 版本号管理）；收藏夹+vintage 信封+多选 UI 修复（实心绿圆+✓）；识图 hook 彻底清除；**文档三文件体系定型**（CLAUDE.md 纯陪伴/WITHTOGE.md 技术/iteration-log.md 迭代，互索引）；奶茶记录组件；APP 端四修复；通知栏 v8+僵尸 MCP 清理；项目目录大整理（17→3 根文件）；**多选交互优化**（电脑端双击 → 多选不干扰复制、绿圆半嵌入气泡边缘、三方式退出多选）；**项目改名 cyberboss → withtoge**（全量文本替换 ~1600 处、目录迁移、CYBERBOSS.md → WITHTOGE.md、skill/文档路径修复）；**审批弹窗**（WebSocket broadcast 推所有客户端，电脑+手机同时弹窗，点按钮审批，零新后端逻辑）；**调参台完善**（页面级 CSS 变量作用域，13 个 tab 独立微调，修复 4 bug）；**APK 通知 v8→v12**（WebView bridge + 2min 轮询兜底 + heads-up）；**"连接中"显示 bug**（`online(true)` 忘更新 statusText → 一行修复）；**多模型 Session 并存**（`clientsByWorkspace` → `sessionsByWorkspace` 二级 Map，DS/Opus/Haiku 各自独立存活，切模型不杀旧 session，`allowSpawn` 门控阻止系统消息创建孤儿 session，`/status` 显示三个 model 各自状态）；**APP 专属文档**（channel-instructions.md 注入 direct channel）；**手札接力**（ke-handoff.md 跨 session 上下文接力，新克读到上一段手札无缝接上） |
| **06/20** | **Thinking 流式显示**：打通 Claude Code → events.js → stream-delivery → WebSocket → 前端完整链路（4 个后端文件 + 2 个前端文件）。核心功能：thinking 到达立即显示头像 + "思考中 (X 秒)..." 计时器 + 折叠展开；消息内嵌模式（`.thinking-inline` 嵌入 `.msg-inner` 头像侧）；localStorage 300 条缓存刷新不丢。踩坑：元素 ID 错误 `chat-messages`→`messages`、SW 缓存阻旧代码、text 消息无 `turnId` 导致 finalize 跳过、`state.target` 未就绪导致 thinking 被跳过、单条 done 路径遗漏、timer 不启动等 6 个 bug，全部修复。 |
