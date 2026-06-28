const fs=require('fs');
const p='C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css';
let css=fs.readFileSync(p,'utf8');

// 11. Update message bubbles - user
css = css.replace(
  '.msg.you {\n  align-self: flex-end; width: fit-content;\n  background: var(--model-bubble-you, var(--bubble-you)); color: var(--model-bubble-you-text, var(--bubble-you-text));\n  border-bottom-right-radius: 6px;\n  box-shadow: var(--shadow-xs);\n}',
  '.msg.you {\n  align-self: flex-end; width: fit-content;\n  background: var(--model-bubble-you, var(--bubble-you)); color: var(--model-bubble-you-text, var(--bubble-you-text));\n  border: 1px solid rgba(89,137,185,0.12);\n  border-radius: 16px 4px 16px 16px;\n  box-shadow: none;\n  padding: 11px 15px;\n  line-height: 1.55;\n}'
);

// 12. Update ke bubble
css = css.replace(
  '.msg.ke .msg-bubble {\n  width: fit-content; max-width: 100%;\n  background: var(--bubble-ke); color: var(--bubble-ke-text);\n  padding: 9px 14px; border-radius: var(--radius);\n  border-bottom-left-radius: 6px;\n  box-shadow: var(--shadow-xs);\n}',
  '.msg.ke .msg-bubble {\n  width: fit-content; max-width: 100%;\n  background: var(--bubble-ke); color: var(--bubble-ke-text);\n  padding: 11px 15px; border-radius: 4px 16px 16px 16px;\n  border: 1px solid var(--border);\n  box-shadow: var(--shadow-sm);\n  line-height: 1.55;\n}'
);

// 13. Update msg base
css = css.replace(
  '.msg {\n  max-width: var(--bubble-max-w); padding: 9px 14px;\n  border-radius: var(--radius);\n  line-height: 1.25; font-size: var(--msg-font-size);\n  word-break: break-word;\n  animation: rise 0.22s ease;\n}',
  '.msg {\n  max-width: var(--bubble-max-w); padding: 0;\n  line-height: 1.55; font-size: var(--msg-font-size);\n  word-break: break-word;\n  animation: rise 0.22s ease;\n}'
);

// 14. Update msg.ke container
css = css.replace(
  '.msg.ke { background: transparent; box-shadow: none; padding: 0; }',
  '.msg.ke { background: transparent; box-shadow: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }'
);

// 15. Update time
css = css.replace(
  '.msg .time {\n  font-size: 10.5px; color: rgba(255,255,255,0.6); margin-top: 4px; text-align: right;\n}\n.msg.ke .time { color: #b0b0b6; }',
  '.msg .time {\n  font-size: 10px; color: rgba(45,45,45,0.3); margin-top: 2px; padding: 0 4px;\n}\n.msg.ke .time { color: rgba(45,45,45,0.3); }'
);

// 16. Update thinking-inline container
css = css.replace(
  '.thinking-inline {\n  margin: 0 0 3px 0;\n}',
  '.thinking-inline {\n  display: flex; align-items: flex-start; gap: 10px;\n  margin-top: 6px; margin-bottom: -4px;\n  width: 100%;\n}'
);

// 17. Update thinking-header
css = css.replace(
  '.thinking-inline-header {\n  font-size: 11px;\n  color: #a0a0a0;\n  cursor: pointer;\n  user-select: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n}\n\n.thinking-inline-header:hover { color: #666; }',
  '.thinking-inline-header {\n  display: inline-flex; align-items: center; gap: 6px;\n  cursor: pointer; user-select: none;\n  color: var(--model-accent, #5989b9);\n  font-size: 11.5px; font-weight: 600; letter-spacing: 0.3px;\n}\n\n.thinking-inline-header:hover { opacity: 0.8; }'
);

// 18. Update thinking-arrow
css = css.replace(
  '.thinking-inline-arrow {\n  font-size: 8px;\n  color: #bbb;\n  min-width: 8px;\n}',
  '.thinking-inline-arrow {\n  font-size: 8px;\n  min-width: 8px;\n  transition: transform 0.3s cubic-bezier(0.43,0.15,0.02,1.05);\n  display: inline-block;\n}'
);

// 19. Update thinking-body
css = css.replace(
  '.thinking-inline-body {\n  font-size: 12px;\n  color: #8e8e93;\n  line-height: 1.3;\n  white-space: pre-wrap;\n  word-break: break-word;\n  padding: 3px 0 0 0;\n  opacity: 0.85;\n  max-height: 200px;\n  overflow-y: auto;\n}\n\n.thinking-inline-body.thinking-collapsed { display: none; }',
  '.thinking-inline-body {\n  font-size: 12.5px;\n  color: rgba(45,45,45,0.45);\n  line-height: 1.55;\n  white-space: pre-wrap;\n  word-break: break-word;\n  padding-top: 5px;\n  max-height: 200px;\n  overflow-y: auto;\n  opacity: 1;\n}\n\n.thinking-inline-body.thinking-collapsed { display: none; }'
);

// 20. Update footer
css = css.replace(
  'footer {\n  padding: 0 12px calc(var(--footer-pb) + env(safe-area-inset-bottom));\n  background: transparent; border: none;\n  flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end;\n  transition: opacity 0.25s, transform 0.25s;\n}',
  'footer {\n  padding: 12px 24px calc(var(--footer-pb) + env(safe-area-inset-bottom)) 24px;\n  background: var(--surface); border: none;\n  border-top: 1px solid var(--border);\n  flex-shrink: 0; display: flex; gap: 10px; align-items: flex-end;\n  transition: opacity 0.25s, transform 0.25s;\n}'
);

// 21. Update input
css = css.replace(
  '.chat-input {\n  flex: 1; resize: none; min-height: var(--input-min-h); max-height: 120px;\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius-full);\n  padding: 11px 20px;\n  font-size: 14px; font-family: var(--font-body); color: var(--text);\n  outline: none; line-height: 1.5;\n  box-shadow: var(--shadow-xs);\n  transition: border-color 0.2s, box-shadow 0.2s;\n}',
  '.chat-input {\n  flex: 1; resize: none; height: 24px; min-height: 24px; max-height: 120px;\n  background: transparent;\n  border: none;\n  outline: none;\n  padding: 0;\n  font-size: 14.5px; font-family: var(--font-body); color: var(--text);\n  line-height: 24px;\n  overflow-y: auto;\n  white-space: pre-wrap;\n  word-break: break-all;\n}'
);

// 22. Update input focus
css = css.replace(
  '.chat-input:focus {\n  border-color: var(--model-input-focus, var(--accent));\n  box-shadow: 0 0 0 4px var(--model-input-focus-ring, var(--accent-soft));\n}',
  '.chat-input:focus { outline: none; }'
);

// 23. Update placeholder
css = css.replace(
  '.chat-input::placeholder { color: var(--text-subtle); }',
  '.chat-input::placeholder { color: rgba(45,45,45,0.35); }'
);

// 24. Update image-btn
css = css.replace(
  '.image-btn {\n  height: 48px; min-width: 48px; border: 1px solid var(--border); border-radius: 50%;\n  background: var(--surface); color: var(--text-muted); cursor: pointer;\n  flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: var(--shadow-xs);\n  font-size: 22px;\n  transition: color 0.15s, background 0.15s, border-color 0.15s;\n}\n.image-btn:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }',
  '.image-btn {\n  position: absolute; right: 8px; bottom: 7px;\n  width: 26px; height: 26px; border: none; border-radius: 50%;\n  background: transparent; color: rgba(45,45,45,0.3); cursor: pointer;\n  flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  font-size: 16px;\n  transition: transform 0.2s, opacity 0.2s;\n}\n.image-btn:active { transform: scale(0.9); opacity: 0.8; }'
);

// 25. Update send-btn
css = css.replace(
  '.send-btn {\n  height: var(--send-btn-size); min-width: var(--send-btn-size); border: none; border-radius: 50%;\n  background: var(--model-accent, var(--accent)); color: #fff;\n  cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: var(--shadow-sm);\n  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;\n}\n.send-btn:hover { background: var(--model-accent-hover, #d44d31); box-shadow: var(--shadow-md); transform: scale(1.06); }\n.send-btn:active { transform: scale(0.94); transition: transform 0.05s; }\n.send-btn:disabled { background: #e0ddd6; color: var(--text-subtle); box-shadow: none; cursor: default; transform: none; }',
  '.send-btn {\n  width: 40px; height: 40px; min-width: 40px; border: none; border-radius: 50%;\n  background: var(--model-accent, #5989b9); color: #fff;\n  cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;\n  box-shadow: 0 4px 10px rgba(89,137,185,0.12);\n  transition: transform 0.2s, background-color 0.2s;\n}\n.send-btn:active { transform: scale(0.92); background: var(--model-accent-hover, #467099); }\n.send-btn:disabled { background: rgba(45,45,45,0.1); color: rgba(45,45,45,0.3); box-shadow: none; cursor: default; transform: none; }'
);

// 26. Update body.selecting
css = css.replace(
  'body.selecting .chat-messages { padding-bottom: 100px; transition: padding-bottom 0.25s ease; }\nbody.selecting footer { opacity: 0; pointer-events: none; transform: translateY(20px); transition: opacity 0.25s, transform 0.25s; }',
  'body.selecting .chat-messages { padding-bottom: 100px; }\nbody.selecting footer { opacity: 0; pointer-events: none; transform: translateY(20px); }'
);

// 27. Update status-dot
css = css.replace(
  '#status-dot {\n  width: 7px; height: 7px; border-radius: 50%;\n  background: #ccc; flex-shrink: 0; transition: background 0.3s;\n}',
  '#status-dot {\n  width: 5px; height: 5px; border-radius: 50%;\n  background: #ccc; flex-shrink: 0; transition: background 0.3s;\n}'
);

css = css.replace(
  '#status-dot.on { background: var(--model-status-color, #5eea8b); box-shadow: 0 0 0 0 var(--model-status-color, rgba(94,234,139,0.5)); animation: status-pulse 2s ease-in-out infinite; }',
  '#status-dot.on { background: var(--model-status-color, #46a07b); box-shadow: 0 0 6px rgba(70,160,123,0.2); animation: none; }'
);

// 28. Update scrollbar
css = css.replace(
  '.chat-messages::-webkit-scrollbar, #memory-content::-webkit-scrollbar, .calendar-day-panel::-webkit-scrollbar { width: 5px; }',
  '.chat-messages::-webkit-scrollbar, #memory-content::-webkit-scrollbar, .calendar-day-panel::-webkit-scrollbar { width: 4px; }'
);

css = css.replace(
  '.chat-messages::-webkit-scrollbar-thumb, #memory-content::-webkit-scrollbar-thumb, .calendar-day-panel::-webkit-scrollbar-thumb { background: #ddd; border-radius: 10px; }',
  '.chat-messages::-webkit-scrollbar-thumb, #memory-content::-webkit-scrollbar-thumb, .calendar-day-panel::-webkit-scrollbar-thumb { background: rgba(45,45,45,0.05); border-radius: 10px; }'
);

css = css.replace(
  '.chat-messages::-webkit-scrollbar-thumb:hover, #memory-content::-webkit-scrollbar-thumb:hover, .calendar-day-panel::-webkit-scrollbar-thumb:hover { background: #ccc; }',
  '.chat-messages::-webkit-scrollbar-thumb:hover, #memory-content::-webkit-scrollbar-thumb:hover, .calendar-day-panel::-webkit-scrollbar-thumb:hover { background: rgba(45,45,45,0.12); }'
);

console.log('All steps OK');
fs.writeFileSync(p, css, 'utf8');
console.log('DONE - CSS merged');
