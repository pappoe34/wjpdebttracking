// POST /.netlify/functions/sync-transactions
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    {} OR { forceFullResync: true }
// Returns: {
//   items: [{
//     itemId, institutionName,
//     added:    [{ transaction_id, account_id, date, amount, name, ... }],
//     modified: [...],
//     removed:  [{ transaction_id, account_id }],
//     persisted: number,           // v2: count written to Firestore
//   }],
//   nextSyncRecommendedSeconds: number   // hint for the frontend
// }
//
// v2 (2026-05-16):
//   - PERSISTS transactions to Firestore subcollection:
//     `users/{uid}/transactions/{transaction_id}` — keyed by transaction_id so
//     re-syncs upsert idempotently (no duplicates ever; missing data fills in).
//   - Accepts `{ forceFullResync: true }` to clear cursor + re-pull full history.
//   - Response shape unchanged for backward compatibility.

const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// Plaid limits transactionsSync to 500 per page; we paginate via has_more.
// Cap iterations per item per request — allow more on a full resync since the
// caller is explicitly asking for the whole history.
const MAX_PAGES_PER_ITEM = 10;
const MAX_PAGES_PER_ITEM_FULL = 60; // 60 pages × 500 = up to 30,000 tx per item (≥ Plaid's 24mo default)

// Firestore batch limit is 500 writes per commit.
const FIRESTORE_BATCH_SIZE = 400; // leave headroom

function shapeTx(t) {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    date: t.date || t.authorized_date || null,
    authorized_date: t.authorized_date || null,
    amount: t.amount,                 // Plaid sign convention preserved (see frontend matcher)
    iso_currency_code: t.iso_currency_code || 'USD',
    name: t.name || t.merchant_name || '',
    merchant_name: t.merchant_name || null,
    category: Array.isArray(t.category) ? t.category : (t.category ? [t.category] : []),
    pending: !!t.pending,
    payment_channel: t.payment_channel || null
  };
}

async function persistTransactions(db, admin, uid, itemId, added, modified, removed) {
  const col = db.collection('users').doc(uid).collection('transactions');
  let written = 0;
  let deleted = 0;

  // Helper: commit a slice as one batch
  async function commitBatch(slice, opMode) {
    if (!slice.length) return;
    const batch = db.batch();
    for (const t of slice) {
      if (!t.transaction_id) continue;
      const ref = col.doc(t.transaction_id);
      if (opMode === 'delete') {
        batch.delete(ref);
      } else {
        // merge:true makes this an idempotent upsert keyed by transaction_id.
        // Same tx coming through twice (via webhook + manual sync) updates in
        // place — never creates a duplicate row.
        batch.set(ref, {
          ...t,
          itemId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
    await batch.commit();
    if (opMode === 'delete') deleted += slice.length;
    else written += slice.length;
  }

  // Chunk added + modified into batches of FIRESTORE_BATCH_SIZE
  const upserts = [...added, ...modified];
  for (let i = 0; i < upserts.length; i += FIRESTORE_BATCH_SIZE) {
    await commitBatch(upserts.slice(i, i + FIRESTORE_BATCH_SIZE), 'upsert');
  }
  for (let i = 0; i < removed.length; i += FIRESTORE_BATCH_SIZE) {
    await commitBatch(removed.slice(i, i + FIRESTORE_BATCH_SIZE), 'delete');
  }

  return { written, deleted };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try {
      decoded = await verifyIdToken(authHeader);
    } catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const uid = decoded.uid;

    // Optional body param: forceFullResync clears the stored cursor so Plaid
    // returns the full ~24-month history again. Frontend can trigger this when
    // localStorage was cleared, or admin can run it once after a Production
    // migration.
    let forceFullResync = false;
    try {
      if (event.body) {
        const body = JSON.parse(event.body);
        forceFullResync = !!body.forceFullResync;
      }
    } catch (_) {}

    const db = getFirestore();
    const admin = getFirebaseAdmin();
    const itemsRef = db.collection('users').doc(uid).collection('plaid_items');
    const snap = await itemsRef.get();
    const plaid = getPlaidClient();
    const pageCap = forceFullResync ? MAX_PAGES_PER_ITEM_FULL : MAX_PAGES_PER_ITEM;

    const out = [];

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      if (!access_token) continue;
      const institutionName = data.institutionName || null;
      // forceFullResync: ignore stored cursor → full history pull
      let cursor = forceFullResync ? '' : (data.transactions_cursor || '');

      const added = [];
      const modified = [];
      const removed = [];
      let persistResult = { written: 0, deleted: 0 };
      let itemError = null;

      try {
        let pages = 0;
        let hasMore = true;
        while (hasMore && pages < pageCap) {
          const req = { access_token };
          if (cursor) req.cursor = cursor;
          const resp = await plaid.transactionsSync(req);
          const d = resp.data || {};
          (d.added || []).forEach(t => added.push(shapeTx(t)));
          (d.modified || []).forEach(t => modified.push(shapeTx(t)));
          (d.removed || []).forEach(t => removed.push({
            transaction_id: t.transaction_id,
            account_id: t.account_id || null
          }));
          cursor = d.next_cursor || cursor;
          hasMore = !!d.has_more;
          pages++;
        }

        // Persist all changes to Firestore — idempotent by transaction_id.
        if (added.length || modified.length || removed.length) {
          persistResult = await persistTransactions(db, admin, uid, doc.id, added, modified, removed);
        }

        // Persist the cursor so the next call only returns NEW txs.
        await doc.ref.set({
          transactions_cursor: cursor,
          last_tx_sync_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      } catch (e) {
        itemError = (e && e.response && e.response.data && e.response.data.error_code) || (e && e.message) || 'unknown';
        // PRODUCT_NOT_READY is normal for newly linked items — Plaid is still backfilling.
        // ITEM_LOGIN_REQUIRED means the bank needs re-auth via Plaid Link update mode.
        // INVALID_ACCESS_TOKEN happens if the item was issued in a different Plaid env.
        console.error('transactionsSync failed for item', doc.id, itemError);
        // Persist the error onto the item doc so the frontend can flag a Reconnect CTA
        try {
          await doc.ref.set({
            itemError: itemError,
            itemErrorAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (_) {}
      }

      out.push({
        itemId: doc.id,
        institutionName,
        added,
        modified,
        removed,
        persisted: persistResult.written,
        deleted_persisted: persistResult.deleted,
        itemError
      });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        items: out,
        forceFullResync: forceFullResync,
        nextSyncRecommendedSeconds: 300
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('sync-transactions error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
