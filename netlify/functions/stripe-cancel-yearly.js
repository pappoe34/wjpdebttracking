/**
 * POST /.netlify/functions/stripe-cancel-yearly
 *
 * Auth:    Bearer <Firebase ID token>
 * Body:    { confirm: true }
 * Returns: { ok, refundCents, usageFeeCents, fullCancellation, message }
 *
 * Cancels the user's yearly subscription mid-cycle and issues a prorated
 * refund of the unused months, less a 15% business usage fee (covering
 * payment processing, account servicing, and value already delivered),
 * capped at $25 USD. Yearly cancellations after 11 months of an annual term
 * are NOT refunded (full term consumed). Monthly subscriptions cancel at
 * period end with no refund (use Stripe Customer Portal for that).
 *
 * Refunds are issued to the original payment method within 7-10 business
 * days. We do NOT surface the refund estimate in the dashboard pre-cancel —
 * users contact support to request, which is a deliberate retention friction.
 */
const { verifyIdToken, getFirestore } = require('./_shared/firebase');
const { getStripe } = require('./_shared/stripe-client');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

const USAGE_FEE_PCT = 0.15;
const USAGE_FEE_CAP_CENTS = 2500; // $25.00

const ELEVEN_MONTHS_MS = 11 * 30 * 24 * 60 * 60 * 1000;

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
  if (body.confirm !== true) return json(400, { error: 'must include confirm:true' });

  try {
    const stripe = getStripe();
    const db = getFirestore();
    const subRef = db.collection('users').doc(user.uid).collection('billing').doc('subscription');
    const subSnap = await subRef.get();
    if (!subSnap.exists) return json(400, { error: 'no subscription on file' });
    const data = subSnap.data();
    const subId = data.stripeSubscriptionId;
    if (!subId) return json(400, { error: 'no stripe subscription id' });

    const sub = await stripe.subscriptions.retrieve(subId);
    const item = sub.items.data[0];
    const lookupKey = item && item.price && item.price.lookup_key;

    // Only yearly subs are eligible for prorated refund. Monthly cancels at period end.
    const isYearly = lookupKey && lookupKey.indexOf('_yearly') !== -1;

    if (!isYearly) {
      // Monthly: cancel at period end, no refund
      await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
      await subRef.set({
        cancelAtPeriodEnd: true,
        canceledAt: Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
      return json(200, {
        ok: true,
        refundCents: 0,
        usageFeeCents: 0,
        fullCancellation: false,
        message: 'Monthly subscription will end at the end of your current billing period. No refund issued.'
      });
    }

    // Yearly path
    const periodStart = (sub.current_period_start || 0) * 1000;
    const periodEnd = (sub.current_period_end || 0) * 1000;
    const totalMs = periodEnd - periodStart;
    const elapsedMs = Date.now() - periodStart;

    // 11+ months consumed → no refund
    if (elapsedMs >= ELEVEN_MONTHS_MS) {
      await stripe.subscriptions.cancel(subId);
      await subRef.set({
        canceledAt: Date.now(),
        status: 'canceled',
        tier: 'free',
        updatedAt: Date.now()
      }, { merge: true });
      return json(200, {
        ok: true,
        refundCents: 0,
        usageFeeCents: 0,
        fullCancellation: true,
        message: 'Subscription cancelled. Annual term has substantially completed; no refund issued per Terms.'
      });
    }

    // Find the most recent paid invoice for this subscription so we can refund it
    const invoices = await stripe.invoices.list({ subscription: subId, status: 'paid', limit: 5 });
    const annualInvoice = (invoices.data || []).find(inv =>
      inv.amount_paid > 0 &&
      inv.billing_reason && (inv.billing_reason === 'subscription_create' || inv.billing_reason === 'subscription_cycle')
    );

    if (!annualInvoice) {
      // No invoice to refund against — just cancel
      await stripe.subscriptions.cancel(subId);
      await subRef.set({
        canceledAt: Date.now(),
        status: 'canceled',
        tier: 'free',
        updatedAt: Date.now()
      }, { merge: true });
      return json(200, {
        ok: true,
        refundCents: 0,
        usageFeeCents: 0,
        fullCancellation: true,
        message: 'Subscription cancelled. No paid invoice found to refund against.'
      });
    }

    const totalPaidCents = annualInvoice.amount_paid;
    const unusedMs = Math.max(0, periodEnd - Date.now());
    const unusedFraction = totalMs > 0 ? unusedMs / totalMs : 0;
    const grossRefundCents = Math.round(totalPaidCents * unusedFraction);
    const usageFeeCents = Math.min(Math.round(grossRefundCents * USAGE_FEE_PCT), USAGE_FEE_CAP_CENTS);
    const netRefundCents = Math.max(0, grossRefundCents - usageFeeCents);

    // Issue refund and cancel the subscription
    let refundId = null;
    if (netRefundCents > 0 && annualInvoice.charge) {
      try {
        const refund = await stripe.refunds.create({
          charge: annualInvoice.charge,
          amount: netRefundCents,
          reason: 'requested_by_customer',
          metadata: {
            firebase_uid: user.uid,
            unusedFraction: unusedFraction.toFixed(4),
            usageFeeCents: String(usageFeeCents),
            grossRefundCents: String(grossRefundCents)
          }
        });
        refundId = refund.id;
      } catch (e) {
        console.error('[cancel-yearly] refund failed:', e.message);
        // Do NOT cancel if refund failed — leave for support to handle
        return json(500, { error: 'refund failed: ' + e.message });
      }
    }

    await stripe.subscriptions.cancel(subId);
    await subRef.set({
      canceledAt: Date.now(),
      status: 'canceled',
      tier: 'free',
      lastRefundCents: netRefundCents,
      lastRefundId: refundId,
      lastUsageFeeCents: usageFeeCents,
      updatedAt: Date.now()
    }, { merge: true });

    return json(200, {
      ok: true,
      refundCents: netRefundCents,
      usageFeeCents,
      fullCancellation: true,
      message: 'Yearly subscription cancelled. Prorated refund (less business usage fee) issued to your original payment method. Allow 7-10 business days.'
    });

  } catch (e) {
    console.error('[stripe-cancel-yearly] error:', e.message);
    return json(500, { error: e.message });
  }
};
