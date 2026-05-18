/* wjp-page-nav-rescue.js v1 — Defensive cleanup for stuck page display styles.
 *
 * Winston flagged 2026-05-18: top nav tabs (Portfolio/Budgets/Strategy) were
 * stuck hidden because wjp-portfolio.js had set `style.cssText = "display:none
 * !important"` on all pages when Portfolio opened, and the !important made it
 * permanent — the standard SPA tab-switching couldn't override it.
 *
 * Fix #1 is in wjp-portfolio.js (drop !important + clean up on leave).
 * This module is Fix #2 — a defensive watchdog. Every 1s + on every click:
 *   - Look at .page.active. If its computed display is 'none', clear inline cssText.
 *   - Look at any .page with inline `display:none !important` and clear it
 *     if it has class="active".
 *
 * Belt and suspenders. Cheap to run.
 */
(function () {
  'use strict';
  if (window._wjpPageNavRescueInstalled) return;
  window._wjpPageNavRescueInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function rescue() {
    try {
      var pages = document.querySelectorAll('.page, [id^="page-"]');
      var fixed = 0;
      Array.prototype.forEach.call(pages, function (page) {
        var hasActive = page.classList.contains('active');
        var inline = page.getAttribute('style') || '';
        var stuck = /display\s*:\s*none\s*!\s*important/i.test(inline);
        if (hasActive && stuck) {
          page.style.cssText = '';
          fixed++;
        } else if (hasActive) {
          // Make sure active pages aren't display:none for any reason
          var cs = window.getComputedStyle(page);
          if (cs && cs.display === 'none') {
            // Try clearing cssText first
            page.style.cssText = '';
            var cs2 = window.getComputedStyle(page);
            if (cs2 && cs2.display === 'none') {
              // Force show
              page.style.display = 'block';
            }
            fixed++;
          }
        }
      });
      if (fixed) try { console.log('[wjp-page-nav-rescue] unstuck', fixed, 'pages'); } catch (_) {}
    } catch (_) {}
  }

  function boot() {
    // Run on every click (after handler completes)
    document.addEventListener('click', function () { setTimeout(rescue, 50); });
    // Periodic safety net
    setInterval(rescue, 1500);
    // Initial run shortly after boot
    setTimeout(rescue, 500);
    setTimeout(rescue, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PageNavRescue = {
    rescue: rescue,
    version: 1
  };
})();
