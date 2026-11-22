# UDTs / methods / enums, collections, user functions: the coverage unit (2026-11-16)

Branch `feat/pine-coverage-udt-collections`. Engine number: NUMBER PENDING (`scriptEngineVersion.js`), numbered
master + 1 when the coordinator lands the train. Everything here is the RUNTIME lane, which stays dark for members;
the production (host) lane is unchanged by this unit.

## 1. What changed

| shape | lane | served or refused | authority |
|---|---|---|---|
| `array.binary_search` | runtime | served over a sorted, `na`-free numeric array; an empty array is -1; a value held by more than one element STOPS by name | v6 reference: "returns an element's index if the value from that element equals the target value. Otherwise, it returns -1"; "does not necessarily correspond to the first or last occurrence" |
| `array.binary_search_leftmost` | runtime | served as stated; an EMPTY array STOPS by name | v6 reference: "the first element whose retrieved value equals that value. Otherwise … the last element whose retrieved value is less than the target value, or 0 if the target value is less than the value from the first element" |
| `array.binary_search_rightmost` | runtime | served as stated; an EMPTY array answers 0 | the reference sentence ("the last element … equals … Otherwise … the first element … greater …, or the array's last index plus one"); the empty case is WITNESSED (section 3) |
| `array.insert` at `size` | runtime | an append (an empty array's index 0 included); negative and past-`size` keep their stop | WITNESSED (section 3); the reference lists only 0..size-1 and -size..-1 |
| any of the three searches over an unsorted array, an `na` element or target, a non-numeric element | runtime | STOP by name (`… (Q-W19R2b)`) | the entries: "must be sorted in ascending order … for correct results" |
| `array.every` / `array.some` over a non-bool array | runtime | REFUSED at build by name (`runtime:array`, "TradingView does not compile it") | v6 reference types `id` as `array<bool>`; reading of `vw-w6-array-members` (run cq1-2026-11-16, PR #1472): "Cannot call {funId} with argument … a {currentTypeDocStr} is expected". Fail closed: served only over an array this lane can PROVE holds `bool` (a written `array<bool>`, or a call built in place) |
| an `enum` whose fields share a name or title | runtime | REFUSED at build by name (`runtime:enum`) | reading of `vw-w6-enum` (run cq1-2026-11-16): "The name or title of the {enumName} enum's {firstFieldName} field cannot match the name or title of the {secondFieldName} field. Choose unique names and titles for all the enum's fields." W6-T10 had served two same-title fields as two members |
| assigning a `for x in a` element variable | runtime | still refused (`runtime:loop`), now as what it is | reading of `vw-w6-forin-loopvar-write` (run cq1-2026-11-16): "Variable {variableName} cannot be mutable" |
| `array.get` at an `na` index | runtime (pane only; the C18 object door keeps master's stop) | `na`, the run goes on, in v4 and v6; v5, a fractional index and an index out of range keep the stop | v4 MEASURED: `vw-uie3-na-index-v4-spy-1d-2026-11-16` (our probe, run cq1, carried byte-identical from PR #1472) reads `na` on all 8,508 bars. v6: BBWP's capture runs on through `array.get(colorMap, math.round(na))` on its first bars; that read colours an `na` point, so the v6 VALUE is asked directly by UDT-N1 |

## 2. Coverage: the census over the unit's targets (MEASURED)

One lock hold on head `caa9e75b17` (this branch with master `e31f159d8c` merged), `run_census.drive` (the census loop
the map and the ratchet use): the unit's 72 wall-touched targets, the 4 other sample scripts that write a binary
search or an enum, and 8 controls. Runtime-on lane cap 8 (the map's walls), production lane cap 1. BEFORE = the
engine-60 census rows (`runs/cov-e60/{rt,prod}`).

| measure | before | after |
|---|---:|---:|
| runtime-on lane, targets that transfer (`clean`, or attached on the runtime lane, not placing orders) | 0 of 76 | **1 of 76** |
| production lane, targets that transfer fully | 0 of 76 | 0 of 76 |
| controls (4 transfer on both lanes, 4 on the runtime lane only) | 8 runtime-on, 4 production | unchanged |
| scripts that stopped transferring | | **0** |

- **Newly transfers (runtime-on lane): `committed:bollinger-band-width-percentile`** (before: `runtime:array`
  `array.binary_search_rightmost`, its only walls). Real capability admission: ADMITTED (`(True, [])`), not on the
  kill list; its capture grades MATCH, paints included (section 3).
- Every other target keeps its engine-60 first wall (75 scripts): `runtime:library` 19, the host object program
  (`pine:objects-only` 8, `pine:constant-only` 2, attached-dirty with no runtime wall 3), built-ins missing
  (`pine:builtin` 6, `pine:function` 4, `runtime:call-undeclared-builtin-state` 5), `runtime:loop` 4,
  `runtime:function-global-state` 4 and `runtime:function` 4 (section 4), requests (`runtime:request-with-state` 2,
  `pine:request` 2, `lower-tf:lookahead` 1), `runtime:expression-statement` 2, `runtime:conditional-history` 2, and
  one each of `runtime:udt-method`, `runtime:statement`, `runtime:history-dynamic-offset`, `runtime:block-value`,
  `pine:statement`, `pine:colour-value`, `budget:lookback`.
  `reference:rsi-kernel-optimized-flux-charts` stops on `math.e` (another unit's code) before and after; its binary
  searches no longer stand behind it.
- **Coverage ratchet**, `coverage_ratchet.py --lane runtime-on --write` on the same head: measured 266 of 266
  committed scripts, 87 transfer, `ADDED committed:bollinger-band-width-percentile`, lost 0
  (`docs/pine/coverage-ratchet.json`: runtime-on 86 -> 87). Production lane unchanged (58).

## 3. Witnesses

| served shape | witness | status |
|---|---|---|
| the three binary searches over a sorted array | the v6 reference sentences (quoted in section 1 and in each rail of `udtBinarySearch.test.js`), including the reference's own examples (3 in (-2, 0, 1, 5, 9): leftmost 2, rightmost 3; 5 in (4, 5, 5, 5): leftmost 1, rightmost 3) | rails green remotely (run 1) |
| rightmost of an empty array = 0; `array.insert` at `size` = append; `array.get(a, na)` = `na` in v6 | `bollinger-band-width-percentile-rddt-1d-2026-11-14` graded through the member door, runtime-on lane (`vendorHarness.udtBinarySearch.test.js`) | **MATCH, paints included** (remote run 2, head `4255e5db44`: `gradeCapture` grades paints by default and a withheld paint would grade INCONCLUSIVE). History of the check: Remote run 1 graded it DIVERGE ("1 of 6 compared items diverge"): the run stopped on its first bars at `array.get(colorMap, math.round(na))`. With the `na`-index rule a dev run of the lane matches TradingView on all 666 bars of BBWP, MA and both alert lines; the background paint then graded MATCH too. |
| `array.get(a, na)` = `na` in v4 | `vw-uie3-na-index-v4-spy-1d-2026-11-16` N03 | measured |

## 4. Still refused by name, with queue rows

Every wall of this unit that the census reaches on a target, and why it is not served:

| guard (runtime lane) | shape | why it stays refused | queue row |
|---|---|---|---|
| `runtime:function-global-state` | `g[n]` of a mutable global inside a function body (a plain read of `g` is served, C11) | no reference sentence and no capture says whose past it is inside a frame; on `bolingger-bands-inside-bar-boxes` the offset is also a run-time value no ring can bound (`runtime:history-dynamic-offset` follows) | UDT-G1, probe `vw-udt-fn-global-history.pine` |
| `runtime:function` | a parameter typed `T[]` (`float[] a`) | no sentence; and on its three scripts it only moves the first wall (next: `timeframe.in_seconds`, a `str.tostring` format, a `label` statement) | UDT-T1, probe `vw-udt-legacy-array-param.pine` |
| `runtime:function` | the default parameter value `freq = alert.freq_once_per_bar` (the lane's sentence: "default values are not supported yet") | the script it blocks (`one-indicator-multiple-max-40-…`) then needs other-symbol requests (crypto, FX) | none needed: not this unit's last wall |
| `runtime:array` | `array.standardize`, `percentile_linear_interpolation`, `percentrank`, `mode` | unchanged (W6-A1) | W6-A1 |
| `runtime:CollectionError` (run time) | the binary searches' unsettled cases; `array.insert` negative or past `size`; `array.fill` past the end or negative | the reference does not settle them | Q-W19R2a, Q-W19R2b |
| `runtime:udt-method`, `runtime:enum`, `runtime:call-undeclared-builtin-state:<field/method …>` | overloads on number receivers, an enum outside a binding, drawing getters in the VALUE build | unchanged; on this unit's targets each sits beside another unit's wall (libraries, `color()` casts, lower-tf requests) | W6-U1, W6-E1 |

## 5. Probes for the capture session

The four W6 probes that did not compile, and the W19-R2 probe that raised, were split so that each question that
can fail to compile or raise has its own file (TradingView's error text names no line or value, so one combined file
reads as one unattributable error). Each has an `A00` `bar_index` control and one question per plot.

| row | probe | chart |
|---|---|---|
| Q-W19R2b | `tools/visual_conformance/probes/vw-w19r2-collections.pine` (B01-B05, L01-L05, R01-R05; nothing left can raise) | NYSE:RDDT 1D |
| Q-W19R2b | `vw-w19r2b-empty-binary-search.pine`, `vw-w19r2b-empty-leftmost.pine`, `vw-w19r2b-empty-rightmost.pine` | NYSE:RDDT 1D |
| Q-W19R2a | `vw-w19r2a-insert-at-size.pine`, `vw-w19r2a-insert-into-empty.pine`, `vw-w19r2a-insert-negative.pine`, `vw-w19r2a-fill-past-end.pine`, `vw-w19r2a-fill-negative-from.pine` | NYSE:RDDT 1D |
| W6-A1 | `vw-w6-array-members.pine` (N07 / E01 / E02 removed), `vw-w6-array-every-empty.pine` | AMEX:SPY 1D |
| W6-E1 | `vw-w6-enum.pine` (T03 / E01 and the same-title fields removed: answered) | AMEX:SPY 1D |
| W6-U1 | `vw-w6-receivers.pine` (U01-U02, U05-U06), `vw-w6-receivers-get-float.pine`, `vw-w6-receivers-get-int.pine`, `vw-w6-receivers-na-field.pine`, `vw-w6-receivers-pick-int.pine`, `vw-w6-receivers-m-int.pine` | AMEX:SPY 1D |
| UDT-G1 | `vw-udt-fn-global-history.pine` | NYSE:RDDT 1D |
| UDT-T1 | `vw-udt-legacy-array-param.pine` | NYSE:RDDT 1D |

`vw-w6-forin-loopvar-write` needs no new probe: its compile error IS the answer, and its queue mention is retired
(`capture-queue-2026-11-06-w6-t6.md`). `evidence_engine.py queue` gains 16 targets and drops that one.

## 6. Tests and mutants

- Remote run 1 (`tools/remote_tests.py`, head `7e38ba2918`): pytest `tests/test_pine_*.py tests/test_runtime_definitions.py`
  success; vitest 4 failures: three in `w6ArrayMembers.test.js` (a W6-T5 block still pinned the binary searches as
  refused, now moved to `udtBinarySearch.test.js`) and the BBWP grade (the `na`-index stop, section 3).
- Remote run 2 (head `4255e5db44`, GitHub run 43966947045): **GREEN**, 4 of 4 jobs, tool exit 0: `udtBinarySearch`
  (19 tests), `w19r2Collections`, `w6ArrayMembers`, `w6Enum`, `objectDoorGate`, `w6ForIn`, `p3WsaReviewFixes`,
  `honestySweep`, `vendorHarness.udtBinarySearch` (BBWP MATCH), `vendorHarness.w6ForInRuntime`.
- Local light checks on the pushed tree: `refusal_codes.py --check`, `evidence_engine.py queue --check` and
  `pins --check`, `check_repo_hygiene.py`: all exit 0. No guard code added (the refusals reuse `runtime:array`,
  `runtime:enum`, `runtime:loop`), no regex added.
- Mutants: `ci/mutants/udt-collections.json` (11: insert-at-size stopping, leftmost's not-found answer, the duplicate
  stop, the sort check, rightmost-of-empty, the every/some refusal, the enum title clash, the for-in sentence, the
  `na`-index rule, the object door's master answer, v5 kept out), validated by `ci_mutant_runner.validate`, run by
  pine-heavy's dispatch mutants job (run 43970583944).

### Harness verdict moves and the REACH record (pine-heavy dispatch 43970583944, head `caa9e75b17`)

- Mutants job: SUCCESS, all 11 killed and every file restored byte-equal.
- Verdicts against #1472's own pine-heavy run (43963117595), the same 799 captures: production lane **0 moves**;
  runtime-on lane **2 moves, both INCONCLUSIVE -> MATCH**: `bollinger-band-width-percentile-rddt-1d-2026-11-14` and
  `vw-uie3-na-index-v4-spy-1d-2026-11-16`. No new DIVERGE, no MATCH -> DIVERGE. (Against master's committed snapshots the
  diff is larger only because #1472's 55 captures are not in them yet.)
- The one red leg was `capabilityEvidenceLane.test.js`, which re-asks the door for every capture of the committed REACH run
  (`docs/pine/evidence/2026-11-15-cond-ta/runs/report.json`): BBWP was recorded refused (`lane: null`) and the door now
  draws it on the runtime lane, admitted. The record follows the door: BBWP's entry is `lane: runtime`, `runtimeOn:
  MATCH`, and the population counts it changes move with it (capture 43 -> 44 runtime-lane, 92 -> 91 refused;
  committed 20 -> 21, 17 -> 16; re-checked against the list). The runtime-on snapshot's BBWP row is replaced in place by
  the cloud run's own re-grade (MATCH, all 6 items, 666 of 666 bars), with the lane counts it changes (declined 294 ->
  293, drawn 68 -> 69, the one `runtime:array` decline gone). REACH holds: the runtime lane draws it and it grades MATCH.

## 7. Follow-up (branch `feat/pine-udt-readings-ac6`, stacked on #1486): TradingView's answers from capture run ac6

The capture session ran this unit's split probes in run ac6 (2026-11-16). The compile and runtime errors it read,
verbatim with TradingView's values unsubstituted, and what the runtime lane does with each:

| reading | probe(s) | runtime lane now |
|---|---|---|
| Compilation error: "The {argName} argument is not used. The first method argument should be used." | `vw-w6-receivers`, `-get-float`, `-get-int`, `-pick-int` | a `method` whose body never reads its first parameter is REFUSED at the declaration (`runtime:udt-method`), called or not. 161 method declarations in the 679-script sample were checked: none is caught (TradingView compiled them all). The four probes were broken by this, not by the overloads they asked about, so each now reads its receiver at no cost and is re-queued |
| Runtime error: "Index {index} is out of bounds, array size is {size}." | `vw-w19r2a-fill-past-end`, `vw-w19r2a-fill-negative-from` | already a stop; the sentence now says TradingView stops there too. A reversed range keeps the unsettled sentence (unasked) |
| Runtime error: "The sizes of the `id1` and `id2` arrays must be equal." | `vw-w6-array-members` (V02) | already a stop; sentence cites the reading. V02 leaves the probe; V03 and Q01, never reached, get one file each |
| Runtime error: "Cannot access the '{name}' field of an undefined object. The object is 'na'." | `vw-w6-receivers-na-field` | already a stop at the bar the read is reached; sentence cites the reading |
| Compilation error: "Could not find {kind} '{fullName}'" | `vw-w6-receivers-m-int` (U09) | already refused (every number receiver among number overloads, W6-U1) |

Seven existing rails used methods that never read their receiver (W6-T9's overload rails, one W6-T3b typing rail,
one realtime rail): each now reads it at no cost to the value, and each still asserts what it asserted. CAPTURED in ac6
but not yet graded (the captures land in a data PR): the insert, empty-search, `na`-index, global-history, `T[]` and
enum probes.
