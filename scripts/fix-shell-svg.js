const fs=require('fs');
let html=fs.readFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/chat-ds.html','utf8');

const svgStart=html.indexOf('<svg class="header-shell-svg"');
const svgEnd=html.indexOf('</svg>',svgStart)+6;

// Use toge's full 6-path SVG from the Gemini desktop file
const geminiFile=fs.readFileSync('C:/Users/youzi/Desktop/克聊天页面.html','utf8');
const shellMatch=geminiFile.match(/<svg class="header-shell-svg"[\s\S]*?<\/svg>/);
if(shellMatch){
  html=html.slice(0,svgStart)+shellMatch[0]+html.slice(svgEnd);
  console.log('Replaced with full shell SVG, length:',shellMatch[0].length);
} else {
  console.log('Shell SVG not found in gemini file');
}

const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
try{new Function(js);console.log('JS OK');}catch(e){console.log('JS ERROR:',e.message.slice(0,80));}

fs.writeFileSync('C:/Users/youzi/withtoge/src/adapters/channel/direct/client/chat-ds.html',html,'utf8');
