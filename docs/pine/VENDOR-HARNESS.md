# The vendor-comparison harness

> **What it answers:** for one Pine script on one symbol and timeframe, does the
> member door draw the SAME thing TradingView draws — bar by bar, on the
> vendor's own bars? `PARITY-PROGRAMME.md` ("Axis 2 — does it LOOK identical? —
> UNMEASURED") ruled that this harness comes before, or alongside, the next
> coverage push. Standing rule: *a render of our own output is not evidence of
> parity; only the vendor's own numbers show we drew the same thing.*

Branch `pine/vendor-compare-harness`, 2026-09-26/27. Status: **built, tested and
run over every capture on disk. No capture has yet been taken WITH the new
TradingView snippet** — its TradingView half is tested only against a recording
double of the chart model (see "What is and is not proven" below).

## Files

| file | what |
|---|---|
| `tools/vendor_harness/tv_capture.js` | the TradingView-side snippet — paste into a chart tab through a JS tool |
| `tools/vendor_harness/verify_capture.mjs` | Node CLI: assemble chunks + verify receipt/schema/source sha, or verify capture files |
| `tools/vendor_harness/schema.mjs` | the v1 capture format: validation, FNV-1a receipt, sha256 |
| `tools/vendor_harness/compare.mjs` | mapping rule, tolerance policy, per-plot comparison, verdicts, report |
| `tools/vendor_harness/adapters.mjs` | legacy fixture formats → v1, or a named reason why not |
| `app/src/components/chart/engine/__tests__/vendorHarness/ourSide.js` | OUR side: the member door run on the vendor's bars |
| `app/src/components/chart/engine/__tests__/vendorHarness/harness.js` | files → captures → our side → verdicts |
| `…/vendorHarness/vendorHarness.test.js` | rails + controls (36 tests) |
| `…/vendorHarness/vendorHarness.corpus.test.js` | the corpus run and the CLI entry |
| `tests/fixtures/vendor/harness/` | where NEW captures go |
| `docs/pine/vendor-harness/{verdicts.json,summary.md}` | the last corpus run's output |

## The capture format, v1 (`schema: "uct.vendor-capture/v1"`)

| field | what | why |
|---|---|---|
| `symbol` | `name, full_name, pro_name, exchange, listed_exchange, type, session, timezone, pricescale, minmov, currency` from `mainSeries().symbolInfo()` | `pricescale` sets the float floor; `timezone` turns a daily bar time into the product's ISO date |
| `timeframe` | `mainSeries().interval()` verbatim (`1D`, `5`, `12M`…) | mapped to the chart's own code (`D`, `5`, …) for the bind-time fold |
| `newestBarIsForming` | `false` when captured after the close; `null` if unknown | passed to `computeFor` exactly as the chart passes it |
| `history.startsAtBar0` | `true` ONLY when the loaded history reaches bar 0 | with no pre-window state, there is no warm-up excuse: every bar counts |
| `source` | `{text, sha256, chars, declaredTitle}` — the exact Pine that was added to the chart | the script compared must be the script the vendor ran |
| `census` | the study count with its control (events filtered by `shortId`) | capture-procedure.md "COUNTING STUDIES" |
| `study.plots` | `metaInfo().plots` IN ORDER: `{id, type, target?, palette?, title}` | ⛔ never `Object.keys(styles)` — the Aroon trap |
| `study.styles / styleState` | `metaInfo().styles` and `properties().state().styles` (colour, transparency, width, display) | static plot colour |
| `study.palettes / paletteState` | `metaInfo().palettes` (+ `valToIndex`, default colours) and the property-state palettes | a colorer's value is a palette INDEX |
| `study.inputs` | `metaInfo().inputs` (`id, name, type, defval, isHidden`) with the values the study ran with | inputs are part of "the same script": v1 runs our side at DEFAULT inputs, so a capture whose visible inputs were edited is INCONCLUSIVE (re-capture at defaults) |
| `window` | `chartBarsLoaded`, `studyBarsLoaded` (the study's own buffer — the window-check number), first/last bar time | depth is part of the answer (`HVE Trigger`, 2026-09-12) |
| `bars` | `{fields:[time,open,high,low,close,volume], timeUnit:"unix-s", rows}` — the VENDOR'S OWN bars | any delta is then a maths delta, never a data delta |
| `plotValues` | `{fields:["time", ...plot ids], rows}` — `study.data()` rows; `na` is `null` | the per-bar answer |
| `objects` | `graphics()` drawings per family: `counts`, raw `records`, label / table-cell `texts`, `unreadable` families | the object lane's answer |
| `receipt` | `{algo:"fnv1a32-utf16", chars, fnv1a}` over `JSON.stringify(capture without receipt)` | transport corruption is detectable; indentation on disk is free |

Legacy captures carry `adaptedFrom`, and optionally `tolerance.readDecimals`,
`warmup` (declared) and `explains` (a `divergences.json` id).

## How the parent / owner takes a capture (TradingView, with a JS-execution tool)

Read `docs/pine/capture-procedure.md` first — the visibility gate v2.1, the
scratch layout, the "Add to chart" binding gate and the paste route are all
there and are not repeated here.

1. **Visibility gate v2.1** on the tab you will drive (visible, on the display).
2. **Record the chart state** you will restore: `getSymbol()`, `getResolution()`,
   pane stretch factors, study visibility. Use the **scratch layout with zero
   studies** (capture-procedure.md, "THE RIG IS A SCRATCH LAYOUT").
3. **Set the symbol and timeframe** (UI or the chart API; J2 discipline for a
   resolution change — assert the read-back). Never the `All` range button (it
   switches to `1M`).
4. **Create a NEW blank indicator**: Pine editor → script-title chevron →
   **Create new ▸ Indicator**. Put the exact source in the editor (the Monaco
   handle route — "PUTTING SOURCE IN THE EDITOR WITHOUT A PASTE"). ⛔ Never open
   an account-scoped user script for writing.
5. **Add to chart** — only when exactly one visible, enabled element's OWN text
   is `Add to chart` and `Update on chart` is absent ("THE BINDING HAZARD").
6. **Wait for the study to compute** and **check depth**: the study's own buffer
   must cover the script's largest window (the window check). Force depth with
   the **Go to date** control if needed. If the symbol's whole history is loaded
   (a young listing, or `12M` on SPY), you may assert `startsAtBar0: true`.
7. **Paste `tools/vendor_harness/tv_capture.js`** (the whole file) through the JS
   tool. It returns `uct vendor harness ready…`.
8. `__uctVH.studies()` — confirm the census (`controlProbeSawSomething: true`,
   `controlFilterRemovedExactlyTheEvents: true`) and the study's title.
9. `__uctVH.capture({study: '<title substring>', source: '<the exact Pine>', id:
   '<script>-<sym>-<tf>-<yyyy-mm-dd>', newestBarIsForming: false, startsAtBar0:
   false})` — it throws (writes nothing) on an ambiguous name, a compile error, an
   empty study, or a census that fails its control. Read `warnings` (e.g. the
   source's `indicator("…")` title not matching the study).
10. For `i` in `0 … chunks-1`: `JSON.stringify(__uctVH.chunk(i))` and save each
    result VERBATIM as `chunk-000.json`, `chunk-001.json`, … in a scratch dir.
    (Default chunk 60,000 characters; pass `chunkSize` if the tool's output limit
    is smaller.)
11. Assemble and verify — nothing is written unless every chunk hash, the total
    length, the total hash, the receipt, the schema and the source sha agree:
    ```
    node tools/vendor_harness/verify_capture.mjs --assemble <scratch-dir> --out tests/fixtures/vendor/harness/<id>.json
    ```
    Read the exit code and the `VERDICT:` line; never through a pipe.
12. **Leave the chart as you found it**: remove the study, restore symbol,
    resolution, stretch factors and visibility, then `__uctVH.cleanup()`
    (`globalsLeft: []`).
13. Run the harness (below) and commit the capture with its verdict.

## Running the harness

```
cd app
# every capture under tests/fixtures/vendor (native + legacy):
npx vitest run src/components/chart/engine/__tests__/vendorHarness/
# a directory of captures, writing verdicts.json + summary.md:
VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=../docs/pine/vendor-harness \
  npx vitest run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
```
(PowerShell: `$env:VENDOR_HARNESS_DIR='…'; $env:VENDOR_HARNESS_OUT='…'; npx vitest run …`.
`npm run vendor-harness` is the same corpus run.) The vitest entry exists because
our side imports the engine, which only runs under vite's transform.

## Our side — the member door, not a second evaluator

`ourSide.js` calls, in order, what a member's paste reaches:
`memberPaneDefinition({source, id})` → `installUserDefinitions([def])` (the
install door re-validates) → `computeFor(def, bars, undefined, {tf, symbol,
newestBarIsForming})` (the call `binder.sync` makes per instance) → the real
`createBinder(...).sync(...)` over the repo's recording chart double, reading
each plot's colour off the points the renderer was handed → for a script that
draws objects, `objectReaderFor → evaluateObjects → toRenderState`. Lines,
labels and boxes are counted as the runtime HOLDS them at the last bar, because
that is what the capture's `graphics()` counts are — measured 2026-09-27 on
Zero-Lag MA Trend Levels, TradingView keeps 18 boxes of which five have an `na`
edge; the render state cannot draw those five, and each held-but-undrawable
object is named in `ourNotes`. Tables and cells are counted from the render
state. It moves the vendor's bars into the product's bar
shape (a daily bar is an ISO date in the exchange timezone, as `/api/bars`
serves it) and changes no number. A refusal at either door is the verdict:
INCONCLUSIVE, with the door's own sentence.

## Mapping rule (vendor plot → our plot)

Vendor value plots are `metaInfo().plots` of type `line / shapes / chars /
arrows`. `colorer` plots colour their `target`; `alertcondition` draws nothing
on TradingView either and is listed as not compared; any other type is listed
by name as not compared by v1.

- **M0** — a plot with an explicit `selector` (legacy observations name their
  plot by our translation's formula) is mapped by it and nothing else.
- **M1** — by title, exact, when unique on BOTH sides.
- **M2** — leftovers pair by position ONLY if both leftover lists have equal
  length and every leftover title on both sides is a default (empty, `Plot`,
  `Plot N`).
- Anything else is **UNMAPPED → INCONCLUSIVE**, with the reason. Our plots with
  no vendor counterpart are listed, never graded.

## Tolerance policy

- **na-ness: exact.** A value against `na` is a divergence at any magnitude.
- **colour: exact** on `#rrggbbaa` (TradingView's `transparency` folded into the
  alpha; our `opacity` likewise).
- **floats:** agree when `|ours − vendor| ≤ ABS` or `≤ REL·|vendor|`.
  `REL = 1e-9` — the owner's T5 ruling (`seriesCompare.js`): same arithmetic on
  the same bars differs only by evaluation order, ~1e-15 per op.
  `ABS = 1e-6 / pricescale` — a millionth of the symbol's tick: six orders below
  anything TradingView can display, seven above double noise at price scale; it
  only ever decides values near zero. Unknown pricescale ⇒ `1e-12`.
  A legacy capture's `readDecimals` raises ABS to half a unit in that decimal —
  the vendor's own stated display precision. ⛔ Never widened to fit a delta.

## Warm-up vs steady state

- `history.startsAtBar0: true` ⇒ **no warm-up region**; every bar counts.
- else a capture-declared warm-up (legacy `_vendor_parity_warmup_bars`, labelled
  as FITTED) is used when present;
- else our evaluator's own `maxLookback` for the plot (derived, never typed).

Divergences inside the warm-up are reported separately and do not fail the
plot. Steady-state divergences carry a **pattern**: `converging-prefix` (starts
at the first steady bar, error falls, every later bar agrees — the signature of
a recursive state seeded at the capture window while the vendor carried history,
a DATA-axis cause settled by re-capturing from bar 0), `persistent` (to the last
bar) or `scattered`. The pattern never changes the verdict.

## Reading a verdict

- **MATCH** — every compared steady-state bar agrees on value, na-ness and (when
  captured) colour, and at least one bar was compared. For objects: counts and
  texts agree. ⚠️ v1 does not compare object coordinates, fills, bgcolor /
  barcolor, hlines or plot offsets — those are listed under `notCompared` /
  `notMeasured`, never counted as agreement.
- **DIVERGE** — measured. `stats.steady.first` names the bar, its time, the kind
  (`value` / `na` / `color`) and both readings; `stats.steady.last`,
  `maxAbs`, `maxRel` and `pattern` bound it.
- **INCONCLUSIVE** — could not compare: refused script (with the door's
  sentence), a study run with non-default visible inputs, failed receipt / schema / source sha, unmapped plot, no compared
  bar, a hole in the vendor rows after the study started, or colour captured but
  unresolvable on our side.

Capture verdict: DIVERGE if any item diverges, else INCONCLUSIVE if any item
could not be compared, else MATCH.

## What is and is not proven

- **Proven by tests (measured):** the capture schema and receipt; the snippet's
  packaging (plot order, census control, NaN→null, padding dropped, chunking,
  FNV-1a/sha256 byte-equality with Node) **against a recording double**; the
  comparator; the member-door run on real vendor bars; the controls below.
- **Not proven until the first live capture:** that TradingView's current model
  still exposes every accessor the snippet reads (`dataSources`, `metaInfo`,
  `data().each`, `bars().each`, `properties().state()`, `graphics()`,
  `status()`). The snippet reads each defensively and names what it could not
  read (`objects.unreadable`, `warnings`), rather than recording a zero.

## Controls (in `vendorHarness.test.js`)

- one vendor value moved by one cent at bar 1500 of the SMA capture ⇒ DIVERGE,
  exactly one steady-state bar, first divergence at bar 1500 with both readings;
  the same edit WITHOUT re-sealing ⇒ INCONCLUSIVE (receipt).
- a vendor `na` where we have a value ⇒ DIVERGE of kind `na` at that bar.
- a vendor plot titled `NOT_A_PLOT_ON_OUR_SIDE` ⇒ that plot UNMAPPED, capture
  INCONCLUSIVE (never MATCH); the mapped plot still MATCHes.
- colour and objects, SYNTHETIC vendor state over real vendor bars: agreeing
  colour ⇒ MATCH, `#2962FF` vs our `color.red` ⇒ DIVERGE (kind colour); table
  cell `UCT` ⇒ MATCH, `NOT UCT` ⇒ DIVERGE.
- mutation-proved: comparator stubbed to always-MATCH (6 red), `valuesAgree`
  always true (4 red), unmapped plots dropped silently (3 red), receipt never
  failing (2 red), adapter coercing named readings (1 red), our side reporting
  no colours (2 red), the non-default-inputs rule disabled (1 red) — each
  restored from captured bytes, sha256 verified.

## First corpus run (2026-09-27, on disk before any new capture)

16 captures graded, 80 files listed as not comparable (each with its reason —
see `docs/pine/vendor-harness/summary.md`). **MATCH 7 · DIVERGE 8 · INCONCLUSIVE 1.**

| capture | verdict | note |
|---|---|---|
| sma20, wma20, hma20, stoch %K 14 (SPY 1D) | MATCH | max rel ≤ 2.3e-15 |
| macd line / signal / hist (SPY 1D) | MATCH | under the capture's FITTED warm-up (210 bars); derived lookback 26–35 |
| ema20, rma14, atr14, −DI (SPY 1D) | DIVERGE | converging prefix: error falls to ~5e-7 and every later bar agrees — cold start of a recursive smoother seeded at the capture window (`divergences.json::recursive-smoother-cold-start-in-a-finite-capture`) |
| rsi14, +DI (SPY 1D) | DIVERGE | same shape, error hovering at the 5e-7 floor inside the run |
| adx14 (SPY 1D) | DIVERGE | same cold start, too short a tail after it to classify (scattered) |
| seed-warmup (SPY 12M, from bar 0) | DIVERGE | 7 of 8 plots MATCH; **`ta.atr(5)` diverges from bar 4 (vendor 13.96875, ours na)** — the member door's `atr` starts its true range at bar 1; this is `divergences.json::atr-tr-starts-at-bar-1` (accepted, ruling owed), re-measured independently through the door |
| w2-warmup (SPY 12M) | INCONCLUSIVE | the member door refuses the whole script (`pine:role-order` on `ta.cci(close, 5)`) |

⚠️ Every DIVERGE above except `atr5` is a capture-window artefact (DATA axis),
not a maths difference: the observations start deep in SPY's history. A capture
from bar 0 (a young listing, or SPY `12M`) is what settles them.
