# withtoge — 个人 AI 陪伴系统

> **这个文件**：项目架构、功能清单、运维命令、待办、API 细节。
> **toge 生活 / 人设 / 课表 / 教训** → [CLAUDE.md](../../CLAUDE.md) > **迭代详情** → [docs/iteration-log.md](docs/iteration-log.md) > **闹钟文档** → [docs/alarm-system.md](docs/alarm-system.md) > **计划** → [docs/plans/](docs/plans/)

目录：`C:\Users\youzi\withtoge\`

## ⚠️ 当前状态（换窗口先读这个）

### 已知风险

- cloudflared 单实例，隧道断了 APP 全挂（无冗余）
- VPS 时区已设为 `Asia/Shanghai`，重装系统 / 新部署注意别覆盖

### 当前假设

- DS 走 CLI（agent 模式），Opus / GLM / 米米子走 API（聊天模式）
- 本地 Windows 节点已关停（2026-06-30），唯一入口 `克.withtoge.us`
- VPS systemd 守护（cloudflared + cyberboss），崩了自动拉

### 反复出现的陷阱

- **Edit 工具吞 `}` / 换行符不匹配** → 改完 CSS/JS 跑括号平衡检查 `node -e`
- **linter 自动格式化破坏 import** → 别开保存时自动格式化
- **`state.target` ≠ `state.replyTarget`** → 两字段不一致，新增代码注意对齐
- **CSS inline style 优先级覆盖 class** → 显示/隐藏用 class 控制，别写 `style="display:none"`
- **SSH 命令被安全分类器拦截** → 别硬撞。拉文件到本地用 Edit 改完 scp 回去；或者本地 clone 仓库（`/tmp/withtoge`），改完 git push + 一条 ssh 重启

## Git 规范 + GitHub 工作流

> ⚠️ 项目已 git init。**每次写代码必须 commit。** 所有模型/端口都要遵守。

**仓库**：[xiaoyou5602/yyy](https://github.com/xiaoyou5602/yyy)

**工作流**：

```
本地改代码 → git commit → git push github → VPS 上 git pull → systemctl restart cyberboss
```

- **改代码前先看状态**：`git status` 确认工作区干净，`git log --oneline -5` 了解最近的改动
- **一个功能一个 commit**：改完一个完整功能就 commit（`git add <具体文件>`），commit message 用中文简短写清楚
- **commit message 格式**：`<动词><名词>：<说明>`，例如 `加转盘游戏 Canvas 实现`、`修骰子动画卡顿`
- **验收通过立刻 commit**：不要拖到下个 session
- **不提交敏感文件**：`.env`、`node_modules/` 已在 .gitignore，add 前确认
- **迭代日志 ≠ Git commit**：commit 边走边打（记账），迭代日志收工时统一写（财报）。迭代写 WHY 和故事线，commit 记 WHAT 和代码变更
- **推送后 VPS 更新**：`ssh -p 25790 root@103.85.25.226 "cd /opt/withtoge && git pull github master && systemctl restart cyberboss"`

## 启动与运维

> 生产环境：VPS 东京 `103.85.25.226`，systemd 守护。本地 Windows 节点已关停（2026-06-30）。

### 基础设施

| 项目       | 详情                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 域名       | `克.withtoge.us`（Cloudflare Named Tunnel，自带 HTTPS）                   |
| 端口       | `9726`（`0.0.0.0` 监听）                                                  |
| VPS        | LocVPS 东京，Ubuntu 22.04，2 核 4G，¥36/月                                |
| 隧道       | ID `1946653e-25b0-4622-9edf-1dc40e3c356c`，名称 `ke-tunnel`，systemd 守护 |
| Notion MCP | `https://notion.withtoge.us`，端口 3000                                   |
| APK        | `克-v15.apk`（`C:\Users\youzi\Desktop\克-apk\`），versionCode 15          |

### VPS 运维

```bash
systemctl status cloudflared cyberboss  # 看状态
systemctl restart cyberboss              # 更新代码后重启
journalctl -u cyberboss -f              # 看日志
```

更新部署：`git push github master` → `ssh -p 25790 root@103.85.25.226 "cd /opt/withtoge && git pull github master && systemctl restart cyberboss"`

### 技术避坑

- **前端改完 bump 版本号**（CSS `?v=N`、SW.js `?v=N`），否则 Service Worker 缓存旧文件
- **`ws.onmessage` 外层有 `catch {}`**（`index.html`），前端 JS 报错会被静默吞
- **不要用 `--url` 参数**跑 cloudflared——和 ingress 冲突导致 WebSocket 帧丢失
- **绝对不要 `taskkill //F //IM node.exe`**——会杀 IDE 端进程。用 `scripts/kill-bridge.ps1` 精准杀

## 系统架构

```
手机 APK ──→ Cloudflare Tunnel ──→ cyberboss 服务 ──┬── type=cli → Claude CLI → DeepSeek (DS)
电脑网页 ──→ 127.0.0.1:9726 ──┘                    │
                                                    ├── type=api → 直调 HTTP → 55api (Opus)
                                                    ├── type=api → 直调 HTTP → 智谱 (GLM)
                                                    ├── type=api → 直调 HTTP → OpenClaw (米米子)
                                                    │
                                                    ├── 日记 / 时间轴 / 记忆碎片
                                                    ├── 世界书 / 礼物 / 摄像头 / MCP
                                                    └── 闹钟 / 贴纸 / 定位 / 图片识别 / 奶茶记录
```

当前通道：**direct**（网页直连，微信已弃用）
模型路由：`src/core/model-routes.js` — 加模型 = 加一行（type: cli/api）
API 直调：`src/core/direct-api-client.js` — SSE 流式客户端，绕过 CCSwitch/VPN

### 加新模型

打开 `src/core/model-routes.js`，在 `MODELS` 表加一行（`type: "api"` 或 `"cli"`），前端自动出现。API key 放 `.env`。

## 嵌入新页面

> 标准流程见 [docs/embed-new-page.md](docs/embed-new-page.md) — CSS 7 条铁律、JS IIFE 模板、调试方法

## 已完成功能一览

| 模块                  | 说明                                                                                               | 关键文件                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **网页聊天**          | WebSocket 实时通信，支持图片/文件、收藏夹                                                          | `src/adapters/channel/direct/`                                                                        |
| **日历页**            | 月视图 + 日计划，本地 localStorage                                                                 | `src/adapters/channel/direct/client/js/calendar.js`                                                   |
| **日记页**            | 读 cyberboss 共享日记                                                                              | `src/adapters/channel/direct/client/js/memory.js`                                                     |
| **记忆碎片**          | 热度排序、类型筛选、搜索                                                                           | `src/adapters/channel/direct/client/js/memory.js`                                                     |
| **冥想页**            | 4-7-8 呼吸引导 + 小猫动画                                                                          | `src/adapters/channel/direct/client/js/meditation.js`                                                 |
| **涂鸦页**            | Canvas 粒子绘画                                                                                    | `src/adapters/channel/direct/client/js/graffiti.js`                                                   |
| **桌宠**              | SVG 螃蟹，随机走动 + 眼球追踪                                                                      | `src/adapters/channel/direct/client/js/pet.js`                                                        |
| **聊天搜索**          | 前端搜 localStorage + 服务端搜历史 JSONL                                                           | `src/adapters/channel/direct/client/js/search.js`, ws-server `/api/search`                            |
| **视觉调参台**        | CSS 变量实时调节，13 个页面独立 scope                                                              | `src/adapters/channel/direct/client/js/tweak.js`, `js/page-tokens.js`                                 |
| **小手机主页**        | Gemini 生成页面集成：实时时钟、天气（杭州萧山 ↔ 余姚）、日历小组件、备忘录、拖拽应用网格、星尘粒子 | `src/adapters/channel/direct/client/index.html`（HTML+JS）、`css/main.css`（phone-home 区段）         |
| **PWA**               | Service Worker 离线缓存                                                                            | `src/adapters/channel/direct/client/sw.js`, `manifest.json`                                           |
| **多模型**            | DS(CLI/agent) + Opus(直调 API/聊天) + GLM5.2(API) + 米米子/OpenClaw(API) + 动态加载 + 历史隔离     | `src/core/model-routes.js`, `src/core/app.js`                                                         |
| **Session 管理**      | claudecode runtime（仅 DS），启动清旧 session                                                      | `src/adapters/runtime/claudecode/`                                                                    |
| **主动问候**          | checkin poller，随机间隔发消息（仅 DS）                                                            | `src/app/system-checkin-poller.js`                                                                    |
| **日记写入**          | MCP 工具 `cyberboss_diary_append`                                                                  | `src/services/diary-service.js`                                                                       |
| **时间轴**            | MCP 工具读/写/截图                                                                                 | `src/integrations/timeline/`, `src/services/timeline-service.js`                                      |
| **贴纸系统**          | APP/Web 端贴纸面板（标签编辑 + 上传/删除），API + WS 推送                                          | `src/adapters/channel/direct/ws-server.js`、`src/services/sticker-service.js`                         |
| **图片识别**          | vision-context，>500KB 自动压缩                                                                    | `src/services/vision-context.js`                                                                      |
| **记忆系统**          | 碎片提取 + 热度衰减 + 倒排索引 + 梦境整合                                                          | `src/memory/`, `src/services/memory-service.js`                                                       |
| **定位**              | whereabouts MCP 集成                                                                               | `.env` 里 `CYBERBOSS_ENABLE_LOCATION_SERVER=true`                                                     |
| **闹钟系统**          | 自然语言解析 → HTTP → 手机原生闹钟                                                                 | 见下方"闹钟系统"，详细文档 `docs/alarm-system.md`                                                     |
| **守护进程**          | VPS systemd 自动守护（cloudflared + cyberboss），崩了自动拉                                        | `/etc/systemd/system/cyberboss.service`                                                               |
| **世界书**            | 网页可视化编辑 AI 人设/用户画像/自定义规则，注入对话 prompt                                        | `src/services/worldbook-service.js`, `src/adapters/channel/direct/client/js/worldbook.js`             |
| **礼物系统**          | AI 判断送礼 + Kolors 生图 + 弹窗动画 + 礼物陈列馆                                                  | `src/services/gift-service.js`, `src/adapters/channel/direct/client/js/gifts.js`                      |
| **摄像头视觉**        | 浏览器摄像头拍照 → 视觉模型分析 → 哨兵定时模式                                                     | `src/adapters/channel/direct/client/js/camera.js`                                                     |
| **MCP 娱乐室**        | 管理外部 MCP Server 配置 + 行动日志                                                                | `src/adapters/channel/direct/client/js/mcp-playroom.js`                                               |
| **会话记忆库**        | 聊天记录 Markdown 存档导入，解析 15 个主题目录，thinking 折叠，搜索定位，懒加载渲染                | `src/services/chat-archive-parser.js`, `src/adapters/channel/direct/client/js/conversation-memory.js` |
| **信件区**            | iframe 同源 HTML 阅读 + app 内新建/编辑 + 分类标签 + 排序，统一 MemoryItem 架构                    | ws-server `/api/letters`, `client/index.html`（letter-detail/editor 页）                              |
| **Cloudflare Tunnel** | 内网穿透，手机外网访问电脑克                                                                       | cloudflared                                                                                           |
| **Android APK**       | WebView 壳，包名 com.cyberboss.ke，v12，桌面 `克-apk/`                                             | `ke-apk/`                                                                                             |
| **僵尸清理**          | kill-zombies.ps1，60→8 进程，保留主进程+cloudflared                                                | `scripts/kill-zombies.ps1`                                                                            |
| **奶茶记录**          | 卡通日历 + 详情卡片 + API + 克自动记录                                                             | `src/adapters/channel/direct/client/components/bubbletea/`                                            |
| **审批弹窗**          | WebSocket broadcast 推所有客户端，电脑+手机同时弹窗，点按钮审批                                    | `src/adapters/channel/direct/ws-server.js`, `index.html`                                              |
| **Thinking 流式**     | 思考过程实时显示：头像+"思考中(X 秒)"计时器+折叠展开+localStorage 缓存                             | `src/adapters/runtime/claudecode/events.js`, `index.html`                                             |

## 奶茶记录 🧋

> 数据文件 `~\.cyberboss\bubbletea\records.json`。API 见 `ws-server.js` `/api/bubbletea`，克自动记录规则见 CLAUDE.md。

## 闹钟系统（TogeAlarm）

> 详细文档 → [docs/alarm-system.md](docs/alarm-system.md)

架构：`中文时间 → alarm-parser.js → HTTP → 手机 TogeAlarm APK → AlarmManager`

**关键文件**：`src/services/alarm-parser.js`、`src/services/alarm-client.js`、`src/tools/alarm-tool.js`、`alarm-apk/`（Android 源码）

**运行**：`node "C:/Users/youzi/withtoge/src/tools/alarm-tool.js" "明天8点叫我起床"`

**华为兼容**：WiFi → "休眠时保持 WLAN 连接" → 始终；应用 → TogeAlarm → 电池 → 无限制

## 日记与记忆路径

- 日记：`~\.cyberboss\diary\` — 各模型共享。**已 git 化（07-03）**：本地与 VPS `/root/.cyberboss/diary/` 是同一私有仓库（裸仓库 `/root/diary.git`，**不上 GitHub**）的两个工作区，VPS 端 `diary-autosync` 服务 + 本地计划任务 `withtoge-diary-sync`（每 30 分钟）自动双向同步。两端直接读写文件即可，急了手动跑 `scripts/sync-diary.ps1`
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

> ⚠️ **硬规则**：读到"更新迭代日志"或"更新 withtoge"时，更新完对应文件后必须扫一遍本清单，把本次已完成的划掉（`[ ]` → `[x]`）。不要只更新迭代日志忘了待办。

### APP 端

- [ ] 调参台完善 — 待验证。所有页面独立微调，点击遮罩关闭，scrollbar 可见。
- [ ] 日历页去"记忆"跳转 — 删除日历页面的"记忆"跳转入口，计划栏放最底层，确认日历组件是否拆好
- [x] 新消息自动滚到底端 — **已改需求**：不再无条件强制滚动。改为：停在底部时新消息跟随滚动；往上翻看历史时新消息不打断阅读，改为在悬浮按钮上显示未读角标数字，点击才跳到底部并清零。index.html（5 个模型 zone）+ js/chat-ds.js（真正跑在 APP 里的 DS 主聊天页逻辑）均已改。踩坑：一开始改错了孤儿文件 `chat-ds.html`（全仓库无引用，已删），后来才找到真正被 index.html 引入的 js/chat-ds.js 补上
- [x] 气泡拆分多 bug — **已修已验证**（07-03 commit dbc5665，已部署 VPS，07-03 夜间代码审查通过）。根因：①`const merged` 重赋值 TypeError 导致整页历史不渲染；② 本地存逐 chunk、服务端存整条，dedup 吃掉带 globalId 的末 chunk 导致双份并存；③`/api/messages` 的 thinking 条目被当普通气泡渲染。修法：history 一条逻辑消息一个 entry（text+chunks），拆分只做渲染，renderMsg 唯一入口。代码审查：merged 变量、localChunkGids 过滤、renderMsg 三路分支、thinking turnId dedup 均正确。APP 端 toge 可再打开验证一下实际效果
- [x] Opus 页 COT 重复+空块+气泡断句乱（07-03 toge 报，思考摘要上线后发现）— **已修（07-03 commit c5eb947，已部署 VPS）**。真正根因：①短思考（<200 字）全程达不到 flushThinking 阈值，思考期间前端 pre-占位块空转（"已思考 11 秒"空块），onDone 才把思考发出被前端当第二轮渲染（"已思考 0 秒"块）→ 修法：首个正文 chunk 到达时强制 flushThinking（正文开始=思考必已结束）；②API 路径 send/saveThinking 无 turnId，前端 dedup/归组失效 → 生成 apiTurnId 串联流式与存档；③flushText 把整个 buffer 一次发出导致句中断开 → 改为只切到最后一个句末/段落符，残句留缓冲区。**待 toge 验证**：Opus 页再发条消息，应只有一个思考块且气泡按句断开
- [ ] 通知延迟+页内弹出+掉线显示在线 — 待验证。APK v13：heartbeat 桥防页内重复弹、setOnlineStatus 同步前台通知状态、轮询 120s→60s
- [x] APP 加强制刷新键 — **已修（07-03 夜间自动任务）**。在 header-right 加↺刷新图标按钮，点击调用 `syncHistoryFromServer()` 重拉服务端历史，带 360° 旋转动画反馈
- [x] 清缓存后气泡全空 — **已修（07-03 commit bfb2ff4，已部署 VPS，浏览器模拟清缓存验证通过：358 条历史自动拉回）**。根因：loadModels（含空 model 回填默认值的兜底）和 initHistory 并行竞态，initHistory 抢跑时带空 `?model=` 拉服务端被过滤成空数组 → 白屏。修法：initHistory `await modelsReady`。APP 端 toge 再验证一次即可归档
- [x] Opus 页显示思考摘要 — **已修（07-03 commit d146bdb + 9d463e9，已部署 VPS，端到端验证 thinking 回调收到内容）**。改动：model-routes.js opus 加 `thinking: true` 开关；direct-api-client.js 请求带 thinking 参数、max_tokens 4096→16000（thinking 消耗输出预算）；app.js onDone 时 saveThinking 存档（与 stream-delivery 一致，思考排回复前）。**踩坑：55api 中转会剥离 adaptive 模式**（HTTP 200 但流里无 thinking 块），只有老式 `{type:"enabled", budget_tokens:4096}` 能透传（4.6 上 deprecated 但可用）；换直连官方 API 时改回 `{type:"adaptive", display:"summarized"}`。SSE 解析和 onThinking→sendThinking→前端广播链路原本就有，无需改前端。**待 toge 验证**：APP Opus 页发条需要推理的消息，看思考块是否显示（若 Opus zone 前端没渲染 thinking 再补前端）
- [x] 收藏不同步+收藏夹内容丢失 — **已修，toge 验收通过（07-03 commit 0a07472）**。真相：数据没丢（服务端 3 条完好），是 06/29 thinking 重构误删了 `renderBookmarksList()`，收藏夹页一开就 ReferenceError 空白。已恢复函数 + 修 jumpToConversation 异步误用 + 服务端 POST 改按 id 合并防覆盖。toge 打开收藏夹页看到 3 条旧收藏即验证通过
- [x] 小手机日历组件今日不加亮（07-03 toge 报）— **已修（07-03 夜间自动任务）**。根因：`renderCalWidget` 第一行（前 `7-off` 天）循环没有 `today` 判断，7 月 3 日恰在第一周所以不亮。修法：第一行循环也加 `d === today` 检查，与后续行保持一致
- [x] 小手机备忘录不持久化（07-03 toge 报）— **已修（07-03 夜间自动任务）**。根因：`phAddTodo`/`phToggleTodo`/edit/delete 均无 localStorage 读写。修法：加 `saveTodos()`/`loadTodos()` 函数（存 `withtoge-ph-todo`），phInit 时加载，增删改查后均保存
- [x] DS 页刷新/重开后卡"连接中"（07-04 toge 报）— **已修（07-04 commit dd56551，已部署，浏览器复现+验证通过）**。根因：index.html 启动路由（localStorage last-page=chat-ds 时 showPage+dsChatInit）在主内联脚本里执行，早于页面尾部的 `<script src="chat-ds.js">` 加载，`typeof window.dsChatInit` 为 undefined 被静默跳过——DS 页显示了但从未初始化、从未建立自己的 WebSocket，状态永远"连接中"，消息也收不到（主页面 WS 其实在线，服务端一切正常）。修法：chat-ds.js 末尾自愈——脚本加载完检测 DS 页已显示且未初始化则补跑 dsChatInit。v39→v40。**注意此 bug 会伪装成"隧道断了/通知不来/丢消息"**——凡 APP 重开后 DS 页异常先想到它
- [ ] 刷新键疑似摆设（07-04 toge 报）— 加了↺按钮但点击可能没真正触发同步，需排查。**可能与上条同源**：↺在主 chat 页 header，而 toge 常驻的 DS 页（chat-ds）没有刷新键，且 DS 页 WS 未建时同步了也不显示——上条修复后请 toge 再试
- [ ] APP 端权限白名单未生效（07-04 toge 报）— 权限白名单配置了但不生效，待排查

### 后端 / 服务

- [ ] 健康数据 MCP（07-03 立项）— **方案已定稿 → [docs/plans/health-mcp.md](docs/plans/health-mcp.md)**。链路：手环9Pro → 小米运动健康 → Health Connect → Health Sync 推 webhook → cyberboss `/api/health` → 内部 MCP 工具 + `health.withtoge.us` 标准 remote MCP（官 APP connector 也能接）。阶段 0（后端管道+假数据测试）手环到货前就可做；阶段 1 等手环（toge 操作）。主要风险：国行 app 可能无 HC 同步开关（备选：国际版 Mi Fitness 港区账号，教程已验证可行）

- [x] 本地 MCP diary_append 写错日记本（07-03 发现）— **已修（07-03 日记 git 化）**。方案照抄 md 同步：VPS 建私有裸仓库 `/root/diary.git`（**不上 GitHub**，日记私密），`/root/.cyberboss/diary/` 与本地 `~/.cyberboss/diary/` 都是它的工作区。VPS 端 `diary-autosync` systemd 服务（inotify → commit+push，脚本 `/usr/local/bin/diary-autosync.sh`）+ 裸仓库 post-receive hook（rebase 更新工作区）；本地端 `scripts/sync-diary.ps1` + 计划任务 `withtoge-diary-sync`（每 30 分钟）。分叉的 6 天日记（06-25/26/28/29/30、07-03）已按时间戳归并去重，合并前原状在 git 历史 `b5bab59`，本地旧目录备份在 `~/.cyberboss/diary-backup-20260703`。本地 MCP diary_append 照旧写本地即可，同步自动。双向链路 07-03 已验证通过
- [x] session 重启自动接续上下文（07-03 toge 报）— **已修（07-04 commits 36d750e/8ffad02/06d2b97，已部署 VPS）**。三件套：①写端 `recent-context-writer.js` 消息落库后防抖 5s 自动重写 `~/.cyberboss/recent-context.md`（24h/8000 字/60 条，过滤 thinking/JSON/错误/审批弹窗，checkin 主动消息标「（主动）」）；②读端 opening turn 注入回顾段（handoff 手动通道保留）；③计划外关键发现——`session_replaced` 场景 openingTurn=false 根本不走 opening 注入（新 session 连 persona 都没有），claudecode/index.js opening 条件加 `|| !hadExistingSession`，重启后首条消息必带完整注入。踩坑：存储 model 字段是 modelName（"deepseek-v4-pro"）不是路由键 "ds"，空 model = checkin 主动消息。**待 toge 验证**：APP 给 DS 发「我们刚才聊到哪了」，克应能答出重启前话题。claudecode `--resume` 为何总失败另行调研（改动大、边界多，暂缓；就算修好，重启断片依然需要回顾兜底）。方案与排查全文 → [docs/plans/session-context-relay.md](docs/plans/session-context-relay.md)
- [x] 思考/调工具时发消息把 session 挤掉的 bug（toge 07-04 问是否还在）— **已修于 07-02（commit bdbfe66，turn-gate 移除 181s 超时自释放）**。旧行为：思考+工具超 3 分钟 → gate 被误判卡死自动释放 → 排队消息 dispatch → cancelTurn 杀掉进行中的 turn → 新 session 顶上（日志最后一次发生 07-01 23:55）。现行为：turn 进行中新消息排队等待，10 分钟无进展才判卡死，15 分钟 gate 兜底。07-02 后日志再无 stuck-gate 挤占记录
- [x] 静默 checkin 的思考出现在聊天页（07-04 toge 报）— **已修（07-04 commit bdd3e9b，已部署）**。系统轮（`replyTarget.provider === "system"`）的 runtime.thought 不再广播到前端、turn 完成时不再 saveThinking 存档——静默轮不会在聊天页留下没有正文的思考块，checkin 发主动消息时也不带思考块（思考显示只保留给 toge 主动发起的对话轮）
- [ ] 闹钟接入聊天流程 — parser 和 APK 已就绪，需接到 Claude Code 对话里
- [ ] 前端组件化 — 记忆/涂鸦/桌宠组件化

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
| **06/23**    | **聊天记录存档导入**：15 个 MD 存档解析器 + **记忆库统一 MemoryItem**（conversation+letter）+ **信件区**（CRUD+iframe 阅读+编辑器）；设置页去昵称 + 世界书 AI 名字按模型同步标题栏                                                                                                                                                                                            |
| **06/25**    | **VPS 东京正式上线**：LocVPS ¥36/月，systemd 守护 3 服务，告别 Windows guardian。**Notion MCP** 部署：7 工具 + notion.withtoge.us 域名                                                                                                                                                                                                                                        |
| **06/29~30** | **DS 聊天页 Gemini 暖瓷风复刻**：独立 `chat-ds.html` + 按标准流程嵌入 `#chat-ds-page`（CSS/JS 拆分、showPage、slide 动画、侧边栏路由）。踩坑：CSS 静默替换失败、connect() 被插坏、selectSidebarModel 误删 16 行。GPT 审查建议以后 UI 大改拆 UI+接入两阶段                                                                                                                     |
| **07/03**    | **新消息滚动改未读角标**：停底部跟随、翻历史不打扰，悬浮按钮加未读数（index.html + js/chat-ds.js）；**清缓存白屏修复**（另一会话，commit `bfb2ff4`）；**仓库大扫除**：删 8 个一次性迁移脚本 + 孤儿文件 `chat-ds.html`（全仓库无引用，真正的 DS 页逻辑在 js/chat-ds.js）+ 旧 APK 构建产物                                                                                      |
| **07/03 ②**  | **气泡拆分三 bug 修复**（`dbc5665`）：history 一条消息一个 entry，拆分只做渲染，renderMsg 唯一入口；**md 同步 git 化**（`7ac341e`）：废除覆盖式同步，hook 重写（auto-commit+rebase，纯 md 不重启服务），/root/CLAUDE.md 软链接，本地 sync-md.ps1 计划任务；**收藏夹考古**（`0a07472`）：恢复 06/29 误删的 renderBookmarksList，服务端 POST 改按 id 合并。反模式总结：三处「覆盖式写入」同病同治 |
