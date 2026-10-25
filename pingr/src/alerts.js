// Sends alerts to a Discord channel through a webhook URL.

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function sendDiscord(webhookUrl, embed) {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "Pingr", embeds: [{ ...embed, timestamp: new Date().toISOString() }] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) console.error(`Discord alert failed: HTTP ${response.status}`);
  } catch (err) {
    console.error(`Discord alert failed: ${err.message}`);
  }
}

function alertDown(webhookUrl, site, result, failures) {
  return sendDiscord(webhookUrl, {
    title: `🔴 ${site.name} is DOWN`,
    description: `${site.url}\nReason: **${result.error}**\nFailed ${failures} checks in a row.`,
    color: 0xe5484d,
  });
}

function alertRecovered(webhookUrl, site, downtimeMs) {
  return sendDiscord(webhookUrl, {
    title: `🟢 ${site.name} has RECOVERED`,
    description: `${site.url}\nIt was down for about **${formatDuration(downtimeMs)}**.`,
    color: 0x30a46c,
  });
}

module.exports = { alertDown, alertRecovered, formatDuration };
