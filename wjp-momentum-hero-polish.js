/* wjp-momentum-hero-polish.js v1 — Add vibrant color + life to the
 * Last 7 Days hero (#wjp-momentum-hero) stat tiles.
 *
 * Winston 2026-05-29: "put some color in those boxes, looks too plain"
 *
 * The hero has three stat tiles (Debt this week, Cash on hand, Scores) with
 * no class names, so we color them via :nth-child + the embedded Phosphor
 * icons (ph-trending-down, ph-wallet, ph-shield-check / ph-shield-star).
 *
 * Each tile gets:
 *   - A pastel gradient background
 *   - A colored accent border on the left
 *   - A bright icon halo
 *   - Subtle hover lift
 *
 * Themes:
 *   - Debt this week (red/coral)
 *   - Cash on hand (green/teal)
 *   - Scores (purple)
 *
 * Safe: IIFE, idempotent, pure CSS (no DOM rewriting). Plays well with the
 * wjp-cash-on-hand-link / wjp-momentum-tiles-link paint modules.
 */
(function () {
  'use strict';
  if (window._wjpMomentumHeroPolishInstalled) return;
  window._wjpMomentumHeroPolishInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function injectStyle() {
    if (document.getElementById('wjp-momentum-hero-polish-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-momentum-hero-polish-style';
    // The tile-row inside #wjp-momentum-hero is the FIRST grid/row container
    // with exactly 3 children. We target that via a structural selector and
    // then color each child via its embedded icon.
    st.textContent = [
      // Each tile is a flex/grid cell with one of three icons. We target via :has()
      // (supported in all evergreen browsers). The icon classes are distinct.
      '#wjp-momentum-hero { padding-top: 4px; padding-bottom: 4px; }',

      // Tile baseline — applies to every direct stat tile inside the hero stats row.
      // Detect tiles by looking for divs that contain one of the three icons.
      '#wjp-momentum-hero div:has(> div > i.ph-trending-down), #wjp-momentum-hero div:has(> div > i.ph-trending-up), #wjp-momentum-hero div:has(> div > i.ph-currency-dollar), #wjp-momentum-hero div:has(> div > i.ph-wallet), #wjp-momentum-hero div:has(> div > i.ph-shield-check), #wjp-momentum-hero div:has(> div > i.ph-shield-star), #wjp-momentum-hero div:has(> div > i[class*="ph-"]) { border-radius: 14px !important; transition: transform .18s ease, box-shadow .18s ease, background .18s ease !important; }',
      '#wjp-momentum-hero div:has(> div > i.ph-trending-down):hover, #wjp-momentum-hero div:has(> div > i.ph-trending-up):hover, #wjp-momentum-hero div:has(> div > i.ph-wallet):hover, #wjp-momentum-hero div:has(> div > i.ph-shield-check):hover, #wjp-momentum-hero div:has(> div > i.ph-shield-star):hover { transform: translateY(-2px) !important; box-shadow: 0 10px 24px rgba(20,30,25,0.10) !important; }',

      // Debt this week — coral tone
      '#wjp-momentum-hero div:has(> div > i.ph-trending-down), #wjp-momentum-hero div:has(> div > i.ph-trending-up), #wjp-momentum-hero div:has(> div > i.ph-arrow-down) { background: linear-gradient(135deg, rgba(255,231,224,0.95), rgba(255,242,238,0.65)) !important; border: 1px solid rgba(192,89,74,0.30) !important; box-shadow: inset 4px 0 0 #c0594a, 0 4px 14px rgba(192,89,74,0.10) !important; }',
      '#wjp-momentum-hero div:has(> div > i.ph-trending-down) i, #wjp-momentum-hero div:has(> div > i.ph-trending-up) i { color: #c0594a !important; font-size: 22px !important; }',

      // Cash on hand — green tone (currency-dollar or wallet)
      '#wjp-momentum-hero div:has(> div > i.ph-currency-dollar), #wjp-momentum-hero div:has(> div > i.ph-wallet), #wjp-momentum-hero div:has(> div > i.ph-piggy-bank), #wjp-momentum-hero div:has(> div > i.ph-money) { background: linear-gradient(135deg, rgba(220,243,232,0.95), rgba(238,250,244,0.65)) !important; border: 1px solid rgba(31,122,74,0.30) !important; box-shadow: inset 4px 0 0 #1f7a4a, 0 4px 14px rgba(31,122,74,0.10) !important; }',
      '#wjp-momentum-hero div:has(> div > i.ph-currency-dollar) i, #wjp-momentum-hero div:has(> div > i.ph-wallet) i, #wjp-momentum-hero div:has(> div > i.ph-piggy-bank) i, #wjp-momentum-hero div:has(> div > i.ph-money) i { color: #1f7a4a !important; font-size: 22px !important; }',

      // Scores — purple tone
      '#wjp-momentum-hero div:has(> div > i.ph-shield-check), #wjp-momentum-hero div:has(> div > i.ph-shield-star), #wjp-momentum-hero div:has(> div > i.ph-shield), #wjp-momentum-hero div:has(> div > i.ph-medal), #wjp-momentum-hero div:has(> div > i.ph-target) { background: linear-gradient(135deg, rgba(234,225,250,0.95), rgba(245,238,255,0.65)) !important; border: 1px solid rgba(124,77,196,0.30) !important; box-shadow: inset 4px 0 0 #7c4dc4, 0 4px 14px rgba(124,77,196,0.10) !important; }',
      '#wjp-momentum-hero div:has(> div > i.ph-shield-check) i, #wjp-momentum-hero div:has(> div > i.ph-shield-star) i, #wjp-momentum-hero div:has(> div > i.ph-shield) i, #wjp-momentum-hero div:has(> div > i.ph-medal) i, #wjp-momentum-hero div:has(> div > i.ph-target) i { color: #7c4dc4 !important; font-size: 22px !important; }',

      // Make the value text bigger and the label more distinct
      '#wjp-momentum-hero div:has(> div > i[class*="ph-"]) > div + div { display: flex; flex-direction: column; gap: 2px; }',

      // ──── Dark mode ────
      'body.dark #wjp-momentum-hero div:has(> div > i.ph-trending-down), body.dark #wjp-momentum-hero div:has(> div > i.ph-trending-up) { background: linear-gradient(135deg, rgba(192,89,74,0.20), rgba(192,89,74,0.06)) !important; border-color: rgba(192,89,74,0.35) !important; }',
      'body.dark #wjp-momentum-hero div:has(> div > i.ph-currency-dollar), body.dark #wjp-momentum-hero div:has(> div > i.ph-wallet), body.dark #wjp-momentum-hero div:has(> div > i.ph-piggy-bank), body.dark #wjp-momentum-hero div:has(> div > i.ph-money) { background: linear-gradient(135deg, rgba(31,122,74,0.20), rgba(31,122,74,0.06)) !important; border-color: rgba(127,209,164,0.35) !important; }',
      'body.dark #wjp-momentum-hero div:has(> div > i.ph-shield-check), body.dark #wjp-momentum-hero div:has(> div > i.ph-shield-star), body.dark #wjp-momentum-hero div:has(> div > i.ph-shield), body.dark #wjp-momentum-hero div:has(> div > i.ph-medal), body.dark #wjp-momentum-hero div:has(> div > i.ph-target) { background: linear-gradient(135deg, rgba(124,77,196,0.25), rgba(124,77,196,0.08)) !important; border-color: rgba(186,160,236,0.35) !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function boot() {
    injectStyle();
    // Re-inject on data restore in case style elements were wiped
    window.addEventListener('wjp-data-restored', injectStyle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_MomentumHeroPolish = { version: 1, inject: injectStyle };
})();
