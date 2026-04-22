// POST /.netlify/functions/plaid-webhook
//
// Receives Plaid webhook notifications. We don't run the matching logic
// server-side (lives in app.js) — instead we drop a "pendingSync" marker on
// the user's plaid_items doc and let the frontend Firestore listener trigger
// a syncBankTransactions on the next page open / poll cycle.
//
// Webhook codes we care about:
//   TRANSACTIONS:SYNC_UPDATES_AVAILABLE  — new txs available via /transactions/sync
//   TRANSACTIONS:DEFAULT_UPDATE          — legacy /transactions/get path; bump anyway
//   TRANSACTIONS:HISTORICAL_UPDATE       — initial backfill done; first sync should now work
//   TRANSACTIONS:RECURRING_TRANSACTIONS_UPDATE — recurring streams changed; refresh tags
//   ITEM:ERROR / ITEM:LOGIN_REPAIRED     — flag for the UI to nudge the user
//   ITEM:WEBHOOK_UPDATE_ACKNOWLEDGED     — no-op confirmation
//
// Verification: Plaid signs every webhook with a JWT in the Plaid-Verification
// header. We verify with the JWT keyset from /webhook_verification_key/get.
// In dev, set PLAID_WEBHOOK_VERIFY=skip to bypass (NEVER do this in prod).

const crypto = require('crypto');
const jose = require('jose');
const { getFirestore, getFirebaseAdmin } = require('./_shared/firebase');
const { getPlaidClient, getPlaidEnv } = require('./_shared/plaid');

// In production we skip the plaid_webhook_diag writes (3 Firestore writes per
// webhook) — they're a sandbox debugging aid only.
const DIAG_ENABLED = getPlaidEnv() === 'sandbox';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Plaid-Verification',
  'Content-Type': 'application/json'
};

// In-memory cache of Plaid's JWT verification keys, keyed by `kid`.
// Keys rotate but rarely — caching cuts a Plaid roundtrip off every webhook.
const KEY_CACHE = new Map();

async function getPlaidKey(kid) {
  if (KEY_CACHE.has(kid)) return KEY_CACHE.get(kid);
  const plaid = getPlaidClient();
  const resp = await plaid.webhookVerificationKeyGet({ key_id: kid });
  const key = resp && resp.data && resp.data.key;
  if (!key) throw new Error('no verification key for kid ' + kid);
  KEY_CACHE.set(kid, key);
  return key;
}

async function verifyWebhook(headers, rawBody) {
  if (process.env.PLAID_WEBHOOK_VERIFY === 'skip') return true;
  const jwtHeader = headers['plaid-verification'] || headers['Plaid-Verification'];
  if (!jwtHeader) throw new Error('missing Plaid-Verification header');

  // Decode the JWT header to grab `kid` without trusting the signature yet.
  const decoded = jose.decodeProtectedHeader(jwtHeader);
  if (!decoded || !decoded.kid) throw new Error('JWT missing kid');
  if (decoded.alg !== 'ES256') throw new Error('unexpected JWT alg: ' + decoded.alg);

  const key = await getPlaidKey(decoded.kid);
  const publicKey = await jose.importJWK(key, 'ES256');
  const { payload } = await jose.jwtVerify(jwtHeader, publicKey, { algorithms: ['ES256'] });

  // Body integrity: Plaid puts a SHA-256 of the request body in the JWT claim.
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  if (payload.request_body_sha256 !== bodyHash) {
    throw new Error('body hash mismatch');
  }
  // Reject very old webhooks (replay protection).
  const issuedAt = Number(payload.iat || 0) * 1000;
  if (!issuedAt || Date.now() - issuedAt > 5 * 60 * 1000) {
    throw new Error('webhook too old');
  }
  return true;
}

async function findUidForItem(db, itemId) {
  // Fast path: top-level mapping written at exchange-public-token time.
  try {
    const mapDoc = await db.collection('plaid_item_owners').doc(itemId).get();
    if (mapDoc.exists) {
      const d = mapDoc.data() || {};
      if (d.uid) return d.uid;
    }
  } catch (e) {
    console.warn('plaid_item_owners lookup failed', e.message);
  }
  // Slow fallback: collectionGroup query across users/*/plaid_items/{itemId}.
  try {
    const cg = await db.collectionGroup('plaid_items').where('__name__', '!=', '').get();
    for (const doc of cg.docs) {
      if (doc.id === itemId) {
        // path: users/{uid}/plaid_items/{itemId}
        const parts = doc.ref.path.split('/');
        const uid = parts[1];
        return uid || null;
      }
    }
  } catch (e) {
    console.warn('collectionGroup fallback failed', e.message);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const rawBody = event.body || '';
  const headers = event.headers || {};

  // Diagnostic: stamp arrival on a global doc BEFORE verification, so we can
  // distinguish "Plaid never delivered" from "we received but failed verify".
  // Sandbox-only — skipped in production to save Firestore writes and avoid
  // metadata exposure on a globally-readable doc.
  if (DIAG_ENABLED) {
    try {
      const dbDiag = getFirestore();
      const adminDiag = getFirebaseAdmin();
      let parsedItemIdForDiag = null;
      try {
        const p = JSON.parse(rawBody);
        parsedItemIdForDiag = p && p.item_id ? String(p.item_id) : null;
      } catch (_) {}
      await dbDiag.collection('plaid_webhook_diag').doc('latest').set({
        receivedAt: adminDiag.firestore.FieldValue.serverTimestamp(),
        itemId: parsedItemIdForDiag,
        hasVerificationHeader: !!(headers['plaid-verification'] || headers['Plaid-Verification']),
        bodyLen: rawBody.length
      }, { merge: true });
    } catch (e) {
      console.warn('webhook diag write failed', e.message);
    }
  }

  try {
    await verifyWebhook(headers, rawBody);
  } catch (e) {
    console.error('webhook verification failed:', e.message);
    // Stamp the failure on the diag doc so we can see it from the browser.
    if (DIAG_ENABLED) {
      try {
        const dbDiag = getFirestore();
        const adminDiag = getFirebaseAdmin();
        await dbDiag.collection('plaid_webhook_diag').doc('latest').set({
          lastVerifyError: e.message,
          lastVerifyErrorAt: adminDiag.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (_) {}
    }
    // Always return 200 to Plaid even on verification failure so they don't
    // back off + retry storm; just log it.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'verify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'json' }) };
  }

  const webhookType = payload.webhook_type || '';
  const webhookCode = payload.webhook_code || '';
  const itemId = payload.item_id;
  if (!itemId) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, reason: 'no item_id' }) };
  }

  const db = getFirestore();
  const admin = getFirebaseAdmin();
  const uid = await findUidForItem(db, itemId);
  // Diagnostic: record uid resolution outcome (sandbox only).
  if (DIAG_ENABLED) {
    try {
      await db.collection('plaid_webhook_diag').doc('latest').set({
        verifyOk: true,
        parsedWebhookType: webhookType,
        parsedWebhookCode: webhookCode,
        resolvedUid: uid || null,
        resolvedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (_) {}
  }
  if (!uid) {
    console.warn('webhook for unknown item', itemId, webhookType, webhookCode);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, reason: 'unknown item' }) };
  }

  const itemRef = db.collection('users').doc(uid).collection('plaid_items').doc(itemId);
  const update = {
    lastWebhookType: webhookType,
    lastWebhookCode: webhookCode,
    lastWebhookAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Translate Plaid codes into client-actionable flags. The frontend listens
  // for these and triggers the matching sync — we keep all matching/decrement
  // logic in the browser to avoid duplicating it server-side.
  if (webhookType === 'TRANSACTIONS') {
    if (webhookCode === 'SYNC_UPDATES_AVAILABLE' ||
        webhookCode === 'DEFAULT_UPDATE' ||
        webhookCode === 'HISTORICAL_UPDATE' ||
        webhookCode === 'INITIAL_UPDATE') {
      update.txPendingSync = true;
      update.txPendingSyncAt = admin.firestore.FieldValue.serverTimestamp();
      // new_transactions / removed counts are advisory; surface for debugging.
      if (typeof payload.new_transactions === 'number') update.lastNewTxCount = payload.new_transactions;
    } else if (webhookCode === 'RECURRING_TRANSACTIONS_UPDATE') {
      update.recurringPendingSync = true;
      update.recurringPendingSyncAt = admin.firestore.FieldValue.serverTimestamp();
    } else if (webhookCode === 'TRANSACTIONS_REMOVED') {
      update.txPendingSync = true;
      update.txPendingSyncAt = admin.firestore.FieldValue.serverTimestamp();
    }
  } else if (webhookType === 'ITEM') {
    if (webhookCode === 'ERROR') {
      update.itemError = (payload.error && payload.error.error_code) || 'unknown';
      update.itemErrorMessage = (payload.error && payload.error.error_message) || null;
    } else if (webhookCode === 'LOGIN_REPAIRED' || webhookCode === 'PENDING_EXPIRATION_RESOLVED') {
      update.itemError = admin.firestore.FieldValue.delete();
      update.itemErrorMessage = admin.firestore.FieldValue.delete();
    } else if (webhookCode === 'PENDING_EXPIRATION') {
      update.itemError = 'PENDING_EXPIRATION';
      update.itemErrorMessage = 'Re-authentication required soon';
    }
  }

  try {
    await itemRef.set(update, { merge: true });
  } catch (e) {
    console.error('webhook firestore write failed', e.message);
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
