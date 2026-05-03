/**
 * Stripe client singleton.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY        — sk_test_... in test, sk_live_... in production
 *   STRIPE_WEBHOOK_SECRET    — whsec_... (set after creating webhook endpoint)
 *
 * Lookup keys for the 4 prices we sell:
 *   pro_monthly      $11.99/mo   prod WJP Pro
 *   pro_yearly       $99.00/yr   prod WJP Pro
 *   plus_monthly     $24.99/mo   prod WJP Pro Plus
 *   plus_yearly      $199.00/yr  prod WJP Pro Plus
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

// Map lookup keys → tier + trial config
const PRICE_CONFIG = {
  pro_monthly:  { tier: 'pro',  interval: 'month', trialDays: 14 },
  pro_yearly:   { tier: 'pro',  interval: 'year',  trialDays: 14 },
  plus_monthly: { tier: 'plus', interval: 'month', trialDays: 0  },
  plus_yearly:  { tier: 'plus', interval: 'year',  trialDays: 0  },
};

function tierFromLookupKey(key) {
  return (PRICE_CONFIG[key] && PRICE_CONFIG[key].tier) || 'free';
}

async function getPriceIdForLookup(stripe, lookupKey) {
  // Stripe lets us fetch prices by lookup_key — no need to hardcode IDs.
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
