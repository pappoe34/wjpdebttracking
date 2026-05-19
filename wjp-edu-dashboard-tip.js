/* wjp-edu-dashboard-tip.js v4.4 — after-bar position (2026-05-19): narrow childList observer on host. v3: — dashboard customization Stage 1 (2026-05-19):
 * Bigger, more readable banner that matches the app's color tokens in both
 * light and dark mode. Uses CSS vars (--card-2, --accent, --ink, etc.) so it
 * cascades correctly with body.light / body.dark. Maintains first position
 * by inserting BEFORE the wjp-dashboard-hero card if present (which also
 * inserts itself at firstChild every 6s).
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

  var BANNER_ID = "wjp-edu-dashboard-tip";
  var STYLE_ID = "wjp-edu-dashboard-tip-style";
  var LS_DISMISS = "wjp.edu.dashTip.dismissed.v1";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      // Card — works in both light and dark via CSS vars
      "#" + BANNER_ID + ".wjp-edu-dashtip-card {",
      "  position: relative;",
      "  background: var(--card-2, #f7f6f2);",
      "  border: 1px solid var(--border-accent, rgba(31,122,74,0.28));",
      "  border-left: 4px solid var(--accent, #1f7a4a);",
      "  border-radius: 16px;",
      "  padding: 22px 26px;",
      "  margin: 6px 0 20px;",
      "  display: grid;",
      "  grid-template-columns: 1fr auto;",
      "  column-gap: 18px;",
      "  align-items: center;",
      "  box-shadow: var(--shadow, 0 2px 6px rgba(0,0,0,0.04));",
      "  font-family: var(--sans, Inter, system-ui, sans-serif);",
      "}",
      // Light mode subtle green tint over the cream
      "body.light #" + BANNER_ID + ".wjp-edu-dashtip-card {",
      "  background: linear-gradient(135deg, rgba(31,122,74,0.05) 0%, rgba(31,122,74,0.01) 100%), var(--card-2, #f7f6f2);",
      "}",
      // Dark mode — green-tinted gradient over dark card
      "body.dark #" + BANNER_ID + ".wjp-edu-dashtip-card {",
      "  background: linear-gradient(135deg, rgba(0,212,168,0.08) 0%, rgba(0,212,168,0.02) 100%), var(--card-2, #1c2540);",
      "  border-color: var(--border-accent, rgba(0,212,168,0.28));",
      "  border-left-color: var(--accent, #00d4a8);",
      "}",
      // Eyebrow label
      "#" + BANNER_ID + " .wjp-edu-eyebrow {",
      "  font-size: 10.5px;",
      "  letter-spacing: 0.16em;",
      "  text-transform: uppercase;",
      "  color: var(--accent-text, var(--accent, #1f7a4a));",
      "  font-weight: 800;",
      "  margin-bottom: 8px;",
      "}",
      // Headline
      "#" + BANNER_ID + " .wjp-edu-title {",
      "  font-size: 18px;",
      "  font-weight: 800;",
      "  color: var(--ink, var(--text-1, var(--text, #141414)));",
      "  letter-spacing: -0.015em;",
      "  line-height: 1.3;",
      "  margin-bottom: 6px;",
      "}",
      // Body
      "#" + BANNER_ID + " .wjp-edu-body {",
      "  font-size: 14px;",
      "  color: var(--ink-dim, var(--text-2, #4a5568));",
      "  line-height: 1.55;",
      "  max-width: 70ch;",
      "}",
      // Right column
      "#" + BANNER_ID + " .wjp-edu-actions {",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 8px;",
      "  align-items: flex-end;",
      "}",
      "#" + BANNER_ID + " .wjp-edu-cta {",
      "  background: var(--accent, #1f7a4a);",
      "  color: #fff;",
      "  border: 0;",
      "  padding: 10px 20px;",
      "  border-radius: 999px;",
      "  font-size: 12.5px;",
      "  font-weight: 700;",
      "  cursor: pointer;",
      "  font-family: inherit;",
      "  white-space: nowrap;",
      "  letter-spacing: 0.01em;",
      "  transition: filter 0.15s ease;",
      "}",
      "#" + BANNER_ID + " .wjp-edu-cta:hover { filter: brightness(1.08); }",
      "#" + BANNER_ID + " .wjp-edu-dismiss {",
      "  background: transparent;",
      "  border: 0;",
      "  color: var(--ink-faint, var(--text-3, #8a9bb0));",
      "  font-size: 11px;",
      "  font-weight: 600;",
      "  cursor: pointer;",
      "  font-family: inherit;",
      "  padding: 2px 4px;",
      "}",
      "#" + BANNER_ID + " .wjp-edu-dismiss:hover { color: var(--ink-dim, var(--text-2, #4a5568)); }",
      // Mobile responsive — stack
      "@media (max-width: 640px) {",
      "  #" + BANNER_ID + ".wjp-edu-dashtip-card {",
      "    grid-template-columns: 1fr;",
      "    row-gap: 12px;",
      "    padding: 18px 20px;",
      "  }",
      "  #" + BANNER_ID + " .wjp-edu-actions { align-items: flex-start; flex-direction: row; }",
      "  #" + BANNER_ID + " .wjp-edu-title { font-size: 16px; }",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

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
    return (
      '<div id="' + BANNER_ID + '" data-wjp-tip-id="' + escapeHTML(tip.id) + '" data-card-id="wjp-edu-tip" class="wjp-edu-dashtip-card reorderable">' +
        '<div>' +
          '<div class="wjp-edu-eyebrow">Daily money lesson</div>' +
          '<div class="wjp-edu-title">' + escapeHTML(tip.title) + '</div>' +
          '<div class="wjp-edu-body">' + escapeHTML(tip.body) + '</div>' +
        '</div>' +
        '<div class="wjp-edu-actions">' +
          '<button type="button" class="wjp-edu-cta" data-wjp-tip-action="open">Read more</button>' +
          '<button type="button" class="wjp-edu-dismiss" data-wjp-tip-action="dismiss" title="Hide for today">Hide for today</button>' +
        '</div>' +
      '</div>'
    );
  }

  // v4.3 — banner goes to first child UNLESS the customizer has a saved
  // layout (meaning the user has explicitly customized widget order). In that
  // case, the customizer's order wins. This stops the 8s flicker that was
  // caused by EDU and customizer fighting over banner position.
  function userHasCustomizedLayout() {
    try {
      var get = (window.WJP_UserScope && WJP_UserScope.get) ? WJP_UserScope.get : function (k) { return localStorage.getItem(k); };
      var raw = get('wjp.dashboard.layout.v1');
      if (!raw) return false;
      var p = JSON.parse(raw);
      return p && Array.isArray(p.widgets) && p.widgets.length > 0;
    } catch (_) { return false; }
  }
  function placeAtTop(node, host) {
    if (!node || !host) return;
    if (userHasCustomizedLayout()) return; // user's customizer order wins
    try {
      // v4.4: place banner AFTER dash-customize-bar (so the bar is first,
      // banner is second). If no bar, banner is first.
      var bar = document.getElementById('dash-customize-bar');
      if (bar && bar.parentElement === host) {
        if (bar.nextSibling !== node) {
          host.insertBefore(node, bar.nextSibling);
        }
      } else if (host.firstElementChild !== node) {
        host.insertBefore(node, host.firstElementChild);
      }
    } catch (_) {}
  }

  function bindHandlers(node) {
    if (!node) return;
    var openBtn = node.querySelector('[data-wjp-tip-action="open"]');
    var dismissBtn = node.querySelector('[data-wjp-tip-action="dismiss"]');
    if (openBtn) openBtn.addEventListener("click", function () {
      var nav = document.querySelector('[data-page="activity"]');
      if (nav) nav.click();
    });
    if (dismissBtn) dismissBtn.addEventListener("click", function () {
      var d = loadDismiss();
      var id = node.getAttribute('data-wjp-tip-id');
      if (id) { d[id] = todayKey(); saveDismiss(d); }
      try { node.remove(); } catch (_) {}
    });
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
      if (existing) {
        if (existing.dataset.wjpTipId !== tip.id) {
          existing.outerHTML = buildBanner(tip);
          var fresh = document.getElementById(BANNER_ID);
          bindHandlers(fresh);
          placeAtTop(fresh, host);
        } else {
          // Same tip — just reclaim top position if hero/something pushed us down.
          placeAtTop(existing, host);
        }
      } else {
        var tpl = document.createElement('div');
        tpl.innerHTML = buildBanner(tip);
        var node = tpl.firstElementChild;
        host.insertBefore(node, host.firstElementChild);
        placeAtTop(node, host);
        bindHandlers(node);
      }
    } catch (e) {
      try { console.warn("[wjp-edu-dashboard-tip v3] tick threw", e); } catch (_) {}
    }
  }

  // v4.2 2026-05-19: REVERTED the MutationObserver. It was firing every time
  // ANY widget mutated the dashboard child list, which (combined with the
  // customizer's 3s tick and other modules' ticks) caused whole-dashboard
  // flicker. Going back to a single slow polling tick. The banner gets
  // re-claimed at most every 8 seconds, which is acceptable given that no
  // module is actively removing it now.
  function boot() {
    injectStyle();
    tick();
    setInterval(tick, 8000);
    window.addEventListener('wjp-theme-changed', tick);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_EduDashTip = { refresh: tick, version: 4.4 };
})();
