// GET /.netlify/functions/get-accounts
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { items: [{ itemId, institutionName, accounts, liabilities }] }
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
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
    const snap = await db.collection('users').doc(uid).collection('plaid_items').get();
    const plaid = getPlaidClient();

    const items = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      const itemId = doc.id;
      if (!access_token) continue;

      let accounts = [];
      // Capture per-call Plaid error so the UI can surface a Reconnect CTA when
      // the item needs re-auth (ITEM_LOGIN_REQUIRED, etc.). Webhook-set errors
      // already live in Firestore (data.itemError); this catches sync-time errors too.
      let liveItemError = null;
      let liveItemErrorMessage = null;
      try {
        // accountsGet (not accountsBalanceGet) — included with Transactions
        // and Liabilities products. accountsBalanceGet requires the Balance
        // product which we did not contract for.
        const bal = await plaid.accountsGet({ access_token });
        accounts = bal.data.accounts || [];
      } catch (e) {
        const errData = e && e.response && e.response.data;
        liveItemError = (errData && errData.error_code) || null;
        liveItemErrorMessage = (errData && errData.error_message) || (e && e.message) || null;
        console.error('accountsGet failed for item', itemId, errData || e.message);
      }

      let liabilities = null;
      try {
        const liab = await plaid.liabilitiesGet({ access_token });
        liabilities = liab.data.liabilities || null;
      } catch (e) {
        const code = e && e.response && e.response.data && e.response.data.error_code;
        if (code === 'INVALID_PRODUCT' || code === 'PRODUCTS_NOT_SUPPORTED' || code === 'PRODUCT_NOT_READY') {
          liabilities = null; // not a credit/loan product — fall back to accounts only
        } else {
          console.error('liabilitiesGet failed for item', itemId, (e && e.response && e.response.data) || e.message);
        }
      }

      // Prefer the live error code (right now) over the cached webhook one.
      const itemError = liveItemError || data.itemError || null;
      const itemErrorMessage = liveItemErrorMessage || data.itemErrorMessage || null;

      items.push({
        itemId,
        institutionName: data.institutionName || null,
        accounts,
        liabilities,
        itemError,
        itemErrorMessage
      });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ items })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('get-accounts error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
