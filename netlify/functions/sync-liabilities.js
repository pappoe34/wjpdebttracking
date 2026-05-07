// POST /.netlify/functions/sync-liabilities
// Headers: Authorization: Bearer <Firebase ID token>
// Body: { itemId? }  — if omitted, syncs all of the user's Plaid items
// Returns: { ok, itemsScanned, debtsUpdated, errors, sampleData }
//
// Pulls fresh liabilities data from Plaid (APR, balance, statement date, due
// date, minimum payment, last payment) and patches matching debt records in
// users/{uid}/state/app.debts.
//
// TIER GATE: Pro Plus only. Free + Pro tiers receive 403.
//
// Match strategy: per-account_id via debt.plaidAccountId field. Debts auto-
// imported during initial Plaid link already have this set. Manual debts
// without an accountId are skipped (left untouched, not overwritten).

const { verifyIdToken, getFirestore, getFirebaseAdmin } = require('./_shared/firebase');
const { getPlaidClient } = require('./_shared/plaid');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const json = (status, body) => ({ statusCode: status, headers: CORS, body: JSON.stringify(body) });

async function userTier(db, uid) {
  try {
    // Match the same logic stripe-checkout-create + tier-gate utility use.
    const subSnap = await db.collection('users').doc(uid).collection('billing').doc('subscription').get();
    if (subSnap.exists) {
      const sub = subSnap.data() || {};
      let t = String(sub.tier || 'free').toLowerCase();
      if (t === 'pro-plus' || t === 'pro_plus' || t === 'proplus') t = 'plus';
      if (sub.isAdmin) return 'admin';
      return ['admin', 'plus', 'pro', 'free'].indexOf(t) !== -1 ? t : 'free';
    }
    // Fallback: top-level user.tier
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) {
      const u = userSnap.data() || {};
      return String(u.tier || 'free').toLowerCase();
    }
    return 'free';
  } catch (_) { return 'free'; }
}

function extractCreditCard(account, lia) {
  // account: from accounts[]
  // lia: from liabilities.credit[i] where account_id matches
  const out = {};
  if (lia.aprs && Array.isArray(lia.aprs) && lia.aprs.length) {
    // Plaid returns separate APRs per balance type; we want the purchase APR
    const purchase = lia.aprs.find(a => a.apr_type === 'purchase_apr') ||
                     lia.aprs.find(a => a.apr_type === 'balance_transfer_apr') ||
                     lia.aprs[0];
    if (purchase && purchase.apr_percentage != null) out.apr = Number(purchase.apr_percentage);
  }
  if (lia.minimum_payment_amount != null) out.minPayment = Number(lia.minimum_payment_amount);
  if (lia.last_payment_amount != null) out.lastPaymentAmount = Number(lia.last_payment_amount);
  if (lia.last_payment_date) out.lastPaymentDate = lia.last_payment_date;
  if (lia.next_payment_due_date) out.nextDueDate = lia.next_payment_due_date;
  if (lia.last_statement_issue_date) out.lastStatementDate = lia.last_statement_issue_date;
  if (lia.last_statement_balance != null) out.lastStatementBalance = Number(lia.last_statement_balance);
  // Pull statement day-of-month from the issue date if present
  if (lia.last_statement_issue_date) {
    const d = new Date(lia.last_statement_issue_date);
    if (!isNaN(d.getTime())) out.statementDay = d.getDate();
  }
  // Balance from account.balances.current
  if (account.balances && account.balances.current != null) out.balance = Number(account.balances.current);
  if (account.balances && account.balances.limit != null) out.creditLimit = Number(account.balances.limit);
  return out;
}

function extractStudent(account, lia) {
  const out = {};
  if (lia.interest_rate_percentage != null) out.apr = Number(lia.interest_rate_percentage);
  if (lia.minimum_payment_amount != null) out.minPayment = Number(lia.minimum_payment_amount);
  if (lia.last_payment_amount != null) out.lastPaymentAmount = Number(lia.last_payment_amount);
  if (lia.last_payment_date) out.lastPaymentDate = lia.last_payment_date;
  if (lia.next_payment_due_date) out.nextDueDate = lia.next_payment_due_date;
  if (account.balances && account.balances.current != null) out.balance = Number(account.balances.current);
  return out;
}

function extractMortgage(account, lia) {
  const out = {};
  if (lia.interest_rate && lia.interest_rate.percentage != null) out.apr = Number(lia.interest_rate.percentage);
  if (lia.next_monthly_payment != null) out.minPayment = Number(lia.next_monthly_payment);
  if (lia.next_payment_due_date) out.nextDueDate = lia.next_payment_due_date;
  if (lia.last_payment_amount != null) out.lastPaymentAmount = Number(lia.last_payment_amount);
  if (lia.last_payment_date) out.lastPaymentDate = lia.last_payment_date;
  if (account.balances && account.balances.current != null) out.balance = Number(account.balances.current);
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let decoded;
  try {
    decoded = await verifyIdToken(event.headers.authorization || event.headers.Authorization);
  } catch (e) {
    return json(401, { error: 'unauthorized: ' + e.message });
  }
  const uid = decoded.uid;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const targetItemId = body.itemId || null;

  const db = getFirestore();
  const tier = await userTier(db, uid);
  if (tier !== 'plus' && tier !== 'admin') {
    return json(403, { error: 'Plaid Liabilities sync is a Pro Plus feature', tier });
  }

  const plaid = getPlaidClient();

  // List user's Plaid items
  const itemsSnap = await db.collection('users').doc(uid).collection('plaid_items').get();
  if (itemsSnap.empty) {
    return json(200, { ok: true, itemsScanned: 0, debtsUpdated: 0, message: 'no Plaid items linked' });
  }

  // Read app state (debts) once. We'll patch debts in memory then write back atomically.
  const stateRef = db.collection('users').doc(uid).collection('state').doc('app');
  const stateSnap = await stateRef.get();
  const appState = stateSnap.exists ? (stateSnap.data() || {}) : {};
  const debts = Array.isArray(appState.debts) ? appState.debts.slice() : [];
  const debtsByAcctId = {};
  debts.forEach((d, i) => {
    if (d.plaidAccountId) debtsByAcctId[d.plaidAccountId] = i;
    else if (d.accountId) debtsByAcctId[d.accountId] = i;
  });

  let itemsScanned = 0;
  let debtsUpdated = 0;
  const errors = [];
  const sample = [];
  const now = Date.now();

  for (const itemDoc of itemsSnap.docs) {
    const itemId = itemDoc.id;
    if (targetItemId && itemId !== targetItemId) continue;
    const itemData = itemDoc.data() || {};
    const accessToken = itemData.access_token || itemData.accessToken;
    if (!accessToken) {
      errors.push({ itemId, error: 'missing access_token' });
      continue;
    }

    itemsScanned++;
    let resp;
    try {
      resp = await plaid.liabilitiesGet({ access_token: accessToken });
    } catch (e) {
      const msg = (e && e.response && e.response.data && e.response.data.error_message) ||
                  (e && e.message) || 'liabilitiesGet failed';
      errors.push({ itemId, error: msg });
      continue;
    }

    const accounts = (resp.data && resp.data.accounts) || [];
    const liabilities = (resp.data && resp.data.liabilities) || {};
    const credits = liabilities.credit || [];
    const students = liabilities.student || [];
    const mortgages = liabilities.mortgage || [];

    // Build a lookup from account_id → liability record
    const liaByAcct = {};
    credits.forEach(c => { if (c.account_id) liaByAcct[c.account_id] = { kind: 'credit', data: c }; });
    students.forEach(s => { if (s.account_id) liaByAcct[s.account_id] = { kind: 'student', data: s }; });
    mortgages.forEach(m => { if (m.account_id) liaByAcct[m.account_id] = { kind: 'mortgage', data: m }; });

    // For each account, see if we have a debt for it; if so, patch it.
    for (const acct of accounts) {
      const lia = liaByAcct[acct.account_id];
      if (!lia) continue;
      let patch = null;
      if (lia.kind === 'credit') patch = extractCreditCard(acct, lia.data);
      else if (lia.kind === 'student') patch = extractStudent(acct, lia.data);
      else if (lia.kind === 'mortgage') patch = extractMortgage(acct, lia.data);
      if (!patch) continue;

      const idx = debtsByAcctId[acct.account_id];
      if (idx == null) {
        // No matching debt — record sample for client to handle (manual map)
        sample.push({
          accountId: acct.account_id,
          accountName: acct.name || acct.official_name,
          accountMask: acct.mask,
          kind: lia.kind,
          patch: patch
        });
        continue;
      }

      // Apply patch to existing debt — only update fields that are present
      const debt = Object.assign({}, debts[idx]);
      Object.keys(patch).forEach(k => {
        if (patch[k] != null && patch[k] !== '') debt[k] = patch[k];
      });
      debt.lastLiabilitiesSync = now;
      debt.liabilitiesSource = 'plaid';
      debts[idx] = debt;
      debtsUpdated++;
    }
  }

  // Write back the patched debts
  if (debtsUpdated > 0) {
    try {
      await stateRef.set({ debts: debts, lastLiabilitiesSyncAt: now }, { merge: true });
    } catch (e) {
      errors.push({ stage: 'state-write', error: e.message });
    }
  }

  return json(200, {
    ok: true,
    tier,
    itemsScanned,
    debtsUpdated,
    unmatchedAccounts: sample.length,
    sampleUnmatched: sample.slice(0, 5),
    errors,
    syncedAt: now
  });
};
