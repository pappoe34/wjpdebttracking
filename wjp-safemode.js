/* WJP_SAFE_MODE_KILL_SWITCH_v2 — 2026-05-18 emergency
 * Loaded as external script so CSP 'self' covers it. Runs synchronously before
 * any of the defer scripts, installs a MutationObserver, and rips out any
 * <script> tag whose src matches the BLOCK regex.
 */
(function () {
  try {
    var qs = location.search || '';
    if (qs.indexOf('safeMode=1') === -1) return;
    window.__WJP_SAFE_MODE__ = true;
    var BLOCK = /\/(wjp-firestore-tx-bootstrap|wjp-data-normalizer|wjp-page-nav-rescue|wjp-pending-promote|wjp-source-badge-enhance|wjp-txn-detail-modal|wjp-strategy-edu|wjp-recurring-compound-interest|wjp-transactions-tab-enhance|wjp-dashboard-hero|wjp-paycheck-due-date-ai|wjp-debts-elim-chart|wjp-trial-banner|wjp-trial-state)\.js/;
    var blocked = 0, blockedList = [];
    function neutralize(node) {
      try {
        if (node && node.tagName === 'SCRIPT' && node.src && BLOCK.test(node.src)) {
          blockedList.push(node.src.split('/').pop());
          node.type = 'text/wjp-safemode-blocked';
          node.removeAttribute('src');
          node.parentNode && node.parentNode.removeChild(node);
          blocked++;
        }
      } catch (e) {}
    }
    try {
      var pre = document.querySelectorAll('script[src]');
      for (var i = 0; i < pre.length; i++) neutralize(pre[i]);
    } catch (e) {}
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (!m.addedNodes) return;
        for (var i = 0; i < m.addedNodes.length; i++) neutralize(m.addedNodes[i]);
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    function onReady() {
      try { obs.disconnect(); } catch (e) {}
      try {
        var b = document.createElement('div');
        b.setAttribute('data-wjp-safemode-banner', '1');
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;text-align:center;padding:10px 14px;font:600 13px/1.4 -apple-system,system-ui,sans-serif;z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
        b.innerHTML = 'SAFE MODE — ' + blocked + ' modules disabled. <a href="?cb=' + Date.now() + '" style="color:#fff;text-decoration:underline;margin-left:8px;">Exit safe mode</a>';
        document.body && document.body.appendChild(b);
        document.body && (document.body.style.paddingTop = '46px');
        console.warn('[WJP SAFE MODE]', blocked, 'modules disabled:', blockedList);
        window.__WJP_SAFE_MODE_BLOCKED__ = blockedList;
      } catch (e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  } catch (e) {
    console.error('[WJP SAFE MODE init failed]', e);
  }
})();
