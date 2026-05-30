/* wjp-sidebar-auto.js v1 — Sidebar Auto mode (hover-to-expand) + cleaner
 * collapsed appearance.
 *
 * Winston 2026-05-29: "this feature on setting for the side bar is useful.
 *   should have an auto mode where if you bring the mouse close it expands
 *   and if you take it away is colapses. also fix the look when its
 *   collapsed, doesnt look proper"
 *
 * What this adds:
 *   1. Three-mode sidebar pref: 'expanded' | 'collapsed' | 'auto'
 *      - expanded: full sidebar always
 *      - collapsed: icon-only sidebar always (existing behavior)
 *      - auto: collapsed at rest, expands while hovered
 *   2. New "Auto (hover to expand)" option injected into Settings >
 *      Appearance > Sidebar select. Patched whenever the select appears.
 *   3. CSS polish for the collapsed look: centered logo, centered nav
 *      icons, centered avatar — both for sidebar-collapsed AND for the
 *      at-rest auto state.
 *   4. Smooth width transition on hover for auto mode.
 *
 * Pref key: prefs.sidebarMode ('expanded' | 'collapsed' | 'auto').
 * Backwards compat: if absent, derive from existing prefs.sidebarCollapsed.
 *
 * Safe: IIFE, idempotent install, bare appState access, try/catch wrapped.
 * No hardcoded user data. Works for every account out of the box.
 */
(function () {
  'use strict';
  if (window._wjpSidebarAutoInstalled) return;
  window._wjpSidebarAutoInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  // ────────── pref read/write ──────────
  function getMode() {
    var s = getState();
    if (!s || !s.prefs) return 'expanded';
    if (typeof s.prefs.sidebarMode === 'string') {
      var v = s.prefs.sidebarMode.toLowerCase();
      if (v === 'expanded' || v === 'collapsed' || v === 'auto') return v;
    }
    // Backwards compat: derive from sidebarCollapsed
    return s.prefs.sidebarCollapsed ? 'collapsed' : 'expanded';
  }

  function applyMode(mode) {
    // Clear all sidebar mode classes first
    document.body.classList.remove('sidebar-collapsed');
    document.body.classList.remove('sidebar-auto');
    if (mode === 'collapsed') {
      document.body.classList.add('sidebar-collapsed');
    } else if (mode === 'auto') {
      document.body.classList.add('sidebar-auto');
    }
    // expanded = no class
    try { console.log('[wjp-sidebar-auto] applied mode:', mode); } catch (_) {}
  }

  function setMode(mode) {
    var s = getState();
    if (s) {
      if (!s.prefs) s.prefs = {};
      s.prefs.sidebarMode = mode;
      // Mirror to legacy boolean for any reader still using it
      s.prefs.sidebarCollapsed = (mode === 'collapsed');
      saveState();
    }
    applyMode(mode);
  }

  // ────────── CSS injection ──────────
  function injectStyle() {
    if (document.getElementById('wjp-sidebar-auto-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-sidebar-auto-style';
    st.textContent = [
      /* ===== Auto mode: collapsed at rest, expand on hover ===== */
      'body.sidebar-auto { --sidebar-width: 64px; }',
      'body.sidebar-auto .sidebar { width:64px; min-width:64px; transition: width .26s cubic-bezier(.16,1,.3,1), min-width .26s cubic-bezier(.16,1,.3,1), box-shadow .26s ease; overflow:hidden; position:relative; z-index:50; }',
      'body.sidebar-auto .sidebar:hover { width:240px; min-width:240px; box-shadow: 10px 0 30px rgba(20,30,25,0.12); }',
      'body.dark.sidebar-auto .sidebar:hover { box-shadow: 10px 0 30px rgba(0,0,0,0.45); }',
      /* At-rest auto = same as collapsed visually */
      'body.sidebar-auto .sidebar:not(:hover) .logo-text, body.sidebar-auto .sidebar:not(:hover) .nav-item span, body.sidebar-auto .sidebar:not(:hover) .user-info, body.sidebar-auto .sidebar:not(:hover) .nav-badge { display:none; }',
      'body.sidebar-auto .sidebar:not(:hover) .nav-item { justify-content:center; padding:10px; }',
      'body.sidebar-auto .sidebar:not(:hover) .sidebar-user { justify-content:center; }',

      /* ===== Polished collapsed look (applies to both modes at rest) ===== */
      'body.sidebar-collapsed .sidebar-logo, body.sidebar-auto .sidebar:not(:hover) .sidebar-logo { padding:18px 8px 18px; display:flex; justify-content:center; align-items:center; }',
      'body.sidebar-collapsed .logo-mark, body.sidebar-auto .sidebar:not(:hover) .logo-mark { justify-content:center; gap:0; width:100%; }',
      'body.sidebar-collapsed .logo-icon, body.sidebar-auto .sidebar:not(:hover) .logo-icon { margin:0 auto; display:flex; justify-content:center; align-items:center; width:40px; height:40px; }',
      'body.sidebar-collapsed .sidebar-nav, body.sidebar-auto .sidebar:not(:hover) .sidebar-nav { padding-left:6px; padding-right:6px; }',
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(:hover) .nav-item { padding:11px 0; margin:3px 4px; border-radius:10px; width:auto; gap:0; }',
      'body.sidebar-collapsed .nav-icon, body.sidebar-auto .sidebar:not(:hover) .nav-icon { margin:0 auto; font-size:20px; display:flex; justify-content:center; align-items:center; width:100%; }',
      'body.sidebar-collapsed .sidebar-bottom, body.sidebar-auto .sidebar:not(:hover) .sidebar-bottom { padding-left:6px; padding-right:6px; }',
      'body.sidebar-collapsed .sidebar-user, body.sidebar-auto .sidebar:not(:hover) .sidebar-user { padding:10px 0; justify-content:center; gap:0; }',
      'body.sidebar-collapsed .user-avatar, body.sidebar-auto .sidebar:not(:hover) .user-avatar { margin:0 auto; }',

      /* Tooltip on hover when collapsed — show full label */
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(:hover) .nav-item { position:relative; }',

      /* Smooth opacity for labels appearing on hover (auto mode only) */
      'body.sidebar-auto .sidebar .logo-text, body.sidebar-auto .sidebar .nav-item span, body.sidebar-auto .sidebar .user-info, body.sidebar-auto .sidebar .nav-badge { transition: opacity .18s ease; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── patch the Settings select to add "Auto" option ──────────
  function patchSelect(sel) {
    if (!sel || sel.dataset.wjpSidebarAutoPatched === '1') return;
    sel.dataset.wjpSidebarAutoPatched = '1';
    // Add the Auto option if not already present
    var hasAuto = false;
    Array.from(sel.options).forEach(function (o) { if (o.value === 'auto') hasAuto = true; });
    if (!hasAuto) {
      var opt = document.createElement('option');
      opt.value = 'auto';
      opt.textContent = 'Auto (hover to expand)';
      sel.appendChild(opt);
    }
    // Reflect current mode
    var mode = getMode();
    sel.value = mode;
    // Add our change listener — runs after the existing onchange
    sel.addEventListener('change', function () {
      var v = sel.value;
      if (v !== 'expanded' && v !== 'collapsed' && v !== 'auto') return;
      setMode(v);
    });
    try { console.log('[wjp-sidebar-auto] patched #app-nav select, current mode:', mode); } catch (_) {}
  }

  function findAndPatch() {
    var sel = document.getElementById('app-nav');
    if (sel) patchSelect(sel);
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    // Apply saved mode as soon as appState is ready
    var attempts = 0;
    function tryApply() {
      attempts++;
      var s = getState();
      if (s && s.prefs) {
        applyMode(getMode());
        return;
      }
      if (attempts < 50) setTimeout(tryApply, 200);
    }
    tryApply();

    // Re-apply after cloud restore (in case prefs change cross-device)
    window.addEventListener('wjp-data-restored', function () {
      setTimeout(function () { applyMode(getMode()); }, 300);
    });

    // Watch for the Settings > Appearance select to appear and patch it
    findAndPatch();
    try {
      var mo = new MutationObserver(function () { findAndPatch(); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {
      // Fallback: poll
      var iv = setInterval(findAndPatch, 1000);
      setTimeout(function () { clearInterval(iv); }, 60000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_SidebarAuto = {
    version: 1,
    getMode: getMode,
    setMode: setMode,
    applyMode: applyMode
  };
})();
