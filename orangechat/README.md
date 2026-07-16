# Rism × OrangeChat 已迁移并解耦

插件、Supabase schema、Assistant 配置、调试手册和迁移计划位于独立 private
仓库：

- GitHub：<https://github.com/xiaoyou5602/rism-orangechat>
- 本地：`C:\Users\youzi\rism-orangechat`

自 2026-07-16 起，OrangeChat 不再依赖本仓库、cyberboss 或 VPS bridge。
旧 `src/adapters/channel/direct/bridge-api.js` 与 `/api/bridge/*` 路由已删除。

本目录中可能仍有被 `.gitignore` 排除的 `_tmp_*` 私人调试数据。它们不是项目
源码，不得提交或批量删除。
