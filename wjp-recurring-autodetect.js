/* wjp-recurring-autodetect.js v1 — Auto-create recurring schedules from
 * repeating transaction merchants.
 *
 * Winston 2026-05-26: "best example i can give is the income, sometimes
 * the system doesnt remember because numbers attach change. should be
 * smart enough to recognize this."
 *
 * Real-world: ADP payroll posts every 2 weeks with a DIFFERENT amount
 * each cycle ($1109.14 then $908.18) and a DIFFERENT Plaid transaction
 * ID each time. The merchant string itself ("ACH Electronic Credit ADP
 * TOTALSOURCE PAYROLL") is the stable identity. The system should
 * recognize that and treat all such deposits as the same recurring
 * income stream — even when amount and id change.
 *
 * Universal — works for ANY user. No hardcoded merchants. Pure
 * pattern detection over appState.transactions.
 *
 * Algorithm:
 *   1. Group Plaid transactions from the last 120 days by canonical
 *      merchant key (uses WJP_TxSmartCategorize.canonMerchant).
 *   2. Skip transfers (uses isTransfer()).
 *   3. For each group with >= 3 occurrences:
 *      a. Sort by date asc, compute gaps in days between consecutive.
 *      b. If median gap is regular (within ±35% of the median across
 *         all gaps), classify cadence: weekly/biweekly/monthly/quarterly.
 *      c. Determine type: 'income' if all positive amts, 'expense' if
 *         all negative, 'mixed' (skip) otherwise.
 *      d. If no existing recurring already represents this merchant
 *         (matched by autoDetectedFromMerchant OR by name overlap >=0.7),
 *         create one with:
 *           type: 'income' | 'expense'
 *           allowVariableAmount: true  ← critical for ID/amount drift
 *           amount: median of last 3
 *           frequency: detected cadence
 *           nextDate: lastSeen + median gap
 *           autoDetectedFromMerchant: merchantKey
 *           isAutoDetected: true
 *   4. Re-runs on boot + every 60s + Plaid sync events.
 *
 * Once a recurring exists with allowVariableAmount=true, the link
 * engine's name-only matcher (wjp-recurring-link.js v2) auto-links
 * every transaction with the same merchant fingerprint regardless of
 * amount or Plaid ID.
 *
 * Safe: IIFE, idempotent install, bare appState access, try/catch.
 * Does not modify existing recurring schedules — only adds new ones.
 */
(function () {
  'use strict';
  if (window._wjpRecurringAutodetectInstalled) return;
  window._wjpRecurringAutodetectInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  // Defer to wjp-tx-smart-categorize for merchant canonicalization + transfer
  // detection, with safe fallbacks if it hasn't loaded yet.
  function canonMerchant(name) {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.canonMerchant) {
        return window.WJP_TxSmartCategorize.canonMerchant(name);
      }
    } catch (_) {}
    if (!name) return '';
    var s = String(name).toLowerCase();
    s = s.replace(/[0-9#@*]+/g, ' ');
    s = s.replace(/\b(inc|llc|ltd|co|corp|company|store|locat|pos|debit|credit|purchase|pmt|payment|online|web|app)\b/g, ' ');
    s = s.replace(/[^a-z\s]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.split(' ').filter(function (w) { return w.length >= 2; }).slice(0, 3).join(' ').trim();
  }

  function isTransfer(t) {
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(fields);
  }

  function dateMs(t) {
    try { return new Date(String(t.date || t.timestamp || '').slice(0, 10) + 'T12:00:00').getTime() || 0; } catch (_) { return 0; }
  }

  function median(arr) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function classifyCadence(medianGapDays) {
    // Tolerances: each cadence has a +/- window
    if (medianGapDays >= 5 && medianGapDays <= 9) return { freq: 'weekly', days: 7 };
    if (medianGapDays >= 11 && medianGapDays <= 17) return { freq: 'biweekly', days: 14 };
    if (medianGapDays >= 13 && medianGapDays <= 17) return { freq: 'semimonthly', days: 15 };
    if (medianGapDays >= 26 && medianGapDays <= 35) return { freq: 'monthly', days: 30 };
    if (medianGapDays >= 85 && medianGapDays <= 95) return { freq: 'quarterly', days: 91 };
    if (medianGapDays >= 360 && medianGapDays <= 370) return { freq: 'yearly', days: 365 };
    return null;
  }

  // Already-linked merchant test: is there an existing recurring whose
  // autoDetectedFromMerchant matches, OR whose name strongly overlaps
  // the merchant key?
  function existingRecurringFor(merchantKey, sampleName, recurrings) {
    for (var i = 0; i < recurrings.length; i++) {
      var rp = recurrings[i]; if (!rp) continue;
      if (rp.autoDetectedFromMerchant === merchantKey) return rp;
      var rpKey = canonMerchant(rp.name || '');
      if (rpKey && rpKey === merchantKey) return rp;
      // Token overlap fallback
      if (rp.name && sampleName) {
        var a = rp.name.toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 4; });
        var b = sampleName.toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 4; });
        if (a.length && b.length) {
          var setB = {}; b.forEach(function (t) { setB[t] = true; });
          var hits = a.filter(function (t) { return setB[t]; }).length;
          var ratio = hits / Math.max(a.length, b.length);
          if (ratio >= 0.6) return rp;
        }
      }
    }
    return null;
  }

  function detect() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return { added: 0 };
    if (!Array.isArray(s.recurringPayments)) s.recurringPayments = [];

    var now = Date.now();
    var cutoff = now - (120 * 24 * 60 * 60 * 1000);

    // Group by canonical merchant key
    var groups = {};
    s.transactions.forEach(function (t) {
      if (!t || t.source !== 'plaid') return;
      if (t.synthetic) return;
      if (t._supersededBy) return;
      if (isTransfer(t)) return;
      var ms = dateMs(t);
      if (!ms || ms < cutoff) return;
      var name = t.merchant || t.name || t.description || '';
      var key = canonMerchant(name);
      if (!key || key.length < 3) return;
      if (!groups[key]) groups[key] = { txns: [], sampleName: name };
      groups[key].txns.push({ t: t, ms: ms });
    });

    var added = 0;
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      if (g.txns.length < 3) return; // need at least 3 occurrences

      // Sort by date asc, compute gaps
      g.txns.sort(function (a, b) { return a.ms - b.ms; });
      var gaps = [];
      for (var i = 1; i < g.txns.length; i++) {
        gaps.push(Math.round((g.txns[i].ms - g.txns[i - 1].ms) / (24 * 60 * 60 * 1000)));
      }
      var medGap = median(gaps);
      if (medGap < 5) return; // sub-weekly — likely not a recurring bill/income
      // Regularity check: variance across gaps must be tight
      var maxDev = gaps.reduce(function (m, x) { return Math.max(m, Math.abs(x - medGap)); }, 0);
      // v2 (Winston 2026-05-27): loosened from 0.4 → 0.55 so more
      // real recurring merchants qualify even when one or two cycles
      // had a delayed/early payment.
      if (maxDev / Math.max(1, medGap) > 0.55) return;

      var cad = classifyCadence(medGap);
      if (!cad) return;

      // Determine type
      var amounts = g.txns.map(function (x) { return Number(x.t.amount) || 0; });
      var allPos = amounts.every(function (a) { return a > 0; });
      var allNeg = amounts.every(function (a) { return a < 0; });
      if (!allPos && !allNeg) return; // mixed sign — skip
      var type = allPos ? 'income' : 'expense';

      var existing = existingRecurringFor(key, g.sampleName, s.recurringPayments);
      if (existing) return; // already represented

      // Median amount from last 3 occurrences
      var last3 = amounts.slice(-3).map(Math.abs);
      var amt = Math.round(median(last3) * 100) / 100;
      var lastMs = g.txns[g.txns.length - 1].ms;
      var nextMs = lastMs + (cad.days * 24 * 60 * 60 * 1000);
      var nextDateIso = new Date(nextMs).toISOString().slice(0, 10);

      // Pick a clean display name — the most-frequent raw merchant string
      // in the group (rather than the squashed canonical key).
      var nameVotes = {};
      g.txns.forEach(function (x) {
        var n = (x.t.merchant || x.t.name || '').trim();
        if (!n) return;
        nameVotes[n] = (nameVotes[n] || 0) + 1;
      });
      var pickedName = Object.keys(nameVotes).sort(function (a, b) { return nameVotes[b] - nameVotes[a]; })[0]
        || g.sampleName || key;
      // Truncate display name to 60 chars
      if (pickedName.length > 60) pickedName = pickedName.slice(0, 57) + '...';

      var newRp = {
        id: 'autorec-' + key.replace(/\s+/g, '-') + '-' + Date.now().toString(36),
        name: pickedName,
        amount: amt,
        frequency: cad.freq,
        nextDate: nextDateIso,
        category: type === 'income' ? 'Income' : 'Other',
        type: type,
        allowVariableAmount: true,
        autoDetectedFromMerchant: key,
        isAutoDetected: true,
        createdAt: Date.now(),
        linkedTxnIds: [],
        openTxnId: null,
        detectionMeta: {
          occurrences: g.txns.length,
          medianGapDays: medGap,
          maxDevDays: maxDev,
          amountRange: [Math.min.apply(null, last3), Math.max.apply(null, last3)]
        }
      };
      s.recurringPayments.push(newRp);
      added++;
    });

    if (added > 0) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-recurring-changed', {
          detail: { added: added, source: 'autodetect' }
        }));
      } catch (_) {}
      try { console.log('[wjp-recurring-autodetect] created', added, 'schedules from merchant patterns'); } catch (_) {}
      // Trigger the link engine to backfill links for these new schedules
      try {
        if (window.WJP_RecurringLink && window.WJP_RecurringLink.sweep) {
          setTimeout(function () { window.WJP_RecurringLink.sweep(); }, 300);
        }
      } catch (_) {}
    }
    return { added: added };
  }

  // ───────── boot loop ─────────
  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions) && s.transactions.length > 0) {
        detect();
        return;
      }
      if (attempts < 30) setTimeout(tick, 1500);
    }
    // Wait a bit longer than other modules so smart-categorize has time to
    // flag transfers first (we use isTransfer to filter them out).
    setTimeout(tick, 4500);
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(detect, 800); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(detect, 800); });
    // Safety re-detect every 5 min
    setInterval(detect, 5 * 60 * 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  //
  // Public API
  window.WJP_RecurringAutodetect = {
    version: 2,
    detect: detect,
    canonMerchant: canonMerchant,
    classifyCadence: classifyCadence
  };
})();
