/* ═══ Theme Registry — 聊天 zone 主题系统 ═══ */
// 一个主题 = 一段 CSS 变量覆盖（themes.css），挂在 zone 容器的 data-theme 上。
// 变量作用域限在该 zone 内，zone 之间互不影响。
// header 是五 zone 共享的，跟活跃 zone 的主题走：activateZone 时把主题同步到
// #chat-page 的 data-theme（themes.css 选择器对 #chat-page 也生效）。
// DS 暖瓷页（#chat-ds-page）与 DS zone 共用同一份主题选择，靠 chat-ds 桥接规则
// 把通用变量翻译成 --ds-*（见 themes.css 顶部）。
//
// 铁律：本文件只管「数据 → data-theme 属性 + localStorage」，不碰 ws、不碰 history。

window.THEME_REGISTRY = [
  {
    id: "",
    name: "暖瓷",
    preview: { bg: "linear-gradient(135deg, #f0f0eb, #fafaf7)", accent: "#5989b9" }
  },
  {
    id: "sakura",
    name: "樱",
    preview: { bg: "linear-gradient(135deg, #ffe3ec, #fff5f7)", accent: "#e8a0b4" }
  },
  {
    id: "midnight",
    name: "午夜",
    preview: { bg: "linear-gradient(135deg, #1e2430, #242a38)", accent: "#7b9cd8" }
  },
  {
    id: "ocean",
    name: "海洋",
    preview: { bg: "linear-gradient(135deg, #e8f2f6, #f0f7fa)", accent: "#4696b4" }
  },
  {
    id: "forest",
    name: "森林",
    preview: { bg: "linear-gradient(135deg, #eaf5ed, #f5faf6)", accent: "#5a9a6a" }
  }
];

window.getThemeById = function(id) {
  var all = window.THEME_REGISTRY.concat(window.loadCustomThemes());
  return all.find(function(t) { return t.id === id; }) || null;
};

/* ── per-zone 主题选择持久化 ── */
window.getThemeKey = function(zoneKey) { return "withtoge-theme-" + zoneKey; };

window.loadZoneTheme = function(zoneKey) {
  try { return localStorage.getItem(window.getThemeKey(zoneKey)) || ""; } catch(e) { return ""; }
};

window.saveZoneTheme = function(zoneKey, themeId) {
  try { localStorage.setItem(window.getThemeKey(zoneKey), themeId || ""); } catch(e) {}
};

/* ── 应用 ── */
function setThemeAttr(el, themeId) {
  if (!el) return;
  if (themeId) { el.dataset.theme = themeId; }
  else { delete el.dataset.theme; }
}

// header/页面背景跟活跃 zone 的主题走（#chat-page 的 data-theme 与活跃 zone 同步，
// 这是 themes.css 合并选择器安全性的前提，activateZone 每次切换都会调这里）
window.syncPageTheme = function(activeKey) {
  setThemeAttr(document.getElementById("chat-page"), window.loadZoneTheme(activeKey));
};

window.applyZoneTheme = function(zoneKey, themeId) {
  setThemeAttr(document.getElementById("chat-zone-" + zoneKey), themeId);
  // DS 的主题同时喂给暖瓷独立页（桥接规则见 themes.css）
  if (zoneKey === "ds") {
    setThemeAttr(document.getElementById("chat-ds-page"), themeId);
  }
  // 活跃 zone 换主题 → header 立即跟上
  if (typeof activeZoneKey !== "undefined" && activeZoneKey === zoneKey) {
    setThemeAttr(document.getElementById("chat-page"), themeId);
  }
  // 通知调参台：清旧主题的 inline 微调、换上新主题桶的存值、重算默认值
  if (typeof window._tweakReapplyZone === "function") {
    window._tweakReapplyZone(zoneKey);
  }
};

window.applyAllZoneThemes = function() {
  if (typeof ZONE_KEYS === "undefined") return;
  ZONE_KEYS.forEach(function(k) {
    window.applyZoneTheme(k, window.loadZoneTheme(k));
  });
};

/* ── 壁纸遮罩不透明度（全局一个值，映射 body.has-wallpaper::before 的 alpha）── */
window.loadWallpaperAlpha = function() {
  try {
    var v = localStorage.getItem("withtoge-wallpaper-alpha");
    return v !== null ? parseFloat(v) : 0.75;
  } catch(e) { return 0.75; }
};

window.saveWallpaperAlpha = function(alpha) {
  try { localStorage.setItem("withtoge-wallpaper-alpha", String(alpha)); } catch(e) {}
};

window.applyWallpaperAlpha = function(alpha) {
  document.documentElement.style.setProperty("--wallpaper-overlay-alpha", alpha);
};

/* ── 自定义主题（调参台「存为主题卡片」的产物）── */
// 存储形态：[{ id:"custom-<ts>", name, vars:{ "--bubble-you":"#xxx", … }, preview:{bg,accent} }]
// 应用机制与内置主题完全一致：注入 <style> 生成 .chat-zone[data-theme="custom-N"] 规则，
// zone 挂 data-theme 即生效——不走 inline style，不产生第二套机制。
window.loadCustomThemes = function() {
  try { return JSON.parse(localStorage.getItem("withtoge-custom-themes") || "[]"); } catch(e) { return []; }
};

window.saveCustomThemes = function(themes) {
  try { localStorage.setItem("withtoge-custom-themes", JSON.stringify(themes)); } catch(e) {}
  window.injectCustomThemeStyles();
};

window.injectCustomThemeStyles = function() {
  var styleEl = document.getElementById("custom-themes-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "custom-themes-style";
    document.head.appendChild(styleEl);
  }
  var css = "";
  window.loadCustomThemes().forEach(function(t) {
    if (!t.id || !t.vars) return;
    var body = Object.keys(t.vars).map(function(k) {
      return "  " + k + ": " + t.vars[k] + ";";
    }).join("\n");
    // 与 themes.css 内置主题相同的三落点：zone 容器 / 共享 header / DS 暖瓷页
    css += '.chat-zone[data-theme="' + t.id + '"], #chat-page[data-theme="' + t.id + '"], #chat-ds-page[data-theme="' + t.id + '"] {\n' + body + "\n}\n";
  });
  styleEl.textContent = css;
};
