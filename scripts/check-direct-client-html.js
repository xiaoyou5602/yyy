const fs = require("fs");
const path = require("path");

const htmlPath = path.resolve(__dirname, "..", "src", "adapters", "channel", "direct", "client", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];

let failed = false;
for (let index = 0; index < scripts.length; index += 1) {
  const source = scripts[index][1] || "";
  if (!source.trim()) continue;
  try {
    new Function(source);
  } catch (error) {
    failed = true;
    console.error(`[check-direct-client-html] inline script #${index + 1} failed: ${error.message}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
