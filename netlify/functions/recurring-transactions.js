// POST /.netlify/functions/recurring-transactions
// Headers: Authorization: Bearer <Firebase ID token>
// Body:    {}
// Returns: {
//   items: [{
//     itemId, institutionName,
//     accounts: [{ account_id, mask, name, subtype, type }],   // returned so the frontend can map streams → debt without a second roundtrip
//     outflow_streams: [{ stream_id, account_id, description, merchant_name, average_amount, last_amount, frequency, status, category, ... }],
//     inflow_streams:  [...]                                    // included for completeness; unused by autopay tagging today
//   }]
// }
//
// Why this lives separately from sync-transactions: recurring detection is a different
// Plaid endpoint (transactionsRecurringGet) and we don't want to slow down the hot
// payment-matching path. We also don't expect to call this on every poll — once an
// hour at most.

const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function shapeStream(s) {
  return {
    stream_id: s.stream_id,
    account_id: s.account_id,
    description: s.description || '',
    merchant_name: s.merchant_name || null,
    category: Array.isArray(s.category) ? s.category : [],
    first_date: s.first_date || null,
    last_date: s.last_date || null,
    frequency: s.frequency || null,
    status: s.status || null,
    average_amount: s.average_amount && typeof s.average_amount.amount === 'number' ? s.average_amount.amount : null,
    last_amount: s.last_amount && typeof s.last_amount.amount === 'number' ? s.last_amount.amount : null,
    is_active: s.is_active !== false,
    is_user_modified: !!s.is_user_modified
  };
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

    const db = getFirestore();
    const itemsRef = db.collection('users').doc(uid).collection('plaid_items');
    const snap = await itemsRef.get();
    const plaid = getPlaidClient();

    const out = [];

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      if (!access_token) continue;
      const institutionName = data.institutionName || null;

      let inflow = [], outflow = [], accounts = [];
      try {
        // Pull lightweight account info so the frontend can match streams to debts via mask.
        const acctResp = await plaid.accountsGet({ access_token });
        accounts = ((acctResp.data && acctResp.data.accounts) || []).map(a => ({
          account_id: a.account_id,
          mask: a.mask || null,
          name: a.name || null,
          official_name: a.official_name || null,
          subtype: a.subtype || null,
          type: a.type || null
        }));
      } catch (e) {
        console.warn('accountsGet failed for item', doc.id, e.message);
      }

      try {
        const resp = await plaid.transactionsRecurringGet({ access_token });
        const d = resp.data || {};
        outflow = (d.outflow_streams || []).map(shapeStream);
        inflow  = (d.inflow_streams  || []).map(shapeStream);
      } catch (e) {
        // PRODUCT_NOT_READY is normal for newly linked items. Return what we have.
        const code = e && e.response && e.response.data && e.response.data.error_code;
        console.error('transactionsRecurringGet failed for item', doc.id, code || e.message);
      }

      out.push({
        itemId: doc.id,
        institutionName,
        accounts,
        outflow_streams: outflow,
        inflow_streams: inflow
      });
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        items: out,
        // Hint: don't poll faster than this. Recurring streams change slowly.
        nextSyncRecommendedSeconds: 3600
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('recurring-transactions error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
