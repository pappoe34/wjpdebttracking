# Graph Report - Business Website  (2026-05-30)

## Corpus Check
- 82 files · ~625,078 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1495 nodes · 2969 edges · 93 communities (88 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]

## God Nodes (most connected - your core abstractions)
1. `updateUI()` - 54 edges
2. `saveState()` - 46 edges
3. `showToast()` - 34 edges
4. `add()` - 25 edges
5. `render()` - 24 edges
6. `wireV3Events()` - 17 edges
7. `logActivity()` - 16 edges
8. `syncBankTransactions()` - 16 edges
9. `renderPage()` - 14 edges
10. `getIdToken()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `renderCreditScoreTab()` --calls--> `project()`  [INFERRED]
  app.js → wjp-credit-simulator.js
- `whenReady()` --calls--> `ready()`  [INFERRED]
  wjp-credit-score-overhaul.js → app.js
- `wire()` --calls--> `attachObserver()`  [INFERRED]
  wjp-dashboard-order-sticky.js → wjp-recurring-tiles.js

## Import Cycles
- None detected.

## Communities (93 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (54): applyPrivacyMaskState(), ask(), _buildContext(), buildScanTile(), _buildScoreSnapshot(), canNotify(), chartInstances, computeDeltaReason() (+46 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (50): applyDetectedIncome(), applyStatementToDebt(), deleteDebtPrompt(), detectIncomeCandidates(), exportCSV(), fetchAdminStatus(), fetchLinkToken(), getIdToken() (+42 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (49): applyGoalsReordering(), applyHouseholdModeLabel(), calcBalanceTrajectory(), calcDebtSimTotals(), calcSimTotals(), calculateDebtPayoff(), _clearSimCache(), _computeMaterializeHash() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (39): bankColor(), boot(), canonicalizeMerchant(), computeSummary(), customRenderBankRows(), ensurePageSizePicker(), escapeAttr(), extCategorize() (+31 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (33): boot(), buildBodyHTML(), closeModal(), commitAsset(), deleteAsset(), ensureCard(), ensureDebtsCard(), ensureModal() (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (29): ensureNavTouchWorks(), ready(), askCoach(), boot(), buildCoachPrompts(), bureauChip(), computeUtilization(), escHtml() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (28): buildCardHTML(), cadenceToggleHTML(), commitScores(), cycleMs(), escapeHTML(), fetchScoresFromBackend(), field2(), fmtDate() (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (28): cloudPull(), cloudPushDebounced(), cloudPushNow(), ensureFirestore(), ensureInbox(), findById(), genBillReminders(), genCreditScoreTips() (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (26): applyOnce(), getState(), hasSavedOrder(), scheduleApply(), wire(), attachObserver(), badgeForType(), boot() (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (27): add(), applyInlineUnblur(), attach(), bind(), clearAuthErrors(), findByText(), handleEmailLogin(), handleEmailSignup() (+19 more)

### Community 10 - "Community 10"
Cohesion: 0.20
Nodes (25): apply(), applyAllSlots(), applyCardSlot(), attachControlsHealer(), attachMenuObserver(), attachReapplyHooks(), boot(), computeSlot() (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (23): attachInsightsToCards(), buildInsightsPanel(), computeInsights(), debitRowHtml(), escapeHtml(), extractDebitAccounts(), fetchAccounts(), fetchOverrides() (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (25): actionCardHTML(), buildActions(), buildBuildCreditHTML(), buildCreditCard(), buildFactorBreakdownHTML(), buildOffersHTML(), buildScoreDetailHTML(), computeCreditProfile() (+17 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (22): boot(), buildCardHtml(), canonMerchant(), closeMerchantDetail(), closeReportModal(), doRefresh(), fmtUsd(), getPeriod() (+14 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (21): A1. Signup flow, A2. Plaid integration, A3. Statement OCR, A4. AI Coach, A5. Strategy engine, A6. Stripe billing, A7. Privacy + Data, A8. Marketing pages (+13 more)

### Community 15 - "Community 15"
Cohesion: 0.21
Nodes (20): applyDomFilter(), boot(), buildFilterBarHtml(), buildSummaryHtml(), ensurePagesizeSelector(), findBillsExplainedBlock(), fmtUsd(), getRecPagesize() (+12 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (20): 1. Overview & Creative North Star: "The Verdant Monolith", 2. Color & Surface Philosophy, 3. Typography: The Editorial Voice, 4. Elevation & Depth, 5. Components, 6. Do’s and Don’ts, Ambient Shadows, Buttons & Interaction (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (20): computeAIBudgetPrediction(), computeResilienceSnapshot(), ensureChartLoaded(), ensurePlaidLoaded(), initBudgetControlPage(), loadScriptOnce(), recalcPaycheckBar(), refreshBudgetVsPredicted() (+12 more)

### Community 18 - "Community 18"
Cohesion: 0.10
Nodes (19): Auth / Signup, Copy, Dashboard, Iconography, 🛑 Launch blockers — fix before May 23, Layout / spacing, Mobile (390px), 🎨 Polish — first 7 days post-launch (+11 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (19): appS(), checkEmptyOnLoad(), counts(), db(), fs(), hasAnyData(), hookCloudPull(), hookSaveState() (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.39
Nodes (19): btn(), card(), esc(), panelHead(), panelHeader(), pill(), r_account(), r_aicoach() (+11 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (19): analyzeAttachment(), applyToDebtForm(), buildStatementInsights(), ensureDeepStatusPill(), ensurePdfJsLoaded(), ensureTesseractLoaded(), extractDayOfMonth(), extractPdfText() (+11 more)

### Community 22 - "Community 22"
Cohesion: 0.23
Nodes (16): boot(), closePicker(), computeCash(), findTile(), findValueSubElements(), getLiquidAccounts(), getSelectedAccountId(), getState() (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.24
Nodes (17): bureauChipHTML(), currentScore(), fmtDate(), fmtRel(), focusedBureau(), gaugeSVG(), hasAccess(), heroHTML() (+9 more)

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (17): renderCreditScoreTab(), bandFor(), close(), currentInputs(), currentScore(), fmtUSD(), getDebts(), init() (+9 more)

### Community 25 - "Community 25"
Cohesion: 0.28
Nodes (17): addBusinessDays(), canonMerchantKey(), computeStatus(), findBestRecurring(), getLinkStatus(), getState(), isTransfer(), link() (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.26
Nodes (17): boot(), closePicker(), closePopover(), closeSchedulePicker(), findRecurring(), findRecurringTable(), getState(), htmlEscape() (+9 more)

### Community 27 - "Community 27"
Cohesion: 0.23
Nodes (17): boot(), buildShell(), dismiss(), fillStat(), fmtUsd(), getFirstName(), getLastSeen(), getState() (+9 more)

### Community 28 - "Community 28"
Cohesion: 0.24
Nodes (16): boot(), buildExecHtml(), buildL7Html(), compute7d(), computeExecMetrics(), findAnchor(), findUpcomingCard(), fmtUsdRound() (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.23
Nodes (14): boot(), buildEnhancementHtml(), computeProgress(), findDebtById(), findDerivedRecurring(), fmtDateShort(), fmtUsd(), getState() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.24
Nodes (15): bandUnlocks(), bannerHTML(), compute(), currentScore(), estimateScoreLift(), fetchPlaidCards(), fmtUSD(), getDebts() (+7 more)

### Community 31 - "Community 31"
Cohesion: 0.26
Nodes (16): applyMode(), boot(), findAndPatch(), findSidebarAndWire(), getMode(), getState(), injectStyle(), killStuckAnimations() (+8 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (16): 1. Overview & Creative North Star: "The Architectural Sanctuary", 2. Colors & Surface Philosophy, 3. Typography: The Editorial Voice, 4. Elevation & Depth, 5. Components, 6. Do's and Don'ts, Buttons, Cards & Lists (+8 more)

### Community 33 - "Community 33"
Cohesion: 0.28
Nodes (15): applyFilters(), appS(), closeModal(), ensureEditButtons(), ensureStyle(), escapeHtml(), fmtUsd(), getHidden() (+7 more)

### Community 34 - "Community 34"
Cohesion: 0.28
Nodes (15): add(), appS(), assignToTransaction(), del(), forTransaction(), get(), initSeed(), list() (+7 more)

### Community 35 - "Community 35"
Cohesion: 0.14
Nodes (15): applyCardSizes(), applyDashboardLayout(), hideCard(), _hideDropIndicator(), initDashCustomize(), injectCardControls(), moveCardInFlow(), moveCardWithinParent() (+7 more)

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (15): applyAccent(), applyThemeChoice(), autoSave(), ensureNamespace(), exportJSON(), renderUserIdentity(), renderV3(), setActiveSection() (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.32
Nodes (14): bureauColor(), bureauLabel(), chartSVG(), controlsHTML(), ensureHost(), filteredSeries(), getHistory(), init() (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.28
Nodes (14): attachAnchorObserver(), boot(), buildHeader(), clickOriginal(), closeMenu(), injectStyle(), openMenu(), outsideClick() (+6 more)

### Community 39 - "Community 39"
Cohesion: 0.30
Nodes (14): boot(), cats(), closeManageModal(), closePopover(), doInjectPickers(), getCat(), getState(), htmlEscape() (+6 more)

### Community 40 - "Community 40"
Cohesion: 0.20
Nodes (12): arrayHeaders(), CORS, fail(), json(), KBA_CORRECT_ANSWERS, pickAnswers(), pickScore(), PRO_TIERS (+4 more)

### Community 41 - "Community 41"
Cohesion: 0.14
Nodes (13): Acceptance criteria (for end-to-end verification), Auto-categorization, Built-in `autoClassify()` ruleset, Calendar v4 Design Notes — Plaid Data + Merchant Category Override, Data sources confirmed (no backend call needed), Edge cases, Filtering — what transactions show on the calendar, Merchant override storage (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (13): 0:00 — 0:10 (10s) — The hook, 0:10 — 0:25 (15s) — Sign up + see your date, 0:25 — 0:40 (15s) — Strategy comparison, 0:40 — 1:00 (20s) — AI Coach, 1:00 — 1:15 (15s) — Statement OCR + Plaid, 1:15 — 1:25 (10s) — The trial, 1:25 — 1:30 (5s) — Close, Captions (+5 more)

### Community 43 - "Community 43"
Cohesion: 0.14
Nodes (13): 1. Array.io account setup (do this first — takes 1-3 weeks), 2. Backend Cloud Function (deploy after Array approval), 3. Frontend hookup (one line change), 4. Identity collection flow (required for first pull), 5. Compliance checklist, Alternatives if Array is slow, Deploy, Path A — Array.io Credit Score Integration: Setup Guide (+5 more)

### Community 44 - "Community 44"
Cohesion: 0.19
Nodes (13): close(), dotsHTML(), fmtVal(), getOnb(), go(), markCompleted(), markSkipped(), openCardInsightsModal() (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.15
Nodes (12): Dress Rehearsal — Friday May 22, 2026, Email deliverability (5 min), Final go/no-go, Network + monitoring sanity (5 min), Path 1 — Marketing → Signup → Pro Plus Trial (15 min), Path 2 — Free pick (Stripe Setup mode) (10 min), Path 3 — In-app feature smoke test (15 min), Path 4 — Mobile pass at 390x844 (15 min) (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.32
Nodes (12): boot(), buildCardHtml(), doRefresh(), fmtUsd(), getPeriod(), getState(), htmlEscape(), injectStyle() (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.19
Nodes (4): bureauScores(), getCurrentScore(), loadCS(), scoreHistory()

### Community 48 - "Community 48"
Cohesion: 0.35
Nodes (12): applyToUntagged(), backupKey(), boot(), canonMerchant(), getState(), mergeIntoLearned(), readBackup(), runOnce() (+4 more)

### Community 49 - "Community 49"
Cohesion: 0.17
Nodes (11): 1. Privacy Policy, 2. Data Deletion / Right to Erasure, 3. Encryption, 4. Access Logging, 5. Vendor Risk Management, 6. Incident Response, 7. Security Testing, 8. Employee Training (+3 more)

### Community 50 - "Community 50"
Cohesion: 0.17
Nodes (11): 10. The night before (Mon May 25), 1. Listing fields, 2. Gallery images (need 5-7, 1270×760), 3. Hunter outreach (do by Sat May 23), 4. Launch-day comment templates, 5. Twitter / X launch thread (post at 6 AM PT same day), 6. LinkedIn post (post at 8 AM PT same day), 7. Reddit posts (don't post on launch day — too thirsty) (+3 more)

### Community 51 - "Community 51"
Cohesion: 0.35
Nodes (11): boot(), daysUntil(), doRefreshNudges(), getState(), injectStyle(), isCard(), nextFeeChargeMs(), promptForFee() (+3 more)

### Community 52 - "Community 52"
Cohesion: 0.38
Nodes (10): debtEstFromRecurring(), debtPaidLast7d(), findTileByLabel(), findValueSubElements(), getCreditScore(), getCreditTrend(), getState(), paintAll() (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.38
Nodes (10): appS(), autoCategorizeAll(), bootAutoCategorize(), bulkApplyMerchant(), canonMerchant(), getLearned(), isTransfer(), rememberMapping() (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.32
Nodes (11): boot(), enhanceContent(), findTxById(), getAppState(), getOpenTxId(), injectCategorySelect(), injectStyle(), repositionPanel() (+3 more)

### Community 55 - "Community 55"
Cohesion: 0.18
Nodes (11): dismissedToday(), goToCreditScoreTab(), navigateSPA(), navTo(), openDebtSubTab(), renderScoreHistoryBadge(), renderTrialBanner(), setDismissedToday() (+3 more)

### Community 56 - "Community 56"
Cohesion: 0.18
Nodes (10): 1. Data encryption in transit, 2. Data encryption at rest, 3. Authentication and access control, 4. Secrets management, 5. Logging and monitoring, 6. Vulnerability management and patching, 7. Incident response, 8. Data retention and deletion (+2 more)

### Community 57 - "Community 57"
Cohesion: 0.35
Nodes (10): bandsTable(), close(), factorsTable(), init(), injectButton(), modalHTML(), open(), section() (+2 more)

### Community 58 - "Community 58"
Cohesion: 0.35
Nodes (9): canonMerchant(), classifyCadence(), dateMs(), detect(), existingRecurringFor(), getState(), isTransfer(), median() (+1 more)

### Community 59 - "Community 59"
Cohesion: 0.38
Nodes (9): buildIndex(), canonMerchant(), categoryExists(), getState(), isTransfer(), pickCategoryByName(), resolveCategoryId(), saveState() (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.18
Nodes (10): A. `getStateKey()` pre-auth fallback, B. `saveState()` empty-clobber guard, C. `cloudPushNow` / `cloudPushDebounced` same guard, Deployment checklist (when Winston is back), Manual recovery helper, Root cause (confirmed via runtime diagnostic on production), The patch, What happened (+2 more)

### Community 61 - "Community 61"
Cohesion: 0.18
Nodes (10): 1. Diagnosis (read-only), 2. Recovery — Plaid liabilities, 3. Guard deployment (commits 5b12c3c2 → ca9ad308 → 1a9a19ff), 4. Verification (Chrome MCP), 5. Final state, Commits shipped today, What I did, in order, What remains broken (lower priority, doesn't lose data) (+2 more)

### Community 62 - "Community 62"
Cohesion: 0.31
Nodes (10): $(), commitEntries(), computeReveal(), fmtDate(), gotoStep(), prefillExtraSuggestion(), renderDebtDetails(), showOnboarding() (+2 more)

### Community 63 - "Community 63"
Cohesion: 0.47
Nodes (9): apply(), attachMenuObserver(), boot(), getState(), injectStyle(), isDenseEnabled(), patchMenu(), saveState() (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.51
Nodes (9): _appS(), bootInstall(), findUniqueScopedKey(), rawGet(), wouldClobber(), wrapCloudPush(), wrapGetStateKey(), wrapLocalStorageSetItem() (+1 more)

### Community 65 - "Community 65"
Cohesion: 0.20
Nodes (9): 1. Design philosophy, 2. Page architecture (top to bottom), 3. Tier-gating matrix, 4. Data sources, 5. New files + modifications, 6. Build order (one-push delivery), 7. Decisions needed before I write any code, 8. Open questions (+1 more)

### Community 66 - "Community 66"
Cohesion: 0.22
Nodes (8): End-of-weekend checklist, Saturday May 9 — Stripe Webhook: Add `trial_will_end` event (~10 min), Saturday May 9 — Stripe Welcome-Back Coupon (~15 min), Saturday May 9 — UAT recruit emails (~1.5h), Sunday May 10 — Plaid P14d Attestations (~30 min), Sunday May 10 — Pre-stage Product Hunt listing (~30 min), Sunday May 10 — Smoke test the trial flow (~30 min), User Weekend Homework — May 9-10, 2026

### Community 67 - "Community 67"
Cohesion: 0.42
Nodes (7): effective(), emulatedTier(), gate(), hasAccess(), isAdmin(), realTier(), tierPill()

### Community 68 - "Community 68"
Cohesion: 0.39
Nodes (7): computeMonthlyAmount(), deriveNextDate(), getState(), lastDayOfMonth(), nextMonthEndIso(), saveState(), sync()

### Community 69 - "Community 69"
Cohesion: 0.56
Nodes (8): attachBodyObserver(), attachStyleObserver(), boot(), dataPageToPageId(), enforce(), resolveActivePageId(), syncNavActive(), wireRouteEvents()

### Community 70 - "Community 70"
Cohesion: 0.53
Nodes (8): bootInstall(), findUniqueScopedKey(), rawGet(), wouldClobber(), wrapCloudPush(), wrapGetStateKey(), wrapLocalStorageSetItem(), wrapSaveState()

### Community 71 - "Community 71"
Cohesion: 0.36
Nodes (4): check_contains(), check_header(), check_status(), qa-smoke-test.sh script

### Community 72 - "Community 72"
Cohesion: 0.43
Nodes (6): ensureTesseract(), injectZone(), pickScore(), processFile(), setProgress(), showToast()

### Community 73 - "Community 73"
Cohesion: 0.43
Nodes (6): ensurePageEl(), hiddenActiveStyle(), prewarm(), warmActivity(), warmCalendar(), warmCredit()

### Community 74 - "Community 74"
Cohesion: 0.46
Nodes (7): boot(), dedupeAccidentalCopies(), ensureInjected(), findAnchor(), getCurrentSize(), injectStyle(), setSize()

### Community 75 - "Community 75"
Cohesion: 0.39
Nodes (7): boot(), getIdToken(), installOverrides(), loadAccountLookup(), richRenderBadge(), richSourceMeta(), shortInstName()

### Community 76 - "Community 76"
Cohesion: 0.29
Nodes (5): CORS, countsOf(), processUser(), TRACKED_ARRAYS, { verifyIdToken, getFirebaseAdmin, getFirestore }

### Community 77 - "Community 77"
Cohesion: 0.32
Nodes (5): counts(), { getFirebaseAdmin, getFirestore }, hasMeaningfulData(), processUser(), TRACKED_ARRAYS

### Community 78 - "Community 78"
Cohesion: 0.32
Nodes (7): fail(), fs, INDEX_PATH, main(), pass(), path, REPO_ROOT

### Community 79 - "Community 79"
Cohesion: 0.29
Nodes (6): Recruitment target list — fill in your own, Template 1 — Close friends / family (warm), Template 2 — Network / acquaintance (cooler), Template 3 — LinkedIn / Twitter post (broadcast), Template 4 — Quick-start guide (send after they say yes), UAT Recruit Templates

### Community 80 - "Community 80"
Cohesion: 0.52
Nodes (5): findMissing(), getState(), recover(), saveState(), titleCase()

### Community 81 - "Community 81"
Cohesion: 0.60
Nodes (5): applyOverrides(), getUid(), readOverrides(), syncAndRefresh(), triggerRefresh()

### Community 82 - "Community 82"
Cohesion: 0.60
Nodes (5): boot(), hide(), injectStyle(), shouldShow(), show()

### Community 83 - "Community 83"
Cohesion: 0.53
Nodes (5): boostFill(), boot(), injectStyle(), killStuckAnimations(), wireBoostObserver()

### Community 84 - "Community 84"
Cohesion: 0.60
Nodes (3): check(), getState(), postAdminAlert()

### Community 85 - "Community 85"
Cohesion: 0.80
Nodes (4): fire(), init(), watchNav(), watchPage()

### Community 86 - "Community 86"
Cohesion: 0.70
Nodes (4): aggressiveBoot(), computeHash(), injectFadeCss(), patchUpdateCreditProfile()

## Knowledge Gaps
- **197 isolated node(s):** `_scriptPromises`, `defaultState`, `chartInstances`, `titles`, `currentCalMonth` (+192 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `renderCreditScoreTab()` connect `Community 24` to `Community 0`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `ready()` connect `Community 5` to `Community 0`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `_scriptPromises`, `defaultState`, `chartInstances` to the rest of the system?**
  _197 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.022597977243994944 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08326530612244898 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05102040816326531 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.10631229235880399 - nodes in this community are weakly interconnected._