# Path A — Array.io Credit Score Integration: Setup Guide

Goal: pull FICO 8 scores from all 3 bureaus (Equifax / Experian / TransUnion) once a month for Pro-tier users, automatically.

The frontend scaffolding (`wjp-credit-pull.js`) is shipped. The piece that still needs your action is:
1. An **Array.io account** with API access
2. A **backend service** (Firebase Cloud Function) that calls Array's API and writes results to the user's Firestore document

This doc walks both.

---

## 1. Array.io account setup (do this first — takes 1-3 weeks)

### Step 1 — Apply at https://array.io
- Go to https://array.io/products/financial-services
- Click "Get in touch" or "Schedule a demo"
- Fill out the contact form with:
  - Company name: WJP Debt Tracking
  - Use case: "Consumer-facing personal finance app — show users their FICO 8 score with monthly auto-refresh as part of debt payoff plan."
  - Estimated user volume: start with 100 / scale to 10K+ by year 1
  - Compliance: SOC 2 type II equivalent, FCRA-compliant data handling

### Step 2 — KYC & intended-use letter
Array's compliance team will email you within 48h. They need:
- Articles of incorporation / EIN
- Privacy policy (link to your existing one)
- Terms of service (FCRA permissible-purpose language)
- Sample app screenshots showing where score will display

### Step 3 — Sandbox access
Once approved, you'll get:
- API key (test + prod)
- Webhook secret
- Endpoint base URL (e.g., `https://api.array.io/v2/`)

### Step 4 — Sign master agreement + pricing
- Typical pricing: ~$0.10–$0.30 per monthly pull at low volume
- Bulk discount tiers kick in around 1K users
- Minimums vary

---

## 2. Backend Cloud Function (deploy after Array approval)

Drop this in your Firebase project at `functions/index.js`. Requires `firebase-admin`, `node-fetch`.

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

const ARRAY_API_KEY = functions.config().array.api_key;     // set: firebase functions:config:set array.api_key="..."
const ARRAY_BASE    = functions.config().array.base_url || 'https://api.array.io/v2';

// Called from the frontend when user clicks "Refresh now"
exports.refreshCreditScore = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Auth required');

  const uid = context.auth.uid;
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const user = userSnap.exists ? userSnap.data() : {};

  // Tier gating — must be Pro/Pro-Plus
  const tier = user.subscription?.tier;
  if (!tier || tier === 'free') {
    throw new functions.https.HttpsError('permission-denied', 'Pro tier required for auto credit pull');
  }

  // Pull rate limit — once per 24h for safety
  const lastPull = user.lastCreditPullAt || 0;
  if (Date.now() - lastPull < 24 * 3600 * 1000 && !data.force) {
    throw new functions.https.HttpsError('resource-exhausted', 'Wait 24h between pulls');
  }

  // Required identity fields (user must have completed KYC step in app)
  const id = user.creditIdentity;
  if (!id?.ssn || !id?.dob || !id?.firstName || !id?.lastName || !id?.zipCode) {
    throw new functions.https.HttpsError('failed-precondition', 'Identity verification required — complete profile first');
  }

  // Call Array
  const arrayRes = await fetch(`${ARRAY_BASE}/credit-reports`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ARRAY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      consumer: {
        first_name: id.firstName,
        last_name: id.lastName,
        date_of_birth: id.dob,
        ssn: id.ssn,                                       // FULL SSN required for credit pull
        address: {
          line1: id.address1,
          line2: id.address2 || '',
          city: id.city,
          state: id.state,
          zip: id.zipCode
        }
      },
      bureaus: ['equifax', 'experian', 'transunion'],
      product: 'soft_pull',                                 // doesn't affect score
      pull_type: 'fico8'
    })
  });

  if (!arrayRes.ok) {
    const txt = await arrayRes.text();
    console.error('Array API error', arrayRes.status, txt);
    throw new functions.https.HttpsError('internal', 'Array pull failed: ' + arrayRes.status);
  }

  const result = await arrayRes.json();
  // Expected shape (verify against Array docs once you have access):
  // { reports: { equifax: { fico8: 720, ... }, experian: { fico8: 715 }, transunion: { fico8: 718 } } }

  const scores = {
    fico8:      result.reports?.equifax?.fico8 || result.reports?.experian?.fico8 || result.reports?.transunion?.fico8,
    equifax:    result.reports?.equifax?.fico8,
    experian:   result.reports?.experian?.fico8,
    transunion: result.reports?.transunion?.fico8,
    pulledAt:   Date.now()
  };

  // Write to user doc
  await userRef.set({
    creditScores: scores,
    lastCreditPullAt: Date.now(),
    creditScoreHistory: admin.firestore.FieldValue.arrayUnion({
      ts: Date.now(),
      ...scores
    })
  }, { merge: true });

  return { ok: true, scores };
});


// Scheduled monthly auto-pull for all Pro users with autopull enabled
exports.scheduledCreditPulls = functions.pubsub.schedule('every day 06:00').onRun(async () => {
  const candidates = await db.collection('users')
    .where('subscription.tier', 'in', ['pro', 'pro-plus', 'admin'])
    .where('creditAutoPull.enabled', '==', true)
    .get();

  const now = Date.now();
  const results = [];

  for (const doc of candidates.docs) {
    const u = doc.data();
    const cadence = u.creditAutoPull?.cadence || 'monthly';
    const interval = cadence === 'weekly' ? 7 * 86400000 : 30 * 86400000;
    if ((u.lastCreditPullAt || 0) + interval > now) continue;

    try {
      // Reuse the inner pull logic (extract to helper for cleanliness)
      // ... call Array, write to doc
      results.push({ uid: doc.id, ok: true });
    } catch (e) {
      results.push({ uid: doc.id, ok: false, err: e.message });
    }
  }

  console.log('Daily credit pull batch:', results.length, 'users');
  return null;
});
```

### Deploy

```bash
cd functions
npm install firebase-admin firebase-functions node-fetch
firebase functions:config:set array.api_key="YOUR_KEY" array.base_url="https://api.array.io/v2"
firebase deploy --only functions
```

---

## 3. Frontend hookup (one line change)

Once your Cloud Function `refreshCreditScore` is deployed, in `wjp-credit-pull.js` swap the placeholder with a real call:

```javascript
// In window.WJP_CreditPull.setBackend() OR directly:
window.WJP_CreditPull.fetchScoresFromBackend = async (uid) => {
  try {
    const fn = firebase.functions().httpsCallable('refreshCreditScore');
    const result = await fn({});
    return { ok: true, scores: result.data.scores };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};
```

You can call this from `index.html` after Firebase init, or from a separate `wjp-credit-pull-prod.js` file.

---

## 4. Identity collection flow (required for first pull)

Before the first pull, users need to provide identity:
- Full legal name
- DOB
- SSN (encrypted at rest, never sent client-side, only in the Cloud Function)
- Current address

Build this as a one-time onboarding modal when Pro user enables auto-pull for the first time. Store under `users/{uid}.creditIdentity` (encrypted with KMS or end-to-end with the user's own key).

**Critical:** SSN must never be stored client-side. Collect it via a server-side encrypted form. Best pattern: use Firebase Functions + Firestore field-level encryption, OR offload identity verification entirely to Persona (https://withpersona.com) which handles KYC + returns a token you pass to Array.

---

## 5. Compliance checklist

- [ ] Privacy policy mentions credit data collection + retention
- [ ] Terms of service has FCRA permissible-purpose language
- [ ] SSN encrypted at rest (KMS or equivalent)
- [ ] Audit log on every pull (who, when, why)
- [ ] User can revoke and delete credit data on demand
- [ ] Soft pulls only (never hard pull from this product)
- [ ] Retention: max 7 years per FCRA

---

## Timeline estimate

- Week 1: Apply to Array, get sandbox
- Week 1-2: Wait for compliance review, sign agreement
- Week 2-3: Build Cloud Function + identity flow
- Week 3-4: Internal testing in sandbox
- Week 4: Switch to production, soft launch to admin tier
- Week 5+: Roll out to Pro users

---

## Alternatives if Array is slow

- **Persona + manual entry** — Persona does KYC, you still pull scores manually (cheaper to test)
- **Plaid Check** — newer Plaid product, single integration if already on Plaid (worth applying in parallel)
- **Experian Connect** — direct from bureau, higher price but bigger brand recognition
