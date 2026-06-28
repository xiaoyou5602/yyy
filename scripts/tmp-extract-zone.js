const fs=require('fs');
const html=fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/index.html','utf8');

const idx=html.indexOf('<div class="chat-zone" id="chat-zone-ds"');
let depth=0, end=idx;
for(let i=idx;i<html.length;i++){
  if(html.slice(i,i+4)==='<div')depth++;
  else if(html.slice(i,i+6)==='</div>'){depth--;if(depth===0){end=i+6;break;}}
}
const zoneHTML=html.slice(idx,end);

// Build self-contained page
const css = fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/css/main.css','utf8');

const page = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>克 - DS 聊天区</title>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n<header>\n  <button id="menu-btn">&#9776;</button>\n  <h1 id="header-title">克</h1>\n  <div class="status-wrap"><div id="status-dot"></div><span id="status-text">在线 · DeepSeek</span></div>\n  <button id="search-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>\n  <button id="settings-btn">&#9881;</button>\n</header>\n' + zoneHTML + '\n</body>\n</html>';

fs.writeFileSync('C:/Users/youzi/Desktop/克-DS聊天区.html',page,'utf8');
console.log('OK',page.length,'chars');
