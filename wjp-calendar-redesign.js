/* wjp-calendar-redesign.js v2 — replace the broken Calendar tab with a dense
 * grid that plots all events, plus notes/reminders/filters/daily totals.
 *
 * BUG that prompted this: the standalone Calendar tab's grid renders only
 * ~3-4 of 37 events. The right "Coming Up" sidebar shows everything.
 * Embedded calendar inside Debts→Recurring already plots correctly.
 *
 * This module reads events FROM the existing "Coming Up" rows (DOM
 * scrape — no app.js access needed), hides the broken grid + sidebar
 * + oversized hero, and renders our own complete calendar.
 *
 * Features in v1:
 *   - Dense month grid, all events plotted with color-coded chips
 *   - Daily total chip per day ($420)
 *   - Today highlighted
 *   - Filter chips (All / Debts / Subs / Utilities / Insurance / Income)
 *   - Notes per date + optional browser-notification reminder
 *   - Late-fee / overdue red dot
 *   - Click any day to see full payment list + add note
 *   - Compact summary card replacing the oversized hero
 */
(function () {
  'use strict';
  if (window._wjpCalRedesignInstalled) return;
  window._wjpCalRedesignInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var ROOT_ID = 'wjp-cal-root';
  var LS_NOTES = 'wjp.cal.notes.v1';
  var LS_FILTER = 'wjp.cal.filter.v1';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  var state = {
    viewMonth: new Date().getMonth(),
    viewYear: new Date().getFullYear(),
    filter: 'all',
    selectedDate: null  // 'YYYY-MM-DD'
  };
  try { state.filter = localStorage.getItem(LS_FILTER) || 'all'; } catch (_) {}

  // ===== Notes / reminders (localStorage) =====
  function loadNotes() {
    try { return JSON.parse(localStorage.getItem(LS_NOTES) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveNotes(o) { try { localStorage.setItem(LS_NOTES, JSON.stringify(o)); } catch (_) {} }
  function setNote(date, text, reminderAt) {
    var o = loadNotes();
    if (!text && !reminderAt) { delete o[date]; }
    else { o[date] = { text: text || '', reminderAt: reminderAt || null, fired: false }; }
    saveNotes(o);
  }
  function getNote(date) { return loadNotes()[date] || null; }

  // Browser Notification reminders
  var lastReminderCheck = 0;
  function checkReminders() {
    if (Date.now() - lastReminderCheck < 30000) return;
    lastReminderCheck = Date.now();
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    var notes = loadNotes();
    var now = Date.now();
    Object.keys(notes).forEach(function (date) {
      var n = notes[date];
      if (!n || !n.reminderAt || n.fired) return;
      if (now >= n.reminderAt) {
        try {
          new Notification('WJP reminder · ' + date, { body: n.text || '(no note)' });
          n.fired = true;
          saveNotes(notes);
        } catch (_) {}
      }
    });
  }

  // ===== Data harvest =====
  // Parse "Coming Up" event rows into structured events.
  // Each row text shape: "<MON DD> <name> $<amt> • <type> <status>"
  function harvestEvents() {
    var events = [];
    // Find the events container — it's a div with many children, parented inside
    // a .card under page-recurring. Find by walking from any known leaf text or
    // by looking for cards with 30+ children.
    var page = document.getElementById('page-recurring');
    if (!page) return events;
    var candidates = Array.from(page.querySelectorAll('div')).filter(function (el) {
      return el.children.length >= 10 && el.children.length <= 80
          && (el.textContent || '').indexOf('$') !== -1;
    });
    var container = null;
    for (var i = 0; i < candidates.length; i++) {
      var sample = (candidates[i].children[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (/[A-Z]{3}\s*\d{1,2}/.test(sample) && /\$/.test(sample)) {
        container = candidates[i];
        break;
      }
    }
    if (!container) return events;

    var monthIdx = {};
    ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].forEach(function (m, i) { monthIdx[m] = i; });
    var nowYear = new Date().getFullYear();
    var nowMonth = new Date().getMonth();

    Array.from(container.children).forEach(function (row) {
      var txt = (row.textContent || '').replace(/\s+/g, ' ').trim();
      // "MAR 31 Family coverage $1,000.00 • Recurring OVERDUE"
      var m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*[•·]\s*(\w[\w\s/-]*?)\s+(OVERDUE|PAID|DUE\s*\d+D|IN\s*\d+D|INCOME|UPCOMING|PENDING)$/i);
      if (!m) {
        m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*[•·]\s*(\w[\w\s/-]*)$/i);
      }
      if (!m) {
        // Bullet-less form: "MAY 15 Payday $5,000.00 INCOME"
        m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s+(OVERDUE|PAID|DUE\s*\d+D|IN\s*\d+D|INCOME|UPCOMING|PENDING)$/i);
        if (m) m = [m[0], m[1], m[2], m[3], m[4], m[5].toLowerCase(), m[5]];
      }
      if (!m) {
        // Bare form: "MAY 15 Payday $5,000.00"
        m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)$/i);
        if (m) m = [m[0], m[1], m[2], m[3], m[4], 'recurring', ''];
      }
      if (!m) return;
      var mo = monthIdx[m[1].toUpperCase()];
      if (mo == null) return;
      var d = parseInt(m[2], 10);
      // Year guess: if month < currentMonth - 6 we assume next year (calendar may roll)
      var yr = nowYear;
      if (mo < nowMonth - 6) yr += 1;
      var name = m[3].trim();
      var amt = parseFloat(m[4].replace(/,/g, ''));
      var type = (m[5] || '').toLowerCase().trim();
      var status = (m[6] || '').toUpperCase().trim();
      var category = categorize(name, type);
      events.push({
        date: yr + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
        name: name,
        amount: amt,
        type: type,
        status: status,
        category: category
      });
    });
    return events;
  }

  function categorize(name, type) {
    var s = (name + ' ' + type).toLowerCase();
    if (/payday|income|deposit|paycheck/.test(s)) return 'income';
    if (/insur|coverage/.test(s)) return 'insurance';
    if (/util|electric|gas|water|internet|power|phone/.test(s)) return 'utility';
    if (/subscrip|netflix|spotify|claude|chatgpt|disney|hulu|prime|gym|adobe/.test(s)) return 'subscription';
    if (/loan|card|credit|brightway|sofi|capital|avant|milestone|affirm|klarna|aidadvantage|westlake|account|debt/.test(s)) return 'debt';
    return 'other';
  }

  function categoryStyle(cat) {
    switch (cat) {
      case 'debt':         return { color: '#dc2626', bg: 'rgba(220,38,38,0.10)', border: 'rgba(220,38,38,0.25)' };
      case 'subscription': return { color: '#7c3aed', bg: 'rgba(124,58,237,0.10)', border: 'rgba(124,58,237,0.25)' };
      case 'utility':      return { color: '#0284c7', bg: 'rgba(2,132,199,0.10)', border: 'rgba(2,132,199,0.25)' };
      case 'insurance':    return { color: '#c99a2a', bg: 'rgba(201,154,42,0.12)', border: 'rgba(201,154,42,0.30)' };
      case 'income':       return { color: '#1f7a4a', bg: 'rgba(31,122,74,0.12)', border: 'rgba(31,122,74,0.30)' };
      default:             return { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', border: 'rgba(107,114,128,0.20)' };
    }
  }

  // ===== Helpers =====
  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return '-';
    return '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function isOverdue(ev) {
    if (ev.status === 'OVERDUE') return true;
    if (ev.status === 'PAID') return false;
    var todayK = dateKey(new Date());
    return ev.date < todayK && ev.category !== 'income';
  }

  // ===== Render =====
  function findHost() {
    var page = document.getElementById('page-recurring');
    if (!page || !page.classList.contains('active')) return null;
    return page;
  }

  function hideOriginalContent(page) {
    Array.from(page.children).forEach(function (c) {
      if (c.id === ROOT_ID) return;
      if (c.dataset && c.dataset.wjpCalHidden === '1') return;
      c.dataset.wjpCalHidden = '1';
      c.style.display = 'none';
    });
  }

  function buildHTML(events) {
    var notes = loadNotes();
    // Filter
    var filtered = state.filter === 'all'
      ? events
      : events.filter(function (e) { return e.category === state.filter; });

    // Group by date
    var byDate = {};
    filtered.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });

    // Build month grid
    var first = new Date(state.viewYear, state.viewMonth, 1);
    var startDay = first.getDay();
    var daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    var todayKey = dateKey(new Date());

    var cells = [];
    for (var i = 0; i < startDay; i++) cells.push({ blank: true });
    for (var d = 1; d <= daysInMonth; d++) {
      var k = state.viewYear + '-' + String(state.viewMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      cells.push({
        date: k,
        day: d,
        events: byDate[k] || [],
        isToday: k === todayKey,
        note: notes[k] || null
      });
    }
    while (cells.length % 7) cells.push({ blank: true });

    var weeks = [];
    for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));

    // Compute month totals
    var monthOut = 0, monthIn = 0;
    filtered.forEach(function (e) {
      if (e.date.slice(0, 7) === state.viewYear + '-' + String(state.viewMonth + 1).padStart(2, '0')) {
        if (e.category === 'income') monthIn += e.amount;
        else monthOut += e.amount;
      }
    });

    // Filter chips
    var FILTERS = [
      { k: 'all',          label: 'All',         count: events.length },
      { k: 'debt',         label: 'Debts',       count: events.filter(function(e){return e.category==='debt';}).length },
      { k: 'subscription', label: 'Subs',        count: events.filter(function(e){return e.category==='subscription';}).length },
      { k: 'utility',      label: 'Utilities',   count: events.filter(function(e){return e.category==='utility';}).length },
      { k: 'insurance',    label: 'Insurance',   count: events.filter(function(e){return e.category==='insurance';}).length },
      { k: 'income',       label: 'Income',      count: events.filter(function(e){return e.category==='income';}).length }
    ];

    var html = ''
      + '<div style="font-family:var(--sans,Inter,system-ui,sans-serif);color:var(--ink,#0a0a0a);padding:18px 0 24px;">'
      + '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">'
      +   '<div>'
      +     '<div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:4px;">Calendar</div>'
      +     '<div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">'
      +       '<span data-cal-prev style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">‹</span>'
      +       MONTHS[state.viewMonth] + ' ' + state.viewYear
      +       '<span data-cal-next style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">›</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:14px;font-size:12px;color:#6b7280;">'
      +     '<span>Out: <b style="color:#dc2626;">' + fmtUSD(monthOut) + '</b></span>'
      +     '<span>In: <b style="color:#1f7a4a;">' + fmtUSD(monthIn) + '</b></span>'
      +     '<span>Net: <b style="color:' + ((monthIn-monthOut) >= 0 ? '#1f7a4a' : '#dc2626') + ';">' + fmtUSD(monthIn-monthOut) + '</b></span>'
      +   '</div>'
      + '</div>'
      // filter chips
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
    FILTERS.forEach(function (f) {
      var active = state.filter === f.k;
      var cs = f.k === 'all' ? { color: '#0a0a0a', bg: 'rgba(0,0,0,0.06)', border: 'rgba(0,0,0,0.10)' } : categoryStyle(f.k);
      html += '<button type="button" data-cal-filter="' + f.k + '" '
        + 'style="border:1px solid ' + (active ? cs.color : cs.border) + ';'
        + 'background:' + (active ? cs.color : cs.bg) + ';'
        + 'color:' + (active ? '#fff' : cs.color) + ';'
        + 'padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;'
        + 'letter-spacing:-0.005em;cursor:pointer;font-family:inherit;'
        + 'display:inline-flex;align-items:center;gap:6px;">'
        + escapeHTML(f.label)
        + '<span style="font-weight:600;opacity:.7;">' + f.count + '</span>'
        + '</button>';
    });
    html += '</div>';

    // grid
    html += '<div style="border:1px solid rgba(0,0,0,0.08);border-radius:14px;overflow:hidden;background:#fff;">';
    // header row
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);background:rgba(0,0,0,0.025);">';
    DAYS.forEach(function (d) {
      html += '<div style="padding:8px 10px;font-size:9.5px;letter-spacing:0.14em;font-weight:700;color:#9ca3af;text-align:left;border-right:1px solid rgba(0,0,0,0.05);">' + d + '</div>';
    });
    html += '</div>';

    // weeks
    weeks.forEach(function (week) {
      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid rgba(0,0,0,0.05);">';
      week.forEach(function (cell) {
        if (cell.blank) {
          html += '<div style="min-height:96px;background:rgba(0,0,0,0.015);border-right:1px solid rgba(0,0,0,0.05);"></div>';
          return;
        }
        var total = (cell.events || []).reduce(function (s, e) { return s + (e.category === 'income' ? 0 : e.amount); }, 0);
        var hasOverdue = (cell.events || []).some(isOverdue);
        var dayHeader = ''
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
          +   '<span style="font-size:11.5px;font-weight:700;color:' + (cell.isToday ? '#fff' : '#0a0a0a') + ';'
          +     (cell.isToday ? 'background:#1f7a4a;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;' : '')
          +   '">' + cell.day + '</span>'
          +   '<span style="display:inline-flex;align-items:center;gap:4px;">'
          +     (cell.note ? '<span title="Has note" style="width:5px;height:5px;border-radius:50%;background:#c99a2a;"></span>' : '')
          +     (hasOverdue ? '<span title="Overdue/late" style="width:6px;height:6px;border-radius:50%;background:#dc2626;"></span>' : '')
          +     (total > 0 ? '<span style="font-size:9.5px;color:#6b7280;font-weight:700;">' + fmtUSD(total) + '</span>' : '')
          +   '</span>'
          + '</div>';
        // chips, max 3
        var chips = '';
        var visibleEvents = (cell.events || []).slice(0, 3);
        visibleEvents.forEach(function (e) {
          var s = categoryStyle(e.category);
          var dot = e.status === 'PAID' ? '✓' : (isOverdue(e) ? '!' : '·');
          chips += '<div style="font-size:10px;padding:2px 6px;margin-bottom:2px;background:' + s.bg + ';color:' + s.color + ';border-radius:4px;border:1px solid ' + s.border + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:-0.005em;">' + escapeHTML(e.name) + '</div>';
        });
        var more = (cell.events || []).length - visibleEvents.length;
        if (more > 0) chips += '<div style="font-size:9.5px;color:#9ca3af;font-weight:700;">+' + more + ' more</div>';

        html += '<div data-cal-day="' + cell.date + '" class="wjp-cal-cell' + (cell.isToday ? ' wjp-cal-today' : '') + '" '
          + 'style="min-height:96px;padding:6px 8px;border-right:1px solid rgba(0,0,0,0.05);cursor:pointer;transition:background .15s;">'
          + dayHeader + chips + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';

    // Day detail panel (if a day is selected)
    if (state.selectedDate) {
      var sel = state.selectedDate;
      var selEvents = (events || []).filter(function (e) { return e.date === sel; });
      var selNote = notes[sel] || null;
      html += renderDayPanel(sel, selEvents, selNote);
    }

    html += '</div>';
    return html;
  }

  function renderDayPanel(date, events, note) {
    var dt = new Date(date + 'T12:00:00');
    var pretty = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    var html = ''
      + '<div id="wjp-cal-day-panel" style="margin-top:18px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:14px;padding:18px 20px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      +   '<div style="font-size:14.5px;font-weight:700;letter-spacing:-0.01em;">' + pretty + '</div>'
      +   '<button type="button" data-cal-close style="background:transparent;border:0;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1;">×</button>'
      + '</div>';
    if (events.length) {
      html += '<div style="display:grid;gap:6px;margin-bottom:16px;">';
      events.forEach(function (e) {
        var s = categoryStyle(e.category);
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;background:' + s.bg + ';border:1px solid ' + s.border + ';border-radius:8px;">'
          + '<div style="display:flex;flex-direction:column;line-height:1.25;">'
          +   '<span style="font-size:12.5px;font-weight:700;color:#0a0a0a;">' + escapeHTML(e.name) + '</span>'
          +   '<span style="font-size:10.5px;color:#6b7280;font-weight:600;">' + escapeHTML(e.type) + (e.status ? ' · ' + escapeHTML(e.status) : '') + '</span>'
          + '</div>'
          + '<span style="font-size:13px;font-weight:800;color:' + s.color + ';">' + fmtUSD(e.amount) + '</span>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:12.5px;color:#9ca3af;margin-bottom:16px;">No payments scheduled.</div>';
    }
    // Note + reminder
    var noteText = note ? note.text : '';
    var reminderAt = note && note.reminderAt ? new Date(note.reminderAt) : null;
    var reminderVal = reminderAt ? reminderAt.toISOString().slice(0, 16) : '';
    html += '<div style="border-top:1px solid rgba(0,0,0,0.06);padding-top:14px;">'
      + '<div style="font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:8px;">Your note</div>'
      + '<textarea data-cal-note placeholder="Add a note for this day…" rows="3" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:13px;color:#0a0a0a;resize:vertical;background:#fff;">' + escapeHTML(noteText) + '</textarea>'
      + '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">'
      +   '<label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#6b7280;font-weight:600;">'
      +     'Remind me at:'
      +     '<input type="datetime-local" data-cal-reminder value="' + reminderVal + '" style="border:1px solid rgba(0,0,0,0.12);border-radius:6px;padding:5px 8px;font-family:inherit;font-size:12px;">'
      +   '</label>'
      +   '<button type="button" data-cal-save style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>'
      +   (note ? '<button type="button" data-cal-delete style="background:transparent;color:#dc2626;border:1px solid rgba(220,38,38,0.30);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Delete</button>' : '')
      +   '<span style="font-size:10.5px;color:#9ca3af;flex:1;text-align:right;">Reminders use browser notifications · click to allow</span>'
      + '</div>'
      + '</div>'
      + '</div>';
    return html;
  }

  function attach(host, root, events) {
    // Filter chips
    Array.from(root.querySelectorAll('[data-cal-filter]')).forEach(function (b) {
      b.addEventListener('click', function () {
        state.filter = b.dataset.calFilter;
        try { localStorage.setItem(LS_FILTER, state.filter); } catch (_) {}
        rerender(host, events);
      });
    });
    // Prev/Next month
    var prev = root.querySelector('[data-cal-prev]');
    if (prev) prev.addEventListener('click', function () {
      state.viewMonth--; if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
      rerender(host, events);
    });
    var next = root.querySelector('[data-cal-next]');
    if (next) next.addEventListener('click', function () {
      state.viewMonth++; if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
      rerender(host, events);
    });
    // Day click
    Array.from(root.querySelectorAll('[data-cal-day]')).forEach(function (cell) {
      cell.addEventListener('click', function () {
        state.selectedDate = cell.dataset.calDay;
        rerender(host, events);
        setTimeout(function () {
          var p = document.getElementById('wjp-cal-day-panel');
          if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      });
    });
    // Day panel handlers
    var close = root.querySelector('[data-cal-close]');
    if (close) close.addEventListener('click', function () { state.selectedDate = null; rerender(host, events); });
    var save = root.querySelector('[data-cal-save]');
    if (save) save.addEventListener('click', function () {
      var ta = root.querySelector('[data-cal-note]');
      var rm = root.querySelector('[data-cal-reminder]');
      var reminderAt = null;
      if (rm && rm.value) {
        var t = new Date(rm.value).getTime();
        if (isFinite(t)) reminderAt = t;
      }
      setNote(state.selectedDate, ta ? ta.value : '', reminderAt);
      // Request notification permission if user set a reminder
      if (reminderAt && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (_) {}
      }
      rerender(host, events);
    });
    var del = root.querySelector('[data-cal-delete]');
    if (del) del.addEventListener('click', function () {
      setNote(state.selectedDate, '', null);
      rerender(host, events);
    });
  }

  function rerender(host, events) {
    // Refresh events each render to pick up changes
    var fresh = harvestEvents();
    if (fresh.length) events = fresh;
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.style.cssText = 'width:100%;';
      host.appendChild(root);
    }
    root.innerHTML = buildHTML(events);
    attach(host, root, events);
  }

  function tick() {
    try {
      checkReminders();
      var host = findHost();
      if (!host) {
        // Not on the calendar page; don't touch anything
        return;
      }
      hideOriginalContent(host);
      var events = harvestEvents();
      // If the page just became active and original content was hidden, the
      // event list might also be hidden. Read it via display:none nodes — that
      // still gives us textContent, so it works even when hidden.
      rerender(host, events);
    } catch (e) {
      try { console.warn('[wjp-cal-redesign] tick threw', e); } catch (_) {}
    }
  }

  function ensureStyle() {
    if (document.getElementById('wjp-cal-styles')) return;
    var s = document.createElement('style');
    s.id = 'wjp-cal-styles';
    s.textContent = ''
      + '.wjp-cal-cell:hover { background: rgba(0,0,0,0.025) !important; }'
      + '.wjp-cal-today { background: rgba(31,122,74,0.04); }'
      + '.wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.08) !important; }';
    document.head.appendChild(s);
  }

  function boot() {
    ensureStyle();
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.WJP_CalRedesign = {
    refresh: tick,
    _state: state,
    _harvest: harvestEvents,
    _resetNotes: function () { try { localStorage.removeItem(LS_NOTES); } catch (_) {} }
  };
})();
