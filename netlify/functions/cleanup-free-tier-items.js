// Netlify scheduled function — runs daily.
// Finds users where tier === 'free' AND gracePeriodEndsAt < now,
// and removes their Plaid items (stops Plaid billing).
//
// Trigger: configured in netlify.toml with cron "0 2 * * *" (02:00 UTC daily).
//
// Path: POST /.netlify/functions/cleanup-free-tier-items (also callable
// manually with header `x-admin-secret` matching ADMIN_CRON_SECRET env).
//
// Cost protection: Plaid Liabilities/Transactions/Investments stop billing
// the moment /item/remove succeeds. We persist removal in Firestore so
// the user keeps their historical data if they later upgrade.

const { getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
  'Content-Type': 'application/json'
};
const json = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // Manual / admin access requires secret header. Scheduled runs from Netlify
  // come without auth — we accept the run only if the event source is the
  // scheduler (we can't fully verify; treat sched as trusted).
  const isManual = event.httpMethod === 'POST';
  if (isManual) {
    const secret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
    const expected = process.env.ADMIN_CRON_SECRET;
    if (expected && secret !== expected) {
      return json(403, { error: 'forbidden' });
    }
  }

  const db = getFirestore();
  const plaid = getPlaidClient();
  const now = Date.now();

  // Scan users whose subscription doc has gracePeriodEndsAt in the past
  // AND tier === 'free' (i.e., trial expired or downgraded and grace ran out).
  const billingSnap = await db.collectionGroup('billing').get();
  const cleaned = [];
  const skipped = [];
  const errors = [];

  for (const docSnap of billingSnap.docs) {
    if (docSnap.id !== 'subscription') continue;
    const data = docSnap.data() || {};
    const tier = String(data.tier || 'free').toLowerCase();
    const graceEnd = data.gracePeriodEndsAt;
    if (tier !== 'free') continue;
    if (!graceEnd || graceEnd > now) continue;

    // Already cleaned previously?
    if (data.itemsClearedAt && data.itemsClearedAt > (data.lastDowngradeAt || 0)) {
      skipped.push({ uid: docSnap.ref.parent.parent.id, reason: 'already_cleared' });
      continue;
    }

    const uid = docSnap.ref.parent.parent.id;
    const itemsSnap = await db.collection('users').doc(uid).collection('plaid_items').get();
    let removed = 0;
    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data() || {};
      const accessToken = item.access_token || item.accessToken;
      if (!accessToken) continue;
      try {
        await plaid.itemRemove({ access_token: accessToken });
        await itemDoc.ref.set({
          removed: true,
          removedAt: now,
          removalReason: 'free_tier_grace_expired'
        }, { merge: true });
        removed++;
      } catch (e) {
        errors.push({ uid, itemId: itemDoc.id, error: e.message });
      }
    }

    await docSnap.ref.set({ itemsClearedAt: now }, { merge: true });

    // Queue notification email (existing email-cron pipeline will pick this up)
    try {
      await db.collection('users').doc(uid).collection('email_sequence')
        .doc('items_removed_after_grace').set({
          queuedAt: now,
          itemsRemoved: removed
        }, { merge: true });
    } catch (_) {}

    cleaned.push({ uid, itemsRemoved: removed });
  }

  return json(200, {
    ok: true,
    ranAt: now,
    cleaned: cleaned.length,
    cleanedDetail: cleaned.slice(0, 20),
    skipped: skipped.length,
    errors
  });
};

// Netlify Scheduled Functions config (registered via netlify.toml or
// via this exported `config` per Netlify v2 schedule API).
exports.config = { schedule: '0 2 * * *' };
