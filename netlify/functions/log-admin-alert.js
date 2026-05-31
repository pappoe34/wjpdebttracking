// POST /.netlify/functions/log-admin-alert
// Headers: Authorization: Bearer <Firebase ID token (any logged-in user)>
// Body: { type, before, after, source, details }
//
// Logs an admin alert to Firestore `adminAlerts/{alertId}`. Used by the
// client-side data-loss guard to silently notify admins when a fail-safe
// (auto-restore from backup, cloud-pull rejection, etc.) fires for a user.
// The user never sees the banner; the admin sees the alert in Data Health.
//
// Auth: requires a valid Firebase ID token (any user can post their own
// alert). The function writes the alert tagged with the user's uid so admins
// can correlate alerts back to specific users.

const { verifyIdToken, getFirebaseAdmin, getFirestore } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let decoded;
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    decoded = await verifyIdToken(authHeader);
  } catch (e) {
    return json(401, { error: 'unauthorized: ' + e.message });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  const alert = {
    uid: decoded.uid,
    email: decoded.email || null,
    type: String(body.type || 'unknown').slice(0, 64),
    source: String(body.source || 'guard-v3').slice(0, 64),
    before: body.before || null,
    after: body.after || null,
    details: body.details ? String(body.details).slice(0, 500) : null,
    ts: Date.now(),
    createdAt: new Date().toISOString(),
    userAgent: (event.headers['user-agent'] || '').slice(0, 200),
    resolved: false
  };

  try {
    const admin = getFirebaseAdmin();
    const db = getFirestore();
    const ref = db.collection('adminAlerts').doc();
    await ref.set(alert);

    // FIX 109: fire email + optional SMS for critical alerts
    const sev = String(body.severity || '').toLowerCase();
    const isCritical = sev === 'critical' || alert.type === 'push_failure' || alert.type === 'dirty_stuck';
    if (isCritical) {
      try {
        const { sendEmail } = require('./_shared/resend');
        const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'pappoe34@gmail.com';
        const subject = `[WJP CRITICAL] ${alert.type} — user ${alert.email || alert.uid.slice(0,10)}`;
        const html = `
          <div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;">
            <h2 style="color:#c0594a;">Critical alert: ${alert.type}</h2>
            <p><b>User:</b> ${alert.email || '(no email)'} (${alert.uid})</p>
            <p><b>Source:</b> ${alert.source}</p>
            <p><b>Details:</b></p>
            <pre style="background:#f5f5f5;padding:10px;border-radius:6px;white-space:pre-wrap;">${(alert.details || '').slice(0, 1000)}</pre>
            <p><b>User-Agent:</b> ${alert.userAgent}</p>
            <p><b>Time:</b> ${alert.createdAt}</p>
            <p><a href="https://console.firebase.google.com/u/0/project/wjp-debt-tracking/firestore/data/~2FadminAlerts~2F${ref.id}">View in Firebase</a></p>
          </div>`;
        await sendEmail({ to: adminEmail, subject, html, tags: [{ name: 'kind', value: 'admin_alert' }] });
      } catch (emailErr) {
        console.warn('[log-admin-alert] email failed', emailErr);
      }

      // SMS via Twilio — only fires if TWILIO_* env vars are configured
      try {
        const tSid = process.env.TWILIO_ACCOUNT_SID;
        const tAuth = process.env.TWILIO_AUTH_TOKEN;
        const tFrom = process.env.TWILIO_FROM_NUMBER;
        const tTo = process.env.ADMIN_ALERT_PHONE;
        if (tSid && tAuth && tFrom && tTo) {
          const params = new URLSearchParams();
          params.append('From', tFrom);
          params.append('To', tTo);
          params.append('Body', `WJP CRITICAL: ${alert.type} for ${alert.email || alert.uid.slice(0,10)}. ${(alert.details || '').slice(0, 80)}`);
          const auth = Buffer.from(tSid + ':' + tAuth).toString('base64');
          const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + tSid + '/Messages.json', {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
          });
          if (!r.ok) console.warn('[log-admin-alert] twilio HTTP', r.status);
        }
      } catch (smsErr) {
        console.warn('[log-admin-alert] sms failed', smsErr);
      }
    }

    return json(200, { ok: true, alertId: ref.id });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
