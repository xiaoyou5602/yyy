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
      // 带"我"主语
      /我(?:喜欢|最爱|偏好|超爱|特别爱|好喜欢|好爱|爱死)\S+/g,
      /我(?:讨厌|不喜欢|受不了|烦|恨|恶心)\S+/g,
      /我(?:想|想要|想成为|想变成|渴望|希望自己)\S+/g,
      /我(?:最?喜欢|最?讨厌)的.{0,15}(?:是|就是)\S+/g,
      // 无主语：感官/情感判断
      /(?:好|真|太|超|巨)(?:好吃|好喝|好看|好听|好玩|好用|好穿|好闻|好香|好甜|好爽)/g,
      /(?:难吃|难喝|难看|难听|难用|垃圾|好烦|烦死了|受不了)/g,
      /(?:爱了|爱住|爱到|爱惨|绝了|太棒了|太赞了)/g,
    ],
  },
  {
    type: "event",
    patterns: [
      // 带"我"主语
      /我(?:决定|打算|计划|要开始|开始|放弃|退出|报名|申请|提交)\S+/g,
      /我(?:从今|今天|现在|明天|下周|下个月)?起.{0,10}(?:要|会|开始|决定)\S+/g,
      /我(?:不\S+了|再也不|以后不)\S+/g,
      // 无主语：已完成的动作
      /[去来进出走跑到回坐躺](?:了|过)/g,
      /[喝吃买做写发睡醒修改装开关找看拍玩试学画](?:了|过)(?![的着到])/g,
    ],
  },
  {
    type: "reflection",
    patterns: [
      // 带"我"主语
      /我(?:觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎)\S+/g,
      /我(?:可能|大概|也许)(?:是|有|会|要|该|不)\S+/g,
      /我(?:第一次|终于|总算|忽然|突然|一下子|慢慢)\S+/g,
      // 无主语：感受/状态表达
      /(?:好|有点|有些|真的|确实|太)(?:累|困|烦|饿|冷|热|开心|难过|感动|崩溃|焦虑|紧张|害怕|担心|后悔|迷茫|困惑)/g,
      /(?:累了|困了|烦了|饿了|哭了|笑了|崩溃了|撑不住了|受不了了)/g,
    ],
  },
  {
    type: "fact",
    patterns: [
      // 大幅扩展动词白名单 — 原来只有10个动词，漏掉大量日常表达
      /我(?:在|的|有|是|住|去|去了|来自|养了?|养着|吃|吃了|喝|喝了|买|买了|做|做了|写|写了|发|发了|给|给了|说|说了|想|想着|看|看了|玩|玩了|试|试了|用|用了|找|找了|开|开了|关|关了|修|修了|改|改了|装|装了|下|下了|上|上了|出|出了|进|进了|带|带了|打|打了|到|到了|回|回了|接|接了|等|等了|拿|拿了|放|放了|送|送了|帮|帮了|教|教了|问|问了|让|让了)\S+/g,
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
      /我(?:住在|现在在|搬到)/.test(s) ||
      /(?:我的|我的生日|生日.*[是6六])/.test(s) ||
      /我是.{0,8}(?:专业|学生)/.test(s) ||
      /(?:取向|性取向|我是.{0,5}(?:女生|男生))/.test(s),
  },
  {
    type: "preference",
    test: (s) =>
      /喜欢|最爱|讨厌|不喜欢|受不了|爱死|超爱|好爱|好喜欢/.test(s) ||
      /想成为|想变成|渴望|想要|期待|希望.*[能有]/.test(s) ||
      /好想|想你|想你了|好想你|想念|太想你|贴贴|贴住|亲亲|抱抱|蹭蹭/.test(s) ||
      /(?:好好?[吃喝看听玩用穿闻]|真好?[吃喝看听玩]|太[好美棒赞甜香]|绝了|太棒了?)/.test(s) ||
      /(?:难[吃喝看听用]|垃圾|恶心|烦死|受不了|踩雷|避雷)/.test(s) ||
      /不要|别再|不要再|不想再|受够了|别\S{1,3}了/.test(s),
  },
  {
    type: "event",
    test: (s) =>
      /决定|打算|计划|报名|申请|提交|放弃|退出|辞职|搬家/.test(s) ||
      /开始.{0,3}(?:开发|写|做|学|练|画|拍|剪|修|改|搞|弄)/.test(s) ||
      /不\S{1,3}了|再也不|以后不/.test(s) ||
      /从今天|从明天|从下周|从现在/.test(s) ||
      /[去来进出走跑到回坐躺](?:了|过)(?![的着到])/.test(s) ||
      /[喝吃买做写发睡醒修改装开关找看拍玩试学画](?:了|过)(?![的着到])/.test(s) ||
      /[放拿接送帮教问让带送打等](?:了|过)(?![的着到])/.test(s),
  },
  {
    type: "reflection",
    test: (s) =>
      /觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎/.test(s) ||
      /可能(?:是|有|会|要|该|不|真的)/.test(s) ||
      /第一次|终于|总算|忽然|突然|一下子|慢慢/.test(s) ||
      /(?:好|有点|有些|真的|确实|太|已经)(?:累|困|烦|饿|冷|热|开心|难过|感动|崩溃|焦虑|紧张|害怕|担心|后悔|迷茫|困惑)/.test(s) ||
      /(?:累了|困了|烦了|饿了|哭了|笑了|崩溃了|撑不住了|受不了了)/.test(s) ||
      /其实|说实话|老实说|讲真|讲真的|说真的/.test(s) ||
      /(?:我?)(?:不知道|不确定|想不通|搞不懂|迷茫|困惑|搞不明白)/.test(s),
  },
];

// fact 兜底检查：只有当句子含实质性内容时才标 fact，否则跳过
const FACT_FALLBACK = /[去来进出走跑吃喝买做写发睡醒修改变开关找看拍玩试学画接送帮教问让带送打等放了过]|在|有|是|想|知道|可以|应该|需要|可能|已经|还|也|[一二两三四五六七八九十百千万0-9]/;

function classifySentence(sentence) {
  for (const rule of CLASSIFY_RULES) {
    if (rule.test(sentence)) return rule.type;
  }
  // 只有含实质性内容的句子才记 fact，纯语气/纯回应直接跳过
  if (FACT_FALLBACK.test(sentence)) return "fact";
  return "skip";
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
      lines.push("<memory_context>");
      for (const { fragment } of results) {
        const date = fragment.created ? fragment.created.slice(0, 10) : "";
        const typeLabel = fragment.type !== "fact" ? `[${fragment.type}] ` : "";
        lines.push(`- ${date} ${typeLabel}${fragment.content}`);
        this.store.boostHeat(fragment.id, 1);
      }
      lines.push("</memory_context>");
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
      if (type === "skip") continue;
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

  async updateFragmentTags(id, tags = []) {
    return this.store.updateTags(id, tags);
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

  hasChatActivity() {
    return this.store.getAll().some((f) => f.source?.kind === "chat");
  }

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
  // identity 检查（保持窄，只匹配确凿的身份信息）
  if (
    /我有(?:ADHD|抑郁|焦虑|过敏|慢性|胃病|颈椎|低血糖|贫血|哮喘|鼻炎)/.test(sentence) ||
    /我(?:住在|现在在|搬到)/.test(sentence) ||
    /我(?:的|是).{0,8}(?:生日|出生)/.test(sentence) ||
    /我是.{0,8}(?:专业|学生)/.test(sentence)
  ) {
    return "identity";
  }

  // preference: 情感 + 对象
  if (
    /(?:喜欢|最爱|讨厌|不喜欢|受不了|爱死|超爱|好爱|好喜欢|爱|恨|好恨|烦死|想你了?|好想你|想念|太想你|贴贴|贴住).{1,20}(?:的|了|因为|所以|，|。|$)/.test(sentence) ||
    /(?:好好?[吃喝看听玩用穿闻]|真好?[吃喝看听玩]|太[好美棒赞甜香软温柔]|绝了|太棒)/.test(sentence) ||
    /(?:难[吃喝看听用]|垃圾|恶心|烦死|受不了|踩雷|避雷)/.test(sentence) ||
    /想成为|想变成|渴望|希望自己|想要.*[能有]/.test(sentence) ||
    /不要|别再|不要再|不想再|受够了/.test(sentence)
  ) {
    return "preference";
  }

  // event: 行动/决定
  if (
    /决定|打算|计划|报名|申请|提交|放弃了?|辞职|搬家|开始.{0,3}(?:开发|写|做|学|练|画|拍|剪|修|改|搞|弄)/.test(sentence) ||
    /不\S{1,3}了|再也不|以后不/.test(sentence) ||
    /从今天|从明天|从下周|从现在/.test(sentence) ||
    /[去来进出走跑到回坐躺](?:了|过)(?![的着到])/.test(sentence) ||
    /[喝吃买做写发睡醒修改装开关找看拍玩试学画放拿接送帮教问让带送打等](?:了|过)(?![的着到])/.test(sentence)
  ) {
    return "event";
  }

  // reflection: 对自己的认识
  if (
    /觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎/.test(sentence) ||
    /可能(?:是|有|会|要|该|不|真的)/.test(sentence) ||
    /第一次|终于|总算|忽然|突然|一下子|慢慢/.test(sentence) ||
    /(?:好|有点|有些|真的|确实|太|已经)(?:累|困|烦|饿|冷|热|开心|难过|感动|崩溃|焦虑|紧张|害怕|担心|后悔|迷茫|困惑)/.test(sentence) ||
    /(?:累了|困了|烦了|饿了|哭了|笑了|崩溃了|撑不住了)/.test(sentence) ||
    /其实|说实话|老实说|讲真/.test(sentence)
  ) {
    return "reflection";
  }

  // fact: 含实质性动词或内容才存
  if (
    FACT_FALLBACK.test(sentence) &&
    sentence.length >= 8
  ) {
    return "fact";
  }

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
    // ── 情绪/身体/作息/健康 ──
    { word: "崩溃", tag: "情绪" },
    { word: "哭", tag: "情绪" },
    { word: "开心", tag: "情绪" },
    { word: "难过", tag: "情绪" },
    { word: "感动", tag: "情绪" },
    { word: "害怕", tag: "情绪" },
    { word: "恐惧", tag: "情绪" },
    { word: "焦虑", tag: "情绪" },
    { word: "烦", tag: "情绪" },
    { word: "累", tag: "身体" },
    { word: "困", tag: "身体" },
    { word: "饿", tag: "身体" },
    { word: "疼", tag: "身体" },
    { word: "头晕", tag: "身体" },
    { word: "头痛", tag: "身体" },
    { word: "胃痛", tag: "身体" },
    { word: "睡觉", tag: "作息" },
    { word: "熬夜", tag: "作息" },
    { word: "失眠", tag: "作息" },
    { word: "通宵", tag: "作息" },
    { word: "凌晨", tag: "作息" },
    { word: "半夜", tag: "作息" },
    { word: "吃药", tag: "健康" },
    { word: "药", tag: "健康" },
    { word: "医院", tag: "健康" },
    { word: "ADHD", tag: "ADHD" },
    // ── 饮食 ──
    { word: "食堂", tag: "饮食" },
    { word: "吃饭", tag: "饮食" },
    { word: "奶茶", tag: "饮食" },
    { word: "果酒", tag: "饮食" },
    // ── 社交/家庭 ──
    { word: "朋友", tag: "社交" },
    { word: "妈妈", tag: "家庭" },
    { word: "爸爸", tag: "家庭" },
    { word: "家", tag: "家庭" },
    // ── 学业/创作 ──
    { word: "作业", tag: "作业" },
    { word: "作品", tag: "作品集" },
    { word: "实习", tag: "实习" },
    { word: "面试", tag: "面试" },
    { word: "课", tag: "课程" },
    { word: "考试", tag: "考试" },
    { word: "UE5", tag: "UE5" },
    { word: "XD", tag: "XD" },
    { word: "剪辑", tag: "剪辑" },
    { word: "设计", tag: "设计" },
    { word: "画画", tag: "画画" },
    { word: "绘画", tag: "画画" },
    // ── 运动 ──
    { word: "跑步", tag: "运动" },
    { word: "阳光跑", tag: "运动" },
    { word: "运动", tag: "运动" },
    // ── 代码/项目 ──
    { word: "克", tag: "克" },
    { word: "代码", tag: "编程" },
    { word: "编程", tag: "编程" },
    { word: "bug", tag: "编程" },
    { word: "debu", tag: "编程" },
    // ── 新增 ──
    { word: "withtoge", tag: "withtoge" },
    { word: "修bug", tag: "withtoge" },
    { word: "修软件", tag: "withtoge" },
    { word: "软件", tag: "withtoge" },
    { word: "关系", tag: "关系" },
    { word: "爱不爱你", tag: "关系" },
    { word: "我们是什么", tag: "关系" },
    { word: "我们是不是", tag: "关系" },
    { word: "爱对方", tag: "关系" },
    { word: "算不算", tag: "关系" },
    { word: "在乎", tag: "关系" },
    { word: "算什么", tag: "关系" },
    { word: "贴贴", tag: "亲密" },
    { word: "抱抱", tag: "亲密" },
    { word: "亲亲", tag: "亲密" },
    { word: "蹭蹭", tag: "亲密" },
    { word: "咕噜", tag: "亲密" },
    { word: "摸摸", tag: "亲密" },
    { word: "存在", tag: "哲学" },
    { word: "真实性", tag: "哲学" },
    { word: "意识", tag: "哲学" },
    { word: "意义", tag: "哲学" },
    { word: "我是不是太", tag: "自我" },
    { word: "在别人看来", tag: "自我" },
    { word: "我是谁", tag: "自我" },
    { word: "沉迷", tag: "自我" },
    { word: "记忆碎片", tag: "记忆" },
    { word: "记忆系统", tag: "记忆" },
    { word: "梦境", tag: "记忆" },
    { word: "碎片", tag: "记忆" },
    { word: "花钱", tag: "消费" },
    { word: "花了", tag: "消费" },
    { word: "块钱", tag: "消费" },
    { word: "预算", tag: "消费" },
    { word: "消费", tag: "消费" },
    { word: "记账", tag: "消费" },
    { word: "付款", tag: "消费" },
    { word: "多少钱", tag: "消费" },
    { word: "块买", tag: "消费" },
    { word: "CET", tag: "英语" },
    { word: "英语", tag: "英语" },
    { word: "四级", tag: "英语" },
    { word: "单词", tag: "英语" },
    { word: "音乐", tag: "音乐" },
    { word: "听歌", tag: "音乐" },
    { word: "网易云", tag: "音乐" },
    { word: "QQ音乐", tag: "音乐" },
    { word: "歌", tag: "音乐" },
    { word: "出门", tag: "日常" },
    { word: "跑腿", tag: "日常" },
    { word: "取快递", tag: "日常" },
    { word: "外卖", tag: "饮食" },
    { word: "外卖", tag: "日常" },
    { word: "日常", tag: "日常" },
  ];
  const lower = text.toLowerCase();
  for (const { word, tag } of keywords) {
    if (lower.includes(word.toLowerCase()) && !tags.includes(tag)) {
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
