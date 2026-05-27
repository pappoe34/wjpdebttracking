/* wjp-billing-history.js v1 — Billing History card on the Transactions tab.
 *
 * Winston: FIX 28 — "Billing History as its own card with category
 * search/filter (totals across day/week/month/year)."
 *
 * Injects a standalone card after the Smart Summary block on the Debts
 * → Transactions sub-tab. The card has:
 *   • Period selector pills: Today, This week, This month, This year, All time
 *   • Category search input (filters the list below)
 *   • Sorted list of every category with: color swatch, name, txn count,
 *     total spend for the period.
 *   • Big total at the top.
 *
 * Uses window.WJP_Categories.spendingByCategory({since, until}) — which
 * already filters transfers + income out of spending totals.
 *
 * Universal — works for any user. No hardcoded categories. Polling tick
 * (no MutationObserver to avoid feedback loops).
 */
(function () {
  'use strict';
  if (window._wjpBillingHistoryInstalled) return;
  window._wjpBillingHistoryInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CARD_ID = 'wjp-billing-history-card';
  var LS_KEY = 'wjp.billing_history.period.v1';

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

  // ───────── period helpers ─────────
  function periodRange(p) {
    var now = new Date();
    var since = 0, until = Infinity, label = 'All time';
    if (p === 'day') {
      var s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      since = s.getTime();
      label = 'Today';
    } else if (p === 'week') {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // Week starts Sunday
      d.setDate(d.getDate() - d.getDay());
      since = d.getTime();
      label = 'This week';
    } else if (p === 'month') {
      since = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      label = 'This month';
    } else if (p === 'year') {
      since = new Date(now.getFullYear(), 0, 1).getTime();
      label = 'This year';
    } else {
      label = 'All time';
    }
    return { since: since, until: until, label: label };
  }

  function getPeriod() {
    try { return localStorage.getItem(LS_KEY) || 'month'; } catch (_) { return 'month'; }
  }
  function setPeriod(v) {
    try { localStorage.setItem(LS_KEY, v); } catch (_) {}
  }

  // ───────── styles ─────────
  function injectStyle() {
    if (document.getElementById('wjp-billing-history-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-billing-history-style';
    st.textContent = [
      '#' + CARD_ID + '{background:var(--card-bg, var(--bg-2, #fff));color:var(--ink, var(--text-1, #0a0a0a));border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:14px;padding:18px 20px;margin:14px 0 18px 0;font-family:inherit;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,0.04);}',
      '#' + CARD_ID + ' .head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px;}',
      '#' + CARD_ID + ' .title{font-size:14px;font-weight:700;color:var(--ink, var(--text-1, #1f1a14));margin-bottom:2px;}',
      '#' + CARD_ID + ' .sub{font-size:11px;color:var(--ink-dim, #6b7280);font-weight:500;}',
      '#' + CARD_ID + ' .total{font-size:22px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));}',
      '#' + CARD_ID + ' .total-label{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);}',
      '#' + CARD_ID + ' .periods{display:inline-flex;gap:4px;padding:3px;background:var(--bg-3, rgba(0,0,0,0.04));border-radius:999px;}',
      '#' + CARD_ID + ' .periods button{padding:5px 11px;border-radius:999px;border:none;background:transparent;color:var(--ink-dim, #6b7280);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;}',
      '#' + CARD_ID + ' .periods button.active{background:var(--bg-1, #fff);color:var(--ink, #1f1a14);box-shadow:0 1px 2px rgba(0,0,0,0.08);}',
      '#' + CARD_ID + ' .search{display:flex;gap:8px;margin-bottom:10px;align-items:center;}',
      '#' + CARD_ID + ' .search input{flex:1;padding:8px 12px;border:1px solid var(--border, rgba(0,0,0,0.15));border-radius:8px;font-size:12px;font-family:inherit;background:var(--bg-1, #fff);color:var(--ink, #1f1a14);}',
      '#' + CARD_ID + ' .search input::placeholder{color:var(--ink-dim, #6b7280);}',
      '#' + CARD_ID + ' .list{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow:auto;}',
      '#' + CARD_ID + ' .cat-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;}',
      '#' + CARD_ID + ' .cat-row:hover{background:var(--bg-3, rgba(0,0,0,0.04));}',
      '#' + CARD_ID + ' .cat-row .sw{width:10px;height:10px;border-radius:50%;flex-shrink:0;}',
      '#' + CARD_ID + ' .cat-row .nm{flex:1;font-weight:600;font-size:12px;}',
      '#' + CARD_ID + ' .cat-row .cnt{color:var(--ink-dim, #6b7280);font-size:11px;}',
      '#' + CARD_ID + ' .cat-row .amt{font-weight:700;font-size:13px;color:var(--ink, #1f1a14);min-width:80px;text-align:right;}',
      '#' + CARD_ID + ' .cat-row .bar{flex:0 0 80px;height:4px;background:var(--bg-3, rgba(0,0,0,0.06));border-radius:999px;overflow:hidden;}',
      '#' + CARD_ID + ' .cat-row .bar > div{height:100%;border-radius:999px;}',
      '#' + CARD_ID + ' .empty{padding:16px;text-align:center;font-size:12px;color:var(--ink-dim, #6b7280);}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───────── build card HTML ─────────
  function buildCardHtml(periodKey, search) {
    var period = periodRange(periodKey);
    var data = (window.WJP_Categories && window.WJP_Categories.spendingByCategory)
      ? window.WJP_Categories.spendingByCategory({ since: period.since, until: period.until === Infinity ? null : period.until })
      : { byId: {}, total: 0 };
    var cats = (window.WJP_Categories && window.WJP_Categories.list) ? window.WJP_Categories.list() : [];
    var q = (search || '').toLowerCase().trim();

    // Build sorted rows (skip transfer + income — spendingByCategory already does)
    var rows = cats
      .filter(function (c) { return c.id !== 'transfer' && c.id !== 'income'; })
      .map(function (c) {
        var bucket = data.byId[c.id] || { amount: 0, count: 0 };
        return { cat: c, amount: bucket.amount, count: bucket.count };
      })
      .filter(function (r) {
        if (q && r.cat.name.toLowerCase().indexOf(q) === -1) return false;
        return true; // include zero-spend categories so the user knows what exists
      })
      .sort(function (a, b) { return b.amount - a.amount; });

    var maxAmt = rows.reduce(function (m, r) { return Math.max(m, r.amount); }, 0);

    var periodPills = [
      ['day', 'Today'],
      ['week', 'This week'],
      ['month', 'This month'],
      ['year', 'This year'],
      ['all', 'All time']
    ].map(function (p) {
      return '<button type="button" data-period="' + p[0] + '"' + (periodKey === p[0] ? ' class="active"' : '') + '>' + p[1] + '</button>';
    }).join('');

    var listHtml = rows.length
      ? rows.map(function (r) {
          var pct = maxAmt > 0 ? Math.round((r.amount / maxAmt) * 100) : 0;
          var sw = r.cat.color || '#9ca3af';
          return '<div class="cat-row">' +
            '<span class="sw" style="background:' + sw + ';"></span>' +
            '<span class="nm">' + htmlEscape(r.cat.name) + '</span>' +
            '<span class="cnt">' + r.count + (r.count === 1 ? ' txn' : ' txns') + '</span>' +
            '<span class="bar"><div style="width:' + pct + '%;background:' + sw + ';opacity:' + (r.amount > 0 ? 0.85 : 0) + ';"></div></span>' +
            '<span class="amt">' + fmtUsd(r.amount) + '</span>' +
          '</div>';
        }).join('')
      : '<div class="empty">No categories match "' + htmlEscape(q) + '".</div>';

    return '<div id="' + CARD_ID + '">' +
      '<div class="head">' +
        '<div>' +
          '<div class="title">Billing History</div>' +
          '<div class="sub">Spending by category for ' + period.label + '. Transfers and income excluded.</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div class="total-label">' + period.label + ' total</div>' +
          '<div class="total">' + fmtUsd(data.total) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="periods">' + periodPills + '</div>' +
      '<div class="search" style="margin-top:10px;">' +
        '<input type="text" id="wjp-bh-search" placeholder="Search categories…" value="' + htmlEscape(q) + '" />' +
      '</div>' +
      '<div class="list">' + listHtml + '</div>' +
    '</div>';
  }

  // ───────── mount/refresh ─────────
  var _searchValue = '';
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
    // Anchor: Smart Summary box id is 'wjp-tx-smart-summary' or similar — fall back to
    // the parent of the transactions table.
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return;
    // Only mount on Transactions sub-tab. offsetParent isn't reliable here
    // (parent uses transform/contain CSS) — use .active class instead.
    var sub = document.querySelector('.debts-subtab-content[data-subtab="transactions"]');
    if (!sub || !sub.classList.contains('active')) {
      var stale = document.getElementById(CARD_ID);
      if (stale) stale.remove();
      return;
    }
    var existing = document.getElementById(CARD_ID);
    var periodKey = getPeriod();
    var html = buildCardHtml(periodKey, _searchValue);

    // Signature check to avoid pointless re-renders
    var sig = periodKey + ':' + _searchValue + ':' + (s.transactions.length) + ':' + (Date.now() - (Date.now() % 60000)); // refresh once per minute
    if (existing && existing.getAttribute('data-sig') === sig) return;

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    var card = wrapper.firstElementChild;
    card.setAttribute('data-sig', sig);

    if (existing) {
      var activeSearch = document.activeElement && document.activeElement.id === 'wjp-bh-search';
      if (activeSearch) return;
      existing.replaceWith(card);
    } else {
      // v3 (FIX 39, Winston): mount near the BOTTOM of the Transactions
      // subtab so it doesn't dominate the top of the page. Find or create
      // a flex row container so Billing History + Spend by Bill sit
      // side-by-side.
      var rowId = 'wjp-billing-row';
      var row = sub.querySelector('#' + rowId);
      if (!row) {
        row = document.createElement('div');
        row.id = rowId;
        row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;margin:14px 0 18px 0;';
        // Append near bottom of subtab (after the txn table + any pagination)
        sub.appendChild(row);
      }
      // Card takes 50% on wide screens
      card.style.flex = '1 1 380px';
      card.style.margin = '0';
      row.appendChild(card);
    }
    wireCard(card);
  }

  function wireCard(card) {
    if (!card) return;
    // Period pills
    Array.prototype.forEach.call(card.querySelectorAll('.periods button[data-period]'), function (btn) {
      btn.onclick = function () {
        setPeriod(btn.getAttribute('data-period'));
        // Force re-render on next tick
        var c = document.getElementById(CARD_ID);
        if (c) c.removeAttribute('data-sig');
        refresh();
      };
    });
    // Search
    var inp = card.querySelector('#wjp-bh-search');
    if (inp) {
      var t;
      inp.oninput = function () {
        _searchValue = inp.value;
        clearTimeout(t);
        t = setTimeout(function () {
          var c = document.getElementById(CARD_ID);
          if (c) c.removeAttribute('data-sig');
          refresh();
        }, 200);
      };
      inp.onblur = function () {
        // Force re-render after blur
        setTimeout(refresh, 100);
      };
    }
  }

  // ───────── boot ─────────
  function boot() {
    injectStyle();
    refresh();
    window.addEventListener('wjp-tx-rerendered', refresh);
    window.addEventListener('wjp-transactions-changed', refresh);
    window.addEventListener('wjp-categories-changed', refresh);
    window.addEventListener('wjp-tx-category-changed', refresh);
    // Slow polling tick to catch subtab switches + late-arriving content
    setInterval(refresh, 3000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_BillingHistory = {
    version: 1,
    refresh: refresh,
    getPeriod: getPeriod,
    setPeriod: setPeriod
  };
})();
