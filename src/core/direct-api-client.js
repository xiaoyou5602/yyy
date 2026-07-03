// 直调 Anthropic-compatible API 客户端（纯聊天 / 写日记）
// 不经过 Claude CLI，绕过 CCSwitch/VPN 对子进程的所有劫持

const http = require("http");
const https = require("https");
const { URL } = require("url");

/**
 * 发一轮对话并流式返回
 * @param {Object} opts
 * @param {Object} opts.modelConfig - MODELS 表中的配置 { baseUrl, apiKey, apiModel }
 * @param {string} opts.text - 用户消息文本
 * @param {string} [opts.system] - system prompt
 * @param {Array<{role:string,content:string}>} [opts.messages] - 历史消息（不含当前用户消息）
 * @param {Function} opts.onThinking - 收到 thinking 块时调用 (text)
 * @param {Function} opts.onText - 收到文本块时调用 (text)
 * @param {Function} opts.onDone - 完成时调用 ({ text, thinking })
 * @param {Function} opts.onError - 出错时调用 (error)
 */
async function sendApiTurn({
  modelConfig,
  text,
  system = "",
  messages = [],
  onThinking = () => {},
  onText = () => {},
  onDone = () => {},
  onError = () => {},
}) {
  const { baseUrl, apiKey, apiModel, apiFormat } = modelConfig;
  const format = apiFormat || "anthropic";
  if (!baseUrl || !apiKey || !apiModel) {
    onError(new Error("modelConfig 缺少 baseUrl/apiKey/apiModel"));
    return;
  }

  const isOpenAI = format === "openai";
  const apiPath = isOpenAI ? "/v1/chat/completions" : "/v1/messages";
  const bodyMessages = [...messages, { role: "user", content: text }];
  if (system) {
    if (isOpenAI) bodyMessages.unshift({ role: "system", content: system });
  }
  const body = {
    model: apiModel,
    max_tokens: 4096,
    messages: bodyMessages,
    stream: true,
  };
  if (system && !isOpenAI) body.system = system;
  if (!isOpenAI && modelConfig.thinking) {
    // 思考摘要：原始 COT 任何客户端都拿不到，summarized 是上限。
    // adaptive thinking 时不能带 temperature/top_p/top_k（4.7+ 会 400）
    body.thinking = { type: "adaptive", display: "summarized" };
    body.max_tokens = 16000; // thinking 消耗输出预算，4096 会被思考吃光
  }

  const url = new URL(baseUrl + apiPath);
  const transport = url.protocol === "https:" ? https : http;

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
  if (!isOpenAI) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  const req = transport.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: "POST",
    headers,
    agent: false,
    rejectUnauthorized: false,
  }, (res) => {
    if (res.statusCode !== 200) {
      let errBody = "";
      res.on("data", (c) => (errBody += c));
      res.on("end", () => {
        onError(new Error(`API ${res.statusCode}: ${errBody.slice(0, 300)}`));
      });
      return;
    }

    let buffer = "";
    let fullText = "";
    let fullThinking = "";
    let doneCalled = false;

    const callOnDone = (payload) => {
      if (doneCalled) return;
      doneCalled = true;
      onDone(payload);
    };

    res.on("data", (chunk) => {
      buffer += chunk.toString();

      // SSE 按完整事件切分（"\n\n" 结尾）
      const parts = buffer.split("\n\n");
      buffer = parts.pop(); // 保留未完成的部分

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6);
            if (raw === "[DONE]") {
              callOnDone({ text: fullText, thinking: fullThinking });
              continue;
            }
            try {
              const data = JSON.parse(raw);
              if (isOpenAI) {
                // OpenAI: choices[0].delta.content
                const choice = data.choices?.[0];
                if (choice?.delta?.content) {
                  fullText += choice.delta.content;
                  onText(choice.delta.content);
                }
                if (choice?.finish_reason) {
                  callOnDone({ text: fullText, thinking: fullThinking });
                }
              } else {
                // Anthropic: content_block_delta / thinking_delta / message_stop
                if (data.type === "content_block_delta") {
                  const delta = data.delta;
                  if (delta?.type === "text_delta") {
                    fullText += delta.text;
                    onText(delta.text);
                  } else if (delta?.type === "thinking_delta") {
                    fullThinking += delta.thinking;
                    onThinking(delta.thinking);
                  }
                } else if (data.type === "message_stop") {
                  callOnDone({ text: fullText, thinking: fullThinking });
                }
              }
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }
      }
    });

    res.on("error", (e) => onError(e));
    res.on("end", () => callOnDone({ text: fullText, thinking: fullThinking }));
  });

  req.setTimeout(120_000, () => {
    req.destroy(new Error("API request timed out after 120s"));
  });
  req.on("error", (e) => onError(e));
  req.write(JSON.stringify(body));
  req.end();
}

module.exports = { sendApiTurn };
