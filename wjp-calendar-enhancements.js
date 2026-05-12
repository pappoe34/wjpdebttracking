/* wjp-calendar-enhancements.js v2 — DISABLED.
 *
 * v1 tried to augment the existing day panel by walking its DOM and
 * injecting per-event action buttons. The augment ran on a tight poll
 * (every 800ms) and clashed with the host calendar's own render loop —
 * payments stopped displaying on some renders.
 *
 * Per Winston's feedback, this module no-ops and removes any leftover v1
 * action bars / coach footers from cached renders. The Calendar tab is back
 * to its pre-enhancement behavior, which was working.
 *
 * Follow-up plan: re-add the features more conservatively — likely as a
 * single bottom-of-panel AI Coach strip (no per-event DOM walking) and a
 * separate "Edit due date" affordance triggered from the right-click /
 * 3-dot menu the host already exposes.
 */
(function () {
  'use strict';
  if (window._wjpCalEnhInstalled) return;
  window._wjpCalEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function teardown() {
    try {
      document.querySelectorAll('.wjp-cal-enh-coach-bar, .wjp-cal-enh-act').forEach(function (n) {
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });
      // Reset any rows that v1 flagged as augmented
      document.querySelectorAll('[data-cal-cat-edit]').forEach(function (b) {
        var row = b.closest('[style*="border-radius:8px"]');
        if (row && row._wjpActionsAdded) row._wjpActionsAdded = false;
      });
      var panel = document.getElementById('wjp-cal-day-panel');
      if (panel) panel._wjpEnhAugmented = false;
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(teardown, 600); });
  } else {
    setTimeout(teardown, 600);
  }
  setInterval(teardown, 3000);

  window.WJP_CalendarEnhancements = { disabled: true, teardown: teardown };
})();
