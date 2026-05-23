/* wjp-credit-simulator.js v1 — Interactive credit score simulator.
 *
 * Triggered by the strategy banner's "Open Simulator" button. Renders an
 * inline panel below the banner with live sliders and toggles:
 *   - Paydown amount (slider, $0 -> total card debt)
 *   - Open a new card (toggle)
 *   - Close oldest card (toggle)
 *   - Number of hard inquiries this year (slider, 0..6)
 *
 * As the user drags / toggles, the projected score updates in real time
 * using the same util-based lift model as wjp-credit-strategy-banner.
 *
 * Public API:
 *   WJP_CreditSimulator.open()    -> opens the panel + scrolls to it
 *   WJP_CreditSimulator.close()   -> hides the panel
 *   WJP_CreditSimulator.render()  -> idempotent render below the banner
 */
(function () {
  'use strict';
  if (window._wjpCreditSimInstalled) return;
  window._wjpCreditSimInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID  = 'wjp-cs-simulator';
  var STATE_KEY = 'wjp.credit.sim.v1';

  // ── helpers ─────────────────────────────────────────────────────────────
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

  function loadState() {
    try {
      var key = window.WJP_UserScope && WJP_UserScope.scopeKey ? WJP_UserScope.scopeKey(STATE_KEY) : STATE_KEY;
      var raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { open: false, paydown: 0, newCard: false, closeCard: false, inquiries: 0 };
  }
  function saveState(s) {
    try {
      var key = window.WJP_UserScope && WJP_UserScope.scopeKey ? WJP_UserScope.scopeKey(STATE_KEY) : STATE_KEY;
      localStorage.setItem(key, JSON.stringify(s));
    } catch (_) {}
  }

  function bandFor(score) {
    if (score >= 800) return { name: 'Exceptional', color: '#22c55e' };
    if (score >= 740) return { name: 'Very good',   color: '#22c55e' };
    if (score >= 670) return { name: 'Good',        color: '#84cc16' };
    if (score >= 580) return { name: 'Fair',        color: '#fbbf24' };
    return                    { name: 'Poor',        color: '#ef4444' };
  }

  // ── Compute projection ──────────────────────────────────────────────────
  // Reads real debt data + user toggles, projects a new score.
  function project(s) {
    var cs = loadCS();
    var debts = getDebts();
    var cardLimits = cs.cardLimits || {};

    var cards = debts.filter(isCreditCard).map(function (d) {
      var lim = parseFloat(cardLimits[d.id] || d.limit || 0);
      var bal = parseFloat(d.balance || 0);
      return { id: d.id, name: d.name, balance: bal, limit: lim };
    }).filter(function (c) { return c.limit > 0; });

    var totalBal = cards.reduce(function (sum, c) { return sum + c.balance; }, 0);
    var totalLim = cards.reduce(function (sum, c) { return sum + c.limit; }, 0);
    var curOverall = totalLim > 0 ? totalBal / totalLim : 0;

    // Apply paydown to the highest-util card first (greedy)
    var remaining = s.paydown || 0;
    var workCards = cards.slice().sort(function (a, b) {
      var ua = a.limit > 0 ? a.balance / a.limit : 0;
      var ub = b.limit > 0 ? b.balance / b.limit : 0;
      return ub - ua;
    });
    var newBalances = {};
    workCards.forEach(function (c) {
      var pay = Math.min(remaining, c.balance);
      newBalances[c.id] = c.balance - pay;
      remaining -= pay;
    });

    // Simulate new card opened (adds $5,000 limit assumption, no balance)
    var simLim = totalLim;
    var simBal = totalBal - (s.paydown || 0);
    if (s.newCard) simLim += 5000;
    if (s.closeCard && workCards.length > 0) {
      // Close the lowest-util card (preserves least util benefit) — actually
      // realistically users close oldest, but for util math it's the same.
      var oldest = workCards[workCards.length - 1];
      simLim -= oldest.limit;
      // Note: closing card with $0 balance still hurts score (avg age + util impact)
    }

    var newOverall = simLim > 0 ? simBal / simLim : 0;
    var deltaUtil = newOverall - curOverall;

    // Score impact model
    var lift = 0;
    if (deltaUtil < -0.40) lift += 28;
    else if (deltaUtil < -0.20) lift += 20;
    else if (deltaUtil < -0.10) lift += 12;
    else if (deltaUtil < -0.02) lift += 6;
    else if (deltaUtil > 0.20) lift -= 18;
    else if (deltaUtil > 0.10) lift -= 10;

    // Crossing 30% threshold bonus
    if (curOverall >= 0.30 && newOverall < 0.30) lift += 8;
    if (newOverall < 0.10 && curOverall >= 0.10) lift += 6;

    // New credit penalty (-5 to -10 short-term)
    if (s.newCard) lift -= 7;

    // Closing card penalty (avg age + util ceiling drop)
    if (s.closeCard) lift -= 12;

    // Inquiries: each 2-5 pts, slope by count
    if (s.inquiries > 0) lift -= Math.min(20, s.inquiries * 4);

    var current = currentScore();
    var projected = Math.max(300, Math.min(850, current + lift));

    return {
      current: current,
      projected: projected,
      delta: lift,
      currentUtil: curOverall,
      projectedUtil: newOverall,
      totalBalance: totalBal,
      totalLimit: totalLim,
      cards: cards
    };
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function panelHTML(s, p) {
    var cards = p.cards;
    var maxPaydown = Math.max(0, Math.ceil(p.totalBalance));
    var pctUtilBefore = Math.round(p.currentUtil * 100);
    var pctUtilAfter  = Math.round(p.projectedUtil * 100);
    var band = bandFor(p.projected);
    var deltaSign = p.delta >= 0 ? '+' : '';
    var deltaColor = p.delta > 0 ? '#22c55e' : p.delta < 0 ? '#ef4444' : '#94a3b8';

    if (cards.length === 0) {
      return ''
        + '<div style="padding:24px 28px;background:var(--card, #fff);border:1px dashed var(--border, rgba(0,0,0,0.10));border-radius:14px;text-align:center;">'
        +   '<i class="ph-fill ph-info" style="font-size:24px;color:#6366f1;margin-bottom:8px;"></i>'
        +   '<div style="font-size:14px;font-weight:700;color:var(--text-1,#0a0a0a);">Add your credit card limits to use the simulator.</div>'
        +   '<div style="font-size:11.5px;color:var(--text-3,#94a3b8);margin-top:4px;">Manage card limits in the Debts tab.</div>'
        + '</div>';
    }

    return ''
      + '<div style="'
      +   'background:var(--card, #fff);border:1px solid var(--border, rgba(0,0,0,0.06));'
      +   'border-radius:16px;padding:22px 26px;box-shadow:0 4px 20px rgba(0,0,0,0.06);'
      + '">'
      +   // Header
      +   '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px;">'
      +     '<div style="display:flex;align-items:center;gap:12px;">'
      +       '<div style="width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#6366f1,#a855f7);display:grid;place-items:center;box-shadow:0 4px 14px rgba(99,102,241,0.30);"><i class="ph-fill ph-slider-horizontal" style="font-size:21px;color:#fff;"></i></div>'
      +       '<div>'
      +         '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:#6366f1;text-transform:uppercase;">Score Simulator</div>'
      +         '<div style="font-size:17px;font-weight:900;color:var(--text-1,#0a0a0a);margin-top:2px;letter-spacing:-0.005em;">What if I…</div>'
      +       '</div>'
      +     '</div>'
      +     // Projected score readout (large, animated by inline style change)
      +     '<div style="text-align:right;">'
      +       '<div style="font-size:9.5px;letter-spacing:0.10em;font-weight:800;text-transform:uppercase;color:var(--text-3,#94a3b8);">Projected score</div>'
      +       '<div style="display:flex;align-items:baseline;gap:8px;justify-content:flex-end;margin-top:3px;">'
      +         '<span id="wjp-sim-projected-score" style="font-size:36px;font-weight:900;color:' + band.color + ';letter-spacing:-0.02em;line-height:1;">' + p.projected + '</span>'
      +         '<span id="wjp-sim-projected-delta" style="font-size:13px;font-weight:800;color:' + deltaColor + ';">' + deltaSign + p.delta + '</span>'
      +       '</div>'
      +       '<div id="wjp-sim-projected-band" style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:' + band.color + ';margin-top:4px;">' + band.name + '</div>'
      +     '</div>'
      +   '</div>'
      +   // Controls grid
      +   '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">'
      +     // Paydown slider
      +     '<div style="padding:16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:11px;">'
      +       '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      +         '<div style="display:flex;align-items:center;gap:8px;"><i class="ph-fill ph-currency-dollar" style="font-size:15px;color:#10b981;"></i><span style="font-size:11px;font-weight:800;color:var(--text-2,#475569);letter-spacing:0.04em;text-transform:uppercase;">Pay down balance</span></div>'
      +         '<span id="wjp-sim-paydown-label" style="font-size:14px;font-weight:900;color:#10b981;">' + fmtUSD(s.paydown || 0) + '</span>'
      +       '</div>'
      +       '<input id="wjp-sim-paydown" type="range" min="0" max="' + maxPaydown + '" step="25" value="' + (s.paydown || 0) + '" style="width:100%;accent-color:#10b981;">'
      +       '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3,#94a3b8);font-weight:700;margin-top:4px;">'
      +         '<span>$0</span><span>' + fmtUSD(maxPaydown) + '</span>'
      +       '</div>'
      +     '</div>'
      +     // Utilization preview
      +     '<div style="padding:16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:11px;">'
      +       '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><i class="ph-fill ph-chart-line-down" style="font-size:15px;color:#6366f1;"></i><span style="font-size:11px;font-weight:800;color:var(--text-2,#475569);letter-spacing:0.04em;text-transform:uppercase;">Utilization</span></div>'
      +       '<div style="font-size:18px;font-weight:900;color:var(--text-1,#0a0a0a);letter-spacing:-0.01em;line-height:1;">'
      +         '<span style="opacity:0.6;">' + pctUtilBefore + '%</span>'
      +         ' <span style="font-size:13px;color:var(--text-3,#94a3b8);">→</span> '
      +         '<span id="wjp-sim-util-after" style="color:' + (pctUtilAfter < 30 ? '#22c55e' : pctUtilAfter < 60 ? '#fbbf24' : '#ef4444') + ';">' + pctUtilAfter + '%</span>'
      +       '</div>'
      +       '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);margin-top:6px;font-weight:600;">Lower is better. Under 10% = sweet spot.</div>'
      +     '</div>'
      +     // Toggle: new card
      +     '<label style="cursor:pointer;padding:16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:11px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
      +       '<div>'
      +         '<div style="display:flex;align-items:center;gap:8px;"><i class="ph-fill ph-plus-circle" style="font-size:15px;color:#f59e0b;"></i><span style="font-size:11px;font-weight:800;color:var(--text-2,#475569);letter-spacing:0.04em;text-transform:uppercase;">Open a new card</span></div>'
      +         '<div style="font-size:11px;color:var(--text-3,#94a3b8);margin-top:4px;font-weight:600;">Adds $5,000 limit. Costs ~7 pts short-term.</div>'
      +       '</div>'
      +       '<input id="wjp-sim-newcard" type="checkbox" ' + (s.newCard ? 'checked' : '') + ' style="width:38px;height:22px;accent-color:#f59e0b;cursor:pointer;">'
      +     '</label>'
      +     // Toggle: close card
      +     '<label style="cursor:pointer;padding:16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:11px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
      +       '<div>'
      +         '<div style="display:flex;align-items:center;gap:8px;"><i class="ph-fill ph-x-circle" style="font-size:15px;color:#ef4444;"></i><span style="font-size:11px;font-weight:800;color:var(--text-2,#475569);letter-spacing:0.04em;text-transform:uppercase;">Close oldest card</span></div>'
      +         '<div style="font-size:11px;color:var(--text-3,#94a3b8);margin-top:4px;font-weight:600;">Cuts available credit + age. Costs ~12 pts.</div>'
      +       '</div>'
      +       '<input id="wjp-sim-closecard" type="checkbox" ' + (s.closeCard ? 'checked' : '') + ' style="width:38px;height:22px;accent-color:#ef4444;cursor:pointer;">'
      +     '</label>'
      +     // Inquiries slider
      +     '<div style="padding:16px;background:var(--card-2,rgba(0,0,0,0.02));border-radius:11px;grid-column:1/-1;">'
      +       '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      +         '<div style="display:flex;align-items:center;gap:8px;"><i class="ph-fill ph-magnifying-glass" style="font-size:15px;color:#a855f7;"></i><span style="font-size:11px;font-weight:800;color:var(--text-2,#475569);letter-spacing:0.04em;text-transform:uppercase;">Hard inquiries (next 12 mo)</span></div>'
      +         '<span id="wjp-sim-inq-label" style="font-size:14px;font-weight:900;color:#a855f7;">' + (s.inquiries || 0) + '</span>'
      +       '</div>'
      +       '<input id="wjp-sim-inquiries" type="range" min="0" max="6" step="1" value="' + (s.inquiries || 0) + '" style="width:100%;accent-color:#a855f7;">'
      +       '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3,#94a3b8);font-weight:700;margin-top:4px;">'
      +         '<span>0</span><span>2</span><span>4</span><span>6+</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   // Footer actions
      +   '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid var(--border,rgba(0,0,0,0.06));">'
      +     '<div style="font-size:11.5px;color:var(--text-3,#94a3b8);font-weight:600;">'
      +       '<i class="ph ph-info" style="font-size:13px;margin-right:4px;"></i>'
      +       'Estimates based on your real card balances. Actual lift depends on reporting timing.'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;">'
      +       '<button type="button" data-cs-sim-action="reset" style="background:transparent;color:var(--text-3,#94a3b8);border:1px solid var(--border,rgba(0,0,0,0.10));padding:8px 14px;border-radius:9px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;">Reset</button>'
      +       '<button type="button" data-cs-sim-action="close" style="background:#6366f1;color:#fff;border:0;padding:8px 16px;border-radius:9px;font-size:11.5px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.02em;display:inline-flex;align-items:center;gap:6px;"><i class="ph ph-x" style="font-size:12px;"></i>Close</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // ── Live update (no re-render) ──────────────────────────────────────────
  function updateProjection() {
    var s = currentInputs();
    var p = project(s);
    var band = bandFor(p.projected);
    var deltaSign = p.delta >= 0 ? '+' : '';
    var deltaColor = p.delta > 0 ? '#22c55e' : p.delta < 0 ? '#ef4444' : '#94a3b8';

    var sEl = document.getElementById('wjp-sim-projected-score');
    var dEl = document.getElementById('wjp-sim-projected-delta');
    var bEl = document.getElementById('wjp-sim-projected-band');
    var pEl = document.getElementById('wjp-sim-paydown-label');
    var iEl = document.getElementById('wjp-sim-inq-label');
    var uEl = document.getElementById('wjp-sim-util-after');

    if (sEl) { sEl.textContent = p.projected; sEl.style.color = band.color; }
    if (dEl) { dEl.textContent = deltaSign + p.delta; dEl.style.color = deltaColor; }
    if (bEl) { bEl.textContent = band.name; bEl.style.color = band.color; }
    if (pEl) pEl.textContent = fmtUSD(s.paydown);
    if (iEl) iEl.textContent = s.inquiries;
    if (uEl) {
      var pctAfter = Math.round(p.projectedUtil * 100);
      uEl.textContent = pctAfter + '%';
      uEl.style.color = pctAfter < 30 ? '#22c55e' : pctAfter < 60 ? '#fbbf24' : '#ef4444';
    }

    saveState(Object.assign({ open: true }, s));
  }

  function currentInputs() {
    var paydown = parseInt((document.getElementById('wjp-sim-paydown') || {}).value || 0, 10);
    var inquiries = parseInt((document.getElementById('wjp-sim-inquiries') || {}).value || 0, 10);
    var newCard = !!(document.getElementById('wjp-sim-newcard') || {}).checked;
    var closeCard = !!(document.getElementById('wjp-sim-closecard') || {}).checked;
    return { paydown: paydown, newCard: newCard, closeCard: closeCard, inquiries: inquiries };
  }

  // ── Mount + wire ────────────────────────────────────────────────────────
  function render() {
    try {
      var page = document.getElementById('page-credit-wjp');
      if (!page || page.offsetHeight === 0) return;

      var state = loadState();
      var wrap = document.getElementById(WRAP_ID);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = WRAP_ID;
        wrap.style.cssText = 'margin-bottom:24px;overflow:hidden;max-height:0;opacity:0;transition:max-height 0.4s ease, opacity 0.3s ease;';
        // Insert directly after strategy banner
        var sb = document.getElementById('wjp-cs-strategy-banner');
        if (sb && sb.nextSibling) page.insertBefore(wrap, sb.nextSibling);
        else if (sb) page.appendChild(wrap);
        else page.appendChild(wrap);
      }
      var p = project(state);
      wrap.innerHTML = panelHTML(state, p);

      if (state.open) {
        wrap.style.maxHeight = '1400px';
        wrap.style.opacity = '1';
      } else {
        wrap.style.maxHeight = '0';
        wrap.style.opacity = '0';
      }

      wireEvents();
    } catch (_) {}
  }

  function wireEvents() {
    ['wjp-sim-paydown', 'wjp-sim-inquiries'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.__wjpWired) return;
      el.__wjpWired = true;
      el.addEventListener('input', updateProjection);
    });
    ['wjp-sim-newcard', 'wjp-sim-closecard'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.__wjpWired) return;
      el.__wjpWired = true;
      el.addEventListener('change', updateProjection);
    });
    document.querySelectorAll('[data-cs-sim-action="reset"]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () {
        var fresh = { open: true, paydown: 0, newCard: false, closeCard: false, inquiries: 0 };
        saveState(fresh);
        render();
      });
    });
    document.querySelectorAll('[data-cs-sim-action="close"]').forEach(function (btn) {
      if (btn.__wjpWired) return;
      btn.__wjpWired = true;
      btn.addEventListener('click', function () { close(); });
    });

    // Open simulator button in strategy banner
    document.querySelectorAll('[data-cs-action="open-simulator"]').forEach(function (btn) {
      if (btn.__wjpSimWired) return;
      btn.__wjpSimWired = true;
      btn.addEventListener('click', function () { open(); });
    });
  }

  function open() {
    var s = loadState();
    // Pre-fill with the recommended paydown from the strategy banner
    if (!s.paydown && window.WJP_CreditStrategy && WJP_CreditStrategy.compute) {
      try {
        var rec = WJP_CreditStrategy.compute();
        if (rec && rec.kind === 'paydown') s.paydown = rec.paydown;
      } catch (_) {}
    }
    s.open = true;
    saveState(s);
    render();
    setTimeout(function () {
      var wrap = document.getElementById(WRAP_ID);
      if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function close() {
    var s = loadState();
    s.open = false;
    saveState(s);
    render();
  }

  function init() {
    render();
    if (window.addEventListener) {
      window.addEventListener('hashchange', function () { setTimeout(render, 80); });
      window.addEventListener('wjp:page-change', function () { setTimeout(render, 80); });
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

  window.WJP_CreditSimulator = { open: open, close: close, render: render, project: project };
})();
