/* wjp-streak.js v9 — payment-on-track streak.
 *
 * v6 was a LOGIN streak: reset to 1 if the user skipped a day. That broke
 * Winston's chip even though he hadn't missed any payments.
 *
 * v7 changes the semantic to what the audit actually called for:
 *   "Days on track" = days since user's first activity, MINUS days where
 *   a recurring payment was overdue (today > nextDate, not yet paid).
 *
 * Skipping a day no longer resets the streak. Only a missed payment does.
 *
 * State (localStorage, key "wjp.streak.v2"):
 *   { startDate: "YYYY-MM-DD",    // first day we ever ran
 *     count:     <int>,           // current streak (days on track)
 *     best:      <int>,           // highest streak ever reached
 *     lastBreakDate: "YYYY-MM-DD" or null, // last day a payment went overdue
 *     lastActive: "YYYY-MM-DD" }
 */
(function () {
  'use strict';
  if (window._wjpStreakInstalled) return;
  window._wjpStreakInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) {
    return;
  }

  var LS_KEY = 'wjp.streak.v2';

  function loadState() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw) return raw;
      // Migrate forward from v1 if present (preserves "best" so users don't lose history)
      var legacy = JSON.parse(localStorage.getItem('wjp.streak.v1') || 'null');
      if (legacy) return { startDate: null, count: legacy.count || 0, best: legacy.best || 0, lastBreakDate: null, lastActive: legacy.lastActive || null };
    } catch (_) {}
    return { startDate: null, count: 0, best: 0, lastBreakDate: null, lastActive: null };
  }
  function save(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }

  function dayKey(d) {
    var y = d.getFullYear(), m = (d.getMonth() + 1).toString().padStart(2, '0'), x = d.getDate().toString().padStart(2, '0');
    return y + '-' + m + '-' + x;
  }
  function daysBetween(a, b) {
    var ad = new Date(a + 'T00:00:00');
    var bd = new Date(b + 'T00:00:00');
    return Math.round((bd - ad) / (24 * 60 * 60 * 1000));
  }

  // v8: Defer to WJP_PaymentStatus which cross-checks Plaid transactions
  // and respects the user's "Already paid" / "Not a bill" overrides. If the
  // helper hasn't loaded yet, fall back to "no overdue" rather than break
  // the streak unnecessarily.
  function hasOverduePayment() {
    try {
      if (window.WJP_PaymentStatus && typeof window.WJP_PaymentStatus.anyOverdue === 'function') {
        var raw = JSON.parse(localStorage.getItem('wjp_budget_state') || 'null');
        return !!window.WJP_PaymentStatus.anyOverdue(raw);
      }
    } catch (_) {}
    return false;
  }

  // Recompute streak from scratch each open. If any payment is overdue today,
  // the streak is broken (count=0 with lastBreakDate=today). Otherwise the
  // streak is "days since lastBreakDate" (or "days since startDate" if never
  // broken).
  function recompute() {
    var s = loadState();
    var today = dayKey(new Date());
    if (!s.startDate) s.startDate = today;

    if (hasOverduePayment()) {
      if (s.lastBreakDate !== today) {
        s.lastBreakDate = today;
        s.count = 0;
      }
    } else {
      // v9: A previous run may have written lastBreakDate=today using the
      // old naive overdue check. Now that the smarter Plaid-aware check
      // says nothing is overdue, treat that break as a false alarm and
      // clear it so the streak rebuilds from startDate (or the genuine
      // last break, if any).
      if (s.lastBreakDate === today) s.lastBreakDate = null;
      var anchor = s.lastBreakDate || s.startDate;
      if (!anchor) { anchor = today; s.startDate = today; }
      var n = daysBetween(anchor, today) + 1; // inclusive of today
      if (n < 1) n = 1;
      s.count = n;
    }
    if ((s.best || 0) < s.count) s.best = s.count;
    s.lastActive = today;
    save(s);
    return s;
  }

  function findHeaderPillRow() {
    var input = Array.from(document.querySelectorAll('input')).find(function (i) {
      var p = (i.placeholder || '').toLowerCase();
      return p.indexOf('search insights') !== -1 && i.offsetParent !== null;
    });
    if (!input) {
      var anchors = [];
      document.querySelectorAll('button, a, [role=button], [class*="pill"], [class*="btn"]').forEach(function (n) {
        var t = (n.textContent || '').toLowerCase();
        if (/privacy mode|bank health|sync bank/.test(t) && n.offsetParent !== null) anchors.push(n);
      });
      if (!anchors.length) return null;
      var cand = anchors[0].parentElement;
      while (cand) {
        var hits = anchors.filter(function (a) { return cand.contains(a); }).length;
        if (hits >= 2) return { row: cand, beforeNode: anchors[0] };
        cand = cand.parentElement;
      }
      return { row: anchors[0].parentElement, beforeNode: anchors[0] };
    }
    var rowParent = input.parentElement;
    while (rowParent) {
      var pillSibling = Array.from(rowParent.querySelectorAll('button, a, [class*="pill"]')).find(function (n) {
        return /privacy mode|bank health|sync bank/i.test((n.textContent || ''));
      });
      if (pillSibling) break;
      rowParent = rowParent.parentElement;
    }
    if (!rowParent) rowParent = input.parentElement;
    var beforeNode = input;
    while (beforeNode.parentElement && beforeNode.parentElement !== rowParent) {
      beforeNode = beforeNode.parentElement;
    }
    return { row: rowParent, beforeNode: beforeNode };
  }

  function emojiFor(count) {
    if (count >= 365) return '🏆';
    if (count >= 100) return '🔥🔥🔥';
    if (count >= 30)  return '🔥🔥';
    if (count >= 7)   return '🔥';
    if (count >= 1)   return '✓';
    return '⚠';
  }

  function renderChip() {
    try {
      var anchor = findHeaderPillRow();
      if (!anchor) return;
      var s = recompute();
      var broken = (s.count === 0);
      var emoji = emojiFor(s.count);
      var color = broken ? '#ef4444' : '#22c55e';
      var bg    = broken ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)';
      var label = broken
        ? 'Streak broken — overdue payment'
        : (s.count + ' day' + (s.count === 1 ? '' : 's') + ' on track');

      var existing = document.getElementById('wjp-streak-chip');
      if (existing) existing.remove();

      var chipHTML =
          '<span id="wjp-streak-chip" '
        +   'style="display:inline-flex;align-items:center;gap:6px;'
        +     'padding:6px 12px;border-radius:999px;border:1px solid ' + color + ';'
        +     'background:' + bg + ';color:' + color + ';'
        +     'font-size:12px;font-weight:700;cursor:help;'
        +     'margin-right:8px;white-space:nowrap;" '
        +   'title="' + label + ' · best: ' + (s.best || s.count) + (broken ? ' · pay overdue bills to restart' : '') + '">'
        +   '<span>' + emoji + '</span>'
        +   '<span><b style="font-weight:800;">' + s.count + '</b>' + (broken ? ' streak broken' : ' day' + (s.count === 1 ? '' : 's') + ' on track') + '</span>'
        + '</span>';
      anchor.beforeNode.insertAdjacentHTML('beforebegin', chipHTML);
    } catch (e) { try { console.warn('[wjp-streak v7] threw', e); } catch (_) {} }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(renderChip, 800); });
  } else {
    setTimeout(renderChip, 800);
  }
  setInterval(renderChip, 30000); // refresh every 30s in case state changes

  window.WJP_Streak = { state: loadState, recompute: recompute, refresh: renderChip };
})();
