// Remembers the results of past checks, saved to a JSON file so history survives restarts.
const fs = require("fs");
const path = require("path");

const MAX_HISTORY = 200; // keep the last 200 checks per site

class Store {
  constructor(file) {
    this.file = file;
    this.data = { sites: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = parsed && parsed.sites ? parsed : { sites: {} };
    } catch {
      this.data = { sites: {} };
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = this.file + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(this.data));
      fs.renameSync(temp, this.file);
    } catch (err) {
      console.error(`Could not save history: ${err.message}`);
    }
  }

  site(name) {
    if (!this.data.sites[name]) {
      this.data.sites[name] = {
        history: [],
        failures: 0, // checks failed in a row
        firstFailure: null,
        alertedDown: false,
      };
    }
    return this.data.sites[name];
  }

  record(name, result) {
    const s = this.site(name);
    s.history.push(result);
    if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);

    s.failures = result.up ? 0 : s.failures + 1;
    if (!result.up && s.failures === 1) s.firstFailure = result.time;
    if (result.up) s.firstFailure = null;

    this.save();
    return s;
  }

  summary(name) {
    const s = this.site(name);
    const history = s.history;
    const last = history[history.length - 1] || null;
    const ups = history.filter((h) => h.up);
    return {
      name,
      state: last ? (last.up ? "up" : "down") : "pending",
      last,
      uptime: history.length ? (ups.length / history.length) * 100 : null,
      avgMs: ups.length ? Math.round(ups.reduce((sum, h) => sum + h.ms, 0) / ups.length) : null,
      checks: history.length,
      outageSince: s.failures > 0 ? s.firstFailure : null, // when the current outage began, if one is happening
      recent: history.slice(-40),
    };
  }
}

module.exports = { Store };
