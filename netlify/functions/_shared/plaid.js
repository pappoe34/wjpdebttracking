// Plaid client singleton.
// Switch environments via env var PLAID_ENV in Netlify (sandbox|development|production).
// Required env vars per environment:
//   sandbox     → PLAID_CLIENT_ID, PLAID_SANDBOX_SECRET
//   development → PLAID_CLIENT_ID, PLAID_DEV_SECRET
//   production  → PLAID_CLIENT_ID, PLAID_PROD_SECRET
//
// Default is 'sandbox' so a missing/typo'd env var never silently sends real
// money requests to a live bank. Production cutover is one env var change:
// flip PLAID_ENV=production after PLAID_PROD_SECRET is set.
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

let _client = null;
let _env = null;

function resolveEnv() {
  const raw = (process.env.PLAID_ENV || 'sandbox').toLowerCase().trim();
  if (raw === 'sandbox' || raw === 'development' || raw === 'production') return raw;
  // Unknown value → fail closed at sandbox.
  console.warn('unknown PLAID_ENV value, falling back to sandbox:', raw);
  return 'sandbox';
}

function secretEnvVarFor(env) {
  if (env === 'production') return 'PLAID_PROD_SECRET';
  if (env === 'development') return 'PLAID_DEV_SECRET';
  return 'PLAID_SANDBOX_SECRET';
}

function getPlaidEnv() {
  if (!_env) _env = resolveEnv();
  return _env;
}

function getPlaidClient() {
  if (_client) return _client;

  const env = getPlaidEnv();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secretVar = secretEnvVarFor(env);
  const secret = process.env[secretVar];
  if (!clientId) throw new Error('missing env var: PLAID_CLIENT_ID');
  if (!secret) throw new Error('missing env var: ' + secretVar + ' (required for PLAID_ENV=' + env + ')');

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env],
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

module.exports = { getPlaidClient, getPlaidEnv };
