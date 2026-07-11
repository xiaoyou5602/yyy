// VPS 桥：给橘瓣 Rism 插件的运维入口（/api/bridge/*）
// 鉴权：Authorization: Bearer <CYBERBOSS_BRIDGE_TOKEN>（.env 配置，未配置则全部 503）
// 调用方是 QuickJS 沙箱的同步 fetch（15s 超时），所有响应必须快速返回
const crypto = require("crypto");
const { execFile } = require("child_process");

const ALLOWED_SERVICES = ["cyberboss", "cloudflared"];

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function checkAuth(req, res) {
  const token = (process.env.CYBERBOSS_BRIDGE_TOKEN || "").trim();
  if (!token) {
    sendJson(res, 503, { error: "bridge disabled: CYBERBOSS_BRIDGE_TOKEN not set" });
    return false;
  }
  const header = String(req.headers["authorization"] || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !timingSafeEqualStr(provided, token)) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

function pickService(name) {
  const service = String(name || "cyberboss").trim();
  return ALLOWED_SERVICES.includes(service) ? service : null;
}

// systemctl is-active 对 inactive 服务 exit code 非 0，输出仍有用，所以不看 err 只看 stdout
function serviceState(service) {
  return new Promise((resolve) => {
    execFile("systemctl", ["is-active", service], { timeout: 5000 }, (err, stdout) => {
      resolve({ service, state: String(stdout || "").trim() || "unknown" });
    });
  });
}

function handleStatus(res) {
  Promise.all(ALLOWED_SERVICES.map(serviceState)).then((services) => {
    sendJson(res, 200, {
      services,
      uptime_sec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    });
  });
}

function handleRestart(req, res) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    let service = "cyberboss";
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.service) service = body.service;
    } catch {
      // body 不是 JSON 就用默认 service
    }
    const target = pickService(service);
    if (!target) {
      sendJson(res, 400, { error: `service must be one of: ${ALLOWED_SERVICES.join(", ")}` });
      return;
    }
    // 先响应再重启：restart cyberboss 会杀掉自己，响应必须先出门
    sendJson(res, 202, { ok: true, restarting: target });
    setTimeout(() => {
      execFile("systemctl", ["restart", target], { timeout: 30000 }, (err) => {
        if (err) console.error(`[bridge] restart ${target} failed:`, err.message);
      });
    }, 500);
  });
}

function handleLogs(res, query) {
  const target = pickService(query.service);
  if (!target) {
    sendJson(res, 400, { error: `service must be one of: ${ALLOWED_SERVICES.join(", ")}` });
    return;
  }
  const lines = Math.min(Math.max(Number.parseInt(query.lines, 10) || 50, 1), 200);
  execFile(
    "journalctl",
    ["-u", target, "-n", String(lines), "--no-pager", "-o", "short-iso"],
    { timeout: 10000, maxBuffer: 1024 * 1024 },
    (err, stdout, stderr) => {
      if (err) {
        sendJson(res, 500, { error: err.message, stderr: String(stderr || "").slice(0, 500) });
        return;
      }
      // QuickJS 端 15s 超时 + token 成本，日志只回尾部精华
      sendJson(res, 200, { service: target, lines, logs: String(stdout || "").slice(-20000) });
    }
  );
}

// 返回 true 表示该请求已被桥接管，调用方直接 return
function handleBridgeRequest(req, res, urlPath, query) {
  if (!urlPath.startsWith("/api/bridge/")) return false;
  if (!checkAuth(req, res)) return true;

  if (urlPath === "/api/bridge/status" && req.method === "GET") {
    handleStatus(res);
    return true;
  }
  if (urlPath === "/api/bridge/restart" && req.method === "POST") {
    handleRestart(req, res);
    return true;
  }
  if (urlPath === "/api/bridge/logs" && req.method === "GET") {
    handleLogs(res, query || {});
    return true;
  }
  sendJson(res, 404, { error: "unknown bridge endpoint" });
  return true;
}

module.exports = { handleBridgeRequest };
