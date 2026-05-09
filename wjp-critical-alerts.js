/* wjp-critical-alerts.js v3 — popup modal driven by WJP_PaymentStatus.
 *
 * Improvements over v2:
 *   - Cross-checks Plaid transactions: if a payment matches an rp.amount near
 *     rp.nextDate, the bill is treated as PAID and skipped.
 *   - Skips schedules that are >14 days stale (user clearly stopped using them).
 *   - Per-row quick actions:
 *       "Already paid" → records a 35-day paid override (suppresses the
 *                        alert until the next cycle).
 *       "Not a bill"   → adds it to the user's blocklist (this entry never
 *                        triggers an alert again).
 *   - "View" → still navigates to the bill.
 *   - Click backdrop / × / ESC → close.
 *   - Shows once per browser tab session.
 *   - If, after filtering, no items are critical, the modal does not show.
 */
(function () {
  'use strict';
  if (window._wjpCriticalAlertsInstalled) return;
  window._wjpCriticalAlertsInstalled = true;
  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) return;

  var SESSION_FLAG = 'wjp.critAlerts.shownThisSession';

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getDate().toString().padStart(2,'0');
  }
  function fmtUSD(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  }
  function dayDelta(targetIso) {
    var t = new Date(targetIso + 'T00:00:00').getTime();
    var n = new Date(todayKey() + 'T00:00:00').getTime();
    return Math.round((t - n) / 86400000);
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getDate().toString().padStart(2,'0');
  }

  function buildAlerts() {
    var alerts = [];
    var raw;
    try { raw = JSON.parse(localStorage.getItem('wjp_budget_state') || 'null'); } catch (_) {}
    if (!raw) return alerts;
    var ps = window.WJP_PaymentStatus;
    if (!ps) return alerts; // helper not loaded — fail closed (no alerts)
    var txns = raw.transactions || [];

    (raw.recurringPayments || []).forEach(function (rp) {
      var status = ps.classify(rp, txns);
      // Only surface actionable statuses
      if (status !== 'overdue' && status !== 'today' && status !== 'soon') return;
      var iso = String(rp.nextDate).slice(0, 10);
      var delta = dayDelta(iso);
      var color, icon, subtitle, priority;
      if (status === 'overdue') {
        color = '#ef4444'; icon = '⚠';
        subtitle = Math.abs(delta) + ' day' + (Math.abs(delta) === 1 ? '' : 's') + ' overdue';
        priority = 100 + Math.abs(delta);
      } else if (status === 'today') {
        color = '#f97316'; icon = '⏰';
        subtitle = 'Due today';
        priority = 80;
      } else {
        color = '#fbbf24'; icon = '📅';
        subtitle = 'Due in ' + delta + ' day' + (delta === 1 ? '' : 's');
        priority = 60 - delta;
      }
      alerts.push({
        severity: status,
        priority: priority,
        rpId: rp.id,
        nextDate: iso,
        name: rp.name || 'Payment',
        amount: rp.amount,
        subtitle: subtitle,
        color: color,
        icon: icon
      });
    });

    // High-priority unread notifications (last 24h)
    var since = Date.now() - 24*3600*1000;
    (raw.notifications || []).forEach(function (n) {
      if (!n || n.read) return;
      var ts = n.timestamp || n.createdAt || 0;
      if (ts < since) return;
      var pri = (n.priority || n.severity || 'normal').toLowerCase();
      if (pri !== 'high' && pri !== 'critical' && pri !== 'urgent') return;
      alerts.push({
        severity: 'notif', priority: 40, rpId: null, nextDate: null,
        name: n.title || n.message || 'Notification', amount: null,
        subtitle: (n.body || n.detail || '').slice(0, 80) || 'High-priority notification',
        color: '#a78bfa', icon: '🔔'
      });
    });

    alerts.sort(function (a, b) { return b.priority - a.priority; });
    return alerts.slice(0, 6);
  }

  function close() {
    var modal = document.getElementById('wjp-crit-alerts-modal');
    if (!modal) return;
    modal.style.opacity = '0';
    setTimeout(function () { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 180);
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

  function jumpToBill(rpId, name) {
    try {
      var debtsNav = document.querySelector('[data-page="debts"]');
      if (debtsNav) debtsNav.click();
      setTimeout(function () {
        var subs = document.querySelectorAll('.debts-subtabs .subtab');
        var rec = null;
        subs.forEach(function (s) { if (/recurring/i.test(s.textContent || '')) rec = s; });
        if (rec) rec.click();
        setTimeout(function () {
          var tiles = document.querySelectorAll('.wjp-rt-tile, [class*="recurring-tile"], [data-rp-id]');
          var hit = null;
          tiles.forEach(function (t) {
            if (rpId && t.getAttribute('data-rp-id') === rpId) hit = t;
            if (!hit && name) {
              var rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
              if (rx.test(t.textContent || '')) hit = t;
            }
          });
          if (hit && hit.scrollIntoView) {
            hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var prev = hit.style.boxShadow;
            hit.style.transition = 'box-shadow 0.4s';
            hit.style.boxShadow = '0 0 0 3px #f97316';
            setTimeout(function () { hit.style.boxShadow = prev || ''; }, 1500);
          }
        }, 300);
      }, 120);
    } catch (_) {}
  }

  function rerender() {
    var modal = document.getElementById('wjp-crit-alerts-modal');
    if (modal) modal.remove();
    try { sessionStorage.removeItem(SESSION_FLAG); } catch (_) {}
    render();
  }

  function render() {
    try {
      if (sessionStorage.getItem(SESSION_FLAG) === '1') return;
      // Wait until WJP_PaymentStatus has loaded
      if (!window.WJP_PaymentStatus) {
        setTimeout(render, 250);
        return;
      }
      var alerts = buildAlerts();
      if (!alerts.length) {
        try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch (_) {}
        return;
      }
      if (document.getElementById('wjp-crit-alerts-modal')) return;
      try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch (_) {}

      var topColor = alerts[0].color;
      var heading = alerts[0].severity === 'overdue'
        ? 'Action required'
        : (alerts[0].severity === 'today' ? 'Due today' : 'Heads up');

      var rowsHTML = alerts.map(function (a, idx) {
        var amt = a.amount != null ? fmtUSD(a.amount) : '';
        var actionsHTML = '';
        if (a.rpId) {
          actionsHTML =
            '<div style="display:flex;gap:6px;margin-top:6px;">'
          +   '<button data-act="view" data-idx="' + idx + '" '
          +     'style="background:transparent;color:var(--ink, #0a0a0a);border:1px solid var(--border, rgba(255,255,255,0.15));padding:4px 10px;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;">View</button>'
          +   '<button data-act="paid" data-idx="' + idx + '" '
          +     'style="background:rgba(34,197,94,0.10);color:#22c55e;border:1px solid #22c55e;padding:4px 10px;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;">Already paid</button>'
          +   '<button data-act="notbill" data-idx="' + idx + '" '
          +     'style="background:transparent;color:var(--ink-dim, #6b7280);border:1px solid var(--border, rgba(255,255,255,0.10));padding:4px 10px;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;font-family:inherit;">Not a bill</button>'
          + '</div>';
        }
        return '<div data-idx="' + idx + '" '
             + 'style="padding:10px 12px;border:1px solid var(--border, rgba(255,255,255,0.10));'
             + 'border-left:3px solid ' + a.color + ';'
             + 'background:var(--card-1, rgba(255,255,255,0.03));border-radius:10px;'
             + 'margin-bottom:8px;">'
             +   '<div style="display:flex;align-items:center;gap:10px;">'
             +     '<span style="font-size:18px;flex-shrink:0;">' + a.icon + '</span>'
             +     '<div style="flex:1;min-width:0;">'
             +       '<div style="font-weight:700;font-size:14px;color:var(--ink, #0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.name) + '</div>'
             +       '<div style="font-size:12px;color:' + a.color + ';font-weight:600;">' + escapeHtml(a.subtitle) + (amt ? ' · ' + amt : '') + '</div>'
             +     '</div>'
             +   '</div>'
             +   actionsHTML
             + '</div>';
      }).join('');

      var html =
        '<div id="wjp-crit-alerts-modal" '
        +   'style="position:fixed;inset:0;z-index:99997;display:flex;align-items:center;justify-content:center;'
        +     'background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);padding:20px;opacity:0;transition:opacity 0.18s;">'
        +   '<div id="wjp-crit-alerts-box" '
        +     'style="background:var(--card, #fff);border:1px solid ' + topColor + ';'
        +       'border-radius:18px;padding:20px 22px 16px;max-width:520px;width:100%;'
        +       'box-shadow:0 20px 60px rgba(0,0,0,0.45);transform:translateY(8px);transition:transform 0.22s;'
        +       'max-height:80vh;overflow-y:auto;">'
        +     '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        +       '<div>'
        +         '<div style="font-size:10px;color:' + topColor + ';font-weight:800;text-transform:uppercase;letter-spacing:0.12em;">' + heading + '</div>'
        +         '<div style="font-size:18px;font-weight:900;color:var(--ink, #0a0a0a);margin-top:2px;">' + alerts.length + ' item' + (alerts.length === 1 ? '' : 's') + ' need attention</div>'
        +       '</div>'
        +       '<button id="wjp-crit-close" aria-label="Close" '
        +         'style="background:transparent;border:0;color:var(--ink-dim, #6b7280);font-size:22px;line-height:1;cursor:pointer;padding:4px 8px;">×</button>'
        +     '</div>'
        +     rowsHTML
        +     '<div style="margin-top:8px;font-size:11px;color:var(--ink-faint, #94a3b8);text-align:center;">'
        +       'click outside to close · use the buttons to clean up false alerts'
        +     '</div>'
        +   '</div>'
        + '</div>';

      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstChild);

      requestAnimationFrame(function () {
        var modal = document.getElementById('wjp-crit-alerts-modal');
        var box = document.getElementById('wjp-crit-alerts-box');
        if (modal) modal.style.opacity = '1';
        if (box) box.style.transform = 'translateY(0)';
      });

      var modal = document.getElementById('wjp-crit-alerts-modal');
      var btnX  = document.getElementById('wjp-crit-close');
      if (modal) modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
      if (btnX) btnX.addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);

      // Wire per-row actions
      modal.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          var a = alerts[idx];
          var act = btn.getAttribute('data-act');
          if (!a) return;
          if (act === 'view')   { jumpToBill(a.rpId, a.name); close(); return; }
          if (act === 'paid')   {
            // Mark paid through nextDate + 35 days (covers monthly cycle)
            var through = a.nextDate ? addDays(a.nextDate, 35) : addDays(todayKey(), 35);
            window.WJP_PaymentStatus.markPaidThrough(a.rpId, through);
            rerender();
            return;
          }
          if (act === 'notbill') {
            window.WJP_PaymentStatus.markNotBill(a.rpId);
            window.WJP_PaymentStatus.markNotBill(a.name);
            rerender();
            return;
          }
        });
      });
    } catch (e) { try { console.warn('[wjp-critical-alerts v3] threw', e); } catch (_) {} }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(render, 700); });
  } else {
    setTimeout(render, 700);
  }

  window.WJP_CriticalAlerts = {
    open: function () { try { sessionStorage.removeItem(SESSION_FLAG); } catch (_) {} render(); },
    close: close,
    build: buildAlerts
  };
})();
