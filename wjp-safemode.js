/* WJP_SAFE_MODE_KILL_SWITCH_v3 — 2026-05-18 nuclear
 * ?safeMode=1 blocks EVERY wjp-*.js script + unregisters all service workers
 * + bypasses HTTP cache via a cb param. The only wjp script that runs is
 * this one itself.
 */
(function () {
  try {
    var qs = location.search || '';
    if (qs.indexOf('safeMode=1') === -1) return;
    window.__WJP_SAFE_MODE__ = true;
    // Block ANY wjp-*.js — except this file itself
    var SELF_RE = /wjp-safemode\.js/;
    var WJP_RE = /\/wjp-[a-z0-9-]+\.js/i;
    var blocked = 0, blockedList = [];
    function neutralize(node) {
      try {
        if (!node || node.tagName !== 'SCRIPT' || !node.src) return;
        if (SELF_RE.test(node.src)) return; // never kill ourselves
        if (!WJP_RE.test(node.src)) return;
        blockedList.push(node.src.split('/').pop());
        node.type = 'text/wjp-safemode-blocked';
        node.removeAttribute('src');
        node.parentNode && node.parentNode.removeChild(node);
        blocked++;
      } catch (e) {}
    }
    // Pass 1: anything already parsed
    try {
      var pre = document.querySelectorAll('script[src]');
      for (var i = 0; i < pre.length; i++) neutralize(pre[i]);
    } catch (e) {}
    // Pass 2: catch future inserts
    var obs = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (!m.addedNodes) return;
        for (var i = 0; i < m.addedNodes.length; i++) neutralize(m.addedNodes[i]);
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    // Nuke service workers (they may be caching broken modules)
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) {
            try { r.unregister(); console.warn('[SAFE MODE] unregistered SW', r.scope); } catch (e) {}
          });
        }).catch(function () {});
      }
    } catch (e) {}
    // Tear down + banner
    function onReady() {
      try { obs.disconnect(); } catch (e) {}
      try {
        var b = document.createElement('div');
        b.setAttribute('data-wjp-safemode-banner', '1');
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;text-align:center;padding:10px 14px;font:600 13px/1.4 -apple-system,system-ui,sans-serif;z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
        b.innerHTML = 'NUCLEAR SAFE MODE — ' + blocked + ' wjp-* modules + service workers disabled. <a href="?cb=' + Date.now() + '" style="color:#fff;text-decoration:underline;margin-left:8px;">Exit safe mode</a>';
        document.body && document.body.appendChild(b);
        document.body && (document.body.style.paddingTop = '46px');
        console.warn('[WJP SAFE MODE v3]', blocked, 'modules disabled:', blockedList);
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
