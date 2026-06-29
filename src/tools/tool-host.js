const fs = require("fs");
const path = require("path");
const os = require("os");
const { WhereaboutsToolHost } = require("whereabouts-mcp");
const {
  STICKER_DESC_GUIDANCE,
  STICKER_DESC_FIELD_DESCRIPTION,
  STICKER_TAG_GUIDANCE,
} = require("../services/sticker-service");
const { resolveModelKey } = require("../core/config");

class ProjectToolHost {
  constructor({ services, runtimeContextStore }) {
    this.services = services;
    this.runtimeContextStore = runtimeContextStore;
    this.extraToolHosts = createExtraToolHosts(services);
  }

  listTools() {
    const builtIn = PROJECT_TOOLS.map((tool) => ({
      name: tool.name,
      description: buildToolDescription(tool),
      inputSchema: tool.inputSchema,
    }));
    const extra = this.extraToolHosts.flatMap((host) => host.listTools());
    return [...builtIn, ...extra];
  }

  async invokeTool(toolName, args = {}, context = {}) {
    const spec = PROJECT_TOOLS.find((candidate) => candidate.name === toolName);
    const normalizedArgs = args && typeof args === "object" ? args : {};
    if (spec) {
      validateSchema(spec.inputSchema, normalizedArgs, toolName, "input");
      const resolvedContext = this.resolveContext(context);
      return await spec.handler({
        services: this.services,
        args: normalizedArgs,
        context: resolvedContext,
      });
    }
    for (const host of this.extraToolHosts) {
      if (host.listTools().some((tool) => tool.name === toolName)) {
        return await host.invokeTool(toolName, normalizedArgs);
      }
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  resolveContext(context = {}) {
    const explicitWorkspaceRoot = normalizeText(context.workspaceRoot);
    const explicitRuntimeId = normalizeText(context.runtimeId);
    const explicitThreadId = normalizeText(context.threadId);
    const explicitModel = normalizeText(context.model);
    const active = this.runtimeContextStore.resolveActiveContext({
      workspaceRoot: explicitWorkspaceRoot,
      runtimeId: explicitRuntimeId,
      model: explicitModel,
    }) || {};
    const resolvedWorkspaceRoot = explicitWorkspaceRoot || normalizeText(active.workspaceRoot);
    const storedThreadId = normalizeText(active.threadId);
    // When the runtime reports a different thread id than what the store remembers,
    // the old session was replaced (process died, was compacted, etc). Clear the
    // stale store entry so the next fallback resolve picks up the live session.
    if (explicitThreadId && storedThreadId && explicitThreadId !== storedThreadId && resolvedWorkspaceRoot) {
      if (this.runtimeContextStore.clearWorkspace) {
        this.runtimeContextStore.clearWorkspace(resolvedWorkspaceRoot);
      }
    }
    return {
      runtimeId: explicitRuntimeId || normalizeText(active.runtimeId),
      workspaceRoot: resolvedWorkspaceRoot,
      threadId: explicitThreadId || storedThreadId,
      bindingKey: normalizeText(context.bindingKey) || normalizeText(active.bindingKey),
      accountId: normalizeText(context.accountId) || normalizeText(active.accountId),
      senderId: normalizeText(context.senderId) || normalizeText(active.senderId),
      model: explicitModel || normalizeText(active.model),
    };
  }

  getMemoryServiceForModel(model) {
    const services = this.services || {};
    const memoryServices = services.memoryServices;
    if (!(memoryServices instanceof Map) || !memoryServices.size) {
      return services.memory;
    }
    const key = resolveModelKey(model);
    return memoryServices.get(key) || memoryServices.get("ds") || services.memory;
  }
}

function listProjectToolNames() {
  return [
    ...PROJECT_TOOLS.map((tool) => tool.name),
    ...STATIC_EXTRA_TOOL_NAMES,
  ];
}

const PROJECT_TOOLS = [
  {
    name: "cyberboss_diary_append",
    description: "Append a diary entry into Cyberboss local diary storage.",
    shortHint: "Append a diary entry with direct text content.",
    topics: ["diary"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Diary body to append." },
        title: { type: "string", description: "Optional short entry title." },
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
        time: { type: "string", description: "Optional time in HH:mm." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const model = context?.model || args?.model || "";
      const result = await services.diary.append({ ...args, model });
      return {
        text: `Diary appended to ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_search",
    description: "Search Cyberboss memory fragments by query text. Returns relevant memories sorted by relevance and heat.",
    shortHint: "Search memory fragments with a text query.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query text to find relevant memories." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;
      const results = await memory.search(args);
      return {
        text: results.length
          ? `Found ${results.length} memory fragments:\n${results.map((f) => `- [${f.type}] ${f.content} (heat: ${f.heat}${f.locked ? ", locked" : ""})`).join("\n")}`
          : "No memory fragments found.",
        data: { fragments: results, count: results.length },
      };
    },
  },
  {
    name: "cyberboss_memory_lock",
    description: "Lock a memory fragment so it never decays. Locked memories stay at high heat permanently.",
    shortHint: "Lock a memory fragment by id.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory fragment id (e.g. mem-2026-05-27-001)." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;
      const result = await memory.lockFragment(args.id);
      if (!result) {
        return { text: `Memory fragment not found: ${args.id}` };
      }
      return {
        text: `Memory fragment locked: ${result.content}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_unlock",
    description: "Unlock a previously locked memory fragment so it can decay normally again.",
    shortHint: "Unlock a memory fragment by id.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory fragment id (e.g. mem-2026-05-27-001)." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;
      const result = await memory.unlockFragment(args.id);
      if (!result) {
        return { text: `Memory fragment not found: ${args.id}` };
      }
      if (result.error === "protected") {
        return { text: result.message };
      }
      return {
        text: `Memory fragment unlocked: ${result.content}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_delete",
    description: "Soft-delete a memory fragment by id. Marks as deleted (tombstone) — not physically removed. Fragments created within 48 hours are protected; use cyberboss_memory_review first.",
    shortHint: "Soft-delete a memory fragment by id.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id", "reason"],
      properties: {
        id: { type: "string", description: "Memory fragment id (e.g. mem-2026-05-27-001)." },
        reason: { type: "string", description: "Why this fragment is being deleted (required for audit trail)." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;
      const deletedBy = context?.model || args?.model || "";
      const result = await memory.deleteFragment(args.id, deletedBy);
      if (!result) {
        return { text: `Memory fragment not found: ${args.id}` };
      }
      if (result.error === "already_deleted") {
        return { text: result.message };
      }
      if (result.error === "protected") {
        return { text: result.message };
      }
      // Write audit log
      try {
        const logDir = path.join(os.homedir(), ".cyberboss", "logs");
        fs.mkdirSync(logDir, { recursive: true });
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          action: "delete",
          fragmentId: args.id,
          content: result.deleted.content,
          deletedBy,
          reason: args.reason,
        });
        fs.appendFileSync(path.join(logDir, "audit.jsonl"), entry + "\n", "utf8");
      } catch {}
      return {
        text: `Memory fragment deleted: ${result.deleted.content}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_memory_review",
    description: "Mark a memory fragment for review (2-stage cleanup). First call: marks 'review' with intended action ('delete' or 'unlock'). Second call on an already-review fragment: executes the intended action. Use this during dream consolidation instead of directly deleting or unlocking — it forces a cooling-off period.",
    shortHint: "Mark a fragment for review, or confirm a pending review.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id", "reason", "action"],
      properties: {
        id: { type: "string", description: "Memory fragment id (e.g. mem-2026-05-27-001)." },
        reason: { type: "string", description: "Why this fragment should be deleted or unlocked." },
        action: { type: "string", enum: ["delete", "unlock"], description: "What you intend to do with this fragment after the review period." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;

      const store = memory.store;
      const found = store._findById(args.id);
      if (!found) {
        return { text: `Memory fragment not found: ${args.id}` };
      }

      if (found.fragment.status === "deleted") {
        return { text: `Fragment ${args.id} is already deleted — cannot review.` };
      }

      const currentStatus = found.fragment.status || "active";

      if (currentStatus === "review") {
        // Stage 2: confirm and execute
        if (found.fragment.intendedAction === "delete") {
          const deletedBy = context?.model || args?.model || "";
          const result = await memory.deleteFragment(args.id, deletedBy);
          if (result.error) {
            return { text: result.message || `Failed to delete: ${args.id}` };
          }
          // Audit log
          try {
            const logDir = path.join(os.homedir(), ".cyberboss", "logs");
            fs.mkdirSync(logDir, { recursive: true });
            const entry = JSON.stringify({
              ts: new Date().toISOString(),
              action: "delete",
              fragmentId: args.id,
              content: result.deleted?.content || "",
              deletedBy,
              reason: `[confirmed review] ${args.reason}`,
            });
            fs.appendFileSync(path.join(logDir, "audit.jsonl"), entry + "\n", "utf8");
          } catch {}
          return {
            text: `Review confirmed — fragment deleted: ${result.deleted?.content || args.id}`,
            data: result,
          };
        } else if (found.fragment.intendedAction === "unlock") {
          const result = await memory.unlockFragment(args.id);
          if (result.error) {
            return { text: result.message || `Failed to unlock: ${args.id}` };
          }
          return {
            text: `Review confirmed — fragment unlocked: ${result.content}`,
            data: result,
          };
        }
        return { text: `Fragment ${args.id} is under review but has no intendedAction set.` };
      }

      // Stage 1: mark for review
      await memory.markFragment(args.id, "review", {
        reviewReason: args.reason,
        intendedAction: args.action,
      });

      const actionLabel = args.action === "delete" ? "删除" : "解锁";
      return {
        text: `Fragment marked for review (intended: ${actionLabel}). Next dream cycle will confirm.\nReason: ${args.reason}`,
        data: { id: args.id, status: "review", intendedAction: args.action },
      };
    },
  },
  {
    name: "cyberboss_memory_read",
    description: "Read memory fragments by date or recent days. Use this to review what the system remembers.",
    shortHint: "Read memory fragments by date or recent range.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD. If omitted, returns recent 7 days." },
        days: { type: "integer", description: "Optional number of recent days (default 7, max 30). Ignored if date is set." },
        includeDeleted: { type: "boolean", description: "Include soft-deleted fragments (default false)." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const memory = services.getMemoryService
        ? services.getMemoryService(context?.model || args?.model || "")
        : services.memory;
      const opts = { includeDeleted: !!args.includeDeleted };
      let fragments;
      if (args.date) {
        fragments = memory.store.getByDate(args.date, opts);
      } else {
        const days = Math.min(args.days || 7, 30);
        fragments = memory.store.getRecent(days, opts);
      }
      return {
        text: fragments.length
          ? `${fragments.length} memory fragments:\n${fragments.map((f) => `- [${f.type}] ${f.content} (heat: ${f.heat}${f.locked ? ", locked" : ""}${f.status && f.status !== "active" ? `, ${f.status}` : ""})`).join("\n")}`
          : "No memory fragments found.",
        data: { fragments, count: fragments.length },
      };
    },
  },
  {
    name: "cyberboss_reminder_create",
    description: "Create a reminder in Cyberboss.",
    shortHint: "Create a reminder with direct text plus delayMinutes or dueAt.",
    topics: ["reminder"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Reminder text to send back later." },
        delayMinutes: { type: "integer", description: "Minutes from now before the reminder fires." },
        dueAt: { type: "string", description: "Absolute time such as 2026-04-07T21:30+08:00." },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.reminder.create(args, context);
      return {
        text: `Reminder queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_system_send",
    description: "Queue an internal Cyberboss system trigger for the current bound workspace and chat.",
    shortHint: "Queue an internal system message for the current workspace.",
    topics: ["system"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        workspaceRoot: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = services.system.queueMessage(args, context);
      return {
        text: `System message queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_channel_send_file",
    description: "Send an existing local file back to the current WeChat chat.",
    shortHint: "Send a local file back to the current WeChat user.",
    topics: ["channel"],
    inputSchema: {
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.channelFile.sendToCurrentChat(args, context);
      return {
        text: `File sent: ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_tags",
    description: `Load the current sticker tag catalog and tagging rules only when you have decided a sticker is needed or an inbox image should be saved as a sticker. ${STICKER_TAG_GUIDANCE}`,
    shortHint: "Load sticker tags only when needed.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.sticker.listTags();
      return {
        text: `Sticker tags loaded: ${Array.isArray(result.tags) ? result.tags.length : 0}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_pick",
    description: "List a few saved sticker candidates for one sticker tag after you have decided a sticker would help.",
    shortHint: "Pick sticker candidates by tag.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["tag"],
      properties: {
        tag: { type: "string", description: "Sticker tag such as 可爱, 无语, 躺平, 感动, or OK." },
        limit: { type: "integer", description: "Optional maximum number of candidates to return." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.pick(args);
      return {
        text: `Sticker candidates loaded: ${result.candidates.length}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_send",
    description: "Send a saved sticker back to the current chat by sticker id.",
    shortHint: "Send a saved sticker by id.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["stickerId"],
      properties: {
        stickerId: { type: "string", description: "Sticker id such as stk_001." },
        userId: { type: "string", description: "Optional explicit user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.sendToCurrentChat(args, context);
      return {
        text: `Sticker sent: ${result.stickerId}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_delete",
    description: "Delete one or more saved stickers by sticker id and remove their local GIF files.",
    shortHint: "Delete saved stickers by id array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.delete(args, context);
      return {
        text: `Sticker batch deleted: ${result.deletedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_save_from_inbox",
    description: `Save one or more inbox images as reusable sticker GIFs after reading them all. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Save inbox stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          description: "One to ten inbox stickers to save in one call.",
          items: {
            type: "object",
            required: ["filePath", "tags", "desc"],
            properties: {
              filePath: { type: "string", description: "Absolute inbox image path under ~/.cyberboss/inbox." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when the current catalog does not fit.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
        userId: { type: "string", description: "Optional explicit WeChat user id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.saveFromInbox(args, context);
      const duplicateNote = result.dedupedCount > 0
        ? " Existing stickers usually mean the user only sent them for you to see. Do not mention duplicates; just reply normally."
        : "";
      return {
        text: `Sticker batch processed: ${result.createdCount} saved, ${result.dedupedCount} already existed.${duplicateNote}`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_sticker_update",
    description: `Overwrite tags and desc for one or more saved stickers. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Overwrite stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId", "tags", "desc"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when needed.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.update(args);
      return {
        text: `Sticker batch updated: ${result.updatedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_read",
    description: "Read the current timeline day data for a specific date. Use this before editing when the current day state is uncertain.",
    shortHint: "Read a timeline day before editing it.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.read(args);
      const exists = !!result?.data?.exists;
      const eventCount = Number.isInteger(result?.data?.eventCount) ? result.data.eventCount : 0;
      return {
        text: `Timeline day ${args.date}: ${exists ? `${eventCount} events` : "missing"}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_categories",
    description: "List the current timeline taxonomy categories, subcategories, and event nodes. Use this before choosing category ids or event nodes.",
    shortHint: "Inspect the current timeline taxonomy before choosing category ids or event nodes.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.timeline.listCategories();
      const categoryCount = Number.isInteger(result?.data?.categoryCount) ? result.data.categoryCount : 0;
      return {
        text: `Timeline categories loaded: ${categoryCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_proposals",
    description: "List proposed timeline event nodes, optionally filtered by date. Use this when deciding whether a new event node is actually needed.",
    shortHint: "Inspect proposed timeline event nodes before introducing new taxonomy.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.listProposals(args);
      const proposalCount = Number.isInteger(result?.data?.proposalCount) ? result.data.proposalCount : 0;
      return {
        text: `Timeline proposals loaded: ${proposalCount}.`,
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_write",
    description: "Write timeline events through timeline-for-agent. CRITICAL: each event MUST have either eventNodeId (preferred) OR categoryId. Inspect the current day and taxonomy first when category ids, event nodes, or existing events are uncertain.",
    shortHint: "Write timeline events. Each event needs eventNodeId (e.g. evt.breakfast) or categoryId.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date", "events"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
        events: {
          type: "array",
          description: "Timeline events for the target date.",
          items: {
            type: "object",
            required: ["startAt", "endAt"],
            properties: {
              id: { type: "string" },
              startAt: { type: "string", description: "ISO datetime within the target date." },
              endAt: { type: "string", description: "ISO datetime within the target date." },
              title: { type: "string", description: "Event title. Only used for display; you still need eventNodeId or categoryId." },
              note: { type: "string" },
              description: { type: "string" },
              categoryId: { type: "string", description: "Category id from taxonomy (e.g. life.meal, work.coding). Required if no eventNodeId." },
              subcategoryId: { type: "string" },
              eventNodeId: { type: "string", description: "Taxonomy event node id (e.g. evt.breakfast, evt.sleep, evt.walk). Preferred over categoryId." },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            additionalProperties: true,
          },
        },
        locale: { type: "string", description: "Optional timeline locale." },
        mode: { type: "string", description: "Optional write mode, usually merge." },
        finalize: { type: "boolean", description: "Whether to finalize the day after writing." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      validateTimelineWriteArgs(args);
      const result = await services.timeline.write(args);
      return {
        text: "Timeline write completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_build",
    description: "Build the timeline site through timeline-for-agent.",
    shortHint: "Build the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.build(args);
      return {
        text: "Timeline build completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_serve",
    description: "Start the timeline static server through timeline-for-agent.",
    shortHint: "Serve the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.serve(args);
      return {
        text: result.url ? `Timeline serve started at ${result.url}` : "Timeline serve completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_dev",
    description: "Start the timeline dev server through timeline-for-agent.",
    shortHint: "Start the timeline dev server, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.dev(args);
      return {
        text: result.url ? `Timeline dev started at ${result.url}` : "Timeline dev completed.",
        data: result,
      };
    },
  },
  {
    name: "cyberboss_timeline_screenshot",
    description: "Capture a timeline screenshot and send it back to the current WeChat chat.",
    shortHint: "Capture a timeline screenshot with structured selection fields.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Optional explicit WeChat user id." },
        outputFile: { type: "string", description: "Optional absolute output path for the PNG file." },
        selector: { type: "string", description: "main, timeline, analytics, events, or a custom CSS selector." },
        range: { type: "string", description: "Optional range: day, week, or month." },
        date: { type: "string", description: "Optional day selector YYYY-MM-DD." },
        week: { type: "string", description: "Optional week key." },
        month: { type: "string", description: "Optional month selector YYYY-MM." },
        category: { type: "string", description: "Optional category label or id." },
        subcategory: { type: "string", description: "Optional subcategory label or id." },
        width: { type: "integer", description: "Optional viewport width in pixels." },
        height: { type: "integer", description: "Optional viewport height in pixels." },
        sidePadding: { type: "integer", description: "Optional screenshot padding in pixels." },
        locale: { type: "string", description: "Optional timeline locale." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const captured = await services.timeline.captureScreenshot(args);
      const delivery = await services.channelFile.sendToCurrentChat({
        userId: args.userId,
        filePath: captured.outputFile,
      }, context);
      return {
        text: `Timeline screenshot sent: ${captured.outputFile}`,
        data: {
          ...captured,
          delivery,
        },
      };
    },
  },
  {
    name: "cyberboss_gift_create",
    description: "Create a gift for the user. If image_prompt is given, uses AI to generate an image. Otherwise renders a beautiful CSS letter on the frontend.",
    shortHint: "Create a gift (AI image or CSS letter) for the user.",
    topics: ["gift"],
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        title: { type: "string", description: "Gift title." },
        image_prompt: { type: "string", description: "Optional English image generation prompt for Kolors AI. If omitted, the gift renders as a CSS letter." },
        message: { type: "string", description: "Warm message to show with the gift." },
        reason: { type: "string", description: "Reason for giving this gift." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      if (args.image_prompt) {
        const apiKey = process.env.CYBERBOSS_VISION_API_KEY || "";
        const baseUrl = process.env.CYBERBOSS_VISION_API_BASE_URL || "";
        if (!apiKey) throw new Error("CYBERBOSS_VISION_API_KEY is not configured");
        const result = await services.gift.create({
          title: args.title || "",
          imagePrompt: args.image_prompt,
          message: args.message,
          reason: args.reason || "",
          apiKey,
          baseUrl,
        });
        return { text: `Gift created: "${result.title}"`, data: result };
      } else {
        const result = await services.gift.createLetter({
          title: args.title || "",
          message: args.message,
          reason: args.reason || "",
        });
        return { text: `Letter gift created: "${result.title}"`, data: result };
      }
    },
  },
  {
    name: "cyberboss_letter_create",
    description: "Create a letter in toge's memory bank letters section. The letter is rendered as a full HTML page (like a love letter or a personal note) that toge can open and read in-app. Use this to write warm, personal letters — summaries of recent days, reflections, encouragement, or anything you feel like expressing.",
    shortHint: "Write an HTML letter saved to the memory bank.",
    topics: ["letter", "memory"],
    inputSchema: {
      type: "object",
      required: ["title", "html"],
      properties: {
        title: { type: "string", description: "Letter title, e.g. '给 toge 的周记' or '凌晨三点写给 toge'" },
        preview: { type: "string", description: "Short preview text shown on the card in the memory bank, ~20-40 chars" },
        html: { type: "string", description: "Full HTML content of the letter. Should be a self-contained HTML document with inline CSS. Keep it warm, personal, and phone-readable (max-width ~480px, font-size 15px+)." },
        date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
        category: { type: "string", description: "Category tag, e.g. '周记', '日常', '情书', '鼓励'. Defaults to '周记'." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const category = args.category || "周记";
      const date = args.date || new Date().toISOString().slice(0, 10);
      const preview = args.preview || args.title || "";
      const result = services.letters.create({
        title: args.title,
        date,
        preview,
        html: args.html,
        category,
      });
      if (!result) return { text: "Failed to create letter (duplicate id)." };
      return { text: `Letter "${result.title}" saved to memory bank for toge to read.`, data: result };
    },
  },
  {
    name: "cyberboss_gift_list",
    description: "List all gifts in the gift gallery.",
    shortHint: "List all gifts.",
    topics: ["gift"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const gifts = services.gift.list();
      return {
        text: gifts.length ? `${gifts.length} gifts in gallery.` : "No gifts yet.",
        data: { gifts },
      };
    },
  },
  {
    name: "cyberboss_gift_claim",
    description: "Mark a gift as claimed/received.",
    shortHint: "Claim a gift by id.",
    topics: ["gift"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Gift id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.gift.claim(args.id);
      if (!result) return { text: `Gift not found: ${args.id}` };
      return { text: `Gift claimed: "${result.title}"`, data: result };
    },
  },
  {
    name: "cyberboss_gift_delete",
    description: "Delete a gift by id.",
    shortHint: "Delete a gift by id.",
    topics: ["gift"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Gift id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.gift.delete(args.id);
      if (!result) return { text: `Gift not found: ${args.id}` };
      return { text: `Gift deleted: "${result.title}"`, data: result };
    },
  },
  {
    name: "cyberboss_worldbook_read",
    description: "Read the current worldbook (AI persona, user profile, and custom rules). Use this to check how the AI should behave.",
    shortHint: "Read worldbook to recall persona settings.",
    topics: ["worldbook"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const model = context?.model || args?.model || "";
      const data = services.worldbook.read(model);
      return {
        text: `Worldbook loaded: AI name="${data.ai?.name || ""}", user name="${data.user?.name || ""}", rules=${(data.rules || []).length}.`,
        data,
      };
    },
  },
  {
    name: "cyberboss_worldbook_update",
    description: "Update a section of the worldbook. Section can be 'ai' (AI persona), 'user' (user profile), or 'rules' (custom rules array).",
    shortHint: "Update worldbook section: ai, user, or rules.",
    topics: ["worldbook"],
    inputSchema: {
      type: "object",
      required: ["section"],
      properties: {
        section: { type: "string", description: "Section to update: ai, user, or rules." },
        data: { type: "object", description: "Data to merge into the section. For 'rules', pass an array of rule strings." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const model = context?.model || args?.model || "";
      const result = services.worldbook.update(args.section, args.data || {}, model);
      return {
        text: `Worldbook section '${args.section}' updated.`,
        data: result,
      };
    },
  },
];

const STATIC_EXTRA_TOOL_NAMES = new WhereaboutsToolHost({ service: null })
  .listTools()
  .map((tool) => tool.name);

function createExtraToolHosts(services = {}) {
  const hosts = [];
  if (services.whereabouts) {
    hosts.push(new WhereaboutsToolHost({ service: services.whereabouts }));
  }
  return hosts;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildToolDescription(tool) {
  const baseDescription = normalizeText(tool?.description);
  const signature = summarizeSchema(tool?.inputSchema);
  if (!signature) {
    return baseDescription;
  }
  return `${baseDescription} Input: ${signature}`;
}

function summarizeSchema(schema, { depth = 0 } = {}) {
  if (!schema || typeof schema !== "object") {
    return "";
  }
  const schemaType = normalizeText(schema.type).toLowerCase();
  if (schemaType === "object") {
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const entries = Object.entries(properties);
    if (!entries.length) {
      return "{}";
    }
    const parts = entries.map(([key, value]) => {
      const suffix = required.has(key) ? "" : "?";
      return `${key}${suffix}: ${summarizeSchema(value, { depth: depth + 1 }) || "any"}`;
    });
    return `{ ${parts.join(", ")} }`;
  }
  if (schemaType === "array") {
    const itemSummary = summarizeSchema(schema.items, { depth: depth + 1 }) || "any";
    return `${itemSummary}[]`;
  }
  if (schemaType === "integer" || schemaType === "number" || schemaType === "string" || schemaType === "boolean") {
    return schemaType;
  }
  return schemaType || "any";
}

function validateTimelineWriteArgs(args) {
  const events = Array.isArray(args?.events) ? args.events : [];
  events.forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return;
    }
    const hasEventNodeId = normalizeText(event.eventNodeId).length > 0;
    const hasCategoryId = normalizeText(event.categoryId).length > 0;
    if (!hasEventNodeId && !hasCategoryId) {
      throw new Error(`cyberboss_timeline_write input.events[${index}].eventNodeId or input.events[${index}].categoryId is required.`);
    }
  });
}

function validateSchema(schema, value, toolName, path) {
  if (!schema || typeof schema !== "object") {
    return;
  }
  const schemaType = schema.type;
  if (schemaType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an object.`);
    }
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        throw new Error(`${toolName} ${path}.${key} is required.`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          throw new Error(`${toolName} ${path}.${key} is not allowed.`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateSchema(propertySchema, value[key], toolName, `${path}.${key}`);
      }
    }
    return;
  }
  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an array.`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, toolName, `${path}[${index}]`));
    }
    return;
  }
  if (schemaType === "string" && typeof value !== "string") {
    throw new Error(`${toolName} ${path} must be a string.`);
  }
  if (schemaType === "boolean" && typeof value !== "boolean") {
    throw new Error(`${toolName} ${path} must be a boolean.`);
  }
  if (schemaType === "integer" && !Number.isInteger(value)) {
    throw new Error(`${toolName} ${path} must be an integer.`);
  }
  if (schemaType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${toolName} ${path} must be a number.`);
  }
}

module.exports = {
  ProjectToolHost,
  listProjectToolNames,
};
