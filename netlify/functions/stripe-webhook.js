/**
 * POST /.netlify/functions/stripe-webhook
 *
 * NO auth header — verified via Stripe signature header instead.
 *
 * Required env: STRIPE_WEBHOOK_SECRET (whsec_...) — get this when you create
 * the webhook endpoint in the Stripe dashboard.
 *
 * Listens for subscription lifecycle events and writes the user's tier state
 * to Firestore at users/{uid}/billing/subscription.
 *
 * Events handled:
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_succeeded
 *   invoice.payment_failed
 *   checkout.session.completed
 */
const { getStripe, tierFromLookupKey } = require('./_shared/stripe-client');
const { getFirestore } = require('./_shared/firebase');

const RESPOND = (status, text) => ({ statusCode: status, headers: { 'Content-Type': 'text/plain' }, body: text });

async function syncSubToFirestore(stripe, db, sub) {
  // Resolve uid: prefer subscription metadata, fall back to customer metadata
  let uid = sub.metadata && sub.metadata.firebase_uid;
  if (!uid) {
    const cust = await stripe.customers.retrieve(sub.customer);
    uid = cust && cust.metadata && cust.metadata.firebase_uid;
  }
  if (!uid) {
    console.warn('[webhook] no firebase_uid for subscription', sub.id);
    return;
  }

  // Determine tier from the active price's lookup_key
  const item = sub.items && sub.items.data && sub.items.data[0];
  const lookupKey = item && item.price && item.price.lookup_key;
  const tier = sub.status === 'canceled' ? 'free' : tierFromLookupKey(lookupKey);

  const data = {
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    tier,
    status: sub.status,                        // active | trialing | past_due | canceled | incomplete | unpaid
    currentPriceId: item && item.price ? item.price.id : null,
    currentPriceLookupKey: lookupKey || null,
    currentPeriodStart: sub.current_period_start ? sub.current_period_start * 1000 : null,
    currentPeriodEnd:   sub.current_period_end   ? sub.current_period_end   * 1000 : null,
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? sub.canceled_at * 1000 : null,
    updatedAt: Date.now(),
  };
  await db.collection('users').doc(uid).collection('billing').doc('subscription').set(data, { merge: true });
  console.log('[webhook] synced subscription for uid', uid, 'tier=' + tier, 'status=' + sub.status);
}


// W6 — Referral activation/clawback helpers (mirror of validate-referral.js logic)
const REWARD_THRESHOLD = 5;
const CLAWBACK_DAYS = 30;

async function tryActivateReferral(db, referredUid) {
  const snap = await db.collection('referrals')
    .where('referredUid', '==', referredUid)
    .where('status', '==', 'pending').limit(1).get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  await doc.ref.update({ status: 'paid', activatedAt: Date.now() });
  const referrerUid = doc.data().referrerUid;
  const paidCount = await db.collection('referrals')
    .where('referrerUid', '==', referrerUid)
    .where('status', '==', 'paid').get();
  if (paidCount.size >= REWARD_THRESHOLD) {
    await db.collection('users').doc(referrerUid).collection('referralReward').doc('current').set({
      earnedAt: Date.now(),
      redeemedUntil: Date.now() + 365 * 86400000,
      count: paidCount.size
    }, { merge: true });
    const all = await db.collection('referrals')
      .where('referrerUid', '==', referrerUid)
      .where('status', '==', 'paid').get();
    const batch = db.batch();
    all.docs.slice(0, REWARD_THRESHOLD).forEach(d => batch.update(d.ref, { status: 'rewarded', reward: 'plus_year' }));
    await batch.commit();
    console.log('[webhook] referral reward granted to', referrerUid);
  }
}

async function tryClawbackReferral(db, referredUid) {
  const snap = await db.collection('referrals')
    .where('referredUid', '==', referredUid)
    .where('status', 'in', ['paid', 'rewarded']).limit(1).get();
  if (snap.empty) return;
  const doc = snap.docs[0];
  const ageDays = (Date.now() - doc.data().activatedAt) / 86400000;
  if (ageDays > CLAWBACK_DAYS) return;
  await doc.ref.update({ status: 'clawback', clawbackAt: Date.now() });
  console.log('[webhook] referral clawback for', referredUid);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return RESPOND(405, 'method not allowed');

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) return RESPOND(400, 'missing stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return RESPOND(500, 'missing env: STRIPE_WEBHOOK_SECRET');

  const stripe = getStripe();
  let evt;
  try {
    // event.body is a string for Netlify Functions; constructEvent needs the raw body
    evt = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (e) {
    console.error('[webhook] signature verification failed:', e.message);
    return RESPOND(400, 'bad signature: ' + e.message);
  }

  const db = getFirestore();

  try {
    switch (evt.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubToFirestore(stripe, db, evt.data.object);
        // W6: on subscription deletion, attempt referral clawback if within 30d window
        if (evt.type === 'customer.subscription.deleted') {
          try {
            const sub = evt.data.object;
            const uid = (sub.metadata && sub.metadata.firebase_uid)
              || (await stripe.customers.retrieve(sub.customer)).metadata.firebase_uid;
            if (uid) await tryClawbackReferral(db, uid);
          } catch(e) { console.warn('[webhook] referral clawback failed:', e.message); }
        }
        break;
      }
      case 'checkout.session.completed': {
        // Initial checkout — fetch the subscription and sync
        const session = evt.data.object;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await syncSubToFirestore(stripe, db, sub);
        }
        break;
      }
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = evt.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await syncSubToFirestore(stripe, db, sub);

          // W6: on first successful payment, fire referral activation if this user was referred
          if (evt.type === 'invoice.payment_succeeded' && (invoice.billing_reason === 'subscription_create' || invoice.billing_reason === 'subscription_cycle')) {
            try {
              const uid = (sub.metadata && sub.metadata.firebase_uid)
                || (await stripe.customers.retrieve(sub.customer)).metadata.firebase_uid;
              if (uid) await tryActivateReferral(db, uid);
            } catch(e) { console.warn('[webhook] referral activation failed:', e.message); }
          }
        }
        break;
      }

      default:
        // Quietly ignore unhandled events (Stripe sends many)
        console.log('[webhook] ignored event:', evt.type);
    }
    return RESPOND(200, 'ok');
  } catch (e) {
    console.error('[webhook] handler error:', e.message);
    return RESPOND(500, 'handler error: ' + e.message);
  }
};
