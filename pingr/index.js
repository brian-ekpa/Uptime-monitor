#!/usr/bin/env node
// Pingr: a tiny uptime monitor with a public status page and Discord alerts.
// Usage: node index.js [config.json]

const fs = require("fs");
const path = require("path");
const { checkSite } = require("./src/checker");
const { Store } = require("./src/store");
const { alertDown, alertRecovered } = require("./src/alerts");
const { createServer } = require("./src/server");

const DEFAULTS = {
  title: "Service Status",
  port: 3000,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  failuresBeforeAlert: 2, // alert only after this many failed checks in a row, to avoid false alarms
  discordWebhook: "",
  dataFile: path.join("data", "history.json"),
  sites: [],
};

function normaliseConfig(raw) {
  const config = { ...DEFAULTS, ...raw };

  if (!Array.isArray(config.sites) || config.sites.length === 0) {
    throw new Error('Config needs a "sites" list with at least one site.');
  }
  const names = new Set();
  for (const site of config.sites) {
    if (!site.name || !site.url) throw new Error('Every site needs a "name" and a "url".');
    if (names.has(site.name)) throw new Error(`Two sites share the name "${site.name}". Names must be unique.`);
    names.add(site.name);
    let parsed;
    try {
      parsed = new URL(site.url);
    } catch {
      throw new Error(`"${site.url}" is not a valid URL. Include https:// at the start.`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`"${site.url}" must start with http:// or https://`);
    }
  }
  for (const key of ["intervalSeconds", "timeoutSeconds", "failuresBeforeAlert"]) {
    if (typeof config[key] !== "number" || !(config[key] > 0)) throw new Error(`"${key}" must be a number above 0.`);
  }

  // The webhook can also come from an environment variable, so you never have to commit it to GitHub.
  config.discordWebhook = process.env.DISCORD_WEBHOOK_URL || config.discordWebhook;
  return config;
}

function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`Can't find the config file "${file}". Copy config.example.json to config.json first.`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`"${file}" isn't valid JSON: ${err.message}`);
  }
  return normaliseConfig(raw);
}

function start(rawConfig) {
  const config = normaliseConfig(rawConfig);
  const store = new Store(config.dataFile);
  const running = new Set(); // stops a slow check from overlapping with the next one

  async function runCheck(site) {
    if (running.has(site.name)) return;
    running.add(site.name);
    try {
      const result = await checkSite(site, config.timeoutSeconds * 1000);
      const state = store.record(site.name, result);

      if (!result.up && state.failures >= config.failuresBeforeAlert && !state.alertedDown) {
        state.alertedDown = true;
        state.downSince = state.firstFailure;
        store.save();
        console.log(`[${result.time}] ${site.name} is DOWN (${result.error})`);
        await alertDown(config.discordWebhook, site, result, state.failures);
      } else if (result.up && state.alertedDown) {
        const downtime = Date.now() - new Date(state.downSince || result.time).getTime();
        state.alertedDown = false;
        state.downSince = null;
        store.save();
        console.log(`[${result.time}] ${site.name} has RECOVERED`);
        await alertRecovered(config.discordWebhook, site, downtime);
      }
    } finally {
      running.delete(site.name);
    }
  }

  const timers = config.sites.map((site) => {
    runCheck(site);
    return setInterval(() => runCheck(site), config.intervalSeconds * 1000);
  });

  const server = createServer(config, store);
  const ready = new Promise((resolve) => server.listen(config.port, () => resolve(server.address().port)));

  function stop() {
    timers.forEach(clearInterval);
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }

  return { ready, stop, store };
}

if (require.main === module) {
  try {
    const file = process.argv[2] || "config.json";
    const config = loadConfig(file);
    const app = start(config);
    app.ready.then((port) => {
      console.log(`Pingr is running. Watching ${config.sites.length} site(s) every ${config.intervalSeconds}s.`);
      console.log(`Status page: http://localhost:${port}`);
      if (!config.discordWebhook) console.log("Tip: no Discord webhook set, so alerts will only show in this terminal.");
    });
    process.on("SIGINT", () => app.stop().then(() => process.exit(0)));
    process.on("SIGTERM", () => app.stop().then(() => process.exit(0)));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { start, loadConfig, normaliseConfig };
