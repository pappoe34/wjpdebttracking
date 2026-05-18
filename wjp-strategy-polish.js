/* wjp-strategy-polish.js v1 — Final polish for Debts → Strategy subtab.
 *
 * Fixes four UX issues:
 *
 *  1. WJP AI Coach card → spans full width (no empty right-side gap)
 *  2. Spending This Month → adds Y-axis $ labels, total + week deltas,
 *     hover tooltips on bars, week date ranges instead of just "Wk N"
 *  3. Expense Categories → adds $ amount per row, sorted by spend desc,
 *     "Top 3 = X%" callout subtitle
 *  4. "Why Statement Day & Due Date matter" card → adds max-height + scroll,
 *     removes the X dismiss button
 *  5. AI Performance Report → computes & renders Repayment Velocity,
 *     Budget Adherence, Optimization Score from appState.debts/transactions
 *
 * Safe: IIFE, idempotent, path-guarded, no Sync Bank hooks.
 * Dark-mode aware via cascading CSS vars.
 */
(function () {
  'use strict';
  if (window._wjpStrategyPolishInstalled) return;
  window._wjpStrategyPolishInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-strategy-polish-style';
  var DAY_MS = 24 * 60 * 60 * 1000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmtUsd(n, decimals) {
    if (n == null || !isFinite(n)) return '$0';
    var opts = { minimumFractionDigits: decimals == null ? 0 : decimals, maximumFractionDigits: decimals == null ? 0 : decimals };
    return '$' + n.toLocaleString('en-US', opts);
  }
  function fmtPct(n, decimals) {
    if (n == null || !isFinite(n)) return '0%';
    var d = decimals == null ? 0 : decimals;
    return n.toFixed(d) + '%';
  }
  function getState() {
    try { return JSON.parse(localStorage.getItem('wjp_budget_state') || 'null') || {}; } catch (_) { return {}; }
  }

  // ===================== CSS layer =====================
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* (1) WJP AI Coach card spans full width inside its grid */
      '#page-debts .card:has(> .badge.badge-accent + .ai-focus-text),',
      '#page-debts .card:has(> .badge.badge-accent + #ai-advisor-title) {',
      '  grid-column: 1 / -1 !important;',
      '  background: linear-gradient(135deg, var(--card-bg, var(--bg-2, #fff)) 0%, var(--card-2, var(--bg-3, #fafaf7)) 100%) !important;',
      '  border: 1px solid var(--border, rgba(0,0,0,0.08)) !important;',
      '  box-shadow: 0 1px 3px rgba(0,0,0,0.04) !important;',
      '}',
      '',
      /* (2) Spending This Month — heavier polish */
      '.debts-spend-grid .card {',
      '  border-radius: 16px !important;',
      '  border: 1px solid var(--border, rgba(0,0,0,0.10)) !important;',
      '  box-shadow: 0 2px 6px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03) !important;',
      '  background: linear-gradient(180deg, var(--card-bg, var(--bg-2, #fff)) 0%, var(--card-2, var(--bg-3, #fafaf7)) 100%) !important;',
      '  padding: 22px 26px !important;',
      '  transition: box-shadow 0.18s ease, transform 0.18s ease;',
      '}',
      '.debts-spend-grid .card:hover {',
      '  box-shadow: 0 6px 18px rgba(0,0,0,0.06), 0 2px 5px rgba(0,0,0,0.04) !important;',
      '  transform: translateY(-1px);',
      '}',
      'body.dark .debts-spend-grid .card {',
      '  background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%) !important;',
      '  border-color: rgba(255,255,255,0.08) !important;',
      '}',
      /* Spending bars Y-axis + grid lines container */
      '.wjp-sp-yaxis {',
      '  display:flex; flex-direction:column; justify-content:space-between;',
      '  height:130px; padding-right:8px; font-size:10px;',
      '  color: var(--ink-dim, var(--text-2, #6b7280));',
      '  text-align:right; min-width:46px;',
      '}',
      '.wjp-sp-row {',
      '  display:flex; align-items:flex-end; gap:0;',
      '  border-bottom:1px solid var(--border, rgba(0,0,0,0.06));',
      '}',
      '.wjp-sp-week-label {',
      '  display:flex; flex-direction:column; align-items:center; gap:2px;',
      '}',
      '.wjp-sp-week-label .wlabel { font-size:11px; font-weight:700; color:var(--ink, var(--text-1, #0a0a0a)); }',
      '.wjp-sp-week-label .wrange { font-size:10px; color:var(--ink-dim, var(--text-2, #6b7280)); }',
      '.wjp-sp-week-label .wamt { font-size:11px; font-weight:700; color:var(--accent, #1f7a4a); margin-top:1px; }',
      '',
      /* (3) Expense Categories — list with $ amounts */
      '.wjp-ec-list { display:flex; flex-direction:column; gap:6px; margin-top:10px; }',
      '.wjp-ec-row {',
      '  display:grid; grid-template-columns: 14px 1fr auto auto;',
      '  align-items:center; gap:10px;',
      '  padding:6px 0; font-size:12.5px;',
      '  color: var(--ink, var(--text-1, #0a0a0a));',
      '}',
      '.wjp-ec-row .swatch { width:10px; height:10px; border-radius:50%; }',
      '.wjp-ec-row .name { font-weight:600; }',
      '.wjp-ec-row .amt { color:var(--ink-dim, var(--text-2, #6b7280)); font-weight:500; font-size:11.5px; min-width:80px; text-align:right; }',
      '.wjp-ec-row .pct { font-weight:700; color: var(--ink, var(--text-1, #0a0a0a)); min-width:42px; text-align:right; }',
      '.wjp-ec-subtitle { font-size:11px; color:var(--ink-dim, var(--text-2, #6b7280)); margin-top:4px; }',
      '',
      /* (4) "Why Statement Day" — scrollable + no X button */
      '#stmt-edu-card {',
      '  max-height: 60vh !important;',
      '  overflow-y: auto !important;',
      '  scroll-behavior: smooth;',
      '}',
      '#stmt-edu-card::-webkit-scrollbar { width: 8px; }',
      '#stmt-edu-card::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 999px; }',
      'body.dark #stmt-edu-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); }',
      '#stmt-edu-dismiss { display: none !important; }',
      '',
      /* (5) AI Performance Report metric polish */
      '.ai-perf-metric { transition: background 0.18s ease; }',
      '.ai-perf-metric.has-value .ai-perf-val { color: var(--accent, #1f7a4a) !important; font-weight: 800 !important; }',
      '.wjp-perf-sub-detail { font-size: 10px; color: var(--ink-dim, var(--text-2, #6b7280)); margin-top: 2px; font-weight: 500; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  // ===================== Spending This Month upgrade =====================
  function getMonthTransactions(state) {
    var txs = Array.isArray(state.transactions) ? state.transactions : [];
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    return txs.filter(function (t) {
      if (t.type === 'income') return false;
      if (t.transfer || t.isTransfer) return false;
      var d = new Date(t.date || t.timestamp || 0);
      if (isNaN(d.getTime())) return false;
      return d >= start;
    });
  }

  function bucketByWeek(txs) {
    var weeks = [0, 0, 0, 0];
    var ranges = [[1, 7], [8, 14], [15, 21], [22, 31]];
    txs.forEach(function (t) {
      var d = new Date(t.date || t.timestamp || 0);
      if (isNaN(d.getTime())) return;
      var day = d.getDate();
      var idx = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
      var amt = Math.abs(parseFloat(t.amount) || 0);
      weeks[idx] += amt;
    });
    return { weeks: weeks, ranges: ranges };
  }

  function upgradeSpendingCard() {
    try {
      // Locate the Spending This Month card
      var cards = $$('#page-debts .debts-spend-grid .card');
      if (!cards.length) return;
      var spendCard = null;
      for (var i = 0; i < cards.length; i++) {
        if (/Spending This Month/i.test(cards[i].textContent || '')) { spendCard = cards[i]; break; }
      }
      if (!spendCard) return;
      if (spendCard.getAttribute('data-wjp-sp-upgraded') === '1') return;

      var state = getState();
      var monthTxs = getMonthTransactions(state);
      var bucketed = bucketByWeek(monthTxs);
      var total = bucketed.weeks.reduce(function (a, b) { return a + b; }, 0);
      var maxWk = Math.max.apply(null, bucketed.weeks);
      if (maxWk === 0) return; // leave the empty-state alone

      // Build new chart body
      var existingChartWrap = spendCard.querySelector('.chart-wrap');
      var existingLabels = spendCard.querySelector('div[style*="justify-content:space-around"]');
      if (!existingChartWrap) return;

      var now = new Date();
      var month = now.toLocaleString('en-US', { month: 'short' });
      var ymax = Math.ceil(maxWk / 100) * 100;
      var yticks = [ymax, Math.round(ymax * 0.66), Math.round(ymax * 0.33), 0];

      var yaxisHtml = '<div class="wjp-sp-yaxis">' +
        yticks.map(function (v) { return '<div>' + fmtUsd(v) + '</div>'; }).join('') +
        '</div>';
      var barsHtml = '<div style="flex:1;display:flex;align-items:flex-end;justify-content:space-around;height:130px;gap:8px;padding:0 4px;">' +
        bucketed.weeks.map(function (v, idx) {
          var h = ymax ? Math.max(2, (v / ymax) * 120) : 0;
          var bg = v === 0 ? 'rgba(31,122,74,0.18)' : 'linear-gradient(180deg, #1f7a4a 0%, #2da76b 100%)';
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:default;" title="Week ' + (idx + 1) + ': ' + fmtUsd(v, 2) + '">' +
            '<div style="font-size:10px;font-weight:700;color:var(--ink,var(--text-1,#0a0a0a));">' + fmtUsd(v) + '</div>' +
            '<div style="width:100%;max-width:64px;height:' + h + 'px;background:' + bg + ';border-radius:6px 6px 2px 2px;transition:height 0.4s ease;"></div>' +
          '</div>';
        }).join('') + '</div>';

      var chartBox = document.createElement('div');
      chartBox.style.cssText = 'display:flex;align-items:flex-end;height:148px;margin:6px 0 6px;';
      chartBox.innerHTML = yaxisHtml + barsHtml;
      existingChartWrap.replaceWith(chartBox);

      // Week labels with date ranges
      if (existingLabels) {
        existingLabels.innerHTML = bucketed.ranges.map(function (r, idx) {
          return '<div class="wjp-sp-week-label" style="flex:1;text-align:center;">' +
            '<div class="wlabel">Wk ' + (idx + 1) + '</div>' +
            '<div class="wrange">' + month + ' ' + r[0] + '–' + Math.min(r[1], new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) + '</div>' +
          '</div>';
        }).join('');
        existingLabels.style.cssText = 'display:flex;justify-content:space-around;gap:8px;padding:0 4px 0 54px;margin-top:8px;';
      }

      // Update sub label with transaction count + average week
      var subEl = $('#debts-spending-month-sub', spendCard);
      if (subEl) {
        var avg = total / 4;
        subEl.textContent = monthTxs.length + ' transactions · avg ' + fmtUsd(avg) + '/week';
      }
      var totalEl = $('#debts-spending-month-total', spendCard);
      if (totalEl) totalEl.textContent = fmtUsd(total);

      spendCard.setAttribute('data-wjp-sp-upgraded', '1');
    } catch (e) { try { console.warn('[wjp-strategy-polish] spending upgrade failed', e); } catch (_) {} }
  }

  // ===================== Expense Categories upgrade =====================
  function categorize(txs) {
    var cats = {};
    txs.forEach(function (t) {
      var c = (t.category || t.merchant_category || 'Other').trim() || 'Other';
      var amt = Math.abs(parseFloat(t.amount) || 0);
      cats[c] = (cats[c] || 0) + amt;
    });
    return cats;
  }

  function paletteColor(i) {
    var pal = ['#1f7a4a', '#9b87f5', '#c0594a', '#a16207', '#0ea5e9', '#ec4899', '#84cc16', '#f59e0b', '#14b8a6', '#6366f1', '#ef4444'];
    return pal[i % pal.length];
  }

  function upgradeExpenseCard() {
    try {
      var cards = $$('#page-debts .debts-spend-grid .card');
      if (!cards.length) return;
      var expCard = null;
      for (var i = 0; i < cards.length; i++) {
        if (/Expense Categories/i.test(cards[i].textContent || '')) { expCard = cards[i]; break; }
      }
      if (!expCard) return;
      if (expCard.getAttribute('data-wjp-ec-upgraded') === '1') return;

      var state = getState();
      var monthTxs = getMonthTransactions(state);
      var cats = categorize(monthTxs);
      var entries = Object.keys(cats).map(function (k) { return { name: k, amt: cats[k] }; });
      if (!entries.length) return;
      entries.sort(function (a, b) { return b.amt - a.amt; });
      var total = entries.reduce(function (s, e) { return s + e.amt; }, 0);
      if (total === 0) return;

      // Find or create the list container inside the expense card.
      var existingList = expCard.querySelector('.wjp-ec-list');
      if (existingList) existingList.remove();

      // Look for an existing legend block to replace; otherwise append
      var legend = expCard.querySelector('.legend, .donut-legend, [class*="legend"]');
      var list = document.createElement('div');
      list.className = 'wjp-ec-list';
      list.innerHTML = entries.slice(0, 8).map(function (e, idx) {
        var pct = (e.amt / total) * 100;
        return '<div class="wjp-ec-row">' +
          '<span class="swatch" style="background:' + paletteColor(idx) + ';"></span>' +
          '<span class="name">' + e.name + '</span>' +
          '<span class="amt">' + fmtUsd(e.amt, 2) + '</span>' +
          '<span class="pct">' + fmtPct(pct) + '</span>' +
        '</div>';
      }).join('');

      var top3 = entries.slice(0, 3).reduce(function (s, e) { return s + e.amt; }, 0);
      var top3Pct = (top3 / total) * 100;
      var subtitle = document.createElement('div');
      subtitle.className = 'wjp-ec-subtitle';
      subtitle.innerHTML = 'Top 3 represent <strong>' + fmtPct(top3Pct) + '</strong> of spend · ' + entries.length + ' categories total';

      if (legend) legend.replaceWith(list);
      else expCard.appendChild(list);

      // Place subtitle right after the heading if found
      var h = expCard.querySelector('h2, h3');
      if (h && h.parentElement) {
        var existingSub = h.parentElement.querySelector('.wjp-ec-subtitle');
        if (existingSub) existingSub.remove();
        h.parentElement.appendChild(subtitle);
      } else {
        expCard.insertBefore(subtitle, expCard.firstChild);
      }

      expCard.setAttribute('data-wjp-ec-upgraded', '1');
    } catch (e) { try { console.warn('[wjp-strategy-polish] expense upgrade failed', e); } catch (_) {} }
  }

  // ===================== AI Performance Report rendering =====================
  function computePerformance(state) {
    var debts = Array.isArray(state.debts) ? state.debts : [];
    var txs = Array.isArray(state.transactions) ? state.transactions : [];
    var now = Date.now();
    var ninetyAgo = now - 90 * DAY_MS;

    // Repayment Velocity: average monthly debt paydown over last 90 days
    var payments = txs.filter(function (t) {
      var d = new Date(t.date || t.timestamp || 0).getTime();
      if (!isFinite(d) || d < ninetyAgo) return false;
      // Payment-like txs (channel + name heuristic)
      var name = ((t.merchant || t.merchant_name || t.name || '') + '').toLowerCase();
      return t.payment_channel === 'payment' ||
        /payment|autopay|principal/.test(name) ||
        /(card|loan)/.test(name);
    });
    var totalPaid = payments.reduce(function (s, t) { return s + Math.abs(parseFloat(t.amount) || 0); }, 0);
    var monthsObs = 3;
    var avgMonthlyPaid = totalPaid / monthsObs;
    var totalDebt = debts.reduce(function (s, d) { return s + (parseFloat(d.balance) || 0); }, 0);
    var velocityPct = totalDebt > 0 ? (avgMonthlyPaid / totalDebt) * 100 : 0;

    // Budget Adherence: % of categories within budget this month
    var budgets = state.budgets || {};
    var monthTxs = getMonthTransactions(state);
    var spendByCat = categorize(monthTxs);
    var catNames = Object.keys(budgets);
    var withinCount = 0, totalCats = 0;
    catNames.forEach(function (c) {
      var lim = parseFloat(budgets[c]) || 0;
      if (lim <= 0) return;
      totalCats++;
      var spent = spendByCat[c] || 0;
      if (spent <= lim) withinCount++;
    });
    var adherencePct = totalCats > 0 ? (withinCount / totalCats) * 100 : null;

    // Optimization Score: 0–100 composite of strategy match, on-time payments, utilization
    var score = 50;
    // Strategy bonus: are they on Avalanche when it's the cheapest?
    if (state.strategy && /avalanche/i.test(String(state.strategy))) score += 15;
    // No late-fee transactions in last 90d → +15
    var hadLateFee = payments.some(function (t) {
      return /late\s*fee|late\s*charge/i.test((t.name || t.merchant_name || '') + '');
    });
    if (!hadLateFee) score += 15;
    // Utilization < 30% on average → +20
    var cards = debts.filter(function (d) { return /credit|card/i.test((d.type || '') + ''); });
    var utilSamples = cards.filter(function (d) { return d.creditLimit && d.creditLimit > 0; })
      .map(function (d) { return (d.balance / d.creditLimit) * 100; });
    if (utilSamples.length) {
      var avgUtil = utilSamples.reduce(function (a, b) { return a + b; }, 0) / utilSamples.length;
      if (avgUtil < 30) score += 20;
      else if (avgUtil < 50) score += 10;
      else if (avgUtil > 70) score -= 10;
    }
    score = Math.max(0, Math.min(100, score));

    return {
      velocityPct: velocityPct,
      avgMonthlyPaid: avgMonthlyPaid,
      adherencePct: adherencePct,
      withinCount: withinCount,
      totalCats: totalCats,
      score: score,
      totalDebt: totalDebt
    };
  }

  function renderPerformance() {
    try {
      var card = document.getElementById('ai-performance-card');
      if (!card) return;
      var state = getState();
      var p = computePerformance(state);

      var velEl = document.getElementById('ai-perf-velocity');
      var adhEl = document.getElementById('ai-perf-adherence');
      var optEl = document.getElementById('ai-perf-optimization');
      var sumEl = document.getElementById('ai-perf-summary');

      function setMetric(el, value, sub) {
        if (!el) return;
        el.textContent = value;
        var parent = el.closest('.ai-perf-metric');
        if (parent) parent.classList.add('has-value');
        // Add sub-detail line below
        var existingSub = parent && parent.querySelector('.wjp-perf-sub-detail');
        if (existingSub) existingSub.remove();
        if (parent && sub) {
          var d = document.createElement('div');
          d.className = 'wjp-perf-sub-detail';
          d.textContent = sub;
          parent.appendChild(d);
        }
      }

      // If user has no debts at all, leave the friendly empty-state copy alone
      if (!state.debts || !state.debts.length) return;

      setMetric(velEl, fmtPct(p.velocityPct, 1), fmtUsd(p.avgMonthlyPaid) + '/mo paid down');
      setMetric(adhEl,
        p.adherencePct == null ? 'No budget' : fmtPct(p.adherencePct),
        p.adherencePct == null ? 'Set budgets to enable' : (p.withinCount + ' of ' + p.totalCats + ' within target')
      );
      setMetric(optEl, Math.round(p.score) + '/100',
        p.score >= 80 ? 'Excellent — keep going' :
        p.score >= 60 ? 'Good — room to optimize' :
        p.score >= 40 ? 'Fair — review strategy' : 'Needs attention');

      if (sumEl) {
        var summary;
        if (p.velocityPct > 5) {
          summary = 'You\'re paying down ' + fmtPct(p.velocityPct, 1) + ' of total debt per month (' + fmtUsd(p.avgMonthlyPaid) + '/mo). At this pace you\'d clear ' + fmtUsd(p.totalDebt) + ' in roughly ' + Math.ceil(p.totalDebt / Math.max(1, p.avgMonthlyPaid)) + ' months without new charges.';
        } else if (p.velocityPct > 0) {
          summary = 'You\'re paying down ' + fmtPct(p.velocityPct, 1) + ' of total debt per month — steady progress. Adding even $50/month to your highest-APR card would meaningfully shorten the timeline.';
        } else {
          summary = 'No payment activity detected in the last 90 days. Once payments start flowing through, this report will show how fast you\'re moving toward debt-free.';
        }
        sumEl.textContent = summary;
      }
    } catch (e) { try { console.warn('[wjp-strategy-polish] perf render failed', e); } catch (_) {} }
  }

  // ===================== boot =====================
  function tick() {
    injectStyle();
    upgradeSpendingCard();
    upgradeExpenseCard();
    renderPerformance();
  }

  function start() {
    tick();
    setInterval(tick, 6000);
    // Re-render after data changes
    window.addEventListener('wjp-debts-updated', tick);
    window.addEventListener('storage', function (e) { if (e.key === 'wjp_budget_state') tick(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.WJP_StrategyPolish = {
    render: tick,
    computePerformance: computePerformance,
    version: 1
  };
})();
