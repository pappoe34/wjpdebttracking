// POST /.netlify/functions/sync-transactions
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    {}  (no params; cursor is stored server-side per item)
// Returns: {
//   items: [{
//     itemId, institutionName,
//     added:    [{ transaction_id, account_id, date, amount, name, ... }],
//     modified: [...],
//     removed:  [{ transaction_id, account_id }],
//   }],
//   nextSyncRecommendedSeconds: number   // hint for the frontend
// }
//
// Why cursor-based: transactionsSync is idempotent — calling it twice returns
// nothing the second time. Frontend can replay payment-matching without
// double-decrementing balances. Compare to transactionsGet which returns the
// same 30-day window every call.
//
// Schema add: writes `transactions_cursor` (string) onto each plaid_items doc.
// Additive; legacy docs without this field default to "" (= full history fetch
// on first call).

const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// Plaid limits transactionsSync to 500 per page; we paginate via has_more.
// Cap total iterations per item per request to avoid runaway loops on a brand-new
// item with years of history (rare in Sandbox, possible in Production).
const MAX_PAGES_PER_ITEM = 10;

function shapeTx(t) {
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    date: t.date || t.authorized_date || null,
    amount: t.amount,                 // Plaid sign convention preserved (see frontend matcher)
    iso_currency_code: t.iso_currency_code || 'USD',
    name: t.name || t.merchant_name || '',
    merchant_name: t.merchant_name || null,
    category: Array.isArray(t.category) ? t.category : (t.category ? [t.category] : []),
    pending: !!t.pending,
    payment_channel: t.payment_channel || null
  };
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

    const db = getFirestore();
    const itemsRef = db.collection('users').doc(uid).collection('plaid_items');
    const snap = await itemsRef.get();
    const plaid = getPlaidClient();

    const out = [];

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      if (!access_token) continue;
      const institutionName = data.institutionName || null;
      let cursor = data.transactions_cursor || '';

      const added = [];
      const modified = [];
      const removed = [];

      try {
        let pages = 0;
        let hasMore = true;
        while (hasMore && pages < MAX_PAGES_PER_ITEM) {
          // Plaid expects no `cursor` field at all on the very first call (or empty string).
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

        // Persist the cursor so the next call only returns NEW txs.
        await doc.ref.set({ transactions_cursor: cursor }, { merge: true });

      } catch (e) {
        const code = e && e.response && e.response.data && e.response.data.error_code;
        // PRODUCT_NOT_READY is normal for newly linked items — Plaid is still backfilling.
        // Return whatever we have; frontend will retry on next poll.
        console.error('transactionsSync failed for item', doc.id, code || e.message);
      }

      out.push({
        itemId: doc.id,
        institutionName,
        added,
        modified,
        removed
      });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        items: out,
        // Hint: frontend should poll at most every 5 minutes. Real-time will come
        // via webhooks once we wire those up (task #26).
        nextSyncRecommendedSeconds: 300
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('sync-transactions error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
