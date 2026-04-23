// POST /.netlify/functions/log-event
// Lightweight homegrown analytics write endpoint.
//
// Accepts events from both anonymous (landing pages) and authenticated
// (in-app) clients. Writes to Firestore collection `wjp_events`.
//
// Body: { event, anon_id, session_id, page, referrer, viewport, props }
// Optional header: Authorization: Bearer <Firebase ID token>  (adds uid + email)
//
// Keeps payload small & ignores unknown events (allowlist).
const { getFirestore, verifyIdToken, getFirebaseAdmin } = require('./_shared/firebase');
const { buildCors } = require('./_shared/cors');

// Allowlist — anything not in here is dropped. Prevents the collection
// from filling up with junk if someone starts spamming the endpoint.
const ALLOWED_EVENTS = new Set([
  // Landing / top-of-funnel
  'page_view',
  'cta_clicked',
  // Auth funnel
  'signup_started',
  'signup_completed',
  'signin_started',
  'signin_completed',
  'email_verified',
  // In-app navigation
  'tab_viewed',
  // Plaid
  'plaid_link_opened',
  'plaid_link_success',
  'plaid_link_error',
  'plaid_link_exit',
  // Core actions
  'debt_added',
  'debt_deleted',
  'paycheck_set',
  // Lifecycle / monetization
  'trial_started',
  'trial_ended',
  'pro_upgraded',
  // Generic error surfaces
  'client_error'
]);

function clampStr(s, max) {
  if (typeof s !== 'string') return null;
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeProps(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  let count = 0;
  for (const [k, v] of Object.entries(props)) {
    if (count >= 12) break; // cap keys
    if (typeof k !== 'string' || k.length > 40) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    count++;
  }
  return out;
}

exports.handler = async (event) => {
  const CORS = buildCors(event, ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid JSON' }) }; }

  const evName = clampStr(body.event, 60);
  if (!evName || !ALLOWED_EVENTS.has(evName)) {
    // 204 — silently drop unknown events (don't give scrapers feedback).
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Optional auth — if present, enrich with uid/email. Never required.
  let uid = null, email = null;
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (authHeader) {
    try {
      const decoded = await verifyIdToken(authHeader);
      uid = decoded.uid || null;
      email = decoded.email || null;
    } catch (_) { /* treat as anonymous */ }
  }

  const admin = getFirebaseAdmin();
  const db = getFirestore();

  const doc = {
    event: evName,
    ts: admin.firestore.FieldValue.serverTimestamp(),
    uid,
    email,
    anon_id:    clampStr(body.anon_id, 40),
    session_id: clampStr(body.session_id, 40),
    page:       clampStr(body.page, 120),
    referrer:   clampStr(body.referrer, 200),
    viewport:   clampStr(body.viewport, 20),
    ua:         clampStr(event.headers['user-agent'] || '', 200),
    ip_hash:    null, // don't store raw IP
    props:      sanitizeProps(body.props)
  };

  try {
    await db.collection('wjp_events').add(doc);
    return { statusCode: 204, headers: CORS, body: '' };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'write failed' }) };
  }
};
