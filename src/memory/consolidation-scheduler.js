const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { CalendarRollupStore, getWeekKey, getMonthKey } = require("./calendar-rollup-store");

const ROLLUP_VERSION = 1;
const CONSOLIDATION_HOUR_START = 3;
const CONSOLIDATION_HOUR_END = 4;
const MONTH_TOP_FRAGMENTS = 50;

async function runConsolidationScheduler({ memoryServices, allModelKeys, systemMessageQueue, config }) {
  console.log("[cyberboss] consolidation scheduler ready (dream engine, per-model)");

  // Backfill rollups for each model
  for (const modelKey of allModelKeys) {
    const memoryService = memoryServices.get(modelKey);
    if (!memoryService) continue;
    const rollupStore = new CalendarRollupStore({ memoryDir: memoryService.memoryDir });
    await backfillMissingRollups({ memoryService, rollupStore, modelKey });
  }

  while (true) {
    const delayMs = timeUntilNextConsolidationWindow();
    const wakeAt = new Date(Date.now() + delayMs);
    console.log(`[cyberboss] next consolidation at ${formatLocalTime(wakeAt)}`);
    await sleep(delayMs);

    try {
      await runDailyDream({ memoryServices, allModelKeys, systemMessageQueue, config });
    } catch (err) {
      console.error("[cyberboss] consolidation error:", err.message);
    }
  }
}

// ── daily dream (existing logic + rollup trigger) ──

async function runDailyDream({ memoryServices, allModelKeys, systemMessageQueue, config }) {
  console.log("[cyberboss] consolidation (dream) starting...");

  // 1. Tidy: read shared diary once, each model extracts independently
  const today = formatDate(new Date());
  const diaryFile = path.join(config.diaryDir, `${today}.md`);
  let diaryText = "";
  try { if (fs.existsSync(diaryFile)) diaryText = fs.readFileSync(diaryFile, "utf8"); } catch {}

  for (const modelKey of allModelKeys) {
    const memoryService = memoryServices.get(modelKey);
    if (!memoryService) continue;
    const rollupStore = new CalendarRollupStore({ memoryDir: memoryService.memoryDir });

    // Extract fragments from shared diary
    if (diaryText) {
      await memoryService.extractFromDiary({ date: today, diaryText });
    }

    // Solidify: enqueue system message for hot-fragment rollup
    const hotFragments = memoryService.getHighHeatFragments(50);
    if (hotFragments.length > 0) {
      const accountId = config.accountId || "direct";
      const senderId = process.env.CYBERBOSS_CHECKIN_USER_ID || "direct-user";
      const workspaceRoot = config.workspaceRoot;
      systemMessageQueue.enqueue({
        id: crypto.randomUUID(),
        accountId,
        senderId,
        workspaceRoot,
        model: modelKeyToModelName(modelKey),
        text: buildDreamTrigger(hotFragments, modelKey),
        createdAt: new Date().toISOString(),
      });
    }

    // Daily decay
    const decayed = memoryService.dailyDecay();
    if (decayed > 0) {
      console.log(`[cyberboss] dream growth [${modelKey}]: decayed ${decayed} fragments`);
    }

    // Rollup generation
    await generateDueRollups({ memoryService, rollupStore, modelKey });
  }

  console.log("[cyberboss] consolidation (dream) complete");
}

// ── rollup generation ──

async function generateDueRollups({ memoryService, rollupStore, modelKey = "" }) {
  const now = new Date();
  const weekKey = getWeekKey(now);
  const monthKey = getMonthKey(now);
  const yearKey = String(now.getFullYear());
  const tag = modelKey ? ` [${modelKey}]` : "";

  // Week rollup: generate the PREVIOUS week (today's week is still in progress)
  const prevWeekKey = shiftWeekKey(weekKey, -1);
  if (!rollupStore.read(prevWeekKey)) {
    const fragments = await memoryService.readRecent({ days: 14 }); // cover prev week
    const weekFrags = fragments.filter((f) => getWeekKey(new Date(f.created)) === prevWeekKey);
    if (weekFrags.length > 0) {
      rollupStore.write(buildWeekRollup(prevWeekKey, weekFrags));
      console.log(`[cyberboss] generated week rollup${tag}: ${prevWeekKey} (${weekFrags.length} fragments)`);
    }
  }

  // Month rollup: generate the PREVIOUS month
  const prevMonthKey = shiftMonthKey(monthKey, -1);
  if (!rollupStore.read(prevMonthKey)) {
    const weekRollups = [];
    for (let w = 1; w <= 5; w++) {
      const wk = `${prevMonthKey.slice(0, 4)}-W${String(w).padStart(2, "0")}`;
      const wr = rollupStore.read(wk);
      if (wr) weekRollups.push(wr);
    }
    const topFrags = memoryService.getHighHeatFragments(MONTH_TOP_FRAGMENTS);
    const monthFrags = topFrags.filter((f) => {
      const d = new Date(f.created);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === prevMonthKey;
    });
    if (weekRollups.length > 0 || monthFrags.length > 0) {
      rollupStore.write(buildMonthRollup(prevMonthKey, weekRollups, monthFrags));
      console.log(`[cyberboss] generated month rollup${tag}: ${prevMonthKey}`);
    }
  }

  // Year rollup: generate the PREVIOUS year
  const prevYear = String(Number(yearKey) - 1);
  if (!rollupStore.read(prevYear)) {
    const monthRollups = [];
    for (let m = 1; m <= 12; m++) {
      const mk = `${prevYear}-${String(m).padStart(2, "0")}`;
      const mr = rollupStore.read(mk);
      if (mr) monthRollups.push(mr);
    }
    if (monthRollups.length > 0) {
      rollupStore.write(buildYearRollup(prevYear, monthRollups));
      console.log(`[cyberboss] generated year rollup${tag}: ${prevYear}`);
    }
  }
}

// ── backfill on startup ──

async function backfillMissingRollups({ memoryService, rollupStore, modelKey = "" }) {
  const allFragments = memoryService.getHighHeatFragments(1); // everything
  if (!allFragments.length) return;
  const tag = modelKey ? ` [${modelKey}]` : "";

  // Find the date range of all fragments
  const dates = allFragments.map((f) => f.created.slice(0, 10)).sort();
  const minDate = new Date(dates[0]);
  const maxDate = new Date(dates[dates.length - 1]);

  // Walk backwards from maxDate to minDate, filling missing rollups
  const seen = { week: new Set(), month: new Set(), year: new Set() };

  // Check which rollups already exist
  const existingWeeks = new Set();
  const existingMonths = new Set();
  const existingYears = new Set();
  try {
    const rollupFiles = fs.readdirSync(rollupStore.rollupsDir);
    for (const f of rollupFiles) {
      const key = f.replace(".json", "");
      if (key.includes("-W")) existingWeeks.add(key);
      else if (key.includes("-") && key.length === 7) existingMonths.add(key);
      else if (/^\d{4}$/.test(key)) existingYears.add(key);
    }
  } catch {}

  // Build week list from date range
  const cursor = new Date(minDate);
  while (cursor <= maxDate) {
    const wk = getWeekKey(cursor);
    const mk = getMonthKey(cursor);
    const yk = String(cursor.getFullYear());

    if (!existingWeeks.has(wk) && !seen.week.has(wk)) {
      seen.week.add(wk);
      const wFrags = allFragments.filter((f) => getWeekKey(new Date(f.created)) === wk);
      if (wFrags.length >= 3) {
        rollupStore.write(buildWeekRollup(wk, wFrags));
        console.log(`[cyberboss] backfilled week rollup: ${wk} (${wFrags.length} fragments)`);
      }
    }

    // Month: only gather after we've seen all weeks
    cursor.setDate(cursor.getDate() + 7);
  }

  // Backfill months
  const monthCursor = new Date(minDate);
  while (monthCursor <= maxDate) {
    const mk = getMonthKey(monthCursor);
    if (!existingMonths.has(mk) && !seen.month.has(mk)) {
      seen.month.add(mk);
      const weekRollups = [];
      for (let w = 1; w <= 5; w++) {
        const wk = `${mk.slice(0, 4)}-W${String(w).padStart(2, "0")}`;
        const wr = rollupStore.read(wk);
        if (wr) weekRollups.push(wr);
      }
      const mFrags = allFragments.filter((f) => {
        const d = new Date(f.created);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === mk;
      });
      if (weekRollups.length > 0 || mFrags.length >= 5) {
        rollupStore.write(buildMonthRollup(mk, weekRollups, mFrags));
        console.log(`[cyberboss] backfilled month rollup: ${mk}`);
      }
    }
    monthCursor.setMonth(monthCursor.getMonth() + 1);
  }

  // Backfill years
  for (let y = minDate.getFullYear(); y <= maxDate.getFullYear(); y++) {
    const yk = String(y);
    if (!existingYears.has(yk) && !seen.year.has(yk)) {
      seen.year.add(yk);
      const monthRollups = [];
      for (let m = 1; m <= 12; m++) {
        const mk = `${yk}-${String(m).padStart(2, "0")}`;
        const mr = rollupStore.read(mk);
        if (mr) monthRollups.push(mr);
      }
      if (monthRollups.length > 0) {
        rollupStore.write(buildYearRollup(yk, monthRollups));
        console.log(`[cyberboss] backfilled year rollup: ${yk}`);
      }
    }
  }
}

// ── rollup builders ──

function buildWeekRollup(weekKey, fragments) {
  const sorted = fragments.sort((a, b) => b.heat - a.heat);
  return {
    version: ROLLUP_VERSION,
    period: weekKey,
    level: "week",
    summary: `${fragments.length} memories captured this week.`,
    highlights: sorted.slice(0, 10).map((f) => f.content),
    fragmentCount: fragments.length,
    fragmentIds: fragments.map((f) => f.id),
    generatedAt: new Date().toISOString(),
  };
}

function buildMonthRollup(monthKey, weekRollups, topFragments = []) {
  const allHighlights = [];
  for (const wr of weekRollups) {
    if (wr && wr.highlights) allHighlights.push(...wr.highlights);
  }
  if (topFragments.length) {
    allHighlights.push(...topFragments.sort((a, b) => b.heat - a.heat).slice(0, 15).map((f) => f.content));
  }
  return {
    version: ROLLUP_VERSION,
    period: monthKey,
    level: "month",
    summary: `${allHighlights.length} highlights across ${weekRollups.filter(Boolean).length} weeks.`,
    highlights: [...new Set(allHighlights)].slice(0, 20),
    weekKeys: weekRollups.filter(Boolean).map((wr) => wr.period),
    fragmentCount: topFragments.length + weekRollups.reduce((s, w) => s + (w?.fragmentCount || 0), 0),
    generatedAt: new Date().toISOString(),
  };
}

function buildYearRollup(yearKey, monthRollups) {
  const allHighlights = [];
  let totalFragments = 0;
  for (const mr of monthRollups) {
    if (mr && mr.highlights) allHighlights.push(...mr.highlights);
    if (mr) totalFragments += mr.fragmentCount || 0;
  }
  return {
    version: ROLLUP_VERSION,
    period: String(yearKey),
    level: "year",
    summary: `${totalFragments} memories across ${monthRollups.filter(Boolean).length} months.`,
    highlights: [...new Set(allHighlights)].slice(0, 20),
    monthKeys: monthRollups.filter(Boolean).map((mr) => mr.period),
    fragmentCount: totalFragments,
    generatedAt: new Date().toISOString(),
  };
}

// ── helpers ──

function shiftWeekKey(weekKey, offset) {
  const m = String(weekKey).match(/^(\d{4})-W(\d{2})$/);
  if (!m) return weekKey;
  const year = Number(m[1]);
  const week = Number(m[2]) + offset;
  if (week < 1) return `${year - 1}-W${String(52 + week).padStart(2, "0")}`;
  if (week > 52) return `${year + 1}-W${String(week - 52).padStart(2, "0")}`;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey, offset) {
  const m = String(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function timeUntilNextConsolidationWindow() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(CONSOLIDATION_HOUR_START, Math.floor(Math.random() * 60), 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function buildDreamTrigger(hotFragments, modelKey = "") {
  const modelTag = modelKey ? ` [${modelKey}]` : "";
  const items = hotFragments.slice(0, 20).map((f) => `- [${f.type}] ${f.content}`).join("\n");
  return `Dream consolidation time${modelTag}. Review these high-heat memory fragments and:
1. Call cyberboss_memory_read to review context
2. If you see recurring themes or patterns, write a week diary summary
3. If fragments can be merged, lock the best one and note the merge
4. HOUSEKEEPING — 2-STAGE PROCESS:
   STAGE 1 (this cycle): Identify suspicious fragments and call cyberboss_memory_review(id, reason, action). Do NOT directly delete or unlock.
     - EXACT or near-word-for-word duplicates (same sentence captured twice by bug) → cyberboss_memory_review(action="delete")
     - Thematic recurrence (same topic re-discussed in different words) → DO NOT touch; this is what heat naturally tracks
     - Fragments locked without clear reason (one-off jokes, transient chatter) → cyberboss_memory_review(action="unlock")
     - Obvious noise with zero information value → cyberboss_memory_review(action="delete")
     - If heat already handled it (low heat, naturally decayed), let it fade — no action needed
   STAGE 2 (confirm pending reviews): First, call cyberboss_memory_read(includeDeleted=true) to find fragments with status "review". For each reviewed fragment:
     - If you still believe the action is correct → call cyberboss_memory_review(id, reason, action) again (this executes the action)
     - If you changed your mind → call cyberboss_memory_lock(id) to revert a review-marked-for-unlock, or simply leave it (reviews auto-expire)
     - When in doubt, keep it — only confirm if you're sure
5. Do not fabricate memories — only summarize what's actually there

Hot fragments:
${items}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatLocalTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d).replace(/\//g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelKeyToModelName(modelKey) {
  if (modelKey === "opus") return "claude-opus-4-6";
  if (modelKey === "haiku") return "claude-haiku-4-5";
  return "";
}

module.exports = { runConsolidationScheduler };
