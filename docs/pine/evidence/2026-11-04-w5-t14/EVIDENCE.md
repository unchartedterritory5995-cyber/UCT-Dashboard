# W5-T14 Scans: evidence

Lane: W5-T14 (docs/pine/SERVER-RUNTIME-DESIGN.md section 7 "T14 Scans" and 5.1), desktop machine.
Branch `feat/pine-w5-t14-scans`. Base: **`28a6bd424d`** = `git merge --no-ff origin/master` into W5-T11 `86218da704`
(clean merge; W5-T12's `server_lane_refusal` is in). Tested on master `9bfd567837` (merge-base with origin/master).
No Railway, no flags, no network (every request goes to T11's in-process fake `tests/fakes/pine_runtime_fake.py`),
no flag set anywhere. **Engine bump: NO** (Python only; `SCRIPT_ENGINE_VERSION` untouched).

## What changed
- `api/services/screener/scan_runtime.py` (new, light): the scan DOORS' side of a runtime row, in one place:
  `runtime_admission(row, lane)` (the stored verdict, then `server_lane_refusal`, through
  `runtime_server_lane._verdict/_admission`, fail closed), `runtime_scan_spec(definition)` (scannable?
  `{def_hash, plot}`, handle = `runtime_definitions.handle` = `HASH_PREFIX` + source sha), `RuntimeScanDoc` /
  `runtime_scan_doc(row)` (the document that remembers its row: id, version, owner). It lives apart from the
  evaluator because `test_scan_evaluator_off_request_path` forbids the request path from naming the sweep.
- `scan_evaluator.py`: `evaluate_one` dispatches a runtime document to `_evaluate_runtime`; `definitions_to_sweep`
  admits a runtime row only if `runtime_admission(row, "sweep")` is None (silent, one counted log line per guard);
  `_resolve_entries` / `sweep_job` read-back use `_scannable_handle`; the dedupe key is `_result_handle`; the live
  cycle's phase 1 refuses a runtime document `gate:cadence` (closed bars only, ruling Q3).
- `scan_run.py`: `_load_definition` turns a runtime refusal into `RunRefused("gate:not-scannable", <guard's sentence>)`
  (verdict first); `submit_run` scans a runtime row through `runtime_scan_spec` and hands the worker a `RuntimeScanDoc`.
- Decisions (rails below): the scan plot is the document's ONE `compute.outputs` key (a runtime document names no
  `scanPlot`; two or more is refused `gate:tree` by name); the plot must be a 0/1 (or na) condition, else that symbol
  is `not_computable` (`<price> != 0` would return the universe); the script runs with its default inputs
  (`runtimeInputs` empty).

## Bar time units (T11's finding, decided here)
The store keys a daily bar by a YYYYMMDD int; the runtime reads `t` as unix SECONDS (a YYYYMMDD read as seconds is
August 1970). A daily bar is sent at its session's **09:30 America/New_York open in unix seconds**, the chart's own daily
convention (`indicators.js::barOpenInstant`, here `indicator_compute.bar_open_instant`, DST-correct). An unreadable
`t` makes the symbol `not_computable`; bars after the run's session are cut before sending (a repainting script cannot
read a session the screen does not answer for). Epoch-second bars pass through.

## Outcome mapping (3.7 rule 3)
answered (a 0/1 value; 1 = hit) / dropped (`no-bars`, `stale-bars`) / not_computable (per-plot refusal with the guard's
sentence, non-0/1 plot, na on the as-of bar, unreadable bar time) / **withheld** (any run-wide refusal or transport
failure: counted `withheld`, never answered, never a non-hit; `evaluated + withheld == universe` still closes).
Envelope adds `runtime_withheld`, `runtime_withheld_guards`, `runtime_withheld_symbols`, `coverage_line`.
**A nightly run with any service-withheld symbol files NO receipt** (a receipt for the answered subset would describe a
smaller universe: the quiet-market reading) and says so in `coverage_line` and one WARNING.
Chunks of `pine_runtime_client.SWEEP_CHUNK` (50); the verdict and admission are asked again for EVERY chunk (a kill
reaches the next chunk; the rest is withheld by name and nothing more is sent). Profile: nightly `sweep`, on-demand
`on-demand`.

## Live (decision, needs a ruling to widen)
The service evaluates closed bars only (Q3), so the LIVE mode (forming bar, every five minutes) refuses a runtime
document `gate:cadence` in phase 1 of the cycle (counted `refused`, the receipt closes) and in `evaluate_one`. Re-running
closed bars every five minutes is a true number implying new information (the `cadence_ceiling` failure).
`_RUNTIME_PROFILES["live"] == "sweep"` names the profile the live job will use once Q3 allows a forming bar.

## Nothing reaches members while `PINE_RUNTIME_SERVER_STAGE` is unset
`test_with_the_server_stage_unset_no_runtime_document_is_swept_run_or_sent` reads the REAL `server_lane_refusal` and the
real stage variables (stage `all`, server stage unset): the sweep filter admits none, `evaluate_one` refuses, the
on-demand door refuses, zero service calls and zero bar reads; the positive control with the server stage `all` admits all
three and makes one request.

## Commands and totals
- Rails: `python -B -m pytest -q -p no:cacheprovider tests/test_scan_runtime_lane.py` -> **50 passed**.
- Red on base: `python -B docs/pine/evidence/2026-11-04-w5-t14/redbase.py 28a6bd424d tests/test_scan_runtime_lane.py`
  (base copies of the two edited files put in place, restored byte-exact): **2 failed, 45 errors, 3 passed** (`runs/w5t14/redbase.log`).
  The 3 that pass are unit rails on the new module `scan_runtime.py`, which exists on the tip only (on a true base they
  are an ImportError): `..._scannable_only_with_exactly_one_plot`, `..._scan_doc_remembers_its_row...`,
  `..._handle_without_the_runtime_prefix_is_refused`.
- Existing screener tests (68 files that name `scan_evaluator` / `scan_run` / `scan_definition`), base vs tip, one run
  each (`runs/w5t14/base-screener.log`, `tip-screener.log`): base **23 failed, 2667 passed**; tip run (with the new
  file and the two T11 files) 27 failed, 2839 passed. Classified, tip minus base:
  - `test_scan_evaluator_off_request_path` x3 (`..._NO_UNCLASSIFIED_public_function`, `..._reach_the_QUEUE_and_STOP`,
    `..._BOUNDED_module_names_the_sweep_ONLY_in_RULED_forms`) and the route-reach test's `/api/scans/run` line: **real, fixed**
    by moving the door helpers out of the evaluator into `scan_runtime.py` (re-run: that file is back to its base single failure,
    `test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes`, whose remaining handlers are
    `indicator_alerts` create_alert / get_current_value, the same as base).
  - `test_screener_live_read_path::test_a_STALE_overlay_row_serves_nightly...`: **wall-clock hour, not this lane**: green at
    the baseline hour, red at 15:50 CT, and red with the BASE copies of the edited files put back (same redbase mechanism).
  - the other 22 base failures are unchanged (`test_c45_withheld_doors` 2, `test_concept_vocabulary` 6,
    `test_definition_concierge` 5, `test_frontend_deps_installed` 1, `test_phase_e_acceptance` 3, `test_starter_library` 5,
    `off_request_path` 1).
  Tip failure list: `runs/w5t14/tip-failed.txt` (before the move of the helpers).
- final-tip (tip `95ce2713b0`, lock `heavy-final3.lock`, `bash $S/final-tip.sh pine-dsk-w5t14 dsk-w5t14-final tests/test_scan_runtime_lane.py`,
  log `runs/w5t14/final.log`): gate pytest **46 passed**; hygiene **clean**; lane rails **50 passed**; chart+hooks vitest
  **2 failed | 1333 passed | 27 skipped (1362 files)**, the two failures being exactly the stated baselines
  `settingsScope.rail` (red on masters at/after 96582cd549) and `pollingSites.rail` (red on every master). Worktree clean.

## Mutation table
Lock `_resume-2026-11-01/dsk/heavy-mut.lock`. `python -B docs/pine/evidence/2026-11-04-w5-t14/mutate_pytest.py
docs/pine/evidence/2026-11-04-w5-t14/muts.json tests/test_scan_runtime_lane.py` (T11's pytest mutator: `old` must occur
once, byte-exact restore asserted, `python -B` and the pyc dropped per run so a same-length mutation cannot be defeated;
the lane files are CRLF, so `mkmuts.py` matches on raw bytes). Final run (`runs/w5t14/mut.log`): **TOTAL 36, KILLED 35,
SURVIVED 1 = the no-op control**, as it must. No equivalent survivors. (An earlier run left M22 alive because phase 1 and
`evaluate_one` both refuse live; the live-cycle rail now spies `evaluate_one` so the phase-1 refusal is what is pinned.)

| mutation | killed by |
|---|---|
| M01 chunk 500 not 50 | `test_the_sweep_is_sent_in_chunks...` |
| M02/M03 profile nightly / on-demand swapped | `test_on_demand_runs_under_its_own_profile...`, chunks rail |
| M04 per-chunk admission not asked | `test_a_kill_between_chunks_withholds_the_rest...` |
| M05 door admission not asked | `test_a_refused_admission_refuses_the_run_before_a_bar...` |
| M06 live runs a runtime doc | `test_live_mode_refuses_a_runtime_document...` |
| M07 withheld not counted | `test_a_withheld_symbol_is_withheld_never_answered...` |
| M08 time not converted / M29 YYYYMMDD as is / M28 wrong tf | the 09:30 ET, DST and pass-through rails |
| M09 bars after the session not cut | `test_bars_after_the_runs_session_are_cut...` |
| M10 non-0/1 answers / M11 na answers / M12 per-plot refusal ignored | the matching `not_computable` rails |
| M13 receipt despite withheld / M14 receipt in every mode | partial-failure, on-demand and clean-receipt rails |
| M15 two plots / M16 prefix / M17 row without version | `scan_runtime` spec, prefix and row rails |
| M18/M19 sweep filter unasked / wrong lane | `test_the_sweep_admits_a_runtime_row_only_when...` |
| M20/M21 resolve and dedupe key | `test_run_sweep_resolves...`, `test_two_members_with_the_same_script...` |
| M22 live cycle phase 1 | `test_the_live_cycle_counts_a_runtime_document...` |
| M23 tf gate / M24 job ids / M25 verdict order / M26 history gate / M27 dispatch | their named rails |
| S01-S05 scan_run: door skipped, wrong lane, guard word not sentence, runtime branch, plot check | `_load_definition` / `submit_run` rails and the real-admission rail |

## Needed elsewhere / open items (not patched here)
- **T11 client:** `runtime_server_lane._verdict` and `_admission` are underscore names used across modules by
  `scan_runtime.runtime_admission`; T11 should expose a public batch-capable `admit(row, lane)` and this lane adopts it.
- **T7/T8 (service):** results carry no `digest`, so every `ok` answer is withheld `runtime:server-integrity` until one side
  moves (T11 finding 1); until then a real sweep withholds all symbols and files no receipt (fail closed).
- **W5-T17:** `user_definitions.result_identity` has no runtime branch, so readers of `scan_hits` keyed by it
  (`/api/scans/definition-results`, screen_alert_integrity) cannot yet find a runtime handle; this lane files under
  `runtime_definitions.handle` (`_result_handle`). Once T17 merges, the scan callers should adopt
  `user_definitions.server_lane_composition` (5.2 steps) in place of the verdict + `server_lane_refusal` pair
  (coordinator note, c1cb5d43ac); the sweep filter stays on `server_lane_refusal(lane="sweep")` as designed.
- **Rule record:** none for runtime (`definition_record.record_pass` takes a tree; T16).
- **Q3 (forming bar):** live sweep for runtime documents needs a ruling and the v2 incremental session.
- Partial receipts: a nightly run with one withheld symbol files nothing; a per-symbol deterministic refusal is
  `not_computable`, but a run-wide script refusal on a few symbols still blocks the night's receipt. Revisit with real
  traffic numbers.
- Sweep dedupe is by source, so two members with the same script share one run under the first admitted owner.
- A multi-plot script is refused (`gate:tree`); a member-chosen scan plot needs a document field.
- Default inputs only; the stored document carries no input values.

## Review round 1: exact failing sets (screener tests, 68 files)
Base `28a6bd424d` (23, `runs/w5t14/base-failed.txt`):
test_c45_withheld_doors.py::test_the_question_is_not_vacuous_and_can_answer_no; test_c45_withheld_doors.py::test_the_whole_series_question_per_lane[tree3-alert3-sweep3]; test_concept_vocabulary.py::test_EVERY_concept_RESOLVES_and_the_grounding_is_LOOKED_UP_not_claimed; test_concept_vocabulary.py::test_NO_NUMBER_IN_A_CONCEPTS_TREE_IS_THE_AUTHORS; test_concept_vocabulary.py::test_a_concept_that_screens_on_an_UNCITED_column_is_refused; test_concept_vocabulary.py::test_grounding_report_is_TOTAL_over_the_vocabulary_and_names_the_unresolved; test_concept_vocabulary.py::test_the_SENTENCE_resolve_HANDS_BACK_IS_THE_FILES_OWN_BYTES; test_concept_vocabulary.py::test_the_vocabularys_own_KEYS_are_NORMALISED_so_two_spellings_cannot_drift; test_definition_concierge.py::test_EVERY_refusal_names_a_door_and_hands_back_NO_formula; test_definition_concierge.py::test_a_proposal_that_LINTS_repainting_gets_ONE_repair_and_then_a_REFUSAL; test_definition_concierge.py::test_the_BUDGET_is_consulted_BEFORE_the_linter_which_is_how_M6_is_visible; test_definition_concierge.py::test_the_CORPUS_of_FIRM_PHRASINGS_gets_a_NAMED_OUTCOME_for_EVERY_ROW; test_definition_concierge.py::test_the_REPAINT_refusal_is_the_LINTERS_and_disappears_when_the_LINTER_alone_goes; test_frontend_deps_installed.py::test_the_frontend_manifest_is_actually_installed; test_phase_e_acceptance.py::test_the_PINE_SCREENER_PARITY_PATH__one_definition_at_every_step; test_phase_e_acceptance.py::test_the_RUN_NOW_leg_holds_the_SAME_hash_and_leaves_the_store_UNTOUCHED; test_phase_e_acceptance.py::test_the_SCAN_SURFACE_and_the_CHART_read_the_SAME_ROW; test_scan_evaluator_off_request_path.py::test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes; test_starter_library.py::test_a_DEFINITION_GROUNDED_starter_STATES_NO_NUMBER_AND_SCREENS_ON_NO_COLUMN; test_starter_library.py::test_a_RETUNED_THRESHOLD_goes_red_NAMING_THE_NUMBER; test_starter_library.py::test_every_DECLARED_starter_ACTUALLY_RESOLVES; test_starter_library.py::test_installing_a_starter_TWICE_is_ONE_definition_and_editing_it_FORKS_the_hash; test_starter_library.py::test_the_save_path_has_NO_STARTER_BRANCH__BY_AST

Final tip: the full 68-file run (`tip-failed.txt`) was taken BEFORE the helpers moved to `scan_runtime.py`; its difference
from base was 4 ids: `test_scan_evaluator_off_request_path.py::test_the_BOUNDED_module_names_the_sweep_ONLY_in_RULED_forms`,
`::test_the_run_handlers_reach_the_QUEUE_and_STOP__the_evaluator_is_past_the_pool`,
`::test_the_subject_has_no_UNCLASSIFIED_public_function` (all three FIXED by the move: that file re-run on the final code
fails only its one base test, `test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes`, whose remaining
handlers are `indicator_alerts` create_alert / get_current_value as on base) and
`test_screener_live_read_path.py::test_a_STALE_overlay_row_serves_nightly__the_dead_sweeper_contract`.
That last one reads the wall clock (regular-session hour). It passed in the base run (morning CT) and failed at 15:50 CT on the
tip AND on the BASE copies of `scan_evaluator.py`/`scan_run.py` put back with `redbase.py` (`1 failed, 25 passed`), so it is the
hour, not this lane. Not re-run as one whole-suite job on the final tip (no new heavy job); the final failing set is therefore
base (23) plus that one hour-dependent id, by the two re-runs above.

## Review round 1: daily bar time, two lanes, ONE rule needed
- W5-T14 (this lane) sends a daily bar at its session's **09:30 America/New_York open in unix seconds**:
  `scan_evaluator._runtime_bar_seconds` (about line 1516) calling `indicator_compute.bar_open_instant(iso, "D")`, the chart's
  convention (`indicators.js::barOpenInstant`); `_RUNTIME_BAR_TF` is the single constant.
- W5-T15 (`origin/feat/pine-w5-t15-backtest`, `api/routers/screener_backtest.py` ~:530-548) sends **00:00 UTC unix seconds**
  (`calendar.timegm`).
These disagree (14:30 or 13:30 UTC vs 00:00 UTC for the same session) and the same script would see different `time`/clock
columns in a scan and a backtest. The service's actual reading of `t` (W5-T7b is establishing it) decides which is right; then
ONE function should be the authority and both lanes call it. Line to change here: the body of `_runtime_bar_seconds`
(replace the `bar_open_instant` call at ~:1516 with the shared function, or with a UTC-midnight conversion if T7b rules so);
rails `test_a_daily_bar_is_sent_at_its_0930_new_york_open_in_unix_seconds` and
`test_the_utc_offset_follows_new_york_daylight_time` pin the current choice and change with it. No code changed in this round.

## Review round 2: measured failing sets (same 68 files, one hour, back to back)
`runs/w5t14/w5t14-both.py` under `heavy-final3.lock` (label `w5t14-screener`), 17:55-18:25 CT: the 68 named files on the FINAL
code tree (`final-tip-screener.log`), then the same 68 with the BASE copies of `scan_evaluator.py` and `scan_run.py` put in place
and restored byte-exact (`final-base-screener.log`). Totals: **tip 24 failed, 2666 passed; base copies 24 failed, 2666 passed.**
The two failing-id sets are **identical; the difference is empty** (`final-tip-failed.txt`, `final-base-failed.txt`). The 24 are
the 23 failures of the earlier morning base run plus `test_screener_live_read_path.py::test_a_STALE_overlay_row_serves_nightly__the_dead_sweeper_contract`
(wall-clock hour, failing on base at this hour too). Ids:
test_c45_withheld_doors.py::test_the_question_is_not_vacuous_and_can_answer_no; test_c45_withheld_doors.py::test_the_whole_series_question_per_lane[tree3-alert3-sweep3]; test_concept_vocabulary.py::test_EVERY_concept_RESOLVES_and_the_grounding_is_LOOKED_UP_not_claimed; test_concept_vocabulary.py::test_NO_NUMBER_IN_A_CONCEPTS_TREE_IS_THE_AUTHORS; test_concept_vocabulary.py::test_a_concept_that_screens_on_an_UNCITED_column_is_refused; test_concept_vocabulary.py::test_grounding_report_is_TOTAL_over_the_vocabulary_and_names_the_unresolved; test_concept_vocabulary.py::test_the_SENTENCE_resolve_HANDS_BACK_IS_THE_FILES_OWN_BYTES; test_concept_vocabulary.py::test_the_vocabularys_own_KEYS_are_NORMALISED_so_two_spellings_cannot_drift; test_definition_concierge.py::test_EVERY_refusal_names_a_door_and_hands_back_NO_formula; test_definition_concierge.py::test_a_proposal_that_LINTS_repainting_gets_ONE_repair_and_then_a_REFUSAL; test_definition_concierge.py::test_the_BUDGET_is_consulted_BEFORE_the_linter_which_is_how_M6_is_visible; test_definition_concierge.py::test_the_CORPUS_of_FIRM_PHRASINGS_gets_a_NAMED_OUTCOME_for_EVERY_ROW; test_definition_concierge.py::test_the_REPAINT_refusal_is_the_LINTERS_and_disappears_when_the_LINTER_alone_goes; test_frontend_deps_installed.py::test_the_frontend_manifest_is_actually_installed; test_phase_e_acceptance.py::test_the_PINE_SCREENER_PARITY_PATH__one_definition_at_every_step; test_phase_e_acceptance.py::test_the_RUN_NOW_leg_holds_the_SAME_hash_and_leaves_the_store_UNTOUCHED; test_phase_e_acceptance.py::test_the_SCAN_SURFACE_and_the_CHART_read_the_SAME_ROW; test_scan_evaluator_off_request_path.py::test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes; test_screener_live_read_path.py::test_a_STALE_overlay_row_serves_nightly__the_dead_sweeper_contract; test_starter_library.py::test_a_DEFINITION_GROUNDED_starter_STATES_NO_NUMBER_AND_SCREENS_ON_NO_COLUMN; test_starter_library.py::test_a_RETUNED_THRESHOLD_goes_red_NAMING_THE_NUMBER; test_starter_library.py::test_every_DECLARED_starter_ACTUALLY_RESOLVES; test_starter_library.py::test_installing_a_starter_TWICE_is_ONE_definition_and_editing_it_FORKS_the_hash; test_starter_library.py::test_the_save_path_has_NO_STARTER_BRANCH__BY_AST
(Only the off-request-path file's `test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes` remains of the earlier
extra failures; it is on base. The run also printed the harness NOTE of two reads of `c:\data\signal_ledger.db` from
`test_definition_record.py::test_the_record_NEVER_TOUCHES_the_real_ledger_file...`, identical on both sides.)

## FIX r1 (independent review NO-GO @176b78683f, `reviews/W5-T14.md`)
Base for this round: this branch merged with W5-T11 r1 (`a74e273652`..`1e384edbfe`) and then **W5-T11 r2 (`7df06fe3fd`)**.
Coordinator correction applied: the engine already NaNs its own warm-up and T11 r2 REFUSES a column with a finite value inside the
warm-up as `runtime:server-integrity` (no masking). So here, warm-up bars arrive as na (NaN), the 0/1 scan already skips na, an as-of
bar that is na is `not_computable` (never a non-hit), and a service that serves a finite warm-up value is `withheld`.
- B1 closed by rails: `test_warmup_na_bars_are_skipped_by_the_condition_check_and_the_symbol_answers`,
  `test_a_symbol_whose_whole_run_is_warmup_is_not_computable_never_a_non_hit`, `test_a_non_condition_value_AFTER_the_warmup_is_still_not_computable`,
  and `test_a_finite_value_inside_the_warmup_withholds_the_symbol_never_a_non_hit` (a tampered-but-honestly-digested reply with finite warm-up
  values: counted `withheld`, not answered, no hit, no receipt).
- N1: admission goes through T11's public `runtime_server_lane.admission(row, plot, lane)` (`scan_runtime.runtime_admission(row, lane, plot)` is a
  fail-closed wrapper; the private `_verdict` / `_admission` are no longer named here). The plot comes from `runtime_scan_spec`; the sweep filter hands
  an unscannable document on (counted `refused` by name) rather than asking for a plot it does not have. `test_admission_is_the_public_server_lane_admission_with_the_plot`,
  `test_an_admission_that_cannot_answer_admits_nothing`.
- N2: the store-key-to-service-seconds conversion is now ONE function, `scan_runtime.store_time_seconds(t)`, a light module both lanes can import.
  T15's `screener_backtest._epoch_seconds` is T15's file and is not edited here: **T15 should call `scan_runtime.store_time_seconds`** (the home is
  `api/services/screener/scan_runtime.py`; `indicator_compute.bar_open_instant` stays the one underlying authority). Rail:
  `test_the_shared_store_time_helper_is_the_one_conversion`. The "Review round 1: daily bar time" section above is superseded: T15 r1 adopted 09:30 ET.
- Scannability is asked once, in `_load_definition` (the duplicate in `submit_run` was removed; an earlier mutation showed it redundant).
- **Live mode departs from spec 5.1 text**: 5.1 says the live sweep uses profile `sweep`; this lane refuses a runtime document in the live cycle with
  `gate:cadence` (closed bars only, Q3). Desktop ruling R8 accepted the departure; `_RUNTIME_PROFILES["live"] == "sweep"` is kept for when Q3 allows it.
- **Unowned: the ruling Q2 cap of 25 runtime documents per nightly sweep (stages admins, cohort) is NOT enforced here and no T-row owns it.** It must exist
  before `PINE_RUNTIME_SERVER_STAGE` is set above `off`.
- Rails: `tests/test_scan_runtime_lane.py` 57 passed. Mutations (`runs/w5t14r1/mut2.log`, `heavy-mut.lock`): **TOTAL 40, KILLED 39, SURVIVED 1 = the no-op
  control**. New rows: N01/N02 (plot not passed to admission, door and chunk), N03/N04 (na/warm-up handling of the condition scan), M25 (an admission that cannot
  answer must refuse), and **T11a: T11's own check `if any(v == v for v in col[:wb])` in `api/services/pine_runtime_client.py` replaced by `if False:`
  goes RED on `test_a_finite_value_inside_the_warmup_withholds...` and is restored byte-exact** (`mutate_pytest.py` asserts the restore; `git status` shows
  no change to T11's file). The S05 row was dropped with the duplicate it covered.
- final-tip, LAST, on the final code tree (tip `8fa5e69a98`; later commits are this file only; `heavy-final3.lock`; `bash $S/final-tip.sh pine-dsk-w5t14 dsk-w5t14r1-final tests/test_scan_runtime_lane.py tests/test_scan_run.py tests/test_scan_evaluator_off_request_path.py tests/test_pine_runtime_client.py tests/test_runtime_server_lane.py`,
  log `runs/w5t14r1/final.log`): gate pytest **46 passed**; hygiene **clean**; named files **317 passed, 1 failed** (the failure is
  `test_scan_evaluator_off_request_path.py::test_no_route_handler_can_reach_the_evaluator__DERIVED_FROM_router_routes`, a base failure: the handlers named are `indicator_alerts`
  create_alert / get_current_value, not this lane); chart+hooks vitest **2 failed | 1333 passed | 27 skipped (1362)**, the two being exactly the baselines
  `settingsScope.rail` and `pollingSites.rail`. Engine bump: NO.
