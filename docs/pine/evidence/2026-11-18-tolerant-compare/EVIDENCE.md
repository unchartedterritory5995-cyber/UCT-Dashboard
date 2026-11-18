# Pine compares two floats within an absolute epsilon (engine NUMBER PENDING, 2026-11-18)

Branch `feat/pine-tolerant-compare-engine`. This is the phase-1 build of coordinator rulings D1-D8 (2026-11-18), on
the readings of Q-FCMP (`docs/pine/capture-queue-2026-11-18-float-compare.md`) and Q-FCMP2
(`docs/pine/capture-queue-2026-11-18-float-tolerance-form.md`). The 16 probe captures were taken by patrick-54 on
2026-11-18, runs `fcmp-2026-11-18`, `fcmp2-2026-11-18` and `fcmp2b-2026-11-18`.

## 1. The rule, as TradingView runs it

| | reading | source |
|---|---|---|
| form | an EPSILON on the difference, not rounding: pairs 2e-14 apart either side of a 1e-9 bucket edge are equal, pairs 3e-10 apart inside one bucket are not | vw-fcmp-form T20-T25, T08-T09 |
| edge | `a == b` when `a === b` or `abs(a - b) <= 1e-10`: E11 / E13 / E14 are 1e-10 apart and equal, and the double above 1e-10 is not | vw-fcmp-builtins-v2 E01-E14, SPY and RDDT |
| orderings | true only when not equal (codes 41 / 14 / 50 only) | every T and M row |
| `na` | every one of the six is false, `!=` included | T45-T48 |
| magnitude | absolute from 1e-12 to 1e9; no multiply-and-round merging | vw-fcmp-magnitude M01-M34 |
| versions | the same at run time in v1-v6 | the v1/v2/v3/v4/v5 twins equal the v6 probe on every series row |
| constants | v1-v4: a comparison whose BOTH operands are compile-time constants is EXACT (literals, named literals, sums, a function's literal, a `?:` of them, int vs float). Inputs, series and reassigned names stay tolerant. v5 / v6: tolerant everywhere | T50 (v1-v4 = 14, v5 / v6 = 41); vw-fcmp-const-v4 / -v5 C01-C14 |
| built-ins | TOLERANT inside: ta.rising / ta.falling, a float `switch`, array.indexof / array.includes, ta.percentrank, ta.dmi. EXACT inside: ta.crossover / crossunder / cross, ta.highest / lowest(bars), ta.pivothigh / pivotlow, math.max / min / sign, array.max / min / sort, ta.mode | vw-fcmp-builtins-v2 B / Z rows; vw-fcmp-builtins B32-B34 |

The v6 reference's remark on `==` / `!=` says: "This operator rounds "float" operands to nine fractional digits."
The straddle rows refute that remark: TradingView's runtime does not round.

## 2. What changed

ONE AUTHORITY PER LANGUAGE:

- `app/src/components/chart/engine/pineCompare.js` declares `PINE_EQ_EPSILON = 1e-10` and `PINE_EQ_INCLUSIVE = true`,
  and provides `PINE_CMP` / `EXACT_CMP`, `pineCompareAmbiguous`, `constCompareFold`, `compareRange` and
  `compareSlack`. It imports nothing.
- `api/services/pine_compare.py` READS the two declarations. If they are unreadable, the import fails, so the
  server never evaluates Pine with IEEE comparison.

PINE DOCUMENTS ONLY (D1):

- `definitionSemantics.semanticsOptsFor` (Python: `semantics_opts_for` / `pine_compare_opts_for`) sets
  `pineCompare` for a translation or an Apply import.
- `binaryFor` / `binary_for` then read `BINARY_PINE`.
- The runtime VM, the object runtime's guards and the runtime lane's columns always compare the Pine way.
- Native, PCF and thinkScript formulas keep IEEE comparison, byte for byte.

| site | change |
|---|---|
| `interpret.js` `BINARY` / `binaryFor`, `applyOp` / `applyOpStep` | the six read `EXACT_CMP` (unchanged) or `PINE_CMP` per evaluation |
| `runtime/vm.js` OP.LT..NE | `PINE_CMP`; carried kernels from `CARRIED_PINE` |
| `objectRuntime.js` `{v:'cmp'}` guards | `PINE_CMP` |
| doors: `astColumns`, `objectColumns` (5 calls), `runtimeErrorStop`, `pineRuntimeFrontend` columns | carry `pineCompare` |
| server lanes: scan sweep (2), rule record (2), backtest router + receipt id, alert lane (`lane_opts_for`) | `pine_compare_opts_for` |
| range proofs: `rangeOp`, `refine` (JS and Python `_r_op`, `refine`) | `compareRange` with the evaluation's table, and a widened `compareSlack` |
| bind folds (`bind.js`, `ast_bind.py`), `pine.js` `staticBinary` / static `==` / `nzSentinelSound` | an ambiguous pair is NOT folded or decided statically; the run decides it |
| v1-v4 constant fold | `pine.js::constCompareOf` (host, both resolve paths) and `pineRuntimeFrontend` `irConstValue` (constant columns and parameterless pure functions included) fold an ambiguous constant pair to its exact 0/1. Every other tree keeps its shape |
| built-ins | `FN_PINE` / `CARRIED_PINE` (rising, falling, percentrank, adx / plusDI / minusDI), `computeADX(bars, n, {gt})`, runtime `array.indexof` / `includes`. Python twins `FN_PINE`, `compute_adx_raw(gt=)` |

UNCHANGED, AS MEASURED: crossover, crossunder and cross; highest / lowest(bars); the pivots; math.max / min / sign;
array.max / min / sort; ta.mode. `array.lastindexof` has no capture, so it is left unchanged (exact).

## 3. Rails, each mutation-proved

Every rail below was broken on purpose and went red. Each file was then restored from a saved copy and checked
byte-equal by sha256 (never `git checkout`). The harness is
`scratchpad/fcmp/mutate.py`, not committed. Its table is reproduced here.

| mutant | rail that went red |
|---|---|
| M1 epsilon to 1e-300 (exact) | `pineCompare.test.js` vectors + `tests/test_pine_compare.py` vectors |
| M2 `<` instead of `<=` at the edge | both vector rails (E11 / E13 / E14) |
| M3 relative instead of absolute | `pineCompare.test.js` (M rows) |
| M4 `!=` true on `na` | `pineCompare.test.js` (T45-T47, all-six-false) |
| M5 the Python twin compares exactly | `tests/test_pine_compare.py` (the JS rail stays green: the lanes are railed separately) |
| M6 the VM's six from the IEEE table | `runtime/__tests__/pineCompareRuntime.test.js` (SPY bars 5,333 / 5,453) |
| M7 `binaryFor` never Pine | `pineCompare.test.js` (host lane, a Pine document) |
| M8 `computeADX` ignores `opts.gt` | `pineCompareBuiltins.test.js` (ta.dmi on SPY, TradingView's DI+ / DI- / ADX) |
| M9 `compute_adx_raw` ignores `gt` | `tests/test_pine_compare_builtins.py` |
| M10 runtime `array.indexof` strict | `pineCompareBuiltins.test.js` |
| M11 `risingStepPine` exact | `pineCompareBuiltins.test.js` |
| M12 Pine percentrank exact | `pineCompareBuiltins.test.js` |
| M13 no v1-v4 constant fold | `ast/pineConstFold.test.js` + `pineCompareRuntime.test.js` (vw-fcmp-const-v4 C01-C04 / C10-C14) |
| M14 constant fold in v5 / v6 too | both (vw-fcmp-const-v5, form T50) |
| M15 a reassigned name read as a constant | `ast/pineConstFold.test.js` (C09) |
| M16 the runtime lane's columns compare exactly | `pineCompareRuntime.test.js` (const-v5 / C07-C08) |
| M17 the interval form reads IEEE | `pineCompare.test.js` (soundness grid) |
| M18 `bind.js` folds an ambiguous pair | `pineCompare.test.js` |
| M19 `ast_bind.py` folds an ambiguous pair | `tests/test_pine_compare.py` |
| M20 Python `binary_for` never Pine | `tests/test_pine_compare.py` |
| M21 Python `FN_PINE` unused | `tests/test_pine_compare_builtins.py` |
| M22 JS `FN_PINE` unused | `pineCompareBuiltins.test.js` |
| M23 a Pine door loses its rule (`runtimeErrorStop`) | `pineCompareCensus.test.js`. It STAYED GREEN on the first run (a name test passed on the import alone); the rail was rebuilt to require a CALL / spread and re-proved red |
| M24 a new `interpret()` call site | `pineCompareCensus.test.js` |
| M25 a Pine server lane loses its rule (`definition_record`) | `tests/test_pine_compare_census.py`. Re-proved after the same rebuild (a call, not a mention) |
| M26 `semanticsOptsFor` never Pine | `pineCompare.test.js` |
| M27 `semantics_opts_for` never Pine | `tests/test_pine_compare.py` |

NOT RAILED BY A BEHAVIOURAL TEST:

- The object runtime's `{v:'cmp'}` guards. They read `PINE_CMP` by construction, and no committed capture has a
  near-tie drawing guard.
- `refine`'s widened slack. It is wider than the truth, which is sound; no fixture separates it.
- `staticBinary`'s decline of an ambiguous pair.
- The backtest receipt id carrying `pineCompare`.


## 4. The corpus, both lanes

The full vendor-harness corpus, both lanes (production and runtime-on), is graded by this PR's `pine heavy` run.
The baseline is the e77 train run (`f4b71c2bc1`, the merge base `f5def8bc3c`). Every verdict move is listed in the
PR description. A MATCH that moved to DIVERGE would have stopped the work.


## 5. Not done, and why

- **D6, the result-identity suffix: HELD, with a finding.** Saved-scan alert subscriptions (`screen_alert_subs`) are
  keyed by the result identity. `screen_alert_integrity.py` already records that a suffix change (`~s2`)
  DISCONNECTS every existing subscription: "a subscription made with the bare tree hash reads a key nothing is
  written to". Re-keying is owner decision D11 Phase A2. So `~e` on Pine documents would silence every member's
  Pine screen alert, and this build does not add it.
  - The count needs read-only production queries, which this branch cannot run:
    - `user_definitions.db`: Pine documents, `json_extract(definition,'$.meta.recurrenceOrigin')='pine'` or
      `importedFrom.dialect='pine'`;
    - scan results filed under their identities;
    - `screen_alert_subs` rows on those hashes.
  - Without the suffix, a Pine document's stored scan results are recomputed under the same key on the sweep's
    next pass, at its own pacing.
- `array.lastindexof`: no capture yet; it stays exact.

ACCEPTANCE: Q-FCMP, packet `56330c15e071`, promoted in this branch (both fixtures and ledger rows), MATCH on every
row on both lanes.
