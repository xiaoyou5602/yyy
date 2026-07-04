// 最近对话回顾自动生成器（session 自动接续，方案见 docs/plans/session-context-relay.md）
// 每次消息落库后防抖重写 {stateDir}/recent-context.md，
// 新 session 的 opening turn 由 shared-instructions.js 读取注入。
// 写失败只 warn 不抛——回顾是增强，不能影响聊天主链路。

const fs = require("fs");
const path = require("path");

const DEBOUNCE_MS = 5000;
const WINDOW_HOURS = 24;
const MAX_CHARS = 8000;
const MAX_ENTRIES = 60;
// 只有 DS 走 CLI session，API 模型每轮自带历史。存储里 model 字段是 modelName
// （"deepseek-v4-pro"）而非路由键 "ds"；空 model 是 checkin 主动消息等系统路径（仅 DS 有）
const DS_MODELS = new Set(["deepseek-v4-pro", ""]);

function createRecentContextWriter({ stateDir, messageStore }) {
  let timer = null;

  function schedule() {
    if (!stateDir || !messageStore) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        writeNow();
      } catch (err) {
        console.warn("[recent-context] write failed:", err.message);
      }
    }, DEBOUNCE_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  function writeNow() {
    // 取 2 个自然日覆盖跨午夜的 24 小时窗口
    const raw = messageStore.load(2);
    const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;

    const kept = [];
    let prevFrom = "";
    for (const m of raw) {
      if (!DS_MODELS.has(m.model || "")) continue;
      if (m.from !== "you" && m.from !== "ke") continue; // thinking 存档不是对话
      const text = String(m.text || "").trim();
      if (!text) continue;
      if (m.from === "ke" && (text.startsWith("{") || text.startsWith("❌"))) continue;
      // 主动标注基于全序列判断（窗口截断前），避免窗口头部的克消息被误标
      const proactive = m.from === "ke" && prevFrom !== "you";
      prevFrom = m.from;
      const ts = Date.parse(m.timestamp || "");
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const speaker = m.from === "you" ? "toge" : proactive ? "克（主动）" : "克";
      kept.push({
        line: `${formatStamp(ts)} ${speaker}: ${text.replace(/\s*\n\s*/g, " ")}`,
      });
    }

    // 从尾部往前取，同 Opus 逐轮历史逻辑
    const lines = [];
    let charCount = 0;
    for (let i = kept.length - 1; i >= 0; i--) {
      const line = kept[i].line;
      if (lines.length >= MAX_ENTRIES) break;
      if (charCount + line.length > MAX_CHARS) break;
      lines.unshift(line);
      charCount += line.length;
    }

    const filePath = path.join(stateDir, "recent-context.md");
    if (!lines.length) {
      atomicWrite(filePath, "");
      return;
    }

    const content = [
      `<!-- 本文件由系统自动生成，勿手动编辑。生成时间：${formatStamp(Date.now(), true)} -->`,
      "## 最近对话回顾（跨 Session 自动接续）",
      "以下是你（克）与 toge 最近的对话摘录，跨 session 自动携带。请自然延续，不要复述本段。",
      "",
      ...lines,
      "",
    ].join("\n");
    atomicWrite(filePath, content);
  }

  return { schedule, writeNow };
}

function formatStamp(ts, withYear = false) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  const md = `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  return withYear ? `${get("year")}-${md}` : `[${md}]`;
}

function atomicWrite(filePath, content) {
  const tmp = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

module.exports = { createRecentContextWriter };
