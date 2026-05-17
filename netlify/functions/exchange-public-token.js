// POST /.netlify/functions/exchange-public-token
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { public_token, institutionName, accounts }
// Returns: { itemId, success }
// NEVER returns access_token to the browser.
//
// v2 (2026-05-16): adds server-side duplicate-institution guard.
// After exchanging public_token, we fetch the new item's institution_id and
// compare against existing plaid_items for this user. If a match exists, we
// REMOVE the just-created Plaid item (so it doesn't get billed) and return a
// 409 with a duplicate_institution error code. The frontend can surface this
// to the user without touching the Sync Bank flow.
const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

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

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid JSON body' }) };
    }
    const { public_token, institutionName, accounts } = body;
    if (!public_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing public_token' }) };
    }

    const plaid = getPlaidClient();
    const ex = await plaid.itemPublicTokenExchange({ public_token });
    const access_token = ex.data.access_token;
    const item_id = ex.data.item_id;

    // ---- DUPLICATE INSTITUTION GUARD (v2) ----
    // Fetch the new item's institution_id, then check existing items.
    // If the user already has a connected item from the same institution,
    // ABORT: remove the freshly-created Plaid item (so it doesn't accrue
    // billing) and return a 409 so the frontend can show a clean message.
    let new_institution_id = null;
    try {
      const itemGet = await plaid.itemGet({ access_token });
      new_institution_id = (itemGet.data && itemGet.data.item && itemGet.data.item.institution_id) || null;
    } catch (e) {
      // Log but don't fail — we'll fall through to storage with null institutionId.
      // Without an institution_id we can't dedupe this one, but storing it is
      // still preferable to losing the connection.
      console.warn('itemGet for institution_id failed:', e && e.message);
    }

    const admin = getFirebaseAdmin();
    const db = getFirestore();

    if (new_institution_id) {
      try {
        const dupeSnap = await db
          .collection('users').doc(uid)
          .collection('plaid_items')
          .where('institutionId', '==', new_institution_id)
          .get();
        if (!dupeSnap.empty) {
          // Found an existing connection for this institution. Roll back.
          try {
            await plaid.itemRemove({ access_token });
          } catch (rmErr) {
            // Don't fail the response on cleanup error — log only.
            console.error('cleanup itemRemove failed for duplicate:', (rmErr && rmErr.response && rmErr.response.data) || rmErr.message);
          }
          const existing = dupeSnap.docs.map(d => ({
            itemId: d.id,
            institutionName: (d.data() || {}).institutionName || null
          }));
          return {
            statusCode: 409,
            headers: CORS,
            body: JSON.stringify({
              error: 'duplicate_institution',
              message: 'This bank is already connected. Open Bank Health → Manage Bank Accounts to remove or rename the existing connection before re-linking.',
              institutionId: new_institution_id,
              institutionName: institutionName || (existing[0] && existing[0].institutionName) || null,
              existing
            })
          };
        }
      } catch (dupeErr) {
        // If the dedupe query itself fails, don't block the user — log and proceed.
        console.warn('dedupe query failed (proceeding with store):', dupeErr && dupeErr.message);
      }
    }

    await db
      .collection('users').doc(uid)
      .collection('plaid_items').doc(item_id)
      .set({
        access_token,
        institutionName: institutionName || null,
        institutionId: new_institution_id,           // v2: persist for future dedupe checks
        accounts: Array.isArray(accounts) ? accounts : [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // Top-level item_id → uid mapping. The Plaid webhook only ships item_id,
    // not uid, so we need a way to route the notification to the right user
    // doc without scanning every user. Keeping this in its own collection so
    // security rules can keep it readable only by the webhook (server-only).
    try {
      await db.collection('plaid_item_owners').doc(item_id).set({
        uid,
        institutionName: institutionName || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      // Don't fail the link if the mapping write fails — webhook will fall
      // back to a (slow) scan, and the user's data is still saved.
      console.warn('plaid_item_owners write failed for', item_id, e.message);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ itemId: item_id, success: true })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('exchange-public-token error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
