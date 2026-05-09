/* wjp-critical-alerts.js v2 — popup modal on app open with critical updates.
 *
 * Behavior:
 *   - Shows ONCE per session (per browser tab) — not on every navigation.
 *   - Centered modal with overdue / due-today / due-soon items.
 *   - Click outside the box (on the backdrop) → close.
 *   - Click a specific bill row → navigate to Recurring Payments tab AND
 *     close the modal.
 *   - ESC key → close.
 *   - If there are no critical items, the modal does NOT show.
 *   - No dashboard injection — this is purely a transient overlay.
 */
(function () {
  'use strict';
  if (window._wjpCriticalAlertsInstalled) return;
  window._wjpCriticalAlertsInstalled = true;

  if (location.pathname && location.pathname !== '/' &&
      !/index\.html?$/.test(location.pathname)) {
    return;
  }

  // Use sessionStorage so it shows once per tab session, not once per day.
  // The user opens the app → sees alerts → dismisses → doesn't re-pop until
  // they reload or open a new tab.
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

  function buildAlerts() {
    var alerts = [];
    var raw;
    try { raw = JSON.parse(localStorage.getItem('wjp_budget_state') || 'null'); } catch (_) {}
    if (!raw) return alerts;

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
          priority: 100 + Math.abs(delta),
          rpId: rp.id,
          name: rp.name || 'Payment',
          amount: rp.amount,
          subtitle: Math.abs(delta) + ' day' + (Math.abs(delta) === 1 ? '' : 's') + ' overdue',
          color: '#ef4444',
          icon: '⚠'
        });
      } else if (delta === 0) {
        alerts.push({
          severity: 'today',
          priority: 80,
          rpId: rp.id,
          name: rp.name || 'Payment',
          amount: rp.amount,
          subtitle: 'Due today',
          color: '#f97316',
          icon: '⏰'
        });
      } else if (delta <= 3) {
        alerts.push({
          severity: 'soon',
          priority: 60 - delta,
          rpId: rp.id,
          name: rp.name || 'Payment',
          amount: rp.amount,
          subtitle: 'Due in ' + delta + ' day' + (delta === 1 ? '' : 's'),
          color: '#fbbf24',
          icon: '📅'
        });
      }
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
        severity: 'notif',
        priority: 40,
        rpId: null,
        name: n.title || n.message || 'Notification',
        amount: null,
        subtitle: (n.body || n.detail || '').slice(0, 80) || 'High-priority notification',
        color: '#a78bfa',
        icon: '🔔'
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

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  // Click handler: navigate to Recurring Payments tab and try to scroll/highlight
  // the targeted bill, then close the modal.
  function onBillClick(rpId, name) {
    try {
      // Switch to Debts page
      var debtsNav = document.querySelector('[data-page="debts"]');
      if (debtsNav) debtsNav.click();
      // Then to Recurring Payments sub-tab (3rd subtab on Debts page)
      setTimeout(function () {
        var subs = document.querySelectorAll('.debts-subtabs .subtab');
        var rec = null;
        subs.forEach(function (s) {
          if (/recurring/i.test(s.textContent || '')) rec = s;
        });
        if (rec) rec.click();
        // Try to highlight the matching tile
        setTimeout(function () {
          var tiles = document.querySelectorAll('.wjp-rt-tile, [class*="recurring-tile"], [data-rp-id]');
          var hit = null;
          tiles.forEach(function (t) {
            if (rpId && t.getAttribute('data-rp-id') === rpId) hit = t;
            if (!hit && name && new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t.textContent || '')) hit = t;
          });
          if (hit && hit.scrollIntoView) {
            hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // brief highlight
            var prevBoxShadow = hit.style.boxShadow;
            hit.style.transition = 'box-shadow 0.4s';
            hit.style.boxShadow = '0 0 0 3px #f97316';
            setTimeout(function () { hit.style.boxShadow = prevBoxShadow || ''; }, 1500);
          }
        }, 300);
      }, 120);
    } catch (_) {}
    close();
  }

  function render() {
    try {
      // Skip if already shown this session
      if (sessionStorage.getItem(SESSION_FLAG) === '1') return;

      var alerts = buildAlerts();
      if (!alerts.length) {
        // Mark as shown so we don't poll endlessly
        try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch (_) {}
        return;
      }

      // Idempotent: if modal already open, don't double-render
      if (document.getElementById('wjp-crit-alerts-modal')) return;

      try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch (_) {}

      var topColor = alerts[0].color;
      var heading = alerts[0].severity === 'overdue'
        ? 'Action required'
        : (alerts[0].severity === 'today' ? 'Due today' : 'Heads up');

      var rowsHTML = alerts.map(function (a, idx) {
        var amt = a.amount != null ? fmtUSD(a.amount) : '';
        return '<button data-idx="' + idx + '" class="wjp-crit-row" '
             + 'style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;'
             + 'padding:12px 14px;border:1px solid var(--border, rgba(255,255,255,0.10));'
             + 'border-left:3px solid ' + a.color + ';'
             + 'background:var(--card-1, rgba(255,255,255,0.03));border-radius:10px;'
             + 'cursor:pointer;font-family:inherit;color:inherit;margin-bottom:8px;'
             + 'transition:transform 0.15s, background 0.15s;">'
             +   '<span style="font-size:18px;flex-shrink:0;">' + a.icon + '</span>'
             +   '<div style="flex:1;min-width:0;">'
             +     '<div style="font-weight:700;font-size:14px;color:var(--ink, #0a0a0a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.name) + '</div>'
             +     '<div style="font-size:12px;color:' + a.color + ';font-weight:600;">' + escapeHtml(a.subtitle) + (amt ? ' · ' + amt : '') + '</div>'
             +   '</div>'
             +   '<span style="color:var(--ink-faint, #94a3b8);font-size:12px;flex-shrink:0;">→</span>'
             + '</button>';
      }).join('');

      var html =
        '<div id="wjp-crit-alerts-modal" '
        +   'style="position:fixed;inset:0;z-index:99997;display:flex;align-items:center;justify-content:center;'
        +     'background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);padding:20px;'
        +     'opacity:0;transition:opacity 0.18s;">'
        +   '<div id="wjp-crit-alerts-box" '
        +     'style="background:var(--card, #fff);border:1px solid ' + topColor + ';'
        +       'border-radius:18px;padding:22px 22px 18px;max-width:480px;width:100%;'
        +       'box-shadow:0 20px 60px rgba(0,0,0,0.45);'
        +       'transform:translateY(8px);transition:transform 0.22s;">'
        +     '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
        +       '<div>'
        +         '<div style="font-size:10px;color:' + topColor + ';font-weight:800;text-transform:uppercase;letter-spacing:0.12em;">' + heading + '</div>'
        +         '<div style="font-size:18px;font-weight:900;color:var(--ink, #0a0a0a);margin-top:2px;">' + alerts.length + ' item' + (alerts.length === 1 ? '' : 's') + ' need attention</div>'
        +       '</div>'
        +       '<button id="wjp-crit-close" aria-label="Close" '
        +         'style="background:transparent;border:0;color:var(--ink-dim, #6b7280);font-size:22px;line-height:1;'
        +         'cursor:pointer;padding:4px 8px;">×</button>'
        +     '</div>'
        +     rowsHTML
        +     '<div style="margin-top:6px;font-size:11px;color:var(--ink-faint, #94a3b8);text-align:center;">'
        +       'click a bill to jump to it · click outside to close'
        +     '</div>'
        +   '</div>'
        + '</div>';

      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstChild);

      // Animate in
      requestAnimationFrame(function () {
        var modal = document.getElementById('wjp-crit-alerts-modal');
        var box = document.getElementById('wjp-crit-alerts-box');
        if (modal) modal.style.opacity = '1';
        if (box) box.style.transform = 'translateY(0)';
      });

      // Wire close handlers
      var modal = document.getElementById('wjp-crit-alerts-modal');
      var box   = document.getElementById('wjp-crit-alerts-box');
      var btnX  = document.getElementById('wjp-crit-close');

      if (modal) {
        modal.addEventListener('click', function (e) {
          // Click backdrop (modal itself, not box) closes
          if (e.target === modal) close();
        });
      }
      if (btnX) btnX.addEventListener('click', close);
      document.addEventListener('keydown', onKey, true);

      // Wire each bill row click
      modal.querySelectorAll('.wjp-crit-row').forEach(function (rowEl) {
        rowEl.addEventListener('mouseenter', function () {
          rowEl.style.transform = 'translateX(2px)';
          rowEl.style.background = 'var(--card-2, rgba(255,255,255,0.07))';
        });
        rowEl.addEventListener('mouseleave', function () {
          rowEl.style.transform = '';
          rowEl.style.background = 'var(--card-1, rgba(255,255,255,0.03))';
        });
        rowEl.addEventListener('click', function () {
          var idx = parseInt(rowEl.getAttribute('data-idx'), 10);
          var a = alerts[idx];
          if (!a) return close();
          if (a.severity === 'notif') return close();
          onBillClick(a.rpId, a.name);
        });
      });
    } catch (e) { try { console.warn('[wjp-critical-alerts v2] threw', e); } catch (_) {} }
  }

  // Run once on DOM ready
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
