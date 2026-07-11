# 🍊 Rism 入住橘瓣 · 安装手册

> 配套计划：[docs/plans/rism-orangechat-migration.md](../docs/plans/rism-orangechat-migration.md)
> 这个目录里的东西：`supabase_schema_v2.sql`（数据库）+ `rism_memory/`（插件，manifest.json + main.js）

## 一、建 Supabase（一次性，约 10 分钟）

1. [supabase.com](https://supabase.com) 建新项目（区域选 Tokyo `ap-northeast-1`，离 VPS 和手机都近）
2. Dashboard → **SQL Editor** → 把 `supabase_schema_v2.sql` 整个复制进去 → Run
   - 建了 3 张表（chat_messages / memory_summaries / rism_meta）+ 3 个 RPC 函数 + RLS
3. Dashboard → **Settings → API** 抄下两样：
   - Project URL（`https://xxxx.supabase.co`）
   - `anon` `public` key

## 二、橘瓣 App 配置

### 2.1 原生外置记忆（消息自动同步 + 向量召回，不用插件）

设置 → 扩展 → 外置记忆库 → 新建：

| 项                   | 填什么                                     |
| -------------------- | ------------------------------------------ |
| Supabase URL / Key   | 第一步抄的                                 |
| 表名                 | `chat_messages`（默认就是）                |
| 摘要表名             | `memory_summaries`（默认就是）             |
| autoSaveMessages     | 开（每条消息自动存云）                     |
| autoSaveDiarySummary | 开（每日自动摘要 + 向量）                  |
| recallCount          | 5（每轮自动召回几条关联记忆）              |
| 嵌入模型             | 选一个 embedding 模型（如硅基流动的 bge）  |

然后把这个记忆库挂到 Rism 的 Assistant 上。

### 2.2 rism_memory 插件（结构化记忆工具）

1. 把 `rism_memory/` 整个文件夹传到手机，在橘瓣 → 插件 → 导入
2. 插件设置里填：
   - Supabase URL / anon Key（同上）
   - Assistant 标识：`rism`（默认）
   - VPS 桥地址：`https://克.withtoge.us`（可选，不填则 vps_* 工具不可用）
   - VPS 桥 Token：见下面第三步（可选）
3. 打开插件的 `inject_as_prompt`（让 Rism 知道自己有这些工具）

### 2.3 Rism Assistant

- 系统提示词：从 `~/.claude/skills/rism/SKILL.md` 提炼（plan 2.1 节）
- 世界书：10 个条目（plan 2.2 节的表）
- 模型：Anthropic provider，thinking 选 adaptive/auto

## 三、VPS 桥（可选，给 Rism 运维能力）

VPS 上生成一个 token 并写进 .env，重启：

```bash
ssh -p 25790 root@103.85.25.226
echo "CYBERBOSS_BRIDGE_TOKEN=$(openssl rand -hex 24)" >> /opt/withtoge/.env
grep BRIDGE /opt/withtoge/.env   # 抄下这个 token，填到插件设置里
systemctl restart cyberboss
```

端点（都要 `Authorization: Bearer <token>`）：

- `GET /api/bridge/status` — cyberboss/cloudflared 状态
- `POST /api/bridge/restart` — 重启服务（白名单内：cyberboss/cloudflared）
- `GET /api/bridge/logs?service=cyberboss&lines=50` — 最近日志

不配 token 时桥完全关闭（503），不会裸奔。

## 四、验收清单

- [ ] 对 Rism 说「写条日记试试」→ `diary_write` 成功，Supabase 表里出现 memory_type='diary' 的行
- [ ] 说「今天喝了一点点的芋泥啵啵，八分」→ `bubbletea_write` 成功
- [ ] 随便聊几句 → chat_messages 里自动出现 conversation 行（原生同步在干活）
- [ ] 「查一下 VPS 状态」→ `vps_status` 返回两个服务 active
- [ ] 第二天看 memory_summaries 表有没有出现摘要行（原生日记摘要）
- [ ] 插件详情页手动触发一次 daily_cron → chat_messages 的 heat 有衰减、rism_meta 里有 last_decay_date

## 隐私须知（重要）

- **privacy 字段（normal/intimate/private）是检索礼仪，不是访问控制**——插件搜索默认只出 normal，但拿到 anon key 的人能读整个库
- 所以：**anon key 不要发给任何人**、不要截图带出、Supabase 项目不开公开访问
- 记忆**不可删**：RLS 没有给 anon UPDATE/DELETE 权限，改动只能走三个白名单 RPC（衰减/升温/完成待办）。要真删东西，去 Supabase Dashboard 手动操作
- md 原件（工作区 memory / 日记）**永不删除**，本地永远是冷备份
