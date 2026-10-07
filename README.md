# Horizon

Source for **[gethorizon.kdns.fr](https://gethorizon.kdns.fr/)** — the public site for Horizon, a keyless Roblox executor.

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

**Why the transport chain?** The upstream now sends
`Access-Control-Allow-Origin: *`, so CORS is no longer the problem — but it is
still `http://` only, and **mixed content** means any `https://` page refuses
to `fetch()` it no matter what headers it carries.

`API/fetch.js` therefore tries its transports in order of cleanliness and keeps
the first that returns parseable JSON:

| transport | when it applies |
| --- | --- |
| `direct` | `http://` pages only — skipped on `https://`, where it is guaranteed to be blocked |
| `site-proxy` | `/horizon-upstream/*`, a same-origin passthrough (needs the host's rewrite config below) |
| `allorigins`, `codetabs`, `corsproxy`, `jina` | last resort — public CORS relays, rate-limited and brittle |

The clean transport gets a solo attempt first, so a working setup logs **zero**
console errors; the others are only raced if it fails. Once a transport wins it
is remembered for every later request.

## Status page

The **Internal Executor** and **External** cards poll their endpoints every 10 s and show:

- pill: **ONLINE** / **OFFLINE** / **CHECKING…** — derived by comparing the two hashes in the payload:

  | `latest` | `supported` | result |
  | --- | --- | --- |
  | `version-abc` | `version-abc` | **ONLINE** — the build still handles the newest release |
  | `version-abc` | `version-xyz` (or `""`) | **OFFLINE** — build hasn't caught up |
  | — | — | **OFFLINE** if the endpoint can't be reached at all |

  An explicit `status` string in the payload outranks the comparison, and an
  empty payload (`latest` *and* `supported` both `""`) is treated as "no
  signal" rather than a failure.

- **`latest` and `supported` are both printed** on the card, so the pill can be
  checked by eye instead of taken on trust.

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

Any static host works. For the custom 404, the host must look for `404.html` at the site root (Netlify, GitHub Pages, Vercel and Cloudflare Pages all do).

The live site is **[gethorizon.kdns.fr](https://gethorizon.kdns.fr/)** (Vercel). Two config files are shipped so the `/horizon-upstream/` passthrough works on either major host — **both are required for the site to reach the API from `https://`**, since mixed content blocks a direct call:

| host | file | effect |
| --- | --- | --- |
| Vercel | `vercel.json` | rewrites `/horizon-upstream/:path*` → `http://paloma.hidencloud.com:24617/:path*` |
| Netlify | `_redirects` | same rewrite, Netlify syntax |

On a host with neither (GitHub Pages, Cloudflare Pages), there is no same-origin passthrough and the Status page must fall back to a public relay. The alternative everywhere is to serve the API over `https://`, which would make the `direct` transport usable and both config files redundant.

### Asset caching

Measured on the live host:

| file | `Cache-Control` sent to the browser |
| --- | --- |
| `/`, `/404.html` (HTML) | `public, max-age=0, must-revalidate` |
| `/assets/*.js`, `/assets/*.css`, `/API/*.js` | `public, max-age=14400, must-revalidate` |

The difference is Cloudflare, not this repo: Cloudflare caches `.js`/`.css` and then stamps its own **Browser Cache TTL** (default 4 hours) onto the response, while HTML passes through with the origin's value. `vercel.json` sets the origin side to `max-age=0, must-revalidate`, which is the correct declaration and takes effect as soon as the zone's Browser Cache TTL is set to *Respect Origin* — but with the default it never reaches the browser.

**So a push to JS/CSS can stay invisible for up to four hours.** The reliable bypass is the `?v=` query string on the `<script>`/`<link>` tags in `index.html`, `API/fetch.html` and `API/fetch/index.html`: a new query string is a new cache entry, so it ignores whatever the browser is still holding. Change `20261007-1` to any new token — the value is only ever compared for inequality. Bump it whenever `assets/*.js`, `assets/*.css` or `API/fetch.js` change and the change matters right away.

## Notes

- The site blocks right-click, text selection and devtools shortcuts as a soft deterrent. That is not real protection — anything shipped to a browser can be read.
- `Logo.png` is an unused legacy asset and is not referenced anywhere.
