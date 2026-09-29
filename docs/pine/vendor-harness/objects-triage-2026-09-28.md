# Object lane vs TradingView — triage of the 36 diverging captures (2026-09-28)

**Source of the verdicts:** the 47 live captures in
`C:/Users/Patrick/AppData/Local/uct-vendor-batch/runs/ext-2026-09-28/captures/`
(NYSE:RDDT 1D, 632 bars each), graded by
`app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js`
with `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`. Baseline re-run in this worktree at
`a07c83fe7` reproduces the batch's `grade-all47/verdicts.json` exactly:
**objects MATCH 11 / 47, object families agreeing 161 / 252.**

A "family" is one of the seven comparisons `compareObjects` makes per script
(counts of lines, labels, boxes, tables, table cells; texts of labels and cells).

## How the root causes were found (evidence, not reading)

Every class below was established from one of these instruments, run over all 47
captures (none is committed; they were throwaway vitest files and a temporary
`globalThis`-gated capture in `pine.js::canonicalOf` / `guardOf`, restored by
byte capture afterwards):

* **drop census** — `translation.objectDiagnostics.dropReasons` per script, plus the
  refusal message of every tree `canonicalOf` could not resolve;
* **guard columns** — every op's `when` column evaluated over the 632 bars
  (`truthy k/632`), which is what exposed the object lane's unread `isconfirmed`;
* **id parity** — TradingView numbers drawing objects with ONE monotonic counter,
  and so does `objectRuntime` (`nextId`). Where our creation sequence is the
  vendor's, the ids agree exactly (e.g. `ultimate-pivot-points`: vendor holds line
  ids 11218..11313, our uncapped run created ids up to 11322 in the same order), so
  "which objects does TradingView still hold" is answerable per id, not guessed.

## The 36 scripts, by primary root cause

| script | differing families (vendor / ours) | primary root cause | also |
|---|---|---|---|
| `artemis-oscillator-pro` | lines 13/0; labels 17/0; cells 21/10; texts | C9 dynamic history offset (`x[expr]`, 14 trees) | C10 `request.security` (24 cells), C11 arrays, C15 `position.*` as a value |
| `atr-support-and-resistance` | lines 20/0; boxes 20/0 | C12 values computed in multi-statement blocks (`pine:block`) — **step 15: MATCH, id for id** | C11 arrays |
| `average-day-range-adr-pivots` | lines 2/0; boxes 2/0; cells 4/2; cell text | C13 drawing functions called inside an expression (`fn:in-expression` ×16) | C8 `timeframe.change` (32), C11 drawing arrays, C16 `table.merge_cells` |
| `dual-view-htf-candlestick-patterns-theultimator5` | no drawing program (436 held) | C11 arrays of drawings written in blocks | C12 |
| `ema-ribbon-trend-filter-strixedge` | cells 48/34; cell text | C10 `request.security` in cell text (54 trees) | C15 `str.tostring` form, `size.*`/`position.*` as values |
| `extrapolated-pivot-connector` | no drawing program (6 held) | C9 dynamic history offset (`n[n - a1 + length]`) | C1 plot titles HTML-escaped; C6 comma-separated statements (`label.delete(a[1]),label.delete(b[1])…`) |
| `heat-map-seasons` | tables 1/8; cells 31/24; cell text | **C4 table re-created every bar — TradingView keeps one per position; we refuse at 8** | **C5 `\n` escape** |
| `high-low-open-mid-ranges` | lines 504/0; labels 504/0; cells 45/1; texts | C13 `fn:in-expression` (19 drawing-function calls) — after C6 these were `fn:conditional-history` ×44 under input guards; **inlined, step 13** (cells 45/37; lines/labels withheld, § C13) | C7 GC slack (500→504); C8, C10, C14, C15 (§ C13) |
| `htf-candle-footprint-cartel-console` | lines 6/0; labels 6/0; boxes 13/0; cells 2/1; texts | C8 `timeframe.change` (48 trees) | C11 |
| `htf-liquidity-dashboard-tfo` | lines 6/0; cells 30/3; texts | C11 UDT fields (`s0d_highs.size` …) | C12, C13 `fn:conditional-history` |
| `ict-ipda-look-back` | lines 3/0; boxes 6/0; tables 1/8 | **C4 — the run REFUSES at bar 8 (`more than 8 live table objects`) and stops stepping, so every line and box is lost** | — |
| `ict-killzones-pivots-tfo` | cells 3/1; cell text | C11 UDT/arrays (`kz1._box.size` …) | C13 |
| `institutional-smc-order-flow-matrix-pro` | lines 18/27; labels 34/43; boxes 2/0 | C11 arrays of boxes + lost deletes (`guard:delete` ×2 → extra lines/labels). **By `b27e0e9e6`: lines 18/0, labels 34/16; step 16: 18/13 and 34/29, the 13 lines TradingView's last 13** | C9; C12 warm-up curtain (the 5 missing breaks are all before bar 250) |
| `k-clustering` | lines 9/0; cells 8/5; cell text | C11 UDT/array (`n_clust.get`, 120 trees) | — |
| `linear-regression-channel-…-existing-trend-lines` | lines 5/0 | C10 `request.security` (create:line ×5) | — |
| `liquidation-levels` | no drawing program (10 held) | C8 `time_close` (40 trees) | C15 `str.format` (20) |
| `liquidity-heatmap-nephew-sam` | labels 27/0; label text | C10 `request.security` — every pivot the labels sit on is a `request.security(…, getPivotData(…))` tuple; the `pine:function-def` refusal the census records is `getPivotData` reached THROUGH that call (corrected after reading the source; first filed as C17) | C5 |
| `liquidity-pools` | lines 182/0; labels 91/0; label text | **C2 the object lane never receives `newestBarIsForming`, so `barstate.isconfirmed` is `na` in every object tree and `swing_h` never fires** | **C3 `linefill.new` on the same two lines REPLACES (vendor 91 fills = 182 lines / 2; ours evicts through 500)**, C9 |
| `makuchaku039s-trade-tools-fair-value-gaps` | boxes 51/50 | C7 GC slack (vendor holds ids 139..189 = newest 51 of 189 at default 50) — **fixed, step 9: MATCH** | — |
| `market-structure-by-leviathan` | lines 6/133; labels 22/133; label text — **by `b27e0e9e6` already 6/5 and 22/21 (the over-draw was gone), and one of the 21 was WRONG: "LH" at 230.41 where TradingView says "HH"** | C12 `var` state reassigned inside `if` blocks (`prevHigh` "nothing updates") → guards dropped, remaining creates over-fire. **Step 15: the wrong word came from reading `prevHigh`'s warm-up `NaN` as Pine's `na`; now withheld — 5/6 lines, 18/22 labels, every one TradingView's** | C12 warm-up curtain (`PINE_STATE_WARMUP`, owner-gated) |
| `momentum-volatility-scanner` | cells 12/11; cell text | C16 `table.merge_cells` unsupported | — |
| `multi-timeframe-supply-demand-zones` | boxes 504/500 | C7 GC slack (all 504 created on one bar; vendor keeps all 504 at max 500) — **fixed, step 9: MATCH** | C13 |
| `options-max-pain-calculator-backquant` | lines 10/0; labels 8/0; boxes 13/0; cells 16/11; texts | C11 arrays + `while` loops in functions (loop-blocked `box.new`/`label.new`/`line.new`) | C5 |
| `poor-man039s-volume-profile` | labels 40/0; label text | C8 `time_close` (160 trees → 159 `update:props`, 40 `create:label`) | C12 `pine:reassign` |
| `position-size-calc` | cells 10/0; cell text | C12 block-computed cell text (`guard:cell` ×10). **Re-traced 2026-09-29: NOT C12.** All ten cells sit under `if barstate.islast and not ignored_list(syminfo.root)`, and `syminfo.root` is ROSTERED UNSERVED (`symbolScope.json::unserved`, ruled 2026-09-15, item (h)) — `syminfo.root != "VIX"` alone drops the cell, `barstate.islast` alone converts it | C10 (`Lots` reads `userate`, which is `request.security`); the vendor's `Profit`/`Pos. Size` read "NaN" (0/0 at the default inputs) |
| `position-size-calculator` | labels 4/50; label text | **C6 comma-separated statements: `var l = label(na), label.delete(l), l := label.new(…)` keeps only the LAST statement — the `var` and the `delete` vanish, so labels accumulate to the cap** | **C5 `\n` escape** |
| `pro-trading-art-double-top-bottom-with-alert` | lines 7/0; labels 14/0; label text | C11 UDT (`top.first`) | — |
| `reverse-stochastic-momentum-index-on-chart` | no drawing program (1 held) | C8 `time_close` | — |
| `rsi-swing-indicator` | lines 11/0; labels 11/0; label text | C12 `var` state reassigned in blocks (label guards truthy 0/632). **Re-traced 2026-09-29: the guards now resolve; what drops every create is C14** — each label's `text` is `obLabelText()`, which reads `last_actual_label_hh_price := label.get_y(labelll)` (a getter written into `var` state), and each line's `x2`/`y2` is `label.get_x/get_y(labelll)` (a getter in a coordinate). Measured with a byte-restored capture on `valueRef`: 4 label `text`, 2 line `x2` | C13 (`label.new` returned from an `if` inside `createOverBoughtLabel`) |
| `sector-rotation` | boxes 504/0 | C8 `chart.left_visible_bar_time` (viewport-dependent — not answerable on a bar series) | C7 |
| `smt-divergence-ict-01-…` | lines 500/0; labels 500/0; label text | C9 dynamic history offset (`low[bar_index - x]`) | — |
| `trend-duration-forecast-chartprime` | lines 1/0; labels 28/0; cells 34/0; texts | C11 UDT/array methods (`bullishCount.avg` …) | C2, C5, C14 |
| `trend-lines-supports-and-resistances` | no drawing program (14 held) | C13 `fn:loop` / `fn:conditional-history` → a lost removal → drawing withheld | — |
| `ultimate-pivot-points` | lines 51/50; labels 51/50 | C7 GC slack (vendor holds the newest 51 at default 50) — **fixed, step 9: MATCH** | C14 getter in a guard (9 `update`s dropped) |
| `vdubus-pattern-gen-v2-restored-refined` | lines 112/0; labels 5/0; label text | C11 arrays created inside a function (`zzP`, 148 trees) | — |
| `vold-market-breadth` | cells 2/0; cell text | C10 `request.security` | C15 text-value |

## The classes

| class | what it is | scripts (primary) | general fix? |
|---|---|---|---|
| **C1** | vendor study metainfo arrives HTML-escaped (`Pivot High&#039;s`, `Makuchaku&#039;s`) — **titles only**: no object text in the 47 captures carries an entity | extrapolated (plot titles) | yes, harness |
| **C2** | the object lane is deaf to `newestBarIsForming` — `objectReaderFor` passes `tf` and inputs to `interpret` but not the bar-close tri-state, so `barstate.isconfirmed`/`ishistory`/`isrealtime` are `na` in every object tree while the plot beside it reads them | liquidity-pools, trend-duration | yes, engine |
| **C3** | `linefill.new` on a pair that already has a fill replaces it (Pine manual, Fills); a fill between `na` lines holds nothing | liquidity-pools | yes, runtime |
| **C4** | a table created at a position that already holds one replaces it; we treated tables as an 8-deep house envelope and REFUSED the whole run | heat-map-seasons, ict-ipda-look-back | yes, runtime |
| **C5** | string escape `\n` lexed as the letter `n` | position-size-calculator, heat-map-seasons (+ trend-duration, max-pain, liquidity-heatmap once reachable) | yes, lexer |
| **C6** | several statements on one line separated by commas (`a, b, c`) — only the all-bindings case is split; a line mixing calls/`var`/`:=` keeps its last statement in a function body and is left whole at top level | position-size-calculator, extrapolated (secondary) | yes, object reader |
| **C7** | vendor garbage collection is BATCHED, not strict: a create past `cap + 5` cuts the family back to `cap`, oldest first, sparing the running bar's creates and `var`-held objects — measured by id on the `vw-object-gc-*` probes (§ C7) | makuchaku, ultimate-pivot-points, multi-timeframe-supply-demand-zones | **yes, engine — done** (`c5e63beea`, step 9) |
| C8 | clock builtins we do not hold: `time_close`, `timeframe.change`, `chart.left_visible_bar_time` (the last is viewport state and unanswerable) | liquidation-levels, poor-man, rsmi, adr, htf-footprint, sector-rotation | needs a declared clock column each |
| C9 | a history offset that is an expression (`x[bar_index - k]`) | artemis, extrapolated, smt-divergence | large — the columnar lane requires literal windows by design |
| C10 | `request.security` in object text/coordinates | artemis, ema-ribbon, linear-regression, vold | large — needs the MTF data seam |
| C11 | arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus | large |
| C12 | values or `var` state computed across a multi-statement block | atr-sr, market-structure (position-size-calc and rsi-swing re-traced to `syminfo.root`/C10 and C14) | **done, steps 13–15**, down to the owner-gated warm-up curtain |
| C13 | user drawing functions the inliner refuses (`in-expression`, `conditional-history`, `loop`) | adr, OHLM, TSR | medium, per refusal kind |
| C14 | object getters in a coordinate or guard | (secondary) rsi-swing, ultimate, trend-duration | medium |
| C15 | text builtins / constants in value position (`str.format`, `size.*`, `position.*`) | (secondary) | **done, step 14** — liquidation-levels, rsmi MATCH; the rest stop on C9/C10/C11/C12 (What is left, rank 9) |
| C16 | `table.merge_cells` | momentum-volatility-scanner | small |
| C17 | ~~a function definition read inside a guard~~ — no script's primary cause once `liquidity-heatmap` was traced to C10 | — | — |
| **C19** | `for i = a to b by s` — the reader refused any stepped loop whole (the loop op had no step); found while re-grading after C4, as what still held `heat-map-seasons`' gauge cells (`loopBlocked: table.cell`) | heat-map-seasons | yes, reader + runtime |

## Fix order (scripts fixed per change) and results

Each fix is general Pine semantics with a focused test and a control that fails
without it; each row below is a full re-grade of the 47 captures.

| step | class | commit | objects MATCH | families agreeing | scripts that moved |
|---|---|---|---|---|---|
| baseline | — | `a07c83fe7` | 11 / 47 | 161 / 252 | — |
| 1 | C1 metainfo HTML decode (harness) | `925bc50e0` | 11 / 47 | 161 / 252 | none on objects (by construction); `extrapolated-pivot-connector`'s two plots go UNMAPPED → mapped and compared (630/632 bars agree) |
| 2 | C4 table replaces the table at its position | `f1b86c777` | 12 / 47 | 165 / 252 | `ict-ipda-look-back` 4/7 → **7/7 MATCH** (lines 3, boxes 6, tables 1 — the run no longer stops at bar 8); `heat-map-seasons` 4/7 → 5/7 (tables 1/1; cells still short — C5 + a loop-blocked `table.cell`) |
| 3 | C5 `\n` escape is a newline | `4ba2ee1ec` | 12 / 47 | 165 / 252 | no family flips yet, and the reason is measured: the text family compares MULTISETS, so a right text in a wrong count still disagrees. The divergent strings are gone — `heat-map-seasons` cells `onlyOurs` ['☀︎ - Summern❆ - Wintern…'] → [] ; `position-size-calculator` labels `onlyOurs` 8 × 'n Account Balance…' → [] (its count, 4/50, is C6) |
| 4 | C6 comma-joined statements split for the object reader | `a2697d89c` | 13 / 47 | 167 / 252 | `position-size-calculator` 5/7 → **7/7 MATCH** (labels 4/4 and texts, with C5); `extrapolated-pivot-connector` still has no program — its top-level `label.delete(a[1]),…` now reads, but every create sits behind C9 |
| 5 | C2 the object lane receives `newestBarIsForming` | `f20c2d6c3` | 14 / 47 | 171 / 252 | `liquidity-pools` 4/7 → **7/7 MATCH** (lines 182, labels 91 and their texts); `trend-duration-forecast-chartprime` 2/7 → 3/7 (lines 1/1; its labels/cells sit behind C11) |
| 6 | C3 one linefill per pair of lines, none without them | `82c0e2029` | 14 / 47 | 171 / 252 | linefills are not a graded family, so the score cannot move; measured directly instead: `liquidity-pools` fills 500 → **91 = vendor 91**, `price-action-…` 19 = vendor 19 (unchanged), `linear-regression-…` 2 → 0 against vendor 2 — its two fills had been attached to lines we never draw (C10), so the old 2 was a coincidence of counts, not a drawing |
| 7 | C19 `for … by <step>` carried as the loop's step | `7564906d3` | 15 / 47 | 173 / 252 | `heat-map-seasons` 5/7 → **7/7 MATCH** (cells 31/31 and their texts, with C4 + C5). Side effect, measured and kept: `sonarlab-order-blocks` (committed corpus, not in this batch) has `for … by 1` delete loops; they are READ now and their array-size bounds are not, so its loss moved from a reader-level block (no drop counted) to a counted `loop:bounds` drop — still refused at the member door, now as "a loop that deletes", and no longer (falsely) clean in the host lane. Three rails that pinned the old accounting were re-pointed, and the "lost before conversion" class kept a synthetic `while` fixture because no committed script shows it any more |
| 8 | C16 `table.merge_cells` carried (reader → runtime → render state → DOM `colSpan`) | `554f78d85` | 16 / 47 | 175 / 252 | `momentum-volatility-scanner` 5/7 → **7/7 MATCH** (cells 12/12 — the covered (1,0) cell is held, empty, as the vendor holds it); `average-day-range-adr-pivots` cells 2 → 3 of 4 (its merged cell reads now; the missing cell is the one `cell:text` drop the census records — not traced further) |
| 9 | C7 the object collector is batched (`cap + 5` → `cap`, sparing the bar and `var`-held objects) | `c5e63beea` | 19 / 47 | 180 / 252 | `makuchaku039s-…` 6/7 → **7/7 MATCH** (boxes 51/51), `ultimate-pivot-points` 4/7 → **7/7 MATCH** (lines 51/51, labels 51/51), `multi-timeframe-supply-demand-zones` 6/7 → **7/7 MATCH** (boxes 504/504) — all three id for id; `contraction-box` stays MATCH at 50; no other family moved. The 8 probe captures: 0/8 → 6/8 objects MATCH, 19/42 → 42/42 families (D is refused at the door) |
| 10 | C8 `time_close`, `time_close("D")`, `timeframe.change("D"/"W"/"M")` as clock columns (`timeclose`, `dayclosetime`, `weekfirst`, `monthfirst`; measured on the `vw-clock-close-tfchange` probe) | `dff023f59`, `445900da7`, `3fb5093f8` | 16 / 47 | 175 / 252 | `poor-man039s-volume-profile`'s 40 labels converted at `dff023f59` and were drawn with EMPTY text (their text is built in a `for` this chart cannot fold, C12; TradingView shows `####…`) — briefly 176/252 on a count that was drawn wrong. `3fb5093f8` withholds any object whose text a lost setter writes and refuses a block local the reassignment overrule condemned, so the labels are counted, not drawn: its sentence reads 240 of 246 (was 199). The same fix stops `artemis-oscillator-pro` drawing an empty cell (25 → 26 of 38) and `sonarlab-order-blocks` placing boxes at `bar_index[0]` (still refused, now `pine:no-output`). No C8 refusal remains in any of the five scripts' object programs; each now stops on another class: `liquidation-levels` C15 `str.format` (40 trees), `reverse-stochastic-momentum-index-on-chart` a text feature (14), `average-day-range-adr-pivots` C11/C13, `htf-candle-footprint-cartel-console` C12 (`startBar`, 48). Attach status unchanged for all 266 corpus scripts, both flag states |
| 11 | C8 early closes and holiday weeks: `time_close` / `time_close("D")` read the session close as TradingView's calendar applies it (`market_calendar.json` extended to 2000, vendor view derived in `tradingview_session`) | `f37825c96` | unchanged | unchanged | none on the 47 (no graded script reads a close on an early-close day). Probe rows K01/K02/K03/K12/K13: 1D 13/13/13/26/13 → 0; 60m 13/52/13/26/52 → 0. Against master `9f9d60b4b`: 47-capture verdicts (211 entries), the committed harness dir (87 captures, 349 entries) and the member-door census (38 / 61 of 266 attach) all 0 changed |
| 12 | Q-T1 widened: date-keyed W / M bars read their period's first vendor session (M UNMEASURED); the harness keys W by the product's Friday | `6caad1725` | unchanged | unchanged | none on the 47 (all 1D). Probe W rows through the door: K01/K02/K03/K08/K13 1,758 → 0, K04/K05/K06/K07/K12/K16 1,757 → 0. Plot-column census, every attaching corpus script (61) on SPY 1D and 1W bars, master vs tip: 252 columns each; 1D 0 changed; 1W 2 changed, both in `support-and-resistance-multi-time-frame` (`security(…,'M',…)` on a weekly chart: Resistance Monthly 245 bars, Support Monthly 9) — caused by the harness now feeding the product's FRIDAY key, not by the clock: the MTF resampler groups a week that straddles two months by its key day, so a Friday key files it in the later month. That is what the product already does; whether TradingView does it is unmeasured (no W capture of an MTF-monthly script) |
| 13 | C13 conditional-history: a drawing helper called under a guard built only from inputs and constants inlines (`guardIsBarInvariant`) — the call runs on every bar or none, so its history is the every-bar history. With it, C7's collector made a new hazard visible, closed first: a family the collector CUT while the program lost creates of it is withheld (`program.lostCreates` → `objectRuntime` `withheld`) — see § C13 | `91255467d` (withhold), `a42bb977c` (inline) | 18 / 47 → 18 / 47 | 169 → 167 (of the 238 families the instrument records on both sides; measured at base `b27e0e9e6`, whose table read 18 / 47, not step 9's 19) | `high-low-open-mid-ranges`: `fn:conditional-history` 44 → 0; cells 13 → 37 of 45, every one a cell TradingView shows (the other 8 are `request.security` 'M'/'3M', C10); lines 504/504 and labels 504/504 would have been the right COUNTS of the wrong objects (TradingView holds five lines a week, ours four) — withheld. The two families that dropped were coincidences, now withheld: `sector-rotation` lines 50/50 → 50/0 (TradingView holds two per bar over 25 bars, ours one per bar over 50) and `htf-liquidity-dashboard-tfo` labels 6/6 → 6/0 (two were drawn BLANK where TradingView shows `PDH`/`PDL`; the text setters the inlined helper holds sit behind unreadable guards). Corpus: conditional-history refusals 701 → 579 (20 → 15 scripts). Committed harness dir 87 entries: 3 changed, exactly those. Member-door census 266 × 2 flag states: 0 rows changed |
| 14 | C15 string/value forms in object text and props: `str.format` in a text (patterns compiled at translate time; `{N}` and `{N,number,#.##}` read off `liquidation-levels`' own labels and the w3-format probe; everything no capture pins refused by name or withheld at run time); a `switch` in a text/enum position read as the `if` chain a ternary produces (default-less only over an `input.string` whose options every arm covers); `syminfo.ticker` as text; a v6 text whose branch flips on how `timeframe.period` is spelled WITHHELD (`textFormatRefusals 'timeframe.period:v6-spelling'`); `openName` asked for one hop, not the text depth; a helper called inside an inlined helper served by substitution; a work bound on the text reader (`TEXT_WORK_BUDGET` 4096, `textTooLarge`) | `51acf1490`, `8a9ce291f`, `2473127d2`, `8e18fc483` | 18 → 20 / 47 (harness `summ.py` over `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base `b27e0e9e6`) | 169/238 → 183/252 (the denominator grows because two scripts that had no program now have seven families each) | `liquidation-levels` no program → **7/7 MATCH** (10 labels, texts e.g. `+5x: 120.426`); `reverse-stochastic-momentum-index-on-chart` no program → **7/7 MATCH** (its one info-box label, character for character and by id); `artemis-oscillator-pro` cells 9 → 13 of 21 (three tables where the vendor's `pos` says, MTF labels `15m`/`1h`/`4h`/`1D` match; its four WRONG cells `0%`, `29 ▼ BEAR`, `↓-3`, `◈ NEUTRAL` predate this and are C12 — `float knnVal = 50.0` reassigned inside `if kSize >= knnK`, read at its declaration); `ema-ribbon-trend-filter-strixedge` `onlyOurs ['NaN'] → []` (footer reads `RDDT`), every `text_size` = vendor `small`, cells 34 → 33: the two `timeframe.period` cells are withheld — at base we drew `► 1D` in BOTH (0,5) and (0,9) where the vendor drew `► 1D` / `   1D`, so one right cell is lost with the wrong one. Whole committed harness dir (120 graded, 82 inventory): the same 4 entries change, 0 plot changes, overall MATCH 34 → 36. Member-door census, 266 scripts × both flags: attach 38/59 unchanged; `drawsObjects` false → true for `liquidation-levels` and `rsmi` only. `screener-mean-reversion-channel` now names its lost label `textTooLarge steps>4096@488` (same drops as base, now counted by name) |
| 15 | C12 an `if` used as an expression with no `else` is a value; its missing branch is `na` (only for a proven number — v5/v6 disagree on bool) | `f7564f5da` | 19 / 47 | 171 / 238 ᵃ | `atr-support-and-resistance` → **MATCH, id for id** (lines 20, boxes 20, one interleaved counter); the capture decides the fallthrough — `else 0` draws more boxes than TradingView. Census 38/59 → 39/60 attach (implied-volatility-suite; cppivot moves `pine:block` → `pine:request`) |
| 16 | C12 a `var` read through `ta.crossover` / `[k]` inside its own update folds (`y[1]` of a variable is last bar's `self`) | `4ae19a95d` | 19 / 47 | 171 / 238 ᵃ | `institutional-smc-order-flow-matrix-pro` lines 0 → 13, labels 16 → 29 (vendor 18 / 34): the 13 are TradingView's last 13 in order, level and kind; the 5 missing all break before bar 250 (the warm-up curtain) |
| 17 | C12 an op that reads a `var` on a bar where its value DEPENDS on the not-computable warm-up prefix is withheld, not drawn off a `NaN` read as Pine's `na` — measured per bar by two probe runs (`objectColumns.unknownMask`) | `911348fba` | 19 / 47 | 171 / 238 ᵃ | `market-structure-by-leviathan` labels 21 → 18, lines 5 (vendor 22 / 6): the removed "LH" at 230.41 was WRONG (TradingView: "HH"); every object still drawn is TradingView's last 23 of 28, in order, word and level. A static horizon was measured and rejected (it withheld all 5 correct BOS lines and a line of a MATCH). Harness dir: 1 capture changed, inventory identical; census unchanged |

ᵃ Steps 15–17 count families over the 238 the object verdict compares (the base, `b27e0e9e6`, reads 18 / 47 and 169 / 238; two of the 47 are door refusals with no object families), not the 252 of the rows above.

### Where the lane stands

**Objects MATCH 11 → 19 of 47; object families agreeing 161 → 180 of 252.** Steps
1–8 took it to 16 / 175 and step 9 (C7) to 19 / 180. Before C7, five
scripts flipped to MATCH (`ict-ipda-look-back`, `position-size-calculator`,
`liquidity-pools`, `heat-map-seasons`, `momentum-volatility-scanner`); two more
moved without flipping (`trend-duration-forecast-chartprime` 2 → 3 of 7,
`average-day-range-adr-pivots` cells 2 → 3 of 4), and `high-low-open-mid-ranges`
now holds 13 of its 45 cells (was 1). Every step is one commit with a focused
test and a mutation proof; the 31 scripts still diverging are listed below by
what would move them.

## C8 — `time_close` and `timeframe.change`, read off the vendor

Probe `tools/visual_conformance/probes/vw-clock-close-tfchange.pine`, captured on
AMEX:SPY at full history: 1D (8,473 bars) and 1W (1,758) in
`tests/fixtures/vendor/harness/`, 60m RTH (20,616) outside git for size, with four
windows committed as `tests/fixtures/vendor/clock-close-tfchange-spy-60-excerpt-2026-09-28.json`.

| reading | rule | exceptions, counted |
|---|---|---|
| `time_close`, 1D | 16:00 New York on the bar's date — the session close, never the next open (`time_close - time` = 23400 s) | 13 of 8,473 read 13:00: the real early closes, every one from 2019-07-03 on. Not 2020-11-27, not 2020-12-24, none before 2019 — the vendor's own calendar is irregular |
| `time_close`, 60m | the next 09:30-grid boundary, **clipped at 16:00** (the 15:30 bar reads 16:00, span 1800 s); the last bar likewise | 13 of 20,616: each early close's 12:30 bar reads 13:00 |
| `time_close`, W | Friday 16:00 of the bar's week, the forming last week included | 52 of 1,758: 45 holiday weeks ending Thursday 16:00, 6 ending Friday 13:00, 1 ending Thursday 13:00 |
| `time_close("D")` | 16:00 on the date the bar OPENED — on 1D, on every RTH bar of a 60m day, and on a weekly bar (the week's FIRST session) | early closes: 13 (1D), 52 (60m, every bar of those 13 days), 1 (W) |
| `timeframe.change` "D"/"W"/"M" | this bar's New York day / ISO week / month differs from the previous bar's; false on bar 0 | none — 0 mismatches on all three charts, and equal on every bar to its control `ta.change(time(tf)) != 0`; "1W" reads as "W" |
| forming last bar (K17) | the same template: the W capture's forming week read Friday 16:00 | — |

**The early-close decision — superseded 2026-09-28 (branch `pine/early-close-wm-clock`).**
The lane first answered the regular-session template and COUNTED the mismatch,
because the repo's calendar covered 2025–2027 only. The one calendar
(`market_calendar.json`, TERM-035) now runs back to 2000, and the clock layer
derives the vendor's own view of it, so both lanes read the session close as TradingView applies it and the counted
mismatch is gone: **1D / 60m / W `time_close` and `time_close("D")` agree on every
bar** (K01/K02/K03/K12/K13: 1D 13/13/13/26/13 → 0; 60m 13/52/13/26/52 → 0; W on the
vendor's own instants 52 and 1 → 0).

| what the vendor's session applies | measured on | rule |
|---|---|---|
| closures | W: 133 of 134 late-starting weeks and 46 of 47 early-ending weeks from 2000 on read the first / last session; 0 of 44 before 2000 do | no closure before 2000; not September 11 2001 (the 09-10 week reads Friday 16:00), not Hurricane Sandy (the 2012-10-29 week is stamped Monday 09:30); Reagan 2004-06-11 and Ford 2007-01-02 ARE applied |
| half-days | 1D: 13:00 on exactly 13 days, all from 2019-07-03; 60m agrees | none before 2019 (all eight 2015–2018 half-days keep a full session, late-trading bars to 16:00 included); not 2020-11-27 or 2020-12-24 |

The calendar itself is NYSE truth. Its 2000–2024 rows (233 closures, 55 half-days)
were added to `market_calendar.json` from the two libraries it already came from
(exchange_calendars 4.13.2, pandas_market_calendars 5.4.0), which agree on every
one; the closures also equal the NYSE holiday rules with the named unscheduled
closures (331 over 1993–2028, identical) and the weekdays with no vendor daily
bar (309 over the vendor's 1993-01-29..2026-09-28 span, identical), and the 2015–2024 half-days equal the days the vendor's 60m
volume collapses after 13:00. One pandas-only special close (2005-06-01 15:56) is
left out as disputed; the rules alone would have been wrong on 2002 (July 5, not
July 3) and 2003-12-26, which is why the libraries, not the rules, are the source.
Coverage starts at 2000 because the vendor applies no closure before it. The
vendor's exceptions are written ONCE in the clock layer (`tradingview_session.py`
⇄ `tradingViewSession.js`, parity-tested) and the vendor's view is derived; `tests/test_nyse_calendar_vendor_evidence.py` holds the calendar to the
captures. ⚠️ Measured on AMEX:SPY only: whether TradingView applies the same view
to a NASDAQ or NYSE listing is unmeasured.

**Weekly and monthly clock (2026-09-28, same branch).** A date-keyed W / M bar had
no clock (Q-T1 covered D only), so every time-derived row read blank on the
product's weekly bars. TradingView stamps a weekly bar with the open of its week's
FIRST session and closes it at its LAST: measured on all 1,758 SPY weeks — Monday
09:30 on 1,625, Tuesday on 132, Wednesday once (2007-01-03) — under the same
vendor calendar as the closes (every week before 2000 opens Monday). The product
keys a weekly bar by the FRIDAY of its ISO week (`bars_fetch._resample_weekly_iso`,
`weekly_dating=friday-close`, holiday Fridays included) and a monthly bar by the
1st (`_resample_monthly_iso`); `barOpenInstant` / `bar_open_instant` map ANY date
of the Monday-first ISO week / the month to the same instant, so the key day
cannot matter, and `ourSide.toProductBars` now feeds the harness the product's key
instead of the vendor's stamp. Probe W rows through the member door (K01–K08,
K12, K13, K16): 1,757–1,758 of 1,758 wrong (blank) → **0**. ⚠️ **MONTHLY IS
UNMEASURED**: no monthly capture exists; M applies the weekly rule to a month
(first session's open, last session's close) and is labelled that way.

**Translation.** `timeframe.change(tf)` → `isfirst ? 0 : <weekfirst|monthfirst|sessionfirst>`,
not `col != 0`: the member pane translates before it knows the chart's timeframe,
and the pane's weekly/monthly bars carry no clock (Q-T1), where `!= 0` read false on
every bar (1,757 of 1,757 new-day bars). The `isfirst` form reads blank there and
false on bar 0, which is the vendor's reading. ⚠️ The existing control idiom
`ta.change(time("D")) != 0` still launders the same way on a weekly pane (K07 reads
0 on all 1,757) — not changed here.

**What the probe cannot grade through the member door.** K09–K11
(`hour/minute/dayofweek(time_close)`: a computed timestamp as an argument) and
K14/K15 (`time("W"/"M")`) refuse by their own named rules, which refuses the whole
probe at the member door. They are checked off the columns in the focused test,
and the harness was re-run on a scratch copy of the three captures with those five
rows removed from the source.

## C7 — the vendor's garbage collection: measured by id, and IMPLEMENTED (2026-09-28)

TradingView documents `max_*_count` as approximate ("the count is approximate;
more drawings than the specified count may be displayed"). It is approximate
only when read by COUNT. Read by id it is exact, and it is one rule:

> **A create that takes a family past `cap + 5` deletes the OLDEST objects of
> that family until `cap` remain — skipping any object created on the running
> bar and any object a drawing variable currently holds. Skipped objects still
> count.**

So the held count saw-tooths between `cap` and `cap + 5`, and where it sits at
the end is the phase of the last bar — which is why the six corpus rows looked
like six rules. Implemented once, in `objectRuntime`'s create (`collect()`),
the only collector either lane runs; the constant is `objectPool.GC_BATCH = 5`.
Commit `c5e63beea`.

### The probes, and what each capture held (ids from `tv_capture.js`)

Probes `tools/visual_conformance/probes/vw-object-gc-{a,b,c,d}.pine`
(`203d43609`), captured live on AMEX:SPY 1D (8,473 bars, last bar 8472) and 1W
(1,758 bars, last bar 1757) at full history, `57ae9e7c1`. One id counter serves
every family, so each bar's ids are decodable from the per-bar call order in
the probe headers; box and label texts carry the bar.

| capture | family (cap) | TradingView held | = |
|---|---|---|---|
| A 1D | boxes (50) | 55: `AB 8418` … `AB 8472`, ids 35778 … 36007 | the newest 55 boxes |
| A 1D | labels (50) | 55: `AL 8256` … `AL 8472` by 4s, ids 35090 … 36008 | the newest 55 labels |
| A 1D | lines (50) | 51: bars 8456 … 8472 × widths 1,2,3, ids 35941 … 36011 | the newest 51 lines |
| A 1W | boxes / labels / lines | 54 (`AB 1704`…`1757`) / 51 (`AL 1560`…`1756` by 4s + `AL 1757`) / 54 (bars 1740…1757 × 3) | newest 54 / 51 / 54 |
| B 1D | boxes / labels / lines (50) | 55 `BB 8418`…`8472` / 55 `BL 8418`…`8472` / 51 (bars 8456…8472 × 3) | newest 55 / 55 / 51 |
| B 1W | boxes / labels / lines (50) | 54 `BB 1704`…`1757` / 54 `BL 1704`…`1757` / 54 (bars 1740…1757 × 3) | newest 54 / 54 / 54 |
| C 1D | boxes (3) | `CB KEEP-VAR` (id 1), `CB KEEP-SET` (id 2), `CB 8472` (id 25419) | two `var` boxes from bar 0 + the newest one |
| C 1D | labels (5) | 9: `CL 8460, 8462, 8463, 8465, 8466, 8468, 8469, 8471, 8472` | the newest 9 LIVE (the ≡ 1 mod 3 ones were deleted) |
| C 1D | lines (7) | 11: id 25421 solid w2 + ids 25422 … 25431 dotted w1 | every line of the last bar, nothing older |
| C 1W | boxes (3) | 8: `KEEP-VAR`, `KEEP-SET`, `CB 1752` … `CB 1757` | two `var` boxes + the newest 6 |
| C 1W | labels (5) | 8: `CL 1746, 1748, 1749, 1751, 1752, 1754, 1755, 1757` | the newest 8 live |
| C 1W | lines (7) | 11: id 5276 solid + 5277 … 5286 dotted | every line of the last bar |
| D 1D | labels / boxes / lines (5 / 3 / 7) | 7 (bars 8466 … 8472, ids 8483 … 8489) / `DB 1`…`DB 6` (ids 1–6) / ids 7–16 | newest 7 / the whole bar-0 burst / the whole bar-0 burst |
| D 1W | labels / boxes / lines | 6 (bars 1752 … 1757) / `DB 1`…`6` / ids 7–16 | newest 6 / whole burst / whole burst |

**Probe D is the rule read directly** — `label.all` before and after each bar's
create (cap 5): 1, 2, … 10, then `10 → 5` on the next create, then 5 … 10 again,
every sixth bar from bar 10. **1,411 cuts on 1D and 292 on 1W, every one of them
exactly 10 → 5**; the count never exceeds 10. The bar-0 bursts (6 boxes at cap 3,
10 lines at cap 7) read 6 and 10 on every one of the 8,473 bars: they never pass
their own trigger (8, 12), so nothing ever collects them. The probe's
instrument check holds: the labels held at the end number D04's last value (7, 6)
and are the newest by id, so `*.all` is the collector's view.

### Hypotheses (letters from the probe headers)

| | rule | verdict | the evidence that decides it |
|---|---|---|---|
| H1 | strict ≤ cap (ours until now) | **refuted** | A/B hold 51–55 at 50; D's `label.all` reaches 10 at cap 5 |
| H2 | trim-then-add, cap + 1 | **refuted** | 55, 54, 9, 8 held |
| H3a | one trim at bar end, last bar trimmed | **refuted** | D: the cut happens INSIDE `label.new` (D03 = 10 before, D04 = 5 after, same bar) |
| H3b | trim at the next bar's start | **refuted** | D03, read at the start of a bar, reaches 10 — no trim ran there |
| H4 | a bar's own creates are spared | **kept, as a clause** | C lines: 11 held at cap 7 on both phases, all from the last bar. Without it the 1W reading is 10 and loses the solid line (the model and the engine both go red) |
| H5 | scope (`if` keeps one more) | **refuted** | A.O3 (in `if`) and B.O3 (global) hold identical bars on both timeframes |
| H6 | sporadic creation keeps one more | **refuted** | A.O2 vs B.O2 differ only by the phase of the count, which the batch rule predicts exactly |
| H7 | `na` coordinates collected differently | **refuted** | A.O1 (na coords on 4 bars of 5) and B.O1 hold the same bars: 8418…8472, 1704…1757 |
| H8 | LIVE count vs ring of created ids | **LIVE** | C labels reproduce id for id counting live objects; a ring model (a deleted label keeps its slot) predicts 5 and 4 against the 9 and 8 held |
| H9 | a `var`-held object is not collected (but counts) | **kept, as a clause** | C boxes: `KEEP-VAR` and `KEEP-SET` survive 8,472 bars at cap 3. "Exempt and NOT counted" predicts 9 on 1D against the 3 held |
| H9b | touched = recent (LRU) | **refuted** | `KEEP-VAR` is never touched after bar 0 and survives |
| H10 | lazy / batched | **kept — the core** | D's sawtooth, and the trigger is `cap + 5`: offsets 0–11 were scanned over all 24 families and only 5 fits every one |

⚠️ **Not separated by these probes, and decided by Pine's evaluation order
rather than measured:** whether `l := label.new(…)` still spares the OLD label in
`l` during that create (we collect before the register is written, so it does).
And "held" means a drawing variable's CURRENT value: an object reachable only
through a register's history (`cl[1]`) IS collected (probe C's labels), while one
held only in an array is unmeasured — probe D's array-held boxes never reach
their trigger, so they cannot tell. We do not spare array members.

### The same rule against the corpus

Ours after the change, id for id against the vendor on the RDDT 1D captures:

| script | family | cap | our creates (uncapped) | TradingView holds | ours now | ids |
|---|---|---|---|---|---|---|
| `contraction-box-doji-lines` | boxes | 50 | 632, one per bar | 50 | 50 | **identical** (576 creates past the first cut ≡ 0 mod 6) |
| `makuchaku039s-trade-tools-fair-value-gaps` | boxes | 50 | 189, sporadic | 51 | 51 | **identical** (133 past the first cut ≡ 1) |
| `ultimate-pivot-points` | lines, labels | 50 | 5,661 each, nine per bar | 51, 51 | 51, 51 | **identical** (5,605 ≡ 1) |
| `multi-timeframe-supply-demand-zones` | boxes | 500 | 504, all on bar 0 | 504 | 504 | **identical** (never passes 505; also the bar's own creates) |
| `sector-rotation` | lines / boxes | 50 / 500 | lines 632; boxes unreachable (C8) | 50 / 504 | 50 / — | consistent, not reproducible: its boxes interleave the id counter, so our line ids are offset |
| `smt-divergence-…` | lines, labels | 500 | unreachable (C9) | 500, 500 | — | consistent (≤ 505) |
| `high-low-open-mid-ranges` | lines, labels | 500 | unreachable (C13) | 504, 504 | — | consistent (≤ 505) |

Every vendor count in all 47 captures is ≤ its cap + 5; none sits below its cap
while we create more. No family that matched before the change moved.

### Grades (harness, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`)

| set | before (`57ae9e7c1`) | after (`c5e63beea`) |
|---|---|---|
| 47 RDDT captures — objects MATCH | 16 / 47 | **19 / 47** (+ makuchaku, ultimate-pivot-points, multi-timeframe S&D) |
| 47 RDDT captures — families agreeing | 175 / 252 | **180 / 252** |
| 8 gc captures — objects MATCH | 0 / 8 | **6 / 8** (D is refused at the door: `pine:collection`, `label.all`) |
| 8 gc captures — families agreeing | 19 / 42 | **42 / 42** |

⚠️ The three 1W gc captures still read DIVERGE overall, on a PLOT, not an object:
`*01_isconfirmed` is 0 on TradingView's last weekly bar (the week was still
forming at capture time) while the capture's `newestBarIsForming` says `false`,
so our side reads 1. That is capture metadata; the object verdict is MATCH on all
six. (The 1W files' own `id` field also says `-1d-`.)

The rail is `app/src/components/chart/engine/__tests__/objectCollector.vendor.test.js`:
the six probe captures id for id, probe D's sawtooth read off the vendor's own
plots, and the runtime lane one clause at a time, each with a control.
Mutation-proved four ways (byte capture + sha-verified restore): the spare-bar
clause removed (2 red), the held clause removed (3 red), `GC_BATCH` 5 → 4 (10
red), the collect call dropped (9 red).

## C13 — user drawing functions the inliner refused (2026-09-29, step 13)

Worked per refusal kind. Census over `corpus/committed` (266), before → after:

| kind | refusals | scripts | outcome |
|---|---|---|---|
| `conditional-history` | 701 → 579 | 20 → 15 | **general fix for bar-invariant guards** (below). Every remaining one sits under a guard that varies (`barstate.islast`, a series comparison, a history read) — the case the refusal exists for, kept |
| `in-expression` | 46 → 46 | 7 | kept, by name. adr's 16 are `array.push(arr, draw_box(…))`: the returned handle of an `if`-bodied helper pushed into a drawing ARRAY (C11), at coordinates that are `request.security` tuples (C10), under `timeframe.change(<input tf>)` |
| `loop` | 27 → 27 | 5 | kept, by name. TSR's six are calls inside `for [i, v] in <array of UDTs / chart.point>` — a loop this reader does not run (C11) |
| `receiver` | 3 → 3 | 3 | not C13's primary scripts; untouched |

**The rule (Pine semantics, measured).** A function's series history advances only
on the bars its call runs, which is why a conditional call that reads history was
refused. A guard built only from inputs and constants holds on every bar or on
none, so under it the call's history IS the every-bar history (or nothing runs).
`objectFnInline.guardIsBarInvariant` is an allowlist that fails closed: a name is
invariant only if it is declared once in the whole tree, at the top level, from
`input.*` (never `input.source`, never a bare `input()`), literals, constants or
pure calls over them, and is never reassigned, destructured or a `for … in`
variable; a guard is invariant only if every token is such an atom. A counted
loop still refuses. Graded: `high-low-open-mid-ranges` inlines all 62 calls and
draws 37 of TradingView's 45 cells, every one a cell TradingView shows.

**The hazard it exposed, and the answer (step 13a).** C7 measured that Pine's
collector cuts a family by COUNT. A create this chart loses still counts on
TradingView's side, so once the collector runs the two sides hold different
objects — `objectLoss.js`'s "a missing object, never an extra one" is false under
the collector. `high-low-open-mid-ranges` makes it concrete: with its helpers
inlined it would hold 504 lines and 504 labels against TradingView's 504 and 504 —
the right counts — while TradingView's lines are five a week (the `vline` divider
included) and ours four. The converter now carries every lost create's family on
the program (`lostCreates`) and the runtime WITHHOLDS a family only when its
collector actually cut it. ⚠️ Not covered, and named: TradingView, holding the lost
objects too, can pass its trigger while our run does not; nothing here can count
creates that never ran.

**What each C13 script still stops on** (refused by name, never drawn approximately):

| script | family | stops on | capture that would settle it |
|---|---|---|---|
| `high-low-open-mid-ranges` | lines (withheld) | the `vline` guard `ta.change(time(higherTF)) and i_v1` — `time(<input tf>)` (C8) | none needed — the rule is `timeframe.change`'s, already measured (§ C8); the reader needs the input-tf spelling |
| `high-low-open-mid-ranges` | labels (withheld) | `higherTF + b + str.tostring(a)` — an `input.timeframe` string in text (C15); `line.get_y1(hline)` as a y (C14) | none — both are value-lane gaps, not unknown semantics |
| `high-low-open-mid-ranges` | 8 of 45 cells | `request.security(…, 'M' / '3M', …)` (C10) | — |
| `trend-lines-supports-and-resistances` | all | `for [i, v] in <array<pointPair>>`, `line.all`, UDT fields (C11) | — |
| `average-day-range-adr-pivots` | lines, boxes | helper result pushed into a drawing array (C11); `request.security` tuple coordinates (C10) | — |

## What is left, ranked by scripts it would move

| rank | class | scripts (primary) | what it needs |
|---|---|---|---|
| 1 | C11 arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus (9) | the collection/UDT grammar in the object lane — the largest single gap, and a design wave rather than a fix |
| ~~2~~ | ~~C12 values or `var` state computed across a multi-statement block~~ — **steps 15–17** | atr-sr **MATCH**; smc 13/18 lines, market-structure 5/6 lines and 18/22 labels with **no wrong object left** | what remains of C12 is the WARM-UP CURTAIN: `accum` is not computable before `PINE_STATE_WARMUP` (250) and an object that reads it there is now withheld (step 17) rather than drawn off a guess. Settling it needs the owner-gated question in `pine.js::PINE_STATE_WARMUP` (a `var` seeded from where a fetch starts), not a fix. `position-size-calc` re-traced to `syminfo.root` (rostered unserved) + C10; `rsi-swing` to C14 (a getter written into `var` state, and getters as coordinates) — neither is C12 |
| 3 | C10 `request.security` in object text/coordinates | artemis, ema-ribbon, linear-regression, vold, liquidity-heatmap (5) | the MTF data seam reaching the object lane |
| 4 | ~~C8 clock builtins: `time_close`, `timeframe.change`~~ — **done, step 9** | liquidation-levels, poor-man, rsmi, adr, htf-footprint (5) | measured and built; none of the five is blocked by it any longer (each now stops on C15, C12, C11/C13) |
| 5 | C9 a history offset that is an expression (`x[bar_index - k]`) | artemis, extrapolated, smt-divergence (3) | deliberately refused by the columnar lane (`pine:offset-literal`); needs the runtime lane or a bounded dynamic-offset node |
| ~~6~~ | ~~C7 vendor GC slack~~ | — | **done** (`c5e63beea`): all three MATCH id for id; see § C7 |
| 7 | C13 drawing functions the inliner refuses (`in-expression`, `conditional-history`, `loop`) | OHLM, TSR (+ adr secondary) (2) | **`conditional-history` under input-only guards: done, step 13** (OHLM's 44 → 0). What remains of C13 is refused by name and each stops on another class — see § C13: OHLM's lines/labels (C8, C15, C14), TSR (C11), adr (C11 + C10) |
| 8 | C8 `chart.left_visible_bar_time` | sector-rotation (1) | not answerable on a bar series (it is viewport state) — a named refusal is the correct end state |
| 9 | C15 remainder (after step 14) — every C15 script now stops on another class | ema-ribbon (C10 MTF cells, C12 `trendBars`/`f_strengthBar` loop), vold (C10), artemis (C9/C10/C11/C12) | named, not built: (a) **v6 `timeframe.period` spelling** — the withheld ema-ribbon cells need the one value three lanes read changed (vendor evidence so far: on a v6 1D chart `timeframe.period == "D"` is FALSE, capture `ema-ribbon-…-2026-09-28` cell (0,9) `   1D`); a capture that prints `timeframe.period` itself on a v6 D/W/M chart settles it. A refinement that serves a branch whose OUTCOME is the same under both spellings (ema-ribbon's `f_tfLabel`: `"D" => "1D"` and default `=> timeframe.period` both give `1D`) would recover (0,5) without it. (b) **a position built by concatenating `input.string`s** (`vold`: `i_tableYpos + "_" + i_tableXpos`) is dropped (`enumUnreadable`, `table.position@15`) and falls to Pine's default `top_right`, which equals the vendor's `pos` at the only value the member door can have (input strings have no knob) — correct today by construction, not built. (c) **artemis' wrong cells are C12's** (see step 13) — the one case in this lane where we DRAW a text the vendor lacks |

