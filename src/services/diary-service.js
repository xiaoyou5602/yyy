const fs = require("fs");
const path = require("path");

const { resolveBodyInput } = require("./text-input");

class DiaryService {
  constructor({ config, memoryService }) {
    this.config = config;
    this.memoryService = memoryService || null;
  }

  async append({ text = "", textFile = "", title = "", date = "", time = "", model = "" } = {}) {
    const body = await resolveBodyInput({ text, textFile });
    if (!body) {
      throw new Error("Diary content cannot be empty. Pass text or textFile.");
    }

    const now = new Date();
    const dateString = date || formatDate(now);
    const timeString = time || formatTime(now);
    const filePath = path.join(this.config.diaryDir, `${dateString}.md`);
    const modelLabel = resolveModelLabel(model);
    const entry = buildDiaryEntry({
      timeString,
      title,
      body,
      modelLabel,
    });

    fs.mkdirSync(this.config.diaryDir, { recursive: true });
    const prefix = fs.existsSync(filePath) && fs.statSync(filePath).size > 0 ? "\n\n" : "";
    fs.appendFileSync(filePath, `${prefix}${entry}`, "utf8");

    return {
      filePath,
      date: dateString,
      time: timeString,
      body,
      model: modelLabel || "unknown",
    };
  }
}

function buildDiaryEntry({ timeString, title, body, modelLabel }) {
  const tag = modelLabel ? ` [${modelLabel}]` : "";
  const heading = title ? `## ${timeString}${tag} ${String(title).trim()}` : `## ${timeString}${tag}`;
  return `${heading}\n\n${body}`;
}

function resolveModelLabel(model) {
  const v = typeof model === "string" ? model.trim() : "";
  if (!v || v === "deepseek" || v === "ds") return "克";
  if (v === "claude-opus-4-6") return "Opus 4.6";
  if (v === "claude-haiku-4-5") return "Haiku 4.5";
  return v || "";
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

module.exports = {
  DiaryService,
  buildDiaryEntry,
  formatDate,
  formatTime,
};
