# Plan：自搭 DS Agent Loop — 替换 Claude CLI

> 状态：📋 计划中（2026-07-09 定稿，经代码验证 + 三轮讨论修订；07-10 第四轮对照 process-client.js/events.js/index.js 逐行核实，补事件协议、失败路径、/compact 等盲区）
> 前置阅读：[已完成/session-context-relay.md](已完成/session-context-relay.md)（跨 session 回顾机制，本方案直接复用）

## 1. 背景与目标

DS 目前在 withtoge 中走 Claude CLI 路径（`src/core/model-routes.js` 里 `type: "cli"`）。cyberboss spawn claude 子进程，由 Claude CLI 拼请求发到 `api.deepseek.com/anthropic`。问题：Claude CLI 拼请求时会带上 Anthropic 官方的几万字 agent system prompt——这套规范是写给 Claude 的，DS 不需要也不应该吃，白白浪费 token 还可能干扰行为。

**目标**：自建 DS agent loop，替代 Claude CLI 子进程，只带 cyberboss 自己的规范（世界书 + CLAUDE.md + 工具定义 + recent-context.md），接口兼容现有架构。

## 2. 架构对比

```
现在：cyberboss → spawn claude → CLI 拼请求(含 Anthropic 官方 prompt) → DS API
之后：cyberboss → DsAgentClient(自写 loop) → 直接拼请求(仅 cyberboss 规范) → DS API
```

## 3. 现状代码验证结论

实施前对照代码逐条验证了原始方案的假设：

| 假设 | 验证结果 |
|---|---|
| DS 现在走 CLI，`type: "cli"` | ✅ `src/core/model-routes.js` 确认 |
| `.mcp.json` 只接一个 MCP server | ✅ `project-settings.js` 只注册 `cyberboss_tools`（即 ProjectToolHost），DS 能用的工具就这一份，不需要额外写 MCP client 接其他 server |
| events.js + stream-delivery.js 不用改 | ✅ 两者完全靠事件 schema 解耦，DsAgentClient 只要 emit 同样格式的内部事件即可，一行都不用动 |
| `app.js:94` 已有 `projectToolHost` | ✅ 确认存在，`createRuntimeAdapter(config)` 需要改成传入 toolHost |
| `loadHandoffContext` 死代码 | ✅ 确认还在（读取已删除的 `ke-handoff.md`），清理零风险 |
| session-context-relay.md 路径 | ⚠️ 已归档移动到 `docs/plans/已完成/session-context-relay.md` |
| direct-api-client.js 可直接复用 SSE 解析 | ❌ **部分错误**——现有 `direct-api-client.js` 完全没有 tool_use 相关的 SSE 解析（见 §7 风险 1），这部分是新写不是复用 |

## 4. 已有基础设施（直接复用）

| 能力 | 实现文件 | 复用程度 |
|---|---|---|
| 跨 session 回顾 | `recent-context-writer.js` → `recent-context.md` | ✅ 直接复用，不改 |
| Opening turn 构建 | `shared-instructions.js` `buildOpeningTurnText()` | ✅ 复用，顺手清掉 `loadHandoffContext` 死代码 |
| SSE 流式解析（文本/思考部分） | `direct-api-client.js` | ⚠️ 部分复用——text_delta/thinking_delta/message_stop 解析可参考，**tool_use 状态机需新写**（§7 风险 1） |
| 工具定义 + 执行 | `tool-host.js` `ProjectToolHost` | ✅ `invokeTool(name, args, context)` 可直接调用，但返回值格式需转换（§5.4） |
| 审批弹窗 | `app.js` + `index.js` IPC | ✅ 自动批准规则 + 2 分钟超时自动拒绝，复用 |
| 事件体系 | `claudecode/events.js` + `core/stream-delivery.js` | ✅ 完全不用改，只要内部事件格式对齐 |
| 前端 thinking 流式 | 现有 WebSocket broadcast | ✅ 不受影响 |
| checkin 触发 | `system-checkin-poller.js` | ✅ 完全独立于 runtime 层，不受影响 |

## 5. 核心设计：DsAgentClient

### 5.1 接口（与 ClaudeCodeProcessClient 保持一致）

```js
class DsAgentClient {
  constructor({ env, model, workspaceRoot, toolHost, instructionConfig, ipcServer, ... })
  async connect(resumeSessionId)
  async sendUserMessage({ text, threadId })
  async sendResponse(requestId, { decision })
  async waitForSessionId({ timeoutMs })
  async close()           // ⚠️ 语义=中断：cancelTurn(index.js:403)的实现就是 client.close()。CLI 杀子进程天然中断一切，
                          //    自建 loop 必须 AbortController 中止在途 HTTP/SSE + 停循环 + 丢弃未执行的工具，不能只置标志位
  onMessage(listener)
  get alive()
  get sessionId()
  get resumeSessionId()   // 原方案漏列 — index.js:645 clientMatchesThread 依赖它判断 session 匹配
  get pendingTurnId()     // 原方案漏列 — sendTurn 返回值 turnId 依赖它
}
```

### 5.2 System Prompt 与消息历史管理（关键修订）

**原方案**：agent loop 内存里维护 `this.messages[]`，从第一条用户消息开始累积，30 轮截断。

**修订为**：仿照 Opus/GLM 路径已验证的模式（`app.js` 741-763 行 `conversationHistory` 组装逻辑）——每轮从 messageStore 读最近历史重新组装，而不是自己在内存维护一份。理由：

- 天然持久化，cyberboss 进程重启不丢失历史（内存数组方案则完全归零）
- 复用度更高，不是另起炉灶
- 工具调用的中间轮次（tool_use/tool_result）不落库，只在单个 turn 内部的循环里维持，跨 turn 不需要记住"上一条消息调了什么工具"

**必须同步做的设计要求（否则会有新风险）**：persona/世界书/CLAUDE.md 规则必须放进**每轮独立构造的 `system` 参数**，不能放进 `messages` 历史数组的第一条。原因：

- Claude CLI 现在的行为是"opening turn 注入一次 persona，之后靠同一个 session 的隐式历史携带"，系统轮（checkin）故意不重新注入 persona，靠这份隐式历史让模型记得自己是谁
- 如果改用 messageStore 重组装历史，且 persona 混在 messages 数组里，长对话会把最早的 persona 挤出截断窗口（Opus 路径窗口是 40000 字符），届时系统轮甚至普通对话都可能"忘了自己是谁"、不会按 `{"action":"silent"}` 协议回复
- 把 persona 放进独立的 `system` 参数就没有这个问题——不占用 messages 历史位置，不受窗口截断影响，用户轮每次都能带完整 system，系统轮可以按现状继续裸发（`system` 也可以按需精简）

### 5.3 Agent Loop 流程

```
用户消息 → sendUserMessage()
  ↓
emit("turn.started")
  ↓
system = buildOpeningTurnText(...) 或等效的每轮独立 system 构造（见 §5.2）
messages = 从 messageStore 重组装的最近历史 + 当前用户消息
  ↓
循环:
  POST /v1/messages { model, system, messages, tools, stream: true }
  ↓
  解析 SSE（⚠️ delta 只在内部累积，content_block_stop 才 emit 完整块——事件粒度必须对齐 CLI 现状，见 §5.8）:
    content_block_delta(text_delta) → 内部累积文本
    content_block_delta(thinking_delta) → 内部累积思考
    content_block_start(tool_use) → 记录 tool id/name/index（新写，见 §7 风险 1）
    content_block_delta(input_json_delta) → 累积 partial_json（新写）
    content_block_stop → text 块 emit("assistant.text")；thinking 块 emit("thinking")；tool_use 块 parse JSON 得完整 input（新写）
    message_start/message_delta 带 usage → emit("context.updated")（前端 token 显示 + §9 Token 对比都靠它）
  ↓
  如果有 tool_use:
    自动批准? → 直接执行
    需审批: emit("approval.requested") → 暂停 → 等 sendResponse()
    result = toolHost.invokeTool(name, args, context)  // 返回 {text, data}，需转换成 tool_result content
    emit("tool.result")
    messages.push({ role: "assistant", content: [完整块数组原样回传] })
      // ⚠️ 实测硬约束（§5.10）：必须是本响应的全部 content block——thinking(含 signature)、text、
      //    tool_use 一个不少、顺序不变。只放 tool_use 会被 DS 400 拒（thinking 模式强制回传）
    messages.push({ role: "user", content: [tool_result_block] })
    继续循环（不落库，仅本轮内存维持）
  ↓
  如果是纯文本回复:
    messages.push({ role: "assistant", content: [{ type: "text", text: fullText }] })
    emit("turn.completed")   // text = 整轮最终全文。工具轮穿插产生的多段文本按 "\n\n" 拼进去——
                             // 聊天气泡的唯一文本来源是 runtime.turn.completed.text（见 §5.8）
    完成（落库到 messageStore，供下一轮重组装历史）
  ↓
  任何环节不可恢复失败（HTTP 报错/SSE 断流/循环超限/…）→ emit("process.error") → runtime.turn.failed（见 §5.9）
```

### 5.4 工具接入细节

- `ProjectToolHost.listTools()` 返回 `{name, description, inputSchema}` → 转换成 Anthropic tools 数组要求的 `{name, description, input_schema}`（字段名不同）
- `invokeTool()` 返回 `{text, data}`，需要决定塞进 tool_result content 的内容（建议用 `text` 字段），异常时 catch 并标记 `is_error: true`

### 5.5 审批流程（不变）

复用现有自动批准规则：`isAutoApprovedStateDirOperation` / `matchesBuiltInCommandPrefix("mcp__cyberboss_tools")`。需要审批时暂停 loop（不发 HTTP 请求）→ emit `approval.requested` → 前端弹窗 → `sendResponse()` → 恢复。

### 5.6 系统轮（checkin/主动唤醒）行为对齐

- checkin 触发（`system-checkin-poller.js`）完全独立于 runtime/client 层，只是定时往队列塞一条系统消息，不受本方案影响
- **修订（07-10）：系统轮统一走和用户轮相同的 system 构造，不再区分**。理由：新架构下每轮请求都是无状态重组装，不存在 CLI 那种"同 session 隐式携带 persona"——要"继承现状限制"反而得专门写 `if (provider === "system") 省略 system` 的特殊分支。统一带 system 是**更少的代码**，还顺手把 07-04 实测过的"裸 spawn 系统轮只有 checkin 上下文，只能翻记忆库"这个坑修掉。成本可控：DeepSeek 有自动 context caching，相同 system 前缀命中缓存打折。（toge 若不同意可改回，改回=加一个特殊分支）
- 静默协议不变：系统轮回复仍按 `{"action":"silent"}` JSON 协议处理，§9 有对应验证条目

### 5.7 Session 后台查看与完整链路留存（吸收 GPT review 修订）

toge 现在通过 VS Code Claude Code 插件 + `~/.claude/scripts/fetch-app-sessions.js`，像 App 官方一样翻看 DS 完整 session。验证过的实际链路：

```
VPS: /root/.claude/projects/-root/*.jsonl  ← Claude CLI 子进程自动写盘（唯一数据源）
  ↓（ws-server.js /api/sessions 原样转发，不做任何格式转换）
GET /api/sessions, /api/sessions/:threadId
  ↓（fetch-app-sessions.js 拉取）
本地 ~/.claude/projects/C--Users-youzi/*.jsonl
  ↓
VS Code Claude Code 插件读取渲染
```

**风险**：自建 DsAgentClient 后，VPS 上不会再有任何进程往 `/root/.claude/projects/-root/` 写文件，这条链路会**完全断供**（不是退化）。

**完全兼容 Claude Code transcript 格式，本期不做**：实测翻看过真实格式（比对了当前 session 自己的 jsonl），比预期复杂——每条消息带 `uuid`/`parentUuid` 构成的树状结构，外加 `version`/`gitBranch`/`cwd`/`entrypoint`/`origin` 等 IDE 专属字段，没有官方文档，VS Code 插件对字段的容忍度需要实测摸索。放到 MVP 稳定之后的第二阶段单独攻克。

**MVP 期间的查看方案：扩展 messageStore，不另建 `ds-sessions` 目录**（原方案曾打算单独维护一份 `~/.cyberboss/ds-sessions/*.jsonl` 只为了"能看"，但这跟"完整链路要不要落库用于 debug/回放"其实是同一个需求，没必要维护两套存储）。

现状核实（`src/adapters/channel/shared/message-store.js`）：每天一个扁平 JSON 文件（`chat-history/<date>.json`），每条消息 `{id, channel, from, text, time, timestamp, model, ...}`，`text` 硬截断 2000 字符，`from` 目前只有 `you`/`ke`/`thinking` 三种，每天最多留 500 条。

扩展方向：

- `from` 新增 `tool_call` / `tool_result` 两种类型，把 DsAgentClient 内部每一轮的 tool_use（工具名 + 入参）和 tool_result（返回内容）也存进去，而不是只存最终 assistant 文本
- 工具返回内容可能超 2000 字（比如 `cyberboss_memory_search` 一次吐好几条），需要放宽这类记录的长度限制，或者截断时保留结构化摘要
- **必须同步排查的读取方**：`app.js` 的 Opus `conversationHistory` 组装（741-763 行）、`recent-context-writer.js` 的过滤逻辑，都要新增"跳过 `tool_call`/`tool_result` 类型"的判断，否则工具调用细节会被当成对话内容混进历史/回顾，污染其他模型的上下文
- 查看方式：不需要新脚本读一个新目录，直接按日期/`turnId` 过滤 messageStore 现有的每日 JSON，就能看到某次对话的完整链路（含工具调用）

原则是**存储完整，召回精简**——messageStore 存全部，喂给下一轮 messages 组装和 recent-context 回顾时只取 user + 最终 assistant 文本，工具调用细节留着但不参与召回。

### 5.8 事件协议对齐（07-10 第四轮新增，对照 process-client.js 逐条核实）

DsAgentClient 要 emit 的内部事件**全集**如下——`events.js` 的 `mapClaudeCodeMessageToRuntimeEvent` 只认这些名字，emit 别的名字会被静默丢弃：

| 事件 | 时机 | 下游消费方 |
|---|---|---|
| `session.id` | connect 时立即 emit。**自建后 sessionId 自己生成（uuid），生命周期内保持稳定**——CLI 的 session_replaced 问题在自建路径天然消失 | index.js:208 直接消费（不经 events.js），sendTurn 的 `waitForSessionId` 在等它 |
| `turn.started` | 收到 sendUserMessage 后 | runtime.turn.started |
| `thinking` | **完整块**（content_block_stop 时），不是逐 delta | runtime.thought → 前端思考流 |
| `assistant.text` | **完整块**（同上） | ⚠️ events.js 无此 case → 不进 runtime 事件流，只走 ipcServer processEvent 广播。中间文本块不直接变聊天气泡 |
| `tool.use` | 工具执行前 | runtime.tool.started |
| `tool.result` | 工具执行后 | 同 assistant.text，只走 IPC 广播 |
| `context.updated` | message_start/message_delta 带 usage 时 | 前端 token 显示；§9 Token 对比依赖 |
| `approval.requested` | 需审批时（带 requestId/toolName/input） | 审批弹窗链路 |
| `turn.completed` | 整轮结束，`text` = 最终全文 | **聊天气泡的唯一文本来源**（stream-delivery 消费 runtime.turn.completed.text） |
| `process.error` / `process.close` | 任何不可恢复失败（§5.9） | runtime.turn.failed → index.js:231 置 entry.alive=false → turn-gate 释放 |

两个容易踩的坑：

- **事件粒度是"完整块"不是"delta"**。CLI 的 stream-json 每条 assistant 消息就是完整 content block，下游全部按块处理。DsAgentClient 收 SSE delta 必须内部累积、block_stop 才 emit——否则每个几字符的 delta 会被当成一条完整消息广播出去，前端渲染直接乱掉。
- **`/compact` 会打进来**。app.js `handleCompactCommand` → `compactThread`（index.js:428）→ `client.sendUserMessage({ text: "/compact" })`。CLI 认这个斜杠命令，DS API 不认——会把 "/compact" 当聊天内容发给模型。MVP 处理：DsAgentClient 在 sendUserMessage 入口拦截 `/compact`，直接回"该模型不支持"（或实现为清空本 session 的历史窗口）。`refreshThreadInstructions` 发的是普通指令文本，天然兼容，不用处理。

### 5.9 错误处理与保险丝（07-10 第四轮新增，原方案完全没写）

现状参照：`direct-api-client.js` 只有 120s socket 超时 + 零重试——聊天模式一问一答够用。agent loop 一轮 turn 要发 N 次请求，任何一次挂掉整轮挂，标准必须更高：

- **失败必须终结 turn**：HTTP 4xx/5xx、429 重试耗尽、SSE 中途断流、工具参数 JSON parse 失败、循环超上限——统一 emit `process.error` → runtime.turn.failed。**漏掉的后果**：turn-gate 认为 turn 还在进行，排队消息干等 10 分钟卡死判定，表现为"克不回了"。
- **有限重试**：仅对 429/5xx/网络错误做指数退避重试 2~3 次；4xx（key 错、请求非法）直接 fail-fast。
- **超时三层**：单请求 socket 超时（沿用 120s）；单次工具执行超时（invokeTool 挂死不能永久 await）；整 turn 总时长兜底（10 分钟，与 turn-gate 卡死判定对齐）。
- **循环保险丝**：单 turn 工具轮数上限（建议 15），超限强制收尾——emit 带"工具轮数超限"说明的 turn.completed，防模型抽风连环调工具无限烧钱。
- **max_tokens 截断**：stop_reason=`max_tokens` 时 tool_use 的 input JSON 可能不完整，parse 前先判断；不完整按失败处理或回一个 `is_error` 的 tool_result 让模型收敛。
- **close() 即中断**：AbortController 贯穿所有在途请求，close 时 abort + 停循环 + 丢弃未执行工具（呼应 §5.1 注释）。

### 5.10 DS 端点实测结论（步骤 0 产物，07-10 完成）

抓取脚本 `scripts/capture-ds-sse.js`，夹具 `test/fixtures/ds-sse/*.sse.txt`（7 个场景，原始 SSE 流，**不要手改**——它们是 ds-stream-parser.js 的设计依据和测试基准）。核心结论：

| 实测点 | 结论 |
|---|---|
| SSE 格式 | 标准 Anthropic：`event:` + `data:` 双行，message_start → block(start/delta/stop)× N → message_delta → message_stop，**无 OpenAI 式 `[DONE]`**；有 `ping` 事件需忽略 |
| thinking | **默认永远开**——不传 thinking 参数也每轮先输出 thinking block（块 0 恒为 thinking）。delta 字段 `thinking`，块尾一个 `signature_delta`（字段 `signature`，值=message id） |
| **工具回传硬约束** | **同一轮 tool loop 回传时，assistant content 必须原样带回全部块（thinking 含 signature + text + tool_use），只回 tool_use → 400** `"The content[].thinking in the thinking mode must be passed back"`（复现夹具 toolresult_bare）。→ loop 内存必须保留整轮完整 content 块数组 |
| 跨 turn 历史豁免 | 纯文本历史（字符串 / text block 数组两种形态）**不要求** thinking → 200（夹具 history）。§5.2 messageStore 重组装方案安全 |
| input_json_delta | **真分片**（实测 18 片/块），`partial_json` 逐段拼接后 parse；block_start 的 `input` 是 `{}` 占位，别拿它当参数 |
| 并行 tool_use | 真实出现（夹具 parallel：两个 get_weather 块，index 2/3），id/name 在各自 block_start 里，**index 追踪必须做** |
| 响应形态 | text block 可缺席——history 场景整轮只有 thinking + tool_use。turn 最终文本要能处理"工具轮全程无 text"的情况 |
| usage | message_start 给 input_tokens，message_delta 给 output_tokens；`cache_read_input_tokens` 真实生效（toolresult 命中 512、history 命中 384）→ DeepSeek 自动 context caching 被证实，§5.6 系统轮带全量 system 的成本判断成立 |
| 错误响应 | 非 200 时 body 是普通 JSON `{"error":{message,type,...}}`（非 SSE），解析器需分支处理 |

## 6. 改动范围

### 新建文件

拆成职责单一的几个文件（吸收 GPT review：为的是这一个 DS 实现自身的可维护性——tool_use 状态机 + HTTP 请求构造 + 循环控制塞进一个文件容易过 500 行，**不是**为了给未来其他 provider 预留复用接口。先把 DS 跑通，等真的要接第二个 agent loop 需求时再看怎么抽公共部分——07-09 已与 toge 确认这个顺序，见 §10）：

- `src/adapters/runtime/claudecode/ds-agent-client.js` — 对外接口 + 生命周期管理（`sendUserMessage`/`connect`/`close` 等，与 `ClaudeCodeProcessClient` 接口对齐）
- `src/adapters/runtime/claudecode/ds-stream-parser.js` — SSE 解析 + tool_use 状态机（§7 风险 1 的复杂逻辑单独隔离，便于单测）

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/adapters/runtime/claudecode/index.js` | `ensureClient()` 里 `modelKey === "ds"` → 创建 `DsAgentClient`，其他保持 `ClaudeCodeProcessClient`；传入 toolHost、指令配置。端点/key/模型名直接读 `model-routes.js` 的 ds 条目（`baseUrl`/`apiKey`/`apiModel` 字段已有，不用新配置） |
| `src/core/app.js` | `createRuntimeAdapter(config)` → `createRuntimeAdapter(config, toolHost)`，透传 `this.projectToolHost`（line 94 已有）；Opus `conversationHistory` 组装增加跳过 `tool_call`/`tool_result` 类型的过滤（§5.7） |
| `src/adapters/runtime/shared-instructions.js` | 清理 `loadHandoffContext()` 死代码 |
| `src/adapters/channel/shared/message-store.js` | 新增 `tool_call`/`tool_result` 消息类型，放宽这类记录的长度限制（§5.7） |
| `src/services/recent-context-writer.js` | 过滤逻辑增加跳过 `tool_call`/`tool_result` 类型（§5.7） |

### 不改的文件

- `src/core/model-routes.js` — DS 的 `type` 保持 `"cli"`，路由不变
- `src/adapters/channel/direct/` — 前端通道完全不变
- `src/core/stream-delivery.js` — 事件投递完全不变（已验证）
- `src/services/recent-context-writer.js` — 已经工作的跨 session 回顾机制，不动
- `ws-server.js` 的 `/api/sessions` — 本期不改（§5.7 放第二阶段）

## 7. 风险清单（原方案低估的部分）

1. **tool_use 的 SSE 解析是新写，不是复用**。现有 `direct-api-client.js` 只处理 `text_delta`/`thinking_delta`/`message_stop`，完全没有 `content_block_start`(tool_use)、`input_json_delta`（工具参数分片 JSON 流式拼接）、`content_block_stop` 这套状态机，也没处理多个并行 tool_use 的 index 追踪。这是 agent loop 里最容易出 bug 的部分，工作量比原方案"步骤1 ~200行"里估的要重，建议单独排时间调试。
2. **进程重启后的历史保留，是打平不是解决**。不管用哪种历史管理方式，cyberboss 重启后都无法恢复"正在进行中"的多轮工具调用状态，这跟现状（Claude CLI `--resume` 长期失败）基本持平。
3. **接口遗漏**：`resumeSessionId`、`pendingTurnId` 两个字段原方案没列，但 `index.js` 里的 `clientMatchesThread`、`sendTurn` 返回值依赖它们。
4. **工具格式转换细节**：`inputSchema`→`input_schema` 字段名转换，`invokeTool()` 返回值 `{text,data}` → tool_result content 的转换，原方案没提但要做。
5. **Session 后台查看链路会断供**（§5.7），原方案完全没考虑到这一层，MVP 阶段改用扩展 messageStore 顶着。
6. **messageStore schema 扩展不是无痛的加字段**：`app.js` 的历史组装、`recent-context-writer.js` 的过滤逻辑都要跟着改，漏改会导致工具调用细节污染对话历史/回顾内容。
7. ~~DS Anthropic 兼容端点的 SSE 行为可能偏离官方规范~~ → **✅ 已实测（07-10，§5.10）**。格式基本贴合官方（分片、并行、index 都是真的），但抓到一条官方规范没有的硬约束：thinking 模式下同轮 tool loop 必须原样回传 thinking block，否则 400。原计划"messages.push 只带 tool_use_block"的写法会全军覆没——夹具先行救了一命。
8. **工具记录会挤占 messageStore 每日配额**（07-10 新增）。每天 500 条上限，一轮带 5 次工具调用就是 11 条记录，重度使用会把真对话挤出窗口——tool_call/tool_result 建议不占 500 条配额（单独计数）或放大上限。顺带注意：assistant 最终文本落库同样吃 2000 字截断，长回复参与下一轮历史重组装时是截断版（Opus 路径现状也如此，可接受，但要知道这个行为）。

## 8. 实施步骤（分阶段）

### 阶段一：MVP（agent loop 本身跑通）

0. ~~实测 DS 端点行为~~ **✅ 已完成（07-10）**：`scripts/capture-ds-sse.js` 七场景夹具落在 `test/fixtures/ds-sse/`，结论见 §5.10。本地 .env 的 DEEPSEEK_KEY 已失效（401），有效 key 只在 VPS——复跑脚本要在 VPS 上跑（scp 到 /tmp + 从 /opt/withtoge/.env 提取 key）
1. `ds-agent-client.js` 核心：HTTP 请求构造（system + messages + tools）、SSE 流式解析（含 tool_use 状态机，§7 风险 1）
2. tool 执行与完整 loop：`toolHost.invokeTool()` 集成、循环控制、stop_reason 检测、审批暂停/恢复、错误处理与保险丝（§5.9）
3. 历史管理：仿 Opus 路径的 messageStore 重组装（§5.2），system 参数独立构造
4. 扩展 messageStore 支持 `tool_call`/`tool_result` 类型，同步适配 `app.js`/`recent-context-writer.js` 的读取方（§5.7）
5. 集成到 claudecode 适配器：`index.js` 按 modelKey 分流、toolHost 传入、清 `shared-instructions.js` 死代码
6. 部署验证：commit + push VPS/GitHub → VPS pull + restart

### 阶段二（MVP 稳定后）：Session 查看精细化

- 逆向 Claude Code transcript 完整 schema（uuid 树、必需字段）
- 让 DsAgentClient 在 `/root/.claude/projects/-root/` 生成兼容格式，实测 VS Code 插件能否正常识别
- 不确定性高，预留充分调试时间，不设死限

## 9. 验证方案

- **基本对话**：DS 页发"你好"，确认正常回复
- **工具调用**：说"帮我记日记，写今天天气很好"，确认 `diary_append` 被调用成功
- **审批弹窗**：触发需审批的工具，确认弹窗出现、`/yes` 后执行
- **跨 session 回顾**：重启 cyberboss 后问"我们刚才聊到哪"，应能答出（验证 `recent-context.md` 注入正常）
- **系统轮静默**：等一次主动问候，确认思考不泄漏到聊天页，且系统轮回复符合 JSON 协议
- **Token 对比**：相同对话走新旧路径，对比 `input_tokens`，确认省下了 Anthropic 官方 prompt 的 token
- **长对话 persona 保真**：连续对话到超出历史窗口后，确认模型仍然记得自己的身份/规则（验证 §5.2 的 system 独立参数设计生效）
- **中断**（07-10 新增）：turn 进行中（最好正在调工具）触发 cancelTurn/关停，确认 loop 真停——无后续工具执行、无半成品落库（验证 §5.1 close 中断语义）
- **失败提示**（07-10 新增）：临时改错 API key 触发请求失败，确认聊天页收到失败消息而不是永远转圈（验证 §5.9 的 turn.failed 链路，漏了会表现成"克不回了"）
- **排队不穿插**（07-10 新增）：turn 进行中再发一条消息，确认排队等待、前一轮结束后按序处理

## 10. 明确不做（本期）

- ❌ 完全兼容 Claude Code transcript 格式给 VS Code 插件用（放阶段二）
- ~~❌ 修复"裸 spawn 系统轮不带 persona"~~ → **07-10 改为顺手修复**：新架构下系统轮统一带 system 反而是更少的代码，见 §5.6 修订
- ❌ 接入 ProjectToolHost 之外的额外 MCP server（现状确认不需要）
- ❌ 给其他 provider（Gemini/GPT/Claude API）复用 tool loop，或抽象出 BaseAgentRuntime 基类/Provider Adapter 中间层 — 先接 DS 一个实现跑通，等真的出现第二个 agent loop 需求时再抽（07-09 toge 拍板：先 DS 能跑通，再给其他模型复用）

## 11. 参考

- [已完成/session-context-relay.md](已完成/session-context-relay.md) — 跨 session 回顾机制，本方案直接复用
