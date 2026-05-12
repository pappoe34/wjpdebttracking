/* wjp-strategy-enhance.js v2 — DISABLED.
 *
 * v1 mounted a "Strategy Engine · Compare every path" card on the dashboard
 * that duplicated the existing "Top 3 to attack" section. Winston confirmed
 * the duplicate isn't needed, so this module no-ops and also removes any
 * v1 element if it's still cached/mounted from a previous session.
 */
(function () {
  'use strict';
  if (window._wjpStratEnhInstalled) return;
  window._wjpStratEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function removeOldWidget() {
    try {
      var el = document.getElementById('wjp-strategy-enhance-wrap');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (_) {}
  }

  // Keep removing for a few cycles in case a stale v1 build is cached
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(removeOldWidget, 600); });
  } else {
    setTimeout(removeOldWidget, 600);
  }
  setInterval(removeOldWidget, 3000);

  window.WJP_StrategyEnhance = { disabled: true };
})();
