/* wjp-card-stable.js v1 — pin card colors so they don't flicker.
 *
 * Winston reported on 2026-05-21 that the Financial Resilience and Money
 * Left cards "constantly change color in dark mode." Our render audit shows
 * these cards rebuild their innerHTML on each update — the inner values
 * (money-left, forecast, percentage, resilience score) get a green/amber/red
 * status color computed from the data, AND the badge class flips between
 * badge-success / badge-warning / badge-danger. When data oscillates (Plaid
 * resync, cloud pull, transactions still loading), those colors flash.
 *
 * Fix:
 *   1. Pin the CARD background, border, shadow to a stable dark-mode value
 *      so the BOX itself never appears to change color.
 *   2. Disable any transition/animation on the card chrome (no glow pulses).
 *   3. Add a smooth 350ms transition to any inner color/background change so
 *      even if values DO update, the change is gradual instead of a flicker.
 *
 * The status colors still appear (red for overspending, amber for warning,
 * green for healthy) — they just transition smoothly instead of flashing.
 *
 * Targets:
 *   #dash-money-left-card
 *   #dash-financial-resilience
 *
 * Memory rules honored: night-mode-safe via body.dark / [data-theme=dark],
 * no MutationObserver, no recursion risk — pure CSS injection.
 */
(function () {
  'use strict';
  if (window._wjpCardStableInstalled) return;
  window._wjpCardStableInstalled = true;

  function inject() {
    if (document.getElementById('wjp-card-stable-styles')) return;
    var css = [
      // ---- Stabilize the card chrome (outer box) ----
      // Both cards: pin background, border, shadow regardless of inner state.
      // Force no animation/transition on the card itself.
      '#dash-money-left-card, #dash-financial-resilience {',
      '  animation: none !important;',
      '  transition: none !important;',
      '  will-change: auto !important;',
      '}',
      // Dark-mode card background pinned (the .card class already sets this,
      // but some inner re-renders might be overlaying with a tint — block it).
      'body.dark #dash-money-left-card,',
      '[data-theme="dark"] #dash-money-left-card,',
      'body.dark #dash-financial-resilience,',
      '[data-theme="dark"] #dash-financial-resilience {',
      '  background-color: rgb(19, 25, 41) !important;',
      '  border-color: rgba(255, 255, 255, 0.06) !important;',
      '  box-shadow: 0 1px 2px rgba(0,0,0,0.18) !important;',
      '}',
      // Light-mode equivalents (the cards already render fine in light, but
      // pin them so behavior is symmetric).
      'body.light #dash-money-left-card,',
      '[data-theme="light"] #dash-money-left-card,',
      'body.light #dash-financial-resilience,',
      '[data-theme="light"] #dash-financial-resilience {',
      '  background-color: #ffffff !important;',
      '  border-color: rgba(15, 23, 42, 0.08) !important;',
      '  box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important;',
      '}',
      // ---- Smooth inner color changes (no more flash) ----
      // Money Left widget has inline color styles on its main number, forecast,
      // percentage. We can\'t edit the inline styles from CSS without !important
      // because inline beats class-rule, but we CAN add a transition.
      '#money-left-body, #money-left-body * {',
      '  transition: color 320ms ease, background-color 320ms ease, border-color 320ms ease !important;',
      '}',
      // Financial Resilience inner elements (score badge, progress bars)
      '#dash-financial-resilience, #dash-financial-resilience * {',
      '  transition: color 320ms ease, background-color 320ms ease, border-color 320ms ease, width 400ms ease !important;',
      '}',
      // Belt-and-suspenders: kill any keyframe pulse animations that might be
      // running on these specific cards from older modules.
      '#dash-money-left-card, #dash-money-left-card *,',
      '#dash-financial-resilience, #dash-financial-resilience * {',
      '  animation-name: none !important;',
      '}'
    ].join('\n');

    var st = document.createElement('style');
    st.id = 'wjp-card-stable-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  window.WJP_CardStable = { version: 1, inject: inject };
})();
