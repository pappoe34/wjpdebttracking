/* wjp-spend-by-bill.js v1 — Spend by Bill card on Transactions tab.
 *
 * Winston FIX 39: existing "Bill history" modal data shown as a permanent
 * card next to Billing History. Lists each merchant with total spend
 * for the active period (shared with Billing History — same LS key).
 *
 * Mounts inside #wjp-billing-row (the flex row Billing History creates) so
 * the two cards sit side-by-side.
 *
 * Universal — works for any user. Pure appState driven. Excludes
 * transfers + income. Click a merchant → expands to show transactions.
 */
(function () {
  'use strict';
  if (window._wjpSpendByBillInstalled) return;
  window._wjpSpendByBillInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CARD_ID = 'wjp-spend-by-bill-card';
  var LS_KEY = 'wjp.billing_history.period.v1'; // shared with billing-history
  var LS_SEARCH = 'wjp.spend_by_bill.search.v1';

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    n = Number(n) || 0;
    return '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtDateShort(s) {
    if (!s) return '';
    try { var d = new Date(String(s).slice(0,10) + 'T12:00:00'); return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }); } catch (_) { return s; }
  }
  function isTransferLike(t) {
    if (!t) return true;
    if (t.userCategoryId === 'transfer' || t.userCategoryId === 'income') return true;
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var fields = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(fields);
  }

  // Period — shared with Billing History
  function periodRange(p) {
    var now = new Date();
    var since = 0, label = 'All time';
    if (p === 'day')   { since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); label = 'Today'; }
    else if (p === 'week') { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - d.getDay()); since = d.getTime(); label = 'This week'; }
    else if (p === 'month') { since = new Date(now.getFullYear(), now.getMonth(), 1).getTime(); label = 'This month'; }
    else if (p === 'year')  { since = new Date(now.getFullYear(), 0, 1).getTime(); label = 'This year'; }
    return { since: since, label: label };
  }
  function getPeriod() { try { return localStorage.getItem(LS_KEY) || 'month'; } catch (_) { return 'month'; } }
  function getSearch() { try { return localStorage.getItem(LS_SEARCH) || ''; } catch (_) { return ''; } }
  function setSearch(v) { try { localStorage.setItem(LS_SEARCH, v); } catch (_) {} }

  // Canon merchant key — share style with smart-categorize but lighter
  function canonMerchant(name) {
    if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.canonMerchant) {
      return window.WJP_TxSmartCategorize.canonMerchant(name);
    }
    if (!name) return '';
    return String(name).toLowerCase()
      .replace(/[0-9#@*]+/g, ' ')
      .replace(/\b(inc|llc|ltd|co|corp|company|store|locat|pos|debit|credit|purchase|pmt|payment|online|web|app)\b/g, ' ')
      .replace(/[^a-z\s]+/g, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (w) { return w.length >= 2; }).slice(0, 3).join(' ');
  }

  // ───────── styles ─────────
  function injectStyle() {
    if (document.getElementById('wjp-spend-by-bill-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-spend-by-bill-style';
    st.textContent = [
      '#' + CARD_ID + '{background:var(--card-bg, var(--bg-2, #fff));color:var(--ink, var(--text-1, #0a0a0a));border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:14px;padding:18px 20px;font-family:inherit;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,0.04);}',
      '#' + CARD_ID + ' .head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;}',
      '#' + CARD_ID + ' .title{font-size:14px;font-weight:700;color:var(--ink, var(--text-1, #1f1a14));margin-bottom:2px;}',
      '#' + CARD_ID + ' .sub{font-size:11px;color:var(--ink-dim, #6b7280);font-weight:500;}',
      '#' + CARD_ID + ' .total{font-size:22px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));}',
      '#' + CARD_ID + ' .total-label{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);}',
      '#' + CARD_ID + ' .search{display:flex;gap:8px;margin:10px 0;align-items:center;}',
      '#' + CARD_ID + ' .search input{flex:1;padding:8px 12px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:8px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, #1f1a14);}',
      '#' + CARD_ID + ' .list{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow:auto;}',
      '#' + CARD_ID + ' .m-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;cursor:pointer;}',
      '#' + CARD_ID + ' .m-row:hover{background:var(--bg-3, rgba(0,0,0,0.04));}',
      '#' + CARD_ID + ' .m-row .nm{flex:1;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + CARD_ID + ' .m-row .cnt{color:var(--ink-dim, #6b7280);font-size:11px;flex-shrink:0;}',
      '#' + CARD_ID + ' .m-row .amt{font-weight:700;font-size:13px;color:var(--ink, #1f1a14);min-width:90px;text-align:right;}',
      '#' + CARD_ID + ' .empty{padding:16px;text-align:center;font-size:12px;color:var(--ink-dim, #6b7280);}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function buildCardHtml() {
    var periodKey = getPeriod();
    var period = periodRange(periodKey);
    var search = getSearch();
    var q = search.toLowerCase().trim();

    var s = getState();
    var byMerchant = {};
    var total = 0;
    if (s && Array.isArray(s.transactions)) {
      s.transactions.forEach(function (t) {
        if (!t) return;
        var ts = t.date ? new Date(String(t.date).slice(0,10) + 'T12:00:00').getTime() : 0;
        if (ts < period.since) return;
        if (isTransferLike(t)) return;
        var amt = Number(t.amount) || 0;
        if (amt >= 0) return;
        var displayName = String(t.merchant || t.name || 'Unknown').slice(0, 60);
        var key = canonMerchant(displayName) || displayName.toLowerCase();
        if (!byMerchant[key]) byMerchant[key] = { key: key, name: displayName, amount: 0, count: 0 };
        byMerchant[key].amount += Math.abs(amt);
        byMerchant[key].count++;
        total += Math.abs(amt);
      });
    }

    var rows = Object.keys(byMerchant).map(function (k) { return byMerchant[k]; });
    if (q) {
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1; });
    }
    rows.sort(function (a, b) { return b.amount - a.amount; });
    rows = rows.slice(0, 100); // cap at 100 for perf

    var listHtml = rows.length
      ? rows.map(function (r) {
          return '<div class="m-row" data-merchant-key="' + htmlEscape(r.key) + '" data-merchant-name="' + htmlEscape(r.name) + '" title="Click for details">' +
            '<span class="nm">' + htmlEscape(r.name) + '</span>' +
            '<span class="cnt">' + r.count + (r.count === 1 ? ' txn' : ' txns') + '</span>' +
            '<span class="amt">' + fmtUsd(r.amount) + '</span>' +
          '</div>';
        }).join('')
      : '<div class="empty">' + (q ? 'No bills match "' + htmlEscape(q) + '".' : 'No bills in ' + period.label.toLowerCase() + '.') + '</div>';

    return '<div id="' + CARD_ID + '">' +
      '<div class="head">' +
        '<div>' +
          '<div class="title">Spend by Bill</div>' +
          '<div class="sub">Each merchant\'s total for ' + period.label + '. Transfers and income excluded.</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div class="total-label">' + period.label + ' total</div>' +
          '<div class="total">' + fmtUsd(total) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="search">' +
        '<input type="text" id="wjp-sbb-search" placeholder="Search bills…" value="' + htmlEscape(search) + '" />' +
      '</div>' +
      '<div class="list">' + listHtml + '</div>' +
    '</div>';
  }

  // ───────── mount/refresh ─────────
  var _scheduled = false;
  function refresh() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(function () {
      _scheduled = false;
      try { doRefresh(); } catch (_) {}
    }, 150);
  }
  function doRefresh() {
    injectStyle();
    var sub = document.querySelector('.debts-subtab-content[data-subtab="transactions"]');
    if (!sub || !sub.classList.contains('active')) {
      var stale = document.getElementById(CARD_ID);
      if (stale) stale.remove();
      return;
    }
    var row = sub.querySelector('#wjp-billing-row');
    if (!row) return; // Billing History hasn't mounted yet; will refresh next tick
    var existing = document.getElementById(CARD_ID);
    var activeSearch = document.activeElement && document.activeElement.id === 'wjp-sbb-search';
    if (existing && activeSearch) return;
    var sig = getPeriod() + ':' + getSearch() + ':' + ((getState() && getState().transactions) ? getState().transactions.length : 0) + ':' + (Date.now() - (Date.now() % 60000));
    if (existing && existing.getAttribute('data-sig') === sig) return;

    var wrapper = document.createElement('div');
    wrapper.innerHTML = buildCardHtml();
    var card = wrapper.firstElementChild;
    card.setAttribute('data-sig', sig);
    card.style.flex = '1 1 380px';
    card.style.margin = '0';

    if (existing) {
      existing.replaceWith(card);
    } else {
      row.appendChild(card);
    }
    wireCard(card);
  }

  function wireCard(card) {
    var inp = card.querySelector('#wjp-sbb-search');
    if (inp) {
      var t;
      inp.oninput = function () {
        setSearch(inp.value);
        clearTimeout(t);
        t = setTimeout(function () {
          var c = document.getElementById(CARD_ID);
          if (c) c.removeAttribute('data-sig');
          refresh();
        }, 200);
      };
      inp.onblur = function () { setTimeout(refresh, 100); };
    }
    // Wire row clicks → detail modal
    Array.prototype.forEach.call(card.querySelectorAll('.m-row[data-merchant-key]'), function (row) {
      row.style.cursor = 'pointer';
      row.onclick = function () {
        var key = row.getAttribute('data-merchant-key');
        var name = row.getAttribute('data-merchant-name');
        openMerchantDetail(key, name);
      };
    });
  }

  // ───────── merchant detail modal ─────────
  // Matches the Smart Summary 'Bill history' modal: 4 stat cards
  // (THIS WEEK / THIS MONTH / THIS YEAR / ALL TIME) for the picked
  // merchant + a sortable list of recent transactions.
  var MODAL_ID = 'wjp-sbb-detail-modal';
  function injectModalStyle() {
    if (document.getElementById('wjp-sbb-modal-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-sbb-modal-style';
    st.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99994;display:flex;align-items:center;justify-content:center;padding:20px;}',
      '#' + MODAL_ID + ' .panel{background:var(--bg-1,#fff);color:var(--ink,#0a0a0a);border-radius:14px;padding:18px;max-width:640px;width:100%;max-height:84vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.30);}',
      '#' + MODAL_ID + ' .head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;}',
      '#' + MODAL_ID + ' h3{margin:0;font-size:16px;}',
      '#' + MODAL_ID + ' .sub{color:var(--ink-dim,#6b7280);font-size:11px;margin-bottom:14px;}',
      '#' + MODAL_ID + ' .x{background:transparent;border:none;font-size:20px;line-height:1;cursor:pointer;color:var(--ink-dim,#6b7280);padding:0 4px;}',
      '#' + MODAL_ID + ' .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}',
      '#' + MODAL_ID + ' .stat{padding:10px 12px;border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:10px;background:var(--bg-2, rgba(0,0,0,0.02));}',
      '#' + MODAL_ID + ' .stat .lbl{font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim,#6b7280);}',
      '#' + MODAL_ID + ' .stat .val{font-size:15px;font-weight:800;color:var(--ink,#1f1a14);margin-top:2px;}',
      '#' + MODAL_ID + ' .stat .cnt{font-size:10px;color:var(--ink-dim,#6b7280);margin-top:2px;}',
      '#' + MODAL_ID + ' .list-head{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim,#6b7280);margin-bottom:6px;}',
      '#' + MODAL_ID + ' .txns{flex:1;overflow:auto;border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:10px;}',
      '#' + MODAL_ID + ' .tx-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border, rgba(0,0,0,0.06));font-size:12px;}',
      '#' + MODAL_ID + ' .tx-row:last-child{border-bottom:none;}',
      '#' + MODAL_ID + ' .tx-row .d{color:var(--ink-dim,#6b7280);font-size:11px;flex-shrink:0;width:80px;}',
      '#' + MODAL_ID + ' .tx-row .m{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + MODAL_ID + ' .tx-row .src{font-size:10px;color:var(--ink-dim,#6b7280);}',
      '#' + MODAL_ID + ' .tx-row .a{font-weight:700;min-width:90px;text-align:right;}',
      '@media (max-width: 560px){#' + MODAL_ID + ' .stats{grid-template-columns:repeat(2,1fr);}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function closeMerchantDetail() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function openMerchantDetail(merchantKey, displayName) {
    closeMerchantDetail();
    injectModalStyle();
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return;
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startWeek = (function (){ var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() - d.getDay()); return d.getTime(); })();
    var startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var startYear = new Date(now.getFullYear(), 0, 1).getTime();

    var stats = {
      week: { amt: 0, cnt: 0 },
      month: { amt: 0, cnt: 0 },
      year: { amt: 0, cnt: 0 },
      all: { amt: 0, cnt: 0 }
    };
    var allTxns = [];
    s.transactions.forEach(function (t) {
      if (!t) return;
      if (isTransferLike(t)) return;
      var amt = Number(t.amount) || 0;
      if (amt >= 0) return;
      var name = String(t.merchant || t.name || '').slice(0, 60);
      var key = canonMerchant(name) || name.toLowerCase();
      if (key !== merchantKey) return;
      var absAmt = Math.abs(amt);
      var ts = t.date ? new Date(String(t.date).slice(0,10) + 'T12:00:00').getTime() : 0;
      stats.all.amt += absAmt; stats.all.cnt++;
      if (ts >= startYear)  { stats.year.amt += absAmt;  stats.year.cnt++; }
      if (ts >= startMonth) { stats.month.amt += absAmt; stats.month.cnt++; }
      if (ts >= startWeek)  { stats.week.amt += absAmt;  stats.week.cnt++; }
      allTxns.push(t);
    });
    allTxns.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    var recent = allTxns.slice(0, 30);

    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    function statCard(lbl, st) {
      return '<div class="stat"><div class="lbl">' + lbl + '</div><div class="val">' + fmtUsd(st.amt) + '</div><div class="cnt">' + st.cnt + (st.cnt === 1 ? ' txn' : ' txns') + '</div></div>';
    }
    var statsHtml = statCard('This Week', stats.week) + statCard('This Month', stats.month) + statCard('This Year', stats.year) + statCard('All Time', stats.all);
    var txnsHtml = recent.length
      ? recent.map(function (t) {
          var d = t.date ? new Date(String(t.date).slice(0,10) + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }) : '';
          var srcLabel = '';
          try {
            if (window.WJP_AcctLookup && t.plaidAccountId && window.WJP_AcctLookup[t.plaidAccountId]) {
              var info = window.WJP_AcctLookup[t.plaidAccountId];
              var nm = (info.userRenamed && info.userDisplayName) ? info.userDisplayName : (info.institutionName || 'Bank');
              if (nm.length > 22) nm = nm.slice(0, 22) + '…';
              srcLabel = info.mask ? (nm + ' ··' + info.mask) : nm;
            }
          } catch (_) {}
          var status = (t.status || 'completed').toLowerCase();
          return '<div class="tx-row">' +
            '<span class="d">' + htmlEscape(d) + '</span>' +
            '<span class="m">' + htmlEscape(t.merchant || t.name || 'Unknown') + (srcLabel ? '<br><span class="src">' + htmlEscape(srcLabel) + ' · ' + htmlEscape(status) + '</span>' : '') + '</span>' +
            '<span class="a" style="color:#c0594a;">-' + fmtUsd(Math.abs(t.amount)) + '</span>' +
          '</div>';
        }).join('')
      : '<div class="tx-row" style="color:var(--ink-dim,#6b7280);">No transactions found.</div>';

    modal.innerHTML =
      '<div class="panel">' +
        '<div class="head">' +
          '<div>' +
            '<h3>' + htmlEscape(displayName || 'Merchant') + '</h3>' +
            '<div class="sub">' + stats.all.cnt + ' transactions on record</div>' +
          '</div>' +
          '<button class="x" type="button" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="stats">' + statsHtml + '</div>' +
        '<div class="list-head">Recent transactions</div>' +
        '<div class="txns">' + txnsHtml + '</div>' +
      '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) closeMerchantDetail(); });
    document.body.appendChild(modal);
    modal.querySelector('.x').onclick = closeMerchantDetail;
  }

  function boot() {
    injectStyle();
    refresh();
    window.addEventListener('wjp-tx-rerendered', refresh);
    window.addEventListener('wjp-transactions-changed', refresh);
    window.addEventListener('wjp-categories-changed', refresh);
    window.addEventListener('wjp-tx-category-changed', refresh);
    // Also react when Billing History's period selector changes
    window.addEventListener('storage', function (e) {
      if (e && e.key === LS_KEY) refresh();
    });
    setInterval(refresh, 3000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_SpendByBill = { version: 1, refresh: refresh };
})();
