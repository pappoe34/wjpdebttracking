/* wjp-streak.js v6 — payment streak counter, mounted in top-right header.
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

  // Anchor on the "Search insights..." input — chip is inserted right
  // BEFORE its wrapper, so visually it lands between the left-side tabs
  // (..."Strategy") and the search bar.
  function findHeaderPillRow() {
    var input = Array.from(document.querySelectorAll('input')).find(function (i) {
      var p = (i.placeholder || '').toLowerCase();
      return p.indexOf('search insights') !== -1 && i.offsetParent !== null;
    });
    if (!input) {
      // Fallback to old behaviour if search not found
      var anchors = [];
      document.querySelectorAll('button, a, [role=button], [class*="pill"], [class*="btn"]').forEach(function (n) {
        var t = (n.textContent || '').toLowerCase();
        if (/privacy mode|bank health|sync bank/.test(t) && n.offsetParent !== null) anchors.push(n);
      });
      if (!anchors.length) return null;
      var cand = anchors[0].parentElement;
      while (cand) {
        var hits = anchors.filter(function (a) { return cand.contains(a); }).length;
        if (hits >= 2) return { row: cand, beforeNode: anchors[0] };
        cand = cand.parentElement;
      }
      return { row: anchors[0].parentElement, beforeNode: anchors[0] };
    }
    // Walk up from the input until we hit the row-level parent that holds
    // pills like "Privacy Mode" / "Sync Bank" — then we insert the chip
    // right before the search input's direct wrapper inside that row.
    var rowParent = input.parentElement;
    while (rowParent) {
      var pillSibling = Array.from(rowParent.querySelectorAll('button, a, [class*="pill"]')).find(function (n) {
        return /privacy mode|bank health|sync bank/i.test((n.textContent || ''));
      });
      if (pillSibling) break;
      rowParent = rowParent.parentElement;
    }
    if (!rowParent) rowParent = input.parentElement;
    // beforeNode is the direct child of rowParent that contains the search input
    var beforeNode = input;
    while (beforeNode.parentElement && beforeNode.parentElement !== rowParent) {
      beforeNode = beforeNode.parentElement;
    }
    return { row: rowParent, beforeNode: beforeNode };
  }

  // Pick a milestone emoji that evolves with streak length so the chip
  // visibly levels up over time. Each tier earns a fresh icon — small dose
  // of novelty without leaving the design language.
  function emojiForCount(c) {
    if (c >= 365) return { e: '👑', label: 'crown' };
    if (c >= 180) return { e: '💎', label: 'diamond' };
    if (c >= 100) return { e: '🏆', label: 'trophy' };
    if (c >= 60)  return { e: '🚀', label: 'rocket' };
    if (c >= 30)  return { e: '💪', label: 'flex' };
    if (c >= 14)  return { e: '⚡', label: 'bolt' };
    if (c >= 7)   return { e: '🌱', label: 'sprout' };
    if (c >= 3)   return { e: '🔥', label: 'fire' };
    return { e: '✨', label: 'spark' };
  }

  function renderChip() {
    var s = loadState();
    if (!s || !s.count) return;
    var info = findHeaderPillRow();
    if (!info) return;
    var icon = emojiForCount(s.count);
    var label = s.count + ' day' + (s.count === 1 ? '' : 's') + ' streak';
    var existing = document.getElementById('wjp-streak-chip');
    if (existing && existing.parentElement !== info.row) {
      try { existing.remove(); } catch (_) {}
      existing = null;
    }
    var html = ''
      + '<span id="wjp-streak-chip" '
      +   'role="status" '
      +   'title="Login streak — ' + label + ' (best: ' + (s.best || s.count) + ')" '
      +   'style="display:inline-flex;align-items:center;gap:7px;'
      +   'font-family:var(--sans,Inter,system-ui,sans-serif);'
      +   'font-size:12.5px;font-weight:600;color:var(--ink,#0a0a0a);'
      +   'cursor:default;line-height:1;user-select:none;">'
      +   '<span aria-hidden="true" style="font-size:13px;line-height:1;display:inline-block;transform:translateY(-0.5px);">' + icon.e + '</span>'
      +   '<span><b style="font-weight:700;">' + s.count + '</b> day' + (s.count === 1 ? '' : 's') + ' streak</span>'
      + '</span>';
    if (existing) {
      if (existing.dataset.wjpHtml === html) return;
      existing.outerHTML = html;
      var fresh = document.getElementById('wjp-streak-chip');
      if (fresh) fresh.dataset.wjpHtml = html;
      return;
    }
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
