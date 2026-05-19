/* wjp-edu-dashboard-tip.js v2 — Stage 1 of dashboard customization (2026-05-19): bigger banner + always-first position. Original v1.1: — surface the Education tab's pinned tip on
 * the dashboard as a small banner. Reads window.WJP_Education.pinnedTip()
 * (or falls back to localStorage). User can dismiss for the day, or jump
 * to the Education tab to swap pinned tip.
 */
(function () {
  "use strict";
  if (window._wjpEduDashTipInstalled) return;
  window._wjpEduDashTipInstalled = true;
  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}


  // === Per-user storage helper (defers to WJP_UserScope when available) ===
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
  function lsRemove(s) {
    try { if (window.WJP_UserScope && typeof window.WJP_UserScope.remove === 'function')
      window.WJP_UserScope.remove(s);
      else localStorage.removeItem(s); }
    catch (_) { try { localStorage.removeItem(s); } catch (e) {} }
  }

  var BANNER_ID = "wjp-edu-dashboard-tip";
  var LS_DISMISS = "wjp.edu.dashTip.dismissed.v1"; // {tipId: "YYYY-MM-DD"}

  function loadDismiss() {
    try { return JSON.parse(lsGet(LS_DISMISS) || "null") || {}; }
    catch (_) { return {}; }
  }
  function saveDismiss(o) { try { lsSet(LS_DISMISS, JSON.stringify(o)); } catch (_) {} }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function getPinnedTip() {
    if (window.WJP_Education && typeof window.WJP_Education.pinnedTip === "function") {
      try { return window.WJP_Education.pinnedTip(); } catch (_) {}
    }
    return null;
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function findDashboardHost() {
    var page = document.getElementById("page-dashboard");
    if (!page || !page.classList.contains("active")) return null;
    return page;
  }

  function buildBanner(tip) {
    // v2 2026-05-19: bigger, more readable, simpler. Subtle accent stripe on left.
    // No corner emoji — just a small uppercase eyebrow + readable headline + body.
    return `
      <div id="${BANNER_ID}" data-wjp-tip-id="${escapeHTML(tip.id)}" class="wjp-edu-dashtip-card" style="
        position: relative;
        background: var(--card-1, #ffffff);
        border: 1px solid var(--border, rgba(31,122,74,0.18));
        border-left: 4px solid #1f7a4a;
        border-radius: 16px;
        padding: 20px 24px;
        margin: 6px 0 18px;
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: 16px;
        align-items: center;
        box-shadow: 0 2px 6px rgba(0,0,0,0.04);
        font-family: var(--sans, Inter, system-ui, sans-serif);
      ">
        <div style="min-width: 0;">
          <div style="font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #1f7a4a; font-weight: 800; margin-bottom: 8px;">Daily money lesson</div>
          <div style="font-size: 17px; font-weight: 800; color: var(--ink, var(--text-1, #0a0a0a)); letter-spacing: -0.015em; line-height: 1.3; margin-bottom: 6px;">${escapeHTML(tip.title)}</div>
          <div style="font-size: 14px; color: var(--ink-dim, var(--text-2, #4b5563)); line-height: 1.55; max-width: 64ch;">${escapeHTML(tip.body)}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
          <button type="button" data-wjp-tip-action="open" style="background:#1f7a4a;color:#fff;border:0;padding:9px 18px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;letter-spacing:0.01em;">Read more</button>
          <button type="button" data-wjp-tip-action="dismiss" title="Hide for today" style="background:transparent;border:0;color:var(--ink-faint, #9ca3af);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;padding:2px 4px;">Hide for today</button>
        </div>
      </div>
    `;
  }

  function tick() {
    try {
      var host = findDashboardHost();
      if (!host) return;
      var tip = getPinnedTip();
      var existing = document.getElementById(BANNER_ID);
      var dismiss = loadDismiss();
      if (!tip || dismiss[tip.id] === todayKey()) {
        if (existing) try { existing.remove(); } catch (_) {}
        return;
      }
      // Mount or update — v2: ALWAYS insert as the FIRST child of dashboard
      if (existing) {
        if (existing.dataset.wjpTipId === tip.id) {
          // already up to date AND in correct position?
          if (host.firstElementChild !== existing) {
            // Move to top
            try { host.insertBefore(existing, host.firstElementChild); } catch (_) {}
          }
          return;
        }
        existing.outerHTML = buildBanner(tip);
        var moved = document.getElementById(BANNER_ID);
        if (moved && host.firstElementChild !== moved) {
          try { host.insertBefore(moved, host.firstElementChild); } catch (_) {}
        }
      } else {
        // First mount — always afterbegin so it's the first thing the user sees
        host.insertAdjacentHTML("afterbegin", buildBanner(tip));
      }
      // Bind click handlers
      var node = document.getElementById(BANNER_ID);
      if (!node) return;
      var openBtn = node.querySelector("[data-wjp-tip-action=\"open\"]");
      var dismissBtn = node.querySelector("[data-wjp-tip-action=\"dismiss\"]");
      if (openBtn) openBtn.addEventListener("click", function () {
        var nav = document.querySelector('[data-page="activity"]');
        if (nav) nav.click();
      });
      if (dismissBtn) dismissBtn.addEventListener("click", function () {
        var d = loadDismiss();
        d[tip.id] = todayKey();
        saveDismiss(d);
        try { node.remove(); } catch (_) {}
      });
    } catch (e) {
      try { console.warn("[wjp-edu-dashboard-tip] tick threw", e); } catch (_) {}
    }
  }

  function boot() { tick(); setInterval(tick, 5000); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_EduDashTip = { refresh: tick };
})();
