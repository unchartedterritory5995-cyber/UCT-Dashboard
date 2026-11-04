# W5-T16 Rule record - evidence

Branch `feat/pine-w5-t16-rule-record`. Spec: SERVER-RUNTIME-DESIGN.md section 7 row T16 and the 5.1 row.
Code tip (before this evidence commit): `c2afcfb06c`. Base: merge commit `e5ed2f5c76` = W5-T11
`86218da704` + `git merge --no-ff origin/master` (`9bfd567837`; tested-on-master `9bfd567837`).

## What changed
- `api/services/definition_record.py`: new `record_runtime_pass(rev, tf, sym, *, row, plot_key, bars,
  params=None, column_fn=None, at=None)` beside `record_pass`.
  - `def_hash` is DERIVED: `runtime_definitions.handle(row["definition"])` minus its `runtime:` prefix
    (so it is a `sha256:<64 hex>` result identity). There is no `def_hash` parameter (TypeError).
  - The run goes through T11's `runtime_server_lane.runtime_column_fn(row, plot_key, "record")`, or a
    `column_fn` a caller hands in. A `ServerLaneWithheld` is not raised: nothing is recorded and
    `skipped` is the lane's own `guard: sentence`.
  - The warm-up pad is the RUN's: the column carries `.warmup = {"withheldBars": n}` (what
    `runtimeWarmupOf` returns). Missing or malformed (non-dict, bool, negative, float, string, absent
    key, larger than the bar count) means nothing is recorded and `skipped` starts with
    `runtime:warmup-unreported`. Never guessed.
  - Forward-only origin: `record_evaluation` is called unchanged (batch gate `before_origin`).
  - `_tally` extracted from `record_pass` so both passes share ONE tally (no behaviour change; the
    existing 8-section `test_definition_record.py` is green).
  - `RUNTIME_REFUSALS` (`not_runtime`, `column_shape`), pairwise distinct from `REFUSALS`.
- `tests/test_definition_record_runtime.py`: 25 tests.

## SCHEMA GAP (report to T6/T11 owners; their files untouched)
`pine_runtime_client.JobResult` has no warm-up field and `_RESULT_KEYS` rejects any extra key on the
wire, so the shipped `runtime_column_fn` returns a plain list with no warm-up. Until T6/T7 report the
warm-up and T11 surfaces it (as `.warmup` on the returned column, or tell me another shape), every real
run is refused by name (`test_schema_gap_the_shipped_lane_reports_no_warmup_so_the_record_refuses`).
Also noted from T11: T7 results carry no digest.

## Rails (red on base, green on tip)
- Base (`e5ed2f5c76`): `git show HEAD:api/services/definition_record.py | grep -c record_runtime_pass` = 0
  before the commit, so every test in the new file errors (`AttributeError`) on base.
- Tip: `python -m pytest tests/test_definition_record_runtime.py` -> 25 passed.

## Mutation table (each applied to `definition_record.py`, restored byte-exact; run under
`heavy-mut.lock`, labels w5t16-mut and w5t16-mut2; script outside the repo)
| mutation | killed by |
|---|---|
| pad ignored (0) | test_records_with_the_runs_own_warmup_pad |
| warm-up guard removed | test_a_run_with_no_warmup_is_refused_never_guessed |
| bool warm-up accepted | test_a_malformed_warmup_is_refused[bool] |
| warm-up upper bound dropped | test_a_malformed_warmup_is_refused[6 > bars] |
| warm-up lower bound dropped | test_a_malformed_warmup_is_refused[-1] |
| def_hash fixed constant | test_records_with_the_runs_own_warmup_pad |
| column length unchecked | test_a_column_that_is_not_one_value_per_bar_is_refused |
| is_runtime check removed | test_a_row_that_is_not_a_runtime_document_is_refused |
| ServerLaneWithheld not caught | test_a_withheld_lane_records_nothing_and_says_why |
| zero-evaluated row written | test_no_computable_bar_writes_nothing |
| lane "record" -> "alert" | test_default_lane_is_the_record_profile |
| forward-only origin gate off | test_forward_only_origin_still_enforced |

12/12 killed, 0 survivors. (The first run's "wrong lane" edit hit a docstring copy and was redone on the
code line by hand: killed.)

## final-tip
`bash $S/final-tip.sh pine-dsk-w5t16 dsk-w5t16-final tests/test_definition_record_runtime.py
tests/test_definition_record.py tests/test_runtime_server_lane.py` under `heavy-final3.lock`, code tip
`c2afcfb06c` (this evidence file was the only untracked path), tested-on-master `9bfd567837`.
- gate pytest: 46 passed. hygiene: clean. rails pytest: 139 passed (new 25 + existing
  test_definition_record + test_runtime_server_lane; no difference vs base in the existing ones).
- full chart+hooks vitest: 2 failed files | 1333 passed | 27 skipped (1362): `settingsScope.rail`
  and `pollingSites.rail`, both the declared baselines.
- Log: `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/w5t16-final.log`.

## Engine bump
No. Python service only; no engine file touched.
