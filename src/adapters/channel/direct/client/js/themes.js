/* ═══ Theme Registry — 声明式主题矩阵 ═══ */
// 每个主题 = { id, name, cssClass, preview: { bg, accent }, metadata }
// id: data-theme 值（""=默认暖瓷）
// cssClass: themes.css 中的选择器名
// preview: 卡片预览用的渐变色（不透明度滑条影响的是壁纸遮罩，不是这里）
// metadata: 预留扩展槽位（designer, zoneBonus 等）

window.THEME_REGISTRY = [
  {
    id: "",
    name: "暖瓷",
    cssClass: "",
    preview: { bg: "linear-gradient(135deg, #f0f0eb, #fafaf7)", accent: "#5989b9" },
    metadata: { designer: "withtoge" }
  },
  {
    id: "sakura",
    name: "樱",
    cssClass: "sakura",
    preview: { bg: "linear-gradient(135deg, #ffe3ec, #fff5f7)", accent: "#e8a0b4" },
    metadata: { designer: "withtoge" }
  },
  {
    id: "midnight",
    name: "午夜",
    cssClass: "midnight",
    preview: { bg: "linear-gradient(135deg, #1e2430, #242a38)", accent: "#7b9cd8" },
    metadata: { designer: "withtoge" }
  },
  {
    id: "ocean",
    name: "海洋",
    cssClass: "ocean",
    preview: { bg: "linear-gradient(135deg, #e8f2f6, #f0f7fa)", accent: "#4696b4" },
    metadata: { designer: "withtoge" }
  },
  {
    id: "forest",
    name: "森林",
    cssClass: "forest",
    preview: { bg: "linear-gradient(135deg, #eaf5ed, #f5faf6)", accent: "#5a9a6a" },
    metadata: { designer: "withtoge" }
  }
];

// 按 id 快速查找
window.getThemeById = function(id) {
  return window.THEME_REGISTRY.find(function(t) { return t.id === id; }) || null;
};

// 当前 zone 的主题存取（复用已有的 localStorage key）
window.getThemeKey = function(zoneKey) { return "withtoge-theme-" + zoneKey; };

window.loadZoneTheme = function(zoneKey) {
  try { return localStorage.getItem(window.getThemeKey(zoneKey)) || ""; } catch(e) { return ""; }
};

window.saveZoneTheme = function(zoneKey, themeId) {
  try { localStorage.setItem(window.getThemeKey(zoneKey), themeId || ""); } catch(e) {}
};

window.applyZoneTheme = function(zoneKey, themeId) {
  var zoneEl = document.getElementById("chat-zone-" + zoneKey);
  if (!zoneEl) return;
  if (themeId) { zoneEl.dataset.theme = themeId; }
  else { delete zoneEl.dataset.theme; }
};

// 对所有 zone 应用已保存的主题
window.applyAllZoneThemes = function() {
  if (typeof ZONE_KEYS === 'undefined') return;
  ZONE_KEYS.forEach(function(k) {
    window.applyZoneTheme(k, window.loadZoneTheme(k));
  });
};

// 壁纸不透明度
window.loadWallpaperAlpha = function() {
  try { var v = localStorage.getItem("withtoge-wallpaper-alpha"); return v !== null ? parseFloat(v) : 0.75; } catch(e) { return 0.75; }
};

window.saveWallpaperAlpha = function(alpha) {
  try { localStorage.setItem("withtoge-wallpaper-alpha", String(alpha)); } catch(e) {}
};

window.applyWallpaperAlpha = function(alpha) {
  document.documentElement.style.setProperty("--wallpaper-overlay-alpha", alpha);
};

// 自定义主题（用户存档的调参结果）
window.loadCustomThemes = function() {
  try { return JSON.parse(localStorage.getItem("withtoge-custom-themes") || "[]"); } catch(e) { return []; }
};

window.saveCustomThemes = function(themes) {
  try { localStorage.setItem("withtoge-custom-themes", JSON.stringify(themes)); } catch(e) {}
};
