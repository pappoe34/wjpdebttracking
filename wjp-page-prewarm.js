/* wjp-page-prewarm.js v2 — Pre-build Calendar and Credit Health pages in
 * the background after dashboard loads, so they open instantly.
 *
 * Winston 2026-05-29: "calendar and credit score tab only load up when i
 *   first initially click them taking 5 to 10 seconds to load."
 *
 * Technique:
 *   1. Wait 4 seconds after DOMContentLoaded.
 *   2. Pause the page-router-fix (window._wjpRouterFixPaused = true).
 *   3. For each target page (recurring, credit-wjp):
 *      a. If the page element doesn't exist yet, create an empty .page div.
 *      b. Mark it `.active` and position it OFFSCREEN+invisible:
 *         position:absolute; left:-99999px; visibility:hidden; display:block.
 *         Most lazy renderers check for .active or for offsetWidth before
 *         building DOM — this satisfies both without showing it to the user.
 *      c. Call the known renderers (renderMainCalendar / WJP_CreditOverhaul
 *         / WJP_CreditHero / WJP_CreditHistoryChart / WJP_CreditSimulator).
 *      d. After a short delay, revert the page to hidden non-active state.
 *   4. Un-pause the router-fix.
 *
 * Result: when the user clicks Calendar or Credit Health for the first
 * time, the heavy DOM is already built — open is instant.
 */
(function () {
  'use strict';
  if (window._wjpPagePrewarmInstalled) return;
  window._wjpPagePrewarmInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var WARM_DELAY_MS = 4000;
  var RENDER_HOLD_MS = 1500; // how long to keep the page hidden-active

  function ensurePageEl(id, dataPage) {
    var pg = document.getElementById(id);
    if (pg) return pg;
    var ca = document.querySelector('.content-area, main, .main-area') || document.body;
    pg = document.createElement('div');
    pg.id = id;
    pg.className = 'page';
    if (dataPage) pg.setAttribute('data-page', dataPage);
    ca.appendChild(pg);
    return pg;
  }

  function hiddenActiveStyle() {
    return 'position:absolute;left:-99999px;top:0;width:100%;display:block;visibility:hidden;';
  }

  function warmCalendar() {
    try {
      var pg = document.getElementById('page-recurring');
      if (!pg) return; // calendar page exists in index.html — skip if not
      var savedClass = pg.className;
      var savedStyle = pg.getAttribute('style') || '';
      pg.className = 'page active';
      pg.style.cssText = hiddenActiveStyle();
      try {
        if (typeof window.renderMainCalendar === 'function') window.renderMainCalendar();
      } catch (_) {}
      setTimeout(function () {
        pg.className = savedClass.replace(/\bactive\b/g, '').trim() || 'page';
        pg.setAttribute('style', savedStyle);
      }, RENDER_HOLD_MS);
      try { console.log('[wjp-page-prewarm] warmed Calendar (#page-recurring)'); } catch (_) {}
    } catch (_) {}
  }

  function warmCredit() {
    try {
      var pg = ensurePageEl('page-credit-wjp', 'credit-wjp');
      var savedClass = pg.className;
      var savedStyle = pg.getAttribute('style') || '';
      pg.className = 'page active';
      pg.style.cssText = hiddenActiveStyle();
      try {
        if (window.WJP_CreditOverhaul && typeof window.WJP_CreditOverhaul.render === 'function') {
          window.WJP_CreditOverhaul.render();
        }
      } catch (_) {}
      ['WJP_CreditHero', 'WJP_CreditHistoryChart', 'WJP_CreditSimulator'].forEach(function (name) {
        try {
          var api = window[name];
          if (!api) return;
          ['render', 'mount', 'init', 'draw'].forEach(function (k) {
            if (typeof api[k] === 'function') {
              try { api[k](); } catch (_) {}
            }
          });
        } catch (_) {}
      });
      try {
        if (window.WJP_CreditProfileStable && typeof window.WJP_CreditProfileStable.repatch === 'function') {
          window.WJP_CreditProfileStable.repatch();
        }
      } catch (_) {}
      setTimeout(function () {
        pg.className = savedClass.replace(/\bactive\b/g, '').trim() || 'page';
        pg.setAttribute('style', savedStyle);
      }, RENDER_HOLD_MS);
      try { console.log('[wjp-page-prewarm] warmed Credit Health (#page-credit-wjp)'); } catch (_) {}
    } catch (_) {}
  }

  function warmActivity() {
    try {
      var pg = document.getElementById('page-activity');
      if (!pg) return;
      var savedClass = pg.className;
      var savedStyle = pg.getAttribute('style') || '';
      pg.className = 'page active';
      pg.style.cssText = hiddenActiveStyle();
      try {
        if (typeof window.renderActivityPage === 'function') window.renderActivityPage();
      } catch (_) {}
      try {
        if (window.WJP_Education && typeof window.WJP_Education.refresh === 'function') {
          window.WJP_Education.refresh();
        }
      } catch (_) {}
      setTimeout(function () {
        pg.className = savedClass.replace(/\bactive\b/g, '').trim() || 'page';
        pg.setAttribute('style', savedStyle);
      }, RENDER_HOLD_MS);
      try { console.log('[wjp-page-prewarm] warmed Financial Education (#page-activity)'); } catch (_) {}
    } catch (_) {}
  }

  function prewarm() {
    // Pause router-fix during the warming window
    window._wjpRouterFixPaused = true;
    warmCalendar();
    setTimeout(warmActivity, 100);
    // small stagger
    setTimeout(warmCredit, 200);
    // Un-pause after the longest hold + safety margin
    setTimeout(function () {
      window._wjpRouterFixPaused = false;
      // Re-enforce in case the dashboard slot needs to be re-asserted
      try { if (window.WJP_PageRouterFix && window.WJP_PageRouterFix.enforce) window.WJP_PageRouterFix.enforce('post-prewarm'); } catch (_) {}
    }, RENDER_HOLD_MS + 800);
  }

  function boot() { setTimeout(prewarm, WARM_DELAY_MS); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PagePrewarm = { version: 3, prewarm: prewarm };
})();
