# withtoge 项目技术参考

> 通用规则（陪伴底线、生活待办、教训等）在 `~/CLAUDE.md`，所有子工作区自动加载，此处不重复。
> 本文件只放 withtoge 项目（VPS 后端 / 基础设施）的技术细节。cyberboss 已于 2026-07-13 停用，功能迁移至橘瓣 Rism + Supabase。

## 本地 Session 目录结构（⚠️ 重要）

VSCode Claude Code 的 session 文件（JSONL）按工作区存放，映射规则：`C:\Users\youzi` → `C--Users-youzi`（冒号变双横线）。

| 工作区路径                | Session 目录                                    | 用途                                              |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| `C:\Users\youzi`          | `~/.claude/projects/C--Users-youzi/`            | **主工作区**：IDE 端口 + APP 端口混在一起，不分开 |
| `C:\Users\youzi\withtoge` | `~/.claude/projects/C--Users-youzi-withtoge/`   | withtoge 项目工作区                               |
| `C:\Users\youzi\orangechat-rism` | `~/.claude/projects/C--Users-youzi-orangechat-rism/` | 橘瓣 Rism 集成层工作区 |

> **⚠️ 关键事实**：
>
> - **`C--Users-youzi` 是主工作区目录，不是缓存。** APP 端和 IDE 端的 session 从一开始就存在一起，当初故意这样设计的。
> - **这个目录里的 JSONL 是本地唯一数据源。** 不要假设"VPS 上有全量"——没有。VPS 的 `/api/sessions` 只保留最近约两周，且大部分是系统触发空壳，没有实际对话。
> - **任何批量删除/修改这个目录文件的操作必须先问 toge。** 单个文件操作也要确认不是她正在用的端口。
> - `fetch-app-sessions.js` 从 VPS 拉取的只是 APP 端的**增量**，写入的是同一个工作区目录，跟本地 IDE session 混在一起。
> - **⚠️ 2026-07-10 起 APP 端 DS 的新对话拉不到了**：DS 改自建 agent loop 后不再写盘；2026-07-13 cyberboss 全面停用后此链路彻底断供（旧记录不受影响）。新对话直接翻橘瓣聊天记录。

## VPS

### 东京（withtoge）

- withtoge 2026-06-25 搬到日本东京 VPS 了（LocVPS，¥36/月，2 核 4G，Ubuntu 22.04）
- IP `103.85.25.226`，SSH 端口 25790，密钥 `~/.ssh/id_ed25519`
- VPS systemd 运行中：`cloudflared`（隧道）、`notion-mcp`（Notion 工具）、`rism-memory-mcp`（跨端记忆 MCP），崩溃自拉、开机自启

### 洛杉矶（登 Claude 专用梯子）

- **DediRock**，$9.88/年，2026-07-12 购入，工单 #ZYY-556124
- IP `107.174.123.98`（2026-07-23 客服重建，旧 IP `192.236.223.65` 已作废），1 核 2G 30G SSD 2T 流量，Debian 13
- 用途：搭代理登 Claude（必须 LA IP 防风控）
- 已装 Xray Reality（443，systemd 服务 `xray`，开机自启）
- 面板：`billing.dedirock.com`
- **SSH 必须经东京跳板**：本机移动出口到 LA 跨洋丢包 ~40%，直连不稳。`~/.ssh/config` 已配别名 `la-vps`（经东京 ProxyJump），`ssh la-vps` 直达。密码登录已关，仅公钥。
- **代理架构：东京服务端链式**（2026-07-23 定型）。本机→东京8443(Reality)→[东京内部链式]→LA443(Reality)→出口 LA。链式在东京 `xray-front` 服务里完成，**不要用客户端 dialer-proxy 链式**（Mihomo 有 Reality 兼容 bug）。本地 yaml 单节点 `LA-Chain`。细节 → memory/la-vps-dedirock.md + iteration-log 2026-07-23/24 条目
- **cyberboss 已于 2026-07-13 停用**，功能迁移至橘瓣 Rism + Supabase。本地 `127.0.0.1:9726` 已停用。

### VPS 部署（每次 commit 之后）

> ⚠️ **硬规则：本地 commit → push VPS + 推送 GitHub → VPS 拉取。文档类改动到此为止；代码/MCP 变更再手动 restart 对应服务。**

> ⚠️ **推云前本地验证（硬规则）**：代码改完先在本地跑一遍确认能通，再 push VPS。不要改了就推、推了才发现炸。前端 HTML/JS 可以 `node --check` 或本地起静态服务器看一眼；服务端 JS 至少 `node -c` 语法检查。纯 md 改动不用验证。

```bash
# 1. 推送本地到 VPS 裸仓库 + GitHub
git push vps master && git push github master

# 2. VPS 拉取（cyberboss 已停用，无需重启服务；如有 MCP 服务变更需手动 restart）
ssh -p 25790 -i ~/.ssh/id_ed25519 root@103.85.25.226 \
  "cd /opt/withtoge && git pull origin master"
```

### md 同步（2026-07-03 git 化，不再 scp）

> **真源 = git 仓库里的 `WITHTOGE.md`。** `~/CLAUDE.md` 已独立，不再跟本仓库同步。

- **VPS 端**：`/root/CLAUDE.md` 是指向 `/opt/withtoge/CLAUDE.md` 的软链接。**改完 md 立刻 `git add CLAUDE.md WITHTOGE.md && git commit && git push origin master`**。忘了也有 inotify 兜底（`md-autosync` systemd 服务）+ push hook 的 auto-commit，但别依赖兜底。
- **本地端**：`scripts/sync-md.ps1` 只同步 `WITHTOGE.md`（计划任务 `withtoge-md-sync` 每 30 分钟跑）。`~/CLAUDE.md` 是独立文件，手动维护。
- **hook 已改**：push 后 VPS 工作副本用 rebase 合并（不再 reset --hard 抹改动）。
- **冲突**：`pull --rebase` 报冲突时脚本会停下并提示，由克解决后重推。历史都在 git 里，乱了可回退：`git log --oneline CLAUDE.md` → `git checkout <commit> -- CLAUDE.md`。

---

**最后更新**：2026-07-28
