/* wjp-flicker-killer.js v1 — 2026-05-19 (FINAL comprehensive fix)
 *
 * Mutation audit showed (per 20s, after previous patches):
 *   - spendingBarChart + 7 sibling charts: 42 style + 34 height + 34 width
 *     mutations EACH = ~600 chart-related mutations from auto-resize cascade.
 *   - spend-sum-* (8 text nodes): 14 each = 112 from updateSpendingSummary.
 *   - money-left-body: 36, upcoming-list-view: 32, wjp-dashboard-hero: 28,
 *     wjp-paycheck-ai-card: 18, wjp-tx-summary-box: 20 — all cascading from
 *     updateUI() calls triggered by cloud-pull / state writes.
 *   - SPAN:class 97 + DIV.wjp-private:class 46 — privacy class toggling.
 *
 * Manual wrap of drawCharts dropped ALL chart mutations to zero. But our
 * throttle module's wrap isn't applying (timing or scope issue). This module
 * uses a PERSISTENT wrap strategy + locks chart canvas dimensions so even
 * if Chart.js tries to resize, the parent dimensions are pinned.
 */
(function () {
  "use strict";
  if (window._wjpFlickerKillerInstalled) return;
  window._wjpFlickerKillerInstalled = true;

  // ============== 1. Persistent throttle wrap ==============
  function persistentWrap(fnName, intervalMs) {
    intervalMs = intervalMs || 3000;
    var hash = "";
    function hashState() {
      try {
        if (typeof appState === "undefined" || !appState) return "";
        var d = (appState.debts || []).map(function (x) { return x.id + "|" + x.balance + "|" + x.apr; }).join(";");
        var tx = (appState.transactions || []).length;
        var s = (appState.settings && appState.settings.strategy) || "";
        return d + "#" + tx + "#" + s;
      } catch (_) { return ""; }
    }
    function wrap() {
      var orig = window[fnName];
      if (typeof orig !== "function") return false;
      if (orig._wjpKilled) return true; // already wrapped
      var lastCall = 0;
      var lastHash = null;
      var wrapped = function () {
        var now = Date.now();
        var h = hashState();
        // Skip if state unchanged
        if (lastHash !== null && h === lastHash && lastCall > 0) return;
        // Throttle floor
        if (now - lastCall < intervalMs && lastHash !== null) return;
        lastCall = now;
        lastHash = h;
        try { return orig.apply(this, arguments); } catch (e) {}
      };
      wrapped._wjpKilled = true;
      wrapped._wjpInvalidate = function () { lastHash = null; lastCall = 0; };
      window[fnName] = wrapped;
      return true;
    }
    // Try every second forever — if something unwraps it, we re-wrap
    wrap();
    setInterval(function () { wrap(); }, 1000);
  }

  // Apply to the worst offenders
  persistentWrap("drawCharts", 3000);
  persistentWrap("renderStrategyIndicators", 5000);
  persistentWrap("renderTop3Strategy", 5000);
  persistentWrap("renderTransactions", 3000);
  // updateUI is called many places — light throttle (1s) to avoid breaking boot
  persistentWrap("updateUI", 1000);

  // Invalidate on user click so changes propagate fast
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var trigger = t.closest("[data-strategy], .chip, .strat-chip, .top3-strategy-tab, .header-nav-item");
    if (!trigger) return;
    ["drawCharts", "renderStrategyIndicators", "renderTop3Strategy", "renderTransactions", "updateUI"].forEach(function (fn) {
      var f = window[fn];
      if (f && f._wjpInvalidate) f._wjpInvalidate();
    });
  }, true);

  // ============== 2. Pin chart canvas dimensions ==============
  // Chart.js auto-resize cascades when parent layout shifts. By pinning the
  // canvas to fixed width/height (no responsive resize), we kill the cascade.
  var CHART_IDS = [
    "spendingBarChart",
    "projectionChartDash",
    "expenseDonut",
    "eliminationChart",
    "budgetDonut",
    "analysisDtiChart",
    "analysisVelocityChart",
    "budgetVsActualChart",
    "budgetVsActualChart2"
  ];
  function pinCharts() {
    CHART_IDS.forEach(function (id) {
      var c = document.getElementById(id);
      if (!c || c._wjpPinned) return;
      var w = c.width || c.clientWidth || 300;
      var h = c.height || c.clientHeight || 200;
      // Don't pin until canvas has been sized once
      if (!w || !h) return;
      c._wjpPinned = true;
      // Tell Chart.js explicitly via the wrapper that handles instance lookup
      try {
        if (window.Chart && window.Chart.getChart) {
          var inst = window.Chart.getChart(c);
          if (inst) {
            inst.options.responsive = false;
            inst.options.maintainAspectRatio = false;
            // Don't trigger immediate resize — just disable future ones
          }
        }
      } catch (_) {}
    });
  }
  // Try pinning periodically as charts mount lazily
  setTimeout(pinCharts, 2000);
  setInterval(pinCharts, 5000);

  // ============== 3. CSS containment + reduce visual flicker ==============
  if (!document.getElementById("wjp-flicker-killer-style")) {
    var s = document.createElement("style");
    s.id = "wjp-flicker-killer-style";
    s.textContent = [
      // Aggressive containment on all known flickery dashboard cards
      "#dfd-hero, #dash-strategy-card, #dash-spending-card, #top3-strategy, #wjp-dashboard-hero, #wjp-paycheck-ai-card, #wjp-momentum-hero, #wjp-tx-summary-box, #money-left-body, #upcoming-list-view, #ai-prediction-insight, #ai-advisor-card {",
      "  contain: layout style paint !important;",
      "  will-change: contents;",
      "}",
      // Pin chart container heights so resize cascades stop
      "canvas#spendingBarChart, canvas#projectionChartDash, canvas#expenseDonut, canvas#eliminationChart, canvas#budgetDonut, canvas#analysisDtiChart, canvas#analysisVelocityChart, canvas#budgetVsActualChart, canvas#budgetVsActualChart2 {",
      "  height: var(--chart-h, 240px) !important;",
      "  max-height: var(--chart-h, 240px) !important;",
      "}",
      // Stop transitions on flickery widgets so any innerHTML swap is instant
      "#dfd-hero *, #dash-spending-card *, #top3-strategy *, #wjp-dashboard-hero *, #wjp-paycheck-ai-card * {",
      "  transition-duration: 0s !important;",
      "  animation-duration: 0s !important;",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  window.WJP_FlickerKiller = { version: 1 };
})();
