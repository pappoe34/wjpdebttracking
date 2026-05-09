/* wjp-credit-score-overhaul.js v2 — credit score tab refresh.
 *
 * Builds a Credit-Karma / Experian / WalletHub-grade UX:
 *   1. HERO — circular score gauge w/ change indicator + multi-bureau row
 *   2. HISTORY — score trajectory mini-chart pulled from appState.creditScoreHistory
 *   3. FACTORS — 5-card breakdown with letter grades, weights, plain-English explainers
 *   4. SIMULATOR — what-if sliders (pay-down, new card, close card) showing live point estimates
 *   5. AI COACH — chat panel seeded with personalized prompts; routes to WJP_ChatCore
 *   6. INSIGHTS — daily-rotating educational tip
 *   7. PER-CARD — utilization bars (carried over from v1)
 *
 * Mounts above #credit-score-tab-content. The existing form + OCR + bureau
 * cards stay intact below for raw input.
 */
(function () {
  'use strict';
  if (window._wjpCreditOverhaulInstalled) return;
  window._wjpCreditOverhaulInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var WRAP_ID = 'wjp-cs-overhaul';

  // ── helpers ─────────────────────────────────────────────────────────────
  function loadCS() { try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch (_) { return {}; } }
  function loadBureau() { try { return JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}'); } catch (_) { return {}; } }
  function getDebts() { try { return (typeof appState !== 'undefined' && appState && appState.debts) || []; } catch (_) { return []; } }
  function getHistory() { try { return (typeof appState !== 'undefined' && appState && appState.creditScoreHistory) || []; } catch (_) { return []; } }
  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0); }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function isCreditCard(d) { var t = String(d.type || d.category || '').toLowerCase(); return /credit/.test(t) || /\bcard\b/.test(t) || t === 'cc'; }

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

  // ── factor calculators ─────────────────────────────────────────────────
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
        perCard.push({ id: d.id, name: d.name, balance: bal, limit: lim, util: lim > 0 ? bal / lim : 0 });
      } else perCard.push({ id: d.id, name: d.name, balance: bal, limit: 0, util: null });
    });
    perCard.sort(function (a, b) { return (b.util || 0) - (a.util || 0); });
    return {
      overall: totalLim > 0 ? totalBal / totalLim : null,
      totalBalance: totalBal, totalLimit: totalLim,
      perCard: perCard, cardCount: cards.length,
      cardsMissingLimits: cards.filter(function (c) { return !(parseFloat(cardLimits[c.id] || c.limit || 0) > 0); }).length
    };
  }

  function gradeUtilization(u) {
    if (u == null) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'Set your card limits to compute this.' };
    if (u < 0.10) return { letter: 'A+', label: 'Excellent', color: '#22c55e', impact: 'Under 10% — FICO sweet spot.' };
    if (u < 0.30) return { letter: 'A',  label: 'Good',     color: '#22c55e', impact: 'Under 30% — healthy.' };
    if (u < 0.50) return { letter: 'B',  label: 'Fair',     color: '#fbbf24', impact: 'Above 30% costs ~10–20 pts.' };
    if (u < 0.80) return { letter: 'C',  label: 'Poor',     color: '#f97316', impact: 'Above 50% costs ~30–60 pts.' };
    return { letter: 'D', label: 'Critical', color: '#ef4444', impact: 'Above 80% costs ~60–100 pts.' };
  }
  function gradePay(l) {
    if (l == null || isNaN(l)) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'Tell us late payments in past 12 mo.' };
    if (l === 0) return { letter: 'A+', label: 'Spotless', color: '#22c55e', impact: 'Zero lates — strongest signal.' };
    if (l === 1) return { letter: 'B',  label: 'Slip',     color: '#fbbf24', impact: 'One late drops 30–80 pts.' };
    if (l <= 3) return  { letter: 'C',  label: 'Concerning', color: '#f97316', impact: 'Multiple lates stack damage.' };
    return { letter: 'D', label: 'Severe', color: '#ef4444', impact: 'Heavy late-payment damage.' };
  }
  function gradeAge(y) {
    if (y == null || isNaN(y)) return { letter: '?', label: 'Unknown', color: '#9ca3af', impact: 'How old is your oldest account?' };
    if (y >= 9) return { letter: 'A+', label: 'Long history', color: '#22c55e', impact: '9+ years — top tier.' };
    if (y >= 5) return { letter: 'A',  label: 'Strong',       color: '#22c55e', impact: '5–9 yrs — solid.' };
    if (y >= 2) return { letter: 'B',  label: 'Building',     color: '#fbbf24', impact: 'Keep oldest accounts open.' };
    return { letter: 'C', label: 'New', color: '#f97316', impact: 'Avoid closing your oldest account.' };
  }
  function gradeMix(c, l) {
    if (c === 0 && l === 0) return { letter: '?', label: 'No data', color: '#9ca3af', impact: '' };
    if (c > 0 && l > 0) return { letter: 'A', label: 'Mixed', color: '#22c55e', impact: 'Both revolving + installment — ideal.' };
    if (c > 0) return { letter: 'B', label: 'Cards only', color: '#fbbf24', impact: 'No installment loan — small ding.' };
    return { letter: 'B', label: 'Loans only', color: '#fbbf24', impact: 'No revolving credit — small ding.' };
  }
  function gradeNew(inq, n) {
    var c = (inq||0)+(n||0);
    if (c === 0) return { letter: 'A+', label: 'Quiet', color: '#22c55e', impact: 'No recent applications.' };
    if (c <= 2) return { letter: 'A',  label: 'Fine',  color: '#22c55e', impact: 'Minor short-term ding.' };
    if (c <= 4) return { letter: 'B',  label: 'Moderate', color: '#fbbf24', impact: 'Pause new apps for 6 mo.' };
    return { letter: 'C', label: 'Heavy', color: '#f97316', impact: 'Pause for 12 months.' };
  }

  // ── point-impact estimator (used by simulator) ─────────────────────────
  function estimateScoreShift(opts) {
    // opts: { paydownAmt, newCard, closeCard }
    // Conservative FICO estimates — not exact, illustrative.
    var cs = loadCS();
    var u = computeUtilization();
    var baseUtil = u.overall || 0;
    var newBal = Math.max(0, u.totalBalance - (opts.paydownAmt || 0));
    var newUtil = u.totalLimit > 0 ? newBal / u.totalLimit : 0;
    var deltaUtil = newUtil - baseUtil;
    var delta = 0;
    // Util bands → point shifts
    if (deltaUtil < -0.40) delta += 80;
    else if (deltaUtil < -0.20) delta += 50;
    else if (deltaUtil < -0.10) delta += 30;
    else if (deltaUtil < 0)     delta += 10 + Math.round(-deltaUtil * 200);
    if (newUtil < 0.10 && baseUtil >= 0.10) delta += 20; // crossing into <10% threshold
    if (newUtil < 0.30 && baseUtil >= 0.30) delta += 15;
    // New card application — short-term ding, long-term mix help
    if (opts.newCard) delta -= 8;
    // Closing oldest card — ding age + util
    if (opts.closeCard) {
      delta -= 12;
      if (cs.oldestAccountYears && parseFloat(cs.oldestAccountYears) >= 5) delta -= 10;
    }
    return delta;
  }

  // ── score history chart ────────────────────────────────────────────────
  function renderHistoryChart(canvas, history) {
    if (!canvas || !window.Chart) return;
    var labels = history.map(function (h) { var d = new Date(h.date || h.ts || h.timestamp || Date.now()); return (d.getMonth()+1)+'/'+d.getDate(); });
    var data = history.map(function (h) { return parseInt(h.score, 10) || null; });
    if (!data.length) return;
    try {
      if (canvas._chart) canvas._chart.destroy();
      canvas._chart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: labels, datasets: [{
          label: 'Score', data: data,
          borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.10)',
          tension: 0.35, pointRadius: 3, pointHoverRadius: 5, fill: true, borderWidth: 2
        }]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { display: false, suggestedMin: Math.max(300, Math.min.apply(null, data) - 20), suggestedMax: Math.min(850, Math.max.apply(null, data) + 20) }
          }
        }
      });
    } catch (_) {}
  }

  // ── AI Coach prompts ───────────────────────────────────────────────────
  function buildCoachPrompts(cs, u, debts) {
    var prompts = [];
    var score = parseInt(cs.currentScore, 10);
    if (score && score < 700) prompts.push({ q: 'How can I get to 700?', icon: '🎯' });
    if (u.overall && u.overall > 0.30) prompts.push({ q: 'Which card should I pay down first?', icon: '💳' });
    var oldest = debts.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); })[0];
    if (oldest && cs.oldestAccountYears) prompts.push({ q: 'Should I close my oldest card?', icon: '🏛️' });
    prompts.push({ q: 'Why did my score drop?', icon: '📉' });
    prompts.push({ q: 'What\'s hurting me most?', icon: '🔍' });
    prompts.push({ q: 'How long until I see improvement?', icon: '⏳' });
    return prompts.slice(0, 4);
  }

  function askCoach(prompt) {
    try {
      var fab = document.getElementById('ai-chat-fab');
      var panel = document.getElementById('ai-chat-panel');
      if (panel && !panel.classList.contains('active') && fab) fab.click();
      setTimeout(function () {
        var inp = document.getElementById('chat-input-v2') || document.getElementById('chat-input');
        if (inp) {
          inp.value = prompt;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (window.WJP_ChatCore && typeof window.WJP_ChatCore.send === 'function') {
          try { window.WJP_ChatCore.send(prompt); return; } catch (_) {}
        }
        var btn = document.getElementById('chat-send-v2') || document.getElementById('chat-send');
        if (btn) btn.click();
      }, 350);
    } catch (_) {}
  }

  // ── educational insight (rotating) ─────────────────────────────────────
  var INSIGHTS = [
    { icon: '💡', title: 'The 30% myth', body: 'Even keeping utilization below 30% costs you points. The FICO sweet spot is under 10% — a single card hitting 30% drags everything.' },
    { icon: '⏰', title: 'Statement closing > due date', body: 'Your card reports the balance ON the statement closing date, not the due date. To drop reported util, pay down BEFORE the statement closes.' },
    { icon: '🏛️', title: 'Don\'t close old cards', body: 'Closing your oldest card both shortens your average credit age and reduces your total available credit — a double hit.' },
    { icon: '🛑', title: 'Inquiry rate-shopping', body: 'Multiple mortgage / auto / student loan inquiries within 14–45 days count as ONE for FICO. Apply within that window to limit damage.' },
    { icon: '🔄', title: 'Authorized user lift', body: 'Becoming an authorized user on someone else\'s old, on-time card can add 20–50 pts in weeks — instant credit-age + utilization boost.' },
    { icon: '📈', title: 'AZEO strategy', body: '"All Zero Except One" — pay all cards to $0 EXCEPT one with a small balance. Reports as < 9% utilization, max FICO points.' },
    { icon: '🏷️', title: 'Credit limit increases', body: 'Asking your existing card for a higher limit is usually a soft pull — drops utilization without opening a new account.' },
    { icon: '🔥', title: 'Late payment recovery', body: 'A 30-day late costs 60–80 pts at peak. Each on-time month after recovers 1–3 pts; full recovery takes ~6 months.' }
  ];
  function todaysInsight() {
    var d = new Date();
    var dayIdx = (d.getFullYear() * 365 + d.getMonth() * 31 + d.getDate()) % INSIGHTS.length;
    return INSIGHTS[dayIdx];
  }

  // ── HTML builders ──────────────────────────────────────────────────────
  function gaugeSVG(score, color) {
    score = parseInt(score, 10) || 0;
    var pct = Math.max(0, Math.min(1, (score - 300) / 550));
    var dash = (pct * 282).toFixed(1); // 2π*45 ≈ 282
    return ''
      + '<svg viewBox="0 0 120 120" style="width:160px;height:160px;transform:rotate(-90deg);">'
      +   '<circle cx="60" cy="60" r="45" fill="none" stroke="var(--card-2, rgba(255,255,255,0.06))" stroke-width="10" />'
      +   '<circle cx="60" cy="60" r="45" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + dash + ' 282" style="transition:stroke-dasharray 1.4s cubic-bezier(0.22,0.61,0.36,1);" />'
      + '</svg>';
  }
  function bureauChip(label, value, color) {
    return ''
      + '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;min-width:84px;">'
      +   '<div style="font-size:9px;font-weight:800;letter-spacing:0.10em;color:var(--ink-faint,#94a3b8);text-transform:uppercase;">' + escHtml(label) + '</div>'
      +   '<div style="font-size:22px;font-weight:900;color:' + color + ';line-height:1;margin-top:4px;">' + escHtml(value || '—') + '</div>'
      +   '<div style="font-size:9px;font-weight:700;color:' + color + ';margin-top:2px;">' + scoreLabel(value) + '</div>'
      + '</div>';
  }
  function factorCardHTML(title, grade, weight, body) {
    return ''
      + '<div style="background:var(--card-2,rgba(255,255,255,0.03));border:1px solid var(--border,rgba(255,255,255,0.08));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      +     '<div style="font-size:12px;font-weight:800;color:var(--ink,#0a0a0a);">' + escHtml(title) + ' <span style="font-size:9px;color:var(--ink-faint,#94a3b8);font-weight:600;margin-left:4px;">' + escHtml(weight) + '</span></div>'
      +     '<div style="display:flex;align-items:center;gap:6px;">'
      +       '<span style="background:' + grade.color + ';color:#0b0f1a;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:900;">' + grade.letter + '</span>'
      +       '<span style="font-size:11px;color:' + grade.color + ';font-weight:700;">' + escHtml(grade.label) + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="font-size:11px;color:var(--ink-dim,#94a3b8);line-height:1.45;">' + escHtml(body) + '</div>'
      +   '<div style="font-size:11px;color:var(--ink,#0a0a0a);font-weight:600;line-height:1.4;font-style:italic;">' + escHtml(grade.impact) + '</div>'
      + '</div>';
  }

  function render() {
    try {
      var host = document.getElementById('credit-score-tab-content');
      if (!host || host.offsetParent === null) return;

      var cs = loadCS();
      var bureau = loadBureau();
      var debts = getDebts();
      var u = computeUtilization();
      var cardCount = debts.filter(isCreditCard).length;
      var loanCount = debts.length - cardCount;
      var lates  = parseInt(cs.latePayments12mo, 10) || 0;
      var oldest = parseFloat(cs.oldestAccountYears) || 0;
      var inq    = parseInt(cs.hardInquiries12mo, 10) || 0;
      var newAcc = parseInt(cs.newAccounts12mo, 10) || 0;
      var current = bureau.lastScore || cs.currentScore;
      var bs = cs.bureauScores || {};
      var color = scoreColor(current);

      var grades = {
        util: gradeUtilization(u.overall),
        pay:  gradePay(lates),
        age:  gradeAge(oldest),
        mix:  gradeMix(cardCount, loanCount),
        newc: gradeNew(inq, newAcc)
      };

      // Score history change
      var hist = getHistory();
      var change = null;
      if (hist.length >= 2) {
        var prev = parseInt(hist[hist.length - 2].score, 10);
        var curr = parseInt(hist[hist.length - 1].score, 10);
        if (!isNaN(prev) && !isNaN(curr)) change = curr - prev;
      }

      var coachPrompts = buildCoachPrompts(cs, u, debts);
      var insight = todaysInsight();

      var html = ''
      + '<div id="' + WRAP_ID + '" style="font-family:var(--sans,Inter,system-ui,sans-serif);margin-bottom:24px;display:flex;flex-direction:column;gap:14px;">'
      // ── HERO ────────────────────────────────────────────────────────
      + '  <div style="background:linear-gradient(135deg,var(--card,rgba(255,255,255,0.02)) 0%,rgba(34,197,94,0.05) 100%);border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:20px;padding:24px 28px;">'
      + '    <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">'
      + '      <div style="position:relative;flex-shrink:0;">'
      +          gaugeSVG(current, color)
      + '        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">'
      + '          <div style="font-size:34px;font-weight:900;color:' + color + ';line-height:1;letter-spacing:-0.02em;">' + (current || '—') + '</div>'
      + '          <div style="font-size:10px;font-weight:700;color:' + color + ';margin-top:2px;letter-spacing:0.05em;">' + scoreLabel(current).toUpperCase() + '</div>'
      + '        </div>'
      + '      </div>'
      + '      <div style="flex:1;min-width:220px;">'
      + '        <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;color:var(--accent,#22c55e);text-transform:uppercase;">YOUR CREDIT SCORE</div>'
      + '        <div style="font-size:18px;font-weight:800;color:var(--ink,#0a0a0a);margin:4px 0 6px;">FICO range 300 → 850</div>'
      +          (change != null ? (
                  '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:' + (change >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') + ';color:' + (change >= 0 ? '#22c55e' : '#ef4444') + ';border-radius:999px;font-size:11px;font-weight:800;">'
                + (change >= 0 ? '▲' : '▼') + ' ' + Math.abs(change) + ' pts since last update</div>'
                ) : (
                  '<div style="font-size:11px;color:var(--ink-faint,#94a3b8);">Save a new score to track changes over time.</div>'
                ))
      // Multi-bureau row
      +          (Object.keys(bs).length > 0 ? (
                  '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">'
                + (bs.transunion ? bureauChip('TransUnion', bs.transunion.value, scoreColor(bs.transunion.value)) : '')
                + (bs.equifax    ? bureauChip('Equifax',    bs.equifax.value,    scoreColor(bs.equifax.value)) : '')
                + (bs.experian   ? bureauChip('Experian',   bs.experian.value,   scoreColor(bs.experian.value)) : '')
                + '</div>'
                ) : '')
      + '      </div>'
      // Tiny history chart
      + '      <div style="flex-shrink:0;width:160px;height:60px;">'
      + '        <canvas id="wjp-cs-history-chart" style="width:100%;height:100%;"></canvas>'
      + '        <div style="font-size:9px;color:var(--ink-faint,#94a3b8);text-align:center;margin-top:2px;">' + (hist.length >= 2 ? hist.length + ' updates' : 'no history yet') + '</div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      // ── FACTORS ─────────────────────────────────────────────────────
      + '  <div style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:18px;padding:20px 22px;">'
      + '    <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-bottom:12px;">What\'s shaping your score</div>'
      + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">'
      +        factorCardHTML('Credit utilization', grades.util, '30%', 'How much of your card limits you\'re using. Computed live from your linked balances.')
      +        factorCardHTML('Payment history',    grades.pay,  '35%', 'Whether your bills get paid on time. The single biggest factor.')
      +        factorCardHTML('Age of credit',      grades.age,  '15%', 'How long you\'ve had credit accounts open.')
      +        factorCardHTML('Credit mix',         grades.mix,  '10%', 'Variety of credit types — revolving + installment.')
      +        factorCardHTML('New credit',         grades.newc, '10%', 'Recent inquiries and new accounts.')
      + '    </div>'
      + '  </div>'
      // ── SIMULATOR ───────────────────────────────────────────────────
      + '  <div style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--accent,#22c55e);border-radius:18px;padding:20px 22px;">'
      + '    <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;color:var(--accent,#22c55e);text-transform:uppercase;">WHAT-IF SIMULATOR</div>'
      + '    <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin:4px 0 14px;">Move the sliders to see estimated point impact</div>'
      + '    <div style="display:flex;flex-direction:column;gap:14px;">'
      + '      <div>'
      + '        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-dim,#94a3b8);margin-bottom:4px;">'
      + '          <span>Pay down credit cards by</span>'
      + '          <span id="wjp-cs-sim-paydown-val" style="color:var(--ink,#0a0a0a);font-weight:700;">$0</span>'
      + '        </div>'
      + '        <input id="wjp-cs-sim-paydown" type="range" min="0" max="' + Math.round(u.totalBalance) + '" step="50" value="0" style="width:100%;accent-color:#22c55e;">'
      + '      </div>'
      + '      <div style="display:flex;gap:14px;flex-wrap:wrap;">'
      + '        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-dim,#94a3b8);cursor:pointer;"><input id="wjp-cs-sim-newcard" type="checkbox"> Open a new credit card</label>'
      + '        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-dim,#94a3b8);cursor:pointer;"><input id="wjp-cs-sim-closecard" type="checkbox"> Close my oldest card</label>'
      + '      </div>'
      + '    </div>'
      + '    <div style="margin-top:18px;padding:14px 16px;background:var(--card-2,rgba(255,255,255,0.03));border-radius:12px;display:flex;align-items:center;gap:14px;">'
      + '      <div style="font-size:32px;font-weight:900;color:var(--accent,#22c55e);line-height:1;" id="wjp-cs-sim-delta">+0</div>'
      + '      <div style="flex:1;">'
      + '        <div style="font-size:13px;font-weight:800;color:var(--ink,#0a0a0a);">Estimated point shift</div>'
      + '        <div style="font-size:11px;color:var(--ink-dim,#94a3b8);" id="wjp-cs-sim-detail">Adjust sliders above to see impact.</div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      // ── AI COACH ────────────────────────────────────────────────────
      + '  <div style="background:linear-gradient(135deg,rgba(167,139,250,0.05),rgba(102,126,234,0.05));border:1px solid rgba(167,139,250,0.3);border-radius:18px;padding:20px 22px;">'
      + '    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">'
      + '      <div style="width:32px;height:32px;border-radius:8px;background:rgba(167,139,250,0.2);display:grid;place-items:center;"><i class="ph-fill ph-robot" style="font-size:16px;color:#a78bfa;"></i></div>'
      + '      <div>'
      + '        <div style="font-size:10px;font-weight:800;letter-spacing:0.12em;color:#a78bfa;text-transform:uppercase;">AI COACH</div>'
      + '        <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);">Ask anything about your credit</div>'
      + '      </div>'
      + '    </div>'
      + '    <div style="font-size:12px;color:var(--ink-dim,#94a3b8);margin-bottom:12px;line-height:1.5;">Personalized to your debts, balances, and bureau scores. Tap a question to start.</div>'
      + '    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">'
      +        coachPrompts.map(function (p, i) { return '<button class="wjp-cs-coach-q" data-q="' + escHtml(p.q) + '" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--card-2,rgba(255,255,255,0.04));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:10px;color:var(--ink,#0a0a0a);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left;transition:transform 0.15s,border-color 0.15s;"><span style="font-size:16px;">' + p.icon + '</span><span>' + escHtml(p.q) + '</span></button>'; }).join('')
      + '    </div>'
      + '  </div>'
      // ── INSIGHT ─────────────────────────────────────────────────────
      + '  <div style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start;">'
      + '    <div style="font-size:24px;flex-shrink:0;">' + insight.icon + '</div>'
      + '    <div style="flex:1;">'
      + '      <div style="font-size:9px;font-weight:800;letter-spacing:0.12em;color:var(--accent,#22c55e);text-transform:uppercase;">TODAY\'S INSIGHT</div>'
      + '      <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin:2px 0 4px;">' + escHtml(insight.title) + '</div>'
      + '      <div style="font-size:12px;color:var(--ink-dim,#94a3b8);line-height:1.5;">' + escHtml(insight.body) + '</div>'
      + '    </div>'
      + '  </div>'
      // ── PER-CARD ────────────────────────────────────────────────────
      + (u.perCard.length ? (
          '<div style="background:var(--card,rgba(255,255,255,0.02));border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:18px;padding:20px 22px;">'
        + '  <div style="font-size:14px;font-weight:800;color:var(--ink,#0a0a0a);margin-bottom:12px;">Card-by-card utilization</div>'
        + '  <div style="display:flex;flex-direction:column;gap:8px;">'
        +    u.perCard.map(function (c) {
              if (c.util == null) return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px dashed var(--border,rgba(255,255,255,0.10));border-radius:8px;"><div style="font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);">' + escHtml(c.name) + '</div><div style="font-size:11px;color:#fbbf24;font-weight:700;">no limit set</div></div>';
              var p = Math.round(c.util * 100);
              var co = p < 10 ? '#22c55e' : p < 30 ? '#84cc16' : p < 50 ? '#fbbf24' : p < 80 ? '#f97316' : '#ef4444';
              return '<div style="padding:8px 10px;border:1px solid var(--border,rgba(255,255,255,0.10));border-radius:8px;">'
                   + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;"><div style="font-size:13px;font-weight:700;color:var(--ink,#0a0a0a);">' + escHtml(c.name) + '</div><div style="font-size:12px;color:' + co + ';font-weight:800;">' + p + '%</div></div>'
                   + '<div style="font-size:10px;color:var(--ink-dim,#94a3b8);font-weight:600;margin-bottom:4px;">' + fmtUSD(c.balance) + ' of ' + fmtUSD(c.limit) + '</div>'
                   + '<div style="height:6px;background:var(--card-2,rgba(255,255,255,0.06));border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + Math.min(100, p) + '%;background:' + co + ';transition:width 1s;"></div></div>'
                   + '</div>';
            }).join('')
        + '  </div>'
        + '</div>'
        ) : '')
      + '</div>';

      var existing = document.getElementById(WRAP_ID);
      if (existing) {
        // Preserve scroll + don't redraw if simulator is being interacted with
        if (existing._simInteracting) return;
        existing.outerHTML = html;
      } else {
        var div = document.createElement('div');
        div.innerHTML = html;
        if (host.firstChild) host.insertBefore(div.firstChild, host.firstChild);
        else host.appendChild(div.firstChild);
      }

      wireSimulator();
      wireCoach();
      // Render mini history chart after DOM is in
      requestAnimationFrame(function () {
        var canvas = document.getElementById('wjp-cs-history-chart');
        renderHistoryChart(canvas, getHistory());
      });
    } catch (e) { try { console.warn('[wjp-credit-overhaul v2] threw', e); } catch (_) {} }
  }

  function wireSimulator() {
    var pay = document.getElementById('wjp-cs-sim-paydown');
    var newC = document.getElementById('wjp-cs-sim-newcard');
    var closeC = document.getElementById('wjp-cs-sim-closecard');
    var payVal = document.getElementById('wjp-cs-sim-paydown-val');
    var deltaEl = document.getElementById('wjp-cs-sim-delta');
    var detailEl = document.getElementById('wjp-cs-sim-detail');
    var wrap = document.getElementById(WRAP_ID);
    if (!pay || !deltaEl) return;
    function update() {
      if (wrap) wrap._simInteracting = true;
      var amt = parseFloat(pay.value) || 0;
      payVal.textContent = '$' + Math.round(amt).toLocaleString();
      var delta = estimateScoreShift({
        paydownAmt: amt,
        newCard: newC && newC.checked,
        closeCard: closeC && closeC.checked
      });
      var sign = delta >= 0 ? '+' : '';
      deltaEl.textContent = sign + delta;
      deltaEl.style.color = delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : 'var(--ink-dim,#94a3b8)';
      var parts = [];
      if (amt > 0) parts.push('paying down $' + Math.round(amt).toLocaleString());
      if (newC && newC.checked) parts.push('opening a new card');
      if (closeC && closeC.checked) parts.push('closing oldest card');
      detailEl.textContent = parts.length ? 'Estimated impact of ' + parts.join(', ') + '.' : 'Adjust sliders above to see impact.';
      // Allow re-renders again after debounce
      clearTimeout(wrap._simReleaseTimer);
      wrap._simReleaseTimer = setTimeout(function () { if (wrap) wrap._simInteracting = false; }, 1500);
    }
    pay.addEventListener('input', update);
    if (newC) newC.addEventListener('change', update);
    if (closeC) closeC.addEventListener('change', update);
  }

  function wireCoach() {
    document.querySelectorAll('.wjp-cs-coach-q').forEach(function (btn) {
      btn.addEventListener('mouseenter', function () { btn.style.transform = 'translateX(2px)'; btn.style.borderColor = '#a78bfa'; });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; btn.style.borderColor = 'var(--border,rgba(255,255,255,0.10))'; });
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-q');
        if (q) askCoach(q);
      });
    });
  }

  function whenReady(fn) {
    function ready() { try { return typeof appState !== 'undefined' && appState && Array.isArray(appState.debts); } catch (_) { return false; } }
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
      setInterval(render, 5000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 700); });
  } else {
    setTimeout(boot, 700);
  }

  window.WJP_CreditOverhaul = { render: render, computeUtilization: computeUtilization, estimateScoreShift: estimateScoreShift };
})();
