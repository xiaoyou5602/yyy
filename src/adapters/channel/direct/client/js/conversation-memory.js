/* ── Conversation Memory (chat archives in phone-home) ── */
(function () {
  const PAGE_SIZE = 80;
  const listPage = document.getElementById("conversation-list-page");
  const detailPage = document.getElementById("conversation-detail-page");

  // State
  let currentConversationId = null;
  let currentTopic = "";
  let allMessages = [];       // currently loaded messages
  let hasMore = false;
  let nextBefore = null;
  let loadingMore = false;
  let highlightMsgId = null;
  let detailSearchQuery = "";

  // ── Session list ──

  window.showConversationList = async function () {
    const grid = document.getElementById("conv-list-grid");
    if (!grid) return;
    grid.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      window._convListData = data.conversations || [];
      renderConvCards(window._convListData);
    } catch (err) {
      grid.innerHTML = '<div class="empty-state">加载失败，请稍后重试</div>';
    }
  };

  function renderConvCards(list) {
    const grid = document.getElementById("conv-list-grid");
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state">没有找到会话</div>';
      return;
    }
    grid.innerHTML = list.map(c => {
      const dateStr = c.dateRange.length === 1 ? c.dateRange[0]
        : `${c.dateRange[0]} ~ ${c.dateRange[c.dateRange.length - 1]}`;
      const thinkingIcon = c.hasThinking ? '<span class="conv-thinking-badge" title="含思考过程">💭</span>' : '';
      return `<div class="conv-card" data-id="${escAttr(c.id)}" onclick="window.openConversation('${escAttr(c.id)}', '${escAttr(c.topic)}')">
        <div class="conv-card-header">
          <span class="conv-card-topic">${thinkingIcon} ${esc(c.topic)}</span>
          <span class="conv-card-count">${c.messageCount} 条</span>
        </div>
        <div class="conv-card-date">${esc(dateStr)}</div>
        <div class="conv-card-preview">${esc(c.preview || '暂无预览')}</div>
      </div>`;
    }).join("");
  }

  // Client-side filter
  window.filterConvList = function (q) {
    const list = window._convListData || [];
    q = (q || "").trim().toLowerCase();
    if (!q) { renderConvCards(list); return; }
    const filtered = list.filter(c =>
      c.topic.toLowerCase().includes(q) ||
      (c.preview || "").toLowerCase().includes(q)
    );
    renderConvCards(filtered);
  };

  // ── Conversation detail ──

  window.openConversation = async function (convId, topic) {
    currentConversationId = convId;
    currentTopic = topic;
    allMessages = [];
    hasMore = false;
    nextBefore = null;
    highlightMsgId = null;
    detailSearchQuery = "";

    showPage("conversation-detail");

    const titleEl = document.getElementById("conv-detail-title");
    if (titleEl) titleEl.textContent = topic;

    const msgArea = document.getElementById("conv-msg-area");
    if (msgArea) { msgArea.innerHTML = '<div class="empty-state">加载中…</div>'; msgArea.scrollTop = 0; }

    // Check URL for highlight param
    const urlParams = new URLSearchParams(window.location.search);
    const hlMsg = urlParams.get("message");
    if (hlMsg) highlightMsgId = hlMsg;

    // Clear search
    const searchInput = document.getElementById("conv-detail-search");
    if (searchInput) searchInput.value = "";

    await loadMoreMessages(true);
  };

  async function loadMoreMessages(initial) {
    if (loadingMore) return;
    if (!initial && !hasMore) return;
    loadingMore = true;

    const msgArea = document.getElementById("conv-msg-area");
    try {
      let url = `/api/conversations/${encodeURIComponent(currentConversationId)}?limit=${PAGE_SIZE}`;
      if (!initial && nextBefore) url += `&before=${encodeURIComponent(nextBefore)}`;

      const res = await fetch(url);
      const data = await res.json();
      if (!data.messages || !data.messages.length) { loadingMore = false; return; }

      hasMore = data.hasMore;
      nextBefore = data.nextBefore;

      const frag = document.createDocumentFragment();
      for (const msg of data.messages) {
        frag.appendChild(buildMsgEl(msg));
      }

      if (initial) {
        msgArea.innerHTML = "";
        msgArea.appendChild(frag);
        msgArea.scrollTop = msgArea.scrollHeight;
        // Build full allMessages
        allMessages = data.messages.slice();
      } else {
        // Prepend: insert before first child
        const oldScrollHeight = msgArea.scrollHeight;
        msgArea.insertBefore(frag, msgArea.firstChild);
        // Restore scroll position
        msgArea.scrollTop = msgArea.scrollHeight - oldScrollHeight;
        // Prepend to allMessages
        allMessages = data.messages.concat(allMessages);
      }

      // Highlight
      if (highlightMsgId) {
        const target = msgArea.querySelector(`[data-msg-id="${highlightMsgId}"]`);
        if (target) {
          target.scrollIntoView({ block: "center" });
          target.classList.add("conv-msg-highlight");
          setTimeout(() => target.classList.remove("conv-msg-highlight"), 3000);
        }
      }
    } catch (err) {
      if (initial) msgArea.innerHTML = '<div class="empty-state">加载失败</div>';
    }
    loadingMore = false;
  }

  // Scroll-to-top detection for loading more
  window.initConvScroll = function () {
    const msgArea = document.getElementById("conv-msg-area");
    if (!msgArea) return;
    msgArea.addEventListener("scroll", function () {
      if (msgArea.scrollTop < 120 && hasMore && !loadingMore) {
        loadMoreMessages(false);
      }
    });
  };

  // ── Build a single message element ──
  function buildMsgEl(msg) {
    const div = document.createElement("div");
    div.className = `msg ${msg.role === "toge" ? "you" : "ke"}`;
    div.setAttribute("data-msg-id", msg.id);

    if (msg.role === "ke") {
      let textHtml = esc(msg.text);
      let thinkingHtml = "";
      if (msg.hasThinking && msg.thinking) {
        thinkingHtml = `<div class="conv-thinking-wrap">
          <button class="conv-thinking-toggle" onclick="window.toggleThinking(this)">💭 查看思考过程</button>
          <div class="conv-thinking-body" style="display:none">${esc(msg.thinking)}</div>
        </div>`;
      }
      div.innerHTML = `<div class="msg-inner">
        <div class="avatar-sm"><img src="/icon.png" alt="克"></div>
        <div class="msg-bubble">${textHtml}${thinkingHtml}
          <div class="time">${esc(msg.date)} ${esc(msg.time)}</div>
        </div>
      </div>`;
    } else {
      div.innerHTML = `${esc(msg.text)}
        <div class="time">${esc(msg.date)} ${esc(msg.time)}</div>`;
    }
    return div;
  }

  // ── Thinking toggle ──
  window.toggleThinking = function (btn) {
    const body = btn.nextElementSibling;
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "💭 收起思考" : "💭 查看思考过程";
  };

  // ── Scroll to a message by ID ──
  window.scrollToConvMessage = function (msgId) {
    const msgArea = document.getElementById("conv-msg-area");
    if (!msgArea) return;
    const el = msgArea.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.add("conv-msg-highlight");
      setTimeout(() => el.classList.remove("conv-msg-highlight"), 3000);
    }
  };

  // ── Search within conversation ──
  window.searchInConversation = function (q) {
    detailSearchQuery = (q || "").trim().toLowerCase();
    const msgArea = document.getElementById("conv-msg-area");
    if (!msgArea) return;

    if (!detailSearchQuery) {
      // Show all loaded messages
      msgArea.innerHTML = "";
      const frag = document.createDocumentFragment();
      for (const msg of allMessages) frag.appendChild(buildMsgEl(msg));
      msgArea.appendChild(frag);
      msgArea.scrollTop = msgArea.scrollHeight;
      return;
    }

    // Filter in-memory
    const results = allMessages.filter(m =>
      (m.text || "").toLowerCase().includes(detailSearchQuery) ||
      (m.thinking || "").toLowerCase().includes(detailSearchQuery)
    );

    msgArea.innerHTML = "";
    if (!results.length) {
      msgArea.innerHTML = '<div class="empty-state">没有找到匹配的消息</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const msg of results) frag.appendChild(buildMsgEl(msg));
    msgArea.appendChild(frag);
    msgArea.scrollTop = msgArea.scrollHeight;
  };

  // ── Global search (from detail page) ──
  window.searchAllConversations = async function (q) {
    q = (q || "").trim();
    if (!q || q.length < 1) return;
    const resultsArea = document.getElementById("conv-global-search-results");
    if (!resultsArea) return;
    resultsArea.innerHTML = '<div class="empty-state">搜索中…</div>';
    resultsArea.style.display = "block";

    try {
      const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.results || !data.results.length) {
        resultsArea.innerHTML = '<div class="empty-state">没有找到匹配的消息</div>';
        return;
      }
      resultsArea.innerHTML = data.results.map(r => {
        const badge = r.thinkingMatch ? '<span class="conv-search-thinking-badge">思考</span>' : '';
        return `<div class="conv-search-result-item" onclick="window.jumpToConversationMessage('${escAttr(r.conversationId)}', '${escAttr(r.messageId)}', '${escAttr(r.conversationTopic)}')">
          <div class="conv-search-result-header">
            <span class="conv-search-result-topic">${esc(r.conversationTopic)}</span>
            <span class="conv-search-result-date">${esc(r.date)} ${esc(r.time)}</span>
            ${badge}
          </div>
          <div class="conv-search-result-snippet">${esc(r.snippet)}</div>
        </div>`;
      }).join("");
    } catch (err) {
      resultsArea.innerHTML = '<div class="empty-state">搜索失败</div>';
    }
  };

  // Jump to a conversation and highlight a message
  window.jumpToConversationMessage = async function (convId, msgId, topic) {
    highlightMsgId = msgId;
    // Close global search overlay if open
    const overlay = document.getElementById("conv-global-search-overlay");
    if (overlay) overlay.classList.remove("show");
    await window.openConversation(convId, topic);
  };

  // ── Helpers ──
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML.replace(/\n/g, "<br>");
  }
  function escAttr(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML.replace(/"/g, "&quot;");
  }

  // ── Toggle global search overlay ──
  window.toggleConvGlobalSearch = function () {
    const overlay = document.getElementById("conv-global-search-overlay");
    const input = document.getElementById("conv-global-search-input");
    const results = document.getElementById("conv-global-search-results");
    if (!overlay) return;
    const isOpen = overlay.classList.contains("show");
    if (isOpen) {
      overlay.classList.remove("show");
      if (input) input.value = "";
      if (results) { results.innerHTML = ""; results.style.display = "none"; }
    } else {
      overlay.classList.add("show");
      if (results) { results.innerHTML = ""; results.style.display = "none"; }
      if (input) { input.value = ""; setTimeout(() => input.focus(), 100); }
    }
  };

  // ── Detail page back button ──
  window.closeConversationDetail = function () {
    showPage("conversation-list");
  };

  // Init scroll detection on first detail open
  window.initConvScroll();
})();
