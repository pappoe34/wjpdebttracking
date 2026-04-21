// POST /.netlify/functions/create-link-token
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { link_token }
const { verifyIdToken } = require('./_shared/firebase');
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

    const plaid = getPlaidClient();
    const resp = await plaid.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'WJP Debt Tracking',
      products: ['transactions', 'liabilities'],
      country_codes: ['US'],
      language: 'en'
    });

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
