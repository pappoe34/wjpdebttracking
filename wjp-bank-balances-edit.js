/* wjp-bank-balances-edit.js v1 — Per-user pick/edit which Plaid-linked bank
 * accounts appear in the Bank Balances cards.
 *
 * Scope (universal — not Winston-specific):
 *   • Works for ANY user — defaults to showing all linked depository accounts
 *   • Persists per-user via appState.hiddenPlaidAccounts (array of plaidAccountIds)
 *   • Adds a small "Edit" pencil button to each Bank Balances card
 *   • Opens a modal with a checkbox list: ticked = visible, unticked = hidden
 *   • Save writes to appState, triggers a re-render
 *
 * Cards we target:
 *   1. #wjp-dash-debit-balances (Dashboard widget)
 *   2. #wjp-debit-balances-card  (Debts → Overview tab)
 *
 * Zero edits to existing renderers — purely additive via MutationObserver +
 * post-render filter. Idempotent install guard.
 */
(function () {
  'use strict';
  if (window._wjpBankBalancesEditInstalled) return;
  window._wjpBankBalancesEditInstalled = true;

  var STORAGE_KEY = 'hiddenPlaidAccounts';
  var STYLE_ID = 'wjp-bbe-style';
  var MODAL_ID = 'wjp-bbe-modal';

  function appS() {
    // CRITICAL: appState is bare `let` in app.js, NOT on window. Reading
    // window.appState first returns a parallel orphan object that desyncs
    // from saveState + cloudPush, causing writes to vanish on next pull.
    // See: memory file feedback_appstate_bare_identifier.
    try { if (typeof appState !== 'undefined' && appState) return appState; } catch (_) {}
    try { if (window.appState) return window.appState; } catch (_) {}
    return null;
  }
  function getHidden() {
    var s = appS(); if (!s) return [];
    if (!Array.isArray(s[STORAGE_KEY])) s[STORAGE_KEY] = [];
    return s[STORAGE_KEY];
  }
  function setHidden(arr) {
    var s = appS(); if (!s) return;
    s[STORAGE_KEY] = Array.isArray(arr) ? arr.slice() : [];
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('wjp-bank-hidden-changed', { detail: { hidden: s[STORAGE_KEY] } })); } catch (_) {}
  }
  function isHidden(plaidId) {
    return getHidden().indexOf(plaidId) >= 0;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return '$0';
    var abs = Math.abs(Number(n) || 0);
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: abs >= 1000 ? 0 : 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−$' : '$') + s;
  }

  // ---- Style for the Edit button + modal ----
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.wjp-bbe-edit-btn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,var(--text-1,#0a0a0a));border-radius:8px;padding:6px 12px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;margin-left:8px;}',
      '.wjp-bbe-edit-btn:hover{background:var(--card-2,rgba(0,0,0,0.04));}',
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:none;align-items:center;justify-content:center;padding:20px;}',
      '#' + MODAL_ID + '.open{display:flex;}',
      '#' + MODAL_ID + ' .bbe-card{background:var(--card,var(--bg-2,#fff));color:var(--ink,var(--text-1,#1f1a14));border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;padding:22px;max-width:520px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 12px 32px rgba(0,0,0,0.25);font-family:inherit;}',
      '#' + MODAL_ID + ' .bbe-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px;}',
      '#' + MODAL_ID + ' .bbe-title{font-size:17px;font-weight:800;color:var(--ink,var(--text-1,#1f1a14));}',
      '#' + MODAL_ID + ' .bbe-sub{font-size:12px;color:var(--text-2,#8b8378);margin-top:4px;}',
      '#' + MODAL_ID + ' .bbe-tools{display:flex;align-items:center;justify-content:space-between;font-size:11px;margin-bottom:8px;}',
      '#' + MODAL_ID + ' .bbe-tools a{color:#1f9b54;text-decoration:none;}',
      '#' + MODAL_ID + ' .bbe-tools a.muted{color:var(--text-2,#94a3b8);}',
      '#' + MODAL_ID + ' .bbe-list{border:1px solid var(--border,rgba(120,113,108,0.18));border-radius:8px;background:var(--card-2,rgba(0,0,0,0.02));max-height:340px;overflow:auto;}',
      '#' + MODAL_ID + ' .bbe-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border,rgba(120,113,108,0.10));cursor:pointer;}',
      '#' + MODAL_ID + ' .bbe-row:last-child{border-bottom:0;}',
      '#' + MODAL_ID + ' .bbe-row input[type=checkbox]{width:16px;height:16px;flex:0 0 16px;cursor:pointer;}',
      '#' + MODAL_ID + ' .bbe-row .nm{font-weight:600;font-size:13px;color:var(--ink,var(--text-1,#1f1a14));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + MODAL_ID + ' .bbe-row .meta{font-size:11px;color:var(--text-2,#8b8378);}',
      '#' + MODAL_ID + ' .bbe-row .bal{font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;}',
      '#' + MODAL_ID + ' .bbe-helper{font-size:11.5px;color:var(--text-2,#8b8378);margin:10px 0 6px;}',
      '#' + MODAL_ID + ' .bbe-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;}',
      '#' + MODAL_ID + ' .bbe-foot button{padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:0;}',
      '#' + MODAL_ID + ' .bbe-foot .bbe-cancel{background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,var(--text-1,#1f1a14));}',
      '#' + MODAL_ID + ' .bbe-foot .bbe-save{background:#1f9b54;color:#fff;}',
      '#' + MODAL_ID + ' .bbe-empty{padding:20px;text-align:center;color:var(--text-2,#8b8378);font-size:12px;}'
    ].join('');
    document.head.appendChild(st);
  }

  // ---- Source of truth for available accounts ----
  // Reuses the live cache from WJP_DebtsEnhance or wjp-assets to avoid extra Plaid calls.
  async function listAccounts() {
    // Prefer DebtsEnhance for depository accounts
    if (window.WJP_DebtsEnhance && typeof WJP_DebtsEnhance.getDebitAccounts === 'function') {
      try {
        var dbg = await WJP_DebtsEnhance.getDebitAccounts();
        if (Array.isArray(dbg) && dbg.length) {
          return dbg.map(function (a) {
            return {
              plaidAccountId: a.accountId || a.plaidAccountId,
              name: a.displayName || a.plaidName || a.name || 'Account',
              institutionName: a.institutionName || '',
              mask: a.mask || '',
              subtype: a.subtype || '',
              balance: Number(a.balance) || 0
            };
          });
        }
      } catch (_) {}
    }
    // Fall back to WJP_Assets.listLinked which calls /get-accounts
    if (window.WJP_Assets && typeof WJP_Assets.listLinked === 'function') {
      try {
        var linked = await WJP_Assets.listLinked();
        return (linked || []).filter(function (a) {
          var t = String(a.type || '').toLowerCase();
          var st = String(a.subtype || '').toLowerCase();
          if (t === 'credit' || t === 'loan' || /credit|loan|mortgage|student/.test(st)) return false;
          return true;
        });
      } catch (_) {}
    }
    return [];
  }

  // ---- Modal open ----
  async function openModal() {
    ensureStyle();
    var bg = document.getElementById(MODAL_ID);
    if (!bg) {
      bg = document.createElement('div');
      bg.id = MODAL_ID;
      bg.innerHTML = ''
        + '<div class="bbe-card">'
        +   '<div class="bbe-head"><div><div class="bbe-title">Bank balances · pick what shows</div><div class="bbe-sub">Tick the accounts you want to see in the Bank Balances cards. Untick to hide. Hidden accounts are not deleted — just removed from these lists.</div></div></div>'
        +   '<div class="bbe-tools"><div><a href="#" class="bbe-select-all">Select all</a> <span style="color:var(--text-2,#94a3b8);">·</span> <a href="#" class="bbe-clear muted">Clear</a></div><div class="bbe-summary" style="color:var(--text-2,#8b8378);"></div></div>'
        +   '<div class="bbe-list"><div class="bbe-empty">Loading…</div></div>'
        +   '<div class="bbe-helper">Defaults to showing all linked depository accounts. Universal — works for any user.</div>'
        +   '<div class="bbe-foot"><button type="button" class="bbe-cancel">Cancel</button><button type="button" class="bbe-save">Save</button></div>'
        + '</div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', function (e) { if (e.target === bg) closeModal(); });
      bg.querySelector('.bbe-cancel').addEventListener('click', closeModal);
      bg.querySelector('.bbe-save').addEventListener('click', onSave);
      bg.querySelector('.bbe-select-all').addEventListener('click', function (e) { e.preventDefault(); bg.querySelectorAll('.bbe-row input[type=checkbox]').forEach(function (c) { c.checked = true; }); updateSummary(); });
      bg.querySelector('.bbe-clear').addEventListener('click', function (e) { e.preventDefault(); bg.querySelectorAll('.bbe-row input[type=checkbox]').forEach(function (c) { c.checked = false; }); updateSummary(); });
    }
    bg.classList.add('open');
    var list = bg.querySelector('.bbe-list');
    list.innerHTML = '<div class="bbe-empty">Loading…</div>';
    var accounts = await listAccounts();
    if (!accounts.length) {
      list.innerHTML = '<div class="bbe-empty">No linked bank accounts yet. Use Sync Bank to link one first.</div>';
      updateSummary();
      return;
    }
    var hidden = getHidden();
    var rows = accounts.map(function (a) {
      var checked = hidden.indexOf(a.plaidAccountId) === -1; // ticked = visible
      var sub = (a.subtype || '').toLowerCase();
      var mask = a.mask ? ' · ····' + escapeHtml(String(a.mask)) : '';
      return '<label class="bbe-row">'
        + '<input type="checkbox" data-plaid-id="' + escapeHtml(a.plaidAccountId) + '"' + (checked ? ' checked' : '') + '>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div class="nm">' + escapeHtml(a.name) + '</div>'
        +   '<div class="meta">' + escapeHtml(sub) + mask + (a.institutionName ? ' · ' + escapeHtml(a.institutionName) : '') + '</div>'
        + '</div>'
        + '<div class="bal">' + fmtUsd(a.balance) + '</div>'
        + '</label>';
    }).join('');
    list.innerHTML = rows;
    // Wire checkbox change -> summary update
    list.querySelectorAll('input[type=checkbox]').forEach(function (c) {
      c.addEventListener('change', updateSummary);
    });
    updateSummary();
  }

  function closeModal() {
    var bg = document.getElementById(MODAL_ID);
    if (bg) bg.classList.remove('open');
  }
  function updateSummary() {
    var bg = document.getElementById(MODAL_ID); if (!bg) return;
    var chks = bg.querySelectorAll('.bbe-row input[type=checkbox]');
    var shown = 0;
    chks.forEach(function (c) { if (c.checked) shown++; });
    var sum = bg.querySelector('.bbe-summary');
    if (sum) sum.textContent = shown + ' of ' + chks.length + ' shown';
  }
  function onSave() {
    var bg = document.getElementById(MODAL_ID); if (!bg) return;
    var hidden = [];
    bg.querySelectorAll('.bbe-row input[type=checkbox]').forEach(function (c) {
      if (!c.checked) hidden.push(c.dataset.plaidId);
    });
    setHidden(hidden);
    closeModal();
    applyFilters(); // re-hide rows in any rendered card immediately
  }

  // ---- Inject Edit button into each Bank Balances card ----
  var BUTTON_HOSTS = [
    { sel: '#wjp-dash-debit-balances', headerSel: '.wjp-dbal-head' },
    { sel: '#wjp-debit-balances-card', headerSel: '#wjp-debit-refresh' }
  ];
  function ensureEditButtons() {
    BUTTON_HOSTS.forEach(function (h) {
      var card = document.querySelector(h.sel);
      if (!card) return;
      if (card.querySelector('.wjp-bbe-edit-btn')) return;
      var anchor = card.querySelector(h.headerSel);
      if (!anchor) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wjp-bbe-edit-btn';
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit';
      btn.title = 'Pick which bank accounts show here';
      btn.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
      // Insert after the anchor (refresh button) or inside the header
      if (h.headerSel === '#wjp-debit-refresh' && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling || null);
      } else if (anchor.parentNode) {
        anchor.parentNode.appendChild(btn);
      }
    });
  }

  // ---- Apply filter to rendered cards ----
  function applyFilters() {
    var hidden = getHidden();
    if (!hidden.length) {
      // Restore any previously-hidden rows
      document.querySelectorAll('[data-wjp-bbe-hidden="1"]').forEach(function (el) {
        el.style.display = '';
        el.removeAttribute('data-wjp-bbe-hidden');
      });
      return;
    }
    // Dashboard widget rows (wjp-dbal-row + bal element; no easy data-account-id — use account name match via meta)
    // For now, prefer cards that DO expose data-account-id; we'll need to look up by name fallback.
    var hiddenSet = {};
    hidden.forEach(function (p) { hiddenSet[p] = true; });
    // Cards that mark rows with data-account-id (Debts > Overview Debit balances)
    document.querySelectorAll('[data-account-id]').forEach(function (el) {
      var id = el.getAttribute('data-account-id');
      if (hiddenSet[id]) {
        el.style.display = 'none';
        el.setAttribute('data-wjp-bbe-hidden', '1');
      } else if (el.getAttribute('data-wjp-bbe-hidden') === '1') {
        el.style.display = '';
        el.removeAttribute('data-wjp-bbe-hidden');
      }
    });
    // Dashboard widget rows — no data-account-id. Fallback: match by visible name.
    var dashCard = document.querySelector('#wjp-dash-debit-balances');
    if (dashCard) {
      // Build a name->plaidId lookup via the live data cache
      try {
        listAccounts().then(function (accs) {
          var byName = {};
          accs.forEach(function (a) { byName[(a.name || '').trim()] = a.plaidAccountId; });
          dashCard.querySelectorAll('.wjp-dbal-row').forEach(function (row) {
            var nameEl = row.querySelector('.wjp-dbal-row-name');
            if (!nameEl) return;
            var nm = (nameEl.textContent || '').trim();
            var pid = byName[nm];
            if (pid && hiddenSet[pid]) {
              row.style.display = 'none';
              row.setAttribute('data-wjp-bbe-hidden', '1');
            } else if (row.getAttribute('data-wjp-bbe-hidden') === '1') {
              row.style.display = '';
              row.removeAttribute('data-wjp-bbe-hidden');
            }
          });
        });
      } catch (_) {}
    }
  }

  // ---- Boot ----
  function tick() {
    ensureEditButtons();
    applyFilters();
  }
  // Initial + periodic (cards may re-render)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 1500); });
  } else {
    setTimeout(tick, 1500);
  }
  setInterval(tick, 5000); // gentle reconcile every 5s

  // React to data changes
  window.addEventListener('wjp-bank-hidden-changed', function () { applyFilters(); });
  window.addEventListener('wjp-assets-changed', function () { setTimeout(tick, 200); });

  // Public API
  window.WJP_BankBalancesEdit = {
    version: 1,
    openModal: openModal,
    isHidden: isHidden,
    getHidden: getHidden,
    setHidden: setHidden,
    apply: applyFilters
  };
})();
