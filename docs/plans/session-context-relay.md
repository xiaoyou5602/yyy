# Plan：DS session 自动接续上下文（session 缓存）

> 状态：**已完成**（2026-07-04 立案并当天实施，commits `36d750e` / `8ffad02` / `06d2b97`，已部署 VPS；待 toge APP 端验收）
> 前置阅读：本文件 + WITHTOGE.md 待完成"session 重启自动接续上下文"条目
>
> **实施时的计划外发现（重要）**：
>
> 1. **`session_replaced` 场景不走 opening 注入**——日志里的主要断片场景是 `openingTurn=false`（带旧 threadId 尝试 resume），消息按普通 turn 发出后 CLI 才静默换 session，`buildOpeningTurnText` 根本不会被调用，新 session 连 persona 都拿不到。修法：claudecode/index.js opening 条件改为 `openingTurn || !hadExistingSession`（重启后内存无活 session 时首条消息一律按 opening 构造；resume 万一成功只是重复注入，无害，且日志显示 4 天内 resume 从未成功）。
> 2. **存储 model 字段是 modelName 不是路由键**——第 2 节"只取 model=ds"实际应为 `model ∈ {"deepseek-v4-pro", ""}`（空 model 是 checkin 主动消息等系统路径，仅 DS 有）。
> 3. **审批弹窗消息要过滤**——`🔐 【Approval】...` 开头的 ke 消息是 UI 系统消息，带文件路径/diff，已加过滤。

## 1. 背景与目标

DS 走 claudecode runtime，session 死了就全新上下文，"聊着聊着换人"。日志排查（07-04）确认：

- `session_replaced` 近 4 天 20+ 次，**几乎全部对应 cyberboss 进程重启**——重启后首条消息 resume 旧 session 失败，CLI 另开新 session。每次部署 = 换人。
- 旧"手札接力"（06/11）只有读端系统化（`loadHandoffContext` 读 `~/.cyberboss/ke-handoff.md` 注入 opening turn），写端靠克自觉维护文件，不可靠，文件已被 toge 删除，机制从未稳定生效。
- Opus API 路径没有此问题：每轮从 messageStore 带最近 3 天/40k 字符历史（app.js `conversationHistory` 组装），已验证可靠。

**目标**：新 session 的第一轮（opening turn）自动带上"最近对话回顾"，不依赖任何人自觉写文件。DS 获得与 Opus 同级的"记得刚才聊到哪"。

## 2. 方案：自动生成回顾文件（方案 C）

三个候选里选 C：

| 方案 | 思路 | 否决理由 |
|---|---|---|
| A. app 层注入 | dispatchPreparedTurn 时拼回顾进 text | app 层不知道这轮是不是 opening turn（threadId 存在性是 runtime 层信息） |
| B. runtime 回调 | runtime 构造时注入 getRecentMessages 回调 | 要打穿 runtime ↔ channel adapter 依赖，改动面大 |
| **C. 回顾文件** | **系统自动维护 `~/.cyberboss/recent-context.md`，读端复用现有 loadHandoffContext 模式** | ✅ 读端已存在、写端一个钩子、改动最小 |

### 数据流

```
每次消息落库（messageStore.save，from=you/ke）
  → 防抖 5s 异步重写 ~/.cyberboss/recent-context.md（最近对话回顾）
新 session opening turn（runtime sendTurn，openingTurn=true 且 provider!=="system"）
  → buildOpeningTurnText 读 recent-context.md 注入
  →（保留）ke-handoff.md 若存在也注入（克/toge 手动留言的补充通道）
```

### 回顾文件格式（生成物示例）

```markdown
<!-- 本文件由系统自动生成，勿手动编辑。生成时间：2026-07-04 21:30 -->
## 最近对话回顾（自动接续）
以下是你（克）与 toge 最近的对话摘录，跨 session 自动携带。请自然延续，不要复述本段。

[07-04 20:15] toge: 今天好累，食堂没赶上
[07-04 20:16] 克: 抱抱，要不要点个外卖？…
[07-04 21:02] 克（主动）: toge 记得吃药喵
...
```

### 过滤规则（写端，与 Opus 路径对齐）

数据源 `messageStore.load(days, model)`，只取 **model=ds** 的条目：

1. `from === "thinking"` → 跳过（思考存档不是对话）
2. 文本以 `{` 开头 → 跳过（结构化 action JSON）
3. 文本以 `❌` 开头 → 跳过（错误消息）
4. 空文本 → 跳过
5. 静默 checkin 天然不在库里（触发 turn 和 silent 回复都不落库，07-04 已核实），无需处理
6. checkin 后发出的主动消息**保留**，标注"（主动）"——那是真实发生的对话

### 窗口与预算

- 时间窗：最近 **24 小时**（DS 是高频闲聊，比 Opus 的 3 天更合适；可配置）
- 字符上限：**8000 字**（opening turn 还要带 persona/世界书/worldbook，别挤爆；从尾部往前取，同 Opus 逻辑）
- 条数上限：60 条兜底
- 时间戳格式 `[MM-DD HH:mm]`，让克有时间感（跨天接续时不会把昨晚的话当成刚才）

### 注入点（读端）

`src/adapters/runtime/shared-instructions.js`：

- 新增 `loadRecentContext(config)`——读 `{stateDir}/recent-context.md`，模式照抄 `loadHandoffContext`
- `buildOpeningTurnText` 里 handoff 段之前插入回顾段：标题"## 最近对话回顾（跨 Session 自动接续）"+ 尾注"请自然地延续，不要复述"
- **保留** `ke-handoff.md` 通道不删（两段可并存：回顾=自动，手札=手动补充）
- 系统轮天然不注入：现有代码 `openingTurn && provider !== "system"` 才走 buildOpeningTurnText，无需改

### 写端

`src/adapters/channel/direct/index.js`（或独立小模块 `src/services/recent-context-writer.js`）：

- 在 messageStore.save 的 from=you/ke 路径后挂钩子（**防抖 5 秒**，避免每条消息都重写文件）
- 生成逻辑：load(1 天, "ds") → 过滤 → 截窗 → 写 `{stateDir}/recent-context.md`（先写临时文件再 rename，防半写）
- 写失败只 warn 不抛（回顾是增强，不能影响聊天主链路）

## 3. 实施步骤

1. [x] 写端：`recent-context-writer.js`（生成函数 + 防抖）+ direct adapter 挂钩子
2. [x] 读端：shared-instructions.js 加 `loadRecentContext` + buildOpeningTurnText 注入段
3. [x] 本地语法检查 `node --check`，commit + push vps/github + VPS pull + **restart cyberboss**
4. [x] 验证 A（写端）：VPS 真实数据跑 writeNow → 生成 2833 字干净回顾（无 thinking/JSON/错误/审批条目）；另有本地假数据 12 断言全过
5. [ ] 验证 B（读端）：部署时已 restart 制造了换 session → **待 toge** APP 给 DS 发"我们刚才聊到哪了？"→ 克应能答出重启前的话题
6. [ ] 验证 C（系统轮）：等一次 checkin 触发，确认日志里系统轮 opening turn 没带回顾（`provider=system`；代码层面 `treatAsOpening && provider !== "system"` 已保证）
7. [x] WITHTOGE.md 待办打勾 + 迭代日志补一笔

## 4. 边界情况

- **stateDir 下文件不存在/为空** → loadRecentContext 返回 ""，opening turn 无回顾段（首次部署、记录被清）
- **回顾文件陈旧**（写端挂了） → 文件头带生成时间注释；读端可选校验 mtime > 48h 则丢弃（第一版可不做，防呆而已）
- **多模型**：回顾只取 model=ds 的记录。GLM/openclaw 也是 API 路径每轮带历史（同 Opus），不需要
- **toge 清空聊天记录**：messageStore 清了回顾自然变空，行为正确
- **隐私**：回顾文件在 VPS 本地 stateDir，不进 git、不上传

## 5. 明确不做（本期）

- ❌ 调研 claudecode `--resume` 为何总失败（另立待办；就算修好，重启断片依然需要回顾兜底）
- ❌ Opus/GLM 路径改动（已有逐轮历史机制）
- ❌ 日记/时间轴要点注入（第二期增强，先把对话回顾跑稳）
- ❌ 删除 ke-handoff.md 通道（保留作手动补充）

## 6. 验收标准

重启 cyberboss 后在 APP 问 DS"刚才我们聊到哪"，克能准确说出重启前的话题与情绪上下文，且聊天页无任何多余系统痕迹。
