/* wjp-snapshots.js v1 — daily snapshot engine for progress tracking
 *
 * Takes a daily snapshot of the user's headline numbers so the Momentum
 * layer can show "you're $X ahead vs 7 days ago" deltas. Without history,
 * we can't show progress — this is the foundation for retention.
 *
 * What we snapshot daily:
 *   - totalDebt: sum of debts.balance
 *   - totalPaid: total starting balances - totalDebt (cumulative payoff)
 *   - liquidCash: sum of checking/savings assets
 *   - score: Resilience score (0-100)
 *   - debtFreeMonths: months from today to projected debt-free date (Avalanche, current extra)
 *   - monthlyMin: total debt minimums
 *   - savedThisMonth: best estimate of money saved into savings/investments this month
 *
 * Storage: user-scoped key wjp.snapshots.daily.v1.uid_<uid>
 *   { [YYYY-MM-DD]: { ...metrics, ts } }
 *   Keeps last 90 days, prunes older.
 *
 * Streak: separate key wjp.streak.visits.v1.uid_<uid>
 *   { dates: [YYYY-MM-DD], current: N, longest: N }
 */
(function () {
  'use strict';
  if (window._wjpSnapshotsInstalled) return;
  window._wjpSnapshotsInstalled = true;

  function getState() { try { return appState; } catch (e) { return (window.appState || null); } }

  // ---------- Storage helpers (user-scoped via WJP_UserScope) ----------
  function userKey(base) {
    if (window.WJP_UserScope && typeof window.WJP_UserScope.key === 'function') {
      return window.WJP_UserScope.key(base);
    }
    return base;
  }
  function loadJSON(key, def) {
    try { var v = localStorage.getItem(userKey(key)); return v ? JSON.parse(v) : def; }
    catch (_) { return def; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(userKey(key), JSON.stringify(val)); }
    catch (_) {}
  }

  var SNAPSHOTS_KEY = 'wjp.snapshots.daily.v1';
  var STREAK_KEY    = 'wjp.streak.visits.v1';
  var MILESTONES_KEY = 'wjp.milestones.fired.v1';
  var WINDOW_DAYS = 90;

  function today() {
    var d = new Date(); d.setHours(0,0,0,0);
    return d.toISOString().slice(0,10);
  }
  function daysAgo(n) {
    var d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0,10);
  }

  // ---------- Compute today's snapshot ----------
  function compute() {
    var s = getState() || {};
    var debts = s.debts || [];
    var totalDebt = debts.reduce(function (a, d) { return a + (Number(d.balance) || 0); }, 0);
    // total paid = sum of (startingBalance - currentBalance)
    var totalPaid = debts.reduce(function (a, d) {
      var start = Number(d.startingBalance || d.originalBalance || d.balance || 0);
      var bal   = Number(d.balance || 0);
      var paid  = Math.max(0, start - bal);
      return a + paid;
    }, 0);
    var liquidCash = (s.assets || []).filter(function (a) {
      if (!a) return false;
      var t = (a.type || a.subtype || '').toLowerCase();
      return /checking|savings|cash|money\s*market/.test(t);
    }).reduce(function (sum, a) { return sum + (Number(a.balance) || Number(a.amount) || 0); }, 0);

    var score = 0;
    try {
      if (window.WJP_Resilience && typeof window.WJP_Resilience.compute === 'function') {
        score = window.WJP_Resilience.compute().score || 0;
      }
    } catch (_) {}

    var monthlyMin = debts.reduce(function (a, d) { return a + (Number(d.minPayment) || 0); }, 0);

    var debtFreeMonths = 0;
    try {
      if (typeof window.calculateDebtPayoff === 'function') {
        var results = window.calculateDebtPayoff('avalanche', null);
        if (results) {
          var maxM = 0;
          Object.values(results).forEach(function (r) { if (r.months > maxM) maxM = r.months; });
          debtFreeMonths = maxM;
        }
      }
    } catch (_) {}

    return {
      totalDebt: Math.round(totalDebt * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      liquidCash: Math.round(liquidCash * 100) / 100,
      score: score,
      monthlyMin: Math.round(monthlyMin * 100) / 100,
      debtFreeMonths: debtFreeMonths,
      ts: Date.now()
    };
  }

  // ---------- Snapshot DB ----------
  function loadAll() { return loadJSON(SNAPSHOTS_KEY, {}); }
  function saveAll(o) { saveJSON(SNAPSHOTS_KEY, o); }

  function prune(o) {
    var cutoff = daysAgo(WINDOW_DAYS);
    Object.keys(o).forEach(function (k) { if (k < cutoff) delete o[k]; });
    return o;
  }

  function snapshotToday() {
    var all = loadAll();
    var todayKey = today();
    var fresh = compute();
    // Always overwrite today's so we capture latest within the day
    all[todayKey] = fresh;
    prune(all);
    saveAll(all);
    return fresh;
  }

  function getOnDay(dateKey) {
    var all = loadAll();
    if (all[dateKey]) return all[dateKey];
    // Find closest snapshot ON OR BEFORE that date
    var keys = Object.keys(all).filter(function (k) { return k <= dateKey; }).sort();
    if (!keys.length) return null;
    return all[keys[keys.length - 1]];
  }

  function delta(daysBack) {
    var todayS = getOnDay(today()) || compute();
    var thenS  = getOnDay(daysAgo(daysBack));
    if (!thenS) return null;
    return {
      totalDebt:      todayS.totalDebt - thenS.totalDebt,        // negative is good (paid down)
      totalPaid:      todayS.totalPaid - thenS.totalPaid,        // positive is good
      liquidCash:     todayS.liquidCash - thenS.liquidCash,      // positive is good
      score:          todayS.score - thenS.score,                // positive is good
      debtFreeMonths: thenS.debtFreeMonths - todayS.debtFreeMonths, // positive is good (fewer months left)
      daysCovered:    daysBack,
      today: todayS,
      then: thenS
    };
  }

  // ---------- Streak tracking ----------
  function bumpStreak() {
    var rec = loadJSON(STREAK_KEY, { dates: [], current: 0, longest: 0 });
    var t = today();
    if (rec.dates.indexOf(t) !== -1) return rec; // already counted today
    var yest = daysAgo(1);
    if (rec.dates.indexOf(yest) !== -1 || rec.current === 0) {
      rec.current = (rec.current || 0) + 1;
    } else {
      rec.current = 1; // gap, reset
    }
    if (rec.current > rec.longest) rec.longest = rec.current;
    rec.dates.push(t);
    // Keep last 365 days only
    var cutoff = daysAgo(365);
    rec.dates = rec.dates.filter(function (d) { return d >= cutoff; });
    saveJSON(STREAK_KEY, rec);
    return rec;
  }
  function streak() { return loadJSON(STREAK_KEY, { dates: [], current: 0, longest: 0 }); }

  // ---------- Milestones ----------
  function loadFiredMilestones() { return loadJSON(MILESTONES_KEY, {}); }
  function markFired(id) {
    var f = loadFiredMilestones();
    f[id] = Date.now();
    saveJSON(MILESTONES_KEY, f);
  }
  function hasFired(id) { return !!loadFiredMilestones()[id]; }

  // ---------- Init ----------
  function boot() {
    // Wait for auth/state to be ready before scoping properly
    var attempts = 0;
    function tryInit() {
      attempts++;
      var s = getState();
      // Need state with debts; otherwise wait
      if (!s || !s.debts) {
        if (attempts < 50) return setTimeout(tryInit, 400);
      }
      snapshotToday();
      bumpStreak();
      // Refresh snapshot every 10 min in case state changes
      setInterval(snapshotToday, 10 * 60 * 1000);
    }
    tryInit();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  else setTimeout(boot, 1500);

  window.WJP_Snapshots = {
    today: function () { return getOnDay(today()) || compute(); },
    getOnDay: getOnDay,
    delta: delta,
    streak: streak,
    bumpStreak: bumpStreak,
    snapshotToday: snapshotToday,
    hasFired: hasFired,
    markFired: markFired,
    loadAll: loadAll
  };
})();
