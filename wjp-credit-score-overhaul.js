/* wjp-credit-score-overhaul.js v1 — Credit-Karma-style credit score panel.
 *
 * Replaces the bare manual-input panel with a real factor breakdown:
 *   - Score header w/ grade
 *   - Auto-utilization computed from appState.debts (no need to retype)
 *   - 5-factor breakdown (Utilization, Payment history, Age, Mix, New credit)
 *   - Top 3 actionable suggestions ranked by point-impact
 *
 * Mounts inside #credit-score-tab-content above the existing form. The
 * existing form stays for users who want to override values manually.
 */
(function () {
  'use strict';
  if (window._wjpCreditOverhaulInstalled) return;
  window._wjpCreditOverhaulInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-cs-overhaul';

  function loadCS() {
    try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); }
    catch (_) { return {}; }
  }
  function loadBureau() {
    try { return JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}'); }
    catch (_) { return {}; }
  }
  function getDebts() {
    try { return (typeof appState !== 'undefined' && appState && appState.debts) || []; }
    catch (_) { return []; }
  }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0); }

  // ── factor calculators ────────────────────────────────────────────────
  function isCreditCard(d) {
    var t = String(d.type || d.category || '').toLowerCase();
    return /credit/.test(t) || /\bcard\b/.test(t) || t === 'cc';
  }

  function computeUtilization() {
    var cs = loadCS();
    var debts = getDebts();
    var cardLimits = cs.cardLimits || {};
    var cards = debts.filter(isCreditCard);
    var totalBal = 0, totalLim = 0;
    var perCard = [];
    cards.forEach(function (d) {
      var lim = parseFloat(cardLimits[d.id] || d.limit || 0);
      var bal = parseFloat(d.balance || 0);
      if (lim > 0) {
        totalBal += bal; totalLim += lim;
        perCard.push({
          name: d.name,
          balance: bal, limit: lim,
          util: lim > 0 ? bal / lim : 0
        });
      } else {
        perCard.push({ name: d.name, balance: bal, limit: 0, util: null });
      }
    });
    perCard.sort(function (a, b) { return (b.util || 0) - (a.util || 0); });
    return {
      overall: totalLim > 0 ? totalBal / totalLim : null,
      totalBalance: totalBal,
      totalLimit: totalLim,
      perCard: perCard,
      cardCount: cards.length,
      cardsMissingLimits: cards.filter(function (c) {
        return !(parseFloat(cardLimits[c.id] || c.limit || 0) > 0);
      }).length
    };
  }

  function gradeUtilization(util) {
    if (util == null) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'Set your card limits to compute this.' };
    if (util < 0.10) return { letter: 'A+', label: 'Excellent', color: '#22c55e', impact: 'Under 10% — FICO sweet spot.' };
    if (util < 0.30) return { letter: 'A', label: 'Good', color: '#22c55e', impact: 'Under 30% — healthy.' };
    if (util < 0.50) return { letter: 'B', label: 'Fair', color: '#fbbf24', impact: 'Above 30% costs you ~10–20 pts.' };
    if (util < 0.80) return { letter: 'C', label: 'Poor', color: '#f97316', impact: 'Above 50% costs you ~30–60 pts.' };
    return { letter: 'D', label: 'Critical', color: '#ef4444', impact: 'Above 80% costs you ~60–100 pts.' };
  }

  function gradePaymentHistory(latesYr) {
    if (latesYr == null || isNaN(latesYr)) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'Tell us how many late payments you had in the past year.' };
    if (latesYr === 0) return { letter: 'A+', label: 'Spotless', color: '#22c55e', impact: 'Zero lates in 12 months — the strongest signal.' };
    if (latesYr === 1) return { letter: 'B', label: 'Slip', color: '#fbbf24', impact: 'One late drops 30–80 pts; ages off after 7 yrs.' };
    if (latesYr <= 3) return { letter: 'C', label: 'Concerning', color: '#f97316', impact: 'Multiple lates in a year stack damage.' };
    return { letter: 'D', label: 'Severe', color: '#ef4444', impact: 'Heavy late-payment damage. Stabilize on-time first.' };
  }

  function gradeAge(years) {
    if (years == null || isNaN(years)) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'How old is your oldest account?' };
    if (years >= 9)  return { letter: 'A+', label: 'Long history', color: '#22c55e', impact: '9+ years — top tier for age factor.' };
    if (years >= 5)  return { letter: 'A',  label: 'Strong',       color: '#22c55e', impact: '5–9 yrs — solid.' };
    if (years >= 2)  return { letter: 'B',  label: 'Building',     color: '#fbbf24', impact: 'Age improves with patience. Keep oldest accounts open.' };
    return { letter: 'C', label: 'New', color: '#f97316', impact: 'Avoid closing your oldest account.' };
  }

  function gradeMix(cards, loans) {
    if (cards === 0 && loans === 0) return { letter: '?', label: 'No data', color: '#9ca3af', impact: '' };
    if (cards > 0 && loans > 0) return { letter: 'A', label: 'Mixed', color: '#22c55e', impact: 'Both revolving + installment debt — maxes the mix factor.' };
    if (cards > 0) return { letter: 'B', label: 'Cards only', color: '#fbbf24', impact: 'No installment loan = small ding (~5–15 pts).' };
    return { letter: 'B', label: 'Loans only', color: '#fbbf24', impact: 'No revolving credit = small ding (~5–15 pts).' };
  }

  function gradeNewCredit(inq, newAcc) {
    var combined = (inq || 0) + (newAcc || 0);
    if (combined === 0) return { letter: 'A+', label: 'Quiet', color: '#22c55e', impact: 'No recent applications — best.' };
    if (combined <= 2)  return { letter: 'A',  label: 'Fine',  color: '#22c55e', impact: '1–2 inquiries — minor short-term ding.' };
    if (combined <= 4)  return { letter: 'B',  label: 'Moderate', color: '#fbbf24', impact: '3–4 inquiries adds up; pause new apps for 6 mo.' };
    return { letter: 'C', label: 'Heavy', color: '#f97316', impact: '5+ inquiries flagged — pause for 12 mo.' };
  }

  function buildSuggestions(util, cs, debts) {
    var out = [];
    // 1. Utilization payoff opportunities
    if (util.overall != null && util.overall > 0.10) {
      var targetUtil = 0.10;
      var targetBal = util.totalLimit * targetUtil;
      var payoff = util.totalBalance - targetBal;
      if (payoff > 0) {
        out.push({
          score: 100 - Math.round(util.overall * 100), // higher util = more impact
          icon: '💳',
          color: '#ef4444',
          title: 'Pay ' + fmtUSD(payoff) + ' across cards before next statement',
          detail: 'Drops total utilization from ' + Math.round(util.overall * 100) + '% to under 10%. Typically gains 30–50 FICO points within 60 days.'
        });
      }
    }
    // Per-card hotspot — single highest-utilization card over 30%
    var hotCard = util.perCard.find(function (c) { return c.util != null && c.util > 0.30; });
    if (hotCard && hotCard.limit > 0) {
      var paydown = hotCard.balance - hotCard.limit * 0.30;
      out.push({
        score: 60,
        icon: '🎯',
        color: '#f97316',
        title: 'Pay ' + fmtUSD(paydown) + ' on ' + hotCard.name + ' to drop it below 30%',
        detail: 'Per-card utilization matters too. Currently ' + Math.round(hotCard.util * 100) + '% reported each statement.'
      });
    }
    // 2. Lates → on-time streak
    var lates = parseInt(cs.latePayments12mo, 10) || 0;
    if (lates > 0) {
      out.push({
        score: 50 + lates * 10,
        icon: '⏰',
        color: '#ef4444',
        title: 'Build a clean 6-month on-time payment streak',
        detail: 'Recovers 20–40 of the points each late cost. Set autopay on every account.'
      });
    }
    // 3. Inquiries
    var inq = parseInt(cs.hardInquiries12mo, 10) || 0;
    var newAcc = parseInt(cs.newAccounts12mo, 10) || 0;
    if (inq + newAcc >= 3) {
      out.push({
        score: 35,
        icon: '🛑',
        color: '#fbbf24',
        title: 'Pause new credit applications for 6–12 months',
        detail: 'Inquiries fade after 12 months. New accounts age your average history down too.'
      });
    }
    // 4. Mix
    var cardCount = debts.filter(isCreditCard).length;
    var loanCount = debts.filter(function (d) { return !isCreditCard(d); }).length;
    if (cardCount > 0 && loanCount === 0) {
      out.push({
        score: 15,
        icon: '🏦',
        color: '#fbbf24',
        title: 'Once cards are paid down, consider a small installment loan',
        detail: 'Mix of revolving + installment debt boosts the credit-mix factor by 5–15 pts.'
      });
    }
    if (loanCount > 0 && cardCount === 0) {
      out.push({
        score: 15,
        icon: '💳',
        color: '#fbbf24',
        title: 'Open a starter card and use it for one small recurring bill',
        detail: 'Adds revolving credit to your file — boosts the mix factor 5–15 pts.'
      });
    }
    // 5. Cards missing limits
    if (util.cardsMissingLimits > 0) {
      out.push({
        score: 90,
        icon: '✏️',
        color: '#a78bfa',
        title: 'Add credit limits for ' + util.cardsMissingLimits + ' card' + (util.cardsMissingLimits === 1 ? '' : 's'),
        detail: 'Without limits, utilization can\'t be calculated — and that\'s 30% of your FICO score.'
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 4);
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function scoreColor(score) {
    if (!score) return '#9ca3af';
    score = parseInt(score, 10);
    if (score >= 800) return '#22c55e';
    if (score >= 740) return '#22c55e';
    if (score >= 670) return '#84cc16';
    if (score >= 580) return '#fbbf24';
    return '#ef4444';
  }
  function scoreLabel(score) {
    if (!score) return 'Not set';
    score = parseInt(score, 10);
    if (score >= 800) return 'Exceptional';
    if (score >= 740) return 'Very good';
    if (score >= 670) return 'Good';
    if (score >= 580) return 'Fair';
    return 'Poor';
  }

  function factorCardHTML(title, grade, weight, body) {
    return ''
      + '<div style="background:var(--card-2, rgba(255,255,255,0.03));border:1px solid var(--border, rgba(255,255,255,0.08));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      +     '<div style="font-size:12px;font-weight:800;color:var(--ink, #0a0a0a);">' + escHtml(title) + ' <span style="font-size:9px;color:var(--ink-faint, #94a3b8);font-weight:600;margin-left:4px;">' + escHtml(weight) + '</span></div>'
      +     '<div style="display:flex;align-items:center;gap:6px;">'
      +       '<span style="background:' + grade.color + ';color:#0b0f1a;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:900;">' + grade.letter + '</span>'
      +       '<span style="font-size:11px;color:' + grade.color + ';font-weight:700;">' + escHtml(grade.label) + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="font-size:11px;color:var(--ink-dim, #94a3b8);line-height:1.45;">' + escHtml(body) + '</div>'
      +   '<div style="font-size:11px;color:var(--ink, #0a0a0a);font-weight:600;line-height:1.4;font-style:italic;">' + escHtml(grade.impact) + '</div>'
      + '</div>';
  }

  function suggestionRowHTML(sug) {
    return ''
      + '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid var(--rule, rgba(255,255,255,0.06));">'
      +   '<span style="font-size:18px;flex-shrink:0;">' + sug.icon + '</span>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="font-weight:700;font-size:13px;color:var(--ink, #0a0a0a);">' + escHtml(sug.title) + '</div>'
      +     '<div style="font-size:11px;color:var(--ink-dim, #94a3b8);line-height:1.45;margin-top:2px;">' + escHtml(sug.detail) + '</div>'
      +   '</div>'
      + '</div>';
  }

  function render() {
    try {
      var host = document.getElementById('credit-score-tab-content');
      if (!host) return;
      // Skip render if container is hidden (subtab not active)
      if (host.offsetParent === null) return;

      var cs = loadCS();
      var bureau = loadBureau();
      var debts = getDebts();
      var util = computeUtilization();
      var cardCount = debts.filter(isCreditCard).length;
      var loanCount = debts.filter(function (d) { return !isCreditCard(d); }).length;
      var lates = parseInt(cs.latePayments12mo, 10) || 0;
      var oldest = parseFloat(cs.oldestAccountYears) || 0;
      var inq = parseInt(cs.hardInquiries12mo, 10) || 0;
      var newAcc = parseInt(cs.newAccounts12mo, 10) || 0;
      var score = bureau.lastScore || cs.currentScore;

      var grades = {
        util: gradeUtilization(util.overall),
        pay:  gradePaymentHistory(lates),
        age:  gradeAge(oldest),
        mix:  gradeMix(cardCount, loanCount),
        newc: gradeNewCredit(inq, newAcc)
      };

      var suggestions = buildSuggestions(util, cs, debts);

      var scoreNum = parseInt(score, 10);
      var scorePct = scoreNum ? Math.max(0, Math.min(100, ((scoreNum - 300) / 550) * 100)) : 0;

      var html = ''
        + '<div id="' + WRAP_ID + '" style="font-family:var(--sans, Inter, system-ui, sans-serif);margin-bottom:24px;">'
        // Header
        + '  <div style="background:var(--card, rgba(255,255,255,0.02));border:1px solid var(--border, rgba(255,255,255,0.08));border-radius:18px;padding:22px 24px;margin-bottom:16px;">'
        + '    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">'
        + '      <div style="flex:1;min-width:200px;">'
        + '        <div style="font-size:10px;color:var(--accent, #22c55e);font-weight:800;text-transform:uppercase;letter-spacing:0.12em;">YOUR CREDIT SCORE</div>'
        + '        <div style="display:flex;align-items:baseline;gap:10px;margin-top:4px;">'
        + '          <div style="font-size:48px;font-weight:900;color:' + scoreColor(score) + ';line-height:1;letter-spacing:-0.02em;">' + (score || '—') + '</div>'
        + '          <div style="font-size:14px;font-weight:700;color:' + scoreColor(score) + ';">' + scoreLabel(score) + '</div>'
        + '        </div>'
        + '        <div style="font-size:11px;color:var(--ink-faint, #94a3b8);font-weight:600;margin-top:2px;">FICO range: 300 (worst) → 850 (best)</div>'
        + '        <div style="margin-top:10px;height:6px;background:var(--card-2, rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;width:280px;">'
        + '          <div style="height:100%;width:' + scorePct.toFixed(1) + '%;background:linear-gradient(90deg,#ef4444,#fbbf24,#22c55e);transition:width 1.2s;"></div>'
        + '        </div>'
        + '      </div>'
        + '      <div style="text-align:right;">'
        + '        <div style="font-size:9px;color:var(--ink-faint, #94a3b8);font-weight:700;text-transform:uppercase;letter-spacing:0.10em;">REPORTED UTILIZATION</div>'
        + '        <div style="font-size:32px;font-weight:900;color:' + grades.util.color + ';line-height:1;letter-spacing:-0.02em;margin-top:4px;">' + (util.overall != null ? Math.round(util.overall * 100) + '%' : '—') + '</div>'
        + '        <div style="font-size:11px;color:var(--ink-dim, #94a3b8);font-weight:600;margin-top:2px;">' + fmtUSD(util.totalBalance) + ' of ' + fmtUSD(util.totalLimit) + '</div>'
        + '      </div>'
        + '    </div>'
        + '  </div>'
        // Factor breakdown
        + '  <div style="background:var(--card, rgba(255,255,255,0.02));border:1px solid var(--border, rgba(255,255,255,0.08));border-radius:18px;padding:20px 22px;margin-bottom:16px;">'
        + '    <div style="font-size:14px;font-weight:800;color:var(--ink, #0a0a0a);margin-bottom:12px;">What\'s shaping your score</div>'
        + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">'
        +        factorCardHTML('Credit utilization', grades.util, '30%', 'How much of your card limits you\'re using. Computed automatically from your linked balances.')
        +        factorCardHTML('Payment history',    grades.pay,  '35%', 'Whether your bills get paid on time. The single biggest factor.')
        +        factorCardHTML('Age of credit',      grades.age,  '15%', 'How long you\'ve had credit accounts open. Patience pays here.')
        +        factorCardHTML('Credit mix',         grades.mix,  '10%', 'Variety of credit types — revolving (cards) + installment (loans).')
        +        factorCardHTML('New credit',         grades.newc, '10%', 'Recent inquiries and new accounts. Pause new applications when growing your score.')
        + '    </div>'
        + '  </div>'
        // Suggestions
        + (suggestions.length ? (
            '  <div style="background:var(--card, rgba(255,255,255,0.02));border:1px solid var(--accent, #22c55e);border-radius:18px;padding:20px 22px;margin-bottom:16px;">'
          + '    <div style="font-size:10px;color:var(--accent, #22c55e);font-weight:800;text-transform:uppercase;letter-spacing:0.12em;">FASTEST WINS</div>'
          + '    <div style="font-size:14px;font-weight:800;color:var(--ink, #0a0a0a);margin-top:2px;margin-bottom:6px;">Top moves to grow your score</div>'
          + '    <div>' + suggestions.map(suggestionRowHTML).join('') + '</div>'
          + '  </div>'
          ) : '')
        // Per-card detail (if cards exist)
        + (util.perCard.length ? (
            '  <div style="background:var(--card, rgba(255,255,255,0.02));border:1px solid var(--border, rgba(255,255,255,0.08));border-radius:18px;padding:20px 22px;">'
          + '    <div style="font-size:14px;font-weight:800;color:var(--ink, #0a0a0a);margin-bottom:12px;">Card-by-card utilization</div>'
          + '    <div style="display:flex;flex-direction:column;gap:8px;">'
          +        util.perCard.map(function (c) {
                    if (c.util == null) {
                      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px dashed var(--border, rgba(255,255,255,0.10));border-radius:8px;">'
                           + '<div style="font-size:13px;font-weight:700;color:var(--ink, #0a0a0a);">' + escHtml(c.name) + '</div>'
                           + '<div style="font-size:11px;color:#fbbf24;font-weight:700;">no limit set →&nbsp;<a href="#" data-cs-add-limit="' + escHtml(c.name) + '" style="color:#fbbf24;text-decoration:underline;">add it</a></div>'
                           + '</div>';
                    }
                    var p = Math.round(c.util * 100);
                    var color = p < 10 ? '#22c55e' : p < 30 ? '#84cc16' : p < 50 ? '#fbbf24' : p < 80 ? '#f97316' : '#ef4444';
                    return '<div style="padding:8px 10px;border:1px solid var(--border, rgba(255,255,255,0.10));border-radius:8px;">'
                         + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;">'
                         + '  <div style="font-size:13px;font-weight:700;color:var(--ink, #0a0a0a);">' + escHtml(c.name) + '</div>'
                         + '  <div style="font-size:12px;color:' + color + ';font-weight:800;">' + p + '%</div>'
                         + '</div>'
                         + '<div style="font-size:10px;color:var(--ink-dim, #94a3b8);font-weight:600;margin-bottom:4px;">' + fmtUSD(c.balance) + ' of ' + fmtUSD(c.limit) + '</div>'
                         + '<div style="height:6px;background:var(--card-2, rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;">'
                         + '<div style="height:100%;width:' + Math.min(100, p) + '%;background:' + color + ';transition:width 1s;"></div>'
                         + '</div>'
                         + '</div>';
                  }).join('')
          + '    </div>'
          + '  </div>'
          ) : '')
        + '</div>';

      var existing = document.getElementById(WRAP_ID);
      if (existing) {
        existing.outerHTML = html;
      } else {
        // Insert at top of credit score subtab content
        var div = document.createElement('div');
        div.innerHTML = html;
        if (host.firstChild) host.insertBefore(div.firstChild, host.firstChild);
        else host.appendChild(div.firstChild);
      }
    } catch (e) { try { console.warn('[wjp-credit-score-overhaul] threw', e); } catch (_) {} }
  }

  function whenReady(fn) {
    function ready() {
      try { return typeof appState !== 'undefined' && appState && Array.isArray(appState.debts); } catch (_) { return false; }
    }
    if (ready()) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (ready()) { clearInterval(iv); fn(); }
      else if (++tries > 60) clearInterval(iv);
    }, 400);
  }

  function boot() {
    whenReady(function () {
      render();
      // Re-render on debt/cs changes
      setInterval(render, 4000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 700); });
  } else {
    setTimeout(boot, 700);
  }

  window.WJP_CreditOverhaul = { render: render, computeUtilization: computeUtilization, buildSuggestions: buildSuggestions };
})();
