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

> ⚠️ **硬规则**：读到"更新迭代日志"或"更新 withtoge"时，更新完对应文件后必须扫一遍本清单，把本次已完成的划掉（`[ ]` → `[x]`）。不要只更新迭代日志忘了待办。

### APP 端

- [ ] 调参台完善 — 待验证。所有页面独立微调，点击遮罩关闭，scrollbar 可见。
- [ ] 日历页去"记忆"跳转 — 删除日历页面的"记忆"跳转入口，计划栏放最底层，确认日历组件是否拆好
- [x] 新消息自动滚到底端 — **已改需求**：不再无条件强制滚动。改为：停在底部时新消息跟随滚动；往上翻看历史时新消息不打断阅读，改为在悬浮按钮上显示未读角标数字，点击才跳到底部并清零。index.html（5 个模型 zone）+ js/chat-ds.js（真正跑在 APP 里的 DS 主聊天页逻辑）均已改。踩坑：一开始改错了孤儿文件 `chat-ds.html`（全仓库无引用，已删），后来才找到真正被 index.html 引入的 js/chat-ds.js 补上
- [x] 气泡拆分多 bug — **已修已验证**（07-03 commit dbc5665，已部署 VPS，07-03 夜间代码审查通过）。根因：①`const merged` 重赋值 TypeError 导致整页历史不渲染；② 本地存逐 chunk、服务端存整条，dedup 吃掉带 globalId 的末 chunk 导致双份并存；③`/api/messages` 的 thinking 条目被当普通气泡渲染。修法：history 一条逻辑消息一个 entry（text+chunks），拆分只做渲染，renderMsg 唯一入口。代码审查：merged 变量、localChunkGids 过滤、renderMsg 三路分支、thinking turnId dedup 均正确。APP 端 toge 可再打开验证一下实际效果
- [ ] 通知延迟+页内弹出+掉线显示在线 — 待验证。APK v13：heartbeat 桥防页内重复弹、setOnlineStatus 同步前台通知状态、轮询 120s→60s
- [x] APP 加强制刷新键 — **已修（07-03 夜间自动任务）**。在 header-right 加↺刷新图标按钮，点击调用 `syncHistoryFromServer()` 重拉服务端历史，带 360° 旋转动画反馈
- [x] 清缓存后气泡全空 — **已修（07-03 commit bfb2ff4，已部署 VPS，浏览器模拟清缓存验证通过：358 条历史自动拉回）**。根因：loadModels（含空 model 回填默认值的兜底）和 initHistory 并行竞态，initHistory 抢跑时带空 `?model=` 拉服务端被过滤成空数组 → 白屏。修法：initHistory `await modelsReady`。APP 端 toge 再验证一次即可归档
- [ ] Opus 页显示思考摘要 — Claude API 的 thinking 支持 `display: "summarized"` 返回思考摘要（原始 COT 任何客户端都拿不到，摘要是上限）。`direct-api-client.js` 请求加 `thinking: {type: "adaptive", display: "summarized"}`，流式收 thinking_delta，接到 APP 已有的思考显示链路（计时器+折叠块）。注意：adaptive thinking 时 temperature/top_p 等采样参数要移除，否则 400
- [x] 收藏不同步+收藏夹内容丢失 — **已修，toge 验收通过（07-03 commit 0a07472）**。真相：数据没丢（服务端 3 条完好），是 06/29 thinking 重构误删了 `renderBookmarksList()`，收藏夹页一开就 ReferenceError 空白。已恢复函数 + 修 jumpToConversation 异步误用 + 服务端 POST 改按 id 合并防覆盖。toge 打开收藏夹页看到 3 条旧收藏即验证通过
- [x] 小手机日历组件今日不加亮（07-03 toge 报）— **已修（07-03 夜间自动任务）**。根因：`renderCalWidget` 第一行（前 `7-off` 天）循环没有 `today` 判断，7 月 3 日恰在第一周所以不亮。修法：第一行循环也加 `d === today` 检查，与后续行保持一致
- [x] 小手机备忘录不持久化（07-03 toge 报）— **已修（07-03 夜间自动任务）**。根因：`phAddTodo`/`phToggleTodo`/edit/delete 均无 localStorage 读写。修法：加 `saveTodos()`/`loadTodos()` 函数（存 `withtoge-ph-todo`），phInit 时加载，增删改查后均保存

### 后端 / 服务

- [ ] 本地 MCP diary_append 写错日记本（07-03 发现）— 本地 cyberboss_tools MCP 的 `cyberboss_diary_append` 写的是本地 `~/.cyberboss/diary/`，但共享日记（APP 读的那本）在 VPS `/root/.cyberboss/diary/`，两本分裂。修法：本地 MCP server 的 diary 工具改为 ssh/API 写 VPS，或本地 diary 目录做定时同步归并。修好前 IDE 端写日记走 scp+cat 追加（见 memory diary-daily）
- [ ] session 重启自动接续上下文（07-03 toge 报）— DS 的 claudecode session 重启后是全新上下文，聊着聊着"突然换人"很割裂。已有"手札接力"机制（06/11 做过跨 session 接力），排查它是否失效/未自动触发；目标：新 session 启动时自动注入最近对话摘要 + 当天日记/时间轴要点，让克"记得刚才聊到哪"
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
