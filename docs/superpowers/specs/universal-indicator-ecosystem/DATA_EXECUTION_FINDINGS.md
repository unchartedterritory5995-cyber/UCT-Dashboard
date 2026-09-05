# Data / Timeframe / Execution-Lane Findings (P4 / Track B)

Per the master prompt's P4 priority: map the data system and determine precisely WHY the AST scan path is
nightly-only, separating PRODUCT POLICY vs CURRENT DATA LIMITATION vs ARCHITECTURAL LIMITATION vs
scheduling-limitation. Produced by a dedicated research fork; its most load-bearing new claims were
independently spot-checked before being incorporated here (noted inline where that happened). **No
intraday infrastructure was built as part of this investigation** — this is a map, not a proposal.

## Three "live" scanning-adjacent systems — do not conflate them

1. **Retired "Live Scan" tab** (client-side, retired 2026-08-29) — gone, unrelated code, killed for UX
   reasons (see `project_live_scan_retirement` memory).
2. **Screener Live Tier** (`api/services/screener/live_tier.py`, flag `SCREENER_LIVE_TIER_ENABLED`) —
   **armed and live in production right now** (confirmed directly: `docs/feature_flags.json` lists it
   `"armed"`). Recomputes ~22 price-anchored columns (e.g., "% vs 50-day") intraday off the same shared
   30-second `full_market_snapshot()` feed, LEFT-JOIN-overlaid onto the classic nightly snapshot, with
   per-row provenance, zero additional provider calls. This is the OLDER, Finviz-style screener's intraday
   overlay — structurally simpler than the AST-scan engine (price-anchored only, no scalar/cadence-ceiling
   logic), but **direct, live proof that "recompute intraday off the shared 30s snapshot" already works and
   is trusted in this codebase**, for a real sibling system.
3. **AST-scan `mode='live'`** (`scan_hits_live`, flag `SCAN_LIVE_SWEEP_ENABLED`) — fully built, tested, and
   **dark** (flag not armed). This is the system the rest of this document is about.

## The policy-vs-limitation breakdown

| # | Layer | Bucket | Verdict |
|---|---|---|---|
| 1 | Nightly full-universe, all-definitions sweep's cost | **Execution-engine limitation** — real, measured, correctness-driven, not laziness | Sequential-by-necessity × many definitions × 3,742 symbols (counted directly from `api/data/cap_universe.json` today; the `~3,685` figure in `api/main.py:1141` is very likely a stale in-comment approximation of the same periodically-rebuilt file, not a narrower universe) genuinely needs the overnight window as definition count grows. Threading was tried and measured to help nothing (GIL-bound) and would break the 1e-9 cross-language parity guarantee between the JS/Python kernels. |
| 2 | "Should scanning go beyond nightly at all" | **Product policy — already decided, YES** | Owner ruling, 2026-08-25, standing ("cost raised once; decided"). Not a live open question — do not re-raise it as one. |
| 3 | Continuous ~5-min sweep of the still-forming daily bar (bars-only formulas) | **Scheduling/job-system — solved**, gated by one dormant flag | Fully built, unconditionally registered in the scheduler, tested. `SCAN_LIVE_SWEEP_ENABLED` is one env var away from live either direction, no deploy needed. The Screener Live Tier precedent (above) directly de-risks the underlying "recompute off the shared snapshot" pattern, though it does NOT de-risk the AST engine's additional complexity (the cadence-ceiling honesty guard, four-outcome coverage accounting) — none of which has ever run in a live cycle, since the flag has never been armed. |
| 4 | On-demand "Run Now" for a member's own bounded symbol list | **Scheduling/job-system — solved and SHIPPED**, backend and frontend both | Live since 2026-08-25/26. Real UI (`app/src/components/screener/RunNowButton.jsx` + `.module.css` + `.test.jsx`, existence confirmed directly): a member pastes symbols or picks a saved list, hits "Run now," gets a `202` + job id, the client polls, results swap into the same results panel with a "Showing on-demand results over N symbols" caption and a "Back to the nightly results" button. Bounded, paid-gated, rate-limited, self-healing. |
| 5 | True sub-daily timeframes (1m/5m/15m/30m/60m) in any scan mode, at universe breadth | **Data-pipeline limitation — real, and the dominant remaining blocker** | No forming-bar builder for intraday buckets exists in the live-mode data path; the prewarm ring meant to keep intraday bars *currently* fresh at scan-time across the full universe was never built ("repurposed" elsewhere). A full-universe *historical* 60m/5m pack does exist (`api/services/intradaypack.py`, read in full) but is deliberately closed-session-only by construction — its own docstring: "pre-seed PRIOR CLOSED intraday sessions... DROPS the current still-open session's partial bars." That module exists for instant chart scroll-back, not scan-time freshness — a different axis entirely, not a shortcut past this limitation. |
| 6 | Fundamentals/pattern/dark-pool/options-flow-referencing formulas ("scalars"), at any cadence | **Data-pipeline limitation, permanent by current design** | `screener_rows` rebuilds once nightly; `cadence_ceiling` refuses re-reading it more often as a matter of honesty, not schedule. Only rebuilding that data pipeline itself would change this — no amount of scan-engine work can. This is most of what differentiates this engine from a bars-only competitor. |

**Buckets 2-4 are already resolved toward "yes" and largely built.** What's outstanding there is an
operational flag-arm (bucket 3) plus, per the flag ledger, an apparently-unbuilt results surface for
`scan_hits_live` specifically — not unsolved engineering. **Buckets 1 and 5 are the genuine, hard
constraints.** Bucket 6 is structurally permanent under the current data architecture.

## A real, load-bearing nuance: on-demand mode has no code-level intraday refusal

The intraday-timeframe refusal (`if tf_code != DEFAULT_TF: raise ScanRunRefused("tf", ...)`) lives strictly
inside `evaluate_one`'s `if mode == LIVE:` branch (`api/services/screener/scan_evaluator.py:1370-1409`,
read directly and quoted in full during this investigation). **It is not present for `mode="on-demand"`.**
So the "Run Now" door has no code-level gate against a caller submitting `tf: "5"` — it isn't
architecturally forbidden the way live-mode intraday is, it's simply never been exercised, tested, or
exposed (the frontend's `RUN_TFS` dropdown reportedly only offers D/W/M, per the research fork — not
independently re-confirmed line-by-line). **Net: an intraday on-demand run's correctness is genuinely
unknown/unsupported, not blocked.** If a future UI change widens that dropdown without a matching backend
change, its behavior the first time someone actually exercises it is unverified — flagged as RISK-017.

## Data pipeline, as mapped

- **Bar fetch, 5 layers** (per `api/services/bars_fetch.py`'s own module header): in-memory TTLCache
  (<1ms) → SQLite bar store (<5ms, persistent) → a disk cache (<20ms, explicitly documented as a *legacy
  fallback during SQLite cold-start*, not a live steady-state tier) → Massive delta-fetch (<1s, new bars
  only) → Massive full fetch (4-8s, first-ever pull). This corrects `CLAUDE.md`'s summary table, which
  implies 3 layers and is directionally right but imprecise on layer count and timing — a small, low-risk
  documentation staleness instance, same class as RISK-007/RISK-015, not fixed here.
- **Provider fallback** (confirmed independently at `bars_fetch.py:7`, matching the fork's citation exactly):
  8 timeframes; intraday is Massive API primary → FMP fallback → yfinance fallback.
- **Universe**: `api/data/cap_universe.json`, 3,742 symbols today (direct count).
- **Alerts are a different cost shape entirely**: `indicator_alert_evaluator.py`'s closed-bar alert engine
  runs every 60s, `O(active alerts)` not `O(universe)` — this is precisely the scale difference that makes
  "scan" a fundamentally different cost problem than "alert," and why the alert engine's existing cadence
  can't be read as a precedent for scan-engine cadence.

## Test corroboration

433 existing tests were run read-only (no state mutation) against this exact checkout by the research fork,
0 failures: `test_scan_evaluator_off_request_path.py` (24 passed — the off-request-path census), 272 passed
combined across `test_scan_run.py` + `test_scan_live_sweep.py` + `test_entitlements.py` +
`test_scan_evaluator.py`, 137 passed combined across `test_ast_budget.py` + `test_scan_session_encoding.py`.
This converts several "the code and its docstring say X" claims into "the code says X and the test
enforcing it is green right now": the off-request-path boundary, the live-sweep tf/cadence gates, the
on-demand door's bounds, entitlement floors, node/lookback budgets, and the intraday session-encoding fix.

## Explicitly unresolved (not manufactured confidence)

- **RISK-003 (scan sweep completion) remains PRODUCTION-UNVERIFIED** even after this pass — an independent
  check arrived at the identical conclusion as the original Track D investigation, which corroborates the
  UNVERIFIED classification rather than resolving it either way.
- An on-demand run submitted with an intraday `tf` is untested end-to-end — not refused, not verified
  correct. Likely `stale-bars`/`no-bars` for most long-tail symbols and something real only for names
  already warm via ordinary chart-viewing traffic, but nobody has exercised or asserted this.
- The Screener Live Tier precedent de-risks the *mechanism* (recompute-off-shared-snapshot), not the AST
  engine's *additional* complexity (cadence-ceiling honesty guard, four-outcome coverage accounting) — worth
  stating precisely rather than letting one de-risk the other by association.

## Recommendations (mapping only — no build proposed here)

1. Close RISK-003 with an actual live production check (a real overnight watch or a read-only DB probe)
   before any conversation about arming `SCAN_LIVE_SWEEP_ENABLED` — arming a flag on top of an unverified
   assumption about whether the underlying job even completes would compound, not resolve, that risk.
2. If/when arming live-mode is considered, use `scan_hits_live`'s row count as the readiness artifact, not
   the scheduler log line (RISK-003's own investigation showed log-search is not reliably conclusive on this
   Railway CLI surface).
3. Do not estimate true-intraday-at-scale cost from the nightly bars-only sweep numbers — they don't
   transfer to a warm-then-serve intraday shape; that estimate has never been attempted and its absence is
   itself worth naming precisely rather than backfilling with an analogy.
4. Before any product conversation about "Run Now for intraday," state explicitly that the backend door
   doesn't refuse an intraday `tf` today (RISK-017) — this is a latent gap waiting for a future frontend
   change to expose it, not a currently-safe unused code path.

## Files inspected (primary + corroborating)

`api/services/screener/scan_evaluator.py` (`evaluate_one`, `mode==LIVE` branch, lines 1370-1409, read
directly) · `docs/feature_flags.json` (`SCREENER_LIVE_TIER_ENABLED`, `BARS_PREWARM_ENABLED`,
`INTRADAYPACK_ENABLED`, `SCAN_LIVE_SWEEP_ENABLED`) · `api/services/intradaypack.py` (read in full) ·
`api/data/cap_universe.json` (counted directly: 3,742) · `api/main.py:1141` (the stale `~3,685` comment) ·
`api/services/screener/live_tier.py` (role corroborated via its own design doc citation plus the flag
ledger) · `app/src/components/screener/{RunNowButton.jsx,.module.css,.test.jsx}` (existence confirmed
directly) · `api/services/bars_fetch.py` (module header, provider-fallback comment) ·
`api/services/indicator_alert_evaluator.py` (cadence, O(active alerts) shape).
