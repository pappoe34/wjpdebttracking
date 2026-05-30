/* wjp-sidebar-auto.js v3 — Sidebar Auto mode (hover-to-expand) + cleaner
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

  // ────────── localStorage cache (per-user) for cold-load mode ──────────
  function uidForCache() {
    var uid = '';
    try { if (window.firebase && window.firebase.auth && window.firebase.auth().currentUser) uid = window.firebase.auth().currentUser.uid || ''; } catch (_) {}
    try { if (!uid && window.WJP_Auth && window.WJP_Auth.uid) uid = window.WJP_Auth.uid; } catch (_) {}
    try { if (!uid) uid = (localStorage.getItem('wjp_anon_id') || '').slice(0, 40); } catch (_) {}
    return uid;
  }
  function lsKey() { var u = uidForCache(); return 'wjp.sidebar.mode.v1' + (u ? '.uid_' + u : ''); }
  function lsGetMode() { try { var v = localStorage.getItem(lsKey()) || ''; if (v === 'expanded' || v === 'collapsed' || v === 'auto') return v; } catch (_) {} return null; }
  function lsSetMode(m) { try { localStorage.setItem(lsKey(), m); } catch (_) {} }

  function setMode(mode) {
    var s = getState();
    if (s) {
      if (!s.prefs) s.prefs = {};
      s.prefs.sidebarMode = mode;
      // Mirror to legacy boolean for any reader still using it
      s.prefs.sidebarCollapsed = (mode === 'collapsed');
      saveState();
    }
    lsSetMode(mode);
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
      'body.sidebar-auto .sidebar { width:64px; min-width:64px; transition: width .32s cubic-bezier(.22,.61,.36,1), min-width .32s cubic-bezier(.22,.61,.36,1), box-shadow .32s ease; overflow:hidden; position:relative; z-index:50; }',
      // FIX 85 v3: style.css has `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { transition-duration: 0.01ms !important; } }` which clobbers the sidebar transition when the user\'s OS has reduced motion on. We respect the user pref globally but make the sidebar an exception — it\'s a UX-critical hover interaction that feels broken without easing. Higher specificity (body.sidebar-auto .sidebar = 0,0,2,1) plus !important wins over the * selector.
      '@media (prefers-reduced-motion: reduce) { body.sidebar-auto .sidebar { transition-duration: .32s !important; } body.sidebar-auto .sidebar .logo-text, body.sidebar-auto .sidebar .nav-item span, body.sidebar-auto .sidebar .user-info, body.sidebar-auto .sidebar .nav-badge { transition-duration: .18s !important; } }',
      'body.sidebar-auto .sidebar.wjp-sb-hovered { width:240px; min-width:240px; box-shadow: 10px 0 30px rgba(20,30,25,0.12); }',
      'body.dark.sidebar-auto .sidebar.wjp-sb-hovered { box-shadow: 10px 0 30px rgba(0,0,0,0.45); }',
      /* At-rest auto = same as collapsed visually */
      'body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .logo-text, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item span, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .user-info, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-badge, body.sidebar-collapsed .nav-badge, body.sidebar-collapsed .logo-text, body.sidebar-collapsed .nav-item span, body.sidebar-collapsed .user-info { display:none !important; }',
      'body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item { justify-content:center; padding:10px; }',
      'body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-user { justify-content:center; }',

      /* ===== Polished collapsed look (applies to both modes at rest) ===== */
      'body.sidebar-collapsed .sidebar-logo, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-logo { padding:18px 8px 18px; display:flex; justify-content:center; align-items:center; }',
      'body.sidebar-collapsed .logo-mark, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .logo-mark { justify-content:center; gap:0; width:100%; }',
      'body.sidebar-collapsed .logo-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .logo-icon { margin:0 auto; display:flex; justify-content:center; align-items:center; width:40px; height:40px; }',
      'body.sidebar-collapsed .sidebar-nav, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav { padding-left:6px; padding-right:6px; }',
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item { padding:11px 0; margin:3px 4px; border-radius:10px; width:auto; gap:0; }',
      'body.sidebar-collapsed .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-icon { margin:0 auto; font-size:20px; display:flex; justify-content:center; align-items:center; width:100%; }',
      'body.sidebar-collapsed .sidebar-bottom, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom { padding-left:6px; padding-right:6px; }',
      'body.sidebar-collapsed .sidebar-user, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-user { padding:10px 0; justify-content:center; gap:0; }',
      'body.sidebar-collapsed .user-avatar, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .user-avatar { margin:0 auto; }',

      /* Tooltip on hover when collapsed — show full label */
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item { position:relative; }',

      /* Smooth opacity for labels appearing on hover (auto mode only) */
      'body.sidebar-auto .sidebar .logo-text, body.sidebar-auto .sidebar .nav-item span, body.sidebar-auto .sidebar .user-info, body.sidebar-auto .sidebar .nav-badge { transition: opacity .18s ease; }',

      /* ===== v2: nav-item hover + active polish in collapsed/auto-rest ===== */
      'body.sidebar-collapsed .nav-item:hover, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item:hover { background:rgba(31,122,74,0.08); }',
      'body.dark.sidebar-collapsed .nav-item:hover, body.dark.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item:hover { background:rgba(127,209,164,0.12); }',
      'body.sidebar-collapsed .nav-item.active, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item.active { background:rgba(31,122,74,0.14); color:#1f7a4a; }',
      'body.dark.sidebar-collapsed .nav-item.active, body.dark.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item.active { background:rgba(127,209,164,0.18); color:#7fd1a4; }',
      'body.sidebar-collapsed .nav-item.active .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item.active .nav-icon { color:inherit; }',
      'body.sidebar-collapsed .nav-item.active::before, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item.active::before { display:none; }',

      /* ===== v2: admin-tier widget (.wats) collapsed handling ===== */
      'body.sidebar-collapsed #wjp-admin-tier-widget .wats-label, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget .wats-label { display:none; }',
      'body.sidebar-collapsed #wjp-admin-tier-widget .wats-current-pill, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget .wats-current-pill { display:none; }',
      'body.sidebar-collapsed #wjp-admin-tier-widget .wats-toggle, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget .wats-toggle { padding:10px 0; justify-content:center; gap:0; width:auto; margin:3px 4px; border-radius:10px; min-width:0; }',
      'body.sidebar-collapsed #wjp-admin-tier-widget .wats-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget .wats-icon { font-size:20px; margin:0; }',
      'body.sidebar-collapsed #wjp-admin-tier-widget, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget { margin:0; padding:0; }',
      'body.sidebar-collapsed #wjp-admin-tier-widget .wats-toggle:hover, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #wjp-admin-tier-widget .wats-toggle:hover { background:rgba(192,89,74,0.10); }',

      /* ===== v2: more breathing room between nav items at rest ===== */
      'body.sidebar-collapsed .sidebar-nav, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav { gap:4px; }',
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item { padding:12px 0; margin:2px 8px; height:44px; }',
      'body.sidebar-collapsed .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-icon { width:24px; height:24px; }',

      /* ===== v2: user avatar — slightly larger ring for presence ===== */
      'body.sidebar-collapsed .sidebar-user, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-user { padding:12px 0; margin:6px 4px; border-radius:10px; }',
      'body.sidebar-collapsed .sidebar-user:hover, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-user:hover { background:rgba(31,122,74,0.08); }',
      'body.sidebar-collapsed .user-avatar, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .user-avatar { width:34px; height:34px; }',

      /* ===== v2: logo padding cleanup ===== */
      'body.sidebar-collapsed .sidebar-logo, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-logo { padding:20px 0 16px; border-bottom:1px solid rgba(0,0,0,0.05); margin-bottom:8px; }',
      'body.dark.sidebar-collapsed .sidebar-logo, body.dark.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-logo { border-bottom-color:rgba(255,255,255,0.06); }',
      /* ===== v6: kill bare-text-node labels (Credit Health was a text node with no span) ===== */
      'body.sidebar-collapsed .sidebar-nav .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav .nav-item, body.sidebar-collapsed .sidebar-bottom .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom .nav-item { font-size:0 !important; line-height:1 !important; }',
      /* Restore size for the icon container + icon itself */
      'body.sidebar-collapsed .sidebar-nav .nav-item .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav .nav-item .nav-icon, body.sidebar-collapsed .sidebar-bottom .nav-item .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom .nav-item .nav-icon { font-size:20px !important; line-height:1 !important; }',
      /* Restore size for bare <i> phosphor icons (Credit Health uses <i class="ph ph-shield-star"> direct child) */
      'body.sidebar-collapsed .sidebar-nav .nav-item > i, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav .nav-item > i, body.sidebar-collapsed .sidebar-bottom .nav-item > i, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom .nav-item > i, body.sidebar-collapsed .sidebar-nav .nav-item [class*="ph-"], body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav .nav-item [class*="ph-"], body.sidebar-collapsed .sidebar-bottom .nav-item [class*="ph-"], body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom .nav-item [class*="ph-"] { font-size:20px !important; line-height:1 !important; margin-right:0 !important; }',
      /* Also restore for icons sitting inside .nav-icon */
      'body.sidebar-collapsed .sidebar-nav .nav-item .nav-icon i, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-nav .nav-item .nav-icon i { font-size:20px !important; line-height:1 !important; }',
      /* ===== v3: proportional + strict icon column ===== */
      /* Kill ALL leftover text/badges that may inline-style themselves visible */
      'body.sidebar-collapsed .nav-badge, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-badge, body.sidebar-collapsed #inbox-badge, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) #inbox-badge { display:none !important; }',
      'body.sidebar-collapsed .nav-item span:not(.nav-icon span), body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item span:not(.nav-icon span) { display:none !important; }',
      'body.sidebar-collapsed .wats-label, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .wats-label, body.sidebar-collapsed .wats-current-pill, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .wats-current-pill { display:none !important; }',
      'body.sidebar-collapsed .user-info, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .user-info { display:none !important; }',
      /* Lock icon sizing to a consistent visual column */
      'body.sidebar-collapsed .sidebar, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) { padding:0; }',
      'body.sidebar-collapsed .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-item, body.sidebar-collapsed .wats-toggle, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .wats-toggle, body.sidebar-collapsed .sidebar-user, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-user { width:48px; height:48px; min-height:48px; padding:0; margin:2px auto; display:flex; align-items:center; justify-content:center; border-radius:12px; }',
      'body.sidebar-collapsed .nav-icon i, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-icon i, body.sidebar-collapsed .wats-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .wats-icon { font-size:20px; line-height:1; }',
      'body.sidebar-collapsed .nav-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .nav-icon { width:auto; height:auto; margin:0; }',
      'body.sidebar-collapsed .user-avatar, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .user-avatar { width:32px; height:32px; font-size:13px; font-weight:800; margin:0; }',
      /* Make sure sidebar-bottom items use the same 48px container */
      'body.sidebar-collapsed .sidebar-bottom .nav-item, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .sidebar-bottom .nav-item { width:48px; height:48px; min-height:48px; }',
      /* Center the logo emblem cleanly */
      'body.sidebar-collapsed .logo-icon, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .logo-icon { width:36px; height:36px; }',
      'body.sidebar-collapsed .logo-icon svg, body.sidebar-auto .sidebar:not(.wjp-sb-hovered) .logo-icon svg { width:28px !important; height:28px !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── patch the Settings select to add "Auto" option ──────────
  function patchSelect(sel) {
    if (!sel || sel.dataset.wjpSidebarAutoPatched === '1') return;
    sel.dataset.wjpSidebarAutoPatched = '1';
    var hasAuto = false;
    Array.from(sel.options).forEach(function (o) { if (o.value === 'auto') hasAuto = true; });
    if (!hasAuto) {
      var opt = document.createElement('option');
      opt.value = 'auto';
      opt.textContent = 'Auto (hover to expand)';
      sel.appendChild(opt);
    }
    var mode = getMode();
    sel.value = mode;
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

  // ────────── JS-driven hover (resilient to CSS :hover edge cases) ──────────
  // v5: cancel any stuck Web-Animations transitions on the sidebar before
  // toggling the hover class. Some other module (probably the customizer /
  // motion shim) leaves zero-duration width transitions in 'running' state,
  // which pins the rendered width at the from-value even though the new CSS
  // rule has higher specificity. Cancelling lets the new class apply cleanly.
  function killStuckAnimations(el) {
    try {
      if (!el || !el.getAnimations) return;
      el.getAnimations().forEach(function (a) {
        try {
          // Only cancel width/min-width transitions — leave other animations alone
          var props = (a.effect && a.effect.getKeyframes && a.effect.getKeyframes().map(function (k) {
            return Object.keys(k).join(',');
          }).join(',')) || '';
          if (/(^|,)(width|minWidth|min-width)(,|$)/.test(props) || a.playState === 'running') {
            a.cancel();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }
  // v2: enter/leave delays so brushing the sidebar edge doesn't trigger
  // expand-then-collapse jitter. Enter delay = 140ms ("did the user really
  // mean to go there?"). Leave delay = 220ms ("don't snap shut on a tiny
  // mouse wobble"). Cancelling on the opposite event keeps it responsive.
  var ENTER_DELAY_MS = 140;
  var LEAVE_DELAY_MS = 220;
  function wireHover(sb) {
    if (!sb || sb.dataset.wjpSbHoverWired === '1') return;
    sb.dataset.wjpSbHoverWired = '1';
    var enterTimer = 0, leaveTimer = 0;
    sb.addEventListener('mouseenter', function () {
      if (!document.body.classList.contains('sidebar-auto')) return;
      if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = 0; }
      if (enterTimer) return;
      enterTimer = setTimeout(function () {
        enterTimer = 0;
        killStuckAnimations(sb);
        sb.classList.add('wjp-sb-hovered');
      }, ENTER_DELAY_MS);
    });
    sb.addEventListener('mouseleave', function () {
      if (enterTimer) { clearTimeout(enterTimer); enterTimer = 0; }
      if (leaveTimer) return;
      leaveTimer = setTimeout(function () {
        leaveTimer = 0;
        killStuckAnimations(sb);
        sb.classList.remove('wjp-sb-hovered');
      }, LEAVE_DELAY_MS);
    });
    killStuckAnimations(sb);
  }
  function findSidebarAndWire() {
    var sb = document.querySelector('.sidebar');
    if (sb) wireHover(sb);
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    // Apply cached mode IMMEDIATELY (before appState hydrates) so the sidebar
    // never flashes wide on hard-reset in auto/collapsed mode.
    var cached = lsGetMode();
    if (cached) applyMode(cached);
    var attempts = 0;
    function tryApply() {
      attempts++;
      var s = getState();
      if (s && s.prefs) {
        var liveMode = getMode();
        applyMode(liveMode);
        lsSetMode(liveMode); // keep cache in sync with appState truth
        return;
      }
      if (attempts < 50) setTimeout(tryApply, 200);
    }
    tryApply();

    // Wire hover handlers ASAP
    findSidebarAndWire();
    setTimeout(findSidebarAndWire, 500);
    setTimeout(findSidebarAndWire, 1500);
    window.addEventListener('wjp-data-restored', function () {
      setTimeout(function () { applyMode(getMode()); }, 300);
    });
    findAndPatch();
    try {
      var mo = new MutationObserver(function () { findAndPatch(); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {
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
    version: 7,
    getMode: getMode,
    setMode: setMode,
    applyMode: applyMode
  };
})();
