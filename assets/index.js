/* ============================================================================
   HORIZON — site source
   Rebuilt from the production bundle (Home + Status).
   No framework, no build step: edit, save, refresh.
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------------------
   Icons — lucide (ISC licence), inlined so there is no runtime dependency.
   ------------------------------------------------------------------------- */
const ICONS = {
  sparkles:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594z"/>' +
    '<path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/>',
  code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  download:
    '<path d="M12 15V3"/>' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<path d="m7 10 5 5 5-5"/>',
  message:
    '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
    '<path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
    '<path d="M8 16H3v5"/>'
};

function icon(name, size, cls) {
  size = size || 24;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"' +
    (cls ? ' class="' + cls + '"' : '') +
    ' aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>'
  );
}

/* ---------------------------------------------------------------------------
   Config
   ------------------------------------------------------------------------- */
const LOGO_REMOTE = 'http://paloma.hidencloud.com:24617/cdn/horizonnn.png';
const LOGO_LOCAL  = 'assets/horizonnn.png';
/* Builds live on the Horizon CDN rather than in this repo. Horizon-Internal.zip
   is not uploaded yet: flip INTERNAL_READY to true once it is, and the Internal
   button switches from "COMING SOON" to a real download on its own. */
const CDN_BASE = 'http://paloma.hidencloud.com:24617/cdn/';
const DOWNLOAD_URLS = {
  external: CDN_BASE + 'Horizon-External.zip',
  internal: CDN_BASE + 'Horizon-Internal.zip'
};
const INTERNAL_READY = false;

/* The original build pointed the Discord button at the footer, which has no
   invite in it. Point it at your real invite instead - change it here only. */
const DISCORD_INVITE = 'https://discord.gg/beM4pRtBdG';

/* Live build status. Every build has its own endpoint and the Status page
   polls both through API/fetch.js, on the same 10-second cadence as /API/fetch. */
const API_ORIGIN = 'http://paloma.hidencloud.com:24617';
const BUILD_ENDPOINTS = {
  internal: API_ORIGIN + '/api/fetch/Internal',
  external: API_ORIGIN + '/api/fetch/External'
};

/* Remote logo first (as configured), bundled copy as an automatic fallback so
   the mark still renders on hosts that serve the page over HTTPS. */
function logoImg() {
  return '<img src="' + LOGO_REMOTE + '" alt="" ' +
         'onerror="this.onerror=null;this.src=\'' + LOGO_LOCAL + '\'">';
}

/* ---------------------------------------------------------------------------
   State
   ------------------------------------------------------------------------- */
const state = {
  page: 'home',            // 'home' | 'status'
  modal: false,
  downloading: false,
  downloadError: null,     // set when the build file is missing on the host
  roblox: 'Checking...',
  robloxChecked: false,
  robloxLoading: false,
  /* online: null = still checking, true/false = last known state.
     `latest` and `supported` are the two hashes the status is derived from. */
  builds: {
    internal: { online: null, latest: '', supported: '', checked: false, error: null },
    external: { online: null, latest: '', supported: '', checked: false, error: null }
  }
};

/* ---------------------------------------------------------------------------
   Partials
   ------------------------------------------------------------------------- */
function statusPill(online, label) {
  return '<span class="status-pill ' + (online ? 'online' : 'offline') + '">' +
         '<span class="status-dot"></span> ' + label + '</span>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return {
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[ch];
  });
}

/* ---------------------------------------------------------------------------
   Live build status
   -------------------------------------------------------------------------
   A build is UP when it still supports the newest release:

       latest      newest version that exists
       supported   newest version this build actually handles

   Equal -> ONLINE, different -> OFFLINE. Both hashes are printed on the card
   so the pill can be checked by eye instead of taken on trust. A payload that
   cannot answer that question falls back to plain reachability (the endpoint
   answered, so the build is being served) - unless it carries an explicit
   `status` flag, which outranks the guess.
   ------------------------------------------------------------------------- */

const STATUS_ON  = ['online', 'up', 'available', 'ready', 'live', 'true', '1'];
const STATUS_OFF = ['offline', 'down', 'unavailable', 'coming soon', 'in dev', 'false', '0'];

function deriveBuildStatus(data, reachable) {
  /* Nothing to judge on */
  if (!reachable || !data) return false;

  /* An explicit flag, if the API ever grows one, wins outright */
  if (typeof data.status === 'string') {
    const s = data.status.trim().toLowerCase();
    if (STATUS_ON.includes(s)) return true;
    if (STATUS_OFF.includes(s)) return false;
  }

  /* The rule: latest must match supported */
  if (typeof data.latest === 'string' && typeof data.supported === 'string') {
    if (!data.latest && !data.supported) return true;   // empty payload: no signal
    return data.latest === data.supported;
  }

  /* Older shape: `supported` as a boolean */
  if (typeof data.supported === 'boolean') return data.supported;

  return true;   // reachable and nothing to compare
}

function buildPill(build) {
  if (build.online === null) return statusPill(false, 'CHECKING...');
  return statusPill(build.online, build.online ? 'ONLINE' : 'OFFLINE');
}

function buildVersions(build) {
  if (build.online === null) {
    return '<div class="build-versions"><div class="build-line">' +
           '<strong>checking…</strong></div></div>';
  }

  const row = (label, value) =>
    '<div class="build-line"><span>' + label + '</span>' +
      '<strong>' + escapeHtml(value || '—') + '</strong></div>';

  return '<div class="build-versions">' +
           row('latest', build.latest) +
           row('supported', build.supported) +
         '</div>';
}

function buildCard(opts) {
  const build = opts.build;
  return (
    '<article class="status-card">' +
      '<div class="status-card-head"><span>' + opts.title + '</span>' +
        icon(opts.iconName, 17) + '</div>' +
      buildPill(build) +
      buildVersions(build) +
      '<p>' + escapeHtml(build.error || opts.copy) + '</p>' +
    '</article>'
  );
}

const buildPollers = {};

function applyBuild(key, snapshot) {
  const build = state.builds[key];
  const reachable = snapshot.error === null && snapshot.data !== null;

  build.checked = true;
  build.error = snapshot.error;
  build.online = deriveBuildStatus(snapshot.data, reachable);

  if (reachable) {
    const data = snapshot.data || {};
    if (typeof data.latest === 'string') build.latest = data.latest;
    if (typeof data.supported === 'string') build.supported = data.supported;
  }

  if (state.page === 'status') render();
}

function startBuildPollers() {
  const canPoll = window.HorizonAPI &&
    typeof window.HorizonAPI.createPoller === 'function';

  if (!canPoll) {
    Object.keys(BUILD_ENDPOINTS).forEach(function (key) {
      state.builds[key].online = false;
      state.builds[key].checked = true;
      state.builds[key].error = 'API/fetch.js failed to load';
    });
    render();
    return;
  }

  const keys = Object.keys(BUILD_ENDPOINTS);

  function ensure(key) {
    if (!buildPollers[key]) {
      buildPollers[key] = window.HorizonAPI.createPoller(BUILD_ENDPOINTS[key]);
    }
    return buildPollers[key];
  }

  function begin(key) {
    ensure(key).start(function (snapshot) { applyBuild(key, snapshot); });
  }

  /* Transports are raced only until one of them wins, and the winner is then
     reused for every later request. Let the first endpoint finish that race
     before starting the others, so they go straight to the working transport
     instead of re-racing all of them (and logging a fresh batch of CORS
     errors) at the same moment. */
  let primed = false;
  const first = keys[0];

  ensure(first).start(function (snapshot) {
    applyBuild(first, snapshot);
    if (primed) return;
    primed = true;
    if (state.page !== 'status') return;   // page was left while still in flight
    keys.slice(1).forEach(begin);
  });
}

function stopBuildPollers() {
  Object.keys(buildPollers).forEach(function (key) {
    buildPollers[key].stop();
  });
}

function nav() {
  const tab = (id, label, extra) =>
    '<button data-nav="' + id + '"' + (state.page === id ? ' class="active"' : '') + '>' +
    label + (extra || '') + '</button>';

  return (
    '<nav class="nav">' +
      '<button class="brand" data-nav="home">' +
        '<span class="brand-mark">' + logoImg() + '</span>' +
        '<span>HORIZON</span>' +
      '</button>' +
      '<div class="nav-tabs">' +
        tab('home', 'Home') +
        tab('status', 'Status') +
      '</div>' +
      '<button class="nav-ghost" data-action="open-download">Get Horizon</button>' +
    '</nav>'
  );
}

function homePage() {
  return (
    '<section id="home" class="hero">' +
      '<div class="orb orb-one"></div>' +
      '<div class="orb orb-two"></div>' +
      '<div class="grid"></div>' +
      '<div class="hero-copy">' +
        '<div class="eyebrow">' + icon('sparkles', 14) + ' BUILT FOR SPEED</div>' +
        '<h1>Horizon<span>.</span></h1>' +
        '<p class="tagline">Your scripts. Your space.<br>' +
          'A cleaner interface built around the way you play.</p>' +
        '<div class="actions">' +
          '<button class="btn btn-primary" data-action="open-download">' +
            icon('download', 18) + ' Download ' + icon('arrowRight', 17, 'arrow') +
          '</button>' +
          '<a class="btn btn-secondary" href="' + DISCORD_INVITE + '"' +
            ' target="_blank" rel="noopener noreferrer">' +
            icon('message', 18) + ' Discord</a>' +
        '</div>' +
        '<div class="microcopy"><span class="status-dot"></span>' +
          ' Lightweight interface &nbsp;&middot;&nbsp; Smooth workflow</div>' +
      '</div>' +
    '</section>' +

    '<section class="features">' +
      '<div class="section-label">HORIZON</div>' +
      '<div class="feature-grid">' +
        '<article><strong>01</strong><h2>Clean</h2>' +
          '<p>No clutter. Every control has a purpose.</p></article>' +
        '<article><strong>02</strong><h2>Status</h2>' +
          '<p>Internal and external availability shown separately.</p></article>' +
        '<article><strong>03</strong><h2>Keyless</h2>' +
          '<p>No keys, no waiting. Grab the client and go.</p></article>' +
      '</div>' +
    '</section>'
  );
}

function statusPage() {
  const robloxCopy = state.robloxChecked
    ? 'Latest client version detected.'
    : 'Checking the latest client version...';

  return (
    '<section class="status-page">' +
      '<div class="page-kicker">HORIZON STATUS</div>' +
      '<h1>System status.</h1>' +
      '<p class="page-sub">Executor availability is shown separately for each build. ' +
        'A Roblox update can affect internal availability.</p>' +

      '<div class="status-grid">' +
        buildCard({
          title: 'Internal Executor',
          iconName: 'code',
          build: state.builds.internal,
          copy: 'Internal availability is tracked live.'
        }) +

        buildCard({
          title: 'External',
          iconName: 'activity',
          build: state.builds.external,
          copy: 'External availability is tracked independently.'
        }) +

        '<article class="status-card roblox-card">' +
          '<div class="status-card-head"><span>Roblox version check</span>' +
            icon('refresh', 17) + '</div>' +
          '<strong>' + escapeHtml(state.roblox) + '</strong>' +
          '<p>' + robloxCopy + '</p>' +
          '<button class="mini-btn" data-action="refresh-roblox"' +
            (state.robloxLoading ? ' disabled' : '') + '>' +
            icon('refresh', 14) + ' Refresh</button>' +
        '</article>' +
      '</div>' +

      '<div class="status-note">' + icon('clock', 16) +
        '<span>If Roblox updates, Horizon can mark the affected internal build as ' +
        'unavailable until it is updated.</span></div>' +
    '</section>'
  );
}

function downloadModal() {
  if (!state.modal) return '';

  return (
    '<div class="modal-backdrop" data-action="close-download">' +
      '<section class="download-modal" data-modal-body>' +
        '<button class="modal-close" data-action="close-download" aria-label="Close">' +
          icon('x', 18) + '</button>' +

        '<div class="modal-kicker">HORIZON DOWNLOAD</div>' +
        '<h2>Choose your method.</h2>' +
        '<p class="modal-sub">Pick the version you want. Internal is still in development.</p>' +

        '<div class="method-list">' +
          '<button class="method-card" data-action="internal">' +
            '<div class="method-icon">' + icon('code', 20) + '</div>' +
            '<div class="method-info">' +
              '<div class="method-title">Internal Executor ' +
                (INTERNAL_READY
                  ? statusPill(true, 'ONLINE')
                  : '<span class="soon">COMING SOON</span>') +
              '</div>' +
              '<p>' + (INTERNAL_READY
                ? 'Internal Horizon client (.zip &mdash; extract before running).'
                : 'Built into Horizon. Not available yet.') +
              '</p>' +
            '</div>' +
            icon('chevronRight', 18) +
          '</button>' +

          '<button class="method-card" data-action="external"' +
            (state.downloading ? ' disabled' : '') + '>' +
            '<div class="method-icon">' + icon('download', 20) + '</div>' +
            '<div class="method-info">' +
              '<div class="method-title">External ' + statusPill(true, 'ONLINE') + '</div>' +
              '<p' + (state.downloadError ? ' class="download-error"' : '') + '>' +
                (state.downloading
                  ? 'Starting download...'
                  : (state.downloadError
                      ? escapeHtml(state.downloadError)
                      : 'External Horizon client (.zip &mdash; extract before running).')) +
              '</p>' +
            '</div>' +
            icon('chevronRight', 18) +
          '</button>' +
        '</div>' +
      '</section>' +
    '</div>'
  );
}

function footer() {
  return (
    '<footer id="discord">' +
      '<span>&copy; 2026 Horizon</span>' +
      '<button data-action="to-top">Back to top &uarr;</button>' +
    '</footer>'
  );
}

/* ---------------------------------------------------------------------------
   Render
   ------------------------------------------------------------------------- */
const root = document.getElementById('root');

function render() {
  root.innerHTML =
    '<main class="page">' +
      nav() +
      (state.page === 'home' ? homePage() : statusPage()) +
      footer() +
      downloadModal() +
    '</main>';
}

function setPage(page) {
  if (state.page === page) return;
  const previous = state.page;

  state.page = page;

  /* Stop watching the build endpoints once the Status page is left behind. */
  if (previous === 'status') stopBuildPollers();

  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (page === 'status') {
    loadRobloxVersion();
    startBuildPollers();
  }
}

/* ---------------------------------------------------------------------------
   Roblox client version check
   ------------------------------------------------------------------------- */
async function loadRobloxVersion() {
  state.robloxLoading = true;
  state.robloxChecked = false;
  render();

  try {
    const res = await fetch(
      'https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer',
      { cache: 'no-store' }
    );
    const data = await res.json();
    state.roblox = (data && data.clientVersionUpload) || 'Unknown';
  } catch (err) {
    state.roblox = 'Unavailable';
  } finally {
    state.robloxLoading = false;
    state.robloxChecked = true;
    if (state.page === 'status') render();
  }
}

/* ---------------------------------------------------------------------------
   Download
   ------------------------------------------------------------------------- */
/* A file we serve ourselves can be probed for a real HTTP status before we
   send a visitor at it. Anything on another origin cannot: mixed content
   blocks fetch() outright on HTTPS and the CDN sends no CORS headers, so the
   check would always "fail" and tell us nothing. Those links are used as-is. */
function isSameOrigin(url) {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch (e) {
    return false;
  }
}

function startDownload(which) {
  const url = DOWNLOAD_URLS[which];

  state.downloadError = null;
  state.downloading = true;
  render();

  if (!isSameOrigin(url)) {
    triggerDownload(which, url);
    return;
  }

  fetch(url, { method: 'HEAD', cache: 'no-store' })
    .then(function (res) {
      if (res.status === 404 || res.status === 410) {
        console.warn('[Horizon] Build file is missing on the host:', url);
        state.downloading = false;
        state.downloadError = 'This build isn’t available right now. Please check back soon.';
        render();
        return;
      }
      triggerDownload(which, url);
    })
    .catch(function () {
      triggerDownload(which, url);   // could not verify - just try
    });
}

function triggerDownload(which, url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Horizon-' + (which === 'internal' ? 'Internal' : 'External') + '.zip';

  /* `download` is ignored across origins, so open it in a tab of its own -
     that way a host answering with HTML cannot navigate the site away. */
  if (!isSameOrigin(url)) {
    a.target = '_blank';
    a.rel = 'noopener';
  }

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(function () {
    state.downloading = false;
    if (state.modal) render();
  }, 1500);
}

/* ---------------------------------------------------------------------------
   Events
   ------------------------------------------------------------------------- */
document.addEventListener('click', function (e) {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    setPage(navBtn.getAttribute('data-nav'));
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.getAttribute('data-action');

  /* The backdrop carries the same action as the X button. If the click landed
     inside the modal card but not on the X, it is not a dismiss. */
  if (action === 'close-download' &&
      e.target.closest('[data-modal-body]') &&
      !e.target.closest('.modal-close')) return;

  switch (action) {
    case 'open-download':
      state.modal = true;
      state.downloadError = null;
      render();
      break;

    case 'close-download':
      state.modal = false;
      state.downloading = false;
      render();
      break;

    case 'internal':
      if (!INTERNAL_READY) {
        window.alert('Horizon Internal Executor is coming soon.');
        break;
      }
      startDownload('internal');
      break;

    case 'external':
      startDownload('external');
      break;

    case 'refresh-roblox':
      loadRobloxVersion();
      break;

    case 'to-top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && state.modal) {
    state.modal = false;
    state.downloading = false;
    render();
  }
});

/* ---------------------------------------------------------------------------
   Page hardening — right-click, text selection and devtools shortcuts.
   Inputs stay selectable/editable so forms and copy still work.
   ------------------------------------------------------------------------- */
const isEditable = function (el) {
  return el instanceof HTMLElement &&
    (el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName));
};

const isDevtoolsKey = function (e) {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  return !!(
    key === 'f12' ||
    (mod && e.shiftKey && ['i', 'j', 'c'].includes(key)) ||
    (mod && e.altKey && ['i', 'j', 'c', 'u'].includes(key)) ||
    (mod && ['u', 's'].includes(key))
  );
};

document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
document.addEventListener('keydown', function (e) {
  if (isDevtoolsKey(e)) {
    e.preventDefault();
    e.stopPropagation();
  }
});
document.addEventListener('dragstart', function (e) { e.preventDefault(); });
document.addEventListener('selectstart', function (e) {
  if (!isEditable(e.target)) e.preventDefault();
});
document.addEventListener('copy', function (e) {
  if (!isEditable(e.target)) e.preventDefault();
});

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
render();
