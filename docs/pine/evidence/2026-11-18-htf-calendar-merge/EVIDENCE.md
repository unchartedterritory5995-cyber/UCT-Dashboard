# U-HTF-CALENDAR: a short week or month before TradingView's calendar (2000) closes on the next bar, both lanes (2026-11-18, NUMBER PENDING)

Coordinator ruling (2026-11-18, request unit, part B2): state the period-close rule once, in the host alignment the
run's supply already shares, and in the Python twin. Because it moves the SUPPLY AUTHORITY of both lanes, the full
corpus diff may show only moves toward MATCH. Branch `feat/pine-htf-calendar-merge` from master `3d31b25661`
(engine 80), master `12c5e970b3` (engine 81) merged in once; its own PR.

## 1. The answer

- **TradingView's rule, read off its own columns** (roadmap entry U-HTF-CALENDAR; Q-HTF-CAL-1a / 1b,
  `vw-request-htf-alignment-{spy,qqq}-1d-2026-11-18`, committed under `tests/fixtures/vendor/harness/`): with
  look-ahead off, a completed week or month is shown on its LAST session, except a period a later weekday of which
  TradingView's session never closed. Such a period is shown one bar LATER, on the next period's first session.
  TradingView's session applies no closure before 2000 and does not hold 11-14 September 2001, so:
  - through 1999 every short period is shown on the NEXT bar (SPY 13 weeks and 2 months, QQQ 2 weeks and 1 month);
  - from 2000 every short period is shown on its LAST bar (46 weeks and 7 months on each, 11 June 2004 included);
  - the week of 10 September 2001 is shown on the NEXT bar, on both.
- **Ours, now: equal to TradingView's A02 (`close`, `"W"`, look-ahead off) and A05 (`"M"`) on every bar but the
  newest of both captures** (SPY 8,509 bars, QQQ 6,967), on both lanes (the JS rail and its Python twin below).
  Before, every short period read one bar EARLY.
- **The witness that asked for it, A1** (`support-and-resistance-multi-time-frame-spy-1d-2026-11-18`, run
  `adm-2026-11-18`, local, licence-held, never committed): **DIVERGE -> MATCH on both lanes.** At master `5c2aa89822` (engine 81) it grades DIVERGE, 3 of 7
  items, on the production and the runtime-on lane alike: Resistance Weekly 7 bars (first bar 557, vendor 50.89062 vs
  ours 51.09375), Support Weekly 2 (first bar 296, vendor `na` vs ours 43.53125), Resistance Monthly 1 (bar 1598,
  vendor 137.5 vs ours 138). On this branch it grades MATCH, 7 of 7, on both lanes: the daily items on all 8,509
  bars, the four weekly and monthly items on 8,508 (the newest bar is withheld by name, as before).
- **The full corpus, both lanes:** this PR's own pine heavy run against engine 81's (run 44452719465), per capture,
  stated in the PR description. The ruling admits only moves toward MATCH.
- **What a member sees change:** a weekly or monthly value with look-ahead off, on a daily chart whose history reaches
  a short period before 2000 or the week of 10 September 2001, moves one bar later on that period's last session.
  Nothing on any bar after 2001-09-17 moves, and never the newest bar.

## 2. What was built

- `app/src/components/chart/engine/ast/interpret.js::tfMergeReads` (the run's supply pick through
  `requestAlignment`, and the host lane's `tf_merge` arm): on a bar that closes its period, the read is the period
  before when `htfClosesOnNextBar(iso, code)` says so; the next bar then reads the period.
- `htfClosesOnNextBar(iso, code)`: true when a LATER weekday of that week or month is one TradingView's session never
  closed: before `TRADINGVIEW_CLOSURES_FROM` (2000-01-01) or listed in `TRADINGVIEW_UNAPPLIED_CLOSURES`. Both are read
  from `lib/marketClock/tradingViewSession.js`, the one authority on TradingView's session (C49's `time()` anchors read
  it too), never restated. A weekday our bars merely lack after 2000 moves nothing.
- `api/services/ast_interpret.py::htf_closes_on_next_bar` and its `tf_merge` arm: the same rule, read off the twin
  `api/services/tradingview_session.py` (`tests/test_nyse_calendar_parity.py` holds the twins equal).
- The engine ledger's NUMBER PENDING line (the coordinator numbers the train).

## 3. Rails and mutation proofs

- `app/src/components/chart/engine/ast/htfCalendarMerge.test.js`: the rule reads TradingView's session facts; the
  hand-written cases (Good Friday 1999 and 2000, 23 December 1999, 11 June 2004, the week of 10 September 2001,
  Memorial Day 1999 and 2004, a Friday control, a month whose 31st is a Saturday); `tf_merge` over hand-written dates
  (only the short period moves); and TradingView's own A02 / A05 on every bar but the newest of both captures.
- `tests/test_pine_htf_calendar_merge.py`: the same for the Python lane, and that neither lane restates the facts.
- `tests/test_pine_htf_calendar_switch_year.py` (on master): re-derives the switch year from the two captures, with
  controls (a doctored week; a start year of 1999 or 2001 read as a break).

Two structural rails the remote lane did not run went red on the PR's first pine heavy run (44478733729) and are
kept, not relaxed: `tests/test_ast_budget.py` (`ast_interpret.py` holds no `try`; the day is now checked by
arithmetic) and `engine/ast/interpret.test.js`'s purity pin (the new edge to `tradingViewSession.js` is named; that
module is already inside the scanned closure as `indicators.js`'s one edge).

Mutants (`runs/mutants-manifest.json`, `uct.ci-mutants/v1`, run by pine heavy's mutant job):
- B2-1 the merge pick ignores the calendar (master's rule)
- B2-2 TradingView's closures read as starting in 2004
- B2-3 the closures TradingView never applied (11-14 September 2001) are ignored
- B2-4 a weekend day counts as an unclosed session
- B2-5 the Python lane ignores the calendar
- B2-6 the Python lane reads TradingView's closures as starting in 2004
- B2-7 the Python lane counts a weekend day as an unclosed session

Results: the PR's mutant job (dispatched `skip_legs`), stated in the PR description.

## 4. Runs

| run | result |
|---|---|
| remote lane, `16d3606aca` (run 44477564821): `htfCalendarMerge`, `engine55HtfMerge`, `tfMergeNestedMasks`, `interpret.tfDaily`, `periodAnchorParity`, `pendingNumbers`, `runtimeRequestSupply`, `vendorHarness.reqLookaheadAlignment`, `vendorHarness.e55NamedGaps`; pytest `test_pine_htf_calendar_merge`, `test_pine_htf_calendar_switch_year`, `test_engine55_tf_merge`, `test_pine_tfmerge_nested_masks`, `test_ast_tf_live_quarter`, `test_nyse_calendar_parity`, `test_script_engine_version_gate` | green: vitest 9 files, 249 tests; pytest 270 passed |
| A1 SPY (local), production lane, master `5c2aa89822` | DIVERGE, 3 of 7 (RW 7 bars, SW 2, RM 1) |
| A1 SPY (local), runtime-on lane, master `5c2aa89822` | DIVERGE, 3 of 7 (the same bars) |
| A1 SPY (local), production lane, this branch `16d3606aca` | MATCH, 7 of 7; daily 8,509 bars, weekly / monthly 8,508 |
| A1 SPY (local), runtime-on lane, this branch `16d3606aca` | MATCH, 7 of 7 (the same counts) |
| full corpus, both lanes | the PR's pine heavy run (PR description) |

Every local step took the heavy lock, at `VITEST_MAX_WORKERS=1`.
