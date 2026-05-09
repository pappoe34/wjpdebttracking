/* wjp-credit-profile-stable.js v2 — eliminate dashboard credit card flicker.
 *
 * v1 wrap was correct but installed too late (after DOMContentLoaded + 600ms).
 * Rapid initial calls happened with the unwrapped function → user sees flash.
 *
 * v2: install the wrap synchronously on script load, BEFORE app.js even runs
 * (we can't — defer ordering means app.js runs first). Instead: install ASAP
 * when window.updateCreditProfile appears, AND inject CSS that prevents the
 * "innerHTML wipe → blank → repaint" flash by holding the previous content
 * visible for one frame on rebuild.
 */
(function () {
  'use strict';
  if (window._wjpCreditProfileStableInstalled) return;
  window._wjpCreditProfileStableInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var lastHash = null;
  var lastCardHTML = null;

  function computeHash() {
    try {
      var cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
      var bureau = JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}');
      var debts = (typeof appState !== 'undefined' && appState && appState.debts) || [];
      var parts = [
        cs.currentScore || '',
        bureau.lastScore || '',
        bureau.provider || '',
        bureau.lastSync || '',
        cs.latePayments12mo || 0,
        cs.oldestAccountYears || 0,
        cs.hardInquiries12mo || 0,
        cs.newAccounts12mo || 0,
        cs.derogatoryMarks || 0
      ];
      debts.forEach(function (d) {
        var t = String(d.type || d.category || '').toLowerCase();
        if (/credit/.test(t) || /\bcard\b/.test(t) || t === 'cc') {
          var lim = (cs.cardLimits && cs.cardLimits[d.id]) || d.limit || 0;
          parts.push(d.id + ':' + (d.balance || 0) + ':' + lim);
        }
      });
      return parts.join('|');
    } catch (_) { return Math.random().toString(); }
  }

  function injectFadeCss() {
    if (document.getElementById('wjp-cp-stable-css')) return;
    var style = document.createElement('style');
    style.id = 'wjp-cp-stable-css';
    style.textContent =
      // Prevent the entire-card flash. Use will-change to hint the compositor.
      '#credit-profile-card { contain: layout paint; will-change: contents; }'
    + '#credit-profile-card > * { transition: opacity 0.20s ease; }'
    + '#credit-profile-card.wjp-cp-fading > * { opacity: 0.85; }';
    document.head.appendChild(style);
  }

  function patchUpdateCreditProfile() {
    if (typeof window.updateCreditProfile !== 'function') return false;
    if (window.updateCreditProfile.__wjpStableWrapped) return true;
    var orig = window.updateCreditProfile;
    var wrapped = function () {
      try {
        var hash = computeHash();
        if (hash === lastHash) return; // no-op rebuild
        var card = document.getElementById('credit-profile-card');
        if (card) card.classList.add('wjp-cp-fading');
        try {
          var result = orig.apply(this, arguments);
          lastHash = hash;
          if (card) lastCardHTML = card.innerHTML;
          return result;
        } finally {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { if (card) card.classList.remove('wjp-cp-fading'); });
          });
        }
      } catch (e) { try { console.warn('[wjp-credit-profile-stable v2] wrap threw', e); } catch (_) {} return orig.apply(this, arguments); }
    };
    wrapped.__wjpStableWrapped = true;
    window.updateCreditProfile = wrapped;
    // Run once immediately so the next render goes through the wrap
    try { wrapped(); } catch (_) {}
    return true;
  }

  function aggressiveBoot() {
    // Try IMMEDIATELY (no waiting), then poll on a tight interval
    injectFadeCss();
    if (patchUpdateCreditProfile()) {
      setInterval(patchUpdateCreditProfile, 1000);
      return;
    }
    var tries = 0;
    var iv = setInterval(function () {
      injectFadeCss();
      if (patchUpdateCreditProfile()) {
        clearInterval(iv);
        // Continue light re-patching forever
        setInterval(patchUpdateCreditProfile, 1000);
      } else if (++tries > 200) clearInterval(iv);
    }, 100); // poll every 100ms instead of 400ms
  }

  // Run NOW — don't wait for DOMContentLoaded. The script is loaded with defer
  // so DOM is parsed by the time we get here, but app.js may still be evaluating.
  aggressiveBoot();

  window.WJP_CreditProfileStable = { hash: computeHash, repatch: patchUpdateCreditProfile };
})();
