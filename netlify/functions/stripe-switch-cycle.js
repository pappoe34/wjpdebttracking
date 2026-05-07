/**
 * POST /.netlify/functions/stripe-switch-cycle
 *
 * Auth:    Bearer <Firebase ID token>
 * Body:    { target_lookup_key }   one of pro_yearly | plus_yearly (or _monthly)
 * Returns: { ok, subscriptionId, prorationCents, newPriceId }
 *
 * Switches the user's existing subscription to a different price (typically
 * monthly → yearly upgrade) with Stripe's native proration. Stripe computes the
 * unused portion of the current period and credits it against the first invoice
 * on the new price, so the user only pays the difference.
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

  const targetKey = String(body.target_lookup_key || '').trim();
  if (!PRICE_CONFIG[targetKey] || PRICE_CONFIG[targetKey].mode !== 'subscription') {
    return json(400, { error: 'invalid target_lookup_key' });
  }

  try {
    const stripe = getStripe();
    const db = getFirestore();
    const subRef = db.collection('users').doc(user.uid).collection('billing').doc('subscription');
    const subSnap = await subRef.get();
    if (!subSnap.exists) return json(400, { error: 'no subscription on file' });
    const subData = subSnap.data();
    const subId = subData.stripeSubscriptionId;
    if (!subId) return json(400, { error: 'no stripe subscription id' });

    // Fetch current subscription
    const sub = await stripe.subscriptions.retrieve(subId);
    if (sub.status === 'canceled') return json(400, { error: 'subscription is canceled; create a new one instead' });
    const currentItem = sub.items.data[0];
    if (!currentItem) return json(400, { error: 'subscription has no item to update' });

    // Resolve new price id
    const newPriceId = await getPriceIdForLookup(stripe, targetKey);
    if (currentItem.price.id === newPriceId) return json(200, { ok: true, noChange: true });

    // Update with proration. proration_behavior='create_prorations' is default
    // for upgrades — Stripe credits the unused portion of the current period
    // and bills only the difference on the next invoice.
    const updated = await stripe.subscriptions.update(subId, {
      items: [{ id: currentItem.id, price: newPriceId }],
      proration_behavior: 'create_prorations',
      payment_behavior: 'default_incomplete',
      metadata: Object.assign({}, sub.metadata || {}, {
        intended_tier: PRICE_CONFIG[targetKey].tier,
        switched_at: String(Date.now()),
      })
    });

    // Estimate proration amount via upcoming invoice
    let prorationCents = 0;
    try {
      const upcoming = await stripe.invoices.retrieveUpcoming({
        customer: sub.customer,
        subscription: subId,
      });
      prorationCents = upcoming.amount_due || 0;
    } catch (_) {}

    // Update Firestore intendedCycle hint
    await subRef.set({
      intendedTier: PRICE_CONFIG[targetKey].tier,
      intendedCycle: PRICE_CONFIG[targetKey].interval === 'year' ? 'yearly' : 'monthly',
      currentPriceLookupKey: targetKey,
      updatedAt: Date.now()
    }, { merge: true });

    return json(200, {
      ok: true,
      subscriptionId: updated.id,
      newPriceId,
      newLookupKey: targetKey,
      prorationCents
    });

  } catch (e) {
    console.error('[stripe-switch-cycle] error:', e.message);
    return json(500, { error: e.message });
  }
};
