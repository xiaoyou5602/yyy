const fs = require("fs");
const path = require("path");
const os = require("os");
const { ClaudeCodeProcessClient } = require("./process-client");
const { mapClaudeCodeMessageToRuntimeEvent } = require("./events");
const { ensureClaudeProjectMcpConfig } = require("./project-settings");
const { SessionStore } = require("../codex/session-store");
const { buildOpeningTurnText, buildInstructionRefreshText } = require("../shared-instructions");
const { ClaudeCodeIpcServer } = require("./ipc-server");
const { resolveModelKey } = require("../../../core/config");
const CLAUDE_RESUME_SESSION_TIMEOUT_MS = 8000;

function createClaudeCodeRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "claudecode" });
  const sessionsByWorkspace = new Map();
  const pendingApprovals = new Map();
  const configuredModel = normalizeText(config.claudeModel);
  let globalListener = null;
  let nextClientId = 0;

  const MODEL_KEY_TO_NAME = {
    ds: "deepseek-v4-pro",
    opus: "claude-opus-4-6",
    haiku: "claude-haiku-4-5",
  };

  function resolveModel(model = "") {
    const normalized = normalizeText(model);
    // Resolve short keys like "opus" → "claude-opus-4-6"
    if (MODEL_KEY_TO_NAME.hasOwnProperty(normalized)) {
      return MODEL_KEY_TO_NAME[normalized] || configuredModel || normalized;
    }
    return configuredModel || normalized;
  }

  function toModelKey(model) {
    return resolveModelKey(resolveModel(model));
  }

  function modelRuntimeId(modelKey) {
    return "claudecode:" + modelKey;
  }

  function makeSessionEntry(client) {
    const clientId = String(++nextClientId);
    return {
      client,
      clientId,
      threadId: "",
      sessionId: "",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      alive: true,
    };
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

  // Model → API routing table
  const MODEL_ROUTES = {
    "claude-opus-4-6": {
      baseUrl: process.env.CYBERBOSS_55API_ENDPOINT || "http://156.233.228.80:3000",
      apiKey: process.env.CYBERBOSS_55API_KEY || "",
      modelName: "claude-opus-4-6",
      apiModelName: "[A-按量]claude-opus-4-6",
    },

    // DeepSeek 显式路由（不再依赖 settings.json 静默兜底）
    "deepseek-v4-pro": {
      baseUrl: process.env.CYBERBOSS_DEEPSEEK_ENDPOINT || "https://api.deepseek.com/anthropic",
      apiKey: process.env.CYBERBOSS_DEEPSEEK_KEY || "",
      modelName: "deepseek-v4-pro",
      apiModelName: "deepseek-v4-pro",
    },

    // Haiku 待定（后端未确认前禁止启用；route 缺失时会 fail-closed）
    // "claude-haiku-4-5": {
    //   baseUrl: process.env.CYBERBOSS_HAIKU_ENDPOINT || "",
    //   apiKey: process.env.CYBERBOSS_HAIKU_KEY || "",
    //   modelName: "claude-haiku-4-5",
    //   apiModelName: "claude-haiku-4-5",
    // },
  };

  function ensureModelHome(stateDir, homeKey) {
    const homeDir = path.join(stateDir, "claude-homes", homeKey);
    const claudeDir = path.join(homeDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, "{}\n", "utf8");
    }
    return homeDir;
  }

  function resolveModelEnv(model) {
    const route = MODEL_ROUTES[normalizeText(model)];
    if (!route) {
      // 不再静默 spawn 一个继承 settings.json(=DeepSeek) 的子进程
      throw new Error(`[resolveModelEnv] 未登记的模型: ${model}，拒绝启动以防静默错路由`);
    }
    const env = { ...filterClaudeCodeEnv(process.env) };
    env.ANTHROPIC_BASE_URL = route.baseUrl;
    // ANTHROPIC_MODEL 是 settings 名，给 --model flag 提供后备；不可填成 API 专有模型 ID
    env.ANTHROPIC_MODEL = route.modelName;
    if (route.apiKey) env.ANTHROPIC_AUTH_TOKEN = route.apiKey;
    // 下面几个是 API 请求里真正发的 model id，用 API 专有名
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = route.apiModelName || route.modelName;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = route.apiModelName || route.modelName;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = route.apiModelName || route.modelName;
    env.ANTHROPIC_SMALL_FAST_MODEL = route.apiModelName || route.modelName;
    env.CYBERBOSS_SYSTEM_MODEL = route.modelName;
    const modelHome = ensureModelHome(config.stateDir, normalizeText(model));
    env.USERPROFILE = modelHome;
    env.HOME = modelHome;
    return { env, modelName: route.modelName };
  }

  const ipcSocketPath = path.join(
    config.stateDir || path.join(os.homedir(), ".cyberboss"),
    "claudecode-runtime.sock",
  );
  const ipcServer = new ClaudeCodeIpcServer({ socketPath: ipcSocketPath });

  ipcServer.on("clientMessage", (msg) => {
    if (msg?.type === "sendUserMessage" && msg?.workspaceRoot) {
      const modelKey = String(msg.modelKey || "").trim();
      if (!modelKey) {
        console.error("[ipc-server] sendUserMessage rejected: missing modelKey workspace=" + msg.workspaceRoot);
        return;
      }
      const entry = findActiveEntry(msg.workspaceRoot, modelKey);
      if (entry?.alive && entry.client?.alive) {
        entry.client.sendUserMessage({ text: msg.text || "" }).catch(() => {});
      }
    }
    if (msg?.type === "respondApproval" && msg?.workspaceRoot) {
      const modelKey = String(msg.modelKey || "").trim();
      const requestId = String(msg.requestId || "").trim();
      if (!modelKey || !requestId) {
        console.error("[ipc-server] respondApproval rejected: missing modelKey or requestId workspace=" + msg.workspaceRoot);
        if (globalListener) {
          globalListener({ type: "runtime.approval.error", payload: { workspaceRoot: msg.workspaceRoot, error: "missing modelKey or requestId" } });
        }
        return;
      }
      const pending = pendingApprovals.get(requestId);
      if (!pending || pending.modelKey !== modelKey || pending.workspaceRoot !== msg.workspaceRoot) {
        console.error("[ipc-server] respondApproval rejected: no matching pending approval requestId=" + requestId + " model=" + modelKey);
        if (globalListener) {
          globalListener({ type: "runtime.approval.error", payload: { workspaceRoot: msg.workspaceRoot, modelKey, error: "no matching pending approval" } });
        }
        pendingApprovals.delete(requestId);
        return;
      }
      const entry = findActiveEntry(msg.workspaceRoot, modelKey);
      if (!entry?.alive || !entry.client?.alive || entry.clientId !== pending.clientId) {
        console.error("[ipc-server] respondApproval rejected: client mismatch requestId=" + requestId + " model=" + modelKey);
        if (globalListener) {
          globalListener({ type: "runtime.approval.error", payload: { workspaceRoot: msg.workspaceRoot, modelKey, error: "model process restarted, this approval is stale" } });
        }
        pendingApprovals.delete(requestId);
        return;
      }
      entry.client.sendResponse(requestId, { decision: msg.decision }).catch(() => {});
      pendingApprovals.delete(requestId);
    }
  });

  async function ensureClient(workspaceRoot, model = "", reason = "user_message") {
    const modelKey = toModelKey(model);
    const desiredModel = resolveModel(model);

    let perModel = sessionsByWorkspace.get(workspaceRoot);
    if (!perModel) {
      perModel = new Map();
      sessionsByWorkspace.set(workspaceRoot, perModel);
    }

    const entry = perModel.get(modelKey);
    if (entry?.alive && entry.client?.alive) {
      entry.lastActiveAt = Date.now();
      return { entry, modelKey };
    }

    if (entry && !entry.alive) {
      perModel.delete(modelKey);
    }

    const projectSettings = ensureClaudeProjectMcpConfig({
      workspaceRoot,
      cyberbossHome: process.env.CYBERBOSS_HOME || path.resolve(__dirname, "..", "..", "..", ".."),
    });
    const { env: clientEnv, modelName: resolvedModel } = resolveModelEnv(desiredModel);
    console.log(
      `[spawn] workspace=${workspaceRoot} model=${resolvedModel} modelKey=${modelKey} reason=${reason} base_url=${clientEnv.ANTHROPIC_BASE_URL || "(default)"}`
    );
    const client = new ClaudeCodeProcessClient({
      command: config.claudeCommand || "claude",
      cwd: workspaceRoot,
      env: clientEnv,
      model: resolvedModel,
      permissionMode: config.claudePermissionMode || "default",
      disableVerbose: Boolean(config.claudeDisableVerbose),
      extraArgs: config.claudeExtraArgs || [],
      mcpConfigPaths: [projectSettings.configPath],
      ipcServer,
      workspaceRoot,
    });
    const newEntry = makeSessionEntry(client);

    client.onMessage((event, raw) => {
      if (event.type === "session.id") {
        newEntry.sessionId = event.sessionId;
        for (const binding of sessionStore.listBindings()) {
          if (binding.activeWorkspaceRoot === workspaceRoot) {
            sessionStore.setThreadIdForWorkspace(
              binding.bindingKey, workspaceRoot, event.sessionId,
              {}, modelRuntimeId(modelKey)
            );
          }
        }
        return;
      }
      const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
      if (mapped?.payload && !mapped.payload.workspaceRoot) {
        mapped.payload.workspaceRoot = workspaceRoot;
      }
      if (mapped?.type === "runtime.approval.requested") {
        if (pendingApprovals.size >= 100) {
          const firstKey = pendingApprovals.keys().next().value;
          pendingApprovals.delete(firstKey);
        }
        pendingApprovals.set(mapped.payload.requestId, { workspaceRoot, modelKey, clientId: newEntry.clientId });
      }
      if (mapped?.type === "runtime.turn.failed") {
        newEntry.alive = false;
      }
      if (mapped && globalListener) {
        globalListener(mapped, raw);
      }
    });

    perModel.set(modelKey, newEntry);
    return { entry: newEntry, modelKey };
  }

  async function attachClientToThread(workspaceRoot, threadId = "", model = "", { allowSpawn = true, reason = "user_message" } = {}) {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    const normalizedThreadId = normalizeThreadId(threadId);
    const modelKey = toModelKey(model);
    if (!normalizedWorkspaceRoot) {
      throw new Error("workspaceRoot is required");
    }

    const perModel = sessionsByWorkspace.get(normalizedWorkspaceRoot);
    const entry = perModel?.get(modelKey);

    if (entry?.alive && entry.client?.alive && normalizedThreadId && clientMatchesThread(entry.client, normalizedThreadId)) {
      entry.lastActiveAt = Date.now();
      entry.threadId = normalizedThreadId;
      return { client: entry.client, threadId: normalizedThreadId, modelKey };
    }

    if (!allowSpawn) {
      if (entry?.alive && entry.client?.alive) {
        entry.lastActiveAt = Date.now();
        const sid = entry.sessionId || entry.client.sessionId || "";
        return { client: entry.client, threadId: normalizedThreadId || sid, modelKey };
      }
      return null;
    }

    if (entry?.alive && entry.client?.alive && !normalizedThreadId) {
      await closeWorkspaceClient(normalizedWorkspaceRoot, modelKey);
    }

    let { entry: currentEntry, modelKey: mk } = await ensureClient(normalizedWorkspaceRoot, model, reason);
    if (!currentEntry.client.alive || (normalizedThreadId && !clientMatchesThread(currentEntry.client, normalizedThreadId))) {
      if (currentEntry.client.alive && normalizedThreadId && !clientMatchesThread(currentEntry.client, normalizedThreadId)) {
        await closeWorkspaceClient(normalizedWorkspaceRoot, modelKey);
        const result = await ensureClient(normalizedWorkspaceRoot, model, reason);
        currentEntry = result.entry;
        mk = result.modelKey;
      }
      await currentEntry.client.connect(currentEntry.client.sessionId ? normalizedThreadId : "");
    }

    currentEntry.threadId = normalizedThreadId || normalizeThreadId(currentEntry.client.sessionId);
    currentEntry.lastActiveAt = Date.now();

    return { client: currentEntry.client, threadId: currentEntry.threadId, modelKey: mk };
  }

  async function closeWorkspaceClient(workspaceRoot, modelKey = "") {
    const normalizedWorkspaceRoot = typeof workspaceRoot === "string" ? workspaceRoot.trim() : "";
    if (!normalizedWorkspaceRoot) return;

    const perModel = sessionsByWorkspace.get(normalizedWorkspaceRoot);
    if (!perModel) return;

    if (modelKey) {
      const entry = perModel.get(modelKey);
      if (entry) {
        await entry.client.close();
        entry.alive = false;
        perModel.delete(modelKey);
      }
    } else {
      for (const [key, entry] of perModel.entries()) {
        await entry.client.close();
        entry.alive = false;
      }
      perModel.clear();
    }

    if (!modelKey || perModel.size === 0) {
      sessionsByWorkspace.delete(normalizedWorkspaceRoot);
    }

    for (const [requestId, pending] of pendingApprovals.entries()) {
      const wr = typeof pending === "object" ? pending.workspaceRoot : pending;
      if (wr === normalizedWorkspaceRoot) {
        if (!modelKey || (typeof pending === "object" && pending.modelKey === modelKey)) {
          pendingApprovals.delete(requestId);
        }
      }
    }
  }

  return {
    describe() {
      return {
        id: "claudecode",
        kind: "runtime",
        command: config.claudeCommand || "claude",
        sessionsFile: config.sessionsFile,
        ipcSocketPath,
        model: configuredModel,
      };
    },
    onEvent(listener) {
      if (typeof listener !== "function") return () => {};
      globalListener = listener;
      return () => {
        if (globalListener === listener) globalListener = null;
      };
    },
    getSessionStore() {
      return sessionStore;
    },
    getTurnCapabilities() {
      return { nativeImageInput: false, toolImageRead: false };
    },
    async initialize() {
      ipcServer.start();
      return { command: config.claudeCommand || "claude", models: [] };
    },
    async close() {
      for (const perModel of sessionsByWorkspace.values()) {
        for (const entry of perModel.values()) {
          await entry.client.close();
        }
      }
      sessionsByWorkspace.clear();
      await ipcServer.close();
    },
    cleanupDeadEntries() {
      for (const [workspaceRoot, perModel] of sessionsByWorkspace.entries()) {
        for (const [modelKey, entry] of perModel.entries()) {
          if (!entry.client?.alive) {
            console.log(`[claudecode-runtime] cleaning up dead entry workspace=${workspaceRoot} model=${modelKey}`);
            perModel.delete(modelKey);
          }
        }
        if (perModel.size === 0) {
          sessionsByWorkspace.delete(workspaceRoot);
        }
      }
    },
    async startFreshThreadDraft({ workspaceRoot }) {
      await closeWorkspaceClient(workspaceRoot);
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision, result = null }) {
      const pending = pendingApprovals.get(requestId);
      if (!pending || typeof pending !== "object") {
        throw new Error(`no pending approval for requestId=${requestId}`);
      }
      const workspaceRoot = pending.workspaceRoot;
      const modelKey = pending.modelKey;

      const entry = workspaceRoot && modelKey
        ? sessionsByWorkspace.get(workspaceRoot)?.get(modelKey) || null
        : null;
      if (!entry?.alive || !entry.client?.alive || entry.clientId !== pending.clientId) {
        pendingApprovals.delete(requestId);
        throw new Error(`approval session expired for workspace=${workspaceRoot} model=${modelKey}`);
      }
      const responsePayload = result && typeof result === "object" ? result : { decision };
      await entry.client.sendResponse(requestId, responsePayload);
      pendingApprovals.delete(requestId);
      return {
        requestId,
        ...(result && typeof result === "object" ? { result: responsePayload } : { decision: decision === "accept" ? "accept" : "decline" }),
      };
    },
    async cancelTurn({ threadId, turnId, workspaceRoot }) {
      const perModels = workspaceRoot
        ? [[workspaceRoot, sessionsByWorkspace.get(workspaceRoot)]]
        : [...sessionsByWorkspace.entries()];

      for (const [wsRoot, perModel] of perModels) {
        if (!perModel) continue;
        for (const [mk, entry] of perModel.entries()) {
          if (entry.alive && entry.client?.alive && (entry.client.sessionId === threadId || entry.threadId === threadId)) {
            await entry.client.close();
            entry.alive = false;
            perModel.delete(mk);
            if (perModel.size === 0) sessionsByWorkspace.delete(wsRoot);
            return { threadId, turnId };
          }
        }
      }
      return { threadId, turnId };
    },
    async resumeThread({ threadId, workspaceRoot, model = "" }) {
      if (!workspaceRoot) return { threadId };
      const attached = await attachClientToThread(workspaceRoot, threadId, model);
      if (!attached) return { threadId };
      return { threadId: attached.threadId };
    },
    async compactThread({ threadId, workspaceRoot, model = "" }) {
      const attached = await attachClientToThread(workspaceRoot, threadId, model);
      if (!attached) return { threadId };
      const { client, threadId: activeThreadId } = attached;
      await client.sendUserMessage({ text: "/compact", threadId: activeThreadId });
      return { threadId: activeThreadId, turnId: client.pendingTurnId };
    },
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "" }) {
      const attached = await attachClientToThread(workspaceRoot, threadId, model);
      if (!attached) return { threadId };
      const { client, threadId: activeThreadId } = attached;
      const refreshText = buildInstructionRefreshText(config);
      await client.sendUserMessage({ text: refreshText, threadId: activeThreadId });
      return { threadId: activeThreadId };
    },
    async sendTextTurn(args) {
      return this.sendTurn(args);
    },
    async sendTurn({ bindingKey, workspaceRoot, text, metadata = {}, model = "", provider = "" }) {
      const modelKey = toModelKey(model);
      const desiredModel = resolveModel(model);
      const runtimeId = modelRuntimeId(modelKey);
      const allowSpawn = provider !== "system";
      const reason = provider === "system" ? "system_message" : "user_message";

      if (!allowSpawn) {
        const perModel = sessionsByWorkspace.get(workspaceRoot);
        const entry = perModel?.get(modelKey);
        if (!entry?.alive || !entry.client?.alive) {
          if (entry) entry.alive = false;
          console.log("[claudecode-runtime] system message skipped: no active session for model " + modelKey);
          return { threadId: "", turnId: "", skipped: true };
        }
      }

      let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId);
      if (!threadId) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId);
      }
      if (desiredModel) {
        sessionStore.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, {
          model: desiredModel,
          modelProvider: "",
        });
      }
      let openingTurn = !threadId;
      let attached;
      try {
        attached = await attachClientToThread(workspaceRoot, threadId, desiredModel, { allowSpawn, reason });
      } catch (error) {
        if (!threadId) throw error;
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId);
        threadId = "";
        openingTurn = true;
        attached = await attachClientToThread(workspaceRoot, "", desiredModel, { allowSpawn, reason });
      }

      if (!attached) {
        console.log("[claudecode-runtime] system message skipped: no active session for model " + modelKey);
        return { threadId: "", turnId: "", skipped: true };
      }

      const { client, threadId: activeThreadId } = attached;
      const outboundText = (openingTurn && provider !== "system") ? buildOpeningTurnText(config, text, provider) : text;
      const outboundThreadId = activeThreadId || threadId;
      if (outboundThreadId) {
        sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, outboundThreadId, metadata, runtimeId);
      }
      await client.sendUserMessage({ text: outboundText, threadId: outboundThreadId });
      const actualSessionId = normalizeThreadId(
        await client.waitForSessionId({ timeoutMs: CLAUDE_RESUME_SESSION_TIMEOUT_MS })
      );
      const sessionReplaced =
        outboundThreadId && actualSessionId && actualSessionId !== outboundThreadId;
      if (sessionReplaced) {
        const resumeStatus = openingTurn ? "new_session" : "session_replaced";
        console.log(
          `[session-change] workspace=${workspaceRoot} model=${desiredModel} oldSession=${outboundThreadId} newSession=${actualSessionId} resume=${!openingTurn} reason=${resumeStatus}`
        );
      }
      const returnedThreadId = actualSessionId || outboundThreadId;
      if (!returnedThreadId) {
        throw new Error("claudecode did not report a session id");
      }
      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, returnedThreadId, metadata, runtimeId);

      const perModel = sessionsByWorkspace.get(workspaceRoot);
      const entry = perModel?.get(modelKey);
      if (entry) {
        entry.threadId = returnedThreadId;
        entry.sessionId = returnedThreadId;
        entry.lastActiveAt = Date.now();
      }

      return {
        threadId: returnedThreadId,
        turnId: client.pendingTurnId,
      };
    },

    getModelThreadId(bindingKey, workspaceRoot) {
      const params = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
      return sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(resolveModelKey(params.model)));
    },

    clearAllModelThreadIds(bindingKey, workspaceRoot) {
      for (const mk of ["ds", "opus", "haiku"]) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(mk));
      }
    },

    listModelThreadIds(bindingKey, workspaceRoot) {
      const result = [];
      for (const mk of ["ds", "opus", "haiku"]) {
        const tid = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot, modelRuntimeId(mk));
        if (tid) result.push({ modelKey: mk, threadId: tid });
      }
      return result;
    },

    listAllWorkspaceRoots(bindingKey) {
      const roots = new Set();
      for (const mk of ["ds", "opus", "haiku"]) {
        for (const wr of sessionStore.listWorkspaceRoots(bindingKey, modelRuntimeId(mk))) {
          if (wr) roots.add(wr);
        }
      }
      for (const wr of sessionStore.listWorkspaceRoots(bindingKey)) {
        if (wr) roots.add(wr);
      }
      const activeWr = sessionStore.getActiveWorkspaceRoot(bindingKey);
      if (activeWr) roots.add(activeWr);
      return [...roots];
    },

    toModelKey(model) {
      return toModelKey(model);
    },

    modelRuntimeId(model) {
      return modelRuntimeId(toModelKey(model));
    },
  };
}

function filterClaudeCodeEnv(env) {
  const STRIP = new Set([
    "CLAUDECODE",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CYBERBOSS_SYSTEM_MODEL",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!STRIP.has(key)) out[key] = value;
  }
  return out;
}

module.exports = { createClaudeCodeRuntimeAdapter };

function normalizeThreadId(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clientMatchesThread(client, threadId) {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId || !client?.alive) return false;
  return normalizeThreadId(client.sessionId) === normalizedThreadId
    || normalizeThreadId(client.resumeSessionId) === normalizedThreadId;
}
