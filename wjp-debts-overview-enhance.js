/* wjp-debts-overview-enhance.js v2 — Debits Balance Box + Card Insights Expand
 *
 * Adds two enhancements to the Debts tab:
 *   1) DEBIT BALANCES — a new card at the top of the Debts page listing every
 *      depository account (checking / savings / money market / CD) pulled from
 *      Plaid via /get-accounts. Each row shows institution + account name +
 *      live balance. Account display names are editable inline (stored at
 *      users/{uid}/account_overrides/{account_id} with displayName).
 *
 *   2) CARD INSIGHTS — adds an "💡 Insights" expand button to each card in the
 *      "Current Obligations" grid. Clicking opens an inline panel below the
 *      card with: utilization analysis vs ideal thresholds, optimal pay-by
 *      date (based on statement close + grace), APR cost-per-month estimate,
 *      and ranked improvement tips.
 *
 * Dark mode aware (cascading vars per the permanent rule).
 * Does NOT touch Sync Bank flow or Plaid Link (per the other permanent rule).
 * Lives on Debts page only; cleans up when user navigates away.
 */
(function () {
  'use strict';
  if (window._wjpDebtsEnhanceInstalled) return;
  window._wjpDebtsEnhanceInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  // ===========================================================================
  // Common helpers
  // ===========================================================================
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

  async function getCurrentUid() {
    try {
      if (window.firebase && window.firebase.auth) {
        var u = window.firebase.auth().currentUser;
        if (u) return u.uid;
      }
      if (window.__wjpAuth && window.__wjpAuth.currentUser) {
        return window.__wjpAuth.currentUser.uid;
      }
    } catch (_) {}
    return null;
  }

  function firestore() {
    try {
      if (window.firebase && window.firebase.firestore) return window.firebase.firestore();
    } catch (_) {}
    return null;
  }

  function isOnDebts() {
    // Strict: only true when #page-debts has class "active" — avoids the
    // sidebar "Debts" label false-positive.
    var pageEl = document.getElementById('page-debts');
    if (pageEl && (pageEl.classList.contains('active') || pageEl.offsetParent !== null)) {
      return true;
    }
    var dataPage = document.querySelector('[data-page="debts"].active, [data-page="debts"]');
    if (dataPage && dataPage.offsetParent !== null) return true;
    return false;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtMoney(n, sign) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    var s = Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sign === 'force-pos') return '$' + s;
    return (n < 0 ? '-$' : '$') + s;
  }

  function fmtAge(ts) {
    if (!ts) return 'never';
    var ms = (typeof ts === 'object' && ts && ts.toMillis) ? ts.toMillis() : ts;
    if (typeof ms !== 'number') return 'unknown';
    var mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  function toast(msg, color) {
    try {
      var bg = color === 'red' ? '#c0594a' : color === 'amber' ? '#a16207' : '#1f7a4a';
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'z-index:99999;background:' + bg + ';color:#fff;padding:10px 16px;border-radius:10px;' +
        'font-weight:700;font-size:12.5px;font-family:inherit;box-shadow:0 8px 24px rgba(0,0,0,0.18);';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 3500);
    } catch (_) {}
  }

  // ===========================================================================
  // SECTION 1 — DEBIT BALANCES BOX
  // ===========================================================================
  var DEBIT_CARD_ID = 'wjp-debit-balances-card';
  var DEBIT_SUBTYPES = ['checking', 'savings', 'money market', 'cd', 'paypal', 'cash management', 'prepaid'];
  var _accountsCache = null;
  var _accountsCacheAt = 0;
  var _overridesCache = null;

  async function fetchAccounts(force) {
    var now = Date.now();
    if (!force && _accountsCache && (now - _accountsCacheAt) < 60000) return _accountsCache;
    var token = await getIdToken();
    if (!token) return null;
    try {
      var resp = await fetch('/.netlify/functions/get-accounts', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!resp.ok) return null;
      var data = await resp.json();
      _accountsCache = data.items || [];
      _accountsCacheAt = now;
      return _accountsCache;
    } catch (e) {
      console.warn('[wjp-debts-enhance] fetchAccounts failed:', e && e.message);
      return null;
    }
  }

  // Overrides storage: localStorage scoped by uid. Survives session reloads,
  // doesn't require Firestore client SDK access.
  function overridesKey(uid) { return 'wjp.account_overrides.uid_' + uid; }

  async function fetchOverrides() {
    if (_overridesCache) return _overridesCache;
    var uid = await getCurrentUid();
    if (!uid) return {};
    try {
      var raw = localStorage.getItem(overridesKey(uid));
      _overridesCache = raw ? JSON.parse(raw) : {};
    } catch (_) {
      _overridesCache = {};
    }
    return _overridesCache;
  }

  async function saveOverride(accountId, displayName) {
    var uid = await getCurrentUid();
    if (!uid) throw new Error('not signed in');
    var map = await fetchOverrides();
    if (displayName) {
      map[accountId] = { displayName: displayName, updatedAt: Date.now() };
    } else {
      delete map[accountId];
    }
    try {
      localStorage.setItem(overridesKey(uid), JSON.stringify(map));
    } catch (e) {
      throw new Error('storage full');
    }
    _overridesCache = map;
    // v2 (2026-05-26): dispatch event so wjp-acct-name-sync can propagate
    // the rename to the Transactions tab + anywhere else WJP_AcctLookup
    // is consumed.
    try {
      window.dispatchEvent(new CustomEvent('wjp-acct-renamed', { detail: { accountId: accountId, displayName: displayName } }));
    } catch (_) {}
  }

  function extractDebitAccounts(items, overrides) {
    var out = [];
    (items || []).forEach(function (it) {
      (it.accounts || []).forEach(function (a) {
        var subtype = (a.subtype || '').toLowerCase();
        var type = (a.type || '').toLowerCase();
        var isDepository = type === 'depository' || DEBIT_SUBTYPES.indexOf(subtype) !== -1;
        if (!isDepository) return;
        var override = overrides[a.account_id] || {};
        var rawBal = (a.balances && (a.balances.current != null ? a.balances.current : a.balances.available));
        out.push({
          accountId: a.account_id,
          itemId: it.itemId,
          institutionName: it.institutionName || 'Bank',
          plaidName: a.name || a.official_name || a.mask || 'Account',
          mask: a.mask || null,
          subtype: subtype || type || '',
          displayName: override.displayName || null,
          balance: typeof rawBal === 'number' ? rawBal : null,
          currency: (a.balances && a.balances.iso_currency_code) || 'USD',
          itemError: it.itemError || it.liveItemError || null,
          lastSyncAt: it.lastSyncAt || null
        });
      });
    });
    // Sort by balance desc (biggest first)
    out.sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); });
    return out;
  }

  function findDebtsHost() {
    // v3 (2026-05-26 FIX 36): strictly mount on the Overview subtab via
    // data-subtab attribute. Previously used '.active' which incorrectly
    // mounted Debit balances onto whichever subtab was currently active
    // (Recurring Payments, Analysis, etc).
    var overview = document.querySelector('.debts-subtab-content[data-subtab="overview"]');
    if (overview) return overview;
    // Legacy fallback for builds without data-subtab markup
    var subtab = document.querySelector('.debts-subtab-content.active');
    if (subtab && subtab.offsetParent !== null) return subtab;
    var pageEl = document.getElementById('page-debts');
    if (pageEl && pageEl.offsetParent !== null) return pageEl;
    return null;
  }

  // FIX 36 cleanup helper: remove any Debit balances card that ended up
  // mounted under a NON-overview subtab. Defensive — handles cards put
  // there by earlier builds before this patch shipped.
  function cleanupStrayDebitCards() {
    try {
      var cards = document.querySelectorAll('#' + (typeof DEBIT_CARD_ID !== 'undefined' ? DEBIT_CARD_ID : 'wjp-debit-balances-card'));
      cards.forEach(function (c) {
        var sub = c.closest('.debts-subtab-content');
        if (sub && sub.getAttribute('data-subtab') !== 'overview') {
          try { c.remove(); } catch (_) {}
        }
      });
    } catch (_) {}
  }
  // Run on boot and every 2s
  setTimeout(cleanupStrayDebitCards, 800);
  setInterval(cleanupStrayDebitCards, 2000);

  async function mountDebitBalances() {
    if (!isOnDebts()) {
      var old = document.getElementById(DEBIT_CARD_ID);
      if (old) try { old.remove(); } catch (_) {}
      return;
    }
    var host = findDebtsHost();
    if (!host) return;
    if (document.getElementById(DEBIT_CARD_ID)) return; // already mounted

    var card = document.createElement('div');
    card.id = DEBIT_CARD_ID;
    card.style.cssText =
      'background:var(--card-bg,var(--bg-2,#fff));color:var(--ink,var(--text-1,#0a0a0a));' +
      'border:1px solid var(--border,rgba(0,0,0,0.10));border-radius:14px;' +
      'padding:18px 22px;margin:14px 0 18px 0;font-family:inherit;font-size:13px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.04);';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">' +
        '<div>' +
          '<div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;color:var(--ink,var(--text-1,#0a0a0a));">Debit balances</div>' +
          '<div style="font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">Live checking, savings & cash accounts pulled from Plaid. Click a name to rename.</div>' +
        '</div>' +
        '<button type="button" id="wjp-debit-refresh" title="Refresh balances" ' +
          'style="background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));color:var(--ink,var(--text-1,#0a0a0a));' +
          'border-radius:8px;padding:6px 12px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m0 0a9 9 0 0 1 9-9m-9 9a9 9 0 0 0 9 9"/></svg>' +
          'Refresh' +
        '</button>' +
      '</div>' +
      '<div id="wjp-debit-list" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<div id="wjp-debit-total" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border,rgba(0,0,0,0.08));' +
        'display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
        '<span style="font-size:11.5px;color:var(--ink-dim,var(--text-2,#6b7280));text-transform:uppercase;letter-spacing:0.05em;">Total liquid</span>' +
        '<span class="wjp-dt-total-val" style="font-size:18px;font-weight:800;color:var(--ink,var(--text-1,#0a0a0a));">—</span>' +
      '</div>';

    // Insert AFTER the "What You Still Owe" hero card so the hero stays at
    // the top. Fall back to appending to host if hero not found.
    var hero = host.querySelector('.debts-header-card');
    if (hero && hero.parentNode === host) {
      if (hero.nextSibling) host.insertBefore(card, hero.nextSibling);
      else host.appendChild(card);
    } else if (host.firstChild) {
      host.insertBefore(card, host.firstChild);
    } else {
      host.appendChild(card);
    }

    var refresh = document.getElementById('wjp-debit-refresh');
    if (refresh) refresh.onclick = function () { renderDebitBalances(true); };

    renderDebitBalances(false);
  }

  function debitRowHtml(a) {
    var name = a.displayName || a.plaidName;
    var meta = a.institutionName + (a.mask ? ' · ····' + escapeHtml(a.mask) : '') + (a.subtype ? ' · ' + a.subtype : '');
    var bal = a.balance != null ? fmtMoney(a.balance, 'force-pos') : '—';
    var errBadge = a.itemError ? '<span style="color:#c0594a;font-weight:700;font-size:10px;">⚠ needs re-auth</span>' : '';
    return (
      '<div class="wjp-dt-row" data-account-id="' + escapeHtml(a.accountId) + '" ' +
        'style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg-3,rgba(0,0,0,0.02));border-radius:10px;">' +
        '<div style="width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#1f7a4a,#2b9b72);color:#fff;' +
          'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;">' +
          escapeHtml((name || '?').charAt(0).toUpperCase()) +
        '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="wjp-dt-name" title="Click to rename" ' +
            'style="font-weight:700;font-size:13.5px;color:var(--ink,var(--text-1,#0a0a0a));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">' +
            escapeHtml(name) +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;flex-shrink:0;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--ink-dim,var(--text-2,#6b7280));margin-top:2px;">' +
            escapeHtml(meta) + (errBadge ? ' · ' + errBadge : '') +
          '</div>' +
        '</div>' +
        '<div style="font-size:14.5px;font-weight:800;color:var(--ink,var(--text-1,#0a0a0a));font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0;">' + bal + '</div>' +
      '</div>'
    );
  }

  async function renderDebitBalances(force) {
    var list = document.getElementById('wjp-debit-list');
    var totalEl = document.querySelector('#wjp-debit-total .wjp-dt-total-val');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:18px 0;color:var(--ink-dim,var(--text-2,#6b7280));font-size:12px;">Loading…</div>';

    var items = await fetchAccounts(force);
    if (items == null) {
      list.innerHTML = '<div style="text-align:center;padding:18px 0;color:var(--ink-dim,var(--text-2,#6b7280));font-size:12px;">Sign in to view debit balances.</div>';
      return;
    }
    var overrides = await fetchOverrides();
    var debits = extractDebitAccounts(items, overrides);

    if (!debits.length) {
      list.innerHTML = '<div style="text-align:center;padding:18px 0;color:var(--ink-dim,var(--text-2,#6b7280));font-size:12px;">No checking or savings accounts linked yet. Use <strong>Sync Bank</strong> in the top nav to add one.</div>';
      if (totalEl) totalEl.textContent = '—';
      return;
    }

    list.innerHTML = debits.map(debitRowHtml).join('');
    var total = debits.reduce(function (s, a) { return s + (a.balance || 0); }, 0);
    if (totalEl) totalEl.textContent = fmtMoney(total, 'force-pos');

    // Wire up rename-on-click
    Array.prototype.forEach.call(list.querySelectorAll('.wjp-dt-row'), function (row) {
      var accountId = row.getAttribute('data-account-id');
      var nameEl = row.querySelector('.wjp-dt-name');
      if (!nameEl) return;
      nameEl.onclick = async function () {
        var current = nameEl.textContent;
        var v = prompt('Rename this account (e.g. "Bills checking"):', current);
        if (v == null) return;
        v = (v || '').trim();
        try {
          await saveOverride(accountId, v);
          toast('Renamed', 'green');
          renderDebitBalances(false); // re-render with new override
        } catch (e) {
          toast('Rename failed: ' + (e.message || 'error'), 'red');
        }
      };
    });
  }

  // ===========================================================================
  // SECTION 2 — CARD INSIGHTS EXPANDABLE
  // ===========================================================================
  // For each "Current Obligations" card, add an "Insights" button. Click =
  // expand a panel below with utilization analysis, optimal pay-by, APR cost,
  // and ranked improvement tips. Data sourced from the card's own DOM data
  // attributes (already populated by app.js) + computed locally.

  var CARD_INSIGHT_ATTR = 'data-wjp-insight-attached';

  function findObligationCards() {
    // Heuristic: look for elements that contain BOTH "Managed Liability" text
    // AND a "UTILIZATION" label — those are the Current Obligations cards.
    var candidates = document.querySelectorAll('div, article, section');
    var hits = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.children.length < 3 || el.children.length > 30) continue;
      var txt = el.innerText || '';
      if (txt.length < 80 || txt.length > 2000) continue;
      if (txt.indexOf('Managed Liability') === -1) continue;
      if (txt.indexOf('UTILIZATION') === -1 && txt.indexOf('utilization') === -1) continue;
      hits.push(el);
    }
    // Dedup nested ancestors — keep the smallest matching container
    var minimal = hits.filter(function (el) {
      for (var i = 0; i < hits.length; i++) {
        if (hits[i] !== el && el.contains(hits[i])) return false;
      }
      return true;
    });
    return minimal;
  }

  // Parse a card's existing DOM for the data points we need.
  function parseCardData(card) {
    var data = { balance: null, apr: null, minPayment: null, utilization: null, name: null };
    var txt = card.innerText || '';
    try {
      // Card name — typically the largest text immediately before "Managed Liability"
      var nameMatch = txt.match(/^([\s\S]+?)\s*Managed Liability/);
      if (nameMatch) data.name = nameMatch[1].trim().split('\n').pop();
      // Balance
      var balMatch = txt.match(/BALANCE\s*\n?\s*\$?([\d,]+\.\d{2})/i);
      if (balMatch) data.balance = parseFloat(balMatch[1].replace(/,/g, ''));
      // APR
      var aprMatch = txt.match(/APR\s*\n?\s*([\d.]+)\s*%/i);
      if (aprMatch) data.apr = parseFloat(aprMatch[1]);
      // Min payment
      var minMatch = txt.match(/MIN\.\s*PAYMENT\s*\n?\s*\$?([\d,]+\.?\d*)/i);
      if (minMatch) data.minPayment = parseFloat(minMatch[1].replace(/,/g, ''));
      // Utilization
      var utilMatch = txt.match(/UTILIZATION\s*\n?\s*(\d+)\s*%/i);
      if (utilMatch) data.utilization = parseInt(utilMatch[1], 10);
    } catch (_) {}
    return data;
  }

  function computeInsights(d) {
    var tips = [];
    var aprMonthly = d.apr && d.balance ? (d.balance * (d.apr / 100) / 12) : null;

    // Utilization advice
    if (d.utilization != null) {
      if (d.utilization >= 90) {
        tips.push({sev: 'high', text: 'Utilization is at ' + d.utilization + '% — this is the biggest drag on your credit score. Target < 30% first, then < 10%.'});
      } else if (d.utilization >= 50) {
        tips.push({sev: 'high', text: 'Utilization is at ' + d.utilization + '% — paying this card down to under 30% gives you the biggest score lift this month.'});
      } else if (d.utilization >= 30) {
        tips.push({sev: 'med', text: 'Utilization at ' + d.utilization + '% is OK but not great. Target under 30% on all cards, under 10% on at least one.'});
      } else if (d.utilization >= 10) {
        tips.push({sev: 'low', text: 'Utilization at ' + d.utilization + '% is healthy. Pushing it under 10% would unlock the next score tier.'});
      } else {
        tips.push({sev: 'ok', text: 'Utilization at ' + d.utilization + '% is in the optimal zone (< 10%) for credit-score impact. Keep this up.'});
      }
    }

    // APR cost insight
    if (aprMonthly && aprMonthly > 5) {
      tips.push({sev: 'med', text: 'At ' + d.apr + '% APR, this card is costing you about ' + fmtMoney(aprMonthly, 'force-pos') + '/mo in interest. Every $100 of extra principal payment saves about $' + ((d.apr / 12) / 100 * 100).toFixed(2) + '/mo going forward.'});
    }

    // Min payment context
    if (d.minPayment && d.balance && d.apr) {
      // Rough payoff with min only
      var r = d.apr / 100 / 12;
      var balance = d.balance;
      var months = 0;
      while (balance > 0 && months < 600) {
        var interest = balance * r;
        var principal = Math.max(0, d.minPayment - interest);
        if (principal <= 0) { months = 999; break; }
        balance -= principal;
        months++;
      }
      if (months >= 999) {
        tips.push({sev: 'high', text: 'At the minimum payment of ' + fmtMoney(d.minPayment, 'force-pos') + ', this card will never pay off (interest accrues faster than principal). Pay at least 2x the minimum.'});
      } else if (months > 60) {
        var yrs = Math.floor(months / 12), mos = months % 12;
        tips.push({sev: 'high', text: 'At the minimum payment, this card takes about ' + yrs + 'y ' + mos + 'm to pay off. Doubling the payment typically cuts this by half or more.'});
      }
    }

    // APR comparison
    if (d.apr) {
      if (d.apr >= 25) {
        tips.push({sev: 'med', text: 'APR of ' + d.apr + '% is above average. Worth calling your issuer to ask for a rate reduction — script: "I\'ve been a good customer, what\'s the best APR you can offer?"'});
      } else if (d.apr >= 18) {
        tips.push({sev: 'low', text: 'APR of ' + d.apr + '% is typical for unsecured cards. A balance transfer to a 0% intro card could save serious interest if your credit qualifies.'});
      }
    }

    if (!tips.length) {
      tips.push({sev: 'ok', text: 'This card is in good shape. Keep utilization low and pay on time.'});
    }
    return { tips: tips, aprMonthly: aprMonthly };
  }

  function sevColor(sev) {
    return sev === 'high' ? '#c0594a' : sev === 'med' ? '#a16207' : sev === 'low' ? '#1f7a4a' : '#1f7a4a';
  }
  function sevBg(sev) {
    return sev === 'high' ? 'rgba(192,89,74,0.08)' :
           sev === 'med'  ? 'rgba(161,98,7,0.08)'  :
           sev === 'low'  ? 'rgba(31,122,74,0.08)' : 'rgba(31,122,74,0.08)';
  }

  function buildInsightsPanel(card, data) {
    var ins = computeInsights(data);
    var html =
      '<div class="wjp-card-insights-panel" style="margin-top:12px;padding:14px 16px;' +
        'background:var(--bg-3,rgba(0,0,0,0.03));border:1px solid var(--border,rgba(0,0,0,0.10));' +
        'border-radius:10px;font-family:inherit;">' +
        '<div style="font-size:11.5px;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-dim,var(--text-2,#6b7280));font-weight:700;margin-bottom:10px;">' +
          'Insights for ' + escapeHtml(data.name || 'this card') +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          ins.tips.map(function (t) {
            return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:' + sevBg(t.sev) + ';border-left:3px solid ' + sevColor(t.sev) + ';border-radius:6px;">' +
              '<span style="font-size:14px;line-height:1;flex-shrink:0;color:' + sevColor(t.sev) + ';font-weight:800;">' +
                (t.sev === 'high' ? '⚠' : t.sev === 'med' ? '!' : t.sev === 'ok' ? '✓' : '•') +
              '</span>' +
              '<span style="font-size:12.5px;line-height:1.45;color:var(--ink,var(--text-1,#0a0a0a));">' + escapeHtml(t.text) + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    return html;
  }

  function attachInsightsToCards() {
    if (!isOnDebts()) return;
    var cards = findObligationCards();
    cards.forEach(function (card) {
      if (card.getAttribute(CARD_INSIGHT_ATTR)) return;
      card.setAttribute(CARD_INSIGHT_ATTR, '1');

      // Parse card data once now (will re-parse on each open to capture changes)
      // Build the Insights button — small, unobtrusive
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wjp-card-insights-btn';
      btn.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.4-3 5.7-1 .8-1.7 1.7-2 3.3H10c-.3-1.6-1-2.5-2-3.3-1.7-1.3-3-3.2-3-5.7a7 7 0 0 1 7-7z"/></svg>' +
        'Insights';
      btn.style.cssText =
        'background:transparent;border:1px solid var(--border,rgba(0,0,0,0.15));' +
        'color:var(--ink,var(--text-1,#0a0a0a));border-radius:7px;padding:5px 10px;' +
        'font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;' +
        'display:inline-flex;align-items:center;margin-top:8px;';

      // Append the button at the end of the card's content (before the panel)
      try { card.appendChild(btn); } catch (_) {}

      btn.onclick = function () {
        var existing = card.querySelector('.wjp-card-insights-panel');
        if (existing) {
          existing.remove();
          btn.innerHTML = btn.innerHTML.replace('Hide insights', 'Insights');
          return;
        }
        var data = parseCardData(card);
        var html = buildInsightsPanel(card, data);
        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        card.appendChild(wrap.firstChild);
        // Change button label
        btn.innerHTML = btn.innerHTML.replace('Insights', 'Hide insights');
      };
    });
  }

  // ===========================================================================
  // BOOT
  // ===========================================================================
  function start() {
    setInterval(function () {
      try { mountDebitBalances(); } catch (_) {}
      try { attachInsightsToCards(); } catch (_) {}
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // v3 2026-05-19: expose cache + fetch primitives so the dashboard mini widget
  // can share the same data (avoids a second Plaid call).
  window.WJP_DebtsEnhance = {
    refreshDebits: function () { return renderDebitBalances(true); },
    /** Returns the cached + extracted debit accounts (already sorted desc by balance).
     *  If no cache yet, fetches once. Pass true to force refresh. */
    getDebitAccounts: async function (force) {
      try {
        var items = await fetchAccounts(force);
        if (!items) return [];
        var overrides = await fetchOverrides();
        return extractDebitAccounts(items, overrides);
      } catch (e) { return []; }
    },
    /** Pre-warm the cache without rendering anything. Safe to call on dashboard mount. */
    prefetchDebitAccounts: function () { return fetchAccounts(false); },
    version: 3
  };
})();
