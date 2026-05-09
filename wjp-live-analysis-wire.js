/* wjp-live-analysis-wire.js v1 — make the existing "Live Analysis" hero
 * card on the Credit Score tab clickable.
 *
 * Existing card has the LIVE ANALYSIS badge + Current Score + 3 projection
 * tiles (+3 / +6 / +12 months) + AI Verdict text. None of these are clickable.
 * This module adds:
 *   - Hover state + cursor:pointer on each projection tile
 *   - Click projection tile → opens AI Coach asking what produces that
 *     specific projected score
 *   - Click LIVE ANALYSIS badge → opens AI Coach with a "Explain my analysis"
 *     prompt
 *   - Click AI Verdict heading → opens AI Coach asking for a plain-English
 *     breakdown of the verdict
 */
(function () {
  'use strict';
  if (window._wjpLiveAnalysisWireInstalled) return;
  window._wjpLiveAnalysisWireInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

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
    // Find the badge that says "LIVE ANALYSIS"
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

      // Make the LIVE ANALYSIS badge clickable
      hit.badge.style.cursor = 'pointer';
      hit.badge.style.transition = 'background 0.18s, color 0.18s';
      hit.badge.title = 'Click to ask AI Coach about this analysis';
      hit.badge.addEventListener('click', function (e) {
        e.stopPropagation();
        askCoach('Walk me through my Live Analysis on the Credit Score tab. What does the engine actually use to produce my current score, factor breakdown, and projected scores? Explain in plain English using my real numbers.');
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

      // Find projection tiles by searching for "+3 months" / "+6 months" / "+12 months"
      var tiles = card.querySelectorAll('div');
      var projTiles = [];
      tiles.forEach(function (el) {
        var t = (el.textContent || '').trim().toLowerCase();
        // Match the small "+N months" tiles by looking for the eyebrow text + a 3-digit number
        if (/^\+\d+\s*months?\b/.test(t) && /\d{3}/.test(t) && el.children.length >= 2 && el.children.length <= 5) {
          projTiles.push(el);
        }
      });
      // Dedup nested tiles
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
        tile.addEventListener('mouseenter', function () {
          tile.style.transform = 'translateY(-2px)';
          tile.style.borderColor = '#a78bfa';
        });
        tile.addEventListener('mouseleave', function () {
          tile.style.transform = '';
          tile.style.borderColor = '';
        });
        tile.addEventListener('click', function () {
          askCoach('My Live Analysis says I can hit a higher score in ' + months + ' months. Walk me through exactly which actions on the ranked plan contribute most to that ' + months + '-month projection, with point estimates per action.');
        });
      });

      // Find the AI Verdict heading
      var verdict = card.querySelector('h2');
      if (verdict) {
        verdict.style.cursor = 'pointer';
        verdict.title = 'Click to ask AI Coach to break this down';
        verdict.addEventListener('click', function () {
          askCoach('Break down my AI verdict in plain English. Why is this projection realistic? What are the assumptions? What could derail it?');
        });
      }
    } catch (_) {}
  }

  function boot() {
    setInterval(wire, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
  } else {
    setTimeout(boot, 800);
  }
})();
