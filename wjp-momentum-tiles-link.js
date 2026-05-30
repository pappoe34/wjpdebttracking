/* wjp-momentum-tiles-link.js v1 — Wire the "Debt this week" and "Scores"
 * tiles in the Last 7 Days hero (#wjp-momentum-hero) to live data.
 *
 * Winston 2026-05-29: "debts the week and score arent working"
 *
 * Approach:
 *   1. DEBT THIS WEEK
 *      - Primary: sum of debt-categorized transactions in the last 7 days
 *        from appState.transactions (excludes synthetic).
 *      - Fallback (no real txns yet): estimate from recurringPayments
 *        with category='debt' or linkedDebtId set, normalized to monthly
 *        then divided by 4 for weekly estimate.
 *      - Display: "-$X" green if paid down, "$0" with "No change" if 0,
 *        "+$X" red if balance grew (rare — interest accrual or new charges).
 *      - Subtitle: "$Y paid · Z txns" when real, "~$Y/wk est · from minimums"
 *        when estimated.
 *
 *   2. SCORES
 *      - Read current score via window.WJP_CreditMock.getCurrentScore() with
 *        a fallback to the last entry of WJP_CreditMock.scoreHistory().
 *      - Trend from last vs previous history entry.
 *      - Display: big number = score; subtitle = "+N this period" /
 *        "-N this period" / "no change yet".
 *      - Click → navigates to #credit-health.
 *
 * Safe: IIFE, idempotent install, bare appState access via try/catch.
 * No hardcoded user data. Works for every account.
 */
(function () {
  'use strict';
  if (window._wjpMomentumTilesLinkInstalled) return;
  window._wjpMomentumTilesLinkInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }

  // ────────── data helpers ──────────
  function debtPaidLast7d() {
    var s = getState();
    if (!s || !Array.isArray(s.transactions)) return { amount: 0, count: 0, mode: 'none' };
    var sevenAgo = Date.now() - 7 * 86400000;
    var sum = 0, count = 0;
    s.transactions.forEach(function (t) {
      if (!t || t.synthetic) return;
      var ms = t.date ? new Date(String(t.date).slice(0, 10) + 'T12:00:00').getTime() : 0;
      if (!ms || ms < sevenAgo) return;
      var cat = String(t.userCategoryId || t.category || '').toLowerCase();
      if (cat !== 'debt' && cat.indexOf('paydown') === -1 && cat.indexOf('credit card') === -1) return;
      // Debt payments are typically NEGATIVE amounts (money leaving). Count abs value.
      var amt = Number(t.amount) || 0;
      sum += Math.abs(amt);
      count++;
    });
    if (sum > 0) return { amount: sum, count: count, mode: 'actual' };
    return { amount: 0, count: 0, mode: 'none' };
  }

  function debtEstFromRecurring() {
    var s = getState();
    if (!s) return 0;
    var rps = Array.isArray(s.recurringPayments) ? s.recurringPayments
            : (Array.isArray(s.recurring) ? s.recurring : []);
    var monthly = 0;
    rps.forEach(function (rp) {
      if (!rp) return;
      var cat = String(rp.category || rp.cat || '').toLowerCase();
      var hasDebtLink = !!(rp.linkedDebtId || rp.debtId || rp.debt_id);
      if (cat !== 'debt' && !hasDebtLink) return;
      var amt = Math.abs(Number(rp.amount) || 0);
      var freq = String(rp.frequency || rp.freq || 'monthly').toLowerCase();
      // Convert to monthly
      var mult = 1;
      if (freq === 'weekly') mult = 52 / 12;
      else if (freq === 'biweekly') mult = 26 / 12;
      else if (freq === 'semimonthly') mult = 2;
      else if (freq === 'quarterly') mult = 1 / 3;
      else if (freq === 'annually' || freq === 'yearly') mult = 1 / 12;
      monthly += amt * mult;
    });
    return monthly / (52 / 12); // monthly → weekly
  }

  function getCreditScore() {
    try {
      if (window.WJP_CreditMock && typeof window.WJP_CreditMock.getCurrentScore === 'function') {
        var sc = Number(window.WJP_CreditMock.getCurrentScore());
        if (sc) return sc;
      }
    } catch (_) {}
    try {
      var s = getState();
      var hist = (s && Array.isArray(s.creditScoreHistory)) ? s.creditScoreHistory : null;
      if (hist && hist.length) return Number(hist[hist.length - 1].score) || null;
    } catch (_) {}
    return null;
  }

  function getCreditTrend() {
    try {
      var hist = null;
      if (window.WJP_CreditMock && typeof window.WJP_CreditMock.scoreHistory === 'function') {
        hist = window.WJP_CreditMock.scoreHistory();
      }
      if (!hist) {
        var s = getState();
        if (s && Array.isArray(s.creditScoreHistory)) hist = s.creditScoreHistory;
      }
      if (!Array.isArray(hist) || hist.length < 2) return { delta: 0, hasPrev: false };
      var last = Number(hist[hist.length - 1].score) || 0;
      var prev = Number(hist[hist.length - 2].score) || 0;
      return { delta: last - prev, hasPrev: true };
    } catch (_) { return { delta: 0, hasPrev: false }; }
  }

  // ────────── DOM hookup ──────────
  function findTileByLabel(needle) {
    var hero = document.getElementById('wjp-momentum-hero');
    if (!hero) return null;
    var iter = document.createNodeIterator(hero, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = iter.nextNode())) {
      var t = (n.textContent || '').trim().toLowerCase();
      if (t === needle.toLowerCase()) {
        var label = n.parentElement;
        if (!label) continue;
        var tile = label.parentElement || label;
        return { tile: tile, labelEl: label };
      }
    }
    return null;
  }

  function findValueSubElements(tile, opts) {
    if (!tile) return { valEl: null, subEl: null };
    var valEl = null, subEl = null;
    var all = Array.from(tile.querySelectorAll('*'));
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length !== 0) continue;
      var txt = (el.textContent || '').trim();
      if (!txt) continue;
      // val = big money-ish or "—" placeholder; pick the first reasonable one
      if (!valEl) {
        if (/^[+\-]?\$[\d,]+(?:\.\d{1,2})?$/.test(txt) || /^—$|^-$/.test(txt) || /^\d{2,4}$/.test(txt)) {
          valEl = el;
          continue;
        }
      }
      // sub = "No change", "tap to set", contains "·", or short label text
      if (!subEl && txt.length < 80) {
        if (/no change|tap to set|·\s|change/i.test(txt)) { subEl = el; continue; }
      }
    }
    return { valEl: valEl, subEl: subEl };
  }

  // ────────── paint Debt this week ──────────
  var _haveRealDebt = false;
  function paintDebt() {
    var found = findTileByLabel('debt this week');
    if (!found) return false;
    var info = debtPaidLast7d();
    var est = (info.amount === 0) ? debtEstFromRecurring() : 0;
    // Stability: don't paint $0 / No payments when we have neither actuals
    // nor a meaningful estimate yet and we've never shown real data.
    if (!_haveRealDebt && info.amount === 0 && est === 0) {
      if (!found.tile.dataset.wjpDebtWired) {
        found.tile.dataset.wjpDebtWired = '1';
        found.tile.style.cursor = 'pointer';
        found.tile.title = 'Open Debts';
        found.tile.addEventListener('click', function (e) {
          if (e.target.closest('button, input, select, a')) return;
          try { location.hash = '#debts'; } catch (_) {}
        });
      }
      return false;
    }
    var refs = findValueSubElements(found.tile);
    var valEl = refs.valEl, subEl = refs.subEl;
    var valTxt, subTxt;
    if (info.mode === 'actual' && info.amount > 0) {
      valTxt = '-$' + Math.round(info.amount).toLocaleString();
      subTxt = info.count + (info.count === 1 ? ' payment' : ' payments') + ' · paid down';
    } else if (est > 0) {
      valTxt = '~$' + Math.round(est).toLocaleString();
      subTxt = 'est/wk · from minimums';
    } else {
      valTxt = '$0';
      subTxt = 'No payments this week';
    }
    if (valEl) { valEl.textContent = valTxt; valEl.dataset.wjpOwned = '1'; }
    if (subEl) { subEl.textContent = subTxt; subEl.dataset.wjpOwned = '1'; }
    if (info.amount > 0 || est > 0) _haveRealDebt = true;
    if (!found.tile.dataset.wjpDebtWired) {
      found.tile.dataset.wjpDebtWired = '1';
      found.tile.style.cursor = 'pointer';
      found.tile.title = 'Open Debts';
      found.tile.addEventListener('click', function (e) {
        if (e.target.closest('button, input, select, a')) return;
        try { location.hash = '#debts'; } catch (_) {}
      });
    }
    return true;
  }

  // ────────── paint Scores ──────────
  var _haveRealScore = false;
  function paintScore() {
    var found = findTileByLabel('scores');
    if (!found) return false;
    var sc = getCreditScore();
    if (!_haveRealScore && sc == null) {
      if (!found.tile.dataset.wjpScoreWired) {
        found.tile.dataset.wjpScoreWired = '1';
        found.tile.style.cursor = 'pointer';
        found.tile.title = 'Open Credit Health';
        found.tile.addEventListener('click', function (e) {
          if (e.target.closest('button, input, select, a')) return;
          try { location.hash = '#credit-health'; } catch (_) {}
        });
      }
      return false;
    }
    var trend = getCreditTrend();
    var refs = findValueSubElements(found.tile);
    var valEl = refs.valEl, subEl = refs.subEl;
    var valTxt, subTxt;
    if (sc != null) {
      valTxt = String(sc);
      if (trend.hasPrev) {
        var sign = trend.delta > 0 ? '+' : (trend.delta < 0 ? '−' : '±');
        subTxt = sign + Math.abs(trend.delta) + ' · last refresh';
      } else {
        subTxt = 'credit · no prior';
      }
      _haveRealScore = true;
    } else {
      valTxt = '—';
      subTxt = 'no credit data';
    }
    if (valEl) { valEl.textContent = valTxt; valEl.dataset.wjpOwned = '1'; }
    if (subEl) { subEl.textContent = subTxt; subEl.dataset.wjpOwned = '1'; }
    if (!found.tile.dataset.wjpScoreWired) {
      found.tile.dataset.wjpScoreWired = '1';
      found.tile.style.cursor = 'pointer';
      found.tile.title = 'Open Credit Health';
      found.tile.addEventListener('click', function (e) {
        if (e.target.closest('button, input, select, a')) return;
        try { location.hash = '#credit-health'; } catch (_) {}
      });
    }
    return true;
  }

  function paintAll() {
    paintDebt();
    paintScore();
  }

  // ────────── boot ──────────
  function boot() {
    var attempts = 0;
    function tick() {
      attempts++;
      var hero = document.getElementById('wjp-momentum-hero');
      if (hero) paintAll();
      // Sustain forever (cheap) — every 1.5s — so if the hero re-mounts we
      // re-paint. The paint functions are idempotent and cheap.
      setTimeout(tick, 5000);
    }
    setTimeout(tick, 400);
    function repaintSoon() { setTimeout(paintAll, 200); setTimeout(paintAll, 800); setTimeout(paintAll, 2000); }
    window.addEventListener('wjp-data-restored', repaintSoon);
    window.addEventListener('wjp-plaid-sync-done', repaintSoon);
    window.addEventListener('wjp-transactions-changed', repaintSoon);
    window.addEventListener('wjp-debts-changed', repaintSoon);
    window.addEventListener('wjp-credit-changed', repaintSoon);
    try {
      var observe = function () {
        var hero = document.getElementById('wjp-momentum-hero');
        if (!hero) return false;
        var mo = new MutationObserver(function () { setTimeout(paintAll, 100); });
        mo.observe(hero, { childList: true, subtree: true, characterData: true });
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

  window.WJP_MomentumTilesLink = {
    version: 3,
    paintAll: paintAll,
    debtPaidLast7d: debtPaidLast7d,
    debtEstFromRecurring: debtEstFromRecurring,
    getCreditScore: getCreditScore,
    getCreditTrend: getCreditTrend
  };
})();
