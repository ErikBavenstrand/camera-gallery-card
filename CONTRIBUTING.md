# Contributing

## How contributions are accepted

## Local development setup

The dev workflow rsyncs the card into HA's `/config/www/dev/` and registers a small loader as a Lovelace resource. No build step.

### Prerequisites

- Node.js 18+
- HA Advanced SSH & Web Terminal add-on (the basic one has no rsync)
- SSH key auth, ideally with a host alias in `~/.ssh/config`

### Setup

Create the target dir on HA, owned by your SSH user:

```bash
ssh my-ha 'sudo mkdir -p /config/www/dev && sudo chown -R $(whoami): /config/www/dev'
```

Then locally:

```bash
npm install
cp .env.example .env   # set HA_HOST and HA_DEV_PATH
npm run push
```

In HA, add a Lovelace resource at Settings → Dashboards → ⋮ → Resources:

- Type: JavaScript Module
- URL: `/local/dev/loader.js` for manual reloads, or `/local/dev/loader-hot.js` for auto reload

Remove any existing `/hacsfiles/camera-gallery-card/...` resource. Only one entry per custom element name will work.

### Develop

```bash
npm run dev
```

Watches the card file and rsyncs on save. With `loader.js`, hard reload the dashboard after saving. With `loader-hot.js`, the dashboard reloads itself a couple of seconds later.

### How it works

`loader.js` registers as a stable URL but imports `camera-gallery-card.js?v=<timestamp>` on each page load, so the browser cache and service worker can't serve stale code. `loader-hot.js` adds a 2-second poll on `Last-Modified` and calls `location.reload()` when it changes.
