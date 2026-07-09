// 步骤 0：实测 DS Anthropic 兼容端点的 SSE 真实行为（docs/plans/ds-agent-loop.md §8）
// 用法：node scripts/capture-ds-sse.js <scenario>
//   scenario ∈ text | tool | parallel | thinking | toolresult | all
// 输出：test/fixtures/ds-sse/<scenario>.sse.txt（原始 SSE 流）+ stdout 摘要
// ⚠️ 夹具是 tool_use 状态机（ds-stream-parser.js）的设计依据和测试基准，不要手改内容

const https = require("https");
const fs = require("fs");
const path = require("path");

// 依次尝试：仓库根 .env → VPS 部署路径（脚本可 scp 到 /tmp 单独跑）；dotenv 不覆盖已有值，多次调用安全
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch {}
try { require("dotenv").config({ path: "/opt/withtoge/.env" }); } catch {}

const BASE_URL = process.env.CYBERBOSS_DEEPSEEK_ENDPOINT || "https://api.deepseek.com/anthropic";
const API_KEY = process.env.CYBERBOSS_DEEPSEEK_KEY || "";
const MODEL = "deepseek-v4-pro";
const FIXTURE_DIR = process.env.DS_FIXTURE_DIR || path.join(__dirname, "..", "test", "fixtures", "ds-sse");

const TOOLS = [
  {
    name: "get_weather",
    description: "查询指定城市的当前天气",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，例如：杭州" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "温度单位" },
      },
      required: ["city"],
    },
  },
  {
    name: "save_note",
    description: "保存一条备忘笔记",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "笔记标题" },
        content: { type: "string", description: "笔记正文" },
      },
      required: ["title", "content"],
    },
  },
];

const SCENARIOS = {
  // 基线：纯文本回复，看 text_delta 粒度
  text: {
    body: {
      model: MODEL,
      max_tokens: 300,
      stream: true,
      system: "你是一个测试助手，回答尽量简短。",
      messages: [{ role: "user", content: "用一句话介绍你自己。" }],
    },
  },
  // 单工具触发：看 content_block_start(tool_use) / input_json_delta 是否分片 / stop_reason
  tool: {
    body: {
      model: MODEL,
      max_tokens: 500,
      stream: true,
      system: "你是一个测试助手。需要查天气时必须调用 get_weather 工具，不要凭空编造。",
      messages: [{ role: "user", content: "帮我查一下杭州现在的天气。" }],
      tools: TOOLS,
    },
  },
  // 并行工具：一次回复里多个 tool_use block，验证 index 追踪是否必要
  parallel: {
    body: {
      model: MODEL,
      max_tokens: 800,
      stream: true,
      system: "你是一个测试助手。需要查天气时必须调用 get_weather 工具。可以在一次回复中并行发起多个工具调用。",
      messages: [{ role: "user", content: "同时查一下杭州和东京两个城市的天气，请在一次回复里发起两个工具调用。" }],
      tools: TOOLS,
    },
  },
  // thinking 参数探测：兼容层认不认 Anthropic 的 thinking 参数、thinking block 怎么流式给
  thinking: {
    body: {
      model: MODEL,
      max_tokens: 1000,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 512 },
      system: "你是一个测试助手，回答尽量简短。",
      messages: [{ role: "user", content: "9.11 和 9.9 哪个大？想清楚再答。" }],
    },
  },
  // 第二轮请求：回传 tool_result 后模型的收尾响应（agent loop 第二跳的格式验证）。
  // ⚠️ 实测（tool.sse.txt）：DS thinking 模式要求 assistant 消息把 thinking block（含 signature）
  // 原样回传，只回传 tool_use 会 400（复现见 toolresult_bare）。以下用 tool 场景的真实输出构造。
  toolresult: {
    body: {
      model: MODEL,
      max_tokens: 500,
      stream: true,
      system: "你是一个测试助手。需要查天气时必须调用 get_weather 工具，不要凭空编造。",
      messages: [
        { role: "user", content: "帮我查一下杭州现在的天气。" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "用户想查询杭州现在的天气。我需要调用 get_weather 工具，城市参数为\"杭州\"。温度单位没有指定，我可以使用默认的摄氏度。",
              signature: "d8ef2c4b-3e94-4df5-87b5-92b20ad3a1c1",
            },
            { type: "text", text: "好的，我来帮您查询杭州的天气。" },
            { type: "tool_use", id: "call_00_R4uVZP0BDPFlgyhyDNCF0636", name: "get_weather", input: { city: "杭州", unit: "celsius" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_00_R4uVZP0BDPFlgyhyDNCF0636",
              content: "杭州：晴，31°C，湿度 62%，东南风 2 级",
            },
          ],
        },
      ],
      tools: TOOLS,
    },
  },
  // 跨 turn 历史重组装形态（§5.2）：多轮纯文本历史，assistant 不带 thinking block。
  // 验证"必须回传 thinking"是否只限同轮 tool_use 回传，不波及普通历史（波及的话 messageStore 方案要重设计）
  history: {
    body: {
      model: MODEL,
      max_tokens: 500,
      stream: true,
      system: "你是一个测试助手。需要查天气时必须调用 get_weather 工具，不要凭空编造。",
      messages: [
        { role: "user", content: "你好呀" },
        { role: "assistant", content: "你好~有什么可以帮你的吗？" },
        { role: "user", content: "我在纠结明天穿什么" },
        { role: "assistant", content: [{ type: "text", text: "可以先看看天气再决定，要帮你查一下吗？" }] },
        { role: "user", content: "好，查一下杭州的。" },
      ],
      tools: TOOLS,
    },
  },
  // 400 复现固化：不带 thinking 回传 → "The `content[].thinking` in the thinking mode must be passed back"
  toolresult_bare: {
    body: {
      model: MODEL,
      max_tokens: 500,
      stream: true,
      system: "你是一个测试助手。需要查天气时必须调用 get_weather 工具，不要凭空编造。",
      messages: [
        { role: "user", content: "帮我查一下杭州现在的天气。" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call_fixture_001", name: "get_weather", input: { city: "杭州" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_fixture_001", content: "杭州：晴，31°C，湿度 62%，东南风 2 级" },
          ],
        },
      ],
      tools: TOOLS,
    },
  },
};

function capture(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`未知场景: ${name}（可选：${Object.keys(SCENARIOS).join(" | ")} | all）`);
    process.exit(1);
  }
  return new Promise((resolve) => {
    const url = new URL(BASE_URL.replace(/\/$/, "") + "/v1/messages");
    const payload = JSON.stringify(scenario.body);
    const chunks = [];
    let statusCode = 0;

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        statusCode = res.statusCode;
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const outPath = path.join(FIXTURE_DIR, `${name}.sse.txt`);
          fs.mkdirSync(FIXTURE_DIR, { recursive: true });
          fs.writeFileSync(outPath, raw, "utf8");
          summarize(name, statusCode, raw, outPath);
          resolve();
        });
      }
    );
    req.setTimeout(60_000, () => {
      console.error(`[${name}] 超时（60s）`);
      req.destroy();
      resolve();
    });
    req.on("error", (e) => {
      console.error(`[${name}] 请求失败: ${e.message}`);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

function summarize(name, statusCode, raw, outPath) {
  console.log(`\n===== [${name}] HTTP ${statusCode} → ${path.relative(process.cwd(), outPath)} (${raw.length} bytes) =====`);
  if (statusCode !== 200) {
    console.log(raw.slice(0, 2000));
    return;
  }
  const events = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") { events.push({ type: "[DONE]" }); continue; }
    try { events.push(JSON.parse(data)); } catch { events.push({ type: "!!UNPARSEABLE", raw: data.slice(0, 120) }); }
  }
  // 事件序列（含 block type / delta type / index，一眼看清状态机要处理的形状）
  const seq = events.map((e) => {
    if (e.type === "content_block_start") return `block_start[${e.index}]:${e.content_block?.type}${e.content_block?.type === "tool_use" ? `(${e.content_block.name})` : ""}`;
    if (e.type === "content_block_delta") return `delta[${e.index}]:${e.delta?.type}`;
    if (e.type === "content_block_stop") return `block_stop[${e.index}]`;
    if (e.type === "message_delta") return `message_delta(stop=${e.delta?.stop_reason ?? "-"})`;
    return e.type;
  });
  // 连续相同项折叠成 xN
  const folded = [];
  for (const s of seq) {
    const last = folded[folded.length - 1];
    if (last && last.s === s) last.n++;
    else folded.push({ s, n: 1 });
  }
  console.log(folded.map((f) => (f.n > 1 ? `${f.s} x${f.n}` : f.s)).join("\n"));

  const msgStart = events.find((e) => e.type === "message_start");
  const msgDelta = events.filter((e) => e.type === "message_delta").pop();
  if (msgStart) console.log(`usage@message_start: ${JSON.stringify(msgStart.message?.usage)}`);
  if (msgDelta) console.log(`usage@message_delta: ${JSON.stringify(msgDelta.usage)} stop_reason: ${msgDelta.delta?.stop_reason}`);
  // input_json_delta 分片情况：每个 tool_use block 收到多少个 delta 分片
  const jsonDeltaByIndex = {};
  for (const e of events) {
    if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta") {
      jsonDeltaByIndex[e.index] = (jsonDeltaByIndex[e.index] || 0) + 1;
    }
  }
  if (Object.keys(jsonDeltaByIndex).length) console.log(`input_json_delta 分片数/块: ${JSON.stringify(jsonDeltaByIndex)}`);
}

(async () => {
  if (!API_KEY) {
    console.error("缺少 CYBERBOSS_DEEPSEEK_KEY（.env）");
    process.exit(1);
  }
  const arg = process.argv[2] || "all";
  const names = arg === "all" ? Object.keys(SCENARIOS) : [arg];
  for (const n of names) await capture(n);
})();
