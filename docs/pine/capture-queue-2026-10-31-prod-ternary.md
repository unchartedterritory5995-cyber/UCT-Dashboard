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

## Shapes this branch does NOT stamp, each a question a capture would settle

| shape | what the lane does | what settles it |
|---|---|---|
| `up ? request.security(sym, tf, ta.sma(close, 5)) : x` | drawn as before (the arm reader does not enter `request.*`: the requested expression runs in the requested context) | a v6 probe row plotting it beside the every-bar and per-run readings, on a symbol and timeframe where the two differ. ⚠️ C48's block mark (`taCallIn`, token-level) DOES gate a `ta.*` inside a `request.security` written in an `if` block - the two rules disagree here, and the capture decides which one is right |
| `up ? math.sum(x, n) : y`, `up ? fixnan(x) : y` | drawn as before (only `ta.*` and script functions that read their own history are read as history calls, the same vocabulary as C48's mark) | one row each; per-run would add them to both rules |
| `up ? ta.tr(true) : 0` | WITHHELD where `up` varies (every `ta.*` call is read as holding history, as C48's mark reads it) | one row: if `ta.tr` reads the chart's own previous close on its first run after a skip, it is pure, and the stamp over-withholds it |
| `not na(x) and ta.crossover(close, x)`, `x` `na` until some bar and never again | WITHHELD wherever the left side is false and then true (`blockRuns` refuses a run after a skip), though per run and every bar may agree there: the first run's `x[1]` is `na` on both readings | rows over such an `x` for `ta.crossover`, `ta.change`, `ta.sma`: where they agree on the first run, `blockRuns` could admit a false-then-true guard for those functions |
| a stamped `?:` inside a multi-state recurrence (`accum2`-`accum4`) whose test reads a state bind | drawn as before (no standalone guard can be written for it; `armRunGates` carries no gate rather than refuse) | not a capture question: a guard over the multi-state tuple one bar back, as `previousBarOf` builds for `accum` |
| a `?:` arm in a COLOUR | ⚰️ this row said such a colour withheld the PLOT (review round 2, H1: it did, and drew no line for a value that was every bar's close). Now the colour alone is withheld (see the table above); a colour BETWEEN two arms that call `ta.*` is not carried by the plot lane at all (`colorDynamic`), and the object lane holds such a colour by name (`fn:conditional-history`, C45) | covered by `vw-arm-history` G01-G03 for the gauge shape |

## Known gaps (review round 2), each named where it lives

Not fixed on this branch: none is a one-line change, and each moves either the guard's meaning, the
parity fixture both lanes read, or a cache. Each says the direction it errs in, and what would close it.

| id | gap | errs | where | what would close it |
|---|---|---|---|---|
| L2 | a stamped `?:` INSIDE a `request.security(…)` expression is stamped like any other, but its guard is evaluated on the CHART's bars by the bind, while the arm runs in the REQUESTED context | either way | `Resolver.stampTernaryArms` (no request-context test); `engine/blockRuns.js` evaluates every guard on the chart's bars | evaluate the guard inside the same request (`request.security(sym, tf, <guard>)`, as `securityColourRule` moves a colour's deciding tree), or decline to stamp inside a request until a capture says what TradingView keeps there |
| L3 | a NESTED arm's guard is its own test alone: in `a ? (b ? ta.sma(…) : x) : y` the inner arm runs where `a and b`, and its gate reads `b` (the outer stamp reads `a`) | over-withholds (a `b` that varies only where `a` is false still refuses) | `armRunGates` (no enclosing-arm conjunction) | AND the enclosing stamped arms' tests (negated for a false arm) into a nested stamp's guard during the walk |
| L4 | a guard that is `na` on a bar is "neither a run nor a skip" (`blockRuns.firstRunAfterSkip`), but Pine v4+ takes the FALSE arm of a `?:` whose test is `na` (`naConditionFalse`): the true arm SKIPPED that bar and the false arm RAN | under-withholds (a test `na` on early bars, then true, is a run after skips the gate does not see) | `engine/blockRuns.js` / `api/services/block_runs.py` (one rule, held by the parity fixture) | read an `na` test as false for a `?:` gate from a document that declares `meta.naConditionFalse` (both lanes, a new parity column), keeping C48's statement-form rule as it is |
| L5 | `bgcolor` / `barcolor` colours | — | — | CLOSED by H1: a paint's colour rule is gated like a plot's (its condition column), and a withheld paint draws nothing |
| L6 | the arm walk re-reads a nested chain once per level: `armHistoryCallOf` walks each `?:`'s arms, so an N-deep `else if` / colour chain costs O(N²) node visits at translation | slow, never wrong | `Resolver.stampTernaryArms` → `armHistoryCallOf` | a per-translation memo keyed by parse node (`WeakMap`), recording only answers reached without the depth cap |
| G-a | (pre-existing, C48) a plot whose COLOUR reads a name an `if` STATEMENT binds is withheld WHOLE: C48's gates are collected per output (`resolver.blockRuns`), not per tree, so H1's colour-only rule does not reach them | over-withholds | `pine.js` output loop (`resolver.blockRuns` is filled while value and colour resolve alike) | attribute each C48 mark to the tree that read it (value or colour rule) and route a colour's to its condition column, as `colourBlockRunsOf` does for arms |
| G-b | Pine v1-v4 BARE built-ins (`sma(…)`, `highest(…)`) are not read as history calls by either lane: C48's mark reads `ta.*` tokens (`taCallIn`), the arm walk reads `ta.*` names and history helpers | under-withholds (a v4 `if` block or `if` expression calling `sma` is drawn off every bar) | `objectFnInline.taCallIn`, `pine.js::armHistoryCallOf` | one v4 roster of history-keeping bare names for both (the names `PINE_NAMESPACED_TREE`'s legacy route resolves), witnessed by Q-PT3 |
| G-c | the run-length counter fold copies its condition through `JSON.parse(JSON.stringify(…))`, which drops a stamp inside the condition (`n := up and ta.rising(close, 2) ? n + 1 : 0`) | under-withholds | `pine.js`, the counter fold's `copy()` (search `RESOLVED ONCE AND COPIED`) | a structural copy that carries `_armRuns` (`carryArmRuns`), keeping the JSON copy's NaN behaviour measured first |
| G-d | a withheld COLOUR is not disclosed on the chart: its refusal sits in `columnErrors` under the hidden condition column's key, which no surface reads, and the plot draws in its series colour (the pane's gold for a conditional colour, this repo's "colour not carried" marker) | silent fallback (the colour, never the value) | `binder.columnErrorsOf`, `infoValueResolve` | surface a condition column's refusal on the plot it colours (the info row's `title`), by the gate's own sentence |
| G-e | (by design, M1) off the listing a recurrence's bounded window reads its SEED W bars back, where an arm in it holds the every-bar history; not gated, because the window's own convergence rule already answers for the seed | — | `interpret.js` bounded window | not a gap of this rule |
| G-f | (object lane, pre-existing; found while merging #604) a `ta.*` call written in a drawing's NON-colour argument inside a block that varies (`if close > close[1]` / `label.new(…, str.tostring(ta.sma(close, 5)))`) is drawn off the every-bar call; and a colour `var` written in such a block (`c := … ta.rising(…) …`) is not carried at all, so the drawing paints the renderer's default | under-withholds | `pine.js` object pass (`valueRef` text / number slots; `objectBlockRunsOf` covers number `var`s, not colours) | the C48 object-lane gate (#604's `program.blockRuns`) extended to inline calls of a block's own drawings, and colour `var`s carried or held |

## Alerts the server lanes now withhold (review round 2, M2)

This deploy switches on server enforcement of every C48 stamp already saved (the alert lane and the
scan sweep read `meta.blockRuns`; before it, only the chart did). An armed alert on such a plot now
evaluates to no number on bars where the chart withholds it, and goes quiet. It is not left silent:
the silent-alert sweep (`indicator_alert_service.sweep_silent_alerts`, every 5 minutes) now diagnoses a
member's own formula through the user lane (`_diagnose_user`) and writes `state = needs_attention` with
the gate's own sentence in `state_detail`, which every alert surface renders verbatim
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
