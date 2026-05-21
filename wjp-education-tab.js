/* wjp-education-tab.js v1.5 — category chips wear category colors v1.4 — tone down disclaimer + shrink warning text v1.3 — neutral brand accent on focused lesson v1.2 — focused lesson at top from dashboard Read more v1.1 — replace Activity Log with Financial Education.
 *
 * Hijacks #page-activity (sidebar Activity Log → relabeled to Financial
 * Education). Activity Log is moved to Settings via wjp-settings-extras.js.
 *
 * Features:
 *   - Curated tip library (~50 cards, 10 categories)
 *   - Search + category filter
 *   - Mark-as-read tracking
 *   - "Pin to dashboard" — one tip surfaces as a banner via WJP_EduPin
 *   - Rotation toggle: daily / weekly / monthly / pinned-forever
 *   - "Ask AI Coach" box, financial-education-scoped, always shows
 *     "not a licensed financial advisor" disclaimer
 *
 * Hardened pattern: IIFE, idempotent, path-guarded, polled.
 */
(function () {
  "use strict";
  if (window._wjpEducationInstalled) return;
  window._wjpEducationInstalled = true;

  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}


  // === Per-user storage helper (defers to WJP_UserScope when available) ===
  function lsGet(s) {
    try { return (window.WJP_UserScope && typeof window.WJP_UserScope.get === 'function')
      ? window.WJP_UserScope.get(s) : localStorage.getItem(s); }
    catch (_) { return localStorage.getItem(s); }
  }
  function lsSet(s, v) {
    try { if (window.WJP_UserScope && typeof window.WJP_UserScope.set === 'function')
      window.WJP_UserScope.set(s, v);
      else localStorage.setItem(s, v); }
    catch (_) { try { localStorage.setItem(s, v); } catch (e) {} }
  }
  function lsRemove(s) {
    try { if (window.WJP_UserScope && typeof window.WJP_UserScope.remove === 'function')
      window.WJP_UserScope.remove(s);
      else localStorage.removeItem(s); }
    catch (_) { try { localStorage.removeItem(s); } catch (e) {} }
  }

  var ROOT_ID = "wjp-edu-root";
  var LS_READ = "wjp.edu.read.v1";       // {tipId: ts}
  var LS_PIN = "wjp.edu.pin.v1";          // {tipId, rotation, lastChange}
  var LS_PREFS = "wjp.edu.prefs.v1";

  // Synchronous flicker guard
  (function installGuard() {
    try {
      if (document.getElementById("wjp-edu-flicker-guard")) return;
      var s = document.createElement("style");
      s.id = "wjp-edu-flicker-guard";
      s.textContent = "#page-activity > *:not(#" + ROOT_ID + "){display:none !important;}";
      (document.head || document.documentElement).appendChild(s);
      setTimeout(function () {
        if (!document.getElementById(ROOT_ID)) {
          try { s.remove(); } catch (_) {}
        }
      }, 5000);
    } catch (_) {}
  })();

  // === Tip library ===
  var TIPS = [
    // Saving & Emergency Fund
    { id: "save-1", cat: "saving", title: "Build a 3-month emergency fund first.",
      body: "Before chasing investing returns, lock in 3 months of essential expenses in a separate account. It's the difference between a setback and a crisis." },
    { id: "save-2", cat: "saving", title: "Pay yourself first.",
      body: "Move money to savings the day income hits — before bills, before discretionary. The leftover-savings strategy almost never works because there's almost never anything left." },
    { id: "save-3", cat: "saving", title: "Use a high-yield savings account.",
      body: "Most checking accounts pay ~0%. A solid HYSA pays 4–5%. On a $10k emergency fund, that's $400–500/year for switching banks once." },
    { id: "save-4", cat: "saving", title: "Automate transfers.",
      body: "Willpower doesn't scale. Setting up an automatic transfer from checking to savings every payday means you save without deciding to save each time." },
    { id: "save-5", cat: "saving", title: "Round-up apps are a snack, not a meal.",
      body: "They build small habits, but they won't build the fund. Use them on top of intentional saving, not instead of it." },

    // Debt Management
    { id: "debt-1", cat: "debt", title: "Avalanche beats snowball mathematically.",
      body: "Pay highest-APR debt first — every month it sits, it costs you the most in interest. The math doesn't care how you feel about it." },
    { id: "debt-2", cat: "debt", title: "Snowball wins on motivation.",
      body: "Paying off your smallest debt first gives a quick win. If avalanche feels endless, snowball is fine — finishing matters more than optimizing." },
    { id: "debt-3", cat: "debt", title: "Balance-transfer 0% APR can save thousands.",
      body: "Read the fee (usually 3–5% upfront). If your balance is high APR and the math works after the fee, it's a powerful tool. Pay it off before the intro period ends." },
    { id: "debt-4", cat: "debt", title: "Credit-card minimum payments are a trap.",
      body: "$5,000 at 24% APR with $100/month minimum takes 30+ years to pay off and costs $11,000+ in interest. Always pay more than the minimum." },
    { id: "debt-5", cat: "debt", title: "Don't close old credit cards.",
      body: "Length of history matters for your score. If a card has no fee, keep it open and use it once a year." },
    { id: "debt-6", cat: "debt", title: "Refinance student loans when rates drop.",
      body: "Going from 7% → 4% on $40k saves ~$15k over 10 years. Federal-loan tradeoff: you lose IDR/forgiveness eligibility, so weigh it carefully." },
    { id: "debt-7", cat: "debt", title: "Don't finance depreciating assets longer than they last.",
      body: "A 7-year loan on a 5-year car means you'll be paying for a problem. Cap car loans at 5 years; ideally 4." },

    // Credit Score
    { id: "credit-1", cat: "credit", title: "Utilization is what moves the score.",
      body: "Keep card balances under 30% of limits — under 10% is even better. This is the single biggest lever for short-term score gains." },
    { id: "credit-2", cat: "credit", title: "Length of history is the second factor.",
      body: "Average age of accounts matters. New card = average age drops. Time is the only fix." },
    { id: "credit-3", cat: "credit", title: "Hard inquiries fade.",
      body: "They affect your score for 12 months and drop off your report after 24. Don't avoid useful credit out of fear." },
    { id: "credit-4", cat: "credit", title: "Pay before the statement closes.",
      body: "Banks report your statement balance to bureaus — not the after-payment balance. Pay it down before that day for lower reported utilization." },
    { id: "credit-5", cat: "credit", title: "Disputing errors is free.",
      body: "Pull all three reports yearly at annualcreditreport.com. Errors are common; disputes cost you nothing and can move scores fast." },
    { id: "credit-6", cat: "credit", title: "Authorized-user piggyback works.",
      body: "Being added to a parent's old card with perfect history can boost your score by inheriting the account's age. Make sure they actually pay it on time." },

    // Budgeting
    { id: "bud-1", cat: "budgeting", title: "50/30/20 is a starting frame.",
      body: "50% needs, 30% wants, 20% savings/debt. Adjust ratios to your reality — but the categories are useful even if your split differs." },
    { id: "bud-2", cat: "budgeting", title: "Track every dollar for 30 days.",
      body: "Just looking at where the money goes is the first reform. You'll spot leaks you didn't know existed." },
    { id: "bud-3", cat: "budgeting", title: "Zero-based budgeting.",
      body: "Every dollar of income gets a job — savings, bills, fun, debt — before the month starts. Whatever's left = save it. Income − jobs = $0." },
    { id: "bud-4", cat: "budgeting", title: "Sinking funds for irregular expenses.",
      body: "Car insurance, holidays, repairs — predictable but irregular. Set aside 1/12th of the annual cost each month so it's never a surprise." },
    { id: "bud-5", cat: "budgeting", title: "Pay yourself first when budgeting.",
      body: "List savings/debt at the TOP of the budget, not the bottom. Treat it like a bill that's due before everything else." },

    // Investing
    { id: "inv-1", cat: "investing", title: "Index funds beat most active managers.",
      body: "Over 20 years, ~90% of professional managers underperform the S&P 500. Low-cost index funds (VTI, VOO, VTSAX) are boring and effective." },
    { id: "inv-2", cat: "investing", title: "Time in market beats timing the market.",
      body: "Missing the 10 best days of the market over 30 years cuts your return roughly in half. Stay invested." },
    { id: "inv-3", cat: "investing", title: "Take the 401(k) match — always.",
      body: "If your employer matches 5% and you don't contribute, you're refusing 5% of your salary in free money." },
    { id: "inv-4", cat: "investing", title: "Dollar-cost averaging removes guesswork.",
      body: "Investing the same amount monthly buys more shares when prices are low and fewer when high. You stop trying to predict." },
    { id: "inv-5", cat: "investing", title: "Diversify across asset classes.",
      body: "Don't bet everything on one stock, sector, or country. A simple 3-fund portfolio (US stocks / international stocks / bonds) handles 90% of the work." },
    { id: "inv-6", cat: "investing", title: "Rule of 72.",
      body: "Years to double your money ≈ 72 ÷ interest rate. At 7%, money doubles every ~10 years. At 12%, every 6. Use it as a sanity check." },

    // Taxes
    { id: "tax-1", cat: "taxes", title: "Roth vs Traditional 401(k).",
      body: "Roth: pay tax now, withdraw tax-free later. Use it if you expect higher tax rates in retirement (often early-career people). Traditional: opposite." },
    { id: "tax-2", cat: "taxes", title: "Standard deduction is fine for most renters.",
      body: "Itemizing usually only beats the standard deduction once you have a mortgage or large charitable giving. Don't waste hours on it." },
    { id: "tax-3", cat: "taxes", title: "Tax-loss harvesting.",
      body: "Sell losing investments to offset capital gains. Up to $3,000 of losses can offset ordinary income each year." },
    { id: "tax-4", cat: "taxes", title: "Earned Income Tax Credit.",
      body: "If you're working at low/moderate income, this credit is large and refundable. Most eligible filers leave money on the table by not claiming it." },
    { id: "tax-5", cat: "taxes", title: "HSA is a stealth retirement account.",
      body: "If you have a high-deductible plan: contributions are pre-tax, growth is tax-free, withdrawals for medical are tax-free. Triple tax-advantaged." },

    // Insurance
    { id: "ins-1", cat: "insurance", title: "Term life over whole life almost always.",
      body: "Whole life is usually mediocre insurance + bad investment in one expensive package. Buy term, invest the difference." },
    { id: "ins-2", cat: "insurance", title: "Match deductibles to your emergency fund.",
      body: "Higher deductible = lower premium, but only safe if you can absorb the deductible without going into debt." },
    { id: "ins-3", cat: "insurance", title: "Shop insurance every 18 months.",
      body: "Loyalty gets penalized. Get one comparison quote — then ask your current insurer to match. Most do." },
    { id: "ins-4", cat: "insurance", title: "Renters insurance is cheap and powerful.",
      body: "$15/mo typically covers $20-30k of belongings + liability. If you rent and don't have it, you're rolling dice you don't need to roll." },
    { id: "ins-5", cat: "insurance", title: "Skip extended warranties.",
      body: "On consumer electronics they're nearly all profit for the seller. Better: build the repair cost into your emergency fund." },

    // Big Purchases
    { id: "big-1", cat: "big", title: "House affordability rules.",
      body: "Monthly housing ≤ 28% of gross income. Total debt payments ≤ 36%. Lenders will let you go higher — don't." },
    { id: "big-2", cat: "big", title: "Don't buy more car than 50% above what you'd pay cash.",
      body: "If you wouldn't write the check for it, financing it doesn't make it affordable — it just stretches the pain." },
    { id: "big-3", cat: "big", title: "Total price tells the truth.",
      body: "$300/mo for 84 months is $25,200, not $300. Salespeople use monthly to make purchases sound smaller. Ask for total cost financed." },
    { id: "big-4", cat: "big", title: "Budget 2–5% for closing costs.",
      body: "On a $300k house, that's $6k-$15k beyond the down payment. People forget this and end up rate-shopping while ignoring fees." },

    // Retirement
    { id: "ret-1", cat: "retirement", title: "Save 15% from your 20s.",
      body: "Including any employer match, aim for 15% of gross income going to retirement. Starting at 25 vs 35 roughly doubles your nest egg." },
    { id: "ret-2", cat: "retirement", title: "Compounding is the magic.",
      body: "$200/mo from age 25, 7% return, becomes ~$525k by 65. Same dollar amount starting at 35 = ~$245k. The decade is worth $280k." },
    { id: "ret-3", cat: "retirement", title: "Don't borrow from your 401(k).",
      body: "If you leave the job (voluntarily or not), the loan often comes due in 60-90 days. Default and it's taxed + penalized as a withdrawal." },

    // Common Pitfalls
    { id: "pit-1", cat: "pitfalls", title: "Save the difference on every raise.",
      body: "Lifestyle creep kills wealth-building. When you get a raise, increase savings/investments by half the raise BEFORE adjusting your spending." },
    { id: "pit-2", cat: "pitfalls", title: "Track 'small' treats for a month.",
      body: "$5/day on coffee + $40/week on takeout = $370/month = $4,440/year. Worth knowing what you're trading away." },
    { id: "pit-3", cat: "pitfalls", title: "Audit subscriptions every quarter.",
      body: "The average household has 12+ subscriptions, 3-4 of which they don't use. 10 minutes can save $30-100/month." },
    { id: "pit-4", cat: "pitfalls", title: "Cosigning is taking the loan yourself.",
      body: "If they default, it's your credit. Only cosign for someone whose loan you'd be willing to pay in full." },
    { id: "pit-5", cat: "pitfalls", title: "BNPL is debt with extra steps.",
      body: "\"Pay in 4\" reframes spending you can't afford as something you can. Track BNPL like any other debt; many users carry several at once without realizing the total." },
    { id: "pit-6", cat: "pitfalls", title: "Day trading: the house always wins.",
      body: "70-90% of day traders lose money over time. The few who win get magazine articles. Survivorship bias makes it look easier than it is." },
    { id: "pit-7", cat: "pitfalls", title: "Influencers are not advisors.",
      body: "If they recommend it on social media, they're probably paid to. Take 'tips' as starting points for your own research, not commands." },
    { id: "pit-8", cat: "pitfalls", title: "Variable rates rise.",
      body: "If you took an adjustable-rate loan when rates were low, model what happens at 2x, 3x current rate. Plan for it before it happens." },
    { id: "pit-9", cat: "pitfalls", title: "The lottery is a tax on hope.",
      body: "Expected return is negative. The math doesn't change because you 'feel lucky.' If you play, treat it like entertainment spending, capped." }
  ];

  var CATEGORIES = [
    { k: "all",        label: "All",         color: "#0a0a0a" },
    { k: "saving",     label: "Saving",      color: "#1f7a4a" },
    { k: "debt",       label: "Debt",        color: "#dc2626" },
    { k: "credit",     label: "Credit",      color: "#7c3aed" },
    { k: "budgeting",  label: "Budgeting",   color: "#0284c7" },
    { k: "investing",  label: "Investing",   color: "#059669" },
    { k: "taxes",      label: "Taxes",       color: "#c99a2a" },
    { k: "insurance",  label: "Insurance",   color: "#9a3412" },
    { k: "big",        label: "Big buys",    color: "#475569" },
    { k: "retirement", label: "Retirement",  color: "#0891b2" },
    { k: "pitfalls",   label: "Pitfalls",    color: "#b91c1c" }
  ];

  function categoryColor(cat) {
    var c = CATEGORIES.find(function (x) { return x.k === cat; });
    return c ? c.color : "#6b7280";
  }

  // === Storage ===
  function loadJSON(k, def) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? def : v; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  function loadRead() { return loadJSON(LS_READ, {}); }
  function markRead(id) { var r = loadRead(); r[id] = Date.now(); saveJSON(LS_READ, r); }

  function loadPin() { return loadJSON(LS_PIN, { tipId: null, rotation: "weekly", lastChange: 0 }); }
  function savePin(p) { saveJSON(LS_PIN, p); }
  function loadPrefs() { return loadJSON(LS_PREFS, { selectedCat: "all", query: "" }); }
  function savePrefs(p) { saveJSON(LS_PREFS, p); }

  var state = {
    selectedCat: "all",
    query: "",
    selectedTipId: null,
    chatHistory: [],
    chatInFlight: false
  };
  var prefs = loadPrefs();
  state.selectedCat = prefs.selectedCat || "all";
  state.query = prefs.query || "";

  // === Rotation logic for dashboard tip ===
  function rotateDashboardTipIfDue() {
    var p = loadPin();
    var now = Date.now();
    if (p.rotation === "pinned") return;
    var period = p.rotation === "daily" ? 24*3600e3 : p.rotation === "weekly" ? 7*24*3600e3 : p.rotation === "monthly" ? 30*24*3600e3 : 7*24*3600e3;
    if (now - (p.lastChange || 0) >= period) {
      // Pick a tip the user hasn't read recently
      var read = loadRead();
      var unread = TIPS.filter(function (t) { return !read[t.id]; });
      var pool = unread.length ? unread : TIPS;
      var t = pool[Math.floor(Math.random() * pool.length)];
      p.tipId = t.id;
      p.lastChange = now;
      savePin(p);
    }
  }

  // === Helpers ===
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function findTip(id) { return TIPS.find(function (t) { return t.id === id; }); }

  // === Sidebar relabel ===
  function relabelSidebar() {
    var nav = document.querySelector('[data-page="activity"]');
    if (!nav || nav.dataset.wjpRelabeled === "1") return;
    nav.dataset.wjpRelabeled = "1";
    var span = nav.querySelector("span");
    if (span) span.textContent = "Financial Education";
    var icon = nav.querySelector(".nav-icon i");
    if (icon) icon.className = "ph ph-book-open-text";
  }

  function findHost() {
    var page = document.getElementById("page-activity");
    if (!page || !page.classList.contains("active")) return null;
    return page;
  }

  function ensureStyle() {
    if (document.getElementById("wjp-edu-styles")) return;
    var s = document.createElement("style");
    s.id = "wjp-edu-styles";
    s.textContent = `
      #${ROOT_ID} { font-family: var(--sans, Inter, system-ui, sans-serif); color: var(--ink, #0a0a0a); padding: 18px 0 24px; width: 100%; box-sizing: border-box; }
      .wjp-edu-disclaimer { background: rgba(148,163,184,0.06); border: 1px solid rgba(148,163,184,0.20); border-radius: 8px; padding: 7px 12px; font-size: 10px; color: var(--text-3, #6b7280); margin-bottom: 14px; line-height: 1.45; }
      .wjp-edu-disclaimer b { color: var(--ink, #0a0a0a); font-weight: 700; }
      .wjp-edu-cats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
      .wjp-edu-cat { padding: 5px 11px; border-radius: 999px; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid rgba(0,0,0,0.10); background: var(--card, #fff); color: var(--ink, #0a0a0a); display: inline-flex; gap: 6px; align-items: center; }
      .wjp-edu-cat-active { background: #0a0a0a; color: #fff; border-color: var(--ink, #0a0a0a); }
      .wjp-edu-cat-count { font-weight: 600; opacity: .7; }
      .wjp-edu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
      .wjp-edu-card { background: var(--card, #fff); border: 1px solid rgba(0,0,0,0.08); border-radius: 14px; padding: 16px 18px; cursor: pointer; transition: transform .12s, box-shadow .12s, border-color .12s; }
      .wjp-edu-card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.06); border-color: rgba(0,0,0,0.14); }
      .wjp-edu-card-cat { font-size: 9.5px; letter-spacing: 0.10em; text-transform: uppercase; font-weight: 800; }
      .wjp-edu-card-title { font-size: 14.5px; font-weight: 700; color: var(--ink, #0a0a0a); letter-spacing: -0.01em; line-height: 1.25; margin: 8px 0; }
      .wjp-edu-card-body { font-size: 12.5px; color:var(--ink-dim, #4b5563); line-height: 1.5; }
      .wjp-edu-card-foot { display: flex; gap: 8px; align-items: center; margin-top: 12px; font-size: 10.5px; color: var(--ink-faint, #9ca3af); font-weight: 600; }
      .wjp-edu-card-read { color: #1f7a4a; }
      .wjp-edu-card-pinned { color: #c99a2a; }
      .wjp-edu-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 24px; }
      .wjp-edu-modal { background: var(--card, #fff); border-radius: 16px; max-width: 640px; width: 100%; max-height: 86vh; overflow-y: auto; padding: 28px 32px; box-shadow: 0 30px 80px rgba(0,0,0,0.30); }
      .wjp-edu-modal h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.2; margin-bottom: 14px; }
      .wjp-edu-modal-body { font-size: 14.5px; line-height: 1.6; color: var(--ink, #1a1a1a); }
      .wjp-edu-modal-actions { display: flex; gap: 8px; margin-top: 22px; flex-wrap: wrap; align-items: center; }
      .wjp-edu-btn { font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.10); background: var(--card, #fff); color: var(--ink, #0a0a0a); }
      .wjp-edu-btn-primary { background: #1f7a4a; color: #fff; border-color: #1f7a4a; }
      .wjp-edu-rotation { display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink-dim, #6b7280); font-weight: 600; }
      .wjp-edu-coach { background: linear-gradient(135deg, rgba(31,122,74,0.06), rgba(201,154,42,0.04)); border: 1px solid rgba(31,122,74,0.20); border-radius: 14px; padding: 18px 20px; margin-bottom: 18px; }
      .wjp-edu-coach textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; font-family: inherit; font-size: 13px; color: var(--ink, #0a0a0a); resize: vertical; min-height: 60px; background: var(--card, #fff); }
      .wjp-edu-coach-msgs { display: grid; gap: 8px; margin-top: 12px; }
      .wjp-edu-coach-msg { padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.55; }
      .wjp-edu-coach-msg-user { background: rgba(0,0,0,0.05); }
      .wjp-edu-coach-msg-bot { background: var(--card, #fff); border: 1px solid rgba(31,122,74,0.20); }
      .wjp-edu-search { padding: 7px 12px; border: 1px solid rgba(0,0,0,0.10); border-radius: 8px; font-family: inherit; font-size: 12.5px; color: var(--ink, #0a0a0a); min-width: 220px; }

      /* Dark mode hover/subtle-bg overrides */
      body.dark .wjp-cal-cell:hover { background: rgba(255,255,255,0.04) !important; }
      body.dark .wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.18) !important; }
      body.dark .wjp-edu-card:hover { border-color: rgba(255,255,255,0.16); box-shadow: 0 12px 28px rgba(0,0,0,0.40); }
      body.dark .wjp-notes-row:hover { background: rgba(255,255,255,0.04); }
      body.dark .wjp-edu-disclaimer { background: rgba(148,163,184,0.10); color: rgba(241,245,249,0.65); }
      body.dark .wjp-edu-disclaimer b { color: #f1f5f9; }
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

  function buildHTML() {
    var pin = loadPin();
    var read = loadRead();
    var byCat = {}; CATEGORIES.forEach(function (c) { byCat[c.k] = 0; });
    TIPS.forEach(function (t) { byCat[t.cat] = (byCat[t.cat] || 0) + 1; byCat.all++; });

    var filtered = TIPS.filter(function (t) {
      if (state.selectedCat !== "all" && t.cat !== state.selectedCat) return false;
      if (state.query) {
        var q = state.query.toLowerCase();
        if ((t.title + " " + t.body).toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });

    var disclaimer = `<div class="wjp-edu-disclaimer"><b>Educational only.</b> WJP is not a licensed financial advisor — these tips are general guidance to help you build context. For decisions specific to your situation, consult a fiduciary financial advisor.</div>`;

    var coachBox = `
      <div class="wjp-edu-coach">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">
          <div style="font-size:14px;font-weight:700;letter-spacing:-0.005em;">💬 Ask the AI Coach (financial education)</div>
          <div style="font-size:9px;color:var(--text-3, #94a3b8);font-weight:700;letter-spacing:0.06em;">EDUCATIONAL · NOT ADVICE</div>
        </div>
        <textarea data-wjp-edu-coach-input placeholder="Ask anything about budgeting, debt, credit, investing basics… (e.g. 'how do index funds work?')"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
          <button type="button" class="wjp-edu-btn wjp-edu-btn-primary" data-wjp-edu-coach-send>${state.chatInFlight ? "Thinking…" : "Ask"}</button>
          <span style="font-size:10.5px;color:var(--ink-dim, #6b7280);font-style:italic;">Answers are general education. Your specific situation may differ.</span>
        </div>
        <div class="wjp-edu-coach-msgs">
          ${state.chatHistory.map(function (m) {
            return `<div class="wjp-edu-coach-msg wjp-edu-coach-msg-${m.role}"><b>${m.role === "user" ? "You" : "AI Coach"}</b><br>${escapeHTML(m.text)}</div>`;
          }).join("")}
        </div>
      </div>
    `;

    var pinControls = `
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:11.5px;color:var(--ink-dim, #6b7280);">
        <span class="wjp-edu-rotation">📌 Dashboard tip:
          <select data-wjp-edu-rotation style="border:1px solid var(--border, rgba(0,0,0,0.12));border-radius:6px;padding:4px 8px;font-family:inherit;font-size:11.5px;color:var(--ink, #0a0a0a);">
            <option value="daily" ${pin.rotation === "daily" ? "selected" : ""}>Daily rotation</option>
            <option value="weekly" ${pin.rotation === "weekly" ? "selected" : ""}>Weekly rotation</option>
            <option value="monthly" ${pin.rotation === "monthly" ? "selected" : ""}>Monthly rotation</option>
            <option value="pinned" ${pin.rotation === "pinned" ? "selected" : ""}>Pinned (manual)</option>
          </select>
        </span>
        ${pin.tipId ? `<span>Currently: <b>${escapeHTML((findTip(pin.tipId) || {}).title || "—")}</b></span>` : `<span style="color:var(--ink-faint, #9ca3af);">No tip pinned yet</span>`}
        ${pin.tipId ? `<button type="button" class="wjp-edu-btn" data-wjp-edu-unpin>Unpin</button>` : ""}
      </div>
    `;

    var catChips = CATEGORIES.map(function (c) {
      var active = state.selectedCat === c.k;
      // "All" stays neutral. Every other category wears its own color.
      var isAll = (c.k === 'all');
      var col = isAll ? null : categoryColor(c.k);
      var style;
      if (isAll) {
        style = active
          ? 'background:#0a0a0a;color:#ffffff;border-color:#0a0a0a;'
          : 'background:transparent;color:var(--ink,#0a0a0a);border-color:rgba(0,0,0,0.10);';
      } else if (active) {
        style = 'background:' + col + ';color:#ffffff;border-color:' + col + ';';
      } else {
        style = 'background:' + col + '14;color:' + col + ';border-color:' + col + '40;';
      }
      return `<button type="button" class="wjp-edu-cat${active ? " wjp-edu-cat-active" : ""}" data-wjp-edu-cat="${c.k}" style="${style}">
        ${escapeHTML(c.label)}
        <span class="wjp-edu-cat-count" style="opacity:.75;">${byCat[c.k] || 0}</span>
      </button>`;
    }).join("");

    var grid = filtered.length
      ? `<div class="wjp-edu-grid">` + filtered.map(function (t) {
          var color = categoryColor(t.cat);
          var isRead = !!read[t.id];
          var isPinned = pin.tipId === t.id;
          var catLabel = (CATEGORIES.find(function (c) { return c.k === t.cat; }) || { label: t.cat }).label;
          return `<div class="wjp-edu-card" data-wjp-edu-tip="${escapeHTML(t.id)}">
            <div class="wjp-edu-card-cat" style="color:${color};">${escapeHTML(catLabel)}</div>
            <div class="wjp-edu-card-title">${escapeHTML(t.title)}</div>
            <div class="wjp-edu-card-body">${escapeHTML(t.body)}</div>
            <div class="wjp-edu-card-foot">
              ${isPinned ? `<span class="wjp-edu-card-pinned">📌 Pinned to dashboard</span>` : ""}
              ${isRead ? `<span class="wjp-edu-card-read">✓ Read</span>` : ""}
            </div>
          </div>`;
        }).join("") + `</div>`
      : `<div style="text-align:center;color:var(--ink-faint, #9ca3af);padding:40px;font-size:13px;">No tips match.</div>`;

    // Focused lesson — when user clicked "Read more" on the dashboard Daily Money Lesson,
    // wjp-edu-dashboard-tip.js stashes the tip id on window.WJP_EduFocusTipId.
    var focusedTip = null;
    try {
      var fId = window.WJP_EduFocusTipId;
      if (fId) {
        focusedTip = findTip(fId);
        // Mark as read once viewed (consistent with modal mark-read behavior)
        try { var r = loadRead(); if (!r[fId]) { r[fId] = Date.now(); saveRead(r); } } catch(_) {}
        // Consume the focus so a return to this tab doesn't keep re-pinning the same lesson.
        try { delete window.WJP_EduFocusTipId; } catch(_) { window.WJP_EduFocusTipId = null; }
      }
    } catch (_) {}

    var focusedBlock = '';
    if (focusedTip) {
      // Neutral brand-accent chrome for the focused lesson regardless of category.
      // Category gets shown as a small chip beside the label so users still see it.
      var fAccent = '#10b981'; // emerald — app brand accent, signals "learning"
      var fCategoryColor = categoryColor(focusedTip.cat);
      var fCatLabel = (CATEGORIES.find(function (c) { return c.k === focusedTip.cat; }) || { label: focusedTip.cat }).label;
      focusedBlock = `
        <div class="wjp-edu-focused" style="border:1px solid ${fAccent}33;border-left:4px solid ${fAccent};background:${fAccent}0d;border-radius:14px;padding:18px 22px;margin-bottom:18px;">
          <div style="display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;font-weight:800;color:${fAccent};margin-bottom:6px;">
            <span>Today's lesson</span>
            <span style="font-size:9.5px;font-weight:700;color:${fCategoryColor};background:${fCategoryColor}1a;border:1px solid ${fCategoryColor}33;padding:2px 8px;border-radius:999px;letter-spacing:0.06em;">${escapeHTML(fCatLabel)}</span>
          </div>
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.005em;line-height:1.25;margin-bottom:10px;">${escapeHTML(focusedTip.title)}</div>
          <div style="font-size:13.5px;line-height:1.55;color:var(--ink, #0a0a0a);">${escapeHTML(focusedTip.body)}</div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button type="button" class="wjp-edu-btn wjp-edu-btn-primary" data-wjp-edu-pin="${escapeHTML(focusedTip.id)}">${(loadPin().tipId === focusedTip.id) ? '📌 Unpin from dashboard' : '📌 Pin to dashboard'}</button>
          </div>
        </div>
      `;
    }

    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">
        <div>
          <div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-faint, #9ca3af);font-weight:700;margin-bottom:4px;">Education</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">Financial education</div>
          <div style="font-size:13px;color:var(--ink-dim, #6b7280);margin-top:4px;">The basics most people pick up too late.</div>
        </div>
        <input class="wjp-edu-search" data-wjp-edu-search type="text" placeholder="Search tips…" value="${escapeHTML(state.query)}">
      </div>
      ${disclaimer}
      ${focusedBlock}
      ${coachBox}
      ${pinControls}
      <div class="wjp-edu-cats">${catChips}</div>
      ${grid}
      ${state.selectedTipId ? renderModal(findTip(state.selectedTipId)) : ""}
    `;
  }

  function renderModal(tip) {
    if (!tip) return "";
    var pin = loadPin();
    var isPinned = pin.tipId === tip.id;
    var read = loadRead();
    var isRead = !!read[tip.id];
    var catLabel = (CATEGORIES.find(function (c) { return c.k === tip.cat; }) || { label: tip.cat }).label;
    var color = categoryColor(tip.cat);
    return `
      <div class="wjp-edu-modal-backdrop" data-wjp-edu-modal-backdrop>
        <div class="wjp-edu-modal" data-wjp-edu-modal-body>
          <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:${color};font-weight:800;margin-bottom:8px;">${escapeHTML(catLabel)}</div>
          <h2>${escapeHTML(tip.title)}</h2>
          <div class="wjp-edu-modal-body">${escapeHTML(tip.body)}</div>
          <div class="wjp-edu-modal-actions">
            <button type="button" class="wjp-edu-btn wjp-edu-btn-primary" data-wjp-edu-pin="${escapeHTML(tip.id)}">${isPinned ? "📌 Unpin from dashboard" : "📌 Pin to dashboard"}</button>
            <button type="button" class="wjp-edu-btn" data-wjp-edu-mark-read="${escapeHTML(tip.id)}">${isRead ? "✓ Mark as unread" : "✓ Mark as read"}</button>
            <button type="button" class="wjp-edu-btn" data-wjp-edu-modal-close>Close</button>
          </div>
        </div>
      </div>
    `;
  }

  function attach(host) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;

    var search = root.querySelector("[data-wjp-edu-search]");
    if (search) search.addEventListener("input", function () {
      state.query = search.value;
      prefs.query = state.query; savePrefs(prefs);
      var sel = search.selectionStart, end = search.selectionEnd;
      rerender(host);
      var s2 = document.querySelector("[data-wjp-edu-search]");
      if (s2) { s2.focus(); if (sel != null) s2.setSelectionRange(sel, end); }
    });

    Array.from(root.querySelectorAll("[data-wjp-edu-cat]")).forEach(function (b) {
      b.addEventListener("click", function () {
        state.selectedCat = b.dataset.wjpEduCat;
        prefs.selectedCat = state.selectedCat; savePrefs(prefs);
        rerender(host);
      });
    });

    Array.from(root.querySelectorAll("[data-wjp-edu-tip]")).forEach(function (c) {
      c.addEventListener("click", function () {
        state.selectedTipId = c.dataset.wjpEduTip;
        markRead(state.selectedTipId);
        rerender(host);
      });
    });

    var modalClose = root.querySelector("[data-wjp-edu-modal-close]");
    if (modalClose) modalClose.addEventListener("click", function () { state.selectedTipId = null; rerender(host); });
    var backdrop = root.querySelector("[data-wjp-edu-modal-backdrop]");
    if (backdrop) backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) { state.selectedTipId = null; rerender(host); }
    });

    var pinBtn = root.querySelector("[data-wjp-edu-pin]");
    if (pinBtn) pinBtn.addEventListener("click", function () {
      var id = pinBtn.dataset.wjpEduPin;
      var p = loadPin();
      p.tipId = (p.tipId === id) ? null : id;
      p.lastChange = Date.now();
      savePin(p);
      rerender(host);
    });

    var markBtn = root.querySelector("[data-wjp-edu-mark-read]");
    if (markBtn) markBtn.addEventListener("click", function () {
      var id = markBtn.dataset.wjpEduMarkRead;
      var r = loadRead();
      if (r[id]) delete r[id]; else r[id] = Date.now();
      saveJSON(LS_READ, r);
      rerender(host);
    });

    var rotationSel = root.querySelector("[data-wjp-edu-rotation]");
    if (rotationSel) rotationSel.addEventListener("change", function () {
      var p = loadPin();
      p.rotation = rotationSel.value;
      p.lastChange = Date.now();
      savePin(p);
      rotateDashboardTipIfDue();
      rerender(host);
    });

    var unpinBtn = root.querySelector("[data-wjp-edu-unpin]");
    if (unpinBtn) unpinBtn.addEventListener("click", function () {
      var p = loadPin();
      p.tipId = null;
      savePin(p);
      rerender(host);
    });

    var coachInput = root.querySelector("[data-wjp-edu-coach-input]");
    var coachSend = root.querySelector("[data-wjp-edu-coach-send]");
    function sendCoach() {
      if (!coachInput || !coachInput.value.trim() || state.chatInFlight) return;
      var msg = coachInput.value.trim();
      coachInput.value = "";
      state.chatHistory.push({ role: "user", text: msg });
      state.chatInFlight = true;
      rerender(host);
      askCoach(msg).then(function (reply) {
        state.chatHistory.push({ role: "bot", text: reply });
        state.chatInFlight = false;
        rerender(host);
      }).catch(function (err) {
        state.chatHistory.push({ role: "bot", text: "Sorry — couldn't reach the AI Coach right now. Try again in a moment. (" + (err && err.message ? err.message : "network") + ")" });
        state.chatInFlight = false;
        rerender(host);
      });
    }
    if (coachSend) coachSend.addEventListener("click", sendCoach);
    if (coachInput) coachInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendCoach(); }
    });
  }

  // === AI Coach call ===
  // Reuse existing infrastructure. WJP_CloudAI is the global AI helper.
  // System prompt scopes to financial education and forces disclaimer.
  function askCoach(message) {
    var systemPrompt = "You are the WJP AI Coach for the Financial Education tab. You provide GENERAL FINANCIAL EDUCATION ONLY. Always remind the user that you are not a licensed financial advisor and that for their specific situation they should consult a fiduciary. Keep answers concise (under 200 words). If the user asks about non-financial topics, gently redirect. If they ask for specific investment recommendations, decline and explain you provide education only.";
    if (window.WJP_CloudAI && typeof window.WJP_CloudAI.ask === "function") {
      return Promise.resolve(window.WJP_CloudAI.ask({ system: systemPrompt, message: message })).then(function (r) {
        return (typeof r === "string" ? r : (r && r.text) || "(no response)");
      });
    }
    if (window.WJP_DeepAI && typeof window.WJP_DeepAI.ask === "function") {
      return Promise.resolve(window.WJP_DeepAI.ask({ system: systemPrompt, message: message })).then(function (r) {
        return (typeof r === "string" ? r : (r && r.text) || "(no response)");
      });
    }
    // Fallback: call /.netlify/functions/ai-cloud directly
    return fetch("/.netlify/functions/ai-cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ system: systemPrompt, message: message })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      return j.text || j.message || j.reply || "(no response)";
    });
  }

  // === Render ===
  function rerender(host) {
    if (!host) return;
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      host.appendChild(root);
    }
    root.innerHTML = buildHTML();
    attach(host);
  }

  function hideOriginalContent(page) {
    Array.from(page.children).forEach(function (c) {
      if (c.id === ROOT_ID) return;
      if (c.dataset && c.dataset.wjpEduHidden === "1") return;
      c.dataset.wjpEduHidden = "1";
      c.style.display = "none";
    });
  }

  function tick() {
    try {
      ensureStyle();
      relabelSidebar();
      rotateDashboardTipIfDue();
      var host = findHost();
      if (!host) return;
      hideOriginalContent(host);
      if (!document.getElementById(ROOT_ID)) rerender(host);
    } catch (e) {
      try { console.warn("[wjp-education-tab] tick threw", e); } catch (_) {}
    }
  }

  function boot() {
    tick();
    setInterval(tick, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WJP_Education = {
    refresh: tick,
    tips: TIPS,
    findTip: findTip,
    pinnedTip: function () { var p = loadPin(); return p.tipId ? findTip(p.tipId) : null; },
    rotation: function () { return loadPin().rotation; },
    rotate: rotateDashboardTipIfDue
  };
})();
