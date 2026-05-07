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
 *   customer.subscription.updated         — also catches trial → active transition
 *   customer.subscription.deleted
 *   customer.subscription.trial_will_end  — fires 3 days before trial ends → send reminder email
 *   invoice.payment_succeeded
 *   invoice.payment_failed
 *   checkout.session.completed            — handles both subscription + setup modes
 */
const { getStripe, tierFromLookupKey } = require('./_shared/stripe-client');
const { getFirestore } = require('./_shared/firebase');

let _resend = null;
function getResendSender() {
  if (_resend !== null) return _resend;
  try {
    _resend = require('./_shared/resend');
  } catch (_) {
    _resend = { sendEmail: null };
  }
  return _resend;
}

const RESPOND = (status, text) => ({ statusCode: status, headers: { 'Content-Type': 'text/plain' }, body: text });
const SITE = process.env.SITE_URL || 'https://wjpdebttracking.com';
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

async function syncSubToFirestore(stripe, db, sub) {
  let uid = sub.metadata && sub.metadata.firebase_uid;
  if (!uid) {
    const cust = await stripe.customers.retrieve(sub.customer);
    uid = cust && cust.metadata && cust.metadata.firebase_uid;
  }
  if (!uid) {
    console.warn('[webhook] no firebase_uid for subscription', sub.id);
    return;
  }

  const item = sub.items && sub.items.data && sub.items.data[0];
  const lookupKey = item && item.price && item.price.lookup_key;
  const tier = sub.status === 'canceled' ? 'free' : tierFromLookupKey(lookupKey);
  const intendedTier = (sub.metadata && sub.metadata.intended_tier) || tier;

  const data = {
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    tier,
    intendedTier,
    status: sub.status,
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
  return uid;
}

// Free-pick path — checkout.session.completed in `setup` mode. We mark the
// user's Firestore as trialing, with trialEnd = +14 days. After the trial,
// the user lands on Free tier (no Stripe subscription, no auto-charge).
async function handleSetupCompleted(db, session) {
  const uid = session.client_reference_id || (session.metadata && session.metadata.firebase_uid);
  if (!uid) {
    console.warn('[webhook] setup session has no uid', session.id);
    return;
  }
  const subRef = db.collection('users').doc(uid).collection('billing').doc('subscription');
  await subRef.set({
    stripeCustomerId: session.customer || null,
    stripeSetupIntentId: session.setup_intent || null,
    tier: 'free',
    intendedTier: 'free',
    intendedCycle: 'monthly',
    status: 'trialing',
    trialEnd: Date.now() + FOURTEEN_DAYS_MS,
    trialingUntil: Date.now() + FOURTEEN_DAYS_MS,
    updatedAt: Date.now(),
  }, { merge: true });
  console.log('[webhook] free_setup completed for uid', uid);
}

// 3-day-before reminder email — fires on customer.subscription.trial_will_end.
// Stripe sends this exactly 3 days before trial_end.
async function sendTrialEndReminder(stripe, db, sub) {
  const { sendEmail } = getResendSender();
  if (!sendEmail) {
    console.warn('[webhook] resend sendEmail not available; skipping trial reminder');
    return;
  }
  const uid = (sub.metadata && sub.metadata.firebase_uid)
    || ((await stripe.customers.retrieve(sub.customer)).metadata.firebase_uid);
  if (!uid) return;

  // Get user email
  const userDoc = await db.collection('users').doc(uid).get();
  const profile = userDoc.exists ? userDoc.data() : {};
  const email = profile.email;
  if (!email) {
    console.warn('[webhook] no email on file for uid', uid);
    return;
  }

  const item = sub.items && sub.items.data && sub.items.data[0];
  const lookupKey = item && item.price && item.price.lookup_key;
  const intendedTier = (sub.metadata && sub.metadata.intended_tier) || tierFromLookupKey(lookupKey);
  const trialEndDate = new Date((sub.trial_end || 0) * 1000);
  const trialEndStr = trialEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Determine post-trial price + label
  let priceLabel = '$0';
  let cycleLabel = '';
  if (lookupKey === 'pro_monthly')  { priceLabel = '$11.99'; cycleLabel = '/month'; }
  if (lookupKey === 'pro_yearly')   { priceLabel = '$99';    cycleLabel = '/year'; }
  if (lookupKey === 'plus_monthly') { priceLabel = '$24.99'; cycleLabel = '/month'; }
  if (lookupKey === 'plus_yearly')  { priceLabel = '$199';   cycleLabel = '/year'; }

  const tierLabel = intendedTier === 'plus' ? 'Pro Plus' : intendedTier === 'pro' ? 'Pro' : 'Free';
  const subject = `Your Pro Plus trial ends ${trialEndStr} — ${tierLabel} kicks in next`;

  const html = `
<!DOCTYPE html>
<html><body style="font-family:Inter,system-ui,sans-serif;background:#f7f6f2;padding:32px 16px;color:#141414;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#c99a2a;font-weight:800;margin-bottom:8px;">Trial ending soon</div>
    <h1 style="font-family:Fraunces,Georgia,serif;font-size:26px;letter-spacing:-0.02em;margin:0 0 12px;line-height:1.2;">3 days left at Pro Plus.</h1>
    <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 16px;">Your free 14-day Pro Plus trial ends on <b>${trialEndStr}</b>. Here&rsquo;s what happens next:</p>
    <div style="background:#fbf9f4;border-left:3px solid #1f7a4a;border-radius:8px;padding:14px 18px;margin:20px 0;">
      <div style="font-size:11.5px;letter-spacing:0.08em;text-transform:uppercase;color:#1f7a4a;font-weight:800;margin-bottom:6px;">Day 15 (${trialEndStr})</div>
      <div style="font-size:15px;color:#141414;line-height:1.5;">Your account drops to <b>${tierLabel}</b>${priceLabel !== '$0' ? ` — ${priceLabel}${cycleLabel}` : ''}.</div>
    </div>
    <p style="font-size:14.5px;line-height:1.55;color:#444;margin:0 0 16px;">Want to keep Pro Plus? You can switch any time before the trial ends:</p>
    <p style="margin:0 0 24px;"><a href="${SITE}/index.html#settings/billing" style="display:inline-block;background:#1f7a4a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:14px;">Manage my plan &rarr;</a></p>
    <p style="font-size:13px;line-height:1.55;color:#6b7280;margin:0;">Questions? Reply to this email — it goes straight to a real person.</p>
    <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:11px;color:#9ca3af;margin:0;">WJP Debt Tracking &middot; <a href="${SITE}" style="color:#9ca3af;">wjpdebttracking.com</a></p>
  </div>
</body></html>`;

  const text = `Your free 14-day Pro Plus trial ends ${trialEndStr}.

On day 15 your account drops to ${tierLabel}${priceLabel !== '$0' ? ` (${priceLabel}${cycleLabel})` : ''}.

Manage your plan: ${SITE}/index.html#settings/billing

Questions? Just reply.
— WJP Debt Tracking`;

  try {
    await sendEmail({
      to: email,
      subject,
      html,
      text,
      from: 'WJP <hello@wjpdebttracking.com>',
      replyTo: 'support@wjpdebttracking.com',
      tags: ['trial-end-reminder', 'tier:' + intendedTier]
    });
    console.log('[webhook] trial-end reminder sent to', email);
    // Persist that we sent it so we don't double-send
    await db.collection('users').doc(uid).collection('email_sequence').doc('trial_end_reminder').set({
      sentAt: Date.now(),
      trialEnd: sub.trial_end ? sub.trial_end * 1000 : null
    }, { merge: true });
  } catch (e) {
    console.error('[webhook] trial reminder send failed:', e.message);
  }
}

// W6 — Referral activation/clawback helpers
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
      case 'customer.subscription.trial_will_end': {
        // Stripe fires this 3 days before trial_end
        await sendTrialEndReminder(stripe, db, evt.data.object);
        break;
      }
      case 'checkout.session.completed': {
        const session = evt.data.object;
        if (session.mode === 'setup') {
          // Free-pick flow — collect card, no subscription
          await handleSetupCompleted(db, session);
        } else if (session.subscription) {
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
        console.log('[webhook] ignored event:', evt.type);
    }
    return RESPOND(200, 'ok');
  } catch (e) {
    console.error('[webhook] handler error:', e.message);
    return RESPOND(500, 'handler error: ' + e.message);
  }
};
