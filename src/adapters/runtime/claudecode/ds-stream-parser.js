// DS Anthropic 兼容端点的 SSE 解析 + content block 状态机
// 设计依据：test/fixtures/ds-sse/*.sse.txt 实测夹具（docs/plans/ds-agent-loop.md §5.10），不是照官方文档猜的
//
// 一个实例只解析一次 HTTP 响应流，agent loop 每跳新建实例。
// feed(chunk) 接受任意切片边界的 Buffer/string（含多字节 UTF-8 被切断的情况），返回本次新产出的事件数组；
// end() 在流正常/异常结束时调用，负责断流检测（§5.9：SSE 中途断掉必须能发现，不能静默当成功）。
//
// 产出事件（delta 只在内部累积，block_stop 才吐完整块——事件粒度对齐 CLI 现状，见计划 §5.8）：
//   { type: "message_start", messageId, usage }
//   { type: "block", index, block }
//       block = { type: "thinking", thinking, signature }
//             | { type: "text", text }
//             | { type: "tool_use", id, name, input, inputRaw, parseError? }  // parse 失败时 input=null
//   { type: "message_delta", stopReason, usage }
//   { type: "message_stop" }
//   { type: "error", message }

class DsStreamParser {
  constructor() {
    this.decoder = new TextDecoder("utf-8");
    this.lineBuffer = "";      // 不足一行的残余
    this.dataLines = [];       // 当前 SSE 事件累积的 data 行（规范允许多行，DS 实测单行）
    this.blocks = new Map();   // index → 累积中的 content block
    this.sawMessageStop = false;
    this.ended = false;
  }

  feed(chunk) {
    if (this.ended) return [];
    const text = typeof chunk === "string"
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    const events = [];
    this.lineBuffer += text;

    let nl;
    while ((nl = this.lineBuffer.indexOf("\n")) !== -1) {
      let line = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        // 空行 = 事件边界，dispatch 累积的 data
        this.dispatch(events);
        continue;
      }
      if (line.startsWith(":")) continue; // SSE 注释
      if (line.startsWith("data:")) {
        this.dataLines.push(line.slice(5).replace(/^ /, ""));
        continue;
      }
      // event:/id:/retry: 等字段忽略——事件类型以 data JSON 里的 type 为准（Anthropic 双写）
    }
    return events;
  }

  // 流结束（正常或异常）。未收到 message_stop / 有残余 = 断流，必须显式报错
  end() {
    if (this.ended) return [];
    this.ended = true;
    const events = [];
    this.dispatch(events); // 冲掉可能缺尾空行的最后一个事件
    if (!this.sawMessageStop) {
      const detail = this.blocks.size > 0
        ? `stream ended with ${this.blocks.size} unclosed content block(s)`
        : "stream ended before message_stop";
      events.push({ type: "error", message: `SSE 断流: ${detail}` });
    }
    return events;
  }

  dispatch(events) {
    if (this.dataLines.length === 0) return;
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    if (!data || data === "[DONE]") return; // OpenAI 风格哨兵，防御性忽略

    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      events.push({ type: "error", message: `SSE data 不是合法 JSON: ${data.slice(0, 200)}` });
      return;
    }

    switch (msg.type) {
      case "message_start":
        events.push({
          type: "message_start",
          messageId: msg.message?.id || "",
          usage: msg.message?.usage || {},
        });
        break;

      case "content_block_start": {
        const cb = msg.content_block || {};
        // 未知块类型也建槽（delta 忽略、stop 原样吐），向前兼容
        const block =
          cb.type === "thinking" ? { type: "thinking", thinking: cb.thinking || "", signature: cb.signature || "" }
          : cb.type === "text" ? { type: "text", text: cb.text || "" }
          : cb.type === "tool_use" ? { type: "tool_use", id: cb.id || "", name: cb.name || "", jsonParts: [] }
          : { ...cb };
        this.blocks.set(msg.index, block);
        break;
      }

      case "content_block_delta": {
        const block = this.blocks.get(msg.index);
        const delta = msg.delta || {};
        if (!block) break; // 没 start 就 delta：丢弃（防御）
        if (delta.type === "thinking_delta" && block.type === "thinking") block.thinking += delta.thinking || "";
        else if (delta.type === "signature_delta" && block.type === "thinking") block.signature += delta.signature || "";
        else if (delta.type === "text_delta" && block.type === "text") block.text += delta.text || "";
        else if (delta.type === "input_json_delta" && block.type === "tool_use") block.jsonParts.push(delta.partial_json || "");
        break;
      }

      case "content_block_stop": {
        const block = this.blocks.get(msg.index);
        if (!block) break;
        this.blocks.delete(msg.index);
        events.push({ type: "block", index: msg.index, block: finalizeBlock(block) });
        break;
      }

      case "message_delta":
        events.push({
          type: "message_delta",
          stopReason: msg.delta?.stop_reason ?? null,
          usage: msg.usage || {},
        });
        break;

      case "message_stop":
        this.sawMessageStop = true;
        events.push({ type: "message_stop" });
        break;

      case "ping":
        break;

      case "error":
        // Anthropic 风格流内错误事件（overloaded_error 等）
        events.push({
          type: "error",
          message: msg.error?.message || msg.error?.type || "stream error",
        });
        break;

      default:
        break; // 未知事件类型忽略，向前兼容
    }
  }
}

// block_stop 时定稿：tool_use 拼接分片并 parse。
// 空分片 = 无参工具 → input {}；parse 失败（max_tokens 截断等，§5.9）→ parseError 标记，由 client 决定收尾
function finalizeBlock(block) {
  if (block.type !== "tool_use") return block;
  const inputRaw = block.jsonParts.join("");
  const out = { type: "tool_use", id: block.id, name: block.name, input: {}, inputRaw };
  if (inputRaw.trim() === "") return out;
  try {
    out.input = JSON.parse(inputRaw);
  } catch {
    out.input = null;
    out.parseError = true;
  }
  return out;
}

module.exports = { DsStreamParser };
