/* wjp-innerhtml-batch.js v2 — DISABLED 2026-05-19
 * v1 deferred innerHTML writes to next requestAnimationFrame to coalesce
 * multiple += calls. Side effect: brief empty/half-loaded states because
 * the OLD content was visible for one frame before the NEW content committed.
 * Disabled. Module is a no-op now.
 */
(function () {
  "use strict";
  if (window._wjpInnerHTMLBatchInstalled) return;
  window._wjpInnerHTMLBatchInstalled = true;
  // No-op. Module retained so index.html script tag doesn't 404 on cached refs.
  window.WJP_InnerHTMLBatch = { version: 2, disabled: true };
})();
