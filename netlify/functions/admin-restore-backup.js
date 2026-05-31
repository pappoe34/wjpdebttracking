// POST /.netlify/functions/admin-restore-backup
// Headers: Authorization: Bearer <Firebase ID token of admin user>
// Body: { uid: string, snapshotDay: string, dryRun?: boolean }
//
// Reads userBackups/{uid}/snapshots/{snapshotDay} and overwrites
// users/{uid}/state/main with that snapshot.
//
// Safety:
//   - Requires admin auth (admins/list or seed admin).
//   - Writes a pre-restore safety snapshot of the CURRENT state to
//     userBackups/{uid}/snapshots/preRestore-<isoDate> so if the restore
//     turns out to be the wrong day, the admin can still undo.
//   - dryRun: true returns what WOULD happen without writing anything.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function counts(data) {
  if (!data) return { total: 0, perKey: {} };
  const TRACKED = ['debts', 'assets', 'transactions', 'recurringPayments', 'notifications', 'creditScoreHistory', 'inbox', 'processedTxIds'];
  let total = 0;
  const perKey = {};
  TRACKED.forEach((k) => {
    const n = Array.isArray(data[k]) ? data[k].length : 0;
    perKey[k] = n;
    total += n;
  });
  return { total, perKey };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

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

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const targetUid = (body.uid || '').trim();
  const snapshotDay = (body.snapshotDay || '').trim();
  const dryRun = !!body.dryRun;

  if (!targetUid || !snapshotDay) {
    return json(400, { error: 'Missing required fields: uid, snapshotDay' });
  }

  try {
    // Load the snapshot
    const snapRef = db.collection('userBackups').doc(targetUid).collection('snapshots').doc(snapshotDay);
    const snap = await snapRef.get();
    if (!snap.exists) {
      return json(404, { error: 'Snapshot not found for day ' + snapshotDay });
    }
    const snapshotData = snap.data() || {};
    const snapshotCounts = counts(snapshotData);

    // Load current state for comparison + safety snapshot
    const mainRef = db.collection('users').doc(targetUid).collection('state').doc('main');
    const mainSnap = await mainRef.get();
    const currentData = mainSnap.exists ? (mainSnap.data() || {}) : {};
    const currentCounts = counts(currentData);

    if (dryRun) {
      return json(200, {
        dryRun: true,
        wouldOverwrite: {
          uid: targetUid,
          fromSnapshot: snapshotDay,
          current: currentCounts,
          snapshot: snapshotCounts
        }
      });
    }

    // Write pre-restore safety snapshot
    const safetyDay = 'preRestore-' + new Date().toISOString().replace(/[:.]/g, '-');
    if (mainSnap.exists) {
      await db.collection('userBackups').doc(targetUid).collection('snapshots').doc(safetyDay).set({
        ...currentData,
        _serverBackupMeta: {
          ts: Date.now(),
          day: safetyDay,
          counts: currentCounts.perKey,
          total: currentCounts.total,
          reason: 'pre-restore-safety',
          restoredFrom: snapshotDay,
          adminUid: decoded.uid
        }
      });
    }

    // Strip the backup meta from the payload before writing it as the live state
    const payload = { ...snapshotData };
    delete payload._serverBackupMeta;
    // Force a new sync timestamp so connected browsers see it as newer than local
    payload._cloudSyncTs = Date.now();
    payload._cloudSyncFrom = 'admin-restore-' + (decoded.uid || 'unknown').slice(0, 16);

    await mainRef.set(payload, { merge: false });

    return json(200, {
      ok: true,
      uid: targetUid,
      restored: {
        fromSnapshot: snapshotDay,
        counts: snapshotCounts
      },
      safetySnapshot: safetyDay,
      previous: currentCounts
    });
  } catch (err) {
    console.error('[admin-restore-backup]', err);
    return json(500, { error: 'Restore failed: ' + (err && err.message ? err.message : 'unknown') });
  }
};
