const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DsStreamParser } = require("../src/adapters/runtime/claudecode/ds-stream-parser");

const FIXTURE_DIR = path.join(__dirname, "fixtures", "ds-sse");

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, `${name}.sse.txt`)); // Buffer，保持字节级
}

// 整流一次性喂入
function parseWhole(buf) {
  const parser = new DsStreamParser();
  return [...parser.feed(buf), ...parser.end()];
}

// 按固定步长切片喂入（字节级切，会切断多字节 UTF-8 字符）
function parseSliced(buf, step) {
  const parser = new DsStreamParser();
  const events = [];
  for (let i = 0; i < buf.length; i += step) {
    events.push(...parser.feed(buf.subarray(i, i + step)));
  }
  events.push(...parser.end());
  return events;
}

const blocksOf = (events) => events.filter((e) => e.type === "block").map((e) => e.block);
const stopReasonOf = (events) => events.filter((e) => e.type === "message_delta").pop()?.stopReason;
const errorsOf = (events) => events.filter((e) => e.type === "error");

test("text 夹具：thinking + text 两块，end_turn，usage 齐全", () => {
  const events = parseWhole(loadFixture("text"));
  const blocks = blocksOf(events);

  assert.equal(events[0].type, "message_start");
  assert.equal(events[0].usage.input_tokens, 18);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "thinking");
  assert.ok(blocks[0].thinking.length > 0, "thinking 全文应拼接非空");
  assert.ok(blocks[0].signature.length > 0, "signature 应捕获（回传硬约束依赖它）");
  assert.equal(blocks[1].type, "text");
  assert.ok(blocks[1].text.length > 0);
  assert.equal(stopReasonOf(events), "end_turn");
  assert.equal(events.filter((e) => e.type === "message_delta").pop().usage.output_tokens, 32);
  assert.equal(events[events.length - 1].type, "message_stop");
  assert.equal(errorsOf(events).length, 0);
});

test("tool 夹具：18 片 input_json_delta 拼出完整参数", () => {
  const events = parseWhole(loadFixture("tool"));
  const blocks = blocksOf(events);

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.type), ["thinking", "text", "tool_use"]);
  const tool = blocks[2];
  assert.equal(tool.name, "get_weather");
  assert.equal(tool.id, "call_00_R4uVZP0BDPFlgyhyDNCF0636");
  assert.deepEqual(tool.input, { city: "杭州", unit: "celsius" });
  assert.ok(!tool.parseError);
  assert.equal(stopReasonOf(events), "tool_use");
  assert.equal(errorsOf(events).length, 0);
});

test("parallel 夹具：两个 tool_use 块按 index 各自累积，互不串扰", () => {
  const events = parseWhole(loadFixture("parallel"));
  const tools = blocksOf(events).filter((b) => b.type === "tool_use");

  assert.equal(tools.length, 2);
  assert.ok(tools.every((t) => t.name === "get_weather"));
  assert.notEqual(tools[0].id, tools[1].id, "两个块的 id 应不同");
  const cities = tools.map((t) => t.input.city);
  assert.ok(cities.includes("杭州"));
  assert.equal(new Set(cities).size, 2, "两次调用的 city 应不同（杭州+东京）");
  assert.equal(stopReasonOf(events), "tool_use");
});

test("history 夹具：text 块可缺席（thinking 直接接 tool_use）", () => {
  const events = parseWhole(loadFixture("history"));
  const blocks = blocksOf(events);

  assert.deepEqual(blocks.map((b) => b.type), ["thinking", "tool_use"]);
  assert.equal(stopReasonOf(events), "tool_use");
  // 自动 context caching 真实生效的证据
  assert.equal(events[0].usage.cache_read_input_tokens, 384);
});

test("thinking 夹具：170 片 thinking_delta 完整拼接", () => {
  const events = parseWhole(loadFixture("thinking"));
  const blocks = blocksOf(events);

  assert.equal(blocks[0].type, "thinking");
  assert.ok(blocks[0].thinking.length > 100);
  assert.equal(blocks[1].type, "text");
  assert.equal(stopReasonOf(events), "end_turn");
});

test("toolresult 夹具：tool_result 回传后的收尾轮正常解析", () => {
  const events = parseWhole(loadFixture("toolresult"));
  const blocks = blocksOf(events);

  assert.deepEqual(blocks.map((b) => b.type), ["thinking", "text"]);
  assert.equal(stopReasonOf(events), "end_turn");
  assert.equal(events[0].usage.cache_read_input_tokens, 512);
});

test("切片一致性：任意 chunk 边界（含切断中文多字节）结果与整喂一致", () => {
  for (const name of ["text", "tool", "parallel", "history", "thinking", "toolresult"]) {
    const buf = loadFixture(name);
    const whole = parseWhole(buf);
    for (const step of [1, 3, 17, 64, 1024]) {
      assert.deepEqual(parseSliced(buf, step), whole, `${name} 夹具按 ${step} 字节切片应与整喂一致`);
    }
  }
});

test("断流检测：流在中途截断 → end() 报 error（§5.9 依赖）", () => {
  const buf = loadFixture("tool");
  const half = buf.subarray(0, Math.floor(buf.length / 2));
  const parser = new DsStreamParser();
  const events = [...parser.feed(half), ...parser.end()];

  const errors = errorsOf(events);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /断流/);
});

test("非 SSE 输入（HTTP 400 的 JSON body）→ 不产块且报断流", () => {
  const events = parseWhole(loadFixture("toolresult_bare")); // 176 字节的 {"error":{...}}
  assert.equal(blocksOf(events).length, 0);
  assert.ok(errorsOf(events).length >= 1);
});

test("tool_use input JSON 被 max_tokens 截断 → parseError 标记而不是抛异常", () => {
  const stream = [
    'data: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":1}}}',
    "",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"get_weather","input":{}}}',
    "",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\": \\"杭"}}',
    "",
    'data: {"type":"content_block_stop","index":0}',
    "",
    'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":5}}',
    "",
    'data: {"type":"message_stop"}',
    "",
    "",
  ].join("\n");
  const events = parseWhole(Buffer.from(stream, "utf8"));
  const tool = blocksOf(events)[0];

  assert.equal(tool.type, "tool_use");
  assert.equal(tool.parseError, true);
  assert.equal(tool.input, null);
  assert.equal(tool.inputRaw, '{"city": "杭');
  assert.equal(stopReasonOf(events), "max_tokens");
});

test("无参工具：input_json_delta 为空 → input 定稿为 {}", () => {
  const stream = [
    'data: {"type":"message_start","message":{"id":"m1","usage":{}}}',
    "",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"noop","input":{}}}',
    "",
    'data: {"type":"content_block_stop","index":0}',
    "",
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{}}',
    "",
    'data: {"type":"message_stop"}',
    "",
    "",
  ].join("\n");
  const events = parseWhole(Buffer.from(stream, "utf8"));
  const tool = blocksOf(events)[0];

  assert.deepEqual(tool.input, {});
  assert.ok(!tool.parseError);
});

test("流内 error 事件（overloaded 等）→ 转成 error 事件吐出", () => {
  const stream = [
    'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "",
    "",
  ].join("\n");
  const parser = new DsStreamParser();
  const events = [...parser.feed(stream), ...parser.end()];
  assert.ok(errorsOf(events).some((e) => e.message === "Overloaded"));
});

test("CRLF 行尾与 SSE 注释行都能容忍", () => {
  const stream = [
    ": keep-alive comment",
    'data: {"type":"message_start","message":{"id":"m1","usage":{}}}',
    "",
    'data: {"type":"message_stop"}',
    "",
    "",
  ].join("\r\n");
  const events = parseWhole(Buffer.from(stream, "utf8"));
  assert.equal(events[0].type, "message_start");
  assert.equal(errorsOf(events).length, 0);
});
