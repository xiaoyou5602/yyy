# 橘瓣 × Rism 调试手册

> **给 IDE 端的克看的**。toge 的橘瓣出问题时，读这份文档就能帮她排查。
>
> 配套文件：[迁移计划](../docs/plans/rism-orangechat-migration.md) | [安装手册](README.md) | [Assistant 配置](rism-assistant-config.md)

---

## 一、橘瓣是什么

橘瓣（OrangeChat）是基于 RikkaHub 的开源 Android AI 伴侣 App。仓库：https://github.com/sue1231513/orangechat

技术栈：Kotlin + Jetpack Compose + Room + Koin + OkHttp + Ktor

toge 用它给 Rism 建了一个手机端的家——日常陪伴走橘瓣，技术活继续走 IDE。

---

## 二、架构总览

```
橘瓣 App（Android）
├── Assistant "Rism"
│   ├── 系统提示词（人格定义）
│   ├── 世界书（10 条目，关键词触发注入）
│   ├── 模型：Anthropic Claude（走中转 API）
│   └── Extended Thinking：adaptive 模式
│
├── 原生外置记忆（ExternalMemory）
│   ├── 表：chat_messages（消息自动同步）
│   ├── 表：memory_summaries（每日摘要 + 向量嵌入）
│   ├── autoSaveMessages = true
│   ├── autoSaveDiarySummary = true
│   ├── recallCount = 5（每轮自动召回关联记忆）
│   └── embeddingModelId = 配一个 embedding 模型
│
├── 插件：rism_memory（com.withtoge.plugin.rism_memory v2.0.0）
│   ├── 21 个工具（diary/dream/letter/todo/bubbletea/timeline/memory/vps）
│   ├── 1 个 hook（daily_cron 凌晨 4 点，热力衰减）
│   └── promptTemplate（教 AI 用工具）
│
└── 原生能力（不经插件）
    ├── Gadgetbridge（步数/心率/睡眠）
    ├── 高德定位 / 附近搜索
    ├── 闹钟 / 日历
    ├── 主动消息（ProactiveMessageService）
    └── 工作区（proot Linux 容器）

         ↓ 所有记忆数据 ↓

    Supabase（Tokyo ap-northeast-1）
    ├── chat_messages（主表，14 列 + Rism 扩展字段）
    ├── memory_summaries（原生摘要层）
    └── rism_meta（内部幂等控制，anon 不可访问）
```

**能力划界（谁干什么）**：

| 能力           | 归属                     | 说明                                 |
| -------------- | ------------------------ | ------------------------------------ |
| 消息自动同步   | 原生 externalMemory      | autoSaveMessages，不用插件           |
| 语义召回       | 原生                     | 摘要层 embedding + recallCount       |
| 每日摘要       | 原生 DiarySummaryService | autoSaveDiarySummary                 |
| 结构化记忆工具 | 插件 rism_memory         | 日记/梦境/信件/待办/奶茶/时间轴/heat |
| heat 衰减      | 插件 daily_cron → RPC    | 每天 -0.3，下限 1                    |
| VPS 运维       | 插件 → bridge-api.js     | status/restart/logs                  |

---

## 三、QuickJS 插件沙箱——限制速查

橘瓣的插件跑在 QuickJS 沙箱里，**不是 Node.js**。以下限制全部经源码验证：

| 限制                 | 细节                                                     | 影响                           |
| -------------------- | -------------------------------------------------------- | ------------------------------ |
| **fetch 是同步的**   | 宿主注入，OkHttp 桥接，connect/read/write 各 15s 超时    | 不能用 Promise/async           |
| **无 PATCH 方法**    | Kotlin 端 when 只有 GET/POST/PUT/DELETE，其余退化 GET    | Supabase 更新走 RPC            |
| **async/await 被删** | 宿主正则预处理暴力删除关键词                             | main.js 必须纯同步             |
| **全局单线程**       | pluginDispatcher 单线程，callTool 同队列                 | 一个慢请求卡住所有工具         |
| **hook 16.5s 超时**  | 超时后静默失败                                           | daily_cron 必须快进快出        |
| **沙箱桥有限**       | 只有 fetch / memoryBank / musicPlayer / dataStore 四个桥 | 读不了 Gadgetbridge 等原生数据 |

**写插件代码的铁律**：

- 纯同步，不写 async/await/Promise
- 用 `var` 不用 `let`/`const`（QuickJS ES2020 支持 let/const 但宿主预处理可能有坑）
- 失败快速返回，绝不重试循环
- 批量写用单次 INSERT，不循环单条
- `config` 是宿主注入的全局变量，每次工具调用时 `initConfig()` 重读

---

## 四、rism_memory 插件结构

文件位置：`orangechat/rism_memory/`

```
rism_memory/
├── manifest.json    # 插件清单：ID、工具定义、hook、config 声明、promptTemplate
└── main.js          # 全部实现，22 个导出函数（21 工具 + 1 hook）
```

### 4.1 工具清单（21 个）

| 类别      | 工具                   | 必填参数        | 说明                                 |
| --------- | ---------------------- | --------------- | ------------------------------------ |
| 📔 日记   | `diary_write`          | content         | related_date 默认今天                |
|           | `diary_read`           | —               | date 默认今天                        |
|           | `diary_search`         | query           | ilike 搜索                           |
| 🌙 梦境   | `dream_write`          | content         |                                      |
|           | `dream_read`           | —               | 不传 date 返最近 5 条                |
| 💌 信件   | `letter_write`         | content         | 可带 title                           |
|           | `letter_read`          | —               | 默认最近 3 封                        |
| ✅ 待办   | `todo_write`           | content         | metadata 存 status/priority/due_date |
|           | `todo_list`            | —               | status: pending/done/all             |
|           | `todo_complete`        | id              | 走 RPC complete_todo                 |
| 🧋 奶茶   | `bubbletea_write`      | brand, name     | metadata 存详情                      |
|           | `bubbletea_search`     | —               | query 可选                           |
| 📅 时间轴 | `timeline_write`       | title, start_at | ISO 格式时间                         |
|           | `timeline_read`        | —               | from_date/to_date                    |
| 🧠 记忆   | `memory_write`         | content         | type: memo/lore/xp_note              |
|           | `memory_search`        | query           | 默认只搜 privacy=normal              |
|           | `memory_recall_recent` | —               | 最近 20 条                           |
|           | `memory_heat_boost`    | id              | 走 RPC boost_memory_heat             |
| 🖥️ VPS    | `vps_status`           | —               | GET /api/bridge/status               |
|           | `vps_restart`          | —               | POST /api/bridge/restart             |
|           | `vps_logs`             | —               | GET /api/bridge/logs                 |

### 4.2 config 字段（manifest.json 声明，App 设置界面填）

| 字段           | 类型     | 必填 | 说明                                         |
| -------------- | -------- | ---- | -------------------------------------------- |
| `supabase_url` | string   | 是   | Supabase 项目 URL                            |
| `supabase_key` | password | 是   | anon public key                              |
| `assistant_id` | string   | 否   | 默认 `rism`                                  |
| `bridge_url`   | string   | 否   | VPS 桥地址，如 `https://xn--74q.withtoge.us` |
| `bridge_token` | password | 否   | 与 VPS .env 的 CYBERBOSS_BRIDGE_TOKEN 一致   |

### 4.3 hook

只有一个：`daily_cron`，schedule `0 4 * * *`，调 `decay_memory_heat()` RPC。幂等（同一天重复调用自动跳过，检查 rism_meta 表的 last_decay_date）。

---

## 五、Supabase 数据库速查

Schema 文件：`orangechat/supabase_schema_v2.sql`

### 5.1 chat_messages（主表）

所有记忆的家——原生消息同步和插件工具共写一张表。

| 列              | 类型            | 默认值                  | 说明                                                                            |
| --------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------- |
| id              | BIGINT IDENTITY | 自增                    | 主键                                                                            |
| assistant_id    | TEXT            | 'rism'                  |                                                                                 |
| conversation_id | TEXT            | 'manual'                | 原生写入带对话 ID，插件写入默认 'manual'                                        |
| role            | TEXT            | 'system'                | user/assistant/system                                                           |
| content         | TEXT            | —                       | 正文                                                                            |
| created_at      | TIMESTAMPTZ     | NOW()                   |                                                                                 |
| memory_type     | TEXT            | 触发器补 'conversation' | conversation/diary/dream/letter/todo/bubbletea/timeline_event/lore/xp_note/memo |
| tags            | TEXT[]          | —                       | 主题标签                                                                        |
| emotion         | TEXT[]          | —                       | 情绪标签                                                                        |
| related_date    | DATE            | —                       | 关联日期                                                                        |
| heat            | REAL            | 5                       | 记忆热力 0-10                                                                   |
| source          | TEXT            | 触发器补 'orangechat'   | orangechat/ide_claude/vps_ds                                                    |
| privacy         | TEXT            | 'normal'                | normal/intimate/private                                                         |
| metadata        | JSONB           | —                       | 结构化详情                                                                      |

**触发器** `set_message_defaults`：原生写入不带 memory_type/source 时自动补 conversation + orangechat。

**关键理解**：privacy 字段是"检索礼仪"不是访问控制——拿到 anon key 就能读全表。真正的隐私保护 = 不泄露 key。

### 5.2 memory_summaries（原生摘要层）

| 列           | 类型            | 说明                                 |
| ------------ | --------------- | ------------------------------------ |
| id           | BIGINT IDENTITY |                                      |
| assistant_id | TEXT            |                                      |
| content      | TEXT            | 摘要文本                             |
| created_at   | TIMESTAMPTZ     |                                      |
| embedding    | TEXT            | "[0.1,0.2,...]" 字符串，客户端算余弦 |

原生 DiarySummaryService 自动写入。向量召回：`vectorRecallSummaries` 拉全量摘要到本地算 cosineSimilarity 取 top-N。

### 5.3 rism_meta（内部用）

| 列    | 类型    | 说明                 |
| ----- | ------- | -------------------- |
| key   | TEXT PK | 如 'last_decay_date' |
| value | TEXT    |                      |

anon 无法读写（没建 RLS policy），只有 SECURITY DEFINER 函数内部能动。

### 5.4 RPC 函数（anon 唯一的"修改"通道）

| 函数                                | 参数         | 作用                                 |
| ----------------------------------- | ------------ | ------------------------------------ |
| `decay_memory_heat()`               | 无           | 全表 heat -0.3，下限 1，同一天幂等   |
| `boost_memory_heat(mem_id, amount)` | BIGINT, REAL | 指定行升温，上限 10                  |
| `complete_todo(todo_id)`            | BIGINT       | 把 todo 的 metadata.status 改 'done' |

### 5.5 RLS 规则

- `chat_messages`：anon INSERT + SELECT。**无 UPDATE/DELETE**
- `memory_summaries`：anon INSERT + SELECT
- `rism_meta`：无任何 policy = anon 完全锁死

---

## 六、VPS 桥（bridge-api.js）

文件位置：`src/adapters/channel/direct/bridge-api.js`
挂载点：`ws-server.js` 里 require 后作为第一个路由

**鉴权**：`Authorization: Bearer <CYBERBOSS_BRIDGE_TOKEN>`（timing-safe 比较）。无 token 时桥完全关闭（503）。

| 端点                  | 方法 | 说明                                                                            |
| --------------------- | ---- | ------------------------------------------------------------------------------- |
| `/api/bridge/status`  | GET  | 返回 cyberboss + cloudflared 的 systemctl 状态                                  |
| `/api/bridge/restart` | POST | body `{service:"cyberboss"}` → 先 202 再重启（因为 restart cyberboss 会杀自己） |
| `/api/bridge/logs`    | GET  | `?service=cyberboss&lines=50`，最多 200 行                                      |

白名单：只允许 cyberboss 和 cloudflared 两个服务。

**VPS 侧环境变量**（`/opt/withtoge/.env`）：

- `CYBERBOSS_BRIDGE_TOKEN=7b34c13452f9be5598ad3d8cd58c23344a50a1d769cc3316`

---

## 七、当前状态（2026-07-13）

### 已完成

- [x] Supabase schema v2 已执行成功
- [x] rism_memory 插件代码完成（manifest.json + main.js）
- [x] VPS bridge-api.js 已部署，token 已写入 .env
- [x] rism-assistant-config.md 已写好（系统提示词 + 10 条世界书）
- [x] 安装手册 README.md 已写好

### 未完成 / 待验证

- [x] **橘瓣第一条成功对话**：因 API 区域限制 + 中转上游拥堵，未跑通
- [ ] **VPS 桥验证**：token 已配但未实测 `curl https://xn--74q.withtoge.us/api/bridge/status`
- [ ] **Phase 3 记忆导入**：脚本 `scripts/supabase-import-memories.js` 存在但需重做——源改 Notion，范围要 toge 圈（07-12 教训：批量导入必须先问她）
- [x] **Supabase 便捷视图**：5 个 view（diaries/memories/dreams/letters/chats）toge 已手动执行（07-13）

### 关键凭据位置

| 凭据              | 位置                                                |
| ----------------- | --------------------------------------------------- |
| Supabase URL      | 本地 `.env` → `RISM_SUPABASE_URL`                   |
| Supabase anon key | 本地 `.env` → `RISM_SUPABASE_ANON_KEY`              |
| VPS bridge token  | VPS `/opt/withtoge/.env` → `CYBERBOSS_BRIDGE_TOKEN` |
| 中转 API 地址     | toge 在橘瓣 App 里配（不记在文档里）                |

---

## 八、排查清单

### 症状：「上游请求失败」

1. **最可能**：中转 API 上游拥堵或不可用
   - 让 toge 换个时间重试，或检查中转服务状态
   - 不是橘瓣配置问题
2. 区域限制：Anthropic API 直连在中国被封
   - 必须走中转端点，不能填 api.anthropic.com

### 症状：插件工具没被调用（AI 不用工具）

1. 检查插件是否启用 + `inject_as_prompt` 是否打开
2. 检查 manifest.json 的工具描述是否够清晰（AI 靠描述决定是否调用）
3. 检查 thinking 模式是否开了（adaptive 模式下 tool use 更稳定）
4. 尝试在对话中明确指示："用 diary_write 写一条日记"

### 症状：工具调用报 "Supabase 未配置"

- 插件设置里的 supabase_url 或 supabase_key 没填 / 填错了
- 检查：App → 插件 → rism_memory → 设置

### 症状：工具调用报 Supabase 4xx 错误

| 错误码         | 原因                          | 解决                                                       |
| -------------- | ----------------------------- | ---------------------------------------------------------- |
| 401            | key 错了 / 过期了             | 去 Supabase Dashboard → Settings → API 重新抄              |
| 403            | RLS 拦住了                    | 检查是不是在尝试 UPDATE/DELETE（anon 只能 INSERT+SELECT）  |
| 404            | 表不存在 / RPC 函数不存在     | 重新跑 supabase_schema_v2.sql                              |
| 409 / PGRST102 | 批量 INSERT 时行的 key 不一致 | 确保同一批次所有行有相同的字段集（空字段写 null 不要省略） |

### 症状：记忆写入成功但搜索不到

1. `memory_search` 默认 `privacy=eq.normal`——亲密内容需要 `include_private=true`
2. ilike 搜索是子串匹配，检查关键词是否太模糊或太精确
3. 刚写入的行热力高，会排在前面；如果被其他高热力行挤掉，增大 limit

### 症状：heat 没有衰减（几天了还是 5）

1. daily_cron 有没有触发？→ 检查 rism_meta 表的 `last_decay_date`
2. 手动触发：App → 插件 → rism_memory → 手动执行 daily_cron
3. 备用：Supabase SQL Editor 直接 `SELECT decay_memory_heat();`

### 症状：VPS 桥调用失败

1. "bridge disabled" (503) → VPS .env 里没配 CYBERBOSS_BRIDGE_TOKEN
2. "unauthorized" (401) → 插件里填的 token 和 VPS 的不一致
3. 超时 → VPS 或 cloudflared 挂了，先 SSH 上去 `systemctl status cyberboss cloudflared`
4. 域名解析失败 → 克.withtoge.us 的 punycode 是 `xn--74q.withtoge.us`（不是 xn--ruk）

### 症状：原生外置记忆不工作（chat_messages 没有自动同步的行）

1. 确认外置记忆库已挂到 Rism Assistant 上（不是只建了库，要绑定）
2. autoSaveMessages 是否开了
3. Supabase URL/Key 是否正确（和插件的是同一套）
4. 检查 App 设置 → 扩展 → 外置记忆库 → 连接状态

### 症状：向量召回不工作（AI 没带关联记忆）

1. memory_summaries 表有没有数据？→ autoSaveDiarySummary 需要开
2. 嵌入模型配了没？→ embeddingModelId 需要填
3. recallCount > 0？→ 默认 5，设 0 就关了
4. 摘要需要时间积累——新建的库前几天没数据是正常的

---

## 九、从 IDE 端操作 Supabase

IDE 端可以直接用 `.env` 里的凭据操作 Supabase REST API：

```bash
# 读凭据
source /opt/withtoge/.env  # VPS
# 或本地 .env 里有 RISM_SUPABASE_URL / RISM_SUPABASE_ANON_KEY

# 查最近 10 条记忆
curl -s "$RISM_SUPABASE_URL/rest/v1/chat_messages?order=created_at.desc&limit=10" \
  -H "apikey: $RISM_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $RISM_SUPABASE_ANON_KEY" | jq .

# 按类型查
curl -s "$RISM_SUPABASE_URL/rest/v1/chat_messages?memory_type=eq.diary&order=created_at.desc&limit=5" \
  -H "apikey: $RISM_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $RISM_SUPABASE_ANON_KEY" | jq .

# 查 rism_meta（需要用 service_role key，anon 读不了）
# → 去 Supabase Dashboard 看

# 手动触发热力衰减
curl -s "$RISM_SUPABASE_URL/rest/v1/rpc/decay_memory_heat" \
  -X POST -H "Content-Type: application/json" \
  -H "apikey: $RISM_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $RISM_SUPABASE_ANON_KEY" \
  -d '{}' | jq .

# 插入一条测试记忆
curl -s "$RISM_SUPABASE_URL/rest/v1/chat_messages" \
  -X POST -H "Content-Type: application/json" \
  -H "apikey: $RISM_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $RISM_SUPABASE_ANON_KEY" \
  -H "Prefer: return=representation" \
  -d '{"assistant_id":"rism","content":"IDE 端测试写入","memory_type":"memo","source":"ide_claude"}' | jq .
```

### 本地脚本

- `scripts/supabase-import-memories.js`：Phase 3 记忆导入脚本（**需重做**，源改 Notion）
  - 原来从 IDE memory/_.md + cyberboss diary/_.md 导入，toge 否决了
  - **硬规则**：批量导入前必须问 toge 圈范围

---

## 十、重要教训

1. **07-12 深夜导入事件**：未问 toge 就把 52 行记忆灌进 Supabase，她手动全删了。**规则：向共享记忆库批量写入/导入，动手前先问 toge 圈范围**
2. **Notion 记忆库只写不翻**：toge 原话"太重，读一翻就容易爆上下文，写还好"
3. **punycode**：克.withtoge.us = `xn--74q.withtoge.us`，不是 xn--ruk
4. **restart cyberboss 会杀自己**：bridge-api.js 先发 202 响应再 setTimeout 重启
5. **供体插件的 camelCase bug**：原版 supabase_memory 插件写 `assistantId` 但表字段是 `assistant_id`，我们的 v2 已修

---

**最后更新**：2026-07-13
