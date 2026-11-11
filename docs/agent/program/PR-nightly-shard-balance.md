# PR: nightly full-suite shards balanced by measured time

Branch `agent/pl/nightly-shard-balance`, cut from `origin/master` `ff89106cb9`.

## Problem

Every scheduled run of `.github/workflows/full-suite-report.yml` since at least 10-31 ended
`cancelled`. `tools/pytest_shards.py` split the loose root test files into 12 alphabetical
buckets of equal FILE COUNT (~224 each). Equal count is not equal time: `tests-10` carried
5,393 tests, took 33 min locally and was 23% done at 18 min on CI, so the job hit its
20-minute cap. No single test hangs.

## Fix

1. **Root buckets are cut by measured time.** The buckets stay contiguous and alphabetical
   (a shard id still names its files; neighbours change only at cut points), but the cut
   points sit on the cumulative per-file seconds in `tools/pytest_shard_timings.json`.
   - The timing file is the junit `testcase time`, summed per file, from the last completed
     master runs on the `ci-results` branch (newest run wins per file): 42846929317,
     42667161827, 39359919798, 39268009327, 39234331153. Stored as integer ms, sorted, so the
     plan is a pure function of the file's bytes.
   - Files with no recorded time (new files, or files whose shard never finished) weigh the
     p90 recorded per-file time (6.14 s), the "fall back to file count" rule with a unit in
     seconds. Coverage today: 2,514 of 2,686 root files are timed (93.6%).
   - The planner uses the smallest bucket count (floor 12, ceiling 40) whose largest bucket is
     at or under 600 s. Today that is 15.
   - If the timing file cannot be read, the plan falls back to 24 file-count buckets and the
     plan step prints a warning.
   - Refresh: `python tools/pytest_shards.py --record-timings <junit>... --source "<run>"`,
     newest run first.
2. **Rail.** No planned shard may exceed 720 s of recorded plus estimated time
   (`SHARD_RAIL_S`). `--self-check` keeps the partition proof (union = all files, pairwise
   disjoint, mutation controls) and adds: the timing file loads, covers at least 85% of root
   files, no shard is over the rail, the plan is deterministic, and the rail refuses both
   this plan with the rail set 1 s under its own maximum and the old 12-bucket count plan.
3. **Cap 20 → 30 min, as headroom only.** Wall time over recorded time measured 1.11 to 1.45
   per shard on runs 42667161827 and 42846929317, so a shard at the rail is about 17 min
   plus setup.
4. The workflow passes `--timings tools/pytest_shard_timings.json` explicitly, so
   `ci_inventory.suite_harness_files` counts a timing refresh as a harness change. That
   matters because the timing file decides which tests share a process.

## Planned shards, before and after

Recorded = junit seconds. Est = recorded plus untimed × 6.14 s. These are not wall times.
The `dir-*` shards don't change (largest is `dir-fundamentals_pit` at 228 s).

| before | files | recorded s | est s | untimed | | after | files | recorded s | est s | untimed |
|---|---:|---:|---:|---:|---|---|---:|---:|---:|---:|
| tests-01 | 224 | 641 | 641 | 0 | | tests-01 | 145 | 547 | 547 | 0 |
| tests-02 | 224 | 322 | 346 | 4 | | tests-02 | 344 | 527 | 552 | 4 |
| tests-03 | 224 | 517 | 523 | 1 | | tests-03 | 212 | 529 | 535 | 1 |
| tests-04 | 224 | 470 | 470 | 0 | | tests-04 | 267 | 571 | 571 | 0 |
| tests-05 | 224 | 703 | 709 | 1 | | tests-05 | 181 | 517 | 529 | 2 |
| tests-06 | 224 | 762 | **799** | 6 | | tests-06 | 120 | 530 | 555 | 4 |
| tests-07 | 224 | 609 | **1254** | 105 | | tests-07 | 132 | 219 | 557 | 55 |
| tests-08 | 224 | 455 | 492 | 6 | | tests-08 | 83 | 243 | 544 | 49 |
| tests-09 | 224 | 614 | 626 | 2 | | tests-09 | 170 | 517 | 554 | 6 |
| tests-10 | 224 | 970 | **1259** | 47 | | tests-10 | 184 | 515 | 528 | 2 |
| tests-11 | 224 | 697 | 709 | 2 | | tests-11 | 188 | 533 | 552 | 3 |
| tests-12 | 222 | 407 | 407 | 0 | | tests-12 | 101 | 370 | 566 | 32 |
| | | | | | | tests-13 | 118 | 445 | 543 | 16 |
| | | | | | | tests-14 | 167 | 558 | 558 | 0 |
| | | | | | | tests-15 | 274 | 544 | 544 | 0 |

Before: 4 root shards were over the 720 s rail, with a worst case of 1,259 s. After: none
are over, and the worst is 571 s. Total jobs go from 22 to 25 (`max-parallel` stays 6).

## Collection errors no longer abort a shard (AUDIT condition)

`tests/test_notebook_fin_walk_followup_group.py`, `test_notebook_fin_walk_page_layouts_group.py`
and `test_notebook_p5_walk.py` fail to collect on CI (`No module named 'playwright'`). Until
now pytest then stopped the whole shard ("Interrupted: 3 errors during collection"). In every
recorded run, old `tests-07` ran 3 testcases in about 90 s, so its other ~220 files never ran.

The shard's pytest command now passes `--continue-on-collection-errors`. Each collection
error is still reported as an ERROR for its file: in the junit as an `<error>` testcase, in
the totals line (`N errors`), and through a non-zero exit. The other files in the shard
still run. The rail is a real pytest subprocess over a temp tree with one file that fails
to import and one passing test:
- With the flag, the passing test runs, the error is reported by file in both the junit
  and the totals line, and the exit is non-zero.
- Without the flag (the control), the passing test never runs.
- A third test pins the flag on the workflow's Run step.

**Expected on the first run: many NEW failures.** The ~220 files that haven't run in weeks
(old `tests-07` minus the three broken ones) will show their real failures for the first
time. The gate will report those as NEW. That is accurate and expected, not a regression
from this PR. Their run time is also estimated rather than measured (they never ran). After
the first completed nightly, refresh the timing file from it.

### Does the gate count a collection error as a finding? Yes (read from the code)

- `ci_extract.failures_from_junit` reads every `<testcase>` with a `<failure>` **or
  `<error>`** child. A collection error's testcase has an empty classname, so it becomes
  `? | tests.test_notebook_p5_walk | collection failure` in `pytest_failures.txt`. That line
  is in run 42846929317's published record today.
- `ci_inventory.failing_keys` makes each such line a key, `("pytest", "?",
  "tests.test_notebook_p5_walk")`. `diff()` places it in NEW or UNCHANGED like any other
  failure. It is never treated as absent. The three keys already sit in the baseline and
  read UNCHANGED, and `--continue-on-collection-errors` produces the same keys.
- `ci_summarize` counts `N errors` on the totals line as `errored`. No INVALID rule fires on
  errors > 0. The totals line is still printed, so `shards_without_totals` stays empty.
- Small gap, not this PR's scope: when a collection error is later **fixed**, its `?` key
  can never appear in `ran_keys`, because the file's real testcases carry a real classname.
  `diff()` will then call it MISSING rather than FIXED. This is the pytest version of
  F-CI-41. Minimal fix: in `diff()`, also resolve a gone key `("pytest", "?", <module>)` to
  FIXED when `<module>` (or `<module>.<Class>`) is among `ran_classnames`.

## Tests

- `tests/test_pytest_shards_balance.py`: 19 tests (partition, rail, rail can fire, old plan
  refused, contiguity, determinism, canonical timing bytes, synthetic heavy-file cut,
  untimed fallback, missing or corrupt timing file, junit recording, 30-min cap, timing path
  passed everywhere, collection-error continue with its no-flag control, flag on the Run
  step).
- `tests/test_ci_cost_rails.py`: 6 passed. Together: 25 passed.
- Removing `--continue-on-collection-errors` from the workflow turned the flag rail red.
  Restored from a saved copy.
- `tests/test_ci_inventory_vitest_shards.py`: 12 passed.
- `python tools/pytest_shards.py --self-check`: PASS.
- Proved able to fail: forcing the old 12-bucket count cut and dropping `--timings` from the
  Run step turned 3 of the new tests red, and the self-check reported FAIL
  (`tests-06`, `tests-07`, `tests-10` over the rail). Both files were restored from saved
  copies.
- No full pytest run (PC stability rule).

## Files (from `git diff --name-status origin/master`)

```
M	.github/workflows/full-suite-report.yml
A	docs/agent/program/PR-nightly-shard-balance.md
A	tests/test_pytest_shards_balance.py
A	tools/pytest_shard_timings.json
M	tools/pytest_shards.py
```

No other workflow changes. The required-checks branch is untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
