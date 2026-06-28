const fs=require('fs');
let css=fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css','utf8');

// ===== 1. NUKE duplicate .avatar-sm that overrides display:none =====
// Find the second .avatar-sm block (the one WITH width/display:flex)
const avLines = [];
let inAv = false, avDepth = 0;
for (const line of css.split('\n')) {
  if (line.match(/^\.avatar-sm \{/) && line.includes('width')) { inAv = true; }
  if (inAv) {
    avDepth += (line.match(/\{/g)||[]).length;
    avDepth -= (line.match(/\}/g)||[]).length;
    if (avDepth <= 0 && line.includes('}')) { inAv = false; continue; }
    continue; // skip this line
  }
  avLines.push(line);
}
css = avLines.join('\n');
console.log('1. Nuked duplicate .avatar-sm');

// ===== 2. FIX .msg.ke .msg-bubble =====
const oldKeBubble = `.msg.ke .msg-bubble {
  width: fit-content; max-width: 100%;
  background: var(--bubble-ke); color: var(--bubble-ke-text);
  padding: 9px 14px; border-radius: var(--radius);
  border-bottom-left-radius: 6px;
  box-shadow: var(--shadow-xs);
}`;
const newKeBubble = `.msg.ke .msg-bubble {
  width: fit-content; max-width: 100%;
  background: #fafaf7; color: #2d2d2d;
  padding: 11px 15px; border-radius: 4px 16px 16px 16px;
  border: 1px solid rgba(45,45,45,0.06);
  box-shadow: 0 4px 12px rgba(0,0,0,0.005);
  font-size: 14.5px; line-height: 1.55;
}`;
if (css.includes(oldKeBubble)) {
  css = css.replace(oldKeBubble, newKeBubble);
  console.log('2. Fixed ke bubble');
} else console.log('2. ke bubble NOT FOUND');

// ===== 3. FIX .msg.you =====
const oldYouBubble = `.msg.you {
  align-self: flex-end; width: fit-content;
  background: var(--model-bubble-you, var(--bubble-you)); color: var(--model-bubble-you-text, var(--bubble-you-text));
  border-bottom-right-radius: 6px;
  box-shadow: var(--shadow-xs);
}`;
const newYouBubble = `.msg.you {
  align-self: flex-end; width: fit-content;
  background: rgba(89,137,185,0.04); color: #2d2d2d;
  border: 1px solid rgba(89,137,185,0.12);
  border-radius: 16px 4px 16px 16px;
  box-shadow: none;
  padding: 11px 15px;
  font-size: 14.5px; line-height: 1.55;
}`;
if (css.includes(oldYouBubble)) {
  css = css.replace(oldYouBubble, newYouBubble);
  console.log('3. Fixed you bubble');
} else console.log('3. you bubble NOT FOUND');

// ===== 4. FIX footer =====
const oldFooter = `footer {
  padding: 0 12px calc(var(--footer-pb) + env(safe-area-inset-bottom));
  background: transparent; border: none;
  flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end;
  transition: opacity 0.25s, transform 0.25s;
}`;
const newFooter = `footer {
  padding: 12px 24px calc(16px + env(safe-area-inset-bottom)) 24px;
  background: #fafaf7; border: none;
  border-top: 1px solid rgba(45,45,45,0.06);
  flex-shrink: 0; display: flex; gap: 10px; align-items: flex-end;
  transition: opacity 0.25s, transform 0.25s;
}`;
if (css.includes(oldFooter)) {
  css = css.replace(oldFooter, newFooter);
  console.log('4. Fixed footer');
} else console.log('4. footer NOT FOUND');

// ===== 5. FIX .chat-messages padding =====
const oldMsgs = `.chat-messages {
  flex: 1; overflow-y: auto; padding: 20px var(--msg-padding-x);
  display: flex; flex-direction: column; gap: var(--msg-gap);
  scroll-behavior: smooth;
  overscroll-behavior: contain;
  touch-action: pan-y;
  transition: padding-bottom 0.25s ease;
}`;
const newMsgs = `.chat-messages {
  flex: 1; overflow-y: auto; padding: 10px 24px;
  display: flex; flex-direction: column; gap: 16px;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
  touch-action: pan-y;
  transition: padding-bottom 0.25s ease;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}`;
if (css.includes(oldMsgs)) {
  css = css.replace(oldMsgs, newMsgs);
  console.log('5. Fixed messages');
} else console.log('5. messages NOT FOUND');

// ===== 6. FIX .msg base =====
const oldMsg = `.msg {
  max-width: var(--bubble-max-w); padding: 9px 14px;
  border-radius: var(--radius);
  line-height: 1.25; font-size: var(--msg-font-size);
  word-break: break-word;
  animation: rise 0.22s ease;
}`;
const newMsg = `.msg {
  max-width: var(--bubble-max-w); padding: 0;
  line-height: 1.55; font-size: var(--msg-font-size);
  word-break: break-word;
  animation: rise 0.22s ease;
}`;
if (css.includes(oldMsg)) {
  css = css.replace(oldMsg, newMsg);
  console.log('6. Fixed msg base');
} else console.log('6. msg NOT FOUND');

// ===== 7. FIX .chat-input =====
const oldInput = `.chat-input {
  flex: 1; resize: none; min-height: var(--input-min-h); max-height: 120px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  padding: 11px 20px;
  font-size: 14px; font-family: var(--font-body); color: var(--text);
  outline: none; line-height: 1.5;
  box-shadow: var(--shadow-xs);
  transition: border-color 0.2s, box-shadow 0.2s;
}`;
const newInput = `.chat-input {
  flex: 1; resize: none; height: 24px; min-height: 24px; max-height: 120px;
  background: transparent; border: none; outline: none;
  padding: 0;
  font-size: 14.5px; font-family: var(--font-body); color: var(--text);
  line-height: 24px;
  overflow-y: auto; white-space: pre-wrap; word-break: break-all;
}`;
if (css.includes(oldInput)) {
  css = css.replace(oldInput, newInput);
  console.log('7. Fixed input');
} else console.log('7. input NOT FOUND - searching...');
// Try alternative match
const altInput = css.match(/\.chat-input \{[\s\S]*?\n\}/);
if (altInput && !css.includes(newInput)) {
  console.log('  Found alt:', altInput[0].slice(0,80));
}

// ===== 8. Remove old avatar rule =====
const oldAvatar = `.avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: #fff;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; filter: brightness(1.15) saturate(1.4); }
.avatar svg { width: 20px; height: 20px; display: block; }`;
if (css.includes(oldAvatar)) {
  css = css.replace(oldAvatar, '.avatar { display: none; }');
  console.log('8. Nuked old .avatar');
} else console.log('8. old avatar NOT FOUND');

fs.writeFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css',css,'utf8');
console.log('\nDONE - all fixes written');
