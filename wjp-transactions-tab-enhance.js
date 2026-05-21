/* wjp-transactions-tab-enhance.js v9 — collapsible Smart Summary + ALL categories + improved insights + per-bank toggle preserved. v8 — smart categorizer applied for real — clickable bank chips filter table v4 — group paychecks by employer v3 — exclude synthetic from Smart Summary v2 — TZ-safe date parsing v1 — Transactions tab Smart Summary + filters. */
(function () {
  'use strict';
  if (window._wjpTxTabEnhanceInstalled) return;
  window._wjpTxTabEnhanceInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-tx-tab-enhance-style';
  var SUMMARY_ID = 'wjp-tx-summary-box';
  var FILTERS_ID = 'wjp-tx-account-filters';
  var LS_FILTER = 'wjp.tx.accountFilter';
  var LS_PERIOD = 'wjp.tx.summaryPeriod';
  var LS_EXPANDED = 'wjp.tx.summaryExpanded';

  // ---- Helpers ----
  function fmtUsd(n, decimals) {
    if (n == null || !isFinite(n)) return '$0';
    var d = decimals == null ? 0 : decimals;
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtUsdSigned(n) {
    if (n == null || !isFinite(n)) return '$0';
    var sign = n >= 0 ? '+' : '-';
    return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  // Extended merchant classifier — covers common merchants the host's
  // autoCategorizeMerchant misses. Aligns with the Calendar's category names.
  var EXT_CAT_RULES = [
    { re: /\betsy\b|\bebay\b|\bshopify\b|wayfair|ikea|home\s*depot|lowes/i, cat: 'Shopping' },
    { re: /amazon|amzn\s*mktp|prime\s*now/i, cat: 'Shopping' },
    { re: /best\s*buy|apple\.com|microcenter|newegg|fry'?s/i, cat: 'Shopping' },
    { re: /aidvantage|sallie\s*mae|navient|nelnet|mohela|edfinancial|ed\s*financial|great\s*lakes/i, cat: 'Debt Payment' },
    { re: /westlake|americredit|gm\s*financial|toyota\s*financial|honda\s*financial|ford\s*credit|nissan\s*finance|hyundai\s*finance|kia\s*finance|carvana|carmax/i, cat: 'Auto' },
    { re: /\bcapital\s*one\b|\bcitibank\b|\bdiscover\b|\bchase\b|\bamex\b|barclays|synchrony|comenity|merrick|credit\s*one|avant|milestone/i, cat: 'Debt Payment' },
    { re: /origin\s*financial|geico|state\s*farm|allstate|progressive|liberty\s*mutual|nationwide|farmers/i, cat: 'Insurance' },
    { re: /\bstash\b|robinhood|fidelity|vanguard|schwab|coinbase|wealthfront|betterment/i, cat: 'Investing' },
    { re: /pse&g|peco|coned|ameren|duke\s*energy|pg&e|sce|sdg&e/i, cat: 'Utilities' },
    { re: /openai|anthropic|claude|notion|figma|cursor|vercel|netlify|render|heroku/i, cat: 'Subscriptions' }
  ];
  function extCategorize(m) {
    if (!m) return null;
    for (var i = 0; i < EXT_CAT_RULES.length; i++) if (EXT_CAT_RULES[i].re.test(m)) return EXT_CAT_RULES[i].cat;
    return null;
  }
  function smartCategorize(t) {
    if (!t) return 'Other';
    var c = t.category;
    if (c && !/^(other|uncategorized|unknown)$/i.test(c)) return c;
    var merch = t.merchant || '';
    try { if (typeof window.autoCategorizeMerchant === 'function') { var hit = window.autoCategorizeMerchant(merch); if (hit) return hit; } } catch (_) {}
    return extCategorize(merch) || 'Other';
  }

  // Canonicalize merchant names so multiple payroll IDs from the same
  // company group into a single income source. Strips bank-batch identifiers
  // (PAYROLL ID:..., INDN:..., CO ID:..., Conf#..., Confirmation#...) and
  // returns a stable display name.
  function canonicalizeMerchant(m) {
    if (!m) return 'Unknown';
    var raw = String(m);
    // Cut at any of these markers — everything after is a batch identifier
    var cutMarkers = [' ID:', ' INDN:', ' CO ID:', ' Conf#', ' Confirmation#', ' DES:'];
    var cleaned = raw;
    cutMarkers.forEach(function (mk) {
      var idx = cleaned.indexOf(mk);
      if (idx > 0) cleaned = cleaned.slice(0, idx);
    });
    // Specific normalizations for common patterns
    cleaned = cleaned.replace(/\bPAYROLL\b.*$/i, 'PAYROLL').trim();
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    // If we have things like 'FRESHREALM INC' return that core name
    var simplifyMap = [
      { match: /freshrealm/i, name: 'FreshRealm Payroll' },
      { match: /adp\s*total\s*source/i, name: 'ADP TotalSource Payroll' },
      { match: /ach\s*electronic\s*credit\s*adp/i, name: 'ADP TotalSource Payroll' },
      { match: /etsy/i, name: 'Etsy' },
      { match: /amazon/i, name: 'Amazon' },
      { match: /origin\s*financial/i, name: 'Origin Financial' },
      { match: /stash/i, name: 'Stash' },
      { match: /zelle.*from\s+([A-Z\s]+)/i, name: null /* keep as-is for Zelle */ }
    ];
    for (var i = 0; i < simplifyMap.length; i++) {
      if (simplifyMap[i].match.test(cleaned) && simplifyMap[i].name) {
        return simplifyMap[i].name;
      }
    }
    return cleaned.slice(0, 60);
  }

  function fmtPct(n, d) {
    if (n == null || !isFinite(n)) return '0%';
    return n.toFixed(d == null ? 0 : d) + '%';
  }

  function getPeriodCutoff(period) {
    var now = new Date();
    if (period === '7') { var d = new Date(now); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return d; }
    if (period === '30') { var d2 = new Date(now); d2.setDate(d2.getDate() - 30); d2.setHours(0,0,0,0); return d2; }
    if (period === '90') { var d3 = new Date(now); d3.setDate(d3.getDate() - 90); d3.setHours(0,0,0,0); return d3; }
    if (period === 'thisMonth') return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'lastMonth') return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  function getPeriodEnd(period) {
    var now = new Date();
    if (period === 'lastMonth') return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return now;
  }
  function getPeriodLabel(period) {
    if (period === '7') return 'Last 7 days';
    if (period === '30') return 'Last 30 days';
    if (period === '90') return 'Last 90 days';
    if (period === 'thisMonth') return 'This month';
    if (period === 'lastMonth') return 'Last month';
    return 'This month';
  }

  // ---- Transfer detection ----
  function isTransfer(t) {
    if (!t) return false;
    if (t.payment_channel === 'transfer') return true;
    var cat = String(t.category || '').toLowerCase();
    if (/transfer|internal/.test(cat)) return true;
    var m = String(t.merchant || '').toLowerCase();
    if (/\bzelle\b|\bvenmo\s+(from|to)\b|wire\s+(in|out)|account\s+to\s+account|online\s+banking\s+transfer|cc\s+payment/.test(m)) return true;
    var meth = String(t.method || '').toLowerCase();
    if (/transfer|wire/.test(meth)) return true;
    return false;
  }

  function isIncome(t) {
    if (!t) return false;
    if (isTransfer(t)) return false;
    if (Number(t.amount) <= 0) return false;
    var c = String(t.category || '').toLowerCase();
    var m = String(t.merchant || '').toLowerCase();
    if (c === 'income' || /income|payroll|salary|wages|paycheck|payday/.test(c)) return true;
    if (/payroll|salary|wages|paycheck|direct\s+dep|adp\s+totalsource|fresh\s*realm|kpmg/.test(m)) return true;
    return Number(t.amount) > 0; // positive non-transfer is income
  }
  function isExpense(t) {
    if (!t) return false;
    if (isTransfer(t)) return false;
    if (!isFinite(t.amount)) return false;
    return Number(t.amount) < 0;
  }

  // ---- Account lookup (via wjp-source-badge) ----
  // v10: bank pills use window.WJP_AcctLookup populated by
  // wjp-source-badge-enhance.js v2. Falls back to t.institutionName if not
  // ready yet. Renders per-bank pills like "BoA ··0060", "Citi ··9295".
  function shortInst(name) {
    if (!name) return 'Bank';
    var lower = String(name).toLowerCase();
    if (lower.indexOf('bank of america') !== -1) return 'BoA';
    if (lower.indexOf('citibank') !== -1 || lower.indexOf('citi') !== -1) return 'Citi';
    if (lower.indexOf('jpmorgan') !== -1 || lower.indexOf('chase') !== -1) return 'Chase';
    if (lower.indexOf('wells fargo') !== -1) return 'Wells';
    if (lower.indexOf('capital one') !== -1) return 'Cap One';
    if (lower.indexOf('discover') !== -1) return 'Discover';
    if (lower.indexOf('amex') !== -1 || lower.indexOf('american express') !== -1) return 'Amex';
    if (lower.indexOf('sofi') !== -1) return 'SoFi';
    if (lower.indexOf('principal') !== -1) return 'Principal';
    return name.length > 14 ? name.slice(0, 14) + '…' : name;
  }
  function txnAccountKey(t) {
    if (!t) return 'Bank';
    var lookup = window.WJP_AcctLookup;
    if (lookup && t.plaidAccountId && lookup[t.plaidAccountId]) {
      var info = lookup[t.plaidAccountId];
      var inst = shortInst(info.institutionName);
      return info.mask ? (inst + ' ··' + info.mask) : inst;
    }
    return t.institutionName || 'Bank';
  }
  function getAccountList() {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return [];
    var seen = {};
    var list = [];
    s.transactions.forEach(function (t) {
      if (t.source !== 'plaid') return;
      var k = txnAccountKey(t);
      if (!seen[k]) {
        seen[k] = true;
        list.push({ key: k, label: k, count: 0 });
      }
    });
    s.transactions.forEach(function (t) {
      if (t.source !== 'plaid') return;
      var entry = list.find(function (e) { return e.key === txnAccountKey(t); });
      if (entry) entry.count++;
    });
    list.sort(function (a, b) { return b.count - a.count; });
    return list;
  }

  function getCurrentFilter() {
    try { return localStorage.getItem(LS_FILTER) || 'all'; } catch (_) { return 'all'; }
  }
  function setCurrentFilter(v) {
    try { localStorage.setItem(LS_FILTER, v); } catch (_) {}
  }
  function getCurrentPeriod() {
    try { return localStorage.getItem(LS_PERIOD) || 'thisMonth'; } catch (_) { return 'thisMonth'; }
  }
  function setCurrentPeriod(v) {
    try { localStorage.setItem(LS_PERIOD, v); } catch (_) {}
  }
  function getExpanded() {
    try { return localStorage.getItem(LS_EXPANDED) === '1'; } catch (_) { return false; }
  }
  function setExpanded(v) {
    try { localStorage.setItem(LS_EXPANDED, v ? '1' : '0'); } catch (_) {}
  }

  // ---- Smart Summary computation ----
  function computeSummary(period, accountFilter) {
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return null;
    var cutoff = getPeriodCutoff(period);
    var end = getPeriodEnd(period);
    var prevCutoff = new Date(cutoff.getTime() - (end.getTime() - cutoff.getTime()));

    var current = [];
    var previous = [];
    // TZ-safe date parsing — bare 'YYYY-MM-DD' strings parse as UTC midnight
    // which can drop the 1st-of-the-month in negative-UTC timezones. Force
    // local-midnight by appending T00:00:00.
    function parseTxnDate(t) {
      var raw = t.date || t.timestamp || 0;
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return new Date(raw + 'T00:00:00');
      }
      return new Date(raw);
    }
    s.transactions.forEach(function (t) {
      if (accountFilter && accountFilter !== 'all') {
        if (txnAccountKey(t) !== accountFilter) return;
      }
      // Skip synthetic recurring-payment templates — they shouldn't count
      // until the matching real Plaid transaction confirms (or the user
      // marks the synthetic as paid).
      if (t && t.synthetic === true) return;
      var d = parseTxnDate(t);
      if (isNaN(d.getTime())) return;
      if (d >= cutoff && d <= end) current.push(t);
      else if (d >= prevCutoff && d < cutoff) previous.push(t);
    });

    var income = 0, expenses = 0, transfers = 0;
    var incomeByMerchant = {};
    var spendByCategory = {};
    var prevSpendByCategory = {};
    current.forEach(function (t) {
      var amt = Number(t.amount);
      if (!isFinite(amt)) return; // skip NaN/undefined amounts
      if (isTransfer(t)) { transfers += Math.abs(amt); return; }
      if (isIncome(t)) {
        income += amt;
        var m = canonicalizeMerchant(t.merchant || 'Unknown');
        incomeByMerchant[m] = (incomeByMerchant[m] || 0) + amt;
      } else if (isExpense(t)) {
        expenses += Math.abs(amt);
        var c = smartCategorize(t);
        spendByCategory[c] = (spendByCategory[c] || 0) + Math.abs(amt);
      }
    });
    previous.forEach(function (t) {
      if (isTransfer(t) || !isExpense(t)) return;
      if (t && t.synthetic === true) return;
      var amt = Number(t.amount);
      if (!isFinite(amt)) return;
      var c = smartCategorize(t);
      prevSpendByCategory[c] = (prevSpendByCategory[c] || 0) + Math.abs(amt);
    });

    var net = income - expenses;
    var topIncome = Object.keys(incomeByMerchant)
      .map(function (k) { return { merchant: k, amount: incomeByMerchant[k] }; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .slice(0, 3);
    var allCategories = Object.keys(spendByCategory)
      .map(function (k) {
        var prev = prevSpendByCategory[k] || 0;
        var change = prev > 0 ? ((spendByCategory[k] - prev) / prev) * 100 : null;
        return { category: k, amount: spendByCategory[k], change: change };
      })
      .sort(function (a, b) { return b.amount - a.amount; });
    var topCategories = allCategories.slice(0, 3);

    // Subscription auto-detect: recurring same-merchant entries with same-ish
    // amount (within 5%) appearing 2+ times in current OR previous periods.
    var byMerchant = {};
    current.concat(previous).forEach(function (t) {
      if (!isExpense(t)) return;
      var amt = Number(t.amount);
      if (!isFinite(amt)) return;
      var m = t.merchant || '';
      if (!m) return;
      if (!byMerchant[m]) byMerchant[m] = [];
      byMerchant[m].push(Math.abs(amt));
    });
    var subscriptions = [];
    Object.keys(byMerchant).forEach(function (m) {
      var amts = byMerchant[m];
      if (amts.length < 2) return;
      var avg = amts.reduce(function (s, a) { return s + a; }, 0) / amts.length;
      var allClose = amts.every(function (a) { return Math.abs(a - avg) / avg < 0.10; });
      if (allClose && avg > 1) subscriptions.push({ merchant: m, monthlyEstimate: avg });
    });
    var subMonthlyTotal = subscriptions.reduce(function (s, x) { return s + x.monthlyEstimate; }, 0);

    // Savings suggestion: top category × 25% reduction
    var savingsTip = null;
    if (topCategories.length && topCategories[0].amount > 50) {
      var top = topCategories[0];
      var potential = top.amount * 0.25;
      savingsTip = {
        category: top.category,
        currentSpend: top.amount,
        potentialSavings: potential,
        message: 'Cutting your top spending category (' + top.category + ', ' + fmtUsd(top.amount) + ') by 25% saves ' + fmtUsd(potential) + ' this period.'
      };
    }

    // New insights for expanded view
    var biggestExpense = null;
    var biggestIncome = null;
    var merchantFreq = {};
    var bankBreakdown = {};
    var avgDailySpend = 0;
    current.forEach(function (t) {
      var amt = Number(t.amount);
      if (!isFinite(amt) || isTransfer(t)) return;
      if (isExpense(t)) {
        if (!biggestExpense || Math.abs(amt) > Math.abs(biggestExpense.amount)) {
          biggestExpense = { merchant: t.merchant || 'Unknown', amount: amt, date: t.date, category: smartCategorize(t) };
        }
        var mm = canonicalizeMerchant(t.merchant || 'Unknown');
        if (mm) merchantFreq[mm] = (merchantFreq[mm] || 0) + 1;
      } else if (isIncome(t)) {
        if (!biggestIncome || amt > biggestIncome.amount) {
          biggestIncome = { merchant: t.merchant || 'Unknown', amount: amt, date: t.date };
        }
      }
      var inst = t.institutionName || (t.source === 'plaid' ? 'Bank' : 'Manual');
      if (!bankBreakdown[inst]) bankBreakdown[inst] = { count: 0, spend: 0, income: 0 };
      bankBreakdown[inst].count++;
      if (isExpense(t)) bankBreakdown[inst].spend += Math.abs(amt);
      if (isIncome(t)) bankBreakdown[inst].income += amt;
    });
    var busiestMerchant = null;
    Object.keys(merchantFreq).forEach(function (m) {
      if (!busiestMerchant || merchantFreq[m] > busiestMerchant.count) {
        busiestMerchant = { merchant: m, count: merchantFreq[m] };
      }
    });
    // Avg daily spend
    var daysInPeriod = Math.max(1, Math.round((end.getTime() - cutoff.getTime()) / 86400000));
    avgDailySpend = expenses / daysInPeriod;

    return {
      period: period,
      periodLabel: getPeriodLabel(period),
      txCount: current.length,
      income: income,
      expenses: expenses,
      transfers: transfers,
      net: net,
      topIncome: topIncome,
      topCategories: topCategories,
      allCategories: allCategories,
      subscriptionCount: subscriptions.length,
      subscriptionMonthly: subMonthlyTotal,
      savingsTip: savingsTip,
      biggestExpense: biggestExpense,
      biggestIncome: biggestIncome,
      busiestMerchant: busiestMerchant,
      bankBreakdown: bankBreakdown,
      avgDailySpend: avgDailySpend,
      daysInPeriod: daysInPeriod
    };
  }

  // ---- UI ----
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + SUMMARY_ID + ' {',
      '  background: linear-gradient(180deg, var(--card-bg, var(--bg-2, #fff)) 0%, var(--card-2, var(--bg-3, #fafaf7)) 100%);',
      '  border: 1px solid var(--border, rgba(0,0,0,0.08));',
      '  border-radius: 16px; padding: 20px 24px; margin: 12px 0 16px;',
      '  font-family: Inter, system-ui, sans-serif;',
      '  box-shadow: 0 2px 6px rgba(0,0,0,0.04);',
      '}',
      '#' + SUMMARY_ID + ' .row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }',
      '#' + SUMMARY_ID + ' .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }',
      '#' + SUMMARY_ID + ' .head .title { font-size: 14.5px; font-weight: 800; letter-spacing: -0.01em; }',
      '#' + SUMMARY_ID + ' .head .sub { font-size: 11px; color: var(--ink-dim, var(--text-2, #6b7280)); }',
      '#' + SUMMARY_ID + ' .period-pills { display: flex; gap: 4px; flex-wrap: wrap; }',
      '#' + SUMMARY_ID + ' .period-pill {',
      '  font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px;',
      '  background: var(--bg-3, rgba(0,0,0,0.03)); color: var(--ink-dim, #6b7280);',
      '  border: 1px solid var(--border, rgba(0,0,0,0.08));',
      '  cursor: pointer; font-family: inherit; letter-spacing: 0.01em;',
      '}',
      '#' + SUMMARY_ID + ' .period-pill.active {',
      '  background: rgba(31,122,74,0.10); color: #1f7a4a; border-color: rgba(31,122,74,0.30);',
      '}',
      '#' + SUMMARY_ID + ' .metric {',
      '  flex: 1 1 140px; min-width: 140px;',
      '  background: var(--bg-3, rgba(0,0,0,0.02));',
      '  border-radius: 10px; padding: 11px 14px;',
      '}',
      '#' + SUMMARY_ID + ' .metric .label {',
      '  font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase;',
      '  color: var(--ink-dim, #6b7280); font-weight: 700; margin-bottom: 3px;',
      '}',
      '#' + SUMMARY_ID + ' .metric .value {',
      '  font-size: 17px; font-weight: 800; letter-spacing: -0.01em;',
      '}',
      '#' + SUMMARY_ID + ' .metric.income .value { color: #1f7a4a; }',
      '#' + SUMMARY_ID + ' .metric.expense .value { color: #c0594a; }',
      '#' + SUMMARY_ID + ' .metric.net.positive .value { color: #1f7a4a; }',
      '#' + SUMMARY_ID + ' .metric.net.negative .value { color: #c0594a; }',
      '#' + SUMMARY_ID + ' .metric .sub { font-size: 10px; color: var(--ink-dim, #6b7280); margin-top: 2px; font-weight: 500; }',
      '#' + SUMMARY_ID + ' .lists-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }',
      '#' + SUMMARY_ID + ' .list-title {',
      '  font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;',
      '  color: var(--ink-dim, #6b7280); margin-bottom: 8px;',
      '}',
      '#' + SUMMARY_ID + ' .list-row {',
      '  display: flex; justify-content: space-between; align-items: center;',
      '  padding: 5px 0; font-size: 11.5px;',
      '}',
      '#' + SUMMARY_ID + ' .list-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink, #0a0a0a); font-weight: 600; }',
      '#' + SUMMARY_ID + ' .list-row .amt { font-weight: 700; }',
      '#' + SUMMARY_ID + ' .list-row .pct { font-size: 10px; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-weight: 700; }',
      '#' + SUMMARY_ID + ' .pct.up { background: rgba(192,89,74,0.12); color: #c0594a; }',
      '#' + SUMMARY_ID + ' .pct.down { background: rgba(31,122,74,0.12); color: #1f7a4a; }',
      '#' + SUMMARY_ID + ' .tip-box {',
      '  margin-top: 12px; padding: 11px 14px;',
      '  background: rgba(31,122,74,0.07); border-left: 3px solid #1f7a4a;',
      '  border-radius: 8px; font-size: 12px; color: var(--ink, #0a0a0a); line-height: 1.5;',
      '}',
      '#' + SUMMARY_ID + ' .tip-box strong { color: #1f7a4a; }',
      '#' + FILTERS_ID + ' {',
      '  display: flex; gap: 6px; flex-wrap: wrap; align-items: center;',
      '  margin: 8px 0 12px; font-family: Inter, system-ui, sans-serif;',
      '}',
      '#' + FILTERS_ID + ' .acc-pill {',
      '  font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 999px;',
      '  background: var(--bg-3, rgba(0,0,0,0.04)); color: var(--ink-dim, #6b7280);',
      '  border: 1px solid var(--border, rgba(0,0,0,0.08));',
      '  cursor: pointer; font-family: inherit; letter-spacing: 0.01em;',
      '}',
      '#' + FILTERS_ID + ' .acc-pill.active {',
      '  background: rgba(31,122,74,0.10); color: #1f7a4a;',
      '  border-color: rgba(31,122,74,0.30);',
      '}',
      '#' + FILTERS_ID + ' .acc-count { opacity: 0.65; font-weight: 500; margin-left: 4px; }',
      '#' + SUMMARY_ID + ' .toggle-btn {',
      '  font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 999px;',
      '  background: rgba(31,122,74,0.08); color: #1f7a4a;',
      '  border: 1px solid rgba(31,122,74,0.25);',
      '  cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 4px;',
      '  margin-left: 8px;',
      '}',
      '#' + SUMMARY_ID + ' .toggle-btn:hover { background: rgba(31,122,74,0.14); }',
      '#' + SUMMARY_ID + ' .toggle-btn .chev { display:inline-block; transition: transform 0.18s ease; }',
      '#' + SUMMARY_ID + ' .toggle-btn.expanded .chev { transform: rotate(180deg); }',
      '#' + SUMMARY_ID + ' .expanded-block { display: none; }',
      '#' + SUMMARY_ID + '.is-expanded .expanded-block { display: block; }',
      '#' + SUMMARY_ID + ' .insight-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 14px; }',
      '#' + SUMMARY_ID + ' .insight-card {',
      '  background: var(--bg-3, rgba(0,0,0,0.02));',
      '  border: 1px solid var(--border, rgba(0,0,0,0.06));',
      '  border-radius: 10px; padding: 10px 12px;',
      '}',
      '#' + SUMMARY_ID + ' .insight-card .label { font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-dim, #6b7280); font-weight: 700; margin-bottom: 4px; }',
      '#' + SUMMARY_ID + ' .insight-card .value { font-size: 13.5px; font-weight: 800; color: var(--ink, #0a0a0a); margin-bottom: 2px; }',
      '#' + SUMMARY_ID + ' .insight-card .sub { font-size: 10.5px; color: var(--ink-dim, #6b7280); }',
      '#' + SUMMARY_ID + ' .all-cats-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-dim, #6b7280); margin: 18px 0 8px; }',
      '#' + SUMMARY_ID + ' .all-cats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px 14px; }',
      '#' + SUMMARY_ID + ' .all-cats-row {',
      '  display: flex; justify-content: space-between; align-items: center;',
      '  padding: 6px 10px; font-size: 11.5px; border-radius: 8px;',
      '  background: var(--bg-2, rgba(0,0,0,0.015));',
      '}',
      '#' + SUMMARY_ID + ' .all-cats-row .name { color: var(--ink, #0a0a0a); font-weight: 600; }',
      '#' + SUMMARY_ID + ' .all-cats-row .amt { font-weight: 700; color: #c0594a; }',
      '#' + SUMMARY_ID + ' .all-cats-row .pct { font-size: 9.5px; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-weight: 700; }',
      '#' + SUMMARY_ID + ' .bank-bd { margin-top: 14px; }',
      '#' + SUMMARY_ID + ' .bank-bd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }',
      '#' + SUMMARY_ID + ' .bank-bd-card { background: var(--bg-2, rgba(0,0,0,0.02)); border: 1px solid var(--border, rgba(0,0,0,0.06)); border-radius: 9px; padding: 9px 12px; }',
      '#' + SUMMARY_ID + ' .bank-bd-card .name { font-size: 12px; font-weight: 700; color: var(--ink, #0a0a0a); margin-bottom: 3px; }',
      '#' + SUMMARY_ID + ' .bank-bd-card .stats { font-size: 10.5px; color: var(--ink-dim, #6b7280); }',
      '@media (max-width: 600px) { #' + SUMMARY_ID + ' .lists-row { grid-template-columns: 1fr; } }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // Find the Transactions panel anchor in the DOM. The panel has a stats bar
  // (#txn-stats-bar) and a tbody (#txn-tbody). Insert summary above stats bar.
  function getInsertionPoint() {
    var stats = document.getElementById('txn-stats-bar');
    if (stats && stats.parentElement) return { stats: stats, parent: stats.parentElement };
    return null;
  }

  function renderFilters(parent, accountFilter) {
    var accounts = getAccountList();
    if (!accounts.length) return;
    var existing = document.getElementById(FILTERS_ID);
    var wrap;
    var isNewFilt = !existing;
    if (existing) {
      wrap = existing;
    } else {
      wrap = document.createElement('div');
      wrap.id = FILTERS_ID;
    }
    var html = '<span class="acc-pill ' + (accountFilter === 'all' ? 'active' : '') + '" data-acc="all">All</span>';
    accounts.forEach(function (a) {
      html += '<span class="acc-pill ' + (accountFilter === a.key ? 'active' : '') + '" data-acc="' + a.key.replace(/"/g, '&quot;') + '">' +
        a.label + '<span class="acc-count">·' + a.count + '</span></span>';
    });
    wrap.innerHTML = html;
    if (isNewFilt) parent.parentElement.insertBefore(wrap, parent);
    Array.prototype.forEach.call(wrap.querySelectorAll('.acc-pill'), function (p) {
      p.onclick = function () {
        var v = p.getAttribute('data-acc');
        setCurrentFilter(v);
        Array.prototype.forEach.call(wrap.querySelectorAll('.acc-pill'), function (q) { q.classList.remove('active'); });
        p.classList.add('active');
        // Re-render summary
        renderSummary();
        // Trigger Transactions tab re-render
        try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
        // Also hide table rows that don't match the institution filter.
        try { applyAccountFilterToTable(); } catch (_) {}
        // Fire a custom event so other modules (e.g. wjp-txn-stats-fix) can
        // recompute their numbers using the new account filter.
        try { document.dispatchEvent(new CustomEvent('wjp-account-filter-changed', { detail: { account: v } })); } catch (_) {}
      };
    });
  }

  // Hide table rows whose txn doesn't match the current account filter. We
  // look up each row's txn id, find the txn in appState, compare its
  // institutionName to the active filter.
  function applyAccountFilterToTable() {
    var filter = getCurrentFilter();
    var tbody = document.getElementById('txn-tbody');
    if (!tbody) return;
    var state = getAppState();
    var txnsById = {};
    if (state && Array.isArray(state.transactions)) {
      state.transactions.forEach(function (t) { if (t && t.id) txnsById[t.id] = t; });
    }
    var rows = tbody.querySelectorAll('tr.txn-row');
    var hiddenCount = 0;
    rows.forEach(function (row) {
      var id = row.getAttribute('data-txn-id');
      var t = txnsById[id];
      var key = t && txnAccountKey(t);
      var matches = (filter === 'all') || (key === filter);
      row.style.display = matches ? '' : 'none';
      if (!matches) hiddenCount++;
    });
    // Update pagination label so user sees the post-filter count
    try {
      var label = document.getElementById('txn-page-label');
      if (label && filter !== 'all') {
        var totalShown = rows.length - hiddenCount;
        label.textContent = 'Showing ' + totalShown + ' of ' + rows.length + ' (' + filter + ')';
      }
    } catch (_) {}
  }
  // Re-apply filter after any host re-render so the chip's effect is sticky.
  if (typeof window !== 'undefined') {
    window.WJP_TxnTabFilter = { apply: applyAccountFilterToTable };
  }

  function renderSummary() {
    var ip = getInsertionPoint();
    if (!ip) return;
    var period = getCurrentPeriod();
    var accountFilter = getCurrentFilter();
    var sum = computeSummary(period, accountFilter === 'all' ? null : accountFilter);
    if (!sum) return;

    // v3 fix 2026-05-19 — build html first, update existing in place instead
    // of remove+recreate (which was flickering the Smart Summary every tick).
    var existing = document.getElementById(SUMMARY_ID);
    var box;
    var isNew = !existing;
    if (existing) {
      box = existing;
    } else {
      box = document.createElement('div');
      box.id = SUMMARY_ID;
    }
    var netClass = sum.net >= 0 ? 'positive' : 'negative';
    var periodPills = ['7','30','thisMonth','lastMonth','90'].map(function (p) {
      return '<span class="period-pill ' + (p === period ? 'active' : '') + '" data-period="' + p + '">' + getPeriodLabel(p) + '</span>';
    }).join('');

    var topIncomeHtml = sum.topIncome.length
      ? sum.topIncome.map(function (i) {
          return '<div class="list-row"><span class="name">' + i.merchant + '</span><span class="amt" style="color:#1f7a4a;">' + fmtUsd(i.amount) + '</span></div>';
        }).join('')
      : '<div class="list-row" style="color:var(--ink-dim,#6b7280);">No income this period</div>';

    var topCatsHtml = sum.topCategories.length
      ? sum.topCategories.map(function (c) {
          var pct = c.change != null ? ('<span class="pct ' + (c.change > 0 ? 'up' : 'down') + '">' + (c.change > 0 ? '+' : '') + Math.round(c.change) + '%</span>') : '';
          return '<div class="list-row"><span class="name">' + c.category + '</span><span class="amt" style="color:#c0594a;">' + fmtUsd(c.amount) + '</span>' + pct + '</div>';
        }).join('')
      : '<div class="list-row" style="color:var(--ink-dim,#6b7280);">No spending this period</div>';

    var subBlurb = sum.subscriptionCount > 0
      ? '<div style="margin-top:12px;padding:9px 12px;background:rgba(168,85,247,0.07);border-left:3px solid #a855f7;border-radius:8px;font-size:11.5px;line-height:1.5;color:var(--ink,#0a0a0a);"><strong style="color:#a855f7;">Subscriptions:</strong> ~' + fmtUsd(sum.subscriptionMonthly) + '/mo across ' + sum.subscriptionCount + ' recurring service' + (sum.subscriptionCount === 1 ? '' : 's') + '.</div>'
      : '';

    var tipBlurb = sum.savingsTip
      ? '<div class="tip-box">💡 <strong>Save up to ' + fmtUsd(sum.savingsTip.potentialSavings) + ':</strong> ' + sum.savingsTip.message + '</div>'
      : '';

    // --- Build expanded-block insights ---
    var allCatsHtml = (sum.allCategories && sum.allCategories.length)
      ? sum.allCategories.map(function (c) {
          var pct = c.change != null ? ('<span class="pct ' + (c.change > 0 ? 'up' : 'down') + '">' + (c.change > 0 ? '+' : '') + Math.round(c.change) + '%</span>') : '';
          return '<div class="all-cats-row"><span class="name">' + c.category + '</span><span><span class="amt">' + fmtUsd(c.amount) + '</span>' + pct + '</span></div>';
        }).join('')
      : '<div class="all-cats-row" style="color:var(--ink-dim,#6b7280);">No spending categories this period</div>';

    var insightCards = [];
    if (sum.biggestExpense) {
      insightCards.push('<div class="insight-card"><div class="label">Biggest single expense</div><div class="value" style="color:#c0594a;">-' + fmtUsd(Math.abs(sum.biggestExpense.amount)) + '</div><div class="sub">' + sum.biggestExpense.merchant + ' · ' + sum.biggestExpense.category + '</div></div>');
    }
    if (sum.biggestIncome) {
      insightCards.push('<div class="insight-card"><div class="label">Biggest single deposit</div><div class="value" style="color:#1f7a4a;">+' + fmtUsd(sum.biggestIncome.amount) + '</div><div class="sub">' + sum.biggestIncome.merchant + '</div></div>');
    }
    if (sum.avgDailySpend > 0) {
      insightCards.push('<div class="insight-card"><div class="label">Avg daily spend</div><div class="value">' + fmtUsd(sum.avgDailySpend) + '</div><div class="sub">across ' + sum.daysInPeriod + ' days</div></div>');
    }
    if (sum.busiestMerchant) {
      insightCards.push('<div class="insight-card"><div class="label">Most-used merchant</div><div class="value">' + sum.busiestMerchant.merchant + '</div><div class="sub">' + sum.busiestMerchant.count + ' transactions</div></div>');
    }
    var insightHtml = insightCards.length
      ? '<div class="insight-grid">' + insightCards.join('') + '</div>'
      : '';

    // Bank breakdown
    var bankBdHtml = '';
    if (sum.bankBreakdown && Object.keys(sum.bankBreakdown).length > 1) {
      var bbRows = Object.keys(sum.bankBreakdown)
        .map(function (k) { return { name: k, data: sum.bankBreakdown[k] }; })
        .sort(function (a, b) { return b.data.count - a.data.count; })
        .map(function (b) {
          return '<div class="bank-bd-card"><div class="name">' + b.name + '</div><div class="stats">' + b.data.count + ' txns · -' + fmtUsd(b.data.spend) + ' spent' + (b.data.income > 0 ? ' · +' + fmtUsd(b.data.income) + ' in' : '') + '</div></div>';
        }).join('');
      bankBdHtml = '<div class="bank-bd"><div class="all-cats-title">By bank</div><div class="bank-bd-grid">' + bbRows + '</div></div>';
    }

    var expanded = getExpanded();
    if (expanded) box.classList.add('is-expanded'); else box.classList.remove('is-expanded');
    var togLabel = expanded ? 'Less' : 'More insights';

    box.innerHTML =
      '<div class="head">' +
        '<div>' +
          '<div class="title">Smart Summary</div>' +
          '<div class="sub">' + sum.txCount + ' transactions · ' + sum.periodLabel + (accountFilter !== 'all' ? ' · ' + accountFilter : '') + ' · transfers excluded</div>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
          '<div class="period-pills">' + periodPills + '</div>' +
          '<button type="button" class="toggle-btn ' + (expanded ? 'expanded' : '') + '" id="wjp-tx-summary-toggle" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + togLabel + ' <span class="chev">▾</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="metric income"><div class="label">Income</div><div class="value">+' + fmtUsd(sum.income) + '</div><div class="sub">' + sum.topIncome.length + ' income source' + (sum.topIncome.length === 1 ? '' : 's') + '</div></div>' +
        '<div class="metric expense"><div class="label">Spending</div><div class="value">-' + fmtUsd(sum.expenses) + '</div><div class="sub">excluding ' + fmtUsd(sum.transfers) + ' in transfers</div></div>' +
        '<div class="metric net ' + netClass + '"><div class="label">Net Cashflow</div><div class="value">' + (sum.net >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(sum.net)).toLocaleString() + '</div><div class="sub">' + (sum.net >= 0 ? 'cash-positive' : 'running over budget') + '</div></div>' +
      '</div>' +
      // Expanded section
      '<div class="expanded-block">' +
        '<div class="lists-row">' +
          '<div><div class="list-title">Top income</div>' + topIncomeHtml + '</div>' +
          '<div><div class="list-title">Top spending</div>' + topCatsHtml + '</div>' +
        '</div>' +
        insightHtml +
        '<div class="all-cats-title">All spending categories</div>' +
        '<div class="all-cats-grid">' + allCatsHtml + '</div>' +
        bankBdHtml +
        subBlurb +
        tipBlurb +
      '</div>';

    if (isNew) ip.parent.insertBefore(box, ip.stats);

    // Wire toggle button
    var togBtn = box.querySelector('#wjp-tx-summary-toggle');
    if (togBtn) {
      togBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(!getExpanded());
        renderSummary();
      };
    }

    // Wire period pills
    Array.prototype.forEach.call(box.querySelectorAll('.period-pill'), function (p) {
      p.onclick = function () {
        setCurrentPeriod(p.getAttribute('data-period'));
        renderSummary();
      };
    });

    // Render filters above the summary
    renderFilters(box, accountFilter);
  }

  function tick() {
    try {
      injectStyle();
      var ip = getInsertionPoint();
      if (!ip) return; // not on Transactions tab
      renderSummary();
    } catch (e) {
      try { console.warn('[wjp-tx-tab-enhance] tick failed', e); } catch (_) {}
    }
  }

  function boot() {
    injectStyle();
    setInterval(tick, 6000);
    window.addEventListener('hashchange', function () { setTimeout(tick, 300); });
    window.addEventListener('wjp-tx-category-changed', tick);
    window.addEventListener('wjp-transactions-rehydrated', tick);
    window.addEventListener('wjp-acct-lookup-ready', function () { setTimeout(tick, 200); });
    setTimeout(tick, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TxTabEnhance = {
    render: tick,
    computeSummary: computeSummary,
    isTransfer: isTransfer,
    version: 1
  };
})();
