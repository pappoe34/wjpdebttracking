/* wjp-notes-tab.js v1.1 — replace Plans tab with a full Notes feature.
 *
 * Hijacks #page-plans (the existing Plans page) and the sidebar nav item
 * that points at it. Builds a complete note-taking UI with:
 *   - List + editor two-pane layout
 *   - Search across title and body
 *   - Optional pin-to-date that surfaces on the Calendar
 *   - Browser-notification reminders + on-calendar dot
 *   - Email reminders stubbed (UI present, marked "coming soon")
 *   - Color tags
 *   - Archive flow
 *
 * Storage: wjp.notes.v2 (new unified store). Migrates from wjp.cal.notes.v1
 * (the old date-keyed map) on first run. Calendar reads from this same
 * store so a note pinned to May 20 in the Notes tab shows up as a dot on
 * the Calendar, and vice versa.
 *
 * Plans is moved to Settings → Billing via wjp-settings-extras.js
 * (sibling module).
 *
 * Hardened pattern: IIFE, idempotent, path-guarded, polled, no Mutation-
 * Observer. Synchronous flicker guard hides original content immediately.
 */
(function () {
  "use strict";
  if (window._wjpNotesInstalled) return;
  window._wjpNotesInstalled = true;

  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  var ROOT_ID = "wjp-notes-root";
  var LS_NOTES_V2 = "wjp.notes.v2";
  var LS_NOTES_V1 = "wjp.cal.notes.v1";
  var LS_LAST_REMINDER_CHECK = "wjp.notes.lastReminderCheck";
  var LS_VIEW_PREFS = "wjp.notes.viewPrefs.v1";

  // Synchronous flicker guard for #page-plans
  (function installGuard() {
    try {
      if (document.getElementById("wjp-notes-flicker-guard")) return;
      var s = document.createElement("style");
      s.id = "wjp-notes-flicker-guard";
      s.textContent = "#page-plans > *:not(#" + ROOT_ID + "){display:none !important;}";
      (document.head || document.documentElement).appendChild(s);
      setTimeout(function () {
        if (!document.getElementById(ROOT_ID)) {
          try { s.remove(); } catch (_) {}
        }
      }, 5000);
    } catch (_) {}
  })();

  // === Storage / migration ===
  function loadStore() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_NOTES_V2) || "null");
      if (v && v.byId) return v;
    } catch (_) {}
    return { byId: {}, migrated: false };
  }

  function saveStore(s) {
    try { localStorage.setItem(LS_NOTES_V2, JSON.stringify(s)); } catch (_) {}
  }

  function migrateFromV1IfNeeded() {
    var s = loadStore();
    if (s.migrated) return s;
    try {
      var v1 = JSON.parse(localStorage.getItem(LS_NOTES_V1) || "null");
      if (v1 && typeof v1 === "object") {
        Object.keys(v1).forEach(function (date) {
          var n = v1[date]; if (!n || (!n.text && !n.reminderAt)) return;
          var id = "n_v1_" + date.replace(/-/g, "");
          if (s.byId[id]) return;
          s.byId[id] = {
            id: id,
            title: "",
            body: n.text || "",
            pinnedDate: date,
            reminderAt: n.reminderAt || null,
            reminderEmail: false,
            color: null,
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            fired: !!n.fired,
            source: "calendar-v1"
          };
        });
      }
    } catch (_) {}
    s.migrated = true;
    saveStore(s);
    return s;
  }

  function genId() {
    return "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function newNote(seed) {
    var n = {
      id: genId(),
      title: "",
      body: "",
      pinnedDate: null,
      reminderAt: null,
      reminderEmail: false,
      color: null,
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fired: false
    };
    if (seed) Object.keys(seed).forEach(function (k) { n[k] = seed[k]; });
    return n;
  }

  function upsertNote(n) {
    var s = loadStore();
    n.updatedAt = Date.now();
    s.byId[n.id] = n;
    saveStore(s);
    // Also keep wjp.cal.notes.v1 roughly in sync for back-compat readers
    syncToV1(s);
  }

  function deleteNote(id) {
    var s = loadStore();
    delete s.byId[id];
    saveStore(s);
    syncToV1(s);
  }

  function syncToV1(s) {
    try {
      var v1 = {};
      Object.values(s.byId).forEach(function (n) {
        if (!n.pinnedDate || n.archived) return;
        var t = n.body || n.title || "";
        if (!v1[n.pinnedDate] || (n.updatedAt > (v1[n.pinnedDate]._ts || 0))) {
          v1[n.pinnedDate] = { text: t, reminderAt: n.reminderAt, fired: !!n.fired, _ts: n.updatedAt };
        }
      });
      Object.keys(v1).forEach(function (k) { delete v1[k]._ts; });
      localStorage.setItem(LS_NOTES_V1, JSON.stringify(v1));
    } catch (_) {}
  }

  function listNotes(filter) {
    filter = filter || {};
    var s = loadStore();
    var arr = Object.values(s.byId);
    if (!filter.includeArchived) arr = arr.filter(function (n) { return !n.archived; });
    if (filter.q) {
      var q = filter.q.toLowerCase();
      arr = arr.filter(function (n) {
        return ((n.title || "") + " " + (n.body || "")).toLowerCase().indexOf(q) !== -1;
      });
    }
    arr.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return arr;
  }

  // === Reminder check (browser Notification) ===
  function checkReminders() {
    var lastCheck = parseInt(localStorage.getItem(LS_LAST_REMINDER_CHECK) || "0", 10);
    if (Date.now() - lastCheck < 25000) return;
    localStorage.setItem(LS_LAST_REMINDER_CHECK, String(Date.now()));
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    var s = loadStore();
    var changed = false;
    var now = Date.now();
    Object.values(s.byId).forEach(function (n) {
      if (!n.reminderAt || n.fired || n.archived) return;
      if (now < n.reminderAt) return;
      try {
        var title = "WJP Reminder" + (n.title ? " · " + n.title : "");
        var body = n.body || (n.pinnedDate ? "Pinned to " + n.pinnedDate : "");
        new Notification(title, { body: body });
        n.fired = true;
        changed = true;
      } catch (_) {}
    });
    if (changed) saveStore(s);
  }

  // === View prefs ===
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_VIEW_PREFS) || "null") || {}; }
    catch (_) { return {}; }
  }
  function savePrefs(p) { try { localStorage.setItem(LS_VIEW_PREFS, JSON.stringify(p)); } catch (_) {} }

  var state = {
    selectedId: null,
    query: "",
    showArchived: false,
    dirty: false,
    saveTimer: null
  };

  // === Helpers ===
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDateLong(d) {
    if (!d) return "";
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function fmtRelative(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    var d = Math.floor(hr / 24);
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function preview(s, n) { var t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; }

  // === Sidebar nav relabel ===
  function relabelSidebar() {
    var nav = document.querySelector('[data-page="plans"]');
    if (!nav || nav.dataset.wjpRelabeled === "1") return;
    nav.dataset.wjpRelabeled = "1";
    var span = nav.querySelector("span");
    if (span) span.textContent = "Notes";
    var icon = nav.querySelector(".nav-icon i, .nav-icon svg, .nav-icon");
    if (icon && icon.tagName === "I") icon.className = "ph ph-note-pencil";
  }

  // === Render ===
  function findHost() {
    var page = document.getElementById("page-plans");
    if (!page || !page.classList.contains("active")) return null;
    return page;
  }

  function ensureStyle() {
    if (document.getElementById("wjp-notes-styles")) return;
    var s = document.createElement("style");
    s.id = "wjp-notes-styles";
    s.textContent = `
      #${ROOT_ID} { font-family: var(--sans, Inter, system-ui, sans-serif); color: var(--ink, #0a0a0a); padding: 18px 0 24px; width: 100%; box-sizing: border-box; }
      .wjp-notes-shell { display: grid; grid-template-columns: 320px 1fr; gap: 14px; min-height: 560px; }
      .wjp-notes-list { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; max-height: 78vh; }
      .wjp-notes-list-head { padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.015); }
      .wjp-notes-search { width: 100%; padding: 7px 10px; border: 1px solid rgba(0,0,0,0.10); border-radius: 8px; font-family: inherit; font-size: 12.5px; color: #0a0a0a; }
      .wjp-notes-newbtn { background: #1f7a4a; color: #fff; border: 0; padding: 8px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }
      .wjp-notes-newbtn:hover { filter: brightness(1.05); }
      .wjp-notes-list-body { overflow-y: auto; flex: 1; }
      .wjp-notes-empty { padding: 32px 18px; text-align: center; color: #9ca3af; font-size: 12.5px; }
      .wjp-notes-row { padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.05); cursor: pointer; transition: background .12s; }
      .wjp-notes-row:hover { background: rgba(0,0,0,0.025); }
      .wjp-notes-row.wjp-active { background: rgba(31,122,74,0.08); border-left: 3px solid #1f7a4a; padding-left: 11px; }
      .wjp-notes-row .ttl { font-size: 13px; font-weight: 700; color: #0a0a0a; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .wjp-notes-row .pre { font-size: 11.5px; color: #6b7280; line-height: 1.4; margin-top: 3px; max-height: 2.8em; overflow: hidden; }
      .wjp-notes-row .meta { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 10px; color: #9ca3af; font-weight: 600; letter-spacing: 0.01em; }
      .wjp-notes-row .meta .pin { color: #1f7a4a; }
      .wjp-notes-row .meta .bell { color: #c99a2a; }
      .wjp-notes-editor { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 22px 26px; display: flex; flex-direction: column; gap: 14px; }
      .wjp-notes-editor-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 360px; color: #9ca3af; text-align: center; padding: 40px; }
      .wjp-notes-editor-empty .big { font-size: 36px; }
      .wjp-notes-title { font-size: 22px; font-weight: 700; letter-spacing: -0.015em; border: 0; outline: 0; padding: 0; background: transparent; color: #0a0a0a; font-family: inherit; }
      .wjp-notes-title::placeholder { color: #9ca3af; }
      .wjp-notes-body { min-height: 220px; border: 0; outline: 0; padding: 0; background: transparent; color: #1a1a1a; font-family: inherit; font-size: 14px; line-height: 1.6; resize: vertical; }
      .wjp-notes-body::placeholder { color: #c0c5cf; }
      .wjp-notes-meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.06); }
      .wjp-notes-meta label { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #6b7280; font-weight: 600; }
      .wjp-notes-meta input[type="date"], .wjp-notes-meta input[type="datetime-local"] { border: 1px solid rgba(0,0,0,0.12); border-radius: 6px; padding: 5px 8px; font-family: inherit; font-size: 12px; color: #0a0a0a; }
      .wjp-notes-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.06); }
      .wjp-notes-actions button { font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; padding: 7px 14px; border-radius: 999px; }
      .wjp-notes-btn-primary { background: #1f7a4a; color: #fff; border: 0; }
      .wjp-notes-btn-secondary { background: #fff; color: #0a0a0a; border: 1px solid rgba(0,0,0,0.10); }
      .wjp-notes-btn-danger { background: transparent; color: #dc2626; border: 1px solid rgba(220,38,38,0.30); }
      .wjp-notes-saved-hint { font-size: 11px; color: #1f7a4a; font-weight: 600; }
      .wjp-notes-coming-soon { font-size: 10px; letter-spacing: 0.05em; color: #c99a2a; background: rgba(201,154,42,0.10); padding: 2px 8px; border-radius: 999px; font-weight: 700; }
      .wjp-notes-arch-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #6b7280; font-weight: 600; cursor: pointer; }
      .wjp-notes-color-pick { display: inline-flex; gap: 4px; align-items: center; }
      .wjp-notes-color-dot { width: 16px; height: 16px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: transform .1s; }
      .wjp-notes-color-dot.active { border-color: rgba(0,0,0,0.20); transform: scale(1.15); }
      @media (max-width: 880px) {
        .wjp-notes-shell { grid-template-columns: 1fr; }
        .wjp-notes-list { max-height: 320px; }
      }
      .wjp-notes-toast { position:fixed; bottom:30px; left:50%; transform:translateX(-50%) translateY(20px); opacity:0; background:#0a0a0a; color:#fff; padding:10px 16px; border-radius:999px; font-size:12.5px; font-family:var(--sans,Inter,system-ui,sans-serif); font-weight:600; box-shadow:0 12px 32px rgba(0,0,0,0.25); z-index:99999; pointer-events:none; transition:opacity .25s, transform .25s; }
      .wjp-notes-toast-show { opacity:1; transform:translateX(-50%) translateY(0); }
    `;
    document.head.appendChild(s);
  }

  function showToast(msg) {
    var existing = document.getElementById("wjp-notes-toast");
    if (existing) existing.remove();
    var t = document.createElement("div");
    t.id = "wjp-notes-toast";
    t.className = "wjp-notes-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("wjp-notes-toast-show"); });
    setTimeout(function () { t.classList.remove("wjp-notes-toast-show"); setTimeout(function(){ try{t.remove();}catch(_){} }, 300); }, 2400);
  }

  function buildHTML() {
    var notes = listNotes({ q: state.query, includeArchived: state.showArchived });
    var selected = state.selectedId ? loadStore().byId[state.selectedId] : null;

    var listHTML = notes.length
      ? notes.map(function (n) {
          var active = n.id === state.selectedId;
          var hasReminder = n.reminderAt && !n.fired;
          var hasPin = !!n.pinnedDate;
          var titleStr = n.title || preview(n.body, 40) || "Untitled note";
          var preStr = n.title ? preview(n.body, 80) : "";
          return `<div class="wjp-notes-row${active ? ' wjp-active' : ''}" data-wjp-note-id="${escapeHTML(n.id)}">
            <div class="ttl">${escapeHTML(titleStr)}</div>
            ${preStr ? `<div class="pre">${escapeHTML(preStr)}</div>` : ""}
            <div class="meta">
              ${hasPin ? `<span class="pin">📌 ${escapeHTML(fmtDateLong(n.pinnedDate))}</span>` : ""}
              ${hasReminder ? `<span class="bell">🔔 ${escapeHTML(new Date(n.reminderAt).toLocaleDateString())}</span>` : ""}
              <span style="margin-left:auto;">${escapeHTML(fmtRelative(n.updatedAt))}</span>
            </div>
          </div>`;
        }).join("")
      : `<div class="wjp-notes-empty">No notes yet.<br><span style="font-size:11px;">Click <b>+ New</b> to start.</span></div>`;

    var editorHTML = selected ? renderEditor(selected) : `
      <div class="wjp-notes-editor-empty">
        <div class="big">📝</div>
        <div style="font-size:14px;font-weight:600;color:#0a0a0a;">Select a note to edit</div>
        <div style="font-size:12px;">Or click <b>+ New</b> to create one.</div>
      </div>
    `;

    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:4px;">Personal</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">Your notes</div>
        </div>
        <div style="font-size:11.5px;color:#6b7280;font-weight:600;">${notes.length} note${notes.length === 1 ? "" : "s"}${state.showArchived ? " (incl. archived)" : ""}</div>
      </div>
      <div class="wjp-notes-shell">
        <aside class="wjp-notes-list">
          <div class="wjp-notes-list-head">
            <div style="display:flex;gap:8px;">
              <input class="wjp-notes-search" data-wjp-notes-search type="text" placeholder="Search notes…" value="${escapeHTML(state.query)}">
              <button type="button" class="wjp-notes-newbtn" data-wjp-notes-new>+ New</button>
            </div>
            <label class="wjp-notes-arch-toggle">
              <input type="checkbox" data-wjp-notes-archtoggle ${state.showArchived ? "checked" : ""}>
              Show archived
            </label>
          </div>
          <div class="wjp-notes-list-body">${listHTML}</div>
        </aside>
        <main class="wjp-notes-editor" id="wjp-notes-editor">${editorHTML}</main>
      </div>
    `;
  }

  function renderEditor(n) {
    var pinned = n.pinnedDate || "";
    var reminderVal = n.reminderAt ? new Date(n.reminderAt).toISOString().slice(0, 16) : "";
    var colors = [
      { k: null, c: "#fff", border: "#e5e7eb" },
      { k: "yellow", c: "#fde68a", border: "#f59e0b" },
      { k: "green", c: "#bbf7d0", border: "#1f7a4a" },
      { k: "blue", c: "#bfdbfe", border: "#0284c7" },
      { k: "rose", c: "#fecaca", border: "#dc2626" },
      { k: "violet", c: "#ddd6fe", border: "#7c3aed" }
    ];
    var colorDots = colors.map(function (c) {
      var active = (n.color || null) === c.k;
      return `<span class="wjp-notes-color-dot${active ? " active" : ""}" data-wjp-notes-color="${c.k || ""}" style="background:${c.c};border-color:${active ? c.border : "transparent"};" title="${c.k || "no color"}"></span>`;
    }).join("");

    return `
      <input class="wjp-notes-title" data-wjp-notes-title type="text" placeholder="Untitled note" value="${escapeHTML(n.title)}" />
      <textarea class="wjp-notes-body" data-wjp-notes-body placeholder="Start writing…">${escapeHTML(n.body)}</textarea>
      <div class="wjp-notes-meta">
        <label>📌 Pin to date
          <input type="date" data-wjp-notes-pindate value="${escapeHTML(pinned)}">
        </label>
        <label>🔔 Remind me at
          <input type="datetime-local" data-wjp-notes-reminder value="${escapeHTML(reminderVal)}">
        </label>
        <label>
          <input type="checkbox" data-wjp-notes-email ${n.reminderEmail ? "checked" : ""} disabled>
          Email me
        </label>
        <span class="wjp-notes-coming-soon">EMAIL · COMING SOON</span>
        <span class="wjp-notes-color-pick">Color: ${colorDots}</span>
      </div>
      <div class="wjp-notes-actions">
        <button type="button" class="wjp-notes-btn-primary" data-wjp-notes-save>Save</button>
        <button type="button" class="wjp-notes-btn-secondary" data-wjp-notes-archive>${n.archived ? "Unarchive" : "Archive"}</button>
        <button type="button" class="wjp-notes-btn-danger" data-wjp-notes-delete>Delete</button>
        <span data-wjp-notes-saved-hint class="wjp-notes-saved-hint" style="margin-left:auto;">${n.updatedAt ? "Last saved " + fmtRelative(n.updatedAt) : ""}</span>
      </div>
      <div style="font-size:11px;color:#9ca3af;line-height:1.45;">
        Notes pinned to a date show as a 📍 dot on that day in the Calendar tab.
        Reminders use browser notifications — click to allow when prompted.
      </div>
    `;
  }

  function refreshListOnly(host) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var listBody = root.querySelector('.wjp-notes-list-body');
    if (!listBody) return;
    var notes = listNotes({ q: state.query, includeArchived: state.showArchived });
    var html;
    if (notes.length) {
      html = notes.map(function (n) {
        var active = n.id === state.selectedId;
        var hasReminder = n.reminderAt && !n.fired;
        var hasPin = !!n.pinnedDate;
        var titleStr = n.title || preview(n.body, 40) || 'Untitled note';
        var preStr = n.title ? preview(n.body, 80) : '';
        var pinBit = hasPin ? '<span class="pin">\ud83d\udccc ' + escapeHTML(fmtDateLong(n.pinnedDate)) + '</span>' : '';
        var bellBit = hasReminder ? '<span class="bell">\ud83d\udd14 ' + escapeHTML(new Date(n.reminderAt).toLocaleDateString()) + '</span>' : '';
        var preBit = preStr ? '<div class="pre">' + escapeHTML(preStr) + '</div>' : '';
        return '<div class="wjp-notes-row' + (active ? ' wjp-active' : '') + '" data-wjp-note-id="' + escapeHTML(n.id) + '">' +
          '<div class="ttl">' + escapeHTML(titleStr) + '</div>' +
          preBit +
          '<div class="meta">' + pinBit + bellBit + '<span style="margin-left:auto;">' + escapeHTML(fmtRelative(n.updatedAt)) + '</span></div>' +
        '</div>';
      }).join('');
    } else {
      html = '<div class="wjp-notes-empty">No notes yet.<br><span style="font-size:11px;">Click <b>+ New</b> to start.</span></div>';
    }
    listBody.innerHTML = html;
    Array.from(listBody.querySelectorAll('[data-wjp-note-id]')).forEach(function (row) {
      row.addEventListener('click', function () {
        state.selectedId = row.dataset.wjpNoteId;
        rerender(host);
      });
    });
  }

  function attach(host) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;

    var search = root.querySelector("[data-wjp-notes-search]");
    if (search) search.addEventListener("input", function () {
      state.query = search.value;
      rerender(host, { keepFocus: "search" });
    });

    var archToggle = root.querySelector("[data-wjp-notes-archtoggle]");
    if (archToggle) archToggle.addEventListener("change", function () {
      state.showArchived = !!archToggle.checked;
      rerender(host);
    });

    var newBtn = root.querySelector("[data-wjp-notes-new]");
    if (newBtn) newBtn.addEventListener("click", function () {
      var n = newNote();
      upsertNote(n);
      state.selectedId = n.id;
      rerender(host, { keepFocus: "title" });
    });

    Array.from(root.querySelectorAll("[data-wjp-note-id]")).forEach(function (row) {
      row.addEventListener("click", function () {
        state.selectedId = row.dataset.wjpNoteId;
        rerender(host);
      });
    });

    // Editor handlers (debounced auto-save)
    var saveBtn = root.querySelector("[data-wjp-notes-save]");
    var titleEl = root.querySelector("[data-wjp-notes-title]");
    var bodyEl = root.querySelector("[data-wjp-notes-body]");
    var pinEl = root.querySelector("[data-wjp-notes-pindate]");
    var reminderEl = root.querySelector("[data-wjp-notes-reminder]");
    var deleteBtn = root.querySelector("[data-wjp-notes-delete]");
    var archiveBtn = root.querySelector("[data-wjp-notes-archive]");

    function gatherCurrent() {
      if (!state.selectedId) return null;
      var s = loadStore();
      var n = s.byId[state.selectedId];
      if (!n) return null;
      n.title = titleEl ? titleEl.value : n.title;
      n.body = bodyEl ? bodyEl.value : n.body;
      n.pinnedDate = pinEl && pinEl.value ? pinEl.value : null;
      n.reminderAt = reminderEl && reminderEl.value ? new Date(reminderEl.value).getTime() : null;
      if (n.reminderAt && n.reminderAt > Date.now()) n.fired = false;
      return n;
    }

    function commit(showHint) {
      var n = gatherCurrent();
      if (!n) return;
      upsertNote(n);
      if (showHint) {
        var hint = root.querySelector("[data-wjp-notes-saved-hint]");
        if (hint) hint.textContent = "Saved · " + fmtRelative(n.updatedAt);
      }
      // Request notification permission if reminder was just set
      if (n.reminderAt && "Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (_) {}
      }
    
      refreshListOnly(host);
    }

    function debouncedCommit() {
      if (state.saveTimer) clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(function () { commit(true); }, 600);
    }
    [titleEl, bodyEl].forEach(function (el) {
      if (el) el.addEventListener("input", debouncedCommit);
    });
    [pinEl, reminderEl].forEach(function (el) {
      if (el) el.addEventListener("change", function () { commit(true); });
    });

    if (saveBtn) saveBtn.addEventListener("click", function () {
      commit(true);
      showToast("Saved");
    });

    if (deleteBtn) deleteBtn.addEventListener("click", function () {
      if (!state.selectedId) return;
      if (!confirm("Delete this note? This can't be undone.")) return;
      deleteNote(state.selectedId);
      state.selectedId = null;
      rerender(host);
      showToast("Deleted");
    });

    if (archiveBtn) archiveBtn.addEventListener("click", function () {
      if (!state.selectedId) return;
      var s = loadStore();
      var n = s.byId[state.selectedId];
      if (!n) return;
      n.archived = !n.archived;
      upsertNote(n);
      showToast(n.archived ? "Archived" : "Restored");
      rerender(host);
    });

    // Color picker
    Array.from(root.querySelectorAll("[data-wjp-notes-color]")).forEach(function (dot) {
      dot.addEventListener("click", function () {
        if (!state.selectedId) return;
        var s = loadStore();
        var n = s.byId[state.selectedId];
        if (!n) return;
        var k = dot.dataset.wjpNotesColor || null;
        n.color = k || null;
        upsertNote(n);
        rerender(host);
      });
    });
  }

  function rerender(host, opts) {
    if (!host) return;
    opts = opts || {};
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      host.appendChild(root);
    }
    // Capture caret position to restore for search input
    var searchVal = state.query;
    var searchSelStart = null, searchSelEnd = null;
    var existingSearch = root.querySelector("[data-wjp-notes-search]");
    if (existingSearch && document.activeElement === existingSearch) {
      searchSelStart = existingSearch.selectionStart;
      searchSelEnd = existingSearch.selectionEnd;
    }
    root.innerHTML = buildHTML();
    attach(host);
    // Restore focus
    if (opts.keepFocus === "search") {
      var s = root.querySelector("[data-wjp-notes-search]");
      if (s) {
        s.focus();
        if (searchSelStart != null) s.setSelectionRange(searchSelStart, searchSelEnd);
      }
    } else if (opts.keepFocus === "title") {
      var t = root.querySelector("[data-wjp-notes-title]");
      if (t) t.focus();
    }
  }

  function hideOriginalContent(page) {
    Array.from(page.children).forEach(function (c) {
      if (c.id === ROOT_ID) return;
      if (c.dataset && c.dataset.wjpNotesHidden === "1") return;
      c.dataset.wjpNotesHidden = "1";
      c.style.display = "none";
    });
  }

  function tick() {
    try {
      ensureStyle();
      relabelSidebar();
      checkReminders();
      migrateFromV1IfNeeded();
      var host = findHost();
      if (!host) return;
      hideOriginalContent(host);
      // Render only if root absent or first time on tab
      if (!document.getElementById(ROOT_ID)) {
        rerender(host);
      } else {
        // No-op; user is interacting, don't blow away their state
      }
    } catch (e) {
      try { console.warn("[wjp-notes-tab] tick threw", e); } catch (_) {}
    }
  }

  function boot() {
    tick();
    setInterval(tick, 4000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_Notes = {
    refresh: tick,
    list: listNotes,
    upsert: upsertNote,
    delete: deleteNote,
    notesByDate: function () {
      var s = loadStore();
      var out = {};
      Object.values(s.byId).forEach(function (n) {
        if (!n.pinnedDate || n.archived) return;
        var prior = out[n.pinnedDate];
        if (!prior || (n.updatedAt > prior._ts)) {
          out[n.pinnedDate] = { text: n.body || n.title || "", reminderAt: n.reminderAt, fired: !!n.fired, _ts: n.updatedAt };
        }
      });
      return out;
    }
  };
})();
