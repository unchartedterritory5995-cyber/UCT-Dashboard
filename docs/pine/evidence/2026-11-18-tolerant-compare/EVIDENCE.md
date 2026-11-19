# Pine compares two floats within an absolute epsilon (engine 78 (#1858), 2026-11-18)

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
  and provides `PINE_CMP` / `EXACT_CMP`, `pineCompareAmbiguous`, `constCompareFold`, `compareRange`,
  `compareSlack` and `compareNarrow` (the state narrowing `refine` applies). It imports nothing.
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
| range proofs: `rangeOp`, `refine` (JS and Python `_r_op`, `refine`) | `compareRange` with the evaluation's table; `refine` narrows through `compareNarrow`, widened by `compareSlack` |
| bind folds (`bind.js`, `ast_bind.py`), `pine.js` `staticBinary` / static `==` / `nzSentinelSound` | an ambiguous pair is NOT folded or decided statically; the run decides it |
| v1-v4 constant fold | `pine.js::constCompareOf` (host, both resolve paths) and `pineRuntimeFrontend` `irConstValue` (constant columns and parameterless pure functions included) fold an ambiguous constant pair to its exact 0/1. Every other tree keeps its shape |
| built-ins | `FN_PINE` / `CARRIED_PINE` (rising, falling, percentrank, adx / plusDI / minusDI), `computeADX(bars, n, {gt})`, runtime `array.indexof` / `includes`. Python twins `FN_PINE`, `compute_adx_raw(gt=)` |

UNCHANGED, AS MEASURED: crossover, crossunder and cross; highest / lowest(bars); the pivots; math.max / min / sign;
array.max / min / sort; ta.mode. `array.lastindexof` had no capture in engine 78, so it was left exact. Q-FCMP3
has since read it TOLERANT, and the binary searches EXACT (section 6).

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
| M28 the object runtime's `{v:'cmp'}` guard compares exactly | `pineCompareSites.test.js` (a label 3e-14 above 1 is not above 1) |
| M29 `compareSlack` 0 for the Pine table (JS) | `pineCompareSites.test.js` (the narrowing soundness grid drops a state) |
| M30 `compare_slack` 0 for the Pine table (Python) | `tests/test_pine_compare_sites.py` (the same grid) |
| M31 `staticBinary` decides an ambiguous pair | `pineCompareSites.test.js` |
| M32 the backtest receipt id ignores `pineCompare` | `tests/test_pine_compare_sites.py` (a Pine receipt id never equals an IEEE one) |
| M33 a vector names the wrong capture | `pineCompareProvenance.test.js` (every vector is its committed capture's reading) |
| M34 the VM's six from the IEEE table | `pineCompareRuntime.test.js` (the runtime lane driven over every committed probe, every row, every bar) |
| M35 `binaryFor` never Pine | `__tests__/vendorHarness/vendorHarness.fcmpAcceptance.test.js` (both lanes, committed captures) |
| M36 `computeADX` ignores `opts.gt` | `pineCompareBuiltins.test.js` (ta.dmi on every bar of both committed captures: 25,472 SPY cells, 1,949 RDDT) |
| M37 the lifted runtime kill entry put back | `tests/test_pine_capability_admission.py::test_RT1_the_contraction_box_kill_is_lifted_on_its_own_condition` |
| M38 the lifted host known-divergence entry put back | `tests/test_pine_host_known_divergence.py` (the list is the derivation) + the lift rail above |

The four sites the first build left without a behavioural rail (the object guards, the narrowing slack, the static
decline, the receipt id) each have one now (M28-M32), at the coordinator's ruling.


## 4. The corpus, both lanes

The full vendor-harness corpus (every capture under `tests/fixtures/vendor`), both lanes (production and runtime-on),
graded by this PR's `pine heavy` run and diffed against the e77 train run (44311044277, head `f4b71c2bc1`) item by item:
every plot, the objects, the paints. The PR description carries the final run's table.

First PR run (44319610649, head `7fbb1b81e1`): NOTHING MOVED FROM MATCH TO DIVERGE, and no item moved from MATCH or
INCONCLUSIVE to DIVERGE.

| capture | production | runtime-on |
|---|---|---|
| `contraction-box-doji-lines-spy-1d-2026-10-03` | DIVERGE (lines 204 / ours 205) to MATCH | DIVERGE to MATCH |
| `contraction-box-doji-lines-spy-1d-2026-11-15` | DIVERGE (lines 200 / ours 201) to MATCH | DIVERGE to MATCH |
| `adx-and-di-for-v4-spy-1d-2026-11-17` | INCONCLUSIVE (`pine:state`, unchanged) | DIVERGE to MATCH |

- The contraction lines were read as "the collector one creation apart" (DIV-1). They were a near-tie comparison:
  compared within the epsilon, ours makes exactly TradingView's lines. Their pins were re-pinned
  (`vendorHarness.f4SpyDrawings.test.js`; the CAP3 signature was rewritten by `cap3SpyGaps.measure.test.js`, never by
  hand).
- **LIFTED from the host lane's known-divergence list** (`hostKnownDivergence.json`), at the coordinator's ruling
  (2026-11-18). Its `liftWhen` is met: the engine fix, then a production re-grade (run 44319610649) in which both
  named SPY captures grade MATCH. Both RDDT captures were already MATCH.
  - The two re-graded records were spliced verbatim from that run's production `verdicts.json` into
    `docs/pine/vendor-harness/production/verdicts.json`. No other record moved.
  - The list and its queue doc were then re-derived (`host_divergence.py --write`: 29 to 28 listed).
  - The coverage ratchet was re-measured (`coverage_ratchet.py --write`, both lanes: +1 each, the script).
  - The two door rails moved their witness to `heat-map-seasons`, which is still listed.
- **LIFTED from the runtime kill list too** (`api/data/pine_runtime_killlist.json`, 15 to 14), at the coordinator's
  ruling. Its `liftWhen` is an engine fix to the line count, then a runtime-on re-grade to MATCH on both SPY captures,
  and the same run met it.
  - The two runtime-on records were spliced verbatim into `docs/pine/vendor-harness/runtime-on/verdicts.json`.
  - The kill rail re-proves the list from that evidence. `test_DRAW1_every_newly_admitted_object_script_with_a_DIVERGE_capture_is_killed`
    no longer finds the script.
  - The new `test_RT1_the_contraction_box_kill_is_lifted_on_its_own_condition` holds the lift to both re-grades: line
    counts 204/204 and 200/200, and every paired record agrees.
- No held kill entry for adx-and-di-for-v4 is on master (`api/data/pine_runtime_killlist.json`), so there is none to
  remove.

`hostParity` HP-1 (and its V8 twin) is RED BY DESIGN until the engine number is assigned. Five `dmi_manual` cases
(a hand-written DMI's `up > down`, now compared within the epsilon on the runtime lane) changed their digest, and the
tool's rule is that the coordinator rewrites `expected-digests.json` with `--write` at the bump.

ACCEPTANCE, on the committed captures (Q-FCMP `56330c15e071`, Q-FCMP2 `d0641f7651fb` rows 1-8 and `6f854939fa72` rows
9-16, all promoted in this branch):

- `vendorHarness.fcmpAcceptance.test.js` grades all 14 graded probes on BOTH lanes. On each, every row agrees with
  TradingView on every bar, and no row is DIVERGE.
- Every non-constant row is MATCH. The rows that compare two literals are the same on every bar, so our pane draws
  them with no series (`hidden (constant)`, the pre-existing pane rule, as rt1-na-test's A05 and rt3-na-logic's B07).
  They grade INCONCLUSIVE on colour with their values agreeing, and they are named in the rail: Q-FCMP F01-F04 and
  F11-F12, form T49-T50, const C01-C04 and C09-C14. Making those rows MATCH would need the pane rule changed, which
  this branch does not do.
- The member door draws all 14 on the host lane, with the runtime pane on too. So
  `runtime/__tests__/pineCompareRuntime.test.js` drives the RUNTIME lane over the same 14 captures: every row, every
  bar, no cell off.
- The two built-in probes per symbol are refused by name (`pine:collection`). Their numbers are railed directly:
  ta.dmi on every bar of both captures, plus rising / falling / percentrank / indexof / includes.
- Every vector in `tests/fixtures/ast/pine_compare_vectors.json` is checked against its committed capture
  (`pineCompareProvenance.test.js`).


## 5. Not done, and why

- **D6, the result-identity suffix: NOT ADDED (coordinator ruling, 2026-11-18).**
  - Saved-scan alert subscriptions (`screen_alert_subs`) are keyed by the result identity, so a suffix (`~e`)
    would disconnect every member's Pine screen alert. `screen_alert_integrity.py` records the same for `~s2`, and
    re-keying is owner decision D11 Phase A2.
  - The difference shows only where two values sit within 1e-10 of each other. A Pine document's stored scan results
    are therefore recomputed under the SAME key on the sweep's next pass, at its own pacing; one stale pass is the
    cost.
- **`array.lastindexof` and the three binary searches** stayed EXACT in engine 78, pending Q-FCMP3. Now read: see
  section 6.
- Phase 2 (native formulas tolerant too) is a separate PR, decided on a measurement (ruling D1).


## 6. Q-FCMP3: the array searches (engine 81, `feat/pine-tolerant-lastindexof`)

The capture: `vw-fcmp-arrays` on AMEX:SPY 1D (8,510 bars) and NYSE:RDDT 1D (669 bars), from the listing.

- Run `fcmp3b-2026-11-18`, packet sha256 `b400024aa71d2d2c895f04bf449f4cb310dd28e49d25f988cd002d2a9f0ad0ef`, both
  PROMOTE / probe and committed.
- A re-capture of master's probe text. It supersedes `fcmp3-2026-11-18` (packet `c82872f0c9fe`): that packet was
  licence-held because it was written on a checkout without the probe. It read the same values, and its ledger rows
  were backed out before they were committed.

Every row reads the same on every bar of both symbols. The table is in
`docs/pine/capture-queue-2026-11-18-float-tolerance-form.md`, section Q-FCMP3.

| site | reads | engine |
|---|---|---|
| `array.lastindexof` | TOLERANT at 3e-14 and 9e-11 (A02-A04) | `runtime/collections.js::lastIndexOfValue`, `pineEq`, searching from the end |
| `array.binary_search` | EXACT (A07-A09) | unchanged, pinned |
| `array.binary_search_leftmost` | EXACT (A11-A12) | unchanged, pinned |
| `array.binary_search_rightmost` | EXACT (A13-A14) | unchanged, pinned |

- Arrays run on the runtime lane only: the host lane refuses them by name (`pine:collection`), and native formulas
  have no arrays. So the change is Pine documents only, as ruling D1 requires.
- Unchanged:
  - an `na` element matches nothing;
  - an `na` target still stops the run by name (unpinned);
  - text, colours and handles compare strictly.

RAILS:

All three rails read the committed captures:

- `pineCompareBuiltins.test.js`: the kernels' answer to each of A01-A16 is every bar's reading in both captures. It
  also covers the `na` and text cases.
- `runtime/__tests__/pineCompareRuntime.test.js`: the runtime lane runs each capture's own source over its own bars.
  Every row on every bar is TradingView's (SPY 8,510 bars, RDDT 669).
- `__tests__/vendorHarness/vendorHarness.fcmpAcceptance.test.js`, both lanes:
  - production refuses the script by name (`pine:collection`);
  - runtime-on: the door draws it on the runtime lane, and all 17 rows MATCH on both symbols.
  - With the change reverted (M39), runtime-on no longer MATCHes.

| mutant | rail that went red |
|---|---|
| M39 `array.lastindexof` strict again | both rails above |
| M40 `array.binary_search` tolerant | both |
| M41 `array.binary_search_leftmost` tolerant | both |
| M42 `array.binary_search_rightmost` tolerant | both |

Each mutant was restored byte-equal from a saved copy. Each rail's test filter was shown to select its tests
(control runs, unmutated: 4, 3 and 1 tests).
