/* wjp-calendar-redesign.js v6.6 — Plaid feed + merchant overrides + 3-dot menu.
 *
 * Sources data directly from localStorage.wjp_budget_state — both
 * recurringPayments (scheduled) and transactions (Plaid history). Auto-
 * categorizes everything; user can change any event's category via a
 * picker that persists per-merchant for all future occurrences.
 *
 * Each day cell now has a 3-dot ⋮ menu in its top-right corner with quick
 * actions: Add note, Set reminder, View details, Add manual entry. Hover
 * to reveal; click to open a small popover.
 *
 * NaN ghost from v3 fixed by rewriting buildHTML using template literals
 * (the bug class is impossible without binary `+` chains).
 */
(function () {
  "use strict";
  if (window._wjpCalRedesignInstalled) return;
  window._wjpCalRedesignInstalled = true;

  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  // Flicker guard — installed synchronously on script load. Hides the
  // original #page-recurring children the moment they would render so the
  // user never sees the broken old layout. Our overlay's root
  // (#wjp-cal-root) is exempt. Safety: if root fails to mount within 5s,
  // remove the guard so the page can't be permanently empty.
  (function installFlickerGuard() {
    try {
      if (document.getElementById("wjp-cal-flicker-guard")) return;
      var s = document.createElement("style");
      s.id = "wjp-cal-flicker-guard";
      s.textContent = "#page-recurring > *:not(#wjp-cal-root){display:none !important;}";
      (document.head || document.documentElement).appendChild(s);
      setTimeout(function () {
        if (!document.getElementById("wjp-cal-root")) {
          try { s.remove(); } catch (_) {}
        }
      }, 5000);
    } catch (_) {}
  })();

  var ROOT_ID         = "wjp-cal-root";
  var LS_NOTES        = "wjp.cal.notes.v1";
  var LS_FILTER       = "wjp.cal.filter.v1";
  var LS_VIEW         = "wjp.cal.view.v1";
  var LS_HEATMAP      = "wjp.cal.heatmap.v1";
  var LS_OVERRIDES    = "wjp.cal.overrides.v1";        // {origDate|name → newDate}
  var LS_BALANCE      = "wjp.cal.balance.v1";
  var LS_MERCHANT_CAT = "wjp.cal.merchant_categories.v1"; // {merchantKey → category}
  var LS_DISMISSED    = "wjp.cal.dismissed_suggestions.v1";

  var MONTHS_FULL  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS         = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

  var CATEGORIES_BUILTIN = ["debt","housing","subscription","utility","insurance","income","transfers","car","business","other"];
  var LS_USER_CATEGORIES = "wjp.cal.userCategories.v1";

  function loadUserCategories() {
    try { return JSON.parse(localStorage.getItem(LS_USER_CATEGORIES) || "null") || []; }
    catch (_) { return []; }
  }
  function saveUserCategories(arr) {
    try { localStorage.setItem(LS_USER_CATEGORIES, JSON.stringify(arr)); } catch (_) {}
  }
  function allCategories() {
    var user = loadUserCategories().map(function(u){ return u.key; });
    // Insert user categories BEFORE "other" for natural ordering
    var out = CATEGORIES_BUILTIN.slice(0, -1).concat(user).concat(["other"]);
    return out;
  }
  // Backward-compat alias for any code still using CATEGORIES
  var CATEGORIES = CATEGORIES_BUILTIN;

  var state = {
    viewMonth:    new Date().getMonth(),
    viewYear:     new Date().getFullYear(),
    filter:       "all",
    selectedDate: null,
    view:         "month",
    heatmap:      false,
    dragging:     null,
    catEditingFor: null, // { eventId, merchantKey }
    dayMenuFor:    null  // 'YYYY-MM-DD'
  };
  try { state.filter  = localStorage.getItem(LS_FILTER)  || "all"; }   catch (_) {}
  try { state.view    = localStorage.getItem(LS_VIEW)    || "month"; } catch (_) {}
  try { state.heatmap = localStorage.getItem(LS_HEATMAP) === "1"; }    catch (_) {}

  // ============================================================
  // Storage helpers
  // ============================================================
  function loadJSON(k, def) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? def : v; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  function loadNotes() {
    // Prefer the unified store maintained by the Notes tab if available.
    if (window.WJP_Notes && typeof window.WJP_Notes.notesByDate === "function") {
      try { return window.WJP_Notes.notesByDate() || {}; } catch (_) {}
    }
    // Fallback: legacy v1 store
    return loadJSON(LS_NOTES, {});
  }
  function saveNotes(o) { saveJSON(LS_NOTES, o); }
  function loadOverrides()  { return loadJSON(LS_OVERRIDES, {}); }
  function saveOverrides(o) { saveJSON(LS_OVERRIDES, o); }
  function loadMerchantCats()  { return loadJSON(LS_MERCHANT_CAT, {}); }
  function saveMerchantCats(o) { saveJSON(LS_MERCHANT_CAT, o); }
  function loadDismissed()  { return loadJSON(LS_DISMISSED, {}); }
  function saveDismissed(o) { saveJSON(LS_DISMISSED, o); }
  function loadStartBalance() {
    var v = parseFloat(localStorage.getItem(LS_BALANCE));
    return isFinite(v) ? v : null;
  }
  function saveStartBalance(v) { try { localStorage.setItem(LS_BALANCE, String(v)); } catch (_) {} }

  function setNote(date, text, reminderAt) {
    var o = loadNotes();
    if (!text && !reminderAt) delete o[date];
    else o[date] = { text: text || "", reminderAt: reminderAt || null, fired: false };
    saveNotes(o);
  }

  function setMerchantCategory(merchantKey, category) {
    var ov = loadMerchantCats();
    if (!category) delete ov[merchantKey];
    else ov[merchantKey] = category;
    saveMerchantCats(ov);
  }

  // Browser-notification reminders
  var lastReminderCheck = 0;
  function checkReminders() {
    if (Date.now() - lastReminderCheck < 30000) return;
    lastReminderCheck = Date.now();
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    var notes = loadNotes(); var now = Date.now();
    Object.keys(notes).forEach(function (date) {
      var n = notes[date];
      if (!n || !n.reminderAt || n.fired) return;
      if (now >= n.reminderAt) {
        try {
          new Notification("WJP reminder · " + date, { body: n.text || "(no note)" });
          n.fired = true; saveNotes(notes);
        } catch (_) {}
      }
    });
  }

  // ============================================================
  // Display-name cleanup — Plaid merchant strings are long & noisy.
  // ============================================================
  function simplifyDisplayName(s) {
    if (!s) return s;
    var t = String(s).trim();
    // Zelle: keep only "Zelle" — strip everything after, no IDs, no clutter
    if (/^zelle\b/i.test(t)) return "Zelle";
    // ZELLE DEBIT (occasional caps form)
    if (/^zelle\s+(debit|credit)/i.test(t)) return "Zelle";
    // BofA ATM deposits already filtered out, but if some leak through:
    if (/^bkofamerica\s+atm/i.test(t)) return "BofA ATM";
    // Generic: collapse extra-long lines (35 char cap)
    if (t.length > 35) return t.slice(0, 32).trim() + "…";
    return t;
  }

  // ============================================================
  // Merchant key normalization + auto-classify
  // ============================================================
  function merchantKey(s) {
    if (!s) return "";
    return String(s).toUpperCase()
      .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
      .replace(/\d{4}-\d{2}-\d{2}/g, " ")
      .replace(/#X+\d+/g, " ")
      .replace(/#\d+/g, " ")
      .replace(/\b\d{4,}\b/g, " ")
      .replace(/[^\w\s&]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(function (w) { return w.length > 1; })
      .slice(0, 3)
      .join(" ");
  }

  function autoClassify(name, plaidCategory) {
    var s = ((name || "") + " " + (plaidCategory || "")).toLowerCase();
    if (/\bpayroll\b|\bpaycheck\b|\bpayday\b|\bsalary\b|direct\s*deposit\s+from|biweekly\s+pay|monthly\s+pay|employer\s+deposit|\bwages?\b/.test(s)) return "income";
    if (/^zelle\b|\bzelle\b/.test(s)) return "transfers";
    if (/cash\s*app|venmo|paypal\s+(transfer|send)/.test(s)) return "transfers";
    if (/transfer\s+from|transfer\s+to|internal\s+xfer|online\s+transfer|external\s+transfer|wire\s+(in|out)|\bach\s+(debit|credit|transfer|payment)|account\s+to\s+account|payment\s+(to|from)\s+(capital\s+one|chase|amex|discover|citi|wells\s+fargo|bank\s+of\s+america|bofa|amazon\s+credit)|cc\s+payment|credit\s+card\s+payment|\bstash\b|\brobinhood\b|coinbase|\bvanguard\b|\bfidelity\b|charles\s+schwab|\binvestment\s+(transfer|deposit)|brokerage|\bira\b\s+(deposit|contribution)|\bvenmo\s+(add|cashout)|paypal\s+(transfer|send)/.test(s)) return "transfers";
    if (/electric|\bgas\b|\bpower\b|water\s+co|sewer|internet|verizon|comcast|xfinity|t[-]?mobile|at\s*&\s*t|phone\s+bill|att|spectrum/.test(s)) return "utility";
    if (/insurance|policy|coverage|geico|progressive|state\s+farm|allstate|esurance|liberty\s+mutual|farmers/.test(s)) return "insurance";
    if (/netflix|spotify|hulu|disney|paramount|claude|chatgpt|anthropic|openai|adobe|microsoft\s*365|prime\s+video|youtube\s+premium|\bgym\b|peloton|nytimes|washingtonpost|patreon|substack|membership|subscription/.test(s)) return "subscription";
    if (/\brent\b|rental\s+payment|mortgage|\bmtg\b|landlord|property\s+(mgmt|management|manager)|\bhoa\b|homeowners|apartment\s+pay|home\s+(loan|payment)/.test(s)) return "housing";
    if (/\bgas\s+station|exxon|chevron|\bshell\b|\bbp\s+gas|mobil\b|citgo|sunoco|76\s+gas|valero|conoco|wawa\s+gas|7-eleven|fuel\s+stop|gasoline|\bpetrol|parking\s+(garage|lot|meter)|\btolls?\b|ezpass|e-zpass|fastrak|jiffy\s+lube|valvoline|midas|firestone|pep\s+boys|tire(\s+(kingdom|shop)|s\s+plus)|car\s+wash|aaa\s+club|\bdmv\b|department\s+of\s+motor|vehicle\s+(reg|registration)|auto\s+(parts|repair|body|service)|\boreilly\s+auto|advance\s+auto|autozone|napa\s+auto|uber\b|lyft\b/.test(s)) return "car";
    if (/staples|office\s+depot|fedex|ups\s+store|usps\s+(office|store)|coworking|wework|regus|industrious|aws\s+(billing|services)|amazon\s+web\s+services|google\s+cloud|azure\s+billing|hubspot|salesforce|linkedin\s+(premium|sales)|quickbooks|zoom\s+meet|stripe\s+(fee|payout)|business\s+(card|services)|\bllc\b|\binc\.|invoice\s+(payment|fee)/.test(s)) return "business";
    if (/avant|affirm|klarna|sofi|capital\s+one|milestone|credit\s+one|brightway|westlake|aidadvantage|one\s+main|credit\s+card|\bloan\b/.test(s)) return "debt";
    return "other";
  }

  function categoryStyle(cat) {
    // Check user-defined categories first
    var user = loadUserCategories();
    var u = user.find(function(x){ return x.key === cat; });
    if (u) return { color: u.color || "#6b7280", bg: u.bg || "rgba(107,114,128,0.10)", border: u.border || "rgba(107,114,128,0.25)" };
    switch (cat) {
      case "debt":         return { color: "#dc2626", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.25)" };
      case "subscription": return { color: "#7c3aed", bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.25)" };
      case "utility":      return { color: "#0284c7", bg: "rgba(2,132,199,0.10)", border: "rgba(2,132,199,0.25)" };
      case "insurance":    return { color: "#c99a2a", bg: "rgba(201,154,42,0.12)", border: "rgba(201,154,42,0.30)" };
      case "income":       return { color: "#1f7a4a", bg: "rgba(31,122,74,0.12)", border: "rgba(31,122,74,0.30)" };
      case "transfers":    return { color: "#0891b2", bg: "rgba(8,145,178,0.10)", border: "rgba(8,145,178,0.25)" };
      case "car":          return { color: "#ea580c", bg: "rgba(234,88,12,0.10)",  border: "rgba(234,88,12,0.25)" };
      case "business":     return { color: "#475569", bg: "rgba(71,85,105,0.10)",  border: "rgba(71,85,105,0.25)" };
      case "housing":      return { color: "#9a3412", bg: "rgba(154,52,18,0.10)", border: "rgba(154,52,18,0.25)" };
      default:             return { color: "#6b7280", bg: "rgba(107,114,128,0.10)", border: "rgba(107,114,128,0.20)" };
    }
  }

  // ============================================================
  // Helpers
  // ============================================================
  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return "—";
    return "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
  }
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) { return escapeHTML(s); }
  function isOverdue(ev) {
    if (ev.status === "OVERDUE") return true;
    if (ev.status === "PAID") return false;
    if (ev.source === "plaid") return false;  // Plaid txns are realized
    var todayK = dateKey(new Date());
    return ev.date < todayK && ev.category !== "income";
  }

  // Skip internal bank transfers, interest charges, and other non-bill noise.
  // These are not actionable payments — they're bank chatter that bloats the
  // calendar without giving the user anything to act on.
  function isNoisyTransaction(tx) {
    var s = ((tx.merchant || "") + " " + (tx.method || "") + " " + (tx.category || "")).toLowerCase();
    // v6.2: Whitelist real payroll/income BEFORE any noise rules can match.
    // Patterns that indicate a real paycheck or earned income — never noise.
    if (/payroll/.test(s)) return false;
    if (/freshrealm|fresh\s*realm/.test(s)) return false;
    if (/adp\s+totalsource|adp\s+payroll|adp\s+totals/.test(s)) return false;
    if (/direct\s+dep|direct\s+deposit/.test(s)) return false;
    if (/\bsalary\b|\bwages\b|\bpaycheck\b/.test(s)) return false;
    if (/\bgusto\b|\bjustworks\b|\bpaychex\b|\bquickbooks\s+payroll\b/.test(s)) return false;
    // Internal bank-to-bank moves between own accounts
    if (/transfer\s+from\s+acct/.test(s)) return true;
    if (/transfer\s+to\s+acct/.test(s)) return true;
    if (/online\s+banking\s+transfer/.test(s)) return true;
    if (/internal\s+xfer/.test(s)) return true;
    if (/\bxfer\b/.test(s)) return true;
    if (/wire\s+(in|out)\s+from\s+(self|own)/.test(s)) return true;
    if (/account\s+to\s+account/.test(s)) return true;
    if (/external\s+transfer/.test(s)) return true;
    // Self-Zelle (sender or receiver is the same name as the account holder)
    // The user account is "WINSTON PAPPOE" — Zelles to/from his own name are self-transfers
    if (/zelle.*winston\s+pappoe/.test(s)) return true;
    if (/winston\s+pappoe.*zelle/.test(s)) return true;
    // Interest charges are fees, not actionable bills
    if (/interest\s+charge/.test(s)) return true;
    // Plaid sometimes emits "ACH DEBIT/CREDIT" for the user own moves
    if (/^ach\s+(debit|credit)\b/.test(s.trim())) return true;
    // Internal bank ATM activity (deposits to user own account aren bills)
    if (/\bbkofamerica\s+atm\b/.test(s) && /deposit/.test(s)) return true;
    if (/\batm\s+\d+.*deposit\b/.test(s)) return true;
    // Investment moves (user is sending money to themselves not spending)
    if (/^stash\b|^robinhood\b|^coinbase\b|^fidelity\b|^vanguard\b|^charles\s+schwab\b/.test(s.trim())) return true;
    if (/\bbrokerage\s+transfer\b|investment\s+deposit/.test(s)) return true;
    // Credit card payments TO the user own card
    if (/payment\s+(to|received|posted)\s+(capital\s+one|chase|amex|discover|citi|wells\s+fargo|bank\s+of\s+america|bofa)/.test(s)) return true;
    if (/cc\s+payment\s+(to|from)/.test(s)) return true;
    return false;
  }

  // v6.5: Normalize a merchant for dedup. Zelle pending/completed often
  // have totally different merchant strings ("Zelle Transfer Conf# X; NAME"
  // vs "Zelle payment from NAME for ...; Conf# X") — they share a conf #
  // though, so extract that. Otherwise fall back to lowercased trim.
  function dedupMerchantKey(merchant) {
    var m = String(merchant || "").toLowerCase().trim();
    if (!m) return "";
    if (/zelle/.test(m)) {
      var conf = m.match(/conf#?\s*([a-z0-9]+)/);
      if (conf) return "zelle|conf|" + conf[1];
    }
    return m;
  }

  // ============================================================
  // Data harvest from localStorage app state
  // ============================================================
  // Returns array of events in the visible window.
  function harvestFromAppState() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem("wjp_budget_state") || "null"); }
    catch (_) { return null; }
    if (!raw || typeof raw !== "object") return null;

    var events = [];
    var todayMs = Date.now();
    var WINDOW_BACK_MS    = 30 * 24 * 3600 * 1000;
    var WINDOW_FORWARD_MS = 60 * 24 * 3600 * 1000;
    var minMs = todayMs - WINDOW_BACK_MS;
    var maxMs = todayMs + WINDOW_FORWARD_MS;
    var todayK = dateKey(new Date());

    var ovDate = loadOverrides();

    // === PAST + TODAY: only Plaid transactions (the truth) ===
    //
    // v6.3: Two-pass approach. First, build a set of (merchant, amount) keys
    // that have at least one "completed" Plaid txn — those are the source of
    // truth and any matching "pending" is its precursor (skip).  Then iterate
    // and emit, preferring completed over pending when both exist for the
    // same merchant+amount within ±3 days.
    var completedKeys = {};
    (raw.transactions || []).forEach(function (tx) {
      if (!tx || !tx.date || tx.amount == null) return;
      if (String(tx.status || "").toLowerCase() !== "completed") return;
      var idChk = String(tx.id || "");
      if (/^rec-/i.test(idChk) || /^plaid_rec/i.test(idChk) || idChk.indexOf("-rec-") >= 0) return;
      var rawAmt = Number(tx.amount);
      if (!isFinite(rawAmt)) return;
      var cm = dedupMerchantKey(tx.merchant);
      var key = cm + "|" + rawAmt.toFixed(2);
      var d = String(tx.date).slice(0, 10);
      var dayMs = new Date(d + "T12:00:00").getTime();
      if (!completedKeys[key]) completedKeys[key] = [];
      completedKeys[key].push(dayMs);
    });

    // v6.6: For each (key), find the earliest pending date that has a
    // completed twin within ±10 days. The completed row will adopt that
    // earlier date when emitted — that's the date the charge actually hit
    // the user (vs. the clearing date Plaid emits as "completed").
    var pendingEarliestByCompletedDay = {}; // key|completedDayMs -> earliest pendingDayMs
    (raw.transactions || []).forEach(function (tx) {
      if (!tx || !tx.date || tx.amount == null) return;
      if (String(tx.status || "").toLowerCase() !== "pending") return;
      var idChk = String(tx.id || "");
      if (/^rec-/i.test(idChk) || /^plaid_rec/i.test(idChk) || idChk.indexOf("-rec-") >= 0) return;
      var rawAmt = Number(tx.amount);
      if (!isFinite(rawAmt)) return;
      var cm = dedupMerchantKey(tx.merchant);
      var key = cm + "|" + rawAmt.toFixed(2);
      var d = String(tx.date).slice(0, 10);
      var pendDayMs = new Date(d + "T12:00:00").getTime();
      var twins = completedKeys[key] || [];
      for (var i = 0; i < twins.length; i++) {
        if (Math.abs(twins[i] - pendDayMs) <= 10 * 24 * 3600 * 1000) {
          var slot = key + "|" + twins[i];
          if (!pendingEarliestByCompletedDay[slot] || pendDayMs < pendingEarliestByCompletedDay[slot]) {
            pendingEarliestByCompletedDay[slot] = pendDayMs;
          }
        }
      }
    });

    var seenPlaid = {};
    (raw.transactions || []).forEach(function (tx) {
      if (!tx || !tx.date || tx.amount == null) return;
      var dateOnly = String(tx.date).slice(0, 10);
      var t = new Date(dateOnly + "T12:00:00").getTime();
      if (!isFinite(t)) return;
      if (t < minMs || t > todayMs) return; // past + today only
      var rawAmt = Number(tx.amount);
      if (!isFinite(rawAmt) || Math.abs(rawAmt) < 1) return;
      if (Math.abs(rawAmt) < 25) return; // significance gate
      if (isNoisyTransaction(tx)) return;

      // Skip recurring-schedule projections that leaked into state.transactions.
      var txIdRaw = String(tx.id || "");
      if (/^rec-/i.test(txIdRaw)) return;
      if (/^plaid_rec/i.test(txIdRaw)) return;
      if (txIdRaw.indexOf("-rec-") >= 0) return;

      // v6.3: Skip pending ONLY if a completed twin exists within ±3 days
      // for the same merchant+amount. Otherwise keep the pending row so
      // today's paychecks (which start as pending) still show.
      var statusLower = String(tx.status || "").toLowerCase();
      var cleanMerchant = dedupMerchantKey(tx.merchant);
      var amtKey = cleanMerchant + "|" + rawAmt.toFixed(2);
      var dayMs = t;
      if (statusLower === "pending") {
        var twins = completedKeys[amtKey] || [];
        var hasTwin = false;
        // v6.4: widen pending→completed window to ±10 days. Plaid pending rows
        // can sit for up to a week before transitioning to completed, especially
        // for ACH/payroll. ±3 days isn't enough.
        for (var ti = 0; ti < twins.length; ti++) {
          if (Math.abs(twins[ti] - dayMs) <= 10 * 24 * 3600 * 1000) { hasTwin = true; break; }
        }
        if (hasTwin) return; // skip — the completed row will be emitted instead
      }

      // Generic dedup within ±3 days at same (merchant, amount).
      var dupHit = false;
      if (seenPlaid[amtKey]) {
        for (var di = 0; di < seenPlaid[amtKey].length; di++) {
          if (Math.abs(seenPlaid[amtKey][di] - dayMs) <= 3 * 24 * 3600 * 1000) { dupHit = true; break; }
        }
      }
      if (dupHit) return;
      if (!seenPlaid[amtKey]) seenPlaid[amtKey] = [];
      seenPlaid[amtKey].push(dayMs);

      // v6.6: If this is a completed row and it has a pending twin within
      // ±10 days, adopt the earlier (pending) date — that is when the
      // charge actually happened, not when it cleared.
      var displayDate = dateOnly;
      if (statusLower === "completed") {
        var earlyMs = pendingEarliestByCompletedDay[amtKey + "|" + dayMs];
        if (earlyMs && earlyMs < dayMs) {
          displayDate = new Date(earlyMs).toISOString().slice(0, 10);
        }
      }
      var origDate = displayDate;
      var ovKey = origDate + "|" + (tx.merchant || tx.id || "");
      var date = ovDate[ovKey] || origDate;
      var isInflow = rawAmt > 0;
      var amt = Math.abs(rawAmt);
      events.push({
        id: "tx:" + (tx.id || (origDate + "|" + (tx.merchant || ""))),
        date: date,
        origDate: origDate,
        name: tx.merchant || "Transaction",
        merchant: tx.merchant || "",
        amount: amt,
        signedAmount: rawAmt,
        isInflow: isInflow,
        category: "",
        rawCategory: tx.category || "",
        source: "plaid",
        type: tx.method || "Bank",
        status: tx.status || "",
        institutionName: tx.institutionName || "",
        moved: !!ovDate[ovKey],
        ovKey: ovKey,
        plaidId: tx.plaidTransactionId || "",
        locked: !!tx.locked
      });
    });

    // === FUTURE: only recurring payments (forecasts) ===
    (raw.recurringPayments || []).forEach(function (rp) {
      if (!rp || !rp.nextDate || rp.amount == null) return;
      var origDate = String(rp.nextDate).slice(0, 10);
      var t = new Date(origDate + "T12:00:00").getTime();
      if (!isFinite(t)) return;
      if (t <= todayMs || t > maxMs) return; // strictly future
      var ovKey = origDate + "|" + (rp.name || "");
      var date = ovDate[ovKey] || origDate;
      var isInflow = !!rp.linkedIncome || (rp.category === "income");
      events.push({
        id: "rp:" + (rp.id || (origDate + "|" + (rp.name || ""))),
        date: date,
        origDate: origDate,
        name: rp.name || "Payment",
        merchant: rp.name || "",
        amount: Math.abs(rp.amount),
        signedAmount: isInflow ? Math.abs(rp.amount) : -Math.abs(rp.amount),
        isInflow: isInflow,
        category: rp.category || "",
        rawCategory: rp.category || "",
        source: "recurring",
        type: rp.frequency || "recurring",
        status: "",
        moved: !!ovDate[ovKey],
        ovKey: ovKey,
        linkedDebtId: rp.linkedDebtId || null,
        isIncome: !!rp.linkedIncome
      });
    });

    return events;
  }

  // De-dup: a Plaid transaction realized on the same date as a scheduled
  // recurringPayment with similar merchant+amount → keep only the Plaid one.
  function dedupe(events) {
    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var keep = [];
    Object.keys(byDate).forEach(function (date) {
      var bucket = byDate[date];
      // Two-pass: first collect plaid keys, then drop matching recurring entries
      var plaidKeys = bucket.filter(function (e) { return e.source === "plaid"; })
                            .map(function (e) { return { key: merchantKey(e.merchant), amt: e.amount }; });
      bucket.forEach(function (e) {
        if (e.source === "recurring") {
          var k = merchantKey(e.name);
          var dup = plaidKeys.some(function (p) {
            if (!p.key || !k) return false;
            // share at least 1 word & amount within ±$2
            var pwords = p.key.split(" "), kwords = k.split(" ");
            var shared = pwords.some(function (w) { return kwords.indexOf(w) !== -1; });
            return shared && Math.abs(p.amt - e.amount) <= 2;
          });
          if (dup) return;
        }
        keep.push(e);
      });
    });
    return keep;
  }

  // Apply categorization (override → autoClassify → fallback)
  function categorize(events) {
    var ov = loadMerchantCats();
    return events.map(function (e) {
      var key = merchantKey(e.merchant || e.name);
      e.merchantKey = key;
      if (key && ov[key]) {
        e.category = ov[key];
        e.categorySource = "override";
      } else if (e.source === "plaid" || !e.category) {
        e.category = autoClassify(e.name, e.rawCategory);
        e.categorySource = "auto";
      } else {
        // recurring with explicit category — trust it
        e.categorySource = "manual";
      }
      // Income hint from recurring schema
      if (e.isIncome && e.category === "other") e.category = "income";
      return e;
    });
  }

  function harvestEvents() {
    var fromState = harvestFromAppState();
    if (!fromState) return [];
    var deduped = dedupe(fromState);
    return categorize(deduped);
  }

  // ============================================================
  // Squeeze forecast: running balance per day
  // ============================================================
  function computeRunningBalance(events, fromDate, daysOut) {
    var start = loadStartBalance();
    if (start == null) return null;
    var dayMap = {};
    events.forEach(function (e) {
      if (!dayMap[e.date]) dayMap[e.date] = 0;
      dayMap[e.date] += (e.category === "transfers" ? 0 : (e.isInflow === true ? e.amount : -e.amount));
    });
    var out = {};
    var bal = start;
    var d = new Date(fromDate + "T12:00:00");
    for (var i = 0; i < daysOut; i++) {
      var k = dateKey(d);
      bal += (dayMap[k] || 0);
      out[k] = bal;
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // ============================================================
  // ICS export
  // ============================================================
  function eventsToICS(events) {
    var lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//WJP Debt Tracking//Calendar//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:WJP Payments"];
    function pad(n) { return String(n).padStart(2, "0"); }
    function dtstamp(d) {
      return d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) +
             "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
    }
    function escapeText(s) {
      return String(s).replace(/\\/g,"\\\\").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\n/g,"\\n");
    }
    var now = dtstamp(new Date());
    events.forEach(function (e, i) {
      var d = e.date.replace(/-/g,"");
      var nextDay = new Date(e.date + "T00:00:00"); nextDay.setDate(nextDay.getDate() + 1);
      var dEnd = dateKey(nextDay).replace(/-/g,"");
      var summary = (e.category === "income" ? "+" : "−") + "$" + Math.round(e.amount).toLocaleString("en-US") + " " + e.name;
      lines.push("BEGIN:VEVENT");
      lines.push("UID:wjp-" + i + "-" + e.date + "@wjpdebttracking.com");
      lines.push("DTSTAMP:" + now);
      lines.push("DTSTART;VALUE=DATE:" + d);
      lines.push("DTEND;VALUE=DATE:" + dEnd);
      lines.push("SUMMARY:" + escapeText(summary));
      lines.push("DESCRIPTION:" + escapeText(e.category + " · " + (e.type || "") + (e.source ? " · " + e.source : "")));
      lines.push("CATEGORIES:" + e.category.toUpperCase());
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function downloadICS(events) {
    var ics = eventsToICS(events);
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "wjp-payments-" + dateKey(new Date()) + ".ics";
    document.body.appendChild(a); a.click();
    setTimeout(function(){ try{document.body.removeChild(a); URL.revokeObjectURL(url);}catch(_){}}, 800);
  }

  // ============================================================
  // Smart suggestions
  // ============================================================
  function buildSuggestions(events) {
    var paydays = events.filter(function (e) { return e.category === "income"; })
                        .map(function (e) { return e.date; }).sort();
    if (!paydays.length) return [];
    var dismissed = loadDismissed();
    var sugs = [];
    events.forEach(function (e) {
      if (e.category === "income") return;
      var t = new Date(e.date + "T12:00:00").getTime();
      paydays.forEach(function (pd) {
        var pt = new Date(pd + "T12:00:00").getTime();
        var deltaDays = Math.round((pt - t) / 86400000);
        if (deltaDays > 0 && deltaDays <= 3 && e.amount >= 50) {
          var sigId = "before-payday|" + e.date + "|" + e.name + "|" + pd;
          if (dismissed[sigId]) return;
          sugs.push({ event: e, payday: pd, deltaDays: deltaDays, id: sigId,
            message: "Move " + e.name + " from " + e.date + " to just after " + pd + " — avoid " + deltaDays + " day" + (deltaDays === 1 ? "" : "s") + " of cash crunch." });
        }
      });
    });
    sugs.sort(function (a, b) { return b.event.amount - a.event.amount; });
    return sugs.slice(0, 1);
  }

  // ============================================================
  // Render — TEMPLATE LITERALS (no string concat = no NaN bug class)
  // ============================================================
  function findHost() {
    var page = document.getElementById("page-recurring");
    if (!page || !page.classList.contains("active")) return null;
    return page;
  }
  function hideOriginalContent(page) {
    Array.from(page.children).forEach(function (c) {
      if (c.id === ROOT_ID) return;
      if (c.dataset && c.dataset.wjpCalHidden === "1") return;
      c.dataset.wjpCalHidden = "1";
      c.style.display = "none";
    });
  }

  function ensureStyle() {
    if (document.getElementById("wjp-cal-styles")) return;
    var s = document.createElement("style");
    s.id = "wjp-cal-styles";
    s.textContent = `
      .wjp-cal-cell { height:112px; padding:6px 8px; border-right:1px solid var(--border, rgba(0,0,0,0.05)); cursor:pointer; transition:background .15s; position:relative; overflow:hidden; display:flex; flex-direction:column; }
      .wjp-cal-cell:hover { background: rgba(0,0,0,0.025); }
      .wjp-cal-cell:hover .wjp-cal-day-menu { opacity: 1; }
      .wjp-cal-today { background: rgba(31,122,74,0.04); }
      .wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.08); }
      .wjp-cal-payday-col::before { content:''; position:absolute; left:0; top:6px; bottom:6px; width:2px; background:#1f7a4a; border-radius:2px; opacity:0.55; pointer-events:none; }
      .wjp-cal-day-menu { opacity: 0; transition: opacity .15s; background:transparent; border:0; cursor:pointer; padding:2px 4px; border-radius:6px; line-height:1; color:var(--ink-faint, #9ca3af); font-weight:700; }
      .wjp-cal-day-menu:hover { background: rgba(0,0,0,0.06); color:var(--ink, #0a0a0a); }
      .wjp-cal-day-menu-open { opacity: 1; background: rgba(0,0,0,0.06); color:var(--ink, #0a0a0a); }
      .wjp-cal-popover { position:absolute; right:6px; top:30px; z-index:50; background:var(--card, #fff); border:1px solid var(--border, rgba(0,0,0,0.10)); border-radius:10px; box-shadow:0 10px 32px rgba(0,0,0,0.15); padding:6px; min-width:180px; }
      .wjp-cal-popover-fixed { position:fixed !important; right:auto; top:auto; z-index:99999 !important; }
      .wjp-cal-popover-item { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; background:transparent; border:0; border-radius:6px; cursor:pointer; font-family:inherit; font-size:12.5px; color:var(--ink, #0a0a0a); text-align:left; line-height:1.2; }
      .wjp-cal-popover-item:hover { background:rgba(31,122,74,0.06); }
      .wjp-cal-popover-item .wjp-cal-icon { width:18px; text-align:center; opacity:.85; }
      .wjp-cal-cell[draggable] { cursor:grab; }
      .wjp-cal-chip[draggable] { cursor:grab; }
      .wjp-cal-chip[draggable]:active { cursor:grabbing; }
      .wjp-cal-cell.wjp-cal-drop-target { background: rgba(31,122,74,0.15) !important; outline: 2px dashed #1f7a4a; outline-offset: -3px; }
      .wjp-cal-quarter-cell { height:64px !important; padding:4px 5px !important; }
      .wjp-cal-quarter-cell .wjp-cal-chip { font-size:9px !important; padding:1px 4px !important; }
      .wjp-cal-quarter-cell .wjp-cal-day-num { font-size:10px !important; }
      .wjp-cal-quarter-cell .wjp-cal-day-menu { display:none; }
      .wjp-cal-cat-pill { cursor:pointer; user-select:none; }
      .wjp-cal-cat-pill:hover { box-shadow: 0 0 0 1px rgba(0,0,0,0.10); }
      .wjp-cal-cat-picker { display:flex; gap:5px; flex-wrap:wrap; padding:8px 12px 4px; }
      .wjp-cal-cat-chip { border:1px solid var(--border, rgba(0,0,0,0.10)); background:var(--card, #fff); padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; }
      .wjp-cal-cat-chip-active { background:#0a0a0a; color:#fff; border-color:var(--ink, #0a0a0a); }
      .wjp-cal-toast { position:fixed; bottom:30px; left:50%; transform:translateX(-50%) translateY(20px); opacity:0; background:#0a0a0a; color:#fff; padding:10px 16px; border-radius:999px; font-size:12.5px; font-family:var(--sans,Inter,system-ui,sans-serif); font-weight:600; box-shadow:0 12px 32px rgba(0,0,0,0.25); z-index:99999; pointer-events:none; transition:opacity .25s, transform .25s; }
      .wjp-cal-toast-show { opacity:1; transform:translateX(-50%) translateY(0); }
      @keyframes wjpPulse { 0%,100% { opacity:.65 } 50% { opacity:1 } }
      .wjp-cal-suggestion-pulse { animation: wjpPulse 2.4s ease-in-out infinite; }

      /* Dark mode hover/subtle-bg overrides */
      body.dark .wjp-cal-cell:hover { background: rgba(255,255,255,0.04) !important; }
      body.dark .wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.18) !important; }
      body.dark .wjp-edu-card:hover { border-color: rgba(255,255,255,0.16); box-shadow: 0 12px 28px rgba(0,0,0,0.40); }
      body.dark .wjp-notes-row:hover { background: rgba(255,255,255,0.04); }
      body.dark .wjp-edu-disclaimer { background: rgba(220,38,38,0.18); color: #fecaca; }
      body.dark .wjp-edu-disclaimer b { color: #fca5a5; }
      body.dark .wjp-cal-suggestion-pulse, body.dark .wjp-edu-coach { background: linear-gradient(135deg, rgba(31,122,74,0.18), rgba(201,154,42,0.10)); }
      body.dark .wjp-edu-modal { background: var(--card, #131929) !important; color: var(--ink, #f0f4ff) !important; }
      body.dark .wjp-edu-modal-body { color: var(--ink, #f0f4ff) !important; }
      body.dark .wjp-edu-coach textarea, body.dark .wjp-notes-search, body.dark .wjp-notes-title, body.dark .wjp-notes-body, body.dark .wjp-edu-search { background: var(--card, #131929); color: var(--ink, #f0f4ff); }
      body.dark .wjp-edu-coach-msg-user { background: rgba(255,255,255,0.04); color: var(--ink, #f0f4ff); }
      body.dark .wjp-edu-coach-msg-bot { background: var(--card, #131929); color: var(--ink, #f0f4ff); }
      body.dark .wjp-cal-popover { background: var(--card, #131929); border-color: var(--border, rgba(255,255,255,0.10)); }
      body.dark .wjp-cal-popover-item { color: var(--ink, #f0f4ff); }
      body.dark .wjp-cal-popover-item:hover { background: rgba(31,122,74,0.18); }
      body.dark .wjp-act-row .ttl { color: var(--ink, #f0f4ff); }
      body.dark .wjp-plans-link-card { background: linear-gradient(135deg, rgba(31,122,74,0.18), rgba(201,154,42,0.10)); }
      body.dark .wjp-plans-link-card .ttl { color: var(--ink, #f0f4ff); }
    `;
    document.head.appendChild(s);
  }

  function showToast(msg) {
    var existing = document.getElementById("wjp-cal-toast");
    if (existing) existing.remove();
    var t = document.createElement("div");
    t.id = "wjp-cal-toast";
    t.className = "wjp-cal-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("wjp-cal-toast-show"); });
    setTimeout(function () { t.classList.remove("wjp-cal-toast-show"); setTimeout(function(){ try{ t.remove(); }catch(_){} }, 300); }, 2400);
  }

  // ----- HTML builders (template literals throughout) -----

  function chipHTML(e, draggable, compact) {
    var s = categoryStyle(e.category);
    var tip = e.name + " · " + (e.category === "income" ? "+" : "−") + fmtUSD(e.amount) + (e.status ? " · " + e.status : "");
    var moved = e.moved ? `<span title="moved" style="margin-left:4px;color:#c99a2a;font-weight:800;">↻</span>` : "";
    var sz = compact ? "font-size:9px;padding:1px 4px;margin-bottom:1px;" : "font-size:10px;padding:2px 6px;margin-bottom:2px;";
    var dragAttrs = draggable
      ? `draggable="true" data-cal-drag-name="${escapeAttr(e.name)}" data-cal-drag-orig="${e.origDate}" data-cal-drag-cur="${e.date}"`
      : "";
    return `<div class="wjp-cal-chip" ${dragAttrs} title="${escapeAttr(tip)}" style="${sz}background:${s.bg};color:${s.color};border-radius:4px;border:1px solid ${s.border};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:-0.005em;">${escapeHTML(e.name)}${moved}</div>`;
  }

  // Day-cell popover is rendered at calendar root (not inside the cell)
  // so the cell's overflow:hidden cannot clip it.
  function rootPopoverHTML() {
    if (!state.dayMenuFor) return "";
    return `<div class="wjp-cal-popover wjp-cal-popover-fixed" data-cal-popover-day="${state.dayMenuFor}">
      <button type="button" class="wjp-cal-popover-item" data-cal-day-action="add-note">
        <span class="wjp-cal-icon">📝</span> Add note
      </button>
      <button type="button" class="wjp-cal-popover-item" data-cal-day-action="add-reminder">
        <span class="wjp-cal-icon">🔔</span> Set reminder
      </button>
      <button type="button" class="wjp-cal-popover-item" data-cal-day-action="view-details">
        <span class="wjp-cal-icon">👁️</span> View details
      </button>
      <button type="button" class="wjp-cal-popover-item" data-cal-day-action="copy-date">
        <span class="wjp-cal-icon">📋</span> Copy date
      </button>
    </div>`;
  }
  // Stub kept so existing call sites (cell HTML) still compile to empty string.
  function dayMenuHTML(date) { return ""; }

  function buildMonthGrid(events, year, month, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var notes = loadNotes();
    var first = new Date(year, month, 1);
    var startDay = first.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = dateKey(new Date());

    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var paydayDays = {};
    events.forEach(function (e) {
      if (e.category === "income" && e.date.startsWith(year + "-" + String(month + 1).padStart(2, "0"))) {
        paydayDays[parseInt(e.date.slice(8, 10), 10)] = true;
      }
    });

    var balances = null;
    if (state.view === "month") {
      var firstK = year + "-" + String(month + 1).padStart(2, "0") + "-01";
      balances = computeRunningBalance(events, firstK, daysInMonth);
    }

    var dayOut = {}, maxOut = 0;
    Object.keys(byDate).forEach(function (k) {
      var sum = byDate[k].reduce(function (s, e) { if (e.category === "transfers") return s; if (e.isInflow === true || e.category === "income") return s; return s + e.amount; }, 0);
      dayOut[k] = sum;
      if (sum > maxOut) maxOut = sum;
    });

    var cells = [];
    for (var i = 0; i < startDay; i++) cells.push({ blank: true });
    for (var d = 1; d <= daysInMonth; d++) {
      var k = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      cells.push({
        date: k, day: d, events: byDate[k] || [],
        isToday: k === todayKey,
        note: notes[k] || null,
        isPaydayCol: !!paydayDays[d],
        balance: balances ? balances[k] : null
      });
    }
    while (cells.length % 7) cells.push({ blank: true });

    var weeks = [];
    for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));

    var headerCells = DAYS.map(function (label) {
      return `<div style="padding:${compact ? "5px 6px" : "8px 10px"};font-size:${compact ? "8.5px" : "9.5px"};letter-spacing:0.14em;font-weight:700;color:var(--ink-faint, #9ca3af);text-align:left;border-right:1px solid var(--border, rgba(0,0,0,0.05));">${label}</div>`;
    }).join("");

    var weekHTML = weeks.map(function (week) {
      var cellsHTML = week.map(function (cell) {
        if (cell.blank) {
          return `<div style="${compact ? "height:64px;" : "height:112px;"}background:var(--bg-2, rgba(0,0,0,0.015));border-right:1px solid var(--border, rgba(0,0,0,0.05));"></div>`;
        }
        var total = (cell.events || []).reduce(function (s, e) { if (e.category === "transfers") return s; if (e.isInflow === true || e.category === "income") return s; return s + e.amount; }, 0);
        var hasOverdue = (cell.events || []).some(isOverdue);
        var bg = "";
        if (state.heatmap && total > 0 && maxOut > 0) {
          var intensity = Math.min(1, total / maxOut);
          bg = `background:rgba(220,38,38,${(0.06 + intensity * 0.32).toFixed(2)});`;
        }
        var dayNum = cell.isToday
          ? `<span class="wjp-cal-day-num" style="font-size:${compact ? "10px" : "11.5px"};font-weight:700;color:#fff;background:#1f7a4a;width:${compact ? "16px" : "20px"};height:${compact ? "16px" : "20px"};border-radius:50%;display:inline-flex;align-items:center;justify-content:center;">${cell.day}</span>`
          : `<span class="wjp-cal-day-num" style="font-size:${compact ? "10px" : "11.5px"};font-weight:700;color:var(--ink, #0a0a0a);">${cell.day}</span>`;
        var dotsAndTotal = [
          cell.note ? `<span title="Has note" style="width:5px;height:5px;border-radius:50%;background:#c99a2a;"></span>` : "",
          hasOverdue ? `<span title="Overdue/late" style="width:6px;height:6px;border-radius:50%;background:#dc2626;"></span>` : "",
          (total > 0 && !compact) ? `<span style="font-size:9.5px;color:var(--ink-dim, #6b7280);font-weight:700;">${fmtUSD(total)}</span>` : "",
          !compact ? `<button type="button" class="wjp-cal-day-menu${state.dayMenuFor === cell.date ? " wjp-cal-day-menu-open" : ""}" data-cal-day-menu="${cell.date}" title="Day options" aria-label="Day options">⋮</button>` : ""
        ].join("");
        var visible = (cell.events || []).slice(0, compact ? 1 : 2);
        var chipsHTML = visible.map(function (e) { return chipHTML(e, !compact, compact); }).join("");
        var more = (cell.events || []).length - visible.length;
        if (more > 0) chipsHTML += `<div style="font-size:${compact ? "8.5px" : "9.5px"};color:var(--ink-faint, #9ca3af);font-weight:700;">+${more} more</div>`;
        var balLine = "";
        if (cell.balance != null) {
          var negative = cell.balance < 0;
          balLine = `<div style="position:absolute;left:6px;right:6px;bottom:4px;font-size:9px;font-weight:700;color:${negative ? "#dc2626" : "#1f7a4a"};letter-spacing:-0.005em;text-align:right;opacity:.85;">${negative ? "−" : ""}${fmtUSD(cell.balance)}</div>`;
        }
        var classes = "wjp-cal-cell" + (cell.isToday ? " wjp-cal-today" : "") +
                      (cell.isPaydayCol ? " wjp-cal-payday-col" : "") +
                      (compact ? " wjp-cal-quarter-cell" : "");
        return `<div data-cal-day="${cell.date}" class="${classes}" style="${bg}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${compact ? "2px" : "4px"};">
            ${dayNum}
            <span style="display:inline-flex;align-items:center;gap:4px;">${dotsAndTotal}</span>
          </div>
          ${chipsHTML}
          ${balLine}
          ${dayMenuHTML(cell.date)}
        </div>`;
      }).join("");
      return `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid var(--border, rgba(0,0,0,0.05));">${cellsHTML}</div>`;
    }).join("");

    return `<div style="border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:14px;overflow:hidden;background:var(--card, #fff);">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);background:var(--bg-2, rgba(0,0,0,0.025));">${headerCells}</div>
      ${weekHTML}
    </div>`;
  }

  function buildHeader(events) {
    var todayKey_ = dateKey(new Date());
    var monthEvents = events.filter(function (e) {
      // Limit to events whose date is on or before today — gives month-to-date for the
      // current month, full history for past months, and $0 for future months.
      return e.date.startsWith(state.viewYear + "-" + String(state.viewMonth + 1).padStart(2, "0"))
          && e.date <= todayKey_;
    });
    var monthOut = 0, monthIn = 0;
    monthEvents.forEach(function (e) {
      // Skip transfers entirely (between own accounts)
      if (e.category === "transfers") return;
      // Use signed direction as ground truth (Plaid sign or recurring linkedIncome)
      if (e.isInflow === true) monthIn += e.amount;
      else if (e.isInflow === false) monthOut += e.amount;
      else if (e.category === "income") monthIn += e.amount;
      else monthOut += e.amount;
    });
    var net = monthIn - monthOut;
    var netColor = net >= 0 ? "#1f7a4a" : "#dc2626";

    var FILTERS = [
      { k: "all",          label: "All",         count: events.length, builtin: true },
      { k: "debt",         label: "Debts",       count: events.filter(function(e){return e.category==="debt";}).length, builtin: true },
      { k: "housing",      label: "Rent/Home",   count: events.filter(function(e){return e.category==="housing";}).length, builtin: true },
      { k: "car",          label: "Car",         count: events.filter(function(e){return e.category==="car";}).length, builtin: true },
      { k: "business",     label: "Business",    count: events.filter(function(e){return e.category==="business";}).length, builtin: true },
      { k: "subscription", label: "Subs",        count: events.filter(function(e){return e.category==="subscription";}).length, builtin: true },
      { k: "utility",      label: "Utilities",   count: events.filter(function(e){return e.category==="utility";}).length, builtin: true },
      { k: "insurance",    label: "Insurance",   count: events.filter(function(e){return e.category==="insurance";}).length, builtin: true },
      { k: "income",       label: "Income",      count: events.filter(function(e){return e.category==="income";}).length, builtin: true },
      { k: "transfers",    label: "Transfers",   count: events.filter(function(e){return e.category==="transfers";}).length, builtin: true }
    ];
    // Append user-defined categories
    loadUserCategories().forEach(function(u){
      FILTERS.push({ k: u.key, label: u.label, count: events.filter(function(e){return e.category===u.key;}).length, builtin: false });
    });

    var titleStr = state.view === "quarter"
      ? `Quarter starting ${MONTHS_SHORT[state.viewMonth]} ${state.viewYear}`
      : `${MONTHS_FULL[state.viewMonth]} ${state.viewYear}`;

    var filterChips = FILTERS.map(function (f) {
      var active = state.filter === f.k;
      var cs = f.k === "all" ? { color: "var(--ink, #0a0a0a)", bg: "var(--bg-2, rgba(0,0,0,0.06))", border: "var(--border, rgba(0,0,0,0.10))" } : categoryStyle(f.k);
      var removeBtn = (!f.builtin) ? `<span data-cal-remove-cat="${escapeHTML(f.k)}" title="Remove category" style="margin-left:2px;font-weight:800;cursor:pointer;opacity:.6;">×</span>` : "";
      return `<button type="button" data-cal-filter="${f.k}"
        style="border:1px solid ${active ? cs.color : cs.border};background:${active ? cs.color : cs.bg};color:${active ? "#fff" : cs.color};padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:-0.005em;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;">
        ${escapeHTML(f.label)}<span style="font-weight:600;opacity:.7;">${f.count}</span>${removeBtn}
      </button>`;
    }).join("") + `<button type="button" data-cal-add-cat
      style="border:1px dashed var(--border, rgba(0,0,0,0.25));background:transparent;color:var(--ink-dim, #6b7280);padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:-0.005em;cursor:pointer;font-family:inherit;">+ Add</button>`;

    var monthBtnStyle = `border:0;background:${state.view==="month"?"#0a0a0a":"transparent"};color:${state.view==="month"?"#fff":"#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var quarterBtnStyle = `border:0;background:${state.view==="quarter"?"#0a0a0a":"transparent"};color:${state.view==="quarter"?"#fff":"#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var heatmapStyle = `border:1px solid ${state.heatmap ? "#dc2626" : "rgba(0,0,0,0.10)"};background:${state.heatmap ? "rgba(220,38,38,0.08)" : "transparent"};color:${state.heatmap ? "#dc2626" : "#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var lightBtnStyle = `border:1px solid var(--border, rgba(0,0,0,0.10));background:var(--card, #fff);color:var(--ink, #0a0a0a);font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;

    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-faint, #9ca3af);font-weight:700;margin-bottom:4px;">Calendar</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">
            <span data-cal-prev style="cursor:pointer;color:var(--ink-faint, #9ca3af);padding:0 6px;user-select:none;">‹</span>${titleStr}<span data-cal-next style="cursor:pointer;color:var(--ink-faint, #9ca3af);padding:0 6px;user-select:none;">›</span>
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;font-size:12px;color:var(--ink-dim, #6b7280);flex-wrap:wrap;">
          <span style="font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-faint, #9ca3af);font-weight:700;">${(state.viewYear === new Date().getFullYear() && state.viewMonth === new Date().getMonth()) ? "Month to date" : (todayKey_ < (state.viewYear + "-" + String(state.viewMonth + 1).padStart(2, "0") + "-01") ? "Forecast" : "Full month")}</span>
          <span>Out: <b style="color:#dc2626;">${fmtUSD(monthOut)}</b></span>
          <span>In: <b style="color:#1f7a4a;">${fmtUSD(monthIn)}</b></span>
          <span>Net: <b style="color:${netColor};">${fmtUSD(net)}</b></span>
          <div style="display:inline-flex;background:var(--bg-2, rgba(0,0,0,0.05));border-radius:999px;padding:2px;">
            <button type="button" data-cal-view="month" style="${monthBtnStyle}">Month</button>
            <button type="button" data-cal-view="quarter" style="${quarterBtnStyle}">Quarter</button>
          </div>
          <button type="button" data-cal-heatmap style="${heatmapStyle}">Heatmap</button>
          <button type="button" data-cal-export style="${lightBtnStyle}display:inline-flex;align-items:center;gap:4px;">↓ .ics</button>
          <button type="button" data-cal-balance style="${lightBtnStyle}">Set balance</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${filterChips}</div>
    `;
  }

  function buildSuggestionBanner(events) {
    var sugs = buildSuggestions(events);
    if (!sugs.length) return "";
    var s = sugs[0];
    return `<div class="wjp-cal-suggestion-pulse" data-cal-sug-id="${s.id}" style="border:1px solid rgba(31,122,74,0.30);background:linear-gradient(135deg,rgba(31,122,74,0.06),rgba(201,154,42,0.04));border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;font-family:var(--sans,Inter,system-ui,sans-serif);">
      <span style="font-size:18px;">💡</span>
      <div style="flex:1;font-size:12.5px;color:var(--ink, #0a0a0a);line-height:1.45;"><b>Smart suggestion:</b> ${escapeHTML(s.message)}</div>
      <button type="button" data-cal-sug-dismiss="${s.id}" style="background:transparent;border:0;color:var(--ink-faint, #9ca3af);font-size:18px;cursor:pointer;line-height:1;">×</button>
    </div>`;
  }

  function buildDayPanel(date, events, note) {
    var dt = new Date(date + "T12:00:00");
    var pretty = dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    var eventsHTML = "";
    if (events.length) {
      eventsHTML = `<div style="display:grid;gap:6px;margin-bottom:16px;">` + events.map(function (e) {
        var s = categoryStyle(e.category);
        var srcLabel = e.source === "plaid" ? `Plaid · ${escapeHTML(e.institutionName || "Bank")}` : `Scheduled · ${escapeHTML(e.type || "recurring")}`;
        var amtSign = e.category === "income" ? "+" : "−";
        var amtColor = e.category === "income" ? "#1f7a4a" : s.color;
        var ovBadge = e.categorySource === "override" ? `<span title="You set this category" style="font-size:9px;color:#1f7a4a;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-left:6px;">SAVED</span>` : "";
        var picker = (state.catEditingFor && state.catEditingFor.eventId === e.id) ? `
          <div class="wjp-cal-cat-picker">
            ${allCategories().map(function (c) {
              var cs2 = categoryStyle(c);
              var active = e.category === c;
              var bg = active ? cs2.color : "#fff";
              var fg = active ? "#fff" : cs2.color;
              return `<button type="button" data-cal-cat-pick="${c}" data-cal-cat-merch="${escapeAttr(e.merchantKey || "")}" data-cal-cat-event="${escapeAttr(e.id)}" class="wjp-cal-cat-chip ${active ? "wjp-cal-cat-chip-active" : ""}" style="background:${bg};color:${fg};border-color:${cs2.border};">${escapeHTML(c)}</button>`;
            }).join("")}
            ${e.categorySource === "override" ? `<button type="button" data-cal-cat-clear="${escapeAttr(e.merchantKey || "")}" class="wjp-cal-cat-chip" style="color:#dc2626;border-color:rgba(220,38,38,0.30);">Clear override</button>` : ""}
          </div>
        ` : "";
        return `<div style="border:1px solid ${s.border};border-radius:8px;background:${s.bg};">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;">
            <div style="display:flex;flex-direction:column;line-height:1.25;flex:1;min-width:0;">
              <span style="font-size:12.5px;font-weight:700;color:var(--ink, #0a0a0a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHTML(e.name)}${e.moved ? ` <span style="color:#c99a2a;font-weight:800;" title="moved">↻</span>` : ""}
              </span>
              <span style="font-size:10.5px;color:var(--ink-dim, #6b7280);font-weight:600;">${srcLabel}${e.status ? " · " + escapeHTML(e.status) : ""}${ovBadge}</span>
            </div>
            <button type="button" data-cal-cat-edit="${escapeAttr(e.id)}" class="wjp-cal-cat-pill" style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;background:${s.color};color:#fff;padding:3px 9px;border:0;border-radius:999px;font-weight:800;font-family:inherit;">${escapeHTML(e.category)}</button>
            <span style="font-size:13px;font-weight:800;color:${amtColor};white-space:nowrap;">${amtSign}${fmtUSD(e.amount)}</span>
          </div>
          ${picker}
        </div>`;
      }).join("") + `</div>`;
    } else {
      eventsHTML = `<div style="font-size:12.5px;color:var(--ink-faint, #9ca3af);margin-bottom:16px;">No payments scheduled.</div>`;
    }
    var noteText = note ? note.text : "";
    var reminderAt = note && note.reminderAt ? new Date(note.reminderAt) : null;
    var reminderVal = reminderAt ? reminderAt.toISOString().slice(0, 16) : "";

    return `<div id="wjp-cal-day-panel" style="margin-top:18px;background:var(--card, #fff);border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:14px;padding:18px 20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:14.5px;font-weight:700;letter-spacing:-0.01em;">${pretty}</div>
        <button type="button" data-cal-close style="background:transparent;border:0;color:var(--ink-faint, #9ca3af);font-size:20px;cursor:pointer;line-height:1;">×</button>
      </div>
      ${eventsHTML}
      <div style="border-top:1px solid var(--border, rgba(0,0,0,0.06));padding-top:14px;">
        <div style="font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-faint, #9ca3af);font-weight:700;margin-bottom:8px;">Your note</div>
        <textarea data-cal-note placeholder="Add a note for this day…" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border, rgba(0,0,0,0.12));border-radius:8px;font-family:inherit;font-size:13px;color:var(--ink, #0a0a0a);resize:vertical;background:var(--card, #fff);">${escapeHTML(noteText)}</textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-dim, #6b7280);font-weight:600;">
            Remind me at:
            <input type="datetime-local" data-cal-reminder value="${reminderVal}" style="border:1px solid var(--border, rgba(0,0,0,0.12));border-radius:6px;padding:5px 8px;font-family:inherit;font-size:12px;">
          </label>
          <button type="button" data-cal-save style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>
          ${note ? `<button type="button" data-cal-delete style="background:transparent;color:#dc2626;border:1px solid rgba(220,38,38,0.30);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Delete</button>` : ""}
          <span style="font-size:10.5px;color:var(--ink-faint, #9ca3af);flex:1;text-align:right;">Reminders use browser notifications · click to allow</span>
        </div>
      </div>
    </div>`;
  }

  function buildHTML(events) {
    var filtered = state.filter === "all" ? events : events.filter(function (e) { return e.category === state.filter; });

    var grid;
    if (state.view === "quarter") {
      var months = "";
      for (var i = 0; i < 3; i++) {
        var m = state.viewMonth + i, y = state.viewYear;
        while (m > 11) { m -= 12; y++; }
        months += `<div>
          <div style="font-size:13px;font-weight:700;letter-spacing:-0.005em;margin-bottom:6px;color:var(--ink, #0a0a0a);">${MONTHS_FULL[m]} ${y}</div>
          ${buildMonthGrid(filtered, y, m, { compact: true })}
        </div>`;
      }
      grid = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">${months}</div>`;
    } else {
      grid = buildMonthGrid(filtered, state.viewYear, state.viewMonth, { compact: false });
    }

    var dayPanel = "";
    if (state.selectedDate) {
      var sel = state.selectedDate;
      var selEvents = events.filter(function (e) { return e.date === sel; });
      var selNote = loadNotes()[sel] || null;
      dayPanel = buildDayPanel(sel, selEvents, selNote);
    }

    return `<div style="font-family:var(--sans,Inter,system-ui,sans-serif);color:var(--ink,#0a0a0a);padding:18px 0 24px;">
      ${buildSuggestionBanner(events)}
      ${buildHeader(events)}
      ${grid}
      ${dayPanel}
      ${rootPopoverHTML()}
    </div>`;
  }

  // ============================================================
  // Drag/drop
  // ============================================================
  function attachDragHandlers(host) {
    Array.from(host.querySelectorAll(".wjp-cal-chip[draggable]")).forEach(function (chip) {
      chip.addEventListener("dragstart", function (e) {
        try {
          state.dragging = {
            origDate: chip.dataset.calDragOrig,
            curDate:  chip.dataset.calDragCur,
            name:     chip.dataset.calDragName
          };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", chip.dataset.calDragName);
        } catch (_) {}
      });
      chip.addEventListener("dragend", function () {
        state.dragging = null;
        Array.from(host.querySelectorAll(".wjp-cal-drop-target")).forEach(function (n) { n.classList.remove("wjp-cal-drop-target"); });
      });
    });
    Array.from(host.querySelectorAll(".wjp-cal-cell[data-cal-day]")).forEach(function (cell) {
      cell.addEventListener("dragover", function (e) {
        if (!state.dragging) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
        cell.classList.add("wjp-cal-drop-target");
      });
      cell.addEventListener("dragleave", function () { cell.classList.remove("wjp-cal-drop-target"); });
      cell.addEventListener("drop", function (e) {
        if (!state.dragging) return;
        e.preventDefault();
        cell.classList.remove("wjp-cal-drop-target");
        var newDate = cell.dataset.calDay;
        var origDate = state.dragging.origDate;
        var name = state.dragging.name;
        var ovKey = origDate + "|" + name;
        var overrides = loadOverrides();
        if (newDate === origDate) delete overrides[ovKey];
        else overrides[ovKey] = newDate;
        saveOverrides(overrides);
        state.dragging = null;
        rerender(findHost());
      });
    });
  }

  // ============================================================
  // Click handlers
  // ============================================================
  function attachClickHandlers(host) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;

    // Filter chips
    Array.from(root.querySelectorAll("[data-cal-filter]")).forEach(function (b) {
      b.addEventListener("click", function (ev) {
        // Stop click if user clicked the remove × inside the button
        if (ev.target && ev.target.dataset && ev.target.dataset.calRemoveCat) {
          ev.stopPropagation();
          var k = ev.target.dataset.calRemoveCat;
          if (!confirm("Remove category \"" + k + "\"? Events in this category will fall back to auto-classification.")) return;
          var arr = loadUserCategories().filter(function(u){return u.key !== k;});
          saveUserCategories(arr);
          if (state.filter === k) state.filter = "all";
          rerender(host);
          return;
        }
        state.filter = b.dataset.calFilter;
        try { localStorage.setItem(LS_FILTER, state.filter); } catch (_) {}
        rerender(host);
      });
    });
    // "+ Add" button
    var addBtn = root.querySelector("[data-cal-add-cat]");
    if (addBtn) addBtn.addEventListener("click", function () {
      var label = prompt("Category name (e.g. \"Pets\", \"Travel\", \"Health\")");
      if (!label) return;
      label = label.trim().slice(0, 24);
      if (!label) return;
      var key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
      if (!key) return;
      // Pick a color from a curated palette (rotate to avoid exact built-in matches)
      var palette = [
        { color: "#db2777", bg: "rgba(219,39,119,0.10)", border: "rgba(219,39,119,0.25)" }, // pink
        { color: "#16a34a", bg: "rgba(22,163,74,0.10)",  border: "rgba(22,163,74,0.25)" },  // green-600
        { color: "#ca8a04", bg: "rgba(202,138,4,0.10)",  border: "rgba(202,138,4,0.25)" },  // amber
        { color: "#0d9488", bg: "rgba(13,148,136,0.10)", border: "rgba(13,148,136,0.25)" }, // teal
        { color: "#9333ea", bg: "rgba(147,51,234,0.10)", border: "rgba(147,51,234,0.25)" }, // violet
        { color: "#65a30d", bg: "rgba(101,163,13,0.10)", border: "rgba(101,163,13,0.25)" }  // lime
      ];
      var existing = loadUserCategories();
      if (existing.some(function(u){return u.key === key;})) { alert("That category already exists."); return; }
      var c = palette[existing.length % palette.length];
      existing.push({ key: key, label: label, color: c.color, bg: c.bg, border: c.border });
      saveUserCategories(existing);
      rerender(host);
    });

    // View toggle
    Array.from(root.querySelectorAll("[data-cal-view]")).forEach(function (b) {
      b.addEventListener("click", function () {
        state.view = b.dataset.calView;
        try { localStorage.setItem(LS_VIEW, state.view); } catch (_) {}
        rerender(host);
      });
    });

    // Heatmap toggle
    var hm = root.querySelector("[data-cal-heatmap]");
    if (hm) hm.addEventListener("click", function () {
      state.heatmap = !state.heatmap;
      try { localStorage.setItem(LS_HEATMAP, state.heatmap ? "1" : "0"); } catch (_) {}
      rerender(host);
    });

    // ICS export
    var ex = root.querySelector("[data-cal-export]");
    if (ex) ex.addEventListener("click", function () {
      var events = harvestEvents();
      downloadICS(events);
      showToast("Calendar exported · check your downloads");
    });

    // Set balance
    var bal = root.querySelector("[data-cal-balance]");
    if (bal) bal.addEventListener("click", function () {
      var current = loadStartBalance();
      var v = prompt("Your current checking balance (used for the running-balance forecast). Leave empty to clear.", current != null ? current : "");
      if (v === null) return;
      if (v.trim() === "") { try { localStorage.removeItem(LS_BALANCE); } catch (_) {} }
      else {
        var n = parseFloat(v.replace(/[$,]/g, ""));
        if (isFinite(n)) saveStartBalance(n);
      }
      rerender(host);
    });

    // Suggestion dismiss
    var sd = root.querySelector("[data-cal-sug-dismiss]");
    if (sd) sd.addEventListener("click", function () {
      var id = sd.dataset.calSugDismiss;
      var dis = loadDismissed();
      dis[id] = Date.now();
      saveDismissed(dis);
      rerender(host);
    });

    // Month navigation
    var prev = root.querySelector("[data-cal-prev]");
    if (prev) prev.addEventListener("click", function () {
      var step = state.view === "quarter" ? 3 : 1;
      state.viewMonth -= step; while (state.viewMonth < 0) { state.viewMonth += 12; state.viewYear--; }
      rerender(host);
    });
    var next = root.querySelector("[data-cal-next]");
    if (next) next.addEventListener("click", function () {
      var step = state.view === "quarter" ? 3 : 1;
      state.viewMonth += step; while (state.viewMonth > 11) { state.viewMonth -= 12; state.viewYear++; }
      rerender(host);
    });

    // Day cell click → open day panel
    Array.from(root.querySelectorAll("[data-cal-day]")).forEach(function (cell) {
      cell.addEventListener("click", function (e) {
        if (state.dragging) return;
        if (e.target && e.target.closest && (
            e.target.closest("[data-cal-day-menu]") ||
            e.target.closest("[data-cal-popover-day]") ||
            e.target.closest("[data-cal-day-action]")
        )) return; // let menu handlers do their thing
        state.selectedDate = cell.dataset.calDay;
        state.dayMenuFor = null;
        rerender(host);
        setTimeout(function () {
          var p = document.getElementById("wjp-cal-day-panel");
          if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      });
    });

    // 3-dot day menu (toggle)
    Array.from(root.querySelectorAll("[data-cal-day-menu]")).forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var d = btn.dataset.calDayMenu;
        state.dayMenuFor = (state.dayMenuFor === d) ? null : d;
        rerender(host);
      });
    });

    // Popover items
    Array.from(root.querySelectorAll("[data-cal-day-action]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var action = b.dataset.calDayAction;
        var date = b.closest("[data-cal-popover-day]").dataset.calPopoverDay;
        state.dayMenuFor = null;
        if (action === "add-note" || action === "add-reminder" || action === "view-details") {
          state.selectedDate = date;
          rerender(host);
          setTimeout(function () {
            var p = document.getElementById("wjp-cal-day-panel");
            if (!p) return;
            p.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(function () {
              if (action === "add-note") {
                var ta = p.querySelector("[data-cal-note]");
                if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
              } else if (action === "add-reminder") {
                var rm = p.querySelector("[data-cal-reminder]");
                if (rm) { try { rm.focus(); if (rm.showPicker) rm.showPicker(); } catch (_) {} }
              }
            }, 350);
          }, 80);
        } else if (action === "copy-date") {
          try {
            navigator.clipboard.writeText(date);
            showToast("Copied " + date);
          } catch (_) {}
          rerender(host);
        }
      });
    });

    // Close popover when clicking outside
    if (state.dayMenuFor) {
      var closer = function (e) {
        if (e.target.closest && (e.target.closest("[data-cal-day-menu]") || e.target.closest("[data-cal-popover-day]") || e.target.closest("[data-cal-day-action]"))) return;
        state.dayMenuFor = null;
        document.removeEventListener("click", closer, true);
        rerender(host);
      };
      setTimeout(function () { document.addEventListener("click", closer, true); }, 0);
    }

    // Position the root-level popover next to its trigger button
    if (state.dayMenuFor) {
      var trigger = root.querySelector('[data-cal-day-menu="' + state.dayMenuFor + '"]');
      var popover = root.querySelector('.wjp-cal-popover-fixed');
      if (trigger && popover) {
        var r = trigger.getBoundingClientRect();
        var popW = 200, popH = popover.offsetHeight || 168;
        // Anchor side-by-side with the trigger so it always sits glued to the
        // clicked cell — left of the dot if there's room, otherwise right.
        var leftPx = r.left - popW - 8;
        if (leftPx < 8) leftPx = r.right + 6;
        if (leftPx + popW > window.innerWidth - 8) leftPx = window.innerWidth - popW - 8;
        // Vertically align with the dot, but clamp to viewport.
        var topPx = r.top - 4;
        if (topPx + popH > window.innerHeight - 8) topPx = window.innerHeight - popH - 8;
        if (topPx < 8) topPx = 8;
        popover.style.left   = leftPx + "px";
        popover.style.top    = topPx + "px";
        popover.style.minWidth = popW + "px";
      }
    }

    // Close button on day panel
    var close = root.querySelector("[data-cal-close]");
    if (close) close.addEventListener("click", function () { state.selectedDate = null; rerender(host); });

    // Save note
    var save = root.querySelector("[data-cal-save]");
    if (save) save.addEventListener("click", function () {
      var ta = root.querySelector("[data-cal-note]");
      var rm = root.querySelector("[data-cal-reminder]");
      var reminderAt = null;
      if (rm && rm.value) { var t = new Date(rm.value).getTime(); if (isFinite(t)) reminderAt = t; }
      setNote(state.selectedDate, ta ? ta.value : "", reminderAt);
      if (reminderAt && "Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (_) {}
      }
      showToast("Note saved");
      rerender(host);
    });
    var del = root.querySelector("[data-cal-delete]");
    if (del) del.addEventListener("click", function () { setNote(state.selectedDate, "", null); rerender(host); });

    // Category edit (open picker)
    Array.from(root.querySelectorAll("[data-cal-cat-edit]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = b.dataset.calCatEdit;
        if (state.catEditingFor && state.catEditingFor.eventId === id) state.catEditingFor = null;
        else state.catEditingFor = { eventId: id };
        rerender(host);
      });
    });

    // Category pick (save override)
    Array.from(root.querySelectorAll("[data-cal-cat-pick]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var cat = b.dataset.calCatPick;
        var merchKey = b.dataset.calCatMerch;
        var name = (function () {
          // pull readable merchant name from the row
          var row = b.closest("[style]").previousSibling;
          return null;
        })();
        if (merchKey) {
          setMerchantCategory(merchKey, cat);
          showToast("Saved · " + cat + " · applies to future " + (merchKey || "events"));
        }
        state.catEditingFor = null;
        rerender(host);
      });
    });

    // Clear override
    Array.from(root.querySelectorAll("[data-cal-cat-clear]")).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var merchKey = b.dataset.calCatClear;
        if (merchKey) {
          setMerchantCategory(merchKey, null);
          showToast("Override cleared");
        }
        state.catEditingFor = null;
        rerender(host);
      });
    });
  }

  // ============================================================
  // Render orchestration
  // ============================================================
  function rerender(host) {
    if (!host) return;
    var events = harvestEvents();
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.style.cssText = "width:100%;";
      host.appendChild(root);
    }
    root.innerHTML = buildHTML(events);
    attachClickHandlers(host);
    attachDragHandlers(root);
  }

  function tick() {
    try {
      checkReminders();
      ensureStyle();
      var host = findHost();
      if (!host) return;
      hideOriginalContent(host);
      rerender(host);
    } catch (e) {
      try { console.warn("[wjp-cal-redesign v4] tick threw", e); } catch (_) {}
    }
  }

  function boot() {
    tick();
    setInterval(tick, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_CalRedesign = {
    refresh: tick,
    _state: state,
    _harvest: harvestEvents,
    _resetNotes:        function () { try { localStorage.removeItem(LS_NOTES); } catch (_) {} },
    _resetOverrides:    function () { try { localStorage.removeItem(LS_OVERRIDES); } catch (_) {} },
    _resetMerchantCats: function () { try { localStorage.removeItem(LS_MERCHANT_CAT); } catch (_) {} },
    _setBalance:        saveStartBalance,
    _merchantKey:       merchantKey,
    _autoClassify:      autoClassify
  };
})();
