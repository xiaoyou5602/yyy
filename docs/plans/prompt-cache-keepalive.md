# Prompt Cache Keepalive — 实施计划

> 让 Opus（55api 直调）利用 Anthropic prompt cache 降低 token 消耗。
> 原理：system prompt 加 `cache_control: ephemeral`，后续请求前缀不变 → 缓存命中 → input token 按 1/10 计费。

## 背景

当前 checkin 只对 DS（CLI 模型）生效，Opus 没有缓存续期。55api 已确认**结构上支持** prompt cache（返回 `cache_read_input_tokens` / `cache_creation_input_tokens` 字段）。

## 改动

### 1. `src/core/direct-api-client.js` — 加 cache header + cache_control

```diff
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
+   "anthropic-beta": "prompt-caching-2024-07-31",
  },
```

```diff
  const body = {
    model: apiModel,
    max_tokens: 4096,
+   system: system ? [
+     { type: "text", text: system, cache_control: { type: "ephemeral" } }
+   ] : undefined,
    messages: [
      ...messages,
-     { role: "user", content: text },
+     { role: "user", content: [{ type: "text", text }] },
    ],
  };
```

### 2. `src/app/system-checkin-poller.js` — Opus 轻量 keepalive

新增独立 poller（或扩展现有 poller），对 Opus（api 模型）做：

- 间隔：**4 分钟**（< 5min 缓存 TTL）
- 内容：一个 token 的固定消息，如 `"."` 或空字符串
- 不经过 Claude Code，直接调 `direct-api-client.sendApiTurn()`
- `max_tokens: 1`，克只回一个词
- 目标：输入 token 全部走缓存（cache_read），输出 token 控制在 1-2 个

```js
// 简版 keepalive poller for API models
async function runApiKeepalivePoller(config, modelKey = "opus") {
  const modelConfig = getModelConfig(modelKey);
  while (true) {
    await sleep(4 * 60 * 1000);  // 4 minutes
    await sendApiTurn({
      modelConfig,
      text: ".",
      max_tokens: 1,
      onDone: ({ usage }) => {
        // 记录缓存命中率，不做其他事
        if (usage?.cache_read_input_tokens) {
          console.log(`[keepalive] cache hit: ${usage.cache_read_input_tokens} tokens`);
        }
      },
      onError: () => {}, // 静默忽略错误
    });
  }
}
```

### 3. 启动：app.js 或 main.js

在 `bootstrap` 中 fork 一个 keepalive poller（类似 checkin poller）：

```js
if (config.enableCheckin) {
  runApiKeepalivePoller(config).catch(() => {});
}
```

## 不做什么

- 不改 CLI 模型（DS）的 checkin——它走 CCSwitch，缓存由 CCSwitch/DeepSeek 管理
- 不引入新依赖
- 不做 permafrost 级别的复杂缓存管理

## 验证

1. 发一条 Opus 消息，查看响应 `usage` 中 `cache_creation_input_tokens > 0`
2. 4 分钟内再发一条，查看 `cache_read_input_tokens > 0`
3. 观察 keepalive 日志确认定时触发
4. 对比加缓存前后的 token 消耗（55api 后台或日志）
