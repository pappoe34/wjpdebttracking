/* wjp-streak.js v12 — no header chip; notify via bell icon instead.
 *
 * Behavior:
 *   - Tracks "days on track" exactly like v11 (count >= 1 always; uses
 *     WJP_PaymentStatus.anyOverdue() to detect breaks).
 *   - Does NOT render a chip in the header anymore.
 *   - Pushes a notification into the bell-icon panel via window.logActivity
 *     once per day with the current streak count. If a break happened
 *     today, the notification reflects "Streak restarted — day 1".
 *   - Notification throttling: persist `wjp.streak.lastNotifiedDay` so we
 *     don't push a duplicate on every reload within the same day.
 *
 * State (localStorage, key "wjp.streak.v2"):
 *   { startDate, count, best, lastBreakDate, lastActive, lastNotifiedDay }
 */
(function () {
  'use strict';
  if (window._wjpStreakInstalled) return;
  window._wjpStreakInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) return;

  var LS_KEY = 'wjp.streak.v2';

  function loadState() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw) return raw;
      var legacy = JSON.parse(localStorage.getItem('wjp.streak.v1') || 'null');
      if (legacy) return { startDate: null, count: legacy.count || 0, best: legacy.best || 0, lastBreakDate: null, lastActive: legacy.lastActive || null, lastNotifiedDay: null };
    } catch (_) {}
    return { startDate: null, count: 0, best: 0, lastBreakDate: null, lastActive: null, lastNotifiedDay: null };
  }
  function save(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }

  function dayKey(d) {
    var y = d.getFullYear(), m = (d.getMonth() + 1).toString().padStart(2, '0'), x = d.getDate().toString().padStart(2, '0');
    return y + '-' + m + '-' + x;
  }
  function daysBetween(a, b) {
    var ad = new Date(a + 'T00:00:00');
    var bd = new Date(b + 'T00:00:00');
    return Math.round((bd - ad) / (24 * 60 * 60 * 1000));
  }

  function hasOverduePayment() {
    try {
      if (window.WJP_PaymentStatus && typeof window.WJP_PaymentStatus.anyOverdue === 'function') {
        var raw = JSON.parse(localStorage.getItem('wjp_budget_state') || 'null');
        return !!window.WJP_PaymentStatus.anyOverdue(raw);
      }
    } catch (_) {}
    return false;
  }

  function recompute() {
    var s = loadState();
    var today = dayKey(new Date());
    if (!s.startDate) s.startDate = today;
    if (typeof s.count !== 'number' || s.count < 1) s.count = 1;

    if (hasOverduePayment()) {
      if (s.lastBreakDate !== today) {
        s.lastBreakDate = today;
        s.count = 1;
      }
    } else {
      if (s.lastBreakDate === today) s.lastBreakDate = null;
      var anchor = s.lastBreakDate || s.startDate;
      if (!anchor) { anchor = today; s.startDate = today; }
      var n = daysBetween(anchor, today) + 1;
      if (n < 1) n = 1;
      s.count = n;
    }

    if (s.count < 1) s.count = 1;
    if ((s.best || 0) < s.count) s.best = s.count;
    s.lastActive = today;
    save(s);
    return s;
  }

  function emojiFor(count) {
    if (count >= 365) return '🏆';
    if (count >= 100) return '🔥🔥🔥';
    if (count >= 30) return '🔥🔥';
    if (count >= 7) return '🔥';
    return '✓';
  }

  // Remove any chip a previous version may have mounted.
  function removeOldChip() {
    var el = document.getElementById('wjp-streak-chip');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // Push a daily notification into the bell panel via the host app's
  // logActivity helper. Skips if already notified today.
  function maybeNotify(s) {
    try {
      var today = dayKey(new Date());
      if (s.lastNotifiedDay === today) return;
      if (typeof window.logActivity !== 'function') return; // host not ready

      var emoji = emojiFor(s.count);
      var brokeToday = s.lastBreakDate === today;
      var title, text, priority;

      if (brokeToday) {
        title = emoji + ' Streak restarted — day 1';
        text  = 'A payment went past due. New streak begins today.';
        priority = 'high';
      } else if (s.count === 1) {
        title = emoji + ' Day 1 on track';
        text  = 'No overdue payments — keep it going.';
        priority = 'normal';
      } else {
        title = emoji + ' ' + s.count + ' days on track';
        text  = 'No overdue payments. Best streak: ' + (s.best || s.count) + ' days.';
        priority = 'normal';
      }

      window.logActivity({
        title: title,
        text: text,
        type: 'strategy',
        priority: priority,
        link: null
      });

      s.lastNotifiedDay = today;
      save(s);
    } catch (_) {}
  }

  // Wait for window.logActivity to be available (it's defined inside app.js
  // which loads after this module). Poll briefly, then notify.
  function whenReady(fn) {
    if (typeof window.logActivity === 'function' && window.appState) return fn();
    var tries = 0;
    var iv = setInterval(function () {
      if (typeof window.logActivity === 'function' && window.appState) {
        clearInterval(iv);
        fn();
      } else if (++tries > 30) { // ~15s max
        clearInterval(iv);
      }
    }, 500);
  }

  function boot() {
    removeOldChip();
    whenReady(function () {
      var s = recompute();
      maybeNotify(s);
    });
    // Tidy up if some legacy code re-mounts the chip
    setInterval(removeOldChip, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  } else {
    setTimeout(boot, 600);
  }

  window.WJP_Streak = {
    state: loadState,
    recompute: recompute,
    notifyNow: function () {
      try {
        var s = loadState();
        s.lastNotifiedDay = null;
        save(s);
      } catch (_) {}
      var s2 = recompute();
      maybeNotify(s2);
    }
  };
})();
