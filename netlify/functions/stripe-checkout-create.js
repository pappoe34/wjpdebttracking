/**
 * POST /.netlify/functions/stripe-checkout-create
 *
 * Auth:    Bearer <Firebase ID token>
 * Body:    { lookup_key }   one of: pro_monthly | pro_yearly | plus_monthly | plus_yearly
 * Returns: { url, session_id }
 *
 * Creates (or reuses) a Stripe Customer for the user, then opens a Checkout
 * session for the requested subscription tier. Trial days come from PRICE_CONFIG.
 */
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getStripe, PRICE_CONFIG, getPriceIdForLookup } = require('./_shared/stripe');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });
const SITE = process.env.SITE_URL || 'https://wjpdebttracking.com';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let user;
  try {
    user = await verifyIdToken(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return json(401, { error: 'unauthorized: ' + e.message });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad json' }); }

  const lookupKey = String(body.lookup_key || '').trim();
  if (!PRICE_CONFIG[lookupKey]) {
    return json(400, { error: 'unknown lookup_key. expected one of: ' + Object.keys(PRICE_CONFIG).join(', ') });
  }
  const cfg = PRICE_CONFIG[lookupKey];

  try {
    const stripe = getStripe();
    const db = getFirestore();
    const subRef = db.collection('users').doc(user.uid).collection('billing').doc('subscription');

    // Resolve price ID by lookup_key (no hardcoded IDs)
    const priceId = await getPriceIdForLookup(stripe, lookupKey);

    // Find or create Stripe customer for this user
    let customerId = null;
    const subSnap = await subRef.get();
    if (subSnap.exists) {
      customerId = subSnap.data().stripeCustomerId || null;
    }
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { firebase_uid: user.uid },
      });
      customerId = cust.id;
      await subRef.set({ stripeCustomerId: customerId, tier: 'free', updatedAt: Date.now() }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: cfg.trialDays > 0
        ? { trial_period_days: cfg.trialDays, metadata: { firebase_uid: user.uid, tier: cfg.tier } }
        : { metadata: { firebase_uid: user.uid, tier: cfg.tier } },
      client_reference_id: user.uid,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      success_url: SITE + '/index.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}#settings',
      cancel_url:  SITE + '/index.html?upgrade=cancel#settings',
      metadata: { firebase_uid: user.uid, lookup_key: lookupKey },
    });

    return json(200, { url: session.url, session_id: session.id });
  } catch (e) {
    console.error('[stripe-checkout-create] error:', e.message);
    return json(500, { error: e.message });
  }
};
