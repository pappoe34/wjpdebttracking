/* wjp-budgets-fix.js v2 — also categorize Plaid txns by merchant name (host stores all as Other)
 *
 * The host renderBudgetStatsRow / renderExpenseLegend / renderExpenseDistribution
 * count EVERY negative transaction as "spending", including Zelle, internal
 * moves, ACH transfers, etc. That inflates Spending Velocity to $2,773/day
 * and lumps 96% of the donut into "Other" (transfers).
 *
 * This overlay wraps each function to:
 *   - filter transfers from the spending set
 *   - use the corrected monthly income from WJP_MoneyLeftFix
 *   - re-render after the host's pass so our numbers stick
 */
(function () {
  'use strict';
  if (window._wjpBudgetsFixInstalled) return;
  window._wjpBudgetsFixInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  function isTransfer(t) {
    if (window.WJP_MoneyLeftFix && typeof window.WJP_MoneyLeftFix.isTransfer === 'function') {
      return window.WJP_MoneyLeftFix.isTransfer(t);
    }
    // Fallback identical logic
    var re = /\bzelle\b|cash\s*app|venmo|paypal\s+(transfer|send)|transfer\s+(from|to)|ach\s+(debit|credit|transfer|payment)|\binternal\s+xfer\b|online\s+(banking\s+)?transfer|external\s+transfer|wire\s+(in|out)|\bcc\s+payment\b|credit\s+card\s+payment|investment\s+(transfer|deposit)|brokerage|bkofamerica\s+atm|coinbase|robinhood|\bstash\b|\bvanguard\b|\bfidelity\b|charles\s+schwab|\bira\b\s+(deposit|contribution)/i;
    if (!t) return false;
    var blob = ((t.name || '') + ' ' + (t.merchant || '') + ' ' + (t.category || '') + ' ' + (t.method || '')).toLowerCase();
    return re.test(blob);
  }

  // v2: Merchant classifier — Plaid sync stores every txn as "Other".
  // We re-classify by merchant name pattern so the Expense Distribution donut
  // actually shows useful slices. Generic patterns only — no specific names.
  function classifyMerchant(merchant, hostCategory) {
    if (hostCategory && hostCategory !== 'Other' && hostCategory !== 'Uncategorized') return hostCategory;
    var s = String(merchant || '').toLowerCase();
    if (!s) return 'Other';
    if (/\bzelle\b|venmo|cash\s*app|paypal|transfer|ach\b/.test(s)) return 'Transfer';
    if (/payroll|paycheck|deposit|direct\s*dep/.test(s)) return 'Income';
    if (/walmart|target|costco|sam'?s\s+club|whole\s*foods|kroger|aldi|trader|publix|safeway|grocery|food\s*lion|wegmans|harris\s+teeter|fresh\s*market|sprouts/.test(s)) return 'Groceries';
    if (/shell|chevron|bp\b|exxon|mobil|sunoco|valero|conoco|76\b|arco|gulf|marathon|speedway|fuel|wawa\s+fuel/.test(s)) return 'Gas';
    if (/uber|lyft|metro|transit|parking|toll|amtrak|greyhound|airline|delta|united|american\s+air|southwest|jetblue|spirit|frontier|hertz|avis|enterprise|budget\s+rental/.test(s)) return 'Transportation';
    if (/mcdonald|burger\s*king|wendy|chick-?fil-?a|chipotle|taco|subway|domino|pizza|kfc|popeyes|starbucks|dunkin|panera|chipotle|olive\s+garden|cheesecake|outback|restaurant|cafe|diner|grill|kitchen|food|halal|sushi|thai|indian|chinese|mexican|deli|bistro|brewery|bar\s+\&\s+grill|seafood/.test(s)) return 'Food & Dining';
    if (/netflix|hulu|spotify|peacock|paramount|disney|hbo|max|youtube\s+(premium|tv|music)|apple\s+(music|tv|one)|amazon\s+(prime|video|music)|sirius|pandora|tidal|audible/.test(s)) return 'Subscriptions';
    if (/microsoft|google|adobe|github|claude|anthropic|openai|chatgpt|jetbrains|notion|figma|slack|zoom|dropbox|aws|azure|netlify|vercel|cloudflare|godaddy/.test(s)) return 'Software';
    if (/progressive|esurance|geico|state\s+farm|allstate|liberty\s+mutual|farmers|nationwide|usaa\s+insurance|metlife|prudential|aetna|bcbs|blue\s+cross|kaiser|cigna|humana|insurance/.test(s)) return 'Insurance';
    if (/electric|power|energy|conedison|pge|dominion|duke\s+energy|peco|pseg|gas\s+(company|utility)|water\s+(department|utility)|sewer|utility/.test(s)) return 'Utilities';
    if (/comcast|xfinity|spectrum|verizon|att\b|t-?mobile|sprint|cox|optimum|frontier\s+communications|google\s+fiber|fios|cable/.test(s)) return 'Phone & Internet';
    if (/cvs|walgreens|rite\s+aid|pharmacy|goodrx|drug\s*mart|prescription|medical|doctor|dentist|clinic|hospital|urgent\s+care|labcorp|quest/.test(s)) return 'Health';
    if (/rent\b|mortgage|hoa|lease|property\s+management|landlord|apartments/.test(s)) return 'Housing';
    if (/storage|public\s+storage|extra\s+space|cubesmart/.test(s)) return 'Storage';
    if (/post\s*office|usps|fedex|ups\s+store|dhl|shipping/.test(s)) return 'Shipping';
    if (/amazon\b(?!\s+(prime|video|music))|ebay|etsy|wayfair|home\s+depot|lowes|ikea|best\s+buy|macy|nordstrom|kohl|tj\s*maxx|marshalls|ross\b/.test(s)) return 'Shopping';
    if (/klarna|affirm|afterpay|sezzle/.test(s)) return 'BNPL';
    if (/credit\s+one|capital\s+one|chase|amex|discover|citi|wells\s+fargo|bank\s+of\s+america|bofa|barclays|synchrony|comenity|usaa\s+credit|navy\s+federal\s+credit|milestone|brightway|aspire|avant|onemain|one\s+main|sofi|westlake|aidvantage|aidadvantage|student\s+loan|car\s+loan/.test(s)) return 'Debt Payment';
    if (/interest\s+charge|finance\s+charge|late\s+fee|nsf\s+fee/.test(s)) return 'Fees & Interest';
    if (/gym|fitness|planet\s+fitness|equinox|crunch|yoga|peloton/.test(s)) return 'Fitness';
    if (/atm\s+withdrawal|cash\s+withdrawal|atm\s+fee/.test(s)) return 'Cash';
    return 'Other';
  }

  function realIncome() {
    if (typeof window.computeRealMonthlyIncome === 'function') return window.computeRealMonthlyIncome();
    var s = getState();
    return (s && s.budget && s.budget.monthlyIncome) || 0;
  }

  function realMonthSpend() {
    var s = getState();
    if (!s) return { total: 0, byCat: {}, dayCount: 1, dayInMonth: 1 };
    var monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    var today = new Date();
    var dayCount = Math.max(1, Math.floor((today - monthStart) / 86400000) + 1);
    var byCat = {};
    var total = 0;
    (s.transactions || []).forEach(function (t) {
      if (!t || t.synthetic) return;
      var amt = Number(t.amount) || 0;
      if (amt >= 0) return;
      if (new Date(t.date) < monthStart) return;
      if (isTransfer(t)) return;
      var cat = classifyMerchant(t.merchant || t.name, t.category);
      var v = Math.abs(amt);
      byCat[cat] = (byCat[cat] || 0) + v;
      total += v;
    });
    return { total: total, byCat: byCat, dayCount: dayCount };
  }

  // === Wrapper: renderBudgetStatsRow — REAL spend in Spending Velocity ===
  function fixedBudgetStatsRow() {
    var income = realIncome();
    var s = getState() || {};
    var debts = s.debts || [];
    var totalMin = debts.reduce(function (sum, d) { return sum + (d.minPayment || 0); }, 0);
    var monthlySavings = (s.budget && s.budget.allocation && s.budget.allocation.savings)
      || (s.budget && s.budget.contribution) || 0;

    // Savings Rate
    var elSR = document.getElementById('bdg-savings-rate');
    var elSRSub = document.getElementById('bdg-savings-rate-sub');
    if (elSR) {
      var sr = income > 0 ? Math.round((monthlySavings / income) * 100) : 0;
      elSR.textContent = sr + '%';
      if (elSRSub) elSRSub.textContent = income > 0
        ? ('$' + monthlySavings.toLocaleString() + ' of $' + Math.round(income).toLocaleString() + '/mo')
        : 'Add income & expenses to track.';
    }
    // DTI
    var elDTI = document.getElementById('bdg-dti-ratio');
    var elDTISub = document.getElementById('bdg-dti-sub');
    if (elDTI) {
      var dti = income > 0 ? Math.round((totalMin / income) * 100) : 0;
      elDTI.textContent = dti + '%';
      if (elDTISub) elDTISub.textContent = income > 0
        ? (dti < 36 ? 'Healthy — under 36% threshold.' : dti < 50 ? 'Moderate. Watch lifestyle creep.' : 'High. Prioritize debt reduction.')
        : 'Add income & debts to calculate.';
    }
    // Spending Velocity — TRANSFERS EXCLUDED
    var elSV = document.getElementById('bdg-spending-velocity');
    var elSVSub = document.getElementById('bdg-spending-velocity-sub');
    if (elSV) {
      var spend = realMonthSpend();
      var perDay = Math.round(spend.total / spend.dayCount);
      elSV.innerHTML = '$' + perDay.toLocaleString() + '<span style="font-size:14px;font-weight:500">/day</span>';
      if (elSVSub) {
        elSVSub.textContent = spend.total > 0
          ? ('$' + Math.round(spend.total).toLocaleString() + ' spent over ' + spend.dayCount + ' day' + (spend.dayCount === 1 ? '' : 's') + ' (transfers excluded).')
          : 'Log transactions to see velocity.';
      }
    }
  }

  // === Wrapper: renderExpenseLegend + renderExpenseDistribution ===
  function fixedExpenseRender() {
    var spend = realMonthSpend();
    var entries = Object.entries(spend.byCat).sort(function (a, b) { return b[1] - a[1]; });
    var PALETTE = ['#00d4a8','#667eea','#ff4d6d','#ffab40','#a855f7','#22c55e','#f59e0b','#60a5fa'];

    // Update Total Spent indicator
    var totalEl = document.getElementById('expense-total-spent');
    if (totalEl) totalEl.textContent = spend.total > 0 ? '$' + Math.round(spend.total).toLocaleString() : '$0';
    var donutTotal = document.getElementById('bdg-donut-total');
    if (donutTotal) donutTotal.textContent = spend.total > 0 ? '$' + Math.round(spend.total).toLocaleString() : '$0';

    var legendEl = document.getElementById('expense-legend');
    if (legendEl) {
      if (!entries.length) {
        legendEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-3);font-size:11px;line-height:1.5;">'
          + '<i class="ph ph-chart-pie-slice" style="font-size:28px;display:block;margin-bottom:8px;opacity:0.4;"></i>'
          + 'No expense categories yet this month.<br/>Add transactions to see your breakdown.</div>';
      } else {
        legendEl.innerHTML = entries.slice(0, 8).map(function (kv, i) {
          var cat = kv[0]; var amt = kv[1];
          var color = PALETTE[i % PALETTE.length];
          var pct = spend.total > 0 ? Math.round((amt / spend.total) * 100) : 0;
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">'
            + '<span style="width:10px;height:10px;border-radius:3px;background:' + color + ';flex-shrink:0;"></span>'
            + '<span style="flex:1;font-size:12px;font-weight:600;color:var(--text-1,#0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + cat + '</span>'
            + '<span style="font-size:12px;font-weight:800;color:var(--text-1,#0a0a0a);">$' + Math.round(amt).toLocaleString() + '</span>'
            + '<span style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:700;min-width:36px;text-align:right;">' + pct + '%</span>'
            + '</div>';
        }).join('');
      }
    }

    // Update donut center (top category)
    if (entries.length) {
      var topCat = entries[0][0]; var topAmt = entries[0][1];
      var topPct = spend.total > 0 ? Math.round((topAmt / spend.total) * 100) : 0;
      var dn = document.getElementById('donut-cat-name'); if (dn) dn.textContent = topCat;
      var da = document.getElementById('donut-cat-amt');  if (da) da.textContent = '$' + Math.round(topAmt).toLocaleString();
      var dp = document.getElementById('donut-cat-pct');  if (dp) dp.textContent = topPct + '%';
    }

    // Allocation list (alt layout)
    var list = document.getElementById('bdg-allocation-list');
    if (list && entries.length) {
      list.innerHTML = entries.slice(0, 8).map(function (kv, i) {
        var cat = kv[0]; var amt = kv[1];
        var color = PALETTE[i % PALETTE.length];
        var pct = spend.total > 0 ? Math.round((amt / spend.total) * 100) : 0;
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:11px;">'
          + '<span style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:2px;background:' + color + ';"></span>' + cat + '</span>'
          + '<span style="font-weight:800;">$' + Math.round(amt).toLocaleString() + ' <span style="color:var(--text-3);font-weight:500;">(' + pct + '%)</span></span>'
          + '</div>';
      }).join('');
    }
  }

  function install() {
    if (typeof window.renderBudgetStatsRow === 'function') {
      window._wjpHostBudgetStatsRow = window._wjpHostBudgetStatsRow || window.renderBudgetStatsRow;
      window.renderBudgetStatsRow = function () { try { fixedBudgetStatsRow(); } catch (e) { try { console.warn('[wjp-budgets-fix] stats', e); } catch (_) {} } };
    }
    if (typeof window.renderExpenseLegend === 'function') {
      window._wjpHostExpenseLegend = window._wjpHostExpenseLegend || window.renderExpenseLegend;
      window.renderExpenseLegend = function () { try { fixedExpenseRender(); } catch (e) { try { console.warn('[wjp-budgets-fix] legend', e); } catch (_) {} } };
    }
    if (typeof window.renderExpenseDistribution === 'function') {
      window._wjpHostExpenseDist = window._wjpHostExpenseDist || window.renderExpenseDistribution;
      window.renderExpenseDistribution = function () { try { fixedExpenseRender(); } catch (e) {} };
    }
    // Trigger
    try { window.renderBudgetStatsRow(); } catch (_) {}
    try { window.renderExpenseLegend(); } catch (_) {}
    try { window.renderExpenseDistribution(); } catch (_) {}
  }

  function waitForHost() {
    if (typeof window.renderBudgetStatsRow === 'function'
        || typeof window.renderExpenseLegend === 'function') {
      install();
      return;
    }
    setTimeout(waitForHost, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(waitForHost, 800); });
  else setTimeout(waitForHost, 800);

  // Re-render every 5s in case the host or other overlays trigger their own pass
  setInterval(function () {
    try {
      var p = document.getElementById('page-budgets');
      if (!p || p.offsetHeight === 0) return; // only when budgets page visible
      fixedBudgetStatsRow();
      fixedExpenseRender();
    } catch (_) {}
  }, 5000);

  window.WJP_BudgetsFix = {
    realIncome: realIncome,
    realMonthSpend: realMonthSpend,
    isTransfer: isTransfer
  };
})();
