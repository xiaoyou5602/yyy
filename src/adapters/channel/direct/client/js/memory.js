/* ── Memory / Diary Page ── */
const memoryContent = document.getElementById("memory-content");
const memoryTabs = document.getElementById("memory-tabs");
let memoryTab = "diary";
let _memoryModelFilter = "";
let _rollupModelFilter = "";

const MODEL_TAGS = [
  { key: "", label: "全部" },
  { key: "ds", label: "DeepSeek" },
  { key: "opus", label: "Opus 4.6" },
  { key: "haiku", label: "Haiku 4.5" },
];

memoryTabs.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  memoryTabs.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  memoryTab = btn.dataset.tab;
  loadMemoryTab(memoryTab);
});

async function loadMemoryTab(tab) {
  memoryContent.innerHTML = `<div class="empty-state">加载中…</div>`;
  try {
    switch (tab) {
      case "diary": await loadDiary(); break;
      case "memory": await loadMemory(); break;
      case "rollups": await loadRollups(); break;
    }
  } catch (err) {
    memoryContent.innerHTML = `<div class="empty-state">加载失败</div>`;
  }
}

async function loadDiary() {
  const res = await fetch("/api/diary?days=60");
  const entries = await res.json();
  if (!entries.length) {
    memoryContent.innerHTML = `<div class="empty-state">还没有日记</div>`;
    return;
  }

  // Build set of dates that have entries
  const datesWithEntries = new Set(entries.map(e => e.date));

  // Week strip with navigation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOffset = window._diaryWeekOffset || 0;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7);

  const weekdays = ["日","一","二","三","四","五","六"];

  function buildWeekStrip() {
    let html = `<div class="diary-week-strip" id="diary-week-strip">`;
    html += `<button class="week-nav-btn" onclick="shiftDiaryWeek(-1)" title="上一周">&lsaquo;</button>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayNum = d.getDate();
      const wd = weekdays[d.getDay()];
      const isToday = dateStr === today.toISOString().slice(0, 10);
      const hasEntries = datesWithEntries.has(dateStr);
      const isFuture = d > today;
      const isActive = dateStr === (window._diaryActiveDate || today.toISOString().slice(0, 10));
      html += `<div class="week-day-col${isToday ? ' today' : ''}${isActive ? ' active' : ''}${hasEntries ? ' has-entries' : ''}${isFuture ? ' future' : ''}" data-date="${dateStr}" onclick="selectDiaryDate('${dateStr}')">
        <span class="wd-label">${wd}</span>
        <span class="wd-circle">${dayNum}</span>
      </div>`;
    }
    html += `<button class="week-nav-btn" onclick="shiftDiaryWeek(1)" title="下一周">&rsaquo;</button>`;
    html += `</div>`;
    return html;
  }

  let html = buildWeekStrip() + `<div class="diary-list">`;
  let lastMonth = "";
  let lastDate = "";
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7);
    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      const [y, m] = monthKey.split("-");
      html += `<div class="diary-month-head">${y}年${parseInt(m)}月</div>`;
      lastDate = "";
    }
    if (entry.date !== lastDate) {
      lastDate = entry.date;
      html += `<div class="day-head" id="diary-date-${entry.date}">${entry.date}</div>`;
    }
    const titleHtml = entry.title ? ` <span class="diary-title">${esc(entry.title)}</span>` : "";
    html += `<div class="diary-entry">
      <div class="diary-entry-inner">
        <div class="diary-time">${entry.time || ""}${titleHtml}</div>
        <div class="diary-body">${esc(entry.body)}</div>
      </div>
    </div>`;
  }
  html += `</div>`;
  memoryContent.innerHTML = html;
}

function selectDiaryDate(dateStr) {
  window._diaryActiveDate = dateStr;
  // Update week strip active state
  const strip = document.getElementById("diary-week-strip");
  if (strip) {
    strip.querySelectorAll(".week-day-col").forEach(col => {
      col.classList.toggle("active", col.dataset.date === dateStr);
    });
  }
  // Scroll: prefer exact date heading, fall back to nearest
  let el = document.getElementById("diary-date-" + dateStr);
  if (!el) {
    // Find the first day-head >= target date (heads are in desc order)
    const heads = document.querySelectorAll("[id^='diary-date-']");
    for (const h of heads) {
      if (h.id.replace("diary-date-", "") >= dateStr) { el = h; }
    }
    if (!el && heads.length) el = heads[heads.length - 1];
  }
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function shiftDiaryWeek(delta) {
  window._diaryWeekOffset = (window._diaryWeekOffset || 0) + delta;
  window._diaryActiveDate = null;
  loadDiary();
}

async function loadMemory() {
  const modelParam = _memoryModelFilter ? `&model=${encodeURIComponent(_memoryModelFilter)}` : "";
  const res = await fetch(`/api/memory?days=30${modelParam}`);
  const data = await res.json();
  const fragments = Array.isArray(data) ? data : (data.fragments || []);
  const counts = Array.isArray(data) ? null : (data.counts || null);
  if (!fragments.length) {
    memoryContent.innerHTML = `<div class="empty-state">还没有记忆碎片<br>聊天或写日记后会自动生成</div>`;
    return;
  }
  const typeLabel = { fact: "事实", event: "事件", reflection: "感悟", preference: "偏好" };
  let html = buildModelChips("memory", counts) +
    `<div class="mem-filter">
    <input type="text" id="mem-search" placeholder="搜索记忆…">
    <span class="tag-clear" id="mem-tag-clear">清除</span>
  </div>
  <div class="tag-chips-row">
    <div class="type-chips" id="mem-type-chips">
      <span class="type-chip active" data-type="">全部</span>
      <span class="type-chip fact-chip" data-type="fact">事实</span>
      <span class="type-chip event-chip" data-type="event">事件</span>
      <span class="type-chip reflection-chip" data-type="reflection">感悟</span>
      <span class="type-chip preference-chip" data-type="preference">偏好</span>
    </div>
    <span class="mem-count" id="mem-count">${fragments.length} 条记忆</span>
  </div>
  <div class="tag-chips" id="mem-tag-chips" style="margin-top:10px;margin-bottom:18px;"></div>
  <div class="mem-grid" id="mem-grid">`;

  for (const f of fragments) {
    const lockIcon = f.locked ? " &#128274;" : "";
    const type = f.type || "fact";
    const tagsHtml = (f.tags || []).map(t => `<span class="mem-card-tag">${esc(t)}</span>`).join("");
    const sourceKind = (f.source && f.source.kind) === "diary" ? "日记" : (f.source && f.source.kind) === "chat" ? "对话" : "";
    const modelBadge = !_memoryModelFilter && f.modelName ? `<span class="mem-model-badge">${esc(f.modelName)}</span>` : "";

    html += `<div class="mem-card type-${type}" data-id="${escAttr(f.id || "")}" data-type="${type}" data-tags="${escAttr((f.tags || []).join(","))}" data-text="${escAttr(f.content)}">
      <div class="mem-card-inner">
        <div class="mem-card-header">
          <span class="mem-card-date">${f.date || ""}</span>
          <span class="mem-card-heat" title="热度 ${f.heat}"><span class="mem-card-heat-icon">&#128293;</span> ${f.heat || 0}${lockIcon}</span>
        </div>
        <div class="mem-card-body">${esc(f.content)}</div>
        <div class="mem-card-tags">${tagsHtml}</div>
        <div class="mem-card-footer">
          <span class="mem-card-type-badge ${type}">${typeLabel[type] || type}</span>
          ${sourceKind ? `<span class="mem-card-src">${sourceKind}</span>` : ""}
          ${modelBadge}
        </div>
      </div>
    </div>`;
  }
  html += `</div>`;
  memoryContent.innerHTML = html;

  setupMemoryFilter(fragments);
}

async function loadRollups() {
  const modelParam = _rollupModelFilter ? `?model=${encodeURIComponent(_rollupModelFilter)}` : "";
  const res = await fetch(`/api/memory/rollups${modelParam}`);
  const rollups = await res.json();
  if (!rollups.weeks.length && !rollups.months.length) {
    memoryContent.innerHTML = `<div class="empty-state">还没有周报<br>系统会在每周一自动生成</div>`;
    return;
  }
  let html = buildModelChips("rollups") + `<div class="rollup-list">`;
  if (rollups.weeks.length) {
    html += `<div class="day-head">周报</div>`;
    for (const r of rollups.weeks) {
      const modelBadge = !_rollupModelFilter && r.modelName ? ` <span class="mem-model-badge">${esc(r.modelName)}</span>` : "";
      html += `<div class="rollup-card">
        <div class="rollup-card-inner">
          <div class="rollup-period">${esc(r.period)}${modelBadge}</div>
          <div class="rollup-summary">${esc(r.summary || "")}</div>`;
      if (r.highlights && r.highlights.length) {
        html += `<div class="rollup-hl">${r.highlights.map((h) => `<span>${esc(h)}</span>`).join("")}</div>`;
      }
      html += `</div></div>`;
    }
  }
  if (rollups.months.length) {
    html += `<div class="day-head">月报</div>`;
    for (const r of rollups.months) {
      const modelBadge = !_rollupModelFilter && r.modelName ? ` <span class="mem-model-badge">${esc(r.modelName)}</span>` : "";
      html += `<div class="rollup-card">
        <div class="rollup-card-inner">
          <div class="rollup-period">${esc(r.period)}${modelBadge}</div>
          <div class="rollup-summary">${esc(r.summary || "")}</div>
        </div>
      </div>`;
    }
  }
  html += `</div>`;
  memoryContent.innerHTML = html;
}

function buildModelChips(tab, counts) {
  const activeKey = tab === "memory" ? _memoryModelFilter : _rollupModelFilter;
  const chips = MODEL_TAGS.map(t => {
    let label = esc(t.label);
    if (t.key && counts && counts[t.key] !== undefined) {
      label = `${label} (${counts[t.key]})`;
    } else if (!t.key && counts) {
      // "全部" chip: sum all model counts
      const total = Object.values(counts).reduce((s, c) => s + c, 0);
      if (total > 0) label = `${label} (${total})`;
    }
    return `<span class="model-chip${(t.key === activeKey) ? " active" : ""}" data-model="${escAttr(t.key)}" data-tab="${tab}">${label}</span>`;
  }).join("");
  return `<div class="model-chips" id="model-chips-${tab}">${chips}</div>`;
}

// Delegate model chip clicks
document.getElementById("memory-content").addEventListener("click", (e) => {
  const chip = e.target.closest(".model-chip");
  if (!chip) return;
  const model = chip.dataset.model || "";
  const tab = chip.dataset.tab;
  if (tab === "memory") {
    _memoryModelFilter = model;
    loadMemory();
  } else if (tab === "rollups") {
    _rollupModelFilter = model;
    loadRollups();
  }
});

function setupMemoryFilter(fragments) {
  const searchInput = document.getElementById("mem-search");
  const typeChips = document.getElementById("mem-type-chips");
  const tagChips = document.getElementById("mem-tag-chips");
  const tagClear = document.getElementById("mem-tag-clear");
  const memCount = document.getElementById("mem-count");
  if (!searchInput || !tagChips) return;

  let activeType = "";
  let activeTag = null;

  const tagCounts = {};
  for (const f of fragments) {
    for (const t of (f.tags || [])) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  tagChips.innerHTML = tags.map(([tag, count]) =>
    `<span class="tag-chip" data-tag="${escAttr(tag)}">${esc(tag)} (${count})</span>`
  ).join("");

  function applyFilter() {
    const query = (searchInput.value || "").toLowerCase();
    const cards = memoryContent.querySelectorAll(".mem-card");
    let visible = 0;
    for (const card of cards) {
      const text = (card.dataset.text || "").toLowerCase();
      const cardTags = (card.dataset.tags || "").toLowerCase();
      const cardType = card.dataset.type || "";
      const typeMatch = !activeType || cardType === activeType;
      const tagMatch = !activeTag || cardTags.split(",").includes(activeTag);
      const textMatch = !query || text.includes(query) || cardTags.includes(query);
      const show = typeMatch && tagMatch && textMatch;
      card.style.display = show ? "" : "none";
      if (show) visible++;
    }
    if (memCount) memCount.textContent = visible + " / " + fragments.length + " 条记忆";
    tagClear.classList.toggle("show", !!(activeTag || activeType));
  }

  searchInput.addEventListener("input", applyFilter);

  typeChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".type-chip");
    if (!chip) return;
    activeType = chip.dataset.type || "";
    typeChips.querySelectorAll(".type-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    applyFilter();
  });

  tagChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".tag-chip");
    if (!chip) return;
    const tag = chip.dataset.tag;
    if (activeTag === tag) {
      activeTag = null;
      tagChips.querySelectorAll(".tag-chip").forEach(c => c.classList.remove("active"));
    } else {
      activeTag = tag;
      tagChips.querySelectorAll(".tag-chip").forEach(c => c.classList.toggle("active", c.dataset.tag === tag));
    }
    applyFilter();
  });

  tagClear.addEventListener("click", () => {
    activeTag = null;
    activeType = "";
    tagChips.querySelectorAll(".tag-chip").forEach(c => c.classList.remove("active"));
    typeChips.querySelectorAll(".type-chip").forEach(c => c.classList.remove("active"));
    const allChip = typeChips.querySelector('[data-type=""]');
    if (allChip) allChip.classList.add("active");
    applyFilter();
  });
}
