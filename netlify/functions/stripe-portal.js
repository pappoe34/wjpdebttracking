/**
 * POST /.netlify/functions/stripe-portal
 *
 * Auth:    Bearer <Firebase ID token>
 * Body:    {} (no body needed)
 * Returns: { url }
 *
 * Returns a Stripe Customer Portal session URL. The user can update payment
 * method, switch plans, or cancel — all self-serve, no support needed.
 */
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getStripe } = require('./_shared/stripe-client');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
const json = (s, b) => ({ statusCode: s, headers: CORS, body: JSON.stringify(b) });
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

  try {
    const stripe = getStripe();
    const db = getFirestore();
    const subSnap = await db.collection('users').doc(user.uid).collection('billing').doc('subscription').get();
    if (!subSnap.exists || !subSnap.data().stripeCustomerId) {
      return json(404, { error: 'no stripe customer for this user' });
    }
    const customerId = subSnap.data().stripeCustomerId;

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: SITE + '/index.html#settings',
    });
    return json(200, { url: portal.url });
  } catch (e) {
    console.error('[stripe-portal] error:', e.message);
    return json(500, { error: e.message });
  }
};
