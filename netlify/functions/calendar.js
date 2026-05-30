// GET /.netlify/functions/calendar?uid=<uid>&sig=<hmac-sha256-hex>
//
// Returns an iCalendar (RFC 5545) feed of the user's recurring bills and
// debt due dates. Designed for Google Calendar / Apple Calendar / Outlook
// "Add by URL" subscriptions. Google polls this URL every few hours and
// auto-imports any changes.
//
// Auth: HMAC of the uid with CAL_SIGNING_SECRET. The frontend mints this
// signature via /.netlify/functions/calendar-sync-url after the user is
// logged in, then the user pastes the resulting URL into Google Calendar.
// Since Google polls unauthenticated (no headers we control), the URL
// itself has to be the credential — which is why the HMAC is required.
//
// Privacy: anyone with the URL can read the user's bill + due-date data.
// Treat it like a password. The frontend warns the user not to share it.

const crypto = require('crypto');
const { getFirestore } = require('./_shared/firebase');

function pad(n) { return String(n).padStart(2, '0'); }
function toIcsDate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate());
}
function toIcsDateTime(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.getUTCFullYear() + pad(dt.getUTCMonth() + 1) + pad(dt.getUTCDate())
    + 'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
}
function escIcs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function rruleFor(freq) {
  const f = String(freq || '').toLowerCase();
  if (f === 'weekly') return 'RRULE:FREQ=WEEKLY';
  if (f === 'biweekly' || f === 'bi-weekly' || f === '2weeks') return 'RRULE:FREQ=WEEKLY;INTERVAL=2';
  if (f === 'monthly') return 'RRULE:FREQ=MONTHLY';
  if (f === 'quarterly') return 'RRULE:FREQ=MONTHLY;INTERVAL=3';
  if (f === 'yearly' || f === 'annually') return 'RRULE:FREQ=YEARLY';
  return null;
}
function money(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2);
}

function gatherEvents(state) {
  if (!state) return [];
  const events = [];
  const now = new Date();
  const dtstamp = toIcsDateTime(now);

  (state.recurringPayments || []).forEach((r) => {
    if (!r || !r.nextDate) return;
    const cat = String(r.category || '').toLowerCase();
    if (cat === 'income' || r.linkedIncome) return;
    const dt = toIcsDate(r.nextDate);
    if (!dt) return;
    const rrule = rruleFor(r.frequency);
    const name = r.name || 'Bill payment';
    events.push({
      uid: 'rec-' + (r.id || (name + '-' + dt)) + '@wjpdebttracking.com',
      dtstamp,
      date: dt,
      summary: `${name} — ${money(r.amount)}`,
      description: `Recurring ${r.frequency || 'payment'} from your debt tracker.`,
      rrule
    });
  });

  (state.debts || []).forEach((d) => {
    if (!d || !d.dueDate) return;
    const dayOfMonth = parseInt(d.dueDate, 10);
    let dt;
    if (!isNaN(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) {
      const y = now.getUTCFullYear();
      let m = now.getUTCMonth();
      const todayDay = now.getUTCDate();
      if (dayOfMonth < todayDay) m += 1;
      const next = new Date(Date.UTC(y, m, dayOfMonth));
      dt = toIcsDate(next);
    } else {
      dt = toIcsDate(d.dueDate);
    }
    if (!dt) return;
    const name = (d.name || 'Debt') + ' due';
    const min = d.minimum || d.minPayment || 0;
    const amt = min ? ` (min ${money(min)})` : '';
    events.push({
      uid: 'debt-' + (d.id || d.name) + '@wjpdebttracking.com',
      dtstamp,
      date: dt,
      summary: name + amt,
      description: `Monthly due date for ${d.name || 'this debt'}. APR: ${d.apr || 0}%. Balance: ${money(d.balance || 0)}.`,
      rrule: 'RRULE:FREQ=MONTHLY'
    });
  });

  return events;
}

function buildIcs(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WJP Debt Tracking//Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:WJP Debt Tracker',
    'X-WR-CALDESC:Bills and debt due dates synced from wjpdebttracking.com',
    'X-WR-TIMEZONE:UTC',
    // Refresh hint for clients that honor it (some do, some ignore — Google's
    // poll cadence is independent, but Apple/Outlook read this).
    'X-PUBLISHED-TTL:PT2H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H'
  ];
  events.forEach((e) => {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + e.uid);
    lines.push('DTSTAMP:' + e.dtstamp);
    lines.push('DTSTART;VALUE=DATE:' + e.date);
    lines.push('SUMMARY:' + escIcs(e.summary));
    lines.push('DESCRIPTION:' + escIcs(e.description));
    if (e.rrule) lines.push(e.rrule);
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-P1D');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + escIcs('Reminder: ' + e.summary));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function signUid(uid, secret) {
  return crypto.createHmac('sha256', secret).update(uid).digest('hex');
}

function timingSafeEqualHex(a, b) {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  // CORS — feeds get polled by Google/Apple bots, but humans may also fetch
  // via curl/Postman. Allow GET only.
  const HEADERS_TEXT = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=900' // 15 min cache to dampen polling load
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: HEADERS_TEXT, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: HEADERS_TEXT, body: 'Method not allowed' };
  }

  const q = event.queryStringParameters || {};
  const uid = (q.uid || '').trim();
  const sig = (q.sig || '').trim().toLowerCase();
  if (!uid || !sig) {
    return { statusCode: 400, headers: HEADERS_TEXT, body: 'Missing uid or sig' };
  }
  const secret = process.env.CAL_SIGNING_SECRET;
  if (!secret) {
    return { statusCode: 500, headers: HEADERS_TEXT, body: 'Server misconfigured (no signing secret)' };
  }
  const expected = signUid(uid, secret);
  if (!timingSafeEqualHex(sig, expected)) {
    return { statusCode: 403, headers: HEADERS_TEXT, body: 'Invalid signature' };
  }

  // Read user state from Firestore
  try {
    const db = getFirestore();
    const snap = await db.collection('users').doc(uid).collection('state').doc('main').get();
    if (!snap.exists) {
      // Return an empty but valid calendar so the subscription doesn't break
      const empty = buildIcs([]);
      return {
        statusCode: 200,
        headers: { ...HEADERS_TEXT, 'Content-Type': 'text/calendar; charset=utf-8' },
        body: empty
      };
    }
    const state = snap.data() || {};
    const events = gatherEvents(state);
    const ics = buildIcs(events);
    return {
      statusCode: 200,
      headers: { ...HEADERS_TEXT, 'Content-Type': 'text/calendar; charset=utf-8' },
      body: ics
    };
  } catch (err) {
    console.error('[calendar] error', err);
    return {
      statusCode: 500,
      headers: HEADERS_TEXT,
      body: 'Failed to build calendar: ' + (err && err.message ? err.message : 'unknown error')
    };
  }
};
