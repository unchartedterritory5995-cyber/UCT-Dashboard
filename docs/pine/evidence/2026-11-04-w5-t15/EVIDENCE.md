# W5-T15 Backtest: a stored runtime document replays through the client

Branch `feat/pine-w5-t15-backtest`. Base (tested-on-master merge): `e710d36d6a`
(= W5-T11 `86218da704` + `git merge --no-ff origin/master` at `9bfd567837`). Built on master
`4739e11ef1` (block-run gates): the `ast` path, its M3 gates and its 409 verdict are untouched.

## What changed
- `api/routers/screener_backtest.py`: a `def_id` naming a runtime document no longer 400s
  ("carries no compute.ast"). `_definition_tree` -> `_runtime_descriptor` asks, in the 5.2 order, the
  stored verdict (`runtime_server_lane._verdict`) then `server_lane_refusal(row, lane="backtest")`
  (`_admission`), then picks the plot (one output, or the new optional body field `plot`; several
  outputs with none named, or an unknown name, is a 409 `runtime:backtest-plot`).
  `_RuntimeReplay` reads bars per symbol, sends them in chunks of `RUNTIME_BATCH`=50 as ONE request
  (profile `backtest`, through `pine_runtime_client`), asks verdict+admission again before EVERY
  chunk, and hands the engine each symbol's column (na -> None).
- `api/services/screener/backtest.py`: a seam, `run_backtest(..., column_for=, warmup_bars=)`. Given a
  column the engine skips the tree-only steps (scalar check, `max_lookback`, `interpret`) and runs the
  SAME window / warm-up / hole / true-false tally. One tally, not a second for the service.
- Refusal mapping (design 3.7, backtest column), never 400, never a 200 "no signal":
  503 = `server-unavailable`, `server-auth`, `server-busy`; 500 = `server-integrity`; every other guard
  (killed, not-yet-graded, stage, server-stage, engine-mismatch, worker-oom/failed, time-budget,
  run-wide and per-output refusals, the stored verdict) = 409 with `guard: sentence`.
- Bar time units: the engine's bars carry `t` as `"YYYY-MM-DD"` (store ts is YYYYMMDD int). The
  client refuses a non-number and a YYYYMMDD int would pass as a number 1,000x too small.
  `_epoch_seconds` sends unix seconds at 00:00 UTC for ISO strings and YYYYMMDD ints; anything else is
  left unchanged so the client refuses it by name (`server-integrity` -> 500). ASSUMPTION (not
  captured): the service reads daily `t` as UTC-midnight epoch seconds (SUPERSEDED by r1 below).
- Receipt identity: `job_id` digests `{runtime handle, plot, output}` in the tree's place; `def_hash` is
  the runtime handle (`runtime:sha256:...`).

## Nothing reaches members while PINE_RUNTIME_SERVER_STAGE is unset
`test_with_the_server_stage_unset_nothing_reaches_the_service` runs the REAL admission chain (kill
list, grading and pane stage patched open) with the server stage unset: 409 `runtime:server-stage`,
inline and `?background=1`, no client built, no service call, nothing queued. No flag set anywhere.

## Notes / open items
- T7 results carry no `digest` (T11's finding) and the client requires one on every `ok` result: until
  the service emits it, every real run is `server-integrity` (500). End-to-end gap, noted not patched.
- Warm-up: the service returns none yet, so a fixed lead `RUNTIME_WARMUP_BARS`=500 is read and the
  first 500 bars of any tape are charged to `bars_warmup`; the script's own na bars are
  `bars_not_computable`. Recursive indicators converge over the lead; this is not a TradingView seed.
  T16's `runtimeWarmupOf` should replace the constant.
- A refusal is whole-request (503/409/500): a backtest has no partial answer (design 3.7).
- Background POST: admission refuses at POST (pre-queue); a transport refusal after queueing surfaces
  as the poll's `status: error` with the guard sentence (the existing `_submit` shape).
- Private helpers `runtime_server_lane._verdict/_admission` are reused (T11's file untouched).
- Engine bump (SCRIPT_ENGINE_VERSION): NO. No chart-engine output changes.

## Checks
Tested tree: code tip `560d8e6958` (this file is the only later change). Base `e710d36d6a`.

- New rails `tests/test_screener_backtest_runtime.py`: 26 tests. On base (archive of the base tree + the
  test file): 23 failed, 1 passed (the pure `job_id` digest test exists on base). On tip: 26 passed.
- final-tip (`bash $S/final-tip.sh pine-dsk-w5t15 dsk-w5t15-final <8 backtest pytest files>`, lock
  `heavy-final2.lock`, 42.4 min): gate pytest 46 passed; hygiene rc=0; rails pytest 175 passed
  (runtime, def_id, route, controls, screener_backtest, backtest_engine, backtest_endpoint,
  backtest_stats); vitest chart+hooks: 2 failed | 1333 passed | 27 skipped, the two failures being
  the stated baselines `settingsScope.rail` and `pollingSites.rail`. Logs:
  `_resume-2026-11-01/runs/dsk-w5t15-final/`.
- Existing backtest tests are green on tip. One existing rail
  (`test_the_routers_ONE_engine_call_binds_against_the_REAL_signature`) forced the runtime branch to
  share the single `engine.run_backtest` call site; it does.

## Mutations (pytest, `heavy-mut.lock`, byte-exact restore, PYTHONDONTWRITEBYTECODE)
| mutation | killed by |
|---|---|
| per-chunk admission removed | test_a_kill_between_chunks_stops_the_run_at_the_next_chunk |
| door admission removed | test_with_the_server_stage_unset_nothing_reaches_the_service |
| epoch seconds -> date key | test_the_daily_bar_time_reaches_the_service_as_unix_seconds_not_a_date_key |
| busy / auth dropped from 503 | test_a_service_refusal_maps_to_503_409_or_500... |
| integrity not 500; everything 409 | test_a_tape_with_a_non_date_time_is_refused_by_the_clients_integrity_guard... |
| wrong profile | test_a_runtime_document_replays_through_the_client_and_is_not_a_400 |
| na kept as a number | same |
| per-output refusal ignored | same family (integrity/mapping tests) |
| plot guess allowed | test_several_plots_need_a_named_one... |
| def_hash not the handle | test_a_runtime_document_replays... |
| warmup not charged (engine seam; router arg) | test_the_leading_bars_are_charged_to_warmup... |
| batch size ignored | test_a_kill_between_chunks... |
| stored verdict not re-asked per chunk | test_a_verdict_that_lands_between_chunks_stops_the_run |
| job id ignores plot | test_each_plot_of_one_script_is_its_own_receipt_through_the_route |
| column_for / bars_for not routed to the replay | test_a_runtime_document_replays... |
| engine column-length check; router column-length check | EQUIVALENT survivors: the client already refuses a column whose length differs from bars.n (server-integrity), so these are defence in depth. |

## r1 (fix): the daily bar time is the 09:30 America/New_York open
Coordinator finding (W5-T7b `e13d282eae`): UTC-midnight seconds make every clock read one day early.
`_epoch_seconds` now only names the date (YYYYMMDD int or ISO) and calls
`indicator_compute.bar_open_instant(date, "D")` (not re-implemented; the same function W5-T14 uses);
an unreadable value is returned unchanged so the client refuses it by name. The ASSUMPTION line in
"What changed" is superseded.
- Rail `test_every_spelling_of_a_daily_session_is_the_0930_ET_open_across_dst_and_winter` pins winter
  2024-01-02 (1704205800), 2024-03-08 and 2024-03-11 around the 2024-03-10 spring-forward (gap
  3 days minus 1 h), and 2024-11-04 after the fall-back, for ISO, YYYYMMDD and timestamped spellings;
  `..._unix_seconds_not_a_date_key` pins the bytes the fake receives.
- Mutations (`heavy-mut.lock`, 5/5 killed): UTC midnight; fixed 14:30 UTC offset; YYYYMMDD not
  normalised; wrong tf; unrecognised value guessed as 0.0. Script/log: `_resume-2026-11-01/runs/w5t15/`.
- Tests: 26 passed in `test_screener_backtest_runtime.py`.
- final-tip r1 (tree `69761bfa87`, `heavy-final3.lock`, 45.8 min): gate pytest 46 passed; hygiene clean;
  8 backtest pytest files 175 passed; vitest chart+hooks 2 failed | 1333 passed | 27 skipped (baselines
  `settingsScope.rail`, `pollingSites.rail`). Log: `_resume-2026-11-01/runs/w5t15/w5t15-final.out`.

## r2 (fix): the warm-up charged is the service's; one history rule; T11's public admission
Review NO-GO: the tally read run-withheld but finite warm-up bars beyond a fixed 500-bar charge.
Merged T11 r2 (`7df06fe3fd`: the client refuses a finite value inside the run's own `withheldBars` as
`server-integrity`, no masking; each ok result carries `warmup={"withheldBars": k}`).
- ONE HISTORY RULE: `RUNTIME_HISTORY_LEAD`=500 (was `RUNTIME_WARMUP_BARS`) only SIZES the read before the
  run (the window is fixed before the service answers); it charges nothing. What is charged to warm-up
  is the run's own `withheldBars`, carried by the column as `.warmup_bars`; `run_backtest` charges
  `max(seed, column.warmup_bars)` per symbol and states the longest in `method.warmup_bars`. Warm-up
  bars (na by T11's check) are never a signal or a "no"; later na bars are `bars_not_computable`. A
  script whose warm-up outruns the lead has the shortfall charged to warm-up, not tallied.
- Admission is T11's public `runtime_server_lane.admission(row, plot, "backtest")` (door and every
  chunk); the private `_verdict`/`_admission` use is gone.
- Rails (30 tests now): service warm-up charged and identity `answered+warm-up+holes==in-window`; lead
  charges nothing and sizes the read (+30 lead = +30 bars read); a finite value inside the warm-up
  fails the request 500 integrity; a warm-up equal to the tape leaves a named refusal; admission asked
  with the chosen plot.
- Mutations (`heavy-mut.lock`, 10/10 killed, log `_resume-2026-11-01/runs/w5t15r2/mut.out`), incl. T11's
  check removed in `api/services/pine_runtime_client.py` (restored byte-exact; tree clean after) ->
  `test_a_finite_value_inside_the_services_own_warmup_fails_the_request_as_integrity`.
- Store-time-to-seconds helper: T14 keeps a private `_runtime_bar_seconds` in `scan_evaluator.py`, and a
  standing rail forbids routers importing that module, so there is no obvious shared home. Both call
  `indicator_compute.bar_open_instant`, the one authority; only the YYYYMMDD->ISO step is duplicated.
  Candidate home if wanted: a `store_time_to_iso` beside `bar_open_instant` (not done; T14's file is not ours).
- final-tip r2 (tree `d375523120`, `heavy-final2.lock`, 51 min): gate pytest 46 passed; hygiene clean; 10 pytest
  files (8 backtest + `test_pine_runtime_client`, `test_runtime_server_lane`) 345 passed; vitest chart+hooks
  2 failed | 1333 passed | 27 skipped (baselines `settingsScope.rail`, `pollingSites.rail`).
  Log: `_resume-2026-11-01/runs/w5t15r2/final.out`. Engine bump: no.
