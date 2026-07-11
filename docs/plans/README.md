# Plan 索引

> 计划文件统一放在这里。用有意义的名字，不要随机动物名。
> 执行完标记状态，废弃的移到 `archive/` 或删除。
> 
> **最后更新**：2026-07-11

## 约定

- **文件名**：`<功能>-<简述>.md`，一眼能看出是干什么的
- **状态**：`📋 计划中` / `🚧 执行中` / `✅ 完成` / `❌ 废弃`
- **完成后**：更新状态 + 在 [iteration-log.md](../iteration-log.md) 写一笔关键决策
- **不要攒尸**：废弃的计划直接删，完成了的超过一个月可归档
- **Claude Code 自动生成的 plan（随机动物名）**：整理完立刻给有意义的名字，移到这个目录，索引登记。不要让 `.claude/plans/` 变成第二个 plan 坟场。

## 当前计划

| 状态 | 文件 | 简述 | 日期 |
|------|------|------|------|
| 🚧 执行中 | [zone-skin-architecture.md](zone-skin-architecture.md) | 聊天页独立 UI / 皮肤架构：轻档主题 + 重档渲染器 + zone 模板化 | 2026-07-05 |
| 📋 计划中 | [ds-agent-loop.md](ds-agent-loop.md) | 自搭 DS Agent Loop，替换 Claude CLI 子进程，省 Anthropic 官方 prompt token | 2026-07-09 |
| ✅ 完成 | [health-mcp.md](health-mcp.md) | 健康数据 MCP：手环 → Gadgetbridge → HC Webhook → VPS，心率已入仓 | 2026-07-11 |
| 📋 计划中 | [memory-architecture.md](memory-architecture.md) | 记忆架构重构：Notion 轻量化 + 三端统一 + Rism 独立记忆目录 | 2026-07-07 |
| 📋 计划中 | [prompt-cache-keepalive.md](prompt-cache-keepalive.md) | Opus（55api）加 Anthropic prompt cache + 4 分钟 keepalive 续期 | 2026-07-07 |
| 📋 计划中 | [memory-improvements.md](memory-improvements.md) | 记忆系统四项改进（subtype / 证据链 / 意图搜索 / episode candidate） | 2026-07-07 |
| 📋 计划中 | [sticker-sync-fix.md](sticker-sync-fix.md) | 贴纸同步修复 + DS 页贴纸支持 + 缓存版本对齐 | 2026-07-08 |
| 📋 计划中 | [chat-search-optimize.md](chat-search-optimize.md) | 聊天记录搜索优化（chat-history 替代 JSONL） | 2026-07-08 |

## ⚠️ `.claude/plans/` 遗留文件

> Claude Code 的 EnterPlanMode 自动生成，随机动物名。**3 个已迁移到本目录**（见上表），1 个仅作参考，1 个重复待删。

| 随机文件名 | 内容 | 去向 |
|-----------|------|------|
| `fable-plan-parallel-rabbit.md` | 主题专区页面详细设计 | 📎 保留（zone-skin-architecture 子文档），不另建 |
| `fuzzy-strolling-ember.md` | → 已迁移为 `memory-improvements.md` | ✅ 已迁 |
| `mutable-humming-parrot.md` | 与 ds-agent-loop.md 重复 | ❌ 待删 |
| `polished-sleeping-catmull.md` | → 已迁移为 `sticker-sync-fix.md` | ✅ 已迁 |
| `calm-frolicking-cascade.md` | → 已迁移为 `chat-search-optimize.md` | ✅ 已迁 |

## 已完成

| 文件 | 简述 | 完成日期 |
|------|------|----------|
| [已完成/session-context-relay.md](已完成/session-context-relay.md) | DS session 自动接续上下文（recent-context.md 回顾注入） | 2026-07-04 |
| [app-bug-fix.md](app-bug-fix.md) | APP 端 COT 丢失 + 聊天记录刷新丢失 + 重连稳定性 | 2026-07-08 |

## 废弃

| 文件 | 简述 | 废弃原因 |
|------|------|----------|
| — | — | — |
