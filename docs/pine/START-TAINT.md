# START-TAINT: serving a run off the listing only where its value cannot depend on the chart's first bar

Status: DESIGN APPROVED (e103, coordinator 2026-11-27). Built in the order below, one reviewable PR each (PR 1: the CFG /
write-set pass, `runtime/taintCfg.js`, #2924; PR 2: the VM's tags, `runtime/vmTaint.js` GENERATED from `vm.js` by
`app/scripts/gen-vm-taint.mjs`, the algebra in `runtime/taintTags.js`). Supersedes the two-start curtain (`computeOffListing`, off since #2893) as the
way an off-listing runtime run is released.

**Taint and history parity are complementary.** History parity (#2902, `docs/pine/HISTORY-PARITY.md`) makes our run
START on TradingView's first bar (`tvRunStart`), after which every value, recurrences included, is exact by
construction: a run proven to start at `tvRunStart` needs no taint. Taint is for the runs that cannot start there (the
chart holds less history than TradingView's first bar): it releases what is provably start-free and withholds the rest
by name.

## The rule

TradingView runs a script from the first bar IT holds. Off the listing we do not know that bar, so a value is served
only when it is the same for EVERY earlier first bar. The VM proves that per value by tracking where each value came
from (taint), instead of comparing two runs (which can agree by accident: order-block-finder's `var latest_bull_high =
0.0` held 0 in both runs where an earlier start holds 5.7).

A value is CLEAN when it is computed only from inputs whose values at this bar do not depend on the run's first bar.
A column bar, or a drawing property, is released only when it is CLEAN; anything else is withheld by name
(`runtime:start-tainted`, one sentence per output or drawing call). The listing run (`historyFromListing`) is not
touched: taint runs only on an off-listing run, which today serves nothing, so the served path pays nothing.

## The lattice (one tag per value)

| tag | meaning | examples |
|---|---|---|
| `C` clean | the same on every earlier start | `close`, `time`, `close / spx`, `ta.sma(close, 20)` on bar >= 19 |
| `O` offset | clean up to ONE additive constant, the number of bars before our first bar | `bar_index`, `last_bar_index`, a `var int` that is `bar_index` stored |
| `T` tainted | may differ for another start | a `var` before it is overwritten from clean values, `ta.ema`, `close[k]` before bar k, `bar_index * 2` |

`O` exists because drawings are placed by `bar_index`: `label.new(bar_index, rs)` lands on the same bar whatever the
start. Rules: `O +- C -> O`; `O - O -> C`; `O cmp O -> C`; `O` as an `xloc.bar_index` coordinate -> fine; an `O` moved
(stored, loaded, read back from history: `bar_index[k]`) stays `O`; every other use of `O` (`*`, `%`, compared with a
`C` number, `str.tostring`, plotted, a branch condition) -> `T`. Join = max (`C < O < T`) with the `O` exceptions above.
⛔ An `O`-tagged history OFFSET is `T` (ruling 5): `close[bar_index]` and `close[bar_index - 5]` reach back to the run's
first bar, which another start does not hold; only a `C` offset (`bar_index - bar_index[1]`, an `O - O`, included) is
clean. ⚰️ This line said "`O` as ... a history offset -> fine" until part 2 (2026-11-27).

## Sources (where taint enters)

1. Every `var` / `varip` slot starts `T` (TradingView's slot holds what its earlier bars left). Plain locals are
   re-initialised each bar and start `C`.
2. A history read that reaches before our first bar: `x[k]` at bar `i < k`, for series, slots and columns.
3. `bar_index`, `last_bar_index` -> `O`; `barstate.isfirst`, `math.random` (seeded sequence) -> `T`.
4. Built-in state (`WINDOW`, `CARRIED`, `CARRIED2`, and the columnar lane's precomputed `READ_COLUMN` trees):
   a finite window of length `n` is `C` at bar `i` iff `i >= n - 1` and every input in the window is `C`
   (a ring of taint bits, a count); a recurrence (`ema`, `rma`, `cum`, `atr`, `rsi`, ...) is `T` forever once its
   state is `T` (exact: an exponential decay is never zero), unless that built-in has a WRITTEN forget rule
   (`barssince` / `valuewhen` become `C` at the first `C` event). Unknown built-in: `T` (fail closed). Columns get a
   static `cleanFrom` per tree node from the same table (`interpret.js` node -> rule), computed once per build.
5. The strategy broker: every `strategy.*` read is `T` (positions carried from earlier bars).
6. `request.*`: the sub-run is tainted by the same rules over ITS series and first bar; an aligned read carries the
   requested bar's tag; the existing first-period and calendar masks stay as they are.

## Propagation

- Stack, locals, persist slots and each slot's history ring carry a parallel tag array (a `Uint8Array` beside each
  `Float64Array`; one byte per value). Every opcode's result is the join of its operands (`SELECT`: the condition
  too). A `STORE` overwrites the slot's tag: a `var` written from `C` values on every path becomes `C` (the
  latch-after-event case: `var float last_high = na` is `C` from the bar it is first set from a clean high).
- IMPLICIT FLOW. Bytecode branches are `JUMP_IF_FALSE` / `JUMP` / `LOOP_TICK` / `WHILE_BOUND`. Once per program, a CFG
  pass finds each branch's join (immediate post-dominator) and the set of slots, collections, drawings and emits
  written anywhere between them (both arms, loop bodies, called functions). When a branch condition is `T`, every
  member of that write set is tainted at the branch (the arm not taken may have written it), and every write until
  the join is `T` (a pc-taint counter). An emit under a `T` branch taints that output bar. ⛔ So is every value an
  arm leaves ON THE STACK: a ternary lowered to branches (`a ? x : b ? y : z`, an `and` / `or` short-circuit) pushes
  its result inside the region and stores it after the join, so the region records the stack height at the branch
  and taints everything above it when it closes (and at a `RET` that closes it). ⚰️ Missing until e105: the two-start
  oracle found kernel-channel's `midColor = midline > midline[1] ? up : ...` released clean on bar 0 from the arm's
  constant, 234 wrong released bars over 4 of 11 scripts; rail `taintVm.test.js` (a value an arm leaves on the
  stack), mutant E105-JOIN-STACK.
- Collections (array, map, matrix, UDT record): one tag per container, joined on every write; any read is the
  container's tag joined with the index's. (Per-element tags are a later refinement, only if the census asks.)
  Fred RS's `var float[] different_values` is therefore `T` for ever: its `includes` test steers its own writes.
- Drawings (`objectStore.js`): each object carries an existence tag (the pc taint and handle tag at `*.new`) and a
  tag per property (joined at each `set_*`). `delete` / a setter through a `T` handle taints the existence or that
  property of EVERY live object of its family (it might have been any of them). The collector (`max_*_count`):
  which objects survive depends on how many were made, so if any creation in the family was `T`, every survivor's
  existence is `T`. A drawing is drawn when its existence and every DRAWN property are `C` (or `O` for an
  `xloc.bar_index` x); otherwise that call site is withheld by name, the rest drawn.

## Release

Per output: a per-bar tag column; bars whose tag is not `C` are `NaN` with the code `runtime:start-tainted`
(`withheldBarsReport`), so a plot is drawn from the first clean bar, with holes where a later branch re-taints it.
Per drawing: as above. A run half's rails (column, object) compare only released bars and drawings, exactly as
`computeStartFree` (task B, #2919) does for Fred RS today; B's special case is then one instance of the general rule
and is retired once the census shows the general rule releases what B releases (the dots; off a daily chart both
constant labels) and, it predicts, one more thing: on a DAILY chart the "RS Rating" heading (constant text, position
`(O, C)`) is `C`, so only the number label stays withheld.

## Proof

- Rails per source and per propagation rule (a fixture each, each with its mutant: drop the rule and the fixture's
  released value is wrong).
- THE CENSUS: every corpus script the member door puts on the runtime lane, on the six series of
  `curtainCensus.*.measure.test.js` (SPY 1D, AAPL 1D, JPM 1D, SPY 60, SPY 1W, NVDA 1W): the off-listing run's
  RELEASED values and drawings against a run from an earlier start. Bar: `wrong == 0` on all six, and the count
  released (the recovery) reported per script. Mutants of the census: switch off source 1, 2 or 4, or the implicit
  flow, and the census must go `wrong > 0` (else it cannot fail).
- A second earlier start (two different earlier starts, both compared) so a value that agrees with ONE earlier start
  by accident is still caught.
- Then: the 15 assistant recipes now marked `historyScope: 'fromListing'` (#2908) and the census docs are re-read
  against the census; a recipe is moved back only where its outputs are released.

## Cost

Only off-listing runs pay. Expected 1.3-2x VM time there (a tag load and an `or` per operand). The listing run takes
the untouched dispatch loop (a separate taint-enabled loop, chosen once per run, never a flag test per opcode).

MEASURED (`taintDifferential.test.js`, `RUNTIME_PERF_CENSUS=taint`: the runtime corpus through the product path, SPY
1D, 5,000 bars, fastest of 3 each, a GitHub runner; per-script ratios over scripts of 5 ms or more):

| loop | total | median | p75 | max |
|---|---|---|---|---|
| e104 (048b1c4303) | 2.95x | 2.78x | 3.45x | 4.32x |
| e105 (b521879259) | 1.68x | 1.70x | 1.88x | 2.67x (a 5.7 ms script; the worst above 50 ms: 2.33x) |

Two causes of the first measurement (2.95x total), both in how the loop is generated,
neither in the tag rules: (1) `vm.js`'s module constants (`ADD`, `LT`, `PW`, ...) reached the generated loop by
import, and under vitest an import is a namespace property read (a Proxy where a test mocks `vm.js`) on every
arithmetic opcode: the generator now binds them to locals once per run; (2) the joins were calls (`tAdd(...)`) that
competed with the value code for TurboFan's inlining budget in one very large function: the generator now inlines
them from `taintTags.js`'s own text (`gen-vm-taint.mjs::INLINED`).

## Build order

1. CFG + write-set pass over the lowered program (pure, railed on its own).
2. VM tags: stack, slots, history rings, sources 1-3, implicit flow; outputs' tag columns. BUILT (e104): the taint run is
   `vmTaint.js::executeTainted`, generated from `vm.js::execute` (tag statements inserted after every case label and at
   five anchors; a case with no tag rule stops the generator; `vmTaintGenerated.test.js` requires the committed file
   to be the generated one, so the two loops cannot drift). `execute` is untouched: the listing run pays nothing. The
   taint run computes `execute`'s values bit for bit over the runtime corpus (`taintDifferential.test.js`). Until
   their own parts, built-ins, collections, records, drawings, requests and broker reads answer `T` (fail closed), and
   a column's tag is one per column (`taintTags.js::columnTagsOf`: a bare `bar_index` / `last_bar_index` is `O`, a
   pointwise tree over the bar's prices is `C`, anything else `T`). Nothing consumes the tags yet (part 6).
3. Built-ins: `WINDOW` / `CARRIED` / `CARRIED2` table, the columns' static `cleanFrom`.
4. Collections, records; then drawings in `objectStore.js`.
5. `request.*` sub-runs; broker.
6. Release in `runtimeColumns.js` (replaces the curtain behind `_offListingCurtainOn`'s place), the run half's rails.
7. The census, its mutants; then the recipes and docs.

## Rulings (coordinator, 2026-11-27)

1. EXACT. No tolerance rule: a recurrence (`ta.ema`, `rma`, `cum`, ...) whose state is `T` stays `T`. Recurrences are
   recovered by history parity (#2902), not by taint.
2. `O` is approved, with the rule as written: `O` only as an `xloc.bar_index` x (corrected by ruling 5: NOT as a history
   offset); `O` shown as a value, in text or plotted is `T`. Rails: `bar_index` in a label's TEXT is `T`; `bar_index` plotted is `T`.
3. A new code, `runtime:start-tainted`, for the general rule. Task B's `runtime:start-latched-state` stays until the
   census proves the general rule covers B; B is retired in the same PR that switches.
4. Smallest reviewable PRs, each based on master, each a DRAFT until green; a PR that changes the VM is NUMBER PENDING.
   The 1.3-2x off-listing cost is acceptable; the measured number is recorded per census series.
5. (2026-11-27, part 2) An `O`-tagged history offset is `T`: `close[bar_index]`, `close[bar_index - 5]` reach back to
   the run's first bar. Only `C` offsets (an `O - O` included) are clean; `bar_index[k]` read back stays `O`. Rail:
   `taintVm.test.js` (close[bar_index] is T), mutant E104-OFF.
