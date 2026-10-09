/* ==========================================================================
   HEXION.FUN — theme switcher
   --------------------------------------------------------------------------
   Loads on every page that offers the palette button (the raw /API/fetch
   views deliberately stay out). Self-contained: injects its own styles so it
   works on pages that never touch assets/index.css — key flow, error pages,
   and the four hidden pages all get the identical widget.

   Responsibilities:
     1. expose the theme list (must stay in sync with assets/themes.css)
     2. apply + persist the chosen theme, update <meta name="theme-color">
     3. render the floating switcher (bottom-right)
     4. follow changes made in another tab via the `storage` event
     5. validate the saved id on every load — anything no longer in the list
        is discarded and the default (Hexion) takes over

   The pre-paint inline script in each <head> already applies a stored theme
   before first paint, so this file never causes a flash — worst case here is
   a button arriving a frame late.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = 'hexion-theme';
  var DEFAULT_ID = 'hexion';

  /* id must match :root[data-theme="…"] in themes.css; dot drives the swatch. */
  var THEMES = [
    { id: 'hexion',    label: 'Hexion',    dot: '#f7f7f8', meta: '#030304' },
    { id: 'halloween', label: 'Halloween', dot: '#ff7a1a', meta: '#0a0609' }
  ];

  function available(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return true;
    }
    return false;
  }

  /* Always resolve to a theme that actually exists. A saved id from an older
     build (or a hand-edited localStorage) is dropped here, and a page with no
     attribute yet falls back to the default — never to "nothing applies". */
  function current() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }

    if (saved && available(saved)) return saved;
    if (saved !== null) {
      try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
    }

    var applied = document.documentElement.getAttribute('data-theme');
    if (available(applied)) return applied;
    return DEFAULT_ID;
  }

  function set(id, persist) {
    var meta = null;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) meta = THEMES[i].meta;
    }
    if (meta === null) return;

    document.documentElement.setAttribute('data-theme', id);

    if (persist !== false) {
      try { localStorage.setItem(KEY, id); } catch (e) { /* full storage */ }
    }

    var tag = document.querySelector('meta[name="theme-color"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'theme-color');
      document.head.appendChild(tag);
    }
    tag.setAttribute('content', meta);

    paint();
  }

  /* ---------------------------------------------------------------- widget */

  var panel = null;
  var toggle = null;

  function paint() {
    if (!panel) return;
    var active = document.documentElement.getAttribute('data-theme');
    var items = panel.querySelectorAll('[data-theme-id]');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-theme-id') === active;
      items[i].setAttribute('aria-checked', on ? 'true' : 'false');
      items[i].classList.toggle('on', on);
    }
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function open() {
    panel.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    paint();
  }

  function injectStyles() {
    var css = [
      '.hx-theme{position:fixed;right:18px;bottom:18px;z-index:90;',
      'font:600 13px Inter,system-ui,sans-serif;user-select:none}',
      '.hx-theme-btn{display:flex;align-items:center;gap:8px;height:42px;padding:0 15px;',
      'border-radius:999px;border:1px solid var(--line-strong,rgba(255,255,255,.16));',
      'background:var(--surface,#0a0a0c);color:var(--text,#f7f7f8);cursor:pointer;',
      'box-shadow:0 8px 30px rgba(0,0,0,.45);backdrop-filter:blur(14px);',
      '-webkit-backdrop-filter:blur(14px);transition:.2s;align-items:center}',
      '.hx-theme-btn:hover{border-color:var(--accent,#fff);transform:translateY(-2px)}',
      '.hx-theme-btn svg{width:15px;height:15px;flex:none}',
      '.hx-theme-panel{position:absolute;right:0;bottom:52px;min-width:178px;padding:7px;',
      'border-radius:14px;border:1px solid var(--line-strong,rgba(255,255,255,.16));',
      'background:var(--surface,#0a0a0c);box-shadow:0 18px 50px rgba(0,0,0,.55);',
      'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
      'opacity:0;transform:translateY(8px) scale(.97);pointer-events:none;',
      'transition:.18s cubic-bezier(.2,.8,.2,1);visibility:hidden}',
      '.hx-theme-panel.open{opacity:1;transform:none;pointer-events:auto;visibility:visible}',
      '.hx-theme-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;',
      'border:0;background:none;color:var(--muted,#8b8b93);border-radius:9px;',
      'font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer;text-align:left;transition:.15s}',
      '.hx-theme-item:hover{background:var(--accent-soft,rgba(255,255,255,.07));color:var(--text,#f7f7f8)}',
      '.hx-theme-item.on{color:var(--text,#f7f7f8)}',
      '.hx-theme-dot{width:13px;height:13px;border-radius:50%;flex:none;',
      'box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}',
      '.hx-theme-item.on .hx-theme-dot{box-shadow:inset 0 0 0 1px rgba(0,0,0,.35),0 0 0 2px var(--surface,#0a0a0c),0 0 0 3.5px var(--accent,#fff)}',
      '.hx-theme-check{margin-left:auto;width:13px;height:13px;opacity:0;color:var(--accent,#fff)}',
      '.hx-theme-item.on .hx-theme-check{opacity:1}',
      '@media (max-width:600px){.hx-theme-btn span{display:none}.hx-theme-btn{padding:0;width:42px;justify-content:center}}'
    ].join('');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function build() {
    injectStyles();

    var root = document.createElement('div');
    root.className = 'hx-theme';

    root.innerHTML =
      '<div class="hx-theme-panel" role="radiogroup" aria-label="Colour theme"></div>' +
      '<button class="hx-theme-btn" type="button" aria-haspopup="true" aria-expanded="false">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>' +
        '<circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>' +
        '<circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>' +
        '<span>Theme</span>' +
      '</button>';

    document.body.appendChild(root);

    toggle = root.querySelector('.hx-theme-btn');
    panel = root.querySelector('.hx-theme-panel');

    THEMES.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'hx-theme-item';
      item.setAttribute('role', 'radio');
      item.setAttribute('data-theme-id', t.id);
      item.innerHTML =
        '<span class="hx-theme-dot" style="background:' + t.dot + '"></span>' +
        t.label +
        '<svg class="hx-theme-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
        'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      item.addEventListener('click', function () {
        set(t.id);
        close();
      });
      panel.appendChild(item);
    });

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('open')) close(); else open();
    });

    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('open')) return;
      if (e.target.closest && e.target.closest('.hx-theme')) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    paint();

    /* Re-resolve through current(): whatever the pre-paint snippet applied is
       validated against the live theme list, an id that no longer exists is
       dropped from localStorage, and the result (default included) is written
       back so <meta name="theme-color"> always matches what is on screen. */
    set(current());
  }

  /* Another tab switched the theme: follow it live. Re-validated here too, so
     a hand-edited value written by another tab cannot slip through. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    if (e.newValue !== null && !available(e.newValue)) return;
    set(current(), false);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
