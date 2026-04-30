// GET /.netlify/functions/admin-status
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { isAdmin: bool, email: string, slotCount: number, slotMax: 10, admins: [{email, addedAt}] }
//
// Single source of truth for admin status. Stored in Firestore at:
//   admins/list  → { uids: [uid1, uid2, ...], emails: { uid: email } }
// Bootstrap admin: pappoe34@gmail.com is the seed admin and cannot be revoked.
const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';
const ADMIN_MAX = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const uid = decoded.uid;
    const email = (decoded.email || '').toLowerCase();
    const db = getFirestore();

    // Bootstrap: if admins/list doesn't exist and the caller is the seed admin,
    // create the list and add them.
    const adminListRef = db.collection('admins').doc('list');
    let snap = await adminListRef.get();
    let data = snap.exists ? snap.data() : null;

    if (!data && email === SEED_ADMIN_EMAIL) {
      data = { uids: [uid], emails: { [uid]: email }, createdAt: Date.now() };
      await adminListRef.set(data);
    }

    const isAdmin = !!(data && Array.isArray(data.uids) && data.uids.includes(uid))
      || (email === SEED_ADMIN_EMAIL); // Seed admin always passes

    // Build the admin roster (only returned if caller is admin)
    let admins = [];
    if (isAdmin && data) {
      admins = (data.uids || []).map(u => ({
        uid: u,
        email: (data.emails && data.emails[u]) || '(unknown)',
        addedAt: (data.addedAtByUid && data.addedAtByUid[u]) || data.createdAt || null,
        isSeed: ((data.emails && data.emails[u]) || '').toLowerCase() === SEED_ADMIN_EMAIL
      }));
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        isAdmin,
        email,
        uid,
        slotCount: admins.length,
        slotMax: ADMIN_MAX,
        admins
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('admin-status error:', msg);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
