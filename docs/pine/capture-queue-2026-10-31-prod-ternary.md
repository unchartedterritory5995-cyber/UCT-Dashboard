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

## Probes

| id | probe | chart | question | what changes on the answer |
|---|---|---|---|---|
| Q-PT1 | `tools/visual_conformance/probes/vw-arm-history-v5.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | does a v5 `?:` arm keep the history of only the bars it runs (T03 / T04 / T05 / K02 / K03 / U01), and do v5 `and` / `or` run their right side on every bar (S01 / S02)? | per-run T rows: the v5 withhold is witnessed, nothing moves. Every-bar T rows: lower `stampTernaryArms`'s version floor to 6 (a v5 arm is then TradingView's every-bar number and must be drawn) |
| Q-PT2 | `tools/visual_conformance/probes/vw-andor-history.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | is the right side of a v6 `and` / `or` evaluated only where the left has not decided, with a history of those runs (B01-B05)? | per-run: witnessed, nothing moves. Every-bar: remove `stampLogicRight` (v6 `and` / `or` would then be TradingView's every-bar number) |
| Q-PT3 | `tools/visual_conformance/probes/vw-arm-history-v4.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | is a v4 `?:` arm lazy (T*, K*, U*)? does v4 `iff` evaluate both arguments (F*)? | per-run T rows: extend the stamp to v4. ⚠️ v4 spells the calls bare (`sma`, not `ta.sma`), so `armHistoryCallOf` needs the v4 bare roster (the one `PINE_NAMESPACED_TREE`'s legacy route resolves), not only a lower version floor; C48's block mark (`taCallIn`) has the same gap for v4 `if` blocks today. Every-bar T rows: v4 stays drawn, and the rule is written down |
| Q-PT4 | `tools/visual_conformance/probes/vw-arm-history-v3.pine` | NYSE:RDDT 1D from the listing | the same for v3 (and, if `bar_index` does not compile there, with `n`) | as Q-PT3 |

## Shapes this branch does NOT stamp, each a question a capture would settle

| shape | what the lane does | what settles it |
|---|---|---|
| `up ? request.security(sym, tf, ta.sma(close, 5)) : x` | drawn as before (the arm reader does not enter `request.*`: the requested expression runs in the requested context) | a v6 probe row plotting it beside the every-bar and per-run readings, on a symbol and timeframe where the two differ. ⚠️ C48's block mark (`taCallIn`, token-level) DOES gate a `ta.*` inside a `request.security` written in an `if` block - the two rules disagree here, and the capture decides which one is right |
| `up ? math.sum(x, n) : y`, `up ? fixnan(x) : y` | drawn as before (only `ta.*` and script functions that read their own history are read as history calls, the same vocabulary as C48's mark) | one row each; per-run would add them to both rules |
| `up ? ta.tr(true) : 0` | WITHHELD where `up` varies (every `ta.*` call is read as holding history, as C48's mark reads it) | one row: if `ta.tr` reads the chart's own previous close on its first run after a skip, it is pure, and the stamp over-withholds it |
| `not na(x) and ta.crossover(close, x)`, `x` `na` until some bar and never again | WITHHELD wherever the left side is false and then true (`blockRuns` refuses a run after a skip), though per run and every bar may agree there: the first run's `x[1]` is `na` on both readings | rows over such an `x` for `ta.crossover`, `ta.change`, `ta.sma`: where they agree on the first run, `blockRuns` could admit a false-then-true guard for those functions |
| a stamped `?:` inside a multi-state recurrence (`accum2`-`accum4`) whose test reads a state bind | drawn as before (no standalone guard can be written for it; `armRunGates` carries no gate rather than refuse) | not a capture question: a guard over the multi-state tuple one bar back, as `previousBarOf` builds for `accum` |
| a `?:` arm in a COLOUR | a plot COLOUR condition (`colorCondition` / `colorIndex` / `colorGradient`) that reads a stamped arm withholds the plot, as C48 withholds one whose colour reads a block's call; a colour BETWEEN two arms that call `ta.*` is not carried by the plot lane at all (`colorDynamic`), and the object lane holds such a colour by name (`fn:conditional-history`, C45) | covered by `vw-arm-history` G01-G03 for the gauge shape |

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
