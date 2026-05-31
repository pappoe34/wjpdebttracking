/* wjp-page-router-fix.js v1 — Enforce "one .page visible at a time" so a
 * single misbehaving module can't bleed its content onto every screen.
 *
 * Winston 2026-05-29: "why is the planner tab showing up on multiple pages
 *   and where is original financial education page"
 *
 * Root cause: WJP_Planner (and possibly a couple of other late-injected
 * page modules) sets `#page-planner.style.display = 'block'` to make their
 * own page visible — but never clears the inline style on navigation away.
 * Inline display:block beats the CSS rule that hides non-.active pages, so
 * the Planner content stays painted on top of every other page the user
 * navigates to (Dashboard, Debts, Calendar, etc).
 *
 * "Financial Education" isn't missing — it's `#page-activity` with the
 * sidebar label renamed. The visual confusion comes from the Planner page
 * bleeding into its layout.
 *
 * Fix: a defensive router shim that on every nav event:
 *   1. Reads the active hash (e.g. #dashboard) or the .nav-item.active
 *      data-page attribute.
 *   2. Strips inline display from EVERY .page element.
 *   3. Removes .active from every page except the matching one, adds it
 *      to the matching one.
 *
 * The shim runs on: DOMContentLoaded, hashchange, nav-item click, and a
 * MutationObserver that watches inline-style changes on any .page node.
 * This catches both the initial bleed and any future re-bleed from a
 * sibling module.
 *
 * Safe: IIFE, idempotent install, no appState writes. Pure DOM normalization.
 */
(function () {
  'use strict';
  if (window._wjpPageRouterFixInstalled) return;
  window._wjpPageRouterFixInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // Map nav data-page → page id (covers the rename cases too)
  // e.g. data-page="planner" → page-planner, "activity" (Financial Education) → page-activity
  function dataPageToPageId(dp) {
    if (!dp) return null;
    return 'page-' + String(dp).toLowerCase();
  }

  // FIX 70 v3: hash is the authoritative source of truth. On every nav
  // click we sync the hash so the two stay aligned (see wireRouteEvents).
  function resolveActivePageId() {
    // 1. hash wins
    try {
      var h = (location.hash || '').replace(/^#/, '').toLowerCase().split('?')[0].split('/')[0];
      if (h && document.getElementById('page-' + h)) return 'page-' + h;
    } catch (_) {}
    // 2. fall back to nav-item.active
    var active = document.querySelector('.sidebar .nav-item.active[data-page]');
    if (active) {
      var id = dataPageToPageId(active.getAttribute('data-page'));
      if (id && document.getElementById(id)) return id;
    }
    // 3. default to dashboard
    return 'page-dashboard';
  }

  // The "guard" — make sure only the right page is visible.
  // We use a recursion guard so the MutationObserver doesn't fight itself.
  var _enforcing = false;
  function enforce(reason) {
    if (_enforcing) return;
    if (window._wjpRouterFixPaused) return;
    _enforcing = true;
    try {
      // FIX 95: defensively clear body.overflow scroll-lock left over from
      // onboarding flows / modals that didn't restore on close. Skip when
      // onboarding is actually visible — it legitimately needs the lock.
      try {
        var ob = document.getElementById('onboarding-page');
        var obVisible = ob && getComputedStyle(ob).display !== 'none';
        if (!obVisible && document.body.style.overflow === 'hidden') {
          document.body.style.overflow = '';
        }
      } catch (_) {}
      var wantId = resolveActivePageId();
      var pages = document.querySelectorAll('[id^="page-"]');
      pages.forEach(function (pg) {
        // Strip inline display set by misbehaving modules
        if (pg.style && pg.style.display) {
          pg.style.removeProperty('display');
        }
        if (pg.id === wantId) {
          if (!pg.classList.contains('active')) pg.classList.add('active');
        } else {
          if (pg.classList.contains('active')) pg.classList.remove('active');
        }
      });
      try { console.log('[wjp-page-router-fix] enforced single visible page:', wantId, '(' + (reason || 'manual') + ')'); } catch (_) {}
    } catch (_) {}
    setTimeout(function () { _enforcing = false; }, 50);
  }

  // ────────── observers ──────────
  function attachStyleObserver() {
    var pages = document.querySelectorAll('[id^="page-"]');
    pages.forEach(function (pg) {
      if (pg.dataset.wjpRouterFixObserved === '1') return;
      pg.dataset.wjpRouterFixObserved = '1';
      try {
        var mo = new MutationObserver(function (mutations) {
          if (_enforcing) return;
          // FIX 72: only react when display actually changed — other style
          // tweaks (height, opacity, transforms from animations) don't need
          // to trigger a full page-visibility re-enforcement.
          var displayChanged = mutations.some(function (m) {
            return m.attributeName === 'style' && pg.style && pg.style.display;
          });
          if (displayChanged) enforce('display-set:' + pg.id);
        });
        mo.observe(pg, { attributes: true, attributeFilter: ['style'] });
      } catch (_) {}
    });
  }

  // Re-attach observer when new pages get added (some modules inject pages late)
  function attachBodyObserver() {
    try {
      var mo = new MutationObserver(function (mutations) {
        var newPage = false;
        mutations.forEach(function (m) {
          if (m.type !== 'childList') return;
          Array.from(m.addedNodes).forEach(function (n) {
            if (n && n.nodeType === 1 && n.id && /^page-/.test(n.id)) newPage = true;
          });
        });
        if (newPage) {
          attachStyleObserver();
          enforce('new-page-added');
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  // Sync sidebar nav-item.active to match a given data-page. Some nav modules
  // forget to update this, which leaves stale highlights.
  function syncNavActive(dataPage) {
    if (!dataPage) return;
    try {
      Array.from(document.querySelectorAll('.sidebar .nav-item[data-page]')).forEach(function (n) {
        if (n.getAttribute('data-page') === dataPage) n.classList.add('active');
        else n.classList.remove('active');
      });
    } catch (_) {}
  }

  // Run enforce on nav-item clicks and hashchange
  function wireRouteEvents() {
    window.addEventListener('hashchange', function () {
      // Sync sidebar highlight to match the new hash
      try {
        var h = (location.hash || '').replace(/^#/, '').toLowerCase().split('?')[0].split('/')[0];
        if (h) syncNavActive(h);
      } catch (_) {}
      enforce('hashchange');
    });
    // Capture phase so we run BEFORE the app's own click handlers
    document.addEventListener('click', function (e) {
      var target = e.target && e.target.closest && e.target.closest('.nav-item[data-page]');
      if (!target) return;
      var dp = target.getAttribute('data-page');
      // Set hash so resolveActivePageId picks up the click — this is what
      // keeps the user from being snapped back to whatever was previously
      // marked .active.
      if (dp) {
        try { if (('#' + dp) !== location.hash) location.hash = '#' + dp; } catch (_) {}
        syncNavActive(dp);
      }
      setTimeout(function () { enforce('nav-click'); }, 50);
      setTimeout(function () { enforce('nav-click-late'); }, 250);
    }, true);
  }

  function boot() {
    // FIX 73 (Winston 2026-05-29): "what page first opens, should always
    // start from dashboard". On a fresh navigation (not reload/back/forward),
    // clear stale hash so the user always lands on the dashboard.
    var isFreshNavigation = false;
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')) || [];
      if (nav[0]) {
        // 'navigate' = typed URL / link / bookmark. 'reload' / 'back_forward' should preserve hash.
        isFreshNavigation = nav[0].type === 'navigate';
      } else if (performance.navigation && performance.navigation.type === 0) {
        isFreshNavigation = true;
      }
    } catch (_) {}
    try {
      if (isFreshNavigation) {
        var h0 = (location.hash || '').replace(/^#/, '').toLowerCase();
        if (h0 && h0 !== 'dashboard') {
          try { history.replaceState(null, '', location.pathname + location.search + '#dashboard'); }
          catch (_) { location.hash = '#dashboard'; }
        }
      }
    } catch (_) {}
    // Sync nav highlight with the URL hash on initial load.
    try {
      var h = (location.hash || '').replace(/^#/, '').toLowerCase().split('?')[0].split('/')[0];
      if (h && document.getElementById('page-' + h)) syncNavActive(h);
      else syncNavActive('dashboard');
    } catch (_) {}
    enforce('initial');
    attachStyleObserver();
    attachBodyObserver();
    wireRouteEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PageRouterFix = {
    version: 7,
    enforce: enforce,
    resolveActivePageId: resolveActivePageId
  };
})();
