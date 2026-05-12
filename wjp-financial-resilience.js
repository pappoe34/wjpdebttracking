/* wjp-financial-resilience.js v2 — dashboard card for Financial Resilience
 *
 * Shows at-a-glance health score from the user's own state:
 *   - Liquid cash (linked assets, type: checking/savings — investments excluded)
 *   - Monthly essentials = recurring bills (non-income) projected to monthly
 *   - Runway months = liquid cash / monthly essentials
 *   - DTI = monthly debt minimums / monthly income
 *   - Score 0-100 + status (Strong / Stable / Fragile / Critical)
 *
 * All math reads from appState — no hardcoded names, dates, or amounts.
 */
(function () {
  'use strict';
  if (window._wjpResilienceInstalled) return;
  window._wjpResilienceInstalled = true;
  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  var CARD_ID = 'dash-resilience-card';

  function fmtUSD(n) {
    if (!isFinite(n)) return '$0';
    var v = Math.round(Math.abs(n));
    var sign = n < 0 ? '-' : '';
    return sign + '$' + v.toLocaleString('en-US');
  }

  function isDarkMode() {
    try { return document.body && document.body.classList.contains('dark'); } catch (_) { return false; }
  }

  function monthlyEquivalent(amount, frequency) {
    var a = Math.abs(Number(amount) || 0);
    if (!a) return 0;
    switch ((frequency || 'monthly').toLowerCase()) {
      case 'weekly':    return a * 4.3333;
      case 'biweekly':
      case 'bi-weekly': return a * 2.1667;
      case 'semimonthly':
      case 'semi-monthly': return a * 2;
      case 'quarterly': return a / 3;
      case 'yearly':
      case 'annual':
      case 'annually':  return a / 12;
      default:          return a;
    }
  }

  function computeResilience() {
    var s = getState() || {};
    // Liquid cash from linked assets — checking + savings only (not investments)
    var liquidCash = (s.assets || [])
      .filter(function (a) {
        if (!a) return false;
        var t = (a.type || a.subtype || '').toLowerCase();
        return /checking|savings|cash|money\s*market/.test(t);
      })
      .reduce(function (sum, a) { return sum + (Number(a.balance) || Number(a.amount) || 0); }, 0);

    // Monthly essentials = recurring non-income RPs (housing, utilities, insurance, debt mins)
    var monthlyEssentials = (s.recurringPayments || [])
      .filter(function (r) { return r && r.category !== 'income' && !r.linkedIncome; })
      .reduce(function (sum, r) { return sum + monthlyEquivalent(r.amount, r.frequency); }, 0);

    // Monthly debt minimums — sum of debts' monthly minimums
    var monthlyDebtMin = (s.debts || [])
      .reduce(function (sum, d) {
        var m = Number(d.minPayment || d.minimumPayment || d.minimum || 0);
        return sum + (m > 0 ? m : 0);
      }, 0);

    // Real monthly income from the fixed function we ship in wjp-money-left-fix.js
    var monthlyIncome = (typeof window.computeRealMonthlyIncome === 'function')
      ? window.computeRealMonthlyIncome()
      : 0;

    // Total debt outstanding
    var totalDebt = (s.debts || []).reduce(function (sum, d) {
      return sum + (Number(d.balance) || 0);
    }, 0);

    // Runway in months (cap at 36 so the bar isn't silly)
    var runwayMonths = monthlyEssentials > 0 ? (liquidCash / monthlyEssentials) : 0;
    if (!isFinite(runwayMonths) || runwayMonths < 0) runwayMonths = 0;

    // Debt-to-income ratio (using minimums vs gross monthly income)
    var dti = monthlyIncome > 0 ? (monthlyDebtMin / monthlyIncome) : 0;

    // Score (0-100)
    //   60 pts: runway up to 6 months — 10 pts per month, capped
    //   40 pts: DTI — 40 if DTI <= 0.15, 0 if DTI >= 0.50, linear in between
    var runwayPts = Math.min(60, runwayMonths * 10);
    var dtiPts = (function () {
      if (monthlyIncome <= 0) return 0;
      if (dti <= 0.15) return 40;
      if (dti >= 0.50) return 0;
      return Math.round(40 * (0.50 - dti) / (0.50 - 0.15));
    })();
    var score = Math.round(runwayPts + dtiPts);

    var status, statusColor;
    if (score >= 75) { status = 'Strong';   statusColor = '#10b981'; }
    else if (score >= 55) { status = 'Stable';   statusColor = '#22c55e'; }
    else if (score >= 35) { status = 'Fragile';  statusColor = '#f59e0b'; }
    else                  { status = 'Critical'; statusColor = '#ef4444'; }

    return {
      liquidCash: liquidCash,
      monthlyEssentials: monthlyEssentials,
      monthlyDebtMin: monthlyDebtMin,
      monthlyIncome: monthlyIncome,
      totalDebt: totalDebt,
      runwayMonths: runwayMonths,
      dti: dti,
      score: score,
      status: status,
      statusColor: statusColor
    };
  }

  function emptyStateHTML() {
    return ''
      + '<div style="font-size:12px;color:var(--text-3,#94a3b8);line-height:1.55;text-align:center;padding:14px 8px;">'
      + 'Connect a checking or savings account so we can score your runway. <br/>'
      + 'You can also add an account balance manually under Settings → Linked Assets.'
      + '</div>';
  }

  function tipFor(d) {
    if (d.monthlyIncome <= 0) return 'Add your income (Plaid or recurring) so the score reflects real cash flow.';
    if (d.liquidCash <= 0) return 'Even $500 in a savings buffer would raise your score significantly.';
    if (d.runwayMonths < 1) return 'Build to 1 month of essentials covered — the single biggest score lift.';
    if (d.runwayMonths < 3) return 'Push runway to 3 months — that crosses you from Fragile to Stable.';
    if (d.dti >= 0.40) return 'Debt minimums are over 40% of income. Avalanche payoff will pull the score up fast.';
    if (d.dti >= 0.25) return 'DTI is moderate. Knocking out one card frees up monthly cash to grow runway.';
    if (d.runwayMonths < 6) return 'Get to 6 months runway — the textbook emergency-fund target.';
    return 'You\'re in good shape. Keep stacking — the runway compounds over time.';
  }

  function buildCardHTML() {
    var d = computeResilience();
    var dark = isDarkMode();
    var emptyState = (d.liquidCash <= 0 && d.monthlyEssentials <= 0);

    // Score arc fill (0-100 → 0deg-360deg)
    var arcDeg = (d.score / 100) * 360;
    var ringBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    var ringTrack = 'conic-gradient(' + d.statusColor + ' 0deg ' + arcDeg + 'deg, ' + ringBg + ' ' + arcDeg + 'deg 360deg)';

    var statRow = function (label, value, sub) {
      return ''
        + '<div style="display:flex;flex-direction:column;gap:2px;">'
        + '<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;color:var(--text-3,#94a3b8);">' + label + '</div>'
        + '<div style="font-size:14.5px;font-weight:800;color:var(--text-1,#0a0a0a);letter-spacing:-0.01em;">' + value + '</div>'
        + (sub ? '<div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;">' + sub + '</div>' : '')
        + '</div>';
    };

    if (emptyState) {
      return ''
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
        + '<div style="display:flex;align-items:center;gap:10px;">'
        + '<div style="width:30px;height:30px;border-radius:8px;background:rgba(99,102,241,0.15);display:grid;place-items:center;"><i class="ph-fill ph-shield-check" style="font-size:16px;color:#818cf8;"></i></div>'
        + '<div><div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);">Financial Resilience</div><div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;">your safety-net score</div></div>'
        + '</div>'
        + '</div>'
        + emptyStateHTML();
    }

    var runwayCopy = d.runwayMonths >= 12 ? '12+ months' : (d.runwayMonths.toFixed(1) + ' mo');
    var dtiCopy = d.monthlyIncome > 0 ? (Math.round(d.dti * 100) + '%') : '—';

    return ''
      // header
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      + '<div style="width:30px;height:30px;border-radius:8px;background:rgba(99,102,241,0.15);display:grid;place-items:center;"><i class="ph-fill ph-shield-check" style="font-size:16px;color:#818cf8;"></i></div>'
      + '<div><div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);">Financial Resilience</div><div style="font-size:10.5px;color:var(--text-3,#94a3b8);font-weight:600;">how long you can weather a setback</div></div>'
      + '</div>'
      + '<span style="font-size:10px;letter-spacing:0.08em;font-weight:800;padding:4px 10px;border-radius:999px;background:' + d.statusColor + '22;color:' + d.statusColor + ';border:1px solid ' + d.statusColor + ';text-transform:uppercase;">' + d.status + '</span>'
      + '</div>'

      // body: score ring + stats
      + '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;">'
      + '<div style="position:relative;width:108px;height:108px;border-radius:50%;background:' + ringTrack + ';display:grid;place-items:center;flex-shrink:0;">'
      + '<div style="width:88px;height:88px;border-radius:50%;background:var(--card,#fff);display:grid;place-items:center;">'
      + '<div style="text-align:center;">'
      + '<div style="font-size:26px;font-weight:900;color:' + d.statusColor + ';line-height:1;">' + d.score + '</div>'
      + '<div style="font-size:9px;letter-spacing:0.10em;color:var(--text-3,#94a3b8);font-weight:700;margin-top:3px;">SCORE</div>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;flex:1;min-width:200px;">'
      + statRow('Runway', runwayCopy, fmtUSD(d.liquidCash) + ' liquid ÷ ' + fmtUSD(d.monthlyEssentials) + '/mo essentials')
      + statRow('Debt-to-Income', dtiCopy, fmtUSD(d.monthlyDebtMin) + '/mo minimums')
      + statRow('Liquid Cash', fmtUSD(d.liquidCash), 'checking + savings only')
      + statRow('Monthly Income', fmtUSD(d.monthlyIncome), 'real take-home')
      + '</div>'
      + '</div>'

      // tip
      + '<div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:rgba(129,140,248,0.10);border:1px solid rgba(129,140,248,0.25);display:flex;align-items:center;gap:8px;">'
      + '<i class="ph-fill ph-lightbulb" style="font-size:14px;color:#818cf8;flex-shrink:0;"></i>'
      + '<div style="font-size:11.5px;color:var(--text-1,#0a0a0a);font-weight:600;line-height:1.45;">' + tipFor(d) + '</div>'
      + '</div>';
  }

  function mount() {
    try {
      var card = document.getElementById(CARD_ID);
      var dashGrid = document.querySelector('.dash-grid');
      var moneyLeftCard = document.getElementById('dash-money-left-card');

      // Create card if it doesn't exist
      if (!card) {
        card = document.createElement('div');
        card.id = CARD_ID;
        card.className = 'card reveal';
        card.style.cssText = 'padding:16px 18px;';
        // Insert just after Money Left card if present, otherwise prepend to grid
        if (moneyLeftCard && moneyLeftCard.parentNode) {
          moneyLeftCard.parentNode.insertBefore(card, moneyLeftCard.nextSibling);
        } else if (dashGrid) {
          dashGrid.appendChild(card);
        } else {
          return; // dashboard not mounted yet
        }
      }
      card.innerHTML = buildCardHTML();
    } catch (e) {
      try { console.warn('[wjp-resilience] mount threw', e); } catch (_) {}
    }
  }

  function tick() {
    var s = getState();
    if (!s) return;
    var dashVisible = document.getElementById('dash-money-left-card') || document.querySelector('.dash-grid');
    if (!dashVisible) return;
    mount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1200); });
  else setTimeout(tick, 1200);
  setInterval(tick, 5000);

  window.WJP_Resilience = { compute: computeResilience, render: mount };
})();
