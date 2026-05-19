/* wjp-flicker-suppress.js v1 — 2026-05-19
 *
 * Last-resort flicker suppression via CSS containment.
 *
 * The actual mutations on dfd-hero / dash-strategy-card / dash-spending-card
 * can't be fully eliminated (live data IS changing), but their visible flicker
 * comes from cascade effects: parent layout reflows → children repaint →
 * charts auto-resize → more layout shifts → ...
 *
 * CSS containment isolates each card's internal rendering so:
 *   - contain: layout style paint  → internal changes don't bubble to parent
 *   - will-change: contents        → GPU compositing layer for smoother repaints
 *   - transition: none on internal text       → no fade flicker
 *   - content-visibility: visible  → preserves rendering even with contain
 *
 * Plus we add transition: none on text content inside these cards so updates
 * don't fade in/out.
 */
(function () {
  "use strict";
  if (window._wjpFlickerSuppressInstalled) return;
  window._wjpFlickerSuppressInstalled = true;

  var STYLE_ID = "wjp-flicker-suppress-style";
  if (document.getElementById(STYLE_ID)) return;

  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    // The cards Winston identified as flickering
    "#dfd-hero, #dash-strategy-card, #dash-spending-card, #top3-strategy, #snowball-list, #hybrid-list, #avalanche-list {",
    "  contain: layout style paint !important;",
    "  will-change: contents !important;",
    "}",
    // Disable transitions inside these cards so text/number swaps are instant (no fade flicker)
    "#dfd-hero *, #dash-strategy-card *, #top3-strategy *, #dash-spending-card * {",
    "  transition: none !important;",
    "  animation: none !important;",
    "}",
    // Preserve specific intentional animations (e.g., chart reveal) via override class
    "#dfd-hero .wjp-keep-anim, #dash-strategy-card .wjp-keep-anim, #top3-strategy .wjp-keep-anim, #dash-spending-card .wjp-keep-anim {",
    "  transition: revert !important;",
    "  animation: revert !important;",
    "}",
    // Stop charts from auto-resizing on every parent reflow — pin to current size
    "#dash-spending-card canvas, #dfd-hero canvas {",
    "  max-width: 100% !important;",
    "}",
    // Block the rapid scroll-reveal animations on inner content
    "#dfd-hero .reveal, #dash-strategy-card .reveal, #top3-strategy .reveal, #dash-spending-card .reveal {",
    "  opacity: 1 !important;",
    "  transform: none !important;",
    "}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);

  window.WJP_FlickerSuppress = { version: 1 };
})();
