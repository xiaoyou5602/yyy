const GATE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min — auto-release stuck gates

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

  isPending(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) return false;
    if (!this.pendingScopeKeys.has(scopeKey)) return false;
    const startedAt = this.pendingScopeKeys.get(scopeKey);
    if (typeof startedAt === "number" && Date.now() - startedAt > GATE_TIMEOUT_MS) {
      console.warn(`[turn-gate] auto-releasing stuck gate scopeKey=${scopeKey} age=${Math.round((Date.now() - startedAt) / 1000)}s`);
      this.pendingScopeKeys.delete(scopeKey);
      this._removeScopeFromThreadIndex(scopeKey);
      return false;
    }
    return true;
  }

  _removeScopeFromThreadIndex(scopeKey) {
    for (const [threadId, key] of this.scopeByThreadId) {
      if (key === scopeKey) {
        this.scopeByThreadId.delete(threadId);
      }
    }
  }

  _scheduleCleanup() {
    if (this._timeoutId) return;
    this._timeoutId = setTimeout(() => {
      this._timeoutId = null;
      const now = Date.now();
      for (const [key, startedAt] of this.pendingScopeKeys) {
        if (now - startedAt > GATE_TIMEOUT_MS) {
          console.warn(`[turn-gate] cleanup releasing stuck gate scopeKey=${key} age=${Math.round((now - startedAt) / 1000)}s`);
          this.pendingScopeKeys.delete(key);
          this._removeScopeFromThreadIndex(key);
        }
      }
      if (this.pendingScopeKeys.size > 0) {
        this._scheduleCleanup();
      }
    }, GATE_TIMEOUT_MS + 30_000).unref();
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
