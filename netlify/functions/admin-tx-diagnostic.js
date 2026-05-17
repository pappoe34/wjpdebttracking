// POST /.netlify/functions/admin-tx-diagnostic
// Headers: Authorization: Bearer <Firebase ID token>  (must be an admin email)
// Body:    {} OR { uid: "<override>" }  (admin can probe other users)
// Returns: comprehensive per-item + transaction-count diagnostics so we can
//          spot stuck cursors, stale syncs, errored items, and date-bucketed
//          transaction counts in one call.
//
// Why this exists: the 05/12-05/17 missing-tx bug took manual code-reading to
// find. With this endpoint we hit "Run Diagnostic" and instantly see:
//   - which items have errors
//   - when each item was last synced
//   - how many transactions exist in Firestore per date bucket
//   - whether the latest tx date is recent
//
// Read-only; no Plaid API calls; just reads Firestore. Admin-only.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const ADMIN_EMAILS = ['pappoe34@gmail.com'];

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  let decoded;
  try {
    decoded = await verifyIdToken(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
  }
  if (!decoded.email || ADMIN_EMAILS.indexOf(String(decoded.email).toLowerCase()) === -1) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'admin only' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const targetUid = body.uid || decoded.uid;

  const db = getFirestore();
  const out = {
    uid: targetUid,
    runAt: new Date().toISOString(),
    items: [],
    transactionStats: {},
    summary: {}
  };

  // 1) plaid_items snapshot — cursor, lastSync, errors, webhook flags
  const itemsSnap = await db.collection('users').doc(targetUid).collection('plaid_items').get();
  for (const doc of itemsSnap.docs) {
    const d = doc.data() || {};
    const cursorPrefix = d.transactions_cursor ? String(d.transactions_cursor).slice(0, 24) + '…' : '(empty)';
    out.items.push({
      itemId: doc.id,
      institutionName: d.institutionName || null,
      institutionId: d.institutionId || null,
      hasAccessToken: !!d.access_token,
      cursorPreview: cursorPrefix,
      lastTxSyncAt: d.last_tx_sync_at ? d.last_tx_sync_at.toMillis ? new Date(d.last_tx_sync_at.toMillis()).toISOString() : String(d.last_tx_sync_at) : null,
      lastWebhookType: d.lastWebhookType || null,
      lastWebhookCode: d.lastWebhookCode || null,
      lastWebhookAt: d.lastWebhookAt ? d.lastWebhookAt.toMillis ? new Date(d.lastWebhookAt.toMillis()).toISOString() : String(d.lastWebhookAt) : null,
      txPendingSync: !!d.txPendingSync,
      itemError: d.itemError || null,
      itemErrorMessage: d.itemErrorMessage || null,
      removed: !!d.removed
    });
  }

  // 2) transaction count + date buckets from users/{uid}/transactions
  const txSnap = await db.collection('users').doc(targetUid).collection('transactions').get();
  const buckets = {
    last7Days:  0,
    last30Days: 0,
    last90Days: 0,
    total: txSnap.size
  };
  const last7Cutoff  = isoDaysAgo(7);
  const last30Cutoff = isoDaysAgo(30);
  const last90Cutoff = isoDaysAgo(90);
  let latestDate = null;
  const byItemId = {};
  // Date histogram for the last 30 days
  const histogram = {};
  for (let d = 0; d <= 14; d++) {
    histogram[isoDaysAgo(d)] = 0;
  }
  txSnap.forEach(doc => {
    const t = doc.data() || {};
    const date = t.date || t.authorized_date;
    if (!date) return;
    if (date > last7Cutoff)  buckets.last7Days++;
    if (date > last30Cutoff) buckets.last30Days++;
    if (date > last90Cutoff) buckets.last90Days++;
    if (!latestDate || date > latestDate) latestDate = date;
    const iid = t.itemId || 'unknown';
    byItemId[iid] = (byItemId[iid] || 0) + 1;
    if (histogram[date] != null) histogram[date]++;
  });
  buckets.latestTxDate = latestDate;
  buckets.byItemId = byItemId;
  buckets.last14DayHistogram = histogram;

  out.transactionStats = buckets;

  // 3) Summary diagnosis
  const today = new Date().toISOString().slice(0, 10);
  const issues = [];
  out.items.forEach(it => {
    if (it.itemError) issues.push(`Item ${it.itemId} (${it.institutionName || 'unknown'}) has error: ${it.itemError}`);
    if (it.txPendingSync) issues.push(`Item ${it.itemId} (${it.institutionName || 'unknown'}) has txPendingSync flag still set — webhook fired but sync didn't run or didn't clear flag`);
    if (it.lastTxSyncAt) {
      const ageDays = Math.floor((Date.now() - new Date(it.lastTxSyncAt).getTime()) / 86400000);
      if (ageDays > 3) issues.push(`Item ${it.itemId} (${it.institutionName || 'unknown'}) hasn't been synced in ${ageDays} days`);
    } else {
      issues.push(`Item ${it.itemId} (${it.institutionName || 'unknown'}) has never been synced`);
    }
  });
  if (latestDate && latestDate < isoDaysAgo(3)) {
    issues.push(`Latest tx in Firestore is from ${latestDate} (today is ${today}) — frontend will look stale`);
  }
  out.summary = {
    today,
    totalItems: out.items.length,
    totalTransactions: txSnap.size,
    latestTxDate: latestDate,
    daysSinceLatestTx: latestDate ? Math.floor((Date.now() - new Date(latestDate).getTime()) / 86400000) : null,
    issues,
    healthy: issues.length === 0
  };

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(out, null, 2)
  };
};
