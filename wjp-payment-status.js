/* wjp-payment-status.js v1 — shared "is this bill actually overdue?" helper.
 *
 * Naive approach (the v1/v2 modules used): if rp.nextDate < today, mark
 * overdue. But Winston's recurringPayments don't get auto-advanced when he
 * pays the bill via the creditor's site — so a paid bill stays at its old
 * nextDate forever and looks "overdue."
 *
 * v1 strategy: cross-reference with Plaid transactions.
 *   - If we find a Plaid txn whose merchant fuzzy-matches the payment name
 *     and whose amount is within ±$5 of rp.amount, dated within ±7 days of
 *     rp.nextDate → the bill was paid; not overdue.
 *   - If rp.nextDate is more than 14 days in the past AND no Plaid match,
 *     the schedule is stale (user abandoned it or it's miscategorized) →
 *     not overdue (don't bother the user about it).
 *   - Otherwise → overdue.
 *
 * Also exports a "isLikelyBill" filter that suppresses entries that don't
 * look like real bills: empty/zero amount, no nextDate, status cancelled/
 * paused, marked linkedIncome or category=income, or a per-user blocklist
 * (wjp.notBill.v1) the user maintains by clicking "Not a bill" in the alert
 * modal.
 */
(function () {
  'use strict';
  if (window.WJP_PaymentStatus) return;

  function fuzzyKey(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9 ]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 2)         // first two words — enough to match brand
      .join(' ');
  }

  function dayKey(d) {
    return d.getFullYear() + '-' +
      (d.getMonth()+1).toString().padStart(2,'0') + '-' +
      d.getDate().toString().padStart(2,'0');
  }

  // Read user's "Not a bill" list (per-user scoped if available)
  function loadNotBillList() {
    try {
      var key = 'wjp.notBill.v1';
      var raw = (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function')
        ? window.WJP_UserScope.get(key)
        : localStorage.getItem(key);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }
  function saveNotBillList(list) {
    try {
      var key = 'wjp.notBill.v1';
      var val = JSON.stringify(list || []);
      if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function') {
        window.WJP_UserScope.set(key, val);
      } else {
        localStorage.setItem(key, val);
      }
    } catch (_) {}
  }
  function markNotBill(rpIdOrName) {
    var l = loadNotBillList();
    if (l.indexOf(rpIdOrName) === -1) l.push(rpIdOrName);
    saveNotBillList(l);
  }
  function unmarkNotBill(rpIdOrName) {
    var l = loadNotBillList().filter(function (x) { return x !== rpIdOrName; });
    saveNotBillList(l);
  }

  // Manual "I paid this" overrides — keyed by rp.id with a paid-through date.
  // If today <= paidThrough, the bill is considered paid.
  function loadPaidOverrides() {
    try {
      var key = 'wjp.paidOverrides.v1';
      var raw = (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function')
        ? window.WJP_UserScope.get(key)
        : localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function savePaidOverrides(o) {
    try {
      var key = 'wjp.paidOverrides.v1';
      var val = JSON.stringify(o || {});
      if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function') {
        window.WJP_UserScope.set(key, val);
      } else {
        localStorage.setItem(key, val);
      }
    } catch (_) {}
  }
  // v2: when user marks a bill as paid, advance the recurringPayment's
  // nextDate forward by one cycle so we don't keep alerting on it.
  function advanceRecurringByOneCycle(rpId) {
    try {
      if (typeof appState === 'undefined' || !appState || !Array.isArray(appState.recurringPayments)) return;
      var rp = null;
      for (var i = 0; i < appState.recurringPayments.length; i++) {
        if (appState.recurringPayments[i] && appState.recurringPayments[i].id === rpId) { rp = appState.recurringPayments[i]; break; }
      }
      if (!rp || !rp.nextDate) return;
      var freq = (rp.frequency || 'monthly').toLowerCase();
      var next = new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00');
      if (isNaN(next.getTime())) return;
      // Advance forward until next is after today
      var today = new Date();
      var safety = 0;
      while (next.getTime() <= today.getTime() && safety++ < 60) {
        if (freq === 'weekly') next.setDate(next.getDate() + 7);
        else if (freq === 'biweekly') next.setDate(next.getDate() + 14);
        else if (freq === 'semimonthly') next.setDate(next.getDate() + 15);
        else if (freq === 'quarterly') next.setMonth(next.getMonth() + 3);
        else if (freq === 'annually') next.setFullYear(next.getFullYear() + 1);
        else next.setMonth(next.getMonth() + 1); // monthly default
      }
      rp.nextDate = next.toISOString().slice(0, 10);
      try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    } catch (_) {}
  }

  function markPaidThrough(rpId, throughIso) {
    var o = loadPaidOverrides();
    o[rpId] = throughIso;
    savePaidOverrides(o);
  }

  // Filter: is this entry plausibly a real bill the user wants alerts on?
  function isLikelyBill(rp) {
    if (!rp || !rp.nextDate) return false;
    if (rp.linkedIncome) return false;
    if ((rp.category || '').toLowerCase() === 'income') return false;
    if (rp.status === 'cancelled' || rp.status === 'paused') return false;
    if (!rp.amount || Math.abs(parseFloat(rp.amount)) < 1) return false;
    var notBill = loadNotBillList();
    if (notBill.indexOf(rp.id) >= 0) return false;
    if (notBill.indexOf(rp.name) >= 0) return false;
    return true;
  }

  // Look for a Plaid txn that matches this rp around its nextDate.
  // Returns true if we believe it was already paid.
  function isAlreadyPaid(rp, transactions, paidOverrides) {
    if (!rp || !rp.nextDate) return false;
    paidOverrides = paidOverrides || loadPaidOverrides();
    // Manual override first
    var todayStr = dayKey(new Date());
    if (paidOverrides[rp.id] && paidOverrides[rp.id] >= todayStr) return true;

    var rpKey = fuzzyKey(rp.name);
    if (!rpKey) return false;
    var amt = Math.abs(parseFloat(rp.amount) || 0);
    var nextMs = new Date(String(rp.nextDate).slice(0,10) + 'T12:00:00').getTime();
    var win = 7 * 24 * 3600 * 1000;
    var amtTol = Math.max(5, amt * 0.05); // ±$5 or ±5%, whichever larger

    for (var i = 0; i < transactions.length; i++) {
      var tx = transactions[i];
      if (!tx || !tx.date || tx.amount == null) continue;
      var txAmt = Math.abs(parseFloat(tx.amount));
      if (Math.abs(txAmt - amt) > amtTol) continue;
      // Skip recurring projections that leaked into transactions
      var id = String(tx.id || '');
      if (/^rec-/i.test(id) || id.indexOf('-rec-') >= 0) continue;
      var txMs = new Date(String(tx.date).slice(0,10) + 'T12:00:00').getTime();
      if (Math.abs(txMs - nextMs) > win) continue;
      var txKey = fuzzyKey(tx.merchant);
      if (!txKey) continue;
      // Match if either contains the other's first word, or both share fuzzyKey
      if (txKey === rpKey) return true;
      var rpFirst = rpKey.split(' ')[0];
      if (rpFirst && txKey.indexOf(rpFirst) >= 0) return true;
      var txFirst = txKey.split(' ')[0];
      if (txFirst && rpKey.indexOf(txFirst) >= 0) return true;
    }
    return false;
  }

  // The headline function. Returns one of:
  //   "overdue"     → past nextDate, no payment found, within actionable window
  //   "today"       → due today, not yet paid
  //   "soon"        → due within 3 days, not yet paid
  //   "paid"        → Plaid match or manual override says paid
  //   "stale"       → schedule too old to be actionable
  //   "ok"          → nothing pressing
  function classify(rp, transactions) {
    if (!isLikelyBill(rp)) return 'ok';
    var paidOverrides = loadPaidOverrides();
    if (isAlreadyPaid(rp, transactions || [], paidOverrides)) return 'paid';
    var todayMs = new Date(dayKey(new Date()) + 'T00:00:00').getTime();
    var nextMs  = new Date(String(rp.nextDate).slice(0,10) + 'T00:00:00').getTime();
    var deltaDays = Math.round((nextMs - todayMs) / 86400000);
    if (deltaDays > 3) return 'ok';
    if (deltaDays > 0) return 'soon';
    if (deltaDays === 0) return 'today';
    // v2: tighter stale window. If a monthly bill hasn't auto-advanced and
    // is 7+ days past due with no Plaid match, the user almost certainly
    // paid it externally — don't keep alerting.
    if (deltaDays < -7) return 'stale';
    return 'overdue';
  }

  // Convenience: any rp anywhere "overdue"? (used by streak)
  function anyOverdue(state) {
    if (!state || !state.recurringPayments) return false;
    var txns = state.transactions || [];
    for (var i = 0; i < state.recurringPayments.length; i++) {
      if (classify(state.recurringPayments[i], txns) === 'overdue') return true;
    }
    return false;
  }

  window.WJP_PaymentStatus = {
    classify: classify,
    isAlreadyPaid: isAlreadyPaid,
    isLikelyBill: isLikelyBill,
    anyOverdue: anyOverdue,
    markNotBill: markNotBill,
    unmarkNotBill: unmarkNotBill,
    loadNotBillList: loadNotBillList,
    markPaidThrough: markPaidThrough,
    advanceRecurringByOneCycle: advanceRecurringByOneCycle,
    loadPaidOverrides: loadPaidOverrides,
    fuzzyKey: fuzzyKey
  };
})();
