/* ═══ DS Chat — Gemini 暖瓷页面 JS ═══ */
;(function () {
  const MODEL_NAME = "deepseek-v4-pro";
  const STORAGE_KEY = "withtoge-chat-history-deepseek-v4-pro";
  const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  let ws, history, pendingFiles, streamingMsgEl, _msgIdx, reconnectTimer, reconnectDelay;
  let dsStreamText = ""; // 积累本轮全部 chunk——服务端分段广播,只显示/保存最后一段会丢内容
  let thinkingStore, chatFlow, chatInput, sendBtn, imageBtn, fileInput, imagePreview, statusDot, statusText, scrollBottomBtn, unreadBadgeEl;
  let unreadCount = 0;

  function esc(s) {
    const d = document.createElement("div"); d.textContent = s; return d.innerHTML.replace(/\n/g, "<br>");
  }
  function now() { return new Date().toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" }); }
  function scrollBottom() { if (chatFlow) chatFlow.scrollTop = chatFlow.scrollHeight; }

  /* ── Scroll-to-bottom ── */
  function isAtBottom() { return !chatFlow || chatFlow.scrollHeight - chatFlow.scrollTop - chatFlow.clientHeight < 120; }
  function updateScrollToBottomBtn() { if (scrollBottomBtn) scrollBottomBtn.classList.toggle("show", !isAtBottom()); }
  function updateUnreadBadge() {
    if (!unreadBadgeEl) return;
    unreadBadgeEl.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    unreadBadgeEl.classList.toggle("show", unreadCount > 0);
  }
  function bumpUnread() { unreadCount++; updateUnreadBadge(); }
  function clearUnread() { unreadCount = 0; updateUnreadBadge(); }
  // 仅在已经停在底部时跟随滚动（流式输出贴底跟随，不打断向上翻阅）
  function followScroll() { if (isAtBottom()) scrollBottom(); }
  // 新一条 AI 消息到达：在底部就跟随滚动，不在底部就计入未读角标
  function notifyNewMessage() {
    if (isAtBottom()) scrollBottom(); else bumpUnread();
    updateScrollToBottomBtn();
  }
  function jumpToBottom() {
    if (chatFlow) chatFlow.scrollTo({ top: chatFlow.scrollHeight, behavior: "smooth" });
    clearUnread();
  }
  function loadHistory() { try { var h = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); console.log("[ds-chat] loadHistory count=" + h.length); return h; } catch { console.warn("[ds-chat] loadHistory failed"); return []; } }
  function saveHistory(h) { try { var s = h.slice(-500); localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); console.log("[ds-chat] saveHistory count=" + s.length); } catch(e) { console.warn("[ds-chat] saveHistory failed:", e.message); try { var trimmed1 = h.slice(-350); localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed1)); history.length = 0; history.push.apply(history, trimmed1); console.log("[ds-chat] saveHistory trimmed to 350"); } catch(e2) { console.warn("[ds-chat] saveHistory trim1 failed:", e2.message); try { var noThinking = h.filter(function(m) { return m.from !== "thinking"; }).slice(-200); localStorage.setItem(STORAGE_KEY, JSON.stringify(noThinking)); history.length = 0; history.push.apply(history, noThinking); console.log("[ds-chat] saveHistory removed thinking entries"); } catch(e3) { console.error("[ds-chat] saveHistory all retries failed:", e3.message); } } } }

  var HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';

  function renderMsg(msg, save) {
    if (save === undefined) save = true;
    var wrap = document.createElement("div");

    // ── Thinking entries from history ──
    if (msg.from === "thinking") {
      console.log("[ds-chat] render thinking from history len=" + (msg.text || "").length);
      wrap.className = "ds-msg-group ai";
      wrap.appendChild(buildStaticThinking(msg.text || ""));
      var tTime = document.createElement("span");
      tTime.className = "ds-msg-time";
      tTime.textContent = msg.time || now();
      wrap.appendChild(tTime);
      chatFlow.appendChild(wrap);
      followScroll();
      if (save) { history.push(msg); saveHistory(history); }
      return wrap;
    }

    // ── Sticker entries from history ──
    if (msg.stickerId) return renderStickerMsg(msg, save);

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
    followScroll();
    if (save) { history.push(msg); saveHistory(history); }
    return wrap;
  }

  /* ── Sticker rendering ── */
  function renderStickerMsg(msg, save) {
    if (save === undefined) save = true;
    var wrap = document.createElement("div");
    wrap.className = "ds-msg-group " + (msg.from === "you" ? "user" : "ai");
    var bubble = document.createElement("div");
    bubble.className = "ds-msg-bubble";
    var src = "/api/stickers/" + (msg.stickerId || "") + ".gif";
    bubble.innerHTML = '<img src="' + src + '" alt="贴纸" style="max-width:160px;border-radius:8px;">';
    wrap.appendChild(bubble);
    var timeEl = document.createElement("span");
    timeEl.className = "ds-msg-time";
    timeEl.textContent = msg.time || now();
    wrap.appendChild(timeEl);
    chatFlow.appendChild(wrap);
    followScroll();
    if (save) {
      history.push({ from: msg.from, text: "[贴纸]", stickerId: msg.stickerId, time: msg.time || now() });
      saveHistory(history);
    }
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
    avatar.innerHTML = HEART_SVG;
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

  function buildStaticThinking(text) {
    var inline = document.createElement("div");
    inline.className = "ds-thinking-inline";
    var row = document.createElement("div");
    row.className = "ds-thinking-row";
    var avatar = document.createElement("div");
    avatar.className = "ds-thinking-avatar";
    avatar.innerHTML = HEART_SVG;
    var header = document.createElement("div");
    header.className = "ds-thinking-header";
    header.innerHTML = '<span class="ds-thinking-arrow">▼</span> <span class="ds-thinking-label">已思考完毕</span>';
    row.appendChild(avatar); row.appendChild(header); inline.appendChild(row);
    var body = document.createElement("div");
    body.className = "ds-thinking-body";
    body.textContent = text || "";
    inline.appendChild(body);
    return inline;
  }

  function createPlaceholder(turnId) {
    var div = document.createElement("div");
    div.className = "ds-msg-group ai";
    var inline = buildThinking(turnId);
    if (inline) div.appendChild(inline);
    chatFlow.appendChild(div);
    notifyNewMessage();
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
      // Persist thinking text to history so it survives page refresh
      if (t.text && t.text.trim()) {
        history.push({ from: "thinking", text: t.text.trim(), time: now(), model: t.model || MODEL_NAME, turnId: turnId });
        console.log("[ds-chat] thinking saved to history len=" + t.text.trim().length + " turn=" + turnId);
      } else {
        console.log("[ds-chat] thinking skipped (empty) turn=" + turnId);
      }
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
        // sync messages bypass model filter — they carry their own model per entry
        if (msg.type === "sync") {
          handleSync(msg.messages || []);
          return;
        }
        if (msg.model && msg.model !== MODEL_NAME) return;
        switch (msg.type) {
          case "thinking": updateStream(msg); break;
          case "text":
            if (msg.done) finalizeAll();
            if (!streamingMsgEl) streamingMsgEl = createPlaceholder(msg.turnId || "unknown");
            var isFirstChunk = (!msg.chunkIndex || msg.chunkIndex === 0);
            dsStreamText = isFirstChunk ? String(msg.text || "") : dsStreamText + String(msg.text || "");
            var bubble = document.createElement("div");
            bubble.className = "ds-msg-bubble";
            bubble.innerHTML = esc(dsStreamText) + '<div class="ds-msg-time">' + now() + '</div>';
            if (streamingMsgEl) {
              var eb = streamingMsgEl.querySelector(".ds-msg-bubble");
              if (eb) eb.remove();
              streamingMsgEl.appendChild(bubble);
            }
            if (msg.done) {
              streamingMsgEl = null;
              history.push({ from: "ke", text: dsStreamText, time: now(), model: msg.model, globalId: msg.globalId || "" });
              saveHistory(history);
              dsStreamText = "";
            }
            followScroll();
            break;
          case "error":
            renderMsg({ from: "ke", text: "[错误] " + (msg.text || "") });
            notifyNewMessage();
            break;
          case "sticker":
            renderStickerMsg(msg);
            notifyNewMessage();
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

  function handleSync(messages) {
    if (!messages || !messages.length) { console.log("[ds-chat] sync empty"); return; }
    console.log("[ds-chat] sync received count=" + messages.length);
    var seen = {};
    history.forEach(function(h) {
      if (h.globalId) seen[h.globalId] = true;
      if (h.from === "thinking" && h.turnId) {
        seen["thinking|" + h.turnId] = true;
      }
      if (h.stickerId) seen[h.from + "|sticker|" + h.stickerId] = true;
      seen[h.from + "|" + h.text + "|" + h.time] = true;
    });
    var added = false;
    messages.forEach(function(m) {
      if (m.from !== "ke" && m.from !== "thinking" && !m.stickerId) return;
      if (m.globalId && seen[m.globalId]) return;
      var key = m.from === "thinking" && m.turnId
          ? "thinking|" + m.turnId
          : (m.stickerId ? (m.from || "ke") + "|sticker|" + m.stickerId : (m.from || "ke") + "|" + m.text + "|" + (m.time || ""));
      if (seen[key]) return;
      // Skip partial duplicates: a sync message whose text is a prefix of
      // an already-rendered message (e.g. partial flush vs final flush)
      var isPartial = history.some(function(h) {
        return h.from === "ke" && h.text && h.text.indexOf(m.text) === 0 && h.text.length > m.text.length;
      });
      if (isPartial) return;
      seen[key] = true;
      if (m.globalId) seen[m.globalId] = true;
      // Push to history BEFORE rendering, so it survives next refresh
      var entry = { from: m.from || "ke", text: m.text, time: m.time || now(), model: m.model || "", globalId: m.globalId || "", stickerId: m.stickerId || undefined };
      history.push(entry);
      renderMsg(entry, false);
      added = true;
    });
    if (added) { saveHistory(history); console.log("[ds-chat] sync saved added=" + added + " historyLen=" + history.length); }
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
    scrollBottomBtn = document.getElementById("ds-scroll-bottom-btn");
    unreadBadgeEl = document.getElementById("ds-unread-badge");

    pendingFiles = [];
    streamingMsgEl = null;
    _msgIdx = 0;
    reconnectDelay = 1000;
    reconnectTimer = null;
    unreadCount = 0;

    // Load history
    history = loadHistory();
    if (chatFlow) {
      chatFlow.innerHTML = "";
      history.forEach(function(m) {
        try { renderMsg(m, false); } catch (initErr) {
          console.error("[ds-chat] init render failed for", m.from, m.turnId || "", initErr.message);
        }
      });
      scrollBottom();
      clearUnread();
    }

    if (chatFlow) {
      chatFlow.addEventListener("scroll", function() {
        updateScrollToBottomBtn();
        if (isAtBottom()) clearUnread();
      });
    }
    if (scrollBottomBtn) scrollBottomBtn.addEventListener("click", jumpToBottom);

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
    var searchBtn = document.getElementById("ds-search-btn");
    if (menuBtn) menuBtn.addEventListener("click", function() { if (typeof toggleSidebar === "function") toggleSidebar(); });
    // DS 页设置按钮 → 打开真正的设置面板（不是侧栏）
    if (settingsBtn) settingsBtn.addEventListener("click", function() {
      if (typeof openSettingsPanel === 'function') { openSettingsPanel(); }
      else {
        // 兜底：自己打开
        try {
          var overlay = document.getElementById("settings-overlay");
          var modelSel = document.getElementById("setting-model");
          if (modelSel && typeof settings !== 'undefined') modelSel.value = settings.model || "";
          if (overlay) overlay.classList.add("show");
        } catch(e) {}
      }
    });
    // DS 页搜索按钮 → 打开搜索面板
    if (searchBtn) searchBtn.addEventListener("click", function() {
      var sOverlay = document.getElementById("search-overlay");
      var sInput = document.getElementById("search-input");
      if (sOverlay) { sOverlay.classList.add("show"); if (sInput) { sInput.value = ''; setTimeout(function() { sInput.focus(); }, 100); } }
    });

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

  // 自愈：index.html 的启动路由（last-page=chat-ds 时 showPage+dsChatInit）在主内联脚本里执行，
  // 早于本脚本（页面尾部 <script src>）加载，彼时 dsChatInit 尚未定义、typeof 检查静默跳过，
  // DS 页显示了却永远没建 WS（症状：卡"连接中…"）。此处兜底补跑一次。
  var dsPageEl = document.getElementById("chat-ds-page");
  if (dsPageEl && dsPageEl.classList.contains("show") && !window._dsInited) window.dsChatInit();
})();
