/* wjp-pending-promote.js v1 — Show pending transactions everywhere + auto-promote when completed.
 *
 * Winston's directive 2026-05-18: "just put a pending tag on each transaction
 * and mark as complete when you get the confirmation."
 *
 * Plaid sends two rows for every transaction: first a "pending" row when the
 * authorization clears, then a "completed" row 1-3 days later when the bank
 * actually posts it. They have DIFFERENT transaction_ids but represent the
 * same real-world payment.
 *
 * Current behavior:
 *   - Calendar grid hides ALL pending rows (so recent days look empty)
 *   - Transactions list shows pending with a "Pending" badge — good
 *   - But duplicates exist in appState (pending + completed for same payment)
 *
 * What this module does:
 *   1. After each transaction hydration, find (pending, completed) pairs by:
 *        - merchant-key match (dedupMerchantKey-style normalization)
 *        - amount match to 2 decimals
 *        - within ±10 days
 *   2. Mark the pending row with `_supersededBy: completedId` and `_promoted: true`
 *   3. Removes superseded pendings from appState.transactions
 *   4. Re-renders Calendar + Transactions list
 *
 * Result:
 *   - Pending shows everywhere with its pending badge
 *   - When completed twin posts, pending is replaced (no duplicates)
 *   - Calendar grid now shows pending AND completed (no double-counting)
 *
 * Idempotent — running this twice produces the same result.
 * Path-guarded. IIFE.
 */
(function () {
  'use strict';
  if (window._wjpPendingPromoteInstalled) return;
  window._wjpPendingPromoteInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function normalizeMerchant(m) {
    if (!m) return '';
    var s = String(m).toLowerCase().trim();
    // Strip common pending-specific tokens
    s = s.replace(/\bconf#\s*\w+/gi, '');
    s = s.replace(/\bauth\w*\b/gi, '');
    s = s.replace(/\bpending\b/gi, '');
    s = s.replace(/\d{1,2}:\d{2}[ap]?m?/gi, '');
    s = s.replace(/\bmay\d{1,2}\b/gi, '');
    s = s.replace(/[^a-z0-9 ]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    // Take first 4 words — Zelle/ACH strings get verbose, but the merchant
    // identity is usually in the first few tokens.
    var words = s.split(' ').filter(Boolean).slice(0, 4);
    return words.join(' ');
  }

  function amountKey(t) {
    var amt = Number(t.amount) || 0;
    return amt.toFixed(2);
  }

  function dayMs(t) {
    var d = t.date || t.timestamp;
    if (!d) return 0;
    var ms = (typeof d === 'string') ? new Date(d + 'T12:00:00').getTime() : new Date(d).getTime();
    return isFinite(ms) ? ms : 0;
  }

  function isPending(t) {
    return String(t.status || '').toLowerCase() === 'pending';
  }
  function isCompleted(t) {
    return String(t.status || '').toLowerCase() === 'completed';
  }

  function promoteAndDedupe() {
    if (!window.appState || !Array.isArray(window.appState.transactions)) return { matched: 0, removed: 0 };
    var txs = window.appState.transactions;

    // Build completed index by (merchantKey|amountKey)
    var completedByKey = {};
    txs.forEach(function (t) {
      if (!isCompleted(t)) return;
      var key = normalizeMerchant(t.merchant) + '|' + amountKey(t);
      if (!completedByKey[key]) completedByKey[key] = [];
      completedByKey[key].push(t);
    });

    var toRemove = [];
    var matched = 0;
    txs.forEach(function (t) {
      if (!isPending(t)) return;
      if (t._supersededBy) return; // already promoted
      var key = normalizeMerchant(t.merchant) + '|' + amountKey(t);
      var twins = completedByKey[key];
      if (!twins) return;
      var myMs = dayMs(t);
      var TEN_DAYS = 10 * 24 * 3600 * 1000;
      var match = twins.find(function (c) {
        if (c.id === t.id) return false;
        var cms = dayMs(c);
        return Math.abs(cms - myMs) <= TEN_DAYS;
      });
      if (match) {
        t._supersededBy = match.id;
        t._promoted = true;
        toRemove.push(t.id);
        matched++;
      }
    });

    // Remove superseded pendings
    if (toRemove.length) {
      var rmSet = {};
      toRemove.forEach(function (id) { rmSet[id] = true; });
      window.appState.transactions = txs.filter(function (t) { return !rmSet[t.id]; });
      // Persist + propagate
      try {
        if (typeof window.saveState === 'function') window.saveState();
      } catch (_) {}
    }

    return { matched: matched, removed: toRemove.length, totalAfter: window.appState.transactions.length };
  }

  function rerender() {
    try {
      if (typeof window.renderTransactions === 'function') window.renderTransactions();
      if (typeof window.renderCalendar === 'function') window.renderCalendar();
      if (typeof window.txnRenderAll === 'function') window.txnRenderAll();
      window.dispatchEvent(new CustomEvent('wjp-pending-promoted'));
    } catch (_) {}
  }

  function run() {
    var r = promoteAndDedupe();
    try { console.log('[wjp-pending-promote]', r); } catch (_) {}
    if (r.removed > 0) rerender();
  }

  function boot() {
    // Initial run after tx-bootstrap settles
    setTimeout(run, 6000);
    // Re-run after every tx hydration
    window.addEventListener('wjp-transactions-rehydrated', function () { setTimeout(run, 300); });
    // Periodic safety net
    setInterval(run, 60 * 60 * 1000); // hourly
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PendingPromote = {
    run: run,
    promoteAndDedupe: promoteAndDedupe,
    normalizeMerchant: normalizeMerchant,
    version: 1
  };
})();
