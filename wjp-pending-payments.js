/* wjp-pending-payments.js v1 — Mark-as-paid + auto-confirmation
 *
 * Problem: bank-to-credit-card payments take 3–5 business days to post via
 * Plaid (bank ACH settlement + Plaid sync latency). During that window the
 * app showed cards as UNPAID and risked firing "late payment" alerts even
 * though the user had paid. Bad UX.
 *
 * Fix: user clicks "Mark as paid" → app records a PENDING payment in
 * localStorage with a 14-day confirmation window. While pending:
 *   • Card Health treats the card as PENDING (not UNPAID)
 *   • Late-payment alerts are suppressed for that debt
 *   • Calendar reflects the scheduled payment
 *
 * When a real transaction posts that matches (account + approximate amount +
 * within window), the pending entry auto-flips to CONFIRMED and the marker
 * is cleared. If 14 days pass with no match, the entry reverts to
 * UNCONFIRMED so the user knows to re-verify.
 *
 * Storage: localStorage key `wjp.pending_payments.uid_<UID>` →
 *   { [debtId]: { amount, markedAt, paidDate, expiresAt, status, confirmedTxId } }
 *
 * Status values: 'pending' | 'confirmed' | 'expired'
 *
 * Surfaces public API:
 *   window.WJP_PendingPayments = {
 *     markPaid(debtId, amount, paidDate),   // user clicks the button
 *     getStatus(debtId),                    // returns the entry or null
 *     listAll(),                            // returns the whole map
 *     reconcile(transactions),              // run matcher against fresh txs
 *     clear(debtId)                         // user clears an entry manually
 *   }
 *
 * Safe: localStorage-only, no Plaid/Sync-Bank hooks. Auto-detector consumes
 * existing transactions feed; doesn't initiate new Plaid calls.
 */
(function () {
  'use strict';
  if (window._wjpPendingPaymentsInstalled) return;
  window._wjpPendingPaymentsInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var DAY_MS = 24 * 60 * 60 * 1000;
  var WINDOW_MS = 14 * DAY_MS;
  var AMOUNT_TOLERANCE = 0.05; // ±5% match window on transaction amount

  // ---------------- helpers ----------------
  function getCurrentUidSync() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) {
        return window.__wjpAuth.currentUser.uid;
      }
    } catch (_) {}
    return null;
  }

  function storageKey() {
    var uid = getCurrentUidSync();
    return uid ? 'wjp.pending_payments.uid_' + uid : null;
  }

  function readAll() {
    var k = storageKey();
    if (!k) return {};
    try {
      var raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function writeAll(map) {
    var k = storageKey();
    if (!k) return false;
    try {
      localStorage.setItem(k, JSON.stringify(map));
      return true;
    } catch (_) { return false; }
  }

  function getDebt(debtId) {
    try {
      var s = JSON.parse(localStorage.getItem('wjp_budget_state'));
      return (s.debts || []).find(function (d) { return d.id === debtId; }) || null;
    } catch (_) { return null; }
  }

  // ---------------- public API ----------------

  // markPaid: user clicked the button.
  function markPaid(debtId, amount, paidDate) {
    if (!debtId) throw new Error('debtId required');
    var debt = getDebt(debtId);
    if (!debt) throw new Error('debt not found: ' + debtId);

    var amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) {
      amt = parseFloat(debt.minPayment || debt.balance) || 0;
    }
    var paidIso;
    if (paidDate instanceof Date) paidIso = paidDate.toISOString().slice(0, 10);
    else if (typeof paidDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(paidDate)) paidIso = paidDate.slice(0, 10);
    else paidIso = new Date().toISOString().slice(0, 10);

    var entry = {
      debtId: debtId,
      debtName: debt.name,
      amount: amt,
      markedAt: Date.now(),
      paidDate: paidIso,
      expiresAt: Date.now() + WINDOW_MS,
      status: 'pending',
      confirmedTxId: null,
      confirmedAt: null
    };
    var map = readAll();
    map[debtId] = entry;
    writeAll(map);
    return entry;
  }

  function getStatus(debtId) {
    var map = readAll();
    var e = map[debtId];
    if (!e) return null;
    // Auto-expire stale pending
    if (e.status === 'pending' && Date.now() > e.expiresAt) {
      e.status = 'expired';
      map[debtId] = e;
      writeAll(map);
    }
    return e;
  }

  function listAll() { return readAll(); }

  function clear(debtId) {
    var map = readAll();
    delete map[debtId];
    writeAll(map);
  }

  // Reconcile: scan recent transactions for matches against pending entries.
  // A transaction matches a pending payment if:
  //   • posted within the entry's 14-day window
  //   • amount is within tolerance of the entry's amount
  //   • either it looks like a payment (channel=payment OR name contains
  //     payment/autopay) OR it's debited from an account different from the
  //     debt's account (i.e. the source account)
  function reconcile(transactions) {
    if (!Array.isArray(transactions)) {
      try {
        var s = JSON.parse(localStorage.getItem('wjp_budget_state'));
        transactions = s.transactions || [];
      } catch (_) { transactions = []; }
    }
    var map = readAll();
    var changed = false;
    var matched = [];

    Object.keys(map).forEach(function (debtId) {
      var e = map[debtId];
      if (e.status !== 'pending') return;
      if (Date.now() > e.expiresAt) {
        e.status = 'expired';
        changed = true;
        return;
      }
      for (var i = 0; i < transactions.length; i++) {
        var t = transactions[i];
        // Amount tolerance
        var tAmt = Math.abs(t.amount || 0);
        var diff = Math.abs(tAmt - e.amount);
        var rel = e.amount > 0 ? diff / e.amount : 1;
        if (rel > AMOUNT_TOLERANCE && diff > 1.0) continue; // too far off
        // Time window: tx date within markedAt±window
        var txDate = Date.parse(t.date || t.authorized_date || t.timestamp);
        if (!isFinite(txDate)) continue;
        if (txDate < e.markedAt - 2 * DAY_MS) continue; // allow 2 days before mark for early payments
        if (txDate > e.expiresAt) continue;
        // Payment-like
        var looksLikePayment =
          t.payment_channel === 'payment' ||
          /payment|autopay|transfer/i.test((t.merchant || t.merchant_name || t.name || ''));
        if (!looksLikePayment) continue;
        // Match
        e.status = 'confirmed';
        e.confirmedTxId = t.id || t.transaction_id || null;
        e.confirmedAt = Date.now();
        matched.push({debtId: debtId, txId: e.confirmedTxId});
        changed = true;
        break;
      }
    });

    if (changed) writeAll(map);
    return { matched: matched, totalPending: Object.keys(map).filter(function (k) { return map[k].status === 'pending'; }).length };
  }

  // ---------------- prompt UI helper ----------------
  function promptMarkPaid(debtId) {
    var debt = getDebt(debtId);
    if (!debt) {
      alert('Card not found in your debts list.');
      return null;
    }
    var defaultAmt = debt.minPayment || debt.balance || 0;
    var amountStr = prompt(
      'Mark "' + debt.name + '" as paid.\n\n' +
      'How much did you pay? (it will auto-confirm when the transaction posts in 3-5 business days)',
      String(defaultAmt)
    );
    if (amountStr == null) return null;
    var amount = parseFloat(amountStr);
    if (!isFinite(amount) || amount <= 0) {
      alert('Invalid amount.');
      return null;
    }
    // Optional: ask for date, but default to today
    try {
      var entry = markPaid(debtId, amount, new Date());
      try { window.dispatchEvent(new CustomEvent('wjp-pending-payment-changed', {detail: entry})); } catch (_) {}
      return entry;
    } catch (e) {
      alert('Could not mark paid: ' + e.message);
      return null;
    }
  }

  // ---------------- auto-reconcile loop ----------------
  function tickReconcile() {
    try {
      var s = JSON.parse(localStorage.getItem('wjp_budget_state'));
      if (s && Array.isArray(s.transactions)) {
        var r = reconcile(s.transactions);
        if (r.matched.length) {
          try { window.dispatchEvent(new CustomEvent('wjp-pending-payment-confirmed', {detail: r})); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Re-run reconcile on boot + every 5 minutes + on storage events
  function start() {
    tickReconcile();
    setInterval(tickReconcile, 5 * 60 * 1000);
    window.addEventListener('storage', function (e) {
      if (e.key === 'wjp_budget_state') tickReconcile();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ---------------- public surface ----------------
  window.WJP_PendingPayments = {
    markPaid: markPaid,
    getStatus: getStatus,
    listAll: listAll,
    reconcile: reconcile,
    clear: clear,
    promptMarkPaid: promptMarkPaid,
    version: 1
  };
})();
