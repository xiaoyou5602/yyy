/* ═══ DS Chat — Gemini 暖瓷页面 JS ═══ */
;(function () {
  const MODEL_NAME = "deepseek-v4-pro";
  const STORAGE_KEY = "withtoge-chat-history-deepseek-v4-pro";
  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  let ws, history, pendingFiles, streamingMsgEl, _msgIdx, reconnectTimer, reconnectDelay;
  let thinkingStore, chatFlow, chatInput, sendBtn, imageBtn, fileInput, imagePreview, statusDot, statusText;

  function esc(s) {
    const d = document.createElement("div"); d.textContent = s; return d.innerHTML.replace(/\n/g, "<br>");
  }
  function now() { return new Date().toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" }); }
  function scrollBottom() { if (chatFlow) chatFlow.scrollTop = chatFlow.scrollHeight; }
  function loadHistory() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
  function saveHistory(h) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-500))); } catch {} }

  function renderMsg(msg, save) {
    if (save === undefined) save = true;
    var wrap = document.createElement("div");
    wrap.className = "ds-msg-group " + (msg.from === "you" ? "user" : "ai");
    var bubble = document.createElement("div");
    bubble.className = "ds-msg-bubble";
    bubble.innerHTML = esc(msg.text);
    if (msg.images && msg.images.length) {
      bubble.innerHTML += msg.images.map(function(img) {
        var src = img.thumb || img.data || "";
        return src ? '<br><img src="' + src + '" style="max-width:100%;border-radius:8px;margin-top:6px;">' : "";
      }).join("");
    }
    wrap.appendChild(bubble);
    var time = document.createElement("span");
    time.className = "ds-msg-time";
    time.textContent = msg.time || now();
    wrap.appendChild(time);
    chatFlow.appendChild(wrap);
    scrollBottom();
    if (save) { history.push(msg); saveHistory(history); }
    return wrap;
  }

  /* ── Thinking Store ── */
  thinkingStore = {
    turns: {},
    get: function(turnId) {
      if (!this.turns[turnId]) {
        this.turns[turnId] = { phase: "thinking", text: "", model: MODEL_NAME, startTime: Date.now(), tickInterval: null };
      }
      return this.turns[turnId];
    },
    setPhase: function(turnId, phase) { this.get(turnId).phase = phase; },
    appendText: function(turnId, text) { this.get(turnId).text = text; return true; },
    startTick: function(turnId) {
      var self = this;
      var t = this.get(turnId);
      if (t.tickInterval) return;
      t.tickInterval = setInterval(function() {
        var elapsed = Math.floor((Date.now() - t.startTime) / 1000);
        updateLabel(turnId, t.phase === "tooling" ? "正在调用工具..." : "思考中 (" + elapsed + "秒)...");
      }, 1000);
    },
    cleanup: function(turnId) {
      var t = this.turns[turnId];
      if (!t) return;
      if (t.tickInterval) { clearInterval(t.tickInterval); t.tickInterval = null; }
    },
    finalize: function(turnId) {
      var t = this.turns[turnId];
      if (!t) return;
      this.cleanup(turnId);
      t.phase = "final";
    }
  };

  function buildThinking(turnId) {
    var store = thinkingStore.turns[turnId];
    if (!store) return null;
    var inline = document.createElement("div");
    inline.className = "ds-thinking-inline";
    inline.dataset.turnId = turnId;
    if (store.phase === "tooling") inline.classList.add("ds-tool-active");
    var row = document.createElement("div");
    row.className = "ds-thinking-row";
    var avatar = document.createElement("div");
    avatar.className = "ds-thinking-avatar";
    avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
    var header = document.createElement("div");
    header.className = "ds-thinking-header";
    var isFinal = (store.phase === "final");
    var labelText = store.phase === "tooling" ? "正在调用工具..." : (isFinal ? "已思考完毕" : "思考中...");
    header.innerHTML = '<span class="ds-thinking-arrow"' + (isFinal ? '' : ' style="display:none"') + '>▼</span> <span class="ds-thinking-label">' + labelText + '</span>' + (isFinal ? '' : ' <span class="ds-thinking-dot"></span><span class="ds-thinking-dot"></span><span class="ds-thinking-dot"></span>');
    row.appendChild(avatar); row.appendChild(header); inline.appendChild(row);
    var body = document.createElement("div");
    body.className = "ds-thinking-body";
    body.textContent = store.text || "";
    inline.appendChild(body);
    return inline;
  }

  function createPlaceholder(turnId) {
    var div = document.createElement("div");
    div.className = "ds-msg-group ai";
    var inline = buildThinking(turnId);
    if (inline) div.appendChild(inline);
    chatFlow.appendChild(div);
    scrollBottom();
    return div;
  }

  function updateLabel(turnId, labelText) {
    var inline = chatFlow.querySelector('.ds-thinking-inline[data-turn-id="' + CSS.escape(turnId) + '"]');
    if (!inline) return;
    var label = inline.querySelector(".ds-thinking-label");
    if (label) label.textContent = labelText;
    if (labelText.indexOf("已思考") === 0) {
      var dots = inline.querySelectorAll(".ds-thinking-dot");
      for (var d = 0; d < dots.length; d++) dots[d].style.display = "none";
      var arrow = inline.querySelector(".ds-thinking-arrow");
      if (arrow) arrow.style.display = "";
    }
  }

  function updateStream(msg) {
    var turnId = msg.turnId || msg.sessionId || "unknown";
    var store = thinkingStore.get(turnId);
    store.model = msg.model || "";
    thinkingStore.appendText(turnId, msg.text || "");
    if (streamingMsgEl) {
      var inline = streamingMsgEl.querySelector(".ds-thinking-inline");
      if (inline) {
        if (inline.dataset.turnId && inline.dataset.turnId !== turnId) inline.dataset.turnId = turnId;
        var body = inline.querySelector(".ds-thinking-body");
        if (body) body.textContent = store.text;
        if (store.phase === "tooling") inline.classList.add("ds-tool-active");
        else inline.classList.remove("ds-tool-active");
      }
    } else {
      streamingMsgEl = createPlaceholder(turnId);
      thinkingStore.startTick(turnId);
    }
  }

  function finalizeAll() {
    Object.keys(thinkingStore.turns).forEach(function(turnId) {
      var t = thinkingStore.turns[turnId];
      if (!t || t.phase === "final") return;
      thinkingStore.finalize(turnId);
      var elapsed = Math.floor((Date.now() - t.startTime) / 1000);
      updateLabel(turnId, "已思考 " + Math.max(0, elapsed) + " 秒");
    });
  }

  function send() {
    var text = chatInput.value.trim();
    if (!text && !pendingFiles.length) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var payload = { type: "message", text: text, model: MODEL_NAME };
    if (pendingFiles.length) payload.images = pendingFiles.map(function(f) { return { data: f.data, contentType: f.type, name: f.name }; });
    ws.send(JSON.stringify(payload));
    renderMsg({ from: "you", text: text || "[图片]", time: now() });
    pendingFiles = [];
    chatInput.value = ""; chatInput.style.height = "24px";
    imagePreview.classList.remove("show"); imagePreview.innerHTML = "";
    if (!streamingMsgEl) {
      var preId = "pre-" + Date.now();
      thinkingStore.get(preId);
      streamingMsgEl = createPlaceholder(preId);
    }
  }

  function online(v) {
    if (v) { statusDot.classList.remove("off"); statusText.textContent = "在线 · DeepSeek"; sendBtn.disabled = false; }
    else { statusDot.classList.add("off"); statusText.textContent = "离线"; sendBtn.disabled = true; }
  }

  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }
    try { ws = new WebSocket(WS_URL); } catch (_) { scheduleReconnect(); return; }
    ws.onopen = function() { online(true); reconnectDelay = 1000; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } };
    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.model && msg.model !== MODEL_NAME) return;
        switch (msg.type) {
          case "thinking": updateStream(msg); break;
          case "text":
            if (msg.done) finalizeAll();
            if (!streamingMsgEl) streamingMsgEl = createPlaceholder(msg.turnId || "unknown");
            var bubble = document.createElement("div");
            bubble.className = "ds-msg-bubble";
            bubble.innerHTML = esc(msg.text) + '<div class="ds-msg-time">' + now() + '</div>';
            if (streamingMsgEl) {
              var eb = streamingMsgEl.querySelector(".ds-msg-bubble");
              if (eb) eb.remove();
              streamingMsgEl.appendChild(bubble);
            }
            if (msg.done) {
              streamingMsgEl = null;
              history.push({ from: "ke", text: msg.text, time: now(), model: msg.model });
              saveHistory(history);
            }
            scrollBottom();
            break;
          case "error":
            renderMsg({ from: "ke", text: "[错误] " + (msg.text || "") });
            break;
        }
      } catch (_) {}
    };
    ws.onclose = function() { online(false); scheduleReconnect(); };
    ws.onerror = function() { ws.close(); };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() { reconnectDelay = Math.min(reconnectDelay * 1.5, 30000); connect(); }, reconnectDelay);
  }

  function renderPreviews() {
    imagePreview.innerHTML = "";
    if (!pendingFiles.length) { imagePreview.classList.remove("show"); return; }
    imagePreview.classList.add("show");
    pendingFiles.forEach(function(f, i) {
      var div = document.createElement("div");
      div.className = "ds-preview-item";
      div.innerHTML = '<img src="data:' + f.type + ';base64,' + f.data + '"><button class="ds-preview-remove" data-idx="' + i + '">×</button>';
      div.querySelector(".ds-preview-remove").addEventListener("click", function() { pendingFiles.splice(i, 1); renderPreviews(); });
      imagePreview.appendChild(div);
    });
  }

  /* ── Public API ── */
  window.dsChatInit = function() {
    if (window._dsInited) return;
    window._dsInited = true;
    chatFlow = document.getElementById("ds-chat-flow");
    chatInput = document.getElementById("ds-chat-input");
    sendBtn = document.getElementById("ds-send-btn");
    imageBtn = document.getElementById("ds-image-btn");
    fileInput = document.getElementById("ds-file-input");
    imagePreview = document.getElementById("ds-img-preview");
    statusDot = document.getElementById("ds-status-dot");
    statusText = document.getElementById("ds-status-text");

    pendingFiles = [];
    streamingMsgEl = null;
    _msgIdx = 0;
    reconnectDelay = 1000;
    reconnectTimer = null;

    // Load history
    history = loadHistory();
    if (chatFlow) {
      chatFlow.innerHTML = "";
      history.forEach(function(m) { renderMsg(m, false); });
      scrollBottom();
    }

    // Event listeners
    if (chatInput) {
      chatInput.addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      chatInput.addEventListener("input", function() { chatInput.style.height = "24px"; chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px"; });
    }
    if (sendBtn) sendBtn.addEventListener("click", send);
    if (imageBtn) imageBtn.addEventListener("click", function() { if (fileInput) fileInput.click(); });
    if (fileInput) {
      fileInput.addEventListener("change", function() {
        for (var i = 0; i < fileInput.files.length; i++) {
          (function(file) {
            var reader = new FileReader();
            reader.onload = function() { pendingFiles.push({ data: reader.result.split(",")[1], type: file.type, name: file.name }); renderPreviews(); };
            reader.readAsDataURL(file);
          })(fileInput.files[i]);
        }
        fileInput.value = "";
      });
    }
    // Thinking click
    if (chatFlow) {
      // Header buttons (only once, guarded by _dsInited)
    var menuBtn = document.getElementById("ds-menu-btn");
    var settingsBtn = document.getElementById("ds-settings-btn");
    if (menuBtn) menuBtn.addEventListener("click", function() { if (typeof toggleSidebar === "function") toggleSidebar(); });
    if (settingsBtn) settingsBtn.addEventListener("click", function() { if (typeof toggleSidebar === "function") toggleSidebar(); });

    chatFlow.addEventListener("click", function(e) {
        var hdr = e.target.closest(".ds-thinking-header");
        if (!hdr) return;
        var inline = hdr.closest(".ds-thinking-inline");
        if (!inline) return;
        var body = inline.querySelector(".ds-thinking-body");
        if (!body) return;
        var collapsed = body.classList.toggle("ds-collapsed");
        var arrow = hdr.querySelector(".ds-thinking-arrow");
        if (arrow) arrow.textContent = collapsed ? "▶" : "▼";
      });
    }

    connect();
    // Ping
    var pingTimer = setInterval(function() { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" })); }, 30000);
    window._dsPingTimer = pingTimer;
  };

  window.dsChatDestroy = function() {
    window._dsInited = false;
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (window._dsPingTimer) { clearInterval(window._dsPingTimer); window._dsPingTimer = null; }
    // Cleanup all thinking
    Object.keys(thinkingStore.turns).forEach(function(turnId) { thinkingStore.cleanup(turnId); });
    streamingMsgEl = null;
  };
})();
