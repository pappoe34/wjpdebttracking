/* wjp-render-throttle.js v2.1 — 2026-05-19
 *
 * Throttles + memoizes known-flickery render functions:
 *   - renderStrategyIndicators (3 strategy cards) — Snowball/Hybrid/Avalanche
 *   - renderTop3Strategy (Top 3 to attack focus card)
 *   - renderTransactions (Spending Tracker / Recent Transactions)
 *
 * Memoize: if the relevant slice of appState hasn't changed since the last
 * call, skip the render entirely. Eliminates flicker that was caused by the
 * dashboard re-rendering these cards every cloud-sync tick, every saveState,
 * every hashchange — even when nothing about debts/strategy/transactions
 * actually changed.
 *
 * Throttle: a hard floor so the function fires at most once per N seconds,
 * with a trailing-edge call so the latest state still renders.
 *
 * Reset-on-interaction: when the user clicks a strategy chip / debt row,
 * the memo cache invalidates so the next render runs immediately.
 */
(function () {
  "use strict";
  if (window._wjpRenderThrottleInstalled) return;
  window._wjpRenderThrottleInstalled = true;

  function hashAppState(slice) {
    try {
      var s = (typeof appState !== 'undefined' && appState) ? appState : null;
      if (!s) return '';
      if (slice === 'debts') {
        var d = (s.debts || []).map(function (x) { return [x.id, x.balance, x.apr, x.minPayment, x.name].join('|'); }).join(';');
        var strat = (s.settings && s.settings.strategy) || '';
        return d + '@' + strat;
      }
      if (slice === 'transactions') {
        var t = s.transactions || [];
        var tail = t.slice(-5).map(function (x) { return x.id || ''; }).join(',');
        return t.length + ':' + tail;
      }
      if (slice === 'all') {
        // Big-picture fingerprint — covers the slices that visually change on dashboard
        var d = (s.debts || []).map(function (x) { return [x.id, x.balance, x.apr, x.minPayment].join('|'); }).join(';');
        var tx = (s.transactions || []).length;
        var rec = (s.recurringPayments || []).length;
        var strat = (s.settings && s.settings.strategy) || '';
        var bal = JSON.stringify(s.balances || {});
        return d + '#' + tx + '#' + rec + '#' + strat + '#' + bal;
      }
    } catch (_) {}
    return '';
  }

  function wrap(fnName, slice, intervalMs) {
    intervalMs = intervalMs || 5000;
    function tryWrap() {
      var orig = window[fnName];
      if (typeof orig !== 'function') return false;
      if (orig._wjpThrottled) return true;
      var lastCall = 0;
      var lastHash = null;
      var queued = null;
      function wrapped() {
        var now = Date.now();
        var since = now - lastCall;
        var args = arguments;
        var self = this;
        var hash = hashAppState(slice);
        // Memoize — skip if inputs haven't changed AND we've rendered at least once
        if (lastHash !== null && hash === lastHash && lastCall > 0) {
          return;
        }
        if (since >= intervalMs) {
          lastCall = now;
          lastHash = hash;
          try { return orig.apply(self, args); } catch (e) { try { console.warn('[wjp-throttle]', fnName, e); } catch (_) {} }
        } else {
          if (queued) clearTimeout(queued);
          queued = setTimeout(function () {
            queued = null;
            lastCall = Date.now();
            lastHash = hashAppState(slice);
            try { orig.apply(self, args); } catch (e) {}
          }, intervalMs - since);
        }
      }
      wrapped._wjpThrottled = true;
      wrapped._wjpInvalidate = function () { lastHash = null; lastCall = 0; };
      window[fnName] = wrapped;
      return true;
    }
    if (!tryWrap()) {
      var attempts = 0;
      var iv = setInterval(function () {
        if (tryWrap() || ++attempts > 30) clearInterval(iv);
      }, 1000);
    }
  }

  wrap('renderStrategyIndicators', 'debts', 5000);
  wrap('renderTop3Strategy', 'debts', 5000);
  wrap('renderTransactions', 'transactions', 3000);
  // v2.1 — also throttle the global updateUI() that paints dfd-hero (Executive
  // Summary), dash-greeting, and other inline-rendered widgets. Short interval
  // so user clicks still feel snappy.
  wrap('updateUI', 'all', 500);

  // Reset-on-interaction — when user clicks a strategy chip, force a fresh render
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var trigger = t.closest('[data-strategy], .strat-chip, .strategy-chip, .top3-strategy-tab');
    if (!trigger) return;
    ['renderStrategyIndicators', 'renderTop3Strategy', 'renderTransactions'].forEach(function (fn) {
      var f = window[fn];
      if (f && f._wjpInvalidate) f._wjpInvalidate();
    });
  }, true);

  window.WJP_RenderThrottle = { version: 2.1 };
})();
