/* wjp-upcoming-payments.js v4 — match Calendar parity: roll forward ANY past nextDate
 *
 * v3 fixes the "stale overdue" bug: when a recurring's stored nextDate is more than
 * one cycle in the past, Calendar simply hides it (filters t <= todayMs), but this
 * widget exposed the underlying staleness as "40 days overdue". Now we mirror Calendar's
 * intent: roll-forward a display-only nextDate by full cycles, AND hide recurrings flagged
 * `looksUnused` by the payment-detector (they belong in Recurring tab cleanup, not here).
 *
 * v3 behavior:
 *   - If rp.looksUnused === true → suppress entirely (user reviews in Recurring tab).
 *   - Else if rp.nextDate is in the past, roll forward by cycle until ≥ today (display only).
 *   - Real overdue (<= 1 cycle past) still shown with OVERDUE chip.
 *   - Dedupe debts vs "(min payment)" recurring entries (unchanged from v2).
 */
(function () {
  'use strict';
  if (window._wjpUpcomingInstalled) return;
  window._wjpUpcomingInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0); }
  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function normName(s) {
    return String(s || '').toLowerCase()
      .replace(/\(min payment\)/g, '')
      .replace(/\b(min|minimum|payment|loan|card|credit)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDateSafe(dateStr) {
    if (!dateStr) return null;
    try {
      var d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
      return isFinite(d.getTime()) ? d : null;
    } catch (_) { return null; }
  }
  function daysBetween(target, now) { return Math.round((target.getTime() - now.getTime()) / 86400000); }

  // v3: cycle math mirrors wjp-payment-detector.js — keep these aligned.
  function addCycle(d, freq) {
    var nd = new Date(d.getTime());
    var f = (freq || 'monthly').toLowerCase();
    if (f === 'weekly')        { nd.setDate(nd.getDate() + 7);  return nd; }
    if (f === 'biweekly' || f === 'bi-weekly') { nd.setDate(nd.getDate() + 14); return nd; }
    if (f === 'semimonthly' || f === 'semi-monthly') { nd.setDate(nd.getDate() + 15); return nd; }
    if (f === 'quarterly')     { nd.setMonth(nd.getMonth() + 3); return nd; }
    if (f === 'yearly' || f === 'annual' || f === 'annually') { nd.setFullYear(nd.getFullYear() + 1); return nd; }
    nd.setMonth(nd.getMonth() + 1);
    return nd;
  }
  // v3: roll forward stored nextDate to the next on-or-after-today instance.
  // Only roll if more than 1 cycle stale — within 1 cycle we honor the OVERDUE state.
  function projectedDueDate(rp, now) {
    var d = parseDateSafe(rp.nextDate);
    if (!d) return null;
    var freq = rp.frequency || 'monthly';
    // v4: Match Calendar parity — Calendar drops any recurring with t <= todayMs, so users
    // perceive past-due recurrings as already advanced. Mirror that here by rolling forward
    // ANY past nextDate to its next occurrence on-or-after today. Truly missed bills are
    // already surfaced via the payment-detector's looksUnused flag (filtered upstream).
    var guard = 0;
    while (d.getTime() < now.getTime() && guard < 60) {
      d = addCycle(d, freq);
      guard++;
    }
    return d;
  }

  function buildItems() {
    var s = getState() || {};
    var debts = (s.debts || []).filter(function (d) { return d && (d.balance > 0 || d.minPayment > 0); });
    var recs  = (s.recurringPayments || []).filter(function (r) {
      if (!r) return false;
      if (r.category === 'income' || r.linkedIncome) return false;
      if (r.status === 'cancelled' || r.status === 'paused') return false;
      // v3: suppress detector-flagged unused recurrings — they belong in Recurring tab cleanup
      if (r.looksUnused) return false;
      return true;
    });
    var now = new Date(); now.setHours(0,0,0,0);

    var recByKey = {};
    recs.forEach(function (r) {
      var k = normName(r.name);
      if (!recByKey[k]) recByKey[k] = r;
    });

    var items = [];
    var consumedRecKeys = {};

    debts.forEach(function (d) {
      var k = normName(d.name);
      var rec = recByKey[k];
      var dueDate, source;
      if (rec && rec.nextDate) {
        dueDate = projectedDueDate(rec, now);
        source = 'recurring';
        consumedRecKeys[k] = true;
      } else {
        var day = parseInt(d.dueDate, 10);
        if (!isFinite(day) || day < 1 || day > 31) day = 15;
        dueDate = new Date(now.getFullYear(), now.getMonth(), day);
        if (dueDate < now) dueDate = new Date(now.getFullYear(), now.getMonth() + 1, day);
        source = 'debt';
      }
      if (!dueDate) return;
      items.push({
        kind: 'debt',
        name: d.name,
        amount: d.minPayment || 0,
        apr: d.apr,
        dueDate: dueDate,
        daysUntil: daysBetween(dueDate, now),
        source: source,
        lastPossibleMatch: rec && rec.lastPossibleMatch,
        lastPaidDate: rec && rec.lastPaidDate
      });
    });

    recs.forEach(function (r) {
      var k = normName(r.name);
      if (consumedRecKeys[k]) return;
      var dueDate = projectedDueDate(r, now);
      if (!dueDate) return;
      items.push({
        kind: 'recurring',
        name: r.name,
        amount: Math.abs(r.amount || 0),
        apr: 0,
        dueDate: dueDate,
        daysUntil: daysBetween(dueDate, now),
        category: r.category,
        lastPossibleMatch: r.lastPossibleMatch,
        lastPaidDate: r.lastPaidDate
      });
    });

    return items.sort(function (a, b) { return a.daysUntil - b.daysUntil; });
  }

  function statusFor(item, now) {
    if (item.daysUntil < 0) return { label: 'OVERDUE', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    if (item.daysUntil === 0) return { label: 'TODAY',   color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
    if (item.daysUntil <= 3) return { label: 'URGENT',  color: '#ea580c', bg: 'rgba(234,88,12,0.12)' };
    if (item.daysUntil <= 7) return { label: 'SOON',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
    return { label: 'SCHEDULED', color: '#10b981', bg: 'rgba(16,185,129,0.10)' };
  }

  function iconFor(item) {
    var n = (item.name || '').toLowerCase();
    if (/mortgage|rent/.test(n)) return 'ph-house';
    if (/student/.test(n)) return 'ph-graduation-cap';
    if (/car|auto|honda|toyota|westlake|capital one venture/.test(n)) return 'ph-car';
    if (/credit|visa|amex|discover|chase|citi/.test(n)) return 'ph-credit-card';
    if (/insurance|progressive|geico|state farm|coverage/.test(n)) return 'ph-shield-check';
    if (/utility|elec|gas|water|internet|comcast/.test(n)) return 'ph-lightning';
    if (/netflix|hulu|spotify|peacock|youtube|amazon prime|subscription|claude|openai|chatgpt|ai/.test(n)) return 'ph-television';
    return 'ph-currency-dollar';
  }

  function fmtDate(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function daysCopy(n) {
    if (n < 0) return Math.abs(n) + ' day' + (Math.abs(n)!==1?'s':'') + ' overdue';
    if (n === 0) return 'Due today';
    if (n === 1) return 'Due tomorrow';
    return 'Due in ' + n + ' days';
  }

  var EXPANDED = false;
  var COLLAPSED_LIMIT = 6;

  function renderInto(host) {
    if (!host) return;
    var items = buildItems();
    if (!items.length) {
      host.innerHTML = ''
        + '<div style="text-align:center;padding:40px 16px;">'
        + '<i class="ph ph-calendar-check" style="font-size:36px;color:rgba(255,255,255,0.2);display:block;margin-bottom:12px;"></i>'
        + '<div style="font-size:13px;font-weight:600;color:var(--text-3,#94a3b8);margin-bottom:4px;">No upcoming payments</div>'
        + '<div style="font-size:11px;color:var(--text-3,#94a3b8);line-height:1.5;">Add debts or recurring bills<br/>to see your schedule here.</div>'
        + '</div>';
      return;
    }
    var now = new Date(); now.setHours(0,0,0,0);
    var total7  = items.filter(function (i) { return i.daysUntil >= 0 && i.daysUntil <= 7; }).reduce(function (s, i) { return s + (i.amount || 0); }, 0);
    var total30 = items.filter(function (i) { return i.daysUntil >= 0 && i.daysUntil <= 30; }).reduce(function (s, i) { return s + (i.amount || 0); }, 0);

    var visible = EXPANDED ? items : items.slice(0, COLLAPSED_LIMIT);
    var hidden = items.length - visible.length;

    var summaryHTML = ''
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
      + '<div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.30);border-radius:8px;padding:8px 12px;">'
      +   '<div style="font-size:9px;font-weight:800;letter-spacing:0.10em;color:#f59e0b;text-transform:uppercase;">Next 7 days</div>'
      +   '<div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">' + fmtUSD(total7) + '</div>'
      + '</div>'
      + '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:8px;padding:8px 12px;">'
      +   '<div style="font-size:9px;font-weight:800;letter-spacing:0.10em;color:#10b981;text-transform:uppercase;">This month</div>'
      +   '<div style="font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">' + fmtUSD(total30) + '</div>'
      + '</div>'
      + '</div>';

    var rowsHTML = visible.map(function (item) {
      var s = statusFor(item, now);
      var icon = iconFor(item);
      var apr = item.apr ? ' · ' + Number(item.apr).toFixed(2) + '% APR' : '';
      var paidHint = item.lastPaidDate ? ' · last paid ' + item.lastPaidDate : '';
      return ''
        + '<div class="upcoming-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;background:var(--card-2,rgba(255,255,255,0.04));border-radius:8px;border-left:3px solid ' + s.color + ';">'
        + '<div style="width:32px;height:32px;border-radius:7px;background:' + s.bg + ';display:grid;place-items:center;color:' + s.color + ';flex-shrink:0;"><i class="ph ' + icon + '" style="font-size:16px;"></i></div>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="font-size:12.5px;font-weight:700;color:var(--ink, var(--text-1, #0a0a0a));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(item.name) + '</div>'
        +   '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:1px;">' + daysCopy(item.daysUntil) + ' · ' + fmtDate(item.dueDate) + apr + paidHint + '</div>'
        + (item.lastPossibleMatch
            ? '<div style="font-size:10px;color:#0891b2;font-weight:600;margin-top:3px;background:rgba(8,145,178,0.10);padding:2px 6px;border-radius:4px;display:inline-block;"><i class="ph-fill ph-magnifying-glass" style="font-size:10px;"></i> Possible match: ' + escapeHTML(item.lastPossibleMatch.merchant) + ' ($' + Math.round(item.lastPossibleMatch.amount) + ' on ' + item.lastPossibleMatch.date + ')</div>'
            : '')
        + '</div>'
        + '<div style="text-align:right;flex-shrink:0;">'
        +   '<div style="font-size:13px;font-weight:800;color:var(--ink, var(--text-1, #0a0a0a));">' + fmtUSD(item.amount) + '</div>'
        +   '<span style="display:inline-block;margin-top:2px;font-size:8.5px;letter-spacing:0.06em;font-weight:800;padding:2px 6px;border-radius:999px;background:' + s.bg + ';color:' + s.color + ';">' + s.label + '</span>'
        + '</div>'
        + '</div>';
    }).join('');

    var expandHTML = hidden > 0
      ? '<button id="wjp-upcoming-expand" style="width:100%;margin-top:4px;background:transparent;border:1px dashed var(--border,rgba(255,255,255,0.10));color:var(--text-3,#94a3b8);padding:8px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Show ' + hidden + ' more</button>'
      : (EXPANDED && items.length > COLLAPSED_LIMIT
          ? '<button id="wjp-upcoming-expand" style="width:100%;margin-top:4px;background:transparent;border:1px dashed var(--border,rgba(255,255,255,0.10));color:var(--text-3,#94a3b8);padding:8px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Show fewer</button>'
          : '');

    host.innerHTML = summaryHTML + rowsHTML + expandHTML;
    host.style.overflow = 'visible';
    var btn = host.querySelector('#wjp-upcoming-expand');
    if (btn) btn.onclick = function () { EXPANDED = !EXPANDED; renderInto(host); };
  }

  function install() {
    if (typeof window.renderUpcomingList !== 'function') return false;
    window._wjpHostUpcomingList = window._wjpHostUpcomingList || window.renderUpcomingList;
    window.renderUpcomingList = function () {
      try {
        var host = document.getElementById('upcoming-list-view');
        if (!host) return window._wjpHostUpcomingList && window._wjpHostUpcomingList();
        renderInto(host);
      } catch (e) {
        try { console.warn('[wjp-upcoming] renderInto threw, falling back', e); } catch (_) {}
        try { window._wjpHostUpcomingList && window._wjpHostUpcomingList(); } catch (_) {}
      }
    };
    try { window.renderUpcomingList(); } catch (_) {}
    return true;
  }

  function waitForHost() { if (install()) return; setTimeout(waitForHost, 400); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(waitForHost, 800); });
  else setTimeout(waitForHost, 800);

  setInterval(function () {
    try {
      var host = document.getElementById('upcoming-list-view');
      if (host) renderInto(host);
    } catch (_) {}
  }, 5000);

  window.WJP_UpcomingPayments = { items: buildItems, render: function () {
    var h = document.getElementById('upcoming-list-view');
    if (h) renderInto(h);
  }};
})();
