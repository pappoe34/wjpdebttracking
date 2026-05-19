/* wjp-dash-resize-styles.js v1 — 2026-05-19
 *
 * Responsive CSS for the 4 custom dashboard widgets I added so they look
 * correct at Small (1/3), Medium (1/2), Large (2/3), Full widths set by
 * app.js's Customize Layout mode (data-size attribute).
 *
 * Strategy per widget:
 *   - Small/Medium: stack actions vertically, shrink headlines, hide
 *     secondary metadata, smaller padding.
 *   - Large/Full: keep the rich two-column or grid layout.
 *
 * Pure CSS module — no JS logic. Loads via <script> tag for consistency
 * with the other wjp-* modules and to keep one CSS file per concern.
 */
(function () {
  "use strict";
  if (window._wjpDashResizeStylesInstalled) return;
  window._wjpDashResizeStylesInstalled = true;

  var STYLE_ID = "wjp-dash-resize-styles";
  if (document.getElementById(STYLE_ID)) return;

  var s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = [
    // ================= wjp-edu-dashboard-tip =================
    "#wjp-edu-dashboard-tip[data-size='small'], #wjp-edu-dashboard-tip[data-size='medium'] {",
    "  grid-template-columns: 1fr !important;",
    "  row-gap: 10px;",
    "  padding: 16px 18px !important;",
    "}",
    "#wjp-edu-dashboard-tip[data-size='small'] .wjp-edu-title,",
    "#wjp-edu-dashboard-tip[data-size='medium'] .wjp-edu-title { font-size: 15px !important; }",
    "#wjp-edu-dashboard-tip[data-size='small'] .wjp-edu-body,",
    "#wjp-edu-dashboard-tip[data-size='medium'] .wjp-edu-body { font-size: 12.5px !important; line-height: 1.45; }",
    "#wjp-edu-dashboard-tip[data-size='small'] .wjp-edu-actions,",
    "#wjp-edu-dashboard-tip[data-size='medium'] .wjp-edu-actions { flex-direction: row !important; align-items: center !important; gap: 12px; }",
    "#wjp-edu-dashboard-tip[data-size='small'] .wjp-edu-cta { padding: 7px 14px !important; font-size: 11.5px !important; }",
    "#wjp-edu-dashboard-tip[data-size='small'] .wjp-edu-body { display: none !important; }",

    // ================= wjp-dashboard-hero =================
    "#wjp-dashboard-hero[data-size='small'], #wjp-dashboard-hero[data-size='medium'] { padding: 16px 18px !important; }",
    "#wjp-dashboard-hero[data-size='small'] h2,",
    "#wjp-dashboard-hero[data-size='medium'] h2 { font-size: 17px !important; line-height: 1.2; }",
    "#wjp-dashboard-hero[data-size='small'] .meta,",
    "#wjp-dashboard-hero[data-size='medium'] .meta { font-size: 11px !important; }",
    "#wjp-dashboard-hero[data-size='small'] .action-line,",
    "#wjp-dashboard-hero[data-size='medium'] .action-line { font-size: 12px !important; line-height: 1.4; }",
    "#wjp-dashboard-hero[data-size='small'] .progress-label,",
    "#wjp-dashboard-hero[data-size='medium'] .progress-label { font-size: 10.5px !important; }",
    "#wjp-dashboard-hero[data-size='small'] .footer-row,",
    "#wjp-dashboard-hero[data-size='medium'] .footer-row { font-size: 11px !important; flex-direction: column; align-items: flex-start; gap: 6px; }",
    "#wjp-dashboard-hero[data-size='small'] .action-line { display: none !important; }",

    // ================= wjp-paycheck-ai-card =================
    "#wjp-paycheck-ai-card[data-size='small'], #wjp-paycheck-ai-card[data-size='medium'] { padding: 16px 18px !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] h3,",
    "#wjp-paycheck-ai-card[data-size='medium'] h3 { font-size: 15px !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] .sub,",
    "#wjp-paycheck-ai-card[data-size='medium'] .sub { font-size: 11.5px !important; line-height: 1.4; }",
    "#wjp-paycheck-ai-card[data-size='small'] .rec-row,",
    "#wjp-paycheck-ai-card[data-size='medium'] .rec-row { padding: 10px 12px !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] .rec-name { font-size: 12px !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] .rec-shift,",
    "#wjp-paycheck-ai-card[data-size='medium'] .rec-shift { font-size: 11px !important; line-height: 1.4; }",
    "#wjp-paycheck-ai-card[data-size='small'] .protected-note,",
    "#wjp-paycheck-ai-card[data-size='medium'] .protected-note { font-size: 10.5px !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] .rec-row:nth-child(n+4) { display: none !important; }",
    "#wjp-paycheck-ai-card[data-size='small'] .sub { display: none !important; }",

    // ================= wjp-dash-debit-balances =================
    "#wjp-dash-debit-balances[data-size='small'], #wjp-dash-debit-balances[data-size='medium'] { padding: 16px 18px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-head,",
    "#wjp-dash-debit-balances[data-size='medium'] .wjp-dbal-head { flex-direction: column; align-items: flex-start; gap: 8px; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-total,",
    "#wjp-dash-debit-balances[data-size='medium'] .wjp-dbal-total { text-align: left; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-title,",
    "#wjp-dash-debit-balances[data-size='medium'] .wjp-dbal-title { font-size: 14px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-total-val,",
    "#wjp-dash-debit-balances[data-size='medium'] .wjp-dbal-total-val { font-size: 18px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-row-name { font-size: 12.5px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-row-meta { font-size: 10.5px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-row-bal { font-size: 13px !important; }",
    "#wjp-dash-debit-balances[data-size='small'] .wjp-dbal-row:nth-child(n+4) { display: none !important; }",

    // ================= shared niceties =================
    // At Small/Medium, reduce side margins so the cards breathe
    "#page-dashboard .reorderable[data-size='small'],",
    "#page-dashboard .reorderable[data-size='medium'] { font-size: 13px; }",
    // Tighten footer row in all my widgets to keep things compact
    "@media (max-width: 768px) {",
    "  #wjp-edu-dashboard-tip[data-size='small'],",
    "  #wjp-edu-dashboard-tip[data-size='medium'],",
    "  #wjp-paycheck-ai-card[data-size='small'],",
    "  #wjp-paycheck-ai-card[data-size='medium'] { width: 100% !important; }",
    "}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(s);

  window.WJP_DashResizeStyles = { version: 1 };
})();
