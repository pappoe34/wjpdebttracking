/* wjp-data-normalizer.js v1 — Defensive data hygiene.
 *
 * Two production errors observed 2026-05-18:
 *   1. app.js renderTransactions → getColors(tx.category).toLowerCase() throws
 *      when category is undefined. Some hydrated Plaid txs slipped through
 *      with category=undefined (income txs, transfer txs, etc.).
 *   2. cloudPush → setDoc rejects payload because appState.subscription
 *      contains undefined values (stripeCustomerId, etc.) — Firestore
 *      doesn't accept undefined.
 *
 * Fixes both by:
 *   - Ensuring every appState.transactions[i].category is a string
 *   - Cleaning appState.subscription before each push (replace undefined → null)
 *
 * Runs on boot + every 4s + after tx-bootstrap + after pending-promote.
 *
 * Uses bare appState. Doesn't modify any other state.
 */
(function () {
  'use strict';
  if (window._wjpDataNormalizerInstalled) return;
  window._wjpDataNormalizerInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // Defensive: ensure every transaction has the fields app.js render code expects.
  function normalizeTransactions() {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return 0;
    var fixed = 0;
    s.transactions.forEach(function (t) {
      if (!t) return;
      if (typeof t.category !== 'string' || !t.category) {
        t.category = 'Other';
        fixed++;
      }
      if (typeof t.merchant !== 'string') {
        t.merchant = String(t.merchant || 'Unknown');
        fixed++;
      }
      if (typeof t.amount !== 'number' || !isFinite(t.amount)) {
        t.amount = 0;
        fixed++;
      }
      if (typeof t.method !== 'string') {
        t.method = t.method == null ? '' : String(t.method);
      }
      if (typeof t.status !== 'string') {
        t.status = 'completed';
        fixed++;
      }
    });
    return fixed;
  }

  // Clean appState.subscription so Firestore setDoc doesn't reject it.
  // Firestore doesn't accept `undefined` — replace with `null` or remove.
  function normalizeSubscription() {
    var s = getAppState();
    if (!s || !s.subscription || typeof s.subscription !== 'object') return 0;
    var fixed = 0;
    Object.keys(s.subscription).forEach(function (k) {
      if (s.subscription[k] === undefined) {
        s.subscription[k] = null;
        fixed++;
      }
    });
    return fixed;
  }

  // Recursively scrub `undefined` values throughout appState. Firestore
  // rejects ANY undefined field. Replaces with null.
  function scrubUndefinedDeep(obj, depth) {
    if (depth > 6) return 0; // safety: don't recurse forever
    if (!obj || typeof obj !== 'object') return 0;
    var fixed = 0;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        if (obj[i] === undefined) { obj[i] = null; fixed++; }
        else if (obj[i] && typeof obj[i] === 'object') fixed += scrubUndefinedDeep(obj[i], depth + 1);
      }
      return fixed;
    }
    Object.keys(obj).forEach(function (k) {
      if (obj[k] === undefined) { obj[k] = null; fixed++; }
      else if (obj[k] && typeof obj[k] === 'object') fixed += scrubUndefinedDeep(obj[k], depth + 1);
    });
    return fixed;
  }

  function scrubAppStateUndefined() {
    var s = getAppState();
    if (!s) return 0;
    return scrubUndefinedDeep(s, 0);
  }

  function normalizeAll() {
    var n1 = 0, n2 = 0, n3 = 0;
    try { n1 = normalizeTransactions(); } catch (_) {}
    try { n2 = normalizeSubscription(); } catch (_) {}
    try { n3 = scrubAppStateUndefined(); } catch (_) {}
    if (n1 || n2 || n3) {
      try { console.log('[wjp-data-normalizer] fixed', n1, 'tx fields,', n2, 'sub fields,', n3, 'undefined values'); } catch (_) {}
    }
    return { txFixed: n1, subFixed: n2, undefScrubbed: n3 };
  }

  function boot() {
    setTimeout(normalizeAll, 1500);
    setInterval(normalizeAll, 4000);
    window.addEventListener('wjp-transactions-rehydrated', normalizeAll);
    window.addEventListener('wjp-pending-promoted', normalizeAll);
    window.addEventListener('wjp-trial-state', normalizeAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DataNormalizer = {
    run: normalizeAll,
    normalizeTransactions: normalizeTransactions,
    normalizeSubscription: normalizeSubscription,
    version: 1
  };
})();
