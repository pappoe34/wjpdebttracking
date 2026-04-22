// POST /.netlify/functions/sandbox-link-test
// Headers: Authorization: Bearer <Firebase ID token>
// One-shot end-to-end test: generates a sandbox public_token, exchanges it,
// writes to Firestore, and returns success or detailed error.
// REMOVE THIS FILE after Plaid integration is verified working.
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

  const trace = [];
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try {
      decoded = await verifyIdToken(authHeader);
      trace.push('verified ID token, uid=' + decoded.uid);
    } catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message, trace }) };
    }
    const uid = decoded.uid;

    const plaid = getPlaidClient();
    trace.push('plaid client ok');

    // 1. Generate sandbox public_token directly (skips Plaid Link UI)
    const spt = await plaid.sandboxPublicTokenCreate({
      institution_id: 'ins_109508', // First Platypus Bank
      initial_products: ['transactions']
    });
    const public_token = spt.data.public_token;
    trace.push('generated public_token');

    // 2. Exchange for access_token
    const ex = await plaid.itemPublicTokenExchange({ public_token });
    const access_token = ex.data.access_token;
    const item_id = ex.data.item_id;
    trace.push('exchanged for access_token, item_id=' + item_id);

    // 3. Pull accounts so we have something to display
    const acctRes = await plaid.accountsGet({ access_token });
    const accounts = acctRes.data.accounts.map(a => ({
      account_id: a.account_id,
      name: a.name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balances: {
        current: a.balances.current,
        available: a.balances.available,
        limit: a.balances.limit
      }
    }));
    trace.push('fetched ' + accounts.length + ' accounts');

    // 4. Write to Firestore (the failing step previously)
    const admin = getFirebaseAdmin();
    const db = getFirestore();
    await db
      .collection('users').doc(uid)
      .collection('plaid_items').doc(item_id)
      .set({
        access_token,
        institutionName: 'First Platypus Bank (sandbox-test)',
        accounts,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    trace.push('Firestore write OK');

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success: true,
        item_id,
        accountCount: accounts.length,
        accounts: accounts.map(a => ({ name: a.name, mask: a.mask, balance: a.balances.current })),
        trace
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    const data = err && err.response && err.response.data;
    console.error('sandbox-link-test error:', msg, data);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg, plaidError: data, trace })
    };
  }
};
