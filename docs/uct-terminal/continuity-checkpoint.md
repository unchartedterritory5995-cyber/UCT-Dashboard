# UCT Terminal — Continuity Checkpoint

> Navigation/resume artifact for session crash recovery. Refresh at every
> major package boundary, merge/deploy gate, or STOP point. This is not a
> historical encyclopedia — keep it concise, overwrite stale sections rather
> than appending to them.

**Last verified:** 2026-09-06, against live git + Railway state, post
Verdict & Pattern-Bridge Trust Adjudication (Seam 28, closes Seam 26)
merge/deploy/production-verification -- the top-ranked MUST-FIX from the
same-day owner-authorized WHOLE-PRODUCT STRATEGIC RE-ANCHOR (13-lens
multi-agent current-state review + synthesis, ~3.9M subagent tokens, 699
tool calls, zero lens failures). Full re-anchor report delivered to the
owner in-conversation; this doc keeps only the load-bearing conclusions,
not the full 30-section report. Seam 29 is next, per the standing
directive's instruction to continue directly down the priority stack.

## FRESH WHOLE-PRODUCT STRATEGIC RE-ANCHOR (2026-09-06) — supersedes the priority
## stack below; read this FIRST before selecting any future program

Owner-authorized, NOT a re-ranking of the existing ledger: a 13-lens parallel
multi-agent review (core workflow, capability audit A+B, trust/provenance,
AI grounding, portfolio/journal, monitoring, search/command, technical/
scanner (read-only), mobile/UX, architecture, production reliability,
competitive parity) plus one synthesis pass, all grounded in direct code
reads + verified live state against `7e9770dae8be4126a941623a83bcff43cfcf8e50`.
Full 30-section report delivered to the owner in-conversation; this doc
keeps only what changes the standing plan.

**Headline conclusion: the deterministic spine (identity/routing/comparison/
attention/alerting) that this session's ~16 prior programs converged is now
essentially coherent. The remaining gap is NOT missing capability — it is
(a) trust-boundary inconsistency across already-built AI surfaces and
(b) reachability of already-built capabilities that are effectively
islands.** Product stage: **COMPLETION-HARDENING**, not mid-build.

**Two MATERIAL TRUST/CORRECTNESS defects were found live in production,
neither previously on the ledger, both now numbered:**
- **Seam 28 — RESOLVED same day, merge `efe64acfb`/`c3128e010`.**
  `grade_ticker`'s GO/HOLD/SKIP verdict (AI Search's `_ctx_verdict`/
  `_ctx_list_verdict` fast lane, the AI Search agent lane, and Compass
  voice+chat's unconditional core tool set) sourced the raw, ~16%-precision
  pattern-detector table and narrated it as "deterministic... the firm's
  computed read" with concrete entry/stop/size/account-risk numbers —
  `ticker_explain.py` already excludes this exact table as "D9-unsafe" for
  Research's own Ask AI; that judgment was never applied to AI Search or
  Compass. Same defect class the owner already formally adjudicated hours
  earlier this session as Seam 23 (raw pattern feed narrated as
  authoritative) — fixed at the shared root (`grade_ticker.py::
  _default_patterns_fn` now returns no detections until Pattern Vision is
  accepted), so all 5 real consumers (3 named + `grade_watchlist.py` +
  Compass chat) inherit it automatically. Absorbed and closed the old
  "Seam 26 (unaudited)" entry too (its own tools now disclose "unconfirmed"
  structurally). See "CURRENT ACCEPTED" for full detail.
- **Seam 29 — outage-integrity signal not threaded into Ask AI / Compare —
  NOT YET FIXED, now the active program.**
  `outage_out` (the analyst source-integrity signal added by Attention
  Source-Integrity Hardening V1) reaches `watchlist_intelligence.py` but
  NOT `ticker_explain.py` (line ~941) or `research/comparison.py` (line
  ~73) — both call `get_analyst_ratings(sym)` with no outage signal, so a
  real provider outage during either flagship grounded AI answer is
  silently indistinguishable from "no coverage." Smallest, most mechanical
  of the newly-found MUST-FIX items.

**Next priority stack (all unblocked by, independent of, Pattern Vision's
gate):** Seam 28 → Seam 29 → Awareness Reachability Restoration V1 → Alert
Durability V1 (non-S7 alerts are fully lost on every redeploy — no durable
storage, and this pod redeploys multiple times/day; the fix pattern already
exists in this codebase as S7's durable-receipts bridge) → Watchlists/
PositionsTable Keyboard Accessibility V1 (Seam 5's sequel — AlertBell's fix
was real but genuinely isolated; `PositionsTable.jsx`/`Watchlists.jsx`/
`TradesTable.jsx` are all still keyboard-inaccessible on higher-traffic,
paid-core surfaces) → Compare Coverage V1 (canonical Compare page has ZERO
price/technical data — a named north-star pillar can't answer "which one's
the stronger stock"; also reconcile/retire the disconnected
`ComparisonPicker.jsx`) → Calendar TickerActions Reuse V2 (Seams 19/20) →
Feature-Flag Governance Sweep (the flag-ledger test is RED on master; 3
undeclared live-armed flags found, one money-adjacent —
`BROKER_BALANCE_HISTORY_ENABLED=1`, flagged for owner confirm-or-rollback).

**Seam ledger reclassifications worth remembering** (full table in the
30-section report): Seam 5 confirmed RESOLVED (the ledger's own prose was
one commit stale, not the code); Seam 11's scope is wider than recorded
(also covers CSV-imported trades, not just broker sync); Seam 13's "fully
ABSENT" framing is STALE — a separate, uncoordinated notebook-platform
ledger already shipped `LinkedNotesPanel` on `PositionDetailPage.jsx`
(commit `37d608967`) — **two independent program ledgers now cover
overlapping product surface without cross-referencing each other, worth a
process fix, not just a doc fix**; Seam 18 reclassified OBSOLETE-OR-
SUPERSEDED (fixing dead News surfaces serves no member — pick TapeFeed as
canonical, then delete); Seams 3/4/27 confirmed LOW-PRIORITY, stop
escalating them.

**Two items explicitly flagged for OWNER decision (not stop conditions on
Seam 28/29, which need none):**
1. **Awareness Engine reachability** — restoring a visible destination is
   bounded engineering, but deciding whether the free-tier engine becomes
   paid-gated (matching its current paid-only destination) or the
   destination becomes free (matching the free-tier engine) is a
   monetization/entitlement policy call.
2. **`BROKER_BALANCE_HISTORY_ENABLED=1`** is live on Railway, money-adjacent,
   with zero recorded rationale anywhere this session's ledger can find —
   flagged for a quick owner confirm-or-rollback, not treated as broken.

**Do NOT re-run this full 13-lens sweep again soon** — the standing
obligation it discharges is now satisfied; the next several programs should
come directly off the priority stack above, with only the lighter-weight
bounded re-checks (as done between every program this session) in between,
until evidence goes stale or a priority interrupt fires (Pattern Vision
classification, a genuine new S7 filing).

### Prior priority stack (2026-09-06, pre-re-anchor) — superseded, kept for history
#1 Technical Research release (blocked on Pattern Vision) → #2-#5 (closed:
Journal/Trade Lifecycle, Search/Command, Event/Calendar→Research, Identity
Normalization) → #6 Technical Ask AI (same Pattern Vision gate, confirmed
independent of #1 — neither needs the other to ship first) → #7 (closed)
Shared Multi-Security Grounding Architecture V1. All #2/#3/#4/#5/#7 closures
and the #1/#6 gate logic remain accurate; superseded only in the sense that
the NEXT program is now Seam 28, not a re-derivation of this list.

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
- **origin/master (last verified):** `c3128e0108a4b3aaf2f35a9880bd46a7e0486dc6`
  (Seam 28's own merge -- this file's own update is a docs-only blob-swap on
  top of this SHA; drift since then is unrelated concurrent work -- re-check
  overlap before trusting this SHA is still current).
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
- **Journal / Trade Lifecycle Convergence V1** — IMPLEMENTED + ACCEPTED +
  LIVE, merge `701ca7319`, deployed + production-verified 2026-09-06. A
  4-agent Phase A workflow independently traced the real Journal 2.0 domain
  model (not assumed from names) and CONFIRMED the prior review's flagged
  `position_id` sentinel is still true today: `j2_trades.position_id` is a
  genuine FK back to `j2_positions.id` ONLY for the manually-entered close
  path (`trades.py::close_position`); every broker-synced closed trade gets
  `position_id = f"manual-{uuid.uuid4()}"` (`trades.py::bulk_insert_trades`,
  called from `broker/reconstruct.py`) — a structurally inert placeholder,
  since broker sync is the dominant live population and the corresponding
  OPEN `j2_positions` row is usually already DELETED by the time the trade
  closes (`balances.py`). Classified `ABSENT_NO_SAFE_INFERENCE` — a genuine
  "Position → Related (closing) Trades" feature was correctly NOT built
  (would either silently omit most members' trades or require a forbidden
  heuristic symbol+date match); recorded as new debt below, not fixed.
  Instead selected the smallest V1 the audit found HIGH-value/LOW-cost/
  zero-linkage-risk: `HistorySection.jsx` (PositionDetailPage) and
  `DayTradesTable`/`OptionStrategiesSection` (Calendar `DayDetailPage.jsx`)
  rendered every closed-trade/closed-option row with **zero click handler**
  — confirmed by direct read (no onClick/Link/navigate anywhere in either
  component), not inferred from the workflow's claim. Both now route through
  the exact `onRowAction` pattern `TradeJournalTab.jsx` already ships:
  equity rows (a real `j2_trades.id` in both surfaces — neither endpoint
  ever unions in option strategies, confirmed via each backend query)
  navigate to `/journal-2-0/trade/:id`; CLOSED option-strategy rows open the
  existing `TradeDrawer` via `optionClosedToRow()`, moved out of
  `TradeJournalTab.jsx` into the shared `lib/optionCalcs.js` (zero behavior
  change, verified via the full pre-existing test suite) so both surfaces
  can never diverge on how a raw strategy becomes a trade-drawer row.
  Deliberately did NOT wire DayDetailPage's EXPIRING (still-open) option
  strategies — `TradeDrawer.jsx`'s own docstring documents it as showing
  "detail for a single **closed** trade," and passing an open strategy
  through `optionClosedToRow()` (which reads `closedAt`/`exitPrice`/
  `pnlDollar`, all null pre-close) would misuse the component outside its
  designed contract; a regression test pins that an expiring strategy stays
  inert. Zero backend changes, zero new endpoints, zero heuristic
  trade↔position inference. 9 focused/regression tests added across
  `DayDetailPage.test.jsx` (6, including the expiring-stays-inert control)
  and `PositionDetailPage.test.jsx` (3); full adjacent frontend regression
  (162 files / 1504 tests across all of `journal-2-0`) green; clean build;
  2 pre-existing, unrelated lint findings noted (not introduced, not fixed —
  `DayDetailPage.jsx`'s unused `useMemo` import, `PositionDetailPage.jsx`'s
  `combinePositions` fast-refresh export warning — both present on master
  before this program).
- **Search / Command Convergence V1** — IMPLEMENTED + ACCEPTED + LIVE, merge
  `e36ca0eb5`, deployed + production-verified 2026-09-06. A 5-agent Phase A
  workflow inventoried the real search/command ecosystem (not assumed from
  memory): `CommandPalette.jsx` (global Ctrl/Cmd+K, mounted once in
  `Layout.jsx`, S2's "security/company discovery + navigation only" narrow
  slice per its own 2026-09-03 docstring) and `SymbolSearch.jsx` (the real
  canonical security picker, 12+ confirmed importers) were both confirmed
  STRONG/real; `search→Research` CONVERGED; `search→Compare` CONVERGED (via
  SymbolSearch); `search→Ask AI` PARTIAL — the palette had no path to Ask AI
  at all (by its own explicit design scope), and `ChartWidget.jsx`'s
  right-click "AI search this bar" was independently verified BROKEN by
  direct code read (posted into the general, non-grounded `aiSearchBus`/
  `AiSearchWidget` popup, never canonical Ask AI). `duplicated_security_search`
  scored HIGH (7+ independent ticker-lookup reimplementations found), but
  most are legitimately local (a ProseMirror mention-autocomplete plugin
  can't mount a React component; an always-open multi-add combobox has
  different UX semantics than a picker) — none were selected for this V1.
  Chosen V1: complete the Ask AI convergence gap only. Fixed by (1) rerouting
  `ChartWidget.jsx`'s "AI search this bar" to the exact
  `/research/:sym?section=ai` route `TickerActions.jsx`'s "Ask AI about
  {sym}" already uses (verbatim precedent, confirmed via direct read of that
  file's own in-code comment documenting the identical prior defect class),
  removing the now-dead `tempAi`/`AiSearchWidget`/`aiSearchBus` scaffolding
  that action alone owned; (2) adding a strictly-additive Ctrl/Cmd+Enter /
  Ctrl/Cmd+click secondary action to `CommandPalette.jsx` that opens Ask AI
  for the active/typed symbol — bare Enter/click is completely unchanged,
  verified by every one of the palette's pre-existing 20 tests passing
  unmodified. No Compare action was added to the palette (no base/current
  symbol context exists there for a two-symbol comparison). Fixing
  `ChartWidget.jsx` required adding `useNavigate()`, which surfaced a real
  regression in its own existing test suite (5 files across
  `ChartWidget.test.jsx`/`.session.test.jsx`/`.volumepane.test.jsx`/
  `.header.test.jsx`/`builderDoor.wire.test.jsx` — none had ever wrapped the
  component in a Router, since it never needed one before) — fixed by adding
  `MemoryRouter` to each. Zero backend changes, zero new endpoints, zero new
  search UI. 4 new focused tests added to `CommandPalette.test.jsx` (24 total,
  was 20) proving the exact convergence; full frontend regression (1012 test
  files) green except 7 files/8 tests confirmed pre-existing and unrelated
  (Pine/ThinkScript corpus + chart-engine-manifest suites, a `floor2`/
  `community` reachability finding, a `useWatchlistIntelligence.js` polling-
  site finding, a `ThemeTrackerPage.jsx` timing flake, and a genuinely
  pre-existing missing-`r.ok`-check bug in `CommandPalette.jsx`'s own fetch —
  every one independently confirmed present on master BEFORE this diff via
  direct `git show` against the base SHA, none touching any file this
  program changed). See the new debt entries below for what was found but
  deliberately not fixed.

- **Event / News / Calendar → Research Convergence V1** — IMPLEMENTED +
  ACCEPTED + LIVE, merge `d46f35a68`, deployed + production-verified
  2026-09-06. A 4-agent Phase A workflow inventoried the real Calendar/News/
  Catalyst ecosystem (not assumed from memory): earnings is CONVERGED
  end-to-end through a SINGLE choke point — every earnings-rendering surface
  (EarningsCard, EarningsTile, CalendarDayTable, FeedView's two row types,
  TodaysBrief, MonthView→drawer) funnels into `EarningsResearchModal`'s
  member-clicked "Full Research" button (`navigate('/research/${sym}')`,
  confirmed by reading the handler/JSX, not the docstring); Catalyst is
  STRONG on its two live surfaces (`CatalystTable.jsx` on Dashboard/Morning
  Wire, `CatalystsHistory.jsx`) via the existing `TickerPopup` door reaching
  both `/research/{sym}` and `?section=ai`; News is WEAK (the one code-correct
  tile, `NewsFeed.jsx`, is orphaned — its only importer `TapeFeed.jsx` is
  itself unmounted, confirmed via `reachable.test.js`). The real, confirmed
  gap: `EventCard.jsx`'s three variants (IPO/Dividend/Split cards, rendered in
  `FeedView.jsx`'s DayGroup) had **zero onClick anywhere in the file** — a
  full-file grep found no interactivity of any kind on cards that already
  carry a real, security-scoped `sym` (confirmed via the calendar events
  pipeline's `cap_universe` filter, which cannot pass a blank symbol). Chosen
  V1: wire exactly those three variants to the same bare
  `navigate('/research/${sym}')` shape already shipped at
  `EarningsResearchModal.jsx:160` and `TickerActions.jsx` — the smallest cut
  closing the highest ratio of dead-ends-to-files-touched (3 event families,
  1 file). Deliberately used a native `<button>` wrapper (mirroring
  `EarningsTile.jsx`'s existing pattern) rather than a bare `<div onClick>` —
  Phase A independently found that exact keyboard-trap pattern already
  shipped on 3 sibling components (`CalendarDayTable.jsx` Row,
  `EarningsCard.jsx`, `MonthView.jsx` MonthCell), so this V1 deliberately does
  not add a 4th instance; disabled (non-navigating) when `sym` is absent, so
  a malformed event can never fabricate a Research route. Zero backend
  changes, zero new endpoints, zero new query-param taxonomy invented (no
  event-context preservation attempted — Phase A confirmed
  `ResearchPage.jsx` reads exactly one query param, `section`, seeded once at
  mount, and the closest prior-art precedent, the S7/alert `research_url`
  field, also drops context, so this would have been new plumbing, not
  reuse). No Ask AI or Compare action added to any event card — no evidence
  supported either affordance on a static IPO/Dividend/Split card, consistent
  with the authorization's explicit bias against over-cluttering event cards.
  Primary-source access was never at risk: none of the three card variants
  had an external link to begin with (pure static display), so nothing was
  clobbered. 6 new focused tests (click-through ×3, keyboard Tab+Enter,
  keyboard Tab+Space, disabled/no-sym guard) added to the pre-existing
  `eventCard.test.jsx` (which itself needed `MemoryRouter` wrapping once
  `useNavigate()` was introduced — the same self-caused-regression class
  independently caught and fixed in Search/Command Convergence V1's
  `ChartWidget.jsx`, found here by tracing the file's actual pre-existing test
  suite rather than trusting Phase A's "regression risk: LOW" claim at face
  value); full adjacent frontend regression (1012 test files) green except
  the same 7 files/8 tests confirmed pre-existing and unrelated in the prior
  program (Pine/ThinkScript corpus + chart-engine-manifest suites, a
  `floor2`/`community` reachability finding, a `useWatchlistIntelligence.js`
  polling-site finding, a `ThemeTrackerPage.jsx` timing flake, and
  `CommandPalette.jsx`'s pre-existing missing-`r.ok` fetch bug) — independently
  re-confirmed byte-identical to base master via `git diff --stat` this round,
  not merely re-cited from the prior program. See the new debt entries below
  for what was found but deliberately not fixed.

- **Identity Normalization Hardening V1** — IMPLEMENTED + ACCEPTED + LIVE,
  merge `9c1bff81f`, deployed + production-verified 2026-09-06. A 4-agent
  Phase A workflow (independently re-verified against real source, not
  trusted from its own summary) mapped Entity Master's real resolve() +
  alias-seeding behavior precisely: `resolve()` applies only
  `.strip().upper()`, no dot/hyphen transform; `scripts/entity_master_seed.py`
  seeds ONLY the hyphen spelling (`BRK-B`) as a canonical alias, so
  `resolve("BRK.B")` returns `not_found` today (confirmed by a passing
  assertion in `scripts/test_entity_master_seed.py`) — this is the single
  most load-bearing fact this program surfaced, and it bounds what a
  write-time-only fix can and cannot close. Three priorities, in the
  authorization's own order:
  - **Priority 1 (Seam 17's real data-integrity risk — CLOSED, narrowly).**
    A new `api/services/journal_two/symbol_normalize.py::normalize_symbol()`
    (relocated, not reinvented, from `broker/snaptrade_adapter.py`, which now
    imports it) is the single shared implementation for
    uppercase+trim+dot-to-hyphen canonicalization. Manual AddPosition
    (`positions.py::_validate_create_payload`), manual AddTrade
    (`trades.py::_validate_manual_trade_payload`), and CSV import (6 call
    sites in `csv_import.py`) now all route through it — closing the
    realistic manual-vs-broker spelling-divergence path (BRK.B entered by
    hand vs BRK-B synced from a broker landing as two different strings in
    `j2_positions`/`j2_trades`). Deliberately NOT an existence/tradability
    check per the authorization's explicit instruction — a delisted, renamed,
    or entirely fictional ticker still saves unchanged (regression-tested).
    **Seam 17's ORIGINAL framing (AddPositionModal.jsx/AddTradeModal.jsx are
    bare text inputs with no autocomplete/search UI) is NOT closed and was
    never attempted** — that is a real, separate, larger UI initiative;
    do not conflate "the spelling-divergence risk is closed" with "Seam 17 is
    closed."
  - **Priority 2 (Seam 1 — PARTIALLY resolved, honestly bounded).** The
    write-time half of Seam 1 (manual `.strip().upper()` vs broker-sync's
    additional dot-to-hyphen step producing two spellings of one security) is
    now closed by the same `normalize_symbol()` reuse above.
    `comparison.py::get_comparison()` also gained an entity-id equality guard
    (resolves both sides via Entity Master BEFORE the expensive per-side
    fetches; rejects two spellings that resolve to the same `entityId`) —
    but this is **real-but-partial**: it only fires when both spellings are
    ALREADY-seeded S3 aliases of the same entity, which BRK.B/BRK-B itself is
    NOT (per the finding above — `BRK.B` alone resolves `not_found`, so a
    raw BRK.B-vs-BRK-B comparison today is NOT caught by this guard). The
    READ-SIDE half of Seam 1 — S3's alias table not carrying the dot
    spelling at all, degrading Watchlist/Portfolio Intelligence and Research
    estimates/financials for existing dot-spelled references — is
    UNCHANGED; S3 schema/alias-seeding was explicitly protected/out-of-scope
    for this V1.
  - **Priority 3 (Seam 15 — CLOSED, via a smaller mechanism than originally
    proposed).** All 8 "+ Compare" `SymbolSearch` call sites (`ResearchHeader`,
    `TickerPopup`, `TickerActions`, `TickerHubSheet`, `PositionDetailPage`,
    `TradeDrawer`, `TradeDetailPage`, `Watchlists`' `CompareSearch`) used to
    pass `sym={null}` (or `sym=""` for Watchlists, which had no base-symbol
    threading mechanism at all), defeating `SymbolSearch.jsx`'s OWN
    pre-existing `clean !== sym` self-exclusion guard — the guard was never
    missing, it was structurally unreachable. Fixed by passing the real
    current symbol at all 8 sites, confirmed safe by a full read of
    `SymbolSearch.jsx`: the trigger button's visible text is controlled by
    `displayLabel`, not `sym` (Phase A's synthesis had not surfaced this,
    and `ResearchHeader.jsx`'s own old comment defending `sym={null}` was
    describing a risk `displayLabel` already structurally prevented). Fixed
    as a side effect: all 8 sites previously shipped a literal
    `"null — click to search"` tooltip (`sym` template-interpolating to the
    string "null"). Seam 15's originally-proposed fix shape (a new
    `excludeSym` prop on the shared component) was NOT needed — the
    per-caller prop fix was smaller and sufficient.
  - **Production collision audit** (Section IX, read-only + aggregate-only,
    via `railway ssh` against live `/data/auth.db` — never the local
    `C:\data\auth.db` mirror): **zero existing symbol-spelling collisions**
    in `j2_positions`/`j2_trades` grouped by user. This is a pure hardening
    fix, not a migration — no positions/trades were merged, no historical
    rows rewritten.
  - **Tests:** 9 new backend unit tests (`test_symbol_normalize.py`, new) +
    9 new tests across `test_positions.py`/`test_trades.py`/
    `test_csv_import.py`/`test_research_comparison.py` (dot→hyphen
    normalization, delisted/fictional-ticker pass-through regression guards,
    same-entity-different-spelling rejection, unresolved-symbols-not-treated-
    as-same-entity). Two PRE-EXISTING test-mock gaps in
    `test_research_comparison.py` were found and fixed in the same diff (two
    mocks returned a fixed `entity_id="ent_x"` regardless of input symbol,
    which the new same-entity guard correctly-per-its-inputs treated as a
    self-comparison) — a genuine test-fixture gap the new guard exposed, not
    a production defect. 8 new frontend tests directly on `SymbolSearch.jsx`
    (self-exclusion firing/not-firing, tooltip regression) + 8 new
    caller-level tests confirming each of the 8 Compare sites now threads the
    real symbol through — which also caught and fixed a PRE-EXISTING broken
    assumption in `ResearchHeader.test.jsx` and `TickerPopup.test.jsx`: both
    files' `SymbolSearch` mocks discriminated the Compare instance from the
    primary instance by `sym` truthiness, an assumption this fix inverted
    (both instances now receive a real, truthy `sym`) — fixed to discriminate
    by `displayLabel` instead, matching the real component's own logic. Full
    directory-scoped backend regression (positions/trades/csv_import/broker/
    entity_master/research/journal_two-router-adjacent, ~620 tests) and
    full frontend regression on all 8 touched files + Watchlists' 4 split
    suites (121 tests) all green, deterministic across two runs; clean
    production build. A whole-repo `pytest --collect-only` background run
    stalled with no output for 10+ minutes and was abandoned rather than
    trusted or re-attempted blind — regression confidence rests on the
    directory-scoped runs actually completed, not a claimed full-suite pass.
  - **Deliberately NOT touched:** S3 schema/alias-seeding, search-index
    dot/hyphen dedup (Seam 16), Research/Watchlists/Attention/Alerts
    read-side alias resolution for EXISTING dot-spelled data, any historical
    position/trade migration, AddPositionModal/AddTradeModal autocomplete UI
    (Seam 17's original framing), and all Event/News/Calendar debt (Seams
    18-22) from the prior program.

- **AI Search Raw-Pattern Trust Adjudication V1** — IMPLEMENTED + ACCEPTED +
  LIVE, merge `897e53cc5`, deployed + production-verified 2026-09-06.
  Continuous-execution follow-on immediately after Technical Ask AI's Phase A
  surfaced Seam 23 as a live, material production trust defect (not a
  planned program). Read-only audit first, per the adjudication's own
  instruction not to assume the Phase A finding was automatically correct:
  independently re-traced the live path from scratch and confirmed it
  precisely — `api/routers/ai_search.py::_ctx_patterns()` called
  `voice_tool_impls._find_patterns_on_ticker()` → the raw rule-engine table
  (`pattern_engine.memory.get_active_detections()`, `confirmed_only=false`
  equivalent, the SAME ~16%-Opus-confirmation-rate feed whose universe-wide
  page was retired 2026-08-26), unconditionally, for the first two resolved
  symbols in EVERY AI Search answer — narration included fabricated-reading
  confidence percentages and concrete entry/stop/target price levels, all
  wrapped inside a system-prompt block explicitly labeled "UCT DESK CONTEXT
  (internal desk data — authoritative..." with zero confirmation or
  freshness disclosure, indistinguishable from genuinely trustworthy blocks
  (live price, regime). Classified MATERIAL PRODUCTION TRUST DEFECT per the
  adjudication's own rule (raw/unconfirmed detection ≠ member-facing fact).
  **Fix (remediation option B, "remove until the confirmed source is
  accepted" — the safest of the four options offered, per explicit
  instruction NOT to promote still-unaccepted Pattern Vision into this role
  as a workaround):** `_ctx_patterns()` and its unconditional call site
  deleted entirely. A member explicitly asking about a setup/pattern (new
  `_SETUP_RE` intent gate: `setups?|chart pattern|technical pattern|vcp|cup
  and handle|flag pattern|breakout pattern|forming a base/flag/pattern`) now
  gets an honest declared `"confirmed technical setup"` gap via the
  pre-existing, already-tested DESK GAPS mechanism (`grounding_gaps`) —
  never fabricated data, never a silent omission that reads as "nothing to
  say" either. Seam 25 (posture-block freshness) and Seam 24 (rejected-
  verdict read path) were explicitly left deferred per the adjudication's
  own instruction (neither is a small direct part of the raw-pattern fix).
  **Tests:** updated 4 test files that encoded the OLD "patterns always ride
  along" contract as passing assertions (`test_ai_search_topic_matrix.py`'s
  `test_price_check`/`test_why_moving`/`test_setup_questions`/
  `test_short_interest_questions`, `test_ai_search_limits.py`'s dedicated
  flow-and-patterns wiring test) — each now asserts the CORRECTED behavior
  (no raw pattern claim ever; a declared gap ONLY for genuine setup-intent
  questions) rather than being silently broken or loosened. New test
  `test_setup_question_declares_a_gap_not_the_raw_pattern_feed` pins the
  core fix directly. Full `ai_search`-family regression (1008 tests across
  32 files) green; module import + full `api.main` app-boot sanity check
  clean. Zero frontend changes (backend-only fix).
  **Deliberately NOT touched:** `voice_tool_impls.py::_find_patterns_on_ticker`
  itself (still live, still reads the same raw table — Compass Chat/Voice's
  OWN use of it is a separate, unaudited surface, recorded as new Seam 26,
  not silently expanded into this V1's scope); Pattern Vision (no code
  touched, no promotion into this or any other member-facing role); the
  parked Technical Research/Technical Ask AI specs (unrelated, both still
  wait on the same Pattern Vision gate).
- **Shared Multi-Security Grounding Architecture V1 (#7, Comparison leg)** —
  IMPLEMENTED + ACCEPTED + LIVE, merge `271f79664` (code) /
  `4c8b24c743a40aa3ef1a68641c0b64f800495906` (merge-to-master), deployed +
  production-verified 2026-09-06. Phase A verdict READY_WITH_CONDITIONS
  (2 parallel investigation agents + synthesis). Ships the SMALLEST
  trustworthy step from single-security grounded Ask AI to a genuine
  multi-security answer: exactly TWO member-chosen securities, built
  entirely on the already-accepted deterministic Comparison V1 contract
  (`comparison.get_comparison`) as the SOLE evidence source — never a
  second independent fetch, so the AI can never cite a number that
  disagrees with what the deterministic `/research/:sym/compare/:comparator`
  page shows for the same two securities.
  - New file `api/services/research/comparison_ai_adapter.py`:
    `build_comparison_evidence(sym_a, sym_b)` flattens `get_comparison()`'s
    fundamentals/ratings/analyst/estimates legs into citable evidence items
    tagged with the real `sym`/`side` ("a"/"b") each belongs to (ids stamped
    centrally, mirroring `ticker_explain._build_evidence`'s own `f"E{i}"`
    loop). `explain_comparison(sym_a, sym_b, question)` reuses
    `ticker_explain.py`'s `_grounding_flags` (evidence-id validity, numeric
    grounding, decisive-language ban, cross-fact consistency), `_RESPONSE_
    STATES`, `_wrap_evidence_block`, and `_get_client` UNCHANGED (confirmed
    safe: the two single-security-only domain-specific extensions inside
    `_grounding_flags` — `_rating_grounding_flags`/`_earnings_grounding_
    flags` — gate strictly on a `rating_field`/`earnings_field` key this
    adapter's evidence items never set, so both remain a correct no-op here
    exactly as they are for the six other pre-existing single-security
    domains). A NEW comparison-specific system prompt + `COMPARISON_SCHEMA`
    were required (NOT ticker_explain.py's `_SYSTEM_PROMPT`/`EXPLAIN_
    SCHEMA` reused verbatim) — that prompt explicitly frames "explaining
    ONE security" and carries Composite-Rating/Earnings-Events rules for
    domains this adapter never fetches, so reusing it would have been
    actively wrong, not merely unnecessary.
  - **The one genuinely new grounding mechanism:** `COMPARISON_SCHEMA`
    requires a `sym` field on every `key_facts` item (vs. `EXPLAIN_SCHEMA`'s
    `statement`/`evidence_id` only), and a new `_attribution_flags` check
    mechanically verifies it matches the REAL `sym` tag on the cited
    evidence item — the same "verify the machine-checkable field, never
    trust the free text to be self-consistent" idiom the Composite-Rating/
    Earnings-Events slices already established. This closes the one failure
    mode single-security grounding never needed to solve: a model citing a
    genuinely real `evidence_id` (so the existing id-validity check passes)
    while writing the fact about the WRONG security. Proven end-to-end by a
    dedicated test (`test_a_misattributed_key_fact_is_rejected_then_
    honestly_refused`), not just unit-tested in isolation.
  - New route `POST /api/research/compare/{sym}/{comparator}/explain`
    (auth-required, mirrors `/api/research/explain/{sym}`'s own auth-gate
    pattern exactly), own cost-guard surface `"comparison_explain"`
    (env `COMPARISON_EXPLAIN_MODEL`/`COMPARISON_EXPLAIN_COST_CAP_DAILY`) —
    deliberately separate from `ticker_explain.py`'s `"ticker_explain"`
    surface so neither feature's daily budget can silently cap the other.
  - New minimal "Ask AI" `TileCard` panel on `ResearchComparePage.jsx`
    (`components/ComparisonAskAi.jsx`), reusing `ResearchPage.module.css`'s
    existing `explain*` classes verbatim (zero new CSS beyond one
    `.aiSection` margin wrapper) — single-turn only, no history plumbing:
    Phase A confirmed no existing frontend surface carries a two-ticker
    conversation, and weakening `ticker_explain._clean_history`'s
    single-symbol isolation to retrofit one was explicitly out of scope.
  - **Explicitly deferred (Phase A synthesis, unchanged from the
    authorization):** N-ary (>2) comparison (the 2-arg cap is deliberate
    architecture at every layer of `comparison.py`, not a V1 shortcut);
    Watchlist multi-security AI (`get_intelligence_for_symbols`'s freshness
    is fabricated for 3 of 4 fact kinds — Seam 8 — grounding an LLM on a
    fabricated freshness field was rejected); Portfolio AI / LLM-computed
    P&L (confirmed net-new — no day-over-day delta/change-detection
    aggregate exists anywhere in the codebase, and no server-side P&L field
    exists to ground against); entitlement/plan-based ticker-count gating
    (`entitlements.Limits.max_symbols` is currently inert, wired only to
    Screener paths — the pricing decision is still open); free-text
    second-ticker extraction into single-security Ask AI (would require
    weakening `_clean_history`'s deliberate entity-isolation boundary).
  - **Tests:** 29 new backend tests (`tests/test_comparison_ai_adapter.py`
    — evidence builders, id stamping, the new attribution check in
    isolation AND end-to-end, full orchestration incl. retry-then-refuse/
    cost-cap/stop_reason=refusal/unparseable-JSON/decisive-language-
    rejection, route auth+shape+exception-degradation) + 6 new frontend
    tests (`ComparisonAskAi.test.jsx`). Full adjacent regression green:
    370 backend tests across all `research`-router-adjacent + `ticker_
    explain`/`comparison` suites, 103 frontend tests across all `pages/
    research/**` suites (19 files), full `npm run build` clean, `api.main`
    app-boot sanity check clean (1246 routes, new route present).
  - **Production verification:** exact commit match
    (`RAILWAY_GIT_COMMIT_SHA=4c8b24c743a40aa3ef1a68641c0b64f800495906`),
    new adapter file present on the pod, new route returns `401` unauth'd
    (proves live + correctly auth-gated without spending a real LLM call),
    existing deterministic `/api/research/compare/{sym}/{comparator}` route
    still returns `200` with real data (no regression from the shared
    `research.py` import change). Clean startup log aside from one
    PRE-EXISTING, UNRELATED defect newly observed during this verification
    — see the new debt entry below; not touched, not this program's to fix.
- **Journal ↔ Research Return-Context + Notes Draft-Loss Fix (Seam 12)** —
  IMPLEMENTED + ACCEPTED + LIVE, merge `d6a99c708` (code) / `119908685`
  (merge-to-master), deployed + production-verified 2026-09-06. Continuous
  Execution Directive program #8 -- selected via a Strategic Re-Anchor
  against the existing debt ledger (Section XXIII of the directive) rather
  than a fresh Phase A: Seam 12 was already fully audited and its fix shape
  already fully specified by Journal / Trade Lifecycle Convergence V1's own
  Phase A, so this program implemented that recorded spec directly (per the
  session-recovery checklist's own "do not re-run Phase A" convention).
  Ranked #1 against the directive's 7 re-anchor criteria because it was the
  only CONFIRMED (not merely theoretical) trust/correctness defect left
  unfixed in the ledger: "a Notes textarea's draft is flushed only onBlur,
  not on navigate-away... a real, confirmed data-loss bug, not a UX nicety."
  - New shared `app/src/lib/journal-2-0/researchReturnContext.js`
    (`buildResearchReturnParam`/`withResearchReturnParam`/
    `parseResearchReturnParam`/`researchReturnTarget`/`researchReturnLabel`)
    — the ONE build/parse pair for a `from=trade:{id}`/`from=position:{sym}`
    query marker, used by all three writer surfaces
    (`PositionDetailPage.jsx`'s own `goToResearch`/`goToAskAi`/`goToCompare`,
    `TradeDetailPage.jsx`'s `TradeResearchMenu`, `TradeDrawer.jsx`'s
    `TradeResearchTrigger`) and the one reader (`ResearchPage.jsx` renders a
    "Back to Trade"/"Back to {SYM} Position" link when `?from=` parses).
    `trade:{id}` always resolves to the canonical `/journal-2-0/trade/{id}`
    detail page regardless of whether the trade was originally viewed via
    `TradeDrawer`'s slide-over (which has no route of its own to reopen) or
    the full `TradeDetailPage` — a deliberately correct, always-valid
    destination, not an attempt to reconstruct the exact prior UI state.
  - **The confirmed data-loss fix:** `TradeDetailPage.jsx` gained a
    ref-backed unmount-cleanup effect (`notesFlushRef`, kept current every
    render since an empty-dependency-array cleanup only ever sees mount-time
    values otherwise) that fires a direct `PATCH` for an uncommitted Notes
    edit on true unmount, independent of `blur` timing — removing a focused
    element from the DOM (a full route navigation, e.g. clicking Full
    Research) does not reliably fire `blur` first. Deliberately scoped to
    TRUE UNMOUNT ONLY: the separate reseed effect that resets the Notes
    draft on prev/next navigation (`trade?.id` changing while the SAME route
    component stays mounted) is a different code path and was not touched.
    Confirmed via grep that `PositionDetailPage.jsx`/`TradeDrawer.jsx` have
    no equivalent raw Notes textarea (both use `LinkedNotesPanel` instead) —
    the data-loss half of this fix is `TradeDetailPage.jsx`-only by
    construction, not an oversight.
  - **Tests:** 9 new tests for the shared helper
    (`researchReturnContext.test.js`), 4 new `ResearchPage.test.jsx` tests
    (link renders/doesn't/uppercases/rejects malformed markers), 3 new
    `TradeDetailPage.test.jsx` tests (flush-on-unmount without ever
    blurring, no-op when never edited, onBlur still works unchanged), plus
    9 pre-existing navigation assertions across
    `PositionDetailPage.test.jsx`/`TradeDetailPage.test.jsx`/
    `TradeDrawer.test.jsx` updated to expect the new `?from=` marker (the
    same "old test encodes the old behavior" pattern hit in every prior
    program this session). Full regression: 1987 frontend tests across 196
    files green, clean `npm run build`.
  - **Production verification:** exact commit match
    (`RAILWAY_GIT_COMMIT_SHA=1199086855f6746e9aa0155035581a4b14510054`),
    clean startup log, and the deployed frontend bundle itself confirmed to
    contain the fix (`grep`-verified on the pod: a built chunk
    `researchReturnContext-*.js` containing the literal "Back to Trade"
    string) — the frontend-equivalent of the backend adapter-file-presence
    check used in prior programs, since a frontend fix's "did the SOURCE
    change" and "did the SERVED BUNDLE change" are two different questions.
  - **Explicitly NOT touched (separate, larger, unresolved seams):** Seam 11
    (broker-synced closed trades' inert `position_id` sentinel — a real
    architecture/product decision, not a bounded fix) and Seam 13 (Position
    → Notes continuity via `j2_notes.ticker` — a different, additive UI gap
    with its own fix shape). Neither is Seam 12's concern.
- **Awareness Scan-Abort Hardening V1 (Seam 10)** — IMPLEMENTED + ACCEPTED +
  LIVE, merge `b48200739` (code) / `7e2dec405727c5a1f625e9465b92afb3bd981d40`
  (merge-to-master), deployed + production-verified 2026-09-06. Selected via
  a BOUNDED reconvergence review against 4 already-ledgered candidates
  (Awareness scan-abort / dot-hyphen ticker-search identity / AlertBell
  keyboard accessibility / Seam 27 breadth warm-cache) rather than a fresh
  multi-agent Phase A, per owner instruction ("do not launch another broad
  multi-agent discovery program for already-audited seams unless the
  recorded evidence is stale or contradictory") — the evidence was neither,
  confirmed by direct re-verification against CURRENT code (not blind trust
  in the ledger) before selecting: **Seam 10 ranked #1** (member trust/
  correctness + silent loss of intelligence — the two top-weighted criteria
  this round), confirmed both LIVE in production (`AWARENESS_ENGINE_ENABLED=1`
  and `COMPASS_AUTOMATION_ENABLED=1` read live via `railway variables`, not
  assumed from a past decision) and structurally unchanged from the recorded
  audit. Dot-hyphen search identity and AlertBell keyboard accessibility were
  also re-confirmed current and real but ranked #2/#3 (real but lower-
  severity than a live silent-intelligence-loss risk) — left open for a
  future cycle, not touched this round.
  - **Re-verification found the recorded framing understated the blast
    radius slightly, in a way that didn't change the fix.** The seam named
    "the regime-classifier read" as the culprit; direct code read confirmed
    `voice_regime_classifier._fetch_signals()`/`_classify()` are in fact
    ALREADY well-guarded (every external fetch individually try/excepted,
    `_classify()` is pure arithmetic over None-guarded inputs that cannot
    raise or return an out-of-vocabulary regime string) — so the classifier
    call itself is a narrower risk than recorded. The REAL structural gap is
    one level up: `awareness/regime_snapshots.py`'s two raw SQLite calls
    (`get_last_label()`/`record_snapshot()`, no try/except of their own,
    real SQLite-lock contention is a documented risk class elsewhere in this
    codebase) sit inside the SAME unprotected `_build_market_scan_ctx()` call
    site, so the SAME fix (isolate that whole call site) closes both risks
    at once — the recorded fix shape was already correctly scoped even
    though its stated cause was incomplete.
  - **Fix:** new `_compute_regime_component()` in `api/services/awareness/
    engine.py` wraps the classifier call + both `regime_snapshots` calls in
    ONE try/except. On any failure it returns `{label: None, confidence:
    0.5, prev_label: None, degraded: True}` — confirmed by direct code read
    of `rules.rule_regime_flip` to be the EXACT shape that rule already
    treats as "nothing to report" (`if not label or not prev_label: return
    []`), so degrading to it on failure is not a new code path. Confirmed
    (also by direct code read of `rules.py`) that `rule_stop_watch` (R1/R2)
    and `rule_earnings_proximity` (R5) key off `live_prices`/
    `earnings_by_symbol` ONLY — neither reads `scan_ctx["regime"]` at all —
    so isolating the regime component is a real, not cosmetic, fix: a
    regime-classifier/ledger failure now degrades ONLY the regime-flip rule
    for that cycle, while stop-watch and earnings-proximity insights for
    every user still fire normally. A new `regime_degraded` flag threads
    into `run_awareness_scan()`'s summary dict (logged every cycle via the
    existing scheduler print) so a degraded cycle is honestly distinguishable
    from a genuinely quiet one, without inventing new alerting
    infrastructure.
  - **Deliberately UNCHANGED (per the "preserve the invariant, expose
    failure honestly" instruction when a component IS genuinely required):**
    `_bulk_load_user_contexts()` still aborts the whole cycle on failure —
    correct, since every rule genuinely needs it and there is nothing to
    isolate; a test pins this as a deliberate control, not an oversight.
    `voice_regime_classifier.py` itself was NOT touched — it has many other
    callers (`grade_ticker.py`'s regime GATE, `portfolio_heat.py`,
    Compass voice/chat) that depend on its current raise-through contract;
    changing its OWN error-handling would be a materially broader, riskier
    change than this bounded program authorizes. No S7 changes, no Pattern
    Vision changes, no provider-policy changes.
  - **Tests:** 10 new tests in `tests/test_awareness_engine.py` (classifier-
    exception / ledger-read-exception / ledger-write-exception / no-result-
    is-not-a-failure / the core isolation property proven twice — once at
    `_build_market_scan_ctx` level and once fully end-to-end through
    `run_awareness_scan()` with stop-watch confirmed to still fire and
    `regime_degraded=True` confirmed present — plus a control proving the
    bulk-load-failure invariant is unchanged). All 82 awareness/regime-
    adjacent tests green (72 pre-existing + 10 new), `api.main` app-boot
    sanity clean.
  - **Production verification:** exact-ancestor commit match (a concurrent
    session's push landed on top of this merge between push and check;
    `git merge-base --is-ancestor` confirmed this merge is included), the
    deployed pod's own `engine.py` grep-confirmed to contain
    `_compute_regime_component` (2 occurrences — definition + call site),
    clean startup log.
  - **Disk hygiene (housekeeping, not a Terminal program, performed before
    this program per owner instruction):** free disk was ~1.5GB (had
    dropped further from the ~2.2GB reported at the end of the prior
    checkpoint, likely from `npm install` in reused worktrees). Audited
    every worktree under `C:\Users\Patrick\uct-worktrees\` for merge-
    ancestry against `origin/master`; removed exactly the ones whose branch
    tip was a confirmed ancestor of master AND had no uncommitted changes
    (git's own `worktree remove` — no `--force` — refused every dirty one on
    its own, which is the safety net this relied on, not a separate check).
    109 worktrees removed total (90 cleanly + 19 more whose git-metadata
    `worktree remove` had already unregistered but whose on-disk files a
    Windows file-lock blocked from deleting until a PowerShell retry).
    Reclaimed **~36GB** (1.5GB → 37.6GB free). Left untouched, exactly per
    instruction: both of THIS session's own active worktrees, `entity-master`
    (sits on branch `master` itself), 8 worktrees with real uncommitted
    changes (`desk-sharpen-card`, `discord-chart`, `flow-sticky-guard`,
    `patterns-retire`, `phase-a-signature`, `s8-attention-freshness`,
    `single-stock-etfs`, `temporal-freshness-truth`), and every genuinely
    unmerged branch including the explicitly protected ones (`s7-stage4-5-
    ui`, `terminal-research`, `terminal-technical-convergence`) plus other
    live concurrent work (`media-evidence-foundation`,
    `media-evidence-foundation-integrated`, `notebook-primary-platform`,
    `options-desk`, `fcb-ship`, `desk-workshop-card`). Two directories
    (`breadth-lenses`, `pattern-audit`) were left as-is after a file inside
    each was reported actively locked by another process — genuinely
    ambiguous ownership, correctly not forced. Did not touch `uct-dashboard`
    itself, its `.claude/worktrees/agent-*` ephemeral agent worktrees, the
    `uct-dashboard-8gb-*`/`uct-dashboard-8gc-*`/canonical-pattern-library
    worktrees (8G-B scanner work, explicitly out of scope), or
    `uct-wt-chartrender`.
  - **Seam 27 triage (per owner instruction, classified without fixing):**
    re-read `api/main.py:962-964`'s `_breadth()` warm-task call site and
    `api/routers/breadth_monitor.py:439`'s `get_breadth_history` signature —
    confirmed the bug is SPECIFIC to this one direct, bypass-FastAPI warm
    call (`anchor`'s `Query(...)` default is never resolved outside a real
    request). A genuine HTTP request to this endpoint goes through FastAPI's
    own dependency injection, which resolves `anchor` correctly regardless —
    real member requests are unaffected; only the boot-time pre-warm
    convenience fails, non-fatally (already wrapped in try/except in
    `_warm`). Classification: **DEGRADED PERFORMANCE** (the first real
    request after each deploy pays a one-time cold-compute penalty the warm
    pass exists to avoid) — NOT a data-availability, freshness, or member-
    trust defect; data is eventually correct and complete either way. Stays
    ranked below Seam 10/16/5, unchanged from the pre-review hypothesis;
    not selected, not fixed this round.
- **Ticker Search Identity Convergence V1 (Seam 16)** — IMPLEMENTED +
  ACCEPTED + LIVE, merge `8ebb6f076` (code) / `910eca619` (merge-to-master),
  deployed + production-verified 2026-09-06.
  Closed the dot/hyphen share-class identity gap ranked #2 in the prior
  bounded reconvergence review (Awareness Scan-Abort Hardening V1's own
  entry, above).
  - **Root cause, confirmed by direct code read, not the recorded audit's
    framing alone:** Massive's own `/v3/reference/tickers` feed returns
    class-share tickers in DOT notation ('BRK.B'), but this codebase's
    canonical form is HYPHEN ('BRK-B') everywhere else. `entity_master_
    seed.py::_massive_reference_rows()` ALREADY hit and fixed this exact
    defect once, at Entity Master's own seeding time (its own docstring:
    "confirmed on real data: 13 of cap_universe's 14 hyphenated symbols had
    a live Massive dot-form row and were double-entitied this way") — but
    `ticker_search_index.py::_collect_rows()`, which independently sources
    from the SAME Massive feed, never received the same fix. Result: a
    rich, well-named row keyed 'BRK.B' (entity_id resolving to `None` --
    Entity Master's alias table only has the hyphen spelling) sat beside a
    blank, cap_universe-sourced 'BRK-B' row that DID resolve -- confirmed
    live in production BEFORE this fix (`GET /api/ticker-search?q=BRK`
    returned FOUR rows -- BRK-A/BRK-B/BRK.A/BRK.B -- for TWO real
    instruments, half with `entity_id: null`).
  - **Fix, entirely inside the shared search boundary, zero Entity Master or
    frontend changes:** (1) `_canonical_massive_ticker()` re-keys any
    dot-containing ticker to hyphen form inside `_put()` (the one place
    ALL THREE of `_collect_rows()`'s call sites converge), mirroring
    `entity_master_seed.py`'s already-validated transform verbatim --
    eliminates the duplicate row at index-BUILD time (a periodic background
    thread), zero added request-time cost. (2) `_share_class_alias()` is a
    narrowly-scoped query-side fallback (root + literal dot + 1-2 letters
    only -- matches every real cap_universe.json share-class ticker,
    explicitly NOT a blanket "every dot == every hyphen" rule) so a member
    who types the literal dot spelling still finds the now-single canonical
    row, applied in both `ticker_search_index.search()` and the router's
    pre-index-build startup-window fallback scan. Canonical OUTPUT ticker is
    now always the hyphen form, matching cap_universe/FMP/yfinance/
    Watchlists/Journal.
  - **All four named frontend consumers inherit the fix automatically, with
    zero code changes** (confirmed by direct grep, not assumed): `SymbolSearch.
    jsx`, `CommandPalette.jsx`, `TickerPopup.jsx`'s SwitchTickerBox, and
    `MobileSymbolSheet.jsx` all call the same `/api/ticker-search` endpoint.
  - **⚠️ OPERATIONAL GOTCHA, worth remembering for any future change to this
    module: the search index is a PERSISTED DISK SNAPSHOT with a 26h TTL
    (`ticker_search_index.json` on the Railway volume), not a pure
    request-computed value.** `start_background_build()` loads the snapshot
    at boot and skips rebuilding if it's still "fresh" (built within
    `_REFRESH_TTL`) -- so a code fix to `_collect_rows()` does NOT
    retroactively fix already-persisted duplicate rows, and a plain deploy
    alone does not trigger a rebuild either. **Confirmed by direct
    production observation**: immediately after this deploy, `GET /api/
    ticker-search?q=BRK.B` still returned the OLD, duplicated shape
    byte-for-byte -- the code was live but the stale snapshot was still
    being served. Fixed by triggering one manual `tsi.build_index()` via
    `railway ssh` (writes a fresh, de-duped snapshot) followed by one
    `railway redeploy --service web --yes` so the live serving process
    reloads it -- re-verified via real read-only production searches
    afterward (BRK/BRK.B/BRK-B/NVDA) confirming exactly 2 rows for BRK now
    (down from 4), each with a real name and a real entity_id. **Any future
    change to `_collect_rows()`'s output shape needs the SAME extra step —
    a deploy alone is not sufficient.**
  - **Explicitly did NOT touch:** Entity Master schema/alias data (zero
    writes -- `resolve("BRK.B")` itself still returns `not_found` for any
    OTHER caller; see the updated Seam 1 note above -- this is a genuinely
    separate, narrower fact, not a reduction of Seam 1's own remaining
    scope), historical J2 financial records, SnapTrade semantics, S7,
    Pattern Vision, parked Technical Research, Technical Ask AI's parked
    spec, 8G-B, Seam 14 (broad search-implementation consolidation), Seam 5
    (AlertBell), Seam 11 (broker position↔trade linkage), Seam 27 (breadth
    warm-cache).
  - **Tests:** 15 new tests in `api/services/test_ticker_search_entity_
    master_integration.py` (dot-form re-keying, dot+hyphen coalescing into
    one row, the coalesced row resolving the REAL seeded entity_id, dot/
    lowercase-dot/hyphen/lowercase-hyphen query variants, an ordinary
    ticker completely unaffected, a generic prefix query returning each
    instrument exactly once, an invalid ticker still returning nothing,
    different share classes never collapsing into each other, the
    narrow-regex safety guard against misfiring on an unrelated dotted
    string, the pre-index-build router fallback path, and a full
    router-level end-to-end proof) + all 13 pre-existing tests in that file
    green (28 total). 78 total across the broader Entity Master test
    surface, 43 frontend consumer tests (`SymbolSearch.test.jsx`,
    `CommandPalette.test.jsx`) confirmed unaffected (zero frontend changes
    were made), clean `api.main` app-boot.
  - **Seam 1:** confirmed OPEN, not narrowed by this program (see the
    updated Seam 1 entry above for the precise reasoning).
- **AlertBell Keyboard Accessibility (Seam 5)** — IMPLEMENTED + ACCEPTED +
  LIVE, merge `1eff7c83b` (code) / `296517d80` (merge-to-master), deployed
  + production-verified 2026-09-06. Closed the keyboard-accessibility gap
  ranked #3 in the prior bounded reconvergence review (Awareness Scan-Abort
  Hardening V1's own entry, above) and independently confirmed by Alert
  Return-to-Research Consistency V1's Phase A.
  - **Bounded re-verification before implementing (per the owner's own
    explicit instruction):** re-read `app/src/components/AlertBell.jsx` in
    full immediately before editing — confirmed byte-for-byte the same
    defect as both prior recordings: the per-item row (a `<div key={a.id}
    onClick={() => handleItemClick(a)}>`) carried no `role`, `tabIndex`,
    `onKeyDown`, or `aria-label`. No material change to the component since
    either prior audit.
  - **Fix, narrowly scoped to the one defective element:** added
    `role="button"` + `tabIndex={0}` + an `onKeyDown` handler firing on
    `Enter`/`Space` (calling `preventDefault()` on Space so the page does not
    also scroll) that calls the SAME `handleItemClick(a)` the mouse `onClick`
    already used — keyboard and mouse activation are now identical by
    construction, not a parallel reimplementation. Added a composed
    `aria-label` (`title` + `message` + `. Unread` when unread) so a
    screen-reader user landing on the row via Tab gets the same information
    the visual row shows; content-only, no visual change. The bell button
    (`aria-label="Notifications"`) and "Mark all read" were already real
    `<button>` elements and needed no change — confirmed unchanged by a new
    regression test asserting their tag name.
  - **Did NOT redesign Notification Center** — no new component, no new
    endpoint, no change to `handleItemClick`'s own logic, no change to the
    dropdown/list/failures rendering.
  - **Tests:** 5 new tests in `app/src/components/AlertBell.test.jsx`
    (row exposes `role="button"`/`tabIndex`/`aria-label`; Enter activates
    identically to a click, including the S7 `research_url` navigation;
    Space activates AND is prevented-default so it can't also scroll; an
    unrelated key, e.g. Tab, does nothing; bell + Mark-all-read remain plain
    `<button>` elements) + all 6 pre-existing tests in that file green (11
    total) + all 7 pre-existing `AlertBell.delivery.test.jsx` tests green
    (18 total across both files). No backend changes — this is a pure
    frontend accessibility fix; production verification is therefore
    build-confirmation + deploy-success rather than a live interactive
    check, matching the pattern established for Seam 12's frontend-only fix.
  - **Explicitly did NOT touch:** S7's `research_url` deep-link logic
    (`handleItemClick` itself, unchanged), the failures/`delivery-health`
    section, sound/browser-notification logic, identity-scoping bookkeeping,
    or any other Terminal seam.
- **Verdict & Pattern-Bridge Trust Adjudication (Seam 28, closes Seam 26)**
  — IMPLEMENTED + ACCEPTED + LIVE, merge `efe64acfb` (code) / `c3128e010`
  (merge-to-master), deployed 2026-09-06. Selected as the top-ranked
  MUST-FIX by the fresh Whole-Product Strategic Re-Anchor (see the
  top-of-file section) — a MATERIAL TRUST/CORRECTNESS defect, the same
  class already adjudicated hours earlier this session as Seam 23.
  - **Root cause, confirmed by direct code read across all three named
    surfaces before writing any fix (per the re-anchor's own instruction not
    to assume one fix shape fits all three):** `grade_ticker.py`'s ENTIRE
    decisive GO/HOLD/SKIP verdict was gated on `_default_patterns_fn()`,
    which called `pattern_engine.memory.get_active_detections()` — the
    exact raw, ~16%-Opus-confirmed rule-engine feed whose universe-wide page
    was already retired 2026-08-26 for this exact trust reason, and which
    `ticker_explain.py` had already excluded as "D9-unsafe" for Research's
    own Ask AI. `grade_ticker` had NO alternative, pattern-independent
    grading path — every consumer's decisive verdict depended on this one
    function. Five real call sites share it (only three were named in the
    seam): AI Search's `_ctx_verdict`/`_ctx_list_verdict` fast lane, AI
    Search's agent lane (`ai_search_agent.py`'s `_AGENT_ALLOWED`), Compass
    voice (`voice_tool_impls.py::_grade_ticker`), Compass chat
    (`coach_chat_tools.py::_exec_grade_ticker`), and `grade_watchlist.py`
    (bonus — not originally named, discovered during Phase A).
  - **Fix, at the ONE shared root, zero per-consumer changes needed** (same
    "fix once at the shared boundary" convention as Seam 16/Seam 10):
    `_default_patterns_fn` now returns `[]` unconditionally, with an
    extensive docstring explaining why and exactly what unblocks a future
    re-enablement. `grade_ticker` already had a correct, pre-existing honest
    fallback for "no usable setup" (`SKIP`/`no_setup`, `basis="No clean,
    tradable setup on {sym} right now"`) — this fix simply routes every
    real call through that existing honest path instead of a
    fabricated-confidence one. **Deliberately does NOT re-point at Pattern
    Vision's own confirmed verdicts** (`pattern_vision.store.get_confirmed`)
    — Pattern Vision is itself still under its own live, time-boxed
    acceptance trial (see "CURRENT LIVE OBSERVATION" below), and doing so
    would be exactly the "quietly promote an unaccepted system into a
    member-facing authority" move Seam 23's own adjudication forbids. All 5
    consumers inherit the fix automatically.
  - **Seam 26 (the standalone `find_patterns_on_ticker`/
    `scan_active_patterns` raw-detection-listing tools, NOT routed through
    grade_ticker) got its own, separate fix** — the re-anchor's menu of
    "remove the raw sourcing or add an explicit unconfirmed-disclosure
    clause, per surface" was resolved as disclosure here (these tools have
    genuine standalone value — "what patterns are forming on X" is a
    different, legitimate question from "should I buy X" — so outright
    removal, unlike grade_ticker's fix, was not the right call). Both
    functions now bake `"unconfirmed rule-engine detection, not Opus-
    vision-verified — historically only ~16% of these hold up"` directly
    into their own returned `narration` string (BEFORE any specific
    entry/stop/target numbers) plus a new structural `confirmed: false`
    field, plus their registered `voice_tool` `description` text (defense
    in depth — the calling model sees the caveat even before invoking the
    tool). This travels with the data to every current AND future caller
    (Compass voice, Compass chat, AI Search's agent lane all read the same
    two functions) — never dependent on a prompt instruction a future
    prompt edit could silently drop.
  - **Folded in one minor aggravating bug found in the same file, same
    cycle:** `grade_ticker.py`'s quote-fetch failure used to silently
    compute `extended=False` (via `last=0`) — indistinguishable from a
    genuinely confirmed "not extended," which is exactly the answer that
    clears the way for a GO. Now tracks `quote_available` explicitly,
    surfaces a new `quote_unavailable` hard flag, and downgrades to HOLD
    (never silently fabricates the other answer either) — verified it does
    NOT soften an existing harder SKIP flag (e.g. `regime_red`) back to
    HOLD.
  - **Tests:** 13 new/updated tests across `test_grade_ticker.py` (the new
    `quote_unavailable` HOLD behavior + its non-override-of-SKIP control)
    and `test_grade_ticker_integration.py` (a NEW test exercises the REAL,
    unmonkeypatched `_default_patterns_fn` directly, plus a full end-to-end
    `grade_ticker()` call with only regime+quote injected — proving the
    actual production wiring, not a test double, is safe) + a new 7-test
    `test_voice_pattern_bridge_disclosure.py` (disclosure present with and
    without results, for both tools; levels still surfaced alongside the
    disclosure — the fix doesn't swallow real data; tool-description text
    itself carries the disclosure). All pre-existing tests in every touched
    file remain green. Full adjacent regression run and confirmed green,
    zero failures: `test_grade_watchlist.py`, the AI Search agent lane +
    topic matrix + wave2-packs suites (550 tests, including
    `test_ctx_verdict_narrates_computed_answer`/`_surfaces_hard_flags`),
    `test_compass_pattern_bridge.py` (real-DB-backed, substring assertions
    only — confirmed NOT silently broken by the narration change),
    `test_voice_tools.py`/`test_voice_dispatch.py`, Compass's
    `coach_chat_audit_corpus`/`rung45_chat_tools`/`rung45_protocol_prompt`,
    and `compass_eval/test_checks.py` (the report-card mechanical checks) —
    700+ tests total. Clean `api.main` app-boot.
  - **Explicitly did NOT touch:** Pattern Vision's own model/scoring
    internals, the parked Technical Research/Technical Ask AI branches,
    8G-B/Scanner, `ai_search.py`/`ai_search_agent.py`/`coach_chat_tools.py`/
    `voice_agents.py` themselves (all inherit the fix with zero changes),
    or Compass's own `COMPASS_MENTOR_MODE`/report-card gating.

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
- **Technical Ask AI — Grounding + Convergence V1, Phase A ONLY (2026-09-06,
  worktree `technical-ask-ai`, branch `feat/technical-ask-ai`, base
  `2940f557b` — ZERO product-code changes made; a 3-agent Workflow audit +
  synthesis only).** BLOCKED_ON_PATTERN_VISION_ACCEPTANCE. Full spec below —
  resume implementation FROM THIS, do not re-run Phase A.
  - **What's cleared, definitively:** the parked `feat/terminal-technical-
    convergence` branch (Technical Research, `6555d6df5`) is NOT a dependency
    — `git diff` against its own merge-base (== current master) is EMPTY for
    the entire `api/` tree; it adds zero backend code, only a UI tab
    re-consuming the already-shipped, unmodified `GET /api/patterns/{sym}`.
    The real integration surface for Technical Ask AI —
    `api/services/ticker_explain.py`'s 8-composer grounding architecture —
    is completely untouched by that branch and shares no schema with it.
    **Both #1 (Technical Research release) and #6 (Technical Ask AI) are
    gated on the SAME event (Pattern Vision acceptance) but are otherwise
    fully independent — releasing one never requires the other.**
  - **What's blocking:** the only trustworthy technical evidence source for
    an AI grounding domain is `pattern_vision.store.get_confirmed()`
    (confirmed pattern verdicts) — structurally sound (a hard SQL predicate
    on a `confirmed` column, no leak path from the raw feed found), but
    Pattern Vision itself is mid a live, time-boxed re-enablement (retired
    2026-08-30 at 15.7% precision, re-armed, classification due after the
    Tue 9/8 / Wed 9/9 evidence window: LIVE+ACCEPTED / LIVE WITH CONDITIONS /
    ROLLED BACK). The raw/unconfirmed feed (`confirmed_only=false`,
    ~16%-precision) is explicitly NOT TRUSTWORTHY and excluded from any V1.
  - **The fully-specified V1 (buildable NOW, activate only after 9/9
    resolves favorably):** a 9th evidence domain, "technical," in
    `ticker_explain.py`, sourced ONLY from confirmed pattern verdicts
    (`setup`, `asof_date`, `vision_confidence`, `raw_confidence`, `key_level`,
    `rationale`, `checks`) — mirrors the `earnings_ai_adapter.py` precedent
    exactly:
    - New `api/services/research/technical_pattern_adapter.py` exposing
      `get_technical_pattern_ai_evidence(sym, tf="D")` — the ONE
      owner-approved composer allowed to call `pattern_vision.store`; adds a
      staleness disclosure computed from `asof_date` (the store itself
      applies ZERO staleness filter — no age cutoff, no LIMIT — so a
      months-old confirmed row returns exactly like a fresh one unless this
      adapter filters/discloses it).
    - New fetcher `_fetch_technical(sym)` + assembler `_technical_evidence()`
      (mirrors `_fetch_earnings`/earnings assembler) registered in
      `_DOMAIN_FETCHERS`.
    - New `_DOMAIN_RE["technical"]` regex entry + one append to
      `_DOMAIN_ORDER` (both already domain-name-generic elsewhere in the
      file — no other code changes needed for history/truncation/carry-
      forward).
    - New guard `_technical_grounding_flags()`: a raw_confidence-vs-vision_
      confidence misread guard (they are different numbers on the same row
      and nothing stops the model conflating them), a staleness-overclaim
      guard (block "forming right now" language when `asof_date` isn't
      recent), reuse of the existing evidence-id/numeric gate for
      `key_level` citations.
    - New system-prompt block mirroring the rating/earnings blocks:
      "no confirmed pattern" must render as "no UCT-confirmed occurrence
      available," NEVER as proof the pattern doesn't exist (rejected
      verdicts are a real, stored, distinct state — `confirmed=0` with a
      real rationale — but NO non-admin read path exposes them today, so
      that ambiguity is a genuine, un-closeable-by-V1 gap, not an oversight).
    - Ship behind a new default-off, ledger-declared flag (e.g.
      `TECHNICAL_ASK_AI_PATTERN_DOMAIN_ENABLED`); flip on only after 9/9
      resolves to LIVE+ACCEPTED or LIVE WITH CONDITIONS.
    - **Explicitly OUT of this V1:** non-pattern technical indicators
      (SMA/RSI/RS-rank/Stage — real, already live and already grounding AI
      *Search* via `ai_search.py::_ctx_posture`, but structurally absent
      from `ticker_explain.py`'s domain architecture; would need its own new
      fetcher/assembler plus a freshness fix — a real 10th-domain follow-on,
      not part of the smallest safe slice); the raw/unconfirmed feed; full
      entry/stop/target anchor sets (only exist on the raw table); rejected-
      verdict surfacing; any UI change; the parked Technical Research branch.
  - **New production-adjacent findings this Phase A surfaced (see Seams
    23-25 below)** — none caused by this program (zero code changed), but
    real, current-state facts worth preserving: AI Search's `_ctx_patterns`
    unconditionally narrates the raw ~16%-precision feed into live answers
    today (Seam 23); rejected Vision verdicts have no non-admin read path
    (Seam 24); `_ctx_posture`'s technical snapshot exposes no freshness
    marker despite the underlying columns existing (Seam 25).
  - Per-domain investigation detail (regex patterns, exact line numbers,
    the full trust matrix, the eighth-domain-precedent code shape) lives in
    this session's Workflow transcript, task `w0eic26xo`, if deeper recall
    is ever needed before a fresh audit would otherwise be re-run.

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

- **Seam 28 (closes Seam 26) — DONE, ACCEPTED + LIVE. Seam 29 — Outage-
  Integrity Threading — STARTING NOW**, continuing directly down the
  re-anchor's own priority stack per the standing directive (no new
  ledger-scan needed — the re-anchor already did that scan; see below).
  See the new Seam 28/Seam 29 debt-ledger entries above for full scope.
  Sequence completed under the CONTINUOUS EXECUTION DIRECTIVE (2026-09-06)
  before this point, in order: Technical Ask AI Phase A →
  BLOCKED_ON_PATTERN_VISION_ACCEPTANCE (zero code) → AI Search Raw-Pattern
  Trust Adjudication V1 (Seam 23, merge `897e53cc5`) → Shared Multi-Security
  Grounding Architecture V1 (merge `271f79664`/`4c8b24c74`) → Journal ↔
  Research Return-Context + Notes Draft-Loss Fix (Seam 12, merge
  `d6a99c708`/`119908685`) → Awareness Scan-Abort Hardening V1 (Seam 10,
  merge `b48200739`/`7e2dec405`, + a ~36GB disk-hygiene pass) → Ticker
  Search Identity Convergence V1 (Seam 16, merge `8ebb6f076`/`910eca619`)
  → AlertBell Keyboard Accessibility (Seam 5, merge `1eff7c83b`/`296517d80`)
  → a **fresh, owner-authorized 13-lens Whole-Product Strategic Re-Anchor**
  (multi-agent workflow, full report delivered in-conversation 2026-09-06;
  see the top-of-file section for the load-bearing conclusions) →
  **Verdict & Pattern-Bridge Trust Adjudication (Seam 28, closes Seam 26)**
  — ACCEPTED + LIVE, merge `efe64acfb`/`c3128e010` (see "CURRENT ACCEPTED"
  above) → now Seam 29.
  **Bounded Phase A required before Seam 29's fix**: re-verify
  `ticker_explain.py` (~line 941) and `research/comparison.py` (~line 73)
  actually call `get_analyst_ratings(sym)` with no `outage_out` threaded
  through, and confirm `watchlist_intelligence.py`'s own call site as the
  precedent for how the signal should be threaded, before writing code —
  the re-anchor's line numbers are approximate, re-read the real code.
  **Next in the priority stack after Seam 29** (all independent of Pattern
  Vision's gate): Awareness Reachability Restoration V1 (⚠️ has an
  owner-required monetization/entitlement question attached — see the
  re-anchor section above, do not resolve it unilaterally) → Alert
  Durability V1 → Watchlists/PositionsTable Keyboard Accessibility V1 →
  Compare Coverage V1 → Calendar TickerActions Reuse V2 → Feature-Flag
  Governance Sweep (incl. an owner confirm-or-rollback on live
  `BROKER_BALANCE_HISTORY_ENABLED=1`).
  **Technical Ask AI and Technical Research remain UNCHANGED** — still both
  BLOCKED_ON_PATTERN_VISION_ACCEPTANCE / PARKED, waiting on the identical
  Tue 9/8 / Wed 9/9 evidence window; if that classification lands mid-Seam-
  29 or later, treat it as the priority interrupt the standing directive
  describes — stop at a safe checkpoint, record it, do not fabricate or
  accelerate it. Do not treat "no program is currently active" as a stop
  condition.
  The prior "nor from X's own deferred items" enumeration that used to live
  here is superseded by the re-anchor's own seam-ledger reclassification
  table (§15 of the delivered report, mirrored into the debt ledger below)
  — that table is now the single authority on what remains open vs. closed
  vs. deliberately out of scope; do not re-derive it from scratch again
  soon.

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
- **Seam 5 — RESOLVED by AlertBell Keyboard Accessibility, merge
  `1eff7c83b`/`296517d80`, 2026-09-06.** The fix described here
  (`role="button"` + `tabIndex={0}` + an `onKeyDown` handling Enter/Space,
  mirroring `handleItemClick`) is exactly what shipped — see "CURRENT
  ACCEPTED" above. Kept as a record; do not re-open unless a concrete
  regression is found.

- **Seam 1 — symbol normalization mismatch (CROSS-SYSTEM IDENTITY DEBT) —
  WRITE-TIME HALF CLOSED by Identity Normalization Hardening V1, merge
  `9c1bff81f`, 2026-09-06; READ-SIDE HALF still OPEN, deliberately.** Manual
  J2 entry (`positions.py`/`trades.py`/`csv_import.py`) now routes through
  the same shared `symbol_normalize.py::normalize_symbol()` SnapTrade sync
  already used — a manually-logged and a broker-synced write of the same
  real security can no longer land under two different strings going
  forward. `options.py` was NOT touched (out of this V1's traced scope —
  re-audit before assuming it's covered). What remains genuinely open: Entity
  Master's alias table is still seeded ONLY in hyphen form
  (`scripts/entity_master_seed.py`), so `resolve("BRK.B")` still returns
  `not_found` — this still silently degrades Watchlist/Portfolio
  Intelligence and Research estimates/financials for the dot spelling, and
  still affects any EXISTING historical row already stored under the dot
  spelling (this V1 changed no historical data — a pure write-time
  hardening fix, not a migration). Price lookup itself remains robust
  (`to_polygon_symbol()` accepts both). Fix shape for the remainder: a second
  seeded S3 alias for the dot spelling, NOT a data migration.
  **Confirmed still fully open as of Ticker Search Identity Convergence V1
  (Seam 16, 2026-09-06) — that program did NOT narrow this.** Seam 16's fix
  re-keys the dot spelling to hyphen BEFORE `ticker_search_index.py` ever
  calls `_em_api.resolve()`, so the search index's own internal resolve
  call no longer needs a dot-form alias to succeed -- but `resolve("BRK.B")`
  itself is untouched and still returns `not_found` for any OTHER caller
  that hands it a literal dot spelling. Zero Entity Master schema/alias
  changes were made by Seam 16; this remaining scope is unchanged.
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
- **Seam 10 — RESOLVED by Awareness Scan-Abort Hardening V1, merge
  `b48200739`/`7e2dec405`, 2026-09-06.** The fix described here (isolate the
  regime component's own try/except so its failure degrades ONLY R4, never
  aborts stop-watch/earnings-proximity too) is exactly what shipped — see
  "CURRENT ACCEPTED" above. Kept as a record; do not re-open unless a
  concrete regression is found.
- **Seam 11 — broker-synced closed trades carry an inert `position_id`
  sentinel, so "Position → Related (closing) Trades" cannot be built safely
  (surfaced by Journal / Trade Lifecycle Convergence V1's Phase A,
  2026-09-06, classified ABSENT_NO_SAFE_INFERENCE, NOT fixed — deliberately
  out of scope for that program's narrow V1).** `j2_trades.position_id` is a
  genuine FK to `j2_positions.id` for the MANUAL close path
  (`trades.py::close_position`) but a structurally random
  `f"manual-{uuid.uuid4()}"` sentinel for every broker-synced trade
  (`trades.py::bulk_insert_trades`, called from `broker/reconstruct.py`) —
  confirmed by direct code read, matching the exact literal the router's own
  comment (`journal_two.py:961`) documents. Compounding: the corresponding
  OPEN `j2_positions` row is typically DELETED once the broker no longer
  holds it (`balances.py::reconcile_positions`), not closed_at-stamped, so
  by the time the trade exists there is often no position row left to link
  to at all. Since broker sync is the dominant, live production path, this
  makes a real "click into a position, see what it closed into" feature
  impossible without either (a) a schema/behavior change at broker-sync
  time — stop deleting `j2_positions` rows on close, stamp a real
  `position_id` in `bulk_insert_trades` instead of a UUID sentinel — or (b)
  an explicit product decision that broker positions simply never show a
  "resulting trade." Both are real architecture/product decisions, not a
  bounded V1 — needs its own dedicated audit + authorization before any fix.
  **Scope CONFIRMED WIDER by the 2026-09-06 Whole-Product Strategic
  Re-Anchor: `bulk_insert_trades(..., source="csv")` is not gated by
  source, so CSV-imported trades carry the identical inert sentinel — this
  is not broker-sync-specific.** Reclassified ARCHITECTURE DECISION (was
  ABSENT_NO_SAFE_INFERENCE); still not a bounded V1.
- **Seam 12 — RESOLVED by Journal ↔ Research Return-Context + Notes
  Draft-Loss Fix, merge `d6a99c708`/`119908685`, 2026-09-06.** The fix
  described here (a `from=trade:{id}`/`from=position:{sym}` query marker on
  the existing `goToResearch`/`goToAskAi`/`goToCompare` calls + a "Back to
  Trade/Position" link on `ResearchPage.jsx` + flushing the Notes draft on
  unmount, not just blur) is exactly what shipped — see "CURRENT ACCEPTED"
  above. Kept as a record; do not re-open unless a concrete regression is
  found.
- **Seam 13 — Position → Notes continuity, PARTIALLY resolved by a SEPARATE,
  uncoordinated ledger — narrower remaining scope than originally recorded
  (corrected by the 2026-09-06 Whole-Product Strategic Re-Anchor).** The
  original "fully ABSENT" framing (surfaced by Journal / Trade Lifecycle
  Convergence V1's Phase A, 2026-09-06) is STALE: `PositionDetailPage.jsx`
  already renders `LinkedNotesPanel tradeRefType="position"`, shipped by the
  `docs/notebook/*` program ledger's Wave 3 "Thesis-Trade Link" (commit
  `37d608967`), confirmed live. **Process note: two independent program
  ledgers now cover overlapping product surface without cross-referencing
  each other — worth a process fix (cross-link the two ledgers), not just
  this doc fix.** What genuinely remains open, narrower than before:
  passive ticker-based note surfacing is still absent — `j2_notes.ticker`
  is an already-indexed (`idx_j2_notes_user_ticker`), already-populated,
  nullable column with no consumer on `PositionDetailPage.jsx` (the shipped
  panel links via explicit trade/position references, not the ticker
  column). Fix shape: reuse the same read-only chip pattern, keyed on
  `j2_notes.ticker`, no new schema. Reclassified FOLLOW-UP ENHANCEMENT.
- **Seam 14 — duplicated ticker-search implementations across the app
  (surfaced by Search / Command Convergence V1's Phase A, 2026-09-06,
  scored HIGH, deliberately NOT consolidated this round).** At least 7
  independent `/api/ticker-search`-adjacent implementations exist beyond
  the canonical `SymbolSearch.jsx`: `TickerPopup.jsx`'s `SwitchTickerBox`
  (own fetch+debounce+dropdown), `MobileSymbolSheet.jsx` (full from-scratch
  reimplementation for the phone chart symbol picker — imports only
  SymbolSearch's `POPULAR_RESULTS` constant, so a SymbolSearch fix silently
  does NOT reach mobile chart symbol selection), `TickerCombobox.jsx` +
  `useTickerSuggest.js` (Watchlists add-symbol — an always-open multi-add
  ARIA combobox with explicitly documented rationale for NOT using
  SymbolSearch, a defensible duplicate not an oversight),
  `tickerMention.js` ($TICKER community-post autocomplete — architecturally
  FORCED duplication, a TipTap/ProseMirror Suggestion plugin cannot mount a
  React component), `ChartExampleKit.jsx`'s `TickerSearchInput` (admin-only
  Model Book form field, low traffic/risk), and `ComparisonPicker.jsx` (the
  ChartToolbar "⇄" popover — LEGACY_DEAD: a third, independently hardcoded
  "popular tickers" list with ZERO live search, a retirement candidate not
  a convergence one). Only `TickerPopup.jsx`'s `SwitchTickerBox` and
  `MobileSymbolSheet.jsx` are genuine convergence candidates (same use case
  as SymbolSearch, no lost feature-specific semantics); consolidating
  `MobileSymbolSheet.jsx` specifically requires building a touch/Sheet mode
  for SymbolSearch first (real, MEDIUM/HIGH-cost work, not this V1's bar).
- **Seam 15 — SymbolSearch.jsx self-exclusion — CLOSED by Identity
  Normalization Hardening V1, merge `9c1bff81f`, 2026-09-06, via a smaller
  mechanism than originally proposed here.** The originally-proposed fix
  shape (a new `excludeSym` prop on the shared component) was NOT needed:
  `SymbolSearch.jsx` already had a `clean !== sym` self-exclusion guard, but
  all 8 "+ Compare" call sites passed `sym={null}`/`sym=""`, making the guard
  structurally unreachable. Fixed by passing the real current symbol at all
  8 sites instead. See "CURRENT ACCEPTED" above for the full account
  including the incidental "null — click to search" tooltip fix and the
  pre-existing test-mock assumptions this broke and fixed in
  `ResearchHeader.test.jsx`/`TickerPopup.test.jsx`.
- **Seam 16 — RESOLVED by Ticker Search Identity Convergence V1, merge
  `8ebb6f076`/`910eca619`, 2026-09-06.** The fix described here (port
  `entity_master_seed.py`'s already-validated dot-to-hyphen re-keying into
  `ticker_search_index.py::_collect_rows()`) is exactly what shipped, plus a
  narrowly-scoped query-side alias match so a literal dot-form query still
  finds the now-single canonical row. See "CURRENT ACCEPTED" above. Kept as
  a record; do not re-open unless a concrete regression is found.
- **Seam 17 — AddPositionModal.jsx/AddTradeModal.jsx symbol fields are bare,
  unvalidated text inputs — PARTIALLY addressed by Identity Normalization
  Hardening V1, merge `9c1bff81f`, 2026-09-06; the ORIGINAL framing below is
  STILL OPEN and was never attempted.** What closed: the concrete
  data-integrity failure mode (a manually-entered spelling silently diverging
  from a broker-synced spelling for the same real security) — see "CURRENT
  ACCEPTED" above. What did NOT close and remains a real gap: the frontend
  fields themselves are still bare text inputs with no autocomplete and no
  existence check against the ticker universe (a mistyped, entirely
  non-existent symbol is still silently accepted — this was a DELIBERATE
  non-fix per the authorization, which explicitly forbade a hard
  existence-check on these fields; AddTrade specifically must keep accepting
  delisted/renamed historical tickers). Fix shape for the remainder: wire
  SymbolSearch (or a validated variant, non-blocking on unknown tickers) into
  these two fields as a genuinely separate UI initiative — do not conflate
  with the spelling-safety fix that already shipped.
- **Also confirmed genuinely pre-existing (not introduced by this program,
  not fixed, out of scope):** `CommandPalette.jsx`'s own `fetch('/api/
  ticker-search?...').then(r => r.json())` never checks `r.ok` before
  parsing — a real bug (a non-2xx JSON error body would be treated as a
  valid results payload) confirmed present on the base master SHA via
  direct `git show`, i.e. it predates this program entirely and was never
  touched by it. `jsonFetcher.test.js`'s own rail newly flagged it during
  this program's regression run — recorded here so it isn't lost, not
  claimed as this program's fix.
- **Seam 18 — News surfaces are code-correct but unreachable (surfaced by
  Event / News / Calendar → Research Convergence V1's Phase A, 2026-09-06,
  NOT fixed — a product decision, not a bounded V1).** `NewsFeed.jsx` already
  wraps its security-scoped ticker pills in `TickerPopup` (a genuine, correct
  door to `/research/{sym}` and `?section=ai`), but its only importer,
  `TapeFeed.jsx`, is itself confirmed unmounted (`reachable.test.js:330-350`).
  `CatalystFlow.jsx` is the same shape — correct code, retired/unreachable
  (`reachable.test.js:301-303`). Fixing either is moot until a product
  decision names the canonical live news tile (NewsFeed vs. TapeFeed vs. its
  live duplicate `MoversSidebar.jsx`); wiring dead code serves no member.
- **Seam 19 — TickerActions long-press/right-click reuse is bounded to one
  earnings surface (surfaced by Event / News / Calendar → Research
  Convergence V1's Phase A, 2026-09-06, NOT fixed — real gap, larger blast
  radius than a bounded V1).** Only `EarningsCard.jsx` (reachable via
  `DayDetailDrawer`/MyStocksHub Earnings tab) wires `useTickerActions`/
  `TickerActionsMenu`, giving it BOTH `/research/{sym}` and
  `?section=ai` plus touch-parity (`longPressProps` mirroring
  `onContextMenu`). The dominant, first-landed calendar surfaces — Board
  (`EarningsTile.jsx`), Table/Feed (`CalendarDayTable.jsx`,
  `FeedView.jsx`), and Wire (`WireView.jsx`) — have none of this, so
  `?section=ai` is unreachable from any of them without first opening the
  modal → drawer path. Expanding reuse into 3+ additional live files with
  existing click handlers to preserve is real work, deliberately left for a
  dedicated V2, not bundled into this narrow V1.
- **Seam 20 — Wire view rows and MyStocksHub's Insights tab are confirmed
  dead ends (surfaced by Event / News / Calendar → Research Convergence V1's
  Phase A, 2026-09-06, NOT fixed — deferred as a fast-follow, deliberately
  not bundled into V1 to keep the diff to one file).** `WireView.jsx:119`
  (`<span data-testid="wire-sym">{r.sym}</span>`) is a live, ticker-scoped,
  first-listed top-level calendar view with zero click behavior on any row —
  not even a chart popup. `MyStocksHub.jsx`'s Insights tab
  (`InsightForSym`/`SentimentGaugeDisplay`, lines 314-326) is the same shape.
  Both carry the identical structurally-simple fix EventCard.jsx just got
  (one `navigate('/research/${sym}')` call, native-button/keyboard-safe);
  lower priority than EventCard because Wire is not the default view (Board
  is) and Insights is buried in a sub-route tab.
- **Seam 21 — MyStocksHub's News/Filings/Calls tabs preserve only the
  external source, no in-app Research path (surfaced by Event / News /
  Calendar → Research Convergence V1's Phase A, 2026-09-06, NOT fixed —
  PARTIAL by design per the authorization's "preserve primary-source access"
  principle, not a confirmed defect).** News/Filings render a real external
  `<a href target=_blank>` (article / EDGAR filing) with no Research
  companion action; Calls renders `CallRecapSection`/`TranscriptPanel` inline
  with no `navigate()`/`/research/` reference anywhere in either component.
  Unlike EventCard's dead ends, these DO preserve primary evidence — the gap
  is the absent SECOND door (Research), not a broken first one. Worth a
  bounded follow-up (`goToResearch` sibling action beside each existing
  external link) but not selected this round given the smaller V1 already
  found higher-leverage.
- **Seam 22 — Event context preservation remains fully absent (surfaced by
  Event / News / Calendar → Research Convergence V1's Phase A, 2026-09-06,
  confirmed NOT NEEDED for V1, real gap for a future "Back to Calendar"
  feature).** `ResearchPage.jsx` reads exactly one query param (`section`),
  seeded once at mount and never touched again; grep for
  `from=`/`returnTo`/`backTo`/`returnContext` across
  `ResearchPage.jsx`/`ResearchHeader.jsx`/`ResearchComparePage.jsx` returns
  zero hits. The closest existing precedent — `AlertBell.jsx`'s
  `research_url` field (Alert Return-to-Research Consistency V1) — also
  constructs only a bare `/research/{SYM}` with no context param, so even
  the nearest prior art drops context. Closing this needs new plumbing on
  both the event-producer and Research sides with no proven pattern to
  reuse; explicitly out of scope for any bounded V1 until a specific member
  workflow demands it.

- **Seam 23 — RESOLVED by AI Search Raw-Pattern Trust Adjudication V1, merge
  `897e53cc5`, 2026-09-06.** Was: AI Search narrated the RAW, unconfirmed
  (~16%-precision) pattern feed into live answers unconditionally
  (`api/routers/ai_search.py::_ctx_patterns()`, called for the first two
  resolved symbols in EVERY answer, wrapped in a system-prompt block
  explicitly labeled "authoritative" desk data, with fabricated-reading
  confidence % and concrete entry/stop/target levels, zero confirmation/
  freshness disclosure). Fix: `_ctx_patterns()` and its unconditional call
  site DELETED entirely (not gated, not disclosed-and-kept — the owner
  adjudication's own preferred order ranked "remove until the confirmed
  source is accepted" above "label as unconfirmed," since there was no
  standing product authorization for exposing raw detector candidates as
  member-facing narrated fact). A member explicitly asking about a setup/
  pattern (new `_SETUP_RE` intent gate) now gets an honest declared
  `"confirmed technical setup"` gap via the pre-existing DESK GAPS mechanism
  — never fabricated data, never silent omission either. Deliberately did
  NOT repoint AI Search at Pattern Vision confirmed verdicts instead —
  Pattern Vision is itself still under its own live acceptance trial
  (classification due after the Tue 9/8 / Wed 9/9 window), and doing so
  would have promoted an unaccepted system into member-facing authority
  through a side door. `voice_tool_impls.py::_find_patterns_on_ticker`
  (the underlying raw-feed reader Compass Chat/Voice also call) was
  deliberately NOT touched — that is a separate, unaudited surface; see
  Seam 26 below.
- **Seam 26 — RESOLVED as a consequence of Seam 28, merge
  `efe64acfb`/`c3128e010`, 2026-09-06.** `find_patterns_on_ticker`/
  `scan_active_patterns` now disclose their unconfirmed status structurally
  (see the Seam 28 entry below for the full fix). Kept as a record; do not
  re-open unless a concrete regression is found.
- **Seam 28 — RESOLVED by Verdict & Pattern-Bridge Trust Adjudication, merge
  `efe64acfb`/`c3128e010`, 2026-09-06.** Fixed at the shared root rather
  than per-surface, so all named + bonus consumers inherit it automatically
  (matches this session's own "fix once at the shared boundary" convention
  — see Seam 16/Seam 10 above for the same pattern): `grade_ticker.py::
  _default_patterns_fn` now returns no detections until Pattern Vision
  reaches LIVE + ACCEPTED, so every real call routes through the
  pre-existing, honest "no clean, tradable setup" SKIP branch instead of a
  fabricated-confidence GO/HOLD. Deliberately does NOT re-point at Pattern
  Vision's own confirmed verdicts either — that trial is itself still in
  flight, and doing so would be the same "quietly promote an unaccepted
  system" move Seam 23's own adjudication forbade. Covers AI Search's fast
  lane (`_ctx_verdict`/`_ctx_list_verdict`), AI Search's agent lane, Compass
  voice+chat's `grade_ticker` tool, AND `grade_watchlist.py` (bonus, not
  originally named) — all five share this one function, zero per-consumer
  changes needed. Separately, `find_patterns_on_ticker`/
  `scan_active_patterns` (Seam 26, the standalone raw-detection-listing
  tools, not routed through grade_ticker) now bake an "unconfirmed
  rule-engine detection... historically only ~16% hold up" disclosure
  directly into their own returned narration + a new `confirmed: false`
  field + their registered tool descriptions — travels with the data to
  every caller, not dependent on a prompt instruction. Also folded in the
  minor aggravating bug: a failed quote now surfaces `quote_unavailable` →
  HOLD instead of silently computing a fabricated "not extended". 25 new/
  updated tests across `test_grade_ticker.py`, `test_grade_ticker_
  integration.py` (a NEW test exercises the REAL, unmonkeypatched default —
  not just an injected fake), and a new `test_voice_pattern_bridge_
  disclosure.py`; full adjacent regression green (grade_watchlist, AI
  Search agent lane + topic matrix + wave2 packs, Compass pattern bridge,
  voice tools/dispatch, coach chat audit corpus, compass_eval checks — 700+
  tests total, zero failures). Directly unblocks completion criteria B and
  C from the re-anchor. **Seam 26 also closes as a consequence** (same root
  cause, same fix).
- **Seam 29 — outage-integrity signal not threaded into Ask AI / Compare
  (surfaced by the 2026-09-06 Whole-Product Strategic Re-Anchor, NOT YET
  FIXED).** `outage_out` (the analyst source-integrity signal added by
  Attention Source-Integrity Hardening V1) reaches
  `watchlist_intelligence.py` but NOT `ticker_explain.py` (~line 941) or
  `research/comparison.py` (~line 73) — both call `get_analyst_ratings(sym)`
  with no outage signal threaded through, so a real provider outage during
  either flagship grounded AI answer is silently indistinguishable from "no
  coverage." Independently re-verified via direct grep by the synthesis
  agent itself, not just the architecture lens. Smallest, most mechanical of
  the newly-found MUST-FIX items — a real Evolving Interconnection Principle
  failure (an upstream contract improved, two programs ago in this same
  ledger, and its two flagship downstream consumers were never updated).
  **MUST FIX BEFORE PRODUCT COMPLETION.**
- **Seam 24 — Rejected Pattern Vision verdicts have no non-admin read path
  (surfaced by Technical Ask AI's Phase A, 2026-09-06, NOT fixed, explicitly
  out of V1 scope).** `pattern_verdicts` rows with `confirmed=0` are real,
  stored, and carry a genuine Opus rationale (`store.get_verdict`/
  `get_recent_verdicts`) -- rejection is a distinct, inspectable state from
  "never evaluated." But only the admin review surface
  (`GET /api/patterns/admin/review`) can read it; `/api/patterns/{sym}` and
  `/api/patterns/confirmed/{sym}` both hard-filter `confirmed=1`. This means
  any future Ask AI grounding on confirmed verdicts can only ever say "no
  confirmed occurrence available" -- genuinely ambiguous between "never
  looked" and "looked and said no" -- until a new, paid-safe read of
  `get_verdict`/`get_recent_verdicts` is added. Fix shape: a new read-only,
  paid-gated endpoint exposing rejection + rationale by symbol; real V2 work
  for Technical Ask AI, not V1.
- **Seam 25 — the nightly technical snapshot AI Search already grounds on
  carries no freshness disclosure to the model (surfaced by Technical Ask
  AI's Phase A, 2026-09-06, NOT fixed).** `screener_rows` (via
  `snapshot_db.get_row`) has real freshness columns (`snapshot_date`,
  `bars_asof`, `built_at`), but `ai_search.py::_ctx_posture()` -- the
  function that actually surfaces SMA%/RSI/RS-rank/Stage/etc. into an AI
  Search answer -- renders none of them, labeling the whole block only "UCT
  nightly snapshot." If the nightly build job ever fails silently, the model
  (and the member) has no way to know the data is stale. Fix shape: thread
  `built_at`/`bars_asof` into `_ctx_posture`'s rendered string, mirroring how
  Pattern Vision's `asof_date`/`judged_at` are at least present (even though
  currently unfiltered -- see the Technical Ask AI Phase A spec under
  "CURRENT PARKED" above) on confirmed verdicts.

- **Seam 27 — `get_breadth_history`'s `anchor` param is a live FastAPI
  `Query` sentinel when called directly as a Python function (newly
  observed during Shared Multi-Security Grounding Architecture V1's
  production verification, 2026-09-06, NOT fixed, unrelated to that
  program).** Production startup log shows `[dashboard-warm] breadth
  failed` every boot: `api/main.py`'s `_breadth()` warm-cache task calls
  `get_breadth_history(days=90)` directly (bypassing FastAPI's request
  pipeline/dependency injection), and `anchor`'s function-signature default
  is a `Query(...)` object, not a plain value — `_resolve_anchor_merged`
  then does `bisect_right(all_dates, end)` where `end` is literally that
  `Query` instance, raising `TypeError: '<' not supported between
  instances of 'Query' and 'str'`. Non-fatal (the warm task is wrapped in
  try/except in `main.py::_warm`; the real request-path endpoint, called
  through FastAPI, resolves `anchor` correctly and is unaffected) — but the
  breadth-history cache never gets pre-warmed on boot, so the first real
  request after every deploy pays the full cold-compute cost this warm
  pass exists to avoid. Confirmed pre-existing (predates this program;
  `git log` shows the last touch to `breadth_monitor.py`/`main.py` was
  `6a15ed587`, unrelated to anything in this session) — not this program's
  file, not fixed here. Fix shape: the warm-task call site should pass a
  concrete default (e.g. `None`) rather than relying on the FastAPI
  `Query` default resolving outside a request context.

## DEFERRED (not authorized, do not build without new explicit authorization)

- Technical grounded Ask AI (Phase C)
- Comparison multi-security AI — RESOLVED. Shared Multi-Security Grounding
  Architecture V1 (merge `271f79664`/`4c8b24c74`, see "CURRENT ACCEPTED"
  above) shipped exactly this: the new two-symbol evidence-isolation
  grounding contract (`comparison_ai_adapter.py`'s `sym`/`side`-tagged
  evidence + the new attribution check). N-ary (>2) comparison remains
  deferred below — that is a different, larger scope this V1 deliberately
  did not attempt.
- N-ary (>2) comparison AI (Shared Multi-Security Grounding Architecture V1
  Phase A — the 2-arg cap is deliberate architecture at every layer of
  `comparison.py`, not a V1 shortcut; generalizing means solving
  entity-dedup-by-group and multi-symbol evidence tagging before the
  2-ary envelope is even proven in production)
- Multi-turn history for Comparison AI (Shared Multi-Security Grounding
  Architecture V1 — no existing frontend plumbing carries a two-ticker
  conversation; would also require either a second history contract
  alongside `ticker_explain._clean_history`'s single-symbol one, or
  weakening that one's entity-isolation boundary — deliberately not
  attempted ahead of a real consumer)
- Watchlist multi-security AI summary (needs a new N-symbol grounding
  contract; also blocked on Seam 8 — `get_intelligence_for_symbols`'s
  freshness is fabricated for 3 of 4 fact kinds, so grounding an LLM on it
  today risks confidently-wrong claims — reconfirmed by Shared
  Multi-Security Grounding Architecture V1's Phase A)
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
   Hardening V1 (merge `dc2cdc906`), Awareness Source-Integrity Audit +
   Hardening V1 (merge `f2d96ce11`), Journal / Trade Lifecycle
   Convergence V1 (merge `701ca7319`), Search / Command Convergence V1
   (merge `e36ca0eb5`), Event / News / Calendar → Research Convergence
   V1 (merge `d46f35a68`), Identity Normalization Hardening V1 (merge
   `9c1bff81f`), AI Search Raw-Pattern Trust Adjudication V1 (merge
   `897e53cc5`), Shared Multi-Security Grounding Architecture V1 (merge
   `271f79664`/`4c8b24c74`), Journal ↔ Research Return-Context + Notes
   Draft-Loss Fix / Seam 12 (merge `d6a99c708`/`119908685`), Awareness
   Scan-Abort Hardening V1 / Seam 10 (merge `b48200739`/`7e2dec405`), and
   Ticker Search Identity Convergence V1 / Seam 16 (merge
   `8ebb6f076`/`910eca619`) are all ACCEPTED + LIVE as of this checkpoint —
   do not re-implement any of them or treat them as pending; confirm via
   `git log` only if something here looks stale. **Ticker Search Identity
   Convergence V1 required an extra manual step beyond the deploy itself
   (a `ticker_search_index.build_index()` rebuild + `railway redeploy` to
   reload it) because the search index is a persisted disk snapshot** — see
   that CURRENT ACCEPTED entry's operational gotcha before assuming a
   future change to `ticker_search_index.py` is live the moment it deploys.
6. Do not re-run Phase A for Watchlist Intelligence, Portfolio Intelligence,
   Comparison V1, Entry-Point Convergence, Universal Ticker Actions
   Convergence, Attention Signal Propagation, Alert Return-to-Research
   Consistency, Temporal / Freshness Truth Convergence, S8 / Attention
   Freshness Propagation, Attention Source-Integrity Hardening, Awareness
   Source-Integrity Audit + Hardening, Journal / Trade Lifecycle
   Convergence, Search / Command Convergence, Event / News / Calendar →
   Research Convergence, Identity Normalization Hardening, Technical Ask AI,
   AI Search Raw-Pattern Trust Adjudication, Shared Multi-Security Grounding
   Architecture (Comparison leg), Journal ↔ Research Return-Context + Notes
   Draft-Loss Fix (Seam 12), Awareness Scan-Abort Hardening (Seam 10),
   Ticker Search Identity Convergence (Seam 16), or the Whole-Product
   Convergence Review from scratch — their findings above are current as of
   this checkpoint
   (Technical Ask AI's full Phase A spec is under "CURRENT PARKED" — resume
   from it once unblocked, do not re-audit); verify against live code only
   where something here looks stale.
7. **A CONTINUOUS EXECUTION DIRECTIVE (2026-09-06) is standing
   authorization** for routine, bounded, independently-safe Terminal
   programs to proceed one after another without a stop-and-wait — see
   "CURRENT ACTIVE PROGRAM" above for the live sequence and the directive's
   own 10 owner-required stop conditions (destructive migration, financial-
   record merging, auth semantics, irreversible data changes, multi-valid
   product-policy decisions, ambiguous security identity, provider-licensing
   choices, a protected-parallel-program conflict, no independent work left,
   or a trust/safety regression needing an owner tradeoff). Technical
   Research release (#1) and Technical Ask AI (#6, Phase A complete, fully
   specced) remain BLOCKED_ON_PATTERN_VISION_ACCEPTANCE regardless of this
   directive — that gate is external, not something continuous execution can
   route around; resume either only from its recorded spec once Pattern
   Vision resolves.
