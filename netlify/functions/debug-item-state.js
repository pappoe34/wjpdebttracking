// POST /.netlify/functions/debug-item-state
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    { itemId: '...' }
// Returns: { firestore: {...}, plaid: {...} }
//
// Diagnostic only. Returns the plaid_items Firestore doc + the result of
// Plaid /item/get (so we can confirm whether the webhook URL is actually
// attached on Plaid's side, and whether plaid-webhook ever wrote lastWebhookAt).

const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function safeData(d) {
  if (!d) return null;
  // Strip the access token; never return it to the browser.
  const out = {};
  for (const k of Object.keys(d)) {
    if (k === 'access_token' || k === 'accessToken') continue;
    const v = d[k];
    if (v && typeof v === 'object' && typeof v.toDate === 'function') {
      try { out[k] = v.toDate().toISOString(); continue; } catch (_) {}
    }
    out[k] = v;
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) }; }
    const uid = decoded.uid;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const itemId = body.itemId;
    if (!itemId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing itemId' }) };

    const db = getFirestore();
    const itemDoc = await db.collection('users').doc(uid).collection('plaid_items').doc(itemId).get();
    if (!itemDoc.exists) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'item not found' }) };
    const data = itemDoc.data() || {};
    const accessToken = data.access_token || data.accessToken;

    let plaidItem = null;
    let plaidErr = null;
    if (accessToken) {
      try {
        const r = await getPlaidClient().itemGet({ access_token: accessToken });
        plaidItem = r && r.data && r.data.item ? r.data.item : null;
      } catch (e) {
        plaidErr = (e && e.response && e.response.data && (e.response.data.error_message || e.response.data.error_code)) || e.message;
      }
    } else {
      plaidErr = 'no access_token on doc';
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        firestore: safeData(data),
        plaid: { item: plaidItem, error: plaidErr }
      }, null, 2)
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('debug-item-state error:', msg);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
