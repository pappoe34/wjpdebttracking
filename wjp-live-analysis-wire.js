/* wjp-live-analysis-wire.js v2 — make Live Analysis interactive AND embed the
 * actual computed values in the AI Coach prompt so the coach can analyze
 * instead of asking for the report.
 */
(function () {
  'use strict';
  if (window._wjpLiveAnalysisWireInstalled) return;
  window._wjpLiveAnalysisWireInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  function fmtUSD(n) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0); }

  function loadCS() { try { return JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}'); } catch (_) { return {}; } }
  function loadBureau() { try { return JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}'); } catch (_) { return {}; } }
  function getDebts() { try { return (typeof appState !== 'undefined' && appState && appState.debts) || []; } catch (_) { return []; } }
  function isCreditCard(d) { var t = String(d.type || d.category || '').toLowerCase(); return /credit/.test(t) || /\bcard\b/.test(t) || t === 'cc'; }

  // Pull the live analysis snapshot from BOTH state and the rendered DOM so
  // the AI gets the same numbers the user sees.
  function collectAnalysisContext() {
    var cs = loadCS();
    var bureau = loadBureau();
    var debts = getDebts();
    var ctx = {
      currentScore: bureau.lastScore || cs.currentScore || null,
      latePayments12mo: cs.latePayments12mo || 0,
      oldestAccountYears: cs.oldestAccountYears || 0,
      hardInquiries12mo: cs.hardInquiries12mo || 0,
      newAccounts12mo: cs.newAccounts12mo || 0,
      bureauScores: cs.bureauScores || {},
      derogatoryMarks: cs.derogatoryMarks
    };

    // Utilization
    var cards = debts.filter(isCreditCard);
    var totBal = 0, totLim = 0;
    var perCard = [];
    cards.forEach(function (d) {
      var lim = parseFloat((cs.cardLimits || {})[d.id] || d.limit || 0);
      var bal = parseFloat(d.balance || 0);
      if (lim > 0) { totBal += bal; totLim += lim; }
      perCard.push({ name: d.name, balance: bal, limit: lim, util: lim > 0 ? Math.round((bal/lim)*100) : null });
    });
    ctx.totalBalance = totBal;
    ctx.totalLimit = totLim;
    ctx.utilizationPct = totLim > 0 ? Math.round((totBal / totLim) * 100) : null;
    ctx.cardCount = cards.length;
    ctx.loanCount = debts.length - cards.length;
    ctx.perCard = perCard;

    // Pull projection numbers + AI verdict + plan items from the rendered DOM
    var cst = document.getElementById('credit-score-tab-content');
    if (cst) {
      // Find the LIVE ANALYSIS hero card
      var badges = cst.querySelectorAll('.badge');
      for (var i = 0; i < badges.length; i++) {
        if ((badges[i].textContent || '').trim().toUpperCase() === 'LIVE ANALYSIS') {
          var card = badges[i].closest('.card');
          if (card) {
            // Grab projection tiles (+3 / +6 / +12 months)
            var tiles = card.querySelectorAll('div');
            var projections = [];
            tiles.forEach(function (el) {
              var t = (el.textContent || '').trim();
              var m = t.match(/^\+(\d+)\s*months?\b/i);
              if (m && el.children.length >= 2 && el.children.length <= 5) {
                var scoreM = t.match(/\b(\d{3})\b/);
                var ptsM = t.match(/\+(\d+)\s*pts/i);
                if (scoreM) projections.push({ months: parseInt(m[1], 10), projectedScore: parseInt(scoreM[1], 10), pointsGain: ptsM ? parseInt(ptsM[1], 10) : null });
              }
            });
            // Dedup nested
            ctx.projections = projections.filter(function (p, i) {
              for (var j = 0; j < i; j++) if (projections[j].months === p.months) return false;
              return true;
            });

            // AI Verdict heading
            var h2 = card.querySelector('h2');
            if (h2) ctx.aiVerdict = (h2.textContent || '').trim();
          }
          break;
        }
      }

      // Plan items — find the AI ACTION PLAN card
      var planBadges = cst.querySelectorAll('.badge');
      for (var k = 0; k < planBadges.length; k++) {
        var bt = (planBadges[k].textContent || '').trim().toUpperCase();
        if (bt.indexOf('AI ACTION PLAN') === 0 || bt.indexOf('ACTION PLAN') !== -1) {
          var planCard = planBadges[k].closest('.card');
          if (planCard) {
            var planItems = [];
            planCard.querySelectorAll('div').forEach(function (el) {
              var titleEl = el.querySelector('div[style*="font-weight:800"]');
              var ptsEl = el.querySelector('span[style*="background:rgba(31,122,74,0.08)"]');
              if (titleEl && ptsEl) {
                var titleText = (titleEl.textContent || '').trim();
                var ptsText = (ptsEl.textContent || '').trim();
                if (titleText && /^\+/.test(ptsText)) {
                  // Avoid pulling nested duplicates
                  if (!planItems.find(function (p) { return p.title === titleText; })) {
                    planItems.push({ title: titleText, pts: ptsText });
                  }
                }
              }
            });
            if (planItems.length) ctx.actionPlan = planItems.slice(0, 8);
          }
          break;
        }
      }

      // Factor breakdown
      var factorBadges = cst.querySelectorAll('.badge');
      for (var f = 0; f < factorBadges.length; f++) {
        var ft = (factorBadges[f].textContent || '').trim().toUpperCase();
        if (ft.indexOf('FICO FACTOR') !== -1 || ft.indexOf('FACTOR BREAKDOWN') !== -1) {
          var fc = factorBadges[f].closest('.card');
          if (fc) {
            var factors = [];
            fc.querySelectorAll('div[style*="background:var(--card-2)"]').forEach(function (block) {
              var nameSpan = block.querySelector('span[style*="font-weight:800"]');
              var pctSpan  = block.querySelector('div[style*="font-weight:800"][style*="text-transform:uppercase"]');
              if (nameSpan) {
                factors.push({ name: (nameSpan.textContent || '').trim(), rating: pctSpan ? (pctSpan.textContent || '').trim() : '' });
              }
            });
            if (factors.length) ctx.factors = factors.slice(0, 6);
          }
          break;
        }
      }
    }

    return ctx;
  }

  function buildPromptForContext(prefix, ctx) {
    var lines = [];
    lines.push(prefix.trim());
    lines.push('');
    lines.push('Here is my live data:');
    if (ctx.currentScore) lines.push('- Current FICO score: ' + ctx.currentScore);
    if (Object.keys(ctx.bureauScores || {}).length) {
      var bs = Object.keys(ctx.bureauScores).map(function (k) { return k + ' ' + (ctx.bureauScores[k].value || ctx.bureauScores[k]); }).join(', ');
      lines.push('- Bureau scores: ' + bs);
    }
    if (ctx.utilizationPct != null) lines.push('- Total credit utilization: ' + ctx.utilizationPct + '% (' + fmtUSD(ctx.totalBalance) + ' of ' + fmtUSD(ctx.totalLimit) + ')');
    if (ctx.cardCount) lines.push('- ' + ctx.cardCount + ' credit card' + (ctx.cardCount === 1 ? '' : 's') + ', ' + ctx.loanCount + ' loan' + (ctx.loanCount === 1 ? '' : 's'));
    if (ctx.oldestAccountYears) lines.push('- Oldest account age: ' + ctx.oldestAccountYears + ' yrs');
    if (ctx.latePayments12mo != null) lines.push('- Late payments in last 12 mo: ' + ctx.latePayments12mo);
    if (ctx.hardInquiries12mo != null) lines.push('- Hard inquiries in last 12 mo: ' + ctx.hardInquiries12mo);
    if (ctx.newAccounts12mo != null) lines.push('- New accounts in last 12 mo: ' + ctx.newAccounts12mo);
    if (ctx.derogatoryMarks != null) lines.push('- Derogatory marks: ' + ctx.derogatoryMarks);

    if (ctx.perCard && ctx.perCard.length) {
      lines.push('');
      lines.push('Per-card utilization:');
      ctx.perCard.forEach(function (c) {
        if (c.util != null) lines.push('  • ' + c.name + ' — ' + c.util + '% (' + fmtUSD(c.balance) + ' / ' + fmtUSD(c.limit) + ')');
        else lines.push('  • ' + c.name + ' — limit not set, balance ' + fmtUSD(c.balance));
      });
    }

    if (ctx.factors && ctx.factors.length) {
      lines.push('');
      lines.push('Factor breakdown (from FICO factor card):');
      ctx.factors.forEach(function (f) { lines.push('  • ' + f.name + ' — ' + f.rating); });
    }

    if (ctx.projections && ctx.projections.length) {
      lines.push('');
      lines.push('Projected scores (from Live Analysis card):');
      ctx.projections.forEach(function (p) {
        lines.push('  • +' + p.months + ' months: ' + p.projectedScore + (p.pointsGain != null ? ' (+' + p.pointsGain + ' pts)' : ''));
      });
    }

    if (ctx.aiVerdict) {
      lines.push('');
      lines.push('AI Verdict on the page: "' + ctx.aiVerdict + '"');
    }

    if (ctx.actionPlan && ctx.actionPlan.length) {
      lines.push('');
      lines.push('Ranked action plan from the page:');
      ctx.actionPlan.forEach(function (p, i) {
        lines.push('  ' + (i+1) + '. ' + p.title + ' — ' + p.pts);
      });
    }

    lines.push('');
    lines.push('Use ALL of this data to answer. Do NOT ask me for the report — you have it.');
    return lines.join('\n');
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

  function findHeroCard() {
    var cst = document.getElementById('credit-score-tab-content');
    if (!cst) return null;
    var badges = cst.querySelectorAll('.badge');
    for (var i = 0; i < badges.length; i++) {
      if ((badges[i].textContent || '').trim().toUpperCase() === 'LIVE ANALYSIS') {
        var card = badges[i].closest('.card');
        return card ? { card: card, badge: badges[i] } : null;
      }
    }
    return null;
  }

  function wire() {
    try {
      var hit = findHeroCard();
      if (!hit) return;
      var card = hit.card;
      if (card._wjpLiveAnalysisWired) return;
      card._wjpLiveAnalysisWired = true;

      hit.badge.style.cursor = 'pointer';
      hit.badge.style.transition = 'background 0.18s, color 0.18s';
      hit.badge.title = 'Click to ask AI Coach for a live analysis';
      hit.badge.addEventListener('click', function (e) {
        e.stopPropagation();
        var ctx = collectAnalysisContext();
        var prompt = buildPromptForContext(
          'You are my AI credit coach. Do a full Live Analysis: explain my current score, what factors are pulling it down, what\'s working, and what to do FIRST. Use my real numbers and tie each recommendation to a point estimate. Keep it tight — bullet form, no preamble.',
          ctx
        );
        askCoach(prompt);
      });
      hit.badge.addEventListener('mouseenter', function () {
        hit.badge.style.background = 'rgba(167,139,250,0.15)';
        hit.badge.style.color = '#a78bfa';
        hit.badge.style.borderColor = '#a78bfa';
      });
      hit.badge.addEventListener('mouseleave', function () {
        hit.badge.style.background = 'transparent';
        hit.badge.style.color = '';
        hit.badge.style.borderColor = '';
      });

      // Projection tiles
      var tiles = card.querySelectorAll('div');
      var projTiles = [];
      tiles.forEach(function (el) {
        var t = (el.textContent || '').trim().toLowerCase();
        if (/^\+\d+\s*months?\b/.test(t) && /\d{3}/.test(t) && el.children.length >= 2 && el.children.length <= 5) {
          projTiles.push(el);
        }
      });
      projTiles = projTiles.filter(function (el, i) {
        for (var j = 0; j < i; j++) if (projTiles[j].contains(el)) return false;
        return true;
      });
      projTiles.forEach(function (tile) {
        var label = (tile.textContent || '').match(/\+(\d+)\s*months?/i);
        var months = label ? label[1] : '?';
        tile.style.cursor = 'pointer';
        tile.style.transition = 'transform 0.15s, border-color 0.15s, background 0.15s';
        tile.title = 'Click to see what produces this projection';
        tile.addEventListener('mouseenter', function () { tile.style.transform = 'translateY(-2px)'; tile.style.borderColor = '#a78bfa'; });
        tile.addEventListener('mouseleave', function () { tile.style.transform = ''; tile.style.borderColor = ''; });
        tile.addEventListener('click', function () {
          var ctx = collectAnalysisContext();
          var prompt = buildPromptForContext(
            'My ' + months + '-month projected score is shown on the Live Analysis card. Walk me through EXACTLY which actions on the ranked plan contribute to that ' + months + '-month projection, in priority order, with point estimates per action. Tie each one to a specific debt or behavior change. Use my real numbers.',
            ctx
          );
          askCoach(prompt);
        });
      });

      // AI Verdict heading
      var verdict = card.querySelector('h2');
      if (verdict) {
        verdict.style.cursor = 'pointer';
        verdict.title = 'Click to ask AI Coach to break this down';
        verdict.addEventListener('click', function () {
          var ctx = collectAnalysisContext();
          var prompt = buildPromptForContext(
            'Break down the AI Verdict shown on my Live Analysis page in plain English. Why is this projection realistic? What assumptions does it make about my behavior? What could derail it? Tie it to my actual numbers.',
            ctx
          );
          askCoach(prompt);
        });
      }
    } catch (_) {}
  }

  function boot() { setInterval(wire, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);

  window.WJP_LiveAnalysisWire = { collectContext: collectAnalysisContext, buildPrompt: buildPromptForContext };
})();
