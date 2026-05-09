/* wjp-edu-dashboard-tip.js v1.1 — surface the Education tab's pinned tip on
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
    return `
      <div id="${BANNER_ID}" data-wjp-tip-id="${escapeHTML(tip.id)}" style="
        background: linear-gradient(135deg, rgba(31,122,74,0.06), rgba(201,154,42,0.04));
        border: 1px solid rgba(31,122,74,0.22);
        border-radius: 12px;
        padding: 12px 16px;
        margin: 14px 0;
        display: flex;
        align-items: center;
        gap: 14px;
        font-family: var(--sans, Inter, system-ui, sans-serif);
      ">
        <span style="font-size: 22px; line-height: 1;">📚</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: #1f7a4a; font-weight: 800; margin-bottom: 2px;">Financial education tip</div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--ink, #0a0a0a); letter-spacing: -0.01em; line-height: 1.3;">${escapeHTML(tip.title)}</div>
          <div style="font-size: 12px; color:var(--ink-dim, #4b5563); margin-top: 2px; line-height: 1.45;">${escapeHTML(tip.body)}</div>
        </div>
        <button type="button" data-wjp-tip-action="open" style="background:#1f7a4a;color:#fff;border:0;padding:7px 12px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">Read more</button>
        <button type="button" data-wjp-tip-action="dismiss" title="Hide for today" style="background:transparent;border:0;color:var(--ink-faint, #9ca3af);font-size:18px;cursor:pointer;line-height:1;padding:4px 8px;">×</button>
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
      // Mount or update
      if (existing) {
        if (existing.dataset.wjpTipId === tip.id) return; // already up to date
        existing.outerHTML = buildBanner(tip);
      } else {
        // Insert near the top of the dashboard, before the first child that's a card-ish container
        var inserted = false;
        var firstReveal = host.querySelector(".reveal, [class*=\"summary\"], [class*=\"hero\"]");
        if (firstReveal && firstReveal.parentElement === host) {
          var div = document.createElement("div");
          div.innerHTML = buildBanner(tip);
          host.insertBefore(div.firstElementChild, firstReveal);
          inserted = true;
        }
        if (!inserted) {
          host.insertAdjacentHTML("afterbegin", buildBanner(tip));
        }
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
