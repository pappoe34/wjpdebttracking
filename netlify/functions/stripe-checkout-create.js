/**
 * POST /.netlify/functions/stripe-checkout-create
 *
 * Auth:    Bearer <Firebase ID token>
 * Body:    {
 *   lookup_key:    pro_monthly | pro_yearly | plus_monthly | plus_yearly | free_setup
 *   success_path?: relative path to land on after card collection (default '/index.html?upgrade=success#settings')
 *   cancel_path?:  relative path to land on if user cancels checkout
 * }
 * Returns: { url, session_id, mode, welcomeBack }
 *
 * For paid tiers (pro_*, plus_*): creates a subscription Checkout with 14d
 * trial. User gets full Pro Plus access during trial regardless of picked
 * tier (frontend resolver handles that).
 *
 * For free_setup: creates a `setup` mode Checkout that only collects a card
 * on file (no subscription, no charges). Webhook handles writing the
 * Firestore trial state on completion.
 *
 * Welcome-back discount: if the user has a prior canceled subscription on
 * file >30 days ago AND env STRIPE_WELCOME_BACK_COUPON is set, the coupon is
 * auto-applied. Free pick is excluded (no subscription to discount).
 */
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getStripe, PRICE_CONFIG, getPriceIdForLookup } = require('./_shared/stripe-client');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });
const SITE = process.env.SITE_URL || 'https://wjpdebttracking.com';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Sanitize relative paths from the client — must start with /, no protocol or host
function safePath(input, fallback) {
  if (typeof input !== 'string') return fallback;
  const v = input.trim();
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//')) return fallback;
  if (/^https?:/i.test(v)) return fallback;
  // Strip control chars
  return v.replace(/[\r\n\t]/g, '').slice(0, 200);
}

async function checkWelcomeBackEligible(subSnap) {
  // Eligibility: user has a previous subscription doc that was canceled >30d ago.
  if (!subSnap.exists) return false;
  const d = subSnap.data() || {};
  const canceledAt = d.canceledAt || 0;
  if (!canceledAt) return false;
  return (Date.now() - canceledAt) > THIRTY_DAYS_MS;
}

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

  const successPath = safePath(body.success_path, '/index.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}#settings');
  const cancelPath  = safePath(body.cancel_path,  '/index.html?upgrade=cancel#settings');
  // Inject session_id placeholder into success path if the client supplied a custom one
  const successUrl = (successPath.indexOf('session_id=') === -1)
    ? (SITE + successPath + (successPath.indexOf('?') === -1 ? '?' : '&') + 'session_id={CHECKOUT_SESSION_ID}')
    : (SITE + successPath);
  const cancelUrl = SITE + cancelPath;

  try {
    const stripe = getStripe();
    const db = getFirestore();
    const subRef = db.collection('users').doc(user.uid).collection('billing').doc('subscription');
    const subSnap = await subRef.get();

    // Find or create Stripe customer for this user
    let customerId = (subSnap.exists && subSnap.data().stripeCustomerId) || null;
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { firebase_uid: user.uid },
      });
      customerId = cust.id;
      await subRef.set({ stripeCustomerId: customerId, tier: 'free', updatedAt: Date.now() }, { merge: true });
    }

    // Welcome-back discount for returning users — paid tiers only (free_setup
    // has no subscription to discount). Skip if env coupon not set.
    let welcomeBack = false;
    let discounts;
    if (cfg.mode === 'subscription' && process.env.STRIPE_WELCOME_BACK_COUPON) {
      welcomeBack = await checkWelcomeBackEligible(subSnap);
      if (welcomeBack) {
        discounts = [{ coupon: process.env.STRIPE_WELCOME_BACK_COUPON }];
      }
    }

    let session;

    if (cfg.mode === 'subscription') {
      const priceId = await getPriceIdForLookup(stripe, lookupKey);
      const sessionParams = {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: cfg.trialDays > 0
          ? { trial_period_days: cfg.trialDays, metadata: { firebase_uid: user.uid, tier: cfg.tier, intended_tier: cfg.tier } }
          : { metadata: { firebase_uid: user.uid, tier: cfg.tier, intended_tier: cfg.tier } },
        client_reference_id: user.uid,
        // Discounts override allow_promotion_codes; only allow promo codes if no auto-discount
        billing_address_collection: 'auto',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { firebase_uid: user.uid, lookup_key: lookupKey, intended_tier: cfg.tier },
      };
      if (discounts) sessionParams.discounts = discounts;
      else sessionParams.allow_promotion_codes = true;
      session = await stripe.checkout.sessions.create(sessionParams);

      // Persist intended_tier hint in Firestore so webhook + frontend can read it
      await subRef.set({
        intendedTier: cfg.tier,
        intendedCycle: cfg.interval === 'year' ? 'yearly' : 'monthly',
        updatedAt: Date.now(),
      }, { merge: true });

    } else if (cfg.mode === 'setup') {
      // Free pick — Stripe Checkout in `setup` mode collects a payment method
      // for a customer without creating a subscription. We then locally track
      // the 14-day trial via Firestore. After the trial, the user lands on Free.
      session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        client_reference_id: user.uid,
        billing_address_collection: 'auto',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { firebase_uid: user.uid, lookup_key: lookupKey, intended_tier: 'free' },
      });

      // Set Firestore trialing state immediately. Webhook will confirm on
      // checkout.session.completed (idempotent).
      await subRef.set({
        intendedTier: 'free',
        intendedCycle: 'monthly',
        tier: 'free',
        status: 'trialing',
        trialEnd: Date.now() + (cfg.trialDays * 24 * 60 * 60 * 1000),
        trialingUntil: Date.now() + (cfg.trialDays * 24 * 60 * 60 * 1000),
        updatedAt: Date.now(),
      }, { merge: true });

    } else {
      return json(400, { error: 'unsupported checkout mode: ' + cfg.mode });
    }

    return json(200, {
      url: session.url,
      session_id: session.id,
      mode: cfg.mode,
      welcomeBack: !!welcomeBack
    });
  } catch (e) {
    console.error('[stripe-checkout-create] error:', e.message);
    return json(500, { error: e.message });
  }
};
