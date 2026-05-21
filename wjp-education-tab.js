/* wjp-education-tab.js v1.6 — expanded library 200 tips, 20 per category v1.5 — category chips wear category colors v1.4 — tone down disclaimer + shrink warning text v1.3 — neutral brand accent on focused lesson v1.2 — focused lesson at top from dashboard Read more v1.1 — replace Activity Log with Financial Education.
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
    // ================ SAVING & EMERGENCY FUND (20) ================
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
    { id: "save-6", cat: "saving", title: "Keep emergency funds at a different bank.",
      body: "When savings and checking sit in the same app, 'savings' becomes a backup wallet. A different bank with no debit card adds friction and protects the fund." },
    { id: "save-7", cat: "saving", title: "Save the % of every raise, not the dollars.",
      body: "If you save 10% before a 5% raise, your auto-save should jump to 10% of the new salary — not stay frozen. Most people accidentally absorb the entire raise into lifestyle." },
    { id: "save-8", cat: "saving", title: "Half of every windfall goes to savings.",
      body: "Tax refunds, bonuses, gifts, side-gig wins. Move 50% to savings BEFORE deciding what to spend the other half on. You'll never miss it." },
    { id: "save-9", cat: "saving", title: "Sub-accounts beat one big pile.",
      body: "Most HYSAs let you create labeled buckets (Emergency, Car, Vacation, Roof). Once money has a name, you're less likely to raid it for something else." },
    { id: "save-10", cat: "saving", title: "Sinking funds for predictable irregulars.",
      body: "Car insurance ($1,200/yr), holidays ($800), repairs ($600). Divide annual cost by 12 and auto-save monthly so big bills are pre-paid, not surprises." },
    { id: "save-11", cat: "saving", title: "The 1% annual save bump.",
      body: "Every January 1st, increase your auto-save rate by 1%. In 10 years you've climbed from 5% to 15% without ever feeling the year's jump." },
    { id: "save-12", cat: "saving", title: "One 'no-spend weekend' a month.",
      body: "No restaurants, no online shopping, no entertainment outside what you already have. Average household saves $150–400 per weekend. 12 a year = a real fund." },
    { id: "save-13", cat: "saving", title: "Save weekly, not monthly.",
      body: "$50 every Friday becomes habit faster than $200 once a month. Smaller, frequent transfers stick the same way small daily exercise beats once-a-week marathons." },
    { id: "save-14", cat: "saving", title: "Buffer → fund, in that order.",
      body: "Stage 1: $1,000 buffer to cover surprises. Stage 2: 1 month expenses. Stage 3: 3 months. Stage 4: 6 months. Don't chase 6 months while still bouncing $35 overdrafts." },
    { id: "save-15", cat: "saving", title: "Stash bonuses the day they land.",
      body: "Bonuses get spent in proportion to how long they sit in checking. Move them within 24 hours — your brain hasn't 'budgeted' them yet, so the loss is invisible." },
    { id: "save-16", cat: "saving", title: "Saving rate beats rate of return early.",
      body: "At 25, doubling your savings rate from 5% to 10% does more for your nest egg than picking the perfect fund. Returns matter more later — habits matter most now." },
    { id: "save-17", cat: "saving", title: "Count employer match in your saving rate.",
      body: "If you contribute 5% and your employer matches 5%, your real saving rate is 10%. Many people undercount this and feel further behind than they are." },
    { id: "save-18", cat: "saving", title: "Use checking sweep rules.",
      body: "Modern banks let you set a checking ceiling — anything above $X auto-sweeps to HYSA nightly. Stops idle cash from earning 0% and removes the 'I have lots' illusion." },
    { id: "save-19", cat: "saving", title: "The 3-paycheck month.",
      body: "If you're paid biweekly, you get 26 paychecks a year — that's 2 months with 3 checks. Pre-assign the 3rd check to savings or debt; otherwise it disappears." },
    { id: "save-20", cat: "saving", title: "If you can't save, cut FIXED before variable.",
      body: "One $50/mo subscription cut = $600/year and zero willpower required. Coffee budgets fail because they require daily decisions; subscription audits succeed once." },

    // ================ DEBT MANAGEMENT (20) ================
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
    { id: "debt-8", cat: "debt", title: "Biweekly payments add a free 13th month.",
      body: "Splitting your monthly payment in two and paying every 2 weeks = 26 half-payments = 13 full payments per year. On a 30-yr mortgage, that knocks ~6 years off." },
    { id: "debt-9", cat: "debt", title: "Banks lower your APR if you ask.",
      body: "Call your credit card company once a year and ask for a rate reduction. With 12+ months of on-time payment, success rate is 30–50%. Takes 10 minutes; saves real money." },
    { id: "debt-10", cat: "debt", title: "Hardship programs exist — call BEFORE you're 60 days late.",
      body: "Card issuers and lenders have hardship plans (reduced APR, paused minimums) but only offer them before you default. Call the moment you know you'll miss a payment." },
    { id: "debt-11", cat: "debt", title: "Settled debt is taxable income.",
      body: "If a creditor forgives $5,000+, the IRS treats it as income on a 1099-C. Plan for the tax hit before celebrating the discount." },
    { id: "debt-12", cat: "debt", title: "Get pay-for-delete in writing before paying collections.",
      body: "Paying a collection doesn't automatically remove it from your report. Negotiate written removal as a condition of payment, or your score may not improve." },
    { id: "debt-13", cat: "debt", title: "Medical debt under $500 is now off credit reports.",
      body: "As of 2023, paid medical collections of any amount and unpaid under $500 don't appear on credit reports. Don't let collectors threaten what's already inaccurate." },
    { id: "debt-14", cat: "debt", title: "Statute of limitations varies by state.",
      body: "Most states bar suits on old debts after 3–6 years. Making ANY payment can restart the clock. Know your state's rules before responding to old-debt collection calls." },
    { id: "debt-15", cat: "debt", title: "Refinancing a 30-year mortgage to 15-year saves ~50% of interest.",
      body: "Same loan, shorter term = bigger monthly but dramatically less total interest. On a $300k loan at 7%, that's ~$190k in savings over the life of the loan." },
    { id: "debt-16", cat: "debt", title: "Watch your debt-to-income ratio.",
      body: "DTI = monthly debt payments / gross monthly income. Above 43% locks you out of most mortgages. Below 36% is healthy; above 50% is a five-alarm fire." },
    { id: "debt-17", cat: "debt", title: "Pay your highest-APR debt AFTER the 401(k) match.",
      body: "A 5% match is a 100% return. Even with 25% APR debt, take the match first — then attack the debt with everything else." },
    { id: "debt-18", cat: "debt", title: "PSLF can erase student loans for public-sector workers.",
      body: "If you work for a government or qualifying non-profit and make 120 IDR payments, the remaining federal balance is forgiven tax-free. Most eligible borrowers don't enroll." },
    { id: "debt-19", cat: "debt", title: "Personal loans can consolidate high-APR debt.",
      body: "If credit-card debt sits at 24% and you qualify for a 12% personal loan, consolidation cuts interest in half. Watch the origination fee and don't re-run up the cards." },
    { id: "debt-20", cat: "debt", title: "Charge-offs aren't 'gone' — they age out at 7 years.",
      body: "A charged-off debt still appears on your credit report for 7 years from first delinquency. It also doesn't erase the balance — collectors can still pursue it." },

    // ================ CREDIT SCORE (20) ================
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
    { id: "credit-7", cat: "credit", title: "A mix of credit types helps.",
      body: "Credit mix is 10% of FICO. Having both revolving (cards) and installment (auto, student, mortgage) credit on file scores better than just cards." },
    { id: "credit-8", cat: "credit", title: "Skip the 5%-off store cards at checkout.",
      body: "That $200 purchase saves $10. The hard pull + low-limit account can drag your score 5–10 points and lower your average account age. Not worth it." },
    { id: "credit-9", cat: "credit", title: "Soft pulls don't hurt your score.",
      body: "Pre-qualification, your own credit checks, and most monitoring apps use soft pulls. Only formal applications trigger hard pulls. Shop quotes freely." },
    { id: "credit-10", cat: "credit", title: "FICO and VantageScore can differ by 30+ points.",
      body: "Free apps usually show VantageScore. Most lenders use FICO. Don't panic if your free score and lender score don't match — they're different formulas." },
    { id: "credit-11", cat: "credit", title: "Freeze your credit. It's free.",
      body: "Lock the bureaus so no one (including criminals) can open accounts in your name. Unlock with a PIN when you actually need credit. Takes 5 minutes per bureau." },
    { id: "credit-12", cat: "credit", title: "If utilization is high, pay twice a month.",
      body: "Most cards report once a month near the statement date. Paying down mid-cycle and again before statement keeps the reported balance low — instant score boost." },
    { id: "credit-13", cat: "credit", title: "Ask for a credit-limit increase every 6 months.",
      body: "Most issuers allow soft-pull limit increases. Higher limit = lower utilization on the same spending. Don't increase spending to match — the goal is the cushion." },
    { id: "credit-14", cat: "credit", title: "Experian Boost adds rent + utilities to your file.",
      body: "On-time rent, phone, and utility payments aren't typically reported. Free self-reporting via Experian Boost can add years of history and lift thin files." },
    { id: "credit-15", cat: "credit", title: "Closing a high-limit card hurts twice.",
      body: "Closure removes its credit limit (raising utilization across remaining cards) AND eventually drops it from your history. Keep no-fee cards open." },
    { id: "credit-16", cat: "credit", title: "Late payments hurt most in the first 24 months.",
      body: "A 30-day late hits hardest right after it reports. Impact fades after 12–24 months, but the record stays 7 years. Catch up fast — every day past 30 is worse." },
    { id: "credit-17", cat: "credit", title: "Joint accounts = joint credit.",
      body: "A joint card or loan with a partner appears on both reports. Their late payment becomes your late payment. Authorized users have less exposure than joint owners." },
    { id: "credit-18", cat: "credit", title: "Public records linger 7–10 years.",
      body: "Bankruptcies and tax liens sit on reports for 7 (Chapter 13) or 10 (Chapter 7) years. Plan recovery around that timeline — not faster, not slower." },
    { id: "credit-19", cat: "credit", title: "Pre-approval ≠ approval.",
      body: "Pre-approval is based on a soft pull and basic data. Final approval pulls hard and verifies income/employment. Don't make big buys assuming pre-approval is locked in." },
    { id: "credit-20", cat: "credit", title: "Free monitoring is everywhere now.",
      body: "Most credit cards, banks, and even apps like Credit Karma offer free score monitoring. Paying for credit monitoring services is rarely worth it." },

    // ================ BUDGETING (20) ================
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
    { id: "bud-6", cat: "budgeting", title: "Cash envelopes for problem categories.",
      body: "If groceries or dining keeps blowing past budget, switch that category to cash for one month. When the envelope's empty, the category's done." },
    { id: "bud-7", cat: "budgeting", title: "The 1% rule for tracking.",
      body: "Only categories that move >1% of your monthly income deserve their own tracking line. Combine the tiny stuff into 'misc' — accuracy fatigue kills budgets." },
    { id: "bud-8", cat: "budgeting", title: "Plan 3-paycheck months in advance.",
      body: "Biweekly pay gives you two months a year with 3 checks. Pre-assign that bonus to savings/debt/big-buy before it arrives or it'll disappear into normal spending." },
    { id: "bud-9", cat: "budgeting", title: "December is its own season.",
      body: "Holidays + travel + gifts make December 30–60% more expensive than other months. Budget for it separately starting in January, not December." },
    { id: "bud-10", cat: "budgeting", title: "Weekly check-ins beat monthly.",
      body: "By the time you do a month-end review, the money's gone. A 10-minute Sunday review catches drift while you can still correct it." },
    { id: "bud-11", cat: "budgeting", title: "Reverse budget if you hate budgeting.",
      body: "Automate savings + bills. Whatever lands in checking after = spendable. No categories, no apps. Works for people who refuse to track but will respect a hard ceiling." },
    { id: "bud-12", cat: "budgeting", title: "Audit fixed costs twice a year.",
      body: "Phone, internet, insurance, subscriptions, gym. 30 minutes of negotiating + canceling beats a year of skipping lattes. Renegotiate or switch every 6 months." },
    { id: "bud-13", cat: "budgeting", title: "Lifestyle inflation creeps in 5% chunks.",
      body: "A raise, a move, a relationship — each adds 'small' new costs. Re-baseline your budget every life event or you'll wonder where the gains went." },
    { id: "bud-14", cat: "budgeting", title: "Couples: combine for bills, separate fun money.",
      body: "Most relationship money fights come from one person feeling watched. Joint account for bills + separate accounts for each person's discretionary works for most couples." },
    { id: "bud-15", cat: "budgeting", title: "Budget for FUN explicitly.",
      body: "Restrictive budgets fail like restrictive diets. Give yourself a guilt-free 'fun' line each month — when it's gone, it's gone, but you can spend it freely until then." },
    { id: "bud-16", cat: "budgeting", title: "Quantify subscription leakage.",
      body: "Cancel one $15/mo subscription = $180/year = $1,800 over 10 years (more if invested). The average household has 3-4 subscriptions they don't use." },
    { id: "bud-17", cat: "budgeting", title: "Build a 'buffer month' in checking.",
      body: "One full month of expenses sitting in checking eliminates timing stress between paychecks and bills. You stop budgeting against next week's deposit." },
    { id: "bud-18", cat: "budgeting", title: "Annual financial reset, every January.",
      body: "30 minutes once a year: review net worth, debt balances, save rate, retirement progress. Set 3 numerical targets for the year. Skip the resolution list — just the numbers." },
    { id: "bud-19", cat: "budgeting", title: "If income varies, budget on the LOW month.",
      body: "Freelancers and tip workers: build your fixed budget around your lowest realistic month. Surplus from good months sweeps to savings. Removes the feast/famine cycle." },
    { id: "bud-20", cat: "budgeting", title: "The 24-hour rule kills impulse spending.",
      body: "Any non-essential purchase over $100 (or whatever threshold matches your income) waits 24 hours. The urge dies for ~70% of impulse buys before the day's out." },

    // ================ INVESTING (20) ================
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
    { id: "inv-7", cat: "investing", title: "Expense ratios devour returns.",
      body: "1% expense ratio vs 0.04% sounds small. On $100k over 30 years at 7%, the difference is ~$200,000. Always check the expense ratio before buying a fund." },
    { id: "inv-8", cat: "investing", title: "Rebalance once a year.",
      body: "Winners drift higher, losers drift lower. Once a year, sell some winners and buy some losers to return to your target allocation. Forces disciplined contrarian behavior." },
    { id: "inv-9", cat: "investing", title: "Target-date funds are decent set-and-forget.",
      body: "If you pick nothing, a low-cost target-date fund (Vanguard, Fidelity, Schwab) auto-rebalances and de-risks as you age. Most DIY portfolios don't beat them." },
    { id: "inv-10", cat: "investing", title: "Open a Roth IRA before doing extra 401(k).",
      body: "After getting your employer match, max your Roth IRA ($7k/yr under 50). Tax-free growth + tax-free withdrawals in retirement = unbeatable." },
    { id: "inv-11", cat: "investing", title: "Backdoor Roth for high earners.",
      body: "Above the Roth income limit? Contribute to a Traditional IRA non-deductibly, then immediately convert it to Roth. Legal, common, and recommended above ~$146k single." },
    { id: "inv-12", cat: "investing", title: "Mega-backdoor Roth: secret big lever.",
      body: "Some 401(k) plans allow after-tax contributions ABOVE the $23k limit, then in-plan Roth conversion. Lets high earners stash $40k+ in Roth per year. Check your plan docs." },
    { id: "inv-13", cat: "investing", title: "Don't check the market daily.",
      body: "Daily checking spikes anxiety and tempts mistakes. Once a month for net-worth tracking, once a year for rebalancing. The rest is noise." },
    { id: "inv-14", cat: "investing", title: "Recessions are buying opportunities.",
      body: "Markets historically recover from every downturn. Selling near the bottom is the single biggest mistake retail investors make. Stay invested or buy more." },
    { id: "inv-15", cat: "investing", title: "Bond allocation rule of thumb.",
      body: "A rough guide: bonds = your age. So at 30, ~30% bonds; at 60, ~60%. Adjust for risk tolerance — but it stops you from being 100% stocks in your 60s." },
    { id: "inv-16", cat: "investing", title: "Avoid annuities for most cases.",
      body: "Most variable annuities are high-fee, low-return wrappers sold to people who'd do better with a simple index portfolio. Read every fee disclosure before signing." },
    { id: "inv-17", cat: "investing", title: "IPOs are mostly hype.",
      body: "Stocks rarely outperform the market in their first year post-IPO. The 'getting in early' framing benefits insiders, not retail. Skip unless you'd buy at the post-IPO price." },
    { id: "inv-18", cat: "investing", title: "International exposure matters.",
      body: "US stocks have outperformed lately, but not always. 20–40% of your equity in international (VXUS or similar) hedges against US-specific downturns." },
    { id: "inv-19", cat: "investing", title: "Crypto/individual stocks: cap the bet.",
      body: "If you want to gamble, allocate ≤5% of investments to single-stock or crypto. Keep the other 95% in diversified index funds so a wipeout doesn't end you." },
    { id: "inv-20", cat: "investing", title: "The boring portfolio wins.",
      body: "VTI 70% / VXUS 20% / BND 10% beats most strategies most years. Boring is the strategy. Excitement is usually a leak." },

    // ================ TAXES (20) ================
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
    { id: "tax-6", cat: "taxes", title: "Student loan interest deduction up to $2,500.",
      body: "Even if you don't itemize, you can deduct up to $2,500 of student loan interest paid. Phases out at higher incomes but covers most early-career payers." },
    { id: "tax-7", cat: "taxes", title: "Self-employed? Track everything.",
      body: "Home office, mileage, supplies, software, education, half of self-employment tax — all deductible. Keep receipts in a folder/app. Skipping this costs thousands." },
    { id: "tax-8", cat: "taxes", title: "Quarterly estimated taxes if self-employed.",
      body: "If you owe over $1,000 at filing, you may also owe a penalty unless you paid quarterly estimates (Apr 15, Jun 15, Sep 15, Jan 15). Don't get blindsided in April." },
    { id: "tax-9", cat: "taxes", title: "Saver's Credit doubles low-income retirement saving.",
      body: "If income is below ~$38k single / $76k joint, you can get a credit of up to 50% of your retirement contributions (up to $1,000 back). Few eligible filers know about it." },
    { id: "tax-10", cat: "taxes", title: "Update Form W-4 after life events.",
      body: "Marriage, kids, big raises, side gigs — all change your tax picture. Updating W-4 mid-year avoids the April surprise and prevents over-withholding interest-free loans to the IRS." },
    { id: "tax-11", cat: "taxes", title: "Tax brackets are MARGINAL.",
      body: "Earning more never makes you net less. Only the dollars above each threshold are taxed at the higher rate. 'Bumping into a higher bracket' is one of the most damaging myths in finance." },
    { id: "tax-12", cat: "taxes", title: "529 plans = state tax deduction + tax-free growth.",
      body: "Contributions to your state's 529 may be deductible at state level; growth is tax-free if used for qualifying education. Even small monthly contributions compound." },
    { id: "tax-13", cat: "taxes", title: "ABLE accounts: 529-equivalent for disability.",
      body: "If you or a dependent has a qualifying disability, ABLE accounts let you save up to $18k/yr tax-free without losing SSI/Medicaid eligibility. Hugely under-used." },
    { id: "tax-14", cat: "taxes", title: "Donate stock, not cash.",
      body: "Donate appreciated stock directly to a qualifying charity: you skip the capital gains tax AND get the full deduction. Mathematically beats selling first and donating cash." },
    { id: "tax-15", cat: "taxes", title: "Bunch deductions in alternating years.",
      body: "If your itemized total is just under the standard deduction every year, you're losing money. Bunch 2 years of donations + property taxes into one year, take standard the next." },
    { id: "tax-16", cat: "taxes", title: "1099-K threshold for app payments.",
      body: "Venmo, PayPal, Cash App now report payments above $5,000 to the IRS as of 2024. If you sell stuff or freelance, separate personal payments from business or expect a 1099-K." },
    { id: "tax-17", cat: "taxes", title: "No-income-tax states aren't always cheaper.",
      body: "States without income tax often have higher property tax, sales tax, or fees. Run the full math (TX, FL, WA, NV vs your current state) before relocating for taxes alone." },
    { id: "tax-18", cat: "taxes", title: "Child Tax Credit + Dependent Care add up.",
      body: "Up to $2,000 per child under 17 + up to $3,000 of qualifying childcare expenses creditable. Combined with the EITC, these are the biggest credits most families miss." },
    { id: "tax-19", cat: "taxes", title: "Donor-advised funds for bunching.",
      body: "Fund a DAF in one year, take the deduction, and distribute to charities over many years. Lets you concentrate tax benefit while spreading actual giving." },
    { id: "tax-20", cat: "taxes", title: "File even when below the income threshold.",
      body: "If you had any withholding or qualify for refundable credits, filing gets you a refund. Skipping the filing means leaving the money with the IRS." },

    // ================ INSURANCE (20) ================
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
    { id: "ins-6", cat: "insurance", title: "Umbrella policy if net worth > $500k.",
      body: "$1M umbrella runs ~$200/year. Stacks on auto + home for catastrophic liability. If you're getting wealthy, you become a target for lawsuits — cheap protection." },
    { id: "ins-7", cat: "insurance", title: "Disability insurance is more important than life insurance.",
      body: "You're 3x more likely to be disabled than die during working years. Long-term disability replaces 50–70% of income. If your job doesn't offer it, get a private policy." },
    { id: "ins-8", cat: "insurance", title: "Life insurance: 10x income, term to retirement.",
      body: "If others depend on your income, get 10–12x income in term life, lasting until your kids graduate or you'd be financially independent anyway." },
    { id: "ins-9", cat: "insurance", title: "Bundle home + auto for 10–25% off.",
      body: "Multi-policy discounts add up. Always quote bundled — but also quote separately to make sure the 'bundle discount' isn't just disguised overcharging on one." },
    { id: "ins-10", cat: "insurance", title: "Drop collision when car value < 10x annual premium.",
      body: "If your car's worth $3k and collision costs $500/year, you're paying $5,000 over 10 years to recover $3k. Drop it once depreciation makes the math obvious." },
    { id: "ins-11", cat: "insurance", title: "Healthy + HDHP + HSA = often the cheapest plan.",
      body: "If you rarely see a doctor, a high-deductible plan with an HSA usually costs less in premiums + has triple-tax-advantaged savings. Crunch your usage before defaulting to PPO." },
    { id: "ins-12", cat: "insurance", title: "FSA is use-it-or-lose-it. Plan medical spend.",
      body: "Schedule annual eye exams, dental, glasses, and stockpile pharmacy in Q4 if you have unused FSA. Money disappears at year-end (some plans roll $610)." },
    { id: "ins-13", cat: "insurance", title: "Long-term care insurance sweet spot: 55–65.",
      body: "Buy too young = years of unnecessary premium; buy too old = unaffordable or denied. 70% of 65+ will need some LTC; average 3 years. Window matters." },
    { id: "ins-14", cat: "insurance", title: "Pet insurance: usually a bad deal.",
      body: "Average lifetime pet insurance cost = $7k-10k. Most pets never need that much care. A dedicated 'pet emergency' savings account works better for most." },
    { id: "ins-15", cat: "insurance", title: "Travel insurance only for non-refundable big trips.",
      body: "$100 to insure a $5,000 international trip is reasonable. $50 to insure a $300 domestic flight isn't. Buy it for the trips you'd cry over losing." },
    { id: "ins-16", cat: "insurance", title: "Identity theft 'protection' is mostly free elsewhere.",
      body: "Free credit freezes + bank alerts cover most of what paid ID-theft services offer. Read what you're actually paying for before signing up." },
    { id: "ins-17", cat: "insurance", title: "Mortgage protection insurance = redundant.",
      body: "It's term life dressed up to look mortgage-specific. Regular term life covers the same need cheaper and isn't tied to the lender." },
    { id: "ins-18", cat: "insurance", title: "Title insurance is one-time, worth it.",
      body: "One-time cost (~$1,000) when buying a home protects against title defects discovered later. Standard, recommended, often required by lender." },
    { id: "ins-19", cat: "insurance", title: "Floods + earthquakes aren't in standard policies.",
      body: "Homeowners insurance excludes flood and earthquake by default. If you're in a risk zone, buy separately (NFIP for floods, state pools for earthquakes)." },
    { id: "ins-20", cat: "insurance", title: "Premiums creep faster than inflation.",
      body: "Auto and home premiums rose 15–25% in many states recently. Review annually — switching saved the average family $400/year in 2024." },

    // ================ BIG BUYS (20) ================
    { id: "big-1", cat: "big", title: "House affordability rules.",
      body: "Monthly housing ≤ 28% of gross income. Total debt payments ≤ 36%. Lenders will let you go higher — don't." },
    { id: "big-2", cat: "big", title: "Don't buy more car than 50% above what you'd pay cash.",
      body: "If you wouldn't write the check for it, financing it doesn't make it affordable — it just stretches the pain." },
    { id: "big-3", cat: "big", title: "Total price tells the truth.",
      body: "$300/mo for 84 months is $25,200, not $300. Salespeople use monthly to make purchases sound smaller. Ask for total cost financed." },
    { id: "big-4", cat: "big", title: "Budget 2–5% for closing costs.",
      body: "On a $300k house, that's $6k-$15k beyond the down payment. People forget this and end up rate-shopping while ignoring fees." },
    { id: "big-5", cat: "big", title: "20% down on a conventional skips PMI.",
      body: "Private mortgage insurance is 0.3–1.5% of loan annually — pure cost, no benefit to you. 20% down (or 'piggyback' 80/10/10 loans) avoids it." },
    { id: "big-6", cat: "big", title: "PMI is removable once LTV hits 80%.",
      body: "If your home's value rises or you pay down to 80% loan-to-value, request PMI removal in writing. Some lenders don't auto-cancel until 78%. Ask early." },
    { id: "big-7", cat: "big", title: "Buy used cars 2–3 years old.",
      body: "Cars depreciate 20–25% in year one, another 15% in year two. A 2-year-old car costs 35–40% less than new and is mechanically near-identical." },
    { id: "big-8", cat: "big", title: "Negotiate furniture and appliances.",
      body: "Markup on furniture is often 200–400%, appliances 50–100%. Asking 'is that your best price?' or shopping floor models saves 20–40%." },
    { id: "big-9", cat: "big", title: "24-hour pause on any impulse over $100.",
      body: "Same rule from budgeting, but bigger stakes here. Reviews, comparisons, and a night's sleep kill ~70% of impulse buys before they happen." },
    { id: "big-10", cat: "big", title: "Major appliances last 8–15 years.",
      body: "Fridge: 10–15. Dishwasher: 9–12. Washing machine: 10–13. HVAC: 15–20. Build replacement reserves so failures don't become emergencies." },
    { id: "big-11", cat: "big", title: "The 2-month-salary engagement ring rule is marketing.",
      body: "It was invented by De Beers in 1947. Spend what you can comfortably afford. The relationship outlasts the carat count." },
    { id: "big-12", cat: "big", title: "Wedding ROI is in memories, not appearances.",
      body: "Average US wedding: $30,000. Couples who spent $5–10k report equal satisfaction. The marriage is more important than the wedding day." },
    { id: "big-13", cat: "big", title: "Cars cost ~9% of average income — fully loaded.",
      body: "Payment + insurance + gas + maintenance + depreciation. People budget for the payment and forget the rest, then wonder why money disappears." },
    { id: "big-14", cat: "big", title: "Rent vs buy: 5-year break-even in most cities.",
      body: "Closing costs, agent fees, and maintenance mean it usually takes 5+ years for buying to pay off vs renting. If you'd move sooner, renting often wins." },
    { id: "big-15", cat: "big", title: "Mortgage points: usually only worth it past year 7.",
      body: "Paying $3,000 for a 0.25% lower rate breaks even in ~5–7 years. If you'd refinance or move sooner, skip points." },
    { id: "big-16", cat: "big", title: "Refinance threshold: 1% rate drop + 3+ year stay.",
      body: "Refinancing costs 2–6% of the loan. A 1%+ rate drop usually pays back the cost in 2–3 years. If you're moving sooner, the math fails." },
    { id: "big-17", cat: "big", title: "HVAC: annual maintenance extends life 5+ years.",
      body: "Spending $100–200/year on tune-ups vs $8,000–15,000 to replace early is one of the clearest cost-effective home decisions." },
    { id: "big-18", cat: "big", title: "Roof: inspect annually after year 15.",
      body: "Most roofs last 20–30 years. Catching minor leaks in year 17 = $400 patch. Missing them until year 22 = $20,000+ in water damage + replacement." },
    { id: "big-19", cat: "big", title: "Energy Star + tax credits stack.",
      body: "Federal Inflation Reduction Act gives up to 30% back on qualified efficient appliances, HVAC, solar. State + utility rebates often stack on top." },
    { id: "big-20", cat: "big", title: "Pre-approval before house-hunting, not during.",
      body: "Sellers won't take you seriously without a pre-approval letter. Get pre-approved BEFORE looking — your loan amount also tells you what's actually in range." },

    // ================ RETIREMENT (20) ================
    { id: "ret-1", cat: "retirement", title: "Save 15% from your 20s.",
      body: "Including any employer match, aim for 15% of gross income going to retirement. Starting at 25 vs 35 roughly doubles your nest egg." },
    { id: "ret-2", cat: "retirement", title: "Compounding is the magic.",
      body: "$200/mo from age 25, 7% return, becomes ~$525k by 65. Same dollar amount starting at 35 = ~$245k. The decade is worth $280k." },
    { id: "ret-3", cat: "retirement", title: "Don't borrow from your 401(k).",
      body: "If you leave the job (voluntarily or not), the loan often comes due in 60-90 days. Default and it's taxed + penalized as a withdrawal." },
    { id: "ret-4", cat: "retirement", title: "Order of operations: match → HSA → Roth IRA → 401(k) max.",
      body: "Get the full employer 401(k) match first. Then max HSA if eligible. Then max Roth IRA. Then push 401(k) to the $23k limit. Then taxable brokerage." },
    { id: "ret-5", cat: "retirement", title: "IRA limits: $7k under 50, $8k over 50.",
      body: "Annual contribution limits adjust slightly for inflation. Currently $7k under 50, $8k 50+. You have until April 15 to make prior-year contributions." },
    { id: "ret-6", cat: "retirement", title: "Catch-up contributions at 50.",
      body: "At 50, you can add $7,500/year extra to 401(k) and $1,000 extra to IRA. This is the catch-up window for late starters — use it." },
    { id: "ret-7", cat: "retirement", title: "Roth IRA income limits — use backdoor at $146k+.",
      body: "Direct Roth contributions phase out above ~$146k single / $230k joint. Above that: contribute to Traditional, immediately convert. Legal, easy with most brokerages." },
    { id: "ret-8", cat: "retirement", title: "RMDs start at age 73.",
      body: "Required Minimum Distributions force you to withdraw from Traditional IRAs/401(k)s starting at 73 (75 for those born 1960+). Plan tax strategy decade ahead." },
    { id: "ret-9", cat: "retirement", title: "Social Security at 70 = 32% more than 67.",
      body: "Delaying SS from 67 to 70 grows your monthly check by ~8%/year. If you live to 80+, delaying wins. Run your break-even point before deciding." },
    { id: "ret-10", cat: "retirement", title: "Working past 70 still grows SS benefits.",
      body: "Every year you continue earning past 70 can replace a lower-earning year in your top 35, boosting future benefits. Plus the work itself adds income." },
    { id: "ret-11", cat: "retirement", title: "Spousal Social Security: up to 50% of partner's.",
      body: "A lower-earning spouse can claim up to 50% of the higher-earner's benefit (if higher than their own). Coordinate claiming strategies — runs into thousands annually." },
    { id: "ret-12", cat: "retirement", title: "Medicare enrolls automatically at 65 — penalties if you miss Part B.",
      body: "Part A is automatic. Part B has a 7-month enrollment window around your 65th birthday. Missing it can cost 10% per missed year, FOREVER. Mark the calendar." },
    { id: "ret-13", cat: "retirement", title: "Retirement beneficiaries override your will.",
      body: "Whoever's listed on your 401(k)/IRA gets it, regardless of what your will says. Check beneficiaries after divorces, marriages, deaths, or every 5 years." },
    { id: "ret-14", cat: "retirement", title: "4% withdrawal rule = 30 years roughly.",
      body: "A $1M portfolio with 4% annual withdrawals (~$40k) historically lasts 30+ years across most starting periods. Use it as a benchmark, adjust for your situation." },
    { id: "ret-15", cat: "retirement", title: "Plan $315k average healthcare in retirement (couple).",
      body: "Fidelity estimates an average couple needs ~$315k for healthcare in retirement, NOT counting long-term care. HSAs are an ideal vehicle for this." },
    { id: "ret-16", cat: "retirement", title: "Geographic arbitrage: retire abroad saves 30–60%.",
      body: "Portugal, Mexico, Costa Rica, Thailand, Spain offer high quality of life at 40–70% of US cost. SS travels; Medicare doesn't, so plan healthcare separately." },
    { id: "ret-17", cat: "retirement", title: "Pension lump sum vs annuity.",
      body: "Take the annuity if your family has long-lived members and the math beats SPIA quotes for the same lump sum. Take lump if you have above-average investment skill and shorter expected life." },
    { id: "ret-18", cat: "retirement", title: "Roth conversion ladder for early retirement.",
      body: "Convert chunks of Traditional → Roth in low-income years; after 5 years, those converted dollars can be withdrawn penalty-free. Common FIRE strategy for accessing 401(k) money before 59½." },
    { id: "ret-19", cat: "retirement", title: "72(t) SEPP for IRA before 59½.",
      body: "Substantially Equal Periodic Payments let you take from your IRA before 59½ without the 10% penalty. Locks you in for 5 years or until 59½ (whichever's longer) — read the rules carefully." },
    { id: "ret-20", cat: "retirement", title: "Phased retirement beats hard stop.",
      body: "Happiest retirees often work part-time or seasonally for years. Slows the savings drawdown, preserves social structure, and keeps brain engaged. 'Retirement' as a full stop is increasingly rare." },

    // ================ COMMON PITFALLS (20) ================
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
      body: "Expected return is negative. The math doesn't change because you 'feel lucky.' If you play, treat it like entertainment spending, capped." },
    { id: "pit-10", cat: "pitfalls", title: "MLMs: 99% of participants lose money.",
      body: "FTC data shows ~99% of multi-level marketing reps make less than they spend on inventory + fees. The 1% making it work are usually at the top of the pyramid." },
    { id: "pit-11", cat: "pitfalls", title: "Timeshares: easy in, hard out.",
      body: "Timeshares depreciate to ~0 (often negative — you can't give them away). High-pressure sales + lifetime maintenance fees + impossible-to-exit contracts. Walk out of the presentation." },
    { id: "pit-12", cat: "pitfalls", title: "Crypto FOMO buys peaks.",
      body: "Retail investors typically pile in near the top because that's when media coverage peaks. Buy gradually over years if at all, never with money you can't afford to lose." },
    { id: "pit-13", cat: "pitfalls", title: "Gambling apps dressed as investing.",
      body: "Options/derivatives apps with confetti animations and zero commissions are designed to encourage churn. Trading frequency and returns are inversely correlated. Slow > fast." },
    { id: "pit-14", cat: "pitfalls", title: "Title loans + payday loans: 200–400% APR.",
      body: "If you're considering one, almost any alternative is cheaper — credit union loan, family loan, hardship withdrawal, even cash advances. Avoid the cycle." },
    { id: "pit-15", cat: "pitfalls", title: "Rent-to-own: pay 2–3x retail.",
      body: "Rent-to-own appliances, furniture, or electronics often total 200–300% of retail by the end. Buying refurbished or used outright is dramatically cheaper." },
    { id: "pit-16", cat: "pitfalls", title: "Free trials that auto-renew.",
      body: "Most 'free trials' require credit cards and start billing on day 31. Calendar reminder the moment you sign up, OR use a virtual card with a $1 cap." },
    { id: "pit-17", cat: "pitfalls", title: "If returns promised > 2x market, it's a scam.",
      body: "Anything claiming 20%+ guaranteed returns is either fraud or extreme risk dressed as safe. Bernie Madoff promised steady 10–12%. The rule still applies." },
    { id: "pit-18", cat: "pitfalls", title: "Oversharing personal info on social media.",
      body: "Birthdate, mother's maiden name, pet names, hometown — common security answers. Public posts feed identity theft. Lock down profiles or skip those quiz games." },
    { id: "pit-19", cat: "pitfalls", title: "Don't lend money you can't afford to gift.",
      body: "If lending to family/friends, mentally treat it as a gift. If they pay back, bonus. This protects the relationship if they can't — and they often can't." },
    { id: "pit-20", cat: "pitfalls", title: "Get-rich-quick courses sell the dream.",
      body: "Real wealth-building is boring + slow. If the seller's main income is the course (not the strategy they're teaching), the strategy doesn't work. Look up earnings disclaimers." }
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
