/* ============================================================================
   WJP Dark Mode Toggle (W4)
   Floating bottom-left theme toggle for marketing pages.
   Persists choice in localStorage. Defaults to OS preference if no override.
   ============================================================================ */
(function () {
  'use strict';
  if (window._wjpThemeToggleInstalled) return;
  window._wjpThemeToggleInstalled = true;

  const KEY = 'wjp.theme';

  function applySaved() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch(_) {}
  }

  function current() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch(_) {}
    updateBtn();
  }

  function updateBtn() {
    const btn = document.querySelector('.wjp-theme-toggle');
    if (!btn) return;
    const isDark = current() === 'dark';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.innerHTML = isDark
      ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  function inject() {
    if (document.querySelector('.wjp-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'wjp-theme-toggle';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    updateBtn();
  }

  applySaved();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  window.WJP_Theme = { current, toggle };
})();
