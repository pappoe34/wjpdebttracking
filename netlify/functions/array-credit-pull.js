// POST /.netlify/functions/array-credit-pull
//
// Headers: Authorization: Bearer <Firebase ID token>
// Body (optional): { sandbox?: boolean, force?: boolean }
//
// Returns: {
//   ok: true,
//   scores: { vantage, experian, equifax, transunion, pulledAt, provider, scoreModel, sandbox },
//   reportKey?: string,
//   displayToken?: string
// }
//
// Tier gate: Pro / Pro Plus / Ultimate / Admin (free tier blocked).
// Rate limit: hard 30-day minimum between pulls (admin override via `force`).
//
// Sandbox mode (default): uses Thomas Devos test identity from Array's
// sandbox-identities catalog. No real customer data leaves the function.
// Production mode requires users/{uid}/state/main.creditIdentity to exist.
//
// Important constraints from Array's docs:
//   - TransUnion data CANNOT be transmitted via REST API. We use Experian
//     as the bureau for 1B Vantage pulls. transunion field is always null
//     in REST results — TU data flows only via Array's embedded components.
//   - Product code "exp1bReportScore" = Experian single-bureau Vantage 3.0.

const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const ARRAY_SANDBOX_BASE = 'https://sandbox.array.io';
const ARRAY_PROD_BASE    = 'https://array.io';

// Sandbox defaults (overridable via Netlify env vars in production)
const ARRAY_APP_KEY   = process.env.ARRAY_APP_KEY   || '3F03D20E-5311-43D8-8A76-E4B5D77793BD';
const ARRAY_API_TOKEN = process.env.ARRAY_API_TOKEN || '93061BA4-3DD3-43BB-8574-685B860FE894';

const SANDBOX_DEFAULT = (process.env.ARRAY_MODE || 'sandbox') !== 'production';

const MIN_INTERVAL_MS = 30 * 86400000; // 30 days
const PRO_TIERS = new Set(['pro', 'plus', 'pro-plus', 'ultimate', 'admin', 'trialing']);

// Sandbox test customer (Thomas Devos — 3-bureau Vantage support)
const SANDBOX_IDENTITY = {
  firstName: 'THOMAS',
  lastName: 'DEVOS',
  dob: '1957-09-06',
  ssn: '666023511',
  phoneNumber: '4045049006',
  emailAddress: 'tdevos@example.com',
  address: {
    street: '1206 BEAR CREEK RD APT 110',
    city: 'TUSCALOOSA',
    state: 'AL',
    zip: '35405'
  }
};

// KBA correct-answer dictionary (Experian / TransUnion sandbox identities).
// Source: https://docs.array.com/docs/sandbox-identities
const KBA_CORRECT_ANSWERS = new Set([
  '$200 - $249', '$385 - $484', '2021', '5518', '7515', 'ashwood',
  'asi medical', 'bachelor degree', 'bechtelcon', 'bethel', 'bmw x5',
  'ford f100 pickup', 'carroll county bank &', 'dentist / dental hygienist',
  'dr ralph alperin md', 'dr ira adler', 'great financial svc',
  'histo tec laboratory', 'iec', 'kia sorento', 'lynn lee const co in',
  'maggies flowers & gift', 'morrison mahoney miller', 'new hampshire',
  'sallie mae servicing', 'sn katz jewelry', 'the toronto-dominion bank',
  'toyota highlander', 'tuscaloosa', 'volkswagen passat', 'wells fargo & company'
].map(s => s.toLowerCase()));


// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let uid, tier, isAdmin, state;
  try {
    // 1. Verify Firebase ID token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let decoded;
    try { decoded = await verifyIdToken(authHeader); }
    catch (e) { return json(401, { error: 'unauthorized', message: e.message }); }
    uid = decoded.uid;

    const body = parseBody(event.body);
    const sandbox = body.sandbox !== undefined ? !!body.sandbox : SANDBOX_DEFAULT;
    const force = !!body.force;

    // 2. Tier + rate-limit gate
    const db = getFirestore();
    const stateRef = db.collection('users').doc(uid).collection('state').doc('main');
    const stateSnap = await stateRef.get();
    state = stateSnap.exists ? stateSnap.data() : {};

    const sub = state.subscription || {};
    tier = String(sub.tier || 'free').toLowerCase();
    isAdmin = !!(sub.isAdmin || tier === 'admin');

    // Sandbox mode is a dev/test path — skip the tier gate so engineering
    // can validate the integration without billing or tier setup.
    // Production mode enforces Pro+ as configured.
    var sandboxRequested = (body.sandbox !== undefined ? !!body.sandbox : SANDBOX_DEFAULT);
    if (!sandboxRequested && !isAdmin && !PRO_TIERS.has(tier)) {
      return json(403, {
        error: 'tier_locked',
        message: 'Credit pulls require Pro tier or higher. Upgrade to unlock.',
        currentTier: tier
      });
    }

    const creditMeta = state.creditMeta || {};
    const lastPull = creditMeta.lastPullAt || 0;
    const since = Date.now() - lastPull;
    if (!sandboxRequested && !isAdmin && !force && lastPull && since < MIN_INTERVAL_MS) {
      return json(429, {
        error: 'rate_limited',
        message: 'Credit pulls are limited to once every 30 days.',
        lastPullAt: lastPull,
        nextEligibleAt: lastPull + MIN_INTERVAL_MS
      });
    }

    // 3. Run Array flow
    const base = sandbox ? ARRAY_SANDBOX_BASE : ARRAY_PROD_BASE;
    const identity = sandbox ? SANDBOX_IDENTITY : await loadProductionIdentity(uid, state);
    if (!identity) {
      return json(412, {
        error: 'identity_required',
        message: 'Complete your identity profile before requesting a credit pull.'
      });
    }

    const result = await runArrayFlow({ base, identity, sandbox });
    if (!result.ok) {
      console.error('[array-credit-pull] flow failed:', result.err, JSON.stringify(result.details || {}).slice(0, 800));
      return json(502, {
        error: 'array_failed',
        stage: result.err,
        message: 'Credit bureau request failed. Please try again later.',
        details: sandbox ? result.details : undefined
      });
    }

    // 4. Persist scores
    const now = Date.now();
    const scores = {
      vantage: result.score,
      equifax: result.score,
      experian: null,
      transunion: null,   // intentional: not transmittable via REST
      pulledAt: now,
      provider: 'equifax',
      scoreModel: 'VantageScore 3.0',
      sandbox
    };

    const admin = getFirebaseAdmin();
    await stateRef.set({
      creditScores: scores,
      creditMeta: {
        lastPullAt: now,
        lastProvider: 'equifax',
        lastReportKey: result.reportKey || null,
        sandbox
      },
      creditScoreHistory: admin.firestore.FieldValue.arrayUnion({
        ts: now,
        score: result.score,
        provider: 'equifax',
        model: 'VantageScore 3.0',
        sandbox
      })
    }, { merge: true });

    return json(200, {
      ok: true,
      scores,
      reportKey: result.reportKey,
      displayToken: result.displayToken,
      sandbox
    });

  } catch (err) {
    console.error('[array-credit-pull] unexpected error:', err && err.message, err && err.stack);
    return json(500, { error: 'internal', message: err.message });
  }
};



// Build the auth headers Array expects on every API call.
function arrayHeaders(extra) {
  return Object.assign({
    'Authorization': 'Bearer ' + ARRAY_API_TOKEN,
    'Content-Type': 'application/json; charset=utf-8'
  }, extra || {});
}

// ─── Array API flow (5 steps) ───────────────────────────────────────────────
async function runArrayFlow({ base, identity, sandbox }) {
  try {
    // Step 1 — Create User
    const createBody = Object.assign({ appKey: ARRAY_APP_KEY }, identity);
    const userRes = await fetch(`${base}/api/user/v2`, {
      method: 'POST',
      headers: arrayHeaders(),
      body: JSON.stringify(createBody)
    });
    if (!userRes.ok) return fail('create_user', userRes);
    const userData = await userRes.json();
    const userId = userData.userId;
    if (!userId) return { ok: false, err: 'no_user_id', details: userData };

    // Step 2 — Initiate Verification (Experian KBA)
    const initUrl = `${base}/api/authenticate/v2?appKey=${encodeURIComponent(ARRAY_APP_KEY)}&userId=${encodeURIComponent(userId)}&provider1=efx`;
    const initRes = await fetch(initUrl, { headers: arrayHeaders() });
    if (!initRes.ok) return fail('init_verification', initRes);
    const initData = await initRes.json();
    const authToken = initData.authToken;
    const questions = Array.isArray(initData.questions) ? initData.questions : [];
    if (!authToken) return { ok: false, err: 'no_auth_token', details: initData };

    // Step 3 — Match answers
    const answers = pickAnswers(questions);

    // Step 4 — Submit Verification (multi-round KBA loop)
    // Experian sometimes responds with another set of questions instead of a
    // userToken — happens on sandbox identities when "None of the above"
    // answers exceed a threshold. Loop until we get a userToken or run out
    // of attempts.
    let userToken = null;
    let currentAuthToken = authToken;
    let currentQuestions = questions;
    let currentAnswers = answers;
    const MAX_KBA_ROUNDS = 5;
    let lastSubmit = null;
    for (let round = 0; round < MAX_KBA_ROUNDS; round++) {
      const submitRes = await fetch(`${base}/api/authenticate/v2`, {
        method: 'POST',
        headers: arrayHeaders(),
        body: JSON.stringify({
          appKey: ARRAY_APP_KEY,
          userId,
          authToken: currentAuthToken,
          answers: currentAnswers
        })
      });
      if (!submitRes.ok) return fail('submit_verification', submitRes);
      lastSubmit = await submitRes.json();
      if (lastSubmit.userToken) { userToken = lastSubmit.userToken; break; }
      // Another round of questions — keep going
      if (Array.isArray(lastSubmit.questions) && lastSubmit.questions.length > 0) {
        currentAuthToken = lastSubmit.authToken || currentAuthToken;
        currentQuestions = lastSubmit.questions;
        currentAnswers = pickAnswers(currentQuestions);
        continue;
      }
      // Neither userToken nor more questions — verification failed
      break;
    }
    if (!userToken) return { ok: false, err: 'verification_failed', details: lastSubmit };

    // Step 5 — Order Credit Report (Experian 1B Vantage)
    const orderRes = await fetch(`${base}/api/report/v2`, {
      method: 'POST',
      headers: arrayHeaders({ 'x-array-user-token': userToken }),
      body: JSON.stringify({ userId, productCode: 'efx1bReportScore' })
    });
    if (!orderRes.ok) return fail('order_report', orderRes);
    const orderData = await orderRes.json();
    const reportKey = orderData.reportKey;
    const displayToken = orderData.displayToken;

    // Try to extract the score directly from the order response first
    let score = pickScore(orderData);

    // Fallback: retrieve report HTML and parse out the VantageScore value
    if (!score && reportKey && displayToken) {
      score = await retrieveScoreFromHtml(base, reportKey, displayToken);
    }

    if (!score || score < 300 || score > 850) {
      return { ok: false, err: 'score_not_found', details: { orderData, parsedScore: score } };
    }

    return { ok: true, score, reportKey, displayToken, userId };

  } catch (e) {
    return { ok: false, err: 'flow_exception', details: { message: e.message } };
  }
}


// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadProductionIdentity(uid, state) {
  const id = (state && state.creditIdentity) || null;
  if (!id || !id.firstName || !id.lastName || !id.dob || !id.ssn || !id.address) return null;
  return {
    firstName: String(id.firstName).toUpperCase(),
    lastName:  String(id.lastName).toUpperCase(),
    dob: id.dob,
    ssn: id.ssn,
    phoneNumber: id.phoneNumber || '',
    emailAddress: id.emailAddress || '',
    address: {
      street: id.address.street,
      city:   id.address.city,
      state:  id.address.state,
      zip:    id.address.zip
    }
  };
}

function pickAnswers(questions) {
  const answers = {};
  for (const q of questions) {
    const opts = Array.isArray(q.answers) ? q.answers : [];
    let chosen = null;

    // Equifax-style: response includes correctAnswer flags
    const flagged = opts.find(a => String(a.correctAnswer).toLowerCase() === 'true');
    if (flagged) chosen = flagged.id;

    // Experian/TransUnion-style: match against known dictionary
    if (!chosen) {
      for (const a of opts) {
        const txt = String(a.text || '').toLowerCase().trim();
        if (KBA_CORRECT_ANSWERS.has(txt)) { chosen = a.id; break; }
      }
    }

    // Fallback: "None of the above" if no correct answer applies
    if (!chosen) {
      const none = opts.find(a => /none of the (above|these)/i.test(String(a.text || '')));
      chosen = none ? none.id : (opts.length ? opts[opts.length - 1].id : null);
    }

    if (chosen != null) answers[q.id] = chosen;
  }
  return answers;
}

function pickScore(data) {
  if (!data || typeof data !== 'object') return null;
  // Try common shapes Array might use
  const candidates = [
    data.score, data.vantage, data.vantageScore, data.creditScore,
    data.scoreValue,
    (data.reports && data.reports.equifax && (data.reports.equifax.vantage || data.reports.equifax.score)) || (data.reports && data.reports.experian && (data.reports.experian.vantage || data.reports.experian.score)),
    data.reports && data.reports.experian && data.reports.experian.vantageScore
  ];
  for (const c of candidates) {
    const n = parseInt(c, 10);
    if (Number.isFinite(n) && n >= 300 && n <= 850) return n;
  }
  return null;
}

async function retrieveScoreFromHtml(base, reportKey, displayToken) {
  const url = `${base}/api/report/v2/html?reportKey=${encodeURIComponent(reportKey)}&displayToken=${encodeURIComponent(displayToken)}`;
  // Array may return 202 while the report is generating — poll up to 8s
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: arrayHeaders() });
    if (res.status === 200) {
      const html = await res.text();
      const m = html.match(/Vantage[\s\S]{0,300}?(\d{3})/i)
            || html.match(/score[\s\S]{0,120}?(\d{3})/i)
            || html.match(/>\s*(\d{3})\s*</);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 300 && n <= 850) return n;
      }
      return null;
    }
    if (res.status === 204) return null; // failure
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function fail(stage, res) {
  let body = null;
  try { body = await res.text(); } catch (_) {}
  return { ok: false, err: stage, details: { status: res.status, body: (body || '').slice(0, 1000) } };
}

function parseBody(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function json(statusCode, payload) {
  return { statusCode, headers: CORS, body: JSON.stringify(payload) };
}
