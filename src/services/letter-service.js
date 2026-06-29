const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class LetterService {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
  }

  _dir() {
    const d = path.join(this.stateDir, "letters");
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  _manifestPath() {
    return path.join(this._dir(), "manifest.json");
  }

  _hash(s) {
    return crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 8);
  }

  readAll() {
    const fp = this._manifestPath();
    if (!fs.existsSync(fp)) return [];
    try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return []; }
  }

  _writeAll(letters) {
    const fp = this._manifestPath();
    if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(letters, null, 2), "utf8");
  }

  getById(id) {
    return this.readAll().find(l => l.id === id) || null;
  }

  create({ title, date, preview, html, category }) {
    const letters = this.readAll();
    const id = `letter_${this._hash((title || "") + (date || Date.now()))}`;
    if (letters.some(l => l.id === id)) return null;
    const file = `${id}.html`;
    const letter = {
      id, title: title || "", date: date || new Date().toISOString().slice(0, 10),
      preview: preview || "", file,
      category: category || "", sortOrder: letters.length,
      createdAt: new Date().toISOString(),
    };
    letters.push(letter);
    this._writeAll(letters);
    fs.writeFileSync(path.join(this._dir(), file), html || "", "utf8");
    return letter;
  }

  update(id, data) {
    const letters = this.readAll();
    const idx = letters.findIndex(l => l.id === id);
    if (idx === -1) return null;
    const l = letters[idx];
    if (data.title !== undefined) l.title = data.title;
    if (data.date !== undefined) l.date = data.date;
    if (data.preview !== undefined) l.preview = data.preview;
    if (data.category !== undefined) l.category = data.category;
    if (data.sortOrder !== undefined) l.sortOrder = data.sortOrder;
    letters[idx] = l;
    this._writeAll(letters);
    if (data.html !== undefined) {
      fs.writeFileSync(path.join(this._dir(), l.file), data.html, "utf8");
    }
    return l;
  }

  remove(id) {
    const letters = this.readAll();
    const idx = letters.findIndex(l => l.id === id);
    if (idx === -1) return false;
    try {
      const fp = path.join(this._dir(), letters[idx].file);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
    letters.splice(idx, 1);
    this._writeAll(letters);
    return true;
  }

  getLastLetterDate() {
    const letters = this.readAll();
    if (!letters.length) return null;
    const sorted = letters.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return sorted[0].createdAt || null;
  }
}

module.exports = { LetterService };
