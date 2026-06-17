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
  const { baseUrl, apiKey, apiModel } = modelConfig;
  if (!baseUrl || !apiKey || !apiModel) {
    onError(new Error("modelConfig 缺少 baseUrl/apiKey/apiModel"));
    return;
  }

  const body = {
    model: apiModel,
    max_tokens: 4096,
    messages: [
      ...messages,
      { role: "user", content: text },
    ],
    stream: true,
  };
  if (system) body.system = system;

  const url = new URL(baseUrl + "/v1/messages");
  const transport = url.protocol === "https:" ? https : http;

  const req = transport.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    // 不走系统代理（防止 TUN/VPN 劫持出网请求）
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
            try {
              const data = JSON.parse(line.slice(6));
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
                onDone({ text: fullText, thinking: fullThinking });
              }
            } catch (e) {
              // 忽略解析失败的行
            }
          }
        }
      }
    });

    res.on("error", (e) => onError(e));
    res.on("end", () => onDone({ text: fullText, thinking: fullThinking }));
  });

  req.on("error", (e) => onError(e));
  req.write(JSON.stringify(body));
  req.end();
}

module.exports = { sendApiTurn };
