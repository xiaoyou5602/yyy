const fs = require("fs");
const path = require("path");

const { resolvePreferredSenderId } = require("../core/default-targets");

class ChannelFileService {
  constructor({ config, channelAdapter, sessionStore }) {
    this.config = config;
    this.channelAdapter = channelAdapter;
    this.sessionStore = sessionStore;
  }

  async sendToCurrentChat({ filePath = "", userId = "" } = {}, context = {}) {
    const channelId = this.channelAdapter.describe().id;
    let targetUserId;
    let contextToken;

    if (channelId === "direct") {
      targetUserId = normalizeText(userId) || "direct-user";
      contextToken = "direct-ctx-1";
    } else {
      const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
      const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");
      const account = resolveSelectedAccount(this.config);
      const explicitUserId = normalizeText(userId) || normalizeText(context?.senderId);
      const preferredUserId = resolvePreferredSenderId({
        config: this.config,
        accountId: account.accountId,
        sessionStore: this.sessionStore,
      });
      // Try explicit user first, then preferred.  But the preferred may be the
      // direct-channel sentinel ("direct-user") when CYBERBOSS_ALLOWED_USER_IDS
      // lists it — fall back to any WeChat binding that actually has a token.
      const candidates = [explicitUserId, preferredUserId].filter(Boolean);
      let resolvedCandidate = "";
      let resolvedToken = "";
      const persistedTokens = loadPersistedContextTokens(this.config, account.accountId);
      for (const candidate of candidates) {
        const tok = String(persistedTokens[candidate] || "").trim();
        if (tok) {
          resolvedCandidate = candidate;
          resolvedToken = tok;
          break;
        }
      }
      // If no candidate has a valid token, pick the first WeChat binding that does
      if (!resolvedToken && this.sessionStore) {
        const { collectBindingSenderIds } = require("../core/default-targets");
        const bindingIds = collectBindingSenderIds({
          config: this.config,
          accountId: account.accountId,
          sessionStore: this.sessionStore,
        });
        for (const candidate of bindingIds) {
          const tok = String(persistedTokens[candidate] || "").trim();
          if (tok) {
            resolvedCandidate = candidate;
            resolvedToken = tok;
            break;
          }
        }
      }
      if (!resolvedCandidate) {
        throw new Error("Cannot determine which WeChat user should receive the file.");
      }
      if (!resolvedToken) {
        throw new Error(`Cannot find a context token for user ${resolvedCandidate}. Let this user talk to the bot once first.`);
      }
      targetUserId = resolvedCandidate;
      contextToken = resolvedToken;
    }

    const requestedPath = normalizeText(filePath);
    if (!requestedPath) {
      throw new Error("Missing file path to send.");
    }
    const resolvedPath = path.resolve(requestedPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Only files can be sent, not directories: ${resolvedPath}`);
    }

    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 1,
      contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendFile({
      userId: targetUserId,
      filePath: resolvedPath,
      contextToken,
    });
    await this.channelAdapter.sendTyping({
      userId: targetUserId,
      status: 0,
      contextToken,
    }).catch(() => {});
    return { userId: targetUserId, filePath: resolvedPath };
  }

  async sendStickerToCurrentChat({ stickerId = "", desc = "", userId = "" } = {}, context = {}) {
    const channelId = this.channelAdapter.describe().id;
    if (channelId === "direct") {
      if (typeof this.channelAdapter.sendSticker === "function") {
        await this.channelAdapter.sendSticker({ stickerId, desc });
      }
      return { stickerId };
    }
    // Fallback for non-direct channels: send sticker GIF as regular file
    const { resolveStickerFilePath } = require("./sticker-service");
    const { ensureStickerCatalogFilesSync } = require("./sticker-service");
    ensureStickerCatalogFilesSync(this.config);
    const filePath = resolveStickerFilePath(this.config, stickerId);
    return this.sendToCurrentChat({ filePath, userId }, context);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { ChannelFileService };
