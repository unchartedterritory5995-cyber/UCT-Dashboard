# Engine 58 — COND-TA: a `ta.*` call that runs only on some bars, on every door

Plan unit U2 (`REMAINING-SCOPE-2026-11-14.md` section 2). Branch `fix/pine-engine-cond-ta`, cut from
`origin/master` `2c37c37f9a`. `SCRIPT_ENGINE_VERSION` 57 -> 58 (numbered at the merge of master `1fb6e22ced`, 2026-11-16; it was the placeholder 55 while built:
engines 55-58, calc_bars/format, highest/lowest and the lenient block-local hotfix #1326 are in flight).

## The rule

Pine keeps a `ta.*` call's history PER CALL SITE: a call written in an `if` block, in one arm of a
`?:`, in a branch of an `if` expression, in a helper called from one, or on the right of a v6 `and` /
`or`, advances only on the bars that code runs.

- Witnessed: `vw-call-site-history-{rddt,spy}-1d-2026-10-01` (C48: C03 / C04 / D02 windows count
  executions) and `vw-arm-history-{rddt,spy}-1d-2026-10-02` (C45: T03 / T04 / T05 / K02 / K03).
- Documented for Pine v4 (the v4 User Manual, Functions and annotations, "Execution of Pine
  functions and historical context inside function blocks"): "The history of series variables used
  inside Pine functions is created through each successive call to the function." … "Such functions
  will not return expected results if they are placed in contexts where they are not executed every
  bar, as would be the case for a `label.new` function call inside an if branch" … "In this script,
  `barssince` is not called on every bar because it is inside a ternary operator's conditional
  branch" … "This leads to incorrect results because `barssince` is not executed on every bar".
- NOT documented for v1-v3 (the v3 manual's statement and function pages say nothing either way),
  and not captured. An unwitnessed number is withheld by name, never guessed.

## What each door did on master (probe shapes; RDDT 1D bars of the C48 capture)

| door | `if` block | `?:` arm | v1-v4 bare (`sma`) | verdict |
|---|---|---|---|---|
| screener lane (`translatePine(src)`, the Import tab's Apply -> a saved screen / alert) | `ok`, every-bar formula, **242 / 635 bars wrong** vs C03 | `ok`, every-bar, 242 / 635 wrong | `ok`, every-bar | **WRONG** |
| host / pane lane (`strict: true`, `memberPaneDefinition`) | v5 / v6 gated (`meta.blockRuns`, withheld at the bind where the block runs after a skip) | v5 / v6 gated | **not read as a history call** (gap G-b): no gate, every-bar; v1-v4 `?:` never stamped | **WRONG for v1-v4** |
| object lane (`pineObjects`, drawing colours / one-run rewrite) | gated / held | held | bare calls not seen (same G-b) | **WRONG for v1-v4** |
| runtime lane (`buildRuntimeIr` / VM) | exact (per-call-site state) for `ta.sma` / `ta.ema` / `ta.rma` in a root block, else `runtime:conditional-history` | exact for a v6 root arm (+ one-arg `ta.change`), else refused | served per call site in **v1-v4 and no-pragma** (`pineVersion < 5`) | exact, except **v1-v3 served unwitnessed** |
| Python (`ast_interpret` + `block_runs`, alerts / scans / backtests) | evaluates the saved trees column-wise and honours the document's `meta.blockRuns` | same | same | **wrong exactly where the documents above were**: a screener (Apply) document carries no gate at all; a v1-v4 pane document carried none for bare calls |

## What changed

| file | change |
|---|---|
| `engine/ast/pine.js` | the screener lane resolves outputs with the host lane's gates ON (`resolver.condGate = true`) and REFUSES each value gate by name (`pine:block`, the gate's own sentence + `SCREEN_GATE_SENTENCE`) — no chart is bound there to withhold it. A one-run (`barstate.islast`) block now reads its one run there too (exact: `na` for C48 A03). `stampTernaryArms` stamps `?:` arms in every version (v4 documented lazy; v1-v3 unknown, so withheld where the readings could differ). `armHistoryCallAt`, `partReadsCallHistory` and the object lane's colour arm walk ask `isTaCallName`. The legacy predicate is installed per translation (`setLegacyTaCall`, restored in `translatePine`'s `finally`). |
| `engine/ast/objectFnInline.js` | `isTaCallName` / `setLegacyTaCall`: `taCallIn` (C48's block mark, C42's one-run rewrite, `callHistoryFunctions`, the object pass) hears a v1-v4 bare call. |
| `engine/ast/legacyTaNames.js` (new) | the v1-v4 bare roster, equal name for name to `api/services/pine_capabilities.py::_COND_TA_BARE` (railed). |
| `engine/ast/pineRuntimeFrontend.js` | bare calls served per call site in Pine v4 only; v1-v3 and no-pragma keep `runtime:conditional-history`. |
| `api/data/pine_runtime_allowlist.json` | `conditional-ta`: `divergent` -> `conformant`, admitted, 7 captures / 4 community scripts. |
| `engine/scriptEngineVersion.js` | 55. |
| tests | `ast/condTaLanes.test.js` (new); pins flipped in `vendorHarness.c48CallSite` and `vendorHarness.c45ArmRuns` (the screener lane); `tests/test_pine_runtime_switch_on.py` R4, `tests/test_pine_capability_admission.py` (admitted set, allow report, REACH `WITHHELD_WHOLE`). |

## `?:` arms by Pine version — WITNESSED (run s17-2026-11-15, NYSE:RDDT 1D from the listing)

| version | arm | witness | COND-TA |
|---|---|---|---|
| v1 (no pragma), v2, v3 | EAGER | probe P2 `vw-ternary-arm-legacy-v1/v2/v3`: `change`, `sma`, `ema`, `rma`, `barssince`, `cum` in the else arm equal their every-bar values on every bar; `cci-coded-obv` / `trade-archer-obv-mas-v1` (S2 / S4 triage, no pragma): TradingView = eager OBV on 666 / 666 bars, lazy misses 662 / 666 from bar 4 | not stamped: drawn eager, as master did (both scripts value-exact on this head and on master: 0 value / 0 na mismatches; their DIVERGE is the v1 colour palette, unchanged) |
| v4 | LAZY | probe 10 `vw-cs2-v4-ternary-lazy`: `sma`, `barssince` and a helper calling `sma` in an arm see only the arm's bars (bar 7: TradingView na, eager 53.72) | stamped like v5 / v6: withheld by name where the test varies (master drew the every-bar number: wrong on up to 299 bars); runtime refuses (`?:` laziness is served at v6 only) |
| any | `iff` EAGER | P2 / probe 10 C00 | never stamped |

The P2 sources read `n`, which this engine refuses (`pine:undefined`); the rails use `cum(1) - 1`.
⛔ `if` BLOCKS in v2 / v3 are not part of P2: their bare calls stay history calls (gated), as before.
The Pine-import hold skips a v1 door-stamped import (no `if` exists in v1); v2 / v3 imports stay
candidates (their saved `?:` may be an `if` block, whose rule P2 does not settle).

## The `c48CallSite` pin — ruled from evidence

It pinned the screener lane's reading of `if close > open` / `v := ta.sma(close, len)` as the strict
lane's formula, `close > open ? sma(close, 3) : 0 / 0`. That formula, evaluated over the C48 capture's
own bars, differs from TradingView's C03 on **242 of 635** bars (`condTaLanes.test.js` §2, the same
count the c48 file's own ⚰️ test derives from E03). The runtime lane's per-call-site reading of the same
source differs on **0**. So the pin was wrong and is flipped: the row is refused by name, the every-bar
plot beside it is untouched, and no parameter id moves. `c45ArmRuns`' screener pin is flipped for the
same reason (T03 / K02).

## `vw-deadband-ticks-brk-a` (the one runtime-drawn DIVERGE) — explained, not conditional-ta

- The capture does not assert its history starts at the listing (`history.startsAtBar0: false`,
  "not asserted"; SPY and AAPL in the same batch do). So the run is OFF the listing, and the curtain
  (`runtimeColumns.computeOffListing`) refuses every column `runtime:warmup-never-converges`: `dbhf`
  is a `var` seeded at bar 0, and two runs from different first bars never agree EXACTLY.
- Every plot is INCONCLUSIVE ("our side produced no column"); the verdict's one DIVERGE is the paint:
  `barcolor` "notDrawn" (B1 grades a paint our side did not draw as a gap). `verdictWithoutPaints` =
  INCONCLUSIVE. **Nothing wrong is drawn: everything is withheld by name.**
- With the history stated from bar 0 (the capture's own `D00_bar_index_CONTROL` reads 0 on its first
  bar, 1979-07-03), `D03_dbhf` equals TradingView on **11,335 / 11,335** bars (scratch probe, this branch).
- The conditional call (`ta.atr` in `getBaseTau`'s `if mode == "ATR"` branch) never runs: Threshold
  Mode is the input `"Ticks"`, a test decided before bar 0.
- Consequence for admission: the capture is admitted with `conditional-ta` and drawn by nobody. The
  REACH rail names it in a closed set (`WITHHELD_WHOLE`) and RE-PROVES the shape from its own record on
  every run (all plots no-column INCONCLUSIVE, no objects, paints-only DIVERGE); any drift, or any other
  capture, is a REACH stop. **Coordinator ruling (2026-11-15): re-capture preferred.** The capture agent
  re-takes BRK.A 1D with `startsAtBar0` asserted; the named exception is TEMPORARY, with a TODO in
  `tests/test_pine_capability_admission.py` to remove it when that capture lands.

## Saved screens / alerts that hold a now-refused shape (scope 4)

- A screen or alert made by the Import tab's **Apply** is a FORMULA document: the translated text,
  re-parsed. It never holds the script (no `pine_source`) and is never engine-stamped
  (`attachPineAs` stamps only `compute.kind === 'ast'` documents), so the engine bump does **nothing**
  to it (`savedScriptUpgrade.upgradeKindOf` answers `none`): it keeps its every-bar tree, and the server
  lanes keep evaluating it, until the member applies the script again (which now refuses by name).
- Detectable as Pine-origin: `meta.importedFrom = {dialect: 'pine', via: 'apply', sourceLength,
  sourceFingerprint}` (`BuilderSheet.applyProvenanceFor`, Phase 4) — `user_definitions.is_pine_import`
  already reads it. Rows saved before Phase 4 carry nothing (not migrated, per that phase's own audit).
- The SHAPE is not detectable with certainty: only a fingerprint of the source is kept. A heuristic is
  possible (a Pine-origin formula whose tree holds a stateful call under a `?:` arm with a non-constant
  test — the printed form of every refused shape), but it also matches correct ones (a guard true on
  every bar) and hand-edited formulas. Not built (no migration, per the brief); a read-only count would
  be a pod query against `user_definitions.db`.
- Pane documents (`memberPaneDefinition`, stamped, script attached) re-translate once on the member's
  next chart load (engine 55): a v1-v4 document gains its block gates and is withheld at the bind where
  the block skips; nothing is REFUSED at translation for it, so no refusal is recorded.
- Same question as the #1326 review (block-local `x[1]`): the same answer applies to both.
- **Coordinator ruling (2026-11-15): HOLD THEM.** Read-only prod count: 109 live definitions, 6 with
  `meta.importedFrom.dialect == 'pine'`, all 6 formula-only (no `pine_source`). Built here:
  - `scriptEngineVersion.js`: `PINE_IMPORT_FIX_ENGINE` (the engine that landed COND-TA; renumbered with
    it), `PINE_IMPORT_HELD_SENTENCE`, `pineImportHeld(row)`: a Pine import holding no script whose
    `importedFrom.engine` is missing, not an integer, or below the fix engine.
  - server: `user_definitions.pine_import_stale` inside `engine_withheld_reason` — the one question
    alerts, the sweep, on-demand runs, backtests and the scannable stamp already ask — answering
    `engine-refused: This script was imported from Pine before a calculation fix. Re-apply the import
    to update it.` The fix engine is READ from the browser's declaration (one authority); unreadable
    fails closed (every such import held).
  - chart: `savedScriptUpgrade.upgradeKindOf` -> `import-held`; `resolveRow` does not draw it and reports
    the same sentence by name (`useUserDefinitions` uninstalls it), so the chart and the server agree.
  - re-applying: `BuilderSheet.applyProvenanceFor` stamps `importedFrom.engine = SCRIPT_ENGINE_VERSION`,
    which lifts the hold. A formula edit that is not a re-apply keeps the old provenance and stays held.
  - provenance only: nothing reads or logs the script (the row keeps none).
  - this also covers #1326's stale-tree case (a block-local `x[1]` the lenient lane read as the previous
    BAR): an Apply document saved before the fix is held whichever shape it holds.
  - **NARROWED** (ruling after the #1326 review; prod read-only: 3 current Pine Apply saves, 0 with a
    guarded offset, 1 with a call under a ternary arm): only a STRUCTURAL CANDIDATE is held —
    `conditionalHistoryCandidate` / `conditional_history_candidate` (node for node): a CALL under an arm
    of a `?:` (an `if` block and an `if` expression print as one) or of `iff(c, a, b)`, or an OFFSET under
    a `?:` arm, anywhere in `compute.ast` or `compute.trees`; a tree too deep to read fails closed. Every
    other Pine import is served as before.
  - rails: `tests/test_pine_import_hold.py` (19; mutants P1-P7 all KILLED — P6 the narrowing removed,
    P7 an arm offset unseen — restored, control green) and `engine/__tests__/pineImportHold.test.js`
    (run pending, lock moratorium; mutants J1-J5 queued).
- **F3 (ruling): the Apply door keeps its script.** An Apply save whose maths is still exactly what the
  Apply wrote (the scan formula and every row's, recorded once the Apply's state renders) sends the
  applied script as `options.pineSource` -> the row's own `pine_source` column, as `attachPineAs` does;
  never inside the document; a share install strips it (`install_share`, owner ruling, all documents).
  A hand edit after Apply sends none, so a later re-translation can never undo it (L2). Rails:
  `BuilderSheet.pine.test.jsx` (two cases; mutants J6 / J7 queued).

## The #1326 review's sibling shapes (F1, F2)

| shape | before | after |
|---|---|---|
| F1 `h(s) => s[1]`, `if close > open` / `p := h(close)` (WITNESSED: `vw-call-site-history` H01) | screener `ok`, `close > open ? close[1] : 0/0` (the previous BAR), wrong on 163 / 634 | screener refused by name (`h` reads its own history); host gated and withheld at the bind; rail pins the every-bar tree's wrong-bar count against H01 |
| F2 `p := (x + 0)[1]`, `x` a block local | read as the previous BAR on EVERY lane, no gate (`blockLocalHistory` asked `name[k]` only) | `blockLocalHistory` reads any block-local name the offset's own expression reads (fail closed): host gated, screener refused; runtime already refused `(expr)[k]` in a block (review M1). Control: `(close + 0)[1]` (the chart's own series) is not gated. Mutant M13 queued |

## Mutation pass (copy aside, mutate, focused rail, restore from the copy; hash-object == HEAD blob for every one)

Rail: `ast/condTaLanes.test.js` (M12: `vendorHarness.c48CallSite.test.js`). Control (no mutation): green.

| # | mutant | result |
|---|---|---|
| M1 | `isTaCallName` hears the `ta.` prefix only | KILLED (v4 / v3 block, arm, if-expression, helper) |
| M2 | the screener lane does not refuse its value gates | KILLED |
| M3 | the screener lane resolves without `condGate` | KILLED |
| M4 | v1-v4 `?:` arms unstamped again | KILLED |
| M5 | the runtime lane serves v1-v3 bare calls per call site | KILLED |
| M6 | the arm walk hears the `ta.` prefix only | KILLED |
| M7 | the legacy predicate is not restored after a translation | KILLED |
| M8 | the roster drops a name (`cog`) | KILLED (parity with `_COND_TA_BARE`) |
| M9 | a tuple part ignores bare calls | KILLED |
| M10 | the object lane's colour arm ignores bare calls | KILLED |
| M11 | the screener lane refuses a value for its COLOUR's gates too | SURVIVED on the first pass: every colour rail was one the host withholds ALONE (`colourWithholdsAlone`), where the mutant is equivalent. Rail added (`a hiding colour with a conditional call`: an `na` entry, so the host keeps the gate on the plot); re-run pending (lock moratorium) |
| M12 | the c48 pin with the screener serving again | KILLED |

## Known over-refusal (FIXED 2026-11-16, see "Bar-constant parameter guards" below; kept as the record)

`fib-pivot-points-alerts` (v4, community; held s3, NYSE:RDDT 1D): **MATCH -> INCONCLUSIVE** on
both lanes. Its helper `is_newbar(res)` writes `if(res == 'Y')` / `ch := change(t) != 0 ? 1 : 0`.
G-b now reads the v4 bare `change` as a history call; the guard reads a PARAMETER that every call
site fixes to an input-derived (bar-constant) value, so the every-bar value is exact (master MATCH),
but the host's guard check knows only top-level invariant names, not a call site's arguments, and
the runtime lane declines too (`runtime:conditional-history`). By name, never wrong. Next PR:
"bar-constant parameter guards" (substitute the call-site arguments into the guard, v4 and v5
together), which rails this capture back to MATCH.

## Bar-constant parameter guards (2026-11-16, step 1 of the resume plan)

A guard inside a function body that reads a PARAMETER holds on every bar or on none, at each call
site, when every call site passes a bar-invariant argument. A `ta.*` call under it then keeps the
every-bar history, so it is drawn, as master drew it.

| rule | where | the script that needed it |
|---|---|---|
| a parameter every call site fixes is an invariant name inside that body | `objectFnInline.barInvariantParams`, asked by the fold of a function body (`pine.js`, `guardVariesIn`) | `macd-with-filter-visual-backtest-module-sample` (`get_MA(typ, len)` / `if (typ == "EMA")`) |
| a parameter HIDES a top-level invariant name of the same spelling | same | none in the corpus. On master a varying argument to such a parameter was read as the input and drawn every-bar: a wrong value, now gated |
| a v3 / v4 `input(…)` written with NAMED arguments is a simple input when `type =` says so; with no type its default must be a literal; a source type is a series | `objectFnInline.isSimpleBareInput` | `fib-pivot-points-alerts` (`pp_period = input(title = "Period", type = input.string, defval = "Day", …)`) |
| a parameter passed on to another function is fixed where the caller's own parameter is (least fixed point, so recursion proves nothing) | `barInvariantParams` | `19-strategy-supertrend-atr` (`filterLong(enable)` calls `filter(enable)`) |
| a call written in a function nothing calls is not a call site | `barInvariantParams` (`reached`) | `19-strategy-supertrend-atr` (`filterShort` is defined and never used) |

Fail closed, each by name: a method, an overload, a named argument, an argument count other than the
definition's, a function with no call site, and any argument the invariant reader does not admit.

Rail: `ast/condTaLanes.test.js` section 6 (10 cases). Mutants, each restored from a copy and the
control green after: P1 (proven parameters never added), P2 (parameters not hidden), P3 (a varying
argument admitted), P4 (an enclosing parameter read as the top-level name), I1 (source type admitted),
I2 (`type =` ignored), I3 (any default admitted), T1 (proven parameters never fed back), T2 (every
enclosing parameter taken as fixed), T3 (hidden parameters not removed), R1 (unreached bodies
scanned), R2 (reach does not follow calls): all KILLED. A guard on a named argument (P5) is refused
elsewhere first (`pine:named-argument`), so that check has no rail of its own.

### Blast radius after (same 1,278 files, base `5443154808`)

| lane | before these fixes | after |
|---|---|---|
| host lane, ok -> `pine:block` | 10 outputs in 3 scripts | **0** |
| host lane, `pine:block` -> ok | 0 | 13 outputs in 2 scripts (`advanced-custom-multi-ma-signals` 5, `ha-inside-bars-indicator-v1` 8: guards over named-argument inputs now read as constant) |
| screener lane, ok -> `pine:block` | 188 outputs in 51 scripts | **103 outputs in 23 scripts** (130 in 43 before interim ruling B, below) |
| screener lane, scripts refused whole | 24 | 3 |

Runs: `lc-base.json` and `lc-new6.json` (the final tree) in the scratch folder (local); `lc-new5.json` is the run before ruling B. `fib-pivot-points-alerts`,
`macd-with-filter` and `19-strategy-supertrend-atr` are back to drawn on both lanes.

### Every remaining screener-lane refusal, classified (step 3)

| group | outputs | scripts | class |
|---|---:|---:|---|
| `tools/visual_conformance/probes/vw-*` (written so the test varies; the witnesses themselves; the three `and` / `or` probes are served since ruling B) | 85 | 17 | wrong-value removal |
| `tests/fixtures/pine_blind` and `pine_screener`: a `ta.*` on the right of a v6 `and` / `or` | 0 | 0 | SERVED (interim ruling B): 17 outputs in 17 fixtures were refused before it. A known TradingView difference, below; the rule is stated by TradingView's to-v6 migration guide and is NOT captured |
| `supply-and-demand-zones-with-enhanced-signals`: `find_max` / `find_min` (`ta.highest` / `ta.lowest`) under `ta.change(high) != 0 …` | 2 | 1 | wrong-value removal (C48 shape) |
| `tradingviews-technical-analysis` (v4): `crossunder` inside a nested `?:` | 6 | 1 | wrong-value removal (v4 lazy, probe 10) |
| `vumanchu-b-divergences` (v4): `f_bot_fractal` reads `src[k]` in a `?:` arm | 4 | 1 | wrong-value removal (F1, H01) |
| the six below | 6 | 3 | **over-refusal** |

Total: 103 outputs in 23 scripts (counted from `lc-new6.json`, the final tree).

## ⛔ Known over-refusals on the screener lane (coordinator ruling 2026-11-15: ship, pinned, fix next)

Six outputs in three scripts are refused on the screener lane although master's number was RIGHT.
The earlier rule "ship only when every remaining refusal is a wrong-value removal" is relaxed for
exactly these six and nothing else.

| script | outputs | shape |
|---|---:|---|
| `smoothed-moving-average` (built-in) | 1 | `smma := na(smma[1]) ? ta.sma(src, len) : (smma[1] * (len - 1) + src) / len` |
| `williams-alligator` (built-in) | 3 | the same arm inside `smma(src, length)`, called three times |
| `smart-money-concepts-by-welotrades` | 2 | `high_eqh` / `low_eqh` under `if barstate.isconfirmed and show_equal_highlow` |

- **Why master was right.** The seed arm runs on a PREFIX of bars (while `smma[1]` is `na`) and
  never again, so the call's own history is the every-bar history on every bar it runs.
  `barstate.isconfirmed` is true on every closed bar.
- **Why it is refused now.** No static proof exists that an arm runs on a prefix: a gap in the data
  can make `smma[1]` `na` again and re-enter the arm, and from that bar the two readings differ.
  The host lane proves it per chart at the bind (no skip-then-run on this chart's bars) and DRAWS
  all three. The screener lane binds no chart, so it refuses by name.
- **Pinned.** `ast/condTaLanes.test.js` section 7: each refuses by name on the screener lane and
  is translated, gated and drawn on the host lane. The block goes red the day the follow-up lands.
- **Follow-up unit, next after the RS Rating admission:** the screener-lane run check (the gate
  evaluated per symbol server-side).
- **Saved imports: NOT RESOLVED by re-applying.** The narrowed Pine-import hold holds an Apply
  document with a CALL under a `?:` arm. A member's existing Apply save of the seed shape is held,
  and re-applying now refuses, so that member loses a screen that was correct until the run check
  lands. Production had 3 Pine Apply saves, 1 with a call under a ternary arm (read-only count,
  2026-11-15; its shape was not read). The hold is not widened or special-cased for it.

## ⛔ Known TradingView difference, served on the screener lane (interim ruling B, 2026-11-16)

Coordinator ruling, put to the owner as a decision he can overturn.

| shape | screener lane | host lane | versus TradingView |
|---|---|---|---|
| a `ta.*` call on the right of a Pine v6 `and` / `or` (`close > open and close > ta.sma(close, 5)`) | **served, every-bar, exactly as master** | gated (`stampLogicRight`), withheld by name where the right side runs after a skip | **differs from the per-run reference** (not measured against TradingView) on 53 of 635 RDDT bars for `up and close > ta.sma(close, 5)` (the bars of `vw-call-site-history-rddt-1d-2026-10-01`; `condTaLanes.test.js` section 8 pins the count) |

- **Why it is not refused.** The refusal was built and measured. It took the Screener import's own
  exams down in one step: `pine.screenerCorpus` 38 -> 32 (`01-oversold-in-uptrend`, `11-ema-stack`,
  `14-twenty-day-high-on-volume`, `16-pullback-in-uptrend`, `37-weekday-above-ma`,
  `38-switch-smoothing-choice`), `pine.blindCorpus` 27 -> 20 passing and its accepted floor
  37 -> 26 of 48, and six cases out of the frozen `screenerColumns` fixture the Python lane reads.
  `close > ta.sma(close, 200) and ta.rsi(close, 14) < 30` is the most natural screen a member writes.
- **The source of the rule.** Stated by TradingView's to-v6 migration guide (its own example is
  `close > open and ta.rsi(close, 14) > 50`); NOT captured (probe `vw-andor-history` written
  2026-10-31, never taken). Queued as Q-CT1 in
  `docs/pine/capture-queue-2026-11-16-cond-ta-followups.md`. ⛔ The follow-up unit must not switch
  the refusal on until Q-CT1 is captured and graded.
- **Scope, exactly.** The screener lane only, and the right side itself only
  (`armRunGates(…, { skipLogicRight: true })`). A `?:` arm, a block, a helper and an `if`
  expression stay refused on the screener lane, including one standing inside such a right side.
- **What does not move.** No floor in `pine.screenerCorpus`, `pine.blindCorpus` or `screenerColumns`.
- **Pinned.** `ast/condTaLanes.test.js` section 8: served on the screener lane, gated on the host
  lane, and the served number is shown NOT to be the per-run one. It goes red the day the refusal
  is switched on.
- **Mutants** (restored from a copy, control green): B1, the screener lane refuses the right side
  again, and B2, the exemption swallows every arm gate: both KILLED.
- **Closed by** the follow-up unit: the screener-lane run check + the hoist offer, after which the
  refusal is switched on with the accepted corpus intact. A member notice on the Import door for
  this shape is part of that unit (it needs a new note code; not built here).
- **The screener refusal sentence** now also says how to fix a refused shape: "or give that call
  its own line above (for example `r = ta.rsi(close, 14)`) and use the name here, which runs it on
  every bar".

## Verification at engine 58 (2026-11-16, master `1fb6e22ced` merged; re-merged at `771264afff`)

- Host parity HP-1: GREEN 166 / 166 (digests rewritten for the engine identity).
- Service smoke: re-recorded, PASS 4 / 4 (engine 58, canary green, unsigned POST 401).
- Section 8 (`tests/test_pine_runtime_*.py`, ten files): all green.
- Vendor harness, master `1fb6e22ced` against this branch, 1,136 captures (the committed fixtures
  and the 16 held-store folders), both lanes:

  | lane | MATCH | DIVERGE | INCONCLUSIVE | MATCH_SUBSTITUTED |
  |---|---|---|---|---|
  | production, before -> after | 251 -> 251 | 165 -> 165 | 720 -> 720 | |
  | runtime-on, before -> after | 312 -> 312 | 169 -> 169 | 652 -> 652 | 3 -> 3 |

  **0 MATCH -> DIVERGE at capture and plot level.** Two captures move, on both lanes:
  `vw-cs2-v4-ternary-lazy` DIVERGE -> INCONCLUSIVE (the witnessed v4-lazy wrong value, now withheld
  by name) and `flying-buddha-inside-bars-indicator-v1-by-justunclel` INCONCLUSIVE -> DIVERGE. The
  second is a newly graded colour gap that was already there: its five value plots now agree on
  666 / 666 bars (the parameter guards let the script through), and its `plotarrow` colour differs
  on 16 bars (`colorup` / `colordown` not carried). Filed for the next colour unit.
  This run was taken before interim ruling B and before the last master merge; neither touches the
  host or runtime lane.
- Admission (REACH) report regenerated from this branch: `runs/report.json` in this folder
  (319 admitted captures; master's had 274, the 45 more being scripts whose only unadmitted
  capability was `conditional-ta`). Runtime-lane stops: one, `vw-deadband-ticks-brk-a-1d-2026-09-28`,
  the named `WITHHELD_WHOLE` exception. Its re-take `…-2026-11-15` grades INCONCLUSIVE on the
  runtime lane, not the MATCH that was expected: DBHF, D00, D02 and D03 agree on 11,369 / 11,369
  bars and the bar colour agrees, and `D01_mintick` has no column on our side.

## Measurements and RESUME (2026-11-15, before the owner's PC restart)

**Status: NOT MERGEABLE YET (coordinator ruling (b)).** Pushed as it stands on
`fix/pine-engine-cond-ta`, head based on `5443154808` (engine 56); master has since moved to engine
57 (`d067c1c1b8`, #1342 RS Rating). The engine number is still the placeholder (`55 = COND-TA`,
`PINE_IMPORT_FIX_ENGINE = 55`, `SCRIPT_ENGINE_VERSION` = master's).

### What passed (this head, before the final rebase)
- Focused JS rails: condTaLanes 35, pineImportHold 8, barConstant 24, c45ArmRuns 74,
  c48CallSite 33, lenientBlockLocalHistory 9, objectFnInline.test 57, runtime conditionalCallSite 23,
  BuilderSheet.pine 18 (all green). Python: test_pine_import_hold + test_bar_constant 37.
- Section 8 (`tests/test_pine_runtime_*.py`, one file at a time): all green except
  service_smoke's engine rail (fixture not yet re-recorded; expected).
- Mutants (each restored from a copy, hash == HEAD blob, control green): JS M1-M13, M11b,
  J1-J8, B1-B5, L0 / L2 / L4 all KILLED; Python P1-P10 all KILLED.
- **Harness before/after** (base `5443154808` vs this branch; 1,091 distinct captures, the
  committed fixtures + 16 held-store dirs):
  - prod lane: MATCH 251 -> 250, DIVERGE 171 -> 170, INCONCLUSIVE 669 -> 671;
  - runtime-on lane: MATCH 299 -> 298, DIVERGE 178 -> 177, INCONCLUSIVE 614 -> 616;
  - **0 MATCH -> DIVERGE, 0 new DIVERGE** (capture and plot level, both lanes). The two moves on
    both lanes: `vw-cs2-v4-ternary-lazy` DIVERGE -> INCONCLUSIVE (the witnessed v4-lazy wrong-value
    fix) and `fib-pivot-points-alerts` MATCH -> INCONCLUSIVE (over-refusal, below).
- **Blast radius** (lenient + strict lanes over 1,278 `.pine`: 865 repo + 413 sample):
  - screener lane: 188 outputs ok -> `pine:block` in 51 scripts (v6 103, v4 58, v5 18, v3 9),
    24 scripts now fully refused, 1 top-level move to `pine:function-def`;
  - host lane: 10 outputs ok -> `pine:block` in 3 scripts: `reference/fib-pivot-points-alerts`
    (v4, 8), `committed/macd-with-filter-visual-backtest-module-sample` (v4, 1, `maVal`: one of the
    10 COND-TA targets) and `tests/fixtures/pine/19-strategy-supertrend-atr.pine` (v3, 1); 6
    scripts gain blockRuns gates (drawn where the guard does not vary).
  - Per-output reasons: NOT YET CAPTURED (the full-reason probe was queued on the heavy lock when
    the owner's restart deadline came). The measured diff (reasons cut to 90 characters) is
    `blast-radius-diff.json` in this folder; the full-reason run is step 2 of the plan below
    (`zzDetail.test.js`, `DT_LIST=detail-files.txt`, the 51 + 3 scripts).

### The over-refusal class (why this is not shippable yet)
A helper whose `if` guard reads a **parameter** that every call site fixes to a bar-constant value
(the v4 MA-type selector, `get_MA(typ, len)` / `if (typ == "EMA")` / `maVal := ema(src, len)`;
`fib-pivot-points-alerts`'s `is_newbar(res)`). G-b now reads the v4 bare call as a history call; the
host's guard check knows top-level invariant names, not a call site's arguments, so it refuses where
master drew the exact every-bar value.

### Not run yet
The admission (REACH) report regeneration, the five full vitest shards, the number step, host-parity
`--write`, the service_smoke re-record and the regrade (ledger restored).

### PLAN AFTER THE RESTART (coordinator ruling (b))
1. **Bar-constant PARAMETER guards**: a guard on a function parameter is bar-constant when every call
   site passes a bar-constant argument (substitute the call-site arguments into the guard, then ask
   `barConstantTree` / `guardIsBarInvariant`); v4 and v5 together; write a probe first if the v5
   `ta.*` answer in that shape is not already witnessed. Rail `fib-pivot-points-alerts` and
   `macd-with-filter` back to MATCH / drawn.
2. Re-run the blast radius.
3. Classify EVERY remaining refusal (per output) as a witnessed-lazy wrong-value removal or an
   over-refusal; fix or explain each over-refusal.
4. Ship only when every remaining refusal is a witnessed wrong-value removal. Then: rebase onto
   master, number = master + 1 (three places: `SCRIPT_ENGINE_VERSION`, `PINE_IMPORT_FIX_ENGINE`, the
   `NN = COND-TA` history line), `node tools/pine_runtime_host_parity.mjs --write`, the service_smoke
   re-record (procedure of commit `3ce7585ee3`; launcher copy `record56.py` with `REC_REPO`),
   section 8, focused rails, the admission report into this folder's `runs/report.json` (repoint
   `REPORT` in `tests/test_pine_capability_admission.py` and `capabilityEvidenceLane.test.js`),
   the vitest shards (`--maxWorkers = clamp(floor((freeGB - 6) / 1.5), 1, 4)`), the regrade with
   `docs/pine/vendor-harness/evidence-ledger.jsonl` restored before commit; push, PR.

### Exact commands (scratch: `C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/eng-condta-scratch/`)
- census + harness both lanes: `bash measure.sh <worktree> <tag>` (one heavy_lock hold per phase);
  diff: `python -X utf8 verdict_diff.py`.
- blast radius: `zzLenientCorpus.test.js` (scratch copy) with `LC_LIST=pine-files.txt
  LC_OUT=lc-<tag>.json`, base and branch; diff: `python -X utf8 lc_diff.py`; full reasons:
  `zzDetail.test.js` with `DT_LIST=detail-files.txt DT_OUT=detail.json`.
- mutants: `python -X utf8 mutants.py <names>` and `python -X utf8 mutants_py.py` (under heavy_lock).
