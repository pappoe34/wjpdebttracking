/* wjp-credit-tier-gate.js v1 — Tier gating + locked-state overlays.
 *
 * Two responsibilities:
 *   1. Resolve the user's effective tier (with admin-only URL param override
 *      for dev testing — ?tier=pro / ?tier=plus / ?tier=ultimate / ?tier=free)
 *   2. Render a polished locked-state overlay for features above the user's
 *      tier, with upgrade CTA matching the design system.
 *
 * Public API:
 *   WJP_CreditTier.effective()          -> 'free' | 'pro' | 'plus' | 'ultimate' | 'admin'
 *   WJP_CreditTier.hasAccess(min)        -> boolean (e.g., hasAccess('plus'))
 *   WJP_CreditTier.gate(opts, html)      -> wraps html in locked overlay if user tier < required
 *                                            opts: { required: 'plus'|'ultimate', title, body, cta }
 *   WJP_CreditTier.upgradeUrl(tier)      -> billing modal trigger or anchor
 *   WJP_CreditTier.openBilling(tier)     -> calls openBillingModal() if available
 */
(function () {
  'use strict';
  if (window._wjpCreditTierGateInstalled) return;
  window._wjpCreditTierGateInstalled = true;

  var TIER_RANK = { free: 0, pro: 1, plus: 2, 'pro-plus': 2, ultimate: 3, admin: 4 };
  var ALLOWED_OVERRIDES = new Set(['free', 'pro', 'plus', 'pro-plus', 'ultimate']);

  function realTier() {
    try {
      if (window.WJP_IS_ADMIN) return 'admin';
      var sub = (window.appState && appState.subscription) || {};
      if (sub.isAdmin) return 'admin';
      var t = String(sub.tier || 'free').toLowerCase();
      if (t === 'pro_plus' || t === 'pro-plus') return 'plus';
      if (['free', 'pro', 'plus', 'ultimate', 'admin'].indexOf(t) >= 0) return t;
      return 'free';
    } catch (_) { return 'free'; }
  }

  function isAdmin() { return realTier() === 'admin'; }

  // URL-param tier emulation — admin only. Lets us preview free / pro /
  // pro-plus / ultimate views in production without changing the real
  // subscription. Param name: ?tier=pro
  function emulatedTier() {
    if (!isAdmin()) return null;
    try {
      var qs = new URLSearchParams(window.location.search);
      var t = String(qs.get('tier') || '').toLowerCase();
      if (!t) return null;
      if (t === 'pro_plus' || t === 'pro-plus') t = 'plus';
      return ALLOWED_OVERRIDES.has(t) ? t : null;
    } catch (_) { return null; }
  }

  function effective() {
    return emulatedTier() || realTier();
  }

  function hasAccess(minTier) {
    if (!minTier) return true;
    var min = String(minTier).toLowerCase();
    if (min === 'pro_plus' || min === 'pro-plus') min = 'plus';
    var current = effective();
    return (TIER_RANK[current] || 0) >= (TIER_RANK[min] || 0);
  }

  // Open the billing modal (lives in app.js / settings page). Falls back
  // gracefully if the function isn't loaded yet.
  function openBilling(targetTier) {
    try {
      if (typeof window.openBillingModal === 'function') {
        window.openBillingModal(targetTier);
        return;
      }
      if (typeof window.navTo === 'function') {
        window.navTo('settings');
      }
    } catch (_) {}
    if (window.WJP_Momentum && typeof window.WJP_Momentum.showToast === 'function') {
      var pretty = targetTier === 'plus' ? 'Pro Plus' : targetTier === 'ultimate' ? 'Ultimate' : 'Pro';
      window.WJP_Momentum.showToast({
        eyebrow: 'UPGRADE',
        title: 'Open Settings → Billing',
        sub: pretty + ' unlocks this feature.',
        color: '#6366f1',
        icon: 'ph-fill ph-crown'
      });
    }
  }

  // Returns a styled "TIER · upgrade" pill for inline use.
  function tierPill(targetTier) {
    var label = targetTier === 'ultimate' ? 'Ultimate'
              : targetTier === 'plus'     ? 'Pro Plus'
              : 'Pro';
    var fromColor = targetTier === 'ultimate' ? '#a855f7'
                  : targetTier === 'plus'     ? '#6366f1'
                  : '#10b981';
    var toColor   = targetTier === 'ultimate' ? '#ec4899'
                  : targetTier === 'plus'     ? '#a855f7'
                  : '#34d399';
    return ''
      + '<span style="'
      +   'display:inline-flex;align-items:center;gap:4px;'
      +   'padding:3px 9px;border-radius:999px;'
      +   'background:linear-gradient(135deg,' + fromColor + ',' + toColor + ');'
      +   'color:#fff;font-size:9px;font-weight:800;letter-spacing:0.08em;'
      +   'text-transform:uppercase;line-height:1;'
      + '">'
      +   '<i class="ph-fill ph-lock-key" style="font-size:9px;"></i>' + label
      + '</span>';
  }

  // Wraps content with a polished locked overlay when user's tier is below
  // the required minimum. If user has access, returns the content unchanged.
  //
  // opts: {
  //   required: 'plus' | 'ultimate' | 'pro',
  //   title:    string (headline of the locked card),
  //   body:     string (one-line explainer),
  //   minHeight: optional CSS string for content area
  // }
  function gate(opts, contentHTML) {
    opts = opts || {};
    var req = String(opts.required || 'pro').toLowerCase();
    if (req === 'pro-plus' || req === 'pro_plus') req = 'plus';
    if (hasAccess(req)) return contentHTML;

    var title = opts.title || 'Premium feature';
    var body = opts.body || 'Upgrade to unlock this feature.';
    var minHeight = opts.minHeight || 'auto';
    var pretty = req === 'ultimate' ? 'Ultimate' : req === 'plus' ? 'Pro Plus' : 'Pro';
    var accent = req === 'ultimate' ? '#a855f7' : req === 'plus' ? '#6366f1' : '#10b981';

    return ''
      + '<div class="wjp-cs-locked" style="position:relative;border-radius:14px;overflow:hidden;min-height:' + minHeight + ';">'
      +   // Blurred-out preview behind a subtle veil
      +   '<div style="filter:blur(8px) saturate(0.6);opacity:0.45;pointer-events:none;user-select:none;">'
      +     contentHTML
      +   '</div>'
      +   // Overlay card centered on the locked area
      +   '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;">'
      +     '<div style="'
      +       'max-width:520px;text-align:center;'
      +       'background:var(--card, var(--bg-2, #fff));'
      +       'border:1px solid var(--border, rgba(0,0,0,0.06));'
      +       'border-radius:14px;padding:22px 28px;'
      +       'box-shadow:0 14px 40px rgba(0,0,0,0.14);'
      +     '">'
      +       tierPill(req)
      +       '<h3 style="font-size:18px;font-weight:900;color:var(--text-1, #0a0a0a);margin:12px 0 6px;letter-spacing:-0.01em;">' + title + '</h3>'
      +       '<p style="font-size:12.5px;color:var(--text-3, #94a3b8);font-weight:600;line-height:1.55;margin:0 0 16px;">' + body + '</p>'
      +       '<button type="button" data-cs-upgrade="' + req + '" style="'
      +         'background:linear-gradient(135deg,' + accent + ',#a855f7);'
      +         'color:#fff;border:0;padding:10px 22px;border-radius:10px;'
      +         'font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;'
      +         'letter-spacing:0.02em;'
      +         'box-shadow:0 4px 14px ' + accent + '40;'
      +       '">Upgrade to ' + pretty + ' →</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // Single delegated handler for upgrade buttons rendered by gate()
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cs-upgrade]');
    if (!btn) return;
    e.preventDefault();
    openBilling(btn.getAttribute('data-cs-upgrade'));
  }, true);

  window.WJP_CreditTier = {
    effective: effective,
    realTier: realTier,
    hasAccess: hasAccess,
    gate: gate,
    tierPill: tierPill,
    openBilling: openBilling,
    TIER_RANK: TIER_RANK
  };

  // Visible developer hint when tier emulation is active — small pill
  // top-right corner so we don't forget we're in preview mode.
  try {
    var emu = emulatedTier();
    if (emu) {
      var existing = document.getElementById('wjp-tier-emu-pill');
      if (existing) existing.remove();
      var pill = document.createElement('div');
      pill.id = 'wjp-tier-emu-pill';
      pill.style.cssText = 'position:fixed;top:14px;right:14px;z-index:99999;padding:5px 11px;border-radius:999px;background:#a855f7;color:#fff;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;box-shadow:0 4px 14px rgba(168,85,247,0.40);pointer-events:none;font-family:inherit;';
      pill.textContent = 'PREVIEW · ' + emu.toUpperCase();
      document.body.appendChild(pill);
    }
  } catch (_) {}
})();
