/* wjp-paid-syncs-debt.js v1 — When a recurring bill is confirmed paid, debit
 * the linked debt's balance (principal portion) so the Payoff Countdown
 * progress + months-remaining update in real time.
 *
 * Hooks:
 *   - window.WJP_ConfirmRecurring(txnId)  — sweep-side confirm API
 *   - Transactions: any txn whose status flips from 'pending'→'completed'
 *     AND whose name matches a debt (or has 'parentRecurringId' linking to
 *     a recurring entry that maps to a debt) → debit the debt.
 *
 * Principal calc:
 *   interest_this_month = debt.balance * (apr / 12) / 100
 *   principal           = max(0, amount - interest_this_month)
 *   debt.balance       -= principal
 *   debt.paid          += principal   (for progress %)
 *
 * Safe IIFE + install guard. Tracks already-applied payments via
 * appState.prefs.appliedPaymentIds so confirming twice doesn't double-debit.
 */
(function () {
  'use strict';
  if (window._wjpPaidSyncsDebtInstalled) return;
  window._wjpPaidSyncsDebtInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }
  function toast(msg) { try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (_) {} }

  // ---- Applied-payments ledger ----
  function getAppliedSet() {
    var s = getAppState();
    if (!s) return new Set();
    if (!s.prefs) s.prefs = {};
    if (!Array.isArray(s.prefs.appliedPaymentIds)) s.prefs.appliedPaymentIds = [];
    return new Set(s.prefs.appliedPaymentIds);
  }
  function markApplied(key) {
    var s = getAppState();
    if (!s) return;
    if (!s.prefs) s.prefs = {};
    if (!Array.isArray(s.prefs.appliedPaymentIds)) s.prefs.appliedPaymentIds = [];
    if (s.prefs.appliedPaymentIds.indexOf(key) < 0) s.prefs.appliedPaymentIds.push(key);
  }

  // ---- Match a payment/txn to a debt ----
  function findMatchingDebt(payment) {
    var s = getAppState();
    if (!s || !Array.isArray(s.debts) || !payment) return null;
    var name = String(payment.name || payment.merchant || '').toLowerCase();
    // Strip "(min payment)" suffix etc.
    name = name.replace(/\s*\(min payment\)/i, '').replace(/\s*\(autopay\)/i, '').trim();
    if (!name) return null;
    // Exact or contains match
    for (var i = 0; i < s.debts.length; i++) {
      var d = s.debts[i];
      var dn = String(d.name || '').toLowerCase();
      if (!dn) continue;
      if (dn === name) return d;
      // Contains in either direction
      if (dn.indexOf(name) !== -1 || name.indexOf(dn) !== -1) return d;
    }
    return null;
  }

  // ---- Apply a payment to a debt: subtract principal, bump paid ----
  function applyPaymentToDebt(payment, opts) {
    opts = opts || {};
    var s = getAppState();
    if (!s) return false;
    var debt = findMatchingDebt(payment);
    if (!debt) return false;
    var amount = Math.abs(Number(payment.amount) || Number(payment.minPayment) || 0);
    if (!amount || !isFinite(amount)) return false;

    // De-dupe via prefs.appliedPaymentIds
    var key = opts.key || (payment.id || (debt.id + ':' + amount + ':' + (new Date()).toISOString().slice(0, 10)));
    var applied = getAppliedSet();
    if (applied.has(key)) return false; // already applied

    var apr = Number(debt.apr) || 0;
    var bal = Number(debt.balance) || 0;
    var interestThisMonth = (bal * (apr / 100)) / 12;
    var principal = Math.max(0, amount - interestThisMonth);
    // Bounded so we don't overshoot negative
    if (principal > bal) principal = bal;

    debt.balance = Math.max(0, bal - principal);
    debt.paid = (Number(debt.paid) || 0) + principal;
    // Bump a "payments made" counter for fun stats
    debt.paymentsMade = (Number(debt.paymentsMade) || 0) + 1;

    markApplied(key);
    saveState();
    // Re-render relevant tabs
    try {
      if (typeof window.renderRecurringTab === 'function') window.renderRecurringTab();
      if (typeof window.renderDebts === 'function') window.renderDebts();
      if (typeof window.updateUI === 'function') window.updateUI();
      if (typeof window.drawCharts === 'function') window.drawCharts();
      // Custom event so other modules can react
      window.dispatchEvent(new CustomEvent('wjp-debt-payment-applied', {
        detail: { debtId: debt.id, principal: principal, interest: amount - principal, newBalance: debt.balance }
      }));
    } catch (_) {}

    toast('Applied ' + fmtUsd(principal) + ' to ' + (debt.name || 'debt') + ' (principal). Payoff countdown updated.');
    return true;
  }
  function fmtUsd(n) {
    if (!isFinite(n)) return '$0.00';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---- Wrap WJP_ConfirmRecurring to also debit the debt ----
  function wrapConfirmRecurring() {
    if (window._wjpConfirmRecurringWrapped) return;
    if (typeof window.WJP_ConfirmRecurring !== 'function') return;
    var orig = window.WJP_ConfirmRecurring;
    window.WJP_ConfirmRecurring = function (txnId) {
      var s = getAppState();
      var txn = s && Array.isArray(s.transactions) && s.transactions.find(function (t) { return t.id === txnId; });
      var result = orig.apply(this, arguments);
      // After the confirm sweeps, apply payment to its linked debt
      if (txn) {
        var pay = {
          id: txn.id,
          name: txn.merchant || txn.name,
          amount: txn.amount
        };
        applyPaymentToDebt(pay, { key: 'tx:' + txn.id });
      }
      return result;
    };
    window._wjpConfirmRecurringWrapped = true;
  }

  // ---- Hook saveState too: detect any txn that just flipped to completed
  // and is linked to a debt-side recurring schedule ----
  function watchTxnStatusFlips() {
    if (window._wjpTxStatusWatched) return;
    window._wjpTxStatusWatched = true;
    // We snapshot txns on every saveState and compare to prior snapshot.
    var prior = {}; // id -> status
    function snapshot() {
      var s = getAppState();
      if (!s || !Array.isArray(s.transactions)) return [];
      return s.transactions;
    }
    var initial = snapshot();
    initial.forEach(function (t) { prior[t.id] = t.status || 'completed'; });

    setInterval(function () {
      var s = getAppState();
      if (!s || !Array.isArray(s.transactions)) return;
      var changes = [];
      s.transactions.forEach(function (t) {
        if (!t.id) return;
        var prev = prior[t.id];
        var cur = t.status || 'completed';
        if (prev && prev !== 'completed' && cur === 'completed') {
          // Status flipped to completed
          if (t.synthetic === true || t.parentRecurringId || /\(min payment\)/i.test(t.merchant || '')) {
            changes.push(t);
          }
        }
        prior[t.id] = cur;
      });
      changes.forEach(function (t) {
        applyPaymentToDebt({
          id: t.id,
          name: t.merchant || t.name,
          amount: t.amount
        }, { key: 'tx:' + t.id });
      });
    }, 3000);
  }

  // ---- Manual "Mark as paid" API for any UI ----
  window.WJP_ApplyDebtPayment = function (debtIdOrName, amount) {
    if (!debtIdOrName) return false;
    var s = getAppState();
    if (!s || !Array.isArray(s.debts)) return false;
    var debt = s.debts.find(function (d) {
      return d.id === debtIdOrName || (d.name && d.name.toLowerCase() === String(debtIdOrName).toLowerCase());
    });
    if (!debt) return false;
    return applyPaymentToDebt({
      name: debt.name,
      amount: amount || debt.minPayment || 0
    }, { key: 'manual:' + debt.id + ':' + Date.now() });
  };

  function boot() {
    // Try to wrap immediately; if not available, retry
    [500, 1500, 4000, 9000].forEach(function (ms) { setTimeout(wrapConfirmRecurring, ms); });
    setTimeout(watchTxnStatusFlips, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_PaidSyncsDebt = {
    applyPaymentToDebt: applyPaymentToDebt,
    findMatchingDebt: findMatchingDebt,
    getApplied: function () { return Array.from(getAppliedSet()); },
    version: 1
  };
})();
