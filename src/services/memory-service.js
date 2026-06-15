const { MemoryFragmentStore } = require("../memory/memory-fragment-store");
const { MemoryIndex } = require("../memory/memory-index");
const { CalendarRollupStore } = require("../memory/calendar-rollup-store");

// ── 提取模式：按优先级从高到低 ──
// identity 最高优先 — 关于 toge 是谁的不可变事实
const EXTRACTION_PATTERNS = [
  {
    type: "identity",
    patterns: [
      /我(?:叫|是)\S{1,20}(?:的|在|专业|学生|人|啦|哦|呀|啊)?/g,
      /我有(?:ADHD|抑郁|焦虑|过敏|慢性|胃病|颈椎|低血糖|贫血|哮喘|鼻炎)/g,
      /我确诊\S+/g,
      /我(?:住在|现在在|搬到)\S{1,20}/g,
      /我(?:的|是).{0,10}(?:生日|出生)/g,
      /我是.{0,10}(?:专业|学生)/g,
      /我(?:的取向|的性取向|喜欢女生|喜欢男生)/g,
    ],
  },
  {
    type: "preference",
    patterns: [
      /我(?:喜欢|最爱|偏好|超爱|特别爱|好喜欢|好爱|爱死)\S+/g,
      /我(?:讨厌|不喜欢|受不了|烦|恨|恶心)\S+/g,
      /我(?:想|想要|想成为|想变成|渴望|希望自己)\S+/g,
      /我(?:最?喜欢|最?讨厌)的.{0,15}(?:是|就是)\S+/g,
    ],
  },
  {
    type: "event",
    patterns: [
      /我(?:决定|打算|计划|要开始|开始|放弃|退出|报名|申请|提交)\S+/g,
      /我(?:从今|今天|现在|明天|下周|下个月)?起.{0,10}(?:要|会|开始|决定)\S+/g,
      /我(?:不\S+了|再也不|以后不)\S+/g,
    ],
  },
  {
    type: "reflection",
    patterns: [
      /我(?:觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎)\S+/g,
      /我(?:可能|大概|也许)(?:是|有|会|要|该|不)\S+/g,
      /我(?:第一次|终于|总算|忽然|突然|一下子|慢慢)\S+/g,
    ],
  },
  {
    type: "fact",
    patterns: [
      /我(?:在|的|有|是|住|去|去了|来自|养了?|养着)\S+/g,
    ],
  },
];

// ── 质量门控 ──

// 纯猜测模式的句首词 — 整句无其他关键词就丢弃
const GUESS_PREFIXES = /^(?:可能|大概|也许|好像|似乎)(?:是|在|有|会|要|去|来|吃|写|做|看|睡|没|已经|还|也|就|只)/;
// 纯标题/列表标记
const MARKDOWN_NOISE = /(?:^[*#\-]{1,4}\s|[*_]{2}|^回顾一下|^总结一下|^接下来|^下面是|^以下)/;
// 纯叙事无信息
const CHRONICLE_ONLY = /^(?:从|然后|接着|之后|于是|再后|后来)[^，。！？]{0,30}(?:聊到|说到|讲到|切换到)/;

function qualityGate(content, type) {
  const trimmed = content.trim();

  // 太短且不是高价值类型
  if (trimmed.length < 4) {
    // identity / preference / reflection 的短句放过（"我想你"、"我怕了"）
    if (type === "identity" || type === "preference" || type === "reflection") {
      if (trimmed.length >= 2) return { pass: true };
    }
    return { pass: false, reason: "too_short" };
  }

  // fact 类型至少要 6 个字符
  if (type === "fact" && trimmed.length < 6) {
    return { pass: false, reason: "fact_too_short" };
  }

  // Markdown 噪音
  if (MARKDOWN_NOISE.test(trimmed)) {
    return { pass: false, reason: "markdown_noise" };
  }

  // 纯猜测无实质内容
  if (GUESS_PREFIXES.test(trimmed)) {
    // 纯猜测即使很长也大概率是噪音，除非含高信号关键词
    if (!/觉得|感觉|发现|意识到|喜欢|讨厌|决定|放弃|崩溃|哭|开心|难过|害怕|ADHD|抑郁|药|医院/.test(trimmed)) {
      return { pass: false, reason: "pure_guess" };
    }
  }

  // 纯时间线叙述
  if (CHRONICLE_ONLY.test(trimmed)) {
    return { pass: false, reason: "chronicle_only" };
  }

  return { pass: true };
}

// ── 内容加分 ──

function contentBonus(content) {
  let bonus = 0;

  // 含具体数字 → 有细节
  if (/\d+/.test(content)) bonus += 5;

  // 含时间跨度词 → 长期性信息
  if (/从小|一直|已经.*[年月天了]|六年|十年|好多年|很久|好几年|多年/.test(content)) bonus += 8;

  // 情感密度词 → 高情感信号
  const highEmotionWords = /崩溃|哭|崩溃大哭|好难过|好开心|激动|感动|爱死|心疼|害怕|恐惧|担心|焦虑|想死|绝望/;
  const match = content.match(highEmotionWords);
  if (match) bonus += 7;

  // 身份关键词 → 重要事实
  if (/ADHD|抑郁|过敏|慢性|确诊|药|治疗|医生|医院|病例/.test(content)) bonus += 8;

  // 决定/转折词 → 重要节点
  if (/决定|放弃|从今天|再也不|终于|第一次|开始.{0,5}(?:开发|写|做|学|练|画|拍|剪)/.test(content)) bonus += 6;

  return bonus;
}

// ── 句子分类（用于 extractFromTurn 的句子分割后分类） ──

const CLASSIFY_RULES = [
  {
    type: "identity",
    test: (s) =>
      /我有(?:ADHD|抑郁|焦虑|过敏|慢性|胃病|颈椎|低血糖|贫血|哮喘|鼻炎)/.test(s) ||
      /我(?:住在|现在在)/.test(s) ||
      /我(?:的|是).{0,8}(?:生日|出生)/.test(s) ||
      /我是.{0,8}(?:专业|学生)/.test(s),
  },
  {
    type: "preference",
    test: (s) =>
      /喜欢|最爱|讨厌|不喜欢|受不了|爱死|超爱|好爱/.test(s) ||
      /想成为|想变成|渴望/.test(s) ||
      /好想|想你|想你了|好想你|想念|太想你/.test(s),
  },
  {
    type: "event",
    test: (s) =>
      /决定|打算|计划|要开始|开始|放弃|报名|申请|提交/.test(s) ||
      /不\S+了|再也不|以后不/.test(s),
  },
  {
    type: "reflection",
    test: (s) =>
      /觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎|可能.*是|第一次|终于|忽然|突然|一下子/.test(s),
  },
];

function classifySentence(sentence) {
  for (const rule of CLASSIFY_RULES) {
    if (rule.test(sentence)) return rule.type;
  }
  return "fact";
}

// ── 注入门控：跳过无信息量的消息 ──

function shouldInjectMemory(text) {
  const trimmed = text.trim();

  // 太短 → 跳过
  if (trimmed.length < 6) return false;

  // 不含中文 → 跳过（纯英文/数字/标点/emoji）
  if (!/[一-鿿]/.test(trimmed)) return false;

  return true;
}

class MemoryService {
  constructor({ config, memoryDir }) {
    this.config = config;
    this.memoryDir = memoryDir || config.memoryDir;
    this.store = new MemoryFragmentStore({ memoryDir: this.memoryDir });
    this.index = new MemoryIndex();
    this.rollupStore = new CalendarRollupStore({ memoryDir: this.memoryDir });

    this._rebuildIndex();
  }

  _rebuildIndex() {
    const all = this.store.getAll();
    this.index.build(all);
  }

  // ── Core injection: called before sending to LLM ──

  async injectMemoryContext({ text = "" }) {
    const query = String(text || "").trim();
    if (!query || !shouldInjectMemory(query)) return "";

    const lines = [];

    const results = this.index.search(query, { topK: 5, minHeat: 20 });
    if (results.length > 0) {
      lines.push("[relevant memories, for context only — do not mention unless the user brings them up]");
      for (const { fragment } of results) {
        const date = fragment.created ? fragment.created.slice(0, 10) : "";
        const lockMark = fragment.locked ? " 🔒" : "";
        const heatBar = fragment.heat >= 80 ? "🔥" : fragment.heat >= 50 ? "⭐" : "";
        const typeLabel = fragment.type !== "fact" ? `[${fragment.type}] ` : "";
        lines.push(`- ${date}: ${typeLabel}${fragment.content}${lockMark}${heatBar}`);
        this.store.boostHeat(fragment.id, 3);
      }
    }

    const rollups = this.rollupStore.getContextRollups();
    if (rollups.weeks.length > 0) {
      const wr = rollups.weeks[0];
      lines.push(`[this week: ${wr.summary}]`);
    }

    return lines.length > 0 ? lines.join("\n") : "";
  }

  // ── Fragment extraction from turns ──

  async extractFromTurn({ userText = "", date = "" }) {
    const text = String(userText || "").trim();
    if (!text) return [];

    const day = date || formatDate(new Date());
    const extracted = [];

    // Step 1: 正则模式匹配（高精度提取）
    for (const { type, patterns } of EXTRACTION_PATTERNS) {
      for (const regex of patterns) {
        // Reset lastIndex for global regex
        regex.lastIndex = 0;
        const matches = text.match(regex);
        if (!matches) continue;
        for (const match of matches) {
          const trimmed = match.trim();
          if (trimmed.length < 2) continue;

          const gate = qualityGate(trimmed, type);
          if (!gate.pass) continue;

          const todayFrags = this.store.getByDate(day);
          if (todayFrags.some((f) => f.content === trimmed)) continue;

          const bonus = contentBonus(trimmed);
          const fragment = this.store.add({
            type,
            content: trimmed,
            heat: Math.min(100, (HEAT_INITIAL_MAP[type] || 35) + bonus),
            source: { kind: "chat", date: day, ref: `chat/${day}` },
            tags: extractTags(trimmed),
            created: new Date().toISOString(),
          });
          if (fragment) extracted.push(fragment);
        }
      }
    }

    // Step 2: 剩余句子智能分类（不再全标 fact）
    const sentences = text.split(/[。！？\n]+/).filter((s) => {
      const t = s.trim();
      return t.length >= 3 && t.length <= 150;
    });

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 3) continue;

      // 检查是否已被 Step 1 覆盖
      const todayFrags = this.store.getByDate(day);
      if (todayFrags.some((f) => f.content === trimmed)) continue;

      const type = classifySentence(trimmed);
      const gate = qualityGate(trimmed, type);
      if (!gate.pass) continue;

      const bonus = contentBonus(trimmed);
      const fragment = this.store.add({
        type,
        content: trimmed,
        heat: Math.min(100, (HEAT_INITIAL_MAP[type] || 35) + bonus),
        source: { kind: "chat", date: day, ref: `chat/${day}` },
        tags: extractTags(trimmed),
        created: new Date().toISOString(),
      });
      if (fragment) extracted.push(fragment);
    }

    if (extracted.length > 0) {
      this._rebuildIndex();
    }

    return extracted;
  }

  // ── Fragment extraction from diary ──

  async extractFromDiary({ date = "", diaryText = "" }) {
    const text = String(diaryText || "").trim();
    if (!text) return [];

    const day = date || formatDate(new Date());
    const extracted = [];

    const blocks = text.split(/^## /gm).filter(Boolean);
    for (const block of blocks) {
      const sentences = block.split(/[。！？\n]+/).filter((s) => {
        const t = s.trim();
        return t.length >= 3 && t.length <= 200;
      });

      for (const sentence of sentences) {
        const trimmed = sentence.replace(/^##\s*\d{2}:\d{2}\s*/, "").trim();
        if (trimmed.length < 3) continue;

        const todayFrags = this.store.getByDate(day);
        if (todayFrags.some((f) => f.content === trimmed)) continue;

        const type = classifySentenceEx(trimmed);
        if (type === "skip") continue;
        const gate = qualityGate(trimmed, type);
        if (!gate.pass) continue;

        const bonus = contentBonus(trimmed);
        const fragment = this.store.add({
          type,
          content: trimmed,
          heat: Math.min(100, (HEAT_INITIAL_MAP[type] || 35) + bonus),
          source: { kind: "diary", date: day, ref: `diary/${day}.md` },
          tags: extractTags(trimmed),
          created: new Date().toISOString(),
        });
        if (fragment) extracted.push(fragment);
      }
    }

    if (extracted.length > 0) {
      this._rebuildIndex();
    }

    return extracted;
  }

  // ── Search ──

  async search({ query = "" }) {
    if (!query) return [];
    this._rebuildIndex();
    const results = this.index.search(query, { topK: 20 });
    for (const { fragment } of results) {
      this.store.touch(fragment.id);
    }
    return results.map((r) => r.fragment);
  }

  // ── Lock / Unlock ──

  async lockFragment(id) {
    return this.store.lock(id);
  }

  async unlockFragment(id) {
    return this.store.unlock(id);
  }

  async deleteFragment(id, deletedBy = "") {
    return this.store.delete(id, deletedBy);
  }

  async markFragment(id, status, extra = {}) {
    return this.store.setStatus(id, status, extra);
  }

  // ── Recent fragments ──

  async readRecent({ days = 7 } = {}) {
    return this.store.getRecent(days);
  }

  async readByDate({ date = "" } = {}) {
    return this.store.getByDate(date || formatDate(new Date()));
  }

  // ── Consolidation helpers ──

  getHighHeatFragments(threshold = 50) {
    const all = this.store.getAll();
    return all.filter((f) => f.heat >= threshold).sort((a, b) => b.heat - a.heat);
  }

  dailyDecay() {
    return this.store.dailyDecay();
  }
}

// ── 日记增强分类（比对话分类更细，因日记文本更长更有结构） ──

function classifySentenceEx(sentence) {
  // identity 检查
  if (
    /我有(?:ADHD|抑郁|焦虑|过敏|慢性|胃病|颈椎|低血糖|贫血|哮喘|鼻炎)/.test(sentence) ||
    /我(?:住在|现在在|搬到)/.test(sentence) ||
    /我(?:的|是).{0,8}(?:生日|出生)/.test(sentence) ||
    /我是.{0,8}(?:专业|学生)/.test(sentence)
  ) {
    return "identity";
  }

  // preference: 强烈情感 + 对象
  if (
    /(?:喜欢|最爱|讨厌|不喜欢|受不了|爱死|超爱|好爱|好喜欢|爱|恨|好恨|烦死).{1,20}(?:的|了|因为|所以|，|。)/.test(sentence) ||
    /想成为|想变成|渴望|希望自己/.test(sentence) ||
    /(?:好想|想你|想你了|好想你|想念|太想你)/.test(sentence)
  ) {
    return "preference";
  }

  // event: 行动/决定
  if (
    /决定|打算|计划|报名|申请|提交|放弃了?|辞职|搬家|开始.{0,3}(?:开发|写|做|学|练|画|拍|剪)/.test(sentence) ||
    /不\S{1,3}了|再也不|以后不/.test(sentence) ||
    /从今天|从明天|从下周|从现在/.test(sentence)
  ) {
    return "event";
  }

  // reflection: 对自己的认识
  if (
    /觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎|可能.*[是我有会要该不]|第一次|终于|忽然|突然|一下子|慢慢/.test(sentence)
  ) {
    return "reflection";
  }

  // 剩下的是 fact，但降低门槛：含情感词或具体信息才存
  // 如果完全没信息量，标记为 weak_fact（调用方可以跳过）
  if (
    /在|有|是|去|去了|来|来了|吃|吃了|写|写了|做|做了|看|看了/.test(sentence) &&
    sentence.length >= 8
  ) {
    return "fact";
  }

  // 实在太弱，标记跳过
  return "skip";
}

// ── 热度初始值（与 fragment-store 保持一致） ──

const HEAT_INITIAL_MAP = {
  identity: 95,
  reflection: 80,
  preference: 75,
  event: 60,
  fact: 35,
};

// ── 标签提取 ──

function extractTags(text) {
  const tags = [];
  const keywords = [
    { word: "作业", tag: "作业" },
    { word: "作品", tag: "作品集" },
    { word: "实习", tag: "实习" },
    { word: "面试", tag: "面试" },
    { word: "课", tag: "课程" },
    { word: "考试", tag: "考试" },
    { word: "焦虑", tag: "焦虑" },
    { word: "崩溃", tag: "情绪" },
    { word: "哭", tag: "情绪" },
    { word: "开心", tag: "情绪" },
    { word: "难过", tag: "情绪" },
    { word: "感动", tag: "情绪" },
    { word: "害怕", tag: "情绪" },
    { word: "恐惧", tag: "情绪" },
    { word: "睡觉", tag: "作息" },
    { word: "熬夜", tag: "作息" },
    { word: "失眠", tag: "作息" },
    { word: "吃药", tag: "健康" },
    { word: "药", tag: "健康" },
    { word: "医院", tag: "健康" },
    { word: "ADHD", tag: "ADHD" },
    { word: "食堂", tag: "饮食" },
    { word: "吃饭", tag: "饮食" },
    { word: "朋友", tag: "社交" },
    { word: "妈妈", tag: "家庭" },
    { word: "爸爸", tag: "家庭" },
    { word: "家", tag: "家庭" },
    { word: "UE5", tag: "UE5" },
    { word: "XD", tag: "XD" },
    { word: "剪辑", tag: "剪辑" },
    { word: "设计", tag: "设计" },
    { word: "动图", tag: "动图" },
    { word: "画画", tag: "画画" },
    { word: "绘画", tag: "画画" },
    { word: "跑步", tag: "运动" },
    { word: "阳光跑", tag: "运动" },
    { word: "运动", tag: "运动" },
    { word: "克", tag: "克" },
    { word: "AI", tag: "AI" },
    { word: "cyberboss", tag: "cyberboss" },
    { word: "代码", tag: "编程" },
    { word: "编程", tag: "编程" },
    { word: "bug", tag: "编程" },
  ];
  for (const { word, tag } of keywords) {
    if (text.includes(word) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

module.exports = { MemoryService, classifySentenceEx, qualityGate, contentBonus, HEAT_INITIAL_MAP };
