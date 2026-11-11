# PR: fix the master deploy gate (F16 Screener rail and field-catalog snapshot)

Branch `agent/pl/fix-gate-screener-pins`, cut from origin/master `5830daa80f`, then merged with origin/master `ac3ce7ebc9`.

**Merge note:** while this was in flight, #1066 (`ac3ce7ebc9`) re-pinned `SCREENER_PIN` to `7c09a4d303` (the #1021 merge)
and regenerated the same snapshot. The merge was clean. This branch's `screener-fields.json` is byte-identical to
#1066's, so after the merge the snapshot is not in this PR's diff. The pin is now master's `7c09a4d303`. It has the same
merge base with the F16 head (`292983f4bc`) as `1a26d4ea00` did, so the rail reads the same F16 change set. What this PR
still adds is the end of the rail, fixed at `F16_HEAD` instead of HEAD, so the next Screener PR needs no re-pin.
The real-history control (`test_the_guard_can_say_no`) runs at `7c09a4d303~1..7c09a4d303` and names filters.py.

## Cause

Master's deploy gate went red on gate runs 42955187848 (`fd2f9acf2c`) and 42956583293 (`b786232486`). The last green run was 42952281547 (`2b201b5dc7`). Both failures came from #1021 (`7c09a4d303`, the RS split, another team), which changed the member Screener on purpose:

1. `tests/test_uct_agent_qa_f16.py::test_the_member_screeners_own_server_code_is_untouched_by_the_F16_work`
   diffed the Screener's server files from `SCREENER_PIN` to **HEAD**. Any later Screener change by any team broke it.
   At master, `git diff --name-only 1a26d4ea00...HEAD -- <screener paths>` lists filters.py, identities.py,
   methodology.py, rs_history.py, snapshot_builder.py and snapshot_db.py. All six come from #1021.
2. `tests/test_uct_agent_qa_scan_corpus.py::test_the_field_catalog_snapshot_is_current`: #1021 added a field to
   `filters.field_catalog()`, so the checked-in snapshot `screener-fields.json` no longer matched.

## Fix

1. The rail now checks only the F16 change set, which cannot change. It compares `SCREENER_PIN` with #1029's own PR
   head `F16_HEAD = 523fa4e0122dc614106c14fed9785395c7dd99cc` (a full SHA, never a ref) instead of HEAD.
   `git diff --name-only 1a26d4ea00...523fa4e012 -- <screener paths>` is empty, so the F16 work did not touch the
   Screener. Later Screener PRs no longer need a re-pin to keep this rail green.
   - The honest skip is kept for both the pin and the F16 head when a shallow checkout lacks them.
   - The existing pin-shape tests are kept. So is the real-history control (`test_the_guard_can_say_no`).
   - New `test_the_rail_compares_against_the_fixed_F16_head_never_HEAD`: a spy confirms the git argument is
     `<pin>...523fa4e0…`.
   - New CONTROL `test_CONTROL_the_rail_fails_if_the_F16_head_had_touched_a_screener_file`: a fake diff naming
     `api/services/screener/filters.py` makes the verdict non-empty, so the rail's assertion fails. A git failure
     (exit 128) raises and is never read as "untouched".
2. Regenerated `screener-fields.json` with `python -m tests.test_uct_agent_qa_scan_corpus --write-baseline`.
   The semantic diff covers keys and every attribute of every field:
   - **added: `rs_rating_9m`** ("9M Return Rank", range, relative_strength). 231 fields became 232.
   - **reordered inside the RS group only:** `rs_rating_1m/3m/6m/9m/12m` and `rs_rating_chg_20` now follow
     `rs_line_trend`, and `rs_benchmark_agree` moves after `rs_rating_chg_5`. This matches #1021's `filters.py` hunk exactly.
   - removed: none. Changed attributes on existing fields: none. Order outside the RS group: unchanged.
   - `discovery-baseline.json` and `discovery-fastpath-baseline.json` were rewritten by the same command. Their content
     did not change (only line endings, which were reverted). Routing numbers did not move.
   - The fast-path measurement step was `npx vitest run src/agent/qa/fastPathCorpus.test.jsx` in check mode, without
     UPDATE_QA_FASTPATH, run against the new catalog. 33/33 passed, so `fastpath-candidates.json` is already current
     and nothing needed rewriting.

## Evidence (local, BelowNormal priority)

- `pytest tests/test_uct_agent_qa_f16.py tests/test_uct_agent_qa_scan_corpus.py`: 53 passed, 0 skipped. The real
  rail ran because this worktree holds both commits.
- `vitest src/agent/qa/fastPathCorpus.test.jsx`: 33 passed.
- `pytest tests/test_uct_agent*.py` (103 files, on the merge with origin/master `ac3ce7ebc9`): **4105 passed, 0 failed**. The pre-merge run had one failure, `test_uct_agent_knowledge.py::test_r751_mentions_mode_only_serve_flagged_re_admits` (policy mode read back as `withhold`). That file is untouched here, its 180 tests pass on their own, and it passed in the merged full run, so the failure is order- or timing-dependent and not caused by this PR.

## Files (git diff --name-only origin/master...HEAD)

- (screener-fields.json: identical to #1066, so it is no longer in the diff after the merge)
- docs/agent/program/PR-fix-gate-screener-pins.md
- tests/test_uct_agent_qa_f16.py

## SAT-1 follow-up (gate red on 12818d811c, browser shard 3/4)

`src/agent/agentScanSat1Requests.test.jsx` failed with "the captured planner requests moved". Master fixed it with
#1069 (`c85f7e5e3f`, merged as `381f91acbd`). This branch is merged with `381f91acbd` and needs **no further
regeneration**: in check mode (no UPDATE_SAT1_REQUESTS) the test passes 62/62.

I attributed every change between 12818d811c's stored `api/services/uct_agent/scan/sat/section_b_requests.json` and
the current one, which the passing check run shows matches a fresh capture, using a structural JSON diff at the leaf level:

| Where | Count | Change | Commit |
|---|---|---|---|
| `requests/*/context/screener/0/fields` | 30 of 30 non-null requests | `+rs_rating_9m:9M Return Rank`; nothing removed; existing labels unchanged | #1021 (new field) |
| same strings | 30 | RS group reordered: `rs_rating_1m/3m/6m/9m/12m`, `rs_rating_chg_20` now follow `rs_line_trend`; `rs_benchmark_agree` moved after `rs_rating_chg_5`. Order outside the RS group unchanged | #1021 (`filters.py` catalog reorder) |

- Total leaf differences: 30, all in the field string above.
- Manifests, routing, message, capabilities refs, reroute bodies, corpus_version and the null-request count are all unchanged.
- #1029 contributed nothing: no chip or refusal-block change appears.
- No expected outcome changed. `git diff 12818d811c origin/master -- api/services/uct_agent/scan/eval` is empty, so the
  SAT corpus, its answers and its refusals did not change. Only the captured planner request (catalog field text) moved.

Re-verified on this branch at BelowNormal:
- `vitest agentScanSat1Requests.test.jsx`: 62 passed.
- `pytest test_uct_agent_scan_sat_section_b.py`, `test_uct_agent_spend_protection.py` (the readers of the capture),
  `test_uct_agent_qa_f16.py` and `test_uct_agent_qa_scan_corpus.py`: 128 passed.
