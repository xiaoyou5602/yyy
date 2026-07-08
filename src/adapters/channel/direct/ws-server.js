const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { createMessageStore } = require("../shared/message-store");
const { resolveModelKey, modelToDisplayName, ALL_MODEL_KEYS } = require("../../../core/config");
const { parseArchive, combineConversations, getConversationMessages, searchMessages, ARCHIVE_BASE } = require("../../../services/chat-archive-parser");

function createDirectWebSocketServer({ host, port, onMessage, htmlPath, diaryDir, memoryDir, stateDir }) {
  let wss = null;
  let server = null;
  const clients = new Set();
  let lastKeMessage = { time: "", text: "" };
  const pendingApprovals = new Map(); // requestId → { requestId, reason, command, kind, model, createdAt }
  const clientDir = path.dirname(htmlPath);
  const worldbookDir = path.join(stateDir, "worldbook");

  const staticFiles = {
    "/manifest.json": "application/json",
    "/sw.js": "application/javascript",
  };

  const messageStore = stateDir ? createMessageStore(stateDir) : null;

  // ── Chat archive parser cache ──
  const archiveCachePath = path.join(stateDir, "chat-archives-parsed.json");
  let archiveParsed = parseArchive(ARCHIVE_BASE, archiveCachePath);

  function importChatFile(folder, filename, content) {
    const dir = path.join(ARCHIVE_BASE, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Sanitize filename
    const safe = filename.replace(/[<>:"/\\|?*]/g, "_");
    const filePath = path.join(dir, safe);
    fs.writeFileSync(filePath, content, "utf8");
    // Invalidate cache so next parse picks it up
    try { fs.unlinkSync(archiveCachePath); } catch {}
    archiveParsed = parseArchive(ARCHIVE_BASE, archiveCachePath);
  }

  const serverInstance = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const query = parseQuery(req.url);

    // ── API: messages (shared chat history) ──
    if (urlPath === "/api/messages") {
      try {
        const days = Math.min(Number.parseInt(query.days, 10) || 7, 60);
        const modelFilter = query.model !== undefined ? String(query.model).trim() : undefined;
        const messages = messageStore ? messageStore.load(days, modelFilter) : [];
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(messages));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: diary ──
    if (urlPath === "/api/diary") {
      try {
        const days = Math.min(Number.parseInt(query.days, 10) || 7, 60);
        const entries = readDiaryEntries(diaryDir, days);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(entries));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: memory fragments ──
    if (urlPath === "/api/memory") {
      try {
        const days = Math.min(Number.parseInt(query.days, 10) || 7, 60);
        const model = query.model || "";
        const fragments = readMemoryFragments(memoryDir, days, model);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(fragments));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: search chat history ──
    if (urlPath === "/api/search") {
      try {
        const q = (query.q || "").trim();
        if (!q || q.length < 1) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ results: [] }));
          return;
        }
        const results = searchTranscripts(q);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ results }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: conversations (chat archive memory) ──

    // GET /api/conversations — 会话列表
    if (urlPath === "/api/conversations" && req.method === "GET") {
      try {
        const conversations = combineConversations(archiveParsed);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ conversations }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/conversations/search — 搜索消息
    if (urlPath === "/api/conversations/search" && req.method === "GET") {
      try {
        const q = (query.q || "").trim();
        const date = query.date || "";
        if (!q || q.length < 1) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ results: [] }));
          return;
        }
        const results = searchMessages(archiveParsed, q, date || undefined);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ results }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/conversations/refresh — 强制刷新缓存（必须在正则路由之前）
    if (urlPath === "/api/conversations/refresh" && req.method === "POST") {
      try {
        try { fs.unlinkSync(archiveCachePath); } catch {}
        archiveParsed = parseArchive(ARCHIVE_BASE, archiveCachePath);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, conversations: combineConversations(archiveParsed).length }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/conversations/import — 导入 .md 文件
    if (urlPath === "/api/conversations/import" && req.method === "POST") {
      try {
        const contentType = req.headers["content-type"] || "";
        if (contentType.includes("application/json")) {
          // JSON body: { folder, filename, content }
          const chunks = [];
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => {
            try {
              const { folder, filename, content } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (!folder || !filename || !content) { res.writeHead(400); res.end(JSON.stringify({ error: "folder, filename, content required" })); return; }
              importChatFile(folder, filename, content);
              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ ok: true, imported: filename }));
            } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
          });
        } else if (contentType.includes("multipart/form-data")) {
          // Multipart: folder field + file(s)
          const chunks = [];
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => {
            try {
              const buf = Buffer.concat(chunks);
              const boundary = extractBoundary(contentType);
              if (!boundary) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing boundary" })); return; }
              const parts = parseMultipart(buf, boundary);
              const folder = parts.fields && parts.fields.folder ? parts.fields.folder.trim() : "";
              if (!folder) { res.writeHead(400); res.end(JSON.stringify({ error: "folder field required" })); return; }
              const imported = [];
              // Handle single file
              if (parts.file) {
                importChatFile(folder, parts.file.filename || "imported.md", parts.file.data ? parts.file.data.toString("utf8") : "");
                imported.push(parts.file.filename);
              }
              // Handle multiple files (if parseMultipart supports it)
              if (parts.files) {
                for (const f of parts.files) {
                  importChatFile(folder, f.filename || "imported.md", f.data ? f.data.toString("utf8") : "");
                  imported.push(f.filename);
                }
              }
              res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ ok: true, imported }));
            } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
          });
        } else {
          res.writeHead(415);
          res.end(JSON.stringify({ error: "Use JSON or multipart/form-data" }));
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/conversations/:id/messages/:messageId — 单条消息定位（必须在 /:id 之前）
    const convMsgMatch = urlPath.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/);
    if (convMsgMatch && req.method === "GET") {
      try {
        const convId = decodeURIComponent(convMsgMatch[1]);
        const msgId = decodeURIComponent(convMsgMatch[2]);
        let found = null;
        for (const [, fileData] of Object.entries(archiveParsed.files)) {
          const msg = fileData.messages.find(m => m.id === msgId);
          if (msg) { found = msg; break; }
        }
        if (!found) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Message not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ message: found }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/conversations/:id — 会话消息（懒加载，排除 search/refresh）
    const convMatch = urlPath.match(/^\/api\/conversations\/([^/]+)$/);
    if (convMatch && convMatch[1] !== "search" && convMatch[1] !== "refresh" && req.method === "GET") {
      try {
        const convId = decodeURIComponent(convMatch[1]);
        const before = query.before || "";
        const limit = Math.min(Number.parseInt(query.limit, 10) || 80, 200);
        const result = getConversationMessages(archiveParsed, convId, before || undefined, limit);
        if (!result) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Conversation not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: sessions (APP端 Claude Code session JSONL) ──
    const sessionsDir = path.join(process.env.HOME || "/root", ".claude", "projects", "-root");

    // GET /api/sessions — 会话列表（session JSONL 文件）
    if (urlPath === "/api/sessions" && req.method === "GET") {
      try {
        const days = Math.min(Number.parseInt(query.days, 10) || 7, 60);
        const cutoff = Date.now() - days * 86400_000;
        const results = [];
        let entries;
        try { entries = fs.readdirSync(sessionsDir); } catch { entries = []; }
        for (const name of entries) {
          if (!name.endsWith(".jsonl")) continue;
          const filePath = path.join(sessionsDir, name);
          let stat;
          try { stat = fs.statSync(filePath); } catch { continue; }
          if (stat.mtimeMs < cutoff) continue;
          const threadId = name.replace(/\.jsonl$/, "");
          // 读第一行和最后一行获取 preview 和日期范围
          let firstLine = "", lastLine = "", lineCount = 0;
          try {
            const raw = fs.readFileSync(filePath, "utf8");
            const lines = raw.trim().split("\n");
            lineCount = lines.length;
            firstLine = lines[0] || "";
            lastLine = lines[lines.length - 1] || "";
          } catch {}
          let preview = "", dateRange = [];
          try {
            const first = JSON.parse(firstLine);
            preview = (first.content || first.message?.content || "").slice(0, 100);
            const ts = first.timestamp;
            if (ts) dateRange.push(ts.slice(0, 10));
          } catch {}
          try {
            const last = JSON.parse(lastLine);
            const ts = last.timestamp;
            if (ts) dateRange.push(ts.slice(0, 10));
          } catch {}
          results.push({
            threadId,
            messageCount: lineCount,
            dateRange: [...new Set(dateRange)].sort(),
            preview,
            mtime: stat.mtimeMs,
          });
        }
        results.sort((a, b) => b.mtime - a.mtime);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(results));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/sessions/:threadId — 下载单个 session JSONL
    const sessionMatch = urlPath.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      try {
        const threadId = decodeURIComponent(sessionMatch[1]);
        // 防止路径穿越
        if (threadId.includes("..") || threadId.includes("/") || threadId.includes("\\")) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid threadId" }));
          return;
        }
        const filePath = path.join(sessionsDir, `${threadId}.jsonl`);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(raw);
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: memory-items (统一记忆库) ──
    if (urlPath === "/api/memory-items" && req.method === "GET") {
      try {
        const conversations = combineConversations(archiveParsed);
        const letters = readLetters(stateDir);
        const items = [];

        for (const c of conversations) {
          items.push({
            id: c.id, type: "conversation", title: c.topic,
            date: c.dateRange[c.dateRange.length - 1] || "",
            preview: c.preview,
            messageCount: c.messageCount, hasThinking: c.hasThinking,
          });
        }
        for (const l of letters) {
          items.push({
            id: l.id, type: "letter", title: l.title,
            date: l.date, preview: l.preview,
            category: l.category || "", sortOrder: l.sortOrder,
          });
        }
        // Sort by date descending
        items.sort((a, b) => (b.date || "").localeCompare(a.date || "", "zh-CN"));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(items));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: letters ──
    if (urlPath === "/api/letters" && req.method === "GET") {
      try {
        const category = query.category || "";
        let letters = readLetters(stateDir);
        if (category) letters = letters.filter(l => l.category === category);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(letters));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/letters — 新建信件
    if (urlPath === "/api/letters" && req.method === "POST") {
      try {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!body.title || !body.html) { res.writeHead(400); res.end(JSON.stringify({ error: "title and html required" })); return; }
            const letter = saveLetter(stateDir, body);
            if (!letter) { res.writeHead(409); res.end(JSON.stringify({ error: "Duplicate id" })); return; }
            res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(letter));
          } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/letters/reorder — 排序
    if (urlPath === "/api/letters/reorder" && req.method === "POST") {
      try {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          try {
            const { ids } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!Array.isArray(ids)) { res.writeHead(400); res.end(JSON.stringify({ error: "ids array required" })); return; }
            const letters = readLetters(stateDir);
            ids.forEach((id, i) => {
              const letter = letters.find(l => l.id === id);
              if (letter) letter.sortOrder = i;
            });
            writeLetters(stateDir, letters);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/letters/:id/view — 返回 HTML 信件
    const letterViewMatch = urlPath.match(/^\/api\/letters\/([^/]+)\/view$/);
    if (letterViewMatch && req.method === "GET") {
      try {
        const id = decodeURIComponent(letterViewMatch[1]);
        const letter = getLetter(stateDir, id);
        if (!letter) { res.writeHead(404); res.end("Letter not found"); return; }
        const htmlPath = path.join(lettersDir(stateDir), letter.file);
        if (!fs.existsSync(htmlPath)) { res.writeHead(404); res.end("HTML file not found"); return; }
        const html = fs.readFileSync(htmlPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end("Error serving letter");
      }
      return;
    }

    // PATCH /api/letters/:id — 更新信件
    const letterByIdMatch = urlPath.match(/^\/api\/letters\/([^/]+)$/);
    if (letterByIdMatch && req.method === "PATCH") {
      try {
        const id = decodeURIComponent(letterByIdMatch[1]);
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const letter = updateLetter(stateDir, id, body);
            if (!letter) { res.writeHead(404); res.end(JSON.stringify({ error: "Letter not found" })); return; }
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(letter));
          } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // DELETE /api/letters/:id — 删除信件
    if (letterByIdMatch && req.method === "DELETE") {
      try {
        const id = decodeURIComponent(letterByIdMatch[1]);
        const ok = deleteLetter(stateDir, id);
        if (!ok) { res.writeHead(404); res.end(JSON.stringify({ error: "Letter not found" })); return; }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: memory rollups ──
    if (urlPath === "/api/memory/rollups") {
      try {
        const model = query.model || "";
        const rollups = readRollups(memoryDir, model);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(rollups));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── Phase 4: Episode candidates API ──
    if (urlPath === "/api/memory/episodes") {
      try {
        const model = query.model || "";
        const status = query.status || "candidate";
        const modelDir = model ? path.join(memoryDir, model) : memoryDir;
        const episodeStore = new (require("../../../memory/memory-episode-store").MemoryEpisodeStore)({ memoryDir: modelDir });
        const episodes = status === "confirmed"
          ? episodeStore.getConfirmed(30)
          : episodeStore.getCandidates(7);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(episodes));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: models（前端动态加载模型列表）──
    if (urlPath === "/api/models" && req.method === "GET") {
      try {
        const { MODELS } = require("../../../core/model-routes");
        const list = Object.entries(MODELS).map(([key, cfg]) => ({
          key,
          type: cfg.type,
          displayName: cfg.displayName,
          modelName: cfg.modelName,
        }));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(list));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: gifts ──
    if (urlPath === "/api/gifts" && req.method === "GET") {
      try {
        const gifts = readGifts(stateDir);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(gifts));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath.startsWith("/api/gifts/") && urlPath.endsWith("/claim") && req.method === "POST") {
      try {
        const id = urlPath.split("/")[3];
        const gift = claimGift(stateDir, id);
        if (!gift) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Gift not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(gift));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath.startsWith("/api/gifts/") && req.method === "DELETE") {
      try {
        const id = urlPath.split("/")[3];
        const gift = deleteGift(stateDir, id);
        if (!gift) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Gift not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(gift));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath.startsWith("/api/gifts/") && urlPath.endsWith("/image")) {
      try {
        const id = urlPath.split("/")[3];
        const gift = getGiftById(stateDir, id);
        if (!gift || !gift.imagePath || !fs.existsSync(gift.imagePath)) {
          res.writeHead(404);
          res.end("Image not found");
          return;
        }
        const ext = path.extname(gift.imagePath).toLowerCase();
        const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext] || "image/png";
        const img = fs.readFileSync(gift.imagePath);
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
        res.end(img);
      } catch (err) {
        res.writeHead(500);
        res.end("Error serving image");
      }
      return;
    }

    // ── API: last ke message (for push notification polling) ──
    if (urlPath === "/api/last-ke-message" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(lastKeMessage));
      return;
    }

    // ── API: camera analyze ──
    if (urlPath === "/api/camera/analyze" && req.method === "POST") {
      try {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const { image } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!image) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Missing image data" }));
              return;
            }
            const desc = await analyzeCameraImage(image);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ description: desc }));
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: MCP servers ──
    if (urlPath === "/api/mcp/servers" && req.method === "GET") {
      try {
        const servers = readMcpServers(stateDir);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ servers }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath === "/api/mcp/servers" && req.method === "POST") {
      try {
        const chunks = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          try {
            const { name, command } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!name || !command) { res.writeHead(400); res.end(JSON.stringify({ error: "name and command required" })); return; }
            const server = addMcpServer(stateDir, name.trim(), command.trim());
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(server));
          } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath.startsWith("/api/mcp/servers/") && req.method === "DELETE") {
      try {
        const name = decodeURIComponent(urlPath.split("/api/mcp/servers/")[1]);
        const ok = removeMcpServer(stateDir, name);
        if (!ok) { res.writeHead(404); res.end(JSON.stringify({ error: "Server not found" })); return; }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: worldbook ──
    if (urlPath === "/api/worldbook" && req.method === "GET") {
      try {
        const model = query.model || "";
        const wb = readWorldbook(stateDir, model);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(wb));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath === "/api/worldbook" && req.method === "POST") {
      try {
        const model = query.model || "";
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const result = saveWorldbook(stateDir, parsed, model);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: bubble tea ──
    if (urlPath === "/api/bubbletea" && req.method === "GET") {
      try {
        const date = query.date || "";
        const days = Math.min(Number.parseInt(query.days, 10) || 60, 365);
        const records = date ? readBubbleTeaByDate(stateDir, date) : readBubbleTea(stateDir, days);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(records));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath === "/api/bubbletea" && req.method === "POST") {
      try {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (!parsed.date || !parsed.name) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "date and name required" }));
              return;
            }
            const record = saveBubbleTea(stateDir, {
              date: parsed.date,
              time: parsed.time || "",
              brand: parsed.brand || "",
              name: parsed.name,
              sugar: parsed.sugar || "",
              ice: parsed.ice || "",
              toppings: Array.isArray(parsed.toppings) ? parsed.toppings : [],
              rating: Number(parsed.rating) || 0,
              notes: parsed.notes || "",
              recordedBy: parsed.recordedBy || "toge",
            });
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(record));
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: stickers ──
    if (urlPath === "/api/stickers" && req.method === "GET") {
      try {
        const stickers = readStickers(stateDir);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ stickers }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath === "/api/stickers/tags" && req.method === "GET") {
      try {
        const tags = readStickerTags(stateDir);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ tags }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    // PATCH sticker tags
    if (urlPath.startsWith("/api/stickers/") && !urlPath.endsWith(".gif") && req.method === "PATCH") {
      try {
        const stickerId = path.basename(urlPath);
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            const result = patchSticker(stateDir, stickerId, body);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, sticker: result }));
          } catch (err) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (urlPath.startsWith("/api/stickers/") && urlPath.endsWith(".gif")) {
      try {
        const stickerId = path.basename(urlPath, ".gif");
        const gifPath = path.join(stateDir, "stickers", "assets", `${stickerId}.gif`);

        // DELETE sticker
        if (req.method === "DELETE") {
          deleteSticker(stateDir, stickerId);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (!fs.existsSync(gifPath)) {
          res.writeHead(404);
          res.end("Sticker not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "image/gif", "Cache-Control": "no-cache" });
        res.end(fs.readFileSync(gifPath));
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // POST upload sticker
    if (urlPath === "/api/stickers/upload" && req.method === "POST") {
      try {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const buf = Buffer.concat(chunks);
            const boundary = extractBoundary(req.headers["content-type"] || "");
            if (!boundary) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Missing boundary" }));
              return;
            }
            const parts = parseMultipart(buf, boundary);
            if (!parts.file) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "No file uploaded" }));
              return;
            }
            const stickerId = addSticker(stateDir, parts.file);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, stickerId }));
          } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: bookmarks ──
    if (urlPath === "/api/bookmarks" && req.method === "GET") {
      try {
        const bookmarks = readBookmarks(stateDir);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ bookmarks }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    if (urlPath === "/api/bookmarks" && req.method === "POST") {
      try {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (!Array.isArray(parsed.bookmarks)) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "bookmarks array required" }));
              return;
            }
            // 按 id 合并而非整体覆盖：客户端若基于不完整数据(清缓存/离线)提交,
            // 服务端已有的收藏不会被抹掉。前端没有删除收藏功能,合并无副作用;
            // 以后要删除请加 DELETE /api/bookmarks/:id,别改回覆盖。
            const existing = readBookmarks(stateDir);
            const byId = new Map(existing.map(b => [b.id, b]));
            for (const b of parsed.bookmarks) {
              if (b && b.id) byId.set(b.id, b);
            }
            const merged = Array.from(byId.values())
              .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
            writeBookmarks(stateDir, merged);
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, count: merged.length }));
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: pending-approvals ──
    if (urlPath === "/api/pending-approvals" && req.method === "GET") {
      try {
        const now = Date.now();
        const approvals = [];
        for (const [id, a] of pendingApprovals) {
          if (now - a.createdAt > 600000) { pendingApprovals.delete(id); continue; }
          approvals.push(a);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ approvals }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── API: approval-response POST (fallback for when WS is down) ──
    if (urlPath === "/api/approval-response" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.requestId) pendingApprovals.delete(String(parsed.requestId));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── API: health data ingest (POST) ──
    if (urlPath === "/api/health" && req.method === "POST") {
      const authHeader = req.headers["authorization"] || "";
      const expectedToken = process.env.CYBERBOSS_HEALTH_TOKEN || "";
      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const result = mergeHealthData(stateDir, body);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, date: result.date }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ── API: health data query (GET) ──
    if (urlPath === "/api/health" && req.method === "GET") {
      try {
        const days = Math.min(Number.parseInt(query.days, 10) || 7, 30);
        const type = query.type || "all";
        const records = readHealthData(stateDir, days, type);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(records));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── Health check ──
    if (urlPath === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      });
      res.end(JSON.stringify({ ok: true, pid: process.pid, ts: Date.now() }));
      return;
    }

    // ── Static pages ──
    if (req.url === "/" || req.url === "/index.html") {
      try {
        let html = fs.readFileSync(htmlPath, "utf8");
        html = html.replace(/__WS_PORT__/g, String(port));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end("Failed to load chat page");
      }
      return;
    }
    // ── API: media (serve saved inbox images/files) ──
    if (urlPath.startsWith("/api/media/")) {
      try {
        const relativePath = decodeURIComponent(urlPath.replace("/api/media/", ""));
        const resolved = path.resolve(stateDir, relativePath);
        // 安全检查：必须在 stateDir 下
        if (!resolved.startsWith(stateDir + path.sep) && resolved !== stateDir) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(resolved)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const mime = guessMime(relativePath) || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(fs.readFileSync(resolved));
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // Static files — first check known map, then serve any file from client dir
    let contentType = staticFiles[urlPath];
    if (!contentType) {
      contentType = guessMime(urlPath);
    }
    if (contentType) {
      try {
        const resolved = path.resolve(clientDir, "." + urlPath.replace(/\\/g, "/"));
        if (!resolved.startsWith(clientDir + path.sep) && resolved !== clientDir) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (!fs.existsSync(resolved)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const isText = contentType.startsWith("text/") || contentType.includes("javascript") || contentType.includes("json");
        const content = fs.readFileSync(resolved, isText ? "utf8" : undefined);
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  wss = new WebSocketServer({ server: serverInstance });

  // Heartbeat: detect and clean up stale connections (phone background freeze, WiFi switch)
  const heartbeatInterval = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  // Clean up stale pending approvals (older than 10 minutes)
  setInterval(() => {
    const cutoff = Date.now() - 600000;
    for (const [id, a] of pendingApprovals) {
      if (a.createdAt < cutoff) pendingApprovals.delete(id);
    }
  }, 300_000);

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.connectedAt = Date.now();
    clients.add(ws);
    const ip = req?.socket?.remoteAddress || "?";
    const ua = req?.headers?.["user-agent"] || "?";
    console.log(`[ws-server] client connected count=${clients.size} ip=${ip} ua=${ua}`);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (parsed.type === "approval_response") {
          if (parsed.requestId) pendingApprovals.delete(String(parsed.requestId));
          onMessage({
            text: "/" + String(parsed.decision || "no").trim(),
            messageId: parsed.requestId || `approval-${Date.now()}`,
            receivedAt: new Date().toISOString(),
            model: "",
          });
          return;
        }
        if (parsed.type === "sticker_send" && parsed.stickerId) {
          const payload = JSON.stringify({
            type: "sticker",
            stickerId: String(parsed.stickerId),
            from: "you",
            time: new Date().toISOString(),
          });
          // Persist sticker to server-side chat history so all clients can sync it
          if (messageStore) {
            messageStore.save({
              channel: "direct",
              from: "you",
              text: "[贴纸]",
              stickerId: String(parsed.stickerId),
              desc: typeof parsed.desc === "string" ? parsed.desc : "",
              time: new Date().toISOString(),
            });
          }
          const snapshot = [...clients];
          for (const client of snapshot) {
            if (client.readyState === 1) client.send(payload);
          }
          return;
        }
        if (parsed.type === "message" && (parsed.text || (Array.isArray(parsed.images) && parsed.images.length) || (Array.isArray(parsed.files) && parsed.files.length))) {
          onMessage({
            text: String(parsed.text || "").trim(),
            images: Array.isArray(parsed.images) ? parsed.images : [],
            files: Array.isArray(parsed.files) ? parsed.files : [],
            messageId: parsed.messageId || `direct-${Date.now()}`,
            receivedAt: new Date().toISOString(),
            model: String(parsed.model || "").trim(),
          });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      const aliveSec = ws.connectedAt ? Math.round((Date.now() - ws.connectedAt) / 1000) : "?";
      console.log(`[ws-server] client closed count=${clients.size} aliveSec=${aliveSec}`);
    });

    ws.on("error", (err) => {
      console.error("[ws-server] WebSocket error:", err.message);
      clients.delete(ws);
      console.log(`[ws-server] client error count=${clients.size}`);
    });
  });

  // Clean up heartbeat on close
  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  return {
    wss,
    server: serverInstance,
    broadcast(payload) {
      if (payload && payload.type === "text") {
        lastKeMessage = { time: new Date().toISOString(), text: String(payload.text || "").slice(0, 200) };
        console.log("[ws-server] lastKeMessage updated:", lastKeMessage.time, lastKeMessage.text.slice(0, 40));
      }
      if (payload && payload.type === "approval" && payload.requestId) {
        pendingApprovals.set(payload.requestId, {
          requestId: payload.requestId,
          reason: payload.reason || "",
          command: payload.command || "",
          kind: payload.kind || "",
          model: payload.model || "",
          createdAt: Date.now(),
        });
      }
      console.log("[ws-server] broadcast type=" + (payload?.type || "?") + " model=" + (payload?.model || "(none)") + " textLen=" + (payload?.text?.length || 0));
      const data = JSON.stringify(payload);
      const snapshot = [...clients];
      let sent = 0;
      for (const client of snapshot) {
        if (client.readyState === 1) {
          try {
            client.send(data);
            sent += 1;
          } catch {
            client.terminate();
            clients.delete(client);
          }
        }
      }
      console.log(`[ws-server] broadcast type=${payload?.type || "unknown"} clients=${snapshot.length} sent=${sent}`);
    },
    getLastKeMessage() {
      return lastKeMessage;
    },
    start() {
      return new Promise((resolve, reject) => {
        serverInstance.once("error", reject);
        serverInstance.listen(port, host, () => {
          serverInstance.removeListener("error", reject);
          console.log(`[ws-server] listening ws://${host}:${port}`);
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        for (const client of clients) {
          client.close();
        }
        clients.clear();
        wss.close(() => {
          serverInstance.close(() => resolve());
        });
      });
    },
  };
}

// ── Diary reader ──
function readDiaryEntries(diaryDir, days) {
  if (!diaryDir || !fs.existsSync(diaryDir)) return [];

  const entries = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = formatShanghaiDate(d);
    const filePath = path.join(diaryDir, `${dateStr}.md`);
    if (!fs.existsSync(filePath)) continue;

    const raw = fs.readFileSync(filePath, "utf8");
    // Split into ## blocks
    const blocks = raw.split(/^## /gm).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n");
      const heading = lines[0] || "";
      const body = lines.slice(1).join("\n").trim();
      const timeMatch = heading.match(/^(\d{2}:\d{2})/);
      entries.push({
        date: dateStr,
        time: timeMatch ? timeMatch[1] : "",
        title: heading.replace(/^\d{2}:\d{2}\s*/, "").trim() || "",
        body: body.slice(0, 500), // truncate for display
        fullBody: body,
      });
    }
  }

  // Sort by date desc, time desc
  entries.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.time.localeCompare(a.time);
  });

  return entries.slice(0, 100);
}

// ── Memory reader ──
function readMemoryFragments(memoryDir, days, model) {
  if (!memoryDir) return { fragments: [], counts: {} };
  const keys = resolveModelKeys(model);

  const counts = {};
  const fragments = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = formatShanghaiDate(d);
    for (const key of keys) {
      const filePath = path.join(memoryDir, key, "fragments", `${dateStr}.json`);
      if (!fs.existsSync(filePath)) continue;
      try {
        const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
        for (const item of items) {
          if (item.status === "deleted") continue;
          counts[key] = (counts[key] || 0) + 1;
          fragments.push({
            id: item.id,
            type: item.type,
            content: item.content,
            heat: item.heat,
            locked: item.locked,
            tags: item.tags,
            date: dateStr,
            model: key,
            modelName: modelToDisplayName(key),
          });
        }
      } catch { /* skip corrupt files */ }
    }
  }

  fragments.sort((a, b) => b.heat - a.heat);
  return { fragments: fragments.slice(0, 100), counts };
}

// ── Rollups reader ──
function readRollups(memoryDir, model) {
  if (!memoryDir) return { weeks: [], months: [], years: [] };
  const keys = resolveModelKeys(model);

  const result = { weeks: [], months: [], years: [] };
  for (const key of keys) {
    const rollupsDir = path.join(memoryDir, key, "rollups");
    if (!fs.existsSync(rollupsDir)) continue;
    try {
      const files = fs.readdirSync(rollupsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = JSON.parse(fs.readFileSync(path.join(rollupsDir, file), "utf8"));
        data.model = key;
        data.modelName = modelToDisplayName(key);
        if (data.level === "week") result.weeks.push(data);
        else if (data.level === "month") result.months.push(data);
        else if (data.level === "year") result.years.push(data);
      }
    } catch {}
  }
  result.weeks.sort((a, b) => b.period.localeCompare(a.period));
  result.months.sort((a, b) => b.period.localeCompare(a.period));
  result.years.sort((a, b) => b.period.localeCompare(a.period));
  return result;
}

function resolveModelKeys(model) {
  const v = (model || "").trim();
  if (!v || v === "all") return [...ALL_MODEL_KEYS];
  return [resolveModelKey(v)];
}

function guessMime(urlPath) {
  const ext = path.extname(urlPath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".css": "text/css",
    ".js": "application/javascript",
    ".html": "text/html",
    ".json": "application/json",
    ".txt": "text/plain",
    ".apk": "application/vnd.android.package-archive",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return map[ext] || "";
}

function parseQuery(url) {
  const q = {};
  const idx = url.indexOf("?");
  if (idx === -1) return q;
  const search = url.slice(idx + 1);
  for (const pair of search.split("&")) {
    const [key, val] = pair.split("=").map(decodeURIComponent);
    q[key] = val;
  }
  return q;
}

function formatShanghaiDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// ── Transcript search ──
function searchTranscripts(query) {
  const projectsDir = path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "projects", "C--Users-youzi");
  if (!fs.existsSync(projectsDir)) return [];

  const files = fs.readdirSync(projectsDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => path.join(projectsDir, f));

  const qLower = query.toLowerCase();
  const allResults = [];

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n");

    // First pass: extract messages
    const messages = [];
    let seenIds = new Set();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        // user messages
        if (entry.type === "user" && entry.message?.content) {
          let text = "";
          const content = entry.message.content;
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) {
            text = content.filter(c => c.type === "text").map(c => c.text).join("\n");
          }
          if (text.trim()) {
            messages.push({ role: "user", text, ts: entry.timestamp || null });
          }
        }

        // assistant messages (deduplicate by id)
        if (entry.message?.role === "assistant" && entry.message?.content) {
          const msgId = entry.message.id;
          if (msgId && seenIds.has(msgId)) continue;
          if (msgId) seenIds.add(msgId);

          let text = "";
          const content = entry.message.content;
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) {
            text = content.filter(c => c.type === "text").map(c => c.text).join("\n");
          }
          if (text.trim()) {
            messages.push({ role: "assistant", text, ts: entry.timestamp || null });
          }
        }
      } catch {}
    }

    // Second pass: search
    const ctxSize = 2;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].text.toLowerCase().includes(qLower)) {
        const start = Math.max(0, i - ctxSize);
        const end = Math.min(messages.length, i + ctxSize + 1);
        const context = messages.slice(start, end).map(m => ({
          role: m.role,
          text: m.text.slice(0, 300),
          isMatch: m === messages[i],
        }));

        const ts = messages[i].ts;
        let timeLabel = "";
        if (ts) {
          try {
            const d = new Date(ts);
            const beijing = new Date(d.getTime() + 8 * 3600000);
            const pad = n => String(n).padStart(2, "0");
            timeLabel = `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}`;
          } catch {}
        }

        allResults.push({
          time: timeLabel,
          file: path.basename(filePath),
          context,
        });

        if (allResults.length >= 20) break;
      }
    }
    if (allResults.length >= 20) break;
  }

  return allResults;
}

// ── Worldbook helpers ──
function readWorldbook(stateDir, model) {
  const key = resolveModelKey(model);
  const wbDir = path.join(stateDir, "worldbook");
  const filePath = path.join(wbDir, `${key}.json`);
  const defaults = {
    ai: { name: "克", personality: "", speaking_style: "", background: "" },
    user: { name: "toge", description: "", preferences: "" },
    rules: [],
    updated_at: null,
  };
  if (!fs.existsSync(filePath)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return defaults;
  }
}

function saveWorldbook(stateDir, data, model) {
  const key = resolveModelKey(model);
  const wbDir = path.join(stateDir, "worldbook");
  const filePath = path.join(wbDir, `${key}.json`);
  if (!fs.existsSync(wbDir)) {
    fs.mkdirSync(wbDir, { recursive: true });
  }
  const existing = readWorldbook(stateDir, model);
  const merged = { ...existing, ...data, updated_at: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

// ── Gift helpers ──
function readGifts(stateDir) {
  const filePath = path.join(stateDir, "gifts.json");
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return []; }
}

function writeGifts(stateDir, gifts) {
  const filePath = path.join(stateDir, "gifts.json");
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(gifts, null, 2), "utf8");
}

function getGiftById(stateDir, id) {
  const gifts = readGifts(stateDir);
  return gifts.find(g => g.id === id) || null;
}

function claimGift(stateDir, id) {
  const gifts = readGifts(stateDir);
  const gift = gifts.find(g => g.id === id);
  if (!gift) return null;
  gift.claimed = true;
  gift.claimedAt = new Date().toISOString();
  writeGifts(stateDir, gifts);
  return gift;
}

function deleteGift(stateDir, id) {
  const gifts = readGifts(stateDir);
  const idx = gifts.findIndex(g => g.id === id);
  if (idx === -1) return null;
  const [removed] = gifts.splice(idx, 1);
  if (removed.imagePath && fs.existsSync(removed.imagePath)) {
    try { fs.unlinkSync(removed.imagePath); } catch {}
  }
  writeGifts(stateDir, gifts);
  return removed;
}

// ── Camera image analysis helper ──
async function analyzeCameraImage(imageBase64) {
  const apiKey = process.env.CYBERBOSS_VISION_API_KEY || "";
  const baseUrl = (process.env.CYBERBOSS_VISION_API_BASE_URL || "https://api.siliconflow.cn").replace(/\/+$/, "");
  if (!apiKey) throw new Error("Vision API key not configured");

  const http = require("http");
  const https = require("https");

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: process.env.CYBERBOSS_VISION_MODEL || "deepseek-ai/deepseek-vl2",
      messages: [
        { role: "user", content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: "text", text: "请用中文简单描述你在这个画面中看到了什么。重点描述：场景、人物、动作、情绪氛围。控制在100字以内。" },
        ]},
      ],
      max_tokens: 200,
      stream: false,
    });

    const url = `${baseUrl}/v1/chat/completions`;
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content?.trim() || "未能分析画面");
        } catch {
          reject(new Error(`Vision parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Vision timeout")); });
    req.write(body);
    req.end();
  });
}

// ── MCP server config helpers ──
function readMcpServers(stateDir) {
  const filePath = path.join(stateDir, "mcp-servers.json");
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return []; }
}
function writeMcpServers(stateDir, servers) {
  const filePath = path.join(stateDir, "mcp-servers.json");
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(servers, null, 2), "utf8");
}
function addMcpServer(stateDir, name, command) {
  const servers = readMcpServers(stateDir);
  const idx = servers.findIndex(s => s.name === name);
  const entry = { name, command, enabled: true };
  if (idx >= 0) servers[idx] = entry;
  else servers.push(entry);
  writeMcpServers(stateDir, servers);
  return entry;
}
function removeMcpServer(stateDir, name) {
  const servers = readMcpServers(stateDir);
  const idx = servers.findIndex(s => s.name === name);
  if (idx < 0) return false;
  servers.splice(idx, 1);
  writeMcpServers(stateDir, servers);
  return true;
}

// ── Bubble tea helpers ──
function bubbleTeaDir(stateDir) {
  const dir = path.join(stateDir, "bubbletea");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function bubbleTeaPath(stateDir) {
  return path.join(bubbleTeaDir(stateDir), "records.json");
}

function readBubbleTea(stateDir, days) {
  const filePath = bubbleTeaPath(stateDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(records)) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, Number(days) || 60));
    const cutoffStr = formatShanghaiDate(cutoff);
    return records
      .filter(r => (r.date || "") >= cutoffStr)
      .sort((a, b) => (b.date + (b.time || "99:99")).localeCompare(a.date + (a.time || "99:99")));
  } catch { return []; }
}

function readBubbleTeaByDate(stateDir, date) {
  const filePath = bubbleTeaPath(stateDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(records)) return [];
    return records
      .filter(r => r.date === date)
      .sort((a, b) => (b.time || "99:99").localeCompare(a.time || "99:99"));
  } catch { return []; }
}

function saveBubbleTea(stateDir, data) {
  const filePath = bubbleTeaPath(stateDir);
  let records = [];
  try { records = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  if (!Array.isArray(records)) records = [];

  const now = new Date();
  const id = `bt-${data.date.replace(/-/g, "")}-${String(records.length + 1).padStart(3, "0")}`;
  const record = {
    id,
    date: data.date,
    time: data.time || "",
    brand: data.brand || "",
    name: data.name,
    sugar: data.sugar || "",
    ice: data.ice || "",
    toppings: Array.isArray(data.toppings) ? data.toppings : [],
    rating: Number(data.rating) || 0,
    notes: data.notes || "",
    recordedBy: data.recordedBy || "toge",
    createdAt: now.toISOString(),
  };
  records.push(record);
  records.sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")));
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");

  // Also append to records.md for Claude to read
  const mdPath = path.join(bubbleTeaDir(stateDir), "records.md");
  const mdLines = [
    `## ${record.date} ${record.time || ""} — ${record.brand ? record.brand + "·" : ""}${record.name}`,
    `- 糖度: ${record.sugar || "未填"}  |  冰量: ${record.ice || "未填"}  |  小料: ${record.toppings.length ? record.toppings.join("、") : "无"}`,
    `- 评分: ${"⭐".repeat(record.rating) || "未评"}  |  记录者: ${record.recordedBy === "ke" ? "克" : "toge"}`,
    record.notes ? `- 备注: ${record.notes}` : "",
    "",
  ].filter(Boolean).join("\n");
  try {
    fs.appendFileSync(mdPath, mdLines + "\n", "utf8");
  } catch {}
  return record;
}

// ── Sticker helpers ──
function deleteSticker(stateDir, stickerId) {
  const indexFile = path.join(stateDir, "stickers", "index.json");
  const gifPath = path.join(stateDir, "stickers", "assets", `${stickerId}.gif`);
  // Remove GIF
  if (fs.existsSync(gifPath)) fs.unlinkSync(gifPath);
  // Remove from index
  if (fs.existsSync(indexFile)) {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    if (index && typeof index === "object" && !Array.isArray(index)) {
      delete index[stickerId];
      fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf8");
    }
  }
}

function addSticker(stateDir, file) {
  const assetsDir = path.join(stateDir, "stickers", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  // Generate unique sticker id
  const ids = [];
  const idxFile = path.join(stateDir, "stickers", "index.json");
  if (fs.existsSync(idxFile)) {
    const idx = JSON.parse(fs.readFileSync(idxFile, "utf8"));
    if (idx && typeof idx === "object" && !Array.isArray(idx)) {
      for (const k of Object.keys(idx)) ids.push(k);
    }
  }
  let num = 0;
  for (const k of ids) {
    const m = k.match(/^stk_(\d+)$/);
    if (m) { const n = parseInt(m[1], 10); if (n > num) num = n; }
  }
  const stickerId = `stk_${String(num + 1).padStart(3, "0")}`;
  const gifPath = path.join(assetsDir, `${stickerId}.gif`);
  fs.writeFileSync(gifPath, file.data);

  // Update index
  const index = (fs.existsSync(idxFile) && (() => {
    try { const raw = JSON.parse(fs.readFileSync(idxFile, "utf8")); return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; }
    catch { return {}; }
  })()) || {};
  index[stickerId] = { tags: [], desc: file.fileName || stickerId };
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 2), "utf8");
  return stickerId;
}

function extractBoundary(contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  return m ? (m[1] || m[2]).trim() : "";
}

function parseMultipart(buf, boundary) {
  // Binary-safe multipart parser using Buffer.indexOf
  const b = Buffer.from(`--${boundary}`);
  const bEnd = Buffer.from(`--${boundary}--`);
  const bCrlfCrlf = Buffer.from("\r\n\r\n");
  const bCrlf = Buffer.from("\r\n");

  let pos = buf.indexOf(b);
  if (pos < 0) return {};
  pos += b.length;

  const endIdx = buf.indexOf(bEnd, pos);
  if (endIdx < 0) return {};

  // Skip leading \r\n after boundary
  if (buf[pos] === 13 && buf[pos + 1] === 10) pos += 2;

  const part = buf.slice(pos, endIdx);
  // Trim trailing \r\n before end boundary
  const partEnd = part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10
    ? part.length - 2 : part.length;

  const headerEnd = part.indexOf(bCrlfCrlf, 0);
  if (headerEnd < 0) return {};

  const headers = part.slice(0, headerEnd).toString("utf8");
  const body = part.slice(headerEnd + 4, partEnd);

  const nameMatch = headers.match(/name="([^"]+)"/);
  const filenameMatch = headers.match(/filename="([^"]+)"/);
  const name = nameMatch ? nameMatch[1] : "";
  if (name === "file" && filenameMatch) {
    return { file: { fileName: filenameMatch[1], data: body } };
  }
  return {};
}

function patchSticker(stateDir, stickerId, body) {
  const indexFile = path.join(stateDir, "stickers", "index.json");
  if (!fs.existsSync(indexFile)) throw new Error("No sticker index");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  if (!index || typeof index !== "object" || Array.isArray(index)) throw new Error("Invalid index");
  if (!index[stickerId]) throw new Error("Sticker not found: " + stickerId);

  const sticker = index[stickerId];
  if (!Array.isArray(sticker.tags)) sticker.tags = [];
  const tag = String(body.tag || "").trim();
  if (!tag) throw new Error("Missing tag");

  if (body.action === "addTag") {
    if (sticker.tags.indexOf(tag) < 0) sticker.tags.push(tag);
  } else if (body.action === "removeTag") {
    sticker.tags = sticker.tags.filter(function(t) { return t !== tag; });
  } else {
    throw new Error("Unknown action: " + (body.action || ""));
  }

  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf8");

  // Sync tags.json
  syncTagsJson(stateDir);

  return { id: stickerId, tags: sticker.tags, desc: sticker.desc || "" };
}

function syncTagsJson(stateDir) {
  const indexFile = path.join(stateDir, "stickers", "index.json");
  const tagsFile = path.join(stateDir, "stickers", "tags.json");
  if (!fs.existsSync(indexFile)) return;
  const allTags = new Set();
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    if (index && typeof index === "object" && !Array.isArray(index)) {
      Object.values(index).forEach(function(s) {
        if (Array.isArray(s.tags)) s.tags.forEach(function(t) { allTags.add(t); });
      });
    }
  } catch { return; }
  fs.writeFileSync(tagsFile, JSON.stringify([...allTags].sort(), null, 2), "utf8");
}

function readStickers(stateDir) {
  const indexFile = path.join(stateDir, "stickers", "index.json");
  if (!fs.existsSync(indexFile)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    return Object.entries(raw).map(([id, value]) => ({
      id,
      tags: Array.isArray(value?.tags) ? value.tags : [],
      desc: typeof value?.desc === "string" ? value.desc : "",
    }));
  } catch { return []; }
}

function readStickerTags(stateDir) {
  const tagsFile = path.join(stateDir, "stickers", "tags.json");
  if (!fs.existsSync(tagsFile)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(tagsFile, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function readBookmarks(stateDir) {
  const fp = path.join(stateDir, "bookmarks.json");
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return []; }
}

function writeBookmarks(stateDir, bookmarks) {
  const fp = path.join(stateDir, "bookmarks.json");
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(bookmarks, null, 2), "utf8");
}

// ── Letter helpers ──
function lettersDir(stateDir) {
  const dir = path.join(stateDir, "letters");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function lettersManifestPath(stateDir) {
  return path.join(lettersDir(stateDir), "manifest.json");
}
function readLetters(stateDir) {
  const fp = lettersManifestPath(stateDir);
  if (!fs.existsSync(fp)) return [];
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return []; }
}
function writeLetters(stateDir, letters) {
  const fp = lettersManifestPath(stateDir);
  if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(letters, null, 2), "utf8");
}
function getLetter(stateDir, id) {
  return readLetters(stateDir).find(l => l.id === id) || null;
}
function shortHash(str) {
  const crypto = require("crypto");
  return crypto.createHash("sha1").update(str, "utf8").digest("hex").slice(0, 8);
}
function saveLetter(stateDir, data) {
  const letters = readLetters(stateDir);
  const id = data.id || `letter_${shortHash((data.title || "") + (data.date || Date.now()))}`;
  if (letters.some(l => l.id === id)) return null; // duplicate
  const file = `${id}.html`;
  const letter = {
    id, title: data.title || "", date: data.date || "", preview: data.preview || "",
    file, category: data.category || "", sortOrder: data.sortOrder ?? letters.length,
    createdAt: new Date().toISOString(),
  };
  letters.push(letter);
  writeLetters(stateDir, letters);
  // Write HTML file
  const htmlPath = path.join(lettersDir(stateDir), file);
  fs.writeFileSync(htmlPath, data.html || "", "utf8");
  return letter;
}
function updateLetter(stateDir, id, data) {
  const letters = readLetters(stateDir);
  const idx = letters.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const letter = letters[idx];
  if (data.title !== undefined) letter.title = data.title;
  if (data.date !== undefined) letter.date = data.date;
  if (data.preview !== undefined) letter.preview = data.preview;
  if (data.category !== undefined) letter.category = data.category;
  if (data.sortOrder !== undefined) letter.sortOrder = data.sortOrder;
  letters[idx] = letter;
  writeLetters(stateDir, letters);
  // Update HTML content if provided
  if (data.html !== undefined) {
    const htmlPath = path.join(lettersDir(stateDir), letter.file);
    fs.writeFileSync(htmlPath, data.html, "utf8");
  }
  return letter;
}
function deleteLetter(stateDir, id) {
  const letters = readLetters(stateDir);
  const idx = letters.findIndex(l => l.id === id);
  if (idx === -1) return false;
  const letter = letters[idx];
  // Delete HTML file
  try {
    const htmlPath = path.join(lettersDir(stateDir), letter.file);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
  } catch {}
  letters.splice(idx, 1);
  writeLetters(stateDir, letters);
  return true;
}

// ── Health data helpers ──
function healthDataDir(stateDir) {
  const dir = path.join(stateDir, "health");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function mergeHealthData(stateDir, body) {
  const date = body.date || formatShanghaiDate(new Date());
  const filePath = path.join(healthDataDir(stateDir), `${date}.json`);

  let current = { date };
  if (fs.existsSync(filePath)) {
    try { current = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
  }
  if (!current.date) current.date = date;

  const type = body.type;
  const data = body.data || {};
  const now = new Date().toISOString();

  if (type === "steps" || body.steps !== undefined) {
    const d = type === "steps" ? data : (body.steps || {});
    const newTotal = Number(d.total || d.count || d.value || 0);
    const prevTotal = current.steps?.total || 0;
    current.steps = { total: Math.max(prevTotal, newTotal), updatedAt: now };
  }

  if (type === "heart_rate" || body.heart_rate !== undefined) {
    const d = type === "heart_rate" ? data : (body.heart_rate || {});
    if (!current.heart_rate) current.heart_rate = { samples: [] };
    if (!Array.isArray(current.heart_rate.samples)) current.heart_rate.samples = [];
    const ts = d.timestamp || d.ts || now;
    const bpm = Number(d.value || d.bpm || 0);
    if (bpm > 0 && !current.heart_rate.samples.some(s => s.ts === ts)) {
      current.heart_rate.samples.push({ ts, bpm });
      current.heart_rate.samples.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    const bpms = current.heart_rate.samples.map(s => s.bpm).filter(b => b > 0);
    if (bpms.length) current.heart_rate.avg = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    if (d.resting || d.resting_bpm) current.heart_rate.resting = Number(d.resting || d.resting_bpm);
    current.heart_rate.updatedAt = now;
  }

  if (type === "sleep" || body.sleep !== undefined) {
    const d = type === "sleep" ? data : (body.sleep || {});
    current.sleep = {
      duration_min: Number(d.duration_min || d.duration || 0),
      deep_min: Number(d.deep_min || d.deep || 0),
      light_min: Number(d.light_min || d.light || 0),
      rem_min: Number(d.rem_min || d.rem || 0),
      awake_min: Number(d.awake_min || d.awake || 0),
      start: d.start || d.startTime || "",
      end: d.end || d.endTime || "",
      score: Number(d.score || 0),
      updatedAt: now,
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
  return current;
}

function readHealthData(stateDir, days, type) {
  const dir = healthDataDir(stateDir);
  const records = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = formatShanghaiDate(d);
    const filePath = path.join(dir, `${date}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (type && type !== "all") {
        const filtered = { date: record.date || date };
        if (record[type]) filtered[type] = record[type];
        records.push(filtered);
      } else {
        records.push(record);
      }
    } catch {}
  }
  return records;
}

module.exports = { createDirectWebSocketServer };
