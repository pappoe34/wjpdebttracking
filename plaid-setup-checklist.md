# WJP Debt Tracking — Plaid + Firebase Backend Setup

One-pager for Winston. Follow in order. Total time ~15 min.

---

## 1. Plaid sandbox account (5 min)

1. Go to https://dashboard.plaid.com/signup and create a free developer account.
2. After email verification you land in the Plaid dashboard. You start in **Sandbox** automatically — no credit card needed.
3. In the left nav click **Team Settings → Keys**.
4. Copy these two values — you'll paste them into Netlify in step 4:
   - `client_id` → becomes env var `PLAID_CLIENT_ID`
   - `Sandbox` secret → becomes env var `PLAID_SANDBOX_SECRET`

> Do not use the `Development` or `Production` secret. Sandbox only, for now.

---

## 2. Enable Firestore (2 min)

1. Go to https://console.firebase.google.com → select the **wjp-debt-tracking** project.
2. Left nav → **Build → Firestore Database**.
3. Click **Create database**.
4. Choose **Start in production mode** (we secure by server-only access via Admin SDK).
5. Pick a region (`us-central1` is fine).
6. Click **Enable**. Wait ~30 seconds for provisioning.

No client-side rules needed — all writes go through the Netlify Functions using the Firebase Admin SDK, which bypasses security rules.

---

## 3. Firebase service account JSON (3 min)

1. Same Firebase Console → **Project settings** (gear icon top-left) → **Service accounts** tab.
2. Language: **Node.js** is fine. Click **Generate new private key**. Confirm the download.
3. A `.json` file downloads — open it in a text editor.
4. **Copy the entire contents** (the whole JSON blob, `{ ... }`). This becomes env var `FIREBASE_SERVICE_ACCOUNT_JSON`.

> Keep this file safe. Do NOT commit it. After pasting into Netlify you can delete the local copy.

---

## 4. Add 3 env vars to Netlify (2 min)

1. Go to https://app.netlify.com → your WJP site → **Site configuration → Environment variables**.
2. Click **Add a variable** three times — **Add a single value** scope, all deploy contexts:

| Key | Value |
|---|---|
| `PLAID_CLIENT_ID` | (from step 1) |
| `PLAID_SANDBOX_SECRET` | (from step 1) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | (paste the full JSON blob from step 3, as one line — Netlify accepts multiline too) |

3. Save.

---

## 5. Trigger a redeploy (1 min)

Env var changes do **not** auto-redeploy. You must kick one off manually:

1. Netlify → **Deploys** tab → **Trigger deploy → Deploy site**.
2. Wait for the deploy to go green (~1–2 min).
3. First deploy also installs the function dependencies (`plaid`, `firebase-admin`) — watch the deploy log to confirm the functions bundle without errors.

---

## 6. Test in Sandbox (2 min)

1. Open the live site, sign in with your normal Firebase account.
2. Click the **+ Add** button → **Link a bank**.
3. Plaid Link opens — pick any bank (e.g., **Chase**, or search for **Tartan Bank** — Plaid's fake sandbox institution).
4. On the login screen enter:
   - Username: `user_good`
   - Password: `pass_good`
5. If MFA is prompted: code is `1234`.
6. Select one or more accounts → **Continue**.
7. Plaid Link closes, toast says "Accounts synced." The linked accounts appear as obligation cards with real balances.

**What to check on a linked card:**
- Three-dot menu shows: **Rename · Refresh from bank · Attach statement · Unlink bank** (not the usual Update balance / Delete).
- "Refresh from bank" re-pulls balances immediately.
- "Unlink bank" calls Plaid `itemRemove` + deletes all accounts from that institution.

---

## Troubleshooting

- **"Bank sync isn't configured yet — see setup guide."** → one of the 3 env vars is missing or you skipped the redeploy (step 5).
- **401 from functions** → user not signed in to Firebase, or the ID token expired. Sign out + back in.
- **Plaid Link won't open** → check the browser console. The `link-initialize.js` CDN script may be blocked by an ad blocker.
- **Firestore permission errors** → confirm Firestore was actually enabled (step 2). Admin SDK bypasses rules but the database must exist.

---

## What's where in the repo

```
_deploy/
  netlify.toml                          ← tells Netlify where functions live
  netlify/functions/
    package.json                        ← plaid + firebase-admin deps
    _shared/firebase.js                 ← Firebase Admin + token verification
    _shared/plaid.js                    ← Plaid sandbox client
    create-link-token.js                ← POST, returns link_token
    exchange-public-token.js            ← POST, stores access_token in Firestore
    get-accounts.js                     ← GET, returns balances + liabilities
    get-transactions.js                 ← GET, last 30 days of transactions
    unlink-item.js                      ← POST, removes item + Firestore doc
  app.js                                ← openPlaidLink, refreshLinkedAccounts,
                                          refreshFromBank, unlinkPlaidItem
  index.html                            ← <script src=".../link-initialize.js">
```

Firestore layout:
```
users/{uid}/plaid_items/{itemId} = {
  access_token,         ← NEVER exposed to the browser
  institutionName,
  accounts: [...],      ← metadata from Plaid Link onSuccess
  createdAt
}
```

---

## Moving to production

Code-side prep is already done — production cutover is now a sequence of dashboard + env var steps. No code edits required for the env switch.

### Step 1 — Request Plaid Production access (DAY 0, you do this)

1. Go to https://dashboard.plaid.com → top-right environment switcher.
2. Click **Request Production access**.
3. Fill out the application: company info, use case ("personal debt tracking, transactions read-only, no money movement"), expected volumes, privacy policy URL.
4. Submit. Plaid review takes ~1 business day. They may email follow-up questions — answer fast to keep the timer short.

### Step 2 — Once Plaid approves (DAY ~1)

1. Plaid dashboard → **Team Settings → Keys** → copy the **Production** secret.
2. Netlify → **Site configuration → Environment variables** → add:
   - `PLAID_PROD_SECRET` = (the new production secret)
   - `PLAID_ENV` = `production`
3. (Optional but recommended) Add `ALLOWED_ORIGIN` = `https://wjpdebttracking.com` so the CORS helper has an allowlist instead of `*`.
4. Trigger a redeploy: Netlify → **Deploys → Trigger deploy → Deploy site**.

### Step 3 — Verify the environment flip (5 min)

1. Open https://wjpdebttracking.com in an incognito window. Sign in.
2. Open the browser console and run:
   ```js
   (async () => {
     const u = window.__wjpUser;
     const t = await u.getIdToken(true);
     const r = await fetch('/.netlify/functions/fire-sandbox-webhook', {
       method: 'POST',
       headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
       body: '{}'
     });
     return { status: r.status, body: await r.text() };
   })()
   ```
   Expected: **403** with body `"sandbox-only endpoint disabled in PLAID_ENV=production"`. This confirms env switch took effect AND the diagnostic endpoint is correctly gated.
3. (Optional cleanup) Once verified, delete `fire-sandbox-webhook.js` and `debug-item-state.js` files entirely so they're not even shipped — see task #37.

### Step 4 — Re-link a real bank (10 min)

Sandbox Items don't carry over to production — they live in different Plaid environments. You'll need to re-link.

1. In the app, unlink each existing sandbox-linked institution (three-dot menu → **Unlink bank**).
2. Click **+ Add → Link a bank** → pick your real bank. Plaid Link now talks to live banks.
3. Use your actual online-banking credentials.
4. Confirm the obligation cards populate with real balances.

### Step 5 — Real webhook proof

1. Wait for a real transaction to post on one of your linked accounts (or trigger one — pay a small bill).
2. Within a few minutes, confirm the app picks it up automatically (auto-payment matching decrements the debt balance, activity log entry appears).

### Pre-production checklist

Before flipping `PLAID_ENV=production`, confirm:

- [ ] `PLAID_PROD_SECRET` set in Netlify
- [ ] `PLAID_ENV=production` set in Netlify
- [ ] `PLAID_WEBHOOK_URL` set (or let it auto-resolve from `URL`)
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` is the prod Firebase project's key (not a sandbox one)
- [ ] App deployed against `main` and green on Netlify
- [ ] You have a known-good rollback: previous deploy ID noted, can re-publish in one click

### Rollback

If anything goes wrong, the rollback is fast:
1. Netlify → **Deploys** → find the last sandbox-era deploy → **Publish deploy**.
2. OR set `PLAID_ENV=sandbox` and trigger redeploy. Sandbox secret is still in env vars — nothing else needs to change.
