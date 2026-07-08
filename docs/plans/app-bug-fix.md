# withtoge APP 端 Bug 修复计划 v2

> 诊断日期：2026-07-01 | VPS 运行正常 | 前端可热更新（无需重打包 APK）

---

## 诊断摘要（修正）

问题的根因需要区分：

- **问题 2**（session 不同步）：确实由 VPS 迁移直接导致 — VPS 工作区 `/root` ≠ 本地 `C:\Users\youzi`，两个独立的 Claude Code 实例。
- **问题 1 & 3**（断连不回 / 记录消失）：是**原本就存在的设计缺陷，被远程部署的高延迟和断网概率放大暴露了**。代码里已经有重连和 sync 的框架，但有几个精确的 bug 点导致它们在关键路径上失效。

| # | 问题 | 实际根因（读代码后修正） | 严重度 |
|---|------|------|--------|
| 1 | 聊着聊着不回消息 | 重连机制**存在**，但 Android 后台挂起时 JS 定时器冻结 → Cloudflare 100s 超时断连 → 回到前台后 `syncHistoryFromServer` 因 `initHistoryDone` 条件未满足而跳过 → 用户发新消息触发重连才恢复 | 🔴 高 |
| 2 | APP session IDE 看不到 | VPS `/root` vs 本地 `C:\Users\youzi`，两个 Claude Code 实例无同步机制 | 🟡 中 |
| 3 | 聊天记录消失 | WS sync 只发 `from === "ke"` 的消息；`webView.clearCache(true)` 清空 localStorage；冷启动时 `syncHistoryFromServer` 不被调用 | 🔴 高 |

---

## 部署方式确认

- **前端 HTML/JS**：`/opt/withtoge/src/adapters/channel/direct/client/index.html`，由 ws-server 动态读取返回 → **热更新**，改完 push VPS + 重启即可，无需 APK 重打包
- **Android Java**：`MainActivity.java` 改完需要**重新构建 APK**。本次只有删一行 `clearCache`，影响范围小
- **服务端 JS**：`ws-server.js` / `message-store.js`，热更新

**→ 本次修复 90% 的工作可以热更新立即生效。**

---

## 修复计划

### 🔴 P0-1：消息恢复路径修复（问题 3 — 先修这个，因为它是数据完整性的基础）

**涉及代码位置**（已验证）：

| 组件 | 文件 | 关键行 |
|------|------|--------|
| 前端 init | `client/index.html` | `initHistory()` 只读 localStorage，不调服务端 |
| 前端 sync | `client/index.html:2166` | `syncHistoryFromServer()` 已完善，有去重逻辑 |
| 前端 connect | `client/index.html:2844` | `onopen` 只在 `initHistoryDone` 为 true 时调 sync |
| 服务端 sync | `ws-server.js:983` | `filter(m => m.from === "ke")` — **只发克的，不发用户的** |
| 服务端 API | `ws-server.js` | `/api/messages?days=7&model=...` 已存在，返回双方完整消息 |
| 存储层 | `message-store.js` | 每条消息有 `id`、`globalId`、`timestamp`，可直接用作去重 key |

**修复项**：

- [x] **A1**（2026-07-05 复查后改为：删除死代码）`ws-server.js` 里那段"WS 建连后 600ms 主动 push `type:"sync"` 消息"的 catch-up 逻辑，前端 `switch(msg.type)` 里根本没有对应的 `case "sync"` handler——是完全不生效的死代码，已直接删除。真正负责补全的是 `syncHistoryFromServer()`（走 HTTP `/api/messages`），这条路径本来就不按 from 过滤，双方消息都会拉，不需要改。

- [x] **A2**（已存在，代码比本计划文档更新）`client/index.html` `onopen` 回调里的 `if (initHistoryDone) syncHistoryFromServer();` 已经在跑；`initHistoryDone` 在应用生命周期内只会置 true 一次，之后重连都会正常触发 sync。

- [x] **A3**（已存在）`initHistory()` 末尾已经无条件调用 `syncHistoryFromServer()`（不是 setTimeout 版本，是直接调用），冷启动会拉服务端补全。

- [x] **A4**（已取消 — 2026-07-08 审视决定不做）globalSeq 增量序号。理由：当前去重已有三种 key（globalId → id → timestamp+text），覆盖现有场景绰绰有余；toge 一个人用，不是多用户高并发系统；sync 每次拉最近 7 天全量，增量拉取没有实际收益。这是 GPT review 站在"通用消息系统"视角提的，不是站在"toge 的 APP"提的。
  ```js
  // 每条消息存储时自动附加 globalSeq
  { ..., globalSeq: nextSeq++ }
  // /api/messages 支持 ?after=seq 增量查询
  ```

- [x] **A5**（已取消 — 随 A4 一起砍）去重 key 明确。当前 `msgDedupKeys()` 已实现三种 key（globalId / id / timestamp+from+text），完全够用，不需要第四种。

---

### 🔴 P0-2：WebSocket 连接稳定性（问题 1）

**现有代码已有**：
- `scheduleReconnect()` — 指数退避 1s→30s ✅
- 应用层 `ping` 每 30s ✅
- `onclose` 触发重连 ✅
- `statusText` 显示"重连中" ✅

**缺失的关键路径**：

- [x] **B1**（2026-07-05 已实施）`visibilitychange` 里加了 WS 状态检查，前台且连接不是 OPEN 就立刻 `connect()`，不等退避计时器。这是本次"一直重连中"卡死问题的直接病灶，现在修了。

- [x] **B2**（2026-07-05 已实施）`connect()` 开头加了 `if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }`，防止 B1 的立即重连和原有的 `scheduleReconnect` 定时器打架产生二次连接。

- [x] **B3**（2026-07-05 实施后当天回滚）加了单连接约束后立刻在 VPS 日志里发现手机 APP 和电脑浏览器**互相踢线**：toge 同时用两个客户端，前提"单用户没有多端同时在线需求"是错的——新连接一来就 terminate 别的连接，被踢的那端立刻自动重连又把对方踢下去，形成秒级乒乓循环，表现为"一直反复重连/在线"。已撤销这条约束，恢复允许多端同时连接（本来 `broadcast()` 就是广播给所有 clients，多端一直是支持的）。

- [x] **B4**（2026-07-05 已实施）连接日志加了 IP / UA（`connected` 时）和存活时长（`closed` 时，`aliveSec`）。

---

### 🟡 P1：APP Session 在 IDE 可查（问题 2）

**原方案（git 同步 session 文件）已否决。** 理由：
- session 文件含完整对话内容，git push 有隐私泄漏风险
- session 是 IDE 运行时内部状态，不适合当持久化数据同步
- git diff 会产生大量噪音和 merge 冲突

**新方案：HTTP API + 本地 fetch**

- [x] **C1**（2026-07-03 已完成）VPS 加 API endpoint：`GET /api/conversations?days=7`，返回最近对话的摘要列表。实际实现比计划更完善，还有 `/api/conversations/search`、`/api/conversations/refresh`、`/api/conversations/import`。另有 `/api/sessions?days=N` 端点给 Claude Code session 用。
  ```
  [{ threadId: "e2b01a0b...", startedAt: "...", lastActivity: "...", preview: "中午了～在家吃了没？", messageCount: 45 }]
  ```

- [x] **C2**（2026-07-03 已完成）VPS 加 API endpoint：`GET /api/conversations/:id` + `/api/conversations/:id/messages/:messageId`，返回完整对话。

- [x] **C3**（2026-07-03 已完成）本地 IDE 端脚本 `~/.claude/scripts/fetch-app-sessions.js`，调 VPS `/api/sessions` → 保存 JSONL 到本地 → VSCode session 列表自动识别。支持增量更新、删除标记、manifest 管理。

---

### 🟢 P2：Android 端小修

- [x] **D1**（2026-07-08 已完成）`MainActivity.java:58`：删除 `webView.clearCache(true)`
  - 这行每次打开 APP 都清空 WebView 缓存 → localStorage 丢失 → 聊天记录空白
  - 替代方案：CSS/JS 文件 URL 带版本号 `?v=31`（已实现），更新时改版本号即可强制刷新，不需要 clearCache

- [x] **D2**（已取消 — 2026-07-08 审视决定不做）`/api/version` 版本号检查。D1 已直接删 clearCache，D2 的"优雅替代"失去存在意义。JS/CSS 已有 `?v=N` 强制刷新机制。

---

## 实施顺序（实际执行记录）

```
✅ 07-01：诊断 + 计划初稿（GPT + Claude review）
✅ 07-03：C1+C2+C3 session API + fetch-app-sessions 脚本（比计划更完善）
✅ 07-05：A1+A2+A3 sync 路径修复 + B1+B2+B4 重连稳定性（B3 单连接约束当天回滚）
✅ 07-08：审视决定砍掉 A4/A5/D2 → 删 D1 clearCache → 计划收尾
```

所有 13 项已全部处理（11 项实施 + 1 项回滚 + 2 项主动取消）。

---

## 涉及文件（修正）

| 文件 | 位置 | 改动内容 |
|------|------|------|
| `ws-server.js` | VPS `/opt/withtoge/src/adapters/channel/direct/ws-server.js` | sync 发双方消息、单连接约束、连接日志、conversation API |
| `message-store.js` | VPS `/opt/withtoge/src/adapters/channel/shared/message-store.js` | 加 `globalSeq` 自动分配、增量查询 `?after=seq` |
| `index.html` | VPS `/opt/withtoge/src/adapters/channel/direct/client/index.html` | `onopen` 无条件 sync、`initHistory` 冷启动拉服务端、visibility 前台重连、单连接保护 |
| `MainActivity.java` | VPS `/opt/withtoge/ke-apk/.../MainActivity.java:58` | 删 `webView.clearCache(true)` |

---

## review 反馈采纳情况

| 来源 | 建议 | 采纳 | 理由 |
|------|------|------|------|
| GPT | globalSeq 单调递增 | ✅ 采纳 | A4，统一消息时间轴 |
| GPT | 单连接约束 | ✅ 采纳 | B3，解决连接数波动 |
| GPT | 前端恢复状态机 | ✅ 部分 | A2+A3 已覆盖冷启动路径，不需完整状态机 |
| GPT | session ≠ message | ✅ 采纳 | 否决 git 同步方案，改用 HTTP API |
| Claude | "同一根因"措辞修正 | ✅ 采纳 | 已在诊断摘要中区分 |
| Claude | 统一对齐机制（syncId） | ✅ 采纳 | 用 globalSeq 替代时间戳判断 gap |
| Claude | 否决 git 同步 | ✅ 采纳 | 隐私风险不可接受 |
| Claude | `C:\Users\youzi` 路径错误 | ✅ 修正 | Linux 不存在此路径，已删除相关方案 |
| Claude | 去重字段提前定义 | ✅ 采纳 | A5 明确优先级 |
| Claude | 先确认部署方式 | ✅ 完成 | 已确认：前端热更新>APK |
| Claude | clearCache 替代方案 | ✅ 采纳 | 版本号机制已存在（`?v=31`），无需额外开发 |
