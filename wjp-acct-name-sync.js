/* wjp-acct-name-sync.js v1 — Propagate user account renames app-wide.
 *
 * Scope (universal — works for ANY user):
 *   The "Debit balances" card on Debts → Overview already lets the user
 *   rename an account (saved as account_overrides in localStorage, scoped
 *   by uid). But that rename didn't surface anywhere else — the
 *   Transactions tab still showed the raw Plaid institutionName because
 *   WJP_AcctLookup was built from raw Plaid data without applying overrides.
 *
 *   This module:
 *     1. On `wjp-acct-lookup-ready` (fired by wjp-source-badge-enhance after
 *        AcctLookup loads), reads overrides from
 *        localStorage `wjp.account_overrides.uid_<uid>` and applies them to
 *        each `WJP_AcctLookup[accountId].institutionName`.
 *     2. Also listens for `wjp-acct-renamed` (dispatched by saveOverride
 *        from wjp-debts-overview-enhance.js v2 — patched separately) so
 *        live renames are reflected immediately.
 *     3. After applying, re-renders the Transactions tab + dispatches a
 *        generic refresh event so other modules can pick up the change.
 *
 * Universal — defaults to no overrides for a brand-new user. Doesn't touch
 * Plaid sync, doesn't alter underlying account data, only the displayed
 * name in WJP_AcctLookup. Idempotent install.
 */
(function () {
  'use strict';
  if (window._wjpAcctNameSyncInstalled) return;
  window._wjpAcctNameSyncInstalled = true;

  function getUid() {
    try { if (window.__wjpUser && window.__wjpUser.uid) return window.__wjpUser.uid; } catch (_) {}
    return null;
  }

  function readOverrides() {
    var uid = getUid();
    if (!uid) return {};
    try {
      var raw = localStorage.getItem('wjp.account_overrides.uid_' + uid);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_) { return {}; }
  }

  // Apply overrides → WJP_AcctLookup. Returns count applied.
  function applyOverrides() {
    var lookup = window.WJP_AcctLookup;
    if (!lookup) return 0;
    var overrides = readOverrides();
    var ids = Object.keys(overrides);
    if (!ids.length) return 0;
    var applied = 0;
    ids.forEach(function (accountId) {
      var ov = overrides[accountId];
      if (!ov || !ov.displayName) return;
      var entry = lookup[accountId];
      if (!entry) return;
      // Cache the original once so we can revert/show later if needed
      if (!entry._originalInstitutionName) entry._originalInstitutionName = entry.institutionName;
      entry.institutionName = String(ov.displayName).slice(0, 60);
      entry.userRenamed = true;
      applied++;
    });
    return applied;
  }

  function triggerRefresh() {
    try {
      if (window.WJP_CustomTxnRender) window.WJP_CustomTxnRender();
      if (window.WJP_TxTabEnhance && window.WJP_TxTabEnhance.render) window.WJP_TxTabEnhance.render();
      if (typeof window.renderTransactions === 'function') window.renderTransactions();
      if (typeof window.txnRenderAll === 'function') window.txnRenderAll();
      window.dispatchEvent(new CustomEvent('wjp-tx-rerendered', { detail: { reason: 'acct-name-sync' } }));
    } catch (_) {}
  }

  function syncAndRefresh(reason) {
    var n = applyOverrides();
    if (n > 0) {
      try { console.log('[wjp-acct-name-sync] applied', n, 'override(s) (' + (reason || 'unknown') + ')'); } catch (_) {}
      triggerRefresh();
    }
  }

  // Boot path 1: AcctLookup already ready → sync immediately.
  if (window.WJP_AcctLookup) {
    setTimeout(function () { syncAndRefresh('boot-lookup-ready'); }, 200);
  }

  // Boot path 2: wait for the event.
  window.addEventListener('wjp-acct-lookup-ready', function () {
    setTimeout(function () { syncAndRefresh('lookup-ready-event'); }, 100);
  });

  // Live rename: saveOverride dispatches this after writing localStorage.
  window.addEventListener('wjp-acct-renamed', function (e) {
    var d = (e && e.detail) || {};
    // Apply just this one rename for speed
    var lookup = window.WJP_AcctLookup;
    if (lookup && d.accountId && lookup[d.accountId]) {
      if (!lookup[d.accountId]._originalInstitutionName) {
        lookup[d.accountId]._originalInstitutionName = lookup[d.accountId].institutionName;
      }
      if (d.displayName) {
        lookup[d.accountId].institutionName = String(d.displayName).slice(0, 60);
        lookup[d.accountId].userRenamed = true;
      } else {
        // displayName empty → revert to original
        lookup[d.accountId].institutionName = lookup[d.accountId]._originalInstitutionName || lookup[d.accountId].institutionName;
        lookup[d.accountId].userRenamed = false;
      }
    }
    triggerRefresh();
  });

  // Defensive: retry every 5s for a minute in case AcctLookup loads late.
  var attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    if (window.WJP_AcctLookup) {
      syncAndRefresh('retry-poll');
      clearInterval(iv);
    }
    if (attempts > 12) clearInterval(iv);
  }, 5000);

  // Public API
  window.WJP_AcctNameSync = {
    version: 1,
    apply: applyOverrides,
    readOverrides: readOverrides,
    refresh: triggerRefresh
  };
})();
