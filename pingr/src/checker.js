// Visits one website and reports whether it is up, how fast it answered, and any error.

async function checkSite(site, timeoutMs = 10000) {
  const started = Date.now();
  const time = new Date().toISOString();

  try {
    const response = await fetch(site.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "Pingr-Uptime-Monitor/1.0" },
    });
    const ms = Date.now() - started;

    // By default any 2xx or 3xx answer counts as "up". A site can ask for an exact code instead.
    const up = site.expectedStatus
      ? response.status === site.expectedStatus
      : response.status >= 200 && response.status < 400;

    return { time, up, status: response.status, ms, error: up ? null : `HTTP ${response.status}` };
  } catch (err) {
    const ms = Date.now() - started;
    const error = err.name === "TimeoutError" ? "Timed out" : err.cause?.code || err.message;
    return { time, up: false, status: null, ms, error };
  }
}

module.exports = { checkSite };
