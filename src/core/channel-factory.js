function createChannelAdapter(config) {
  const channel = (config.channel || "weixin").toLowerCase();
  if (channel === "direct") {
    const { createDirectChannelAdapter } = require("../adapters/channel/direct");
    return createDirectChannelAdapter(config);
  }
  if (channel === "dual") {
    const { createDualChannelAdapter } = require("../adapters/channel/dual");
    return createDualChannelAdapter(config);
  }
  const { createWeixinChannelAdapter } = require("../adapters/channel/weixin");
  return createWeixinChannelAdapter(config);
}

module.exports = { createChannelAdapter };
