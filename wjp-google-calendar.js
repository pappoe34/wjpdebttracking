/* wjp-google-calendar.js v8 — Sync wjpdebttracking → Google Calendar.
 *
 * Winston 2026-05-30: "is it possible to link a google calendar to the app...
 *   add a google calendar that updates and sends reminders on google for
 *   payments and due dates so its more efficient"
 *
 * Phase 1 (this file, no backend): client-side ICS file generation.
 *   - Reads appState.recurringPayments + appState.debts.dueDate.
 *   - Builds a standards-compliant iCalendar (VCALENDAR/VEVENT) with VALARM
 *     reminders so Google fires native notifications on the user's phone.
 *   - "Download .ics" button → user imports once in Google Calendar
 *     (Settings → Import & export → Import).
 *   - "Add individual event" links per upcoming bill → Google's native
 *     /calendar/render?action=TEMPLATE URL, instant 1-click add.
 *
 * Phase 2 (deferred until Winston is ready): Netlify Function at
 *   /.netlify/functions/calendar/<token>.ics that returns the same ICS body
 *   server-side. Google polls it every few hours so the calendar stays
 *   current without manual re-import. Requires Firebase service account
 *   creds in Netlify env vars.
 *
 * Layout: card injected as the FIRST child of #page-recurring's content
 * area, pushing the existing transactions calendar grid below.
 *
 * Safe: IIFE, idempotent install, no destructive DOM changes.
 */
(function () {
  'use strict';
  if (window._wjpGoogleCalInstalled) return;
  window._wjpGoogleCalInstalled = true;

  try {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/index') === -1 && p !== '/' && p !== '') return;
  } catch (_) {}

  var CARD_ID = 'wjp-gcal-card';
  var STYLE_ID = 'wjp-gcal-style';

  function getState() { try { return appState; } catch (_) { return window.appState || null; } }

  // ────────── ICS generation ──────────
  function pad(n) { return String(n).padStart(2, '0'); }
  function toIcsDate(d) {
    if (!d) return null;
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate());
  }
  function toIcsDateTime(d) {
    var dt = (d instanceof Date) ? d : new Date(d);
    return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate()) +
      'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
  }
  function escIcs(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }
  function rruleFor(freq) {
    var f = String(freq || '').toLowerCase();
    if (f === 'weekly') return 'RRULE:FREQ=WEEKLY';
    if (f === 'biweekly' || f === 'bi-weekly' || f === '2weeks') return 'RRULE:FREQ=WEEKLY;INTERVAL=2';
    if (f === 'monthly') return 'RRULE:FREQ=MONTHLY';
    if (f === 'quarterly') return 'RRULE:FREQ=MONTHLY;INTERVAL=3';
    if (f === 'yearly' || f === 'annually') return 'RRULE:FREQ=YEARLY';
    return null;
  }

  // Money formatter (no currency assumption — bare USD style; the user's
  // locale decides display in their calendar app).
  function money(n) {
    var v = Number(n) || 0;
    return '$' + v.toFixed(2);
  }

  function gatherEvents() {
    var s = getState();
    if (!s) return [];
    var events = [];
    var now = new Date();
    var dtstamp = toIcsDateTime(now);

    // Recurring payments
    (s.recurringPayments || []).forEach(function (r) {
      if (!r || !r.nextDate) return;
      // Skip income — calendar reminders only make sense for outflows.
      var cat = String(r.category || '').toLowerCase();
      if (cat === 'income' || r.linkedIncome) return;
      var dt = toIcsDate(r.nextDate);
      if (!dt) return;
      var rrule = rruleFor(r.frequency);
      var name = r.name || 'Bill payment';
      var amt = money(r.amount);
      events.push({
        uid: 'rec-' + (r.id || (name + '-' + dt)) + '@wjpdebttracking.com',
        dtstamp: dtstamp,
        date: dt,
        summary: name + ' — ' + amt,
        description: 'Recurring ' + (r.frequency || 'payment') + ' from your debt tracker.',
        rrule: rrule
      });
    });

    // Debt due dates (one-off per month using day-of-month as anchor)
    (s.debts || []).forEach(function (d) {
      if (!d || !d.dueDate) return;
      // dueDate is usually a day-of-month integer (1-31) or a full date.
      var dayOfMonth = parseInt(d.dueDate, 10);
      var dt;
      if (!isNaN(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
        // Build the NEXT occurrence from today.
        var y = now.getUTCFullYear();
        var m = now.getUTCMonth();
        var todayDay = now.getUTCDate();
        if (dayOfMonth < todayDay) m += 1; // already passed this month → next
        var next = new Date(Date.UTC(y, m, dayOfMonth));
        dt = toIcsDate(next);
      } else {
        dt = toIcsDate(d.dueDate);
      }
      if (!dt) return;
      var name = (d.name || 'Debt') + ' due';
      var min = d.minimum || d.minPayment || 0;
      var amt = min ? ' (min ' + money(min) + ')' : '';
      events.push({
        uid: 'debt-' + (d.id || d.name) + '@wjpdebttracking.com',
        dtstamp: dtstamp,
        date: dt,
        summary: name + amt,
        description: 'Monthly due date for ' + (d.name || 'this debt') + '. APR: ' + (d.apr || 0) + '%. Balance: ' + money(d.balance || 0) + '.',
        rrule: 'RRULE:FREQ=MONTHLY'
      });
    });

    return events;
  }

  function buildIcs(events) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//WJP Debt Tracking//Calendar Sync//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:WJP Debt Tracker',
      'X-WR-CALDESC:Bill payments and debt due dates synced from wjpdebttracking.com',
      'X-WR-TIMEZONE:UTC'
    ];
    events.forEach(function (e) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + e.uid);
      lines.push('DTSTAMP:' + e.dtstamp);
      lines.push('DTSTART;VALUE=DATE:' + e.date);
      lines.push('SUMMARY:' + escIcs(e.summary));
      lines.push('DESCRIPTION:' + escIcs(e.description));
      if (e.rrule) lines.push(e.rrule);
      // Reminder 1 day before, 9am UTC. Google honors VALARM on imported events.
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-P1D');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + escIcs('Reminder: ' + e.summary));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // RFC 5545 mandates CRLF line endings.
    return lines.join('\r\n');
  }

  function downloadIcs() {
    var events = gatherEvents();
    if (!events.length) {
      alert('No bills or due dates found yet. Add a recurring payment or set a due date on a debt first.');
      return;
    }
    var ics = buildIcs(events);
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wjpdebttracking-calendar.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }


  // ────────── Phase 2: fetch the personal auto-sync URL ──────────
  // Calls /.netlify/functions/calendar-sync-url with the user's Firebase ID
  // token, gets back a stable URL that Google Calendar can poll. The URL
  // contains an HMAC of the user's uid so the calendar endpoint can verify
  // polling requests without needing auth headers (Google can't send them).
  async function getIdTokenSafe() {
    try {
      if (window.firebase && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && typeof u.getIdToken === 'function') return await u.getIdToken();
      }
    } catch (_) {}
    try {
      if (window.__wjpUser && typeof window.__wjpUser.getIdToken === 'function') {
        return await window.__wjpUser.getIdToken();
      }
    } catch (_) {}
    return null;
  }
  function setStatus(msg, isError) {
    var el = document.getElementById('wjp-gcal-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#c0594a' : 'var(--text-3)';
  }
  async function fetchSyncUrl() {
    setStatus('Generating your sync URL…');
    try {
      var token = await getIdTokenSafe();
      if (!token) { setStatus('Sign in first so we can link your calendar.', true); return; }
      var resp = await fetch('/.netlify/functions/calendar-sync-url', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      });
      if (!resp.ok) {
        var errBody = await resp.text();
        setStatus('Could not generate URL (HTTP ' + resp.status + '). ' + (errBody || '').slice(0, 120), true);
        return;
      }
      var data = await resp.json();
      if (!data || !data.url) { setStatus('Bad response from server.', true); return; }
      var url = data.url;
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Copied! Paste it in Google Calendar → Settings → Add calendar → From URL.');
      } catch (_) {
        // Fallback: prompt the user
        try { window.prompt('Copy this URL into Google Calendar → Settings → Add calendar → From URL:', url); } catch (_) {}
        setStatus('URL ready in the prompt above.');
      }
    } catch (err) {
      setStatus('Error: ' + (err && err.message ? err.message : 'unknown'), true);
    }
  }
  // ────────── Google "Add Event" template URL ──────────
  // https://calendar.google.com/calendar/render?action=TEMPLATE
  //   &text=<encoded title>
  //   &dates=YYYYMMDD/YYYYMMDD (all-day) or YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
  //   &details=<encoded body>
  //   &recur=RRULE:FREQ=MONTHLY
  function googleTemplateUrl(ev) {
    var base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    var end = ev.date; // all-day: same start/end day
    var params = [
      'text=' + encodeURIComponent(ev.summary),
      'dates=' + ev.date + '/' + end,
      'details=' + encodeURIComponent(ev.description + '\n\nGenerated by wjpdebttracking.com')
    ];
    if (ev.rrule) {
      // Strip the leading "RRULE:" — Google expects bare rule.
      var rr = ev.rrule.replace(/^RRULE:/i, '');
      params.push('recur=' + encodeURIComponent('RRULE:' + rr));
    }
    return base + '&' + params.join('&');
  }

  // ────────── styles ──────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      'html body #page-recurring > #' + CARD_ID + ', html body #page-recurring #' + CARD_ID + ', #' + CARD_ID + ' { display: block !important; visibility: visible !important; background: linear-gradient(135deg, rgba(66,133,244,0.06), rgba(52,168,83,0.06)); border: 1px solid var(--border); border-radius: 16px; padding: 22px 24px; margin-bottom: 24px; position: relative; z-index: 5; }',
      'body.dark #' + CARD_ID + ' { background: linear-gradient(135deg, rgba(66,133,244,0.12), rgba(52,168,83,0.10)); }',
      '#' + CARD_ID + ' .wjp-gcal-head { display:flex; align-items:center; gap:12px; margin-bottom: 14px; }',
      '#' + CARD_ID + ' .wjp-gcal-logo { width:36px; height:36px; border-radius:10px; background:#fff; display:flex; align-items:center; justify-content:center; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }',
      '#' + CARD_ID + ' .wjp-gcal-logo svg { width:22px; height:22px; }',
      '#' + CARD_ID + ' h2 { font-size:18px; font-weight:900; margin:0; letter-spacing:-0.3px; }',
      '#' + CARD_ID + ' .wjp-gcal-sub { font-size:12px; color:var(--text-3); margin:2px 0 0; }',
      '#' + CARD_ID + ' .wjp-gcal-actions { display:flex; gap:10px; flex-wrap:wrap; margin: 8px 0 16px; }',
      '#' + CARD_ID + ' .wjp-gcal-btn { display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:10px; font-size:13px; font-weight:700; cursor:pointer; border:0; font-family:inherit; transition: transform .12s ease, box-shadow .12s ease; }',
      '#' + CARD_ID + ' .wjp-gcal-btn.primary { background:#1f7a4a; color:#fff; }',
      '#' + CARD_ID + ' .wjp-gcal-btn.primary:hover { transform: translateY(-1px); box-shadow:0 4px 10px rgba(31,122,74,0.25); }',
      '#' + CARD_ID + ' .wjp-gcal-btn.ghost { background: rgba(255,255,255,0.7); color: var(--text-1, #1a1a1a); border:1px solid var(--border); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-btn.ghost { background: rgba(255,255,255,0.06); color: var(--text-1, #e7e7e7); }',
      '#' + CARD_ID + ' .wjp-gcal-list { display:grid; gap:8px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 12px; }',
      '#' + CARD_ID + ' .wjp-gcal-row { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background: rgba(255,255,255,0.5); border:1px solid var(--border); border-radius:10px; gap:10px; }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-row { background: rgba(255,255,255,0.04); }',
      '#' + CARD_ID + ' .wjp-gcal-row-meta { display:flex; flex-direction:column; gap:2px; min-width:0; }',
      '#' + CARD_ID + ' .wjp-gcal-row-name { font-size:12px; font-weight:700; color: var(--ink, var(--text-1, #1a1a1a)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
      '#' + CARD_ID + ' .wjp-gcal-row-date { font-size:10.5px; color: var(--text-3); }',
      '#' + CARD_ID + ' .wjp-gcal-row a { color:#1f7a4a; text-decoration:none; font-size:11px; font-weight:800; white-space:nowrap; padding:6px 10px; border-radius:8px; background:rgba(31,122,74,0.10); }',
      '#' + CARD_ID + ' .wjp-gcal-row a:hover { background:rgba(31,122,74,0.18); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-row a { color:#7fd1a4; background:rgba(127,209,164,0.14); }',
      '#' + CARD_ID + ' details { margin-top: 14px; }',
      '#' + CARD_ID + ' summary { font-size:12px; color: var(--text-3); cursor:pointer; user-select:none; }',
      '#' + CARD_ID + ' .wjp-gcal-steps { font-size:12px; color: var(--text-2); margin: 8px 0 0; padding-left: 18px; }',
      '#' + CARD_ID + ' .wjp-gcal-steps li { margin-bottom:4px; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── Google logo SVG ──────────
  function gcalLogoHtml() {
    return '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="20" y="40" width="160" height="140" rx="10" fill="#fff" stroke="#dadce0" stroke-width="3"/>' +
      '<rect x="20" y="40" width="160" height="28" rx="10" fill="#4285f4"/>' +
      '<text x="100" y="135" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="60" fill="#4285f4">31</text>' +
      '<circle cx="50" cy="40" r="8" fill="#34a853"/><circle cx="150" cy="40" r="8" fill="#fbbc04"/>' +
      '</svg>';
  }

  // ────────── card render ──────────
  function buildCard() {
    var card = document.createElement('div');
    card.id = CARD_ID;
    card.className = 'reveal';

    var events = gatherEvents();
    // Sort by date asc, take the next 6 for the one-click row
    var upcoming = events.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).slice(0, 6);

    var listHtml = upcoming.length
      ? '<div class="wjp-gcal-list">' + upcoming.map(function (e) {
          var datePretty = e.date.slice(0, 4) + '-' + e.date.slice(4, 6) + '-' + e.date.slice(6, 8);
          return '<div class="wjp-gcal-row">' +
            '<div class="wjp-gcal-row-meta">' +
              '<div class="wjp-gcal-row-name">' + escapeHtml(e.summary) + '</div>' +
              '<div class="wjp-gcal-row-date">' + datePretty + '</div>' +
            '</div>' +
            '<a href="' + googleTemplateUrl(e) + '" target="_blank" rel="noopener">+ Google</a>' +
          '</div>';
        }).join('') + '</div>'
      : '<p style="font-size:12px; color:var(--text-3); margin:8px 0 0;">Add a recurring payment or set a due date on a debt — the file will pick them up automatically.</p>';

    card.innerHTML =
      '<div class="wjp-gcal-head">' +
        '<div class="wjp-gcal-logo">' + gcalLogoHtml() + '</div>' +
        '<div>' +
          '<h2>Sync to Google Calendar</h2>' +
          '<p class="wjp-gcal-sub">' + events.length + ' event' + (events.length === 1 ? '' : 's') + ' ready — bills, debt due dates, and reminders 1 day before.</p>' +
        '</div>' +
      '</div>' +
      '<div class="wjp-gcal-actions">' +
        '<button type="button" class="wjp-gcal-btn primary" data-action="sync-url"><i class="ph ph-link-simple"></i> Copy auto-sync URL</button>' +
        '<button type="button" class="wjp-gcal-btn ghost" data-action="download"><i class="ph ph-download-simple"></i> Download .ics file</button>' +
      '</div>' +
      '<div class="wjp-gcal-status" id="wjp-gcal-status" style="font-size:11.5px; color:var(--text-3); margin: -4px 0 12px; min-height:16px;"></div>' +
      listHtml +
      '<details>' +
        '<summary>How to import into Google Calendar</summary>' +
        '<ol class="wjp-gcal-steps">' +
          '<li><b>Auto-sync (recommended):</b> click <b>Copy auto-sync URL</b>, then in <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener">Google Calendar → Settings → Add calendar → From URL</a>, paste the URL and Add. Google polls every few hours and picks up your edits automatically.</li>' +
          '<li><b>One-time import:</b> click <b>Download .ics file</b>, then in <a href="https://calendar.google.com/calendar/u/0/r/settings/export" target="_blank" rel="noopener">Settings → Import & export</a>, upload the file. No auto-updates — re-import when you add bills.</li>' +
          '<li><b>Per-event:</b> click any <b>+ Google</b> link in the grid above to save a single bill instantly.</li>' +
          '<li>Google sets a reminder 1 day before each due date automatically (VALARM in the feed).</li>' +
        '</ol>' +
        '<p style="font-size:11px; color:var(--text-3); margin:10px 0 0;"><b>Privacy:</b> your auto-sync URL contains a signed token. Anyone with the URL can read your bill data — treat it like a password and don\'t share it publicly.</p>' +
      '</details>';

    card.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var act = btn.getAttribute('data-action');
      if (act === 'download') downloadIcs();
      else if (act === 'sync-url') fetchSyncUrl();
    });

    return card;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ────────── inject the card at top of #page-recurring ──────────
  function inject() {
    var page = document.getElementById('page-recurring');
    if (!page) return false;
    // FIX 87 v3: index.html has a flicker-guard rule
    //   #page-recurring > *:not(#wjp-cal-root) { display:none !important; }
    // so we MUST inject inside #wjp-cal-root, not as a direct child of
    // #page-recurring. wjp-cal-root is the visible container that owns the
    // calendar grid; placing our card as its first child puts it at the top
    // of the visible Calendar page.
    // FIX 87 v8: pin to #page-recurring (sibling of #wjp-cal-root, not inside).
    // Calendar module's render wipes calRoot.innerHTML, but it can't touch the
    // card as a sibling. Higher-specificity CSS override (html body ...) beats
    // the flicker-guard's display:none.
    var host = page;
    var existing = document.getElementById(CARD_ID);
    if (existing) {
      if (existing.parentNode !== host) {
        try { existing.parentNode.removeChild(existing); } catch (_) {}
      } else {
        try {
          var fresh1 = buildCard();
          existing.parentNode.replaceChild(fresh1, existing);
        } catch (_) {}
        return true;
      }
    }
    var card = buildCard();
    if (host.firstChild) host.insertBefore(card, host.firstChild);
    else host.appendChild(card);
    return true;
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    inject();
    // Re-inject on data restore so the event list reflects pulled state
    window.addEventListener('wjp-data-restored', function () { setTimeout(inject, 400); });
    window.addEventListener('wjp-state-pulled', function () { setTimeout(inject, 300); });
    // Re-inject on navigation to the Calendar page (page may render lazily)
    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace(/^#/, '').toLowerCase();
      if (h === 'recurring') setTimeout(inject, 200);
    });
    // Watch for the page-recurring element appearing late (pre-warm or SPA delay)
    // FIX 87 v4: previous v3 used { childList:true, subtree:true } on
    // document.body which fired on EVERY DOM mutation anywhere on the page
    // and froze the renderer. Throttle + narrow scope:
    //   - top-level observer only watches direct body children (cheap)
    //   - a separate observer attaches to #page-recurring once it exists
    //   - both share a 400ms debounce so we never re-inject more than 2x/sec
    var _injectDebounce = 0;
    function scheduleInject() {
      if (_injectDebounce) return;
      _injectDebounce = setTimeout(function () {
        _injectDebounce = 0;
        try {
          var have = document.getElementById(CARD_ID);
          var page3 = document.getElementById('page-recurring');
          if (!have || (page3 && have.parentNode !== page3)) inject();
        } catch (_) {}
      }, 400);
    }
    try {
      var moBody = new MutationObserver(scheduleInject);
      moBody.observe(document.body, { childList: true, subtree: false });

      var _recObserver = null;
      function watchPageRecurring() {
        var page = document.getElementById('page-recurring');
        if (!page || _recObserver) return;
        _recObserver = new MutationObserver(scheduleInject);
        _recObserver.observe(page, { childList: true, subtree: false });
      }
      watchPageRecurring();
      setTimeout(watchPageRecurring, 2000);
      setTimeout(watchPageRecurring, 6000);

      // FIX 87 v6: #wjp-cal-root's render wipes its innerHTML each time, so
      // our card gets nuked alongside the calendar grid. Watch calRoot for
      // direct-children changes and re-inject.
      var _calRootObserver = null;
      function watchCalRoot() {
        var calRoot = document.getElementById('wjp-cal-root');
        if (!calRoot || _calRootObserver) return;
        _calRootObserver = new MutationObserver(scheduleInject);
        _calRootObserver.observe(calRoot, { childList: true, subtree: false });
      }
      watchCalRoot();
      setTimeout(watchCalRoot, 1500);
      setTimeout(watchCalRoot, 4000);
      setTimeout(watchCalRoot, 9000);
    } catch (_) {}
  }

  // FIX 87 v7: MO doesn't reliably fire when the calendar module replaces
  // calRoot's contents. Polling fallback: every 2s for 60s, ensure the card
  // exists inside #wjp-cal-root. Triggered initially, and again whenever the
  // user navigates to #recurring.
  function startPolling(maxMs) {
    var until = Date.now() + (maxMs || 60000);
    var iv = setInterval(function () {
      if (Date.now() > until) { clearInterval(iv); return; }
      try {
        var page2 = document.getElementById('page-recurring');
        if (!page2) return;
        var card = document.getElementById(CARD_ID);
        if (!card || card.parentNode !== page2) inject();
      } catch (_) {}
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); startPolling(60000); });
  } else {
    boot();
    startPolling(60000);
  }
  // Re-arm polling when user navigates to the Calendar tab
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (h === 'recurring') startPolling(30000);
  });

  window.WJP_GoogleCalendar = {
    version: 8,
    gatherEvents: gatherEvents,
    buildIcs: buildIcs,
    downloadIcs: downloadIcs,
    refresh: inject
  };
})();
