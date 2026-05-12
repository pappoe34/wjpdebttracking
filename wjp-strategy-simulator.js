/* wjp-strategy-simulator.js v1 — interactive payoff simulator for Strategy tab
 *
 * Adds a 5-star "What If" widget to the Debts page that lets the user drag a
 * slider for extra monthly payment and see all 3 strategies recompute in real
 * time (debt-free date, total interest, months saved vs minimums-only).
 *
 * Reads from appState; uses host calculateDebtPayoff for the math so results
 * match the rest of the app. Generic — no hardcoded names.
 */
(function () {
  'use strict';
  if (window._wjpStrategySimInstalled) return;
  window._wjpStrategySimInstalled = true;

  var CARD_ID = 'wjp-strategy-simulator-card';

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }
  function isDark() { try { return document.body.classList.contains('dark'); } catch (_) { return false; } }

  function fmtUSD(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function monthsToDate(months) {
    var d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function aggregate(results) {
    var totalMonths = 0;
    var totalInterest = 0;
    Object.values(results).forEach(function (r) {
      if (r.months > totalMonths) totalMonths = r.months;
      totalInterest += (r.totalInterest || 0);
    });
    return { months: totalMonths, interest: totalInterest };
  }

  function runStrategy(strategy, extra) {
    try {
      if (typeof window.calculateDebtPayoff !== 'function') return null;
      var results = window.calculateDebtPayoff(strategy, extra);
      if (!results || !Object.keys(results).length) return null;
      return aggregate(results);
    } catch (e) {
      try { console.warn('[wjp-strategy-sim] calc threw', e); } catch (_) {}
      return null;
    }
  }

  // Module-level state — preserve slider value across renders
  var EXTRA = null;

  function effectiveExtra() {
    if (EXTRA !== null) return EXTRA;
    try {
      if (typeof window.getEffectiveExtraContribution === 'function') {
        var v = window.getEffectiveExtraContribution();
        if (v && isFinite(v.extra)) return v.extra;
      }
    } catch (_) {}
    return 0;
  }

  function buildCardHTML() {
    var s = getState();
    if (!s || !s.debts || !s.debts.length) {
      return ''
        + '<div style="text-align:center;padding:30px 16px;color:var(--text-3,#94a3b8);font-size:12px;line-height:1.5;">'
        + '<i class="ph ph-chart-line-up" style="font-size:28px;opacity:0.4;display:block;margin-bottom:10px;"></i>'
        + 'Add some debts and we\'ll model your payoff timeline.'
        + '</div>';
    }
    var extra = effectiveExtra();
    var baseline = runStrategy('avalanche', 0);  // minimums only
    var snow = runStrategy('snowball', extra);
    var hyb  = runStrategy('hybrid', extra);
    var aval = runStrategy('avalanche', extra);

    var strategies = [
      { key: 'snowball',  label: 'Snowball',  desc: 'Smallest balances first', data: snow, color: '#a855f7' },
      { key: 'hybrid',    label: 'Hybrid',    desc: 'Balance × APR weighted',  data: hyb,  color: '#0891b2' },
      { key: 'avalanche', label: 'Avalanche', desc: 'Highest APR first',       data: aval, color: '#10b981' }
    ];

    // Determine best — lowest interest wins
    var validData = strategies.filter(function (x) { return x.data; });
    var bestInterest = validData.length ? Math.min.apply(null, validData.map(function (x) { return x.data.interest; })) : 0;

    var stratCols = strategies.map(function (st) {
      var d = st.data;
      var isBest = d && d.interest === bestInterest && validData.length > 1;
      if (!d) return '<div style="padding:12px;border-radius:8px;background:var(--card-2,rgba(255,255,255,0.04));text-align:center;color:var(--text-3,#94a3b8);font-size:11px;">' + st.label + ' — n/a</div>';
      var savedMo = baseline && baseline.months ? baseline.months - d.months : 0;
      var savedInt = baseline && baseline.interest ? baseline.interest - d.interest : 0;
      return ''
        + '<div style="padding:12px 14px;border-radius:10px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid ' + (isBest ? st.color : 'var(--border,rgba(255,255,255,0.06))') + ';position:relative;">'
        + (isBest ? '<span style="position:absolute;top:-9px;right:8px;background:' + st.color + ';color:#fff;font-size:9px;font-weight:800;letter-spacing:0.08em;padding:2px 7px;border-radius:999px;text-transform:uppercase;">Cheapest</span>' : '')
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:8px;height:8px;border-radius:2px;background:' + st.color + ';"></span><div style="font-size:11.5px;font-weight:800;color:var(--text-1,#0a0a0a);">' + st.label + '</div></div>'
        + '<div style="font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-bottom:10px;letter-spacing:0.02em;">' + st.desc + '</div>'
        + '<div style="font-size:22px;font-weight:900;color:' + st.color + ';line-height:1;">' + monthsToDate(d.months) + '</div>'
        + '<div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:3px;">debt-free</div>'
        + '<div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--border,rgba(255,255,255,0.08));font-size:10px;">'
        +   '<div><div style="color:var(--text-3,#94a3b8);font-weight:600;">Interest</div><div style="color:var(--text-1,#0a0a0a);font-weight:800;font-size:11.5px;">' + fmtUSD(d.interest) + '</div></div>'
        +   '<div style="text-align:right;"><div style="color:var(--text-3,#94a3b8);font-weight:600;">Months</div><div style="color:var(--text-1,#0a0a0a);font-weight:800;font-size:11.5px;">' + d.months + '</div></div>'
        + '</div>'
        + (savedInt > 0 || savedMo > 0
            ? '<div style="margin-top:8px;font-size:10px;font-weight:700;color:#10b981;">' + (savedMo > 0 ? savedMo + ' mo faster · ' : '') + (savedInt > 0 ? fmtUSD(savedInt) + ' saved' : '') + '</div>'
            : '')
        + '</div>';
    }).join('');

    return ''
      // header
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      +   '<div style="width:32px;height:32px;border-radius:9px;background:rgba(16,185,129,0.15);display:grid;place-items:center;"><i class="ph-fill ph-target" style="font-size:16px;color:#10b981;"></i></div>'
      +   '<div><div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);">What If — Strategy Simulator</div><div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;">drag the slider to see how every dollar changes your timeline</div></div>'
      + '</div>'
      + '</div>'
      // slider
      + '<div style="background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:10px;padding:14px 16px;margin-bottom:14px;">'
      +   '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">'
      +     '<div style="font-size:11px;letter-spacing:0.08em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">Extra payment / month</div>'
      +     '<div style="font-size:20px;font-weight:900;color:#10b981;letter-spacing:-0.01em;">' + fmtUSD(extra) + '</div>'
      +   '</div>'
      +   '<input type="range" id="wjp-strat-extra" min="0" max="2000" step="25" value="' + extra + '" style="width:100%;accent-color:#10b981;cursor:pointer;">'
      +   '<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:4px;"><span>$0</span><span>$500</span><span>$1,000</span><span>$1,500</span><span>$2,000</span></div>'
      + '</div>'
      // strategy columns
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">' + stratCols + '</div>';
  }

  function mount() {
    try {
      // Find a host on the Debts page near the Payoff Strategy card
      var page = document.getElementById('page-debts');
      if (!page || page.offsetHeight === 0) return;

      var card = document.getElementById(CARD_ID);
      if (!card) {
        card = document.createElement('div');
        card.id = CARD_ID;
        card.className = 'card reveal';
        card.style.cssText = 'padding:16px 18px;margin-top:14px;';
        // Insert after the Payoff Strategy card
        var payoffCard = Array.from(page.querySelectorAll('.card, [class*="-card"]')).find(function (c) {
          return /payoff strategy/i.test((c.textContent || '').slice(0, 80));
        });
        if (payoffCard && payoffCard.parentNode) {
          payoffCard.parentNode.insertBefore(card, payoffCard.nextSibling);
        } else {
          page.insertBefore(card, page.children[2] || null);
        }
      }
      card.innerHTML = buildCardHTML();

      var slider = card.querySelector('#wjp-strat-extra');
      if (slider) {
        slider.addEventListener('input', function (e) {
          EXTRA = parseFloat(e.target.value) || 0;
          // Re-render only the strategy cols + label — avoid losing slider focus
          card.innerHTML = buildCardHTML();
          // Re-bind the slider event and put focus back
          var s2 = card.querySelector('#wjp-strat-extra');
          if (s2) {
            s2.addEventListener('input', arguments.callee);
            s2.focus();
          }
        });
      }
    } catch (e) { try { console.warn('[wjp-strategy-sim] mount threw', e); } catch (_) {} }
  }

  function tick() {
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    var page = document.getElementById('page-debts');
    if (!page || page.offsetHeight === 0) return;
    var card = document.getElementById(CARD_ID);
    if (!card) mount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1500); });
  else setTimeout(tick, 1500);

  setInterval(tick, 4000);

  window.WJP_StrategySim = {
    run: runStrategy,
    refresh: function () { var c = document.getElementById(CARD_ID); if (c) c.innerHTML = buildCardHTML(); }
  };
})();
