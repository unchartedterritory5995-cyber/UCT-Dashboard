# Capture queue: 2026-10-31, `?:` arms and v6 `and` / `or` on the production plot lane

Branch `fix/prod-ternary-history`. What this branch withholds by name, what it still draws
unwitnessed, and the captures that would settle each. Same procedure as
`docs/pine/capture-queue-2026-09-28.md`: visibility gate, **Create new > Indicator**, the "Add to
chart" binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at
defaults. None of the probes below has been compiled on TradingView: a row that does not compile
names its line, so split it out and capture the rest. A compile error is itself a reading.

## What the plot lane does now

A `ta.*` call, or a call to a script function that reads its own history (`callHistoryFunctions`),
WRITTEN in one arm of a `?:` whose test is not decided before bar 0, or on the right of a Pine v6
`and` / `or`, keeps the history of only the bars that arm or side runs. The translator stamps the
`?:` / `&&` / `||` it builds (`pine.js::stampTernaryArms`, `stampLogicRight`); the output loop turns
each stamp into a `meta.blockRuns` gate whose guard is the arm's own test (`armRunGates`); the bind
withholds the plot, by name (`pine:block`), only on a chart where that guard runs after a bar it
skipped (`engine/blockRuns.js`). The server's alert lane and scan sweep ask the same question of the
same stamp (`api/services/block_runs.py`).

| shape | served, withheld, or drawn as before | witness |
|---|---|---|
| v6 `up ? ta.sma(…) : x` and siblings | withheld where `up` varies | CAPTURED: `vw-arm-history` T03 / T04 / T05 / K02 / K03 equal the per-run reading on every one of RDDT's 636 bars |
| v5 `?:`, same shapes | withheld where the test varies | DOCUMENTED, not captured: to-v5 guide ("the ternary operator is evaluated lazily; only the required value is calculated"), to-v6 guide ("Pine v5 evaluates all bool expressions except for the `?:` strictly"). Q-PT1 witnesses it |
| v6 `up and ta.x(…)`, `up or ta.x(…)` | withheld where `up` varies | DOCUMENTED, not captured: to-v6 guide, whose own example is `close > open and ta.rsi(close, 14) > 50`; CW10003. Q-PT2 witnesses it (WS-C's H7 asks the same for the runtime lane) |
| v5 `and` / `or` | drawn as before (both sides every bar) | to-v6 guide: v5 evaluates `and` / `or` strictly. Q-PT1 rows S01 / S02 pin it |
| v1-v4 `?:` | drawn as before, UNWITNESSED | none. The v4 manual says `iff` "acts identically to the `?:` operator"; the to-v5 guide says `iff` "always evaluated both values". Q-PT3 / Q-PT4 settle it |
| `iff(c, a, b)` (v1-v4) | drawn as before (a function call: both arguments every bar) | to-v5 guide, as above. Q-PT3 rows F* pin it |
| `y = if up` / `ta.sma(…)` / `else` / `x` — an `if` used as an EXPRESSION (review round 2, H2), every version | withheld where `up` varies (the branch's value; an `else if` condition too) | C48's own rule: an `if` branch is a block, run only when taken, captured for the STATEMENT form by `vw-call-site-history` (C48). The expression form is the same block and is not separately captured: Q-PT5 witnesses it. ⚠️ v1-v4 bare built-ins (`sma(…)`) are not read as history calls by either lane (gap G-b) |
| `var x = up ? ta.x(…) : y` — an arm in a `var` INITIALISER (review round 2, M1) | drawn: the initialiser runs once, on bar 0, where no call has history to diverge (`armRunGates` skips a recurrence's seed slot) | Pine's `var` rule (the initialiser executes on the first bar only). The same `?:` without `var` runs on every bar and stays withheld (`vendorHarness.c45ArmRuns` M1 rails) |
| an arm in a COLOUR — a plot's, a fill's, a `bgcolor` / `barcolor`'s (review round 2, H1) | the COLOUR is withheld where its arm runs after a skip; the value it colours is drawn. The rule's gates ride its hidden condition column (`pine.js::colourBlockRunsOf` → `memberPaneDefinition`'s `colourBlockRunKeys`); refused, a plot draws in its series colour, a fill or a paint draws nothing (`binder.pointColour` / `fillColours`) | the same rule as the value's; witnessed through the member door and the binder in `vendorHarness.c45ArmRuns` (H1 block) |
| a DRAWING's colour (label / line / box / table) whose `ta.*` call runs only on some bars — an arm of a `?:` anywhere in it, the right of a Pine v6 `and` / `or`, or any call when the drawing's own block varies (review round 2, after #604) | HELD by name (`objectDiagnostics.heldColours`, `fn:conditional-history`): the object runtime marks the colour unknown and the drawing is held, once. ⚰️ A v6 `and` colour and a call in a colour test inside a varying block were painted off the every-bar call (`pine.js::colorNodeOf`, `lazyHistoryCall`, `guardOfIn`'s `varies`) | the plot lane's rule, applied the way this lane already held an arm's colour (heat-map-seasons, C45); railed in `vendorHarness.c45ArmRuns` (object block) |

## Probes

| id | probe | chart | question | what changes on the answer |
|---|---|---|---|---|
| Q-PT1 | `tools/visual_conformance/probes/vw-arm-history-v5.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | does a v5 `?:` arm keep the history of only the bars it runs (T03 / T04 / T05 / K02 / K03 / U01), and do v5 `and` / `or` run their right side on every bar (S01 / S02)? | per-run T rows: the v5 withhold is witnessed, nothing moves. Every-bar T rows: lower `stampTernaryArms`'s version floor to 6 (a v5 arm is then TradingView's every-bar number and must be drawn) |
| Q-PT2 | `tools/visual_conformance/probes/vw-andor-history.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | is the right side of a v6 `and` / `or` evaluated only where the left has not decided, with a history of those runs (B01-B05)? | per-run: witnessed, nothing moves. Every-bar: remove `stampLogicRight` (v6 `and` / `or` would then be TradingView's every-bar number) |
| Q-PT3 | `tools/visual_conformance/probes/vw-arm-history-v4.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | is a v4 `?:` arm lazy (T*, K*, U*)? does v4 `iff` evaluate both arguments (F*)? | per-run T rows: extend the stamp to v4. ⚠️ v4 spells the calls bare (`sma`, not `ta.sma`), so `armHistoryCallOf` needs the v4 bare roster (the one `PINE_NAMESPACED_TREE`'s legacy route resolves), not only a lower version floor; C48's block mark (`taCallIn`) has the same gap for v4 `if` blocks today. Every-bar T rows: v4 stays drawn, and the rule is written down |
| Q-PT4 | `tools/visual_conformance/probes/vw-arm-history-v3.pine` | NYSE:RDDT 1D from the listing | the same for v3 (and, if `bar_index` does not compile there, with `n`) | as Q-PT3 |
| Q-PT5 | not written yet: three rows of `vw-arm-history.pine`'s shapes spelled as `y = if up` / `ta.sma(close, 5)` / `else` / `close`, its `else` branch, and an `if` with no `else` | NYSE:RDDT 1D from the listing | does an `if` EXPRESSION's branch keep the history of only the bars it runs, as the statement form does (C48)? | per-run: witnessed, nothing moves. Every-bar: stamp the expression form no more (`ifArm` / `ifExpr` out of `foldIfChain`) |
| Q-PT6 | not written yet (G-f): `if close > close[1]` / `label.new(bar_index, high, str.tostring(ta.sma(close, 5)))`, and the same with a colour `var` filled in that block from `ta.rising(close, 2)` | NYSE:RDDT 1D from the listing | does a drawing's text read the call's history over the block's RUNS, and which colour does the drawing paint? | per-run: extend #604's object-lane gate to a drawing's inline calls and colour `var`s. Every-bar: G-f is not a gap, and the rule is written down |
| Q-PT7 | not written yet (G-i): a helper reading a `var` written in an `if` block BEFORE the drawing call on the same bar, beside one written AFTER it | NYSE:RDDT 1D from the listing | does the text read the value of this bar's write, or the previous bar's? | this bar's: carry the call's position into the text reader's frame (G-i). The previous bar's: the current reading stands |

## Shapes this branch does NOT stamp, each a question a capture would settle

| shape | what the lane does | what settles it |
|---|---|---|
| `up ? request.security(sym, tf, ta.sma(close, 5)) : x` (probe `vw-pt-request-arm.pine` R01 / R02, NYSE:RDDT 1D from the listing) | drawn as before (the arm reader does not enter `request.*`: the requested expression runs in the requested context) | a v6 probe row plotting it beside the every-bar and per-run readings, on a symbol and timeframe where the two differ. ⚠️ C48's block mark (`taCallIn`, token-level) DOES gate a `ta.*` inside a `request.security` written in an `if` block - the two rules disagree here, and the capture decides which one is right |
| `up ? math.sum(x, n) : y`, `up ? fixnan(x) : y` (probe `vw-pt-math-sum-fixnan.pine` M01 / F01, NYSE:RDDT 1D from the listing) | drawn as before (only `ta.*` and script functions that read their own history are read as history calls, the same vocabulary as C48's mark) | one row each; per-run would add them to both rules |
| `up ? ta.tr(true) : 0` (probe `vw-pt-tr-true.pine` R01, NYSE:RDDT 1D from the listing) | WITHHELD where `up` varies (every `ta.*` call is read as holding history, as C48's mark reads it) | one row: if `ta.tr` reads the chart's own previous close on its first run after a skip, it is pure, and the stamp over-withholds it |
| `not na(x) and ta.crossover(close, x)`, `x` `na` until some bar and never again (probe `vw-pt-na-guard-and.pine` C01-C03, NYSE:RDDT 1D from the listing) | WITHHELD wherever the left side is false and then true (`blockRuns` refuses a run after a skip), though per run and every bar may agree there: the first run's `x[1]` is `na` on both readings | rows over such an `x` for `ta.crossover`, `ta.change`, `ta.sma`: where they agree on the first run, `blockRuns` could admit a false-then-true guard for those functions |
| a stamped `?:` inside a multi-state recurrence (`accum2`-`accum4`) whose test reads a state bind | drawn as before (no standalone guard can be written for it; `armRunGates` carries no gate rather than refuse) | not a capture question: a guard over the multi-state tuple one bar back, as `previousBarOf` builds for `accum` |
| a `?:` arm in a COLOUR (probe `vw-arm-history.pine` G01-G03, NYSE:RDDT 1D from the listing) | ⚰️ this row said such a colour withheld the PLOT (review round 2, H1: it did, and drew no line for a value that was every bar's close). Now the colour alone is withheld (see the table above); a colour BETWEEN two arms that call `ta.*` is not carried by the plot lane at all (`colorDynamic`), and the object lane holds such a colour by name (`fn:conditional-history`, C45) | covered by `vw-arm-history` G01-G03 for the gauge shape |

## Known gaps (review round 2), each named where it lives

PT-GAPS (2026-11-07, `feat/pine-pt-gaps`) fixed L3, L4, L6, G-c, G-d and G-h, queued G-f and G-i as captures (Q-PT6, Q-PT7), and left G-b to Q-PT3 and L2 to its probe. As written on the branch that found them: none is a one-line change, and each moves either the guard's meaning, the
parity fixture both lanes read, or a cache. Each says the direction it errs in, and what would close it.

| id | gap | errs | where | what would close it |
|---|---|---|---|---|
| L2 | a stamped `?:` INSIDE a `request.security(…)` expression is stamped like any other, but its guard is evaluated on the CHART's bars by the bind, while the arm runs in the REQUESTED context | either way (probe `vw-pt-request-arm.pine` R03 / E03 / P03, NYSE:RDDT 1D from the listing) | `Resolver.stampTernaryArms` (no request-context test); `engine/blockRuns.js` evaluates every guard on the chart's bars | evaluate the guard inside the same request (`request.security(sym, tf, <guard>)`, as `securityColourRule` moves a colour's deciding tree), or decline to stamp inside a request until a capture says what TradingView keeps there |
| L3 | FIXED (PT-GAPS, 2026-11-07): a nested stamp's guard is its own guard wrapped in every enclosing STAMPED arm's run guard, `c ? g : 0` (a bar where an encloser is not taken is a SKIP whatever the inner test reads; a `&&` would be `na` there). In `a ? (b ? ta.sma(…) : x) : y` the inner gate is `a ? b : 0`. The context is dropped through an `offset` and into a recurrence (the rule as it was there), and a node under two enclosers carries both gates. ⚠️ The OUTER stamp still carries its own test (`a`), as before: where `a` runs after a skip only on bars where `b` is false, that gate still over-withholds | over-withholds less; never under | `armRunGates` (`ctxOf`, `within`) | rails `ptGaps.test.js` L3; mutation M1 killed (`docs/pine/evidence/2026-11-07-pt-gaps/EVIDENCE.md`) |
| L4 | FIXED (PT-GAPS, 2026-11-07): a `?:` stamp's guard is the `?:` itself, `t ? 1 : 0` (true arm) / `t ? 0 : 1` (false arm), for a test that can be `na` (`neverNaTree` false). The bind evaluates it with the plot's own options (`listingOptsFor`), so from the listing in a document declaring `meta.naConditionFalse` an `na` test is a SKIP of the true arm and a RUN of the false one (`interpret.js::PINE_TERNARY`, witnessed by `rt1-na-test-v4/v5/v6`, NYSE:RDDT 1D, 2026-10-02); off the listing, and on every server lane (`ast_interpret._ternary`, which has no listing rule for the plot either), it stays `na` = neither, as before. No new parity column: the column-to-refusal rule (`firstRunAfterSkip`) is unchanged on both lanes, and `blockRunsParity` reproduces its fixture. A never-`na` test and a v6 `and` / `or` stamp keep their trees byte for byte. C48's statement-form rule is untouched | — | `armRunGates` (`armGuardOf`) | rails `ptGaps.test.js` L4; mutation M2 killed |
| L5 | `bgcolor` / `barcolor` colours | — | — | CLOSED by H1 for ARM gates; the BLOCK-gate half (G-h) is FIXED by PT-GAPS (2026-11-07) |
| L6 | FIXED (PT-GAPS, 2026-11-07): `armHistoryCallOf` memoises the nodes a chain repeats (a `ternary`, an `if` branch's `bound`) per history-function roster (`WeakMap`, so per translation); an answer reached through the depth cap is never kept. A 40-deep chain asked at every level visits each node once. | — | `armHistoryWalk`, `armMemoFor` | rails `ptGaps.test.js` L6; mutations M3 (no memo) and M7 (memo a capped answer) killed |
| G-a | CLOSED (fix/prod-plot-var-cond-history, review F2; PT-GAPS 2026-11-07: confirmed closed): a gate the output loop notes while the PRESENTATION resolves (after the value's, `valueBlockRuns`) rides the output's colour rules (`_colourBlockRuns`, read by `colourBlockRunsOf`), so a colour that reads an `if`-bound name or a `var` filled in a block that skips withholds that colour's condition column, never the plot. Attribution is per output, not per rule: an output with two colour rules gates both (over-withholds a colour, never a value); a presentation with no colour rule keeps the gate on the plot, as before; and a colour that can HIDE the output (an `na` leaf, a fully transparent entry, opacity 0: `colourWithholdsAlone`) keeps it there too, withheld whole, because withholding it alone drew the plot on bars TradingView leaves empty (re-review H1) | — | `pine.js` output loop | — |
| G-g | (by design, review F3; PT-GAPS 2026-11-07: by design until a capture per window-1 function exists) `if c` / `s := ta.sma(close, 1)` is withheld though a 1-bar window is the current value on every run: C48's mark (`condCallMark`, `stateRuns`) reads the call's NAME, not its window, as master's #604 / C31 do. Not exempted: an exemption is a per-function proof (`sma`, `ema`, `rma`, `wma`, `highest`… each with its own seed and `na` rules), of the repo's 611 `.pine` files only two of this engine's own probes write a literal length-1 window (2026-11-01 grep), and the error is a withheld plot, never a wrong number | over-withholds | `objectFnInline.condCallMark`, the fold's `stateRuns` | a roster of window-1 identities, each witnessed by a capture row, consulted by both marks |
| G-h | FIXED (PT-GAPS, 2026-11-07): paints and fill colours are read with `condGate` on (`holderColourGates`, host lane only); the block gates they note hang on the colour's own rules (`COLOUR_BLOCK_RUNS`, read by `colourBlockRunsOf`), so the bind withholds that condition column, and a withheld paint or fill colour draws nothing. A colour with no rule was folded to one value on every bar and needs no gate. A block mark with no guard to carry withholds a paint by name (`pine:block`) and drops a fill (⚠️ silently: a fill has no withheld record). The colour is read in notes-only mode (`condGateNotesOnly`): a one-run block (`oneExecution`) is still read the every-bar way, as before, and its gate withholds the colour where the block runs after a skip | — | `pine.js` `resolvePaints`, `resolveFillHandles`, `blockGateGuardsOf` (one reader, shared with the output loop) | rails `ptGaps.test.js` G-h; mutation M5 killed |
| G-i | (C48, final run 2026-11-02) on the DRAWING lane's text reader a helper that reads a `var` is refused only when the var's last write is a top-level `:=` (runs every bar): that reader's scope is the whole drawing, not the env at the call, so a write in a block may not have run before the call and the folded value (the previous bar's) is then Pine's. Refusing every later write took rsi-swing-indicator's 35 TradingView-exact objects down (C17 / F6). Where a block write DID run before the call on the same bar, the drawing reads the previous bar's value, as master does. PT-GAPS (2026-11-07) classed it as NEEDING A CAPTURE: the last change here took 35 exact objects down, so the object door moves only with a drawing capture that separates the two orders (Q-PT7) | under-withholds (a text, as on master) | `pine.js` `staleOuterStateRead` (`everyBarOnly`), `Resolver.resolveInFrame` | Q-PT7, then carry the call's position into the text reader's frame and compare against the env there |
| G-b | Pine v1-v4 BARE built-ins (`sma(…)`, `highest(…)`) are not read as history calls by either lane: C48's mark reads `ta.*` tokens (`taCallIn`), the arm walk reads `ta.*` names and history helpers | under-withholds (a v4 `if` block or `if` expression calling `sma` is drawn off every bar) | `objectFnInline.taCallIn`, `pine.js::armHistoryCallOf` | one v4 roster of history-keeping bare names for both (the names `PINE_NAMESPACED_TREE`'s legacy route resolves), witnessed by Q-PT3 |
| G-c | FIXED (PT-GAPS, 2026-11-07): the counter fold copies through `copyKeepingArmRuns`, the same `JSON.parse(JSON.stringify(…))` byte for byte (its `NaN` → `null` kept), then walks original and copy in parallel and carries every `_armRuns` stamp. `n := up and ta.rising(close, 2) ? n + 1 : 0` read as `n >= 3` now carries the right side's gate | — | `pine.js` counter fold `copy()` | rails `ptGaps.test.js` G-c; mutation M4 killed |
| G-d | FIXED (PT-GAPS, 2026-11-07): `infoValueResolve.withheldColourOf` reads the plot's own condition column (`plot.colorMode = 'column:<key>'`) in `columnErrors`; a pinned info value keeps its VALUE and carries the gate's own sentence as its `reason` (the row's `title`), with `colourWithheld: true`. ⚠️ The info row only: the legend's study stack does not show it yet | — | `infoValueResolve.js` | rails `ptGaps.test.js` G-d; mutation M6 killed |
| G-e | (by design, M1; PT-GAPS 2026-11-07: by design, nothing to build) off the listing a recurrence's bounded window reads its SEED W bars back, where an arm in it holds the every-bar history; not gated, because the window's own convergence rule already answers for the seed | — | `interpret.js` bounded window | not a gap of this rule |
| G-f | (object lane, pre-existing; found while merging #604) a `ta.*` call written in a drawing's NON-colour argument inside a block that varies (`if close > close[1]` / `label.new(…, str.tostring(ta.sma(close, 5)))`) is drawn off the every-bar call; and a colour `var` written in such a block (`c := … ta.rising(…) …`) is not carried at all, so the drawing paints the renderer's default. PT-GAPS (2026-11-07) classed it as NEEDING A CAPTURE: the object door does not change without exact backing, and no capture holds a drawing's text over a block's runs (Q-PT6) | under-withholds | `pine.js` object pass (`valueRef` text / number slots; `objectBlockRunsOf` covers number `var`s, not colours) | Q-PT6, then the C48 object-lane gate (#604's `program.blockRuns`) extended to inline calls of a block's own drawings, and colour `var`s carried or held |

## Alerts the server lanes now withhold (review round 2, M2)

This deploy switches on server enforcement of every C48 stamp already saved (the alert lane and the
scan sweep read `meta.blockRuns`; before it, only the chart did). An armed alert on such a plot now
evaluates to no number on bars where the chart withholds it, and goes quiet. It is not left silent:
the silent-alert sweep (`indicator_alert_service.sweep_silent_alerts`, every 5 minutes) now diagnoses a
member's own formula through the user lane (`_diagnose_user`) and writes `state = needs_attention` with
the gate's sentence in an armed alert's words in `state_detail` (`alert_user_series.withheld_alert_detail`: "Withheld: <the gate> — <where it skipped>. This alert resumes when the value is computable.", whole under the 500 characters the state keeps; review round 2 L1), which every alert surface renders verbatim
(`app/src/components/chart/alertState.jsx`). Railed in `tests/test_block_runs_server_lanes.py` §3.

How many saved documents and live alerts this touches was counted READ-ONLY (`mode=ro` URIs) on the
local data copies only: `C:\data\user_definitions.db` (2026-09-13) and `C:\data\auth.db`
(2026-10-02) hold 7 live documents, 0 with `meta.blockRuns`, and 0 active indicator alerts. Both
copies predate C48, so they say nothing about production. The production count is two read-only
queries against the volume's two files, NOT run from this branch:

1. `user_definitions.db`: per `(user_id, def_id)`, the newest version with `deleted_at IS NULL`; parse
   `definition` and keep the plot keys whose `meta.blockRuns.keys[].gates` is non-empty;
2. `auth.db`: `SELECT id, user_id, indicator FROM indicator_alerts WHERE active = 1 AND indicator LIKE
   'u\_%' ESCAPE '\'`, kept where `indicator` is `u_<def_id>.<plot>` for one of step 1's keys of the
   same `user_id`.

Opened with `sqlite3.connect('file:<path>?mode=ro', uri=True)`, which can neither write nor
checkpoint. The script that ran the local count is in the branch report.

## The vendor-harness split of `vw-arm-history` (queued, not done)

The production vendor harness grades `vw-arm-history-{rddt,spy}-1d-2026-10-02` INCONCLUSIVE because the
member door refuses the whole probe (`pine:roundtrip`): rows G01-G03 plot `color.r(g)` / `color.g(g)` /
`color.b(g)` of a colour ternary, which does not round-trip. Every other row translates.

Not done on this branch, because the directory's own rule forbids the obvious edit: a file in
`tests/fixtures/vendor/harness/` must carry `source.text` exactly as the vendor ran it
(`schema.mjs`: "source.sha256 does not match source.text"), so a copy with three `plot()` lines removed
is not a capture. What would do it inside the conventions:

1. a `subset` adapter in `tools/vendor_harness/adapters.mjs`, beside `observation` and `probe-rows`: a
   small file naming its parent capture and the plot TITLES it drops; the adapter verifies the parent's
   receipt and source sha256, removes EXACTLY the `plot(...)` statements whose literal title is listed
   (refusing if a listed title is not a single-line `plot` of the parent source, or if anything else
   would change), drops those plots' columns from `study.plots` / `plotValues`, and seals the result
   with `adaptedFrom: {format: 'subset', parent, dropped}`. Removing a `plot()` changes no other plot's
   values, so every remaining number is still the vendor's;
2. `harness.js::loadCapture` and `detectFormat` learn the format; the adapter gets the same rails the
   other two have (a dropped title that is not a plot refuses; a parent with a bad receipt refuses);
3. the corpus totals then gain two graded captures: on master T* / K* / N* / I* would read DIVERGE
   (the every-bar number), on this branch withheld by name.

Until then the per-row grading lives in `vendorHarness.c45ArmRuns.test.js`, which runs the probe
without its three G rows through the member door on both captures' bars, the way
`vendorHarness.c48CallSite.test.js` runs its probe's one-execution half.

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).

| not a capture | disposition | reason |
|---|---|---|
| L3 | engine-gap | a known gap of the `?:` stamp (`armRunGates`, no enclosing-arm conjunction): a build, not a reading; PT-GAPS (`feat/pine-pt-gaps`) fixes it |
| L4 | engine-gap | a known gap of the `?:` gate on an `na` test (`blockRuns.firstRunAfterSkip`): a build, already witnessed by `rt1-na-test-*`; PT-GAPS fixes it |
| L5 | closed | CLOSED by H1 (the row says so); the block-gate half is G-h |
| L6 | engine-gap | translation cost only ("slow, never wrong"): a memo, nothing to read; PT-GAPS fixes it |
| G-a | closed | CLOSED (fix/prod-plot-var-cond-history, review F2; the row says so) |
| G-g | by-design | by design (review F3; the row says so): a window-1 exemption is a per-function proof, and the error is a withheld plot, never a wrong number |
| G-h | engine-gap | a known gap: block gates never reach a paint's or fill's colour (`resolvePaints`); a build, not a reading; PT-GAPS fixes it |
| G-b | engine-gap | a known gap of the v1-v4 bare-name roster; its witness is Q-PT3, which already names its probe (`vw-arm-history-v4.pine`) |
| G-c | engine-gap | a known gap: the counter fold's JSON copy drops a stamp; a structural copy, not a reading; PT-GAPS fixes it |
| G-d | engine-gap | a known gap: a withheld colour's refusal is not surfaced on the plot; UI disclosure, not a reading; PT-GAPS fixes it |
| G-e | by-design | by design (M1; the row says so): "not a gap of this rule" |
| a stamped `?:` inside a multi-state recurrence (`accum2`-`accum4`) whose test reads a state bind | engine-gap | the row says so: "not a capture question: a guard over the multi-state tuple one bar back, as `previousBarOf` builds for `accum`" |
| L2 | withheld-ledger | a row of "Known gaps" (every column but the id prose); its capture is `vw-pt-request-arm` R03 / E03 / P03 on NYSE:RDDT 1D from the listing, the file the "Shapes this branch does NOT stamp" row 1 already queues (one capture reads R01-R03) |
