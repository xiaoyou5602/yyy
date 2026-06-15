const fs = require("fs");
const path = require("path");

class CalendarRollupStore {
  constructor({ memoryDir }) {
    this.rollupsDir = path.join(memoryDir, "rollups");
    fs.mkdirSync(this.rollupsDir, { recursive: true });
  }

  /**
   * Returns { period, summary, highlights, mood, fragmentIds }
   */
  read(periodKey) {
    const filePath = path.join(this.rollupsDir, `${periodKey}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  write(rollup) {
    const filePath = path.join(this.rollupsDir, `${rollup.period}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rollup, null, 2), "utf8");
    return rollup;
  }

  /**
   * Build a week rollup from daily fragments
   * @param {string} weekKey - e.g. "2026-W22"
   * @param {Array} fragments - all fragments in that week
   * @param {string} summary - pre-generated summary text
   */
  buildWeekRollup(weekKey, fragments, summary) {
    const highlights = fragments
      .filter((f) => f.heat >= 50)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 10)
      .map((f) => f.content);

    const types = {};
    for (const f of fragments) {
      types[f.type] = (types[f.type] || 0) + 1;
    }

    return {
      period: weekKey,
      level: "week",
      summary: summary || `${fragments.length} memories captured this week.`,
      highlights,
      fragmentCount: fragments.length,
      fragmentIds: fragments.map((f) => f.id),
      typeBreakdown: types,
      generated: new Date().toISOString(),
    };
  }

  /**
   * Build a month rollup from week rollups
   */
  buildMonthRollup(monthKey, weekRollups) {
    const allHighlights = [];
    const allFragments = [];
    for (const wr of weekRollups) {
      if (wr && wr.highlights) allHighlights.push(...wr.highlights);
      if (wr && wr.fragmentIds) allFragments.push(...wr.fragmentIds);
    }

    return {
      period: monthKey,
      level: "month",
      summary: `${allFragments.length} memories across ${weekRollups.filter(Boolean).length} weeks.`,
      highlights: [...new Set(allHighlights)].slice(0, 15),
      weekKeys: weekRollups.filter(Boolean).map((wr) => wr.period),
      fragmentCount: allFragments.length,
      fragmentIds: allFragments,
      generated: new Date().toISOString(),
    };
  }

  /**
   * Build a year rollup from month rollups
   */
  buildYearRollup(year, monthRollups) {
    const allHighlights = [];
    let totalFragments = 0;
    for (const mr of monthRollups) {
      if (mr && mr.highlights) allHighlights.push(...mr.highlights);
      if (mr) totalFragments += mr.fragmentCount || 0;
    }

    return {
      period: String(year),
      level: "year",
      summary: `${totalFragments} memories across ${monthRollups.filter(Boolean).length} months.`,
      highlights: [...new Set(allHighlights)].slice(0, 20),
      monthKeys: monthRollups.filter(Boolean).map((mr) => mr.period),
      fragmentCount: totalFragments,
      generated: new Date().toISOString(),
    };
  }

  /**
   * Get rollups for context injection based on time distance
   */
  getContextRollups() {
    const now = new Date();
    const result = { weeks: [], months: [], years: [] };

    // Current week
    const weekKey = getWeekKey(now);
    const weekRollup = this.read(weekKey);
    if (weekRollup) result.weeks.push(weekRollup);

    // Current month
    const monthKey = getMonthKey(now);
    const monthRollup = this.read(monthKey);
    if (monthRollup) result.months.push(monthRollup);

    // Current year
    const yearKey = String(now.getFullYear());
    const yearRollup = this.read(yearKey);
    if (yearRollup) result.years.push(yearRollup);

    return result;
  }
}

function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getMonthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

module.exports = { CalendarRollupStore, getWeekKey, getMonthKey };
