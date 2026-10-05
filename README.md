# Horizon

Source for **[horizonlol.netlify.app](https://horizonlol.netlify.app/)** — the public site for Horizon, a keyless Roblox executor.

Static site. No build step, no framework, no server runtime — open `index.html` or point any static host at the repo root.

```
/
├── index.html          Home + Status (single page, two views)
├── 404.html            Custom "page not found" (used by Netlify / GitHub Pages / Cloudflare Pages)
├── assets/
│   ├── index.css       Stylesheet
│   ├── index.js        All site logic (nav, Status page, download modal, polling)
│   └── horizonnn.png   Horizon logo (local fallback)
├── API/
│   ├── fetch.js        Endpoint poller / transport chain shared by the whole site
│   ├── fetch.html      /API/fetch  (extensionless-path twin)
│   └── fetch/
│       └── index.html  /API/fetch/ (directory form)
├── downloads/          Client builds (.zip) go here
├── beta/  docs/  tos/  home/    Hidden pages (see below)
└── Logo.png            Unused legacy asset
```

## Pages

| Path | What it is |
| --- | --- |
| `/` | Home + Status (toggle with the nav tabs) |
| `/API/fetch` | Live JSON for both builds — polled every 10 s |
| `/404` | Served automatically for any unknown URL |
| `/beta`, `/docs`, `/tos`, `/home` | Hidden — redirect away unless `?key=horizon` is present |

Hidden pages are only *lightly* hidden: on a static host the HTML is still downloadable if someone guesses the URL.

## `/API/fetch`

Returns both builds side by side, refreshed every 10 seconds:

```json
{"External":{"changelogs":{...},"latest":"...","supported":"...","version":"..."},"Internal":{...}}
```

Upstream endpoints polled:

```
http://paloma.hidencloud.com:24617/api/fetch/External
http://paloma.hidencloud.com:24617/api/fetch/Internal
```

The old flat endpoint (`.../api/fetch`) no longer exists upstream, so there is no single source document to mirror — hence the two-key object above. To show just one, edit `API/fetch.js` → `ENDPOINTS`.

**Why a poller at all?** The host is static, so no server process can serve live JSON. Instead `API/fetch.js` keeps a 10-second poll running in the browser and the page renders the current snapshot.

**Why the transport chain?** Two things block a plain `fetch()`:

1. **CORS** — the upstream sends no `Access-Control-Allow-Origin`.
2. **Mixed content** — the upstream is `http://` only, which any `https://` page blocks.

`API/fetch.js` therefore races several transports (`direct`, `allorigins`, `codetabs`, `corsproxy`, `jina`) and keeps the first that returns parseable JSON; the winner is remembered for every later request.

> Recommended fix on the upstream server, which would make all of that unnecessary:
> `res.set('Access-Control-Allow-Origin', '*');` — plus serving it over the same scheme as the site.

## Status page

The **Internal Executor** and **External** cards poll their endpoints every 10 s and show:

- pill: **ONLINE** / **OFFLINE** / **CHECKING…** — derived from reachability, unless the payload carries an explicit `status` string or boolean `supported`
- build hash: the `latest` field from the payload

Both pollers stop while you are off the Status page.

## Configuration

Everything you are likely to change lives at the top of `assets/index.js`:

```js
const LOGO_REMOTE = 'http://paloma.hidencloud.com:24617/cdn/horizonnn.png';
const LOGO_LOCAL  = 'assets/horizonnn.png';
const DISCORD_INVITE = 'https://discord.gg/beM4pRtBdG';
const API_ORIGIN = 'http://paloma.hidencloud.com:24617';

/* Builds are served from the CDN, not from this repo. */
const CDN_BASE = 'http://paloma.hidencloud.com:24617/cdn/';
const DOWNLOAD_URLS = { external: '...External.zip', internal: '...Internal.zip' };
const INTERNAL_READY = false;   // flip once Horizon-Internal.zip is uploaded
```

`API/fetch.js` holds the endpoints and the transport list.

## Local development

There is no build. Serve the folder with any static server:

```bash
npx serve .          # or: python -m http.server 8000
```

Then open `http://localhost:3000` (or `:8000`).

> Open it through a server, not as a `file://` URL — the Status page and `/API/fetch` need `fetch()` to work.

## Deployment

Any static host works. For the custom 404, the host must look for `404.html` at the site root (Netlify, GitHub Pages and Cloudflare Pages all do).

## Notes

- The site blocks right-click, text selection and devtools shortcuts as a soft deterrent. That is not real protection — anything shipped to a browser can be read.
- `Logo.png` is an unused legacy asset and is not referenced anywhere.
