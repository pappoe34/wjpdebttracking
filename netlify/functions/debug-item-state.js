// REMOVED — sandbox-only diagnostic endpoint, retired before Plaid Production cutover.
// Stub kept only to ensure any stale client call gets a clean 410 instead of a 404.
// No imports, no logic, no side effects.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};
exports.handler = async () => ({
  statusCode: 410,
  headers: CORS,
  body: JSON.stringify({ error: 'endpoint removed' })
});
