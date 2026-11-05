# W5-T17 Composition + stamps - evidence (2026-11-04)

Branch `feat/pine-w5-t17-stamps`, base (tested-on-master) `09453ca1a3`. Engine bump: NO (no
script-engine output change; SCRIPT_ENGINE_VERSION untouched). No flag set or changed.

## What changed
- `api/services/runtime_definitions.py`: `validate` rejects a runtime document carrying
  `meta.blockRuns` (design 5.2 step 5); `request_reads(definition)` = the runtime requirements
  read (non-identity `request.*`, from the repaint classifier's own reads; unreadable fails closed).
- `api/services/user_definitions.py`: `server_lane_composition(row, consumer=, lane=)` = design 5.2
  steps 1-4 in order (definition, stored verdict `engine_withheld_reason`, `consumer_refusal`,
  `server_lane_refusal`), never raises, never reaches the service; `server_lanes_stamp`;
  `_awaits_retranslation` answers False for runtime (and no longer relies on `compute.kind=="ast"`);
  `consumer_refusal(consumer, requirements, definition=None)` reads a runtime document's `request.*`.
- `api/routers/user_definitions.py::_stamped`: runtime rows get `server_lanes: {alerts, screener,
  scans}`, each `true` or `{guard, sentence}`. `ast` rows carry no key.
- `tests/test_runtime_definitions.py:75`: the existing `not_graded` stub now accepts `graded_only`
  (the stamp reaches `server_lane_refusal` for a killed row on the list route).

## Rails (tests/test_pine_runtime_composition.py, 39 tests)
- Base (`git archive origin/master` + the test file, `--noconftest`): 31 failed, 8 passed (8 = tests of
  existing behaviour/controls). Tip: 39 passed.
- Tip run: 
  `python -m pytest tests/test_pine_runtime_composition.py ...` in final-tip: 566 passed, 1 failed
  (`test_runtime_definitions.py::test_KILL_is_never_a_delete...`, a stub signature; fixed in the
  next commit, rerun alone: `tests/test_runtime_definitions.py` 45 passed).

## Mutations (pytest mutator, byte-exact restore, pycache cleared, 15/15 killed)
| mutation | killed by |
|---|---|
| M1 validate drops blockRuns rejection | test_a_runtime_document_carrying_block_runs_is_rejected_at_save |
| M2 step 1 blockRuns refusal removed | test_the_first_refusal_wins...[1-definition] |
| M3 step 2 stored verdict removed | ...[2-withheld] |
| M4 step 3 consumer contract removed | ...[3-requirements] |
| M5 step 4 admission removed | ...[4-runtime:server-unavailable] |
| M6 steps 2 and 3 swapped | ...[2-withheld] |
| M7 unreadable row check removed | test_an_unreadable_row_is_refused_at_step_one... |
| M8 _awaits_retranslation runtime branch removed | test_a_runtime_row_never_awaits_retranslation |
| M9 consumer_refusal runtime read removed | ...[3-requirements] |
| M10 router stamp removed | test_a_runtime_row_is_stamped_true_on_all_three_lanes |
| M11 scans lane uses alert profile | test_each_lane_asks_its_own_consumer |
| M12 screener lane uses alert profile | test_each_lane_asks_its_own_consumer |
| M13 unreadable source fails open | test_a_runtime_document_with_an_unreadable_source_fails_closed |
| M14 request reads dropped | ...[3-requirements] |
| M15 stamp collapses refusal to bool | test_a_refused_lane_is_stamped_with_guard_and_sentence |
Steps 1-4 run under a socket guard (no network); no survivors, no equivalents.

## Stub change at tests/test_runtime_definitions.py:75
`test_KILL_is_never_a_delete...` fakes `rt.not_graded` so an ungraded script does not mask the kill
it tests. The fake was `lambda source: None`. The real `server_lane_refusal` calls
`not_graded(source, graded_only=True)`, and the router's `_stamped` (list route) now reaches it for a
runtime row, so the fake raised TypeError. The fake now takes `graded_only=False` and still returns
None: the same intent (not_graded never refuses), assertions untouched. No production behaviour for
`ast` rows changed: `_stamped` adds `server_lanes` only when `is_runtime(definition)`, and the diff
against the base touches no `ast` code path (6 files, no app/ file).

## final-tip FINAL TREE (tip c1cb5d43ac, lock heavy-final3 label w5t17-final2, logs `runs/dsk-w5t17-final2/`)
gate pytest 46 passed; hygiene clean; rails pytest 567 passed, 0 failed; chart+hooks vitest 1332
passed, 2 failed = known baselines: `pollingSites.rail`, and `settingsScope.rail` rule 1, whose
offender is `app/src/lab/StudyChart.jsx:32 <StockChart> passes settingsOverride without
onSettingsPersist` (a static scan of a file this branch does not touch).

## final-tip (earlier tip c3ffe23737, lock heavy-final3, logs `_resume-2026-11-01/runs/dsk-w5t17-final/`)
gate pytest 46 passed; hygiene clean; rails pytest 566 passed + 1 failed (fixed after, above);
full chart+hooks vitest: 1332 passed, 2 failed = baselines `settingsScope.rail`, `pollingSites.rail`.
Mutation log: lock heavy-mut, label w5t17-mut.

## Open
- Step 6/7 (service run, transport) belong to T11/T13; callers of `consumer_refusal` in T13/T14
  files still pass no `definition` (they will use `server_lane_composition`).
- `server_lanes` for `ast` rows deliberately absent (per-plot gates have no row-level answer).

## r1 (review note N1)
`_awaits_retranslation` had dropped `compute.kind == "ast"`, so a non-ast, non-runtime document could
disagree with the browser's `isScriptDocument`. The kind check is restored; the explicit runtime
branch stays as a documented guard. **M8 (runtime branch removed) is now an EQUIVALENT survivor**:
a runtime document's `compute.kind` is "runtime", so the restored `kind == "ast"` check already
returns False; with M8 applied the composition rail is 39 passed. Re-run after the change:
`tests/test_pine_runtime_composition.py` + `tests/test_user_definitions.py` 90 passed. The other 14
mutations are unaffected. Final-tip re-run last on the final tree: see the numbers in the r1 report
(logs `runs/w5t17r1/`).

r1 final-tip on 3c0e41e14c (final code tree), label w5t17r1-final, logs runs/w5t17r1/: gate 46 passed, hygiene clean, rails pytest 567 passed 0 failed, vitest 1332 passed / 2 failed (baselines pollingSites.rail and settingsScope.rail, StudyChart.jsx:32).
