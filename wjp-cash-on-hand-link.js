/* wjp-cash-on-hand-link.js v1 — Link the "Cash on hand" tile in the Last
 * 7 Days hero (#wjp-momentum-hero) to live bank balances.
 *
 * Winston 2026-05-29: "last 7 days box cash on hand should be linked with
 *   total bank balances or allowed to select one particular account"
 *
 * Behavior:
 *   - DEFAULT: tile shows the sum of all linked checking + savings
 *     account balances (appState.linkedAssets, filtered by liquid types).
 *   - SELECTED: if the user picked one specific account from the picker,
 *     the tile shows just that account's balance.
 *   - Click the tile → small popover lists "All liquid accounts (sum)"
 *     plus every individual checking/savings account. Click one to
 *     persist the choice. Persisted to prefs.cashOnHandAccountId
 *     (null = sum-all).
 *   - Updates live on appState changes (data-restored, plaid-sync-done,
 *     allocation changes) without needing a page reload.
 *
 * Safe: IIFE, idempotent install, bare appState access via try/catch.
 * No hardcoded user data; works for every account. Per-user via cloud-
 * synced prefs.
 */
(function () {
  'use strict';
  if (window._wjpCashOnHandLinkInstalled) return;
  window._wjpCashOnHandLinkInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }
  function saveState() { try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {} }

  function fmtUsd(n) {
    n = Number(n) || 0;
    var abs = Math.abs(n);
    var s = '$' + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '-' + s : s;
  }

  // ────────── data ──────────
  // What counts as "liquid" — checking, savings, money market, cash management.
  // Intentionally excludes investment, 401k, IRA, loan, credit card.
  var LIQUID_TYPES = { 'checking': 1, 'savings': 1, 'cash management': 1, 'money market': 1 };
  function isLiquid(a) {
    if (!a) return false;
    var sub = String(a.subtype || a.type || '').toLowerCase();
    if (LIQUID_TYPES[sub]) return true;
    if (sub === 'depository' && (Number(a.balance) || 0) >= 0) return true;
    return false;
  }
  // Normalize an account row to { id, name, mask, subtype, balance } regardless of source
  function normAcct(a) {
    if (!a) return null;
    var id = a.id || a.account_id || a.plaidAccountId || a.plaid_id || '';
    var balance = a.balance;
    if (balance == null && a.balances) balance = (a.balances.available != null ? a.balances.available : a.balances.current);
    return {
      id: String(id || ''),
      name: a.name || a.official_name || 'Account',
      mask: a.mask || '',
      subtype: a.subtype || a.type || '',
      balance: Number(balance) || 0
    };
  }
  // Liquid accounts cached for synchronous reads (the source API is async).
  // We refresh on the standard data-restored / sync-done events.
  var _liquidCache = [];
  function refreshLiquid() {
    try {
      if (window.WJP_DebtsEnhance && typeof window.WJP_DebtsEnhance.getDebitAccounts === 'function') {
        Promise.resolve(window.WJP_DebtsEnhance.getDebitAccounts()).then(function (arr) {
          if (!Array.isArray(arr)) return;
          var s = getState();
          var hidden = (s && Array.isArray(s.hiddenPlaidAccounts)) ? s.hiddenPlaidAccounts : [];
          _liquidCache = arr
            .map(normAcct)
            .filter(function (a) { return a && isLiquid(a) && hidden.indexOf(a.id) === -1; });
          paint();
        }, function () {});
      }
    } catch (_) {}
  }
  function getLiquidAccounts() {
    if (_liquidCache.length) return _liquidCache;
    // Fallback to appState.linkedAssets when DebtsEnhance hasn't populated yet
    var s = getState();
    var arr = (s && Array.isArray(s.linkedAssets)) ? s.linkedAssets : [];
    var hidden = (s && Array.isArray(s.hiddenPlaidAccounts)) ? s.hiddenPlaidAccounts : [];
    return arr.map(normAcct).filter(function (a) { return a && isLiquid(a) && hidden.indexOf(a.id) === -1; });
  }
  function getSelectedAccountId() {
    var s = getState();
    var v = s && s.prefs && s.prefs.cashOnHandAccountId;
    return (typeof v === 'string' && v) ? v : null;
  }
  function setSelectedAccountId(id) {
    var s = getState();
    if (!s) return;
    if (!s.prefs) s.prefs = {};
    if (id == null) delete s.prefs.cashOnHandAccountId;
    else s.prefs.cashOnHandAccountId = id;
    saveState();
  }
  function computeCash() {
    var accts = getLiquidAccounts();
    var selId = getSelectedAccountId();
    if (selId) {
      var hit = accts.find(function (a) { return a.id === selId; });
      if (hit) {
        return { amount: Number(hit.balance) || 0, label: (hit.name || 'Account'), count: 1, mode: 'one' };
      }
      // selection no longer exists → fall through to all
    }
    var sum = accts.reduce(function (a, x) { return a + (Number(x.balance) || 0); }, 0);
    return { amount: sum, label: accts.length ? (accts.length + (accts.length === 1 ? ' account' : ' accounts')) : 'no accounts', count: accts.length, mode: 'all' };
  }

  // ────────── styles ──────────
  function injectStyle() {
    if (document.getElementById('wjp-cash-on-hand-link-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-cash-on-hand-link-style';
    st.textContent = [
      '#wjp-cash-picker-pop { position:fixed; z-index:99999; background:var(--card-bg, #fff); color:var(--ink, var(--text-1, #0a0a0a)); border:1px solid var(--border, rgba(0,0,0,0.10)); border-radius:12px; box-shadow:0 24px 60px rgba(20,30,25,0.18); padding:8px; min-width:280px; max-width:360px; max-height:60vh; overflow-y:auto; font-family:inherit; font-size:13px; }',
      'body.dark #wjp-cash-picker-pop { background:#1a2533; color:#e7e7ea; border-color:rgba(255,255,255,0.10); box-shadow:0 24px 60px rgba(0,0,0,0.55); }',
      '#wjp-cash-picker-pop .wjp-cph-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:9px 11px; border-radius:8px; cursor:pointer; transition:background .12s ease; }',
      '#wjp-cash-picker-pop .wjp-cph-row:hover { background:rgba(31,122,74,0.07); }',
      'body.dark #wjp-cash-picker-pop .wjp-cph-row:hover { background:rgba(127,209,164,0.10); }',
      '#wjp-cash-picker-pop .wjp-cph-row.active { background:rgba(31,122,74,0.12); font-weight:700; }',
      'body.dark #wjp-cash-picker-pop .wjp-cph-row.active { background:rgba(127,209,164,0.15); }',
      '#wjp-cash-picker-pop .wjp-cph-name { font-size:12.5px; font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '#wjp-cash-picker-pop .wjp-cph-sub { font-size:10.5px; color:var(--ink-dim, #6b7280); margin-top:2px; }',
      '#wjp-cash-picker-pop .wjp-cph-amt { font-size:12.5px; font-weight:800; color:#1f7a4a; }',
      'body.dark #wjp-cash-picker-pop .wjp-cph-amt { color:#7fd1a4; }',
      '#wjp-cash-picker-pop .wjp-cph-header { font-size:10px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-dim, #6b7280); padding:8px 11px 4px; }',
      '#wjp-cash-picker-pop .wjp-cph-divider { height:1px; background:var(--border, rgba(0,0,0,0.07)); margin:4px 0; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── DOM hookup ──────────
  // Find the "Cash on hand" tile inside #wjp-momentum-hero. Walks up to the
  // nearest reasonable tile container and locates the value + sub elements.
  function findTile() {
    var hero = document.getElementById('wjp-momentum-hero');
    if (!hero) return null;
    var iter = document.createNodeIterator(hero, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = iter.nextNode())) {
      var t = (n.textContent || '').trim();
      if (/^cash on hand$/i.test(t)) {
        // The tile is the parent stat container. Walk up to find a wrapper
        // that contains both the label and a value-ish sibling.
        var labelEl = n.parentElement;
        if (!labelEl) continue;
        // Try walking up siblings: typically tile is grandparent.
        var tile = labelEl.parentElement || labelEl;
        // Confirm tile has more than just the label
        if (tile && tile.children.length >= 1) return { tile: tile, labelEl: labelEl };
      }
    }
    return null;
  }

  // Find the "value" element ($0) and "sub" element ($0 · tap to set) within tile
  function findValueSubElements(tile) {
    if (!tile) return { valEl: null, subEl: null };
    var valEl = null, subEl = null;
    // Walk all descendants, picking biggest font-weight numeric-looking element as val,
    // and the first text containing "tap to set" or " · " as sub.
    var all = Array.from(tile.querySelectorAll('*'));
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var txt = (el.textContent || '').trim();
      if (!txt) continue;
      if (!valEl && /^\$[\d,]+(?:\.\d{1,2})?$/.test(txt) && el.children.length === 0) valEl = el;
      if (!subEl && /tap to set|· tap|·\s/i.test(txt) && el.children.length === 0) subEl = el;
    }
    return { valEl: valEl, subEl: subEl };
  }

  // ────────── render ──────────
  // Track whether we've ever successfully painted real (non-zero) data.
  // Once we have, we never revert to "$0 no accounts" — we wait for real data
  // (no flashing).
  var _haveRealData = false;
  function paint() {
    var found = findTile();
    if (!found) return false;
    var tile = found.tile;
    var info = computeCash();

    // Stability rule: if we've never shown real data yet AND there are no
    // accounts to show, DON'T paint — leave the existing tile content alone
    // (the original "$0 · tap to set" or "—") until real data arrives.
    if (!_haveRealData && info.count === 0) {
      // Still wire the click handler so the user can open the picker
      if (!tile.dataset.wjpCohWired) {
        tile.dataset.wjpCohWired = '1';
        tile.style.cursor = 'pointer';
        tile.title = 'Cash on Hand source — click to pick an account';
        tile.addEventListener('click', function (e) {
          if (e.target.closest('button, input, select, a')) return;
          e.preventDefault();
          e.stopPropagation();
          openPicker(tile);
        });
      }
      return false;
    }
    var refs = findValueSubElements(tile);
    var valEl = refs.valEl;
    var subEl = refs.subEl;
    if (valEl) {
      valEl.textContent = '$' + Math.round(info.amount).toLocaleString();
      valEl.dataset.wjpCohOwned = '1';
    }
    if (subEl) {
      var labelTxt = info.mode === 'one'
        ? info.label + ' · click to change'
        : info.label + ' · click to focus one';
      subEl.textContent = labelTxt;
      subEl.dataset.wjpCohOwned = '1';
    }
    if (info.count > 0) _haveRealData = true;
    if (!tile.dataset.wjpCohWired) {
      tile.dataset.wjpCohWired = '1';
      tile.style.cursor = 'pointer';
      tile.title = 'Cash on Hand source — click to pick an account';
      tile.addEventListener('click', function (e) {
        if (e.target.closest('button, input, select, a')) return;
        e.preventDefault();
        e.stopPropagation();
        openPicker(tile);
      });
    }
    return true;
  }

  // ────────── picker popover ──────────
  function closePicker() {
    var pop = document.getElementById('wjp-cash-picker-pop');
    if (pop) try { pop.remove(); } catch (_) {}
    document.removeEventListener('click', outsideClick, true);
  }
  function outsideClick(e) {
    var pop = document.getElementById('wjp-cash-picker-pop');
    if (!pop) return;
    if (!pop.contains(e.target)) closePicker();
  }
  function openPicker(anchorTile) {
    closePicker();
    var pop = document.createElement('div');
    pop.id = 'wjp-cash-picker-pop';
    var accts = getLiquidAccounts();
    var selId = getSelectedAccountId();
    var sum = accts.reduce(function (a, x) { return a + (Number(x.balance) || 0); }, 0);
    pop.innerHTML =
      '<div class="wjp-cph-header">Cash on hand source</div>' +
      '<div class="wjp-cph-row' + (selId ? '' : ' active') + '" data-acct="">' +
        '<div>' +
          '<div class="wjp-cph-name">All liquid accounts</div>' +
          '<div class="wjp-cph-sub">' + (accts.length === 1 ? '1 account' : accts.length + ' accounts') + ' · sum</div>' +
        '</div>' +
        '<div class="wjp-cph-amt">$' + Math.round(sum).toLocaleString() + '</div>' +
      '</div>' +
      (accts.length ? '<div class="wjp-cph-divider"></div>' : '') +
      accts.map(function (a) {
        var amt = Number(a.balance) || 0;
        var nm = (a.name || 'Account').replace(/[<>"&]/g, '');
        var mask = a.mask ? ' · ••••' + a.mask : '';
        var sub = String(a.subtype || a.type || 'account');
        return '<div class="wjp-cph-row' + (selId === a.id ? ' active' : '') + '" data-acct="' + (a.id || '') + '">' +
          '<div style="min-width:0;">' +
            '<div class="wjp-cph-name">' + nm + '</div>' +
            '<div class="wjp-cph-sub">' + sub + mask + '</div>' +
          '</div>' +
          '<div class="wjp-cph-amt">$' + Math.round(amt).toLocaleString() + '</div>' +
        '</div>';
      }).join('');
    document.body.appendChild(pop);
    // Position next to tile
    var r = anchorTile.getBoundingClientRect();
    var pop_w = Math.min(360, Math.max(280, r.width));
    var left = Math.max(10, Math.min(window.innerWidth - pop_w - 10, r.left));
    var top = r.bottom + 8;
    if (top + 320 > window.innerHeight) top = Math.max(10, r.top - 320);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    // Wire row clicks
    pop.querySelectorAll('.wjp-cph-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var aid = row.getAttribute('data-acct') || '';
        setSelectedAccountId(aid ? aid : null);
        closePicker();
        paint();
      });
    });
    // Outside-click to close
    setTimeout(function () { document.addEventListener('click', outsideClick, true); }, 0);
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    refreshLiquid();
    function tick() {
      paint();
      refreshLiquid();
      setTimeout(tick, 5000);
    }
    setTimeout(tick, 400);
    function repaintSoon() { refreshLiquid(); setTimeout(paint, 200); setTimeout(paint, 800); setTimeout(paint, 2000); }
    window.addEventListener('wjp-data-restored', repaintSoon);
    window.addEventListener('wjp-plaid-sync-done', repaintSoon);
    window.addEventListener('wjp-allocation-changed', repaintSoon);
    window.addEventListener('wjp-balances-changed', repaintSoon);
    window.addEventListener('wjp-bank-hidden-changed', repaintSoon);
    setTimeout(refreshLiquid, 2000);
    setTimeout(refreshLiquid, 6000);
    try {
      var observe = function () {
        var hero = document.getElementById('wjp-momentum-hero');
        if (!hero) return false;
        var mo = new MutationObserver(function () { setTimeout(paint, 100); });
        mo.observe(hero, { childList: true, subtree: true });
        return true;
      };
      if (!observe()) {
        var iv = setInterval(function(){ if (observe()) clearInterval(iv); }, 800);
        setTimeout(function(){ clearInterval(iv); }, 30000);
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WJP_CashOnHandLink = {
    version: 4,
    paint: paint,
    computeCash: computeCash,
    getSelectedAccountId: getSelectedAccountId,
    setSelectedAccountId: setSelectedAccountId
  };
})();
