/* wjp-dash-settings-panel.js v7 — panel reflects visual order v6 — customize bar pinned top + gear inline in bar v5 — 2026-05-20 hero pin respects saved order
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

  // ===== Smarter applyDashboardLayout — slot-anchoring per parent =====
  function smartApplyDashboardLayout() {
    try {
      var s = getAppState() || {};
      var prefs = s.prefs || {};
      var order = prefs.cardOrder || {};
      var hidden = prefs.cardHidden || {};

      // 1. Hide/show all reorderables based on hidden map
      document.querySelectorAll('#page-dashboard .reorderable').forEach(function (card) {
        var cid = card.getAttribute('data-card-id');
        card.style.display = (hidden && hidden[cid]) ? 'none' : '';
      });

      // 2. Reorder per parent using slot-anchoring (preserves non-reorderable siblings)
      Object.keys(order).forEach(function (parentKey) {
        var parent = document.getElementById(parentKey) || document.querySelector('.' + parentKey);
        if (!parent) return;
        var idList = Array.isArray(order[parentKey]) ? order[parentKey] : [];
        if (idList.length < 2) return;

        // Resolve nodes in saved order. Only nodes currently inside `parent`.
        var nodes = [];
        idList.forEach(function (cid) {
          var card = parent.querySelector(':scope > .reorderable[data-card-id="' + cid + '"]');
          if (card) nodes.push(card);
        });
        if (nodes.length < 2) return;

        // Find their slot indices (sorted) in parent.children
        var children = Array.from(parent.children);
        var slotIndices = nodes.map(function (n) { return children.indexOf(n); })
                               .filter(function (i) { return i >= 0; })
                               .sort(function (a, b) { return a - b; });
        if (slotIndices.length < 2) return;

        // Build newChildren: original children, but with reorderable slots replaced
        // by nodes in the saved order.
        var newChildren = children.slice();
        for (var i = 0; i < slotIndices.length && i < nodes.length; i++) {
          newChildren[slotIndices[i]] = nodes[i];
        }

        // Apply: appendChild each in newChildren order (moves nodes)
        newChildren.forEach(function (node) { parent.appendChild(node); });
      });

      // 3. Pin dash-customize-bar to position right after #dash-greeting so
      //    the Customize layout + Auto-fit buttons (plus the gear) live at
      //    the very top of the dashboard.
      var page = document.getElementById('page-dashboard');
      if (page) {
        var greeting = document.getElementById('dash-greeting');
        var bar = document.getElementById('dash-customize-bar');
        if (bar && bar.parentElement === page) {
          var afterGreeting = greeting ? greeting.nextSibling : page.firstChild;
          if (bar !== afterGreeting) page.insertBefore(bar, afterGreeting);
        }
        // 4. Pin top heroes — come right AFTER the customize bar. Their
        //    relative order respects cardOrder['page-dashboard'].
        var savedPageOrder = Array.isArray(order['page-dashboard']) ? order['page-dashboard'] : [];
        var heroCardIds = { 'exec-summary': 'dfd-hero', 'last-7-days': 'wjp-momentum-hero' };
        var heroNodes = [];
        savedPageOrder.forEach(function (cid) {
          var elId = heroCardIds[cid];
          if (!elId) return;
          var el = document.getElementById(elId);
          if (el && el.parentElement === page && heroNodes.indexOf(el) < 0) heroNodes.push(el);
        });
        TOP_PIN.forEach(function (id) {
          var el = document.getElementById(id);
          if (el && el.parentElement === page && heroNodes.indexOf(el) < 0) heroNodes.push(el);
        });
        var heroAnchor = bar ? bar.nextSibling : (greeting ? greeting.nextSibling : page.firstChild);
        heroNodes.forEach(function (node) {
          if (node !== heroAnchor) page.insertBefore(node, heroAnchor);
          heroAnchor = node.nextSibling;
        });
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
      + '<div class="wjp-sp-sub">Drag to reorder. Uncheck to hide. Items move within their section (top area or left/right column). For cross-column moves, use <strong>Customize layout</strong> and drag the card itself.</div>'
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
      saveAppState();
      gatherWidgets().forEach(function (w) { w.node.style.display = ''; });
      smartApplyDashboardLayout();
      closePanel();
    });
    panel.querySelector('#wjp-sp-save').addEventListener('click', function () {
      var rows = Array.from(list.querySelectorAll('.wjp-sp-row'));
      var p = getPrefs();
      var newHidden = {};
      var newOrder = {};
      var widgets = gatherWidgets();
      var nodeById = {}; widgets.forEach(function (w) { nodeById[w.id] = w.node; });
      rows.forEach(function (r) {
        var id = r.dataset.id;
        if (!r.querySelector('input[type=checkbox]').checked) newHidden[id] = true;
        var node = nodeById[id];
        if (!node || !node.parentElement) return;
        var parent = node.parentElement;
        var parentKey = parent.id || (parent.className.split(' ').filter(Boolean)[0]) || 'root';
        if (!newOrder[parentKey]) newOrder[parentKey] = [];
        newOrder[parentKey].push(id);
      });
      p.cardOrder = newOrder;
      p.cardHidden = newHidden;
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
