/* wjp-dash-settings-panel.js v2 — contrast fix for day mode — 2026-05-20
 *
 * MINIMAL dashboard settings panel — a safe rebuild after the
 * wjp-dashboard-customizer.js flicker incident (2026-05-20).
 *
 * Hard rules — every line below is in service of these:
 *   - NO setInterval. NO MutationObserver. NO applyLayout-on-tick.
 *   - NO Firestore sync. NO cloud polling.
 *   - DOM mutations happen ONLY in direct response to a user click.
 *
 * What it does:
 *   - On boot: inject ONE ⚙ button into #page-dashboard (idempotent).
 *   - On click: build a panel listing every visible `.reorderable` card +
 *     two non-reorderable hero cards (#dfd-hero, #wjp-momentum-hero) so the
 *     user can hide/show/reorder them.
 *   - On save: apply once via insertBefore, write layout to localStorage.
 *   - On close: tear panel down, no listeners remain.
 *
 * Persistence: localStorage key `wjp.dash.settings.v1`, shape:
 *   { hidden: ["card-id", ...], order: ["card-id", ...] }
 * Layout is applied ONCE on every dashboard activation (hashchange) — also
 * a single-shot, not periodic.
 */
(function () {
  "use strict";
  if (window._wjpDashSettingsPanelInstalled) return;
  window._wjpDashSettingsPanelInstalled = true;

  var LS_KEY = "wjp.dash.settings.v1";
  var GEAR_ID = "wjp-dash-settings-gear";
  var PANEL_ID = "wjp-dash-settings-panel";
  var SCRIM_ID = "wjp-dash-settings-scrim";

  // Top cards that aren't .reorderable in HTML but the user should still control
  var FORCED = [
    { id: "dfd-hero",          label: "Executive Summary",   pin: true  },
    { id: "wjp-momentum-hero", label: "Last 7 Days",         pin: false }
  ];

  function lsGet() {
    try { var v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : { hidden: [], order: [] }; }
    catch (_) { return { hidden: [], order: [] }; }
  }
  function lsSet(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (_) {} }

  function cardLabel(node) {
    var t = node.getAttribute('data-card-label');
    if (t) return t;
    // FORCED label override
    var f = FORCED.find(function (x) { return x.id === node.id; });
    if (f) return f.label;
    // first H1/H2/H3/strong child
    var h = node.querySelector('.section-label, h1, h2, h3, .dfd-eyebrow, .card-title');
    if (h && h.textContent && h.textContent.trim()) return h.textContent.trim().slice(0, 40);
    return node.id || 'Widget';
  }

  function gatherWidgets() {
    var page = document.getElementById('page-dashboard');
    if (!page) return [];
    var widgets = [];
    // FORCED cards (top heroes) first
    FORCED.forEach(function (f) {
      var el = document.getElementById(f.id);
      if (el) widgets.push({ id: el.id, label: cardLabel(el), node: el, pin: !!f.pin });
    });
    // Then every .reorderable not already added
    Array.from(page.querySelectorAll('.reorderable')).forEach(function (el) {
      if (widgets.find(function (w) { return w.id === el.id; })) return;
      if (!el.id) el.id = 'reord-' + Math.random().toString(36).slice(2, 8);
      widgets.push({ id: el.id, label: cardLabel(el), node: el, pin: false });
    });
    return widgets;
  }

  function applyLayout() {
    // Single-shot: apply hidden + order to the live DOM. Called only on:
    // 1) panel save, 2) initial dashboard mount (hashchange-triggered).
    try {
      var state = lsGet();
      var hidden = state.hidden || [];
      var order = state.order || [];
      var page = document.getElementById('page-dashboard');
      if (!page) return;

      // Hidden: set display none/clear
      var allWidgets = gatherWidgets();
      allWidgets.forEach(function (w) {
        w.node.style.display = (hidden.indexOf(w.id) >= 0) ? 'none' : '';
      });

      // Reorder: respect saved order list but keep pinned items above
      if (order.length) {
        var pinned = allWidgets.filter(function (w) { return w.pin; });
        // Find a common parent — top widgets live in #page-dashboard direct
        // children; .reorderable cards in .dash-grid may be moved.
        order.forEach(function (id) {
          var node = document.getElementById(id);
          if (!node || !node.parentNode) return;
          // pinned go before everything else of the same parent
          if (pinned.find(function (p) { return p.id === id; })) {
            var parent = node.parentNode;
            parent.insertBefore(node, parent.firstChild);
          } else {
            // append to end of its parent — respects user-saved order
            var parent2 = node.parentNode;
            parent2.appendChild(node);
          }
        });
      }
    } catch (e) {
      try { console.warn('[wjp-dash-settings] applyLayout fail', e); } catch (_) {}
    }
  }

  function injectStyle() {
    if (document.getElementById('wjp-dash-settings-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-dash-settings-style';
    var css = [];
    // Gear button — neutral surface that works in both modes
    css.push('#'+GEAR_ID+'{position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;transition:transform 0.12s ease, box-shadow 0.12s ease;font-size:16px;}');
    css.push('body.light #'+GEAR_ID+'{background:#ffffff;border:1px solid rgba(10,10,10,0.12);color:#0a0a0a;box-shadow:0 1px 3px rgba(0,0,0,0.06);}');
    css.push('body.dark #'+GEAR_ID+',body:not(.light) #'+GEAR_ID+'{background:#13192a;border:1px solid rgba(255,255,255,0.10);color:#f1f5f9;}');
    css.push('#'+GEAR_ID+':hover{transform:rotate(28deg);box-shadow:0 4px 18px rgba(0,0,0,0.18);}');
    // Scrim
    css.push('#'+SCRIM_ID+'{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;}');
    // Panel — light surface in light mode, dark navy in dark
    css.push('#'+PANEL_ID+'{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,90vw);max-height:80vh;overflow-y:auto;border-radius:14px;padding:18px;z-index:9001;box-shadow:0 24px 64px rgba(0,0,0,0.45);}');
    css.push('body.light #'+PANEL_ID+'{background:#ffffff;color:#0a0a0a;border:1px solid rgba(10,10,10,0.10);}');
    css.push('body.dark #'+PANEL_ID+',body:not(.light) #'+PANEL_ID+'{background:#13192a;color:#f1f5f9;border:1px solid rgba(255,255,255,0.10);}');
    css.push('#'+PANEL_ID+' h3{margin:0 0 6px 0;font-size:18px;font-weight:700;}');
    css.push('body.light #'+PANEL_ID+' .wjp-sp-sub{color:rgba(10,10,10,0.55);}');
    css.push('body.dark #'+PANEL_ID+' .wjp-sp-sub,body:not(.light) #'+PANEL_ID+' .wjp-sp-sub{color:rgba(241,245,249,0.55);}');
    css.push('#'+PANEL_ID+' .wjp-sp-sub{font-size:12px;margin-bottom:14px;}');
    css.push('#'+PANEL_ID+' .wjp-sp-row{display:flex;align-items:center;gap:10px;padding:8px 6px;user-select:none;}');
    css.push('body.light #'+PANEL_ID+' .wjp-sp-row{border-bottom:1px solid rgba(10,10,10,0.08);}');
    css.push('body.dark #'+PANEL_ID+' .wjp-sp-row,body:not(.light) #'+PANEL_ID+' .wjp-sp-row{border-bottom:1px solid rgba(255,255,255,0.08);}');
    css.push('#'+PANEL_ID+' .wjp-sp-row[draggable=true]{cursor:grab;}');
    css.push('#'+PANEL_ID+' .wjp-sp-row.dragging{opacity:0.4;}');
    css.push('#'+PANEL_ID+' .wjp-sp-handle{font-size:14px;opacity:0.5;}');
    css.push('#'+PANEL_ID+' .wjp-sp-label{flex:1;font-size:14px;}');
    css.push('#'+PANEL_ID+' .wjp-sp-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}');
    css.push('#'+PANEL_ID+' .wjp-sp-btn{padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;background:transparent;}');
    css.push('body.light #'+PANEL_ID+' .wjp-sp-btn{border:1px solid rgba(10,10,10,0.2);color:#0a0a0a;}');
    css.push('body.dark #'+PANEL_ID+' .wjp-sp-btn,body:not(.light) #'+PANEL_ID+' .wjp-sp-btn{border:1px solid rgba(255,255,255,0.2);color:#f1f5f9;}');
    css.push('#'+PANEL_ID+' .wjp-sp-btn-primary{background:#10b981;color:#ffffff;border-color:transparent !important;}');
    st.textContent = css.join('');
    document.head.appendChild(st);
  }

  function injectGear() {
    var page = document.getElementById('page-dashboard');
    if (!page) return;
    if (document.getElementById(GEAR_ID)) return;
    // page must be positioned for absolute child to anchor correctly
    var pos = getComputedStyle(page).position;
    if (pos === 'static') page.style.position = 'relative';
    var btn = document.createElement('button');
    btn.id = GEAR_ID;
    btn.type = 'button';
    btn.title = 'Dashboard settings — show, hide, reorder widgets';
    btn.setAttribute('aria-label', 'Dashboard settings');
    btn.innerHTML = '<i class="ph ph-gear"></i>';
    btn.addEventListener('click', openPanel);
    page.appendChild(btn);
  }

  function buildPanel() {
    var widgets = gatherWidgets();
    var state = lsGet();
    var hidden = new Set(state.hidden || []);
    // Apply saved order to display order
    var order = state.order || [];
    if (order.length) {
      var byId = {}; widgets.forEach(function (w) { byId[w.id] = w; });
      var sorted = [];
      order.forEach(function (id) { if (byId[id]) { sorted.push(byId[id]); delete byId[id]; } });
      Object.keys(byId).forEach(function (id) { sorted.push(byId[id]); });
      widgets = sorted;
    }

    var scrim = document.createElement('div'); scrim.id = SCRIM_ID;
    var panel = document.createElement('div'); panel.id = PANEL_ID;
    panel.innerHTML = ''
      + '<h3>Dashboard settings</h3>'
      + '<div class="wjp-sp-sub">Drag to reorder. Uncheck to hide. Saved on your device.</div>'
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
        + '<input type="checkbox" ' + (hidden.has(w.id) ? '' : 'checked') + ' />'
        + '<span class="wjp-sp-label">' + (w.label || w.id) + '</span>';
      // Drag-reorder — local to this panel only
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
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
      // Restore all to visible
      gatherWidgets().forEach(function (w) { w.node.style.display = ''; });
      closePanel();
    });
    panel.querySelector('#wjp-sp-save').addEventListener('click', function () {
      var rows = Array.from(list.querySelectorAll('.wjp-sp-row'));
      var newHidden = [];
      var newOrder  = [];
      rows.forEach(function (r) {
        var id = r.dataset.id;
        newOrder.push(id);
        if (!r.querySelector('input[type=checkbox]').checked) newHidden.push(id);
      });
      lsSet({ hidden: newHidden, order: newOrder });
      applyLayout();
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

  // ---------- boot — strictly one-shot work ----------
  function boot() {
    injectStyle();
    injectGear();
    applyLayout();
  }

  // Mount when dashboard becomes active. Only on hashchange (single event,
  // not a periodic tick).
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
  // Belt-and-suspenders: also try once after late mount (after defer scripts)
  setTimeout(onMaybeMount, 800);
  setTimeout(onMaybeMount, 2500);

  // Public API for re-applying after layout would otherwise be lost
  window.WJPDashSettings = { applyLayout: applyLayout, open: openPanel };
})();
