/* wjp-downgrade-notice.js — Loss-aversion modal on tier downgrade.
 *
 * Tracks high-water-mark tier in localStorage. When current tier drops below HWM,
 * shows a modal listing features the user no longer has access to (with concrete
 * value framing) plus a Reactivate CTA. Cadence: once on detection, then re-show
 * every 30 days while user is still below HWM.
 *
 * Hardened pattern (lessons from W2-W6 dashboard catastrophe):
 * - IIFE + idempotent flag
 * - Path-guarded to /index.html only
 * - NO MutationObservers — single deferred boot, then 60s tier-change polling
 * - try/catch wrapped at every entry; module never throws
 *
 * Public hook: window.WJP_DowngradeNotice.show()  // force-show for testing
 *              window.WJP_DowngradeNotice.reset() // wipe localStorage
 */
(function () {
  'use strict';
  if (window._wjpDowngradeNoticeInstalled) return;
  window._wjpDowngradeNoticeInstalled = true;

  // Path guard — dashboard only
  try {
    var p = (location.pathname || '/').toLowerCase();
    if (p !== '/' && p !== '/index.html' && p.indexOf('/index') !== 0) return;
  } catch (_) { return; }

  var LS = {
    hwm:        'wjp.tier.hwm',          // numeric rank (e.g. 2)
    hwmTier:    'wjp.tier.hwmTier',      // string (e.g. 'plus')
    shownAt:    'wjp.downgrade.shownAt', // timestamp last shown
    dismissed:  'wjp.downgrade.dismissedAt',
    fromTier:   'wjp.downgrade.fromTier',
    toTier:     'wjp.downgrade.toTier'
  };

  var TIER_RANK = { free: 0, pro: 1, plus: 2, admin: 3 };
  var THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  function rank(t) { return TIER_RANK[t] != null ? TIER_RANK[t] : 0; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  // Returns the user's current tier — but ONLY if we're confident the auth +
  // subscription state has resolved. Returning 'free' before Firebase auth has
  // loaded would cause a spurious "downgrade" detection for paid/admin users.
  function readTier() {
    var firebaseReady = false;
    try {
      if (window.firebase && window.firebase.auth) {
        var auth = window.firebase.auth();
        if (auth && auth.currentUser) firebaseReady = true;
      }
    } catch (_) {}
    var subReady = false;
    try { if (window.appState && window.appState.subscription) subReady = true; } catch (_) {}
    var adminReady = false;
    try { if (window.WJP_IS_ADMIN === true) adminReady = true; } catch (_) {}

    if (!firebaseReady && !subReady && !adminReady) return null;

    try {
      if (typeof window.getTier === 'function') {
        var t = window.getTier();
        if (t) return String(t).toLowerCase();
      }
    } catch (_) {}
    try {
      if (window.appState && window.appState.prefs && window.appState.prefs.tier) {
        return String(window.appState.prefs.tier).toLowerCase();
      }
    } catch (_) {}
    return null;
  }

  // Feature inventory by tier — what each tier includes.
  // Used to compute which features are LOST on downgrade.
  var FEATURES = {
    plus: [
      { id: 'liabilities',   icon: '⚡', title: 'Plaid auto-sync of statements',  value: 'Saved you ~90 days of manual statement uploads — APR, balance, due dates flow in automatically.' },
      { id: 'household',     icon: '\u{1F46A}', title: 'Joint accounts',                value: 'Run debt strategy across two people with shared visibility, separate logins, and household totals.' },
      { id: 'unlimitedAI',   icon: '\u{1F9E0}', title: 'Unlimited AI Coach',            value: 'No daily caps. Ask the coach as many specific questions as you want about your real numbers.' },
      { id: 'yir',           icon: '\u{1F4C8}', title: 'Year-in-Review report',         value: 'Annual deep-dive: interest paid, months saved, biggest wins, what to focus on next year.' },
      { id: 'priority',      icon: '⏱',   title: 'Priority support',              value: 'Email response within 24 hours from a real person who reads your data.' },
      { id: 'quarterly',     icon: '\u{1F4DD}', title: 'Quarterly AI deep-review',      value: 'Every 3 months, the coach runs a full audit of your debt portfolio and writes you a memo.' }
    ],
    pro: [
      { id: 'plaid',         icon: '\u{1F3E6}', title: 'Bank sync via Plaid',           value: 'Auto-import balances and transactions from 12,000+ banks. No more manual updates.' },
      { id: 'aiCoach',       icon: '\u{1F4AC}', title: 'AI Coach (Cloud)',              value: 'Specific moves on your real numbers — "pay X by day Y to drop utilization." Up to 50/day.' },
      { id: 'hybrid',        icon: '⛰',   title: 'Hybrid + custom strategies',    value: 'Sort by balance × APR (biggest interest bleed first), or define your own ordering.' },
      { id: 'export',        icon: '\u{1F4C2}', title: 'CSV export',                    value: 'Pull your full data anytime for taxes, advisors, or your own analysis.' },
      { id: 'forecast',      icon: '\u{1F4C5}', title: 'Balance forecast',              value: '6-month projection of every account based on your spending pattern.' }
    ]
  };

  function lostFeatures(fromTier, toTier) {
    var fromR = rank(fromTier);
    var toR = rank(toTier);
    var lost = [];
    if (fromR > 1 && toR <= 1) {
      // Plus → Pro/Free: lose Plus-only features
      lost = lost.concat(FEATURES.plus);
    }
    if (fromR > 0 && toR === 0) {
      // Anything → Free: lose Pro features too
      lost = lost.concat(FEATURES.pro);
    }
    return lost;
  }

  function tierLabel(t) {
    return t === 'plus' ? 'Pro Plus' : t === 'pro' ? 'Pro' : 'Free';
  }

  function shouldShow(currentTier) {
    if (!currentTier) return false;
    var hwmTier = lsGet(LS.hwmTier) || 'free';

    // Self-heal: 'admin' is a session-bound tier (allowlist driven), not a
    // billable tier. Treat as Pro Plus equivalent so we don't permanently
    // nag the admin user with a downgrade modal.
    if (hwmTier === 'admin') {
      lsSet(LS.hwmTier, 'plus');
      lsSet(LS.hwm, '2');
      hwmTier = 'plus';
    }

    var currR = rank(currentTier);
    var hwmR = rank(hwmTier);

    // Update high-water-mark if user has gone UP (or first run)
    if (currR > hwmR) {
      lsSet(LS.hwm, String(currR));
      lsSet(LS.hwmTier, currentTier);
      // User upgraded — clear any pending downgrade flags
      lsDel(LS.shownAt);
      lsDel(LS.dismissed);
      lsDel(LS.fromTier);
      lsDel(LS.toTier);
      return false;
    }

    // No downgrade
    if (currR >= hwmR) return false;

    // Cadence check
    var lastShown = parseInt(lsGet(LS.shownAt) || '0', 10);
    var dismissed = parseInt(lsGet(LS.dismissed) || '0', 10);
    var lastEvent = Math.max(lastShown, dismissed);
    if (lastEvent && (Date.now() - lastEvent) < THIRTY_DAYS) return false;

    // Record the from→to for the modal
    lsSet(LS.fromTier, hwmTier);
    lsSet(LS.toTier, currentTier);
    return true;
  }

  function buildModal(fromTier, toTier) {
    var lost = lostFeatures(fromTier, toTier);
    if (!lost.length) return null;

    var overlay = document.createElement('div');
    overlay.id = 'wjp-downgrade-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'wjp-dn-title');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99998',
      'background:rgba(10,10,10,0.62)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:20px', 'animation:wjpDnFade .25s ease-out'
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--card,#fff)', 'color:var(--ink,#0a0a0a)',
      'border-radius:18px', 'max-width:540px', 'width:100%',
      'max-height:88vh', 'overflow:auto',
      'box-shadow:0 24px 80px rgba(0,0,0,0.30)',
      'border:1px solid var(--border,rgba(0,0,0,0.08))',
      'font-family:var(--sans,Inter,system-ui,sans-serif)'
    ].join(';');

    var fromLabel = tierLabel(fromTier);
    var toLabel = tierLabel(toTier);

    var headerHtml = ''
      + '<div style="padding:28px 28px 12px;border-bottom:1px solid var(--border,rgba(0,0,0,0.06));">'
      +   '<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c99a2a;font-weight:800;margin-bottom:8px;">Plan changed</div>'
      +   '<h2 id="wjp-dn-title" style="font-family:var(--sans,Inter,system-ui,sans-serif);font-size:26px;font-weight:700;letter-spacing:-0.02em;margin:0 0 6px;line-height:1.2;">'
      +     'You\'re on ' + toLabel + ' now.'
      +   '</h2>'
      +   '<p style="font-size:14.5px;color:var(--ink-dim,#6b7280);line-height:1.55;margin:0;">'
      +     'Here\'s what you had on <b>' + fromLabel + '</b> that\'s no longer active. '
      +     'You can switch back any time.'
      +   '</p>'
      + '</div>';

    var listHtml = '<div style="padding:18px 28px;">';
    for (var i = 0; i < lost.length; i++) {
      var f = lost[i];
      listHtml += ''
        + '<div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--border,rgba(0,0,0,0.05));">'
        +   '<div style="font-size:22px;flex-shrink:0;width:32px;text-align:center;">' + f.icon + '</div>'
        +   '<div style="flex:1;min-width:0;">'
        +     '<div style="font-weight:700;font-size:14.5px;color:var(--ink,#0a0a0a);margin-bottom:3px;">'
        +       f.title
        +     '</div>'
        +     '<div style="font-size:13px;color:var(--ink-dim,#6b7280);line-height:1.5;">'
        +       f.value
        +     '</div>'
        +   '</div>'
        + '</div>';
    }
    listHtml += '</div>';

    var ctaTier = fromTier === 'plus' ? 'plus' : 'pro';
    var ctaLabel = 'Reactivate ' + tierLabel(ctaTier);
    var ctaHtml = ''
      + '<div style="padding:18px 28px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">'
      +   '<button id="wjp-dn-dismiss" type="button" style="'
      +     'background:transparent;border:1px solid var(--border,rgba(0,0,0,0.18));'
      +     'color:var(--ink-dim,#6b7280);padding:11px 18px;border-radius:999px;'
      +     'font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;">'
      +     'Maybe later'
      +   '</button>'
      +   '<button id="wjp-dn-cta" type="button" style="'
      +     'background:#1f7a4a;color:#fff;border:none;padding:12px 24px;border-radius:999px;'
      +     'font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;'
      +     'box-shadow:0 6px 18px rgba(31,122,74,0.32);letter-spacing:-0.01em;">'
      +     ctaLabel + ' →'
      +   '</button>'
      + '</div>';

    card.innerHTML = headerHtml + listHtml + ctaHtml;
    overlay.appendChild(card);

    // Inject keyframes once
    if (!document.getElementById('wjp-dn-keyframes')) {
      var kf = document.createElement('style');
      kf.id = 'wjp-dn-keyframes';
      kf.textContent = '@keyframes wjpDnFade{from{opacity:0}to{opacity:1}}';
      document.head.appendChild(kf);
    }

    // Wire dismiss
    overlay.querySelector('#wjp-dn-dismiss').addEventListener('click', function () {
      lsSet(LS.dismissed, String(Date.now()));
      try { overlay.remove(); } catch (_) {}
    });
    overlay.querySelector('#wjp-dn-cta').addEventListener('click', function () {
      lsSet(LS.dismissed, String(Date.now()));
      try { overlay.remove(); } catch (_) {}
      // Send user to pricing/billing
      try { window.location.href = '/pricing.html#reactivate'; } catch (_) {}
    });
    // Click backdrop to dismiss
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        lsSet(LS.dismissed, String(Date.now()));
        try { overlay.remove(); } catch (_) {}
      }
    });
    // Escape key
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        lsSet(LS.dismissed, String(Date.now()));
        try { overlay.remove(); } catch (_) {}
        document.removeEventListener('keydown', escHandler);
      }
    });

    return overlay;
  }

  function show(force) {
    try {
      var t = readTier();
      if (!t) return;
      var fromTier, toTier;
      if (force) {
        fromTier = lsGet(LS.hwmTier) || 'plus';
        toTier = t;
      } else {
        if (!shouldShow(t)) return;
        fromTier = lsGet(LS.fromTier) || 'plus';
        toTier = lsGet(LS.toTier) || t;
      }
      var modal = buildModal(fromTier, toTier);
      if (!modal) return;
      document.body.appendChild(modal);
      lsSet(LS.shownAt, String(Date.now()));
    } catch (e) {
      try { console.warn('[wjp-downgrade-notice] show failed:', e && e.message); } catch (_) {}
    }
  }

  function reset() {
    Object.keys(LS).forEach(function (k) { lsDel(LS[k]); });
  }

  // Boot — wait for tier readiness, then check
  var bootAttempts = 0;
  function tryBoot() {
    bootAttempts++;
    var t = readTier();
    if (!t) {
      if (bootAttempts < 30) setTimeout(tryBoot, 1000);
      return;
    }
    show(false);
    // Light periodic re-check (handles tier downgrade mid-session)
    setInterval(function () { try { show(false); } catch (_) {} }, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryBoot, 1500); });
  } else {
    setTimeout(tryBoot, 1500);
  }

  window.WJP_DowngradeNotice = { show: function () { show(true); }, reset: reset };
})();
