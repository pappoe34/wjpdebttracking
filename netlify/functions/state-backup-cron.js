// Scheduled function: nightly server-side backup of every user's state/main doc.
//
// Schedule: configured in netlify.toml [functions."state-backup-cron".schedule].
//
// Why this exists:
//   Client-side guards (wjp-data-loss-guard v2 + v3) protect against most data
//   loss vectors but ALL require the user's browser to be open and reachable.
//   This server-side cron is the independent last line of defence: even if
//   every client-side guard fails or never runs, this function snapshots each
//   user's state nightly to a server-controlled collection that users cannot
//   touch from the client.
//
// What it does:
//   For each user (paginated via Firebase Auth listUsers):
//     1. Read users/{uid}/state/main
//     2. If any tracked array has data (debts, assets, transactions, etc.),
//        write a snapshot to userBackups/{uid}/snapshots/{YYYYMMDD}
//     3. Rotation: occasionally (every 7 days) delete snapshots older than 30 days
//
// Storage location:
//   userBackups/{uid}/snapshots/{YYYYMMDD}
//   This is a separate top-level collection. Firestore rules MUST deny client
//   read/write here so the backup can't be accidentally wiped by app code.
//
// Schedule: 0 3 * * *  (3:00 AM UTC daily — spread from email-cron at 13/14 UTC)
//
// Auth model: caller is Netlify scheduler. No external auth — only Netlify can
// invoke scheduled functions. Inside, Firebase Admin SDK uses the service
// account from env FIREBASE_SERVICE_ACCOUNT_JSON.

const { getFirebaseAdmin, getFirestore } = require('./_shared/firebase');

const TRACKED_ARRAYS = [
  'debts', 'assets', 'transactions', 'recurringPayments',
  'notifications', 'creditScoreHistory', 'inbox', 'processedTxIds'
];
const KEEP_DAYS = 30;
const BATCH_SIZE = 20; // process this many users in parallel
const PAGE_SIZE = 1000; // listUsers max page

function todayStamp() {
  const d = new Date();
  return d.getUTCFullYear()
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0');
}

function counts(data) {
  if (!data) return { total: 0, perKey: {} };
  let total = 0;
  const perKey = {};
  TRACKED_ARRAYS.forEach(k => {
    const n = Array.isArray(data[k]) ? data[k].length : 0;
    perKey[k] = n;
    total += n;
  });
  return { total, perKey };
}

function hasMeaningfulData(data) {
  if (!data || typeof data !== 'object') return false;
  return TRACKED_ARRAYS.some(k => Array.isArray(data[k]) && data[k].length > 0);
}

async function processUser(db, admin, uid, today, doRotation) {
  const result = { uid, status: null };
  try {
    const mainSnap = await db.collection('users').doc(uid).collection('state').doc('main').get();
    if (!mainSnap.exists) { result.status = 'no-main'; return result; }
    const data = mainSnap.data();
    if (!hasMeaningfulData(data)) { result.status = 'empty'; return result; }

    const c = counts(data);
    const payload = {
      ...data,
      _serverBackupMeta: {
        ts: Date.now(),
        day: today,
        counts: c.perKey,
        total: c.total,
        version: 1
      }
    };
    const backupRef = db
      .collection('userBackups').doc(uid)
      .collection('snapshots').doc(today);
    await backupRef.set(payload);
    result.status = 'backed-up';
    result.counts = c.perKey;

    // Rotation: every ~7 days, prune snapshots older than KEEP_DAYS
    if (doRotation) {
      try {
        const all = await db.collection('userBackups').doc(uid).collection('snapshots').get();
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
        const cutoffStamp = cutoff.getUTCFullYear()
          + String(cutoff.getUTCMonth() + 1).padStart(2, '0')
          + String(cutoff.getUTCDate()).padStart(2, '0');
        const deletions = [];
        all.forEach(doc => {
          if (doc.id < cutoffStamp) {
            deletions.push(doc.ref.delete());
          }
        });
        if (deletions.length) {
          await Promise.all(deletions);
          result.rotated = deletions.length;
        }
      } catch (e) {
        result.rotationError = e.message;
      }
    }
  } catch (e) {
    result.status = 'error';
    result.error = e.message;
  }
  return result;
}

async function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

exports.handler = async function (event) {
  const startTs = Date.now();
  const today = todayStamp();
  // Run full rotation pass roughly weekly to spread the deletion load
  const day = new Date().getUTCDate();
  const doRotation = (day % 7 === 0); // every 7th of the month — adjust if needed

  let admin, db;
  try {
    admin = getFirebaseAdmin();
    db = getFirestore();
  } catch (e) {
    console.error('state-backup-cron init failed:', e.message);
    return { statusCode: 500, body: 'init failed: ' + e.message };
  }

  const summary = {
    startedAt: new Date(startTs).toISOString(),
    today,
    rotationPass: doRotation,
    totalUsers: 0,
    backedUp: 0,
    empty: 0,
    noMain: 0,
    errors: 0,
    rotatedTotal: 0,
    durationMs: 0,
    errorSamples: []
  };

  try {
    let pageToken = undefined;
    do {
      const listResult = await admin.auth().listUsers(PAGE_SIZE, pageToken);
      const users = listResult.users;
      summary.totalUsers += users.length;

      const batches = await chunk(users.map(u => u.uid), BATCH_SIZE);
      for (const uidBatch of batches) {
        const results = await Promise.all(
          uidBatch.map(uid => processUser(db, admin, uid, today, doRotation))
        );
        results.forEach(r => {
          if (r.status === 'backed-up') summary.backedUp++;
          else if (r.status === 'empty') summary.empty++;
          else if (r.status === 'no-main') summary.noMain++;
          else { summary.errors++; if (summary.errorSamples.length < 5) summary.errorSamples.push(r); }
          if (r.rotated) summary.rotatedTotal += r.rotated;
        });
      }

      pageToken = listResult.pageToken;
    } while (pageToken);
  } catch (e) {
    summary.fatal = e.message;
  }

  summary.durationMs = Date.now() - startTs;
  console.log('[state-backup-cron]', JSON.stringify(summary));
  return {
    statusCode: 200,
    body: JSON.stringify(summary)
  };
};
