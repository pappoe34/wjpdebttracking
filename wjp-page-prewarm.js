/* wjp-page-prewarm.js v1 — Pre-build Calendar and Credit Health pages in
 * the background after dashboard loads, so they open instantly.
 *
 * Winston 2026-05-29: "calendar and credit score tab only load up when i
 *   first initially click them taking 5 to 10 seconds to load. we have to
 *   make sure they are loaded and ready in the background on first boot up"
 *
 * What this does:
 *   - Waits 4 seconds after DOMContentLoaded so the dashboard finishes
 *     rendering and the heavy stack of credit / calendar modules has had
 *     a chance to register their globals.
 *   - Calls the known render functions silently:
 *       1. window.renderMainCalendar()      — builds #page-recurring DOM
 *       2. WJP_CreditOverhaul.render()      — builds the credit overview
 *       3. WJP_CreditHero, WJP_CreditActions, WJP_CreditHistoryChart, etc.
 *          — if exposed as renderers, invoke them too
 *   - Each call is wrapped in its own try / setTimeout chunk so a slow or
 *     buggy module can't block the others or the main thread.
 *   - Idempotent: a per-tab guard means we only pre-warm once.
 *
 * The pages are NOT made visible — they stay hidden (`display: none` from
 * the .page CSS rule). The modules render their DOM into the hidden pages
 * so when the user clicks Calendar or Credit Health for the first time,
 * the content is already there.
 *
 * Safe: IIFE, idempotent install, no appState writes, ChunkLed work so we
 * don't block the main thread.
 */
(function () {
  'use strict';
  if (window._wjpPagePrewarmInstalled) return;
  window._wjpPagePrewarmInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var WARM_DELAY_MS = 4000;
  var CHUNK_DELAY_MS = 300; // breathing room between heavy renders

  function safeCall(fn, label) {
    return function () {
      try {
        fn();
        try { console.log('[wjp-page-prewarm] warmed:', label); } catch (_) {}
      } catch (e) {
        try { console.log('[wjp-page-prewarm] warm failed for', label, e.message); } catch (_) {}
      }
    };
  }

  // Each tile is wrapped in setTimeout so it runs in its own task — no
  // single render blocks the entire chain.
  function chain(tasks) {
    var i = 0;
    function next() {
      if (i >= tasks.length) return;
      var t = tasks[i++];
      try { t(); } catch (_) {}
      setTimeout(next, CHUNK_DELAY_MS);
    }
    next();
  }

  function prewarm() {
    var tasks = [];

    // ─────── Calendar ───────
    if (typeof window.renderMainCalendar === 'function') {
      tasks.push(safeCall(function () { window.renderMainCalendar(); }, 'renderMainCalendar'));
    }
    // Some apps name it differently — try sensible fallbacks
    ['renderRecurringPage', 'renderRecurring', 'renderCalendar', 'renderMonthCalendar', 'renderCalendarPage'].forEach(function (name) {
      if (typeof window[name] === 'function') {
        tasks.push(safeCall(function () { window[name](); }, name));
      }
    });

    // ─────── Credit Health ───────
    if (window.WJP_CreditOverhaul && typeof window.WJP_CreditOverhaul.render === 'function') {
      tasks.push(safeCall(function () { window.WJP_CreditOverhaul.render(); }, 'WJP_CreditOverhaul.render'));
    }
    // Hero
    if (window.WJP_CreditHero) {
      ['render', 'mount', 'init'].forEach(function (k) {
        if (typeof window.WJP_CreditHero[k] === 'function') {
          tasks.push(safeCall(function () { window.WJP_CreditHero[k](); }, 'WJP_CreditHero.' + k));
        }
      });
    }
    // Actions
    if (window.WJP_CreditActions) {
      // show() typically navigates the user to the page — we DON'T want that.
      // Only run renderers that don't navigate.
      ['render', 'mount'].forEach(function (k) {
        if (typeof window.WJP_CreditActions[k] === 'function') {
          tasks.push(safeCall(function () { window.WJP_CreditActions[k](); }, 'WJP_CreditActions.' + k));
        }
      });
    }
    // History chart
    if (window.WJP_CreditHistoryChart) {
      ['render', 'draw', 'mount', 'init'].forEach(function (k) {
        if (typeof window.WJP_CreditHistoryChart[k] === 'function') {
          tasks.push(safeCall(function () { window.WJP_CreditHistoryChart[k](); }, 'WJP_CreditHistoryChart.' + k));
        }
      });
    }
    // Simulator (lightest — render only)
    if (window.WJP_CreditSimulator) {
      ['render', 'mount'].forEach(function (k) {
        if (typeof window.WJP_CreditSimulator[k] === 'function') {
          tasks.push(safeCall(function () { window.WJP_CreditSimulator[k](); }, 'WJP_CreditSimulator.' + k));
        }
      });
    }
    // Stable repatch
    if (window.WJP_CreditProfileStable && typeof window.WJP_CreditProfileStable.repatch === 'function') {
      tasks.push(safeCall(function () { window.WJP_CreditProfileStable.repatch(); }, 'WJP_CreditProfileStable.repatch'));
    }

    if (!tasks.length) {
      try { console.log('[wjp-page-prewarm] nothing to warm — no renderer globals found'); } catch (_) {}
      return;
    }
    try { console.log('[wjp-page-prewarm] starting warm chain —', tasks.length, 'tasks'); } catch (_) {}
    chain(tasks);
  }

  function boot() {
    setTimeout(prewarm, WARM_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PagePrewarm = { version: 1, prewarm: prewarm };
})();
