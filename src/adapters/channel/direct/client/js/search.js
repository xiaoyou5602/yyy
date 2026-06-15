/* ── Search ── */
const searchOverlay = document.getElementById("search-overlay");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchMore = document.getElementById("search-more");
let searchHits = [];
let searchOffset = 0;
const SEARCH_PAGE = 10;

document.getElementById("search-btn").addEventListener("click", () => {
  searchOverlay.classList.add("show");
  searchInput.value = "";
  searchResults.innerHTML = `<p class="search-empty">输入关键词开始搜索</p>`;
  searchMore.classList.remove("show");
  searchHits = [];
  setTimeout(() => searchInput.focus(), 100);
});

document.getElementById("search-close").addEventListener("click", () => {
  searchOverlay.classList.remove("show");
});
searchOverlay.addEventListener("click", (e) => {
  if (e.target === searchOverlay) searchOverlay.classList.remove("show");
});

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.innerHTML = `<p class="search-empty">输入关键词开始搜索</p>`;
    searchMore.classList.remove("show");
    searchHits = [];
    return;
  }

  searchHits = [];

  // ── Local: search current chat history ──
  try {
    const sk = typeof getStorageKey === "function" ? getStorageKey() : STORAGE_KEY;
    const msgs = JSON.parse(localStorage.getItem(sk) || "[]");
    for (let j = 0; j < msgs.length; j++) {
      const m = msgs[j];
      const text = (m.text || "").toLowerCase();
      const idx = text.indexOf(q);
      if (idx === -1) continue;
      const prev = j > 0 ? msgs[j - 1] : null;
      const next = j < msgs.length - 1 ? msgs[j + 1] : null;
      searchHits.push({ date: m.time || "", msg: m, prev, next, matchIdx: idx, key: sk, msgIdx: j, source: "local" });
    }
  } catch {}

  // ── Remote: search full transcript history ──
  fetch(`/api/search?q=${encodeURIComponent(searchInput.value.trim())}`)
    .then(r => r.json())
    .then(data => {
      if (!data.results) return;
      for (const r of data.results) {
        // skip if already covered by local search
        if (r.file && searchHits.some(h => h.source === "remote" && h.file === r.file && h.time === r.time)) continue;

        const matchMsg = r.context.find(c => c.isMatch);
        const prevMsgs = r.context.filter(c => !c.isMatch).slice(0, 2);
        searchHits.push({
          date: r.time,
          file: r.file,
          msg: { text: matchMsg ? matchMsg.text : "", from: matchMsg && matchMsg.role === "user" ? "you" : "ai" },
          prev: prevMsgs[0] || null,
          next: prevMsgs[1] || null,
          context: r.context,
          matchIdx: (matchMsg?.text || "").toLowerCase().indexOf(q),
          key: null,
          msgIdx: -1,
          source: "remote",
        });
      }
      renderSearchResults();
    })
    .catch(() => {}); // backend unavailable, just use local

  searchOffset = 0;
  renderSearchResults();
}

function renderSearchResults() {
  const slice = searchHits.slice(searchOffset, searchOffset + SEARCH_PAGE);
  if (searchOffset === 0) {
    if (slice.length === 0) {
      searchResults.innerHTML = `<p class="search-empty">没有找到相关记录</p>`;
    } else {
      searchResults.innerHTML = "";
    }
  }

  if (searchOffset > 0 && slice.length === 0) return;

  const q = searchInput.value.trim().toLowerCase();

  for (const hit of slice) {
    const div = document.createElement("div");
    div.className = "search-result";

    const who = hit.msg.from === "you" ? "你" : "克";
    const text = hit.msg.text || "";
    const matchStart = Math.max(0, (hit.matchIdx >= 0 ? hit.matchIdx : text.toLowerCase().indexOf(q)));

    let excerpt = text.slice(Math.max(0, matchStart - 15), matchStart + q.length + 30);
    if (matchStart > 15) excerpt = "…" + excerpt;
    if (matchStart + q.length + 30 < text.length) excerpt = excerpt + "…";

    const hlExcerpt = escHtml(excerpt).replace(
      new RegExp(escHtml(q), "gi"),
      (m) => `<em>${m}</em>`
    );

    let ctx = "";
    if (hit.prev && hit.prev.text) {
      ctx += `<span class="search-result-context">…${escHtml((hit.prev.text || "").slice(-40))}</span>`;
    }
    if (hit.next && hit.next.text) {
      ctx += ` <span class="search-result-context">${escHtml((hit.next.text || "").slice(0, 40))}…</span>`;
    }

    const sourceLabel = hit.source === "remote" ? " • 历史记录" : "";

    div.innerHTML = `
      <div class="search-result-date">${hit.date}${sourceLabel}</div>
      <div class="search-result-text">${hlExcerpt}</div>
      ${ctx ? `<div class="search-result-context">${ctx}</div>` : ""}
      <div class="search-result-who">— ${who}</div>
    `;

    div.addEventListener("click", () => {
      searchOverlay.classList.remove("show");
      // For local hits, scroll to the message in chat
      if (hit.source === "local" && hit.key === (typeof getStorageKey === "function" ? getStorageKey() : STORAGE_KEY)) {
        const msgs = document.querySelectorAll(".msg");
        if (msgs[hit.msgIdx]) {
          msgs[hit.msgIdx].scrollIntoView({ behavior: "smooth", block: "center" });
          msgs[hit.msgIdx].style.outline = "2px solid var(--accent)";
          setTimeout(() => { msgs[hit.msgIdx].style.outline = ""; }, 2000);
        }
      }
    });

    searchResults.appendChild(div);
  }

  searchOffset += slice.length;
  searchMore.classList.toggle("show", searchOffset < searchHits.length);
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let searchDebounce = null;
searchInput.addEventListener("input", () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runSearch, 250);
});

searchMore.addEventListener("click", renderSearchResults);
