// POST /.netlify/functions/admin-manage
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { action: 'add' | 'remove', email: string }
// Only existing admins can call this. Up to 10 total slots.
// Seed admin (pappoe34@gmail.com) cannot be removed.
const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';
const ADMIN_MAX = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const callerUid = decoded.uid;
    const callerEmail = (decoded.email || '').toLowerCase();

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid JSON' }) }; }

    const action = String(body.action || '').toLowerCase();
    const targetEmail = String(body.email || '').trim().toLowerCase();
    if (!action || !targetEmail) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'action and email required' }) };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid email format' }) };
    }

    const db = getFirestore();
    const adminListRef = db.collection('admins').doc('list');
    const snap = await adminListRef.get();
    let data = snap.exists ? snap.data() : null;
    if (!data) data = { uids: [], emails: {}, createdAt: Date.now() };

    // Authorize — caller must be admin
    const callerIsAdmin = (data.uids || []).includes(callerUid) || callerEmail === SEED_ADMIN_EMAIL;
    if (!callerIsAdmin) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'forbidden: not an admin' }) };
    }

    // Look up target user by email via Firebase Auth (admin SDK)
    let targetUid;
    try {
      const auth = getFirebaseAdmin().auth();
      const targetUser = await auth.getUserByEmail(targetEmail);
      targetUid = targetUser.uid;
    } catch (e) {
      if (action === 'add') {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'no user with that email — they must sign up first' }) };
      }
      // For remove, we may not have a Firebase Auth record (deleted user) — fall back to email match
      const fallbackUid = Object.keys(data.emails || {}).find(u => (data.emails[u] || '').toLowerCase() === targetEmail);
      targetUid = fallbackUid || null;
    }

    if (action === 'add') {
      if ((data.uids || []).includes(targetUid)) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, message: 'already an admin' }) };
      }
      if ((data.uids || []).length >= ADMIN_MAX) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'admin slots full (max ' + ADMIN_MAX + ')' }) };
      }
      data.uids = [...(data.uids || []), targetUid];
      data.emails = { ...(data.emails || {}), [targetUid]: targetEmail };
      data.addedAtByUid = { ...(data.addedAtByUid || {}), [targetUid]: Date.now() };
      await adminListRef.set(data);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'added', email: targetEmail, uid: targetUid }) };
    } else if (action === 'remove') {
      if (targetEmail === SEED_ADMIN_EMAIL) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'cannot remove seed admin' }) };
      }
      if (!targetUid) {
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'target user not found' }) };
      }
      data.uids = (data.uids || []).filter(u => u !== targetUid);
      if (data.emails) delete data.emails[targetUid];
      if (data.addedAtByUid) delete data.addedAtByUid[targetUid];
      await adminListRef.set(data);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'removed', email: targetEmail }) };
    }
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'unknown action: ' + action }) };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('admin-manage error:', msg);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
