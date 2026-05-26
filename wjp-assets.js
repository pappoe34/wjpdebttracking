/* wjp-assets.js v7 (Debts: anchor right before Debit balances = 2nd box — 2026-05-22). v6 (Debts: mount inside Overview sub-tab right after hero — 2026-05-22). v5 (lengthened refresh intervals to reduce flicker — 2026-05-22) — v4 — retry-until-auth boot + debug API exposure (v3 raced auth) (was reading $0 because WJP_AcctLookup has no balance field). — Asset tracker for Dashboard + Debts tab.
 *
 * Joins the existing dashboard customize system: each mount is a
 * `.card.reveal.reorderable` direct child of #page-dashboard / #page-debts
 * with data-card-id + data-card-label + data-size attributes so it inherits
 * resize, reorder, hide, pin behavior automatically.
 *
 * Storage:
 *   appState.assets = [{ id, name, type, value, plaidAccountId?, notes?,
 *                        institutionName?, createdAt, updatedAt }]
 *
 * Asset types: investment, crypto, real_estate, vehicle, cash, other.
 * Add via manual form, or promote a Plaid-linked account, or open Sync
 * Bank to link a new one (memory rule: don't touch Plaid.create — only
 * .click() the existing Sync Bank button).
 *
 * Memory rules honored:
 *   - appState read via try/catch (bare `let`, not window.appState)
 *   - Per-user storage (rides app.js getStateKey which routes to scoped key)
 *   - All styling uses CSS vars (var(--ink, var(--text-1, #fallback)))
 *     so it inherits the host theme — light AND dark mode just work.
 *   - Uses `.card` class so card chrome (border, bg, shadow, dark-mode flip)
 *     comes from the host stylesheet. No custom dark-mode rules needed.
 *   - Joins customize system: data-card-id="assets" + reorderable class.
 *   - Works for every user out of the box: empty state when assets is [].
 *   - MutationObserver scoped to the page-dashboard / page-debts ids and
 *     coalesces work in rAF to avoid recursion.
 *   - Does NOT replace the existing `dash-linked-assets-card` (different
 *     module's territory — uses card-id "assets" instead of "linked-assets").
 */
(function () {
  'use strict';
  if (window._wjpAssetsInstalled) return;
  window._wjpAssetsInstalled = true;

  var DASH_CARD_ID  = 'dash-assets-card';        // DOM id, dashboard
  var DEBTS_CARD_ID = 'debts-assets-card';       // DOM id, strategy/debts
  var CARD_SLUG     = 'assets';                  // customize-system slug
  var CARD_LABEL    = 'Assets';                  // customize-system label

  // ---------- state helpers ----------
  function getAppState() { try { return appState; } catch (_) { return null; } }
  function saveState() {
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
  }
  function getAssets() {
    var s = getAppState();
    if (!s) return [];
    if (!Array.isArray(s.assets)) s.assets = [];
    return s.assets;
  }
  function setAssets(arr) {
    var s = getAppState();
    if (!s) return;
    s.assets = arr;
    saveState();
    try { window.dispatchEvent(new CustomEvent('wjp-assets-changed')); } catch (_) {}
  }
  function totalAssets() {
    return getAssets().reduce(function (sum, a) {
      var v = Number(a.value) || 0;
      if (a.plaidAccountId) {
        var live = liveBalanceFor(a.plaidAccountId);
        if (live != null) v = live;
      }
      return sum + v;
    }, 0);
  }
  function totalDebts() {
    var s = getAppState();
    if (!s || !Array.isArray(s.debts)) return 0;
    return s.debts.reduce(function (sum, d) { return sum + (Number(d.balance) || 0); }, 0);
  }
  function netWorth() { return totalAssets() - totalDebts(); }

  function fmtUsd(n) {
    if (!isFinite(n)) return '$0';
    var neg = n < 0;
    var abs = Math.abs(n);
    var str = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: abs >= 1000 ? 0 : 2, maximumFractionDigits: 2 });
    return neg ? '−' + str : str;
  }
  function uuid() {
    return 'asset-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  // ---- Plaid live-balance cache (60s TTL) ----
  var _acctCache = { ts: 0, items: null, inflight: null };
  var ACCT_CACHE_TTL = 60 * 1000;

  async function fetchAccountsLive(force) {
    var now = Date.now();
    if (!force && _acctCache.items && (now - _acctCache.ts) < ACCT_CACHE_TTL) {
      return _acctCache.items;
    }
    if (_acctCache.inflight) return _acctCache.inflight;
    _acctCache.inflight = (async function () {
      try {
        if (!window.__wjpAuth || !window.__wjpAuth.currentUser) return _acctCache.items || [];
        var token = await window.__wjpAuth.currentUser.getIdToken();
        var r = await fetch('/.netlify/functions/get-accounts', {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!r.ok) return _acctCache.items || [];
        var data = await r.json();
        var flat = [];
        (data.items || []).forEach(function (item) {
          (item.accounts || []).forEach(function (a) {
            var bal = (a.balances && (a.balances.current != null ? a.balances.current : a.balances.available));
            flat.push({
              plaidAccountId: a.account_id,
              name: a.name || a.official_name || 'Account',
              official_name: a.official_name || '',
              institutionName: item.institutionName || '',
              mask: a.mask || '',
              subtype: a.subtype || '',
              type: a.type || '',
              balance: Number(bal) || 0
            });
          });
        });
        _acctCache.items = flat;
        _acctCache.ts = Date.now();
        return flat;
      } catch (_) { return _acctCache.items || []; }
      finally { _acctCache.inflight = null; }
    })();
    return _acctCache.inflight;
  }

  function liveBalanceFor(plaidAccountId) {
    if (!plaidAccountId || !_acctCache.items) return null;
    for (var i = 0; i < _acctCache.items.length; i++) {
      if (_acctCache.items[i].plaidAccountId === plaidAccountId) return _acctCache.items[i].balance;
    }
    return null;
  }

  async function repairAssetBalances() {
    var list = await fetchAccountsLive(false);
    if (!list || !list.length) return false;
    var s = getAppState();
    if (!s || !Array.isArray(s.assets)) return false;
    var changed = false;
    s.assets.forEach(function (a) {
      if (!a.plaidAccountId) return;
      var live = liveBalanceFor(a.plaidAccountId);
      if (live != null && Math.abs((Number(a.value) || 0) - live) > 0.01) {
        a.value = live;
        a.updatedAt = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) {
      saveState();
      try { window.dispatchEvent(new CustomEvent('wjp-assets-changed')); } catch (_) {}
    }
    return changed;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ---------- Plaid-linked discovery (live via /get-accounts) ----------
  async function listLinkedAccounts() {
    var all = await fetchAccountsLive(false);
    if (!all || !all.length) return [];
    return all.filter(function (a) {
      var t = String(a.subtype || '').toLowerCase();
      var tt = String(a.type || '').toLowerCase();
      if (/credit|loan|mortgage|student/.test(t)) return false;
      if (/loan|credit/.test(tt)) return false;
      return true;
    });
  }

  // ---------- type metadata ----------
  var TYPE_META = {
    investment:  { label: 'Investment',  icon: '📈' },
    crypto:      { label: 'Crypto',      icon: '₿'  },
    real_estate: { label: 'Real estate', icon: '🏠' },
    vehicle:     { label: 'Vehicle',     icon: '🚗' },
    cash:        { label: 'Cash',        icon: '🏦' },
    other:       { label: 'Other',       icon: '💎' }
  };
  function metaFor(type) { return TYPE_META[type] || TYPE_META.other; }

  // ---------- CSS (idempotent inject) ----------
  function ensureStyles() {
    if (document.getElementById('wjp-assets-styles')) return;
    var css = [
      // The outer .card class handles bg/border/shadow + dark mode flip.
      // We only style the interior. All colors via CSS vars so they
      // automatically swap in dark mode.
      '.wjp-assets-body{padding:18px 22px 4px 22px;}',
      '.wjp-assets-body .ac-row1{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}',
      '.wjp-assets-body .ac-eyebrow{font-size:11px;letter-spacing:.16em;font-weight:700;color:#c5a572;text-transform:uppercase;}',
      '.wjp-assets-body .ac-eyebrow-r{font-size:11px;letter-spacing:.10em;font-weight:600;color:var(--text-2, #8b8378);text-transform:uppercase;}',
      '.wjp-assets-body .ac-row2{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px;}',
      '.wjp-assets-body .ac-title{font-size:20px;font-weight:700;margin:0;color:var(--ink, var(--text-1, #1f1a14));}',
      '.wjp-assets-body .ac-total{font-size:30px;font-weight:800;color:var(--ink, var(--text-1, #1f1a14));letter-spacing:-0.5px;font-variant-numeric:tabular-nums;}',
      // Gold band marker — subtle, works in both modes
      '.wjp-assets-body .ac-band{height:3px;width:54px;border-radius:999px;background:linear-gradient(90deg, #c5a572 0%, #d4af37 60%, #c5a572 100%);margin-bottom:14px;}',
      '.wjp-assets-body .ac-list{display:flex;flex-direction:column;}',
      '.wjp-assets-body .ac-asset{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--border, var(--ink-10, rgba(120,113,108,.18)));}',
      '.wjp-assets-body .ac-asset:last-child{border-bottom:0;}',
      '.wjp-assets-body .ac-asset .ac-ico{width:34px;height:34px;border-radius:10px;background:rgba(197,165,114,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 34px;color:#c5a572;}',
      '.wjp-assets-body .ac-asset .ac-meta{flex:1;min-width:0;}',
      '.wjp-assets-body .ac-asset .ac-name{font-weight:600;font-size:14.5px;color:var(--ink, var(--text-1, #1f1a14));}',
      '.wjp-assets-body .ac-asset .ac-sub{font-size:12px;color:var(--text-2, #8b8378);}',
      '.wjp-assets-body .ac-asset .ac-val{font-weight:700;color:var(--ink, var(--text-1, #1f1a14));font-variant-numeric:tabular-nums;}',
      '.wjp-assets-body .ac-asset .ac-actions{display:flex;gap:4px;margin-left:8px;opacity:.0;transition:opacity .15s;}',
      '.wjp-assets-body .ac-asset:hover .ac-actions{opacity:1;}',
      '.wjp-assets-body .ac-actions button{background:transparent;border:0;color:var(--text-2, #8b8378);cursor:pointer;font-size:13px;padding:4px 8px;border-radius:6px;font-family:inherit;}',
      '.wjp-assets-body .ac-actions button:hover{background:var(--ink-5, rgba(120,113,108,.12));color:var(--ink, var(--text-1, #1f1a14));}',
      '.wjp-assets-body .ac-empty{padding:24px 6px;text-align:center;color:var(--text-2, #8b8378);font-size:13.5px;line-height:1.55;}',
      '.wjp-assets-body .ac-empty strong{color:var(--ink, var(--text-1, #1f1a14));font-weight:600;}',
      '.wjp-assets-body .ac-foot{margin-top:14px;padding-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}',
      '.wjp-assets-body .ac-networth{font-size:12.5px;color:var(--text-2, #8b8378);}',
      '.wjp-assets-body .ac-networth strong{color:var(--ink, var(--text-1, #1f1a14));font-variant-numeric:tabular-nums;font-weight:700;}',
      '.wjp-assets-body .ac-networth-neg strong{color:#dc2626;}',
      '.wjp-assets-body .ac-add-btn{background:linear-gradient(135deg, #c5a572 0%, #d4af37 100%);color:#1f1a14;font-weight:700;border:0;border-radius:10px;padding:9px 16px;font-size:13.5px;cursor:pointer;letter-spacing:.02em;box-shadow:0 1px 3px rgba(197,165,114,0.35);font-family:inherit;}',
      '.wjp-assets-body .ac-add-btn:hover{filter:brightness(1.05);}',
      // Modal
      '#wjp-asset-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.52);z-index:9990;display:none;align-items:center;justify-content:center;}',
      '#wjp-asset-modal-bg.open{display:flex;}',
      '#wjp-asset-modal{background:var(--surface, var(--card-bg, #fff));color:var(--ink, var(--text-1, #1f1a14));border-radius:18px;width:min(520px, 92vw);max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.35);padding:24px;border:1px solid var(--border, var(--ink-10, rgba(120,113,108,.18)));font-family:inherit;}',
      '#wjp-asset-modal h3{margin:0 0 4px 0;font-size:20px;color:var(--ink, var(--text-1, #1f1a14));}',
      '#wjp-asset-modal .am-sub{color:var(--text-2, #8b8378);font-size:13px;margin-bottom:18px;}',
      '#wjp-asset-modal .am-tabs{display:flex;gap:6px;background:var(--ink-5, rgba(120,113,108,0.10));border-radius:10px;padding:4px;margin-bottom:18px;}',
      '#wjp-asset-modal .am-tabs button{flex:1;background:transparent;border:0;padding:8px 12px;border-radius:8px;font-size:13.5px;font-weight:600;cursor:pointer;color:var(--text-2, #8b8378);font-family:inherit;}',
      '#wjp-asset-modal .am-tabs button.active{background:var(--surface, var(--card-bg, #fff));color:var(--ink, var(--text-1, #1f1a14));box-shadow:0 1px 2px rgba(0,0,0,0.05);}',
      '#wjp-asset-modal .am-pane{display:none;}#wjp-asset-modal .am-pane.active{display:block;}',
      '#wjp-asset-modal label{display:block;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-2, #8b8378);margin:14px 0 6px;}',
      '#wjp-asset-modal input, #wjp-asset-modal select, #wjp-asset-modal textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border, var(--ink-10, rgba(120,113,108,.2)));background:var(--surface, var(--card-bg, #fff));color:var(--ink, var(--text-1, #1f1a14));font-size:14px;box-sizing:border-box;font-family:inherit;}',
      '#wjp-asset-modal input:focus, #wjp-asset-modal select:focus, #wjp-asset-modal textarea:focus{outline:none;border-color:#c5a572;box-shadow:0 0 0 3px rgba(197,165,114,0.18);}',
      '#wjp-asset-modal .am-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '#wjp-asset-modal .am-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;}',
      '#wjp-asset-modal .am-foot button{padding:9px 16px;border-radius:10px;border:0;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;}',
      '#wjp-asset-modal .am-cancel{background:transparent;color:var(--text-2, #8b8378);}',
      '#wjp-asset-modal .am-save{background:linear-gradient(135deg, #c5a572 0%, #d4af37 100%);color:#1f1a14;}',
      '#wjp-asset-modal .am-link-sync{background:transparent;border:1px solid var(--border, var(--ink-10, rgba(120,113,108,.25)));color:var(--ink, var(--text-1, #1f1a14));padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:600;cursor:pointer;margin-top:8px;width:100%;font-family:inherit;}',
      '#wjp-asset-modal .am-link-sync:hover{border-color:#c5a572;}',
      '#wjp-asset-modal .am-helper{font-size:12px;color:var(--text-2, #8b8378);margin-top:6px;line-height:1.5;}',
      // ---- Dark mode overrides (the site doesn't define --surface/--card-bg
      // in dark, so we explicitly target body.dark + [data-theme=dark]) ----
      'body.dark #wjp-asset-modal, [data-theme="dark"] #wjp-asset-modal { background: #131929; color: #f0f4ff; border-color: rgba(255,255,255,0.10); }',
      'body.dark #wjp-asset-modal h3, [data-theme="dark"] #wjp-asset-modal h3 { color: #f0f4ff; }',
      'body.dark #wjp-asset-modal .am-tabs, [data-theme="dark"] #wjp-asset-modal .am-tabs { background: rgba(255,255,255,0.05); }',
      'body.dark #wjp-asset-modal .am-tabs button.active, [data-theme="dark"] #wjp-asset-modal .am-tabs button.active { background: #1c2335; color: #f0f4ff; }',
      'body.dark #wjp-asset-modal input, body.dark #wjp-asset-modal select, body.dark #wjp-asset-modal textarea, [data-theme="dark"] #wjp-asset-modal input, [data-theme="dark"] #wjp-asset-modal select, [data-theme="dark"] #wjp-asset-modal textarea { background: #1c2335; color: #f0f4ff; border-color: rgba(255,255,255,0.12); }',
      'body.dark #wjp-asset-modal input::placeholder, body.dark #wjp-asset-modal textarea::placeholder, [data-theme="dark"] #wjp-asset-modal input::placeholder, [data-theme="dark"] #wjp-asset-modal textarea::placeholder { color: rgba(240,244,255,0.45); }',
      'body.dark #wjp-asset-modal .am-link-sync, [data-theme="dark"] #wjp-asset-modal .am-link-sync { color: #f0f4ff; border-color: rgba(255,255,255,0.15); }',
      // Also harden the .card body in dark mode (border between rows)
      'body.dark .wjp-assets-body .ac-asset, [data-theme="dark"] .wjp-assets-body .ac-asset { border-bottom-color: rgba(255,255,255,0.08); }',
      'body.dark .wjp-assets-body .ac-asset .ac-name, [data-theme="dark"] .wjp-assets-body .ac-asset .ac-name { color: #f0f4ff; }',
      'body.dark .wjp-assets-body .ac-asset .ac-val, [data-theme="dark"] .wjp-assets-body .ac-asset .ac-val { color: #f0f4ff; }',
      'body.dark .wjp-assets-body .ac-title, [data-theme="dark"] .wjp-assets-body .ac-title { color: #f0f4ff; }',
      'body.dark .wjp-assets-body .ac-total, [data-theme="dark"] .wjp-assets-body .ac-total { color: #f0f4ff; }',
      'body.dark .wjp-assets-body .ac-networth strong, [data-theme="dark"] .wjp-assets-body .ac-networth strong { color: #f0f4ff; }',
      'body.dark .wjp-assets-body .ac-empty strong, [data-theme="dark"] .wjp-assets-body .ac-empty strong { color: #f0f4ff; }'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'wjp-assets-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- card body HTML ----------
  function buildBodyHTML(opts) {
    opts = opts || {};
    var assets = getAssets();
    var total = totalAssets();
    var nw = netWorth();
    var nwStr = fmtUsd(nw);
    var nwClass = nw < 0 ? 'ac-networth ac-networth-neg' : 'ac-networth';

    var listHTML;
    if (assets.length === 0) {
      listHTML = ''
        + '<div class="ac-empty">'
        + '<strong>No assets tracked yet.</strong><br>'
        + 'Add your investments, real estate, vehicles, or other valuables to see your real net worth.'
        + '</div>';
    } else {
      listHTML = '<div class="ac-list">' + assets.map(function (a) {
        var m = metaFor(a.type);
        var subBits = [m.label];
        if (a.plaidAccountId) subBits.push('linked');
        if (a.institutionName) subBits.push(a.institutionName);
        if (a.notes) subBits.push(a.notes.slice(0, 32) + (a.notes.length > 32 ? '…' : ''));
        return ''
          + '<div class="ac-asset" data-asset-id="' + escapeHtml(a.id) + '">'
          + '  <div class="ac-ico">' + m.icon + '</div>'
          + '  <div class="ac-meta">'
          + '    <div class="ac-name">' + escapeHtml(a.name || 'Asset') + '</div>'
          + '    <div class="ac-sub">' + escapeHtml(subBits.join(' · ')) + '</div>'
          + '  </div>'
          + '  <div class="ac-val">' + fmtUsd((a.plaidAccountId && liveBalanceFor(a.plaidAccountId) != null) ? liveBalanceFor(a.plaidAccountId) : a.value) + '</div>'
          + '  <div class="ac-actions">'
          + '    <button class="ac-edit" data-asset-id="' + escapeHtml(a.id) + '" title="Edit">Edit</button>'
          + '    <button class="ac-del"  data-asset-id="' + escapeHtml(a.id) + '" title="Remove">×</button>'
          + '  </div>'
          + '</div>';
      }).join('') + '</div>';
    }

    return ''
+ '<div class="wjp-assets-body">'
+ '  <div class="ac-row1">'
+ '    <span class="ac-eyebrow">Assets · what you own</span>'
+ '    <span class="ac-eyebrow-r">Total assets</span>'
+ '  </div>'
+ '  <div class="ac-row2">'
+ '    <h2 class="ac-title">Your wealth across accounts</h2>'
+ '    <div class="ac-total">' + fmtUsd(total) + '</div>'
+ '  </div>'
+ '  <div class="ac-band"></div>'
+ listHTML
+ '  <div class="ac-foot">'
+ '    <div class="' + nwClass + '">Net worth: <strong>' + nwStr + '</strong> <span style="opacity:.7">(assets − debts)</span></div>'
+ '    <button class="ac-add-btn" type="button" data-action="add-asset">+ Add asset</button>'
+ '  </div>'
+ '</div>';
  }

  // ---------- modal ----------
  var editingId = null;
  function openModal(assetId) {
    editingId = assetId || null;
    ensureModal();
    var bg = document.getElementById('wjp-asset-modal-bg');
    bg.classList.add('open');
    switchTab('manual');
    var asset = null;
    if (editingId) asset = getAssets().find(function (a) { return a.id === editingId; });
    fillForm(asset || { type: 'investment' });
    populatePlaidDropdown();
    document.getElementById('am-title').textContent = editingId ? 'Edit asset' : 'Add asset';
  }
  function closeModal() {
    var bg = document.getElementById('wjp-asset-modal-bg');
    if (bg) bg.classList.remove('open');
    editingId = null;
  }
  function switchTab(name) {
    document.querySelectorAll('#wjp-asset-modal .am-tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('#wjp-asset-modal .am-pane').forEach(function (p) {
      p.classList.toggle('active', p.dataset.pane === name);
    });
  }
  // v11: TRUE SYNC mode. Modal is a "what's tracked" view, not a one-way add.
  //   • ALL linked accounts shown
  //   • Already-tracked accounts: pre-checked + ✓ Added badge (still enabled — uncheck to remove)
  //   • Save handler does a 2-way diff: adds newly-checked, removes newly-unchecked
  //   • Clear unticks everything (including already-added — used to wipe selection)
  //   • Select all ticks everything (idempotent for already-added)
  //   Works for any user — empty asset list, full list, or partial — universally.
  async function populatePlaidDropdown() {
    var list = document.getElementById('am-plaid-list');
    var helper = document.getElementById('am-plaid-helper');
    if (!list) return;
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-2,#94a3b8);font-size:12px;">Loading…</div>';
    var linked = await listLinkedAccounts();
    if (!linked.length) {
      list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-2,#94a3b8);font-size:12px;">No linked accounts found. Use Sync Bank below to link one.</div>';
      if (helper) helper.textContent = 'No linked accounts yet.';
      return;
    }
    var existing = {};
    getAssets().forEach(function (a) { if (a.plaidAccountId) existing[a.plaidAccountId] = true; });
    var alreadyCount = 0;
    var rows = linked.map(function (a) {
      var isAlready = !!existing[a.plaidAccountId];
      if (isAlready) alreadyCount++;
      var subtypeLabel = (a.subtype || a.type || 'account').toLowerCase();
      var maskBit = a.mask ? ' · ' + escapeHtml(String(a.mask)) : '';
      // All rows now use the same interactive style — already-added stay highlighted by the badge only.
      var rowStyle = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border,rgba(120,113,108,0.10));cursor:pointer;transition:background .12s;';
      var badge = isAlready
        ? '<span style="background:rgba(16,185,129,0.14);color:#10b981;padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin-left:8px;">✓ Added</span>'
        : '';
      var checkedAttr = isAlready ? ' checked' : '';
      var alreadyAttr = isAlready ? ' data-already="1"' : '';
      return '<label style="' + rowStyle + '" onmouseover="this.style.background=\'rgba(120,113,108,0.06)\'" onmouseout="this.style.background=\'transparent\'">'
        + '<input type="checkbox" class="am-plaid-chk" data-plaid-id="' + escapeHtml(a.plaidAccountId) + '"' + alreadyAttr + checkedAttr + ' style="width:16px;height:16px;flex:0 0 16px;cursor:pointer;">'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="display:flex;align-items:center;gap:4px;"><span style="font-weight:600;font-size:13px;color:var(--ink,var(--text-1,#1f1a14));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.name) + '</span>' + badge + '</div>'
        +   '<div style="font-size:11px;color:var(--text-2,#8b8378);">' + escapeHtml(subtypeLabel) + maskBit + (a.institutionName ? ' · ' + escapeHtml(a.institutionName) : '') + '</div>'
        + '</div>'
        + '<div style="font-weight:700;font-size:13px;color:var(--ink,var(--text-1,#1f1a14));font-variant-numeric:tabular-nums;">' + fmtUsd(a.balance) + '</div>'
        + '</label>';
    }).join('');
    list.innerHTML = rows;
    if (helper) {
      if (alreadyCount === linked.length) {
        helper.textContent = 'All ' + linked.length + ' linked account' + (linked.length === 1 ? '' : 's') + ' tracked. Untick to remove, or Clear to remove all.';
      } else if (alreadyCount > 0) {
        helper.textContent = alreadyCount + ' of ' + linked.length + ' tracked. Tick to add, untick to remove. Save to apply.';
      } else {
        helper.textContent = linked.length + ' linked account' + (linked.length === 1 ? '' : 's') + ' available. Tick to track.';
      }
      helper.style.color = '';
    }

    // Wire Select all / Clear — now operate on ALL checkboxes (no disabled filter).
    var selAllEl = document.getElementById('am-plaid-select-all');
    var clearEl  = document.getElementById('am-plaid-clear-all');
    if (selAllEl && !selAllEl.__wjpWired) {
      selAllEl.__wjpWired = true;
      selAllEl.addEventListener('click', function (e) { e.preventDefault(); list.querySelectorAll('.am-plaid-chk').forEach(function (c) { c.checked = true; }); });
    }
    if (clearEl && !clearEl.__wjpWired) {
      clearEl.__wjpWired = true;
      clearEl.addEventListener('click', function (e) { e.preventDefault(); list.querySelectorAll('.am-plaid-chk').forEach(function (c) { c.checked = false; }); });
    }
  }
  function fillForm(a) {
    var f = document.getElementById('wjp-asset-form');
    if (!f) return;
    f.querySelector('[name="type"]').value = a.type || 'investment';
    f.querySelector('[name="name"]').value = a.name || '';
    f.querySelector('[name="value"]').value = a.value != null ? a.value : '';
    f.querySelector('[name="notes"]').value = a.notes || '';
  }
  function readForm() {
    var f = document.getElementById('wjp-asset-form');
    return {
      type:  f.querySelector('[name="type"]').value || 'other',
      name:  (f.querySelector('[name="name"]').value || '').trim(),
      value: parseFloat(f.querySelector('[name="value"]').value) || 0,
      notes: (f.querySelector('[name="notes"]').value || '').trim()
    };
  }
  function ensureModal() {
    if (document.getElementById('wjp-asset-modal-bg')) return;
    var bg = document.createElement('div');
    bg.id = 'wjp-asset-modal-bg';
    bg.innerHTML = ''
+ '<div id="wjp-asset-modal" role="dialog" aria-modal="true">'
+ '  <h3 id="am-title">Add asset</h3>'
+ '  <div class="am-sub">Track what you own — investments, crypto, real estate, anything of value.</div>'
+ '  <div class="am-tabs">'
+ '    <button type="button" data-tab="manual" class="active">Add manually</button>'
+ '    <button type="button" data-tab="plaid">From your bank</button>'
+ '  </div>'
+ '  <div class="am-pane active" data-pane="manual">'
+ '    <form id="wjp-asset-form" onsubmit="return false">'
+ '      <label>Type</label>'
+ '      <select name="type">'
+ '        <option value="investment">Investment (401k, IRA, brokerage)</option>'
+ '        <option value="crypto">Crypto</option>'
+ '        <option value="real_estate">Real estate</option>'
+ '        <option value="vehicle">Vehicle / valuable</option>'
+ '        <option value="cash">Cash account</option>'
+ '        <option value="other">Other</option>'
+ '      </select>'
+ '      <div class="am-row">'
+ '        <div><label>Name</label><input name="name" placeholder="e.g. Vanguard 401k"></div>'
+ '        <div><label>Current value</label><input name="value" type="number" min="0" step="0.01" placeholder="0.00"></div>'
+ '      </div>'
+ '      <label>Notes (optional)</label>'
+ '      <textarea name="notes" rows="2" placeholder="Custodian, contribution rate, anything else…"></textarea>'
+ '    </form>'
+ '  </div>'
+ '  <div class="am-pane" data-pane="plaid">'
+ '    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><label style="margin:0;">Pick linked bank accounts to track</label><div style="display:flex;gap:8px;font-size:11px;"><a href="#" id="am-plaid-select-all" style="color:#1f9b54;text-decoration:none;">Select all</a><span style="color:#94a3b8;">·</span><a href="#" id="am-plaid-clear-all" style="color:#94a3b8;text-decoration:none;">Clear</a></div></div>'
+ '    <div id="am-plaid-list" style="max-height:280px;overflow:auto;border:1px solid var(--border,rgba(120,113,108,0.18));border-radius:8px;padding:4px 0;background:var(--card-2,rgba(255,255,255,0.02));">Loading…</div>'
+ '    <div class="am-helper" id="am-plaid-helper">Tick one or more accounts. Live balance is used.</div>'
+ '    <label style="margin-top:18px">Or link a new account</label>'
+ '    <button type="button" class="am-link-sync" id="am-open-sync">Open Sync Bank →</button>'
+ '    <div class="am-helper">Opens the existing Sync Bank flow. Link your brokerage, investment, or savings account, then come back here to track it.</div>'
+ '  </div>'
+ '  <div class="am-foot">'
+ '    <button type="button" class="am-cancel" id="am-cancel">Cancel</button>'
+ '    <button type="button" class="am-save"   id="am-save">Save asset</button>'
+ '  </div>'
+ '</div>';
    document.body.appendChild(bg);

    bg.addEventListener('click', function (e) { if (e.target === bg) closeModal(); });
    bg.querySelector('#am-cancel').addEventListener('click', closeModal);
    bg.querySelectorAll('.am-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    bg.querySelector('#am-save').addEventListener('click', function () {
      var activePane = bg.querySelector('.am-pane.active').dataset.pane;
      if (activePane === 'plaid') {
        // v11: 2-way sync.  Walk every checkbox.
        //   checked AND not in assets  -> ADD
        //   unchecked AND in assets    -> REMOVE
        //   unchanged                  -> no-op
        var allChks = Array.prototype.slice.call(bg.querySelectorAll('.am-plaid-chk'));
        var existingByPlaid = {};
        getAssets().forEach(function (a) { if (a.plaidAccountId) existingByPlaid[a.plaidAccountId] = a; });
        var toAdd = [];
        var toRemove = [];
        allChks.forEach(function (c) {
          var pid = c.dataset.plaidId;
          var isChecked = c.checked;
          var existed = !!existingByPlaid[pid];
          if (isChecked && !existed) toAdd.push(pid);
          else if (!isChecked && existed) toRemove.push(existingByPlaid[pid].id);
        });
        if (!toAdd.length && !toRemove.length) {
          var helper = document.getElementById('am-plaid-helper');
          if (helper) { helper.textContent = 'No changes to save.'; helper.style.color = '#94a3b8'; }
          return;
        }
        // Apply removals first (so re-adds with same plaidId would also work cleanly)
        if (toRemove.length) {
          var keep = getAssets().filter(function (a) { return toRemove.indexOf(a.id) === -1; });
          setAssets(keep);
        }
        if (!toAdd.length) {
          closeModal();
          try { console.log('[wjp-assets] removed ' + toRemove.length + ' Plaid-linked asset(s)'); } catch (_) {}
          return;
        }
        listLinkedAccounts().then(function (linkedList) {
          var added = 0;
          toAdd.forEach(function (id) {
            var linked = linkedList.find(function (a) { return a.plaidAccountId === id; });
            if (!linked) return;
            commitAsset({
              name: linked.name,
              value: linked.balance,
              type: /invest|broker|retire|401|ira|roth|529|hsa/i.test((linked.subtype || '') + ' ' + (linked.type || '') + ' ' + linked.name) ? 'investment' : 'cash',
              plaidAccountId: linked.plaidAccountId,
              institutionName: linked.institutionName || '',
              notes: ''
            });
            added++;
          });
          closeModal();
          try { console.log('[wjp-assets] sync: added ' + added + ', removed ' + toRemove.length); } catch (_) {}
        });
        return;
      } else {
        var data = readForm();
        if (!data.name) { document.querySelector('#wjp-asset-form [name="name"]').focus(); return; }
        commitAsset(data);
      }
      closeModal();
    });
    bg.querySelector('#am-open-sync').addEventListener('click', function () {
      var btn = Array.from(document.querySelectorAll('button,a,[role="button"]'))
        .find(function (e) { return /Sync Bank/i.test(e.textContent || ''); });
      if (btn) { closeModal(); setTimeout(function () { btn.click(); }, 80); }
      else { alert('Sync Bank button not found. Open Bank Health from the sidebar to link a new account.'); }
    });
  }
  function commitAsset(data) {
    var list = getAssets().slice();
    if (editingId) {
      var idx = list.findIndex(function (a) { return a.id === editingId; });
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], data, { updatedAt: new Date().toISOString() });
    } else {
      list.push(Object.assign({
        id: uuid(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, data));
    }
    setAssets(list);
    renderAllMounts();
  }
  function deleteAsset(id) {
    if (!confirm('Remove this asset?')) return;
    setAssets(getAssets().filter(function (a) { return a.id !== id; }));
    renderAllMounts();
  }

  // ---------- mount as a first-class reorderable dashboard card ----------
  function ensureCard(pageId, cardId, sizeDefault) {
    var page = document.getElementById(pageId);
    if (!page) return null;
    var card = document.getElementById(cardId);
    if (card) return card;

    card = document.createElement('div');
    card.id = cardId;
    card.className = 'card reveal reorderable';
    card.setAttribute('data-card-id', CARD_SLUG);
    card.setAttribute('data-card-label', CARD_LABEL);

    // Read saved size from prefs, fall back to default
    var savedSize = sizeDefault;
    try {
      var s = getAppState();
      if (s && s.prefs && s.prefs.cardSize && s.prefs.cardSize[CARD_SLUG]) {
        savedSize = s.prefs.cardSize[CARD_SLUG];
      }
    } catch (_) {}
    card.setAttribute('data-size', savedSize);

    card.innerHTML = buildBodyHTML();
    page.appendChild(card);
    wireCardEvents(card);

    // Refresh sizing via the host's helper if available
    try { if (typeof window.applyCardSizes === 'function') window.applyCardSizes(); } catch (_) {}
    try { if (typeof window.injectCardControls === 'function') window.injectCardControls(card); } catch (_) {}
    return card;
  }
  function refreshCard(card) {
    if (!card) return;
    // Preserve any controls the customize system injected; only refresh body
    var existing = card.querySelector('.wjp-assets-body');
    if (existing) {
      existing.outerHTML = buildBodyHTML();
    } else {
      card.insertAdjacentHTML('afterbegin', buildBodyHTML());
    }
  }
  function wireCardEvents(card) {
    if (card.__wjpAssetsWired) return;
    card.__wjpAssetsWired = true;
    card.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.closest && t.closest('[data-action="add-asset"]')) { openModal(null); return; }
      var editBtn = t.closest && t.closest('.ac-edit');
      if (editBtn) { openModal(editBtn.dataset.assetId); return; }
      var delBtn = t.closest && t.closest('.ac-del');
      if (delBtn) { deleteAsset(delBtn.dataset.assetId); return; }
    });
  }
  function renderAllMounts() {
    ensureStyles();
    var dash  = ensureCard('page-dashboard', DASH_CARD_ID,  'medium');
    var debts = ensureDebtsCard();  // special: insert inside Overview sub-tab, not at bottom of page-debts
    refreshCard(dash);
    refreshCard(debts);
  }

  // Mount the Assets card INSIDE the Debts → Overview sub-tab, right after the
  // 'WHAT YOU STILL OWE' hero. Previous version used ensureCard with
  // appendChild(#page-debts), which put the card OUTSIDE the sub-tab system
  // — visible at the bottom of every sub-tab (Overview, Transactions,
  // Recurring, Analysis, etc.). Now it lives inside Overview only.
  function ensureDebtsCard() {
    var page = document.getElementById('page-debts');
    if (!page) return null;
    // The Overview sub-tab is the FIRST .debts-subtab-content child of #page-debts.
    var overview = page.querySelector(':scope > .debts-subtab-content');
    if (!overview) return null;
    var hero = overview.querySelector('.debts-header-card');

    var card = document.getElementById(DEBTS_CARD_ID);
    // If the existing card is in the wrong place (e.g. directly on #page-debts
    // from a previous version), pull it out so we can re-insert it correctly.
    if (card && card.parentElement !== overview) {
      try { card.parentElement.removeChild(card); } catch (_) {}
      card = null;
    }

    // Find Debit balances card (currently the 2nd item) — we want to land
    // BEFORE it so the Assets card becomes the 2nd box.
    var debitBalancesAnchor = null;
    try {
      var debitHdr = Array.from(overview.querySelectorAll('h2, h3, .card-title, [class*="title"], [class*="header"]'))
        .find(function (el) { return /Debit balances/i.test(el.textContent || ''); });
      if (debitHdr) {
        // Walk up to the nearest direct-child of overview
        var n = debitHdr;
        while (n && n.parentElement && n.parentElement !== overview) n = n.parentElement;
        if (n && n.parentElement === overview) debitBalancesAnchor = n;
      }
    } catch (_) {}

    function placeCard() {
      if (debitBalancesAnchor && debitBalancesAnchor.parentElement === overview) {
        // Insert right before Debit balances (= 2nd box, right after hero)
        overview.insertBefore(card, debitBalancesAnchor);
      } else if (hero && hero.parentElement === overview) {
        // Fallback: just after hero
        hero.insertAdjacentElement('afterend', card);
      } else {
        // Last resort: at the top of overview
        overview.insertBefore(card, overview.firstChild);
      }
    }

    if (!card) {
      card = document.createElement('div');
      card.id = DEBTS_CARD_ID;
      card.className = 'card reveal reorderable';
      card.setAttribute('data-card-id', CARD_SLUG);
      card.setAttribute('data-card-label', CARD_LABEL);
      var savedSize = 'medium';
      try {
        var s = getAppState();
        if (s && s.prefs && s.prefs.cardSize && s.prefs.cardSize[CARD_SLUG]) {
          savedSize = s.prefs.cardSize[CARD_SLUG];
        }
      } catch (_) {}
      card.setAttribute('data-size', savedSize);
      card.style.marginTop = '16px';
      card.innerHTML = buildBodyHTML();
      placeCard();
      wireCardEvents(card);
    } else {
      // Card exists — check position. If not directly before Debit balances
      // (or after hero when no Debit balances), reposition.
      var desiredAnchor = debitBalancesAnchor || (hero && hero.nextElementSibling === card ? null : hero);
      if (debitBalancesAnchor && card.nextElementSibling !== debitBalancesAnchor) {
        placeCard();
      } else if (!debitBalancesAnchor && hero && card.previousElementSibling !== hero) {
        placeCard();
      }
    }
    try { if (typeof window.applyCardSizes === 'function') window.applyCardSizes(); } catch (_) {}
    return card;
  }

  // ---------- observer: re-mount when host re-renders the page ----------
  // Scoped to body but coalesced + we re-render only if our cards vanish
  // (cheap check), to avoid the recursion issue called out in memory.
  var obs = null;
  function startObserver() {
    if (obs) return;
    obs = new MutationObserver(function () {
      if (startObserver._raf) return;
      startObserver._raf = requestAnimationFrame(function () {
        startObserver._raf = null;
        var needsDash  = document.getElementById('page-dashboard') && !document.getElementById(DASH_CARD_ID);
        var needsDebts = document.getElementById('page-debts')     && !document.getElementById(DEBTS_CARD_ID);
        if (needsDash || needsDebts) {
          if (obs) obs.disconnect();
          try { renderAllMounts(); } catch (_) {}
          if (obs) obs.observe(document.body, { childList: true, subtree: true });
        }
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- boot ----------
  function boot() {
    ensureStyles();
    renderAllMounts();
    startObserver();
    window.addEventListener('wjp-assets-changed', renderAllMounts);
    window.addEventListener('wjp-auth-ready', function () {
      renderAllMounts();
      fetchAccountsLive(true).then(function () { repairAssetBalances().then(renderAllMounts); });
    });
    // Auth might already be ready, or about to be — retry quickly so the
    // dropdown isn't stuck on "Loading…" if the user opens the modal early.
    (function retryUntilReady() {
      var attempts = 0;
      function tick() {
        attempts++;
        if (window.__wjpAuth && window.__wjpAuth.currentUser) {
          fetchAccountsLive(true).then(function () {
            repairAssetBalances().then(renderAllMounts);
          });
          return;
        }
        if (attempts < 20) setTimeout(tick, 250); // up to 5s of polling
      }
      tick();
    })();
    setInterval(function () {
      fetchAccountsLive(true).then(function () { repairAssetBalances().then(renderAllMounts); });
    }, 300000);
    // Lightweight dirty-checking re-render so totals stay current when debts change.
    setInterval(function () {
      var s = getAppState();
      var sig = JSON.stringify({
        a: (s && s.assets) ? s.assets.map(function (a) { return [a.id, a.value, a.name, a.type]; }) : [],
        d: (s && s.debts)  ? s.debts.reduce(function (n,d){ return n + (Number(d.balance)||0); }, 0) : 0
      });
      if (sig !== boot._lastSig) {
        boot._lastSig = sig;
        var card1 = document.getElementById(DASH_CARD_ID);
        var card2 = document.getElementById(DEBTS_CARD_ID);
        refreshCard(card1);
        refreshCard(card2);
      }
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ---------- public API ----------
  window.WJP_Assets = {
    list: getAssets,
    add: function (data) { commitAsset(data); },
    remove: deleteAsset,
    openAddModal: function () { openModal(null); },
    totalAssets: totalAssets,
    netWorth: netWorth,
    refreshLive: function () { return fetchAccountsLive(true); },
    repairBalances: repairAssetBalances,
    debugCache: function () { return { items: _acctCache.items, ts: _acctCache.ts, inflight: !!_acctCache.inflight }; },
    listLinked: listLinkedAccounts,
    version: 7
  };
})();
