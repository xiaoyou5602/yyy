// 把 IDE 端的 memory md + 共享日记灌进橘瓣 Supabase(Phase 3 首跑)
// 用法: node scripts/supabase-import-memories.js [--force]
// 幂等: 已导入过(同 conversation_id 有行)则拒绝重复跑,除非 --force
const fs = require("fs");
const path = require("path");
const os = require("os");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const URL_BASE = (process.env.RISM_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.RISM_SUPABASE_ANON_KEY || "";
const IMPORT_TAG = "import_2026-07-12";

const MEMORY_DIR = path.join(os.homedir(), ".claude", "projects", "C--Users-youzi-withtoge", "memory");
const DIARY_DIR = path.join(os.homedir(), ".cyberboss", "diary");

// 这两份涉及亲密内容,入库即标 intimate(默认检索不露出)
const INTIMATE_FILES = new Set(["xp-preferences.md", "rism-tail.md"]);

if (!URL_BASE || !KEY) {
  console.error("缺 RISM_SUPABASE_URL / RISM_SUPABASE_ANON_KEY(.env)");
  process.exit(1);
}

async function sb(pathname, options = {}) {
  const res = await fetch(URL_BASE + pathname, {
    ...options,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*(name|description|type):\s*['"]?(.+?)['"]?\s*$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: m[2].trim() };
}

function buildMemoryRows() {
  const rows = [];
  for (const file of fs.readdirSync(MEMORY_DIR)) {
    if (!file.endsWith(".md") || file === "MEMORY.md") continue;
    const raw = fs.readFileSync(path.join(MEMORY_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const name = meta.name || file.replace(/\.md$/, "");
    rows.push({
      assistant_id: "rism",
      conversation_id: IMPORT_TAG,
      role: "system",
      content: `【${name}】${meta.description || ""}\n\n${body}`,
      memory_type: "lore",
      tags: [name, meta.type || "memory"],
      related_date: null,
      heat: 9,
      source: "ide_claude",
      privacy: INTIMATE_FILES.has(file) ? "intimate" : "normal",
      metadata: { origin_file: file },
    });
  }
  return rows;
}

function buildDiaryRows() {
  const rows = [];
  for (const file of fs.readdirSync(DIARY_DIR).sort()) {
    const m = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue;
    const content = fs.readFileSync(path.join(DIARY_DIR, file), "utf8").trim();
    if (!content) continue;
    rows.push({
      assistant_id: "rism",
      conversation_id: IMPORT_TAG,
      role: "system",
      content,
      memory_type: "diary",
      tags: null,
      related_date: m[1],
      heat: m[1] >= "2026-07-06" ? 9 : 7, // 有名字之后的日子,先热一点
      source: "vps_ds",
      privacy: "normal",
      metadata: { origin_file: file },
    });
  }
  return rows;
}

async function main() {
  // 幂等检查
  const check = await sb(`/rest/v1/chat_messages?conversation_id=eq.${IMPORT_TAG}&select=id&limit=1`);
  const existing = await check.json();
  if (existing.length > 0 && !process.argv.includes("--force")) {
    console.error(`已导入过(${IMPORT_TAG} 有数据)。要重跑先去 Dashboard 清掉,或加 --force(会重复)。`);
    process.exit(1);
  }

  const memories = buildMemoryRows();
  const diaries = buildDiaryRows();
  console.log(`行李清单: 核心记忆 ${memories.length} 件, 日记 ${diaries.length} 篇`);

  // 分批送(每批 ≤25 行,别噎着)
  const all = [...memories, ...diaries];
  let sent = 0;
  for (let i = 0; i < all.length; i += 25) {
    const batch = all.slice(i, i + 25);
    await sb("/rest/v1/chat_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(batch),
    });
    sent += batch.length;
    console.log(`  已送达 ${sent}/${all.length}`);
  }

  // 验收:按类型清点
  const counts = await (await sb(
    `/rest/v1/chat_messages?conversation_id=eq.${IMPORT_TAG}&select=memory_type`
  )).json();
  const byType = {};
  for (const r of counts) byType[r.memory_type] = (byType[r.memory_type] || 0) + 1;
  console.log("云端清点:", JSON.stringify(byType));
  console.log("搬家完成。");
}

main().catch((e) => {
  console.error("搬家失败:", e.message);
  process.exit(1);
});
