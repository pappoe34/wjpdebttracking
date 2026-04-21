// POST /.netlify/functions/unlink-item
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { itemId }
// Returns: { success: true }
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
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
    const { itemId } = body;
    if (!itemId) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing itemId' }) };
    }

    const db = getFirestore();
    const ref = db.collection('users').doc(uid).collection('plaid_items').doc(itemId);
    const doc = await ref.get();
    if (!doc.exists) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'item not found' }) };
    }
    const data = doc.data() || {};
    const access_token = data.access_token;

    const plaid = getPlaidClient();
    if (access_token) {
      try {
        await plaid.itemRemove({ access_token });
      } catch (e) {
        // Log but continue — we still want to clean up Firestore even if Plaid-side removal fails
        // (e.g. already removed, ITEM_NOT_FOUND).
        console.error('plaid itemRemove failed (continuing):', (e && e.response && e.response.data) || e.message);
      }
    }

    await ref.delete();

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('unlink-item error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
