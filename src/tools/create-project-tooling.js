const path = require("path");
const { createChannelAdapter } = require("../core/channel-factory");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { createTimelineIntegration } = require("../integrations/timeline");
const { ChannelFileService } = require("../services/channel-file-service");
const { DiaryService } = require("../services/diary-service");
const { MemoryService } = require("../services/memory-service");
const { ReminderService } = require("../services/reminder-service");
const { StickerService } = require("../services/sticker-service");
const { SystemMessageService } = require("../services/system-message-service");
const { TimelineService } = require("../services/timeline-service");
const { WorldbookService } = require("../services/worldbook-service");
const { GiftService } = require("../services/gift-service");
const { RuntimeContextStore } = require("./runtime-context-store");
const { ProjectToolHost } = require("./tool-host");
const { WhereaboutsService } = require("whereabouts-mcp");
const { resolveModelKey, getModelMemoryDir, ALL_MODEL_KEYS } = require("../core/config");

function createProjectTooling(config, options = {}) {
  const stateDir = config.stateDir;
  const sessionStore = options.sessionStore || new SessionStore({
    filePath: config.sessionsFile,
    runtimeId: config.runtime || "codex",
  });
  const channelAdapter = options.channelAdapter || createChannelAdapter(config);
  const timelineIntegration = options.timelineIntegration || createTimelineIntegration(config);
  const runtimeContextStore = options.runtimeContextStore || new RuntimeContextStore({
    filePath: config.projectToolContextFile,
  });
  const channelFile = new ChannelFileService({ config, channelAdapter, sessionStore });
  const memory = new MemoryService({ config });
  const memoryServices = new Map();
  for (const mk of ALL_MODEL_KEYS) {
    memoryServices.set(mk, new MemoryService({ config, memoryDir: getModelMemoryDir(config.stateDir, mk) }));
  }
  function getMemoryService(model) {
    const key = resolveModelKey(model);
    return memoryServices.get(key) || memoryServices.get("ds") || memory;
  }
  const services = {
    diary: new DiaryService({ config, memoryService: memory }),
    memory,
    memoryServices,
    getMemoryService,
    reminder: new ReminderService({ config, sessionStore }),
    system: new SystemMessageService({ config, sessionStore }),
    channelFile,
    sticker: new StickerService({ config, channelAdapter, sessionStore, channelFileService: channelFile }),
    timeline: new TimelineService({ config, timelineIntegration, sessionStore }),
    worldbook: new WorldbookService({ stateDir, modelToKey: resolveModelKey }),
    gift: new GiftService({ dataDir: stateDir }),
    whereabouts: new WhereaboutsService({
      config: {
        storeFile: config.locationStoreFile,
        host: config.locationHost,
        port: config.locationPort,
        token: config.locationToken,
        historyLimit: config.locationHistoryLimit,
        movementEventLimit: config.locationMovementEventLimit,
        batteryHistoryLimit: config.locationBatteryHistoryLimit,
        knownPlaces: config.locationKnownPlaces,
        knownPlaceRadiusMeters: config.locationKnownPlaceRadiusMeters,
        stayMergeRadiusMeters: config.locationStayMergeRadiusMeters,
        stayBreakConfirmRadiusMeters: config.locationStayBreakConfirmRadiusMeters,
        stayBreakConfirmSamples: config.locationStayBreakConfirmSamples,
        majorMoveThresholdMeters: config.locationMajorMoveThresholdMeters,
      },
    }),
  };
  const toolHost = new ProjectToolHost({
    services,
    runtimeContextStore,
  });
  return {
    services,
    toolHost,
    runtimeContextStore,
  };
}

module.exports = { createProjectTooling };
