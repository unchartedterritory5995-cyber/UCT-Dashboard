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
  capture, is a REACH stop. **Coordinator decision requested**: keep the named exception, or re-capture
  BRK.A with `startsAtBar0` asserted (it would then grade MATCH, per the probe above).

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

## Measurements

(filled below)
