# Lookback oracle made deterministic (fix/lookback-oracle-deterministic)

Code tip: da1f6b7b5b. Test infrastructure only. Engine bump: no.

## Problem
`lookbackAgreement.test.js` walked the corpus with `budgetMs: 3000` and kept whatever trees a script
had finished when the clock ran out. So the tracked oracle `tools/lookback_agreement.json` changed with
machine load: `distinct_trees_walked` was 608, 607 and 605 on one commit, and final-tip's integrity check failed.

## Fix
- `translateUnit` passes the translator a clock that never advances (`now: () => 0`, ruling R3). Only the
  step cap (`PINE_TRANSLATE_MAX_STEPS`) and the depth bound can end a walk. Both count work, not time,
  so a script at the edge stops on the same step on every machine. The budget was not widened.
- All or nothing: if a script+lane walk ends in `pine:timeout` (the top-level refusal, the refusal list, or
  one output's refusal), it contributes no tree. It is named in the new sorted field `timed_out`
  (additive, `version` stays 1).

## Result
`distinct_trees_walked` goes from 608 to 594 BY DESIGN: the excluded scripts had contributed partial,
wall-clock-dependent tree sets. The 146 exported rows are unchanged.

The 7 `timed_out` units:
- corpus/cc-yata__bd898a1af0.pine [host]
- corpus/cc-yata__bd898a1af0.pine [screener]
- corpus/momentum-based-zigzag__38d39d2d6c.pine [host]
- corpus/parabolic-sar__xoeoPMOWGJ.pine [host]
- corpus/parabolic-sar__xoeoPMOWGJ.pine [screener]
- corpus/smoothed-gaussian-trend-filter-algoalpha__69de2e99a0.pine [host]
- corpus/smoothed-gaussian-trend-filter-algoalpha__69de2e99a0.pine [screener]

## Proof
- Determinism: the oracle sha256 was ff61ca98a0edf5bd... on every run: 3 normal runs, 1 at 83% CPU from
  8 busy-loop processes (122 s instead of 85 s), and the restored file after the 8 mutation runs, then final-tip.
- Rails (JS): fold control, timeout-detector control, a leaping-clock control, no tree from a timed-out
  unit, every unit classed consistently, and no timeout decided by the clock. Python twin:
  `test_no_timed_out_script_contributes_a_tree` (`timed_out` sorted, no row from a listed unit).
- Mutations (mutate.py, heavy-mut.lock): 7 of 7 killed; the no-op control survived.
- Also run: test_ast_lookback_agreement.py + test_vendor_capture_window.py 25 passed, contractVersions 4/4,
  pine_contract_coverage.py 0 defects.
- Final-tip, FULL (heavy-final2.lock, runs/lookback-det-final2): gate 0, hyg 0, py 0, integrity=ok,
  Test Files 7 failed | 1370 passed | 28 skipped. All 7 failures are on the baseline allowlist.
  A first attempt was stopped by Claude Code for low system memory during gate pytest. It was discarded.
