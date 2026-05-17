/* wjp-tx-resync-failsafe.js v1 — Belt-and-suspenders transaction freshness.
 *
 * Pairs with the app.js bugfix (webhook sync now bypasses throttle, default
 * cadence bumped to daily). This module adds a second safety net:
 *
 *   Every time the user lands on the Transactions tab OR Calendar tab,
 *   we check the latest tx date in Firestore (via wjp-firestore-tx-bootstrap
 *   cache) and the lastBankSync timestamp. If either is stale (>24h), we
 *   silently force a sync.
 *
 * This is intentionally cheap and idempotent — sync-transactions uses a
 * cursor on the server side so calling it when there's nothing new just
 * returns an empty added[] in milliseconds.
 *
 * Safe: IIFE, idempotent, path-guarded, no UI side effects (silent).
 */
(function () {
  'use strict';
  if (window._wjpTxResyncFailsafeInstalled) return;
  window._wjpTxResyncFailsafeInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DAY_MS = 24 * 60 * 60 * 1000;
  var LS_LAST_FAILSAFE = 'wjp.tx.lastFailsafeAt';
  var FAILSAFE_COOLDOWN = 30 * 60 * 1000; // never fire failsafe more than once per 30 min

  function getLastSync() {
    try { return parseInt(localStorage.getItem('wjp_last_bank_sync') || '0', 10) || 0; } catch (_) { return 0; }
  }
  function getLastFailsafe() {
    try { return parseInt(localStorage.getItem(LS_LAST_FAILSAFE) || '0', 10) || 0; } catch (_) { return 0; }
  }
  function setLastFailsafe() {
    try { localStorage.setItem(LS_LAST_FAILSAFE, String(Date.now())); } catch (_) {}
  }
  function onRelevantTab() {
    var h = (location.hash || '').toLowerCase();
    // Tabs where stale transactions hurt UX
    return /transactions|calendar|recurring|debts/.test(h);
  }
  function syncIsAvailable() {
    return typeof window.syncBankTransactions === 'function';
  }
  function isStale() {
    var last = getLastSync();
    if (!last) return true; // never synced — definitely stale
    return (Date.now() - last) > DAY_MS;
  }

  async function fireFailsafe(reason) {
    if (!syncIsAvailable()) return;
    var lastFs = getLastFailsafe();
    if (Date.now() - lastFs < FAILSAFE_COOLDOWN) return;
    if (!isStale()) return;
    try {
      setLastFailsafe();
      try { console.log('[wjp-tx-failsafe] firing silent force sync, reason=' + reason); } catch (_) {}
      var res = await window.syncBankTransactions({ silent: true, force: true });
      try { console.log('[wjp-tx-failsafe] result', res); } catch (_) {}
      // After sync, ask firestore-tx-bootstrap to re-pull so the UI sees new txs
      if (window.WJP_TxBootstrap && typeof window.WJP_TxBootstrap.refresh === 'function') {
        await window.WJP_TxBootstrap.refresh();
      }
    } catch (_) {}
  }

  function onHashChange() {
    if (onRelevantTab()) {
      // 600ms delay so the tab render lands first
      setTimeout(function () { fireFailsafe('hash:' + location.hash); }, 600);
    }
  }

  function boot() {
    // Fire once on initial load if we're already on a relevant tab.
    setTimeout(function () { if (onRelevantTab()) fireFailsafe('boot'); }, 2000);
    window.addEventListener('hashchange', onHashChange);
    // Also fire on tab refocus if stale
    window.addEventListener('focus', function () { fireFailsafe('refocus'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxResyncFailsafe = {
    fire: function () { return fireFailsafe('manual'); },
    isStale: isStale,
    version: 1
  };
})();
