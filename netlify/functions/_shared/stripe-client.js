/**
 * Stripe client singleton.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY        — sk_test_... in test, sk_live_... in production
 *   STRIPE_WEBHOOK_SECRET    — whsec_... (set after creating webhook endpoint)
 *
 * Lookup keys for the prices we sell:
 *   pro_monthly      $11.99/mo   prod WJP Pro       — 14-day Pro Plus trial
 *   pro_yearly       $99.00/yr   prod WJP Pro       — 14-day Pro Plus trial
 *   plus_monthly     $24.99/mo   prod WJP Pro Plus  — 14-day Pro Plus trial
 *   plus_yearly      $199.00/yr  prod WJP Pro Plus  — 14-day Pro Plus trial
 *
 * Special pseudo-key:
 *   free_setup       no subscription. Stripe Checkout in `setup` mode just to
 *                    collect a card on file. Frontend lands on Free tier after
 *                    a Firestore-tracked 14-day trial period.
 *
 * Optional env vars (welcome-back discount):
 *   STRIPE_WELCOME_BACK_COUPON  — coupon ID (~20% off first month) auto-applied
 *                                 on Stripe Checkout for users whose previous
 *                                 subscription was canceled >30 days ago.
 */
const Stripe = require('stripe');

let _client = null;
function getStripe() {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('missing env var: STRIPE_SECRET_KEY');
  _client = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return _client;
}

// Map lookup keys → tier + trial config. All paid tiers now get 14-day trials
// regardless of plan picked at signup, so users get full Pro Plus access during
// the trial then drop to their chosen tier at day 15.
const PRICE_CONFIG = {
  pro_monthly:  { tier: 'pro',  interval: 'month', trialDays: 14, mode: 'subscription' },
  pro_yearly:   { tier: 'pro',  interval: 'year',  trialDays: 14, mode: 'subscription' },
  plus_monthly: { tier: 'plus', interval: 'month', trialDays: 14, mode: 'subscription' },
  plus_yearly:  { tier: 'plus', interval: 'year',  trialDays: 14, mode: 'subscription' },
  // Free pick — collect card via SetupIntent, no subscription. Frontend trial
  // is tracked via Firestore field `trialingUntil` set by the webhook.
  free_setup:   { tier: 'free', interval: null,    trialDays: 14, mode: 'setup' },
};

function tierFromLookupKey(key) {
  return (PRICE_CONFIG[key] && PRICE_CONFIG[key].tier) || 'free';
}

async function getPriceIdForLookup(stripe, lookupKey) {
  const list = await stripe.prices.list({
    lookup_keys: [lookupKey],
    expand: ['data.product'],
    active: true,
    limit: 1,
  });
  if (!list.data.length) throw new Error('no active price found for lookup_key: ' + lookupKey);
  return list.data[0].id;
}

module.exports = { getStripe, PRICE_CONFIG, tierFromLookupKey, getPriceIdForLookup };
