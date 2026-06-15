# 微信多窗口问题诊断 · 2026-06-02

## 现象

微信端会话窗口越来越多，从原本 1 个（微信 + 网页端 1 个，电脑端 2 个）持续繁衍到 3+ 个。
同一个 bot 账号下，用户看到多个"克"的会话窗口。

## 当前进程状态

一共 24 个 node 进程，按启动时间分为 4 批，每批包含 1 个主进程 + 3~4 个 MCP server 子进程：

| 批次 | 时间 | 主进程 |
|------|------|--------|
| 第 1 批 | 23:13:20 | PID 61964 `bin/cyberboss.js tool-mcp-server` |
| 第 2 批 | 23:13:41 | PID 53156 `npm run safe`（guardian 壳） → PID 21676 `./bin/cyberboss.js start` |
| 第 3 批 | 23:15:35 | PID 18332 `bin/cyberboss.js tool-mcp-server` |
| 第 4 批 | 23:16:17 | PID 61712 `bin/cyberboss.js tool-mcp-server` |

只有 PID 21676 成功绑定了 4318 端口（location server），后面几批遇到 EADDRINUSE 只跳过 location server，但**微信轮询不受影响，照样跑**。

## 根因分析

### 1. Guardian 没有单例锁（核心问题）

`start-guardian.ps1`（完整代码如下）：

```powershell
while ($true) {
    # 清理 stale socket 文件
    $sockPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock"
    $tokenPath = "$env:USERPROFILE\.cyberboss\claudecode-runtime.sock.token"
    if (Test-Path $sockPath) { Remove-Item -Force $sockPath }
    if (Test-Path $tokenPath) { Remove-Item -Force $tokenPath }

    # 退避策略：300 秒窗口内
    #   < 3 次崩溃 → 等 5 秒
    #   ≥ 3 次   → 等 15 秒
    #   ≥ 5 次   → 等 30 秒
    #   ≥ 8 次   → 等 60 秒

    $process = Start-Process -FilePath "node" -ArgumentList "./bin/cyberboss.js start" -PassThru -NoNewWindow
    Wait-Process -Id $process.Id   # 阻塞等待进程退出
    # 进程退出后 → 记录 → sleep → 重启
}
```

**问题点：**
- 完全不检查是否已有 cyberboss 实例在跑
- 不判断"启动成功"——进程只要没退出就算成功，不等待任何就绪信号（如端口绑定、健康检查）
- 前 3 次崩溃只等 5 秒，如果进程存活 15-20 秒后崩溃，2 分钟内就能拉 4 批
- 可以手动 `npm start` + guardian 的 `npm run safe` 同时跑，互相不知情

### 2. EADDRINUSE 处理太宽容

`src/core/app.js` 第 242-249 行：

```js
} catch (error) {
  if (error.code === "EADDRINUSE") {
    console.warn(
      `locationServer port ${this.config.locationPort} already in use — skipping`
    );
  } else {
    throw error;
  }
}
```

端口被占时只跳过 location server，主循环（微信轮询、消息处理）继续正常运行。所以多实例虽然抢不到 4318，但**每个都在轮询微信 getUpdates、每个都能回复消息**。

### 3. 微信轮询 + context_token 共享

`src/adapters/channel/weixin/index.js` 第 83-136 行，`sendTextChunks`：

```js
function sendTextChunks({ userId, text, contextToken = "", preserveBlock = false }) {
  const account = ensureAccount();
  const resolvedToken = resolveContextToken(userId, contextToken);
  // ...
  await sendText({
    baseUrl: account.baseUrl,
    token: account.token,
    toUserId: userId,
    text: deliveryChunk,
    contextToken: resolvedToken,
    clientId: `cb-${account.accountId}`,  // 刚修过，原来是随机 UUID
  });
}
```

所有实例读同一份 `~/.cyberboss/accounts/<accountId>.context-tokens.json`，用同一个 token 和 bot 账号。微信服务端看到同一 bot 同一 token 但来自不同 TCP 连接的请求，可能创建多个会话窗口。

### 4. clientId （刚修）

之前 `clientId` 每次随机 UUID：`cb-${crypto.randomUUID()}`。已改为固定 `cb-${account.accountId}`。但多实例问题不完全是 clientId 造成的——每个 HTTP 连接本身就是独立的。

### 5. 共享模式有 PID 锁，但普通模式没有

`scripts/shared-common.js` 有完整的 PID 文件管理（`isPidAlive`、`writePidFile`、`removePidFileIfMatches`），但仅在 `shared-start.js` 共享模式下使用。普通 `npm start` / `npm run safe` 不走这条路。

## 修复方案建议

1. **给 Guardian 加单例锁**：启动前写 `guardian.pid`，检查是否已有存活 guardian
2. **给主进程加单例锁**：`app.js` 启动时写 `running.pid`，发现已有实例直接退出
3. **EADDRINUSE 时直接退出**而不是跳过 location server — 端口被占说明已经有实例在跑了
4. **收紧退避窗口**：第一次等 10 秒，第二次 20 秒，减少快速连续起进程

## 相关文件

| 文件 | 作用 |
|------|------|
| `start-guardian.ps1` | 守护/复活脚本 |
| `src/core/app.js` | 主循环、EADDRINUSE 处理、shutdown |
| `src/adapters/channel/weixin/index.js` | 微信轮询、消息发送 |
| `src/adapters/channel/weixin/api.js` | WeChat API 调用（getUpdates/sendText） |
| `scripts/shared-common.js` | PID 管理工具（仅共享模式用） |
| `src/core/config.js` | 端口配置 |
