/* wjp-dash-settings-panel.js v14 — scope autofit to .active v13 — default layout for new users v12 — flat order !important beats pin v11 — flat order overrides pin v10 — greeting/bar always-top v9 — auto-fit grid v8 — full cross-container moves (flat order) v7 — panel reflects visual order v6 — customize bar pinned top + gear inline in bar v5 — 2026-05-20 hero pin respects saved order
 *
 * Iteration on v3:
 *   - Override window.applyDashboardLayout with a smarter slot-anchoring
 *     version that preserves non-reorderable siblings' positions.
 *   - Pin #dfd-hero (Executive Summary) and #wjp-momentum-hero (Last 7 Days)
 *     to the top of #page-dashboard on every applyLayout — they always come
 *     after #dash-greeting, before #dash-customize-bar.
 *
 * Still no setInterval / no MutationObserver / no applyLayout-on-tick.
 */
(function () {
  "use strict";
  if (window._wjpDashSettingsPanelInstalled) return;
  window._wjpDashSettingsPanelInstalled = true;

  // ===== Default dashboard layout =====
  // Used when a user has no saved prefs yet (new users + admin's "Reset to
  // default" button). Captured from Winston's preferred layout 2026-05-20.
  // Any user can override via the gear panel.
  var DEFAULT_FLAT_ORDER = [
    'exec-summary',         // Executive Summary
    'wjp-active-target',    // Active Target
    'last-7-days',          // Last 7 Days
    'wjp-debit-balances',   // Debit Balances
    'upcoming',             // Upcoming Payments
    'spending',             // Spending Tracker
    'credit-profile',       // Credit Profile
    'wjp-paycheck-ai',      // Paycheck AI
    'resilience',           // Financial Resilience
    'strategy-indicators',  // Strategy Indicators
    'stats-row',            // Stats Row
    'ai-advisor',           // AI Advisor
    'math-breakdown',       // Math Breakdown
    'payoff-engine',        // Payoff Engine
    'wjp-edu-tip',          // Daily Money Lesson
    'top3-strategy',        // Top 3 to Attack
    'resilience-detail',    // Resilience Detail
    'linked-assets',        // Linked Assets (hidden by default)
    'money-left'            // Money Left (hidden by default)
  ];
  var DEFAULT_HIDDEN = { 'linked-assets': true, 'money-left': true };
  var DEFAULT_SIZES = {
    'exec-summary': 'large',
    'last-7-days': 'large',
    'upcoming': 'medium',
    'ai-advisor': 'medium',
    'payoff-engine': 'small',
    'strategy-indicators': 'full',
    'linked-assets': 'medium',
    'spending': 'full',
    'top3-strategy': 'full',
    'math-breakdown': 'small',
    'money-left': 'small',
    'resilience': 'small',
    'credit-profile': 'medium'
  };

  var GEAR_ID = "wjp-dash-settings-gear";
  var PANEL_ID = "wjp-dash-settings-panel";
  var SCRIM_ID = "wjp-dash-settings-scrim";

  // Heroes always at the top of #page-dashboard, in this order
  var TOP_PIN = ['dfd-hero', 'wjp-momentum-hero'];

  function getAppState() { try { return appState; } catch (_) { return (window.appState || null); } }
  function saveAppState() { try { if (typeof saveState === 'function') saveState(); } catch (_) {} }

  function cardLabel(node) {
    var t = node.getAttribute('data-card-label');
    if (t) return t;
    var h = node.querySelector('.section-label, h1, h2, h3, .dfd-eyebrow, .card-title');
    if (h && h.textContent && h.textContent.trim()) return h.textContent.trim().slice(0, 40);
    return node.getAttribute('data-card-id') || node.id || 'Widget';
  }

  function gatherWidgets() {
    var page = document.getElementById('page-dashboard');
    if (!page) return [];
    var widgets = [];
    Array.from(page.querySelectorAll('.reorderable')).forEach(function (el) {
      var cid = el.getAttribute('data-card-id');
      if (!cid) return;
      widgets.push({ id: cid, node: el, label: cardLabel(el) });
    });
    return widgets;
  }

  function getPrefs() {
    var s = getAppState() || {};
    if (!s.prefs) s.prefs = {};
    if (!s.prefs.cardOrder)  s.prefs.cardOrder  = {};
    if (!s.prefs.cardHidden) s.prefs.cardHidden = {};
    return s.prefs;
  }

  // ===== Smart applyDashboardLayout — flat order in #page-dashboard =====
  // Widgets can live anywhere. We treat the saved order as a single flat
  // sequence and physically lay them out as direct children of
  // #page-dashboard, right after the customize bar. The greeting and the
  // customize bar stay pinned at the top; the gear lives inside the bar.
  function smartApplyDashboardLayout() {
    try {
      var s = getAppState() || {};
      var prefs = s.prefs || {};
      var hidden = prefs.cardHidden || {};
      var page = document.getElementById('page-dashboard');
      if (!page) return;

      // 1. Hide/show all reorderables based on hidden map.
      var reordList = Array.from(page.querySelectorAll('.reorderable'));
      reordList.forEach(function (card) {
        var cid = card.getAttribute('data-card-id');
        card.style.display = (hidden && hidden[cid]) ? 'none' : '';
      });

      // 2. Pin greeting + customize bar to the top.
      var greeting = document.getElementById('dash-greeting');
      var bar = document.getElementById('dash-customize-bar');
      if (greeting && greeting.parentElement !== page) {
        // leave alone — must be in page-dashboard already from index.html
      }
      if (bar && bar.parentElement === page) {
        var firstAfterGreeting = greeting ? greeting.nextSibling : page.firstChild;
        if (bar !== firstAfterGreeting) page.insertBefore(bar, firstAfterGreeting);
      }

      // 3. Build flat order — saved > legacy > DEFAULT_FLAT_ORDER (Winston's layout).
      var flat = Array.isArray(prefs.dashFlatOrder) && prefs.dashFlatOrder.length
        ? prefs.dashFlatOrder.slice()
        : null;
      if (!flat) {
        flat = [];
        var legacy = prefs.cardOrder || {};
        Object.keys(legacy).forEach(function (parentKey) {
          var ids = Array.isArray(legacy[parentKey]) ? legacy[parentKey] : [];
          ids.forEach(function (id) { if (flat.indexOf(id) < 0) flat.push(id); });
        });
      }
      if (!flat.length) {
        // New user — apply the default layout.
        flat = DEFAULT_FLAT_ORDER.slice();
      }

      // 3b. Hidden defaults — only when user has no saved cardHidden.
      var userHidden = (prefs.cardHidden && Object.keys(prefs.cardHidden).length) ? prefs.cardHidden : null;
      var effectiveHidden = userHidden || DEFAULT_HIDDEN;
      // Re-apply hide based on the EFFECTIVE map (overrides step 1 result if defaults are kicking in).
      Array.from(page.querySelectorAll('.reorderable')).forEach(function (card) {
        var cid = card.getAttribute('data-card-id');
        card.style.display = (cid && effectiveHidden[cid]) ? 'none' : '';
      });

      // 3c. Size defaults — only when user has no saved cardSize.
      var userSize = (prefs.cardSize && Object.keys(prefs.cardSize).length) ? prefs.cardSize : null;
      var effectiveSizes = userSize || DEFAULT_SIZES;
      Object.keys(effectiveSizes).forEach(function (cid) {
        var card = page.querySelector('.reorderable[data-card-id="' + cid + '"]');
        if (card) card.setAttribute('data-size', effectiveSizes[cid]);
      });

      // 4. For every reorderable not yet in `flat`, append in current DOM order.
      var byCid = {};
      reordList.forEach(function (c) {
        var cid = c.getAttribute('data-card-id');
        if (cid) byCid[cid] = c;
      });
      reordList.forEach(function (c) {
        var cid = c.getAttribute('data-card-id');
        if (cid && flat.indexOf(cid) < 0) flat.push(cid);
      });

      // 5. Physically move each card so they're all direct children of
      //    #page-dashboard, immediately after the customize bar, in flat order.
      var anchor = bar ? bar : (greeting || null);
      var prev = anchor;
      flat.forEach(function (cid, idx) {
        var node = byCid[cid];
        if (!node) return;
        // Insert right after `prev`
        var after = prev ? prev.nextSibling : page.firstChild;
        if (node !== after) page.insertBefore(node, after);
        prev = node;
        // CRITICAL: override any pin-feature order (style.order='-10') via a
        // CSS custom property + !important rule. app.js's reorderPinnedCards
        // re-sets style.order on every updateUI tick, so an inline write here
        // would get undone. The CSS rule for [style*="--wjp-flat-order"] beats
        // any inline style.order via !important.
        try { node.style.setProperty('--wjp-flat-order', String(idx)); } catch (_) {}
      });

      // 6. Hide empty dash-grid (its reorderable children were flattened to
      //    top-level; only its empty .dash-left + .dash-right columns remain).
      var grid = document.getElementById('dash-grid') || page.querySelector('.dash-grid');
      if (grid) {
        var stillHasReord = grid.querySelector('.reorderable');
        grid.style.display = stillHasReord ? '' : 'none';
      }
    } catch (e) {
      try { console.warn('[wjp-dash-settings] applyLayout fail', e); } catch (_) {}
    }
  }
  window.applyDashboardLayout = smartApplyDashboardLayout;

  function injectStyle() {
    if (document.getElementById('wjp-dash-settings-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-dash-settings-style';
    var css = [];
    // Floating gear (fallback when no customize-bar exists)
    css.push('#' + GEAR_ID + ':not([data-inline]){position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;transition:transform 0.12s ease, box-shadow 0.12s ease;font-size:16px;}');
    css.push('body.light #' + GEAR_ID + ':not([data-inline]){background:#ffffff;border:1px solid rgba(10,10,10,0.12);color:#0a0a0a;box-shadow:0 1px 3px rgba(0,0,0,0.06);}');
    css.push('body.dark #' + GEAR_ID + ':not([data-inline]),body:not(.light) #' + GEAR_ID + ':not([data-inline]){background:#13192a;border:1px solid rgba(255,255,255,0.10);color:#f1f5f9;}');
    // Inline gear (inside the customize bar): inherits .btn .btn-ghost from host CSS
    css.push('#' + GEAR_ID + '[data-inline]{cursor:pointer;display:inline-flex;align-items:center;gap:2px;}');
    css.push('#' + GEAR_ID + ':hover i.ph-gear{transition:transform 0.12s ease;transform:rotate(28deg);}');
    css.push('#' + SCRIM_ID + '{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;}');
    css.push('#' + PANEL_ID + '{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;border-radius:14px;padding:18px;z-index:9001;box-shadow:0 24px 64px rgba(0,0,0,0.45);}');
    css.push('body.light #' + PANEL_ID + '{background:#ffffff;color:#0a0a0a;border:1px solid rgba(10,10,10,0.10);}');
    css.push('body.dark #' + PANEL_ID + ',body:not(.light) #' + PANEL_ID + '{background:#13192a;color:#f1f5f9;border:1px solid rgba(255,255,255,0.10);}');
    css.push('#' + PANEL_ID + ' h3{margin:0 0 6px 0;font-size:18px;font-weight:700;}');
    css.push('body.light #' + PANEL_ID + ' .wjp-sp-sub{color:rgba(10,10,10,0.55);}');
    css.push('body.dark #' + PANEL_ID + ' .wjp-sp-sub,body:not(.light) #' + PANEL_ID + ' .wjp-sp-sub{color:rgba(241,245,249,0.55);}');
    css.push('#' + PANEL_ID + ' .wjp-sp-sub{font-size:12px;margin-bottom:14px;}');
    css.push('#' + PANEL_ID + ' #wjp-sp-list{flex:1;overflow-y:auto;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-row{display:flex;align-items:center;gap:10px;padding:8px 6px;user-select:none;}');
    css.push('body.light #' + PANEL_ID + ' .wjp-sp-row{border-bottom:1px solid rgba(10,10,10,0.08);}');
    css.push('body.dark #' + PANEL_ID + ' .wjp-sp-row,body:not(.light) #' + PANEL_ID + ' .wjp-sp-row{border-bottom:1px solid rgba(255,255,255,0.08);}');
    css.push('#' + PANEL_ID + ' .wjp-sp-row[draggable=true]{cursor:grab;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-row.dragging{opacity:0.4;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-handle{font-size:14px;opacity:0.5;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-label{flex:1;font-size:14px;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-btn{padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;background:transparent;}');
    css.push('body.light #' + PANEL_ID + ' .wjp-sp-btn{border:1px solid rgba(10,10,10,0.2);color:#0a0a0a;}');
    css.push('body.dark #' + PANEL_ID + ' .wjp-sp-btn,body:not(.light) #' + PANEL_ID + ' .wjp-sp-btn{border:1px solid rgba(255,255,255,0.2);color:#f1f5f9;}');
    css.push('#' + PANEL_ID + ' .wjp-sp-btn-primary{background:#10b981;color:#ffffff;border-color:transparent !important;}');

    // ===== Dashboard layout — flex grid when auto-fit is ON =====
    // Auto-fit ON: #page-dashboard becomes a flex-wrap grid. Cards pack into
    // 2-3 columns based on viewport + per-card data-size. Greeting + customize
    // bar always full-width.
    css.push('body.dash-autofit #page-dashboard.active{display:flex !important;flex-wrap:wrap;gap:14px;align-content:flex-start;}body.dash-autofit #page-dashboard:not(.active){display:none !important;}');
    // Non-reorderable system elements span the full row.
    css.push('body.dash-autofit #page-dashboard > #dash-greeting,body.dash-autofit #page-dashboard > #dash-customize-bar,body.dash-autofit #page-dashboard > #dash-grid,body.dash-autofit #page-dashboard > #wjp-dash-settings-gear{flex:0 0 100%;width:100%;}');
    // Lock greeting + customize bar to the very top — beat any pinned-card order:-10
    css.push('body.dash-autofit #page-dashboard > #dash-greeting{order:-100 !important;}');
    css.push('body.dash-autofit #page-dashboard > #dash-customize-bar{order:-99 !important;}');
    // Flat order: each reorderable carries --wjp-flat-order from JS; this CSS
    // rule re-applies it with !important so it beats app.js's inline style.order
    // (set by the pin feature inside updateUI on every render).
    css.push('body.dash-autofit #page-dashboard > .reorderable{order:var(--wjp-flat-order, 0) !important;}');
    // Reorderable card default (no explicit data-size): 2 per row at min 320px.
    css.push('body.dash-autofit #page-dashboard > .reorderable:not([data-size]){flex:1 1 calc(50% - 14px);min-width:320px;max-width:100%;}');
    // Hide the now-empty dash-grid (its contents were flattened to top-level)
    css.push('body.dash-autofit #page-dashboard > #dash-grid:empty,body.dash-autofit #page-dashboard > #dash-grid:has(> .dash-left:empty):has(> .dash-right:empty){display:none;}');

    // Auto-fit OFF: single-column block flow (user wants exact placement, no row packing).
    css.push('body:not(.dash-autofit) #page-dashboard.active{display:block;}body:not(.dash-autofit) #page-dashboard:not(.active){display:none;}');
    css.push('body:not(.dash-autofit) #page-dashboard > .reorderable{width:100%;margin-top:14px;}');

    st.textContent = css.join('');
    document.head.appendChild(st);
  }

  function injectGear() {
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    if (document.getElementById(GEAR_ID)) return;
    var bar = document.getElementById('dash-customize-bar');
    var btn = document.createElement('button');
    btn.id = GEAR_ID;
    btn.type = 'button';
    btn.title = 'Dashboard settings — show, hide, reorder widgets';
    btn.setAttribute('aria-label', 'Dashboard settings');
    btn.innerHTML = '<i class="ph ph-gear"></i><span style="margin-left:6px;">Settings</span>';
    btn.className = 'btn btn-ghost';
    btn.addEventListener('click', openPanel);
    if (bar) {
      // Inline mode: sits inside the customize toolbar alongside Customize + Auto-fit
      btn.dataset.inline = '1';
      bar.appendChild(btn);
    } else {
      // Fallback: floating top-right if the bar isn't present
      var pos = getComputedStyle(page).position;
      if (pos === 'static') page.style.position = 'relative';
      page.appendChild(btn);
    }
  }

  function getOrderedWidgets() {
    // Sort by current visual top position — the panel mirrors what the user
    // sees on the dashboard. Hidden cards are placed at the bottom (so the
    // visible widgets read in order first).
    var widgets = gatherWidgets();
    var prefs = getPrefs();
    var hidden = prefs.cardHidden || {};
    return widgets.slice().sort(function (a, b) {
      var aHidden = !!hidden[a.id];
      var bHidden = !!hidden[b.id];
      if (aHidden !== bHidden) return aHidden ? 1 : -1;
      var aR = a.node.getBoundingClientRect();
      var bR = b.node.getBoundingClientRect();
      if (Math.abs(aR.top - bR.top) < 8) return aR.left - bR.left;
      return aR.top - bR.top;
    });
  }

  function buildPanel() {
    var widgets = getOrderedWidgets();
    var prefs = getPrefs();
    var hidden = prefs.cardHidden || {};

    var scrim = document.createElement('div'); scrim.id = SCRIM_ID;
    var panel = document.createElement('div'); panel.id = PANEL_ID;
    panel.innerHTML = ''
      + '<h3>Dashboard settings</h3>'
      + '<div class="wjp-sp-sub">Drag any card anywhere. Uncheck to hide. Tap Save to apply.</div>'
      + '<div id="wjp-sp-list"></div>'
      + '<div class="wjp-sp-actions">'
      + '  <button type="button" class="wjp-sp-btn" id="wjp-sp-cancel">Cancel</button>'
      + '  <button type="button" class="wjp-sp-btn" id="wjp-sp-reset">Reset to default</button>'
      + '  <button type="button" class="wjp-sp-btn wjp-sp-btn-primary" id="wjp-sp-save">Save</button>'
      + '</div>';

    var list = panel.querySelector('#wjp-sp-list');
    widgets.forEach(function (w) {
      var row = document.createElement('div');
      row.className = 'wjp-sp-row';
      row.draggable = true;
      row.dataset.id = w.id;
      row.innerHTML = ''
        + '<span class="wjp-sp-handle">⋮⋮</span>'
        + '<input type="checkbox" ' + (hidden[w.id] ? '' : 'checked') + ' />'
        + '<span class="wjp-sp-label">' + (w.label || w.id) + '</span>';
      row.addEventListener('dragstart', function () { row.classList.add('dragging'); });
      row.addEventListener('dragend',   function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover',  function (e) {
        e.preventDefault();
        var dragging = list.querySelector('.dragging');
        if (!dragging || dragging === row) return;
        var rect = row.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        if (before) list.insertBefore(dragging, row);
        else        list.insertBefore(dragging, row.nextSibling);
      });
      list.appendChild(row);
    });

    panel.querySelector('#wjp-sp-cancel').addEventListener('click', closePanel);
    panel.querySelector('#wjp-sp-reset').addEventListener('click', function () {
      var p = getPrefs();
      p.cardOrder = {};
      p.cardHidden = {};
      p.dashFlatOrder = null;
      saveAppState();
      gatherWidgets().forEach(function (w) { w.node.style.display = ''; });
      // Reload to restore the original index.html ordering
      try { location.reload(); } catch (_) {}
    });
    panel.querySelector('#wjp-sp-save').addEventListener('click', function () {
      var rows = Array.from(list.querySelectorAll('.wjp-sp-row'));
      var p = getPrefs();
      var newHidden = {};
      var flat = [];
      rows.forEach(function (r) {
        var id = r.dataset.id;
        if (!r.querySelector('input[type=checkbox]').checked) newHidden[id] = true;
        flat.push(id);
      });
      p.dashFlatOrder = flat;
      p.cardHidden = newHidden;
      // Wipe the legacy per-parent format so it can't fight with us next render.
      p.cardOrder = {};
      saveAppState();
      smartApplyDashboardLayout();
      closePanel();
    });
    scrim.addEventListener('click', closePanel);

    document.body.appendChild(scrim);
    document.body.appendChild(panel);
  }

  function openPanel() {
    if (document.getElementById(PANEL_ID)) return;
    buildPanel();
  }
  function closePanel() {
    var p = document.getElementById(PANEL_ID); if (p) p.remove();
    var s = document.getElementById(SCRIM_ID); if (s) s.remove();
  }

  function boot() {
    injectStyle();
    injectGear();
    // Run smart layout once on boot — fixes anyone whose heroes got pushed down
    // by the buggy v3 save.
    smartApplyDashboardLayout();
  }

  function onMaybeMount() {
    var dash = document.getElementById('page-dashboard');
    if (!dash) return;
    if (!dash.classList.contains('active')) return;
    boot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onMaybeMount);
  } else {
    onMaybeMount();
  }
  window.addEventListener('hashchange', onMaybeMount);
  setTimeout(onMaybeMount, 800);
  setTimeout(onMaybeMount, 2500);

  window.WJPDashSettings = { open: openPanel, applyLayout: smartApplyDashboardLayout };
})();
