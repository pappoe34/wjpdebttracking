// CORS helper. In sandbox/dev defaults to '*' (convenient for testing).
// In production, requires ALLOWED_ORIGIN env var to be set (comma-separated
// allowlist) — fails closed if missing so we never accidentally ship `*`
// to a real-money environment.
//
// Usage in a function:
//   const { buildCors } = require('./_shared/cors');
//   const CORS = buildCors(event, ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);
//   ... return { statusCode, headers: CORS, body };
const { getPlaidEnv } = require('./plaid');

function parseAllowlist() {
  const raw = process.env.ALLOWED_ORIGIN || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function pickOrigin(event) {
  const env = getPlaidEnv();
  const allowlist = parseAllowlist();
  const reqOrigin = (event && event.headers && (event.headers.origin || event.headers.Origin)) || '';

  // Sandbox/dev: if no allowlist configured, default to wildcard for ergonomics.
  if (env !== 'production' && allowlist.length === 0) return '*';

  // Production: allowlist required. Fail closed.
  if (env === 'production' && allowlist.length === 0) return 'null';

  // If the request origin matches the allowlist, reflect it. Else first entry
  // (so simple curl tests still get a usable header).
  if (reqOrigin && allowlist.includes(reqOrigin)) return reqOrigin;
  return allowlist[0] || 'null';
}

function buildCors(event, methods, headers) {
  const allowMethods = (methods || ['GET', 'POST', 'OPTIONS']).join(', ');
  const allowHeaders = (headers || ['Content-Type', 'Authorization']).join(', ');
  return {
    'Access-Control-Allow-Origin': pickOrigin(event),
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

module.exports = { buildCors };
