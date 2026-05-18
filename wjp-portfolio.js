/* wjp-portfolio.js v6 — explicit asset list + edit/delete + Plaid balance attribution.
 * Assets/Liabilities, All-Accounts, Money Working, Insights, Milestones.
 *
 * Architecture:
 *   - Renames existing header tab "Portfolio" → "Dashboard"
 *   - Inserts new "Portfolio" header tab AFTER it
 *   - New #page-portfolio container holds 7 sections
 *   - Default landing is unchanged (Dashboard); user opts into Portfolio via header tab
 *   - Dark-mode native via CSS vars (--ink, --text-3, --card-2, --accent, --border)
 *   - Pure white in dark mode for hero numbers (not antialiased grey)
 *
 * Data sources:
 *   - localStorage `wjp_budget_state` → debts, transactions, recurringPayments, balances, creditScoreHistory, profile
 *   - User-scoped manual assets: `wjp.portfolio.manualAssets.v1`
 *   - WJP_Snapshots for historical net-worth trajectory
 */
(function () {
  'use strict';
  if (window._wjpPortfolioInstalled) return;
  window._wjpPortfolioInstalled = true;

  // =====================================================================
  // helpers
  // =====================================================================
  function fmtUSD(n) {
    n = Math.round(Number(n) || 0);
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US');
  }
  function fmtUSDk(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000000) return (n < 0 ? '−$' : '$') + (Math.abs(n) / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return (n < 0 ? '−$' : '$') + (Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1) + 'k';
    return (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  // v2: trust ONLY the site's explicit theme — OS preference fallback caused
  // light-mode pages to render with dark-mode colors (white text on cream cards).
  function isDark() {
    try {
      var html = document.documentElement;
      var attr = html.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return html.classList.contains('dark') || document.body.classList.contains('dark');
    } catch (_) { return false; }
  }
  function cssVar(name, fallback) {
    try { var v = getComputedStyle(document.body).getPropertyValue(name).trim(); return v || fallback; }
    catch (_) { return fallback; }
  }
  // v2: return CSS-variable strings so each theme inherits its own palette at paint time.
  // No more JS-side branching that can desync from the site's actual theme.
  function ink()     { return 'var(--ink, var(--text-1, #0a0a0a))'; }
  function muted()   { return 'var(--text-3, #94a3b8)'; }
  function surface() { return 'var(--card-2, #ffffff)'; }
  function gridCol() { return 'var(--border, rgba(10,10,10,0.08))'; }
  function accent()  { return 'var(--accent, #10b981)'; }
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  // =====================================================================
  // data layer
  // =====================================================================
  function getAppState() {
    // Try the unscoped key first, then scoped
    try {
      var raw = localStorage.getItem('wjp_budget_state');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Probe scoped variants
    for (var k in localStorage) {
      if (k.indexOf('wjp_budget_state_') === 0) {
        try { return JSON.parse(localStorage.getItem(k)); } catch (_) {}
      }
    }
    return {};
  }

  function manualAssetsKey() {
    try { return window.WJP_UserScope && WJP_UserScope.scopeKey ? WJP_UserScope.scopeKey('wjp.portfolio.manualAssets.v1') : 'wjp.portfolio.manualAssets.v1'; }
    catch (_) { return 'wjp.portfolio.manualAssets.v1'; }
  }
  function getManualAssets() {
    try { return JSON.parse(localStorage.getItem(manualAssetsKey()) || '[]'); } catch (_) { return []; }
  }
  function setManualAssets(arr) {
    try { localStorage.setItem(manualAssetsKey(), JSON.stringify(arr || [])); } catch (_) {}
  }

  // Net Worth snapshot — combines Plaid balances + manual assets - debts
  function getNetWorth() {
    var s = getAppState() || {};
    var debts = (s.debts || []).reduce(function (sum, d) { return sum + (Number(d.balance) || 0); }, 0);
    var plaidAssets = 0;
    var balances = s.balances || {};
    // balances may be either an array or an object keyed by accountId
    if (Array.isArray(balances)) {
      plaidAssets = balances.filter(function (b) { return b && (b.subtype !== 'credit card' && b.type !== 'credit' && b.type !== 'loan'); })
                            .reduce(function (sum, b) { return sum + (Number(b.balance || b.current || 0)); }, 0);
    } else if (balances && typeof balances === 'object') {
      Object.keys(balances).forEach(function (k) {
        var b = balances[k];
        if (!b) return;
        var bal = Number(b.balance || b.current || b.available || 0);
        var t = (b.type || '').toLowerCase();
        var st = (b.subtype || '').toLowerCase();
        if (t === 'credit' || t === 'loan' || st === 'credit card') return; // these are liabilities
        plaidAssets += bal;
      });
    }
    var manual = getManualAssets().reduce(function (sum, a) { return sum + (Number(a.value) || 0); }, 0);
    var assets = plaidAssets + manual;
    return { assets: assets, liabilities: debts, net: assets - debts, plaidAssets: plaidAssets, manualAssets: manual };
  }

  // Linked Plaid institutions — derived from transactions since host doesn't
  // store depository accounts separately
  function getLinkedInstitutions() {
    var s = getAppState() || {};
    var byInst = {};
    (s.transactions || []).forEach(function (t) {
      if (!t || t.source !== 'plaid') return;
      var name = (t.institutionName || '').trim();
      if (!name) return;
      if (!byInst[name]) byInst[name] = { name: name, txnCount: 0, lastSeen: 0 };
      byInst[name].txnCount++;
      var ts = new Date(t.date).getTime();
      if (ts > byInst[name].lastSeen) byInst[name].lastSeen = ts;
    });
    return Object.values(byInst);
  }

  // =====================================================================
  // Health Score (composite 0-1000)
  // =====================================================================
  function getHealthScore() {
    var s = getAppState() || {};
    var nw = getNetWorth();

    // 1. Debt management (0-200): debt-to-income ratio — host stores monthlyIncome under s.balances
    var income = (s.balances && s.balances.monthlyIncome) || (s.profile && s.profile.monthlyIncome) || 0;
    if (!income) {
      // Estimate from inflows over last 90 days
      var txns = s.transactions || [];
      var now = Date.now();
      var inflowSum = txns.filter(function (t) { return t && t.amount > 0; })
                          .filter(function (t) { return (now - new Date(t.date).getTime()) <= 90 * 86400000; })
                          .reduce(function (s, t) { return s + t.amount; }, 0);
      income = inflowSum / 3; // monthly estimate
    }
    var dti = income > 0 ? (nw.liabilities / 12 / income) : 999;
    // 0% DTI → 200, 50%+ DTI → 0
    var debtScore = Math.max(0, Math.min(200, 200 * (1 - dti / 0.5)));

    // 2. Credit (0-250): credit score / 850 * 250
    var creditScore = 0;
    try {
      var ch = s.creditScoreHistory || [];
      if (ch.length) creditScore = Number(ch[ch.length - 1].score || ch[ch.length - 1].value || 0);
    } catch (_) {}
    var creditPoints = creditScore ? Math.round(Math.min(250, (creditScore / 850) * 250)) : 0;

    // 3. Emergency fund (0-200): liquid cash / monthly essential expenses target 6x
    var monthlyEssentials = 0;
    (s.recurringPayments || []).forEach(function (r) {
      if (!r || r.category === 'income') return;
      monthlyEssentials += Math.abs(Number(r.amount) || 0);
    });
    var liquidCash = nw.plaidAssets;
    var efRatio = monthlyEssentials > 0 ? liquidCash / (monthlyEssentials * 6) : 0;
    var efScore = Math.round(Math.min(200, efRatio * 200));

    // 4. Retirement (0-200): investments / age-adjusted target (rough: 1x salary by 30, 3x by 40)
    var manualInvest = getManualAssets().filter(function (a) { return a.type === 'investment' || a.type === 'retirement'; })
                                        .reduce(function (sum, a) { return sum + (Number(a.value) || 0); }, 0);
    var retireTarget = (income * 12) * 2; // very rough 2x annual income default
    var retireScore = retireTarget > 0 ? Math.round(Math.min(200, (manualInvest / retireTarget) * 200)) : 0;

    // 5. Insurance (0-150): presence of recurring insurance payments
    var insurancePayments = (s.recurringPayments || []).filter(function (r) {
      var n = (r && r.name || '').toLowerCase();
      return /insurance|geico|progressive|state farm|allstate|aetna|cigna|kaiser|blue cross/.test(n);
    }).length;
    var insScore = Math.min(150, insurancePayments * 50);

    var total = Math.round(debtScore + creditPoints + efScore + retireScore + insScore);

    var level = 'Foundation';
    if (total >= 800) level = 'Mastery';
    else if (total >= 600) level = 'Thriving';
    else if (total >= 400) level = 'Building';

    // Top action — the lowest sub-score
    var subs = [
      { key: 'debt',      label: 'Debt Management',   score: debtScore,    max: 200, action: 'Pay down high-APR debt — aim to keep DTI under 35%.' },
      { key: 'credit',    label: 'Credit',            score: creditPoints, max: 250, action: 'Connect Array for monthly score pulls; pay every bill on time.' },
      { key: 'emergency', label: 'Emergency Fund',    score: efScore,      max: 200, action: 'Build a $1,000 starter fund, then grow to 6 months of essentials.' },
      { key: 'retirement',label: 'Retirement',        score: retireScore,  max: 200, action: 'Contribute to a 401k/IRA; add investment accounts in Portfolio.' },
      { key: 'insurance', label: 'Insurance',         score: insScore,     max: 150, action: 'Ensure you have health, auto, and renters/homeowners coverage.' }
    ];
    var topAction = subs.slice().sort(function (a, b) { return (a.score / a.max) - (b.score / b.max); })[0];

    return { total: total, level: level, subs: subs, topAction: topAction };
  }

  // =====================================================================
  // Net Worth trajectory (last 12 months from Snapshots, projected next 6)
  // =====================================================================
  function getNetWorthSeries() {
    var labels = [], data = [];
    var now = new Date();
    var current = getNetWorth().net;

    // Try WJP_Snapshots for historical
    try {
      if (window.WJP_Snapshots && WJP_Snapshots.history) {
        var hist = WJP_Snapshots.history();
        if (Array.isArray(hist) && hist.length > 1) {
          // Use snapshots if they have a net field
          var sorted = hist.slice().sort(function (a, b) { return new Date(a.t) - new Date(b.t); });
          var lastN = sorted.slice(-12);
          lastN.forEach(function (s) {
            labels.push(new Date(s.t).toLocaleDateString('en-US', { month: 'short' }));
            data.push((s.liquidCash || 0) - (s.totalDebt || 0));
          });
        }
      }
    } catch (_) {}

    if (data.length < 2) {
      // Synthetic: fill 12 months working backward — show flat at current
      labels = []; data = [];
      for (var i = 11; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(d.toLocaleDateString('en-US', { month: 'short' }));
        // Slight gradient toward current — synthetic data only
        data.push(Math.round(current * (1 - i * 0.005)));
      }
    }

    // Append "today" if last point isn't current month
    var lastLabel = labels[labels.length - 1];
    var thisLabel = now.toLocaleDateString('en-US', { month: 'short' });
    if (lastLabel !== thisLabel) {
      labels.push(thisLabel);
      data.push(current);
    } else {
      data[data.length - 1] = current;
    }

    // Append 6 projected months — based on most recent monthly delta
    var recentDelta = 0;
    if (data.length >= 3) {
      recentDelta = (data[data.length - 1] - data[data.length - 3]) / 2;
    }
    var projection = data.slice();
    var projLabels = labels.slice();
    var projected = current;
    for (var p = 1; p <= 6; p++) {
      projected += recentDelta;
      var pd = new Date(now.getFullYear(), now.getMonth() + p, 1);
      projLabels.push(pd.toLocaleDateString('en-US', { month: 'short' }));
      projection.push(projected);
    }
    // Build two series: historical (with nulls in projection slots) + projection (with nulls in past slots)
    var splitIdx = data.length - 1; // last actual is "today" at splitIdx
    var actualSeries = projLabels.map(function (_, i) { return i <= splitIdx ? projection[i] : null; });
    var projSeries  = projLabels.map(function (_, i) { return i >= splitIdx ? projection[i] : null; });

    return { labels: projLabels, actual: actualSeries, projected: projSeries, todayIdx: splitIdx, recentDelta: recentDelta };
  }

  // =====================================================================
  // Insights
  // =====================================================================
  function getInsights() {
    var s = getAppState() || {};
    var txns = (s.transactions || []).filter(function (t) { return t && t.date; });
    var insights = [];
    var now = new Date();

    // YoY net worth change (only meaningful if we have data 12+ months ago)
    var nw = getNetWorth().net;
    insights.push({
      icon: 'ph-trending-up',
      title: 'Net worth trajectory',
      body: (function () {
        if (nw === 0) return 'Add accounts and assets to see your wealth direction.';
        var series = getNetWorthSeries();
        var delta = (series.actual[series.todayIdx] || 0) - (series.actual[0] || 0);
        if (delta > 0) return 'You are up ' + fmtUSD(delta) + ' over the visible window.';
        if (delta < 0) return 'You are down ' + fmtUSD(Math.abs(delta)) + ' over the visible window.';
        return 'Your net worth has been flat — time to push it.';
      })()
    });

    // Subscription creep — count this-month subs vs 90 days ago
    var thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    var ninetyDaysAgo = Date.now() - 90 * 86400000;
    var subsThis = txns.filter(function (t) { return t.amount < 0 && (t.category || '').toLowerCase().indexOf('subscript') !== -1 && new Date(t.date).getTime() >= thisMonth; })
                       .reduce(function (sum, t) { return sum + Math.abs(t.amount); }, 0);
    var subsPrev = txns.filter(function (t) { return t.amount < 0 && (t.category || '').toLowerCase().indexOf('subscript') !== -1 && new Date(t.date).getTime() >= ninetyDaysAgo && new Date(t.date).getTime() < thisMonth; })
                       .reduce(function (sum, t) { return sum + Math.abs(t.amount); }, 0) / 3 || 0;
    if (subsThis > 0 || subsPrev > 0) {
      var subDelta = subsPrev > 0 ? Math.round(((subsThis - subsPrev) / subsPrev) * 100) : 0;
      insights.push({
        icon: 'ph-television',
        title: 'Subscriptions ' + (subDelta >= 0 ? 'up' : 'down') + ' ' + Math.abs(subDelta) + '%',
        body: 'This month: ' + fmtUSD(subsThis) + ' · prior avg: ' + fmtUSD(subsPrev) + '/mo'
      });
    }

    // Anomaly: any txn this month > 2.5× the median spending category txn
    var monthTxns = txns.filter(function (t) { return t.amount < 0 && new Date(t.date).getTime() >= thisMonth; });
    if (monthTxns.length > 3) {
      var amts = monthTxns.map(function (t) { return Math.abs(t.amount); }).sort(function (a, b) { return a - b; });
      var median = amts[Math.floor(amts.length / 2)];
      var anomalies = monthTxns.filter(function (t) { return Math.abs(t.amount) > median * 2.5; });
      if (anomalies.length) {
        var top = anomalies.sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); })[0];
        insights.push({
          icon: 'ph-warning-circle',
          title: 'Unusual transaction',
          body: fmtUSD(Math.abs(top.amount)) + ' at ' + escapeHTML(top.merchant || top.name || 'Unknown') + ' (' + new Date(top.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ')'
        });
      }
    }

    // Next-month prediction — use recurring outflows
    var recurringOut = (s.recurringPayments || []).filter(function (r) { return r && r.category !== 'income' && r.status !== 'cancelled' && r.status !== 'paused'; })
                                                  .reduce(function (sum, r) { return sum + Math.abs(Number(r.amount) || 0); }, 0);
    var recurringIn = (s.recurringPayments || []).filter(function (r) { return r && r.category === 'income'; })
                                                 .reduce(function (sum, r) { return sum + Math.abs(Number(r.amount) || 0); }, 0);
    var projNet = recurringIn - recurringOut;
    insights.push({
      icon: 'ph-crystal-ball',
      title: 'Next month projection',
      body: (projNet >= 0 ? 'Surplus of ' : 'Shortfall of ') + fmtUSD(Math.abs(projNet)) + ' based on recurring flow.'
    });

    return insights.slice(0, 4);
  }

  // =====================================================================
  // Milestones
  // =====================================================================
  function getMilestones() {
    var nw = getNetWorth().net;
    var levels = [
      { v: 0,        label: 'Out of the red' },
      { v: 1000,     label: '$1k starter'    },
      { v: 10000,    label: '$10k cushion'   },
      { v: 50000,    label: '$50k builder'   },
      { v: 100000,   label: '$100k milestone'},
      { v: 250000,   label: '$250k major'    },
      { v: 500000,   label: '$500k major'    },
      { v: 1000000,  label: 'Millionaire'    }
    ];
    return levels.map(function (lv) {
      return { v: lv.v, label: lv.label, reached: nw >= lv.v, pct: lv.v ? Math.min(100, Math.max(0, (nw / lv.v) * 100)) : (nw >= 0 ? 100 : 0) };
    });
  }

  // =====================================================================
  // section renderers
  // =====================================================================
  function s1NetWorthHero() {
    var nw = getNetWorth();
    var series = getNetWorthSeries();
    var firstWindowVal = series.actual.find(function (v) { return v != null; }) || nw.net;
    var monthDelta = nw.net - firstWindowVal;
    var trendIcon = monthDelta >= 0 ? 'ph-trending-up' : 'ph-trending-down';
    var trendColor = monthDelta >= 0 ? '#10b981' : '#ef4444';
    // Final projected value (last point of projection series)
    var finalProj = series.projected[series.projected.length - 1] || nw.net;
    var projLabel = series.labels[series.labels.length - 1] || '';

    return ''
      + '<div class="wjp-pf-card" style="padding:24px 26px;background:' + surface() + ';border:1px solid ' + gridCol() + ';border-radius:16px;">'
      +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:16px;">'
      +     '<div>'
      +       '<div style="font-size:10px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:' + muted() + ';">Your Net Worth</div>'
      +       '<div style="font-size:32px;font-weight:700;color:' + ink() + ';letter-spacing:-0.02em;line-height:1.1;margin-top:6px;">' + fmtUSD(nw.net) + '</div>'
      +       '<div style="margin-top:6px;display:flex;align-items:center;gap:6px;">'
      +         '<i class="ph-fill ' + trendIcon + '" style="color:' + trendColor + ';font-size:14px;"></i>'
      +         '<span style="color:' + trendColor + ';font-weight:600;font-size:12.5px;">' + (monthDelta >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(monthDelta)).toLocaleString('en-US') + '</span>'
      +         '<span style="color:' + muted() + ';font-size:12.5px;font-weight:500;">over visible window</span>'
      +       '</div>'
      +     '</div>'
      +     '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +       '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:9px 14px;">'
      +         '<div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#059669;font-weight:700;">Assets</div>'
      +         '<div style="font-size:15px;font-weight:700;color:' + ink() + ';margin-top:2px;">' + fmtUSD(nw.assets) + '</div>'
      +       '</div>'
      +       '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:9px 14px;">'
      +         '<div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#dc2626;font-weight:700;">Liabilities</div>'
      +         '<div style="font-size:15px;font-weight:700;color:' + ink() + ';margin-top:2px;">' + fmtUSD(nw.liabilities) + '</div>'
      +       '</div>'
      +       '<div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:10px;padding:9px 14px;">'
      +         '<div style="font-size:9px;letter-spacing:0.08em;text-transform:uppercase;color:#6366f1;font-weight:700;">A:D Ratio</div>'
      +         '<div style="font-size:15px;font-weight:700;color:' + ink() + ';margin-top:2px;">' + (nw.liabilities > 0 ? (nw.assets / nw.liabilities).toFixed(2) : '∞') + '</div>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;font-size:10.5px;font-weight:600;color:' + muted() + ';margin-bottom:8px;">'
      +     '<div><span style="color:' + ink() + ';font-weight:600;">12-month trajectory</span> · solid = actual · dashed = 6-month projection</div>'
      +     '<div>Projected ' + projLabel + ': <span style="color:' + ink() + ';font-weight:600;">' + fmtUSD(finalProj) + '</span></div>'
      +   '</div>'
      +   '<div style="height:240px;position:relative;">'
      +     '<canvas id="wjp-pf-trajectory"></canvas>'
      +   '</div>'
      + '</div>';
  }

  function s2HealthScore() {
    var hs = getHealthScore();
    var subBars = hs.subs.map(function (sub) {
      var pct = (sub.score / sub.max) * 100;
      return ''
        + '<div style="margin-bottom:10px;">'
        +   '<div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:600;color:' + ink() + ';margin-bottom:4px;">'
        +     '<span>' + escapeHTML(sub.label) + '</span>'
        +     '<span style="color:' + muted() + ';font-weight:600;">' + Math.round(sub.score) + '/' + sub.max + '</span>'
        +   '</div>'
        +   '<div style="height:6px;background:rgba(255,255,255,0.06);border-radius:6px;overflow:hidden;">'
        +     '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,' + accent() + ',' + accent() + 'cc);border-radius:6px;transition:width 0.5s ease;"></div>'
        +   '</div>'
        + '</div>';
    }).join('');

    var levelColor = hs.level === 'Mastery' ? '#a78bfa' : hs.level === 'Thriving' ? '#10b981' : hs.level === 'Building' ? '#f59e0b' : '#94a3b8';
    return ''
      + '<div class="wjp-pf-card" style="padding:22px 24px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:18px;display:flex;gap:24px;flex-wrap:wrap;">'
      +   '<div style="flex:0 0 220px;display:flex;flex-direction:column;align-items:center;justify-content:center;">'
      +     '<div style="position:relative;width:180px;height:180px;">'
      +       '<canvas id="wjp-pf-health-gauge" width="180" height="180"></canvas>'
      +       '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">'
      +         '<div style="font-size:32px;font-weight:700;color:' + ink() + ';line-height:1;">' + hs.total + '</div>'
      +         '<div style="font-size:10px;letter-spacing:0.1em;color:' + muted() + ';margin-top:4px;font-weight:700;">OF 1000</div>'
      +       '</div>'
      +     '</div>'
      +     '<div style="margin-top:14px;background:' + levelColor + '22;color:' + levelColor + ';font-size:11px;font-weight:800;letter-spacing:0.05em;padding:5px 14px;border-radius:999px;border:1px solid ' + levelColor + '44;">LEVEL: ' + hs.level.toUpperCase() + '</div>'
      +   '</div>'
      +   '<div style="flex:1;min-width:280px;">'
      +     '<div style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:' + muted() + ';margin-bottom:14px;">FINANCIAL HEALTH SCORE</div>'
      +     subBars
      +     '<div style="margin-top:14px;padding:12px 14px;background:rgba(245,158,11,0.10);border-left:3px solid #f59e0b;border-radius:8px;">'
      +       '<div style="font-size:9.5px;font-weight:800;letter-spacing:0.1em;color:#f59e0b;text-transform:uppercase;margin-bottom:4px;">→ TOP ACTION</div>'
      +       '<div style="font-size:12.5px;color:' + ink() + ';font-weight:600;line-height:1.4;">' + escapeHTML(hs.topAction.action) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // v5 helpers — type meta + edit/delete
  function assetTypeMeta(type) {
    var map = {
      checking:   { label: 'Checking',     icon: 'ph-wallet',         color: '#10b981' },
      savings:    { label: 'Savings',      icon: 'ph-piggy-bank',     color: '#10b981' },
      cash:       { label: 'Cash',         icon: 'ph-coins',          color: '#f59e0b' },
      investment: { label: 'Investment',   icon: 'ph-chart-line-up',  color: '#a78bfa' },
      retirement: { label: 'Retirement',   icon: 'ph-tree',           color: '#a78bfa' },
      realestate: { label: 'Real Estate',  icon: 'ph-house',          color: '#0891b2' },
      vehicle:    { label: 'Vehicle',      icon: 'ph-car',            color: '#6366f1' },
      other:      { label: 'Other',        icon: 'ph-currency-dollar',color: '#94a3b8' }
    };
    return map[type] || map.other;
  }
  function deleteManualAsset(id) {
    var arr = getManualAssets().filter(function (a) { return a.id !== id; });
    setManualAssets(arr);
    renderPortfolio();
  }
  function editManualAsset(id) {
    var arr = getManualAssets();
    var a = arr.find(function (x) { return x.id === id; });
    if (!a) return;
    openAddAssetModal({ presetType: a.type, presetName: a.name, presetValue: a.value, editId: id });
  }

  function s3AssetsLiabilities() {
    var s = getAppState() || {};
    var nw = getNetWorth();

    // Aggregate liabilities by debt category
    var liabCats = {};
    (s.debts || []).forEach(function (d) {
      if (!d || !(d.balance > 0)) return;
      var name = (d.name || '').toLowerCase();
      var cat = 'Other';
      if (/credit|visa|amex|discover|chase|citi|cap one|capital one/.test(name)) cat = 'Credit Cards';
      else if (/student|sallie|nelnet|navient/.test(name)) cat = 'Student Loans';
      else if (/auto|car|honda|toyota|westlake/.test(name)) cat = 'Auto Loans';
      else if (/mortgage|home loan/.test(name)) cat = 'Mortgage';
      else if (/personal|affirm|klarna|afterpay|loan/.test(name)) cat = 'Personal Loans';
      liabCats[cat] = (liabCats[cat] || 0) + Number(d.balance);
    });

    // Liability bar helper (keeps aggregation on liabilities side)
    function row(label, amount, total, color) {
      var pct = total > 0 ? Math.round((amount / total) * 100) : 0;
      return ''
        + '<div style="display:flex;align-items:center;gap:10px;margin:7px 0;">'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:' + ink() + ';">'
        +       '<span>' + escapeHTML(label) + '</span><span>' + fmtUSD(amount) + '</span>'
        +     '</div>'
        +     '<div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;margin-top:4px;overflow:hidden;">'
        +       '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;"></div>'
        +     '</div>'
        +   '</div>'
        + '</div>';
    }

    // v5: render EVERY manual asset as its own row with edit + delete
    var manualAssets = getManualAssets();

    function assetRow(a) {
      var meta = assetTypeMeta(a.type);
      return ''
        + '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(16,185,129,0.05);border:1px solid rgba(16,185,129,0.20);border-radius:8px;margin:6px 0;">'
        +   '<div style="width:30px;height:30px;border-radius:8px;background:' + meta.color + '22;display:grid;place-items:center;color:' + meta.color + ';flex-shrink:0;"><i class="ph-fill ' + meta.icon + '" style="font-size:14px;"></i></div>'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12.5px;font-weight:600;color:' + ink() + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHTML(a.name) + '</div>'
        +     '<div style="font-size:10.5px;color:' + muted() + ';font-weight:500;">' + escapeHTML(meta.label) + (a.institution ? ' · ' + escapeHTML(a.institution) : '') + '</div>'
        +   '</div>'
        +   '<div style="font-size:13.5px;font-weight:700;color:' + ink() + ';margin-right:6px;">' + fmtUSD(a.value) + '</div>'
        +   '<button class="wjp-pf-edit" data-id="' + escapeHTML(a.id) + '" title="Edit" style="background:transparent;border:none;color:' + muted() + ';padding:4px 6px;cursor:pointer;font-family:inherit;border-radius:5px;"><i class="ph ph-pencil-simple" style="font-size:14px;"></i></button>'
        +   '<button class="wjp-pf-delete" data-id="' + escapeHTML(a.id) + '" title="Delete" style="background:transparent;border:none;color:#ef4444;padding:4px 6px;cursor:pointer;font-family:inherit;border-radius:5px;"><i class="ph ph-trash" style="font-size:14px;"></i></button>'
        + '</div>';
    }
    var assetRowsRendered = manualAssets.map(assetRow).join('');

    // Plaid institutions WITHOUT a saved balance — "Set balance" cards
    var linkedInsts = getLinkedInstitutions();
    var debtInsts = {};
    (s.debts || []).forEach(function (d) { if (d && d.institutionName) debtInsts[d.institutionName] = (debtInsts[d.institutionName] || 0) + 1; });
    var alreadyHas = {};
    manualAssets.forEach(function (a) {
      if (a.institution) alreadyHas[a.institution.toLowerCase()] = true;
      if (a.name) alreadyHas[a.name.toLowerCase()] = true;
    });
    var depositoryInsts = linkedInsts.filter(function (i) {
      if (alreadyHas[i.name.toLowerCase()]) return false;
      return !debtInsts[i.name] || i.txnCount > (debtInsts[i.name] || 0) * 2;
    });

    var instCards = depositoryInsts.map(function (i) {
      var last = i.lastSeen ? new Date(i.lastSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      return ''
        + '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.20);border-radius:8px;margin:6px 0;">'
        +   '<div style="width:28px;height:28px;border-radius:7px;background:rgba(99,102,241,0.15);display:grid;place-items:center;color:#6366f1;flex-shrink:0;"><i class="ph-fill ph-bank" style="font-size:14px;"></i></div>'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12.5px;font-weight:600;color:' + ink() + ';">' + escapeHTML(i.name) + '</div>'
        +     '<div style="font-size:10.5px;color:' + muted() + ';font-weight:500;">Linked · ' + i.txnCount + ' txns · last ' + last + '</div>'
        +   '</div>'
        +   '<button class="wjp-pf-set-balance" data-inst="' + escapeHTML(i.name) + '" style="background:transparent;border:1px solid #6366f1;color:#6366f1;padding:4px 10px;border-radius:6px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:inherit;">Set balance</button>'
        + '</div>';
    }).join('');

    var assetRows;
    if (assetRowsRendered || instCards) {
      var sep = (assetRowsRendered && instCards)
        ? '<div style="margin:14px 0 6px;font-size:9.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:' + muted() + ';">PLAID-LINKED · NEEDS BALANCE</div>'
        : '';
      assetRows = assetRowsRendered + sep + instCards;
    } else {
      assetRows = '<div style="text-align:center;color:' + muted() + ';font-size:12px;padding:20px;">No assets tracked yet. Sync a bank or add manually above.</div>';
    }

    var liabRows = Object.keys(liabCats).sort(function (a, b) { return liabCats[b] - liabCats[a]; })
                         .map(function (k) { return row(k, liabCats[k], nw.liabilities, '#ef4444'); }).join('') ||
                   '<div style="text-align:center;color:' + muted() + ';font-size:12px;padding:20px;">No liabilities yet — keep it that way 🎯</div>';

    return ''
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
      +   '<div class="wjp-pf-card" style="padding:18px 20px;background:' + surface() + ';border:1px solid ' + gridCol() + ';border-radius:14px;">'
      +     '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">'
      +       '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#10b981;font-weight:700;"><i class="ph-fill ph-piggy-bank"></i> ASSETS · ' + fmtUSD(nw.assets) + '</div>'
      +       '<div style="display:flex;gap:6px;">'
      +         '<button class="wjp-pf-sync-bank" style="background:#10b981;border:none;color:#0b0f1a;padding:5px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;"><i class="ph-bold ph-arrows-clockwise" style="font-size:11px;"></i>Sync Bank</button>'
      +         '<button class="wjp-pf-add-asset" style="background:transparent;border:1px solid ' + gridCol() + ';color:' + ink() + ';padding:5px 11px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">+ Manual</button>'
      +       '</div>'
      +     '</div>'
      +     assetRows
      +   '</div>'
      +   '<div class="wjp-pf-card" style="padding:18px 20px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;">'
      +     '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#ef4444;font-weight:800;margin-bottom:12px;"><i class="ph-fill ph-credit-card"></i> LIABILITIES · ' + fmtUSD(nw.liabilities) + '</div>'
      +     liabRows
      +   '</div>'
      + '</div>';
  }

  function s4AllAccounts() {
    var s = getAppState() || {};
    var rows = [];
    var balances = s.balances || {};
    var iter = Array.isArray(balances) ? balances : Object.values(balances || {});
    iter.forEach(function (b) {
      if (!b) return;
      var bal = Number(b.balance || b.current || b.available || 0);
      var t = (b.type || '').toLowerCase();
      var st = (b.subtype || '').toLowerCase();
      var isLiability = (t === 'credit' || t === 'loan' || st === 'credit card');
      rows.push({
        name: b.name || b.officialName || b.accountName || 'Account',
        type: st || t || 'unknown',
        balance: bal,
        isLiability: isLiability,
        lastSync: b.lastSynced || b.last_synced || ''
      });
    });
    (s.debts || []).forEach(function (d) {
      if (!d || !(d.balance > 0)) return;
      // Skip ones already in balances (rough name dedupe)
      var n = (d.name || '').toLowerCase();
      if (rows.some(function (r) { return (r.name || '').toLowerCase() === n; })) return;
      rows.push({ name: d.name, type: 'debt', balance: Number(d.balance), isLiability: true, lastSync: '' });
    });
    getManualAssets().forEach(function (a) {
      rows.push({ name: a.name || a.type, type: a.type || 'asset', balance: Number(a.value) || 0, isLiability: false, lastSync: 'manual' });
    });

    if (!rows.length) {
      return ''
        + '<div class="wjp-pf-card" style="padding:30px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;text-align:center;">'
        +   '<i class="ph ph-bank" style="font-size:32px;color:' + muted() + ';display:block;margin-bottom:10px;"></i>'
        +   '<div style="color:' + ink() + ';font-weight:700;font-size:13px;">No linked accounts yet</div>'
        +   '<div style="color:' + muted() + ';font-size:11.5px;margin-top:4px;">Connect a bank via Sync Bank to populate this table.</div>'
        + '</div>';
    }

    var tbody = rows.map(function (r) {
      var color = r.isLiability ? '#ef4444' : '#10b981';
      var sign = r.isLiability ? '−' : '';
      return ''
        + '<tr style="border-bottom:1px solid ' + gridCol() + ';">'
        +   '<td style="padding:11px 12px;color:' + ink() + ';font-weight:700;font-size:12.5px;">' + escapeHTML(r.name) + '</td>'
        +   '<td style="padding:11px 12px;color:' + muted() + ';font-size:11.5px;text-transform:capitalize;">' + escapeHTML(r.type) + '</td>'
        +   '<td style="padding:11px 12px;color:' + color + ';font-weight:800;font-size:13px;text-align:right;">' + sign + fmtUSD(r.balance) + '</td>'
        +   '<td style="padding:11px 12px;color:' + muted() + ';font-size:11px;text-align:right;">' + escapeHTML(r.lastSync || '—') + '</td>'
        + '</tr>';
    }).join('');

    return ''
      + '<div class="wjp-pf-card" style="padding:18px 20px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;">'
      +   '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:' + muted() + ';font-weight:800;margin-bottom:12px;"><i class="ph-fill ph-bank"></i> ALL ACCOUNTS · ' + rows.length + '</div>'
      +   '<div style="overflow-x:auto;">'
      +     '<table style="width:100%;border-collapse:collapse;font-family:inherit;">'
      +       '<thead><tr style="text-align:left;font-size:9.5px;letter-spacing:0.1em;color:' + muted() + ';font-weight:800;text-transform:uppercase;">'
      +         '<th style="padding:8px 12px;">Account</th><th style="padding:8px 12px;">Type</th><th style="padding:8px 12px;text-align:right;">Balance</th><th style="padding:8px 12px;text-align:right;">Last Sync</th>'
      +       '</tr></thead>'
      +       '<tbody>' + tbody + '</tbody>'
      +     '</table>'
      +   '</div>'
      + '</div>';
  }

  function s5MoneyWorking() {
    var s = getAppState() || {};
    var nw = getNetWorth();
    // Interest paid (annualized): sum debt balance × APR
    var interestPaid = (s.debts || []).reduce(function (sum, d) {
      var apr = Number(d.apr || d.rate || 0) / 100;
      return sum + Number(d.balance || 0) * apr;
    }, 0);
    // Interest earned (assume HYSA-tier savings 0.5% by default if no investment data)
    var liquid = nw.plaidAssets;
    var savingsApy = 0.005; // conservative default
    var interestEarned = liquid * savingsApy;
    var gap = interestPaid - interestEarned;

    var recommendation;
    if (interestPaid > interestEarned * 2) {
      recommendation = 'Park surplus cash in a high-yield savings account at 4.5% APY = ~' + fmtUSD(liquid * 0.045) + '/yr earned.';
    } else if (liquid < 1000) {
      recommendation = 'Build $1k starter emergency fund before optimizing yield.';
    } else {
      recommendation = 'Strong position. Consider funneling surplus into retirement (401k match) for compound growth.';
    }

    return ''
      + '<div class="wjp-pf-card" style="padding:20px 22px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;">'
      +   '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:' + muted() + ';font-weight:800;margin-bottom:14px;"><i class="ph-fill ph-coins"></i> MONEY WORKING FOR YOU</div>'
      +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">'
      +     '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:14px 16px;">'
      +       '<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#10b981;font-weight:800;">EARNED / YR</div>'
      +       '<div style="font-size:22px;font-weight:700;color:' + ink() + ';margin-top:4px;">' + fmtUSD(interestEarned) + '</div>'
      +       '<div style="font-size:10.5px;color:' + muted() + ';font-weight:600;margin-top:3px;">interest on ' + fmtUSDk(liquid) + ' liquid</div>'
      +     '</div>'
      +     '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:14px 16px;">'
      +       '<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#ef4444;font-weight:800;">PAID / YR</div>'
      +       '<div style="font-size:22px;font-weight:700;color:' + ink() + ';margin-top:4px;">' + fmtUSD(interestPaid) + '</div>'
      +       '<div style="font-size:10.5px;color:' + muted() + ';font-weight:600;margin-top:3px;">interest on ' + fmtUSDk(nw.liabilities) + ' in debt</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;border-radius:8px;padding:12px 14px;">'
      +     '<div style="font-size:9.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#f59e0b;margin-bottom:4px;">→ RECOMMENDATION</div>'
      +     '<div style="font-size:12.5px;color:' + ink() + ';font-weight:600;line-height:1.45;">'
      +       (gap > 0 ? 'You\'re paying ' + fmtUSD(gap) + '/yr more in interest than earning. ' : '')
      +       escapeHTML(recommendation)
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function s6Insights() {
    var ins = getInsights();
    var rows = ins.map(function (i) {
      return ''
        + '<div style="display:flex;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.02);border:1px solid ' + gridCol() + ';border-radius:10px;">'
        +   '<div style="width:36px;height:36px;border-radius:9px;background:rgba(99,102,241,0.12);display:grid;place-items:center;flex-shrink:0;color:#818cf8;"><i class="ph ' + i.icon + '" style="font-size:18px;"></i></div>'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-size:12.5px;font-weight:700;color:' + ink() + ';">' + escapeHTML(i.title) + '</div>'
        +     '<div style="font-size:11.5px;color:' + muted() + ';font-weight:600;margin-top:3px;line-height:1.4;">' + escapeHTML(i.body) + '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
    return ''
      + '<div class="wjp-pf-card" style="padding:18px 20px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;">'
      +   '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:' + muted() + ';font-weight:800;margin-bottom:12px;"><i class="ph-fill ph-magnifying-glass"></i> INSIGHTS & TRENDS</div>'
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:10px;">'
      +     rows
      +   '</div>'
      + '</div>';
  }

  function s7Milestones() {
    var mils = getMilestones();
    var tiles = mils.map(function (m, i) {
      var bg = m.reached ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)';
      var brd = m.reached ? '#10b981' : gridCol();
      var ico = m.reached ? '✓' : (i + 1);
      var icoBg = m.reached ? '#10b981' : 'rgba(255,255,255,0.08)';
      var icoColor = m.reached ? '#0b0f1a' : muted();
      return ''
        + '<div style="padding:12px 14px;background:' + bg + ';border:1px solid ' + brd + ';border-radius:10px;min-width:140px;">'
        +   '<div style="display:flex;align-items:center;gap:8px;">'
        +     '<div style="width:22px;height:22px;border-radius:50%;background:' + icoBg + ';color:' + icoColor + ';display:grid;place-items:center;font-weight:800;font-size:11px;">' + ico + '</div>'
        +     '<div style="font-size:11px;font-weight:700;color:' + ink() + ';">' + escapeHTML(m.label) + '</div>'
        +   '</div>'
        +   '<div style="font-size:13.5px;font-weight:800;color:' + ink() + ';margin-top:4px;">' + (m.v >= 1000000 ? '$1M' : fmtUSDk(m.v)) + '</div>'
        +   (m.reached ? '' :
              '<div style="height:4px;background:rgba(255,255,255,0.06);border-radius:3px;margin-top:6px;overflow:hidden;"><div style="height:100%;width:' + Math.round(m.pct) + '%;background:' + accent() + ';border-radius:3px;"></div></div>'
              + '<div style="font-size:9.5px;color:' + muted() + ';margin-top:3px;font-weight:600;">' + Math.round(m.pct) + '% there</div>')
        + '</div>';
    }).join('');
    return ''
      + '<div class="wjp-pf-card" style="padding:18px 20px;background:var(--card-2,#1c2540);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:14px;">'
      +   '<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:' + muted() + ';font-weight:800;margin-bottom:12px;"><i class="ph-fill ph-trophy"></i> NET WORTH MILESTONES</div>'
      +   '<div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;">' + tiles + '</div>'
      + '</div>';
  }

  // =====================================================================
  // chart drawers
  // =====================================================================
  function drawTrajectory() {
    if (typeof window.Chart === 'undefined') {
      setTimeout(drawTrajectory, 300);
      return;
    }
    var cvs = document.getElementById('wjp-pf-trajectory');
    if (!cvs) return;
    var existing = window.Chart.getChart && window.Chart.getChart(cvs);
    if (existing) try { existing.destroy(); } catch (_) {}
    var series = getNetWorthSeries();
    var todayIdx = series.todayIdx;
    var currentNet = series.actual[todayIdx];
    var inkLive = isDark() ? '#ffffff' : '#0a0a0a';
    var mutedLive = isDark() ? 'rgba(241,245,249,0.6)' : 'rgba(10,10,10,0.55)';
    var gridLive = isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(10,10,10,0.06)';
    var accentLive = '#10b981';

    new window.Chart(cvs, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          {
            label: 'Actual',
            data: series.actual,
            borderColor: accentLive,
            backgroundColor: function (ctx) {
              try {
                var a = ctx.chart.chartArea;
                if (!a) return 'rgba(16,185,129,0.15)';
                var g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
                g.addColorStop(0, 'rgba(16,185,129,0.28)');
                g.addColorStop(1, 'rgba(16,185,129,0.01)');
                return g;
              } catch (_) { return 'rgba(16,185,129,0.15)'; }
            },
            borderWidth: 2.5, fill: true, tension: 0.35,
            // Render "today" as a bigger dot, rest hidden
            pointRadius: series.labels.map(function (_, i) { return i === todayIdx ? 5 : 0; }),
            pointBackgroundColor: series.labels.map(function (_, i) { return i === todayIdx ? accentLive : 'transparent'; }),
            pointBorderColor: isDark() ? '#0b0f1a' : '#ffffff',
            pointBorderWidth: 2,
            pointHoverRadius: 5
          },
          {
            label: 'Projected',
            data: series.projected,
            borderColor: 'rgba(99,102,241,0.75)',
            borderDash: [5, 5], borderWidth: 2, fill: false, tension: 0.35, pointRadius: 0,
            pointHoverRadius: 4, pointBackgroundColor: 'rgba(99,102,241,1)'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 14, right: 8 } },
        plugins: {
          legend: { display: false }, // section header explains both lines
          tooltip: {
            backgroundColor: isDark() ? 'rgba(11,15,26,0.96)' : 'rgba(255,255,255,0.98)',
            titleColor: inkLive, bodyColor: inkLive,
            borderColor: gridLive, borderWidth: 1, padding: 10,
            titleFont: { size: 12, weight: '600', family: 'Inter' },
            bodyFont: { size: 12, weight: '500', family: 'Inter' },
            callbacks: {
              title: function (items) { return items[0] ? items[0].label : ''; },
              label: function (ctx) {
                var v = ctx.parsed.y;
                if (v == null) return '';
                return ' ' + ctx.dataset.label + ': ' + fmtUSD(v);
              },
              afterBody: function (items) {
                if (!items.length) return '';
                var i = items[0].dataIndex;
                if (i === todayIdx) return ['', 'Today']; 
                return '';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: mutedLive, font: { size: 10.5, weight: '500', family: 'Inter' }, maxRotation: 0 } },
          y: { grid: { color: gridLive, drawBorder: false }, ticks: { color: mutedLive, font: { size: 10.5, weight: '500', family: 'Inter' }, callback: function (v) { return fmtUSDk(v); } } }
        }
      },
      plugins: [{
        id: 'wjpZeroLine',
        afterDraw: function (chart) {
          var c = chart.ctx, a = chart.chartArea, ys = chart.scales.y, xs = chart.scales.x;
          if (!a) return;
          c.save();
          // Break-even reference at $0
          if (ys.min < 0 && ys.max > 0) {
            var y0 = ys.getPixelForValue(0);
            if (y0 > a.top && y0 < a.bottom) {
              c.strokeStyle = mutedLive; c.lineWidth = 1; c.setLineDash([3, 3]);
              c.beginPath(); c.moveTo(a.left, y0); c.lineTo(a.right, y0); c.stroke();
              c.setLineDash([]);
              c.fillStyle = mutedLive; c.font = '600 9.5px Inter';
              c.fillText('break-even', a.right - 60, y0 - 4);
            }
          }
          // "Today" vertical line
          if (todayIdx >= 0) {
            var xT = xs.getPixelForValue(todayIdx);
            c.strokeStyle = accentLive; c.lineWidth = 1; c.setLineDash([3, 3]);
            c.beginPath(); c.moveTo(xT, a.top); c.lineTo(xT, a.bottom); c.stroke();
            c.setLineDash([]);
            // "Today" pill
            var txt = 'TODAY';
            c.font = '700 9px Inter';
            var w = c.measureText(txt).width + 10;
            var pillY = a.top + 2;
            c.fillStyle = accentLive;
            if (c.roundRect) { c.beginPath(); c.roundRect(xT - w/2, pillY, w, 14, 7); c.fill(); }
            else c.fillRect(xT - w/2, pillY, w, 14);
            c.fillStyle = '#ffffff';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText(txt, xT, pillY + 7);
          }
          c.restore();
        }
      }]
    });
  }

  function drawHealthGauge() {
    var cvs = document.getElementById('wjp-pf-health-gauge');
    if (!cvs || !cvs.getContext) return;
    var hs = getHealthScore();
    var ctx = cvs.getContext('2d');
    var size = 180;
    cvs.width = size * (window.devicePixelRatio || 1);
    cvs.height = size * (window.devicePixelRatio || 1);
    cvs.style.width = size + 'px'; cvs.style.height = size + 'px';
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    var cx = size / 2, cy = size / 2;
    var r = size / 2 - 14;
    var start = Math.PI * 0.75;       // bottom-left
    var end   = Math.PI * 2.25;       // bottom-right (3/4 sweep)
    var pct = Math.min(1, hs.total / 1000);
    var current = start + (end - start) * pct;

    // Track
    ctx.lineWidth = 14;
    ctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(10,10,10,0.10)';
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end, false); ctx.stroke();

    // Score arc (gradient by tier)
    var grad = ctx.createLinearGradient(0, 0, size, 0);
    if (hs.total >= 800) { grad.addColorStop(0, '#a78bfa'); grad.addColorStop(1, '#6366f1'); }
    else if (hs.total >= 600) { grad.addColorStop(0, '#10b981'); grad.addColorStop(1, '#34d399'); }
    else if (hs.total >= 400) { grad.addColorStop(0, '#f59e0b'); grad.addColorStop(1, '#fbbf24'); }
    else { grad.addColorStop(0, '#ef4444'); grad.addColorStop(1, '#fb7185'); }
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, r, start, current, false); ctx.stroke();
  }

  // =====================================================================
  // manual-asset add modal
  // =====================================================================
  function openAddAssetModal(preset) {
    preset = preset || {};
    if (document.getElementById('wjp-pf-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'wjp-pf-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:grid;place-items:center;z-index:99999;';
    overlay.innerHTML = ''
      + '<div style="background:var(--card-2,#1c2540);color:var(--ink,#fff);padding:24px;border-radius:14px;width:90%;max-width:420px;border:1px solid var(--border,rgba(255,255,255,0.1));font-family:inherit;">'
      +   '<div style="font-size:16px;font-weight:800;margin-bottom:14px;">Add Manual Asset</div>'
      +   '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:' + muted() + ';display:block;">Type</label>'
      +   '<select id="wjp-pf-asset-type" style="width:100%;padding:9px 11px;margin-top:4px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid ' + gridCol() + ';color:' + ink() + ';font-family:inherit;font-size:13px;">'
      +     '<option value="checking">Checking</option>'
      +     '<option value="savings">Savings</option>'
      +     '<option value="cash">Cash on hand</option>'
      +     '<option value="realestate">Real Estate</option>'
      +     '<option value="vehicle">Vehicle</option>'
      +     '<option value="investment">Investment / Retirement</option>'
      +     '<option value="other">Other</option>'
      +   '</select>'
      +   '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:' + muted() + ';display:block;margin-top:12px;">Label</label>'
      +   '<input id="wjp-pf-asset-name" type="text" placeholder="e.g. Primary residence" style="width:100%;padding:9px 11px;margin-top:4px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid ' + gridCol() + ';color:' + ink() + ';font-family:inherit;font-size:13px;" />'
      +   '<label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:' + muted() + ';display:block;margin-top:12px;">Estimated Value (USD)</label>'
      +   '<input id="wjp-pf-asset-value" type="number" placeholder="0" min="0" style="width:100%;padding:9px 11px;margin-top:4px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid ' + gridCol() + ';color:' + ink() + ';font-family:inherit;font-size:13px;" />'
      +   '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">'
      +     '<button id="wjp-pf-cancel" style="background:transparent;border:1px solid ' + gridCol() + ';color:' + ink() + ';padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;">Cancel</button>'
      +     '<button id="wjp-pf-save" style="background:' + accent() + ';border:none;color:#0b0f1a;padding:8px 18px;border-radius:8px;font-weight:800;cursor:pointer;font-family:inherit;">Save Asset</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    document.getElementById('wjp-pf-cancel').onclick = function () { overlay.remove(); };
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    if (preset.presetType) document.getElementById('wjp-pf-asset-type').value = preset.presetType;
    if (preset.presetName) document.getElementById('wjp-pf-asset-name').value = preset.presetName;
    if (preset.presetValue) document.getElementById('wjp-pf-asset-value').value = preset.presetValue;
    if (preset.editId) {
      var t0 = overlay.querySelector('div > div');
      if (t0) t0.textContent = 'Edit Asset';
    }

    document.getElementById('wjp-pf-save').onclick = function () {
      var t = document.getElementById('wjp-pf-asset-type').value;
      var n = document.getElementById('wjp-pf-asset-name').value.trim();
      var v = Number(document.getElementById('wjp-pf-asset-value').value) || 0;
      if (!n) { alert('Please enter a label.'); return; }
      if (v <= 0) { alert('Please enter a positive value.'); return; }
      var arr = getManualAssets();
      if (preset.editId) {
        var idx = arr.findIndex(function (x) { return x.id === preset.editId; });
        if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], { type: t, name: n, value: v, institution: preset.presetInstitution || arr[idx].institution, updatedAt: new Date().toISOString() });
      } else {
        arr.push({ id: 'a_' + Date.now(), type: t, name: n, value: v, institution: preset.presetInstitution || null, createdAt: new Date().toISOString() });
      }
      setManualAssets(arr);
      overlay.remove();
      renderPortfolio();
    };
  }

  // =====================================================================
  // page mount + routing
  // =====================================================================
  function getHostContainer() {
    return document.querySelector('.content-area') || document.querySelector('.main-area') || document.body;
  }

  function ensurePage() {
    var page = document.getElementById('page-portfolio');
    if (!page) {
      page = document.createElement('div');
      page.id = 'page-portfolio';
      page.className = 'page';
      page.style.cssText = 'padding:20px 24px;display:none;';
      getHostContainer().appendChild(page);
    }
    return page;
  }

  function renderPortfolio() {
    var page = ensurePage();
    page.innerHTML = ''
      + '<div style="display:flex;flex-direction:column;gap:16px;">'
      +   s1NetWorthHero()
      +   s2HealthScore()
      +   s3AssetsLiabilities()
      +   s4AllAccounts()
      +   s5MoneyWorking()
      +   s6Insights()
      +   s7Milestones()
      + '</div>';
    // Wire up — Add Manual, Sync Bank, Set-Balance per institution
    page.querySelectorAll('.wjp-pf-add-asset').forEach(function (b) { b.onclick = function () { openAddAssetModal(); }; });
    page.querySelectorAll('.wjp-pf-sync-bank').forEach(function (b) {
      b.onclick = function () {
        var hostBtn = document.getElementById('btn-link-bank')
                   || document.getElementById('linked-assets-cta-bank');
        if (hostBtn) hostBtn.click();
      };
    });
    page.querySelectorAll('.wjp-pf-set-balance').forEach(function (b) {
      b.onclick = function () {
        var inst = b.getAttribute('data-inst');
        openAddAssetModal({ presetName: inst, presetType: 'checking', presetInstitution: inst });
      };
    });
    page.querySelectorAll('.wjp-pf-edit').forEach(function (b) {
      b.onclick = function () { editManualAsset(b.getAttribute('data-id')); };
    });
    page.querySelectorAll('.wjp-pf-delete').forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        if (confirm('Delete this asset?')) deleteManualAsset(id);
      };
    });
    // Draw charts after DOM paints
    setTimeout(function () { try { drawTrajectory(); drawHealthGauge(); } catch (_) {} }, 50);
  }

  function showPortfolio() {
    var host = getHostContainer();
    // 2026-05-18 fix: drop display:none !important — its inline cssText was
    // sticking permanently and breaking subsequent tab navigation to Budgets/Strategy.
    host.querySelectorAll('.page, [id^="page-"]').forEach(function (p) {
      if (p.id === 'page-portfolio') return;
      if (p.style.cssText && p.style.cssText.indexOf('!important') !== -1) p.style.cssText = '';
      p.style.display = 'none';
      p.classList.remove('active');
    });
    var page = ensurePage();
    // v2: give page-portfolio an opaque min-height background so the host's
    // gradient doesn't bleed through gaps between our cards.
    page.style.cssText = 'display:block;padding:20px 24px;min-height:calc(100vh - 80px);background:var(--bg, var(--canvas, transparent));';
    page.classList.add('active');
    renderPortfolio();
    // Toggle header nav active state
    setActiveTab('portfolio');
  }

  function showOtherPage(pageId) {
    var pf = document.getElementById('page-portfolio');
    if (pf) { pf.style.display = 'none'; pf.classList.remove('active'); }
    // 2026-05-18 fix: clear stuck !important display:none on all other pages
    document.querySelectorAll('.page, [id^="page-"]').forEach(function (p) {
      if (p.style.cssText && p.style.cssText.indexOf('!important') !== -1) p.style.cssText = '';
    });
    var target = document.getElementById('page-' + pageId);
    if (target) { target.style.display = 'block'; target.classList.add('active'); }
  }

  // v6: keep the header tab active-state honest. On the dashboard, "Your Dashboard"
  // (the #header-title element) should read as selected — NOT the Portfolio tab.
  function injectActiveStyle() {
    if (document.getElementById('wjp-pf-active-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-pf-active-style';
    st.textContent =
      '#header-title.wjp-dash-active{color:var(--accent,#10b981) !important;font-weight:700;}'
      + '#header-title{cursor:pointer;transition:color .12s;}';
    (document.head || document.documentElement).appendChild(st);
  }
  // which: 'dashboard' | 'portfolio' | 'other'
  function setActiveTab(which) {
    var title = document.getElementById('header-title');
    var pfTab = document.querySelector('.header-nav-item[data-page="wjp-portfolio"]');
    if (which === 'portfolio') {
      if (title) title.classList.remove('wjp-dash-active');
      document.querySelectorAll('.header-nav-item').forEach(function (b) { b.classList.remove('active'); });
      if (pfTab) pfTab.classList.add('active');
    } else if (which === 'dashboard') {
      if (pfTab) pfTab.classList.remove('active');
      if (title) title.classList.add('wjp-dash-active');
    } else { // other (budgets / strategy) — host owns nav-item active, we just clear our bits
      if (title) title.classList.remove('wjp-dash-active');
      if (pfTab) pfTab.classList.remove('active');
    }
  }

  function installHeaderTab() {
    // v3: keep header tab text "Portfolio" — sidebar Dashboard is the only Dashboard entry.
    // Just intercept clicks on the existing tab and reroute to our new page.
    var existing = [...document.querySelectorAll('.header-nav-item')].find(function (b) { return b.textContent.trim() === 'Portfolio'; });
    if (!existing || existing._wjpPortfolioBound) return false;
    existing._wjpPortfolioBound = true;
    injectActiveStyle();
    // Mark with our data-page for state tracking
    existing.setAttribute('data-page', 'wjp-portfolio');

    existing.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      showPortfolio();
    }, true);

    // Other header tabs: hide our page when clicked so host can restore its own
    document.querySelectorAll('.header-nav-item').forEach(function (b) {
      if (b === existing) return;
      b.addEventListener('click', function () {
        var pf = document.getElementById('page-portfolio');
        if (pf) { pf.style.cssText = 'display:none;'; pf.classList.remove('active'); }
        setActiveTab('other');
      }, true);
    });

    // Also: if sidebar Dashboard is clicked, hide our portfolio page so user lands on dashboard
    document.querySelectorAll('.nav-item, [data-page="dashboard"]').forEach(function (n) {
      n.addEventListener('click', function () {
        var pf = document.getElementById('page-portfolio');
        if (pf) { pf.style.cssText = 'display:none;'; pf.classList.remove('active'); }
        setActiveTab('dashboard');
      }, true);
    });

    // The header title itself becomes a Dashboard affordance — click it to go home.
    var title = document.getElementById('header-title');
    if (title && !title._wjpBound) {
      title._wjpBound = true;
      title.addEventListener('click', function () {
        var dashNav = document.querySelector('.nav-item[data-page="dashboard"], .nav-item');
        if (dashNav) dashNav.click();
        setActiveTab('dashboard');
      });
    }

    // Initial state: dashboard is the default landing page.
    setActiveTab('dashboard');

    // Guard: the host may re-assert .active on the Portfolio tab during its own
    // nav routing. Watch for it and correct whenever the dashboard is the visible page.
    try {
      var navMo = new MutationObserver(function () {
        var pf = document.getElementById('page-portfolio');
        var pfVisible = pf && pf.style.display === 'block';
        if (!pfVisible) {
          var pfTab = document.querySelector('.header-nav-item[data-page="wjp-portfolio"]');
          var dash = document.getElementById('page-dashboard');
          var dashVisible = dash && getComputedStyle(dash).display !== 'none';
          if (pfTab && pfTab.classList.contains('active') && dashVisible) {
            setActiveTab('dashboard');
          }
        }
      });
      document.querySelectorAll('.header-nav-item').forEach(function (b) {
        navMo.observe(b, { attributes: true, attributeFilter: ['class'] });
      });
    } catch (_) {}

    return true;
  }

  function tryInstall() {
    if (installHeaderTab()) return;
    setTimeout(tryInstall, 400);
  }

  // Theme re-render — redraw charts when dark/light toggles
  function observeTheme() {
    try {
      var mo = new MutationObserver(function () {
        var pf = document.getElementById('page-portfolio');
        if (pf && pf.style.display === 'block') renderPortfolio();
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { tryInstall(); observeTheme(); });
  } else {
    tryInstall();
    observeTheme();
  }

  // Expose for debugging
  window.WJP_Portfolio = {
    show: showPortfolio,
    render: renderPortfolio,
    getNetWorth: getNetWorth,
    getHealthScore: getHealthScore
  };
})();
