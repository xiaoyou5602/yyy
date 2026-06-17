// Cyberboss 多模型 API 反代 — 每模型独立端口，无路径前缀
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const http = require("http");
const https = require("https");
const { URL } = require("url");

const ROUTES = {
  19081: {  // Opus → 55api
    upstream: process.env.CYBERBOSS_55API_ENDPOINT || "http://156.233.228.80:3000",
    key: process.env.CYBERBOSS_55API_KEY || "",
    apiModel: "[A-按量]claude-opus-4-6",
    label: "opus",
  },
  19082: {  // DS → DeepSeek
    upstream: process.env.CYBERBOSS_DEEPSEEK_ENDPOINT || "https://api.deepseek.com/anthropic",
    key: process.env.CYBERBOSS_DEEPSEEK_KEY || "",
    apiModel: "deepseek-v4-pro",
    label: "ds",
  },
};

function handleRequest(req, res, route) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    console.log("\n>>> [%s] %s %s  -> %s", route.label, req.method, req.url, route.upstream);

    if (body) {
      try {
        const j = JSON.parse(body);
        console.log("    incoming model:", j.model);
        if (j.model) {
          j.model = route.apiModel;
          body = JSON.stringify(j);
        }
        console.log("    rewritten to  :", route.apiModel);
      } catch {
        /* 非 JSON（探活等）原样转发 */
      }
    }

    // 非 POST 请求（探活/健康检查）由反代本地响应，带 Anthropic 兼容头
    if (req.method !== "POST") {
      console.log("    ← local 200 (health check)");
      res.writeHead(200, {
        "content-type": "application/json",
        "x-api-version": "2023-06-01",
      });
      return res.end("{}");
    }

    const rest = req.url;
    const up = new URL(route.upstream + rest);
    const lib = up.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: up.host };
    delete headers["authorization"];
    delete headers["x-api-key"];
    headers["authorization"] = "Bearer " + route.key;
    headers["x-api-key"] = route.key;
    if (body) headers["content-length"] = Buffer.byteLength(body);

    const upReq = lib.request(
      up,
      { method: req.method, headers, rejectUnauthorized: false },
      (upRes) => {
        console.log("    <<< upstream %d", upRes.statusCode);
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      }
    );
    upReq.on("error", (e) => {
      console.log("    !!! upstream error:", e.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end(e.message);
      }
    });
    if (body) upReq.write(body);
    upReq.end();
  });
}

for (const [port, route] of Object.entries(ROUTES)) {
  const srv = http.createServer((req, res) => handleRequest(req, res, route));
  srv.on("error", (e) => {
    console.error("cyberboss-proxy :%s FAILED: %s", port, e.message);
    process.exit(1);
  });
  srv.listen(parseInt(port), "127.0.0.1", () => {
    console.log("cyberboss-proxy :%s (%s) → %s (model: %s)", port, route.label, route.upstream, route.apiModel);
  });
}
