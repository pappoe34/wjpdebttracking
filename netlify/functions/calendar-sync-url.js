// POST /.netlify/functions/calendar-sync-url
// Headers: Authorization: Bearer <Firebase ID token>
//
// Returns the user's personal calendar subscription URL. The URL contains
// an HMAC signature of the user's uid so the public /calendar endpoint can
// verify polling requests from Google/Apple without an auth header.
//
// The user pastes the returned URL into Google Calendar → Settings →
// "Add by URL". Google polls it every few hours.

const crypto = require('crypto');
const { verifyIdToken } = require('./_shared/firebase');

function signUid(uid, secret) {
  return crypto.createHmac('sha256', secret).update(uid).digest('hex');
}

function buildSiteOrigin(event) {
  // Prefer the request origin (so dev/preview deploys work), fall back to
  // production.
  const h = event.headers || {};
  const origin = h.origin || h.Origin || '';
  if (origin && /^https:\/\/.+/i.test(origin)) return origin;
  // Netlify exposes URL and DEPLOY_URL env vars at runtime
  if (process.env.URL) return process.env.URL;
  return 'https://wjpdebttracking.com';
}

exports.handler = async function (event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = process.env.CAL_SIGNING_SECRET;
  if (!secret) return json(500, { error: 'Server misconfigured: missing CAL_SIGNING_SECRET' });

  let decoded;
  try {
    const h = event.headers || {};
    const auth = h.authorization || h.Authorization;
    decoded = await verifyIdToken(auth);
  } catch (err) {
    return json(401, { error: 'Unauthorized: ' + (err && err.message ? err.message : 'token verification failed') });
  }

  const uid = decoded && decoded.uid;
  if (!uid) return json(401, { error: 'Token missing uid claim' });

  const sig = signUid(uid, secret);
  const origin = buildSiteOrigin(event);
  const url = `${origin}/.netlify/functions/calendar?uid=${encodeURIComponent(uid)}&sig=${sig}`;

  return json(200, {
    url,
    // Also return a webcal:// variant — some calendar apps prefer it.
    webcal: url.replace(/^https?:\/\//, 'webcal://'),
    uid
  });
};
