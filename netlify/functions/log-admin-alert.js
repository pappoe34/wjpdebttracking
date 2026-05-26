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
    return json(200, { ok: true, alertId: ref.id });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
