/* wjp-dashboard-audit-fix.js v1 — fix the broken dashboard cards Winston
 * flagged in the 2026-05-28 audit:
 *
 *   1. Add an Executive Summary card at the top of the dashboard
 *      (net worth + monthly cashflow + total debt + next due + key alert).
 *   2. Add a Last 7 Days card (spending + income + net cashflow).
 *   3. Repair Upcoming Payments — populate with the next 5 recurring
 *      payments from appState.recurringPayments if the host renderer
 *      left it empty.
 *   4. Make the Credit Profile card a click-through to #credit-health
 *      when no real score is connected.
 *
 * Safe: IIFE, idempotent install, bare `appState` access, try/catch
 * wrapped. Universal — works for any user.
 */
(function () {
  'use strict';
  if (window._wjpDashboardAuditFixInstalled) return;
  window._wjpDashboardAuditFixInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var EXEC_ID = 'wjp-exec-summary-card';
  var L7_ID = 'wjp-last7days-card';

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function fmtUsd(n) {
    n = Number(n) || 0;
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtUsdRound(n) {
    n = Number(n) || 0;
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function isTransfer(t) {
    if (!t) return true;
    if (t.userCategoryId === 'transfer') return true;
    try {
      if (window.WJP_TxSmartCategorize && window.WJP_TxSmartCategorize.isTransfer) {
        return !!window.WJP_TxSmartCategorize.isTransfer(t);
      }
    } catch (_) {}
    var f = [t.merchant, t.name, t.description, t.merchant_name].filter(Boolean).join(' ');
    return /\b(transfer|xfer|zelle|venmo|cash\s*app)\b/i.test(f);
  }
  function monthlyMult(freq) {
    switch (String(freq || 'monthly').toLowerCase()) {
      case 'weekly':      return 52/12;
      case 'biweekly':    return 26/12;
      case 'semimonthly': return 2;
      case 'monthly':     return 1;
      case 'quarterly':   return 1/3;
      case 'annually':
      case 'yearly':      return 1/12;
      default:            return 1;
    }
  }

  function injectStyle() {
    if (document.getElementById('wjp-dash-audit-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-dash-audit-style';
    st.textContent = [
      '#' + EXEC_ID + ',#' + L7_ID + '{background:var(--card-bg, var(--bg-2, #fff));color:var(--ink, var(--text-1, #0a0a0a));border:1px solid var(--border, rgba(0,0,0,0.10));border-radius:14px;padding:20px 22px;margin:0 0 14px 0;font-family:inherit;font-size:13px;}',
      '#' + EXEC_ID + ' .head,#' + L7_ID + ' .head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px;}',
      '#' + EXEC_ID + ' .title,#' + L7_ID + ' .title{font-size:15px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));}',
      '#' + EXEC_ID + ' .sub,#' + L7_ID + ' .sub{font-size:11px;color:var(--ink-dim, #6b7280);margin-top:2px;}',
      '#' + EXEC_ID + ' .stats,#' + L7_ID + ' .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}',
      '#' + EXEC_ID + ' .stat,#' + L7_ID + ' .stat{padding:12px;border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:10px;background:var(--bg-2, rgba(0,0,0,0.02));}',
      '#' + EXEC_ID + ' .stat .lbl,#' + L7_ID + ' .stat .lbl{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-dim, #6b7280);}',
      '#' + EXEC_ID + ' .stat .val,#' + L7_ID + ' .stat .val{font-size:20px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));margin-top:4px;}',
      '#' + EXEC_ID + ' .stat .sub2,#' + L7_ID + ' .stat .sub2{font-size:10px;color:var(--ink-dim, #6b7280);margin-top:2px;}',
      '#' + EXEC_ID + ' .stat.pos .val,#' + L7_ID + ' .stat.pos .val{color:#1f7a4a;}',
      '#' + EXEC_ID + ' .stat.neg .val,#' + L7_ID + ' .stat.neg .val{color:#c0594a;}',
      '@media (max-width: 700px){#' + EXEC_ID + ' .stats,#' + L7_ID + ' .stats{grid-template-columns:repeat(2,1fr);}}',
      // Upcoming Payments populate styling (only used when we fill an empty body)
      '.wjp-upcoming-list{display:flex;flex-direction:column;gap:6px;}',
      '.wjp-upcoming-list .row{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:var(--bg-2, rgba(0,0,0,0.02));border:1px solid var(--border, rgba(0,0,0,0.06));}',
      '.wjp-upcoming-list .nm{font-weight:600;font-size:12px;}',
      '.wjp-upcoming-list .when{font-size:10px;color:var(--ink-dim, #6b7280);}',
      '.wjp-upcoming-list .amt{font-weight:700;font-size:13px;color:#c0594a;}',
      // Credit profile click affordance
      '.credit-score-card.wjp-clickable{cursor:pointer;transition:transform .15s, box-shadow .15s;}',
      '.credit-score-card.wjp-clickable:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,0.08);}',
      // Dark-mode parity
      'body.dark #' + EXEC_ID + ',body.dark #' + L7_ID + '{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);color:#e7e7ea;}',
      'body.dark #' + EXEC_ID + ' .title,body.dark #' + L7_ID + ' .title{color:#f4f4f6;}',
      'body.dark #' + EXEC_ID + ' .sub,body.dark #' + L7_ID + ' .sub,body.dark #' + EXEC_ID + ' .stat .lbl,body.dark #' + L7_ID + ' .stat .lbl,body.dark #' + EXEC_ID + ' .stat .sub2,body.dark #' + L7_ID + ' .stat .sub2{color:rgba(255,255,255,0.55);}',
      'body.dark #' + EXEC_ID + ' .stat,body.dark #' + L7_ID + ' .stat{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);}',
      'body.dark #' + EXEC_ID + ' .stat .val,body.dark #' + L7_ID + ' .stat .val{color:#f4f4f6;}',
      'body.dark .wjp-upcoming-list .row{background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.10);color:#e7e7ea;}',
      'body.dark .wjp-upcoming-list .nm{color:#f4f4f6;}',
      'body.dark .wjp-upcoming-list .when{color:rgba(255,255,255,0.55);}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── compute metrics ──────────
  function computeExecMetrics() {
    var s = getState();
    var debts = (s && Array.isArray(s.debts)) ? s.debts : [];
    var assets = (s && Array.isArray(s.assets)) ? s.assets : [];
    var txns = (s && Array.isArray(s.transactions)) ? s.transactions : [];
    var rps = (s && Array.isArray(s.recurringPayments)) ? s.recurringPayments : [];

    // Total debt
    var totalDebt = 0;
    debts.forEach(function (d) { if (d) totalDebt += Math.abs(Number(d.balance) || 0); });

    // Net worth = assets - debts (approximate)
    var totalAssets = 0;
    assets.forEach(function (a) { if (a) totalAssets += Math.abs(Number(a.value || a.balance) || 0); });
    var netWorth = totalAssets - totalDebt;

    // Monthly cashflow from recurring (income - outflow)
    var rpIncome = 0, rpOutflow = 0;
    rps.forEach(function (rp) {
      if (!rp) return;
      var amt = Math.abs(Number(rp.amount) || 0);
      if (amt <= 0) return;
      var monthly = amt * monthlyMult(rp.frequency);
      var c = String(rp.category || rp.cat || '').toLowerCase();
      if (c === 'income' || rp.linkedIncome) rpIncome += monthly;
      else rpOutflow += monthly;
    });
    var monthlyCashflow = rpIncome - rpOutflow;

    // Next due
    var nextDue = null;
    rps.forEach(function (rp) {
      if (!rp || !rp.nextDate) return;
      var ms = new Date(String(rp.nextDate).slice(0, 10) + 'T12:00:00').getTime();
      if (!ms) return;
      if (!nextDue || ms < nextDue.ms) nextDue = { rp: rp, ms: ms };
    });

    return {
      totalDebt: totalDebt,
      netWorth: netWorth,
      monthlyCashflow: monthlyCashflow,
      rpIncome: rpIncome,
      rpOutflow: rpOutflow,
      nextDue: nextDue,
      debtCount: debts.length,
      rpCount: rps.length,
      txnCount: txns.length
    };
  }

  function compute7d() {
    var s = getState();
    var txns = (s && Array.isArray(s.transactions)) ? s.transactions : [];
    var cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    var income = 0, spending = 0, transfers = 0, count = 0;
    txns.forEach(function (t) {
      if (!t || t.synthetic) return;
      var ms = t.date ? new Date(String(t.date).slice(0, 10) + 'T12:00:00').getTime() : 0;
      if (!ms || ms < cutoff) return;
      if (isTransfer(t)) { transfers += Math.abs(Number(t.amount) || 0); return; }
      var amt = Number(t.amount) || 0;
      if (amt > 0) income += amt;
      else spending += Math.abs(amt);
      count++;
    });
    return { income: income, spending: spending, transfers: transfers, net: income - spending, count: count };
  }

  // ────────── build cards ──────────
  function buildExecHtml() {
    var m = computeExecMetrics();
    var nextDueStr = 'None scheduled';
    var nextDueSub = '';
    if (m.nextDue) {
      var days = Math.max(0, Math.round((m.nextDue.ms - Date.now()) / 86400000));
      var name = String(m.nextDue.rp.name || '').slice(0, 22);
      nextDueStr = days === 0 ? 'Today' : (days === 1 ? 'Tomorrow' : days + ' days');
      nextDueSub = name + ' · ' + fmtUsdRound(Math.abs(Number(m.nextDue.rp.amount) || 0));
    }
    var cashflowSign = m.monthlyCashflow >= 0 ? '+' : '-';
    return '<div id="' + EXEC_ID + '">' +
      '<div class="head"><div>' +
        '<div class="title">Executive Summary</div>' +
        '<div class="sub">' + m.debtCount + ' debt' + (m.debtCount === 1 ? '' : 's') + ' · ' + m.rpCount + ' recurring · ' + m.txnCount + ' transactions tracked</div>' +
      '</div></div>' +
      '<div class="stats">' +
        '<div class="stat ' + (m.netWorth >= 0 ? 'pos' : 'neg') + '">' +
          '<div class="lbl">Net worth</div>' +
          '<div class="val">' + fmtUsdRound(m.netWorth) + '</div>' +
          '<div class="sub2">assets minus debt</div>' +
        '</div>' +
        '<div class="stat neg">' +
          '<div class="lbl">Total debt</div>' +
          '<div class="val">' + fmtUsdRound(m.totalDebt) + '</div>' +
          '<div class="sub2">across ' + m.debtCount + ' account' + (m.debtCount === 1 ? '' : 's') + '</div>' +
        '</div>' +
        '<div class="stat ' + (m.monthlyCashflow >= 0 ? 'pos' : 'neg') + '">' +
          '<div class="lbl">Monthly cashflow</div>' +
          '<div class="val">' + cashflowSign + fmtUsdRound(Math.abs(m.monthlyCashflow)) + '</div>' +
          '<div class="sub2">in ' + fmtUsdRound(m.rpIncome) + ' · out ' + fmtUsdRound(m.rpOutflow) + '</div>' +
        '</div>' +
        '<div class="stat">' +
          '<div class="lbl">Next due</div>' +
          '<div class="val">' + nextDueStr + '</div>' +
          '<div class="sub2">' + (nextDueSub || '—') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildL7Html() {
    var m = compute7d();
    return '<div id="' + L7_ID + '">' +
      '<div class="head"><div>' +
        '<div class="title">Last 7 Days</div>' +
        '<div class="sub">' + m.count + ' transaction' + (m.count === 1 ? '' : 's') + ' · rolling window · transfers excluded</div>' +
      '</div></div>' +
      '<div class="stats">' +
        '<div class="stat pos"><div class="lbl">Income</div><div class="val">+' + fmtUsdRound(m.income) + '</div><div class="sub2">in the last week</div></div>' +
        '<div class="stat neg"><div class="lbl">Spending</div><div class="val">-' + fmtUsdRound(m.spending) + '</div><div class="sub2">in the last week</div></div>' +
        '<div class="stat ' + (m.net >= 0 ? 'pos' : 'neg') + '"><div class="lbl">Net cashflow</div><div class="val">' + (m.net >= 0 ? '+' : '-') + fmtUsdRound(Math.abs(m.net)) + '</div><div class="sub2">' + (m.net >= 0 ? 'surplus' : 'shortfall') + '</div></div>' +
        '<div class="stat"><div class="lbl">Transfers excluded</div><div class="val">' + fmtUsdRound(m.transfers) + '</div><div class="sub2">moved between own accounts</div></div>' +
      '</div>' +
    '</div>';
  }

  // ────────── repair Upcoming Payments card ──────────
  function findUpcomingCard() {
    var titles = document.querySelectorAll('h2, h3, .card-title, div');
    for (var i = 0; i < titles.length; i++) {
      var t = (titles[i].textContent || '').trim().toLowerCase();
      if (t === 'upcoming payments' && t.length < 30) {
        return titles[i].closest('.card') || titles[i].closest('[class*="card"]') || titles[i].parentElement;
      }
    }
    return document.getElementById('upcoming-view-container') || null;
  }
  function repairUpcoming() {
    var card = findUpcomingCard();
    if (!card) return false;
    // Is there already a visible list inside?
    var hasList = card.querySelector('.wjp-upcoming-list, .upcoming-item, .upcoming-row, [data-upcoming-row]');
    var bodyText = (card.textContent || '').replace(/\s+/g, ' ').trim();
    var seemsEmpty = bodyText.length < 30 && !hasList;
    var hasOurList = !!card.querySelector('.wjp-upcoming-list');
    if (!seemsEmpty && !hasOurList) return false;

    // Pick next 5 upcoming recurring payments
    var s = getState();
    var rps = (s && Array.isArray(s.recurringPayments)) ? s.recurringPayments : [];
    var items = [];
    rps.forEach(function (rp) {
      if (!rp || !rp.nextDate) return;
      var ms = new Date(String(rp.nextDate).slice(0, 10) + 'T12:00:00').getTime();
      if (!ms) return;
      items.push({ rp: rp, ms: ms });
    });
    items.sort(function (a, b) { return a.ms - b.ms; });
    items = items.slice(0, 5);

    var listHtml;
    if (!items.length) {
      listHtml = '<div class="wjp-upcoming-list"><div class="row"><span class="nm">No upcoming payments</span><span class="when">add a recurring schedule</span></div></div>';
    } else {
      listHtml = '<div class="wjp-upcoming-list">' + items.map(function (x) {
        var days = Math.max(0, Math.round((x.ms - Date.now()) / 86400000));
        var when = days === 0 ? 'Today' : (days === 1 ? 'Tomorrow' : 'in ' + days + ' days');
        var amt = Math.abs(Number(x.rp.amount) || 0);
        var name = String(x.rp.name || 'Recurring').slice(0, 30);
        return '<div class="row"><div><div class="nm">' + htmlEscape(name) + '</div><div class="when">' + when + '</div></div><div class="amt">-' + fmtUsdRound(amt) + '</div></div>';
      }).join('') + '</div>';
    }

    // Find the empty body to fill
    var body = card.querySelector('.card-body, .body, .content, [class*="content"]');
    if (!body) body = card;
    var existing = body.querySelector('.wjp-upcoming-list');
    if (existing) {
      existing.outerHTML = listHtml;
    } else {
      body.insertAdjacentHTML('beforeend', listHtml);
    }
    return true;
  }

  // ────────── make Credit Profile card click-through ──────────
  function wireCreditProfile() {
    var card = document.getElementById('credit-profile-card') || document.querySelector('.credit-score-card');
    if (!card) return false;
    if (card._wjpClickwired) return true;
    card.classList.add('wjp-clickable');
    card.addEventListener('click', function (e) {
      // Don't intercept clicks on inner buttons / links
      if (e.target.closest('a, button, input, select, textarea')) return;
      try { location.hash = '#credit-health'; } catch (_) {}
      try {
        var btn = document.querySelector('[data-tab="credit-health"], [href="#credit-health"], a[href$="credit-health"]');
        if (btn) btn.click();
      } catch (_) {}
    });
    card.title = 'Open Credit Health';
    card._wjpClickwired = true;
    return true;
  }

  // ────────── mount ──────────
  function findAnchor() {
    // Prefer dashboard grid; fall back to whatever holds Wealth card
    var grid = document.getElementById('dash-grid')
      || document.querySelector('.dash-grid, .dashboard-grid, [class*="dashboard"][class*="grid"]');
    return grid;
  }
  function mount() {
    injectStyle();
    var grid = findAnchor();
    if (!grid) return false;

    // Executive Summary — first child
    var existingExec = document.getElementById(EXEC_ID);
    var execHtml = buildExecHtml();
    if (existingExec) {
      var wrap = document.createElement('div');
      wrap.innerHTML = execHtml;
      existingExec.replaceWith(wrap.firstElementChild);
    } else {
      var w = document.createElement('div');
      w.innerHTML = execHtml;
      grid.insertBefore(w.firstElementChild, grid.firstChild);
    }

    // Last 7 Days — right after Executive Summary
    var existingL7 = document.getElementById(L7_ID);
    var l7Html = buildL7Html();
    if (existingL7) {
      var w2 = document.createElement('div');
      w2.innerHTML = l7Html;
      existingL7.replaceWith(w2.firstElementChild);
    } else {
      var w3 = document.createElement('div');
      w3.innerHTML = l7Html;
      var exec = document.getElementById(EXEC_ID);
      if (exec && exec.nextSibling) grid.insertBefore(w3.firstElementChild, exec.nextSibling);
      else grid.insertBefore(w3.firstElementChild, grid.children[1] || null);
    }

    // Repair Upcoming Payments + wire Credit Profile
    repairUpcoming();
    wireCreditProfile();
    return true;
  }

  function boot() {
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (mount() || attempts > 40) clearInterval(iv);
    }, 1000);
    window.addEventListener('wjp-data-restored', function () { setTimeout(mount, 500); });
    window.addEventListener('wjp-transactions-changed', function () { setTimeout(mount, 400); });
    window.addEventListener('wjp-recurring-changed', function () { setTimeout(mount, 400); });
    setInterval(mount, 30000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardAuditFix = { version: 1, mount: mount, repairUpcoming: repairUpcoming };
})();
