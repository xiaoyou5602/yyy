// Generic external CLI runtime adapter — wraps OpenClaw, Codex, etc.
// Configured via CYBERBOSS_EXTERNAL_CLI_CONFIG in .env:
//   JSON: { "openclaw": { "command": "openclaw", "env": { "OPENCLAW_API_KEY": "..." } }, ... }

const path = require("path");
const os = require("os");
const { ClaudeCodeProcessClient } = require("../claudecode/process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("../claudecode/events");
const { SessionStore } = require("../codex/session-store");
const { resolveModelKey } = require("../../../core/config");

const RESUME_TIMEOUT_MS = 8000;

function createExternalCliRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "external-cli" });
  const sessionsByWorkspace = new Map();
  const pendingApprovals = new Map();
  let globalListener = null;

  // Parse CLI config from env
  let cliConfigs = {};
  try {
    cliConfigs = JSON.parse(process.env.CYBERBOSS_EXTERNAL_CLI_CONFIG || "{}");
  } catch { /* empty */ }

  function resolveCliConfig(model = "") {
    const key = resolveModelKey(model);
    return cliConfigs[key] || null;
  }

  function toModelKey(model) { return resolveModelKey(model); }
  function modelRuntimeId(modelKey) { return "external-cli:" + modelKey; }

  function makeSessionEntry(client) {
    return { client, threadId: "", sessionId: "", createdAt: Date.now(), lastActiveAt: Date.now(), alive: true };
  }

  function findActiveEntry(workspaceRoot, modelKey = "") {
    const perModel = sessionsByWorkspace.get(workspaceRoot);
    if (!perModel) return null;
    if (modelKey) {
      const entry = perModel.get(modelKey);
      if (entry?.alive && entry.client?.alive) return entry;
      return null;
    }
    for (const entry of perModel.values()) {
      if (entry.alive && entry.client?.alive) return entry;
    }
    return null;
  }

  async function ensureClient(workspaceRoot, model = "", reason = "user_message") {
    const modelKey = toModelKey(model);
    const cfg = resolveCliConfig(model);
    if (!cfg) throw new Error(`[external-cli] No CLI config for model: ${model}`);

    let perModel = sessionsByWorkspace.get(workspaceRoot);
    if (!perModel) { perModel = new Map(); sessionsByWorkspace.set(workspaceRoot, perModel); }

    const entry = perModel.get(modelKey);
    if (entry?.alive && entry.client?.alive) { entry.lastActiveAt = Date.now(); return { entry, modelKey }; }
    if (entry && !entry.alive) perModel.delete(modelKey);

    const clientEnv = { ...process.env, ...(cfg.env || {}) };
    console.log(`[external-cli] spawn workspace=${workspaceRoot} model=${modelKey} cmd=${cfg.command}`);

    const client = new ClaudeCodeProcessClient({
      command: cfg.command,
      cwd: workspaceRoot,
      env: clientEnv,
      model: cfg.modelName || model,
      permissionMode: "default",
      extraArgs: cfg.extraArgs || [],
      workspaceRoot,
    });

    const newEntry = makeSessionEntry(client);
    client.onMessage((event, raw) => {
      if (event.type === "session.id") {
        newEntry.sessionId = event.sessionId;
        for (const binding of sessionStore.listBindings()) {
          if (binding.activeWorkspaceRoot === workspaceRoot) {
            sessionStore.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, event.sessionId, {}, modelRuntimeId(modelKey));
          }
        }
        return;
      }
      const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
      if (mapped?.payload && !mapped.payload.workspaceRoot) mapped.payload.workspaceRoot = workspaceRoot;
      if (mapped?.type === "runtime.approval.requested") {
        pendingApprovals.set(mapped.payload.requestId, { workspaceRoot, modelKey });
      }
      if (mapped?.type === "runtime.turn.failed") newEntry.alive = false;
      if (mapped && globalListener) globalListener(mapped, raw);
    });

    perModel.set(modelKey, newEntry);
    return { entry: newEntry, modelKey };
  }

  // ── Public interface ──

  return {
    describe() { return { id: "external-cli", kind: "runtime", models: Object.keys(cliConfigs) }; },
    onEvent(listener) {
      globalListener = listener;
      return () => { if (globalListener === listener) globalListener = null; };
    },
    getSessionStore() { return sessionStore; },
    getTurnCapabilities() { return { nativeImageInput: false, toolImageRead: false }; },
    async initialize() { return { command: "external-cli", models: Object.keys(cliConfigs) }; },
    async close() {
      for (const perModel of sessionsByWorkspace.values()) for (const entry of perModel.values()) await entry.client.close();
      sessionsByWorkspace.clear();
    },
    cleanupDeadEntries() {
      for (const [ws, perModel] of sessionsByWorkspace.entries()) {
        for (const [mk, entry] of perModel.entries()) {
          if (!entry.client?.alive) perModel.delete(mk);
        }
        if (perModel.size === 0) sessionsByWorkspace.delete(ws);
      }
    },
    async startFreshThreadDraft({ workspaceRoot }) {
      for (const [mk, entry] of (sessionsByWorkspace.get(workspaceRoot) || new Map()).entries()) {
        await entry.client.close(); entry.alive = false;
      }
      sessionsByWorkspace.delete(workspaceRoot);
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision }) {
      const pending = pendingApprovals.get(requestId);
      if (!pending) throw new Error(`no pending approval: ${requestId}`);
      const entry = sessionsByWorkspace.get(pending.workspaceRoot)?.get(pending.modelKey);
      if (!entry?.alive) throw new Error("session expired");
      await entry.client.sendResponse(requestId, { decision });
      pendingApprovals.delete(requestId);
      return { requestId, decision };
    },
    async cancelTurn({ threadId, workspaceRoot }) {
      const perModel = workspaceRoot ? [[workspaceRoot, sessionsByWorkspace.get(workspaceRoot)]] : [...sessionsByWorkspace.entries()];
      for (const [ws, pm] of perModel) {
        if (!pm) continue;
        for (const [mk, entry] of pm.entries()) {
          if (entry.alive && entry.client?.alive && entry.client.sessionId === threadId) {
            await entry.client.close(); entry.alive = false; pm.delete(mk);
            if (pm.size === 0) sessionsByWorkspace.delete(ws);
            return { threadId };
          }
        }
      }
      return { threadId };
    },
    async resumeThread({ threadId, workspaceRoot, model = "" }) { return { threadId }; },
    async compactThread({ threadId, workspaceRoot, model = "" }) { return { threadId }; },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "" }) { return { threadId }; },
    async sendTextTurn(args) { return this.sendTurn(args); },
    async sendTurn({ bindingKey, workspaceRoot, text, model = "", provider = "" }) {
      const modelKey = toModelKey(model);
      const runtimeId = modelRuntimeId(modelKey);
      const allowSpawn = provider !== "system";

      if (!allowSpawn) {
        const entry = sessionsByWorkspace.get(workspaceRoot)?.get(modelKey);
        if (!entry?.alive || !entry.client?.alive) {
          return { threadId: "", turnId: "", skipped: true };
        }
      }

      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId);
      let entry = sessionsByWorkspace.get(workspaceRoot)?.get(modelKey);

      if (!entry?.alive || !entry.client?.alive) {
        const result = await ensureClient(workspaceRoot, model, provider === "system" ? "system_message" : "user_message");
        entry = result.entry;
      }

      const client = entry.client;
      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, client.sessionId || threadId, {}, runtimeId);
      await client.sendUserMessage({ text, threadId: client.sessionId });
      const sessionId = await client.waitForSessionId({ timeoutMs: RESUME_TIMEOUT_MS }).catch(() => client.sessionId);
      const returnedId = sessionId || client.sessionId;

      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, returnedId, {}, runtimeId);
      entry.threadId = returnedId;
      entry.sessionId = returnedId;
      entry.lastActiveAt = Date.now();

      return { threadId: returnedId, turnId: client.pendingTurnId };
    },
    getModelThreadId(bindingKey, workspaceRoot) {
      const params = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
      return sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(resolveModelKey(params.model)));
    },
    clearAllModelThreadIds(bindingKey, workspaceRoot) {
      for (const mk of Object.keys(cliConfigs)) sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(mk));
    },
    listModelThreadIds(bindingKey, workspaceRoot) {
      return Object.keys(cliConfigs).map(mk => {
        const tid = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(mk));
        return tid ? { modelKey: mk, threadId: tid } : null;
      }).filter(Boolean);
    },
    listAllWorkspaceRoots(bindingKey) {
      const roots = new Set();
      for (const mk of Object.keys(cliConfigs)) {
        for (const wr of sessionStore.listWorkspaceRoots(bindingKey, modelRuntimeId(mk))) { if (wr) roots.add(wr); }
      }
      return [...roots];
    },
    toModelKey(model) { return toModelKey(model); },
    modelRuntimeId(model) { return modelRuntimeId(toModelKey(model)); },
  };
}

module.exports = { createExternalCliRuntimeAdapter };
