// POST /.netlify/functions/exchange-public-token
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { public_token, institutionName, accounts }
// Returns: { itemId, success }
// NEVER returns access_token to the browser.
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

    const admin = getFirebaseAdmin();
    const db = getFirestore();
    await db
      .collection('users').doc(uid)
      .collection('plaid_items').doc(item_id)
      .set({
        access_token,
        institutionName: institutionName || null,
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
