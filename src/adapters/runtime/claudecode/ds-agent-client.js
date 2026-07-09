// DS Agent Loop：HTTP 直调 DeepSeek Anthropic 兼容端点，替代 Claude CLI 子进程
// 设计文档：docs/plans/ds-agent-loop.md（§5 全部小节）；SSE 真实行为依据：test/fixtures/ds-sse/
//
// 接口与 ClaudeCodeProcessClient 对齐（index.js 按 modelKey 分流后两者可互换）：
//   connect / sendUserMessage / sendResponse / waitForSessionId / close / onMessage
//   alive / sessionId / resumeSessionId / pendingTurnId
//
// 关键行为约定（对照 process-client.js 实测，见计划 §5.8）：
// - 事件粒度是"完整块"：thinking/assistant.text 都在块完成时 emit，不吐 delta
// - turn.completed.text = 整轮最终全文（聊天气泡唯一来源）
// - 任何不可恢复失败 emit process.error → 映射 runtime.turn.failed（否则 turn-gate 干等 10 分钟）
// - close() 即中断：abort 在途请求 + 停循环 + 丢弃未执行工具（cancelTurn 的实现就是 close）
// - 工具名以 mcp__cyberboss_tools__ 前缀暴露：app 层自动批准规则（["mcp_tool","cyberboss_tools"]）
//   与前端展示（formatReadableToolName 剥前缀）都依赖这个形态，与 CLI 时代一致

const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { loadWechatInstructions, loadRecentContext, formatNowShanghai } = require("../shared-instructions");

const MCP_TOOL_PREFIX = "mcp__cyberboss_tools__";
const MAX_TOOL_ROUNDS = 15;                 // 单 turn 工具轮数保险丝（§5.9）
const TURN_TIMEOUT_MS = 10 * 60 * 1000;    // 整 turn 兜底，与 turn-gate 卡死判定对齐
const REQUEST_TIMEOUT_MS = 120 * 1000;     // 单请求 socket 超时（对齐 direct-api-client）
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 审批死保险（app 层 2 分钟超时先触发，这里只防 app 层失联）
const HISTORY_MAX_CHARS = 40000;           // 历史窗口，对齐 Opus 路径
const DENY_MESSAGE = "The user denied this tool use. Stop and wait for the user's instructions.";

class DsAgentClient {
  constructor({
    baseUrl,
    apiKey,
    apiModel,
    maxTokens = 0,
    config = {},
    toolHost = null,
    getRecentMessages = null, // () => messageStore 消息数组（app 层已绑定 days/model），运行时组装历史
    ipcServer = null,
    workspaceRoot = "",
    runtimeId = "claudecode:ds",
  }) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.apiKey = apiKey || "";
    this.apiModel = apiModel || "deepseek-v4-pro";
    this.maxTokens = Number(maxTokens) > 0 ? Number(maxTokens) : 8192;
    this.config = config;
    this.toolHost = toolHost;
    this.getRecentMessages = typeof getRecentMessages === "function" ? getRecentMessages : () => [];
    this.ipcServer = ipcServer;
    this.workspaceRoot = workspaceRoot;
    this.runtimeId = runtimeId;

    this.listeners = new Set();
    this.sessionId = "";
    this.resumeSessionId = "";
    this.pendingTurnId = "";
    this._alive = false;
    this.turnRunning = false;
    this.openingDone = false;          // 实例首个 turn 注入 recent-context 回顾，之后不再注入
    this.approvalWaiters = new Map();  // requestId → {resolve, timer}
    this.abortController = null;       // 贯穿当前 turn 的所有在途请求
    this.closed = false;
  }

  get alive() {
    return this._alive && !this.closed;
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, raw = null) {
    if (this.ipcServer) {
      this.ipcServer.broadcast({ type: "processEvent", event, raw });
    }
    for (const listener of this.listeners) {
      try {
        listener(event, raw);
      } catch {
        // ignore
      }
    }
  }

  // 无子进程可 spawn：connect 只负责确立 sessionId 并立即上报。
  // resume 时沿用旧 threadId 当 sessionId（clientMatchesThread / sessionStore 的路由都靠它），
  // 历史本来就从 messageStore 重组装，不存在"resume 失败另开 session"的问题
  async connect(resumeSessionId = "") {
    if (this.closed) throw new Error("DsAgentClient already closed");
    const resume = normalizeSessionId(resumeSessionId);
    this.resumeSessionId = resume;
    this.sessionId = resume || crypto.randomUUID();
    this._alive = true;
    this.emit({ type: "session.id", sessionId: this.sessionId }, null);
  }

  async waitForSessionId() {
    if (!this.alive) throw new Error("ds agent client not running");
    return this.sessionId;
  }

  // 与 process-client 同语义：写入即返回，turn 异步推进
  async sendUserMessage({ text, threadId }) {
    if (!this.alive) throw new Error("ds agent client not running");
    if (this.turnRunning) throw new Error("ds agent turn already in progress");
    const normalizedText = String(text || "").trim();
    this.pendingTurnId = `turn-${Date.now()}`;
    if (threadId && normalizeSessionId(threadId)) {
      this.sessionId = normalizeSessionId(threadId);
    }
    if (this.ipcServer) {
      this.ipcServer.broadcast({ type: "inboundMessage", workspaceRoot: this.workspaceRoot, text: normalizedText });
    }
    this.turnRunning = true;
    this.runTurn(normalizedText, this.pendingTurnId).catch((error) => {
      // runTurn 内部已兜底，这里只防兜底自身抛异常
      console.error(`[ds-agent] unexpected turn error: ${error?.message || error}`);
    });
  }

  async runTurn(userText, turnId) {
    const abort = new AbortController();
    this.abortController = abort;
    const turnTimer = setTimeout(() => {
      abort.abort(new Error(`turn exceeded ${TURN_TIMEOUT_MS / 60000} minutes`));
    }, TURN_TIMEOUT_MS);

    this.emit({ type: "turn.started", turnId, sessionId: this.sessionId }, null);

    const finalTexts = [];
    try {
      // /compact 是 Claude CLI 的斜杠命令，DS API 不认识（§5.8）——拦截为普通完成
      if (userText === "/compact") {
        this.emitTurnCompleted(turnId, "该模型不支持 /compact——历史窗口每轮自动按最近对话重组，不需要手动压缩。");
        return;
      }

      const system = loadWechatInstructions(this.config);
      const messages = this.buildHistoryMessages();
      messages.push({ role: "user", content: this.buildCurrentUserContent(userText) });

      const tools = this.buildToolDefinitions();

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (round === MAX_TOOL_ROUNDS) {
          finalTexts.push("（这轮我调工具的次数到上限了，先停下来。如果事情还没做完，跟我说声继续。）");
          break;
        }
        const response = await this.requestWithRetry({ system, messages, tools }, abort.signal);

        // 完整块按到达顺序 emit（粒度对齐 CLI：整块，非 delta）
        const toolUses = [];
        for (const block of response.blocks) {
          if (block.type === "thinking" && block.thinking) {
            this.emit({ type: "thinking", text: block.thinking.trim(), turnId, sessionId: this.sessionId }, null);
          } else if (block.type === "text" && block.text) {
            this.emit({ type: "assistant.text", text: block.text.trim(), turnId, sessionId: this.sessionId }, null);
            finalTexts.push(block.text.trim());
          } else if (block.type === "tool_use") {
            toolUses.push(block);
          }
        }
        if (response.usage) {
          this.emit({ type: "context.updated", usage: response.usage, turnId, sessionId: this.sessionId }, null);
        }

        if (response.stopReason !== "tool_use" || toolUses.length === 0) {
          break; // 正常收尾（含 max_tokens 截断的纯文本轮）
        }

        // 硬约束（§5.10 实测）：assistant 必须原样回传本响应全部块（thinking 含 signature），
        // 只回 tool_use 会被 DS 400 拒。inputRaw/parseError 是解析器内部字段，回传前剥掉
        messages.push({ role: "assistant", content: response.blocks.map(toApiBlock) });

        const toolResults = [];
        for (const tool of toolUses) {
          toolResults.push(await this.executeToolWithApproval(tool, turnId, abort.signal));
        }
        messages.push({ role: "user", content: toolResults });
      }

      this.emitTurnCompleted(turnId, finalTexts.join("\n\n"));
    } catch (error) {
      if (this.closed) return; // close() 主动中断：cancelTurn 语义，不再发失败事件
      const message = error?.message || String(error || "unknown error");
      console.error(`[ds-agent] turn failed: ${message}`);
      this.emit({
        type: "process.error", // events.js 映射为 runtime.turn.failed → turn-gate 释放（§5.9）
        error: `DS agent turn failed: ${message}`,
        sessionId: this.sessionId,
        turnId,
      }, null);
    } finally {
      clearTimeout(turnTimer);
      if (this.abortController === abort) this.abortController = null;
      this.turnRunning = false;
      this.pendingTurnId = "";
    }
  }

  emitTurnCompleted(turnId, text) {
    this.emit({ type: "turn.completed", turnId, sessionId: this.sessionId, text: text || "" }, null);
  }

  // 历史组装：仿 Opus 路径（app.js conversationHistory），存储完整、召回精简（§5.7）
  buildHistoryMessages() {
    let raw = [];
    try {
      raw = this.getRecentMessages() || [];
    } catch (error) {
      console.warn(`[ds-agent] failed to load history: ${error?.message || error}`);
      return [];
    }
    const picked = [];
    let charCount = 0;
    for (let i = raw.length - 1; i >= 0; i--) {
      const m = raw[i];
      if (!m || m.from === "thinking" || m.from === "tool_call" || m.from === "tool_result") continue;
      const role = m.from === "you" ? "user" : "assistant";
      const text = String(m.text || "").trim();
      if (!text) continue;
      // 系统轮 JSON 协议回复与错误提示不算对话内容（对齐 Opus 路径过滤）
      if (role === "assistant" && (text.startsWith("{") || text.startsWith("❌"))) continue;
      if (charCount + text.length > HISTORY_MAX_CHARS) break;
      picked.unshift({ role, content: text });
      charCount += text.length;
    }
    // Anthropic 消息约束：首条必须 user，相邻同角色合并（连发消息会产生连续 user 条目）
    while (picked.length && picked[0].role !== "user") picked.shift();
    const merged = [];
    for (const msg of picked) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) last.content += `\n\n${msg.content}`;
      else merged.push({ ...msg });
    }
    return merged;
  }

  // 当轮 user 消息：时间锚点每轮都带（放这里不放 system，保住 DeepSeek 前缀缓存）；
  // recent-context 回顾只在实例首 turn 注入（对齐 CLI opening turn 行为，系统轮首发同样受益——
  // 顺手修掉 07-04"裸 spawn 系统轮只有 checkin 上下文"的坑，§5.6 修订）
  buildCurrentUserContent(userText) {
    const parts = [`【当前时间】${formatNowShanghai()}。历史消息里的时间戳都是过去的时刻，判断"刚才/昨晚/今天"以本行为准。`];
    if (!this.openingDone) {
      this.openingDone = true;
      const recent = loadRecentContext(this.config);
      if (recent) {
        parts.push("", recent, "", "请自然地延续最近的对话，不要复述这段回顾。");
      }
    }
    parts.push("", userText);
    return parts.join("\n");
  }

  buildToolDefinitions() {
    if (!this.toolHost) return [];
    try {
      return this.toolHost.listTools().map((tool) => ({
        name: `${MCP_TOOL_PREFIX}${tool.name}`,
        description: tool.description || "",
        input_schema: tool.inputSchema || { type: "object", properties: {} },
      }));
    } catch (error) {
      console.warn(`[ds-agent] listTools failed: ${error?.message || error}`);
      return [];
    }
  }

  // 审批 → 执行 → tool_result。全部工具都走 approval.requested：
  // cyberboss_tools 前缀会被 app 层自动批准规则毫秒放行，其余弹窗（复用现有链路，§5.5）
  async executeToolWithApproval(tool, turnId, signal) {
    const resultBase = { type: "tool_result", tool_use_id: tool.id };
    if (tool.parseError) {
      // max_tokens 截断等导致参数 JSON 不完整（§5.9）：回 is_error 让模型收敛，不炸整轮
      return { ...resultBase, is_error: true, content: "tool input JSON was truncated/invalid; adjust and retry" };
    }
    // 响应里的工具名规范化成带前缀形态——审批自动放行规则与前端展示都认这个形态，
    // 不赌模型一定原样回注册名（剥了前缀/幻觉裸名都兜得住）
    const prefixedName = tool.name.startsWith(MCP_TOOL_PREFIX) ? tool.name : `${MCP_TOOL_PREFIX}${tool.name}`;
    this.emit({ type: "tool.use", toolName: prefixedName, input: tool.input || {}, turnId, sessionId: this.sessionId }, null);

    const requestId = `ds-approval-${crypto.randomUUID()}`;
    // ⚠️ 先注册 waiter 再 emit：emit 同步调用监听器，app 层自动批准可能在同一调用栈里就
    // sendResponse——晚注册会丢掉回应，干等 5 分钟死保险（单测实测踩过）
    const approvalPromise = this.waitForApproval(requestId, signal);
    this.emit({
      type: "approval.requested",
      requestId,
      toolName: prefixedName,
      input: tool.input || {},
      sessionId: this.sessionId,
      turnId,
    }, null);
    const approved = await approvalPromise;
    if (!approved) {
      this.emit({ type: "tool.result", toolResult: DENY_MESSAGE, isError: true, turnId, sessionId: this.sessionId }, null);
      return { ...resultBase, is_error: true, content: DENY_MESSAGE };
    }

    const bareName = prefixedName.slice(MCP_TOOL_PREFIX.length);
    try {
      const result = await this.toolHost.invokeTool(bareName, tool.input || {}, {
        workspaceRoot: this.workspaceRoot,
        runtimeId: this.runtimeId,
        threadId: this.sessionId,
        model: this.apiModel,
      });
      const text = typeof result?.text === "string" && result.text
        ? result.text
        : JSON.stringify(result?.data ?? result ?? "");
      this.emit({ type: "tool.result", toolResult: text, isError: false, turnId, sessionId: this.sessionId }, null);
      return { ...resultBase, content: text };
    } catch (error) {
      const message = error?.message || String(error || "tool failed");
      this.emit({ type: "tool.result", toolResult: message, isError: true, turnId, sessionId: this.sessionId }, null);
      return { ...resultBase, is_error: true, content: message };
    }
  }

  waitForApproval(requestId, signal) {
    return new Promise((resolve) => {
      const entry = {
        resolve: (value) => {
          clearTimeout(entry.timer);
          signal.removeEventListener("abort", entry.onAbort);
          this.approvalWaiters.delete(requestId);
          resolve(value);
        },
        // app 层 2 分钟超时会主动 decline；这里只是 app 层失联时的死保险
        timer: setTimeout(() => {
          console.warn(`[ds-agent] approval ${requestId} timed out locally, treating as decline`);
          entry.resolve(false);
        }, APPROVAL_TIMEOUT_MS),
        onAbort: () => entry.resolve(false),
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
      this.approvalWaiters.set(requestId, entry);
    });
  }

  // index.js respondApproval 透传：{decision:"accept"|"decline"}（buildApprovalResponsePayload 形态）
  async sendResponse(requestId, payload = {}) {
    const entry = this.approvalWaiters.get(requestId);
    if (!entry) throw new Error(`no pending ds approval for requestId=${requestId}`);
    const approved = payload.decision === "accept" || payload.behavior === "allow";
    entry.resolve(approved);
  }

  // close = 中断（§5.1）：cancelTurn 的实现就是它。abort 在途请求、停循环、拒掉审批等待
  async close() {
    if (this.closed) return;
    this.closed = true;
    this._alive = false;
    if (this.abortController) {
      this.abortController.abort(new Error("client closed"));
    }
    for (const entry of [...this.approvalWaiters.values()]) {
      entry.resolve(false);
    }
    this.approvalWaiters.clear();
    this.sessionId = "";
    this.resumeSessionId = "";
    this.pendingTurnId = "";
    this.turnRunning = false;
  }

  // ---- HTTP 层（§5.9 错误处理）----

  // 仅对 429/5xx/网络错误指数退避重试 2 次；4xx fail-fast
  async requestWithRetry(payload, signal) {
    const delays = [1000, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(payload, signal);
      } catch (error) {
        const retriable = error?.retriable === true;
        if (!retriable || attempt >= delays.length || signal.aborted) throw error;
        console.warn(`[ds-agent] request failed (attempt ${attempt + 1}): ${error.message}, retrying in ${delays[attempt]}ms`);
        await sleep(delays[attempt], signal);
      }
    }
  }

  // 单次流式请求 → 解析为 {blocks, stopReason, usage}
  requestOnce({ system, messages, tools }, signal) {
    // 延迟 require：与 parser 同目录，避免循环依赖风险为零但保持顶部整洁
    const { DsStreamParser } = require("./ds-stream-parser");
    const body = JSON.stringify({
      model: this.apiModel,
      max_tokens: this.maxTokens,
      stream: true,
      system,
      messages,
      ...(tools && tools.length ? { tools } : {}),
    });
    const url = new URL(this.baseUrl + "/v1/messages");
    const transport = url.protocol === "http:" ? http : https;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "http:" ? 80 : 443),
          path: url.pathname,
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            const chunks = [];
            res.on("data", (d) => chunks.push(d));
            res.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              const detail = extractErrorMessage(raw) || raw.slice(0, 300);
              const error = new Error(`DS API ${res.statusCode}: ${detail}`);
              error.statusCode = res.statusCode;
              error.retriable = res.statusCode === 429 || res.statusCode >= 500;
              reject(error);
            });
            res.on("error", reject);
            return;
          }

          const parser = new DsStreamParser();
          const blocks = [];
          let stopReason = null;
          let usage = null;
          let streamError = null;

          const consume = (events) => {
            for (const event of events) {
              if (event.type === "block") blocks.push(event.block);
              else if (event.type === "message_start") usage = mergeUsage(usage, event.usage);
              else if (event.type === "message_delta") {
                stopReason = event.stopReason ?? stopReason;
                usage = mergeUsage(usage, event.usage);
              } else if (event.type === "error" && !streamError) {
                streamError = new Error(event.message);
                streamError.retriable = true; // 断流/流内 overloaded 都值得重试
              }
            }
          };

          res.on("data", (chunk) => consume(parser.feed(chunk)));
          res.on("end", () => {
            consume(parser.end());
            if (streamError) reject(streamError);
            else resolve({ blocks, stopReason, usage });
          });
          res.on("error", (error) => {
            error.retriable = true;
            reject(error);
          });
        }
      );
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(Object.assign(new Error(`DS API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`), { retriable: true }));
      });
      req.on("error", (error) => {
        if (error?.retriable === undefined && !signal.aborted) error.retriable = true; // 网络层错误可重试
        reject(error);
      });
      req.write(body);
      req.end();
    });
  }
}

// 回传给 API 前剥掉解析器内部字段（inputRaw/parseError 不是 Anthropic content block 的合法字段）
function toApiBlock(block) {
  if (block.type === "tool_use") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input || {} };
  }
  if (block.type === "thinking") {
    return { type: "thinking", thinking: block.thinking, signature: block.signature };
  }
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  return block;
}

function mergeUsage(base, next) {
  if (!next || typeof next !== "object") return base;
  return { ...(base || {}), ...next };
}

function extractErrorMessage(raw) {
  try {
    return JSON.parse(raw)?.error?.message || "";
  } catch {
    return "";
  }
}

function normalizeSessionId(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

module.exports = { DsAgentClient };
