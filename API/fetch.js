/* ============================================================================
   HORIZON — API bridge   ( /API/fetch )
   ---------------------------------------------------------------------------
   Polls the Horizon endpoints every 10 seconds and exposes the result for the
   page at /API/fetch to render. The Status page reuses the same machinery to
   poll the very same endpoints for its build cards.

       http://paloma.hidencloud.com:24617/api/fetch/External
       http://paloma.hidencloud.com:24617/api/fetch/Internal

   NOTE: the old flat endpoint `.../api/fetch` no longer exists upstream (404),
   so there is no single source document to mirror any more. /API/fetch now
   returns both builds side by side, keyed by endpoint name.

   Why this file runs in the browser:
   The site is hosted statically, so no server process can serve live JSON at
   /API/fetch. Instead this module keeps a 10-second poll running and the page
   renders the current snapshot.

   Why there are several transports:
   Two independent things stop a plain cross-site fetch() from working:
     1. CORS         - the upstream Express server sends no
                       `Access-Control-Allow-Origin` header, so the browser
                       refuses to hand the response to the page.
     2. Mixed content - the upstream is http:// only, which any page served over
                       https:// blocks outright.
   So every cycle fires several transports in parallel and keeps the first one
   that returns parseable JSON. `direct` is tried first in spirit: if the
   upstream ever grows CORS (and TLS), it wins immediately and no third party
   is involved.

   Recommended fix on the upstream server (makes this trivially reliable):
       res.set('Access-Control-Allow-Origin', '*');
   plus serving the site over the same scheme as the API.
   ========================================================================== */

(function (global) {
  'use strict';

  var API_BASE = 'http://paloma.hidencloud.com:24617/api/fetch';
  var ENDPOINTS = {
    External: API_BASE + '/External',
    Internal: API_BASE + '/Internal'
  };
  var POLL_INTERVAL = 10000;    // 10 seconds
  var REQUEST_TIMEOUT = 9000;   // abort a single transport
  var HARD_DEADLINE = 12000;    // abandon a whole cycle; never wedge `busy`
  var WEDGE_LIMIT = HARD_DEADLINE + 4000;

  /* ---- transports -------------------------------------------------------- */

  function raw(text) {
    return JSON.parse(text);
  }

  /* r.jina.ai reflects the request Origin (so the browser accepts it) but
     wraps the payload in a small header. Everything after the marker is the
     upstream body, verbatim. */
  function fromJina(text) {
    var marker = 'Markdown Content:';
    var i = text.lastIndexOf(marker);
    var payload = i >= 0 ? text.slice(i + marker.length) : text;
    return JSON.parse(payload.trim());
  }

  /* Same-origin passthrough. The browser fetches this from its own origin, so
     it needs no CORS header and is not blocked as mixed content even though
     the upstream is http:// only. Only works when the host proxies it - see
     `_redirects` and the README. Unconfigured it just 404s and loses the race,
     which is why it costs nothing to keep it first. */
  var PROXY_PREFIX = '/horizon-upstream/';

  /* http://host:port/path  ->  /path */
  function stripOrigin(url) {
    var i = url.indexOf('://');
    var rest = i >= 0 ? url.slice(i + 3) : url;
    var slash = rest.indexOf('/');
    return slash < 0 ? '/' : rest.slice(slash);
  }

  var GATES = [
    {
      id: 'site-proxy',
      build: function (u) { return PROXY_PREFIX + stripOrigin(u); },
      parse: raw
    },
    {
      id: 'direct',
      build: function (u) { return u; },
      parse: raw
    },
    {
      id: 'allorigins',
      build: function (u) {
        return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u);
      },
      parse: raw
    },
    {
      id: 'codetabs',
      build: function (u) {
        return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u);
      },
      parse: raw
    },
    {
      id: 'corsproxy',
      build: function (u) {
        return 'https://corsproxy.io/?' + encodeURIComponent(u);
      },
      parse: raw
    },
    {
      id: 'jina',
      build: function (u) { return 'https://r.jina.ai/' + u; },
      parse: fromJina
    }
  ];

  /* Transport preference is shared: a relay that works for one path on this
     upstream will work for the others too, so we remember it globally. */
  var activeGate = null;

  /* ---- transport selection ---------------------------------------------- */

  function gateById(id) {
    for (var i = 0; i < GATES.length; i++) {
      if (GATES[i].id === id) return GATES[i];
    }
    return null;
  }

  /* The upstream is http:// only, so a page served over https:// can never
     fetch it directly - the browser blocks it as mixed content before the
     request leaves, and writes a console error for free. Don't spend a
     request on a transport that is guaranteed to be refused. */
  function directUsable() {
    if (typeof location === 'undefined') return true;   // not running in a browser
    if (location.protocol !== 'https:') return true;    // no mixed content risk
    return /^https:/.test(API_BASE);                    // upstream has TLS
  }

  function usableGates() {
    return GATES.filter(function (g) {
      return g.id !== 'direct' || directUsable();
    });
  }

  /* Cleanest transport first: the direct request (no third party, and CORS
     now permits it), then the same-origin passthrough, then the relays. */
  function preferredGate() {
    return gateById(directUsable() ? 'direct' : 'site-proxy');
  }

  function otherGates() {
    var preferred = preferredGate();
    return usableGates().filter(function (g) { return g !== preferred; });
  }

  /* ---- primitives -------------------------------------------------------- */

  /* Which transport to try next when nothing has won yet. Shared by every
     poller so two endpoints don't hammer the same relay in lockstep. */
  var rotationCursor = 0;
  function nextGate() {
    var pool = usableGates();
    var gate = pool[rotationCursor % pool.length];
    rotationCursor += 1;
    return gate;
  }

  function request(url) {
    var options = { cache: 'no-store' };

    if (typeof AbortController === 'function') {
      var ctrl = new AbortController();
      options.signal = ctrl.signal;
      setTimeout(function () {
        try { ctrl.abort(); } catch (e) { /* already settled */ }
      }, REQUEST_TIMEOUT);
    }

    return fetch(url, options).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function attempt(gate, url) {
    return request(gate.build(url)).then(function (text) {
      var data = gate.parse(text);   // throws -> this gate loses
      activeGate = gate;
      return { data: data, source: gate.id };
    });
  }

  /** Resolve with the first gate that succeeds; reject only if they all fail. */
  function raceGates(gates, url) {
    return new Promise(function (resolve, reject) {
      if (!gates.length) {
        reject(new Error('no transport available'));
        return;
      }
      var left = gates.length;
      var lastError = null;

      gates.forEach(function (gate) {
        attempt(gate, url).then(resolve, function (err) {
          lastError = err || lastError;
          left -= 1;
          if (left === 0) reject(lastError || new Error('all transports failed'));
        });
      });
    });
  }

  /** Guarantees settlement even if a transport never calls back. */
  function withDeadline(promise, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timerId = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('deadline exceeded')); }
      }, ms);
      promise.then(function (value) {
        if (!settled) { settled = true; clearTimeout(timerId); resolve(value); }
      }, function (err) {
        if (!settled) { settled = true; clearTimeout(timerId); reject(err); }
      });
    });
  }

  function describe(err) {
    if (!err) return 'Unknown error';
    if (err.name === 'AbortError') return 'Request timed out';
    if (err.message === 'deadline exceeded') return 'Poll timed out';
    if (err instanceof TypeError) return 'Blocked by the browser (CORS or mixed content)';
    if (err.message && err.message.indexOf('HTTP ') === 0) {
      return 'Upstream returned ' + err.message;
    }
    if (err instanceof SyntaxError) return 'Response was not valid JSON';
    if (err.message === 'no transport available' ||
        err.message === 'all transports failed') {
      return 'Could not reach the Horizon API from this page';
    }
    return err.message || String(err);
  }

  /* ---- polling ----------------------------------------------------------- */

  /* One poller = one URL = one snapshot. `createPoller` builds more of them so
     several endpoints can be watched at once, each on its own 10s cadence. */
  function createPoller(url) {
    var last = {
      data: null,     // upstream JSON, passed through unchanged
      at: 0,          // epoch ms of the last successful poll
      attemptAt: 0,   // epoch ms the current/last cycle started
      source: null,   // gate that produced it
      error: null,    // last failure message, null when healthy
      ticks: 0        // successful polls so far
    };

    var busy = false;
    var timer = null;
    var onVisible = null;
    var attemptNo = 0;

    /** One cycle. Resolves with the snapshot either way. */
    function fetchNow() {
      if (busy) {
        /* Recover instead of stalling forever if a cycle never settled. */
        if (last.attemptAt && Date.now() - last.attemptAt > WEDGE_LIMIT) {
          busy = false;
        } else {
          return Promise.resolve(last);
        }
      }

      busy = true;
      last.attemptAt = Date.now();
      attemptNo += 1;

      var chain;
      if (activeGate) {
        /* A transport already proved itself: use it, and only re-race the
           usable list if it suddenly stops working. */
        chain = raceGates([activeGate], url).catch(function () {
          return raceGates(usableGates(), url);
        });
      } else if (attemptNo === 1) {
        /* First cycle: give the clean transport a solo shot before falling
           back to a full race. Racing everything up front is no faster - the
           race resolves the moment the first one wins - but it does leave
           console errors from every transport we did not end up needing. */
        chain = raceGates([preferredGate()], url).catch(function () {
          return raceGates(otherGates(), url);
        });
      } else {
        /* Nothing has won yet. Re-racing all of them every 10 seconds only
           earns rate-limit bans (429/403) from the relays, so probe one per
           cycle and rotate through them instead. */
        chain = raceGates([nextGate()], url);
      }

      return withDeadline(chain, HARD_DEADLINE).then(
        function (result) {
          busy = false;
          last.data = result.data;
          last.at = Date.now();
          last.source = result.source;
          last.error = null;
          last.ticks += 1;
          return last;
        },
        function (err) {
          busy = false;
          last.error = describe(err);
          return last;
        }
      );
    }

    /** Poll immediately, then every 10 seconds. `onUpdate(snapshot)` each cycle. */
    function start(onUpdate) {
      stop();

      function tick() {
        fetchNow().then(function (snapshot) {
          if (typeof onUpdate === 'function') onUpdate(snapshot);
        });
      }

      onVisible = function () {
        if (!document.hidden) tick();
      };

      tick();
      timer = setInterval(tick, POLL_INTERVAL);

      /* Background tabs get their timers throttled; catch up on return. */
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', onVisible);
      }

      return timer;
    }

    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (onVisible && typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', onVisible);
        onVisible = null;
      }
    }

    /** Milliseconds until the next poll, 0 before the first success. */
    function nextIn() {
      if (!last.at) return 0;
      return Math.max(0, POLL_INTERVAL - (Date.now() - last.at));
    }

    var poller = {
      url: url,
      last: last,
      fetch: fetchNow,
      start: start,
      stop: stop,
      nextIn: nextIn
    };

    Object.defineProperty(poller, 'busy', { get: function () { return busy; } });
    return poller;
  }

  var ids = [];
  GATES.forEach(function (gate) { ids.push(gate.id); });

  /* No default poller is created here on purpose: every caller builds its own
     with `createPoller(url)` so one dead endpoint cannot stall the others. The
     transport preference below is still shared across all of them. */
  var api = {
    API_BASE: API_BASE,
    ENDPOINTS: ENDPOINTS,
    POLL_INTERVAL: POLL_INTERVAL,
    GATES: ids,
    createPoller: createPoller
  };

  /* Read-only view, handy when debugging a stuck poll. */
  Object.defineProperty(api, 'activeGate', {
    get: function () { return activeGate ? activeGate.id : null; }
  });

  global.HorizonAPI = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;   // usable from Node too, if you ever add a server
  }
})(typeof window !== 'undefined' ? window : this);
