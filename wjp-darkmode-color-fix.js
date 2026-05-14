/* wjp-darkmode-color-fix.js v2 — repair black-on-dark text site-wide.
 *
 * v1 fixed inline-style offenders; v2 adds class-based selectors for elements
 * whose dark text is defined in CSS classes (not inline). Scanner found many
 * .strat-title, .top3-title, h3, .wjp-private and similar rendering near-black
 * on dark surfaces. Class-selector fixes target these specifically.
 */
(function () {
  'use strict';
  if (window._wjpDarkColorFixInstalled) return;
  window._wjpDarkColorFixInstalled = true;

  function inject() {
    var existing = document.getElementById('wjp-darkmode-color-fix-style');
    if (existing) existing.remove();
    var st = document.createElement('style');
    st.id = 'wjp-darkmode-color-fix-style';
    st.textContent = [
      // (1) Define --text-1 in dark mode so chained fallbacks resolve to ink
      'html[data-theme="dark"], html[data-theme="dark"] body, body.dark, html.dark {',
      '  --text-1: var(--ink, #f0f4ff);',
      '}',

      // (2) Inline color:#0a0a0a / rgb(10,10,10) → --ink in dark mode
      'html[data-theme="dark"] [style*="color:#0a0a0a" i],',
      'html[data-theme="dark"] [style*="color: #0a0a0a" i],',
      'html[data-theme="dark"] [style*="color:rgb(10,10,10)" i],',
      'html[data-theme="dark"] [style*="color: rgb(10, 10, 10)" i],',
      'body.dark [style*="color:#0a0a0a" i],',
      'body.dark [style*="color:rgb(10,10,10)" i] {',
      '  color: var(--ink, #f0f4ff) !important;',
      '}',

      // (3) Inline color:#1f7a4a / rgb(31,122,74) → --accent in dark mode
      'html[data-theme="dark"] [style*="color:#1f7a4a" i],',
      'html[data-theme="dark"] [style*="color: #1f7a4a" i],',
      'html[data-theme="dark"] [style*="color:rgb(31,122,74)" i],',
      'html[data-theme="dark"] [style*="color: rgb(31, 122, 74)" i],',
      'body.dark [style*="color:#1f7a4a" i],',
      'body.dark [style*="color:rgb(31,122,74)" i] {',
      '  color: var(--accent, #00d4a8) !important;',
      '}',

      // (4) Class-based offenders — rgb(10,10,10) zone (Financial Resilience labels, etc.)
      'html[data-theme="dark"] .wjp-private,',
      'body.dark .wjp-private {',
      '  color: var(--ink, #f0f4ff) !important;',
      '}',

      // (5) Class-based offenders — rgb(20,20,20) zone (headings, brand text, etc.)
      'html[data-theme="dark"] .top3-title,',
      'html[data-theme="dark"] .strat-title,',
      'html[data-theme="dark"] .header-brand-text,',
      'html[data-theme="dark"] .user-name,',
      'html[data-theme="dark"] .header-title,',
      'body.dark .top3-title,',
      'body.dark .strat-title,',
      'body.dark .header-brand-text,',
      'body.dark .user-name,',
      'body.dark .header-title {',
      '  color: var(--ink, #f0f4ff) !important;',
      '}',

      // (6) Class-based offenders — dark green text (rgb(31,122,74)) → brighter accent
      'html[data-theme="dark"] .wjp-dfd-savings,',
      'html[data-theme="dark"] .wjp-chip-savings,',
      'html[data-theme="dark"] #wjp-hp-selected-pill,',
      'html[data-theme="dark"] .user-plan,',
      'html[data-theme="dark"] .section-label,',
      'html[data-theme="dark"] .header-nav-item.active,',
      'html[data-theme="dark"] .dfd-strategy,',
      'html[data-theme="dark"] #freedom-badge-text,',
      'html[data-theme="dark"] #dash-autofit-state,',
      'body.dark .wjp-dfd-savings,',
      'body.dark .wjp-chip-savings,',
      'body.dark #wjp-hp-selected-pill,',
      'body.dark .user-plan,',
      'body.dark .section-label,',
      'body.dark .header-nav-item.active,',
      'body.dark .dfd-strategy,',
      'body.dark #freedom-badge-text,',
      'body.dark #dash-autofit-state {',
      '  color: var(--accent, #00d4a8) !important;',
      '}',

      // (7) Sidebar nav text — rgb(74,85,104) is dim but readable; brighten slightly
      'html[data-theme="dark"] .sidebar-nav span,',
      'html[data-theme="dark"] .header-nav-item,',
      'html[data-theme="dark"] .dfd-eyebrow,',
      'body.dark .sidebar-nav span,',
      'body.dark .header-nav-item,',
      'body.dark .dfd-eyebrow {',
      '  color: var(--text-3, #a0aec0) !important;',
      '}',

      // (8) Length-opt active — was dark text on darker bg
      'html[data-theme="dark"] .wjp-length-opt.active,',
      'body.dark .wjp-length-opt.active {',
      '  color: #0b0f1a !important;',
      '  background: var(--accent, #00d4a8) !important;',
      '}',

      // (9) Nav-badge — accent-colored pill with dark text; only fix if bg is dark
      '/* Leave nav-badge alone — it already has its own bg/color combo */'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
    try { console.log('[wjp-darkmode-color-fix] v2 injected'); } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
  // Re-inject after 2s in case host removes our stylesheet
  setTimeout(inject, 2000);
})();
