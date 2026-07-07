class MemoryIndex {
  constructor() {
    this.fragments = [];
    this.inverted = new Map();  // token → [{fragmentIdx, tf}]
    this.docLengths = [];        // fragmentIdx → total term count
    this.avgDocLength = 0;

    // 二级索引（Phase 0：地基）
    this.bySubtype = {};         // "RELATIONSHIP" → [fragIdx, ...]
    this.bySourceMessage = {};   // "msg_xxx" → [fragIdx, ...]
    this.byEpisode = {};         // "ep-xxx" → [fragIdx, ...]
  }

  /**
   * Chinese-aware tokenizer: extracts bigrams + individual chars + latin words
   */
  tokenize(text) {
    const tokens = [];
    const normalized = String(text || "").toLowerCase().trim();
    if (!normalized) return tokens;

    // Extract latin/english words
    const latinWords = normalized.match(/[a-z0-9_]+/g) || [];
    for (const w of latinWords) {
      if (w.length >= 2) tokens.push(w);
    }

    // Chinese bigrams
    const cjkOnly = normalized.replace(/[a-z0-9_\s]/g, "");
    for (let i = 0; i < cjkOnly.length - 1; i++) {
      tokens.push(cjkOnly.slice(i, i + 2));
    }
    // Individual chars (for single-char queries)
    for (const ch of cjkOnly) {
      tokens.push(ch);
    }

    // Also add the original words as phrase tokens
    const words = normalized.split(/[\s,，。！？、；：""''（）【】《》\-.]+/).filter(Boolean);
    for (const w of words) {
      if (w.length >= 2 && !/^[a-z0-9_]+$/.test(w)) {
        tokens.push(w);
      }
    }

    return tokens;
  }

  build(fragments) {
    this.fragments = fragments;
    this.inverted = new Map();
    this.docLengths = [];
    let totalLen = 0;

    for (let i = 0; i < fragments.length; i++) {
      const content = fragments[i].content || "";
      const tags = (fragments[i].tags || []).join(" ");
      const text = `${content} ${tags}`;
      const tokens = this.tokenize(text);
      const tf = new Map();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      const len = tokens.length;
      this.docLengths.push(len);
      totalLen += len;

      for (const [term, freq] of tf) {
        if (!this.inverted.has(term)) {
          this.inverted.set(term, []);
        }
        this.inverted.get(term).push({ fragmentIdx: i, tf: freq });
      }
    }
    this.avgDocLength = this.fragments.length > 0 ? totalLen / this.fragments.length : 0;

    // ── 构建二级索引 ──
    this.bySubtype = {};
    this.bySourceMessage = {};
    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      // subtype 是数组
      for (const st of (f.subtype || [])) {
        (this.bySubtype[st] ||= []).push(i);
      }
      // source message 反查
      const msgId = f.source?.message_id;
      if (msgId) (this.bySourceMessage[msgId] ||= []).push(i);
    }
  }

  search(query, { topK = 20, minHeat = 0 } = {}) {
    if (!query || !this.fragments.length) return [];

    const queryTokens = this.tokenize(String(query));
    if (!queryTokens.length) return [];

    // BM25-ish scoring
    const k1 = 1.2;
    const b = 0.75;
    const N = this.fragments.length;
    const scores = new Map(); // fragmentIdx → score

    for (const token of queryTokens) {
      const postings = this.inverted.get(token);
      if (!postings || !postings.length) continue;

      const df = postings.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const { fragmentIdx, tf } of postings) {
        const docLen = this.docLengths[fragmentIdx] || 0;
        const norm = k1 * (1 - b + b * (docLen / (this.avgDocLength || 1)));
        const score = idf * ((tf * (k1 + 1)) / (tf + norm));
        scores.set(fragmentIdx, (scores.get(fragmentIdx) || 0) + score);
      }
    }

    // Bonus for same-day fragments (scene association)
    const topFragments = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const sameDayBonusDays = new Set();
    for (const [idx] of topFragments) {
      const f = this.fragments[idx];
      if (f) {
        const day = f.created ? f.created.slice(0, 10) : "";
        if (day) sameDayBonusDays.add(day);
      }
    }

    const results = [];
    for (const [fragmentIdx, score] of scores) {
      const fragment = this.fragments[fragmentIdx];
      if (!fragment) continue;
      if (fragment.heat < minHeat) continue;

      let finalScore = score;
      // Scene association: same-day bonus
      const fragDay = fragment.created ? fragment.created.slice(0, 10) : "";
      if (sameDayBonusDays.has(fragDay)) {
        finalScore *= 1.2;
      }
      // Heat multiplier
      finalScore *= (0.5 + fragment.heat / 200);

      results.push({ fragment, score: finalScore });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  // ── 二级索引查询方法 ──

  /** 按 subtype 查找 fragment 索引 */
  getBySubtype(subtype) {
    return this.bySubtype[subtype] || [];
  }

  /** 按 source.message_id 反查 fragment 索引 */
  getBySourceMessage(msgId) {
    return this.bySourceMessage[msgId] || [];
  }

  /** 按 episode ID 查找 fragment 索引（Phase 4 使用） */
  getByEpisode(epId) {
    return this.byEpisode[epId] || [];
  }

  /** 注册 episode → fragmentIds 映射（Phase 4 调用） */
  registerEpisode(epId, fragmentIds) {
    for (const id of fragmentIds) {
      const idx = this.fragments.findIndex(f => f.id === id);
      if (idx >= 0) (this.byEpisode[epId] ||= []).push(idx);
    }
  }
}

module.exports = { MemoryIndex };
