/* wjp-momentum.js v5 — delta fallback to oldest snapshot (was stuck on Day One)
 * Original: v4 — Exec Summary first, then momentum (consistent sage palette)
 *
 * Original:  v3 — refined streak design + per-debt payoff milestones (5/15/30/50/75/100%)
 *
 * Three surfaces that make progress feel real:
 *   1. Weekly Progress hero strip on dashboard — 3 chips with deltas vs 7d ago
 *   2. Streak pill in header — Duolingo-style daily-visit counter
 *   3. Milestone toasts — celebration when round-number thresholds cross
 *
 * Depends on wjp-snapshots.js for historical data.
 */
(function () {
  'use strict';
  if (window._wjpMomentumInstalled) return;
  window._wjpMomentumInstalled = true;

  function isDark() { try { return document.body.classList.contains('dark'); } catch (_) { return false; } }
  function fmtUSD(n) {
    var v = Math.abs(Math.round(Number(n) || 0));
    return '$' + v.toLocaleString('en-US');
  }
  function fmtSigned(n, prefix) {
    n = Number(n) || 0;
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + (prefix || '') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  // ===== 1. Weekly Progress hero strip =====
  var HERO_ID = 'wjp-momentum-hero';
  var STREAK_ID = 'wjp-momentum-streak';

  // v5: delta(7) returns null until there's a 7-day-old snapshot. Fall back to the
  // oldest available snapshot so the widget shows real progress from day 2 onward.
  function getBestDelta() {
    if (!window.WJP_Snapshots) return null;
    var d = window.WJP_Snapshots.delta(7);
    if (d) return d;
    try {
      var all = window.WJP_Snapshots.loadAll ? window.WJP_Snapshots.loadAll() : {};
      var keys = Object.keys(all).sort();
      if (keys.length < 2) return null; // genuinely day one
      var oldest = all[keys[0]];
      var newest = all[keys[keys.length - 1]];
      var days = Math.max(1, Math.round((new Date(keys[keys.length - 1]) - new Date(keys[0])) / 86400000));
      return {
        totalDebt:      (newest.totalDebt || 0) - (oldest.totalDebt || 0),
        totalPaid:      (newest.totalPaid || 0) - (oldest.totalPaid || 0),
        liquidCash:     (newest.liquidCash || 0) - (oldest.liquidCash || 0),
        score:          (newest.score || 0) - (oldest.score || 0),
        debtFreeMonths: (oldest.debtFreeMonths || 0) - (newest.debtFreeMonths || 0),
        daysCovered:    days,
        today: newest, then: oldest
      };
    } catch (_) { return null; }
  }

  // ---------- Cash on Hand helpers (v6 — manual override + linked-account picker) ----------
  function getState2() { try { return appState; } catch (_) { return (window.appState || null); } }
  function getCashSettings() {
    var s = getState2() || {};
    return s.cashSettings || { mode: 'auto' };
  }
  function setCashSettings(cs) {
    var s = getState2(); if (!s) return;
    s.cashSettings = cs;
    try { if (typeof saveState === 'function') saveState(); } catch (_) {}
    try { if (typeof window.cloudPush === 'function') window.cloudPush(); } catch (_) {}
  }
  function listConnectedCashAccounts() {
    // No new Plaid Link flow — read whatever is already in appState
    var s = getState2() || {};
    var pools = [s.linkedAccounts, s.plaidAccounts, s.accounts, s.assets].filter(Array.isArray);
    var out = [];
    pools.forEach(function (arr) {
      arr.forEach(function (a) {
        if (!a) return;
        var t = (a.type || a.subtype || a.accountType || '').toLowerCase();
        if (!/checking|savings|cash|money\s*market|brokerage/.test(t)) return;
        var id = a.id || a.account_id || a.accountId || (a.name + ':' + (a.mask||''));
        var bal = (a.balances && (a.balances.current || a.balances.available)) || a.balance || a.amount || 0;
        out.push({ id: id, name: a.name || a.officialName || 'Account', mask: a.mask || '', balance: Number(bal) || 0, type: t });
      });
    });
    // Dedupe by id
    var seen = {}; return out.filter(function (a) { if (seen[a.id]) return false; seen[a.id] = 1; return true; });
  }
  function getCurrentCashOnHand() {
    var cs = getCashSettings();
    if (cs.mode === 'manual' && typeof cs.amount === 'number') return cs.amount;
    if (cs.mode === 'account' && cs.accountId) {
      var acct = listConnectedCashAccounts().find(function (a) { return a.id === cs.accountId; });
      if (acct) return acct.balance;
    }
    // Auto fallback: sum of cash-like assets (existing behavior)
    var s = getState2() || {};
    return (s.assets || []).filter(function (a) {
      if (!a) return false;
      var t = (a.type || a.subtype || '').toLowerCase();
      return /checking|savings|cash|money\s*market/.test(t);
    }).reduce(function (sum, a) { return sum + (Number(a.balance) || Number(a.amount) || 0); }, 0);
  }
  function getDebtHealthDelta(d) { return d ? (d.score || 0) : 0; }
  function getCreditScoreDelta() {
    // Array integration — pull from appState.creditScore.history if available
    var s = getState2() || {};
    var cs = s.creditScore || s.credit || null;
    if (!cs) return null;
    var hist = cs.history || cs.snapshots || [];
    if (!Array.isArray(hist) || hist.length < 2) return null;
    var sorted = hist.slice().sort(function (a, b) { return (a.date || a.ts || 0) - (b.date || b.ts || 0); });
    return (Number(sorted[sorted.length - 1].score) || 0) - (Number(sorted[0].score) || 0);
  }

  // Make cash + info handles discoverable via window so the click handlers can be inline
  window.WJP_Momentum_openCashEdit = openCashEdit;
  window.WJP_Momentum_openInfo     = openInfoModal;

  function buildHeroHTML() {
    if (!window.WJP_Snapshots) return '';
    var d = getBestDelta();
    var cashAbs = getCurrentCashOnHand();
    var cashDelta = d ? (d.liquidCash || 0) : 0;
    if (cashDelta === 0 && cashAbs !== 0) {
      // override delta as 0 (no snapshot delta yet) — clear sub line accordingly
    }
    var creditDelta = getCreditScoreDelta(); // null if no data
    var healthDelta = getDebtHealthDelta(d);

    if (!d) {
      // Still render the chips but with zero deltas + the cash absolute value
      d = { daysCovered: 0, totalDebt: 0, liquidCash: 0, score: 0 };
    }

    // ===== chip — value-with-delta variant =====
    function valueChip(label, absVal, deltaVal, deltaGood, sub, icon, clickAttr) {
      var color = (deltaVal === 0) ? '#94a3b8' : (deltaGood ? '#10b981' : '#ef4444');
      var bg    = (deltaVal === 0) ? 'rgba(148,163,184,0.10)' : (deltaGood ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)');
      var arrow = deltaVal === 0 ? '' : (deltaGood ? '↑' : '↓');
      var sign  = deltaGood && deltaVal > 0 ? '+' : (deltaGood && deltaVal < 0 ? '−' : (deltaVal > 0 ? '+' : (deltaVal < 0 ? '−' : '')));
      var deltaAbsTxt = '$' + Math.abs(Math.round(deltaVal)).toLocaleString('en-US');
      var absTxt = '$' + Math.round(absVal).toLocaleString('en-US');
      return ''
        + '<div ' + (clickAttr || '') + ' style="flex:1;min-width:0;padding:10px 14px;background:' + bg + ';border:1px solid ' + color + '33;border-radius:10px;display:flex;align-items:center;gap:10px;' + (clickAttr ? 'cursor:pointer;' : '') + '">'
        + '<div style="width:30px;height:30px;border-radius:8px;background:' + color + '22;display:grid;place-items:center;flex-shrink:0;color:' + color + ';"><i class="' + icon + '" style="font-size:14px;"></i></div>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</div>'
        +   '<div style="font-size:15px;font-weight:900;color:var(--ink, var(--text-1, #0a0a0a));letter-spacing:-0.005em;">' + absTxt + '</div>'
        +   '<div style="font-size:10px;font-weight:700;color:' + color + ';">' + arrow + ' ' + sign + deltaAbsTxt + (sub ? '  · ' + sub : '') + '</div>'
        + '</div>'
        + '</div>';
    }

    function deltaChip(label, value, good, sub, icon) {
      var color = (value === 0) ? '#94a3b8' : (good ? '#10b981' : '#ef4444');
      var bg = (value === 0) ? 'rgba(148,163,184,0.10)' : (good ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)');
      var arrow = value === 0 ? '' : (good ? '↑' : '↓');
      var sign = good && value > 0 ? '+' : (good && value < 0 ? '−' : (value > 0 ? '+' : (value < 0 ? '−' : '')));
      var absV = Math.abs(Math.round(value));
      return ''
        + '<div style="flex:1;min-width:0;padding:10px 14px;background:' + bg + ';border:1px solid ' + color + '33;border-radius:10px;display:flex;align-items:center;gap:10px;">'
        + '<div style="width:30px;height:30px;border-radius:8px;background:' + color + '22;display:grid;place-items:center;flex-shrink:0;color:' + color + ';"><i class="' + icon + '" style="font-size:14px;"></i></div>'
        + '<div style="flex:1;min-width:0;">'
        +   '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">' + label + '</div>'
        +   '<div style="font-size:14.5px;font-weight:900;color:' + color + ';letter-spacing:-0.005em;">' + arrow + ' ' + sign + (label === 'Credit' || label === 'Health' ? absV : '$' + absV.toLocaleString('en-US')) + '</div>'
        +   (sub ? '<div style="font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;">' + sub + '</div>' : '')
        + '</div>'
        + '</div>';
    }

    var debtChip = deltaChip(
      'Debt this week',
      -d.totalDebt,
      d.totalDebt <= 0,
      d.totalDebt < 0 ? fmtUSD(d.totalDebt) + ' paid down' : (d.totalDebt > 0 ? 'crept up' : 'no change'),
      'ph-fill ph-trending-down'
    );

    // Cash chip — now clickable + shows absolute + delta sub-line
    var cashSettings = getCashSettings();
    var cashSub = '';
    if (cashSettings.mode === 'manual')    cashSub = 'manual entry';
    else if (cashSettings.mode === 'account') cashSub = 'from linked account';
    else                                    cashSub = 'tap to set';
    if (d && (d.liquidCash || 0) !== 0) {
      cashSub = (d.liquidCash > 0 ? 'saved this week' : 'drawn down this week');
    }
    var cashChip = valueChip(
      'Cash on hand',
      cashAbs,
      cashDelta,
      cashDelta >= 0,
      cashSub,
      'ph-fill ph-piggy-bank',
      'onclick="window.WJP_Momentum_openCashEdit && window.WJP_Momentum_openCashEdit()" role="button" tabindex="0"'
    );

    // Combined Credit + Health chip — stacked sub-rows + info icon
    var creditDisplay = (creditDelta === null) ? '—' : ((creditDelta > 0 ? '+' : (creditDelta < 0 ? '−' : '')) + Math.abs(Math.round(creditDelta)));
    var creditColor   = (creditDelta === null) ? '#94a3b8' : (creditDelta >= 0 ? '#10b981' : '#ef4444');
    var healthSign    = healthDelta > 0 ? '+' : (healthDelta < 0 ? '−' : '');
    var healthDisplay = healthSign + Math.abs(Math.round(healthDelta));
    var healthColor   = (healthDelta === 0) ? '#94a3b8' : (healthDelta >= 0 ? '#10b981' : '#ef4444');
    var scoreChip = ''
      + '<div style="flex:1;min-width:0;padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.25);border-radius:10px;display:flex;align-items:center;gap:10px;">'
      + '<div style="width:30px;height:30px;border-radius:8px;background:rgba(99,102,241,0.18);display:grid;place-items:center;flex-shrink:0;color:#6366f1;"><i class="ph-fill ph-shield-check" style="font-size:14px;"></i></div>'
      + '<div style="flex:1;min-width:0;">'
      +   '<div style="display:flex;align-items:center;justify-content:space-between;font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:var(--text-3,#94a3b8);">'
      +     '<span>Scores</span>'
      +     '<span onclick="window.WJP_Momentum_openInfo && window.WJP_Momentum_openInfo()" role="button" tabindex="0" style="cursor:pointer;width:18px;height:18px;border-radius:50%;border:1px solid currentColor;display:inline-grid;place-items:center;font-size:10px;font-style:italic;font-weight:900;letter-spacing:0;">i</span>'
      +   '</div>'
      +   '<div style="display:flex;gap:8px;align-items:baseline;margin-top:2px;">'
      +     '<span style="font-size:12px;font-weight:800;color:' + creditColor + ';">' + creditDisplay + '</span><span style="font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;">credit</span>'
      +     '<span style="opacity:0.4;">·</span>'
      +     '<span style="font-size:12px;font-weight:800;color:' + healthColor + ';">' + healthDisplay + '</span><span style="font-size:9.5px;color:var(--text-3,#94a3b8);font-weight:600;">health</span>'
      +   '</div>'
      + '</div>'
      + '</div>';

    var headerSub = (d.daysCovered === 0 ? 'starting fresh' : 'vs ' + d.daysCovered + ' days ago');
    var headerLabel = (d.daysCovered === 1) ? 'Last 24 hours' : (d.daysCovered === 0 ? 'Last 7 days' : 'Last ' + d.daysCovered + ' days');
    return ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
      +   '<div style="font-size:10px;letter-spacing:0.10em;font-weight:800;color:var(--text-3,#94a3b8);text-transform:uppercase;">' + headerLabel + '</div>'
      +   '<div style="font-size:10px;color:var(--text-3,#94a3b8);font-weight:600;">' + headerSub + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + debtChip + cashChip + scoreChip + '</div>';
  }

  // ===== Cash on Hand edit modal =====
  function openCashEdit() {
    closeMomentumModal();
    var cs = getCashSettings();
    var accounts = listConnectedCashAccounts();
    var isLight = document.body.classList.contains('light');
    var bg = isLight ? '#ffffff' : '#13192a';
    var ink = isLight ? '#0a0a0a' : '#f1f5f9';
    var subInk = isLight ? 'rgba(10,10,10,0.55)' : 'rgba(241,245,249,0.55)';
    var border = isLight ? 'rgba(10,10,10,0.10)' : 'rgba(255,255,255,0.10)';

    var html = ''
      + '<div id="wjp-mom-scrim" style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;"></div>'
      + '<div id="wjp-mom-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,90vw);background:' + bg + ';color:' + ink + ';border:1px solid ' + border + ';border-radius:14px;padding:20px;z-index:9001;box-shadow:0 24px 64px rgba(0,0,0,0.45);">'
      +   '<h3 style="margin:0 0 4px 0;font-size:18px;font-weight:700;">Cash on Hand</h3>'
      +   '<p style="margin:0 0 16px 0;font-size:12px;color:' + subInk + ';">Type your current savings, or pick an already-connected account. No new bank link needed.</p>'
      +   '<label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:' + subInk + ';margin-bottom:6px;">Manual amount</label>'
      +   '<input id="wjp-mom-cash-input" type="number" inputmode="decimal" placeholder="0.00" min="0" step="0.01" value="' + (cs.mode === 'manual' && typeof cs.amount === 'number' ? cs.amount : '') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:transparent;color:' + ink + ';font-size:16px;font-weight:600;box-sizing:border-box;"/>'
      +   '<div style="display:flex;align-items:center;gap:10px;margin:14px 0;color:' + subInk + ';font-size:11px;font-weight:700;">'
      +     '<div style="flex:1;height:1px;background:' + border + ';"></div><span>OR</span><div style="flex:1;height:1px;background:' + border + ';"></div>'
      +   '</div>'
      +   '<label style="display:block;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:' + subInk + ';margin-bottom:6px;">Link to a connected account</label>'
      +   '<select id="wjp-mom-cash-acct" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid ' + border + ';background:transparent;color:' + ink + ';font-size:14px;font-weight:600;box-sizing:border-box;">'
      +     '<option value="">— None —</option>'
      +     accounts.map(function (a) {
              var sel = (cs.mode === 'account' && cs.accountId === a.id) ? ' selected' : '';
              return '<option value="' + String(a.id).replace(/"/g, '&quot;') + '"' + sel + '>' + (a.name || 'Account') + (a.mask ? ' ·' + a.mask : '') + ' — $' + Math.round(a.balance).toLocaleString('en-US') + '</option>';
            }).join('')
      +   '</select>'
      +   (accounts.length === 0 ? '<p style="font-size:11px;color:' + subInk + ';margin:6px 0 0 0;">No connected checking/savings accounts yet. Use Sync Bank from the Bank Health tab to add one.</p>' : '')
      +   '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:18px;">'
      +     '<button id="wjp-mom-clear" type="button" style="padding:8px 14px;border-radius:8px;border:1px solid ' + border + ';background:transparent;color:' + ink + ';cursor:pointer;font-weight:600;">Clear</button>'
      +     '<div style="display:flex;gap:10px;">'
      +       '<button id="wjp-mom-cancel" type="button" style="padding:8px 14px;border-radius:8px;border:1px solid ' + border + ';background:transparent;color:' + ink + ';cursor:pointer;font-weight:600;">Cancel</button>'
      +       '<button id="wjp-mom-save"   type="button" style="padding:8px 14px;border-radius:8px;border:0;background:#10b981;color:#ffffff;cursor:pointer;font-weight:700;">Save</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    var holder = document.createElement('div');
    holder.id = 'wjp-mom-modal-holder';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    document.getElementById('wjp-mom-scrim').addEventListener('click', closeMomentumModal);
    document.getElementById('wjp-mom-cancel').addEventListener('click', closeMomentumModal);
    document.getElementById('wjp-mom-clear').addEventListener('click', function () {
      setCashSettings({ mode: 'auto' });
      closeMomentumModal();
      try { mountHero(); } catch (_) {}
    });
    document.getElementById('wjp-mom-save').addEventListener('click', function () {
      var amount = parseFloat(document.getElementById('wjp-mom-cash-input').value);
      var acctId = document.getElementById('wjp-mom-cash-acct').value;
      if (acctId) setCashSettings({ mode: 'account', accountId: acctId });
      else if (!isNaN(amount) && amount >= 0) setCashSettings({ mode: 'manual', amount: amount });
      else setCashSettings({ mode: 'auto' });
      closeMomentumModal();
      try { mountHero(); } catch (_) {}
    });
  }
  function closeMomentumModal() {
    var h = document.getElementById('wjp-mom-modal-holder');
    if (h) h.remove();
  }
  function openInfoModal() {
    closeMomentumModal();
    var isLight = document.body.classList.contains('light');
    var bg = isLight ? '#ffffff' : '#13192a';
    var ink = isLight ? '#0a0a0a' : '#f1f5f9';
    var subInk = isLight ? 'rgba(10,10,10,0.6)' : 'rgba(241,245,249,0.65)';
    var border = isLight ? 'rgba(10,10,10,0.10)' : 'rgba(255,255,255,0.10)';
    var html = ''
      + '<div id="wjp-mom-scrim" style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;"></div>'
      + '<div id="wjp-mom-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(520px,92vw);max-height:80vh;overflow-y:auto;background:' + bg + ';color:' + ink + ';border:1px solid ' + border + ';border-radius:14px;padding:22px;z-index:9001;box-shadow:0 24px 64px rgba(0,0,0,0.45);">'
      +   '<h3 style="margin:0 0 4px 0;font-size:18px;font-weight:700;">How this box works</h3>'
      +   '<p style="margin:0 0 16px 0;font-size:12px;color:' + subInk + ';">Last 7 Days shows your week-over-week movement on three things that matter.</p>'
      +   '<div style="display:grid;gap:12px;font-size:13px;line-height:1.5;">'
      +     '<div><strong>Debt this week</strong> — change in your total debt balance over the last 7 days. We sum every debt balance you have today and compare it to 7 days ago. Negative means you paid down, positive means the balance grew.</div>'
      +     '<div><strong>Cash on hand</strong> — your current liquid savings. Set it manually or link to an already-connected checking/savings account. The arrow shows the change since the same point last week.</div>'
      +     '<div><strong>Credit score</strong> — change in your bureau credit score from your last credit pull (Array integration). Shows "—" until you connect credit monitoring.</div>'
      +     '<div><strong>Debt health</strong> — your WJP health score (0-100). Built from utilization, on-time payment streak, debt-to-income trend, and momentum vs your strategy. Goes up as you pay down and stay on schedule.</div>'
      +   '</div>'
      +   '<div style="display:flex;justify-content:flex-end;margin-top:18px;">'
      +     '<button id="wjp-mom-info-close" type="button" style="padding:8px 14px;border-radius:8px;border:0;background:#10b981;color:#ffffff;cursor:pointer;font-weight:700;">Got it</button>'
      +   '</div>'
      + '</div>';
    var holder = document.createElement('div'); holder.id = 'wjp-mom-modal-holder'; holder.innerHTML = html;
    document.body.appendChild(holder);
    document.getElementById('wjp-mom-scrim').addEventListener('click', closeMomentumModal);
    document.getElementById('wjp-mom-info-close').addEventListener('click', closeMomentumModal);
  }

  function mountHero() {
    try {
      var page = document.getElementById('page-dashboard');
      if (!page || page.offsetHeight === 0) return;
      var card = document.getElementById(HERO_ID);
      if (!card) {
        card = document.createElement('div');
        card.id = HERO_ID;
        card.className = 'card reveal reorderable'; card.setAttribute('data-card-id','last-7-days'); card.setAttribute('data-card-label','Last 7 Days');
        card.style.cssText = 'padding:14px 16px;margin-top:10px;';
        // v4: Insert AFTER the Executive Summary (#dfd-hero) so it doesn't push the
        // headline below. Fall back to after greeting if exec summary not present yet.
        var anchor = document.getElementById('dfd-hero') || document.getElementById('dash-greeting');
        if (anchor && anchor.parentNode) {
          if (anchor.nextSibling) anchor.parentNode.insertBefore(card, anchor.nextSibling);
          else anchor.parentNode.appendChild(card);
        } else {
          page.insertBefore(card, page.firstChild);
        }
      }
      var html = buildHeroHTML();
      if (html) card.innerHTML = html;
    } catch (e) { try { console.warn('[wjp-momentum] hero mount', e); } catch (_) {} }
  }

  // ===== 2. Streak pill in header =====
  function mountStreak() {
    try {
      if (!window.WJP_Snapshots) return;
      var s = window.WJP_Snapshots.streak();
      if (!s || !s.current) return;

      // Place inside the topbar — find the nearest "topbar" container
      var pill = document.getElementById(STREAK_ID);
      var topbar = document.querySelector('.topbar, [class*="topbar"], .header-right, .top-right, .nav-actions');
      if (!topbar) {
        // Fallback: find Privacy Mode / Sync Bank buttons area
        var pmBtn = Array.from(document.querySelectorAll('button')).find(function (b) { return /privacy mode/i.test(b.textContent || ''); });
        if (pmBtn) topbar = pmBtn.parentElement;
      }
      if (!topbar) return;
      if (!pill) {
        pill = document.createElement('div');
        pill.id = STREAK_ID;
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 9px;background:rgba(245,158,11,0.10);color:#f59e0b;border:1px solid rgba(245,158,11,0.35);border-radius:999px;font-size:11.5px;font-weight:800;font-family:inherit;cursor:default;user-select:none;margin-right:6px;';
        pill.title = 'Days in a row using WJP — longest: ' + s.longest;
        topbar.insertBefore(pill, topbar.firstChild);
      }
      pill.innerHTML = '<i class="ph-fill ph-flame" style="font-size:12px;color:#f59e0b;"></i><span style="font-weight:800;">' + s.current + '</span><span style="font-weight:600;opacity:0.75;letter-spacing:0.04em;">DAY</span>';
    } catch (e) { try { console.warn('[wjp-momentum] streak mount', e); } catch (_) {} }
  }

  // ===== 3. Milestone toasts =====
  var DEBT_PAID_THRESHOLDS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000];
  var SCORE_THRESHOLDS = [40, 55, 75, 90];
  var CASH_THRESHOLDS = [500, 1000, 2500, 5000, 10000];

  function showToast(opts) {
    // opts: { title, sub, color, icon }
    var existing = document.getElementById('wjp-momentum-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'wjp-momentum-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card,#fff);border:1px solid ' + opts.color + ';border-left:6px solid ' + opts.color + ';border-radius:12px;padding:14px 18px;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-family:var(--sans,Inter,system-ui,sans-serif);transform:translateY(20px);opacity:0;transition:all 0.4s cubic-bezier(0.16,1,0.3,1);';
    toast.innerHTML = ''
      + '<div style="display:flex;align-items:center;gap:12px;">'
      +   '<div style="width:42px;height:42px;border-radius:11px;background:' + opts.color + '22;display:grid;place-items:center;flex-shrink:0;"><i class="' + opts.icon + '" style="font-size:22px;color:' + opts.color + ';"></i></div>'
      +   '<div style="flex:1;min-width:0;">'
      +     '<div style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:' + opts.color + ';">' + (opts.eyebrow || 'MILESTONE') + '</div>'
      +     '<div style="font-size:14px;font-weight:800;color:var(--text-1,#0a0a0a);margin-top:2px;line-height:1.3;">' + opts.title + '</div>'
      +     (opts.sub ? '<div style="font-size:11px;color:var(--text-3,#94a3b8);font-weight:600;margin-top:4px;line-height:1.4;">' + opts.sub + '</div>' : '')
      +   '</div>'
      +   '<button id="wjp-mom-toast-close" type="button" style="background:transparent;border:0;color:var(--text-3,#94a3b8);cursor:pointer;font-size:20px;line-height:1;padding:0;flex-shrink:0;">×</button>'
      + '</div>';
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    toast.querySelector('#wjp-mom-toast-close').onclick = function () { toast.remove(); };
    // Auto-dismiss in 8s
    setTimeout(function () {
      if (document.getElementById('wjp-momentum-toast') === toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(function () { try { toast.remove(); } catch (_) {} }, 400);
      }
    }, 8000);
  }

  var PER_DEBT_PCT_TIERS = [5, 15, 30, 50, 75, 100];

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  function fireMilestones() {
    if (!window.WJP_Snapshots) return;
    var today = window.WJP_Snapshots.today();
    if (!today) return;

    // Total paid crossings
    DEBT_PAID_THRESHOLDS.forEach(function (t) {
      var id = 'paid-' + t;
      if (today.totalPaid >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        showToast({
          eyebrow: 'PAID OFF MILESTONE',
          title: 'You\'ve paid off $' + t.toLocaleString() + '!',
          sub: 'Every dollar gone is interest you\'ll never pay. Keep stacking.',
          color: '#10b981',
          icon: 'ph-fill ph-trophy'
        });
      }
    });

    // Score crossings
    SCORE_THRESHOLDS.forEach(function (t) {
      var id = 'score-' + t;
      if (today.score >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        var label = t >= 75 ? 'Strong' : t >= 55 ? 'Stable' : 'Fragile';
        showToast({
          eyebrow: 'RESILIENCE LEVEL UP',
          title: 'You crossed ' + t + ' — Resilience is ' + label,
          sub: 'Your runway + DTI just moved you up a tier.',
          color: '#10b981',
          icon: 'ph-fill ph-shield-check'
        });
      }
    });

    // Cash crossings
    CASH_THRESHOLDS.forEach(function (t) {
      var id = 'cash-' + t;
      if (today.liquidCash >= t && !window.WJP_Snapshots.hasFired(id)) {
        window.WJP_Snapshots.markFired(id);
        showToast({
          eyebrow: 'SAVINGS MILESTONE',
          title: 'Liquid cash hit $' + t.toLocaleString(),
          sub: 'This is your buffer — it shortens the runway clock.',
          color: '#3b82f6',
          icon: 'ph-fill ph-piggy-bank'
        });
      }
    });

    // Per-debt payoff milestones (5/15/30/50/75/100%)
    var s = getState();
    if (!s || !Array.isArray(s.debts)) return;
    s.debts.forEach(function (d) {
      if (!d || !d.id) return;
      var start = Number(d.startingBalance || d.originalBalance || 0);
      var bal = Number(d.balance || 0);
      if (!start || start <= 0) return;
      var paid = Math.max(0, start - bal);
      var pct = (paid / start) * 100;
      PER_DEBT_PCT_TIERS.forEach(function (tier) {
        if (pct < tier) return;
        var id = 'debt-' + d.id + '-' + tier;
        if (window.WJP_Snapshots.hasFired(id)) return;
        window.WJP_Snapshots.markFired(id);
        var emoji = tier === 100 ? '🏆' : tier >= 75 ? '🚀' : tier >= 50 ? '⚡' : tier >= 30 ? '🎯' : tier >= 15 ? '💪' : '✨';
        var name = String(d.name || 'this debt').slice(0, 36);
        showToast({
          eyebrow: tier === 100 ? 'DEBT ELIMINATED' : 'PAYOFF MILESTONE',
          title: tier === 100
            ? name + ' — PAID OFF ' + emoji
            : tier + '% paid on ' + name + ' ' + emoji,
          sub: tier === 100
            ? 'That\'s one debt off the list. Roll its minimum into the next priority.'
            : 'Paid $' + Math.round(paid).toLocaleString() + ' of $' + Math.round(start).toLocaleString() + '. Stay on it.',
          color: tier === 100 ? '#10b981' : tier >= 50 ? '#a855f7' : '#3b82f6',
          icon: tier === 100 ? 'ph-fill ph-confetti' : 'ph-fill ph-flag-checkered'
        });
      });
    });
  }

  // ===== Tick =====
  function tick() {
    mountHero();
    mountStreak();
    fireMilestones();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 2500); });
  else setTimeout(tick, 2500);
  setInterval(tick, 5000);

  window.WJP_Momentum = { tick: tick, showToast: showToast };
})();
