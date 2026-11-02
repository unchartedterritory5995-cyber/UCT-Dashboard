# I2 "Honest Imports": combined release candidate (#577 + #590)

**Status, 2026-11-01:**
- **#577:** approved for coordinated release review.
- **#590:** approved for final code review. **Production promotion is on HOLD** until the owner's
  thinkorswim comparison is done.
- Nothing is merged or deployed. #573 (IC-1) and #516 (TC2000 STOC) stay on HOLD.

## 1. Exact commits

**#577, `feat/indicators-import-verdict`, head `99cc7c2d0f`** (base `f4fb9cab45`; 8 files, +878 / −6)

| Commit | What |
|---|---|
| `19bbd9c9ff` | `importVerdict.js` + `importVerdict.test.js`: the four-class verdict (values / visuals / inputs / behaviour) with a closed note registry. "Exact" applies only to native formulas. Pine is passed through. |
| `1e4c969121`, `686105dc87`, `26d3fc7825` | Docs: status, the Pine coordination note with its corrected snippet, and the recorded decision |
| **`7a503b07f3`** | **The owner-authorized `PineBox.jsx` change:** additive and non-Pine only. Includes `pineBoxImportVerdict.test.jsx`, the master-captured Pine render fixture, and one intended expectation update in `pineBoxControlledError.test.jsx`. |
| `99cc7c2d0f` | Test: the P0-2 verdict case holds whichever PR lands first |

**#590, `feat/indicators-ts-period-lift`, head `ec36b1166b`** (base `f4fb9cab45`; 9 files, +5351 / −7, of which 4623 lines are the parity fixture)

| Commit | What |
|---|---|
| `b0e969014b` | `THINKORSWIM-VALIDATION.md`: the owner's manual capture procedure |
| `ec36b1166b` | `periodLift.js` (basis F), wired into `thinkscript.js`. Adds the new guard `thinkscript:aggregation-mixed`, one `_folds` channel in `closedTable.json` (edited as text, +7 lines), tests, and the Python parity test plus fixture. |

**Combined candidate.** A local branch, `scratch/i2-combined` (never pushed): #577 + #590 + `origin/master`
`19d8365627`, at `6f7f483b74`.
- The two PRs touch disjoint files.
- Neither overlaps the 7 master commits since `f4fb9cab45` (News #574/#594, #604).

## 2. Combined regression (candidate vs clean `origin/master` `19d8365627`, same machine, same run)

| Suite | Candidate | Clean master | New failures |
|---|---|---|---|
| Full chart engine (`vitest run src/components/chart`) | 1243 files passed, 2 failed; 21318 tests passed, 4 failed | 1240 files passed, 2 failed; 21252 tests passed, 4 failed | **0** |
| 66 related Python files (folds, closedTable, vendor truth, thinkScript, `tf_live`) | 2238 passed, 24 failed | 2231 passed, 24 failed | **0** (+7 passes: the new parity tests) |
| Both PRs' own and neighbouring tests, combined | 304 / 304 | n/a | 0 |
| CI on each PR | 7 / 7 green on #577, 7 / 7 green on #590 | | |
| `flow_worker_watch_coverage.py` | **OK**: 17 changed files, none watched by flow-worker or reached by it | | |
| Agent ownership check | every file is EXTERNAL to the Agent program; no Agent-owned file is touched | | |

### Baseline failures (pre-existing, identical on clean master; not I2's)

- **JS (4 tests):**
  - `symbolFoldParity.test.js` ×3
  - `targetScriptReport.measure.test.js` ×1
- **Python (24 tests):**
  - `test_concept_vocabulary` ×6
  - `test_definition_concierge` ×5
  - `test_starter_library` ×5
  - `test_phase_e_acceptance` ×3
  - `test_single_authority_rails` ×2
  - `test_ast_scalars`, `test_options_l3`, `test_tools_pin_the_root` ×1 each
- **`reachable.test.js` (3 tests):** S4 expiry, "nothing committed is connected to nothing", and the
  "cannot excuse" control. It is not in the chart directory, but was measured identical on master.
- **Under load, three runtime `*.measure` tests can exceed the 15 s test timeout.** They pass serially
  on both trees.

### Mutation proofs (each mutant must turn the suite red, and did)

| Area | Mutations |
|---|---|
| `importVerdict.js` (5) | unknown note code ignored · exact without evidence · P0-2 shape rule off · chrome classed as visual · Pine not passed through |
| `PineBox.jsx` wiring (3) | display ignores the verdict · no Pine fallback · Pine guard removed |
| `periodLift.js` and its wiring (6) | offset rule off · basis C everywhere · mixed window not refused · cross not exempt · strip off · lift not wired |

## 3. Compatibility disclosures (what members will read)

| Import | Before | After |
|---|---|---|
| Clean thinkScript or TC2000 | "Exact import" | **"Imported, no known differences"**: "translated from \<vendor\>’s published definitions; no difference is known, but these values have not been compared against \<vendor\>’s own" |
| Native formula | "Exact import" | "Exact import" (not an import) |
| thinkScript weekly/monthly read (#590) | "Exact import", with wrong values | **"Imported, with disclosed differences"**: "values can differ". Fold note: computed on weekly/monthly bars, "**intended to match thinkorswim but has not yet been confirmed against thinkorswim**"; the current period "may repaint"; past bars show the period's final value; `[n]` is confirmed. |
| A window over mixed daily/weekly values | silently wrong | **Refused** (`thinkscript:aggregation-mixed`) with a sentence saying how to fix it |
| An unregistered note code (future) | "the values are the same" | "values may differ" |
| Pine | unchanged | **unchanged, byte-identical** |

⛔ The "not yet confirmed" wording stays until the owner's capture (`THINKORSWIM-VALIDATION.md`) is
compared and reported PASS. Neither PR ever says "exact" or "as thinkorswim does" for thinkScript
or TC2000.

**Behaviour change, for new imports only (#590).** A bare `close(period = WEEK)` now develops
(`tf_live`) instead of reading the last closed week (`tf`). Its output carries the existing
repaint badge, and arming an alert on it needs the existing repaint acknowledgement.

## 4. Saved definitions and alerts

- **No migration, no stamping, no re-derivation.**
- `importVerdict` computes on read and writes nothing. A frozen-input rail pins this.
- A thinkScript paste is saved as native formula text, and the native reader never runs the lift.
  Rails pin both:
  - the legacy `sma(tf(close,'W'),10)` tree and its values;
  - that `periodLift.js` is imported by `thinkscript.js` only.
- **Consequence, stated plainly:** existing thinkScript weekly/monthly imports keep their old values
  and alerts until a member re-imports. I2 does not badge them. That needs the `import_accepted`
  telemetry count, which is a production read this session does not have.
- #516's STOC/ATR path is untouched.

## 5. Release plan and rollback (for when authorization is given)

- **Order:** #577 can release alone. #590's production promotion waits for the thinkorswim PASS.
  Either order is safe (railed by `99cc7c2d0f`). Releasing them together gives one web restart
  instead of two.
- **Before each merge:**
  - re-fetch and re-check mergeability, CI and the flow-worker watch coverage;
  - confirm master == production and nothing is in flight;
  - coordinate the slot with the active sessions (one master merge at a time).
  - A master merge auto-promotes to production and redeploys `web` only. Other services are judged
    by their watch paths, and flow-worker is not reached.
- **Rollback:** `git revert -m 1 <merge sha>` for each PR, then the normal gate and promotion.
  - It is clean: no data, schema, variable or flag is involved, and no saved definition changed.
  - Reverting #590 returns new thinkScript weekly imports to the old trees. Definitions saved while
    #590 was live keep their lifted trees, which are valid native formulas that read and evaluate
    in both lanes.
  - Reverting #577 restores the old verdict line exactly.
- **Smoke after release** (admin, Import tab):
  1. a clean thinkScript paste reads "Imported, no known differences";
  2. a Pine paste reads exactly as before;
  3. after #590: `Average(close(period = AggregationPeriod.WEEK), 10)` reads disclosed, with the
     weekly fold note.

## 6. Still open

- **The owner's thinkorswim capture.** Part A can be done any time. Part B is the week of 2026-11-02.
  Report PASS/FAIL only.
- **Pine integrator review of `7a503b07f3`** on resume. This is a review, not a blocker: the owner
  authorized the change.
