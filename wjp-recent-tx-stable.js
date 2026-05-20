/* wjp-recent-tx-stable.js v1 — 2026-05-19
 *
 * MICRO-SCOPED fix for the LAST flicker source. Per Winston's narrowing:
 * "only the recent transactions box on spending tracker is flickering".
 *
 * Root cause: in app.js (~line 8190), every row of the dash-spending-
 * transactions list is built with inline style 'animation: fadeIn 0.3s ease'.
 * drawCharts() rewrites the whole list via innerHTML on every call (cloud
 * pull, hashchange, every saveState, ~1.3x/sec observed). Each rewrite
 * triggers the 0.3s fadeIn on every row again — visible flicker.
 *
 * Two scoped fixes, ONE element:
 *   1. Patch #dash-spending-transactions.innerHTML setter to skip no-op
 *      writes. If the HTML being assigned equals what's already in the DOM,
 *      we don't touch it — no childList mutation, no animation replay.
 *   2. CSS override: kill the fadeIn animation on .transaction-item inside
 *      this list. Even if a rebuild does happen, no flicker.
 */
(function () {
  "use strict";
  if (window._wjpRecentTxStable) return;
  window._wjpRecentTxStable = true;

  // ============== 1. CSS override — kill fadeIn ==============
  if (!document.getElementById("wjp-recent-tx-stable-style")) {
    var s = document.createElement("style");
    s.id = "wjp-recent-tx-stable-style";
    s.textContent = [
      "#dash-spending-transactions .transaction-item {",
      "  animation: none !important;",
      "  -webkit-animation: none !important;",
      "}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  // ============== 2. Patch innerHTML setter on the specific element ==============
  var nativeDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  function patchEl(el) {
    if (!el || el._wjpInnerPatched) return;
    el._wjpInnerPatched = true;
    try {
      Object.defineProperty(el, "innerHTML", {
        configurable: true,
        get: function () { return nativeDesc.get.call(this); },
        set: function (v) {
          var current = nativeDesc.get.call(this);
          if (current === v) return; // no-op — skip the write entirely
          nativeDesc.set.call(this, v);
        }
      });
    } catch (_) {}
  }

  function tick() {
    var el = document.getElementById("dash-spending-transactions");
    if (el && !el._wjpInnerPatched) patchEl(el);
  }
  tick();
  // Patch when it mounts (it's rendered lazily by app.js)
  var iv = setInterval(function () {
    tick();
    var el = document.getElementById("dash-spending-transactions");
    if (el && el._wjpInnerPatched) clearInterval(iv);
  }, 1000);
  // Stop trying after 60s either way
  setTimeout(function () { try { clearInterval(iv); } catch (_) {} }, 60000);

  window.WJP_RecentTxStable = { version: 1 };
})();
