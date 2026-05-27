/* wjp-cloud-cap-warn.js v1 — Admin alert when any user crosses 4000 txns.
 *
 * Winston FIX 43: cloud sync caps the transactions payload at 5000 per user
 * (FIX 41). Defer the subcollection migration until needed. Meanwhile, fire
 * an admin alert at 4000 so we have time to migrate properly before any
 * user hits the wall.
 *
 * Posts to the existing /.netlify/functions/log-admin-alert endpoint
 * (same one wjp-data-loss-guard-v3 uses). Throttled to once per user per
 * day via localStorage so we don't spam.
 *
 * Universal — works for any user. No user-facing UI.
 */
(function () {
  'use strict';
  if (window._wjpCloudCapWarnInstalled) return;
  window._wjpCloudCapWarnInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var WARN_THRESHOLD = 4000;
  var CRITICAL_THRESHOLD = 4750; // alert again at this level for urgency
  var LS_KEY = 'wjp.cloudCapWarn.lastAlert';
  var DAY_MS = 24 * 60 * 60 * 1000;

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }

  async function postAdminAlert(level, count) {
    try {
      var auth = window.__wjpAuth || (window.firebase && window.firebase.auth && window.firebase.auth());
      if (!auth || !auth.currentUser) return;
      var token = await auth.currentUser.getIdToken();
      await fetch('/.netlify/functions/log-admin-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          type: 'cloud-cap-warn',
          before: { txnCount: 0 },
          after: { txnCount: count },
          source: 'wjp-cloud-cap-warn',
          details: {
            level: level, // 'warn' or 'critical'
            threshold: level === 'critical' ? CRITICAL_THRESHOLD : WARN_THRESHOLD,
            cap: 5000,
            message: 'User approaching cloud-sync transaction cap. Plan subcollection migration.'
          }
        })
      });
    } catch (_) {}
  }

  function check() {
    try {
      var s = getState();
      if (!s || !Array.isArray(s.transactions)) return;
      var count = s.transactions.filter(function (t) { return t && !t.synthetic; }).length;
      if (count < WARN_THRESHOLD) return;
      var level = count >= CRITICAL_THRESHOLD ? 'critical' : 'warn';
      // Throttle: don't re-alert same user same level within 24h
      var lastRaw = '';
      try { lastRaw = localStorage.getItem(LS_KEY) || ''; } catch (_) {}
      var last = lastRaw ? JSON.parse(lastRaw) : { ts: 0, level: '' };
      if (last && last.level === level && (Date.now() - last.ts) < DAY_MS) return;
      postAdminAlert(level, count);
      try { localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), level: level, count: count })); } catch (_) {}
      try { console.log('[wjp-cloud-cap-warn] alerted admin:', level, count); } catch (_) {}
    } catch (_) {}
  }

  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions)) { check(); return; }
      if (attempts < 20) setTimeout(tick, 1500);
    }
    setTimeout(tick, 5000);
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(check, 500); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(check, 500); });
    // Re-check every hour
    setInterval(check, 60 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_CloudCapWarn = { version: 1, check: check, threshold: WARN_THRESHOLD };
})();
