// A small web server that shows the public status page and a JSON version of the same data.
const http = require("http");

const MAX_POINTS = 40; // how many recent checks the chart shows

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// "2026-10-25 17:22 UTC". The page script swaps this for the viewer's own time zone.
function utcText(iso) {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function agoText(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

// One sentence that answers "is everything okay?" for the whole page.
function verdict(summaries) {
  const total = summaries.length;
  const down = summaries.filter((s) => s.state === "down");
  const up = summaries.filter((s) => s.state === "up").length;
  const pending = summaries.filter((s) => s.state === "pending").length;

  if (down.length > 0) {
    return {
      tone: "bad",
      headline: down.length === 1 ? `${down[0].name} is down.` : `${down.length} services are down.`,
      detail: up === 0 ? "No service is responding right now." : `${up} of ${total} services ${up === 1 ? "is" : "are"} responding.`,
    };
  }
  if (pending === total) {
    return { tone: "wait", headline: "Running the first checks.", detail: "Results appear here within a minute." };
  }
  if (pending > 0) {
    return {
      tone: "ok",
      headline: "Everything is working.",
      detail: `${up} of ${total} services ${up === 1 ? "is" : "are"} responding. The rest are waiting for their first check.`,
    };
  }
  return {
    tone: "ok",
    headline: "Everything is working.",
    detail: total === 1 ? "The service is responding." : `All ${total} services are responding.`,
  };
}

// Draws response time as a line. Failed checks become red outage bands, so downtime is visible at a glance.
function renderTrace(s) {
  const W = 480;
  const H = 64;
  const pad = 6;
  const step = W / MAX_POINTS;
  const offset = (MAX_POINTS - s.recent.length) * step; // newest check sits at the right edge
  const upTimes = s.recent.filter((h) => h.up).map((h) => h.ms);
  const yMax = Math.max(200, Math.ceil(((upTimes.length ? Math.max(...upTimes) : 0) * 1.15) / 50) * 50);
  const xAt = (i) => (offset + i * step + step / 2).toFixed(2);
  const yAt = (ms) => (H - pad - (Math.min(ms, yMax) / yMax) * (H - pad * 2)).toFixed(2);

  // Break the line wherever a check failed.
  const segments = [];
  let run = [];
  s.recent.forEach((h, i) => {
    if (h.up) {
      run.push(`${xAt(i)} ${yAt(h.ms)}`);
    } else if (run.length) {
      segments.push(run);
      run = [];
    }
  });
  if (run.length) segments.push(run);

  const paths = segments
    .map((seg) => {
      const d = seg.length === 1 ? `M${seg[0]} l0.01 0` : `M${seg.join(" L")}`; // a lone point becomes a dot
      return `<path class="line" vector-effect="non-scaling-stroke" d="${d}"/>`;
    })
    .join("");

  const bands = s.recent
    .map((h, i) => {
      if (h.up) return "";
      const x = (offset + i * step).toFixed(2);
      return `<rect class="outage" x="${x}" y="0" width="${step.toFixed(2)}" height="${H}"/><rect class="outage-base" x="${x}" y="${H - 3}" width="${step.toFixed(2)}" height="3"/>`;
    })
    .join("");

  const hits = s.recent
    .map((h, i) => {
      const x = (offset + i * step).toFixed(2);
      const message = h.up ? `${h.ms}ms` : `Failed, ${h.error}`;
      return `<rect class="hit" x="${x}" y="0" width="${step.toFixed(2)}" height="${H}" data-t="${escapeHtml(h.time)}" data-m="${escapeHtml(message)}"><title>${escapeHtml(utcText(h.time))}: ${escapeHtml(message)}</title></rect>`;
    })
    .join("");

  const failed = s.recent.filter((h) => !h.up).length;
  const label = `Response time for ${s.name} over the last ${s.recent.length} checks. ${failed === 0 ? "No checks failed." : `${failed} failed.`}`;

  return `<svg class="trace" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}">
      <line class="ground" vector-effect="non-scaling-stroke" x1="0" y1="${H}" x2="${W}" y2="${H}"/>${bands}${paths}${hits}
    </svg>
    <div class="axis"><span>Last ${s.recent.length} checks, newest on the right</span><span>Scale: 0 to ${yMax}ms</span></div>`;
}

function renderService(s) {
  const tone = s.state === "up" ? "is-up" : s.state === "down" ? "is-down" : "is-wait";
  const stateText = s.state === "up" ? "Operational" : s.state === "down" ? "Down" : "Waiting for first check";

  const note =
    s.state === "down" && s.outageSince
      ? `<p class="note">Down since <time data-when datetime="${escapeHtml(s.outageSince)}">${utcText(s.outageSince)}</time>. Last error: ${escapeHtml(s.last.error)}.</p>`
      : "";

  const uptime = s.uptime === null ? "None yet" : s.uptime === 100 ? "100%" : `${(Math.floor(s.uptime * 100) / 100).toFixed(2)}%`;
  const average = s.avgMs === null ? "None yet" : `${s.avgMs}ms`;
  const latest = !s.last ? "None yet" : s.last.up ? `${s.last.ms}ms` : "Failed";

  return `<article class="service ${tone}">
    <div class="service-head">
      <h2>${escapeHtml(s.name)}</h2>
      <p class="state"><span class="mark" aria-hidden="true"></span>${stateText}</p>
    </div>
    ${note}
    ${s.recent.length ? renderTrace(s) : '<p class="axis">The chart appears after the first check.</p>'}
    <dl class="figures">
      <div><dt>Uptime</dt><dd>${uptime}</dd></div>
      <div><dt>Average response</dt><dd>${average}</dd></div>
      <div><dt>Latest response</dt><dd>${latest}</dd></div>
    </dl>
  </article>`;
}

const PAGE_SCRIPT = `
(function () {
  try {
    var when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    document.querySelectorAll("time[data-when]").forEach(function (el) {
      var d = new Date(el.getAttribute("datetime"));
      if (!isNaN(d)) el.textContent = when.format(d);
    });
    document.querySelectorAll("rect[data-t]").forEach(function (el) {
      var d = new Date(el.getAttribute("data-t"));
      var title = el.querySelector("title");
      if (title && !isNaN(d)) title.textContent = when.format(d) + ": " + el.getAttribute("data-m");
    });
    var live = document.getElementById("checked");
    if (live) {
      var update = function () {
        var s = Math.max(0, Math.round((Date.now() - new Date(live.getAttribute("datetime")).getTime()) / 1000));
        var m = Math.round(s / 60);
        live.textContent = s < 60 ? s + (s === 1 ? " second ago" : " seconds ago") : m + (m === 1 ? " minute ago" : " minutes ago");
      };
      update();
      setInterval(update, 1000);
    }
  } catch (e) {}
})();
`;

function renderPage(config, summaries) {
  const v = verdict(summaries);
  const favicon = { ok: "%230B7A52", bad: "%23C7302A", wait: "%236B7C8A" }[v.tone];
  const lastChecked = summaries
    .map((s) => s.last && s.last.time)
    .filter(Boolean)
    .sort()
    .pop();
  const checkedLine = lastChecked
    ? `Last checked <time id="checked" datetime="${escapeHtml(lastChecked)}">${agoText(lastChecked)}</time>`
    : "Waiting for the first check";
  const tabTitle = v.tone === "bad" ? `Down: ${config.title}` : config.title;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>${escapeHtml(tabTitle)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='${favicon}'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light dark;
    --bg: #eef1f4; --ink: #14202b; --muted: #53636f; --line: #cbd3db;
    --up: #0b7a52; --down: #c7302a; --wait: #6b7c8a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c151d; --ink: #e7edf2; --muted: #93a4b3; --line: #23323f;
      --up: #3fd39a; --down: #ff6e66; --wait: #8da0b0;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--ink); line-height: 1.55;
    font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-optical-sizing: auto;
  }
  .tone-ok { --state: var(--up); }
  .tone-bad { --state: var(--down); }
  .tone-wait { --state: var(--wait); }
  .stripe { height: 6px; background: var(--state); }
  .page { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem 3.5rem; }

  .top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.25rem 1rem; padding-top: 1.5rem; color: var(--muted); font-size: 0.95rem; }
  .top p { margin: 0; }
  .top .site { color: var(--ink); font-weight: 650; }

  .verdict { padding: clamp(3rem, 10vw, 6rem) 0 clamp(2.5rem, 7vw, 4rem); }
  .verdict h1 { margin: 0; font-size: clamp(2.6rem, 9vw, 5.25rem); line-height: 1.02; letter-spacing: -0.035em; font-weight: 760; text-wrap: balance; overflow-wrap: anywhere; }
  .verdict p { margin: 1.1rem 0 0; max-width: 34rem; font-size: 1.2rem; color: var(--muted); }

  .services { border-bottom: 1px solid var(--line); }
  .service { border-top: 1px solid var(--line); padding: 1.75rem 0 2rem; }
  .is-up { --tone: var(--up); }
  .is-down { --tone: var(--down); }
  .is-wait { --tone: var(--wait); }
  .service-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .service-head h2 { margin: 0; font-size: 1.4rem; font-weight: 650; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .state { display: flex; align-items: center; gap: 0.5rem; margin: 0; flex-shrink: 0; font-weight: 600; color: var(--tone); }
  .mark { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--tone); }
  .is-down .mark { border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
  .is-wait .mark { background: transparent; border: 2px solid var(--tone); }
  .note { margin: 0.75rem 0 0; color: var(--down); font-weight: 550; }

  .trace { display: block; width: 100%; height: 4rem; margin-top: 1.25rem; overflow: visible; }
  .ground { stroke: var(--line); stroke-width: 1; }
  .line { fill: none; stroke: var(--ink); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
  .outage { fill: var(--down); opacity: 0.16; }
  .outage-base { fill: var(--down); }
  .hit { fill: transparent; }
  .axis { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.25rem 1rem; margin: 0.4rem 0 0; font-size: 0.82rem; color: var(--muted); }

  .figures { display: flex; flex-wrap: wrap; gap: 0.75rem 2.5rem; margin: 1.25rem 0 0; }
  .figures div { display: flex; flex-direction: column-reverse; }
  .figures dt { font-size: 0.85rem; color: var(--muted); }
  .figures dd { margin: 0; font-size: 1.5rem; font-weight: 650; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }

  .foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem 1.5rem; margin-top: 1.5rem; font-size: 0.88rem; color: var(--muted); }
  .foot p { margin: 0; }
  .foot a { color: inherit; text-underline-offset: 0.2em; }
  .foot a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }
</style>
</head>
<body class="tone-${v.tone}">
<div class="stripe"></div>
<div class="page">
  <header class="top">
    <p class="site">${escapeHtml(config.title)}</p>
    <p>${checkedLine}</p>
  </header>
  <section class="verdict">
    <h1>${escapeHtml(v.headline)}</h1>
    <p>${escapeHtml(v.detail)}</p>
  </section>
  <main class="services">
  ${summaries.map(renderService).join("\n  ")}
  </main>
  <footer class="foot">
    <p>This page updates by itself.</p>
    <p><a href="/api/status">Raw data (JSON)</a> &nbsp;Powered by Pingr</p>
  </footer>
</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}

function createServer(config, store) {
  return http.createServer((req, res) => {
    const summaries = config.sites.map((site) => store.summary(site.name));
    const url = (req.url || "/").split("?")[0];

    if (url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ title: config.title, sites: summaries }));
    } else if (url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPage(config, summaries));
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  });
}

module.exports = { createServer, renderPage };
