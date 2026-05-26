// GET /.netlify/functions/admin-data-health
// Headers: Authorization: Bearer <Firebase ID token (admin user)>
//
// Returns a data-integrity report for every user in the system:
//   - Per-user state counts (debts, assets, transactions, etc.)
//   - Per-user backup health (client backup_latest + server-side snapshots)
//   - Anomalies: users with empty main but backups containing data (likely loss)
//   - Cron status: last server-side backup run timestamp
//
// Auth-gates via admins/list (same pattern as admin-stats).

const { verifyIdToken, getFirebaseAdmin, getFirestore } = require('./_shared/firebase');

const SEED_ADMIN_EMAIL = 'pappoe34@gmail.com';

const TRACKED_ARRAYS = [
  'debts', 'assets', 'transactions', 'recurringPayments',
  'notifications', 'creditScoreHistory', 'inbox', 'processedTxIds'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

async function isAdminUser(decoded, db) {
  const email = (decoded.email || '').toLowerCase();
  if (email === SEED_ADMIN_EMAIL) return true;
  try {
    const snap = await db.collection('admins').doc('list').get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    return Array.isArray(data.uids) && data.uids.includes(decoded.uid);
  } catch (_) { return false; }
}

function countsOf(data) {
  if (!data) return { total: 0 };
  const c = { total: 0 };
  TRACKED_ARRAYS.forEach(k => {
    const n = Array.isArray(data[k]) ? data[k].length : 0;
    c[k] = n;
    c.total += n;
  });
  return c;
}

async function processUser(db, user) {
  const uid = user.uid;
  const out = {
    uid,
    email: user.email || null,
    displayName: user.displayName || null,
    createdAt: user.metadata && user.metadata.creationTime || null,
    lastSignIn: user.metadata && user.metadata.lastSignInTime || null,
    main: null,
    backupLatest: null,
    latestServerBackup: null,
    serverBackupCount: 0,
    anomaly: false,
    anomalyReason: null
  };

  try {
    const mainSnap = await db.collection('users').doc(uid).collection('state').doc('main').get();
    if (mainSnap.exists) {
      out.main = { exists: true, counts: countsOf(mainSnap.data()), updatedAt: (mainSnap.data() || {}).updatedAt || null };
    } else {
      out.main = { exists: false };
    }
  } catch (e) { out.main = { error: e.message }; }

  try {
    const bSnap = await db.collection('users').doc(uid).collection('state').doc('backup_latest').get();
    if (bSnap.exists) {
      const data = bSnap.data();
      out.backupLatest = {
        exists: true,
        counts: countsOf(data),
        ts: (data._backupMeta && data._backupMeta.ts) || null
      };
    } else {
      out.backupLatest = { exists: false };
    }
  } catch (_) {}

  try {
    const srv = await db.collection('userBackups').doc(uid).collection('snapshots').get();
    out.serverBackupCount = srv.size;
    let latestDay = null;
    let latestTs = null;
    srv.forEach(doc => {
      if (!latestDay || doc.id > latestDay) latestDay = doc.id;
      const d = doc.data();
      const t = d._serverBackupMeta && d._serverBackupMeta.ts;
      if (t && (!latestTs || t > latestTs)) latestTs = t;
    });
    out.latestServerBackup = { day: latestDay, ts: latestTs };
  } catch (_) {}

  // Detect anomaly: main is empty but a backup has data
  const mainEmpty = !out.main || !out.main.counts || out.main.counts.total === 0;
  const backupHasData = (out.backupLatest && out.backupLatest.counts && out.backupLatest.counts.total > 0)
    || (out.serverBackupCount > 0);
  if (mainEmpty && backupHasData) {
    out.anomaly = true;
    out.anomalyReason = 'main-empty-but-backup-has-data';
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) { return json(401, { error: 'unauthorized: ' + e.message }); }

    const db = getFirestore();
    if (!(await isAdminUser(decoded, db))) {
      return json(403, { error: 'forbidden: admin only' });
    }

    const admin = getFirebaseAdmin();
    const allUsers = [];
    let pageToken;
    do {
      const r = await admin.auth().listUsers(1000, pageToken);
      r.users.forEach(u => allUsers.push(u));
      pageToken = r.pageToken;
    } while (pageToken);

    // Process in batches of 20 in parallel to respect Netlify timeout
    const reports = [];
    for (let i = 0; i < allUsers.length; i += 20) {
      const batch = allUsers.slice(i, i + 20);
      const r = await Promise.all(batch.map(u => processUser(db, u)));
      reports.push(...r);
    }

    // Aggregate summary
    const summary = {
      totalUsers: reports.length,
      withMainData: 0,
      emptyMain: 0,
      noMainDoc: 0,
      withClientBackup: 0,
      withServerBackup: 0,
      anomalies: 0,
      staleServerBackup: 0   // server backup older than 36h
    };
    const STALE_MS = 36 * 60 * 60 * 1000;
    const now = Date.now();
    reports.forEach(r => {
      if (!r.main || r.main.error) return;
      if (!r.main.exists) summary.noMainDoc++;
      else if (r.main.counts && r.main.counts.total > 0) summary.withMainData++;
      else summary.emptyMain++;
      if (r.backupLatest && r.backupLatest.exists) summary.withClientBackup++;
      if (r.serverBackupCount > 0) summary.withServerBackup++;
      if (r.anomaly) summary.anomalies++;
      if (r.latestServerBackup && r.latestServerBackup.ts) {
        if (now - r.latestServerBackup.ts > STALE_MS) summary.staleServerBackup++;
      } else if (r.main && r.main.exists && r.main.counts && r.main.counts.total > 0) {
        summary.staleServerBackup++;
      }
    });

    // Fetch recent admin alerts (last 100, newest first)
    var recentAlerts = [];
    try {
      const alertsSnap = await db.collection('adminAlerts').orderBy('ts', 'desc').limit(100).get();
      alertsSnap.forEach(d => {
        const a = d.data() || {};
        recentAlerts.push({
          id: d.id,
          uid: a.uid,
          email: a.email,
          type: a.type,
          source: a.source,
          ts: a.ts,
          before: a.before,
          after: a.after,
          details: a.details,
          resolved: !!a.resolved
        });
      });
      summary.alertsTotal = recentAlerts.length;
      summary.alertsUnresolved = recentAlerts.filter(a => !a.resolved).length;
      summary.alertsLast24h = recentAlerts.filter(a => a.ts && (Date.now() - a.ts) < 24 * 60 * 60 * 1000).length;
    } catch (e) {
      summary.alertsError = e.message;
    }

    return json(200, {
      generatedAt: new Date().toISOString(),
      summary,
      users: reports,
      alerts: recentAlerts
    });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
