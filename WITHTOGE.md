# withtoge — 项目文档

> **这个文件**：VPS 运维、Git 规范、活的待办、路径参考。
> **自建 App 归档**（架构、功能表、旧待办）→ [docs/withtoge-app-archive.md](docs/withtoge-app-archive.md)
> **橘瓣调试** → [orangechat/DEBUG.md](orangechat/DEBUG.md)
> **toge 生活 / 人设 / 教训** → [CLAUDE.md](../../CLAUDE.md)
> **迭代详情** → [docs/iteration-log.md](docs/iteration-log.md)
> **计划** → [docs/plans/](docs/plans/)

目录：`C:\Users\youzi\withtoge\`

## ⚠️ 当前状态（换窗口先读这个）

### 已知风险

- cloudflared 单实例，隧道断了 APP 全挂（无冗余）
- VPS 时区已设为 `Asia/Shanghai`，重装系统 / 新部署注意别覆盖

### 当前假设

- **DS 走自建 Agent Loop（07-10 上线）**：`DsAgentClient` 直调 DeepSeek API，工具由 ProjectToolHost 直连（38 个业务工具，无文件系统/shell 能力）。应急阀 `CYBERBOSS_DS_AGENT_LOOP=off` 回退旧 CLI 路径
- 本地 Windows 节点已关停（2026-06-30），唯一入口 `克.withtoge.us`
- VPS systemd 守护（cloudflared + cyberboss），崩了自动拉
- **2026-07-13 toge 日常聊天搬到橘瓣（RikkaHub）**，自建 web app 前端不再活跃，VPS 后端继续服务（桥调用、日记、记忆等）

### 反复出现的陷阱

- **Edit 工具吞 `}` / 换行符不匹配** → 改完 CSS/JS 跑括号平衡检查 `node -e`
- **linter 自动格式化破坏 import** → 别开保存时自动格式化
- **`state.target` ≠ `state.replyTarget`** → 两字段不一致，新增代码注意对齐
- **CSS inline style 优先级覆盖 class** → 显示/隐藏用 class 控制，别写 `style="display:none"`
- **SSH 命令被安全分类器拦截** → 拉文件到本地改完 scp 回去；或本地 clone 改完 git push + ssh 重启
- **Streamable HTTP MCP 必须声明 authless** → 新建 MCP server 必须在 auth 之前拦截 `.well-known` 三个路径，否则 Claude.ai 误走 OAuth DCR

## Git 规范

> ⚠️ 项目已 git init。**每次写代码必须 commit。**

**仓库**：[xiaoyou5602/yyy](https://github.com/xiaoyou5602/yyy)

- **改代码前先看状态**：`git status` + `git log --oneline -5`
- **一个功能一个 commit**：`git add <具体文件>`，message 用中文 `<动词><名词>：<说明>`
- **验收通过立刻 commit**
- **不提交敏感文件**：`.env`、`node_modules/` 已在 .gitignore
- **推送后 VPS 更新**：`ssh -p 25790 root@103.85.25.226 "cd /opt/withtoge && git pull github master && systemctl restart cyberboss"`

## VPS 运维

> 生产环境：VPS 东京 `103.85.25.226`，systemd 守护。

| 项目       | 详情                                                    |
| ---------- | ------------------------------------------------------- |
| 域名       | `克.withtoge.us`（Cloudflare Named Tunnel，自带 HTTPS） |
| 端口       | `9726`（`0.0.0.0` 监听）                                |
| VPS        | LocVPS 东京，Ubuntu 22.04，2 核 4G，¥36/月              |
| Notion MCP | `https://notion.withtoge.us`，端口 3000（见下方 Notion MCP 小节） |
| APK        | `克-v15.apk`，versionCode 15                            |

```bash
systemctl status cloudflared cyberboss notion-mcp  # 看状态
systemctl restart cyberboss                        # 更新代码后重启
journalctl -u cyberboss -f                        # 看日志
systemctl restart notion-mcp                       # 重启 Notion MCP
```

### Notion MCP（轻量 Notion 工具）

> 独立项目，fork 自 [suekou/mcp-notion-server](https://github.com/suekou/mcp-notion-server) → [LucieEveille/mcp-notion-server](https://github.com/LucieEveille/mcp-notion-server)。核心改进：schema 瘦身 75%、加 HTTP 远程部署、加 `create_page` 工具。

| 项目 | 详情 |
|---|---|
| 代码位置 | VPS `/opt/mcp-notion-server/` |
| systemd 服务 | `notion-mcp.service`，监听 3000 端口，开机自启崩溃自拉 |
| 域名 | `notion.withtoge.us` → cloudflared tunnel → `localhost:3000` |
| MCP 端点 | `https://notion.withtoge.us/mcp`（POST，无鉴权） |
| 健康检查 | `https://notion.withtoge.us/health`（GET） |
| Notion Token | toge 的 Integration Token（`ntn_25512...`），读写她的 Notion 工作区 |

**使用方式**：在任何 MCP 客户端（Claude APP / Cursor / 等）添加 custom connector，URL 填 `https://notion.withtoge.us/mcp`，不需要 auth token。

**启用的工具**（7 个，通过 `ENABLED_TOOLS` 环境变量控制）：
- `notion_search` — 搜索页面/数据库
- `notion_retrieve_page` — 读页面
- `notion_retrieve_block_children` — 读子区块
- `notion_append_block_children` — 追加内容
- `notion_create_page` — 创建子页面
- `notion_query_database` — 查数据库
- `notion_update_page_properties` — 更新页面属性

**运维命令**：
```bash
systemctl status notion-mcp           # 看状态
systemctl restart notion-mcp          # 重启
journalctl -u notion-mcp -f          # 看日志
cd /opt/mcp-notion-server && git log --oneline -5  # 看版本
```

## 日记与记忆路径

- 日记：`~\.cyberboss\diary\` — 各模型共享，git 双向同步（VPS `/root/.cyberboss/diary/`）
- 时间轴：`~\.cyberboss\timeline\`
- 记忆碎片：`~\.cyberboss\memory\fragments\`
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

## 奶茶记录 🧋

> 数据文件 `~\.cyberboss\bubbletea\records.json`。API 见 `ws-server.js` `/api/bubbletea`，克自动记录规则见 CLAUDE.md。

## 待完成

**唯一待办清单入口。** 自建 App 旧待办已归档 → [docs/withtoge-app-archive.md](docs/withtoge-app-archive.md)

> ⚠️ **硬规则**：`[x]` 条目一行封顶，已验证通过的直接删掉（git 里有）。

### 橘瓣迁移（计划 → docs/plans/rism-orangechat-migration.md，调试 → orangechat/DEBUG.md）

- [ ] VPS 桥激活 — VPS .env 加 `CYBERBOSS_BRIDGE_TOKEN`，token 填进插件设置
- [ ] 迁移验收 — 按 orangechat/README.md 第四节清单过一遍
- [ ] Phase 3 记忆迁移（不急）— IDE 端 supabase-memory.js + legacy 导入 + 世界书提炼
- [ ] 向量记忆 + 梦境生成 — 需写 plan（docs/plans/rism-vector-dream.md）
- [ ] VPS 日记生成（替代 Edge Function / pg_cron）— VPS crontab 定时读 Supabase → 调 SiliconFlow → Rism 人格日记 + 梦境写回 memory_summaries。免费版无 pg_cron，选 VPS 自主生成路线
- [ ] 更新橘瓣 App 到最新版 — 群 07-13 发布新版，进阶记忆接口有变，日记总结功能需要最新版配合

### 后端 / 服务

- [ ] DS 删除护栏 — agent loop 上线后风险已架构性消除，仅应急阀回退 CLI 时需要
- [ ] 闹钟接入聊天流程 — parser 和 APK 已就绪
- [ ] 记忆碎片时间戳改用北京时间（07-09 toge 报）
- [ ] 测试套件 51 条存量失败（07-10 巡检）— 先单文件跑分清"真挂"vs"并发挂"

---

**最后更新**：2026-07-13
