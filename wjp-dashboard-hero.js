/* wjp-dashboard-hero.js v1 — Strategy-focused dashboard hero card.
 *
 * Foregrounds the user's CURRENT STRATEGY TARGET so the dashboard isn't
 * a wall of distractions. Hero shows:
 *
 *   "Attack: [Target Debt]"
 *   $X balance · Y% APR · bleeds $Z/mo in interest
 *   "Pay $A this month to free up $B by [Date] when this debt clears."
 *   Progress bar: % paid down of starting balance
 *   Sub-line: "Cleared debts roll their minimum into your next target."
 *
 * The hero card mounts at the TOP of #page-dashboard, BEFORE the existing
 * Financial Education tip + Executive Summary. We don't remove existing
 * cards — Winston can demote those manually if he wants. This is additive
 * and reversible (delete the script tag to remove the hero).
 *
 * Uses bare appState + the strategy rollover engine from wjp-debts-elim-chart
 * via window.WJP_DebtsElimChart.simulate(). If that's unavailable, falls back
 * to single-debt math.
 *
 * Safe: IIFE, idempotent, polled tick.
 */
(function () {
  'use strict';
  if (window._wjpDashboardHeroInstalled) return;
  window._wjpDashboardHeroInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-dashboard-hero-style';
  var CARD_ID = 'wjp-dashboard-hero';

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtUsdDec(n) {
    if (n == null || !isFinite(n)) return '$0';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtMonth(d) {
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  // Use the same sort logic as app.js sortDebtsByStrategy (mirrors P6_HYBRID_FIX)
  function sortByStrategy(debts, strategy) {
    var d = debts.slice();
    if (strategy === 'snowball') {
      d.sort(function (a, b) { return (a.balance || 0) - (b.balance || 0); });
    } else if (strategy === 'hybrid') {
      d.sort(function (a, b) {
        var aBal = a.balance || 0, bBal = b.balance || 0;
        var aScore = aBal > 0 ? (a.apr || 0) / aBal : 0;
        var bScore = bBal > 0 ? (b.apr || 0) / bBal : 0;
        var delta = bScore - aScore;
        if (Math.abs(delta) > 1e-9) return delta;
        return aBal - bBal;
      });
    } else {
      d.sort(function (a, b) {
        var aprDelta = (b.apr || 0) - (a.apr || 0);
        if (Math.abs(aprDelta) > 0.001) return aprDelta;
        return (b.balance || 0) - (a.balance || 0);
      });
    }
    return d;
  }

  function getActiveTarget() {
    var s = getAppState();
    if (!s || !Array.isArray(s.debts) || !s.debts.length) return null;
    var strategy = (s.settings && s.settings.strategy) || 'avalanche';
    var active = s.debts.filter(function (d) { return (d.balance || 0) > 0; });
    if (!active.length) return null;
    var sorted = sortByStrategy(active, strategy);
    return { target: sorted[0], allActive: sorted, strategy: strategy };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + CARD_ID + ' {',
      '  background: linear-gradient(135deg, rgba(31,122,74,0.06) 0%, rgba(31,122,74,0.02) 100%);',
      '  border: 1px solid rgba(31,122,74,0.25);',
      '  border-radius: 18px; padding: 22px 26px; margin: 16px 0 18px;',
      '  font-family: Inter, system-ui, sans-serif;',
      '  box-shadow: 0 2px 6px rgba(0,0,0,0.04);',
      '}',
      'body.dark #' + CARD_ID + ' {',
      '  background: linear-gradient(135deg, rgba(31,122,74,0.14) 0%, rgba(31,122,74,0.04) 100%);',
      '  border-color: rgba(31,122,74,0.35);',
      '}',
      '#' + CARD_ID + ' .eyebrow {',
      '  font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase;',
      '  color: #1f7a4a; font-weight: 800; margin-bottom: 6px;',
      '}',
      '#' + CARD_ID + ' h2 {',
      '  margin: 0 0 2px; font-size: 26px; font-weight: 800; letter-spacing: -0.01em;',
      '  color: var(--ink, var(--text-1, #0a0a0a)); line-height: 1.15;',
      '}',
      '#' + CARD_ID + ' .meta {',
      '  font-size: 12px; color: var(--ink-dim, var(--text-2, #6b7280));',
      '  margin-bottom: 14px; font-weight: 500;',
      '}',
      '#' + CARD_ID + ' .meta strong { color: var(--ink, var(--text-1, #0a0a0a)); font-weight: 700; }',
      '#' + CARD_ID + ' .action-line {',
      '  font-size: 14px; color: var(--ink, var(--text-1, #0a0a0a)); line-height: 1.55; margin-bottom: 12px;',
      '}',
      '#' + CARD_ID + ' .action-line strong { color: #1f7a4a; font-weight: 800; }',
      '#' + CARD_ID + ' .progress {',
      '  height: 8px; background: var(--bg-3, rgba(0,0,0,0.06));',
      '  border-radius: 999px; overflow: hidden; margin-bottom: 6px;',
      '}',
      '#' + CARD_ID + ' .progress > div {',
      '  height: 100%; background: linear-gradient(90deg, #1f7a4a, #2da76b);',
      '  transition: width 0.5s ease;',
      '}',
      '#' + CARD_ID + ' .progress-label {',
      '  display: flex; justify-content: space-between; font-size: 10.5px;',
      '  color: var(--ink-dim, var(--text-2, #6b7280)); font-weight: 600;',
      '}',
      '#' + CARD_ID + ' .footer-row {',
      '  display: flex; justify-content: space-between; align-items: center;',
      '  margin-top: 12px; padding-top: 10px;',
      '  border-top: 1px solid rgba(0,0,0,0.06);',
      '  font-size: 10.5px; color: var(--ink-dim, var(--text-2, #6b7280));',
      '  flex-wrap: wrap; gap: 8px;',
      '}',
      'body.dark #' + CARD_ID + ' .footer-row { border-top-color: rgba(255,255,255,0.06); }',
      '#' + CARD_ID + ' .strat-pill {',
      '  font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em;',
      '  padding: 2px 8px; border-radius: 999px;',
      '  background: rgba(31,122,74,0.10); color: #1f7a4a;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function isOnDashboard() {
    var p = document.getElementById('page-dashboard');
    return !!(p && p.classList.contains('active'));
  }

  function findInsertionPoint() {
    var page = document.getElementById('page-dashboard');
    if (!page) return null;
    return page;
  }

  function render() {
    if (!isOnDashboard()) {
      var ex = document.getElementById(CARD_ID);
      if (ex) try { ex.remove(); } catch (_) {}
      return;
    }
    var info = getActiveTarget();
    if (!info) return;
    var t = info.target;
    var bal = Number(t.balance) || 0;
    var apr = Number(t.apr) || 0;
    var minPay = Number(t.minPayment) || 0;
    var monthlyInterest = (bal * apr / 100) / 12;
    var startingBalance = Number(t.startingBalance) || bal;
    var pctPaid = startingBalance > 0 ? Math.max(0, Math.min(100, ((startingBalance - bal) / startingBalance) * 100)) : 0;

    // Estimate clear date using simple amortization at min payment
    var monthsToClear = null;
    if (minPay > monthlyInterest && bal > 0) {
      var b = bal, m = 0;
      while (b > 0 && m < 600) {
        var i = b * apr / 100 / 12;
        var principal = minPay - i;
        if (principal <= 0) { m = null; break; }
        b -= principal;
        m++;
      }
      monthsToClear = m;
    }
    var clearDate = monthsToClear ? new Date(new Date().getFullYear(), new Date().getMonth() + monthsToClear, 1) : null;
    var clearDateLabel = clearDate ? fmtMonth(clearDate) : 'TBD';

    var ip = findInsertionPoint();
    if (!ip) return;
    var innerHTMLContent =
      '<div class="eyebrow">YOUR ACTIVE TARGET</div>' +
      '<h2>Attacking ' + (t.name || 'Debt') + '</h2>' +
      '<div class="meta"><strong>' + fmtUsd(bal) + '</strong> balance · <strong>' + apr.toFixed(2) + '%</strong> APR · bleeds <strong>' + fmtUsdDec(monthlyInterest) + '/mo</strong> in interest</div>' +
      '<div class="action-line">Pay <strong>' + fmtUsd(minPay) + '/mo minimum</strong> to free up <strong>' + fmtUsd(minPay) + ' in cascade capacity</strong> by <strong>' + clearDateLabel + '</strong> when this debt clears. Above minimums goes here first.</div>' +
      '<div class="progress"><div style="width:' + pctPaid.toFixed(1) + '%;"></div></div>' +
      '<div class="progress-label"><span>' + pctPaid.toFixed(0) + '% paid down</span><span>' + (monthsToClear ? monthsToClear + ' months at minimum' : 'min payment won\'t clear at current APR') + '</span></div>' +
      '<div class="footer-row">' +
        '<div>Next ' + (info.allActive.length - 1) + ' debt' + (info.allActive.length - 1 === 1 ? '' : 's') + ' will get the rollover after this clears.</div>' +
        '<span class="strat-pill">' + info.strategy.toUpperCase() + '</span>' +
      '</div>';

    var existing = document.getElementById(CARD_ID);
    if (existing) {
      // v2 fix 2026-05-19: UPDATE in place instead of remove+recreate. Avoids
      // the flicker + position-fight with wjp-edu-dashboard-tip (which wants
      // to be the first dashboard child).
      if (existing.innerHTML !== innerHTMLContent) {
        existing.innerHTML = innerHTMLContent;
      }
      return;
    }

    // First mount: build card and place AFTER the Ed Tips banner if present.
    var card = document.createElement('div');
    card.id = CARD_ID;
    card.className = (card.className||'') + ' reorderable';
    card.setAttribute('data-card-id', 'wjp-active-target');
    card.innerHTML = innerHTMLContent;

    var eduTip = document.getElementById('wjp-edu-dashboard-tip');
    if (eduTip && eduTip.parentElement === ip && eduTip.nextSibling) {
      ip.insertBefore(card, eduTip.nextSibling);
    } else if (eduTip && eduTip.parentElement === ip) {
      ip.appendChild(card);
    } else if (ip.firstChild) {
      ip.insertBefore(card, ip.firstChild);
    } else {
      ip.appendChild(card);
    }
  }

  function boot() {
    injectStyle();
    setInterval(render, 6000);
    window.addEventListener('hashchange', function () { setTimeout(render, 300); });
    window.addEventListener('wjp-debts-updated', render);
    setTimeout(render, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardHero = {
    render: render,
    getActiveTarget: getActiveTarget,
    version: 1
  };
})();
