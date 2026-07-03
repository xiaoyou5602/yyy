# 健康数据 MCP 方案(2026-07-03 立项)

> 目标:toge 的小米手环 9 Pro 健康数据(睡眠/心率/步数)→ **所有 AI 端都能查**:withtoge 自建(各模型的克)+ 官方 Claude APP + RikkaHub 等任意支持 remote MCP 的平台。
> 参考:toge 提供的《手环mcp教程.docx》(Tasker+HC+VPS 双端口方案)、[LoverConnect](https://github.com/LoverConnect/LoverConnect)(手机本地状态 MCP)。

## 架构(定稿)

```
小米手环 9 Pro
  → 小米运动健康 app(⚠️ 需开启"同步至 Health Connect",国行可能要国际版 Mi Fitness/港区账号,见风险)
  → Health Connect(Android 系统健康数据总线)
  → Health Sync app(定时推 webhook,比教程的 Tasker 方案简单十倍)
  → POST https://克.withtoge.us/api/health   ← 走现有 cloudflared 隧道,HTTPS,带 token,不开裸端口
  → VPS 存 /root/.cyberboss/health/YYYY-MM-DD.json(按天归并,不学教程每次一个文件)
      ├─→ cyberboss 内部 MCP 工具 health_read / health_summary(withtoge 各模型直接用)
      ├─→ checkin poller 可读健康数据 → 克主动关心("昨晚深睡只有40分钟")
      └─→ health.withtoge.us = 标准 Streamable HTTP MCP server(官 APP custom connector / RikkaHub 用)
```

## 与教程的差异(为什么不照抄)

| 教程做法 | 我们的做法 | 原因 |
|---|---|---|
| VPS 开 8898/8899 裸 HTTP 端口 | 复用 cloudflared 隧道 + HTTPS 子域 | 不暴露端口,自带加密,教程自己都说"生产环境加 Token" |
| 两个独立 Python 裸进程 + nohup | 并入 cyberboss(Node)+ systemd | 已有守护体系,不引入第二技术栈 |
| 自制伪 MCP 协议(裸 JSON POST) | 官方 @modelcontextprotocol/sdk 标准 Streamable HTTP | 教程的协议官 APP connector 不认;标准化才能"接入各个软件"。已有 notion.withtoge.us 部署经验 |
| Tasker + Health Data 插件拼 JSON | Health Sync app 直推 webhook | 教程自己也承认 Tasker 复杂,给了 Health Sync 备选 |
| 数据每次推送存一个文件 | 按天归并 JSON | 教程"维护说明"里自己提的改进,直接做掉 |

## 实施阶段

### 阶段 0 · 手环到货前就能做(后端全部)
- [ ] cyberboss 加 `POST /api/health`:Bearer token 验证(`.env` 加 `CYBERBOSS_HEALTH_TOKEN`),body 按类型(steps/heart_rate/sleep)归并写入当天 JSON
- [ ] `GET /api/health?days=N&type=X` 查询端点
- [ ] MCP 工具 `health_read`(仿 whereabouts 模式接入 cyberboss_tools)
- [ ] 用 curl 假数据端到端测试
- [ ] 独立 `health-mcp` 标准 Streamable HTTP MCP server(Node,官方 SDK),读同一数据目录;cloudflared ingress 加 `health.withtoge.us` → 该服务端口;仿 Notion MCP 部署(systemd)
- [ ] 官 APP custom connector 试接(URL: https://health.withtoge.us/mcp)

### 阶段 1 · 手环到货后(toge 操作,克远程陪同)
- [ ] 小米运动健康绑定手环,开心率/睡眠/步数监测
- [ ] 关键一步:设置里找**「同步至 Health Connect」**(toge 已确认设置里有"第三方数据管理""设备授权管理"入口,好兆头)
- [ ] 装 Health Connect(国行如缺:先装 Google 框架或从 APKMirror 装)+ 给小米运动健康授权
- [ ] 装 Health Sync → 数据源选 Health Connect → 目标选 Webhook → 填 `https://克.withtoge.us/api/health` + token header
- [ ] 验证:VPS 上出现当天 JSON → withtoge 里问克"我今天走了多少步"

### 阶段 2 · 体验层(数据通了以后)
- [ ] checkin poller 接健康数据:克在 toge 连续熬夜/深睡不足时主动关心(CLAUDE.md 本来就写着"连续睡眠不足更容易情绪崩溃"——这就是这条链路的意义)
- [ ] APP 小手机页加健康小组件(可选)
- [ ] 官 APP 的克也能查(connector 配好即达成)

## 风险与备选

1. **国行小米运动健康没有 HC 同步开关**(教程用的是港区账号+国际版):
   - 备选 a:装国际版 Mi Fitness(Google Play 版 com.xiaomi.wearable)+ 小米账号切区绑定手环——教程验证过这条路通
   - 备选 b:Gadgetbridge(开源 BLE 直连手环,完全绕开小米,但功能可能受限)
   - 备选 c(兜底):截图 + vision 识别(华为时期方案,基础设施在)
2. **手机杀后台**(Health Sync 定时任务被澎湃 OS 杀):电池无限制 + 后台保活白名单(LoverConnect 的 README 有同款注意事项;TogeAlarm 时期踩过华为版的这个坑)
3. **官 APP connector 鉴权**:custom connector 对无 OAuth 的 server 支持有限,必要时 MCP URL 用带密钥的路径(`/mcp/<secret>`)做穷人鉴权

## 分工

- **克(手环到货前)**:阶段 0 全部——管道先通,假数据跑起来等真数据
- **toge(手环到货后)**:阶段 1 的手机端操作,克远程陪同排查
- **新手机兼容测试**(独立事项):toge 在小米 15 装 withtoge APK/PWA 看兼容
