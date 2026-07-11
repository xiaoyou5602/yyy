# 健康数据 MCP 方案（2026-07-03 立项）

> **目标**：toge 的小米手环 9 Pro 健康数据（睡眠/心率/步数）→ **所有 AI 端都能查**：withtoge 自建（各模型的克）+ 官方 Claude APP + RikkaHub 等任意支持 remote MCP 的平台。
>
> **参考**：toge 提供的《手环mcp教程.docx》（Tasker + Health Connect + VPS 双端口方案）、[LoverConnect](https://github.com/LoverConnect/LoverConnect)（手机本地状态 MCP）。
>
> **最后更新**：2026-07-10（阶段 0 全部完成，手环已到货）

---

## 问题陈述

AI 陪伴 agents（克）需要感知 toge 的身体状态才能做出有意义的主动关怀。CLAUDE.md 里写着「连续几天睡眠不足时更容易情绪崩溃」——但如果克看不到睡眠数据，这句话就是空的。

现有方案的局限：
- **华为 Health Kit API**：个人开发者不可用，已放弃（2026-06）
- **截图 + vision**：可行但被动，需要 toge 主动截图，克无法主动查
- **市面上已有的健康 MCP**：都是本地 stdio 模式，没法给远程 Claude APP / RikkaHub 用

本方案的目标是一个**标准化的、远程可接入的、零运维的健康数据管道**。

---

## 架构（定稿）

```
┌─────────────────────────────────────────────────────────────────────┐
│                         toge 的手机（小米 15）                        │
│                                                                      │
│  小米手环 9 Pro                                                      │
│    │  BLE 5.3                                                        │
│    ▼                                                                 │
│  小米运动健康 app                                                    │
│  （⚠️ 必须开启「同步至 Health Connect」，国行可能需国际版，见风险）   │
│    │                                                                 │
│    ▼                                                                 │
│  Health Connect（Android 系统健康数据总线，API level 34+）            │
│    │                                                                 │
│    ▼                                                                 │
│  Health Sync app                                                     │
│  （定时推送 webhook，比教程的 Tasker 方案简单十倍）                     │
│  - 数据源：Health Connect                                            │
│  - 目标：Webhook                                                     │
│  - URL：https://克.withtoge.us/api/health                            │
│  - Header：Authorization: Bearer <CYBERBOSS_HEALTH_TOKEN>            │
│  - 推送间隔：15 分钟（可调）                                          │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ HTTPS (cloudflared tunnel)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VPS（日本东京 LocVPS，Ubuntu 22.04）              │
│                                                                      │
│  cloudflared tunnel                                                  │
│    ├─ 克.withtoge.us       → localhost:9726 (cyberboss)              │
│    ├─ health.withtoge.us   → localhost:3100 (health-mcp)             │
│    └─ notion.withtoge.us   → localhost:3000 (notion-mcp)             │
│                                                                      │
│  ┌──────────────────────────────────────────┐                        │
│  │  cyberboss (localhost:9726)               │                        │
│  │                                           │                        │
│  │  POST /api/health                         │                        │
│  │    ↑ Health Sync 推数据到这里              │                        │
│  │    - Bearer token 验证                     │                        │
│  │    - Body: { type, data, ... }            │                        │
│  │    - 按天归并写入 /root/.cyberboss/health/ │                        │
│  │      YYYY-MM-DD.json                       │                        │
│  │                                           │                        │
│  │  GET /api/health?days=N&type=X             │                        │
│  │    ↑ 查询端点，给 checkin poller 等内部用    │                        │
│  │                                           │                        │
│  │  内部 MCP 工具 (cyberboss_tools)            │                        │
│  │    - health_read(days, type)              │                        │
│  │    - health_summary(days)                 │                        │
│  │    ↑ withtoge 各模型（DS/GLM/Rism 等）直接用 │                       │
│  └──────────────────────────────────────────┘                        │
│                                                                      │
│  ┌──────────────────────────────────────────┐                        │
│  │  health-mcp (localhost:3100)              │                        │
│  │  systemd: health-mcp.service              │                        │
│  │                                           │                        │
│  │  标准 Streamable HTTP MCP server          │                        │
│  │  - 官方 @modelcontextprotocol/sdk         │                        │
│  │  - 读同一数据目录（只读）                   │                        │
│  │  - 无鉴权（authless），靠 cloudflared      │                        │
│  │    隧道保护                                │                        │
│  │  - 通过 .well-known/* 返回 404 + JSON     │                        │
│  │    明确声明「我不走 OAuth」                 │                        │
│  │                                           │                        │
│  │  Tools:                                   │                        │
│  │    - health_read(days, type)              │                        │
│  │    - health_summary(days)                 │                        │
│  │                                           │                        │
│  │  用途：                                    │                        │
│  │    - Claude APP custom connector          │                        │
│  │    - RikkaHub / 任意 Streamable HTTP 客户端 │                       │
│  └──────────────────────────────────────────┘                        │
│                                                                      │
│  共享数据层：                                                         │
│    /root/.cyberboss/health/YYYY-MM-DD.json                           │
│    ↑ cyberboss 写入，health-mcp 只读                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 为什么是两个 MCP 服务器而不是一个？

| | cyberboss 内部 MCP | health-mcp 独立服务器 |
|---|---|---|
| **协议** | 内部 MCP（与 cyberboss 同进程） | 标准 Streamable HTTP MCP |
| **客户端** | withtoge 各模型（DS/GLM/Rism/OpenClaw） | Claude APP custom connector、RikkaHub |
| **鉴权** | cyberboss 内部，无需额外鉴权 | authless + cloudflared 隧道保护 |
| **部署** | cyberboss_tools 的一部分 | 独立 systemd 服务，端口 3100 |
| **数据** | 读写（写通过 `/api/health` POST） | 只读（同一目录） |

原因：
1. **cyberboss 内部 MCP 不能直接暴露给外部。** cyberboss 跑在 9726，有完整的鉴权和会话管理，不适合作为标准 MCP server 给第三方客户端连接。
2. **Claude APP custom connector 需要标准 Streamable HTTP MCP。** 它不是 cyberboss 的一部分，它是一个独立的、符合 MCP 规范的 HTTP 端点。
3. **解耦部署。** health-mcp 挂了不影响 withtoge 聊天；cyberboss 挂了也不影响 Claude APP 查健康数据。

### 数据流两条路径

```
路径 A（手机 → VPS 存储）：
  Health Sync → POST /api/health → cyberboss → JSON 文件

路径 B（AI 查询）：
  Claude APP → health.withtoge.us/mcp → health-mcp → 读 JSON 文件
  withtoge DS → health_read MCP tool → cyberboss → 读 JSON 文件
```

---

## 关键技术决策

### 1. 为什么用 Health Sync 而不是 Tasker？

教程原方案用 Tasker + Health Data 插件手动拼 JSON。这有几个问题：

- Tasker 配置复杂，需要写 Tasker 脚本拼 HTTP 请求
- 手机杀后台后 Tasker 定时任务可能不触发
- 每次推送一个新文件，需要自己管理文件命名和去重

Health Sync 是专门的健康数据同步 app：
- 原生支持 Health Connect → Webhook 的数据管道
- 自动处理数据去重和增量同步
- 配置只需填 URL 和 header，不需要写任何脚本
- 支持多种数据源和目标（以后想切数据源不用重新配置）

> 教程作者自己也说「Tasker 写起来很累，Health Sync 其实更方便，但我懒得改了」——我们直接选 Health Sync。

### 2. 为什么按天归并而不是每次推送一个文件？

教程的做法是每次推送创建一个新文件（如 `steps_20260710_143022.json`），这导致：
- 同一天的数据散落在多个文件中
- 查询时需要遍历所有文件按日期过滤
- 文件数量随时间线性增长

我们的做法：所有推送写入当天同一个 JSON 文件，按类型归并：
```json
{
  "date": "2026-07-10",
  "steps": { "total": 8432, "updated_at": "2026-07-10T14:30:22+08:00" },
  "heart_rate": { "avg": 72, "resting": 58, "min": 55, "max": 142, "updated_at": "..." },
  "sleep": { "duration_min": 423, "deep_min": 98, "light_min": 280, "rem_min": 45, "score": 82, "updated_at": "..." }
}
```

好处：
- 一天一个文件，查询 O(1)
- 数据自动去重（后推送的覆盖先推送的）
- 文件数 = 天数，不会无限增长
- 方便人类直接打开看

> 这个改进是教程"维护说明"章节自己提出的，我们直接做了。

### 3. 为什么用标准 MCP 协议而不是裸 HTTP？

教程自己实现了一个「伪 MCP」——裸 JSON POST，返回工具列表和调用结果。问题：
- Claude APP connector 不认这个协议，只能连标准 MCP
- RikkaHub 等平台也只支持标准 MCP
- 自己造协议需要自己写客户端，失去「接入各个软件」的意义

标准 Streamable HTTP MCP（`@modelcontextprotocol/sdk`）：
- Claude APP 原生支持
- 有完整的工具发现（`tools/list`）、工具调用（`tools/call`）语义
- 社区生态：任何支持 MCP 的客户端都能接入
- notion-mcp（搭小家）已验证这条路通

### 4. 为什么复用 cloudflared 隧道而不是开裸端口？

教程在 VPS 上开了 8898/8899 两个裸 HTTP 端口。问题：
- 裸 HTTP 没有加密，健康数据明文传输
- 需要额外配置防火墙
- 端口多了管理麻烦

我们的做法：
- cloudflared 已有一条隧道跑着 `克.withtoge.us`
- 加一条 ingress rule：`health.withtoge.us` → `localhost:3100`
- HTTPS 自动处理，证书自动续期
- 不需要开任何新端口
- 不需要配置防火墙

> 教程自己也说「生产环境应该加 Token 和 HTTPS」，cloudflared 两件事一起解决了。

### 5. authless MCP server 的 OAuth 探测问题（已解决）

这是本方案踩过的最隐蔽的坑，也是开源后对社区最有价值的发现。

**现象**：Claude APP 添加 custom connector 时报 `Couldn't register with XXX's sign-in service`。

**根因**：Claude 的 MCP client 在连接任何服务器之前，会先探测三个 OAuth 相关端点：

1. `GET /.well-known/oauth-protected-resource` — 检查是否需要 OAuth
2. `GET /.well-known/oauth-authorization-server` — 获取 OAuth 授权服务器信息
3. `POST /register` — DCR（Dynamic Client Registration）

如果服务器在这些端点返回非标准响应（如纯文本 `Not found` 或 200 + 奇怪 body），Claude client 会**推断**「这个服务器需要 OAuth 但没正确配置」，然后尝试走 OAuth DCR 流程 → 失败 → 报 sign-in service 错误。

**修复**：在 `/mcp` 之前拦截这三个端点，返回**标准的 404 + JSON**：

```javascript
// 必须在 auth check 之前处理
if (req.url === "/.well-known/oauth-protected-resource" ||
    req.url === "/.well-known/oauth-authorization-server" ||
    req.url === "/register") {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
  return;
}
```

关键点：
- **状态码必须是 404**（不是 200、不是 500）
- **Content-Type 必须是 `application/json`**（不是 `text/plain`、不是 `text/html`）
- **body 必须是合法 JSON**（`{"error":"not_found"}`，不能是 `"Not found"`）
- **必须在所有 auth 检查之前处理**（否则 401 又会让 client 以为要走 OAuth）

这个问题在 notion-mcp（搭小家）部署时首次遇到并解决，health-mcp 复用了同样的修复。

---

## 数据格式

### POST /api/health（Health Sync → cyberboss）

```json
{
  "type": "steps",
  "data": {
    "total": 8432,
    "date": "2026-07-10"
  }
}
```

```json
{
  "type": "heart_rate",
  "data": {
    "avg": 72,
    "resting": 58,
    "min": 55,
    "max": 142,
    "date": "2026-07-10"
  }
}
```

```json
{
  "type": "sleep",
  "data": {
    "duration_min": 423,
    "deep_min": 98,
    "light_min": 280,
    "rem_min": 45,
    "score": 82,
    "date": "2026-07-10"
  }
}
```

### 存储格式：`/root/.cyberboss/health/YYYY-MM-DD.json`

```json
{
  "date": "2026-07-10",
  "steps": {
    "total": 8432,
    "updated_at": "2026-07-10T14:30:22+08:00"
  },
  "heart_rate": {
    "avg": 72,
    "resting": 58,
    "min": 55,
    "max": 142,
    "updated_at": "2026-07-10T14:30:22+08:00"
  },
  "sleep": {
    "duration_min": 423,
    "deep_min": 98,
    "light_min": 280,
    "rem_min": 45,
    "score": 82,
    "updated_at": "2026-07-10T08:15:00+08:00"
  }
}
```

- 每次推送覆盖对应类型的字段（不去重历史值）
- `updated_at` 记录每类数据最后一次推送时间
- 文件不存在时自动创建

---

## 实施阶段

### 阶段 0 · 手环到货前就能做（后端全部）✅ 已完成

- [x] cyberboss 加 `POST /api/health`：Bearer token 验证（`.env` 加 `CYBERBOSS_HEALTH_TOKEN`），body 按类型（steps/heart_rate/sleep）归并写入当天 JSON
- [x] `GET /api/health?days=N&type=X` 查询端点
- [x] MCP 工具 `health_read`（仿 whereabouts 模式接入 cyberboss_tools）
- [x] 用 curl 假数据端到端测试（steps/heart_rate/sleep 写入 + 查询验证均通过）
- [x] 独立 `health-mcp` 标准 Streamable HTTP MCP server（Node，官方 SDK），读同一数据目录
- [x] cloudflared ingress 加 `health.withtoge.us` → 3100 端口
- [x] systemd service `health-mcp.service` 已启动，开机自启
- [x] 官 APP custom connector 试接（URL: `https://health.withtoge.us/mcp`）— 已连接。修了 `.well-known` OAuth 探测问题（与 notion-mcp 同款修法，详见「关键技术决策 #5」）

#### 阶段 0 文件清单

| 文件 | 位置 | 说明 |
|---|---|---|
| `index.js` | `/opt/health-mcp/` | health-mcp 服务器主文件 |
| `health-mcp.service` | `/etc/systemd/system/` | systemd 守护配置 |
| `config.yml` | `/root/.cloudflared/` | cloudflared ingress（health.withtoge.us → :3100） |
| health routes | `/opt/withtoge/` (cyberboss) | `POST/GET /api/health` + MCP 工具注册 |
| `.env` | `/opt/withtoge/.env` | `CYBERBOSS_HEALTH_TOKEN=...` |

---

### 阶段 1 · 手环到货后（toge 操作，克远程陪同）🔄 进行中

> ⚠️ 以下操作全部在 toge 的小米 15 手机上完成。

#### 1.1 小米运动健康绑定手环

- [ ] 打开**小米运动健康** app（系统预装或小米应用商店下载）
- [ ] 登录小米账号
- [ ] 添加设备 → 选择「小米手环 9 Pro」
- [ ] 按屏幕提示完成蓝牙配对
- [ ] 确认 app 首页能看到心率、步数、睡眠数据更新

**验证**：在小米运动健康首页下拉刷新，能看到今天的步数和心率。

#### 1.2 开启同步至 Health Connect（最关键一步）

- [ ] 小米运动健康 → 我的 → 设置 → **第三方数据管理**（或「设备授权管理」）
- [ ] 找到 **Health Connect** → 开启同步
- [ ] 勾选要同步的数据类型：**步数、心率、睡眠**（全勾）
- [ ] 如果没有 Health Connect 选项 → 走备选方案（见「风险与备选 #1」）

**如何确认是否已开启**：
- 打开 Health Connect app → 最近的数据 → 能看到来自「小米运动健康」的数据
- 如果没有 Health Connect app → 先做 1.3

#### 1.3 安装 Health Connect

- [ ] Google Play 搜索 **Health Connect**（Google 官方 app，图标是绿色心形 + 连接线）
- [ ] 如果 Play Store 没有 → 从 [APKMirror](https://www.apkmirror.com/apk/google-inc/health-connect/) 下载安装
- [ ] ⚠️ 国行小米 15 可能需要先装 Google Play 框架（设置 → 账号与同步 → 添加 Google 账号，系统会自动引导安装）
- [ ] 打开 Health Connect → 权限管理 → 给**小米运动健康**授权读写步数/心率/睡眠

#### 1.4 配置 Health Sync

- [ ] Google Play 搜索 **Health Sync**（图标是蓝底白色箭头循环）
- [ ] 安装后打开 → 选择数据源：**Health Connect**
- [ ] 选择要同步的数据类型：**步数、心率、睡眠**
- [ ] 选择目标：**Webhook**
- [ ] 填写配置：
  - **URL**：`https://克.withtoge.us/api/health`
  - **HTTP Method**：POST
  - **Headers**：`Authorization: Bearer a98ebdbd27f05ce3681a22d0b778011f7e110c27f852ad73d0595622b652341a`
  - **Content-Type**：`application/json`
- [ ] 同步间隔：默认 15 分钟（可以先设 5 分钟用于测试，确认通后改回 15 分钟）
- [ ] 开启「后台同步」
- [ ] 点击「立即同步」测试

#### 1.5 防杀后台

小米 15（澎湃 OS）会积极杀后台进程，Health Sync 的定时同步可能被阻断。

- [ ] 设置 → 应用 → 应用管理 → Health Sync → **电池** → 选择「无限制」
- [ ] 同一页面 → **自启动** → 开启
- [ ] 最近任务页 → 长按 Health Sync → 锁定（挂锁图标）
- [ ] 可选：开发者选项 → 后台进程限制 → 标准限制（不要设成「不允许后台进程」）

> 这是 LoverConnect README 里的同款注意事项，TogeAlarm 时期在华为手机上踩过完全一样的坑。

#### 1.6 验证

- [ ] 在 VPS 上检查数据文件是否生成：
  ```bash
  ssh root@103.85.25.226 "cat /root/.cyberboss/health/\$(date +%Y-%m-%d).json"
  ```
- [ ] 在 withtoge 里问克：「我今天走了多少步」→ 克应该调用 `health_read` 并回答
- [ ] 在 Claude APP 里问克查健康数据 → 应该通过 health-mcp connector 返回

---

### 阶段 2 · 体验层（数据通了以后）

- [ ] **checkin poller 接健康数据**：克在 toge 连续熬夜/深睡不足时主动关心。CLAUDE.md 本来就写着「连续睡眠不足更容易情绪崩溃」——这就是这条链路的意义。
  - 实现：poller 定时读 `/api/health?days=3&type=sleep`，深睡 < 60min 或总睡眠 < 6h 时触发提醒
- [ ] **APP 小手机页加健康小组件**（可选）：在 withtoge 的小手机仪表盘展示今日步数、昨晚睡眠
- [ ] **官 APP 的克也能查**：connector 配好即达成——Claude APP 里的克调用 `health_read` 跟 withtoge 里完全一致

---

## 风险与备选

### 1. 国行小米运动健康没有 HC 同步开关

**概率**：中。教程用的是港区小米账号 + 国际版 Mi Fitness（`com.xiaomi.wearable`），国行版可能阉割了 Health Connect 同步。

**检测方法**：小米运动健康 → 我的 → 设置 → 搜「Health Connect」或「第三方数据管理」或「设备授权管理」。toge 已确认设置里有这些入口，好兆头。

**备选方案**：
- **备选 A（推荐）**：装国际版 Mi Fitness（Google Play 版 `com.xiaomi.wearable`）+ 小米账号切区绑定手环。教程验证过这条路完全可行。注意：切区后可能需要解绑重绑手环。
- **备选 B**：[Gadgetbridge](https://gadgetbridge.org/)（开源 BLE 直连手环），完全绕开小米全家桶，但手环功能可能受限（通知同步、表盘等），且 BLE 直连耗电更高。
- **备选 C（兜底）**：截图 + vision 识别。华为时期的方案，基础设施还在（`analyze-images.js` + SiliconCloud 视觉 API）。缺点是只能被动查询，不能自动推送。

### 2. 手机杀后台

**概率**：高。澎湃 OS（小米 15 系统）的电池优化非常激进，Health Sync 的定时任务随时可能被冻结。

**缓解**：已列入 1.5 节防杀后台设置。但即使全部设置到位，澎湃 OS 仍可能在某些场景下杀后台（系统更新后重置、电量过低自动省电等）。

**监控**：如果超过 1 小时没有新数据推送 → 克在 checkin 时提醒 toge 检查 Health Sync 是否还活着。

### 3. 官 APP connector 鉴权问题（✅ 已解决）

Claude APP 的 custom connector 对无 OAuth 的服务器会先探测 `.well-known/*` 和 `/register`。如果这些端点返回非标准响应，APP 会默认走 OAuth DCR 流程然后失败。

**解决方案**：在 health-mcp 中显式拦截这三个端点，返回 `404 + JSON {"error":"not_found"}`，明确告诉 Claude client「我是 authless 的，不要尝试 OAuth」。

详见「关键技术决策 #5」。notion-mcp（搭小家）同款修法，已验证有效。

---

## 代码结构

### health-mcp（`/opt/health-mcp/index.js`）

```
依赖：
  @modelcontextprotocol/sdk  — 官方 MCP SDK（Streamable HTTP transport）
  zod                        — 参数校验

端点：
  GET  /health                              — 健康检查（无鉴权）
  GET  /.well-known/oauth-protected-resource — 404 + JSON（声明 authless）
  GET  /.well-known/oauth-authorization-server — 404 + JSON
  POST /register                             — 404 + JSON
  POST /mcp                                  — MCP 协议端点（authless）

工具：
  health_read({ days, type })    — 读取指定天数健康数据
  health_summary({ days })       — 人类可读的健康摘要

数据目录：
  /root/.cyberboss/health/YYYY-MM-DD.json（与 cyberboss 共享，只读）
```

### cyberboss 健康路由（`/opt/withtoge/`）

```
POST /api/health  — 接收 Health Sync 推送，归并写入当天 JSON
GET  /api/health  — 查询端点，支持 ?days=N&type=steps|heart_rate|sleep|all

MCP 工具（cyberboss_tools）：
  health_read      — 同 health-mcp 的 health_read
  health_summary   — 同 health-mcp 的 health_summary
```

---

## 部署参考（给想复现的人）

### 前置条件

- 一台 VPS（本方案：日本东京 LocVPS，2 核 4G，Ubuntu 22.04，¥36/月）
- 一个域名，配置了 Cloudflare（本方案：`withtoge.us`）
- Node.js 18+
- cloudflared tunnel 已配好（本方案复用 withtoge 现有隧道）

### 快速部署

```bash
# 1. 创建 health-mcp 目录
mkdir -p /opt/health-mcp
cd /opt/health-mcp

# 2. 初始化并安装依赖
npm init -y
npm install @modelcontextprotocol/sdk zod

# 3. 复制 index.js（见仓库 /opt/health-mcp/index.js）

# 4. 创建 systemd 服务
cat > /etc/systemd/system/health-mcp.service << 'EOF'
[Unit]
Description=Health MCP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/health-mcp
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
User=root
Environment=PORT=3100

[Install]
WantedBy=multi-user.target
EOF

# 5. 启动
systemctl daemon-reload
systemctl enable --now health-mcp

# 6. 添加 cloudflared ingress rule
# 在 cloudflared config.yml 的 ingress 列表中加入：
#   - hostname: health.your-domain.com
#     service: http://localhost:3100
systemctl restart cloudflared

# 7. 验证
curl https://health.your-domain.com/health
# → {"ok":true,"service":"health-mcp"}

curl -w '\nHTTP %{http_code}' https://health.your-domain.com/.well-known/oauth-protected-resource
# → {"error":"not_found"}
# → HTTP 404
```

### Claude APP 连接

1. Claude APP → Settings → Connectors → Add Custom Connector
2. URL：`https://health.your-domain.com/mcp`
3. 名字随意（toge 取的是「感受温度」）
4. 如果报 sign-in service 错误 → 确认 `.well-known/*` 返回 `404 + JSON`（见「关键技术决策 #5」）

---

## 分工

- **克（2026-07-03 ~ 07-09）**：阶段 0 全部 — 管道先通，假数据跑起来等真数据 ✅
- **克（2026-07-10）**：阶段 0 收尾 — 修 `.well-known` OAuth 探测问题，connector 连通 ✅
- **toge（手环到货后，now）**：阶段 1 手机端操作，克远程陪同排查 🔄
- **克（数据通后）**：阶段 2 — checkin poller 接健康数据、健康小组件
- **新手机兼容测试**（独立事项）：toge 在小米 15 装 withtoge APK/PWA 看兼容

---

## 开源前待办

- [ ] 提取通用配置：把 `克.withtoge.us`、token 等硬编码值改为环境变量 + 配置说明
- [ ] 写 README.md（含架构图、快速开始、常见问题）
- [ ] notion-mcp 和 health-mcp 的 `.well-known` OAuth 踩坑经验整理成一篇独立文档
- [ ] 确认没有泄露个人 token / 敏感信息
- [ ] 考虑把 health-mcp 从 withtoge 仓库独立出来作为一个独立 repo
- [ ] LICENSE 文件
