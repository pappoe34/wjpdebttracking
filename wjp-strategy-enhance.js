/* wjp-strategy-enhance.js v1 — upgrade the Strategy view (Debts tab) with
 * better strategy comparison, what-if extra-payment slider, and AI Coach.
 *
 * Adds a card at the top of the Strategy view:
 *   1. STRATEGY COMPARISON — Avalanche vs Snowball vs Hybrid side-by-side
 *      with months-to-freedom + total interest paid for each, computed from
 *      the user's real debts.
 *   2. EXTRA-PAYMENT SLIDER — drag $0 → $1000/mo, see all three projections
 *      update live. Commit button writes to appState.budget.contribution.
 *   3. AI COACH — "Which strategy fits me?", "Walk me through the math",
 *      "What if I get a raise?", "Refinance which debt first?".
 */
(function () {
  'use strict';
  if (window._wjpStratEnhInstalled) return;
  window._wjpStratEnhInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-strategy-enhance-wrap';

  function getAppState() { try { return (typeof appState !== 'undefined') ? appState : null; } catch (_) { return null; } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0); }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  // ── Simple debt payoff simulator ───────────────────────────────────────
  function simulatePayoff(debts, extraPerMonth, strategy) {
    if (!debts.length) return { months: 0, totalInterest: 0, payoffDate: null };
    var working = debts.map(function (d) {
      return { name: d.name, balance: parseFloat(d.balance) || 0, apr: parseFloat(d.apr) || 0, minPay: parseFloat(d.minPayment) || 0 };
    }).filter(function (d) { return d.balance > 0; });
    if (!working.length) return { months: 0, totalInterest: 0, payoffDate: null };

    var months = 0, totalInterest = 0;
    var maxMonths = 600;

    function pickTargetIdx() {
      if (strategy === 'avalanche') {
        var idx = 0, hi = -1;
        for (var i = 0; i < working.length; i++) { if (working[i].apr > hi) { hi = working[i].apr; idx = i; } }
        return idx;
      } else if (strategy === 'snowball') {
        var idxS = 0, lo = Infinity;
        for (var j = 0; j < working.length; j++) { if (working[j].balance < lo) { lo = working[j].balance; idxS = j; } }
        return idxS;
      } else {
        // Hybrid: balance × APR
        var idxH = 0, best = -Infinity;
        for (var k = 0; k < working.length; k++) { var score = working[k].apr * Math.log(1 + working[k].balance); if (score > best) { best = score; idxH = k; } }
        return idxH;
      }
    }

    while (working.length && months < maxMonths) {
      months++;
      // Accrue monthly interest
      working.forEach(function (d) {
        var interest = d.balance * (d.apr / 100 / 12);
        d.balance += interest;
        totalInterest += interest;
      });
      // Apply minimums
      var remainingExtra = extraPerMonth;
      working.forEach(function (d) {
        var pay = Math.min(d.minPay, d.balance);
        d.balance -= pay;
      });
      // Apply extra to target debt
      if (remainingExtra > 0 && working.length) {
        var tIdx = pickTargetIdx();
        var t = working[tIdx];
        var extraPay = Math.min(remainingExtra, t.balance);
        t.balance -= extraPay;
      }
      // Remove paid-off
      working = working.filter(function (d) { return d.balance > 0.01; });
    }

    var date = new Date();
    date.setMonth(date.getMonth() + months);
    return { months: months, totalInterest: Math.round(totalInterest), payoffDate: date };
  }

  function askCoach(prompt) {
    try {
      var fab = document.getElementById('ai-chat-fab');
      var panel = document.getElementById('ai-chat-panel');
      if (panel && !panel.classList.contains('active') && fab) fab.click();
      setTimeout(function () {
        var inp = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
        if (inp) { inp.value = prompt; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
          try { window.WJP_ChatCore.send(prompt); return; } catch (_) {}
        }
        var btn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
        if (btn) btn.click();
      }, 350);
    } catch (_) {}
  }

  function findStrategyHost() {
    // The Strategy view lives inside #page-debts but is hidden until user clicks
    // the Strategy sub-tab. Look for the dedicated strategy card.
    var dash = document.getElementById('top3-strategy');
    if (dash) return dash.parentNode; // mount above top3
    return document.getElementById('page-dashboard');
  }

  function render() {
    try {
      var host = findStrategyHost();
      if (!host) return;
      var s = getAppState();
      if (!s || !s.debts) return;
      var debts = s.debts.filter(function (d) { return d && d.balance > 0; });
      if (!debts.length) return;

      var currentExtra = (s.budget && s.budget.contribution) || 0;
      var income = (s.balances && s.balances.monthlyIncome) || (s.budget && s.budget.monthlyIncome) || 5000;
      var maxExtra = Math.min(2000, Math.max(500, Math.round(income * 0.30)));

      var dataHash = JSON.stringify({
        debts: debts.map(function (d) { return d.name + ':' + d.balance + ':' + d.apr + ':' + d.minPayment; }),
        income: income,
        extra: currentExtra
      });
      var existing = document.getElementById(WRAP_ID);
      if (existing && existing._wjpStratHash === dataHash) return;

      // Compute three scenarios at current extra
      var av = simulatePayoff(debts, currentExtra, 'avalanche');
      var sn = simulatePayoff(debts, currentExtra, 'snowball');
      var hy = simulatePayoff(debts, currentExtra, 'hybrid');

      function scenarioCard(label, sim, accent, isWinner) {
        return ''
        + '<div style="background:' + (isWinner ? 'rgba(34,197,94,0.06)' : 'var(--card-2,rgba(255,255,255,0.03))') + ';border:1px solid ' + (isWinner ? '#22c55e' : 'var(--border,rgba(255,255,255,0.10))') + ';border-radius:12px;padding:14px 16px;">'
        + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
        + '    <div style="font-size:11px;font-weight:800;color:' + accent + ';text-transform:uppercase;letter-spacing:0.08em;">' + label + '</div>'
        + (isWinner ? '<div style="font-size:8px;font-weight:900;color:#22c55e;background:rgba(34,197,94,0.15);padding:2px 7px;border-radius:6px;letter-spacing:0.10em;">BEST</div>' : '')
        + '  </div>'
        + '  <div style="font-size:22px;font-weight:900;color:var(--ink,#0a0a0a);line-height:1;margin-top:4px;">' + sim.months + ' <span style="font-size:11px;font-weight:600;color:var(--ink-dim,#94a3b8);">mo</span></div>'
        + '  <div style="font-size:10px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-top:2px;">' + (sim.payoffDate ? sim.payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—') + '</div>'
        + '  <div style="font-size:11px;color:var(--danger,#ef4444);font-weight:700;margin-top:6px;">' + fmtUSD(sim.totalInterest) + ' interest</div>'
        + '</div>';
      }

      var sims = [
        { key: 'avalanche', label: 'Avalanche', accent: '#ef4444', sim: av },
        { key: 'snowball',  label: 'Snowball',  accent: '#667eea', sim: sn },
        { key: 'hybrid',    label: 'Hybrid',    accent: '#a78bfa', sim: hy }
      ];
      var minInterest = Math.min(av.totalInterest, sn.totalInterest, hy.totalInterest);

      var html =
        '<div id="' + WRAP_ID + '" style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:18px;padding:20px 22px;margin-bottom:18px;font-family:var(--sans,Inter,system-ui,sans-serif);">'
      + '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'
      + '    <div>'
      + '      <div style="font-size:10px;color:var(--accent,#22c55e);font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">STRATEGY ENGINE</div>'
      + '      <div style="font-size:16px;font-weight:800;color:var(--ink,#0a0a0a);">Compare every path · live with your numbers</div>'
      + '    </div>'
      + '  </div>'
      + '  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">'
      +      sims.map(function (sc) { return scenarioCard(sc.label, sc.sim, sc.accent, sc.sim.totalInterest === minInterest); }).join('')
      + '  </div>'
      // Slider
      + '  <div style="margin-top:18px;padding:14px 16px;background:var(--card-2,rgba(255,255,255,0.03));border-radius:12px;">'
      + '    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-dim,#94a3b8);margin-bottom:4px;">'
      + '      <span>Extra payment per month</span>'
      + '      <span id="wjp-strat-extra-val" style="color:var(--ink,#0a0a0a);font-weight:800;">' + fmtUSD(currentExtra) + '</span>'
      + '    </div>'
      + '    <input id="wjp-strat-extra" type="range" min="0" max="' + maxExtra + '" step="25" value="' + currentExtra + '" style="width:100%;accent-color:#22c55e;">'
      + '    <div id="wjp-strat-preview" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:11px;"></div>'
      + '    <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">'
      + '      <button id="wjp-strat-commit" type="button" style="background:var(--accent,#22c55e);color:#fff;border:0;padding:7px 16px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.05em;">COMMIT THIS</button>'
      + '    </div>'
      + '  </div>'
      // AI Coach strip
      + '  <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
      + '    <div style="font-size:10px;color:#a78bfa;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;">AI COACH ·</div>'
      + '    <button class="wjp-strat-coach" data-q="which" style="background:rgba(167,139,250,0.10);color:#a78bfa;border:1px solid #a78bfa;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Which strategy fits me?</button>'
      + '    <button class="wjp-strat-coach" data-q="math" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Walk me through the math</button>'
      + '    <button class="wjp-strat-coach" data-q="raise" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">What if I get a raise?</button>'
      + '    <button class="wjp-strat-coach" data-q="refi" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.15));padding:5px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">Refinance which debt first?</button>'
      + '  </div>'
      + '</div>';

      if (existing) existing.outerHTML = html;
      else {
        var d = document.createElement('div');
        d.innerHTML = html;
        if (host.firstChild) host.insertBefore(d.firstChild, host.firstChild);
        else host.appendChild(d.firstChild);
      }
      document.getElementById(WRAP_ID)._wjpStratHash = dataHash;

      var extraEl = document.getElementById('wjp-strat-extra');
      var extraValEl = document.getElementById('wjp-strat-extra-val');
      var previewEl = document.getElementById('wjp-strat-preview');
      function updatePreview() {
        var v = parseFloat(extraEl.value) || 0;
        extraValEl.textContent = fmtUSD(v);
        var pAv = simulatePayoff(debts, v, 'avalanche');
        var pSn = simulatePayoff(debts, v, 'snowball');
        var pHy = simulatePayoff(debts, v, 'hybrid');
        var savedAv = av.totalInterest - pAv.totalInterest;
        previewEl.innerHTML =
          '<div style="background:var(--card,rgba(255,255,255,0.04));border-radius:8px;padding:8px 10px;"><div style="color:#ef4444;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Avalanche</div><div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">' + pAv.months + ' mo</div><div style="font-size:10px;color:#22c55e;font-weight:700;">' + (savedAv >= 0 ? '−' + fmtUSD(Math.abs(savedAv)) : '+' + fmtUSD(Math.abs(savedAv))) + ' interest vs current</div></div>'
        + '<div style="background:var(--card,rgba(255,255,255,0.04));border-radius:8px;padding:8px 10px;"><div style="color:#667eea;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Snowball</div><div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">' + pSn.months + ' mo</div><div style="font-size:10px;color:var(--ink-dim,#94a3b8);">' + fmtUSD(pSn.totalInterest) + ' interest</div></div>'
        + '<div style="background:var(--card,rgba(255,255,255,0.04));border-radius:8px;padding:8px 10px;"><div style="color:#a78bfa;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Hybrid</div><div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">' + pHy.months + ' mo</div><div style="font-size:10px;color:var(--ink-dim,#94a3b8);">' + fmtUSD(pHy.totalInterest) + ' interest</div></div>';
      }
      extraEl.addEventListener('input', updatePreview);
      updatePreview();

      document.getElementById('wjp-strat-commit').addEventListener('click', function () {
        try {
          var v = parseFloat(extraEl.value) || 0;
          if (s.budget) s.budget.contribution = v;
          if (typeof window.saveState === 'function') window.saveState();
          if (typeof window.showToast === 'function') window.showToast('Committed: $' + Math.round(v) + '/mo extra. All projections updated.');
          // Force a wider re-render
          if (typeof window.updateUI === 'function') window.updateUI();
        } catch (_) {}
      });

      document.querySelectorAll('.wjp-strat-coach').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var q = btn.getAttribute('data-q');
          var debtsCtx = debts.map(function (d) { return '  • ' + d.name + ': ' + fmtUSD(d.balance) + ' @ ' + d.apr + '% APR, min ' + fmtUSD(d.minPayment) + '/mo'; }).join('\n');
          var ctx = 'My debts:\n' + debtsCtx + '\n\nCurrent extra payment: ' + fmtUSD(currentExtra) + '/mo. Current strategy: ' + ((s.settings && s.settings.strategy) || 'avalanche') + '. Avalanche payoff: ' + av.months + ' mo, ' + fmtUSD(av.totalInterest) + ' interest. Snowball: ' + sn.months + ' mo, ' + fmtUSD(sn.totalInterest) + '. Hybrid: ' + hy.months + ' mo, ' + fmtUSD(hy.totalInterest) + '.\n\n';
          var prompts = {
            which: 'Tell me which strategy is mathematically best AND psychologically right for me. Explain in plain English, no jargon.',
            math:  'Walk me through how the strategy math works using my real numbers. Show interest math step by step for the first 3 months.',
            raise: 'If I get a $500/mo raise, where should it go? Compare allocating it 100% to debt vs 50/50 with savings.',
            refi:  'Which of my debts has the highest refinance ROI right now? Be specific — name the debt, the target rate, and the math.'
          };
          askCoach(ctx + (prompts[q] || prompts.which));
        });
      });
    } catch (e) { try { console.warn('[wjp-strategy-enhance] threw', e); } catch (_) {} }
  }

  function whenReady(fn) {
    if (getAppState()) return fn();
    var tries = 0;
    var iv = setInterval(function () { if (getAppState()) { clearInterval(iv); fn(); } else if (++tries > 60) clearInterval(iv); }, 400);
  }

  function boot() {
    whenReady(function () { render(); setInterval(render, 8000); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_StrategyEnhance = { render: render, simulate: simulatePayoff };
})();
