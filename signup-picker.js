/* signup-picker.js — Plan picker logic for /signup.
 *
 * Wires the tier (Free/Pro/Pro Plus) + cycle (Monthly/Yearly) cards on the
 * signup page, reads ?tier= and ?cycle= URL params from /pricing CTAs, and
 * intercepts form submit to route through Stripe Checkout for card collection.
 *
 * Path-guarded to /signup* only. IIFE + idempotent.
 *
 * Public state: window.WJP_SIGNUP_INTENT = { tier, cycle, lookupKey() }
 */
(function () {
  'use strict';
  if (window._wjpSignupPickerInstalled) return;
  window._wjpSignupPickerInstalled = true;

  // Path guard
  try {
    var p = (location.pathname || '/').toLowerCase();
    if (p.indexOf('/signup') === -1) return;
  } catch (_) { return; }

  var planState = { tier: 'pro', cycle: 'monthly' };

  // Read URL params
  try {
    var url = new URL(window.location.href);
    var t = (url.searchParams.get('tier') || '').toLowerCase();
    var c = (url.searchParams.get('cycle') || '').toLowerCase();
    if (['free', 'pro', 'plus'].indexOf(t) !== -1) planState.tier = t;
    if (['monthly', 'yearly'].indexOf(c) !== -1) planState.cycle = c;
  } catch (_) {}

  var PLAN_PRICES = {
    free:  { monthly: '$0',          yearly: '$0' },
    pro:   { monthly: '$11.99/mo',   yearly: '$99/yr ($8.25/mo)' },
    plus:  { monthly: '$24.99/mo',   yearly: '$199/yr ($16.58/mo)' }
  };

  function planLookupKey() {
    if (planState.tier === 'free') return null;
    return planState.tier + '_' + planState.cycle;
  }

  function applyState() {
    document.querySelectorAll('.pp-tier').forEach(function (el) {
      var isSel = el.dataset.tier === planState.tier;
      el.classList.toggle('selected', isSel);
      el.setAttribute('aria-checked', isSel ? 'true' : 'false');
      var priceEl = el.querySelector('.pp-tier-cost');
      var tier = el.dataset.tier;
      if (priceEl && PLAN_PRICES[tier]) {
        priceEl.textContent = PLAN_PRICES[tier][planState.cycle] || PLAN_PRICES[tier].monthly;
      }
    });
    document.querySelectorAll('.pp-cycle-btn').forEach(function (b) {
      var isSel = b.dataset.cycle === planState.cycle;
      b.classList.toggle('active', isSel);
      b.setAttribute('aria-checked', isSel ? 'true' : 'false');
    });
    var toggle = document.querySelector('.pp-cycle-toggle');
    if (toggle) toggle.classList.toggle('disabled', planState.tier === 'free');

    var btn = document.getElementById('submit-btn');
    if (btn && !btn.disabled) {
      btn.textContent = planState.tier === 'free'
        ? 'Start free trial →'
        : 'Continue to checkout →';
    }
  }

  function bindPickerCards() {
    document.querySelectorAll('.pp-tier').forEach(function (el) {
      if (el._wjpBound) return;
      el._wjpBound = true;
      el.addEventListener('click', function () { planState.tier = el.dataset.tier; applyState(); });
      el.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          planState.tier = el.dataset.tier;
          applyState();
        }
      });
    });
    document.querySelectorAll('.pp-cycle-btn').forEach(function (b) {
      if (b._wjpBound) return;
      b._wjpBound = true;
      b.addEventListener('click', function () {
        if (planState.tier === 'free') return;
        planState.cycle = b.dataset.cycle;
        applyState();
      });
    });
  }

  // Persist intent to localStorage at every state change so post-signup flow can read it
  function persist() {
    try {
      localStorage.setItem('wjp_intended_tier', planState.tier);
      localStorage.setItem('wjp_intended_cycle', planState.cycle);
    } catch (_) {}
  }

  // Patch window.location.replace to intercept post-signup redirects.
  // The existing inline submit handler calls window.location.replace('./verify.html')
  // (or './index.html?new=1' for Google). We want to intercept those and push the
  // user through Stripe Checkout first.
  function installRedirectInterceptor() {
    var origReplace = window.location.replace.bind(window.location);
    var origAssign = window.location.assign.bind(window.location);
    var routed = false;

    function intercept(targetUrl) {
      if (routed) return false;
      try {
        var s = String(targetUrl || '');
        // Only intercept post-signup redirects
        var isVerify = /verify\.html/.test(s);
        var isNewIndex = /index\.html\?new=1/.test(s);
        if (!isVerify && !isNewIndex) return false;
        // Need an authed Firebase user to call Checkout backend
        var auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
        var user = auth && auth.currentUser;
        if (!user) {
          // Try to wait briefly for auth
          var attempts = 0;
          var iv = setInterval(function () {
            attempts++;
            var u = auth && auth.currentUser;
            if (u || attempts > 20) {
              clearInterval(iv);
              if (u) doCheckout(u, s);
              else origReplace.call(window.location, s); // fall through if no user
            }
          }, 200);
          return true;
        }
        doCheckout(user, s);
        return true;
      } catch (_) { return false; }
    }

    function doCheckout(user, fallback) {
      routed = true;
      persist();
      var lookupKey = planLookupKey() || 'free_setup';
      user.getIdToken().then(function (idToken) {
        return fetch('/.netlify/functions/stripe-checkout-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
          body: JSON.stringify({
            lookup_key: lookupKey,
            success_path: '/verify.html',
            cancel_path: '/signup.html'
          })
        });
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      }).then(function (r) {
        if (r.ok && r.data && r.data.url) {
          window.location.href = r.data.url;
        } else {
          console.warn('[signup-picker] checkout failed, falling back to', fallback, r);
          origReplace.call(window.location, fallback);
        }
      }).catch(function (e) {
        console.warn('[signup-picker] checkout exception', e);
        origReplace.call(window.location, fallback);
      });
    }

    window.location.replace = function (url) {
      if (intercept(url)) return;
      origReplace.call(window.location, url);
    };
    window.location.assign = function (url) {
      if (intercept(url)) return;
      origAssign.call(window.location, url);
    };
  }

  // Boot — wait for picker DOM to be available
  function boot() {
    bindPickerCards();
    applyState();
    persist();
    installRedirectInterceptor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 50);
  }

  // Public API
  window.WJP_SIGNUP_INTENT = {
    get tier() { return planState.tier; },
    get cycle() { return planState.cycle; },
    lookupKey: planLookupKey
  };
})();
