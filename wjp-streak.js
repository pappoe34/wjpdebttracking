/* wjp-streak.js — daily-payment streak counter in sidebar.
 *
 * Counts consecutive days the user has logged into / interacted with WJP.
 * Stored in localStorage per device. Visible in sidebar header. Once a user
 * hits 7 days they don't want to lose it — turns one-week tool into a habit.
 *
 * Mechanics:
 *   - First load this session: bump streak if last-active was yesterday
 *   - If gap > 1 day: reset streak to 1
 *   - Same day: no change
 *   - Render small chip with flame icon and current count
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
      else s.count = 1; // reset
    }
    s.lastActive = today;
    if ((s.best || 0) < s.count) s.best = s.count;
    save(s);
    return s;
  }

  function renderChip() {
    var s = loadState();
    if (!s || !s.count) return;
    var sidebar = document.querySelector('.sidebar') || document.querySelector('[class*="sidebar"]');
    if (!sidebar) return;
    var existing = document.getElementById('wjp-streak-chip');
    var label = s.count + ' day' + (s.count === 1 ? '' : 's');
    var html = ''
      + '<div id="wjp-streak-chip" title="Login streak — ' + label + ' (best: ' + (s.best || s.count) + ')" '
      +   'style="margin:8px 16px 4px;padding:8px 12px;border-radius:12px;'
      +   'background:linear-gradient(135deg,rgba(220,38,38,0.10),rgba(245,158,11,0.10));'
      +   'border:1px solid rgba(245,158,11,0.25);'
      +   'display:flex;align-items:center;gap:8px;'
      +   'font-family:var(--sans,Inter,system-ui,sans-serif);">'
      +   '<span style="font-size:16px;line-height:1;" aria-hidden="true">🔥</span>'
      +   '<span style="display:flex;flex-direction:column;line-height:1.15;">'
      +     '<span style="font-size:13px;font-weight:800;color:#dc2626;letter-spacing:-0.005em;">' + label + '</span>'
      +     '<span style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;color:#92400e;font-weight:700;">streak</span>'
      +   '</span>'
      + '</div>';
    if (existing) {
      if (existing.dataset.wjpHtml === html) return;
      existing.outerHTML = html;
      return;
    }
    // Insert near sidebar top — after first child
    var first = sidebar.firstElementChild;
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    if (first && first.nextSibling) sidebar.insertBefore(wrap.firstElementChild, first.nextSibling);
    else sidebar.appendChild(wrap.firstElementChild);
    document.getElementById('wjp-streak-chip').dataset.wjpHtml = html;
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
