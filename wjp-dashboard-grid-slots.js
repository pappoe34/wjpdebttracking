/* wjp-dashboard-grid-slots.js v12 — Optional 12-column grid layout for the
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
  // FIX 84 v11: saveState() persists to localStorage, AND its cloud-sync hook
  // pushes to Firestore via cloudPushDebounced (400ms). We also call
  // cloudPushNow when available so customizations sync to the user's other
  // devices without waiting for the debounce window.
  function saveState() {
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { if (typeof window.cloudPushNow === 'function') window.cloudPushNow(); } catch (_) {}
  }

  // ───── prefs ─────
  function isGridEnabled() {
    // FIX 84 v8: Winston wants grid mode always on, no toggle. The function is
    // kept (other modules may call it) but it now unconditionally returns true.
    return true;
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
    // Refresh menu pill so user sees the state change immediately.
    var af = document.querySelector('#' + MENU_ID + ' [data-grid-autofit-state]');
    if (af) af.textContent = isAutoFit() ? 'On' : 'Off';
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
    // FIX 89: default to slot 2 (half-width). Slot 3 (third) was too narrow
    // for content-heavy cards like Assets, Bank Balances, Active Target —
    // headings wrapped, numbers overlapped. Only force slot 3 for cards that
    // are clearly tiny widgets (single stat / badge / tip).
    if (!card) return 2;

    // 1) Explicit data-size always wins
    var sz = (card.getAttribute('data-size') || '').toLowerCase();
    if (sz === 'full' || sz === 'l' || sz === 'large') return 1;
    if (sz === 'm' || sz === 'medium') return 2;
    if (sz === 's' || sz === 'small') return 3;

    // 2) Specific card-id overrides
    var dataId = (card.getAttribute('data-card-id') || '').toLowerCase();
    if (dataId === 'resilience') return 2;
    if (dataId === 'wjp-edu-tip') return 3;
    if (dataId === 'last-7-days') return 1;
    if (dataId === 'exec-summary') return 1;
    if (dataId === 'strategy-indicators') return 1;
    if (dataId === 'spending') return 1;
    if (dataId === 'wjp-debit-balances') return 2;
    if (dataId === 'assets') return 2;
    if (dataId === 'wjp-active-target') return 2;
    if (dataId === 'upcoming') return 2;
    if (dataId === 'math-breakdown') return 1;

    // 3) ID-based heuristic — heroes and big-content cards
    var id = (card.id || '').toLowerCase();
    if (/hero|strategy|spending|breakdown|exec/.test(id)) return 1;
    // Only tiny widget-style cards get slot 3 (third)
    if (/credit-profile|score-card|fact-card|bites|debt-fact|edu-tip|streak|tip$/.test(id)) return 3;

    // 4) Content-heavy detection: if the card has a list with 3+ rows or
    // substantial inner structure, it deserves slot 2 (half) for readability.
    try {
      var rowCount = card.querySelectorAll(':scope .bank-row, :scope .row-item, :scope li, :scope [class*="row"]').length;
      if (rowCount >= 3) return 2;
    } catch (_) {}

    // 5) Default: slot 2 (half). Better than slot 3 for unknown cards.
    return 2;
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
    Array.from(page.querySelectorAll(':scope > .reorderable')).forEach(applyCardSlot);
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
      'html body.' + BODY_CLASS + ' #page-dashboard.active { display: grid !important; grid-template-columns: repeat(12, 1fr) !important; grid-auto-flow: dense !important; gap: 16px !important; align-items: stretch !important; }',
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
      '.' + TOOLBAR_CLASS + ' { display: inline-flex; gap: 4px; margin-left: 6px; }',
      '.' + TOOLBAR_CLASS + ' .card-rc-btn[aria-pressed="true"] { background: #1f7a4a; color: #fff; border-color: transparent; }',
      'body.dark .' + TOOLBAR_CLASS + ' .card-rc-btn[aria-pressed="true"] { background: #7fd1a4; color: #0a0a0a; }',
      // FIX 84 v6: When grid mode is on, the slot system supersedes S/M/L.
      // Hide the existing size buttons so our 1/2/3 chips don\'t overlap.
      'body.' + BODY_CLASS + ' .card-rc-size-group { display: none !important; }',
      // Equal-height: when one row has mixed-height content, stretch cards to fill.
      'body.' + BODY_CLASS + ' #page-dashboard.active .reorderable { height: 100% !important; }',
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
    Array.from(page.querySelectorAll(':scope > .reorderable')).forEach(function (card) {
      if (card.querySelector(':scope > .card-reorder-controls .' + TOOLBAR_CLASS)) return;
      var host = card.querySelector(':scope > .card-reorder-controls');
      if (!host) return; // no controls strip on this card — skip rather than pollute body
      var cur = parseInt(card.getAttribute('data-card-slot'), 10) || 3;
      var bar = document.createElement('div');
      bar.className = TOOLBAR_CLASS + ' card-rc-group';
      bar.innerHTML =
        '<button type="button" class="card-rc-btn" data-slot="1" title="Full width (1-fit)"' + (cur === 1 ? ' aria-pressed="true"' : '') + '>1</button>' +
        '<button type="button" class="card-rc-btn" data-slot="2" title="Half width (2-fit)"' + (cur === 2 ? ' aria-pressed="true"' : '') + '>2</button>' +
        '<button type="button" class="card-rc-btn" data-slot="3" title="Third width (3-fit)"' + (cur === 3 ? ' aria-pressed="true"' : '') + '>3</button>';
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-slot]');
        if (!b) return;
        e.stopPropagation();
        var slot = parseInt(b.getAttribute('data-slot'), 10);
        var id = card.getAttribute('data-card-id') || card.id || '';
        setSavedSlot(id, slot);
        if (isAutoFit()) setAutoFit(false);
        card.setAttribute('data-card-slot', String(slot));
        bar.querySelectorAll('button').forEach(function (x) {
          if (x === b) x.setAttribute('aria-pressed','true');
          else x.removeAttribute('aria-pressed');
        });
      });
      host.appendChild(bar);
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

    // FIX 84 v8: Layout grid is now always on — no menu toggle. Only Auto-fit
    // slots remains, so the user can flip between heuristic auto-assignment
    // and the manual chip overrides they set in customize mode.
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

    menu.insertBefore(rowAuto, menu.firstChild);
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
    // After local restore OR a cloud pull lands, re-apply so slot assignments
    // from other devices show without a refresh.
    window.addEventListener('wjp-data-restored', function () { setTimeout(apply, 300); });
    window.addEventListener('wjp-state-pulled', function () { setTimeout(apply, 200); });
    window.addEventListener('wjp-cloud-pulled', function () { setTimeout(apply, 200); });
    // When new cards are added to the dashboard (audit-fix etc), tag them
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    try {
      var mo = new MutationObserver(function (mutations) {
        if (!isGridEnabled()) return;
        var any = mutations.some(function (m) {
          return m.type === 'childList' && Array.from(m.addedNodes).some(function (n) {
            return n && n.nodeType === 1 && n.classList && n.classList.contains('reorderable') && n.parentElement === page;
          });
        });
        if (any) applyAllSlots();
      });
      mo.observe(page, { childList: true });
    } catch (_) {}
  }

  function boot() {
    injectStyle();
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
    attachControlsHealer();
  }

  // FIX 84 v9: certain cards (Bank Balances, Active Target, Last 7 Days, AI
  // Insight, Resilience) re-render their innerHTML during customize mode,
  // wiping the .card-reorder-controls strip app.js appends. Watch for that
  // and re-inject controls + chips. Debounced so render loops don't thrash.
  var _healTimer = 0;
  function scheduleHeal() {
    if (_healTimer) return;
    _healTimer = setTimeout(function () {
      _healTimer = 0;
      if (!document.body.classList.contains('dash-customizing')) return;
      try { if (typeof window.injectCardControls === 'function') window.injectCardControls(); } catch (_) {}
      try { injectToolbars(); } catch (_) {}
    }, 250);
  }
  // FIX 84 v10: belt-and-suspenders polling. Some cards (AI Insight paycheck)
  // render *after* our MO callbacks fire, so we miss them. Poll every 1.5s
  // while customize mode is active to catch late renders.
  var _healPoll = 0;
  function startHealPoll() {
    if (_healPoll) return;
    _healPoll = setInterval(function () {
      if (!document.body.classList.contains('dash-customizing')) {
        clearInterval(_healPoll); _healPoll = 0; return;
      }
      var page = document.getElementById('page-dashboard');
      if (!page) return;
      var anyMissing = Array.from(page.querySelectorAll(':scope > .reorderable')).some(function (c) {
        return !c.querySelector(':scope > .card-reorder-controls');
      });
      if (anyMissing) {
        try { if (typeof window.injectCardControls === 'function') window.injectCardControls(); } catch (_) {}
      }
      try { injectToolbars(); } catch (_) {}
    }, 1500);
  }

  function attachControlsHealer() {
    try {
      var page = document.getElementById('page-dashboard');
      if (!page) return;
      var mo = new MutationObserver(function (mutations) {
        if (!document.body.classList.contains('dash-customizing')) return;
        var needsHeal = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type !== 'childList') continue;
          // Check direct cards: did any of them lose their controls strip?
          var card = m.target && m.target.classList && m.target.classList.contains('reorderable')
            ? m.target
            : (m.target && m.target.closest ? m.target.closest('#page-dashboard > .reorderable') : null);
          if (card && card.parentElement === page) {
            if (!card.querySelector(':scope > .card-reorder-controls')) {
              needsHeal = true;
              break;
            }
          }
        }
        if (needsHeal) scheduleHeal();
      });
      mo.observe(page, { childList: true, subtree: true });
      // Also re-heal whenever the user enters customize mode (catches the
      // initial paint race where some cards render after our first inject).
      var bodyMo = new MutationObserver(function () {
        if (document.body.classList.contains('dash-customizing')) { scheduleHeal(); startHealPoll(); }
      });
      bodyMo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_DashboardGridSlots = {
    version: 12,
    isEnabled: isGridEnabled,
    setEnabled: setGridEnabled,
    isAutoFit: isAutoFit,
    setAutoFit: setAutoFit,
    applyAll: applyAllSlots,
    apply: apply
  };
})();
