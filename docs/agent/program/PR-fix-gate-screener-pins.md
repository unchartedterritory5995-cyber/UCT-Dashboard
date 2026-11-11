# PR: fix the master deploy gate (F16 Screener rail and field-catalog snapshot)

Branch `agent/pl/fix-gate-screener-pins`, cut from origin/master `5830daa80f`.

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
- `pytest tests/test_uct_agent*.py`: see the PR comment or the Lead's report.

## Files (git diff --name-only origin/master...HEAD)

- app/src/agent/__fixtures__/program/scores/screener-fields.json
- docs/agent/program/PR-fix-gate-screener-pins.md
- tests/test_uct_agent_qa_f16.py
