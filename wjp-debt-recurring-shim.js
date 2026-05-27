/* wjp-debt-recurring-shim.js v1 — Auto-register debts as recurring bills.
 *
 * Winston 2026-05-26: "they are supposed to be recurring debts but we need
 * to find a way to link them at actual bills."
 *
 * Every debt in appState.debts that has a positive balance and a minimum
 * payment is implicitly a monthly recurring bill. This shim ensures
 * appState.recurringPayments contains a derived entry for every such debt
 * so the rest of the pipeline (wjp-recurring-link, wjp-payment-detector,
 * Recurring Payments table renderer) can operate on it uniformly.
 *
 * Universal — works for ANY user. Idempotent: derived entries are tagged
 * `derivedFromDebtId: <id>` so we update existing ones instead of duplicating.
 *
 * Derivation rules:
 *   name      = debt.name (or fallback)
 *   amount    = debt.minimumPayment || debt.minimum || (debt.balance * apr/12/100 + small)
 *   frequency = 'monthly' (debts pay monthly)
 *   nextDate  = debt.dueDate || debt.nextPaymentDate || nextMonthEndDate
 *   category  = 'Debt'
 *   id        = 'debt-rec-' + debt.id
 *   derivedFromDebtId = debt.id
 *   isAutoDerived = true   (so other modules can opt out by filtering)
 *
 * Re-runs on:
 *   - boot (after appState hydrates)
 *   - 'wjp-debts-changed' / 'wjp-data-restored' events
 *   - every 30s safety tick (cheap, only acts when debts have actually changed)
 *
 * Does NOT delete recurring entries that lose their debt — those become
 * orphans the user can manually clear. We just stop updating them.
 *
 * Safe: IIFE, idempotent install guard, bare appState access, try/catch.
 */
(function () {
  'use strict';
  if (window._wjpDebtRecurringShimInstalled) return;
  window._wjpDebtRecurringShimInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function nextMonthEndIso() {
    var d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setDate(0); // last day of the new month? actually setDate(0) gives last day of CURRENT month after the +1, which is the last day of next month. Hmm.
    // Cleaner: pick the same day-of-month one month forward, clamped to last day if not valid.
    var n = new Date();
    var target = n.getDate();
    n.setDate(1);
    n.setMonth(n.getMonth() + 1);
    var lastDay = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(target, lastDay));
    return n.toISOString().slice(0, 10);
  }

  function computeMonthlyAmount(debt) {
    if (debt.minimumPayment != null && Number(debt.minimumPayment) > 0) return Number(debt.minimumPayment);
    if (debt.minimum != null && Number(debt.minimum) > 0) return Number(debt.minimum);
    if (debt.monthlyPayment != null && Number(debt.monthlyPayment) > 0) return Number(debt.monthlyPayment);
    if (debt.payment != null && Number(debt.payment) > 0) return Number(debt.payment);
    // Fallback: estimate as 2% of balance or interest-only + $25, whichever larger
    var bal = Number(debt.balance) || Number(debt.currentBalance) || 0;
    var apr = Number(debt.apr) || Number(debt.interestRate) || 0;
    if (bal <= 0) return 0;
    var twoPct = bal * 0.02;
    var interest = bal * (apr / 12) / 100;
    var est = Math.max(twoPct, interest + 25);
    return Math.round(est * 100) / 100;
  }

  function deriveNextDate(debt) {
    var candidates = [debt.dueDate, debt.nextPaymentDate, debt.nextDueDate, debt.statementDueDate];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c) continue;
      try {
        var d = new Date(String(c).slice(0, 10) + 'T12:00:00');
        if (isFinite(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (_) {}
    }
    return nextMonthEndIso();
  }

  function sync() {
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return { added: 0, updated: 0 };
    if (!Array.isArray(s.recurringPayments)) s.recurringPayments = [];

    var changed = false;
    var added = 0, updated = 0;

    // Index existing derived entries by derivedFromDebtId
    var byDebtId = {};
    s.recurringPayments.forEach(function (rp) {
      if (rp && rp.derivedFromDebtId) byDebtId[rp.derivedFromDebtId] = rp;
    });

    s.debts.forEach(function (debt) {
      if (!debt || !debt.id) return;
      var bal = Number(debt.balance) || Number(debt.currentBalance) || 0;
      if (bal <= 0) return; // paid-off debts don't recur
      var existing = byDebtId[debt.id];
      var name = String(debt.name || debt.creditor || debt.label || 'Debt');
      var amount = computeMonthlyAmount(debt);
      if (!amount) return;
      var nextDate = deriveNextDate(debt);
      if (existing) {
        // Update name/amount/date if any drift, but DO NOT touch link state
        var dirty = false;
        if (existing.name !== name) { existing.name = name; dirty = true; }
        // Only update amount if user hasn't manually edited it (no _userEditedAmount flag)
        if (!existing._userEditedAmount && existing.amount !== amount) {
          existing.amount = amount; dirty = true;
        }
        if (!existing._userEditedNextDate && existing.nextDate !== nextDate) {
          existing.nextDate = nextDate; dirty = true;
        }
        if (dirty) { updated++; changed = true; }
      } else {
        var newRp = {
          id: 'debt-rec-' + debt.id,
          name: name,
          amount: amount,
          frequency: 'monthly',
          nextDate: nextDate,
          category: 'Debt',
          type: 'debt',
          derivedFromDebtId: debt.id,
          isAutoDerived: true,
          createdAt: Date.now(),
          linkedTxnIds: [],
          openTxnId: null
        };
        s.recurringPayments.push(newRp);
        added++;
        changed = true;
      }
    });

    if (changed) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-recurring-changed', {
          detail: { added: added, updated: updated, source: 'debt-shim' }
        }));
      } catch (_) {}
      try { console.log('[wjp-debt-recurring-shim] added', added, 'updated', updated); } catch (_) {}
    }
    return { added: added, updated: updated };
  }

  // ───────── boot loop ─────────
  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.debts)) {
        sync();
        return;
      }
      if (attempts < 20) setTimeout(tick, 1500);
    }
    setTimeout(tick, 2500);
    window.addEventListener('wjp-debts-changed', function () { setTimeout(sync, 300); });
    window.addEventListener('wjp-data-restored', function () { setTimeout(sync, 300); });
    // Safety tick
    setInterval(sync, 30 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_DebtRecurringShim = {
    version: 1,
    sync: sync,
    computeMonthlyAmount: computeMonthlyAmount,
    deriveNextDate: deriveNextDate
  };
})();
