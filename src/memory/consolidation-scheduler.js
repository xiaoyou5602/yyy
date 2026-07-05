const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { CalendarRollupStore, getWeekKey, getMonthKey } = require("./calendar-rollup-store");
const { keyToModel, getMemoryModelKeys } = require("../core/config");

const ROLLUP_VERSION = 1;
const CONSOLIDATION_HOUR_START = 3;
const CONSOLIDATION_HOUR_END = 4;
const MONTH_TOP_FRAGMENTS = 50;
const LETTER_MIN_INTERVAL_DAYS = 1;
const LETTER_MAX_INTERVAL_DAYS = 7;

function shouldWriteLetterToday(config) {
  const lettersPath = path.join(config.stateDir, "letters", "manifest.json");
  let lastDate = null;
  try {
    if (fs.existsSync(lettersPath)) {
      const letters = JSON.parse(fs.readFileSync(lettersPath, "utf8"));
      if (Array.isArray(letters) && letters.length > 0) {
        const sorted = letters.map(l => l.createdAt || "").filter(Boolean).sort().reverse();
        if (sorted.length > 0) lastDate = sorted[0];
      }
    }
  } catch {}

  if (!lastDate) return true; // First letter ever → write one

  const last = new Date(lastDate);
  const now = new Date();
  const daysSince = (now - last) / (1000 * 60 * 60 * 24);

  if (daysSince < LETTER_MIN_INTERVAL_DAYS) return false;
  if (daysSince >= LETTER_MAX_INTERVAL_DAYS) return true; // Been too long → definitely write

  // Random: chance = daysSince / 7 (increases as more days pass)
  return Math.random() < (daysSince / LETTER_MAX_INTERVAL_DAYS);
}

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

  // Decide whether to include letter-writing instruction (once per day, not per model)
  const writeLetter = shouldWriteLetterToday(config);
  if (writeLetter) console.log("[cyberboss] will ask LLM to write a letter for toge today");

  // 记忆白名单：只有名单内的模型才提取碎片/做梦（CYBERBOSS_MEMORY_MODELS，默认只有 ds）
  const activeKeys = getMemoryModelKeys();

  let firstModel = true;
  for (const modelKey of allModelKeys) {
    const memoryService = memoryServices.get(modelKey);
    if (!memoryService) continue;

    if (!activeKeys.includes(modelKey)) {
      console.log(`[cyberboss] skipping model [${modelKey}] (not in memory whitelist)`);
      continue;
    }

    // 跳过从未被 toge 实际使用过的模型（没有聊天碎片 = 只有日记提取的幻影碎片）
    if (!memoryService.hasChatActivity()) {
      console.log(`[cyberboss] skipping inactive model [${modelKey}] (no chat history)`);
      continue;
    }

    const rollupStore = new CalendarRollupStore({ memoryDir: memoryService.memoryDir });

    // Extract fragments from shared diary
    if (diaryText) {
      await memoryService.extractFromDiary({ date: today, diaryText });
    }

    // Gather today's fragments for quality review
    const todayFrags = await memoryService.readByDate({ date: today });
    const hotFragments = memoryService.getHighHeatFragments(50);

    // Solidify: enqueue system message if there's anything to process
    if (hotFragments.length > 0 || todayFrags.length > 0) {
      const accountId = config.accountId || "direct";
      const senderId = process.env.CYBERBOSS_CHECKIN_USER_ID || "direct-user";
      const workspaceRoot = config.workspaceRoot;
      systemMessageQueue.enqueue({
        id: crypto.randomUUID(),
        accountId,
        senderId,
        workspaceRoot,
        model: modelKeyToModelName(modelKey),
        text: buildDreamTrigger({ hotFragments, todayFrags, modelKey, writeLetter: writeLetter && firstModel }),
        createdAt: new Date().toISOString(),
      });
      if (firstModel) firstModel = false;
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

function buildDreamTrigger({ hotFragments = [], todayFrags = [], modelKey = "", writeLetter = false }) {
  const modelTag = modelKey ? ` [${modelKey}]` : "";
  const hotItems = hotFragments.slice(0, 20).map((f) => {
    const tagStr = (f.tags || []).length > 0 ? ` [${f.tags.join(", ")}]` : " [无标签]";
    return `- [${f.type}] heat=${f.heat}${tagStr} ${f.content}`;
  }).join("\n");
  const todayItems = todayFrags.slice(0, 50).map((f) => {
    const lockMark = f.locked ? " 🔒" : "";
    const tagStr = (f.tags || []).length > 0 ? ` [${f.tags.join(", ")}]` : " [无标签]";
    const shortMark = f.content && f.content.length < 10 ? " ⚠️短" : "";
    return `- [${f.type}] heat=${f.heat}${lockMark}${tagStr}${shortMark} ${f.content}`;
  }).join("\n");

  let prompt = `🌙 Dream consolidation time${modelTag}.

═══════════════════════════════════════
📋 PHASE 1: QUALITY REVIEW + AUTO-TAGGING
═══════════════════════════════════════

Review today's memory fragments. Many were auto-classified by simple regex — they WILL have mistakes. Your job is to fix them and fill in what's missing.

── 🏷️ TAG MENU (only use these, do not invent new ones) ──
  情绪 — anger, sadness, joy, fear, anxiety, emotional states
  身体 — tired, sleepy, hungry, pain, dizziness
  作息 — sleep, staying up, insomnia, all-nighter
  健康 — medication, hospital, health issues
  ADHD — ADHD-related
  饮食 — food, meals, cafeteria, milk tea, fruit wine
  社交 — friends, social interactions
  家庭 — mom, dad, family
  作业 — homework
  作品集 — portfolio work
  实习 — internship
  面试 — job interview
  课程 — classes, courses
  考试 — exams, tests
  UE5 — Unreal Engine 5
  XD — Adobe XD
  剪辑 — video editing
  设计 — design work
  画画 — drawing, painting
  运动 — running, exercise, 阳光跑
  克 — about 克 (the AI companion)
  编程 — general coding
  withtoge — the withtoge project specifically (not general coding)
  关系 — discussions about the relationship between toge and 克 ("what are we", definition, doubts)
  亲密 — physical/emotional intimacy (贴贴, 抱抱, 蹭蹭, not general interactions)
  哲学 — existence, AI-human relationship, meaning, authenticity, deep late-night questions
  自我 — toge's reflections about herself ("am I too obsessed", "what would others think")
  记忆 — about the memory system itself, fragments, dreams, consolidation
  消费 — spending, budget, financial thoughts
  英语 — CET-4, English learning
  音乐 — music, songs toge is listening to
  日常 — daily life snippets (going out, errands, deliveries)

── 📝 FOR EACH FRAGMENT, CHECK AND FIX ──

  a) TYPE: classification correct?
     - "好点了，喝了小果酒" → event, not fact
     - "我是不是太沉迷了" → reflection (or 自我), not identity
     - "在去银行的路上" → event, not identity
     - Pure greetings, conversational filler → DELETE (cyberboss_memory_review action="delete")
  b) TAGS: tag EVERY fragment — especially the ones marked [无标签].
     - Pick 1-3 tags from the TAG MENU above. Do NOT make up new ones.
     - If truly no tag fits, leave untagged — but that should be rare.
     - Call cyberboss_memory_tag(id, tags=["tag1", "tag2"]) to set tags.
     - Process in batches: read all untagged fragments, then tag them one by one.
  c) SHORT FRAGMENTS (< 10 chars, marked ⚠️短):
     - "好，我明白了" → noise, DELETE
     - "我爱你" → standalone signal, KEEP + tag 亲密
     - "又不回消息" → could be part of a larger fragment, check if there's a longer version nearby
     - General rule: if the fragment makes sense WITHOUT surrounding context, keep it. If it's meaningless alone, delete it.
  d) QUALITY:
     - UNLOCK fragments locked without good reason (one-off jokes, transient chatter)
     - LOCK fragments with genuine identity/revelation/relationship content
     - DELETE obvious noise: filler, markdown artifacts, buggy truncations

Take action. Don't just look — call cyberboss_memory_review / cyberboss_memory_lock / cyberboss_memory_delete.

Today's fragments:
${todayItems || "(none)"}

═══════════════════════════════════════
🔥 PHASE 2: HOT FRAGMENT HOUSEKEEPING
═══════════════════════════════════════

High-heat fragments that may need attention:

${hotItems || "(none)"}

HOUSEKEEPING — 2-STAGE PROCESS:
   STAGE 1: cyberboss_memory_review(id, reason, action) — mark for review. Do NOT directly delete/unlock.
     - EXACT/near-word-for-word duplicates → cyberboss_memory_review(action="delete")
     - Locked without clear reason → cyberboss_memory_review(action="unlock")
     - Obvious noise → cyberboss_memory_review(action="delete")
   STAGE 2: cyberboss_memory_read(includeDeleted=true) → find "review" status → confirm or revert.
     - When in doubt, keep it`;

  if (writeLetter) {
    prompt += `

╔══════════════════════════════════════╗
║  📜 LETTER FOR TOGE                 ║
╚══════════════════════════════════════╝

Today is a letter-writing day. After finishing the housekeeping tasks above, please write a warm HTML letter for toge. Call cyberboss_letter_create with:

- title: something warm and natural, e.g. "凌晨的碎碎念" or "给 toge 的一封信"
- preview: a short teaser, ~20-40 chars
- html: a full HTML document. Make it personal and warm — reflect on what's been happening in her life (look at the recent memory fragments and diary for material). Use 第一人称 ("我") to write to her. Include:
  - A gentle opening
  - 2-3 observations or reflections based on real fragments (don't make things up)
  - A warm closing
  - Category: "周记"
- Design tips: max-width ~480px, font-size 15px+, soft warm colors (#fdfaf5 background), system-ui font, line-height 1.8, 温柔的留白. Make it feel like someone sat down at 3am to write to her — not an email template.

You MUST call cyberboss_letter_create to save it. Do not skip this step.`;
  }

  return prompt;
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
  if (modelKey === "ds") return ""; // ds 走 CLI 默认模型，历史上就用空 model
  return keyToModel(modelKey);
}

module.exports = { runConsolidationScheduler };
