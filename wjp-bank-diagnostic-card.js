/* wjp-bank-diagnostic-card.js v1 — Admin-only diagnostic card on Bank Health.
 *
 * Surfaces the /admin-tx-diagnostic endpoint as a button in the Bank Health
 * tab. Renders:
 *   - per-item status (cursor, lastSync, errors, webhook flags)
 *   - transaction count + recency
 *   - issues list with concrete actions
 *   - "Force resync all" button → /sync-transactions with {forceFullResync:true}
 *
 * Admin gate: only shows for tier === 'admin' OR email === pappoe34@gmail.com.
 *
 * Safe: IIFE, path-guarded, doesn't touch Sync Bank flow.
 */
(function () {
  'use strict';
  if (window._wjpBankDiagCardInstalled) return;
  window._wjpBankDiagCardInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CARD_ID = 'wjp-bank-diag-card';

  function isAdmin() {
    try {
      if (window.WJP_IS_ADMIN === true) return true;
      if (typeof window.getTier === 'function' && String(window.getTier()).toLowerCase() === 'admin') return true;
      var u = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
      if (u && /pappoe34@gmail\.com/i.test(u.email || '')) return true;
      if (window.__wjpAuth && window.__wjpAuth.currentUser && /pappoe34@gmail\.com/i.test(window.__wjpAuth.currentUser.email || '')) return true;
    } catch (_) {}
    return false;
  }

  async function getIdToken() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return await u.getIdToken();
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) {
        return await window.__wjpAuth.currentUser.getIdToken();
      }
    } catch (_) {}
    return null;
  }

  function bankHealthModalOpen() {
    var ov = document.getElementById('bank-health-overlay');
    if (!ov) return false;
    // Visible / not display:none
    var cs = window.getComputedStyle(ov);
    return cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function findInsertionPoint() {
    // Bank Health is a modal in this app, not a page. Insert into #bh-body
    // (the modal's main scrollable body) so the diagnostic card sits at the
    // top alongside the existing item list.
    var body = document.getElementById('bh-body');
    if (body) return body;
    // Fallback: overlay root
    var ov = document.getElementById('bank-health-overlay');
    if (ov) return ov.firstElementChild || ov;
    return null;
  }

  function fmtUsd(n) {
    if (n == null || isNaN(n)) return '$0.00';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildCardShell() {
    if (document.getElementById(CARD_ID)) return null;
    var host = findInsertionPoint();
    if (!host) return null;
    var card = document.createElement('div');
    card.id = CARD_ID;
    card.style.cssText =
      'background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;' +
      'padding:18px 22px;margin:14px 0;font-family:Inter,system-ui,sans-serif;font-size:13px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.04);';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:9.5px;letter-spacing:0.14em;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(155,135,245,0.18);color:#7a5fc8;">ADMIN</span>' +
            '<div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Transaction sync diagnostic</div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:3px;">Inspect cursor + sync state per item, run a full force-resync.</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button type="button" id="wjp-bd-run" style="background:#1f7a4a;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Run diagnostic</button>' +
          '<button type="button" id="wjp-bd-force" style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.18));color:var(--ink,var(--text-1,#0a0a0a));border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Force resync all</button>' +
        '</div>' +
      '</div>' +
      '<div id="wjp-bd-body" style="font-size:12px;color:var(--ink-dim,var(--text-2,#6b7280));"></div>';
    // Prepend so the diagnostic card appears at the TOP of the modal body.
    if (host.firstChild) host.insertBefore(card, host.firstChild); else host.appendChild(card);
    card.querySelector('#wjp-bd-run').onclick = runDiagnostic;
    card.querySelector('#wjp-bd-force').onclick = forceResyncAll;
    return card;
  }

  async function runDiagnostic() {
    var body = document.getElementById('wjp-bd-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:10px 0;color:var(--ink-dim,#6b7280);">Loading…</div>';
    var token = await getIdToken();
    if (!token) { body.innerHTML = '<div style="color:#c0594a;">Not signed in.</div>'; return; }
    try {
      var r = await fetch('/.netlify/functions/admin-tx-diagnostic', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!r.ok) {
        var err = await r.text();
        body.innerHTML = '<div style="color:#c0594a;">HTTP ' + r.status + ': ' + err.slice(0, 200) + '</div>';
        return;
      }
      var data = await r.json();
      renderResult(body, data);
    } catch (e) {
      body.innerHTML = '<div style="color:#c0594a;">Error: ' + (e.message || e) + '</div>';
    }
  }

  function renderResult(body, data) {
    var s = data.summary || {};
    var issues = s.issues || [];
    var healthIcon = s.healthy ? '✓' : '⚠';
    var healthColor = s.healthy ? '#1f7a4a' : '#c0594a';

    var issuesHtml = '';
    if (issues.length) {
      issuesHtml = '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(192,89,74,0.08);border-left:3px solid #c0594a;border-radius:8px;">' +
        '<div style="font-size:11.5px;font-weight:800;letter-spacing:0.04em;color:#c0594a;text-transform:uppercase;margin-bottom:6px;">Issues found</div>' +
        '<ul style="margin:0;padding-left:18px;font-size:11.5px;color:var(--ink,var(--text-1,#0a0a0a));line-height:1.55;">' +
          issues.map(function (i) { return '<li>' + i + '</li>'; }).join('') +
        '</ul>' +
      '</div>';
    } else {
      issuesHtml = '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(31,122,74,0.08);border-left:3px solid #1f7a4a;border-radius:8px;font-size:11.5px;color:#1f7a4a;font-weight:700;">All items healthy.</div>';
    }

    var statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;margin-bottom:14px;">' +
      [
        ['Total tx', data.transactionStats.total],
        ['Last 7d', data.transactionStats.last7Days],
        ['Last 30d', data.transactionStats.last30Days],
        ['Last 90d', data.transactionStats.last90Days],
        ['Latest', data.transactionStats.latestTxDate || '—']
      ].map(function (pair) {
        return '<div style="background:var(--bg-3,rgba(0,0,0,0.03));border-radius:8px;padding:9px 12px;">' +
          '<div style="font-size:10px;letter-spacing:0.05em;text-transform:uppercase;color:var(--ink-dim,#6b7280);font-weight:700;">' + pair[0] + '</div>' +
          '<div style="font-size:15px;font-weight:800;color:var(--ink,var(--text-1,#0a0a0a));margin-top:2px;">' + pair[1] + '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    var itemsHtml = '<div style="margin-top:6px;">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-dim,#6b7280);margin-bottom:8px;">Items (' + data.items.length + ')</div>' +
      data.items.map(function (it) {
        var stateColor = it.itemError ? '#c0594a' : (it.txPendingSync ? '#a16207' : '#1f7a4a');
        var stateLabel = it.itemError ? 'ERROR: ' + it.itemError : (it.txPendingSync ? 'PENDING SYNC' : 'OK');
        var lastSync = it.lastTxSyncAt ? new Date(it.lastTxSyncAt).toLocaleString() : 'never';
        var lastWh   = it.lastWebhookAt ? new Date(it.lastWebhookAt).toLocaleString() + ' (' + (it.lastWebhookCode || '?') + ')' : 'never';
        return '<div style="border:1px solid var(--border,rgba(0,0,0,0.08));border-radius:10px;padding:11px 14px;margin-bottom:6px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<div style="font-size:13px;font-weight:700;color:var(--ink,var(--text-1,#0a0a0a));">' + (it.institutionName || it.itemId) + '</div>' +
            '<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;padding:2px 8px;border-radius:999px;background:' + stateColor + '20;color:' + stateColor + ';">' + stateLabel + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,#6b7280);line-height:1.55;">' +
            'Last sync: <strong>' + lastSync + '</strong> · Last webhook: ' + lastWh + '<br>' +
            'Cursor: <code>' + (it.cursorPreview || '(empty)') + '</code>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
        '<span style="font-size:18px;color:' + healthColor + ';">' + healthIcon + '</span>' +
        '<span style="font-size:13px;font-weight:600;">' + (s.healthy ? 'All sync paths healthy.' : 'See issues below.') + '</span>' +
        '<span style="margin-left:auto;font-size:10px;color:var(--ink-dim,#6b7280);">' + (data.runAt || '') + '</span>' +
      '</div>' +
      issuesHtml + statsHtml + itemsHtml;
  }

  async function forceResyncAll() {
    var body = document.getElementById('wjp-bd-body');
    if (!body) return;
    if (!confirm('Force a full resync of all Plaid items? This re-pulls the last 24mo of history per item. Safe — uses cursor-based upsert.')) return;
    body.innerHTML = '<div style="padding:10px 0;color:var(--ink-dim,#6b7280);">Force resync running… can take 30-60 seconds for users with many items.</div>';
    var token = await getIdToken();
    if (!token) { body.innerHTML = '<div style="color:#c0594a;">Not signed in.</div>'; return; }
    try {
      var r = await fetch('/.netlify/functions/sync-transactions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceFullResync: true })
      });
      var data = await r.json();
      if (!r.ok) {
        body.innerHTML = '<div style="color:#c0594a;">HTTP ' + r.status + ': ' + JSON.stringify(data).slice(0, 200) + '</div>';
        return;
      }
      var added = (data.items || []).reduce(function (s, i) { return s + (i.added || []).length; }, 0);
      var persisted = (data.items || []).reduce(function (s, i) { return s + (i.persisted || 0); }, 0);
      body.innerHTML = '<div style="padding:10px 0;color:#1f7a4a;font-weight:700;">Resync complete — ' + added + ' transactions returned, ' + persisted + ' persisted to Firestore. Click "Run diagnostic" to see updated state.</div>';
      // Also refresh the frontend tx-bootstrap so the UI sees them immediately
      if (window.WJP_TxBootstrap && typeof window.WJP_TxBootstrap.refresh === 'function') {
        await window.WJP_TxBootstrap.refresh();
      }
    } catch (e) {
      body.innerHTML = '<div style="color:#c0594a;">Error: ' + (e.message || e) + '</div>';
    }
  }

  function tick() {
    if (!isAdmin()) return;
    if (!bankHealthModalOpen()) {
      var existing = document.getElementById(CARD_ID);
      if (existing) try { existing.remove(); } catch (_) {}
      return;
    }
    if (!document.getElementById(CARD_ID)) buildCardShell();
  }

  function boot() {
    setInterval(tick, 2000);
    window.addEventListener('hashchange', tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_BankDiagCard = {
    run: runDiagnostic,
    forceResync: forceResyncAll,
    version: 1
  };
})();
