const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ARCHIVE_BASE = process.env.CYBERBOSS_CHAT_ARCHIVE_DIR || "C:\\Users\\youzi\\Desktop\\女友酱相关\\聊天记录存档";

// ── Stable ID ──
function shortHash(str) {
  return crypto.createHash("sha1").update(str, "utf8").digest("hex").slice(0, 8);
}

// ── Speaker mapping ──
const SPEAKER_MAP = { "克": "ke", "claude": "ke", "toge": "toge" };
function mapSpeaker(raw) {
  const key = (raw || "").trim().toLowerCase();
  return SPEAKER_MAP[key] || (key === "toge" ? "toge" : null);
}

// ── Time normalize: "3:03" → "03:03" ──
function normalizeTime(raw) {
  const m = (raw || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return raw;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// ── Parse a single markdown file ──
function parseMarkdownFile(content, relPath, conversationId) {
  const lines = content.split(/\r?\n/);
  const messages = [];

  let title = "";
  let titleDate = "";
  let currentSpeaker = null;
  let currentTime = "";
  let currentTextLines = [];
  let thinkingLines = [];
  let inThinking = false;

  function flushMessage() {
    if (!currentSpeaker || currentTextLines.length === 0) return;
    const text = currentTextLines.join("\n").trim();
    if (!text && thinkingLines.length === 0) return;

    const thinking = thinkingLines.length > 0 ? thinkingLines.join("\n").trim() : null;
    const idx = messages.length;
    messages.push({
      id: `msg_${conversationId}_${String(idx).padStart(5, "0")}`,
      role: currentSpeaker,
      time: currentTime,
      text: text || "",
      thinking: thinking || undefined,
      hasThinking: thinking !== null && thinking !== undefined,
      attachments: [],
    });

    currentTextLines = [];
    thinkingLines = [];
    inThinking = false;
  }

  // Title line: # YYYY-MM-DD — topic
  const titleMatch = lines[0] ? lines[0].match(/^#\s+(\d{4}-\d{2}-\d{2})\s*[—\-]\s*(.+)/) : null;
  if (titleMatch) {
    titleDate = titleMatch[1];
    title = titleMatch[2].trim();
  }

  // Speaker marker: **[HH:MM] name**
  const speakerRe = /^\*\*\[(\d{1,2}:\d{2})\]\s*(.+?)\*\*\s*$/;

  for (let i = titleMatch ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    const sm = line.match(speakerRe);

    if (sm) {
      flushMessage();
      currentTime = normalizeTime(sm[1]);
      const speaker = mapSpeaker(sm[2]);
      if (!speaker) { currentSpeaker = null; continue; }
      currentSpeaker = speaker;
      currentTextLines = [];
      thinkingLines = [];
      inThinking = false;
      continue;
    }

    if (!currentSpeaker) continue;

    // Detect thinking block start: > at line start (after a ke message, no toge in between)
    if (currentSpeaker === "ke" && line.startsWith("> ")) {
      inThinking = true;
      thinkingLines.push(line.slice(2));
      continue;
    }
    // Continuation of thinking: > on a line already in thinking mode
    if (inThinking && line.startsWith("> ")) {
      thinkingLines.push(line.slice(2));
      continue;
    }
    // Empty line inside thinking block
    if (inThinking && line.trim() === "" && thinkingLines.length > 0) {
      thinkingLines.push("");
      continue;
    }

    // Not a thinking line — add to current text
    inThinking = false;
    currentTextLines.push(line);
  }

  flushMessage();

  // Assign dates: use title date for messages without explicit context
  for (const msg of messages) {
    msg.date = titleDate || "";
  }

  return { title, titleDate, messages };
}

// ── Prepend missing messages (messages before the first speaker marker) ──
// The very first segment before any **[HH:MM] marker is appended to the first message

// ── Main: parse entire archive with incremental cache ──
function parseArchive(baseDir, cachePath) {
  const cache = loadCache(cachePath);
  const result = { files: {} };
  let changed = false;

  if (!fs.existsSync(baseDir)) {
    return { files: {} };
  }

  const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const dirPath = path.join(baseDir, dir.name);
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const relPath = path.relative(baseDir, filePath).replace(/\\/g, "/");
      const stat = fs.statSync(filePath);
      const mtime = stat.mtimeMs;
      const size = stat.size;

      // Check cache
      const cached = cache.files[relPath];
      if (cached && cached.mtime === mtime && cached.size === size) {
        result.files[relPath] = cached;
        continue;
      }

      // Parse
      const conversationId = shortHash(dir.name);
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = parseMarkdownFile(content, relPath, conversationId);

      result.files[relPath] = { mtime, size, messages: parsed.messages };
      changed = true;
    }
  }

  // Remove cache entries for deleted files
  for (const key of Object.keys(cache.files)) {
    if (!result.files[key]) {
      delete cache.files[key];
      changed = true;
    }
  }

  if (changed && cachePath) {
    saveCache(cachePath, result);
  }

  return result;
}

// ── Cache I/O ──
function loadCache(cachePath) {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    }
  } catch {}
  return { files: {} };
}

function saveCache(cachePath, parsed) {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(parsed, null, 2), "utf8");
  } catch {}
}

// ── Combine parsed files into conversations ──
function combineConversations(parsed) {
  const convMap = new Map();

  for (const [relPath, fileData] of Object.entries(parsed.files)) {
    const folder = relPath.split("/")[0];
    const convId = `conversation_${shortHash(folder)}`;

    if (!convMap.has(convId)) {
      convMap.set(convId, {
        id: convId,
        topic: folder,
        folder,
        messages: [],
      });
    }

    const conv = convMap.get(convId);
    for (const msg of fileData.messages) {
      conv.messages.push({ ...msg });
    }
  }

  const conversations = [];

  for (const [, conv] of convMap) {
    // Sort messages by date + time
    conv.messages.sort((a, b) => {
      const da = `${a.date || ""} ${a.time || ""}`;
      const db = `${b.date || ""} ${b.time || ""}`;
      return da.localeCompare(db, "zh-CN");
    });

    // Re-index message ids after merge
    conv.messages.forEach((msg, i) => {
      msg.id = `msg_${shortHash(conv.folder)}_${String(i).padStart(5, "0")}`;
    });

    const dates = new Set(conv.messages.map(m => m.date).filter(Boolean));
    const dateRange = Array.from(dates).sort();
    const participants = new Set(conv.messages.map(m => m.role));

    // Preview: first non-empty toge message, trimmed
    let preview = "";
    for (const m of conv.messages) {
      if (m.role === "toge" && m.text.trim()) {
        preview = m.text.replace(/[*_#`>\[\]!\-~]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
        break;
      }
    }
    if (!preview) {
      for (const m of conv.messages) {
        if (m.text.trim()) {
          preview = m.text.replace(/[*_#`>\[\]!\-~]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
          break;
        }
      }
    }

    conversations.push({
      id: conv.id,
      topic: conv.topic,
      folder: conv.folder,
      dateRange,
      messageCount: conv.messages.length,
      participants: Array.from(participants).sort(),
      hasThinking: conv.messages.some(m => m.hasThinking),
      preview,
    });
  }

  return conversations;
}

// ── Collect all messages for a conversation (sorted, re-indexed) ──
function collectMessages(parsed, folder) {
  const all = [];
  for (const [relPath, fileData] of Object.entries(parsed.files)) {
    if (relPath.split("/")[0] !== folder) continue;
    for (const msg of fileData.messages) {
      all.push({ ...msg, _folder: folder });
    }
  }
  all.sort((a, b) => {
    const da = `${a.date || ""} ${a.time || ""}`;
    const db = `${b.date || ""} ${b.time || ""}`;
    return da.localeCompare(db, "zh-CN");
  });
  const shortId = shortHash(folder);
  all.forEach((msg, i) => {
    msg.id = `msg_${shortId}_${String(i).padStart(5, "0")}`;
  });
  return all;
}

// ── Get messages for a specific conversation (with pagination) ──
function getConversationMessages(parsed, conversationId, beforeMsgId, limit) {
  limit = Math.min(limit || 80, 200);
  const conversations = combineConversations(parsed);
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return null;

  const sorted = collectMessages(parsed, conv.folder);

  let startIdx = sorted.length;
  if (beforeMsgId) {
    const idx = sorted.findIndex(m => m.id === beforeMsgId);
    startIdx = idx >= 0 ? idx : sorted.length;
  }

  const endIdx = Math.max(0, startIdx - limit);
  const slice = sorted.slice(endIdx, startIdx);
  const hasMore = endIdx > 0;

  return {
    id: conv.id,
    topic: conv.topic,
    messages: slice,
    hasMore,
    nextBefore: hasMore && slice.length > 0 ? slice[0].id : null,
  };
}

// ── Search messages across all conversations ──
function searchMessages(parsed, query, dateFilter) {
  const q = (query || "").toLowerCase().trim();
  if (!q || q.length < 1) return [];

  const results = [];
  const conversations = combineConversations(parsed);

  for (const conv of conversations) {
    if (dateFilter && !conv.dateRange.some(d => d === dateFilter)) continue;

    for (const [relPath, fileData] of Object.entries(parsed.files)) {
      const folder = relPath.split("/")[0];
      if (folder !== conv.folder) continue;

      for (const msg of fileData.messages) {
        if (dateFilter && msg.date !== dateFilter) continue;

        const textMatch = (msg.text || "").toLowerCase().includes(q);
        const thinkingMatch = !textMatch && (msg.thinking || "").toLowerCase().includes(q);
        if (!textMatch && !thinkingMatch) continue;

        let snippet = "";
        if (textMatch) {
          const idx = (msg.text || "").toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 20);
          const end = Math.min(msg.text.length, idx + q.length + 30);
          snippet = (start > 0 ? "…" : "") + msg.text.slice(start, end) + (end < msg.text.length ? "…" : "");
        } else if (thinkingMatch) {
          const idx = (msg.thinking || "").toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 20);
          const end = Math.min(msg.thinking.length, idx + q.length + 30);
          snippet = (start > 0 ? "…" : "") + msg.thinking.slice(start, end) + (end < msg.thinking.length ? "…" : "");
        }

        results.push({
          conversationId: conv.id,
          conversationTopic: conv.topic,
          messageId: msg.id,
          date: msg.date,
          time: msg.time,
          role: msg.role,
          snippet,
          thinkingMatch,
        });

        if (results.length >= 50) break;
      }
      if (results.length >= 50) break;
    }
    if (results.length >= 50) break;
  }

  return results;
}

module.exports = {
  parseArchive,
  combineConversations,
  getConversationMessages,
  searchMessages,
  ARCHIVE_BASE,
};
