/* wjp-settings-extras.js v1.1 — adds Plans link in Settings → Billing and a new
 * Activity Log sub-tab with retention picker.
 *
 * Why: the sidebar Plans nav item is now Notes, and Activity Log is now
 * Financial Education. Both originals need a home — Plans goes to Billing
 * as a "View pricing plans" link, Activity Log gets its own settings
 * sub-tab where users can browse history and choose retention period.
 *
 * Activity data: read from localStorage.wjp_budget_state.notifications
 * (the app already maintains this; 260 entries in the sample state).
 *
 * Hardened pattern: IIFE, idempotent, polled.
 */
(function () {
  "use strict";
  if (window._wjpSettingsExtrasInstalled) return;
  window._wjpSettingsExtrasInstalled = true;

  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  var ACTIVITY_PANEL_ID = "wjp-settings-activity-panel";
  var ACTIVITY_BTN_ID = "wjp-settings-activity-btn";
  var PLANS_LINK_ID = "wjp-settings-plans-link";
  var LS_RETENTION = "wjp.activity.retention.v1"; // days, or "forever"

  var RETENTION_OPTIONS = [
    { v: "30", label: "30 days" },
    { v: "60", label: "60 days" },
    { v: "90", label: "90 days" },
    { v: "180", label: "180 days" },
    { v: "365", label: "1 year" },
    { v: "forever", label: "Forever" }
  ];

  function getRetention() {
    return localStorage.getItem(LS_RETENTION) || "90";
  }
  function setRetention(v) {
    try { localStorage.setItem(LS_RETENTION, v); } catch (_) {}
  }

  function loadActivity() {
    try {
      var st = JSON.parse(localStorage.getItem("wjp_budget_state") || "null");
      if (!st || !Array.isArray(st.notifications)) return [];
      var ret = getRetention();
      var cutoff = ret === "forever" ? 0 : Date.now() - parseInt(ret, 10) * 24 * 3600 * 1000;
      return st.notifications.filter(function (n) { return (n.timestamp || 0) >= cutoff; })
                .sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    } catch (_) { return []; }
  }

  function pruneActivityIfNeeded() {
    try {
      var ret = getRetention();
      if (ret === "forever") return;
      var st = JSON.parse(localStorage.getItem("wjp_budget_state") || "null");
      if (!st || !Array.isArray(st.notifications)) return;
      var cutoff = Date.now() - parseInt(ret, 10) * 24 * 3600 * 1000;
      var before = st.notifications.length;
      st.notifications = st.notifications.filter(function (n) { return (n.timestamp || 0) >= cutoff; });
      if (st.notifications.length !== before) {
        localStorage.setItem("wjp_budget_state", JSON.stringify(st));
      }
    } catch (_) {}
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
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
    return d + "d ago";
  }

  function ensureStyle() {
    if (document.getElementById("wjp-settings-extras-styles")) return;
    var s = document.createElement("style");
    s.id = "wjp-settings-extras-styles";
    s.textContent = `
      #${ACTIVITY_PANEL_ID} { display: none; }
      body.wjp-settings-activity-active #${ACTIVITY_PANEL_ID} { display: block; }
      body.wjp-settings-activity-active #page-settings .settings-content-pane:not(.wjp-act-pane) { display: none !important; }
      .wjp-act-row { display: flex; gap: 12px; padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); align-items: flex-start; }
      .wjp-act-row .icon { width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
      .wjp-act-priority-high .icon { background: rgba(220,38,38,0.10); color: #dc2626; }
      .wjp-act-priority-normal .icon { background: rgba(31,122,74,0.10); color: #1f7a4a; }
      .wjp-act-row .body { flex: 1; min-width: 0; }
      .wjp-act-row .body .ttl { font-size: 13px; font-weight: 700; color: #0a0a0a; }
      .wjp-act-row .body .txt { font-size: 12px; color: #6b7280; margin-top: 2px; line-height: 1.4; }
      .wjp-act-row .meta { font-size: 10.5px; color: #9ca3af; font-weight: 600; flex-shrink: 0; white-space: nowrap; }
      .wjp-plans-link-card {
        margin: 14px 0;
        padding: 16px 20px;
        border: 1px solid rgba(31,122,74,0.30);
        background: linear-gradient(135deg, rgba(31,122,74,0.06), rgba(201,154,42,0.04));
        border-radius: 12px;
        display: flex;
        gap: 14px;
        align-items: center;
        font-family: var(--sans, Inter, system-ui, sans-serif);
      }
      .wjp-plans-link-card .ttl { font-size: 13px; font-weight: 700; color: #0a0a0a; letter-spacing: -0.005em; }
      .wjp-plans-link-card .sub { font-size: 11.5px; color: #6b7280; margin-top: 2px; }
      .wjp-plans-link-card a {
        background: #1f7a4a;
        color: #fff;
        padding: 8px 14px;
        border-radius: 999px;
        text-decoration: none;
        font-size: 12px;
        font-weight: 700;
        font-family: inherit;
        white-space: nowrap;
      }
      .wjp-plans-link-card a:hover { filter: brightness(1.05); }
    `;
    document.head.appendChild(s);
  }

  // === Inject Activity Log sub-nav button + panel ===
  function injectActivityNav() {
    var subnav = document.querySelector("#page-settings .settings-subnav, aside.settings-subnav");
    if (!subnav) return false;
    if (document.getElementById(ACTIVITY_BTN_ID)) return true;
    // Find the Account button (last one) so we insert before
    var btn = document.createElement("button");
    btn.id = ACTIVITY_BTN_ID;
    btn.type = "button";
    btn.className = "settings-subnav-item";
    btn.innerHTML = '<i class="ph ph-list-bullets"></i> <span>Activity Log</span>';
    btn.style.fontFamily = "inherit";
    btn.addEventListener("click", function () {
      // Mark our panel active; un-active all others by removing 'active' class
      Array.from(subnav.querySelectorAll(".settings-subnav-item.active")).forEach(function (a) {
        a.classList.remove("active");
      });
      btn.classList.add("active");
      document.body.classList.add("wjp-settings-activity-active");
      mountOrRefreshActivityPanel();
    });
    // Insert before the last child (Account)
    var lastBtn = subnav.querySelector(".settings-subnav-item:last-child");
    if (lastBtn) subnav.insertBefore(btn, lastBtn);
    else subnav.appendChild(btn);

    // Listen to clicks on OTHER sub-nav items so we de-activate ourselves
    Array.from(subnav.querySelectorAll(".settings-subnav-item")).forEach(function (other) {
      if (other === btn) return;
      if (other.dataset.wjpActListener === "1") return;
      other.dataset.wjpActListener = "1";
      other.addEventListener("click", function () {
        document.body.classList.remove("wjp-settings-activity-active");
        btn.classList.remove("active");
      });
    });
    return true;
  }

  function mountOrRefreshActivityPanel() {
    var page = document.getElementById("page-settings");
    if (!page) return;
    var panel = document.getElementById(ACTIVITY_PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = ACTIVITY_PANEL_ID;
      panel.className = "settings-content-pane wjp-act-pane";
      // Mount as sibling of the real .settings-content-pane inside .settings-layout
      var pane = page.querySelector(".settings-content-pane");
      if (pane && pane.parentElement) pane.parentElement.appendChild(panel);
      else {
        var layout = page.querySelector(".settings-layout");
        if (layout) layout.appendChild(panel);
        else page.appendChild(panel);
      }
    }
    panel.innerHTML = renderActivityPanel();
    bindActivityHandlers(panel);
  }

  function renderActivityPanel() {
    var ret = getRetention();
    var items = loadActivity();
    var rows = items.length
      ? items.slice(0, 200).map(function (n) {
          var prio = n.priority === "high" ? "high" : "normal";
          return `<div class="wjp-act-row wjp-act-priority-${prio}">
            <span class="icon">${prio === "high" ? "⚠️" : "🔔"}</span>
            <div class="body">
              <div class="ttl">${escapeHTML(n.title || "(untitled)")}</div>
              <div class="txt">${escapeHTML(n.text || "")}</div>
            </div>
            <span class="meta">${escapeHTML(fmtRelative(n.timestamp))}</span>
          </div>`;
        }).join("")
      : `<div style="padding:32px;text-align:center;color:#9ca3af;font-size:13px;">No activity yet.</div>`;

    var retOpts = RETENTION_OPTIONS.map(function (o) {
      return `<option value="${escapeHTML(o.v)}" ${o.v === ret ? "selected" : ""}>${escapeHTML(o.label)}</option>`;
    }).join("");

    return `
      <div style="font-family:var(--sans,Inter,system-ui,sans-serif);">
        <h2 style="font-size:22px;font-weight:700;letter-spacing:-0.015em;margin-bottom:6px;">Activity Log</h2>
        <p style="color:#6b7280;font-size:13.5px;margin-bottom:14px;">Notifications and noteworthy events from your account.</p>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
          <label style="font-size:11.5px;font-weight:600;color:#6b7280;">
            Keep activity for:
            <select data-wjp-act-retention style="margin-left:6px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;padding:5px 10px;font-family:inherit;font-size:12px;color:#0a0a0a;">
              ${retOpts}
            </select>
          </label>
          <span style="font-size:11px;color:#9ca3af;">${items.length} entr${items.length === 1 ? "y" : "ies"} shown</span>
        </div>
        <div style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;overflow:hidden;max-height:60vh;overflow-y:auto;">
          ${rows}
        </div>
      </div>
    `;
  }

  function bindActivityHandlers(panel) {
    var sel = panel.querySelector("[data-wjp-act-retention]");
    if (sel) sel.addEventListener("change", function () {
      setRetention(sel.value);
      pruneActivityIfNeeded();
      mountOrRefreshActivityPanel();
    });
  }

  // === Inject Plans link inside Billing panel ===
  function injectPlansLink() {
    if (document.getElementById(PLANS_LINK_ID)) return;
    // Find the Billing panel — look for a heading or panel that contains "Billing"
    var page = document.getElementById("page-settings");
    if (!page) return;
    var billingBtn = Array.from(page.querySelectorAll(".settings-subnav-item")).find(function (b) {
      return /^billing$/i.test((b.textContent || "").trim());
    });
    if (!billingBtn || !billingBtn.classList.contains("active")) return;
    // Find a heading like "Billing" in the panels and inject after
    var headings = Array.from(page.querySelectorAll("h2"));
    var billingH = headings.find(function (h) { return /^billing/i.test((h.textContent || "").trim()); });
    if (!billingH) return;
    var card = document.createElement("div");
    card.id = PLANS_LINK_ID;
    card.className = "wjp-plans-link-card";
    card.innerHTML = `
      <span style="font-size:24px;">💳</span>
      <div style="flex:1;min-width:0;">
        <div class="ttl">Pricing & plans</div>
        <div class="sub">View tiers, compare features, or change your subscription.</div>
      </div>
      <a href="/pricing.html" target="_blank" rel="noopener">View plans</a>
    `;
    if (billingH.nextSibling) billingH.parentNode.insertBefore(card, billingH.nextSibling.nextSibling || billingH.nextSibling);
    else billingH.parentNode.appendChild(card);
  }

  // === Tick ===
  function tick() {
    try {
      ensureStyle();
      var settings = document.getElementById("page-settings");
      if (!settings || !settings.classList.contains("active")) return;
      pruneActivityIfNeeded();
      injectActivityNav();
      injectPlansLink();
    } catch (e) {
      try { console.warn("[wjp-settings-extras] tick threw", e); } catch (_) {}
    }
  }

  function boot() {
    tick();
    setInterval(tick, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_SettingsExtras = {
    refresh: tick,
    getRetention: getRetention,
    setRetention: setRetention,
    pruneNow: pruneActivityIfNeeded
  };
})();
