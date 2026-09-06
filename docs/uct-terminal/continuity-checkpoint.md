# UCT Terminal — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. Refresh at every
> major package boundary, merge/deploy gate, or STOP point. This is not a
> historical encyclopedia — keep it concise, overwrite stale sections rather
> than appending to them.

**Last verified:** 2026-09-05/06, against live git + Railway state (post-Portfolio
Intelligence V1, post-Whole-Product Convergence Review).

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
- **origin/master (last verified):** `da91a07d0760c96e6f4ad8621f61feaa2caea2fe`
  (Portfolio Intelligence V1 merge `c1c206838` is an ancestor; drift since then is
  unrelated concurrent work — Live Massive / Notebook migration — no overlap
  with anything in this file).
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
  TickerPopup + PositionsTable row click-through. Explicitly NOT done:
  PositionDetailPage/TradeDetailPage/TradeDrawer navigation wiring (that gap
  is exactly what the next authorized program, below, closes), the
  `position_id` sentinel/join defect, portfolio_heat.py/get_risk_dashboard UI
  surfacing, any symbol-normalization fix.

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

- **Universal Ticker Actions Convergence V1** — NOT YET AUTHORIZED FOR
  IMPLEMENTATION (Phase A + a dedicated implementation-readiness audit both
  complete as of the 2026-09-05/06 Whole-Product Convergence Review;
  classification returned to the owner was **READY WITH CONDITIONS**, not
  outright READY — two named conditions below). Worktree used for the review:
  `C:\Users\Patrick\uct-worktrees\terminal-convergence-review` (detached HEAD,
  no implementation branch cut yet).
  - **Part A:** add a "Compare" action to `app/src/components/TickerActions.jsx`
    (the universal right-click/long-press ticker menu, mounted on 11+ surfaces)
    and to `app/src/components/mobile/TickerHubSheet.jsx` (its touch
    equivalent — confirmed NOT at the path a prior brief guessed, and confirmed
    to NOT delegate to `useTickerActions`, so both files need the edit
    independently). Reuse the exact `goToCompare` + inline `SymbolSearch
    "+Compare"` pattern already live in `TickerPopup.jsx`
    (lines ~84-91, ~230-248) — same canonical `/research/:sym/compare/:comparator`
    route, no new picker component.
  - **Part B:** wire Full Research / Ask AI / Compare navigation into three
    Journal 2.0 detail surfaces confirmed to have zero of the three today:
    `app/src/pages/journal-2-0/components/position/PositionDetailPage.jsx`,
    `.../components/trade/TradeDetailPage.jsx`, and
    `app/src/pages/journal-2-0/components/TradeDrawer.jsx` (confirmed at this
    path, NOT under `components/trade/` as a prior brief guessed). Zero backend
    changes required anywhere in Part A or B — pure frontend navigation reuse
    of already-live routes.
  - **Conditions to resolve during implementation, not blockers:** (1)
    TickerHubSheet has no existing secondary-input mechanism of its own — needs
    the same small inline-picker code TickerActions.jsx needs, written a second
    time (or factored into one tiny shared piece); (2) TradeDetailPage's CTA
    row already holds 3-4 elements — recommend ONE overflow trigger for
    Research/Ask AI/Compare rather than 3 more inline buttons.
  - **Explicitly OUT of V1:** the `j2_trades.position_id` sentinel/join defect
    (separate, larger data-integrity item), `HistorySection.jsx` click-through
    to individual closed trades, `PortfolioAttentionBanner.jsx` card
    click-through (a natural v1.1, not required), any symbol-normalization fix
    (Seam 1, below — V1 uses whatever symbol string each page already holds,
    unchanged), any multi-security AI work.
  - Update this section's status (implementation branch / merged / deployed)
    once the owner authorizes proceeding past the readiness audit.

## NEWLY IDENTIFIED DEBT (fast-follow bugfix candidates, not programs — surfaced by the Whole-Product Convergence Review, 2026-09-05/06)

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
5. Check `git log`/`git worktree list` for the current state of any
   implementation branch for Universal Ticker Actions Convergence V1 before
   resuming — none existed as of this checkpoint (Phase A + readiness audit
   only); this file will lag actual branch state between refreshes.
6. Do not re-run Phase A for Watchlist Intelligence, Portfolio Intelligence,
   Comparison V1, Entry-Point Convergence, or the Whole-Product Convergence
   Review from scratch — their findings above are current as of this
   checkpoint; verify against live code only where something here looks stale.
7. Universal Ticker Actions Convergence V1 has NOT been authorized past its
   readiness audit as of this checkpoint — do not begin implementation without
   confirming the owner has since said to proceed.
