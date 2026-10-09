/* ---------------------------------------------------------------------------
   HEXION.FUN — key system endpoints
   ---------------------------------------------------------------------------
   Handled by Vercel Routing Middleware (Node.js runtime), which runs BEFORE
   static routing. That matters: /key/verify/key=<KEY> has to win over the
   "/key/:path*" rewrite that sends everything else to key.html.

   This is deliberately not an api/ directory. The site already ships an
   uppercase API/ folder holding the /API/fetch files, and a lowercase api/
   folder cannot exist beside it on a case-insensitive filesystem. Middleware
   keeps the two apart without moving a single file that already works.

     GET  /key/verify/key=<KEY>       look a key up in the gist
     GET  /key/verify/key=<KEY>/raw   same, always JSON whatever the client is
     POST /api/key/issue          burn both work.ink tokens, mint a key

   Both need GIST_TOKEN in the project environment (gist read + write).
   The secret never reaches the browser, which is the whole point.
--------------------------------------------------------------------------- */

import { randomBytes } from 'node:crypto';

const GIST_ID   = '2b8d1771bd120bed768c14ae8b2431a1';

const LETTERS    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_LENGTH = 19; // same shape as HSIHHIzihekjkhijhgf

/* A Hexion.fun key is good for 24h from the moment it was issued. */
const KEY_TTL_SECONDS = 24 * 60 * 60;

export const config = {
  runtime: 'nodejs',
  matcher: ['/key/verify/:path*', '/api/key/issue']
};

/* ---------------------------------------------------------------- helpers */

function cors(extra) {
  return Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    extra || {}
  );
}

function json(status, body, indent) {
  return new Response(JSON.stringify(body, null, indent || 0), {
    status: status,
    headers: cors({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}

function preflight(methods) {
  return new Response(null, {
    status: 204,
    headers: cors({
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    })
  });
}

function randomString(n, alphabet) {
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet.charAt(bytes[i] % alphabet.length);
  return out;
}

/* consume=true appends ?deleteToken=1, which makes the token one-shot.
 *
 * With WORKINK_API_KEY set this uses the authenticated endpoint, which is the
 * whole reason to prefer it: it answers 403 for a token minted by somebody
 * else's work.ink account. Without it an attacker could satisfy this check
 * with a token from their own link and never run our checkpoints at all.
 *
 * 401 -> our own credential is wrong (configuration, not the visitor).
 * 403 -> credential is fine, token is foreign -> treat as not valid.
 */
async function workInkValid(token, consume) {
  const apiKey = process.env.WORKINK_API_KEY;
  const endpoint = apiKey ? 'token/verify/' : 'token/isValid/';
  const url = 'https://work.ink/_api/v2/' + endpoint + encodeURIComponent(token) +
              (consume ? '?deleteToken=1' : '');

  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const res = await fetch(url, { headers: headers, redirect: 'manual' });

  if (res.status === 401) {
    const err = new Error('work.ink rejected WORKINK_API_KEY (401)');
    err.code = 'WORKINK_MISCONFIGURED';
    throw err;
  }
  if (res.status === 403) return false;
  if (!res.ok) throw new Error('work.ink answered ' + res.status);

  const data = await res.json();
  return data && data.valid === true;
}

function gistHeaders() {
  const token = process.env.GIST_TOKEN;
  if (!token) {
    const err = new Error('GIST_TOKEN is not set');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hexion-key-system'
  };
}

/* One read returns both the file name (needed to write back) and its text. */
async function readGist(headers) {
  const res = await fetch('https://api.github.com/gists/' + GIST_ID, { headers });
  if (!res.ok) throw new Error('gist read answered ' + res.status);
  const gist = await res.json();

  const names = Object.keys(gist.files || {});
  if (!names.length) throw new Error('gist has no files');
  const name = names[0];

  const file = gist.files[name];
  let content = file.content || '';
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, { headers });
    if (raw.ok) content = await raw.text();
  }
  return { name: name, content: content };
}

/* Gists have no append operation, so this is read -> concat -> write. Two
   issues landing on the same instant can drop a line; the key is still handed
   back, and running the checkpoints again is the repair. */
async function appendKey(key) {
  const headers = gistHeaders();
  const gist = await readGist(headers);

  const stamp = Math.floor(Date.now() / 1000);
  const next = gist.content.replace(/\s+$/, '') + '\n' + key + ' ' + stamp + '\n';

  const res = await fetch('https://api.github.com/gists/' + GIST_ID, {
    method: 'PATCH',
    headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files: { [gist.name]: { content: next } } })
  });
  if (!res.ok) throw new Error('gist write answered ' + res.status);
}

/* Each issued line is "<key> <unix seconds>". The owner line that was already
   in the file has no timestamp, so it never counts as issued. */
function lookup(content, key) {
  const lines = content.split(/\r?\n/);
  let issued = 0;
  let hit = null;

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (!parts[0]) continue;

    const hasStamp = parts.length > 1 && /^\d{9,}$/.test(parts[1]);
    if (hasStamp) issued++;

    if (parts[0] === key) {
      hit = { stamp: hasStamp ? parseInt(parts[1], 10) : null };
    }
  }

  return { hit: hit, issued: issued };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderHtml(result) {
  const ok = !!result.valid;
  const issued = typeof result.issued === 'number' ? result.issued : 0;

  /* A storage failure has no key and no count - never print "undefined". */
  const headline = ok
    ? 'This key exists and was issued by the Hexion.fun key system.'
    : (result.error || result.message ||
       'This key is not in the issued list. Keys are only handed out after both checkpoints.');

  const heading = ok
    ? 'Valid'
    : (result.error ? 'Unavailable' : (result.expired ? 'Expired' : 'Not valid'));

  const when = result.generatedAt
    ? 'Issued ' + Math.max(0, Math.round(result.ageSeconds / 60)) + ' minute(s) ago. '
    : '';

  const left = ok && result.expiresInSeconds > 0
    ? Math.round(result.expiresInSeconds / 60) + ' minute(s) left of 1440. '
    : '';

  const keyLine = result.key
    ? '<p><code>' + esc(result.key) + '</code></p>'
    : '';

  const counts = issued > 0
    ? when + left + issued + ' key(s) issued in total.'
    : (when + left).trim();

  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="theme-color" content="#030304"><meta name="robots" content="noindex,nofollow">' +
    '<title>Hexion.fun — Key check</title>' +
    '<link rel="icon" type="image/png" href="/assets/hexion_nobg.png">' +
    '<style>' +
    '*,*::before,*::after{box-sizing:border-box}' +
    'html,body{margin:0;background:#030304;color:#f7f7f8;font-family:Inter,system-ui,sans-serif}' +
    'body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:30px}' +
    '.c{width:100%;max-width:460px;background:#0a0a0c;border:1px solid #1c1c21;' +
    'border-radius:16px;padding:38px 34px;text-align:center}' +
    '.s{font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.22em;color:#85858d;margin-bottom:16px}' +
    'h1{font-size:30px;margin:0 0 12px;letter-spacing:-.02em}' +
    '.ok h1{color:#7ee2a2}.no h1{color:#ff9ba3}' +
    'p{margin:0 0 20px;color:#a1a1aa;font-size:14.5px;line-height:1.65}' +
    'code{font:700 14px ui-monospace,Menlo,monospace;color:#f7f7f8;word-break:break-all}' +
    '.n{font-size:12.5px;color:#85858d;line-height:1.65}' +
    'a{color:#a1a1aa}' +
    '</style></head><body><div class="c ' + (ok ? 'ok' : 'no') + '">' +
    '<div class="s">HEXION.FUN KEY CHECK</div>' +
    '<h1>' + heading + '</h1>' +
    '<p>' + esc(headline) + '</p>' +
    keyLine +
    '<p class="n">' + esc(counts) + (counts ? '<br>' : '') + '<a href="/">Back to Hexion.fun</a></p>' +
    '</div></body></html>';
}

/* -------------------------------------------------------------- handlers */

async function handleIssue(request) {
  if (request.method === 'OPTIONS') return preflight('POST, OPTIONS');
  if (request.method !== 'POST')   return json(405, { error: 'use POST' });

  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  body = body || {};

  const t1 = String(body.t1 || '');
  const t2 = String(body.t2 || '');

  if (!t1 || !t2) return json(400, { error: 'missing checkpoint token' });

  /* Check storage BEFORE anything is spent, so a missing configuration never
     costs a visitor both checkpoints. */
  try { gistHeaders(); } catch (err) {
    return json(503, { error: 'key storage is not configured' });
  }

  try {
    const [ok1, ok2] = await Promise.all([
      workInkValid(t1, false),
      workInkValid(t2, false)
    ]);

    if (!ok1 || !ok2) return json(403, { error: 'checkpoint not verified' });

    /* Both are good. Burn them: from here this pair is worthless. */
    const [burn1, burn2] = await Promise.all([
      workInkValid(t1, true),
      workInkValid(t2, true)
    ]);

    if (!burn1 || !burn2) return json(409, { error: 'checkpoint token already used' });

    const key = randomString(KEY_LENGTH, LETTERS);
    await appendKey(key);

    return json(200, { key: key });
  } catch (err) {
    console.error('[hexion] issue failed:', err && err.message);

    /* 401 from work.ink means our own credential is wrong. This fires on the
       first, non-destructive check, so no checkpoint token has been spent. */
    if (err && err.code === 'WORKINK_MISCONFIGURED') {
      return json(503, { error: 'key verification is misconfigured' });
    }
    return json(502, { error: 'verification failed' });
  }
}

async function handleVerify(request, url) {
  if (request.method === 'OPTIONS') return preflight('GET, OPTIONS');
  if (request.method !== 'GET')     return json(405, { error: 'use GET' });

  /* /key/verify/key=<KEY>/raw is the machine-readable form. It answers JSON
     for every status - success, unknown key, bad path, storage down - whatever
     Accept header arrives with, so an app never has to negotiate for it or
     scrape HTML. The plain address still prefers HTML so a browser gets a page. */
  let pathname = url.pathname;
  const isRaw = /\/raw\/?$/i.test(pathname);
  if (isRaw) pathname = pathname.replace(/\/raw\/?$/i, '');

  const match = pathname.match(/^\/key\/verify\/key=([^/]+)\/?$/);

  const accept = String(request.headers.get('accept') || '');
  const forceJson = isRaw || new URL(url).searchParams.get('format') === 'json';
  const wantsHtml = !forceJson && accept.indexOf('text/html') >= 0;

  /* Pretty-printed only in the /raw form: it is meant to be opened and read. */
  const pretty = isRaw ? 2 : 0;

  if (!match) {
    const payload = {
      valid: false,
      error: 'bad verify path',
      usage: '/key/verify/key=<KEY>  —  append /raw for JSON only'
    };
    if (wantsHtml) {
      return new Response(renderHtml(payload), {
        status: 400,
        headers: cors({ 'Content-Type': 'text/html; charset=utf-8' })
      });
    }
    return json(400, payload, pretty);
  }

  const key = decodeURIComponent(match[1]);

  try {
    const headers = gistHeaders();
    const gist = await readGist(headers);
    const found = lookup(gist.content, key);

    const now = Math.floor(Date.now() / 1000);
    const stamp = found.hit && found.hit.stamp ? found.hit.stamp : null;
    const age = stamp ? now - stamp : null;

    /* Issued, but older than a day: still a known key, just no longer good. */
    const expired = !!stamp && age > KEY_TTL_SECONDS;

    const result = {
      valid: !!stamp && !expired,
      key: key,
      expired: expired,
      message: expired
        ? 'This key expired after 24 hours. Run both checkpoints again for a fresh one.'
        : null,
      generatedAt: stamp,
      ageSeconds: age,
      expiresInSeconds: stamp && !expired ? KEY_TTL_SECONDS - age : 0,
      issued: found.issued
    };

    if (wantsHtml) {
      return new Response(renderHtml(result), {
        status: 200,
        headers: cors({ 'Content-Type': 'text/html; charset=utf-8' })
      });
    }
    return json(result.valid ? 200 : 404, result, pretty);
  } catch (err) {
    const notConfigured = err && err.code === 'NOT_CONFIGURED';
    const payload = {
      valid: false,
      error: notConfigured ? 'key storage is not configured' : 'lookup failed'
    };

    if (wantsHtml) {
      return new Response(renderHtml(payload), {
        status: notConfigured ? 503 : 502,
        headers: cors({ 'Content-Type': 'text/html; charset=utf-8' })
      });
    }
    return json(notConfigured ? 503 : 502, payload, pretty);
  }
}

/* ---------------------------------------------------------------- entry */

export default async function middleware(request) {
  const url = new URL(request.url);

  if (url.pathname === '/api/key/issue') {
    return handleIssue(request);
  }

  if (url.pathname.indexOf('/key/verify/') === 0) {
    return handleVerify(request, url);
  }

  /* The matcher should make this unreachable, but never leave a request
     hanging if it ever is. */
  return json(404, { error: 'not found' });
}
