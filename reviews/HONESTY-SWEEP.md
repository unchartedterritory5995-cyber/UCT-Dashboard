VERDICT: NO-GO @cc37660d4c

Lane HONESTY-SWEEP (`origin/fix/pine-honesty-sweep-2026-11-07`, one commit `cc37660d4c` on base `f38b65c55f`).
Independent desktop review, 2026-11-07, node 20.20.2, `--maxWorkers=1`.
Method: a detached worktree `pine-rv-honesty` with node_modules as a junction to pine-base. Master's 7 changed engine
sources (from `f38b65c55f`) were swapped in by copy for every A/B comparison and restored by copy. `git status` was
clean on tracked files after each swap. No lane code was edited and nothing was pushed.

## BLOCKING (one item; the fix is small)
B1. **The lane turns an existing master rail red.** The failing test is
`app/src/components/chart/engine/__tests__/switchValueForms.vendor.test.js` >
"CONTROL - an option no arm covers could be `na`, so the size is dropped, not guessed".
- At line 103 it asserts `the cell itself still draws`. At the tip the cell is withheld as `enum:na`, so the
  test fails.
- It is GREEN with master's sources and RED with the tip's (A/B in the same tree).
- The builder's full run covered `engine/ast` and `engine/runtime` only. This file lives in `engine/__tests__`.
- The behaviour change itself is the lane's intent (item 1). The rail still encodes the old ruling "the prop is
  dropped and the cell draws".
- Required fix: rewrite that CONTROL to assert the withholding: no cell, `dropReasons['enum:na']`, and the
  sentence. Keep its covered-options half, which still passes. Then re-run `engine/__tests__` and `builder`, not
  only ast/runtime.
- Other reds in that sweep are the SAME on master's sources, so they are not this lane:
  - `controlDoorCensus` BULK_BLOB_SITES
  - `vendorHarness.test.js:435`
  - `priceFormatMinMove.realChart` (4 tests)
  - `stockChartWiring` "all three share one autoscaled band"
  - `coverageAudit` delta-rsi RDDT, which reads INCONCLUSIVE on both.

## (a) The 5 "now draw the input's style" scripts: NOT an over-serve
I dumped the door output (`memberInputTranslation(translatePine, ..., memberPaneDefinition's options)`, i.e. the ops
and `objectDiagnostics`) at master and at the tip for all 9 scripts.

| script | master | tip | backed? |
|---|---|---|---|
| market-structure-by-leviathan | 4 lines with `style` ABSENT (`enumUnreadable` 4), so the renderer drew solid | ops 1, 5 (halfStyle 'Solid') resolve to `solid`; ops 6, 8 (bosStyle 'Dashed') resolve to `dashed` | yes |
| linear-regression-channel-tradingfinder | 5 lines with `extend` absent | `extend` chain whose condition trees fold to the default 'Extend None', so `none` | yes; same picture as master at the default |
| heikin-ashi-tsi-ott-erebor | 4 cells with `text_size` absent | `tiny` (default "Tiny") | yes |
| smoothed-gaussian-trend-filter-algoalpha | 9 cells with `text_size` absent | `tiny` | yes |
| smart-money-volume-activity-algoalpha | ops null | ops null | diag-only change; nothing drawn on either side |

Mechanism:
- Each new value is what Pine's `switch` computes from the input's stated value. The inputs are folded at the
  author default, or at the member's pick.
- Coverage means every `options` entry has an arm. `input.string` constrains the value to its `options`, so the
  default-less switch cannot miss. That is the same rule master already applied to a top-level switch with named
  `options`.
- Master drew the RENDERER's default there, which was wrong whenever the default is not solid/normal. For example,
  BOS 'Dashed' was drawn solid, and size "Tiny" was drawn at the default size.
- So the tip replaces an unbacked default with the computed, stated value. That is not a new over-serve.

Correction to EVIDENCE.md: smart-money changes no drawing (ops null on both sides). The "5 now SERVED" is 4 scripts
that actually draw differently, plus 1 that changes diagnostics only.

## (b) What still serves (each is backed)
Served shapes:
1. A default-less `switch` whose subject resolves, through `expr` bindings only (a `var` with `:=` breaks the
   chain), to `input` / `input.string` with string-literal `options`, and whose arms cover every option. This was
   pre-existing for named `options`.
   - NEW: `options` read as the 3rd positional argument of `input.string` when the first three arguments are
     positional. This matches the v5/v6 reference signature, and v4 has no `input.string`.
2. NEW: the same switch in a helper whose subject is a helper PARAMETER, called with a POSITIONAL argument that
   resolves as in (1).
3. NEW: a ternary chain in which:
   - every test is `<one name> == '<lit>'` (either side);
   - no yes-arm is `na`;
   - the tail is `na`;
   - the labels cover the name's input options.

   The `na` tail is pruned.
4. Pre-existing C10: a test that is constant after input folding answers with its live arm. My probes `E` (mixed
   subjects) and `H` (`!=`) serve only through this, at the folded value, where the `na` is not reached.

My probes and their results:
- Covered helper with two params serves.
- A wrong-index param withholds.
- A `var` + `:=` subject withholds (both switch and ternary).
- A nested `na` inside a yes-arm withholds.
- Reversed `"A" == mode` serves.
- A 4th positional (tooltip) serves.
- v5 positional serves.
- A live `plot` input serves.
- `xloc = c ? xloc.bar_index : na` withholds.
- A v4 ternary with `na` withholds.
- `text = c ? "x" : na` stays `""` (F4 control).

## (c) Refusals: by name, both lanes, queue rows Q-HS1..6 present, probes vw-hs1..6 present (6 targets in capture-queue.json)
- item 2: v3 bare `highestbars`:
  - host `pine:builtin`;
  - runtime `runtime:statement` (or `pine:builtin` through the frontend);
  - both carry `LEGACY_BARS_SIGN_SENTENCE`.
  - v4 two-argument, v4 one-argument, v5 `ta.highestbars` and the no-`//@version` form are all served.
  - The v3 `highest` neighbour is served.
  - The v4 reference serve per W34-I6c is intact.
- items 3 and 4: runtime only. The host lane refuses collections anyway (`pine:collection` / `pine:type`).
  - Neighbours served: an int key and a colour VALUE (map); a real `matrix.row`, `matrix.col` and a non-empty fill.
- item 5:
  - Refuses only when BOTH number words are written.
  - Served: `array.from`, untyped `array.new_int`, matching `int`/`int`, and an untyped param.
  - Overloaded methods are routed per-overload (`name#ty`), so the wrong overload is not consulted.
- item 6: these are not refused:
  - an end-of-line comment;
  - a blank-line gap (recorded residual);
  - a comment line before the next arm.
- Over-refusal (safe direction, NOTE):
  - `st("A")`, a helper switch called with a LITERAL, is now withheld although Pine's answer is fixed (dashed).
    Master drew it solid.

## (d) The withheld script and the 3 shape-only scripts
- swing-points-and-liquidity: the object program is null on BOTH sides. Only the drop reason changes
  (`geometry:lost` / `droppedProps` becomes `enum:na` x2).
  - The member-visible drawing does not change. EVIDENCE.md's "master drew those lines SOLID" holds for the dropped
    prop, not for the door output.
- atr-support-and-resistance, high-low-open-mid-ranges and ict-turtle-soup: same op counts. The only change is that
  `if <covered cond> then X else ""` becomes `X`, which is an unreachable tail. Same drawing. Correct.

## (e) Mutations, merge, measure-pair
Lane rails: honestySweep 45/45.
- 24 related files: 767/767.
- 34 enum/style-related files: 1010/1011. The 1 failure is B1.

My mutations against `honestySweep.test.js`, applied to copies and restored by copy, with git diff clean each time:

| mutation | result |
|---|---|
| R5 v1-v3 bound `<= 2` | KILLED |
| R8 coverage `every` -> `some` | KILLED |
| R1 ternary chain allows mixed subjects (real over-serve if it shipped) | SURVIVED |
| R7 map KEY number word ignored | SURVIVED |
| R9 runtime store withholds only `line` (label/table `na` unrailed on the runtime lane) | SURVIVED |
| R10 comment scan checks only the first gap line | SURVIVED |
| R2 / R3 / R4 | SURVIVED; equivalent or unreachable (named title before positional options is not Pine; named-arg helper calls never inline; a yes-arm `na` still refuses on recursion) |

R1, R7, R9 and R10 are rail gaps, NOTE. Add one rail each.

Merge and measure-pair:
- `git merge-tree origin/master(499e86b016) cc37660d4c`: clean, tree `a061db45`.
- Master moved 7 commits. The overlap is 4 engine test files. All of `w34I6SwitchArmWrap`, `w34I6V6BoolResidue`,
  `w6Enum` and merged `w6Map`, plus honestySweep, pass on the merged files: 414/414.
- Measure-pair: YES, required. Door object programs change on corpus scripts, so an engine bump is needed.

## Notes (non-blocking)
N1. A residual of the same class remains:
- A helper enum call with a NAMED argument, `style = st(m = mode)`, still falls to `enumUnreadable`. The prop is
  dropped and the line is drawn SOLID, on master and tip alike.
- That includes the I6b-N2 shape (uncovered options, the member picks "A"), where TradingView draws dashed. It also
  includes a default-armed switch.
- This is the master policy "drop the prop, never numeric". Not a regression, but it is unbacked default drawing.
  Queue it.

N2. EVIDENCE corrections:
- The "5 served" is really 4 that draw differently plus 1 that changes diagnostics only.
- The "1 withheld" changes no door output (null on both sides).

N3. The builder's "full run" omitted `engine/__tests__` and `builder`. B1 lived there.
