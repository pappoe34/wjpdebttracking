// GET /.netlify/functions/admin-list-backups?uid=<target-uid>
// Headers: Authorization: Bearer <Firebase ID token of admin user>
//
// Returns the list of available backup snapshots for a user, sorted newest
// first. Includes per-snapshot counts (debts/recurring/transactions/etc) so
// the admin can pick a known-good one to restore from.
//
// Auth: requires the caller to be in admins/list (same pattern as other
// admin-* functions). Defense in depth: target-uid can be ANY user — only
// admins can call this.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

async function isAdmin(decoded, db) {
  const email = (decoded.email || '').toLowerCase();
  if (email === SEED_ADMIN_EMAIL) return true;
  try {
    const snap = await db.collection('admins').doc('list').get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    return Array.isArray(data.uids) && data.uids.includes(decoded.uid);
  } catch (_) { return false; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  let decoded;
  try {
    const h = event.headers || {};
    decoded = await verifyIdToken(h.authorization || h.Authorization);
  } catch (err) {
    return json(401, { error: 'Unauthorized: ' + (err && err.message ? err.message : 'token verification failed') });
  }

  const db = getFirestore();
  if (!(await isAdmin(decoded, db))) {
    return json(403, { error: 'Not an admin' });
  }

  const q = event.queryStringParameters || {};
  const targetUid = (q.uid || '').trim();
  if (!targetUid) return json(400, { error: 'Missing uid query parameter' });

  try {
    // Avoid Firestore composite index requirement by skipping orderBy.
    // Sort in JS after fetch — there's at most ~60 backups per user.
    const snaps = await db.collection('userBackups').doc(targetUid)
      .collection('snapshots').get();
    const backups = [];
    snaps.forEach((doc) => {
      const data = doc.data() || {};
      const meta = data._serverBackupMeta || {};
      backups.push({
        day: doc.id,
        ts: meta.ts || null,
        total: meta.total || 0,
        counts: meta.counts || {},
      });
    });
    backups.sort((a, b) => String(b.day).localeCompare(String(a.day)));
    return json(200, { uid: targetUid, count: backups.length, backups: backups.slice(0, 60) });
  } catch (err) {
    console.error('[admin-list-backups]', err);
    return json(500, { error: 'List failed: ' + (err && err.message ? err.message : 'unknown') });
  }
};
