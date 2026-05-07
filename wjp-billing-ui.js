/* wjp-billing-ui.js — Settings Billing card with Switch-cycle + Cancel CTAs.
 *
 * Surfaces user-facing controls for the Stripe management endpoints shipped
 * yesterday. Two CTAs:
 *   1. "Switch to yearly (save 31%)" — calls /stripe-switch-cycle with a
 *      confirmation modal that shows the prorated charge.
 *   2. "Cancel subscription" — flow varies by tier:
 *        Monthly → cancels at period end via Stripe Customer Portal (no refund).
 *        Yearly  → buried, contact-support gated. Does NOT show refund estimate
 *                  — deliberate retention friction so users don't cancel just
 *                  to chase a refund.
 *
 * Hardened pattern: IIFE, idempotent, path-guarded to /index.html, no
 * MutationObservers, try/catch wrapped, polled re-injection.
 */
(function () {
  'use strict';
  if (window._wjpBillingUiInstalled) return;
  window._wjpBillingUiInstalled = true;

  // Path guard — dashboard only
  try {
    var p = (location.pathname || '/').toLowerCase();
    if (p !== '/' && p !== '/index.html' && p.indexOf('/index') !== 0) return;
  } catch (_) { return; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  function getSubscription() {
    try {
      if (window.appState && window.appState.subscription) return window.appState.subscription;
    } catch (_) {}
    return null;
  }

  function readTier() {
    try {
      if (typeof window.getTier === 'function') return String(window.getTier()).toLowerCase();
    } catch (_) {}
    return 'free';
  }

  function getCycle() {
    var sub = getSubscription();
    if (!sub) return null;
    var key = sub.currentPriceLookupKey || '';
    if (key.indexOf('_yearly') !== -1) return 'yearly';
    if (key.indexOf('_monthly') !== -1) return 'monthly';
    return null;
  }

  function fmtCents(cents) {
    var n = Math.abs(cents) / 100;
    return '$' + n.toFixed(2);
  }

  async function getIdToken() {
    try {
      var auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
      if (auth && auth.currentUser) return await auth.currentUser.getIdToken();
    } catch (_) {}
    return null;
  }

  // === Switch cycle (monthly → yearly) ===
  async function doSwitchCycle(targetKey, btn) {
    var idToken = await getIdToken();
    if (!idToken) { alert('Please refresh and try again — you are not signed in.'); return; }
    btn.disabled = true; btn.textContent = 'Working...';
    try {
      var res = await fetch('/.netlify/functions/stripe-switch-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ target_lookup_key: targetKey })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');
      var msg = 'Switched to yearly. ';
      if (data.prorationCents > 0) msg += 'Prorated charge of ' + fmtCents(data.prorationCents) + ' will appear on your next invoice.';
      else msg += 'No charge today — your existing payment covers the new term.';
      alert(msg);
      try { window.location.reload(); } catch (_) {}
    } catch (e) {
      alert('Could not switch: ' + (e && e.message || 'unknown error'));
      btn.disabled = false; btn.textContent = 'Switch to yearly (save 31%)';
    }
  }

  function showSwitchConfirm(targetKey, btn) {
    var label = targetKey === 'plus_yearly' ? 'Pro Plus Yearly ($199/yr)' : 'Pro Yearly ($99/yr)';
    var ok = confirm(
      'Switch to ' + label + '?\n\n' +
      'You\'ll be prorated for what you haven\'t already paid on the current monthly plan, ' +
      'and we\'ll lock in yearly pricing immediately. You can switch back any time.'
    );
    if (ok) doSwitchCycle(targetKey, btn);
  }

  // === Cancel — different flow by tier+cycle ===
  function showCancelMonthly(btn) {
    var ok = confirm(
      'Cancel subscription at end of current billing period?\n\n' +
      'You\'ll keep full access until your next billing date, then drop to Free. ' +
      'Your data stays. Manual tracking stays. You can re-subscribe any time.'
    );
    if (!ok) return;
    // Hand off to Stripe Customer Portal so user can confirm + we don't process the cancel ourselves
    btn.disabled = true; btn.textContent = 'Opening portal...';
    getIdToken().then(function (idToken) {
      return fetch('/.netlify/functions/stripe-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.url) window.location.href = d.url;
      else throw new Error(d.error || 'no portal url');
    }).catch(function (e) {
      alert('Could not open billing portal: ' + (e && e.message));
      btn.disabled = false; btn.textContent = 'Cancel subscription';
    });
  }

  function showCancelYearly() {
    // Deliberate friction: do NOT surface the refund estimate. User contacts
    // support, who handles the cancel-with-fee flow.
    alert(
      'Yearly subscriptions are cancelled by support to ensure your refund is processed correctly.\n\n' +
      'Please email support@wjpdebttracking.com with the subject "Cancel my yearly subscription" ' +
      'and we\'ll handle it within one business day.\n\n' +
      'Per our Terms, yearly cancellations receive a prorated refund of unused months less a ' +
      'business usage fee, capped at $25.'
    );
  }

  // === Build the card ===
  function buildBillingCard() {
    var tier = readTier();
    var cycle = getCycle();
    var sub = getSubscription();

    // Don't show for Free / no-sub users
    if (tier === 'free' || tier === 'admin') return null;
    if (!sub || !sub.stripeSubscriptionId) return null;

    var card = document.createElement('div');
    card.id = 'wjp-billing-actions-card';
    card.style.cssText = [
      'background:var(--card,#fff)',
      'border:1px solid var(--border,rgba(0,0,0,0.08))',
      'border-radius:14px',
      'padding:20px 22px',
      'margin:18px 0',
      'font-family:Inter,system-ui,sans-serif',
      'color:var(--ink,#0a0a0a)'
    ].join(';');

    var html = ''
      + '<div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-faint,#9ca3af);font-weight:800;margin-bottom:10px;">Plan management</div>'
      + '<h3 style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:600;margin:0 0 14px;letter-spacing:-0.01em;">'
      +   'You\'re on ' + (tier === 'plus' ? 'Pro Plus' : 'Pro')
      +   (cycle ? ' &middot; <span style="color:var(--ink-dim,#6b7280);font-weight:500;">' + cycle.charAt(0).toUpperCase() + cycle.slice(1) + '</span>' : '')
      + '</h3>';

    // Switch-to-yearly CTA — only if user is on monthly
    if (cycle === 'monthly') {
      var targetKey = tier + '_yearly';
      html += ''
        + '<div style="background:linear-gradient(90deg,rgba(31,122,74,0.06),rgba(201,154,42,0.04));border-radius:10px;padding:14px 16px;margin:0 0 14px;display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between;">'
        +   '<div style="flex:1;min-width:240px;">'
        +     '<div style="font-weight:700;font-size:14px;color:var(--ink,#0a0a0a);margin-bottom:3px;">Switch to yearly</div>'
        +     '<div style="font-size:13px;color:var(--ink-dim,#6b7280);line-height:1.5;">Save 31% on your subscription. We\'ll prorate so you only pay the difference.</div>'
        +   '</div>'
        +   '<button id="wjp-billing-switch" data-target="' + targetKey + '" type="button" style="background:#1f7a4a;color:#fff;border:0;padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:-0.01em;">Switch to yearly &middot; save 31%</button>'
        + '</div>';
    }

    // Cancel CTA — minimal, buried below
    html += ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border,rgba(0,0,0,0.06));">'
      +   '<div style="font-size:12.5px;color:var(--ink-faint,#9ca3af);line-height:1.5;flex:1;min-width:200px;">'
      +     'Need to cancel? You\'ll keep full access through the end of your billing period.'
      +   '</div>'
      +   '<button id="wjp-billing-cancel" type="button" style="background:transparent;color:var(--ink-dim,#6b7280);border:1px solid var(--border,rgba(0,0,0,0.18));padding:8px 16px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel subscription</button>'
      + '</div>';

    card.innerHTML = html;

    // Wire buttons
    var switchBtn = card.querySelector('#wjp-billing-switch');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        showSwitchConfirm(switchBtn.dataset.target, switchBtn);
      });
    }
    var cancelBtn = card.querySelector('#wjp-billing-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        if (cycle === 'yearly') showCancelYearly();
        else showCancelMonthly(cancelBtn);
      });
    }

    return card;
  }

  // === Inject into the Settings → Billing panel ===
  function findBillingPanel() {
    // Try common selectors used by the settings v3 layout. Fall back to any
    // visible #settings-page region if specific panel selectors miss.
    var sel = [
      '#settings-billing-panel',
      '[data-settings-panel="billing"]',
      '#billing-panel',
      '#panel-billing'
    ];
    for (var i = 0; i < sel.length; i++) {
      var el = document.querySelector(sel[i]);
      if (el && el.offsetParent !== null) return el;
    }
    // Fallback — find a section with "Billing" heading
    var headings = document.querySelectorAll('h2,h3,h4');
    for (var j = 0; j < headings.length; j++) {
      var h = headings[j];
      var t = (h.textContent || '').trim().toLowerCase();
      if (t === 'billing' || t === 'subscription' || t === 'plan') {
        return h.parentElement;
      }
    }
    return null;
  }

  function inject() {
    try {
      var existing = document.getElementById('wjp-billing-actions-card');
      if (existing) {
        // Already injected — refresh content if tier/cycle changed
        var fresh = buildBillingCard();
        if (fresh) existing.replaceWith(fresh);
        else existing.remove();
        return;
      }
      var panel = findBillingPanel();
      if (!panel) return;
      var card = buildBillingCard();
      if (!card) return;
      panel.insertBefore(card, panel.firstChild);
    } catch (e) {
      try { console.warn('[wjp-billing-ui] inject failed:', e && e.message); } catch (_) {}
    }
  }

  // Boot — wait for tier resolver + DOM
  var attempts = 0;
  function tryBoot() {
    attempts++;
    if (typeof window.getTier === 'function') {
      inject();
      // Poll lightly for settings panel showing up later (lazy mount)
      setInterval(inject, 2000);
      return;
    }
    if (attempts < 30) setTimeout(tryBoot, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryBoot, 1500); });
  } else {
    setTimeout(tryBoot, 1500);
  }

  window.WJP_BillingUI = { inject: inject };
})();
