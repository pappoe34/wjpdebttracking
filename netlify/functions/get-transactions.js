// GET /.netlify/functions/get-transactions?start=YYYY-MM-DD&end=YYYY-MM-DD
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { transactions: [{ id, date, amount, name, category, accountId, institutionName }] }
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

    const qs = event.queryStringParameters || {};
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const start_date = qs.start || toISODate(defaultStart);
    const end_date = qs.end || toISODate(now);

    const db = getFirestore();
    const snap = await db.collection('users').doc(uid).collection('plaid_items').get();
    const plaid = getPlaidClient();

    const transactions = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      if (!access_token) continue;
      const institutionName = data.institutionName || null;

      try {
        const resp = await plaid.transactionsGet({
          access_token,
          start_date,
          end_date,
          options: { count: 100 }
        });
        const txs = resp.data.transactions || [];
        for (const t of txs) {
          transactions.push({
            id: t.transaction_id,
            date: t.date,
            amount: t.amount,
            name: t.name || t.merchant_name || '',
            category: Array.isArray(t.category) ? t.category.join(' / ') : (t.category || null),
            accountId: t.account_id,
            institutionName
          });
        }
      } catch (e) {
        const code = e && e.response && e.response.data && e.response.data.error_code;
        // PRODUCT_NOT_READY is normal for newly linked items; return partial.
        console.error('transactionsGet failed for item', doc.id, code || e.message);
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ transactions })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('get-transactions error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
