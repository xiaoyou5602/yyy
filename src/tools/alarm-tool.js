/**
 * Alarm CLI tool — parse Chinese natural language and send alarm to phone.
 * Usage: node alarm-tool.js "明天11点叫我起床"
 */
const { parse } = require("../services/alarm-parser");
const { sendAlarm, setPhoneIp } = require("../services/alarm-client");
const path = require("path");
const fs = require("fs");

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.log(JSON.stringify({ error: "用法: node alarm-tool.js \"明天11点叫我\"" }));
    process.exit(1);
  }

  // Load phone IP from .env
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^CYBERBOSS_ALARM_PHONE_IP=(.+)/);
      if (m) setPhoneIp(m[1].trim());
    }
  }

  const parsed = parse(input);
  if (parsed.error) {
    console.log(JSON.stringify({ error: parsed.error }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    parsed: { hour: parsed.hour, minute: parsed.minute, msg: parsed.msg, date: parsed.date },
    sending: true,
  }));

  const result = await sendAlarm({ hour: parsed.hour, minute: parsed.minute, msg: parsed.msg });
  console.log(JSON.stringify({ result }));
  process.exit(result.ok ? 0 : 1);
}

main();
