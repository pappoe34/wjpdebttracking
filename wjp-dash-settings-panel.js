/* wjp-dash-settings-panel.js v3 — 2026-05-20
 *
 * MINIMAL dashboard settings panel — second iteration.
 *
 * v3 fix: writes to appState.prefs.cardOrder + cardHidden (the keys app.js
 * uses) and delegates rendering to window.applyDashboardLayout(). Previous
 * version wrote to its own localStorage key that nothing else read, so Save
 * looked like it did nothing.
 *
 * Hard rules (kept from v1):
 *   - NO setInterval. NO MutationObserver. NO applyLayout-on-tick.
 *   - DOM mutations fire ONLY on user click.
 */
(function () {
  "use strict";
  if (window._wjpDashSettingsPanelInstalled) return;
  window._wjpDashSettingsPanelInstalled = true;

  var GEAR_ID = "wjp-dash-settings-gear";
  var PANEL_ID = "wjp-dash-settings-panel";
  var SCRIM_ID = "wjp-dash-settings-scrim";

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

  function injectStyle() {
    if (document.getElementById('wjp-dash-settings-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-dash-settings-style';
    var css = [];
    css.push('#' + GEAR_ID + '{position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;transition:transform 0.12s ease, box-shadow 0.12s ease;font-size:16px;}');
    css.push('body.light #' + GEAR_ID + '{background:#ffffff;border:1px solid rgba(10,10,10,0.12);color:#0a0a0a;box-shadow:0 1px 3px rgba(0,0,0,0.06);}');
    css.push('body.dark #' + GEAR_ID + ',body:not(.light) #' + GEAR_ID + '{background:#13192a;border:1px solid rgba(255,255,255,0.10);color:#f1f5f9;}');
    css.push('#' + GEAR_ID + ':hover{transform:rotate(28deg);box-shadow:0 4px 18px rgba(0,0,0,0.18);}');
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

  function getOrderedWidgets() {
    var widgets = gatherWidgets();
    var prefs = getPrefs();
    var savedOrder = prefs.cardOrder || {};
    if (!Object.keys(savedOrder).length) return widgets;

    var flatSaved = [];
    Object.keys(savedOrder).forEach(function (parentKey) {
      var ids = Array.isArray(savedOrder[parentKey]) ? savedOrder[parentKey] : [];
      ids.forEach(function (id) { flatSaved.push(id); });
    });
    if (!flatSaved.length) return widgets;

    var byId = {}; widgets.forEach(function (w) { byId[w.id] = w; });
    var seen = {};
    var sorted = [];
    flatSaved.forEach(function (id) {
      if (byId[id] && !seen[id]) { sorted.push(byId[id]); seen[id] = 1; }
    });
    widgets.forEach(function (w) { if (!seen[w.id]) sorted.push(w); });
    return sorted;
  }

  function buildPanel() {
    var widgets = getOrderedWidgets();
    var prefs = getPrefs();
    var hidden = prefs.cardHidden || {};

    var scrim = document.createElement('div'); scrim.id = SCRIM_ID;
    var panel = document.createElement('div'); panel.id = PANEL_ID;
    panel.innerHTML = ''
      + '<h3>Dashboard settings</h3>'
      + '<div class="wjp-sp-sub">Drag to reorder. Uncheck to hide. Tap Save to apply.</div>'
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
      if (typeof window.applyDashboardLayout === 'function') window.applyDashboardLayout();
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
      if (typeof window.applyDashboardLayout === 'function') window.applyDashboardLayout();
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

  window.WJPDashSettings = { open: openPanel };
})();
