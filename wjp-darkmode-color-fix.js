/* wjp-darkmode-color-fix.js v1 — repair black-on-dark text site-wide.
 *
 * Several modules ship inline `color:#0a0a0a`, `color:#1f7a4a`, or chains like
 * `var(--text-1, #0a0a0a)` where the host doesn't set `--text-1` in dark mode.
 * In dark mode these render as black text on a near-black surface — invisible.
 *
 * Rather than patch every offending file, this overlay injects ONE stylesheet:
 *   1. Defines `--text-1` as `--ink` in dark mode so every chained fallback resolves
 *   2. Force-flips inline `color:#0a0a0a` / `rgb(10,10,10)` to `--ink` in dark mode
 *   3. Force-flips inline `color:#1f7a4a` / `rgb(31,122,74)` to a brighter accent green
 * Backgrounds and borders that use the same hex values are untouched.
 */
(function () {
  'use strict';
  if (window._wjpDarkColorFixInstalled) return;
  window._wjpDarkColorFixInstalled = true;

  function inject() {
    if (document.getElementById('wjp-darkmode-color-fix-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-darkmode-color-fix-style';
    st.textContent = ''
      // (1) Define --text-1 in dark mode so var(--text-1, #0a0a0a) resolves to ink.
      //     We use both data-theme="dark" and body.dark selectors to cover whatever
      //     the host uses to mark dark mode.
      + 'html[data-theme="dark"], html[data-theme="dark"] body, body.dark, html.dark {\n'
      + '  --text-1: var(--ink, #f0f4ff);\n'
      + '}\n'
      // (2) Inline color:#0a0a0a → --ink (light) in dark mode
      + 'html[data-theme="dark"] [style*="color:#0a0a0a" i],\n'
      + 'html[data-theme="dark"] [style*="color: #0a0a0a" i],\n'
      + 'html[data-theme="dark"] [style*="color:rgb(10,10,10)" i],\n'
      + 'html[data-theme="dark"] [style*="color: rgb(10, 10, 10)" i],\n'
      + 'html[data-theme="dark"] [style*="color:rgb(10, 10, 10)" i],\n'
      + 'body.dark [style*="color:#0a0a0a" i],\n'
      + 'body.dark [style*="color: #0a0a0a" i],\n'
      + 'body.dark [style*="color:rgb(10,10,10)" i],\n'
      + 'body.dark [style*="color: rgb(10, 10, 10)" i] {\n'
      + '  color: var(--ink, #f0f4ff) !important;\n'
      + '}\n'
      // (3) Inline color:#1f7a4a / rgb(31,122,74) → brighter accent green in dark mode
      + 'html[data-theme="dark"] [style*="color:#1f7a4a" i],\n'
      + 'html[data-theme="dark"] [style*="color: #1f7a4a" i],\n'
      + 'html[data-theme="dark"] [style*="color:rgb(31,122,74)" i],\n'
      + 'html[data-theme="dark"] [style*="color: rgb(31, 122, 74)" i],\n'
      + 'html[data-theme="dark"] [style*="color:rgb(31, 122, 74)" i],\n'
      + 'body.dark [style*="color:#1f7a4a" i],\n'
      + 'body.dark [style*="color: #1f7a4a" i],\n'
      + 'body.dark [style*="color:rgb(31,122,74)" i],\n'
      + 'body.dark [style*="color: rgb(31, 122, 74)" i] {\n'
      + '  color: var(--accent, #00d4a8) !important;\n'
      + '}\n'
      // (4) Specific class-based fixes for components we know about — belt + suspenders
      + 'html[data-theme="dark"] .wjp-dfd-savings,\n'
      + 'html[data-theme="dark"] .wjp-chip-savings,\n'
      + 'html[data-theme="dark"] #wjp-hp-selected-pill,\n'
      + 'body.dark .wjp-dfd-savings,\n'
      + 'body.dark .wjp-chip-savings,\n'
      + 'body.dark #wjp-hp-selected-pill {\n'
      + '  color: var(--accent, #00d4a8) !important;\n'
      + '}\n'
      // (5) "Length-opt active" button — active state was rgb(11,15,26) (dark) on dark
      + 'html[data-theme="dark"] .wjp-length-opt.active,\n'
      + 'body.dark .wjp-length-opt.active {\n'
      + '  color: #0b0f1a !important;\n'
      + '  background: var(--accent, #00d4a8) !important;\n'
      + '}\n';
    (document.head || document.documentElement).appendChild(st);
    try { console.log('[wjp-darkmode-color-fix] injected'); } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
