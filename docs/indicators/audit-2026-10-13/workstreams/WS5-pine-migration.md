# WS5: TradingView Pine Script migration audit

**Audit date:** 2026-10-13 · **Code:** `audit/indicators-competitive-2026-10-13` = `origin/master` = production `84164aee3d`
**Method:** I ran the real import doors (`PineBox.jsx::inspectSource` for the paste box, and `memberPaneDefinition` for "Add this script to my chart") on synthetic bars. I checked the results against independent reference maths. I also re-ran the vendor harness over every committed TradingView capture, a census of the 266 licence-committed community scripts, and a 185-construct probe. I made no runtime changes. Scratch harnesses are in `app/src/__audit_scratch__/ws5/` (not committed). Evidence JSON is in `docs/indicators/audit-2026-10-13/migration-corpus/results/`, with market values redacted.

---

## 0. Headline

- **The maths that translates is right.** Every plot that reached a chart in my corpus matched an independent implementation, 26 plots in 13 scripts at max rel ≤ 1e-15. The one exception is `ta.linreg`'s algebraic expansion at 3.5e-11. No conversion added lookahead: a truncation test on every corpus plot gave 0 changed bars. `lookahead_on` reproduces TradingView's own historical future leak on purpose, and nothing more.
- **Reach is the problem, not accuracy.** With production flags, the chart door attaches **85 of 266 (32%)** real committed community scripts. In the vendor harness, **39 of 228 (17%)** captured TradingView scripts match on every capture, 71 diverge somewhere and 93 are refused.
- **The biggest unlock already exists and is dark.** The per-bar runtime VM computed my Supertrend and ATR trailing stop **exactly** (0 diff on 1,064 and 1,033 bars). Members get a refusal of about 900 characters instead.
- **Reporting is the weakest part.** There are two lanes with two different verdicts. The paste box (lenient "screener" lane) and the chart door (strict "host" lane) disagree in both directions on the same sheet. The chart door also drops disclosures that the host translation already computed.

## P0

**P0-1: the chart door draws `ta.cum` over the *loaded* bars with zero disclosure. The paste box on the same sheet refuses it, for exactly that reason.**
- Paste box, for `plot(ta.cum(volume))`: **"Not supported — `ta.cum` is a running total from the first bar, and `cum` names no anchor — a translator that picked one would be inventing the single number the whole answer turns on, and the value would then change with how many bars …"**
- Chart door (`memberPaneDefinition`, strict lane): `ok: true`, formula `cum(volume)`, `notes: []`, `meta.disclosures: []`, and "Add this script to my chart" is offered. It saves as a normal `ast` definition (`results/ws5-construct-probe.json`, row `ta:ta.cum(volume)`).
- This is deliberate in code but never shown to members. See `app/src/components/chart/engine/ast/pine.js:12678-12686` ("`ta.cum(1)` IS LEFT THE HOST'S `cum` ON PURPOSE … a pre-existing host rule (`cum` sums the loaded bars)"). The rail skips it: `vendorHarness.c29BarCounters.test.js:59-61` ("not asserted here").
- Measured impact against the repo's own TradingView captures: `vw-bar-counters-spy-1-2026-10-02` and `vw-bar-counters-spy-30-2026-10-02`, row `C05_ta_cum_1`. The value is wrong on **9,300 / 8,300 of 9,300 / 8,300 bars** (a persistent offset), while the paste box lists that very plot as "not imported" under a "Partial import" headline.
- Reach: `ta.cum` appears in 2.7% of scripts and bare v4 `cum` in 2.1% (`docs/pine/demand-computation.md`). That covers OBV, A/D and cumulative-delta style indicators. Values are exact only when both UCT's history and TradingView's history start at the listing.

No other P0 was found. I specifically checked for introduced lookahead, silently dropped *plots* (as opposed to visuals), and security issues. The library store is read-only, authenticated, and path-validated: `api/routers/pine_libraries.py:23-32`, `api/services/pine_library_store.py:36-38`.

---

## 1. What members actually get in production

I read this from the code defaults and the flag ledger `docs/frontend_feature_flags.json`. I did **not** verify the live environment, because prod access is out of scope.

| gate | where read | prod state (ledger) | effect |
|---|---|---|---|
| `VITE_PINE_MEMBER_PANE_ENABLED` | `engine/memberPaneGate.js:30` | **armed** (2026-09-19) | Shows the live preview and "Add this script to my chart" under the Import tab |
| `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` | `engine/objectsOnlyPaneGate.js:50` | **armed** (2026-09-27) | Scripts that only draw labels, lines, boxes or tables can attach |
| `VITE_PINE_RUNTIME_PANE_ENABLED` | `engine/runtimePaneGate.js:50-55` | **dark** | The per-bar VM lane, which is the "advanced Pine" lane, is never used |
| `PINE_RUNTIME_STAGE` (server, per member) | `api/services/runtime_definitions.py:28,69,140` | default `off` | A second gate: the runtime pane needs build flag **and** per-member permission (`runtimePaneGate.js:61-63`) |
| `PINE_RUNTIME_SAVE_ENABLED` | `runtime_definitions.py:13,65,124` | default off | The store refuses `compute.kind: 'runtime'` documents |
| runtime allowlist | `engine/runtimeKill.js:56-70` | holds **only** `adx-and-di-for-v4` | Even with the lane on, any ungraded script declines (`runtime:not-yet-graded`) |
| `VITE_PINE_LOWER_TF_ENABLED` | `engine/lowerTfGate.js:36` | dark | Any `request.security` below the chart timeframe is refused |

**Conclusion.** "Advanced Pine disabled in production" holds for the per-bar runtime VM, through three independent off switches plus a one-script allowlist. Note that the **host-lane drawing-object program** (labels, lines, boxes, tables, linefills) *is* live in production through the objects-only flag. Members do get drawing objects, but not the imperative VM. In tests, `src/test-setup.js:46-47` permits the runtime pane and allows every script. Only the build flag keeps it off in vitest, so my "runtime lane" results below were produced by stubbing that one flag.

---

## 2. Pipeline

```
 paste (BuilderSheet → Import tab → ImportBox, PineBox.jsx:1545)
   │  debounce 250 ms (PINE_DEBOUNCE_MS, PineBox.jsx:47)
   ▼
 inspectSource(src,'auto')                         PineBox.jsx:239
   ├─ detectDialect (dialect.js) → pine | thinkscript | pcf | formula
   ├─ foreignLanguage (NinjaScript/MQL/EasyLanguage/Python/AFL…) → "Not supported" by name
   └─ Pine ──► memberInputTranslation(translatePine, {paramManifest:true})   PineBox.jsx:322
                 ▲ NO strict flag  ⇒  LENIENT "screener" lane   (pine.js:22544 isHostLane)
                 │   lexPine → blockStatements → Resolver fold → UCT AST per output
                 │   (+ object program via buildObjectProgram, + presentation)
                 ▼
             report {outputs[formula, ast, presentation], ignored notes, objects, inputParams}
                 │
                 ├─► importOutcome(report)  importOutcome.js:150  → Exact | Imported, with disclosed
                 │      differences | Partial import | Not supported | Import failed
                 ├─► UI: outcome line, notes, outputs (radio), inputs, "Use this formula"
                 │        └─► FormulaField (single formula / multi-plot rows) → Save → store
                 │             compute.kind:'ast', Pine text NOT stored (only importedFrom fingerprint)
                 │
                 └─ (same sheet, independently, keyed on the pasted text) ────────────────┐
                                                                                         ▼
 MemberPane (MemberPane.jsx:140) → memberPaneDefinition(source)  memberPaneDefinition.js:133
   → memberInputTranslation(translatePine, {strict:true, colourInputs, guardInputs, …})  STRICT "host" lane
   → paneGate (paneGate.js:84) ── refused ──► [runtime lane DARK] runtimeLaneDefinition (:1017)
   │                                            → pineRuntimeFrontend → runtime/lower → vm.js
   │                                              (allowlist, repaint, budgets, warm-up probe)
   ▼ ok
 rows/paints/fills/objects → buildDefinition → install → mini ChartPane preview
   → repaint ack if meta.repaint === 'preview-repaints' → "Add this script to my chart"
   → attachPineAs (BuilderSheet.jsx:2205) → validateUserDefinitions → saveUserDefinition (compute.kind:'ast')
   → bind on chart: interpret(ast) + objectReaderFor/evaluateObjects (objects) + otherSymbols/tf binding
```

**Which lane a script takes:** every Pine paste goes through **both** lanes on one screen. The lenient lane drives the verdict text and the "Use this formula" (Formula-tab) save. The strict lane drives the chart preview and "Add this script to my chart". When the strict host lane refuses, the per-bar runtime lane would be asked (`paneGate.js:196-228`, `runtimeFallbackOf`), but only behind the dark flag.

---

## 3. Construct matrix (5 stages)

**Stages:**
- **P = PARSES:** no lexer or statement refusal.
- **T = TRANSLATES:** the strict host lane builds a document.
- **E = EXECUTES:** `interpret` gives finite values that match the reference where one was checked.
- **R = RENDERS:** what the saved definition carries.
- **S = SAVES+RELOADS:** `validateUserDefinitions` passes on a JSON round trip, client side. The server `save()` was not exercised (no backend).

**Codes:** Y yes · P partial · N no · **D** = refused in production but runs in the dark runtime lane. "box" is the paste-box verdict when it differs from the chart door. Source: `results/ws5-construct-probe.json` (185 probes).

| construct | P | T | E | R | S | notes |
|---|---|---|---|---|---|---|
| `//@version=3/4/5/6`, none | Y | Y | Y | Y | Y | Version-specific colour palettes are honoured (v4/v5 constants verified in MACD palette) |
| `indicator(overlay)` | Y | Y | Y | Y | Y | `placement: price` |
| `precision=`, `format=` | Y | Y | Y | N | Y | Disclosed as drawing-only |
| `max_bars_back` | Y | Y | Y | n/a | Y | |
| `indicator(timeframe=)` | Y | N | **D** | – | – | `pine:request` |
| `input.int` (length) | Y | Y | Y | Y | Y | Becomes `paramManifest` (editable after save via ParamControls) |
| `input.float` / `input.bool` (non-window) | Y | Y | Y | Y | Y | Member inputs |
| `input.source` | Y | P | Y | – | Y | Folded to default; box shows "Fixed at their defaults: Source = close". Not editable |
| `input.string(options)` | Y | P | Y | – | Y | Folded to the default branch; not editable. Box files it as "drawing only" |
| `input.color` | Y | Y | Y | Y | Y | Becomes a colour input on the pane; box says "carries a default the engine grammar cannot hold" (contradiction) |
| `input.timeframe` / `input.symbol` | Y | P | Y | – | Y | Folded; not editable |
| `input.session` | Y | Y | Y | – | Y | box: Not supported; host: ok |
| `input.enum` (v6) | Y | N | N | – | – | Refused in both lanes |
| `var` that forgets its seed | Y | Y | Y | Y | Y | `accum(seed, …, 250)`; accepted only when residual is negligible (α=0.1 accepted, maxRel 2e-13; α=0.02/0.005 refused) |
| `var` true state (Supertrend, trailing stop) | Y | N | **D** | – | – | `pine:state`; runtime exact |
| `var c=0; c+=1` (counter) | Y | P | P | Y | Y | Attaches; withheld (all `na`) unless history starts at listing; no pane note |
| `varip` | Y | N | N | – | – | Runtime declines (`runtime:varip`) |
| `if/else` assign, `if` expression, ternary | Y | Y | Y | Y | Y | |
| `switch` | Y | N | **D** | – | – | `pine:block` |
| `for` (accumulating) / `while` | Y | N | **D** | – | – | `pine:reassign` |
| `for … in` | Y | N | N | – | – | Runtime has no for-in |
| user function (inline / block) | Y | Y | Y | Y | Y | |
| function returning tuple | Y | N | **D** | – | – | |
| `method` | Y | N | N | – | – | `pine:builtin` "close.twice" |
| arrays | Y | N | **D** | – | – | Host only as "plan-time vectors" inside object programs |
| `map` / `matrix` | Y | N | N | – | – | |
| `type` (UDT) | Y | N | **D** | – | – | |
| `import Lib/x/N` | Y | P | P | – | – | Works only if the server library store (data dir, not git) holds the exact version; refused otherwise (`pine:module`, 33/266 corpus) |
| `na()`, `nz()` | Y | Y | Y | Y | Y | |
| `fixnan` | Y | N | **D** | – | – | `pine:na` |
| `x[k]` literal / variable / input | Y | Y | Y | Y | Y | |
| `x[series]` | Y | Y | Y | Y | Y | `barsAgo(…, mod(barindex,3), 3)`; box: Not supported |
| `math.*` (abs/max/min/round/pow/sqrt/log/sign/avg/sum) | Y | Y | Y | Y | Y | |
| `math.round_to_mintick`, `syminfo.mintick` | Y | Y | P | Y | Y | Settled per witnessed exchange tick; withheld otherwise |
| `math.random` | Y | N | N | – | – | |
| `str.*` as a value | Y | N | N | – | – | Text only inside object labels and cells |
| `request.security` other symbol, same TF | Y | Y | Y | Y | Y | Exchange-confirmed roster only (`otherSymbols.js:12-21`); others refused by name at bind |
| `request.security` HTF, `lookahead_off` | Y | Y | Y | Y | Y | Last **closed** HTF bar; **disclosed** ("…one bar later than TradingView on the last bar of every week…") |
| `request.security` HTF, `lookahead_on` | Y | Y | Y | Y | Y | `tf_live`: reproduces TradingView's historical future leak (verified); pane flags `preview-repaints`, box says **Exact import** |
| `lookahead_on` + `[1]` | Y | Y | Y | Y | Y | Exact vs prev-week model; falsely flagged `preview-repaints` |
| `gaps_on`, lower TF, `security_lower_tf` | Y | N | N | – | – | Lower TF is behind a dark flag |
| `request.financial/earnings/dividends/economic` | Y | N | N | – | – | |
| `timeframe.isintraday/isdaily…` | Y | Y | Y | Y | Y | HTF formulas carry an `86400 != periodseconds ? na :` guard, so they only draw on daily charts |
| `timeframe.multiplier`, `.in_seconds()` alone | Y | N | – | – | – | Constant column, refused |
| `dayofweek`, `hour`, `time(tf, session)` | Y | Y | Y | Y | Y | `time(…)`: box says Not supported, host says ok |
| `timestamp()` | Y | N | N | – | – | |
| `barstate.isconfirmed/islast/isfirst/isrealtime` | Y | Y | Y | Y | Y | Context-dependent folds |
| `barstate.isnew` | Y | N | N | – | – | |
| `plot(color = series)` | Y | Y | Y | Y | Y | Palette/condition column (MACD 4-colour histogram carried) |
| `plot(linewidth=)` | Y | Y | Y | **N** | Y | Translator records `pres.width` (`pine.js:27569-27570`); chart door never copies it (`memberPaneDefinition.js:351-390`). All widths become 1. Silent ("Exact import") |
| `plot.style_histogram/columns/circles/stepline/area` | Y | Y | Y | Y | Y | |
| `plot.style_cross` | Y | Y | Y | P | Y | Drawn as a line; disclosed |
| `trackprice`, `show_last` | Y | Y | Y | N | Y | Disclosed |
| `offset=+n` / `-n` | Y | Y | Y | Y | Y | Offset node / displacement |
| `display.none` | Y | Y | Y | Y | Y | Hidden anchor |
| `display.data_window` | Y | Y | Y | **P** | Y | Drawn as a visible line; silent |
| `transp=` (v4) | Y | Y | Y | Y | Y | Opacity |
| `plotshape` | Y | Y | Y | Y | Y | Markers with glyph |
| `plotchar` | Y | Y | Y | P | Y | Glyph becomes a circle marker; silent |
| `plotarrow` | Y | Y | Y | **N** | Y | Drawn as a **line** of the series; silent ("Exact import") |
| `plotcandle` / `plotbar` (only output) | Y | N | – | – | – | "this script declares nothing a chart can draw" |
| `hline` (unnamed) | Y | Y | – | **P** | Y | Carried by "Use this formula" (BuilderSheet levels row); **never drawn by the chart door** (no `levels` anywhere in `memberPaneDefinition.js`) while the box says "this door carries it as a level line for a chart" |
| `h = hline(…)` + `fill(h1,h2)` | Y | Y | – | N | Y | Dropped in both; disclosed in box only |
| `fill(plot, plot)`, gradient fill | Y | Y | Y | Y | Y | |
| `bgcolor` / `barcolor` | Y | Y | Y | Y | Y | Pane carries them (`paints`); box says "this door does not carry it" (contradiction); bgcolor-only non-overlay refused |
| `line/label/box/table/linefill.new`, `*.delete` pools | Y | Y | Y | Y | Y | Objects-only flag on; pool capacity modelled (`objectPool.js`); table cells exact |
| `label` text via `format.mintick` | Y | Y | P | P | Y | Text is **silently blank** when the exchange tick is not witnessed (`objectRuntime.js:846-850`; counter `textsWithheld` never surfaced) |
| `polyline.new` | Y | N | N | – | – | |
| `color.new/rgb/from_gradient` | Y | Y | Y | Y | Y | |
| `color.r/g/b` as value | Y | N | – | – | – | |
| `alertcondition` | Y | Y | Y | n/a | Y | Disclosed: "available under Alerts; it is not drawn on the chart" |
| `alert()` | Y | Y | – | N | Y | Disclosed: "this door delivers no script's `alert()`" |
| `strategy()` | Y | **Y** | Y | P | Y | Box: **Not supported**. Pane: plots attach, orders dropped, **no pane disclosure** |
| `strategy.*` values in an indicator | Y | N | N | – | – | |
| `runtime.error` | Y | Y | Y | n/a | Y | Guard inputs |
| `syminfo.type` | Y | N | N | – | – | |

### `ta.*` coverage (strict host lane, prod): 45 of 68 probed calls attach

- **Supported:** sma, ema, wma, rma, hma, vwma (expanded), linreg (expanded), stdev, dev, rsi, cci(**hlc3 only**), mfi, mom, roc, stoch, wpr, atr, tr, tr(true), bbw, kcw, highest, lowest, highestbars, lowestbars, pivothigh, pivotlow (verified no lookahead, 1,500/1,500 bars), crossover, crossunder, cross, change, rising, falling, valuewhen, vwap, vwap(hlc3), correlation, percentrank, percentile_linear_interpolation, median, macd, bb, kc, dmi(adx), and cum (P0-1).
- **Missing:** alma, swma, variance, cmo, tsi, obv, accdist, percentile_nearest_rank, mode, range, sar, iii, nvi, pvi, pvt, wad, wvad, cog, supertrend.
- **Signature-gated:** `cci(close,…)` gives `pine:role-order`; `ta.max/min(x)` gives `pine:arity`.
- **Runtime-only (dark):** `barssince` (unbounded).

The repo's own vendor tests pin several of these to TradingView captures, for example `atrPine.vendor.test.js` and `mfiPine.vendor.test.js`.

---

## 4. Migration corpus results

Scripts are in `migration-corpus/pine/`, written for this audit. `16-missing-function` deliberately calls `ta.kama`, which is **not** a real Pine built-in, as an unknown-name probe. Real missing built-ins are listed in §3. The harness used 1,500 synthetic daily bars. Numeric comparisons run from bar 300 against independent JS in `__audit_scratch__/ws5/refs.js`.

"Box" = paste-box outcome label (`importOutcome.js:56-62`). "Pane" = chart door.

| # | script | box outcome → user-facing message | pane | plots ok/total | max rel diff | visuals kept / lost | inputs | save / edit | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 01 | EMA ribbon | **Exact import** | attach | 3/3 | 0 | colours kept; **linewidth 1/2/3 → all 1 (silent)** | 3 lengths editable (paramManifest); source fixed | ast formula; Pine not stored | Works; silent width loss |
| 02 | RSI + OB/OS + fill | **Imported, with disclosed differences** — "differences in how it is drawn only; the values are the same" | attach | 1/1 | 9.6e-16 | **70/30 levels and band fill dropped** (named hlines); precision dropped; disclosed in box only | length editable; ob/os not exposed | ast | Value right, picture incomplete |
| 03 | MACD coloured hist | Disclosed — "a colour cannot be a value in a screened column — `color.lime`" | attach | 3/3 | 0 | 4-colour palette **kept** on pane (box text implies otherwise); columns kept; **hline(0) dropped on pane** | 3 lengths editable | ast | Good; misleading note |
| 04 | Bollinger + fill | Disclosed (fill "carried as that band") | attach | 3/3 | 0 | fill kept | mult = member input; length = param | ast | Works |
| 05 | Supertrend (`var`) | **Not supported** — `pine:state`, a ~900-char message citing `closedTable.json::_no_offset_reopened_by`, "static decidability", and suggesting `lowest(<that value>, <bars>)` | refuse | 0/1 | – (dark runtime: **0** on 1,064 bars; 136 warm-up bars withheld) | – | – | – | **Blocked in prod**; runtime exact |
| 06 | Inside day barcolor+plotshape+alert | Disclosed — "`barcolor` … this door does not carry it" | attach | 1/1 | 0 | barcolor **kept** on pane (contradicts box); markers kept; alert → Alerts | – | ast | Works |
| 07 | RS vs SPY (`request.security`) | Disclosed — "`input.symbol`" filed as drawing-only | attach | 2/2 | 0 | kept | benchmark fixed (roster only); MA length param | ast | Works |
| 08 | MTF EMA (`lookahead_on`+`[1]`) | Disclosed (`input.timeframe` folded) | attach | 1/1 | 0 (prev-completed-week model) | kept; **false repaint ack required** | TF fixed "W"; formula only draws on daily charts | ast | Works; repaint false positive |
| 09 | Volume-spike bgcolor | **Not supported** — "the pasted script offers no plot and no alert condition to filter on" | **attach** | n/a | paint condition 1,200/1,200 correct; 80 transp → opacity 0.2 | bgcolor kept | len/mult not exposed | ast | Works on chart; box says the opposite |
| 10 | ATR trailing stop (`var` + if/else) | **Not supported** (`pine:state`, same long message) | refuse | 0/1 | – (dark runtime: **0** on 1,033 bars) | – | – | – | Blocked in prod; runtime exact |
| 11 | Pivots with labels/lines | **Exact import** (box mentions no objects) | attach | 1/1 | 0 | 179 labels + 84 lines created, pool kept 101/84; label text **correct with witnessed tick, silently blank otherwise** | left/right not editable | ast + object program | Works for US listings |
| 12 | Input-heavy MA | Disclosed (`input.string`, `input.color`) | attach | 3/3 | 0 | colour input kept on pane | `maType` fixed to EMA, `src` fixed; `len` param; `showBand`/`bandPct` member inputs | ast | Works at defaults only |
| 13 | Table dashboard | **Not supported** — "this script draws objects — a table, labels or boxes — and offers no plot or alert condition, so there is nothing to filter a scan on" | **attach** | n/a | 6/6 cells: RSI/ATR/Chg text and colours equal the reference | table kept | – | ast + objects | Works on chart; box says the opposite |
| 14 | Strategy | **Not supported** — "a strategy places orders to be backtested, and a screen filters symbols" | **attach** | 2/2 | 0 | plots kept; **orders/backtest dropped with no pane note** | – | ast (as an indicator) | Contradictory, under-disclosed |
| 15 | v4 legacy (`study`, `input(type=)`) | Disclosed (hline) | attach | 2/2 | 0 | **hline(0) dropped on pane** | lengths **not** params | ast | Works |
| 16 | unknown fn + `ta.linreg` | **Partial import** — "not imported: the output on line 10", and the refusal lists ~80 engine function names | **refuse whole script** (`pine:function`) | 1/2 via "Use this formula" | 3.5e-11 (linreg slope) | – | – | Formula tab only | Box promises partial; chart refuses |

**Totals.** Box: Exact 2, Disclosed 8, Partial 1, Not supported 5. Chart door attaches 13 of 16 and refuses 05, 10 and 16. **4 of the 5 "Not supported" scripts that are not refused for state (09, 13, 14) attach on the chart anyway.** Every attached plot is numerically exact. All the losses are presentation or reporting.

---

## 5. Silent-loss and honesty findings (with evidence)

1. **`ta.cum` drawn with no disclosure.** See P0-1.
2. **Two lanes, two verdicts.**
   - `PineBox.jsx:322` calls the translator *without* `strict` (lenient lane). `memberPaneDefinition.js:153-172` calls it *with* `strict: true`.
   - In the committed corpus, **37 of the 85 scripts the chart door attaches are labelled "Not supported"** in the box. That includes 24 with no visible plot (objects or paints only) and 8 strategies. Only 5 of 266 scripts read "Exact import". Source: `results/ws5-committed-corpus-census.json`.
   - In the vendor harness (prod flags), **89 captures read "Partial import" while the chart door refuses the whole script.** 67 captures read "Not supported" while the chart attaches. Source: `results/ws5-import-vs-vendor-crosstab.json`.
   - In the 185-construct probe, 18 constructs read "Not supported" in the box but attach on the chart. None go the other way.
3. **The chart door drops disclosures the host translation computed.** The pane's `notes` are built only from object loss, alert/fold notes, withheld paints and displacement params (`memberPaneDefinition.js:716-760`). They never include `t.notes`. For the strategy, the host translation carries `pine:strategy-chart`: "a strategy draws its plots, fills and drawings like an indicator; its orders, fills and backtest are not simulated here…". Yet `pane.notes = []` and `meta.disclosures = []`. In the committed corpus, 8 strategies attach and 5 of them carry zero notes.
4. **"The values are the same" is asserted by default.**
   - `importOutcome.js:64-73`: "An unlisted code is PRESENTATION". Only 4 codes are classified at all.
   - So skipped computation (`pine:state`, `pine:function`, `pine:request`, `pine:block`, `pine:reassign`, `pine:collection`, `pine:tuple`, `pine:function-def`, `pine:statement` — observed 2 to 515 times each in the captured scripts) yields the headline **"differences in how it is drawn only; the values are the same"** (`importOutcome.js:248`).
   - Vendor cross-tab: 16 captures with value or `na` divergence carry that headline, and **8 diverging captures read "Exact import"**. Most of those are warm-up or seed-window artifacts, but `trendlines-spy` (393 bars where TradingView draws and UCT draws `na`) is not.
5. **hline never reaches the chart door.** There is no `levels` in `memberPaneDefinition.js` (grep is empty). Corpus 03 and 15 come out with `definition.levels === undefined`. Yet the box says "`hline` draws a horizontal level; this door carries it as a level line for a chart". hline is in 13.8% of scripts (`demand-presentation.md` row 12).
6. **Visual attributes dropped silently under "Exact import":** `linewidth` (the 2nd most-passed `plot` argument), `plotarrow` (drawn as a line), the `plotchar` glyph (becomes a circle), and `display.data_window` (drawn on the chart).
7. **Label text is withheld without telling anyone.** `objectRuntime.js:846-850` returns `null` text for `format.mintick` with no witnessed tick. The `stats.textsWithheld` counter has no reader outside the module (grep). Labels render blank for OTC, crypto, FX and unwitnessed exchanges.
8. **Repaint signalling is inverted at the box.**
   - `lookahead_on` without an offset (a genuine future leak on history) shows "Exact import" in the box.
   - The canonical non-repainting idiom `lookahead_on` + `[1]` gets `meta.repaint: 'preview-repaints'` ("unanalysable: the linter could not bound this tree"), so the pane forces "I understand this indicator may repaint" (`MemberPane.jsx:301-309`).
9. **Machine prose in saved metadata.** `meta.description` for any HTF script reads "(0 divided by 0) when (1 when 86400 does not equal the length of one bar of the chart's timeframe, in seconds -- 60 times the minutes on an intraday chart, …". That is the readback of the `86400 != periodseconds` guard.

What *is* honest:
- The HTF `lookahead_off` disclosure (`htfLookaheadOffStepBacks`) is precise and correct.
- Refusals carry the line, column and a caret (`PineBox.jsx` Refusal).
- Inputs are labelled "Inputs you can change later" vs "Fixed at their defaults".
- Translator exceptions become "Import failed" rather than a dead box (`importOutcome.js` `controlledErrorReport`).

---

## 6. UX walkthrough (paste → analyze → convert → preview → adjust → apply → save)

1. **Open.** Chart Settings → Indicators → builder sheet → tab **"Import"** (`BuilderSheet.jsx:2482`). The heading reads **"Paste a script or a formula"**, with the hint "A TradingView **Pine** indicator, a thinkorswim **thinkScript** study, a **TC2000** formula, or one of this engine's own…" (`PineBox.jsx:1043-1060`). A CodeMirror editor lazy-loads, with a textarea fallback.
2. **Analyze.** Translation starts 250 ms after the last keystroke.
   - Meta line: "Read as Pine script v5 · indicator() · “title”".
   - Outcome line (`data-testid="import-outcome"`): e.g. **"Imported, with disclosed differences — differences in how it is drawn only; the values are the same"**.
3. **Convert (the box).**
   - Semantic notes list.
   - Refusal: "Line N, column M" plus the verbatim engine sentence.
   - "This script offers N columns", with a radio per output and its formula and readback.
   - Vendor notes; "Inputs you can change later: …"; "Settings from the script — set them here, before you save" (number fields with "was N").
   - "Fixed at their defaults: …"; a toggle **"Show N lines a screen does not read"**.
   - A screening helper: "This column is a number, so it can be charted as it is. To SCREEN with it, say what you are looking for:".
   - Button **"Use this formula"**.
4. **Preview (the chart door, same sheet, independent lane).**
   - A mini chart of the whole document, plus disclosures.
   - Or a bare refusal sentence (`data-testid="pine-member-pane-refusal"`). The `pine:state` refusal is about 900 characters, much of it internal. The `pine:function` refusal enumerates about 80 internal function names.
5. **Adjust.** Before saving, only window lengths can be changed (paste-time fields). After saving, `paramManifest` lengths and member inputs are editable. String, source, timeframe and symbol inputs are frozen.
6. **Apply.** If repaint is detected: "This script can repaint recent signals." plus the checkbox "I understand this indicator may repaint". Then **"Add this script to my chart"** → "Saved, and added to this chart." (`MemberPane.jsx:83,258-330`). "Use this formula" instead moves to the Formula tab with the translated formula (one tree, plus other rows).
7. **Save / reload.**
   - Saved as `compute.kind: 'ast'` with formula `source` and `sources`. **The Pine text is not stored.** `meta.importedFrom` holds only a length and an FNV fingerprint (`BuilderSheet.jsx:451-466`).
   - Editing later means editing the translated formula, or re-pasting. Displacement params tell the member: "Change it in the script and paste it again" (`memberPaneDefinition.js:749-758`).
   - Runtime documents (dark) would store the Pine source.

**UX problems:**
- The member reads two verdicts that can disagree, one above the other.
- The notes speak a screener's language ("a screen reads plot() and alertcondition() and nothing else") to someone migrating a chart indicator.
- There is no single "what will be different on my chart" summary at the door that actually draws.

---

## 7. Parity programme: what it measures, and coverage

- **Instrument.** `tools/vendor_harness/compare.mjs`: MATCH, DIVERGE or INCONCLUSIVE per plot. `na`-ness and colour must match exactly; floats use rel 1e-9, with an abs floor of 1e-6 of the tick (`compare.mjs:21-60`). "Our side" is the real chart door (`__tests__/vendorHarness/ourSide.js:784`). It reports and does not gate.
- **Captures on disk.** **336** `uct.vendor-capture/v1` files under `tests/fixtures/vendor/harness/`, covering **228 scripts**. They are almost all **1D**: 143 SPY, 124 RDDT, a few others. There are also 65 further entries (legacy captures, observations, runtime/visual dirs) under `tests/fixtures/vendor/`, plus the `__truth__` suites (`engine/__truth__/p0.*.truth.test.js`, which I ran: `p0.imp`).
- **My re-run with production flags** (`results/ws5-vendor-harness-prodflags-verdicts.json`, market values redacted):
  - Captures: **MATCH 92 · DIVERGE 98 · INCONCLUSIVE 146**.
  - Plots: **859 MATCH / 149 DIVERGE / 234 INCONCLUSIVE**.
  - Per script: 39 match on every capture, 71 diverge somewhere, 93 refused, 25 other.
  - DIVERGE plot classes: 62 converging-prefix (seed window, i.e. history depth), 60 `na`-ness, 17 scattered or persistent value, 10 colour.
  - Refusal guards: `pine:function` 19, `pine:input-kind` 18, `pine:state` 16, `pine:builtin` 15, `pine:request` 10, `pine:block` 8, `pine:collection` 7, `pine:module` 5, and others.
  - With the objects-only flag **off** (the vitest default), 32 more captures refuse with "declares nothing a chart can draw".
- **Staleness.** The committed `docs/pine/vendor-harness/summary.md` reports **17 captures** (8 MATCH). It does not reflect the 336 on disk. `live-2026-09-28/summary.md` shows 47 captures (5 MATCH).
- **Coverage gaps.** There are no intraday captures beyond the bar-counter and clock probes. No weekly-chart parity exists except the GC probes. Object coordinates are not compared ("coordinates are NOT compared by v1"). The capture selection is the programme's own target list, not a random sample.

---

## 8. Prioritized compatibility roadmap (by real-world unlock)

The shares are from `docs/pine/demand-computation.md` and `demand-presentation.md` (4,898 open-source scripts).

1. **The per-bar runtime lane for state, loops, switch, arrays and UDT.** These constructs appear in `var` 58.9%, `for` 36.6%, arrays ≈32%, `switch` 19.9%, UDT 10.6%. The VM exists and was exact on my state scripts. In the 266-script census it already builds 16 more documents. Its remaining walls are libraries (33), `call-undeclared-builtin-state` (11), `runtime:statement` (10), dynamic history offsets (7+8) and collections. *This is an owner-gated rollout, not a build.* It needs graded scripts on the allowlist, a save door (`PINE_RUNTIME_SAVE_ENABLED`) and a staged audience (`PINE_RUNTIME_STAGE=admins`).
2. **One verdict per paste.** Compute the box verdict from the strict lane the chart uses, and surface `t.notes` in pane notes and `meta.disclosures`. This is cheap and fixes most of the trust damage.
3. **Chart-door presentation parity for the most common arguments:** `hline` (13.8%) and `fill(hline,hline)` (the RSI idiom), `linewidth` (top `plot` argument), `plotarrow`, the `plotchar` glyph, `display.data_window`, `show_last`, `trackprice`.
4. **Editable non-numeric inputs:** `input.string` with options (38.6%), `input.source` (8.8%), `input.timeframe` (10.8%), `input.symbol`. Today these freeze at defaults.
5. **Text formatting** without a witnessed tick (`str.tostring` 30.7%, `label.new` 34%), or at least a visible "N labels' text withheld" disclosure.
6. **`request.security` breadth:** `gaps_on`, an input-driven or computed symbol beyond the exchange-confirmed roster, lower TF (2.6% `security_lower_tf`, plus the dark flag), and `request.financial/earnings/dividends`.
7. **Missing `ta.*`:** unbounded `barssince` (4.0%), an honest `cum` (2.7% + 2.1% bare), `supertrend` (1.3%), `alma` (1.0%), obv, sar, accdist, pvt, cmo, tsi, variance, mode, range.
8. **Library imports** (7% of scripts): populate the store and verify its contents in production. `methods` (4.7%), `polyline`, `varip` (1.1%), `map`/`matrix` (under 1%).

---

## 9. Gaps

| ID | Pri | Description | Evidence | Current vs expected | User impact | Complexity | Dependencies | Regression risk |
|---|---|---|---|---|---|---|---|---|
| G1 | **P0** | Chart door draws `ta.cum` over loaded bars, undisclosed | `pine.js:12678-12686`; `c29BarCounters.test.js:59-61`; probe row `ta:ta.cum(volume)`; captures `vw-bar-counters-spy-{1,30}` | Draws a history-dependent total; the box says it refuses. Expected: withheld behind the listing like the other counters, or a disclosure plus box agreement | Wrong OBV/AD/delta-style values on intraday (and on deep-history daily) charts, silently | S (a disclosure) to M (curtain plus re-measure `atr-trailing-stoploss`) | — | M: one corpus script blanks off-listing |
| G2 | P1 | Box verdict comes from the lenient lane; the chart uses the strict lane | `PineBox.jsx:322` vs `memberPaneDefinition.js:153-172`; census 37/85; crosstab 89 + 67 | Expected: one verdict from the lane that draws | Members abandon working scripts, or trust partials the chart refuses | M | Owner ruling on the screen vs chart contract | M: many rails pin box wording |
| G3 | P1 | Pane drops host-computed notes (`t.notes`): strategy orders, etc. | `memberPaneDefinition.js:716-760`; strategy probe `hostNotes` vs `paneNotes: []` | Expected: semantic notes in pane notes and `meta.disclosures` | Saved strategies become indicators with no trace | S | — | L |
| G4 | P1 | Unlisted note codes default to PRESENTATION, so "the values are the same" | `importOutcome.js:64-73,248`; mcclellan / atr-trailing-stop captures | Expected: computation-class codes are semantic, or a neutral headline | False reassurance | S | G2 | L–M (truth rails) |
| G5 | P1 | `hline` never drawn by the chart door; box claims it is carried | `memberPaneDefinition.js` (no `levels`); corpus 03/15 | Expected: levels row as in `BuilderSheet.jsx:642` | Missing 0/70/30 guides on the most common oscillators | S–M | — | L |
| G6 | P1 | Refusal text is internal and very long (~900 chars `pine:state`; ~80 function names in `pine:function`; wrong `lowest()` advice for Supertrend) | Corpus 05/10/16 messages; `pine.js` REFUSALS 245-470 | Expected: one plain sentence plus a "details" disclosure | Confusing first impression on the top-tier flow | S | Copy ruling | L (rails match text) |
| G7 | P1 (owner) | Runtime VM dark; only 1 graded script; save off | §1 table; corpus 05/10 runtime exact | Owner said keep disabled. This is the largest unlock (§8.1) | 52% of popular scripts carry `var`/loops | L (rollout/grading) | Owner, grading captures | M |
| G8 | P2 | `linewidth` not carried on the chart door | `pine.js:27569`; `memberPaneDefinition.js:351-390`; corpus 01 | Expected: `width` from `pres.width` | Ribbons and bands look wrong | XS | — | L |
| G9 | P2 | `plotarrow` drawn as a line; `plotchar` glyph lost; `display.data_window` drawn | Probes `plotarrow`, `plotchar`, `plot_display_dw` | Expected: arrows, glyph, hidden-from-chart | Visual mismatch under "Exact import" | M | Marker primitive | L |
| G10 | P2 | Label text silently blank without a witnessed tick | `objectRuntime.js:846-850`; `textsWithheld` unread | Expected: disclosure, or best-effort tick | Blank labels on OTC/crypto/FX | S | `symbolScope.json` | L |
| G11 | P2 | Pine source not saved with `ast` imports | `BuilderSheet.jsx:451-466`; corpus definition keys | Expected: keep the source for re-edit and re-translation after engine upgrades | No "edit my Pine" round trip | M | Storage size, licence of member text | L |
| G12 | P2 | String/source/timeframe/symbol inputs frozen at defaults; filed as drawing-only | Corpus 07/08/12 | Expected: choice inputs | Scripts "work" at defaults only | M–L | Option-carrying input schema | M |
| G13 | P2 | Repaint false positive on `lookahead_on`+`[1]`; box says "Exact" for a real future leak | `mtf2` probe; `MemberPane.jsx:224,301-309` | Expected: the inverse | Wrong warnings both ways | M | Repaint linter | M |
| G14 | P2 | `meta.description` is a machine readback of the 86400 guard | `mtf2` probe meta | Expected: script title or a human summary | Unreadable indicator descriptions | S | — | L |
| G15 | P2 | Committed parity summary is stale (17 vs 336 captures); only 1D/2 symbols; no object coordinates | `docs/pine/vendor-harness/summary.md`; §7 | Expected: regenerated summary; intraday/weekly captures | Owner cannot see real parity | S (regen) / L (captures) | Owner capture time | none |
| G16 | P3 | Missing `ta.*`/`math.random`/`timestamp`/`barstate.isnew`/`syminfo.type`/`str.*`/polyline/map/matrix/methods/varip/`request.financial` | §3 | — | Long tail of refusals | M each | — | L |
| G17 | P3 | Screener-centric note language in chart migration | Box notes "a screen reads plot() and alertcondition()…" | Chart-first copy | Confusion | S | G2 | L |

---

## 10. Tests run

**Existing suites (all green):**
- vitest, 12 files / 266 tests: `pineLibraries`, `pine.plotarrow`, `pine.security`, `objectLoss`, `foreignLanguage`, `dialect`, `PineBox.editor`, `ImportBox.toScreen`, `__truth__/p0.imp.truth`, `memberPaneDefinition`, `MemberPane`, `BuilderSheet.pine`.
- pytest, 63 passed: `tests/test_pine_library_store.py`, `test_runtime_definitions.py`, `test_pine_runtime_switch_on.py`.

**Vendor harness:** `vendorHarness.corpus.test.js` run twice over `tests/fixtures/vendor/harness` (336 captures): with default flags, and with `VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`. About 142 s each. Output went to the scratchpad; a redacted copy is in `results/`.

**Audit scratch harnesses** (`app/src/__audit_scratch__/ws5/`, not committed):

| file | what it does |
|---|---|
| `corpus.audit.test.js` | Phase 1: both doors, all 16 scripts |
| `phase2.audit.test.js` | Objects, paints and the dark runtime lane |
| `numinputs.audit.test.js` | Numerics with the document's own input defaults |
| `paintobj.audit.test.js` | Paint condition and pivot labels with and without a witnessed tick |
| `constructs.audit.test.js` | 185 construct probes |
| `census.audit.test.js` | 266 committed scripts |
| `phase3.audit.test.js` | Box verdict vs vendor verdict, 336 captures |
| `mtf.audit.test.js`, `mtf2.audit.test.js` | `lookahead` and `gaps` variants vs four TradingView models, plus repaint modes |
| `trunc.audit.test.js` | No-lookahead truncation test |
| `pivot.audit.test.js` | Pivot mapping vs reference, plus truncation |
| `accum.audit.test.js` | Bounded-accumulator acceptance threshold |
| `strat.audit.test.js` | Strategy notes |
| `probe1–3.audit.test.js` | Spot checks |
| `refs.js` | Independent reference maths |

**Not verified:**
- The live production env vars (no Railway access).
- The production library store contents.
- Server-side `user_definitions.save()` for these documents.
- On-screen rendering in a browser (out of scope; rendering is inferred from saved definitions).
