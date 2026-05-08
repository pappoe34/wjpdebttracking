/* wjp-streak.js v3 — payment streak counter, mounted in top-right header.
 *
 * v1 placed the chip at top of sidebar, above the nav items — visually
 * orphaned. v2 mounts it inline with the existing header pills (Privacy
 * Mode / Sync Bank / Bank Health / +Add) so it feels like a native status
 * indicator.
 *
 * Mechanics: counts consecutive days the user has interacted with WJP.
 * Stored in localStorage per device. Once a user hits 7 days they don't
 * want to lose it — turns one-week tool into a habit.
 */
(function () {
  'use strict';
  if (window._wjpStreakInstalled) return;
  window._wjpStreakInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_KEY = 'wjp.streak.v1';
  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || { count: 0, lastActive: null, best: 0 }; }
    catch (_) { return { count: 0, lastActive: null, best: 0 }; }
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

  function bumpToday() {
    var s = loadState();
    var today = dayKey(new Date());
    if (!s.lastActive) {
      s.count = 1;
    } else if (s.lastActive === today) {
      // already counted today
    } else {
      var gap = daysBetween(s.lastActive, today);
      if (gap === 1) s.count = (s.count || 0) + 1;
      else s.count = 1;
    }
    s.lastActive = today;
    if ((s.best || 0) < s.count) s.best = s.count;
    save(s);
    return s;
  }

  // Find the pill row that holds Privacy Mode / Sync Bank / Bank Health.
  // Walk up from any of those buttons to a shared parent.
  function findHeaderPillRow() {
    var anchors = [];
    document.querySelectorAll('button, a, [role=button], [class*="pill"], [class*="btn"]').forEach(function (n) {
      var t = (n.textContent || '').toLowerCase();
      if (/privacy mode|bank health|sync bank/.test(t) && n.offsetParent !== null) anchors.push(n);
    });
    if (!anchors.length) return null;
    // Walk up until we find a parent that contains at least 2 of the anchors
    var cand = anchors[0].parentElement;
    while (cand) {
      var hits = anchors.filter(function (a) { return cand.contains(a); }).length;
      if (hits >= 2) return { row: cand, beforeNode: anchors[0] };
      cand = cand.parentElement;
    }
    return { row: anchors[0].parentElement, beforeNode: anchors[0] };
  }

  function renderChip() {
    var s = loadState();
    if (!s || !s.count) return;
    var info = findHeaderPillRow();
    if (!info) return;
    var label = s.count + ' day' + (s.count === 1 ? '' : 's') + ' streak';
    var existing = document.getElementById('wjp-streak-chip');
    // If existing chip lives outside the right header row, remove it (cleanup of v1 placement)
    if (existing && existing.parentElement !== info.row) {
      try { existing.remove(); } catch (_) {}
      existing = null;
    }
    var html = ''
      + '<button type="button" id="wjp-streak-chip" '
      +   'title="Login streak — ' + label + ' (best: ' + (s.best || s.count) + ')" '
      +   'style="display:inline-flex;align-items:center;gap:7px;'
      +   'padding:0;border-radius:0;'
      +   'font-family:var(--sans,Inter,system-ui,sans-serif);'
      +   'font-size:12.5px;font-weight:600;color:var(--ink,#0a0a0a);'
      +   'cursor:default;line-height:1;">'
      +   '<span aria-hidden="true" style="font-size:13px;line-height:1;display:inline-block;transform:translateY(-0.5px);">🔥</span>'
      +   '<span><b style="font-weight:700;">' + s.count + '</b> day' + (s.count === 1 ? '' : 's') + ' streak</span>'
      + '</button>';
    if (existing) {
      if (existing.dataset.wjpHtml === html) return;
      existing.outerHTML = html;
      var fresh = document.getElementById('wjp-streak-chip');
      if (fresh) fresh.dataset.wjpHtml = html;
      return;
    }
    // Insert before the first existing pill in the row so streak appears left-most
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var chip = wrap.firstElementChild;
    info.row.insertBefore(chip, info.beforeNode);
    chip.dataset.wjpHtml = html;
  }

  function tick() {
    try { bumpToday(); renderChip(); }
    catch (e) { try { console.warn('[wjp-streak] threw', e); } catch (_) {} }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_Streak = { state: loadState, bump: bumpToday, refresh: renderChip };
})();
