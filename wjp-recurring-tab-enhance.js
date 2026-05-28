/* wjp-recurring-tab-enhance.js v1 — bring the Recurring Payments tab to
 * feature-parity with the Transactions tab.
 *
 * Winston 2026-05-28:
 *   "recurring transaction box needs to look like transactions tab with
 *    all its features but meant for recurring only"
 *   "also include a smart summary box like transaction tab has but for
 *    recurring"
 *
 * What this adds, in order, above the existing recurring table:
 *   1. Smart Summary card — period pills (Today/This week/This month/
 *      This year/All time) + Monthly outflow / Income / Net cashflow /
 *      Next-due metrics, computed across appState.recurringPayments.
 *   2. Search bar + Status/Frequency/Type filter dropdowns matching the
 *      Transactions tab look (rounded inputs, same spacing).
 *
 * Stays out of the way:
 *   - Does NOT replace the existing #rec-table render. The chips +
 *     pagination + edit/delete buttons continue to work as before.
 *   - Filter state is folded into the host renderer when possible via a
 *     simple DOM-level filter pass — rows that don't match get hidden.
 *
 * Safe: IIFE, idempotent install, bare `appState` access, try/catch
 * wrapped. Universal — no hardcoded merchant/category names.
 */
(function () {
  'use strict';
  if (window._wjpRecurringTabEnhanceInstalled) return;
  window._wjpRecurringTabEnhanceInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var SUMMARY_ID = 'wjp-rec-smart-summary';
  var FILTERS_ID = 'wjp-rec-filter-bar';
  var LS_PERIOD = 'wjp.rec.summary.period.v1';
  var LS_SEARCH = 'wjp.rec.search.v1';
  var LS_STATUS = 'wjp.rec.filter.status.v1';
  var LS_FREQ   = 'wjp.rec.filter.freq.v1';

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function fmtUsd(n) {
    n = Number(n) || 0;
    return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function lsGet(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v == null ? '' : String(v)); } catch (_) {} }

  // ────────── normalize frequency to monthly multiplier ──────────
  function monthlyMult(freq) {
    switch (String(freq || 'monthly').toLowerCase()) {
      case 'weekly':       return 52/12;
      case 'biweekly':     return 26/12;
      case 'semimonthly':  return 2;
      case 'monthly':      return 1;
      case 'quarterly':    return 1/3;
      case 'annually':
      case 'yearly':       return 1/12;
      default:             return 1;
    }
  }
  function inferType(rp) {
    var c = String(rp.category || rp.cat || '').toLowerCase();
    if (c === 'income' || rp.linkedIncome) return 'income';
    if (c === 'debt') return 'debt';
    if (c === 'subscription' || c === 'membership') return 'subscription';
    if (c === 'utility') return 'utility';
    if (c === 'insurance') return 'insurance';
    if (c === 'rent') return 'rent';
    if ((Number(rp.amount) || 0) > 0) return 'income';
    return 'other';
  }

  // ────────── styles ──────────
  function injectStyle() {
    if (document.getElementById('wjp-rec-enhance-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-rec-enhance-style';
    st.textContent = [
      '#' + SUMMARY_ID + '{background:var(--card-bg, var(--bg-2, #fff));color:var(--ink, var(--text-1, #0a0a0a));border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:14px;padding:20px 22px;margin:0 0 14px 0;font-family:inherit;font-size:13px;}',
      '#' + SUMMARY_ID + ' .head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;}',
      '#' + SUMMARY_ID + ' .title{font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));}',
      '#' + SUMMARY_ID + ' .sub{font-size:11px;color:var(--ink-dim, #6b7280);margin-top:2px;}',
      '#' + SUMMARY_ID + ' .periods{display:inline-flex;gap:4px;padding:3px;background:var(--bg-3, rgba(0,0,0,0.04));border-radius:999px;}',
      '#' + SUMMARY_ID + ' .periods button{padding:5px 11px;border-radius:999px;border:none;background:transparent;color:var(--ink-dim, #6b7280);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}',
      '#' + SUMMARY_ID + ' .periods button.active{background:var(--bg-1, #fff);color:var(--ink, #1f1a14);box-shadow:0 1px 2px rgba(0,0,0,0.08);}',
      '#' + SUMMARY_ID + ' .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}',
      '#' + SUMMARY_ID + ' .stat{padding:12px;border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:10px;background:var(--bg-2, rgba(0,0,0,0.02));}',
      '#' + SUMMARY_ID + ' .stat .lbl{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);}',
      '#' + SUMMARY_ID + ' .stat .val{font-size:20px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));margin-top:4px;}',
      '#' + SUMMARY_ID + ' .stat .sub2{font-size:10px;color:var(--ink-dim, #6b7280);margin-top:2px;}',
      '#' + SUMMARY_ID + ' .stat.pos .val{color:#1f7a4a;}',
      '#' + SUMMARY_ID + ' .stat.neg .val{color:#c0594a;}',
      '@media (max-width: 700px){#' + SUMMARY_ID + ' .stats{grid-template-columns:repeat(2,1fr);}}',
      // Dark mode parity (body.dark)
      'body.dark #' + SUMMARY_ID + '{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);color:#e7e7ea;}',
      'body.dark #' + SUMMARY_ID + ' .title{color:#f4f4f6;}',
      'body.dark #' + SUMMARY_ID + ' .sub, body.dark #' + SUMMARY_ID + ' .stat .lbl, body.dark #' + SUMMARY_ID + ' .stat .sub2{color:rgba(255,255,255,0.55);}',
      'body.dark #' + SUMMARY_ID + ' .stat{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);}',
      'body.dark #' + SUMMARY_ID + ' .stat .val{color:#f4f4f6;}',
      'body.dark #' + SUMMARY_ID + ' .periods{background:rgba(255,255,255,0.05);}',
      'body.dark #' + SUMMARY_ID + ' .periods button{color:rgba(255,255,255,0.55);}',
      'body.dark #' + SUMMARY_ID + ' .periods button.active{background:rgba(255,255,255,0.10);color:#f4f4f6;box-shadow:none;}',

      '#' + FILTERS_ID + '{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px 0;}',
      '#' + FILTERS_ID + ' input[type="text"]{flex:1 1 240px;min-width:200px;padding:9px 12px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:10px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, #1f1a14);}',
      '#' + FILTERS_ID + ' select{padding:9px 30px 9px 12px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:10px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, #1f1a14);cursor:pointer;}',
      'body.dark #' + FILTERS_ID + ' input[type="text"], body.dark #' + FILTERS_ID + ' select{background:rgba(255,255,255,0.05);color:#f4f4f6;border-color:rgba(255,255,255,0.12);}',
      'body.dark #' + FILTERS_ID + ' input[type="text"]::placeholder{color:rgba(255,255,255,0.40);}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── period helpers ──────────
  function periodRange(key) {
    var now = new Date();
    var since = 0, label = 'All time';
    if (key === 'day')   { since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); label = 'Today'; }
    else if (key === 'week') { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - d.getDay()); since = d.getTime(); label = 'This week'; }
    else if (key === 'month') { since = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); label = 'This month'; }
    else if (key === 'year')  { since = new Date(now.getFullYear(), 0, 1).getTime(); label = 'This year'; }
    return { since: since, label: label };
  }
  function periodMultiplier(key) {
    // For the "expected outflow/income over this period" math.
    // Monthly per-rp amount * multiplier = period total.
    switch (key) {
      case 'day':   return 1/30;
      case 'week':  return 12/52;
      case 'month': return 1;
      case 'year':  return 12;
      default:      return 12; // "all time" treated as annual for stat display
    }
  }

  // ────────── build the Smart Summary card ──────────
  function buildSummaryHtml() {
    var s = getState();
    var rps = (s && Array.isArray(s.recurringPayments)) ? s.recurringPayments : [];
    var periodKey = lsGet(LS_PERIOD, 'month');
    var period = periodRange(periodKey);
    var mult = periodMultiplier(periodKey);

    var income = 0, debt = 0, subs = 0, other = 0, count = 0;
    rps.forEach(function (rp) {
      if (!rp) return;
      var amt = Math.abs(Number(rp.amount) || 0);
      if (amt <= 0) return;
      var monthly = amt * monthlyMult(rp.frequency);
      var periodAmt = monthly * mult;
      var type = inferType(rp);
      count++;
      if (type === 'income') income += periodAmt;
      else if (type === 'debt') debt += periodAmt;
      else if (type === 'subscription') subs += periodAmt;
      else other += periodAmt;
    });
    var totalOutflow = debt + subs + other;
    var net = income - totalOutflow;

    // Find next-due payment
    var nextDue = null;
    rps.forEach(function (rp) {
      if (!rp || !rp.nextDate) return;
      var ms = new Date(String(rp.nextDate).slice(0, 10) + 'T12:00:00').getTime();
      if (!ms) return;
      if (!nextDue || ms < nextDue.ms) nextDue = { rp: rp, ms: ms };
    });
    var nextDueStr = 'None scheduled';
    var nextDueSub = '';
    if (nextDue) {
      var days = Math.max(0, Math.round((nextDue.ms - Date.now()) / 86400000));
      var name = String(nextDue.rp.name || 'Recurring').slice(0, 22);
      nextDueStr = days === 0 ? 'Today' : (days === 1 ? 'Tomorrow' : days + ' days');
      nextDueSub = name + ' · ' + fmtUsd(Math.abs(Number(nextDue.rp.amount) || 0));
    }

    var periodPills = [['day','Today'],['week','This week'],['month','This month'],['year','This year'],['all','All time']]
      .map(function (p) {
        return '<button type="button" data-rec-period="' + p[0] + '"' + (periodKey === p[0] ? ' class="active"' : '') + '>' + p[1] + '</button>';
      }).join('');

    return '<div id="' + SUMMARY_ID + '">' +
      '<div class="head">' +
        '<div>' +
          '<div class="title">Smart Summary</div>' +
          '<div class="sub">' + count + ' schedule' + (count === 1 ? '' : 's') + ' · ' + period.label.toLowerCase() + ' projection</div>' +
        '</div>' +
        '<div class="periods">' + periodPills + '</div>' +
      '</div>' +
      '<div class="stats">' +
        '<div class="stat pos">' +
          '<div class="lbl">Income</div>' +
          '<div class="val">+' + fmtUsd(income) + '</div>' +
          '<div class="sub2">across ' + period.label.toLowerCase() + '</div>' +
        '</div>' +
        '<div class="stat neg">' +
          '<div class="lbl">Outflow</div>' +
          '<div class="val">-' + fmtUsd(totalOutflow) + '</div>' +
          '<div class="sub2">debt ' + fmtUsd(debt) + ' · subs ' + fmtUsd(subs) + ' · other ' + fmtUsd(other) + '</div>' +
        '</div>' +
        '<div class="stat ' + (net >= 0 ? 'pos' : 'neg') + '">' +
          '<div class="lbl">Net cashflow</div>' +
          '<div class="val">' + (net >= 0 ? '+' : '-') + fmtUsd(net) + '</div>' +
          '<div class="sub2">' + (net >= 0 ? 'surplus' : 'shortfall') + '</div>' +
        '</div>' +
        '<div class="stat">' +
          '<div class="lbl">Next due</div>' +
          '<div class="val">' + nextDueStr + '</div>' +
          '<div class="sub2">' + (nextDueSub || '—') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildFilterBarHtml() {
    var search = lsGet(LS_SEARCH, '');
    var status = lsGet(LS_STATUS, 'all');
    var freq = lsGet(LS_FREQ, 'all');
    return '<div id="' + FILTERS_ID + '">' +
      '<input type="text" id="wjp-rec-search" placeholder="Search recurring…" value="' + htmlEscape(search) + '" />' +
      '<select id="wjp-rec-status">' +
        '<option value="all"' + (status === 'all' ? ' selected' : '') + '>Status: All</option>' +
        '<option value="cleared"' + (status === 'cleared' ? ' selected' : '') + '>Cleared</option>' +
        '<option value="pending"' + (status === 'pending' ? ' selected' : '') + '>Pending</option>' +
        '<option value="no-match"' + (status === 'no-match' ? ' selected' : '') + '>No match yet</option>' +
      '</select>' +
      '<select id="wjp-rec-frequency">' +
        '<option value="all"' + (freq === 'all' ? ' selected' : '') + '>Frequency: All</option>' +
        '<option value="weekly"' + (freq === 'weekly' ? ' selected' : '') + '>Weekly</option>' +
        '<option value="biweekly"' + (freq === 'biweekly' ? ' selected' : '') + '>Bi-weekly</option>' +
        '<option value="monthly"' + (freq === 'monthly' ? ' selected' : '') + '>Monthly</option>' +
        '<option value="quarterly"' + (freq === 'quarterly' ? ' selected' : '') + '>Quarterly</option>' +
        '<option value="annually"' + (freq === 'annually' ? ' selected' : '') + '>Annually / Yearly</option>' +
      '</select>' +
    '</div>';
  }

  function applyDomFilter() {
    var search = lsGet(LS_SEARCH, '').toLowerCase().trim();
    var status = lsGet(LS_STATUS, 'all');
    var freq = lsGet(LS_FREQ, 'all').toLowerCase();
    var s = getState();
    var rps = (s && Array.isArray(s.recurringPayments)) ? s.recurringPayments : [];

    var tbody = document.getElementById('rec-tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr[data-rec-id], tr[data-id], tr');
    Array.prototype.forEach.call(rows, function (tr) {
      if (!tr || tr.style.display === 'none-locked') return;
      var id = tr.getAttribute('data-rec-id') || tr.getAttribute('data-id') || '';
      var rp = rps.find(function (r) { return r && String(r.id) === String(id); });
      var rowText = (tr.textContent || '').toLowerCase();
      var matchesSearch = !search || rowText.indexOf(search) !== -1;
      var matchesFreq = freq === 'all' || (rp && String(rp.frequency || '').toLowerCase() === freq);
      var matchesStatus = true;
      if (status !== 'all' && rp) {
        if (status === 'no-match') {
          matchesStatus = !rp.openTxnId && !(Array.isArray(rp.linkedTxnIds) && rp.linkedTxnIds.length);
        } else if (status === 'cleared') {
          matchesStatus = Array.isArray(rp.linkedTxnIds) && rp.linkedTxnIds.length > 0;
        } else if (status === 'pending') {
          matchesStatus = !!rp.openTxnId;
        }
      }
      var visible = matchesSearch && matchesFreq && matchesStatus;
      tr.style.display = visible ? '' : 'none';
    });
  }

  function wireFilterBar(root) {
    var inp = root.querySelector('#wjp-rec-search');
    if (inp) {
      var t;
      inp.oninput = function () {
        lsSet(LS_SEARCH, inp.value);
        clearTimeout(t);
        t = setTimeout(applyDomFilter, 150);
      };
    }
    var statusSel = root.querySelector('#wjp-rec-status');
    if (statusSel) statusSel.onchange = function () { lsSet(LS_STATUS, statusSel.value); applyDomFilter(); };
    var freqSel = root.querySelector('#wjp-rec-frequency');
    if (freqSel) freqSel.onchange = function () { lsSet(LS_FREQ, freqSel.value); applyDomFilter(); };
  }

  // ────────── mount / refresh ──────────
  function mount() {
    injectStyle();
    var sub = document.querySelector('.debts-subtab-content[data-subtab="recurring"]');
    if (!sub) return false;

    // Find the existing #rec-table card so we anchor above it
    var anchor = sub.querySelector('#rec-stats-bar') || sub.querySelector('#rec-table') || null;
    if (anchor && anchor.tagName === 'TABLE') {
      anchor = anchor.closest('.card') || anchor;
    }

    // Smart Summary
    var existing = document.getElementById(SUMMARY_ID);
    var html = buildSummaryHtml();
    if (existing) {
      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      existing.replaceWith(wrap.firstElementChild);
    } else {
      var wrap2 = document.createElement('div');
      wrap2.innerHTML = html;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap2.firstElementChild, anchor);
      else sub.insertBefore(wrap2.firstElementChild, sub.firstChild);
    }
    // Wire period pills
    Array.prototype.forEach.call(document.querySelectorAll('#' + SUMMARY_ID + ' [data-rec-period]'), function (b) {
      b.onclick = function () {
        lsSet(LS_PERIOD, b.getAttribute('data-rec-period'));
        mount();
      };
    });

    // Filter bar
    var existingF = document.getElementById(FILTERS_ID);
    var fhtml = buildFilterBarHtml();
    if (existingF) {
      var fwrap = document.createElement('div');
      fwrap.innerHTML = fhtml;
      existingF.replaceWith(fwrap.firstElementChild);
      wireFilterBar(document.getElementById(FILTERS_ID));
    } else {
      var fwrap2 = document.createElement('div');
      fwrap2.innerHTML = fhtml;
      var fnode = fwrap2.firstElementChild;
      var afterSummary = document.getElementById(SUMMARY_ID);
      if (afterSummary && afterSummary.parentNode) afterSummary.parentNode.insertBefore(fnode, afterSummary.nextSibling);
      else if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(fnode, anchor);
      wireFilterBar(fnode);
    }

    applyDomFilter();
    return true;
  }

  function boot() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (mount() || attempts > 40) clearInterval(iv);
    }, 1000);
    // Re-render when state changes
    window.addEventListener('wjp-recurring-changed', function () { setTimeout(mount, 200); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(mount, 400); });
    window.addEventListener('wjp-categories-changed', function () { setTimeout(mount, 400); });
    // Re-apply DOM filter when host re-renders the table
    setInterval(applyDomFilter, 3000);
    setInterval(mount, 30000); // periodic Smart Summary refresh
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_RecurringTabEnhance = { version: 1, mount: mount, applyDomFilter: applyDomFilter };
})();
