const fs = require("fs");
const path = require("path");

class RuntimeContextStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = { contextsByWorkspaceRoot: {} };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.contextsByWorkspaceRoot) {
        this.state = {
          contextsByWorkspaceRoot: parsed.contextsByWorkspaceRoot,
        };
      }
    } catch {
      this.state = { contextsByWorkspaceRoot: {} };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  setActiveContext({
    workspaceRoot = "",
    runtimeId = "",
    threadId = "",
    bindingKey = "",
    accountId = "",
    senderId = "",
    model = "",
  } = {}) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return null;
    }
    const normalizedModel = normalizeText(model);
    const compositeKey = normalizedWorkspaceRoot + "::" + normalizedModel;
    const next = {
      workspaceRoot: normalizedWorkspaceRoot,
      runtimeId: normalizeText(runtimeId),
      threadId: normalizeText(threadId),
      bindingKey: normalizeText(bindingKey),
      accountId: normalizeText(accountId),
      senderId: normalizeText(senderId),
      model: normalizedModel,
      updatedAt: new Date().toISOString(),
    };
    this.state.contextsByWorkspaceRoot = {
      ...(this.state.contextsByWorkspaceRoot || {}),
      [compositeKey]: next,
    };
    this.save();
    return next;
  }

  resolveActiveContext({ workspaceRoot = "", runtimeId = "", model = "" } = {}) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    const normalizedModel = normalizeText(model);

    if (normalizedWorkspaceRoot && normalizedModel) {
      const compositeKey = normalizedWorkspaceRoot + "::" + normalizedModel;
      const exact = this.state.contextsByWorkspaceRoot?.[compositeKey];
      if (exact) return exact;
      return null;
    }

    const entries = Object.values(this.state.contextsByWorkspaceRoot || {})
      .filter((entry) => entry && typeof entry === "object");
    const normalizedRuntimeId = normalizeText(runtimeId);
    let scoped = normalizedWorkspaceRoot
      ? entries.filter((entry) => normalizeText(entry.workspaceRoot) === normalizedWorkspaceRoot)
      : entries;
    if (normalizedRuntimeId) {
      const byRuntime = scoped.filter((entry) => normalizeText(entry.runtimeId) === normalizedRuntimeId);
      if (byRuntime.length) scoped = byRuntime;
    }
    const sorted = scoped.sort((left, right) => {
      const leftMs = Date.parse(left.updatedAt || "") || 0;
      const rightMs = Date.parse(right.updatedAt || "") || 0;
      return rightMs - leftMs;
    });
    return sorted[0] || null;
  }

  clearWorkspace(workspaceRoot = "") {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot || !this.state.contextsByWorkspaceRoot?.[normalizedWorkspaceRoot]) {
      return false;
    }
    delete this.state.contextsByWorkspaceRoot[normalizedWorkspaceRoot];
    this.save();
    return true;
  }

  clearAll() {
    this.state = { contextsByWorkspaceRoot: {} };
    this.save();
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { RuntimeContextStore };
