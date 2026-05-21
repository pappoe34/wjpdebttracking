/* wjp-wealth-signals.js v1 — 2026-05-21
 *
 * Populates the static "Transaction Analysis & Wealth Signals" box on the
 * Debts > Transactions sub-tab with REAL analysis from appState. The placeholder
 * in index.html literally says "Add a few transactions" — but the user has
 * thousands of them. This module computes:
 *   - Debt-to-income ratio
 *   - 30-day spending vs 30-day income (cash flow)
 *   - Top spending category + 7-day trend
 *   - Subscription audit (count + monthly total)
 *   - Pending recurring payments (unconfirmed)
 *
 * And generates 3-5 actionable Wealth Optimization Suggestions sorted by impact.
 */
(function () {
  "use strict";
  if (window._wjpWealthSignalsInstalled) return;
  window._wjpWealthSignalsInstalled = true;

  function getState() { try { return appState; } catch (_) { return (window.appState || null); } }
  function fmt(n) {
    var v = Math.abs(Math.round(Number(n) || 0));
    return '$' + v.toLocaleString('en-US');
  }
  function fmtPct(n) { return (Math.round((Number(n) || 0) * 100) / 100) + '%'; }

  function isTransfer(t) {
    if (!t) return false;
    var c = String(t.category || '').toLowerCase();
    var m = String(t.merchant || '').toLowerCase();
    var meth = String(t.method || '').toLowerCase();
    if (/transfer|interbank|ach\s*transfer|p2p|venmo|zelle|cashapp|paypal\s*transfer/.test(c)) return true;
    if (/transfer to|transfer from|to checking|from checking|to savings|from savings|to credit|online\s*banking\s*transfer/.test(m)) return true;
    if (/transfer/.test(meth)) return true;
    return false;
  }
  function isReal(t) { return t && !t.synthetic && !isTransfer(t); }

  function smartCategorize(t) {
    if (!t) return 'Other';
    var c = t.category;
    if (c && !/^(other|uncategorized|unknown)$/i.test(c)) return c;
    var merch = t.merchant || '';
    try {
      if (typeof window.autoCategorizeMerchant === 'function') {
        var hit = window.autoCategorizeMerchant(merch);
        if (hit) return hit;
      }
    } catch (_) {}
    return 'Other';
  }

  function computeSignals() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return null;
    var now = Date.now();
    var DAY = 86400000;
    var realTxns = s.transactions.filter(isReal);

    // 30-day window
    var thirtyAgo = now - 30 * DAY;
    var sixtyAgo = now - 60 * DAY;
    var sevenAgo = now - 7 * DAY;
    var prev30 = realTxns.filter(function (t) { var d = new Date(t.date).getTime(); return d >= sixtyAgo && d < thirtyAgo; });
    var last30 = realTxns.filter(function (t) { var d = new Date(t.date).getTime(); return d >= thirtyAgo && d <= now; });
    var last7  = realTxns.filter(function (t) { var d = new Date(t.date).getTime(); return d >= sevenAgo && d <= now; });

    function income(txns) { return txns.filter(function (t) { return (Number(t.amount) || 0) > 0; }).reduce(function (sum, t) { return sum + Number(t.amount); }, 0); }
    function spend(txns)  { return txns.filter(function (t) { return (Number(t.amount) || 0) < 0; }).reduce(function (sum, t) { return sum + Math.abs(Number(t.amount)); }, 0); }

    var inc30 = income(last30);
    var spend30 = spend(last30);
    var prevSpend30 = spend(prev30);
    var netCash = inc30 - spend30;
    var spendDelta = prevSpend30 > 0 ? ((spend30 - prevSpend30) / prevSpend30) * 100 : 0;

    // Top spending category (last 30, smartCategorize)
    var byCat = {};
    last30.filter(function (t) { return (Number(t.amount) || 0) < 0; }).forEach(function (t) {
      var c = smartCategorize(t);
      byCat[c] = (byCat[c] || 0) + Math.abs(Number(t.amount) || 0);
    });
    var topCat = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0] || null;
    var topCatAmt = topCat ? byCat[topCat] : 0;

    // Debt-to-income from debts.minPayment / monthly income
    var debts = Array.isArray(s.debts) ? s.debts : [];
    var monthlyDebtMin = debts.reduce(function (sum, d) { return sum + (Number(d.minPayment) || 0); }, 0);
    var monthlyIncome = inc30; // proxy
    var dti = monthlyIncome > 0 ? (monthlyDebtMin / monthlyIncome) * 100 : 0;

    // Subscription audit
    var recurring = Array.isArray(s.recurringPayments) ? s.recurringPayments : (Array.isArray(s.recurring) ? s.recurring : []);
    var subs = recurring.filter(function (r) {
      if (!r) return false;
      var c = String(r.category || '').toLowerCase();
      return /subscription|streaming|membership/.test(c) || (Number(r.amount) > 0 && Number(r.amount) < 100 && !/income|salary|payroll/i.test(r.category || ''));
    });
    var subMonthly = subs.reduce(function (sum, r) { return sum + (Number(r.amount) || 0); }, 0);

    // Pending recurring (unconfirmed)
    var pendingSynthetic = (s.transactions || []).filter(function (t) {
      return t && t.synthetic && (t.status === 'pending' || (new Date(t.date).getTime() <= now && t.status !== 'completed'));
    }).length;

    // Highest-APR debt
    var hiAprDebt = debts.slice().sort(function (a, b) { return (Number(b.apr) || 0) - (Number(a.apr) || 0); })[0];

    return {
      inc30: inc30, spend30: spend30, netCash: netCash, spendDelta: spendDelta,
      topCat: topCat, topCatAmt: topCatAmt,
      dti: dti, monthlyDebtMin: monthlyDebtMin,
      subs: subs, subMonthly: subMonthly,
      pendingSynthetic: pendingSynthetic,
      hiAprDebt: hiAprDebt
    };
  }

  function buildSignalsHTML(sig) {
    var rows = [];
    // DTI signal
    var dtiColor = sig.dti < 36 ? '#10b981' : sig.dti < 43 ? '#f59e0b' : '#ef4444';
    var dtiLabel = sig.dti < 36 ? 'Healthy' : sig.dti < 43 ? 'Watchful' : 'High';
    rows.push({ icon: 'ph-fill ph-chart-line-up', label: 'Debt-to-income', value: fmtPct(sig.dti), sub: dtiLabel + ' · ' + fmt(sig.monthlyDebtMin) + '/mo minimums', color: dtiColor });

    // Cash flow
    var cfColor = sig.netCash >= 0 ? '#10b981' : '#ef4444';
    var cfDir = sig.netCash >= 0 ? '+' : '-';
    rows.push({ icon: 'ph-fill ph-trend-up', label: 'Net cash flow (30d)', value: cfDir + fmt(sig.netCash), sub: 'Income ' + fmt(sig.inc30) + ' vs spend ' + fmt(sig.spend30), color: cfColor });

    // Spending trend
    var trendDir = sig.spendDelta > 0 ? '↑' : sig.spendDelta < 0 ? '↓' : '→';
    var trendColor = sig.spendDelta > 0 ? '#ef4444' : sig.spendDelta < 0 ? '#10b981' : '#94a3b8';
    rows.push({ icon: 'ph-fill ph-arrow-bend-double-up-right', label: 'Spend vs prior 30d', value: trendDir + ' ' + fmtPct(Math.abs(sig.spendDelta)), sub: sig.spendDelta > 0 ? 'Spending up — review category trends' : sig.spendDelta < 0 ? 'Spending down — keep it up' : 'Flat month-over-month', color: trendColor });

    // Top category
    if (sig.topCat) {
      rows.push({ icon: 'ph-fill ph-chart-pie-slice', label: 'Top spending category', value: sig.topCat, sub: fmt(sig.topCatAmt) + ' over last 30 days', color: '#6366f1' });
    }

    // Subscriptions
    if (sig.subs.length) {
      rows.push({ icon: 'ph-fill ph-scissors', label: 'Recurring subscriptions', value: sig.subs.length + ' active', sub: fmt(sig.subMonthly) + '/mo · ' + fmt(sig.subMonthly * 12) + '/yr', color: '#f59e0b' });
    }

    // Pending recurring (unconfirmed)
    if (sig.pendingSynthetic > 0) {
      rows.push({ icon: 'ph-fill ph-warning-circle', label: 'Unconfirmed scheduled', value: sig.pendingSynthetic + ' payment(s)', sub: 'Waiting for Plaid match or your confirmation', color: '#f59e0b' });
    }

    return rows.map(function (r) {
      return '<div style="display:flex;gap:10px;padding:9px 10px;border-radius:10px;background:' + r.color + '0d;border:1px solid ' + r.color + '20;align-items:center;">' +
        '<div style="width:28px;height:28px;border-radius:8px;background:' + r.color + '24;display:grid;place-items:center;color:' + r.color + ';flex-shrink:0;"><i class="' + r.icon + '" style="font-size:14px;"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + r.label + '</div>' +
          '<div style="font-size:13px;font-weight:800;color:var(--ink,#0a0a0a);margin-top:1px;">' + r.value + '</div>' +
          '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);margin-top:1px;">' + r.sub + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function buildSuggestionsHTML(sig) {
    var s = getState();
    var tips = [];

    // 1. Cut top spending 25%
    if (sig.topCat && sig.topCatAmt > 200) {
      var savings = sig.topCatAmt * 0.25;
      tips.push({ color: '#10b981', text: 'Cut <strong>' + sig.topCat + '</strong> by 25% — saves <strong>' + fmt(savings) + '/mo</strong> · <strong>' + fmt(savings * 12) + '/yr</strong>.' });
    }
    // 2. High-APR debt
    if (sig.hiAprDebt && Number(sig.hiAprDebt.apr) > 20 && Number(sig.hiAprDebt.balance) > 500) {
      tips.push({ color: '#ef4444', text: 'Highest-APR debt: <strong>' + (sig.hiAprDebt.name || 'card') + '</strong> at <strong>' + Number(sig.hiAprDebt.apr).toFixed(2) + '%</strong>. Consider a 0% balance transfer or personal loan at 12-18%.' });
    }
    // 3. Subscription audit
    if (sig.subs.length >= 3) {
      tips.push({ color: '#f59e0b', text: 'Audit <strong>' + sig.subs.length + ' recurring services</strong> (' + fmt(sig.subMonthly) + '/mo). Killing 2 unused ones often frees $20-40/mo.' });
    }
    // 4. DTI warning
    if (sig.dti > 43) {
      tips.push({ color: '#ef4444', text: 'DTI is <strong>' + fmtPct(sig.dti) + '</strong> — above the 43% mortgage cutoff. Knock minimums lower before applying for new credit.' });
    } else if (sig.dti > 36) {
      tips.push({ color: '#f59e0b', text: 'DTI <strong>' + fmtPct(sig.dti) + '</strong> is workable but tight. Get under 36% to unlock the best loan rates.' });
    }
    // 5. Cash-positive nudge
    if (sig.netCash > 500) {
      tips.push({ color: '#10b981', text: 'You netted <strong>+' + fmt(sig.netCash) + '</strong> in the last 30 days. Send that surplus to highest-APR debt or build emergency fund.' });
    } else if (sig.netCash < 0) {
      tips.push({ color: '#ef4444', text: 'Net cash flow is <strong>' + fmt(sig.netCash) + '</strong> negative. Trim recurring expenses or pause discretionary spending until you stabilize.' });
    }
    // 6. Pending recurring nudge
    if (sig.pendingSynthetic > 5) {
      tips.push({ color: '#f59e0b', text: '<strong>' + sig.pendingSynthetic + ' scheduled payments</strong> are unconfirmed. Sync your bank or manually mark them paid so totals reflect reality.' });
    }

    if (!tips.length) {
      return '<div style="color:var(--text-3,#94a3b8);font-size:11px;">Everything looks healthy. Keep going — no urgent optimizations.</div>';
    }
    return tips.slice(0, 5).map(function (t) {
      return '<div style="display:flex;gap:8px;padding:8px 10px;border-radius:8px;border-left:3px solid ' + t.color + ';background:' + t.color + '08;font-size:11.5px;line-height:1.5;color:var(--ink,#0a0a0a);">' +
        '<i class="ph-fill ph-lightbulb" style="color:' + t.color + ';font-size:14px;flex-shrink:0;margin-top:1px;"></i>' +
        '<div>' + t.text + '</div>' +
      '</div>';
    }).join('');
  }

  function findCard() {
    var subtabs = document.querySelectorAll('.debts-subtab-content');
    for (var i = 0; i < subtabs.length; i++) {
      var sub = subtabs[i];
      if ((sub.getAttribute('data-subtab') || '') !== 'transactions') continue;
      var titles = sub.querySelectorAll('.ai-perf-title');
      for (var j = 0; j < titles.length; j++) {
        if (/Transaction Analysis|Wealth Signals/i.test(titles[j].textContent || '')) {
          // Walk up to .ai-performance-card
          var el = titles[j];
          while (el && !(el.classList && el.classList.contains('ai-performance-card'))) el = el.parentElement;
          return el;
        }
      }
    }
    return null;
  }

  function render() {
    try {
      var card = findCard();
      if (!card) return;
      var sig = computeSignals();
      if (!sig) return;
      var grid = card.querySelector('div[style*="grid-template-columns"]');
      if (!grid) return;
      // Replace the two-column placeholder with real content
      grid.innerHTML =
        '<div>' +
          '<div class="card-label" style="color:var(--accent);margin-bottom:10px;">Signals (last 30 days)</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' + buildSignalsHTML(sig) + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="card-label" style="color:var(--accent);margin-bottom:10px;">Wealth Optimization Suggestions</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' + buildSuggestionsHTML(sig) + '</div>' +
        '</div>';
    } catch (e) {
      try { console.warn('[wjp-wealth-signals] render fail', e); } catch (_) {}
    }
  }

  // Re-render after txnRenderAll so signals stay fresh
  function wrap() {
    try {
      var fn = window.txnRenderAll;
      if (typeof fn !== 'function' || fn.__wjpWealthWrapped) return false;
      var wrapped = function () {
        var r = fn.apply(this, arguments);
        try { render(); } catch (_) {}
        return r;
      };
      wrapped.__wjpWealthWrapped = true;
      window.txnRenderAll = wrapped;
      return true;
    } catch (_) { return false; }
  }

  function boot() {
    [800, 2500, 5000].forEach(function (ms) { setTimeout(render, ms); });
    if (!wrap()) {
      [500, 1500, 4000, 9000].forEach(function (ms) { setTimeout(wrap, ms); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
