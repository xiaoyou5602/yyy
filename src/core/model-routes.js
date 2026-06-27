// 模型配置表：加新模型 = 加一行
// type: "cli" = Claude CLI（改代码/agent），"api" = 直调 API（纯聊天/写日记）

// 确保 .env 已加载（本模块可能在 main() 的 loadEnv() 之前被 require）
try { require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") }); } catch {}

const MODELS = {
  ds: {
    type: "cli",
    displayName: "DeepSeek V4 Pro",
    baseUrl: process.env.CYBERBOSS_DEEPSEEK_ENDPOINT || "https://api.deepseek.com/anthropic",
    apiKey: process.env.CYBERBOSS_DEEPSEEK_KEY || "",
    apiModel: "deepseek-v4-pro",
    modelName: "deepseek-v4-pro",
  },
  opus: {
    type: "api",
    apiFormat: "anthropic",
    displayName: "Claude Opus 4.6（55api）",
    baseUrl: process.env.CYBERBOSS_55API_ENDPOINT || "http://156.233.228.80:3000",
    apiKey: process.env.CYBERBOSS_55API_KEY || "",
    apiModel: "[A8-按量]claude-opus-4-6",
    modelName: "claude-opus-4-6",
  },
  glm: {
    type: "api",
    apiFormat: "openai",
    displayName: "GLM 5.2",
    baseUrl: "https://ws-p3tug6w6xf8x006o.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    apiKey: process.env.CYBERBOSS_GLM52_KEY || "",
    apiModel: "glm-4",
    modelName: "glm-5.2",
  },
  // 以后加新模型：复制上面一段，改 type/apiFormat/baseUrl/apiKey/apiModel/modelName/displayName
};

function getModelConfig(modelKey) {
  return MODELS[modelKey] || null;
}

function isCliModel(modelKey) {
  return MODELS[modelKey]?.type === "cli";
}

function isApiModel(modelKey) {
  return MODELS[modelKey]?.type === "api";
}

function getModelDisplayName(modelKey) {
  return MODELS[modelKey]?.displayName || modelKey;
}

module.exports = { MODELS, getModelConfig, isCliModel, isApiModel, getModelDisplayName };
