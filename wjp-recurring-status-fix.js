/* wjp-recurring-status-fix.js v1 — 2026-05-21
 *
 * App.js materializeRecurringTransactions() stamps every synthetic recurring
 * txn whose date is <= today as status:'completed' — but that's a false
 * positive. The payment hasn't actually been confirmed via Plaid or marked
 * paid by the user yet.
 *
 * Fix: sweep appState.transactions after every render and downgrade any
 * synthetic txn that's still marked 'completed' to 'pending'. The user can
 * promote it back to 'completed' manually (or wait for Plaid to deliver a
 * matching real txn). The table will display 'Pending' which honestly
 * reflects reality.
 *
 * Also adds a confirm action via window.WJP_ConfirmRecurring(txnId) — wire to
 * a UI button next session.
 */
(function () {
  "use strict";
  if (window._wjpRecStatusFixInstalled) return;
  window._wjpRecStatusFixInstalled = true;

  function getState() { try { return appState; } catch (_) { return (window.appState || null); } }

  // Set of synthetic txn ids that the user has explicitly confirmed (kept in
  // appState.prefs so it survives across reloads + cloud syncs).
  function confirmedSet() {
    var s = getState() || {};
    if (!s.prefs) s.prefs = {};
    if (!Array.isArray(s.prefs.recurringConfirmedIds)) s.prefs.recurringConfirmedIds = [];
    return new Set(s.prefs.recurringConfirmedIds);
  }
  function addConfirmed(id) {
    var s = getState() || {};
    if (!s.prefs) s.prefs = {};
    if (!Array.isArray(s.prefs.recurringConfirmedIds)) s.prefs.recurringConfirmedIds = [];
    if (s.prefs.recurringConfirmedIds.indexOf(id) < 0) {
      s.prefs.recurringConfirmedIds.push(id);
      try { if (typeof saveState === 'function') saveState(); } catch (_) {}
    }
  }

  function sweep() {
    try {
      var s = getState();
      if (!s || !Array.isArray(s.transactions)) return;
      var confirmed = confirmedSet();
      var changed = 0;
      s.transactions.forEach(function (t) {
        if (!t || !t.synthetic) return;
        // Already confirmed by the user → mark Completed.
        if (confirmed.has(t.id)) {
          if (t.status !== 'completed') { t.status = 'completed'; changed++; }
          return;
        }
        // Otherwise: synthetic past-due txns get demoted to Pending so the UI
        // honestly reflects "scheduled by app, not confirmed by Plaid".
        var d = new Date(t.date);
        if (d <= new Date()) {
          if (t.status !== 'pending') { t.status = 'pending'; changed++; }
        } else {
          if (t.status !== 'scheduled') { t.status = 'scheduled'; changed++; }
        }
      });
      if (changed > 0) {
        try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
      }
    } catch (e) {
      try { console.warn('[wjp-rec-status] sweep fail', e); } catch (_) {}
    }
  }

  // Expose a manual confirm API. Pass a synthetic txn id; it gets marked
  // completed and saved to prefs so future sweeps don't undo it.
  window.WJP_ConfirmRecurring = function (txnId) {
    if (!txnId) return false;
    addConfirmed(txnId);
    sweep();
    return true;
  };
  window.WJP_UnconfirmRecurring = function (txnId) {
    var s = getState();
    if (!s || !s.prefs || !Array.isArray(s.prefs.recurringConfirmedIds)) return false;
    s.prefs.recurringConfirmedIds = s.prefs.recurringConfirmedIds.filter(function (id) { return id !== txnId; });
    try { if (typeof saveState === 'function') saveState(); } catch (_) {}
    sweep();
    return true;
  };

  // Run sweep on boot + after any txnRenderAll. Wrap txnRenderAll once it's
  // exposed. Same retry pattern as other modules.
  function wrap() {
    try {
      var fn = window.txnRenderAll;
      if (typeof fn !== 'function' || fn.__wjpRecStatusWrapped) return false;
      var wrapped = function () {
        // Sweep BEFORE rendering so the new status hits the table.
        try { sweep(); } catch (_) {}
        return fn.apply(this, arguments);
      };
      wrapped.__wjpRecStatusWrapped = true;
      window.txnRenderAll = wrapped;
      return true;
    } catch (_) { return false; }
  }

  function boot() {
    setTimeout(sweep, 800);
    setTimeout(sweep, 2500);
    if (!wrap()) {
      [500, 1500, 4000, 9000].forEach(function (ms) { setTimeout(wrap, ms); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
