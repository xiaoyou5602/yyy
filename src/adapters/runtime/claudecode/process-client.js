const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

class ClaudeCodeProcessClient {
  constructor({ command = "claude", cwd, env, model = "", permissionMode = "default", disableVerbose = false, extraArgs = [], mcpConfigPaths = [], ipcServer = null, workspaceRoot = "", settingsPath = "" }) {
    this.command = command;
    this.cwd = cwd;
    this.env = env;
    this.model = model;
    this.permissionMode = permissionMode;
    this.disableVerbose = disableVerbose;
    this.extraArgs = extraArgs;
    this.mcpConfigPaths = mcpConfigPaths;
    this.ipcServer = ipcServer;
    this.workspaceRoot = workspaceRoot;
    this.settingsPath = settingsPath;
    this.child = null;
    this.stdin = null;
    this.stdoutBuffer = "";
    this.listeners = new Set();
    this.pendingTurnId = "";
    this.sessionId = "";
    this.resumeSessionId = "";
    this.activeThreadId = "";
    this._alive = false;
    this.sessionWaiters = new Set();
    this.suppressNextCloseEvent = false;
  }

  get alive() {
    if (!this._alive) return false;
    if (!this.child) return false;
    if (this.child.killed) return false;
    if (this.child.exitCode !== null) return false;
    return true;
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event, raw) {
    if (this.ipcServer) {
      this.ipcServer.broadcast({ type: "processEvent", event, raw });
    }
    for (const listener of this.listeners) {
      try {
        listener(event, raw);
      } catch {
        // ignore
      }
    }
  }

  async connect(resumeSessionId = "") {
    if (this.child) return;
    this.suppressNextCloseEvent = false;
    this.sessionId = "";
    this.resumeSessionId = isValidSessionId(resumeSessionId) ? resumeSessionId : "";
    this.activeThreadId = "";
    const args = buildArgs({
      model: this.model,
      permissionMode: this.permissionMode,
      disableVerbose: this.disableVerbose,
      extraArgs: this.extraArgs,
      mcpConfigPaths: this.mcpConfigPaths,
      resumeSessionId,
      settingsPath: this.settingsPath,
    });
    const mcpLabel = this.mcpConfigPaths.length
      ? this.mcpConfigPaths.join(",")
      : "(none)";
    console.log(
      `[claudecode-runtime] launching command=${this.command} cwd=${this.cwd} mcp_config=${mcpLabel}`
    );
    const child = spawn(this.command, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });
    // DEBUG: dump env vars to file for verification
    try {
      const fs = require("fs");
      const path = require("path");
      const debugEnv = {
        ANTHROPIC_BASE_URL: this.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_MODEL: this.env.ANTHROPIC_MODEL,
        ANTHROPIC_AUTH_TOKEN: this.env.ANTHROPIC_AUTH_TOKEN ? "(set)" : "(empty)",
        ANTHROPIC_DEFAULT_OPUS_MODEL: this.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        USERPROFILE: this.env.USERPROFILE,
        HOME: this.env.HOME,
        spawnCmd: this.command,
        spawnArgs: args,
      };
      fs.writeFileSync(path.join(this.env.USERPROFILE || process.env.USERPROFILE || ".", "spawn-debug.json"), JSON.stringify(debugEnv, null, 2) + "\n");
    } catch (e) {
      console.error("[claudecode-runtime] debug env dump failed:", e.message);
    }
    this.child = child;
    this.stdin = child.stdin;
    this._alive = true;
    trackChildPid(child.pid);

    child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        this.handleLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        console.error(`[claudecode-runtime] stderr: ${text}`);
        if (this.ipcServer && !isPotentiallySensitive(text)) {
          this.ipcServer.broadcast({ type: "stderr", text });
        }
      }
    });

    child.on("error", (err) => {
      untrackChildPid(child.pid);
      this.rejectSessionWaiters(err);
      this._alive = false;
      this.child = null;
      this.stdin = null;
      this.emit({ type: "process.error", error: err.message, sessionId: this.activeThreadId || this.sessionId, turnId: this.pendingTurnId }, null);
    });

    child.on("close", (code) => {
      const exitedPid = child.pid;
      untrackChildPid(exitedPid);
      this.rejectSessionWaiters(new Error(`claudecode process closed with code ${code ?? "unknown"}`));
      this._alive = false;
      this.child = null;
      this.stdin = null;
      if (this.suppressNextCloseEvent) {
        this.suppressNextCloseEvent = false;
        return;
      }
      // Kill residual process tree (MCP children, etc.) on unexpected close.
      // Expected close (via this.close()) sets suppressNextCloseEvent and handles cleanup itself.
      if (process.platform === "win32" && exitedPid) {
        killWindowsProcessTree(exitedPid).catch(() => {});
      }
      this.emit({ type: "process.close", code, sessionId: this.activeThreadId || this.sessionId, turnId: this.pendingTurnId }, null);
    });
  }

  handleLine(line) {
    if (!line) return;
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    const eventType = raw?.type;
    switch (eventType) {
      case "system":
        if (raw.session_id) {
          const reportedSessionId = this.acceptReportedSessionId(raw.session_id, raw);
          if (reportedSessionId) {
            this.emit({ type: "session.id", sessionId: reportedSessionId }, raw);
          }
        }
        break;
      case "assistant":
        this.handleAssistant(raw);
        break;
      case "user":
        this.handleUser(raw);
        break;
      case "result":
        this.handleResult(raw);
        break;
      case "control_request":
        this.handleControlRequest(raw);
        break;
      case "control_cancel_request":
        break;
    }
  }

  handleAssistant(raw) {
    const usage = raw?.message?.usage;
    if (usage && typeof usage === "object") {
      this.emit({
        type: "context.updated",
        usage,
        turnId: this.pendingTurnId,
        sessionId: this.activeThreadId || this.sessionId,
      }, raw);
    }
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const itemType = item.type;
      if (itemType === "text" && typeof item.text === "string" && item.text) {
        this.emit({
          type: "assistant.text",
          text: item.text.trim(),
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      } else if (itemType === "tool_use") {
        const toolName = typeof item.name === "string" ? item.name : "";
        if (toolName === "AskUserQuestion") continue;
        this.emit({
          type: "tool.use",
          toolName,
          input: item.input || {},
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      } else if (itemType === "thinking" && typeof item.thinking === "string" && item.thinking) {
        this.emit({
          type: "thinking",
          text: item.thinking.trim(),
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      }
    }
  }

  handleUser(raw) {
    const content = raw?.message?.content;
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "tool_result") {
        const isError = Boolean(item.is_error);
        const resultText = typeof item.content === "string" ? item.content : "";
        this.emit({
          type: "tool.result",
          toolResult: resultText,
          isError,
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      }
    }
  }

  handleResult(raw) {
    if (raw.session_id) {
      const reportedSessionId = this.acceptReportedSessionId(raw.session_id, raw);
      if (!reportedSessionId) {
        return;
      }
    }
    this.emit({
      type: "turn.completed",
      turnId: this.pendingTurnId,
      sessionId: this.activeThreadId || this.sessionId,
      text: typeof raw.result === "string" ? raw.result.trim() : "",
    }, raw);
    this.pendingTurnId = "";
    this.activeThreadId = "";
  }

  acceptReportedSessionId(sessionId, raw) {
    const reportedSessionId = normalizeSessionId(sessionId);
    if (!reportedSessionId) {
      return "";
    }
    const expectedSessionId = normalizeSessionId(this.activeThreadId || this.resumeSessionId);
    if (expectedSessionId && reportedSessionId !== expectedSessionId) {
      // Old session is gone — accept the new one instead of killing the process
      console.error(`[claudecode-runtime] session replaced: expected=${expectedSessionId} got=${reportedSessionId}`);
      this.resumeSessionId = "";
      this.activeThreadId = "";
    }
    if (this.pendingTurnId && !this.activeThreadId) {
      this.activeThreadId = reportedSessionId;
    }
    this.sessionId = reportedSessionId;
    this.resumeSessionId = "";
    this.resolveSessionWaiters(reportedSessionId);
    return reportedSessionId;
  }

  rejectUnexpectedSessionId(expectedSessionId, reportedSessionId, raw) {
    this.suppressNextCloseEvent = true;
    this.emit({
      type: "process.error",
      error: `claudecode resumed unexpected session id: ${reportedSessionId}`,
      sessionId: expectedSessionId,
      turnId: this.pendingTurnId,
    }, raw);
    setImmediate(() => {
      this.close().catch(() => {});
    });
  }

  handleControlRequest(raw) {
    const request = raw?.request || {};
    if (request.subtype !== "can_use_tool") return;
    this.emit({
      type: "approval.requested",
      requestId: raw.request_id,
      toolName: request.tool_name,
      input: request.input,
      sessionId: this.activeThreadId || this.sessionId,
      turnId: this.pendingTurnId,
    }, raw);
  }

  async sendUserMessage({ text, threadId }) {
    if (!this.alive || !this.stdin) {
      throw new Error("claudecode process not running");
    }
    this.pendingTurnId = `turn-${Date.now()}`;
    this.activeThreadId = threadId || this.sessionId;
    if (this.ipcServer) {
      this.ipcServer.broadcast({
        type: "inboundMessage",
        workspaceRoot: this.workspaceRoot,
        text,
      });
    }
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
    });
    this.stdin.write(payload + "\n");
    this.emit({
      type: "turn.started",
      turnId: this.pendingTurnId,
      sessionId: this.activeThreadId,
    }, null);
  }

  async sendResponse(requestId, { decision }) {
    if (!this.alive || !this.stdin) {
      throw new Error("claudecode process not running");
    }
    const behavior = decision === "accept" ? "allow" : "deny";
    const response = behavior === "allow"
      ? { behavior: "allow", updatedInput: {} }
      : { behavior: "deny", message: "The user denied this tool use. Stop and wait for the user's instructions." };
    const payload = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    });
    this.stdin.write(payload + "\n");
  }

  async waitForSessionId({ timeoutMs = 5000 } = {}) {
    if (this.sessionId) {
      return this.sessionId;
    }
    if (!this.alive) {
      throw new Error("claudecode process not running");
    }
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
    return await new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        this.sessionWaiters.delete(entry);
        reject(new Error("timed out waiting for claudecode session id"));
      }, timeout);
      this.sessionWaiters.add(entry);
    });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    const childPid = child.pid;
    if (this.stdin && !this.stdin.destroyed) {
      this.stdin.end();
    }
    if (process.platform === "win32" && childPid) {
      await waitForCloseOrTimeout(child, 1500);
      if (this.child === child) {
        await killWindowsProcessTree(childPid);
        await waitForCloseOrTimeout(child, 3000);
      }
    } else {
      if (this.child && !this.child.killed) {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, 2000)),
          new Promise((resolve) => this.child.once("close", resolve)),
        ]);
      }
      if (this.child && !this.child.killed) {
        this.child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, 3000)),
          new Promise((resolve) => this.child.once("close", resolve)),
        ]);
      }
      if (this.child && !this.child.killed) {
        this.child.kill("SIGKILL");
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, 1000)),
          new Promise((resolve) => this.child.once("close", resolve)),
        ]);
      }
    }
    untrackChildPid(childPid);
    this._alive = false;
    this.child = null;
    this.stdin = null;
    this.sessionId = "";
    this.resumeSessionId = "";
    this.activeThreadId = "";
    this.pendingTurnId = "";
    this.rejectSessionWaiters(new Error("claudecode process closed"));
  }

  resolveSessionWaiters(sessionId) {
    if (!this.sessionWaiters.size) {
      return;
    }
    for (const entry of this.sessionWaiters) {
      clearTimeout(entry.timer);
      entry.resolve(sessionId);
    }
    this.sessionWaiters.clear();
  }

  rejectSessionWaiters(error) {
    if (!this.sessionWaiters.size) {
      return;
    }
    for (const entry of this.sessionWaiters) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.sessionWaiters.clear();
  }
}

function buildArgs({ model, permissionMode, disableVerbose, extraArgs, mcpConfigPaths, resumeSessionId, settingsPath }) {
  const args = [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--permission-prompt-tool", "stdio",
  ];
  if (!disableVerbose) {
    args.push("--verbose");
  }
  if (permissionMode && permissionMode !== "default") {
    args.push("--permission-mode", permissionMode);
  }
  if (resumeSessionId && isValidSessionId(resumeSessionId)) {
    args.push("--resume", resumeSessionId);
  }
  if (settingsPath) {
    args.push("--settings", settingsPath);
  }
  if (model) {
    args.push("--model", model);
  }
  if (Array.isArray(mcpConfigPaths)) {
    for (const configPath of mcpConfigPaths) {
      if (typeof configPath === "string" && configPath.trim()) {
        args.push("--mcp-config", configPath.trim());
      }
    }
  }
  if (Array.isArray(extraArgs)) {
    const safe = extraArgs.filter((arg) =>
      typeof arg === "string" && arg.length > 0 && !/^-[ce]\b/i.test(arg)
    );
    args.push(...safe);
  }
  return args;
}

function isValidSessionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
}

function normalizeSessionId(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function getPidFilePath() {
  return path.join(os.homedir(), ".cyberboss", "claude-child-pids.txt");
}

function readTrackedPids() {
  try {
    return fs.readFileSync(getPidFilePath(), "utf8")
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function writeTrackedPids(pids) {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const pidFile = getPidFilePath();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  if (!unique.length) {
    try {
      fs.unlinkSync(pidFile);
    } catch {}
    return;
  }
  fs.writeFileSync(pidFile, unique.join("\n") + "\n", "utf8");
}

function trackChildPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    writeTrackedPids([...readTrackedPids(), pid]);
  } catch (err) {
    console.error(`[claudecode-runtime] failed to track child pid ${pid}: ${err.message}`);
  }
}

function untrackChildPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    writeTrackedPids(readTrackedPids().filter((candidate) => candidate !== pid));
  } catch (err) {
    console.error(`[claudecode-runtime] failed to untrack child pid ${pid}: ${err.message}`);
  }
}

function waitForCloseOrTimeout(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return Promise.race([
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    new Promise((resolve) => child.once("close", resolve)),
  ]);
}

function killWindowsProcessTree(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => resolve());
    killer.on("close", () => resolve());
  });
}

const SENSITIVE_KEYWORDS = /\b(?:key|token|secret|password|credential|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\b/i;
const SENSITIVE_PATTERNS = /\b(?:sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/i;

function isPotentiallySensitive(text) {
  return SENSITIVE_KEYWORDS.test(text) || SENSITIVE_PATTERNS.test(text);
}

module.exports = { ClaudeCodeProcessClient };
