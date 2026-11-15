# Engine 55 — COND-TA: a `ta.*` call that runs only on some bars, on every door

Plan unit U2 (`REMAINING-SCOPE-2026-11-14.md` section 2). Branch `fix/pine-engine-cond-ta`, cut from
`origin/master` `2c37c37f9a`. `SCRIPT_ENGINE_VERSION` 54 -> 55 (**renumber at merge to master + 1**:
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

## Measurements

PENDING — the coordinator's lock moratorium (2026-11-15: no new heavy runs until engine 55 and #1326
merge) stopped the queued phases. To run, in order, each one heavy-lock hold:
1. lenient + strict lanes over every `.pine` (repo + sample), base worktree then this one;
2. census both lanes, harness both lanes over the fixtures + the held store (base, then this branch);
   gates: 0 MATCH->DIVERGE, 0 new DIVERGE;
3. capability admission measure (admission mode) + `capability_admission.py report` -> this folder's
   `runs/report.json` (REACH and `capabilityEvidenceLane.test.js` then read it);
4. `tools/pine_runtime_host_parity.mjs --write` (engine identity moved);
5. engine / builder suites in shards, focused pytest files one at a time; M11 re-run;
6. regrade of the held store (ledger restored before commit, coordinator rule).
