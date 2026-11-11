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

(r0's schema-gap section is superseded: T11 r1/r2 carry the warm-up as `RuntimeColumn.warmup`.)

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

## r1 (FIX after NO-GO @5a85b9b23f) - base now T11 r2 `7df06fe3fd` merged (merge `3c80b4e212`), master `9bfd567837`
- B1: the pass asks the service in the bars-store CODE. `_service_tf(label)` inverts
  `ledger._BARS_STORE_TF_KEYS` (the one authority; `scan_store._TF_CODE_BY_LABEL` is the same inverse);
  the record key keeps the label. Rails: `test_the_service_is_asked_in_the_bars_store_code_not_the_record_label`
  (all 8 labels, through the real client and T11's fake; the job's tf is asserted from the fake's recorded call),
  `test_every_record_label_has_exactly_one_code`.
- B2: merged T11 r2. The schema-gap test is now the positive end-to-end rail
  `test_the_real_lane_records_with_the_runs_own_warmup` (fake `withheld_bars=3`, NaN in [0,3): evaluated n-k,
  first bar = bars[k]).
- B3: `def_hash` = `runtime_definitions.handle(definition)` (the `runtime:sha256:` key T14's `scan_runtime`
  files the same document under), no stripping, no retyped prefix. The tree shape stays `_HASH_RE is user_definitions.RESULT_IDENTITY_RE` (r2: `test_semantics_consumers.py:118`
  rail); the runtime shape is `_runtime_key_re()` derived from `HASH_PREFIX`, and `_key_shape_ok` admits exactly
  those two. Rail `test_the_runtime_record_key_is_the_scan_lanes_handle`. NOTE: `api/routers/definition_record.py` refuses non-ast documents by name (400) before any regex,
  so runtime records are unreachable through it (out of scope, not touched).
- Mutations (driver committed: `mutate_r1.py`, heavy-mut.lock, log `dsk/w5t16r1-mut.log`): 18/18 killed (r2 re-run, log `dsk/w5t16r2-mut.log`; adds runtime key shape, tree-shape-is-a-copy, tree identity dropped) -
  label-as-tf, `_service_tf` identity, pad ignored, warm-up guard/bool/upper/lower, def_hash constant,
  def_hash stripped, shape refuses namespace, column length, runtime check, withheld uncaught, lane
  record->alert, zero-evaluated written, forward-only origin off.
- Tests: `tests/test_definition_record_runtime.py` 35 passed (+ `test_runtime_server_lane.py`: 78 together).
- final-tip (tree `d7d3b1c07c`, tested-on-master `9bfd567837`, heavy-final3.lock): gate pytest 46 passed; hygiene
  clean; rails pytest 165 passed (3 named files); full chart+hooks vitest 2 failed | 1333 passed | 27 skipped,
  the failures being the declared baselines `settingsScope.rail` and `pollingSites.rail`. Log `dsk/w5t16r1-final.log`.
  (This line is the only change after the tested tree.)
- Engine bump: no.

## r2 (FIX after delta NO-GO): one authority per key shape
`_HASH_RE` is again `user_definitions.RESULT_IDENTITY_RE` (the object; `tests/test_semantics_consumers.py:118`
passes). The runtime shape lives once, `_runtime_key_re()`, derived from `runtime_definitions.HASH_PREFIX`;
`_key_shape_ok` admits those two. Rails: `test_one_authority_per_key_shape`,
`test_a_malformed_runtime_key_is_refused_by_the_shared_door`. Test files naming a changed symbol (grep of
`tests/`): test_definition_record_runtime.py, test_runtime_server_lane.py, test_semantics_consumers.py (plus the
existing test_definition_record.py); all four go in final-tip. The router refuses non-ast docs by name (400)
before any regex, so runtime records are unreachable through it (out of scope).

r2 final-tip (tree f0226daf9c, tested-on-master 9bfd567837, heavy-final3.lock, log dsk/w5t16r2-final.log): gate pytest 46
passed; hygiene clean; rails pytest 191 passed (test_definition_record_runtime, test_definition_record,
test_runtime_server_lane, test_semantics_consumers); vitest 2 failed (baselines settingsScope.rail,
pollingSites.rail) | 1333 passed | 27 skipped.
