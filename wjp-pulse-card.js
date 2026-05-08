/* wjp-pulse-card.js — period-over-period delta chip on the Spending Tracker.
 *
 * The Spending Tracker has Daily/Weekly/Monthly/Yearly tabs but doesn't tell
 * the user whether the current period is up or down vs. the previous one.
 * Without that context, the big number is meaningless.
 *
 * This module reads the current "Spent $X" header, snapshots it per period
 * to localStorage, and renders a small "▲ $312 vs same period last week"
 * chip next to the number.
 *
 * No backend, no Plaid roundtrip — just local snapshotting that builds up
 * over the user's session history.
 */
(function () {
  'use strict';
  if (window._wjpPulseInstalled) return;
  window._wjpPulseInstalled = true;
  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var LS_KEY = 'wjp.pulse.snapshots.v1';
  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (_) { return {}; } }
  function save(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (_) {} }

  function fmtUSD(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function parseUSD(s) {
    if (!s) return null;
    var m = String(s).replace(/[$,\s]/g, '').match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  }

  function getActivePeriod() {
    // Look for an active Spending Tracker tab
    var tracker = Array.from(document.querySelectorAll('[class*="spending"], div, section')).find(function (n) {
      return /spending\s+tracker/i.test((n.textContent || '').slice(0, 80));
    });
    if (!tracker) return null;
    var tabs = tracker.querySelectorAll('button, [role=tab], [class*="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var label = (t.textContent || '').trim().toLowerCase();
      if (!label) continue;
      var isActive = (t.classList && (t.classList.contains('active') || t.classList.contains('selected')))
        || /background:\s*(?:#1f7a4a|var\(--accent)/i.test(t.getAttribute('style') || '');
      if (isActive && /^(daily|weekly|monthly|yearly|year|all years)$/.test(label)) {
        return { period: label.replace(/\s+/g, '_'), tracker: tracker };
      }
    }
    return { period: 'daily', tracker: tracker };
  }

  function tick() {
    try {
      var info = getActivePeriod();
      if (!info) return;
      // Find the SPENT figure inside this tracker
      var spentEl = Array.from(info.tracker.querySelectorAll('div, span')).find(function (n) {
        var t = (n.textContent || '').trim();
        return /^-?\$[\d,]+(\.\d+)?$/.test(t) && parseUSD(t) > 50;
      });
      if (!spentEl) return;
      var amt = parseUSD(spentEl.textContent);
      if (!isFinite(amt)) return;

      // Snapshot key: period + dayKey
      var d = new Date();
      var key = info.period;
      var snap = load();
      if (!snap[key]) snap[key] = [];
      // Push current measurement (de-dup if last entry was within 60 sec)
      var now = Date.now();
      var last = snap[key][snap[key].length - 1];
      if (!last || now - last.t > 60000 || Math.abs(last.v - amt) > 1) {
        snap[key].push({ t: now, v: amt });
        // Cap history at 500 entries per period
        if (snap[key].length > 500) snap[key] = snap[key].slice(-500);
        save(snap);
      }

      // Find a baseline: the snapshot from one period ago.
      // Daily → 24h ago. Weekly → 7d ago. Monthly → 30d ago. Yearly → 365d ago.
      var lookbackMs = key === 'daily' ? 24 * 3600e3
                     : key === 'weekly' ? 7 * 24 * 3600e3
                     : key === 'monthly' ? 30 * 24 * 3600e3
                     : key === 'yearly' || key === 'year' ? 365 * 24 * 3600e3
                     : 7 * 24 * 3600e3;
      var target = now - lookbackMs;
      var baseline = null;
      for (var i = snap[key].length - 1; i >= 0; i--) {
        if (snap[key][i].t <= target) { baseline = snap[key][i].v; break; }
      }

      // Mount the pulse chip right next to the spent figure
      var existing = info.tracker.querySelector('#wjp-pulse-chip');
      if (baseline == null) {
        // Not enough history — show "tracking…" subtle badge once
        if (!existing) {
          var t1 = document.createElement('div');
          t1.id = 'wjp-pulse-chip';
          t1.style.cssText = 'display:inline-block;margin-top:6px;font-size:10.5px;letter-spacing:0.06em;color:#9ca3af;font-weight:600;font-family:var(--sans,Inter,system-ui,sans-serif);';
          t1.textContent = 'Tracking — comparison available next visit';
          if (spentEl.parentNode) spentEl.parentNode.appendChild(t1);
        }
        return;
      }
      var delta = amt - baseline;
      var pct = baseline > 0 ? Math.round((delta / baseline) * 100) : 0;
      var arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
      var color = delta > 0 ? '#dc2626' : delta < 0 ? '#1f7a4a' : '#9ca3af';
      var bg = delta > 0 ? 'rgba(220,38,38,0.10)' : delta < 0 ? 'rgba(31,122,74,0.10)' : 'rgba(0,0,0,0.05)';
      var sign = delta > 0 ? '+' : '';
      var label = arrow + ' ' + sign + fmtUSD(delta) + ' (' + sign + pct + '%) vs same period before';
      if (existing && existing.dataset.wjpHtml === label) return;
      var html = '<span id="wjp-pulse-chip" data-wjp-html="' + label + '" '
        + 'style="display:inline-block;margin-top:6px;padding:4px 10px;border-radius:999px;'
        + 'background:' + bg + ';color:' + color + ';'
        + 'font-size:11px;font-weight:700;letter-spacing:0.01em;'
        + 'font-family:var(--sans,Inter,system-ui,sans-serif);">' + label + '</span>';
      if (existing) existing.outerHTML = html;
      else if (spentEl.parentNode) spentEl.parentNode.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      try { console.warn('[wjp-pulse] threw', e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 1200);
    setInterval(tick, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_Pulse = { refresh: tick, _state: load, _reset: function(){ try{localStorage.removeItem(LS_KEY);}catch(_){} } };
})();
