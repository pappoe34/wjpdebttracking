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
      try {
        const bal = await plaid.accountsBalanceGet({ access_token });
        accounts = bal.data.accounts || [];
      } catch (e) {
        console.error('accountsBalanceGet failed for item', itemId, (e && e.response && e.response.data) || e.message);
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

      items.push({
        itemId,
        institutionName: data.institutionName || null,
        accounts,
        liabilities
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
