/* WJP_BUILD_TAG_1779224340 — wjp-dashboard-customizer.js v1 — 2026-05-19
 *
 * Stage 2 of dashboard customization. Adds a small ⚙ button in the top-right
 * of #page-dashboard. Clicking it opens a slide-out panel listing all
 * dashboard widgets. User can:
 *   - toggle visibility per widget (checkbox)
 *   - drag-reorder widgets (HTML5 native drag-and-drop)
 * Changes apply immediately and persist to localStorage (Firestore sync
 * deferred to v2). On every page load + on dashboard navigation, the saved
 * layout is re-applied so the user's order/visibility is preserved.
 *
 * Safe patterns:
 *   - IIFE + idempotent install flag
 *   - Uses bare appState via getAppState() (per memory rule)
 *   - No body-subtree MutationObserver (per portfolio/txn-detail incident lessons)
 *   - Discovery runs on a slow 3s tick to pick up late-mounted widgets
 *   - Excludes the customize control itself from being customizable
 */
(function () {
  "use strict";
  if (window._wjpDashCustomizerInstalled) return;
  window._wjpDashCustomizerInstalled = true;
  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  // ---------- storage helpers ----------
  function lsGet(s) {
    try { return (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function')
      ? window.WJP_UserScope.get(s) : localStorage.getItem(s); }
    catch (_) { return localStorage.getItem(s); }
  }
  function lsSet(s, v) {
    try { if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function')
      window.WJP_UserScope.set(s, v);
      else localStorage.setItem(s, v); }
    catch (_) { try { localStorage.setItem(s, v); } catch (e) {} }
  }

  var LS_KEY = "wjp.dashboard.layout.v1";

  // ===== v2 — Firestore sync 2026-05-19 =====
  // Layout writes go to BOTH localStorage (for instant local apply) AND
  // Firestore at users/{uid}/dashboard/layout (so the layout follows the
  // user across devices). On boot we pull from Firestore once, then attach
  // an onSnapshot listener for real-time updates from other devices.
  async function getDb() {
    try {
      if (window.__wjpFsMod && window.__wjpFsMod.db) return window.__wjpFsMod.db;
      if (window.db) return window.db;
      var mod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
      var appMod = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      var apps = (appMod && appMod.getApps) ? appMod.getApps() : [];
      var app = apps[0];
      if (!app) return null;
      window.__wjpFsMod = { mod: mod, db: mod.getFirestore(app) };
      return window.__wjpFsMod.db;
    } catch (_) { return null; }
  }
  function getUid() {
    try {
      if (window.WJP_UserScope && WJP_UserScope.uid) return WJP_UserScope.uid();
      if (window.__wjpUser && window.__wjpUser.uid) return window.__wjpUser.uid;
    } catch (_) {}
    return null;
  }

  async function saveLayoutToCloud(layout) {
    var uid = getUid();
    if (!uid) return false;
    var db = await getDb();
    if (!db) return false;
    try {
      var m = window.__wjpFsMod.mod;
      var ref = m.doc(db, 'users', uid, 'dashboard', 'layout');
      await m.setDoc(ref, layout, { merge: false });
      return true;
    } catch (e) { return false; }
  }

  async function loadLayoutFromCloud() {
    var uid = getUid();
    if (!uid) return null;
    var db = await getDb();
    if (!db) return null;
    try {
      var m = window.__wjpFsMod.mod;
      var ref = m.doc(db, 'users', uid, 'dashboard', 'layout');
      var snap = await m.getDoc(ref);
      return snap.exists() ? snap.data() : null;
    } catch (e) { return null; }
  }

  var _cloudUnsub = null;
  var _lastCloudSavedAt = 0;
  async function watchCloud() {
    var uid = getUid();
    if (!uid) return;
    var db = await getDb();
    if (!db) return;
    try {
      var m = window.__wjpFsMod.mod;
      var ref = m.doc(db, 'users', uid, 'dashboard', 'layout');
      if (_cloudUnsub) { try { _cloudUnsub(); } catch (_) {} }
      _cloudUnsub = m.onSnapshot(ref, function (snap) {
        try {
          if (!snap.exists()) return;
          var data = snap.data();
          if (!data || !Array.isArray(data.widgets)) return;
          // Last-write-wins via savedAt — ignore if our local copy is newer
          var localRaw = lsGet(LS_KEY);
          var local = null;
          try { local = localRaw ? JSON.parse(localRaw) : null; } catch (_) {}
          var localTs = (local && local.savedAt) || 0;
          var cloudTs = data.savedAt || 0;
          if (localTs > cloudTs) return; // local is newer (e.g., just saved here)
          // Cloud update from another device — apply
          _lastCloudSavedAt = cloudTs;
          try { lsSet(LS_KEY, JSON.stringify(data)); } catch (_) {}
          try { applyLayout(); } catch (_) {}
        } catch (_) {}
      }, function () {}); // silent error handler
    } catch (_) {}
  }

  var STYLE_ID = "wjp-dash-customizer-style";
  var TRIGGER_ID = "wjp-dash-customizer-trigger";
  var PANEL_ID = "wjp-dash-customizer-panel";
  var SCRIM_ID = "wjp-dash-customizer-scrim";

  // Widgets that should NEVER be customizable (system controls, hidden helpers)
  var EXCLUDED_IDS = {
    "dash-customize-bar": true, // existing auto-fit toggle
    "wjp-dash-customizer-trigger": true,
    "wjp-dash-customizer-panel": true,
    "wjp-dash-customizer-scrim": true
  };

  // Default human-readable labels for known widget IDs. Falls back to widget's
  // own heading text or its id.
  var LABEL_OVERRIDES = {
    "wjp-edu-dashboard-tip": "Daily money lesson",
    "wjp-dashboard-hero": "Active debt target",
    "wjp-paycheck-ai-card": "AI insight",
    "dash-greeting": "Greeting",
    "dfd-hero": "Debt-free date summary",
    "wjp-momentum-hero": "Weekly momentum",
    "top3-strategy": "Top 3 to attack",
    "dash-strategy-card": "Strategy panel",
    "dash-stats-card": "Quick stats",
    "wjp-recurring-fixes": "Recurring bills",
    "wjp-dash-debit-balances": "Bank balances",
    // .reorderable cards (inside dash-grid and elsewhere) — labels match app.js card titles
    "ai-advisor-card": "AI Advisor",
    "math-breakdown": "Debt math breakdown",
    "dash-linked-assets-card": "Linked assets",
    "dash-money-left-card": "Money left after bills",
    "dash-payoff-engine-card": "Payoff engine",
    "dash-financial-resilience": "Financial resilience",
    "dash-spending-card": "Spending tracker",
    "upcoming-view-container": "Upcoming payments",
    "credit-profile-card": "Credit profile"
  };
  // v2.1 — group widgets by section in the customize panel
  var SECTION_GROUPS = {
    "Hero": ["wjp-edu-dashboard-tip", "wjp-dashboard-hero", "dash-greeting", "dfd-hero", "wjp-momentum-hero"],
    "Insights": ["wjp-paycheck-ai-card", "ai-advisor-card", "math-breakdown"],
    "Debts": ["top3-strategy", "dash-strategy-card", "dash-payoff-engine-card", "dash-financial-resilience", "credit-profile-card"],
    "Cash & Spending": ["wjp-dash-debit-balances", "dash-linked-assets-card", "dash-money-left-card", "dash-spending-card", "upcoming-view-container", "wjp-recurring-fixes"],
    "Stats": ["dash-stats-card"]
  };
  function sectionFor(id) {
    for (var sec in SECTION_GROUPS) {
      if (SECTION_GROUPS[sec].indexOf(id) >= 0) return sec;
    }
    return "Other";
  }


  function loadLayout() {
    try {
      var raw = lsGet(LS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !Array.isArray(p.widgets)) return null;
      return p;
    } catch (_) { return null; }
  }
  function saveLayout(layout) {
    try { lsSet(LS_KEY, JSON.stringify(layout)); } catch (_) {}
    // Push to Firestore so other devices pick it up
    try { saveLayoutToCloud(layout); } catch (_) {}
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      // Trigger button — floats above the dashboard, top-right
      "#" + TRIGGER_ID + " {",
      "  position: relative;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  gap: 6px;",
      "  background: var(--card-2, #f7f6f2);",
      "  border: 1px solid var(--border-accent, rgba(31,122,74,0.28));",
      "  color: var(--ink, var(--text-1, #141414));",
      "  border-radius: 999px;",
      "  padding: 6px 12px 6px 10px;",
      "  font-size: 12px;",
      "  font-weight: 600;",
      "  cursor: pointer;",
      "  font-family: var(--sans, Inter, system-ui, sans-serif);",
      "  transition: filter 0.15s ease;",
      "}",
      "#" + TRIGGER_ID + ":hover { filter: brightness(0.97); }",
      "body.dark #" + TRIGGER_ID + " { background: var(--card-2, #1c2540); border-color: var(--border-accent, rgba(0,212,168,0.25)); }",
      "#" + TRIGGER_ID + " svg { width: 14px; height: 14px; stroke: var(--accent, #1f7a4a); }",
      // Wrapper so the trigger lives on the right side of the dashboard top bar
      ".wjp-dash-customizer-row { display: flex; justify-content: flex-end; padding: 4px 0 0; margin-bottom: -8px; }",
      // v1.4: make dash-customize-bar a tidy flex row at the top of the dashboard
      "#dash-customize-bar { display: flex !important; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 0; margin: 6px 0 16px; }",
      "#dash-customize-bar > * { flex: 0 0 auto; }",
      // Spacer so Customize pill drops to the right side
      "#dash-customize-bar #" + TRIGGER_ID + " { margin-left: auto; }",
      // Scrim
      "#" + SCRIM_ID + " {",
      "  position: fixed; inset: 0;",
      "  background: rgba(0,0,0,0.4);",
      "  z-index: 9998;",
      "  opacity: 0; pointer-events: none;",
      "  transition: opacity 0.18s ease;",
      "}",
      "#" + SCRIM_ID + ".open { opacity: 1; pointer-events: auto; }",
      // Panel — slides in from right
      "#" + PANEL_ID + " {",
      "  position: fixed;",
      "  top: 0; right: 0; bottom: 0;",
      "  width: min(420px, 92vw);",
      "  background: var(--card, var(--bg, #ffffff));",
      "  color: var(--ink, var(--text-1, #141414));",
      "  border-left: 1px solid var(--border, rgba(20,20,20,0.08));",
      "  box-shadow: -10px 0 40px rgba(0,0,0,0.18);",
      "  z-index: 9999;",
      "  transform: translateX(100%);",
      "  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);",
      "  display: flex;",
      "  flex-direction: column;",
      "  font-family: var(--sans, Inter, system-ui, sans-serif);",
      "}",
      "#" + PANEL_ID + ".open { transform: translateX(0); }",
      "body.dark #" + PANEL_ID + " { background: var(--card, #131929); border-left-color: var(--border, rgba(255,255,255,0.06)); }",
      "#" + PANEL_ID + " .wjp-dc-header { padding: 18px 22px 14px; border-bottom: 1px solid var(--border, rgba(20,20,20,0.08)); display: flex; align-items: center; justify-content: space-between; gap: 12px; }",
      "#" + PANEL_ID + " .wjp-dc-header h3 { font-size: 17px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }",
      "#" + PANEL_ID + " .wjp-dc-header .wjp-dc-close { background: transparent; border: 0; color: var(--ink-faint, var(--text-3, #8a9bb0)); font-size: 22px; cursor: pointer; line-height: 1; padding: 4px 8px; font-family: inherit; }",
      "#" + PANEL_ID + " .wjp-dc-hint { padding: 12px 22px; font-size: 12px; color: var(--ink-dim, var(--text-2, #4a5568)); border-bottom: 1px solid var(--border, rgba(20,20,20,0.06)); line-height: 1.5; }",
      "#" + PANEL_ID + " .wjp-dc-list { flex: 1; overflow-y: auto; padding: 8px 14px 16px; }",
      "#" + PANEL_ID + " .wjp-dc-item {",
      "  display: flex; align-items: center; gap: 10px;",
      "  padding: 12px 12px 12px 6px;",
      "  margin: 4px 0;",
      "  background: var(--card-2, #f7f6f2);",
      "  border: 1px solid transparent;",
      "  border-radius: 12px;",
      "  cursor: grab;",
      "  user-select: none;",
      "  transition: border-color 0.15s ease, background 0.15s ease;",
      "}",
      "body.dark #" + PANEL_ID + " .wjp-dc-item { background: var(--card-2, #1c2540); }",
      "#" + PANEL_ID + " .wjp-dc-item:hover { border-color: var(--border-accent, rgba(31,122,74,0.22)); }",
      "#" + PANEL_ID + " .wjp-dc-item.dragging { opacity: 0.5; cursor: grabbing; }",
      "#" + PANEL_ID + " .wjp-dc-item.drop-target { border-color: var(--accent, #1f7a4a); }",
      "#" + PANEL_ID + " .wjp-dc-handle { color: var(--ink-faint, #8a9bb0); font-size: 16px; line-height: 1; padding: 0 4px; cursor: grab; }",
      "#" + PANEL_ID + " .wjp-dc-check { width: 18px; height: 18px; accent-color: var(--accent, #1f7a4a); cursor: pointer; }",
      "#" + PANEL_ID + " .wjp-dc-label { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; }",
      "#" + PANEL_ID + " .wjp-dc-item.hidden .wjp-dc-label { color: var(--ink-faint, #8a9bb0); text-decoration: line-through; }",
      "#" + PANEL_ID + " .wjp-dc-footer { padding: 14px 22px 18px; border-top: 1px solid var(--border, rgba(20,20,20,0.08)); display: flex; gap: 10px; justify-content: space-between; align-items: center; }",
      "#" + PANEL_ID + " .wjp-dc-reset { background: transparent; border: 0; color: var(--ink-dim, #4a5568); font-size: 12px; font-weight: 600; cursor: pointer; padding: 6px 10px; font-family: inherit; }",
      "#" + PANEL_ID + " .wjp-dc-reset:hover { color: var(--accent, #1f7a4a); }",
      "#" + PANEL_ID + " .wjp-dc-done { background: var(--accent, #1f7a4a); color: #fff; border: 0; padding: 10px 22px; border-radius: 999px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }",
      "#" + PANEL_ID + " .wjp-dc-done:hover { filter: brightness(1.08); }",
      // Apply layout — hidden widgets
      "#page-dashboard .wjp-widget-hidden { display: none !important; }",
      // v2.1 — search row
      "#" + PANEL_ID + " .wjp-dc-search-row { padding: 0 22px 10px; }",
      "#" + PANEL_ID + " .wjp-dc-search { width: 100%; padding: 9px 12px; font-size: 13px; border-radius: 10px; border: 1px solid var(--border, rgba(20,20,20,0.12)); background: var(--card-2, #f7f6f2); color: var(--ink, #141414); font-family: inherit; outline: none; }",
      "#" + PANEL_ID + " .wjp-dc-search:focus { border-color: var(--accent, #1f7a4a); }",
      "body.dark #" + PANEL_ID + " .wjp-dc-search { background: var(--card-2, #1c2540); color: var(--ink, #f0f4ff); border-color: var(--border, rgba(255,255,255,0.1)); }",
      // section headers
      "#" + PANEL_ID + " .wjp-dc-section { margin-bottom: 14px; }",
      "#" + PANEL_ID + " .wjp-dc-section-header { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint, #8a9bb0); font-weight: 800; padding: 6px 8px 4px; margin-top: 4px; }",
      // v2.1 — mobile: bottom sheet instead of side panel
      "@media (max-width: 640px) {",
      "  #" + PANEL_ID + " {",
      "    top: auto; bottom: 0; right: 0; left: 0;",
      "    width: 100% !important;",
      "    max-height: 85vh;",
      "    border-left: 0;",
      "    border-top: 1px solid var(--border, rgba(20,20,20,0.08));",
      "    border-radius: 18px 18px 0 0;",
      "    transform: translateY(100%);",
      "  }",
      "  #" + PANEL_ID + ".open { transform: translateY(0); }",
      "}",

    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  // ---------- widget discovery ----------
  function findDashboardHost() {
    return document.getElementById("page-dashboard");
  }
  function isCustomizable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.tagName === "STYLE" || node.tagName === "SCRIPT" || node.tagName === "LINK") return false;
    if (!node.id) return false; // need a stable id to track
    if (EXCLUDED_IDS[node.id]) return false;
    return true;
  }
  function discoverWidgets(host) {
    if (!host) return [];
    var out = [];
    var seen = {};
    // Direct children of #page-dashboard with stable IDs
    Array.from(host.children).forEach(function (c) {
      if (!isCustomizable(c)) return;
      if (seen[c.id]) return;
      seen[c.id] = true;
      out.push({
        id: c.id,
        label: LABEL_OVERRIDES[c.id] || labelFromNode(c) || c.id
      });
    });
    // v1.5: ALSO discover .reorderable cards anywhere inside the dashboard
    // (e.g., nested in dash-grid). These are app.js-managed cards like Credit
    // Profile, AI Advisor, Spending Tracker, etc.
    Array.from(host.querySelectorAll('.reorderable')).forEach(function (c) {
      if (!c.id) return;
      if (seen[c.id]) return;
      if (EXCLUDED_IDS[c.id]) return;
      seen[c.id] = true;
      out.push({
        id: c.id,
        label: LABEL_OVERRIDES[c.id] || labelFromNode(c) || c.getAttribute('data-card-id') || c.id
      });
    });
    return out;
  }
  function labelFromNode(node) {
    try {
      var h = node.querySelector('h1, h2, h3, .section-title, .eyebrow, .wjp-edu-eyebrow');
      if (h) {
        var s = (h.textContent || "").trim();
        if (s) return s.replace(/\s+/g, ' ').slice(0, 36);
      }
    } catch (_) {}
    return null;
  }

  // ---------- layout apply ----------
  function applyLayout() {
    var host = findDashboardHost();
    if (!host) return;
    var layout = loadLayout();
    if (!layout) return;
    var idToWidget = {};
    layout.widgets.forEach(function (w) { idToWidget[w.id] = w; });

    // Hide / show
    Array.from(host.children).forEach(function (c) {
      if (!c.id || EXCLUDED_IDS[c.id]) return;
      var w = idToWidget[c.id];
      if (!w) return;
      if (w.visible === false) {
        c.classList.add('wjp-widget-hidden');
      } else {
        c.classList.remove('wjp-widget-hidden');
      }
    });

    // Reorder: walk layout.widgets in order. SKIP no-op moves (insertBefore
    // when the node is already in the correct position causes a pointless
    // mutation that browsers can still repaint). v1.3 — no flicker.
    var sortedTail = null;
    layout.widgets.forEach(function (w) {
      var node = document.getElementById(w.id);
      if (!node || node.parentElement !== host) return;
      try {
        if (sortedTail === null) {
          if (host.firstElementChild !== node) {
            host.insertBefore(node, host.firstChild);
          }
        } else {
          if (sortedTail.nextElementSibling !== node) {
            host.insertBefore(node, sortedTail.nextSibling);
          }
        }
        sortedTail = node;
      } catch (_) {}
    });
  }

  // ---------- panel UI ----------
  function buildPanel(widgets, layout) {
    var idToLayout = {};
    (layout ? layout.widgets : []).forEach(function (w) { idToLayout[w.id] = w; });
    var ordered = [];
    var seen = {};
    if (layout) {
      layout.widgets.forEach(function (w) {
        var liveLabel = widgets.find(function (x) { return x.id === w.id; });
        if (liveLabel) {
          ordered.push({ id: w.id, label: liveLabel.label, visible: w.visible !== false });
          seen[w.id] = true;
        }
      });
    }
    widgets.forEach(function (w) {
      if (seen[w.id]) return;
      ordered.push({ id: w.id, label: w.label, visible: true });
    });

    // v2.1 — group items by section, preserve ordering within sections.
    var sectionMap = {};
    var sectionOrder = ["Hero", "Insights", "Debts", "Cash & Spending", "Stats", "Other"];
    ordered.forEach(function (w) {
      var sec = sectionFor(w.id);
      if (!sectionMap[sec]) sectionMap[sec] = [];
      sectionMap[sec].push(w);
    });
    var grouped = "";
    sectionOrder.forEach(function (sec) {
      if (!sectionMap[sec] || sectionMap[sec].length === 0) return;
      grouped += '<div class="wjp-dc-section">' +
        '<div class="wjp-dc-section-header">' + escapeHTML(sec) + '</div>' +
        sectionMap[sec].map(function (w) {
          return '<div class="wjp-dc-item' + (w.visible ? '' : ' hidden') + '" draggable="true" data-widget-id="' + w.id + '">' +
            '<span class="wjp-dc-handle" aria-hidden="true">⋮⋮</span>' +
            '<input type="checkbox" class="wjp-dc-check"' + (w.visible ? ' checked' : '') + '>' +
            '<span class="wjp-dc-label">' + escapeHTML(w.label) + '</span>' +
          '</div>';
        }).join('') +
      '</div>';
    });

    var html = '<div class="wjp-dc-header"><h3>Customize dashboard</h3>' +
      '<button type="button" class="wjp-dc-close" aria-label="Close">×</button></div>' +
      '<div class="wjp-dc-hint">Drag to reorder. Uncheck to hide. Changes save automatically.</div>' +
      '<div class="wjp-dc-search-row">' +
        '<input type="search" class="wjp-dc-search" placeholder="Filter widgets…" autocomplete="off">' +
      '</div>' +
      '<div class="wjp-dc-list" id="wjp-dc-list">' + grouped + '</div>' +
      '<div class="wjp-dc-footer">' +
        '<button type="button" class="wjp-dc-reset">Reset to default</button>' +
        '<button type="button" class="wjp-dc-done">Done</button>' +
      '</div>';
    return html;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function currentLayoutFromPanel() {
    var list = document.getElementById('wjp-dc-list');
    if (!list) return null;
    var widgets = [];
    Array.from(list.querySelectorAll('.wjp-dc-item')).forEach(function (item) {
      var id = item.getAttribute('data-widget-id');
      var checked = item.querySelector('.wjp-dc-check').checked;
      widgets.push({ id: id, visible: !!checked });
    });
    return { widgets: widgets, savedAt: Date.now() };
  }

  function persistFromPanel() {
    var layout = currentLayoutFromPanel();
    if (!layout) return;
    saveLayout(layout);
    applyLayout();
  }

  // Native HTML5 drag-and-drop wiring
  function wireDragDrop(list) {
    var dragging = null;
    list.addEventListener('dragstart', function (e) {
      var item = e.target.closest('.wjp-dc-item');
      if (!item) return;
      dragging = item;
      item.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
      try { e.dataTransfer.setData('text/plain', item.getAttribute('data-widget-id') || ''); } catch (_) {}
    });
    list.addEventListener('dragend', function () {
      if (dragging) dragging.classList.remove('dragging');
      dragging = null;
      Array.from(list.querySelectorAll('.wjp-dc-item')).forEach(function (i) { i.classList.remove('drop-target'); });
      persistFromPanel();
    });
    list.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var target = e.target.closest('.wjp-dc-item');
      if (!target || target === dragging) return;
      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        if (target.previousElementSibling !== dragging) list.insertBefore(dragging, target);
      } else {
        if (target.nextElementSibling !== dragging) list.insertBefore(dragging, target.nextElementSibling);
      }
    });
  }

  function wireCheckboxes(list) {
    list.addEventListener('change', function (e) {
      var cb = e.target.closest('.wjp-dc-check');
      if (!cb) return;
      var item = cb.closest('.wjp-dc-item');
      if (item) item.classList.toggle('hidden', !cb.checked);
      persistFromPanel();
    });
  }

  function openPanel() {
    var host = findDashboardHost();
    if (!host) return;
    var widgets = discoverWidgets(host);
    var layout = loadLayout();
    var existing = document.getElementById(PANEL_ID);
    if (existing) try { existing.remove(); } catch (_) {}
    var scrim = document.getElementById(SCRIM_ID);
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = SCRIM_ID;
      document.body.appendChild(scrim);
      scrim.addEventListener('click', closePanel);
    }
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = buildPanel(widgets, layout);
    document.body.appendChild(panel);

    // Wire interactions
    panel.querySelector('.wjp-dc-close').addEventListener('click', closePanel);
    panel.querySelector('.wjp-dc-done').addEventListener('click', closePanel);

    // v2.1 — Esc key closes
    var escHandler = function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) closePanel();
    };
    document.addEventListener('keydown', escHandler);
    panel._escHandler = escHandler;

    // v2.1 — search filter
    var searchInput = panel.querySelector('.wjp-dc-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var q = (searchInput.value || '').toLowerCase().trim();
        var items = panel.querySelectorAll('.wjp-dc-item');
        var sections = panel.querySelectorAll('.wjp-dc-section');
        items.forEach(function (it) {
          var lbl = (it.querySelector('.wjp-dc-label').textContent || '').toLowerCase();
          it.style.display = (!q || lbl.indexOf(q) >= 0) ? '' : 'none';
        });
        // Hide section headers that have no visible items
        sections.forEach(function (sec) {
          var visible = Array.from(sec.querySelectorAll('.wjp-dc-item')).some(function (i) { return i.style.display !== 'none'; });
          sec.style.display = visible ? '' : 'none';
        });
      });
    }
    panel.querySelector('.wjp-dc-reset').addEventListener('click', function () {
      try { (window.WJP_UserScope && WJP_UserScope.remove ? WJP_UserScope.remove(LS_KEY) : localStorage.removeItem(LS_KEY)); } catch (_) {}
      // Remove all hidden classes, re-render panel
      Array.from(host.children).forEach(function (c) { c.classList.remove('wjp-widget-hidden'); });
      closePanel();
      setTimeout(openPanel, 50);
    });
    var list = panel.querySelector('#wjp-dc-list');
    wireDragDrop(list);
    wireCheckboxes(list);

    // Animate in
    requestAnimationFrame(function () {
      scrim.classList.add('open');
      panel.classList.add('open');
    });
  }

  function closePanel() {
    var panel = document.getElementById(PANEL_ID);
    var scrim = document.getElementById(SCRIM_ID);
    if (panel && panel._escHandler) {
      try { document.removeEventListener('keydown', panel._escHandler); } catch (_) {}
    }
    if (panel) panel.classList.remove('open');
    if (scrim) scrim.classList.remove('open');
    setTimeout(function () {
      if (panel) try { panel.remove(); } catch (_) {}
      if (scrim) try { scrim.remove(); } catch (_) {}
    }, 240);
  }

  // ---------- trigger button install ----------
  // v1.4: install button INSIDE the existing #dash-customize-bar so all three
  // controls (Customize layout, Auto-fit, Customize) sit together. Also moves
  // that bar to the top of the dashboard (right after the Ed Tips banner).
  function installTrigger() {
    var host = findDashboardHost();
    if (!host) return;

    // Remove any stale standalone row from prior versions
    var staleRow = host.querySelector('.wjp-dash-customizer-row');
    if (staleRow) try { staleRow.remove(); } catch (_) {}

    // v1.5: dash-customize-bar ALWAYS sits at position 0 (very top). Ed Tips
    // banner and all other widgets are pushed below it so the user always sees
    // the controls first.
    var bar = document.getElementById('dash-customize-bar');
    if (bar && bar.parentElement === host) {
      if (host.firstElementChild !== bar) {
        try { host.insertBefore(bar, host.firstChild); } catch (_) {}
      }
    }

    if (document.getElementById(TRIGGER_ID)) return;

    var btn = document.createElement('button');
    btn.id = TRIGGER_ID;
    btn.type = 'button';
    btn.setAttribute('title', 'Show / hide widgets and reorder');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
      '</svg>Customize';
    btn.addEventListener('click', openPanel);

    if (bar) {
      // Append into the existing bar so all three controls are in one row
      bar.appendChild(btn);
    } else {
      // No bar — fall back to a standalone row at the top, after Ed Tips
      var row = document.createElement('div');
      row.className = 'wjp-dash-customizer-row';
      row.appendChild(btn);
      if (edu && edu.parentElement === host) {
        host.insertBefore(row, edu.nextSibling);
      } else {
        host.insertBefore(row, host.firstChild);
      }
    }
  }

  function tick() {
    try {
      var host = findDashboardHost();
      if (!host || !host.classList.contains('active')) return;
      installTrigger();
      applyLayout();
    } catch (e) {}
  }

  // v2: hydrate from cloud on boot, then watch for changes from other devices
  async function bootstrapCloud() {
    try {
      var cloud = await loadLayoutFromCloud();
      if (cloud && Array.isArray(cloud.widgets)) {
        // Cloud has a layout — use it as authoritative if newer than local
        var localRaw = lsGet(LS_KEY);
        var local = null;
        try { local = localRaw ? JSON.parse(localRaw) : null; } catch (_) {}
        var localTs = (local && local.savedAt) || 0;
        var cloudTs = cloud.savedAt || 0;
        if (cloudTs >= localTs) {
          try { lsSet(LS_KEY, JSON.stringify(cloud)); } catch (_) {}
          try { applyLayout(); } catch (_) {}
        }
      }
      watchCloud();
    } catch (_) {}
  }

  function boot() {
    injectStyle();
    tick();
    setInterval(tick, 8000);
    window.addEventListener('hashchange', tick);
    // Cloud sync — runs after a short delay so Firebase Auth + the FS SDK
    // have time to settle. Don't block initial tick.
    setTimeout(bootstrapCloud, 2000);
    // Re-bootstrap when user changes (signin/signout)
    try {
      if (window.WJP_UserScope && WJP_UserScope.onAuthChange) {
        WJP_UserScope.onAuthChange(function () { setTimeout(bootstrapCloud, 500); });
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Expose helpers for debugging
  window.WJP_DashCustomizer = {
    open: openPanel,
    close: closePanel,
    reset: function () { try { localStorage.removeItem(LS_KEY); } catch (_) {} applyLayout(); },
    version: 2.1-polished
  };
})();
