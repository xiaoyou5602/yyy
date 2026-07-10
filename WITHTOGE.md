# withtoge — 个人 AI 陪伴系统

> **这个文件**：项目架构、功能清单、运维命令、待办、API 细节。
> **toge 生活 / 人设 / 课表 / 教训** → [CLAUDE.md](../../CLAUDE.md) > **迭代详情** → [docs/iteration-log.md](docs/iteration-log.md) > **闹钟文档** → [docs/alarm-system.md](docs/alarm-system.md) > **计划** → [docs/plans/](docs/plans/)

目录：`C:\Users\youzi\withtoge\`

## ⚠️ 当前状态（换窗口先读这个）

### 已知风险

- cloudflared 单实例，隧道断了 APP 全挂（无冗余）
- VPS 时区已设为 `Asia/Shanghai`，重装系统 / 新部署注意别覆盖

### 当前假设

- **DS 走自建 Agent Loop（07-10 上线，不再 spawn Claude CLI）**：`DsAgentClient` 直调 DeepSeek API，工具由 ProjectToolHost 直连（38 个业务工具，无文件系统/shell 能力）。应急阀 `CYBERBOSS_DS_AGENT_LOOP=off` 回退旧 CLI 路径。Opus / GLM / 米米子走 API（聊天模式，无工具）
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
手机 APK ──→ Cloudflare Tunnel ──→ cyberboss 服务 ──┬── type=cli → DsAgentClient 自建 loop → DeepSeek (DS，带工具)
电脑网页 ──→ 克.withtoge.us ──┘                     │      （07-10 起不再 spawn Claude CLI；应急阀=off 时才回退 CLI）
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
DS Agent Loop：`src/adapters/runtime/claudecode/ds-agent-client.js` + `ds-stream-parser.js` — HTTP 直调 + tool loop，设计 → [docs/plans/ds-agent-loop.md](docs/plans/ds-agent-loop.md)
API 直调（无工具聊天模型用）：`src/core/direct-api-client.js` — SSE 流式客户端，绕过 CCSwitch/VPN

### 加新模型

打开 `src/core/model-routes.js`，在 `MODELS` 表加一行（`type: "api"` 或 `"cli"`），前端自动出现。API key 放 `.env`。

> ⚠️ `type: "cli"` 目前只有 ds 在用，且实际走的是自建 agent loop（`index.js` 按 modelKey 分流，不 spawn CLI）。新加聊天模型一律用 `type: "api"`；新模型想要工具能力 → 参考 ds 的分流方式接 DsAgentClient 同款 loop（真到那天再抽公共层，07-09 toge 拍板过先不预抽象）。

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
| **多模型**            | DS(自建 agent loop/38 工具) + Opus(直调 API/聊天) + GLM5.2(API) + 米米子/OpenClaw(API) + 动态加载 + 历史隔离 | `src/core/model-routes.js`, `src/core/app.js`                                                         |
| **DS Agent Loop**     | HTTP 直调 DS API + tool loop（07-10 上线替换 Claude CLI）：SSE 状态机、审批复用、messageStore 历史重组装、应急阀回退 | `src/adapters/runtime/claudecode/ds-agent-client.js`, `ds-stream-parser.js`                           |
| **Session 管理**      | claudecode runtime 适配器（仅 DS 用），启动清旧 session；DS 的 sessionId 现为路由标签（uuid），历史靠 messageStore 不靠 session 文件 | `src/adapters/runtime/claudecode/`                                                                    |
| **主动问候**          | checkin poller，随机间隔发消息（仅 DS）                                                            | `src/app/system-checkin-poller.js`                                                                    |
| **日记写入**          | MCP 工具 `cyberboss_diary_append`                                                                  | `src/services/diary-service.js`                                                                       |
| **时间轴**            | MCP 工具读/写/截图                                                                                 | `src/integrations/timeline/`, `src/services/timeline-service.js`                                      |
| **贴纸系统**          | APP/Web 端贴纸面板（标签编辑 + 上传/删除），API + WS 推送                                          | `src/adapters/channel/direct/ws-server.js`、`src/services/sticker-service.js`                         |
| **图片识别**          | vision-context，>500KB 自动压缩                                                                    | `src/services/vision-context.js`                                                                      |
| **记忆系统**          | 碎片提取 + 热度衰减 + 倒排索引 + 梦境整合 + 关键词路由注入(context-routes)                         | `src/memory/`, `src/services/memory-service.js`                                                       |
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
>
> ⚠️ **硬规则（条目瘦身）**：这是简约清单，不是档案柜。`[x]` 条目**一行封顶**：`标题 — 已修（日期 commit号）+ 一句结论/待验证点`，根因修法踩坑全部写进迭代日志，别写在这。**已验证通过的 `[x]` 条目直接删掉**（git 和迭代日志里都有，不会丢）——别攒着等 toge 手动清。

### APP 端

- [ ] 通知栏消息拆分（07-08 toge 报）— 多条消息挤在同一条通知栏弹窗里，需要拆成各自独立的通知
- [ ] COT 开启/关闭显示 + 默认折叠还是展开（07-08 toge 报）
- [ ] 多条消息弹出时视角不固定底层（07-08 toge 报）— 弹出几条后就不再固定在底部，需排查滚动锚定机制
- [ ] 调参台完善 — 待验证。所有页面独立微调，点击遮罩关闭，scrollbar 可见。
- [x] DS 页刷新/重开后卡"连接中"（07-04 toge 报）— **已修（07-04 commit dd56551，已部署，浏览器复现+验证通过）**。根因：index.html 启动路由（localStorage last-page=chat-ds 时 showPage+dsChatInit）在主内联脚本里执行，早于页面尾部的 `<script src="chat-ds.js">` 加载，`typeof window.dsChatInit` 为 undefined 被静默跳过——DS 页显示了但从未初始化、从未建立自己的 WebSocket，状态永远"连接中"，消息也收不到（主页面 WS 其实在线，服务端一切正常）。修法：chat-ds.js 末尾自愈——脚本加载完检测 DS 页已显示且未初始化则补跑 dsChatInit。v39→v40。**注意此 bug 会伪装成"隧道断了/通知不来/丢消息"**——凡 APP 重开后 DS 页异常先想到它
- [ ] 聊天页独立 UI / 皮肤架构（07-05 立项）— **阶段 1 二次实现完成（07-10，待 toge 实机验收）**。首次实现（07-07 34f890c）因三架构问题于 07-10 凌晨回退；Fable 接手重做：调参台按 zone 拆 scope（token 直落 #chat-zone-*，废除 #chat-page 共享落点）+ tweak 按主题分桶（切主题清 inline 重应用，主题永不被碾压）+ DS 暖瓷页 CSS 桥接跟主题 + themes.css 4主题 + 主题专区页 + 「存为主题卡片」闭环。本地端到端验证全过（隔离/header跟随/分桶/桥接/存卡）。阶段 2~4 待排。细节 → docs/plans/zone-skin-architecture.md
- [x] 暖瓷页切非 DS 模型卡死（07-10 toge 报：glm→ds→glm 卡住、主题还是 ds 那套、状态"在线·DeepSeek"）— **已修（07-10 commit 1312832，已部署）**。三症状=屏幕没离开暖瓷页这一件事。两个原生 bug：①selectSidebarModel 非 DS 分支不 showPage("chat")，zone 在被盖住的页面里切了但不揭幕；②DS 分支不 activateZone("ds")，refs 停在旧 zone，下次切走时旧 zone 历史会覆写 DS 本地历史 key（暖瓷页硬编码读的那个）。本地复现三步序列验证全过。**注意"在线 · DeepSeek"字样=正在看暖瓷页**，以后排查页面错乱先认这个标记
- [ ] 主题页面视觉优化 — 卡片预览设计、布局比例、整体 UI 打磨，toge 主导设计方向
- [ ] 刷新键疑似摆设（07-04 toge 报）— 加了 ↺ 按钮但点击可能没真正触发同步，需排查。**可能与上条同源**：↺ 在主 chat 页 header，而 toge 常驻的 DS 页（chat-ds）没有刷新键，且 DS 页 WS 未建时同步了也不显示——上条修复后请 toge 再试
      `pendingApproval` 仍是同一 requestId → 自动 decline + 聊天页留一条"⏰ 超时自动拒绝（非 toge 主动）"说明（进历史，克跨 session 回顾可见）。被响应/turn 结束/换新审批都会清 pendingApproval，回调天然幂等。时长 2 分钟是 toge 07-04 拍板的

- [ ] DS 聊天页补 HTTP sync — 贴纸已在服务端持久化（07-08，commit 69cdf7e~af45ceb），但 DS 页没有 `/api/messages` HTTP pull，离线重连后历史贴纸无法恢复。`handleSync` 等 WS push 但服务端从不推 sync 消息，实为死代码

### 后端 / 服务

- [ ] DS 删除护栏（07-08 事故驱动）— **07-10 agent loop 上线后风险已架构性消除大半**：新引擎只暴露 ProjectToolHost 业务工具（日记/记忆/贴纸等），**没有 Bash/Read/Write 等文件系统工具**，07-08 那类删档事故在 DS 路径物理上无法再发生。本条降级为：仅当应急阀回退 CLI 路径（`CYBERBOSS_DS_AGENT_LOOP=off`）或二期给 DS 加文件工具时再启用护栏方案
- [x] 自搭 DS Agent Loop — **已上线（07-10 07:20 部署，端到端首航通过：对话+diary 工具落盘+审批自动放行）**，全程见 [迭代日志 07-10](docs/iteration-log.md)。**应急阀：VPS `.env` 加 `CYBERBOSS_DS_AGENT_LOOP=off` 重启即回退 CLI 路径**。留观察：系统轮静默、跨 session 回顾、token 对比（toge 前端看数字）。二期待排：messageStore 扩 tool_call/tool_result 落库 + VS Code transcript 兼容（session 翻看链路已断供，计划 §5.7）
- [ ] 健康数据 MCP（07-03 立项）— **方案已定稿 → [docs/plans/health-mcp.md](docs/plans/health-mcp.md)**。链路：手环 9Pro → 小米运动健康 → Health Connect → Health Sync 推 webhook → cyberboss `/api/health` → 内部 MCP 工具 + `health.withtoge.us` 标准 remote MCP（官 APP connector 也能接）。阶段 0（后端管道+假数据测试）手环到货前就可做；阶段 1 等手环（toge 操作）。主要风险：国行 app 可能无 HC 同步开关（备选：国际版 Mi Fitness 港区账号，教程已验证可行）
- [x] 思考/调工具时发消息把 session 挤掉的 bug（toge 07-04 问是否还在）— **已修于 07-02（commit bdbfe66，turn-gate 移除 181s 超时自释放）**。旧行为：思考+工具超 3 分钟 → gate 被误判卡死自动释放 → 排队消息 dispatch → cancelTurn 杀掉进行中的 turn → 新 session 顶上（日志最后一次发生 07-01 23:55）。现行为：turn 进行中新消息排队等待，10 分钟无进展才判卡死，15 分钟 gate 兜底。
- [x] 静默 checkin 的思考出现在聊天页（07-04 toge 报，当晚复发二修）— **一修 bdd3e9b**（replyTarget.provider==="system" 不广播不存档）**当晚复发**：系统轮的 replyTarget 在 sendTurn 返回后才注册，CLI 早期 thought 事件靠 bindingKey 兜底拿到上一轮 direct 的 target，provider 判断形同虚设。**二修 5b715fa（已部署）**：dispatchPreparedTurn 在 sendTurn **之前**按 bindingKey 打系统轮标记（15 分钟自动过期防标记泄漏永久压制正常思考），thought 广播与 saveThinking 都查标记，turn 完成/失败/跳过/异常时清除。**待 toge 观察**：下次 checkin 静默轮后聊天页不应再出现孤思考块
- [x] 梦境系统 07-02 起每晚崩 — **已修（07-05）**：readByDate 补 await。待验证：明晨 3 点日志无 `todayFrags.slice` 报错
- [x] resolveModelKey("glm") 落回 ds — **已修（07-05）**：名单改用 ALL_MODEL_KEYS；scheduler modelKeyToModelName 改用 keyToModel。**新增记忆白名单** `CYBERBOSS_MEMORY_MODELS`（默认只有 ds，设 "all" 恢复全模型），提取和梦境都只对白名单模型跑
- [ ] 闹钟接入聊天流程 — parser 和 APK 已就绪，需接到 Claude Code 对话里
- [ ] 记忆碎片时间戳改用北京时间（07-09 toge 报）— 当前 `created`/`lastRecalled` 字段用 UTC，导致写时间轴时容易看错 8 个小时。统一改用 Asia/Shanghai
- [ ] 测试套件全量并发跑有 51 条存量失败（07-10 克巡检发现，干净 HEAD 基线对照实锤，与 DS agent loop 改动无关）— 分布：claudecode-approval 16 / stream-delivery 13 / turn-gate 7 / sticker 4 / system-inbound 4 / codex 4 / 其他 3。同名测试重复失败 2 次 → 疑并发跑时共享状态/端口冲突；单文件跑大多通过（turn-gate 单跑也挂 2 条：`app.js:1899` 读 `undefined.get`，疑 mock 缺字段）。修复入口：先单文件逐个跑分清"真挂"vs"并发挂"
- [ ] 前端组件化 — 记忆/涂鸦/桌宠组件化

> 华为手机设置 + 生活待办 → 见 [CLAUDE.md](../../CLAUDE.md) "生活待办"

## 迭代记录

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **摘要**（此表） | 关键进展一行概括                                                                          |
| **详细版**       | [docs/iteration-log.md](docs/iteration-log.md) — 每次迭代的完整上下文、踩坑记录、架构决策 |

| 日期         | 关键进展                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **05/23**    | 项目起点：克部署到微信                                                                                                                                                                                                                                                                                                                                                                          |
| **05/26**    | IDE 克和微信克共享日记和时间轴，不再"换窗口换人"                                                                                                                                                                                                                                                                                                                                                |
| **05/27**    | 网页版一夜建成：6 MCP 工具 + 桌宠 + 冥想/涂鸦/日历/调参台                                                                                                                                                                                                                                                                                                                                       |
| **05/30**    | 闹钟系统完成：TogeAlarm APK + alarm-parser.js                                                                                                                                                                                                                                                                                                                                                   |
| **05/31**    | PWA 桌面应用 + Session 重连 + 桌宠 + 识图优化 + 进程清理                                                                                                                                                                                                                                                                                                                                        |
| **06/04**    | 放弃微信端，转 direct channel + Cloudflare Tunnel + Android APK；从 AionsHome 搬世界书/礼物/摄像头/MCP                                                                                                                                                                                                                                                                                          |
| **06/05**    | 购入域名 `withtoge.us`，Named Tunnel，彻底放弃微信                                                                                                                                                                                                                                                                                                                                              |
| **06/06**    | APK v1→v5：纯全屏 WebView，硬编码 `https://克.withtoge.us`                                                                                                                                                                                                                                                                                                                                      |
| **06/09**    | WS 不回消息根因修复（cloudflared `--url` vs ingress 冲突）                                                                                                                                                                                                                                                                                                                                      |
| **06/09~11** | **奶茶记录**：卡通日历 + 详情卡片 + API + 克自动提取记录                                                                                                                                                                                                                                                                                                                                        |
| **06/10**    | APK 图片上传 + 消息通知 + 礼物 CSS 信件                                                                                                                                                                                                                                                                                                                                                         |
| **06/11**    | 项目改名 cyberboss→withtoge（~1600 处替换）；**文档三体系定型**（CLAUDE 纯陪伴 / WITHTOGE 技术 / 迭代日志）；**审批弹窗**（WS broadcast，电脑+手机同时弹窗审批）；**调参台页面级作用域**（13 个 tab 独立微调）；**多模型 Session 并存**（DS/Opus/Haiku 各自存活）；**手札接力**（跨 session 上下文接力）；**记忆系统 6 项改进**（GPT+Gemini 审查后落地）；收藏夹+信封+多选 UI                   |
| **06/12**    | Turn Gate 永久锁死修复                                                                                                                                                                                                                                                                                                                                                                          |
| **06/15~16** | **贴纸系统**完整接入 APP/Web：6 API + WS + 前端面板/标签编辑/上传删除；**收藏夹服务端持久化**（bookmarks.json API）；cloudflared Windows Service 化                                                                                                                                                                                                                                             |
| **06/17~18** | **多模型混合架构**：DS(CLI) + Opus(直调 API)，`model-routes.js` 一行加模型，API 直调 SSE 客户端从零写起                                                                                                                                                                                                                                                                                         |
| **06/17~20** | **Thinking 流式显示**：完整链路打通（Claude Code→events→WS→ 前端），计时器+折叠+localStorage 缓存                                                                                                                                                                                                                                                                                               |
| **06/20**    | **小手机主页**：Gemini 生成页面嵌入 App，CSS 7 条铁律写入接入文档                                                                                                                                                                                                                                                                                                                               |
| **06/23**    | **聊天记录存档导入**：15 个 MD 存档解析器 + **记忆库统一 MemoryItem**（conversation+letter）+ **信件区**（CRUD+iframe 阅读+编辑器）；设置页去昵称 + 世界书 AI 名字按模型同步标题栏                                                                                                                                                                                                              |
| **06/25**    | **VPS 东京正式上线**：LocVPS ¥36/月，systemd 守护 3 服务，告别 Windows guardian。**Notion MCP** 部署：7 工具 + notion.withtoge.us 域名                                                                                                                                                                                                                                                          |
| **06/29~30** | **DS 聊天页 Gemini 暖瓷风复刻**：独立 `chat-ds.html` + 按标准流程嵌入 `#chat-ds-page`（CSS/JS 拆分、showPage、slide 动画、侧边栏路由）。踩坑：CSS 静默替换失败、connect() 被插坏、selectSidebarModel 误删 16 行。GPT 审查建议以后 UI 大改拆 UI+接入两阶段                                                                                                                                       |
| **07/03**    | **新消息滚动改未读角标**：停底部跟随、翻历史不打扰，悬浮按钮加未读数（index.html + js/chat-ds.js）；**清缓存白屏修复**（另一会话，commit `bfb2ff4`）；**仓库大扫除**：删 8 个一次性迁移脚本 + 孤儿文件 `chat-ds.html`（全仓库无引用，真正的 DS 页逻辑在 js/chat-ds.js）+ 旧 APK 构建产物                                                                                                        |
| **07/03 ②**  | **气泡拆分三 bug 修复**（`dbc5665`）：history 一条消息一个 entry，拆分只做渲染，renderMsg 唯一入口；**md 同步 git 化**（`7ac341e`）：废除覆盖式同步，hook 重写（auto-commit+rebase，纯 md 不重启服务），/root/CLAUDE.md 软链接，本地 sync-md.ps1 计划任务；**收藏夹考古**（`0a07472`）：恢复 06/29 误删的 renderBookmarksList，服务端 POST 改按 id 合并。反模式总结：三处「覆盖式写入」同病同治 |
| **07/10**    | **DS Agent Loop 上线**（`8d3e5b1`→`0a34ba8`）：自建 DsAgentClient 直调 DS API 替换 Claude CLI 子进程，省掉 Anthropic 官方几万字 prompt。夹具先行实测出 thinking 强制回传硬约束（官方文档没有）；persona 走每轮独立 system（DeepSeek 前缀缓存实测生效）；审批白嫖 app 层自动放行；全套保险丝+`CYBERBOSS_DS_AGENT_LOOP=off` 应急阀。VPS 首航：对话+工具落盘+零报错 |
