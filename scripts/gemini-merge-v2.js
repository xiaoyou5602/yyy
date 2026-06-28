/**
 * Gemini CSS → withtoge 聊天区合并脚本 v2
 *
 * 策略：只替换聊天相关CSS（header/messages/thinking/input/footer），
 * 保留其他所有页面CSS不变。
 */
const fs = require('fs');

const geminiFile = fs.readFileSync('C:/Users/youzi/Desktop/克聊天页面.html','utf8');
const gStyle = geminiFile.match(/<style>([\s\S]*?)<\/style>/);
if (!gStyle) { console.log('ERROR: no style in gemini file'); process.exit(1); }
const g = gStyle[1]; // Gemini CSS

let ours = fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css','utf8');

// ============================================================
// PART 1: Replace :root variables (Gemini values, DS theme)
// Keep calendar tokens from ours, just update color tones
// ============================================================
const oldRoot = ours.match(/:root \{[\s\S]*?\n\}/);
if (oldRoot) {
  const newRoot = `:root {
  /* ── Gemini 暖瓷配色 ── */
  --bg: #f0f0eb;
  --bg-light: #fafaf7;
  --surface: #fafaf7;
  --text: #2d2d2d;
  --text-muted: rgba(45,45,45,0.45);
  --text-subtle: rgba(45,45,45,0.35);
  --accent: #5989b9;
  --accent-soft: rgba(89,137,185,0.06);
  --accent-cool: #a4c2e6;
  --accent-cool-soft: rgba(164,194,230,0.12);
  --bubble-you: rgba(89,137,185,0.06);
  --bubble-you-text: #2d2d2d;
  --bubble-ke: #fafaf7;
  --bubble-ke-text: #2d2d2d;
  --border: rgba(45,45,45,0.06);
  --border-soft: rgba(45,45,45,0.04);
  --shadow-xs: none;
  --shadow-sm: 0 4px 12px rgba(0,0,0,0.005);
  --shadow-md: 0 4px 10px rgba(89,137,185,0.12);
  --shadow-lg: 0 8px 40px rgba(0,0,0,0.06);
  --radius-xs: 4px;
  --radius-sm: 12px;
  --radius: 16px;
  --radius-lg: 20px;
  --radius-full: 20px;
  --font-display: Georgia, "Noto Serif SC", "Times New Roman", serif;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  --msg-gap: 6px;
  --msg-padding-x: 24px;
  --header-pt: 20px;
  --header-pb: 12px;
  --body-max-w: 480px;
  --input-min-h: 24px;
  --send-btn-size: 40px;
  --pet-size: 64px;
  --bubble-max-w: 85%;
  --footer-pb: 16px;
  --font-body-size: 14.5px;
  --msg-font-size: 14.5px;
  --h1-font-size: 18px;
  --cal-page-bg: #f0f0eb;
  --cal-title-grad-1: #5989b9;
  --cal-title-grad-2: #a4c2e6;
  --cal-title-grad-3: #cc7b5c;
  --cal-title-size: 32px;
  --cal-header-pb: 12px;
  --cal-grid-gap: 4px;
  --cal-day-cell-h: 44px;
  --cal-day-radius: 12px;
  --cal-day-num-size: 16px;
  --cal-weekday-color: #8FA89B;
  --cal-weekend-color: #cc7b5c;
  --cal-panel-bg: #f0f0eb;
  --cal-panel-header-pb: 12px;
  --cal-plan-gap: 6px;
  --cal-plan-bg: #fafaf7;
  --cal-hub-bg: #fafaf7;
}`;
  ours = ours.replace(oldRoot[0], newRoot);
  console.log('OK: root variables');
}

// ============================================================
// PART 2: Replace model-deepseek theme only
// Keep .model-opus, .model-haiku, .model-openclaw, .model-glm unchanged
// ============================================================
const oldDS = ours.match(/:root, \.model-deepseek \{[\s\S]*?\n\}/);
if (oldDS) {
  const newDS = `:root, .model-deepseek {
  --model-accent: #5989b9;
  --model-accent-hover: #467099;
  --model-accent-soft: rgba(89,137,185,0.06);
  --model-bubble-you: rgba(89,137,185,0.06);
  --model-bubble-you-text: #2d2d2d;
  --model-header-bg: #fafaf7;
  --model-header-border: rgba(45,45,45,0.04);
  --model-status-color: #46a07b;
  --model-input-focus: #5989b9;
  --model-input-focus-ring: rgba(89,137,185,0.12);
}`;
  ours = ours.replace(oldDS[0], newDS);
  console.log('OK: DS theme variables');
}

// ============================================================
// PART 3: Replace body style
// ============================================================
const oldBody = `body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  font-size: var(--font-body-size);
  height: 100vh; height: 100dvh; display: flex; flex-direction: column;
  max-width: var(--body-max-w); margin: 0 auto;
  -webkit-font-smoothing: antialiased;
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
  overscroll-behavior: none;
}`;
const newBody = `body {
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  font-size: var(--font-body-size);
  height: 100vh; height: 100dvh; display: flex; flex-direction: column;
  max-width: var(--body-max-w); margin: 0 auto;
  -webkit-font-smoothing: antialiased;
  padding-bottom: env(safe-area-inset-bottom);
  overflow: hidden;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
}`;
ours = ours.replace(oldBody, newBody);
console.log('OK: body');

// ============================================================
// PART 4: Replace #chat-page background
// ============================================================
ours = ours.replace(
  `#chat-page { background: var(--chat-bg, #fafaf9); position: relative; }`,
  `#chat-page { background: var(--bg-light, #fafaf7); position: relative; }`
);
console.log('OK: chat-page');

// ============================================================
// PART 5: Replace Header
// ============================================================
const oldHeader = `header {
  display: flex; align-items: center; gap: 10px;
  padding: var(--header-pt) 20px var(--header-pb) 20px;
  background: var(--model-header-bg, #FDF5EC); flex-shrink: 0; user-select: none;
  border-bottom: 1px solid var(--model-header-border, rgba(232,93,63,0.08));
}`;
const newHeader = `header {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: var(--header-pt) 24px var(--header-pb) 24px;
  background: var(--model-header-bg, #fafaf7); flex-shrink: 0; user-select: none;
  border-bottom: 1px solid var(--model-header-border);
  z-index: 10;
}`;
ours = ours.replace(oldHeader, newHeader);
console.log('OK: header');

// Header h1
ours = ours.replace(
  `header h1 {\n  font-size: var(--h1-font-size); font-weight: 600; flex: 1;\n  letter-spacing: 0.02em; color: var(--text);\n}`,
  `header h1 {\n  font-size: var(--h1-font-size); font-weight: 700; flex: 1;\n  letter-spacing: -0.5px; color: var(--text); line-height: 1.2;\n}`
);

// Header buttons
const oldMenuBtn = `#menu-btn {\n  background: none; border: none; color: var(--text-muted); font-size: 20px;\n  cursor: pointer; padding: 2px 6px; border-radius: 6px; line-height: 1;\n  transition: color 0.15s, background 0.15s; flex-shrink: 0;\n}\n#menu-btn:hover { color: var(--accent); background: var(--accent-soft); }`;
const newMenuBtn = `#menu-btn, #search-btn, #settings-btn {\n  background: none; border: none; color: rgba(45,45,45,0.5); cursor: pointer;\n  display: flex; align-items: center; justify-content: center;\n  padding: 6px; border-radius: 50%;\n  transition: color 0.2s, background-color 0.2s;\n}\n#menu-btn:active, #search-btn:active, #settings-btn:active {\n  background-color: rgba(45,45,45,0.04); color: var(--text);\n}`;
ours = ours.replace(oldMenuBtn, newMenuBtn);

// Remove old search/settings separate rules
ours = ours.replace(
  `#search-btn, #settings-btn {\n  background: none; border: none; color: var(--text-muted); font-size: 18px;\n  cursor: pointer; padding: 4px 6px; border-radius: 6px; line-height: 1;\n  transition: color 0.15s, background 0.15s;\n}\n#search-btn:hover, #settings-btn:hover { color: var(--text); background: var(--bg); }`,
  ''
);
console.log('OK: header buttons');

// Status dot
ours = ours.replace(
  `#status-dot {\n  width: 7px; height: 7px; border-radius: 50%;\n  background: #ccc; flex-shrink: 0; transition: background 0.3s;\n}`,
  `#status-dot {\n  width: 5px; height: 5px; border-radius: 50%;\n  background: #ccc; flex-shrink: 0; transition: background 0.3s;\n}`
);
ours = ours.replace(
  `#status-dot.on { background: var(--model-status-color, #5eea8b); box-shadow: 0 0 0 0 var(--model-status-color, rgba(94,234,139,0.5)); animation: status-pulse 2s ease-in-out infinite; }`,
  `#status-dot.on { background: var(--model-status-color, #46a07b); box-shadow: 0 0 6px rgba(70,160,123,0.2); animation: none; }`
);
console.log('OK: status');

// ============================================================
// PART 6: Replace Messages
// ============================================================
const oldMessages = `.chat-messages {\n  flex: 1; overflow-y: auto; padding: 20px var(--msg-padding-x);\n  display: flex; flex-direction: column; gap: var(--msg-gap);\n  scroll-behavior: smooth;\n  overscroll-behavior: contain;\n  touch-action: pan-y;\n  transition: padding-bottom 0.25s ease;\n}`;
const newMessages = `.chat-messages {\n  flex: 1; overflow-y: auto; padding: 10px var(--msg-padding-x);\n  display: flex; flex-direction: column; gap: 16px;\n  scroll-behavior: smooth;\n  overscroll-behavior: contain;\n  touch-action: pan-y;\n  transition: padding-bottom 0.25s ease;\n  scrollbar-gutter: stable;\n  -webkit-overflow-scrolling: touch;\n}`;
ours = ours.replace(oldMessages, newMessages);
console.log('OK: messages');

// Empty state
ours = ours.replace(
  `.chat-messages:empty::after {\n  content: "跟克说点什么吧";\n  color: #ccc; font-size: 14px;\n  display: block; text-align: center; padding-top: 100px;\n  animation: fade-in 0.6s ease 0.3s both;\n}`,
  `.chat-messages:empty::after {\n  content: "说点什么吧…";\n  color: rgba(45,45,45,0.2); font-size: 14px;\n  display: block; text-align: center; padding-top: 100px;\n  animation: fade-in 0.6s ease 0.3s both;\n}`
);
console.log('OK: empty state');

// ============================================================
// PART 7: Replace Message Bubbles (Gemini asymmetrical radii)
// ============================================================
// Base msg
ours = ours.replace(
  `.msg {\n  max-width: var(--bubble-max-w); padding: 9px 14px;\n  border-radius: var(--radius);\n  line-height: 1.25; font-size: var(--msg-font-size);\n  word-break: break-word;\n  animation: rise 0.22s ease;\n}`,
  `.msg {\n  max-width: var(--bubble-max-w); padding: 0;\n  line-height: 1.55; font-size: var(--msg-font-size);\n  word-break: break-word;\n  animation: rise 0.22s ease;\n}`
);

// User bubble
ours = ours.replace(
  `.msg.you {\n  align-self: flex-end; width: fit-content;\n  background: var(--model-bubble-you, var(--bubble-you)); color: var(--model-bubble-you-text, var(--bubble-you-text));\n  border-bottom-right-radius: 6px;\n  box-shadow: var(--shadow-xs);\n}`,
  `.msg.you {\n  align-self: flex-end; width: fit-content;\n  background: var(--model-bubble-you, var(--bubble-you)); color: var(--model-bubble-you-text, var(--bubble-you-text));\n  border: 1px solid rgba(89,137,185,0.12);\n  border-radius: 16px 4px 16px 16px;\n  box-shadow: none;\n  padding: 11px 15px;\n  line-height: 1.55;\n}`
);

// Ke bubble
ours = ours.replace(
  `.msg.ke .msg-bubble {\n  width: fit-content; max-width: 100%;\n  background: var(--bubble-ke); color: var(--bubble-ke-text);\n  padding: 9px 14px; border-radius: var(--radius);\n  border-bottom-left-radius: 6px;\n  box-shadow: var(--shadow-xs);\n}`,
  `.msg.ke .msg-bubble {\n  width: fit-content; max-width: 100%;\n  background: var(--bubble-ke); color: var(--bubble-ke-text);\n  padding: 11px 15px; border-radius: 4px 16px 16px 16px;\n  border: 1px solid var(--border);\n  box-shadow: var(--shadow-sm);\n  line-height: 1.55;\n}`
);

// Ke container
ours = ours.replace(
  `.msg.ke { background: transparent; box-shadow: none; padding: 0; }`,
  `.msg.ke { background: transparent; box-shadow: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }`
);

// Time
ours = ours.replace(
  `.msg .time {\n  font-size: 10.5px; color: rgba(255,255,255,0.6); margin-top: 4px; text-align: right;\n}\n.msg.ke .time { color: #b0b0b6; }`,
  `.msg .time {\n  font-size: 10px; color: rgba(45,45,45,0.3); margin-top: 2px; padding: 0 4px;\n}\n.msg.ke .time { color: rgba(45,45,45,0.3); }`
);
console.log('OK: bubbles');

// ============================================================
// PART 8: Replace Thinking
// ============================================================
ours = ours.replace(
  `.thinking-inline {\n  margin: 0 0 3px 0;\n}`,
  `.thinking-inline {\n  margin: 4px 0 2px 0;\n  padding-left: 12px;\n  border-left: 2px solid rgba(89,137,185,0.15);\n}`
);

ours = ours.replace(
  `.thinking-inline.thinking-tool-active {\n  /* 预留工具态区分 */\n}`,
  `.thinking-inline.thinking-tool-active {\n  border-left-color: rgba(204,123,92,0.3);\n}`
);

ours = ours.replace(
  `.thinking-inline-header {\n  font-size: 11px;\n  color: #a0a0a0;\n  cursor: pointer;\n  user-select: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n}\n\n.thinking-inline-header:hover { color: #666; }`,
  `.thinking-inline-header {\n  display: inline-flex; align-items: center; gap: 6px;\n  cursor: pointer; user-select: none;\n  color: var(--model-accent, #5989b9);\n  font-size: 11.5px; font-weight: 600; letter-spacing: 0.3px;\n}\n\n.thinking-inline-header:hover { opacity: 0.8; }`
);

ours = ours.replace(
  `.thinking-inline-arrow {\n  font-size: 8px;\n  color: #bbb;\n  min-width: 8px;\n}`,
  `.thinking-inline-arrow {\n  font-size: 8px;\n  min-width: 8px;\n  transition: transform 0.3s cubic-bezier(0.43,0.15,0.02,1.05);\n  display: inline-block;\n}`
);

ours = ours.replace(
  `.thinking-inline-body {\n  font-size: 12px;\n  color: #8e8e93;\n  line-height: 1.3;\n  white-space: pre-wrap;\n  word-break: break-word;\n  padding: 3px 0 0 0;\n  opacity: 0.85;\n  max-height: 200px;\n  overflow-y: auto;\n}\n\n.thinking-inline-body.thinking-collapsed { display: none; }`,
  `.thinking-inline-body {\n  font-size: 12.5px;\n  color: rgba(45,45,45,0.45);\n  line-height: 1.55;\n  white-space: pre-wrap;\n  word-break: break-word;\n  padding-top: 5px;\n  max-height: 200px;\n  overflow-y: auto;\n  opacity: 1;\n}\n\n.thinking-inline-body.thinking-collapsed { display: none; }`
);
console.log('OK: thinking');

// ============================================================
// PART 9: Replace Footer / Input
// ============================================================
ours = ours.replace(
  `footer {\n  padding: 0 12px calc(var(--footer-pb) + env(safe-area-inset-bottom));\n  background: transparent; border: none;\n  flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end;\n  transition: opacity 0.25s, transform 0.25s;\n}`,
  `footer {\n  padding: 12px 24px calc(var(--footer-pb) + env(safe-area-inset-bottom)) 24px;\n  background: var(--surface); border: none;\n  border-top: 1px solid var(--border);\n  flex-shrink: 0; display: flex; gap: 10px; align-items: flex-end;\n  transition: opacity 0.25s, transform 0.25s;\n}`
);

// Input
ours = ours.replace(
  `.chat-input {\n  flex: 1; resize: none; min-height: var(--input-min-h); max-height: 120px;\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-full);\n  padding: 11px 20px;\n  font-size: 14px; font-family: var(--font-body); color: var(--text);\n  outline: none; line-height: 1.5;\n  box-shadow: var(--shadow-xs);\n  transition: border-color 0.2s, box-shadow 0.2s;\n}`,
  `.chat-input {\n  flex: 1; resize: none; height: 24px; min-height: 24px; max-height: 120px;\n  background: transparent;\n  border: none;\n  outline: none;\n  padding: 0;\n  font-size: 14.5px; font-family: var(--font-body); color: var(--text);\n  line-height: 24px;\n  overflow-y: auto;\n  white-space: pre-wrap;\n  word-break: break-all;\n}`
);

ours = ours.replace(
  `.chat-input:focus {\n  border-color: var(--model-input-focus, var(--accent));\n  box-shadow: 0 0 0 4px var(--model-input-focus-ring, var(--accent-soft));\n}`,
  `.chat-input:focus { outline: none; }`
);

ours = ours.replace(
  `.chat-input::placeholder { color: var(--text-subtle); }`,
  `.chat-input::placeholder { color: rgba(45,45,45,0.35); }`
);

// Add input container
const afterFooter = ours.indexOf('/* ── Shared bottom panel ── */');
if (afterFooter > 0) {
  ours = ours.slice(0, afterFooter) +
    `/* ── Input container (Gemini) ── */\n.input-container-inner {\n  flex: 1;\n  position: relative;\n  background: var(--bg);\n  border: 1px solid var(--border);\n  border-radius: 20px;\n  padding: 8px 45px 8px 14px;\n  display: flex;\n  align-items: flex-end;\n}\n\n` +
    ours.slice(afterFooter);
}

// Image button
ours = ours.replace(
  `.image-btn {\n  height: 48px; min-width: 48px; border: 1px solid var(--border); border-radius: 50%;\n  background: var(--surface); color: var(--text-muted); cursor: pointer;\n  flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: var(--shadow-xs);\n  font-size: 22px;\n  transition: color 0.15s, background 0.15s, border-color 0.15s;\n}\n.image-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }`,
  `.image-btn {\n  position: absolute; right: 8px; bottom: 7px;\n  width: 26px; height: 26px; border: none; border-radius: 50%;\n  background: transparent; color: rgba(45,45,45,0.3); cursor: pointer;\n  flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  font-size: 16px;\n  transition: transform 0.2s, opacity 0.2s;\n}\n.image-btn:active { transform: scale(0.9); opacity: 0.8; }`
);

// Send button
ours = ours.replace(
  `.send-btn {\n  height: var(--send-btn-size); min-width: var(--send-btn-size); border: none; border-radius: 50%;\n  background: var(--model-accent, var(--accent)); color: #fff;\n  cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: var(--shadow-sm);\n  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;\n}\n.send-btn:hover { background: var(--model-accent-hover, #d44d31); box-shadow: var(--shadow-md); transform: scale(1.06); }\n.send-btn:active { transform: scale(0.94); transition: transform 0.05s; }\n.send-btn:disabled { background: #e0ddd6; color: var(--text-subtle); box-shadow: none; cursor: default; transform: none; }`,
  `.send-btn {\n  width: 40px; height: 40px; min-width: 40px; border: none; border-radius: 50%;\n  background: var(--model-accent, #5989b9); color: #fff;\n  cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: 0 4px 10px rgba(89,137,185,0.12);\n  transition: transform 0.2s, background-color 0.2s;\n}\n.send-btn:active { transform: scale(0.92); background: var(--model-accent-hover, #467099); }\n.send-btn:disabled { background: rgba(45,45,45,0.1); color: rgba(45,45,45,0.3); box-shadow: none; cursor: default; transform: none; }`
);
console.log('OK: footer/input');

// ============================================================
// PART 10: Minor tweaks - scrollbar, selection, scroll-to-bottom
// ============================================================
// Scrollbar
ours = ours.replace(
  '.chat-messages::-webkit-scrollbar, #memory-content::-webkit-scrollbar, .calendar-day-panel::-webkit-scrollbar { width: 5px; }',
  '.chat-messages::-webkit-scrollbar, #memory-content::-webkit-scrollbar, .calendar-day-panel::-webkit-scrollbar { width: 4px; }'
);
ours = ours.replace(
  '.chat-messages::-webkit-scrollbar-thumb, #memory-content::-webkit-scrollbar-thumb, .calendar-day-panel::-webkit-scrollbar-thumb { background: #ddd; border-radius: 10px; }',
  '.chat-messages::-webkit-scrollbar-thumb, #memory-content::-webkit-scrollbar-thumb, .calendar-day-panel::-webkit-scrollbar-thumb { background: rgba(45,45,45,0.05); border-radius: 10px; }'
);
ours = ours.replace(
  '.chat-messages::-webkit-scrollbar-thumb:hover, #memory-content::-webkit-scrollbar-thumb:hover, .calendar-day-panel::-webkit-scrollbar-thumb:hover { background: #ccc; }',
  '.chat-messages::-webkit-scrollbar-thumb:hover, #memory-content::-webkit-scrollbar-thumb:hover, .calendar-day-panel::-webkit-scrollbar-thumb:hover { background: rgba(45,45,45,0.12); }'
);

// Scroll-to-bottom
ours = ours.replace(
  `.scroll-bottom-btn {\n  position: absolute; bottom: 80px; right: 12px;\n  width: 36px; height: 36px; border-radius: 50%;\n  background: rgba(255,255,255,0.85); border: 1px solid var(--border);\n  box-shadow: var(--shadow-sm); cursor: pointer;\n  display: flex; align-items: center; justify-content: center;\n  opacity: 0; transform: translateY(10px); pointer-events: none;\n  transition: opacity 0.2s, transform 0.2s; z-index: 5;\n}`,
  `.scroll-bottom-btn {\n  position: absolute; bottom: 80px; right: 16px;\n  width: 32px; height: 32px; border-radius: 50%;\n  background: var(--surface); border: 1px solid var(--border);\n  box-shadow: 0 2px 8px rgba(0,0,0,0.04); cursor: pointer;\n  display: flex; align-items: center; justify-content: center;\n  opacity: 0; transform: translateY(10px); pointer-events: none;\n  transition: opacity 0.2s, transform 0.2s; z-index: 5;\n}`
);

// Selection
ours = ours.replace(
  `body.selecting .chat-messages { padding-bottom: 100px; transition: padding-bottom 0.25s ease; }\nbody.selecting footer { opacity: 0; pointer-events: none; transform: translateY(20px); transition: opacity 0.25s, transform 0.25s; }`,
  `body.selecting .chat-messages { padding-bottom: 100px; }\nbody.selecting footer { opacity: 0; pointer-events: none; transform: translateY(20px); }`
);

// Image preview
ours = ours.replace(
  `.image-preview {\n  display: none; padding: 8px 16px 0 16px;\n  flex-shrink: 0; gap: 8px; flex-wrap: wrap;\n}\n.image-preview.show { display: flex; }`,
  `.image-preview {\n  display: none; padding: 6px 24px 0 24px;\n  flex-shrink: 0; gap: 8px; flex-wrap: wrap;\n}\n.image-preview.show { display: flex; }`
);

// Mobile
ours = ours.replace(
  '  .chat-input { font-size: 15px; padding: 10px 14px; min-height: 42px; }\n  .send-btn { width: 42px; height: 42px; min-width: 42px; }\n  .image-btn { width: 42px; height: 42px; min-width: 42px; font-size: 20px; }\n  .scroll-bottom-btn { bottom: 80px; right: 12px; width: 36px; height: 36px; }\n  .image-preview { padding: 6px 10px 0 10px; }',
  '  .chat-input { font-size: 15px; }\n  .send-btn { width: 40px; height: 40px; min-width: 40px; }\n  .image-btn { width: 26px; height: 26px; }\n  .scroll-bottom-btn { bottom: 80px; right: 16px; width: 32px; height: 32px; }\n  .image-preview { padding: 6px 16px 0 16px; }'
);

console.log('OK: misc tweaks');

// ============================================================
// Save
// ============================================================
fs.writeFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css', ours, 'utf8');
console.log('DONE - CSS merged successfully');
