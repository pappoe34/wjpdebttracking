// POST /.netlify/functions/update-item-webhooks
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    {} (optional: { itemId: '...' } to scope to a single item)
// Returns: { updated: [{itemId, ok}], errors: [{itemId, message}], webhookUrl }
//
// One-shot maintenance endpoint. Walks the user's plaid_items collection and
// calls Plaid's /item/webhook/update for each, attaching the current
// PLAID_WEBHOOK_URL. Lets us back-fill the webhook URL on Items that were
// created before the webhook param was wired into create-link-token.js,
// without forcing a re-link (which would wipe sandbox state and access tokens).
//
// Safe to call repeatedly — Plaid treats /item/webhook/update as idempotent.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function resolveWebhookUrl() {
  // Prefer explicit env var; fall back to the site URL Netlify exposes.
  const explicit = process.env.PLAID_WEBHOOK_URL;
  if (explicit) return explicit;
  const site = process.env.URL || process.env.DEPLOY_URL;
  if (site) return site.replace(/\/$/, '') + '/.netlify/functions/plaid-webhook';
  return null;
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

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    const scopedItemId = body.itemId || null;

    const webhookUrl = resolveWebhookUrl();
    if (!webhookUrl) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'no PLAID_WEBHOOK_URL configured (set env var or rely on URL fallback)' }) };
    }

    const db = getFirestore();
    const itemsRef = db.collection('users').doc(uid).collection('plaid_items');
    const snap = scopedItemId
      ? await itemsRef.where('__name__', '==', scopedItemId).get()
      : await itemsRef.get();

    if (snap.empty) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ updated: [], errors: [], webhookUrl, note: 'no plaid_items found for user' }) };
    }

    const plaid = getPlaidClient();
    const updated = [];
    const errors = [];

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      // exchange-public-token.js writes the field as `access_token` (snake_case).
      // Accept camelCase too for forward-compat.
      const accessToken = data.access_token || data.accessToken;
      if (!accessToken) {
        errors.push({ itemId: doc.id, message: 'missing access_token on plaid_items doc' });
        continue;
      }
      try {
        await plaid.itemWebhookUpdate({
          access_token: accessToken,
          webhook: webhookUrl
        });
        // Mirror the configured URL onto the doc so we can audit later without
        // round-tripping to Plaid.
        await doc.ref.set({ webhookUrl, webhookUrlUpdatedAt: new Date().toISOString() }, { merge: true });
        // Backfill plaid_item_owners mapping. Items linked before this mapping
        // existed have webhooks arriving with no way to resolve the user.
        try {
          await db.collection('plaid_item_owners').doc(doc.id).set({
            uid,
            backfilledAt: new Date().toISOString()
          }, { merge: true });
        } catch (mapErr) {
          // Non-fatal — webhook URL update still succeeded.
          console.warn('plaid_item_owners backfill failed', doc.id, mapErr.message);
        }
        updated.push({ itemId: doc.id, ok: true });
      } catch (e) {
        const msg = (e && e.response && e.response.data && (e.response.data.error_message || e.response.data.error_code)) || e.message || 'unknown';
        errors.push({ itemId: doc.id, message: String(msg) });
      }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ updated, errors, webhookUrl }) };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('update-item-webhooks error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
