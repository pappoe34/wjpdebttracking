/* wjp-innerhtml-batch.js v1 — 2026-05-19
 *
 * Batches innerHTML writes per-element via requestAnimationFrame so the
 * browser only paints the FINAL value, not every intermediate state.
 *
 * Why: app.js render functions like renderStrategyIndicators / renderTop3
 * build content with `listEl.innerHTML = ''` then multiple `listEl.innerHTML
 * += '...'` operations. Each += triggers a full re-parse + repaint, causing
 * visible flicker. Throttling the function reduces frequency but each call
 * still flickers.
 *
 * Fix: intercept innerHTML get/set on TARGET ELEMENTS. The getter returns
 * a pending buffer (so += accumulates correctly in-memory). The setter
 * stores to the buffer and schedules a single rAF commit. Result: many
 * setter calls in a single tick = one DOM mutation, one paint.
 *
 * Targeted to known-flickery elements only, to avoid breaking unrelated DOM.
 */
(function () {
  "use strict";
  if (window._wjpInnerHTMLBatchInstalled) return;
  window._wjpInnerHTMLBatchInstalled = true;

  // List of element IDs whose innerHTML setter should be batched.
  // These are the elements painted by render functions that += in loops.
  var BATCH_IDS = [
    'snowball-list',
    'hybrid-list',
    'avalanche-list',
    'top3-grid',
    'dfd-meta',
    'dfd-date',
    'dfd-eyebrow',
    'dash-greeting'
  ];

  var nativeDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!nativeDesc || !nativeDesc.get || !nativeDesc.set) {
    // Bail — runtime doesn't expose innerHTML descriptor (very old browser)
    return;
  }

  function patch(el) {
    if (!el || el._wjpBatchPatched) return;
    el._wjpBatchPatched = true;
    el._wjpPending = null;
    el._wjpHasPending = false;
    el._wjpScheduled = false;
    try {
      Object.defineProperty(el, 'innerHTML', {
        configurable: true,
        get: function () {
          if (this._wjpHasPending) return this._wjpPending;
          return nativeDesc.get.call(this);
        },
        set: function (value) {
          var self = this;
          // If the new value equals the current REAL DOM value AND no pending
          // change is queued, this is a no-op write — skip entirely.
          if (!self._wjpHasPending) {
            var current = nativeDesc.get.call(self);
            if (current === value) return;
          }
          self._wjpPending = value;
          self._wjpHasPending = true;
          if (!self._wjpScheduled) {
            self._wjpScheduled = true;
            (window.requestAnimationFrame || window.setTimeout)(function () {
              self._wjpScheduled = false;
              if (self._wjpHasPending) {
                var v = self._wjpPending;
                self._wjpHasPending = false;
                self._wjpPending = null;
                // Only commit if value actually differs from current DOM
                if (nativeDesc.get.call(self) !== v) {
                  nativeDesc.set.call(self, v);
                }
              }
            }, 0);
          }
        }
      });
    } catch (e) {
      try { console.warn('[wjp-innerHTML-batch] failed to patch', el && el.id, e); } catch (_) {}
    }
  }

  function tryPatchAll() {
    var patched = 0;
    BATCH_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el._wjpBatchPatched) {
        patch(el);
        patched++;
      }
    });
    return patched;
  }

  function boot() {
    // Initial pass
    tryPatchAll();
    // Some elements mount later (cloud-pull, hashchange) — retry on a slow tick
    var attempts = 0;
    var iv = setInterval(function () {
      tryPatchAll();
      if (++attempts > 30) clearInterval(iv);
    }, 2000);
    window.addEventListener('hashchange', tryPatchAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_InnerHTMLBatch = { patch: patch, version: 1 };
})();
