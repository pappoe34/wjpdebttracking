/* wjp-free-tier-gate.js v1 — Gate paid Plaid features for Free tier.
 *
 * For Free users, hides any "+ Add bank" / "Sync Bank" / "Connect bank" entry
 * point and replaces it with an "Upgrade to access these features" card.
 *
 * Does NOT touch the Sync Bank flow itself — only intercepts the entry point
 * BEFORE Plaid.create is invoked. If a Free user somehow reaches the link
 * flow (e.g. cached page), the backend /create-link-token endpoint also
 * returns 403, so this is defense-in-depth.
 *
 * Per the PERMANENT RULE (don't touch Sync Bank UX), this module never
 * modifies the Sync Bank modal or Plaid Link iframe — it gates BEFORE
 * those mount.
 *
 * Safe: IIFE, idempotent, path-guarded, polled every 3s for late-mounted UI.
 */
(function () {
  'use strict';
  if (window._wjpFreeTierGateInstalled) return;
  window._wjpFreeTierGateInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-free-tier-gate-style';
  var UPGRADE_CARD_CLASS = 'wjp-ftg-upgrade-card';
  var HIDE_ATTR = 'data-wjp-ftg-hidden';

  function getTier() {
    try {
      if (typeof window.getTier === 'function') {
        var t = window.getTier();
        if (t) return String(t).toLowerCase();
      }
      // Fallback: check appState
      if (window.appState && window.appState.tier) {
        return String(window.appState.tier).toLowerCase();
      }
    } catch (_) {}
    return null;
  }

  function isFree() {
    var t = getTier();
    if (!t) return false; // Don't gate until we know — avoids false positive on auth-lag
    return t === 'free';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.' + UPGRADE_CARD_CLASS + ' {' +
      '  display:flex;flex-direction:column;align-items:center;gap:10px;' +
      '  padding:18px 22px;margin:10px 0;border-radius:14px;' +
      '  background:linear-gradient(135deg, rgba(31,122,74,0.06) 0%, rgba(31,122,74,0.02) 100%);' +
      '  border:1px solid var(--border, rgba(31,122,74,0.20));' +
      '  font-family:Inter,system-ui,sans-serif;' +
      '  color:var(--ink, var(--text-1, #0a0a0a));' +
      '}' +
      '.' + UPGRADE_CARD_CLASS + ' .wjp-ftg-title {' +
      '  font-size:14px;font-weight:800;letter-spacing:-0.01em;' +
      '  color:var(--ink, var(--text-1, #0a0a0a));' +
      '}' +
      '.' + UPGRADE_CARD_CLASS + ' .wjp-ftg-sub {' +
      '  font-size:12px;color:var(--ink-dim, var(--text-2, #6b7280));' +
      '  text-align:center;line-height:1.5;max-width:380px;' +
      '}' +
      '.' + UPGRADE_CARD_CLASS + ' .wjp-ftg-btn {' +
      '  background:#1f7a4a;color:#fff;border:none;border-radius:8px;' +
      '  padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;' +
      '  font-family:inherit;margin-top:4px;letter-spacing:0.01em;' +
      '  box-shadow:0 1px 3px rgba(31,122,74,0.25);' +
      '}' +
      '.' + UPGRADE_CARD_CLASS + ' .wjp-ftg-btn:hover { background:#1a6840; }' +
      'body.dark .' + UPGRADE_CARD_CLASS + ' {' +
      '  background:linear-gradient(135deg, rgba(31,122,74,0.10) 0%, rgba(31,122,74,0.04) 100%);' +
      '  border-color:rgba(31,122,74,0.35);' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }

  // Matches buttons/anchors the user would click to start a Plaid link flow.
  function findEntryPoints() {
    var matches = [];
    var candidates = document.querySelectorAll(
      'button, a, [role="button"], .btn, [class*="add-bank"], [class*="sync-bank"], [class*="link-bank"], [data-action*="add-bank"], [data-action*="sync-bank"]'
    );
    var patterns = [
      /\bsync\s*bank\b/i,
      /\badd\s*bank\b/i,
      /\bconnect\s*bank\b/i,
      /\blink\s*bank\b/i,
      /\+\s*add\s*bank/i,
      /\bconnect\s*account\b/i
    ];
    Array.prototype.forEach.call(candidates, function (el) {
      var txt = (el.textContent || '').trim();
      if (!txt) return;
      if (txt.length > 60) return; // skip large blocks
      for (var i = 0; i < patterns.length; i++) {
        if (patterns[i].test(txt)) { matches.push(el); break; }
      }
    });
    return matches;
  }

  function buildUpgradeCard() {
    var card = document.createElement('div');
    card.className = UPGRADE_CARD_CLASS;
    card.setAttribute('data-wjp-ftg-card', '1');
    card.innerHTML =
      '<div class="wjp-ftg-title">Upgrade to access these features</div>' +
      '<div class="wjp-ftg-sub">' +
        'Bank syncing, auto-imported transactions, statement details and live balance updates are part of Pro. ' +
        'Free plan stays free — your manual entries, calendar and strategy tools keep working.' +
      '</div>' +
      '<button type="button" class="wjp-ftg-btn">Upgrade plan</button>';
    var btn = card.querySelector('.wjp-ftg-btn');
    btn.onclick = function () {
      try {
        // Navigate to billing — try multiple known routes
        if (typeof window.openBillingModal === 'function') return window.openBillingModal();
        if (typeof window.WJP_Billing === 'object' && window.WJP_Billing.open) return window.WJP_Billing.open();
        // Settings → Billing tab as fallback
        var settingsTab = document.querySelector('[data-tab="settings"], [data-route="settings"], #nav-settings');
        if (settingsTab) settingsTab.click();
        location.hash = '#billing';
      } catch (_) {
        location.hash = '#billing';
      }
    };
    return card;
  }

  function gateEntryPoints() {
    if (!isFree()) {
      // Tier changed — restore anything we hid
      restoreEntryPoints();
      return;
    }
    var pts = findEntryPoints();
    pts.forEach(function (el) {
      if (el.getAttribute(HIDE_ATTR) === '1') return;
      // Hide the original button
      el.setAttribute(HIDE_ATTR, '1');
      el.dataset.wjpFtgOrigDisplay = el.style.display || '';
      el.style.display = 'none';
      // Inject an upgrade card immediately after it
      var card = buildUpgradeCard();
      if (el.parentNode) {
        el.parentNode.insertBefore(card, el.nextSibling);
      }
    });
  }

  function restoreEntryPoints() {
    var hidden = document.querySelectorAll('[' + HIDE_ATTR + '="1"]');
    Array.prototype.forEach.call(hidden, function (el) {
      el.style.display = el.dataset.wjpFtgOrigDisplay || '';
      el.removeAttribute(HIDE_ATTR);
    });
    var cards = document.querySelectorAll('[data-wjp-ftg-card="1"]');
    Array.prototype.forEach.call(cards, function (c) { try { c.remove(); } catch (_) {} });
  }

  function boot() {
    injectStyle();
    // Wait for tier resolver before first gate (avoid flicker)
    var attempts = 0;
    function tryGate() {
      attempts++;
      if (getTier() != null) {
        gateEntryPoints();
        // Re-check every 3s for newly-mounted UI (modals, tab switches)
        setInterval(gateEntryPoints, 3000);
        return;
      }
      if (attempts < 30) setTimeout(tryGate, 1000);
    }
    tryGate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_FreeTierGate = {
    gate: gateEntryPoints,
    restore: restoreEntryPoints,
    isFree: isFree,
    version: 1
  };

  // Expose a shared tier-check API for other modules
  if (!window.WJP_TierGate) {
    window.WJP_TierGate = {
      canUsePlaid: function () {
        var t = getTier();
        return t === 'pro' || t === 'plus' || t === 'admin' || t === 'pro_plus' || t === 'proplus';
      },
      canUseLiabilities: function () {
        var t = getTier();
        return t === 'plus' || t === 'admin' || t === 'pro_plus' || t === 'proplus';
      },
      canUseInvestments: function () {
        var t = getTier();
        return t === 'plus' || t === 'admin' || t === 'pro_plus' || t === 'proplus';
      },
      tier: getTier
    };
  }
})();
