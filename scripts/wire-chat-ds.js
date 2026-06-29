// Wire up chat-ds.html with full JS functionality
const fs = require('fs');
const p = 'C:/Users/youzi/withtoge/src/adapters/channel/direct/client/chat-ds.html';
let html = fs.readFileSync(p, 'utf8');

const js = `
<script>
/* ── Constants ── */
const MODEL_NAME = "deepseek-v4-pro";
const STORAGE_KEY = "withtoge-chat-history-deepseek-v4-pro";
const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

/* ── DOM refs ── */
const chatFlow = document.getElementById("chatFlow");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("send-btn");
const imageBtn = document.getElementById("image-btn");
const fileInput = document.getElementById("file-input");
const imagePreview = document.getElementById("image-preview");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const headerTitle = document.getElementById("header-title");

/* ── State ── */
let ws = null;
let history = [];
let pendingFiles = [];
let streamingMsgEl = null;
let _msgIdx = 0;
let reconnectTimer = null;
let reconnectDelay = 1000;

/* ── Utilities ── */
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML.replace(/\\n/g, "<br>"); }
function now() { return new Date().toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" }); }
function scrollBottom() { chatFlow.scrollTop = chatFlow.scrollHeight; }

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-500))); } catch {}
}

/* ── Render ── */
function renderMsg(msg, save) {
  if (save === undefined) save = true;
  const wrap = document.createElement("div");
  wrap.className = "message-group-wrapper " + (msg.from === "you" ? "user" : "ai");

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = esc(msg.text);
  if (msg.images && msg.images.length) {
    bubble.innerHTML += msg.images.map(img => {
      const src = img.thumb || img.data || "";
      return src ? '<br><img src="' + src + '" style="max-width:100%;border-radius:8px;margin-top:6px;">' : "";
    }).join("");
  }
  wrap.appendChild(bubble);

  const time = document.createElement("span");
  time.className = "message-timestamp";
  time.textContent = msg.time || now();
  wrap.appendChild(time);

  chatFlow.appendChild(wrap);
  scrollBottom();
  if (save) { history.push(msg); saveHistory(history); }
  return wrap;
}


/* ── Thinking ── */
const thinkingStore = {
  turns: {},
  get(turnId) {
    if (!this.turns[turnId]) {
      this.turns[turnId] = { phase: "thinking", text: "", model: MODEL_NAME, startTime: Date.now(), tickInterval: null, flushTimer: null };
    }
    return this.turns[turnId];
  },
  setPhase(turnId, phase) { this.get(turnId).phase = phase; },
  appendText(turnId, text) {
    const t = this.get(turnId);
    t.text = text;
    return true;
  },
  startTick(turnId) {
    const t = this.get(turnId);
    if (t.tickInterval) return;
    t.tickInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
      updateInlineThinkingLabel(turnId, t.phase === "tooling" ? "正在调用工具..." : "思考中 (" + elapsed + "秒)...");
    }, 1000);
  },
  cleanup(turnId) {
    const t = this.turns[turnId];
    if (!t) return;
    if (t.tickInterval) { clearInterval(t.tickInterval); t.tickInterval = null; }
    if (t.flushTimer) { clearTimeout(t.flushTimer); t.flushTimer = null; }
  },
  finalize(turnId) {
    const t = this.turns[turnId];
    if (!t) return;
    this.cleanup(turnId);
    t.phase = "final";
  }
};

function buildInlineThinking(turnId) {
  const store = thinkingStore.turns[turnId];
  if (!store) return null;

  const inline = document.createElement("div");
  inline.className = "thinking-inline";
  inline.dataset.turnId = turnId;
  if (store.phase === "tooling") inline.classList.add("thinking-tool-active");

  const row = document.createElement("div");
  row.className = "thinking-row";

  const avatar = document.createElement("div");
  avatar.className = "thinking-avatar";
  avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';

  const header = document.createElement("div");
  header.className = "thinking-inline-header";
  const isFinal = (store.phase === "final");
  const labelText = store.phase === "tooling" ? "正在调用工具..." : (isFinal ? "已思考完毕" : "思考中...");
  header.innerHTML = '<span class="thinking-inline-arrow"' + (isFinal ? '' : ' style="display:none"') + '>▼</span> <span class="thinking-inline-label">' + labelText + '</span>' + (isFinal ? '' : ' <span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>');

  row.appendChild(avatar);
  row.appendChild(header);
  inline.appendChild(row);

  const body = document.createElement("div");
  body.className = "thinking-inline-body";
  body.textContent = store.text || "";
  inline.appendChild(body);

  return inline;
}

function createThinkingPlaceholder(turnId) {
  const div = document.createElement("div");
  div.className = "message-group-wrapper ai";
  const inline = buildInlineThinking(turnId);
  if (inline) div.appendChild(inline);
  chatFlow.appendChild(div);
  scrollBottom();
  return div;
}

function updateInlineThinkingLabel(turnId, labelText) {
  const inline = chatFlow.querySelector('.thinking-inline[data-turn-id="' + CSS.escape(turnId) + '"]');
  if (!inline) return;
  const label = inline.querySelector(".thinking-inline-label");
  if (label) label.textContent = labelText;
  if (labelText.indexOf("已思考") === 0) {
    inline.querySelectorAll(".thinking-dot").forEach(d => d.style.display = "none");
    const arrow = inline.querySelector(".thinking-inline-arrow");
    if (arrow) arrow.style.display = "";
  }
}

function updateThinkingForStreaming(msg) {
  const turnId = msg.turnId || msg.sessionId || "unknown";
  const store = thinkingStore.get(turnId);
  store.model = msg.model || "";
  thinkingStore.appendText(turnId, msg.text || "");

  if (streamingMsgEl) {
    const inline = streamingMsgEl.querySelector(".thinking-inline");
    if (inline) {
      if (inline.dataset.turnId && inline.dataset.turnId !== turnId) {
        inline.dataset.turnId = turnId;
      }
      const body = inline.querySelector(".thinking-inline-body");
      if (body) body.textContent = store.text;
      if (store.phase === "tooling") inline.classList.add("thinking-tool-active");
      else inline.classList.remove("thinking-tool-active");
    }
  } else {
    streamingMsgEl = createThinkingPlaceholder(turnId);
    thinkingStore.startTick(turnId);
  }
}

function finalizeAllThinking() {
  Object.keys(thinkingStore.turns).forEach(turnId => {
    const t = thinkingStore.turns[turnId];
    if (!t || t.phase === "final") return;
    thinkingStore.finalize(turnId);
    const elapsed = Math.floor((Date.now() - t.startTime) / 1000);
    updateInlineThinkingLabel(turnId, "已思考 " + Math.max(0, elapsed) + " 秒");
  });
}

// Thinking click handler (event delegation)
chatFlow.addEventListener("click", e => {
  const header = e.target.closest(".thinking-inline-header");
  if (!header) return;
  const inline = header.closest(".thinking-inline");
  if (!inline) return;
  const body = inline.querySelector(".thinking-inline-body");
  if (!body) return;
  const collapsed = body.classList.toggle("thinking-collapsed");
  const arrow = header.querySelector(".thinking-inline-arrow");
  if (arrow) arrow.textContent = collapsed ? "▶" : "▼";
});

/* ── Send ── */
function send() {
  const text = chatInput.value.trim();
  if (!text && !pendingFiles.length) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const payload = { type: "message", text: text, model: MODEL_NAME };
  if (pendingFiles.length) {
    payload.images = pendingFiles.map(f => ({ data: f.data, contentType: f.type, name: f.name }));
  }
  ws.send(JSON.stringify(payload));

  renderMsg({ from: "you", text: text || "[图片]", time: now() });
  pendingFiles = [];
  chatInput.value = "";
  chatInput.style.height = "24px";
  imagePreview.classList.remove("show");
  imagePreview.innerHTML = "";

  if (!streamingMsgEl) {
    const preTurnId = "pre-" + Date.now();
    thinkingStore.get(preTurnId);
    streamingMsgEl = createThinkingPlaceholder(preTurnId);
  }
}

/* ── WebSocket ── */
function online(v) {
  if (v) {
    statusDot.classList.remove("off");
    statusText.textContent = "在线 · DeepSeek";
    sendBtn.disabled = false;
  } else {
    statusDot.classList.add("off");
    statusText.textContent = "离线";
    sendBtn.disabled = true;
  }
}

function connect() {
  if (ws) { ws.onclose = null; ws.close(); }
  try { ws = new WebSocket(WS_URL); } catch (_) { scheduleReconnect(); return; }
  ws.onopen = () => { online(true); reconnectDelay = 1000; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.model && msg.model !== MODEL_NAME) return;
      switch (msg.type) {
        case "thinking":
          updateThinkingForStreaming(msg);
          break;
        case "text":
          if (msg.done) finalizeAllThinking();
          if (!streamingMsgEl) {
            streamingMsgEl = createThinkingPlaceholder(msg.turnId || "unknown");
          }
          const bubble = document.createElement("div");
          bubble.className = "message-bubble";
          bubble.innerHTML = esc(msg.text) + '<div class="message-timestamp">' + now() + '</div>';
          if (streamingMsgEl) {
            const existingBubble = streamingMsgEl.querySelector(".message-bubble");
            if (existingBubble) existingBubble.remove();
            streamingMsgEl.appendChild(bubble);
          }
          if (msg.done) {
            streamingMsgEl = null;
            history.push({ from: "ke", text: msg.text, time: now(), model: msg.model });
            saveHistory(history);
          }
          scrollBottom();
          break;
        case "typing":
          break;
        case "error":
          renderMsg({ from: "ke", text: "[错误] " + (msg.text || "") });
          break;
      }
    } catch {}
  };
  ws.onclose = () => { online(false); scheduleReconnect(); };
  ws.onerror = () => { ws.close(); };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); connect(); }, reconnectDelay);
}

/* ── Image handling ── */
imageBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  for (const file of fileInput.files) {
    const reader = new FileReader();
    reader.onload = () => {
      pendingFiles.push({ data: reader.result.split(",")[1], type: file.type, name: file.name });
      renderPreviews();
    };
    reader.readAsDataURL(file);
  }
  fileInput.value = "";
});

function renderPreviews() {
  imagePreview.innerHTML = "";
  if (!pendingFiles.length) { imagePreview.classList.remove("show"); return; }
  imagePreview.classList.add("show");
  pendingFiles.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "preview-item";
    div.innerHTML = '<img src="data:' + f.type + ';base64,' + f.data + '"><button class="remove-btn" data-idx="' + i + '">×</button>';
    div.querySelector(".remove-btn").addEventListener("click", () => {
      pendingFiles.splice(i, 1);
      renderPreviews();
    });
    imagePreview.appendChild(div);
  });
}

/* ── Input events ── */
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
chatInput.addEventListener("input", () => {
  chatInput.style.height = "24px";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});
sendBtn.addEventListener("click", send);

/* ── Init ── */
history = loadHistory();
history.forEach(m => renderMsg(m, false));
scrollBottom();
connect();
setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 30000);

/* ── Menu button ── */
document.getElementById("menu-btn").addEventListener("click", () => {
  location.href = "/";
});
document.getElementById("settings-btn").addEventListener("click", () => {
  location.href = "/";
});
</script>`;

html = html.replace('</body>', js + '\n</body>');
fs.writeFileSync(p, html, 'utf8');
console.log('chat-ds.html wired with JS, length:', html.length);
