/* wjp-credit-profile-stable.js v1 — eliminates the dashboard credit card
 * flicker by deduping rapid updateCreditProfile() calls via a state hash.
 *
 * Root cause of flicker: the host calls updateCreditProfile() inside a generic
 * dashboard update loop AND from many individual handlers. Each call does
 * `card.innerHTML = …` which wipes and rebuilds DOM — visibly flashes even
 * when the underlying data hasn't changed.
 *
 * Fix: wrap window.updateCreditProfile so it computes a hash of the inputs
 * (score, bureau, card balances, limits) and skips the rebuild when the hash
 * is unchanged from the previous call. Tiny CSS transition smooths the
 * occasional real change.
 */
(function () {
  'use strict';
  if (window._wjpCreditProfileStableInstalled) return;
  window._wjpCreditProfileStableInstalled = true;
  if (location.pathname && location.pathname !== '/' && !/index\.html?$/.test(location.pathname)) return;

  var lastHash = null;
  var lastRunTs = 0;
  var debounceMs = 250;

  function computeHash() {
    try {
      var cs = JSON.parse(localStorage.getItem('wjp_credit_inputs') || '{}');
      var bureau = JSON.parse(localStorage.getItem('wjp_credit_bureau') || '{}');
      var debts = (typeof appState !== 'undefined' && appState && appState.debts) || [];
      var parts = [
        cs.currentScore || '',
        bureau.lastScore || '',
        bureau.provider || '',
        cs.latePayments12mo || 0,
        cs.oldestAccountYears || 0,
        cs.hardInquiries12mo || 0,
        cs.newAccounts12mo || 0
      ];
      // Card balance + limit pairs
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
      '#credit-profile-card { transition: opacity 0.18s ease; }'
    + '#credit-profile-card.wjp-cp-fading { opacity: 0.65; }';
    document.head.appendChild(style);
  }

  function patchUpdateCreditProfile() {
    if (typeof window.updateCreditProfile !== 'function') return false;
    if (window.updateCreditProfile.__wjpStableWrapped) return true;
    var orig = window.updateCreditProfile;
    var wrapped = function () {
      try {
        var now = Date.now();
        var hash = computeHash();
        // Dedup: same hash AND we ran recently → skip entirely
        if (hash === lastHash) return;
        // Throttle: if we ran < debounceMs ago AND the hash actually changed,
        // still run but with a soft fade transition to mask the redraw.
        var card = document.getElementById('credit-profile-card');
        if (card) card.classList.add('wjp-cp-fading');
        try {
          var result = orig.apply(this, arguments);
          lastHash = hash;
          lastRunTs = now;
          return result;
        } finally {
          // Drop the fade after a frame so the rebuilt content fades back in
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { if (card) card.classList.remove('wjp-cp-fading'); });
          });
        }
      } catch (e) {
        try { console.warn('[wjp-credit-profile-stable] wrap threw', e); } catch (_) {}
        return orig.apply(this, arguments);
      }
    };
    wrapped.__wjpStableWrapped = true;
    window.updateCreditProfile = wrapped;
    return true;
  }

  function boot() {
    injectFadeCss();
    // Try patching now and re-try periodically until success
    if (!patchUpdateCreditProfile()) {
      var tries = 0;
      var iv = setInterval(function () {
        if (patchUpdateCreditProfile()) clearInterval(iv);
        else if (++tries > 60) clearInterval(iv);
      }, 400);
    }
    // Re-patch periodically in case host reassigns the function
    setInterval(patchUpdateCreditProfile, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  window.WJP_CreditProfileStable = { hash: computeHash, repatch: patchUpdateCreditProfile };
})();
