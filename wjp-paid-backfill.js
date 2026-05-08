/* wjp-paid-backfill.js — Self-heal for debt.paid field.
 *
 * BUG: app.js never increments debt.paid anywhere. Result: every per-debt
 * card on Strategy tab shows "$0 paid / 0%" even after the user has logged
 * payments. The summary progress bar reads from a different aggregate
 * (transaction sum) so it displays a number, but the underlying balance
 * drops aren't surfaced to per-debt views.
 *
 * FIX: Compute debt.paid from (originalBalance - currentBalance) defensively
 * on each tick. Originals come from debt.originalBalance (already maintained
 * in app.js renderer) or fall back to startingBalance / initialBalance /
 * startBalance. Never DECREASE paid — we take max(existing, computed).
 *
 * Also patches the renderer's source-of-truth: writes back debt.paid into
 * appState so renderers that read debt.paid pick it up.
 *
 * Hardened pattern: IIFE, idempotent, path-guarded to /index.html, no
 * MutationObservers, try/catch wrapped, polled every 2s to catch new
 * payments mid-session.
 */
(function () {
  'use strict';
  if (window._wjpPaidBackfillInstalled) return;
  window._wjpPaidBackfillInstalled = true;

  // Path guard
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function originalBalanceOf(d) {
    var candidates = [d.originalBalance, d.startingBalance, d.initialBalance, d.startBalance, d.openingBalance];
    for (var i = 0; i < candidates.length; i++) {
      var v = Number(candidates[i]);
      if (isFinite(v) && v > 0) return v;
    }
    // Fallback: current balance (zero paid)
    return Number(d.balance) || 0;
  }

  function backfillOnce() {
    try {
      if (!window.appState || !window.appState.debts) return 0;
      var changed = 0;
      var debts = window.appState.debts;
      for (var i = 0; i < debts.length; i++) {
        var d = debts[i];
        if (!d) continue;
        var orig = originalBalanceOf(d);
        var cur = Number(d.balance) || 0;
        // If current > original, balance has grown (new charges). originalBalance
        // should reset to current — matches the renderer's behavior in app.js
        // line 4620. Don't compute negative paid in that case.
        if (cur > orig) {
          d.originalBalance = cur;
          // Don't touch d.paid (some prior progress may exist)
          continue;
        }
        var computed = Math.max(0, orig - cur);
        var existing = Number(d.paid) || 0;
        // Take the larger so we never lose recorded progress
        var nextPaid = Math.max(existing, computed);
        if (Math.abs(nextPaid - existing) > 0.01) {
          d.paid = nextPaid;
          changed++;
        }
        // Also ensure originalBalance is persisted on the debt for future renders
        if (d.originalBalance == null || d.originalBalance < orig) {
          d.originalBalance = orig;
        }
      }
      if (changed > 0) {
        try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
        try { if (typeof window.updateUI === 'function') window.updateUI(); } catch (_) {}
        try { console.log('[wjp-paid-backfill] healed ' + changed + ' debt.paid fields'); } catch (_) {}
      }
      return changed;
    } catch (e) {
      try { console.warn('[wjp-paid-backfill] threw', e); } catch (_) {}
      return 0;
    }
  }

  function boot() {
    // Initial backfill once appState exists
    var attempts = 0;
    function tryBackfill() {
      attempts++;
      if (window.appState && window.appState.debts) {
        backfillOnce();
        // Periodic re-run to catch new payments during session
        setInterval(backfillOnce, 2000);
        return;
      }
      if (attempts < 30) setTimeout(tryBackfill, 500);
    }
    tryBackfill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  window.WJP_PaidBackfill = { runOnce: backfillOnce };
})();
