/* wjp-render-throttle.js v1 — 2026-05-19
 *
 * Throttles known-flickery render functions so they fire at most once every
 * ~5 seconds. The underlying app.js render is called from many code paths
 * (cloud-pull, hashchange, every saveState, etc.) and rebuilds whole cards
 * via innerHTML += loops, which makes Spending Tracker + the three Strategy
 * Indicator cards (Snowball/Hybrid/Avalanche) flicker visibly.
 *
 * Strategy: wrap the function, ignore calls within the throttle window unless
 * inputs changed. Last call queued to fire at the end of the window so the
 * UI is never stale.
 *
 * Safe pattern — wraps the function only ONCE per page load (idempotent).
 */
(function () {
  "use strict";
  if (window._wjpRenderThrottleInstalled) return;
  window._wjpRenderThrottleInstalled = true;

  function throttleFn(fnName, intervalMs) {
    intervalMs = intervalMs || 5000;
    function tryWrap() {
      var orig = window[fnName];
      if (typeof orig !== 'function') return false;
      if (orig._wjpThrottled) return true;
      var lastCall = 0;
      var queued = null;
      function wrapped() {
        var now = Date.now();
        var since = now - lastCall;
        var args = arguments;
        var self = this;
        if (since >= intervalMs) {
          // Run immediately
          lastCall = now;
          try { return orig.apply(self, args); } catch (e) { try { console.warn('[wjp-throttle]', fnName, e); } catch (_) {} }
        } else {
          // Schedule a trailing call so the latest state still renders
          if (queued) clearTimeout(queued);
          queued = setTimeout(function () {
            queued = null;
            lastCall = Date.now();
            try { orig.apply(self, args); } catch (e) { try { console.warn('[wjp-throttle]', fnName, e); } catch (_) {} }
          }, intervalMs - since);
        }
      }
      wrapped._wjpThrottled = true;
      window[fnName] = wrapped;
      return true;
    }
    // The function might not be defined yet — retry on a slow tick
    if (!tryWrap()) {
      var attempts = 0;
      var iv = setInterval(function () {
        if (tryWrap() || ++attempts > 30) clearInterval(iv);
      }, 1000);
    }
  }

  // Apply throttling to known flicker culprits
  throttleFn('renderStrategyIndicators', 5000);
  throttleFn('renderTransactions', 3000); // spending tracker pulls from this

  window.WJP_RenderThrottle = { version: 1 };
})();
