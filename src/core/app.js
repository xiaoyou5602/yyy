const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { createChannelAdapter } = require("./channel-factory");
const { ReminderQueueStore } = require("./reminder-queue-store");
const { MemoryService } = require("../services/memory-service");
const { runConsolidationScheduler } = require("../memory/consolidation-scheduler");
const { resolveModelKey, getModelMemoryDir, modelToDisplayName, ALL_MODEL_KEYS } = require("./config");
const { isApiModel, getModelConfig } = require("./model-routes");
const { sendApiTurn } = require("./direct-api-client");
const DEFAULT_MIN_CHUNK_CHARS = 20;
const MAX_MIN_CHUNK_CHARS = 3800;
const { persistIncomingWeixinAttachments } = require("../adapters/channel/weixin/media-receive");
const { createCodexRuntimeAdapter } = require("../adapters/runtime/codex");
const { createClaudeCodeRuntimeAdapter } = require("../adapters/runtime/claudecode");
const { createExternalCliRuntimeAdapter } = require("../adapters/runtime/external-cli");
const { findModelByQuery } = require("../adapters/runtime/codex/model-catalog");
const { createTimelineIntegration } = require("../integrations/timeline");
const {
  assembleRuntimeTurnText,
  buildInboundDraft,
  buildMergedInboundPrepared,
  clonePreparedInboundMessage,
  isPlainTextPreparedMessage,
  shouldBatchImageOnlyInbound,
  takeImageOnlyBatchMessages,
} = require("./inbound-turn");
const { resolveVisionContext } = require("../services/vision-context");
const {
  buildWeixinHelpText,
} = require("./command-registry");
const { CheckinConfigStore, parseCheckinRangeMinutes, resolveDefaultCheckinRange } = require("./checkin-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("./default-targets");
const { StreamDelivery } = require("./stream-delivery");
const { ThreadStateStore } = require("./thread-state-store");
const { DeferredSystemReplyStore } = require("./deferred-system-reply-store");
const { SystemMessageQueueStore } = require("./system-message-queue-store");
const { SystemMessageDispatcher } = require("./system-message-dispatcher");
const { TimelineScreenshotQueueStore } = require("./timeline-screenshot-queue-store");
const { TurnGateStore } = require("./turn-gate-store");
const {
  matchesCommandPrefix,
  canonicalizeCommandTokens,
  extractApprovalFilePaths,
  isPathWithinRoot,
  normalizeCommandTokens,
  splitCommandLine,
} = require("../adapters/runtime/shared/approval-command");
const { runSystemCheckinPoller } = require("../app/system-checkin-poller");
const { createProjectTooling } = require("../tools/create-project-tooling");
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MIN_LONG_POLL_TIMEOUT_MS = 2_000;
const SESSION_EXPIRED_ERRCODE = -14;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_INBOUND_STICKER_IMAGE_BATCH = 10;
const INBOUND_IMAGE_BATCH_IDLE_MS = 1_500;

function createRuntimeAdapter(config) {
  if (config.runtime === "claudecode") {
    return createClaudeCodeRuntimeAdapter(config);
  }
  if (config.runtime === "external-cli") {
    return createExternalCliRuntimeAdapter(config);
  }
  return createCodexRuntimeAdapter(config);
}

class CyberbossApp {
  constructor(config) {
    this.config = config;
    this.channelAdapter = createChannelAdapter(config);
    this.timelineIntegration = createTimelineIntegration(config);
    const projectTooling = createProjectTooling(config, {
      channelAdapter: this.channelAdapter,
      timelineIntegration: this.timelineIntegration,
    });
    this.projectServices = projectTooling.services;
    this.memoryServices = projectTooling.services.memoryServices || new Map();
    // Fallback: initialize per-model services if not already done
    if (!this.memoryServices.size) {
      for (const mk of ALL_MODEL_KEYS) {
        const memoryDir = getModelMemoryDir(config.stateDir, mk);
        this.memoryServices.set(mk, new MemoryService({ config, memoryDir }));
      }
      projectTooling.services.memoryServices = this.memoryServices;
      projectTooling.services.getMemoryService = (model) => {
        const key = resolveModelKey(model);
        return this.memoryServices.get(key) || this.memoryServices.get("ds");
      };
    }
    this.projectToolHost = projectTooling.toolHost;
    this.runtimeContextStore = projectTooling.runtimeContextStore;
    this.runtimeAdapter = createRuntimeAdapter(config);
    this.threadStateStore = new ThreadStateStore();
    this.systemMessageQueue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
    this.deferredSystemReplyQueue = new DeferredSystemReplyStore({ filePath: config.deferredSystemReplyQueueFile });
    this.checkinConfigStore = new CheckinConfigStore({ filePath: config.checkinConfigFile });
    this.timelineScreenshotQueue = new TimelineScreenshotQueueStore({ filePath: config.timelineScreenshotQueueFile });
    this.reminderQueue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
    this.turnGateStore = new TurnGateStore();
    this._turnWatchdogs = new Map(); // threadId → setTimeout, proactive stuck-turn recovery
    this.pendingInboundByScope = new Map();
    this.pendingImageInboundByScope = new Map();
    this.turnBoundaryScopeKeys = new Set();
    this.systemMessageDispatcher = null;
    this.streamDelivery = new StreamDelivery({
      channelAdapter: this.channelAdapter,
      sessionStore: this.runtimeAdapter.getSessionStore(),
      runtimeId: this.runtimeAdapter.describe().id,
      onDeferredSystemReply: (payload) => this.deferSystemReply(payload),
    });
    this.pendingOperationByRunKey = new Map();
    this.runtimeEventChain = Promise.resolve();
    this.runtimeAdapter.onEvent((event) => {
      this.threadStateStore.applyRuntimeEvent(event);
      this.runtimeEventChain = this.runtimeEventChain
        .catch(() => {})
        .then(() => this.handleRuntimeEvent(event))
        .catch((error) => {
          const message = error instanceof Error ? error.stack || error.message : String(error);
          console.error(`[cyberboss] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
        });
    });
  }

  getMemoryServiceForModel(model) {
    const key = resolveModelKey(model);
    return this.memoryServices.get(key) || this.memoryServices.get("ds");
  }

  printDoctor() {
    console.log(JSON.stringify({
      stateDir: this.config.stateDir,
      channel: this.channelAdapter.describe(),
      runtime: this.runtimeAdapter.describe(),
      timeline: this.timelineIntegration.describe(),
      threads: this.threadStateStore.snapshot(),
    }, null, 2));
  }

  async login() {
    await this.channelAdapter.login();
  }

  printAccounts() {
    this.channelAdapter.printAccounts();
  }

  async start() {
    // PID lock — prevent multiple instances
    const pidFile = path.join(this.config.stateDir, "logs", "running.pid");
    const existingPid = (() => { try { const raw = fs.readFileSync(pidFile, "utf8").trim(); return raw ? Number.parseInt(raw, 10) : 0; } catch { return 0; } })();
    if (existingPid > 0) {
      try { process.kill(existingPid, 0); console.error(`[cyberboss] Another instance is already running (PID ${existingPid}). Exiting.`); process.exit(1); } catch { /* stale pid file */ }
    }
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    const cleanupPidFile = () => { try { const raw = fs.readFileSync(pidFile, "utf8").trim(); if (Number.parseInt(raw, 10) === process.pid) { fs.rmSync(pidFile, { force: true }); } } catch { /* ignore */ } };
    process.on("exit", cleanupPidFile);

    const account = this.channelAdapter.resolveAccount();
    this.activeAccountId = account.accountId;
    this.systemMessageDispatcher = new SystemMessageDispatcher({
      queueStore: this.systemMessageQueue,
      config: this.config,
      accountId: account.accountId,
    });
    this.runtimeContextStore?.clearAll?.();
    const runtimeState = await this.runtimeAdapter.initialize();
    const knownContextTokens = Object.keys(this.channelAdapter.getKnownContextTokens()).length;
    const syncBuffer = this.channelAdapter.loadSyncBuffer();
    this.runtimeAdapter.cleanupDeadEntries?.();
    await this.restoreBoundThreadSubscriptions();

    console.log("[cyberboss] bootstrap ok");
    console.log(`[cyberboss] channel=${this.channelAdapter.describe().id}`);
    console.log(`[cyberboss] runtime=${this.runtimeAdapter.describe().id}`);
    console.log(`[cyberboss] timeline=${this.timelineIntegration.describe().id}`);
    console.log(`[cyberboss] account=${account.accountId}`);
    console.log(`[cyberboss] baseUrl=${account.baseUrl}`);
    console.log(`[cyberboss] workspaceRoot=${this.config.workspaceRoot}`);
    console.log(`[cyberboss] knownContextTokens=${knownContextTokens}`);
    console.log(`[cyberboss] syncBuffer=${syncBuffer ? "ready" : "empty"}`);
    console.log(`[cyberboss] runtimeEndpoint=${runtimeState.endpoint || runtimeState.command || "(spawn)"}`);
    console.log(`[cyberboss] runtimeModels=${runtimeState.models?.length || 0}`);
    if (this.config.startWithLocationServer) {
      await this.ensureLocationServerStarted();
    }
    if (typeof this.channelAdapter.startServer === "function") {
      await this.channelAdapter.startServer();
    }
    console.log(`[cyberboss] bridge loop started; waiting for ${this.channelAdapter.describe().id} messages.`);
    if (this.config.startWithCheckin) {
      console.log("[cyberboss] checkin: enabled");
      void runSystemCheckinPoller(this.config, this.channelAdapter).catch((error) => {
        console.error(`[cyberboss] checkin poller stopped: ${error.message}`);
      });
    }
    // Start memory consolidation scheduler (nightly dream engine)
    void runConsolidationScheduler({
      memoryServices: this.memoryServices,
      allModelKeys: ALL_MODEL_KEYS,
      systemMessageQueue: this.systemMessageQueue,
      config: this.config,
    }).catch((error) => {
      console.error(`[cyberboss] consolidation scheduler stopped: ${error.message}`);
    });

    const shutdown = createShutdownController(async () => {
      this.clearPendingImageInboundTimers();
      await this.closeLocationServer();
      await this.runtimeAdapter.close();
    });

    try {
      let consecutiveFailures = 0;
      while (!shutdown.stopped) {
        try {
          await Promise.all([
            this.flushDueReminders(account),
            this.flushPendingInboundMessages(),
            this.flushPendingSystemMessages(),
            this.flushPendingTimelineScreenshots(account),
          ]);
          const response = await this.channelAdapter.getUpdates({
            syncBuffer: this.channelAdapter.loadSyncBuffer(),
            timeoutMs: this.resolveLongPollTimeoutMs(),
          });
          assertWeixinUpdateResponse(response);
          consecutiveFailures = 0;
          const messages = sortInboundUpdateMessages(Array.isArray(response?.msgs) ? response.msgs : []);
          for (const message of messages) {
            if (shutdown.stopped) {
              break;
            }
            await this.handleIncomingMessage(message);
          }
          await Promise.all([
            this.flushDueReminders(account),
            this.flushPendingInboundMessages(),
            this.flushPendingSystemMessages(),
            this.flushPendingTimelineScreenshots(account),
          ]);
        } catch (error) {
          if (shutdown.stopped) {
            break;
          }

          if (isSessionExpiredError(error)) {
            throw new Error("The WeChat session has expired. Run `npm run login` again.");
          }

          consecutiveFailures += 1;
          console.error(`[cyberboss] poll failed: ${formatErrorMessage(error)}`);
          await sleep(consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS);
        }
      }
    } finally {
      shutdown.dispose();
      this.clearPendingImageInboundTimers();
      await this.closeLocationServer();
      await this.runtimeAdapter.close();
    }
  }

  async ensureLocationServerStarted() {
    if (!this.projectServices?.whereabouts) {
      return null;
    }
    try {
      await this.projectServices.whereabouts.startServer({
        onAccepted: (result) => this.handleLocationAccepted(result),
      });
      console.log(
        `[cyberboss] locationServer=http://${this.config.locationHost}:${this.config.locationPort} store=${this.config.locationStoreFile}`
      );
    } catch (error) {
      if (error.code === "EADDRINUSE") {
        console.error(
          `[cyberboss] Port ${this.config.locationPort} already in use — another instance is likely running. Exiting.`
        );
        process.exit(1);
      } else {
        throw error;
      }
    }
    return this.projectServices.whereabouts.server || null;
  }

  async closeLocationServer() {
    if (this.projectServices?.whereabouts) {
      await this.projectServices.whereabouts.closeServer();
    }
    if (this.channelAdapter && typeof this.channelAdapter.closeServer === "function") {
      await this.channelAdapter.closeServer();
    }
  }

  handleLocationAccepted(result) {
    if (!this.activeAccountId) {
      return;
    }

    const point = result?.appended?.point || null;
    const movementEvent = result?.appended?.movementEvent || null;
    const triggerText = buildLocationTriggerSystemText(point?.trigger);
    if (!triggerText && !movementEvent) {
      return;
    }

    const sessionStore = this.runtimeAdapter.getSessionStore();
    const senderId = resolvePreferredSenderId({
      config: this.config,
      accountId: this.activeAccountId,
      sessionStore,
    });
    const workspaceRoot = resolvePreferredWorkspaceRoot({
      config: this.config,
      accountId: this.activeAccountId,
      senderId,
      sessionStore,
    });
    if (!senderId || !workspaceRoot) {
      return;
    }

    if (triggerText && point?.id) {
      this.systemMessageQueue.enqueue({
        id: `location-trigger:${point.id}`,
        accountId: this.activeAccountId,
        senderId,
        workspaceRoot,
        text: triggerText,
        createdAt: normalizeIsoTime(point?.receivedAt) || normalizeIsoTime(point?.timestamp) || new Date().toISOString(),
      });
    }

    if (movementEvent) {
      this.systemMessageQueue.enqueue({
        id: `location-move:${movementEvent.id}`,
        accountId: this.activeAccountId,
        senderId,
        workspaceRoot,
        text: buildLocationMovementSystemText(movementEvent),
        createdAt: normalizeIsoTime(movementEvent?.movedAt) || new Date().toISOString(),
      });
    }
  }

  async sendTimelineScreenshot({
    senderId = "",
    outputFile = "",
    selector = "",
    range = "",
    date = "",
    week = "",
    month = "",
    category = "",
    subcategory = "",
    width = 0,
    height = 0,
    sidePadding = undefined,
    locale = "",
  } = {}) {
    return this.projectServices.timeline.queueScreenshot({
      userId: senderId,
      outputFile,
      selector,
      range,
      date,
      week,
      month,
      category,
      subcategory,
      width,
      height,
      sidePadding,
      locale,
    }, {});
  }

  async sendLocalFileToCurrentChat({ senderId = "", filePath = "" } = {}) {
    return this.projectServices.channelFile.sendToCurrentChat({
      userId: senderId,
      filePath,
    }, {});
  }

  async handleIncomingMessage(message) {
    const normalized = this.channelAdapter.normalizeIncomingMessage(message);
    if (!normalized) {
      return;
    }

    this.primeDeferredRepliesForSender(normalized);
    await this.handlePreparedMessage(normalized, { allowCommands: true });
  }

  deferSystemReply({ threadId = "", userId = "", text = "", error = null, kind = "plain_reply" }) {
    return this.deferredSystemReplyQueue.enqueue({
      id: `${normalizeCommandArgument(threadId) || "system"}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      accountId: this.activeAccountId || this.channelAdapter.resolveAccount().accountId,
      senderId: userId,
      threadId,
      text,
      kind,
      createdAt: new Date().toISOString(),
      failedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error || ""),
    });
  }

  primeDeferredRepliesForSender(normalized) {
    if (!normalized?.accountId || !normalized?.senderId || !normalized?.contextToken) {
      return;
    }
    const pendingReplies = this.deferredSystemReplyQueue.drainForSender(normalized.accountId, normalized.senderId);
    if (!pendingReplies.length) {
      return;
    }
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.streamDelivery.setDeferredReplyPrefix(bindingKey, formatDeferredSystemReplyBatch(pendingReplies));
    console.warn(
      `[cyberboss] queued deferred reply prefix sender=${normalized.senderId} count=${pendingReplies.length}`
    );
  }

  async handlePreparedMessage(normalized, { allowCommands }) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.streamDelivery.setReplyTarget(bindingKey, {
      userId: normalized.senderId,
      contextToken: normalized.contextToken,
      provider: normalized.provider,
    });

    const command = parseChannelCommand(normalized.text);
    if (allowCommands && command) {
      await this.dispatchChannelCommand(normalized, command);
      return;
    }

    // Extract memory fragments from incoming user message
    if (normalized.text && normalized.provider !== "system") {
      const memSvc = this.getMemoryServiceForModel(normalized.model);
      memSvc.extractFromTurn({
        userText: normalized.text,
        date: new Date().toISOString().slice(0, 10),
      }).catch((err) => {
        console.warn(`[cyberboss] memory extractFromTurn failed: ${err?.message || err}`);
      });
    }

    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const prepared = await this.prepareIncomingMessageForRuntime(normalized, workspaceRoot);
    if (!prepared) {
      return;
    }

    if (shouldBatchImageOnlyInbound(prepared)) {
      this.enqueuePendingImageInbound({ bindingKey, workspaceRoot, prepared });
      return;
    }

    if (this.hasPendingImageInbound(bindingKey, workspaceRoot) && isPlainTextPreparedMessage(prepared)) {
      const merged = await this.flushPendingImageInboundBatch({
        bindingKey,
        workspaceRoot,
        trailingPrepared: prepared,
      });
      if (merged) {
        return;
      }
    }

    if (this.hasPendingImageInbound(bindingKey, workspaceRoot)) {
      await this.flushPendingImageInboundBatch({ bindingKey, workspaceRoot });
    }

    // Apply per-message model preference (e.g. from direct channel)
    if (normalized.model) {
      this.runtimeAdapter.getSessionStore().setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, {
        model: normalized.model,
        modelProvider: "",
      });
    }

    await this.routePreparedInbound({ bindingKey, workspaceRoot, prepared });
  }

  isTurnDispatchBlocked(bindingKey, workspaceRoot, { ignoreBoundary = false } = {}) {
    const scopeKey = buildScopeKey(bindingKey, workspaceRoot);
    if (!ignoreBoundary && scopeKey && this.turnBoundaryScopeKeys?.has(scopeKey)) {
      return true;
    }
    if (this.turnGateStore.isPending(bindingKey, workspaceRoot)) {
      return true;
    }
    const threadId = this.getActiveThreadId(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    if (threadState?.status === "running") {
      const THREAD_RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — kill stuck Claude via cancelTurn
      const updatedAt = threadState.updatedAt ? new Date(threadState.updatedAt).getTime() : 0;
      if (Date.now() - updatedAt > THREAD_RUNNING_TIMEOUT_MS) {
        console.warn(`[turn-dispatch] stuck thread detected threadId=${threadState.threadId} age=${Math.round((Date.now() - updatedAt) / 1000)}s`);
        if (!this._abandoningThreads) this._abandoningThreads = new Set();
        if (!this._abandoningThreads.has(threadId)) {
          this._abandoningThreads.add(threadId);
          this.abandonStuckTurn(threadId, workspaceRoot, bindingKey).finally(() => {
            this._abandoningThreads.delete(threadId);
          }).catch((err) => {
            console.error(`[turn-dispatch] abandonStuckTurn failed threadId=${threadId} ${err?.message || err}`);
          });
        }
        return true;
      }
      return true;
    }
    return hasRpcId(threadState?.pendingApproval?.requestId);
  }

  async abandonStuckTurn(threadId, workspaceRoot, bindingKey) {
    const wd = this._turnWatchdogs.get(threadId);
    if (wd) { clearTimeout(wd); this._turnWatchdogs.delete(threadId); }
    console.warn(`[turn-dispatch] abandoning stuck turn threadId=${threadId} workspace=${workspaceRoot}`);
    await this.runtimeAdapter.cancelTurn({ threadId, workspaceRoot });
    await sleep(500);
    this.turnGateStore.releaseThread(threadId);
    this.threadStateStore.resetThreadState(threadId);
    console.warn(`[turn-dispatch] stuck turn abandoned threadId=${threadId}`);
  }

n  // Reset the turn watchdog timer. Called after approval resolution or any
  // event that indicates the turn is still making progress (not stuck).
  _resetWatchdog(threadId, workspaceRoot, bindingKey) {
    const old = this._turnWatchdogs.get(threadId);
    if (old) { clearTimeout(old); }
    const state = this.threadStateStore.getThreadState(threadId);
    // Do not set a watchdog when waiting for approval
    if (state?.status === "waiting_approval") return;
    const watchdogMs = 4 * 60 * 1000;
    const watchdog = setTimeout(() => {
      this._turnWatchdogs.delete(threadId);
      const current = this.threadStateStore.getThreadState(threadId);
      if (current?.status === "running") {
        console.warn(`[turn-watchdog] turn timed out threadId=${threadId}`);
        this.abandonStuckTurn(threadId, workspaceRoot, bindingKey).catch(() => {});
      }
    }, watchdogMs);
    watchdog.unref();
    this._turnWatchdogs.set(threadId, watchdog);
  }
  async dispatchPreparedTurn({ bindingKey, workspaceRoot, prepared }) {
    const pendingScopeKey = this.turnGateStore.begin(bindingKey, workspaceRoot);
    await this.channelAdapter.sendTyping({
      userId: prepared.senderId,
      status: 1,
      contextToken: prepared.contextToken,
    }).catch(() => {});

    try {
      const sessionModel = this.runtimeAdapter.getSessionStore().getRuntimeParamsForWorkspace(bindingKey, workspaceRoot).model;
      const contextModel = (prepared.provider === "system" && typeof prepared.model === "string")
        ? prepared.model
        : sessionModel;

      // 分支路由：type="api" 直调 API，type="cli" 走 Claude CLI
      // 系统消息（checkin 等）不走直调——它们需要 CLI 协议理解 silent/resume 等
      const modelKey = resolveModelKey(sessionModel);
      if (isApiModel(modelKey) && prepared.provider !== "system") {
        return await this._dispatchApiTurn({
          bindingKey, workspaceRoot, prepared, pendingScopeKey,
          modelKey, sessionModel, contextModel,
        });
      }

      const runtimeTurn = await this.buildRuntimeTurn({ prepared, model: sessionModel });
      const sendTurn = typeof this.runtimeAdapter.sendTurn === "function"
        ? this.runtimeAdapter.sendTurn.bind(this.runtimeAdapter)
        : this.runtimeAdapter.sendTextTurn.bind(this.runtimeAdapter);
      const turn = await sendTurn({
        bindingKey,
        workspaceRoot,
        text: runtimeTurn.text,
        attachments: runtimeTurn.attachments,
        model: sessionModel,
        provider: prepared.provider,
        metadata: {
          workspaceId: prepared.workspaceId,
          accountId: prepared.accountId,
          senderId: prepared.senderId,
        },
      });
      if (turn?.skipped) {
        this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
        return false;
      }
      this.runtimeContextStore?.setActiveContext?.({
        workspaceRoot,
        runtimeId: this.runtimeAdapter.describe().id,
        threadId: turn.threadId,
        bindingKey,
        accountId: prepared.accountId,
        senderId: prepared.senderId,
        model: contextModel,
      });
      this.turnGateStore.attachThread(pendingScopeKey, turn.threadId);
      this.threadStateStore.setLastTurnContext(turn.threadId, {
        lastUserMessage: prepared.text || prepared.originalText || "",
        pendingAction: prepared.provider === "system" ? "checkin" : "responding",
        targetFile: "",
      });
      this._resetWatchdog(turn.threadId, workspaceRoot, bindingKey);
      const replyTarget = {
        userId: prepared.senderId,
        contextToken: prepared.contextToken,
        provider: prepared.provider,
      };
      if (turn.turnId) {
        this.streamDelivery.setReplyTarget(bindingKey, replyTarget);
        this.streamDelivery.bindReplyTargetForTurn({
          threadId: turn.threadId,
          turnId: turn.turnId,
          target: replyTarget,
        });
      } else {
        this.streamDelivery.queueReplyTargetForThread(turn.threadId, replyTarget);
      }
      return true;
    } catch (error) {
      this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
      const messageText = error instanceof Error ? error.message : String(error || "unknown error");
      await this.channelAdapter.sendText({
        userId: prepared.senderId,
        text: `❌ Request failed\n${messageText}`,
        contextToken: prepared.contextToken,
      }).catch(() => {});
      return false;
    }
  }

  async _dispatchApiTurn({ bindingKey, workspaceRoot, prepared, pendingScopeKey, modelKey, sessionModel, contextModel }) {
    const cfg = getModelConfig(modelKey);
    if (!cfg) {
      this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
      await this.channelAdapter.sendText({
        userId: prepared.senderId,
        text: `❌ 未找到模型配置: ${modelKey}`,
        contextToken: prepared.contextToken,
        model: sessionModel,
      }).catch(() => {});
      return false;
    }

    const memoryContext = await this.getMemoryServiceForModel(sessionModel).injectMemoryContext({
      text: prepared.text || prepared.originalText || "",
    });
    const worldbookContext = this.projectServices.worldbook.buildPromptSection(sessionModel);
    const channelContext = loadChannelInstructions(this.config, prepared?.provider);

    const systemParts = [worldbookContext, channelContext, memoryContext].filter(Boolean);
    const systemPrompt = systemParts.join("\n") + "\n现在时间：" + new Date().toISOString().slice(0, 16).replace("T", " ");

    console.log(`[api-turn] model=${modelKey} base_url=${cfg.baseUrl} api_model=${cfg.apiModel}`);

    let fullText = "";
    let fullThinking = "";
    let textBuffer = "";
    let thinkingBuffer = "";
    // API 路径没有 runtime turnId，自己生成一个，串联流式思考显示与存档（前端按 turnId 归组/dedup）
    const apiTurnId = "api-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

    const flushText = (isFinal = false) => {
      if (!textBuffer) return;
      let chunk;
      if (isFinal) {
        chunk = textBuffer;
        textBuffer = "";
      } else {
        // 只发送到最后一个句末/段落边界，残句留在缓冲区，避免气泡从句子中间断开
        let cut = -1;
        for (const ch of ["\n", "。", "！", "？", "…", "～"]) {
          const idx = textBuffer.lastIndexOf(ch);
          if (idx > cut) cut = idx;
        }
        if (cut < 0) return;
        chunk = textBuffer.slice(0, cut + 1);
        textBuffer = textBuffer.slice(cut + 1);
      }
      if (!chunk.trim()) return;
      this.channelAdapter.sendText({
        userId: prepared.senderId,
        text: chunk,
        contextToken: prepared.contextToken,
        model: sessionModel,
        preserveBlock: true,
        finalChunk: isFinal,
      }).catch(() => {});
    };

    const flushThinking = () => {
      if (!thinkingBuffer) return;
      const chunk = thinkingBuffer;
      thinkingBuffer = "";
      this.channelAdapter.sendThinking({
        userId: prepared.senderId,
        text: chunk,
        turnId: apiTurnId,
        model: sessionModel,
      }).catch(() => {});
    };

    const replyTarget = {
      userId: prepared.senderId,
      contextToken: prepared.contextToken,
      model: sessionModel,
    };

    // 从 messageStore 取最近对话，按字符数切窗口（max 40k chars）
    let conversationHistory = [];
    try {
      if (typeof this.channelAdapter.getRecentMessages === "function") {
        const raw = this.channelAdapter.getRecentMessages({ days: 3, model: sessionModel });
        let charCount = 0;
        const MAX_CHARS = 40000;
        for (let i = raw.length - 1; i >= 0; i--) {
          const m = raw[i];
          // thinking 存档（07-03 起 API 路径也 saveThinking）不算对话内容，混入会被当成克说过的话
          if (m.from === "thinking") continue;
          const role = m.from === "you" ? "user" : "assistant";
          const text = (m.text || "").trim();
          if (!text) continue;
          if (role === "assistant" && (text.startsWith("{") || text.startsWith("❌"))) continue;
          if (charCount + text.length > MAX_CHARS) break;
          conversationHistory.unshift({ role, content: text });
          charCount += text.length;
        }
      }
    } catch (e) {
      console.warn("[api-turn] failed to load history:", e.message);
    }

    try {
      await sendApiTurn({
        modelConfig: cfg,
        text: prepared.text || prepared.originalText || "",
        system: systemPrompt,
        messages: conversationHistory,
        onThinking: (chunk) => {
          fullThinking += chunk;
          thinkingBuffer += chunk;
          // thinking 也缓冲，每 200 字或遇到段落边界才发送
          if (thinkingBuffer.length > 200 || /\n\n/.test(thinkingBuffer)) {
            flushThinking();
          }
        },
        onText: (chunk) => {
          // 正文开始 = 思考已结束。先把残留思考发出去，防止短思考（<200 字从未 flush）
          // 拖到 onDone 才发，被前端当成第二轮思考渲染出重复空块
          if (!fullText && thinkingBuffer) flushThinking();
          fullText += chunk;
          textBuffer += chunk;
          // 只在句子结束（。！？）或段落边界（双换行）或超 500 字时 flush
          const sentenceEnd = /[。！？\n]/.test(chunk);
          const paragraphBreak = /\n\n/.test(textBuffer);
          const longEnough = textBuffer.length > 500;
          if (paragraphBreak || (sentenceEnd && textBuffer.length > 20) || longEnough) {
            flushText(false);
          }
        },
        onDone: async () => {
          flushThinking();
          // 存档 thinking：在最终文本 flush 前存，globalId 排序让思考排在回复前（与 stream-delivery 一致）
          if (fullThinking && typeof this.channelAdapter.saveThinking === "function") {
            await this.channelAdapter.saveThinking({
              userId: prepared.senderId,
              text: fullThinking.slice(0, 5000),
              turnId: apiTurnId,
              model: sessionModel,
            }).catch(() => {});
          }
          flushText(true);
          this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
        },
        onError: async (err) => {
          console.error(`[api-turn] error model=${modelKey}: ${err.message}`);
          this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
          await this.channelAdapter.sendText({
            userId: prepared.senderId,
            text: `❌ API 请求失败\n${err.message}`,
            contextToken: prepared.contextToken,
            model: sessionModel,
          }).catch(() => {});
        },
      });

      return true;
    } catch (error) {
      this.turnGateStore.releaseScope(bindingKey, workspaceRoot);
      const messageText = error instanceof Error ? error.message : String(error || "unknown error");
      await this.channelAdapter.sendText({
        userId: prepared.senderId,
        text: `❌ Request failed\n${messageText}`,
        contextToken: prepared.contextToken,
        model: sessionModel,
      }).catch(() => {});
      return false;
    }
  }

  async buildRuntimeTurn({ prepared, model = "" }) {
    if (prepared?.provider === "system") {
      return {
        text: String(prepared.text || "").trim(),
        attachments: [],
      };
    }
    const visionContext = await resolveVisionContext({
      prepared,
      config: this.config,
      runtimeAdapter: this.runtimeAdapter,
      model,
    });
    const memoryContext = await this.getMemoryServiceForModel(model).injectMemoryContext({
      text: prepared.text || prepared.originalText || "",
    });
    const worldbookContext = this.projectServices.worldbook.buildPromptSection(model);
    const channelContext = loadChannelInstructions(this.config, prepared?.provider);
    return {
      text: assembleRuntimeTurnText({
        prepared,
        config: this.config,
        visionContext,
        memoryContext,
        worldbookContext,
        channelContext,
      }),
      attachments: Array.isArray(visionContext.runtimeAttachments) ? visionContext.runtimeAttachments : [],
      visionContext,
    };
  }

  async routePreparedInbound({ bindingKey, workspaceRoot, prepared }) {
    if (this.isTurnDispatchBlocked(bindingKey, workspaceRoot)) {
      this.bufferPendingInboundMessage({ bindingKey, workspaceRoot, prepared });
      return false;
    }
    return this.dispatchPreparedTurn({ bindingKey, workspaceRoot, prepared });
  }

  hasPendingImageInbound(bindingKey, workspaceRoot) {
    return this.pendingImageInboundByScope.has(buildScopeKey(bindingKey, workspaceRoot));
  }

  enqueuePendingImageInbound({ bindingKey, workspaceRoot, prepared }) {
    const scopeKey = buildScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey || !prepared) {
      return;
    }

    const current = this.pendingImageInboundByScope.get(scopeKey) || {
      bindingKey,
      workspaceRoot,
      messages: [],
      timer: null,
    };
    current.messages.push(clonePreparedInboundMessage(prepared));
    this.pendingImageInboundByScope.set(scopeKey, current);
    this.schedulePendingImageInboundFlush(scopeKey, bindingKey, workspaceRoot);
    void this.channelAdapter.sendTyping({
      userId: prepared.senderId,
      status: 1,
      contextToken: prepared.contextToken,
    }).catch(() => {});
  }

  schedulePendingImageInboundFlush(scopeKey, bindingKey, workspaceRoot, delayMs = INBOUND_IMAGE_BATCH_IDLE_MS) {
    const draft = this.pendingImageInboundByScope.get(scopeKey);
    if (!draft) {
      return;
    }
    if (draft.timer) {
      clearTimeout(draft.timer);
    }
    draft.timer = setTimeout(() => {
      void this.flushPendingImageInboundBatch({ bindingKey, workspaceRoot }).catch((error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        console.error(`[cyberboss] image inbound debounce flush failed ${message}`);
      });
    }, Math.max(0, Number(delayMs) || 0));
    this.pendingImageInboundByScope.set(scopeKey, draft);
  }

  clearPendingImageInboundTimer(scopeKey) {
    const draft = this.pendingImageInboundByScope.get(scopeKey);
    if (!draft?.timer) {
      return;
    }
    clearTimeout(draft.timer);
    draft.timer = null;
  }

  clearPendingImageInboundTimers() {
    for (const [scopeKey] of this.pendingImageInboundByScope.entries()) {
      this.clearPendingImageInboundTimer(scopeKey);
    }
  }

  async flushPendingImageInboundBatch({ bindingKey = "", workspaceRoot = "", trailingPrepared = null } = {}) {
    const scopeKey = buildScopeKey(bindingKey, workspaceRoot);
    const draft = scopeKey ? this.pendingImageInboundByScope.get(scopeKey) || null : null;
    if (!draft?.bindingKey || !draft?.workspaceRoot) {
      if (scopeKey) {
        this.pendingImageInboundByScope.delete(scopeKey);
      }
      return false;
    }

    this.clearPendingImageInboundTimer(scopeKey);
    this.pendingImageInboundByScope.delete(scopeKey);

    const queued = Array.isArray(draft.messages)
      ? draft.messages
        .filter((message) => message && typeof message === "object")
        .slice()
        .sort(comparePendingInboundMessages)
      : [];
    if (!queued.length) {
      return false;
    }

    const { batchMessages, remainingMessages } = takeImageOnlyBatchMessages(queued, MAX_INBOUND_STICKER_IMAGE_BATCH);
    if (!batchMessages.length) {
      return false;
    }

    if (remainingMessages.length) {
      this.pendingImageInboundByScope.set(scopeKey, {
        bindingKey: draft.bindingKey,
        workspaceRoot: draft.workspaceRoot,
        messages: remainingMessages,
        timer: null,
      });
    }

    const prepared = buildMergedInboundPrepared({
      bindingKey: draft.bindingKey,
      workspaceRoot: draft.workspaceRoot,
      messages: batchMessages,
      trailingPrepared,
    });
    await this.routePreparedInbound({
      bindingKey: draft.bindingKey,
      workspaceRoot: draft.workspaceRoot,
      prepared,
    });

    if (remainingMessages.length) {
      await this.flushPendingImageInboundBatch({
        bindingKey: draft.bindingKey,
        workspaceRoot: draft.workspaceRoot,
      });
    }

    return true;
  }

  bufferPendingInboundMessage({ bindingKey, workspaceRoot, prepared }) {
    const scopeKey = buildScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey || !prepared) {
      return;
    }

    const current = this.pendingInboundByScope.get(scopeKey) || {
      bindingKey,
      workspaceRoot,
      messages: [],
    };
    current.messages.push({
      workspaceId: prepared.workspaceId,
      accountId: prepared.accountId,
      senderId: prepared.senderId,
      messageId: prepared.messageId,
      contextToken: prepared.contextToken,
      provider: prepared.provider,
      originalText: prepared.originalText,
      text: prepared.text,
      attachments: Array.isArray(prepared.attachments) ? prepared.attachments : [],
      attachmentFailures: Array.isArray(prepared.attachmentFailures) ? prepared.attachmentFailures : [],
      receivedAt: prepared.receivedAt,
    });
    this.pendingInboundByScope.set(scopeKey, current);
    void this.channelAdapter.sendTyping({
      userId: prepared.senderId,
      status: 1,
      contextToken: prepared.contextToken,
    }).catch(() => {});
  }

  hasPendingInboundMessage(bindingKey, workspaceRoot) {
    return this.pendingInboundByScope.has(buildScopeKey(bindingKey, workspaceRoot));
  }

  async flushPendingInboundMessages({ bindingKey = "", workspaceRoot = "", ignoreBoundary = false } = {}) {
    const targetScopeKey = buildScopeKey(bindingKey, workspaceRoot);
    const scopeEntries = targetScopeKey
      ? [[targetScopeKey, this.pendingInboundByScope.get(targetScopeKey) || null]]
      : [...this.pendingInboundByScope.entries()];

    for (const [scopeKey, draft] of scopeEntries) {
      if (!draft?.bindingKey || !draft?.workspaceRoot) {
        this.pendingInboundByScope.delete(scopeKey);
        continue;
      }
      if (this.isTurnDispatchBlocked(draft.bindingKey, draft.workspaceRoot, { ignoreBoundary })) {
        continue;
      }
      const pendingDispatch = this.mergePendingInboundDraft(draft);
      if (!pendingDispatch?.prepared) {
        this.pendingInboundByScope.delete(scopeKey);
        continue;
      }
      this.pendingInboundByScope.delete(scopeKey);
      const dispatched = await this.dispatchPreparedTurn({
        bindingKey: pendingDispatch.prepared.bindingKey,
        workspaceRoot: pendingDispatch.prepared.workspaceRoot,
        prepared: {
          workspaceId: pendingDispatch.prepared.workspaceId,
          accountId: pendingDispatch.prepared.accountId,
          senderId: pendingDispatch.prepared.senderId,
          contextToken: pendingDispatch.prepared.contextToken,
          provider: pendingDispatch.prepared.provider,
          originalText: pendingDispatch.prepared.originalText,
          text: pendingDispatch.prepared.text,
          attachments: pendingDispatch.prepared.attachments,
          attachmentFailures: pendingDispatch.prepared.attachmentFailures,
          receivedAt: pendingDispatch.prepared.receivedAt,
        },
      });
      if (!dispatched) {
        this.pendingInboundByScope.set(scopeKey, draft);
        continue;
      }
      if (pendingDispatch.remainingMessages.length) {
        this.pendingInboundByScope.set(scopeKey, {
          bindingKey: draft.bindingKey,
          workspaceRoot: draft.workspaceRoot,
          messages: pendingDispatch.remainingMessages,
        });
      }
    }
  }

  mergePendingInboundDraft(draft) {
    const queued = Array.isArray(draft?.messages)
      ? draft.messages
        .filter((message) => message && typeof message === "object")
        .slice()
        .sort(comparePendingInboundMessages)
      : [];
    if (!queued.length) {
      return null;
    }
    if (queued.every((message) => shouldBatchImageOnlyInbound(message))) {
      const { batchMessages, remainingMessages } = takeImageOnlyBatchMessages(queued, MAX_INBOUND_STICKER_IMAGE_BATCH);
      return {
        prepared: buildMergedInboundPrepared({
          bindingKey: draft.bindingKey,
          workspaceRoot: draft.workspaceRoot,
          messages: batchMessages,
        }),
        remainingMessages,
      };
    }

    if (queued.length === 1) {
      return {
        prepared: {
          bindingKey: draft.bindingKey,
          workspaceRoot: draft.workspaceRoot,
          ...queued[0],
        },
        remainingMessages: [],
      };
    }

    const latest = queued[queued.length - 1];
    const blocks = queued
      .map((message) => String(message.text || "").trim())
      .filter(Boolean);

    return {
      prepared: {
        bindingKey: draft.bindingKey,
        workspaceRoot: draft.workspaceRoot,
        ...latest,
        text: [
          "Multiple newer WeChat messages arrived while you were still handling the previous turn.",
          "Treat the following blocks as one ordered batch of fresh user input and respond once after considering all of them.",
          "",
          blocks.join("\n\n"),
        ].join("\n").trim(),
      },
      remainingMessages: [],
    };
  }

  async prepareIncomingMessageForRuntime(normalized, workspaceRoot) {
    if (normalized?.provider === "system") {
      return {
        ...normalized,
        originalText: normalized.text,
        text: String(normalized.text || "").trim(),
        attachments: [],
        attachmentFailures: [],
      };
    }

    const attachments = Array.isArray(normalized.attachments) ? normalized.attachments : [];
    if (!attachments.length) {
      return buildInboundDraft(normalized);
    }

    const alreadyPersisted = attachments.every((a) => a.absolutePath && typeof a.absolutePath === "string");
    const persisted = alreadyPersisted
      ? { saved: attachments, failed: [] }
      : await persistIncomingWeixinAttachments({
          attachments,
          stateDir: this.config.stateDir,
          cdnBaseUrl: this.config.weixinCdnBaseUrl,
          messageId: normalized.messageId,
          receivedAt: normalized.receivedAt,
        });

    if (!persisted.saved.length && persisted.failed.length && !String(normalized.text || "").trim()) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `⚠️ Failed to receive image or attachment\n${persisted.failed.map((item) => item.reason).join("\n")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    const prepared = buildInboundDraft(normalized, {
      attachments: persisted.saved,
      attachmentFailures: persisted.failed,
    });
    if (!prepared.originalText && !prepared.attachments.length && prepared.attachmentFailures.length) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `⚠️ Failed to receive image or attachment\n${persisted.failed.map((item) => item.reason).join("\n")}`,
        contextToken: normalized.contextToken,
        preserveBlock: true,
      }).catch(() => {});
      return null;
    }

    return prepared;
  }

  async flushPendingSystemMessages() {
    const pendingMessages = this.systemMessageDispatcher?.drainPending() || [];
    for (const message of pendingMessages) {
      try {
        const dispatched = await this.dispatchSystemMessage(message);
        if (!dispatched) {
          this.systemMessageDispatcher.requeue(message);
        }
      } catch {
        this.systemMessageDispatcher?.requeue(message);
      }
    }
  }

  async flushPendingTimelineScreenshots(account) {
    const pendingJobs = this.timelineScreenshotQueue.drainForAccount(account.accountId);
    for (const job of pendingJobs) {
      try {
        const captured = await this.projectServices.timeline.captureScreenshot({
          outputFile: job.outputFile,
          selector: job.selector,
          range: job.range,
          date: job.date,
          week: job.week,
          month: job.month,
          category: job.category,
          subcategory: job.subcategory,
          width: job.width,
          height: job.height,
          sidePadding: job.sidePadding,
          locale: job.locale,
        });
        await this.sendLocalFileToCurrentChat({
          senderId: job.senderId,
          filePath: captured.outputFile,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(`[cyberboss] timeline screenshot failed job=${job.id} ${messageText}`);
        await this.channelAdapter.sendTyping({
          userId: job.senderId,
          status: 0,
        }).catch(() => {});
        await this.channelAdapter.sendText({
          userId: job.senderId,
          text: `❌ Timeline screenshot failed\n${messageText}`,
          preserveBlock: true,
        }).catch(() => {});
      }
    }
  }

  resolveLongPollTimeoutMs() {
    if (this.systemMessageDispatcher?.hasPending()) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    if (this.activeAccountId && this.timelineScreenshotQueue.hasPendingForAccount(this.activeAccountId)) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }

    const nextDueAtMs = this.reminderQueue.peekNextDueAtMs();
    if (!nextDueAtMs) {
      return DEFAULT_LONG_POLL_TIMEOUT_MS;
    }

    const remainingMs = nextDueAtMs - Date.now();
    if (remainingMs <= MIN_LONG_POLL_TIMEOUT_MS) {
      return MIN_LONG_POLL_TIMEOUT_MS;
    }
    return Math.max(MIN_LONG_POLL_TIMEOUT_MS, Math.min(DEFAULT_LONG_POLL_TIMEOUT_MS, remainingMs));
  }

  async flushDueReminders(account) {
    const dueReminders = this.reminderQueue
      .listDue(Date.now())
      .filter((reminder) => reminder.accountId === account.accountId);

    for (const reminder of dueReminders) {
      try {
        this.systemMessageQueue.enqueue({
          id: `reminder:${reminder.id}`,
          accountId: reminder.accountId,
          senderId: reminder.senderId,
          workspaceRoot: this.resolveReminderWorkspaceRoot(reminder),
          text: buildReminderSystemTrigger(reminder, this.config),
          createdAt: new Date().toISOString(),
        });
      } catch {
        this.reminderQueue.enqueue({
          ...reminder,
          dueAtMs: Date.now() + 5_000,
        });
      }
    }
  }

  resolveReminderWorkspaceRoot(reminder) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: this.config.workspaceId,
      accountId: reminder.accountId,
      senderId: reminder.senderId,
    });
    return this.runtimeAdapter.getSessionStore().getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async dispatchSystemMessage(message) {
    const prepared = this.systemMessageDispatcher?.buildPreparedMessage(message, this.channelAdapter.getKnownContextTokens()[message.senderId] || "");
    if (!prepared) {
      throw new Error("system message could not be prepared");
    }
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: prepared.workspaceId,
      accountId: prepared.accountId,
      senderId: prepared.senderId,
    });
    const workspaceRoot = prepared.workspaceRoot || this.resolveWorkspaceRoot(bindingKey);
    if (this.isTurnDispatchBlocked(bindingKey, workspaceRoot)) {
      return false;
    }
    return this.dispatchPreparedTurn({ bindingKey, workspaceRoot, prepared });
  }

  async dispatchChannelCommand(normalized, command) {
    switch (command.name) {
      case "bind":
        await this.handleBindCommand(normalized, command);
        return;
      case "status":
        await this.handleStatusCommand(normalized);
        return;
      case "new":
        await this.handleNewCommand(normalized);
        return;
      case "reread":
        await this.handleRereadCommand(normalized);
        return;
      case "compact":
        await this.handleCompactCommand(normalized);
        return;
      case "switch":
        await this.handleSwitchCommand(normalized, command);
        return;
      case "stop":
        await this.handleStopCommand(normalized);
        return;
      case "checkin":
        await this.handleCheckinCommand(normalized, command);
        return;
      case "chunk":
        await this.handleChunkCommand(normalized, command);
        return;
      case "yes":
      case "always":
      case "no":
        await this.handleApprovalCommand(normalized, command);
        return;
      case "model":
        await this.handleModelCommand(normalized, command);
        return;
      case "star":
        await this.handleStarCommand(normalized);
        return;
      case "help":
        await this.handleHelpCommand(normalized);
        return;
      default:
        await this.channelAdapter.sendText({
          userId: normalized.senderId,
          text: buildWeixinHelpText(),
          contextToken: normalized.contextToken,
        });
    }
  }

  async handleBindCommand(normalized, command) {
    const workspaceRoot = normalizeWorkspacePath(command.args);
    if (!workspaceRoot) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 Usage: /bind /absolute/path",
        contextToken: normalized.contextToken,
      });
      return;
    }

    if (!isAbsoluteWorkspacePath(workspaceRoot)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "⚠️ Only absolute paths are supported for /bind.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    if (!isPathWithinAllowedDirectories(workspaceRoot, this.config.workspaceRoot)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "⚠️ The path must be within your home directory or the current working directory.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const stats = await fs.promises.stat(workspaceRoot).catch(() => null);
    if (!stats?.isDirectory()) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `❌ Workspace does not exist\n${workspaceRoot}`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    this.runtimeAdapter.getSessionStore().setActiveWorkspaceRoot(bindingKey, workspaceRoot);
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Workspace bound\nworkspace: ${workspaceRoot}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleStatusCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const runtimeName = this.runtimeAdapter.describe().id || "runtime";
    const runtimeParams = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
    const storedModel = runtimeParams.model || "";
    const storedModelProvider = runtimeParams.modelProvider || this.runtimeAdapter.describe().modelProvider || "";
    const effectiveModel = this.runtimeAdapter.describe().model || storedModel;

    const lines = [
      `📍 workspace: ${workspaceRoot}`,
      `🤖 runtime: ${runtimeName}`,
      `🤖 model: ${effectiveModel || "(default)"}`,
      `🤖 provider: ${storedModelProvider || "(default)"}`,
    ];

    if (typeof this.runtimeAdapter.listModelThreadIds === "function") {
      const modelThreads = this.runtimeAdapter.listModelThreadIds(bindingKey, workspaceRoot);
      let firstThreadState = null;
      for (const { modelKey, threadId } of modelThreads) {
        const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
        if (!firstThreadState) firstThreadState = threadState;
        lines.push(`🧵 ${modelKey}: ${threadId || "(none)"} [${threadState?.status || "idle"}]`);
      }
      if (!modelThreads.length) {
        lines.push("🧵 thread: (none)");
      }
      const context = firstThreadState?.context?.runtimeId === runtimeName
        ? firstThreadState.context
        : this.threadStateStore.getLatestContext(runtimeName);
      lines.push(formatContextStatusLine({
        runtimeName,
        context,
        claudeContextWindow: this.config.claudeContextWindow,
        claudeMaxOutputTokens: this.config.claudeMaxOutputTokens,
      }));
    } else {
      const threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
      const context = threadState?.context?.runtimeId === runtimeName
        ? threadState.context
        : this.threadStateStore.getLatestContext(runtimeName);
      lines.push(`🧵 thread: ${threadId || "(none)"}`, `📊 status: ${threadState?.status || "idle"}`);
      lines.push(formatContextStatusLine({
        runtimeName,
        context,
        claudeContextWindow: this.config.claudeContextWindow,
        claudeMaxOutputTokens: this.config.claudeMaxOutputTokens,
      }));
    }
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: lines.join("\n"),
      contextToken: normalized.contextToken,
    });
  }

  async handleNewCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    if (typeof this.runtimeAdapter.startFreshThreadDraft === "function") {
      await this.runtimeAdapter.startFreshThreadDraft({ bindingKey, workspaceRoot });
    }
    if (typeof this.runtimeAdapter.clearAllModelThreadIds === "function") {
      this.runtimeAdapter.clearAllModelThreadIds(bindingKey, workspaceRoot);
    } else {
      this.runtimeAdapter.getSessionStore().clearThreadIdForWorkspace(bindingKey, workspaceRoot);
    }
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Switched to a fresh thread draft\nworkspace: ${workspaceRoot}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleRereadCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const threadId = this.getActiveThreadId(bindingKey, workspaceRoot);
    if (!threadId) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 There is no active thread yet. Send a normal message first.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    try {
      this.streamDelivery.queueReplyTargetForThread(threadId, {
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        provider: normalized.provider,
      });
      const runtimeParams = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
      await this.runtimeAdapter.refreshThreadInstructions({
        threadId,
        workspaceRoot,
        model: runtimeParams.model,
        modelProvider: runtimeParams.modelProvider,
      });
    } catch (error) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `❌ Reread failed\n${error instanceof Error ? error.message : String(error || "unknown error")}`,
        contextToken: normalized.contextToken,
      }).catch(() => {});
    }
  }

  async handleCompactCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const threadId = this.getActiveThreadId(bindingKey, workspaceRoot);
    if (!threadId) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 There is no active thread yet. Send a normal message first.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    try {
      this.streamDelivery.queueReplyTargetForThread(threadId, {
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        provider: normalized.provider,
      });
      await this.runtimeAdapter.compactThread({
        threadId,
        workspaceRoot,
        model: sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot).model,
      }).then((result) => {
        const compactTurnId = normalizeCommandArgument(result?.turnId);
        if (compactTurnId) {
          this.pendingOperationByRunKey.set(buildRunKey(threadId, compactTurnId), {
            kind: "compact",
            userId: normalized.senderId,
            contextToken: normalized.contextToken,
          });
        }
      });
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `🗜️ Compact request sent\nthread: ${threadId}`,
        contextToken: normalized.contextToken,
      });
    } catch (error) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `❌ Compact failed\n${error instanceof Error ? error.message : String(error || "unknown error")}`,
        contextToken: normalized.contextToken,
      }).catch(() => {});
    }
  }

  async handleSwitchCommand(normalized, command) {
    const targetThreadId = normalizeThreadId(command.args);
    if (!targetThreadId) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 Usage: /switch <threadId>",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const runtimeParams = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
    const resumed = await this.runtimeAdapter.resumeThread({
      threadId: targetThreadId,
      workspaceRoot,
      model: runtimeParams.model,
      modelProvider: runtimeParams.modelProvider,
    });
    if (typeof this.runtimeAdapter.modelRuntimeId === "function") {
      const rid = this.runtimeAdapter.modelRuntimeId(runtimeParams.model);
      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, resumed?.threadId || targetThreadId, {}, rid);
    } else {
      sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, resumed?.threadId || targetThreadId);
    }
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Thread switched\nworkspace: ${workspaceRoot}\nthread: ${resumed?.threadId || targetThreadId}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleStopCommand(normalized) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.getActiveThreadId(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    if (!threadId || !threadState?.turnId || !["running", "waiting_approval"].includes(threadState.status)) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 There is no running thread right now.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    await this.runtimeAdapter.cancelTurn({
      threadId,
      turnId: threadState.turnId,
      workspaceRoot,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `⏹️ Stop request sent\nthread: ${threadId}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleCheckinCommand(normalized, command) {
    const rangeInput = normalizeCommandArgument(command.args);
    if (!rangeInput) {
      const currentRange = this.checkinConfigStore.getRange(resolveDefaultCheckinRange());
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `⏰ Current check-in interval is ${Math.round(currentRange.minIntervalMs / 60000)}-${Math.round(currentRange.maxIntervalMs / 60000)} minutes.`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    const parsedRange = parseCheckinRangeMinutes(rangeInput);
    if (!parsedRange) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "💡 Usage: /checkin <min>-<max>",
        contextToken: normalized.contextToken,
      });
      return;
    }

    this.checkinConfigStore.setRange({
      minIntervalMs: parsedRange.minMinutes * 60_000,
      maxIntervalMs: parsedRange.maxMinutes * 60_000,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Check-in interval reset to ${parsedRange.minMinutes}-${parsedRange.maxMinutes} minutes and will apply on the next polling cycle.`,
      contextToken: normalized.contextToken,
    });
  }

  async handleChunkCommand(normalized, command) {
    const arg = normalizeCommandArgument(command.args);
    if (!arg) {
      const current = this.channelAdapter.getMinChunkChars?.() ?? DEFAULT_MIN_CHUNK_CHARS;
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `💡 Current minimum merge chunk is ${current} characters. Usage: /chunk <number> (e.g. /chunk 50)`,
        contextToken: normalized.contextToken,
      });
      return;
    }
    const parsed = Number.parseInt(arg, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_MIN_CHUNK_CHARS) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `⚠️  Invalid value. Please provide a number between 1 and ${MAX_MIN_CHUNK_CHARS}.`,
        contextToken: normalized.contextToken,
      });
      return;
    }
    const updated = this.channelAdapter.setMinChunkChars?.(parsed) ?? parsed;
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Minimum merge chunk set to ${updated} characters. Shorter fragments will be merged into one message up to this size.`,
      contextToken: normalized.contextToken,
    });
  }

  async handleApprovalCommand(normalized, command) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.getActiveThreadId(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    const approval = threadState?.pendingApproval || null;
  if (!threadId || approval?.requestId == null || String(approval.requestId).trim() === "") {
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: "💡 There is no pending approval request right now.",
      contextToken: normalized.contextToken,
      });
      return;
    }

    if (approval?.kind === "mcp_tool_call" && command.name === "always") {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "⚠️ Persistent approval for this Codex MCP tool request is not available from WeChat.",
        contextToken: normalized.contextToken,
      });
      return;
    }

    const approvalResponse = buildApprovalResponsePayload(approval, command.name);
    if (!approvalResponse) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: "⚠️ This Codex MCP request cannot be answered from WeChat yet.",
        contextToken: normalized.contextToken,
      });
      return;
    }
    console.log(
      `[cyberboss] approval response requested thread=${threadId} requestId=${approval.requestId} mode=${approvalResponse.result ? "result" : "decision"} workspace=${workspaceRoot}`
    );
    await this.runtimeAdapter.respondApproval(approvalResponse);
    this.runtimeAdapter.getSessionStore().clearApprovalPrompt(threadId);
    console.log(
      `[cyberboss] approval response delivered thread=${threadId} requestId=${approval.requestId}`
    );
    if (command.name === "always" && approvalResponse.decision === "accept") {
      this.runtimeAdapter.getSessionStore().rememberApprovalPrefixForWorkspace(workspaceRoot, approval.commandTokens);
    }
    this.threadStateStore.resolveApproval(threadId, "running");
    this._resetWatchdog(threadId, workspaceRoot, bindingKey);
    const text = buildApprovalResponseText(approval, command.name, approvalResponse);
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text,
      contextToken: normalized.contextToken,
    });
  }

  async handleModelCommand(normalized, command) {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: normalized.workspaceId,
      accountId: normalized.accountId,
      senderId: normalized.senderId,
    });
    const workspaceRoot = this.resolveWorkspaceRoot(bindingKey);
    const query = normalizeCommandArgument(command.args);
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const catalog = sessionStore.getAvailableModelCatalog();
    const currentModel = sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot).model;

    if (!query) {
      const lines = [
        `Current model: ${currentModel || "(default)"}`,
      ];
      if (catalog?.models?.length) {
        lines.push(`Available models: ${catalog.models.map((item) => item.model).join(", ")}`);
      } else {
        lines.push("Available models: (not available)");
      }
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: lines.join("\n"),
        contextToken: normalized.contextToken,
      });
      return;
    }

    const runtimeId = this.runtimeAdapter.describe().id || "runtime";
    let matched = findModelByQuery(catalog?.models || [], query);
    if (!matched && runtimeId !== "codex" && !catalog?.models?.length) {
      matched = { model: query };
    }
    if (!matched) {
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        text: `❌ Model not found\n${query}`,
        contextToken: normalized.contextToken,
      });
      return;
    }

    sessionStore.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, {
      model: matched.model,
    });
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: `✅ Model switched\nworkspace: ${workspaceRoot}\nmodel: ${matched.model}`,
      contextToken: normalized.contextToken,
    });
  }

  async handleStarCommand(normalized) {
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: [
        "⭐️ Liked this project? Throw me a star on GitHub!",
        "It really means a lot to an indie dev working on passion projects 💖",
        "",
        "https://github.com/WenXiaoWendy/cyberboss",
      ].join("\n"),
      contextToken: normalized.contextToken,
    });
    await this.channelAdapter.sendFile({
      userId: normalized.senderId,
      filePath: path.join(__dirname, "../../assets/star-guide.jpg"),
      contextToken: normalized.contextToken,
    }).catch(() => {});
  }

  async handleHelpCommand(normalized) {
    await this.channelAdapter.sendText({
      userId: normalized.senderId,
      text: buildWeixinHelpText(),
      contextToken: normalized.contextToken,
    });
  }

  getActiveThreadId(bindingKey, workspaceRoot) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    if (typeof this.runtimeAdapter.getModelThreadId === "function") {
      return this.runtimeAdapter.getModelThreadId(bindingKey, workspaceRoot);
    }
    return sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
  }

  resolveWorkspaceRoot(bindingKey) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    return sessionStore.getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async handleRuntimeEvent(event) {
    const failureReplyTarget = event?.type === "runtime.turn.failed"
      ? this.streamDelivery.resolveReplyTargetForRun({
          threadId: event?.payload?.threadId,
          turnId: event?.payload?.turnId,
        })
      : null;
    await this.streamDelivery.handleRuntimeEvent(event);
    if (!event) {
      return;
    }
    if (event.type === "runtime.turn.completed" || event.type === "runtime.turn.failed") {
      const completedRunKey = buildRunKey(event.payload.threadId, event.payload.turnId);
      const pendingOperations = this.pendingOperationByRunKey;
      const pendingOperation = pendingOperations?.get?.(completedRunKey) || null;
      if (pendingOperation && pendingOperations?.delete) {
        pendingOperations.delete(completedRunKey);
      }
      const sessionStore = this.runtimeAdapter.getSessionStore();
      sessionStore.clearApprovalPrompt(event.payload.threadId);
      const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(event.payload.threadId);
      const scopeKey = linked?.bindingKey && linked?.workspaceRoot
        ? buildScopeKey(linked.bindingKey, linked.workspaceRoot)
        : "";
      if (scopeKey) {
        this.turnBoundaryScopeKeys.add(scopeKey);
      }
      try {
        this.turnGateStore.releaseThread(event.payload.threadId);
        // Clear turn watchdog on normal completion
        const wd2 = this._turnWatchdogs.get(event.payload.threadId);
        if (wd2) { clearTimeout(wd2); this._turnWatchdogs.delete(event.payload.threadId); }
        if (event.type === "runtime.turn.failed") {
          await this.sendFailureToThread(
            event.payload.threadId,
            event.payload.text || "❌ Execution failed",
            failureReplyTarget,
          );
        }
        if (linked?.bindingKey && linked?.workspaceRoot) {
          await this.flushPendingInboundMessages({
            bindingKey: linked.bindingKey,
            workspaceRoot: linked.workspaceRoot,
            ignoreBoundary: true,
          });
        } else {
          await this.flushPendingInboundMessages();
        }
        await this.flushPendingSystemMessages();
        if (pendingOperation?.kind === "compact" && event.type === "runtime.turn.completed") {
          await this.channelAdapter.sendText({
            userId: pendingOperation.userId,
            text: `✅ Compact finished\nthread: ${event.payload.threadId}`,
            contextToken: pendingOperation.contextToken,
          }).catch(() => {});
        }
        const shouldKeepTyping = linked?.bindingKey && linked?.workspaceRoot
          ? (
            this.turnGateStore.isPending(linked.bindingKey, linked.workspaceRoot)
            || this.hasPendingInboundMessage(linked.bindingKey, linked.workspaceRoot)
          )
          : false;
        if (!shouldKeepTyping) {
          await this.stopTypingForThread(event.payload.threadId);
        }
      } finally {
        if (scopeKey) {
          this.turnBoundaryScopeKeys.delete(scopeKey);
        }
      }
      return;
    }
    if (event.type !== "runtime.approval.requested") {
      return;
    }
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
    if (!linked?.workspaceRoot) {
      return;
    }
    const allowlist = sessionStore.getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
    const shouldAutoApprove = isAutoApprovedStateDirOperation(event.payload, this.config)
      || matchesBuiltInCommandPrefix(event.payload.commandTokens)
      || matchesCommandPrefix(event.payload.commandTokens, allowlist);
    if (!shouldAutoApprove) {
      const promptState = sessionStore.getApprovalPromptState(event.payload.threadId);
      const promptSignature = buildApprovalPromptSignature(event.payload);
      if (promptState?.signature && promptState.signature === promptSignature) {
        sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
        console.log(
          `[cyberboss] approval prompt deduped thread=${event.payload.threadId} requestId=${event.payload.requestId}`
        );
        return;
      }
      sessionStore.rememberApprovalPrompt(event.payload.threadId, event.payload.requestId, promptSignature);
      await this.sendApprovalPrompt({
        bindingKey: linked.bindingKey,
        approval: event.payload,
      }).catch((error) => {
        sessionStore.clearApprovalPrompt(event.payload.threadId);
        throw error;
      });
      this._scheduleApprovalTimeout(event.payload, linked);
      return;
    }
    const approvalResponse = buildApprovalResponsePayload(event.payload, "yes");
    if (!approvalResponse) {
      sessionStore.clearApprovalPrompt(event.payload.threadId);
      await this.sendApprovalPrompt({
        bindingKey: linked.bindingKey,
        approval: event.payload,
      }).catch(() => {});
      return;
    }
    await this.runtimeAdapter.respondApproval(approvalResponse).catch(() => {});
    this.threadStateStore.resolveApproval(event.payload.threadId, "running");
    if (linked?.bindingKey && linked?.workspaceRoot) {
      this._resetWatchdog(event.payload.threadId, linked.workspaceRoot, linked.bindingKey);
    }
  }

  async stopTypingForThread(threadId) {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null;
    if (!target) {
      return;
    }
    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  async sendFailureToThread(threadId, text, fallbackTarget = null) {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = normalizeReplyTarget(
      linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null
    ) || normalizeReplyTarget(fallbackTarget);
    if (!target) {
      return;
    }
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: normalizeText(text) || "❌ Execution failed",
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  resolveCurrentModel(bindingKey) {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const workspaceRoots = sessionStore.listWorkspaceRoots(bindingKey) || [];
    const workspaceRoot = workspaceRoots[0] || "";
    if (!workspaceRoot) return "";
    return (sessionStore.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot)?.model || "").trim();
  }

  // 审批弹窗超时自动拒绝：toge 手机静音/没看软件时，turn 不该无限等审批挂死
  // （07-04 实测挂了 1061s 才被 turn-gate 兜底清理）。2 分钟无响应 → 自动 decline，
  // turn 继续跑，聊天页留一条说明（进历史，克跨 session 回顾也能看到不是 toge 主动拒绝）
  _scheduleApprovalTimeout(approval, linked) {
    const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;
    const threadId = approval?.threadId;
    const requestId = approval?.requestId;
    if (!threadId || requestId == null) return;
    if (!this._approvalTimeouts) this._approvalTimeouts = new Map();
    const old = this._approvalTimeouts.get(threadId);
    if (old) clearTimeout(old);
    const timer = setTimeout(async () => {
      this._approvalTimeouts.delete(threadId);
      try {
        const pending = this.threadStateStore.getThreadState(threadId)?.pendingApproval;
        // 已被响应 / turn 已结束 / 换了新审批 → 什么都不做
        if (!pending || String(pending.requestId) !== String(requestId)) return;
        const payload = buildApprovalResponsePayload(pending, "no");
        if (!payload) return;
        console.log(
          `[cyberboss] approval timeout auto-deny thread=${threadId} requestId=${requestId} after=${APPROVAL_TIMEOUT_MS}ms`
        );
        await this.runtimeAdapter.respondApproval(payload);
        this.runtimeAdapter.getSessionStore().clearApprovalPrompt(threadId);
        this.threadStateStore.resolveApproval(threadId, "running");
        this._resetWatchdog(threadId, linked.workspaceRoot, linked.bindingKey);
        const target = this.resolveReplyTargetForBinding(linked.bindingKey);
        if (target) {
          await this.channelAdapter.sendText({
            userId: target.userId,
            text: "⏰ 这条审批 2 分钟没人响应，系统自动拒绝了这一步（toge 大概没看到弹窗，不是主动拒绝）。克会跳过这个操作继续。",
            contextToken: target.contextToken,
            preserveBlock: true,
            model: this.resolveCurrentModel(linked.bindingKey),
          }).catch(() => {});
        }
      } catch (error) {
        console.warn(`[cyberboss] approval timeout handler failed: ${error.message}`);
      }
    }, APPROVAL_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
    this._approvalTimeouts.set(threadId, timer);
  }

  async sendApprovalPrompt({ bindingKey, approval }) {
    const target = this.resolveReplyTargetForBinding(bindingKey);
    if (!target) {
      console.warn(
        `[cyberboss] approval prompt skipped binding=${bindingKey} requestId=${approval?.requestId || ""} reason=no_reply_target`
      );
      return;
    }
    const model = this.resolveCurrentModel(bindingKey);
    console.log(
      `[cyberboss] approval prompt sending binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""} model=${model || "(none)"}`
    );

    // Direct 通道：弹窗 + 文本消息双发（手机可能收不到弹窗，但文本消息会进历史）
    if (target.provider === "direct" && typeof this.channelAdapter.sendApproval === "function") {
      await this.channelAdapter.sendApproval({ userId: target.userId, approval, model });
      console.log(
        `[cyberboss] approval prompt delivered via dialog binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""} model=${model || "(none)"}`
      );
      // 继续往下走，也发一条文本消息（像 WeChat 时代一样）
    }

    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: buildApprovalPromptText(approval),
      contextToken: target.contextToken,
      preserveBlock: true,
      model,
    });
    console.log(
      `[cyberboss] approval prompt delivered binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`
    );
  }

  async restoreBoundThreadSubscriptions() {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const bindings = sessionStore.listBindings();
    const seenThreadIds = new Set();

    for (const binding of bindings) {
      const bindingKey = normalizeText(binding?.bindingKey);
      if (!bindingKey) {
        continue;
      }

      const target = this.resolveReplyTargetForBinding(bindingKey);
      if (target) {
        this.streamDelivery.setReplyTarget(bindingKey, target);
      }

      const workspaceRoots = typeof this.runtimeAdapter.listAllWorkspaceRoots === "function"
        ? this.runtimeAdapter.listAllWorkspaceRoots(bindingKey)
        : sessionStore.listWorkspaceRoots(bindingKey);

      for (const workspaceRoot of workspaceRoots) {
        const normalizedWorkspaceRoot = normalizeCommandArgument(workspaceRoot);

        if (typeof this.runtimeAdapter.listModelThreadIds === "function") {
          const modelThreads = this.runtimeAdapter.listModelThreadIds(bindingKey, normalizedWorkspaceRoot);
          for (const { modelKey, threadId } of modelThreads) {
            const normalizedThreadId = normalizeCommandArgument(threadId);
            if (!normalizedThreadId || seenThreadIds.has(normalizedThreadId)) continue;
            seenThreadIds.add(normalizedThreadId);
            await this.runtimeAdapter.resumeThread({
              threadId: normalizedThreadId,
              workspaceRoot: normalizedWorkspaceRoot,
              model: modelKey,
            }).catch((err) => {
              console.error(`[cyberboss] resume failed thread=${normalizedThreadId} model=${modelKey} workspace=${normalizedWorkspaceRoot} error=${err?.message || err}`);
            });
          }
        } else {
          const normalizedThreadId = normalizeCommandArgument(
            sessionStore.getThreadIdForWorkspace(bindingKey, normalizedWorkspaceRoot)
          );
          if (!normalizedThreadId || seenThreadIds.has(normalizedThreadId)) continue;
          seenThreadIds.add(normalizedThreadId);
          await this.runtimeAdapter.resumeThread({
            threadId: normalizedThreadId,
            workspaceRoot: normalizedWorkspaceRoot,
          }).catch(() => {});
        }
      }
    }
  }

  resolveReplyTargetForBinding(bindingKey) {
    const binding = this.runtimeAdapter.getSessionStore().getBinding(bindingKey) || null;
    const userId = normalizeCommandArgument(binding?.senderId);
    if (!userId) {
      return null;
    }
    const contextToken = this.channelAdapter.getKnownContextTokens()[userId] || "";
    if (!contextToken) {
      return null;
    }
    return {
      userId,
      contextToken,
      provider: this.channelAdapter.describe().id,
    };
  }
}

function buildRunKey(threadId, turnId) {
  return `${normalizeCommandArgument(threadId)}:${normalizeCommandArgument(turnId)}`;
}

function normalizeReplyTarget(target) {
  if (!target?.userId || !target?.contextToken) {
    return null;
  }
  return {
    userId: String(target.userId).trim(),
    contextToken: String(target.contextToken).trim(),
    provider: normalizeText(target.provider),
  };
}

function formatCompactNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return "0";
  }
  if (normalized >= 1_000_000) {
    return `${Math.round(normalized / 100_000) / 10}m`;
  }
  if (normalized >= 1_000) {
    return `${Math.round(normalized / 100) / 10}k`;
  }
  return String(Math.round(normalized));
}

function formatContextStatusLine({ runtimeName, context, claudeContextWindow, claudeMaxOutputTokens }) {
  if (runtimeName === "claudecode") {
    const configuredWindow = Number(claudeContextWindow);
    if (!Number.isFinite(configuredWindow) || configuredWindow <= 0) {
      return "📦 context: set CYBERBOSS_CLAUDE_CONTEXT_WINDOW";
    }
    const reservedOutputTokens = Math.max(0, Number(claudeMaxOutputTokens) || 0);
    const availableMessageWindow = configuredWindow - reservedOutputTokens;
    if (availableMessageWindow <= 0) {
      return "📦 context: reduce CLAUDE_CODE_MAX_OUTPUT_TOKENS";
    }
    if (!context || !Number.isFinite(Number(context.currentTokens))) {
      return "📦 context: unavailable";
    }
    const summary = formatContextUsage(Number(context.currentTokens), availableMessageWindow);
    if (reservedOutputTokens > 0) {
      return `📦 context: approx ${summary} | reserve ${formatCompactNumber(reservedOutputTokens)}`;
    }
    return `📦 context: approx ${summary}`;
  }
  if (!context) {
    return "📦 context: unavailable";
  }
  const currentTokens = Number(context.currentTokens);
  const contextWindow = Number(context.contextWindow);
  if (!Number.isFinite(currentTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return "📦 context: unavailable";
  }
  return `📦 context: ${formatContextUsage(currentTokens, contextWindow)}`;
}

function formatContextUsage(currentTokens, contextWindow) {
  const safeCurrent = Math.max(0, Number(currentTokens) || 0);
  const safeWindow = Math.max(1, Number(contextWindow) || 1);
  const clampedCurrent = Math.min(safeCurrent, safeWindow);
  const leftPercent = Math.max(0, Math.min(100, Math.round(((safeWindow - clampedCurrent) / safeWindow) * 100)));
  return `${formatCompactNumber(clampedCurrent)}/${formatCompactNumber(safeWindow)} | ${leftPercent}% left`;
}

function buildLocationMovementSystemText(event) {
  const distanceText = `${formatCompactNumber(event?.distanceMeters || 0)}m`;
  const fromLabel = normalizeText(event?.fromAddress) || formatLatLng(event?.fromCenterLat, event?.fromCenterLng);
  const toLabel = normalizeText(event?.toAddress) || formatLatLng(event?.toCenterLat, event?.toCenterLng);
  const movedAt = normalizeText(event?.movedAt) || new Date().toISOString();
  return [
    "System context: the user's location appears to have changed significantly.",
    `Distance: about ${distanceText}.`,
    fromLabel ? `From: ${fromLabel}` : "",
    toLabel ? `To: ${toLabel}` : "",
    `Observed at: ${movedAt}.`,
  ].filter(Boolean).join("\n");
}

function buildLocationTriggerSystemText(trigger) {
  switch (normalizeText(trigger)) {
    case "arrive_home":
      return "User arrives home.";
    case "leave_home":
      return "User leaves home.";
    default:
      return "";
  }
}

function formatLatLng(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
function createShutdownController(onStop) {
  let stopped = false;
  let stoppingPromise = null;

  const stop = async () => {
    if (stopped) {
      return stoppingPromise;
    }
    stopped = true;
    stoppingPromise = Promise.resolve().then(onStop);
    return stoppingPromise;
  };

  const handleSignal = () => {
    stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get stopped() {
      return stopped;
    },
    dispose() {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}

function assertWeixinUpdateResponse(response) {
  const ret = normalizeErrorCode(response?.ret);
  const errcode = normalizeErrorCode(response?.errcode);
  if ((ret !== 0 && ret !== null) || (errcode !== 0 && errcode !== null)) {
    const error = new Error(
      `weixin getUpdates ret=${ret ?? ""} errcode=${errcode ?? ""} errmsg=${normalizeText(response?.errmsg) || ""}`
    );
    error.ret = ret;
    error.errcode = errcode;
    throw error;
  }
}

function isSessionExpiredError(error) {
  const ret = normalizeErrorCode(error?.ret);
  const errcode = normalizeErrorCode(error?.errcode);
  return ret === SESSION_EXPIRED_ERRCODE
    || errcode === SESSION_EXPIRED_ERRCODE
    || String(error?.message || "").includes("session expired")
    || String(error?.message || "").includes("session invalidated");
}

function normalizeErrorCode(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error || "unknown error");
  if (isSessionExpiredError(error)) {
    return "The WeChat session has expired. Run `npm run login` again.";
  }
  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadChannelInstructions(config, provider) {
  if (provider !== "direct") {
    return "";
  }
  const filePath = typeof config?.channelInstructionsFile === "string"
    ? config.channelInstructionsFile.trim()
    : "";
  if (!filePath) {
    return "";
  }
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

module.exports = { CyberbossApp };

function parseChannelCommand(text) {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized.startsWith("/")) {
    return null;
  }
  const [rawName, ...rest] = normalized.slice(1).split(/\s+/);
  const name = normalizeCommandName(rawName);
  if (!name) {
    return null;
  }
  return {
    name,
    args: rest.join(" ").trim(),
  };
}

function normalizeCommandName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:\//;
const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\/$/;
const WINDOWS_UNC_PREFIX_RE = /^\/\/\?\//;

function normalizeWorkspacePath(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const fromFileUri = extractPathFromFileUri(normalized);
  const rawPath = fromFileUri || normalized;
  const withForwardSlashes = rawPath.replace(/\\/g, "/").replace(WINDOWS_UNC_PREFIX_RE, "");
  const normalizedDrivePrefix = /^\/[A-Za-z]:\//.test(withForwardSlashes)
    ? withForwardSlashes.slice(1)
    : withForwardSlashes;

  if (WINDOWS_DRIVE_ROOT_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalizedDrivePrefix)) {
    return normalizedDrivePrefix.replace(/\/+$/g, "");
  }
  return normalizedDrivePrefix.replace(/\/+$/g, "");
}

function isAbsoluteWorkspacePath(value) {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) {
    return false;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(normalized)) {
    return true;
  }
  return path.posix.isAbsolute(normalized);
}

function extractPathFromFileUri(value) {
  const input = String(value || "").trim();
  if (!/^file:\/\//i.test(input)) {
    return "";
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "file:") {
      return "";
    }
    const pathname = decodeURIComponent(parsed.pathname || "");
    const withHost = parsed.host && parsed.host !== "localhost"
      ? `//${parsed.host}${pathname}`
      : pathname;
    return withHost;
  } catch {
    return "";
  }
}

function isPathWithinAllowedDirectories(rawPath, configuredWorkspaceRoot = "") {
  const resolved = path.resolve(rawPath);
  const normalized = resolved.replace(/\\/g, "/") + "/";
  const allowedDirs = [
    os.homedir(),
    process.cwd(),
    configuredWorkspaceRoot,
  ]
    .filter(Boolean)
    .map((dir) => path.resolve(dir).replace(/\\/g, "/") + "/");
  return allowedDirs.some((prefix) => normalized.startsWith(prefix));
}

function normalizeCommandArgument(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThreadId(value) {
  const normalized = normalizeCommandArgument(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\s+/g, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function matchesBuiltInCommandPrefix(commandTokens) {
  const normalized = normalizeCommandTokensForMatching(commandTokens);
  if (!normalized.length) {
    return false;
  }

  if (normalized[0] === "view_image") {
    return true;
  }

   if (normalized[0] === "mcp_tool" && normalized[1] === "cyberboss_tools") {
    return true;
  }

  return false;
}

function normalizeCommandTokensForMatching(commandTokens) {
  return canonicalizeCommandTokens(commandTokens);
}

function buildApprovalPromptText(approval) {
  if (approval?.kind === "mcp_elicitation") {
    return buildElicitationApprovalPromptText(approval);
  }
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const toolName = extractToolNameFromReason(reasonText) || "";
  const commandLines = commandText ? commandText.split("\n") : [];
  const firstCommandLine = normalizeText(commandLines[0]);
  const restCommandLines = commandLines.slice(1);
  const shouldShowReason = reasonText && normalizeText(reasonText) !== normalizeText(`Tool: ${firstCommandLine}`);

  const out = [];
  out.push(`🔐 【Approval】${toolName || "Tool request"}`);

  if (shouldShowReason) {
    out.push(`📋 ${reasonText}`);
  }

  if (commandText) {
    if (firstCommandLine) {
      out.push(`⌨️ ${firstCommandLine}`);
    }
    if (restCommandLines.length) {
      out.push(restCommandLines.map((line) => `  ${line}`).join("\n"));
    }
  }

  if (!reasonText && !commandText) {
    out.push("❓ (unknown)");
  }

  out.push("━━━━━━━━━━━━━");
  out.push("💬 Reply with:");
  out.push("👉 /yes    allow once");
  out.push("👉 /always auto-allow");
  out.push("👉 /no     deny");

  return out.join("\n");
}

function extractToolNameFromReason(reason) {
  const normalized = normalizeText(reason);
  if (!normalized) return "";
  if (normalized.toLowerCase().startsWith("tool:")) {
    return normalized.slice(5).trim();
  }
  return normalized;
}

function buildApprovalPromptSignature(approval) {
  const reasonText = normalizeText(approval?.reason);
  const commandText = normalizeText(approval?.command);
  const commandTokens = Array.isArray(approval?.commandTokens)
    ? approval.commandTokens.map((token) => normalizeCommandArgument(token)).filter(Boolean)
    : [];
  return JSON.stringify({
    kind: normalizeText(approval?.kind),
    reason: reasonText,
    command: commandText,
    commandTokens,
    responseTemplate: approval?.responseTemplate || null,
  });
}

function buildApprovalResponsePayload(approval, commandName) {
  const requestId = approval?.requestId;
  if (requestId == null || String(requestId).trim() === "") {
    return null;
  }
  if (approval?.kind === "mcp_tool_call" || approval?.kind === "mcp_elicitation") {
    const responseByCommand = approval?.responseTemplate?.responseByCommand;
    const result = responseByCommand && typeof responseByCommand === "object"
      ? responseByCommand[commandName]
      : null;
    if (!result || typeof result !== "object") {
      return null;
    }
    return { requestId, result };
  }
  const decision = commandName === "no" ? "decline" : "accept";
  return { requestId, decision };
}

function buildApprovalResponseText(approval, commandName, approvalResponse) {
  if (approval?.kind === "mcp_tool_call" || approval?.kind === "mcp_elicitation") {
    if (commandName === "yes") {
      return "✅ This request has been approved.";
    }
    return "❌ This request has been cancelled.";
  }
  return commandName === "always"
    ? "💡 Auto-approve enabled for this command prefix in the current workspace."
    : (commandName === "yes" ? "✅ This request has been approved." : "❌ This request has been denied.");
}

function buildElicitationApprovalPromptText(approval) {
  const elicitation = approval?.elicitation || {};
  const messageText = normalizeText(elicitation?.message);
  const commandText = normalizeText(approval?.command);
  const approvalKind = normalizeText(elicitation?.approvalKind);
  const out = [];
  out.push(`🔐 【Approval】${normalizeText(approval?.reason) || "MCP request"}`);
  if (messageText) {
    out.push(`📋 ${messageText.split("\n")[0]}`);
  }
  if (commandText) {
    const commandLines = commandText.split("\n").map((line) => normalizeText(line)).filter(Boolean);
    if (commandLines.length) {
      out.push(`⌨️ ${commandLines[0]}`);
      if (commandLines.length > 1) {
        out.push(commandLines.slice(1).map((line) => `  ${line}`).join("\n"));
      }
    }
  }

  const toolDescription = normalizeText(elicitation?.toolDescription);
  if (toolDescription && approvalKind === "mcp_tool_call") {
    out.push("━━━━━━━━━━━━━");
    out.push(`🧾 ${toolDescription}`);
  }

  const supportedCommands = new Set(
    Array.isArray(approval?.responseTemplate?.supportedCommands)
      ? approval.responseTemplate.supportedCommands
      : []
  );
  out.push("━━━━━━━━━━━━━");
  out.push("💬 Reply with:");
  if (supportedCommands.has("yes")) {
    out.push("👉 /yes    allow once");
  }
  if (supportedCommands.has("no")) {
    out.push("👉 /no     cancel this request");
  }
  if (!supportedCommands.size) {
    out.push("⚠️ This Codex MCP request cannot be answered from WeChat yet.");
  }

  return out.join("\n");
}

function buildReminderSystemTrigger(reminder, config = {}) {
  const reminderText = String(reminder?.text || "").trim();
  const userName = String(config?.userName || "").trim() || "the user";
  return `Due reminder for ${userName}: ${reminderText}`;
}

function buildScopeKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = normalizeText(bindingKey);
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

function isAutoApprovedStateDirOperation(approval, config = {}) {
  const stateDir = normalizeText(config?.stateDir);
  if (!stateDir) {
    return false;
  }

  const filePaths = extractApprovalFilePaths(approval);
  if (!filePaths.length) {
    return false;
  }

  return filePaths.every((filePath) => isPathWithinRoot(filePath, stateDir));
}

function sortInboundUpdateMessages(messages) {
  return Array.isArray(messages)
    ? messages.slice().sort(compareRawInboundUpdateMessages)
    : [];
}

function compareRawInboundUpdateMessages(left, right) {
  const leftTime = resolveRawInboundMessageTimeMs(left);
  const rightTime = resolveRawInboundMessageTimeMs(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftMessageId = parseMessageIdForOrdering(left?.message_id);
  const rightMessageId = parseMessageIdForOrdering(right?.message_id);
  if (leftMessageId !== rightMessageId) {
    return leftMessageId - rightMessageId;
  }

  const leftSeq = parseNumericOrderValue(left?.seq);
  const rightSeq = parseNumericOrderValue(right?.seq);
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return String(left?.client_id || "").localeCompare(String(right?.client_id || ""));
}

function resolveRawInboundMessageTimeMs(message) {
  const createdAtMs = parseNumericOrderValue(message?.create_time_ms);
  if (createdAtMs > 0) {
    return createdAtMs;
  }
  const createdAtSeconds = parseNumericOrderValue(message?.create_time);
  return createdAtSeconds > 0 ? createdAtSeconds * 1000 : 0;
}

function comparePendingInboundMessages(left, right) {
  const leftTime = Date.parse(String(left?.receivedAt || "")) || 0;
  const rightTime = Date.parse(String(right?.receivedAt || "")) || 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftMessageId = parseMessageIdForOrdering(left?.messageId);
  const rightMessageId = parseMessageIdForOrdering(right?.messageId);
  if (leftMessageId !== rightMessageId) {
    return leftMessageId - rightMessageId;
  }

  return String(left?.text || "").localeCompare(String(right?.text || ""));
}

function parseMessageIdForOrdering(value) {
  const numeric = parseNumericOrderValue(value);
  return numeric > 0 ? numeric : Number.MAX_SAFE_INTEGER;
}

function parseNumericOrderValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DEFERRED_REPLY_NOTICE = "由于微信 context_token 的限制，上轮对话里有一部分内容当时没能送达；这次用户再次发来消息、context_token 刷新后，先把遗留内容补上。如果这种情况反复出现，可发送 /chunk <数字>（例如 /chunk 50）调大最小合并字符数，减少消息分片。";
const DEFERRED_PLAIN_REPLY_HEADER = "===== 上轮对话遗留内容 =====";
const DEFERRED_SYSTEM_REPLY_HEADER = "===== 期间模型主动联系 =====";

function formatDeferredSystemReplyText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return DEFERRED_REPLY_NOTICE;
  }
  if (normalized.startsWith(DEFERRED_REPLY_NOTICE)) {
    return normalized;
  }
  return `${DEFERRED_REPLY_NOTICE}\n\n${normalized}`;
}

function formatDeferredSystemReplyBatch(replies) {
  const grouped = groupDeferredReplies(replies);
  if (!grouped.plain.length && !grouped.system.length) {
    return DEFERRED_REPLY_NOTICE;
  }
  const parts = [
    DEFERRED_REPLY_NOTICE,
  ];
  if (grouped.plain.length) {
    parts.push("", DEFERRED_PLAIN_REPLY_HEADER, grouped.plain.join("\n\n"));
  }
  if (grouped.system.length) {
    parts.push("", DEFERRED_SYSTEM_REPLY_HEADER, grouped.system.join("\n\n"));
  }
  return parts.join("\n");
}

function groupDeferredReplies(replies) {
  const grouped = { plain: [], system: [] };
  for (const reply of Array.isArray(replies) ? replies : []) {
    const normalizedText = String(reply?.text || "").trim();
    if (!normalizedText) {
      continue;
    }
    if (reply?.kind === "system_reply") {
      grouped.system.push(normalizedText);
      continue;
    }
    grouped.plain.push(normalizedText);
  }
  return grouped;
}

function formatWechatLocalTime(receivedAt) {
  const value = typeof receivedAt === "string" ? receivedAt.trim() : "";
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed).replace(/\//g, "-");
}

function stringifyRpcId(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function hasRpcId(value) {
  return stringifyRpcId(value) !== "";
}
