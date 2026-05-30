/* wjp-dashboard-grid-slots.js v5 — Optional 12-column grid layout for the
 * dashboard. Each card can declare a slot size of 1, 2, or 3 fit:
 *   • 1-fit  = full row    (grid-column span 12)
 *   • 2-fit  = half row    (grid-column span 6)
 *   • 3-fit  = third row   (grid-column span 4)
 *
 * Cards auto-flow with `grid-auto-flow: dense` so gaps get packed.
 *
 * Winston 2026-05-29: "there should be an invisible layout each box can fit
 *   in, a 1 fit box, 2 fit box, and 3 fit. user picks the layout or auto fit
 *   does it. makes proportions cleaner and more aligned and helps fit more."
 *
 * Features:
 *   1. Body class `dashboard-grid-slots` activates the whole system. Off by
 *      default — flipping it off restores the original flex-wrap layout
 *      exactly. That's the revert path: 1 toggle, no DOM mutation lost.
 *   2. Seeds each card's slot from its existing `data-size`:
 *        Full / L  → 1-fit
 *        M         → 2-fit
 *        S         → 3-fit
 *      Cards without data-size default to 2-fit.
 *   3. Manual override: when the user enters customize mode (body
 *      .dash-customizing), each card gets a tiny `[1] [2] [3]` chip
 *      toolbar in its top-right corner. Click → updates the card's slot.
 *      Saves to `prefs.cardSlots = { cardId: 1|2|3 }`.
 *   4. Auto-fit slots: when enabled (prefs.gridAutoFit = true), manual
 *      overrides are ignored and slots are reassigned every render from
 *      the same data-size mapping.
 *   5. Two gear-menu items get added:
 *        • Layout grid       (On / Off)  ← master switch
 *        • Auto-fit slots    (On / Off)  ← when grid is on
 *
 * Compact header and other non-card direct children of #page-dashboard
 * auto-receive `grid-column: 1 / -1` so they span the full row and don't
 * break the grid.
 *
 * Safe: IIFE, idempotent install, no destructive DOM changes (only adds
 * `data-card-slot` attributes and a small toolbar in customize mode).
 */
(function () {
  'use strict';
  if (window._wjpDashboardGridSlotsInstalled) return;
  window._wjpDashboardGridSlotsInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var STYLE_ID = 'wjp-dashboard-grid-slots-style';
  var BODY_CLASS = 'dashboard-grid-slots';
  var MENU_ID = 'wjp-compact-header-menu';
  var TOOLBAR_CLASS = 'wjp-card-slot-toolbar';


  // FIX 84 v4: URL flags ?grid=1/?grid=0 override the saved pref, which breaks
  // the menu toggle once a URL flag has been used. After an explicit user
  // action, strip the flag so the saved pref drives behavior.
  function stripUrlFlag(name) {
    try {
      var q = location.search || '';
      var re = new RegExp('([?&])' + name + '=[01]&?', 'i');
      var clean = q.replace(re, function (m, p) { return p === '?' ? '?' : ''; }).replace(/[?&]$/, '');
      if (clean !== q) history.replaceState(null, '', location.pathname + clean + location.hash);
    } catch (_) {}
  }

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  // ───── prefs ─────
  function isGridEnabled() {
    try {
      var q = (location.search || '').toLowerCase();
      if (q.indexOf('grid=1') !== -1) return true;
      if (q.indexOf('grid=0') !== -1) return false;
    } catch (_) {}
    var s = getState();
    return !!(s && s.prefs && s.prefs.gridSlots);
  }
  function setGridEnabled(v) {
    stripUrlFlag('grid');
    var s = getState();
    if (s) {
      if (!s.prefs) s.prefs = {};
      s.prefs.gridSlots = !!v;
      saveState();
    }
    apply();
  }
  function isAutoFit() {
    var s = getState();
    // Default ON when user hasn't chosen
    if (!s || !s.prefs || s.prefs.gridAutoFit === undefined) return true;
    return !!s.prefs.gridAutoFit;
  }
  function setAutoFit(v) {
    var s = getState();
    if (s) {
      if (!s.prefs) s.prefs = {};
      s.prefs.gridAutoFit = !!v;
      saveState();
    }
    applyAllSlots();
  }
  function getSavedSlot(cardId) {
    if (!cardId) return null;
    var s = getState();
    var map = s && s.prefs && s.prefs.cardSlots;
    if (!map || typeof map !== 'object') return null;
    var v = map[cardId];
    return (v === 1 || v === 2 || v === 3) ? v : null;
  }
  function setSavedSlot(cardId, slot) {
    if (!cardId) return;
    var s = getState();
    if (!s) return;
    if (!s.prefs) s.prefs = {};
    if (!s.prefs.cardSlots || typeof s.prefs.cardSlots !== 'object') s.prefs.cardSlots = {};
    if (slot === 1 || slot === 2 || slot === 3) s.prefs.cardSlots[cardId] = slot;
    else delete s.prefs.cardSlots[cardId];
    saveState();
  }

  // ───── slot heuristic ─────
  function inferSlotFromCard(card) {
    // FIX 84 v5: bias default toward slot 3 (third-width) so grid mode produces
    // visibly denser, more obviously gridded layouts. Slot 2 (half) used to win
    // by default which looked identical to the old flex-wrap at 50%.
    if (!card) return 3;
    var sz = (card.getAttribute('data-size') || '').toLowerCase();
    if (sz === 'full' || sz === 'l' || sz === 'large') return 1;
    if (sz === 'm' || sz === 'medium') return 2;
    if (sz === 's' || sz === 'small') return 3;
    // Wider hint: heroes/strategy/spending-style ids → slot 1
    var id = (card.id || '').toLowerCase();
    if (/hero|strategy|spending|breakdown|exec/.test(id)) return 1;
    // Compact widgets (credit, scoreboard, ai-bites, debt-fact, last-week)
    if (/credit|score|fact|bites|widget|tip|streak|last-?week/.test(id)) return 3;
    return 3;
  }

  function computeSlot(card) {
    var id = card.getAttribute('data-card-id') || card.id || '';
    if (!isAutoFit()) {
      var saved = getSavedSlot(id);
      if (saved) return saved;
    }
    return inferSlotFromCard(card);
  }

  function applyCardSlot(card) {
    if (!card) return;
    var slot = computeSlot(card);
    card.setAttribute('data-card-slot', String(slot));
  }

  function applyAllSlots() {
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    Array.from(page.querySelectorAll('.reorderable')).forEach(applyCardSlot);
    // For customize-mode toolbars
    if (document.body.classList.contains('dash-customizing')) {
      injectToolbars();
    }
  }

  // ───── style ─────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      // Grid container
      'html body.' + BODY_CLASS + ' #page-dashboard.active { display: grid !important; grid-template-columns: repeat(12, 1fr) !important; grid-auto-flow: dense !important; gap: 16px !important; align-items: start !important; }',
      // Non-card direct children (compact header, hidden originals, customize bar) span full row
      'html body.' + BODY_CLASS + ' #page-dashboard.active > #wjp-compact-header { grid-column: 1 / -1 !important; }',
      'html body.' + BODY_CLASS + ' #page-dashboard.active > #dash-customize-bar { grid-column: 1 / -1 !important; }',
      'html body.' + BODY_CLASS + ' #page-dashboard.active > div:not(.reorderable):not(.card) { grid-column: 1 / -1 !important; }',
      // Card slots
      'html body.' + BODY_CLASS + ' #page-dashboard.active .reorderable[data-card-slot="1"] { grid-column: span 12 !important; }',
      'html body.' + BODY_CLASS + ' #page-dashboard.active .reorderable[data-card-slot="2"] { grid-column: span 6 !important; }',
      'html body.' + BODY_CLASS + ' #page-dashboard.active .reorderable[data-card-slot="3"] { grid-column: span 4 !important; }',
      // Cards without explicit slot (safety fallback) span half
      'html body.' + BODY_CLASS + ' #page-dashboard.active .reorderable:not([data-card-slot]) { grid-column: span 6 !important; }',

      // Slot toolbar (only shown in customize mode)
      '.' + TOOLBAR_CLASS + ' { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; padding: 4px; background: rgba(255,255,255,0.94); border: 1px solid var(--border, rgba(0,0,0,0.10)); border-radius: 8px; z-index: 30; backdrop-filter: blur(4px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }',
      'body.dark .' + TOOLBAR_CLASS + ' { background: rgba(20,30,40,0.92); border-color: rgba(255,255,255,0.10); }',
      '.' + TOOLBAR_CLASS + ' button { background: transparent; border: 0; padding: 4px 9px; font-size: 11px; font-weight: 800; font-family: inherit; color: var(--ink-dim, #6b7280); border-radius: 5px; cursor: pointer; min-width: 24px; }',
      '.' + TOOLBAR_CLASS + ' button:hover { background: rgba(31,122,74,0.10); color: #1f7a4a; }',
      '.' + TOOLBAR_CLASS + ' button.is-active { background: #1f7a4a; color: #fff; }',
      'body.dark .' + TOOLBAR_CLASS + ' button.is-active { background: #7fd1a4; color: #0a0a0a; }',
      // Make reorderable cards positioning context for the toolbar
      'html body.' + BODY_CLASS + ' #page-dashboard.active .reorderable { position: relative; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ───── customize-mode toolbars ─────
  function injectToolbars() {
    if (!isGridEnabled()) return;
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    Array.from(page.querySelectorAll('.reorderable')).forEach(function (card) {
      if (card.querySelector(':scope > .' + TOOLBAR_CLASS)) return;
      var cur = parseInt(card.getAttribute('data-card-slot'), 10) || 2;
      var bar = document.createElement('div');
      bar.className = TOOLBAR_CLASS;
      bar.innerHTML =
        '<button type="button" data-slot="1" title="Full width (1-fit)"' + (cur === 1 ? ' class="is-active"' : '') + '>1</button>' +
        '<button type="button" data-slot="2" title="Half width (2-fit)"' + (cur === 2 ? ' class="is-active"' : '') + '>2</button>' +
        '<button type="button" data-slot="3" title="Third width (3-fit)"' + (cur === 3 ? ' class="is-active"' : '') + '>3</button>';
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-slot]');
        if (!b) return;
        e.stopPropagation();
        var slot = parseInt(b.getAttribute('data-slot'), 10);
        var id = card.getAttribute('data-card-id') || card.id || '';
        setSavedSlot(id, slot);
        // If auto-fit is on, the user clicking means they want manual control
        if (isAutoFit()) setAutoFit(false);
        card.setAttribute('data-card-slot', String(slot));
        bar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      });
      card.appendChild(bar);
    });
  }
  function stripToolbars() {
    document.querySelectorAll('.' + TOOLBAR_CLASS).forEach(function (b) { try { b.remove(); } catch (_) {} });
  }

  // Watch body.dash-customizing
  function watchCustomizeMode() {
    var mo = new MutationObserver(function () {
      if (!isGridEnabled()) return;
      if (document.body.classList.contains('dash-customizing')) injectToolbars();
      else stripToolbars();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // ───── apply / unapply ─────
  var _autofitWasOn = false;
  function apply() {
    var on = isGridEnabled();
    var b = document.body;
    if (on) {
      // FIX 84 v3: dash-autofit's CSS has identical specificity (0,0,3,1) to ours,
      // so cascade order can leave its display:flex !important winning. Remove the
      // class while grid mode is on; remember its prior state so we can restore.
      if (b.classList.contains('dash-autofit')) {
        _autofitWasOn = true;
        b.classList.remove('dash-autofit');
      }
      b.classList.add(BODY_CLASS);
      applyAllSlots();
    } else {
      b.classList.remove(BODY_CLASS);
      if (_autofitWasOn) {
        b.classList.add('dash-autofit');
        _autofitWasOn = false;
      }
      stripToolbars();
    }
    // Reflect in menu pills
    var gp = document.querySelector('#' + MENU_ID + ' [data-grid-state]');
    if (gp) gp.textContent = on ? 'On' : 'Off';
    var af = document.querySelector('#' + MENU_ID + ' [data-grid-autofit-state]');
    if (af) af.textContent = isAutoFit() ? 'On' : 'Off';
  }

  // ───── menu patcher ─────

  function closeCompactMenu() {
    var m = document.getElementById(MENU_ID);
    if (m) try { m.remove(); } catch (_) {}
  }

  function patchMenu(menu) {
    if (!menu || menu.dataset.wjpGridPatched === '1') return;
    menu.dataset.wjpGridPatched = '1';
    var rowGrid = document.createElement('div');
    rowGrid.className = 'wjp-ch-item';
    rowGrid.setAttribute('role', 'menuitem');
    rowGrid.setAttribute('data-action', 'grid-toggle');
    rowGrid.innerHTML =
      '<i class="ph ph-grid-four"></i>' +
      '<span class="wjp-ch-label">Layout grid</span>' +
      '<span class="wjp-ch-state" data-grid-state>' + (isGridEnabled() ? 'On' : 'Off') + '</span>';
    rowGrid.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setGridEnabled(!isGridEnabled());
      // Close menu so the dashboard relayout is unambiguous to the user
      setTimeout(closeCompactMenu, 60);
    });

    var rowAuto = document.createElement('div');
    rowAuto.className = 'wjp-ch-item';
    rowAuto.setAttribute('role', 'menuitem');
    rowAuto.setAttribute('data-action', 'grid-autofit');
    rowAuto.innerHTML =
      '<i class="ph ph-magic-wand"></i>' +
      '<span class="wjp-ch-label">Auto-fit slots</span>' +
      '<span class="wjp-ch-state" data-grid-autofit-state>' + (isAutoFit() ? 'On' : 'Off') + '</span>';
    rowAuto.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setAutoFit(!isAutoFit());
    });

    // Insert at the top of the menu
    menu.insertBefore(rowAuto, menu.firstChild);
    menu.insertBefore(rowGrid, menu.firstChild);
  }

  function attachMenuObserver() {
    try {
      var mo = new MutationObserver(function () {
        var menu = document.getElementById(MENU_ID);
        if (menu) patchMenu(menu);
      });
      mo.observe(document.body, { childList: true });
    } catch (_) {}
    var m = document.getElementById(MENU_ID);
    if (m) patchMenu(m);
  }

  // ───── re-apply on relevant events ─────
  function attachReapplyHooks() {
    window.addEventListener('wjp-data-restored', function () { setTimeout(apply, 300); });
    // When new cards are added to the dashboard (audit-fix etc), tag them
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    try {
      var mo = new MutationObserver(function (mutations) {
        if (!isGridEnabled()) return;
        var any = mutations.some(function (m) {
          return m.type === 'childList' && Array.from(m.addedNodes).some(function (n) {
            return n && n.nodeType === 1 && n.classList && n.classList.contains('reorderable');
          });
        });
        if (any) applyAllSlots();
      });
      mo.observe(page, { childList: true });
    } catch (_) {}
  }

  function boot() {
    injectStyle();
    // Apply when appState lands
    apply();
    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      var s = getState();
      if (s && s.prefs) { apply(); clearInterval(iv); }
      if (attempts > 50) clearInterval(iv);
    }, 250);
    attachMenuObserver();
    watchCustomizeMode();
    attachReapplyHooks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardGridSlots = {
    version: 5,
    isEnabled: isGridEnabled,
    setEnabled: setGridEnabled,
    isAutoFit: isAutoFit,
    setAutoFit: setAutoFit,
    applyAll: applyAllSlots,
    apply: apply
  };
})();
