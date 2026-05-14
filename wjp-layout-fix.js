/* wjp-layout-fix.js v1 — make Customize Layout actually persist cross-column moves.
 *
 * Bug: the host's applyDashboardLayout() restores card order by searching for each
 * saved card as a DIRECT CHILD of its saved parent:
 *     parent.querySelector(':scope > .reorderable[data-card-id="X"]')
 * That works for in-column reordering but FAILS when the user drags a card to a
 * different column. persistDashboardLayout() correctly records the new parent, but
 * applyDashboardLayout() can't find the card there (it's still a child of its old
 * parent in the DOM) so the move is silently dropped on every reload.
 *
 * Fix: replace window.applyDashboardLayout with a version that finds each card
 * ANYWHERE inside #page-dashboard, then appends it to the correct parent in the
 * saved order — which both moves it cross-column and reorders it. Hidden-state
 * handling is preserved.
 */
(function () {
  'use strict';
  if (window._wjpLayoutFixInstalled) return;
  window._wjpLayoutFixInstalled = true;

  function fixedApplyDashboardLayout() {
    try {
      // Pull appState the same way the host does — it's not on window, but the
      // prefs we need are mirrored in localStorage under the budget-state blob.
      var raw = localStorage.getItem('wjp_budget_state');
      if (!raw) {
        for (var k in localStorage) {
          if (k.indexOf('wjp_budget_state_') === 0) { raw = localStorage.getItem(k); break; }
        }
      }
      if (!raw) return;
      var state = JSON.parse(raw);
      var prefs = (state && state.prefs) || {};
      var order = prefs.cardOrder || {};
      var hidden = prefs.cardHidden || {};

      if (typeof order !== 'object' || Array.isArray(order)) return;

      var page = document.getElementById('page-dashboard');
      if (!page) return;

      // Hide / show
      page.querySelectorAll('.reorderable').forEach(function (card) {
        var cid = card.getAttribute('data-card-id');
        card.style.display = (hidden && hidden[cid]) ? 'none' : '';
      });

      // Reorder per parent — find each card ANYWHERE in the dashboard, then append
      // it into the named parent in saved order. appendChild moves it cross-column.
      Object.keys(order).forEach(function (parentKey) {
        var parent = document.getElementById(parentKey);
        if (!parent) parent = document.querySelector('.' + parentKey);
        if (!parent) return;
        var idList = Array.isArray(order[parentKey]) ? order[parentKey] : [];
        idList.forEach(function (cid) {
          // KEY FIX: search the whole dashboard, not just :scope > parent
          var card = page.querySelector('.reorderable[data-card-id="' + cid + '"]');
          if (card) parent.appendChild(card);
        });
      });
    } catch (err) {
      try { console.warn('[wjp-layout-fix] apply failed', err); } catch (_) {}
    }
  }

  function install() {
    // Replace the host's function so every caller (initial load, reset, etc.) uses the fix
    window.applyDashboardLayout = fixedApplyDashboardLayout;
    // Run it now to correct the current render
    fixedApplyDashboardLayout();
    return true;
  }

  function tryInstall(attempt) {
    attempt = attempt || 0;
    // Wait until the dashboard cards exist
    if (document.querySelector('#page-dashboard .reorderable')) {
      install();
      // Re-apply a couple more times — overlay modules (momentum, etc.) inject
      // their cards late and can disturb order after the first pass.
      setTimeout(fixedApplyDashboardLayout, 600);
      setTimeout(fixedApplyDashboardLayout, 1800);
      return;
    }
    if (attempt < 40) setTimeout(function () { tryInstall(attempt + 1); }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { tryInstall(0); });
  } else {
    tryInstall(0);
  }
})();
