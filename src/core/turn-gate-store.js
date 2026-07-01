// Turn gate: prevents concurrent turns on the same binding+workspace.
//
// Gate lifecycle:
//   begin()  → scope locked, new turns blocked
//   releaseScope() / releaseThread() → scope unlocked (called by app.js when turn
//     completes, fails, or is abandoned)
//
// There is NO timeout-based auto-release during normal operation. The gate is
// released ONLY by explicit app.js calls. The cleanup timer is a last-resort
// safety net (15 min) for truly orphaned scopes from crashed processes.
const GATE_CLEANUP_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — last-resort safety net

class TurnGateStore {
  constructor() {
    this.scopeByThreadId = new Map();
    this.pendingScopeKeys = new Map(); // scopeKey → timestamp
    this._timeoutId = null;
  }

  begin(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) {
      return "";
    }
    if (!this.pendingScopeKeys.has(scopeKey)) {
      this.pendingScopeKeys.set(scopeKey, Date.now());
    }
    // else: already locked, don't reset timer — preserves original timestamp
    this._scheduleCleanup();
    return scopeKey;
  }

  attachThread(scopeKey, threadId) {
    const normalizedScopeKey = normalizeText(scopeKey);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedScopeKey || !normalizedThreadId) {
      return;
    }
    this.scopeByThreadId.set(normalizedThreadId, normalizedScopeKey);
  }

  releaseScope(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) {
      return;
    }
    this.pendingScopeKeys.delete(scopeKey);
  }

  releaseThread(threadId) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const scopeKey = this.scopeByThreadId.get(normalizedThreadId) || "";
    if (scopeKey) {
      this.pendingScopeKeys.delete(scopeKey);
      this.scopeByThreadId.delete(normalizedThreadId);
    }
  }

  // isPending() checks only whether the scope exists — no timeout-based
  // auto-release. The gate is released explicitly by app.js when the turn
  // completes, fails, or is abandoned via releaseScope/releaseThread.
  isPending(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) return false;
    return this.pendingScopeKeys.has(scopeKey);
  }

  _removeScopeFromThreadIndex(scopeKey) {
    for (const [threadId, key] of this.scopeByThreadId) {
      if (key === scopeKey) {
        this.scopeByThreadId.delete(threadId);
      }
    }
  }

  // Last-resort safety net: release scopes that have been orphaned for >15 min.
  // This should almost never fire in normal operation — it's here for crash
  // recovery (e.g. process killed mid-turn without cleanup).
  _scheduleCleanup() {
    if (this._timeoutId) return;
    this._timeoutId = setTimeout(() => {
      this._timeoutId = null;
      const now = Date.now();
      for (const [key, startedAt] of this.pendingScopeKeys) {
        const ts = typeof startedAt === "number" ? startedAt : 0;
        if (now - ts > GATE_CLEANUP_TIMEOUT_MS) {
          console.warn(`[turn-gate] cleanup releasing orphaned scope scopeKey=${key} age=${Math.round((now - ts) / 1000)}s`);
          this.pendingScopeKeys.delete(key);
          this._removeScopeFromThreadIndex(key);
        }
      }
      if (this.pendingScopeKeys.size > 0) {
        this._scheduleCleanup();
      }
    }, GATE_CLEANUP_TIMEOUT_MS + 30_000).unref();
  }
}

function buildTurnScopeKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = normalizeText(bindingKey);
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { TurnGateStore };
