# Horizon

Source for **[gethorizon.kdns.fr](https://gethorizon.kdns.fr/)** — the public site for Horizon, a keyless Roblox executor.

Static site. No build step and no framework — open `index.html` or point any
static host at the repo root. One exception: `middleware.js` is Vercel Routing
Middleware, and only powers the two key-system endpoints (see below).

```
/
├── index.html          Home + Status (single page, two views)
├── 404.html            Custom "page not found" (used by Netlify / GitHub Pages / Cloudflare Pages)
├── get_key.html        Key flow — entry, /get_key/v=1
├── key.html            Key flow — checkpoint callbacks + the key page
├── middleware.js       /key/verify/* and /api/key/issue (Vercel only)
├── package.json        Exists only so middleware.js is treated as an ES module
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
| `/get_key/v=1` | Starts the two-checkpoint key flow |
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

## Key system

`/get_key/v=1` opens a two-checkpoint chain that ends on a page showing a
single-use key with a Copy button.

| Step | URL | What happens |
| --- | --- | --- |
| 1 | `/get_key/v=1` | mints an `auth`, tells work.ink to bounce back here, then **holds a 60-second countdown** before opening Checkpoint 1 |
| 2 | `/key/auth=<auth>/c1` | proves Checkpoint 1 finished → redirects to Checkpoint 2 |
| 3 | `/key/auth=<auth>/c2` | proves Checkpoint 2 finished → mints a `success` token |
| 4 | `/key/success=<token>` | calls the issue endpoint, shows the key |
| — | `/key/verify/key=<KEY>` | looks a key up in the gist |

### The minute before Checkpoint 1

The entry page does not hand anyone straight to work.ink. It shows a countdown
of `HOLD_MS` (60 s) with a filling bar, holding the redirect token it already
has, and only follows it when the timer reaches zero.

That deadline is `holdFrom + HOLD_MS`, saved in `sessionStorage`, so a reload
resumes the same clock rather than restarting it — otherwise staying put would
be one refresh away. It is stored as a timestamp, not a counter, because
background tabs throttle timers and a timestamp still lands correctly the
moment the tab is looked at again.

### Why it cannot just be typed in

Each redirect to work.ink carries a `{TOKEN}` placeholder in its destination,
which work.ink fills in when it sends the visitor back. Only work.ink can
produce one, so there is nothing to forge.

`middleware.js` validates **both** tokens server-side against work.ink, then
burns them with `?deleteToken=1` so the same pair can never mint a second key.
None of that check lives in page JavaScript, so editing `key.html` buys nothing.

Which work.ink endpoint answers depends on whether `WORKINK_API_KEY` is set:

| Env | Endpoint | Token from another work.ink account |
| --- | --- | --- |
| unset | `_api/v2/token/isValid/{TOKEN}` | **accepted** — the hole below is open |
| set | `_api/v2/token/verify/{TOKEN}` + `X-Api-Key` | **403**, rejected |

That second row is the point. The public `isValid` endpoint *"answers anyone
who holds a key"*, so without `WORKINK_API_KEY` an attacker can mint a token
from **their own** work.ink link, hand both to `/api/key/issue`, and be issued
a key without ever touching Checkpoint 1 or 2. The authenticated endpoint
rejects any token not created for one of your links, which is what makes the
flow actually closed. `401` (our credential wrong) is reported as
`503 key verification is misconfigured` and fires before anything is spent;
`403` is simply `valid: false`.

What is *not* protected: step order and one-time use are enforced with
`sessionStorage`, which can be cleared. That only earns a restart — fresh
work.ink tokens are still required.

Each step URL is spent once. Revisiting a used one redirects to a path that is
deliberately never rewritten, so the host returns a real `404`. `/get_key/v=1`
keeps working until a key has actually been issued.

### Key lifetime — 24 hours

Keys are stored as `<key> <unix seconds>`, so `/key/verify` knows how old each
one is. A key is good for **86 400 seconds (24 h)** from the moment it was
issued:

- within the window → `{"valid": true, "expiresInSeconds": …}`
- older than that → `{"valid": false, "expired": true}` — still shown as
  *issued*, but no longer accepted, with the HTML page heading **Expired**
  instead of **Not valid**.

`KEY_TTL_SECONDS` in `middleware.js` is the single place that changes it.

Two clocks, deliberately separate:

| Clock | Where it lives | What it does |
| --- | --- | --- |
| Horizon key | the gist + `KEY_TTL_SECONDS` | how long the key the visitor keeps stays usable |
| work.ink token | **Settings → Key Expiration Time (minutes)** | how long a checkpoint proof survives before `middleware.js` rejects it |

The second one matters more than it looks: `/api/key/issue` re-validates
Checkpoint 1's token only *after* Checkpoint 2 is done, so the setting has to
cover the whole run. At the default **5 minutes** a visitor who watches an ad
for six loses both checkpoints. **Set it to `1440`** (24 h) in the work.ink
dashboard — tokens are burned with `deleteToken=1` on issue, so a long window
does not make them reusable.

### Setup

The gist is **private**, so both endpoints need a token:

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Tokens (classic)** → generate with the **`gist`** scope only.
   (Fine-grained tokens cannot reach gists.)
2. Vercel → Project → Settings → Environment Variables → add `GIST_TOKEN`.
3. work.ink → **API Keys** → Add key (the same key the Link API uses), then
   add `WORKINK_API_KEY` in Vercel. Skip this only if you are happy leaving
   the cross-account hole above open.
4. Redeploy.

Without `GIST_TOKEN`, issuing answers `503 key storage is not configured`
*before* any checkpoint token is spent, so nobody loses progress. Issued keys
are appended as `<key> <unix seconds>` beneath the existing `HORIZON-OWNER`
line.

### Where it runs

`middleware.js` is Vercel **Routing Middleware**, deliberately not an `api/`
function: the repo already has an uppercase `API/` folder, and the two cannot
coexist on a case-insensitive filesystem. Middleware also runs before rewrites,
so `/key/verify/*` is answered before `/key/:path*` hands it to `key.html`.

On a host that only reads `_redirects`, both endpoints 404 and the flow stops at
step 4.

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
