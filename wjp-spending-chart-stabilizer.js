/* wjp-spending-chart-stabilizer.js v1 — 2026-05-19
 *
 * Focused fix for the Spending Tracker flicker. Two causes:
 *   1. Chart.js auto-resize on spendingBarChart cascades every time the
 *      parent dashboard layout shifts. We disable responsive on the chart
 *      instance so it ignores resize events.
 *   2. The spend-sum-* text nodes get re-written on every drawCharts call.
 *      We patch their textContent setter to skip no-op writes.
 *
 * Scoped to ONLY these 9 elements — won't touch anything else.
 */
(function () {
  "use strict";
  if (window._wjpSpendingChartStabilized) return;
  window._wjpSpendingChartStabilized = true;

  var CHART_ID = "spendingBarChart";
  var SPEND_SUM_IDS = [
    "spend-sum-total",
    "spend-sum-income",
    "spend-sum-income-sub",
    "spend-sum-net",
    "spend-sum-net-sub",
    "spend-sum-count",
    "spend-sum-topcat",
    "spend-sum-window"
  ];

  // ============== 1. Disable Chart.js auto-resize on spendingBarChart ==============
  function stabilizeChart() {
    var c = document.getElementById(CHART_ID);
    if (!c || c._wjpStabilized) return;
    try {
      if (!window.Chart || !window.Chart.getChart) return;
      var inst = window.Chart.getChart(c);
      if (!inst) return;
      inst.options.responsive = false;
      inst.options.maintainAspectRatio = false;
      // Lock canvas dimensions to whatever the chart currently has
      if (c.width && c.height) {
        c.style.width = c.width + 'px';
        c.style.height = c.height + 'px';
      }
      c._wjpStabilized = true;
    } catch (_) {}
  }
  // Try every 2s until found (chart mounts lazily)
  var stabilizeIv = setInterval(function () {
    stabilizeChart();
    var c = document.getElementById(CHART_ID);
    if (c && c._wjpStabilized) clearInterval(stabilizeIv);
  }, 2000);
  setTimeout(stabilizeChart, 1500);

  // ============== 2. Skip no-op textContent writes on spend-sum-* nodes ==============
  // app.js's updateSpendingSummary unconditionally sets textContent on 8 nodes
  // every drawCharts call. If values haven't changed, the writes are wasted
  // but still trigger childList mutations. Patch the setter to skip no-ops.
  var nativeTextDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  if (nativeTextDesc && nativeTextDesc.get && nativeTextDesc.set) {
    function patchTextContent(el) {
      if (!el || el._wjpTextPatched) return;
      el._wjpTextPatched = true;
      try {
        Object.defineProperty(el, 'textContent', {
          configurable: true,
          get: function () { return nativeTextDesc.get.call(this); },
          set: function (v) {
            var current = nativeTextDesc.get.call(this);
            if (current === v) return; // no-op write — skip
            nativeTextDesc.set.call(this, v);
          }
        });
      } catch (_) {}
    }
    function patchAll() {
      SPEND_SUM_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) patchTextContent(el);
      });
    }
    // Try repeatedly until all 8 mounted
    var patchIv = setInterval(patchAll, 2000);
    setTimeout(function () { clearInterval(patchIv); }, 30000);
    patchAll();
  }

  window.WJP_SpendingChartStabilizer = { version: 1 };
})();
