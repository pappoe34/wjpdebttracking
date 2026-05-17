/* wjp-trial-banner.js v1 — Trial UI: welcome modal + persistent banner + warnings.
 *
 * Reads trial state from window.WJP_Trial (provided by wjp-trial-state.js).
 *
 * Surfaces:
 *   1. Welcome modal: first time we detect an active trial (gated by
 *      localStorage flag, shown once per user).
 *   2. Persistent top banner: "X days left in your Pro Plus trial — upgrade"
 *      Color escalates: green (>3d), yellow (D-3 / D-1), red (expired).
 *   3. Grace banner: "Trial ended. Bank connections will be removed in N days."
 *   4. Click banner → routes to billing.
 *
 * Safe: IIFE, idempotent, listens to wjp-trial-state events for live updates.
 */
(function () {
  'use strict';
  if (window._wjpTrialBannerInstalled) return;
  window._wjpTrialBannerInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-trial-banner-style';
  var BANNER_ID = 'wjp-trial-banner';
  var MODAL_ID = 'wjp-trial-welcome';
  var LS_WELCOME = 'wjp.trial.welcomeShown.v1';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BANNER_ID + ' {',
      '  position:fixed; top:0; left:0; right:0; z-index:9000;',
      '  display:flex; align-items:center; justify-content:center; gap:12px;',
      '  padding:9px 16px; font-family:Inter,system-ui,sans-serif;',
      '  font-size:12.5px; font-weight:600; cursor:pointer;',
      '  border-bottom:1px solid var(--border,rgba(0,0,0,0.08));',
      '  letter-spacing:0.01em; min-height:38px; box-sizing:border-box;',
      '  pointer-events:auto;',
      '}',
      'body.wjp-has-trial-banner { padding-top: 38px !important; }',
      '#' + BANNER_ID + '.green { background:linear-gradient(90deg, rgba(31,122,74,0.10) 0%, rgba(31,122,74,0.05) 100%); color:#1f7a4a; }',
      '#' + BANNER_ID + '.yellow { background:linear-gradient(90deg, rgba(161,98,7,0.12) 0%, rgba(161,98,7,0.06) 100%); color:#a16207; }',
      '#' + BANNER_ID + '.red { background:linear-gradient(90deg, rgba(192,89,74,0.14) 0%, rgba(192,89,74,0.07) 100%); color:#c0594a; }',
      '#' + BANNER_ID + ' .pill { font-size:10px; font-weight:800; letter-spacing:0.08em; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.65); }',
      'body.dark #' + BANNER_ID + '.green { background:linear-gradient(90deg, rgba(31,122,74,0.18) 0%, rgba(31,122,74,0.08) 100%); }',
      'body.dark #' + BANNER_ID + '.yellow { background:linear-gradient(90deg, rgba(161,98,7,0.20) 0%, rgba(161,98,7,0.10) 100%); }',
      'body.dark #' + BANNER_ID + '.red { background:linear-gradient(90deg, rgba(192,89,74,0.22) 0%, rgba(192,89,74,0.10) 100%); }',
      'body.dark #' + BANNER_ID + ' .pill { background:rgba(0,0,0,0.35); color:inherit; }',
      '#' + MODAL_ID + ' { position:fixed; inset:0; z-index:99998; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:20px; font-family:Inter,system-ui,sans-serif; }',
      '#' + MODAL_ID + ' .card { background:var(--card-bg,var(--bg-2,#fff)); color:var(--ink,var(--text-1,#0a0a0a)); border-radius:16px; padding:28px 28px 22px; width:100%; max-width:520px; box-shadow:0 30px 80px rgba(0,0,0,0.40); border:1px solid var(--border,rgba(0,0,0,0.10)); }',
      '#' + MODAL_ID + ' h2 { margin:0 0 6px; font-family:Fraunces,Georgia,serif; font-size:24px; letter-spacing:-0.02em; }',
      '#' + MODAL_ID + ' .sub { color:var(--ink-dim,var(--text-2,#6b7280)); font-size:13.5px; line-height:1.55; margin-bottom:18px; }',
      '#' + MODAL_ID + ' ul { margin:0 0 18px; padding-left:18px; font-size:13.5px; line-height:1.7; }',
      '#' + MODAL_ID + ' .btn-row { display:flex; gap:8px; justify-content:flex-end; }',
      '#' + MODAL_ID + ' .btn { border-radius:10px; padding:10px 18px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; }',
      '#' + MODAL_ID + ' .btn-primary { background:#1f7a4a; color:#fff; border:none; }',
      '#' + MODAL_ID + ' .btn-secondary { background:transparent; color:var(--ink,var(--text-1,#0a0a0a)); border:1px solid var(--border,rgba(0,0,0,0.18)); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function openBilling(e) {
    // Stop propagation so the document doesn't intercept the click
    if (e && e.preventDefault) { e.preventDefault(); }
    if (e && e.stopPropagation) { e.stopPropagation(); }
    try {
      // Preferred: the app's own SPA navigation function (handles state, tab switch, scroll)
      if (typeof window.navigateSPA === 'function') {
        window.navigateSPA('plans');
        return;
      }
      // Fallback chain
      if (typeof window.openBillingModal === 'function') return window.openBillingModal();
      if (typeof window.WJP_Billing === 'object' && window.WJP_Billing.open) return window.WJP_Billing.open();
      // Last resort — set hash + fire hashchange so the router picks it up
      location.hash = '#plans';
      try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {}
    } catch (e2) {
      try { location.hash = '#plans'; } catch (_) {}
    }
  }

  function renderBanner() {
    var t = window.WJP_Trial;
    if (!t) return;
    var existing = document.getElementById(BANNER_ID);
    // Admin should never see the trial banner — they're not on trial regardless of
    // any stale Firestore state from previous test runs.
    try {
      var tier = typeof window.getTier === 'function' ? String(window.getTier()).toLowerCase() : null;
      if (tier === 'admin' || window.WJP_IS_ADMIN === true) {
        if (existing) try { existing.remove(); document.body.classList.remove('wjp-has-trial-banner'); } catch (_) {}
        return;
      }
    } catch (_) {}

    if (t.isActive && t.isActive()) {
      var d = t.daysLeft();
      var color = d > 3 ? 'green' : 'yellow';
      var msg;
      if (d <= 0)      msg = 'Your Pro Plus trial ends today — upgrade to keep bank sync';
      else if (d === 1) msg = 'Last day of your Pro Plus trial — upgrade to keep bank sync';
      else if (d <= 3)  msg = d + ' days left in your Pro Plus trial';
      else              msg = d + ' days left in your free Pro Plus trial';
      var html =
        '<span class="pill">TRIAL</span>' +
        '<span>' + msg + '</span>' +
        '<span style="opacity:0.85;">— Upgrade</span>';
      if (existing) {
        existing.className = color;
        existing.innerHTML = html;
      } else {
        var b = document.createElement('div');
        b.id = BANNER_ID;
        b.className = color;
        b.innerHTML = html;
        b.onclick = openBilling;
        document.documentElement.appendChild(b); document.body.classList.add('wjp-has-trial-banner');
      }
      return;
    }

    if (t.isInGrace && t.isInGrace()) {
      var g = t.graceDaysLeft();
      var msgg = g <= 0
        ? 'Trial ended — bank connections being removed'
        : 'Trial ended — bank connections will be removed in ' + g + ' day' + (g === 1 ? '' : 's') + '. Upgrade to keep them.';
      var htmlg = '<span class="pill">EXPIRED</span><span>' + msgg + '</span><span style="opacity:0.85;">— Upgrade</span>';
      if (existing) {
        existing.className = 'red';
        existing.innerHTML = htmlg;
      } else {
        var bg = document.createElement('div');
        bg.id = BANNER_ID;
        bg.className = 'red';
        bg.innerHTML = htmlg;
        bg.onclick = openBilling;
        document.documentElement.appendChild(bg); document.body.classList.add('wjp-has-trial-banner');
      }
      return;
    }

    if (existing) try { existing.remove(); document.body.classList.remove('wjp-has-trial-banner'); } catch (_) {}
  }

  function showWelcomeOnce() {
    try {
      var t = window.WJP_Trial;
      if (!t || !t.isActive || !t.isActive()) return;
      if (localStorage.getItem(LS_WELCOME) === '1') return;
      var existing = document.getElementById(MODAL_ID);
      if (existing) return;

      var d = t.daysLeft();
      var modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.innerHTML =
        '<div class="card" role="dialog" aria-modal="true">' +
          '<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:6px;">' +
            'Welcome — ' + d + ' days free' +
          '</div>' +
          '<h2>Your Pro Plus trial is on.</h2>' +
          '<div class="sub">' +
            'For the next ' + d + ' days, every Pro Plus feature is unlocked — no card required. Connect your banks now to see the magic.' +
          '</div>' +
          '<ul>' +
            '<li><strong>Bank sync</strong> — auto-import balances, transactions, and statements</li>' +
            '<li><strong>APR + due dates</strong> — pulled live from your credit cards</li>' +
            '<li><strong>401k & investments</strong> — holdings and performance tracked automatically</li>' +
            '<li><strong>Card Health monitor</strong> — get reminded before issuers close inactive cards</li>' +
          '</ul>' +
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-secondary" data-action="close">Maybe later</button>' +
            '<button type="button" class="btn btn-primary" data-action="connect">Connect a bank</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) { try { modal.remove(); } catch (_) {} }
      });
      modal.querySelector('[data-action="close"]').onclick = function () {
        try { localStorage.setItem(LS_WELCOME, '1'); } catch (_) {}
        modal.remove();
      };
      modal.querySelector('[data-action="connect"]').onclick = function () {
        try { localStorage.setItem(LS_WELCOME, '1'); } catch (_) {}
        modal.remove();
        // Find and click an Add Bank / Sync Bank entry point
        var pts = document.querySelectorAll('button, a, [role="button"]');
        for (var i = 0; i < pts.length; i++) {
          var t = (pts[i].textContent || '').trim();
          if (/^\+?\s*(add|sync|connect|link)\s*bank/i.test(t)) { pts[i].click(); return; }
        }
      };
    } catch (_) {}
  }

  function tick() {
    try {
      renderBanner();
      showWelcomeOnce();
    } catch (_) {}
  }

  function boot() {
    injectStyle();
    // Wait briefly for trial state to populate
    setTimeout(tick, 1500);
    setTimeout(tick, 3500);
    setInterval(tick, 30000);
    window.addEventListener('wjp-trial-state', tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_TrialBanner = { render: tick, version: 1 };
})();
