VERDICT: NO-GO @fd8bbd8e93

Independent review of docs/pine/W6-BREAKDOWN.md on origin/docs/pine-w6-breakdown @fd8bbd8e93.
Read-only: git show / git grep / git diff -U0, plus light Python over the committed
coverage-map.json and coverage-targets-2026-11-03.json (origin/fix/pine-w0-census-peel @127a0f1e3c)
and the local runtime-on census.jsonl named in section 0. Code citations checked at origin/master
646dca8cbf. No vitest, census or harness was run.

The three blockers are doc edits, roughly an hour's work. Most of the plan is sound: section 1's
wall counts reproduce, every code citation I opened is right, and T4 is correctly folded into T3.
Re-review after the fixes.

## Recomputed (all reproduce unless marked)

- W6 touches = 56 (`runtimeWaves.W6.blocks`; my own rt_wave over byScript+tags also gives 56).
- W6 alone: 5 upper / 4 firm (firm = census `reachedAfterPeel`). Matches.
- Per-wall A: runtime:array 22, runtime:loop 18 (16 tagged `for-in` + 2 v6-bound:
  support-resistance-mtf-flux-charts, support-and-resistance-zones-feels), pine:type 8,
  pine:member 6, pine:collection 5, runtime:udt-method 3. Matches.
- Per-wall B (step-0): array 8, loop 8, type 0, member 1, collection 1, udt-method 1. Matches.
- runtime-on greedy puts W6 sixth at +52 (`waveGreedy["runtime-on"]`). Matches.
- `runtimeOn.walls.stuck.cap` = 146. Matches.
- W6 with W4 closed: **14 upper / 7 firm, not 15 / 7** (B1).
- W6 with W1 + W3 + W4 closed, same lane: **28 upper / 10 firm** (B1).

## Findings

B1. Section 0 finding 1 and the section 1 yield table. The "+W4" upper count is off by one, and
the reason given for the gap with the PLAN figure is wrong.
  (a) 15 should be 14. `committed:atr-god-strategy-by-tradesmart` has waves {W4, W6, W9} in the
      committed `targets.runtimeWaves`: it is an order strategy, so W9 also blocks it. The author
      appears to have called `rt_wave` without `order_strategy`, which leaves the strategy in.
      The doc's own T6 text says it is "a strategy: attaches, never a transfer, W9", yet it is
      counted in T6's "5 (3)" and in the W6 total of 15. Fix: T6 becomes 4 (3) and the total
      becomes 14 (7). Firm stays 7, because that row is not `reachedAfterPeel`.
  (b) The doc calls the PLAN's +30 / +11 "a different measure" (production lane) and concludes
      that W6 is small. The real difference is which waves are assumed closed, not the lane. That
      figure is phase 4 of COVERAGE-MAP.md section 6, so it is the gain after phases 1 to 3
      (W1, W3, W4). Computed the same way on the runtime-on lane (W6 plus any of W1, W3, W4),
      W6 gives 28 upper / 10 firm, which essentially reproduces +30 / +11. The doc's "with W4"
      figure leaves out W1 and W3. Restate finding 1 with 5/4 (alone), 14/7 (+W4), 28/10
      (+W1, W3, W4) and 52 (greedy). Drop "W6 is small" as the conclusion.
  (c) Minor: `runtimeWaves` lives in coverage-targets-2026-11-03.json, not "the committed map".
      COVERAGE-MAP.md is "Measured 2026-10-30", not 10-31.

B2. Section 4, T3 (the foundation). Its `exprType` relies on a source that does not exist, and
it is undersized.
  - T3 item 2 types a call by "a user function's declared result type". Pine user functions and
    methods have no return-type annotation (`f(x) =>`); only parameters are typed. As specified,
    `exprType` returns `null` for every user call. That refuses the chains T9 is meant to serve
    (`f_rt(…).mc().ha()`, `f(…).m()`) and any `for … in` over a user function's result (T6).
  - T3 must specify return-type inference: the body's result `exprType`, per call site, under
    that call's parameter types. It must also cover the expression shapes T6 to T9 need and
    item 2 omits: ternary / `if` / `switch` expressions; collection-returning built-ins
    (`array.copy`, `concat`, `slice`, `from`, `map.keys` / `values`, `matrix.row` / `col`);
    and method-call results.
  - Sizing: the task also replaces every per-slot flag, including colour, text and drawing
    (`holdsColour` FE:2598 / :2660, `markUdtSlot`, `markDrawingSlot`). W4 T12 / T13 add
    colour-array marks at the same three binding sites (verified: t12 hunks at 9450, 9672,
    10009, 2660). With inference added this is L, not M. Consider splitting it: T3a, the
    descriptor plus getters (a pure refactor); T3b, `exprType` with inference.
  - T3 is the right foundation for T6 (element types), T7, T8, T9 and T10. T5, T2 and T11 do
    not need it, as the doc says.

B3. Sections 4 and 6, capture gating. Three behaviours the vendor decides are served with no
capture behind them:
  - T6 item 5 serves "in a function body every call site walks its own collection". Yet the doc's
    own W6-F1 probe lists "`for … in` inside a UDF at two call sites", and the capture table
    gates only "UDT write-through, matrix/map halves" on W6-F1. Either gate item 5 on W6-F1 or
    remove it from the probe.
  - T6 item 2 serves `polyline.all` as a snapshot. Only `box.all` is witnessed (A02 to A06 in
    vw-forin-collections.pine); the host lane's `ALL_FAMILIES` (pineObjects.js:1612) is
    line / box / label only and has no polyline. Refuse `polyline.all` by name, or add a row to
    W6-F1.
  - T5 item 2 serves members as "exact from the reference text" when the reference does not pin
    them: `array.percentile_linear_interpolation` (which interpolation convention),
    `array.sort` / `sort_indices` on text (codepoint or locale order, case),
    `array.standardize` (biased or unbiased stdev), and `array.percentrank` (`<` or `<=`).
    Move these into W6-A1, or cite the reference sentence that settles each one.
  The rest is gated properly. The capture table is precise (probe, chart, guards, slugs, gated
  task): about 8 captures on two charts, RDDT and SPY 1D.

N1. Section 0 finding 3. The doc says 2 of the 8 `pine:type` scripts are not types. Only 1 is:
`technical-ratings`. `functions` is an `example:` row (one of the 288 reference-doc example
rows in the 967-row census) and is not among the 679 scripts. The 8 are: technical-ratings
(namespace); trailing-take-profit… and lorentzian… (library types, W8); htf-fvg-zerohero,
smart-money-volume, stop-loss-clustering, footprint-strategy and trend-speed (T9).

N2. Section 1 yield table: "T9 … 14 scripts touched" counts the two library scripts that
section 1 assigns to W8. T9's own measure-pair list names 12. Use 12 or explain the gap.

N3. T2: "Attach expected: price-divergence-detector-v32-…" overclaims. That row is stuck at
`no-progress` and not firm (the doc says so itself in section 1). Say "first wall moves".

N4. Section 5, file overlaps the parallel table misses:
  - T5, T7 and T8 all edit `RT/collections.js` (members, the `ARRAY_WRITES` / `READS_ALL` sets,
    and the dispatch export). No conflict row covers T5 ⟂ T7.
  - T7 and T8 must also change the method-form sites (FE:6219-6244 and 9783-9806; the
    `ARRAY_FNS` lookup at :6233), plus `callFamily` (FE:5110-5115) and the refusal text at
    FE:192. T3 and T9 own those sites. Batch 2 runs T7 and T9 in parallel on them.
  - W4 T3 (`feat/pine-w4-t3-session-text`, now merged to the train) edits `RT/runtimeInputs.js`
    at 142-148, 300 and 351, which T10 owns; the table says "none". W4 T4 (`…-t4-conditional-arms`,
    on the train) inserts 24 lines into `RT/lowerIr.js` at :459, and W4 T10 at :531. The table
    names only T8 :510 for that file. The hunks are disjoint from 599-660, but the table should
    list them.
  - The `:1225` hunk the table attributes to W4 T1 also appears in t10-state-kernels' diff.

N5. Preamble and section 7: the train `integ/pine-train-2026-11-05` IS now pushed (00e2d0dfda,
SCRIPT_ENGINE_VERSION 8; contains W4-T0 @127a0f1e3c, T1, T3, T4 and W3). It adds 273 FE lines,
with hunks at 2117-2183, 5095, 5336-5347 and 10333-10573. T1's "Depends: W4 T0 merged" is met on
the train. Re-derive the FE line citations on the train tip before builders start.

N6. Section 7 asks whether vw-forin-collections-2 was ever read. It was captured, and the harness
grades it INCONCLUSIVE ("member door refused (pine:reassign)"; e.g.
docs/notebook/gate-runs/p2b-landing-r2/shard-1.log). So no lane has graded the G-rows. T6 (or
the host lane) must accept the probe's reassignment before the rows can settle anything. Also,
capture-queue-2026-10-01-c48.md names S01-S04, not S01-S03.

N7. Section 2, the reuse claim. Sharing `FOR_IN_LIVE_WITNESSED` and the snapshot families
through `ast/forInRule.js`, with both lanes railed against vw-forin-collections, is real
one-source reuse. The index walk itself is still written twice (host, and FE/lowerIr); that is
acceptable under rule 5, but say so. T7 and T8 add new code with no host twin, so there is no
duplicate. T5's port of 794bfb02f3 is a manual split, not a cherry-pick: that commit's FE hunk
is all gradient fill (verified). Only collections.js and w19r2Collections.test.js port.
Citation drift: `FOR_IN_LIVE_WITNESSED` is at pineObjects.js:1615, not 1611-1614.

N8. Code references: about 30 spot-checked at 646dca8cbf, all correct within a line or two.
  - FE: :177, :189, :192, :290, :435, :515-542, :1102-1106, :1252, :1277, :1285-1291, :1647,
    :2551, :3048, :3103, :3194, :3236, :3334, :3392, :5110-5115, :5535-5560, :6219-6244, :8529,
    :8786, :8808-8818, :8836, :8854-8857, :8858, :8899, :9449-9451, :9671-9673, :9783,
    :10000-10012, :9918.
  - pine.js: :287, :318, :328, :2850, :2975, :8921-8930, :25004.
  - collections.js: 34 members (12 + 13 in C11_MEMBERS + 9 typed `new_*`), :280 / :619-620,
    :655-678.
  - Other: vm.js :970 / :997; limits.js :133-134; lowerIr.js :599 / :661; runtimeInputs.js
    :65-67; SCRIPT_ENGINE_VERSION 5 at :88.
  - Every refusal reason named in the doc exists: runtime:loop "`for … in`", runtime:array,
    runtime:udt-method (`bindableMethod`), pine:type (`typeRefusalFor`), pine:member,
    pine:collection, and `input.enum` in UNSERVED.
  - The v3 `method = input(…)` diagnosis is confirmed: the arm tests only `word === 'method'`.

N9. Section 5, gaps against WAVE-TASKS W6 (W6.1-W6.5). None missing. Folding "generics" into T3
is correct: Pine has no user-declared type parameters. Out of scope and deferred, correctly:
`export` types and methods (W8), `varip` collections, linear algebra, and slice-as-view.
