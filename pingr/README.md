# Pingr

A tiny self-hosted uptime monitor. It checks your websites and APIs on a schedule, shows a public status page, and sends a Discord alert when something goes down or comes back.

No dependencies, no database, no build step. Just Node.js.

```
your sites  →  Pingr checks them every minute  →  status page + Discord alerts
```

## Features

- Checks any number of websites or API endpoints on an interval you choose
- Public status page with a green/red history bar, uptime percentage and average response time
- Discord alerts when a site goes down and when it recovers (with how long it was down)
- Avoids false alarms: it only alerts after several failed checks in a row
- JSON endpoint at `/api/status` for use in other apps
- History is saved to a file, so it survives restarts
- Automatic dark mode, works on phones

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
cp config.example.json config.json
```

Open `config.json`, replace the example sites with your own, then run:

```bash
node index.js
```

Open http://localhost:3000 to see your status page.

To see the status page with sample data (no real sites needed), run `npm run preview` and open `preview.html` and `preview-down.html`. This is handy for README screenshots.

## Setting up Discord alerts

1. In Discord, open your server: **Server Settings → Integrations → Webhooks → New Webhook**.
2. Pick the channel for alerts and click **Copy Webhook URL**.
3. Paste it into `config.json` as `discordWebhook`, **or** (safer) set it as an environment variable so it never ends up on GitHub:

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." node index.js
```

Treat the webhook URL like a password. Anyone who has it can post in your channel.

## Configuration

| Setting | What it does | Default |
| --- | --- | --- |
| `title` | Heading of the status page | `Service Status` |
| `port` | Port the status page runs on | `3000` |
| `intervalSeconds` | How often each site is checked | `60` |
| `timeoutSeconds` | How long to wait before calling a site down | `10` |
| `failuresBeforeAlert` | Failed checks in a row before alerting | `2` |
| `discordWebhook` | Discord webhook URL (or use `DISCORD_WEBHOOK_URL`) | none |
| `sites` | List of `{ "name", "url" }`; add `"expectedStatus": 200` to require an exact status code | required |

By default any 2xx or 3xx response counts as up.

## Running it for real

Pingr has to keep running to catch outages, so a static host like Netlify won't work. Run it on an always-on machine: a small VPS, Railway, Render, Fly.io, or a Raspberry Pi. Keep it alive with a process manager such as `pm2`:

```bash
npm install -g pm2
pm2 start index.js --name pingr
```

If your host wipes files on restart, point `dataFile` at a persistent disk or you will lose history (monitoring still works).

## Tests

```bash
npm test
```

The test starts a fake website, a fake Discord webhook and the monitor, breaks the fake website, and checks that exactly one DOWN alert and one RECOVERED alert arrive.

## Project structure

```
index.js          starts everything and decides when to alert
src/checker.js    visits a site and measures the response
src/store.js      saves check history to a JSON file
src/alerts.js     sends Discord messages
src/server.js     the status page and /api/status
test/smoke.js     end-to-end test with fake servers
```

## Ideas for next steps

- Telegram and email alerts
- Check response content (for example, the page must contain a word)
- SSL certificate expiry warnings
- Incident history on the status page

## License

MIT
