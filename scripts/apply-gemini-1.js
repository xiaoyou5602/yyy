const fs=require('fs');

// Read Gemini CSS
const geminiCSS = fs.readFileSync('C:/Users/youzi/Desktop/克聊天页面.html','utf8');
const styleMatch = geminiCSS.match(/<style>([\s\S]*?)<\/style>/);
if(!styleMatch){console.log('No style found');process.exit(1);}
const gcss = styleMatch[1];

// Our current main.css
let ours = fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css','utf8');

// ============================================
// CLASS NAME MAP: Gemini → Ours
// ============================================
const map = {
  // Layout
  '.app-container': '#chat-page',
  '.header-component': 'header',
  '.chat-flow-component': '.chat-messages',
  '.footer-input-component': 'footer',

  // Header
  '.icon-btn': '#menu-btn, #search-btn, #settings-btn',
  '.header-left': '.header-left',  // not used in ours
  '.header-right': '.header-right', // not used
  '.avatar-group': null, // Gemini-specific, skip
  '.avatar-item': null,
  '.avatar-ai': null,
  '.avatar-user': null,
  '.status-meta': null,
  '.status-title-row': null,
  '.status-title': 'header h1',
  '.header-shell-svg': null,
  '.status-indicator': '.status-wrap',
  '.status-dot': '#status-dot',
  '.status-text': '#status-text',

  // Thinking
  '.thinking-wrapper': '.thinking-inline',
  '.thinking-avatar': null, // Gemini adds heart avatar, we don't have it
  '.thinking-component': null, // merged into thinking-inline
  '.thinking-trigger': '.thinking-inline-header',
  '.thinking-arrow': '.thinking-inline-arrow',
  '.thinking-content': '.thinking-inline-body',
  '.thinking-inner': '.thinking-inner',
  '.thinking-component.collapsed .thinking-arrow': '.thinking-inline-body.thinking-collapsed',

  // Messages
  '.message-group-wrapper': '.msg',
  '.message-group-wrapper.ai': '.msg.ke',
  '.message-group-wrapper.user': '.msg.you',
  '.message-bubble': '.msg.you, .msg.ke .msg-bubble',
  '.message-group-wrapper.ai .message-bubble': '.msg.ke .msg-bubble',
  '.message-group-wrapper.user .message-bubble': '.msg.you',
  '.message-group-wrapper.ai .message-bubble:not(:first-child)': '.msg.ke .msg-bubble + .msg-bubble',
  '.message-group-wrapper.user .message-bubble:not(:first-child)': '.msg.you + .msg.you',
  '.message-timestamp': '.msg .time',

  // Input
  '.input-container-inner': '.input-container-inner',
  '.chat-textarea-small': '.chat-input',
  '.embedded-plus-btn': '.image-btn',
  '.send-message-btn': '.send-btn',
};

console.log('Gemini CSS rules:', (gcss.match(/\}/g)||[]).length);
console.log('Mapping table ready - manual conversion approach');

// Instead of automatic mapping, let's do surgical replacements
// Step 1: Replace :root variables with Gemini values (DS only)

const oldRoot = ours.match(/:root \{[\s\S]*?\n\}/);
if(oldRoot){
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
  console.log('Step 1 OK - root variables');
}

// Step 2: Replace model-deepseek theme (keep opus/haiku unchanged)
const oldDS = ours.match(/:root, \.model-deepseek \{[\s\S]*?\n\}/);
if(oldDS){
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
  console.log('Step 2 OK - DS theme');
}

console.log('Writing merged CSS...');
fs.writeFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css', ours, 'utf8');
console.log('DONE - root + DS theme variables updated');
