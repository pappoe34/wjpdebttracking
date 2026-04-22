// POST /.netlify/functions/fire-sandbox-webhook
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    { itemId: '...', webhook_code?: 'SYNC_UPDATES_AVAILABLE' }
// Returns: { ok: true, fired: { itemId, webhook_code } }
//
// Test-only endpoint: tells Plaid's sandbox to fire a webhook event for the
// given Item so we can prove the round trip (Plaid -> plaid-webhook -> Firestore).
// Safe to keep in sandbox; remove (or gate) before cutting over to production.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient, getPlaidEnv } = require('./_shared/plaid');

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

  // Hard gate: this endpoint hits Plaid's /sandbox/* API and is meaningless
  // (and unsafe to expose) outside sandbox. Fail closed in dev/production.
  if (getPlaidEnv() !== 'sandbox') {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'sandbox-only endpoint disabled in PLAID_ENV=' + getPlaidEnv() }) };
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

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const itemId = body.itemId;
    const webhookCode = body.webhook_code || 'SYNC_UPDATES_AVAILABLE';
    if (!itemId) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'missing itemId' }) };
    }

    const db = getFirestore();
    const itemDoc = await db.collection('users').doc(uid).collection('plaid_items').doc(itemId).get();
    if (!itemDoc.exists) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'item not found for user' }) };
    }
    const data = itemDoc.data() || {};
    const accessToken = data.access_token || data.accessToken;
    if (!accessToken) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'item missing access_token' }) };
    }

    const plaid = getPlaidClient();
    try {
      await plaid.sandboxItemFireWebhook({
        access_token: accessToken,
        webhook_code: webhookCode
      });
    } catch (e) {
      const msg = (e && e.response && e.response.data && (e.response.data.error_message || e.response.data.error_code)) || e.message || 'unknown';
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'plaid fire_webhook failed: ' + msg }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, fired: { itemId, webhook_code: webhookCode } }) };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('fire-sandbox-webhook error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
