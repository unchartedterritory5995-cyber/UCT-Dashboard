# UCT Terminal — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. Refresh at every
> major package boundary, merge/deploy gate, or STOP point. This is not a
> historical encyclopedia — keep it concise, overwrite stale sections rather
> than appending to them.

**Last verified:** 2026-09-06, against live git + Railway state (post-
Awareness Source-Integrity Audit + Hardening V1 merge/deploy/production-verification).

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
- **origin/master (last verified):** `f2d96ce1155146295e3a58229db556a47b6ef564`
  (Awareness Source-Integrity Audit + Hardening V1 merge — this file's own update
  is a docs-only branch cut fresh from this SHA; drift since then is unrelated
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
- **Alert Return-to-Research Consistency V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `c27c95c50`, deployed + production-verified 2026-09-05/06. Phase A
  found the notification-center click-through mechanism already existed
  generically (`AlertBell.jsx::handleItemClick` reads `a.data?.research_url`
  for ANY alert type — shipped earlier for S7's document-arrival slice); the
  real gap was entirely upstream — most security-scoped alert producers never
  populated that field even though they already hold a trustworthy symbol.
  V1 is exactly 2 additive lines in `api/services/watchlist_alert_service.py`,
  zero frontend changes, zero changes to `alerts.py`/`routers/alerts.py`: (1)
  `deliver_alert_payload` (the shared seam for indicator_alert,
  indicator_alert_migration, catalyst_alert, catalyst_mustknow,
  catalyst_digest, calendar_alert, awareness_engine, and document_arrival)
  now does `data.setdefault("research_url", f"/research/{sym.upper()}")` when
  `sym` is present and not the literal `"MARKET"` (catalyst_digest's
  no-single-ticker fallback); (2) `_deliver_alert` (the independent
  price-alert lane that bypasses `deliver_alert_payload`) got the same field
  added to its inline `data` literal. `setdefault` (never assignment) means
  S7's own already-set `research_url` survives unchanged. Converged families:
  price_alert, indicator_alert, indicator_alert_migration, catalyst_alert,
  catalyst_mustknow, calendar_alert, awareness_engine (all now stamp
  `research_url`); catalyst_digest converges PARTIALLY (real single-ticker
  digests get it, the `"MARKET"` multi-name fallback correctly does not).
  Confirmed non-security and correctly untouched: `regime_change`,
  `exposure_shift`, `wire_missed` (no symbol ever). Confirmed dead code, out
  of scope: `stop_hit`, `scanner_match` (zero live callers, test-fixture-only)
  and `ep_resolved` (no implementation anywhere — docstring + severity-map
  entry + frontend icon only, cannot fire in production). Deliberately
  deferred, see DEFERRED below: `ai_deep_report`/`ai_briefing` (ticker-collision
  risk with the literal placeholder "AI"/real ticker C3.ai) and
  `exposure_gate` (macro gate-level alert, not a personal-security signal,
  also feature-flag OFF). Cross-cutting safety independently re-verified by
  direct code read (not trusted from a summary): the S7 dual-write read-state
  guard (`alerts.py:181-186`) is a strict `data["source"] == "document_arrival"`
  equality check a `research_url` key cannot trip; the S7 durable-alert dedup
  keys exclusively on `data["accession"]`, a field only `document_arrival.py`
  ever sets (confirmed by exhaustively grepping all 12 `add_alert` call sites
  in the repo). 11 new focused tests
  (`tests/test_alert_research_url_routing.py`), all passing; full adjacent
  regression (384 backend + 13 frontend `AlertBell` tests) green after fixing
  an environmental `npm install` gap in the fresh worktree (not a code
  regression — see Attention Signal Propagation V1's identical gap, above).
  Also newly confirmed (not fixed, not new — pre-existing and out of scope
  per this program's own authorization): `AlertBell.jsx`'s per-item row is a
  bare `<div onClick>` with no `role`/`tabIndex`/`onKeyDown`/`aria-label` —
  keyboard-inaccessible today for every alert type including the already-live
  S7 rows, unchanged by this V1 since zero frontend files were touched. See
  the new debt entry below.
- **Temporal / Freshness Truth Convergence V1** — IMPLEMENTED + ACCEPTED +
  LIVE, merge `94dd2bb5e`, deployed + production-verified 2026-09-05/06.
  Phase A found S11 already owns a real, holiday/half-day-aware canonical
  session clock (`app/src/lib/marketClock/marketClock.js::sessionState()`
  backed by `nyseCalendar.js::holidayOn`/`earlyCloseOn`/`hasCoverage`) that
  `app/src/utils/marketSession.js` never consumed — its
  `expectedLatestDailySessionET()` skipped only weekends and used a hardcoded
  16:00 ET close threshold, so a real NYSE holiday evening (or a real
  early-close day) could misreport "the last closed session." The proven,
  dated defect: `useBrokerMarkPreference.js` pairs a correctly holiday-aware
  `sessionClosed` with the holiday-blind date, so on every full NYSE holiday
  evening the inflated date could silently SUPPRESS a correct broker-mark
  preference across 7 named Journal 2.0 surfaces (never wrongly activate one
  early — the `>` comparison direction makes the bug one-sided). V1 converges
  exactly two functions in `app/src/utils/marketSession.js`
  (`expectedLatestDailySessionET`, `isDailyTodayCloseProvisionalForPaint`) to
  consume S11's existing `holidayOn`/`earlyCloseOn`/`hasCoverage` exports —
  zero new S11 contract, zero backend changes, degrades exactly to the prior
  weekday-only/16:00 behavior outside `nyseCalendar.js`'s covered years
  (2026 only). Every other consumer (`isDailyTailStale`,
  `isDailyTailStaleForPaint`, `expectedDailyTailForPaintET`,
  `isIntradayTailStale`, `StockChart.jsx`, `barsIDB.js`, `prefetchBars.js`,
  `useBrokerMarkPreference.js`) inherited the fix automatically by reference —
  none needed a direct edit. 17 new/extended fixed-clock tests (holiday,
  day-after-holiday, real early-close, weekend+adjacent-holiday, outside-
  calendar-coverage), all passing; adjacent regression 105/106 (the one
  failure — a bare-`useSWR`-site census drift in
  `pollingSites.rail.test.js` naming unrelated files `useFloor.js`/
  `useWatchlistIntelligence.js` — confirmed pre-existing/concurrent drift,
  not touched by this diff). Explicitly DEFERRED, see DEFERRED below:
  Watchlist Attention freshness hardening (hardcoded `"fresh"` on price-move/
  earnings-proximity facts in `watchlist_intelligence.py`), Portfolio/
  Position Attention freshness parity (facts computed but their
  freshness/source not rendered on `PortfolioAttentionBanner.jsx`/
  `PositionDetailPage.jsx`), duplicated weekend-only walk-back loops in
  `app/src/utils/extSession.js` (drives the pre/post-market toggle on every
  chart — larger blast radius than `marketSession.js` itself, needs its own
  Phase A trace before any fix) and `LiveFlow.jsx`/`LiveFlow_admin.jsx` (the
  latter partner-owned, no edit without ack), and dual NYSE holiday-table
  consolidation (`nyseCalendar.js`'s `COVERED_YEARS=[2026]` table vs
  `api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` covering 2025-2027 —
  currently byte-identical on all 10 of 2026's dates but two independently
  hand-maintained authorities, not one by construction; zero observed live
  defect today, a real architecture decision, not a bounded V1).
- **S8 / Attention Freshness Propagation V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `0d1c1d5bf`, deployed + production-verified 2026-09-05/06. Phase A
  audited the full `get_intelligence_for_symbols()` fact/status contract and
  found the analyst-action fact was the one correctly S8-derived pattern
  (`meta.get("freshnessClass")`/`sourceObservedAt`), while Watchlists rendered
  each fact's `source`/`freshness` but Portfolio (`PortfolioAttentionBanner.jsx`)
  and Position Detail (`PositionDetailPage.jsx`) silently discarded those same
  already-fetched fields, and both consumers collapsed a total fetch failure
  into the same rendered-nothing state as "no open positions" — a real outage
  read as reassuring silence. V1 (Candidate B: propagate existing fields,
  frontend-only, zero backend changes) fixed exactly that gap across 3
  component files: `PortfolioAttentionBanner.jsx` and `PositionDetailPage.jsx`
  now render each fact's `source`/`freshness` inline and show a distinct "Could
  not check for updates" state on a hook `error` instead of returning `null`;
  `Watchlists.jsx`'s attention-column degraded-indicator check was broadened
  from the literal `status === 'unavailable'` to any non-`'ok'` status (a
  `'partial'` status with nothing notable previously fell through to the same
  blank cell as a fully-clean row). Zero backend files touched, zero new
  endpoints/hooks — `useJ2PositionsAttention.js`'s `error` was already reliable
  across both SWR-key shapes, verified by direct read before implementing. 26
  new/extended focused tests + 17/17 on the broader Watchlists regression
  suite, all passing; clean build. Phase A additionally surfaced (NOT fixed by
  this V1 — see NEWLY IDENTIFIED DEBT below): `_price_move_fact()`'s `as_of`
  uses `datetime.date.today()` (a wall-clock call, violating the file's own
  no-wall-clock rule); `_analyst_fact()`'s and `_earnings_facts()`'s total-
  source-outage paths both incorrectly leave `status="ok"` (analyst_action's
  outage is masked because `get_analyst_ratings()` is documented "never raise";
  earnings_proximity's `_earnings_facts()` runs entirely outside the per-symbol
  try/except with no exception handling of its own at all — FLAGGED TO STOP,
  not touched, because closing it requires changing
  `calendar_alerts._get_reporters_for_date()`'s return contract and Phase A did
  not confirm whether other callers of that private helper exist);
  `research/ratings.py::get_ratings()`'s real `price_as_of` field is computed
  but discarded by `_rating_context()` before it ever reaches a fact.
- **Attention Source-Integrity Hardening V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `dc2cdc906`, deployed + production-verified 2026-09-06. Phase A
  (4 independent verification agents + synthesis) confirmed two MATERIAL
  TRUST BUGs in `get_intelligence_for_symbols()`'s source-integrity
  accounting, both the same architectural anti-pattern: an internal swallow
  layer intercepted a real provider exception BEFORE the piece of machinery
  specifically built to convert "source failed" into `sources_failed += 1`
  ever saw it. (1) Earnings: `calendar_alerts._get_reporters_for_date()`'s
  3-leg fallback (cache → Finnhub → FMP) structurally cannot raise by design,
  so a total outage on any window day was indistinguishable from a genuinely
  quiet week. Fixed by adding `_get_reporters_for_date_with_status()` /
  `_fmp_reporters_for_date_with_status()` (the existing functions become
  byte-identical thin wrappers, so `awareness/engine.py`'s and
  `calendar_alerts.py`'s own alert scanner — the other 2 production callers —
  are untouched); `_earnings_facts()` now applies a genuine leg failure as a
  shared, batch-level `sources_failed` increment for every requested symbol
  (earnings is one shared lookup, not per-symbol). (2) Analyst action:
  `analyst_grades.py`'s 4 private FMP helpers (`_fmp_row`/`_fmp_rows`/
  `_fmp_row_with_meta`/`_fmp_rows_with_meta`) swallowed EVERY exception
  (`except Exception`) including real `ProviderError` outages, before
  `get_analyst_grades()`'s own `all_answered`/`_FAIL_TTL` self-heal
  mechanism — already built for exactly this distinction — could ever see
  them. Fixed by narrowing those 4 catches to `ProviderNotFound` only (a
  genuine no-data signal); real failures now propagate to the existing
  `ThreadPoolExecutor` loop. The corrected signal reaches
  `watchlist_intelligence.py` via a new opt-in `outage_out` out-param on
  `get_analyst_grades()`/`get_analyst_ratings()` — both functions' existing
  public return shapes (pinned by exact-key-set tests, including the live
  `/api/research/analyst-ratings/{sym}` route) are byte-for-byte unchanged;
  `_analyst_fact()` raises when `outage_out["outage"]` is true, mirroring
  `_filing_fact()`'s existing `RuntimeError`-on-error idiom. Also folded in
  Seam 8's narrow, zero-migration sub-fix: `_price_move_fact()`'s
  `as_of=datetime.date.today()` → `as_of=None` (no trustworthy per-symbol
  evidence timestamp exists anywhere in the current pipeline — confirmed by
  tracing `live_prices.py`/`journal_two.py`/the frontend `changes` hooks end
  to end; all three consumers already null-guard `as_of`). Full per-ticker
  timestamp threading (2 endpoint contracts + 1 frontend hook) remains
  DEFERRED. Zero public API contract changes across all 8 other confirmed
  production callers of the two touched modules; zero frontend files
  touched. 7 backend files changed (4 source + 3 test), 328 focused +
  adjacent tests passing (2 pre-existing exact-equality miss-dict assertions
  updated to include the new `_outage` key; 4 new regression tests added
  proving the exact silent-failure scenarios each fix closes).
- **Awareness Source-Integrity Audit + Hardening V1** — IMPLEMENTED + ACCEPTED
  + LIVE, merge `f2d96ce11`, deployed + production-verified 2026-09-06. Phase A
  independently traced Awareness end to end (single entry point: the
  double-gated `_awareness_engine_scan` scheduler job) and confirmed the
  program's central question: `api/services/awareness/engine.py::
  _collect_earnings_window()` has the SAME MATERIAL DEFECT class as the
  just-fixed Attention earnings bug — it called `calendar_alerts.
  _get_reporters_for_date()`, which structurally cannot raise, so its own
  `try/except Exception: any_failed = True` was dead code. The consequence
  here was more precise than Attention's: `any_failed` was never a raw
  counter, it was the input to an ALREADY-BUILT, already-wired self-heal
  (`_EARNINGS_MEMO_TTL_PARTIAL`=5min vs `_EARNINGS_MEMO_TTL`=1h) that was
  permanently starved — a genuine source outage on any window day memoized a
  day-incomplete window for the full hour, indistinguishable from a quiet
  week, silencing R5 earnings-proximity for any symbol reporting on the
  failed day. Fixed by reusing S9's own `_get_reporters_for_date_with_status()`
  sibling verbatim (zero new backend infrastructure) — `_collect_earnings_
  window()` now tracks the real `ok` flag instead of a dead exception
  handler; `_get_reporters_for_date()`'s other production caller
  (`calendar_alerts.py`'s own `run_prereport_alerts()`) is untouched, and
  Attention's `_earnings_facts()` was already migrated in S9. Rewrote the
  load-bearing `test_collect_earnings_window_partial_day_failure_uses_
  short_memo_ttl` from mocking an actually-raised exception (a failure mode
  the real function structurally cannot produce) to `(set(), False)` — the
  real production failure shape — plus a new all-sources-fail control test.
  Also independently traced and correctly ruled OUT two other candidate
  findings: `rule_stop_watch`'s cold-price-cache skip is HONEST AS DESIGNED
  (no fetch attempt exists inside Awareness to fail, confirmed by direct
  code read + an explicit in-file comment); the Alert Return-to-Research
  path (`_fire_candidate` → `deliver_alert_payload(source="awareness_
  engine")`) is a separate call site, structurally unreachable from the
  earnings-window bug, confirmed unaffected. One separate, DIFFERENT
  reliability gap was found and correctly classified OUT OF SCOPE for this
  narrow V1 — see the new debt entry below (regime-classifier whole-cycle
  scan abort). 16 focused tests passing (15 existing awareness tests + 1
  new), 122 adjacent regression tests passing across
  `test_calendar_alerts.py`/`test_watchlist_intelligence.py`/
  `test_analyst_grades.py`/`test_analyst_grades_cache_policy.py`/
  `test_calendar_paging.py`/`test_fmp_guard_census.py`/
  `test_calendar_a5_modernization.py`/`test_alert_research_url_routing.py`.
  1 backend file changed (`api/services/awareness/engine.py`) + 1 test file
  extended; zero frontend files touched, zero public API contract changes.

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

- **None — requires new explicit authorization.** Awareness Source-Integrity
  Audit + Hardening V1 (the prior active program) is now ACCEPTED + LIVE —
  see "CURRENT ACCEPTED" above. Per the owner's explicit closing instruction
  on that program's authorization ("Then STOP. Do not automatically start
  another Terminal program."), no next Terminal program has been
  automatically begun. The next Terminal program requires a new, explicit
  owner authorization. Do not infer one from the "NEWLY IDENTIFIED DEBT" or
  "DEFERRED" sections below, nor from Attention Signal Propagation V1's own
  explicitly-deferred surfaces (TradeDetailPage/TradeDrawer Attention,
  TickerPopup/TickerHubSheet Attention, Research Attention), nor from Alert
  Return-to-Research Consistency V1's own deferred families
  (`ai_deep_report`/`ai_briefing`/`exposure_gate`), nor from Temporal /
  Freshness Truth Convergence V1's own deferred candidates (the
  `extSession.js`/`LiveFlow.jsx` duplicated walk-back loops, the dual NYSE
  holiday-table consolidation — Watchlist/Portfolio/Position Attention
  freshness parity was closed by S8), nor from Attention Source-Integrity
  Hardening V1's own remaining deferred item (Seam 8's full per-ticker
  timestamp threading — the earnings/analyst status-integrity bugs it also
  surfaced are now CLOSED, above), nor from Awareness Source-Integrity Audit
  + Hardening V1's own out-of-scope finding (the regime-classifier
  whole-cycle scan-abort risk — see the new debt entry below) — those are
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
- **Seam 5 — AlertBell notification rows are keyboard-inaccessible (surfaced
  by Alert Return-to-Research Consistency V1's Phase A, 2026-09-05/06).**
  `app/src/components/AlertBell.jsx`'s per-item row is a bare
  `<div onClick={...}>` with no `role`, no `tabIndex`, no `onKeyDown` handler,
  and no `aria-label` — a keyboard-only member cannot open any notification,
  including the already-live S7 document-arrival rows. Pre-existing (predates
  this program), not worsened by it (this V1 touched zero frontend files),
  and explicitly out of scope per that authorization's own "do not redesign
  Notification Center" framing — recorded here because Phase A newly
  confirmed and documented it. Fix shape: `role="button"` + `tabIndex={0}` +
  an `onKeyDown` handling Enter/Space, mirroring `handleItemClick`.

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
- **Seam 2 — holiday-blind session helper — RESOLVED by Temporal / Freshness
  Truth Convergence V1, merge `94dd2bb5e`, 2026-09-05/06.**
  `app/src/utils/marketSession.js::expectedLatestDailySessionET()` and
  `isDailyTodayCloseProvisionalForPaint()` now consume S11's existing
  `nyseCalendar.js::holidayOn`/`earlyCloseOn`/`hasCoverage` exports instead of
  weekend-only/hardcoded-16:00 date math — the fix described here (a
  one-function reuse, no new calendar framework) is exactly what shipped. Kept
  as a record; do not re-open unless a concrete regression is found.
- **Seam 6 — duplicated weekend-only walk-back date loops beyond
  `marketSession.js` (surfaced by Temporal / Freshness Truth Convergence V1's
  Phase A, 2026-09-05/06).** The same structural defect class Seam 2 had
  (skip weekends only, never NYSE holidays) also exists independently in
  `app/src/utils/extSession.js::_prevTradingDay()` — which drives the
  pre/post-market toggle on EVERY chart in the app, a materially larger blast
  radius than `marketSession.js` itself — and in
  `app/src/pages/LiveFlow.jsx`/`LiveFlow_admin.jsx::mostRecentMarketDay()`
  (the latter is Ravi's partner-owned surface — no edit without ack). Neither
  received the exhaustive per-scenario proof this program ran on
  `marketSession.js`, so neither is a responsible V1 candidate yet — needs its
  own Phase A-style trace first. Not urgent (no demonstrated live defect
  found for either in this program's bounded check).
- **Seam 7 — two independently hand-maintained NYSE holiday tables (surfaced
  by Temporal / Freshness Truth Convergence V1's Phase A, 2026-09-05/06).**
  `app/src/lib/marketClock/nyseCalendar.js` (`COVERED_YEARS=[2026]` only) and
  `api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` (2025-2027) are two
  separate, differently-shaped authorities (a bundled frontend JS table vs. a
  backend table reached over `GET /api/market-calendar` →
  `useMarketCalendar.js` → `useSessionState.js`, the Dashboard session pill) —
  verified byte-for-byte identical on all 10 of 2026's real dates today, but
  that agreement is coincidence, not construction: nothing enforces the two
  stay in sync if either is ever tuned. Zero observed live defect. Fix shape
  is a real cross-stack architecture decision (which authority wins; whether
  the frontend should fetch the calendar instead of bundling it) — explicitly
  out of scope for a bounded V1, not urgent.
- **Seam 8 — `_price_move_fact()`'s evidence date is wall-clock, not source-
  derived — PARTIALLY RESOLVED by Attention Source-Integrity Hardening V1,
  merge `dc2cdc906`, 2026-09-06.** The narrow, zero-migration half shipped:
  `as_of=datetime.date.today().isoformat()` → `as_of=None` (an honest
  "no reliable evidence date" rather than a fabricated wall-clock stamp; all
  three consumers already null-guard `as_of`). The full fix — deriving a
  real per-symbol evidence timestamp from a live-price snapshot — remains
  DEFERRED: Phase A traced the entire pipeline (`live_prices.py`,
  `journal_two.py`'s `positions_attention` endpoint, `watchlists.py`'s
  `IntelRequest.changes`, the frontend `changesForIntel` hook) and confirmed
  no trustworthy per-symbol timestamp exists anywhere in it today —
  `changes` is a bare `{SYM: pct}` dict end-to-end. Closing it requires
  widening 2 backend endpoint contracts + 1 frontend hook, which fails the
  "small, additive, no broad caller migration" gate. Fix shape: add a real
  observed-at field to `live_prices.py`'s response and thread it through
  both endpoints into `_price_move_fact`.
- **Seam 9 — analyst-action and earnings-proximity total-source-outage paths
  left `status="ok"` — RESOLVED by Attention Source-Integrity Hardening V1,
  merge `dc2cdc906`, 2026-09-06.** Both MATERIAL TRUST BUGs fixed via the
  identical additive pattern (a new `_with_status` sibling function/out-param,
  existing function becomes a byte-identical thin wrapper for its other
  callers — zero public contract changes). Earnings:
  `calendar_alerts._get_reporters_for_date_with_status()` exposes whether
  each window day's 3-leg fallback actually ran cleanly; `_earnings_facts()`
  applies a real leg failure as a shared `sources_failed` increment for
  every requested symbol. Analyst: `analyst_grades.py`'s 4 private FMP
  helpers now catch only `ProviderNotFound` (not bare `Exception`), letting
  a real `ProviderError` reach `get_analyst_grades()`'s own
  `all_answered`/`_FAIL_TTL` mechanism (already built for this, previously
  dead against real outages); the signal reaches `watchlist_intelligence.py`
  via a new opt-in `outage_out` out-param on `get_analyst_grades()`/
  `get_analyst_ratings()`. Kept as a record; do not re-open unless a
  concrete regression is found.
- **Seam 10 — Awareness's regime-classifier read can silently abort the
  ENTIRE scan cycle for every user (surfaced by Awareness Source-Integrity
  Audit + Hardening V1's Phase A, 2026-09-06, correctly classified OUT OF
  SCOPE for that program's narrow V1).** `voice_regime_classifier.
  get_current_regime()` has no try/except of its own around
  `_fetch_signals()`/`_classify()` (only the final `cache.set()` call is
  defensively wrapped); `awareness/engine.py::_build_market_scan_ctx()` —
  which calls it — is itself called from `run_awareness_scan()` with NO
  try/except at that call site either (only the PER-USER rule loop and the
  per-candidate `_fire_candidate` call are exception-isolated). A single
  regime-classifier hiccup therefore propagates uncaught all the way up to
  the scheduler's own bare `try/except Exception: print(...)` in `api/main.
  py::_awareness_engine_scan()`, silently dropping stop-watch + earnings-
  proximity + regime-flip awareness for EVERY user that 20-minute cycle with
  only an unstructured `print` as evidence. This is a DIFFERENT defect
  mechanism from the earnings-swallow bug fixed above (whole-cycle-abort-on-
  uncaught-exception vs a permanently-dead-input flag) and a materially
  different fix shape (new exception-isolation structure around a scan-cycle
  boundary, not a `_with_status` sibling) — correctly kept out of this V1 per
  its "narrowest fix, no broad Awareness redesign" authorization. Not
  confirmed to have fired in production; a real but undemonstrated risk.
  Fix shape: wrap `_build_market_scan_ctx()`'s call (or just the regime read
  inside it) in its own try/except with a structured log, mirroring the
  per-user isolation pattern already used one line below it.

## DEFERRED (not authorized, do not build without new explicit authorization)

- Technical grounded Ask AI (Phase C)
- Comparison multi-security AI (needs a new two-symbol evidence-isolation grounding contract)
- Watchlist multi-security AI summary (needs a new N-symbol grounding contract)
- Portfolio-wide AI (needs a new grounding contract; study `portfolio_heat.py`/`grade_watchlist.py` first, not `ticker_explain.py`)
- Position-context-in-security-AI (member owns-this-security facts inside `?section=ai` — cheapest of the AI gaps to ground, still needs a new evidence domain, not started)
- New S7 trigger types / new S7 UI merge
- Watchlist filing-watch creation action
- S8 Freshness Presentation Consistency — price-move and earnings-proximity source-side freshness derivation (Temporal / Freshness Truth Convergence V1 Phase A originally ranked this #4; S8 / Attention Freshness Propagation V1 Phase A re-scoped it into Seam 8 (price-move `as_of`, PARTIALLY RESOLVED — see Seam 8 above) and Seam 9 (analyst_action/earnings_proximity total-outage status integrity, RESOLVED — see Seam 9 above); only Seam 8's full per-ticker timestamp threading remains open, needing a real backend-contract change across 2 endpoints + 1 frontend hook)
- `research_url` for `ai_deep_report`/`ai_briefing` (Alert Return-to-Research Consistency V1 Phase A) — both hardcode/fall back to the literal placeholder symbol `"AI"`, which collides with the real NYSE ticker for C3.ai, Inc.; wiring a route here would silently misroute to a wrong real company. `ai_briefing` additionally has split identity (`r['sym'] or 'AI'`) with no field to distinguish a real per-ticker briefing from the placeholder after the fact.
- `research_url` for `exposure_gate` (Alert Return-to-Research Consistency V1 Phase A) — `exposure_gate_watch.py` bypasses `deliver_alert_payload` entirely via a direct `add_alert` call; feature-flag OFF by default (`EXPOSURE_GATE_WATCH_ENABLED='0'`); syntactically a real tradable ETF ticker but semantically a macro gate-level alert, not a personal-security signal — a product-scope decision, not a technical blocker.
- Reactivating `stop_hit`/`scanner_match` or implementing `ep_resolved` (Alert Return-to-Research Consistency V1 Phase A) — all three are dead/nonexistent code (zero live callers, or no implementation at all); out of scope regardless of research-routing.
- Attention on TradeDetailPage/TradeDrawer (temporal-risk deferral, Attention Signal Propagation V1 Phase A — needs a closed-trade recency-gating mechanism first; TradeDrawer additionally has a settled "navigate away via TradeResearchTrigger" design that inlining would undermine)
- Attention on TickerPopup/TickerHubSheet (NOT V1, Attention Signal Propagation V1 Phase A — needs a new entitlement/plan-check contract on the shared attention endpoints first, since ~31 call sites are mostly free-reachable; the two components must move together)
- Attention on Research (assessed NOT-NEEDED-REDUNDANT, Attention Signal Propagation V1 Phase A — every fact the contract computes is already shown there at greater depth via the identical underlying service calls)
- Watchlist Attention freshness hardening — see Seam 8/Seam 9 above (S8 / Attention Freshness Propagation V1 Phase A superseded and precisely re-scoped this item from Temporal / Freshness Truth Convergence V1 Phase A's original framing)
- Portfolio/Position Attention freshness parity — RESOLVED by S8 / Attention
  Freshness Propagation V1, merge `0d1c1d5bf`, 2026-09-05/06.
  `PortfolioAttentionBanner.jsx`/`PositionDetailPage.jsx` now render each
  fact's `freshness`/`source` and show a distinct error state instead of
  silently rendering nothing on a fetch failure — the fix described here (pure
  frontend propagation of already-fetched fields, zero new contract) is
  exactly what shipped. Kept as a record; do not re-open unless a concrete
  regression is found.
- `research/ratings.py::get_ratings()`'s `price_as_of` field discarded before
  reaching a fact (surfaced by S8 / Attention Freshness Propagation V1 Phase A,
  2026-09-05/06) — `_rating_context()` in `watchlist_intelligence.py` reads
  `composite_rating`/`rs_rank` from `get_ratings()` but drops its real
  `price_as_of` field; `context` is explicitly outside the fact/status system
  by the module's own docstring (informational only), so this is a MINOR
  DISCLOSURE GAP, not a trust bug — not fixed, out of scope for S8's selected
  V1 candidate.
- `extSession.js`/`LiveFlow.jsx` duplicated walk-back loops (Temporal / Freshness Truth Convergence V1 Phase A — see Seam 6 above; needs its own Phase A trace first)
- Dual NYSE holiday-table consolidation (Temporal / Freshness Truth Convergence V1 Phase A — see Seam 7 above; a real cross-stack architecture decision, zero live defect today)
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
5. Universal Ticker Actions Convergence V1 (merge `dee56d7de`), Attention
   Signal Propagation V1 (merge `5e07b8150`), Alert Return-to-Research
   Consistency V1 (merge `c27c95c50`), Temporal / Freshness Truth
   Convergence V1 (merge `94dd2bb5e`), S8 / Attention Freshness
   Propagation V1 (merge `0d1c1d5bf`), Attention Source-Integrity
   Hardening V1 (merge `dc2cdc906`), and Awareness Source-Integrity Audit +
   Hardening V1 (merge `f2d96ce11`) are all ACCEPTED + LIVE as of this
   checkpoint — do not re-implement any of them or treat them as pending;
   confirm via `git log` only if something here looks stale.
6. Do not re-run Phase A for Watchlist Intelligence, Portfolio Intelligence,
   Comparison V1, Entry-Point Convergence, Universal Ticker Actions
   Convergence, Attention Signal Propagation, Alert Return-to-Research
   Consistency, Temporal / Freshness Truth Convergence, S8 / Attention
   Freshness Propagation, Attention Source-Integrity Hardening, Awareness
   Source-Integrity Audit + Hardening, or the Whole-Product Convergence
   Review from scratch — their findings above are current as of this
   checkpoint; verify against live code only where something here looks
   stale.
7. **No Terminal program is currently authorized.** Do not begin
   implementation of any candidate from "NEWLY IDENTIFIED DEBT" or "DEFERRED"
   without a new, explicit owner authorization naming that program.
