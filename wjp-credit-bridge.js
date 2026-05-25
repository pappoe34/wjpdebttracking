/* wjp-credit-bridge.js v1 — Activation bridge for the premium Credit Health hero.
 *
 * Why this exists:
 *   The sidebar "Credit Health" click in wjp-credit-actions.js calls its own
 *   internal renderPage() but never dispatches a global activation event.
 *   The new premium modules (wjp-credit-hero-premium, -strategy-banner,
 *   -history-chart, -simulator, -info-modal) all listen for `wjp:page-change`
 *   to render themselves — without that event they stay dormant.
 *
 *   This bridge watches #page-credit-wjp for the `.active` class and fires the
 *   event whenever the credit page becomes visible, so the premium hero and
 *   all its sub-modules wake up.
 *
 * Zero edits to existing modules. Idempotent. Tiny.
 */
(function () {
  'use strict';
  if (window._wjpCreditBridgeInstalled) return;
  window._wjpCreditBridgeInstalled = true;

  var PAGE_ID = 'page-credit-wjp';
  var NAV_ID  = 'nav-credit-wjp';
  var lastActiveTs = 0;

  function fire(reason) {
    // Debounce: avoid double-dispatch within 200ms (e.g. nav click + class change)
    var now = Date.now();
    if (now - lastActiveTs < 200) return;
    lastActiveTs = now;
    try {
      window.dispatchEvent(new CustomEvent('wjp:page-change', { detail: { page: 'credit-wjp', reason: reason } }));
    } catch (_) {}
    // Also call render() directly for belt-and-suspenders — some modules only
    // wire listeners on DOMContentLoaded and may miss event if dispatched too early.
    setTimeout(function () {
      try { window.WJP_CreditHero && WJP_CreditHero.render && WJP_CreditHero.render(); } catch (_) {}
      try { window.WJP_CreditHistoryChart && WJP_CreditHistoryChart.render && WJP_CreditHistoryChart.render(); } catch (_) {}
      try { window.WJP_CreditStrategy && WJP_CreditStrategy.render && WJP_CreditStrategy.render(); } catch (_) {}
      try { window.WJP_CreditSimulator && WJP_CreditSimulator.render && WJP_CreditSimulator.render(); } catch (_) {}
      try { window.WJP_CreditInfoModal && WJP_CreditInfoModal.injectButton && WJP_CreditInfoModal.injectButton(); } catch (_) {}
    }, 80);
  }

  function watchPage() {
    var page = document.getElementById(PAGE_ID);
    if (!page) return false;

    // If already active when we install, fire immediately
    if (page.classList.contains('active') && page.offsetHeight > 0) {
      fire('initial-active');
    }

    // Observe class changes (SPA route activation)
    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (page.classList.contains('active') && page.offsetHeight > 0) {
            fire('class-active');
          }
        }
      }
    });
    obs.observe(page, { attributes: true, attributeFilter: ['class', 'style'] });
    return true;
  }

  function watchNav() {
    // Also wire the sidebar click directly — covers cases where the page
    // node doesn't exist yet when we install (we'll re-check after click).
    var nav = document.getElementById(NAV_ID);
    if (nav && !nav.__wjpBridgeWired) {
      nav.__wjpBridgeWired = true;
      nav.addEventListener('click', function () {
        setTimeout(function () { fire('nav-click'); }, 120);
      });
    }
    return !!nav;
  }

  function init() {
    var pageOk = watchPage();
    var navOk  = watchNav();
    if (pageOk && navOk) return;

    // Either #page-credit-wjp or #nav-credit-wjp doesn't exist yet — poll for
    // them. wjp-credit-actions.js may inject them after our IIFE runs.
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var p = watchPage();
      var n = watchNav();
      if ((p && n) || tries > 60) clearInterval(iv); // ~30s max
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
