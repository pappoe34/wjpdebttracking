/* wjp-dashboard-order-sticky.js v1 — Keep the user's saved dashboard
 * layout pinned even after other modules re-render cards.
 *
 * Winston 2026-05-29: "the customize layout, auto fit, and settings features
 *   on dashboard are not working properly and they randomly reposition
 *   after the user sets and saves it."
 *
 * Root cause: app.js calls applyDashboardLayout() once on initial page load
 * (from initDashCustomize). After that, modules like wjp-dashboard-audit-fix
 * insert / replace dashboard cards on data sync, transaction sync, recurring
 * sync, and a 30-second tick — but they insert at FIXED positions (e.g.,
 * `grid.insertBefore(card, grid.firstChild)` for Executive Summary). When
 * the user has a custom saved order, those forced insertions clobber it.
 *
 * Fix:
 *   1. After every dashboard re-render event, re-run window.applyDashboardLayout
 *      with a short debounce so the saved order wins.
 *   2. Wire to the same events as the audit-fix module + DOM mutations on
 *      the dashboard grid, so any third-party insertion triggers a re-apply.
 *   3. Same fix applies to autofit / settings (Customize bar) — those also
 *      reuse applyDashboardLayout for their persistence path.
 *
 * Safe: IIFE, idempotent install, observes only the dashboard grid, uses a
 * recursion guard (in-flight flag) so MutationObserver doesn't fire itself.
 * No hardcoded user data; works for every account.
 */
(function () {
  'use strict';
  if (window._wjpDashOrderStickyInstalled) return;
  window._wjpDashOrderStickyInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DEBOUNCE_MS = 250;
  var pending = null;
  var applying = false;
  var lastAppliedAt = 0;
  var MIN_INTERVAL_MS = 200; // hard floor between applies

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }

  function hasSavedOrder() {
    try {
      var s = getState();
      var order = s && s.prefs && s.prefs.cardOrder;
      if (!order || typeof order !== 'object') return false;
      // Any non-empty array under any key?
      var keys = Object.keys(order);
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(order[keys[i]]) && order[keys[i]].length > 0) return true;
      }
      return false;
    } catch (_) { return false; }
  }

  function applyOnce(reason) {
    if (applying) return;
    var now = Date.now();
    if (now - lastAppliedAt < MIN_INTERVAL_MS) return;
    applying = true;
    try {
      if (typeof window.applyDashboardLayout === 'function' && hasSavedOrder()) {
        window.applyDashboardLayout();
        lastAppliedAt = Date.now();
        try { console.log('[wjp-dash-order-sticky] re-applied saved order:', reason); } catch (_) {}
      }
    } catch (_) {}
    setTimeout(function () { applying = false; }, 100);
  }

  function scheduleApply(reason) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      applyOnce(reason);
    }, DEBOUNCE_MS);
  }

  function wire() {
    // Re-apply after every event that triggers dashboard card re-renders
    window.addEventListener('wjp-data-restored', function () { scheduleApply('data-restored'); });
    window.addEventListener('wjp-transactions-changed', function () { scheduleApply('tx-changed'); });
    window.addEventListener('wjp-recurring-changed', function () { scheduleApply('recurring-changed'); });
    window.addEventListener('wjp-debts-changed', function () { scheduleApply('debts-changed'); });

    // MutationObserver on the dashboard grid: any insertion/removal of a
    // reorderable card triggers a re-apply. We watch for childList changes,
    // not attribute changes, so we don't fight with applyDashboardLayout
    // (which only moves cards via appendChild).
    function attachObserver() {
      var grid = document.getElementById('dash-grid')
              || document.querySelector('.dash-grid, .dashboard-grid');
      if (!grid) return false;
      try {
        var mo = new MutationObserver(function (mutations) {
          if (applying) return; // avoid recursion when WE moved cards
          // Only react if a .reorderable was added or removed at the grid level
          var relevant = false;
          mutations.forEach(function (m) {
            if (m.type !== 'childList') return;
            var nodes = [].concat(Array.from(m.addedNodes), Array.from(m.removedNodes));
            nodes.forEach(function (n) {
              if (n && n.nodeType === 1 && (n.classList && n.classList.contains('reorderable'))) {
                relevant = true;
              }
            });
          });
          if (relevant) scheduleApply('grid-mutation');
        });
        mo.observe(grid, { childList: true });
        return true;
      } catch (_) { return false; }
    }
    if (!attachObserver()) {
      // Retry until grid exists
      var attempts = 0;
      var iv = setInterval(function () {
        attempts++;
        if (attachObserver() || attempts > 30) clearInterval(iv);
      }, 500);
    }

    // Also re-apply when user navigates back to dashboard
    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').toLowerCase();
      if (h === '' || h === '#' || h === '#dashboard') scheduleApply('hash-dashboard');
    });

    // Initial apply once the saved order shows up (after appState hydrates)
    var initAttempts = 0;
    var initIv = setInterval(function () {
      initAttempts++;
      if (hasSavedOrder()) {
        applyOnce('initial-hydrate');
        clearInterval(initIv);
      }
      if (initAttempts > 40) clearInterval(initIv);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.WJP_DashOrderSticky = {
    version: 1,
    apply: function () { applyOnce('manual'); },
    scheduleApply: scheduleApply,
    hasSavedOrder: hasSavedOrder
  };
})();
