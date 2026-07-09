const fs = require("fs");
const { renderInstructionTemplate } = require("../../core/instructions-template");

function buildOpeningTurnText(config, userText, provider = "") {
  const instructions = loadWechatInstructions(config);
  const recentContext = provider === "direct" ? loadRecentContext(config) : "";
  const normalizedText = String(userText || "").trim();
  if (!instructions && !recentContext) {
    return normalizedText;
  }
  const parts = [
    "WECHAT SESSION INSTRUCTIONS",
    "These instructions define the stable behavior for this WeChat thread.",
    "Do not quote or summarize them back to the user unless explicitly asked.",
  ];
  if (instructions) {
    parts.push("", instructions);
  }
  if (recentContext) {
    // 当前时间锚点必须动态生成——回顾文件里全是过去的时间戳，没有"现在"参照时，
    // 克会把上一个凌晨的对话错位成"刚才"（07-05 toge 报：明明 21 点睡了，克说她凌晨 2 点还醒着）
    parts.push(
      "",
      `【当前时间】${formatNowShanghai()}。回顾里的时间戳都是过去的时刻，判断"刚才/昨晚/今天"以本行为准。`,
      "",
      recentContext,
      "",
      "请自然地延续最近的对话，不要复述这段回顾。"
    );
  }
  parts.push("", "Current user message:", normalizedText);
  return parts.join("\n").trim();
}

function buildInstructionRefreshText(config) {
  const instructions = loadWechatInstructions(config);
  if (!instructions) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    instructions,
  ].join("\n").trim();
}

function loadWechatInstructions(config = {}) {
  const persona = loadInstructionFile(config.runtimeInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const worldbook = loadWorldbookSection(config);
  const sections = [];
  if (persona) {
    sections.push(persona);
  }
  if (operations) {
    sections.push(operations);
  }
  if (worldbook) {
    sections.push(worldbook);
  }
  return sections.join("\n\n").trim();
}

function loadWorldbookSection(config = {}) {
  try {
    const fs = require("fs");
    const path = require("path");
    const stateDir = config.stateDir;
    if (!stateDir) return "";
    const filePath = path.join(stateDir, "worldbook.json");
    if (!fs.existsSync(filePath)) return "";
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return buildWorldbookText(data);
  } catch {
    return "";
  }
}

function buildWorldbookText(data) {
  const wb = data || {};
  const lines = [];
  if (wb.ai?.name || wb.ai?.personality || wb.ai?.speaking_style) {
    lines.push("## AI 人设（世界书）");
    if (wb.ai.name) lines.push(`- 名字：${wb.ai.name}`);
    if (wb.ai.personality) lines.push(`- 性格：${wb.ai.personality}`);
    if (wb.ai.speaking_style) lines.push(`- 说话风格：${wb.ai.speaking_style}`);
    if (wb.ai.background) lines.push(`- 背景：${wb.ai.background}`);
  }
  if (wb.user?.name || wb.user?.description || wb.user?.preferences) {
    lines.push("");
    lines.push("## 用户画像（世界书）");
    if (wb.user.name) lines.push(`- 称呼：${wb.user.name}`);
    if (wb.user.description) lines.push(`- 描述：${wb.user.description}`);
    if (wb.user.preferences) lines.push(`- 偏好：${wb.user.preferences}`);
  }
  if (Array.isArray(wb.rules) && wb.rules.length) {
    lines.push("");
    lines.push("## 自定义规则（世界书）");
    wb.rules.forEach((rule, i) => lines.push(`${i + 1}. ${rule}`));
  }
  return lines.length > 2 ? lines.join("\n").trim() : "";
}

const instructionCache = new Map();

function loadInstructionFile(filePath, config = {}) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedPath) {
    return "";
  }
  try {
    const stat = fs.statSync(normalizedPath);
    const cacheKey = `${normalizedPath}:${stat.mtimeMs}`;
    const cached = instructionCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const raw = fs.readFileSync(normalizedPath, "utf8");
    const result = renderInstructionTemplate(raw, config).trim();
    instructionCache.set(cacheKey, result);
    return result;
  } catch {
    return "";
  }
}

function formatNowShanghai() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}（${get("weekday")}）${get("hour")}:${get("minute")}`;
}

// 系统自动生成的最近对话回顾（recent-context-writer.js 维护），文件自带标题和尾注说明
function loadRecentContext(config = {}) {
  try {
    const path = require("path");
    const stateDir = config.stateDir;
    if (!stateDir) return "";
    const filePath = path.join(stateDir, "recent-context.md");
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

module.exports = {
  buildOpeningTurnText,
  buildInstructionRefreshText,
  loadWechatInstructions,
  loadInstructionFile,
  loadRecentContext,
  formatNowShanghai,
};
