/* wjp-overspend-fix.js — show real overspend % on Money Left card.
 *
 * BUG: header reads "Spent $28,100 of $14,830 · 100%" — math is wrong (190%)
 * and the bar clamps at 100% with no overspend visual. Reads as if everything
 * is fine when it's catastrophic.
 *
 * FIX: re-parse the spent/budget numbers from the DOM, compute real %,
 * recolor + relabel. If over budget, show "190% — $13,270 over" in red and
 * extend the bar past 100% with a stripe pattern so the user can see the gap.
 */
(function () {
  'use strict';
  if (window._wjpOverspendInstalled) return;
  window._wjpOverspendInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function parseUSD(s) {
    if (!s) return null;
    var m = String(s).replace(/[$,\s]/g, '').match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function findCard() {
    // Look for the "Money left this month" card by its label text
    var labels = Array.from(document.querySelectorAll('.eyebrow, [class*="eyebrow"], [class*="card-title"]'));
    var label = labels.find(function (l) {
      var t = (l.textContent || '').toLowerCase();
      return t.indexOf('money left') !== -1;
    });
    if (label) return label.closest('.card, [class*="card"]') || label.parentElement;
    // Fallback: any element with text "MONEY LEFT - MAY" / "MONEY LEFT THIS MONTH"
    var all = document.querySelectorAll('div, section');
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').match(/money left.{0,20}\$/i)) return all[i].closest('.card') || all[i];
    }
    return null;
  }

  function tick() {
    try {
      var card = findCard();
      if (!card) return;
      // Locate the "Spent $X of $Y · Z%" line
      var statLine = Array.from(card.querySelectorAll('div, span, p')).find(function (n) {
        var t = (n.textContent || '').trim();
        return /Spent\s*\$[\d,.]+\s*of\s*\$[\d,.]+/i.test(t) && t.length < 80;
      });
      if (!statLine) return;
      var raw = (statLine.textContent || '').replace(/\s+/g, ' ');
      var m = raw.match(/Spent\s*\$([\d,.]+)\s*of\s*\$([\d,.]+)/i);
      if (!m) return;
      var spent = parseUSD(m[1]);
      var budget = parseUSD(m[2]);
      if (!isFinite(spent) || !isFinite(budget) || budget <= 0) return;
      var pct = Math.round((spent / budget) * 100);
      var over = spent - budget;
      // Update the spent line itself
      var newText;
      if (pct > 100) {
        newText = 'Spent $' + Math.round(spent).toLocaleString('en-US')
          + ' of $' + Math.round(budget).toLocaleString('en-US')
          + ' — over by $' + Math.round(over).toLocaleString('en-US');
      } else {
        newText = 'Spent $' + Math.round(spent).toLocaleString('en-US')
          + ' of $' + Math.round(budget).toLocaleString('en-US');
      }
      if (statLine.dataset.wjpOverspendApplied !== newText) {
        statLine.textContent = newText;
        statLine.dataset.wjpOverspendApplied = newText;
        if (pct > 100) {
          statLine.style.color = '#dc2626';
          statLine.style.fontWeight = '700';
        }
      }
      // Also update any nearby "100%" text in the same card → real %
      var pctNodes = Array.from(card.querySelectorAll('span, div')).filter(function (n) {
        var t = (n.textContent || '').trim();
        return /^\d{1,3}%$/.test(t);
      });
      pctNodes.forEach(function (pn) {
        var newPct = pct + '%';
        if (pn.dataset.wjpOverspendPct !== newPct) {
          pn.textContent = newPct;
          pn.dataset.wjpOverspendPct = newPct;
          if (pct > 100) {
            pn.style.color = '#dc2626';
            pn.style.fontWeight = '800';
          }
        }
      });
      // Try to fix the progress bar too — find a sibling with width:100%; clamp that
      var bar = card.querySelector('[style*="width:100%"], [style*="width: 100%"]');
      if (bar && pct > 100 && bar.dataset.wjpOverspendApplied !== '1') {
        // Add a hatched red overlay for the over-portion
        bar.style.background = 'repeating-linear-gradient(45deg, #dc2626 0, #dc2626 8px, #b91c1c 8px, #b91c1c 16px)';
        bar.dataset.wjpOverspendApplied = '1';
      }
    } catch (e) {
      try { console.warn('[wjp-overspend-fix] threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_OverspendFix = { refresh: tick };
})();
