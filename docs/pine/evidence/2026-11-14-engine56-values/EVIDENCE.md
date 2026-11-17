# Engine 56: wrong values found by fresh TradingView captures

Branch `fix/pine-engine56-values`, on `origin/master` (engine 54). Engine 55
(`fix/pine-engine55-honest-htf`) merges first; this branch takes 56. Sources: the S3/S4 investigator
report (section A: A1, A2, A3, S4-1, S4-2, S4-4) and the S5 capture session (aroon and connors-rsi,
2026-11-14). Every capture named below is NYSE:RDDT 1D from the listing unless stated; they are
licence-held and stay in `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures` (only their verdicts reach the
evidence ledger). The rails run scripts written in this repo's own words on the committed
`support-and-resistance-5f95e90f-rddt-1d-2026-11-13` bars, which are the same 666 sessions the held
captures hold (checked bar for bar), and grade them against the captures' numbers.

## What changed, item by item

### A1: a v1/v2 self-declaration keeps `nz(x[k], S)` and `na(x[k]) ? S :` in the step
`pine.js::nzSeedAndUpdate` stripped `nz(self[k], S)` to `self[k]` ("inside the built body `self[k]` is
never unknown"), and `ternarySeedAndUpdate` built the accumulator from the update arm alone. Both are
true on bar 0 (the history is filled with the seed) and false after an update that answers `na`:
- `average-true-range-trailing-stops-strategy-by-sylvain-vervoort` (v1): `nLoss` is `na` on bars 0-3,
  `max(0, na)` makes the stop `na`, and Pine's `nz(x[1], 0)` reads 0 on bar 4. TradingView draws 16.49207;
  the stripped step drew 99.01 off a bare `na` self.
- the ternary twin: `x = na(x[1]) ? 0 : U` with `U` answering `na` re-seeds on the next bar in Pine; the
  update-only step carried `na` forever.

Now `seedAndUpdateOf` returns `{seed, update, step}`: `step` is the body as written (wrappers and test
kept), and it is what the accumulator runs (`pine.js` and `thinkscript.js`, which shares the function);
`update` (stripped / the arm alone) is still what the convergence gates (`forgetsItsSeed`,
`forgetsOnReset`, `isBarCounterUpdate`) ask, so no gate decision moved. Bar 0 is unchanged (the seed fills
the lag history, so `nz` and the test are no-ops there).

### A2: `percentrank` counts an `na` prior as "not <="
`interpret.js::percentrankAt` and `ast_interpret._percentrank_at`: a `na` prior value is skipped
(`continue`), the divisor stays `length`, a `na` current bar and a bar before `length` stay `na`.
Witnesses: `uptrick-volatility-weighted-cloud` (v6; bands from bar 100, 0.49 / 0.53 / 0 / 0.47 on bars
100 / 101 / 120 / 141 where this answered `na` to bar 141) and the builtin `connors-rsi` (v6; CRSI
68.6058732213702 on bar 100 over `ta.percentrank(ta.roc(close, 1), 100)`, whose window holds the `na` of
bar 0). The runtime lane computes `ta.percentrank` through the columnar lane, so it moved with it.

### A3: a Pine v1-v5 `bool` can be `na` (rules revised to the S1 witnesses)
The S1 evidence session (2026-11-14, PR #1286, probes `tools/visual_conformance/probes/vw-cs1-*.pine`,
NYSE:RDDT 1D from the listing; `runs/objects-lane/S1-RULES-2026-11-14.md`) WITNESSED, at v2 = v4 = v5, on the
warm-up bars where `na_s` is `na`: `c > na_s` is `na` (not false); `c == false`, `c != false`, `c == true`
are `na`; `not c` is TRUE; `and` / `or` read `na` as false (`c and true` false, `c or true` true, `c or
false` false); a `?:` on an `na` test takes the else branch; `bool nb = na` behaves the same. v1's `==`
agrees (`accumulation-distribution-with-markers`, bar 14: TradingView draws `na`, this engine drew
-11152358.65). **v1 and v3 are not probed directly; they take the same rules (coordinator ruling), and no
evidence contradicts it.** v6 bools are never `na` and are unchanged.

The engine keeps a comparison's VALUE (`cmp` answers 0 for an `na` operand), which IS Pine's answer
wherever the `bool` is read as a condition (`?:`, `if`, `and`, `or`, `not`: `na` reads false and `not na`
is true), and tracks WHERE a `bool` is `na` beside it (`pine.js::naInfo`, per resolved tree: comparisons,
offsets of them, `?:` of bool arms, reads on other bars lifted through the same node, `valuewhen` at its
occurrence, `nz`, a `var bool`'s own flag recurrence; `and` / `or` / `not` are never `na`). Where Pine's
`na` and false differ, the value is rewritten (`pine.js::boolNaOperator`, v1-v5 and no `//@version`):

| form | v1-v5 / no pragma (S1) | v6 |
|---|---|---|
| `b == L`, `b != L`, `b1 == b2`, `b1 != b2` (any side can be `na`) | the VALUE is `na` there: `(flag) ? na : (b == L)`; read as a condition its `na` arm reads false (`Resolver.condition` -> `naArmsReadFalse`) | unchanged |
| `not b`, `b and c`, `b or c` | served as built (`cmp`'s 0 is Pine's false; `not na` is true) | unchanged |
| `?:` / `if` / `iff` test | false where `na` | unchanged |
| `na(b)` | true where `b` is `na` | unchanged |
| `plot(b)` (a `bool` drawn as a value, v1-v3) | `na` where `b` is `na` | n/a |
| a number meeting a `bool` literal (v1-v3 `x == true`) | `na` where the number is | n/a |

Nothing is withheld for these forms any more. The marker `boolNaWithheld(side, 1)` (withheld on every bar,
`pine:bool-na-unwitnessed`) remains only for a `bool` side whose `na` this engine cannot follow (an `==`
written over a recurrence's own past, `x = c ? (nz(x[1], false) == true) : false`); the sentence now states
the witnessed rule and that only those are withheld.

### S4-1: pivots ignore a left-side `na`
`pivotCol`, the runtime kernel `pivotPineStep` and `ast_interpret._pivot_col`: for `j < i` a `na` is
skipped. A right-side `na`, a `na` current bar and a bar with fewer than `left` bars before it stay not
computable. Witness: `on-balance-volume-macd-acceleratorawesome-oscillator-pivdiv-3` (v4), first Bear Div
L/M/S markers on bars 73, 58, 54; the investigator's recompute of all six pivot columns had 0 diffs.
The edge (S6, the builtin `rsi-divergence-indicator`, 0 mismatches over 666 bars under this rule): its
pivot high of bar 14 has its WHOLE left window (bars 9..13, the RSI warm-up) `na` and still counts, so an
all-`na` left window passes; the only withheld left condition is a window that reaches before bar 0
(`i - left < 0`, the loop's start). Railed on the capture's numbers (bar 19: 45.19746465138957, bar 23:
41.366625940024655) with a mutant that withholds an all-`na` left window.

### S4-2: the arg-extreme tie (rules revised to the S1 and S10 witnesses)
TradingView names the NEWEST of equal extremes in a `highestbars` / `lowestbars` window over ANY source:
- over a bar price: the builtin `aroon` (v6, S5: Aroon Up 100 on bar 116, this engine read 71.43) and
  `pivot-high-low-points` (v4: no marker on bar 117);
- over a two-valued COMPUTED source: S1 (v4 = v5), and the S10 capture
  `vw-cs2-highestbars-computed-v6-rddt-1d-2026-11-15` (v6; probe
  `tools/visual_conformance/probes/vw-cs2-highestbars-computed-v6.pine`): over
  `vt = bar_index % 3 == 0 ? 1.0 : 2.0`, from bar 3 on, `ta.highestbars(vt, 4)` reads -1, 0, 0 and
  `ta.lowestbars(vt, 4)` 0, -1, -2 by `bar_index % 3` (oldest-wins would read -2, -3); first value on bar
  `length - 1`.

**`divergences.json::argextreme-ties-resolve-to-the-newest-bar` (oldest wins, measured 2026-09-08 on a
two-valued computed source) is REFUTED by the S10 capture** and is now `status: refuted` with `refutedBy`
naming it; `_functions_arg_extreme` records the same. The Pine door marks every non-bar-price source of
`ta.highestbars` / `ta.lowestbars` `tieNewest(source)` (a new pointwise table function, its operand on
every bar, both lanes), and `isBarPriceTree` / `is_bar_price_tree` read the mark as a bar price, so the
newest reducer runs and nothing is withheld. The runtime window takes the newest reducer for every source
(its old tie stop is removed). v1-v3 spell the call bare, which refuses by name (sign unstated). A formula
written in this engine's own language keeps the withheld rule over a computed source
(`argExtremeTieMask`, `pine:tie-unwitnessed`), whose sentence now says that Pine names the newest.

### The runtime lane
It has no per-bar withholding, so it declines by the same codes: a column the columnar lane withholds by
either code declines the run (`columnOf`, the `runtime:chart-clock` pattern). A VM `==` / `!=` over a
`bool` that can be `na` is served only where the VM still holds that `na` as `na` (then `na == x` and
`na != x` are 0, which a condition reads as Pine's false) AND the result is read as a condition, never
drawn as a value; both are decided over the whole lowered program (`boolNaFaithfulness`: every write of
every slot, greatest fixpoint; the drawn set walks each output's value through slots, never through a
condition). Otherwise it declines `pine:bool-na-unwitnessed`. `and` / `or` / `not` are served at every
version. A VM window of `highestbars` / `lowestbars` takes the newest reducer over every source (S1,
S10).

### S4-4: the harness
- `compare.mjs`: a plot that is a LINEAR combination of running totals (`cum`, `cumFrom`, `sum`: sums and
  differences, a constant multiple, an offset, `sma` / `ema` / `rma` / `wma` / `change` of one, and a read
  of the same symbol on another timeframe; `ourSide.js::linearTotalsOf`) is graded with an absolute floor
  of `8 · ε · max |total|` over the prefix; a ratio or product of totals (VWAP), `abs`, a comparison or
  another symbol's read gets none and is graded by REL 1e-9. A relative 1e-6 error, and a VWAP-shaped
  1e-7 one, still diverge (railed); the MATCH reason states how many bars the floor admitted.
- a bar withheld by a per-bar witness code (`nativeRegistry.withheldBarsReport`, recorded by
  `witnessMask`) is not compared; where TradingView drew a value on one, the plot is INCONCLUSIVE with
  the count.

## Rails
- `app/src/components/chart/engine/ast/engine56Values.test.js` (host and runtime lanes, four doors):
  - A1: the trailing stop of bars 4..11 (16.49207, 16.49207, 16.49207, 17.547739840000006, …) from a v1
    script in this repo's words, v1 = v2; the ternary re-seed bar by bar; control: an update that never
    answers `na` (`x = close > nz(x[1], 0) ? close : nz(x[1], 0)`) is the running max.
  - A2: Connors RSI (written from its public definition) reads 68.6058732213702 on bar 100, `na` on 98/99,
    73.8326746093395 / 41.05454228993245 on 101/102; synthetic `[na x 3, values]`; the runtime lane
    draws the same column.
  - A3: the markers script reads `na` on bar 14 and -84920.78585333377 on bar 31, nothing withheld, no
    marker in the tree; v6 draws the bar-14 marker. Synthetic forms over v1 (no pragma) .. v6: `c == false`
    served at every version; `!=`, `==` of two `na`-able sides, v1-v3 `not` / `or`, `(c and x) == false`
    withheld on bars 0..3 with the code in the clock channel, `withheldBarsReport` and the door; the
    screen / pane / member door translate and `buildRuntimeIr` declines by the same code; the served
    forms are equal on both lanes.
  - S4-1: synthetic left-`na` pivots in `pivotCol` and the runtime kernel; a v4 pivot of
    `close - sma(close, 10)` on RDDT (the pivots of bars 10 and 14, read on bars 12 and 16);
    `rsi-divergence-indicator` (S6) bars 19 (45.19746465138957) and 23 (41.366625940024655), an all-`na`
    left window passing and a window before bar 0 withheld.
  - S4-2: the aroon form on RDDT (78.57142857142857 / 100 / 92.85714285714286 on bars 115..117); v4
    `highestbars(11)` = -1 on bar 117; a two-valued computed source withheld (v6, v4) with the runtime
    declining; a computed source with no tie drawn, tie bars counted exactly; the bar-price test.
  - the runtime lane's own path: a VM `!=` over a comparison of a mutable value declines (v5), not v6;
    a VM window over a computed source stops by name on its first tied window and is served (equal to
    the columnar lane) with none; `ta.highestbars(high, <per-bar length>)` names bar 116 on bar 116.
- `app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.engine56FloatFloor.test.js`:
  the S4-4 floor on the capture's magnitudes (2 ulps of a 1.2e9 total pass, a relative 1e-6 error still
  diverges), `floatOrderFloorOf`, and per-bar withholding (INCONCLUSIVE with a count in steady state,
  nothing in warm-up, a wrong value elsewhere still DIVERGE).
- `tests/test_engine56_values.py`: the Python twin of A2, S4-1, S4-2 (newest, aroon, tie mask) and the A3
  marker and mask.
- Pins updated for the new shape, each with its reason: `pine.convergence`, `pine.selfref`,
  `thinkscript.selfref` (the step keeps `nz` / the `na` test), `pinePhase1Builtins` (TradingView's Aroon:
  newest), `sentence` / `parse` / `doorCoverage` / `pine.window` / `periodAnchorParity` (the new table
  function and codes), `test_ast_interpret` / `test_ast_scalars` / the corpus and input-compat fixtures,
  `docs/formulas/GRAMMAR.md` (regenerated), `tools/lookback_agreement.json` (written by its own rail),
  host-parity digests (`--write`, every case moves with the engine identity; 0 status or guard changes).

> ⚠️ **LANDING TRAIN (coordinator, 2026-11-15).** This branch lands in a train of five engine branches
> under ONE engine number, with ONE before/after census + harness run done by the train builder. This
> branch therefore does NOT re-measure the census or the harness, does not take the engine number
> (`SCRIPT_ENGINE_VERSION` is still master's at `5443154808`; the history line says "master + 1"), does
> not regenerate the host-parity digests, re-record `service_smoke.json` or regrade the ledger: the train
> does all of those on the train head. The tables below name the commit they were measured at; the train
> replaces them. What THIS branch ran on its own head is in **Tests run** (the `-v2` block).
>
> ⚠️ **Measured at `86dc5eeb5d` (the review round + S1).** The S10 change (newest over every Pine source,
> `b39a7b9828`) and the two floor follow-ups were railed and mutation-proved, and the four vitest roots,
> the Python rails and the mutant run were re-run at `b39a7b9828`; the census and harness re-measure at
> the new head is paused at the coordinator's request and is owed at the rebase onto engine 55. Expected
> moves: v6 computed-source ties drawn instead of withheld (none occurs in the captures), accdist-macd's
> Histogram floor.

## Census, measured at `86dc5eeb5d` (1,816 sources: corpus 266, repo `.pine` 507, committed vendor captures 173, licence-held sample 679, held capture store 191)
BEFORE = this tree with the merge base's product files (`cc608bb582`, engine 54) swapped in (`ast_interpret.py`,
`interpret.js`, `pine.js`, `pineRuntimeFrontend.js`, `thinkscript.js`, `closedTable.json`, `nativeRegistry.js`,
`vm.js`, `scriptEngineVersion.js`, `ourSide.js`, `compare.mjs`), restored from saved copies afterwards (`git
status` clean). AFTER = this head. Each source through the screen translation, the pane (`strict`),
`buildRuntimeIr` (300 synthetic bars, from the listing) and `memberPaneDefinition`, and the door's served
columns computed over the same bars.

- Guard changes: **0 at all four doors** (screen, pane, runtime, member door). (Before the S1 rules the
  runtime door had 5 `OK -> pine:bool-na-unwitnessed`; with `==` / `!=` served as Pine answers they are
  gone.)
- Translations that changed: screen 14, pane 16, door 23 rows; served columns 15 sources (A1's step,
  A3's value forms, S4-2's `tieNewest`). No translation errors.
- **Quantified (review finding 5), member door, 942 sources with served columns, 5,290 plots:**
  fully blank plots 986 -> 985; NaN bars 444,889 -> 443,867; **bars withheld by name: 0** (no
  `pine:bool-na-unwitnessed` or `pine:tie-unwitnessed` bar anywhere in the census; the review head
  `f4601e45a1` withheld whole plots, e.g. `ta.barssince(up != up[1])` 666 of 666 bars, and the first
  review-round cut 600 bars of `zig-zag-channels-luxalgo`).
- Plots newly fully blank: 2, both the marker plot of `accumulation-distribution-with-markers` (sample and
  held copy) on the synthetic bars. There `ad` falls monotonically, so `adSmaller` is true on every
  computed bar and the marker (`adSmaller == true and adSmaller[1] == false`) fires only where
  `adSmaller[1]` is the warm-up `na`: engine 54 drew a marker on that bar (bar 14), which is exactly the bar
  TradingView draws `na` (the A3 witness). **The values were wrong, so the gate holds.** On RDDT the same
  plot MATCHes TradingView (value level 1 -> 0, below). Plots no longer blank: 3
  (`08-smoothed-heiken-ashi-candles`, A1).

## Vendor harness, both lanes, measured at `86dc5eeb5d` (BEFORE = engine 54's product files swapped in, as the census)
Committed fixtures (`tests/fixtures/vendor`, 376 files) and the licence-held store
(`runs/{ext,probes,probes2,s2,s3,s4,s5,s6}`, 246 captures; verdicts only, nothing committed). M/D/I counted
per capture id.

| set | lane | before M/D/I | after M/D/I | moves |
|---|---|---|---|---|
| fixtures | production (`RUNTIME_ON=0`) | 155/50/166 | 156/49/166 | pivot-high-low-points D -> M |
| fixtures | runtime-on (`=1`, upper bound) | 181/50/140 | 182/49/140 | pivot-high-low-points D -> M |
| held store | production | 136/78/27 | 140/73/28 | aroon, connors-rsi, pivot-high-low-points, rsi-divergence-indicator D -> M; obv-macd-ao-pivdiv-3 D -> I |
| held store | runtime-on | 145/80/16 | 149/75/17 | the same five |

**0 MATCH -> DIVERGE, 0 new DIVERGE, in every set and lane.** The S1 rules first moved
`rt3-na-logic` (v5 and v4) INCONCLUSIVE -> DIVERGE (`na(w or false)`: the identity fold had reduced
`w or false` to `w`, and `na(w)` read the warm-up `na`); a written `and` / `or` / `not` is now never `na` at
`na()` and at a plot (`writtenLogic`), and both are back where they were. pivdiv-3's only remaining item is
its hidden constant `0 line` (colour not resolvable on our side); all 29 of its value plots MATCH.

Value level (bars where the value or its `na` differs, summed over a capture's plots), held store, both
lanes identical: accumulation-distribution-with-markers 1 -> 0, average-true-range-trailing-stops 31 -> 0,
uptrick-volatility-weighted-cloud 84 -> 0, obv-macd-ao-pivdiv-3 3 -> 0, pivot-high-low-points 1 -> 0,
aroon 4 -> 0, connors-rsi 1 -> 0, rsi-divergence-indicator 4 -> 0, accdist-macd SPY 2 -> 2 (its Histogram is `sh and hist ? hist : na` through a same-symbol `security`; the floor now reads through both, `R4c` / `R4d`, after this run, not yet re-measured); **0 captures got worse**.
accumulation-distribution, the ATR trailing stop, uptrick, accdist-macd and bill-williams AO stay DIVERGE on
COLOUR only (the v1-v3 palette and default transparency: engine 57's lane).

## Mutants
### Phase 1 (at `301a351ec7`)
Copy aside, edit, run the focused rails (`engine56Values.test.js`; the harness mutants run
`vendorHarness.engine56FloatFloor.test.js`; the Python ones `tests/test_engine56_values.py`), restore FROM THE
SAVED COPY, `git hash-object` == the HEAD blob. Everything ran under one heavy lock. C0 (no edit) was green;
every restore matched the HEAD blob.

| # | mutant | red |
|---|---|---|
| M1 | A1: `nz` stripped from the step (`step: substitute(body)`) | 1 |
| M2 | A1: the ternary's `na(self)` test dropped (`step: update`) | 1 |
| M3 | A2: a `na` prior answers `na` | 3 |
| M4 | A2: divisor = the finite count | 2 |
| M5 | A2 Python: a `na` prior answers `na` | 2 |
| M6 | S4-1: a left-side `na` fails again (`pivotCol`) | 3 |
| M7 | S4-1: the same in the runtime kernel | 1 |
| M8 | S4-1: an all-`na` left window withheld | 1 |
| M9 | S4-1 Python: a left-side `na` fails again | 1 |
| M10 | S4-2: the newest dispatch off | 2 |
| M11 | S4-2: the tie mask off | 1 |
| M12 | S4-2 Python: newest off | 1 |
| M13 | S4-2 Python: tie mask off | 1 |
| M14 | S4-2: the runtime newest reducer off | 1 |
| M15 | S4-2: the runtime VM tie stop off | 1 |
| M15b | S4-2: the runtime `tieGuard` flag never set | 1 |
| M16 | A3: the served `==` not rewritten | 7 |
| M17 | A3 applied to v6 | 3 |
| M18 | A3: v4/v5 `or` / `not` withheld | 3 |
| M19a | A3: a v1-v3 `and` withheld | 3 |
| M19b | A3: a v1-v3 `and` loses its `maybe` | 1 |
| M20 | A3: the bool-na mask off | 8 |
| M21 | A3 Python: the bool-na mask off | 1 |
| M22 | the runtime's column decline off | 9 |
| M23 | the runtime's VM bool-na refusal off | 1 |
| M24 | S4-4: the floor ignored | 1 |
| M25 | S4-4: the floor 1e6 too wide | 1 |
| M26 | the harness grades withheld bars as values | 2 |
| M27 | the harness grades a withheld bar MATCH | 1 |

All 29 were killed. The first run's M19 (deleting `if (op === '&&') return built`) survived: the line was
redundant, because `&&` already falls through the `==` / `!=` test. It was an equivalent mutant, so the line was removed
and replaced by M19a / M19b, which test the rule itself.

### Review round, S1 and S10 (61 mutants and the C0 control at `b39a7b9828`, one lock; R4c / R4d / S1b re-run after their changes)
Same procedure; C0 green, 57 of 61 killed, 4 equivalent (named below), every restore equal to the HEAD blob (one run was cut by the disk filling and its
in-flight file, `ast_interpret.py`, was restored from the saved copy and checked against HEAD before the
re-run). The phase-1 rows above whose code the S1 rules removed (M16-M19b, M23's old pattern, R1e, R2b's,
R6a, R6c) were replaced:

| # | mutant | killed |
|---|---|---|
| M16 | `==` / `!=` over `na` not rewritten to the `na` value | yes |
| M17 | A3 applied to v6 | yes |
| S1a | a condition reads the value form's `na` arm as `na` | yes |
| S1b | a plotted `bool` keeps 0 where it is `na` | yes |
| S1c | `na(b)` ignores the `bool`'s `na` | yes |
| S1d | a number meeting a `bool` literal is untracked (withheld) | yes |
| S1e | `and` / `or` / `not` untracked | yes |
| S1f | a latch body's `and` / `or` / `not` untracked in the self pass | EQUIVALENT: the accum's own value then carries its `na`, and the number fallback reads it |
| M20 / M21 | the bool-na mask off (JS / Python) | yes (JS: the fallback-marker rail) |
| M22 | the runtime column decline off | EQUIVALENT since S10: no Pine column carries a withheld code any more (bool-na and ties are served), so the decline is the fail-closed path only |
| M23 | the runtime VM decline off | yes |
| R1a / R1b / R1d | the tf lift / valuewhen flag / var-bool flag recurrence off | yes |
| R1c | an untracked side served | EQUIVALENT: no reachable `bool` is untracked any more (0 in the census) |
| R2a / R2b | runtime bool slot / literal side not asked | yes |
| R3a / R3b / R3c | `tf` / `tf_merge` / `ltf` not nested (JS / Python) | yes |
| R4 / R4b / R4c / R4d | the floor accepts a ratio / reason not surfaced / stops at a same-symbol timeframe read / stops at a ternary | yes |
| R5a-R5e | barssince / valuewhen spread forever, a recurrence forgets (JS / Python) | yes |
| R7 | a nested child keeps the sink | EQUIVALENT: the parent records the same code after the child, and a mask of the wrong length is replaced |
| R8a-R8g | the runtime deferred `==` pass: off, comparisons / columns read as never `na`, slot writes not asked, history not kept, parameters dropped, `and` / `or` read as `na`-able | yes |
| R9a | the runtime drawn-value check off | yes |
| T1-T4 | the `tieNewest` mark off, not read as newest (JS / Python), the runtime newest reducer not asked for | yes |
| (dropped) | M15 / M15b (the runtime tie stop) and R6b (bar-price variables): the code is removed by S10 | - |


## Evidence ledger regrade, at `c244cee6bc` (`python tools/vendor_harness/evidence_engine.py regrade`, LICENSING 2c)
246 captures graded, ledger +246 rows at engine 56 (grader `a730737b43ef`); 0 legacy rows retired.
- 103 of the 246 already had an engine-54 row: **0 verdict moves** among them, in either lane.
- The other 143 (S3-S6 sessions) are filed for the first time.
- Totals at engine 56: production MATCH 140 / DIVERGE 76 / INCONCLUSIVE 30; runtime-on MATCH 149 /
  DIVERGE 78 / INCONCLUSIVE 19.
The ledger rows carry the source sha256 and the verdicts only; no capture or source text is committed.

⚠️ That regrade (commit `c244cee6bc`, phase 1) predates the review round, S1 and S10, so its engine-56 rows
describe the phase-1 engine. **No later regrade is committed** (coordinator rule 2026-11-15: the ledger's
`scriptKey` / `captureId` slugs trip the public-repo secret scan; the coordinator regrades centrally once
the owner rules). The verdicts this head produces are the harness tables above.

## The tie sentence and the strict xfail it settles
`highestbars` / `lowestbars` now read back as "the number of bars back to the bar holding the highest X of
the last N bars, the newest of a tie over a bar price and withheld on a tie over anything else"
(`docs/formulas/GRAMMAR.md` regenerated; the hand-typed inverse in `sentence.test.js` re-typed).
`tests/test_ast_tc2000_remainder.py::test_aroonUp_matches_the_published_formula_over_a_shaped_series` was a
strict xfail waiting for exactly this measurement ("until somebody reads it off a TradingView Aroon pane").
The S5 aroon capture is that reading, so the xfail is removed. `test_ast_bounded_state.py`'s constructed tie
(over `high` / `low`) now reads the newest bar, and a computed-source twin of it is withheld.

## Tests run (all under the heavy lock, `--maxWorkers=1`; pytest one file at a time)
- **`-v2`, on master `5443154808` (engine 56, #1264) + this change, head `389c81bcb2`** (one heavy lock
  per phase): focused rails (`engine56Values` and the rails it touches) green; mutants **76 + the C0
  control: 72 killed, 4 equivalent** (S1f, M22, R1c, R7, as before), every restore equal to the HEAD blob;
  vitest `engine/ast` **354 files / 6,029 tests green** (11 skipped); `engine/runtime` **196 / 4,153
  green**; **NOT RUN on this head (PARKED, PC restart): `builder`, `engine/__tests__` and the pytest list** (their
  locked runs were queued and stopped before they started). Before the rebase onto #1264, at `b39a7b9828`,
  `builder` was green and `engine/__tests__` failed only on files that fail on master too (above), and the
  focused pytest files are green on `1310dd2be3` (`test_engine56_values` 14 / 0). **Left for the train /
  the next session:** `builder`, `engine/__tests__`, the pytest list, the census + harness (both lanes),
  the engine number, the host-parity digests, the `service_smoke.json` re-record at that number, the
  section 8 list and the ledger regrade.
- vitest `src/components/chart/engine/ast` (351 files) and `runtime` + `builder` + `engine/__tests__`
  (798 files): every failure was triaged. Engine 56's own were fixed and re-run green, and the files named above
  were re-run green after the last edit (23 files / 972 tests; 7 files / 295 tests). These failures are not
  engine 56's: they fail the same way with `origin/master`'s product files (the UCT RS work on master):
  `colorUpDownSubstitution`, `markerPixels`, `readoutSchema.va2`, `rsRatingDef`, `rsVsEmaDef`.
- pytest: all 43 `tests/test_ast_*.py` + `tests/test_engine56_values.py` green. These fail identically with
  `origin/master`'s `ast_interpret.py` and `closedTable.json` swapped in, so they are not engine 56's:
  `tests/test_indicator_golden.py` (1: `rs_parity_deepvue_universe` fixture vs CASES) and
  `tests/test_c45_withheld_doors.py` (2: `time-clock:unreadable`).
- S10, at `b39a7b9828`, each root under its own lock: `ast` 351 files / 5,932 tests green (11 skipped);
  `runtime` 196 / 4,150 green; `builder` 193 / 3,178 green (incl. `savedDocumentRoundTrip`);
  `engine/__tests__` 409 files, 15 failed: the five UCT RS files, `b1Paints` (both above), and
  `c36TimeFollowups` / `c49CapturedClock` (the new tie sentence lacked "What would settle it"; fixed after
  the run, re-run owed). pytest: the six above plus `test_vendor_truth` green.
- Review round + S1, at `86dc5eeb5d`: the same four vitest roots in one run, 1,149 files / 20,461 tests:
  13 failed, 20,239 passed, 209 skipped; every failure is one of the five UCT RS files above or
  `vendorHarness.b1Paints` ("every capture that records a paint is pinned"), which fails on `origin/master`
  too (three 2026-11-14 captures master committed without pins). pytest `test_engine56_values`,
  `test_ast_interpret`, `test_ast_scalars`, `test_ast_lookback_agreement`, `test_ast_bounded_state`,
  `test_ast_tc2000_remainder` green. The harness floor change after it re-ran its own rail and the held store.

## Review round (#1265 at `f4601e45a1`): findings 1-7, then the S1 rules
Each finding fixed in this PR, railed, and mutation-proved. The S1 witnesses (above) then replaced the
withholding the first cut of findings 1, 2 and 5 relied on with Pine's own answers.

1. **No untracked `bool` reaches `== false` with the comparison's 0.** `naInfo` follows a `bool` read on
   other bars (`tf` / `tf_live` / `tf_merge` / `sym` / `ltf`: the child's flag lifted through the same node),
   a `valuewhen` of one (the source's flag at the occurrence), `nz(b, S)`, a `var bool` (its own flag
   recurrence; a step flag that does not read its own past is that step's flag; a static-`na` seed is
   `na`), and a number meeting a `bool` literal (`na` where the number is). Rails: v4 `security(…, "W",
   close > sma(close, 20)) == false` is 0 for the first ~80 daily bars (it served 1); the `valuewhen` form
   is 0 while the chosen comparison is `na`; a v1 latch is served on all 666 bars; a latch whose arm is a
   comparison over `na` gives `x == false` 0 there; a zig-zag's `na`-seeded numeric state meets `== 1` /
   `!= 1` served. Only a `bool` this engine cannot follow is still withheld (`boolNaWithheld(side, 1)`); the
   census holds none.
2. **The runtime lane declines a `bool` slot whose `na` it would read as false.** `== / !=` over a `bool`
   that can be `na` is decided over the whole lowered program (`boolNaFaithfulness`): served where every
   write of what it reads keeps `na` as `na` in the VM AND the result is read as a condition; declined
   where a write is a comparison over a value that can be `na` (`up := close > ta.sma(…)`, `up := close >
   s` with `s := ta.sma(…)`), or the result is drawn as a value (v2 `plot(b == true)`). `and` / `or` /
   `not` are served. Rails for each; the door draws Pine's answer (`up != up[1]` is 0 on bars 0..19).
   ⚠️ The first cut declined every `bool` slot at `==`; the full suite caught it (five v5 runtime controls
   and `volume-divergence-by-mm`), and all six are served again.
3. **Every nested read on other bars masks a witness site under it, both lanes**: `WITNESS_NESTED` /
   `_WITNESS_NESTED` = `sym`, `tf`, `tf_live`, `tf_merge`, `ltf`. The Pine door no longer leaves a witness
   site (S1, S10), so the rule is railed on this engine's own trees: a computed tie under `tf` / `tf_live`
   / `tf_merge` "W" withholds every bar with a mask of the chart's length (finding 7); the same source
   through the Pine door under `request.security(…, "W", …)` at v5 / v6 is drawn; a tracked `!=` under it
   is Pine's answer.
4. **The float floor is for a linear combination of totals only** (S4-4 above). Rails: a VWAP-shaped plot
   with a 1e-7 relative error DIVERGES; accdist-macd's shape (also through a same-symbol `security`) keeps
   its floor; another symbol's does not; the reason states the floor's bars.
5. **The withholding ends where the answer no longer depends on the unknown bars** (`witnessMask`, both
   lanes): `barssince` after its next known-true bar, `valuewhen` after `n + 1` known occurrences, windows
   by reach, `offset` shifted; a recurrence keeps withholding. With S1 and S10 nothing a Pine script draws
   is withheld, so the rails run over this engine's own trees (a computed tie): `cum` withholds every later
   bar; the bounded `barssince(c, 30)`, `valuewhen` and the bare `barindex - valuewhenOccurrence(…)` withhold
   fewer and draw after. **5b**: `x = close > open ? 1 : na; x != 1` is a number compare, served.
6. `and` / `or` / `not` are never `na` (every version, S1); a variable whose every write is a bar price
   names the newest tie on the runtime lane (now the rule for every source, S10).
7. Nested `sym` / `tf` / `tf_merge` / `ltf` child interpret calls drop `withheldBarsSink`.

## Re-review of `c5715efa9b` (FIX FIRST): items 1-7
Code and rails are written; the rails and mutants run at the coordinator's go (heavy runs paused), and
this section takes their numbers then.
1. **HIGH, runtime.** A pure subexpression lowers to ONE `EXPR.COLUMN`, which `mayBeNaBool` did not ask:
   `(close > ta.sma(close, 20)) != inPos` (a latch written only with literals) drew TRUE on the warm-up
   where Pine and the door draw false. A `bool` column (`pine.js::isBoolishTree`, now exported) that is not
   known on every bar (`canonNeverTree`, hoisted so both checks read one rule) is now a side that can be
   `na`, and so is a history read of one; the whole-program check then declines it by name
   (`canonKeeps`). Rails: the latch "state changed" form, `trendCol[1] == inPos`, and a never-`na` column
   (`(close > open) != inPos`) still served, equal to the door. Mutant RR1.
2. **MEDIUM, v1 / v3: withheld until probed, then served (s18).** A condition (`and` / `or` / `not`
   operand, a `?:` test) that reads a `bool` VALUE form `naArmsReadFalse` cannot reach (under an offset,
   another read) is read as `x != 0` (`pine.js::legacyBoolNaCondition`, `stripBoolNaValues`): `na` is
   false in `and` / `or` and a `?:` test, `not na` is true. v2 by S1; v1 and v3 by **s18-2026-11-15**
   (`vw-cs2-bool-na-v1-cum` / `-v3-cum`, NYSE:RDDT 1D from the listing): `(c != false)[1] and x` is 0 on
   every warm-up bar, BAR 0 INCLUDED, where engine 54 and the first cut of this item drew `na` there (the
   first cut withheld bars 1..4 by name per the coordinator's ruling and left bar 0 a blank). The witnessed
   v1 `==` form (AD bar 14) is untouched. Rails: every bool plot of both captures (B, RB and H rows, plots
   0, 2-24) on every bar, the H rows on the runtime lane (served equal, or declined by name), a Python
   rail on the cast tree, and the synthetic sites at v1 / v2 / v3. Mutants RR2a (rule off), RR2b
   (withheld instead), P12 (v1 / v3 `na` restored).
3. **MEDIUM.** The stale ledger rows go with the `-v2` rebuild (no ledger commit); census and harness are
   re-measured on its final head (banner above).
4. **LOW-MEDIUM, harness.** `linearTotalsOf` carries the factor each total reaches the plot by (`|c|` for
   `total * c`, `1 / |c|` for `total / c`, constants folded); a non-constant multiplier or divisor, or a 0
   divisor, gets no floor. Rails: the factors, the refusals, and OBV / 1e9 with a 1e-7 relative error
   DIVERGES (the unscaled floor would have admitted it). Mutants RR4a / RR4b; R4 re-pointed.
5. **LOW.** `pivothigh(src, left, right)` at centre c reads c-left .. c+right, so an unknown bar u reaches
   centres u-right .. u+left: the `witnessMask` / `_witness_mask` arguments were swapped. Rails with left 2,
   right 5, both lanes. Mutants RR5a / RR5b.
6. **LOW.** `crossover` / `crossunder` / `rising` / `falling` are `na` where the engine's own column is
   (`naInfo` flag `na(t)`), so `crossover(close, warm) == false` is `na` on the warm-up, false as a
   condition; nothing beyond that is claimed. Rail on all four. Mutant RR6.
7. **LOW.** `valuewhenOccurrence` no longer clears its occurrences on an `na` condition: an `na` condition
   is false (neither fires nor forgets), both lanes, as the runtime lane's `valueWhenPineStep` already did.
   The rail that pinned the old reset (`pineValuewhenOccurrenceAccept.test.js`) now pins the new rule; a
   Python rail is added. Mutants RR7a / RR7b. Expected census move: a bare v1-v4 `barssince` /
   `valuewhen` over a condition with `na` bars mid-series keeps its count across them.

## Open notes
### Fixed, witnessed
- s18 B05 / B08 (v1, v3): `c and true` / `c or false` are never `na`, but the identity fold left `c`,
  which `enc(v) => na(v) ? ...` read as `na` through the parameter (-1 on 19 warm-up bars). A `bool` that
  can be `na` now keeps its operator (`pine.js::boolNaOperator`). Mutant P12b.
- rising/falling over an na source: probe 11 (s17-2026-11-15, NYSE:RDDT 1D from the listing, v4 and v5,
  `vw-cs2-rising-falling-na-v4/v5-rddt-1d-2026-11-15`) reads FALSE on every warm-up bar for lengths 1 / 2 / 5;
  this engine withheld the first `n` samples (`na`). The warm-up gate is removed in both lanes
  (`interpret.js::monotoneStep`, the runtime lane's own step; `ast_interpret._monotone_col`). Rails on both
  captures, every plot, every bar (JS) and the six columns (Python); mutants P11a / P11b.

### Rulings on them (coordinator, 2026-11-15): fixed
- **(a) `NA_CONDITION_FALSE_FROM_VERSION` 4 -> 1.** S1 (v2) and s18 (v1, v3) witness the v4 / v5 condition
  rules at every version: a v1-v3 `?:` with an `na` test takes the else branch (s18 H02 `c[1] ? 1 : 0` is 0
  on bar 0), `and` / `or` read `na` as false, `not na` is true. ONE authority: `interpret.js::
  naConditionIsFalse`, asked by the host (`memberPaneDefinition` writes `naConditionFalse` from it;
  `pine.js::naOperandReadAsFalse` casts `and` / `or` / `not` operands) and the runtime (`lowerIr.js` and
  the frontend's pure columns). A PINE script with no `//@version` is v1 (`pineNaConditionIsFalse`;
  `Resolver.pineScript` keeps thinkScript's `null` version out of it). **`legacyBoolNaCondition` and
  `stripBoolNaValues` are DELETED**: the general rule covers what they did at `and` / `or` / `not` (the
  operand cast) and at a `?:` test (the listing rule). What it does not cover, said here: off the listing
  a v1-v3 `?:` over an `na` test keeps the shared answer (as at v4 / v5; there a `NaN` can mean "not
  computable from this window"), and a value form under an offset at a builtin's bool argument or an
  object guard is no longer cast (v4 / v5 never were). Rails: s18 v1 / v3 every plot on every bar through
  the member door (H02 bar 0 now MATCH), the S1 v2 capture (B / RB rows), the synthetic v1 / v2 / v3
  sites, and the three rails that pinned "below v4 nothing is claimed" now pin the ruling. Mutants P13a
  (start back at 4), P13b (no-pragma not v1), P13c (Resolver reads a no-pragma Pine script as the house
  language). Census moves are wrong-value fixes (recorded in the census section).
- **(b) The runtime lane draws none of them wrong.** The condition rule is the same predicate (above), so
  `raw(c == false / != false / == true)` and H02 bar 0 are SERVED equal to TradingView. `enc(c)` and
  `enc(c[1])` (`na()` of a comparison over `na`, which the VM holds as 0) DECLINE by name
  (`pine:bool-na-unwitnessed`, `boolNaFaithfulness`'s new `na()` check: served only where the VM holds the
  `bool`'s `na` as `na`). Rail: every bool plot of both s18 captures on the runtime lane, one plot per run,
  served equal or declined by name; the named forms asserted served / declined. Mutant P13d.

### Notes
- A3 / S1 / s18: v1 and v3 are now witnessed directly (s18) and follow the v2 / v4 / v5 rules. The runtime lane serves `==` / `!=` over an `na`
  bool only as a condition; a VALUE use it cannot show as `na` declines. `boolNaWithheld` remains as the
  fail-closed path for a `bool` this engine cannot follow; none occurs in the census.
- S4-2: newest over every Pine source (S1, S10); divergences.json's oldest-wins row is refuted. The
  2026-09-08 measurement is not reproduced by any later capture; its probe's offset convention is the
  unresolved suspect. v1-v3 bare `highestbars` / `lowestbars` refuse by name (sign unstated).
- S4-3 (ytc-swing-highs-lows `max_bars_back`): S1 shows `max_bars_back` has no effect; its DIVERGE is the
  v3 default transparency (engine 57's lane).
- Colours (section B) are engine 57's. The ATR trailing stop, accumulation/distribution markers, uptrick,
  accdist-macd and bill-williams AO now differ from TradingView in colour only.

## Train-owned (landing train 1, 2026-11-16): the built-in `na(x)` is never `na` on the runtime lane
Coordinator ruling 2026-11-15 (option a). The engine 56-v2 builder had left; the train owns this fix, and it
is a behaviour change attributed to engine 56-v2.

- **What was wrong.** `pineRuntimeFrontend.js::boolNaOnThisLane` asks every side that meets a WRITTEN `true`
  / `false`, and nothing in the whole-program check (`boolNaFaithfulness`) read the built-in `na(…)` as a
  `bool` that is never `na`. This branch was built on master before RS Rating (#1342). On the combined tree
  the ORIGINAL RS Rating script (`docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`, line 262:
  `ta.barssince(na(curveRsPerf) != true)`) lost its run half (the rating labels), declined
  `pine:bool-na-unwitnessed`, and master's acceptance rail `engine/requestSeed.test.js` went red. Bisected
  over the train's merge chain: green on master `f5ea27f37a` and through the engine-57 merge, red from this
  branch's merge on.
- **Basis.** TradingView's Pine Script User Manual, Type system, "`na` value"
  (tradingview.com/pine-script-docs/language/type-system, read 2026-11-15): "Scripts can test whether the
  result from a variable or expression is na by using the na() function. The function returns true if the
  value or reference is undefined. Otherwise, it returns false." A plain `bool`: `na(x) != true` holds no
  `na` for this lane to lose.
- **Change, the built-in only.** `canonNeverTree` reads a canonical `na(…)` call as never `na` (only the
  table's own `na` reaches a canonical tree by that name), and the whole-program `never()` reads the lowered
  built-in (`irBuiltin('na', …)`; a script's own function lowers to `EXPR.CALL`). `nz` and a comparison
  that merely holds an `na(…)` are not cleared. Whether the VM computed `na(b)` right is still
  `boolNaReads`' question, unchanged. Twins: the Python lane has no such list (`bool_na_mask` reads the
  translator's own `boolNaWithheld` markers) and the host lane already draws `na(x) != true` (`naInfo`), so
  neither moved.
- **How many scripts.** Over the train's 2,505 census sources (corpus 266, repo `.pine` 550, licence-held
  sample 679, committed captures 366, held captures 644): on the runtime PANE door `pine:bool-na-unwitnessed`
  is 6 before and 6 after (the two `vw-cs2-rising-falling-na` probes, three copies; no `na(…)` in them). On
  the member door's RUN HALF (both panes on) it is 3 before and 0 after, and the three are RS Rating (the
  repo script, the committed ALAB capture, a held NVDA capture); run halves minted 34 -> 37; no other
  source's run half or door status changed.
- **Rail.** `engine56Values.test.js`, "landing train 1 — the built-in `na(x)` is never `na` on the runtime
  lane": `na(x) != true`, `na(x) == false` and `ta.barssince(na(x) != true)` served and equal to the host
  lane on every bar; a `bool` slot written by `na(…)`; the lowered built-in over a value the VM steps; RS
  Rating attaches with its run half. Controls: a slot written by a comparison that can be `na`, one that
  holds an `na(…)` beside such a comparison, `nz(c)` in the same place, a script function, and a script
  function named `na` are all still declined.
- **Mutants.** See the train PR for the run on the final tree (canonical entry off, whole-program entry
  off, every lowered built-in cleared). A fourth entry at the site itself survived its mutant (the
  whole-program entry answers the same site) and was removed rather than kept unproven.
