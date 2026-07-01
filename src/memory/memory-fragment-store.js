const fs = require("fs");
const path = require("path");

// 初始热度：identity > reflection > preference > event > fact
// identity 自动 lock，不参与衰减
const HEAT_INITIAL = {
  identity: 95,
  reflection: 80,
  preference: 75,
  event: 60,
  fact: 35,
};

// 各类型每天衰减量（identity 因自动 lock 不衰减）
const DECAY_PER_DAY = {
  identity: 0,
  reflection: 1,
  preference: 1,
  event: 1,
  fact: 3,
};

// 新碎片保护期（小时），期间不可 delete / unlock
const PROTECTION_HOURS = 48;

class MemoryFragmentStore {
  constructor({ memoryDir }) {
    this.memoryDir = memoryDir;
    this.fragmentsDir = path.join(memoryDir, "fragments");
  }

  _datePath(date) {
    return path.join(this.fragmentsDir, `${date}.json`);
  }

  _readDay(date) {
    const filePath = this._datePath(date);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeDay(date, fragments) {
    fs.mkdirSync(this.fragmentsDir, { recursive: true });
    fs.writeFileSync(this._datePath(date), JSON.stringify(fragments, null, 2), "utf8");
  }

  add(fragment) {
    const date = fragment.created ? fragment.created.slice(0, 10) : formatDate(new Date());
    const fragments = this._readDay(date);
    const withDefaults = {
      id: fragment.id || `mem-${date}-${String(fragments.length + 1).padStart(3, "0")}`,
      type: fragment.type || "fact",
      content: String(fragment.content || "").trim(),
      source: fragment.source || { kind: "manual", date, ref: "" },
      heat: typeof fragment.heat === "number" ? fragment.heat : (HEAT_INITIAL[fragment.type] || 35),
      locked: fragment.locked !== undefined ? Boolean(fragment.locked) : (fragment.type === "identity" && (typeof fragment.heat === "number" ? fragment.heat : (HEAT_INITIAL[fragment.type] || 95)) >= 85),
      status: fragment.status || "active",
      tags: Array.isArray(fragment.tags) ? fragment.tags : [],
      created: fragment.created || formatShanghaiISO(new Date()),
      lastRecalled: fragment.lastRecalled || fragment.created || formatShanghaiISO(new Date()),
    };
    if (!withDefaults.content) return null;

    // Dedup: skip if same content AND active already exists on this day
    const dup = fragments.find((f) => f.content === withDefaults.content && f.status !== "deleted");
    if (dup) return dup;

    fragments.push(withDefaults);
    this._writeDay(date, fragments);
    return withDefaults;
  }

  getByDate(date, opts = {}) {
    const fragments = this._readDay(date);
    if (opts.includeDeleted) return fragments;
    return fragments.filter((f) => f.status !== "deleted");
  }

  getRecent(days, opts = {}) {
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      result.push(...this._readDay(formatDate(d)));
    }
    if (opts.includeDeleted) return result;
    return result.filter((f) => f.status !== "deleted");
  }

  getAll(opts = {}) {
    const result = [];
    if (!fs.existsSync(this.fragmentsDir)) return result;
    const files = fs.readdirSync(this.fragmentsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const date = file.replace(".json", "");
      result.push(...this._readDay(date));
    }
    if (opts.includeDeleted) return result;
    return result.filter((f) => f.status !== "deleted");
  }

  // ── find a fragment by id (searches all, including deleted) ──

  _findById(id) {
    if (!fs.existsSync(this.fragmentsDir)) return null;
    const files = fs.readdirSync(this.fragmentsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const date = file.replace(".json", "");
      const fragments = this._readDay(date);
      const found = fragments.find((f) => f.id === id);
      if (found) return { fragment: found, date };
    }
    return null;
  }

  _saveFragment(fragment) {
    const date = fragment.created.slice(0, 10);
    const fragments = this._readDay(date);
    const idx = fragments.findIndex((f) => f.id === fragment.id);
    if (idx >= 0) fragments[idx] = fragment;
    this._writeDay(date, fragments);
    return fragment;
  }

  _isProtected(fragment) {
    if (fragment.status && fragment.status !== "active") return false;
    const created = new Date(fragment.created);
    const ageMs = Date.now() - created.getTime();
    return ageMs < PROTECTION_HOURS * 3600 * 1000;
  }

  touch(id) {
    const found = this._findById(id);
    if (!found || found.fragment.status === "deleted") return null;
    found.fragment.heat = Math.min(100, found.fragment.heat + 5);
    found.fragment.lastRecalled = formatShanghaiISO(new Date());
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  lock(id) {
    const found = this._findById(id);
    if (!found || found.fragment.status === "deleted") return null;
    found.fragment.locked = true;
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  unlock(id) {
    const found = this._findById(id);
    if (!found || found.fragment.status === "deleted") return null;
    if (this._isProtected(found.fragment)) {
      return {
        error: "protected",
        message: `Fragment ${id} is less than ${PROTECTION_HOURS}h old — unlock blocked by protection period. Mark it for review first.`,
      };
    }
    found.fragment.locked = false;
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  updateTags(id, tags = []) {
    const found = this._findById(id);
    if (!found || found.fragment.status === "deleted") return null;
    found.fragment.tags = Array.isArray(tags) ? [...new Set(tags)] : [];
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  boostHeat(id, amount = 3) {
    const found = this._findById(id);
    if (!found || found.fragment.status === "deleted") return null;
    found.fragment.heat = Math.min(100, found.fragment.heat + amount);
    found.fragment.lastRecalled = formatShanghaiISO(new Date());
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  delete(id, deletedBy = "") {
    const found = this._findById(id);
    if (!found) return null;
    if (found.fragment.status === "deleted") {
      return { error: "already_deleted", message: `Fragment ${id} is already deleted.` };
    }
    // 48h protection: active fragments can't be deleted directly
    if (this._isProtected(found.fragment)) {
      return {
        error: "protected",
        message: `Fragment ${id} is less than ${PROTECTION_HOURS}h old — delete blocked by protection period. Mark it for review first with cyberboss_memory_review.`,
      };
    }
    found.fragment.status = "deleted";
    found.fragment.deletedAt = new Date().toISOString();
    if (deletedBy) found.fragment.deletedBy = deletedBy;
    this._saveFragment(found.fragment);
    return { deleted: found.fragment, remaining: -1 };
  }

  setStatus(id, status, extra = {}) {
    const found = this._findById(id);
    if (!found) return null;
    found.fragment.status = status;
    if (extra.reviewReason) found.fragment.reviewReason = extra.reviewReason;
    if (extra.intendedAction) found.fragment.intendedAction = extra.intendedAction;
    if (status === "review") {
      found.fragment.reviewedAt = new Date().toISOString();
    }
    this._saveFragment(found.fragment);
    return found.fragment;
  }

  dailyDecay() {
    const today = formatDate(new Date());
    const files = fs.existsSync(this.fragmentsDir) ? fs.readdirSync(this.fragmentsDir) : [];
    let decayed = 0;
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const date = file.replace(".json", "");
      if (date === today) continue; // don't decay today's fragments
      const fragments = this._readDay(date);
      let changed = false;
      for (const f of fragments) {
        if (f.locked || f.status === "deleted") continue;
        const decay = DECAY_PER_DAY[f.type] || 1;
        if (f.heat > 10) {
          f.heat = Math.max(10, f.heat - decay);
          decayed++;
          changed = true;
        }
      }
      if (changed) this._writeDay(date, fragments);
    }
    return decayed;
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatShanghaiISO(date) {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(date)).replace(" ", "T") + "+08:00";
}

module.exports = { MemoryFragmentStore };
