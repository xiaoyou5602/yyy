const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { DsAgentClient } = require("../src/adapters/runtime/claudecode/ds-agent-client");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "ds-sse");
const fixture = (name) => fs.readFileSync(path.join(FIXTURE_DIR, `${name}.sse.txt`));

// 假 DS 端点：按脚本依次回应，记录每次请求体（回放真实夹具 = 不打真 API 的端到端）
function createFakeEndpoint() {
  const state = { requests: [], script: [], server: null, baseUrl: "" };
  state.server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      state.requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const step = state.script.shift() || { status: 500, body: '{"error":{"message":"script exhausted"}}' };
      if (step.delayMs) {
        const timer = setTimeout(() => respond(res, step), step.delayMs);
        req.on("close", () => clearTimeout(timer));
        return;
      }
      respond(res, step);
    });
  });
  function respond(res, step) {
    res.writeHead(step.status || 200, { "content-type": step.status === 200 ? "text/event-stream" : "application/json" });
    res.end(step.body ?? fixture(step.fixture));
  }
  return new Promise((resolve) => {
    state.server.listen(0, "127.0.0.1", () => {
      state.baseUrl = `http://127.0.0.1:${state.server.address().port}`;
      resolve(state);
    });
  });
}

function createClient(endpoint, overrides = {}) {
  return new DsAgentClient({
    baseUrl: endpoint.baseUrl,
    apiKey: "test-key",
    apiModel: "deepseek-v4-pro",
    config: {},
    toolHost: {
      listTools: () => [{
        name: "get_weather",
        description: "查询天气",
        inputSchema: { type: "object", properties: { city: { type: "string" } } },
      }],
      invokeTool: async () => ({ text: "杭州：晴，31°C", data: {} }),
    },
    getRecentMessages: () => [],
    workspaceRoot: "/tmp/ws",
    ...overrides,
  });
}

// 收集事件直到 turn 终结（turn.completed / process.error），带超时保护
function runTurnAndCollect(client, text, { onEvent, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => reject(new Error(`turn did not finish; got: ${events.map((e) => e.type).join(",")}`)), timeoutMs);
    client.onMessage((event) => {
      events.push(event);
      if (onEvent) onEvent(event);
      if (event.type === "turn.completed" || event.type === "process.error") {
        clearTimeout(timer);
        resolve(events);
      }
    });
    client.sendUserMessage({ text }).catch(reject);
  });
}

test("纯文本 turn：事件序列与最终文本对齐 CLI 协议", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());
  endpoint.script.push({ status: 200, fixture: "text" });

  const client = createClient(endpoint);
  await client.connect();
  assert.ok(client.sessionId, "connect 后立即有 sessionId");
  assert.equal(await client.waitForSessionId(), client.sessionId);

  const events = runTurnAndCollect(client, "你好");
  assert.ok(client.pendingTurnId, "sendUserMessage 后立即有 pendingTurnId（sendTurn 依赖）");
  const collected = await events;

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["turn.started", "thinking", "assistant.text", "context.updated", "turn.completed"]);
  const completed = collected[collected.length - 1];
  assert.ok(completed.text.length > 0, "turn.completed.text 是聊天气泡唯一来源，不能为空");
  assert.equal(client.pendingTurnId, "", "turn 结束后 pendingTurnId 清空");

  // 请求体：system 独立参数 + 当轮 user 消息带时间锚点（不进 system，保前缀缓存）
  const req = endpoint.requests[0];
  assert.equal(req.stream, true);
  assert.ok(Array.isArray(req.tools) && req.tools[0].name === "mcp__cyberboss_tools__get_weather", "工具名带 MCP 前缀暴露");
  assert.ok(req.tools[0].input_schema, "inputSchema → input_schema 字段名转换");
  const lastMsg = req.messages[req.messages.length - 1];
  assert.match(lastMsg.content, /【当前时间】/);
  assert.match(lastMsg.content, /你好/);
});

test("工具 loop：审批放行 → invokeTool → 完整块回传（thinking 硬约束）→ 收尾", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());
  endpoint.script.push({ status: 200, fixture: "tool" }, { status: 200, fixture: "toolresult" });

  const invoked = [];
  const client = createClient(endpoint, {
    toolHost: {
      listTools: () => [{ name: "get_weather", description: "", inputSchema: { type: "object" } }],
      invokeTool: async (name, args, context) => {
        invoked.push({ name, args, context });
        return { text: "杭州：晴，31°C" };
      },
    },
  });
  await client.connect();

  // ⚠️ onEvent 在 client.emit 的 try/catch 里执行，assert 失败会被静默吞掉变成超时——
  // 这里只收集+响应，断言全部放事后
  const approvalEvents = [];
  const events = await runTurnAndCollect(client, "查下杭州天气", {
    onEvent: (event) => {
      if (event.type === "approval.requested") {
        approvalEvents.push(event);
        client.sendResponse(event.requestId, { decision: "accept" }).catch(() => {});
      }
    },
  });
  assert.equal(approvalEvents.length, 1);
  assert.equal(approvalEvents[0].toolName, "mcp__cyberboss_tools__get_weather",
    "审批事件工具名必须规范化成带前缀形态（自动批准规则依赖），即使模型回的是裸名");

  // 工具执行：剥前缀还原裸名，context 带路由信息
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].name, "get_weather");
  assert.deepEqual(invoked[0].args, { city: "杭州", unit: "celsius" });
  assert.equal(invoked[0].context.workspaceRoot, "/tmp/ws");

  // 第二跳请求体：assistant 完整块原样回传（§5.10 硬约束——漏 thinking 会被 DS 400）
  assert.equal(endpoint.requests.length, 2);
  const secondReq = endpoint.requests[1];
  const assistantMsg = secondReq.messages[secondReq.messages.length - 2];
  assert.equal(assistantMsg.role, "assistant");
  const blockTypes = assistantMsg.content.map((b) => b.type);
  assert.deepEqual(blockTypes, ["thinking", "text", "tool_use"]);
  assert.ok(assistantMsg.content[0].signature, "thinking 块必须带 signature 回传");
  assert.equal(assistantMsg.content[0].inputRaw, undefined, "解析器内部字段不得泄漏进 API 请求");
  const toolResultMsg = secondReq.messages[secondReq.messages.length - 1];
  assert.equal(toolResultMsg.role, "user");
  assert.equal(toolResultMsg.content[0].type, "tool_result");
  assert.equal(toolResultMsg.content[0].content, "杭州：晴，31°C");

  // 事件链完整：tool.use / tool.result 都在，最终文本拼接两跳
  const types = events.map((e) => e.type);
  assert.ok(types.includes("tool.use") && types.includes("tool.result") && types.includes("approval.requested"));
  const completed = events[events.length - 1];
  assert.equal(completed.type, "turn.completed");
  assert.ok(completed.text.includes("\n\n"), "多跳文本按空行拼接");
});

test("审批拒绝：不执行工具，回 is_error 的 tool_result 让模型收敛", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());
  endpoint.script.push({ status: 200, fixture: "tool" }, { status: 200, fixture: "toolresult" });

  let invokeCount = 0;
  const client = createClient(endpoint, {
    toolHost: {
      listTools: () => [{ name: "get_weather", description: "", inputSchema: { type: "object" } }],
      invokeTool: async () => { invokeCount++; return { text: "should not happen" }; },
    },
  });
  await client.connect();

  await runTurnAndCollect(client, "查天气", {
    onEvent: (event) => {
      if (event.type === "approval.requested") {
        client.sendResponse(event.requestId, { decision: "decline" }).catch(() => {});
      }
    },
  });

  assert.equal(invokeCount, 0, "拒绝后不得执行工具");
  const toolResult = endpoint.requests[1].messages.at(-1).content[0];
  assert.equal(toolResult.is_error, true);
  assert.match(toolResult.content, /denied/);
});

test("5xx 自动重试后成功；4xx fail-fast 走 turn.failed", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());

  // 场景 1：500 → 重试 → 200
  endpoint.script.push(
    { status: 500, body: '{"error":{"message":"upstream hiccup"}}' },
    { status: 200, fixture: "text" },
  );
  const client = createClient(endpoint);
  await client.connect();
  const events = await runTurnAndCollect(client, "你好", { timeoutMs: 10000 });
  assert.equal(events[events.length - 1].type, "turn.completed", "500 重试后应成功");
  assert.equal(endpoint.requests.length, 2);

  // 场景 2：400 不重试，emit process.error（turn-gate 释放依赖它）
  endpoint.requests.length = 0;
  endpoint.script.push({ status: 400, body: '{"error":{"message":"bad request"}}' });
  const client2 = createClient(endpoint);
  await client2.connect();
  const events2 = await runTurnAndCollect(client2, "你好");
  const last = events2[events2.length - 1];
  assert.equal(last.type, "process.error");
  assert.match(last.error, /400/);
  assert.equal(endpoint.requests.length, 1, "4xx 不得重试");
});

test("close() 即中断：在途请求被 abort，不再发 turn 终结事件（cancelTurn 语义）", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());
  endpoint.script.push({ status: 200, fixture: "text", delayMs: 30000 }); // 永远等不到的响应

  const client = createClient(endpoint);
  await client.connect();
  const events = [];
  client.onMessage((e) => events.push(e));
  await client.sendUserMessage({ text: "你好" });
  await new Promise((r) => setTimeout(r, 150)); // 让请求真正发出去
  await client.close();
  await new Promise((r) => setTimeout(r, 300));

  assert.equal(client.alive, false);
  const types = events.map((e) => e.type);
  assert.ok(!types.includes("turn.completed") && !types.includes("process.error"),
    `close 中断后不得再发终结事件，got: ${types.join(",")}`);
});

test("/compact 拦截：不打 API，直接回不支持说明", async (t) => {
  const endpoint = await createFakeEndpoint();
  t.after(() => endpoint.server.close());

  const client = createClient(endpoint);
  await client.connect();
  const events = await runTurnAndCollect(client, "/compact");

  assert.equal(endpoint.requests.length, 0, "不得发 HTTP 请求");
  const completed = events[events.length - 1];
  assert.equal(completed.type, "turn.completed");
  assert.match(completed.text, /不支持/);
});

test("历史组装：过滤 thinking/tool 记录、JSON 协议回复，合并连续同角色，首条必为 user", () => {
  const client = new DsAgentClient({
    baseUrl: "http://127.0.0.1:1",
    apiKey: "k",
    getRecentMessages: () => [
      { from: "ke", text: "假期开头这条应被丢弃（首条必须 user）" },
      { from: "you", text: "第一条" },
      { from: "thinking", text: "思考存档不算对话" },
      { from: "tool_call", text: "工具调用记录（§5.7 前瞻）" },
      { from: "you", text: "第二条（与第一条合并）" },
      { from: "ke", text: '{"action":"silent"}' },
      { from: "ke", text: "❌ 错误提示不算" },
      { from: "ke", text: "好的收到~" },
    ],
  });
  const messages = client.buildHistoryMessages();

  assert.deepEqual(messages, [
    { role: "user", content: "第一条\n\n第二条（与第一条合并）" },
    { role: "assistant", content: "好的收到~" },
  ]);
});

test("recent-context 回顾只注入实例首 turn，时间锚点每轮都带", (t) => {
  const stateDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ds-agent-test-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(stateDir, "recent-context.md"), "## 最近对话回顾\n聊到奶茶", "utf8");

  const client = new DsAgentClient({ baseUrl: "http://127.0.0.1:1", apiKey: "k", config: { stateDir } });
  const first = client.buildCurrentUserContent("第一轮");
  const second = client.buildCurrentUserContent("第二轮");

  assert.match(first, /【当前时间】/);
  assert.match(first, /聊到奶茶/);
  assert.match(second, /【当前时间】/);
  assert.ok(!second.includes("聊到奶茶"), "回顾只注入一次");
});
