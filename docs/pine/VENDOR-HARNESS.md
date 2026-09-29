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
| `tools/vendor_harness/batch_capture.py` | the UNATTENDED batch: steps 1–12 per manifest script, resumable, plus `recon` and `grade` (see "Unattended batch") |
| `tools/vendor_harness/batch_manifest.py` | derives the batch's target list from the member-door census |
| `tools/vendor_harness/batch_double.py` | the recording double of the TradingView page the batch is proved against (`--self-check`) |
| `…/vendorHarness/memberDoorCensus.measure.test.js` | opt-in census: every corpus script through `enterMemberDoor`, both door-flag states |
| `docs/pine/vendor-harness/batch-manifest.json` | the committed manifest (derived; regenerate, never hand-edit) |
| `docs/pine/vendor-harness/{verdicts.json,summary.md}` | the last corpus run's output |

## The capture format, v1 (`schema: "uct.vendor-capture/v1"`)

| field | what | why |
|---|---|---|
| `symbol` | `name, full_name, pro_name, exchange, listed_exchange, type, session, timezone, pricescale, minmov, currency` from `mainSeries().symbolInfo()` | `pricescale` sets the float floor; `timezone` turns a daily bar time into the product's ISO date |
| `timeframe` | `mainSeries().interval()` verbatim (`1D`, `5`, `12M`…) | mapped to the chart's own code (`D`, `5`, …) for the bind-time fold |
| `newestBarIsForming` | DERIVED by `tv_capture.js` (v2, 2026-09-28) from the chart: the newest bar's period end (intraday: start + N min capped at its session segment; 1D: that day's close; 1W/1M: the close of the week's / month's last trading day, `session_holidays` read) against the capture instant. A caller's assertion is used only when that cannot answer (`2W`, no session); `null` if neither. `newestBar` carries `{time, source, derived, periodEndUTC, rule, asserted}` | passed to `computeFor` exactly as the chart passes it. ⚰️ v1 took the caller's word, and the batch's daily-only guess recorded SPY 1W on a Monday evening as closed while TradingView's own `barstate.isconfirmed` read 0 |
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
   '<script>-<sym>-<tf>-<yyyy-mm-dd>', startsAtBar0: false})` (`newestBarIsForming` is
   derived; an assertion is used only when the derivation cannot answer) — it throws (writes nothing) on an ambiguous name, a compile error, an
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

## Unattended batch (2026-09-28) — many scripts, no keyboard after one sign-in

`tools/vendor_harness/batch_capture.py` runs steps 1–12 above for every script in a
manifest, in the SESSION-OWNED browser of `tools/pine_vendor_capture.py`. The owner
signs in once, in the window it opens; nothing after that needs a person.

⚠️ **Status: built and proved against a recording double only. It has NOT been run
against live TradingView.** The first live run is the owner's (steps below).

### What it does per script

gate v2.1 → the session is still signed in (the layout answers 200) → the scratch
layout reads **0 studies** (anything else STOPS the batch) → symbol and timeframe set
and READ BACK (J2) → Pine editor open → **Create new ▸ Indicator** by a real pointer
(script-title control → hover *Create new* → *Indicator*), verified by a fresh Monaco
model appearing → the corrected **binding gate** (own-text `Add to chart` exactly once,
`Update on chart` never) → the source written through the Monaco handle, **gate
re-checked inside the same evaluation**, sha256 of the buffer compared to the committed
file → gate v2.1 again → **Add to chart** (gate re-checked inside the click's own
evaluation; a refusing gate never clicks) → wait for `status()`/`dataLength()` →
`requestMoreData` until the loaded history stops growing → `tv_capture.js` →
`__uctVH.studies()` (census control, exactly one indicator) → `__uctVH.capture(…)` →
every chunk pulled verbatim → `verify_capture.mjs --assemble` (exit code AND `VERDICT:`
line, then the written file re-verified) → **cleanup, always**: remove the study it added
(and only that — a study that was on the rig before is never touched), put symbol /
resolution / pane stretch back, `__uctVH.cleanup()`, assert no `__uct*` globals. After
the last script the chart is put back on the symbol and resolution it started on.

`startsAtBar0` is asserted ONLY when the history stopped growing AND the first loaded
bar is the symbol's listing day in its own timezone (known for `NYSE:RDDT` =
2024-03-21; pass `--listing-date` for another young listing). `newestBarIsForming`
defaults to `auto` (a weekday inside 09:30–16:00 ET says forming) — that guess only knows
daily bars, so `tv_capture.js` now derives the value from the chart and overrides it (a
disagreement is a warning); the batch record keeps the guess as `asserted`.

### What each outcome means (`results/<slug>.json`, `ledger.jsonl`)

| outcome | meaning | on resume |
|---|---|---|
| **CAPTURED** | a capture file verified by `verify_capture.mjs`, written and re-verified | skipped while the file still verifies and carries the same source sha |
| **REFUSED_BY_TV** | TradingView would not run the script; its own message is recorded (e.g. a compile error) | skipped (terminal) |
| **GATE_FAILED** | a gate this tool owes refused — visibility, scratch layout not empty, binding, buffer receipt, census. Nothing past the gate was clicked | retried |
| **INCONCLUSIVE** | could not measure — a timeout, an unreadable model, a UI step not found, the transport refused. Never a pass, never a fail | retried |
| **INCOMPLETE** | the process stopped mid-script. Written BEFORE the first step, so a crash can only ever leave this, never a stale pass | retried; the study it recorded adding is removed first (by recorded id only) |

Exit codes of `run`: `0` every script reached a terminal result · `1` a measured rig
problem (the scratch layout was not empty, cleanup left the chart dirty — the batch
stops) · `2` INCONCLUSIVE (no sign-in, the browser went away).

### Owner steps — the first live run

Run these from the repo root, **after the close**, on a machine that will stay awake.

1. **Prove the tool on this machine** (no network, no TradingView):
   `python tools/vendor_harness/batch_capture.py --self-check` → expect `VERDICT: PASS`.
2. **Recon — sign in once, click nothing:**
   `python tools/vendor_harness/batch_capture.py recon`
   A browser window opens on the rig layout (`01f1AcIj`). **If the console says SIGN IN,
   sign in to TradingView in THAT window** — use the **Email** option, not *Continue with
   Google* (Google refuses the bundled browser; see `pine_vendor_capture.py`). The tool
   notices the sign-in by itself; you do not press anything in the console. It never
   reads, stores or logs what you type. It then prints its readings and exits
   `recon OK`. The profile is the same one `pine_vendor_capture.py` uses
   (`%LOCALAPPDATA%\uct-capture-profile\tradingview`), so the sign-in lasts across runs.
   - If `title` reads `ok: false`, the script-title control was not found: rerun with
     `--title-selector "<css>"` (for `recon` and `run`).
   - If recon says the rig carries studies, remove them by hand first; the tool will not.
3. **One script, watched:**
   `python tools/vendor_harness/batch_capture.py run --limit 1`
   It prints its run directory (default `%LOCALAPPDATA%\uct-vendor-batch\runs\<id>`).
   Leave the window alone while it works. Read `results/<slug>.json`: `CAPTURED` with
   `cleanup.ok: true` means the whole route works live.
4. **The rest, unattended:**
   `python tools/vendor_harness/batch_capture.py run --run-dir <that directory>`
   It resumes: the first script is skipped (its capture re-verifies), everything else
   runs, 30 s apart by default (`--throttle-s`; it is your own account — do not lower it
   much). Do not use the window or open a second run on the same profile. If anything
   stops it (the machine sleeps, the window is closed), run the same command again.
5. **Grade:**
   `python tools/vendor_harness/batch_capture.py grade --run-dir <that directory>`
   → `verdicts.json` + `summary.md` in the run directory (the corpus harness above,
   unchanged, over the run's `captures/`; `summary.md` gains a "Batch outcomes" table).
6. **Keep what you accept:** copy the capture files from `<run>/captures/` into
   `tests/fixtures/vendor/harness/` and commit them with their verdicts. They then drop
   out of the next manifest by source sha.

### The manifest — derived, never typed

`python tools/vendor_harness/batch_manifest.py` (add `--check` to compare without
writing) runs `memberDoorCensus.measure.test.js`, which puts every
`corpus/committed/*.pine` through `enterMemberDoor` — the same builder + install door
`ourSide.js` grades with — under both states of `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`,
selects the state production runs (read from `docs/frontend_feature_flags.json`), and
subtracts every source sha already captured under `tests/fixtures/vendor/harness/`.
Measured 2026-09-28: **266 corpus → 55 attach (flag on; 33 with it off) → 6 already
captured → 49 targets.** `grade` runs the harness with the flag state the manifest was
selected on (recorded in the run's `manifest.json`), so a script the census counted is
never refused by the grader for a flag reason.

⚠️ Six of the twelve corpus scripts already captured on RDDT (e.g. `adx-and-di-for-v4`,
`fvg-trend`, `trendlines`) do NOT attach at today's member door, so their captures grade
INCONCLUSIVE on our side. The manifest does not target scripts like those.

### What is and is not proven

- **Proven against the recording double** (`batch_double.py`, `--self-check`,
  `tests/test_vendor_batch_capture.py`): the step order; each outcome class; INCOMPLETE on
  a process death with the claim on disk before step one; resume (skip a re-verifying
  capture, retake one that no longer verifies, retry the rest); orphan removal by recorded
  id only, and an unrecorded study stopping the batch untouched; the binding gate never
  writing or clicking, in Python and inside the click's evaluation; cleanup after every
  outcome; the throttle between scripts only; no text entry anywhere in the driver; the
  profile refused inside a worktree or the owner's own browser profile. The double's
  captures are assembled by the REAL `verify_capture.mjs` and graded by the REAL corpus
  harness (its `plot(close)` script MATCHes, the others DIVERGE).
- **Not proven until the first live run:** that TradingView's current page has the
  script-title menu, the Pine editor launcher, `TradingViewApi.activeChart()`,
  `getStudyById().status()/dataLength()`, `removeEntity()` and
  `mainSeries().requestMoreData()` where the snippets look. Each step verifies its
  EFFECT, so a miss reads INCONCLUSIVE or GATE_FAILED — never a wrong click. `recon`
  prints every reading first.
- ⚠️ Every `Create new ▸ Indicator` leaves an unsaved buffer in the editor; nothing is
  ever saved. Whether TradingView accumulates editor tabs across a long batch is
  unmeasured.
