/* wjp-dash-debit-balances.js v1 — 2026-05-19
 *
 * Compact dashboard widget showing the top liquid bank balances + TOTAL
 * LIQUID across all checking/savings/cash accounts. Reuses the data cache
 * from wjp-debts-overview-enhance.js via WJP_DebtsEnhance.getDebitAccounts()
 * so we don't make extra Plaid calls.
 *
 * Auto-discoverable by wjp-dashboard-customizer.js (has stable id).
 *
 * Safe patterns:
 *   - IIFE + idempotent
 *   - No body-subtree MutationObserver
 *   - Slow 6s tick — refreshes balance label, no DOM thrash
 *   - Falls back to a "Connect a bank" empty state when no accounts
 */
(function () {
  "use strict";
  if (window._wjpDashDebitInstalled) return;
  window._wjpDashDebitInstalled = true;
  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  var CARD_ID = "wjp-dash-debit-balances";
  var STYLE_ID = "wjp-dash-debit-balances-style";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "#" + CARD_ID + " {",
      "  background: var(--card-2, #f7f6f2);",
      "  color: var(--ink, var(--text-1, #141414));",
      "  border: 1px solid var(--border, rgba(20,20,20,0.08));",
      "  border-radius: 16px;",
      "  padding: 20px 24px;",
      "  margin: 6px 0 18px;",
      "  font-family: var(--sans, Inter, system-ui, sans-serif);",
      "  box-shadow: var(--shadow, 0 2px 6px rgba(0,0,0,0.04));",
      "}",
      "body.dark #" + CARD_ID + " { background: var(--card-2, #1c2540); border-color: var(--border, rgba(255,255,255,0.06)); }",
      "#" + CARD_ID + " .wjp-dbal-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; gap:12px; flex-wrap: wrap; }",
      "#" + CARD_ID + " .wjp-dbal-eyebrow { font-size:10.5px; letter-spacing:0.16em; text-transform:uppercase; color: var(--accent-text, var(--accent, #1f7a4a)); font-weight:800; }",
      "#" + CARD_ID + " .wjp-dbal-title { font-size:17px; font-weight:800; letter-spacing:-0.01em; margin-top:4px; }",
      "#" + CARD_ID + " .wjp-dbal-total { text-align:right; }",
      "#" + CARD_ID + " .wjp-dbal-total-label { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color: var(--ink-faint, var(--text-3, #8a9bb0)); font-weight:700; }",
      "#" + CARD_ID + " .wjp-dbal-total-val { font-size:22px; font-weight:800; color: var(--ink, #141414); letter-spacing:-0.02em; }",
      "#" + CARD_ID + " .wjp-dbal-list { display:flex; flex-direction:column; gap:8px; }",
      "#" + CARD_ID + " .wjp-dbal-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 12px; background: var(--card, rgba(255,255,255,0.5)); border-radius:10px; }",
      "body.dark #" + CARD_ID + " .wjp-dbal-row { background: var(--card, rgba(255,255,255,0.04)); }",
      "#" + CARD_ID + " .wjp-dbal-row-left { min-width:0; flex:1; }",
      "#" + CARD_ID + " .wjp-dbal-row-name { font-size:13.5px; font-weight:700; color: var(--ink, #141414); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      "#" + CARD_ID + " .wjp-dbal-row-meta { font-size:11px; color: var(--ink-dim, var(--text-2, #4a5568)); margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      "#" + CARD_ID + " .wjp-dbal-row-bal { font-size:14px; font-weight:800; color: var(--ink, #141414); }",
      "#" + CARD_ID + " .wjp-dbal-empty { font-size:13px; color: var(--ink-dim, var(--text-2, #4a5568)); padding:14px 0; text-align:center; }",
      "#" + CARD_ID + " .wjp-dbal-foot { margin-top:10px; font-size:11px; color: var(--ink-faint, #8a9bb0); text-align:right; }"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return "—";
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function findDashboardHost() {
    var p = document.getElementById("page-dashboard");
    if (!p || !p.classList.contains("active")) return null;
    return p;
  }

  function buildCard(accounts) {
    var top = (accounts || []).slice(0, 5);
    var total = (accounts || []).reduce(function (s, a) { return s + (a.balance || 0); }, 0);
    var rowsHtml = '';
    if (!accounts || accounts.length === 0) {
      rowsHtml = '<div class="wjp-dbal-empty">No bank accounts connected yet. Visit <strong>Debts → Overview</strong> to link one.</div>';
    } else {
      rowsHtml = '<div class="wjp-dbal-list">' +
        top.map(function (a) {
          var name = a.displayName || a.plaidName || 'Account';
          var meta = escapeHTML(a.institutionName || 'Bank') +
            (a.mask ? ' · ····' + escapeHTML(a.mask) : '') +
            (a.subtype ? ' · ' + escapeHTML(a.subtype) : '');
          return '<div class="wjp-dbal-row">' +
            '<div class="wjp-dbal-row-left">' +
              '<div class="wjp-dbal-row-name">' + escapeHTML(name) + '</div>' +
              '<div class="wjp-dbal-row-meta">' + meta + '</div>' +
            '</div>' +
            '<div class="wjp-dbal-row-bal">' + fmtUsd(a.balance) + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }
    var extra = accounts && accounts.length > 5
      ? '<div class="wjp-dbal-foot">+' + (accounts.length - 5) + ' more account' + (accounts.length - 5 === 1 ? '' : 's') + ' on the Debts tab.</div>'
      : '';
    return (
      '<div class="wjp-dbal-head">' +
        '<div>' +
          '<div class="wjp-dbal-eyebrow">Bank balances</div>' +
          '<div class="wjp-dbal-title">Cash on hand across your accounts</div>' +
        '</div>' +
        '<div class="wjp-dbal-total">' +
          '<div class="wjp-dbal-total-label">Total liquid</div>' +
          '<div class="wjp-dbal-total-val">' + fmtUsd(total) + '</div>' +
        '</div>' +
      '</div>' +
      rowsHtml +
      extra
    );
  }

  function ensureCard(host) {
    var card = document.getElementById(CARD_ID);
    if (!card) {
      card = document.createElement('div');
      card.id = CARD_ID;
      // Mount after wjp-dashboard-hero if present, else at end of dashboard
      var hero = document.getElementById('wjp-dashboard-hero');
      if (hero && hero.parentElement === host && hero.nextSibling) {
        host.insertBefore(card, hero.nextSibling);
      } else {
        host.appendChild(card);
      }
    }
    return card;
  }

  function setContent(card, html) {
    if (card.innerHTML !== html) card.innerHTML = html;
  }

  async function refresh() {
    var host = findDashboardHost();
    if (!host) return;
    var card = ensureCard(host);
    var accounts = [];
    try {
      if (window.WJP_DebtsEnhance && typeof window.WJP_DebtsEnhance.getDebitAccounts === 'function') {
        accounts = (await window.WJP_DebtsEnhance.getDebitAccounts(false)) || [];
      }
    } catch (_) {}
    setContent(card, buildCard(accounts));
  }

  function boot() {
    injectStyle();
    // Pre-warm the shared cache if the debts module is loaded
    try {
      if (window.WJP_DebtsEnhance && typeof window.WJP_DebtsEnhance.prefetchDebitAccounts === 'function') {
        window.WJP_DebtsEnhance.prefetchDebitAccounts();
      }
    } catch (_) {}
    setTimeout(refresh, 800);
    setInterval(refresh, 12000);
    window.addEventListener('hashchange', function () { setTimeout(refresh, 300); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_DashDebitBalances = { refresh: refresh, version: 1 };
})();
