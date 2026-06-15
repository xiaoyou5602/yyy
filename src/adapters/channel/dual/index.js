const { createDirectChannelAdapter } = require("../direct");
const { createWeixinChannelAdapter } = require("../weixin");

const DIRECT_USER_ID = "direct-user";
const DIRECT_CONTEXT_TOKEN = "direct-ctx-1";

function createDualChannelAdapter(config) {
  const direct = createDirectChannelAdapter(config);
  const weixin = createWeixinChannelAdapter(config);

  // Track which channel each raw message came from before normalization
  const channelByMessage = new Map();

  function tagChannel(raw, channel) {
    if (!raw || typeof raw !== "object") return raw;
    raw._channel = channel;
    return raw;
  }

  function channelFor(raw) {
    return (raw && typeof raw === "object" && raw._channel === "weixin") ? "weixin" : "direct";
  }

  return {
    describe() {
      return {
        id: "dual",
        kind: "channel",
        direct: direct.describe(),
        weixin: weixin.describe(),
      };
    },

    async login() {
      await weixin.login();
    },

    printAccounts() {
      weixin.printAccounts();
    },

    resolveAccount() {
      return weixin.resolveAccount();
    },

    getKnownContextTokens() {
      return {
        ...weixin.getKnownContextTokens(),
        ...direct.getKnownContextTokens(),
      };
    },

    loadSyncBuffer() {
      return weixin.loadSyncBuffer();
    },

    saveSyncBuffer(buf) {
      weixin.saveSyncBuffer(buf);
    },

    rememberContextToken(userId, token) {
      if (userId === DIRECT_USER_ID) {
        return direct.rememberContextToken(userId, token);
      }
      return weixin.rememberContextToken(userId, token);
    },

    async getUpdates({ timeoutMs = 2000 } = {}) {
      // Direct is event-driven — a short timeout is enough to drain its queue.
      // Weixin does HTTP long polling and benefits from the full timeout window.
      const directTimeout = Math.min(500, timeoutMs);
      const results = await Promise.all([
        direct.getUpdates({ timeoutMs: directTimeout }),
        weixin.getUpdates({ timeoutMs }),
      ]);

      const messages = [];
      for (const msg of results[0]?.msgs || []) {
        messages.push(tagChannel(msg, "direct"));
      }
      for (const msg of results[1]?.msgs || []) {
        messages.push(tagChannel(msg, "weixin"));
      }
      return { msgs: messages };
    },

    normalizeIncomingMessage(message) {
      if (!message || typeof message !== "object") return null;

      const ch = channelFor(message);
      if (ch === "weixin") {
        return weixin.normalizeIncomingMessage(message);
      }
      return direct.normalizeIncomingMessage(message);
    },

    async sendText({ userId, text, preserveBlock = false, contextToken = "" }) {
      const isDirect = userId === DIRECT_USER_ID || contextToken === DIRECT_CONTEXT_TOKEN;
      if (isDirect) {
        return direct.sendText({ userId, text, preserveBlock, contextToken });
      }
      return weixin.sendText({ userId, text, preserveBlock, contextToken });
    },

    async sendTyping({ userId, status = 1, contextToken = "" }) {
      const isDirect = userId === DIRECT_USER_ID || contextToken === DIRECT_CONTEXT_TOKEN;
      if (isDirect) {
        return direct.sendTyping({ userId, status, contextToken });
      }
      return weixin.sendTyping({ userId, status, contextToken });
    },

    async sendFile({ userId, filePath: file, contextToken = "" }) {
      const isDirect = userId === DIRECT_USER_ID || contextToken === DIRECT_CONTEXT_TOKEN;
      if (isDirect) {
        return direct.sendFile({ userId, filePath: file, contextToken });
      }
      return weixin.sendFile({ userId, filePath: file, contextToken });
    },

    setMinChunkChars(value) {
      const v = direct.setMinChunkChars(value);
      weixin.setMinChunkChars(v);
      return v;
    },

    getMinChunkChars() {
      return weixin.getMinChunkChars();
    },

    async startServer() {
      await direct.startServer();
    },

    getWsServer() {
      return direct.getWsServer();
    },

    async closeServer() {
      await direct.closeServer();
    },
  };
}

module.exports = { createDualChannelAdapter };
