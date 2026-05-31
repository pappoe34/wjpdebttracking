/* wjp-google-calendar.js v15 — Sync wjpdebttracking → Google Calendar.
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



  // ────────── FIX 87 v12: connection-state tracking ──────────
  function isGoogleConnected() {
    var s = getState();
    return !!(s && s.prefs && s.prefs.googleCalConnected);
  }
  function markGoogleConnected() {
    var s = getState();
    if (!s) return;
    if (!s.prefs) s.prefs = {};
    s.prefs.googleCalConnected = true;
    s.prefs.googleCalConnectedAt = new Date().toISOString();
    try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
    try { if (typeof window.cloudPushNow === 'function') window.cloudPushNow(); } catch (_) {}
    // Re-render the card so the badge appears immediately
    inject();
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
        markGoogleConnected();
      } catch (_) {
        try { window.prompt('Copy this URL into Google Calendar → Settings → Add calendar → From URL:', url); } catch (_) {}
        setStatus('URL ready in the prompt above.');
        markGoogleConnected();
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
      '#' + CARD_ID + ' .wjp-gcal-steps li { margin-bottom:4px; }',
      // ───── FIX 87 v9: month grid ─────
      '#' + CARD_ID + ' .wjp-gcal-calview { margin: 8px 0 16px; border: 1px solid var(--border); border-radius: 12px; padding: 14px; background: var(--card, #fff); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-calview { background: var(--card-2, rgba(255,255,255,0.04)); }',
      '#' + CARD_ID + ' .wjp-gcal-calhead { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; }',
      '#' + CARD_ID + ' .wjp-gcal-monthtitle { font-size: 16px; font-weight: 800; letter-spacing: -0.2px; }',
      '#' + CARD_ID + ' .wjp-gcal-navbtns { display:flex; gap:4px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }',
      '#' + CARD_ID + ' .wjp-gcal-navbtn { background: transparent; border: 0; color: var(--text-2); padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 5px; font-family: inherit; }',
      '#' + CARD_ID + ' .wjp-gcal-navbtn:hover { background: rgba(31,122,74,0.10); color: #1f7a4a; }',
      '#' + CARD_ID + ' .wjp-gcal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }',
      '#' + CARD_ID + ' .wjp-gcal-dh { background: var(--card-2, #f7f7f7); padding: 8px 4px; text-align: center; font-size: 9.5px; font-weight: 800; color: var(--text-3); letter-spacing: 0.1em; }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-dh { background: rgba(255,255,255,0.04); }',
      '#' + CARD_ID + ' .wjp-gcal-cell { background: var(--card, #fff); min-height: 78px; padding: 5px 6px; display: flex; flex-direction: column; gap: 2px; position: relative; }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-cell { background: var(--card-2, rgba(255,255,255,0.02)); }',
      '#' + CARD_ID + ' .wjp-gcal-blank { background: transparent; min-height: 78px; }',
      '#' + CARD_ID + ' .wjp-gcal-num { font-size: 11px; font-weight: 700; color: var(--text-2); }',
      '#' + CARD_ID + ' .wjp-gcal-today .wjp-gcal-num { background: #1f7a4a; color: #fff; border-radius: 999px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 800; }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-today .wjp-gcal-num { background: #7fd1a4; color: #0a0a0a; }',
      '#' + CARD_ID + ' .wjp-gcal-chip { font-size: 9.5px; font-weight: 700; padding: 2px 5px; background: rgba(66,133,244,0.14); color: #1a73e8; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-chip { background: rgba(66,133,244,0.22); color: #8ab4f8; }',
      '#' + CARD_ID + ' .wjp-gcal-more { font-size: 9px; font-weight: 700; color: var(--text-3); padding: 0 5px; }',
      '#' + CARD_ID + ' .wjp-gcal-calfoot { font-size: 11px; color: var(--text-3); margin-top: 10px; text-align: center; }',
      '#' + CARD_ID + ' .wjp-gcal-title { font-size: 22px; font-weight: 900; letter-spacing: -0.4px; text-align: center; margin: 0 0 4px; color: var(--ink, var(--text-1, #1a1a1a)); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-title { color: var(--ink, var(--text-1, #e7e7e7)); }',
      '#' + CARD_ID + ' .wjp-gcal-subtitle { font-size: 12px; color: var(--text-3); text-align: center; margin: 0 0 18px; }',
      '#wjp-gcal-tx-title { text-align: center; margin: 32px 0 18px; }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: 0.18em; color: #1f7a4a; margin-bottom: 4px; }',
      'body.dark #wjp-gcal-tx-title .wjp-gcal-tx-eyebrow { color: #7fd1a4; }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-name { font-size: 22px; font-weight: 900; letter-spacing: -0.4px; color: var(--ink, var(--text-1, #1a1a1a)); margin-bottom: 4px; }',
      'body.dark #wjp-gcal-tx-title .wjp-gcal-tx-name { color: var(--ink, var(--text-1, #e7e7e7)); }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-sub { font-size: 12px; color: var(--text-3); }',
      '#' + CARD_ID + ' button.wjp-gcal-chip, #' + CARD_ID + ' button.wjp-gcal-more { border: 0; cursor: pointer; font-family: inherit; text-align: left; }',
      '#' + CARD_ID + ' .wjp-gcal-chip:hover { background: rgba(66,133,244,0.26); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-chip:hover { background: rgba(66,133,244,0.36); }',
      '#' + CARD_ID + ' .wjp-gcal-cell { cursor: pointer; transition: background .12s ease; }',
      '#' + CARD_ID + ' .wjp-gcal-cell:hover { background: rgba(31,122,74,0.06); }',
      'body.dark #' + CARD_ID + ' .wjp-gcal-cell:hover { background: rgba(127,209,164,0.08); }',
      '#wjp-gcal-detail-pop { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--card, #fff); color: var(--ink, var(--text-1, #1a1a1a)); border: 1px solid var(--border); border-radius: 14px; padding: 20px 22px; min-width: 320px; max-width: 460px; box-shadow: 0 18px 60px rgba(0,0,0,0.18); z-index: 9999; }',
      'body.dark #wjp-gcal-detail-pop { background: var(--card-2, #1a2028); color: var(--ink, var(--text-1, #e7e7e7)); box-shadow: 0 18px 60px rgba(0,0,0,0.6); border-color: rgba(255,255,255,0.10); }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-head { display:flex; align-items:flex-start; gap:10px; margin-bottom: 12px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-dot { width: 14px; height: 14px; border-radius: 999px; background: #1a73e8; margin-top: 4px; flex-shrink: 0; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-detail-dot { background: #8ab4f8; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-title { font-size: 16px; font-weight: 800; letter-spacing: -0.2px; margin-bottom: 2px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-date { font-size: 12px; color: var(--text-3); }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-body { font-size: 13px; color: var(--text-2); line-height: 1.5; margin: 10px 0 14px; padding: 10px 12px; background: var(--bg, rgba(0,0,0,0.03)); border-radius: 8px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-detail-body { background: rgba(255,255,255,0.05); color: var(--text-2, #c0c5cb); }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-meta { font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-meta i { color: #1f7a4a; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-detail-meta i { color: #7fd1a4; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-evrow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: transparent; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; cursor: pointer; text-align: left; color: inherit; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-evrow:hover { background: rgba(66,133,244,0.10); }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-detail-evrow:hover { background: rgba(66,133,244,0.16); }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-evtxt { font-size: 13px; font-weight: 600; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-empty { font-size: 12px; color: var(--text-3); text-align: center; padding: 14px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-close { position: absolute; top: 8px; right: 12px; background: transparent; border: 0; font-size: 22px; font-weight: 700; color: var(--text-3); cursor: pointer; line-height: 1; padding: 4px 8px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-detail-close:hover { color: var(--ink, var(--text-1, #1a1a1a)); }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-detail-close:hover { color: var(--ink, var(--text-1, #e7e7e7)); }'
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


  // ────────── FIX 87 v9: visual month-grid view ──────────
  // Renders the events we send to Google as a proper calendar widget so the
  // user can see exactly what their Google Calendar will show. Independent
  // navigation state — doesn't affect the existing transactions calendar
  // below.
  var _viewMonth = (function () {
    var n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() }; // m is 0-indexed
  })();
  function _monthName(m) {
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][m];
  }
  function _isoYmd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // Map ICS YYYYMMDD → JS Date (local time, no timezone shift)
  function _icsDateToLocal(ics) {
    var y = parseInt(ics.slice(0, 4), 10);
    var m = parseInt(ics.slice(4, 6), 10) - 1;
    var d = parseInt(ics.slice(6, 8), 10);
    return new Date(y, m, d);
  }
  // Build the set of dates an event lands on within the visible month.
  // Handles weekly/biweekly/monthly/quarterly/yearly RRULEs.
  function _eventDatesInMonth(ev, viewY, viewM) {
    var dates = [];
    var first = _icsDateToLocal(ev.date);
    var monthStart = new Date(viewY, viewM, 1);
    var monthEnd = new Date(viewY, viewM + 1, 0); // last day of view month
    if (!ev.rrule) {
      if (first >= monthStart && first <= monthEnd) dates.push(_isoYmd(first));
      return dates;
    }
    var rule = ev.rrule.replace(/^RRULE:/i, '');
    // Walk occurrences. We bound iterations to avoid pathological loops.
    var max = 400;
    var cur = new Date(first.getTime());
    while (cur <= monthEnd && max-- > 0) {
      if (cur >= monthStart) dates.push(_isoYmd(cur));
      if (/FREQ=WEEKLY/.test(rule)) {
        var step = /INTERVAL=2/.test(rule) ? 14 : 7;
        cur.setDate(cur.getDate() + step);
      } else if (/FREQ=MONTHLY/.test(rule)) {
        var mStep = /INTERVAL=3/.test(rule) ? 3 : 1;
        cur.setMonth(cur.getMonth() + mStep);
      } else if (/FREQ=YEARLY/.test(rule)) {
        cur.setFullYear(cur.getFullYear() + 1);
      } else {
        break;
      }
    }
    return dates;
  }
  function _eventsByDateMap(viewY, viewM) {
    var events = gatherEvents();
    var byDate = {};
    events.forEach(function (e) {
      _eventDatesInMonth(e, viewY, viewM).forEach(function (key) {
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(e);
      });
    });
    return byDate;
  }

  // Render the visual 7×6 month grid
  function buildMonthGrid() {
    var viewY = _viewMonth.y, viewM = _viewMonth.m;
    var byDate = _eventsByDateMap(viewY, viewM);
    var first = new Date(viewY, viewM, 1);
    var firstDow = first.getDay(); // 0=Sun
    var daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
    var today = new Date();
    var todayKey = _isoYmd(today);

    var cells = [];
    // Leading blanks
    for (var i = 0; i < firstDow; i++) cells.push({ blank: true });
    // Day cells
    for (var d = 1; d <= daysInMonth; d++) {
      var dateObj = new Date(viewY, viewM, d);
      var key = _isoYmd(dateObj);
      cells.push({
        day: d,
        key: key,
        isToday: key === todayKey,
        events: byDate[key] || []
      });
    }
    // Trailing blanks to fill the grid to 42 cells (7×6)
    while (cells.length % 7 !== 0) cells.push({ blank: true });

    var dayHeaders = ['SUN','MON','TUE','WED','THU','FRI','SAT']
      .map(function (h) { return '<div class="wjp-gcal-dh">' + h + '</div>'; }).join('');

    var cellHtml = cells.map(function (c) {
      if (c.blank) return '<div class="wjp-gcal-cell wjp-gcal-blank"></div>';
      var chips = c.events.slice(0, 3).map(function (e, idx) {
        var label = (e.summary || '').replace(/ — \$[\d.]+$/, '');
        return '<button type="button" class="wjp-gcal-chip" data-action="event-detail" data-day="' + c.key + '" data-idx="' + idx + '" title="' + escapeHtml(e.summary) + '">' + escapeHtml(label) + '</button>';
      }).join('');
      var more = c.events.length > 3 ? '<button type="button" class="wjp-gcal-more" data-action="day-detail" data-day="' + c.key + '">+' + (c.events.length - 3) + ' more</button>' : '';
      return '<div class="wjp-gcal-cell' + (c.isToday ? ' wjp-gcal-today' : '') + (c.events.length ? ' wjp-gcal-has' : '') + '" data-action="day-detail" data-day="' + c.key + '">' +
        '<div class="wjp-gcal-num">' + c.day + '</div>' + chips + more + '</div>';
    }).join('');

    var totalThisMonth = Object.keys(byDate).reduce(function (sum, k) { return sum + byDate[k].length; }, 0);

    return '<div class="wjp-gcal-calview">' +
      '<div class="wjp-gcal-calhead">' +
        '<div class="wjp-gcal-monthtitle">' + _monthName(viewM) + ' ' + viewY + '</div>' +
        '<div class="wjp-gcal-navbtns">' +
          '<button type="button" class="wjp-gcal-navbtn" data-action="prev-month" title="Previous month"><i class="ph ph-caret-left"></i></button>' +
          '<button type="button" class="wjp-gcal-navbtn" data-action="today" title="Today">Today</button>' +
          '<button type="button" class="wjp-gcal-navbtn" data-action="next-month" title="Next month"><i class="ph ph-caret-right"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="wjp-gcal-grid">' + dayHeaders + cellHtml + '</div>' +
      '<div class="wjp-gcal-calfoot">' + totalThisMonth + ' synced event' + (totalThisMonth === 1 ? '' : 's') + ' this month · 1-day-before reminder set on each</div>' +
    '</div>';
  }


  // ────────── FIX 87 v10: event detail popover ──────────
  function _openDetailPopover(html) {
    _closeDetailPopover();
    var pop = document.createElement('div');
    pop.id = 'wjp-gcal-detail-pop';
    pop.innerHTML = html + '<button type="button" class="wjp-gcal-detail-close" data-action="close-detail" aria-label="Close">\u00d7</button>';
    document.body.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', _outsideClickClose, true); }, 0);
  }
  function _closeDetailPopover() {
    var p = document.getElementById('wjp-gcal-detail-pop');
    if (p) try { p.remove(); } catch (_) {}
    document.removeEventListener('click', _outsideClickClose, true);
  }
  function _outsideClickClose(e) {
    var p = document.getElementById('wjp-gcal-detail-pop');
    if (!p) return;
    if (p.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-action="event-detail"], [data-action="day-detail"]')) return;
    _closeDetailPopover();
  }
  function showEventDetail(dayKey, idx) {
    var byDate = _eventsByDateMap(_viewMonth.y, _viewMonth.m);
    var evs = byDate[dayKey] || [];
    var ev = evs[idx];
    if (!ev) return;
    var d = _icsDateToLocal(dayKey.replace(/-/g, '').slice(0, 8));
    var dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var rruleText = ev.rrule ? ev.rrule.replace(/^RRULE:/, '').replace(/FREQ=/, '').replace(/;INTERVAL=2/, ' (every 2)').replace(/;INTERVAL=3/, ' (every 3)').toLowerCase() : 'one-time';
    _openDetailPopover(
      '<div class="wjp-gcal-detail-head">' +
        '<div class="wjp-gcal-detail-dot"></div>' +
        '<div>' +
          '<div class="wjp-gcal-detail-title">' + escapeHtml(ev.summary) + '</div>' +
          '<div class="wjp-gcal-detail-date">' + escapeHtml(dateLabel) + ' \u00b7 all-day</div>' +
        '</div>' +
      '</div>' +
      '<div class="wjp-gcal-detail-body">' + escapeHtml(ev.description) + '</div>' +
      '<div class="wjp-gcal-detail-meta"><i class="ph ph-repeat"></i> Recurrence: ' + escapeHtml(rruleText) + '</div>' +
      '<div class="wjp-gcal-detail-meta"><i class="ph ph-bell"></i> Reminder 1 day before</div>'
    );
  }
  function showDayDetail(dayKey) {
    var byDate = _eventsByDateMap(_viewMonth.y, _viewMonth.m);
    var evs = byDate[dayKey] || [];
    var d = _icsDateToLocal(dayKey.replace(/-/g, '').slice(0, 8));
    var dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var body = evs.length
      ? evs.map(function (e, i) {
          return '<button type="button" class="wjp-gcal-detail-evrow" data-action="event-detail" data-day="' + dayKey + '" data-idx="' + i + '">' +
                   '<div class="wjp-gcal-detail-dot"></div>' +
                   '<div class="wjp-gcal-detail-evtxt">' + escapeHtml(e.summary) + '</div>' +
                 '</button>';
        }).join('')
      : '<div class="wjp-gcal-detail-empty">No payments on this day.</div>';
    _openDetailPopover(
      '<div class="wjp-gcal-detail-head"><div>' +
        '<div class="wjp-gcal-detail-title">' + escapeHtml(dateLabel) + '</div>' +
        '<div class="wjp-gcal-detail-date">' + evs.length + ' payment' + (evs.length === 1 ? '' : 's') + '</div>' +
      '</div></div>' +
      '<div class="wjp-gcal-detail-list">' + body + '</div>'
    );
  }


  // ────────── FIX 87 v11: design polish + label visibility override ──────────
  // Injected as a separate stylesheet element AFTER the base styles so it
  // wins cascade ties at equal specificity. Also raises specificity where
  // needed to beat the flicker-guard CSS.
  function injectStyleV11Polish() {
    if (document.getElementById('wjp-gcal-style-v11')) return;
    var st = document.createElement('style');
    st.id = 'wjp-gcal-style-v11';
    st.textContent = [
      // Force the Transactions Calendar label visible (flicker guard hides
      // all #page-recurring direct children except #wjp-cal-root).
      'html body #page-recurring > #wjp-gcal-tx-title, html body #wjp-gcal-tx-title { display: block !important; visibility: visible !important; }',

      // Premium card shell — softer, lighter, more whitespace
      'html body #page-recurring > #wjp-gcal-card { background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%) !important; border: 1px solid rgba(0,0,0,0.06) !important; border-radius: 20px !important; padding: 32px 36px !important; margin: 0 0 0 !important; box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06) !important; }',
      'body.dark #page-recurring > #wjp-gcal-card { background: linear-gradient(180deg, #1c2129 0%, #161b22 100%) !important; border-color: rgba(255,255,255,0.08) !important; box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 12px 32px rgba(0,0,0,0.5) !important; }',

      // Titles
      '#wjp-gcal-card .wjp-gcal-title { font-size: 28px !important; font-weight: 800 !important; letter-spacing: -0.7px !important; line-height: 1.15 !important; margin: 0 0 6px !important; color: #0f1419 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-title { color: #f0f3f5 !important; }',
      '#wjp-gcal-card .wjp-gcal-subtitle { font-size: 13px !important; color: #5c6873 !important; margin: 0 auto 28px !important; max-width: 480px !important; line-height: 1.5 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-subtitle { color: #8b95a1 !important; }',

      // Sync header strip
      '#wjp-gcal-card .wjp-gcal-head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: rgba(248,250,252,0.6); border: 1px solid rgba(0,0,0,0.04); border-radius: 14px; margin-bottom: 14px; }',
      'body.dark #wjp-gcal-card .wjp-gcal-head { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06); }',
      '#wjp-gcal-card .wjp-gcal-head h2 { font-size: 14px; font-weight: 700; margin: 0; color: #0f1419; letter-spacing: -0.1px; }',
      'body.dark #wjp-gcal-card .wjp-gcal-head h2 { color: #f0f3f5; }',
      '#wjp-gcal-card .wjp-gcal-sub { font-size: 11.5px; color: #5c6873; margin: 1px 0 0; font-weight: 500; }',

      // Buttons — premium gradient + lift
      '#wjp-gcal-card .wjp-gcal-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }',
      '#wjp-gcal-card .wjp-gcal-btn { padding: 11px 18px !important; border-radius: 12px !important; font-size: 13px !important; font-weight: 700 !important; transition: all .15s ease !important; letter-spacing: -0.1px !important; }',
      '#wjp-gcal-card .wjp-gcal-btn.primary { background: linear-gradient(180deg, #2a8a5a 0%, #1f7a4a 100%) !important; box-shadow: 0 1px 2px rgba(31,122,74,0.3), 0 4px 12px rgba(31,122,74,0.18) !important; }',
      '#wjp-gcal-card .wjp-gcal-btn.primary:hover { transform: translateY(-1px) !important; box-shadow: 0 2px 4px rgba(31,122,74,0.35), 0 8px 18px rgba(31,122,74,0.25) !important; }',
      '#wjp-gcal-card .wjp-gcal-btn.ghost { background: #fff !important; color: #0f1419 !important; border: 1px solid rgba(0,0,0,0.08) !important; box-shadow: 0 1px 2px rgba(0,0,0,0.04) !important; }',
      '#wjp-gcal-card .wjp-gcal-btn.ghost:hover { background: #f8f9fb !important; transform: translateY(-1px) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-btn.ghost { background: rgba(255,255,255,0.05) !important; color: #f0f3f5 !important; border-color: rgba(255,255,255,0.1) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-btn.ghost:hover { background: rgba(255,255,255,0.08) !important; }',

      // Calendar view
      '#wjp-gcal-card .wjp-gcal-calview { margin: 20px 0 8px !important; border: 1px solid rgba(0,0,0,0.06) !important; border-radius: 16px !important; padding: 20px !important; background: #fff !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-calview { background: #1a1f26 !important; border-color: rgba(255,255,255,0.08) !important; }',
      '#wjp-gcal-card .wjp-gcal-monthtitle { font-size: 18px !important; font-weight: 800 !important; letter-spacing: -0.3px !important; color: #0f1419 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-monthtitle { color: #f0f3f5 !important; }',
      '#wjp-gcal-card .wjp-gcal-navbtns { background: #f1f3f5 !important; border-radius: 10px !important; padding: 3px !important; border: 0 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-navbtns { background: rgba(255,255,255,0.05) !important; }',
      '#wjp-gcal-card .wjp-gcal-navbtn { padding: 6px 12px !important; font-size: 12px !important; font-weight: 700 !important; border-radius: 7px !important; transition: all .12s ease !important; color: #5c6873 !important; }',
      '#wjp-gcal-card .wjp-gcal-navbtn:hover { background: #fff !important; color: #1f7a4a !important; box-shadow: 0 1px 2px rgba(0,0,0,0.06) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-navbtn { color: #8b95a1 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-navbtn:hover { background: rgba(255,255,255,0.1) !important; color: #7fd1a4 !important; }',

      // Grid + cells
      '#wjp-gcal-card .wjp-gcal-grid { gap: 0 !important; border: 1px solid rgba(0,0,0,0.06) !important; border-radius: 12px !important; overflow: hidden !important; background: transparent !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-grid { border-color: rgba(255,255,255,0.08) !important; }',
      '#wjp-gcal-card .wjp-gcal-dh { background: transparent !important; padding: 11px 4px 9px !important; font-size: 10px !important; font-weight: 700 !important; color: #8b95a1 !important; letter-spacing: 0.12em !important; border-bottom: 1px solid rgba(0,0,0,0.06) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-dh { color: #6b7480 !important; border-bottom-color: rgba(255,255,255,0.08) !important; }',
      '#wjp-gcal-card .wjp-gcal-cell { background: #fff !important; min-height: 90px !important; padding: 8px 8px 6px !important; gap: 3px !important; border-right: 1px solid rgba(0,0,0,0.04) !important; border-bottom: 1px solid rgba(0,0,0,0.04) !important; }',
      '#wjp-gcal-card .wjp-gcal-cell:nth-child(7n) { border-right: 0 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-cell { background: #1a1f26 !important; border-color: rgba(255,255,255,0.05) !important; }',
      '#wjp-gcal-card .wjp-gcal-cell:hover { background: #f8fafc !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-cell:hover { background: rgba(255,255,255,0.03) !important; }',
      '#wjp-gcal-card .wjp-gcal-blank { background: #fafbfc !important; min-height: 90px !important; cursor: default !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-blank { background: rgba(0,0,0,0.15) !important; }',

      // Day number + today badge
      '#wjp-gcal-card .wjp-gcal-num { font-size: 12px !important; font-weight: 600 !important; color: #5c6873 !important; align-self: flex-start !important; margin-bottom: 1px !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-num { color: #8b95a1 !important; }',
      '#wjp-gcal-card .wjp-gcal-today .wjp-gcal-num { background: #1a73e8 !important; color: #fff !important; border-radius: 999px !important; width: 22px !important; height: 22px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; font-size: 11.5px !important; font-weight: 700 !important; box-shadow: 0 1px 3px rgba(26,115,232,0.3) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-today .wjp-gcal-num { background: #8ab4f8 !important; color: #1a1f26 !important; }',

      // Event chips
      '#wjp-gcal-card .wjp-gcal-chip { font-size: 10.5px !important; font-weight: 600 !important; padding: 3px 7px !important; background: rgba(26,115,232,0.12) !important; color: #1a73e8 !important; border-radius: 5px !important; line-height: 1.3 !important; transition: all .12s ease !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-chip { background: rgba(138,180,248,0.18) !important; color: #aecbfa !important; }',
      '#wjp-gcal-card .wjp-gcal-chip:hover { background: #1a73e8 !important; color: #fff !important; transform: translateY(-1px) !important; box-shadow: 0 2px 6px rgba(26,115,232,0.3) !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-chip:hover { background: #8ab4f8 !important; color: #1a1f26 !important; }',
      '#wjp-gcal-card .wjp-gcal-more { font-size: 10px !important; font-weight: 700 !important; color: #5c6873 !important; padding: 2px 7px !important; }',
      '#wjp-gcal-card .wjp-gcal-calfoot { font-size: 11.5px !important; color: #5c6873 !important; margin-top: 14px !important; font-weight: 500 !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-calfoot { color: #8b95a1 !important; }',

      // Hide the redundant upcoming list
      '#wjp-gcal-card .wjp-gcal-list { display: none !important; }',

      // Transactions Calendar label
      '#wjp-gcal-tx-title { text-align: center !important; margin: 48px 0 28px !important; padding: 0 20px !important; }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-eyebrow { font-size: 11px !important; font-weight: 800 !important; letter-spacing: 0.18em !important; color: #1f7a4a !important; margin-bottom: 8px !important; text-transform: uppercase !important; }',
      'body.dark #wjp-gcal-tx-title .wjp-gcal-tx-eyebrow { color: #7fd1a4 !important; }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-name { font-size: 26px !important; font-weight: 800 !important; letter-spacing: -0.6px !important; color: #0f1419 !important; margin-bottom: 6px !important; line-height: 1.15 !important; }',
      'body.dark #wjp-gcal-tx-title .wjp-gcal-tx-name { color: #f0f3f5 !important; }',
      '#wjp-gcal-tx-title .wjp-gcal-tx-sub { font-size: 13px !important; color: #5c6873 !important; max-width: 460px !important; margin: 0 auto !important; line-height: 1.5 !important; }',
      'body.dark #wjp-gcal-tx-title .wjp-gcal-tx-sub { color: #8b95a1 !important; }',
      // Connection-status badge
      '#wjp-gcal-card .wjp-gcal-conn-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; background: rgba(31,122,74,0.12); color: #1f7a4a; border-radius: 999px; font-size: 11.5px; font-weight: 700; letter-spacing: -0.1px; align-self: center; }',
      'body.dark #wjp-gcal-card .wjp-gcal-conn-badge { background: rgba(127,209,164,0.18); color: #7fd1a4; }',
      '#wjp-gcal-card .wjp-gcal-conn-dot { width: 8px; height: 8px; border-radius: 999px; background: #1f7a4a; box-shadow: 0 0 0 3px rgba(31,122,74,0.25); animation: wjpGcalPulse 2.4s ease-in-out infinite; }',
      'body.dark #wjp-gcal-card .wjp-gcal-conn-dot { background: #7fd1a4; box-shadow: 0 0 0 3px rgba(127,209,164,0.30); }',
      '@keyframes wjpGcalPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.9); } }',
      // Link-style button for the soft "disconnect" action
      '#wjp-gcal-card .wjp-gcal-btn.link { background: transparent !important; color: #5c6873 !important; padding: 11px 4px !important; font-weight: 600 !important; font-size: 12px !important; text-decoration: underline; text-decoration-color: rgba(0,0,0,0.15); text-underline-offset: 3px; box-shadow: none !important; border: 0 !important; }',
      '#wjp-gcal-card .wjp-gcal-btn.link:hover { color: #c0594a !important; text-decoration-color: #c0594a !important; transform: none !important; }',
      'body.dark #wjp-gcal-card .wjp-gcal-btn.link { color: #8b95a1 !important; text-decoration-color: rgba(255,255,255,0.20); }',
      'body.dark #wjp-gcal-card .wjp-gcal-btn.link:hover { color: #e08070 !important; text-decoration-color: #e08070 !important; }',
      '#wjp-gcal-card .wjp-gcal-connbar { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 0 auto 24px; position: relative; }',
      '#wjp-gcal-card .wjp-gcal-managebtn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; background: transparent; border: 1px solid rgba(0,0,0,0.12); color: #5c6873; font-size: 11.5px; font-weight: 700; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all .12s ease; }',
      '#wjp-gcal-card .wjp-gcal-managebtn:hover { border-color: rgba(31,122,74,0.4); color: #1f7a4a; background: rgba(31,122,74,0.04); }',
      'body.dark #wjp-gcal-card .wjp-gcal-managebtn { border-color: rgba(255,255,255,0.15); color: #8b95a1; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managebtn:hover { border-color: rgba(127,209,164,0.4); color: #7fd1a4; background: rgba(127,209,164,0.06); }',
      '#wjp-gcal-card .wjp-gcal-managepop { position: absolute; top: 100%; right: 50%; transform: translateX(50%); margin-top: 8px; background: #fff; border: 1px solid rgba(0,0,0,0.10); border-radius: 12px; padding: 6px; min-width: 220px; box-shadow: 0 8px 28px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06); z-index: 100; display: flex; flex-direction: column; gap: 2px; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managepop { background: #1c2129; border-color: rgba(255,255,255,0.12); box-shadow: 0 8px 28px rgba(0,0,0,0.5); }',
      '#wjp-gcal-card .wjp-gcal-managelink { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: transparent; border: 0; border-radius: 8px; color: #0f1419; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; text-align: left; transition: background .12s ease; }',
      '#wjp-gcal-card .wjp-gcal-managelink:hover { background: rgba(31,122,74,0.08); color: #1f7a4a; }',
      '#wjp-gcal-card .wjp-gcal-managelink.danger { color: #c0594a; }',
      '#wjp-gcal-card .wjp-gcal-managelink.danger:hover { background: rgba(192,89,74,0.10); color: #c0594a; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managelink { color: #f0f3f5; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managelink:hover { background: rgba(127,209,164,0.12); color: #7fd1a4; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managelink.danger { color: #e08070; }',
      'body.dark #wjp-gcal-card .wjp-gcal-managelink.danger:hover { background: rgba(224,128,112,0.12); color: #e08070; }',
      '#wjp-gcal-card .wjp-gcal-managelink i { font-size: 14px; }',
      // Info icon next to title
      '#wjp-gcal-card .wjp-gcal-titlerow { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 0 0 6px; }',
      '#wjp-gcal-card .wjp-gcal-infobtn { background: transparent; border: 0; padding: 0; cursor: pointer; color: #8b95a1; transition: color .12s ease, transform .12s ease; line-height: 1; }',
      '#wjp-gcal-card .wjp-gcal-infobtn i { font-size: 18px; }',
      '#wjp-gcal-card .wjp-gcal-infobtn:hover { color: #1a73e8; transform: translateY(-1px); }',
      'body.dark #wjp-gcal-card .wjp-gcal-infobtn { color: #6b7480; }',
      'body.dark #wjp-gcal-card .wjp-gcal-infobtn:hover { color: #8ab4f8; }',
      // Info modal — clean sections
      '#wjp-gcal-detail-pop .wjp-gcal-info { max-height: 70vh; overflow-y: auto; padding-right: 4px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-head { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.06); }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-head { border-bottom-color: rgba(255,255,255,0.08); }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(26,115,232,0.12); color: #1a73e8; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-icon i { font-size: 22px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-icon { background: rgba(138,180,248,0.18); color: #8ab4f8; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-title { font-size: 17px; font-weight: 800; letter-spacing: -0.3px; color: #0f1419; margin-bottom: 2px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-title { color: #f0f3f5; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-sub { font-size: 12px; color: #5c6873; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-sub { color: #8b95a1; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-sect { margin-bottom: 16px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-sect:last-child { margin-bottom: 0; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; letter-spacing: -0.1px; color: #0f1419; margin-bottom: 6px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-h { color: #f0f3f5; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-h i { color: #1f7a4a; font-size: 16px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-h i { color: #7fd1a4; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-sect p { font-size: 12.5px; line-height: 1.55; color: #5c6873; margin: 0; padding-left: 24px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-sect p { color: #a8b1bb; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-sect p b { color: #0f1419; font-weight: 700; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-sect p b { color: #f0f3f5; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-warn { background: rgba(255,193,7,0.08); border: 1px solid rgba(255,193,7,0.20); border-radius: 10px; padding: 12px 14px; margin: 4px 0 16px; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-warn { background: rgba(255,193,7,0.10); border-color: rgba(255,193,7,0.25); }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-warn .wjp-gcal-info-h { margin-bottom: 4px; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-warn .wjp-gcal-info-h i { color: #d97706; }',
      '#wjp-gcal-detail-pop .wjp-gcal-info-warn p { padding-left: 0; color: #5c6873; }',
      'body.dark #wjp-gcal-detail-pop .wjp-gcal-info-warn p { color: #a8b1bb; }',
      // "Already added it?" affordance for migration users
      '#wjp-gcal-card .wjp-gcal-already { text-align: center; margin: 12px 0 0; }',
      '#wjp-gcal-card .wjp-gcal-alreadybtn { background: transparent; border: 0; padding: 6px 12px; cursor: pointer; font-family: inherit; font-size: 12px; color: #5c6873; transition: color .12s ease; }',
      '#wjp-gcal-card .wjp-gcal-alreadybtn b { color: #1f7a4a; font-weight: 700; }',
      '#wjp-gcal-card .wjp-gcal-alreadybtn:hover { color: #1f7a4a; }',
      '#wjp-gcal-card .wjp-gcal-alreadybtn:hover b { text-decoration: underline; }',
      'body.dark #wjp-gcal-card .wjp-gcal-alreadybtn { color: #8b95a1; }',
      'body.dark #wjp-gcal-card .wjp-gcal-alreadybtn b { color: #7fd1a4; }',
      'body.dark #wjp-gcal-card .wjp-gcal-alreadybtn:hover { color: #7fd1a4; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ────────── FIX 87 v14: privacy + sync info modal ──────────
  function showInfoModal() {
    _openDetailPopover(
      '<div class="wjp-gcal-info">' +
        '<div class="wjp-gcal-info-head">' +
          '<div class="wjp-gcal-info-icon"><i class="ph ph-info"></i></div>' +
          '<div>' +
            '<div class="wjp-gcal-info-title">About this sync</div>' +
            '<div class="wjp-gcal-info-sub">How your data flows and who can see it</div>' +
          '</div>' +
        '</div>' +
        '<div class="wjp-gcal-info-sect">' +
          '<div class="wjp-gcal-info-h"><i class="ph ph-flow-arrow"></i> How it works</div>' +
          '<p>Your bills and debt due dates are exported as a standards-compliant calendar feed (iCalendar). Google polls your personal URL every few hours and copies events into your Google Calendar. Reminders fire from Google, not from this app.</p>' +
        '</div>' +
        '<div class="wjp-gcal-info-sect">' +
          '<div class="wjp-gcal-info-h"><i class="ph ph-users-three"></i> Other users of this app</div>' +
          '<p><b>Completely isolated.</b> Each user gets a unique URL signed with a server-side secret. Another user\'s URL cannot read your data and vice versa — the function verifies the signature before any database read.</p>' +
        '</div>' +
        '<div class="wjp-gcal-info-sect">' +
          '<div class="wjp-gcal-info-h"><i class="ph ph-google-logo"></i> What Google sees</div>' +
          '<p>Google receives the events themselves: bill names, amounts, debt names, due dates, APRs, balances. They store this like any other calendar event. If you\'ve shared your Google Calendar with anyone (spouse, employer), they will see these events too — adjust visibility in Google Calendar settings.</p>' +
        '</div>' +
        '<div class="wjp-gcal-info-sect wjp-gcal-info-warn">' +
          '<div class="wjp-gcal-info-h"><i class="ph ph-warning-circle"></i> Your sync URL is a credential</div>' +
          '<p>Anyone with your URL can read your calendar (this is how Google polls anonymously). <b>Treat the URL like a password</b> — don\'t paste it in emails, chats, or screenshots. Same model as Apple, Outlook, Mint, and YNAB calendar feeds.</p>' +
        '</div>' +
        '<div class="wjp-gcal-info-sect">' +
          '<div class="wjp-gcal-info-h"><i class="ph ph-arrow-counter-clockwise"></i> How to disconnect</div>' +
          '<p>Open Google Calendar → Settings → click the "WJP Debt Tracker" calendar in the sidebar → <b>Unsubscribe</b>. Google stops polling instantly. The "Mark as disconnected" button in the Manage menu only clears the local badge.</p>' +
        '</div>' +
      '</div>'
    );
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
      '<div class="wjp-gcal-titlerow">' +
        '<div class="wjp-gcal-title">Payments Calendar</div>' +
        '<button type="button" class="wjp-gcal-infobtn" data-action="info" aria-label="About sync & privacy" title="About sync & privacy"><i class="ph ph-info"></i></button>' +
      '</div>' +
      (isGoogleConnected()
        ? '<div class="wjp-gcal-connbar">' +
            '<span class="wjp-gcal-conn-badge"><span class="wjp-gcal-conn-dot"></span>Connected to Google Calendar</span>' +
            '<button type="button" class="wjp-gcal-managebtn" data-action="toggle-manage" aria-label="Manage sync">Manage <i class="ph ph-caret-down"></i></button>' +
            '<div class="wjp-gcal-managepop" id="wjp-gcal-managepop" style="display:none;">' +
              '<button type="button" class="wjp-gcal-managelink" data-action="sync-url"><i class="ph ph-copy-simple"></i> Re-copy sync URL</button>' +
              '<button type="button" class="wjp-gcal-managelink" data-action="download"><i class="ph ph-download-simple"></i> Download .ics file</button>' +
              '<button type="button" class="wjp-gcal-managelink danger" data-action="disconnect"><i class="ph ph-link-break"></i> Mark as disconnected</button>' +
            '</div>' +
          '</div>'
        : '<div class="wjp-gcal-subtitle">Bills + debt due dates — synced to Google Calendar with reminders 1 day before each.</div>' +
          '<div class="wjp-gcal-head">' +
            '<div class="wjp-gcal-logo">' + gcalLogoHtml() + '</div>' +
            '<div style="flex:1;">' +
              '<h2>Sync to Google Calendar</h2>' +
              '<p class="wjp-gcal-sub">' + events.length + ' event' + (events.length === 1 ? '' : 's') + ' ready</p>' +
            '</div>' +
          '</div>' +
          '<div class="wjp-gcal-actions">' +
            '<button type="button" class="wjp-gcal-btn primary" data-action="sync-url"><i class="ph ph-link-simple"></i> Copy auto-sync URL</button>' +
            '<button type="button" class="wjp-gcal-btn ghost" data-action="download"><i class="ph ph-download-simple"></i> Download .ics file</button>' +
          '</div>' +
          '<div class="wjp-gcal-already"><button type="button" class="wjp-gcal-alreadybtn" data-action="mark-connected">Already added it to Google Calendar? <b>Mark as connected \u2192</b></button></div>' +
          '<div class="wjp-gcal-status" id="wjp-gcal-status" style="font-size:11.5px; color:var(--text-3); margin: -4px 0 12px; min-height:16px;"></div>') +
      buildMonthGrid() +
      listHtml +
      (isGoogleConnected() ? '' : '<details>' +
        '<summary>How to import into Google Calendar</summary>' +
        '<ol class="wjp-gcal-steps">' +
          '<li><b>Auto-sync (recommended):</b> click <b>Copy auto-sync URL</b>, then in <a href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener">Google Calendar → Settings → Add calendar → From URL</a>, paste the URL and Add. Google polls every few hours and picks up your edits automatically.</li>' +
          '<li><b>One-time import:</b> click <b>Download .ics file</b>, then in <a href="https://calendar.google.com/calendar/u/0/r/settings/export" target="_blank" rel="noopener">Settings → Import & export</a>, upload the file. No auto-updates — re-import when you add bills.</li>' +
          '<li><b>Per-event:</b> click any <b>+ Google</b> link in the grid above to save a single bill instantly.</li>' +
          '<li>Google sets a reminder 1 day before each due date automatically (VALARM in the feed).</li>' +
        '</ol>' +
        '<p style="font-size:11px; color:var(--text-3); margin:10px 0 0;"><b>Privacy:</b> your auto-sync URL contains a signed token. Anyone with the URL can read your bill data — treat it like a password and don\'t share it publicly.</p>' +
      '</details>');

    card.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var act = btn.getAttribute('data-action');
      if (act === 'download') downloadIcs();
      else if (act === 'sync-url') fetchSyncUrl();
      else if (act === 'prev-month') { _viewMonth.m -= 1; if (_viewMonth.m < 0) { _viewMonth.m = 11; _viewMonth.y -= 1; } inject(); }
      else if (act === 'next-month') { _viewMonth.m += 1; if (_viewMonth.m > 11) { _viewMonth.m = 0; _viewMonth.y += 1; } inject(); }
      else if (act === 'today') { var n = new Date(); _viewMonth.y = n.getFullYear(); _viewMonth.m = n.getMonth(); inject(); }
      else if (act === 'event-detail') {
        e.stopPropagation();
        var dk = btn.getAttribute('data-day');
        var ix = parseInt(btn.getAttribute('data-idx'), 10);
        showEventDetail(dk, ix);
      }
      else if (act === 'day-detail') {
        e.stopPropagation();
        var dk2 = btn.getAttribute('data-day');
        showDayDetail(dk2);
      }
      else if (act === 'close-detail') { _closeDetailPopover(); }
      else if (act === 'info') { e.stopPropagation(); showInfoModal(); }
      else if (act === 'mark-connected') { e.stopPropagation(); markGoogleConnected(); }
      else if (act === 'toggle-manage') {
        var pop = document.getElementById('wjp-gcal-managepop');
        if (pop) pop.style.display = (pop.style.display === 'block' ? 'none' : 'block');
        e.stopPropagation();
      }
      else if (act === 'disconnect') {
        if (!confirm('Mark Google Calendar as disconnected? This only removes the badge — to actually stop the sync you must delete the calendar in Google Calendar itself.')) return;
        var s = getState();
        if (s && s.prefs) {
          delete s.prefs.googleCalConnected;
          delete s.prefs.googleCalConnectedAt;
          try { if (typeof window.saveState === 'function') window.saveState(); } catch (_) {}
          try { if (typeof window.cloudPushNow === 'function') window.cloudPushNow(); } catch (_) {}
        }
        inject();
      }
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

    try {
      var calRoot2 = document.getElementById('wjp-cal-root');
      var existingTitle = document.getElementById('wjp-gcal-tx-title');
      if (calRoot2 && !existingTitle) {
        var t = document.createElement('div');
        t.id = 'wjp-gcal-tx-title';
        t.innerHTML = '<div class="wjp-gcal-tx-eyebrow">YOUR LEDGER</div>' +
                      '<div class="wjp-gcal-tx-name">Transactions Calendar</div>' +
                      '<div class="wjp-gcal-tx-sub">All bills, debts, income, transfers and one-off events.</div>';
        host.insertBefore(t, calRoot2);
      }
    } catch (_) {}

    return true;
  }

  // ────────── boot ──────────
  function boot() {
    injectStyle();
    injectStyleV11Polish();
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

  // FIX 87 v13: close the Manage popup when clicking outside it
  document.addEventListener('click', function (e) {
    var pop = document.getElementById('wjp-gcal-managepop');
    if (!pop || pop.style.display !== 'block') return;
    var btn = document.querySelector('[data-action="toggle-manage"]');
    if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
    pop.style.display = 'none';
  });

  window.WJP_GoogleCalendar = {
    version: 15,
    gatherEvents: gatherEvents,
    buildIcs: buildIcs,
    downloadIcs: downloadIcs,
    refresh: inject
  };
})();
