// Plaid client singleton (sandbox).
// Requires env vars: PLAID_CLIENT_ID, PLAID_SANDBOX_SECRET.
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

let _client = null;

function getPlaidClient() {
  if (_client) return _client;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SANDBOX_SECRET;
  if (!clientId) throw new Error('missing env var: PLAID_CLIENT_ID');
  if (!secret) throw new Error('missing env var: PLAID_SANDBOX_SECRET');

  const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret
      }
    }
  });
  _client = new PlaidApi(configuration);
  return _client;
}

module.exports = { getPlaidClient };
