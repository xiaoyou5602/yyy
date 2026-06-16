const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createDirectWebSocketServer } = require("./ws-server");
const {
  chunkReplyTextForWeixin,
  trimOuterBlankLines,
  normalizeLineEndings,
} = require("../shared/chunking");
const { createMessageStore } = require("../shared/message-store");

const DIRECT_USER_ID = "direct-user";
const DIRECT_CONTEXT_TOKEN = "direct-ctx-1";
const DEFAULT_MIN_CHUNK = 20;
const CHUNK_INTERVAL_MS = 350;

function createDirectChannelAdapter(config) {
  const host = config.directHost || "127.0.0.1";
  const port = config.directPort || 9726;
  const stateDir = config.stateDir;

  let minChunk = DEFAULT_MIN_CHUNK;
  const messageQueue = [];
  let pendingResolve = null;
  let account = {
    accountId: "direct",
    baseUrl: `http://${host}:${port}`,
    token: "",
  };
  let wsServer = null;
  const messageStore = createMessageStore(stateDir);

  function enqueueMessage(msg) {
    const images = Array.isArray(msg.images) ? msg.images : [];
    const files = Array.isArray(msg.files) ? msg.files : [];

    // 先保存图片/文件到磁盘，再存引用到 messageStore
    const savedImages = [];
    for (const img of images) {
      try {
        const saved = saveBase64Attachment({
          data: img.data || "",
          fileName: img.fileName || "image.png",
          contentType: img.contentType || "image/png",
          stateDir,
          receivedAt: msg.receivedAt || new Date().toISOString(),
          messageId: msg.messageId || "",
        });
        if (saved) savedImages.push(saved);
      } catch {}
    }
    const savedFiles = [];
    for (const f of files) {
      try {
        const saved = saveBase64Attachment({
          data: f.data || "",
          fileName: f.fileName || "file",
          contentType: f.contentType || "application/octet-stream",
          stateDir,
          receivedAt: msg.receivedAt || new Date().toISOString(),
          messageId: msg.messageId || "",
        });
        if (saved) savedFiles.push(saved);
      } catch {}
    }

    const label = msg.text || (savedImages.length ? "[图片]" : "") || (savedFiles.length ? "[文件]" : "");
    if (label) {
      const m = String(msg.model || "").trim();
      messageStore.save({
        channel: "direct",
        from: "you",
        text: label,
        images: savedImages.length ? savedImages.map((img) => ({
          path: img.relativePath,
          contentType: img.contentType,
          sourceFileName: img.sourceFileName,
        })) : undefined,
        model: m,
      });
    }
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(msg);
      return;
    }
    messageQueue.push(msg);
  }

  function dequeueWithTimeout(timeoutMs) {
    if (messageQueue.length > 0) {
      return Promise.resolve(messageQueue.shift());
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingResolve = null;
        resolve(null);
      }, Math.max(0, timeoutMs || 100));
      pendingResolve = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
    });
  }

  return {
    describe() {
      return {
        id: "direct",
        kind: "channel",
        host,
        port,
      };
    },

    async login() {
      console.log("[direct] No login required. Just open the browser.");
    },

    printAccounts() {
      console.log("Direct channel has no accounts to manage.");
    },

    resolveAccount() {
      return account;
    },

    getKnownContextTokens() {
      return { [DIRECT_USER_ID]: DIRECT_CONTEXT_TOKEN };
    },

    loadSyncBuffer() {
      return "";
    },

    saveSyncBuffer(_buffer) {
      // no-op for direct channel
    },

    rememberContextToken(_userId, _token) {
      return DIRECT_CONTEXT_TOKEN;
    },

    async getUpdates({ timeoutMs = 2000 } = {}) {
      const msg = await dequeueWithTimeout(timeoutMs);
      if (msg) {
        return { msgs: [msg] };
      }
      return { msgs: [] };
    },

    	    normalizeIncomingMessage(message) {
	      if (!message || typeof message !== "object") {
	        return null;
	      }
	      const text = String(message.text || "").trim();
	      const images = Array.isArray(message.images) ? message.images : [];
	      const files = Array.isArray(message.files) ? message.files : [];
	      if (!text && !images.length && !files.length) {
	        return null;
	      }
	      const persistedAttachments = [];
	      if (images.length) {
	        for (const img of images) {
	          try {
	            const saved = saveBase64Attachment({
	              data: img.data || "",
	              fileName: img.fileName || "image.png",
	              contentType: img.contentType || "image/png",
	              stateDir,
	              receivedAt: message.receivedAt || new Date().toISOString(),
	              messageId: message.messageId || "",
	            });
	            if (saved) persistedAttachments.push(saved);
	          } catch (err) {
	            console.error("[direct] failed to save image:", err.message);
	          }
	        }
	      }
	      if (files.length) {
	        for (const f of files) {
	          try {
	            const saved = saveBase64Attachment({
	              data: f.data || "",
	              fileName: f.fileName || "file",
	              contentType: f.contentType || "application/octet-stream",
	              stateDir,
	              receivedAt: message.receivedAt || new Date().toISOString(),
	              messageId: message.messageId || "",
	            });
	            if (saved) persistedAttachments.push(saved);
	          } catch (err) {
	            console.error("[direct] failed to save file:", err.message);
	          }
	        }
	      }
	      let label = text;
	      if (!label && images.length) label = "[图片]";
	      if (!label && files.length) label = "[文件] " + files.map(f => f.fileName || "file").join(", ");
	      return {
	        provider: "direct",
	        accountId: account.accountId,
	        workspaceId: config.workspaceId || "default",
	        senderId: DIRECT_USER_ID,
	        chatId: DIRECT_USER_ID,
	        messageId: message.messageId || crypto.randomUUID(),
	        threadKey: "direct",
	        text: label,
	        attachments: persistedAttachments,
	        contextToken: DIRECT_CONTEXT_TOKEN,
	        receivedAt: message.receivedAt || new Date().toISOString(),
	        model: String(message.model || "").trim(),
	      };
	    },

	    async sendText({ userId, text, preserveBlock = false, contextToken = "", model = "" }) {
      if (!wsServer) {
        return;
      }
      const content = String(text || "");
      if (!content.trim()) {
        return;
      }
      const m = String(model || "").trim();
      messageStore.save({ channel: "direct", from: "ke", text: content.trim(), model: m });
      const normalized = trimOuterBlankLines(normalizeLineEndings(content));
      if (preserveBlock) {
        wsServer.broadcast({ type: "text", text: normalized, done: true, model: m });
        return;
      }
      const chunks = chunkReplyTextForWeixin(normalized, minChunk);
      if (!chunks.length) {
        wsServer.broadcast({ type: "text", text: "Completed.", done: true, model: m });
        return;
      }
      for (let i = 0; i < chunks.length; i++) {
        wsServer.broadcast({ type: "text", text: chunks[i], chunkIndex: i, done: i === chunks.length - 1, model: m });
        if (i < chunks.length - 1) {
          await sleep(CHUNK_INTERVAL_MS);
        }
      }
    },

    async sendTyping({ userId, status = 1, contextToken = "" }) {
      if (!wsServer) {
        return;
      }
      wsServer.broadcast({ type: "typing", status });
    },

    async sendApproval({ userId, approval }) {
      if (!wsServer) return;
      wsServer.broadcast({
        type: "approval",
        requestId: approval.requestId || "",
        reason: approval.reason || "",
        command: approval.command || "",
        commandTokens: approval.commandTokens || [],
        kind: approval.kind || "",
      });
    },

    async sendFile({ userId, filePath: file, contextToken = "" }) {
      if (!wsServer) {
        return;
      }
      const fileName = path.basename(file);
      wsServer.broadcast({ type: "file", filePath: file, fileName });
    },

    async sendSticker({ stickerId, desc = "" }) {
      if (!wsServer) return;
      wsServer.broadcast({ type: "sticker", stickerId, desc, from: "ke", time: new Date().toISOString() });
    },

    setMinChunkChars(value) {
      const parsed = Number.parseInt(String(value), 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        minChunk = parsed;
      }
      return minChunk;
    },

    getMinChunkChars() {
      return minChunk;
    },

    // Called by app.js after construction to start the server
    async startServer() {
      wsServer = createDirectWebSocketServer({
        host,
        port,
        onMessage: (msg) => enqueueMessage(msg),
        htmlPath: path.join(__dirname, "client", "index.html"),
        diaryDir: config.diaryDir,
        memoryDir: config.memoryDir,
        stateDir: config.stateDir,
      });
      await wsServer.start();
      console.log(`[direct] Chat available at http://${host}:${port}`);
      return wsServer;
    },

    getWsServer() {
      return wsServer;
    },

    async closeServer() {
      if (wsServer) {
        await wsServer.stop();
        wsServer = null;
      }
    },
  };
}

const MIME_TO_EXT = {
	  'text/plain': '.txt',
	  'application/pdf': '.pdf',
	  'application/zip': '.zip',
	  'application/x-rar-compressed': '.rar',
	  'application/x-7z-compressed': '.7z',
	  'application/msword': '.doc',
	  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
	  'application/json': '.json',
	  'text/html': '.html',
	  'text/css': '.css',
	  'text/javascript': '.js',
	  'audio/mpeg': '.mp3',
	  'audio/wav': '.wav',
	  'video/mp4': '.mp4',
	  'video/quicktime': '.mov',
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

const MAX_BASE64_BYTES = 50 * 1024 * 1024; // 50 MB

function saveBase64Attachment({ data, fileName, contentType, stateDir, receivedAt, messageId, allowGeneric = false }) {
  const raw = String(data || "").trim();
  if (!raw) return null;
  if (raw.length > MAX_BASE64_BYTES) {
    console.error("[direct] attachment too large:", raw.length, "bytes");
    return null;
  }

  const bytes = Buffer.from(raw, "base64");
  if (bytes.length === 0) return null;

  const ext = MIME_TO_EXT[normalizeContentType(contentType)]
    || detectExtensionFromBytes(bytes)
    || ".png";

  const safeName = sanitizeFileName(fileName || "image", ext);
  const day = (receivedAt ? new Date(receivedAt) : new Date()).toISOString().slice(0, 10);
  const targetDir = path.join(stateDir || ".cyberboss", "inbox", day);

  fs.mkdirSync(targetDir, { recursive: true });

  let absolutePath;
  for (let i = 0; i < 50; i++) {
    const suffix = i === 0 ? "" : `-${i + 1}`;
    const parsed = path.parse(safeName);
    const candidate = path.join(targetDir, `${parsed.name}${suffix}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      fs.writeFileSync(candidate, bytes);
      absolutePath = candidate;
      break;
    }
  }
  if (!absolutePath) {
    throw new Error("unable to allocate a unique attachment file name");
  }

  const isImage = (contentType || "").startsWith("image/");
  return {
    kind: isImage ? "image" : "file",
    contentType: contentType || "application/octet-stream",
    isImage,
    sourceFileName: fileName || (isImage ? "image.png" : "file"),
    fileName: path.basename(absolutePath),
    absolutePath,
    relativePath: path.relative(stateDir || ".cyberboss", absolutePath).replace(/\\/g, "/"),
    sizeBytes: bytes.length,
  };
}

function detectExtensionFromBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return ".png";
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return ".jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return ".gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return ".webp";
  return "";
}

function sanitizeFileName(rawName, ext) {
  const name = String(rawName || "image").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80);
  const existingExt = path.extname(name).toLowerCase();
  if (existingExt && MIME_TO_EXT[`.${existingExt.slice(1)}`]) return name;
  return `${name}${ext}`;
}

function normalizeContentType(value) {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createDirectChannelAdapter };
