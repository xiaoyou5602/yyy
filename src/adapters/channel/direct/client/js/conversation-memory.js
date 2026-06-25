/* ── Memory Items (chat archives + letters in phone-home) ── */
(function () {
  const PAGE_SIZE = 80;
  const LETTER_CATEGORIES = ["生日", "情书", "日常", "纪念日", "鼓励", "其他"];

  // ── State ──
  let currentConversationId = null;
  let currentTopic = "";
  let allMessages = [];
  let hasMore = false;
  let nextBefore = null;
  let loadingMore = false;
  let highlightMsgId = null;
  let detailSearchQuery = "";
  let sortMode = "date"; // date | type | custom
  let currentLetterId = null;
  let editingLetterId = null; // null = create, string = edit

  const TYPE_ICONS = {
    conversation: "💬",
    letter: "💌",
    photo: "🖼",
    music: "🎵",
    gift: "🎁",
    game: "🎮",
  };

  // ── Memory items list ──

  window.showMemoryItems = async function () {
    const grid = document.getElementById("conv-list-grid");
    if (!grid) return;
    grid.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
      const res = await fetch("/api/memory-items");
      const items = await res.json();
      window._convListData = items;
      applySortAndRender(items);
    } catch (err) {
      grid.innerHTML = '<div class="empty-state">加载失败，请稍后重试</div>';
    }
  };

  function applySortAndRender(items) {
    let sorted = items.slice();
    if (sortMode === "date") {
      sorted.sort((a, b) => (b.date || "").localeCompare(a.date || "", "zh-CN"));
    } else if (sortMode === "type") {
      const order = ["conversation", "letter", "photo", "music", "gift", "game"];
      sorted.sort((a, b) => {
        const ta = order.indexOf(a.type), tb = order.indexOf(b.type);
        if (ta !== tb) return ta - tb;
        return (b.date || "").localeCompare(a.date || "", "zh-CN");
      });
    }
    // custom: letters keep their sortOrder, conversations by date
    if (sortMode === "custom") {
      sorted.sort((a, b) => {
        if (a.type === "letter" && b.type === "letter") return (a.sortOrder || 0) - (b.sortOrder || 0);
        if (a.type === "letter") return -1;
        if (b.type === "letter") return 1;
        return (b.date || "").localeCompare(a.date || "", "zh-CN");
      });
    }
    renderMemoryCards(sorted);
  }

  function renderMemoryCards(items) {
    const grid = document.getElementById("conv-list-grid");
    if (!grid) return;
    window._activeMemoryItems = items;
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state">记忆库还是空的<br><small>点右上角 + 写第一封信吧</small></div>';
      return;
    }
    grid.innerHTML = items.map(item => {
      const icon = TYPE_ICONS[item.type] || "📄";
      const thinkingBadge = item.type === "conversation" && item.hasThinking ? '<span class="conv-thinking-badge" title="含思考过程">💭</span>' : "";
      const catBadge = item.category ? `<span class="conv-category-badge">${esc(item.category)}</span>` : "";
      const subtitle = item.type === "conversation"
        ? `${item.messageCount || 0} 条消息`
        : (item.category || "信件");
      const onclick = item.type === "conversation"
        ? `window.openConversation('${escAttr(item.id)}', '${escAttr(item.title)}')`
        : `window.openLetter('${escAttr(item.id)}')`;

      return `<div class="conv-card" data-id="${escAttr(item.id)}" data-type="${escAttr(item.type)}" onclick="${onclick}">
        <div class="conv-card-header">
          <span class="conv-card-icon">${icon}</span>
          <span class="conv-card-topic">${thinkingBadge} ${esc(item.title)}</span>
          ${catBadge}
        </div>
        <div class="conv-card-subtitle">${esc(subtitle)}</div>
        <div class="conv-card-date">${esc(item.date || "")}</div>
        <div class="conv-card-preview">${esc(item.preview || "暂无预览")}</div>
      </div>`;
    }).join("");
  }

  window.setSortMode = function (mode) {
    sortMode = mode;
    applySortAndRender(window._convListData || []);
    // Update sort button labels
    document.querySelectorAll(".conv-sort-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById("conv-sort-" + mode);
    if (activeBtn) activeBtn.classList.add("active");
  };

  window.filterConvList = function (q) {
    const items = window._convListData || [];
    q = (q || "").trim().toLowerCase();
    if (!q) { applySortAndRender(items); return; }
    const filtered = items.filter(c =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.preview || "").toLowerCase().includes(q) ||
      (c.category || "").toLowerCase().includes(q)
    );
    renderMemoryCards(filtered);
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

    const urlParams = new URLSearchParams(window.location.search);
    const hlMsg = urlParams.get("message");
    if (hlMsg) highlightMsgId = hlMsg;

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
        allMessages = data.messages.slice();
      } else {
        const oldScrollHeight = msgArea.scrollHeight;
        msgArea.insertBefore(frag, msgArea.firstChild);
        msgArea.scrollTop = msgArea.scrollHeight - oldScrollHeight;
        allMessages = data.messages.concat(allMessages);
      }

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

  window.initConvScroll = function () {
    const msgArea = document.getElementById("conv-msg-area");
    if (!msgArea) return;
    msgArea.addEventListener("scroll", function () {
      if (msgArea.scrollTop < 120 && hasMore && !loadingMore) {
        loadMoreMessages(false);
      }
    });
  };

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

  window.toggleThinking = function (btn) {
    const body = btn.nextElementSibling;
    if (!body) return;
    const isHidden = body.style.display === "none";
    body.style.display = isHidden ? "block" : "none";
    btn.textContent = isHidden ? "💭 收起思考" : "💭 查看思考过程";
  };

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

  window.searchInConversation = function (q) {
    detailSearchQuery = (q || "").trim().toLowerCase();
    const msgArea = document.getElementById("conv-msg-area");
    if (!msgArea) return;
    if (!detailSearchQuery) {
      msgArea.innerHTML = "";
      const frag = document.createDocumentFragment();
      for (const msg of allMessages) frag.appendChild(buildMsgEl(msg));
      msgArea.appendChild(frag);
      msgArea.scrollTop = msgArea.scrollHeight;
      return;
    }
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

  window.jumpToConversationMessage = async function (convId, msgId, topic) {
    highlightMsgId = msgId;
    const overlay = document.getElementById("conv-global-search-overlay");
    if (overlay) overlay.classList.remove("show");
    await window.openConversation(convId, topic);
  };

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

  window.closeConversationDetail = function () {
    showPage("conversation-list");
  };

  // ── Letter detail (iframe view) ──

  window.openLetter = async function (letterId) {
    currentLetterId = letterId;
    const res = await fetch("/api/letters");
    const letters = await res.json();
    const letter = letters.find(l => l.id === letterId);
    if (!letter) return;

    showPage("letter-detail");
    const titleEl = document.getElementById("letter-detail-title");
    if (titleEl) titleEl.textContent = letter.title;

    const iframe = document.getElementById("letter-iframe");
    if (iframe) iframe.src = `/api/letters/${encodeURIComponent(letterId)}/view`;
  };

  window.closeLetterDetail = function () {
    const iframe = document.getElementById("letter-iframe");
    if (iframe) iframe.src = "";
    showPage("conversation-list");
    window.showMemoryItems();
  };

  window.editCurrentLetter = function () {
    if (!currentLetterId) return;
    window.openLetterEditor(currentLetterId);
  };

  // ── Letter editor ──

  window.openLetterEditor = async function (letterId) {
    editingLetterId = letterId || null;
    const titleEl = document.getElementById("letter-editor-title");
    if (titleEl) titleEl.textContent = letterId ? "编辑信件" : "新建信件";

    // Reset form
    document.getElementById("le-title").value = "";
    document.getElementById("le-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("le-preview").value = "";
    document.getElementById("le-html").value = "";

    if (letterId) {
      const res = await fetch("/api/letters");
      const letters = await res.json();
      const letter = letters.find(l => l.id === letterId);
      if (letter) {
        document.getElementById("le-title").value = letter.title || "";
        document.getElementById("le-date").value = letter.date || "";
        document.getElementById("le-preview").value = letter.preview || "";
        // Fetch HTML content
        try {
          const htmlRes = await fetch(`/api/letters/${encodeURIComponent(letterId)}/view`);
          if (htmlRes.ok) {
            document.getElementById("le-html").value = await htmlRes.text();
          }
        } catch {}
        // Select category
        window._selectedCategory = letter.category || "";
        renderCategoryChips();
      }
    } else {
      window._selectedCategory = "";
      renderCategoryChips();
    }

    showPage("letter-editor");
  };

  window.closeLetterEditor = function () {
    showPage("conversation-list");
    window.showMemoryItems();
  };

  window._selectedCategory = "";

  function renderCategoryChips() {
    const container = document.getElementById("le-category-chips");
    if (!container) return;
    const cats = [...new Set([...LETTER_CATEGORIES, window._selectedCategory].filter(Boolean))];
    container.innerHTML = cats.map(c => {
      const active = c === window._selectedCategory;
      return `<span class="le-category-chip${active ? ' active' : ''}" onclick="window.leSelectCategory('${escAttr(c)}')">${esc(c)}</span>`;
    }).join("");
  }

  window.leSelectCategory = function (cat) {
    window._selectedCategory = window._selectedCategory === cat ? "" : cat;
    renderCategoryChips();
  };

  window.leAddCategory = function () {
    const input = document.getElementById("le-new-category");
    const cat = (input.value || "").trim();
    if (!cat) return;
    window._selectedCategory = cat;
    input.value = "";
    renderCategoryChips();
  };

  window.previewLetter = function () {
    const html = document.getElementById("le-html").value || "";
    const title = document.getElementById("le-title").value || "预览";
    const wrapped = wrapHtml(html, title);
    // Show preview in iframe using blob URL
    const iframe = document.getElementById("letter-iframe");
    if (iframe) {
      const blob = new Blob([wrapped], { type: "text/html" });
      iframe.src = URL.createObjectURL(blob);
    }
    showPage("letter-detail");
    document.getElementById("letter-detail-title").textContent = title + "（预览）";
  };

  window.saveLetter = async function () {
    const title = document.getElementById("le-title").value.trim();
    const html = document.getElementById("le-html").value;
    if (!title || !html) { alert("标题和内容不能为空"); return; }

    const body = {
      title,
      date: document.getElementById("le-date").value,
      preview: document.getElementById("le-preview").value.trim() || title,
      html: wrapHtml(html, title),
      category: window._selectedCategory || "",
    };

    try {
      let res;
      if (editingLetterId) {
        res = await fetch(`/api/letters/${encodeURIComponent(editingLetterId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/letters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (res.ok) {
        window.closeLetterEditor();
      } else {
        const err = await res.json();
        alert("保存失败: " + (err.error || "未知错误"));
      }
    } catch (err) {
      alert("保存失败: 网络错误");
    }
  };

  function wrapHtml(content, title) {
    // If content already looks like a full HTML document, return as-is
    if (/<html/i.test(content) || /<!DOCTYPE/i.test(content)) return content;
    // Wrap plain text or partial HTML
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px 20px;line-height:1.8;color:#333;background:#fdfaf5;font-size:15px}h1{font-size:20px;text-align:center;margin-bottom:24px}p{margin:12px 0}img{max-width:100%;border-radius:8px}.signature{text-align:right;margin-top:32px;color:#888}</style>
</head>
<body>${content}</body>
</html>`;
  }

  // Init letter view scroll init
  window.initLetterView = function () {
    // No special init needed; iframe handles itself
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

  // ── Chat archive import ──

  window.triggerChatImport = function () {
    const input = document.getElementById("conv-import-input");
    if (input) input.click();
  };

  window.handleChatImport = async function (files) {
    if (!files || !files.length) return;
    const grid = document.getElementById("conv-list-grid");
    if (grid) grid.innerHTML = '<div class="empty-state">导入中…</div>';

    let imported = 0;
    for (const file of files) {
      try {
        const content = await file.text();
        // Derive folder from filename: "YYYY-MM-DD topic.md" → "topic"
        let folder = file.name.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}\s*/, "").trim();
        if (!folder) folder = "导入";
        const res = await fetch("/api/conversations/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, filename: file.name, content }),
        });
        if (res.ok) imported++;
      } catch (err) {
        console.error("Import failed for", file.name, err);
      }
    }

    // Refresh list
    window.showMemoryItems();
    // Also refresh server cache
    try { await fetch("/api/conversations/refresh", { method: "POST" }); } catch {}
  };

  // Init scroll detection on first detail open
  window.initConvScroll();
})();
