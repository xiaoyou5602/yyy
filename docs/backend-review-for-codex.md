# withtoge 后端架构审查文档

> 写给 Codex 审查用。涵盖文件结构、核心问题、已做努力、剩余痛点。

---

## 一、核心需求

1. **延长窗口寿命**：Claude Code session 尽可能活得久，不因模型切换、系统消息、进程崩溃而丢失上下文
2. **消灭孤儿 Session**：系统行为（checkin 问候、定时任务）不该创建"聊一句就死"的 session
3. **解决端口爆炸**：Claude Code 进程崩溃后，其 MCP 子进程（npx mcp-datetime、mcpbrowser 等）脱离父进程树，累积成数十个僵尸进程

---

## 二、后端文件结构

```
withtoge/
├── bin/cyberboss.js          # 入口，CLI 路由（start / tool-mcp-server / doctor）
├── src/
│   ├── index.js              # 主入口：加载配置 → installRuntimeErrorHooks → main()
│   ├── core/
│   │   ├── app.js            # 核心应用：消息路由、turn 调度、checkin、审批、IPC
│   │   ├── config.js         # 配置读取、模型 key 映射（ds/opus/haiku）
│   │   ├── inbound-turn.js   # 入站消息组装（拼 worldbook + memory + 附件文本）
│   │   ├── turn-gate-store.js       # Turn 互斥锁 + 3min 超时自动释放
│   │   ├── thread-state-store.js    # 线程运行状态
│   │   ├── system-message-queue-store.js  # 系统消息队列持久化
│   │   ├── system-message-dispatcher.js   # 系统消息分发
│   │   ├── deferred-system-reply-store.js # 延迟回复队列
│   │   ├── checkin-config-store.js  # Checkin 配置
│   │   ├── reminder-queue-store.js  # 提醒队列
│   │   ├── stream-delivery.js       # WebSocket 消息推送
│   │   └── command-registry.js      # 斜杠命令注册
│   ├── adapters/
│   │   ├── runtime/
│   │   │   └── claudecode/
│   │   │       ├── index.js         # Runtime adapter：多 model session 管理、sendTurn
│   │   │       ├── process-client.js # Claude Code 子进程 spawn/通信/生命周期
│   │   │       ├── events.js        # Claude 输出 → runtime event 映射
│   │   │       ├── ipc-server.js    # IPC Unix socket（桌面端直接发消息）
│   │   │       └── project-settings.js # .mcp.json 项目管理
│   │   └── channel/
│   │       └── direct/
│   │           ├── index.js         # Direct channel：消息收发、附件下载
│   │           ├── ws-server.js     # WebSocket + HTTP 服务（端口 9726）
│   │           └── client/          # 前端 SPA（聊天/日历/记忆/世界书/奶茶...）
│   ├── tools/
│   │   ├── tool-host.js             # MCP 工具注册 + 实现（50+ 工具）
│   │   ├── mcp-stdio-server.js      # MCP stdio 服务器（Claude Code 调用入口）
│   │   └── create-project-tooling.js
│   ├── services/                    # 日记/记忆/贴纸/礼物/世界书/定位
│   └── memory/
│       ├── memory-fragment-store.js # 记忆碎片存储（热度/锁定/软删除/48h保护）
│       ├── memory-service.js        # 记忆服务
│       └── consolidation-scheduler.js # 梦境整理调度
├── scripts/
│   ├── start-guardian.ps1   # 守护进程：监控端口 + cloudflared + 自动重启 + 僵尸清理
│   ├── kill-bridge.ps1      # 杀 cyberboss node 进程 + Claude 子进程
│   ├── kill-zombies.ps1     # 精准杀 MCP 僵尸（带父进程校验，不杀主服务）
│   └── normalize-sticker-gif.js
├── package.json
└── docs/iteration-log.md    # 完整迭代记录
```

关键外部文件：
- `C:\Users\youzi\.mcp.json` — 4 个 MCP 服务器配置（cyberboss_tools / native_devtools / datetime / todo_mcp）
- `C:\Users\youzi\.cyberboss\` — 运行态数据（日记/记忆/sessions/世界书）

---

## 三、核心问题链

### 问题 A：Claude Code 进程不稳定

**现象**：cyberboss 通过 `child_process.spawn("claude", args, {shell: true})` 启动 Claude Code 子进程。进程启动后几秒内崩溃，输出 `Runtime process exited unexpectedly`。

**已验证**：
- Claude CLI 单独运行完全正常（`claude --model claude-opus-4-6 --mcp-config .mcp.json -p "test"` → 200 OK）
- Claude CLI + 管道 stream-json 输入也正常
- 崩溃只发生在 cyberboss 的 `shell: true` spawn 模式下

**影响**：Claude 死了 → MCP 子进程（npx mcp-datetime、mcpbrowser 等）脱离父进程树 → 变成僵尸 → 下一次 spawn 又产生新僵尸 → 指数累积。6 月 15 日下午一次 kill-zombies 杀了 31 个僵尸进程。

### 问题 B：孤儿 Session

**根因**（已在 6/11 迭代修复）：系统 checkin 触发 `attachClientToThread()` 时无条件 `--resume`，旧 session 过期 → Claude 返回新 session → 聊一句结束 → 变成孤儿。

### 问题 C：端口爆炸 / 消息不回

**根因**（已在 6/12 迭代修复）：Claude Code 进程死了 → `TurnGateStore.pendingScopeKeys` 永远不释放 → `isTurnDispatchBlocked()` 返回 true → 所有后续消息卡在队列里。之前没有超时机制。

---

## 四、已做的努力（按时间线）

### 第一层：多模型 Session 并存（2026-06-11）

**做了什么**：
- `clientsByWorkspace`（`Map<workspace, client>`）→ `sessionsByWorkspace`（`Map<workspace, Map<modelKey, entry>>`）
- `ensureClient` 只查同 model，不杀其他 model
- `attachClientToThread` 加 `allowSpawn` 参数：系统消息 `false` → 不创建新 session
- session store 用 model 维度 runtimeId：`"claudecode:ds"` / `"claudecode:opus"` / `"claudecode:haiku"`

**解决了**：
- ✅ 切模型不杀旧 session
- ✅ 系统 checkin 不创建孤儿 session（无活跃 session 时跳过）

**没解决的**：
- ❌ Claude 进程本身还是不稳定
- ❌ MCP 僵尸还是会累积

### 第二层：Turn Gate 超时 + 僵尸清理（2026-06-12）

**做了什么**：
- `TurnGateStore` 重写：`Set<scopeKey>` → `Map<scopeKey, timestamp>` + 3 分钟超时自动释放
- `process-client.js` alive getter 改为检查真实进程状态（`child.exitCode` / `child.killed`）
- `index.js` 8 处 alive 检查从单层改为双层（`entry.alive && entry.client?.alive`）
- `kill-zombies.ps1` 完善：杀进程树 + guardian 匹配 + 路径分隔符

**解决了**：
- ✅ Turn Gate 不会永久锁死（3 分钟自动释放）
- ✅ 僵尸可以被定时清理

**没解决的**：
- ❌ 僵尸来源没追溯（MCP server spawn 机制没改）
- ❌ Claude 进程还是崩，崩了就产生新僵尸

### 第三层：MCP 僵尸精准清理（2026-06-15 凌晨）

**做了什么**：
- `kill-zombies.ps1` 重写：
  - 去掉 2 小时年龄限制（僵尸几分钟就产生）
  - 扩展匹配模式：加 `tool-mcp-server` / `native-devtools-mcp` / `gtd-tasks`
  - 加父进程 PID 校验：只杀孤儿（parent != 主 cyberboss），保护合法 MCP 服务器
  - Guardian 集成：每 10 分钟 + 每次重启前自动运行

**解决了**：
- ✅ 不再误杀 cyberboss 自己的 MCP 服务器
- ✅ 僵尸自动清理完全自动化

**没解决的**：
- ❌ 僵尸产生的根本原因（Claude spawn 崩溃）仍然存在

### 第四层：Guardian 完善 + Cloudflared 监控（2026-06-15）

**做了什么**：
- `start-guardian.ps1` 新增 cloudflared 监控：入口/每 30s/重启前三层检查
- `index.js` uncaughtException handler 加 `process.exit(1)`（原来只设 exitCode）
- 僵尸清理集成进 guardian 监控循环（每 10 分钟）

**解决了**：
- ✅ Cloudflared 隧道崩溃自动恢复
- ✅ 全局异常后进程真正退出（而非僵尸状态）

### 其他已做修复

| 日期 | 修复 | 状态 |
|------|------|------|
| 06-11 | IPC 桌面端直接发消息 + 审批弹窗 WebSocket 推送 | ✅ |
| 06-11 | 手札接力（ke-handoff.md）：换 session 时无缝接力 | ✅ 缓解但不能根治 |
| 06-12 | PID 锁残留：guardian 清理 `logs/running.pid` | ✅ |
| 06-15 | 启动 bat 修了 `npm start` → guardian 脚本 | ✅ |
| 06-15 | cloudflared bat 修了隧道名 → `--config` 参数 | ✅ |

---

## 五、当前防御体系（分层示意）

```
┌─────────────────────────────────────────────┐
│ 第一层：Guardian 守护                        │
│ - 每 10s 检查端口 9726                       │
│ - 每 30s 检查 cloudflared 进程               │
│ - 每 10min 运行 kill-zombies                 │
│ - 崩溃自动重启（带退避）                      │
├─────────────────────────────────────────────┤
│ 第二层：Turn Gate 超时                        │
│ - 3 分钟自动释放锁死的 gate                   │
│ - 防止一条消息卡死阻塞全部后续消息             │
├─────────────────────────────────────────────┤
│ 第三层：双重 alive 检查                       │
│ - entry.alive（业务层）                       │
│ - client.alive（OS 进程真实状态）              │
│ - 8 处关键路径全覆盖                          │
├─────────────────────────────────────────────┤
│ 第四层：allowSpawn 门禁                       │
│ - 用户消息：allowSpawn=true → 正常创建        │
│ - 系统消息：allowSpawn=false → 不创建孤儿      │
├─────────────────────────────────────────────┤
│ 第五层：kill-zombies 定时清理                  │
│ - 父进程校验：只杀孤儿，不杀合法 MCP            │
│ - 杀整棵进程树（taskkill /F /T）              │
│ - Guardian 每 10min + 重启前自动跑            │
└─────────────────────────────────────────────┘
```

---

## 六、仍存在的问题

### 1. Claude Code spawn 崩溃（当前最紧急）⚠️

**现象**：cyberboss 通过 `child_process.spawn(claude, args, {shell: true, windowsHide: true})` 启动 Claude → 几秒后进程崩溃 → 5 个 MCP 子进程变僵尸 → kill-zombies 杀 → 下轮 spawn 又崩 → 循环。

**已排除**：
- Claude CLI 本身正常（手动跑 `claude --mcp-config .mcp.json -p test` 完全 OK）
- 不是模型问题（DeepSeek 和 Opus 都崩）
- 不是 MCP 配置问题（4 个 MCP 服务器手动跑都能连上）

**怀疑方向**：
- `shell: true` + `windowsHide: true` 的组合在 Windows 上可能导致问题
- CLAUDE.md / 系统指令的内容可能触发 Claude 内部错误
- `--resume` 参数与过期 session ID 的组合

### 2. 系统消息死循环重试

`flushPendingSystemMessages` 失败就 requeue，没有最大重试次数。如果所有 dispatch 持续失败，消息永久留在队列里。

### 3. 启动恢复静默失败

`restoreBoundThreadSubscriptions` 所有 resume 调用失败也无声无息（`.catch(() => {})`）。

### 4. 延迟回复无限堆积

`DeferredSystemReplyStore` 没有 TTL 或最大条数限制。

---

## 七、关键文件路径速查

| 文件 | 说明 |
|------|------|
| `src/core/app.js` | 核心调度：消息路由（491-501 阻塞检查）、turn 派发（504-573）、turn 完成处理（1607-1675） |
| `src/adapters/runtime/claudecode/index.js` | Session 管理：`ensureClient`（91-130）、`attachClientToThread`（132-175）、`sendTurn`（376-450） |
| `src/adapters/runtime/claudecode/process-client.js` | Claude spawn：`connect`（57-128）、`buildArgs`（423-455）、alive getter（31-37） |
| `src/core/turn-gate-store.js` | Gate 互斥锁：`isPending`（超时检查）、`begin`/`releaseScope`/`releaseThread` |
| `scripts/start-guardian.ps1` | 守护进程：端口监控 + cloudflared 监控 + 僵尸清理 + 重启退避 |
| `scripts/kill-zombies.ps1` | 僵尸清理：父进程校验 + 进程树杀 + guardian/主服务保护 |
| `scripts/kill-bridge.ps1` | 杀 cyberboss node 进程 + Claude 子进程追踪文件 |
| `C:\Users\youzi\.mcp.json` | MCP 服务器配置（4 个 server） |
