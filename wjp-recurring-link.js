/* wjp-recurring-link.js v1 — Link transactions to recurring schedules with
 * a paid/pending lifecycle.
 *
 * Universal — works for ANY user. Reads from appState.recurringPayments +
 * appState.transactions. Stores link state on the transaction + recurring
 * itself so UI hooks can render badges without recomputing.
 *
 * Lifecycle states (per linked transaction):
 *   • 'pending'   — match recorded, < 5 business days since transaction date
 *   • 'cleared'   — >= 5 business days passed (typical ACH settlement clear)
 *   • 'confirmed' — >= 7 calendar days passed since match, locked
 *
 * Manual overrides:
 *   • WJP_RecurringLink.link(txnId, rpId)   — force a link
 *   • WJP_RecurringLink.unlink(txnId)       — drop a link (txn flagged
 *                                              '_userUnlinked' so the auto
 *                                              sweep won't relink it)
 *
 * Storage on transaction:
 *   t.linkedRecurringId  — recurring schedule id
 *   t.linkedAt           — ms timestamp of match
 *   t.linkConfirmedAt    — ms timestamp when confirmed
 *   t.linkStatus         — 'pending' | 'cleared' | 'confirmed'
 *   t._userUnlinked      — true if user manually unlinked (suppresses re-match)
 *
 * Storage on recurring schedule:
 *   rp.linkedTxnIds      — array of txn ids ever linked (lifetime)
 *   rp.openTxnId         — currently-open link for current cycle (if any)
 *   rp.lastLinkedAt      — most recent match ms timestamp
 *
 * Reuses match heuristics from window.WJP_PaymentDetector when available,
 * falls back to internal copy if not loaded.
 *
 * Safe: IIFE, idempotent install, bare `appState` access, try/catch wrapped.
 * Does not mutate Plaid sync, does not advance recurring nextDate (that's
 * wjp-payment-detector's job). Just tracks the link relationship.
 */
(function () {
  'use strict';
  if (window._wjpRecurringLinkInstalled) return;
  window._wjpRecurringLinkInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // ───────── helpers ─────────
  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function normalize(s) {
    if (window.WJP_PaymentDetector && window.WJP_PaymentDetector.normalize) {
      return window.WJP_PaymentDetector.normalize(s);
    }
    return String(s || '').toLowerCase()
      .replace(/\(min payment\)/g, '')
      .replace(/\b(payment|bill|monthly|recurring|auto|autopay|debit|credit|inc|llc)\b/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nameOverlap(a, b) {
    if (window.WJP_PaymentDetector && window.WJP_PaymentDetector.nameOverlap) {
      return window.WJP_PaymentDetector.nameOverlap(a, b);
    }
    var aa = normalize(a).split(' ').filter(function (t) { return t.length >= 3; });
    var bb = normalize(b).split(' ').filter(function (t) { return t.length >= 3; });
    if (!aa.length || !bb.length) return 0;
    var setB = {}; bb.forEach(function (t) { setB[t] = true; });
    var hits = aa.filter(function (t) { return setB[t]; }).length;
    return hits / Math.max(aa.length, bb.length);
  }

  function scoreMatch(rp, txn) {
    if (window.WJP_PaymentDetector && window.WJP_PaymentDetector.scoreMatch) {
      return window.WJP_PaymentDetector.scoreMatch(rp, txn);
    }
    var amt = Math.abs(Number(txn.amount) || 0);
    var target = Math.abs(Number(rp.amount) || 0);
    if (!target || !amt) return { conf: 'none' };
    var amtRatio = Math.min(amt, target) / Math.max(amt, target);
    var name = nameOverlap(rp.name, txn.merchant || txn.name || '');
    if (name >= 0.5 && amtRatio >= 0.88) return { conf: 'high', name: name, amt: amtRatio };
    if (name >= 0.5 && amtRatio >= 0.75) return { conf: 'medium', name: name, amt: amtRatio };
    if (name >= 0.34 && amtRatio >= 0.95) return { conf: 'medium', name: name, amt: amtRatio };
    return { conf: 'none' };
  }

  function txnDateMs(t) {
    try { return new Date(String(t.date || t.timestamp || '').slice(0, 10) + 'T12:00:00').getTime() || 0; } catch (_) { return 0; }
  }

  // Business-day arithmetic: skip Sat/Sun. Add `n` business days to `fromMs`.
  function addBusinessDays(fromMs, n) {
    var d = new Date(fromMs);
    var added = 0;
    while (added < n) {
      d.setDate(d.getDate() + 1);
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d.getTime();
  }

  var FIVE_BD = 5;
  var SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;

  // ───────── core: compute current status for an already-linked txn ─────────
  function computeStatus(t, nowMs) {
    if (!t || !t.linkedRecurringId) return null;
    nowMs = nowMs || Date.now();
    var matchAnchor = t.linkedAt || txnDateMs(t) || nowMs;
    var sevenDayMark = matchAnchor + SEVEN_D_MS;
    if (nowMs >= sevenDayMark) return 'confirmed';
    // 5 business days from the transaction date itself (more accurate than from match)
    var fiveBdMark = addBusinessDays(txnDateMs(t) || matchAnchor, FIVE_BD);
    if (nowMs >= fiveBdMark) return 'cleared';
    return 'pending';
  }

  // ───────── promote: walk existing links, update status, lock at 7D ─────────
  function promote() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return { promoted: 0 };
    var now = Date.now();
    var promoted = 0;
    s.transactions.forEach(function (t) {
      if (!t || !t.linkedRecurringId) return;
      var prev = t.linkStatus || 'pending';
      var next = computeStatus(t, now);
      if (next && next !== prev) {
        t.linkStatus = next;
        if (next === 'confirmed' && !t.linkConfirmedAt) t.linkConfirmedAt = now;
        promoted++;
      }
    });
    if (promoted > 0) saveState();
    return { promoted: promoted };
  }

  // ───────── find best matching recurring for a single Plaid txn ─────────
  function findBestRecurring(t, recurrings) {
    var best = null, bestScore = -1;
    recurrings.forEach(function (rp) {
      if (!rp || !rp.id) return;
      if (rp.openTxnId) return; // recurring already has an open link this cycle
      var sc = scoreMatch(rp, t);
      if (sc.conf !== 'high') return; // require high confidence for auto-link
      var combined = (sc.name * 0.6) + (sc.amt * 0.4);
      if (combined > bestScore) { bestScore = combined; best = rp; }
    });
    return best;
  }

  // ───────── sweep: link unlinked Plaid txns from last 60d ─────────
  function sweep() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions) || !Array.isArray(s.recurringPayments)) {
      return { linked: 0, promoted: 0 };
    }
    if (!s.recurringPayments.length) return { linked: 0, promoted: promote().promoted };

    var now = Date.now();
    var cutoff = now - (60 * 24 * 60 * 60 * 1000);
    var linked = 0;

    // Ensure each recurring has linkedTxnIds initialized
    s.recurringPayments.forEach(function (rp) {
      if (rp && !Array.isArray(rp.linkedTxnIds)) rp.linkedTxnIds = [];
    });

    // Cycle reset: if a recurring's openTxnId is for a txn that's now
    // 'confirmed' (or no longer exists), clear openTxnId so the next match
    // can take its slot.
    s.recurringPayments.forEach(function (rp) {
      if (!rp || !rp.openTxnId) return;
      var open = s.transactions.find(function (x) { return x && x.id === rp.openTxnId; });
      if (!open || !open.linkedRecurringId || open.linkStatus === 'confirmed') {
        rp.openTxnId = null;
      }
    });

    s.transactions.forEach(function (t) {
      if (!t || t.linkedRecurringId || t._userUnlinked) return;
      if (t.synthetic) return; // synthetic txns are placeholders, don't auto-link them to themselves
      if (t.source !== 'plaid') return; // only auto-link real Plaid posts
      var ms = txnDateMs(t);
      if (!ms || ms < cutoff) return;
      var best = findBestRecurring(t, s.recurringPayments);
      if (!best) return;
      // Link it
      t.linkedRecurringId = best.id;
      t.linkedAt = now;
      t.linkStatus = computeStatus(t, now);
      if (t.linkStatus === 'confirmed') t.linkConfirmedAt = now;
      if (best.linkedTxnIds.indexOf(t.id) === -1) best.linkedTxnIds.push(t.id);
      best.openTxnId = t.id;
      best.lastLinkedAt = now;
      linked++;
    });

    var p = promote().promoted;
    if (linked > 0 || p > 0) {
      saveState();
      try {
        window.dispatchEvent(new CustomEvent('wjp-recurring-link-changed', {
          detail: { linked: linked, promoted: p }
        }));
      } catch (_) {}
      try { console.log('[wjp-recurring-link] linked', linked, '+ promoted', p); } catch (_) {}
    }
    return { linked: linked, promoted: p };
  }

  // ───────── manual link / unlink ─────────
  function link(txnId, rpId) {
    var s = getState();
    if (!s) return false;
    var t = (s.transactions || []).find(function (x) { return x && x.id === txnId; });
    var rp = (s.recurringPayments || []).find(function (x) { return x && x.id === rpId; });
    if (!t || !rp) return false;
    // If this txn was previously linked elsewhere, unlink from old
    if (t.linkedRecurringId && t.linkedRecurringId !== rpId) {
      var oldRp = s.recurringPayments.find(function (x) { return x && x.id === t.linkedRecurringId; });
      if (oldRp) {
        if (oldRp.openTxnId === t.id) oldRp.openTxnId = null;
        if (Array.isArray(oldRp.linkedTxnIds)) {
          var i = oldRp.linkedTxnIds.indexOf(t.id);
          if (i !== -1) oldRp.linkedTxnIds.splice(i, 1);
        }
      }
    }
    var now = Date.now();
    t.linkedRecurringId = rpId;
    t.linkedAt = now;
    t._userUnlinked = false;
    t.linkStatus = computeStatus(t, now);
    if (t.linkStatus === 'confirmed') t.linkConfirmedAt = now;
    if (!Array.isArray(rp.linkedTxnIds)) rp.linkedTxnIds = [];
    if (rp.linkedTxnIds.indexOf(t.id) === -1) rp.linkedTxnIds.push(t.id);
    rp.openTxnId = t.id;
    rp.lastLinkedAt = now;
    saveState();
    try {
      window.dispatchEvent(new CustomEvent('wjp-recurring-link-changed', {
        detail: { linked: 1, manual: true, txnId: txnId, rpId: rpId }
      }));
    } catch (_) {}
    return true;
  }

  function unlink(txnId) {
    var s = getState();
    if (!s) return false;
    var t = (s.transactions || []).find(function (x) { return x && x.id === txnId; });
    if (!t || !t.linkedRecurringId) return false;
    var rpId = t.linkedRecurringId;
    var rp = (s.recurringPayments || []).find(function (x) { return x && x.id === rpId; });
    if (rp) {
      if (rp.openTxnId === txnId) rp.openTxnId = null;
      if (Array.isArray(rp.linkedTxnIds)) {
        var i = rp.linkedTxnIds.indexOf(txnId);
        if (i !== -1) rp.linkedTxnIds.splice(i, 1);
      }
    }
    t.linkedRecurringId = null;
    t.linkedAt = null;
    t.linkConfirmedAt = null;
    t.linkStatus = null;
    t._userUnlinked = true; // suppress auto re-link
    saveState();
    try {
      window.dispatchEvent(new CustomEvent('wjp-recurring-link-changed', {
        detail: { unlinked: 1, manual: true, txnId: txnId, rpId: rpId }
      }));
    } catch (_) {}
    return true;
  }

  function getLinkStatus(t) {
    if (!t || !t.linkedRecurringId) return null;
    var s = getState();
    var rp = (s && s.recurringPayments) ? s.recurringPayments.find(function (x) { return x && x.id === t.linkedRecurringId; }) : null;
    var status = t.linkStatus || computeStatus(t);
    var now = Date.now();
    var anchor = txnDateMs(t) || t.linkedAt || now;
    return {
      rpId: t.linkedRecurringId,
      rpName: rp ? (rp.name || rp.label || 'Recurring') : 'Unknown',
      status: status,
      linkedAt: t.linkedAt,
      confirmedAt: t.linkConfirmedAt,
      clearsAt: addBusinessDays(anchor, FIVE_BD),
      confirmsAt: anchor + SEVEN_D_MS,
      daysUntilConfirm: Math.max(0, Math.ceil((anchor + SEVEN_D_MS - now) / (24 * 60 * 60 * 1000)))
    };
  }

  // ───────── boot loop ─────────
  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var s = getState();
      if (s && Array.isArray(s.transactions)) {
        sweep();
        return;
      }
      if (attempts < 20) setTimeout(tick, 1500);
    }
    setTimeout(tick, 2000);
    // Re-sweep on Plaid sync + recurring change events
    window.addEventListener('wjp-plaid-sync-done', function () { setTimeout(sweep, 500); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(sweep, 300); });
    window.addEventListener('wjp-recurring-changed', function () { setTimeout(sweep, 300); });
    // Periodic promote (cheap): every 5 min advance pending → cleared → confirmed
    setInterval(promote, 5 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_RecurringLink = {
    version: 1,
    sweep: sweep,
    promote: promote,
    link: link,
    unlink: unlink,
    getLinkStatus: getLinkStatus,
    computeStatus: computeStatus,
    scoreMatch: scoreMatch,
    addBusinessDays: addBusinessDays
  };
})();
