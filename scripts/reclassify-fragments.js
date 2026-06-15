// 旧碎片批量重分类脚本
// 用法: node scripts/reclassify-fragments.js
// 读入所有旧碎片 → 用新规则重分类/重算热度/删垃圾 → 写回

const fs = require("fs");
const path = require("path");

const MEMORY_DIR = path.join(process.env.HOME || process.env.USERPROFILE, ".cyberboss", "memory");
const FRAGMENTS_DIR = path.join(MEMORY_DIR, "fragments");
const BACKUP_DIR = path.join(MEMORY_DIR, "fragments_backup_" + Date.now());

// ── 复制新规则的辅助函数（从 memory-service.js） ──

const HEAT_INITIAL_MAP = {
  identity: 95,
  reflection: 80,
  preference: 75,
  event: 60,
  fact: 35,
};

const GUESS_PREFIXES = /^(?:可能|大概|也许|好像|似乎)(?:是|在|有|会|要|去|来|吃|写|做|看|睡|没|已经|还|也|就|只)/;
const MARKDOWN_NOISE = /(?:^[*#\-]{1,4}\s|[*_]{2}|^回顾一下|^总结一下|^接下来|^下面是|^以下)/;
const CHRONICLE_ONLY = /^(?:从|然后|接着|之后|于是|再后|后来)[^，。！？]{0,30}(?:聊到|说到|讲到|切换到)/;

function qualityGate(content, type) {
  const trimmed = content.trim();
  if (trimmed.length < 4) {
    if (type === "identity" || type === "preference" || type === "reflection") {
      if (trimmed.length >= 2) return { pass: true };
    }
    return { pass: false, reason: "too_short" };
  }
  if (type === "fact" && trimmed.length < 6) {
    return { pass: false, reason: "fact_too_short" };
  }
  if (MARKDOWN_NOISE.test(trimmed)) {
    return { pass: false, reason: "markdown_noise" };
  }
  if (GUESS_PREFIXES.test(trimmed)) {
    if (!/觉得|感觉|发现|意识到|喜欢|讨厌|决定|放弃|崩溃|哭|开心|难过|害怕|ADHD|抑郁|药|医院/.test(trimmed)) {
      return { pass: false, reason: "pure_guess" };
    }
  }
  if (CHRONICLE_ONLY.test(trimmed)) {
    return { pass: false, reason: "chronicle_only" };
  }
  return { pass: true };
}

function contentBonus(content) {
  let bonus = 0;
  if (/\d+/.test(content)) bonus += 5;
  if (/从小|一直|已经.*[年月天了]|六年|十年|好多年|很久|好几年|多年/.test(content)) bonus += 8;
  const highEmotionWords = /崩溃|哭|崩溃大哭|好难过|好开心|激动|感动|爱死|心疼|害怕|恐惧|担心|焦虑|想死|绝望/;
  if (highEmotionWords.test(content)) bonus += 7;
  if (/ADHD|抑郁|过敏|慢性|确诊|药|治疗|医生|医院|病例/.test(content)) bonus += 8;
  if (/决定|放弃|从今天|再也不|终于|第一次|开始.{0,5}(?:开发|写|做|学|练|画|拍|剪)/.test(content)) bonus += 6;
  return bonus;
}

function classifySentenceEx(sentence) {
  if (
    /我有(?:ADHD|抑郁|焦虑|过敏|慢性|胃病|颈椎|低血糖|贫血|哮喘|鼻炎)/.test(sentence) ||
    /我(?:住在|现在在|搬到)/.test(sentence) ||
    /我(?:的|是).{0,8}(?:生日|出生)/.test(sentence) ||
    /我是.{0,8}(?:专业|学生)/.test(sentence)
  ) {
    return "identity";
  }
  if (
    /(?:喜欢|最爱|讨厌|不喜欢|受不了|爱死|超爱|好爱|好喜欢|爱|恨|好恨|烦死).{1,20}(?:的|了|因为|所以|，|。)/.test(sentence) ||
    /想成为|想变成|渴望|希望自己/.test(sentence) ||
    /(?:好想|想你|想你了|好想你|想念|太想你)/.test(sentence)
  ) {
    return "preference";
  }
  if (
    /决定|打算|计划|报名|申请|提交|放弃了?|辞职|搬家|开始.{0,3}(?:开发|写|做|学|练|画|拍|剪)/.test(sentence) ||
    /不\S{1,3}了|再也不|以后不/.test(sentence) ||
    /从今天|从明天|从下周|从现在/.test(sentence)
  ) {
    return "event";
  }
  if (
    /觉得|感觉|发现|意识到|知道|明白|原来|好像|似乎|可能.*[是我有会要该不]|第一次|终于|忽然|突然|一下子|慢慢/.test(sentence)
  ) {
    return "reflection";
  }
  if (
    /在|有|是|去|去了|来|来了|吃|吃了|写|写了|做|做了|看|看了/.test(sentence) &&
    sentence.length >= 8
  ) {
    return "fact";
  }
  return "skip";
}

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

// ── Main ──

console.log("=== 旧碎片重分类 ===\n");

// 备份
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const files = fs.readdirSync(FRAGMENTS_DIR).filter(f => f.endsWith(".json"));
for (const file of files) {
  fs.copyFileSync(path.join(FRAGMENTS_DIR, file), path.join(BACKUP_DIR, file));
}
console.log(`备份到: ${BACKUP_DIR} (${files.length} 个文件)\n`);

// 统计
let totalOld = 0;
let totalNew = 0;
let deleted = 0;
const typeChanges = {}; // "fact->reflection": count
const newTypeCounts = {};

for (const file of files) {
  const filePath = path.join(FRAGMENTS_DIR, file);
  const fragments = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const newFragments = [];

  for (const f of fragments) {
    totalOld++;
    const oldType = f.type;

    // 重分类
    const newType = classifySentenceEx(f.content);
    if (newType === "skip") {
      deleted++;
      continue;
    }

    // 质量门控
    const gate = qualityGate(f.content, newType);
    if (!gate.pass) {
      deleted++;
      continue;
    }

    // 重算热度
    const bonus = contentBonus(f.content);
    const newHeat = Math.min(100, (HEAT_INITIAL_MAP[newType] || 35) + bonus);

    // 重算标签
    const newTags = extractTags(f.content);

    // 追踪类型变化
    if (oldType !== newType) {
      const key = `${oldType}→${newType}`;
      typeChanges[key] = (typeChanges[key] || 0) + 1;
    }

    newTypeCounts[newType] = (newTypeCounts[newType] || 0) + 1;

    newFragments.push({
      ...f,
      type: newType,
      heat: newHeat,
      tags: newTags,
      // identity 自动 lock
      locked: f.locked || newType === "identity",
    });

    totalNew++;
  }

  // 写回
  fs.writeFileSync(filePath, JSON.stringify(newFragments, null, 2), "utf8");
  console.log(`  ${file}: ${fragments.length} → ${newFragments.length} (删 ${fragments.length - newFragments.length})`);
}

console.log(`\n=== 汇总 ===`);
console.log(`旧碎片总数: ${totalOld}`);
console.log(`新碎片总数: ${totalNew}`);
console.log(`删除垃圾: ${deleted}`);
console.log();

console.log(`类型分布:`);
for (const [t, c] of Object.entries(newTypeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${c} (${Math.round(c / totalNew * 100)}%)`);
}

console.log();
if (Object.keys(typeChanges).length > 0) {
  console.log(`类型变化:`);
  for (const [key, c] of Object.entries(typeChanges).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${c}`);
  }
} else {
  console.log(`(无类型变化)`);
}

console.log(`\n备份保留在: ${BACKUP_DIR}`);
console.log(`如需回滚: 把备份目录里的文件拷回 fragments/ 即可`);
