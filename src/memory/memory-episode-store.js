const fs = require("fs");
const path = require("path");

// ── Phase 4: Episode Candidate 话题分组 ──

class MemoryEpisodeStore {
  constructor({ memoryDir }) {
    this.memoryDir = memoryDir;
    this.episodesDir = path.join(memoryDir, "episodes");
    this.candidatesDir = path.join(this.episodesDir, "candidates");
    this.confirmedDir = path.join(this.episodesDir, "confirmed");
  }

  _datePath(dir, date) {
    return path.join(dir, `${date}.json`);
  }

  _readDay(dir, date) {
    const filePath = this._datePath(dir, date);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeDay(dir, date, episodes) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._datePath(dir, date), JSON.stringify(episodes, null, 2), "utf8");
  }

  // ── 聚类检测 ──

  detectCandidates(recentFragments, { minClusterSize = 3, maxTimeGapHours = 4 } = {}) {
    if (!recentFragments || recentFragments.length < minClusterSize) return [];

    // 按创建时间排序
    const sorted = [...recentFragments].sort(
      (a, b) => new Date(a.created) - new Date(b.created)
    );

    // 聚类：时间连续 + 标签/subtype 有交集
    const clusters = [];
    let current = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const timeGap =
        (new Date(curr.created) - new Date(prev.created)) / 3600000;

      // 标签交集
      const prevTags = new Set([...(prev.tags || []), ...(prev.subtype || [])]);
      const currTags = new Set([...(curr.tags || []), ...(curr.subtype || [])]);
      const sharedTags = [...currTags].filter((t) => prevTags.has(t));

      if (timeGap <= maxTimeGapHours && sharedTags.length >= 1) {
        current.push(curr);
      } else {
        if (current.length >= minClusterSize) clusters.push(current);
        current = [curr];
      }
    }
    if (current.length >= minClusterSize) clusters.push(current);

    // 为每个簇生成 candidate episode
    const saved = [];
    for (const cluster of clusters) {
      const confidence = _calcConfidence(cluster);
      const { title, summary, mainSubtypes } = _generateSummary(cluster);
      const date = cluster[0].created
        ? cluster[0].created.slice(0, 10)
        : _formatDate(new Date());

      const candidates = this._readDay(this.candidatesDir, date);
      const episode = {
        id: `ep-cand-${date}-${String(candidates.length + 1).padStart(3, "0")}`,
        status: "candidate",
        confidence,
        title,
        summary,
        fragmentIds: cluster.map((f) => f.id),
        period: {
          start: cluster[0].created ? cluster[0].created.slice(0, 10) : date,
          end: cluster[cluster.length - 1].created
            ? cluster[cluster.length - 1].created.slice(0, 10)
            : date,
        },
        fragmentCount: cluster.length,
        avgHeat: Math.round(
          cluster.reduce((s, f) => s + (f.heat || 0), 0) / cluster.length
        ),
        mainSubtypes,
        created: _formatShanghaiISO(new Date()),
        confirmedAt: null,
        confirmedBy: null,
      };

      candidates.push(episode);
      this._writeDay(this.candidatesDir, date, candidates);
      saved.push(episode);
    }

    return saved;
  }

  // ── 读取 ──

  getCandidates(days = 7) {
    const results = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = _formatDate(d);
      results.push(...this._readDay(this.candidatesDir, date));
    }
    return results.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  }

  getConfirmed(days = 30) {
    const results = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = _formatDate(d);
      results.push(...this._readDay(this.confirmedDir, date));
    }
    return results.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  }

  getByDate(date, status = "candidate") {
    const dir = status === "confirmed" ? this.confirmedDir : this.candidatesDir;
    return this._readDay(dir, date);
  }

  // ── 确认/拒绝 ──

  confirmEpisode(id) {
    // 找到 candidate 并移到 confirmed
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = _formatDate(d);
      const candidates = this._readDay(this.candidatesDir, date);
      const idx = candidates.findIndex((ep) => ep.id === id);
      if (idx >= 0) {
        const ep = candidates.splice(idx, 1)[0];
        ep.status = "confirmed";
        ep.confirmedAt = _formatShanghaiISO(new Date());
        ep.confirmedBy = "manual";

        const confirmed = this._readDay(this.confirmedDir, date);
        confirmed.push(ep);

        this._writeDay(this.candidatesDir, date, candidates);
        this._writeDay(this.confirmedDir, date, confirmed);
        return ep;
      }
    }
    return null;
  }

  rejectCandidate(id) {
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = _formatDate(d);
      const candidates = this._readDay(this.candidatesDir, date);
      const idx = candidates.findIndex((ep) => ep.id === id);
      if (idx >= 0) {
        const removed = candidates.splice(idx, 1)[0];
        this._writeDay(this.candidatesDir, date, candidates);
        return removed;
      }
    }
    return null;
  }
}

// ── 辅助函数 ──

function _calcConfidence(cluster) {
  let score = 0.5;

  // 碎片越多越可信
  score += Math.min(cluster.length - 3, 5) * 0.05;

  // 标签集中度
  const allTags = cluster.flatMap((f) => [...(f.tags || []), ...(f.subtype || [])]);
  const tagFreq = {};
  allTags.forEach((t) => (tagFreq[t] = (tagFreq[t] || 0) + 1));
  const sharedTags = Object.values(tagFreq).filter((c) => c >= 2).length;
  score += sharedTags * 0.03;

  // 时间密度
  const first = cluster[0].created;
  const last = cluster[cluster.length - 1].created;
  if (first && last) {
    const timeSpan =
      (new Date(last) - new Date(first)) / 3600000;
    if (timeSpan <= 1) score += 0.15;
    else if (timeSpan <= 4) score += 0.08;
  }

  return Math.round(Math.min(score, 0.95) * 100) / 100;
}

function _generateSummary(cluster) {
  // 取最高热度的 3 条作为代表
  const top = [...cluster].sort((a, b) => (b.heat || 0) - (a.heat || 0)).slice(0, 3);

  // 提取共同标签和 subtype
  const allTags = cluster.flatMap((f) => [...(f.tags || []), ...(f.subtype || [])]);
  const tagFreq = {};
  allTags.forEach((t) => (tagFreq[t] = (tagFreq[t] || 0) + 1));
  const mainTags = Object.entries(tagFreq)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([t]) => t);

  const mainSubtypes = cluster
    .flatMap((f) => f.subtype || [])
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 3);

  // 标题
  const date = cluster[0].created ? cluster[0].created.slice(0, 10) : "";
  const title = mainTags.length
    ? `${mainTags.join("、")}相关讨论`
    : `${date} 记忆片段`;

  // 摘要：拼接代表片段首 30 字
  const snippets = top.map((f) =>
    (f.content || "").slice(0, 30)
  );
  const summary = [...new Set(snippets)].join("；");

  return { title, summary, mainSubtypes };
}

function _formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function _formatShanghaiISO(date) {
  return new Date(
    date.getTime() + 8 * 3600 * 1000
  ).toISOString().replace("Z", "+08:00");
}

module.exports = { MemoryEpisodeStore };
