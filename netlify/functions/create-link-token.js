// POST /.netlify/functions/create-link-token
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { link_token }
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

    // Optional UPDATE MODE: client passes { itemId } when re-authing a broken item
    // (e.g. ITEM_LOGIN_REQUIRED). For update mode, Plaid wants `access_token` and
    // NO `products` field on the link token request.
    let updateAccessToken = null;
    try {
      const body = JSON.parse(event.body || '{}');
      if (body && body.itemId) {
        const db = getFirestore();
        const snap = await db
          .collection('users').doc(uid)
          .collection('plaid_items').doc(String(body.itemId)).get();
        if (!snap.exists) {
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'item not found' }) };
        }
        const d = snap.data() || {};
        updateAccessToken = d.access_token || d.accessToken || null;
        if (!updateAccessToken) {
          return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'item missing access_token' }) };
        }
      }
    } catch (_) { /* fall through to normal mode if body parse fails */ }

    const plaid = getPlaidClient();
    // Wire the webhook URL onto the link token so Plaid pushes us
    // TRANSACTIONS:SYNC_UPDATES_AVAILABLE notifications. Netlify exposes the
    // deployed site URL via process.env.URL; allow override for local/dev or a
    // separate webhook-only domain. If neither is set, leave it off — Plaid
    // is fine without a webhook (we'll just rely on auto-poll).
    const webhookUrl = process.env.PLAID_WEBHOOK_URL ||
      (process.env.URL ? `${process.env.URL}/.netlify/functions/plaid-webhook` : null);

    const linkPayload = {
      user: { client_user_id: uid },
      client_name: 'WJP Debt Tracking',
      country_codes: ['US'],
      language: 'en'
    };
    if (updateAccessToken) {
      // Update mode: re-auth flow. No `products` field allowed.
      linkPayload.access_token = updateAccessToken;
    } else {
      // Normal new-link mode.
      // - `transactions` is REQUIRED (every bank supports it; this is what
      //   powers the spending tracker + auto-payment matching).
      // - `liabilities` is OPTIONAL — banks WITH credit cards/loans expose it
      //   and we get APR + min-payment data. Banks WITHOUT (pure checking/
      //   savings like some online banks) are still allowed to link instead
      //   of being rejected with "No liability accounts".
      // P18: Tier-aware Plaid products.
      // - Free + Pro: transactions only (saves Liabilities subscription cost).
      //   Users add APR/balance via Statement OCR upload.
      // - Pro Plus: includes liabilities for real-time APR + min payment.
      let userTier = 'free';
      try {
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
          const u = userDoc.data() || {};
          userTier = (u.tier || u.subscriptionTier || 'free').toLowerCase();
        }
      } catch (e) { /* default to free */ }
      console.log('[create-link-token] uid=%s tier=%s', uid, userTier);

      linkPayload.products = ['transactions'];
      // Only Pro Plus gets Plaid Liabilities (paid product).
      if (userTier === 'plus' || userTier === 'pro_plus' || userTier === 'proplus') {
        linkPayload.optional_products = ['liabilities'];
      }
    }
    if (webhookUrl) linkPayload.webhook = webhookUrl;

    const resp = await plaid.linkTokenCreate(linkPayload);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ link_token: resp.data.link_token })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('create-link-token error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
