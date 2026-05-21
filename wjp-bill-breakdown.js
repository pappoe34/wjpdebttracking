/* wjp-bill-breakdown.js v1 — Per-bill / per-merchant spending breakdown across week / month / year / all-time.
 *
 *   - Adds a "📊 Bill history" button to the Transactions tab Smart Summary header.
 *   - Click → opens a modal with:
 *       (a) Searchable picker of all merchants found in appState.transactions
 *       (b) Top 12 by total spend with running totals
 *       (c) When a merchant is selected: 4 stat cards (this week / this month /
 *           this year / all-time) showing total spent + txn count
 *       (d) A scrollable list of recent transactions for that merchant (date,
 *           amount, account, status).
 *   - Transfers and synthetic templates are excluded so totals stay honest.
 *   - Merchant grouping uses canonicalizeMerchant() — same rule the Smart
 *     Summary uses so "FreshRealm Payroll" / "FRESHREALM PAYROLL 052026" /
 *     etc. collapse into one bill.
 *   - Works in night + day mode via CSS custom property fallbacks.
 *   - Safe: IIFE + install guard + idempotent.
 */
(function () {
  'use strict';
  if (window._wjpBillBreakdownInstalled) return;
  window._wjpBillBreakdownInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  var STYLE_ID = 'wjp-bill-breakdown-style';
  var MODAL_ID = 'wjp-bill-breakdown-modal';
  var BTN_ID = 'wjp-bill-breakdown-btn';

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '$0';
    return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function fmtUsdSigned(n) {
    if (n == null || !isFinite(n)) return '$0';
    return (n < 0 ? '-$' : '+$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function parseTxnDate(t) {
    var raw = (t && (t.date || t.timestamp)) || 0;
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + 'T00:00:00');
    return new Date(raw);
  }
  function isTransfer(t) {
    if (!t) return false;
    if (t.payment_channel === 'transfer') return true;
    var c = (t.category || t.cat || '').toString().toLowerCase();
    if (/transfer|internal/.test(c)) return true;
    var m = (t.merchant || '').toString().toLowerCase();
    if (/(transfer|payment from|payment to|venmo|zelle|cashapp|cash app|paypal)/i.test(m) && /transfer/i.test(c)) return true;
    return false;
  }
  function isIncome(t) {
    if (!t) return false;
    var amt = Number(t.amount);
    if (!isFinite(amt)) return false;
    if (amt > 0 && !isTransfer(t)) return true;
    return false;
  }
  function isExpense(t) {
    if (!t) return false;
    var amt = Number(t.amount);
    if (!isFinite(amt)) return false;
    if (amt < 0 && !isTransfer(t)) return true;
    return false;
  }
  function canonicalizeMerchant(m) {
    if (!m) return 'Unknown';
    var s = String(m).trim();
    // Try host-provided canonicalize first
    try {
      if (typeof window.WJP_TxTabEnhance !== 'undefined' && window.WJP_TxTabEnhance.canonicalizeMerchant) {
        return window.WJP_TxTabEnhance.canonicalizeMerchant(s);
      }
    } catch (_) {}
    // Common payroll/POS noise stripping
    s = s.replace(/\b(payroll|direct dep|direct deposit|ach|debit|pos|purchase|recurring)\b/ig, '');
    s = s.replace(/\b\d{3,}\b/g, '');
    s = s.replace(/\s{2,}/g, ' ').trim();
    if (/freshrealm/i.test(s)) return 'FreshRealm';
    if (/adp\b/i.test(s) || /totalsource/i.test(s)) return 'ADP TotalSource';
    if (/etsy/i.test(s)) return 'Etsy';
    if (/netflix/i.test(s)) return 'Netflix';
    if (/spotify/i.test(s)) return 'Spotify';
    if (/amazon|amzn/i.test(s)) return 'Amazon';
    if (/sofi/i.test(s)) return 'SoFi';
    if (/capital\s*one venture/i.test(s)) return 'Capital One Venture';
    if (/capital\s*one/i.test(s)) return 'Capital One';
    if (/citibank|\bciti\b/i.test(s)) return 'Citibank';
    if (/discover/i.test(s)) return 'Discover';
    if (/chase/i.test(s)) return 'Chase';
    if (/amex|american express/i.test(s)) return 'Amex';
    if (/avant/i.test(s)) return 'Avant Credit Card';
    if (/milestone/i.test(s)) return 'Milestone';
    if (/westlake/i.test(s)) return 'WestLake Car Loan';
    if (/netlify/i.test(s)) return 'Netlify';
    if (/openai|chatgpt/i.test(s)) return 'OpenAI';
    if (/anthropic|claude/i.test(s)) return 'Anthropic';
    if (/ace\s*hardware/i.test(s)) return 'Ace Hardware';
    if (/origin\s*financial/i.test(s)) return 'Origin Financial';
    if (/pse\s*&?\s*g|pseg/i.test(s)) return 'PSE&G';
    return s || 'Unknown';
  }

  // ---- Compute merchant rollup ----
  function startOfDay(d) { var x = new Date(d); x.setHours(0,0,0,0); return x; }
  function startOfWeek() {
    var d = startOfDay(new Date());
    var dow = d.getDay(); // Sun=0
    var diff = (dow === 0 ? 6 : dow - 1); // start week on Mon
    d.setDate(d.getDate() - diff);
    return d;
  }
  function startOfMonth() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function startOfYear() {
    var d = new Date();
    return new Date(d.getFullYear(), 0, 1);
  }

  // Group all transactions by canonical merchant name. Returns:
  //   { merchantKey: { txns:[...], total: N, count: N, byPeriod: {week, month, year, all} } }
  function buildMerchantIndex() {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return {};
    var sow = startOfWeek().getTime();
    var som = startOfMonth().getTime();
    var soy = startOfYear().getTime();
    var idx = {};
    s.transactions.forEach(function (t) {
      if (!t) return;
      if (t.synthetic === true) return; // exclude synthetic recurring templates
      if (isTransfer(t)) return;
      if (!isExpense(t)) return; // bill breakdown = expenses only
      var amt = Math.abs(Number(t.amount));
      if (!isFinite(amt) || amt === 0) return;
      var key = canonicalizeMerchant(t.merchant || 'Unknown');
      if (!idx[key]) {
        idx[key] = { merchant: key, txns: [], total: 0, count: 0, byPeriod: { week: 0, month: 0, year: 0, all: 0 }, countByPeriod: { week: 0, month: 0, year: 0, all: 0 } };
      }
      var bucket = idx[key];
      bucket.txns.push(t);
      bucket.total += amt;
      bucket.count++;
      var d = parseTxnDate(t).getTime();
      bucket.byPeriod.all += amt; bucket.countByPeriod.all++;
      if (d >= soy) { bucket.byPeriod.year += amt; bucket.countByPeriod.year++; }
      if (d >= som) { bucket.byPeriod.month += amt; bucket.countByPeriod.month++; }
      if (d >= sow) { bucket.byPeriod.week += amt; bucket.countByPeriod.week++; }
    });
    // sort each merchant's txns desc by date
    Object.keys(idx).forEach(function (k) {
      idx[k].txns.sort(function (a, b) { return parseTxnDate(b) - parseTxnDate(a); });
    });
    return idx;
  }

  // ---- Inject CSS ----
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#' + BTN_ID + ' {',
      '  font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 999px;',
      '  background: rgba(124,58,237,0.10); color: #7c3aed;',
      '  border: 1px solid rgba(124,58,237,0.30);',
      '  cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 4px;',
      '  margin-left: 6px;',
      '}',
      '#' + BTN_ID + ':hover { background: rgba(124,58,237,0.18); }',
      '#' + MODAL_ID + ' {',
      '  position: fixed; inset: 0; z-index: 100000;',
      '  background: rgba(8,14,22,0.55); backdrop-filter: blur(3px);',
      '  display: flex; align-items: center; justify-content: center; padding: 24px;',
      '  font-family: Inter, system-ui, sans-serif;',
      '}',
      '#' + MODAL_ID + ' .panel {',
      '  width: min(960px, 100%); max-height: 88vh; overflow: hidden;',
      '  display: grid; grid-template-columns: 320px 1fr; gap: 0;',
      '  background: var(--card-bg, var(--bg-2, #fff));',
      '  border: 1px solid var(--border, rgba(0,0,0,0.10));',
      '  border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.30);',
      '  color: var(--ink, var(--text-1, #0a0a0a));',
      '}',
      '@media (max-width: 720px) { #' + MODAL_ID + ' .panel { grid-template-columns: 1fr; max-height: 92vh; } #' + MODAL_ID + ' .left { max-height: 38vh; } }',
      '#' + MODAL_ID + ' .left {',
      '  border-right: 1px solid var(--border, rgba(0,0,0,0.08));',
      '  background: var(--bg-3, rgba(0,0,0,0.02));',
      '  padding: 14px; overflow: hidden; display: flex; flex-direction: column; min-height: 0;',
      '}',
      '#' + MODAL_ID + ' .left h3 { font-size: 13px; font-weight: 800; margin: 0 0 8px; letter-spacing: -0.01em; }',
      '#' + MODAL_ID + ' .search {',
      '  width: 100%; padding: 8px 12px; border-radius: 10px;',
      '  border: 1px solid var(--border, rgba(0,0,0,0.10));',
      '  background: var(--card-bg, var(--bg-2, #fff));',
      '  color: var(--ink, #0a0a0a); font-size: 12.5px;',
      '  font-family: inherit; box-sizing: border-box; margin-bottom: 10px;',
      '}',
      '#' + MODAL_ID + ' .search:focus { outline: 2px solid rgba(31,122,74,0.35); outline-offset: 1px; }',
      '#' + MODAL_ID + ' .merchant-list { overflow-y: auto; flex: 1; min-height: 0; }',
      '#' + MODAL_ID + ' .m-row {',
      '  display: flex; justify-content: space-between; align-items: center;',
      '  padding: 8px 10px; font-size: 12px; border-radius: 8px; cursor: pointer;',
      '  margin-bottom: 2px; color: var(--ink, #0a0a0a);',
      '}',
      '#' + MODAL_ID + ' .m-row:hover { background: var(--bg-2, rgba(0,0,0,0.04)); }',
      '#' + MODAL_ID + ' .m-row.active { background: rgba(31,122,74,0.12); color: #1f7a4a; font-weight: 700; }',
      '#' + MODAL_ID + ' .m-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; font-weight: 600; }',
      '#' + MODAL_ID + ' .m-row .amt { font-weight: 700; color: #c0594a; font-size: 11.5px; white-space: nowrap; }',
      '#' + MODAL_ID + ' .m-row.active .amt { color: #1f7a4a; }',
      '#' + MODAL_ID + ' .right {',
      '  padding: 18px; overflow-y: auto; min-height: 0;',
      '}',
      '#' + MODAL_ID + ' .right h2 {',
      '  font-size: 18px; font-weight: 800; margin: 0 0 4px; letter-spacing: -0.015em;',
      '  display: flex; justify-content: space-between; align-items: center; gap: 8px;',
      '}',
      '#' + MODAL_ID + ' .right .sub { font-size: 11.5px; color: var(--ink-dim, var(--text-2, #6b7280)); margin-bottom: 16px; }',
      '#' + MODAL_ID + ' .closeX {',
      '  background: transparent; border: 0; cursor: pointer; font-size: 22px; line-height: 1;',
      '  color: var(--ink-dim, #6b7280); padding: 2px 6px;',
      '}',
      '#' + MODAL_ID + ' .closeX:hover { color: var(--ink, #0a0a0a); }',
      '#' + MODAL_ID + ' .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }',
      '@media (max-width: 720px) { #' + MODAL_ID + ' .stat-grid { grid-template-columns: repeat(2, 1fr); } }',
      '#' + MODAL_ID + ' .stat-card {',
      '  background: var(--bg-3, rgba(0,0,0,0.03));',
      '  border: 1px solid var(--border, rgba(0,0,0,0.06));',
      '  border-radius: 10px; padding: 11px 13px;',
      '}',
      '#' + MODAL_ID + ' .stat-card .label {',
      '  font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase;',
      '  color: var(--ink-dim, #6b7280); font-weight: 700; margin-bottom: 4px;',
      '}',
      '#' + MODAL_ID + ' .stat-card .value { font-size: 17px; font-weight: 800; color: #c0594a; letter-spacing: -0.01em; }',
      '#' + MODAL_ID + ' .stat-card .sub { font-size: 10px; color: var(--ink-dim, #6b7280); margin-top: 2px; font-weight: 500; }',
      '#' + MODAL_ID + ' .txns-title {',
      '  font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;',
      '  color: var(--ink-dim, #6b7280); margin: 16px 0 8px;',
      '}',
      '#' + MODAL_ID + ' .txns-list { display: flex; flex-direction: column; gap: 4px; }',
      '#' + MODAL_ID + ' .txn-item {',
      '  display: grid; grid-template-columns: 90px 1fr auto; gap: 12px;',
      '  align-items: center; padding: 7px 10px;',
      '  border-radius: 8px; background: var(--bg-3, rgba(0,0,0,0.02));',
      '  font-size: 11.5px;',
      '}',
      '#' + MODAL_ID + ' .txn-item .d { color: var(--ink-dim, #6b7280); font-weight: 600; }',
      '#' + MODAL_ID + ' .txn-item .src { color: var(--ink, #0a0a0a); font-weight: 600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '#' + MODAL_ID + ' .txn-item .a { font-weight: 700; color: #c0594a; }',
      '#' + MODAL_ID + ' .empty {',
      '  text-align: center; padding: 40px 16px; color: var(--ink-dim, #6b7280); font-size: 12.5px;',
      '}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- Modal ----
  var currentMerchant = null;
  var searchQuery = '';

  function closeModal() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function renderRight(idx, merchantKey) {
    var right = document.querySelector('#' + MODAL_ID + ' .right');
    if (!right) return;
    if (!merchantKey || !idx[merchantKey]) {
      right.innerHTML =
        '<h2>Bill spending breakdown <button class="closeX" id="wjp-bill-x">×</button></h2>' +
        '<div class="sub">Pick a merchant on the left to see what you’ve spent this week, month, year, and all-time.</div>' +
        '<div class="empty">No merchant selected.</div>';
      var x = document.getElementById('wjp-bill-x'); if (x) x.onclick = closeModal;
      return;
    }
    var b = idx[merchantKey];
    var recent = b.txns.slice(0, 60);
    var rowsHtml = recent.map(function (t) {
      var d = parseTxnDate(t);
      var dStr = isNaN(d) ? '—' : (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2);
      var src = (t.institutionName || (t.source === 'recurring' ? 'Recurring' : t.source === 'plaid' ? 'Bank' : 'Manual'));
      var status = t.status ? (' · ' + t.status) : '';
      return '<div class="txn-item"><span class="d">' + dStr + '</span><span class="src">' + src + status + '</span><span class="a">-' + fmtUsd(Math.abs(Number(t.amount) || 0)) + '</span></div>';
    }).join('');
    right.innerHTML =
      '<h2><span>' + b.merchant + '</span><button class="closeX" id="wjp-bill-x">×</button></h2>' +
      '<div class="sub">' + b.count + ' transaction' + (b.count === 1 ? '' : 's') + ' on record</div>' +
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">This week</div><div class="value">-' + fmtUsd(b.byPeriod.week) + '</div><div class="sub">' + b.countByPeriod.week + ' txn' + (b.countByPeriod.week === 1 ? '' : 's') + '</div></div>' +
        '<div class="stat-card"><div class="label">This month</div><div class="value">-' + fmtUsd(b.byPeriod.month) + '</div><div class="sub">' + b.countByPeriod.month + ' txn' + (b.countByPeriod.month === 1 ? '' : 's') + '</div></div>' +
        '<div class="stat-card"><div class="label">This year</div><div class="value">-' + fmtUsd(b.byPeriod.year) + '</div><div class="sub">' + b.countByPeriod.year + ' txn' + (b.countByPeriod.year === 1 ? '' : 's') + '</div></div>' +
        '<div class="stat-card"><div class="label">All time</div><div class="value">-' + fmtUsd(b.byPeriod.all) + '</div><div class="sub">' + b.countByPeriod.all + ' txn' + (b.countByPeriod.all === 1 ? '' : 's') + '</div></div>' +
      '</div>' +
      '<div class="txns-title">Recent transactions</div>' +
      '<div class="txns-list">' + (rowsHtml || '<div class="empty">No transactions found.</div>') + '</div>';
    var x = document.getElementById('wjp-bill-x'); if (x) x.onclick = closeModal;
  }

  function renderLeft(idx) {
    var left = document.querySelector('#' + MODAL_ID + ' .merchant-list');
    if (!left) return;
    var keys = Object.keys(idx);
    var q = (searchQuery || '').trim().toLowerCase();
    if (q) keys = keys.filter(function (k) { return k.toLowerCase().indexOf(q) !== -1; });
    keys.sort(function (a, b) { return idx[b].total - idx[a].total; });
    if (!keys.length) {
      left.innerHTML = '<div class="empty">No merchants match.</div>';
      return;
    }
    left.innerHTML = keys.slice(0, 200).map(function (k) {
      var b = idx[k];
      return '<div class="m-row ' + (k === currentMerchant ? 'active' : '') + '" data-merchant="' + k.replace(/"/g, '&quot;') + '">' +
        '<span class="name">' + k + '</span>' +
        '<span class="amt">-' + fmtUsd(b.total) + '</span>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(left.querySelectorAll('.m-row'), function (row) {
      row.onclick = function () {
        currentMerchant = row.getAttribute('data-merchant');
        Array.prototype.forEach.call(left.querySelectorAll('.m-row'), function (r) { r.classList.remove('active'); });
        row.classList.add('active');
        renderRight(idx, currentMerchant);
      };
    });
  }

  function openModal(preselectMerchant) {
    injectStyle();
    closeModal(); // ensure single instance
    var idx = buildMerchantIndex();
    var keys = Object.keys(idx).sort(function (a, b) { return idx[b].total - idx[a].total; });
    currentMerchant = preselectMerchant || (keys[0] || null);

    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML =
      '<div class="panel" role="dialog" aria-label="Bill spending breakdown">' +
        '<div class="left">' +
          '<h3>Spend by bill</h3>' +
          '<input type="text" class="search" placeholder="Search merchant…" id="wjp-bill-search" autocomplete="off" />' +
          '<div class="merchant-list"></div>' +
        '</div>' +
        '<div class="right"></div>' +
      '</div>';
    // Click outside panel closes modal
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    document.body.appendChild(modal);

    // Wire search
    var input = document.getElementById('wjp-bill-search');
    if (input) {
      input.value = searchQuery || '';
      input.addEventListener('input', function () {
        searchQuery = input.value;
        renderLeft(idx);
      });
      // Focus the picker on open
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 50);
    }
    renderLeft(idx);
    renderRight(idx, currentMerchant);

    // Esc closes
    var keyHandler = function (e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', keyHandler); }
    };
    document.addEventListener('keydown', keyHandler);
  }

  // ---- Mount the "📊 Bill history" button into the Smart Summary header ----
  function ensureButton() {
    var summary = document.getElementById('wjp-tx-summary-box');
    if (!summary) return;
    if (document.getElementById(BTN_ID)) return;
    // Find the header right-side container that already holds period pills + toggle
    var head = summary.querySelector('.head');
    if (!head) return;
    var rightSlot = head.lastElementChild;
    if (!rightSlot) return;
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.innerHTML = '📊 Bill history';
    btn.title = 'See how much you\'ve spent on each bill this week, month, year, all-time';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      openModal();
    };
    rightSlot.appendChild(btn);
  }

  function boot() {
    injectStyle();
    setInterval(ensureButton, 4000);
    setTimeout(ensureButton, 1500);
    setTimeout(ensureButton, 3500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_BillBreakdown = {
    show: openModal,
    close: closeModal,
    rebuildIndex: buildMerchantIndex,
    version: 1
  };
})();
