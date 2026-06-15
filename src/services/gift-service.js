const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

class GiftService {
  constructor({ dataDir }) {
    if (!dataDir) throw new Error("GiftService requires dataDir");
    this.dataDir = dataDir;
    this.giftsFile = path.join(dataDir, "gifts.json");
    this.imagesDir = path.join(dataDir, "gifts");
  }

  read() {
    try {
      if (fs.existsSync(this.giftsFile)) {
        return JSON.parse(fs.readFileSync(this.giftsFile, "utf8"));
      }
    } catch {}
    return [];
  }

  _write(gifts) {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.imagesDir)) fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.writeFileSync(this.giftsFile, JSON.stringify(gifts, null, 2), "utf8");
  }

  async create({ title, description, imagePrompt, message, reason, apiKey, baseUrl }) {
    if (!imagePrompt) throw new Error("imagePrompt is required");
    if (!apiKey) throw new Error("API key is required for image generation");

    const id = `gift-${Date.now()}`;
    const imagePath = await this._generateImage(imagePrompt, id, apiKey, baseUrl);

    const gift = {
      id,
      type: "image",
      title: title || "一份礼物",
      description: description || message || "",
      message: message || "",
      imagePath,
      reason: reason || "",
      createdAt: new Date().toISOString(),
      claimed: false,
      claimedAt: null,
    };

    const gifts = this.read();
    gifts.unshift(gift);
    this._write(gifts);

    return gift;
  }

  async createLetter({ title, message, reason }) {
    if (!message) throw new Error("message is required for letter gift");

    const id = `gift-${Date.now()}`;
    const gift = {
      id,
      type: "letter",
      title: title || "一封信",
      message,
      reason: reason || "",
      createdAt: new Date().toISOString(),
      claimed: false,
      claimedAt: null,
    };

    const gifts = this.read();
    gifts.unshift(gift);
    this._write(gifts);

    return gift;
  }

  list() {
    return this.read();
  }

  claim(id) {
    const gifts = this.read();
    const gift = gifts.find(g => g.id === id);
    if (!gift) return null;
    gift.claimed = true;
    gift.claimedAt = new Date().toISOString();
    this._write(gifts);
    return gift;
  }

  delete(id) {
    const gifts = this.read();
    const idx = gifts.findIndex(g => g.id === id);
    if (idx === -1) return null;
    const [removed] = gifts.splice(idx, 1);
    // Clean up image file
    if (removed.imagePath && fs.existsSync(removed.imagePath)) {
      try { fs.unlinkSync(removed.imagePath); } catch {}
    }
    this._write(gifts);
    return removed;
  }

  async _generateImage(prompt, id, apiKey, baseUrl) {
    const apiBase = baseUrl?.replace(/\/+$/, "") || "https://api.siliconflow.cn";
    const apiUrl = `${apiBase}/v1/images/generations`;

    const payload = JSON.stringify({
      model: "Kwai-Kolors/Kolors",
      prompt,
      negative_prompt: "realistic human, real person, photo, ugly, blurry, low quality, deformed",
      image_size: "1024x1024",
      batch_size: 1,
      num_inference_steps: 20,
      guidance_scale: 7.5,
    });

    const imageUrl = await new Promise((resolve, reject) => {
      const url = new URL(apiUrl);
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        timeout: 120_000,
      }, (res) => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.images && data.images[0]?.url) {
              resolve(data.images[0].url);
            } else if (data.data && data.data[0]?.url) {
              resolve(data.data[0].url);
            } else {
              reject(new Error(`Unexpected response: ${body.slice(0, 200)}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body.slice(0, 200)}`));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Image gen timeout")); });
      req.write(payload);
      req.end();
    });

    // Download image to local
    const ext = ".png";
    const localPath = path.join(this.imagesDir, `${id}${ext}`);
    await this._downloadFile(imageUrl, localPath);
    return localPath;
  }

  _downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, { timeout: 60_000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Download timeout")); });
    });
  }
}

module.exports = { GiftService };
