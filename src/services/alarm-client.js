const http = require("http");

let phoneIp = "192.169.0.103";
const PORT = 8765;

function setPhoneIp(ip) {
  phoneIp = ip;
}

function getPhoneIp() {
  return phoneIp;
}

/**
 * Send alarm to phone's Flask server.
 * Returns { ok, status, body }
 */
function sendAlarm({ hour, minute, msg = "闹钟" } = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      hour: String(hour ?? 0),
      minute: String(minute ?? 0),
      msg: String(msg),
    });
    const url = `http://${phoneIp}:${PORT}/alarm?${params.toString()}`;

    const req = http.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data.trim() });
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, status: 0, body: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: "请求超时（手机不在同一 WiFi 或服务未启动）" });
    });
  });
}

module.exports = { sendAlarm, setPhoneIp, getPhoneIp, PORT };
