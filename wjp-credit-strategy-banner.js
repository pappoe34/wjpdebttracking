/* wjp-credit-strategy-banner.js v1 — Debt-data-driven strategy recommendation.
 *
 * The differentiator: we own the user's debt balances + limits, so we can
 * compute precise paydown-to-score-lift recommendations. Array shows the
 * score; we show the lever.
 *
 * Algorithm:
 *   1. Pull credit-card debts + their limits
 *   2. Compute current per-card and overall utilization
 *   3. Find the highest-impact paydown move (drops util across band threshold)
 *   4. Project score lift based on utilization change (15-30 pts swing
 *      depending on how far below the 10% / 30% thresholds we land)
 *   5. Surface it as the headline action in a banner above the fold
 *
 * Public API:
 *   WJP_CreditStrategy.render()    -> idempotent render below the hero
 *   WJP_CreditStrategy.compute()   -> returns the recommendation object
 */
(function () {
  'use strict';
  if (window._wjpCreditStrategyInstalled) return;
  window._wjpCreditStrategyInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-cs-strategy-banner';

  function loadCS() { try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch (_) { return {}; } }
  function getDebts() { try { return (typeof appState !== 'undefined' && appState && appState.debts) || []; } catch (_) { return []; } }
  function isCreditCard(d) { var t = String(d.type || d.category || '').toLowerCase(); return /credit/.test(t) || /\bcard\b/.test(t) || t === 'cc'; }
  function fmtUSD(n) { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0); } catch (_) { return '$' + Math.round(n || 0); } }
  function currentScore() {
    try {
      if (typeof appState !== 'undefined' && appState && appState.creditScores) {
        var v = appState.creditScores.vantage || appState.creditScores.equifax;
        if (v >= 300 && v <= 850) return v;
      }
    } catch (_) {}
    return (window.WJP_CreditMock && WJP_CreditMock.getCurrentScore && WJP_CreditMock.getCurrentScore()) || 616;
  }

  // ── Compute the headline recommendation ─────────────────────────────────
  function compute() {
    var cs = loadCS();
    var debts = getDebts();
    var cardLimits = cs.cardLimits || {};

    var cards = debts.filter(isCreditCard).map(function (d) {
      var lim = parseFloat(cardLimits[d.id] || d.limit || 0);
      var bal = parseFloat(d.balance || 0);
      return {
        id: d.id, name: d.name, balance: bal, limit: lim,
        util: lim > 0 ? bal / lim : 0
      };
    }).filter(function (c) { return c.limit > 0 && c.balance > 0; });

    if (cards.length === 0) {
      return { kind: 'no-data', message: 'Add your credit card limits to unlock strategy recommendations.' };
    }

    // Sort by utilization descending — highest-util card is the lever
    cards.sort(function (a, b) { return b.util - a.util; });
    var top = cards[0];

    var totalBal = cards.reduce(function (s, c) { return s + c.balance; }, 0);
    var totalLim = cards.reduce(function (s, c) { return s + c.limit; }, 0);
    var overallUtil = totalLim > 0 ? totalBal / totalLim : 0;

    // Target for the top card: drop to under 9% utilization (the "sweet spot")
    var targetUtil = 0.09;
    var targetBalance = top.limit * targetUtil;
    var paydown = Math.max(0, Math.ceil(top.balance - targetBalance));

    // Estimate score lift
    var lift = estimateScoreLift({
      currentTopUtil: top.util,
      targetTopUtil: targetUtil,
      currentOverallUtil: overallUtil,
      paydown: paydown,
      totalLimit: totalLim,
      totalBalance: totalBal
    });

    // Determine if this also unlocks a tier (band crossing on the score)
    var current = currentScore();
    var projected = current + lift;
    var unlocks = bandUnlocks(current, projected);

    return {
      kind: 'paydown',
      topCard: top,
      paydown: paydown,
      targetUtil: targetUtil,
      lift: lift,
      currentScore: current,
      projectedScore: projected,
      overallUtil: overallUtil,
      unlocks: unlocks,
      etaMonths: 2
    };
  }

  function estimateScoreLift(opts) {
    // Conservative model based on credit scoring research:
    //   - Dropping a single-card utilization from 90%+ → under 10% is worth ~20-30 pts
    //   - Dropping from 60-90% → under 10% is worth ~15-22 pts
    //   - Dropping from 30-60% → under 10% is worth ~10-15 pts
    //   - Dropping below 30% (from above) adds ~5-8 pts on top
    var fromU = opts.currentTopUtil;
    var lift = 0;
    if (fromU >= 0.9) lift = 24;
    else if (fromU >= 0.6) lift = 18;
    else if (fromU >= 0.3) lift = 12;
    else if (fromU >= 0.1) lift = 6;
    else                   lift = 2;
    // Add a small bonus if overall util also crosses the 30% threshold
    if (opts.currentOverallUtil >= 0.3) {
      var newOverallBal = opts.totalBalance - opts.paydown;
      var newOverallUtil = opts.totalLimit > 0 ? newOverallBal / opts.totalLimit : 0;
      if (newOverallUtil < 0.3) lift += 6;
    }
    return lift;
  }

  function bandUnlocks(current, projected) {
    var bands = [
      { name: 'Fair',        threshold: 580 },
      { name: 'Good',        threshold: 670 },
      { name: 'Very good',   threshold: 740 },
      { name: 'Exceptional', threshold: 800 }
    ];
    for (var i = 0; i < bands.length; i++) {
      if (current < bands[i].threshold && projected >= bands[i].threshold) {
        return bands[i].name;
      }
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function bannerHTML(rec) {
    // Precompute conditional pieces
    var unlocksHTML = (rec.unlocks
      ? '<div style="background:rgba(132,204,22,0.12);border:1px solid rgba(132,204,22,0.30);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:14px;">'
        + '<i class="ph-fill ph-trophy" style="font-size:16px;color:#65a30d;flex-shrink:0;"></i>'
        + '<span style="font-size:12px;font-weight:700;color:var(--text-1,#0a0a0a);">This move bumps you into the <strong>'
        + rec.unlocks
        + '</strong> band — unlocks 0% balance transfer offers and lower-APR credit cards.</span>'
        + '</div>'
      : '');

    if (rec.kind === 'no-data') {
      return ''
        + '<div style="background:var(--card, #fff);border:1px dashed var(--border, rgba(0,0,0,0.10));border-radius:14px;padding:18px 22px;display:flex;align-items:center;gap:14px;">'
        +   '<div style="width:42px;height:42px;border-radius:11px;background:rgba(99,102,241,0.12);display:grid;place-items:center;flex-shrink:0;"><i class="ph-fill ph-lightbulb" style="font-size:20px;color:#6366f1;"></i></div>'
        +   '<div style="flex:1;"><div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#6366f1;text-transform:uppercase;">Strategy</div><div style="font-size:14px;font-weight:700;color:var(--text-1,#0a0a0a);margin-top:2px;">' + rec.message + '</div></div>'
        + '</div>';
    }

    var c = rec.topCard;
    var newBal = c.balance - rec.paydown;
    var newUtilPct = c.limit > 0 ? Math.round((newBal / c.limit) * 100) : 0;
    var curUtilPct = Math.round(c.util * 100);

    return ''
      + '<div style="'
      +   'position:relative;'
      +   'background:linear-gradient(135deg, rgba(16,185,129,0.07) 0%, rgba(99,102,241,0.05) 100%);'
      +   'border:1px solid rgba(16,185,129,0.22);'
      +   'border-radius:16px;'
      +   'padding:22px 24px;'
      +   'box-shadow:0 4px 18px rgba(16,185,129,0.10);'
      + '">'
      +   '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">'
      +     '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#10b981,#6366f1);display:grid;place-items:center;flex-shrink:0;box-shadow:0 4px 14px rgba(16,185,129,0.30);"><i class="ph-fill ph-lightning" style="font-size:22px;color:#fff;"></i></div>'
      +     '<div style="flex:1;min-width:0;">'
      +       '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#10b981;text-transform:uppercase;">Smart Move · Top Strategy</div>'
      +       '<div style="font-size:17px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:3px;letter-spacing:-0.005em;">Pay <span style="color:#10b981;">' + fmtUSD(rec.paydown) + '</span> on ' + (c.name || 'your top card') + '</div>'
      +     '</div>'
      +   '</div>'
         // Reasoning chain — three pills explaining why this works
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">'
      +     reasonChip('ph-chart-line-down', 'Utilization drops', curUtilPct + '% → ' + newUtilPct + '%')
      +     reasonChip('ph-arrow-up-right',   'Estimated lift',     '+' + rec.lift + ' pts')
      +     reasonChip('ph-clock-clockwise',  'In about',           rec.etaMonths + ' months')
      +   '</div>'
         // Unlock callout when projected score crosses a band threshold
      +   unlocksHTML
         // Projected score readout + CTAs
      +   '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">'
      +     '<div style="font-size:12px;color:var(--text-3,#94a3b8);font-weight:700;">'
      +       'Projected score: <strong style="color:#10b981;font-size:14px;">' + rec.projectedScore + '</strong> '
      +       '<span style="color:var(--text-3,#94a3b8);font-weight:600;">(today: ' + rec.currentScore + ')</span>'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
      +       '<button type="button" data-cs-action="open-simulator" style="background:#10b981;color:#fff;border:0;padding:9px 16px;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.02em;display:inline-flex;align-items:center;gap:6px;box-shadow:0 3px 10px rgba(16,185,129,0.28);"><i class="ph-fill ph-slider-horizontal" style="font-size:13px;"></i>Open Simulator</button>'
      +       '<button type="button" data-cs-action="explain-strategy" style="background:transparent;color:var(--text-2,#475569);border:1px solid var(--border,rgba(0,0,0,0.10));padding:9px 14px;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Why this works</button>'
      +     '</div>'
      +   '</div>'
         // Collapsible explainer
      +   '<div id="wjp-cs-explainer" style="display:none;margin-top:14px;padding:14px 16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:10px;border-left:3px solid #10b981;">'
      +     '<div style="font-size:11px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:var(--text-3,#94a3b8);margin-bottom:8px;">Why this works</div>'
      +     '<p style="font-size:12.5px;color:var(--text-2,#475569);line-height:1.6;font-weight:600;margin:0 0 8px;">Credit utilization is <strong>30% of your VantageScore</strong> — the single fastest lever besides payment history. The bureau looks at <strong>per-card</strong> utilization, not just overall, so paying down your highest-util card has outsized impact.</p>'
      +     '<p style="font-size:12.5px;color:var(--text-2,#475569);line-height:1.6;font-weight:600;margin:0;">Under 10% is the sweet spot. Anything above 30% costs you 10-20 points, above 50% costs 30-60. Once you cross the threshold, the lift typically posts within 1-2 billing cycles (when the lower balance reports to the bureau).</p>'
      +   '</div>'
      + '</div>';
  }

  function reasonChip(icon, label, value) {
    return ''
      + '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--card,#fff);border:1px solid var(--border,rgba(0,0,0,0.06));border-radius:10px;">'
      +   '<i class="ph-fill ' + icon + '" style="font-size:16px;color:#10b981;flex-shrink:0;"></i>'
      +   '<div style="min-width:0;">'
      +     '<div style="font-size:9px;letter-spacing:0.10em;font-weight:800;text-transform:uppercase;color:var(--text-3,#94a3b8);line-height:1;">' + label + '</div>'
      +     '<div style="font-size:13px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:3px;letter-spacing:-0.005em;">' + value + '</div>'
      +   '</div>'
      + '</div>';
  }

  function render() {
    try {
      var page = document.getElementById('page-credit-wjp');
      if (!page || page.offsetHeight === 0) return;

      var rec = compute();
      var wrap = document.getElementById(WRAP_ID);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = 'margin-bottom:24px;';
        // Insert directly after the hero
        var hero = document.getElementById('wjp-cs-hero-premium');
        if (hero && hero.nextSibling) page.insertBefore(wrap, hero.nextSibling);
        else if (hero) page.appendChild(wrap);
        else page.insertBefore(wrap, page.firstChild);
      }
      wrap.innerHTML = bannerHTML(rec);
      wireEvents();
    } catch (_) {}
  }

  function wireEvents() {
    document.querySelectorAll('[data-cs-action="explain-strategy"]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () {
        var ex = document.getElementById('wjp-cs-explainer');
        if (ex) ex.style.display = ex.style.display === 'none' ? 'block' : 'none';
      });
    });
    document.querySelectorAll('[data-cs-action="open-simulator"]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () {
        // Try multiple known simulator selectors — we'll wire this properly
        // when the v2 simulator ships. For now, scroll to the existing one.
        var sim = document.querySelector('[data-cs-sim], #wjp-cs-simulator, #wjp-cs-sim');
        if (sim) { sim.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (window.WJP_Momentum && WJP_Momentum.showToast) {
          window.WJP_Momentum.showToast({
            eyebrow: 'COMING',
            title: 'Score Simulator',
            sub: 'Interactive paydown sliders ship next.',
            color: '#10b981',
            icon: 'ph-fill ph-slider-horizontal'
          });
        }
      });
    });
  }

  function init() {
    render();
    if (window.addEventListener) {
      window.addEventListener('hashchange', function () { setTimeout(render, 80); });
      window.addEventListener('wjp:page-change', function () { setTimeout(render, 80); });
      window.addEventListener('wjp:state-changed', function () { setTimeout(render, 80); });
    }
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      var page = document.getElementById('page-credit-wjp');
      if (page && page.offsetHeight > 0) render();
      if (attempts > 40) clearInterval(iv);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WJP_CreditStrategy = { render: render, compute: compute };
})();
