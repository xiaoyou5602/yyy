const fs = require("fs");
const path = require("path");

const DEFAULT_WORLDBOOK_DS = {
  ai: {
    name: "克",
    personality: "",
    speaking_style: "",
    background: "",
  },
  user: {
    name: "toge",
    description: "",
    preferences: "",
  },
  rules: [],
  updated_at: null,
};

const DEFAULT_WORLDBOOK_OPUS = {
  ai: {
    name: "",
    personality: "",
    speaking_style: "",
    background: "",
  },
  user: {
    name: "toge",
    description: "",
    preferences: "",
  },
  rules: [],
  updated_at: null,
};

const DEFAULT_WORLDBOOK_HAIKU = {
  ai: {
    name: "",
    personality: "",
    speaking_style: "",
    background: "",
  },
  user: {
    name: "toge",
    description: "",
    preferences: "",
  },
  rules: [],
  updated_at: null,
};

const DEFAULT_WORLDBOOKS = {
  ds: DEFAULT_WORLDBOOK_DS,
  opus: DEFAULT_WORLDBOOK_OPUS,
  haiku: DEFAULT_WORLDBOOK_HAIKU,
};

class WorldbookService {
  constructor({ stateDir, modelToKey }) {
    if (!stateDir) {
      throw new Error("WorldbookService requires stateDir");
    }
    this.stateDir = stateDir;
    this.modelToKey = modelToKey || ((m) => {
      const v = typeof m === "string" ? m.trim() : "";
      if (v === "ds" || v === "opus" || v === "haiku") return v;
      if (v === "claude-opus-4-6") return "opus";
      if (v === "claude-haiku-4-5") return "haiku";
      return "ds";
    });
  }

  _filePath(modelKey) {
    return path.join(this.stateDir, "worldbook", `${modelKey}.json`);
  }

  read(model = "") {
    const modelKey = typeof model === "string" && model.trim() ? this.modelToKey(model) : "ds";
    const filePath = this._filePath(modelKey);
    const defaults = DEFAULT_WORLDBOOKS[modelKey] || DEFAULT_WORLDBOOK_DS;
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { ...defaults, ...data };
      }
    } catch (err) {
      console.error("[worldbook] read error:", err.message);
    }
    return { ...defaults };
  }

  update(section, data, model = "") {
    const modelKey = typeof model === "string" && model.trim() ? this.modelToKey(model) : "ds";
    const filePath = this._filePath(modelKey);
    const defaults = DEFAULT_WORLDBOOKS[modelKey] || DEFAULT_WORLDBOOK_DS;
    const current = (() => {
      try {
        if (fs.existsSync(filePath)) {
          return { ...defaults, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
        }
      } catch {}
      return { ...defaults };
    })();

    if (!["ai", "user", "rules"].includes(section)) {
      throw new Error(`Invalid worldbook section: ${section}. Must be ai, user, or rules.`);
    }
    const merged = section === "rules"
      ? (Array.isArray(data) ? data : current.rules)
      : { ...current[section], ...data };
    current[section] = merged;
    current.updated_at = new Date().toISOString();
    this._write(current, modelKey);
    return current;
  }

  buildPromptSection(model = "") {
    const wb = this.read(model);
    const lines = [];

    if (wb.ai.name || wb.ai.personality || wb.ai.speaking_style) {
      lines.push("## AI 人设（世界书）");
      if (wb.ai.name) lines.push(`- 名字：${wb.ai.name}`);
      if (wb.ai.personality) lines.push(`- 性格：${wb.ai.personality}`);
      if (wb.ai.speaking_style) lines.push(`- 说话风格：${wb.ai.speaking_style}`);
      if (wb.ai.background) lines.push(`- 背景：${wb.ai.background}`);
    }

    if (wb.user.name || wb.user.description || wb.user.preferences) {
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

  _write(data, modelKey) {
    const filePath = this._filePath(modelKey);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

module.exports = { WorldbookService };
