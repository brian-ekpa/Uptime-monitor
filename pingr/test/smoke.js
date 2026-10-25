// End-to-end test using fake local servers: a fake website, a fake Discord webhook,
// and a closed port. Run with: npm test
const http = require("http");
const net = require("net");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("../index");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function freeClosedPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function get(port, urlPath) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
  return { status: res.status, text: await res.text() };
}

(async () => {
  let siteUp = true;
  const hooks = [];

  const fakeSite = await listen((req, res) => {
    res.statusCode = siteUp ? 200 : 500;
    res.end("hello");
  });
  const fakeDiscord = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hooks.push(JSON.parse(body).embeds[0]);
      res.statusCode = 204;
      res.end();
    });
  });
  const closedPort = await freeClosedPort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pingr-test-"));

  const app = start({
    title: "Test Status",
    port: 0,
    intervalSeconds: 0.2,
    timeoutSeconds: 2,
    failuresBeforeAlert: 2,
    discordWebhook: `http://127.0.0.1:${fakeDiscord.address().port}/hook`,
    dataFile: path.join(tempDir, "history.json"),
    sites: [
      { name: "Test Site", url: `http://127.0.0.1:${fakeSite.address().port}/` },
      { name: "<i>Bad</i>", url: `http://127.0.0.1:${closedPort}/` },
    ],
  });
  const port = await app.ready;
  const alertsFor = (name) => hooks.filter((h) => h.title.includes(name));

  // 1. A healthy site is reported as up and sends no alert.
  await sleep(800);
  let api = JSON.parse((await get(port, "/api/status")).text);
  const healthy = api.sites.find((s) => s.name === "Test Site");
  assert.strictEqual(healthy.state, "up", "healthy site should be up");
  assert.strictEqual(alertsFor("Test Site").length, 0, "no alert while healthy");
  console.log("PASS healthy site shows as up, no alert");

  // 2. When it breaks, exactly one DOWN alert is sent (not one per failed check).
  siteUp = false;
  await sleep(1500);
  assert.strictEqual(alertsFor("Test Site").length, 1, "exactly one alert after going down");
  assert.ok(alertsFor("Test Site")[0].title.includes("DOWN"), "alert says DOWN");
  api = JSON.parse((await get(port, "/api/status")).text);
  assert.strictEqual(api.sites.find((s) => s.name === "Test Site").state, "down");
  console.log("PASS outage sends one DOWN alert and no repeats");

  // 3. When it comes back, a RECOVERED alert is sent.
  siteUp = true;
  await sleep(900);
  const site = alertsFor("Test Site");
  assert.strictEqual(site.length, 2, "recovery alert sent");
  assert.ok(site[1].title.includes("RECOVERED"), "second alert says RECOVERED");
  assert.ok(site[1].description.includes("down for about"), "recovery says how long it was down");
  console.log("PASS recovery sends a RECOVERED alert with downtime");

  // 4. The status page renders and escapes HTML in site names.
  const page = await get(port, "/");
  assert.strictEqual(page.status, 200);
  assert.ok(page.text.includes("Test Site"));
  assert.ok(page.text.includes("&lt;i&gt;Bad&lt;/i&gt;"), "names are escaped");
  assert.ok(!page.text.includes("<i>Bad</i>"), "raw HTML must not appear");
  assert.strictEqual((await get(port, "/nope")).status, 404);
  if (process.env.SAVE_HTML) fs.writeFileSync(process.env.SAVE_HTML, page.text);
  console.log("PASS status page renders and escapes site names");

  // 5. History is saved to disk.
  const saved = JSON.parse(fs.readFileSync(path.join(tempDir, "history.json"), "utf8"));
  assert.ok(saved.sites["Test Site"].history.length > 3, "history saved");
  console.log("PASS history saved to disk");

  await app.stop();
  fakeSite.close();
  fakeDiscord.close();
  console.log("\nAll tests passed.");
  process.exit(0);
})().catch((err) => {
  console.error("TEST FAILED:", err.message);
  process.exit(1);
});
