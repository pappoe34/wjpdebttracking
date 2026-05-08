/* wjp-calendar-redesign.js v4.5 — Plaid feed + merchant overrides + 3-dot menu.
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

  var CATEGORIES = ["debt","housing","subscription","utility","insurance","income","transfers","other"];

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

  function loadNotes()      { return loadJSON(LS_NOTES, {}); }
  function saveNotes(o)     { saveJSON(LS_NOTES, o); }
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
    if (/payday|paycheck|payroll|direct\s*dep|wire\s*in|incoming|deposit\b|salary|benefit/.test(s)) return "income";
    if (/^zelle\b|\bzelle\b/.test(s)) return "transfers";
    if (/cash\s*app|venmo|paypal\s+(transfer|send)/.test(s)) return "transfers";
    if (/transfer\s+from|transfer\s+to|internal\s+xfer|online\s+transfer|wire\s+out/.test(s)) return "transfers";
    if (/electric|\bgas\b|\bpower\b|water\s+co|sewer|internet|verizon|comcast|xfinity|t[-]?mobile|at\s*&\s*t|phone\s+bill|att|spectrum/.test(s)) return "utility";
    if (/insurance|policy|coverage|geico|progressive|state\s+farm|allstate|esurance|liberty\s+mutual|farmers/.test(s)) return "insurance";
    if (/netflix|spotify|hulu|disney|paramount|claude|chatgpt|anthropic|openai|adobe|microsoft\s*365|prime\s+video|youtube\s+premium|\bgym\b|peloton|nytimes|washingtonpost|patreon|substack|membership|subscription/.test(s)) return "subscription";
    if (/\brent\b|rental\s+payment|mortgage|\bmtg\b|landlord|property\s+(mgmt|management|manager)|\bhoa\b|homeowners|apartment\s+pay|home\s+(loan|payment)/.test(s)) return "housing";
    if (/avant|affirm|klarna|sofi|capital\s+one|milestone|credit\s+one|brightway|westlake|aidadvantage|one\s+main|credit\s+card|\bloan\b/.test(s)) return "debt";
    return "other";
  }

  function categoryStyle(cat) {
    switch (cat) {
      case "debt":         return { color: "#dc2626", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.25)" };
      case "subscription": return { color: "#7c3aed", bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.25)" };
      case "utility":      return { color: "#0284c7", bg: "rgba(2,132,199,0.10)", border: "rgba(2,132,199,0.25)" };
      case "insurance":    return { color: "#c99a2a", bg: "rgba(201,154,42,0.12)", border: "rgba(201,154,42,0.30)" };
      case "income":       return { color: "#1f7a4a", bg: "rgba(31,122,74,0.12)", border: "rgba(31,122,74,0.30)" };
      case "transfers":    return { color: "#0891b2", bg: "rgba(8,145,178,0.10)", border: "rgba(8,145,178,0.25)" };
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
    if (/transfer\s+from\s+acct/.test(s)) return true;
    if (/transfer\s+to\s+acct/.test(s)) return true;
    if (/online\s+banking\s+transfer/.test(s)) return true;
    if (/internal\s+xfer/.test(s)) return true;
    if (/\bxfer\b/.test(s)) return true;
    if (/wire\s+(in|out)\s+from\s+(self|own)/.test(s)) return true;
    // Interest charges are fees, not payments
    if (/interest\s+charge/.test(s)) return true;
    // Internal bank ATM activity (deposits to one's own account aren't bills)
    if (/\bbkofamerica\s+atm\b/.test(s) && /deposit/.test(s)) return true;
    if (/\batm\s+\d+.*deposit\b/.test(s)) return true;
    return false;
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

    var ovDate = loadOverrides();

    // 1. Recurring payments (scheduled)
    (raw.recurringPayments || []).forEach(function (rp) {
      if (!rp || !rp.nextDate || rp.amount == null) return;
      var origDate = String(rp.nextDate).slice(0, 10);
      var ovKey = origDate + "|" + (rp.name || "");
      var date = ovDate[ovKey] || origDate;
      events.push({
        id: "rp:" + (rp.id || (origDate + "|" + (rp.name || ""))),
        date: date,
        origDate: origDate,
        name: simplifyDisplayName(rp.name || "Payment"),
        rawName: rp.name || "Payment",
        merchant: rp.name || "",
        amount: Math.abs(rp.amount),
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

    // 2. Plaid transactions (filter to window + significance + skip noise)
    (raw.transactions || []).forEach(function (tx) {
      if (!tx || !tx.date || tx.amount == null) return;
      var t = new Date(String(tx.date).slice(0, 10) + "T12:00:00").getTime();
      if (!isFinite(t)) return;
      if (t < minMs || t > maxMs) return;
      var amt = Math.abs(Number(tx.amount));
      if (!isFinite(amt) || amt < 25) return; // significance gate
      if (isNoisyTransaction(tx)) return;     // skip internal bank chatter
      var origDate = String(tx.date).slice(0, 10);
      var ovKey = origDate + "|" + (tx.merchant || tx.id || "");
      var date = ovDate[ovKey] || origDate;
      events.push({
        id: "tx:" + (tx.id || (origDate + "|" + (tx.merchant || ""))),
        date: date,
        origDate: origDate,
        name: simplifyDisplayName(tx.merchant || "Transaction"),
        rawName: tx.merchant || "Transaction",
        merchant: tx.merchant || "",
        amount: amt,
        category: "", // resolved later via override → autoClassify
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
      dayMap[e.date] += (e.category === "income" ? e.amount : -e.amount);
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
      .wjp-cal-cell { height:112px; padding:6px 8px; border-right:1px solid rgba(0,0,0,0.05); cursor:pointer; transition:background .15s; position:relative; overflow:hidden; display:flex; flex-direction:column; }
      .wjp-cal-cell:hover { background: rgba(0,0,0,0.025); }
      .wjp-cal-cell:hover .wjp-cal-day-menu { opacity: 1; }
      .wjp-cal-today { background: rgba(31,122,74,0.04); }
      .wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.08); }
      .wjp-cal-payday-col::before { content:''; position:absolute; left:0; top:6px; bottom:6px; width:2px; background:#1f7a4a; border-radius:2px; opacity:0.55; pointer-events:none; }
      .wjp-cal-day-menu { opacity: 0; transition: opacity .15s; background:transparent; border:0; cursor:pointer; padding:2px 4px; border-radius:6px; line-height:1; color:#9ca3af; font-weight:700; }
      .wjp-cal-day-menu:hover { background: rgba(0,0,0,0.06); color:#0a0a0a; }
      .wjp-cal-day-menu-open { opacity: 1; background: rgba(0,0,0,0.06); color:#0a0a0a; }
      .wjp-cal-popover { position:absolute; right:6px; top:30px; z-index:50; background:#fff; border:1px solid rgba(0,0,0,0.10); border-radius:10px; box-shadow:0 10px 32px rgba(0,0,0,0.15); padding:6px; min-width:180px; }
      .wjp-cal-popover-fixed { position:fixed !important; right:auto; top:auto; z-index:99999 !important; }
      .wjp-cal-popover-item { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; background:transparent; border:0; border-radius:6px; cursor:pointer; font-family:inherit; font-size:12.5px; color:#0a0a0a; text-align:left; line-height:1.2; }
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
      .wjp-cal-cat-chip { border:1px solid var(--border, rgba(0,0,0,0.10)); background:#fff; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; }
      .wjp-cal-cat-chip-active { background:#0a0a0a; color:#fff; border-color:#0a0a0a; }
      .wjp-cal-toast { position:fixed; bottom:30px; left:50%; transform:translateX(-50%) translateY(20px); opacity:0; background:#0a0a0a; color:#fff; padding:10px 16px; border-radius:999px; font-size:12.5px; font-family:var(--sans,Inter,system-ui,sans-serif); font-weight:600; box-shadow:0 12px 32px rgba(0,0,0,0.25); z-index:99999; pointer-events:none; transition:opacity .25s, transform .25s; }
      .wjp-cal-toast-show { opacity:1; transform:translateX(-50%) translateY(0); }
      @keyframes wjpPulse { 0%,100% { opacity:.65 } 50% { opacity:1 } }
      .wjp-cal-suggestion-pulse { animation: wjpPulse 2.4s ease-in-out infinite; }
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
      var sum = byDate[k].reduce(function (s, e) { return s + (e.category === "income" ? 0 : e.amount); }, 0);
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
      return `<div style="padding:${compact ? "5px 6px" : "8px 10px"};font-size:${compact ? "8.5px" : "9.5px"};letter-spacing:0.14em;font-weight:700;color:#9ca3af;text-align:left;border-right:1px solid rgba(0,0,0,0.05);">${label}</div>`;
    }).join("");

    var weekHTML = weeks.map(function (week) {
      var cellsHTML = week.map(function (cell) {
        if (cell.blank) {
          return `<div style="${compact ? "height:64px;" : "height:112px;"}background:rgba(0,0,0,0.015);border-right:1px solid rgba(0,0,0,0.05);"></div>`;
        }
        var total = (cell.events || []).reduce(function (s, e) { return s + (e.category === "income" ? 0 : e.amount); }, 0);
        var hasOverdue = (cell.events || []).some(isOverdue);
        var bg = "";
        if (state.heatmap && total > 0 && maxOut > 0) {
          var intensity = Math.min(1, total / maxOut);
          bg = `background:rgba(220,38,38,${(0.06 + intensity * 0.32).toFixed(2)});`;
        }
        var dayNum = cell.isToday
          ? `<span class="wjp-cal-day-num" style="font-size:${compact ? "10px" : "11.5px"};font-weight:700;color:#fff;background:#1f7a4a;width:${compact ? "16px" : "20px"};height:${compact ? "16px" : "20px"};border-radius:50%;display:inline-flex;align-items:center;justify-content:center;">${cell.day}</span>`
          : `<span class="wjp-cal-day-num" style="font-size:${compact ? "10px" : "11.5px"};font-weight:700;color:#0a0a0a;">${cell.day}</span>`;
        var dotsAndTotal = [
          cell.note ? `<span title="Has note" style="width:5px;height:5px;border-radius:50%;background:#c99a2a;"></span>` : "",
          hasOverdue ? `<span title="Overdue/late" style="width:6px;height:6px;border-radius:50%;background:#dc2626;"></span>` : "",
          (total > 0 && !compact) ? `<span style="font-size:9.5px;color:#6b7280;font-weight:700;">${fmtUSD(total)}</span>` : "",
          !compact ? `<button type="button" class="wjp-cal-day-menu${state.dayMenuFor === cell.date ? " wjp-cal-day-menu-open" : ""}" data-cal-day-menu="${cell.date}" title="Day options" aria-label="Day options">⋮</button>` : ""
        ].join("");
        var visible = (cell.events || []).slice(0, compact ? 1 : 2);
        var chipsHTML = visible.map(function (e) { return chipHTML(e, !compact, compact); }).join("");
        var more = (cell.events || []).length - visible.length;
        if (more > 0) chipsHTML += `<div style="font-size:${compact ? "8.5px" : "9.5px"};color:#9ca3af;font-weight:700;">+${more} more</div>`;
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
      return `<div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid rgba(0,0,0,0.05);">${cellsHTML}</div>`;
    }).join("");

    return `<div style="border:1px solid rgba(0,0,0,0.08);border-radius:14px;overflow:hidden;background:#fff;">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);background:rgba(0,0,0,0.025);">${headerCells}</div>
      ${weekHTML}
    </div>`;
  }

  function buildHeader(events) {
    var monthEvents = events.filter(function (e) {
      return e.date.startsWith(state.viewYear + "-" + String(state.viewMonth + 1).padStart(2, "0"));
    });
    var monthOut = 0, monthIn = 0;
    monthEvents.forEach(function (e) {
      if (e.category === "income") monthIn += e.amount; else monthOut += e.amount;
    });
    var net = monthIn - monthOut;
    var netColor = net >= 0 ? "#1f7a4a" : "#dc2626";

    var FILTERS = [
      { k: "all",          label: "All",         count: events.length },
      { k: "debt",         label: "Debts",       count: events.filter(function(e){return e.category==="debt";}).length },
      { k: "housing",      label: "Rent/Home",   count: events.filter(function(e){return e.category==="housing";}).length },
      { k: "subscription", label: "Subs",        count: events.filter(function(e){return e.category==="subscription";}).length },
      { k: "utility",      label: "Utilities",   count: events.filter(function(e){return e.category==="utility";}).length },
      { k: "insurance",    label: "Insurance",   count: events.filter(function(e){return e.category==="insurance";}).length },
      { k: "income",       label: "Income",      count: events.filter(function(e){return e.category==="income";}).length },
      { k: "transfers",    label: "Transfers",   count: events.filter(function(e){return e.category==="transfers";}).length }
    ];

    var titleStr = state.view === "quarter"
      ? `Quarter starting ${MONTHS_SHORT[state.viewMonth]} ${state.viewYear}`
      : `${MONTHS_FULL[state.viewMonth]} ${state.viewYear}`;

    var filterChips = FILTERS.map(function (f) {
      var active = state.filter === f.k;
      var cs = f.k === "all" ? { color: "#0a0a0a", bg: "rgba(0,0,0,0.06)", border: "rgba(0,0,0,0.10)" } : categoryStyle(f.k);
      return `<button type="button" data-cal-filter="${f.k}"
        style="border:1px solid ${active ? cs.color : cs.border};background:${active ? cs.color : cs.bg};color:${active ? "#fff" : cs.color};padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:-0.005em;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;">
        ${escapeHTML(f.label)}<span style="font-weight:600;opacity:.7;">${f.count}</span>
      </button>`;
    }).join("");

    var monthBtnStyle = `border:0;background:${state.view==="month"?"#0a0a0a":"transparent"};color:${state.view==="month"?"#fff":"#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var quarterBtnStyle = `border:0;background:${state.view==="quarter"?"#0a0a0a":"transparent"};color:${state.view==="quarter"?"#fff":"#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var heatmapStyle = `border:1px solid ${state.heatmap ? "#dc2626" : "rgba(0,0,0,0.10)"};background:${state.heatmap ? "rgba(220,38,38,0.08)" : "transparent"};color:${state.heatmap ? "#dc2626" : "#6b7280"};font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;
    var lightBtnStyle = `border:1px solid rgba(0,0,0,0.10);background:#fff;color:#0a0a0a;font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;`;

    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:4px;">Calendar</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">
            <span data-cal-prev style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">‹</span>${titleStr}<span data-cal-next style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">›</span>
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;font-size:12px;color:#6b7280;flex-wrap:wrap;">
          <span>Out: <b style="color:#dc2626;">${fmtUSD(monthOut)}</b></span>
          <span>In: <b style="color:#1f7a4a;">${fmtUSD(monthIn)}</b></span>
          <span>Net: <b style="color:${netColor};">${fmtUSD(net)}</b></span>
          <div style="display:inline-flex;background:rgba(0,0,0,0.05);border-radius:999px;padding:2px;">
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
      <div style="flex:1;font-size:12.5px;color:#0a0a0a;line-height:1.45;"><b>Smart suggestion:</b> ${escapeHTML(s.message)}</div>
      <button type="button" data-cal-sug-dismiss="${s.id}" style="background:transparent;border:0;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;">×</button>
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
            ${CATEGORIES.map(function (c) {
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
              <span style="font-size:12.5px;font-weight:700;color:#0a0a0a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHTML(e.name)}${e.moved ? ` <span style="color:#c99a2a;font-weight:800;" title="moved">↻</span>` : ""}
              </span>
              <span style="font-size:10.5px;color:#6b7280;font-weight:600;">${srcLabel}${e.status ? " · " + escapeHTML(e.status) : ""}${ovBadge}</span>
            </div>
            <button type="button" data-cal-cat-edit="${escapeAttr(e.id)}" class="wjp-cal-cat-pill" style="font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;background:${s.color};color:#fff;padding:3px 9px;border:0;border-radius:999px;font-weight:800;font-family:inherit;">${escapeHTML(e.category)}</button>
            <span style="font-size:13px;font-weight:800;color:${amtColor};white-space:nowrap;">${amtSign}${fmtUSD(e.amount)}</span>
          </div>
          ${picker}
        </div>`;
      }).join("") + `</div>`;
    } else {
      eventsHTML = `<div style="font-size:12.5px;color:#9ca3af;margin-bottom:16px;">No payments scheduled.</div>`;
    }
    var noteText = note ? note.text : "";
    var reminderAt = note && note.reminderAt ? new Date(note.reminderAt) : null;
    var reminderVal = reminderAt ? reminderAt.toISOString().slice(0, 16) : "";

    return `<div id="wjp-cal-day-panel" style="margin-top:18px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:14px;padding:18px 20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:14.5px;font-weight:700;letter-spacing:-0.01em;">${pretty}</div>
        <button type="button" data-cal-close style="background:transparent;border:0;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1;">×</button>
      </div>
      ${eventsHTML}
      <div style="border-top:1px solid rgba(0,0,0,0.06);padding-top:14px;">
        <div style="font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:8px;">Your note</div>
        <textarea data-cal-note placeholder="Add a note for this day…" rows="3" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:13px;color:#0a0a0a;resize:vertical;background:#fff;">${escapeHTML(noteText)}</textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#6b7280;font-weight:600;">
            Remind me at:
            <input type="datetime-local" data-cal-reminder value="${reminderVal}" style="border:1px solid rgba(0,0,0,0.12);border-radius:6px;padding:5px 8px;font-family:inherit;font-size:12px;">
          </label>
          <button type="button" data-cal-save style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>
          ${note ? `<button type="button" data-cal-delete style="background:transparent;color:#dc2626;border:1px solid rgba(220,38,38,0.30);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Delete</button>` : ""}
          <span style="font-size:10.5px;color:#9ca3af;flex:1;text-align:right;">Reminders use browser notifications · click to allow</span>
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
          <div style="font-size:13px;font-weight:700;letter-spacing:-0.005em;margin-bottom:6px;color:#0a0a0a;">${MONTHS_FULL[m]} ${y}</div>
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
      b.addEventListener("click", function () {
        state.filter = b.dataset.calFilter;
        try { localStorage.setItem(LS_FILTER, state.filter); } catch (_) {}
        rerender(host);
      });
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
        // Position popover to the LEFT of trigger so it doesn't flow off-screen,
        // and aligned to the trigger's top edge.
        var pw = 200;
        var leftPx = r.right - pw;
        if (leftPx < 8) leftPx = 8;
        if (leftPx + pw > window.innerWidth - 8) leftPx = window.innerWidth - pw - 8;
        var topPx = r.bottom + 6;
        // Avoid bottom clip
        if (topPx + 200 > window.innerHeight) topPx = r.top - 200 - 6;
        popover.style.left   = leftPx + "px";
        popover.style.top    = topPx + "px";
        popover.style.minWidth = pw + "px";
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
    setTimeout(tick, 800);
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
