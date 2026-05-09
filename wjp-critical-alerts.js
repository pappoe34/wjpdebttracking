/* wjp-critical-alerts.js v1 — show urgent items at the top of the dashboard
 * the first time it loads each day.
 *
 * What counts as "critical" (in priority order, highest first):
 *   1. Overdue payments (recurringPayments where nextDate < today, not paid)
 *   2. Bills due today
 *   3. Bills due in the next 3 days
 *   4. Recent unread high-priority notifications
 *
 * UX:
 *   - Renders as a top-of-dashboard banner above Executive Summary, NOT a
 *     blocking modal — the user can still see the rest of the page.
 *   - "Snooze for today" hides it for 24 hours; reappears tomorrow.
 *   - Each alert has a quick-action: jump to the relevant payment.
 *   - Per-user dismiss state via WJP_UserScope if available, else bare key.
 *   - Only injects on /index.html (the dashboard route).
 */
(function () {
  'use strict';
  if (window._wjpCriticalAlertsInstalled) return;
  window._wjpCriticalAlertsInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) {
    return;
  }

  var DISMISS_KEY = 'wjp.critAlerts.dismissed.v1';

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      (d.getMonth() + 1).toString().padStart(2, '0') + '-' +
      d.getDate().toString().padStart(2, '0');
  }

  function getDismissed() {
    try {
      if (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function') {
        return window.WJP_UserScope.get(DISMISS_KEY);
      }
      return localStorage.getItem(DISMISS_KEY);
    } catch (_) { return null; }
  }
  function setDismissed(val) {
    try {
      if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function') {
        window.WJP_UserScope.set(DISMISS_KEY, val);
      } else {
        localStorage.setItem(DISMISS_KEY, val);
      }
    } catch (_) {}
  }

  function fmtUSD(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  }

  function dayDelta(targetIso) {
    var t = new Date(targetIso + 'T00:00:00').getTime();
    var n = new Date(todayKey() + 'T00:00:00').getTime();
    return Math.round((t - n) / 86400000);
  }

  function buildAlerts() {
    var alerts = [];
    var raw;
    try { raw = JSON.parse(localStorage.getItem('wjp_budget_state') || 'null'); } catch (_) {}
    if (!raw) return alerts;

    // OVERDUE + DUE-SOON from recurringPayments
    (raw.recurringPayments || []).forEach(function (rp) {
      if (!rp || !rp.nextDate) return;
      if (rp.linkedIncome) return;
      if ((rp.category || '').toLowerCase() === 'income') return;
      if (rp.status === 'cancelled' || rp.status === 'paused') return;
      var iso = String(rp.nextDate).slice(0, 10);
      var delta = dayDelta(iso);
      if (delta < 0) {
        alerts.push({
          severity: 'overdue',
          priority: 100 + Math.abs(delta), // older = more urgent
          title: rp.name || 'Payment',
          subtitle: Math.abs(delta) + ' day' + (Math.abs(delta) === 1 ? '' : 's') + ' overdue · ' + fmtUSD(rp.amount),
          color: '#ef4444',
          icon: '⚠'
        });
      } else if (delta === 0) {
        alerts.push({
          severity: 'today',
          priority: 80,
          title: rp.name || 'Payment',
          subtitle: 'Due today · ' + fmtUSD(rp.amount),
          color: '#f97316',
          icon: '⏰'
        });
      } else if (delta <= 3) {
        alerts.push({
          severity: 'soon',
          priority: 60 - delta,
          title: rp.name || 'Payment',
          subtitle: 'Due in ' + delta + ' day' + (delta === 1 ? '' : 's') + ' · ' + fmtUSD(rp.amount),
          color: '#fbbf24',
          icon: '📅'
        });
      }
    });

    // High-priority unread notifications (last 24h)
    var since = Date.now() - 24 * 3600 * 1000;
    (raw.notifications || []).forEach(function (n) {
      if (!n || n.read) return;
      var ts = n.timestamp || n.createdAt || 0;
      if (ts < since) return;
      var pri = n.priority || n.severity || 'normal';
      if (pri !== 'high' && pri !== 'critical' && pri !== 'urgent') return;
      alerts.push({
        severity: 'notif',
        priority: 40,
        title: n.title || n.message || 'Notification',
        subtitle: (n.body || n.detail || '').slice(0, 80),
        color: '#a78bfa',
        icon: '🔔'
      });
    });

    alerts.sort(function (a, b) { return b.priority - a.priority; });
    return alerts.slice(0, 5); // cap at 5 most urgent
  }

  function render() {
    try {
      // Skip if user already dismissed today
      if (getDismissed() === todayKey()) return;

      var alerts = buildAlerts();
      if (!alerts.length) return;

      // Mount above Executive Summary on the dashboard page
      var dashPage = document.getElementById('page-dashboard') ||
                     document.querySelector('[data-page="dashboard"]') ||
                     document.querySelector('.dashboard') ||
                     document.body;
      if (!dashPage) return;

      // Idempotent: remove any prior render
      var prev = document.getElementById('wjp-critical-alerts');
      if (prev) prev.remove();

      var topColor = alerts[0].color;
      var label = alerts[0].severity === 'overdue'
        ? 'Action required'
        : (alerts[0].severity === 'today' ? 'Due today' : 'Heads up');

      var rowsHTML = alerts.map(function (a) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--rule, rgba(255,255,255,0.06));">'
             +   '<span style="font-size:16px;">' + a.icon + '</span>'
             +   '<div style="flex:1;min-width:0;">'
             +     '<div style="font-weight:700;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.title) + '</div>'
             +     '<div style="font-size:11px;color:' + a.color + ';font-weight:600;">' + escapeHtml(a.subtitle) + '</div>'
             +   '</div>'
             + '</div>';
      }).join('');

      var html =
        '<div id="wjp-critical-alerts" style="'
        +   'background:var(--card);border:1px solid ' + topColor + ';'
        +   'border-left:4px solid ' + topColor + ';border-radius:14px;'
        +   'padding:14px 18px;margin-bottom:16px;box-shadow:0 4px 18px rgba(0,0,0,0.10);'
        + '">'
        +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        +     '<div style="display:flex;align-items:center;gap:8px;">'
        +       '<span style="font-size:9px;color:' + topColor + ';font-weight:800;text-transform:uppercase;letter-spacing:0.1em;">' + label + '</span>'
        +       '<span style="font-size:10px;color:var(--ink-faint);font-weight:600;">' + alerts.length + ' item' + (alerts.length === 1 ? '' : 's') + ' need attention</span>'
        +     '</div>'
        +     '<button id="wjp-crit-snooze" style="background:transparent;border:1px solid var(--border, rgba(255,255,255,0.15));color:var(--ink-dim);padding:4px 10px;border-radius:8px;font-size:10px;font-weight:700;cursor:pointer;">SNOOZE TODAY</button>'
        +   '</div>'
        +   rowsHTML
        + '</div>';

      // Insert at top of dashboard, above the first child
      dashPage.insertAdjacentHTML('afterbegin', html);

      var btn = document.getElementById('wjp-crit-snooze');
      if (btn) btn.onclick = function () {
        setDismissed(todayKey());
        var el = document.getElementById('wjp-critical-alerts');
        if (el) { el.style.transition = 'opacity 0.25s, transform 0.25s'; el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; setTimeout(function () { el.remove(); }, 260); }
      };
    } catch (e) { try { console.warn('[wjp-critical-alerts] threw', e); } catch (_) {} }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // Render on DOM ready, then re-render every 60s in case data changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(render, 700); });
  } else {
    setTimeout(render, 700);
  }
  setInterval(render, 60000);

  window.WJP_CriticalAlerts = { render: render, build: buildAlerts };
})();
