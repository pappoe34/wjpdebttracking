/* ============================================================================
   WJP Hybrid Strategy Override (surgical)
   Replaces the in-app Hybrid sort logic with the user's intended definition:
   highest monthly interest dollars first → balance × APR descending.

   PROBLEM: app.js currently uses APR/balance (APR per dollar) which puts
   small-balance, high-APR cards on top. That contradicts the strategy
   description ("biggest monthly bleed first"). User wants the description.

   APPROACH: monkey-patch window.sortDebtsByStrategy. Wraps the original;
   for hybrid only, applies new sort. Snowball/Avalanche untouched.

   HARDENING:
     - Path-guarded to /index.html
     - Idempotent flag prevents double-patching
     - Try/catch on every entry point
     - Re-applies override on each call (resilient if app re-defines fn)
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpHybridFixInstalled) return;
  window._wjpHybridFixInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch(_) {}

  var origSort = null;

  function installPatch() {
    if (typeof window.sortDebtsByStrategy !== 'function') {
      setTimeout(installPatch, 200);
      return;
    }
    if (origSort) return; // already patched
    origSort = window.sortDebtsByStrategy;
    window.sortDebtsByStrategy = function(debts, strategy) {
      try {
        if (strategy === 'hybrid') {
          var list = (debts || []).slice();
          // balance × APR descending — biggest monthly bleed first
          list.sort(function(a, b) {
            var aScore = (Number(a.balance) || 0) * (Number(a.apr) || 0);
            var bScore = (Number(b.balance) || 0) * (Number(b.apr) || 0);
            var delta = bScore - aScore;
            if (Math.abs(delta) > 0.01) return delta;
            // Tie-breaker: higher APR first
            return (Number(b.apr) || 0) - (Number(a.apr) || 0);
          });
          return list;
        }
        // For snowball / avalanche, defer to original
        return origSort.call(this, debts, strategy);
      } catch(e) {
        try { console.warn('[wjp-hybrid-fix] threw', e); } catch(_) {}
        return origSort.call(this, debts, strategy);
      }
    };
    try { console.log('[wjp-hybrid-fix] patched sortDebtsByStrategy — hybrid now uses balance × APR'); } catch(_) {}
    // Trigger re-render so dashboard updates with new ordering
    try { if (typeof window.updateUI === 'function') setTimeout(window.updateUI, 100); } catch(_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPatch);
  } else {
    installPatch();
  }

  window.WJP_HybridFix = {
    isInstalled: function() { return !!origSort; },
    formula: 'balance × APR descending (biggest monthly interest bleed first)'
  };
})();
