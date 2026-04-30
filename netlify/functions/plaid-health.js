// GET /.netlify/functions/plaid-health
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: a single snapshot the frontend can render as a Health Check panel.
//
// {
//   env: 'sandbox' | 'production',
//   summary: {
//     itemCount, accountCount, transactionCount30d, recurringCount,
//     lastWebhookAt, lastSyncAt, healthyItems, errorItems
//   },
//   items: [{
//     itemId, institutionName, status, accounts: [...], errorCode, errorMessage,
//     lastSuccessfulUpdate, lastFailedUpdate, transactionsAvailable
//   }],
//   issues: [{ severity, code, message, itemId }]
// }
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getPlaidClient, getPlaidEnv } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const ISO = d => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized: ' + e.message }) };
    }
    const uid = decoded.uid;
    const db = getFirestore();
    const plaid = getPlaidClient();
    const env = getPlaidEnv();

    // === Items + per-item live state ===
    const itemsSnap = await db.collection('users').doc(uid).collection('plaid_items').get();
    const items = [];
    const issues = [];

    let accountCount = 0;
    let healthyItems = 0;
    let errorItems = 0;
    let lastSyncAt = null;
    let lastWebhookAt = null;

    for (const doc of itemsSnap.docs) {
      const data = doc.data() || {};
      const access_token = data.access_token;
      const itemId = doc.id;
      if (!access_token) {
        items.push({
          itemId, institutionName: data.institutionName || '(unknown)',
          status: 'no_token', accounts: [],
          errorCode: 'MISSING_ACCESS_TOKEN',
          errorMessage: 'Item record has no access token — relink required.'
        });
        errorItems++;
        issues.push({
          severity: 'high', code: 'MISSING_ACCESS_TOKEN', itemId,
          message: `${data.institutionName||itemId} has no access token. Reconnect via Sync Bank.`
        });
        continue;
      }

      let liveAccounts = [];
      let liveError = null;
      let liveErrorMessage = null;
      let itemDetails = null;

      // /item/get gives Plaid's own status block: last_successful_update, errors
      try {
        const got = await plaid.itemGet({ access_token });
        itemDetails = got.data && got.data.item;
      } catch (e) {
        const errData = e && e.response && e.response.data;
        liveError = (errData && errData.error_code) || 'ITEM_GET_FAILED';
        liveErrorMessage = (errData && errData.error_message) || e.message;
      }

      try {
        // /accounts/get is included with Transactions/Liabilities products.
        // (Avoid /accounts/balance/get — that needs the Balance product
        // which we did not contract for.) Returns last-known balances.
        const bal = await plaid.accountsGet({ access_token });
        liveAccounts = bal.data.accounts || [];
        accountCount += liveAccounts.length;
      } catch (e) {
        const errData = e && e.response && e.response.data;
        liveError = liveError || (errData && errData.error_code);
        liveErrorMessage = liveErrorMessage || (errData && errData.error_message) || e.message;
      }

      const status =
        liveError ? 'error'
        : (itemDetails && itemDetails.error) ? 'error'
        : 'healthy';
      if (status === 'healthy') healthyItems++; else errorItems++;

      const lastUpdate = itemDetails && itemDetails.update_type ? null : null; // placeholder
      const lastOk = itemDetails && itemDetails.consented_data_scopes ? null : null; // placeholder
      // Plaid item includes status.transactions.last_successful_update
      const txStatus = itemDetails && itemDetails.status && itemDetails.status.transactions;
      const lastSuccessfulUpdate = (txStatus && txStatus.last_successful_update) || null;
      const lastFailedUpdate     = (txStatus && txStatus.last_failed_update) || null;

      if (lastSuccessfulUpdate) {
        const t = new Date(lastSuccessfulUpdate);
        if (!lastSyncAt || t > lastSyncAt) lastSyncAt = t;
      }
      // Webhook timestamp from Firestore — written by plaid-webhook.js
      const webhookAt = data.lastWebhookAt && data.lastWebhookAt.toDate ? data.lastWebhookAt.toDate() : null;
      if (webhookAt && (!lastWebhookAt || webhookAt > lastWebhookAt)) lastWebhookAt = webhookAt;

      items.push({
        itemId,
        institutionName: data.institutionName || (itemDetails && itemDetails.institution_id) || '(unknown)',
        status,
        accounts: liveAccounts.map(a => ({
          account_id: a.account_id,
          name: a.official_name || a.name,
          mask: a.mask,
          type: a.type, subtype: a.subtype,
          balance: a.balances && (a.balances.current ?? a.balances.available),
          limit:   a.balances && a.balances.limit
        })),
        accountCount: liveAccounts.length,
        errorCode: liveError || null,
        errorMessage: liveErrorMessage || null,
        lastSuccessfulUpdate,
        lastFailedUpdate,
        lastWebhookAt: ISO(webhookAt),
        cachedItemError: data.itemError || null
      });

      if (liveError) {
        issues.push({
          severity: liveError === 'ITEM_LOGIN_REQUIRED' ? 'high' : 'medium',
          code: liveError, itemId,
          message: `${data.institutionName||itemId}: ${liveErrorMessage || liveError}`
        });
      }
    }

    // === Transaction + recurring counts (last 30 days) ===
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    let transactionCount30d = 0;
    let recurringCount = 0;
    try {
      const txSnap = await db.collection('users').doc(uid).collection('transactions')
        .where('date', '>=', thirtyDaysAgo.toISOString().slice(0,10))
        .limit(500).get();
      transactionCount30d = txSnap.size;
    } catch (e) {
      // collection may not exist yet — fine
    }
    try {
      const recSnap = await db.collection('users').doc(uid).collection('recurring_streams').limit(200).get();
      recurringCount = recSnap.size;
    } catch (e) { /* same — fine */ }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        env,
        generatedAt: new Date().toISOString(),
        summary: {
          itemCount: items.length,
          accountCount,
          transactionCount30d,
          recurringCount,
          lastWebhookAt: ISO(lastWebhookAt),
          lastSyncAt: ISO(lastSyncAt),
          healthyItems,
          errorItems
        },
        items,
        issues
      })
    };
  } catch (err) {
    const msg = (err && err.message) || 'unknown error';
    console.error('plaid-health error:', msg, err && err.response && err.response.data);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
