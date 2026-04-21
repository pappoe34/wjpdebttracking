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
