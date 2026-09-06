# UCT Terminal — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. Refresh at every
> major package boundary, merge/deploy gate, or STOP point. This is not a
> historical encyclopedia — keep it concise, overwrite stale sections rather
> than appending to them.

**Last verified:** 2026-09-05/06, against live git + Railway state (post-Attention
Signal Propagation V1 merge/deploy/production-verification).

## North star (do not lose this)

UCT Terminal is a unified AI-native financial intelligence workstation, not a
Bloomberg clone. Canonical workflow: DISCOVER → UNDERSTAND → RESEARCH →
COMPARE → MONITOR → RETURN TO UPDATED RESEARCH. Deterministic systems own
identity/calculations/dates/joins/routing/entitlements/persistence/monitor
execution/canonical validation; AI owns explanation/synthesis/comparison
narrative/summarization/Q&A. Do not blur that boundary.

**Evolving Interconnection Principle:** independent domain ownership + stable
canonical contracts + adaptable consumers + deliberate downstream-impact
review, for every material capability change. Not permission to build a
generic integration framework, event bus, or giant canonical schema.

**Permanent architectural seams — do not recreate their responsibilities in
feature-specific code:** S3 Entity Master (canonical identity) · D1 Provider
Abstraction · S8 provenance/freshness/trust · S11 market/session context
(⚠️ no general-purpose canonical module actually exists yet — see Watchlist
program notes below) · S2 Search/Command · S7 Monitoring · Canonical Research.
D2 broad canonical model and D5 corporate actions remain deferred.

## Repo / worktrees

- **Repo:** `C:\Users\Patrick\uct-dashboard` (Railway project `luminous-recreation`, service `web`).
- **origin/master (last verified):** `5e07b81500471649792a79bf19cc691f4764e304`
  (Attention Signal Propagation V1 merge — this file's own update is a
  docs-only branch cut fresh from this SHA; drift since then is unrelated
  concurrent work — re-check overlap before trusting this SHA is still current).
- Dozens of concurrent worktrees exist under `C:\Users\Patrick\uct-worktrees\` and
  `C:\Users\Patrick\uct-dashboard\.worktrees\` from other independent sessions —
  drift on master is constant and expected; re-check overlap immediately before
  every merge, do not assume this file's SHA is still current.

## CURRENT ACCEPTED (live in production)

- **Canonical Research / Ask AI Entry-Point Convergence** — `/research/{sym}`
  (full research) + `/research/{sym}?section=ai` (security-scoped Ask AI) is
  the canonical security destination; ticker actions/Watchlists/ThemeTracker/
  Calendar/Screener all route through it. Generic `/ai-search` remains for
  non-security queries. Do not reopen.
- **Cross-Security Comparison V1** — deterministic A↔B comparison, route
  `/research/:sym/compare/:comparator`. Multi-security grounded AI was
  deliberately deferred (ticker_explain.py is single-entity; a real new
  grounding contract would be needed). Do not reflexively build Comparison AI.
- **Pattern Vision holiday/evidence-date defect** — FIXED + DEPLOYED, merge
  `10c41d6b7`. Root cause: verdict `asof_date` used wall-clock date instead of
  the actual last-closed evidence bar. Fix derives both the dedup hash and the
  date from the same evidence bar; the cost-log's own `day` stays wall-clock
  intentionally (real calendar spend). No S11 module was added or duplicated.
- **Watchlist Intelligence V1** — IMPLEMENTED + ACCEPTED + LIVE, merge
  `8c83ed126`. Deterministic per-row "why it's active" facts
  (`api/services/watchlist_intelligence.py::get_intelligence_for_symbols`) +
  closed the Compare dead end. See "Recently accepted contracts" below — this
  function is now the shared engine reused by Portfolio Intelligence V1 too.
- **Portfolio / Position Intelligence V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `c1c206838`. `GET /api/j2/positions/attention` reuses
  `watchlist_intelligence.get_intelligence_for_symbols()` verbatim over
  Journal 2.0's held-position symbols (`PortfolioAttentionBanner.jsx` on
  OpenPositionsTab). Also closed Research/Ask AI/Compare dead ends on
  TickerPopup + PositionsTable row click-through. Explicitly NOT done at the
  time: PositionDetailPage/TradeDetailPage/TradeDrawer navigation wiring (that
  gap was closed by Universal Ticker Actions Convergence V1, below), the
  `position_id` sentinel/join defect, portfolio_heat.py/get_risk_dashboard UI
  surfacing, any symbol-normalization fix.
- **Universal Ticker Actions Convergence V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `dee56d7de`, deployed + production-verified 2026-09-05/06. Added a
  "Compare" action (reusing `TickerPopup.jsx`'s `goToCompare` + inline
  `SymbolSearch "+Compare"` pattern, same canonical
  `/research/:sym/compare/:comparator` route) to `TickerActions.jsx` (the
  universal right-click/long-press menu) and independently to
  `mobile/TickerHubSheet.jsx` (confirmed NOT delegating to
  `useTickerActions`, so it needed its own copy). Wired Full Research / Ask AI
  / Compare navigation into the three Journal 2.0 detail surfaces that had
  zero of the three: `PositionDetailPage.jsx` (inline action row),
  `TradeDetailPage.jsx` (new `TradeResearchMenu` overflow trigger in the CTA
  row), and `TradeDrawer.jsx` (new `TradeResearchTrigger` in the header
  icon-button row, matching that file's all-inline-style convention). Zero
  backend changes. `TickerPopup.jsx` preserved untouched as the reference
  implementation. Both READY-WITH-CONDITIONS items from the readiness audit
  were resolved as bounded implementation details, not blockers: TickerHubSheet
  got its own local inline Compare-picker code (not factored into a shared
  hook — an acceptable one-time duplication per the authorization), and
  TradeDetailPage got the single compact overflow trigger rather than three
  more inline buttons. Explicitly NOT done at the time: the `position_id`
  sentinel/join defect, `HistorySection.jsx` click-through,
  `PortfolioAttentionBanner.jsx` card click-through (closed by Attention
  Signal Propagation V1, below), Seam 1/Seam 2 fixes below, any
  multi-security AI work.
- **Attention Signal Propagation V1** — IMPLEMENTED + ACCEPTED + LIVE, merge
  `5e07b8150`, deployed + production-verified 2026-09-05/06. Propagated the
  existing deterministic attention contract
  (`watchlist_intelligence.get_intelligence_for_symbols`, already live on
  Watchlists and Journal 2.0 Open Positions) into two more Journal 2.0
  surfaces, zero backend changes: (1) `PositionDetailPage.jsx` gained a
  compact Attention card between the Universal Ticker Actions cross-link row
  and the chart, calling `useJ2PositionsAttention()` directly (the same
  account-scoped batch hook `PortfolioAttentionBanner.jsx` already uses — no
  new endpoint, no new single-symbol call), reusing the banner's exact
  vocabulary (notable dot, status pill for partial/unavailable, fact list
  with evidence `as_of` dates, "Nothing notable" fallback); (2)
  `PortfolioAttentionBanner.jsx` cards became `Link`s into
  `/journal-2-0/position/{sym}` (closing the click-through gap), so a
  notable flag on Open Positions now carries through to the same facts on
  the detail page instead of disappearing on click. Phase A's audit
  (10-agent workflow) explicitly scored and DEFERRED: TradeDetailPage/
  TradeDrawer (temporal risk — no closed-trade recency gate exists, so
  showing "today's attention" beside a possibly-months-old closed decision
  would misleadingly imply present relevance), TickerPopup/TickerHubSheet
  (NOT V1 — ~31 mostly free-reachable call sites, no entitlement/plan-check
  wiring exists yet for this signal, would need a new contract), and Research
  (redundant by construction — every fact the contract computes is already
  shown there at greater depth via the identical underlying service calls).
  Scoped deliberately to the two already-paid-gated Journal 2.0 surfaces
  because the shared attention endpoints check only login, not plan — any
  future extension to a free-reachable surface needs an explicit
  `require_plan` added to those endpoints first (a Phase A bounded
  condition, resolved as an implementation constraint, not a blocker: no new
  endpoint/hook was invented, and no free-reachable surface was touched).

## CURRENT LIVE OBSERVATION (external event/time gated — do not touch)

- **Pattern Vision** — `PATTERN_VISION_ENABLED=1`. Safety defaults locked:
  model `claude-opus-4-8`, cost_hard_cap `$10/day`, max_per_run `84`,
  active_set_only `on`, skip_if_stable `on`, confirmed_only `on`, confidence
  floor 60, hourly weekdays 9am–4pm ET. Do not alter any of these.
  - Mon 2026-09-07 (Labor Day): holiday-safety evidence only — expect cron may
    fire, evidence resolves to Friday, unchanged candidates skip, zero paid
    re-judgments, zero Monday-mislabeled verdicts. Does NOT count as a
    trading-session quality day.
  - Tue 2026-09-08 / Wed 2026-09-09: the real two-session acceptance window.
    Capture per natural cycle: started/completed, candidate count, paid Vision
    calls, skip-if-stable behavior, confirmed/rejected, errors, cycle cost,
    cumulative `cost_today()`, newest `asof_date`, duplicate check, verdict
    spot-checks.
  - Do not manually invoke the job. Do not manufacture activity.
  - Classification due after Wed: `LIVE + ACCEPTED / LIVE WITH CONDITIONS / ROLLED BACK`.
    Only after that report do we revisit the parked Technical Phase B release gate.

## CURRENT PARKED (implemented, tested, NOT merged — do not reconcile without explicit authorization)

- **Technical Research Phase B** — branch `feat/terminal-technical-convergence`,
  HEAD `6555d6df5`. Research Technical tab, consumes existing
  `/api/patterns/{sym}` with `confirmed_only=True` only (never the raw pattern
  firehose), zero new backend code, reuses Model Book chart props
  (priceLines/callouts/highlightBarTime). 69 tests passing, clean build.
  **Gate: do not merge until Pattern Vision reaches LIVE + ACCEPTED.**
- **S7 Stage 4/5 member filing-watch UI** — branch
  `feat/s7-stage4-5-filing-watch-ui`, HEAD `01a89834771e6b0c3c5b7177ba93640c03c5d466`.
  Implemented + tested, NOT deployed. Do not reconcile until S7 Stage 2 closes
  naturally and release is explicitly authorized.

## CURRENT WAITING ON EXTERNAL EVENT

- **S7 Stage 2** — production predicate `pred_dd253fcc78ab498a`, ticker NVDA,
  entity `ent_01M1R6899FJW1TBGZVQF6WNAK7`, baseline accession
  `0001197647-26-000009`, created 2026-09-05T08:26:11Z. Scheduler ON. Do not
  alter baseline, replay a document, fabricate an event, add predicates/new
  trigger types, change the monitored ticker, or manually manufacture
  evidence. Required natural proof chain: real SEC document → autonomous S7
  evaluator → durable fire → delivery → durable member alert → read state →
  `/research/NVDA` → repeated evaluation → zero duplicate. On a genuine newer
  NVDA filing: stop at a safe checkpoint in whatever else is active, preserve
  the evidence, report "REAL NVDA DOCUMENT ARRIVAL DETECTED" immediately.
  S7's read-only API (`api/routers/alert_taxonomy.py`, mounted) is live —
  create/list/delete predicate + list fires — but has **zero existing
  frontend consumer on master**; all S7 UI is parked-branch-only.

## CURRENT ACTIVE PROGRAM

- **None.** Attention Signal Propagation V1 (the prior active program) is now
  ACCEPTED + LIVE — see "CURRENT ACCEPTED" above. Per the owner's explicit
  closing instruction on that program's authorization ("Then STOP. Do not
  automatically begin the next candidate."), no next Terminal program has been
  automatically begun. The next Terminal program requires a new, explicit
  owner authorization. Do not infer one from the "NEWLY IDENTIFIED DEBT" or
  "DEFERRED" sections below, nor from Attention Signal Propagation V1's own
  explicitly-deferred surfaces (TradeDetailPage/TradeDrawer Attention,
  TickerPopup/TickerHubSheet Attention, Research Attention) — those are
  candidate lists, not authorizations.

## NEWLY IDENTIFIED DEBT (fast-follow bugfix candidates, not programs — surfaced by the Whole-Product Convergence Review, 2026-09-05/06, unless noted)

- **Seam 3 — price-move threshold duplicated, not shared (surfaced by Attention
  Signal Propagation V1's Phase A, 2026-09-05/06).**
  `watchlist_intelligence.py:23-26` defines `_PRICE_MOVE_THRESHOLD_PCT = 3.0`
  with an in-file comment claiming it "matches `massive.py::get_movers()`'s own
  gap-filter threshold" — but it is a second hand-typed `3.0`, not imported.
  `massive.py` separately hardcodes `3.0` at 4 locations (lines ~1676, 1687,
  1813, 1814). Nothing enforces the two stay in sync if either is ever tuned.
  Fix shape: one shared constant, imported by both.
- **Seam 4 — earnings-proximity window reimplemented, not shared (surfaced by
  Attention Signal Propagation V1's Phase A, 2026-09-05/06).**
  `watchlist_intelligence.py:102-131` (`_earnings_facts`) and
  `api/services/awareness/engine.py:97-134` (`_collect_earnings_window`) both
  independently walk the calendar day-by-day via the same
  `calendar_alerts._get_reporters_for_date`, keeping the earliest date per
  symbol — a deliberate mirror per `watchlist_intelligence.py`'s own docstring
  ("rather than importing that module's private, engine-owned memoization"),
  but the two have already diverged: `awareness/engine.py`'s copy is memoized
  with a TTL + partial-failure flag; `watchlist_intelligence.py`'s has neither.
  The default window (3 days) is ALSO independently declared twice as separate
  literals (`_EARNINGS_PROXIMITY_DAYS` vs `EARNINGS_PROXIMITY_DEFAULT_DAYS`).
  Fix shape: extract the shared walk+earliest-date logic into one function both
  modules call; not urgent (both currently correct, just duplicated).

- **Seam 1 — symbol normalization mismatch (CROSS-SYSTEM IDENTITY DEBT).**
  Manual J2 entry (`positions.py`/`options.py`) does bare `.strip().upper()`;
  SnapTrade sync (`snaptrade_adapter.py::normalize_symbol()`) additionally
  rewrites dual-class dot-suffixes to hyphens (`BRK.B`→`BRK-B`). A manually
  logged and a broker-synced position of the same real security can land under
  two different strings in the same table. Entity Master's alias table is
  seeded ONLY in hyphen form, so `resolve("BRK.B")` returns `not_found` — this
  silently degrades Watchlist/Portfolio Intelligence and Research
  estimates/financials for the dot spelling only. Price lookup itself is
  robust (`to_polygon_symbol()` accepts both). Not urgent — documented in
  `journal_two.py`'s own docstring as a known, accepted limitation. Fix shape:
  a normalization shim or a second seeded alias, NOT a data migration.
- **Seam 2 — holiday-blind session helper (CROSS-SYSTEM TEMPORAL DEFECT).**
  `app/src/utils/marketSession.js::expectedLatestDailySessionET()` decrements
  only for Sat/Sun, never for an NYSE holiday — on a holiday evening it
  returns the holiday's own date as "the last closed session." `useMarketOpen.js`
  is correctly holiday-aware (backed by S11's real `nyseCalendar.js`), so
  `useBrokerMarkPreference.js` combines a holiday-aware `sessionClosed` with a
  holiday-blind `lastClosedSessionET` — an inconsistent pairing that can
  misclassify which valuation basis (broker mark vs. live feed) six
  member-visible surfaces show (OpenPositionsTab, TodayMarketLead,
  PositionDetailPage, JournalSnapshotTile, BrokerAccountHero, PositionsTable).
  ~9 holidays/year, self-corrects at next sync/render. S11 already exposes the
  missing primitive: `holidayOn(isoDate)` in `nyseCalendar.js` — a one-function
  reuse fix, do NOT build a new calendar framework.

## DEFERRED (not authorized, do not build without new explicit authorization)

- Technical grounded Ask AI (Phase C)
- Comparison multi-security AI (needs a new two-symbol evidence-isolation grounding contract)
- Watchlist multi-security AI summary (needs a new N-symbol grounding contract)
- Portfolio-wide AI (needs a new grounding contract; study `portfolio_heat.py`/`grade_watchlist.py` first, not `ticker_explain.py`)
- Position-context-in-security-AI (member owns-this-security facts inside `?section=ai` — cheapest of the AI gaps to ground, still needs a new evidence domain, not started)
- New S7 trigger types / new S7 UI merge
- Watchlist filing-watch creation action
- Alert Return-to-Research Consistency (capability S — only S7 document-arrival alerts populate `research_url`; every other alert family is a click dead end) — real gap, ranked #3 candidate, not chosen for this program
- S8 Freshness Presentation Consistency (several freshness values in `watchlist_intelligence.py` are hardcoded `"fresh"` rather than S8-derived) — ranked #4 candidate, not chosen
- Attention on TradeDetailPage/TradeDrawer (temporal-risk deferral, Attention Signal Propagation V1 Phase A — needs a closed-trade recency-gating mechanism first; TradeDrawer additionally has a settled "navigate away via TradeResearchTrigger" design that inlining would undermine)
- Attention on TickerPopup/TickerHubSheet (NOT V1, Attention Signal Propagation V1 Phase A — needs a new entitlement/plan-check contract on the shared attention endpoints first, since ~31 call sites are mostly free-reachable; the two components must move together)
- Attention on Research (assessed NOT-NEEDED-REDUNDANT, Attention Signal Propagation V1 Phase A — every fact the contract computes is already shown there at greater depth via the identical underlying service calls)
- D2 broad canonical data model
- D5 corporate actions
- Generalized workflow/integration-bus architecture

## Concurrent, unrelated — do not touch, do not investigate

- 8G-B scanner/pattern-engine performance work (own continuity doc:
  `docs/uct-scanner-intelligence/continuity-checkpoint.md`) — treat its
  commits on master as ordinary drift unless a merge shows actual file
  overlap.

## Session-recovery checklist for a replacement Claude session

1. Re-fetch `origin/master` and re-derive the current SHA — do not trust any
   SHA in this file without confirming it's still current.
2. Re-check Pattern Vision's `PATTERN_VISION_ENABLED` and safety-default env
   vars on Railway `web` (`railway variables --service web --kv`) before
   assuming the "CURRENT LIVE OBSERVATION" section above is still accurate.
3. Check whether Mon 9/7 / Tue 9/8 / Wed 9/9 have passed; if so, the
   observation gate above is stale — pull the real evidence before reporting
   a Pattern Vision classification.
4. Check whether a genuinely newer NVDA filing has landed (S7 Stage 2) —
   `GET /api/alerts/taxonomy/fires` for the production predicate, or the
   `alert_fires` table directly.
5. Universal Ticker Actions Convergence V1 (merge `dee56d7de`) and Attention
   Signal Propagation V1 (merge `5e07b8150`) are both ACCEPTED + LIVE as of
   this checkpoint — do not re-implement either or treat them as pending;
   confirm via `git log` only if something here looks stale.
6. Do not re-run Phase A for Watchlist Intelligence, Portfolio Intelligence,
   Comparison V1, Entry-Point Convergence, Universal Ticker Actions
   Convergence, Attention Signal Propagation, or the Whole-Product
   Convergence Review from scratch — their findings above are current as of
   this checkpoint; verify against live code only where something here looks
   stale.
7. **No Terminal program is currently authorized.** Do not begin
   implementation of any candidate from "NEWLY IDENTIFIED DEBT" or "DEFERRED"
   without a new, explicit owner authorization naming that program.
