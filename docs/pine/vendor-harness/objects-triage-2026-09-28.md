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
| `artemis-oscillator-pro` | lines 13/0; labels 17/0; cells 21/10; texts | C9 dynamic history offset (`x[expr]`, 14 trees) — **step 22: lines 8/13, labels 8/17, each TradingView's; the rest C12 curtain / C10** | C10 `request.security` (24 cells) — **step 20: the MTF panel's 5 value cells, the vendor's; 15m/1h/4h never shown**, C11 arrays, C15 `position.*` as a value |
| `atr-support-and-resistance` | lines 20/0; boxes 20/0 | C12 values computed in multi-statement blocks (`pine:block`) — **step 15: MATCH, id for id** | C11 arrays |
| `average-day-range-adr-pivots` | lines 2/0; boxes 2/0; cells 4/2; cell text | C13 drawing functions called inside an expression (`fn:in-expression` ×16) | C8 `timeframe.change` (32), C11 drawing arrays, C16m `table.merge_cells` |
| `dual-view-htf-candlestick-patterns-theultimator5` | no drawing program (436 held) | C11 arrays of drawings written in blocks | C12 |
| `ema-ribbon-trend-filter-strixedge` | cells 48/34; cell text | C10 `request.security` in cell text (54 trees) | C15 `str.tostring` form, `size.*`/`position.*` as values |
| `extrapolated-pivot-connector` | no drawing program (6 held) | C9 dynamic history offset (`n[n - a1 + length]`) — **step 22: MATCH** | C1 plot titles HTML-escaped; C6 comma-separated statements (`label.delete(a[1]),label.delete(b[1])…`) |
| `heat-map-seasons` | tables 1/8; cells 31/24; cell text | **C4 table re-created every bar — TradingView keeps one per position; we refuse at 8** | **C5 `\n` escape** |
| `high-low-open-mid-ranges` | lines 504/0; labels 504/0; cells 45/1; texts | C13 `fn:in-expression` (19 drawing-function calls) — after C6 these were `fn:conditional-history` ×44 under input guards; **inlined, step 13** (cells 45/37; lines/labels withheld, § C13) | C7 GC slack (500→504); C8, C10, C14, C15 (§ C13) |
| `htf-candle-footprint-cartel-console` | lines 6/0; labels 6/0; boxes 13/0; cells 2/1; texts | C8 `timeframe.change` (48 trees) | C11 |
| `htf-liquidity-dashboard-tfo` | lines 6/0; cells 30/3; texts | C11 UDT fields (`s0d_highs.size` …) | C12, C13 `fn:conditional-history` |
| `ict-ipda-look-back` | lines 3/0; boxes 6/0; tables 1/8 | **C4 — the run REFUSES at bar 8 (`more than 8 live table objects`) and stops stepping, so every line and box is lost** | — |
| `ict-killzones-pivots-tfo` | cells 3/1; cell text | C11 UDT/arrays (`kz1._box.size` …) | C13 |
| `institutional-smc-order-flow-matrix-pro` | lines 18/27; labels 34/43; boxes 2/0 | C11 arrays of boxes + lost deletes (`guard:delete` ×2 → extra lines/labels). **By `b27e0e9e6`: lines 18/0, labels 34/16; step 16: 18/13 and 34/29, the 13 lines TradingView's last 13** | C9; C12 warm-up curtain (the 5 missing breaks are all before bar 250) |
| `k-clustering` | lines 9/0; cells 8/5; cell text | C11 UDT/array (`n_clust.get`, 120 trees) | — |
| `linear-regression-channel-…-existing-trend-lines` | lines 5/0 | C10 `request.security` (create:line ×5) — **step 20: MATCH, id for id** | — |
| `liquidation-levels` | no drawing program (10 held) | C8 `time_close` (40 trees) | C15 `str.format` (20) |
| `liquidity-heatmap-nephew-sam` | labels 27/0; label text | C10 `request.security` — every pivot the labels sit on is a `request.security(…, getPivotData(…))` tuple; the `pine:function-def` refusal the census records is `getPivotData` reached THROUGH that call (corrected after reading the source; first filed as C17) | C5 |
| `liquidity-pools` | lines 182/0; labels 91/0; label text | **C2 the object lane never receives `newestBarIsForming`, so `barstate.isconfirmed` is `na` in every object tree and `swing_h` never fires** | **C3 `linefill.new` on the same two lines REPLACES (vendor 91 fills = 182 lines / 2; ours evicts through 500)**, C9 |
| `makuchaku039s-trade-tools-fair-value-gaps` | boxes 51/50 | C7 GC slack (vendor holds ids 139..189 = newest 51 of 189 at default 50) — **fixed, step 9: MATCH** | — |
| `market-structure-by-leviathan` | lines 6/133; labels 22/133; label text — **by `b27e0e9e6` already 6/5 and 22/21 (the over-draw was gone), and one of the 21 was WRONG: "LH" at 230.41 where TradingView says "HH"** | C12 `var` state reassigned inside `if` blocks (`prevHigh` "nothing updates") → guards dropped, remaining creates over-fire. **Step 15: the wrong word came from reading `prevHigh`'s warm-up `NaN` as Pine's `na`; now withheld — 5/6 lines, 18/22 labels, every one TradingView's** | C12 warm-up curtain (`PINE_STATE_WARMUP`, owner-gated) |
| `momentum-volatility-scanner` | cells 12/11; cell text | C16m `table.merge_cells` unsupported | — |
| `multi-timeframe-supply-demand-zones` | boxes 504/500 | C7 GC slack (all 504 created on one bar; vendor keeps all 504 at max 500) — **fixed, step 9: MATCH** | C13 |
| `options-max-pain-calculator-backquant` | lines 10/0; labels 8/0; boxes 13/0; cells 16/11; texts | C11 arrays + `while` loops in functions (loop-blocked `box.new`/`label.new`/`line.new`) | C5 |
| `poor-man039s-volume-profile` | labels 40/0; label text | C8 `time_close` (160 trees → 159 `update:props`, 40 `create:label`) | C12 `pine:reassign` |
| `position-size-calc` | cells 10/0; cell text | C12 block-computed cell text (`guard:cell` ×10). **Re-traced 2026-09-29: NOT C12.** All ten cells sit under `if barstate.islast and not ignored_list(syminfo.root)`, and `syminfo.root` is ROSTERED UNSERVED (`symbolScope.json::unserved`, ruled 2026-09-15, item (h)) — `syminfo.root != "VIX"` alone drops the cell, `barstate.islast` alone converts it | C10 (`Lots` reads `userate`, which is `request.security`); the vendor's `Profit`/`Pos. Size` read "NaN" (0/0 at the default inputs) |
| `position-size-calculator` | labels 4/50; label text | **C6 comma-separated statements: `var l = label(na), label.delete(l), l := label.new(…)` keeps only the LAST statement — the `var` and the `delete` vanish, so labels accumulate to the cap** | **C5 `\n` escape** |
| `pro-trading-art-double-top-bottom-with-alert` | lines 7/0; labels 14/0; label text | C11 UDT (`top.first`) | — |
| `reverse-stochastic-momentum-index-on-chart` | no drawing program (1 held) | C8 `time_close` | — |
| `rsi-swing-indicator` | lines 11/0; labels 11/0; label text | C12 `var` state reassigned in blocks (label guards truthy 0/632). **Re-traced 2026-09-29: the guards now resolve; what drops every create is C14** — each label's `text` is `obLabelText()`, which reads `last_actual_label_hh_price := label.get_y(labelll)` (a getter written into `var` state), and each line's `x2`/`y2` is `label.get_x/get_y(labelll)` (a getter in a coordinate). Measured with a byte-restored capture on `valueRef`: 4 label `text`, 2 line `x2` | C13 (`label.new` returned from an `if` inside `createOverBoughtLabel`) |
| `sector-rotation` | boxes 504/0 | C8 `chart.left_visible_bar_time` (viewport-dependent — not answerable on a bar series) | C7 |
| `smt-divergence-ict-01-…` | lines 500/0; labels 500/0; label text | C9 dynamic history offset (`low[bar_index - x]`) — **served by step 22**; now stops on C10 | C10 `request.security(input.symbol XAUUSD)` in every guard |
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
| C9 | a history offset that is an expression (`x[bar_index - k]`) | artemis, extrapolated, smt-divergence | **done, step 22** — an input-derived offset folds (artemis), a per-bar offset is the object runtime's bounded read (extrapolated MATCH); smt stops on C10 |
| C10 | `request.security` in object text/coordinates | artemis, ema-ribbon, linear-regression, vold | large — needs the MTF data seam |
| C11 | arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus | large |
| C12 | values or `var` state computed across a multi-statement block | atr-sr, market-structure (position-size-calc and rsi-swing re-traced to `syminfo.root`/C10 and C14) | **done, steps 13–15**, down to the owner-gated warm-up curtain |
| C13 | user drawing functions the inliner refuses (`in-expression`, `conditional-history`, `loop`) | adr, OHLM, TSR | medium, per refusal kind |
| C14 | object getters in a coordinate, a text or `var` state | (secondary) rsi-swing, ultimate, trend-duration, OHLM, PTA | **step 21** — served where exact; what remains stops on C12 (read before write), C11, C15 — § C14 |
| C15 | text builtins / constants in value position (`str.format`, `size.*`, `position.*`) | (secondary) | **done, step 14** — liquidation-levels, rsmi MATCH; the rest stop on C9/C10/C11/C12 (What is left, rank 9) |
| C16m | `table.merge_cells` (relabelled 2026-09-29 from C16, so that C16 names the lane below) | momentum-volatility-scanner | **done, step 8** |
| **C16** | a script that EDITS ITS OWN LIST OF DRAWINGS — `array.size` of a drawing list in a guard or loop bound, `box.delete(array.shift(bs))`, `b = array.get(bs, i)` in a loop, `array.remove` in a loop body, getter guards inside loops — which the host/object reader refused, plus two semantics under them (a deleted drawing keeps its list slot; an `if` is evaluated once) | institutional-smc (boxes), dual-view (its list loops; stops on C11/C12 first) | **done, step 19** — see § C16; `while` loops and numeric-array loops stay refused by name |
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
| 8 | C16m `table.merge_cells` carried (reader → runtime → render state → DOM `colSpan`) | `554f78d85` | 16 / 47 | 175 / 252 | `momentum-volatility-scanner` 5/7 → **7/7 MATCH** (cells 12/12 — the covered (1,0) cell is held, empty, as the vendor holds it); `average-day-range-adr-pivots` cells 2 → 3 of 4 (its merged cell reads now; the missing cell is the one `cell:text` drop the census records — not traced further) |
| 9 | C7 the object collector is batched (`cap + 5` → `cap`, sparing the bar and `var`-held objects) | `c5e63beea` | 19 / 47 | 180 / 252 | `makuchaku039s-…` 6/7 → **7/7 MATCH** (boxes 51/51), `ultimate-pivot-points` 4/7 → **7/7 MATCH** (lines 51/51, labels 51/51), `multi-timeframe-supply-demand-zones` 6/7 → **7/7 MATCH** (boxes 504/504) — all three id for id; `contraction-box` stays MATCH at 50; no other family moved. The 8 probe captures: 0/8 → 6/8 objects MATCH, 19/42 → 42/42 families (D is refused at the door) |
| 10 | C8 `time_close`, `time_close("D")`, `timeframe.change("D"/"W"/"M")` as clock columns (`timeclose`, `dayclosetime`, `weekfirst`, `monthfirst`; measured on the `vw-clock-close-tfchange` probe) | `dff023f59`, `445900da7`, `3fb5093f8` | 16 / 47 | 175 / 252 | `poor-man039s-volume-profile`'s 40 labels converted at `dff023f59` and were drawn with EMPTY text (their text is built in a `for` this chart cannot fold, C12; TradingView shows `####…`) — briefly 176/252 on a count that was drawn wrong. `3fb5093f8` withholds any object whose text a lost setter writes and refuses a block local the reassignment overrule condemned, so the labels are counted, not drawn: its sentence reads 240 of 246 (was 199). The same fix stops `artemis-oscillator-pro` drawing an empty cell (25 → 26 of 38) and `sonarlab-order-blocks` placing boxes at `bar_index[0]` (still refused, now `pine:no-output`). No C8 refusal remains in any of the five scripts' object programs; each now stops on another class: `liquidation-levels` C15 `str.format` (40 trees), `reverse-stochastic-momentum-index-on-chart` a text feature (14), `average-day-range-adr-pivots` C11/C13, `htf-candle-footprint-cartel-console` C12 (`startBar`, 48). Attach status unchanged for all 266 corpus scripts, both flag states |
| 11 | C8 early closes and holiday weeks: `time_close` / `time_close("D")` read the session close as TradingView's calendar applies it (`market_calendar.json` extended to 2000, vendor view derived in `tradingview_session`) | `f37825c96` | unchanged | unchanged | none on the 47 (no graded script reads a close on an early-close day). Probe rows K01/K02/K03/K12/K13: 1D 13/13/13/26/13 → 0; 60m 13/52/13/26/52 → 0. Against master `9f9d60b4b`: 47-capture verdicts (211 entries), the committed harness dir (87 captures, 349 entries) and the member-door census (38 / 61 of 266 attach) all 0 changed |
| 12 | Q-T1 widened: date-keyed W / M bars read their period's first vendor session (M UNMEASURED); the harness keys W by the product's Friday | `6caad1725` | unchanged | unchanged | none on the 47 (all 1D). Probe W rows through the door: K01/K02/K03/K08/K13 1,758 → 0, K04/K05/K06/K07/K12/K16 1,757 → 0. Plot-column census, every attaching corpus script (61) on SPY 1D and 1W bars, master vs tip: 252 columns each; 1D 0 changed; 1W 2 changed, both in `support-and-resistance-multi-time-frame` (`security(…,'M',…)` on a weekly chart: Resistance Monthly 245 bars, Support Monthly 9) — caused by the harness now feeding the product's FRIDAY key, not by the clock: the MTF resampler groups a week that straddles two months by its key day, so a Friday key files it in the later month. That is what the product already does; whether TradingView does it is unmeasured (no W capture of an MTF-monthly script) |
| 13 | C13 conditional-history: a drawing helper called under a guard built only from inputs and constants inlines (`guardIsBarInvariant`) — the call runs on every bar or none, so its history is the every-bar history. With it, C7's collector made a new hazard visible, closed first: a family the collector CUT while the program lost creates of it is withheld (`program.lostCreates` → `objectRuntime` `withheld`) — see § C13 | `91255467d` (withhold), `a42bb977c` (inline) | 18 / 47 → 18 / 47 | 169 → 167 (of the 238 families the instrument records on both sides; measured at base `b27e0e9e6`, whose table read 18 / 47, not step 9's 19) | `high-low-open-mid-ranges`: `fn:conditional-history` 44 → 0; cells 13 → 37 of 45, every one a cell TradingView shows (the other 8 are `request.security` 'M'/'3M', C10); lines 504/504 and labels 504/504 would have been the right COUNTS of the wrong objects (TradingView holds five lines a week, ours four) — withheld. The two families that dropped were coincidences, now withheld: `sector-rotation` lines 50/50 → 50/0 (TradingView holds two per bar over 25 bars, ours one per bar over 50) and `htf-liquidity-dashboard-tfo` labels 6/6 → 6/0 (two were drawn BLANK where TradingView shows `PDH`/`PDL`; the text setters the inlined helper holds sit behind unreadable guards). Corpus: conditional-history refusals 701 → 579 (20 → 15 scripts). Committed harness dir 87 entries: 3 changed, exactly those. Member-door census 266 × 2 flag states: 0 rows changed |
| 14 | C15 string/value forms in object text and props: `str.format` in a text (patterns compiled at translate time; `{N}` and `{N,number,#.##}` read off `liquidation-levels`' own labels and the w3-format probe; everything no capture pins refused by name or withheld at run time); a `switch` in a text/enum position read as the `if` chain a ternary produces (default-less only over an `input.string` whose options every arm covers); `syminfo.ticker` as text; a v6 text whose branch flips on how `timeframe.period` is spelled WITHHELD (`textFormatRefusals 'timeframe.period:v6-spelling'`); `openName` asked for one hop, not the text depth; a helper called inside an inlined helper served by substitution; a work bound on the text reader (`TEXT_WORK_BUDGET` 4096, `textTooLarge`) | `51acf1490`, `8a9ce291f`, `2473127d2`, `8e18fc483` | 18 → 20 / 47 (harness `summ.py` over `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base `b27e0e9e6`) | 169/238 → 183/252 (the denominator grows because two scripts that had no program now have seven families each) | `liquidation-levels` no program → **7/7 MATCH** (10 labels, texts e.g. `+5x: 120.426`); `reverse-stochastic-momentum-index-on-chart` no program → **7/7 MATCH** (its one info-box label, character for character and by id); `artemis-oscillator-pro` cells 9 → 13 of 21 (three tables where the vendor's `pos` says, MTF labels `15m`/`1h`/`4h`/`1D` match; its four WRONG cells `0%`, `29 ▼ BEAR`, `↓-3`, `◈ NEUTRAL` predate this and are C12 — `float knnVal = 50.0` reassigned inside `if kSize >= knnK`, read at its declaration); `ema-ribbon-trend-filter-strixedge` `onlyOurs ['NaN'] → []` (footer reads `RDDT`), every `text_size` = vendor `small`, cells 34 → 33: the two `timeframe.period` cells are withheld — at base we drew `► 1D` in BOTH (0,5) and (0,9) where the vendor drew `► 1D` / `   1D`, so one right cell is lost with the wrong one. Whole committed harness dir (120 graded, 82 inventory): the same 4 entries change, 0 plot changes, overall MATCH 34 → 36. Member-door census, 266 scripts × both flags: attach 38/59 unchanged; `drawsObjects` false → true for `liquidation-levels` and `rsmi` only. `screener-mean-reversion-channel` now names its lost label `textTooLarge steps>4096@488` (same drops as base, now counted by name) |
| 15 | C12 an `if` used as an expression with no `else` is a value; its missing branch is `na` (only for a proven number — v5/v6 disagree on bool) | `f7564f5da` | 19 / 47 | 171 / 238 ᵃ | `atr-support-and-resistance` → **MATCH, id for id** (lines 20, boxes 20, one interleaved counter); the capture decides the fallthrough — `else 0` draws more boxes than TradingView. Census 38/59 → 39/60 attach (implied-volatility-suite; cppivot moves `pine:block` → `pine:request`) |
| 16 | C12 a `var` read through `ta.crossover` / `[k]` inside its own update folds (`y[1]` of a variable is last bar's `self`) | `4ae19a95d` | 19 / 47 | 171 / 238 ᵃ | `institutional-smc-order-flow-matrix-pro` lines 0 → 13, labels 16 → 29 (vendor 18 / 34): the 13 are TradingView's last 13 in order, level and kind; the 5 missing all break before bar 250 (the warm-up curtain) |
| 17 | C12 an op that reads a `var` on a bar where its value DEPENDS on the not-computable warm-up prefix is withheld, not drawn off a `NaN` read as Pine's `na` — measured per bar by two probe runs (`objectColumns.unknownMask`) | `911348fba` | 19 / 47 | 171 / 238 ᵃ | `market-structure-by-leviathan` labels 21 → 18, lines 5 (vendor 22 / 6): the removed "LH" at 230.41 was WRONG (TradingView: "HH"); every object still drawn is TradingView's last 23 of 28, in order, word and level. A static horizon was measured and rejected (it withheld all 5 correct BOS lines and a line of a MATCH). Harness dir: 1 capture changed, inventory identical; census unchanged |
| 18 | C11 arrays / UDTs / methods, **runtime front end only** — a script's own `method` binds (`recv.m(a)` → `m(recv, a)`, single-declaration only), the array members the nine scripts write (`first/last/shift/pop/unshift/remove/concat/indexof/includes/max/min/sum/avg`), and a function body READS a main-program variable (`LOAD_GLOBAL_LOCAL/PERSIST`, opcodes 93/94) — see § C11 | `8009fce4e`, `b5924ca44` | 18 / 47 → 18 / 47 (runtime flag on: 19 → 19) | 167 / 238 → 167 / 238 (runtime flag on: 174 / 245 → 174 / 245) | **none, measured.** All nine C11 scripts attach on the HOST lane, so the runtime pane route never engages for them, and the runtime OBJECT lane (`runtime/objectLane.js`) is wired to no product path. The changes are real and railed but move no graded family. Against base `1a11a652b`, both runtime flag states: 47 captures 0 entries changed, committed harness dir (120 captures) 0 changed, member-door census 266 × 2 objects-flag states 0 rows changed (control: the runtime flag itself moves 4 census rows and 1 capture at the same tree, so the diff can see a change). `runtime:function-global-state` is gone from the object-lane peel of max-pain, dual-view and vdubus; each now stops on a host-lane wall |
| 19 | C16 a script that edits its own list of drawings — (a) a drawing collection keeps its slots (a delete or the collector never splices it; an `na` push is a slot); (b) `array.size` of a drawing list is object state the runtime answers, in a guard, a loop bound and a slot index; `box.delete(array.shift / pop / remove(bs))` is the delete AND the slot removal; `b = array.get(bs, i)` is an eager copy into `b`; a `get`/`size` comparison in a counted loop body is read per iteration; a loop whose END bound reads a length its body changes is refused; a list that lost a change is withheld from every read (`coll:diverged`); (c) an `if`'s object-state condition is LATCHED — evaluated once where it stands; an `input.string` default is the text a drawing carries — see § C16 | `bbf933ad5`, `e240eea43`, `b1ea4351e`, `d6b93d9e5` | 21 / 47 → 21 / 47 (base `105ea5f3d`) | 183 / 252 → 184 / 252 | `institutional-smc-order-flow-matrix-pro` boxes 0 → **2 / 2**, and every object we hold is TradingView's — creation order, price, caption and x rank (§ C16); `options-max-pain-calculator-backquant` cells 11 → 12 of 16 (the new cell, "Advanced", is TradingView's own — an `input.string` default; nothing drawn the vendor lacks). Committed harness dir (87 captures): the same 2 entries change, inventory and every plot verdict identical. Member-door census, 266 × both flags: 3 rows — `rsi-horizontal-resistance-levels` ATTACHES with the flag on (60 → 61 of 266), drawing its bounded eviction whole; its flag-off refusal becomes the clean-program sentence; `fair-value-gap` stays refused, its lost removal re-worded. Census build 46.3 / 53.4 s base vs 49.2 / 49.5 s (alternated); object lane over the 36 drawing captures 10.9 / 10.0 s base vs 10.6 / 9.3 s — no slowdown. Notebook first-open bytes on the current integration tip: 2,260,725 B of 2,260,793 |
| 20 | C10 `request.security` feeding object text / coordinates / cells — **no new seam: the object pass already resolves through the plot lane's `Resolver`, so `securityAsNode` reaches it.** What stopped the C10 scripts was requests that Resolver could not read: a timeframe toggle whose test is a constant EXPRESSION (`TF_Choise == false ? …`, both lanes, `constantBranchOf`); in the OBJECT pass only (`Resolver.objectPass`), a dead ternary / `and`/`or` side that refuses is skipped when the test folds on every bar (text and colour readers too), and timeframe readers follow 16 hops, not 4; and, both lanes, a `timeframe.*` read inside a request at ANOTHER timeframe refuses by name instead of folding to the chart's own — see § C10 | `cefe12633`, `469177d5b`, `2b73a9ebf` | 21 → 22 / 47 (harness `summ` over `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base `105ea5f3d`) | 183 → 184 / 252 | `linear-regression-channel-…-existing-trend-lines` lines 5/0 → **5/5, MATCH id for id** (ids 4418–4422, both y's within 1e-9 rel, styles, `time[100]`/`time` bar times; its two linefills 0 → 2 = vendor 2); `artemis-oscillator-pro` cells 13 → 18 of 21, the five new ones the vendor's (`◮ MIXED`, `— n/a` ×3, `▼ BEAR`), none drawn the vendor lacks. Committed harness dir (87 graded, 0 inventory): objects MATCH 42 → 43, overall MATCH 34 → 35, exactly those 2 entries changed. Member-door census 266 × 2: attach 39/60 unchanged; 1 row changed — linear-regression with the flag OFF moves from `pine:objects-only` to the clean-objects-only sentence its siblings already carry. `tools/corpus_metric.json` host_ok 51 → 52 (the same script) |
| 21 | C14 drawing getters answered by the object runtime where Pine reads them — a name every write of which is a bare getter (`x := label.get_y(l)`, block local `x = l.get_x()`) becomes a scalar written by a `setnum` op AT ITS STATEMENT'S PLACE in the bar and read as `{v:'num'}` (a whole coordinate, a guard operand, a text `if` operand); a bare getter as a whole coordinate is `{v:'get'}` read at the op (in an inlined body only on the body's own handle). Refused by name: a getter inside arithmetic, a getter's history, a scalar also written another way, a getter on state this program lost or the runtime could make unknowable (`state:lost` — a lost setter, create or handle; a handle written off a recurrence the warm-up curtain may withhold). A handle a delete empties reads `na` (the runtime empties the register) — the reading C16 serves (step 19). Two walls found on the way and closed: the handle an `if … else` helper returns is copied per arm; a name read ABOVE its own later write in the bar is refused by name (`readBeforeWrite`) — the object pass read it at its END-OF-BAR binding. See § C14 | `59311bb64` + merge onto wave 4 (`e32ad85fd`) | 22 / 47 → 22 / 47 (against the wave-4 tip) | 185 / 252 → 181 / 245 | **none moved to MATCH, measured** — see § C14. `pro-trading-art-double-top-bottom-with-alert` DIVERGE (lines 7/0, labels 14/0) → door refusal: its only surviving steps were `topLine.get_y2()` crossings on a line family with lost creates (the tuple helper, C11) — a getter on a handle this program never fills; it attached an empty pane whose four agreeing families were 0/0 coincidences. Committed harness dir: 1 changed (the same; 40/82 MATCH unchanged). Member-door census 266 × 2: 2 rows (the same script, both flags); attach on 61 → 60. Measured against the wave-4 tip after the merge |
| 22 | C9 a history offset that is an expression — an input-derived offset folds like a window (and a pivot's bar counts), an object op reads a `var` at its own statement, and a per-bar offset `x[e]` is read by the object runtime (`{v:'at'}`, bounded by the declared `max_bars_back`) — see § C9 | `d1926c463`, `405dcd309` + merge onto C14 (`aa1d1dd62`) | 22 / 47 → **23 / 47** (overall 18 → 19; against the C14 tip) | 181 / 245 → 188 / 252 (extrapolated gains its seven) | `extrapolated-pivot-connector` no program → **7/7 MATCH** (2 lines, 4 labels, every y and bar TradingView's); `artemis-oscillator-pro` lines 0 → 8 of 13, labels 0 → 8 of 17 — the vendor's last 8 of each, value for value; `smt-divergence-ict-01` unchanged (stops on C10). Committed harness dir (120 captures): the same two, objects MATCH 44 → 45, overall 43 → 44. Census 266 × 2: attach 39 / 60 unchanged, `drawsObjects` false → true for extrapolated; `order-block-finder` and `pivot-high-low-points` refuse at their next wall. The merge unified C9's per-statement env with C14's `topPos` stamp (one stamp); C14's `readBeforeWrite` now refuses only a write later in the op's OWN top-level statement. `rsi-swing-indicator` unchanged by the merge |
| 23 | C12r (ONE positional mechanism since the merge onto C9: this one survives and C9's `baseFor`/`envAfterTop`/`rootLines` are deleted — it reads C9's case, a write in a LATER statement, identically, and adds the statement-START binding for a read above a same-statement write and places an inlined body's reads at the call) a name read ABOVE its first write of the bar binds to last bar's end value (`accum(…)[1]`) — the walk logs each name's binding at every statement start (`envLog`), an op reads a name at its statement's START (every same-statement write follows the read) or END (every write precedes); a START binding of a `var` goes through the plot lane's `partialStateRead`, one rule for both lanes; a read in an inlined body is placed at its call. Still refused by name (`readBeforeWrite`): one op reading a name both before and after a write in ONE statement. Work bound: `structuralMaps` (JS + Python) treats a recurrence body's own `self` as bound, `runRecurrence` evaluates each shared spine node once per step (compiled; Python memo), the object pass interns identical subtrees across trees — rsi-swing's object pass 388 s → 0.68 s on 632 bars, same objects; per-recurrence work is now steps × distinct spine nodes, steps under the existing `MAX_RECURRENCE_STEPS`. Also: a `tf`/`sym` child read gets its own `crossMemo` scope (a shared node answered a weekly child with the chart's column — 4 columns on a forced V2 read-back of the corpus at master, 0 after), and C14's open item — a list `statePass` diverges reruns the C16 pass to a fixed point | `2f63c8737` + merge onto C9 (`f04ccffa7`) | 23 / 47 → 23 / 47 | 188 / 252 → 188 / 252 | **none moved, measured**: `rsi-swing-indicator`'s guards now read Pine's value, and its next wall is `state:lost` (12) — its handles are written off `accum` guards the warm-up curtain withholds, so a getter on a label created before bar 250 is unknowable. Measured with that refusal lifted (probe only): 8 labels / 8 lines, every y and x TradingView's last 8, but the first two label TEXTS and the first line's x2/y2 read pre-curtain labels and are wrong — the refusal is right. What would settle it: a per-bar, per-property register taint in `objectRuntime` (a register a withheld op would write is unknown until a known write), which would serve TradingView's last 6 labels / 7 lines. Against `f04ccffa7`: 47 captures, committed harness dir (82) and member-door census 266 × 2: 0 changed (extrapolated MATCH, artemis lines/labels 8/8 kept) |
| 24 | C11 on the HOST object lane (C11b) — (a) **folded into step 23's one positional mechanism**: a top-level name is read at the op's own position by the base (`bindingAt`, the walk's `envLog`), and a block's own statements are entries in the op's block scope in program order, so a write INSIDE the op's own statement is read where it stands — the op starts from the statement's START binding, a read below an in-block write sees the write (the block's `foldStatements` record), a guard is read in the scope its `if` stood in, and an `else` arm never sees the `if` arm's writes; the one-op read-before-AND-after case step 23 refused is now read at each position. A block's exact per-statement record wins over the reassignment overrule; only an approximate (re-folded) record keeps the condemnation. (b) a `var` NUMERIC array that one statement fills and a numeric cap keeps short is read as the series it is — slot j, newest first, is `ta.valuewhen(cond, value, j)` (`arrayWindows.js`), and `size`/`get`/`first`/`last` read through it; (c) a list of drawings carries `unshift` as a front insert — see § C11b | `c1e485959`, `22be3c546`, `13edcefd8`, `c7fdaf10b`, the merge onto step 23 | 23 → 24 / 47 (base `de76a569e`, objects pane on) | 188 → 193 / 252 | `ict-killzones-pivots-tfo` **MATCH** (cells 3/3 at TradingView's own addresses, pinned by `vendorHarness.c11bKillzones`); `htf-liquidity-dashboard-tfo` lines 6/0 → **6/6** and labels 6/0 → **6/6, id for id** (lines 1262–1267 at the vendor's prices; labels 1–6 with `PDH`/`PDL` at the last bar's levels; `vendorHarness.c11bHtfLiquidity`), its cells 3/30 unchanged (the other symbols' rows, C10). Committed harness dir (87): objects MATCH 44 → 45, families 244 → 249 of 308, overall 36 → 37; the same two entries changed. Member-door census 266 × both flags: 39 / 60 → 39 / 60, **0 rows changed**. On the way it closed a wrong-drawing class live on the member door (a drawing read a name's DECLARATION, never its reassignment — shipped as a hotfix: `c1e485959` cherry-picked onto the wave-3 re-land, master `f00cc9065`). Notebook first-open bytes 1,868,509 B of 2,260,793 (PASS) |
| 25 | C12w the listing seed (ruling R-W): a series the caller proves starts at the symbol's first-ever bar (`historyFromListing` — the chart from the listing date, the harness from `history.startsAtBar0`) runs a translated `var` from bar 0 over the whole series and lifts the curtain wherever EVERY bar-0 reading the tree admits agrees; a mixed `var` with a real initializer is marked (`-(0 / 0)`) so its bar 0 is never guessed — see § C12w | `40409a06c`, `262744ef0`, `17e030314` + merges onto C12r (`98d3f6a47`) and C11b | 24 / 47 → **26 / 47** (overall 20 → 22; harness `summ` over `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base `6d6b95d74`; the same four entries moved against `f04ccffa7` and `37fa2c49d`) | 193 / 252 → **200 / 252** | `market-structure-by-leviathan` 5/6 lines, 18/22 labels → **MATCH, id for id** (what the curtain withheld were TradingView's first creates); `institutional-smc-order-flow-matrix-pro` 13/18 lines, 29/34 labels → **MATCH, id for id** (the five early BOS/CHoCH pairs C16's rail recorded as withheld are drawn, and its id offset of 10 is gone); `artemis-oscillator-pro` lines 8 → **13 of 13** at TradingView's levels, labels 8 → 13 of 17 (the four left are `guard:create` door drops, not the curtain); `trend-duration-forecast-chartprime` HMA plot DIVERGE (138 colour bars — `var trend` read off the prefix) → **MATCH** on all 632 bars. Nothing drawn the vendor lacks. Committed harness dir (82 entries): exactly those 4 changed, inventory identical. Member-door census 266 × 2: **0 rows changed** (attach 39 / 60). Corpus trees: 0 of 299 moved by the seed mark |
| 26 | C17 a per-bar, per-property REGISTER TAINT in the object runtime (`objectRuntime.js` `regTaint`): an op withheld on a bar (the curtain, an unknown `x[e]`, or a tainted read) marks what it would have written — a register, a scalar, an object's properties, a list, a cell, a latch, a `var` initialiser, a crossing's carried pair; an op whose guard / handle / address / loop bound reads a mark is withheld and marks its own outputs; a property whose VALUE reads a mark lets the op run and marks that property; a clean write clears it; an object still marked at the end is held, counted and not drawn. Keyed on "unknown at this bar", never a bar number. The converter's blanket recurrence rule (`state:lost` on any handle written off a recurrence) is removed. And `unknownMask` could not see an EQUALITY against the state (`laststate == 1` is false for `NaN` and ±1e12 alike): a tree is now also probed at every finite literal an `==`/`!=` compares. Artemis' four `guard:create` are traced and NAMED (`objectDiagnostics.guardRefusals`), not served — see § C17 | `140a09b34`, `c3799d00e`, `67290fdd1` + merges onto wave 4 (`1352761f1` over `6d6b95d74`; the C12w merge over `5f3e9eb28`) | 26 → **27 / 47** (overall 22 → 23; base `5f3e9eb28` = C12w, objects pane on) | 200 / 252 → 207 / 259 (rsi-swing gains its seven) | `rsi-swing-indicator` door refusal (`pine:no-output`, its program refused `state:lost` ×12) → **7/7 MATCH, id for id** — composed with step 25: the capture starts at the listing, so the curtain lifts, no mark forms, and all 11 labels / 11 lines are TradingView's (ids 1–22, y, word, placement; the first line's `na` y2 included). **Behind the curtain** (any chart that does not start at the listing; measured with the listing fact withheld) it draws **6 labels / 7 lines and every one is TradingView's** — its last 6 and last 7, value for value, creation order, x mapped one-to-one onto the capture's dense ranks — and the 2 labels and 1 line made off pre-curtain labels are made (ids stay TradingView's order) and held undrawn (`vendorHarness.c17RsiSwing`, both cases). `artemis-oscillator-pro` unchanged, still no wrong object. Committed harness dir (115 graded, 82 inventory): objects MATCH 45 → 46, overall 44 → 45, families 235 / 287 → 242 / 294, only rsi-swing changed. Member-door census 266 × both flags: attach 39 / 60 → 39 / **61** (rsi-swing, flag on); its flag-off refusal becomes the objects-only sentence its 11 siblings carry; 0 other rows. `tools/corpus_metric.json` host_ok 54 → 55 (the same script). Census build 42.5 / 42.1 s base vs 42.2 / 46.8 s (alternated); the object-lane corpus censuses ~8% slower (11.6 → 12.5 s alone — the extra equality probes). Re-measured against `756990d76` (master into wave 4): the same single entry on the 47 and the harness dir, the same two census rows. Notebook first-open bytes 1,868,658 B at base and after (+0; budget 2,260,793, PASS). `paramIds.test.js` green, no re-pin |
| 27 | C11c — the object-lane residuals C11b left refused, on the same host reader: window **reductions** (`max`/`min`/`sum`/`avg` in Pine index order, `indexof`) and a **pick** for a slot whose place depends on a value (a series index; `first`/`get` of a growing push window); a window handed to a user function (the call frame is followed); the script's own one-expression **read methods**; a block `var` with a literal seed is one program variable (siblings renamed); a destructure the block folder cannot bind condemns its own names, not the block; `x := y` between handles and a tuple of returned handles are **register copies**; a START read of a `var` whose later reassignment did not fold **refuses** instead of reading its seed. ⛔ A reduction over an `na` element / an empty window, or `indexof` of `na`, is unmeasured: every step reaching it is **withheld on that bar** (`op.withhold`), counted — see § C11c | `33453ebf9`, `1d94948c8` + the merge onto C17 (`b2a86824e`) | 27 → **28 / 47** (overall 23 → 24; base `b2a86824e` = C17, objects pane on; first landed 24 → 24 against `6d6b95d74`) | 207 / 259 → **214 / 266** | `pro-trading-art-double-top-bottom-with-alert` door refusal → **MATCH, id for id** — composed with step 25: the capture starts at the listing (`startsAtBar0`), the curtain lifts, and all **7 lines / 14 labels** are TradingView's (ids from 1, order, price, caption, x ranks). **Behind the curtain** (listing fact withheld) it draws 6 of 7 lines and 12 of 14 labels, every one TradingView's, at an id offset of 3 — the first double top (bar 208) reads `lastStart` inside the curtain and is withheld (`vendorHarness.c11cPta`, both cases). Composed with step 26: a step withheld on an unmeasured reduction now marks everything it would have written through C17's `taintOutputs` (one mechanism, not a parallel one), and C11c's `unresolvedGuards` diagnostic is folded into C17's `guardRefusals`. One C17 over-taint found and fixed in the merge: an `and` with a KNOWN false operand is not unknown (PTA's `ta.crossunder(close, topLine.get_y2()) and extendSignal` marked the latch and blanked 3 of 7 lines). Committed harness dir (82 graded): exactly 1 entry changed (the same), objects MATCH 45 → 46, overall 37 → 38, families 242 / 294 → 249 / 301, inventory identical. Member-door census 266 × both flags: attach 39 / 61 → 39 / **62**, **2 rows changed, both pro-trading-art** (on: attaches; off: the objects-only sentence). OOS measured baseline: one re-pin, `mid_engagement__18-market-profile-tpo` still 6 outputs and 6 refusals, now NAMED for what stops it (`pine:state` ×2, `pine:tuple` ×4 — the `[poc, vah, val] = render_profile(…)` destructure condemns its own names) instead of `pine:reassign` ×6 on the names the fold stopped before. Notebook first-open bytes 1,868,658 B (+0 against the C17 base; budget 2,260,793, PASS). `paramIds.test.js` green, no re-pin. Step 28 is reserved for the parallel C12s lane (switched counters) |
| 28 | C12s a SWITCHED recurrence (`pine.js::forgetsOnReset`, `interpret.js::switchedVarSeed`): a body the window refuses because one arm never forgets (`c ? self + 1 : 0`) is admitted when a RESET path exists (ternaries whose conditions do not read the state, to an arm that does not read it; lag 0). Its window starts from an UNKNOWN state; bar `t` is published only where the value came out known AND the forgetting step lies in `(t − W, t]` — per bar, keyed on the data, never a bar number. What reads an unknown switched bar is withheld by a DEPENDENCY MASK read off the tree (`maxLookback` reach above the switched node) plus the probe (for readers that under-claim their reach, `ema`), in both lanes and in the object lane's `unknownMask`. Python twin in `ast_interpret.py` — see § C12s | `4c0926563`, `3c6b79b82` + the merge onto C11c (`067283083` over `0fd35f415`) | 28 / 47 → 28 / 47 (overall 24 → 24; base `0fd35f415`, objects pane on) | 214 / 266 → 214 / 266 | `artemis-oscillator-pro` labels 13 → **16 of 17**: the three `✦ OB` TradingView draws, **id for id** (5, 12, 13) at its y — from the listing (the capture) and, behind the curtain, every `✦ OB` drawn is one of them; `R▼` converts but its guard measures 132 nodes against the 128-node budget, NAMED (`budget:nodes`). `ema-ribbon-trend-filter-strixedge` cells 33 → **34 of 48**: cell (3, 1) `8`, TradingView's text, colour and background. Nothing drawn the vendor lacks; no family flips (each script is short elsewhere). Committed harness dir (87 graded): exactly those 2 entries changed, objects MATCH 44 / 75 and overall 41 unchanged. Member-door census 266 × both flags: attach 39 / 62 → **41 / 64** — `btc-charlie-trader-xo-macro-trend-scanner` and `keltner-center-of-gravity-channel` attach (no capture: held to the same tree run from the listing over AGEN 1D 2,000 bars and RDDT 1D 632 bars, 0 disagreements, 0 bars published the listing withholds); `cc-yata`'s refusal moves `pine:state` → `pine:timeout`. `tools/corpus_metric.json` host_ok 56 → 57, screener_ok 57 → 58. Community: `25-spy-expected-move-by-vix` translates (its VWAP column; the door still refuses on its `for`). OOS baseline: ict-smc-guide 18 → 4 `pine:state` (flat 2 → 12), relative-volume-candles → `pine:function`, market-profile-tpo loses its two `pine:state` (all still door-refused); `param-ids.json`: ict-smc-guide +7 ids appended (door-refused). `ast_conformance --check`: identical to base (the same 2,338 pre-existing findings). Census build 49.4 / 38.4 s base vs 43.0 / 38.9 / 42.9 s (alternated). Notebook first-open bytes 1,868,658 B (+0; budget 2,260,793, PASS) |
| 29 | C18 `while` loops, and a last-bar drawing's value read from the RUNTIME lane — the runtime front end runs `while` (test re-read before every pass, break/continue, an `na` test is false) under an ENGINE bound `WHILE_ITERATIONS` = 10,000 passes per entry (opcode `WHILE_BOUND`; a loop that does not stop stops the run BY NAME, `runtime:WHILE_ITERATIONS`, and nothing is read from it), plus what k-clustering and max-pain write (`x += 1` as a mutation, `max_bars_back` ceiling, array members on an untyped parameter, if-expression arms with arm-locals, `int()`/`float()`, `array.slice` as a copy whose later write refuses, `median`/`stdev` compile and stop the run if reached, v6 `and`/`or` and `?:` skip the untaken side when provably 0/1). On the HOST object pass, an op under `barstate.islast` (not in a loop, helper or `var` initialiser) whose value the columnar resolver refuses as imperative becomes a placeholder `__uct_runtime_at(k)` read off ONE run of the script at the op's own statement; served only from the listing (R-W), at default inputs, when the run completes and two probe runs agree — otherwise UNKNOWN and C17 withholds. See § C18 | `490b68580`, `3b6d5b2a9` + merge onto wave 5 (`54b795392`) | 28 / 47 → 28 / 47 objects MATCH (overall 24 → 24; against `fb846eaef`) | max-pain 6 → 4 families differing | `options-max-pain-calculator-backquant` cells 12 → **16 / 16** (texts agree), lines 0 → 2 of 10, labels 0 → 3 of 8 — each TradingView's (y, colour, style, size). `k-clustering` unchanged: the run computes all 9 levels and 3 densities to the bit, but its last bar needs 800,613 VM instructions against `INSTRUCTIONS_PER_BAR` 200,000, so it is WITHHELD by name (the budget was not raised). Committed harness dir (82): the same 1 entry changed, overall MATCH 38 unchanged. Member-door census 266 × 2: attach 41 / 64 unchanged; 1 row — k-clustering flag OFF moves from `pine:objects-only` to the clean-objects-only sentence (its program no longer drops ops). Census 53 s base vs 61 s. Notebook first-open 1,868,808 B unchanged; total JS +16,983 B |
| 30 | C19 the node budget counts what the evaluator COMPUTES (integrator ruling 2026-09-30; the cap stays 128): `interpret.js::evaluationUnits` (`nodeCount`) keys a unit exactly as the evaluator's memos key it — a self-free node or a read (literal, column, `self`, `self[k]`) once per (scope, shape); an operator or call reading a recurrence bind once per (scope, recurrence, shape); a `tf`/`tf_live`/`sym` child a scope of its own — and a column the caller's PASS already holds (the object lane's interned `crossMemo`) is one read, through `passHolds`, the predicate `evalNode` skips on. The step memo keys on the structural id (a JSON read-back pays one unit per shape, as charged); probes read the pass's recurrence-free columns over the same bars and are charged for what they compute; a probe still refused withholds every bar. Python twin (`evaluation_units`, structural step memo; no pass memo there) — see § C19 | `ba3bd7c28`, `c69063c73` | 28 / 47 → 28 / 47 (overall 24 → 24; objects pane on, base `fb846eaef`) | 214 / 266 → **216 / 266** (artemis labels count 16 → 17 of 17, labels text → agree) | `artemis-oscillator-pro` `R▼` (`budget:nodes` 132 > 128) → **served, TradingView's id 16 at its y (within 1e-12 rel), on `D▼` id 15's bar**; from the listing all 17 labels are TradingView's, id for id (`vendorHarness.c12sSwitched`); behind the curtain it is drawn and is one the listing run draws. Its guard: 132 units standalone, 36 against the columns earlier trees of the same pass hold. Objects still DIVERGE on its table cells (18/21, C10/C12). 47 captures (both flag states): exactly that 1 entry changed; committed harness dir (87, both flag states): the same 1 (objects MATCH 49, overall 41 unchanged; families 270 / 322 → 272 / 322); inventory identical. Member-door census 266 × both flags: attach 41 / 64 → 41 / 64, **0 rows changed** (an intermediate draft that counted `self` once per recurrence detached `keltner-center-of-gravity-channel` — out11 at 132 — and was corrected: a bind read computes nothing). Object-lane refusals over the committed corpus on RDDT 1D bars (45 object scripts × listing on/off): only artemis moved; 0 `budget:nodes` refusals remain. Translate time, 12 largest corpus scripts × 4 alternated runs: medians −7 % … +17 % against base (box under load; the unit count itself costs the same as the distinct count over all 948 attached trees, 52–63 ms per pass both). Artemis object pass 228–272 → 250–324 ms (it now evaluates and probes the two guards it refused). Notebook first-open bytes 1,868,808 B at base and after (+0). `paramIds.test.js` green, no re-pin. Step 29 left to the parallel C18 lane. **Merged onto C18** (`0b8dc212b`): a runtime placeholder `__uct_runtime_at(k)` (C18) is a READ — one unit, nothing below it (`RUNTIME_AT_CALL` now declared in `parse.js`, re-exported by `objectProgram.js`); against the C18 tip the 47 and the harness dir change only artemis (families 216 → 218 / 266, 272 → 274 / 322), census 266 × 2 0 rows, max-pain's C18 gains unchanged (cells 16/16, lines 2, labels 3) |

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

## C11 — arrays, UDTs and methods (2026-09-29, step 18)

**Step 1, measured before any change** (objects pane on, harness only; the same
numbers with `VITE_PINE_RUNTIME_PANE_ENABLED` off and on — every one of the nine
attaches on the host lane, so the runtime route never engages):

| script | vendor vs ours (families that disagree) | first wall of the runtime object lane |
|---|---|---|
| dual-view-htf-candlestick-patterns | 236 lines / 89 labels / 111 boxes vs no drawing program | `pine:window-dependent` (`barstate.isfirst`) |
| htf-liquidity-dashboard-tfo | lines 6/0, labels 6/0, cells 30/3 | `pine:input-kind` (`input.symbol`) |
| ict-killzones-pivots-tfo | cells 3/0 | `runtime:input-state` (`input.color`) |
| institutional-smc-order-flow-matrix-pro | lines 18/0, labels 34/16, boxes 2/0 | `pine:input-kind` (`input.color`) |
| k-clustering | lines 9/0, cells 8/5 | `runtime:directive` (`max_bars_back`) |
| options-max-pain-calculator-backquant | lines 10/0, labels 8/0, boxes 13/0, cells 16/11 | `runtime:function-global-state` (`strikes`) |
| pro-trading-art-double-top-bottom | lines 7/0, labels 14/0 | `runtime:udt-method` (`maintainPivot`) |
| trend-duration-forecast-chartprime | labels 28/0, cells 34/0 | `pine:function` (`label(na)`) |
| vdubus-pattern-gen-v2 | lines 112/0, labels 5/0 | `pine:arity` (`ta.macd`, 4 args) |

**What that table says, and why the lane did not route.** The runtime object
lane builds **none** of the nine, and it is not wired to any product path
(`reachable.test.js` lists it unreached). Peeling each script wall by wall
(replace the refused line, re-run) shows the walls are mostly the HOST lane's
(`pine:statement` in six scripts: array ops, `box.delete` and `while` bodies
inside loops the host translator does not read), because the object lane runs the
host object pass in raw-tree mode for its ops. Routing an unbuilt lane would
change nothing a member sees, so step 18 closed runtime-front-end gaps the peel
named instead, each general Pine semantics with a focused test and mutation proof:

- **A script's own `method`** binds when it is declared once and is not also a
  plain function; `recv.m(args)` lowers to `m(recv, args)` (value and statement
  position). An overload refuses `runtime:udt-method` by name.
- **Array members**: `first/last/shift/pop/unshift/remove/concat/indexof/includes/
  max/min/sum/avg`. An empty array, a non-finite element in a reduction, and an
  `na` search value refuse with *"has not been measured on a chart"*.
  `array.slice` stays absent (it is a VIEW, not a copy).
- **A function reads a main-program variable** at the moment of the call
  (`LOAD_GLOBAL_LOCAL`/`LOAD_GLOBAL_PERSIST`); a helper can clear and fill a
  global array (max-pain's `generate_strikes`). Still refused by name: assigning a
  global, a global's history (`g[1]`), a window over a bare global, and any global
  read inside a `request.security` value.

**Grades: none moved** (row 14). Every change is on a path no graded script
reaches today.

**What each C11 script still stops on** (object-lane peel after step 18; refused by
name, never drawn approximately):

| script | stops on | would settle it |
|---|---|---|
| dual-view | `barstate.isfirst` (window-dependent); `while` + `array.shift` in a loop body (C12); `input.*` defaults | none — host-lane grammar, not unknown semantics |
| htf-liquidity | `input.symbol`; `request.security` (C10) | — |
| ict-killzones | `input.color` default read by state; `for … in` over a UDT array; `while` over `.size()` | — |
| smc | `input.color`; `box.delete` / `array.remove` inside a loop (C12) | — |
| k-clustering | `max_bars_back` directive; `while` convergence loop; dynamic offsets (C9) | — |
| max-pain | `while` loop building strikes; a block value (C12) | — |
| pro-trading-art | a drawing helper returning a tuple of handles with a default param; `line.get_y2()` (C14) | — |
| trend-duration | `label(na)` as a value | — |
| vdubus | `ta.macd` with 4 args; `ta.pivothigh` right-bars in a statement; drawing helpers with multi-statement branches | — |

No capture is needed for any of these: none is a question about what TradingView
does. Each is a grammar or lane gap, and the next C11 step is routing object
programs into the runtime object lane once one of the nine builds end to end.

## C16 — a script that edits its own list of drawings (2026-09-29, step 19)

**The lane's question.** § C11 found that the nine C11 scripts stop on the
HOST/object reader, not on runtime grammar. This lane re-measured, per script,
the FIRST refusal that reader hits (the earliest source line whose op the
converter drops, read off a temporary instrument in `canonicalOf`/`guardOf`,
byte-restored and sha-verified afterwards), before and after C16:

| script | first refusal before C16 | loop / while / `isfirst`? | after C16 |
|---|---|---|---|
| institutional-smc | L122 `box.delete(array.shift(bull_boxes))` under `array.size(bull_boxes) >= 3` — `pine:drawing` (a drawing list's length) | **yes** — list eviction, then a `for` over the list that deletes and removes | **served whole, no drop**; boxes 0 → 2 / 2. What it still withholds is the owner-gated warm-up curtain (5 lines, 5 labels before bar 250) |
| dual-view | L382 `for i = 0 to array.size(candle_bodies) - 1` + `box.delete(array.get(…))` — `pine:collection` on a generic `array.new<box>()` | **yes** — ten delete-all loops over drawing lists | the list loops convert; the drawing now stops at L487 on `var` state (`pine:state`, 78) and numeric HTF arrays, and every read of its lists is withheld as `coll:diverged` (their pushes are lost) — nothing is drawn wrong. C11/C12, not C16 |
| options-max-pain | L225 a delete whose guard reaches a `while` inside `calculate_max_pain_direct` — `pine:block` | **yes** — `while`, but one that computes VALUES (strikes, pain) | unchanged: a numeric `while` is the value lane's (C11), not a list the object runtime holds. One more cell drawn — an `input.string` caption, TradingView's |
| ict-killzones | L626 a loop bound `mg_lbls.size` on a user-type field — `pine:type` | a loop, over a UDT field | unchanged (C11 UDTs) |
| trend-duration | no guard refusal; `label(na)` as a value (`create:label`) and a loop bounded by a NUMERIC array | a loop, over numbers | unchanged (C11) |
| htf-liquidity | L135 a cell guard, `s0d_highs.size` on a UDT — `pine:type` | no | unchanged; its six lost `line.delete(_hline.pop())` now bring their lost pops (`guard:coll_pop` 6) |
| k-clustering | L192 `n_clust.get` on a UDT — `pine:type` (its `while` convergence loop is numeric) | no | unchanged |
| pro-trading-art | L24 `top.first` — a method on a float array (`pine:type`) | no | unchanged |
| vdubus | L193 `zzP` arrays built inside a function — `pine:collection` | no | unchanged |

`barstate.isfirst` blocks no HOST-lane object op in any of the 47 captures (the
C11 table's `pine:window-dependent` wall is the RUNTIME object lane's); the
object program already reads it (`multi-timeframe-supply-demand-zones` draws its
bar-0 burst id for id).

**Most scripts moved first.** The one class the list-loop walls share is reading
and editing a list of drawings: 33 of the 266 committed scripts read a drawing
list's length (`array.size` / `.size()`), and `if array.size(bs) > N` +
`delete(array.shift(bs))` is the corpus's eviction idiom.

**What was built** — general Pine semantics, each railed and mutation-proved:

1. **A deleted drawing keeps its list slot** (`objectRuntime.reap`). Pine's
   `box.delete(b)` and its collector end the object and leave the `array<box>`
   untouched — which is why the corpus writes `box.delete(b)` +
   `array.remove(bs, i)` as a pair. The runtime spliced the id out, so the pair
   removed two elements. An `na` push is a slot; the collection cap counts LIVE
   objects; Pine's 100,000-element ceiling stops the run.
2. **`array.size(bs)` / `bs.size()`** on a declared drawing list is
   `{v:'size', coll}` — object state, like a getter — legal in a guard, a loop
   bound and a slot index (`+ - *` over it is an address; a getter inside
   arithmetic stays unreadable). `==` / `!=` join the live comparisons.
3. **`box.delete(array.shift(bs))`** (`pop`, `remove`, and
   `bs.shift().delete()`) is two operations: delete what the slot holds, then
   remove the slot.
4. **`box b = array.get(bs, i)`** is an eager copy into `b`, so `b` keeps the
   box it read after `array.remove` shifts the slots.
5. **In a counted loop body** a `get`/`size` comparison is read per iteration;
   a crossing (observed once per bar) still refuses there.
6. ⛔ **A loop whose END bound reads a length its body changes is refused**
   (`loop:bounds`): Pine v6 re-reads `to` before every iteration, the runtime
   reads both bounds once. The START is read once in both, so smc's
   `for i = array.size(bs) - 1 to 0` (with an `array.remove` inside) is carried.
7. ⛔ **A list that lost a change has diverged** from TradingView's — a
   push/remove/shift under an unreadable guard, inside a loop this reader cannot
   run, a mutator it does not read (`unshift`, `insert`, …), a refused helper
   that edits it, or a push of a handle whose create was lost. Every read of it —
   its length, a slot, a handle copied out of one, a latch reading those — is
   withheld and counted (`coll:diverged`, a LIST loss); what it would have drawn
   or removed feeds `lostCreates` / `lostRemovals` / `contentLost`, so the member
   door's partial-drawing rule still refuses a drawing that lost a removal.
8. **An `if` is evaluated once** (`{k:'latch'}`). The program re-evaluated a
   block's condition per op; with `box.delete(b)` in the block,
   `box.get_bottom(b)` read `na` under the `array.remove` beside it and the
   remove never ran — MEASURED on the smc capture: our run then evicted the
   bar-603 zone at bar 613, which TradingView still holds. An object-state
   condition is latched where the `if` stands (per iteration inside a loop) and
   read by every op of the block and of its `else`; over the warm-up curtain the
   latch is unknown and its readers are withheld and counted.
9. **An `input.string` default is the text a drawing carries.** There is no knob
   for it in this product (owner ruling 1). smc's zones are captioned
   `zone_text_val = input.string("Order Block", …)`, and TradingView's two boxes
   read "Order Block". Only `input.string` and a bare string `input(…)`; v4's
   `input(type=input.symbol|…)` stays unread (no capture pins a symbol's text —
   `camarilla-screener`'s ticker labels, which a first cut would have drawn,
   stay refused).

**The capture settles the semantics, not a count.** `vendorHarness.c16Smc.test.js`
runs institutional-smc through the member door on its capture. The ten objects
we withhold are TradingView's first ten structure objects (the warm-up curtain);
**every one of the other 44 is TradingView's** — same creation order across
lines, labels and boxes, same price, same caption, the id counter agreeing at an
offset of exactly 10 — and our x positions map one-to-one and in order onto the
capture's dense x ranks (both zones end at rank 63, the last bar + 8).

**Refused by name, and what would settle each:**

| what | where | why it stays refused | what would settle it |
|---|---|---|---|
| `while <cond>` over a drawing list (`while array.size(bs) > N` + `delete(array.shift(bs))`) | auto-trendline, renderingnature (×5), smart-money-concepts (in a helper) — none captured | the trip count is exact in principle, but no capture pins a `while`'s drawing | a vendor capture of any of these scripts, or a probe (`while array.size(bs) > 3` evicting labels, read by id) |
| a loop over a NUMERIC array; a `while` computing values | max-pain, trend-duration, k-clustering, atr-support-and-resistance's removal loops | the value lane holds no arrays (C11) | the runtime lane reaching the object program (C11's next step), not a capture |
| a loop whose end bound reads a length its body changes | none in the 47 | v5 and v6 differ (v6 re-reads `to`); the runtime reads it once | a v5 and a v6 capture of one such loop |
| a read of a list that lost a change (`coll:diverged`) | dual-view (39 ops), atr-support-and-resistance (12) | our list is not TradingView's after the lost change | serving the lost change's own class (C11 / C12 for these two) |
| ⚠️ `na(l)` / `not na(l)` liveness guards are still evaluated per op | 8 `if na(x)` → `x := *.new(…)` + `else` sites in 5 corpus scripts, none captured | the latch covers object-state conditions only, so the `else` of a creating `if na(l)` can run on the bar the `if` ran | a `{v:'empty', reg}` latch kind (≈60 B of the notebook first-open budget, which has 68 B left on the integration tip) and a capture of one of the five |

**Grades** (harness, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base `105ea5f3d`):
47 captures 21 / 47 → 21 / 47 objects MATCH, 183 → 184 / 252 families. smc's
lines 13 / 18 and labels 29 / 34 are the warm-up curtain (step 17), so its boxes
AGREE and the script stays DIVERGE.

## C10 — `request.security` in the object lane (2026-09-29, step 20)

**Measured first: there was no missing seam.** The object pass builds its values
through the same `Resolver` as the plot lane (`buildObjectProgram`'s factory), so
`securityAsNode` already served object text, coordinates and cells exactly the
forms it serves plots: the chart's own timeframe (or a literal naming it) as the
identity, `W` / `M` as `tf`, `lookahead_on` at `W` / `M` as `tf_live`, a roster
ticker as `sym`. `high-low-open-mid-ranges` proved it before this step: its
`D`/`YD`/`W`/`LW`/`M`/`LM` rows (`lookahead_on`, `tf_live`) already equal the
vendor's cells. The C10 scripts stopped on requests that shared Resolver could
not READ, and on requests their drawings never actually show.

**Forms, per script** (RDDT 1D captures; ✅ served, ⛔ refused by name):

| script | symbol | timeframe (default) | expression | lookahead | verdict |
|---|---|---|---|---|---|
| `linear-regression-…-existing-trend-lines` | own | named `timeframe = TF_Choise == false ? timeframe.period : TF` (`input.bool` false) | UDF tuple, 8 parts (`ta.linreg`, `ta.stdev`, `time[k]`) | off | ✅ identity — the constant-expression toggle now folds (`constantBranchOf`); 5 lines + 2 fills id for id |
| `artemis-oscillator-pro` | own | preset chain on `input.string` → `15`, `60`, `240`, `D` (a name + five arms) | UDF `drmEngine` | off | ✅ `D` identity (object pass, 16 hops); ⛔ `15`/`60`/`240` below the chart — but never SHOWN: the panel forces them `— n/a` behind a test that folds on every bar, so the cells draw without them (dead-arm rescue) |
| `ema-ribbon-trend-filter-strixedge` | own | literals `15`, `60`, `240`, `D` | tuple `[fast, mid, slow]` EMAs | off | ✅ `D` identity (row 9 already drawn); ⛔ `15`/`60`/`240` — intrabar values of a lower timeframe, their rows and the bias/confluence cells that read them |
| `vold-market-breadth` | `USI:UVOL`, `USI:DVOL`, `USI:UVOLQ`, `USI:DVOLQ` via `realS(t)` | `timeframe.period` | `src` | off | ⛔ another symbol, not in the bar series or the benchmark roster |
| `liquidity-heatmap-nephew-sam` | own | literal `5`; inputs `15`…`240`, `480`, `D`, `3D`, `W`, `M`, `2M` | UDF tuple `getPivotData` (pivots + `time[rb-1]`); `resolutionInMinutes(tf)` = `request.security(…, tf, chartTf)` | **on** | ⛔ every label also reads `resolutionInMinutes`, whose child reads `timeframe.*` in the request's context (now refused by name, below); intraday codes below the chart; `3D` / `2M` are codes the seam does not resample |
| `high-low-open-mid-ranges` (secondary) | own | `input.timeframe` `W`, `D`, and table literals `D`/`W`/`M`/`3M` | `open`/`high`/`low`/`hl2` (+`[1]`) | **on** | ✅ `D`/`W`/`M` (37 of 45 cells, unchanged); ⛔ `3M` — a quarter, which `TF_RESAMPLABLE` does not hold (8 cells) |
| `htf-liquidity-dashboard-tfo` (secondary) | `input.symbol` `ES1!`…`AUDUSD` ×9 + own | `""`, `D`, `W`, `M` | tuple OHLC | **on** | ⛔ C11 first (UDT `.size`); the nine are other symbols; own `""` is the identity once C11 lands |
| `position-size-calc` (re-traced) | FX pair built from inputs | `3` | `open` | off | ⛔ another symbol at a timeframe below the chart; `syminfo.root` (rostered unserved) first |

**The rules this step adds** (general Pine semantics, each with a focused rail
and a mutation proof):

1. **A test built only of constants folds** (`constantTestValue`: a tree of
   `op`s over finite `num`s, through `bind.js::foldScalar` with empty constants;
   a shape check first so nothing throws per ternary; any non-finite subtree —
   `na` is `0/0`, and `(0/0) != 1` is a finite 1 in JavaScript — declines).
   `constantBranchOf` (both lanes) uses it: `flag == false ? timeframe.period : tf`
   read exactly as `flag ? tf : timeframe.period` already did.
2. **Object pass only (`Resolver.objectPass`): a side the test never takes may
   refuse.** A ternary or `and`/`or` whose test folds answers with its live side
   when the dead side refuses; the text and colour readers do the same. A
   RESCUE after the old eager order, so every tree that translated keeps its
   shape; a LIVE side's refusal is still the answer. Timeframe readers follow 16
   names/arms there, not 4. ⛔ **Confined on purpose:** in the plot lane a
   newly-translating output mints its parameters in a new order and moves the
   addresses members save — measured, `paramIds.test.js` red on
   `cppivot-boss-floor-pivots` (its `floor_pivot_resolution` is six hops), and
   on `camarilla` under an earlier prune-before-resolve variant — and re-pinning
   `docs/pine/param-ids.json` is owner-ruled. The object pass mints none.
3. **Both lanes: `timeframe.period` / `.multiplier` / `.isminutes` /
   `.isseconds` / a bare `timeframe.in_seconds()` read inside a request child at
   ANOTHER timeframe refuses** (`pine:request`, naming the read). It folded to
   the chart's own timeframe — so `request.security(syminfo.tickerid, "W",
   timeframe.in_seconds())` read 86400 on a daily chart — while Pine evaluates
   the child in the request's context. No capture measures it, so neither
   reading is served. (Found while building rule 2: pruning on such a fold would
   have turned a refusal into a wrong number.)

**Refused by name, and the capture that would settle each:**

| form | scripts | what settles it |
|---|---|---|
| a timeframe BELOW the chart's own (`15`, `60`, `240`, `5`, `480` on 1D) | ema-ribbon rows 6–8 + bias/confluence, artemis values (not shown), liquidity-heatmap, position-size-calc | not a capture — the bar series holds no intraday bars on a daily chart; it needs intraday bars delivered with the daily ones and a rule for which intrabar value TradingView returns (a capture of `request.security(tickerid, "60", close)` on 1D would pin that rule) |
| another symbol | vold (`USI:*`), htf-liquidity, position-size-calc | the symbol's bars in the series (`sym` serves only the benchmark roster) |
| `3M`, `3D`, `2M` | high-low-open-mid-ranges (8 cells), liquidity-heatmap | `TF_RESAMPLABLE` widened; the OHLM capture's `Q`/`LQ` cells (e.g. `175.01` / `208.05` / `135.2223`) are already vendor evidence for the quarter's bucketing when it is |
| `timeframe.*` inside a request at another timeframe | liquidity-heatmap (`resolutionInMinutes`) | a capture of `plot(request.security(syminfo.tickerid, "W", timeframe.in_seconds()))` (and `… timeframe.period == "W" …`) on a 1D chart |
| `lookahead_on` pivots read on a resampled `W`/`M` series with `time[rb-1]` | liquidity-heatmap | its labels' own coordinates, once the rows above clear |

**Cost.** No data is fetched: every served form resamples the bars already in
hand (`tf`/`tf_live`) or is the identity, so the object lane makes no new request.
Translate time, A/B in one process over the 365 corpus + fixture scripts ×3
against base `105ea5f3d`: ratio 1.013–1.024 (A/A control 0.999). Member-door census
build (266 × 2): base 51.9 / 56.6 s, tip 53.6 / 54.2 s interleaved on a loaded box
(36 s / 36 s at step 20's first commit on a quiet one). The lazy `pine-*.js`
chunk 236,701 → 238,592 B; `bytes.notebook_first_open` is unchanged at
2,261,476 B — already over its 2,260,793 B budget by 683 B at the base, before
this step.

**Rails:** `__tests__/c10SecurityObjects.vendor.test.js` (linear-regression's
five lines id for id at the vendor's levels, styles and bar times, and its two
fills; a control flipping the toggle to 60m draws no channel; artemis' MTF panel
cell for cell; a control making the 15m validity per-bar drops those cells, never
guesses), `ast/pine.c10ConstantTests.test.js` (16), `ast/pine.tfternary.test.js`
(4). Mutation-proved: step 1's fold two ways, and nine clauses of step 2 each red
alone — the text rescue, the colour rescue, the ternary rescue both ways round,
the `and`/`or` rescue, the 16 hops, the request-context refusal, the finite-subtree
check, and the object-pass confinement — bytes restored and sha-verified.

## C14 — drawing getters (2026-09-29, step 21)

**Getter forms, measured per script** (source of the four scripts the other lanes named):

| script | form | where | status after step 21 |
|---|---|---|---|
| `rsi-swing-indicator` | `last := label.get_y(l)` ×2 — a `var` written only by a getter, inside an `if` | read in the label text `last < high ? "HH" : "LH"` (via `obLabelText()`) | **served** (`setnum`/`num`) — but see the wall below |
| `rsi-swing-indicator` | `l_ts = label.get_x(l)`, `l_price = label.get_y(l)` ×2 each — block locals | `line.new(…, x2 = l_ts, y2 = l_price)` | **served** |
| `rsi-swing-indicator` | `labelhh := createOverBoughtLabel(true)` — helper whose body is `if … else` of two `label.new` | the handle the getters read | **served** (per-arm copy) — it was a SILENT loss: no copy op and no drop, the handle never filled |
| `high-low-open-mid-ranges` | `line.get_y1(hline)` inline, a y coordinate (in `f_line2`, inlined, body's own handle) | label y | served as `{v:'get'}` |
| `high-low-open-mid-ranges` | `line.get_y1(hline)[1]`, `line.get_y1(h1)[1]` — a getter's HISTORY; `str.tostring(b1)` a getter in text | label text | refused by name (history of object state is not held); the labels stay withheld on C15 (`higherTF` text) regardless |
| `trend-duration-forecast-chartprime` | `LengthLine.get_x1() + bearishCount.avg() + 1`, `math.avg(get_x1(), get_x2())` | `set_x2` / `set_x` | refused (getter in arithmetic, and `.avg()` of an array is C11) |
| `pro-trading-art-double-top-bottom-with-alert` | `ta.crossunder(close, topLine.get_y2())` | guard (served since 2026-09-27) | now WITHHELD, `state:lost`: `topLine` is filled only by `[Line, A, B] = drawLL(…)` (C11), so the line family has lost creates and the getter reads a handle this program never fills |
| `ultimate-pivot-points` | `line.get_x2(pLine) != bar_index` | guard | a live `!=` since wave 4 (C16's `LIVE_CMP_OPS`), not this step; MATCH unaffected |

**The rule (Pine semantics).** A getter returns the property the program last set
on that object — state the object runtime holds. Pine evaluates it where the
statement stands, so the runtime answers it in op order: a scalar write is a
`setnum` op at its statement's place, under that statement's guards; a whole-
coordinate getter is read at its op (an argument is evaluated at the call). A
getter on an empty handle is `na` — measured: rsi-swing's first line has a null
`y2`, and its first overbought label reads "LH" (`na < high` is false).

**Exactness guards (each railed in `objectGetterState.test.js`, mutation-proved):**
a scalar qualifies only when every write to it anywhere is a bare getter outside
loops and function bodies, declared once; a getter on a register whose family lost
a create, or whose property a lost setter writes, is withheld after conversion
(`state:lost`, fixed point with the content pass, loop bodies included); so is one
whose handle a step writes off a recurrence (`accum`, which the warm-up curtain may
withhold on a bar Pine runs it). A handle a delete empties is NOT withheld: the
runtime's `reap` empties the register and its getter reads `na`, the reading C16
(step 19) serves and rails. A getter-fed scalar in a C16 latched condition is read
through the latch; a scalar written under a condition that itself reads object
state is refused (it would need its own latch). The object runtime carries only
`nums`, `setnum` and `{v:'num'}`; the validator refuses a scalar read in a loop
body and a crossing in a text condition. (Before the wave-4 merge this step ran
against a 15 B Notebook first-open headroom and dropped those two re-checks; the
lazy chart-engine fix in wave 3 removed the squeeze — 1,868,509 B, budget
2,260,793 B — and both are restored.)

**Why no graded script moved.** `rsi-swing-indicator`'s getters now convert, and its
next wall is not C14: `if (laststate == 2 and isOverbought)` (line 85) is read
ABOVE `laststate := 1/2` (lines 108/115). The object pass resolved a top-level name
against the walk's FINAL binding — `accum(0, os ? 2 : ob ? 1 : self)`, the END-OF-BAR
value — which on every overbought bar is 1, so the guard was false on 632 of 632
bars (measured). A read AFTER an earlier write of the bar is right already (the
walk records that value per statement: smc's `last_ph_s` reads `ph ? ph :
accum(…)[1]`). Step 21 therefore refuses by name an object op whose resolved trees
contain a name's end-of-bar binding while a write of that name follows the read
(`readBeforeWrite`); a read that folds away (`prevBreakoutDir == -1 and choch` with
`choch` false) is kept. It moved nothing on the 47 or the harness dir (market-
structure and smc keep every object, checked). Also measured: with the guards read
wrong, rsi-swing's move guards are 1,059–3,243-node trees costing 3–32 s EACH to
evaluate on 632 bars — the program must not reach a member before that is fixed.

**What would settle it:** binding a name read before its first write of the bar
to the fold's previous-bar value (`accum(…)[1]`, the seed on bar 0) — a C12 walk
change, no capture needed (Pine semantics) — plus a bound on those tree sizes. A
getter's history (`l.get_y1()[1]`) needs the register-history ring to carry
properties.

## C9 — a history offset that is an expression (2026-09-29, step 22)

Branch `pine/c9-dynamic-offsets`. Measured before any change: the "14 trees" on
`artemis-oscillator-pro` and the six on `extrapolated-pivot-connector` are two
different things, and only one of them is a per-bar offset.

| form | where | what it is | served by |
|---|---|---|---|
| `high[pivSpan]`, `oscVal[pivSpan]`, `bar_index[pivSpan]`, `ta.pivothigh(high, pivSpan, pivSpan)` with `pivSpan = math.max(drmLen / 2, 2)` | artemis (14 trees + 12 pivot `pine:arity`) | a `simple int` from inputs — fixed before bar 0 | the columnar lane: the offset arm now folds exactly as the window arm does (`foldWindow`), and so do a pivot's bar counts in the literal pass |
| `high[len]` at the member door (`declareInputs` hands an input back as an identifier) | 5 outputs of `mid_engagement__22-rsi-levels-regime-map`, `pivot-high-low-points` (`high[mb]`, `mb = lb + rb + 1`) | the same `simple int` | the same fold; the input is recorded window-bound |
| `up[n - a1]`, `n[n - a1 + length]` | extrapolated (6 coordinates, 16 reads) | a per-bar offset: the value (and the bar) at an earlier bar a `valuewhen` found | the object runtime's own history read, `{v:'at'}` |
| `low[bar_index - Low_Last_Bar]`, `high[bar_index - High_Last_Bar]` | smt-divergence-ict-01 (6 reads) | a per-bar offset | the same read — the script then stops on C10 |

**The per-bar read, and the Pine rules it keeps.** The V2 graph still refuses
`x[e]` for a series `e` — an offset node's bar count is a literal, which is what
keeps `maxLookback` a tree sum. The object runtime holds every column for the
whole loaded window, so it reads `x` on bar `bar − e` there (`objectProgram.js`
`MAX_BARS_BACK_CAP`, `objectRuntime.js` `atCheck`). Both halves are ordinary
graph columns with ordinary lookbacks, so the lookback / budget accounting is
unchanged; how far back a read may reach is the script's DECLARED
`max_bars_back`, so it is decidable before bar 0.

| case | rule | evidence |
|---|---|---|
| `bar − e < 0` | `na` | Pine's own `close[1]` on bar 0 |
| `e` is `na` | the op is WITHHELD on that bar (`withheldUnknown`) | extrapolated evaluates `n[na]` on every bar before its second pivot and TradingView still draws — so it is not a runtime error; what it READS is not measured, so nothing is drawn from it |
| `e < 0`, fractional, or `≥ max_bars_back` | a Pine runtime error: the run stops and nothing is held (`OBJECT_RUNTIME_ERROR`) | TradingView's history-buffer error; no capture reaches it, so the answer is the one that never draws |
| no `max_bars_back` declared | refused by name (`historyReadRefusals['no-max-bars-back']`) | TradingView sizes the buffer by its own detection, which no capture measures |
| `max_bars_back(x, n)` called | refused by name (`max-bars-back-call`) | a per-series buffer rule this read does not model |
| the source is reassigned (`s[e]` of a `var`) or not a plain name | refused by name (`source`) | its history is the end-of-bar value, not the column at this op's position |
| `e` evaluated on a bar the guard skips | nothing at all | Pine evaluates `x[e]` only where the statement runs |

**The defect the fold exposed, fixed first (C12-shaped, general).** With artemis'
offsets folded its divergence LINES drew from the current pivot to itself
(x1 == x2, y1 == y2): the object pass resolved every `var` against the END of the
program, so `line.new(pHH_bx, pHH_ox, …)` above the promotion `pHH_ox := cHH_o`
read the promoted value. The output loop already reads a name as it stands at
its own line (`positionEnv`); the collector now stamps each op with its
top-level statement (`pineObjects.js` `top`) and the object pass resolves
against the env once that statement has run. **Merged with C14 (step 21) as ONE
mechanism:** the stamp is C14's `topPos` (`pineObjects.js` `stampTop`), and the
line C9 needs is `rootLines[topPos]`; C9's own line stamp was dropped. The case
this cannot see — a name reassigned LATER IN THE OP'S OWN top-level statement —
is exactly what C14's `readBeforeWrite` refuses by name, now narrowed to that
case only (a write in a later statement is read as Pine reads it).

**Grades.**

| script | before | after | every object drawn is TradingView's? |
|---|---|---|---|
| `extrapolated-pivot-connector` | no drawing program (6 held) | **7/7 MATCH** — 2 lines, 4 labels | yes: y 230.41 / 282.95 / 79.7499 / 119.27 and x at bars 222 / 374 / 261 / 506, the bars whose high / low those are in the capture |
| `artemis-oscillator-pro` | lines 13/0, labels 17/0 | lines 13/**8**, labels 17/**8** | yes: the vendor's last 8 lines (y1 → y2 each) and last 8 labels, in order |
| `smt-divergence-ict-01` | lines 500/0, labels 500/0 | unchanged | nothing drawn; its guards read `request.security(input.symbol XAUUSD)` (C10) |

Against the C14 tip `aa1d1dd62` (after the merge): 47 captures: objects MATCH
22 → **23**, families 181/245 → 188/252 (extrapolated gains its seven), overall
18 → 19; only artemis and extrapolated moved. Committed harness dir (120
captures): objects MATCH 44 → 45, overall 43 → 44, the same two only. Member-door census 266 × both flags: attach 39 / 60 unchanged;
`drawsObjects` false → true for extrapolated only; two refusals move to their
next wall (`order-block-finder` → `pine:reassign`; `pivot-high-low-points` →
the install door's `resolve:window` on `highestbars`, a window the declare
pass does not fold — named, not drawn).

**A cost, named.** Outputs that used to refuse at the member door's declare pass
now translate there, and each of them costs what a translation costs.
`mid_engagement__22-rsi-levels-regime-map` (a `pine_oos` fixture, refused at the
door by `pine:collection` before and after) went from ~1.1 s to ~5 s for one
declare-pass translation — measured by CPU profile: 2.9 s of it is
`boundedBarssinceThroughBinding` → `constIntOf` resolving both sides of every
comparison once more before the ordinary path resolves them again (its reversal
guards `curX - xLo1 <= revLook` are reached once `rsi[revPiv]` folds). A
pre-check that skipped that resolve cut the door from ~8 s to ~4 s but moved
Track F parameter ids on corpus scripts (`72s-strategy-adaptive-hull-…`,
`adaptive-trend-following-suite-…`: the early resolve mints in its own order), so it was reverted and is left for a lane that may re-pin ids. Every
translation stays inside the 10 s `PINE_TRANSLATE_BUDGET_MS` (no `pine:timeout`
in any measured pass); two builder tests that translate this fixture twice carry
an explicit 60 s timeout, saying why. The census over the 266 corpus scripts
took 36 s before and 38 s after.

**What each C9 script still stops on.**

| script | stops on | would settle it |
|---|---|---|
| artemis — lines 5, labels 9 before bar ~350 | the warm-up curtain (`PINE_STATE_WARMUP`, C12, owner-gated) | the owner ruling on a `var` seeded from where a fetch starts |
| artemis — `R▼`, three `✦ OB` labels | `guard:create` ×4 (momentum-exhaustion state) | **traced in C17 (step 26):** `pine:state` on the running counts `meObCount` / `meOsCount` — see § C17 |
| artemis — 8 cells | C10 `request.security` (24 trees) | the MTF data seam |
| smt-divergence | C10 `request.security` of another symbol (`input.symbol`, default XAUUSD) | the MTF data seam and a symbol the product holds |

## C11b — arrays and reassigned names, read on the HOST object lane (2026-09-29, step 24)

**The design question, settled by measurement.** Two ways to serve the nine C11
scripts: (a) teach the host object reader to read numeric arrays and the names
they depend on, or (b) route their drawing to the runtime object lane behind the
dark `VITE_PINE_RUNTIME_PANE_ENABLED`. (b) was measured first and rejected on
two counts:

- **It does not build.** Peeling each script wall by wall through the runtime
  object lane at base `cac2bd01d`: dual-view 26 walls and stuck
  (`pine:statement`), htf-liquidity past 40 (the peel's cap), ict-killzones 18,
  institutional-smc 17, k-clustering 34, max-pain stuck after 2 (`pine:block`,
  a `while`), pro-trading-art 6, vdubus 15. One of the nine (trend-duration)
  reaches a build, after 15.
- **Where it builds, it answers at the wrong position.** The runtime object lane
  evaluates a drawing's trees at the END of the bar or block, not where the op
  stands: a label whose text is a count read before its own update showed the
  post-update value (`"100"`), and a guard that reads a value the same block
  then changes drew 0 labels where Pine draws them. Routing would have drawn
  wrong.

So (a): the host reader, extended one general Pine semantics at a time, each
with a focused test and a mutation proof.

**Re-measured first walls** (host object pass, first op whose guard or value
refuses; objects pane on; lane base `cac2bd01d` → lane tip `c7fdaf10b`, before the
merge onto step 23; not re-measured after it):

| script | base | tip |
|---|---|---|
| dual-view | L487 `pine:state` — `var` state the bounded accumulator cannot hold (78 ops); its lists `coll:diverged` | unchanged — `var` state (C12), not an array question |
| htf-liquidity | L135 `pine:type` — `s0d_highs.size` | L135 `pine:request` — the other symbols' rows (C10); its own-chart levels are drawn |
| ict-killzones | L626 `pine:type` — `mg_lbls.size`, a loop bound on a UDT field | same first wall, but **MATCH**: its three cells no longer depend on it |
| institutional-smc | L72 `pine:offset-literal` (C9) | unchanged (the C9 lane) |
| k-clustering | L185 `pine:type` — `n_clust.get`, under a `while` | unchanged — a UDT holding arrays, and a convergence `while` |
| max-pain | L225 `pine:block` — a `while` inside `calculate_max_pain_direct` | unchanged |
| pro-trading-art | L24 `pine:type` — `top.first` | L24 `pine:collection` — `top` is now read as a window; the next walls are the script's own read-method `array.middlePrice` and two same-named `var lastStart` in sibling blocks (C12) |
| trend-duration | L69 `pine:type` — `bullishCount.avg` | unchanged — `avg` is a reduction this reader does not fold, the array is read before its last write, its cap is an input, and its line reads getters (C14) |
| vdubus | L193 `pine:collection` — `zzP` created inside a function | unchanged — arrays created per call |

**What was built.**

1. *A drawing reads a name where it stands* (`c1e485959`, `22be3c546`,
   `13edcefd8`, then folded into step 23 at the merge). The object pass joined a
   name's DECLARATION into each op's scope and never its reassignment, so a
   drawing after `x := …` read the declared value — live on the member door
   with the objects pane armed (H14): `x = 1.0; x := 2.0` drew a label reading
   `1`, and a `flag = true` block made a script draw 31 labels where Pine draws
   17, each with a clean drop ledger. `c1e485959` shipped to production as a
   hotfix (cherry-picked onto the wave-3 re-land).

   **ONE mechanism since the merge.** Step 23 (C12r) reads a TOP-LEVEL name by
   position (the walk's `envLog`, `bindingAt`); C11b had entered every
   reassignment into the op's BLOCK scope. Measured on the merged tree, C12r's
   positions alone failed 11 of C11b's 14 reassignment rails, and the cause was
   one layer: a top-level statement's entry in the block scope overrode the
   positional base (the declaration's record pinned `x` to `1.0`). The fold:
   - a top-level statement's entry is skipped — the base answers every
     top-level name by position; C11b's own top-level records (`recordTop` on a
     reassignment and on a `var` declaration) were deleted as dead;
   - a write INSIDE the op's own statement no longer picks between the
     statement's two ends: the op starts from the statement's START binding, and
     the block's own entries (a `foldStatements` record per statement, a loop's
     or a fold-refused write as an entry refused by name) carry it to the read's
     position; a guard is read in the scope its `if` stood in, with the same
     base; an `else` arm starts from the scope before its chain;
   - a block's EXACT record wins over the reassignment overrule; only an
     approximate one (a nested block re-folded from its parent's end state,
     `approxRecords`) keeps the condemnation. ⚠️ The approximate case exists
     because the first relaxation put ict-killzones' `Low` in column 5 **while the
     harness read MATCH** (the harness compares counts and texts, never
     addresses); `vendorHarness.c11bKillzones` pins the addresses.

   Positions still unplaceable (a write with no token, a read an inlined body
   cannot place) keep step 23's `readBeforeWrite` refusal. The one case step 23
   refused and C11b now answers — one op reading a name before AND after a write
   in its own statement — is held against a Pine replay in
   `objectReadOrder.test.js` (the rail that used to assert the refusal).
2. *A bounded numeric window* (`c7fdaf10b`, `arrayWindows.js`). A `var` numeric
   array that exactly ONE statement adds to (directly, under an `if`, or through
   a user function or method) and ONE statement shortens under a numeric cap is
   a window over a series: slot j, newest first, is
   `ta.valuewhen(na(g) ? 0 : g, value, j)`, so a guard that is `na` on a bar is
   false there, as Pine's `if` reads it. `size` is the sum of the filled slots;
   `get(k)`/`first`/`last` map k to j by the array's own order (unshift: j = k;
   a fixed-length push: j = cap − 1 − k). Refused by name, never guessed: two
   places that add, a read before the last write, a cap that is an input, an
   index that moves while a pushed window fills (`first` of a growing push
   window), a window shortened by another array not filled in step with it, a
   cap above 64, and reductions it does not fold (`max`/`min`/`avg`). The
   refusal reason is kept on the binding for diagnosis only — object
   diagnostics carry counts, not sentences, so a member does not see it yet.
3. *A list of drawings carries `unshift`* as a front insert (`objectRuntime`
   `front`), classified in `objectLoss.js`, with the runtime lane's
   `COLLECTION_VALUE_ARG` derived to agree (`drawingAsValue.test.js`).

**Mutation proofs** (each red, restored, sha-verified). Before the merge: M1–M13
on the reassignment read (commit messages of `c1e485959`, `22be3c546`,
`13edcefd8`) and W1–W10 on the windows. On the folded mechanism, re-run: F1 the
top-level skip removed (2 red: the top-level `:=` and `+=` rails), F2 step 23's
two-ends rule restored for a same-statement write (2 red: the read-at-each-
position rail and the `else` arm), F3 the guard read in the op's scope (2 red:
the camarilla-shape guard and the read-at-each-position rail), F4 the overrule
applied to exact records (2 red: ict-killzones, rail and vendor), F5 the in-block
reassignment entry removed (9 red), W1 the window read bypassed (5 red), W4 the
read-before-last-write check removed (1 red).

**Refused, and what would settle each** — none needs a capture; each is a
grammar gap, not a question about what TradingView does:

| script | refused on | would settle it |
|---|---|---|
| dual-view | `var` state across blocks; lists that lost a push (`coll:diverged`) | the C12 state lane |
| htf-liquidity (cells) | nine other symbols' `request.security` | C10: another symbol's bars |
| k-clustering | a UDT holding arrays; a convergence `while` | UDT field arrays in the host reader, and a bounded `while` |
| max-pain | a numeric `while` building strikes inside a function | a bounded `while` in the value lane |
| pro-trading-art | a script-declared read-method on a window (`array.middlePrice`); two sibling `var lastStart` | user read-methods over a window; block-scoped `var` (C12) |
| trend-duration | `avg` over a window; a read before the last write; an input cap; getters (C14) | a folded reduction over a window, and C14 |
| vdubus | arrays created inside a function body | per-call arrays in the host reader |
| ict-killzones (secondary) | a loop bound on a UDT field (`mg_lbls.size`) | UDT fields — does not block its MATCH |

Two latent hazards were NOTED, not fixed — neither reaches a member today, both
scripts are refused at the door: a comma-joined `var a = …, var b = …`
declaration is not recorded (so `smart-money-concepts-by-welotrades`' EQH guard
would read final state), and neither is an `x = if …` declaration.

## C12w — the listing seed (2026-09-29, step 25)

Ruling R-W, built. The bounded 250-bar window and its withholding stay the default;
the exception runs only when TWO facts hold, and neither is inferred:

| fact | who states it | where |
|---|---|---|
| the series starts at the symbol's first-ever bar | the CALLER: `StockChart`, when bar 0 of the bars it hands the binder is dated ON the official listing day (`list_date`, `/api/ticker-ipo`; daily only; exact — never the IPO badge's five-day tolerance); the harness, from the capture's `history.startsAtBar0` | `engine/listingSeed.js::historyFromListingOf`, `__tests__/vendorHarness/ourSide.js` |
| the document's `accum` recurrences are Pine translations | the Pine member door stamps `meta.recurrenceOrigin: 'pine'` (outside the trees: no tree hash moves) | `memberPaneDefinition.js`; the gate is `nativeRegistry.historyFromListingFor` |

⛔ **Why not "the fetch returned fewer bars than it asked".** Read against the serving
path (`bars_fetch._history_complete`, `_get_bars_inner`): a short answer is also a
store never deep-filled, a delta, a replay window, an intraday lookback ceiling and a
backfill still running — each would seed a `var` mid-life and call it exact. A daily
bar dated on the listing day has no earlier session, however it was fetched, and the
check reads the array the engine actually computes on, so panning, cache splicing and
deltas cannot desynchronise it. **No `api/` change was needed**: the listing date was
already served and cached for the chart's IPO badge.

⛔ **Why the document must declare it.** `accum` is shared by three translators and
only Pine's means "carried since the first bar": TC2000's `CountTrue(b, x)` (`pcf.js`)
IS a window of `x` bars, and run from bar 0 it would be a different indicator.

**What the pass computes (`interpret.js::listingPass`).** The tree does not record
whether a `self` read was Pine's bare `x` (the initializer on bar 0) or its history
`x[1]` (`na` on bar 0), nor whether the recurrence is a `var` or the self-reference
spelling `x = na(x[1]) ? S : U` (whose bar 0 is `S`, no update run). So bar 0 is
evaluated under EVERY reading the tree admits — the seed for an unguarded read; the
seed or `na` inside `nz(…)`; unknown for a lag that reaches before bar 0; unknown for
the marked seed — each carried forward as its own trajectory, with one abstract
"unknown" value that only a ternary with a known condition can discard. A bar is
published only where all trajectories agree; elsewhere it is exactly as not computable
as the curtain (`NaN`, or `prefixProbe` so `unknownMask` sees it) and, from the warm-up
on, the bounded window's own value — no bar is ever less computed than before.

**The marked seed.** A `var` read bare AND through an unguarded history read seeds
`na`, but its bare read on bar 0 is the initializer. When that initializer is `na`
(`var float x = na` — smc's and market-structure's spelling) the two agree; otherwise
`varSeedOf` now writes `-(0 / 0)`, the same `NaN` everywhere the bounded window reads
it, so the listing pass knows not to trust it. Measured: 0 of the 299 corpus and
fixture scripts' trees move.

**Cost.** `trajectories × bars`, plus `warmup` steps for a bar the trajectories never
agree on past the warm-up. The pass runs only when `(trajectories + warmup) × bars`
fits `MAX_RECURRENCE_STEPS`; otherwise the bounded window answers alone. At most
`1 + 2^7 = 129` bar-0 readings (below Pine's 250), so for a Pine `var` the pass never
costs more than the window it replaces. No ceiling raised, no new refusal.

**What stays refused, and what would settle it.**
- **Bar counters.** `var n = 0; n := n + 1` and `n = na(n[1]) ? 0 : n[1] + 1` are both
  refused at the door (`pine:state`, the convergence gate) before any bars exist — the
  exception cannot reach them. And as trees both are `accum(0, self + 1)`, which read
  `bar_index + 1` and `bar_index` respectively; the pass withholds rather than choose
  (railed in `listingSeed.test.js`). Settling it needs (a) a translator form for a
  recurrence computable ONLY from the listing bar, (b) a mark separating the two
  spellings, and (c) a capture: a probe plotting both counters beside `bar_index` on
  NYSE:RDDT 1D from the listing day (`vw-var-seed`'s `V00` is the plain `bar_index`
  control, and that probe is door-refused as a whole on its `V04` row). (Step 28, C12s,
  serves a counter WITH a reset arm; a counter with none keeps this refusal.)
- **The first bar of a guarded `var`** whose update differs from its seed on bar 0
  (`g := c ? close : nz(g[1], 3.0)`): the self-reference reading keeps bar 0 withheld;
  bar 1 on is exact.
- **Object creates the translator never built**: artemis' `✦ OB` ×3 and `R▼`
  (`guard:create` at the door) — not the curtain. (Step 28, C12s, builds them: the
  counters are switched recurrences; `✦ OB` ×3 TradingView's, `R▼` over the node budget.)
- **A read ABOVE the write on bar 0** (C12r's START binding, `accum(…)[k + 1]`): the bar where it
  reaches index −1 is the state the `var` ENTERS bar 0 with — its initializer for a bare read, `na`
  for a history read — and the tree does not say which. Under the listing exception that bar is
  UNKNOWN (the probe, so the object lane withholds what reads it; blank on a plot) unless the seed
  is unmarked and `na`, when both readings are `na` and it is exact. Every later bar is Pine's
  (railed in `listingSeed.test.js`). The listing pass evaluates each spine node once per step, like
  C12r's compiled step, so its cost stays linear on a DAG spine.
- **rsi-swing's `state:lost`** (C12r's next wall) is a translation-time refusal — a handle written off
  an `accum` guard — so the exception cannot reach it; its row did not move. (Step 26, C17, lifted
  that refusal in favour of a runtime taint; composed with this exception rsi-swing is a 7/7 MATCH.)
- **Weekly, monthly, intraday**: no listing statement is produced (a weekly key and an
  intraday start are not the listing day), and no capture has measured them.

## C17 — a register a withheld op would write is unknown (2026-09-30, step 26)

Branch `pine/c17-register-taint`. Two object-lane residuals measured by earlier
lanes: `rsi-swing-indicator`'s program refused `state:lost` (step 23), and
`artemis-oscillator-pro`'s four creates dropped `guard:create` (§ C9).

**The rule (`objectRuntime.js`, `regTaint` & co.).** The warm-up curtain
withholds an op on a bar where it reads a `var` this lane cannot compute there.
Before C17 the runtime forgot that the moment it skipped the op: a register the
op would have written kept its old value as if it were Pine's. Now:

| what happens | where | effect |
|---|---|---|
| an op is withheld (the curtain via `readUnknown`, an `x[e]` whose `e` is unknown, or a tainted read) | `taintOutputs` | what it would have written is MARKED: a create's register (it keeps its old value — Pine's guard may have been false) and its site; an update's properties (or `'*'` for a delete) on whatever the handle holds now, or on every object of a list whose length or index is unknown; a cell address (`'*'` if the address is unknown); a scalar; a list's length; a latch; a `var` initialiser (every later run of it is withheld too — Pine may already have run it) |
| an op's GUARD, the HANDLE it acts on, an ADDRESS, a LOOP BOUND, a handle-valued property, an `x[e]` offset, or a liveness test (`na(l)`) reads a mark | `guardTainted` | the op is withheld on that bar and marks its own outputs (`stats.withheldTainted`) |
| a property's VALUE reads a mark (a text, a coordinate, a scalar's source) | create / update / `setnum` | the op RUNS — Pine ran it, so ids stay Pine's order — and only that property is marked on the object |
| a clean write (the op ran and read nothing marked) | every writer | clears exactly what it wrote |
| a crossing is stepped with an unknown operand | `observeCrossings` | its answer is unknown this bar AND the next (the pair it carries) |
| an object still carries a mark at the end of the run | `finish` | held and counted (`withheld`, `stats.objectsTainted`), NOT drawn; a fill on a withheld line goes with it; a table whose cells are all unknown goes whole, a known table drops only its unknown cells (`stats.cellsTainted`) |
| a guard that is itself KNOWN and false | the curtain branch | a certain skip: Pine did not run the op either, so nothing is marked |

⛔ **Keyed on "unknown at this bar", never on a bar number.** The curtain is
whatever `readUnknown` answers; a caller whose `var`s run from bar 0 (the runtime
lane) passes none and never forms a mark — and pays nothing for the check (a fast
path until the first mark forms; measured: the runtime-lane corpus census went 9 s
→ 77 s without it, 11 s with it). So C12w's listing seed composes with it: on a
series that provably starts at the symbol's first bar the curtain lifts, the ops
are known, and no mark forms — measured on rsi-swing's capture: 11 / 11 labels and
lines, id for id, `stats.objectsTainted` absent.

**The curtain could not see an equality — found by this lane's own proof.** With
the taint in place, rsi-swing's first label still said "HH" where TradingView's
says "LH": its swing guards `laststate == 2 and isOverbought` read KNOWN-false on
every bar before 250, because `unknownMask` probes the prefix at ±1e12, and
`laststate == 2` is false for `NaN`, `+1e12` and `-1e12` alike — while Pine's
`laststate` there is 0, 1 or 2. So the run believed no swing label had been made
before bar 250 and read `last_actual_label_hh_price` at its declared 0.
`probeValuesOf` now adds a probe at every finite literal an `==` / `!=` compares
against (a prefix equal to it is exactly the value that flips the comparison).
⚠️ An equality between the state and another SERIES is still blind — named.

**Grades.** Measured first against `6d6b95d74` (before C12w landed): rsi-swing
drew the curtain case below and graded DIVERGE on counts; against `5f3e9eb28`
(C12w, which the harness hands the capture's `startsAtBar0`) it is a **MATCH**.

| script | before | after | every object drawn is TradingView's? |
|---|---|---|---|
| `rsi-swing-indicator`, from the listing (C12w + C17) | door refusal (`pine:no-output`; program refused `state:lost` ×12) | **7/7 MATCH**: lines 11 / 11, labels 11 / 11 | **yes, id for id** (1–22): no curtain, no mark; y, word, placement, the first line's `na` y2 |
| `rsi-swing-indicator`, behind the curtain | the same refusal | lines 11 / **7**, labels 11 / **6** | **yes**: TradingView's last 6 labels (HH 282.95, HL 173.56, LH 263.4999, LL 119.27, LH 208.05, HL 135.2223 — word, y, `abovebar`/`belowbar`) and last 7 lines (y1, y2), in TradingView's creation order, x mapped one-to-one onto the capture's dense ranks, each label on the one bar whose high / low is its y. The 2 labels and 1 line made off pre-curtain labels are made and held, never drawn |
| `artemis-oscillator-pro` | lines 13 / 8, labels 17 / 8 | unchanged | yes (unchanged); `guard:create` ×4 now named, below |

**Artemis' four `guard:create` — traced, named, not served.** All four
conditions (`✦ OB`, `✦ OS`, `R▲`, `R▼`) stop on ONE construct:

    var int meObCount = 0
    meObCount := meObWeak ? meObCount + 1 : 0

a running count whose `self + 1` arm never forgets its seed
(`pine.js::forgetsItsSeed`), so the bounded accumulator would count over the last
250 bars rather than since the reset — refused `pine:state` at translation, for
the plot lane and the object lane alike. The drop key, its loss class and the
member's note are unchanged; `objectDiagnostics.guardRefusals` now names it
(`create@658: pine:state \`meObCount\``, …). ⛔ Not served: the accumulator
grammar is C12's (owner-gated), and C12w's listing seed does not lift it — the
refusal happens before any series is seen. **What would settle it:** a SWITCHED
counter whose non-forgetting arm is admitted where the DATA shows a reset inside
the window — the curtain's probe moved from the prefix to the window's seed (run
the window twice at two seeds; a bar whose value does not move forgot it). That
is a change to `forgetsItsSeed`'s contract shared with the plot lane; the
vendor's three `✦ OB` and one `R▼` are the capture that would grade it.
**Served by step 28 (§ C12s)**: the counters are SWITCHED recurrences; the three
`✦ OB` are TradingView's, id for id; `R▼` converts and is refused at run time by
the node budget (132 > 128), named.

**What stays open, named.** (a) An equality against a series in a curtain
guard (above). (b) A create withheld behind the curtain still leaves this run's
object COUNT short of Pine's, so a family the collector cuts can cut at a
different moment — pre-existing (C13 withholds the cut family only for creates
lost at conversion). (c) `unknownMask` remains a probe, not a proof: a tree
mapping `NaN`, ±1e12 and every compared literal to one value while answering
otherwise for Pine's real value would still slip through.

Rails: `objectRegisterTaint.test.js` (15 cases, controls beside the rules),
`vendorHarness.c17RsiSwing.test.js` (3, the capture), `objectGuardRefusals.test.js`
(3), `objectGetterState.test.js` (the converter case re-pointed). Eleven
mutations, each red and each restored byte-exact (sha256).

## C11c — windows read further, block vars, handle copies (2026-09-30, step 27)

**First walls re-measured on the base** (`6d6b95d74`, host object pass, first op
whose guard or value refuses; the same temporary instrument C11b used, byte- and
sha-restored) — then at the tip (`1d94948c8`):

| script | base | tip |
|---|---|---|
| pro-trading-art | L24 `pine:collection` — `array.middlePrice` of a window (door: `pine:no-output`) | **served** — on the capture (from the listing, C12w) **7 / 7 lines, 14 / 14 labels, id for id: MATCH**; behind the curtain 6 / 7 and 12 / 14, all TradingView's, the first triplet withheld |
| k-clustering | L185 `pine:type` — `n_clust.get` | L185 `pine:collection` — `n_clust` is an array only ever reassigned whole (`:= array.copy(n)` in a `while`), never pushed: not a window |
| max-pain | L225 `pine:block` — a `while` in `calculate_max_pain_direct` | unchanged |
| vdubus | L193 `pine:collection` — `zzP__uctfn1`, a `var` array created per call inside `f_runEngine` | unchanged |
| trend-duration | L69 `pine:type` — `bullishCount.avg` | L69 `pine:collection` — `bullishCount` is read inside the statement that pushes it (the `trend != trend[1]` block) and its cap is an input (`samples`); and `TrendCount` (`+= 1` every bar, `:= 0` at a flip) refuses at the convergence gate (`pine:state`) |
| dual-view | L487 `pine:state` (78) + `coll:diverged` (39) | unchanged — `var` state across blocks (C12) |
| ict-killzones | L626 `pine:type` — `mg_lbls.size` (secondary; MATCH kept) | L626 `pine:collection` — `mg_lbls` is changed by `clear` |
| htf-liquidity | L135 `pine:request` | unchanged |
| institutional-smc | no host-lane refusal | unchanged |

**The approach, and why.** pro-trading-art was the one target whose every wall
was general Pine the host reader could serve exactly; peeling it by hand
(rewrites, measured on its capture) showed each wall in turn, and one rewrite
drew a double top TradingView does NOT — which is how the stale-read hazard
below was found before any code reached it. The others need an imperative
evaluator (`while` convergence, arrays built per call, a counter the gate cannot
bound) that this lane did not build: their refusals are now named for what they
are.

**What was built** (`33453ebf9`, `1d94948c8`), each railed against a Pine
replay and mutation-proved (M1–M18, 15 proofs, each red, restored by bytes and
sha256):

1. **Window reads** (`resolveWindowRead`): `max`/`min`/`sum`/`avg` and
   `indexof` over the window's elements in Pine's index order (a sum adds
   oldest-first for a push window, newest-first for an unshift one — the replays
   use decimal fractions so an order mutation goes red); a slot whose place
   depends on a value is a pick over the cap slots (out of range reads `na`, the
   C11b rule). A window passed to a user function is its parameter
   (`windowVectorOf`); a script's one-expression read method inlines at
   `recv.m()`; a method that writes does not. Built once per window per
   translation (pro-trading-art's translation 2.6 s → 0.2 s with the memo).
2. ⛔ **An unmeasured reduction is withheld, per bar.** What Pine answers over an
   `na` element or an empty array is not pinned by any capture (the runtime lane
   stops by name there). Each step whose trees reach a reduction carries
   `op.withhold` (the OR of the reductions' ambiguity); on a bar it holds the
   step is withheld and counted (`withheldUnknown`), never run off a guess — and
   the state pass treats such a step like a curtain-withheld one for getters.
   ⚠️ It is withheld BEFORE its guard is asked, so it can over-withhold a step
   whose guard was false anyway (counted, nothing drawn); it never draws.
   **Composed with C17 (the merge onto `b2a86824e`):** a withheld step marks
   everything it would have written through C17's own `taintOutputs`, so a
   getter that reads a handle the withheld step would have re-set is itself
   withheld on that bar — never read stale off the handle's previous object.
   C17 removed the blanket `state:lost` rule this step used to extend, so the
   converter-side addition went with it. Railed by
   `objectWindowReductions` ("a known handle re-set on an ambiguous bar"),
   mutation M20 (withhold without the taint: red).
3. **A block `var` with a literal seed** (`hoistBlockVars`) is one program
   variable, bound before the walk; a sibling block's same spelling is renamed in
   its scope. Only `if`/`else` bodies, only literal seeds.
4. **A destructure the block folder cannot bind** (a helper with a default
   parameter, as `drawLL` has) condemns its own names, not the block: a Pine
   function cannot assign a global. Before, `lastStart := topStart` beside it
   refused as `pine:tuple`.
5. **Handle copies.** `x := y` between two handles, and a tuple of returned
   handles (`[Line, A, B] = drawLL(…)`), are eager register copies. ⚰️ Both fell
   through with no op and no count: `topLine := Line` left `topLine` empty and
   `topLine.set_x2(bar_index)` moved nothing — a line drawn at its creation `x2`
   where TradingView extends it. Census: 7 corpus scripts write the shape, none
   served at base (H14 checked before building).
6. **A stale START read refuses** (`staleLastWord`). A `var` read at a
   statement's start, whose later reassignment the walk could not fold, resolved
   its SEED as a constant. Measured on a pro-trading-art rewrite: `topStart !=
   0` on every bar drew a double top at 531 → 552 that TradingView does not.
   Asked only where the arm would answer, so every existing refusal keeps its
   sentence (`pine.corpus` snapshot unchanged). Census: only door-refused scripts
   reach it at base (H14 checked).
7. **Sharper names**: an array that is not a window is refused as
   `pine:collection` naming why, not as "a user-defined type"; a guard whose
   read cannot be resolved is named in C17's `objectDiagnostics.guardRefusals`
   (C11c's own `unresolvedGuards` overlapped it and was folded in at the merge).
8. **An `and` with a KNOWN false operand is not unknown** (a C17 over-taint
   found in the merge). `tainted()` marked a boolean `and` unknown when ANY
   operand was, so PTA's latch `ta.crossunder(close, topLine.get_y2()) and
   extendSignal` — `extendSignal` an input, false — became unknown on the bars
   the curtain withheld `topLine`'s copy, and the `set_x2` Pine never runs
   blanked 3 of the 7 lines. A known-false operand decides `and` whatever the
   others are; `or` is NOT treated the same (a known TRUE operand would be the
   mirror, not built). Railed by `objectHandleCopy`, mutation M19.

Mutation proofs after the merge (each red, restored by bytes and sha256): M5
handle copy off, M7 withhold attach off, M8 runtime withhold off, M12 read
methods off, M19 `and` known-false off, M20 withhold without taint.

**Refused, and what would settle each:**

| script | refused on | would settle it |
|---|---|---|
| pro-trading-art (first triplet, behind the curtain only) | the warm-up curtain (bar 208 < 250) when the series does not start at the listing | **settled on the capture** by C12w (`history.startsAtBar0`): MATCH, id for id |
| k-clustering | K-means at `barstate.islast`: a convergence `while`, arrays reassigned whole, `array.median`/`stdev`, tuples of slices | an imperative last-bar evaluator; TradingView's runaway-loop rule is not pinned by any capture or doc in the repo, so a `while` would need a runtime iteration bound refused by name |
| max-pain | `while` loops building and scanning arrays at the last bar | the same; plus per-step colours (`color.from_gradient`) on computed values |
| vdubus | a `var` array per call site of `f_runEngine`, added to at two places (`ph` and `pl` blocks) | per-call windows, and a window with two add sites (a same-bar collision is unmeasured) |
| trend-duration | window reads inside the writer statement, an input cap, and `TrendCount` at the convergence gate (C12) | positional window reads + window-bound input caps; the C12 state lane for the counter |
| dual-view | `var` state across blocks, lists that lost a push | C12 |
| ict-killzones (secondary) | `mg_lbls.size` on a list changed by `clear` | a window `clear` — does not block its MATCH |

## C12s — switched counters: a reset recurrence, served where the data shows the reset (2026-09-30, step 28)

Branch `pine/c12s-switched-counters`. C17 traced `artemis-oscillator-pro`'s four
`guard:create` to one construct and named it:

    var int meObCount = 0
    meObCount := meObWeak ? meObCount + 1 : 0

a running count whose `self + 1` arm never forgets its seed, so the bounded
window would count over the last 250 bars instead of since the reset
(`forgetsItsSeed` → `pine:state`). What C17 wrote would settle it: *a SWITCHED
counter whose non-forgetting arm is admitted where the DATA shows a reset inside
the window*. Built.

**The admission (`pine.js::forgetsOnReset`).** Asked only of a body the window
refuses. Admitted when the body reads its running value only bare (`self`, never
`self[k]` — the proof is for a one-lag state) and a RESET PATH exists: from the
root, through ternaries whose condition does not read the state, to an arm that
does not read it either (`: 0`, `: high`, `: na`). A condition that reads the state
— the latch-once `na(self) ? v : self`, `self > 3 ? 0 : self + 1` — cannot be
decided from an unknown state and is no reset; a count with no reset arm at all
(`n := n + 1`, OBV by hand) keeps `pine:state`. The accumulator's seed is written
`(0 / 0) * <seed>` (`interpret.js::switchedVarSeed`): `NaN` to any reader that does
not know the mark, in both lanes, and the REAL seed for the listing pass.

**The rule, per bar and never by bar number (`interpret.js::runRecurrence`).** The
window for bar `t` starts from an UNKNOWN state (`LISTING_UNKNOWN`, "any number or
`na`") instead of a seed, and runs `stepListing`'s arithmetic: every operator
answers unknown for an unknown input except a ternary whose condition is known; a
condition that is not computable (`NaN`) is unknown too. A bar is published only
where the value came out known AND the forgetting step lies inside `(t − W, t]` —
so a published value is still a function of the last `W + 1` bars and
`maxLookback` stays true. It is one forward pass and exact, not an approximation:
with one lag, a step that answers known from an unknown state makes every later
step known, and a result that came out known from an unknown input is the same
result for every concrete one. ⛔ Not "run the window at two seeds" (C17's sketch):
two concrete seeds that agree prove nothing about a third — `max(self, x)` answers
alike for seeds 0 and 1 while `1e6` stays — so the window starts from the abstract
unknown value instead, which stands for every seed at once. Everywhere else the bar is not computable exactly as
the curtain is (`NaN`, or `prefixProbe`). A bar below the warm-up whose reset lies
inside the data IS published. From the listing (C12w) the real seed is used, and a
bar the listing trajectories disagree on falls back to the switched column from bar
0, so the listing run is never less known than the curtain.

**What reads an unknown switched bar is withheld — read off the tree, then
probed.** A switched column's own value is proved; what a tree DOES with an unknown
one needed its own rule, and the first draft (probe agreement alone, C17's
`unknownMask` idea applied at the plot root) was measured wrong: on
`btc-charlie-trader-xo-macro-trend-scanner` over AGEN 1D its Bear shape read a
confident 0 on bar 24 where the same script run from the listing reads 1 —
`countSell > 0 and countSell < 2 and countBuy < 1` over TWO unknown counters is
false under every single probe value (one value stands for both, and ±1e12 misses
the range). So:

| mechanism | where | what it catches |
|---|---|---|
| the **dependency mask** (`switchedDependencyMask`) | both lanes, plot root and object `unknownMask` | `maxLookback` is a tree sum: a path from the root down to a switched node adds at most `maxLookback(root) − maxLookback(node)` bars of reach, so a root bar is withheld when any bar inside that reach is one of the node's unknown bars (where it answers `+1e12` and `−1e12` differently). A proof, given the lookback contract. A switched node under `tf` / `sym` reads other bars: that tree is withheld whole |
| the **probe** (`probeValuesOf`, moved into `interpret.js`) | both lanes; the object lane probes a switched tree over the WHOLE series | a dependence the declared reach under-claims: `ema` carries its state forever and declares only its period, so `ema(counter, 3)` still depends on an unknown bar far past 3 |

Every rail below was proved by its own mutation; neither mechanism alone passes
them. The plot lane evaluates a switched tree once plus two probes per switched node
plus one per probe value; a tree with no switched recurrence takes the single pass,
byte for byte as before.

**Grades.** Base `0fd35f415` (C11c on C17; objects MATCH 28 / 47, overall 24).

| script | before | after | TradingView's? |
|---|---|---|---|
| `artemis-oscillator-pro` (from the listing — the capture) | labels 13 / 17 (the four creates dropped at the door) | labels **16 / 17** | **yes, id for id**: the three `✦ OB` are ids 5, 12, 13 at TradingView's y (within 1e-12 relative — `oscVal + 7`); every id after them now in TradingView's order up to the missing `R▼` |
| `artemis-oscillator-pro` (behind the curtain) | — | the three `✦ OB` drawn | yes: each at a TradingView `✦ OB` y, and every label drawn is one the listing run draws |
| `artemis` `R▼` | `guard:create` (pine:state) | still unmade, **named**: its guard tree measures 132 nodes against the 128-node budget (`budget:nodes`, the layer's `unreadableGuards`) | — |
| `ema-ribbon-trend-filter-strixedge` | cells 33 / 48 | cells **34 / 48** | **yes**: cell (3, 1) `8` — TradingView's text, text colour `#d1d4dc` and background `#131722`, at its address, both with and without the listing fact |

Both captures are on the 47 and in the committed harness dir; neither flips a family
(a label and a cell short elsewhere), and nothing is drawn the vendor lacks.

**Scripts the change newly serves, and how each is held exact.**

| script | where | switched construct | check |
|---|---|---|---|
| `btc-charlie-trader-xo-macro-trend-scanner` | member door **attaches** (both flags), 6 plots | `countBuy` / `countSell`, each reset by the other side's bar | no capture: AST lane behind the curtain vs the SAME tree from the listing, AGEN 1D 2,000 bars and RDDT 1D 632 bars — **0 disagreements, 0 bars published the listing withholds** (`switchedServedScripts.test.js`) |
| `keltner-center-of-gravity-channel` | member door **attaches** (both flags), 19 plots + 2 tables | `up` / `dn` (`naz ? … : na`) | same, 0 / 0; and with its supertrend mode forced on (at the door `jz` folds to its default, so `up` / `dn` are `na`): the reset arm `na` is never taken, so the curtain withholds `up` / `dn` on every bar — exact from the listing |
| `25-spy-expected-move-by-vix` (community) | `translatePine` ok (was `pine:block`); the door still refuses on the `for` @56 | session VWAP sums, `start ? x : x + x[1]` | exact per bar from the last session start in the window |
| `mid_engagement__16-ict-smc-guide` (OOS) | 18 → 4 `pine:state`, flat outputs 2 → 12; the door still refuses | session highs / lows, `newS ? high : inS ? max(nz(h, high), high) : h` | the rule |

`cc-yata` moves from `pine:state` to `pine:timeout` (the translator's expansion
depth on `buyCounCC8Close`); `relative-volume-candles` (OOS) to `pine:function`;
`market-profile-tpo` (OOS, after the C11c merge) loses its two `pine:state` and
keeps its four `pine:tuple`. All three still refused.

**What stays refused, named, and what would settle it.**
- `R▼` / `R▲`: `budget:nodes` (132 > 128). The guard carries `meRevExhObBar`'s
  accumulator twice; a node count that measures a shared subtree once is a
  budget-semantics ruling (never a raised cap), and the vendor capture already
  holds the `R▼` that would grade it.
- A reset that never fires in the data (keltner's supertrend `up`/`dn` with the
  mode on; any streak longer than the window): withheld on those bars — correct,
  the state is genuinely not in the window.
- A reset through a condition that reads the state, and a lagged read `self[k]`
  in a switched body: `pine:state` at translation (and `interpret:recurrence` by
  name should a hand-built tree carry one). A multi-lag proof (every lag known after
  `L + 1` consecutive forgetting steps) and a corpus case would settle the second.
- A switched node under `tf` / `sym`: its whole tree is withheld. Mapping the
  child's unknown bars through the resample would settle it.
- The residual C17 names stays: the probe is a probe. The dependency mask is a
  proof under `maxLookback`'s tree-sum contract; a reader that under-claims its
  reach AND answers every probe value alike would slip through.
- No vendor capture yet for btc-charlie or keltner-cog: a capture of each on RDDT
  1D (and one intraday for spy-expected-move's VWAP) would grade them against
  TradingView rather than against our own listing run.

Rails: `switchedCounter.test.js` (gate, exact against a hand Pine reference under
four seeds, withheld exactly where no reset lies in the window, the listing pass,
the probe fill, the root agreement, a range over two unknown counters, a `NaN`
condition, the entering state, parity), `switchedWithholding.test.js` (both
mechanisms, both lanes), `switchedServedScripts.test.js`,
`vendorHarness.c12sSwitched.test.js`, `test_ast_switched_counter_parity.py`
(one fixture, both lanes). Moved rails updated with the reason: `pine.runLength`
(six counter shapes that refused are now served, each checked bar by bar against
the recurrence run by hand), `objectGuardRefusals`, the community roster, guards,
door scorecard and timeframe rails, the OOS measured baseline, `param-ids.json`
(ict-smc-guide gains ids 7–13 appended; refused at the member door).

## C18 — `while` loops, and last-bar values from the runtime lane (2026-09-30, step 29)

**The loop rule.** A `while` runs its body until its test is false, re-reading the test before every pass. A loop that stops is exact: its only semantics is its body. A loop that does not stop is not approximated: at `WHILE_ITERATIONS` = 10,000 passes in one entry (`runtime/limits.js`, a peak reset every time the loop is reached) the run stops with `RuntimeLimitError` carrying the line and bar, and the object reader reads nothing from it (`runtime:WHILE_ITERATIONS`). ⛔ The bound is an ENGINE limit, not a Pine claim: Pine stops a loop on elapsed time, and no capture or document in this repo pins that number.

**The read.** `pine.js` (`rtCheck`) replaces a last-bar op's imperative value with `__uct_runtime_at(k)` and a guard it cannot read with the statement's REACHED signal; the program carries `runtime: {v, source, at}` (validated by `assertRuntimeProgram`). `pineRuntimeFrontend.objectTreesAt` emits each value AT the statement, before it. `runtimeColumns.runtimeObjectValues` runs the script once and serves a value only (1) from the listing, (2) at default inputs, (3) when the run completes, (4) where two probe runs (`RUNTIME_PROBES`) agree; anything else is unknown and C17's taint withholds it. A text / colour / array value is left out by name. A runtime-fed drawing with a property the columnar door cannot read is dropped WHOLE (`runtime:prop`). A script the runtime lane cannot build re-runs the pass without the check, byte-identical to before. Registered by the member door only (never imported by the chart); unregistered = withheld (`runtime:not-loaded`). A document carrying `runtime` is never compacted to a graph.

**Measured (RDDT 1D, `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1`, base = `integrate/wave5` `fb846eaef`).** max-pain: cells 12 → 16/16 with texts; lines 0 → 2 (max-pain line, zero line: y, colour, width, style); labels 0 → 3 (GAMMA EXPOSURE, MAX PAIN ZONE, PAIN HEATMAP). k-clustering: exact on the runtime lane (`vendorHarness.c18KClustering`), withheld on the product path by `INSTRUCTIONS_PER_BAR`.

**Still refused, and what would settle each.** k-clustering — an owner ruling on `INSTRUCTIONS_PER_BAR` (its last bar needs ~800k). max-pain's in-loop drawings (7 lines, 4 labels, 13 boxes' worth) — per-iteration creates in the runtime lane. max-pain's pin box — a runtime colour channel (`color.new(red, <input>)`). max-pain's NET label — runtime text values. A saved document reloaded before the member door has loaded — withheld (`runtime:not-loaded`). The Pine loop limit itself — unmeasured (time-based).

## C19 — the node budget counts what the evaluator computes (2026-09-30, step 30)

Branch `pine/c19-shared-budget`. Integrator ruling (2026-09-30): the member-door node budget
(`budget:nodes`, 128 per tree, **not raised**) may count a SHARED subtree once, but only where the
evaluator genuinely evaluates it once; a subtree textually repeated but evaluated separately still
counts every time.

**Measured first, and the premise was half-true.** The count was ALREADY `structuralMaps().distinct`
(`nodeCount`'s own docstring: "DISTINCT, NOT TOTAL"), so `R▼`'s 132 was not a total: its guard
carries two DIFFERENT accumulators (`accum#20` and `accum#54` read different bodies), not one twice.
What the ruling changes is the other direction, in two places:

- **Across a pass.** The object lane interns its trees (`makeInterner`) and shares one `crossMemo`,
  so a subtree an earlier tree computed is answered without walking below it. `R▼`'s guard is 132
  units standalone and **36** against what the pass already holds — that is its real cost.
- **Where the old count under-counted.** A shape repeated where the evaluator does NOT share it:
  under another `tf`/`sym` scope (a fresh `interpret` on other bars), an operator reading `self`
  under two recurrences (two running values), and a spine read back from JSON (the step memo was
  keyed on the OBJECT, so an unshared document paid for every path while `distinct` charged one).

**The rule (`interpret.js::evaluationUnits`, `ast_interpret.evaluation_units`).** A unit is the key
the evaluator's memo uses: a self-free node or a READ (literal, column, `self`, `self[k]`) once per
(scope, shape); an operator/call that reads a recurrence bind once per (scope, recurrence, shape);
a `tf`/`tf_live`/`sym` child is a scope of its own. `held` (the caller's pass memo) makes a
root-scope column one read — through `passHolds`, the SAME predicate `evalNode` skips on, read off
one `passView` object that both call (derived, never restated). A shape is held only when every
object of it is. The evaluator side: `runRecurrence`'s step memo, plan and history-only listing walk
key on the structural id (the bar-0 listing read keeps object keys — each read site is its own
reading there, and C12w's enumeration depends on it). Probes (`unknownMask`) read the pass's
columns of recurrence-FREE subtrees over the same bars (`probeBase`: no probe value can move them)
and are charged for what they compute; a probe the budget still refuses withholds every bar — never
the `null` that publishes them.

⛔ **A bind read computes nothing.** The first draft counted `self` once per recurrence and detached
`keltner-center-of-gravity-channel` at the install door (out11: 128 distinct → 132; five
recurrences each read `self`). `self` is a slot of the step's history, read like a literal or a
column, so it is one unit per shape per scope; what a recurrence COMPUTES per step (its spine's
operators) is keyed on the recurrence. Census 0 rows changed after the correction.

**Grades** (base `fb846eaef`): `artemis-oscillator-pro` labels 16 → **17 / 17, id for id** from the
listing (the capture): `R▼` is TradingView's id 16 at its y, on `D▼` id 15's bar; behind the curtain
it is drawn and every label drawn is one the listing run draws. Objects still DIVERGE on table cells
(18/21 — C10 intraday rows, C12). No other script moves: census 266 × both flags 0 rows changed; the
object-lane refusal scan of the committed corpus (45 object scripts × listing on/off, RDDT 1D bars)
moves only artemis and leaves 0 `budget:nodes` refusals.

Rails: `ast/sharedBudget.test.js` (counted once AND run once — within a tree and across a pass, with
`stepSink`; counted twice AND run twice — `tf` scope, `self + 1` under two recurrences; a JSON
read-back DAG spine steps in linear time; the cap unmoved — standalone refused, own new work over 128
refused, an un-held twin computes), `__tests__/objectBudgetProbe.test.js` (a probe never reads a
recurrence column; reads a recurrence-free one for one unit and gets the exact mask; refused → every
bar withheld), `tests/test_ast_c19_shared_budget.py` (the twin, run counts by a `_POINTWISE` spy),
one fixture both lanes (`tests/fixtures/ast/c19_units.json`), `vendorHarness.c12sSwitched` (`R▼`
served). Each proved by its own mutation (13).

**What stays, named.** Probes and the switched root agreement are a fixed multiplier of a tree's
evaluation that the per-tree budget does not model (unchanged); a probe over a TRUNCATED series
(non-switched trees) does not read the pass's columns (`barstate.*` answers at a series' end). The
plot lane's registration check stays standalone per tree (a plot pane has no pass at the door); only
its runtime check reads the pass memo, which can only admit more.

## What is left, ranked by scripts it would move

| rank | class | scripts (primary) | what it needs |
|---|---|---|---|
| 1 | C11 arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus (9) | the collection/UDT grammar in the object lane — the largest single gap, and a design wave rather than a fix. **Step 14** closed runtime-front-end gaps (methods, array members, global reads) with no grade moved; the runtime object lane still builds none of the nine and is unrouted — see § C11. **Step 19 (C16)** served the host-lane wall two of the nine hit FIRST on their drawing LISTS (length reads, eviction, list edits in loops — institutional-smc, dual-view): smc's zones now AGREE; dual-view and the other seven stop on UDTs, numeric arrays or `var` state — see § C16. **Step 24 (C11b)** served it on the HOST lane rather than routing (the runtime object lane builds one of the nine and answers at the wrong position): ict-killzones MATCH, htf-liquidity's lines and labels id for id; the other seven stop on `var` state, UDT fields, `while`, per-call arrays, user read-methods or reductions — see § C11b. **Step 27 (C11c)** served pro-trading-art (**MATCH, id for id** on its from-listing capture; behind the curtain 6 / 7 lines, 12 / 14 labels, every one TradingView's) and named the rest: k-clustering and max-pain need an imperative last-bar evaluator, vdubus per-call windows with two add sites, trend-duration positional window reads and the C12 counter — see § C11c |
| ~~2~~ | ~~C12 values or `var` state computed across a multi-statement block~~ — **steps 15–17**; the curtain on a from-listing series: **step 25 (C12w)** | atr-sr **MATCH**; smc 13/18 lines, market-structure 5/6 lines and 18/22 labels with **no wrong object left** | what remains of C12 is the WARM-UP CURTAIN: `accum` is not computable before `PINE_STATE_WARMUP` (250) and an object that reads it there is now withheld (step 17) rather than drawn off a guess. Settling it needs the owner-gated question in `pine.js::PINE_STATE_WARMUP` (a `var` seeded from where a fetch starts), not a fix. `position-size-calc` re-traced to `syminfo.root` (rostered unserved) + C10; `rsi-swing` to C14 (a getter written into `var` state, and getters as coordinates) — neither is C12. **Step 26 (C17):** behind the curtain, what a withheld op would have written is now MARKED per bar and per property, and its readers withheld — rsi-swing draws TradingView's last 6 labels / 7 lines and nothing else; and the curtain now sees an equality against the state (`laststate == 1`), which it read as known-false — see § C17. **Step 28 (C12s):** a counter with a RESET arm is served as a switched recurrence, exact per bar where the data shows the reset (artemis' `✦ OB` ×3 id for id, ema-ribbon's bars-in-trend cell, two scripts attach) — see § C12s |
| 3 | C10 `request.security` in object text/coordinates — **step 20: every form the seam computes is served** (linear-regression MATCH; artemis' MTF panel) | artemis, ema-ribbon, linear-regression, vold, liquidity-heatmap (5) | the seam was already there (§ C10). What is left is refused BY NAME and each needs something the bar series does not hold: an intraday timeframe below the chart's own (artemis 15m/1h/4h values never shown; ema-ribbon 15/60/240 rows; liquidity-heatmap's pivots), another symbol (vold `USI:*`, htf-liquidity, position-size-calc), a multi-period code (`3M`, `3D`, `2M`), and a `timeframe.*` read inside a request at another timeframe (liquidity-heatmap's `resolutionInMinutes`) — the capture that settles each is in § C10 |
| 4 | ~~C8 clock builtins: `time_close`, `timeframe.change`~~ — **done, step 9** | liquidation-levels, poor-man, rsmi, adr, htf-footprint (5) | measured and built; none of the five is blocked by it any longer (each now stops on C15, C12, C11/C13) |
| ~~5~~ | ~~C9 a history offset that is an expression~~ — **done, step 22** | extrapolated **MATCH**; artemis 8/13 lines, 8/17 labels, no wrong object; smt → C10 | what remains is named in § C9: no `max_bars_back` declared, a `max_bars_back(x, n)` call, a reassigned source — each refused by name |
| ~~6~~ | ~~C7 vendor GC slack~~ | — | **done** (`c5e63beea`): all three MATCH id for id; see § C7 |
| 7 | C13 drawing functions the inliner refuses (`in-expression`, `conditional-history`, `loop`) | OHLM, TSR (+ adr secondary) (2) | **`conditional-history` under input-only guards: done, step 13** (OHLM's 44 → 0). What remains of C13 is refused by name and each stops on another class — see § C13: OHLM's lines/labels (C8, C15, C14), TSR (C11), adr (C11 + C10) |
| 8 | C8 `chart.left_visible_bar_time` | sector-rotation (1) | not answerable on a bar series (it is viewport state) — a named refusal is the correct end state |
| 9 | C15 remainder (after step 14) — every C15 script now stops on another class | ema-ribbon (C10 MTF cells, C12 `trendBars`/`f_strengthBar` loop), vold (C10), artemis (C9/C10/C11/C12) | named, not built: (a) **v6 `timeframe.period` spelling** — the withheld ema-ribbon cells need the one value three lanes read changed (vendor evidence so far: on a v6 1D chart `timeframe.period == "D"` is FALSE, capture `ema-ribbon-…-2026-09-28` cell (0,9) `   1D`); a capture that prints `timeframe.period` itself on a v6 D/W/M chart settles it. A refinement that serves a branch whose OUTCOME is the same under both spellings (ema-ribbon's `f_tfLabel`: `"D" => "1D"` and default `=> timeframe.period` both give `1D`) would recover (0,5) without it. (b) **a position built by concatenating `input.string`s** (`vold`: `i_tableYpos + "_" + i_tableXpos`) is dropped (`enumUnreadable`, `table.position@15`) and falls to Pine's default `top_right`, which equals the vendor's `pos` at the only value the member door can have (input strings have no knob) — correct today by construction, not built. (c) **artemis' wrong cells are C12's** (see step 13) — the one case in this lane where we DRAW a text the vendor lacks |


## Rulings, 2026-09-29 (owner delegated both to the integrator: "you decide all of that for the indicators")

**R-W: the warm-up curtain (`pine.js::PINE_STATE_WARMUP`) STAYS, and gains one exact exception.**
- Default unchanged: a translated `var` accumulates over a bounded 250-bar window, and any value or
  object that reads it inside the warm-up is WITHHELD by name. Seeding from wherever a fetch starts is
  REJECTED: that value changes when a member pans, and it matches TradingView only if our first bar is
  the vendor's first bar, which we cannot know in general. A guess drawn on the chart is worse than a
  named refusal (standing rule).
- The exception, and the only one: when the loaded series PROVABLY starts at the symbol's first-ever
  bar (the fetch returned fewer bars than it asked for, so history is exhausted), our bar 0 is the
  vendor's bar 0 and a `var` seeded there is exact, bar counters included. That case may seed from
  bar 0 and lift the curtain. Queued as lane **C12w** after C9 / C11b / C14; it needs the "history
  exhausted" fact threaded from the bars fetch to the engine, and a vendor capture on a recent-IPO
  symbol (whole history under 5,000 daily bars) as its witness. Until C12w lands, nothing changes.
- **Landed as step 25 (§ C12w).** The "history exhausted" fact is established from the listing
  date, not from a short fetch (why: § C12w); witnesses: market-structure and smc MATCH id for id,
  trend-duration's HMA MATCH. Bar counters stay refused at the door — § C12w names what would
  settle them.

**R-R: `syminfo.root` is served as `syminfo.ticker` for the equities this engine screens, ONCE MEASURED.**
- Pine's documented behaviour is that `root` equals `ticker` for any symbol that is not a derivative.
  Under the file's own rule (an unconfirmed spelling is never served) that is a prediction, not a
  witness, so the field stays in `symbolScope.json::unserved` until `probes/syminfo-roster.pine`
  (already written, row 1 of `docs/pine/OWNER-CAPTURE-PACKET.md`) is captured on SPY / AAPL / BRK.B / F.
- If the capture shows `root == ticker` on every equity witness, move `root` from `unserved` to a
  served name that folds to the ticker, with the capture as its witness. That unblocks
  `position-size-calc`'s ten cells as far as C10 allows. If any witness disagrees, it stays refused
  and the reason is rewritten to name the measurement.
