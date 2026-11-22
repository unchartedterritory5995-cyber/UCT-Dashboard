# W5-T13 Alerts: evidence (desktop, 2026-11-04)

Branch `feat/pine-w5-t13-alerts`. Spec: `SERVER-RUNTIME-DESIGN.md` (origin/docs/pine-language-coverage)
section 7 "T13 Alerts", the 5.1 rows for `alert_user_series.py` and `indicator_alert_service.py`,
5.2 (fixed order) and 3.7 (fail closed, by name).

- **Base:** `8d6682856a`. This is `--no-ff` merge of origin/master `9bfd567837` into W5-T11 READY `86218da704`.
- **Code tip (tested):** `222ff8cf0f`. The evidence commit after it changes docs only.
- **Tested on master:** `9bfd567837`.
- **Engine bump needed:** no. No engine file changed and `SCRIPT_ENGINE_VERSION` is untouched.
- **Flags:** no new variable is read and none is set. The lane reads only T12's existing
  `server_lane_refusal` and T11's `client_from_env`.

## What changed

### `api/services/alert_user_series.py`

New gates:
- `server-lane`: the guard and sentence come from `server_lane_refusal`.
- `server-run`: the arm-time run did not answer `ok`.

Both have disjoint fragments and are driven in the existing totality and disjointness rails.

Gate changes:
- `_gate_lane` admits `compute.kind == "runtime"` when `server_lane_refusal(row, lane="alert")`
  is None. Otherwise it raises `server-lane`. An admission that raises, or gives no reason, also
  refuses.
- `_gate_repaint` reads `runtime_definitions.repaint_stamp` for a runtime document.
- `_gate_budget` does not apply to a runtime document.

New functions:
- `_gate_runtime_service` replaces `_gate_cross_lane` for runtime documents. It makes one service
  run on the alert's own bars, symbol, timeframe and inputs.
  - A run-wide refusal or a transport failure raises `server-run` with the guard's sentence.
  - A per-output refusal withholds that plot only. Its sibling plots still arm (the C45 rule).
- `_make_runtime_value_fn` sits beside `_make_value_fn`. It goes through T11's
  `runtime_column_fn`, which asks the stored verdict and the admission on every call. It returns
  the last finite value through `_last_finite`.
- `call_series` is the one call shape. A runtime plot takes `tf` and `sym`.

Window and catalog:
- `lookback_for_alert` and `runtime_window_for_alert` return the profile window: 5,000 bars on
  D/W/M and 32,768 intraday. A rail holds the intraday value equal to `limits.js` `HISTORY`.
- `user_value_function` (the prefill) and `user_catalog` list runtime plots, meaning the keys in
  `compute.outputs` only.

Bar time units (my ruling, with rails):
- The wire carries only Float64 `t`.
- A date-timeframe bar (store key `YYYYMMDD`) is sent as its session's opening instant, computed
  by `indicator_compute.bar_open_instant`. That is the Python twin of the `barOpenInstant` rule,
  which the chart's clocks apply to the ISO date the browser hands the runtime.
- Intraday unix seconds pass verbatim.
- A time that cannot be stated, or two bars with the same instant, is refused
  `runtime:server-integrity`. It is never guessed.
- Seconds on a date timeframe: the closed lane can place no bar, so nothing is sent.

Closed bars only (ruling Q3):
- The bars sent end at `closed_bar_index`. A forming bar is never sent, and its slot in the
  column is `None`.

Batching (`runtime_cycle_batch`):
- The service gets one request per (sym, tf) group per stored definition version. A request
  carries one definition (design 3.2), so two definitions in a group mean two requests. It is
  never one request per alert.
- Each distinct input set is a separate job, and each job wants every plot its alerts watch.
- The verdict and the server-lane admission are asked before the request. A killed, staged-off
  or engine-held definition sends nothing.

Edited scripts:
- An edited runtime script re-arms on its new version. A registry hit checks the stored version
  and `ast_hash` (see open item 3).

### Other files

- `indicator_alert_evaluator.py`:
  - The cycle wraps each group in the batch.
  - `group_bars`: a formula alert keeps the window its own group members declare, so a runtime
    neighbour's 32,768-bar fetch never changes the series a formula is computed on.
  - `bars_needed_for_alert` returns the runtime window verbatim, with no pad and no 5,000 cap.
  - Both lanes call through `call_series`.
- `alert_shadow_log.py`: the same grouping and batch.
- `indicator_alert_service.py`:
  - `create` is unchanged.
  - `_diagnose_user` names a withheld runtime plot as `Withheld: <guard> — <sentence>.`, which
    reaches needs-attention through the existing silent-alert sweep.
- `routers/indicator_alerts.py`: the prefill runs a runtime plot on the request's symbol and timeframe.
- `docs/pine/PHASE3-RUNTIME-PLAN.md`: section 1.3 and checklist row S1 are rewritten as the
  design header asks.

## Rails: `tests/test_alert_runtime_lane.py` (24, all through T11's fake; no network)

- **Red on base:**
  - Command: `python -B docs/pine/evidence/2026-11-04-w5-t13/redbase.py 8d6682856a tests/test_alert_runtime_lane.py tests/test_alert_user_admission.py`.
    It writes the base bytes of the 5 code files, runs, then restores them byte-exact.
  - Result: **26 failed, 35 passed**. All 24 new rails fail, plus the two updated admission rails
    `test_every_admission_gate_is_REACHABLE_and_actually_refuses` and
    `test_no_two_admission_refusals_SHARE_a_fragment`.
  - Log: `runs/w5t13/redbase.log`.
- **Green on tip:** `python -B -m pytest -q tests/test_alert_runtime_lane.py tests/test_alert_user_admission.py tests/test_runtime_definitions.py tests/test_p1_truth_core.py tests/test_user_definition_reproof.py tests/test_runtime_server_lane.py tests/test_pine_runtime_client.py` on `222ff8cf0f` -> **306 passed** (`runs/w5t13/rails-tip.log`).

The rails are:
- arm (one run, profile alert, both plots, closed bars);
- server-lane refusal with no service call;
- run-wide refusal → server-run;
- per-output refusal (the sibling still arms);
- service down at arm;
- repaint reads the stamp, and the budget is not asked;
- one request per group, with 3 alerts → 1 request and 1 job;
- one request per definition (2 definitions → 2);
- distinct inputs → jobs of one request, with undeclared inputs dropped;
- kill mid-life: no request, needs-attention `Withheld: runtime:killed — …`, nothing deleted, and
  the alert resumes when unkilled;
- service down mid-life → needs-attention `Withheld: runtime:server-unavailable — …`;
- **stage unset reaches nothing:** the REAL `server_lane_refusal` and the REAL `client_from_env`,
  with a transport that fails the test if reached. The arm is refused `runtime:stage`, then
  `runtime:server-stage` with the pane stage and the service set.
- an armed alert stops on the next cycle once `PINE_RUNTIME_SERVER_STAGE` is unset;
- daily `t` = the session-open instant;
- intraday seconds, with the forming bar not sent;
- an unstatable or duplicate time is refused;
- windows of 5,000 and 32,768, and the arm fetch uses them;
- 32,768 equals `limits.js` `HISTORY`;
- a formula neighbour keeps its own window;
- an edit re-arms on v2;
- the catalog lists outputs only, and a refusal is named `server-lane`;
- the prefill runs on the symbol;
- a stored engine verdict sends nothing and is named;
- the batch never answers an unasked plot or another version.

## Mutations: 28/28 killed, 0 survivors

Command: `python -B docs/pine/evidence/2026-11-04-w5-t13/mutate_pytest.py docs/pine/evidence/2026-11-04-w5-t13/muts.json tests/test_alert_runtime_lane.py tests/test_alert_user_admission.py`.
Restores are byte-exact, pyc files are dropped and runs use `-B` (`muts.json` comes from
`mkmuts.py`). The run went through `heavy-mut.lock`. Log: `runs/w5t13/mut2.log` (on `222ff8cf0f`).

| mutation | killed by |
|---|---|
| M01 server-lane gate not asked | a_server_lane_refusal_refuses_the_arm… |
| M02 runtime refused as not-a-formula | arm_admits_a_runtime_plot… |
| M03 repaint reads stored column / M04 budget applied | the_repaint_gate_reads_the_runtime_stamp… |
| M05 run-wide refusal at arm ignored | test_alert_user_admission totality (server-run drive) |
| M06 per-output refusal ignored | a_per_output_refusal… |
| M07 forming bars sent | an_intraday_bar…forming_bar_is_never_sent |
| M08 date bar sent raw YYYYMMDD | a_daily_bar_is_sent_as_its_sessions_opening_instant |
| M09 unstatable time / M10 duplicate instant | a_bar_whose_time_cannot_be_stated… |
| M11 prime ignores admission / M21 diagnose drops guard | a_kill_mid_life… |
| M12 prime ignores verdict | a_stored_engine_verdict_sends_nothing… |
| M13 no batch | the_cycle_sends_ONE_request… |
| M14 inputs merged / M15 undeclared inputs sent | distinct_inputs_are_jobs… |
| M16, M17, M25, M26 window mutations | the_window_is_the_profiles |
| M18 neighbour gets runtime window | a_formula_neighbour_keeps_its_own_window |
| M19 stale fn kept / M20 prime batches stale fn | an_edited_runtime_script_re_arms… |
| M22 runtime plot called without symbol | the cycle and kill rails |
| M23 catalog lists plots with no output | the_catalog_lists_runtime_plots… |
| M24 prefill builds a formula fn | the_prefill_value_function… |
| M27 batch answers unasked plot / M28 key ignores version | the_batch_never_answers… |

## Existing alert tests: base vs tip

The run covers 103 files that import `alert_user_series`, `indicator_alert_service`,
`indicator_alert_evaluator` or `alert_shadow_log` (`runs/w5t13/alert_files.txt`).

| run | result | log |
|---|---|---|
| base | 16 failed, 3455 passed | `runs/w5t13/base-alerts.log` |
| tip `15637b52f6` | 19 failed, 3476 passed | `runs/w5t13/tip-alerts.log` |

The tip run has 3 failures the base run does not. All three are intended contract changes, and
each is fixed on `90d02259ef`:
1. `test_runtime_definitions::test_an_alert_cannot_bind_a_runtime_row`. The old contract refused
   runtime at `lane`. The rail now asserts `server-lane` on a box with no server stage.
2. `test_p1_truth_core::…[runtime document :: value]`. This is the shared browser/server fixture.
   The server now refines the browser's static `lane` to `server-lane`. The rail accepts exactly
   that refinement for runtime documents only (see open item 2).
3. `test_user_definition_reproof::test_USER_FUNCS_HAS_EXACTLY_ONE_WRITER…`. The runtime half now
   returns its functions, so `admit_user_definition` stays the only writer.

The other 16 are identical on base and tip, and each one **fails alone** on both:
- `runs/w5t13/alone-tip.log`: 16 failed;
- `runs/w5t13/alone-base.log`: 16 failed, via redbase.

So they are pre-existing. The files are `test_alert_erasure`, `test_alert_taxonomy_indicator_condition_schema`,
`test_c45_withheld_doors` ×2, `test_gate_shards`, `test_phase_e_acceptance` ×3,
`test_scan_evaluator_off_request_path`, `test_shared_state_landmines`, `test_starter_library` ×5
and `test_tools_pin_the_root`.

A first base run without the `app/node_modules` junction failed 112 tests on `jsep`. That run
was discarded (`base-alerts-nojunction.log`).

## final-tip

Command: `bash $S/final-tip.sh pine-dsk-w5t13 dsk-w5t13-final <the 7 rail files>`, run through
`heavy-final2.lock`. Log: `runs/dsk-w5t13-final/` and `runs/w5t13/final-tip.out`.

On tip `222ff8cf0f` (tested on master `9bfd567837`):
- deploy-gate pytest: rc 0, 46 passed;
- hygiene: rc 0, clean;
- rails pytest (the 7 files): rc 0, 306 passed;
- vitest (chart and hooks): **Test Files 2 failed | 1333 passed | 27 skipped (1362); Tests 2 failed | 22512 passed | 118 skipped**.

The 2 vitest failures are the stated baselines and nothing else: `pollingSites.rail` fails on every
master, and `settingsScope.rail` is red on masters at or after 96582cd549. This lane changes no
front-end file.

## Machine incident (recorded at the coordinator's request)

A whole-tree `python -m pytest --collect-only -q -p no:cacheprovider tests/` (PIDs 24068/34744/20096)
grew to 13 GB and took free RAM to 0.8 GB; the desktop stopped it. Not this lane; launched by
another session (desktop-verified).

## Schema findings and open items

1. **The end-to-end gap (T11 finding 1):** T7 results carry no `digest`, so through the real T7
   service the client withholds every `ok` answer `runtime:server-integrity`. These rails use
   T11's fake, which carries one. On a real service today every runtime alert would be refused
   `server-run` at arm, by name. Fail closed; T7 is not patched here.
2. The browser preflight (`evaluability.js`, lane `alert`) still answers `lane` for a runtime
   document. It should read the server's own answer (T17's `server_lanes` stamp).
3. **For T17 / user_definitions owners:**
   - `_save_runtime` does not call `alert_user_series.forget()`. T13 guards this itself on every
     registry hit (version and `ast_hash`).
   - A runtime source edit runs no rev migration, so `last_value` carries across scripts.
     `_save_runtime`'s docstring ("an alert cannot be bound to a runtime document") is now stale.
4. W5-T17 adds `user_definitions.server_lane_composition`. The alert callers here
   (`_gate_lane` / `_gate_server_lane`, the batch prime) should adopt it once T17 merges. The
   admission still goes through `server_lane_refusal` as designed.
5. Date timeframes: the wire cannot carry the ISO date the browser hands the runtime. A runtime
   read of RAW `t`, such as `vm.js` `OP.SESSION`'s `etClockAt(t)`, would see an instant on the
   server where the browser sees a string. Clock columns agree, because both go through
   `barOpenInstant`. A date-keyed time form in the protocol (T6/T7) would close this.
6. A protocol request carries one definition, so the group batching is one request per
   (sym, tf, definition version), not per (sym, tf) when a group mixes definitions.
7. The intraday window of 32,768 bars is fetched per group per cycle (design 5.1). Its cost on
   the pod is unmeasured.

## FIX r1 (review NO-GO @a21ad7df75, `_resume-2026-11-01/dsk/reviews/W5-T13.md`)

- **Refresh:**
  - Merged T11 r1 `1e384edbfe` (merge `ac457b1fc7`).
  - Per the desktop correction, merged T11 r2 `7df06fe3fd` in place of r1 as the final base. T11 r2
    verifies the engine's warm-up curtain and refuses a finite warm-up value as
    `runtime:server-integrity`.
  - Tested on master `9bfd567837`, unchanged.
- **B1, warm-up:** there is NO mask in T13; the warm-up check is T11's alone (one authority, desktop
  ruling). Two alert-level rails cover it:
  - `test_a_warm_up_bar_is_never_fired_on_prefilled_or_used_as_previous`. With every closed bar in
    warm-up, nothing fires, the prefill is None and the column is all None. With every bar but the
    newest in warm-up, a `cross_above` that a leaked "previous" would fire does not fire.
  - `test_a_finite_warm_up_value_never_reaches_the_alert`. A reply whose warm-up covers finite
    values is refused as integrity. Nothing fires, and the alert goes to needs-attention with
    `Withheld: runtime:server-integrity — …`. The prefill raises that guard.
  - Mutation **M29** removes T11's check (`pine_runtime_client.py`, mutated in this worktree only
    and restored byte-exact). Its killer is the finite rail. **M30** lets NaN into the alert column;
    its killer is the warm-up rail.
- **Item 3, one admission:** `_prime_runtime_batch` now asks T11's public
  `runtime_server_lane.admission(row, plot, "alert")` per plot. The second copy of the step-2/4
  chain is deleted.
  - Rail: `test_the_cycle_asks_the_one_public_admission_and_sends_nothing_it_refuses`, over kill,
    server-stage and not-graded. `admission(...)` equals the refusal, 0 requests are sent, and the
    needs-attention detail names the guard.
  - Killer: **M11** (filter dropped).
- **Item 4, ruling:** a runtime plot is always judged on the closed lane, even under
  `ALERT_EVAL_MODE=forming` (`_evaluate_for_cycle`). `diagnose` follows the same rule.
  - Rail: `test_a_runtime_plot_is_judged_on_the_closed_lane_even_under_the_forming_rollback`. Under
    the forming mode, the fire's value and its `bar_time` are the closed bar's.
  - Killer: **M12**.
  - The diagnose half has no rail of its own. Under the forming mode it reads the newest
    non-None value, which for a runtime column is the same closed bar: an equivalent survivor.
- **Red on base:** pre-r1 code (`a21ad7df75`'s 5 code files) on the r2-merged tree, via
  `redbase.py a21ad7df75 <the 4 r1 rails>`: 1 failed, 5 passed. The forming-rollback rail fails.
  The other three hold through T11 r2 and the unchanged chain; they are regression rails for the
  one-authority wiring, with their mutations above.
  Log: `runs/w5t13r1/redbase.log`.
- **Mutations:** 30/30 killed, 0 survivors (`runs/w5t13r1/mut.log`, through `heavy-mut.lock`).
  M11 and M12 replace r0's prime-chain rows; M29 and M30 are new.
- **Item 5, notes:**
  - On the first cycle after a restart or an edit (`forget`), the prime batches only registered
    functions. Each runtime alert re-arms unbatched, so that cycle costs one request per alert
    (bounded to one cycle; review N2).
  - The 32,768-bar intraday window is fetched per group per cycle and is unmeasured on the pod
    (review N4). It must be measured before the stage leaves `admins`.
  - Also noted: on a runtime edit, `forget(user_id)` also drops that member's formula
    registrations, which re-prove on the next cycle (review N3, cost only).
  - The browser preflight still answers `lane`, not `server-lane` (T17 `server_lanes`). This must
    be closed before the stage is on for members.
- **Existing alert tests** (the same 103 files plus the rail file, through `heavy-final2.lock`):
  **16 failed, 3485 passed**. These are exactly the 16 pre-existing failures that fail alone on
  base too; there is no new failure (`runs/w5t13r1/tip-alerts.log`).
- **final-tip** on `d7184220d1`, the final code tree (the commit after it is this evidence only):
  - deploy-gate pytest: rc 0, 46 passed;
  - hygiene: rc 0;
  - rails (7 files): rc 0, 352 passed;
  - vitest: Test Files 2 failed | 1333 passed | 27 skipped; Tests 2 failed | 22512 passed.
  The 2 failures are the baselines `pollingSites.rail` and `settingsScope.rail`. Logs:
  `runs/dsk-w5t13r1-final/`, `runs/w5t13r1/final-tip.out`.
- **Engine bump:** no.
