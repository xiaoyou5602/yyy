const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { CheckinConfigStore, resolveDefaultCheckinRange } = require("../core/checkin-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "%USER% comes to mind again.";

async function runSystemCheckinPoller(config, channelAdapter = null) {
  const account = channelAdapter ? channelAdapter.resolveAccount() : resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const checkinConfigStore = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const defaultRange = resolveDefaultCheckinRange();

  // ── Machine-level singleton lock ──
  const lockPath = path.join(path.dirname(config.checkinConfigFile), "checkin-poller.lock");
  if (!acquireLock(lockPath)) {
    return; // another poller already running
  }
  const release = () => releaseLock(lockPath);
  process.on("exit", release);
  process.on("SIGTERM", release);
  process.on("SIGINT", release);

  let currentRange = checkinConfigStore.getRange(defaultRange);
  let lastHeartbeat = Date.now();

  console.log(`[cyberboss] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[cyberboss] checkin interval range ${formatRangeMinutes(currentRange)}`);

  while (true) {
    currentRange = checkinConfigStore.getRange(defaultRange);
    const delayMs = pickRandomDelayMs(currentRange.minIntervalMs, currentRange.maxIntervalMs);
    const wakeAt = formatLocalTime(Date.now() + delayMs);
    console.log(`[cyberboss] next checkin in ${Math.round(delayMs / 60000)}m at ${wakeAt}`);
    await sleep(delayMs);

    if (queue.hasPendingForAccount(account.accountId)) {
      console.log("[cyberboss] checkin skipped: pending system message still in queue");
      continue;
    }

    // Refresh heartbeat so stale-lock detection has a fresh timestamp
    refreshHeartbeat(lockPath);
    lastHeartbeat = Date.now();

    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId: target.senderId,
      workspaceRoot: target.workspaceRoot,
      text: buildCheckinTrigger(config),
      createdAt: new Date().toISOString(),
    });
    console.log(`[cyberboss] checkin queued id=${queued.id}`);
  }
}

// ── Lock helpers ──

function acquireLock(lockPath) {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      heartbeat: new Date().toISOString(),
    }, null, 2), { flag: "wx" });
    console.log(`[checkin-poller] acquired lock pid=${process.pid}`);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    // Lock exists — check if holder is alive
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      const lock = JSON.parse(raw);
      try {
        process.kill(lock.pid, 0);
        // PID is alive → another poller is running
        console.log(`[checkin-poller] skipped, already running pid=${lock.pid}`);
        return false;
      } catch (_dead) {
        // PID is dead → stale lock
        console.log(`[checkin-poller] stale lock detected (pid=${lock.pid} dead), recovering`);
        fs.unlinkSync(lockPath);
        return acquireLock(lockPath);
      }
    } catch (_parseErr) {
      // Corrupted lock file
      console.log("[checkin-poller] corrupted lock file, recovering");
      try { fs.unlinkSync(lockPath); } catch (_) {}
      return acquireLock(lockPath);
    }
  }
}

function refreshHeartbeat(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const lock = JSON.parse(raw);
    if (lock.pid !== process.pid) return;
    lock.heartbeat = new Date().toISOString();
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  } catch (_) {
    // best effort
  }
}

function releaseLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const lock = JSON.parse(raw);
    if (lock.pid === process.pid) {
      fs.unlinkSync(lockPath);
      console.log(`[checkin-poller] released lock pid=${process.pid}`);
    }
  } catch (_) {
    // already gone or not ours
  }
}

// ── Existing helpers (unchanged) ──

function resolvePollerTarget({ config, account, sessionStore }) {
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: process.env.CYBERBOSS_CHECKIN_USER_ID || "",
    sessionStore,
  });
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: process.env.CYBERBOSS_CHECKIN_WORKSPACE || "",
    sessionStore,
  });

  if (!senderId) {
    throw new Error("Cannot determine the WeChat user for the checkin poller. Set CYBERBOSS_CHECKIN_USER_ID or let the only active user talk to the bot once first.");
  }
  if (!workspaceRoot) {
    throw new Error("Cannot determine the workspace for the checkin poller. Set CYBERBOSS_WORKSPACE_ROOT first.");
  }

  return { senderId, workspaceRoot };
}

function pickRandomDelayMs(minIntervalMs, maxIntervalMs) {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function formatRangeMinutes(range) {
  return `${Math.round(range.minIntervalMs / 60000)}m-${Math.round(range.maxIntervalMs / 60000)}m`;
}

function buildCheckinTrigger(config) {
  const userName = normalizeText(config?.userName) || "the user";
  return INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%USER%", userName);
}

module.exports = { runSystemCheckinPoller };
