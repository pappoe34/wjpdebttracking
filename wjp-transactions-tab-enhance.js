/* wjp-transactions-tab-enhance.js v12 — page-size picker moved to search row right corner; bank row cleaner v11 — bigger All chip + smaller bank chips with brand colors + settings gear add/remove + page size picker v9 — collapsible Smart Summary + ALL categories + improved insights + per-bank toggle preserved. v8 — smart categorizer applied for real — clickable bank chips filter table v4 — group paychecks by employer v3 — exclude synthetic from Smart Summary v2 — TZ-safe date parsing v1 — Transactions tab Smart Summary + filters. */
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
      // v19 (2026-05-26): if the user has renamed this account (override
      // applied via wjp-acct-name-sync), show the rename verbatim — bypass
      // shortInst()'s aggressive abbreviation (e.g. 'Bank of America' -> 'BoA').
      if (info.userRenamed && info.userDisplayName) {
        var nm = String(info.userDisplayName);
        // Truncate at 24 chars + mask
        if (nm.length > 24) nm = nm.slice(0, 24) + '…';
        return info.mask ? (nm + ' ··' + info.mask) : nm;
      }
      var inst = shortInst(info.institutionName);
      return info.mask ? (inst + ' ··' + info.mask) : inst;
    }
    return t.institutionName || 'Bank';
  }
  // v13: Expose for app.js's closure-local txnGetFiltered so bank filter
  // applies to the FULL transaction list before pagination.
  try { window.WJP_TxAccountKey = txnAccountKey; } catch (_) {}
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
        // v20 (2026-05-26): also carry plaidAccountId so the bank-vis modal
        // can offer a rename action wired to wjp-acct-name-sync.
        list.push({ key: k, label: k, count: 0, accountId: t.plaidAccountId || null });
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

  // v11 — Brand colors per bank + visibility list + page-size CSS
  var BANK_COLORS = {
    'BoA':        { bg:'#012169', text:'#ffffff', soft:'rgba(1,33,105,0.10)' },
    'Citi':       { bg:'#003a72', text:'#ffffff', soft:'rgba(0,58,114,0.10)' },
    'Chase':      { bg:'#117ACA', text:'#ffffff', soft:'rgba(17,122,202,0.10)' },
    'Wells':      { bg:'#D71E28', text:'#ffffff', soft:'rgba(215,30,40,0.10)' },
    'Cap One':    { bg:'#004977', text:'#ffffff', soft:'rgba(0,73,119,0.10)' },
    'SoFi':       { bg:'#00A4FF', text:'#ffffff', soft:'rgba(0,164,255,0.12)' },
    'Amex':       { bg:'#016FD0', text:'#ffffff', soft:'rgba(1,111,208,0.10)' },
    'Discover':   { bg:'#FF6B00', text:'#ffffff', soft:'rgba(255,107,0,0.10)' },
    'Principal':  { bg:'#0061A0', text:'#ffffff', soft:'rgba(0,97,160,0.10)' },
    '__default':  { bg:'#475569', text:'#ffffff', soft:'rgba(71,85,105,0.10)' }
  };
  function bankColor(label) {
    var brand = String(label).split(' \u00b7\u00b7')[0];
    return BANK_COLORS[brand] || BANK_COLORS.__default;
  }
  var LS_HIDDEN_BANKS = 'wjp.tx.hiddenBanks';
  function getHiddenBanks() {
    try { var raw = localStorage.getItem(LS_HIDDEN_BANKS); return raw ? JSON.parse(raw) : []; } catch (_) { return []; }
  }
  function setHiddenBanks(arr) {
    try { localStorage.setItem(LS_HIDDEN_BANKS, JSON.stringify(arr || [])); } catch (_) {}
  }
  function injectSelectorStyle() {
    if (document.getElementById('wjp-tx-selector-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-tx-selector-style';
    st.textContent = [
      '#' + FILTERS_ID + ' { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0 12px; font-family:Inter,system-ui,sans-serif; }',
      '#' + FILTERS_ID + ' .acc-pill {',
      '  display:inline-flex; align-items:center; gap:7px;',
      '  cursor:pointer; font-family:inherit;',
      '  border:1.5px solid transparent; transition:transform 0.15s ease, box-shadow 0.15s ease;',
      '  box-shadow:0 1px 2px rgba(0,0,0,0.04); white-space:nowrap;',
      '}',
      '#' + FILTERS_ID + ' .acc-pill:hover { transform:translateY(-1px); box-shadow:0 4px 10px rgba(0,0,0,0.10); }',
      // Big All chip
      '#' + FILTERS_ID + ' .acc-all {',
      '  font-size:13px; font-weight:800; padding:9px 18px; border-radius:12px;',
      '  background:var(--bg-3,rgba(0,0,0,0.04)); color:var(--ink,#0a0a0a);',
      '  border-color:var(--border,rgba(0,0,0,0.12));',
      '  letter-spacing:-0.005em;',
      '}',
      '#' + FILTERS_ID + ' .acc-all.active { background:#1f7a4a; color:#fff; border-color:#1f7a4a; box-shadow:0 4px 14px rgba(31,122,74,0.30); }',
      '#' + FILTERS_ID + ' .acc-all .dot-all { width:9px; height:9px; border-radius:50%; background:#1f7a4a; flex-shrink:0; }',
      '#' + FILTERS_ID + ' .acc-all.active .dot-all { background:#fff; }',
      '#' + FILTERS_ID + ' .acc-all .acc-count { font-size:11px; font-weight:700; opacity:0.78; padding:1px 8px; border-radius:99px; background:rgba(0,0,0,0.05); }',
      '#' + FILTERS_ID + ' .acc-all.active .acc-count { background:rgba(255,255,255,0.22); color:#fff; opacity:1; }',
      // Smaller per-bank chips
      '#' + FILTERS_ID + ' .acc-bank {',
      '  font-size:11px; font-weight:700; padding:5px 11px; border-radius:9px;',
      '}',
      '#' + FILTERS_ID + ' .acc-bank .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }',
      '#' + FILTERS_ID + ' .acc-bank .acc-count { font-size:10px; font-weight:600; opacity:0.7; padding:0 4px; }',
      '#' + FILTERS_ID + ' .acc-bank.active .acc-count { opacity:1; background:rgba(255,255,255,0.22); color:#fff; border-radius:99px; padding:1px 7px; }',
      // Gear settings
      '#' + FILTERS_ID + ' .acc-settings {',
      '  font-size:13px; padding:6px 9px; border-radius:9px; line-height:1;',
      '  background:var(--bg-3,rgba(0,0,0,0.04)); color:var(--ink-dim,#6b7280);',
      '  border:1.5px solid var(--border,rgba(0,0,0,0.10)); cursor:pointer;',
      '  transition:background 0.15s ease, color 0.15s ease;',
      '}',
      '#' + FILTERS_ID + ' .acc-settings:hover { background:rgba(31,122,74,0.10); color:#1f7a4a; border-color:rgba(31,122,74,0.30); }',
      // Page size picker
      '#' + FILTERS_ID + ' .pagesize-row {',
      '  display:inline-flex; align-items:center; gap:3px; margin-left:auto;',
      '  background:var(--bg-3,rgba(0,0,0,0.03)); border:1px solid var(--border,rgba(0,0,0,0.08));',
      '  border-radius:10px; padding:3px;',
      '}',
      '#' + FILTERS_ID + ' .pagesize-label { font-size:10px; font-weight:700; color:var(--ink-dim,#6b7280); padding:0 8px; letter-spacing:0.06em; text-transform:uppercase; }',
      '#' + FILTERS_ID + ' .ps-btn {',
      '  font-size:11px; font-weight:700; padding:4px 9px; border-radius:7px;',
      '  background:transparent; color:var(--ink-dim,#6b7280); border:0;',
      '  cursor:pointer; font-family:inherit;',
      '}',
      '#' + FILTERS_ID + ' .ps-btn:hover:not(.active) { background:rgba(0,0,0,0.05); color:var(--ink,#0a0a0a); }',
      '#' + FILTERS_ID + ' .ps-btn.active { background:#1f7a4a; color:#fff; }',
      // Visibility modal
      '#wjp-bank-vis-modal { position:fixed; inset:0; z-index:100002; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; padding:20px; font-family:Inter,system-ui,sans-serif; }',
      '#wjp-bank-vis-modal .panel { background:var(--card,#fff); color:var(--ink,#0a0a0a); max-width:420px; width:100%; border-radius:14px; border:1px solid var(--border,rgba(0,0,0,0.10)); box-shadow:0 30px 80px rgba(0,0,0,0.40); padding:22px; }',
      '#wjp-bank-vis-modal h3 { font-size:15px; font-weight:800; margin:0 0 4px; letter-spacing:-0.01em; }',
      '#wjp-bank-vis-modal .sub { font-size:11.5px; color:var(--ink-dim,#6b7280); margin-bottom:14px; line-height:1.5; }',
      '#wjp-bank-vis-modal .list { max-height:340px; overflow-y:auto; }',
      '#wjp-bank-vis-modal .row { display:flex; align-items:center; gap:10px; padding:8px 6px; border-radius:8px; cursor:pointer; }',
      '#wjp-bank-vis-modal .row:hover { background:var(--bg-3,rgba(0,0,0,0.04)); }',
      '#wjp-bank-vis-modal .row input { accent-color:#1f7a4a; width:16px; height:16px; }',
      '#wjp-bank-vis-modal .row .swatch { width:14px; height:14px; border-radius:4px; flex-shrink:0; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.08); }',
      '#wjp-bank-vis-modal .row .name { flex:1; font-size:13px; font-weight:700; }',
      '#wjp-bank-vis-modal .row .count { font-size:11px; color:var(--ink-dim,#6b7280); font-weight:600; }',
      '#wjp-bank-vis-modal .actions { display:flex; gap:8px; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid var(--border,rgba(0,0,0,0.08)); }',
      '#wjp-bank-vis-modal .quick { display:flex; gap:6px; }',
      '#wjp-bank-vis-modal .quick a { font-size:11px; font-weight:700; color:#1f7a4a; cursor:pointer; padding:4px 8px; border-radius:6px; }',
      '#wjp-bank-vis-modal .quick a:hover { background:rgba(31,122,74,0.10); }',
      '#wjp-bank-vis-modal .btn { padding:8px 16px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer; border:1px solid; font-family:inherit; }',
      '#wjp-bank-vis-modal .btn-pri { background:#1f7a4a; color:#fff; border-color:#1f7a4a; }',
      '#wjp-bank-vis-modal .btn-sec { background:var(--bg-3,rgba(0,0,0,0.05)); color:var(--ink,#0a0a0a); border-color:var(--border,rgba(0,0,0,0.10)); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function openBankVisibilityModal() {
    var accounts = getAccountList();
    var hidden = getHiddenBanks();
    var existing = document.getElementById('wjp-bank-vis-modal');
    if (existing) existing.remove();
    var m = document.createElement('div');
    m.id = 'wjp-bank-vis-modal';
    function buildRows(hiddenSet) {
      return accounts.map(function (a) {
        var c = bankColor(a.label);
        var isHidden = hiddenSet.indexOf(a.key) !== -1;
        var renameBtn = a.accountId
          ? '<button type="button" class="bv-rename" data-acct-id="' + a.accountId.replace(/"/g, '&quot;') + '" title="Rename this account" aria-label="Rename" style="margin-left:auto;background:transparent;border:1px solid var(--border,rgba(0,0,0,0.10));color:var(--ink,var(--text-1,#1f1a14));font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">✏️ Rename</button>'
          : '';
        return '<label class="row" style="display:flex;align-items:center;gap:8px;">' +
          '<input type="checkbox" data-acc-key="' + a.key.replace(/"/g, '&quot;') + '" ' + (isHidden ? '' : 'checked') + '/>' +
          '<span class="swatch" style="background:' + c.bg + ';"></span>' +
          '<span class="name">' + a.label + '</span>' +
          '<span class="count">' + a.count + ' txn' + (a.count === 1 ? '' : 's') + '</span>' +
          renameBtn +
        '</label>';
      }).join('');
    }
    m.innerHTML =
      '<div class="panel">' +
        '<h3>Show or rename banks</h3>' +
        '<div class="sub">Check the banks you want to see as filter chips. Click <strong>Rename</strong> to give an account a friendlier name (e.g. "Joint Checking"). Renames apply everywhere in the app.</div>' +
        '<div class="list">' + buildRows(hidden) + '</div>' +
        '<div class="actions">' +
          '<div class="quick"><a id="wjp-bv-all">Select all</a><a id="wjp-bv-none">Hide all</a></div>' +
          '<div>' +
            '<button class="btn btn-sec" id="wjp-bv-cancel" type="button">Cancel</button>' +
            '<button class="btn btn-pri" id="wjp-bv-save" type="button" style="margin-left:6px;">Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    document.getElementById('wjp-bv-cancel').onclick = function () { m.remove(); };
    document.getElementById('wjp-bv-all').onclick = function () {
      Array.prototype.forEach.call(m.querySelectorAll('input[type="checkbox"]'), function (cb) { cb.checked = true; });
    };
    document.getElementById('wjp-bv-none').onclick = function () {
      Array.prototype.forEach.call(m.querySelectorAll('input[type="checkbox"]'), function (cb) { cb.checked = false; });
    };
    // v20 (2026-05-26): Rename action — opens prompt, writes override to
    // localStorage, dispatches wjp-acct-renamed which wjp-acct-name-sync
    // catches to propagate to WJP_AcctLookup + re-render.
    Array.prototype.forEach.call(m.querySelectorAll('.bv-rename'), function (btn) {
      btn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var acctId = btn.getAttribute('data-acct-id');
        if (!acctId) return;
        var row = btn.closest('.row');
        var currentName = row && row.querySelector('.name') ? row.querySelector('.name').textContent.trim() : '';
        var input = window.prompt('New name for this account (or leave blank to clear the rename):', currentName);
        if (input === null) return; // user cancelled
        var trimmed = String(input).trim().slice(0, 60);
        try {
          var uid = (window.__wjpUser && window.__wjpUser.uid) || null;
          if (!uid) { alert('You must be signed in to rename an account.'); return; }
          var key = 'wjp.account_overrides.uid_' + uid;
          var raw = localStorage.getItem(key);
          var map = {};
          try { map = raw ? (JSON.parse(raw) || {}) : {}; } catch (_) { map = {}; }
          if (trimmed) {
            map[acctId] = { displayName: trimmed, updatedAt: Date.now() };
          } else {
            delete map[acctId]; // empty input -> clear the rename
          }
          localStorage.setItem(key, JSON.stringify(map));
          // Dispatch the same event wjp-debts-overview-enhance fires from
          // saveOverride — wjp-acct-name-sync handles WJP_AcctLookup update
          // and re-render.
          window.dispatchEvent(new CustomEvent('wjp-acct-renamed', { detail: { accountId: acctId, displayName: trimmed || null } }));
          // Also update the label in this modal row immediately so user
          // sees the change without re-opening.
          if (row && row.querySelector('.name')) {
            // Pull fresh label from WJP_AcctLookup if present, else use prompt input
            var freshLabel = '';
            try {
              var l = window.WJP_AcctLookup && window.WJP_AcctLookup[acctId];
              if (l && l.userRenamed && l.userDisplayName) {
                var nm = String(l.userDisplayName);
                if (nm.length > 24) nm = nm.slice(0, 24) + '…';
                freshLabel = l.mask ? (nm + ' ··' + l.mask) : nm;
              }
            } catch (_) {}
            row.querySelector('.name').textContent = freshLabel || trimmed || row.querySelector('.name').textContent;
          }
        } catch (e) {
          alert('Could not save the rename: ' + (e && e.message ? e.message : 'unknown error'));
        }
      };
    });
    document.getElementById('wjp-bv-save').onclick = function () {
      var checked = m.querySelectorAll('input[type="checkbox"]');
      var newHidden = [];
      Array.prototype.forEach.call(checked, function (cb) {
        if (!cb.checked) newHidden.push(cb.getAttribute('data-acc-key'));
      });
      setHiddenBanks(newHidden);
      m.remove();
      // If user hid the currently selected bank, fall back to All
      var cur = getCurrentFilter();
      if (cur !== 'all' && newHidden.indexOf(cur) !== -1) setCurrentFilter('all');
      renderSummary();
    };
  }

  // v15 — Self-contained transaction renderer for the active bank chip.
  // Bypasses app.js's txnRenderTable / txnRenderAll wrapper chain so chip
  // clicks always reflect the chip's actual filter, regardless of any memo
  // caching or coalesce-debounce in other modules.
  function fmtUsdSigned(n) {
    if (!isFinite(n)) return '$0';
    var sign = n >= 0 ? '+' : '-';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    try {
      var d = (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso))
        ? new Date(iso + 'T00:00:00')
        : new Date(iso);
      return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) { return iso || ''; }
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function customRenderBankRows() {
    var filter = getCurrentFilter();
    var ps = (typeof window.WJP_GetTxnPageSize === 'function') ? window.WJP_GetTxnPageSize() : 10;
    if (![10,20,30,50,100].includes(ps)) ps = 10;
    var s = getAppState();
    if (!s || !Array.isArray(s.transactions)) return;
    var list = s.transactions.slice();
    // Apply bank filter ONLY when a specific bank is selected (not 'all').
    if (filter && filter !== 'all') {
      list = list.filter(function (t) { return txnAccountKey(t) === filter; });
    }
    // Sort desc by date
    list.sort(function (a, b) {
      var da = new Date(a.date || a.timestamp || 0).getTime();
      var db = new Date(b.date || b.timestamp || 0).getTime();
      return db - da;
    });
    var total = list.length;
    var page = (window._wjpTxnState && window._wjpTxnState.page) || 0;
    if (page * ps >= total && total > 0) page = 0;
    var start = page * ps;
    var end = Math.min(start + ps, total);
    var slice = list.slice(start, end);

    var tbody = document.getElementById('txn-tbody');
    if (!tbody) return;

    if (slice.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3,#6b7280);">' +
        'No transactions for ' + (filter === 'all' ? 'this filter' : filter) +
        '</td></tr>';
    } else {
      var html = slice.map(function (t) {
        var amt = Number(t.amount) || 0;
        var amtColor = amt < 0 ? 'var(--danger, #c0594a)' : 'var(--accent, #1f7a4a)';
        var amtStr = (amt < 0 ? '-$' : '+$') + Math.abs(amt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        var status = (t.status || 'completed').toLowerCase();
        var statusColors = { completed: 'var(--accent, #1f7a4a)', pending: 'var(--warning, #fbbf24)', failed: 'var(--danger, #c0594a)' };
        var statusDot = statusColors[status] || statusColors.completed;
        var statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        var srcBadge = (typeof window.renderTxnSourceBadge === 'function') ? window.renderTxnSourceBadge(t) : '';
        var srcKind = (typeof window.getTxnSourceMeta === 'function') ? (window.getTxnSourceMeta(t) || {}).kind : 'manual';
        var cat = t.category || 'Other';
        var catBg = 'var(--card-2, rgba(0,0,0,0.04))';
        var catClr = 'var(--text-3, #6b7280)';
        return '<tr class="txn-row" data-txn-id="' + escapeAttr(t.id) + '" data-src-kind="' + escapeAttr(srcKind) + '" style="cursor:pointer;">' +
          '<td>' + srcBadge + '</td>' +
          '<td class="txn-date">' + fmtDate(t.date) + '</td>' +
          '<td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeAttr(t.merchant || 'Unknown') + '</td>' +
          '<td><div class="badge" style="background:' + catBg + ';color:' + catClr + ';font-size:9px;white-space:nowrap;">' + escapeAttr(cat) + '</div></td>' +
          '<td style="font-weight:700;color:' + amtColor + ';white-space:nowrap;">' + amtStr + '</td>' +
          '<td class="txn-method" style="font-size:11px;">' + escapeAttr(t.method || 'N/A') + '</td>' +
          '<td><span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:' + statusDot + ';">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:' + statusDot + ';flex-shrink:0;display:inline-block;"></span>' + statusLabel +
          '</span></td>' +
          '<td style="text-align:center;white-space:nowrap;">' +
            '<button class="btn-txn-edit" data-txn-id="' + escapeAttr(t.id) + '" style="background:rgba(0,212,168,0.10);border:1px solid rgba(0,212,168,0.25);cursor:pointer;color:var(--accent);font-size:13px;padding:5px 8px;border-radius:6px;opacity:0.85;margin-right:4px;" title="Edit"><i class="ph ph-pencil-simple"></i></button>' +
            '<button class="btn-txn-del" data-txn-id="' + escapeAttr(t.id) + '" style="background:rgba(255,77,109,0.10);border:1px solid rgba(255,77,109,0.25);cursor:pointer;color:#ff4d6d;font-size:13px;padding:5px 8px;border-radius:6px;opacity:0.85;" title="Delete"><i class="ph ph-trash"></i></button>' +
          '</td>' +
        '</tr>';
      }).join('');
      tbody.innerHTML = html;
    }
    // Update page label
    var label = document.getElementById('txn-page-label');
    if (label) {
      label.textContent = total === 0
        ? 'No results' + (filter !== 'all' ? ' for ' + filter : '')
        : 'Showing ' + (start + 1) + '\u2013' + end + ' of ' + total + ' transactions' + (filter !== 'all' ? ' (' + filter + ')' : '');
    }
    // Update prev/next disabled
    var prev = document.getElementById('btn-txn-prev');
    var next = document.getElementById('btn-txn-next');
    if (prev) prev.disabled = page === 0;
    if (next) next.disabled = end >= total;
    // Wire row clicks so detail panel still opens
    Array.prototype.forEach.call(tbody.querySelectorAll('.txn-row'), function (row) {
      row.onclick = function (e) {
        if (e.target.closest('.btn-txn-del') || e.target.closest('.btn-txn-edit')) return;
        var id = row.getAttribute('data-txn-id');
        var t = (getAppState().transactions || []).find(function (x) { return x.id === id; });
        if (t && typeof window.txnShowDetail === 'function') window.txnShowDetail(t);
      };
    });
    Array.prototype.forEach.call(tbody.querySelectorAll('.btn-txn-edit'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var id = b.getAttribute('data-txn-id');
        var t = (getAppState().transactions || []).find(function (x) { return x.id === id; });
        if (t && typeof window.txnOpenEditModal === 'function') window.txnOpenEditModal(t);
      };
    });
  }
  window.WJP_CustomTxnRender = customRenderBankRows;

  function renderFilters(parent, accountFilter) {
    injectSelectorStyle();
    var accounts = getAccountList();
    if (!accounts.length) return;
    var hidden = getHiddenBanks();
    var existing = document.getElementById(FILTERS_ID);
    var wrap;
    var isNewFilt = !existing;
    if (existing) { wrap = existing; } else { wrap = document.createElement('div'); wrap.id = FILTERS_ID; }

    var totalCount = accounts.reduce(function (a, b) { return a + b.count; }, 0);

    var html = '';
    // Big "All" chip — emphasized
    html += '<span class="acc-pill acc-all ' + (accountFilter === 'all' ? 'active' : '') + '" data-acc="all">' +
      '<span class="dot dot-all"></span>' +
      '<span class="lbl">All transactions</span>' +
      '<span class="acc-count">' + totalCount + '</span>' +
    '</span>';
    // Per-bank chips — smaller, brand-coloured
    accounts.filter(function (a) { return hidden.indexOf(a.key) === -1; }).forEach(function (a) {
      var c = bankColor(a.label);
      var isActive = (accountFilter === a.key);
      var bg = isActive ? c.bg : c.soft;
      var text = isActive ? c.text : c.bg;
      html += '<span class="acc-pill acc-bank ' + (isActive ? 'active' : '') + '" data-acc="' + a.key.replace(/"/g, '&quot;') + '" style="background:' + bg + ';color:' + text + ';border-color:' + c.bg + ';">' +
        '<span class="dot" style="background:' + c.bg + ';"></span>' +
        '<span class="lbl">' + a.label + '</span>' +
        '<span class="acc-count">' + a.count + '</span>' +
      '</span>';
    });
    // Settings gear — picker for which banks to show
    html += '<button class="acc-settings" id="wjp-bank-vis-btn" title="Choose which banks to show" type="button">⚙</button>';
    // (Page-size picker moved to the search/filter row above the table — see ensurePageSizePicker.)

    wrap.innerHTML = html;
    if (isNewFilt) parent.parentElement.insertBefore(wrap, parent);

    Array.prototype.forEach.call(wrap.querySelectorAll('.acc-pill'), function (p) {
      p.onclick = function () {
        var v = p.getAttribute('data-acc');
        setCurrentFilter(v);
        // Reset to first page when filter changes
        try { if (window._wjpTxnState) window._wjpTxnState.page = 0; } catch (_) {}
        renderSummary();
        // Run my self-contained renderer FIRST so the UI updates instantly
        try { customRenderBankRows(); } catch (e) { try { console.warn('[wjp-custom-render]', e); } catch(_){} }
        // Then let host re-render stats etc. (it may overwrite tbody but our
        // MutationObserver will rebuild from our renderer.)
        try { if (typeof window.txnRenderAll === 'function') window.txnRenderAll(); } catch (_) {}
        // After host re-render, re-impose ours via rAF
        requestAnimationFrame(function () {
          try { customRenderBankRows(); } catch (_) {}
        });
        try { document.dispatchEvent(new CustomEvent('wjp-account-filter-changed', { detail: { account: v } })); } catch (_) {}
      };
    });
    var gear = wrap.querySelector('#wjp-bank-vis-btn');
    if (gear) gear.onclick = openBankVisibilityModal;
  }


  // Hide table rows whose txn doesn't match the current account filter. We
  // look up each row's txn id, find the txn in appState, compare its
  // institutionName to the active filter.
  function applyAccountFilterToTable() {
    // v14 — No-op. The bank filter is now applied inside app.js's
    // txnGetFiltered (it reads localStorage 'wjp.tx.accountFilter' and uses
    // window.WJP_TxAccountKey). Previously this function hid rows post-render
    // and overwrote the page label — both became misleading once the
    // filtering moved upstream.
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

  // v12 — Page-size picker now lives in the search/filter row (.txn-filters)
  // right-aligned, on the same line as the search input + filter pills.
  function injectPageSizePickerStyle() {
    if (document.getElementById('wjp-tx-pagesize-row-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-tx-pagesize-row-style';
    st.textContent = [
      '.wjp-pagesize-row {',
      '  display:inline-flex; align-items:center; gap:3px; margin-left:auto;',
      '  background:var(--bg-3,rgba(0,0,0,0.03)); border:1px solid var(--border,rgba(0,0,0,0.08));',
      '  border-radius:10px; padding:3px; font-family:Inter,system-ui,sans-serif;',
      '}',
      '.wjp-pagesize-row .pagesize-label { font-size:10px; font-weight:700; color:var(--ink-dim,var(--text-3,#6b7280)); padding:0 8px; letter-spacing:0.06em; text-transform:uppercase; }',
      '.wjp-pagesize-row .ps-btn {',
      '  font-size:11px; font-weight:700; padding:4px 9px; border-radius:7px;',
      '  background:transparent; color:var(--ink-dim,var(--text-3,#6b7280)); border:0;',
      '  cursor:pointer; font-family:inherit;',
      '}',
      '.wjp-pagesize-row .ps-btn:hover:not(.active) { background:rgba(0,0,0,0.05); color:var(--ink,var(--text,#0a0a0a)); }',
      '.wjp-pagesize-row .ps-btn.active { background:#1f7a4a; color:#fff; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function ensurePageSizePicker() {
    var host = document.querySelector('.txn-filters');
    if (!host) return;
    injectPageSizePickerStyle();
    var existing = host.querySelector('.wjp-pagesize-row');
    var ps = (typeof window.WJP_GetTxnPageSize === 'function') ? window.WJP_GetTxnPageSize() : 10;
    var html =
      '<span class="pagesize-label">Show</span>' +
      [10, 20, 30, 50, 100].map(function (n) {
        return '<button class="ps-btn ' + (ps === n ? 'active' : '') + '" type="button" data-ps="' + n + '">' + n + '</button>';
      }).join('');
    if (existing) {
      existing.innerHTML = html;
    } else {
      var wrap = document.createElement('div');
      wrap.className = 'wjp-pagesize-row';
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Items per page');
      wrap.innerHTML = html;
      host.appendChild(wrap);
    }
    var row = host.querySelector('.wjp-pagesize-row');
    if (row && !row._wjpWired) {
      row._wjpWired = true;
      row.addEventListener('click', function (e) {
        var btn = e.target.closest('.ps-btn');
        if (!btn) return;
        var n = parseInt(btn.getAttribute('data-ps'), 10);
        if (typeof window.WJP_SetTxnPageSize === 'function') window.WJP_SetTxnPageSize(n);
        // Repaint the picker to reflect new active
        ensurePageSizePicker();
      });
    }
  }
  // Re-inject after any host re-render
  function watchTxnFiltersForPicker() {
    var host = document.querySelector('.txn-filters');
    if (!host) {
      setTimeout(watchTxnFiltersForPicker, 800);
      return;
    }
    ensurePageSizePicker();
    if (host._wjpPSObserved) return;
    host._wjpPSObserved = true;
    var mo = new MutationObserver(function () {
      if (host._wjpPSPending) return;
      host._wjpPSPending = true;
      requestAnimationFrame(function () {
        host._wjpPSPending = false;
        ensurePageSizePicker();
      });
    });
    mo.observe(host, { childList: true });
  }
  setTimeout(watchTxnFiltersForPicker, 1500);
  setInterval(function () {
    var host = document.querySelector('.txn-filters');
    if (host && !host._wjpPSObserved) watchTxnFiltersForPicker();
    else ensurePageSizePicker();
  }, 8000);

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
    window.addEventListener('wjp-tx-category-changed', function () {
      // v16 (2026-05-26): also re-render rows on category change. `tick` only
      // updates the summary card; rows are rendered by customRenderBankRows.
      try { customRenderBankRows(); } catch (e) { try { console.warn('[wjp-tx-tab] custom render after cat change failed', e); } catch(_){} }
      try { tick(); } catch (_) {}
    });
    window.addEventListener('wjp-transactions-rehydrated', tick);
    window.addEventListener('wjp-acct-lookup-ready', function () { setTimeout(tick, 200); });
    setTimeout(tick, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // v11 — Hook window.txnGetFiltered so the bank chip filter is applied to
  // the FULL transaction list before pagination. This ensures clicking
  // "Citi ··9295" actually paginates 222 matching txns, not just shows
  // the ones currently visible in the first 10 rows.
  function hookTxnGetFiltered() {
    if (window._wjpTxFilterHooked) return;
    if (typeof window.txnGetFiltered !== 'function') return;
    window._wjpTxFilterHooked = true;
    var orig = window.txnGetFiltered;
    window.txnGetFiltered = function () {
      var list = orig.apply(this, arguments) || [];
      var filter = getCurrentFilter();
      if (!filter || filter === 'all') return list;
      return list.filter(function (t) { return txnAccountKey(t) === filter; });
    };
  }
  // Try hooking immediately + retry as app.js may load after this module
  setInterval(hookTxnGetFiltered, 800);
  setTimeout(hookTxnGetFiltered, 500);

  window.WJP_TxTabEnhance = {
    render: tick,
    computeSummary: computeSummary,
    isTransfer: isTransfer,
    version: 1
  };
})();
