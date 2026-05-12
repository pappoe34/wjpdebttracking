/* wjp-payment-detector.js v2 — tighter match thresholds + earlier Looks Unused flag
 *
 * For every non-income recurring payment with nextDate in the past, scan the
 * user's Plaid transactions for a likely match (fuzzy merchant name + amount
 * within ~15%). If found, advance the recurring's nextDate by its frequency
 * cycle so it stops showing up as "overdue" in upcoming payments.
 *
 * Conservative by default:
 *   - Only HIGH-confidence matches auto-advance (strong name + tight amount).
 *   - Medium matches just stamp `lastPossibleMatch` for surfacing in UI later.
 *   - No matches at all → entry is flagged `looksUnused: true` so the user can
 *     decide to delete it. (Per Winston's note: "Family coverage is not a bill.")
 *
 * Runs once on load + every 60s thereafter (cheap — only acts on stale rows).
 */
(function () {
  'use strict';
  if (window._wjpPaymentDetectorInstalled) return;
  window._wjpPaymentDetectorInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/\(min payment\)/g, '')
      .replace(/\b(payment|bill|monthly|recurring|auto|autopay|debit|credit|inc|llc)\b/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Fuzzy name match — returns ratio 0..1 based on shared significant tokens.
  function nameOverlap(rpName, txnName) {
    var a = normalize(rpName).split(' ').filter(function (t) { return t.length >= 3; });
    var b = normalize(txnName).split(' ').filter(function (t) { return t.length >= 3; });
    if (!a.length || !b.length) return 0;
    var setB = {}; b.forEach(function (t) { setB[t] = true; });
    var hits = a.filter(function (t) { return setB[t]; }).length;
    return hits / Math.max(a.length, b.length);
  }

  function freqToDays(freq) {
    switch ((freq || 'monthly').toLowerCase()) {
      case 'weekly':    return 7;
      case 'biweekly':
      case 'bi-weekly': return 14;
      case 'semimonthly':
      case 'semi-monthly': return 15;
      case 'monthly':   return 30; // approximation; advance handles month-end
      case 'quarterly': return 91;
      case 'yearly':
      case 'annual':
      case 'annually':  return 365;
      default: return 30;
    }
  }

  function addCycle(dateStr, freq) {
    var d = new Date(dateStr.slice(0, 10) + 'T12:00:00');
    if (!isFinite(d.getTime())) return dateStr;
    var f = (freq || 'monthly').toLowerCase();
    if (f === 'monthly')   { d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0,10); }
    if (f === 'quarterly') { d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0,10); }
    if (f === 'yearly' || f === 'annual' || f === 'annually') { d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0,10); }
    var days = freqToDays(f);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  }

  function scoreMatch(rp, txn) {
    var amt = Math.abs(Number(txn.amount) || 0);
    var target = Math.abs(Number(rp.amount) || 0);
    if (!target || !amt) return { conf: 'none' };
    var amtRatio = Math.min(amt, target) / Math.max(amt, target);
    var name = nameOverlap(rp.name, txn.merchant || txn.name || '');
    // v2: Stricter thresholds to avoid mismatches.
    //   - HIGH (auto-advance): name >= 0.5 AND amount within 12% (ratio >= 0.88)
    //   - MEDIUM (suggest):    name >= 0.5 AND amount within 25% (ratio >= 0.75)
    //   Or: amount nearly identical (ratio >= 0.95) AND name >= 0.34 (one token from a 3-token name)
    if (name >= 0.5 && amtRatio >= 0.88) return { conf: 'high', name: name, amt: amtRatio };
    if (name >= 0.5 && amtRatio >= 0.75) return { conf: 'medium', name: name, amt: amtRatio };
    if (name >= 0.34 && amtRatio >= 0.95) return { conf: 'medium', name: name, amt: amtRatio };
    return { conf: 'none' };
  }

  function dateMs(s) {
    try { return new Date(String(s).slice(0,10) + 'T12:00:00').getTime(); } catch (_) { return 0; }
  }

  function detect() {
    var s = getState();
    if (!s || !Array.isArray(s.recurringPayments) || !Array.isArray(s.transactions)) return { advanced: 0, flagged: 0 };
    var now = Date.now();
    var today0 = new Date(); today0.setHours(0,0,0,0);
    var todayMs = today0.getTime();

    // Index Plaid debits (negative non-synthetic txns) for fast scan
    var plaidDebits = s.transactions.filter(function (t) {
      if (!t || t.synthetic || t.source !== 'plaid') return false;
      var amt = Number(t.amount) || 0;
      return amt < 0;
    });

    var advanced = 0, flagged = 0, changed = false;

    s.recurringPayments.forEach(function (rp) {
      if (!rp || rp.category === 'income' || rp.linkedIncome) return;
      if (rp.status === 'cancelled' || rp.status === 'paused') return;
      if (!rp.nextDate) return;

      var nextMs = dateMs(rp.nextDate);
      if (!nextMs) return;

      var freq = rp.frequency || 'monthly';
      var cycleMs = freqToDays(freq) * 86400000;

      // Find the most recent HIGH-confidence Plaid match within the last 90 days
      var bestMatch = null;
      plaidDebits.forEach(function (t) {
        var tMs = dateMs(t.date);
        if (!tMs) return;
        if (todayMs - tMs > 90 * 86400000) return; // older than 90d — ignore
        var sc = scoreMatch(rp, t);
        if (sc.conf === 'high') {
          if (!bestMatch || tMs > bestMatch.ms) bestMatch = { ms: tMs, txn: t, score: sc };
        } else if (sc.conf === 'medium' && (!bestMatch || bestMatch.score.conf !== 'high')) {
          // Hold a medium candidate for the "lastPossibleMatch" flag, but never auto-advance on it.
          if (!bestMatch || tMs > bestMatch.ms) bestMatch = { ms: tMs, txn: t, score: sc };
        }
      });

      if (bestMatch && bestMatch.score.conf === 'high') {
        // Auto-advance: roll nextDate forward in cycles until it lands AFTER the
        // matched payment AND in the future.
        var newDate = rp.nextDate;
        var guard = 0;
        while (dateMs(newDate) <= bestMatch.ms && guard < 24) {
          newDate = addCycle(newDate, freq);
          guard++;
        }
        // Also ensure newDate is no earlier than today (handle case where matched
        // payment was today/yesterday).
        while (dateMs(newDate) < todayMs && guard < 24) {
          newDate = addCycle(newDate, freq);
          guard++;
        }
        if (newDate !== rp.nextDate) {
          rp.nextDate = newDate;
          rp.lastPaidDate = new Date(bestMatch.ms).toISOString().slice(0,10);
          rp.lastPaidAmount = Math.abs(Number(bestMatch.txn.amount) || 0);
          rp.lastDetectedBy = 'wjp-payment-detector';
          delete rp.looksUnused;
          advanced++;
          changed = true;
        }
      } else if (bestMatch && bestMatch.score.conf === 'medium') {
        // Surface as a "possible match" without changing nextDate. UI can hint.
        rp.lastPossibleMatch = {
          date: new Date(bestMatch.ms).toISOString().slice(0,10),
          merchant: bestMatch.txn.merchant || bestMatch.txn.name || '',
          amount: Math.abs(Number(bestMatch.txn.amount) || 0),
          nameScore: Math.round(bestMatch.score.name * 100),
          amtScore: Math.round(bestMatch.score.amt * 100)
        };
        delete rp.looksUnused;
        flagged++;
        changed = true;
      } else if (nextMs < todayMs - 35 * 86400000) {  // v2: 35d ≈ 1 missed monthly cycle
        // No Plaid match found AND nextDate is >60d in the past.
        // Mark as likely unused so user can review/delete.
        if (!rp.looksUnused) {
          rp.looksUnused = true;
          rp.looksUnusedSince = new Date(todayMs).toISOString().slice(0,10);
          changed = true;
          flagged++;
        }
      }
    });

    if (changed && typeof window.saveState === 'function') {
      try { window.saveState(); } catch (_) {}
      try { if (typeof window.renderUpcomingList === 'function') window.renderUpcomingList(); } catch (_) {}
    }

    return { advanced: advanced, flagged: flagged };
  }

  // Run once on load (after a delay to let state finish loading), then every 60s.
  function boot() {
    setTimeout(detect, 2500);
    setInterval(detect, 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WJP_PaymentDetector = { detect: detect, scoreMatch: scoreMatch, normalize: normalize, nameOverlap: nameOverlap, addCycle: addCycle };
})();
