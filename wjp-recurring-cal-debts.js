/* wjp-recurring-cal-debts.js v2 — correct field names (nextDate, category, linkedDebtId) v1 — Recurring tab calendar polish.
 *
 *   1. Filter the Payment Calendar to show ONLY debt-type recurring payments.
 *      Detection: name contains "(min payment)" OR matches an entry in
 *      appState.debts by case-insensitive name. Non-debt items (CLaude Ai,
 *      Family expenses, etc.) are hidden from calendar cells.
 *
 *   2. Make each calendar cell clickable. Click a date → modal listing all
 *      debt bills due on that date with merchant, amount, type, frequency.
 *
 *   3. Move #rec-optimization-ai (Payment Optimization AI) panel to the
 *      BOTTOM of the recurring tab content — under the calendar/countdown
 *      grid — instead of sitting in the middle.
 *
 * Safe IIFE + install guard. Idempotent. MutationObserver re-asserts the
 * filter + move whenever the host re-renders the recurring tab.
 */
(function () {
  'use strict';
  if (window._wjpRecCalDebtsInstalled) return;
  window._wjpRecCalDebtsInstalled = true;

  function getAppState() { try { return appState; } catch (_) { return null; } }

  // ---- Debt detection ----
  function isDebtPayment(p) {
    if (!p || !p.name) return false;
    // v2: official fields — appState.recurringPayments items use category/linkedDebtId
    if (p.category && /debt|loan|credit|card/i.test(p.category)) return true;
    if (p.linkedDebtId) return true;
    if (p.debtId) return true;
    // Heuristic: name suffix
    if (/\(min payment\)/i.test(p.name)) return true;
    if (p.type && /debt|loan|credit|card/i.test(p.type)) return true;
    // Heuristic 3: name matches a debt in appState.debts (case-insensitive
    // contains, in either direction)
    var s = getAppState();
    if (s && Array.isArray(s.debts)) {
      var pn = String(p.name).toLowerCase();
      for (var i = 0; i < s.debts.length; i++) {
        var dn = String(s.debts[i].name || '').toLowerCase();
        if (!dn) continue;
        if (pn === dn || pn.indexOf(dn) !== -1 || dn.indexOf(pn) !== -1) return true;
      }
    }
    return false;
  }

  // recOccursOn mirror — when does a recurring payment occur on a given date?
  // Mirrors app.js's logic so we can compute per-date matches in our modal.
  function payOccursOn(p, date) {
    if (!p) return false;
    var d = date;
    var dom = d.getDate();
    var dow = d.getDay();
    var freq = (p.frequency || 'monthly').toLowerCase();
    var anchor = p.nextDate || p.nextDue || p.anchorDate || p.dayOfMonth;
    // Try to glean day-of-month from anchor
    var anchorDom = null;
    if (typeof anchor === 'number') anchorDom = anchor;
    else if (typeof anchor === 'string') {
      var m = anchor.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        // Pull DOM from anchor date
        var ad = new Date(anchor.length >= 10 ? anchor + 'T00:00:00' : anchor);
        if (!isNaN(ad.getTime())) anchorDom = ad.getDate();
      }
    }
    if (anchorDom == null && p.dayOfMonth) anchorDom = p.dayOfMonth;

    if (freq === 'monthly') {
      // Match the day-of-month from anchor (or 20 as common default if missing)
      return anchorDom != null && anchorDom === dom;
    }
    if (freq === 'weekly') {
      // Weekly: same day of week as anchor
      if (p.dayOfWeek != null) return Number(p.dayOfWeek) === dow;
      if (typeof anchor === 'string') {
        var aw = new Date(anchor.length >= 10 ? anchor + 'T00:00:00' : anchor);
        if (!isNaN(aw.getTime())) return aw.getDay() === dow;
      }
      return false;
    }
    if (freq === 'biweekly') {
      if (typeof anchor === 'string') {
        var ab = new Date(anchor.length >= 10 ? anchor + 'T00:00:00' : anchor);
        if (!isNaN(ab.getTime())) {
          var diff = Math.floor((d - ab) / 86400000);
          return diff >= 0 && diff % 14 === 0;
        }
      }
      return false;
    }
    if (freq === 'yearly') {
      if (typeof anchor === 'string') {
        var ay = new Date(anchor.length >= 10 ? anchor + 'T00:00:00' : anchor);
        if (!isNaN(ay.getTime())) return ay.getMonth() === d.getMonth() && ay.getDate() === d.getDate();
      }
      return false;
    }
    return false;
  }

  function debtPaymentsForDate(date) {
    var s = getAppState();
    if (!s || !Array.isArray(s.recurringPayments)) return [];
    return s.recurringPayments.filter(function (p) {
      return isDebtPayment(p) && payOccursOn(p, date);
    });
  }

  function fmtUsd(n) {
    if (!isFinite(n)) return '$0';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---- Bills-on-date modal ----
  function injectModalStyle() {
    if (document.getElementById('wjp-recdate-modal-style')) return;
    var st = document.createElement('style');
    st.id = 'wjp-recdate-modal-style';
    st.textContent = [
      '#wjp-recdate-modal { position:fixed; inset:0; z-index:100002; background:rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; padding:20px; font-family:Inter,system-ui,sans-serif; }',
      '#wjp-recdate-modal .panel { background:var(--card,#fff); color:var(--ink,#0a0a0a); max-width:460px; width:100%; border-radius:16px; border:1px solid var(--border,rgba(0,0,0,0.10)); box-shadow:0 30px 80px rgba(0,0,0,0.40); padding:22px; }',
      '#wjp-recdate-modal h3 { font-size:16px; font-weight:800; margin:0 0 4px; letter-spacing:-0.01em; }',
      '#wjp-recdate-modal .sub { font-size:11.5px; color:var(--ink-dim,var(--text-2,#6b7280)); margin-bottom:14px; }',
      '#wjp-recdate-modal .list { display:flex; flex-direction:column; gap:8px; max-height:60vh; overflow-y:auto; }',
      '#wjp-recdate-modal .item { display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--bg-3,rgba(0,0,0,0.03)); border:1px solid var(--border,rgba(0,0,0,0.08)); border-radius:10px; }',
      '#wjp-recdate-modal .item .ico { width:36px; height:36px; border-radius:8px; background:rgba(255,77,109,0.12); color:#c0594a; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }',
      '#wjp-recdate-modal .item .name { flex:1; font-size:13px; font-weight:700; color:var(--ink,#0a0a0a); }',
      '#wjp-recdate-modal .item .meta { font-size:10.5px; color:var(--ink-dim,var(--text-2,#6b7280)); margin-top:2px; font-weight:600; }',
      '#wjp-recdate-modal .item .amt { font-size:14px; font-weight:800; color:#c0594a; }',
      '#wjp-recdate-modal .total { display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid var(--border,rgba(0,0,0,0.08)); }',
      '#wjp-recdate-modal .total .lbl { font-size:11px; font-weight:700; color:var(--ink-dim,var(--text-2,#6b7280)); text-transform:uppercase; letter-spacing:0.06em; }',
      '#wjp-recdate-modal .total .val { font-size:18px; font-weight:900; color:#c0594a; letter-spacing:-0.01em; }',
      '#wjp-recdate-modal .empty { text-align:center; padding:32px 16px; color:var(--ink-dim,#6b7280); font-size:12.5px; }',
      '#wjp-recdate-modal .actions { display:flex; justify-content:flex-end; margin-top:14px; }',
      '#wjp-recdate-modal .closeBtn { padding:8px 18px; border-radius:9px; background:var(--bg-3,rgba(0,0,0,0.05)); border:1px solid var(--border,rgba(0,0,0,0.10)); color:var(--ink,#0a0a0a); font-weight:700; font-size:12px; cursor:pointer; font-family:inherit; }',
      // Make .cal-cell look clickable
      '.cal-cell:not(.empty) { cursor:pointer; transition:background-color 0.15s ease, border-color 0.15s ease; }',
      '.cal-cell:not(.empty):hover { background:rgba(31,122,74,0.08) !important; border-color:rgba(31,122,74,0.30) !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function openDateModal(date) {
    injectModalStyle();
    var existing = document.getElementById('wjp-recdate-modal');
    if (existing) existing.remove();
    var items = debtPaymentsForDate(date);
    var total = items.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var modal = document.createElement('div');
    modal.id = 'wjp-recdate-modal';
    var dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    modal.innerHTML =
      '<div class="panel">' +
        '<h3>' + dateStr + '</h3>' +
        '<div class="sub">' + (items.length === 0 ? 'Nothing scheduled' : items.length + ' debt payment' + (items.length === 1 ? '' : 's') + ' due') + '</div>' +
        (items.length === 0
          ? '<div class="empty">No debt bills due on this day.</div>'
          : '<div class="list">' + items.map(function (p) {
              var ico = /credit|card|amex|visa|venture/i.test(p.name) ? '💳' :
                       /student|aidvantage|navient/i.test(p.name) ? '🎓' :
                       /car|auto|westlake/i.test(p.name) ? '🚗' :
                       /sofi|loan/i.test(p.name) ? '🏦' : '💳';
              var meta = (p.frequency || 'monthly') + ' · ' + (p.method || 'Auto-pay');
              return '<div class="item">' +
                '<div class="ico">' + ico + '</div>' +
                '<div style="flex:1;min-width:0;">' +
                  '<div class="name">' + (p.name || 'Unknown') + '</div>' +
                  '<div class="meta">' + meta + '</div>' +
                '</div>' +
                '<div class="amt">-' + fmtUsd(p.amount || 0) + '</div>' +
              '</div>';
            }).join('') + '</div>' +
            '<div class="total"><span class="lbl">Total due</span><span class="val">-' + fmtUsd(total) + '</span></div>'
        ) +
        '<div class="actions"><button type="button" class="closeBtn" id="wjp-recdate-close">Close</button></div>' +
      '</div>';
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    document.getElementById('wjp-recdate-close').onclick = function () { modal.remove(); };
    var k = function (e) {
      if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', k); }
    };
    document.addEventListener('keydown', k);
  }

  // ---- Parse the day-of-month from a .cal-cell ----
  function dateFromCell(cell, calLabel) {
    if (!cell || cell.classList.contains('empty')) return null;
    var domText = cell.querySelector('span') || cell.firstChild;
    var domNum = parseInt((cell.textContent || '').trim().match(/^\d+/) || [], 10);
    if (!isFinite(domNum) || domNum < 1 || domNum > 31) return null;
    // Derive month/year from label e.g. "May 2026"
    var label = (calLabel && calLabel.textContent) || '';
    var m = label.match(/([A-Za-z]+)\s+(\d{4})/);
    if (!m) return null;
    var monthName = m[1];
    var year = parseInt(m[2], 10);
    var months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
                   january:0, february:1, march:2, april:3, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };
    var month = months[monthName.toLowerCase()];
    if (month == null) return null;
    return new Date(year, month, domNum);
  }

  // ---- Filter calendar cells to show only debt events ----
  function filterCalEvents() {
    var body = document.getElementById('rec-cal-body');
    if (!body) return;
    var s = getAppState();
    if (!s || !Array.isArray(s.recurringPayments)) return;
    // Build a name → isDebt lookup
    var dbg = {};
    s.recurringPayments.forEach(function (p) { dbg[(p.name || '').toLowerCase()] = isDebtPayment(p); });
    // For each .cal-event chip, check its title or text against a debt
    Array.prototype.forEach.call(body.querySelectorAll('.cal-event'), function (chip) {
      var title = chip.getAttribute('title') || chip.textContent || '';
      var lc = title.toLowerCase();
      // Match against payment names
      var isDebt = false;
      for (var k in dbg) {
        if (!k) continue;
        if (lc.indexOf(k.split(' ')[0]) !== -1 || k.indexOf(lc.split(' ')[0]) !== -1) {
          if (dbg[k]) { isDebt = true; break; }
        }
      }
      if (!isDebt) chip.style.display = 'none';
    });
    // Also handle daily/weekly view chips (different selectors)
    Array.prototype.forEach.call(body.querySelectorAll('[title*="—"]'), function (chip) {
      // chip text/title like "Avant Credit Card (min payment) — $80.00"
      var title = chip.getAttribute('title') || '';
      var name = title.split('—')[0].trim().toLowerCase();
      if (!name) return;
      var isDebt = false;
      for (var k in dbg) {
        if (k && k.indexOf(name) !== -1 || (name && name.indexOf(k) !== -1)) {
          if (dbg[k]) { isDebt = true; break; }
        }
      }
      if (!isDebt) chip.style.display = 'none';
    });
  }

  // ---- Make calendar cells clickable ----
  function wireCalCellClicks() {
    var body = document.getElementById('rec-cal-body');
    var label = document.getElementById('rec-cal-label');
    if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('.cal-cell'), function (cell) {
      if (cell._wjpClickWired) return;
      cell._wjpClickWired = true;
      cell.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var dt = dateFromCell(cell, label);
        if (dt) openDateModal(dt);
      });
    });
  }

  // ---- Move #rec-optimization-ai to the bottom of recurring tab content ----
  function movePaymentOptimizerToBottom() {
    var panel = document.getElementById('rec-optimization-ai');
    if (!panel) return;
    var parent = panel.parentElement;
    if (!parent) return;
    // Only move if it's not already the last child of the recurring subtab content
    if (parent.lastElementChild === panel) return;
    parent.appendChild(panel);
  }

  // ---- Tick / observer ----
  function tick() {
    try { filterCalEvents(); } catch (_) {}
    try { wireCalCellClicks(); } catch (_) {}
    try { movePaymentOptimizerToBottom(); } catch (_) {}
  }
  function watchRecurring() {
    var subtab = document.querySelector('.debts-subtab-content[data-subtab="recurring"]');
    if (!subtab) {
      setTimeout(watchRecurring, 1000);
      return;
    }
    tick();
    if (subtab._wjpRecCalDebtsObserved) return;
    subtab._wjpRecCalDebtsObserved = true;
    var mo = new MutationObserver(function () {
      if (subtab._wjpPending) return;
      subtab._wjpPending = true;
      requestAnimationFrame(function () {
        subtab._wjpPending = false;
        tick();
      });
    });
    mo.observe(subtab, { childList: true, subtree: true });
  }

  function boot() {
    injectModalStyle();
    watchRecurring();
    setInterval(tick, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Public API
  window.WJP_RecCalDebts = {
    isDebtPayment: isDebtPayment,
    debtPaymentsForDate: debtPaymentsForDate,
    openDateModal: openDateModal,
    version: 1
  };
})();
