# 健康数据 MCP 方案（2026-07-11，v2 定稿）

> **结果**：toge 的小米手环 9 Pro（国行）健康数据 → 标准 Streamable HTTP MCP → 任意 MCP 客户端可用。
>
> **一句话**：Gadgetbridge 把数据写进 Health Connect，HC Webhook 推到 VPS，health-mcp 暴露标准 MCP 端点，RikkaHub / Claude APP / withtoge 都能接。

## 最终架构

```
小米手环 9 Pro (国行)
  │ BLE
  ▼
Gadgetbridge (开源, F-Droid / 官网下载)
  │ 从手环拉数据, 写入
  ▼
Health Connect (Android 系统健康数据总线)
  │ 定时轮询 (15min)
  ▼
HC Webhook app (开源, GitHub Releases 免费 APK)
  │ POST + Bearer token
  ▼
cloudflared 隧道 → 克.withtoge.us
  │
  ├─→ cyberboss → /root/.cyberboss/health/YYYY-MM-DD.json (按天归并)
  │     ├─ health_read / health_summary MCP 工具 (withtoge 各模型)
  │     └─ 内部 API 供 checkin poller 等使用
  │
  └─→ health-mcp (独立 MCP server, :3100)
        ├─ Claude APP custom connector (health.withtoge.us/mcp)
        └─ RikkaHub / 任意 Streamable HTTP MCP 客户端
```

## 为什么是这个架构

- **Gadgetbridge** 不依赖小米运动健康，国行手环的 Health Connect 同步问题一劳永逸。auth key 从 Mi Fitness 的 log 文件提取一次即可。
- **HC Webhook** 是专门为 Health Connect → Webhook 设计的开源 app，比 Health Sync 简单、免费、有自定义 Header 支持。
- **VPS 按天归并 JSON** 而非每次推送存文件，查询 O(1)、去重自动。
- **独立 health-mcp server** 解耦于 cyberboss，挂了不影响聊天；Claude APP / RikkaHub 连接的是标准 Streamable HTTP MCP，不需要 OAuth（`.well-known` 显式声明 authless）。

## 关键踩坑记录

| 坑 | 修法 |
|---|---|
| Claude APP custom connector 报 sign-in service 错误 | `.well-known/oauth-protected-resource` 等端点返回 `404 + JSON {"error":"not_found"}` 明确声明 authless |
| HC Webhook 发数组格式，服务端期望对象 | `mergeHealthData` 兼容两种格式（检测 Array.isArray） |
| HC Webhook Authorization 字段不是 HTTP Header | 在「管理标头」里手动加 `Authorization: Bearer <token>` |
| 国行 Mi Fitness 没有 Health Connect 同步 | 用 Gadgetbridge 完全绕开小米全家桶 |
| 港区 Mi Fitness 绑不了国行手环 | 同上 |

## 手机端配置

### 1. 获取 auth key
小米运动健康 → 我的 → 关于 → 点图标 10 次 → 导出 log → 搜 `encryptKey`（取文件里最后一个）→ 前缀加 `0x`

### 2. Gadgetbridge
- 密钥填 `0x<key>`，16进制
- ⚠️ 不要先在小米运动健康解绑手环，解绑密钥失效
- 设置 → Health Connect 同步 → 开启
- Health Connect 权限页 → Gadgetbridge 全部允许

### 3. HC Webhook
- 数据类型：Steps、Sleep、Heart Rate
- Webhook URL：`https://克.withtoge.us/api/health`
- 管理标头：`Authorization: Bearer <token>`
- 同步间隔：15 分钟

## 服务端

| 组件 | 端口 | 域名 | 说明 |
|---|---|---|---|
| cyberboss | 9726 | 克.withtoge.us | POST/GET `/api/health`、内部 MCP 工具 |
| health-mcp | 3100 | health.withtoge.us | 标准 Streamable HTTP MCP，authless |
| cloudflared | - | - | 隧道，两个子域名都走它 |

## MCP 接入方式

| 客户端 | 接入方式 |
|---|---|
| withtoge 各模型（DS/GLM/Rism） | cyberboss 内部 MCP `health_read` / `health_summary` |
| Claude APP | custom connector → `https://health.withtoge.us/mcp` |
| RikkaHub 等第三方 | 同上，标准 Streamable HTTP |

## 数据格式

每天一个文件 `/root/.cyberboss/health/YYYY-MM-DD.json`：

```json
{
  "date": "2026-07-11",
  "steps": { "total": 8432, "updatedAt": "..." },
  "heart_rate": { "avg": 72, "resting": 58, "samples": [...], "updatedAt": "..." },
  "sleep": { "duration_min": 423, "deep_min": 98, "light_min": 280, "rem_min": 45, "score": 82, "updatedAt": "..." }
}
```

## 开源考虑

- health-mcp 独立于 withtoge，可单独提取为一个 repo
- HC Webhook + Gadgetbridge 都是现成开源软件，无需自己维护手机端
- 整个方案无需付费 app（HC Webhook Play Store 版 $15，GitHub APK 免费）
- 适配国行小米手环的 auth key 提取流程是独有知识
