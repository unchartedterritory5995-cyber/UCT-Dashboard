# A0 release validation: CI findings (2026-10-13)

## Candidate history

| Candidate | SHA | Change | Local tag |
|---|---|---|---|
| RC1 | `f37a754a06` | A0 code + report + flow-worker marker #17 | `indicators-a0-rc1` |
| RC2 | `0e1d42d785` | + security-suite workflow fix (Node 20.19.0, pipefail, exact `Test Files 18 passed (18)`) | `indicators-a0-rc2` |
| **RC3** | **`b8da8233f7`** | + `ci_summarize` reads a vitest totals line that carries a `todo` count | (branch head) |

Each step is one commit and touches only CI tooling. `release/indicators-a0` was fast-forwarded with the owner's approval and was never force-pushed.

## Linux security validation (PR #323, run 38440057024, head `0e1d42d785`)

| Half | Result |
|---|---|
| Python | 1,356 passed, 5 skipped, 1 deselected (Python 3.12.15) |
| Frontend | 18/18 files, 397 passed, 1 skipped (Node v20.19.0) |

On PR #322 at RC1, the same job had read green with only 2 of 18 frontend files run: Node 20.18.0 raised `ERR_REQUIRE_ESM`, and the step had no pipefail.

## PR #322 full-suite record (run 38425180250, RC1): INVALID, because of two tooling defects

The record is INVALID for two reasons. **Neither is a product failure.**

### 1. "vitest collected 0 with no totals line"

The run was **complete**. The log ends with:
- 3,354 test files: 3,303 passed, 20 failed, 31 skipped;
- 45,832 tests: 45,683 passed, 20 failed, 128 skipped, 1 todo.

**Cause:** `tools/ci_summarize.py` matched the totals line positionally (`failed | passed | skipped (N)`). Once the tree had an `it.todo` (from `227d5fa946`, 2026-10-06), it could not parse `… | 1 todo (45832)`.

**Fixed in RC3 (`b8da8233f7`):** counts are now read in any order. The self-check passes 19/19, and a replay of #322's real log reads 45,832.

**Consequence:** the "frontend suite collected 0" records since 10-06 were at least partly this parser bug, not only the 45-minute timeout A0 raised to 100. A0's completion check is what made the bug visible.

### 2. Shard `tests-10`: tests finished, then the process did not exit

| | Linux CI, RC1 | Clean master `fdba4c997d`, Windows, same 171 files |
|---|---|---|
| pytest summary | 30 failed, 3,402 passed in 676.7 s | 28 failed, 3,395 passed in 950 s |
| process lifetime after the summary | killed by the 20-minute shard cap | **~692 s** (wall 1,642 s) |
| noise after the summary | ~128k lines | 7,436 `FINNHUB_API_KEY not set` lines |

**Conclusions:**
- The shutdown hang **predates A0** and **reproduces on clean master**.
- The test results were complete and are reported above.
- No A0-related failure was found:
  - against the master run on A0's own base (`1eba7c105c`), A0 **fixed 6 modules** and added 1 "new" failure, `test_massive_ws_stop`;
  - that test is flaky: it failed in 6 of 8 runs on the candidate and 6 of 6 on clean master, and A0 does not touch it.

## For the `api/main.py` owner: the test process does not exit

**Observed:**
- After the test session ends, a warm-up started by `api/main.py` startup work keeps running. The trace shows `_start_industry_map_background` → `_delayed` → `industry_map.prewarm()` → `warm_universe_gaps()` → `_fetch_fallback()` → `fh_get('/stock/profile2')`.
- It runs once per universe ticker, logging "FINNHUB_API_KEY not set" into a closed stream, and adding a "--- Logging error ---" traceback per call.
- The interpreter stays alive for about 11 minutes after pytest's summary.
- The thread itself is created `daemon=True`, so something else in that path keeps the process up until the loop finishes. Likely candidates are an executor's atexit join, or logging's shutdown handlers.

**Effect:** any pytest shard that imports `api.main` and finishes its tests in more than about 8 minutes overruns the 20-minute shard cap. The shard is then recorded as not finished, and the whole full-suite record reads INVALID.

**Suggested direction (not done here):**
- Skip the startup warmers under test, using an env flag the test harness sets; or
- make `warm_universe_gaps` stop on a shutdown event when the Finnhub key is absent; or
- have `fh_get` short-circuit the whole gap warm when no key is configured.

Outside A0's scope. No A0 code touches this path.
