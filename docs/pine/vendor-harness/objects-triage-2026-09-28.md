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
| 31 | C20 runtime TEXT, runtime COLOURS and drawings made INSIDE a `while`, read off C18's one run under C18's four serving conditions (listing R-W, inputs at defaults, run completes, probe runs agree — else unknown and C17 withholds). **(a)** a string only the run holds is `{t:'str'}` over a text-kind placeholder; a number in a text stays `{t:'num', fmt}` formatted by the object runtime (the run is never asked for a node with a call but `math.*`/`na`/`nz`). **(b)** `color.new(c, t)` is `{c:'new'}` — `c` read here or from the run, `t` set per bar by the object lane's one alpha formula (`withObjectTransparency`, shared with `staticObjectColourOf`); any other run colour is `{c:'rt'}`, served OPAQUE only (the run's packed byte does not round-trip to TradingView's opacity: NET label alpha 77 vs 76); an unserved colour HOLDS the object. **(c)** a last-bar `while` whose body is only statement creates becomes a counted loop `0..N-1` over the run's own pass count; each body op is REACHED and valued per pass, never from the columnar lane. And the C18 census slowdown (real: wave 5 51.2 / 49.7 s vs C18 56.2 / 59.6 s test time, alternated) is removed: the plain object pass runs first, the lane is asked only when it could help, and unbuildability costs one compile, not a second pass. See § C20 | `8aa99927a`, `8e2dcf062`, `3fc74942e` + merge onto wave 6 (`3cbcc5008` over `6415ef77c`) | 28 / 47 → 28 / 47 objects MATCH (overall 24 → 24; base `6415ef77c`, objects pane on) | 218 / 266 → **219 / 266** (max-pain lines agree) | `options-max-pain-calculator-backquant` lines 2 → **10 / 10**, labels 3 → 6 / 8, boxes 0 → 1 / 13 — **every object drawn is TradingView's, value for value** (y1/y2, colour, width, style; text, y, colour, text colour, style, size; the pin box's top, bottom, `color.new(red, <input 80>)` background and border) and **our ids sort as TradingView's** (the strike levels, gamma bars and their `#.##` labels pass by pass, the NET label `NET: SHORT\n98314.6`), x in the capture's rank order (`vendorHarness.c20MaxPain`). The 12 heatmap boxes and 2 legend labels (`color.from_gradient`) are WITHHELD at run time (`withheldUnknown` 14), never painted a guess. Committed harness dir (82): the same 1 entry changed (families 253 → 254 / 301), overall MATCH 38 unchanged, inventory identical. Member-door census 266 × both flags: attach 41 / 64 unchanged; 1 row — max-pain flag OFF moves from `pine:objects-only` to the clean-objects-only sentence (its program no longer drops ops; k-clustering's C18 move). Only max-pain and k-clustering read the runtime lane in the corpus; k-clustering stays withheld by `INSTRUCTIONS_PER_BAR` (not raised). artemis labels 17 / 17 held. Census alternated vs `6415ef77c`: 34.9 / 37.2 s base vs 37.7 / 38.4 s after (box noise ±3 s; per-translation cost of the whole corpus with the check 8.19 / 8.20 s base vs 7.86 / 8.08 s after). Notebook first-open 1,868,808 B unchanged (PASS); total JS +9,015 B. `paramIds.test.js` green, no re-pin |
| 32 | C21 dual-view: every wall re-measured and named, and a WRONG VALUE in the runtime lane fixed — a plain declaration was lowered as a persistent slot whenever any declaration of the same NAME said `var` (`pineRuntimeFrontend.js::declarationPersists`: a declaration persists exactly when it says `var`); the persistent bound covers every function's frame, called or not (`lowerIr.js::persistTotal`); an inlined function's mutable local is named for what it is (`HELPER_LOCAL_CLAUSE`, `guardRefusals` ``… (a `var` carried in a loop of `f`)``) and `collsDivergedWhy` names the first change each diverged list lost — see § C21 | `pine/c21-dual-view` | 28 / 47 → 28 / 47 (overall 24 → 24; base `c4ddd0418`, objects pane on; runtime pane on 29 → 29) | 219 / 266 → 219 / 266 (runtime pane on 226 / 273 → 226 / 273) | **none moved, measured**: dual-view stays a door refusal of its drawing, every wall named — its last bar needs 281,431 VM instructions (`INSTRUCTIONS_PER_BAR` 200,000, not raised). By substitution of its seven exact compile walls and a test-only ceiling, the runtime run now finds TradingView's 43 patterns in creation order and the floating `Dark Cloud Cover` at candle 3 (was 51, first at candle 6) — `vendorHarness.c21DualView`. The runtime lane defect is not live in production (runtime pane dark; C18/C20 not on `origin/production`). Committed harness dir (82 graded, both runtime flag states): 0 entries changed (objects MATCH 46 / 47, overall 38 / 39). Member-door census 266 × both flags: 0 rows changed (attach 41 / 64). Census build alternated: base 42.6 / 40.6 s, tip 41.3 / 37.2 s. Notebook first-open 1,868,808 B (PASS). `paramIds.test.js` green, no re-pin |
| 33 | C22 trend-duration-forecast and vdubus-pattern-gen: (1) an `else` arm of an object `if` chain negates EVERY earlier condition (it negated only the last — a wrong picture, live); (2) a switched counter's reset may read another `var` (`forgetsOnReset` asks the NEAREST recurrence's `self`); (3) a window read is judged WHERE IT STANDS (`readVerdict`: after the last writer, or in an arm that excludes the add, served; in the add's arm, between add and removal, or above it, refused by name), an `input(…)` cap served at its default / the member's value (never minted); (4) a lost setter that moves an object is a per-bar MARK (`lostGeometryOp`) — an object left at its creation coordinate is held, never drawn short; an unmeasured reduction read only in a property marks that property; (5) a `var` array declared in an inlined drawing function is its CALL SITE's window, added to at several places (`multiSiteWindow`: the last site that ran; a bar two sites may both add on withholds every read while among the last `cap` events), `array.size(w) >= K` as one slot's existence, an inlined body's `if` chain over plain locals folded to a value (`foldLocalChain`; never a `var`), and text picked per bar between literals compared with a written literal as 1 / 0 (`textEqTree`, object pass only) — see § C22 | `01db64a91`, `2da14a2ad`, `53d7a12be`, `7fc4c8cc5`, `783ed6a50`, `564a19d79`, `ba4de2ff7`, `7320d7434` + merges onto wave 7 (`9a6c437e4` over `ad696e660`, `265276296` over `7bb036d1c`) | 28 / 47 → 28 / 47 (overall 24 → 24; base `7bb036d1c`, objects pane on): vdubus DIVERGE → **MATCH**, volume-profile MATCH → DIVERGE (3 lines it drew WRONG are now held) | 219 / 266 → **222 / 266** | **vdubus** lines 0 → **112 / 112** (x rank, y, width, colour, creation order), linefills 0 → **48 / 48**, labels 0 → **5 / 5** (`vendorHarness.c22Vdubus`). **trend-duration** labels 0 → **26 / 28** (text and y, TradingView's order), table cells 0 → **4 / 34** (the average row and, with C25's counter condition, the two headers — address, text, colour), its one line 1 → 0 (ours sat at x2 = its creation bar; TradingView's is extended by a getter this lane refuses) (`vendorHarness.c22TrendDuration`). **htf-footprint** cells 1 → 2 / 2 (`BEARISH`, `#FD0318`). **volume-profile** 203 → 200 lines: the POC / VAH / VAL lines were drawn at bar 0, y 50.44, where TradingView draws 150.4 / 178.7 / 136.7 — now held. 47 captures flag off: objects MATCH 18 → 18, families 106 → 105 / 119 (trend-duration's wrong line held). Committed harness dir (82 graded): on 46 → 46 (overall 38 → 38, families 254 → 257 / 301), off 36 → 36 (141 → 140 / 154) — flag on the same four entries as the 47, flag off trend-duration only. Member-door census 266 × both flags: attach 41 / 64 unchanged; 2 rows, one script — `trend-levels-chartprime` stays refused, `pine:state` → `pine:window` (its next wall). Door object programs: 20 of 266 differ from `7bb036d1c` — 15 exactly the pre-merge C22 program; trend-duration, dual-view, fair-value-gap and open-interest-suite C22 composed with C25 (dual-view gains C22's marks inside C25's loop, drops and trees identical); volume-footprint (door-refused) lacks one ORPHAN constant tree C25's build minted and no op reads. Census build alternated vs `7bb036d1c` (loaded box): 42.0 / 42.1 s base, 46.6 / 45.2 s tip. Door translation: renderingnature 425–552 → 938–1412 ms, vdubus 128–161 → 712–889 ms, trend-duration 48–88 → 118–190 ms. `pine` chunk 301,731 → 325,123 B; notebook first-open 1,890,726 B (+0, PASS). `paramIds.test.js` green; append-only pins for two door-refused scripts (`2da14a2ad`) |
| 34 | C23 the runtime lane SERVES A PANE with the host lane's own definitions — the seven compile walls C21 measured by substitution and the eager v6 `and`: (1) `buildRuntimeIr({pane: true})` hands the columnar resolver the host's pane contract (`Resolver` `strict`, the chart's period, the forming-bar tri-state), so `barstate.isfirst`, the clock and (2) `timeframe.change` are the plot lane's columns (unset = the screen, refusals kept); (3) which `request.security` is the identity is `pine.js::Resolver.requestTargetOf` — split out of `securityAsNode`, one reader of symbol, period, base-period guard and every `lookahead` spelling — never asked for a symbol/period argument that reaches a runtime slot; (4) `math.avg` over runtime state is `BUILTIN_CALL_TREE.avg` rebuilt over the call's own arguments (arity from `BUILTIN_CALL_TREE_MIN_ARGS`, read by both lanes); (5) `input.color` is its default colour (`inputColourDefaultNode`, the host's every colour reader), minting nothing; (6) `syminfo.mintick` is settled at BIND from the chart's symbol (`symbolScope.json` tick table, refused by name where it has no row) — the two compile-only doors leave it to the binding (`symbolAtBind`); (7) `alert()` is a presentation no-op whose arguments are evaluated only where evaluation can change something; (8) v6 `and`/`or` are lazy for EVERY operand, a NaN operand read as Pine's false (`JUMP_IF_FALSE`'s reading); v4/v5 stay eager — see § C23 | `pine/c23-runtime-pane` | 28 / 47 → 28 / 47 (overall 24 → 24; base `db6190f3f`, objects pane on) | 219 / 266 → 219 / 266 | **none moved, measured.** dual-view now BUILDS in the runtime lane as written and finds TradingView's 43 patterns in order and the floating `Dark Cloud Cover` with NO substitution (`vendorHarness.c21DualView`); its last bar needs **247,425** instructions (with the rail's hooks 256,060; C21's substituted run 290,066 at `db6190f3f` — the lazy `and`s are the difference) against `INSTRUCTIONS_PER_BAR` 200,000, not raised — still withheld, and its drawing still stops on the host walls (`pine:state` ×29, `coll:diverged` ×39). k-clustering (v5: eager, unchanged) 800,777; max-pain served values unchanged (`vendorHarness.c20MaxPain`), last bar 11,710 → 11,742. Runtime compile census (266, both doors): builds 23 → 29 / 22 → 28 — dual-view, deadband-hysteresis-filter (mintick), fibonacci-dolphintradebot and price-action-…-trendline (alert), mcclellan-indicators (`ta.cum` on a pane), visualizing-displacement-tfo (colour input); none of them attaches differently. Committed harness dir (82): 0 entries changed (objects MATCH 46, overall 38). Member-door census 266 × both flags: 0 rows changed (attach 41 / 64); with the dark runtime-pane flag on, 0 rows changed (43 / 66; control: the flag itself moves 6 rows). Census build alternated: base 50.4 / 30.5 s, tip 34.2 / 29.3 s. Notebook first-open 1,868,808 B (+0, PASS); total JS +4,444 B. `paramIds.test.js` green, no re-pin |
| 35 | C25 a loop's PASSES on the host object lane — (1) the COUNTER is known per pass: `loopArgRef` follows a block local bound to counter arithmetic, read in the scope it was bound in, and the address grammar gains `/` (Pine's fractional division, `interpret.js::BINARY`) and one-argument `math.round` (`POINTWISE.round`) for a midpoint; (2) a CONDITION on the counter (`if i == 0 and …`) is lifted into the live guard grammar (`cmp`/`bool` over `{v:'loop'}`) and latched where its `if` stands; (3) a helper's `var` declared inside its loop is ONE runtime scalar per call site (`program.nums[].loop`) — initialised once, written by every whole `:=` where it stands (`setnum`, any value the grammar carries), read whole (a coordinate, a comparison, `na(x)` as `not (x == x)`), served only when every write is carried and otherwise refused naming the write that stops it; (4) an object a lost step would have MOVED, through a handle a LOST copy read out of its list, is withheld (`geometry:lost`/`geometry:withheld`); a loop left holding only latches is `loop:empty`; `loopBoundsWhy` names a loop's bound refusal. Host lane only (`hostPasses`; the runtime lane's object pass is byte-identical over the corpus) — see § C25 | `3e9ae8560` | 28 / 47 → 28 / 47 (overall 24 → 24; base `d6bb8b336`, objects pane on) | 219 / 266 → 219 / 266 | **none moved, measured.** dual-view: `coll:diverged` 39 → 18 (ten lists → five: the five floating lists' bar-0 pushes convert), `loopValuesUnresolved` 7 → 0; the floating boxes and wicks are HELD (`geometry:lost` 3); the 29 `pine:state` guard refusals now name the first wall — pass 0's `htf_o := current_htf_open`, a `var` whose block fold stops at the windows' `while` (line 627: C22's boundary, unlanded). The door still draws nothing (a lost removal). Door object programs: 7 of 266 changed, every one door-refused elsewhere (`fair-value-gap` withholds 2 more create sites whose objects a lost move would have left where they were made; `stop-loss-clustering` gains 40 counter-guarded cells; the rest re-worded or identical). Committed harness dir (82): 0 entries changed (objects MATCH 46, overall 38). Member-door census 266 × both flags: 0 rows changed (attach 41 / 64). Census build alternated: base 33.1 / 30.7 s, tip 29.0 / 29.1 s. Notebook first-open 1,868,808 B (+0, PASS); total JS +6,195 B. `paramIds.test.js` green, no re-pin |
| 36 | C24 translation speed without moving a saved parameter id: the comparison probe (`boundedBarssinceThroughBinding` → `constIntOf`) still resolves both operands FIRST, exactly as before, so every Track F id is minted in the same order; its tree is REPLAYED for the repeat (the swapped re-probe and the ordinary path's resolve) by `Resolver.resolveProbed` — only into the scope it was made in, only when the probe did no first-time work (`firstTimeMark`: a mint, a `Map`/`Set` field growing, a window `readMemo` filled), with the probe's steps charged to `budgetSteps` and a real resolve wherever those steps would pass the cap — see § C24 | `d641a06d4` | unchanged by construction (every `runOurSide` run on the 47 is byte-identical) | unchanged by construction | **none moved, measured byte for byte:** every `translatePine` result and `inputParams` list (manifest + plain) for 320 scripts, every member-door build for the 266 × both objects flags, every `runOurSide` run + door build for the 47 captures, and every Resolver's final `budgetSteps` — identical before/after. `mid_engagement__22-rsi-levels-regime-map` translation 1.56–3.26 s → 0.68–1.22 s (5 alternated rounds, ×1.9–2.8), its member door 3.0–7.0 s → 1.5–2.9 s; corpus translate (320 × 2) 17.8–34.0 s → 13.2–26.7 s; census build (266 × 2) 25.7–42.2 s → 21.7–26.7 s on the quiet rounds. Notebook first-open 1,868,808 B (+0, PASS). `paramIds.test.js` green, `docs/pine/param-ids.json` untouched, `pine.timeout.test.js` unchanged and green |
| 37 | C26 `request.security` of ANOTHER symbol, both lanes, at the member door — served only when the script SPELLED an exchange, our store's listing of that ticker answers to that exact Pine spelling (`symbolScope.json::confirmed`), and the listing's bars for the chart's timeframe are in hand; aligned on the bar's own `t`, exact match, never forward-filled, and a bar whose counterpart is missing after the other history began is UNKNOWN (and every root bar within reach of it); everything else refused by name — see § C26 | `667801efe` | 28 / 47 → 28 / 47 (overall 24 → 24; base `ad696e660`, objects pane on) | 219 / 266 → 219 / 266 | **none moved, measured — no graded capture reads a symbol we hold.** Every other-symbol read in the 47 is spelled BARE and names a non-US instrument (`XAUUSD`, `ADVN`/`DECN`, `EURUSD`/`GBPUSD`/`USDJPY`/`AUDUSD`, twelve NSE indices); each is now refused by name (`other-symbol:bare`) in the verdict notes of smt-divergence, mcclellan, htf-liquidity and sector-rotation — the only 4 entries that changed, notes only, every value and family identical. On the way it closed two wrong answers live on the member door: a label reading an unsupplied symbol printed `NaN` (now withheld) and `nz(request.security("AMEX:SPY", …))` plotted 0 on every bar (now not computable unless served). Served case pinned on vendor bars (`vendorHarness.c26OtherSymbol`): `"AMEX:SPY"` on NYSE:RDDT 1D reads SPY's close from the committed SPY capture on all 632 dates, in the plot, the binder and a label. Committed harness dir (87): the same 4 entries, notes only; objects MATCH 49, overall 41, families 275 / 322 unchanged; inventory identical. Member-door census 266 × both flags: attach 41 / 64 → 41 / 64, **0 rows changed**. Census alternated: base 31.96 / 34.26 s, tip 31.27 / 36.66 s. Notebook first-open 1,890,726 B at base and tip (+0, PASS); total JS +8,508 B. `paramIds.test.js` green, no re-pin |
| 38 | C27 `request.security` / `request.security_lower_tf` at a timeframe BELOW the chart's own — the mechanism (`engine/lowerTf.js`, every rule stated once in its header): the store's intraday bars kept to TradingView's regular session for the day (`tradingViewCloseMinute`), bucketed from 09:30 in the code's minutes (60 built from the store's 15, whose own 60 is clock-aligned), a bucket complete only when every source slot is present; each chart bar reads its LAST intrabar (`request.security`) or all of them in order (`security_lower_tf`), the expression evaluated on the intraday series through the real `interpret`; a chart bar is UNKNOWN (never `na`) unless every session of its period is complete and no intrabar is missing within the expression's reach. Served NOWHERE: two rules (which intrabar, which session) are documented, not captured, so every lower read is refused BY NAME at the door (`lower-tf:unwitnessed` / `lookahead` / `other-symbol` / `not-served` / `intraday-chart` / `intrabar-array`) with the capture that settles it — see § C27 | `pine/c27-lower-tf` | 28 / 47 → 28 / 47 (overall 24 → 24; base `476383d32`, objects pane on; off: 18 → 18, overall 14 → 14) | 222 / 266 → 222 / 266 | **none moved, measured — no graded capture reads a lower timeframe off committed intraday bars.** Replayed on TradingView's own SPY bars (`vendorHarness.c27LowerTf`): the 60m regular-session bars ARE the 5m bars bucketed from 09:30 (12 / 12 complete buckets equal OHLCV); the daily close equals the last 60m close on only 190 of 2,951 sessions; `request.security("60", ema(close, 9))` equals an independent EMA over the 60m closes at each day's last bar on every known day. Committed harness dir (120 captures, both flag states): **0 entries changed**; inventory identical. Member-door census 266 × both flags: attach 41 / 64 → 41 / 64; 1 row × 2 states changed, refusal text only (`mtf-dashboard-pro-rsi-fib-sr-volume-strixedge`, ungraded: its `r1` tuple element now names `lower-tf:unwitnessed`). `paramIds.test.js` green, no re-pin |
| 39 | C28 a measured sweep (re-grade of the 47 and the committed harness dir on the wave-7 tip, every non-MATCH traced to its first named wall — § C28), and the two fixes it ranked first: **(a)** a name bound BELOW a reassignment the walk could not fold no longer reads that name's older binding out of its own env snapshot (`Resolver.staleSnapshotRead`; the closing pass condemns only the FINAL env) — a WRONG VALUE, live on the objects pane and the plot lane; **(b)** `request.security(sym, "", x)` (a `""` literal or an `input.timeframe('')`) is the chart's own timeframe, per Pine's reference, and a plot colour written as a request is the inner rule with its deciding tree moved inside the same request (`securityColourRule`) | `30d99259f`, `0cfefd0d8`, `bd7c756b6` | 28 / 47 → 28 / 47 (overall **24 → 25**; base `476383d32`, objects pane on) | 222 / 266 → 222 / 266 (plots MATCH 160 → 161 / 172) | **donchian-channels DIVERGE → MATCH**: its Basis wore the pane's gold on 533 bars where TradingView draws blue, red or nothing; now value and colour agree on all 632 (`vendorHarness.c28Donchian`). **artemis-oscillator-pro** cells 18 → 14 of 21, texts `onlyOurs` 4 → **0**: `◈ NEUTRAL`, `0%`, `29 ▼ BEAR`, `↓-3` (read off `float knnVal = 50.0`) where TradingView draws `▼ BEAR`, `80%`, `22 ▼ STRONG BEAR`, `↓-17` — withheld now, every cell still drawn is TradingView's at its address (`vendorHarness.c28StaleSnapshot`). Same two entries, and only those, in the committed harness dir (82) under both objects-flag states and in the 47 with the flag off. Member-door census 266 × 2 (and × 2 with the dark runtime-pane flag on): attach 41 / 64 (43 / 66) unchanged; 7 rows — donchian's colour column (13 → 14 plots), and five door-refused scripts whose first refusal moved to a write read past (every one refused before and after). Translation census 266: no served output changed; `smarter-snr` serves 2 more cells (its `''` row, the identity). Census alternated base / tip / base / tip: 35.4 / 37.0 / 43.8 / 45.7 s. Notebook first-open 1,891,971 B at base and tip (+0, PASS); `pine` chunk +1,353 B. `paramIds.test.js` green, no re-pin |
| 42 | C32 arrays in the object lane, three general Pine semantics on the HOST lane (§ C32): **(a)** a text that moves per PASS of a counted loop — `str.tostring(<counter arithmetic>)` and `str.tostring(w.get(i))` of a bounded window, through a body local — is `{t:'val'}` over a value reference the object runtime evaluates on each pass; the window read is `{v:'wget'}` (per-bar slot trees, the length, Pine's index mapped per pass; an index outside the elements is Pine's `array.get` runtime error — the run stops and draws nothing); **(b)** a window's LENGTH read ABOVE its first writer is last bar's length (`sizePrev`), withheld on the first bar; **(c)** a window wider than `MAX_WINDOW_CAP` (64, unchanged) is read for its length only (`sizeOnly`: `cap` once the cap-th most recent add exists, withheld before; every other read refused by name), and a cap declared with a type word (`int knnLen = input.int(…)`) is the cap, not a stray read of it | `3d8813fbe` (+ the docs commit: two artemis pins, `pineProbeReplay` budget steps and `partialDrawing` 7 → 6 of 38) | 28 / 47 → 28 / 47 (overall 25 → 25; base `e0eb227ee`, objects pane on) | 222 / 266 → **224 / 266** (plots 161 / 172 unchanged) | **trend-duration** table cells 4 → **34 / 34** (address, text, tooltip — `vendorHarness.c32Collections`); its labels stay 26 / 28 and its line 0 / 1 (getter arithmetic over an `array<int>` average whose integer rounding no capture witnesses — § C32). **artemis-oscillator-pro** cells 14 → **15 / 21**: `100 bars` at (1, 2), TradingView's. Exactly those 2 entries changed in the 47 and in the committed harness dir (87), under both objects-flag states (47 flag off: 105 → 107 / 119; dir on 278 → 280 / 322, off 161 → 163 / 175; objects MATCH 49 / 39 and overall 42 / 32 unchanged). Member-door census 266 × both flags: attach 41 / 64 → 41 / 64, **0 rows changed**. Translation census 266: the same 2 scripts' object programs, no plot output changed. Notebook first-open 1,897,262 B at base and tip (+0, PASS); `pine` chunk 330,629 → 334,233 B (+3,604), total JS +4,625 B. `paramIds.test.js` green, no edit |
| 44 | C34 a conditional helper's history, read precisely: `fn:conditional-history` refuses only what the CALL owns (its locals, parameters, `ta.*` state). The chart's own `open`/`high`/`low`/`close` at an offset are the chart's, witnessed on the trend-lines capture (a last-bar-only helper reads 40 to 257 bars back and TradingView draws the chart's values); a keyword before `[`, a built-in method on a chained value, `map.*`/`matrix.*` and a pure user method are no longer read as history. A call in a loop the host reader does not run (`for ... in`, `while`) is inlined into that loop instead of refused as `fn:loop` - its ops meet the loop's own refusal and its body's removals stay counted - see § C34 | `2902087c3` | 28 / 47 -> 28 / 47 (overall 25 -> 25, objects pane on; flag off 18 -> 18) | 222 / 266 -> 222 / 266 (plots 161 -> 161 / 172) | no graded entry changed (the 47 and the committed harness dir, both flag states: 0 entries). Translation census 266: `fn:loop` 27 -> **0** (5 scripts, all past it), `fn:conditional-history` 579 -> 540 (7 scripts fewer, 4 fully past); no served output changed; object programs changed in 2 (ict-killzones: same 7 ops, still MATCH; fx-market-sessions 225 -> 273 ops, door-refused `pine:module` before and after). Member-door census 266 x 2: attach 41 / 64 unchanged, 0 rows; base-vs-base control 0 rows. `paramIds.test.js` green, no edit |
| 45 | C35 the RUNTIME lane's next stops (dark flag `VITE_PINE_RUNTIME_PANE_ENABLED`, unset): **(a)** a `simple` argument is fixed for its CALL SITE, so a window a function sizes from a parameter is constant per call site — each argument of a parameter not declared `series` is folded in the caller's context as a length is folded, and the body is compiled once per distinct set of values (`pineRuntimeFrontend.js::simpleSpecialisation`, `frameConsts`); an argument only known while the bar runs is refused by name; **(b)** ⛔ a WRONG VALUE in the runtime lane fixed on the way: a length inside a function body was folded by the top-level resolver, so a parameter sharing its name with a top-level binding ran the top-level value's window whatever the call passed; **(c)** `runtime.error(msg)` is a statement that STOPS the run by name where it is reached (`runtime:runtime.error`) and nothing where it is not; **(d)** a request below the chart's timeframe is refused by the host's own C27 code (`Resolver.lowerTfDeclineOf`) before the state check — see § C35 | `pine/c35-runtime` | 28 / 47 → 28 / 47 (overall 25 → 25; base `e0eb227ee`, objects pane on; runtime pane on 29 → 29, overall 26 → 26) | 222 / 266 → 222 / 266 (runtime pane on 229 / 273 → 229 / 273) | **none moved, measured — and every graded output is BYTE-IDENTICAL**: the six `verdicts.json` files (47 and the committed harness dir × objects pane on / off / on + runtime pane on) compare equal byte for byte against the base. Member-door census 266 × both objects flags × both runtime-pane states: 0 rows changed (attach 41 / 64; 43 / 66). Translation census 266: 0 changed. What moved is the runtime lane's own first wall, on 18 of 266 scripts (`probeObjectRuntime` / `probeRuntimeProgram`, builds 28 → 29 / 29 → 30): **artemis** `runtime:history-dynamic-offset`@245 → `pine:block`@233 (`smooth`'s `switch` over its `simple string` method); **ema-ribbon** `runtime:expression-statement`@53 → `lower-tf:unwitnessed`@156 (Q-L1); `trend-targets-algoalpha` builds (`ta.atr(atrPeriod)` in `pine_supertrend`; the door still refuses it `pine:state`, no route). Vendor proof: artemis' own `drmEngine`, verbatim, equals TradingView's `DRM Oscillator` on all 632 bars (`vendorHarness.c35SimpleArg`). **poor-man unchanged, and named:** opening C20's `timeframe.period` gate for its request-argument use converts all 246 ops and asks the run for 160 values, but the run's last bar needs **227,730** VM instructions against `INSTRUCTIONS_PER_BAR` 200,000 (not raised) — measured, reverted by bytes, not landed. Notebook first-open 1,897,262 B at base and tip (+0, PASS); `pine` chunk 330,629 B at both; total JS +4,397 B. `paramIds.test.js` green (4 passed, 1 skipped), no edit |
| 40 | C30 `time("W" / "M" / "3M" / "12M")` on a DAILY chart — the `time` of the first daily bar of the bar's New York ISO week / month / quarter / year (the session open, never the calendar boundary; a holiday-Monday week anchors to its Tuesday), read off `vw-time-tf-spy-1d-2026-09-28`. The first partial period, every bar within the tree's reach of it, and every bar of a non-daily chart are WITHHELD in both lanes (`interpret.js::periodAnchorMask`); every other period, a non-daily chart the translation is told about, a screen and `time_close(<tf>)` refuse by name | `a5243497a` | 28 / 47 (unchanged) | 222 / 266 (unchanged) | no graded family flips. `high-low-open-mid-ranges` lines 504/0 → 504/503: every line we hold is one TradingView holds, all 100 weekly dividers among them (the one missing is the vendor's oldest, the collector's edge). Corpus: `mtf-key-levels` translates (install door: `budget:series` 10 > 8), `vwap-fibo` 0 → 5 outputs, `chart-champions` 21 → 23 — see § C30 |
| 46 | C29 the rules the 2026-09-30 capture session settled, each served through ONE authority and proved by a rail that reads the new fixture: (1) `syminfo.root`/`basecurrency`/`currency`/`timezone`/`session`/`pointvalue` from `symbolScope.json::listing_fields` (`type` still refused by name); (2) C12w bar counters under the listing exception only, the two spellings told apart by the reading written into the switched mark (`interpret.js::readingSeed`); (3) a bare ticker resolves to its confirmed-exchange listing (ambiguous names refused), `BRK.B` is the store's `BRK-B` (`otherSymbols.js::storeTickerOf`); (4) `color.from_gradient` as captured — opacity bytes blend, channels premultiplied and truncated, fractional transparency truncated (`colorInt.js::wholeTransparency`), 0xAABBGGRR; (5) v6 `timeframe.period` is `1D`/`1W`/`1M` (`pine.js::periodTextOf`), the C15 withhold and the C20 gate lifted, and a document folded at one period refuses, per plot and for the drawings, only what differs on another (`periodReads.js`); (6) a comparison with an `na` operand is false, `!=` included (bind fold + Python twin); (7) `x[na]` reads the current bar; with no `max_bars_back` a dynamic offset is served to 399 and withheld beyond — see § C29 | `e43be85fa`, `b9c0e6004` | 28 / 47 → **29 / 47** (overall 24 → **25**; base `bcac5dd34`, objects pane on): max-pain DIVERGE → **MATCH** | 222 / 266 → **225 / 266** | **max-pain** boxes 1 → **13 / 13**, labels 6 → **8 / 8** (the 12 heatmap boxes and 2 legend labels C20 withheld). **ema-ribbon** cells 34 → 36 / 48 (the `1D` rows). htf-liquidity, mcclellan, sector-rotation, smt: notes only (the bare-symbol sentence). Committed harness dir (99): objects MATCH 49 → **54**, overall 40 → **41**, families 269 / 315 → 281 / 322, plots MATCH 267 / 322 → 283 / 346, inventory identical — vw-bar-counters 7 / 7 counter rows MATCH on 634 bars (`ta.cum(1)` values agree; its row is a constant-hidden colour INCONCLUSIVE), vw-other-symbol SPY rows + label MATCH (BRK.B agrees on the 300 bars the committed BRK.B capture holds), vw-tf-period 1D label `[1D]` MATCH and every value agrees (1W/1M: `T01`–`T07` refused by name, `T08`–`T11` agree), w4-cross-round now graded (16 of 17 agree; `X00` is `bar_index` on a window that does not start at the listing). 0 regressions. Member-door census 266 × both flags: attach 41 / 64 → 41 / 64, 1 row — `poor-man039s-volume-profile` flag off moves from `pine:objects-only` to the clean-objects-only sentence (its program no longer drops an op; flag on unchanged). Census build alternated (box under load): base 100.8 / 80.8 / 36.8 s, tip 97.0 / 43.9 s (first tip run 129.2 s beside another lane's gate). Notebook first-open 1,891,971 B at base and tip (+0, PASS); total JS +8,696 B (`pine` chunk 325,890 → 327,347 B). `paramIds.test.js` green, no re-pin |
| 41 | C31 loop-scoped names and loop-built text in the OBJECT lane — the block reader (`foldStatements` under the block harvest) steps over a `for`/`while` instead of stopping at it: the names its body can change refuse (`loopWrites` → `loopWriteRefusal`, one builder with the top-level walk), everything below the loop binds; a counted `for` with ascending integer-literal bounds that only appends to text is folded pass by pass (`unrollTextLoop`); a helper's own locals are visible to the text reader; a `ta.*` local under a guard that is not bar-invariant is marked (`condCall`) and refused, also by the runtime rescue; a binding below a stepped-over loop stays the runtime lane's to answer (`afterLoop`). The main walk is unchanged — see § C31 | `136994295`, `319a91668` | 28 / 47 → 28 / 47 (overall 25 → 25) | 222 / 266 → 222 / 266 | no family flips: `artemis-oscillator-pro` cells 14 → **15** / 21 (`fTxt` = `O-  V-  S-`, TradingView's); `htf-candle-footprint` boxes 0 → **3** / 13 (the three body boxes, at TradingView's bars and prices); ema-ribbon 34 / 48 and poor-man 0 / 40 labels unchanged, each with its wall re-named. Committed harness dir (87): the same two entries, objects 49, overall 42 unchanged. Census 266 × 2: attach 41 / 64 → 41 / 64, 0 rows (control 0). Translation census 266 × 2: 0 plots, refusals or parameters moved; object programs changed in 4 scripts. Notebook first-open +0 B; pine chunk +3,965 B. `paramIds.test.js` green, no edit |
| 43 | C33 three object-lane reads, one script each — **(a)** `array.push(list, f(…))` / `list.push(f(…))` is the two statements Pine runs (`pineObjects.js::pushOfDrawCall`), and a helper whose body ends in a lone `if … <ns>.new(…)` returns that object or `na` (`ifOnlyReturn`: the caller's name is emptied under the call's guards, then filled under the create's); **(b)** an `input.timeframe` default printed in a text is served only for a spelling a committed capture prints under that Pine version (`INPUT_TIMEFRAME_TEXT_WITNESS`: `D` under v6, `W` under v5) — any other spelling marks the property unknown and is never printed; a request timeframe that is a function PARAMETER is the caller's argument, on the object pass only; `color.new(c, <input default>)` and an `na` arm of a colour choice resolve without minting; **(c)** `<getter>[k]` (k ≤ 5), `str.tostring(<getter>)` and an inlined helper's own getter local are read by the object runtime; an `and` guard with a term nothing reads, gated by an `input.bool`, is carried as a latch over its read terms and one unknown (`guard:partial`); **(d)** `last_bar_time` is the newest bar's time in ms | `e3ebd3a6a`, `0c48cc0a9` | 29 / 47 | 228 / 266 | **average-day-range-adr-pivots DIVERGE → MATCH** (lines 0 → 2 of 2, boxes 0 → 2 of 2, cells 3 → 4 of 4, cell text agrees; ids, coordinates, colours and text equal TradingView's — `vendorHarness.c33ObjectReads`). **high-low-open-mid-ranges** labels 0 → **504 of 504**, label text agrees (text, y, x-rank and text colour of all 504 equal); its 504 lines stay WITHHELD and cells stay 37 of 45. **volume-profile**: `last_bar_time` served, its 3 lines still withheld (next wall `chart.left_visible_bar_time`). Overall MATCH 25 → 26 of 47; plots 161 / 172 unchanged. Committed harness dir (87 graded): objects 49 → 50, overall 42 → 43, families 278 → 284 of 322 — the same two entries and only those; flag-off runs unchanged (18 / 15 and 39 / 32). Member-door census 266 × both flags: attach 41 / 64 → 41 / 64, **0 of 532 rows changed** (base-vs-base control 0). Translation census 266: no served output changed. Notebook first-open 1,897,262 B at base and tip (+0, PASS); `pine` chunk +8,600 B; total JS +10,368 B. `paramIds.test.js` green, no re-pin |
| 47 | C36 what C30 left (§ C36). **(1)** an every-day daily chart (BTCUSD capture: the week starts MONDAY, the month on the 1st) is SERVED, less a period whose calendar first day has no bar and a bar across a New York clock change from its anchor — both withheld by name; a chart with one weekend day but not the other stays withheld whole. ⛔ **A wrong value fixed on the way:** on a session chart TradingView anchors to the first session ITS CALENDAR holds, not the first bar — the Hurricane Sandy week read 0 / −1 / −2 where the vendor reads −2 / −3 / −4; a period not opened by the calendar's first session is now withheld (that week, and every holiday-opened period before 2000). **(2)** every withholding carries a named reason out of `periodAnchorMask` to the member's disclosure strip (`chartClockNotice.js`). **(3)** `time(timeframe.period)` / `time("60")` = the bar's own `time` on 1D and 60m charts, as witnessed; nowhere else. **(4)** ⛔ the Python interpreter answered `na(time("W")) ? a : b` with a confident `a` on EVERY bar in all three server consumers that can evaluate a pane's saved tree (alerts, the scan sweep, the screen backtest); `ast_interpret.period_anchor_mask` is now the mask's port, one parity fixture. **(5)** `time_close("W" / "M")` on a session daily chart = `tf_live(<period>, timeclose)`, 4,800 / 4,800 incl. the forming period's scheduled close; withheld by name with weekend bars and off 1D; `"3M"` / `"12M"` refused by name (measured; no quarterly bar) | `a4f56d007` | 30 / 47 (unchanged) | 233 / 266 (unchanged) | none on the 47 or the committed dir (0 graded entries; 5 probe entries' refusal sentence). Through the door once the unrelated row is cut: `vw-time-tf-bitstamp-btcusd-1d` T01–T04 0 wrong, 5,438 / 4,795 / 4,247 / 1,845 bars equal; `vw-time-close-tf-spy-1d` Q01 / Q02 / Q12 / Q13 MATCH 4,800 / 4,800 and Q08 3 wrong → 0; `vw-time-tf-spy-1d` T05 / T06 MATCH 900 / 900. C30's surviving mutation M5 is red — see § C36 |
| 49 | C38 the plot lane answers what the object lane and the VM already did (C29's "main gap against one authority"): **(a)** `x[e]` with a PER-BAR `e` in a plot is `barsAgo(x, e, buffer)` — one new table function, no new node type; the rule (an `na` count reads the current bar; a whole count below the buffer reads that many bars back) is stated once in `interpret.js` and asked by `objectRuntime.atCheck` too; the buffer is `max_bars_back` or `AUTO_MAX_BARS_BACK`, never more than the index can take, and a buffer past the lookback budget refuses `budget:lookback`; the root is WITHHELD within reach of a count that cannot be read and of a read before the first bar held (both lanes, JS and Python); **(b)** `color.r/g/b/t` of a colour `vw-gradient` witnesses is a number — a fixed colour folds, a gradient is `fromGradient` written as a canonical tree; **(c)** found on the way: `x[-expr]` lost its minus at parse — see § C38 | `621209921`, `306db6c30` | 29 / 47 (unchanged; overall 26; base `45859e598`, objects pane on; 0 entries changed either flag) | 227 / 266 (unchanged) | none of the 47. Committed harness dir (117): objects MATCH 57 → **60**, overall 45 → 45, plots MATCH 316 / 379 → **323 / 412** — the three probes leave INCONCLUSIVE-refused: `vw-offset-na` 5 of 6 rows MATCH, `vw-mbb-auto` and `vw-gradient` graded; every row still short is `bar_index` on a 300-bar window, the pane's 12-row ceiling or its hidden-constant rule. On TradingView's whole SPY history (the committed from-listing capture joined in front, checked against the vendor's own `bar_index`) the probes' unedited source grades **MATCH**: 6 / 6, 4 / 4 (offsets to 399), and the 19 colour-component rows. Member-door census attach 41 / 64 → 41 / 64, 1 row (smarter-snr's sentence). Translation census ok 58 → 58, served 827 → 827. |
| 53 | C43 two rules the 2026-09-30 evening captures settled, each in its own authority and both lanes renew their rails: **(a)** a getter in bar-coordinate arithmetic -- `l.set_x2(l.get_x1() + a.avg() + 1)` -- is carried on the OBJECT program as `{v:'op', op:'trunc', args:[...]}` over `+`/`-`, `int(x)` and `math.avg(a,b)` (half of their sum), truncation served for a non-negative result only (a negative one marks `truncNegative` and the coordinate is tainted via C17's property mask through the SHARED `opReadsState` predicate the validator already pinned the shape of -- one predicate, two callers); a bounded-window read placed between an add and the removal is `<an add ran this bar> ? na : <the read>`, its ambiguity registered as the add's own tree; the no-format `str.tostring` is TEN decimals, trailing zeros trimmed (`defaultNumberText`). **(b)** a reached `runtime.error` draws nothing (`vw-runtime-error-reached-spy-1d`): the translator stamps `meta.runtimeErrors` on the document -- the conditions each call stands under as trees, the message's text parts, the inputs it reads live, the values it reads folded, and any period read; a new engine module (`runtimeErrorStop.js`) evaluates them over the chart's bars with the member's own inputs, three-valued per bar with `unknownMask`/`periodAnchorMask` and an off-listing warm-up; a hit returns `{reached, bar, barKnown, message, title, tradingViewText, sentence}` and `nativeRegistry.astColumnsFor` returns no column + `objectColumns.objectReaderFor` returns null; the runtime lane's `PineRuntimeError` ends in the same result through `runtimeErrorText.js`'s one wording; the binder publishes per instance to `runtimeErrorNotice`, the disclosure strip renders `${name} -- ${sentence}` and leaves on hide/release; a setting only a validation reads is a guard-only input (`guardInputs:true`), declared without minting a param-id. NEVER GUESSED: an unread condition / an unknown period / a folded setting the member moved / a bar before the listing warm-up stays `unknown`, named, drawn as today -- proved by base-vs-base controls | `323d5cd32`, `481f60666`, `4e759cf1e`, `538aa038b`, `e80129c6a` (wave 9 merge 1ce378b3b), `f6acac4a9` (wave 9 merge 19bcbf278) | 29 / 47 -> **30 / 47** (overall 26 -> **27**; `average-day-range-adr-pivots` DIVERGE -> MATCH is C33's, pulled in by the wave-9 merge) | 227 / 266 -> **234 / 266** (C33 and C36 wave-9 lifts, plus **trend-duration-forecast** lines 0 -> **1 / 1**, labels 26 -> **27 / 28** -- a C43 Part-A gain) | **trend-duration-forecast** line and label-82 served (x2 = x1 + trunc(mean + 1) = 23, label x = x1 + 11, text 'Probable Length\n23' between window add and removal; label id 2 withheld by construction and ONE other label text still refused by name -- see section C43). Member-door census 266 x both flags (pre-merge, 481f60666 vs base 36f3c47d5): attach 41 / 64 -> 41 / 64, 0 rows changed (base-vs-base control 0). Translation census 266 x both flags (pre-merge): 0 served outputs changed. **vendorHarness.c43RuntimeError.test.js** (16 tests) and **runtimeErrorNotice.test.jsx** (10 tests) both green; the three new isolation rails inside c43RuntimeError (no param minted for a validation-only input, a validation period read is isolated from the plots' record, a shared knob is live in both) pass on the merged tree. Notebook first-open **1,897,262 B** at base and merged tip (+0, PASS); `pine` chunk +18,833 B; total JS +5,117 B across 353 files. `paramIds.test.js` green with ZERO edits. **Mutation proofs: 42 mutations, 34 RED (each a rail only this fix turns red), 8 GREEN(!) -- recorded as unproven in section C43 rather than silenced** |
| 50 | C40 the HOST object lane runs two more loop shapes, as loop ops the object runtime executes (§ C40): **(a)** `for x in <list>` / `for [i, x] in <list>` over a drawing list the lane holds (a counted loop `0 to size − 1` that never counts down, the element copied from its slot as each pass starts), over a bounded numeric window (C32's per-pass `wget`), and over `line.all` / `box.all` / `label.all` (the family's live objects, oldest first, taken when the loop starts); **(b)** the cap `while array.size(a) > N` whose body only removes from an end of the list (`array.shift(a)`, `line.delete(array.shift(a))`, `(array.shift(a)).delete()`, `pop`), the condition re-read before every pass; the numeric-window `while` cap is the window's own cap (`arrayWindows.js`). Refused by name, each with the probe row that settles it (`vw-forin-collections`): a body that changes the list it walks, a position in `<family>.all`, a `.all` walk over two or more objects whose body deletes or creates that family (`OBJECT_UNWITNESSED`, nothing drawn), a loop variable that is another statement's name. **H14, found on the way and fixed:** a drawing list created WITH SLOTS (`array.new_box(3)`) was modelled empty, so its `array.set` was a no-op and its deletes never ran (180 boxes for Pine's 3, clean ledger) — it is now diverged at its creation (`coll:sized`); and a statement that starts with `(` (`(array.shift(a)).delete()`) was dropped uncounted. No budget moved | `066b314de9`, `0a5906f283`, `f5b692b322`, `e7a1336646`, `feb79ba3c1`, `f479e6baef` | 30 / 47 → 30 / 47 (overall 27 → 27) | 233 / 266 → 233 / 266 | no family flips and no harness entry changed in either flag state (47 and the committed dir, 104 graded: objects 57, overall 45, families 304 / 343, plots 316 / 379, unchanged; pane off 18 / 15 / 107 of 119 / 140 of 151 and 46 / 34 / 184 of 196 / 295 of 358, unchanged). `ict-killzones` stays MATCH. `trend-lines`: `f_clearAll`'s three `.all` walks are carried, the program is still empty (its creates sit in loops over lists of user types and in a `while`). Census 266 × 2: attach 41 / 64 → 41 / 64, 0 rows (control 0). Translation census 266 × 2: 0 plots, refusals or parameters moved; object programs or their diagnostics changed in 9 scripts, none of which attaches. Notebook first-open 1,897,262 B at base and tip (+0, PASS); `pine` chunk 342,839 → 350,030 B (+7,191), total JS +10,467 B (base = merged wave 9 `19bcbf278c`). `paramIds.test.js` green, no edit |
| 48 | C37 colours this door did not carry (ruling R-G), and colour graded as its own column (§ C37): **(a)** `color.from_gradient` as a PLOT colour — the position `(value − bottom) / (top − bottom)` is a hidden column, the two ends static strings, drawn by the one measured curve (`pine.js::colourGradientRule`, `pool.js::gradientPointColour`); **(b)** object colours on the host lane — `color.new(c, <computed t>)`, a `var` colour never reassigned, a one-expression colour helper, `na` / `color(na)`, `color.from_gradient` (`{c:'grad'}`), a colour test on the loop counter; **(c)** the default colours that depend on the script's Pine version (`objectDefaults.js`, v4 / v5, each read off a capture); **(d)** `chart.fg_color` / `chart.bg_color` carried as a reference and resolved against OUR chart's own colours where the object is drawn (`objectTheme.js`), graded theme-relative | `pine/c37-colours` | 30 / 47 → 30 / 47 (overall 27 → 27; base `19bcbf278c`, objects pane on) | 233 / 266 → 233 / 266 (plots 161 / 172 unchanged) | no entry of the 47 moves — the harness verdict does not grade an object's colour. Committed harness dir: **rvol DIVERGE → MATCH** (611 of 611 coloured bars were the pane's gold), the only entry, both flag states. **The colour column** (`vendorHarness/colourColumn.js`, new): plots 611 → **0** differing bars of 971,741; paired object colour slots not carried **349 → 0** of 3,406 over the 47 (887 → 0 of 4,598 over the harness dir), 42 (55) theme-relative, 1 carried and different (heat-map-seasons' gauge point, named). Member-door census 266 × 2: attach 41 / 64 unchanged, 1 row (rvol plots 2 → 3); base-vs-base control 0 rows. Translation census 266: every output's value byte-identical, 1 presentation moved (rvol), dropped colour props 287 → 103 sites, programs with colours factored out 0 changed. Notebook first-open 1,897,262 B at base and tip (+0, PASS); `pine` chunk +4,341 B; total JS +10,459 B. `paramIds.test.js` green, no edit |
| 51 | C41 a lower-timeframe request is SERVED on daily and weekly charts (§ C41). `request.security(syminfo.tickerid, "5" / "15" / "60" / "240", expr)` below the chart's timeframe is a new canonical node, `{type:'ltf', value:'<minutes>', args:[child]}` (formula `ltf(expr, '60')`): the child runs on the chart symbol's own REGULAR-SESSION intraday series and each chart bar reads its LAST intrabar (witnessed: `vw-lower-tf-spy-1d` / `-rddt-1d` / `-spy-1w-2026-09-30`); 60 and 240 are bucketed from 15-minute bars on the 09:30 grid. A chart bar whose sessions are not ALL complete in the supply, or whose child reaches past the front of it, is UNKNOWN and withheld - never `na`. The supply is one hook (`useLowerTfSources`, wired into `StockChart.jsx` beside `useOtherSymbolExchanges`): no request for a chart with no such script, ONE (`/api/bars/SYM?tf=15`) for ema-ribbon's three codes, capped at the route's 60,000 bars. Lookahead, `request.security_lower_tf` arrays, another symbol below the chart, `ticker.modify` sessions, intraday and monthly charts, `"1"` and `"30"`, the screen lane and the runtime lane stay refused by name | `d7009cc06a` (+ merges `3bb52e2523`, `8c790cddeb`, and the docs commit) | 30 / 47 -> 30 / 47 (overall 27 -> 27; base wave 9 `19bcbf278c`, objects pane on; pane off 18 -> 18, overall 15 -> 15) | 233 / 266 -> 233 / 266 (plots 161 -> 161 / 172) | **ema-ribbon-trend-filter** table cells 36 -> **47 / 48**: its 15m / 1H / 4H rows (`2.63%` / `3.8%` / `3.88%`), the bias row (`0B  5S  /  5`) and `▼▼  STRONG BEAR` are TradingView's, text for text (`vendorHarness.c41LowerTfServe`); what is left is the strength bar `██████████`, another wall. No family flips (the cell count and text families stay one short). **artemis-oscillator-pro**: its three lower reads are `ltf` nodes now, graded outputs unchanged (notes only). The same two entries under both flag states and in the committed harness dir (117: objects 62 / 82, overall 46, families 315 / 350, plots 343 / 417, all unchanged), plus the three `vw-lower-tf` probe entries' refusal sentence (still INCONCLUSIVE: the probe script also carries lookahead and array rows, and the door is all-or-nothing - its served rows are graded row by row in the C41 rail). Member-door census 266 x 2: attach 41 / 64 -> 41 / **65** (`mtf-dashboard-pro` attaches with the objects pane on; pane off its sentence changes), 1 row per state, base-vs-base 0 rows. Translation census 266: host lane ok 58 -> 59, served outputs 404 -> 414; screen lane 58 / 738 unchanged, no served screen output moved. Notebook first-open 1,897,262 -> 1,897,271 B (+9: a chunk FILENAME three characters longer in three preload lists, PASS); total JS +15,966 B. `paramIds.test.js` green; `docs/pine/param-ids.json` re-pinned for three scripts that were door-refused at base in both flag states |

| 52 | C42 a call that runs exactly ONCE reads what TradingView reads (section C42). The witness is `vw-fn-series-history-rddt-1d-2026-09-30` and the C04 arm of ema-ribbon: under a guard that is PROVABLY `barstate.islast` (`guardIsLastBarOnly`, alone or as a top-level `and` conjunct), in no loop, (i) `volume` / `time` / `hl2` / `hlc3` / `ohlc4` `[k]` are the chart's values `k` bars back and move to `CHART_SERIES_WITNESSED`; (ii) `bar_index[k]` is the call's own history (`na` on its one run) and moves to `CALL_OWNED_SERIES`; (iii) `ta.highest(src, len)` reads its source and `ta.sma(src, len ≥ 2 literal)` reads `na`. Everything else keeps a named refusal: every other `ta.*`, every other guard, a loop, a non-literal offset or length, `time_close[k]` / `hlcc4[k]`, `bar_index[k]` under any other guard. On the way: a bare `input(<literal>, …)` is a simple input (its guard is bar-invariant); the clock functions `time(…)` / `time_close(…)` and the calendar readers answer from the bar's own timestamp, so a conditional call that reads them has no history to starve (`fn:conditional-history` 540 → 383 across the 266, no object program moved). ema-ribbon's cell (2,3) is TradingView's ██████████.
| 54 | C44 a measured sweep on the wave-10 tree and ONE verdict change (§ C44). **Sweep:** the 47 and the committed harness dir re-graded at `e4e24524ef` and at wave 9 (`46f54d80b5`), every entry that moved named; each of the 22 non-MATCH captures traced to its first wall with code@line and classed (buildable / capture-pending / budget / dark flag / correct end state / data / grammar); buildable walls ranked; the owed captures in one table; the member-door and translation censuses re-run. **Verdict:** object COLOUR joins the harness verdict (integrator ruling on C37's question) — `compare.mjs::objectColourRows`, theme-relative slots agree, an object NEITHER side draws (an `na` coordinate on both) is counted and not graded, fail-closed on an unknown state; every verdict also carries `verdictWithoutColour`, so both numbers come from one run. Found on the way: the pairing never paired an object at an `na` price (`NaN` here, `null` in the capture), so 504 + 51 + 48 objects had no colour read; fixed (`objectColours.js::isNa`). No engine semantics | `122521b211` | 30 / 47 without colour, as every row above was taken → **29 / 47 with colour** | 234 / 266 (count and text, unchanged); colour families 72 / 73 | wave 9 → wave 10 moved no graded verdict on the 47 (trend-duration line 0 → 1, labels 26 → 27; ema-ribbon cells 36 → 37). Colour moves ONE: `heat-map-seasons` (one cell fill, a variable named `color`). `multi-timeframe-supply-demand-zones` holds 8 boxes in the wrong colour that neither platform draws: counted (16 undrawn slots differ), not a verdict. Overall 27 → 26; harness dir 66 → 65 objects, 48 → 47 overall. 29 mutations, each red alone |
| 59 | C49 the clock capture round 3 (2026-10-01) witnesses (§ C49). **PRIORITY 0:** graded bar for bar on both full-history fixtures, the live C30 / C36 rule served **0** wrong values (it withheld, never mis-served). **(1)** ONE rule replaces C30's and C36's daily-session rules: `time(P)` for `W` / `M` / `3M` / `12M` is 09:30 New York on the FIRST session the vendor's calendar holds in the period containing the day the bar OPENED, and `time_close(P)` is the close of the LAST such session (`indicators.js::computePeriodCalendar` ⇄ `indicator_compute.py::compute_period_calendar`, over `tradingViewSession.js`); it reproduces every bar of the 1D-full (8,476), 1W (1,758), 1M (406), 15m (3,300), 5m (3,300) and 60m (300) fixtures. The calendar's closures apply from `TRADINGVIEW_CLOSURES_FROM` (2000-01-01), and the fixture brackets that date (last calendar-answered week Fri 1999-12-24, first bars-answered holiday week Tue 2000-01-18); before it a holiday-opened period answers the calendar day, which is what the fixture shows. The two periods from 2000 on whose first / last session has no bar (Sandy week; week of 2001-09-10) stay withheld by name. **(2)** chart timeframes served as witnessed: anchors on 5 / 15 / 60 / D / W / M, `time_close` on D / W / M, `time(timeframe.period)` on the same six, `time("60")` on 5 / 15 as the 60-minute bucket from 09:30; a chart with bars outside the regular session is withheld (`time-clock:outside-session`). **(3)** ⛔ **a wrong value fixed:** the member door folded `request.security(syminfo.tickerid, "D", x)` to `x` and the saved tree was bound on every chart, so a 5-minute chart drew its own close as the daily close (wrong on 299 of 300 bars of `request-realtime-alignment-spy-5-2026-10-01`, both look-ahead settings); a `W` / `M` request was resampled from intraday bars. The tree now carries its base timeframe (`requestBaseNode`), and a chart that STATES another timeframe withholds the column by name (`request:other-timeframe`), plots and objects, both lanes. FX stays withheld (our daily bar is stamped 09:30 New York, the vendor's opens 17:00 the evening before). JS and Python mirrors moved together (`period_anchor_parity.json` regenerated). Rails: `vendorHarness.c49CapturedClock.test.js` · `vendorHarness.c30TimeAnchor.test.js` · `vendorHarness.c36TimeFollowups.test.js` · `ast/periodAnchorParity.test.js` · `tests/test_ast_period_anchor_parity.py` · `ast/clockCloseTfChange.vendor.test.js` | `pine/c49-captured-clock` | 30 / 47 (unchanged; overall 27; base `654d99bd31`, objects pane on) | 234 / 266 → 235 / 266 (plots 161 / 172 unchanged) | 0 entries of the 47 change verdict (one object count 503 → 504); harness dir: 3 entries on, 2 off (the two request captures' rows move from a wrong value to withheld) |
| 58 | C48 capture round 3 (2026-10-01) served in the object / call-site / colour area, each rule graded on its own fixture and refused by name where no row shows it (section C48): **(P0)** a `ta.*` call, a block local's `[k]` or a helper's history in a block that runs on SOME bars was read the every-bar way in the PLOT lane (ten rows of `vw-call-site-history-rddt` wrong on 151-307 of 634 bars) - the plot now carries its block's guard (`meta.blockRuns`) and the bind refuses it (`pine:block`) on a chart where the block runs after a skipped bar; a block local's `[1]` under `barstate.islast` is `na`; the gradient formula is exact (3,600 / 3,600 component-bars) and its EDGES are the capture's (equal / `na` bounds -> the zero colour, reversed bounds -> the bottom colour between them; they were held and mirrored). **(1)** the one-run `ta.*` table (`ONE_EXECUTION_TA`), `time_close[k]` / `hlcc4[k]`, `x[0]`. **(2)** `for x in <own list>` LIVE for push / shift / set, `<family>.all` a snapshot with positions, `var ... = array.new_label(3)` three slots. **(3)** `input.timeframe` text verbatim under v5 and v6; a live getter number prints, its `[1]` is one bar ago (`NaN` in the last-bar block), a top-level getter variable's `[1]`, a getter on the previous handle. **(4)** a float bar coordinate truncates toward zero, negative included. **(5)** components of an 8-digit literal, `input.color`, a ternary of colours, a per-bar transparency. Many-run serving, `ta.highest` / `ta.lowest` over runs and five named leftovers stay refused; five probes queued. No budget moved | `0eab9691ef`, `8385e43572`, `d503cf1b9b`, `976d1d6b02`, `e5b801e4ea`, `9774e28e4a`, `e2691617ed`, `d72ced8037` | 30 / 47 -> 30 / 47 (overall 27 -> 27; base `e4e24524ef` + the capture merge, objects pane on) | 234 / 266 -> 234 / 266 (plots 161 / 172 unchanged) | no entry of the 47 moves. Committed harness dir, both flag states: objects MATCH **68 -> 71** of 91 (pane off 56 -> 59 of 70), families 343 -> 350 of 385 - `vw-call-site-history-rddt` (labels 5 -> 24 of 24), `vw-input-tf-text-v5` / `-v6` (3 -> 10 of 10); overall 48 -> 48, plots 358 -> 358 (twenty conditional-call plots DIVERGE -> refused at the bind). Member door 41 / 64 attach, **0 rows changed**; 0 served outputs changed; notebook first-open +0 B, pine chunk +9,520 B; `paramIds.test.js` green with no edit. 74 mutations, 72 RED, 2 fail-closed survivors named |
| 56 | C46 a parameter id no longer depends on what the translator folds (§ C46): `__uct_param_N` was a walk-order counter (the N-th input the walk resolved first), so folding one more block renumbered ids — re-measured on this tree, C31's main-walk step-over moved `long_tail__09` `_2` → `_4` and appended 10 more; C38's index and C41's dead arm appended. **Now** the id is read off the token stream before the walk: `1000 +` the input call's ordinal among the script's `input(…)` calls (`paramIdSource.js`), with the ids the counter gave the 183 corpus scripts that held one FROZEN per lane (`paramIdLegacy.js`: `param-ids.json`'s plain strict lane, plain screen, member pane, PineBox — the member doors never numbered like the pinned lane: 37 scripts / 133 of 634 ids differ). Every lane reproduces base on all 328 scripts except three licence-held scripts where base had already drifted from `param-ids.json` (restored). Rails: `paramIds` unedited; `paramIdSourceStability` (any subset of blocks refused via a test-only hook, surviving inputs keep their ids, every corpus script); `paramIdLegacy` (the map's digest; the three unpinned lanes); `savedDocumentRoundTrip` (38 documents saved at base rebuild identically and take their saved values by id). 16 mutations, each red. The first beneficiary — the main walk stepping over a loop — was built and measured (0 served outputs change, 0 graded entries change, 8 ids gained and none moved) and is NOT kept: no committed capture exercises it (Q-C46a queued, branch `pine/c46-stepover-trial`) | `b5aa8fc308`, `4782cd34d2` | 30 / 46 → 30 / 46 (overall 27 → 27) | 234 / 266 → 234 / 266 | none: the 47, the committed harness dir, the member-door census (41 / 64) and the translation census (266 × 3 lanes) are identical to base |
| 60 | L1 `import Author/Library/Version` is LINKED (§ L1): a server-side library store (data dir, never git; licence + attribution per version; `GET /api/pine/libraries`), a fetch tool for the owner, a client registry the doors fill, and a token-level linker both lanes call after `lexPine` - an imported export compiles to exactly what the same function pasted into the script compiles to (proved bar for bar in both lanes on fixtures written for the test). Unknown library, other Pine version, ambiguous block shadowing, kept `var` / top-level-reassigned library values, cycles: refused by name on the import line. No budget moved | `a30aa584c0`, `9066030225`, `43b02c38a4`, `f34c0c4cd5`, `38dca3d9c1` (merge `e5d0198b34`) | unchanged: no capture imports a library (0 / 139 harness files) | unchanged | with the libraries in a scratch store: importers past the import wall 29 / 34 both lanes; runtime `runtime:library` 30 -> 5, compiled 15 -> 15; member door on 68 -> **70** (`all-chart-patterns-theeccentrictrader`, `black-scholes-...-loxx`); with an empty registry (production today) 0 served outputs, 0 params, 0 object programs changed over 266 x 3 lanes, door 45 / 68, only the 34 importers' refusal sentence names the missing library. Notebook first-open 2,148,818 B (+0, PASS), `pine` chunk +13,766 B, total JS +14,810 B. `paramIds.test.js` green, no edit. 8 mutations, 7 red, 1 equivalent survivor named. Q-L1 queued |
| 61 | B1 `bgcolor(...)` / `barcolor(...)` are DRAWN (§ B1, step 61). The host lane carries each top-level call as a paint (`presentation.paints`) whose colour goes through the one colour reader a plot uses (static, two-colour, palette with the transparent `na` entry, gradient), or is WITHHELD by name (`offset` non-zero or `na`, `show_last`, another `display`, `overlay` / `force_overlay`, a v3/v4 `bgcolor` with no `transp`, an uncarried colour); nothing mints. The member door mints each rule as a hidden condition column (shared with a plot or fill on the same rule) and writes `definition.paints` (`defSchema.validatePaints`); the binder draws one background primitive per `bgcolor` (behind the series, full pane height) and hands `time -> colour` candle overrides to the chart only when they change (StockChart applies them to the price series' own data). Graded against the 14 committed captures that record paints (`bg_colorer` / `bar_colorer`): every paint the door draws agrees on every bar (2,639 vendor-painted bars compared). 12 mutations, each red | `875245b282` + the § B1 commit | 30 / 46 -> 30 / 46 (overall 29 -> 29) | 169 / 190 -> 169 / 190 (count+text families read off `verdicts.json`) | paints JOIN the verdict (§ B1, follow-ups): graded on 7 of the 47 and 9 of the committed 138, **0 verdicts move** in either (47: 29 / 17 / 1 both ways; committed: 50 / 26 / 62 both ways); heat-map-seasons' withheld `barcolor` counts as a gap (already DIVERGE on its plots); the `pine:chart-only` sentence says per call what the door does; member door attach 45 / 68 unchanged; 5 attached scripts now draw their paints |
| 62 | R1 (lane brief, wave 12) the RUNTIME lane catches up with C50 and takes the exact part of its two largest first walls (section R1). **(1)** `strategy(` is skipped exactly as `indicator(` (the program is byte-for-byte the indicator's), an order call in pine.js's own `STRATEGY_ORDER_CALLS` is skipped as a statement, a `strategy.*` VALUE stays refused by name (`pine:strategy-call`); only the CALL form `strategy(` / `library(` is a declaration, so an indicator's VARIABLE named `strategy` compiles. **(2)** of `runtime:statement`: a lone atom on its own line is discarded (still lowered, so its own refusals stand); `#RRGGBBAA` through `objectHexToPacked` (C48's conversion); `[x]` is a one-element tuple (`[a] = f()`), never a plain value; a body ending in a void collection call is valueless; `request.security` named leading args placed by `positionaliseSecurityArgs`; an output call reads its value arg by `OUTPUT_CALLS`' name; 1-arg `ta.highest`/`ta.lowest` fill from `PINE_SHORT_FORM`; an interpret.js `TableRefusal` keeps its guard. **(3)** under ownership, a function ending in a drawing call is valueless (the bare `runtime:object-op` row is the harness's, unchanged by design). No budget moved; no flag moved | `597552a6a4`, `bfecbecbef`, `a029107811`, merge `689e4875d6` | 30 / 46 -> 30 / 46 (overall 29 / 47 unchanged; base `cf5e38d5d2`, objects pane on) | translation census unchanged (`corpus_metric.json` untouched) | 0 entries change on the 47 (both pane states) and the committed harness dir (both). Member door 45 / 68 -> 45 / 68, **0 rows changed** (base-vs-base 0). Runtime census compiled end to end **15 -> 19** (owned 27 -> 31); first walls: `runtime:declaration` 26 -> 0, `runtime:statement` 33 -> 14 |
| 63 | H1 the host translator's three largest first refusals (`pine:state`, `pine:reassign`, `pine:request`) on the 266, clustered by shape (§ H1). **Served:** **(1)** a pivot on a PLATEAU is TradingView's: a tie on the LEFT pivots, a tie on the RIGHT does not, so a flat top pivots on its LAST bar (`interpret.js::pivotCol` ⇄ `ast_interpret.py::_pivot_col`; witness RDDT bars 473/474 in `pivot-point-supertrend-rddt-1d-2026-09-27`); **(2)** a SWITCHED recurrence whose reset test reads its own state (the ratchet: `up := close[1] > up1 ? max(up, up1) : up`) is decided by a RANGE window, published only on a bar every earlier history agrees on (`forgetsOnReset::orderingTest`, `interpret.js::rangeSwitchedColumn` ⇄ `_Range` in Python); **(3)** a helper's own `x = init` / `x := f(x[1])` recurrence (`Resolver.finalLocalOf`); **(4)** from the listing a crossing over a warm-up `na` is Pine's `false` (`interpret.js::pineBoolAt`). Id rule: a script `param-ids.json` pins mints only its frozen ids in the pinned lane (`paramIdPinned.js`, derived); `paramIds.test.js` unedited. **Refused, named:** all 18 `pine:request` first walls (other symbol / dark lower timeframe / barstate offset / 12M / budget), loop running totals (ruling R7), coupled vars, block-local stops. No budget moved | `9808723a7e`, `ee1c6a7cc7`, `a8ff4b52fc`, `1cde2b4581` | 29 / 47 → 29 / 47 (pane off 16 → 16; base `5564cca92b`, objects pane on) | member door **68 → 75 / 266** on (45 → 52 off), base-vs-base 0 rows | the 47: 0 entries change. Committed harness dir: overall MATCH 50 → 52 of 138 (pane off 37 → 39) — `pivot-point-supertrend-rddt-1d-2026-09-27` and `qqe-signals-rddt-1d-2026-09-27` INCONCLUSIVE → MATCH, 0 regressions. Translation census 266: strict / member ok 64 → 71, screen 58 → 64; 0 previously served outputs changed. Notebook first-open 2,148,818 B both sides (+0, PASS); `pine` chunk 417,918 → 423,187 B (+5,269) |
| 64 | RT1 (lane brief, wave 12) the RUNTIME lane becomes the member door's general fallback, dark (section RT1): any host refusal is offered to it; declined, the member reads the HOST refusal verbatim. Withheld by name: a `?:` whose test can be `na` (two captures show TradingView taking the other branch), a series not proven to start at the listing (R-W for this lane), a shifted plot, a per-bar or unknown colour. Off the main thread (worker) under a 1,000 ms per-indicator budget; per-script kill switch `PINE_RUNTIME_KILL_LIST` (never a delete); the store's runtime door behind `PINE_RUNTIME_SAVE_ENABLED`. No budget or flag moved | `1bf1e4a3be`, `63c5680c4f`, `dcb7da5dad`, merge `c03f08295a` | 30 / 46 -> 30 / 46 flag off (overall 29 / 47 unchanged); runtime on 31 / 47 objects, 30 / 47 overall | translation census unchanged | 0 entries change on the 47 and the harness dir, both pane states, flag off. Member door 45 / 68 -> 45 / 68, **0 rows changed**; runtime on **71** (+ adx-and-di-for-v4 MATCH, wyckoff ungraded), 0 DIVERGE added |
| 65 | RT2 (lane brief, wave 12) the runtime document STATES its repaint class instead of declining (section RT2): `engine/runtime/runtimeRepaint.js` gives the host linter's three classes by the host's `modeFromReach`, as the worst reach over the reads the program makes (lexed code, never comments/strings), from ONE table (`runtimeRepaint.json`) read by the JS door and the Python save door (`api/services/runtime_repaint.py`), held to one answer per corpus script (`tests/fixtures/runtime_repaint/corpus.json`). A clock leaf's reach is the HOST linter's (`astReach` over `closedTable.json`) joined with a right-edge finding (islast / islastconfirmedhistory 1; lastbarindex / lastbartime / lastbar* unbounded), proved by moving the fetch through `computeClock`. Every drawn row carries the class as `mode` and `forward`; the store refuses a declared class that disagrees. A request the lowering does not fold is declined by name (`runtime:request`) at the door and at the run. No budget or flag moved | `0b2f2a809b`, `b31eae3ec8`, `a210db44dd` (wave 10 `e4e24524ef` already an ancestor) | 30 / 46 -> 30 / 46 flag off (overall 29 / 47 unchanged); runtime on 31 / 47 objects, 30 / 47 overall, unchanged | translation census unchanged | 0 entries change on the 47 (all three states) and the harness dir (pane on / off). Harness dir, runtime on: 2 entries change (the two `vw-int-array-avg` probes, INCONCLUSIVE -> DIVERGE on OBJECTS only: they now route to the runtime document and the host objects it carries are graded; no plot compared, no plot drawn). Member door 45 / 68 -> 45 / 68, **0 rows changed**; runtime on **71 -> 71**: of the 127 `repaint-unstated`, **0** attach - each now names its real wall (library 27, call-undeclared-builtin-state 11, pine:request 9, ...); repaint-unstated 127 -> 0 |
| 66 | RT3 (lane brief, wave 15) the RUNTIME lane's next walls, measured against the RT2 tip (section RT3): **(1)** an `na` CONDITION reads as false from v4, one rule for both lanes (`interpret.js::pineBool`, `naConditionIsFalse`, lexed version), applied by the runtime lowering only from the listing; v4/v5 `or` / `not` over an `na` operand stay counted and declined (capture queued); **(2)** `x[i]` over a variable's ring under a bound proved before bar 0 (`offsetRange`, `READ_HIST_SLOT_DYN` implemented, VM refuses past the ring); **(3)** `iff`, `vwma`, `linreg`, `alma` over runtime state from the host lane's own expansions / `pine_alma`; **(4)** a window over a price series sized by a function parameter is the columnar lane's column; **(5)** `runtime:library` is content, not code (the runtime lane already links; rail at the door) | `91b3567731`, `c44e7d6667`, `90129016ba`, `691047caf4`, `0b8ed8f12d`, `4fb1b2f778` | harness dir, objects + runtime on: MATCH 53 -> **54** (vw-var-seed INCONCLUSIVE -> MATCH, every plot on 8,473 bars: it was declined `runtime:na-test`, 5 v5 `?:` tests), DIVERGE 32 -> 32, no other verdict changed | unchanged | member door, runtime on: 78 -> **81** (+delta-rsi-oscillator-strategy, +fibonacci-dolphintradebot, +trend-targets-algoalpha), 0 lost; runtime census compiled 19 -> 21 (bare), 31 -> 33 |
| 67 | O1 (lane brief, wave 15) the drawing-only scripts: why each of the 33 `pine:no-output` and 6 `pine:object-removal-lost` scripts draws nothing (section O1). Triage: the first wall per script, read off `o1DrawingOnly.measure.test.js`; ten causes, largest G1 collections / UDTs 11, G2 loop-computed values 6, G4 data 5; the runtime fallback draws plot rows only, so it serves none of them. New read-only diagnostics `createDropWhy` / `guardRefusalWhy`. **G7:** `[x =] cond ? f(…) : na` with `f` a drawing helper and `x` read nowhere is `if cond` + `f(…)` (argued from Pine: `?:` runs only the arm it picks, C18's capture; `na` test → ELSE arm, RT1's). **G8:** `a := x, b := y` on one line splits as two lines (Pine's grammar). **G2b:** a getter read through a local (`top = box.get_top(b)` … `if x > top`) is the getter read at the `if` while nothing between can move the object. **G2a:** a first-match `for … if c(i): x := i; break` over literal bounds is the chained `?:` it computes | `69ec7f8963` (triage), `09a77a0fdb` (G7), `41561a52c7` (G8), `83422ea9c8` (G2b), `c82c14ad0c` (G2a) | 0 entries change in the committed harness dir (objects MATCH 73, overall 52 of 138, pane on), every step | translation census host 71 → 75, screener 64 → 65 (`fib-retracement`, `auto-trendline-dojiemoji`, `pa-zigzag-fibonacci-fan`, `sonarlab-order-blocks`) | member door on 75 → **79** / 266, off 52 → 54, on + runtime 78 → 82: `fib-retracement` (G7; 7 lines + 7 labels held to its Pine semantics on RDDT 1D vendor bars), `auto-trendline-dojiemoji` and `pa-zigzag-fibonacci-fan` (G8; each equals its two-line spelling, which attached at base; pa-zigzag host = runtime lane on every RDDT bar), `sonarlab-order-blocks` (G2a + G2b; every held box one its step-by-step Pine semantics keeps, on RDDT, AAPL and BRK.A vendor bars); no capture of any of the four (Q-O1a–d queued); 0 previously attached scripts lost |
| 68 | RT4 (lane brief, wave 15) the runtime lane's two RT2 rulings and its walls (section RT4): (1) `closedTable.json` declares `forward` on the nine right-edge clock leaves (`islast`/`islastconfirmedhistory` 1, the seven `lastbar*` broadcasts `unbounded`), both linters name the reach, RT2's `clockEdge` join is removed; (2) a runtime document whose run computed nothing draws none of its object program (`runtime:objects-without-run`, `nativeRegistry.runtimeObjectsWithheld`, binder + harness); (3) the five runtime walls measured by substitution (0 of 23 attach), none loosened | `3a77b89423`, `169eae248a`, `3157905b21` | 29 / 47 (pane on) unchanged; on + runtime unchanged | census 52 / 75 / 78 unchanged, 0 rows | harness dir pane on + runtime: `vw-int-array-avg` and `-neg` DIVERGE -> INCONCLUSIVE (objects withheld by name, not MATCH), DIVERGE 32 -> 30; every other state 0 entries changed; 0 corpus host trees read the nine leaves, 0 badges moved |
| 69 | H2 (lane brief, wave 15) the host translator's next three walls (`pine:reassign` 15, `pine:state` 11, `pine:block` 11 on the 266), each refusal traced to its construct and clustered (section H2). **Served:** **(1)** a comma line of statements whose LAST segment opens a block (`int d = na , d := switch` + arms) splits into the statements Pine runs (`commaStatementSplit`; the no-block case is O1's G8); **(2)** a block-valued reassignment `x := if ...` and a subject-less `x := switch` (top level and in a helper) is the ternary chain it spells, an `na` arm condition read as false (`subjectlessSwitchNode`). **Refused, named:** loop totals (R7, 17 scripts), constant-threshold counters, IIRs, latches, `varip`, UDT fields | `735859774b`, `6aca8f1345`, merge `f482325e71` | 29 / 47 unchanged | member door at the O1 merge 79 / 266 on (54 off, 82 runtime): 0 attach change, 0 lost; walls moved: 3-level-zigzag-semafor and sessions -> `pine:function` (clock); before O1 landed, the same split attached pa-zigzag-fibonacci-fan and auto-trendline-dojiemoji (O1 also attaches them) | vendor harness all 171 / harness dir 138, pane on / off / runtime: 0 entries change. Translation census host 75 -> 75, screener 65 -> 66 |
| 70 | H3 the host translator's language-feature walls at the member door (section H3): the 47 first refusals at H3's twelve codes read construct by construct, each candidate fix tried as a source rewrite before building; owners recorded (runtime lane for arrays mutated per bar and user-defined types; H2 for helper recurrences and loop totals; the clock lane for sessions). Served: `ta.vwap(source)` for a bar price as `vwapOf(source)`, the same accumulator as `vwap()` (graded on `vw-clock-vwap-spy-5-ext`, both lanes); a helper with a `switch`/`if` body called through itself is two calls, not a cycle; a destructure of a refused helper names the helper's wall. Refused by decision: v4 `alma` (Q-H3c), `fixnan`, `input.time` | `d0a85007e0`, `f97cbdb76c`, `14630ec3f4`, merge `a694822dc5` | 47 / 60 / 61 MATCH (all captures, pane off / on / runtime) unchanged; 0 MATCH -> DIVERGE | - | member door 54 / 79 / 82 -> **55 / 80 / 83** (+ cpr-with-mas-super-trend-vwap); 0 lost; `vw-clock-vwap-spy-1d` INCONCLUSIVE -> DIVERGE on its four vwap rows (daily vwap blank, pre-existing `vwap()` behaviour, question 1) |
| 71 | CAP capture round 4 (section CAP): 64 TradingView captures for the wave-15 queues (Q-NA, Q-H1, Q-L1, Q-S1, Q-B1, Q-O1, the vw-* rows), each `verify_capture.mjs` PASS, graded in `vendorHarness.capRound4` + `rt1NaTest` + `supertrendKivanc` with known divergences as `it.fails`. Vendor facts: an `na` `?:` test takes the else branch (every shape, v4/v5/v6); `input.int` `/=` keeps the fraction, a `const int` quotient truncates; the later `barcolor` wins; `offset`/`show_last` are render-time only; a v4 `bgcolor` with no `transp` takes 90 | `pine/cap-captures` (merged at `304a6ec692`) | no engine change | - | measured by F1 (step 73) |
| 72 | RT5 (lane brief, wave 16) the RUNTIME lane draws a script's objects ITSELF when the host object program would draw nothing (section RT5): `runtime/objectStore.js` (C7 collector, table one-per-position, linefill dies with its lines, version capacities), `OP.OBJECT`, `compute.objects: true`, the binder draws the run's own payload. Refused by name under the drawing build: `runtime:conditional-history`, a drawing call in one arm of `?:` (`runtime:object-op`). Census on the wave-16 tree runtime 86 -> 87 (+renko-candles-overlay, 0 lost); fibonacci-dolphintradebot RDDT MATCH; 17 of 19 direct-run captures agree. | RT5 |
| 73 | F1 the round-4 divergences (section F1): **(1)** `/` between two `const int` truncates before v6, both lanes (`pine.js::pineConstIntValue`, `constIntWritesOf`); **(2)** a `var` list of drawings off the listing is withheld by name (`objects:off-listing`) unless a FIFO cap evicted on this run's own length; **(3)** a drawing program the door withholds grades as withheld, not as "no program"; **(4)** from the listing a v4+ `?:` test reads `na` as false (`PINE_TERNARY`; `and`/`or`/`not` are F2's, F1's copy removed at the merge); **(5)** paints: `offset`/`show_last` placed at render time on both lanes, v4 `bgcolor` default transp 90 (later-`barcolor`-wins is RT6's); **(6)** a one-expression helper called from a `barstate.islast` block reads its one-run rewrite, and `ta.wma` + the five block-only `ta.*` are one-run rows in a helper; **(7)** daily `ta.vwap(src)` = the bar's own price (Q-H3a) | see section F1 | committed harness (252), objects pane on: MATCH 65 -> **70**, DIVERGE 64 -> **47**; runtime pane on: 71 -> **76** / 76 -> **59**; **0 MATCH lost** | - | member door 55 / 80 / 86 -> **55 / 80 / 87** (+ cc-yata, runtime); 0 lost |
| 74 | L2 (lane brief, wave 16) the corpus scripts that import a library, measured WITH the 50 production libraries (opt-in `PINE_LIBRARY_STORE`, L1's loader, read by the member-door, runtime and importer censuses) and their next walls (section L2). **Served:** **(1)** a user function's DEFAULT parameter values in the runtime lane (`paramDefaultsOf` / `completeUserArgs`): an omitted trailing argument is the default written at the call (literals, dotted built-in constants, Pine's bar series, refused by name when the caller binds the name); **(2)** a required parameter behind an optional one; **(3)** a tab is one indent level, four columns (TradingView/ta/9). Q-L1 graded with a fixture library at `TradingView/ta/7`: **MATCH, 7 / 7 plots, 636 bars**; the real ta/7 from the store (opt-in) MATCH too. No budget or flag moved | `4106fc6be2`, `553fe7bf1c`, `594271632a`, `3d79658033`, merge `25012b2311` | 47 not re-graded; capRound4 Q-L1 INCONCLUSIVE -> MATCH with the registry loaded | - | member door at the wave-16 tip `666ea1c854`, libraries loaded 55 / 82 / 88 -> **55 / 82 / 89** (+ rolling-vwap, runtime lane, ungraded: Q-L2a); empty registry 55 / 80 / 86 -> 55 / 80 / 86; 0 lost; runtime census `runtime:function` 11 -> 3 (store loaded), compiled 23 -> 23; tab rule: host formulas + runtime IR over the 266 unchanged (digest), 3 refusals moved |
| 75 | CAP2 coverage audit (section CAP2): census on the wave-16 tree (objects pane on 80 / 266, +runtime 86); the attached scripts with no TradingView capture (22 + the wave-16 attach cpr-with-mas) captured on NYSE:RDDT 1D from the listing and AMEX:SPY 1D, verify_capture.mjs PASS 50/50, graded in `vendorHarness.coverageAudit` (47 tests): **MATCH 6**, **DIVERGE 14**, **INCONCLUSIVE 2**, supertrend-explorer refused by TradingView. Queues: RT3 Q-NL-a/b (`or`/`not` read na as false, v4 and v5), H3 Q-H3a/b/c, CAP row 9 (lower-tf "30"/"1", 1M, CAVA lookahead) | `2ad89eaa9c`..`89dfd5ac8f` + rail | no engine change | attached with a capture: 61 / 79 -> 79 / 80 (on), all runtime attaches but supertrend-explorer | table in section CAP2 |
| 76 | H4 (lane brief, wave 16) LOOPS, ruling R7 (section H4): every loop shape is served on the RUNTIME lane, which already runs a counted `for`; nothing is folded on the host lane (an exact closed form needs every window element defined, which a loop does not guarantee). Removed the walls in front of the loop: **(1)** a call-site length that is constant arithmetic (`vl3 + vl4`) folds as a loop bound already did, `/` and `%` refused; **(2)** a helper ending in `if` around a `for` is valueless (C18's rule), reading it refuses by name; **(3)** `array.size(array.from(..))` is the argument count, effect-free elements only, never through a shadowing slot; **(4)** a refused row's `display.none` / `offset` reach the runtime document (two spreads dropped them) | `df9e500ac1` + the H4 docs commit | 29 / 47 unchanged | host 75 / screener 66 unchanged | member door off / on 54 / 79, 0 rows; on + runtime 85 -> **84**: wyckoff-accumulation-distribution withdrawn (its `offset = -pivotLen` markers were drawn on the wrong bar), kalman / NW / volume-divergence past their loop walls onto the per-bar colour and `pivotlow` walls; harness dir 202 x on / off / runtime: 0 entries changed (MATCH 56 / 41 / 62); `vendorHarness.h4Loops` 13 hand replays on 631 RDDT bars; 10 / 10 mutations red; Q-H4a queued |
| 77 | RF (lane brief, wave 16) the runtime pane made ready to switch on, and the switch-on plan (section RF, `docs/pine/runtime-pane-switch-on-plan.md`): every stop of a run is named (`runtime:limit`, `runtime:failed`, `runtime:worker-unresponsive` / `-failed`, `runtime:load-failed`) and said on the disclosure strip (no surface rendered a column error before); a dead or hung worker answers its jobs by name and is never re-run on the main thread (watchdog 20 s, 3 starts per tab, newest-run coalescing); a kill takes the installed copy off an open tab; a runtime document names the bar colours it does not draw (3 of 6 omitted them silently since B1). Off-main-thread proved in real Chromium (worst frame gap 17 ms, control 383 ms). Store round trip on the six real documents. No flag, budget or limit moved | `caa526cd31`, `54c5e82ea7`, `828dc181b8`, `f64f9cfdf0`, docs | not re-graded (no routing change); runtime on: adx-and-di MATCH, inside-bar DIVERGE on paints only (plots + objects MATCH) | unchanged | member door 55 / 80 / **86**, 0 rows changed by RF (no routing change); runtime-only 6: 1 graded MATCH, 1 paints-DIVERGE, 4 no capture |
| 78 | F2 plot values and per-bar colours CAP2 graded (section F2): `x = if ...` colour arms carried (`openBoundArm`, implied-volatility-suite); v4/v5 `and` / `or` / `not` read an `na` operand as false in both lanes (RT3 Q-NL, `naOperandReadAsFalse` via `naConditionIsFalse`; runtime no longer counts them); a plot colour graded from its own rule's reach (`colourWarmupOf`). Causes recorded for the rest (daily vwap = F1; EMA/RMA seed off the listing = integrator question; ratchet off the listing; bar-0 reading) | `c2c0c007cd`, `362278f50b`, merge `0bdb2c685c` | all 285, off / on / on+rt: MATCH 56 / 74 / 74 -> **58 / 76 / 76**; 0 MATCH -> DIVERGE | 55 / 80 / 80 unchanged, 0 rows | implied-volatility-suite rddt/spy DIVERGE -> MATCH; rt3-na-logic / -v4 DIVERGE -> INCONCLUSIVE (every graded row MATCH); cpr SPY bar-1 colours MATCH; 7 mutations all red |
| 79 | F3 drawing divergences on the host object lane (section F3): `str.tostring(x, format.mintick)` rounds to the witnessed tick and keeps its decimals; words around a pattern (`"Swing H  (#,###.####)"`) are read; a non-literal format is carried named (`na` prints `NaN`, a finite value withheld); a drawing the door withholds is graded as a named gap (`withheld`), not "no drawing program". trend-targets RDDT objects MATCH, swing-highlow-zigzag RDDT MATCH; multicator / atr-trailing / pmax labels withheld by name; zigzag SPY lines are a window (35 of 52 below the window) | F3 commits on `pine/f3-drawing-divergences` | `pineTextFormat.js`, `pine.js` text reader, `objectProgram.js` binding, `objectRuntime.js` formatter; harness `ourSide.js` + `compare.mjs` | object MATCH 117/133 -> 118/135 (on/runtime), capture MATCH 73/79 -> 74/80, census 55/80/86 unchanged, 0 MATCH -> DIVERGE | table in section F3 |
| 80 | GT (lane brief, wave 16) the owner's switch-on rulings for the runtime pane (section GT, `docs/pine/runtime-pane-switch-on-plan.md` *GT operator steps*): D1 a per-member stage `PINE_RUNTIME_STAGE` (off / admins / all; per request; default off pinned) on the auth payload (`pine_runtime_pane_enabled`), latched per tab, required WITH the build flag, and asked of the saving member at the store; D2 runtime documents capped at 128 KiB (formulas 64 KiB; trend-targets saves); D6 the starter allowlist (`api/data/pine_runtime_allowlist.json` + `PINE_RUNTIME_ALLOWLIST`; adx-and-di-for-v4 only; others decline `runtime:not-yet-graded` with the host sentence; empty = none; stored rows served stamped); RT4 follow-up: a direction-B row is served with `repaint_notice` and the Builder shows it, the stored label never flipped. D3/D4/D5 unchanged. Nothing flipped | `40c82dc9ec`, `50e7b8b76c`, docs | not re-graded (no routing change for a permitted member with the list open) | unchanged | with the stage on, the runtime-only 6 attach 1 (adx-and-di-for-v4) until more are graded; 0 for every member while the stage is off |
| 81 | CAP3 standing capture lane (section CAP3): Q-L2a rolling-vwap (RDDT plots 7/7 MATCH with the store, table cell DIVERGE), Q-RT5a (vendor rows pinned; still refused), Q-H4a (RDDT MATCH 4/4), Q-RT5b renko (RDDT MATCH), Q-RT6a-f (kalman + deadband MATCH, probe colours DIVERGE, nadaraya/atr-stepped INCONCLUSIVE, parabolic-sar DIVERGE); 69 of 71 SPY 1D gap captures (all but supertrend-explorer, refused by TradingView, and rolling-vwap, whose SPY capture is Q-L2a's): MATCH 19 / DIVERGE 48 / INCONCLUSIVE 2, pinned by signature | `b2794f9f34`, `0e083dd37a`, `296a085e9f`, `7eb130a8f5`, `fec87573d9`, `4744b3e6c7`, batch 7 | 69 SPY + 14 queue harness files | - | census (libraries loaded) 55 / 82 / 89 |
| 82 | RT6 per-bar colour on the RUNTIME lane (section RT6): a plot's `color =` is an output of the same run (opt-in `plotColours`, appended after every other output), carried as a hidden packed-colour column (`colorPacked`) and drawn by the host renderer (`pool.columnColorsForPlot` -> `packedPointColour`; an `na` colour draws nothing); `bgcolor` / `barcolor` ride the runtime document as paints coloured by the run, with `transp =` or the v4 `bgcolor` default 90 (CAP round 4) folded into a provably opaque colour only; within one script the later `barcolor` wins (CAP round 4 P1/P2); `color.new` / `color.rgb` over `na` are `na` | `98cab84278`, `b8983a327c`, `10cadf56d2` | harness dir 295 (runtime pane permitted): MATCH 86 -> 87, DIVERGE 94 -> 91; inside-bar-range RDDT DIVERGE -> MATCH, vw-deadband-ticks AAPL / SPY DIVERGE -> INCONCLUSIVE (DBHF MATCH, the barcolor agrees); 0 MATCH -> DIVERGE | census on + runtime 87 -> 93 (atr-stepped-pdf-ma, deadband-hysteresis-filter, fvg-trend, kalman-price-filter, nadaraya-watson, parabolic-sar); off / on 0 rows changed |
| 83 | RT7 the runtime lane's next walls (section RT7): reductions skip `na`, an empty `array.max/min` is `na`, `na` is found nowhere, v6 counts a negative index from the end (all from `vw-array-na-spy-1d`; wyckoff RDDT now draws TradingView's 12 boxes); `ta.valuewhen` / crosses inside a function per call site (`carried2Base`); a fixed pivot `rightbars` folded; `fixnan`; the VM dispatches through a jump table (5,000 bars: renko 797 -> 214 ms, dolphin 1,079 -> 221 ms, digests identical) | `pine/rt7-runtime-walls` | census 55 / 82 / 99 -> 55 / 82 / 99 (0 lost, 0 gained; 7 runtime rows to later walls) | harness identical except wyckoff RDDT objects INCONCLUSIVE -> MATCH |
| 84 | H5 host-lane values (section H5): a period anchor read from the listing is not withheld (both lanes); a function's DEFAULT parameters on the plot lane, one shared rule with the runtime lane (`paramDefaultShapeOk`), a script-rebound bar-series default refused by name; a request timeframe passed through a function parameter, on the plot lane; `math.round_to_mintick`; `str.tostring(x, format.volume)` where captures pin it. F4's request-held drawings (liquidity-heatmap, htf-liquidity, ema-ribbon) stay refused: data not held | `pine/h5-host-values` | census 55 / 80 / 87 -> 56 / 80 / 87 (libraries 55 / 82 / 90 -> 56 / 82 / 90), 0 lost | vw-default-param D01-D15 and Q-L1 MATCH on the host lane; ADR (off) INCONCLUSIVE -> MATCH; 0 MATCH -> DIVERGE (`8579b64f75`, `71ca1694c5`, `0df971ee42`, `7d12c5cbb8`, `7a8404c9f7`) |
| 85 | F4 the CAP3 SPY 1D drawing/table divergences classified (section F4): two engine bugs FIXED - a library value named like one of its functions (`rlut = rlut()`) is spelled apart from it by the linker, and `text = na` is the empty string - all-chart-patterns SPY DIVERGE -> MATCH (156/156 objects id for id); window proved by TradingView's creation counter on contraction-box (all four counts from SPY bar 6677 + the collector), high-low-open-mid, artemis, institutional-smc; the rest withheld by name, owners recorded | F4 commits on `pine/f4-spy-drawings` | `pineLibraries.js` (`mangleValue`), `pine.js` (`textNodeOf`) | harness 328 files: capture MATCH 85/95 -> 86/96, objects 137/161 -> 138/162, 0 MATCH -> DIVERGE; census 55/82/90 unchanged | table in section F4 |
| 88 | F6 the second CAP3 SPY 1D batch of drawing divergences classified (section F6): one engine bug FIXED - the runtime lane's own drawings refused v4's bare `round_to_mintick` as an undeclared builtin (parabolic-sar RDDT runtime DIVERGE -> MATCH, 54/54 labels); window/collector proved for makuchaku FVGs (all four counts from TradingView's counter), pro-trading-art, rsi-swing, price-action, trend-duration, liquidity-pools; vdubus = window + two C22-withheld zig-zag spans; the rest withheld by name with owners; one open wrong caption (leviathan, bounded accumulator gap > 250 bars, owner F5) | `4cf39e9ecb`, `d4933aa919`, docs | `pineRuntimeFrontend.js` (bare `round_to_mintick`) | harness 328 files: capture MATCH on 96 -> 96, + runtime 109 -> 110; objects 155 -> 155 / 187 -> 188; 0 MATCH -> anything else; census 55/82/99 unchanged (0 rows changed) | table in section F6 |
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
took 36 s before and 38 s after. **Retired by step 36 (§ C24)** without moving an
id: the probe still runs first; only its REPEAT is replayed.

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

## C20 — runtime text, runtime colours and `while` drawings, off the same run (2026-09-30, step 31)

**What is read.** C18 read a last-bar drawing's NUMBERS from one run of the script, at the drawing's own statement. C20 reads three more things off that same run, served under C18's four conditions and withheld (C17) otherwise:

- **Text** (`{t:'str'}`, `runtime.at[k].kind = 'text'`): a string only the run holds — a word chosen under a condition the columnar lane cannot read (max-pain's `gamma_bias`), a concatenation of strings. It rides a per-iteration text buffer (slot 0) read at the end of each bar. ⛔ A number in a text is still `{t:'num', fmt}` and formatted by the object runtime's `str.tostring` rules; the run has no `str.tostring` and is never asked for a node with a call other than `math.*`, `na`, `nz` (`pine.js::rtTextSafe`). A value the run reports as text when a number was asked is asked again as text where a text slot can take it (`translatePine`'s runtime rounds now carry `kinds`).
- **Colours**: `color.new(c, t)` is `{c:'new', of, t}` — `c` read by the columnar colour reader or from the run, `t` a literal or the run's value, the transparency set per bar by `objectProgram.js::withObjectTransparency`, the ONE alpha formula (`staticObjectColourOf` calls it too). Any other colour the run computes is `{c:'rt'}`, served **opaque only**: the run packs a transparency as `round(t × 2.55)` and TradingView's opacity is `round((100 − t) × 2.55)` — measured on the NET label, `color.new(red, 70)` is alpha **77** at TradingView and the run's byte gives **76** — so a packed alpha is never turned back into an opacity. A colour asked of the run that comes back unserved (transparent, a fractional or out-of-range transparency, `na`) HOLDS the object (`objectRuntime.js::unservedColour`); it is never drawn in a default. ⛔ An input transparency is read from the run at defaults, never folded (folding would mint a member parameter, R36).
- **Drawings made inside a `while`**: `pineObjects.js::rtLoopTry` carries a `while` under `barstate.islast` (the converter's own `splitLastBarNode`), not inside another loop or an inlined helper, whose body holds ONLY statement creates (`line.new(…)`, `label.new(…)`, `box.new(…)` — no kept handle, no delete, no list edit, no nested drawing loop); anything else rolls every counter back and reads the loop the old way (`loopBlocked`). The converter makes it a counted loop `0 to N-1` whose bound is the run's own pass count (`runtime.at[k].passes`, the `while`'s count slot after the loop; `na` where not reached, so zero passes), and every body op's guard is the statement's per-pass REACHED signal (a `continue` above it is seen) and every value the run's per pass — never the columnar lane's, whose answer is one number per bar. The frontend writes per-pass values into per-iteration buffers indexed by the pass (`count − 1`); a loop with more passes than a buffer holds (500) is unknown on that bar and the whole loop withheld, never read short. Drawings are made pass by pass, statement by statement — Pine's creation order.

⛔ **Not in a script that reads `timeframe.period`** (C15: the run spells a v6 daily period `D`, TradingView does not) — no text, colour or loop is asked of the run there.

**The C18 census slowdown, settled.** Alternated, wave 5 `fb846eaef` vs C18 `0b8dc212b`: 51.2 / 49.7 s vs 56.2 / 59.6 s of census test time — real. Profiled per script: the pass ran WITH the runtime check first, and a script the lane cannot build (a library, a dynamic offset — most of the corpus) paid a whole second object pass to arrive back at the plain one (artemis-oscillator-pro +597 ms; the corpus +1.7 s a translation). Now the plain pass runs once (byte-for-byte the old fallback), the lane is asked only for a script that draws under `barstate.islast` and lost something the lane could supply (`rescuable`), and a script the lane cannot build is found by one compile, `check(source, [])` (an objects-only script's `runtime:no-output` counts as buildable; the check with the values stays the authority).

**Measured (RDDT 1D, objects pane on, base `6415ef77c` = wave 6).** max-pain: lines 2 → 10 / 10, labels 3 → 6 / 8, boxes 0 → 1 / 13; every drawn object TradingView's value for value, ids in TradingView's order (`vendorHarness.c20MaxPain`). 47 captures and the committed harness dir: only max-pain changed.

**Still refused, and what would settle each.** max-pain's 12 heatmap boxes and 2 legend labels — `color.from_gradient`, whose interpolation curve no capture pins; settled by a gradient probe capture (a value sweep 0 → 1 between two known colours, with and without `color.new` on top), checked against max-pain's own 14 captured gradient colours (both legend labels sit exactly on the endpoints, `#0064C84D` and `#FF32324D`). k-clustering — `INSTRUCTIONS_PER_BAR` (ruled: not raised). A drawing in a NESTED loop, a loop that keeps or edits a handle, a counted `for` whose values only the run computes — not carried (named `loopBlocked` / the reader's refusals); settled by a script in the corpus that needs one. A transparency that is not whole — unmeasured; settled by a capture of `color.new(c, 70.5)`. Text or colour from a script reading `timeframe.period` — the v6 spelling question (C15).

## C21 — dual-view: every wall named, and a wrong value found in the runtime lane (2026-09-30, step 32)

Branch `pine/c21-dual-view`, base `c4ddd0418` (wave 6). `dual-view-htf-candlestick-patterns-theultimator5`
(capture `…-rddt-1d-2026-09-28`, NYSE:RDDT 1D, 632 bars from the listing): TradingView holds 436
objects — seven floating HTF candles made on bar 0 and re-set on every bar (7 boxes, 28 lines,
ids 1–35), and, all made on the last bar, the 43 candle patterns its 200-candle scan finds
(104 boxes, 208 lines, 86 labels, ids 36–433), one centre label and two floating pattern labels.

**The walls, re-measured on the base** (the member door's own translation — `strict`, the runtime
check on; a byte-restored instrument on `canonicalOf` for the tree refusals):

| what | where | shape | first wall |
|---|---|---|---|
| 78 `pine:state` | 58 on the guard at L479, 14 on L527, 6 value reads (L529–539) | ONE construct: a `var` declared inside `update_drawings`' `for` (`var float htf_o = na` … `htf_o := array.get(htf_open, array_index)`), one variable across passes and bars, fed by 212-slot `var` arrays that a `while` shortens (`inlinedLocalBinding`) | a function's own mutable local; the arrays are windows with an input cap above 64 — C22's boundary |
| 39 `coll:diverged` | reads of 10 lists | the floating lists' bar-0 pushes (L412–430) read the loop counter; the historical lists' pushes (L771–802) sit in a loop whose bound reads an array; `pattern_labels`' (L906) under `pine:reassign lowest_point` | the lost pushes' own classes |
| 7 `create:*` / 5 `coll:push` | L412–430, `initialize_drawings` | coordinates that read the loop counter (`loopValuesUnresolved`) | counter-dependent values (iterTrees off in the host lane) |
| runtime lane | `probeObjectRuntime` | refused in order: `barstate.isfirst` (window-dependent), `timeframe.change` (screen), `request.security … lookahead` (own timeframe), `math.avg` (undeclared), `input.color`, `syminfo.mintick` (unsettled at compile), `alert()` (presentation) | each exact on a from-listing 1D chart at defaults, measured by substitution |
| runtime lane, behind the seven | the last bar | **281,431 VM instructions** against `INSTRUCTIONS_PER_BAR` 200,000 | not raised (ruling) |

**What C21 changed.**

1. ⛔ **A wrong value in the runtime lane, fixed** (`pineRuntimeFrontend.js::declarationPersists`). A
   plain declaration was lowered as a PERSISTENT slot whenever ANY declaration of the same NAME
   anywhere in the script said `var` (`scanMutability(...).persistent`, a whole-script name set).
   `detect_pattern_at_index`'s `float htf_o = get_htf_open(i)` shares its name with
   `update_drawings`' `var float htf_o` — so the scan read the first bar's candles, and the run
   found 51 patterns (the first at candle 6) where TradingView drew 43 (the first at candle 3,
   hand-checked from the capture's bars). Pine scopes a variable to its function and block; a
   declaration persists exactly when it says `var`. Minimal: `f() => var float x = na` beside
   `g() => float x = close` read the first close on every bar; a top-level `var x` did the same
   to a function's `x`. ⭐ **Not live in production**: the runtime pane is dark (`VITE_PINE_RUNTIME_PANE_ENABLED`
   unset) and C18/C20's object values are not on `origin/production` (`28c4082f8`); on the wave-6
   integration branch no served script carries the collision (max-pain's and k-clustering's vendor
   rails unchanged).
2. **The persistent bound covers every function's frame** (`lowerIr.js::persistTotal`). A function
   body is emitted whether or not a call site reaches it; `f() => var float x = na` beside
   `plot(close)` refused to lower (`JUMP_IF_INIT slot 0 outside 0 persists`) and lowered only by
   the accident above.
3. **Sharper names** (diagnostics only; every drop, key and class as before):
   - an inlined function's mutable local no longer opens with the running-total clause (false of it;
     `pine.refusalAuthority.test.js`'s rule) — `HELPER_LOCAL_CLAUSE`, and `guardRefusals` names it:
     ``update@491: pine:state `htf_o` (a `var` carried in a loop of `update_drawings`)`` (a
     `var` in a loop of the helper, `bodyNames`' `carried`) or ``… (reassigned inside `f`)``;
   - `objectDiagnostics.collsDivergedWhy` names the first change each diverged list lost
     (`candle_bodies: coll:push@412`, `historical_candle_boxes: loop:bounds@771`, …; the reader's
     own losses carry theirs, `lostCollsWhy`).

**Grades** — see the fix-order row. Nothing drawn moved: dual-view stays a door refusal of its
drawing (the HTF MA plot carries the door), every object withheld and named.

**Vendor-backed, by substitution** (`vendorHarness.c21DualView`): with the seven compile walls
replaced by their exact equivalents on this capture (`isfirst` → `bar_index == 0` on a from-listing
series; `timeframe.change("D")` on 1D → `bar_index > 0`, C8; the own-timeframe request → its
expression, C10; `math.avg(a, b)`; the colour defaults; RDDT's 0.01 tick; `alert` removed) and a
test-only ceiling, the run's 43 pattern texts equal TradingView's 43 historical pattern labels in
creation order, and its floating candle 3 is TradingView's `Dark Cloud Cover`. The product path
refuses the same bar on the ceiling (the k-clustering precedent).

**Refused, and what would settle each:**

| what | would settle it |
|---|---|
| the last bar's 200-candle scan (281,431 instructions) | an owner ruling on `INSTRUCTIONS_PER_BAR` — not this lane's (ruled: not raised) |
| the seven runtime compile walls | each is exact on a from-listing chart at defaults (above); serving them needs the runtime lane told it serves a PANE (`isfirst`, the clock) and the own-timeframe identity at run time — only worth building once the ceiling allows the bar |
| Pine v6 `and` short-circuit | the lane short-circuits only operands it proves 0/1; `… and array.get(candle_in_pattern, i)` reads index −1 eagerly and stops the run (fails SAFE: withheld). v6 bools are never `na`, so every v6 `and`/`or` may short-circuit — named, not changed |
| the floating candles | a helper's `var` carried in a loop (the 78), and the 212-slot windows it reads (input cap, `while`-shortened: C22's window work) |
| drawings made in nested counted loops and pushed into lists | a trace of the run's creates in order (C20 carries only a `while` of statement creates) — and the ceiling first |

## C23 — the runtime lane serves a pane: C21's seven walls and v6 `and`/`or` (2026-09-30, step 34)

Branch `pine/c23-runtime-pane`, base `db6190f3f` (wave 6). Every construct below is the HOST lane's own
definition reached from the runtime lane — no rule is restated; the runtime lane asks `pine.js`.

| construct | rule (where it lives) | vendor proof | host parity |
|---|---|---|---|
| `barstate.isfirst`, the clock | `buildRuntimeIr({pane: true})` → `Resolver` `strict` + `basePeriod` + forming tri-state (`resolverOpts`); every door in `runtimeColumns.js` passes it; unset = screen, `pine:window-dependent` kept | dual-view as written (floating candles made on bar 0) | `isfirst` / `isconfirmed` (forming and closed) bar for bar |
| `timeframe.change` | the same door (`clockCloseCallOf`: `isfirst ? 0 : first-of-period`) | `vw-clock-close-tfchange-spy-{1d,1w}` K04/K05/K06/K16 on every bar | the same columns |
| own-timeframe `request.security` | `Resolver.requestTargetOf` (split out of `securityAsNode`); identity only; never for an argument reaching a runtime slot | dual-view's HTF MA feeds its trend filters → the 43 patterns | dual-view's `htf_ma_value` = host `ta.ema(close, 12)` on every bar; `"D"` on a 60m chart refused in both |
| `math.avg` | `BUILTIN_CALL_TREE.avg` rebuilt over the call's arguments; `BUILTIN_CALL_TREE_MIN_ARGS` for both lanes | donchian's Basis with its arguments carried in `var`s equals TradingView's | IR identical to `(a + b) / 2`; column = host's |
| `input.color` | `inputColourDefaultNode` (the host's every colour reader); no parameter minted; values served at defaults only | dual-view's nine colour inputs | IR identical to the default written in |
| `syminfo.mintick` | bound from the chart's `symbol` (`bindConstsFor`, `symbolScope.json` tick table); compile-only doors defer it (`symbolAtBind`, zero bars only); `objectColumns.js` threads `symbol` to the run | `vw-mintick-{aapl,brka,spy}` M01 on every bar | = host column; OTC refused by name; no symbol → withheld |
| `alert()` | a presentation no-op (host: `CHART_ONLY_CALLS`); an argument whose evaluation can change something (user function with an effect, collection/drawing call) is evaluated in place | — (no capture observes an alert) | — |
| v6 `and` / `or` | `lowerIr.js`: lazy for every operand, `a ? bool(b) : false` / `a ? true : bool(b)`, NaN read as false; the provable-0/1 form (C18) byte-identical; v4/v5 eager | dual-view's `… and array.get(candle_in_pattern, i)` no longer reads index −1 (43 patterns) | finite operands answer as the eager form |

⛔ **A choice, stated:** where an operand of a v6 `and`/`or` is held as NaN (a column's warm-up, the
unmeasured probe) the answer is `false`, not the eager `logical`'s NaN — Pine v6 bools are never `na`, and
the probe runs (NaN / −1e12) still disagree there, so an unmeasured value stays withheld.

**Instructions:** dual-view's last bar 247,425 (hooks 256,060; C21's substituted 290,066 at base) > 200,000 —
withheld by name, budget not raised. k-clustering (v5) 800,777 unchanged. max-pain 11,710 → 11,742.

**Still refused, and what would settle each.** dual-view — `INSTRUCTIONS_PER_BAR` (owner ruling; not raised)
and, for its drawing, the host walls C21 names (a helper's `var` carried in a loop, lists diverged).
k-clustering — the same budget. `request.security` to another period or symbol — unchanged (C10). An alert's
delivery — the host's path; nothing here fires one.

## C24 — the comparison probe is replayed, not resolved twice (2026-09-30, step 36)

Branch `pine/c24-mintfree-probe`, base `d6bb8b336` (C23). Integrator ruling: no saved parameter id
may move — no re-pin of `docs/pine/param-ids.json`.

**Why a mint-free probe was not the answer.** The probe IS the first resolution of its operands, and
the mint counter is shared by every output's Resolver (a refused output mints too), so any probe that
mints less than today moves the ids of whatever resolves next — which is what C9's reverted pre-check
did. So the probe is untouched and mints exactly as before; what C24 removes is the REPEAT.

**The mechanism** (`pine.js::Resolver.resolveProbed`, used only for `<`, `>`, `<=`, `>=`):

| rule | why |
|---|---|
| the probe's tree is kept in a per-comparison map and handed to the swapped re-probe and the ordinary path's `resolve` | these are the second and third resolutions of the same node in the same scope — the doubling per nesting level |
| replayed only when `env`, cycle `stack`, argument `frames` (+ length), `selfReads`, `paramMint` and `objectPass` are the SAME objects; a refusal is never kept | a tree is only the repeat's answer in the scope it was made in |
| kept only when the probe did no first-time work — `firstTimeMark`: the mint counter, every `Map`/`Set` field's size (read generically), and `firstTimeWork` (a window `readMemo` filled) | the first resolution of an input (its `minval`/`maxval`/`step` resolve at mint), a `var` read cache miss or a window memo miss is DEARER than a repeat; charging it to the replay moved `budgetSteps` on 99 of 1,130 script × mode rows in the first cut (artemis +7,661 over its 603 Resolvers) |
| the replay adds the probe's steps to `budgetSteps` (the clock is asked when that crosses a 4,096 boundary, `checkClock`); when those steps would pass `maxSteps` it resolves for real | the step cap fires at the node, with the caret, it always did |
| not used when an operand is a `var` state binding or a bare `obv` | `boundedRunLengthThroughBinding` / `boundedObvAgainstOwnAverage` do work between the probe and the ordinary path |

**Proof, before (`d6bb8b336`) vs after, by scratch dumps** (a stable serialisation that also carries the
non-enumerable `__uctParamId` / `inputName` / `inputDefault`):

| dump | rows | result |
|---|---|---|
| `translatePine` manifest + plain, and the `inputParams` list, for `corpus/committed` + `pine_oos` + `member` + `fixtures/pine` (320) | 960 | identical |
| every Resolver's final `budgetSteps`, both modes (320) + the member door × both objects flags (266) | 1,172 | identical |
| `enterMemberDoor` build + installed definition, 266 × both objects flags | 532 | identical |
| `runOurSide` (objects pane on) + door build for the 47 RDDT captures | 94 | identical |

`paramIds.test.js` green without re-pin. `pineProbeReplay.test.js` pins the pre-C24 numbers (step totals
of a 12-deep comparison chain and five corpus scripts, the refusal location of a `pine:timeout` at every
cap from 100 to 61,500) and that real resolves grow linearly (61,435 → 574 on the chain); seven
mutations each red it: no replay, no step charge, purity gate always true, no cap fallback, `readMemo`
not counted, `Map`/`Set` sizes not counted, the mint counter not counted.

**Timings, alternated (before | after, ms; 3 translations per round; box load fell over the run):**

| round | 22-rsi translate | 22-rsi member door | corpus translate 320 × 2 | census 266 × 2 |
|---|---|---|---|---|
| 1 | 3258 3175 3554 \| 1315 1162 1061 | 7180 7045 6984 \| 2787 3170 2867 | 34,047 \| 26,705 | 40,679 \| 47,813 ᵇ |
| 2 | 2986 3049 2969 \| 1223 1291 1163 | 6659 6859 6896 \| 2670 2720 2530 | 31,875 \| 23,287 | 42,218 \| 25,681 |
| 3 | 1763 1606 2062 \| 880 893 942 | 4350 4309 4131 \| 2571 2095 1749 | 19,817 \| 18,436 | 29,937 \| 26,728 |
| 4 | 1576 1551 1932 \| 835 837 762 | 3736 3873 3549 \| 1666 1675 1507 | 21,772 \| 15,786 | 31,445 \| 25,599 |
| 5 | 1636 1560 1534 \| 697 632 677 | 3207 3023 2811 \| 1495 1494 1307 | 17,795 \| 13,207 | 25,693 \| 21,658 |

ᵇ The one round where after was slower; it was the first run on a loaded box and is not repeated in
rounds 2–5.

## C25 — a loop's passes on the host object lane, and a helper's `var` carried in its loop (2026-09-30, step 35)

Branch `pine/c25-helper-var-loops`, base `d6bb8b336` (wave 6 + C23). C21 named dual-view's two host walls:
78 `pine:state` on ONE construct (a `var` declared inside `update_drawings`' `for`) and 39 `coll:diverged`
over ten lists. Both sit on Pine facts about a counted loop the host object reader did not carry.

| construct | rule (where it lives) | proof | refused, by name |
|---|---|---|---|
| the counter through a local | `pine.js::loopArgRef` follows an `expr` binding (`openName`), read in its own scope | `objectLoopScalars` (1): four boxes and wicks at Pine's coordinates | a local the loop reassigns (opaque, as before) |
| a midpoint | `/` in `OBJECT_VALUE_OPS` (`BINARY['/']`, a zero divisor declines), `round` in `OBJECT_VALUE_UNARY` (`POINTWISE.round`) | (1): `(left + left + 3) / 2` rounds UP | `math.round(x, precision)` |
| a condition on the counter | `guardOfIn` / `liftLive` / `liveOperand` lift it (`cmp`/`bool` over `{v:'loop'}`), latched; `objectProgram.js::containsGet` admits the counter | (2): `if … else` on `i` draws each arm on its passes | `%` and anything else outside the address grammar |
| a helper's `var` in its loop | `pineObjects.js::loopScalars` → `program.nums[].loop`; each whole `:=` a `setnum` in the loop body (guard built at conversion); read whole, `na(x)` as `not (x == x)`; `opValueRefs` binds and walks `setnum.value` | (3): the host labels equal a bar-by-bar replay AND the per-bar runtime lane running the helper as written (a trace array), carry across bars included | a `+=`, a write in a `while`, a non-literal or non-numeric declaration; a write whose value or guard is not carried — every read then names that write |
| an object a lost step moved | `lostCopyColl` + `geometryLostBy` → `withholdContent` (one spread with `content:lost`), `geometry:lost`/`geometry:withheld` (`objectLoss.js`, PARTIAL) | (4): the list's boxes held; control: a lost STYLE step leaves them drawn | — (the known-target case is C22's per-bar `lostGeometryOp`) |

⛔ **Host lane only.** `hostPasses` (`!rawTrees && !iterTrees`): the runtime lane's own object pass
(`runtime/objectLane.js`) evaluates each pass itself and keeps exactly its program — measured byte-identical
over the 266-script corpus.

**dual-view, re-measured (the door's translation):**

| wall | C21 | C25 | first wall now |
|---|---|---|---|
| floating lists' bar-0 pushes (`initialize_drawings`) | `coll:push` ×5, `loopValuesUnresolved` 7 | converted | — |
| floating boxes and wicks | never made | made and HELD (`geometry:lost` 3) — their moves (`box.set_left(body, …)`) are lost with the copy `body = array.get(candle_bodies, i)` | the loop scalars below |
| `htf_o` … `candle_array_index` (7 loop scalars) | `pine:state` ×29 guard refusals, wall unnamed | refused, NAMED: pass 0's `htf_o := current_htf_open` reads a `var` whose block fold stops at the `while` of line 627 | the windows' `while` (212 slots, a cap of `math.max` over three declared knobs, shortened in a loop) — **C22's boundary. C22 (`pine/c22-trend-vdubus`, unlanded) serves `if size > input(…)` caps only, so it would not reach this one either** |
| historical lists | `loop:bounds` | `loop:bounds`, `loopBoundsWhy`: `loop@743: pine:undefined: num_completed_htf` — a block local the islast block's fold never bound (`array.size(htf_close)`, the same window) | the window |
| `pattern_labels` | `guard:loop` under `pine:reassign lowest_point` | unchanged | `lowest_point` is a block local rewritten per pass from window slots (`math.min`) |
| lists diverged / reads withheld | 10 / 39 | 5 / 18 | — |

Nothing is drawn: the door refuses the drawing (a lost removal, `delete@875`), as before. The horizontal
reference lines now in the program (made on bar 0, only re-coloured — `if show_horizontal_lines` folds
false) are withheld at run time by the warm-up curtain (`drawings_initialized`, an `accum` over
`barstate.isfirst`), so no object reaches the chart.

**Refused, and what would settle each:**

| what | would settle it |
|---|---|
| the floating candles' values (passes 1–6 read `array.get(htf_open, array_index)`; pass 0 reads `current_htf_open`) | the 212-slot windows served as series (C22's window work widened to a `while`-shortened, knob-computed cap over `MAX_WINDOW_CAP`), which also settles `current_htf_open`'s block |
| the historical pattern lists (`loop:bounds`) | the same window: the loop's bound is `math.min(historical_lookback, array.size(htf_close))` |
| `pattern_labels` | `lowest_point` carried as a per-bar block scalar — the loop-scalar mechanism extended to a non-`var` local rewritten across passes, plus `math.min` over a scalar (not in the address grammar) |
| a loop scalar inside arithmetic (`math.max(htf_o, htf_c)`) | the value grammar over scalars — `setnum` carries any value, but a READ is whole only, the C14 rule |

## C22 — trend-duration-forecast and vdubus-pattern-gen (2026-09-30, step 33)

Branch `pine/c22-trend-vdubus`, base `c4ddd0418`, merged onto wave 7 (`7bb036d1c`: C23, C24, C25). Both
scripts refused their drawing at `pine:collection`. Each rule below is exact where it serves and refused by
name elsewhere; every drawing counted here was checked against the capture object by object.

| construct | rule (where it lives) | proof | refused, by name |
|---|---|---|---|
| a three-arm drawing chain | an `else` arm carries the negation of EVERY earlier arm (`pineObjects.js` walk) — it carried only the last: the `else` label drew on 124 RDDT bars where Pine draws 107 | `objectElseChain` (Pine replay) | — |
| a counter reset by another state | `forgetsOnReset` asks the NEAREST recurrence's `self` (`containsFreeSelfSeries`) | `switchedResetByOtherState` (Pine replay; parity case added) | `trend-levels-chartprime` now names its next wall (`pine:window`) |
| a window read inside its writer | `readVerdict` per read position (`windowReadVerdict`); if / else-if / else chains are one writer; an arm that excludes the add is `exclusive` | `objectWindowPositions` | the add's own arm, between add and removal, above the add |
| an input cap | `input(…)` served at its default or the member's `inputValues`; a DECLARED knob refused (set after the window is laid out) | `objectWindowPositions` | a cap name read anywhere but a length check |
| a lost move | `lostGeometryOp`: a per-bar MARK on the coordinates a lost setter would write; a clean write clears it; an object still marked is held; a pruned mark is not a drop | `objectLostGeometry` (incl. through a diverged list) | style setters stay out (a Pine default is still Pine's) |
| a per-call-site window | a `var` array in an inlined drawing function, one per call site (`inlineWindows`), modelled over the rewritten body | `objectWindowSites` | a conditional call (`pine:collection`) |
| several add sites | `multiSiteWindow`: an event is any site's condition, its element the LAST site's value that ran; a bar two sites may BOTH add on withholds every read while among the last `cap` events | `objectWindowSites`, `vendorHarness.c22Vdubus` | mixed order (front and back), a removal in one arm only, a read before its own arm's add |
| a size check | `array.size(w) >= K` (and `>`, `<`, `<=`) is ONE slot's existence (`windowSizeComparison`) — the sum put vdubus's fast guards at 135–146 nodes; the budget is untouched | `objectWindowSites` | — |
| a local an `if` chain sets | `foldLocalChain`: arms of only `name := expr` over plain locals fold to a na-safe ternary | `objectWindowSites` | a `var` / `varip` local (its value before the chain is the last bar's), a chain that reads what it assigns |
| text compared with text | `textEqTree`: a per-bar choice between literals `==` / `!=` a WRITTEN literal is 1 / 0 per bar, memoised per scope and operand node | `objectWindowSites` (incl. a `switch` over the choice) | an enum read (a `position` / `size` word stays the enum reader's) |

**What is still refused, and what would settle it:**

| script | what | would settle it |
|---|---|---|
| trend-duration | the first flip label (TradingView id 2, bar 58): `trend` is `na` until the HMA exists | nothing honest — the first flip compares against `na`; withheld by construction |
| trend-duration | `LabelProbLen` (id 82): x is `int(math.avg(get_x1(), get_x2()))`, text reads the window between its add and removal | a getter in arithmetic (C14) and a read one element over its cap |
| trend-duration | its one line (`LengthLine.set_x2(get_x1() + avg + 1)`) — held, not drawn short | the same getter in arithmetic |
| trend-duration | 30 of 34 cells (`cell:text`): the index column and `bullishCount.get(i)` per pass | a window read by the loop counter (per-iteration value text) |
| vdubus | the standard pattern's label (`"Bearish " + rawName`) ×4 — TradingView draws none on this capture | text joined from a per-bar choice (a text tree over `textEqTree`'s arms) and a capture that draws one |
| vdubus | the fast outline lines under `showFastLines` (off by default): 129 nodes > 128 | not a budget raise; the per-site trees shared as columns |
| dual-view (C25's question) | the floating candles: 212-slot windows shortened by `while array.size(htf_open) > candles_to_keep` (one `while`, ten arrays), read by the loop counter | **C22 does not reach it.** Three things: `while` as an evict (≡ `if` when one push per bar precedes it — provable, not built), a knob-computed cap (`math.max` over three DECLARED knobs: refused, set after layout), and reads by the counter over 212 slots (a runtime series, not trees under the 128 cap) |

⛔ **Two merges, re-measured.** After `ad696e660`: C21's rail caught `foldLocalChain` folding a `var`
(`564a19d79`); C24's `budgetSteps` rail moved on htf-liquidity with `7fc4c8cc5` — re-pinned from the C22
tree WITHOUT C24 (`783ed6a50`), which reads the same 5704 as the merge, so C24's replay still charges what
the repeat would have. After `7bb036d1c`: C25's `lose` / `prune` paths honour C22's mark rule
(`ba4de2ff7`); trend-duration's two `if i == 0` headers are served by C25's counter condition (`7320d7434`).
## C26 — `request.security` of another symbol (2026-09-30, step 37)

**What serves, stated once** (`app/src/components/chart/engine/otherSymbols.js`, the
header): a `sym` read is SERVED at bind time when the script spelled an EXCHANGE
(`"AMEX:SPY"`, `ticker.new("AMEX", "SPY")`, or `ticker.new(syminfo.prefix, …)` — the
chart's own, settled at bind), our store's listing of that ticker has an exchange whose
Pine spelling is WITNESSED (`symbolScope.json::confirmed`, read through
`bind.js::SYMBOL_EXCHANGE_CONFIRMED`), that spelling IS the one the script wrote, and the
listing's bars for the chart's timeframe are in hand. Everything else is refused by name
and the ticker is never supplied: its plot column is not computable and its object trees
are unknown (C17 withholds).

**Where the other symbol's bars come from.** In the product, the chart fetches each
fetchable ticker through the SAME secondary-bars cache a `sym:` source uses
(`sourceRef.symbolsNeeded` → `useSecondarySources` → `GET /api/bars/{ticker}?tf=<chart
tf>`), and our store's exchange for it from `GET /api/ticker-meta/{ticker}`
(`useOtherSymbolExchanges`, the same field the chart's own symbol reads); both reach
`computeFor` and the object reader through `binder.sync`. No new endpoint, no `api/`
change. In the harness, only from a committed capture (`tests/fixtures/vendor/harness/`,
receipt-verified; the store exchange linked by a confirmed row's WITNESS, since a capture
carries TradingView's spelling), and a ticker with no capture is supplied nothing and the
note names the missing capture.

**The spelling travels beside the tree.** `pine.js::otherSymbolOf` answers the ticker AND
the venue the script wrote; `securityAsNode` records it where it emits the `sym` node;
`translatePine` returns `otherSymbols` (absent when nothing is read, so every other result
is unchanged); the member door stamps `meta.otherSymbols`. One ticker spelled two ways
refuses whole — the tree cannot tell its nodes apart.

**Alignment** (`interpret.js::symAlignmentMask`, asked only when the caller supplies
`symbols`): the plot lane's rule — the bar's own `t`, exact match, never forward-filled —
is kept. What it cannot tell apart is a bar before the other symbol's history (TradingView
answers `na` too, so our `NaN` is its answer) from a bar MISSING after it began (a halt, a
one-sided holiday, a series ending early), where TradingView's default `gaps_off` carries
the previous bar and a `NaN` would read as Pine's `na` downstream. Those bars, and every
root bar within the tree's reach of one (`maxLookback`, the C12s argument), are withheld; an
unsupplied ticker is unknown on every bar. And `historyFromListing` is the chart's fact
only: a `sym` child runs on the supplied series with the bounded warm-up.

**Refused by name (codes in `OTHER_SYMBOL_REFUSAL`), and what would settle each:**

| code | example | what settles it |
|---|---|---|
| `other-symbol:bare` | `"SPY"`, `"XAUUSD"`, `"ADVN"`, `"EURUSD"`, `"CNXIT"` — every other-symbol read in the corpus that reaches the door is this (4 scripts, 19 tickers, none a US listing) | a capture of `plot(request.security("SPY", timeframe.period, close))` beside `request.security("AMEX:SPY", …)` on one chart — equal on every bar would confirm that a bare ticker resolves to our listing, per exchange witnessed. Until then the refusal names the spelling that WOULD serve (`"AMEX:SPY"`) |
| `other-symbol:venue-unconfirmed` | `NYSEARCA:`, `ARCA:`, `BATS:`, `IEX:` | a witness row for that spelling in `symbolScope.json::confirmed` (`probes/exchange-spelling.pine`) |
| `other-symbol:venue-mismatch` | `"NASDAQ:SPY"` (ours is `AMEX:SPY`) | nothing — it is a different instrument, or none |
| `other-symbol:exchange-unconfirmed` / `not-held` | a listing on an unwitnessed exchange; a ticker the store does not hold | the store holding it on a witnessed exchange |
| `other-symbol:chart-prefix-unconfirmed` | `ticker.new(syminfo.prefix, …)` on a chart whose exchange has no witness | the chart symbol's exchange witnessed |
| `other-symbol:class-share` | `"NYSE:BRK.B"` | a capture pinning TradingView's `BRK.B` to the store's `BRK-B` series |
| `other-symbol:no-bars` / `unspelled` / `framed` | bars not loaded; a document saved before C26; a calculation-timeframe instance | the bars landing; re-opening the script; — (a frame reads its own timeframe) |

**What would turn the served case into a vendor reading.** No graded capture reads a symbol
we hold, so the served rail (`vendorHarness.c26OtherSymbol`) is TradingView's own SPY bars
aligned the way `gaps_off` aligns them on a shared calendar, not yet a reading of the
composite. A capture of `plot(request.security("AMEX:SPY", timeframe.period, close))` (and
a label printing it) on NYSE:RDDT 1D would make it one; the committed SPY 1D capture already
supplies the bars.

**Rails and proofs:** `otherSymbols.test.js` (14), `ast/symAlignment.test.js` (7),
`vendorHarness.c26OtherSymbol.test.js` (7). Twelve mutations, each red alone and restored
by bytes with the sha verified: the translator's record and its string venue, the bare /
mismatch / unconfirmed refusals, the missing-bar mask, the listing strip, the object-lane
mask, the plot lane's supply, the binder's supply, the chart's fetch list, and the member
door's stamp.

## C27 — a timeframe below the chart's own (2026-09-30, step 38)

Branch `pine/c27-lower-tf`, base `476383d32` (wave 7, includes C26). **Every rule is stated once, in
the header of `app/src/components/chart/engine/lowerTf.js`**; this section records what was measured.

**What Pine means.** (a) `request.security(sym, lowerTf, expr)` on a higher-timeframe chart: `expr` is
evaluated on the lower-timeframe bars (their own history) and each chart bar reads its LAST intrabar's value
(lookahead off). (b) `request.security_lower_tf(sym, tf, expr)`: the array of `expr` over every intrabar inside
the chart bar, in order.

**Witnessed on committed vendor bars (replayed in `vendorHarness.c27LowerTf.test.js`):**

| fact | measured | captures |
|---|---|---|
| TradingView's regular-session 60m bars open 09:30, 10:30 … 15:30 (the last 30 minutes) and ARE its regular-session 5m bars bucketed from 09:30 | 12 / 12 complete buckets equal, OHLCV; the 10:30 bucket the 5m capture only half covers is not built | `vw-clock-vwap-spy-5-ext-2026-09-28`, `vw-time-session-spy-60-rth-2026-09-28` |
| the daily bar is NOT the aggregate of the intraday bars | SPY 2015–2026, 2,951 sessions: close equal on 190, open 2,023, high 2,792, low 2,786 | `vw-bool-cast-spy-1d/-60-2026-09-28` |
| a 1D chart's symbol is the regular session | `symbol.session` `0930-1600` (the 60m extended capture: `0400-2000`) | every SPY 1D capture |

So a lower-timeframe read cannot be derived from the bars a daily chart holds, and it differs from the chart's
own `close` on ~94 % of days. ⛔ **Our store's `tf=60` is clock-aligned** (09:30–10:00, 10:00–11:00 …,
`bars_fetch.py::bucket_60_et_unix_seconds`), so a `"60"` read is built from the store's `tf=15`
(`LOWER_TF_SOURCE`); 1/5/15/30 are aligned on the 09:30 grid in both.

**NOT witnessed, and why nothing is served.** No committed capture holds a lower-timeframe request on a
higher-timeframe chart, so (i) which intrabar it answers and (ii) which session's intrabars a 1D chart's
request reads are documentation. `LOWER_TF_WITNESS` holds null for both; `lowerTfRefusal` refuses by name:

| code | example | what settles it |
|---|---|---|
| `lower-tf:unwitnessed` | `request.security(syminfo.tickerid, "60", close)` on 1D (ema-ribbon rows 6–8, artemis 15/60/240) | Q-L1 `vw-lower-tf.pine` on SPY 1D/1W (`docs/pine/capture-queue-2026-09-30-lower-tf.md`) |
| `lower-tf:lookahead` | liquidity-heatmap's `"5"` pivots (`lookahead_on`) | Q-L1 rows L07/L08 |
| `lower-tf:other-symbol` | a lower read of another symbol | another symbol's intraday bars — not planned |
| `lower-tf:not-served` | `240`, `3`, `480` | the store serving it, or a ruling to build 240 from 15/30 (Q-L1 L15/L16 pin TradingView's 240 bucketing) |
| `lower-tf:intraday-chart` | `"15"` on a 60m chart | a time-range mapping of intrabars onto intraday chart bars |
| `lower-tf:intrabar-array` | `request.security_lower_tf` read directly | an array column; ⚠️ the 13 corpus scripts that use it stop earlier, at the array read (`pine:collection`), unchanged |

The sentence is appended to the one the door already published (the direct call's `securityDeclineReason`,
and a tuple element's `pine:request`), so the `timeframe.period` offer and its "NOT THE SAME REQUEST" warning
are unchanged; one reader, `Resolver.lowerTfDeclineOf`, and one lookahead reader,
`Resolver.requestLookaheadOf` (split out of `requestTargetOf`, never copied). position-size-calc's `'3'` is not a
code the spelling table recognises, so it keeps its existing refusal.

**Coverage.** A chart bar is known only whole: every TradingView session of its period complete in the supply
(every bucket from 09:30 to the session close — 13:00 on a half-day TradingView applies, per
`tradingViewCloseMinute` — each built from every source slot), and no intrabar missing within the expression's
reach (`maxLookback`, in intrabars) of the one it reads. Unknown is `NaN` plus an `unknown` flag, never `na`.
Measured on the replay: pre-2019 half-days (TradingView's session stays 16:00, trading stopped at 13:00, e.g.
2017-11-24 with 5 of 7 buckets) read unknown; applied half-days read complete; one missing 60m bar poisons its
own session and nothing past `sma(close, 5)`'s reach.

**Where the bars would come from in the product** (not wired — nothing is served): the chart's OWN ticker at
`LOWER_TF_SOURCE[code]` through the same secondary-bars cache a `sym:` source uses (`secondaryBars.js::ensureAll`,
`GET /api/bars/{ticker}?tf=15`), depth from `lowerTfFetchPlan` (extended hours counted, capped at the route's
60,000). The store's intraday bars include extended hours; `intrabarSeries` keeps the regular session.

**What serving needs, in order:** Q-L1 captured and agreeing with the replay → flip the two witness rows → a tree
node for the read (a NEW canonical node: `parse.js::NODE_TYPES` and the Python mirror move together,
`tests/test_node_vocabulary_parity.py`) → the supply hook → Q-L2 (RDDT 15/60/240 bars) to grade ema-ribbon's rows.

**Rails and proofs:** `lowerTf.test.js` (21), `vendorHarness.c27LowerTf.test.js` (11), `pine.security.test.js`
ruling-3.5 case updated to assert the clause (present for `'5'` on 1D, absent for `D` on 60). Thirteen
mutations, each red alone, restored by bytes with the sha verified: the witness gate, the regular-session filter,
the 09:30 anchor, the final-bucket slot count (the replay found a real bug there: `60` built from `60` read every
session incomplete), bucket completeness, damage within reach, the last-intrabar pick, the unknown flag, the
decline clause, the tuple clause, the array naming, the lookahead read, the recorded request code.

**Cost.** Naming a refusal resolves nothing: `lowerTfDeclineOf` reads only what `requestTargetOf` already
recorded (`requestCodes`) — a first draft that re-read the timeframe argument moved `pineProbeReplay`'s pinned
budget steps (artemis +720) and was corrected before commit; the pins are unchanged. Notebook first-open
1,891,971 B at base and tip (+0, PASS); total JS +3,386 B (the lazy `pine-*.js` chunk). Census build alternated:
base 46.7 / 42.7 / 74.2 s, tip 86.6 / 74.2 s (the last three on a box at 100 % CPU; an earlier tip draft read
41.9 / 44.4 s).
## C28 — the sweep on the wave-7 tip, and what it fixed first (2026-09-30, step 39)

Re-graded at `476383d32` (harness over the 47, objects pane on): **objects MATCH 28 / 47,
overall 24, families 222 / 266, plots MATCH 160 / 172**; committed harness dir (82):
objects 46, overall 38. Every entry that is not MATCH, with the FIRST named wall behind
each family (the drop census reads `lastCanonRefusal` at every `dropped()` — a throwaway
instrument, byte-restored). ⛔ Excluded from the ranking: walls a vendor capture settles
(`OWNER-CAPTURE-PACKET.md`, `pine/captures-2026-09-30`) and lower-timeframe requests (C27).

| script | differs (vendor / ours) | first wall (code @ line) | settles |
|---|---|---|---|
| artemis-oscillator-pro | cells 21/18, 4 texts only ours | **the `knnVal` cells read the declaration** (§ below) — fixed (a); then `pine:reassign bar_str`@617, `pine:collection knnF1`@471 (`kSize`), `pine:undefined fTxt`@621 (a block local after an unfoldable `for`) | runtime lane: `runtime:history-dynamic-offset` (`simple int len` param, `ta.highest(src, len)`@245) |
| average-day-range-adr-pivots | lines 2/0, boxes 2/0, cells 4/3 | `fn:in-expression` `array.push(arr, draw_box(…))`@234 → `coll:diverged` | C13 inliner: a helper's create as a push VALUE |
| candlestick-patterns-identified | 3 plots INCONCLUSIVE | the pane's row ceiling (`CARRY_MAX`) | ruling (ceiling not raised) |
| donchian-channels | Basis colour, 533 bars | `pine:request` `''` timeframe in a `request.security` colour | **fixed (b)** |
| dual-view | no program | `INSTRUCTIONS_PER_BAR` 247,425 > 200,000; host `pine:state htf_o`@459 | budget ruling |
| ema-ribbon | cells 48/34 | 24 × `pine:request` 15/60/240 (C27); `timeframe.period` spelling @309/@333 (capture); `pine:block for` in `f_strengthBar`@299; `str.tostring` default format @317/323/329 (C27 rows) | C27 + capture; runtime lane stops on `runtime.error`@53 then `runtime:request-with-state`@155 |
| high-low-open-mid-ranges | lines 504/0, labels 504/0 (withheld), cells 45/37 | `pine:input-kind input.timeframe` in a label text @143 (vendor prints `W`); `pine:drawing line.get_y1` history @145/160; `pine:function time(<timeframe>)`@169; `'M'`/`'3M'` requests @198 | `time("W"/"M")`: witnessed (below); `input.timeframe` text: spelling (capture) |
| htf-candle-footprint | lines 6/0, labels 6/0, boxes 13/0 | `pine:undefined indxBar`@120 (a `for … in` local), `loop:bounds size`@138 | host `for … in`; runtime `runtime:loop`@74 |
| htf-liquidity-dashboard | cells 30/3 | `other-symbol:bare` FX @149/155 | capture |
| inside-bar-range | door refusal | `pine:state`@44 (running total) | bar counters (capture) |
| k-clustering | lines 9/0, cells 8/5 | `INSTRUCTIONS_PER_BAR` 800,777 | budget ruling |
| liquidity-heatmap | labels 27/0 | `pine:function-def` via a lower-TF request | C27 |
| madrid-ma-ribbon | 6 plots INCONCLUSIVE | row ceiling | ruling |
| mcclellan | Osc | `other-symbol:bare` ADVN/DECN | capture |
| max-pain | labels 8/6, boxes 13/1 | `color.from_gradient` (withheld at run time) | gradient capture |
| poor-man's-volume-profile | labels 40/0 | `pine:reassign row0_price`@276 (the `for` over `block_size`); texts built by `for`@744 | runtime lane (objects-only; its 40 texts are `content:withheld`) |
| position-size-calc | cells 10/0 | `pine:block`@57 → `syminfo.root` | R-R capture |
| sector-rotation | lines 50/0, boxes 504/0 | `chart.left_visible_bar_time` | correct end state |
| smt-divergence | lines/labels 500/0 | `other-symbol:bare XAUUSD` | capture |
| trend-duration | labels 28/26, cells 34/4, line 1/0 | `pine:collection bullishCount` (avg)@69/91; `pine:type LengthLine.get_x1`@118 | C11 numeric-array reductions over a pushed list |
| trend-lines-S&R | no program | `fn:loop` @299–337, `fn:conditional-history f_clearAll`@294 | C13 |
| vold | cells 2/0 | `pine:text-value` (`USI:*` other symbol) | capture |
| volume-profile | lines 203/200 (3 held) | `pine:builtin last_bar_time`@211; `pine:state va_up`@215 | `last_bar_time` + a helper `var` in a loop |
| rvol (harness dir) | Plot colour, 611 bars gold | `color.from_gradient` → `colorDynamic` → the pane's gold | gradient capture — ⚠️ a WRONG colour, not a refusal (see below) |

**Ranked by what moves, buildable from captures in hand:** (1) the stale snapshot — a wrong
value on the member door, found in artemis and present in 5 corpus scripts (step 38a); (2)
the `''` timeframe + request colours — donchian to MATCH (step 38b); (3) `time("W")` /
`time("M")` on a daily chart — **witnessed** by `vw-time-tf-spy-1d-2026-09-28` (900 bars,
18 holiday-Monday weeks: `time(tf) - time` is the week's / month's / quarter's / year's first
bar, 0 mismatches outside the first partial period, where the vendor knows an open we do not
load), 7 corpus scripts refuse on it, but **no graded family moves** (OHLM's dividers sit
behind its other walls; the probe itself refuses on `3M`/`12M`/`in_seconds`) and it needs a
clock column in both lanes — queued, not built; (4) every other wall is one script each.

**(a) — the stale snapshot.** `float knnVal = 50.0`, then `knnVal := kBull / knnK * 100.0`
inside an `if` whose fold stops at a `for`, then `knnIsBull = knnVal >= 60.0`. The closing
pass condemns `knnVal` in the final env; `knnIsBull`'s binding carries `new Map(env)` from
where it was written, which still held the declaration — so the plot lane read `50 >= 60`
and the objects pane drew four cells TradingView does not. `Resolver.staleSnapshotRead`: a
historic top-level binding of a condemned name (the closing pass stamps `stale: {cut,
bindings}` — `envLog`'s `prev`s plus the pre-condemnation binding, and the first position the
value stopped being known) is read only by a binding written ABOVE `cut`; below it, at an
output's top level, or inside a call frame it refuses with the condemnation's own sentence.
Parameters and locals sharing the name are not in the set (mutation-proved, three ways).

**(b) — `""` and request colours.** Pine's reference for `request.security`: "To use the
chart's main timeframe, use an empty string or the `timeframe.period` variable."
`requestTargetOf` reads `''` as the identity (one reader, both lanes); `securityColourRule`
moves a colour rule's deciding tree inside the same request, so `securityAsNode` answers a
colour exactly as it answers a plot of that request, and a request it refuses still fails
soft to `colorDynamic`.

⚠️ **A wrong-colour class, recorded for a ruling rather than changed here:** a plot whose
colour this door cannot carry (`colorDynamic`) draws in the pane's default gold. On a graded
capture that is a colour TradingView does not draw (rvol: 611 bars, `color.from_gradient`).
The standing rule says a guess drawn is worse than a named refusal; whether an uncarried
colour should withhold the plot, draw it neutral, or keep the gold is a member-visible
product decision across many scripts, so it is left to the integrator.
## C29 — the rules the 2026-09-30 captures settled (2026-09-30, step 46)

Seven rules, each measured by a probe in `tests/fixtures/vendor/harness/*-2026-09-30.json`
(results: `docs/pine/OWNER-CAPTURE-PACKET.md`), each served through one authority, each
proved by a rail that READS the fixture (`vendorHarness.c29*.test.js`,
`symbolScopeListing.test.js`, `tests/test_ast_bind_listing.py`, `tests/test_ast_bind_ne_na.py`,
`runtime/__tests__/dynamicHistoryOffset.test.js`).

| rule | authority | what stays refused, by name |
|---|---|---|
| 1 `syminfo` listing fields | `symbolScope.json::listing_fields` → `bind.js::SYMBOL_LISTING_FIELDS` / `ast_bind.py` | `syminfo.type` (stock vs fund is per instrument and the store holds no such fact — SPY is not `stock`); any field on a listing with no row; `pointvalue` on a screen |
| 2 bar counters (C12w) | `interpret.js::readingSeed` + `listingPass`; admission in `pine.js::isBarCounterUpdate` | every counter behind the listing (curtain default, R-W); on a screen; `ta.cum` stays the host's `cum` — moving it behind the curtain would blank `atr-trailing-stoploss` off the listing |
| 3 bare tickers | `otherSymbols.js` (`storeTickerOf`, `BARE_AMBIGUOUS`) | a bare name on the ambiguous set (`VIX`, `ADVN`, `DXY`, `GOLD`, …), punctuation other than a class-share dot, a ticker the store does not list |
| 4 gradient / transparency | `runtime/colours.js::fromGradient`, `colorInt.js::wholeTransparency` | an empty or non-finite range (`bottom == top`): unmeasured, withheld; a colour as a plotted VALUE (`color.r` in a column) stays `pine:colour-value`, so `vw-gradient` is graded by its own rail, not the door |
| 5 `timeframe.period` | `pine.js::periodTextOf`; `periodReads.js` at bind | a plot or drawing whose folded period value differs on the bound chart (`bind:period-reads`); the dark runtime pane's definitions carry no period stamp |
| 6 `na` comparisons | `interpret.js::cmp`, `bind.js::BINARY`, `ast_bind.py::_BINARY` | — |
| 7 `x[na]`, auto buffer | `objectRuntime.js` (`'at'`, `AUTO_MAX_BARS_BACK` 400), `runtime/vm.js` `READ_*_DYN` | an offset ≥ 400 with no `max_bars_back` (`atBeyondAutoBuffer`); a series-valued offset in a PLOT (`pine:offset-literal`, the closed grammar) — so `vw-offset-na` and `vw-mbb-auto` are graded by `vendorHarness.c29NaReads`, not the door; the VM has no ring, hence no 399 bound of its own |

**Rule 8** — `btc-charlie-trader-xo-macro-trend-scanner` and
`keltner-center-of-gravity-channel` against their 2026-09-30 captures (NYSE:RDDT 1D, from
the listing, 634 bars): both **MATCH** at base and at tip. btc-charlie: 5 of 5 plots,
634 / 634 bars each, per-bar colour on all 623 / 610 / 8 / 9 coloured bars; no object
either side. keltner: 18 of 18 plots, 634 / 634 bars each (colour on 614 bars × 6
channel lines), 2 tables and 3 cells agree. Nothing diverges, nothing is withheld.

## What is left, ranked by scripts it would move

| rank | class | scripts (primary) | what it needs |
|---|---|---|---|
| 1 | C11 arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus (9) | the collection/UDT grammar in the object lane — the largest single gap, and a design wave rather than a fix. **Step 14** closed runtime-front-end gaps (methods, array members, global reads) with no grade moved; the runtime object lane still builds none of the nine and is unrouted — see § C11. **Step 19 (C16)** served the host-lane wall two of the nine hit FIRST on their drawing LISTS (length reads, eviction, list edits in loops — institutional-smc, dual-view): smc's zones now AGREE; dual-view and the other seven stop on UDTs, numeric arrays or `var` state — see § C16. **Step 24 (C11b)** served it on the HOST lane rather than routing (the runtime object lane builds one of the nine and answers at the wrong position): ict-killzones MATCH, htf-liquidity's lines and labels id for id; the other seven stop on `var` state, UDT fields, `while`, per-call arrays, user read-methods or reductions — see § C11b. **Step 27 (C11c)** served pro-trading-art (**MATCH, id for id** on its from-listing capture; behind the curtain 6 / 7 lines, 12 / 14 labels, every one TradingView's) and named the rest: k-clustering and max-pain need an imperative last-bar evaluator, vdubus per-call windows with two add sites, trend-duration positional window reads and the C12 counter — see § C11c. **Step 33 (C22)** served both: vdubus **MATCH** (112 lines, 48 linefills, 5 labels), trend-duration 26 / 28 labels and 4 / 34 cells; dual-view's `while`-shortened, knob-capped windows are not reached — see § C22 |
| ~~2~~ | ~~C12 values or `var` state computed across a multi-statement block~~ — **steps 15–17**; the curtain on a from-listing series: **step 25 (C12w)** | atr-sr **MATCH**; smc 13/18 lines, market-structure 5/6 lines and 18/22 labels with **no wrong object left** | what remains of C12 is the WARM-UP CURTAIN: `accum` is not computable before `PINE_STATE_WARMUP` (250) and an object that reads it there is now withheld (step 17) rather than drawn off a guess. Settling it needs the owner-gated question in `pine.js::PINE_STATE_WARMUP` (a `var` seeded from where a fetch starts), not a fix. `position-size-calc` re-traced to `syminfo.root` (rostered unserved) + C10; `rsi-swing` to C14 (a getter written into `var` state, and getters as coordinates) — neither is C12. **Step 26 (C17):** behind the curtain, what a withheld op would have written is now MARKED per bar and per property, and its readers withheld — rsi-swing draws TradingView's last 6 labels / 7 lines and nothing else; and the curtain now sees an equality against the state (`laststate == 1`), which it read as known-false — see § C17. **Step 28 (C12s):** a counter with a RESET arm is served as a switched recurrence, exact per bar where the data shows the reset (artemis' `✦ OB` ×3 id for id, ema-ribbon's bars-in-trend cell, two scripts attach) — see § C12s |
| 3 | C10 `request.security` in object text/coordinates — **step 20: every form the seam computes is served** (linear-regression MATCH; artemis' MTF panel) | artemis, ema-ribbon, linear-regression, vold, liquidity-heatmap (5) | the seam was already there (§ C10). What is left is refused BY NAME and each needs something the bar series does not hold: an intraday timeframe below the chart's own (artemis 15m/1h/4h values never shown; ema-ribbon 15/60/240 rows; liquidity-heatmap's pivots) — **step 38 (C27)** built the lower-timeframe mechanism and replayed it on TradingView's SPY bars; every such read is refused by name (`lower-tf:unwitnessed`) until capture Q-L1 witnesses which intrabar and which session, and ema-ribbon's rows then need RDDT 15/60/240 bars (Q-L2) — see § C27, another symbol (vold `USI:*`, htf-liquidity, position-size-calc — **step 37 (C26)** serves another symbol where the script spells a witnessed exchange of a listing we hold; every other-symbol read in the graded captures is a BARE non-US instrument and is now refused by name, `other-symbol:bare` — see § C26), a multi-period code (`3M`, `3D`, `2M`), and a `timeframe.*` read inside a request at another timeframe (liquidity-heatmap's `resolutionInMinutes`) — the capture that settles each is in § C10 |
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

**R-G (2026-09-30): an uncarried plot COLOUR keeps its line; the colour is fixed by carrying it, never by withholding the plot.**
- C28 measured the case: a plot whose colour this door cannot carry draws in the pane's gold (rvol: gold on 611 bars
  where TradingView draws other colours). The VALUES on those plots are the vendor's; only the colour is wrong.
- Withholding the plot would take correct lines off every member chart that runs such a script today, to hide a
  colour defect. A colour defect is fixed where it lives: carry the colour (rvol / max-pain use `color.from_gradient`,
  which the 2026-09-30 captures settled - the C29 lane), and grade colour as its own column so the defect stays counted.
- This does NOT relax the object rule: an object whose TEXT or POSITION is unknown is still withheld (C26, C28a),
  because there the wrong thing is the content itself.

## C32 — per-pass window reads, and a window's length above its writer and past the cap (2026-09-30, step 42)

Branch `pine/c32-collections`, base `e0eb227ee` (wave 8). Scope: the two array walls § C28 names —
trend-duration (`pine:collection bullishCount`, `pine:type LengthLine.get_x1`) and artemis
(`pine:collection knnF1`@471, `kSize`). First walls re-measured on the base with the throwaway drop
census (`lastCanonRefusal` at every `dropped()`, byte-restored, sha verified):

| script | base (objects pane on, from the listing) | tip |
|---|---|---|
| trend-duration | cells 4 / 34: `cell:text` ×3 per pass at lines 153 / 159 / 166 — a text that reads the loop counter is not a tree (`loopValuesUnresolved`). Labels 26 / 28, line 0 / 1: `LengthLine.get_x1() + bearishCount.avg() + 1`@118/127 and `int(math.avg(get_x1(), get_x2()))`@119/128 (a getter in arithmetic), `LabelProbLen.set_text`@120/129 (a window read between its add and its removal). ⚠️ `pine:collection bullishCount`@69/91 in § C28's table is the door's FIRST pass (inputs declared as knobs, so the cap `samples` is refused); the served pass has read both labels since C22 | cells **34 / 34**; labels 26 / 28 and line 0 / 1 unchanged, named below |
| artemis | cells 14 / 21: `pine:collection knnF1`@620 — the window was refused whole, because its cap's declaration `int knnLen = input.int(…)` was counted as a stray read of the cap (the reader matched only `knnLen = …`); behind that, a 100-slot window is over `MAX_WINDOW_CAP`, and `kSize` is read at line 455, above the add at 471 | cells **15 / 21** (`100 bars`); the other six are `pine:reassign knnVal`@459 ×4 (the k-NN vote: two `for` loops over a per-bar `var` array with `array.min` / `indexof` / `set`), `pine:reassign bar_str`@617 (a string built by a `for`), `pine:undefined fTxt`@621 (a block local after an unfoldable `for`) |

**What was built** (`3d8813fbe`), each railed against a Pine replay and against the capture:

| construct | rule (where it lives) | proof | refused, by name |
|---|---|---|---|
| a text that moves per pass | `pine.js::loopTextOf` (host lane only): literals, `+`, and `str.tostring(x [, "fmt"])` where `x` is the counter's arithmetic (`loopArgRef`) or a window element picked by it, through a body local opened into its binding → `{t:'val', v, fmt?}`; a part that does not read the counter is the ordinary text reader's. The object runtime formats it with the same `str.tostring` rules as `{t:'num'}`; a value a pass cannot say withholds the text | `objectWindowLoopReads` (push and unshift windows, text and tooltip, against Pine's arrays by hand), `vendorHarness.c32Collections` | any other per-pass text (a ternary on the counter, `str.format`, a text array) keeps `loopValuesUnresolved`; colours per pass are untouched |
| `w.get(i)` by the loop counter | `pine.js::loopWindowGetOf` → `{v:'wget', order, args:[index, size, slot 0 … slot cap−1]}`: the window's newest-first slots as per-bar trees (Resolver member `slot`), its length a tree, each read where the call stands (`windowReadVerdict`). The runtime maps Pine's index per pass: slot `k` (unshift) or `size − 1 − k` (push — index 0 is the OLDEST element) | the same two rails; `graphNodesReferenced` sees every slot (the curtain and the document validator) | ⛔ an index outside `0 … size − 1` is Pine's `array.get` out-of-bounds error: `runtimeError`, the run stops and draws nothing (C9's rule), never an `na` cell. A window two sites may both add to on one bar is refused (its ambiguity is per step, not per pass). A read the model is not exact at (above the writer, between add and removal) keeps its refusal |
| a length read above the writer | `Resolver.resolveWindowRead`: `size` at a position above the first writing statement (`windowReadAbove`) is member `sizePrev` — the model's length one bar back, registered with its ambiguity (`na` on the first bar) so every step that reads it is withheld there (`op.withhold`) | `objectWindowLength` (label per bar against Pine's arrays; bar 0 withheld) | only the length: a slot or a reduction above the writer keeps "it is read above line N"; outside the object pass (no step to withhold) it refuses |
| a window wider than 64 | `arrayWindows.js`: the model is kept with `sizeOnly`; `size` is `cap` once `ta.valuewhen(cond, 1, cap − 1)` exists and unknown (withheld) before — one `valuewhen`, nothing unrolled. `MAX_WINDOW_CAP` is unchanged and still bounds every element read | `objectWindowLength` (cap 70: drawn only once full; a 64-slot window still unrolls) | `get` / `first` / `last` / reductions / `indexof` of such a window: "a window of N slots is read only for its length"; the size before it fills is withheld, never counted slot by slot |
| a typed cap declaration | `pine.js::windowCapOf`: the declaration is the statement whose first identifier before `=` (after type words) is the cap | `objectWindowLength`, `vendorHarness.c32Collections` (artemis) | a cap read anywhere but a length check stays refused (C22's rule) |

JS-only: the object program vocabulary (`objectProgram.js`) and the object runtime have no Python twin
(no `cellpatch` or window model under `api/`); the canonical TREE vocabulary (`parse.js::NODE_TYPES`) is
untouched — `wget` and `val` are object-program references, not tree nodes.

**Mutation proofs** (each red alone on the three rails — 16 tests, green at the tip — restored by bytes, sha256 verified):

| # | mutation | red |
|---|---|---|
| M1 | `wget` push / unshift index mapping flipped | 3 |
| M2 | an out-of-range `get` returns a slot instead of stopping | 1 |
| M3 | host-lane per-pass text off | 5 |
| M4 | `sizePrev` served without its ambiguity | 2 |
| M5 | `sizeOnly` length served without its ambiguity | 1 |
| M6 | a read above the writer not served | 3 |
| M7 | a typed cap declaration not recognised | 6 |
| M8 | `{t:'val'}` not bound to graph nodes | 5 |
| M9 | `{t:'val'}` not walked for referenced nodes | 6 |
| M10 | slot `j` reads slot `j + 1` | 3 |
| M11 | `sizeOnly` never set (a wide window treated like any other) | 4 |
| M12 | a wide multi-site window refused again | 2 |

**What stays refused, and what would settle it:**

| script | what | would settle it |
|---|---|---|
| trend-duration | its line (`LengthLine.set_x2(get_x1() + avg + 1)`) and `LabelProbLen`'s x (`int(math.avg(get_x1(), get_x2()))`) — **NOT BUILT, on the unwitnessed-semantic rule.** `bullishCount` is `array<int>`, and the script compiles only if `array.avg` of it is an `int` (`line.set_x2` takes one), so Pine rounds the mean somehow; no capture says how. The capture's two averages (22.6 → `23`, 18.5 → `19`, both through `"##"`) rule out truncation and cannot tell round-half-up from ceiling, nor either from a float formatted by `"##"`. x2 is 643.6 under one reading and 644 under the others, and the capture stores x as a dense RANK, so no reading is witnessed. Held, not drawn (C22's mark) | capture **Q-C32-1**: a probe on any 1D chart — `var a = array.new<int>()`, push 1, 2 (mean 1.5), then 1, 1, 2 (1.33), then 2, 2, 1 (1.67); a label printing `str.tostring(a.avg())` with NO format, and `str.tostring(l.get_x2())` after `l.set_x2(l.get_x1() + a.avg() + 1)`. With it: a getter in `+ −` arithmetic as a `{v:'op'}` over `{v:'get'}` (the runtime already evaluates both), and the read below |
| trend-duration | `LabelProbLen.set_text(… bearishCount.avg() …)`@120/129: read between the window's add (line 61's block) and its removal. The read's arm (`if not trend`) and the add's arm (`if trend`, inside `if trend != trend[1]`) are exclusive, but in two different statements, which `excludes` (one chain) cannot prove | a cross-statement exclusion on one un-reassigned condition; it moves nothing alone (the label is held on its x) |
| trend-duration | the first flip label (id 2) | nothing honest (C22: `trend` is `na` until the HMA exists) |
| trend-duration | the data cells' TEXT COLOUR (`chart.fg_color`) — uncarried, the renderer's default; text, address and tooltip are TradingView's | the viewer's theme reaching the object lane (not a capture) |
| artemis | `knnVal`'s four cells, `bar_str`, `fTxt` | an imperative per-bar evaluator for the k-NN vote (the runtime lane stops on `runtime:history-dynamic-offset`, § C28); a string built by a counted `for` over a per-bar count; a block local after an unfoldable `for` |

⚠️ **Noted for the integrator, not changed:** C22's served average cells (`23`, `19`) and flip-label texts
format a FLOAT mean with `"##"`. That equals an integer mean rounded half-up on both captured values; it
would differ under a ceiling (22.2 → `22` vs `23`). Q-C32-1 settles that too.
## C34 — a user function that reads history or sits in a loop (2026-09-30, step 44)

Branch `pine/c34-fn-loops`, base `e0eb227ee` (wave 8). C28 named trend-lines' walls as `fn:loop` @299–337 and
`fn:conditional-history f_clearAll`@294. Traced, neither was the drawing's real wall:

| refusal | what it actually was | now |
|---|---|---|
| `f_clearAll:conditional-history@294` "a history read `[…]` at line 258" | `for [i, v] in line.all` — the `[` after the keyword `for` read as an offset | inlined; its deletes meet the unrun `for … in line.all` (`loopBlocked`) |
| `fn:loop` ×6 @299/303/312/316/330/337 | helper calls inside `for [i, v] in <list of user-type points>` and two `while`s — loops the host reader does not run | inlined into those loops; every op they make is `loopBlocked`, named by what it is |

**The rule, as implemented** (`objectFnInline.js`, the C34 section; one reader, `historyIn`). Pine keeps one history per
CALL SITE for what the function owns — its locals, its parameters, the state inside a `ta.*` it calls — advanced only on
the bars the call runs; that is what `fn:conditional-history` refuses, unchanged. What it no longer mistakes for that:

| read | why it is not the call's history | proof |
|---|---|---|
| `open`/`high`/`low`/`close` `[e]` | the chart's series, kept by the chart on every bar. **Witnessed:** trend-lines calls `f_drawSupport`/`f_drawResistance` only on the last bar and reads `low`/`high`/`open`/`close` 40–257 bars back; TradingView's 4 boxes and 4 labels are the chart's values at the pivot bars (119.27/122.5 bar 506, 135.2223/140.67 bar 591, 263.4999/257.67 bar 452, 282.95/271.99 bar 374) — a per-call history would have been `na` | `vendorHarness.c34ChartSeries`: our lane, running the same helper shape under `barstate.islast` on the vendor's bars, reads all eight edges value for value |
| a keyword before `[` | `for [i, v] in …` is a destructure, `in [a, b]` a literal | rail + mutation |
| `x.m().delete()`, `.set_x2()`, `.get_y()` | a built-in method on the value this bar holds (the un-chained `l.get_x2()` was already admitted); a chained name the script defines as a METHOD is still judged as one | rail + control |
| `map.*`, `matrix.*` | a collection, as `array.*` | rail |
| a user method whose body reads only the current bar | the same purity fixpoint as a function; an overloaded method never qualifies | rail |

⛔ **Refused by name, with what would settle it:** `volume`, `time`, `time_close`, `bar_index`, `hl2`, `hlc3`, `ohlc4`,
`hlcc4` at an offset inside a conditional call (`CHART_SERIES_UNWITNESSED`) — Pine documents them as the chart's too,
but no committed capture reads one that way. **Capture `vw-fn-series-history` (queued):** on NYSE:RDDT 1D, a helper
`f(k) => label.new(bar_index, volume[k], str.tostring(volume[k]) + "|" + str.tostring(bar_index[k]) + "|" + str.tostring(hl2[k]))`
called only under `barstate.islast` with `k = 5, 40, 200`, plus a control helper that reads a LOCAL `x = close * 2`
as `x[1]` under the same guard (expected `na` — the per-call history rule itself, which no capture witnesses yet).
A name the script binds itself (`low = …`, a parameter or local called `low`) is the script's series and still refuses.
`ta.*`, a parameter or a body local at an offset — the call's own history — still refuse (`fn:conditional-history`).

**A call inside a loop the host reader does not run is inlined into it** (`pineObjects.js` `inlineCall`). Pine runs the
body where the call stands, so its statements are statements of that loop and every op they make meets the loop's own
refusal (`loopBlocked`) exactly as a top-level statement there does. ⛔ Nothing new is drawn by this half. What the
body would have removed, created or re-listed is ALSO recorded against the loop from its tokens (`loopBodyEffects`,
the refused call's own `bodyEffects`), so a removal the walk cannot name stays loud (`object.delete`, which the door
classifies as a removal); a handle RETURNED inside such a loop is not copied onto every bar (`object copy`); a body
that reads the call's own history in such a loop is still `fn:conditional-history` (the loop's passes vary). Still
refused as `fn:loop`: a call inside the C20 runtime-lane `while` try, whose carried body must be statement creates only.

**What trend-lines stops on now** (all 7 helper calls inlined, 0 `fn:*` drops): its drawing steps sit in
`for [i, v] in f_getAllPairCombinations(lowPivots.slice(0, tlPointsToCheck).reversed())`@297/310 and
`for [i, v] in uptrends/downtrends`@301/314 (lists of user types — C11 / the host `for … in` reader, lane C31's
mechanism) and in `while sCount < srPointsToCheck`@327/334 (the C20 runtime-lane `while` does not carry a body with
kept handles or list pushes). Behind those: `lowValue = low[e]` held in a body local and `math.min(open[e], close[e])`
are not addresses the object runtime reads a per-bar offset in (C9 serves `x[e]` as a WHOLE coordinate only), and
`line.new(start, end, …)` with `chart.point` arguments is `unsupported`. The runtime lane stops earlier, at
`alert.freq_once_per_bar`@79 and then `chart.point.from_index`@280. The member door's sentence for it moves from
"a function of its own that deletes" (withheld) to naming the loop ops (partial); its program is empty either way.

**Corpus (translation census, 266):**

| | base | tip |
|---|---|---|
| `fn:loop` refusals | 27 (5 scripts) | **0** |
| `fn:conditional-history` refusals | 579 (15 scripts) | 540 (11 scripts) |
| served plot outputs changed | — | 0 |

| script | moved | first wall now |
|---|---|---|
| trend-lines-supports-and-resistances | loop 6→0, cond-hist 1→0 | `loopBlocked` in `for … in` over user-type lists / `while` (above) |
| support-and-resistance-logistic-regression | loop 7→0 | `loopBlocked` `line.new`/`label.new`/deletes in `for curSR in allPivots` (UDT list); door `pine:reassign _supportRetestDetected`@236 unchanged |
| ict-killzones-pivots-tfo | loop 6→0, cond-hist 14→4 | `table.cell` in `for l in levels`; 4 × `dwm_hl` refused on `alert(…)`@556 in its body; still MATCH on the 47 |
| renderingnature-smc-reversal-engine | loop 4→0 | deletes / `array.remove` in `while array.size(…) > maxHTFZones` |
| market-structure-break-order-block | loop 4→0 | `box.delete`/`array.shift` in `for bull_ob in bu_ob_boxes`; door `pine:collection`@69 unchanged |
| fx-market-sessions | cond-hist 12→0 | 273 ops (was 225) behind `guard:*`; door `pine:module` unchanged |
| bull-vs-bear-market-intraday-sessions | cond-hist 10→0 | `array.flush`/`linefill.all.flush` unsupported, `guard:*` |
| candelacharts-equal-highslows | cond-hist 2→0 | `guard:create`, `guard:cell` |
| stop-loss-clustering | cond-hist 4→2 | `gradBox` on `time(…)`@248 |
| bigbeluga-smart-money-concepts | cond-hist 3→1 | `structure` on a history read@977 |

Unchanged and still refused on the call's own state (or an unwitnessed series): `candlestick-patterns-on-backtest` (287: past `matrix.col`, now on
`ta.highest`), `mgi-levels-suite` (227, `time(…)`), `ict-institutional-order-flow` (`time[1]` beside `high[1]`), `power-of-3`
(`On[1]`, a parameter), `auto-harmonic` / `smt-divergence` / `smart-money-concepts-by-welotrades` (`ta.lowest` /
`ta.highest`), `multi-timeframe-supply-demand-zones` (`time_close`).

**Measured** (base `e0eb227ee` vs tip, protocol items 1–6): 47 captures objects pane on — objects MATCH 28 → 28,
overall 25 → 25, families 222 / 266, plots 161 / 172, **0 entries changed**; flag off 18 / 15, 0 changed. Committed
harness dir (82) on: objects 46, overall 39; off: 36 / 29; 0 entries changed. Member-door census 266 × 2: attach
41 / 64 → 41 / 64, 0 rows; base-vs-base control 0 rows. Notebook first-open 1,897,262 B at base and tip (+0, `notebook_perf_budgets` PASS); `pine` chunk 330,629 → 332,542 B (+1,913), total JS +1,913 B. `paramIds.test.js` green, no edit.

**Rails and proofs:** `vendorHarness.c34ChartSeries` (7), `objectFnInline.test` (+13), `partialDrawing` (trend-lines
re-pinned as a partial row naming its loops; a fixture — a helper reading `ta.sma` and deleting an unnamed handle —
keeps the withheld-helper sentence). Eleven mutations, each red alone, restored by bytes with the sha verified: the
witnessed set emptied, the keyword skip, the chained-member admission, `map`/`matrix` purity, the pure-method check,
shadowing ignored, loop calls refused again, loop body effects dropped, a returned handle copied out of the loop, an
unrun loop not treated as varying, the unwitnessed-series naming.
## C35 — the runtime lane's next stops: a `simple` argument, `runtime.error`, a lower request (2026-09-30, step 45)

Branch `pine/c35-runtime`, base `e0eb227ee` (wave 8). Everything here is the RUNTIME lane
(`engine/ast/pineRuntimeFrontend.js`, `engine/runtime/`); the pane it would serve stays dark
(`VITE_PINE_RUNTIME_PANE_ENABLED` unset). `pine.js` is untouched.

**(a) A `simple` argument is fixed for its call site.** Pine: a parameter qualified `simple` (or
`const`) takes a value known before bar 0 that never changes at that call; an unqualified parameter
takes its argument's qualifier. So `drmEngine(series float src, simple int len, …) => ta.highest(src, len)`
called as `drmEngine(drmSrc, drmLen, drmMethod)` runs a `drmLen`-bar window at that call. The lane
compiles ONE body per function and runs it at every call site, so a frame slot had no length before
bar 0 (`runtime:history-dynamic-offset` — the first runtime wall of 19 of the 266 corpus scripts at base, artemis@245 among them; 12 after). The rule as
implemented (`simpleSpecialisation`):

- at a call to a definition held on `runtime:history-dynamic-offset` for one of its PARAMETERS, each
  argument of a parameter not declared `series` is folded in the CALLER's context exactly as a length
  is folded (a literal, an input at its default — the frozen resolver `foldConstNode` already uses);
- the body is compiled once per distinct set of folded values, with those parameters answered as
  constants wherever a length or an offset reads them (`frameConsts`, keyed by SLOT); state stays per
  call site, as for any function. Every other read of the parameter is still the value the call passes;
- a parameter handed on to another function is fixed at that call site in turn;
- ⛔ refused by name: an argument only known while the bar runs (``…`len` is declared `simple` in
  `drmEngine`, and this call passes a value that is only known while the bar is running (Pine does
  not compile that)``); a parameter declared `series` (a series length, which this lane does not
  size); a call inside a request's value (unchanged: `carriesColumn`).
- ⚠️ NOT folded, and still named: constant ARITHMETIC over a fixed parameter (`wper = n * 2 - 1`,
  range-filter / twin-range-filter) — the frozen resolver folds a literal and an input, not `2 * 2`;
  that is the lane's existing length rule, unchanged.

**(b) ⛔ A wrong value, found and fixed on the way.** `foldConstNode` asks the frozen resolver, which
reads the TOP-LEVEL environment. Inside a function body a parameter (or local) that shares its name
with a top-level binding was answered by that binding: `len = 3` beside `f(src, len) => ta.sma(src, len)`
called as `f(close, 5)` ran a **3-bar** window (measured: the column equals `ta.sma(close, 3)`). A name
the frame holds is now answered by the frame — its call-site constant, or the by-name refusal — and
never by `env`. Runtime lane only (the dark pane, and C18/C20's object values); no corpus script the
lane builds carried the collision (the six harness/47 verdict files are byte-identical).

**(c) `runtime.error(msg)`.** A statement, lowered through the lane's one effect-statement path. Where it
is reached the run STOPS by name (`PineRuntimeError`, name `runtime.error` → `runtime:runtime.error` in
`runtimeObjectValues`; the pane's `execute` throws) carrying the script's message — TradingView stops
the script and shows the error instead of the indicator. Where it is not reached it is nothing.
ema-ribbon's validation (`if barstate.isfirst and not (fastLen < midLen and midLen < slowLen)`) is not
reached at the captured inputs, and the capture shows the script drawn — the unreached half is
witnessed (`vendorHarness.c35RuntimeError`). The REACHED half is documentation: no capture shows what
the study holds after the error, so nothing is drawn from such a run.

**(d) A request below the chart's timeframe.** ema-ribbon's next stop read
`runtime:request-with-state`@156 — "a data request whose argument is a mutable value". The request is
`"15"` on a daily chart, which C27 refuses in the plot lane by name; the state check is moot for a read
no lane serves. The lane now asks the host's own reader (`Resolver.lowerTfDeclineOf` →
`lowerTf.js::lowerTfRefusal`) BEFORE the state check and refuses with the same code and sentence
(`lower-tf:unwitnessed`, Q-L1). A request at a HIGHER timeframe still meets the state check (control in
`simpleArgWindow.test.js`).

**Measured** — see the fix-order row. Runtime first walls that moved (18 of 266): 9 off
`history-dynamic-offset` onto their next wall (artemis, machine-learning-moving-average, macd-with-filter,
advanced-custom-multi-ma, momentum-based-zigzag, neural-network, trend-targets → builds, range-filter and
twin-range-filter → the `wper` arithmetic one line down); 6 off `runtime.error` (ema-ribbon,
black-scholes, htf-fair-value-gap, ict-turtle-soup, session-highs-and-lows, smt-divergence-ict-killzones);
4 onto a `lower-tf:*` code (ema-ribbon, liquidity-engulfing, mtf-dashboard-pro, multi-timeframe-fvg).

**poor-man039s-volume-profile — measured, not changed.** Its 40 label texts are `content:withheld`
because C20 asks the run for no text / colour in a script that reads `timeframe.period`, and it reads it
only as a request's TIMEFRAME ARGUMENT (`security(volume_source_symbol, timeframe.period, volume)`),
where the spelling reaches no value. With the gate opened for exactly that shape (an experiment, restored
by bytes): 246 of 246 ops convert, 0 drops, 160 runtime values asked (y, colour, text colour, text × 40)
— and the run is withheld whole, `runtime:INSTRUCTIONS_PER_BAR`: its last bar needs **227,730** VM
instructions (the 40-row × `block_size` scan) against 200,000. The budget is not raised, so the gate
change would move accounting and draw nothing; it is not landed. Behind the budget a second wall
waits: each row's colour is `cond ? color.new(orange, 50) : color.new(gray, 50)` through a block local,
which C20 serves OPAQUE only (`{c:'rt'}`).

**Mutation proofs** (bytes + sha256 captured, restored by bytes, sha verified; each alone; control green
30 / 30): the frame constant not answered → 9 red; a frame name falling through to `env` → 13 red (the
wrong-value rail among them); one copy shared by every call site → 2 red; a `series` parameter folded →
1 red; `runtime.error` not stopping → 2 red; the lower-timeframe decline not asked → 2 red; a
bar-varying argument not named → 5 red.

**Still refused, and what would settle each:**

| what | would settle it |
|---|---|
| artemis in the runtime lane — `pine:block`@233, `smooth`'s `switch m` over a `simple string` | the same call-site rule for a TEXT argument: the arm a fixed string selects is fixed per call site. With that arm substituted (`"RMA" => ta.rma`), `drmEngine` is TradingView's oscillator on 632 / 632 bars — so the remaining work is the switch, not the window |
| a reached `runtime.error` (what the study holds) | **Q-E1**: `tools/visual_conformance/probes/vw-runtime-error.pine` on AMEX:SPY 1D, defaults (control) and `Stop at bar` = 100 — plot rows and labels kept before the error, and the status text |
| ema-ribbon's `"15"` / `"60"` / `"240"` requests | Q-L1 (C27). Behind it (measured by replacing the three with `"W"`): `runtime:request-with-state`@156 — `fastEMA` reads `src`, a `switch`-bound NON-`var` binding; serving it means re-lowering a non-persistent binding chain inside the request's region, a capability, not a fix |
| constant arithmetic over a fixed parameter (`n * 2 - 1`) | a constant folder for the lane's length rule (both the top level and a frame); two corpus scripts |
| poor-man's 40 labels | `INSTRUCTIONS_PER_BAR` (ruled: not raised), then a colour chosen between two transparent literals by a condition only the run computes |

**For the integrator (not this lane's to change).** The HOST lane has no reading of `runtime.error` at
all: a script whose validation fires — at a member's own input values, the door serves member inputs —
is drawn here while TradingView shows an error. No graded capture reaches one; Q-E1 is the witness
either lane would need.
## C30 — `time("W" / "M" / "3M" / "12M")` on a daily chart (2026-09-30, step 40)

Branch `pine/c30-time-anchors`, base `e0eb227ee` (wave 8). The rule is stated once, in
`pine.js::periodAnchorOf`; the withholding in `interpret.js::periodAnchorMask`.

**What the capture shows** (`vw-time-tf-spy-1d-2026-09-28`, AMEX:SPY 1D, 900 bars
2023-02-24 → 2026-09-25; rows T01–T04 plot `(time(tf) - time)` in days, T07–T09
`ta.change(time(tf)) != 0`):

| question | answer, measured |
|---|---|
| which timestamp | the `time` of the FIRST DAILY BAR of the period — 09:30 New York in that day's own DST (differences across a DST change are fractional days, e.g. −11.9583), never midnight and never the calendar boundary |
| week | New York ISO week, Monday-first; 17 weeks in the window open on a Tuesday (holiday Monday) and anchor to the Tuesday bar: 0 mismatches |
| month / quarter / year | calendar month, quarter (Jan / Apr / Jul / Oct), year; a period whose first calendar day is a weekend or holiday anchors to its first trading day: 0 mismatches |
| first partial period | the vendor answers the REAL open (bar 0, Fri 2023-02-24, reads −3 days: Tue 2023-02-21, a bar before the window; −23 / −52 / −52 for M / 3M / 12M). Our series does not hold those bars: **withheld** — 1 / 3 / 26 / 214 bars for W / M / 3M / 12M |
| second witness | `vw-clock-close-tfchange-spy-1d` K14 / K15 (`ta.change(time("W"/"M")) != 0`), 8,473 sessions 1993 → 2026: 0 wrong, bars 0 and 1 withheld |
| intraday | `vw-time-tf-spy-60-2026-09-28`: the Tuesday 09:30 bar reads −1.0417 days for `time("W")` — NOT the week's first RTH bar. A different rule, not derived here; nothing is served on a non-daily chart |

**The tree.** `periodseconds == 86400 ? valuewhenOccurrence(key != key[1], time, 0) * 1000 : na`,
where `key` is the period's own number over clock leaves that read only this bar
(`interpret.js::periodFirstCondition`: W `floor(dayopentime / 86400) - mod(dayofweek + 5, 7)`,
M `year * 12 + month`, 3M `year * 4 + floor((month - 1) / 3)`, 12M `year`). No new node, no
new clock column, no manifest entry: the tree is built from vocabulary both lanes already hold.
⚠️ Not the `weekfirst` / `monthfirst` columns: a clock leaf that declares a one-bar window is
counted 1 by `lint.js::maxLookback` and 0 by `interpret.js::maxLookback`
(`lookbackAgreement.test.js` went red on 8 trees with the column form); a `[1]` offset is one
bar in both. That disagreement is latent at base for any tree reading `sessionfirst` /
`weekfirst` / `monthfirst` and is NOT fixed here (it needs both readers in both lanes).

**Withheld, never drawn off a `NaN`.** Before the first boundary the anchor is `NaN`, which
downstream is Pine's `na` — and the vendor's value there is not `na` (the probe's own
`na(t) ? -99999 : …` turned it into a confident −99999; `ta.change(...) != 0` read FALSE on
the first boundary where the vendor reads TRUE). So `periodAnchorMask` (the C26 / C12s
argument: `maxLookback` is a tree sum) withholds every root bar within
`maxLookback(root) − maxLookback(anchor)` bars of an unknown anchor bar, in the plot lane
(`interpret`) and the object lane (merged into the unknown mask, C17 withholds), and every
bar when the chart is not daily (the tree's own gate answers `NaN` there, which is not the
vendor's answer either). The anchor is recognised node for node against the builder that
writes it; a member's own `valuewhenOccurrence` keeps its meaning. ⚠️ The mask is in the JS
lanes only (as C26's is): the Python interpreter evaluates the same tree and reads the first
partial period as a hole, not as withheld — not mirrored there, and stated rather than assumed safe.

**Refused by name:** any other period (`"6M"`, `"2W"`, `"1Y"`, every intraday code), the four
periods when the translation is told the chart is not daily or is a screen, `time_close(<tf>)`
for these periods (the probe did not ask it), a timeframe that does not fold to a literal.
The capture that settles each: the same probe on that chart (60m exists and shows another
rule — it needs its own derivation), `time_close("W")` rows added to `vw-time-tf.pine`.
`time(timeframe.period)` and `time("60")` on 1D ARE witnessed by this capture (both equal
`time`, T05 / T06 = 0 on 900 bars) and were left refused — outside this lane's scope.

**The rail** (`vendorHarness.c30TimeAnchor.test.js`, 25 tests). The probe itself still refuses
at the member door (T05, T06, T16 refuse by their own rules), so the replay grades a DERIVED
capture — those three rows cut, re-sealed — after the parent's receipt and source sha verify:
T01–T04 0 value mismatches and exactly 1 / 3 / 26 / 214 withheld; T07–T09 the same plus the
boundary bar. Controls: the 17 Tuesday weeks read 0 on the Tuesday; a vendor column moved to
the calendar Monday is caught; a first-bar label over a known clock IS drawn. Object lane:
a last-bar label prints the vendor's own offset; a first-bar label and a 60m label are
withheld; high-low-open-mid-ranges' lines are held to TradingView's records.

**The seven scripts** (C28 counted seven refusing on `time(<tf>)`; base → tip, objects pane on):

| script | asks for | base | tip | next wall |
|---|---|---|---|---|
| high-low-open-mid-ranges | `time(higherTF)` = `"W"` @168, in `vline` | attaches; lines 504 / 0 | attaches; lines 504 / **503**, every one TradingView's, the 100 dividers included | lines: the vendor's oldest (id 2151) is not held — the collector's edge; labels 504 / 0 (`pine:input-kind input.timeframe` in a text @143, `line.get_y1` history) and cells 45 / 37 (`'M'` / `'3M'` requests) — unchanged |
| mtf-key-levels-support-and-resistance | `time("W")` @627, `change(time('M'))` @658 | builder: `pine:function` | **translates** (1 → 4 outputs) | install door: `budget:series` — W-VWAP reads 10 distinct series, cap 8 (not raised; the column form would read 9) |
| vwap-fibo-dev-extensions-strategy | `time(reso)`, default `"W"` @21 | 0 outputs | **5 outputs** serve | `pine:declaration-strategy` (a strategy; unchanged) |
| chart-champions-part-1-npoc-levels-vwaps | `time('W')` @97, `change(time('M'))` @121, `time(res)` @84 | 21 outputs | **23 outputs** | `time(res)` @84 (a function's formal parameter does not fold) and seven `time(timeframe.period, <session>)` |
| 3-level-zigzag-semafor | `'15'`, `'30'` | refused | refused, unchanged | `pine:reassign _direction` first; the periods are intraday |
| zigzag-ma-pattern-recognition | `'15'` | refused | refused, unchanged | intraday period |
| smart-money-concepts-by-welotrades | `time(res)`, a formal parameter | refused | refused, unchanged | the parameter fold, then `pine:collection` |

**Measured** (base `e0eb227ee` → tip, same commands, same box):

| | base | tip |
|---|---|---|
| 47 captures, pane on: objects MATCH / overall / families / plots | 28 / 25 / 222 of 266 / 161 of 172 | unchanged; 1 entry's detail moved (OHLM lines 0 → 503) |
| 47 captures, pane off | 18 / 15 / 105 of 119 / 140 of 151 | unchanged, 0 entries |
| committed harness dir (87 files), on: objects / overall | 49 / 42 | unchanged; changed entries: OHLM (lines), `vw-time-tf-spy-1d` and `-60` (INCONCLUSIVE both, refusal sentence reworded) |
| committed harness dir, off | 39 / 32 | unchanged; the two `vw-time-tf` sentences only |
| member-door census 266 × both flags | attach 41 / 64 | 41 / 64; 4 rows per flag: mtf-key-levels builder → install (`budget:series`), three refusal sentences reworded |
| translation census 266 (strict) | ok 57, served outputs 817 | ok 58, served 827 (mtf +3, vwap-fibo +5, chart-champions +2) |
| notebook first-open | 1,897,262 B PASS | 1,897,262 B PASS (+0) |
| pine chunk / total JS | 330,629 B / 12,633,180 B | 331,812 B (+1,183) / 12,636,618 B (+3,438) |
| `paramIds.test.js` | 4 passed, 1 skipped | 4 passed, 1 skipped — ⚠️ with ONE append-only re-pin: vwap-fibo mints `__uct_param_1` / `_2` where it minted none (its inputs sat behind the refusal); no existing id moved; the door refuses the script (a strategy), so nothing is saved against it |

**Mutations** (11 run; 10 red alone, restored by bytes with the sha verified): the plot-lane
withholding, the reach, the non-daily mask, the object-lane merge, a Tuesday-start week, the
quarter length, the tree's daily gate, the translation's non-daily refusal, the anchor
recognition, the year key. ⚠️ One SURVIVES and is recorded rather than hidden: a Sunday-start
week — no capture holds a weekend bar, so Sunday-first and Monday-first are the same function
on every bar measured.

**Left for the integrator.** (1) The re-pin above — the brief says zero edits for saveable
scripts; this script is not saveable (the door refuses it), and the alternative is to keep
`time(<input default "W">)` refused for it. (2) On a non-daily chart the member pane
withholds every bar silently; a NAMED bind-time reason needs a report like C26's
`otherSymbolReport`. (3) The clock-leaf lookback disagreement between the two readers.
(4) `time(timeframe.period)` and `time("60")` on 1D are witnessed and unserved.
## C31 — loop-scoped names and loop-built text in the object lane (2026-10-01, step 41)

Branch `pine/c31-loops`, base `e0eb227ee` (wave 8). Four § C28 walls were one mechanism: the object lane's block
reader is `foldStatements`, run over each refused block by the block harvest, and it THREW at the first `for`.
Every statement below the loop was then bound by nobody.

| what | rule (where it lives) | proof | refused, by name |
|---|---|---|---|
| a loop inside a block | stepped over under `ctx.loopStepOver` (the block harvest only): `loopWrites` — every `:=`/`+=` target, every array write in either spelling (`mutatorTargets`), the base of a dotted target, a modelled array handed to a user function — is condemned through `loopWriteRefusal`, the ONE builder the top-level walk now asks too; a name declared in the body is the loop's own | `vendorHarness.c31Loops`: artemis `fTxt`, htf `indxBar` boxes, a local derived below the loop never reads the seed | what the loop writes (`pine:reassign`, R7's sentence for a counted `for`; `pine:collection` for an array) — on the last bar the runtime lane answers it (C18) |
| text built in a bounded `for` | `unrollTextLoop`: header `for <id> = <int> to <int>`, ascending, at most 64 passes (a work bound; the 128-node cap is untouched); every body statement a flat `:=`/`+=` on a name seeded from a string literal; the counter is written into each pass as its number; the per-pass folds record nothing | ema-ribbon's `f_strengthBar` shape folds to exactly the text Pine builds from the capture's bars; the capture's cell holds ten glyphs for `0 to 9` | descending bounds (Pine counts DOWN — no capture witnesses it); a variable bound (artemis `filled`, poor-man `row0_width`); a numeric accumulator (ruling R7) |
| a helper that returns a local | `fn.locals` (recorded at the definition) laid over the caller's scope in `textNodeOf`'s inline branch | the same test; `c22Vdubus`' four `patName` labels convert, its five captured labels unchanged | — |
| a `ta.*` call in a block that does not run on every bar | `foldIfChain` tracks whether an arm's condition (or one above it) is bar-invariant (`barInvariantNames` / `guardIsBarInvariant`, the inliner's own reader); a block local bound to a `ta.*` call under a varying guard carries `condCall`; the object lane's Resolver refuses it (`pine:block`) and the runtime rescue may not answer it (`noRuntime`) | ema-ribbon cell (2,3): TradingView `██████████`, the every-bar maximum gives `██████░░░░` — withheld | the call-history value itself (below) |
| a binding below a stepped-over loop | `markAfterLoop`: a refusal reached through it is admitted by `rtAdmits`, so what was `pine:undefined` and the run's to answer still is | `vendorHarness.c18KClustering` (found red by the full suite, then fixed) | — |

⛔ **The main walk still refuses the block at its loop.** A chain it folds reaches inputs a refused one never
did: stepping over there moved saved parameter ids (`paramIds.test.js`: `anchored-vwap-pinch`, `delta-imbalance-map`,
`kalman-price-filter` gained ids; volume v2 lost one). So `pine:reassign row0_price`@276 (poor-man: a TOP-LEVEL
name reassigned in one block and read in another) is **not** fixed — it needs the main walk, which needs
parameter minting that is invariant to how much of a block folds. Left for a ruling; the label it positions is
withheld for its text either way.

**Per script (objects pane on, RDDT 1D):**

| script | before | after | next wall |
|---|---|---|---|
| artemis-oscillator-pro | cells 14 / 21 | 15 / 21, every drawn cell TradingView's | `kBull` — a running total in `for _k = 0 to knnK - 1` over `array.min(kDist)` (R7; the runtime lane stops at `runtime:history-dynamic-offset`); it feeds `knnVal` → four cells and `bar_str`'s bound. `100 bars`: `pine:collection knnF1` (`array.size` of a pushed/shifted `var` array) |
| htf-candle-footprint | boxes 0 / 13 | 3 / 13 (the body boxes) | `HL` — `HL.push(high[i])` in `for i = 0 to period`, read as `HL.max()` / `HL.min()` (`maxH`, `minL`): every line, label and profile box reads them, and `loop@138`'s bound `size` derives from them. A reduction over a loop-filled array; runtime `runtime:loop`@74 |
| ema-ribbon | cells 34 / 48 | 34 / 48 | cell (2,3): the loop folds; the wall is `maxSpread = ta.highest(spread, sqzLookback)` inside `if showTable and barstate.islast` — a call that has run once. The other 13 are C27 / `timeframe.period` (unchanged) |
| poor-man's volume profile | labels 0 / 40 | 0 / 40 (`unboundLocals` 40 → 0) | `row0_value` — a running total over `for i = 0 to block_size + 1` (R7), which sets `row0_width`, the bound of each text loop; then `pine:reassign row0_price` (above) |

**Refused, and what would settle each:**

| what | would settle it |
|---|---|
| a `ta.*` call under a varying guard | one witness exists (ema-ribbon: `ta.highest` called once returns its argument). A probe printing `ta.highest` / `ta.sma` / `ta.ema` inside `if barstate.islast`, inside `if close > open`, and at the top level on SPY 1D settles the call-history rule for more than one function and one guard — queued as Q-C31a |
| a descending `for` (`for i = 9 to 0`) | a probe building text in a descending and in an empty-range loop (`for i = 0 to -1`) — Q-C31b |
| numeric accumulators in a counted `for` | ruling R7; on the last bar the runtime lane serves them where it runs the script |
| the main-walk step-over (`row0_price`) | a ruling on parameter-id stability when a refused block starts folding |

**Measured (base `e0eb227ee` → tip):** the 47, objects pane on: objects MATCH 28 → 28, overall 25 → 25, families
222 / 266 → 222 / 266, plots 161 / 172 → 161 / 172; pane off: 18 / 15 / 105 of 119 / 140 of 151, unchanged.
Entries changed: artemis (both flag states), htf-candle-footprint (on). Committed harness dir (87 comparable):
objects 49, overall 42, families 278 / 322, plots 261 / 276, unchanged; the same two entries. Member-door census
266 × 2: 41 / 64 → 41 / 64, 0 rows (base-vs-base 0). Translation census (266 × 2, base-vs-base 0 rows): no plot
tree, formula, refusal or parameter map moved; object programs changed in artemis (+1 cell), vdubus (+4 label
creates), mtf-dashboard-pro (+4 label creates, `f_price`'s local) and volume-footprint (+5 ops); `unboundLocals`
fell in 14 scripts and rose in one (renderingnature, 0 → 2: its fold now reaches two names further down). Notebook
first-open 1,897,262 B at base and tip (+0, PASS); total JS +3,965 B, all in the lazy `pine-*.js` chunk
(330,629 → 334,594).

**Rails and proofs:** `vendorHarness.c31Loops.test.js` (12, committed captures), `pine.c31LoopScope.test.js` (9).
Twelve mutations, each red alone, restored by bytes with the sha verified against the committed blob: `loopWrites`
emptied; descending bounds admitted; a numeric accumulator admitted; the step-over in the main walk; the
conditional call unmarked; the runtime rescue ignoring `noRuntime`; helper locals not laid over; the harvest not
stepping over; the last pass dropped; a chain arm never conditional; the rescue ignoring `afterLoop`; nothing
marked `afterLoop`. Fixtures the fold spent moved to the frontier (`objectContentWithheld`, `objectBlockLocalScope`,
`textTupleLocal`); re-pins for steps that now convert: `pineProbeReplay` (artemis, six more Resolvers),
`partialDrawing` (artemis 7 → 6 of 38), `c22Vdubus`, `c21DualView`.

## C33 — object-lane reads: a pushed helper drawing, timeframe text, getter history, `last_bar_time` (2026-09-30, step 43)

Base `e0eb227ee` (wave 8). Branch `pine/c33-object-reads`. One script per wall; every object now drawn is graded
against the committed vendor capture in `__tests__/vendorHarness/vendorHarness.c33ObjectReads.test.js` (position AND
text), and what is not exact is withheld. Mechanism rails and controls: `ast/c33ObjectReads.test.js`.

### The walls, and the rule that reads each

| script | wall at base | rule | result |
|---|---|---|---|
| average-day-range-adr-pivots | `fn:in-expression` — `array.push(arr, draw_box(…))` @234 | The statement is `tmp = f(…)` then `array.push(arr, tmp)` (`pushOfDrawCall`), walked by the one inliner and the one collection reader. `draw_box`'s body is a lone `if`, so it returns the box or `na` (`ifOnlyReturn`). Only when the call is the WHOLE value argument and the list is a declared drawing list; a drawing call anywhere else in an expression is still refused by name. | lines 2 / 2, boxes 2 / 2, cells 4 / 4 — MATCH |
| | `res_to_str(input.timeframe)` in the box and cell text | The default is printed only for a witnessed spelling (below). The text's `if` chain nested deeper than the validator's 16; a chain whose every test is bar-invariant is replaced by the arm it always takes (`fitTextNest`), anything else is refused by name. | `"152.43 (D)"`, `"4.6 % (D)"` equal |
| | `request.security(…, tf, …)` with `tf` a parameter | On the object pass the parameter is the caller's argument (`timeframeLiteralOf`). ⛔ Not on the plot lane: a newly served plot output there would mint parameter ids ahead of saved ones (`paramIds.test.js`, mutation M08). | — |
| high-low-open-mid-ranges | `line.get_y1` through history @145 / 160 | `<getter>[k]`, k 1..5, outside loops → `{v:'get', back:k}`; `str.tostring(<getter>)` → the text node `{t:'val'}`; an inlined helper's own getter local is a scalar written where it stands. Served only where the answer is known without a measurement: on an EMPTY handle the read is `na` and prints TradingView's own `"NaN"`. A history read on a LIVE handle, and any FINITE getter number in a text, is something no capture pins — the op is withheld (C17). | 504 labels drawn; text, y, x-rank, text colour equal |
| | `input.timeframe` as label text @143 | `W` under v5 is witnessed by this capture (`"W | Open | 149"`). | text agrees |
| | `time(<timeframe>)` @169 inside `i_show and …` | NOT read (lane C30's). The guard is an `and` with an `input.bool` gate, so it is carried as a latch over the read terms and one `{v:'unknown'}`: known FALSE where a read term is false, unknown otherwise — every op under it is then withheld on that bar, and a create is counted as one Pine MAY have made (past the collector's trigger the family is withheld whole). | its 504 lines stay withheld |
| volume-profile | `last_bar_time` @211 | The newest bar's opening time in ms (`lastbartime` × 1000), equal to the capture's `window.lastBarTime` × 1000 on every RDDT 1D capture. | served |
| | `va_up` state @215 | Not reached: the script stops earlier, at `chart.left_visible_bar_time` @146 (the viewport — no capture pins what TradingView's visible range was). | 3 lines withheld, refusal named |

### The witness rule for `input.timeframe` text

`INPUT_TIMEFRAME_TEXT_WITNESS` (`pine.js`) names the capture behind each spelling it serves: `D` under v6
(average-day-range-adr-pivots), `W` under v5 (high-low-open-mid-ranges). Any other spelling — `M`, `W` under v6, `D`
under v5, `60`, `''` — sets `propWithhold` on the op (the op still runs; only that property is unknown), records
`textFormatRefusals["input.timeframe:unwitnessed '<s>' v<n>"]`, and is never printed. Widening the table without a
capture is mutation M04.

### Before / after (base `e0eb227ee` → tip)

| measurement | base | tip |
|---|---|---|
| 1. the 47, objects flag ON — objects MATCH / overall / families / plots | 28 / 25 / 222 of 266 / 161 of 172 | **29 / 26 / 228 of 266** / 161 of 172 |
| 1. the 47, flag OFF | 18 / 15 / 105 of 119 / 140 of 151 | unchanged |
| 2. committed harness dir (87 graded), flag ON — objects / overall / families | 49 / 42 / 278 of 322 | **50 / 43 / 284 of 322** |
| 2. committed harness dir, flag OFF | 39 / 32 / 161 of 175 | unchanged |
| 3. member-door census 266 × both flags — attach off / on | 41 / 64 | 41 / 64, 0 of 532 rows changed (base-vs-base 0) |
| 4. translation census 266 | — | no served plot output changed; 37 scripts' object drop counts or programs moved |
| 5. notebook first-open | 1,897,262 B | 1,897,262 B (+0, `notebook_perf_budgets` PASS) |
| 5. `pine` chunk / total JS | 330,629 B / 12,633,180 B | 339,229 B (+8,600) / 12,643,548 B (+10,368) |
| 6. `paramIds.test.js` | green | green, no edit |

Changed harness entries, both runs: average-day-range-adr-pivots and high-low-open-mid-ranges, and only those.

Of the 23 corpus scripts whose object program changed, six attach at the member door: the two above;
institutional-smc-order-flow-matrix-pro (its two zone boxes now carry TradingView's own fill `#ff174426` —
`color.new(c_bear_zone, zone_opacity)` — graded in the vendor rail); ict-killzones-pivots-tfo (+7 cells under an
unknown guard, withheld where unknown; still MATCH); options-max-pain-calculator-backquant (+1 delete under an
unknown guard — its target is withheld where unknown; verdict unchanged); htf-liquidity-dashboard-tfo (the same 71
ops over the same 41 trees, interned in another order — its thirty partial guards cost Resolvers and nothing they
guard survives, so `pineProbeReplay.test.js` is re-pinned 691 / 5824 → 856 / 7174 with the reason beside it).

### What stays refused, and the capture that settles it

- `input.timeframe` text for any unwitnessed spelling / version: a probe `label.new(bar_index, high, input.timeframe("<s>"))`
  per spelling under v5 and v6.
- A getter's history on a LIVE handle (`line.get_y1(l)[1]` where `l` holds a line): high-low-open-mid-ranges captured
  with "Extend Last Range" on, or a three-line probe printing `str.tostring(line.get_y1(l)[1])`.
- A FINITE getter number in a text (`str.tostring(line.get_y1(l))` on a live line): carried, withheld at run time.
  The same probe settles it.
- high-low-open-mid-ranges' 504 lines: `time(<timeframe>)` @169 (lane C30). Its cells 37 of 45: the `'M'` / `'3M'`
  requests @198 (out of scope).
- volume-profile, in order: `chart.left_visible_bar_time` @146 → one-argument `ta.highest` @154 →
  `runtime:history-dynamic-offset` (`var int lookback_bars`) → the 200 × 200 loops and the `va_up` `while` (budgets;
  none raised).
- A drawing call inside any other expression (`x = cond ? box.new(…) : na`, an argument of a non-push call).
- A partial guard with no `input.bool` gate, a negated one, one in a loop, or one whose terms read object state.
- A top-level `color = na` (only a ternary's `na` arm is read); `str.tostring(<getter>, fmt)` with a format other
  than plain `#`/`0` digits (`"#,###.##"`, `format.mintick`, text inside the pattern).

### Mutation proofs

32 mutations (`M01`–`M32`), each applied alone: bytes and sha256 captured, mutated, the four rails run
(`c33ObjectReads`, `vendorHarness.c33ObjectReads`, `paramIds`, `pineProbeReplay`, `objectCorpus`), restored by bytes, sha verified,
`git status` clean after. Control (no mutation): 58 passed, 1 skipped. Every mutation red: pushOfDrawCall off;
lone-`if` return off; the caller name not emptied; witness table widened; unwitnessed mark dropped; `fitTextNest`
off; timeframe parameter removed; timeframe parameter on the plot lane (reds `paramIds`); `last_bar_time` left in
seconds; colour rescue off; live / decided `na` arm off; getter history off; history on a live handle trusted;
state-number text off; any format accepted; helper-local getter scalar off; partial guard without an input gate;
runtime unknown read as known; creates Pine may have made not counted; collector getter taint off; collector family
not withheld; an all-unknown program attaching; `guard:partial` not counted; orphan unknown latch kept; partial guard
asked per op (reds `pineProbeReplay`); three validator checks; `guard:partial` unclassified at the door; the taint
path not armed by the program; a finite getter number printed.

### Left for the integrator

- average-day-range-adr-pivots' box `top`/`bottom` differ from TradingView's by ≤ 3e-14 relative (summation order);
  the vendor rail compares y within 1e-12 relative. Exact-equal would withhold both boxes.
- The partial-guard, `na`-arm and colour-rescue rules are general: 23 corpus programs moved, 17 of them still refused
  at the door for other reasons. Only the six attached ones above reach a member.
- `str.tostring(<getter>)` prints only an `na` read ("NaN", eight high-low-open-mid-ranges labels). A FINITE getter
  number is withheld at run time until a capture prints one; `builder/objectCorpus.test.js`'s getter case was
  re-stated for the carried form (the label op exists, its text is the runtime's read, never a graph node) and now
  drives the by-name refusal through the arithmetic form.
- htf-liquidity's `pineProbeReplay` re-pin (above). Translation time is unchanged: six corpus-wide test files
  alternated base / tip / base / tip at one worker read 107.2 / 107.7 / 97.4 / 100.7 s.

### C33 on wave 9 (merge of `integrate/wave9-2026-09-30` @ `45859e598`, 2026-10-01)

Everything above was measured on wave 8. Merged onto wave 9 (C29, C30, C31, C32, C34, C35), three things changed:

- **One `{t:'val'}` text node.** C32 introduced the same node for a number that moves per pass of a loop. There is
  one shape and one validator (`assertValueRef` on its source — a state read is legal only in a create / update's own
  text) and one `case 'val'` in the runtime. C33's rule — a FINITE number read off a drawing is withheld — is kept in
  `textTainted` and applies only to a state read (a getter, or a scalar a getter feeds); C32's per-pass numbers are
  served exactly as C32 serves them (mutation M34 reds C32's own rails).
- **high-low-open-mid-ranges holds both families.** C30 reads `time("W")`, so the divider's guard is fully read and
  is no longer carried partial: lines **503 of 504** (C30) and labels **504 of 504** (C33) together, nothing
  withheld. The vendor rail now grades the 503 lines too — both ends' price, bar order of both ends, extension,
  dash, width, colour, and id order up to one constant; the one line not held is TradingView's oldest (id 2151).
  The partial guard's vendor witness is now ict-killzones-pivots-tfo (its partial guards carried, never drawn; the
  table is TradingView's three cells).
- **`pineProbeReplay`**: artemis (wave 9's pin `[531, 409877, 'f38c24a72a987c60']`) and htf-liquidity (C33's pin
  `[856, 7174, 'ff55463c3a36e466']`) re-measured on the merged tree — both unchanged.

| measurement | wave 9 (`45859e598`) | wave 9 + C33 |
|---|---|---|
| the 47, flag ON — objects MATCH / overall / families / plots | 29 / 26 / 227 of 266 / 161 of 172 | **30 / 27 / 233 of 266** / 161 of 172 |
| the 47, flag OFF | 18 / 15 / 107 of 119 / 140 of 151 | unchanged |
| committed harness dir (104 graded), flag ON — objects / overall / families / plots | 57 / 45 / 304 of 343 / 316 of 379 | **58 / 46 / 310 of 343** / 316 of 379 |
| committed harness dir, flag OFF | 46 / 34 / 184 of 196 / 295 of 358 | unchanged |
| member-door census 266 × both flags | attach 41 / 64 | 41 / 64, 0 of 532 rows changed |
| notebook first-open | 1,897,262 B | 1,897,262 B (+0, PASS) |
| `pine` chunk / total JS | 342,839 B / 12,662,104 B | 351,458 B (+8,619) / 12,672,121 B (+10,017) |
| `paramIds.test.js` | — | zero edits against wave 9 |

Entries that differ from wave 9's own, in both runs, and only these: average-day-range-adr-pivots (DIVERGE → MATCH:
lines 2 / 2, boxes 2 / 2, cells 4 / 4) and high-low-open-mid-ranges (labels 0 → 504 of 504, label text agrees; lines
503 of 504 as on wave 9; cells 37 of 45 — still DIVERGE on the oldest line and the `'M'` / `'3M'` cells).

Mutations re-run on the merged tree: 34 (the 32 above, plus M33 a getter-fed scalar not treated as object state, and
M34 the finite rule reaching C32's per-pass numbers), over nine rails including `objectFnInline.vendor`,
`objectWindowLoopReads`, `c32Collections` and `c30TimeAnchor`. Control 98 passed, 1 skipped; all 34 red alone,
restored by bytes, sha verified, `git status` clean.

## C36 — what C30 left: weekend bars, a named reason, two witnessed spellings, the Python lane, `time_close(<tf>)` (2026-09-30, step 47)

Branch `pine/c36-time-followups`. Base: wave 9 at `1ce378b3b` (C31 and C33 merged) plus the evening captures
(`pine/captures-2026-09-30b`, `28eb8f258`), both merged in. The rules are stated once, in
`interpret.js::periodAnchorMask` and the builders above it; the sentences a member reads in
`interpret.js::CHART_CLOCK_WITHHELD`. What is still owed a capture: `docs/pine/capture-queue-2026-09-30-time-anchors.md`.

The lane began as four follow-ups under a ruling to WITHHOLD the weekly anchor on a weekend-bar chart. The
evening captures then witnessed that item and added `time_close(<tf>)`; the integrator re-ruled "serve what
reproduces". Each finding was checked against its fixture before anything was served, and two did not hold as
summarised — both are written out below because they changed what is served.

### 1 — weekend bars (`vw-time-tf-bitstamp-btcusd-1d-2026-09-30`: BITSTAMP:BTCUSD 1D, 5,491 bars, every day of the week)

| question | answer, measured |
|---|---|
| which day opens the week | **Monday**. `time("W") − time` is 0 on a Monday bar and −6 on a Sunday bar. C30's surviving mutation M5 (Sunday-first) is dead: see Mutations |
| month / quarter / year | the 1st; the 1st of Jan / Apr / Jul / Oct; Jan 1 |
| ⚠️ is the anchor "the first daily BAR of the period" | **No — it is the period's CALENDAR open, bar or no bar.** The capture has 19 day-gaps. A week whose Monday bar is missing reads −1 on its Tuesday (19 bars); a month whose first bars are missing reads −2 on the 3rd (22 bars; 75 for the quarter). The first-bar tree answers 0 there |
| ⚠️ is this chart's `time` the vendor's on such a symbol | **No.** The chart stamps a date-keyed daily bar at 09:30 New York (`indicators.js::barOpenInstant`, an equities reading); the vendor stamps this symbol's at 00:00 UTC. They are 13.5 h apart on 3,596 bars and 14.5 h on 1,895 — every bar. Inside one New York clock regime `time(tf) − time` is still the vendor's whole number of days; across a change it is an hour off: 30 / 666 / 1,138 / 3,540 bars for W / M / 3M / 12M |

**Served:** a daily chart whose bars include BOTH a Saturday and a Sunday (detected off the `dayofweek` column the
week key reads) gets the four anchors by the same keys as equities. **Withheld there, by name:** a period whose
opening bar is not its calendar first day (`periodCalendarFirst` — `time-anchor:period-open-missing`), and a bar
across a New York clock change from its anchor (`time-anchor:utc-day-clock`). Through the real member door on the
capture (T16, `input.time`, cut): **T01–T04 0 value mismatches; 5,438 / 4,795 / 4,247 / 1,845 bars equal to
TradingView; 53 / 696 / 1,244 / 3,646 withheld** — exactly the bars the capture's own dates say (first partial
4 / 8 / 31 / 106 + opening day missing 19 / 22 / 75 / 0 + clock change 30 / 666 / 1,138 / 3,540), computed in the
rail from the capture alone and compared index for index. T07–T09 (the new-period event): 0 mismatches.

⚠️ **Stated plainly, not hidden:** the anchor's ABSOLUTE instant on such a chart is this chart's `time` of that bar,
so it carries the 13.5 / 14.5 h offset that bare `time` already carries there. That is the clock's, pre-existing,
and wider than this lane (see "Left for the integrator"). `time("12M")` is withheld on 66 % of the capture's bars
for the same reason. Both go away with an every-day clock, not with a capture.

**Still withheld whole:** a daily chart with a Saturday OR a Sunday bar but not both (`time-anchor:weekend-bars`) —
an FX week opening on a Sunday evening is neither capture's shape. And bars with no readable clock — a daily bar
keyed by a `YYYYMMDD` number — are withheld whole (`time-clock:unreadable`): a blank clock is not "no weekend bars".

### 1b — found on the way: C30's anchor was WRONG on a session chart (3 bars), and is unmeasured before 2000

`vw-time-close-tf-spy-1d-2026-09-30` (AMEX:SPY 1D, 4,800 bars from 2007-08-31) carries `time(tf) − time` beside
its closes (Q08–Q11). On the Hurricane Sandy week of 2012 — no bar Mon 10-29 or Tue 10-30 — the vendor reads
**−2 / −3 / −4** on Wed..Fri where C30's first-bar tree reads **0 / −1 / −2**. The vendor anchors to the first
session ITS CALENDAR holds, and its session view does not close those two days (`tradingViewSession.js`). C30's
900-bar capture (2023 → 2026) has no such week, and its 8,473-bar second witness plots the EVENT, which is right
either way. Same class as M5: the capture could not tell the two rules apart.

**Fix, by withholding:** on a session chart a period is known only if its opening bar's `time` equals
`tf_live(<W|M>, time)` — the period bar's own open off the vendor calendar — and, for a quarter or year, the bar's
month is the period's first (`time-anchor:session-open-missing`). That withholds the Sandy week (Q08: 3 value
mismatches → 0) and every holiday-opened period before 2000, where the vendor's calendar applies no closure and no
daily chart was measured: on SPY's 8,473 sessions 121 / 165 / 414 / 1,497 bars of W / M / 3M / 12M, all dated
before 2000, plus Sandy's 3. `clockCloseTfChange.vendor.test.js` K14 / K15 moved from `withheld = [0, 1]` to 154 /
174 bars, every one explained in the test (before 2000-01-04, or 2012-10-31..11-05), 0 wrong.

⭐ **Measured, not yet used:** `tf_live("W", time)` equals the vendor's `time("W")` on **4,800 / 4,800** bars of that
capture and **900 / 900** of C30's — the Sandy week and the first partial week included; `tf_live("M", time)`
likewise. A calendar-read anchor for W and M on a session chart would serve every bar C30 and this lane withhold.
It would also change a tree C30 shipped and carry `tf_live`'s `preview-repaints` label — left for a ruling.

### 2 — a named reason, where a member reads it

`periodAnchorMask` writes each withholding (code → sentence) into `opts.chartClockSink` as it decides. Plots:
`nativeRegistry.chartClockReport(columns)` (modelled on C26's `otherSymbolReport`, non-enumerable on the column
map). Drawings: the object reader's `chartClock` (both document forms). ⚠️ C26's report has no member surface — its
only reader is the vendor harness — so the surface was built: the binder publishes both lanes per instance to
`engine/chartClockNotice.js` (a store, like `paneFitNotice.js`: the fact is bind-time, not a document property)
and takes it down when the instance leaves, is hidden, the engine goes off or the binder releases;
`AttachedPineDisclosures` renders the sentence for the instances its own pane draws. Wording and plumbing only.

| code | bars | when |
|---|---|---|
| `time-anchor:not-daily` · `time-close:not-daily` | all | the chart is not 1D |
| `time-anchor:weekend-bars` · `time-close:weekend-bars` | all | daily bars with one weekend day but not the other · with any weekend bar |
| `time-anchor:other-bars` | all | the read sits under a request for another timeframe or symbol |
| `time-own:chart-unwitnessed` | all | `time(timeframe.period)` / `time("60")` off 1D and 60m |
| `time-clock:unreadable` | all | daily bars keyed by a date number: no clock to place anything by |
| `time-anchor:period-open-missing` · `time-anchor:session-open-missing` | that period | its calendar first day / first session has no bar |
| `time-anchor:utc-day-clock` | those bars | every-day chart, bar across a New York clock change from its anchor |
| `time-close:period-end-missing` | that period | a completed week / month whose last session has no bar |

An anchor's first partial period stays withheld with no sentence, as C30 left it: every chart has one.
A whole-series withholding is now decided BEFORE the tree is evaluated (`interpret.js::chartClockWhole`), so a
`tf_live` read on a weekly chart is "not measured here", never an `interpret:timeframe` refusal.

### 3 — `time(timeframe.period)` and `time("60")`

Both equal `time` on 900 daily bars (`vw-time-tf-spy-1d` T05 / T06), on 300 hourly bars (`vw-time-tf-spy-60`) and on
5,491 every-day daily bars (the BTCUSD capture). Served as the bar's own `time` on a 1D and a 60m chart
(`interpret.js::chartOwnTimeNode`: `(periodseconds == 86400 || periodseconds == 3600) ? time : na`, one builder,
recognised node for node); withheld and named on any other chart; refused by name for any other literal (`"15"`,
`"240"`, `"1H"` — the probe spelled `"60"`), on a screen, inside a request, and when the translation is told
another chart. The probe itself still refuses at the door on T16 (`input.time`, `pine:input-kind`), so the C30
rail keeps a derived capture — now with that ONE row cut — and grades T05 / T06: MATCH on 900 / 900.

### 4 — the Python lane: three consumers could reach the tree, and read a confident wrong value

A member pane saves ONE document. Its trees are evaluated server-side by `alert_user_series` (bars keyed
`YYYYMMDD`, no `tf`), `screener/scan_evaluator` (`YYYYMMDD`, `tf = D`) and `screener/backtest` (ISO dates, no
`tf`) — and nothing at the save door or in `assert_scannable` looks at clock leaves. In all three the clock the
anchor reads is blank, so the anchor was `NaN` on EVERY bar: measured before the fix, `na(time("W")) ? 111 : 222`
answered **111 on every bar** and `ta.change(time("W")) != 0` **0 on every bar**, in each context
(`test_control_the_unmasked_column_is_the_confident_wrong_answer`). `ast_interpret.period_anchor_mask` is now the
port of `periodAnchorMask` — every rule above, bar for bar. One fixture, both lanes
(`tests/fixtures/ast/period_anchor_parity.json`, written and re-checked by `ast/periodAnchorParity.test.js`, read
by `tests/test_ast_period_anchor_parity.py`): 52 cases over the member door's own trees. Each consumer already
treats `None` as "no number" (the sweep's `not_computable`, the backtest's honest hole, the alert's "no number
yet"), so a withheld bar lands in the right bucket. Python keeps the CODES; the sentences have one owner (JS).

### 5 — `time_close("W")` and `time_close("M")` (`vw-time-close-tf-spy-1d-2026-09-30`, probe `vw-time-close-tf.pine`)

The close of the period's LAST SESSION — Friday 16:00, Thursday 16:00 when Friday is a closure, 13:00 on a
half-day — and the forming period reads the SCHEDULED close. The tree is vocabulary both lanes already hold:
`periodseconds == 86400 ? tf_live(<W|M>, timeclose) * 1000 : na` — the bars resampled to the period, and that
period bar's own `timeclose`, which the clock answers from the vendor's session calendar. Through the member door
(Q03 / Q04 / Q05 cut): **Q01 and Q02 MATCH on 4,800 / 4,800, nothing withheld** — the first partial period and the
forming one included (Wed 2026-09-30 → Fri 2026-10-02 16:00) — and Q12 / Q13 (`ta.change(time_close(tf)) != 0`)
MATCH on 4,800.

| not served | why |
|---|---|
| a daily chart with weekend bars | on BTCUSD the vendor answers the NEXT period's open (next Monday 00:00 UTC, `vw-time-close-tf-bitstamp-btcusd-1d-2026-09-30`); this chart's daily clock holds no such instant. All 5,491 bars of Q01 / Q02 / Q12 / Q13 withheld, 0 wrong (`time-close:weekend-bars`) |
| a chart that is not 1D | not measured (`time-close:not-daily`) |
| a completed period whose last session has no bar | the calendar keeps open a day the chart has no bar for: every such week / month is before 2000, plus the week of 2001-09-10 — 53 / 40 bars on SPY's 8,473 sessions (`time-close:period-end-missing`). The capture starts in 2007, where calendar and bars agree, so which the vendor answers is unmeasured |
| `time_close("3M")` / `("12M")` | **measured** (Q03 / Q04: the close of the quarter's / year's last session) and refused by name: the engine resamples only weeks and months (`TF_RESAMPLABLE`). An engine gap, not a capture gap |
| `time_close(timeframe.period)` | witnessed equal to `time_close` on both captures (Q05); not in this lane's ruling, left refused |

⚠️ `tf_live` makes the linter label the tree `preview-repaints` (forward reach 4 / 20 bars). That is conservative,
not true of this value — a period's close is the calendar's and does not move as the period fills. A
`non-repainting` label needs a clock column for the period close.

### The clock-leaf lookback disagreement (measured, not fixed)

`{type:'series', name:'sessionfirst'}` (and `weekfirst`, `monthfirst`): `interpret.js::maxLookback` → **0**,
`lint.js::maxLookback` → **1**; Python the same split (`ast_interpret.max_lookback` 0, `ast_lint.max_lookback` 1).
The manifest declares `lookback: 1` for all three, so the linter reads the declaration and the interpreter counts
every leaf 0. Reproducer through the door: `plot(timeframe.change("D") ? 1 : 0)` → `(isfirst ? 0 : sessionfirst) ? 1 : 0`,
readers `[0, 1]`; under `ta.sma(…, 5)` `[5, 6]`. `lookbackAgreement.test.js` is blind to it by population: of 1,663
trees over `corpus/committed` + `tests/fixtures/member`, both lanes, **0** read any of the three leaves. Not fixed:
it needs both readers in both lanes and the oracle file; no mask here reads a path through those leaves.

### Measured (base = wave 9 `1ce378b3b` + captures `28eb8f258`; tip = this branch; same commands, same box)

| | base | tip |
|---|---|---|
| 47 captures, pane on: objects MATCH / overall / families / plots | 30 / 27 / 233 of 266 / 161 of 172 | unchanged, 0 entries |
| 47 captures, pane off | 18 / 15 / 107 of 119 / 140 of 151 | unchanged, 0 entries |
| committed harness dir (117 graded), on: objects / overall / families / plots | 62 / 46 / 315 of 350 / 343 of 417 | unchanged; 5 entries' refusal sentence moved, all INCONCLUSIVE both sides: `vw-time-tf-spy-1d`, `-spy-60`, `-bitstamp-btcusd-1d` now stop at `input.time` (`pine:input-kind`) instead of `time(<timeframe>)`; `vw-time-close-tf-spy-1d`, `-bitstamp-btcusd-1d` now stop at `time_close("3M")` |
| committed harness dir, off | 50 / 34 / 189 of 203 / 322 of 396 | unchanged; the same 5 sentences |
| member-door census 266 × both flags | attach 41 / 64 | 41 / 64; 3 rows per flag, each a refusal SENTENCE only (chart-champions, smart-money-concepts-by-welotrades, zigzag-ma-pattern-recognition: `timeAnchorSentence` now names the two served spellings). Base-vs-base control 0 rows |
| translation census 266 (strict) | ok 58, served outputs 827 | ok 58, served 827; **0 served outputs changed**; 5 scripts' refusal text only. Base-vs-base control 0 rows |
| notebook first-open | 1,897,262 B PASS | 1,897,262 B PASS (+0) |
| pine chunk / total JS | 351,458 B / 12,672,121 B | 353,925 B (+2,467) / 12,686,327 B (+14,206) |
| `paramIds.test.js` | 4 passed, 1 skipped | 4 passed, 1 skipped — **no edit** |

No corpus script moves: the only committed script that spells `time(timeframe.period)` in the one-argument form
(`mtf-watchlist-charts-anan`) refuses earlier on other walls, and none spells `time_close(<W|M>)`. What this lane
moved is what a member's own script reads, and what the three probes grade once their unrelated row is cut.

### Rails and mutations

`vendorHarness.c36TimeFollowups.test.js` (61 — the three new captures and the two C30 ones through the real member
door; the BTCUSD withholdings compared index for index against the capture's own dates), `ast/periodAnchorParity.test.js`
(70) with `tests/test_ast_period_anchor_parity.py` (74) over one fixture of 52 cases, `engine/__tests__/chartClockNotice.test.jsx`
(14 — the real binder over the recording chart, the real strip, asserted as rendered text),
`vendorHarness.c30TimeAnchor.test.js` (27, re-pointed: one row cut instead of three, T05 / T06 graded),
`clockCloseTfChange.vendor.test.js` (K14 / K15 re-pinned with the reason in the test).

**63 mutations, each run alone, each RED, each restored by bytes with the sha verified and `git status` clean for the
file** (run on `98ef9af9f`, before the last wave-9 merge, which did not touch the mutated lines):

| group | mutations |
|---|---|
| weekend / every-day / session (JS, 9) | one-weekend-day charts served; an every-day period answered from its first bar; a bar across a clock change served; a session period not opened by the calendar's first session served; the first-month condition dropped; **the week starts Sunday (C30's M5: 24 tests red, the BTCUSD rows among them)**; a blank clock read as "no weekend bars"; a four-month quarter; an every-day chart treated as a session chart |
| the named reason (JS, 17) | the mask names nothing; non-daily not withheld; a read of other bars not withheld; the early whole-series return removed; the plot lane, the column map, the trees-form and the graph-form object lane each dropping the reason; the binder not publishing plots / drawings; a departed instance, the disabled engine and a release each keeping the sentence; the store answering for every instance / emitting nothing; the strip not rendering / disclosing a hidden instance |
| `time(timeframe.period)` / `time("60")` (JS, 8) | a third timeframe admitted; an unmeasured chart not withheld; never recognised; `"1H"` served as `"60"`; the told-chart, screen and request refusals removed; the gate removed |
| `time_close` (JS, 10) | served with weekend bars; served off a daily chart; a period with no last-session bar served; the forming period withheld too; `"3M"` handed to the resampler; the gate removed; never recognised; the CLOSED period read (`tf` for `tf_live`); the screen and told-chart refusals removed |
| the Python mirror (19) | the mask not applied; the early return removed; each arm removed in turn (one weekend day, non-daily, own-time, nested, calendar-first, clock change, session open, first month, period end, `time_close` weekend / non-daily, blank clock); reach forced to 0; the week key drifting from JS; a third timeframe; Saturday not a weekend day; nothing named |

**M5, specifically.** At C30 a Sunday-first week survived because SPY's Monday..Friday bars group identically under
both keys. The rail now holds that as a stated fact (the two keys open a week on exactly the same bars over 900 and
8,473 sessions) AND kills the mutation on TradingView's numbers: on BTCUSD the vendor's new-week event agrees with
the Monday-first key on 5,490 / 5,490 bars and with the Sunday-first key on fewer than 3,990.

### Left for the integrator

1. **An every-day clock.** On a 24×7 symbol's daily chart this engine's `time` is 13.5 / 14.5 h off the vendor's on
   every bar, bare `time_close` is wrong on every weekday bar and blank on every weekend bar (Q07 on the BTCUSD
   capture: 3,786 value mismatches, 1,705 blank — at base, not this lane's), and `hour` / `minute` read 9 / 30.
   Stamping such a bar at 00:00 UTC, with calendar fields from the date key, would lift `time-anchor:utc-day-clock`
   and `time-close:weekend-bars` and correct bare `time` / `time_close` there. It touches `barOpenInstant`'s four
   JS call sites, `compute_clock`, and the clock parity fixture — its own lane.
2. **A calendar-read anchor for W / M on a session chart** (`tf_live(<W|M>, time)`, 4,800 / 4,800 and 900 / 900):
   serves the first partial period and the Sandy week; changes C30's tree and its repaint label.
3. **`timeframe.change("W")`** (C8's `weekfirst` column) marks a new week on the Monday bar of a weekend-bar chart.
   That is now the witnessed week start; the column itself was not re-measured on BTCUSD (`vw-time-tf` plots
   `ta.change(time("W")) != 0`, not `timeframe.change`) and is unchanged.
4. **A quarter / year resample** would serve `time_close("3M" / "12M")` — and `time_close(timeframe.period)` is
   witnessed and unserved.
5. **The lookback disagreement** above.
6. A named refusal at alert arm / `assert_scannable` for a tree the mask withholds whole (the Python sink carries
   the code): today such an alert is admitted and reads "no number" forever, which is honest and quiet.

## C38 — a per-bar history index in a plot, and a colour's components as values (2026-09-30, step 49)

Branch `pine/c38-plot-offsets`, merged with wave 9 at `19bcbf278` through two merges (`acac0a2b2`: C29-C33; `b263db477`: + C36) (C29 + C30 + C31 + C32 + C34 + C35).
C29 named it: the object lane and the VM answered `x[e]` with a per-bar `e`, the plot lane refused
`pine:offset-literal`, so the two probes that witness the rule were INCONCLUSIVE at the door. The same
for `color.r(c)` in a plot (`pine:colour-value`) and `vw-gradient`.

**(a) The read.** `closedTable.json::barsAgo(source, offset, period)`: the count is a column, the buffer a
LITERAL third argument, and the declared lookback is that argument — `maxLookback` is still a tree sum and
the `offset` node stays the only spelling of a constant offset. The rule is C29's rule 7 and is stated once,
`interpret.js::historyBackOf` / `historyReadable`; `objectRuntime.js` asks the same two functions in both
of its reads (the mutation proof found it holding a second copy of the `na` rule — fixed, `306db6c30`).
`pine.js::Resolver.historyReadOf` writes it:

| question | answer |
|---|---|
| the buffer | the script's `max_bars_back`, else `AUTO_MAX_BARS_BACK` — the existing constant, through `declaredMaxBarsBackOf`, the one reader both lanes use (it was a closure inside the object builder) |
| …tightened | never more than the index can take: an interval walk over the canonical tree (`historyBackRange`) — a literal, `na`, `barindex`, negation, `+` / `-`, `?:`, `mod`, `min` / `max` / `nz`, and this table's own `highestbars` / `lowestbars` / `barssince`. `close[cond ? na : 1]` asks for 2 bars, `bar_index[-ta.lowestbars(low, 100)]` for 100 under a declared 5,000 |
| past the caps | a buffer above the lookback budget (960) refuses `budget:lookback` at the member door; nothing is served short |
| a count that cannot be read (negative, fractional, at or past the buffer) | not computable on that bar, and the ROOT is withheld on every bar within `maxLookback(root) − maxLookback(read)` of it (`interpret.js::historyReadMask`; from the first such bar on under `cum` / a recurrence; the whole tree under `tf` / `sym`). `na(x[e]) ? 1 : 0` would otherwise answer a confident 1 |
| a read before the first bar held | withheld the same way — TradingView holds earlier bars and answers a value (`vw-mbb-auto`: 225 of 300 reads land before the capture's window). Only when the series starts at the listing is it Pine's `na` |
| the object lane | `withheldReadMask` (C30's anchor mask and this one, one channel) is merged into `unknownMask`, so an object reading such a tree is withheld, never drawn off a `NaN` |
| Python | `ast_interpret._fn_bars_ago` and `history_read_mask`, applied at `interpret`'s root like C12s's mask. Two corpus cases (`bars_ago_*`) agree with the JS lane on every bar, the withheld ones included |

⚠️ **Found on the way, a wrong bar waiting to happen:** `parseOffsetIndex` consumed a leading `-` and dropped
it for any non-literal index, so `bar_index[-FL]` parsed as `bar_index[FL]`. Harmless while every such index
refused or folded; with a per-bar index served, every count of the commonest idiom (`x[-ta.lowestbars(…)]`,
fib-retracement line 74) would have been negative. The sign now stays with the expression; a CONSTANT
negative index refuses `pine:offset-negative` (`n = 3` / `close[-n]` used to read `close[3]`, an offset Pine
itself rejects — no corpus script does it).

**(b) The colour.** `Resolver.colourComponentOf` → `witnessedColourOf`: a Pine colour name, a six-digit
literal, `color.rgb` of literals, `color.new(<fixed>, <literal>)` fold to the number (`hexToPacked` packs,
`unpackColor` reads, `byteTransparency` is `color.t`); `color.from_gradient(value, lo, hi, A, B)` between two
fixed colours over literal bounds is `runtime/colours.js::gradientChannelTree` — `fromGradient` written as a
canonical tree, node for node in the same order, beside the function; `color.new(<that gradient>, t)`
replaces the transparency only. The formula therefore exists twice, and `colourComponents.test.js` holds
the two together: 2,001 points × 4 ranges × 5 endpoint pairs × 4 components, exact equality, clamps included.
A colour itself is still not a column.

**The probes, graded by the harness itself** (`gradeCapture`: the real member door, the real comparator;
`vendorHarness.c38HistoryRead`, `vendorHarness.c38ColourValue`):

| probe | as captured (300 bars) | on TradingView's whole history |
|---|---|---|
| `vw-offset-na` | 5 of 6 rows MATCH; `E00` is `bar_index` itself (vendor 8175, this window 0) | **MATCH**, 6 / 6, 300 / 300 bars each, no warm-up excuse |
| `vw-mbb-auto` | `M00`, `M01` diverge on `bar_index`; `M02`, `M03` INCONCLUSIVE (a 400-bar reach on 300 bars) | **MATCH**, 4 / 4 — offsets 0 … 399, 225 of them onto bars before the probe's window |
| `vw-gradient` | graded (was refused): every row is keyed on `bar_index` | unedited: the 12 rows the pane carries MATCH, the rest are its row ceiling (5) and hidden-constant rule (6). Cut in two halves, the six constant rows carried with `+ close * 0`: all **19 component rows MATCH** on 300 bars |

"TradingView's whole history" is not synthesised: `vw-bool-cast-spy-1d-2026-09-28` holds all 8,473 daily SPY
bars from the 1993 listing (`history.startsAtBar0`), and `c38Joined.js` joins the 8,175 that precede the
probe's window in front of it. The join proves itself — it throws unless the probe's first bar lands at the
index the vendor's own `bar_index` column prints — and with it `bar_index` is the vendor's, the series is
from the listing, and the probe's source needs no edit. `G22` (`plot(v, color = g1)`) is the one row not
MATCH there: its values agree and its colour is the pane's own — a gradient as a plot COLOUR is not carried
(R-G keeps the line); named in the rail, not this lane's.

**Corpus (translation census, 266, strict).** `pine:offset-literal`: 2 scripts → 1. **smarter-snr** moves
past it (`time[x2Bar_]`, line 199); its next wall is `pine:builtin` `str.length` (line 17), then the
`pine:window` on `ta.highest` (line 76) it already had. **smart-money-concepts-by-welotrades** stays:
`high[length]` with `length` a function parameter is a window that did not fold, not a per-bar read (its
first wall is `pine:function`, line 250). `pine:colour-value`: 0 scripts before and after — the five corpus
scripts that spell `color.r/g/b/t` use them inside colour arithmetic for a drawing colour, which the colour
readers already fold or the object lane owns. **fib-retracement**: its object program keeps 16 line creates
it dropped (`create:line`, the `bar_index[-FL]` anchor); it is still refused at the door
(`pine:object-removal-lost`), so nothing new is drawn.

**Measured** (base `45859e598` → tip, same commands, same box, after-measurements on the merged tree):

| | base | tip |
|---|---|---|
| 47 captures, pane on: objects MATCH / overall / families / plots | 30 / 27 / 233 of 266 / 161 of 172 | unchanged, 0 entries |
| 47 captures, pane off | 18 / 15 / 107 of 119 / 140 of 151 | unchanged, 0 entries |
| committed harness dir (117 files), on: objects / overall / plots | 62 / 46 / 343 of 417 | **65** / 46 / **350 of 450**; changed entries: the three probes (INCONCLUSIVE-refused → graded) |
| committed harness dir, off | 50 / 34 / 322 of 396 | **53** / 34 / **329 of 429**; the same three |
| member-door census 266 × both flags | attach 41 / 64 | 41 / 64; 1 row per flag (smarter-snr's refusal sentence); base-vs-base control 0 rows |
| translation census 266 (strict) | ok 58, served outputs 827 | ok 58, served 827; 5 rows: smarter-snr (above), fib-retracement (object program), three whose `pine:function` sentence lists the table's names (`barsAgo` joined the list) |
| notebook first-open | 1,897,262 B PASS | 1,897,262 B PASS (+0) |
| pine chunk / total JS | 353,925 B / 12,686,331 B | 362,069 B (+8,144) / 12,694,339 B (+8,008) |
| `paramIds.test.js` | 4 passed, 1 skipped | 4 passed, 1 skipped — no edit |

**Refused by name, and what settles each:**

| what | guard | settles it |
|---|---|---|
| a per-bar index on the screener lane | `pine:offset-literal` | a ruling, not a capture: the mask is at both interpreters' roots, but a saved scan is compared across symbols and a withheld bar reads as "no match" |
| an index that moves only with `barstate.*` (`x[barstate.isrealtime ? 1 : 0]`) | `pine:offset-literal` | the rule was measured on closed bars; a capture of this probe on a FORMING bar. ⚠️ Serving it also carries `high_engagement__20-ehlers-fisher-transform` one wall on (to `pine:state`), which mints its `Length` input — an append to `docs/pine/param-ids.json`, an owner-ruled act. One arm in `historyReadOf` to delete once ruled |
| `max_bars_back(x, n)` (the per-series call) | `pine:offset-literal` | a probe of that call (no capture measures a per-series buffer) |
| a source the script reassigns | `pine:state` | the end-of-bar value of the name, which the column lane does not hold at a read site |
| an index over inputs only that the window fold cannot reduce (`x[rep ? 0 : 1]` at the member door) | `pine:offset-literal` | the window fold learning a constant-test ternary (C9's), not this read |
| a buffer above the lookback budget (an unbounded index under `max_bars_back = 5000`) | `budget:lookback` | budget ruling (not raised) |
| a declared buffer OVERRUN (count ≥ `max_bars_back`) | — | Pine stops the script; the object lane stops its run, the plot lane withholds the bars within reach and draws the rest. A probe that overruns a declared buffer would say what TradingView shows |
| `color.r/g/b/t` of an eight-digit literal, an `input.color`, a per-bar transparency, a ternary of colours, a gradient over per-bar or empty bounds, a gradient between gradients, a user colour helper | `pine:colour-value` | a `vw-gradient` row for each (the probe asks none of them) |

**Mutations** (29 run, each red on its own, each restored by bytes with the sha and `HEAD` blob verified,
`git status` clean after): the `na` rule, the buffer comparison, the read itself, the mask, the pre-window
withholding, the reach, a typed bound in place of the constant, the declared buffer, each of the five
named refusals, the bound tightening, the swallowed sign, the negation's interval, the constant-negative
name; the tree's truncation, its transparency blend, its clamp, `fromGradient` moved without the tree,
an eight-digit literal, `color.new` over a gradient, an empty range, the whole-number transparency; and
the four Python twins. ⚠️ Two SURVIVED on the object-lane rail on the first run (`c29NaReads` stayed green
with the shared `na` rule and the shared buffer comparison moved) — that is what found the second copy in
`objectRuntime.js`; both are red there now.

**Left for the integrator.** (1) `bar_index` at the door is the loaded window's own index: on any chart
that does not start at the listing it is not TradingView's, and it is what keeps all three probes (and
`vw-ne-na`, `w4-cross-round`) from MATCH as captured. It is a served wrong value, not a refusal, and was
there at base. (2) The `barstate.*` arm above (a parameter-map append). (3) The object lane's `{v:'at'}`
still answers `na` for a read before the first bar held; the plot lane withholds it unless the series
starts at the listing. Same rule for which bar is read, a different answer for a bar we do not hold —
aligning the object lane moves C29's `vw-mbb-auto` rail (its labels at `na`), so it was not done here.
(4) `G22`: a gradient as a plot COLOUR in the columnar lane (300 bars gold where TradingView draws the
gradient); `gradientChannelTree` is the arithmetic it would need.
## C42 — a call that runs exactly ONCE reads what TradingView reads (2026-10-01, step 52)

Branch `pine/c42-conditional-calls`, base `19bcbf278c` (wave 9 after C33 + C29–C36). The capture `vw-fn-series-history-rddt-1d-2026-09-30` was taken for C34's refusals and verified row by row against its own bars before anything was served (`vendorHarness.c42OneExecution`), plus ema-ribbon's cell (2,3) — `maxSpread = ta.highest(spread, 50)` under `if showTable and barstate.islast` — whose glyphs are TradingView's.

**The rule, in the object lane only** (`objectFnInline.js` + `pineObjects.js` + `pine.js`). Under a guard that is PROVABLY `barstate.islast` (alone or as a top-level `and` conjunct) and in no loop:

| row | witnessed answer | moves to |
|---|---|---|
| S01, S03–S06 `volume` / `time` / `hl2` / `hlc3` / `ohlc4` `[k]` (k = 5, 40, 200) | the chart's own value k bars back (15 / 15) | `CHART_SERIES_WITNESSED` |
| S02 `bar_index[k]` | `na` at all three offsets | `CALL_OWNED_SERIES` |
| C01 a body local `x[1]` (`x = close * 2`) | `na` (every-bar: 290.72) | still refused — `na`, witnessed |
| C02 a parameter `src[1]` (`f_call(close)`) | `na` (every-bar: 145.36) | still refused — `na`, witnessed |
| C03 `ta.sma(close, 3)` | `na` (every-bar: 143.6267) | `ONE_EXECUTION_IS_NA` (length ≥ 2 literal) |
| C04 `ta.highest(high, 10)` | 151.8899 — the last bar's own high (every-bar: 161.67) | `ONE_EXECUTION_WINDOW_IS_SOURCE` |

Mechanism: `guardIsLastBarOnly` is the all-of-four fail-closed test (`or` / ternary / `not` / brackets refuse). `oneExecutionTokens` rewrites the three witnessed shapes and leaves everything else; a `ta.*` left standing is marked `onceUnwitnessed` and refuses by name where the value is read (`Resolver.resolveCall` + `textNodeOf` guard). A helper called once is inlined through `oneExecutionBody` with the SAME rewrite. In a block that runs once, a `:=` to a `ta.*`, a `var` written from one, and a block local bound to a VALUE function that reads its own history (`callHistoryFunctions`) all carry the mark on the chain's `foldIfChain` + state-reassign paths; the runtime lane never answers a value that reads a condCall (`rtCondTainted`) or a statement read as its one run (`onceLines`). ⛔ Every other varying guard keeps C31's refusal, and C34's refusals stay named for an unwitnessed series.

**What is REFUSED, with the capture that would settle it:** every other `ta.*` on its first run (`ta.lowest`, `ta.ema`, `ta.rsi`, `ta.atr`, `ta.change`, `ta.stdev`, `ta.cum`, the one-argument `ta.highest(length)`, `ta.sma(close, 1)`); `bar_index[k]` under any guard that is not provably `barstate.islast`; `time_close[k]` and `hlcc4[k]` (not in the probe); an offset of 0, a non-literal offset or length. Probe queued: `tools/visual_conformance/probes/vw-call-site-history.pine` + `docs/pine/capture-queue-2026-09-30-call-site-history.md` — the other `ta.*` on their first run, `bar_index[k]` beside `bar_index - k`, `time_close[k]` / `hlcc4[k]`, an offset of 0, and MANY executions (a block and a helper under `close > open`, a block on every other bar) plotted beside the every-bar values. The runtime-lane probe fully supersedes C34's `vw-fn-series-history` queue.

**Found on the way, fixed here:**

- The C31 `invariantNames = barInvariantNames(stmts, ...)` read ran above `let stmts` (temporal dead zone), its `catch` answered `null`, and every guard was taken to vary — so a `ta.*` local under an `input.bool` guard was refused where it should have inlined. Read on first use now.
- A bare `input(<literal>, ...)` whose default is a number, a string or `true` / `false` written into the call is a simple input (fixes a block in `smart-money-concepts-by-welotrades` whose `show_equal_highlow = input(true, ...)` guards four EQH / EQL drawings).
- A `var` written from `ta.*` under a varying guard is NOT marked; the mark exists only in a block that runs once (same script, whose second write under `barstate.isconfirmed and ...` was being lost).
- The clock functions `time(tf, session, ...)` / `time_close(tf)` and the calendar readers (`year` / `month` / `weekofyear` / `dayofmonth` / `dayofweek` / `hour` / `minute` / `second`) answer from the bar's own timestamp and are NOT the call's history (`PURE_BARE`): fn:conditional-history 540 → 383 across the 266 (mgi-levels 227 → 79, multi-timeframe-supply-demand 4 → 0, stop-loss clustering 2 → 0, power-of-3 3 → 0); no object program moved, each call stops on its real wall, named.

**Separately** — a `str.tostring(x)` with no format prints ten DECIMALS, not ten significant digits (`objectRuntime.js::formatNumber`): the two captures of 2026-09-30 print `151.5633333333` and `1.3333333333`. One-line change, its own commit (`8431f6533b`) so it is revertable alone; rail `vendorHarness.c42DefaultDecimals`.

**Corpus (translation census, 266, base = wave9 at 19bcbf278c + the evening captures, tip = merged branch):**

| | base | tip |
|---|---|---|
| `fn:conditional-history` refusals | 540 (11 scripts) | 383 (8 scripts) |
| served plot outputs changed | — | 0 |

Rows changed: ema-ribbon (+1 nops, strength-bar cell now served), ict-institutional-order-flow / smt-divergence-ict-killzones / ict-killzones-pivots-tfo refusal sentences (first-call pointer moved; same count), mgi-levels / multi-timeframe-supply-demand / power-of-3 / stop-loss-clustering helpers inline now and their drawings refuse on `guard:*` (unchanged picture), advanced-custom-multi-ma-signals `+1 cell:text` on a cell already refused by another rail (translation census: no served output moved).

**Next walls for the top refused scripts (translation census, tip):**

| script | fn:cond-hist | first wall now |
|---|---|---|
| candlestick-patterns-on-backtest | 287 | `backtest()` reads `upRng1 = ta.highest(cand)` and `dnRng1 = ta.lowest(cand)` — its own call's state; called inside `if rw01c` / ... on every bar from `run()` and under scoreboard rows the capture did not probe. Needs a `ta.*` reading from the call's own state under many executions — the queued probe. |
| mgi-levels-suite | 79 | `addValueLine` / `updateLines` / `updateIntraDayLine` still read a BOX history via member-chain reads; a loop body also runs them per pass. The clock reads were the big win; the remaining 79 are the method-form `.set_x(time(...))` under a window-managed loop. |
| ict-institutional-order-flow-fadi | 7 | `FindImbalance` / `render` read `time[1]` / `high[1]` / `low[1]` as the call's history under `if IS.settings.show` — a METHOD guard the invariant-names walk does not resolve (`IS` is a user type parameter). The runtime lane admits none. |
| ict-killzones-pivots-tfo | 4 | `dwm_hl` calls `alert(...)` and the detector refuses the whole body on it; one `draw_open_price` call still reads `time`. |
| smart-money-concepts-by-welotrades | 2 | `check_fvg_func:ta.highest@1227` — the `and` block that calls it has `_supportRetestDetected :=` under a `pine:reassign` guard the walk cannot fold. |
| smt-divergence-ict-killzones | 2 | `f_draw_future` reads `ta.lowest(low, 500)` inside a function whose caller is `if show_kz` (a `bool` guard that varies at every pass of the surrounding loop). |

**Measured** (base `19bcbf278c` + captures vs tip, protocol items 1–6):

- 47 captures objects pane ON: objects MATCH 30 → 30, overall 27 → 27, families 233/266, plots 161/172. OFF: 18 → 18 / 15 → 15 / 107/119 / 140/151. No row changed.
- Committed harness dir (117) ON: objects MATCH **62 → 63**, overall **46 → 47**, families **315/350 → 322/357**, plots 343/417. OFF: **50 → 51**, overall **34 → 35**, families **189/203 → 196/210**. The one entry that flipped is `vw-fn-series-history-rddt-1d-2026-09-30`.
- Member-door census 266 × 2: 41 / 64 → 41 / 64, 0 rows changed; base-vs-base control 0 rows.
- Translation census (266 × 2, base-vs-base 0 rows): 9 rows changed, 0 served outputs changed.
- Notebook first-open 1,897,262 B at base and tip (+0, `notebook_perf_budgets` PASS); `pine` chunk 342,839 → 351,526 B (+8,687); total JS 12,662,104 → 12,670,787 B (+8,683).
- `paramIds.test.js` green, no edit.

**Rails and proofs:** `vendorHarness.c42OneExecution` (16 behavioural + 3 reach), `vendorHarness.c42DefaultDecimals` (3), `objectFnInline.test.js` (+21: `guardIsLastBarOnly` fail-closed cases, `oneExecutionTokens` reads, `taCallIn`, bare `input(...)` invariance, clock purity), `vendorHarness.c31Loops` and `vendorHarness.c34ChartSeries` re-pinned under the new rule. 29 mutations, each red alone, restored by bytes with the sha verified against the committed blob.

**Left for the integrator:** `advanced-custom-multi-ma-signals-emasmavwmavwap`'s `+1 cell:text` is a cell already refused by another rail (translation census: no served output moved); verified it does not come from `oneExecutionTokens`' rewrite. The next session should name the one cell and decide whether to admit it or leave it withheld.
## C43 -- a getter in arithmetic, a between-read, and a reached `runtime.error` draws nothing (2026-09-30, step 53)

### Fixtures that settle this

- `tests/fixtures/vendor/vw-int-array-avg-spy-1d-2026-09-30.json` -- the exact-float `array<int>.avg()`,
  no-format `str.tostring(avg)` prints `1.5` / `1.3333333333` / `1.6666666667` (ten decimals, trailing
  zeros trimmed), `"##"` rounds half AWAY from zero, `l.set_x2(l.get_x1() + a.avg() + 1)` drops the
  fraction (truncation, non-negative only).
- `tests/fixtures/vendor/vw-fn-series-history-spy-1d-2026-09-30.json` -- confirms the no-format text
  in prose at ten decimals (`151.5633333333`).
- `tests/fixtures/vendor/runtime/vw-runtime-error-spy-1d-2026-09-30.json` (control, not reached:
  ordinary 4,800-row study, 50 labels) and `vw-runtime-error-reached-spy-1d-2026-09-30.json`
  (reached: 0 data rows, 0 labels, status `User-defined error: Error on bar 100: UCTPROBE stop at
  bar 100`).
- `tests/fixtures/vendor/trend-duration-forecast-chartprime-rddt-1d-2026-09-28.json` and
  `.../average-day-range-adr-pivots-rddt-1d-2026-09-28.json` (the two 47-corpus entries this step
  moves -- ADR+pivots is C33's, pulled in through the wave-9 merge).

### Part A -- the getter-in-arithmetic and the between-read

- `pine.js::stateArith(node)` walks a getter-reading expression into a value reference the object
  program carries: `+`/`-` over two state operands, `int(x)` as `{v:'op',op:'trunc',args:[x]}`,
  `math.avg(a,b)` as half of their sum. Only emitted in `BAR_COORD_PROPS` properties
  (`x`/`x1`/`x2`/`left`/`right`) and always wrapped in a `trunc` at the property boundary -- a
  coordinate is a whole bar on Pine's x axis.
- `objectProgram.js` adds `OBJECT_VALUE_UNARY = ['-', 'round', 'trunc']` and exports
  `BAR_COORD_PROPS`; the live-text validator asks the shared `opReadsState` predicate that lives in
  `objectProgram.js` and is read by `objectRuntime.js::unsaidProps` -- one predicate, two callers,
  so the validator cannot admit arithmetic the runtime does not know how to mark. (The predicate
  was committed as a refactor: `538aa038b`.)
- `objectRuntime.js` serves `trunc` for a non-negative result (`Math.trunc`), returns undefined for
  a negative one and bumps `truncNegative`; the coordinate is then tainted through C17's
  per-property mask and the object is held, not drawn.
- `defaultNumberText(n)` prints ten decimals (`toFixed(10)`) with trailing zeros trimmed; this is
  the no-format `str.tostring` text throughout the two lanes.
- `windowReadBetween(m, stmts, writerStmts)` is the position predicate: past every writer and past
  every add-span. `resolveWindowReadBetween` returns `cOp('?:', [ran, 0/0, base])` and registers
  the `ran` tree as the ambiguity -- "an add ran this bar". `BETWEEN_READ_MEMBERS` =
  `{size, first, last, max, min, sum, avg}`; `BETWEEN_LITERAL_MEMBERS` = `{get, sizeAtLeast,
  sizeBelow}` for a literal argument only.

### Part B -- a reached `runtime.error` draws nothing

- `pine.js::runtimeErrorSitesOf(stmts)` enumerates every bare `runtime.error(...)` statement with
  the conditions each stands under as token lists and a `negate` flag; a call inside a function
  body, a switch arm, a loop body, a larger expression, or a condition whose block-set reads a
  name becomes an `unread` entry with its own `why`. The resolver resolves the conditions with
  `paramMint = null`, a no-op `noteSink`, no `onCondition`, and private `OTHER_SYMBOL_SINK` /
  `PERIOD_READ_SINK` so the translation's own records are left alone (reading the conditions
  **moves nothing else in the translation** -- three isolation rails below).
- Positive conjunctions flatten into factors (each tree stands on its own); a negative conjunction
  stays whole (the negation of a conjunction is not a conjunction).
- `runtimeErrorMessageOf(node, resolver)` captures the message as text and number parts;
  `defaultNumberText` prints the numbers at the stop bar.
- `runtimeErrorStop.js::runtimeErrorStopFor(def, bars, inputs, ctx)` is the host evaluator:
  invariant factor false -> not reached exactly; all-invariant-true + bare `isfirst` -> bar 0
  known; per-bar three-valued state over `unknownMask` + `periodAnchorMask`, with an off-listing
  warm-up of `maxLookback` (or every bar when a factor reads `bar_index` / `isfirst`); `barKnown`
  only on the listing with no unknown bars before.
- `nativeRegistry.astColumnsFor` returns no columns + `columnErrors[key] = {guard:
  'pine:runtime.error', message: stop.sentence}` for every plot; `objectColumns.objectReaderFor`
  returns null; the per-instance notice is published via `binder.js::noteRuntimeErrorStop` and
  cleared when the instance is removed, hidden or the binder is released; the strip under the
  chart reads it (`AttachedPineDisclosures.jsx::attachedRuntimeErrors`), the row leads the strip.
- `runtime/runtimeColumns.js` catches `err.name === 'runtime.error'`, stamps `err.bar = finished +
  1` and memoises the stop per bars array; `nativeRegistry.runtimeColumnsOrReasons` returns the
  same result through `runtimeErrorWords`'s one wording.
- `memberPaneDefinition.js` passes `guardInputs: true` to `builderInputs`;
  `builderInputs.js::withGuardInputs` returns a spec row for every setting a validation reads live
  that no drawn row carries, so the member sees it on their panel without the translation minting
  an id for it.

### Rails that pin this fix

- `vendorHarness.c43IntAvg.test.js` (9 tests) -- the exact-mean texts, `##` round-half-away, the
  truncated x arithmetic.
- `vendorHarness.c22TrendDuration.test.js` (4 tests) -- line and label-82 served; label id 2
  withheld by construction.
- `vendorHarness.c43RuntimeError.test.js` (16 tests, including three new isolation rails inside
  "reading the conditions moves NOTHING else in the translation": a validation-only input mints no
  parameter id; a period read by the validation is the validation's own and the plots' period
  record is untouched; a setting shared by a plot and the validation is one knob the member's
  value reaches both).
- `runtimeErrorNotice.test.jsx` (10 tests, including the runtime-lane control over the same
  wording).
- `objectWindowPositions.test.js`, `objectLostGeometry.test.js`, `objectSeriesWindows.test.js` --
  the between-read ambiguity (`addRan`) and the lost-geometry re-points.
- `vendorHarness.c18KClustering.test.js` -- uses `defaultNumberText` as the single text authority.

### Mutation proofs (42 mutations, each applied, run under a single vitest, restored by bytes)

**34 RED** -- each turns a rail only this fix guards:

- Part A (12 red of 13): A1 trunc->round; A2 negative-trunc served; A3 unsaid props not marked;
  A4 getter arithmetic not truncated to a whole bar; A5 between-read ambiguity dropped; A7
  validator admits state arithmetic in any property; A8 translator serves getter arithmetic as a
  price too; A9 ten decimals -> nine; A10 math.avg not halved; A11 between-read predicate always
  false; A13 the shared `opReadsState` answers no.
- Part B (22 red of 29): B1 plot lane ignores the stop; B2 object lane ignores it; B3 negated
  else-branch condition inverted; B4 `bar_index` off the listing trusted; B6 the known-false
  bar-free factor no longer settles; B7 the `isfirst` validation idiom not recognised; B8
  conjunction kept whole; B9 block-set-reading condition placed; B10 guard resolver mints params;
  B11 guard period read lands in the translation record; B12 guard-only inputs not declared; B13
  stamp dropped; B14 binder does not publish; B15 strip does not render; B16 runtime lane does
  not stamp the bar; B17 released binder leaves sentences behind; B18 bar number said when not
  known; B19 runtime-lane `PineRuntimeError` not an engine stop; B20 stopped runtime-lane
  document still draws its objects; B21 period read trusted on another timeframe; B25 bare
  non-statement call placed; B28 `barKnown` set unconditionally off the listing; B29 message not
  carried.

**8 GREEN(!)** -- unproven, recorded here rather than silenced:

- **A6**, **A12**, **B5** fire on a path that no fixture in this lane exercises today: A6 keeps
  the base in both arms of the ternary (the between-read is unused by the three published c43
  isolation rails and the trend-duration capture does not drop its `w.push` on a bar the window
  still holds); A12 leaves `int()` over a getter untruncated (the two live uses -- `+ 1` and
  `math.avg` -- route through other paths); B5 reads a folded setting at the default when the
  member has moved it (the three rails use defaults).
- **B22**, **B23**, **B24** fire in failure-only branches not reached by the current rails: the
  "not reached on held bars" named reason off the listing, the "no setting" refusal for a live
  guard the document does not carry, and the per-bar warm-up read as known.
- **B26**, **B27** fire on a path the fixtures cannot reach today: the "another symbol /
  timeframe" branch of the resolver (every captured runtime.error script already refuses on-door
  for a different reason, so the condition cannot be read) and the `islast` anchor outside the
  `isfirst` idiom (no corpus `runtime.error` call anchors on `islast`).

Each is a candidate for a dedicated rail; the fix is not pulled.

### Measurements (base `36f3c47d5` -> merged tip `f6acac4a9`, 47 captures, pane on)

| | base | merged tip |
|---|---|---|
| objects MATCH | 29 / 47 | **30 / 47** |
| overall MATCH | 26 / 47 | **27 / 47** |
| families | 227 / 266 | **234 / 266** |
| plots | 161 / 172 | 161 / 172 |

The two moved entries are C33's (ADR+pivots DIVERGE -> MATCH, high-low-open-mid-ranges labels
0 -> 504 of 504), plus Part A's own trend-duration-forecast lines 0 -> 1 of 1 and labels
26 -> 27 of 28 (label id 2 and one label text still refused by name).

Bytes: Notebook first-open **1,897,262 B** at base and merged tip (+0, PASS,
`notebook_perf_budgets`); `pine` chunk +18,833 B; total JS +5,117 B across 353 files.
`paramIds.test.js`: green with ZERO edits.

### Decisions left for the integrator

- `runtimeErrorStopOf(cols).unknown` and `meta.runtimeErrors.unread` carry per-call reasons for
  everything that could not be decided here -- but they are not surfaced on the member
  disclosure strip today (only reached stops are). An integrator may choose to render them,
  taking the strip's "pane is empty for one reason" idiom into account.
- Getter arithmetic in a `y` / `y1` / `y2` property stays refused by name -- truncation to a
  whole bar is a wrong value on the y axis. A future lane may serve a floating `y` from state.
- A negative `x1 + avg + 1` capture would settle whether `truncNegative` is the right wall:
  queued, not fabricated.
- Off-listing scripts whose `runtime.error` conditions read `bar_index` or `barstate.isfirst` as
  a value stay drawn as today and are NAMED unknown.
- The runtime-lane `runtimeObjectValues` stop withholds the computed VALUES only; the object
  program's static drawings still render.
## C40 — `for … in` over a held list, `<family>.all`, and the cap `while` on the host object lane (2026-10-01, step 50)

Branch `pine/c40-forin-collections`, base `45859e5983` (wave 9). The host object lane refused every `for … in`
and every `while` ("the loop is not executed"), so each delete-all helper, each per-element restyle and each
FIFO cap was a counted loss (`loopBlocked`) and the list behind it was diverged. Both shapes are loops the
object runtime can run pass by pass over lists it already holds. They are carried on the host passes only
(`hostLoops = !rawTrees && !iterTrees`); the runtime lane's own object pass keeps the program it had.

| what | rule (where it lives) | proof | refused, by name |
|---|---|---|---|
| `for x in <list>` / `for [i, x] in <list>` over a declared drawing list | reader `forInPlan` (`pineObjects.js`) → a counted loop `0 to array.size(list) − 1` marked `asc` (an empty list is `0 to −1`, which a counted `for` would run twice: the runtime runs none), whose first body op copies the slot into the loop variable's register as the pass starts (C16's `copy`); body ops in Pine's order; the op budget per bar is the existing one | `vendorHarness.c40ForIn`: on the committed trend-lines capture TradingView walked BOTH elements of `downtrends` and read the body's `if` per element of `uptrends`; our lane, walking the same lists, ends with TradingView's objects id for id; the control without the walks fails. `objectForInLoops` (delete-all, element + position, per-element condition, empty list, inside a helper) | a body that changes the list it walks — `array.*` write, the method spelling, a reassignment, the list handed to a helper (`forInRefused: the body changes \`x\`, the list it walks`); a loop variable that is another statement's name or another family's (top level; inside an inlined helper it is renamed per loop); a list of user types (not this lane's — the legacy refusal) |
| `for x in <window>` over a bounded numeric window (C32) | the element is bound as `array.get(w, <counter>)`, the per-pass read C32 serves (`wget`); `forInWindow` (`pine.js`) offers only a `vector` with a `.window` | `objectForInLoops`: one row per element in Pine's index order, push and unshift windows, against a hand replay of Pine's array | a body that writes the window |
| `for x in line.all` / `box.all` / `label.all` | program op `{k:'loop', over:{all}, elem}`; the runtime takes the family's live objects, oldest first (`vw-object-gc-d`), when the loop starts and hands them to the register one at a time; a family whose create was withheld is unknown (`famUnknown`) and the walk is withheld with everything it would write | `objectForInLoops`: a body that only moves them reaches every object; a body that never names the element runs once per object; trend-lines `f_clearAll` with none or one object | a position in `<family>.all` (`for [i, v] in …` reading `i`); a walk over TWO OR MORE objects whose body deletes or creates that family — the run stops, `OBJECT_UNWITNESSED`, nothing drawn (walking the entry list deletes all, walking the live list deletes every other one; no capture says which) |
| the cap: `while array.size(a) > N` → remove from an end | reader `capWhileOf`: the body is only end removals (`array.shift` / `pop`, bare, inside `<family>.delete(…)`, or `(array.shift(a)).delete()`), one removal of each array per pass, the measured list among them, the bound reading no length; program op `{k:'loop', cond, body}`; the runtime re-reads the condition before every pass and stops the run by name on a pass that did not shorten the list | `objectForInLoops`: three spellings; a burst of four in one bar is trimmed in that bar (an `if` removes one); `pop`, an expression bound, a second list kept in step; C17 — a cap over an unknown length, or with an unknown bound, deletes nothing and marks the list | a body with anything else (a nested `if`: smart-money-volume-activity); a bound this reader cannot compute (`loop:bounds`, the removal counted in `lostRemovals`) |
| the numeric window's cap written as a `while` | `arrayWindows.js`: a `while <size guard>` whose body only evicts is the `if` guard's eviction (the model adds at most one element on a bar it serves); each eviction is held to the `if` form's own rules | `objectWindowWhileCap` (5): push and unshift windows equal the `if` form element for element; two arrays in step | a body that does anything but evict; a `while` that does not shorten what it measures or shortens it twice (the eviction rules); the plot lane still refuses every read |

**H14 — two things that were wrong at base, found while reading the corpus's loops, fixed here:**

- A drawing list created WITH SLOTS (`array.new_box(3)`, `array.new<line>(5)`) was modelled as an EMPTY list.
  `array.set(a, i, box.new(…))` was then a no-op and `box.delete(array.get(a, i))` never deleted: a three-slot
  replace-in-place idiom drew 180 boxes over 60 bars where Pine holds 3, with a clean ledger. The list is now
  diverged at its creation (`collsDivergedWhy: coll:sized@<line>`), every read of it withheld and counted.
  `array.new_box()` and `array.new_box(0)` are empty in Pine too and are modelled as before (controls). No
  corpus script with a sized drawing list attaches at the member door, so no member chart changes.
- A statement that begins with `(` — `(array.shift(a)).delete()` — produced no op and no count. It is read as
  the postfix call it is.

**Per script (RDDT 1D where a capture exists):**

| script | capture | before | after | next wall |
|---|---|---|---|---|
| trend-lines-supports-and-resistances | yes | program empty; `box.delete` … `line.set_style` in `loopBlocked` (9) | `f_clearAll`'s three `.all` walks carried (6 ops attempted, 0 dropped); `box.delete` leaves `loopBlocked`; program still empty, verdict unchanged | every create sits in `for … in` over lists of user types (`uptrends` / `downtrends`, their `points`) or in a `while`: UDT lists are not this lane's. When the creates convert, `f_clearAll` over two or more objects is the unwitnessed row A04 |
| ict-killzones-pivots-tfo | yes | MATCH | MATCH, 0 entries changed | `for l in levels` is a list of user types — not walked |
| support-and-resistance-logistic-regression | no | unchanged | unchanged | `for curSR in allPivots`: a list of user types |
| renderingnature-smc-reversal-engine | no | no cap carried | `while array.size(historicalTrendlines) > maxTrendlines` carried (`loop:cap` 1, with its `delete` + `collremove`); the `eventLabels` / `zzLines` caps are read and sit behind their blocks' guards (`guard:loop` 2 → 13) | `guard:create` 33 (`pine:request htfPL`, `pine:text-value`, `pine:reassign`); the `f_delete*` helpers in loops |
| market-structure-break-order-block | no | lists diverged at `loop:box.delete` | four `forInRefused` (`for bull_ob in bu_ob_boxes` shifts the list it walks — F03) on lists created with five slots (`coll:sized` — Z01) | `pine:collection low_points_arr` on every create |
| htf-candle-footprint | yes | boxes 3 / 13 | unchanged | `HL` is a reduction over a loop-filled array (`HL.max()` after `HL.push(high[i])` in a counted `for`) — not this mechanism; R7 / the runtime lane |
| smt-divergence-ict-killzones | no | 28 ops read | 40: `for b in fut_boxes → box.delete(b)` ×2 and the `smt_lines` / `smt_labels` caps are read | `fut_boxes` diverges at `fn:conditional-history`@188; the caps sit behind `pine:collection` guards |
| elliot-wave-detector-pro | no | 60 ops read | 66: `for ln in fibLines` / `for lbl in fibLabels` in `drawFibLevels` | `pine:reassign primaryPivots` on the loops' guards |
| smart-money-breakout-channels-algoalpha | no | 17 | 20: `for ln in gaugeLines → ln.delete()` | `pine:type boxes.size` |
| volume-footprint-measuring-classical-indicators | no | 76 | 82: `for ln in profImbLns` / `for mlb in profMrgLbs` | the pushes sit behind `pine:reassign profLo` and in a counted loop |
| smart-money-concepts-by-welotrades | no | 1019 | 1031: `display_limit_boxes`' cap | the lists are pushed under unknown guards |
| trendline-pivots-quantvue | no | 6 | 34: `for l in utlArray` / `dtlArray`; `tempUtl` … are sized lists (`coll:sized`) | `pine:reassign utlY1`, `pine:undefined src` |
| stop-loss-clustering-breakouts | no | 47 | 51: `for data in gradXRAY` — a sized list (`coll:sized`) | `fn:conditional-history`, `fn:return-type` |
| auto-trendline, dual-view, smart-money-volume-activity, renko | — | unchanged | unchanged | a list alias; a cap that is a reassigned block local; a nested `if` in the cap body; `pine:collection` |

Scripts with no capture are ungraded. They are queued, with the probe, in
`docs/pine/capture-queue-2026-09-30-forin-collections.md`.

**Refused, and what would settle each** (probe `tools/visual_conformance/probes/vw-forin-collections.pine`,
NYSE:RDDT 1D):

| what | rows | would settle it |
|---|---|---|
| a body that changes the list it walks (shift / push / set) | F03, F04, F05 | 5 passes and nothing left ⇒ the walk is over the list as it stood at entry; 3 passes ⇒ over the live list. Either can then be built from `bodyMayWriteList` |
| `for b in box.all → box.delete(b)` over two or more | A02, A04, A05 | 4 passes and 0 left ⇒ delete the `items.length >= 2` stop (one line, `objectRuntime.js`); 2 passes ⇒ serve the live reading |
| a position in `<family>.all` | A06 | texts `0, 1, 2` oldest first ⇒ serve the counter where no create of the family was lost |
| a drawing list created with slots | Z01–Z03 | size 3 on every bar and three labels held ⇒ model the creation size as that many `na` slots and lift `coll:sized` (a literal size first) |
| controls for what is served | F01, F02, W01 | must read 5 / 0 / 2 or the capture is not read |
| a list of user types (`for p in points`) | — | not a capture question: user-type fields are not modelled on the host lane |
| numeric accumulators, `HL` | — | ruling R7; the runtime lane |

**Measured (base `45859e5983` → tip, each on the same machine, the same day):** the 47, objects pane on:
objects MATCH 29 → 29, overall 26 → 26, families 227 / 266 → 227 / 266, plots 161 / 172 → 161 / 172; pane off:
18 / 15 / 107 of 119 / 140 of 151, unchanged; 0 entries changed in either state. Committed harness dir (104
graded): on 57 / 45 / 304 of 343 / 316 of 379, off 46 / 34 / 184 of 196 / 295 of 358, unchanged, 0 entries.
Member-door census 266 × 2: attach 41 / 64 → 41 / 64, 0 rows (base-vs-base 0 rows). Translation census
(266 × 2, base-vs-base 0 scripts): no plot tree, formula, refusal or parameter map moved; object programs or
their diagnostics changed in 9 scripts (the table above), none of which attaches at the member door. One
member-facing sentence moved: trend-lines' partial-drawing notice no longer lists `box.delete`
(`partialDrawing.test.jsx`, re-pinned with the reason). Notebook first-open 1,897,262 B at base and tip (+0,
`notebook_perf_budgets` PASS); `pine` chunk 342,839 → 350,030 B (+7,191), `StockChart` +1,862 (the runtime),
`bind` +1,414 (the program door): total JS +10,467 B. `paramIds.test.js` green with no edit.

**A side effect in the main walk, sentences only:** a numeric window the lane models (`vector` with a
`.window`) is no longer condemned by a loop that writes it through the cap (`loopWritesModelled`, `pine.js`).
It changes which refusal a plot-lane read of such an array names; the plot lane still refuses the read, and
the translation census shows no plot, refusal class or parameter id moved.

**Rails and proofs:** `objectForInLoops.test.js`, `objectWindowWhileCap.test.js`,
`vendorHarness.c40ForIn.test.js` — 58 tests. Forty-four mutations, each red alone against those three files,
each restored by bytes with the sha-256 verified and `git status` clean after every batch: the list walk off;
`asc` dropped in the reader, the converter and the runtime (three); the element copy off; each of the four
ways a body can change its list unseen; the loop-variable take-over; the per-loop rename; the `.all` position
read; a loop under an unrun loop; an empty body kept; the window element unbound / not offered; the
unwitnessed stop off, a delete not counted as a change, the stop still drawing; `famUnknown` not set, not
read, marking nothing; the cap unrecognised, two removals of one array, a cap that never shortens its list, a
bound that reads a length, an unreadable bound kept, a non-shortening pass running on, a cap over a tainted
length, the cap condition unread for ambiguity; the six program-door checks; sized lists (three); the
`(`-leading statement; the window `while`; the main-walk exemption; the runtime lane's own pass handed the
loops. Guards the first pass of mutations could NOT turn red were removed or restated rather than kept
(a nested-block check the parse already makes, a duplicate `!rtLoop`, an unreachable missing-register branch, a
register line `scanUse` already covers, `!inLoop` on the loop arm, a second count in the cap reader, two
checks the eviction rules already make — commits `0a5906f283`, `f5b692b322`, `e7a1336646`).
Re-pins: `objectFnInline.test.js` (C34's pin that `.all` deletes were `loopBlocked`, now carried; a user-type
list control added) and `partialDrawing.test.jsx` (above).
## C37 — colours this door did not carry, and colour graded as its own column (2026-10-01, step 48)

Branch `pine/c37-colours`, measured on wave 9 at `19bcbf278c` (C29–C36) merged into the lane. Ruling R-G:
an uncarried plot colour keeps its line; the fix is to CARRY the colour, and colour is graded as its own
column so the defect stays counted.

**The column (new instrument).** The harness verdict already carried the plot half (`stats.colorCompared` /
`colorMismatches`). It had no object half: `compareObjects` reads counts and texts, so a drawing in the wrong
colour graded MATCH. `vendorHarness/colourColumn.js` pairs every live object with the capture's own record by
value (a line's two prices, a label's text and price, a box's two prices, a cell's table / address / text) and
reads each colour slot as `agree`, `agreeByDefault` (the script names no colour and our default is the
vendor's), `notCarried` (the script names one, we carry none, the default standing in is not the vendor's),
`carriedDiffers`, or `themeRelative`. `colourCensus.measure.test.js` runs it over a directory (opt-in,
`PINE_COLOUR_CENSUS=1`, asserts no count).

⚰️ Two instrument errors found before anything was believed: a vendor object colour is a palette INDEX into
`palette_common` wherever the compiler could enumerate the study's colours (22 of the 47 captures) and a
packed `0xAABBGGRR` otherwise — read as packed, the first run reported 1,316 manufactured mismatches; and the
plot census's "uncarried" flag keyed on a title that is `null` for an untitled plot, so RVOL's line read as
carried.

**Measured at base (`19bcbf278c`, objects pane on), ranked.** Plots, 47 graded: 40,278 bars compared, **0**
differ — no graded plot's colour was uncarried. Committed harness dir: 971,741 compared, **611** differ, all
RVOL's line. Objects, 47 graded: 3,406 paired slots, **349 not carried**; harness dir: 4,598 slots, **887**.

| capture | slots | what the script writes | mechanism |
|---|---|---|---|
| vw-object-gc-b / -a / -c | 162 / 73 / 24 | nothing — label text, box fill, box text unset (v5) | the version's default |
| makuchaku FVG | 102 | `color.new(color.black, boxTransparency)`, an input | `color.new` with a computed transparency |
| contraction-box | 78 | `var color LineColorInput = input.color(…)` | a `var` never reassigned |
| artemis | 49 | `color.new(thOb, 100 - divRegAlpha)`, `color.new(thOb, isLight ? 55 : 45)`, tint helpers | the same, through names and a helper |
| heat-map-seasons | 28 | `i < 15 ? color.from_gradient(i, 0, 15, …) : color.from_gradient(i, 15, 30, …)` in a `for` | a gradient per pass |
| rsi-swing, fibonacci-pivots | 21, 7 | nothing — line colour, label colour and text unset (v4) | the version's default |
| zero-lag | 21 | `color = color(na)`; `text_color = chart.fg_color` | `na`; the theme |
| trend-duration, market-structure, ict-killzones | 20, 16, 6 | `chart.fg_color` / `chart.bg_color` | the theme |
| ema-ribbon | 9 | `text_color = f_trendClr(bull, bear)` | a one-expression colour helper |
| htf-candle-footprint, position-size-calculator, htf-liquidity, keltner-cog, vdubus | 5, 4, 3, 1, 1 | `border_color = color(na)`; `na` through a helper; unset cell / label text (v5) | `na`; the version's default |
| **rvol (plot)** | **611 bars** | `plot(rvol, color = color.new(color.from_gradient(rvol, 0.5, 2, dnv, upv), 0))` | a gradient as a plot colour |

**Why RVOL was still gold after C29.** C29 served `color.from_gradient` to the lanes that compute a colour as a
VALUE (`runtime/colours.js::fromGradient`, the runtime VM). A plot's colour is not a value there: the plot
lane holds a static colour, a two-colour test or a palette index, and a gradient is none of them, so the rule
was never asked. Not a wiring slip — a missing shape.

**What is carried now.**

1. **A gradient as a plot colour** (`pine.js::colourGradientRule`). The position `(value − bottom) / (top −
   bottom)` is one numeric tree, resolved like any series and carried as a hidden column exactly as a
   two-colour test or a palette index is; the two ends ride as static strings (`colorGradient: {from, to,
   transparency?}`, validated by `defSchema`). The renderer hands the column to `fromGradient(w, 0, 1, a, b)`,
   so the measured curve has one implementation. `color.new(<gradient>, t)` with a literal `t` sets the
   transparency. The rule resolves with the parameter mint withheld (R36).
2. **Object colours, on the host lane** — `color.new(c, t)` with a computed `t` (`{c:'new'}` over a per-bar
   tree: an input stays the member's knob); a `var` seeded with one colour and never reassigned anywhere in the
   script; a one-expression colour helper read with the call's arguments in place; `na` / `color(na)` as the
   absent colour (`#00000000`, TradingView's own record); `color.from_gradient` as `{c:'grad'}` (three value
   references, two colour nodes); and a colour `if` whose test is on the loop counter (`{c:'if'}` over a pass
   condition — `objectProgram.js::isPassCondition`: comparisons and boolean operators over the counter,
   constants and per-bar trees, never object state).
3. **The defaults that depend on the Pine version** (`objectDefaults.js`), each read off a capture whose script
   leaves that colour unset: v4 `color.blue` (`#2196F3`) for a line and a label, `color.black` label text; v5
   `color.black` label text, an OPAQUE `color.blue` box fill, `color.black` box and cell text. A program states
   `pineVersion` only for v4 / v5, so every other program keeps its bytes.

**`chart.fg_color` / `chart.bg_color` — the rule.** They are the colours of the chart the script runs on, so
neither can be folded when a script is translated. `objectTheme.js`: the translator carries the Pine name as a
REFERENCE (with the transparency a `color.new` set on it); it is resolved where the object is drawn, against
that chart's own settings — foreground = the chart's text colour, background = its solid background — and the
objects repaint when either changes. ⛔ TradingView's theme colours are never hard-coded: the captures record
its light theme (`#0f0f0f` on `#ffffff`), and the same script is correct here in OUR chart's colours.

**Grading: theme-relative, not a mismatch.** A slot carried as a theme reference is counted `themeRelative`
and is not compared with the capture's colour. What the capture still grades, and `vendorHarness.c37Theme`
asserts: WHICH slots are the theme's and which of the two — every foreground reference sits where TradingView
drew its foreground, every background reference where it drew its background — and that the slots beside
them still agree colour for colour.

**Measured** (wave 9 `19bcbf278c` → merged tip; one vitest process at a time).

| | base | tip |
|---|---|---|
| 1. 47 captures, objects pane on: objects MATCH / overall / families / plots | 30 / 27 / 233 of 266 / 161 of 172 | unchanged, 0 entries moved |
| 1. flag off | 18 / 15 / 107 of 119 / 140 of 151 | unchanged, 0 entries |
| 2. committed harness dir (on): objects / overall / plots | 62 / 46 / 343 of 417 | 62 / **47** / **344** — `rvol` DIVERGE → MATCH, the only entry (both flag states; off: overall 34 → 35) |
| colour column, plots (harness dir) | 611 of 971,741 bars differ | **0** |
| colour column, objects, 47 | 349 not carried of 3,406 slots | **0** not carried · 42 theme-relative · 1 carried and different |
| colour column, objects, harness dir | 887 of 4,598 | **0** · 55 theme-relative · 1 |
| 3. member-door census 266 × 2 | attach 41 / 64 | 41 / 64; **1 row**: `rvol` plots 2 → 3 (its position column). Base-vs-base control: 0 rows |
| 4. translation census 266 | served outputs 733; `colorDynamic` 99; dropped colour props 287 sites | 733, values byte-identical in all 266; 1 output's presentation moved (rvol: `colorDynamic` → `colorGradient`); 98; **103** sites (32 scripts, 13 of them door-attached). Programs with colours and the version stamp factored out: **0** changed |
| 5. bytes | notebook first-open 1,897,262 B; `pine` chunk 353,925 B; total JS 12,686,331 B | +0 (`notebook_perf_budgets` PASS); +4,341 B; +10,459 B |
| 6. `paramIds.test.js` | green | green, no edit |

`pineProbeReplay`'s artemis pin moves (the Resolver is asked for the transparencies and colour tests it now
reads): on the merged tree `[729, 429977]` plain / `[729, 429985]` manifest, measured there rather than
summed with C31's and C32's.

**Still not carried, by name, and what settles each.**

| what | where | settles it |
|---|---|---|
| heat-map-seasons' gauge point — `bgcolor = color`, a variable NAMED `color` (`pine:statement`) | 1 slot, the only `carriedDiffers` | the statement reader binding a name that is also a namespace |
| a theme colour as a PLOT colour (`plot(x, color = chart.fg_color)`) — `colorDynamic`, the line keeps drawing | no graded capture | a decision: a plot colour is a member-editable input with a concrete default |
| `chart.bg_color` under a GRADIENT chart background (`theme:gradient-background`) | — | capture **Q-T1**: a probe under a solid light, a solid dark and a gradient background |
| a gradient with `top == bottom` or an `na` bound; a gradient end that is a theme reference; a transparency outside 0–100 — the object is HELD, a plot bar draws the series colour | — | C29's open gradient capture |
| a gradient on a marker, a candle or a fill; a gradient between two moving colours | — | a schema that holds it |
| the plot lane's constant-selector fold asked for OBJECTS — built, measured, removed: it changed one corpus script (ict-killzones, two cell fills) and its capture withholds those cells | `cell.bgcolor@1050`, `@1052` | a capture that draws them |
| `input.color(title = …, defval = …)` — the default read as the FIRST argument, not the named one | atr-bands, 48 sites (door-attached, no capture) | exact and small; not done in this lane (it is the plot lane's reader too) |
| a colour in a UDT field (`theme.frame`) | multicator-table, 19 sites | C11's UDT grammar |
| v6 unset box fill / cell text, v4 box border | the base default stands | a capture whose script leaves them unset |

**Mutation proofs** — 57 mutations on the merged tree (16 plot gradient, 35 object colours / version defaults / theme, 6 added after the first pass), each RED on its own, controls 117 / 117 green before and after every batch. Each mutation alone, bytes and sha256 captured,
restored by bytes, sha verified against the capture and against `HEAD`; a control run brackets each batch.
The first pass found four changes no rail could see (the gradient's mint, the version reaching what is drawn
through the render state and through the binding, a theme change repainting) and one mechanism no capture
exercises (the fold above). The rails were tightened until each went red; the fold was removed.

**For the integrator.** (1) `colourColumn.js` is a census, not a verdict: whether an object's colour should
join the harness verdict (it would move objects MATCH counts for every lane) is yours. (2) The 21–31
"unresolvable" plots in the harness dir are constants our pane hides (`hidden (constant)`) where the vendor
draws a line — not a colour defect, not touched. (3) 13 door-attached corpus scripts draw colours they did not
before; each mechanism is witnessed on a capture, the individual scripts are not.

## C41 — a lower-timeframe request is served (2026-10-01, step 51)

Branch `pine/c41-lower-tf-serve`, base wave 9 `19bcbf278c` (C29–C36 + the 2026-09-30 evening captures; merged
twice on the way, `1ce378b3b3` then `19bcbf278c`). C27 (§ C27) built the mechanism and served nothing. **Every rule
is stated once, in the header of `app/src/components/chart/engine/lowerTf.js`**; this section records what was
verified, what is served, and what was measured.

**The capture's claims, re-derived from the committed fixtures before anything was flipped** (an independent script
over `vw-lower-tf-*-2026-09-30` and the intraday bar captures, `Intl` only, none of the engine's code):

| claim | measured |
|---|---|
| L02 `request.security(own, "60", close)` on 1D = the day's LAST regular-session 60m close | SPY 2,951 / 2,951 sessions; RDDT 634 / 634 |
| L03 that bar's open time is 15:30 ET (12:30 on a half-day TradingView applies) | all sessions |
| L09 the day holds 7 sixty-minute bars (4 on an applied half-day); L10 the first opens 09:30 | all sessions |
| L04 the child runs on the intraday series (EMA(9) of the 60m closes, read at the day's last bar) | max difference 4.5e-13 |
| L07 / L08 `lookahead_on` reads the FIRST intrabar, and `na` on RDDT's listing day | first intrabar on every session; `na` once |
| L13 a `ticker.modify(…, session.extended)` request equals L02 on 1D | 4,800 / 4,800; L14 differs from L09 once |
| 60 = the 15m bars bucketed from 09:30; 240 = the 60m bars bucketed (09:30, 13:30) | 4,417 / 4,417; 1,262 / 1,262 |
| 1W: the week's last 60m close; a week before the intraday depth reads `na` with an empty intrabar set | 612 / 612; 362 `na` weeks |

**What is served.** On a `D` or `W` chart, `request.security(syminfo.tickerid | syminfo.ticker, "5" | "15" | "60" |
"240", expr)` with lookahead off is the tree node `{type:'ltf', value:'<minutes>', args:[child]}` — the twelfth
canonical node type (`parse.js::NODE_TYPES`, formula spelling `ltf(expr, '60')`), added TOGETHER with the Python
mirror (`ast_interpret.py`, `ast_lint.py`, `ast_freshness.py`, `compute_graph.py`, `user_definitions.py`,
`tools/ast_conformance.py`; `tests/test_node_vocabulary_parity.py` and the corpus derivation are green). The child
is evaluated on the chart symbol's regular-session intraday series at that code; each chart bar reads the value at
its LAST intrabar. The interpreter does not fetch and does not bucket: the caller supplies
`opts.lowerTf[code] = {bars, groups}` per binding (`lowerTf.js::resolveLowerTf`), the plot lane and the object lane
through the same function. The Python lane holds no intraday bars: there the node is not computable on any bar, and
`scan_definition.assert_scannable` refuses a screen that carries one, by name.

**The coverage rule (C27's, plus one decision).** A chart bar is KNOWN only whole: every TradingView session of its
period complete in the supply, no intrabar missing within the child's reach, and — C41 — that reach not running off
the FRONT of the supply. Anything else is `NaN` plus the withheld mask (`interpret.js::lowerTfMask`), never `na`.
⛔ **Before our intraday depth the bar is UNKNOWN, even where TradingView itself reads `na`** (before ITS depth, the
362 weeks above). From our side "TradingView has no intrabars here" and "we hold fewer than TradingView" are the
same observation, and a `na` we invent would flip a `nz()` or a comparison the vendor evaluates on a real number.
Withheld is the safe answer in both cases; nothing is drawn wrong, and some bars TradingView draws as `na`-derived
values are blank here.

**What the child may not contain** (`Resolver.lowerTfChildRefusal`, refused by name at the request): another request
(`tf`, `tf_live`, `sym`, `ltf`), a running value (`var` / self-reference), a whole-series function (`cum`,
`valuewhenOccurrence` — their reach is declared 0, so the coverage rule could never see them), and the bar's
position in the loaded series (`bar_index`, `barstate.*`). Each depends on where the series STARTS, and our supply
starts later than TradingView's.

**The supply.** `useLowerTfSources` (`engine/useSecondarySources.js`) asks `secondaryBars.js::ensureSecondaryBars`
for the chart's OWN ticker at `LOWER_TF_SOURCE[code]`, depth from `lowerTfFetchPlan`, never above the route's
60,000 (`BARS_ROUTE_MAX`, not raised). `StockChart.jsx` gains four touches (+8 / −2): the import, the hook call, the
hand-off to `binder.sync`, one dependency. Requests, railed in `useLowerTfSources.test.jsx`:

| chart | extra requests |
|---|---|
| no indicator, a native indicator, a Pine script with no lower read, a hidden one, no symbol | **0** |
| a served script on an intraday or monthly chart (refused at the bind) | **0** |
| ema-ribbon (15 / 60 / 240) on 1D | **1** — `/api/bars/RDDT?tf=15&bars=60000` |
| a script reading `"5"` and `"60"` | **2** (`tf=5`, `tf=15`) |
| a second chart on the same symbol, or a re-render that changes nothing | 0 more (the shared cache) |

⛔ **What the grade does and does not say.** Every number below is on VENDOR intraday bars through the harness
(`ourSide.js::lowerTfSupply`, the committed `vw-bar-counters-rddt-5/15/60/240` and SPY 60m captures). On a member's
chart the values come from OUR store's intraday bars, and they are right exactly as far as those bars agree with
TradingView's. That agreement is NOT measured here: no committed fixture holds our store's bars beside the vendor's
for the same sessions, so there is nothing to measure it with. The capture that would: our `/api/bars/RDDT?tf=15`
payload committed beside `vw-bar-counters-rddt-15`. Also not withheld: an EMA-like child near the front of OUR
supply has converged over fewer bars than TradingView's (the chart's own series has the same property).

**Measured** (base `19bcbf278c` → tip; one process at a time; base-vs-base controls identical byte for byte):

| | base | tip |
|---|---|---|
| 47 captures, pane on: objects MATCH / overall / families / plots | 30 of 46 / 27 / 233 of 266 / 161 of 172 | the same; 2 entries changed (ema-ribbon cells 36 → **47 / 48**; artemis notes only) |
| 47 captures, pane off | 18 of 25 / 15 / 107 of 119 / 140 of 151 | the same; the same 2 entries |
| committed harness dir (117), pane on | 62 of 82 / 46 / 315 of 350 / 343 of 417 | the same; 5 entries (those 2 + the three `vw-lower-tf` probes' refusal sentence) |
| committed harness dir, pane off | 50 of 61 / 34 / 189 of 203 / 322 of 396 | the same; the same 5 |
| member-door census 266, pane off / on: attach | 41 / 64 | 41 / **65**; 1 row per state (`mtf-dashboard-pro`), control 0 rows |
| translation census 266, host lane: ok / served outputs | 58 / 404 | **59 / 414** |
| translation census 266, screen lane: ok / served outputs | 58 / 738 | 58 / 738 — every moved output is a refused one whose sentence now reads `lower-tf:screen` |
| notebook first-open | 1,897,262 B | 1,897,271 B (**+9**, PASS) |
| `pine` chunk / `StockChart` chunk / total JS | 353,925 / 688,747 / 12,686,331 B | 354,109 (+184) / 689,864 (+1,117) / 12,702,297 (**+15,966**) |

*Translation census, host lane, by script.* `lowerTf` is stamped on nine: `mtf-dashboard-pro` (8 outputs now
served; the one script that newly attaches), `ema-ribbon` and `artemis` (object programs; plot outputs identical),
`renderingnature-smc` (2), `take-profit-multi-timeframe` (2), `multi-timeframe-rsi` (2 served, 2 still
`lower-tf:unwitnessed`), `advanced-custom-multi-ma`, `multi-timeframe-trend-indicator`,
`fibonacci-retracement-statistics` — the last six door-refused before and after on another wall.
`liquidity-engulfing-displacement` moves 8 refusals `pine:request` → `pine:builtin` (its request resolves; the child
does not). Eight more change a refusal sentence only. Parameter ids moved in ONE script
(`multi-timeframe-rsi`, 5 → 7), door-refused before and after.

*The +9 bytes.* The engine's shared chunk — which Rollup had named `bind` — now also holds `lowerTf.js` (shared by
the chart and the `pine` chunk since the chart reads it) and is named `lowerTf`: 41,329 → 51,333 B. Three chunks in
the Notebook's first-open closure carry that FILENAME in a preload list, three characters longer each. The chunk
itself is not in the closure. The 10 KB it grew by loads with the chart engine rather than with the `pine` chunk.

**Pins that moved, each with its reason at the pin.** `pineProbeReplay` artemis (the three children are resolved
once per request: same 531 Resolvers, +103,890 steps; holds unchanged across both wave-9 merges);
`docs/pine/param-ids.json` for `mtf-dashboard-pro`, `multi-timeframe-rsi` and the out-of-sample `12-setup-grader`
— all three door-refused at base in both flag states, so no saved definition holds an id from them, and
`paramIds.test.js` itself has no edit; `oos-measured-baseline.json` (setup-grader's first refusal);
`tools/corpus_metric.json` (host 58 → 59) and `tools/lookback_agreement.json` (distinct trees 426 → 440, rows
identical), both written by their tests; C35's ema-ribbon runtime-lane stop (`lower-tf:unwitnessed` →
`lower-tf:runtime-lane`, same line). ⚰️ `corpusMetric.test.js` asserted `screenerOk >= hostOk`, a count standing in
for a set relation; the host lane now serves a script the screen lane cannot, and the test asserts what is true:
each lane clears a script the other refuses.

**Still refused, by name, and the capture that settles each:**

| code | example | what settles it |
|---|---|---|
| `lower-tf:lookahead` | `lookahead = barmerge.lookahead_on` below the chart (liquidity-heatmap's `"5"` pivots) | witnessed as the FIRST intrabar and `na` on a listing day (L07 / L08) — served once that `na` rule is measured on a second symbol; not this lane |
| `lower-tf:intrabar-array` | `request.security_lower_tf` read directly | an array column; the L-rows witness contents and order on SPY only, and the 13 corpus scripts stop earlier at `pine:collection` |
| `lower-tf:unwitnessed` | `"1"`, `"30"`; any code on a monthly chart | `vw-lower-tf.pine` with a row at that timeframe / on a 1M chart, beside TradingView's own bars at that timeframe |
| `lower-tf:other-symbol` | a lower read of another symbol | that symbol's intraday bars beside the capture — not planned |
| `lower-tf:session` | `ticker.modify(…, session.extended)` / `ticker.new` as the symbol | L13 / L14 show it equals the regular session on 1D except once; one difference is not a rule |
| `lower-tf:intraday-chart` | `"15"` on a 60m chart | a capture of a lower read on an intraday chart (the time-range mapping) |
| `lower-tf:expression` | a `var`, `ta.cum`, `bar_index` inside the request | a capture whose intraday depth matches our supply's start, or a supply that starts where TradingView's does |
| `lower-tf:screen` | any of the above in a screen | nothing — a screen holds daily bars |
| `lower-tf:runtime-lane` | a served read in the per-bar runtime lane (dark) | an intraday supply for that lane |

**Rails.** `vendorHarness.c41LowerTfServe.test.js` (19: SPY 1D L02 / L03 / L16 on 2,950 sessions — one fewer than the
capture's 2,951, 2017-11-24, a half-day TradingView's session does not apply — RDDT 633, L06 `"5"` on 258, the weekly
rows, ema-ribbon's rows 6–8 and bias, a no-supply control that must read WITHHELD, and each refusal);
`useLowerTfSources.test.jsx` (11); `lowerTf.test.js` (35); `vendorHarness.c27LowerTf.test.js` (11).
On the merged tree: the lane rails plus the other lanes' (`vendorHarness.c2* c3* c4*`, `paramIds`, `pineProbeReplay`,
`corpusMetric`, `lookbackAgreement`, `partialDrawing`): `Test Files  29 passed | 1 skipped (30)`,
`Tests  289 passed | 2 skipped (291)`.

**Mutation proofs** (bytes + sha256 captured, mutated, run, restored by bytes, sha and `git status` verified; each
red alone; run on the merged tree):

| | mutation | totals | |
|---|---|---|---|
| M00 | control: no mutation | Test Files  4 passed (4); Tests  76 passed (76) | green (control) |
| M01 | `LOWER_TF_WITNESS.requestValue` back to null | Test Files  3 failed | 1 passed (4); Tests  24 failed | 52 passed (76) | **red** |
| M02 | a chart bar reads its FIRST intrabar, not its last | Test Files  2 failed | 1 passed (3); Tests  13 failed | 52 passed (65) | **red** |
| M03 | the regular-session filter removed (extended-hours bars bucketed) | Test Files  2 failed | 1 passed (3); Tests  6 failed | 59 passed (65) | **red** |
| M04 | the leading-edge rule removed (a reach past the front of the supply is served) | Test Files  1 failed | 2 passed (3); Tests  1 failed | 64 passed (65) | **red** |
| M05 | the withheld mask not applied (an uncovered bar reads as a value / `na`) | Test Files  2 failed | 1 passed (3); Tests  2 failed | 63 passed (65) | **red** |
| M06 | a whole-series function (`ta.cum`) served inside the child | Test Files  1 failed | 1 passed (2); Tests  1 failed | 29 passed (30) | **red** |
| M07 | the member door does not stamp `meta.lowerTf` | Test Files  2 failed (2); Tests  16 failed | 14 passed (30) | **red** |
| M08 | the hook asks for bars for a script with NO lower read | Test Files  1 failed (1); Tests  1 failed | 10 passed (11) | **red** |
| M09 | 60 and 240 built from the store's clock-aligned `tf=60` | Test Files  3 failed (3); Tests  19 failed | 46 passed (65) | **red** |
| M10 | the 60,000-bar cap raised to 120,000 | Test Files  2 failed (2); Tests  2 failed | 44 passed (46) | **red** |
| M11 | `StockChart.jsx` does not hand the supply to the binder | Test Files  1 failed (1); Tests  1 failed | 10 passed (11) | **red** |
| M12 | bars fetched on a chart period no capture witnesses (intraday, monthly) | Test Files  1 failed (1); Tests  1 failed | 10 passed (11) | **red** |
| M13 | the screen lane serves the read | Test Files  3 failed (3); Tests  5 failed | 65 passed (70) | **red** |
| M14 | the registry drops the supply (plot lane) | Test Files  1 failed (1); Tests  9 failed | 10 passed (19) | **red** |
| M15 | the Python vocabulary without `ltf` | 1 failed, 104 passed, 3604 warnings in 2.63s | **red** |
| M16 | `"240"` unwitnessed again | Test Files  3 failed (3); Tests  15 failed | 50 passed (65) | **red** |
| M17 | the runtime lane does not refuse a served read | Test Files  1 failed | 1 passed (2); Tests  1 failed | 29 passed (30) | **red** |

### Left for the integrator

1. **Our store against TradingView's intraday bars is unmeasured.** Every grade here is on vendor bars. Committing
   one `/api/bars/RDDT?tf=15` payload beside the vendor capture would make it a rail.
2. **`docs/pine/param-ids.json` was re-pinned for three scripts**, all door-refused at base under both flag states.
   `paramIds.test.js` has no edit; the artifact does.
3. **`corpusMetric.test.js`'s invariant changed** (above).
4. **The first-open closure is +9 B**, a filename. Pinning that chunk's name in `vite.config.js` would make it +0;
   it is a config change outside this lane.
5. **`tools/ast_conformance.py --check` is red at base** (2,338 findings; 2,339 here, the one new corpus case) —
   not re-recorded.
6. **`tests/test_definition_concierge.py::test_the_CORPUS_of_FIRM_PHRASINGS…` fails at base and here** (four
   starter-screen phrasings) — not this lane's.
7. Lookahead and the intrabar array are witnessed on the probe and deliberately left refused (the table above).

### C41 follow-up — what the full chart suite found on the first tip (`246f4f6805`, 2026-10-01)

The section above was written before the one full run of `src/components/chart`. That run (tip `b7887a8f91`) read
`Test Files  4 failed | 868 passed | 8 skipped (880)`, `Tests  5 failed | 14787 passed | 69 skipped (14861)`, and
two of the five were this lane's regressions — so the sentences above that say artemis moved only in its notes
were true of the harness grade and not of the product. Both are fixed in `246f4f6805`.

**1. A dead arm that reads below the chart withheld cells TradingView draws.** artemis-oscillator-pro requests its
oscillator at `"15"`, `"60"` and `"240"` and guards each with a validity that is false on every bar of a daily
chart (`timeframe.in_seconds("15") >= chartSec`); TradingView draws those rows `— n/a` and the header `◮ MIXED`.
Before C41 the request refused and C10's rescue took the live arm. Once the request resolved to an `ltf` tree, the
dead side stayed in the tree, `lowerTfMask` (a rule about the tree's nodes) withheld the four cells on a chart with
no intraday supply, and the chart fetched 15-minute bars nothing reads.
*Rule:* in the object pass, a test that is the same on every bar answers with its live arm when the dead one holds
an `ltf` (the resolver's `ternary` case), and an `and`/`or` the left side has decided drops a right side that holds
one (`pine.js::deadLowerTfRead`) — the tree this produced before C41. `translatePine` stamps only the codes a tree
still holds (`lowerTfCodesHeld`), so a script whose only lower reads are dead fetches nothing. The plot pass is
unchanged: there a dead `ltf` arm stays in the tree and is withheld where uncovered (never wrong; it refused
before C41).

**2. A tree that reads below the chart and could not be computed was drawn from `NaN`.** With artemis' validity
made per-bar (C10's own control), the header's condition measured 130 nodes against the 128 cap, failed, had no
column, read `NaN` — and a `NaN` condition is false, so the text's last arm (`◮ MIXED`) was drawn off a 15-minute
read nobody made. *Rule:* a failed tree that holds an `ltf` is unknown on every bar, in both object-column forms
(`objectColumns.js::withholdFailedLowerTf`). A failed tree that reads no lower timeframe reads as it always has
(that is every other lane's behaviour and is not changed here).

**The other three of the five.** `runtime/__tests__/simpleArgWindow.test.js` (4) pinned `lower-tf:unwitnessed` for
`"15"` in the runtime lane; it is `lower-tf:runtime-lane` now (the same re-pin `c35RuntimeError` got), and `"30"`
keeps `lower-tf:unwitnessed`. `memberPaneGate.test.js` and `objectFnInline.vendor.test.js` were 15 s timeouts.

**Measured again on `246f4f6805`** (base = wave 9 `19bcbf278c`, same commands; base results are the saved run):
the 47 captures, the committed harness directory and the member-door census are number-for-number the table
above, and artemis is now byte-identical to base in all four harness runs (it no longer appears among the changed
entries: 1 on the 47, 4 on the directory). Translation census: host `ok` 58 → 59, served outputs 404 → 414, 16
scripts changed (was 17 — artemis left), `lowerTf` stamped on 7 scripts (was 9); screen lane 58 / 738 unchanged.
Bytes: notebook first-open 1,897,262 → 1,897,271 B (+9, PASS); `pine` chunk 353,925 → 354,643 (+718);
`StockChart` 688,747 → 690,016 (+1,269); total JS 12,686,331 → 12,702,992 (+16,661). `pineProbeReplay`'s artemis
pin moved back toward base: 513,767 → 439,973 steps (base 409,877), the same 531 Resolvers.

**Rails.** `vendorHarness.c41LowerTfServe.test.js` gained 7 cases (26): each rescue with its per-bar control, the
member door on a chart with no intraday bars (dead read: label drawn, no note; per-bar: withheld), and the failed
tree in both forms with a no-`ltf` control. The lane's and the other lanes' rails, 39 files, one process:
`Test Files  1 failed | 37 passed | 1 skipped (39)`, `Tests  1 failed | 507 passed | 2 skipped (510)` — the one
red was the artemis step pin above, re-pinned and green alone (`Test Files  1 passed (1)`, `Tests  6 passed (6)`).
The full chart suite on `246f4f6805`: `Test Files  1 failed | 871 passed | 8 skipped (880)`,
`Tests  1 failed | 14799 passed | 69 skipped (14869)`.

⚠️ **The one red is `objectFnInline.vendor.test.js` › sector-rotation, a 15 s timeout, and it is not banked as
load.** Measured alone, alternating base and tip, one process at a time, five each: base 10.3 / 14.1 / 12.1 /
11.2 / **16.7** s, tip 13.2 / 14.8 / 9.9 / 10.9 / 13.5 s. The test runs within a second or two of its ceiling on
wave 9 itself and crossed it there once in five; this lane does not move it. It needs a per-test timeout or a
cheaper fixture — the integrator's call, since the file is C33's.

**Mutation proofs** (same harness; clean tree before, bytes restored, sha and `git status` verified; each alone;
rails = this file + `c10SecurityObjects.vendor.test.js`):

| | mutation | totals | |
|---|---|---|---|
| M18 | the ternary's dead `ltf` arm kept in the tree | Test Files  1 failed | 1 passed (2); Tests  2 failed | 29 passed (31) | **red** |
| M19 | a decided `and`/`or` keeps its `ltf` side | Test Files  2 failed (2); Tests  3 failed | 28 passed (31) | **red** |
| M20 | every emitted code stamped, held or not | Test Files  1 failed | 1 passed (2); Tests  3 failed | 28 passed (31) | **red** |
| M21 | graph form: a failed `ltf` tree reads `NaN` | Test Files  1 failed | 1 passed (2); Tests  1 failed | 30 passed (31) | **red** |
| M22 | trees form: a failed `ltf` tree reads `NaN` | Test Files  1 failed | 1 passed (2); Tests  1 failed | 30 passed (31) | **red** |
| M23 | every failed tree withheld, `ltf` or not | Test Files  1 failed | 1 passed (2); Tests  2 failed | 29 passed (31) | **red** |

**Stated plainly, for a live chart.** The newest daily bar's session is incomplete in our store until the close,
so during market hours every value that depends on a lower-timeframe read is withheld ON THAT BAR — ema-ribbon's
15m / 1H / 4H rows and its bias cells among them, since a last-bar table reads the newest bar. They draw once the
session's intraday bars are whole. TradingView shows a developing value there; no capture says what it is against
our bars, so it is not guessed.

**Added for the integrator.** 8. the sector-rotation timeout above. 9. the PLOT pass keeps a
dead `ltf` arm in the tree (withheld where uncovered, and fetched for); collapsing
it there would move parameter addresses of scripts that newly translate, so it was left. 10. a failed object
tree with NO `ltf` still reads `NaN` and can pick a text's last arm — pre-existing, every lane's, not changed here.

### C41 gate — serving is OFF until the store is measured (`VITE_PINE_LOWER_TF_ENABLED`, 2026-10-01)

Integrator ruling: the RULE above is witnessed, the DATA is not — every grade here is on TradingView's own intraday
bars, and the product reads ours. So everything this section serves sits behind one build flag, default OFF, read
in one place (`engine/lowerTfGate.js::lowerTfServingEnabled`, `=== '1'`, fail closed). `lowerTf.js` asks it LAST in
`lowerTfRefusal` (the translate door and the bind) and in `lowerTfWindowsOf` (the fetch).

**Off** (what ships): a read that would be served is refused by name — `lower-tf:store-unmeasured`, "our intraday
bars have not been measured against TradingView's" — exactly where it was refused before C41. No `ltf` node, no
`meta.lowerTf`, no request, no supply; a document stamped while the gate was on is neither fetched for nor served.
The two follow-up fixes above (`deadLowerTfRead`, `withholdFailedLowerTf`) are unconditional and are no-ops with
the gate off: each fires only on a tree holding an `ltf`, and none is emitted. **On**: everything measured above.

**Flag-off against wave 9 `19bcbf278c`** (commit `1368fbebec`, before the wave 10 merge; same commands):

| measure | result |
|---|---|
| 47 captures, pane on and off | 0 entries changed |
| harness directory (117), pane on and off | 3 entries changed, all three `vw-lower-tf` probes, refusal sentence only (still INCONCLUSIVE) |
| member-door census (266) | attach 41 / 64 → 41 / 64; 1 row per state changed, `mtf-dashboard-pro`, refusal sentence only |
| translation census (266 × host, manifest, screen) | 0 structural differences (`ok`, output count, refusal guards, first refusal, parameter ids, `lowerTf`); host 58 / 404, screen 58 / 738 unchanged; 15 scripts differ in SENTENCES only |
| notebook first-open | 1,897,262 → 1,897,262 B (+0; the shared chunk keeps the name `bind`, `vite.config.js`) |
| extra requests | 0 (`useLowerTfSources.test.jsx`, gate-off case) |

The sentences that differ, all inside notes / refusal messages of scripts refused on both sides: `lower-tf:unwitnessed`
and `lower-tf:not-served` for 5 / 15 / 60 / 240 → `lower-tf:store-unmeasured` (host lane) or `lower-tf:screen` (screen
lane); the wording of `lower-tf:lookahead`, `lower-tf:intrabar-array`, `lower-tf:session` and of `lower-tf:unwitnessed`
for `1` / `30` (each now cites the capture that witnesses it). Corpus-wide pins are back at their wave 9 values —
`param-ids.json`, `pineProbeReplay`, `corpusMetric`, `oos-measured-baseline.json`, `tools/corpus_metric.json`,
`tools/lookback_agreement.json` — so integrator items 2 and 3 above no longer apply.

**Flag-on** (same tree, `VITE_PINE_LOWER_TF_ENABLED=1`): the figures in the follow-up above — ema-ribbon's cells,
`mtf-dashboard-pro` attaching pane-on (41 / 65).

**The measurement that flips it** — `engine/__tests__/storeIntradayAgreement.test.js`: a committed
`tests/fixtures/store/api-bars-RDDT-tf15.json` (the exact JSON of `GET /api/bars/RDDT?tf=15&bars=60000`) against
`vw-bar-counters-rddt-15-2026-09-30`, both through `lowerTf.js::intrabarSeries` (regular session, slots from 09:30).
Per session inside both supplies: bars on both sides / only one, each of O H L C V equal or differing (count, max
abs, max rel), sessions fully equal, price-equal, last close equal, complete on each side. It SKIPS BY NAME until
the payload exists; controls on the vendor's own bars prove it can fail (one moved close is one bar and one
session; a moved last bar moves the value a `"15"` read serves; a missing bar; extended-hours bars ignored).
**Proposed bar** (`FLIP_CRITERION`; the flip itself is an owner decision): ≥ 99% of the vendor's complete sessions
complete in the store; ≥ 99% of sessions complete on both sides equal on every bar's O, H, L and C; ≥ 99.5% with the
same last-bar close; volume reported and not gating — below 99% a child that reads `volume` is not covered. And on
a second, older symbol (SPY) as well as RDDT: one symbol does not establish a store.

**On wave 10** (`e4e24524ef`, merged as `06eb772f24`; five conflicts, both sides kept): three expectations moved by
wave 10 itself — ema-ribbon is 48 of 48 cells with the lower rows served and 37 with them withheld (C40 draws the
strength bar), and its door records no runtime-lane refusal (C43 places its `runtime.error`). Rails, one process:
`Test Files  2 failed | 51 passed | 1 skipped (54)`, `Tests  4 failed | 683 passed | 4 skipped (691)` — those four,
re-pinned, then `Test Files  2 passed (2)`, `Tests  42 passed (42)`. Python rails: `455 passed`.

| | mutation | totals | |
|---|---|---|---|
| M24 | the gate answers on whatever the variable says | Test Files  2 failed (2); Tests  5 failed | 38 passed (43) | **red** |
| M25 | the fetch ignores the gate | Test Files  2 failed (2); Tests  2 failed | 41 passed (43) | **red** |
| M26 | the refusal ignores the gate | Test Files  1 failed | 1 passed (2); Tests  4 failed | 39 passed (43) | **red** |
## C44 — the sweep on the wave-10 tree, and object colour joins the verdict (2026-10-01, step 54)

Branch `pine/c44-sweep`, base `e4e24524ef` (wave 10: master with waves 7–9 live, plus C37, C38, C40, C42,
C43). No engine semantics in this lane: a measurement (Part A), the harness verdict (Part B), and docs.
`docs/pine/SESSION-STATE.md` now opens with the current state of the program.

### Part B first, because every number below is stated under BOTH verdicts

**The ruling** (integrator, on the question C37 left): object COLOUR joins the harness verdict. An object
family grades MATCH only when the colours of its paired objects agree too. The rule is stated once,
`tools/vendor_harness/compare.mjs::objectColourRows`:

| slot state (from the pairing, `vendorHarness/objectColours.js`) | in the verdict |
|---|---|
| `agree`, `agreeByDefault` | agrees |
| `themeRelative` (`chart.fg_color` / `chart.bg_color`, carried as a reference) | agrees — our chart's colour, never TradingView's (§ C37) |
| `carriedDiffers`, `notCarried` | DIFFERS |
| `vendorUndecodable` | not graded (the capture's encoding); 0 slots in either set |
| `undrawn` — the object is held at an `na` coordinate on BOTH sides, so neither platform draws it | not graded (ruling below) — COUNTED: `undrawn` and `undrawnDiffering` in the row, the first differing one named, and said in the reason |
| anything else, or an unknown object kind | throws — never read as agreeing |

- One row per object family that paired at least one slot (`objects.colours`), beside the count and text
  rows, which are computed exactly as before. Only PAIRED objects are graded; an object our side holds that
  no vendor record matches by value is `unpaired`, reported in `objects.colourUnpaired`.
- **Both numbers come out of ONE run.** Every graded verdict carries `verdictWithoutColour` at the object
  level and at the capture level, and the summary table prints the old totals and names every capture
  colour moved. A capture whose two verdicts differ changed because of colour and nothing else.
- It is on by default. `gradeCapture(c, {objectColour: false})` or `VENDOR_HARNESS_OBJECT_COLOUR=0`
  reproduces the old verdict and the old sentence byte for byte. Not a large mechanical change, so it is the
  verdict itself; the option exists for reproduction, not as a gate.
- The pairing moved, unchanged, from `colourColumn.js` to `objectColours.js` so `harness.js` can ask it
  without the two files importing each other. `colourColumn.js` keeps the per-slot census and re-exports.

⚰️ **An instrument error found before the verdict was believed.** The pairing compared an `na` coordinate
with a finite test. The capture writes `na` as `null`; our runtime holds `NaN`. So every object both sides
hold at an `na` price went unpaired and its colours were never read: all 504 boxes of
multi-timeframe-supply-demand-zones, 51 lines of ultimate-pivot-points, 48 boxes of contraction-box. An
`na` now pairs with an `na`, and with nothing else (`objectColours.js::isNa`). After it, no capture graded
objects-MATCH on the 47 has an unpaired object.

**Ruling (integrator, 2026-10-01, on decision 1 of this lane's first report): COLOUR IS GRADED ONLY ON
OBJECTS THAT ARE DRAWN.** The verdict measures what a member sees. An object held at an `na` coordinate on
BOTH sides is drawn by neither platform and does not contribute to the colour verdict. Implemented as one
condition in the pairing (`objectColours.js::pairUndrawn`):

- per family, on each side's own record: a line with any of x1 / y1 / x2 / y2 `na`; a box with any edge
  `na`; a label with `na` x, or `na` y while it is placed by price (a label at `yloc.abovebar` / `belowbar`
  needs no y). A table and its cells are always drawn.
- ⛔ BOTH sides must be undrawable. An object EITHER side draws is graded as before — otherwise a line we
  fail to place would excuse its own wrong colour.
- The slots are never dropped: each is filed `undrawn` with the state it would have had (`wouldBe`) and
  both colours; the verdict row carries `undrawn` and `undrawnDiffering` and names the first differing one;
  the reason says how many there are, MATCH or not.

Slots on the 47 (pane on): **3,411 graded + 1,176 undrawn** (multi-timeframe-supply-demand 1,008,
contraction-box 96, ultimate-pivot-points 51, OHLM 16, htf-liquidity 4, rsi-swing 1). Of the undrawn, **16
hold a colour that differs** — all in multi-timeframe-supply-demand-zones. Harness dir: 4,653 graded + 1,454
undrawn, the same 16.

**Old verdict → new verdict, measured on `e4e24524ef`:**

| | objects MATCH (old → new) | overall MATCH (old → new) | colour families agreeing | entries moved by colour |
|---|---|---|---|---|
| 47 captures, objects pane on | 30 → **29** of 46 | 27 → **26** of 47 | 72 of 73 | heat-map-seasons |
| 47 captures, pane off | 18 → **17** of 25 | 15 → **14** | 29 of 30 | heat-map-seasons |
| committed harness dir (117), pane on | 66 → **65** of 85 | 48 → **47** | 98 of 99 | heat-map-seasons |
| committed harness dir, pane off | 54 → **53** of 64 | 36 → **35** | 55 of 56 | heat-map-seasons |

Control: in the new run, `verdictWithoutColour`, every count row, every text row and every plot verdict
equal the base run for all 47 and all 117 entries, in both pane states (0 entries differ). The score
change is colour and nothing else.

(Before the ruling, with held-but-undrawn objects graded, the same four rows read 28 / 25, 17 / 14,
64 / 46, 53 / 35: multi-timeframe-supply-demand-zones was the second entry, pane on.)

| capture | what differs | why |
|---|---|---|
| heat-map-seasons | 1 of 35 cell colour slots: cell (13,1) fill, vendor `#f3e841`, ours `#dde44f` | `bgcolor = color`, a variable NAMED `color` (`pine:statement`; `cell.bgcolor@70` dropped, the cell keeps the gauge's fill). C37 listed it as "still not carried" |

**Counted, not a verdict — multi-timeframe-supply-demand-zones (MATCH under both verdicts).** 504 boxes,
all at `na` coordinates on BOTH sides on this chart: nothing is drawn by either platform. On 8 of them
TradingView ran `box.set_bgcolor` / `box.set_border_color` (lines 382–394, inside a helper's loop over
arrays of boxes); our program drops those updates (`pine:collection`), so the 8 hold the default where
TradingView holds the script's `TF_*_Demand/Supply_Color`. The row reads `undrawn 1008, undrawnDiffering
16`, first `box.border_color` of box #1, vendor `#c6f89561`. ⛔ The day a zone gets coordinates (another
symbol, another date) these are drawn objects and the dropped updates are a real DIVERGE; the defect is
the collection grammar for updates through a held array in a loop.

**Re-pins.** No pinned verdict count moves. `vendorHarness.c37ObjectColours`' rsi-swing pins stay at
their values (line.color 10, control 21): the script's first line has an `na` second point, pairs now, and
is `undrawn`; the control gained an assertion that it is filed with its would-be state. The whole
`vendorHarness` directory with the final verdict: `Test Files  46 passed | 2 skipped (48)`, `Tests  447 passed | 2 skipped (449)` (the directory plus `strFormat.vendor`).

**Rail:** `vendorHarness.c44ColourVerdict.test.js` (25 tests): the rule state by state and fail-closed;
an undrawn slot not graded and still counted; liquidity-pools and vw-object-gc-b MATCH with every slot
graded; one line of liquidity-pools moved to another colour of the capture's own palette → DIVERGE with
`verdictWithoutColour` MATCH; TradingView's colour on all 16 theme slots of market-structure moved → still
MATCH, and the same move on a slot the script colours → DIVERGE; the option; heat-map-seasons by name and
slot; multi-timeframe-supply-demand MATCH with 1,008 undrawn slots and 16 differing counted; the pairing —
`na` is `na`, an object neither side draws is `undrawn`, and **an object drawn on EITHER side is still
graded** (ours undrawable + theirs drawn, and the reverse, both → `carriedDiffers`).

**Mutation proofs** (29, each alone, bytes + sha256 captured, restored by bytes, sha verified, the working
tree's own uncommitted change set unchanged after; rails `c44ColourVerdict` + `c37ObjectColours` + `c37Theme`, one vitest process; every row
re-run on the final tree):

| | mutation | totals (files; tests) | |
|---|---|---|---|
| M00 | control: no mutation | Test Files  3 passed (3); Tests  56 passed (56) | green |
| M01 | the object verdict ignores a colour that differs | 1 failed, 2 passed (3); 4 failed, 52 passed (56) | **red** |
| M02 | a theme-relative slot is graded as differing | 1 failed, 2 passed (3); 5 failed, 51 passed (56) | **red** |
| M03 | notCarried (the default drawn is not the vendor's) counts as agreeing | 1 failed, 2 passed (3); 4 failed, 52 passed (56) | **red** |
| M04 | an undecodable vendor colour is graded as differing | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M05 | fail OPEN: an unknown slot state is read as agreeing | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M06 | the option defaults OFF | 1 failed, 2 passed (3); 9 failed, 47 passed (56) | **red** |
| M07 | gradeCapture never pairs (the verdict is handed no colours) | 1 failed, 2 passed (3); 8 failed, 48 passed (56) | **red** |
| M08 | compareCapture drops the colours on the way to compareObjects | 1 failed, 2 passed (3); 8 failed, 48 passed (56) | **red** |
| M09 | verdictWithoutColour mirrors the NEW verdict (the two numbers are one) | 1 failed, 2 passed (3); 4 failed, 52 passed (56) | **red** |
| M10 | the pairing: NaN is not na again (an object at an na price goes unpaired) | 2 failed, 1 passed (3); 5 failed, 51 passed (56) | **red** |
| M11 | the pairing: na pairs with a price | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M12 | the pairing: a theme reference is compared with the capture's colour | 2 failed, 1 passed (3); 6 failed, 50 passed (56) | **red** |
| M13 | ENGINE: the v5 label-text default moves (color.black -> color.blue) | 2 failed, 1 passed (3); 4 failed, 52 passed (56) | **red** |
| M14 | the CAPTURE verdict is computed from the verdict without colour | 1 failed, 2 passed (3); 2 failed, 54 passed (56) | **red** |
| M15 | a family with nothing graded reads as agreeing instead of ungraded | 1 failed, 2 passed (3); 3 failed, 53 passed (56) | **red** |
| M16 | an explicit option is ignored (the environment always wins) | 1 failed, 2 passed (3); 2 failed, 54 passed (56) | **red** |
| M17 | fail OPEN: an unknown object kind is skipped silently | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M18 | the capture carries no verdictWithoutColour | 1 failed, 2 passed (3); 3 failed, 53 passed (56) | **red** |
| M19 | ENGINE: the v5 box-fill default moves (color.blue -> color.black) | 2 failed, 1 passed (3); 4 failed, 52 passed (56) | **red** |
| M20 | undrawn when only OUR side cannot draw it (a line we fail to place excuses its colour) | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M21 | undrawn when only the VENDOR side cannot draw it | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M22 | the exemption is gone (an object nobody draws is graded) | 2 failed, 1 passed (3); 5 failed, 51 passed (56) | **red** |
| M23 | an undrawn slot is dropped from the books (not counted) | 1 failed, 2 passed (3); 3 failed, 53 passed (56) | **red** |
| M24 | an undrawn slot that differs is not counted as differing | 1 failed, 2 passed (3); 3 failed, 53 passed (56) | **red** |
| M25 | an undrawn slot decides the verdict (counted as differing) | 1 failed, 2 passed (3); 3 failed, 53 passed (56) | **red** |
| M26 | the undrawn row forgets the state it would have had | 2 failed, 1 passed (3); 3 failed, 53 passed (56) | **red** |
| M27 | a label placed off the bar is undrawn for want of a y | 1 failed, 2 passed (3); 1 failed, 55 passed (56) | **red** |
| M28 | the reason stops saying undrawn slots exist | 1 failed, 2 passed (3); 2 failed, 54 passed (56) | **red** |
| M29 | a line is undrawable only by its y (an na x still counts as drawn) | 1 failed, 2 passed (3); 2 failed, 54 passed (56) | **red** |

None survived. M13 / M19: a moved colour on OUR side turns MATCH into DIVERGE. M02 / M12: a
theme-relative slot must not. M20 / M21: an object drawn on either side is still graded. M23 / M24 / M26:
an undrawn slot stays on the books.

### Part A — wave 9 → wave 10, and every entry that moved

Wave 9 was re-measured in this lane at `46f54d80b5` (wave 9 as it landed on master) rather than quoted;
it reproduces C37's numbers. Old verdict throughout this table, so the two waves are comparable.

| | wave 9 `46f54d80b5` | wave 10 `e4e24524ef` | entries that moved |
|---|---|---|---|
| 47, pane on: objects / overall / families / plots | 30 of 46 / 27 / 233 of 266 / 161 of 172 | 30 / 27 / **234** / 161 | no verdict moved. trend-duration-forecast: line 0 → 1 of 1, labels 26 → 27 of 28 (C43). ema-ribbon: cells 36 → 37 of 48 (C42, the strength-bar cell) |
| 47, pane off | 18 of 25 / 15 / 107 of 119 / 140 of 151 | 18 / 15 / **108** / 140 | the same two |
| harness dir (117), pane on: objects / overall / families / plots | 62 of 82 / 46 / 315 of 350 / 343 of 417 | **66 of 85 / 48 / 323 of 357 / 351 of 450** | 7 entries. `rvol` DIVERGE → MATCH (C37, the gradient plot colour, 611 bars); `vw-fn-series-history-rddt-1d` DIVERGE → MATCH (C42); `vw-gradient`, `vw-mbb-auto`, `vw-offset-na` INCONCLUSIVE (refused) → graded DIVERGE, objects MATCH (C38: they attach now; what diverges is `bar_index`, the window's own index); ema-ribbon and trend-duration as on the 47 |
| harness dir, pane off | 50 of 61 / 34 / 189 of 203 / 322 of 396 | **54 of 64 / 36 / 197 of 210 / 330 of 429** | the same seven |
| member door, 266 × 2: attach off / on | 41 / 64 | 41 / 64 | 2 rows per state: `rvol` plots 2 → 3 (C37's position column); `smarter-snr` refusal `pine:window` → `pine:builtin` `str.length` (C38). Wave-10 vs itself: 0 rows |
| translation census (266, member door, pane on) | door ok 67, served outputs 733, `colorDynamic` 99, dropped colour props 287 sites | 67 / 733 / **98** / **103** | values identical in all 266; 1 output's presentation (`rvol`: `colorDynamic` → `colorGradient`); 1 refusal sentence (`smarter-snr`); object programs changed beyond colour in 9 scripts (C40 / C42 / C43) |

So wave 10 moved no graded verdict on the 47. It moved two harness-dir entries to MATCH, made three probes
gradable, and carried colours.

### Part A — every entry that is not MATCH (new verdict), 21 of the 47

The first wall behind each family is read off a per-drop census (a throwaway hook at `pine.js::dropped`
reading `lastCanonRefusal`, restored by bytes, sha verified against the capture and `git status` clean).
`@n` is a line of the script. Classes: **(i)** buildable now, the exact rule is witnessed · **(ii)**
capture pending · **(iii)** budget ruling · **(iv)** behind a dark flag · **(v)** correct end state ·
**(d)** data the store does not hold · **(g)** grammar the lane does not model (a design wave, not a rule).

| script | differs (vendor / ours) | first wall (code @ line) | class | what settles it |
|---|---|---|---|---|
| artemis-oscillator-pro | cells 21 / 16; texts `22 ▼ STRONG BEAR`, `80%`, `↓-17`, `████████░░` only vendor | `pine:reassign knnVal`@577/578/610/612 — the fold stops at the `for`@459 (a k-nearest-neighbour vote over four pushed arrays); `bar_str`@619 (its loop bound is `knnConf`); `pine:collection knnF1`@620 (`array.size` of a pushed, capped `var` array). Runtime lane: `pine:block`@233, `smooth`'s `switch m` over a `simple string` | (i) | the call-site rule C35 built for a `simple int`, for a text argument: the arm a fixed string selects is fixed per call site. C35 measured the oscillator exact on 632 / 632 bars with the arm substituted. Whether the KNN loop then fits `INSTRUCTIONS_PER_BAR` is NOT measured |
| candlestick-patterns-identified | 3 of 15 plots INCONCLUSIVE; objects MATCH | the pane's row ceiling, `memberPaneDefinition.js::CARRY_MAX` 12 | (iii) | a ruling; not raised |
| dual-view-htf-candlestick-patterns | no drawing program (vendor holds 436 objects) | `loop:bounds`@743 `pine:collection htf_close`@616; `pine:state htf_o`@487 (a `var` in a loop of `update_drawings`); runtime lane 247,425 instructions on the last bar against 200,000 (`vendorHarness.c21DualView`) | (iii) | budget, not raised |
| ema-ribbon-trend-filter | cells 48 / 37; plot `Squeeze Release ◆` INCONCLUSIVE | 11 cell texts@316–342: 8 × `pine:request` `"15"` / `"60"` / `"240"` (`lower-tf:unwitnessed` on this tree) and 3 × `str.tostring` of those values; the 13th plot is past `CARRY_MAX` | (iv) + (iii) | C41 (`pine/c41-lower-tf-serve`, dark behind `VITE_PINE_LOWER_TF_ENABLED`) measures cells 47 / 48 on vendor intraday bars. The capture cannot reach overall MATCH while the 13th plot is uncarried |
| heat-map-seasons | 1 cell fill (colour) | `pine:statement`: `color = …`, a variable named `color`; `cell.bgcolor@70` dropped | (i) | the statement reader binding a name that is also a namespace. → MATCH |
| high-low-open-mid-ranges | cells 45 / 37 (8 texts only vendor); lines 504 / 503 | `pine:request`@198 — the helper `ts('3M', …)`: `request.security(tickerid, '3M', …, lookahead_on)`. The `D` / `W` / `M` rows agree. One line: vendor id 2151 (bars 23–25, y 82.21, dotted, width 2) has no counterpart; not traced | (i) for the cells | a quarter request beside the weekly and monthly ones (`tf` gains `3M`, both lanes): the 8 cells are this capture's own witness, and C30 witnessed the quarter boundary. The line needs a trace before anything is claimed |
| htf-candle-footprint | lines 6 / 0, labels 6 / 0, boxes 13 / 3 | `pine:type HL.size`@120–170 — `HL` is a local array filled by `HL.push(high[i])` in a counted `for`@66 and reduced (`HL.max()`); `loop:bounds`@138; lists of user types (`for p in ProfileDraws`@74). Runtime lane: `runtime:loop` `for … in`@74 | (g) | ruling R7 (numeric accumulators belong to the runtime lane) + `for … in` and user types there |
| htf-liquidity-dashboard | cells 30 / 3 | `pine:request s0c_h`@149/155 — `input.symbol("ES1!")` … continuous futures and FX; `pine:collection s5d_rh`@149 | (d) | the store holds no futures or FX bars; `other-symbol:bare` is the right refusal. Not a capture |
| inside-bar-range | door refusal | `pine:state`@44/45 — two `var bool` latches, each reset by the other's condition | (iv) | the runtime lane runs it. **Measured with `VITE_PINE_RUNTIME_PANE_ENABLED=1` (a test process, nothing armed): MATCH — 2 plots, 632 / 632 bars each, objects MATCH** |
| k-clustering | lines 9 / 0, cells 8 / 5 | `pine:type n_clust.get`@185–207; runtime lane 800,613 instructions against 200,000 (`vendorHarness.c18KClustering`) | (iii) | budget, not raised |
| liquidity-heatmap | labels 27 / 0 | `pine:function-def`@261–309 via `resolutionInMinutes(tf = "")`@130 — a parameter with a DEFAULT value; behind it `request.security(tickerid, "3", chartTf)` with `timeframe.*` read inside the request | (i) then (ii) | default parameter values are buildable; the request is not (`"3"` is not a served code and a `timeframe.*` read inside a request is unwitnessed) |
| madrid-moving-average-ribbon | 6 of 18 plots INCONCLUSIVE | `CARRY_MAX` 12 | (iii) | a ruling |
| mcclellan-indicators | plot `Osc` DIVERGE (594 bars, ours `na`) | `request.security("ADVN" / "DECN")`@13/14 — bare breadth symbols | (d) | the store holds no exchange breadth series |
| poor-man's-volume-profile | labels 40 / 0 (withheld) | `pine:reassign row0_price`@748 — the fold stops at the `for`@276; runtime lane 227,730 instructions against 200,000 (C35) | (iii) | budget, not raised |
| position-size-calc | cells 10 / 0 | `pine:block`@57–70 via `ignored_list(syminfo.root)`@55 — a `switch` expression in a helper body; `lots`@70 reads `request.security(unitcurr + curr, '3', open, ignore_invalid_symbol = 1)`@12 | (i) then (ii) | a `switch` over a string in a one-expression helper is buildable (9 cells; two of them print `NaN` after a division by zero, which this capture witnesses). The tenth needs what a request for a symbol that does not exist answers — no capture |
| sector-rotation | lines 50 / 0, boxes 504 / 0 | `pine:builtin chart.left_visible_bar_time`@112–197 | (v) | viewport state; a named refusal is right |
| smt-divergence-ict-01 | lines 500 / 0, labels 500 / 0 | `input.symbol('XAUUSD')`@7 → `request.security`@15; every op is withheld (`withheldUnknown` 5,056) | (d) | no gold spot series in the store |
| trend-duration-forecast | labels 28 / 27 (`\n6\nTrend ↑`, vendor id 2, bar 58) | `var trend = bool(na)`@33 (v6): our `trend` reads `na` until the HMA exists, so the first flip is not seen | (i) | in v6 a `bool` is never `na`: the seed is `false`, and the first `true` is a flip. C23 serves that rule in the runtime lane; this capture's label id 2 is the host-lane witness. → MATCH |
| trend-lines-supports-and-resistances | no drawing program (vendor holds 14) | every create sits in `for [i, v] in <list of user types>`@297–345 or a `while`@327; runtime lane `pine:builtin alert.freq_once_per_bar`@79 | (g) | user-type lists (C11). `alert(…)` as a statement that draws nothing is exact and buildable, and is the runtime lane's first stop here |
| vold-market-breadth | cells 2 / 0 | `pine:text-value`@38/39 — `request.security("USI:UVOL" …)`@23–26 | (d) | no `USI:*` series in the store |
| volume-profile | lines 203 / 200, and **none of our 200 is at TradingView's position** | `pine:builtin chart.left_visible_bar_time`@146 in the arm of `vp_use_visible_range ? … : vp_lookback_depth` the default never takes; `update:target`@203–205 (`bars.get(i)` in a loop); `loop:bounds`@215 `pine:state va_up` | (i) then unmeasured | folding a ternary whose test is an input at its default (refusing by name when the member turns it on). Behind it `calculate_vp()` runs `lookback_bars × vp_num_bars` = 200 × 200 inner passes on the last bar — likely over `INSTRUCTIONS_PER_BAR`, NOT measured because the run does not start |

⚠️ **A served wrong position, found by the pairing (volume-profile).** Our 200 lines are held at their
creation coordinates (`x1 = x2 = bar 0`, `y = 50.44`, the first bar's close): the per-bar moves in `draw()`
are dropped, the creates are not. The count agrees (203 / 200 is the only family row that says anything)
and the harness compares no coordinate, so a count alone would have called 200 of them right. On a chart
each is a zero-length line at bar 0 — nothing visible — but it is an object whose POSITION is unknown and
is held rather than withheld. Not changed here; **handed to lane C45 as a withhold** (integrator).

**The committed harness dir beyond the 47** (70 further entries, 49 of them not MATCH, all probes or pre-09-28
captures; each rule is graded by its own rail, the door grade below is what the whole probe does):

| group | entries | why the door grade is not MATCH |
|---|---|---|
| `bar_index` is the loaded window's index | vw-gradient, vw-mbb-auto, vw-offset-na, vw-ne-na, vw-tf-period ×3, w4-cross-round, vw-runtime-error | the probe plots `bar_index` as its control; on a capture that does not start at the listing it is 8,175 on TradingView and 0 here (C38, "left for the integrator" 1). The rails join the listing history in front |
| a `pine:state` running total | adx-and-di, fvg-trend, pivot-point-supertrend, qqe-signals, vw-deadband-ticks ×3, vw-var-seed | (iv): the runtime front end compiles all eight; the pane is dark |
| a probe row the door refuses | syminfo-roster ×5 (`syminfo.type`), vw-time-tf ×3 (`input.time`), vw-time-close-tf ×2 (`time_close("3M")`), vw-time-session ×3, vw-clock-close-tfchange ×2 (`hour(x, tz)`), vw-clock-vwap (`ta.vwap(src, anchor)`), vw-lower-tf ×3, vw-object-gc-d ×2 (`label.all` as a value), vw-int-array-avg (`i1.avg`) | one row of the probe is a spelling still refused by name; the rest of the probe is served through its rail |
| colour unresolvable on a hidden constant | vw-bar-counters 1d / 15 / 60 / 240 (`C05_ta_cum_1`) | values agree; our pane hides a constant where TradingView draws a line (C37, note 2) |
| other | vw-bar-counters-rddt-5 (20,052 bars: the counter is behind the curtain off the listing), vw-other-symbol (bare `BRK.B` on 334 bars), vw-object-gc-a/b/c 1W (`barstate.isconfirmed` on the forming week), cc-yata (`pine:timeout`, a 400-level nest) | named in their own sections |

### Buildable walls, ranked by scripts moved

Graded 47 first (new verdict), then the corpus. Corpus columns are a COUNT OF SCRIPTS THAT SPELL THE
CONSTRUCT (a regex over `corpus/committed`, 266 scripts) and how many of those attach at the member door
today — an upper bound on reach, not a forecast of attaches.

| rank | wall | graded 47 | corpus: spell it / attach today | exact rule and its witness |
|---|---|---|---|---|
| 1 | a v6 `var x = bool(na)` seed is `false` (host lane) | trend-duration → **MATCH** | 5 / 2 | C23 (runtime lane); host witness: trend-duration label id 2 at bar 58 |
| 2 | a variable named like a namespace (`color = …`) | heat-map-seasons → **MATCH** | not counted (a regex cannot tell it from a named argument on a continuation line) | the capture's cell (13,1) |
| 3 | `request.security(…, "3M", …)` beside `W` / `M` | OHLM cells 37 → 45 of 45; verdict waits on one line | 6 / 2 (adr-pivots, OHLM) | OHLM's 8 quarter cells; C30's quarter boundary |
| 4 | a `switch` over a `simple string`, fixed per call site (runtime lane) | artemis: up to 5 cells; **may** reach MATCH | 72 scripts use `switch` at all / 13 attach | C35 measured the oscillator exact with the arm substituted |
| 5 | a `switch` expression in a one-expression helper (host lane) | position-size-calc cells 0 → 9 of 10 | same 72 / 13 | the capture's nine cells |
| 6 | `alert(…)` is a statement that draws nothing | 0 on its own (first runtime stop of trend-lines; `dwm_hl` in ict-killzones; htf-liquidity@147) | 38 / 10 | TradingView draws nothing for `alert`; every capture of a script that calls it |
| 7 | a default parameter value in a user function | 0 (liquidity-heatmap stops next on its request) | 10 / 2 | Pine's reference; the call with the argument omitted |
| 8 | a ternary whose test is an input at its default, dead arm unserved | 0 (volume-profile; then unmeasured budget) | 11 scripts read `chart.*_visible_bar_time` / 3 attach | exact at the default; the toggled case stays refused |

**How many of the 47 can reach MATCH.** New verdict, overall: 26 today.
- Firm, with ranks 1 and 2 built: **28** (objects 31 of 46).
- Possible, not established: **30** — artemis if the KNN vote fits the instruction budget (not measured), and
  OHLM if its one unexplained line is traced to something buildable.
- With the owed captures: **no further graded capture.** The captures in the queue below settle corpus
  refusals and probe rows; on the 47 the lower-timeframe capture is already taken and built (C41, dark), and
  ema-ribbon still cannot reach overall MATCH past its 13th plot.
- With the dark runtime pane on (measured, not proposed): inside-bar-range is MATCH, so 29 firm.
- The other 16 are not rules: 3 budget (dual-view, k-clustering, poor-man), 3 row ceiling (candlestick,
  madrid, ema-ribbon), 4 another symbol's data (htf-liquidity, smt, vold, mcclellan), 2 grammar
  (trend-lines, htf-candle), 1 correct end state (sector-rotation), 2 an unwitnessed request
  (position-size-calc's tenth cell, liquidity-heatmap), 1 unmeasured budget behind a withhold (volume-profile).

### One scoreboard

| | off | on |
|---|---|---|
| member door census, 266 scripts: attach (objects-only pane flag) | **41 / 266** | **64 / 266** |
| the same with the DARK runtime pane flag set in the test process | 43 | 66 (+ inside-bar-range, wyckoff-accumulation-distribution; nothing else) |
| translation census (member door, pane on): door ok / served outputs / `colorDynamic` / dropped colour props | | 67 / 733 / 98 / 103 sites |

The 202 that do not attach with the pane on, by the door's first refusal: `pine:no-output` 31,
`pine:module` 30 (imports), `pine:declaration-strategy` 25, `pine:state` 16, `pine:reassign` 15,
`pine:request` 15, `pine:block` 10, `pine:collection` 9, `pine:function` 7, `pine:tuple` 6,
`pine:object-removal-lost` 6, `pine:function-def` 4, `pine:type` 4, 3 each `pine:statement` /
`pine:builtin` / install-door, 2 each `pine:na` / `pine:timeout` / `pine:input-kind` / `pine:text-value` /
`pine:window` / "declares nothing a chart can draw", 1 each `pine:arity` / `pine:cycle` / a translator
throw. 86 of them (imports, strategies, no output) are not this program's to attach. The runtime pane
would take 2 of the 16 `pine:state` refusals.

### Captures still owed — one table

"Probe" is a file under `tools/visual_conformance/probes/`. Rows marked **no probe** are named in a
section as the capture that would settle a refusal, and have no probe file: writing one is the first step.

| # | probe | symbol / timeframe | settles | unblocks | queue doc |
|---|---|---|---|---|---|
| 1 | `vw-forin-collections.pine` | NYSE:RDDT 1D, from the listing | a body that changes the list it walks (F03–F05); `for b in box.all → box.delete(b)` over two or more (A02, A04, A05); a position in `<family>.all` (A06); a drawing list created with slots (Z01–Z03) | market-structure-break-order-block, stop-loss-clustering, trendline-pivots-quantvue; trend-lines' `f_clearAll` once its creates convert | `capture-queue-2026-09-30-forin-collections.md` |
| 2 | `vw-call-site-history.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D as a second witness | every other `ta.*` on its first run; `bar_index[k]`, `time_close[k]`, `hlcc4[k]`; an offset of 0; MANY executions under `close > open` (block and helper) | candlestick-patterns-on-backtest (287 refusals), mgi-levels-suite (79), ict-institutional-order-flow, smart-money-concepts-by-welotrades, smt-divergence-ict-killzones | `capture-queue-2026-09-30-call-site-history.md` |
| 3 | `vw-time-tf.pine` + `vw-time-close-tf.pine` | AMEX:SPY 1D, FULL history (Q-T5) | a period whose calendar first / last session has no daily bar (holidays before 2000, 2001-09-11..14) | lifts `time-anchor:session-open-missing` / `time-close:period-end-missing` | `capture-queue-2026-09-30-time-anchors.md` |
| 4 | the same two | FX:EURUSD 1D (Q-T2) | which weekend bars exist and which bar opens the week | `time-anchor:weekend-bars` | same |
| 5 | `vw-time-tf.pine` | AMEX:SPY 5 and 15 (Q-T3) | `time(timeframe.period)` and `time("60")` below 60m | `time-own:chart-unwitnessed` on intraday charts | same |
| 6 | the same two | AMEX:SPY 1W and 1M (Q-T4) | the anchors on a chart above daily | `time-anchor:not-daily`, `time-close:not-daily` | same |
| 7 | `request-realtime-alignment.pine` | AMEX:SPY 5m, market OPEN, newest bar forming | `lookahead` at a timeframe above the chart's on a forming bar | the realtime half of every higher-timeframe request | `OWNER-CAPTURE-PACKET.md` row 3 |
| 8 | `vw-mintick.pine` (re-run) | 1D on AMEX:IMO, CBOE:ARKK, NASDAQ:QQQ, AMEX:XLK, a NASDAQ warrant, a unit, a NYSE preferred | `syminfo.mintick` for the listing classes the table does not serve — and whether the NASDAQ / NYSE rows are too broad | every exchange `mintick` refuses on today | `capture-queue-2026-09-27.md` §9 |
| 9 | `vw-lower-tf.pine` with rows at `"1"` and `"30"`, and on a 1M chart | AMEX:SPY 1D / 1M | the codes and chart C41 leaves `lower-tf:unwitnessed`; `lookahead_on` on a second symbol | the rest of the lower-timeframe requests in the corpus (13 scripts use `request.security_lower_tf`; none attaches) | `capture-queue-2026-09-30-lower-tf.md` + C41's section |
| 10 | **no probe** — the chart theme (C37 calls it `vw-chart-theme.pine`) | any symbol, under a solid light, a solid dark and a gradient background | what `chart.bg_color` is under a gradient | `theme:gradient-background` | none yet |
| 11 | **no probe** — gradient and colour-component rows | AMEX:SPY 1D | `top == bottom`, an `na` bound, a gradient between gradients; `color.r/g/b/t` of an eight-digit literal, an `input.color`, a per-bar transparency | `pine:colour-value` forms; the held gradient cases (C29, C37, C38) | none yet |
| 12 | **no probe** — `max_bars_back(x, n)`, a declared buffer overrun, an index that moves only with `barstate.*` on a forming bar | AMEX:SPY 1D | three `pine:offset-literal` refusals (C38) | high_engagement__20-ehlers-fisher-transform and the per-series buffer | none yet |
| 13 | **no probe** — a negative getter coordinate (`x1 + avg + 1 < 0`) | any | whether `truncNegative` is the right wall (C43) | getter arithmetic in a bar coordinate | none yet |
| 14 | **no probe** — a script leaving a v6 box fill / cell text and a v4 box border unset; one drawing ict-killzones' two cell fills | NYSE:RDDT 1D | the version defaults C37 could not read | C37's "still not carried" rows | none yet |
| 15 | **no probe** — a request for a symbol that does not exist with `ignore_invalid_symbol` | any equity | position-size-calc's tenth cell | that script | none yet |
| 16 | not a TradingView capture: our `/api/bars/RDDT?tf=15` payload beside `vw-bar-counters-rddt-15` | — | whether OUR intraday bars agree with TradingView's | a precondition C41 names for arming its flag | C41's section |

Not owed (taken): `OWNER-CAPTURE-PACKET.md` rows 1–2 and every probe in its 2026-09-30 results;
`vw-lower-tf` on SPY 1D / 1W and RDDT 1D; RDDT 5 / 15 / 60 / 240 bars (in `vw-bar-counters-rddt-*`);
`vw-runtime-error` control and reached; `vw-int-array-avg`; `vw-fn-series-history`; the BTCUSD and SPY
time-anchor and time-close captures; `vw-bool-cast` (v4, v5), `vw-var-seed`, `vw-deadband-ticks` ×3.

### Measured (base `e4e24524ef` → tip, protocol items 1–6)

| | base | tip |
|---|---|---|
| 1. 47, pane on: objects / overall / families / plots | 30 of 46 / 27 / 234 of 266 / 161 of 172 | old verdict unchanged, 0 entries; **new verdict 29 / 26**, colour families 72 of 73 |
| 1. 47, pane off | 18 of 25 / 15 / 108 of 119 / 140 of 151 | old unchanged; **new 17 / 14** |
| 2. harness dir (117), on | 66 of 85 / 48 / 323 of 357 / 351 of 450 | old unchanged; **new 65 / 47**, colour families 98 of 99 |
| 2. harness dir, off | 54 of 64 / 36 / 197 of 210 / 330 of 429 | old unchanged; **new 53 / 35** |
| 3. member-door census 266 × 2 | 41 / 64 | 41 / 64, 0 rows; base-vs-base control 0 rows |
| 4. translation census 266 | ok 67, served 733 | identical, 0 scripts in every column |
| 5. bytes | notebook first-open 1,901,893 B (`notebook_perf_budgets` PASS); `pine` chunk 387,103 B; total JS 12,757,155 B (357 files) | +0 / +0 / +0 — ONE build, at the tip: no file a build includes differs between base and tip (`git diff --name-only e4e24524ef`: `tools/vendor_harness/compare.mjs`, files under `__tests__/vendorHarness/`, docs; no non-test file under `app/src` imports `vendor_harness`) |
| 6. `paramIds.test.js` | green | `Tests  4 passed | 1 skipped (5)`, no edit |

### Decisions — ruled, handed on, and left

1. **RULED:** colour is graded only on objects that are drawn (above). multi-timeframe-supply-demand-zones
   is back to MATCH with its 16 differing held slots counted.
2. **HANDED TO C45:** volume-profile's 200 lines held at their creation coordinates — a withhold.
3. **PROPOSAL, not built — promote "unpaired" to a position check.** The pairing matches each of our
   objects to a TradingView record BY VALUE (a line's two prices, a box's two prices, a label's text and
   price, a cell's table / address / text). An object we hold that pairs with nothing sits at a value
   TradingView does not hold; `objects.colourUnpaired = {ours, vendor}` already carries the counts.
   - *The rule it would add:* an object family whose COUNT agrees but which has an unpaired object of ours
     DIVERGES — "the same number of objects" stops meaning "the same objects".
   - *What it would move today (measured on this tree, pane on):* **nothing on the 47.** The only captures
     with an unpaired object of ours are volume-profile (200) and position-size-calc (1), both already
     DIVERGE on a count. In the committed harness dir, **keltner-center-of-gravity-channel-2026-09-30**
     (objects MATCH, 1 of ours / 1 of theirs unpaired among 2 tables and 3 cells) would go to DIVERGE, and
     must be traced first: it may be a table paired by position against a different `position` spelling
     rather than a wrong drawing. `vw-runtime-error` (54 / 50) already DIVERGES.
   - *What it would catch that nothing does now:* the volume-profile shape — creates that convert, moves
     that are dropped, a count that happens to agree; and any future capture where counts agree and
     positions do not.
   - *Its limits, to state with it:* it is a PRICE (y) check and a text check; a capture stores x as a
     dense rank, so x is not compared. It needs the same `undrawn` exemption (an object neither side draws
     has no position), and it needs unpaired reported per family rather than per capture.
4. **Six owed captures have no probe file** (rows 10–15). The rule says a refusal is queued with its probe;
   these were named in prose only.
5. **`bar_index` at the door** still keeps nine probes from MATCH as captured (C38's note, unchanged).
6. **C41 is not in wave 10.** Everything here that says "(iv) lower-tf" refers to a branch.
## C49 — the captured clock: period anchors, `time_close`, other chart timeframes, a request off its own timeframe (2026-10-01, step 59)

Branch `pine/c49-captured-clock`, on wave 10 at `e4e24524ef` with `origin/pine/captures-2026-09-30b`
(`97dea45492`, capture round 3: 21 sealed fixtures dated 2026-10-01) merged first (`654d99bd31`). Every rule
below was read off a fixture bar for bar with a calendar model written apart from the engine
(`scratchpad/c49/an_t5.mjs`, `an_tf.mjs`, `an_fx.mjs`) before it was served.

**PRIORITY 0 — nothing C30 / C36 served contradicts the full-history fixtures.** The base rule, through the
member door, on `vw-time-tf-spy-1d-full-2026-10-01` and `vw-time-close-tf-spy-1d-full-2026-10-01` (8,476
bars, 1993-01-29 on): **0 bars served wrong.** It withheld — T01 124 bars, T02 165, T03 414, T04 1,497; Q01
53, Q02 40 — and every one of those bars is now served or withheld by a named reason (table below).

**The rule, as implemented (one authority, both lanes).** For `P` in `W` / `M` / `3M` / `12M`:

- `time(P)` = 09:30 New York on the FIRST session the vendor's calendar holds in the period that contains the
  day the bar OPENED;
- `time_close(P)` = the close of the LAST such session (13:00 on a half-day the calendar applies).

The vendor's calendar is `tradingViewSession.js`: weekdays; the NYSE closures from
`TRADINGVIEW_CLOSURES_FROM` (2000-01-01) less the six days the vendor's own daily bars exist for
(2001-09-11..14, 2012-10-29 / 30); half-days from 2019 less 2020-11-27 and 2020-12-24.
`indicators.js::computePeriodCalendar` ⇄ `indicator_compute.py::compute_period_calendar` answer it per bar;
`interpret.js::chartClockValue` ⇄ `ast_interpret.py::_chart_clock_value` substitute the answer for the
recognised anchor / gate / period-close nodes of the saved tree when the chart's clock is a regular session
(`chartClockRegime` kind `session`). The saved tree itself is unchanged in meaning on an every-day chart
(C36's rule, BTCUSD) — the calendar is not consulted there.

| what the fixtures show | read off |
|---|---|
| the model reproduces every bar, opens and closes, `W` / `M` / `3M` / `12M` | 1D full 8,476 / 8,476; 1W 1,758; 1M 406; 15m 3,300; 5m 3,300; 60m (2026-09-28) 300 |
| before 2000 a holiday-opened period answers the CALENDAR day (a Monday holiday week opens Monday 09:30; no bar has that time) | 1D full, 1993–1999 |
| from 2000 it answers the first SESSION (the week opens Tuesday) | 1D full, 2000 on |
| the boundary is bracketed, not assumed: the last calendar-answered week closes Fri 1999-12-24; the first bars-answered holiday week opens Tue 2000-01-18 | 1D full; the constant 2000-01-01 sits inside the bracket |
| the period is keyed on the day the bar OPENED, not on the week's Monday: the weekly bars opening 2004-06-01, 2010-06-01, 2021-06-01 read June's open | 1W |
| C30's "a 60-minute chart follows a different rule" was bar 0's first partial week; the 60m fixture agrees with the calendar on all 300 bars | `vw-time-tf-spy-60-2026-09-28` |
| `time("60")` on a 5 / 15-minute chart is the 60-minute bucket counted from 09:30 | 5m, 15m (T06) |

⚰️ The assignment's wording "the month containing the week's Monday" is not what the weekly fixture shows;
the three June bars above settle it. A rail pins them (mutation C49-7).

**Served, and what stays withheld.**

| case | served | withheld, by name |
|---|---|---|
| `time(P)`, daily session chart | every bar, pre-2000 included | a period from 2000 on whose first session has no bar (`time-anchor:session-open-missing`): the Hurricane Sandy week, 3 bars |
| `time_close(P)`, daily session chart | every bar | a completed period from 2000 on whose last session has no bar (`time-close:period-end-missing`): the week of 2001-09-10, 1 bar |
| `time(P)` on 5 / 15 / 60 / W / M | regular-session bars | 1 / 30 / 240 and anything else (`time-anchor:not-daily`, Q-C3); a chart with bars outside the regular session (`time-clock:outside-session`, Q-C1) |
| `time_close(P)` on W / M | yes | below a daily chart (`time-close:not-daily`, Q-C2) |
| `time(timeframe.period)` | 5 / 15 / 60 / D / W / M | other chart timeframes (`time-own:chart-unwitnessed`) |
| `time("60")` | 5 / 15 (bucket from 09:30), 60 | others; off-session bars |
| FX / one weekend day | — | `time-anchor:weekend-bars`, `time-close:weekend-bars` (below) |
| bar 0 of a `ta.change(time(P))` row | — | the bar before the series is unknown; one bar |

The two exceptions from 2000 on are reproduced by the calendar and are still withheld, as instructed: each
is the one witness of its kind (SPY's history holds no other).

**FX (Q-T2) — not served, and why.** `vw-time-tf-fx-eurusd-1d-2026-10-01`: the vendor's daily bar opens 17:00
New York the evening before its date (Sunday to Thursday); the week opens on the calendar's Sunday 17:00.
This chart stamps a date-keyed daily bar at 09:30 New York on its date — 16.5 hours from the vendor's open —
and the store holds no FX bars at all. Serving a period anchor on that clock would be a right rule on a
wrong bar time, so it stays `time-anchor:weekend-bars`. What settles it is engine work (a daily bar stamped
at its own session's open), not a capture.

**⛔ A wrong value in production, found under item 4 and fixed.** The member door translates once, at base
period `D`, and the saved tree is bound on every chart. `request.security(syminfo.tickerid, "D", x)` folded
to `x`, so on a 5-minute chart the plot drew the 5-minute `x` as the daily one. On
`request-realtime-alignment-spy-5-2026-10-01` that was wrong on **299 of 300 bars** for look-ahead ON and for
OFF (max error 6.61 / 7.42), and R7 (`close[1]` off) with it; a `W` / `M` request was resampled from the
chart's intraday bars (a 60-minute-derived weekly close 761.64 against the daily 761.69). Ruling 3.5
(`tests/fixtures/vendor/divergences.json`) already said this case is refused rather than folded; the fold
escaped it because the refusal is taken at translation and the tree travels.

The fix: the translator writes the base timeframe into the tree — `requestBaseNode(base, child)` =
`<base seconds> != periodseconds ? na : child` — on the fold and on a `tf` / `tf_live` request, for the
chart's own symbol and for another symbol's (outside its `sym`). A chart that STATES another timeframe
withholds the column whole with `request:other-timeframe` (plots and objects, JS and Python); a caller that
states no timeframe evaluates the child as before. On the 5-minute fixture: 0 wrong, every request row
withheld. Daily values are unchanged (translation census: the trees gained the gate, no daily output moved).

What the witness says and is NOT served: on historical bars look-ahead ON reads the day's own close on every
bar; OFF reads the previous day's close except on the day's last bar; on the forming bar both read the
forming daily bar's current close. That needs the daily bars beside the intraday ones and a forming-bar arm,
neither of which the chart pane holds today. The caveat (the daily request and the 5-minute bar differ by a
tick: 762.63 against 762.46) means the daily value cannot be rebuilt from intraday bars either.

**Measured** (base `654d99bd31` = wave 10 + the captures; tip `9968cbf397`; the commits after it change a test ceiling and docs only).

| | base | tip |
|---|---|---|
| 47 captures, objects pane on: objects MATCH / overall / families / plots | 30 / 27 / 234 of 266 / 161 of 172 | 30 / 27 / **235** of 266 / 161 of 172 — 1 entry (high-low-open-mid-ranges lines 503 → 504, vendor 504) |
| 47, pane off | 18 / 15 / 108 of 119 / 140 of 151 | unchanged, 0 entries |
| harness dir (138 graded), on | 68 / 48 / 343 of 385 / 358 of 546 | 68 / 48 / 344 of 385 / 358 of 546 — 3 entries (the one above; the two `request-realtime-alignment` captures: R1 / R2 / R3 / R7 from a wrong value to withheld) |
| harness dir, off | 56 / 36 / 217 of 238 / 337 of 525 | unchanged counts — 2 entries (the two request captures) |
| member-door census 266 × 2 | attach 41 / 64 | 41 / 64; 3 rows per flag, the refusal sentence only; same-tree control 0 rows |
| translation census 266 | ok 44 / 67 | 44 / 67; 15 (off) / 19 (on) scripts' hashes move: 3 a sentence, the rest gained the request gate or the calendar nodes |
| notebook first-open | 1,901,893 B | 1,901,893 B (+0), `notebook_perf_budgets` PASS |
| `pine` chunk / total JS | 387,103 / 12,757,155 B | 387,405 (+302) / 12,764,535 (+7,380) |
| `paramIds.test.js` | 4 passed, 1 skipped | the same, no edit |

Through the door at the tip, on the fixtures: 1D full T02–T04 MATCH 8,476, T01 withheld 3; T07 withheld 5,
T08 / T09 1; Q01 withheld 1, Q12 2; 5m / 15m / 60m / 1W / 1M every row MATCH (bar 0 of an event row
withheld); BTCUSD unchanged; the request rows on 5m 0 wrong, all withheld.

**Pins re-measured, with the reason at each.** `vendorHarness.c30TimeAnchor`, `vendorHarness.c36TimeFollowups`,
`ast/clockCloseTfChange.vendor` (K14 withheld = 1993-01-29, 2012-10-31..11-05; K15 = 1993-01-29),
`chartClockNotice` (the unmeasured chart is 30 minutes now), `ast/periodAnchorParity` (+6 bar sets: 1999
holidays, 15m RTH / extended, 60m, weekly, monthly), `objectFnInline.vendor` and
`vendorHarness.c33ObjectReads` (OHLM lines 503 → 504), `runtimeWallsC23` (the gated formula),
`tools/lookback_agreement.json` regenerated by its own test (426 → 458 trees).

**Mutation proofs** — 111 mutations, each alone, bytes and sha256 captured, restored by bytes, sha verified,
never while a suite ran: C30's set 15, C36's 40, C49's 25, the Python lane 31. **110 RED, 1 survives:**
`C30-M5b` (the calendar's week starts Sunday instead of Monday) — no NYSE session falls on a weekend, so on a
session chart the two weeks hold the same sessions; the every-day chart does not consult the calendar and its
own Monday rule (`C30-M5a`, the tree) is RED on BTCUSD. Reported as an equivalent mutation on today's
reachable inputs, not as a proof.

**Stays refused, and the capture that settles it** (`docs/pine/capture-queue-2026-10-01-c49-clock.md`, probe
`tools/visual_conformance/probes/vw-request-htf-alignment.pine`):

| refused | settles it |
|---|---|
| a `request.security` at another timeframe, on a chart that is not the tree's base (`request:other-timeframe`) | Q-R3 (5 / 60-minute, W / M / 60 requests) plus daily bars beside the chart's own |
| periods and `time("60")` on a chart with extended-hours bars — the product's intraday default | Q-C1 |
| `time_close(P)` below a daily chart | Q-C2 |
| 1 / 30 / 240-minute charts | Q-C3 |
| FX / one-weekend-day symbols | engine work: a daily bar stamped at its session's open |
| the Sandy week, the week of 2001-09-10 | a ruling, or a second witness |
| `time_close("3M" / "12M")`, `time_close(timeframe.period)` | witnessed on the 1D-full / tf fixtures; refused at translation still — not built in this lane |

**For the integrator.** (1) The two exceptions from 2000 on are reproduced by the calendar; serving them is
one line in `periodAnchorMask` and your ruling. (2) ⚠️ `tf` (look-ahead off) on a DAILY chart reads the last
CLOSED week / month on every bar; packet #3 measured, one timeframe down, that the bar which completes the
period reads that period's own close and the forming bar reads the forming one. If that holds for W / M on D,
every look-ahead-off weekly / monthly request is wrong on 1 daily bar in 5 / 1 in 21 and on the forming bar.
Not witnessed, not changed; Q-R1 / Q-R2 queued first. (3) `_folds.baseTimeframeFolds.memberNote` and the 3.5
divergence row still describe the fold as differing "by one bar" intraday; the text is stale, left for the
owner of that ledger. (4) The dark runtime lane (`VITE_PINE_RUNTIME_PANE_ENABLED`) folds the same identity
and is not gated here. (5) `time("D")` on an intraday chart, and bare `time` / `time_close` on a chart whose
clock is unreadable, are untouched. (6) A 1W / 1M chart is always read as a session chart: it cannot show
whether its symbol trades every day, so an every-day symbol's weekly chart is answered from the session
calendar on the New York stamp C36 already recorded as not the vendor's. Stated in `chartClockRegime`.
## C48 - what capture round 3 (2026-10-01) witnesses in the object / call-site / colour area, served or refused by name (2026-10-01, step 58)

Branch `pine/c48-captured-objects`, base `integrate/wave10-2026-10-01` @ `e4e24524ef`; first commit merges
`origin/pine/captures-2026-09-30b` (`97dea45492`, the 21 fixtures sealed 2026-10-01). Every claim of
`docs/pine/OWNER-CAPTURE-PACKET.md` § "Results - capture session 2026-10-01" in this area was re-derived
from the fixture's own rows and objects before anything was served; each rail below starts with that
re-derivation.

### PRIORITY 0 - were wrong values live?

**(a) `bar_index[k]` in code that runs once.** No. In a BLOCK (`if barstate.islast`) it was already the
chart's value (rows A13 / C06 of `vw-call-site-history`, graded); C42's `CALL_OWNED_SERIES` `na` is applied
only inside an inlined HELPER body, where the capture also prints `na`. **Two neighbouring reads were wrong
and are fixed:**

- object lane: a block LOCAL's `bx[1]` under `barstate.islast` printed the every-bar number (284.88 on RDDT)
  where TradingView prints `NaN` (A12). Now `na`.
- plot lane: a `ta.*` call, a block local's `[k]` and a helper's own history inside a block that runs on
  SOME bars were read the every-bar way. On `vw-call-site-history-rddt` the ten rows C01-C05 / H01-H05 were
  wrong on 205 / 239 / 242 / 307 / 163 and 163 / 163 / 242 / 151 / 163 of 634 bars; a destructured helper
  tuple in such a block was not marked at all. Now each such plot carries the block's guard
  (`definition.meta.blockRuns`) and the BIND refuses it, by name (`pine:block`), on a chart where the block
  runs after a skipped bar; a block that runs on every bar (or never) keeps its plot.
  A tuple is gated part by part: a part whose own expression reads none of the call's history
  (`partReadsCallHistory` - H06, `volume[1]`, the chart's on 317 / 317 run bars) keeps its plot.
  **Corpus exposure: 0 of 266 door rows changed and 0 served outputs changed** - two corpus scripts read a
  marked conditional call (deadband-hysteresis-filter-backquant, renko-candles-overlay) and neither
  attaches. The owner's `uncharted-volume-v2` keeps every plot (its block runs on every daily bar); its
  document gains the `meta.blockRuns` stamp and nothing else (compute and objects byte-identical).

**(b) a gradient between colours of different transparency.** No, for the blend: `fromGradient`
(`runtime/colours.js`), its tree spelling `gradientChannelTree`, and C37's plot / object gradients are EXACT
on `vw-colour-components-spy-1d-2026-10-01` - 12 gradient rows x 300 bars, **3,600 of 3,600 component-bars**
(B01-B04, G05-G08 and the nested G01-G04 computed by the function), and 42 served component rows MATCH
300 / 300 through the member door. Same-transparency gradients are unchanged (C37's rails, no edit).
**The EDGES were wrong or unmeasured, and are now what the capture shows:** equal bounds and an `na`
bound / value answered "no colour" (held) - TradingView answers r = b = 0, t = 100; reversed bounds
(bottom > top) were MIRRORED - TradingView answers the bottom colour while the value lies between them. No
corpus script writes literal reversed or equal bounds (one, bull-vs-bear-market-intraday-sessions, has
per-bar bounds `neg.max(), neg.min()` and does not attach), so no member drawing moved.

### What is served, rule by rule

| capture | rule, as implemented | where | rail (all under `__tests__/vendorHarness/`) |
|---|---|---|---|
| `vw-call-site-history-rddt-1d` / `-spy-1d` | **One run** (a guard that is provably `barstate.islast`): `ta.lowest(x, n)` and `ta.highest(x, n)` read the bar's x; one-argument `ta.highest(n)` the bar's `high`; `ta.sma(x, 1)` x; `ta.cum(x)` x; `ta.ema` / `ta.rsi` / `ta.stdev` (length >= 2 literal), `ta.atr(n)`, `ta.change(x)`, `ta.sma(x, n >= 2)` `na`; a block local's `[k >= 1]` `na`; in a helper `time_close[k]` / `hlcc4[k]` are the chart's, `x[0]` / `src[0]` the current value. `ta.rsi` / `ta.stdev` / `ta.atr` / `ta.change` / `ta.cum` are served in a BLOCK only (the helper rows of the capture do not print them). | `objectFnInline.js::ONE_EXECUTION_TA`, `oneExecutionTokens`, `CHART_SERIES_WITNESSED`; `pine.js` fold marks (`blockLocal`, `execGuard`), `Resolver.blockLocalHistory`, `resolveBinding`; `engine/blockRuns.js`; `nativeRegistry.astColumnsFor`; `memberPaneDefinition` (`meta.blockRuns`) | `vendorHarness.c48CallSite` - RDDT 24 / 24 labels text for text, SPY 22 + the two bar-count rows |
| `vw-colour-components-spy-1d` | the gradient formula unchanged; equal / `na` bounds -> the zero colour; reversed bounds, value between -> the bottom colour; the components (`color.r/g/b/t`) of an 8-digit literal, an `input.color` default, a ternary of colours, a per-bar transparency on a fixed base when the number provably stays in 0..100, a gradient with fixed ends and literal / `na` / per-bar bounds | `runtime/colours.js::fromGradient`, `gradientChannelTree`, `GRADIENT_ZERO_COLOUR`; `pine.js::witnessedColourOf`, `transparencyRange`, `gradientPositionTree`; `objectRuntime.js` (`grad`), `pool.js::gradientPointColour` | `vendorHarness.c48ColourComponents` - 42 rows 300 / 300 |
| `vw-input-tf-text-v5-spy-1d` / `-v6-spy-1d` | an `input.timeframe` default prints VERBATIM under v5 and v6 (the two-entry witness table is the rule); `timeframe.period` is `D` under v5, `1D` under v6 | `pine.js::INPUT_TIMEFRAME_TEXT_WITNESS`, `inputTimeframeTextWitnessed`, `periodTextOf` | `vendorHarness.c33ObjectReads` (C48 block) - both fixtures' ten labels text for text |
| `vw-int-array-avg-neg-spy-1d` | a float handed to an `int` bar coordinate is truncated TOWARD ZERO, negative included; a negative bar index is no error. Also `l.set_x2(a.avg())` - a plain per-bar float coordinate - is truncated where the property takes its value (it was written as -1.5) | `objectRuntime.js` (`trunc`, `resolveProps`) | `vendorHarness.c48IntAvgNeg` - 11 rows |
| `vw-getter-history-spy-1d` | `str.tostring(line.get_y1(l))` prints the live number; `line.get_y1(l)[1]` is the number one BAR ago; inside the last-bar block it is `NaN`; a TOP-LEVEL variable holding a getter reads its previous-bar value from anywhere (`{v:'num', back: 1}`); `line.get_y1(c[1])` reads the handle the variable held a bar ago, `na` once that line was deleted | `objectRuntime.js` (`textTainted`, `tainted` `get`, `numsPrev`, `deepestBack`), `objectProgram.js`, `pine.js::getterRef`, `stateOperand`, `objectFnInline.js::getterScalars` (`top`) | `vendorHarness.c48GetterHistory` - ten rows as a label per bar, 300 / 300 each, on the vendor's bars from the listing |
| `vw-forin-collections-rddt-1d` | `for x in <own list>` whose body shifts / pushes / sets walks the LIVE list (`live`: the length is re-read before each pass, the slot copied as the pass starts); `<family>.all` is a SNAPSHOT (a walk that deletes or creates runs one pass per object it started with); a position in `<family>.all` is the object's place, oldest first (`pos`; withheld for a family with a lost or withheld create); `var ... = array.new_label(3)` holds three `na` slots (`slots`) | `pineObjects.js::forInPlan`, `FOR_IN_LIVE_WITNESSED`, `witnessedSlots`; `pine.js` loop conversion; `objectProgram.js`; `objectRuntime.js` (`loop`) | `vendorHarness.c48ForIn` - the probe's drawing steps replayed: 24 lines, 3 boxes, 5 labels, every y, length and text |

### What stays refused, and the capture that settles it

Probes under `tools/visual_conformance/probes/`, queue `docs/pine/capture-queue-2026-10-01-c48.md`.

| refused, by name | probe |
|---|---|
| `ta.highest` / `ta.lowest` in a block that runs on SOME bars (C01 / C02 / H04 fit neither "last N bars" nor "last N runs") | `vw-cond-window-extremes` |
| the gradient's zero colour `g`, the reversed-bounds bottom colour's `g` / `b` (served by inference - the rows print r, b, t and r, t), reversed bounds with the value outside them (held) | `vw-gradient-edges` |
| a getter number from two or more bars back; a scalar's `[2]`; a getter's `[1]` in a block that runs on some bars when the previous bar did not run it | `vw-getter-history-2` |
| a body that changes its list by `remove` / `pop` / `unshift` / `insert` / `clear`, reassigns it, or hands it to a helper; `array.new_x(n, na)`, a non-literal size, a sized list without `var`; positions after the collector evicted | `vw-forin-collections-2` |
| `ta.rsi` / `ta.stdev` / `ta.atr` / `ta.change` / `ta.cum` inside a HELPER called once; `ta.wma` and every other `ta.*` on one run | `vw-once-ta-helper` |
| a gradient between gradients (G01-G04), a user colour helper (U01 / U02), a per-bar transparency not provably within 0..100, `color.new` over a colour that moves | none needed for G01-G04 (the formula is exact; what is missing is the per-component end as a tree) |

**A call, a block local or a helper's history in a block that runs on MANY bars is NOT served, and is not
waiting on a capture.** Round 3 shows the rule and it was verified on the fixtures before deciding (RDDT:
`ta.sma` and `ta.ema` windows count RUNS, the EMA seeded by the SMA of the first n runs; `x[1]` and a helper
parameter's `[1]` are the previous RUN's value; a call-owned `bar_index[1]` is the previous run's index; a
chart series' `[1]` in a helper is the chart's - C03-C05, H01-H03, H05, H06 at 307 / 307 and 317 / 317).
What serving needs, precisely:

1. the previous-run read. The columnar engine already has it exactly: `ta.valuewhen(G, x, k)`
   (`interpret.js::valueWhenOccurrence`, an unbounded forward scan) is x on the k-th previous bar where the
   block's guard G held. So `x[k]` -> `valuewhen(G, x, k)`, `ta.sma(x, n)` -> the mean of
   `valuewhen(G, x, 0..n-1)`, `ta.change(x)` -> `x - valuewhen(G, x, 1)`, a call-owned `bar_index[1]` ->
   `valuewhen(G, bar_index, 1)`. No budget moves for small n (n value-when nodes over one shared guard
   subtree, inside the 128-node cap).
2. three things the rewrite must get right before it draws: G must read an `na` condition as "did not run"
   (`valueWhenOccurrence` CLEARS its occurrence list on a NaN condition bar; TradingView keeps it); G must be
   the guard as it stood at the `if` (the fold's `execGuard` chain of bound nodes - not the condition's tokens
   re-read after the block reassigned a name the guard reads); and on a chart that does not start at the
   listing the first run(s) in the window read `na` where TradingView reads a value, which the object lane
   must mark unknown (C17) rather than print as `NaN`.
3. `ta.ema` / `ta.rsi` / `ta.atr` / `ta.stdev` over runs are recurrences over RUNS: they need a recurrence
   stepped by a guard (seeded as the capture shows), which `MAX_RECURRENCE_STEPS` does not express today.

It was not built in this lane: it is a new mechanism in both lanes with its own rails, and the plots it would
light are refused correctly today.

### Measured (base = `ac4e9d4a00`, wave 10 + the capture merge; tip = `df2435843b`)

| | base | tip |
|---|---|---|
| 47 captures, objects pane ON: objects MATCH / overall / families / plots | 30 of 46 graded / 27 / 234 of 266 / 161 of 172 | 30 of 46 / 27 / 234 of 266 / 161 of 172 (no entry moves) |
| 47 captures, pane OFF | 18 of 25 / 15 / 108 of 119 / 140 of 151 | 18 of 25 / 15 / 108 of 119 / 140 of 151 (no entry moves) |
| committed harness dir (138), pane ON | 68 of 91 / 48 / 343 of 385 / 358 of 546 | **71** of 91 / 48 / **350** of 385 / 358 of 546 (6 entries move) |
| committed harness dir, pane OFF | 56 of 70 / 36 / 217 of 238 / 337 of 525 | **59** of 70 / 36 / **224** of 238 / 337 of 525 (6 entries move) |
| member-door census, 266 x both flags: attach | 41 / 64 | 41 / 64, **0 rows changed** |
| translation census (266): ok off / on, served outputs | 44 / 67, 818 | 44 / 67, 818 - 2 rows (off) / 3 rows (on) changed, **0 served outputs** |
| notebook first-open / pine chunk / total JS (bytes) | 1,901,893 (PASS) / 387,103 / 12,757,155 | 1,901,893 (+0, PASS) / 396,623 (+9,520) / 12,768,773 (+11,618) |
| `paramIds.test.js` (no edit) | 4 passed, 1 skipped | 4 passed, 1 skipped; `docs/pine/param-ids.json` untouched |

Base-vs-base control: door and translation censuses byte-identical (0 rows). Every entry of the 47 is
unchanged. Harness-dir entries that move, both flag states: `vw-call-site-history-rddt` objects DIVERGE ->
MATCH (labels 5 -> 24 of 24, text for text; its ten gated plots DIVERGE -> not graded, overall DIVERGE ->
INCONCLUSIVE), `vw-call-site-history-spy` labels 5 -> 24 of 24 with the two bar-count texts still differing
(a 300-bar window counts bars from 0), `vw-input-tf-text-v5` / `-v6` objects DIVERGE -> MATCH (10 of 10),
`vw-colour-components` / `vw-theme-colours` refusal sentence only (the door still refuses each on a row
that stays refused). `vw-forin-collections`, `vw-getter-history`, `vw-int-array-avg-neg` stay INCONCLUSIVE
at the door (their PLOT rows are counters and getters the plot lane does not carry); the rails replay them.

Translation census rows that move: average-day-range-adr-pivots (object program - its `(W)` / `(M)` texts
are read; the picture is the same, TradingView deletes those boxes the bar it makes them),
smt-divergence-ict-killzones and double-topbottom-ultimate-os (object diagnostics only; neither attaches).

The object lane's own reading of the 266 (non-strict translate, every script): 15 scripts move.
`input.timeframe:unwitnessed` refusals 7 scripts -> 0 (delta-imbalance-map-joat, elliot-wave-detector-pro,
fibonacci-retracement-mtflog, renderingnature-smc-reversal-engine-v71, smarter-snr,
smoothed-gaussian-trend-filter-algoalpha, volume-footprint-...). `coll:sized` 10 scripts -> 5: the sized
lists of auto-harmonic-patterns, linear-regression-channel (both), market-profile-with-tpo,
market-structure-break-order-block and two of stop-loss-clustering's four are modelled and each list now
stops on its NEXT wall, named (`guard:coll_set`, `coll:set`, `loop:box.delete`, `coll:push`, `guard:loop`);
the rest keep `coll:sized` (a size that is not a literal, a UDT field). No corpus program carries a served
`slots` list or a `live` walk yet. **market-structure-break-order-block**: its four walks stay refused - the
body hands the list to a helper (`f_delete_box(bu_ob_boxes)`), sentence now "... by more than push / shift /
set"; probe row G07. **trend-lines-supports-and-resistances**: unchanged (its `f_clearAll` walks run as
before; the 47 entry does not move).

### Proof

Rails: `vendorHarness.c48CallSite` (33), `c48ColourComponents` (15), `c48IntAvgNeg` (4),
`c48GetterHistory` (25), `c48ForIn` (10), the C48 block of `vendorHarness.c33ObjectReads`, and
`__tests__/objectForInLoops`. Re-pinned with the reason in the test: `objectFnInline.test`,
`c34ChartSeries`, `c31Loops`, `c42OneExecution`, `c43IntAvg`, `c33ObjectReads` (ast + vendor),
`colourComponents`, `colours`, `c18WhileAndLastBar`, `objectColourNodes`, `pineGradientColour`,
`bindingsAreVisible`, `closingPassDoesNotMint`, `objectForInLoops`.

Mutations: 74, each applied alone - bytes and sha256 captured, mutated, rails run, restored by bytes, sha
and `git status` verified after each; controls green before and after. 66 ran on `9774e28e4a`; that pass
left 5 survivors, four of which were missing rails and are RED now (the mint-only read of a one-run
binding, two arms of the plot gradient's position, a scalar's previous-bar taint); 5 for the tuple-part
rule and 3 for the gate's place at the bind ran on the commits that added them, one more survivor closed
(the single-tree document's gate). **72 RED, 2 survive, both fail-closed arms nothing servable reaches:**
`m61` (a for-in over a bounded numeric WINDOW whose body writes it - `forInWindow` already answers false
for such a window, so the refusal beside it never fires) and `m71` (the catch-all of
`partReadsCallHistory` - every node shape outside its walk is refused at translation for its own reason).

The full chart suite on the first tip found one defect of this lane's own: the bind asked the block-run
gate BEFORE the plot's own tree, so a plot that could not be computed at all (an unresolved symbol) was
reported as a block refusal (`builder/memberPane/symbolThread.test.js`, 3 cases). The gate is asked after
the tree now (`d72ced8037`); a tree that throws keeps its own reason.

### Found on the way, not changed

- **A drawing list declared WITHOUT `var` is kept across bars** (`line[] a = array.new_line()` at the top
  level, pushed and capped every bar: a 60-bar hand run holds 1 line here, where a list made anew on every
  bar never has two to cut and holds 60). Pre-existing, the same at the base. From source: 17 corpus scripts
  declare one, most as a UDT field or inside a function; of the door-attached, sector-rotation draws nothing
  (withheld) and htf-candle-footprint-cartel-console is already DIVERGE (boxes 3 of 13). Probe rows S03 /
  S04. The once-run blocks this lane serves are unaffected (one run, one list).
- `scriptBoundNames` takes every name up to a statement's first `]` as script-bound, so a tuple RETURN that
  opens with `volume[1]` makes `volume` the script's own name there (fail-closed; the read is refused).
- `OBJECT_STATUS.UNWITNESSED` has no producer left (the `.all` walk was its only one); the status and its
  member sentence are kept for the next unwitnessed stop.

### Decisions left for the integrator

1. The SCREENER lane still reads a conditional call the every-bar way (unchanged on purpose - nothing binds a
   chart there, so there is no bar series to test the guard on). Refuse it there, or leave it.
2. A document saved before this lane carries no `meta.blockRuns`; it is gated the first time it is
   re-translated.
3. The block-only `ta.*` rows are refused inside a helper (strict reading of the capture). `vw-once-ta-helper`
   settles it.
4. The zero colour's `g` and the reversed bottom colour's `g` / `b` are served by inference.
   `vw-gradient-edges` settles it; until then say the word and they are withheld instead.
5. In the plot lane a `NaN` gradient position still draws the series colour (an uncomputable warm-up bar and
   Pine's `na` are the same NaN there); the object lane and the component trees answer the zero colour.
6. Many-run serving (above) is expressible with `ta.valuewhen` and was left out.
7. The non-`var` drawing list (above) is live and wrong for any pasted script that caps such a list; refuse
   it by name (`coll:not-var`) until S03 / S04 are captured, or model it as cleared at its declaration.

## C46 — a parameter id is the input call's place in the source, not its turn in the walk (2026-10-01, step 56)

Branch `pine/c46-param-id-stability`, base `e4e24524ef` (wave 10). A member's saved indicator addresses its
adjustable inputs by `__uct_param_N`. `N` was a counter, and what it counted depended on what the translator
could fold, so seven lanes stopped at "that would move a saved id" (C9, C10, C24, C31, C33, C38, C41).
`N` is now read off the script's token stream before a statement is walked.

### 1. How an id was assigned at base (it was not written down in one place)

| | at base `e4e24524ef` |
|---|---|
| mint site | ONE: `pine.js::Resolver.resolveInput` → `mintEntry`, reached from any resolve that meets an `input(…)` / `input.*(…)` call node. Two call points inside it: the folded-literal path, and the declared path for a name listed in `mintDeclared` |
| mintable when | the translation asked for a manifest (`paramManifest: true`); the call is the WHOLE right-hand side of a binding (`stampInputName` → `boundName`); its kind is `input` / `int` / `float` / `bool`; its default folds to a finite number |
| the number | `paramMint.counter`: one counter per `translatePine` call, shared by every output's Resolver. `+1` the FIRST time an input is resolved; later resolves reuse the entry by the call node's object identity |
| ordering rule | so an id is the order of FIRST RESOLUTION: outputs in source order (an output that ends refused still mints everything it reached before refusing), and inside an output the resolver's own order — operands left to right, a comparison's operands through the C24 probe first |
| it also depends on the DOOR | both member doors translate through `builderInputs.memberInputTranslation`, which DECLARES every input a formula can carry as an identifier; a declared input does not mint (unless `mintDeclared` names it). Only what must stay a literal (a window length, a plot offset) mints. Same script, different set, different numbers |
| "withheld mint" | a pass that resolves with `paramMint = null` (or a colour rule carrying `withholdMint`), so reaching an input creates no id. Two different reasons used one mechanism: **(i)** the input must not become a member control — the closing pass over unread bindings (R13), presentation folds (R36), `runtime.error` conditions (C43), the object pass; **(ii)** only so the counter would not advance — C33's `tf` parameter kept off the plot lane, C37's "a rule carried for the first time mints nothing", C10's dead-arm rescue confined to the object pass, C9's pre-check reverted, C24 keeping the first probe un-skipped |

**The pinned lane is not a lane a member saves from.** `docs/pine/param-ids.json` (`paramIds.test.js`) pins
`translatePine(src, {strict, paramManifest})`. PineBox and the member pane both go through
`memberInputTranslation`. Measured at base over 328 scripts (266 corpus, 4 member fixtures, 58 `pine_oos`; the
29 licence-held `pine_oos` sources are not in the checkout and were read from copies on this machine verified
against `MANIFEST.json` — 14 by `sha256_source`, 13 by `sha256_normalized`, 2 re-fetched from the public script
page and verified the same way; nothing licence-held is committed), each minted input keyed by its call's
position:

| lane | scripts that mint | scripts where an input holds a DIFFERENT id than in the pinned lane | ids |
|---|---|---|---|
| plain strict (`param-ids.json`) | 183 | — | — |
| plain screen (`{paramManifest}`) | 180 | 6 | 32 of 794 |
| member pane (`memberPaneDefinition`) = PineBox strict (identical on all 328) | 174 | 37 | 133 of 634 |
| PineBox screen | 173 | 40 | 132 of 631 |

The member-pane door builds 56 of the 328; 41 carry a manifest, 98 ids. **35 of those 98 saved ids (14
documents) address an input that holds a different id (21) or no id (14) in `param-ids.json`.** And three
licence-held scripts had already drifted in the pinned lane itself, unseen because their sources are absent on
this rig (`paramIds.test.js` skips them by name): `long_tail__19-session-fibs`,
`mid_engagement__07-3way-bollinger-trend` (4 of 7 ids), `mid_engagement__09-relative-volume-breakout-context`.

### 2. Why the three ids moved — re-measured on this tree under the counter, then under the source rule

Each change applied alone to base `pine.js`, `paramIds.test.js` read; then the same change applied to the tip.

| case | the change | under the counter (base + the change) | under C46 (tip + the change) |
|---|---|---|---|
| C31 — the loop step-over in the main walk (its mutation M4) | `if (!(ctx && ctx.loopStepOver))` → `if (false)` | 13 rows in 8 scripts. **One real move**: `long_tail__09-signal-follow-through-ledger` — `__uct_param_2` was "Mark where each sample…", becomes "Reference MA length"; "ATR length" takes `_3`; "Mark where each sample…" goes to `_4`. A chain that now folds lets an output ABOVE resolve past its old `pine:reassign` and reach two inputs before the walk reaches the output that minted "Mark where…", so they take its number (3 rows). The other 10 rows, in 7 scripts, are inputs first reached AFTER every existing one, appended at the end of the counter: anchored-vwap-pinch `_13` `_14`, delta-imbalance-map `_1` `_2`, kalman-price-filter `_2`, smt-divergence-ict-killzones `_1`, volatility-coil-edge `_3`, reversal-probability-profile `_3`, structure-participation-matrix `_1` `_2` | 12 rows, all gains, none moved: each new id is `1000 +` the input call's ordinal (`_1066` `_1074`, `_1002` `_1003`, `_1004`, `_1003`, `_1002`, `_1022`, `_1005` `_1012`, `_1001` `_1003`) |
| C38 — `x[barstate.isrealtime ? 1 : 0]` served | the `reads.onlyBarState` arm of `historyReadOf` removed | `high_engagement__20-ehlers-fisher-transform` resolves one wall further (to `pine:state`) and reaches `Length` for the first time: gains `__uct_param_2`. No existing id moves | gains `__uct_param_1005`. No existing id moves |
| C41 — a dead `ltf` arm collapsed in the plot pass | not re-measured: C41's branch is not in this base | its statement (§ C41, item 9): outputs that refused start to translate and reach inputs earlier in the walk — the C31 shape | by construction the same as the two above: gains only |

(C31 at wave 8 reported anchored-vwap-pinch, delta-imbalance-map and kalman gaining and volume v2 LOSING one.
The three gains reproduce; the loss does not on this tree.)

So one of the three was a renumbering and two were appends. The rail could not tell them apart — it compares
whole maps — and under the counter nobody could promise the next append would not be a renumbering.

### 3. The rule as implemented

| what | rule (where it lives) |
|---|---|
| the ordinal | the 1-based position of the call among the script's `input(…)` / `input.*(…)` calls of EVERY kind, in token order (`paramIdSource.js::inputCallSites`). Counted over the token stream: no parse, no binding, no resolved value |
| a source id | `__uct_param_<1000 + ordinal>` (`SOURCE_ID_BASE`, `paramIdFor`). The largest legacy id is 28, so a source id can never be the number of a legacy id |
| a legacy id | `paramIdLegacy.js`, FROZEN: for the 183 scripts that held an id at base, which ordinal held ids 1, 2, 3 … — per lane. The script is found by a hash of its token stream (`scriptKey`), so line endings, blank lines and comments do not make a paste a different script; one changed token does, and an edited script takes source ids throughout. An input call the entry names keeps that id; any other call in that script takes its source id |
| the lane | read off the caller's OPTIONS, never off the walk (`legacyLaneOf`): `declareInputs` present → member, `strict` → strict. Four lanes: `plainStrict` (= `param-ids.json`), `plainScreen`, `memberStrict` (the member pane), `memberScreen` (PineBox). A source id does not depend on the lane |
| where the pinned artifact and the base translator disagreed | the artifact wins, in the pinned lane only (the three licence-held scripts above are restored to their pinned ids) |
| the table | `paramMint` holds ONE entry table keyed by the ordinal (`newParamMint`, `paramOrdinalOf`), built before the walk. `inputParams` is published in id order; the walk's mint order is not published at all |

**How many scripts need the legacy map: all 183 that hold an id.** A counter id is a small dense number and a
source id is not: only 5 of the 183 have every input call minted in source order (legacy = plain ordinal); 92
have their ids in source order but with gaps. No source-only numbering reproduces the other 91.

**What the frozen map does not cover: a script that is not one of the 328.** Its ids were whatever the counter
gave at the door it was saved from, on the translator of that day; no source-only rule can reproduce them. On
its next translation its ids are source ids. A saved document does not carry its Pine and is never
re-translated (`memberPaneDefinition.js`: "a saved definition does NOT carry the member's Pine"); it carries its
own manifest and keeps working. The ONE place a saved document meets a fresh translation is a member pasting
Pine into a definition they are editing: `BuilderSheet` replaces the manifest, and the server
(`param_manifest._canonicalize_manifest`) keeps the prior record for an id it already holds and REFUSES an id
it does not (owner condition 15). So for such a document a re-paste is now refused with that sentence, where
before it was accepted when the translator had not changed since the save and silently re-pointed when it had.
Disjoint ranges are what make it a refusal and never an alias. Decision 1 below.

### 4. Rails

| rail | what it proves |
|---|---|
| `paramIds.test.js` — UNEDITED | the pinned lane: 4 passed, 1 skipped (the licence-held half) |
| `paramIdSource.test.js` (11) | the rule: ordinals, the key, the two ranges, lane decode; the third input call is `1003` whether or not the first two mint; the order the walk reaches them in does not number them |
| `paramIdLegacy.test.js` (7) | the frozen map's sha256 and entry count; every pinned script has an entry of the pinned length; the three lanes `param-ids.json` does not pin, against `tests/fixtures/pine_param_ids/legacy-lanes.json` (measured at base): every frozen id still addresses the same input, and a new id must be a source id |
| `paramIdSourceStability.test.js` (3) | the property. `translatePine({testRefuseBlock})` — a test-only hook that sends a top-level `if` chain or `for` down the walk's own refusal — refuses all blocks, then two seeded random subsets, for every corpus script: 299 scripts, 120 with a parameter and a refusable block, 29 whose minted set a refusal changes, 14 where a dense counter would have renumbered a survivor; 0 conflicts. And the same through the member door on five named scripts |
| `builder/memberPane/savedDocumentRoundTrip.test.js` (5) | 38 documents the member-pane door saved at base (`saved-documents-pre-c46.json`: 93 ids, every parameter moved off its default) — today's door builds the same manifest (ids, inputs, locators) and the same computation, and the saved values replayed BY ID rebuild the same edited document. Volume v2's whole saved document is loaded and rebuilt (`saved-document-volume-v2-pre-c46.json`) |

Before any rail existed the change was measured directly: the four-lane generator run at base and again at the
tip over all 328 — ids, input names, declared lists and the pane's manifest ids identical except the three
restored scripts.

**Mutations** — 16, each alone, bytes and sha256 captured, restored by bytes, sha verified; every one RED.

| # | mutation | red |
|---|---|---|
| M1 | the id comes from the walk-order counter again | `paramIdSource`, `paramIdSourceStability`, `pine.paramManifest`, `pineProbeReplay` — ⚠️ `paramIds` stays GREEN: the counter reproduces the pinned lane, which is why that rail could never have proved this property |
| M2 | the frozen map is not consulted | `paramIds`, `paramIdLegacy`, `savedDocumentRoundTrip` |
| M3 | the lane is ignored (every lane reads the pinned one) | `paramIdLegacy`, `savedDocumentRoundTrip` |
| M4 | no reuse: every resolve of an input mints an entry | `paramIdSource`, `pine.paramManifest`, `pineProbeReplay`, `savedDocumentRoundTrip` (one worker stopped terminating on the corpus rails and was stopped at 22 min) |
| M5 | `inputParams` published in walk order | `paramIdSource` |
| M6 | source ids start at 0 (the ranges meet) | `paramIdLegacy`, `paramIdSource`, `paramIdSourceStability`, `pine.paramManifest`, `pineProbeReplay` |
| M7 | a bare `input(…)` is not counted | `paramIds`, `paramIdLegacy`, `paramIdSource`, `paramIdSourceStability`, `pineProbeReplay`, `savedDocumentRoundTrip` |
| M8 | the ordinal lookup is off by one | seven rails |
| M9 | the script key ignores token values | `paramIds`, `paramIdLegacy`, `paramIdSource`, `savedDocumentRoundTrip` |
| M10 | a member-door translation reads the plain lane | `paramIdLegacy`, `paramIdSource`, `savedDocumentRoundTrip` |
| M11 | one frozen entry edited (two ordinals swapped) | `paramIdLegacy`, `paramIds` |
| M12 | the test hook refuses nothing | `paramIdSourceStability` (its non-vacuity floors) |
| M13 | `=N` lane repeats not decoded | `paramIdLegacy`, `paramIdSource`, `savedDocumentRoundTrip` |
| M14 | the source ordinal is an enumerable key | `paramIdSource`, `pine.paramManifest` |
| M15 | the main walk steps over a loop (C31's M4) | `paramIds` (gains), `pine.c31LoopScope`, `pineProbeReplay` |
| M16 | the strict / screen split is ignored | `paramIdLegacy`, `paramIdSource` |

Nine test files pinned the counter on INLINE scripts (`__uct_param_1` for a one-input snippet); their literals
now state the source id. No corpus-script expectation changed.

### 5. The first beneficiary — C31's main-walk loop step-over: built, measured, NOT kept

Built on branch `pine/c46-stepover-trial` (`3ecdd1d29e`), narrower than C31's M4: a top-level `if` chain
whose fold stops AT a loop (`PineRefusal.loopWall`) is folded a second time stepping over it, into a copy of
`env` with its own `consumed` set and record map, adopted only when the whole chain folds; the block harvest
still runs against the scope before the chain.

| measured against the lane tip | result |
|---|---|
| parameter ids | none moves; 8 source ids gained in 6 scripts (delta-imbalance-map +2, smt-divergence-ict-killzones +1, volatility-coil-edge +1, `pine_oos` reversal-probability-profile +1, signal-follow-through-ledger +2, structure-participation-matrix +1) |
| the 266 × host + screen | 1,606 served outputs unchanged, **0 changed, 0 newly served, 0 newly refused**; 108 refused outputs name a deeper wall (`pine:tuple`, `pine:type`, `pine:collection` instead of "the fold stopped … at `for`") |
| object programs | change in 4 scripts: dual-view, poor-man, renderingnature (ops 34 → 37), volume-footprint (25 → 32) |
| the 47, and the committed harness dir (117), objects pane on and off | **0 entries changed** |
| member-door census 266 × 2 | 41 / 64 → 41 / 64; 6 refused rows per flag state name a deeper wall; no attached row changes |
| poor-man | its 40 `rowN_price` label positions resolve on the host lane (values asked of the runtime lane 160 → 120); labels 0 / 40 before and after — their text is behind ruling R7 (`row0_value`, a running total) and the runtime lane's `INSTRUCTIONS_PER_BAR` (§ C35, not raised) |

The mission's keep-condition holds (no served plot value changes). It is not kept for a different reason, the
brief's: **no committed capture exercises it** — nothing in 164 graded entries moves — so there is no
vendor-grounded rail to put under it, and on a script outside the corpus it WOULD serve a new plot
(`float m = 0.0` / `if close > open` / a loop / `m := high - low` / `plot(m)` becomes `close > open ? high - low
: 0`). It stays refused by name where it was (`pine:reassign … the fold stopped … at \`for\``;
`pine.c31LoopScope.test.js` now asserts the sentence names the variable and the loop), the reason written at
that refusal is corrected (it was parameter ids; it is now the missing capture), and the capture is queued:
probe `tools/visual_conformance/probes/vw-loop-in-block.pine`, `docs/pine/capture-queue-2026-10-01-loop-in-block.md`
(Q-C46a). Decision 2 below.

### 6. What this unblocks, and what each still needs

Every restriction below named "it would move a saved id" as its reason. That reason is gone: each would now
ADD source ids. What is left is listed.

| lane | the restriction | still needs |
|---|---|---|
| C31 | the main walk refuses an `if` chain at its loop | the capture Q-C46a; then merge `pine/c46-stepover-trial` and append 8 ids |
| C38 | an index that moves only with `barstate.*` stays refused | its own capture (a forming bar); the `Length` id is an append (`__uct_param_1005`) |
| C41 | the plot pass keeps a dead `ltf` arm | nothing id-related: collapsing it adds ids, moves none |
| C33 | `request.security(…, tf, …)` with `tf` a parameter, plot lane | nothing id-related |
| C10 | the dead-arm rescue is the object pass's only | nothing id-related |
| C9 | the `constIntOf` pre-check was reverted | nothing id-related (C24's replay already took the speed) |
| R36 / C37 | presentation folds and first-carried colour rules do not mint | a ruling, not a mechanism: whether such an input should be a member control. Minting it no longer moves anything |

`paramIds.test.js` still goes red on a GAIN (it compares whole maps), so a lane that adds a parameter still
re-pins `param-ids.json`. The re-pin is append-only by construction now. Decision 3 below.

### 7. Measured (base `e4e24524ef` → tip)

| | base | tip |
|---|---|---|
| 1. the 47, objects pane on | objects MATCH 30 / 46, overall 27, families 234 / 266, plots 161 / 172 | identical, 0 entries changed |
| 1. the 47, pane off | 18 / 25, overall 15, families 108 / 119, plots 140 / 151 | identical, 0 entries changed |
| 2. committed harness dir (117), pane on | objects 66 / 85, overall 48, families 323 / 357, plots 351 / 450 | identical, 0 entries changed |
| 2. committed harness dir, pane off | 54 / 64, overall 36, families 197 / 210, plots 330 / 429 | identical, 0 entries changed |
| 3. member-door census 266 × 2 | attach 41 / 64 | 41 / 64, 0 rows changed (base-vs-base 0 rows, tip-vs-tip 0 rows) |
| 4. translation census 266 × host, manifest, screen | 58 ok / 404 served (host), 58 / 738 (screen) | 0 scripts changed in any lane — every top-level key of every translation, parameter ids with their input names included (control 0) |
| 5. notebook first-open | 1,901,893 B | 1,901,893 B (+0, `notebook_perf_budgets` PASS) |
| 5. `pine` chunk | 387,103 B | 395,717 B (+8,614: the frozen map is 6.8 KB of it) |
| 5. total JS | 12,757,155 B | 12,765,769 B (+8,614) |
| 6. `paramIds.test.js` | 4 passed, 1 skipped | 4 passed, 1 skipped — no edit to the test, no edit to `param-ids.json` |

Full `src/components/chart` suite at the tip, once: `Test Files  5 failed | 886 passed | 9 skipped (900)`,
`Tests  6 failed | 15033 passed | 70 skipped (15109)`. All six are `Test timed out in 15000ms` in files the
brief lists as timing out at base (`objectFnInline.vendor` sector-rotation, `guardProbe.measure`,
`objectLaneCallSites` / `objectLaneCensus` (2) / `objectLaneDrawerCensus.measure`). Run alone, one worker: base
`pine.js` 3 timed out of 13, tip 2 timed out of 13 (6 in a first run taken while the box was still busy from
the suite); per-test times sit on both sides of the 15 s line at base and at the tip.

### 8. For the integrator

1. **A script outside the 328, saved before this lane, re-pasted into the same definition** is refused by the
   server (condition 15) instead of accepted. Fresh saves and existing documents are unaffected. If that
   re-paste must keep working, the fix is at that one door, not in the id rule: when `BuilderSheet` applies a
   paste to a definition it is editing, carry the prior id for an input whose `sourceName` matches a prior
   entry's (both unique). That is the "migration" H.11 named. Not built here.
2. **The step-over** is on `pine/c46-stepover-trial`, one commit, not gated. Taking it needs Q-C46a, an
   append of 8 ids to `param-ids.json`, and re-pins of `pineProbeReplay` (step totals),
   `vendorHarness.c21DualView` (one sentence) and `tools/corpus_metric.json`. Whether C31's object-lane
   captures already witness the rule for a top-level name is yours to rule; this lane read the brief as no.
3. **A gain is now an append.** `paramIds.test.js` cannot say so (it must stay unedited): a row whose `was` is
   `(absent)` and whose id is above 1000 is a new parameter, not a move. The brief's "may only GAIN ids for a
   script that had none" was the counter's rule; under source ids a script that already holds ids can gain one
   without moving any. This lane gained none.
4. **`param-ids.json` was already wrong for three licence-held scripts at base** (above). The tip restores the
   pinned ids; a rig that holds those sources would have been red at base and is green at the tip.
5. `paramIds.test.js`'s header still calls ids positional and names H.11 as owed. Its text is not this lane's
   to edit; the rule it describes is § 3.
6. No Python mirror moves: ids exist only in the JS translator, and the server treats an id as an opaque key.

### 9. The re-paste door (follow-up, same day) — supersedes § 8 items 1 and 5

Members paste their own Pine; the 328 are ours. § 8 item 1 named the regression and left it: a formula saved
before this lane from a script outside the frozen table holds counter ids (`_1`, `_2`, …), a fresh translation
of the same script now produces source ids (`_1001`, …), and the server refuses an edit that introduces an id
the stored document does not hold (condition 15). C46 does not ship with that, so the migration is built, at
the one door where a saved roster and a fresh translation meet.

**The rule** (`app/src/components/chart/builder/paramCarry.js`, one pure function, called from the Pine pick in
`BuilderSheet.jsx` only when a saved formula is being edited):

- an incoming input matches a saved one when its `sourceName` (the Pine variable it is declared as) **and** its
  kind (`type`) are both equal; a match takes the **saved** id;
- two inputs declared under one name are matched in order — incoming in source order, saved in id order;
- a renamed input matches nothing, and neither does one whose kind changed: it is a new input and keeps its
  source id;
- a new input never sits on an id the saved document holds for a different input (it would be handed that
  input's record); it moves to the first free id above every id in play. This only arises for a document saved
  after C46 whose script gained an input above the others;
- a saved input the script no longer declares is dropped, as before;
- a fresh formula has no saved roster, so nothing is carried.

When the paste leaves an input unmatched the builder says so before the member presses Save
(`data-testid="param-carry-note"`): the named input is not among the settings the formula was saved with, the
save over it will be refused, save it as a new formula to keep it adjustable.

**Proved through the real door.** `BuilderSheet.pineRepaste.test.jsx` drives the shipped `BuilderSheet`
(Import tab → Use → Save) over a stateful store that applies condition 15, and pins the `compute` each paste
sends in `tests/fixtures/pine_param_ids/repaste-requests.json`; `tests/test_param_repaste_c46.py` feeds those
same bodies to the real `user_definitions.save()`. The prior document
(`repaste-prior-pre-c46.json`) is what that same builder POSTed with `pine.js` at base `e4e24524ef` for an
out-of-corpus script: `slow = _1`, `fast = _2` (walk order, not source order).

| case | what the door sends | server |
|---|---|---|
| (a) same Pine over the pre-C46 document | `_1` slow, `_2` fast — the saved ids, values 21 / 9 | accepted; roster, values and locators unchanged |
| control: (a) without the carry | `_1001` fast, `_1002` slow | refused (`__uct_param_1001`) — the regression |
| (b) one input added above the others | `_1` slow, `_2` fast, `_1001` sig + the notice | **refused** (`__uct_param_1001`), nothing stored |
| (c) `fast` renamed `quick` | `_1` slow, `_1001` quick + the notice | **refused** (`__uct_param_1001`), nothing stored |
| (d) fresh paste into a new formula | `_1001` fast, `_1002` slow, no notice | accepted |
| (e) corpus scripts | — | unchanged: `paramIds`, `paramIdLegacy`, `paramIdSourceStability`, `savedDocumentRoundTrip` green |

**(b) and (c) do not save, and no file under `api/` was changed.** Condition 15 did not need to learn anything
for (a): a carried id is one the stored document already holds, so the server takes it and keeps its prior
record. What stops (b) and (c) is the other half of the same condition — an edit may not introduce a parameter
identity — and that is an owner condition with its own pinned test (`tests/test_param_manifest.py`, test 15).
Letting an added or renamed input through means reversing it, which is not a minimal change and not this
lane's to make. What base did with the same two pastes, reconstructed from the same bodies in
`test_param_repaste_c46.py`:

- (b) **was refused at base too** (the added input minted counter id `_3`). No change.
- (c) **was accepted at base** — the counter gave `quick` the number `fast` had held, and the server, keeping
  the prior record for a known id, went on calling it `fast` / "Fast". A match by position presented as the
  same input. Under the ruled tie-break a renamed input is a new one, so this paste is now refused, with the
  notice. This is the one member-visible difference from base at this door.

Two things the carry does not change, both true at base: a re-paste resets the values to the script's
defaults (the controls are rebuilt from the paste), and for a carried id the server keeps the saved record's
locators verbatim.

**Mutations** (each applied alone, both rails run in one vitest, restored by bytes, sha verified; control run
green first):

| | mutation | red |
|---|---|---|
| K1 | the saved roster is never consulted at the door | door (a), (b), (c) |
| K2 | match by position instead of by name | door (a), (b), (c) + 6 unit cases |
| K3 | kind left out of the match | unit: changed kind |
| K4 | a new input may sit on a saved id of a different input | unit: both collision cases |
| K5 | same-name saved inputs taken in insertion order, not id order | unit: two inputs under one name |
| K6 | the notice is never set | door (b), (c) |
| K7 | a fresh paste carries from the first formula in the list | door (d) |

**Rulings recorded.** The main-walk loop step-over stays out until Q-C46a is captured (§ 5; the trial branch is
unchanged). A gain above 1000 is an append (§ 8 item 3). `paramIds.test.js`'s assertions are untouched; its
header comment, which still called ids positional and named H.11 as owed, now describes § 3 (comment lines
only — § 8 item 5 is closed).

**Licence-held sources — disclosure.** `tests/fixtures/pine_oos` holds 29 sources this rig does not have. To
measure every lane on all 328, 27 were recovered from copies already on this machine and checked against
`MANIFEST` (14 byte-exact, 13 after whitespace normalisation). The remaining two —
`long_tail__19-session-fibs-falcon-ai` and `long_tail__20-cot-pulse-cloud-trend` — were fetched from
TradingView's public script endpoint and hash-checked the same way. All 29 live in the session scratchpad only.
None was written into the repository, and no commit of this lane contains one.

### 10. On wave 11 (merge of `integrate/wave11-2026-10-01` @ `da7142cce3`, 2026-10-01)

Merge commit `0ae347e676`. Two conflicts, both unions: the `parse.js` import line in `pine.js` (wave 11's
`SERIES_LOOKBACK` beside this lane's `paramIdSource` / `paramIdLegacy` imports) and this file (fix-order rows 54
then 56; sections C41, C44, then C46). Nothing in wave 11's `pine.js` change touches the mint, and wave 11 did
not change `param-ids.json`.

Base = the merged tree with wave 11's own `pine.js` and `BuilderSheet.jsx` swapped in (the only production
files this lane changes that wave 11 also ships; restored by bytes, sha verified, tree clean after). Tip = the
merged tree. Same commands, same box, one after the other.

| | wave 11 | merged tip |
|---|---|---|
| 1. the 47, objects pane on | objects MATCH 29 / 46, overall 26, families 234 / 266, plots 161 / 172 | identical, 0 entries changed |
| 1. the 47, pane off | 17 / 25, overall 14, families 108 / 119, plots 140 / 151 | identical, 0 entries changed |
| 2. committed harness dir (117), pane on | objects 65 / 85, overall 47, families 323 / 357, plots 351 / 450 | identical, 0 entries changed |
| 2. committed harness dir, pane off | 53 / 64, overall 35, families 197 / 210, plots 330 / 429 | identical, 0 entries changed |
| 3. member-door census 266 × 2 | attach 41 / 64 | 41 / 64, 0 rows changed |
| 4. translation census 266 × host, manifest, screen | 58 ok / 404 served (host), 58 / 738 (screen) | 0 scripts changed in any lane |
| 5. notebook first-open | 1,901,893 B | 1,901,893 B (+0, `notebook_perf_budgets` PASS) |
| 5. `pine` chunk | 387,818 B | 396,432 B (+8,614) |
| 5. `BuilderSheet` chunk | 363,945 B | 365,945 B (+2,000: the carry and its notice) |
| 5. total JS | 12,774,385 B | 12,784,999 B (+10,614) |
| 6. `paramIds.test.js` | — | 4 passed, 1 skipped; no assertion edited, `param-ids.json` untouched |

(The wave-11 object and overall counts are one lower than § 7's wave-10 numbers on both sides: C44's colour
column joined the verdict.)

Rails on the merged tree, one vitest: the eleven C46 files (`paramIds`, `paramIdSource`, `paramIdLegacy`,
`paramIdSourceStability`, `savedDocumentRoundTrip`, `pine.c31LoopScope`, `pineProbeReplay`,
`pine.paramManifest`, `paramCarry`, `BuilderSheet.pineRepaste`, `manifestFormatting`) —
`Test Files  11 passed (11)`, `Tests  83 passed | 1 skipped (84)`. Scoped pytest
(`tests/test_param_repaste_c46.py tests/test_param_manifest.py`): `33 passed`.

Full `src/components/chart` suite on the merged tree, once: `Test Files  5 failed | 892 passed | 9 skipped
(906)`, `Tests  6 failed | 15138 passed | 73 skipped (15217)`. All six are `Test timed out in 15000ms`. Five
are in files the brief lists as timing out at base (`objectFnInline.vendor` sector-rotation,
`objectLaneCallSites`, `objectLaneCensus` (2), `objectLaneDrawerCensus.measure`). The sixth,
`flipCGeometry.test.jsx` "production never calls the test override" (a walk over every source file), passes
alone in 1.2 s (`Tests  31 passed (31)`).

**Still open for the integrator.** Re-pastes (b) and (c) of § 9 end in a condition-15 refusal with a notice.
(b) is what base did. (c) saved at base, by position, under the old input's record. Making either save means
letting an edit introduce a parameter identity — reversing condition 15 and its pinned test — or having the
door leave the unmatched input out of the roster so the save goes through without it. Neither was done here.

### 11. A rename keeps its saved id (integrator ruling, same day) — supersedes the (c) row of § 9 and the last paragraph of § 10

Ruling: condition 15 stays exactly as it is; (b) stays refused; **(c), a pure rename, saved at base and must
keep saving — in the carry, not the server.**

**The rule.** After the name-and-kind match, an input still unmatched takes a saved input's id only when that
saved input is also unmatched, is the same kind, and stood in the **same place**. A saved id *is* the place it
was minted at:

- a counter id (`_1`, `_2`, …, below 1000) is the input's **turn in the walk**. The pasted input must be
  reached at that same turn;
- a source id (`_1001`, …) is the input's **place in the source**. The pasted input must be that same input
  call.

One candidate is a rename. None, or two, is not: the input is new, keeps its source id, the notice names it,
and condition 15 refuses the save as before.

**Why the walk and not the source order for a pre-C46 document.** The ruling describes the saved roster as
being in source order. For a document saved before C46 it is not, and nothing in it records source order: its
ids are the counter, i.e. walk order (the committed fixture declares `fast` then `slow` and holds `slow = _1`,
`fast = _2`). So the comparison is made in the numbering the saved id was minted in. The translator now puts
each input's turn in the walk on its `inputParams` entry (`walkIndex`, non-enumerable, beside `ordinal`: no
manifest, hash or saved document gains a key — the translation census is byte-identical to § 10's, 266 scripts
× 3 lanes). For a counter-id document this is exactly the question base answered by accident: "would the old
counter have given this input that number?"

**Counts.** The ruling also says "if the counts of unmatched differ … it is not a rename", and asks for (c2) —
a rename plus an added input, two unmatched pasted inputs against one unmatched saved one — to carry. Both
cannot hold; (c2) was taken as the intent. The place decides, per input: the added input stands at no saved
place, so it never takes a saved id, and the renamed one beside it still does.

**The notice.** `The input "Fast" is now "Quick". It is the same saved setting under its new name.` — followed,
when there is one, by the § 9 sentence for an input the formula does not hold.

**Two things the notice does not say, because they are not true:**

- *The value is not carried.* A re-paste rebuilds the settings from the pasted script, for a name match and a
  rename alike (§ 9); the saved value survives only when the script's default equals it, as in these fixtures.
  The ruling's "keeps the saved value (same as a name match)" holds in the second half only.
- *The stored record keeps the old name.* For a known id the server keeps the prior record verbatim, so after a
  renamed paste is saved the stored entry still reads `fast` / "Fast" (`test_c_…`). That is what base stored
  too.

**Through the real door** (same two files as § 9; requests re-pinned by cause — `renamed` changed, four keys
added):

| case | what the door sends | server |
|---|---|---|
| (a) same Pine | `_1` slow, `_2` fast | accepted |
| (b) one input added | `_1`, `_2`, `_1001` sig + notice | refused (`__uct_param_1001`) — as base |
| (c) `fast` renamed `quick` | `_1` slow, `_2` quick, values 21 / 9, rename notice | **accepted** — as base |
| (c2) rename + added input | `_1` slow, `_2` quick, `_1001` sig, both notices | refused for `__uct_param_1001` only |
| (c3) the two inputs swapped in the source | `_1` slow, `_2` fast, no notice | accepted (name match; the rename rule is not reached) |
| (c4) rename + `int` → `float` | `_1` slow, `_1001` quick, "not among" notice | refused (`__uct_param_1001`) |
| (c5) both renamed | `_1` lag, `_2` quick, two rename notices | accepted |
| (d) fresh paste | `_1001` fast, `_1002` slow | accepted |

**Mutations** (fourteen, each alone, both rails in one vitest, restored by bytes with sha verified, control
green first — K1–K7 are § 9's, re-run on this code):

| | mutation | red |
|---|---|---|
| R1 | the rename fallback is off | door (c), (c2), (c5) + 4 unit |
| R2 | the fallback ignores the kind | door (c4) + 1 unit |
| R3 | the fallback ignores the place (pairs whatever is left over) | door (c2), (c5) + 7 unit |
| R4 | the door does not pass the pasted inputs' places | door (c), (c2), (c5) |
| R5 | the translator reports the source place as the walk place | door (c), (c5) |
| R6 | two candidates is still a rename | unit: two saved inputs it could be |
| R7 | the name match is skipped | door (a), (c), (c3) + 11 unit |
| K1–K7 | as § 9 | all red (K1 now reds every door case but (d)) |

R3 does not red (b): with nothing saved left unmatched there is nothing for a leftover pairing to take, so (b)
is refused under that mutation too.

**Measured.** Rails: `paramCarry.test.js` + `BuilderSheet.pineRepaste.test.jsx` `Tests  28 passed (28)`;
builder directory + the id rails `Tests  2 failed | 2060 passed | 12 skipped (2074)`, both failures
`EvidenceTab.doors.test.js` 15 s timeouts that pass alone (`Tests  10 passed (10)`). Scoped pytest
`37 passed`. Translation census byte-identical to § 10's merged tip. Bytes: `pine` chunk 396,432 → 396,522
(+90), `BuilderSheet` chunk 365,945 → 366,768 (+823), total JS 12,784,999 → 12,785,912, notebook first-open
1,901,893 B (+0, PASS). Wave 11's tip was still `da7142cce3`; no second merge.

## L1 - `import Author/Library/Version`: a library registry, and an imported function is the script's own (2026-10-02, step L1)

Branch `pine/l1-libraries`, base `origin/master` @ `cf5e38d5d2` (waves 7-13 + C50), merged with
`origin/master` @ `5564cca92b` (docs only). 34 of the 266 committed scripts import a library; both
lanes refused every one of them at the import line (`pine:module`, `runtime:library`, 30 each as the
first wall).

**The registry (sources never in git).** `api/services/pine_library_store.py`: one JSON per library
VERSION under `$PINE_LIBRARY_DIR` or `$DATA_DIR/pine_libraries` (`<Author>/<Library>/<N>.json`) -
source, sha256, licence, licence basis (`header`, or TradingView's MPL-2.0 default recorded as
such), attribution. An entry without a licence, with a bad hash, or whose source declares no
`library()` is never served; a version never stands in for another. Read door:
`GET /api/pine/libraries[/<A>/<L>/<N>]` (`api/routers/pine_libraries.py`, signed-in members). Filled
by `tools/pine_library/fetch_library.py` (owner/integrator runs it; public endpoints only - the
library search with `type=3` nominates, the candidate's own `library("<name>")` at the requested
version decides, because a publication's display name and author can differ from its import path:
`Simple Trendlines` / `SimpleTrendlines`, `TradingFinder` / `TFlab`). Client side:
`pineLibraryStore.js` (empty in every process) + `usePineLibraries` in PineBox and MemberPane (no
request for a source without an import; one per library; PineBox shows path, licence, attribution).

**The rule, as implemented (`pineLibraries.js`).** Both lanes call `linkLibraries` right after
`lexPine`. A resolved import line is replaced, at the TOKEN level, by the library's reached
definitions: the functions, methods, types and enums the script reaches from the `alias.X` it writes
(transitively), and the plain top-level values those read; `library()`, demo plots, inputs and
top-level blocks are dropped (an importing script never runs them). Library top-level names become
`__lib<k>_<name>` - functions at call position only, values and types by head, never a type field
name, a named argument, or a reference to the definition's own parameter / local at or after its
declaration (Pine scoping read positionally) - and the script's `alias.X` is rewritten to the same
name; methods keep theirs. A library importing a library is linked first; one version is one unit.
The script's tokens keep every line, column and index (refusals, excerpts and parameter ids do not
move; `scriptKey` and the input sites read `tokens.unlinked`); library tokens get lines past the
script's last line (indent and line tables extended) and FRACTIONAL indices inside the removed
import line's gap, so token order - which the walk's binary-searched statement log depends on - is
run order. A refusal inside library code is moved to the member's import line, names the library and
its line, and spliced names read `alias.name` again. Refused by name on the import line (guards
unchanged, the sentence gains the reason): a library not in the registry (which one), a library in
another Pine version than the script, a block local named like a top-level value it also reads after
the block, a kept top-level value the library keeps across bars (`var`) or reassigns at its top
level, a cycle.

**Proof.** `pineLibraries.test.js` (20): linked equals the function pasted in, bar for bar over 60
bars, in BOTH lanes (host trees through `interpret`, runtime IR lowered and executed); a control
without the library refuses; the script's own `mid`/`FACTOR` never captured; a parameter named like a
top-level value; a type field named like one; a library type and its method; a library importing a
library; `/2` runs v2 and not v1; every refusal above. `usePineLibraries.test.jsx` (2),
`tests/test_pine_library_store.py` (8). No committed capture imports a library (0 of 139 harness
files): the equivalence reduces L1 to the user-function semantics the captures already grade, and
Q-L1 (`vw-library-import.pine`, `docs/pine/capture-queue-2026-10-02-l1-libraries.md`) would ratify it
on the vendor's side.

**Measured with the real libraries in a scratch store** (49 versions fetched, all MPL-2.0, one by a
TradingView default; never committed; `algotraderdev/contrast/1` could not be resolved):

| | no libraries (prod today) | with the scratch store |
|---|---|---|
| importers past the import wall, host / runtime | 4 / 34 (strategies, refused earlier) | **29 / 34** both |
| runtime census compiled (bare / owned) | 15 / 27 (base 15 / 27) | 15 / 27 |
| runtime census `runtime:library` first wall | 30 (base 30) | **5** |
| member door attach off / on | 45 / 68 (base 45 / 68) | 45 / **70** |

Still at the import wall: 4 v6 scripts importing v5 libraries (`TFlab/AlertSenderLibrary_TradingFinder/1`,
`boitoki/AwesomeColor/9`, `jdehorty/MLExtensions/2`, `ClassicScott/MyMovingAveragesLibrary/4`) and
`algotraderdev/contrast/1` (not fetched). The other 29 now stop at the engine's own walls, most
inside library code and named there: default parameter values (`ao()`, ZenLibrary `getPipSize`),
`switch` (PineCoders/lower_tf), `chart.left_visible_bar_time` (VisibleChart), array methods named
like built-ins (arraymethods `delete`), `runtime.error` in a helper (TradingView/ta), tuples,
`pine:state`, `pine:arity`. Door: `all-chart-patterns-theeccentrictrader` and
`black-scholes-option-pricing-model-w-greeks-loxx` attach (objects pane on).

**Mutations** (pineLibraries.js bytes captured + sha256, restored by bytes, sha verified each time):
no rename -> red; keep the library's top-level code -> 7 red; a version stands in for another -> 2 red;
type field names read as references -> red; library refusal keeps its library line -> red; no
version check -> red; block-local shadow not refused -> red. SURVIVES: parameters not treated as
locals - renaming a parameter's declaration and its uses together is consistent, and the two cases
where it is observable (a default value, a named argument at the call) are refused by both lanes on
their own walls today.
## B1 - `bgcolor` / `barcolor` are drawn, graded against the captures that record them (2026-10-02, step 61)

Branch `pine/b1-bgcolor-barcolor`, base `origin/master` `cf5e38d5d2` (waves 7-13 + C50).

**What was true before.** Both calls sat in `CHART_ONLY_CALLS` and were skipped with the `pine:chart-only`
note on both lanes: a script's background shading and its candle colours were never drawn, and a script
whose only visible output is a paint was `pine:no-output`.

**The premise, measured.** The brief said 18 of the 33 `pine:no-output` scripts use `bgcolor`. That counted
the TOKEN, and almost every hit is `box.new(..., bgcolor = ...)` / `table.cell(..., bgcolor = ...)`. Calls
to `bgcolor(...)` / `barcolor(...)` themselves: **4 of the 33** (ict-killzone-index-version,
volume-profile-v054beta, visualizing-displacement-tfo, volume-profile-auto-line-v2), and **72 of the 266**
corpus scripts, 9 of which attached before this lane (the 9 all have committed captures).

### The rule as implemented

1. **Translator (host lane only, `pine.js::resolvePaints`).** Every top-level `bgcolor(...)` /
   `barcolor(...)` statement becomes a paint in `presentation.paints`, source order, with its `line`.
   The arguments are placed by the version's own signature (v5/v6 `color, offset, editable, show_last,
   title, display, overlay`; v3/v4 `bgcolor(color, transp, offset, ...)`, `barcolor(color, offset, ...)`;
   `transp =` by name on any version). The colour goes through `outputPresentation` - the reader a plot,
   a fill and a marker use - so a paint carries: a static colour (+ opacity from `color.new` / `transp`),
   a two-colour test, a palette and its index column (`cond ? c : na` is a palette with the transparent
   `na` entry), or a `color.from_gradient` position (C37's rule, extended to the two paint kinds).
   `na` - and a rule whose deciding tree is a CONSTANT that picks its `na` entry - is `na: true`, no paint;
   a constant that picks a colour folds to that static colour. `display = display.none` is `hidden`.
   Everything else is **withheld by name** (`withheld: {code, reason}`): `paint:offset` (non-zero or `na`),
   `paint:show-last`, `paint:display` (other than all / none), `paint:overlay` (`overlay` / `force_overlay`),
   `paint:v4-default-transp`, `paint:colour` (a colour the reader cannot carry), `paint:argument`.
   **Nothing mints**: every paint rule resolves with `paramMint` held at null (R36); the screener lane is
   unchanged (TradingView's screener reads no paint).
2. **A script whose only output is its paint** (`paintOnlyWin`) is a host-lane accept on the bar the
   object-only win is held to: every paint carried (none withheld), and **no drawing lost** - an object pass
   that dropped any op (an EMPTY program is not a clean one) refuses. Measured: volume-profile-auto-line-v2
   makes the candles transparent with `barcolor` so its profile can be read; all 20 of its drawing ops drop;
   admitting it on the paint would have shown a member a chart with nothing on it. It stays refused.
3. **Member door (`memberPaneDefinition`).** Each drawn paint's rule is minted as a hidden condition column
   through the SAME `conditionColumnFor` a plot and a fill use (one column per canonical formula, so a paint
   and a plot on one rule share it), and the document carries `paints: [{kind, line, title?, color?,
   opacity?, colorMode?, colorUp/colorDown | colorPalette | colorGradient}]` - validated by
   `defSchema.validatePaints`, absent on every document with no paint. A withheld paint is a disclosure:
   "`barcolor` (line N) is not drawn: <reason>". A paint-only script is admitted on the objects-only flag
   (`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`, armed in prod), and **a PANE script whose only drawing is a
   background is refused by name (`pine:paint-pane`)**: the pane it would shade is built only when a series
   binds in it. A `barcolor`-only pane script is admitted (it recolours the chart's own bars).
   `builderInputs.withColourInputs` reads paints' `_colourInputs` like fills', so a toggle only a paint reads
   is a live knob; its shape check compares paints by (kind, withheld, hidden) because the constant fold
   above legitimately turns `show ? c : na` into `na` when `show` is a literal and leaves it a rule when it
   is declared.
4. **Drawing (`binder.syncPaints`, `paintPrimitive.js`, `barColours.js`, `StockChart.jsx`).**
   `bgcolor` -> ONE series primitive per call, `zOrder: 'bottom'` (behind every series), full pane height,
   one rectangle per run of adjacent same-colour bars (bar spacing wide), attached to the instance's first
   bound series - or, for an overlay instance that binds none, to the candles (`ctx.priceSeries`). Re-fed
   only when its colours change; detached when the instance leaves, is hidden, or its host changes.
   `barcolor` -> one `time -> colour` map over every instance, handed to the chart (`ctx.setBarColours`)
   **only when it changes**; StockChart wraps the OHLC price series ONCE (after the net-change wrap) so
   every write - setData, gold highlight, every live `update` - is recoloured from a ref, and a changed map
   is re-applied from the series' own remembered payload (one `update` of the last bar when only it
   changed, else one `setData`). An explicit colour already on a bar (a highlight) wins. Two visible
   `barcolor`s that DISAGREE on a bar leave that bar its own colour (`conflicts`, counted) - no capture says
   which one TradingView paints.

### Graded against TradingView

Captures record each paint as a plot (`bg_colorer` / `bar_colorer`) with the bar's colour per row (a
palette index through `valToIndex`, or palette-less the packed colour; `null` = `na`), style
`transparency` and `display`. `vendorHarness/paintColours.js` reads them through `compare.mjs::
vendorColorsFor` (one vendor reader) and pairs the k-th vendor paint with the k-th paint of that kind
(Pine allows these calls only at global scope, so source order is the vendor's order; a count that
disagrees is reported unpaired, a title that disagrees is reported). Our side is the binder's own
`paintColoursFor` over the member door's computed columns. Pinned in `vendorHarness.b1Paints.test.js`:

| capture | result |
|---|---|
| atr-support-and-resistance | Impulse Candles **agree 632 / 632** (25 bars painted); RSI S/R hidden both; two `na` both |
| atr-trailing-stoploss | **agree 631 / 631** (631 painted) |
| btc-charlie | four barcolors **agree 634 / 634** (8, 9, 349, 244 painted); one bgcolor agree (0 painted); three bgcolors `notDrawn` - carried, but their condition columns do not compute (`computeFor` answers no column); TradingView draws nothing there at the defaults either |
| elliott-wave-3-finder | two bgcolors **agree 632 / 632** (65, 44 painted) |
| ema-ribbon | bgcolor **agree 632 / 632** (632 painted, palette-less); barcolor agree (0 painted) |
| fibonacci-pivot-points | **agree 632 / 632** (632 painted) |
| artemis, mcclellan | `na` on both sides, every bar |
| heat-map-seasons | withheld (`paint:colour`: a ternary choosing between two `color.from_gradient`s) |
| fvg-trend, inside-bar-range, vw-deadband-ticks x3 | the script is refused (`pine:state`) |

**No paint the door draws differs from TradingView on any bar: 2,639 vendor-painted bars compared.**
A further rail asserts the binder hands the chart exactly the graded colours (elliott's two backgrounds,
fibonacci's 632 candle overrides by bar time).

**Witnessed vs not.** Witnessed: the colour each bar takes. NOT witnessed by any capture (a capture records
study data, never pixels): WHERE a paint is drawn - the script's pane for `bgcolor`, the chart's own bars for
`barcolor` - is Pine's documented placement, built by construction and railed in `paintRender.test.js` /
`stockChartWiring.test.jsx`. Withheld until captured: probes `vw-bgcolor-barcolor.pine` (offset, `na`
offset, show_last, a data-window display, two disagreeing barcolors) and `vw-bgcolor-v4-default.pine` (the
v4 default transparency, read straight off `styleState`), queue `docs/pine/capture-queue-2026-10-02-b1-paints.md`.

### Measured (base `cf5e38d5d2` -> tip `875245b282`, alternated, one process at a time)

- 47, objects pane on: overall MATCH 29 -> 29 / 47, objects 30 -> 30 / 46, plots 171 -> 171 / 172; pane
  off 16 -> 16, objects 17 -> 17 / 25, plots 150 -> 150 / 151. Committed dir: 50 -> 50 / 138 (on), 37 -> 37
  (off). **No entry changed** in any of the four (compared by file).
- Member door census, 266 x 2: attach **45 / 68 -> 45 / 68**. Changed rows: 5, all attached before and
  after - atr-support-and-resistance, btc-charlie, elliott-wave-3-finder, ema-ribbon, fibonacci-pivot-points
  gain their paint columns (`plots` 10->11, 6->14, 2->4, 17->19, 7->8).
- Translation census, 266 x {host, screen}: every served formula, every output presentation, every object
  program and every other presentation field byte-identical; host ok 64 -> 64, served 827 -> 827; screen
  58 / 779 unchanged. Paints on the host lane: 71 scripts - drawn 17 calls, `na` 19, hidden 3, withheld 65
  (colour 54, offset 6, v4 default transp 3, display 1, overlay 1).
- `savedDocumentRoundTrip` (C46): a paint's colour column is an APPEND, like the manifest's own rule - the
  comparison takes out exactly the columns only a paint reads and is then the saved document byte for byte
  (5 scripts); a rail proves the rule is load-bearing and is the identity on a paint-free script.

### What stays refused, and what settles it

- `offset`, `show_last`, another `display`, `overlay`: `vw-bgcolor-barcolor.pine` + screenshots.
  Unblocks visualizing-displacement-tfo (a `pine:no-output` script whose only output is
  `barcolor(..., offset = require_fvg ? -1 : na)`) and the five other `offset` paints in the corpus
  (ict-institutional-order-flow-fadi x2, liquidity-engulfing-displacement-msf,
  wyckoff-accumulation-distribution, trailing-take-profit-trailing-stop-loss).
- A v3/v4 `bgcolor` with no `transp`: `vw-bgcolor-v4-default.pine`. Unblocks volume-profile-v054beta.
- Two disagreeing barcolors: the P1/P2 screenshot.
- 54 paint colours the reader cannot carry (ict-killzone-index-version's `color.new(input.color, input.int)`
  under a `time()` session test; heat-map-seasons' choice between two gradients): translator work, not a
  capture.
- btc-charlie's three bgcolor condition columns that `computeFor` does not compute: a compute-lane gap
  (the plot lane has the same silent hole for a colour column), not a paint one.

### Decisions left for the integrator

1. **Paints are graded in their own rail, not in the harness verdict.** Joining them (as C44 joined object
   colour) would leave every verdict unchanged on this tree (no paint differs) but would turn heat-map-seasons'
   withheld barcolor into a counted gap. Recommended: join, as a column like object colour. **RULED: join,
   default ON** - see the follow-ups below.
2. **The `pine:chart-only` note still says "this line is ignored here too"** on the host lane for a paint
   that is now drawn (as `hline` / `fill` already do). Rewording it is a member-visible copy change across
   every lane test that pins notes; left as is. **RULED: make it true per call, one authority, railed** - see
   the follow-ups below.
3. **Paint-only scripts ride the objects-only flag** (D2: a script with no screenable column). Measured:
   no corpus script attaches through it today (the 4 candidates are withheld or lose their drawings).
4. **The fix-order step number** is written `B1`; renumber on merge. **RULED: step 61** (L1 = 60, R1 = 62,
   H1 = 63, RT1 = 64).

### Addendum - merged tree, bytes, suite

Merged `origin/master` `5564cca92b` (two Notebook-only commits). On the merged tree: member-door census
45 / 68, 0 rows differ from the pre-merge tip; base-vs-base control 0 rows. Bytes (vite build, base -> tip):
notebook first-open 2,148,818 -> 2,148,818 B (+0, `notebook_perf_budgets` PASS); `pine` chunk 417,918 ->
422,659 (+4,741); `StockChart` chunk 702,343 -> 707,910 (+5,567); total JS 13,253,874 -> 13,268,078
(+14,204). Full `src/components/chart` suite: `Tests  10 failed | 16894 passed | 85 skipped (16989)` -
nine 15 s timeouts (the brief's known list plus `enumerationSites` and `flipCGeometry`'s source walk, both
green alone) and `pineProbeReplay`'s artemis pin, re-pinned with its reason (one paint Resolver, 8 steps).
`paramIds.test.js` green, unedited.

### Follow-ups - the two rulings (2026-10-02)

**(1) Paints join the harness verdict, default ON.** `compare.mjs::comparePaints` states, once, what each
paint state means: `agree` / `naBoth` / `hiddenBoth` agree; `differ` / `naDiffers` / `titleMismatch` /
`hiddenVendorOnly` / `hiddenOursOnly` differ; `withheld` differs (a GAP) unless TradingView does not draw it
either; `notDrawn` differs where TradingView painted a bar and is counted, NOT graded, where it painted none;
`vendorUnreadable` is not graded; an unpaired count differs; an unknown state throws. The pairing and the
per-bar grade stay the runner's (`paintColours.js::gradePaints`). `harness.js::paintsGraded` is the option
(`{paints: false}` or `VENDOR_HARNESS_PAINTS=0`); every verdict a paint row joins carries
`verdictWithoutPaints`, and the summary prints `WITHOUT PAINTS` and `CHANGED BY PAINTS` beside C44's lines.
`verdictWithoutColour` now keeps the paint row in, so each "without" number differs from the verdict by its
own cause only.

| set | verdict (paints ON) | `verdictWithoutPaints` | paints graded on | moved |
|---|---|---|---|---|
| the 47 (`ext-2026-09-28`, objects pane on) | MATCH 29 / DIVERGE 17 / INCONCLUSIVE 1 | 29 / 17 / 1 | 7 | none |
| committed harness dir (138, objects pane on) | MATCH 50 / DIVERGE 26 / INCONCLUSIVE 62 | 50 / 26 / 62 | 9 | none |

Byte for byte: a `VENDOR_HARNESS_PAINTS=0` run's `verdicts.json` equals the pre-follow-up tip's run on every
record (all 47 + 138, `JSON` identical), and `verdictWithoutPaints` equals it on every entry. Paint rows:
heat-map-seasons **DIVERGE** (`barcolor plot_0 "Bar Color"` withheld - its colour chooses between two
gradients; the capture was already DIVERGE on its plots, so its verdict does not move); btc-charlie MATCH
with 3 paints neither side draws counted (`plot_14`, `plot_16`, `plot_17`: TradingView's every bar is `na`
at the defaults); the other 7 MATCH. Rail: `vendorHarness.b1PaintVerdict.test.js` (11).

**(2) The `pine:chart-only` sentence is true per call.** `pine.js::chartOnlySentence(word, how)` is the one
authority (`how` = lane, site - top / assigned / in a block - and the outcome resolution knows: a folded level,
a carried band, the resolved paint record); a `fill` and a paint are re-said after resolution through the same
function. Host lane: a drawn paint says `is drawn: it shades the background behind this script` /
`recolours the chart's own candles`; a withheld one `is not drawn here: <the door's reason>`; `display.none`
and `na` say they paint nothing, as on TradingView; `hline` says it is **not drawn on this chart** (the member
document carries no level - checked against `memberPaneDefinition`); a `fill` whose edges are carried plots is
`carried as the band between its two plots` (the document draws it), otherwise `is not drawn` with why;
`alert()` draws nothing and nothing here delivers it. Screener lane keeps the screen statement and says what
the builder carries (a folded `hline` as a level line, a carried `fill` as its band; `bgcolor` / `barcolor`
not carried). Rail: `ast/chartOnly.test.js` (16) - every sentence against the door's own record, and across
the corpus on both lanes no host note says "ignored", a paint says drawn iff its record draws, a fill says
carried iff a band is; `alphaCarriage` / `silenceSpeaks` re-pinned to the new sentences.

Proof: 10 mutations, each red alone (5 on the verdict join - paints never join, a withheld paint read as
agreeing, `notDrawn` never differing, the option ignored, `verdictWithoutPaints` taken from the new verdict;
5 on the sentence - a host paint said as on the screener, fills never re-said after resolution, a host `hline`
said carried, a withheld paint said drawn, a site writing its own sentence). Full `src/components/chart` suite:
`Tests  9 failed | 16922 passed | 85 skipped (17016)` - eight 15 s timeouts (the known list, all green alone:
7 files, 54 tests) and `defSchema`'s fill-reader rail, which caught a stash field named `fill` in `pine.js`
(renamed `fillRec`; green). `paramIds.test.js` green, unedited.
## H1 - the host translator's three largest walls: pivots on a plateau, a ratchet decided by range, a helper's own recurrence (2026-10-02, step 63)

Lane H1 of the "import any TradingView Pine script" program, branch `pine/h1-host-walls`, base `5564cca92b`,
master merged at `c31023ef1d`. Goal metric: the member-door census over the 266 committed scripts.

### The walls, by shape (first refusal per script at base, flag on)

| wall | scripts | shapes (clustered) | outcome |
|---|---|---|---|
| `pine:state` | 16 | ratchet stop whose reset test reads the stop (supertrend family, ATR trailing stops); a helper's own `x = init` / `x := f(x[1])` (range filter, PMax); coupled `var`s (inside-bar, smc-structures, wyckoff); running totals with no window (fvg-trend, smoothed-gaussian, deadband, ema-92150 vwap); a `var` never updated (auto-trendline); stops inside an `if` (neural-network) | first two SERVED (7 scripts attach); the rest refused by name |
| `pine:reassign` | 15 | comma statement `_direction = na , _direction := switch` (3-level / pa zigzag); `for` running totals (ruling R7: machine-learning-ma, moving-averages-sr-mtf, order-block-finder); loops in blocks (delta-imbalance, smart-money, smt, supply-demand, support-resistance-logreg, volatility-coil); `var` state (bolingger, inside-bar-boxes); a UDT field (ict-turtle-soup); a tuple part (williams-fractal) | refused by name; every shape is either a loop total (R7) or would next hit a dark lower timeframe |
| `pine:request` | 18 | another symbol (4c-nyse USI, ad-line SP sectors, banknifty, sub INDEX:, cumulative-volume-delta BINANCE, open-interest and swing-points computed symbols); a lower timeframe with `VITE_PINE_LOWER_TF_ENABLED` dark (advanced-custom, ai-supertrend, mtf-dashboard, multi-tf-rsi, multi-tf-trend, take-profit); a `barstate` offset (ml-logistic-regression, previous-n-days with `gaps_on`); 12M (camarilla); a string-ternary timeframe that then exceeds `budget:series` 13 > 8 (cppivot); a computed timeframe plus loops (delta-volume) | none served: each is behind a rule (other symbol unserved, dark flag, unwitnessed `barstate`/`gaps_on`, no budget raised) |

### Rules served

1. **A plateau pivots on its LAST bar.** `pivothigh(src, L, R)` at the candidate bar `i`: a bar on the left may EQUAL it, a bar on
   the right may not. Witness: RDDT bars 473/474 tie at 152.44 and TradingView confirms the second; a hand replay of
   pivot-point-supertrend's arithmetic over `FN.pivothigh/pivotlow` equals vendor `plot_4` on all 631 bars, while the strict rule
   diverges first at bar 476 (`vendorHarness.h1PivotTies.test.js`). JS and Python move together (`tests/test_ast_pivots.py`:
   plateau `[(4, 20.0)]`, corpus counts 54/54 → 62/63).
2. **A ratchet is decided by RANGE.** `forgetsOnReset` admits a reset arm whose test is an ORDERING (`< <= > >=`) between the
   state (`self` or `nz(self, k)`) and a MOVING value (not a constant, not carried). `interpret.js` then runs the body in a range
   domain (a value is a number or `{lo, hi, na}`; each op its interval extension; a test that reads the state refines it per
   branch and joins the answers) and publishes a bar only when every run entering the window collapses to one number. A NaN
   series bar is read as the whole range, never as `na`. Python mirror `_Range` / `test_ast_ratchet_parity.py`.
3. **A helper's own recurrence** is the same tree as the identical top-level one: the fold maps every earlier binding of a
   local to its final (`finalLocals.chainFinal`), so `x[1]` above or below the last `:=` reads the column a bar back, two call
   sites build two columns, and a top-level name the helper shadows stays top-level (`ast/functionLocalRecurrence.test.js`).
4. **From the listing, a crossing over `na` is `false`.** Found by this lane's own measurement: after (2) attached
   `qqe-signals`, the committed capture graded its `QQE long` DIVERGE on one bar (73, ours 20.72, TradingView `na`). The
   listing pass carried `trend` as `na` where `cross(...)` was `NaN`; Pine's crossing is never `na`. The listing pass now
   re-reads a test built only of crossings and comparisons with a `NaN` crossing as `false` (`pineBoolAt`); behind the curtain
   nothing changes (`ast/listingPineBool.test.js`, `vendorHarness.h1Ratchet.test.js`). JS only: the Python lane has no listing pass.
5. **Ids.** A declared input whose ordinal the frozen map holds is still minted, and a script `docs/pine/param-ids.json` pins
   mints ONLY its frozen ids in the pinned lane (`paramIdPinned.js`, 297 keys DERIVED from the artifact by
   `ast/paramIdPinned.test.js`). `paramIds.test.js` green with no edit; `param-ids.json` unchanged.

### Measured (base `5564cca92b` vs tip, same box, same commands)

| | base | tip |
|---|---|---|
| the 47, pane on / off | 29 / 47, 16 / 47 | 29 / 47, 16 / 47 (0 entries change) |
| committed harness dir, pane on / off | 50 / 138, 37 / 138 | 52 / 138, 39 / 138 |
| member door, on / off | 68 / 266, 45 / 266 | 75 / 266, 52 / 266 (base-vs-base 0 rows) |
| translation census, strict / screen / member ok | 64 / 58 / 64 | 71 / 64 / 71 |
| notebook first-open | 2,148,818 B PASS | 2,148,818 B PASS |
| `pine` chunk / total JS | 417,918 / 13,255,669 B | 423,187 / 13,269,891 B (total includes master's two merged commits) |

Census attach (flag on) as the shapes landed: base 68 → plateau rule + ratchet window 73 (measured together, not separately) → helper recurrence 75 → listing bool 75.
Newly attached: atr-trailing-stop-by-ceyhun, pivot-point-supertrend, qqe-signals, supertrend-explorer, supertrend-strategy,
pmax-explorer, twin-range-filter. Two first refusals moved without attaching (atr-god-strategy → `pine:block`,
momentum-based-zigzag → `pine:function` on an unbounded `barssince`). The only served-output change in the translation census
is three newly translated plots of cpr-with-mas-super-trend in the screen lane (the member door still refuses it on `pine:arity`).

### What stays refused, and what settles it

Every `pine:request` wall (above). The ratchet curtain on a short chart: qqe-signals behind the curtain on 631 bars is withheld
whole (its counters read a 250-bar window over two ema-of-ema chains). Probe `tools/visual_conformance/probes/vw-ratchet-stops.pine`,
queue `docs/pine/capture-queue-2026-10-02-h1-ratchet.md` (Q-H1a SPY 1D grades the curtain path; Q-H1b RDDT 1D widens the plateau
evidence).

### Decisions for the integrator

- **Param-id gains.** C46's text says a script that gains a translation gains source ids; its rails (`paramIds`, the legacy
  dense rail) forbid a pinned map from growing. H1 resolved it with the derived `PINNED_SCRIPT_KEYS` rule (member door keeps the
  knobs at source ids). A regeneration of `param-ids.json` is the alternative and is the owner's call.
- **Ruling R7** (loop running totals) decides the next five `pine:reassign` scripts.
- **The plateau rule moves every served pivot script** (vendor-grounded; 0 harness regressions).
## R1 - the runtime lane reads a strategy, and the exact half of `runtime:statement` (2026-10-02, step 62)

Branch `pine/r1-runtime-strategy`, base `cf5e38d5d2` (origin/master with C50), merged `5564cca92b`.
Scope: carry C50 into the RUNTIME lane (`engine/ast/pineRuntimeFrontend.js`), then the next-largest
runtime first walls, `runtime:statement` and `runtime:object-op`, as far as is exact.

### Step 1 - a strategy (`597552a6a4`)

- `strategy(` is skipped exactly as `indicator(` is (this lane reads neither; title and overlay are the
  host translation's). The program is byte-for-byte the indicator's (`runtimeStrategy.test.js`).
- An order call in `STRATEGY_ORDER_CALLS` - IMPORTED from `pine.js`, one authority - is skipped as a
  statement and counted (`runtime:strategy-order`). A `strategy.*` call outside the set is not.
- A `strategy.*` VALUE still refuses by name (`pine:strategy-call`), including inside a condition.
- Only the CALL form `strategy(` / `library(` is a declaration. `liquidity-engulfing-candles-upslidedown`
  is an indicator with a VARIABLE named `strategy`; it was refused "not an indicator" and now compiles,
  all three plots equal to the vendor on all 632 bars (`runtimeStrategyWord.vendor.test.js`).
- No strategy capture exists (none of the 139 harness captures declares `strategy(`). Queued:
  `docs/pine/capture-queue-2026-10-02-r1-strategy.md`, probe `r1-strategy-draws.pine`.

### Step 2 - `runtime:statement`, the exact shapes (`bfecbecbef`)

| shape | rule | proof |
|---|---|---|
| lone atom on its own line (`countBuy` closing an `if` body) | discarded; still lowered first so its own refusals stand; a function ending in a loop stays valueless | `runtimeDiscardedValue.vendor` (btc-charlie, 5 rows, every bar) |
| `#RRGGBBAA` literal | `objectHexToPacked` (C48's conversion) | `runtimeColourLiteral8.vendor` (vw-colour-components K02..K07 through `bgcolor` of a `var`) |
| `[x]` function result | one-element tuple: `[a] = f()`; a plain read refuses; ir.js admits 1-element tuple / destructure | unit |
| body ending in a void collection call | valueless, its own sentence at a reading call site | unit |
| `request.security(symbol =, timeframe =, expression =)` | placed by `pine.js::positionaliseSecurityArgs` (now exported) | unit: same answer as positional |
| `plot(title =, series =)` | value arg by `pine.js::OUTPUT_CALLS` name | unit |
| 1-arg `ta.highest` / `ta.lowest` | filled from `PINE_SHORT_FORM` (groupb-hilo-default) - the explicit spelling's answer | unit |
| interpret.js `TableRefusal` | keeps its guard (`interpret:bind-time-text`), not `runtime:statement` | unit |

Left refused by name (14): session-clock arguments (7: `time(tf, ...)` off the chart period, a
non-literal session), a line carrying `,`-separated statements AND a block (3: the split is grammar no
capture witnesses here), `ta.pivothigh` with a per-bar leftbars (1), `input.string` with a non-literal
default (1), `color.new(color =, transp =)` (1: no evidenced parameter names), and
`madrid-moving-average-ribbon` (1) - a DEFECT found, not fixed: a user function reading history of its
parameter, called inside a plot's `color =`, produces IR whose history index has no slot; the IR
validator catches it, so it is a refusal (line null), never a wrong drawing. Minimal repro:
`f(_ma) => d = ta.change(_ma) ... plot(close, color = f(ta.sma(close, 3)))`; bound to a variable first,
it compiles.

### Step 3 - `runtime:object-op` (`a029107811`)

The BARE row (29 -> 33) is the harness's: a build not told who owns the drawing refuses every drawing
call, and `runtimeCorpusCensus.measure.test.js` rails exactly that. It is left as it is. Under ownership
the real rows were 6: two were a function whose LAST line is a drawing call (lowered as its result);
such a body is now valueless, like a loop body. The other four read a drawing's state as a value
(`box.get_top`, `line.get_y1`, `line.get_x2`, `line.get_price`) - a real gap, refused by name.

### Measured (base `cf5e38d5d2` / tip after merge `689e4875d6`)

| | base | tip |
|---|---|---|
| runtime census compiled end to end | 15 / 266 | **19** / 266 |
| owned-drawing census | 27 | **31** |
| `runtime:declaration` / `runtime:statement` | 26 / 33 | 0 / 14 |
| member door attach (off / on) | 45 / 68 | 45 / 68, 0 rows changed (base vs base: 0) |
| the 47, pane on: objects / overall | 30 of 46 / 29 of 47 | identical, 0 entries changed |
| the 47, pane off | 17 of 25 / 16 | identical, 0 entries changed |
| harness dir, pane on / off: objects | 68 of 86 / 55 of 65 | identical, 0 entries changed |
| translation census (`corpus_metric.json`) | | unchanged |
| notebook first-open | 2,148,818 B | 2,148,818 B (+0, PASS) |
| pine chunk / total JS | 417,918 / 13,253,874 B | 417,950 / 13,255,794 B |
| `paramIds.test.js` | green | green, no edit |

Why the served numbers do not move: the runtime pane is dark (`VITE_PINE_RUNTIME_PANE_ENABLED`), and the
object lane consults this lane only for a last-bar drawing it could rescue - no such script changed.

Mutations (bytes + sha256, restored by bytes): 18 run, 18 red after one fix - M5 (8-digit literal)
first SURVIVED because the probe's own `color.r(k1)` rows are folded by the columnar lane; the rail was
rebuilt on `bgcolor` of a `var` and then went red. M16 (ownership re-checked in the drawing-end
predicate) survived and the check was deleted as dead (`lowerStmts` is the authority).

## RT1 - the runtime lane as the member door's general fallback (2026-10-02, step 64)

Branch `pine/rt1-runtime-fallback`, base origin/master `5564cca92b` + R1 (`44aa7cc9b0`, merge
`867beab706`), master `c31023ef1d` merged (`c03f08295a`). Integrator ruling: the member door has
two engines; a script the HOST lane refuses goes to the RUNTIME lane, and if that lane builds it
within its budgets and everything it would draw is exact, the pane draws it from there. Behind the
existing `VITE_PINE_RUNTIME_PANE_ENABLED`, still OFF; the store's door behind its own
`PINE_RUNTIME_SAVE_ENABLED`, OFF.

### The routing, and which sentence a member reads

- `paneGate.runtimeFallbackOf(t)`: the host translation refused (any refusal) -> the runtime lane is
  asked. `runtimeRouteOf` (every refusal names the lane) keeps its C23 wording and behaviour.
- **Decision: when the runtime lane declines, the member reads the HOST refusal verbatim, guard
  included.** It names the construct the member wrote in TradingView's terms with its `TO UNBLOCK`;
  the runtime lane's reasons are about its own internals. The runtime reason rides beside it
  (`runtimeDeclined: {code, why}`) for the census, never instead of it.
- `pine.js` `refusedPresentation` (asked for only with the flag on): a refused row keeps its title,
  presentation and whether its call was written with an `offset`. Off, nothing changes.

### What the runtime document will not draw, by name (each railed in `vendorHarness.rt1RuntimeFallback.test.js`)

| construct | rule | why |
|---|---|---|
| a `?:` whose test can be `na` (`lowerIr.js::naTestsOf`, a `SELECT` not provably 0/1) | the fallback refuses the script, `runtime:na-test` | the shared `TERNARY` answers `na`; TradingView takes the other branch: `qqe-signals` RDDT 1D bar 73 (vendor na, ours 20.72), `pivot-point-supertrend` RDDT 1D `Buy` bar 517 (118.94 vs 117.31). Capture queued: `capture-queue-2026-10-02-rt1-na-test.md`, probe `rt1-na-test.pine` |
| a series not proven to start at the listing | the document computes nothing, `runtime:history-start` | R-W applied to this lane: a per-bar run seeds `var` state at its first bar, TradingView's bar 0 only from the listing; the host lane admits only state that forgets its seed in 250 bars, this lane cannot prove that of a script |
| a row drawn with `offset` | withheld, named in the disclosures | the runtime document draws each value on the bar that computed it |
| a row whose colour changes per bar, or is unknown (refused row, no presentation) | withheld, named | the document carries one static colour; the harness grades a wrong colour DIVERGE (R-G keeps a host line because it draws today; nothing draws a runtime row today) |
| `fill` / `hline` / `bgcolor` / `barcolor` / candles | not drawn, named in one disclosure | no row on this document |
| a source the server would not accept (`RUNTIME_REPAINT_RISK`) | declined, `runtime:repaint-unstated` | unchanged; 127 of the census declines are this |

### Performance, the budget, and no freeze

`runtimeFallbackPerf.measure.test.js` (newest 5,000 bars of the committed AAPL 1D capture, cold,
median of 5, this box): adx-and-di-for-v4 118 ms, inside-bar 144 ms, wyckoff 94 ms (it then refuses
by name on AAPL, `array.max of an empty array`). Every one is several frames, so the run goes OFF the
main thread: `runtime/runtimeWorker.js` runs `computeRuntimeColumns` (the one computation; the
synchronous door runs the same function), `runtimeAsync.js` posts plain rows and lands the columns,
and the chart repaints through `serverCompute.notifyColumnsLanded` (the generation `StockChart`
already listens to). Measured in headless Chromium against a local flag-on build: first run 354 ms
(includes loading the 914,591 B worker), second 39 ms, the page kept painting. **Budget: 1,000 ms
per indicator run** (`RUNTIME_PANE_TIME_BUDGET_MS`, ~7x the slowest reading), enforced through the
VM's own per-bar hook; past it the run stops by name (`runtime:time-budget`, naming the bar it
reached) and nothing partial is drawn. No VM limit moved.

### The kill switch (never a delete)

`PINE_RUNTIME_KILL_LIST` on `web` (comma/space separated; a definition id `u_` + 12 hex, or the
sha256 of the Pine source, a prefix of >= 12 hex accepted). A listed script: its save is refused; a
stored copy is SERVED with `meta.runtimeKilled` (list, get, history) and every client's install
door refuses it; the member door's preview reads the list from `GET /api/user-definitions/runtime-kill`
and falls back to the host refusal. The stored row is never touched; unlisting brings it back on the
next read (`test_runtime_definitions.py`).

### The server's door

`api/services/runtime_definitions.py` + `user_definitions._save_runtime`: same table, versions,
tombstones, count cap, 64 KiB cap; `ast_hash` = `runtime:sha256:<source>`; repaint stamp re-derived
server side; `REPAINT_RISK` mirrored byte for byte (railed against the JS literal). The sweep, the
alert lane and the relint pass never admit a runtime row (railed). Route count 16 -> 17 in the three
files that assert it.

### Measured (base `867beab706` / after, merged tree `dcb7da5dad`)

| | base | after |
|---|---|---|
| member door attach, objects off / on | 45 / 68 | 45 / 68, **0 rows changed** in either state |
| member door, objects on + runtime on | (69: C23's routed inside-bar) | **71**: + adx-and-di-for-v4, wyckoff-accumulation-distribution |
| the 47, pane on / off | 29 MATCH (objects 30) / 16 (objects 17) | identical, 0 entries changed |
| the 47, pane on + runtime on | - | 30 MATCH, 0 DIVERGE added (inside-bar INCONCLUSIVE -> MATCH) |
| harness dir, pane on / off | 50 / 37 MATCH (objects 71 / 58) | identical, 0 entries changed |
| harness dir, pane on + runtime on | - | 52 MATCH, DIVERGE 26 -> 26: adx-and-di and inside-bar -> MATCH, three deadband probes compare more items, all agreeing |
| translation census | 64 / 58 | unchanged (`corpus_metric.json` untouched) |
| notebook first-open | 2,148,818 B | 2,148,818 B (+0, PASS) |
| pine chunk / total JS | 417,950 / 13,255,794 B | 418,281 / 14,179,578 B (the runtime worker is 914,591 B, fetched only when a runtime pane computes) |
| `paramIds.test.js` | green | green, no edit |

Ungraded by capture: wyckoff-accumulation-distribution (`var` x12, 17 `if`, `ta.valuewhen`,
`ta.pivothigh`/`pivotlow`, `ta.barssince`, `ta.rsi`, `array.new_float`/`push`/`min`/`max`, a `for`,
`box.new`; three of its eight `plotshape` rows withheld for per-bar colour).

Remaining runtime declines on the corpus (flag on): `runtime:repaint-unstated` 127,
`history-dynamic-offset` 9, `call-undeclared-builtin-state` 7, `library` 6, `na-test` 6 (cc-yata,
fibonacci-dolphintradebot, pivot-point-supertrend, qqe-signals, supertrend-strategy,
trend-targets-algoalpha), `function-global-state` 4, `statement` 4, `withheld-all` 3, others <= 3.

## O1 - drawing-only scripts the member door refuses `pine:no-output`: why each draws nothing (2026-10-02, step 67)

Branch `pine/o1-drawing-only`, base `integrate/wave15-2026-10-02` (`a09ae5dbed`). Lane brief: the
33 corpus scripts the member door refuses `pine:no-output` (objects-only pane ON, as in
production) and the 6 it refuses `pine:object-removal-lost`. A script reaches `pine:no-output`
when it offers no plot AND its host object program kept no op (`pine.js`, the `resolved.length
=== 0` return); `pine:objects-only` with a lost removal becomes `pine:object-removal-lost` at
`paneGate`.

### The instrument

`__tests__/vendorHarness/o1DrawingOnly.measure.test.js` (opt-in, `O1_TRIAGE=1
O1_TRIAGE_OUT=<json>`): every corpus script the door refuses with either guard, through
`enterMemberDoor` (the census's own door), with the host translation's `objectDiagnostics` and the
runtime lane's answer for the same script (runtime pane ON: `runtimeDeclined`). Two diagnostics are
new, both read-only (nothing decides from them): `createDropWhy` - the refusal sentence behind a
`create:<family>` drop, which used to be a bare count - and `guardRefusalWhy` - the sentence behind
each `guardRefusals` entry. Census at base (`memberDoorCensus.measure.test.js`, runtime state on):
off 52 / 266, **on 75 / 266**, on + runtime 78 / 266; `pine:no-output` 33, `pine:object-removal-lost` 6.

### The runtime lane cannot draw any of the 39, structurally

`memberPaneDefinition.js::runtimeLaneDefinition` builds rows from PLOT outputs only and takes its
objects from the HOST program (`t.objects`); a script with no plot ends at `runtime:nothing-drawn`
even when every earlier check passes (`visualizing-displacement-tfo` is the one that gets that far).
`runtime/objectLane.js` is not on the member door's path. What the fallback says first, for the record:

| runtime decline | n | scripts |
|---|---|---|
| `runtime:repaint-unstated` (RT2's area) | 26 | every script not listed below |
| `runtime:call-undeclared-builtin-state` (RT3's) | 2 | ipda-standard-deviations, previous-day-high-and-low-separators |
| `runtime:statement` (RT3's) | 2 | market-structure-inducements, session-tpo-profile |
| `pine:builtin` | 2 | power-of-3-ict-01, scalping-strategy-with-williams-r |
| `pine:function` / `pine:statement` (front end) | 2 | ict-killzone-index-version, trendline-pivots-quantvue |
| `runtime:function-global-state` (RT3's) | 1 | auto-harmonic-patterns-open-source |
| `runtime:history-dynamic-offset` (RT3's) | 1 | support-and-resistance |
| `runtime:block-value` | 1 | fvg-detector-tradingfinder |
| `runtime:object-op` | 1 | sonarlab-order-blocks |
| `runtime:nothing-drawn` | 1 | visualizing-displacement-tfo |

So this lane works on the HOST object program. A runtime-lane drawing door (objects from
`runtime/objectLane.js`, no plot required) is a separate admission and is not built here.

### Cause table: the first wall that empties each drawing (host object lane)

"First wall" = the first entry of `guardRefusalWhy`, else of `createDropWhy`, else the dominant
`dropReasons` key, read at base off `o1DrawingOnly.measure.test.js`. A script usually has more
walls behind its first; the ones measured behind it are named.

| cause | n | scripts (first wall; walls behind it) |
|---|---|---|
| **G1** a collection / UDT / method the host lane cannot follow (`pine:collection`, `pine:type`, `fn:receiver`, `coll:diverged`) | 11 | auto-harmonic-patterns-open-source (`zigzagratios` written in a function; getters `line.get_x2` as coordinates), order-blocks (`pvh1_price` block-valued; arrays written in blocks), zigzag-multi-time-frame-with-fibonacci (`zigzag` written in a block), mgi-levels-suite (arrays created with values; methods on UDT receivers x137), multi-timeframe-fvg-tfo (arrays read by a conditionally called helper), volumized-order-blocks-flux-charts (a UDT list never pushed in the reader's view; method receiver), footprint-iq-pro-tradingiq (`FD.tickLevels.size` on a UDT field; `timeframe.in_seconds`), ict-institutional-order-flow-fadi (UDT pivots; 7 helper calls under a condition reading history, `fn:conditional-history`), ipda-standard-deviations (UDT + `chart.point`; a method `unshift(line.new(...))` in an expression), higher-time-frame-fair-value-gap (UDT field `htfBar.consistentUpdates` reassigned; `polyline.new`), volume-delta-oi-delta-kioseff (`label.all` loop; block-valued counters; two requests) |
| **G2** a value a loop computes (running total, arg-min, break-search; ruling R7) read by a drawing | 6 | trendlinesample (`lowest_x1` arg-min over `for j = shortPeriod + 1 to longPeriod`), support-and-resistance (`r` / `s` running totals in a `for`; unbounded `ta.barssince`), volume-profile-v054beta (`POC` / `VAH` / `VAL` from a `for`), session-tpo-profile (a running total with no window), sonarlab-order-blocks (`last_green` = first index in `for i = 4 to 15` with `break`; `box.get_top` in a delete guard), fibonacci-retracement-statistics-by-volprofex (`while`-built lists; `trendCount` undefined to the reader) |
| **G3** a user function's own mutable state read by its drawing (`pine:state` "reassigned inside", block-valued `if`) | 4 | fvg-detector-tradingfinder (`DDFVG` in `FVGDetector`; hoisting the once-called body to the top level by hand moves it to the next wall, an `if` / `switch` used as a value - measured, not kept), market-structure-inducements (`BeChoCh_B` in `Structure`), fair-value-gap (`currenttop` in `f_gapCheck`, box getters in its loop; `input.timeframe` text), market-sessions-and-volume-profile (`vah` / `val` in `drawCurZone`; arrays; `ta.highest` with a non-literal length) |
| **G4** another symbol, a watchlist or another timeframe the door does not serve | 5 | correlation-matrix (7 FX pairs, withheld since C49; its `label.new` sits in a comma line the reader marks unsupported, so the program is null with 0 drops), mtf-watchlist-charts-anan (4 symbols x `drawChart` state), strong-start-rvol-dashboard (a 40-symbol watchlist; `table.clear`), screener-mean-reversion-channel (40 `request.security`), tehthomas-aligned-timeframe-fair-value-gaps (`htfTime` request) |
| **G5** the clock: `time(<tf>, <session>)` / `time(<tf>)` outside what C30 / C49 serve | 4 | asianrange-and-killzones (`"1900-0001"` wraps midnight: no capture holds a bar after 20:00), power-of-3-ict-01 (`"1900-0100"`, same; `str.tonumber`), ict-killzone-index-version (a session read on another timeframe), volume-profile-auto-line-v2 (`time(<tf>)` off the served list; then `line.get_y1` getters in loops) |
| **G6** a builtin the grammar does not hold | 4 | previous-day-high-and-low-separators (`dayofweek(time[1])`, `weekofyear`), volume-open-interest-footprint (`chart.left_visible_bar_time`: the visible range), market-profile-with-tpo (`syminfo.type`; `for`-built counts), scalping-strategy-with-williams-r (`str.tostring(timeframe.period)`; its one label has `y = na`, which TradingView does not draw) |
| **G7** a drawing helper called inside an expression: `cond ? f(...) : na` (`fn:in-expression`) | 1 | fib-retracement (4 calls; 130 ops otherwise converted, 0 other drops; the 4 lost bodies hold `line.delete` / `label.delete`, hence `object-removal-lost`) |
| **G8** comma-joined reassignments `a := x, b := y` are not split (the splitter takes `=` bindings only) | 1 | trendline-pivots-quantvue (`utlX1 := utlX2, utlY1 := utlY2`; behind it: `for l in` body locals `src` / `first` unread in guards, `line.get_*` getters of the iterated handle) |
| **G9** a user function returning a tuple | 1 | linear-regression-channel-breakout-strategy (`[slope, ...] = get_channel(...)`) |
| **G10** nothing a pane can draw | 2 | one-indicator-multiple-max-40-checked-symbols (`alert()` only: TradingView draws nothing either - a correct end state), visualizing-displacement-tfo (its only output is `barcolor(..., offset = require_fvg ? -1 : na)`, withheld by B1's offset rule) |

Every G2 / G3 wall is a known lane wall (R7, C34, the inliner's state rule), every G4 one is data
(C26 / C49), every G5 one waits on a capture (C30 / C49), and the RT-owned runtime walls are left
to RT2 / RT3. The two causes that are EXACT from Pine's own grammar and cost no new evidence are
G7 and G8; they are taken first, one commit each (below).

### O1 G7 - a drawing helper as the THEN arm of `?:` whose ELSE arm is `na`

`pineObjects.js::ternaryDrawArm`: `[<type>] x = cond ? f(…) : na`, or the bare statement
`cond ? f(…) : na`, where `f(…)` is the whole THEN arm and a function or method that draws, the ELSE
arm is the bare `na`, the test itself draws nothing, and `x` is written nowhere else in the script,
is inlined as `f(…)` under the guard `cond` — the walk's own `if` entry.

**Argued from Pine, not from a capture of these scripts.** `?:` runs only the arm it picks (vendor
capture `options-max-pain-calculator-backquant-rddt-1d-2026-09-28`, C18) and takes the ELSE arm on an
`na` test (RT1's two captures), which is what `if` does with `na`; with the bound value never read,
the statement is `if cond` + `f(…)`. The same equivalence `emitTernaryCreate` has carried for a
built-in `<family>.new` since 2026-09-22 (`objectTernaryCreate.test.js`).
**Still refused, by name (`fn:in-expression`):** a `var` initialiser (it runs once, on the first
bar), a `:=` reassignment, a bound name read anywhere else, an ELSE arm other than `na`, a call that
is not the whole arm, a test that draws.

Measured (base = the triage commit `69ec7f8963`):

| | before | after |
|---|---|---|
| member door, objects off / on / on + runtime | 52 / 75 / 78 | 52 / **76** / **79** — 1 row each: `fib-retracement` (objects-only refusal → attaches; flag off its sentence becomes the clean-objects-only one) |
| previously attached scripts lost | - | **0** |
| committed harness dir, objects pane on (138 graded) | overall MATCH 52, objects MATCH 73 / DIVERGE 18 | identical, **0 entries changed** |
| translation census (`corpus_metric.json`) | host 71 / screener 64 | host **72** / 64 — the `fib-retracement` row only |

`fib-retracement` on NYSE:RDDT 1D vendor bars (`adx-and-di-for-v4-rddt-1d-2026-09-27`, its OHLC only):
7 lines and 7 labels, each at the level `highest(100)` / `lowest(100)` / `highestbars` /
`lowestbars` give from those bars, from `bar_index[-FL]` to the last bar, texts
`"0.236 ( 152.4096372 )"` etc. — computed independently in
`vendorHarness.o1FibRetracement.test.js`, not read off the engine. With `ExtraFibs` false the four
ternary calls never run (7, not 8). Capture queued: Q-O1a (probe
`vw-ternary-draw-helper.pine`), Q-O1b (the script itself, both input states) —
`capture-queue-2026-10-02-o1-drawing-only.md`.
Rails: `ast/o1DrawingOnly.test.js` (same program in both spellings, the guard is the test, five
refusals kept), `vendorHarness.o1FibRetracement.test.js`; 7 mutations, each red. The control in
`pineObjectOnlyHostAccept.test.js` that used `fib-retracement` as its partial-program specimen now
uses `fair-value-gap` (draws and drops; non-vacuity asserted) — the rule did not move.

### O1 G8 - comma-joined reassignments split as separate lines

`pine.js::blockStatements` split a comma line only when EVERY segment was a `=` binding
(`isBindingSegment`), so `recent_dn2 := recent_dn1, i_recent_dn2 := i_recent_dn1` stayed one
statement the walk could not read. A segment `name <mutator> expr` (`:=`, `+=`, …;
`isReassignSegment`) now splits too, beside a binding or another reassignment. The all-or-nothing
rule is unchanged: one segment of any other shape (a call) and nothing splits. **Exact from Pine's
grammar**: comma-joined statements run left to right, which is what separate lines do. Both lanes
read the split (the object reader's `splitCommaStatements` already did).

Measured (base = the G7 commit `09a77a0fdb`):

| | before | after |
|---|---|---|
| member door, objects off / on / on + runtime | 52 / 76 / 79 | **54 / 78 / 81** — `auto-trendline-dojiemoji` and `pa-zigzag-fibonacci-fan` attach (plots; the first also draws its trendlines); `trendline-pivots-quantvue` `pine:no-output` → `pine:object-removal-lost` (13 ops now convert; its `for l in` locals and `line.get_*` getters remain) |
| previously attached scripts lost | - | **0** |
| committed harness dir, objects pane on (138) | overall MATCH 52, objects MATCH 73 | identical, **0 entries changed** |
| translation census | host 72 / screener 64 | host **74** / screener **65** — exactly those three rows |

**Why the two attaching scripts are not a guess.** At the triage base, the TWO-LINE spelling of each
(its comma lines broken onto lines by hand) already attached through the member door; only the
published comma spelling did not. Their translation now equals that spelling's
(`vendorHarness.o1CommaReassign.test.js`, comma lines split in the test). For `pa-zigzag-fibonacci-fan`
the host lane and the per-bar runtime lane — two independent evaluators — agree on every bar of
NYSE:RDDT 1D vendor bars (9 plots, 2,770 finite values, 0 disagreements). `auto-trendline-dojiemoji`'s
runtime front end refuses it (`pine:block`), so it has the first half only. No TradingView capture of
either exists.
`corpusMetric.test.js`'s lane balance (`screener >= host - strategies`) held only because few
objects-only scripts were clean; it now also takes out host rows the screener refuses
`pine:objects-only` BY CONTRACT (the same row-wise test C50 uses for strategies) — 74 host,
65 screener, 8 strategy-only, 9 objects-only.
Rails: `ast/o1DrawingOnly.test.js` (+4: same translation two spellings, binding + reassignment,
all-or-nothing kept), `vendorHarness.o1CommaReassign.test.js` (3); 5 mutations (one on the lane-balance exclusion), each red.

### O1 G2b - a getter read through a local is the getter read at the `if`

Behind sonarlab-order-blocks' first wall (G2, below) stands a second: `top = box.get_top(sbox)` …
`if OBBearMitigation > top` in a loop over its list of boxes refused `pine:drawing` — the object
reader serves the getter written INSIDE the condition (C16: `if low < box.get_bottom(b)`, graded on
`institutional-smc-order-flow-matrix-pro`) but not read through a local.
`pineObjects.js::getterAliasStep`: a binding `[<type>] name = <family>.get_<prop>(<handle>)` (or
`<handle>.get_<prop>()`) in a statement list, read in the condition of a later `if` in the SAME list,
has that `if`'s condition tokens rewritten to the getter while no statement between them can change
the object: none with an object effect anywhere in it (a `line.` / `label.` / `box.` / `table.` /
`linefill.` / `polyline.` call other than a getter, a `set_*` / `delete` / `copy` method, a function
or method that draws) and none reassigning the local or the handle. **Argued from Pine:** the getter
is evaluated where the binding stands; with nothing between able to move the object, evaluating it at
the `if` answers the same number. Not rewritten: a history read of the local (`top[1]`), an
`else if`, anything after a statement with an object effect.

Measured alone (base = the G8 commit `41561a52c7`): member door 54 / 78 / 81, **0 rows changed** in
any state; committed harness dir 0 entries changed. It moves a script only with G2a (below).
Rails: `ast/o1DrawingOnly.test.js` (+6: same program as the inline getter, a second alias between,
three refusals kept); 4 mutations: 3 red, 1 fail-closed survivor named — dropping the `top[1]`
exclusion rewrites to `(box.get_top(b))[1]`, which the getter-history rule (C14) refuses anyway.

### O1 G2a - a first-match search loop is the chained `?:` it computes

`pine.js::rewriteFirstMatchLoops`, run on the statement tree before either walk (host lane only; the
runtime lane runs loops itself):

    for i = 4 to 15 by 1                 last_green := (close[4] > open[4]) ? 4
        if close[i] > open[i]      →         : (close[5] > open[5]) ? 5 : … : last_green
            last_green := i
            break

**Exact from Pine:** the loop evaluates the tests in order, stops at the first that holds and leaves
the variable as it was when none does; the chain evaluates the same tests in the same order and
stops at the same one. An `na` test is false in the `if` and takes the next arm of the `?:` (RT1's
captures). **Only that shape:** integer-literal bounds (`by` a positive literal and ascending, or no
`by`, either direction), at most 64 passes, a body of ONE `if` (no `else`) whose block is exactly
`X := <counter>` then `break`, a test with no call, no assignment, no `X`. Anything else is left
alone. The rewritten statement keeps the assignment's own `X` / `:=` tokens (the reassignment ledger
`reassignedNames` is read off the token stream and names those objects).

Measured (base = the G2b commit `83422ea9c8`):

| | before | after |
|---|---|---|
| member door, objects off / on / on + runtime | 54 / 78 / 81 | 54 / **79** / **82** — `sonarlab-order-blocks` attaches (G2a + G2b; flag off its sentence becomes the clean-objects-only one) |
| previously attached scripts lost | - | **0** |
| committed harness dir, objects pane on (138) | overall MATCH 52, objects MATCH 73 | identical, **0 entries changed** |
| translation census | host 74 / screener 65 | host **75** / 65 — the sonarlab row only |

**No capture of sonarlab exists.** `vendorHarness.o1Sonarlab.test.js` recomputes the script step by step from the vendor's bars of
three committed captures (NYSE:RDDT 1D and AAPL 1D from the listing, BRK.A 1D not from the listing)
and requires every box the door holds at the last bar to be one of the newest K the script keeps
alive (TradingView's collector removes the oldest; K = 5, 17, 24 is the engine's C7 collector),
`right == left`. It discriminates: a reference with sensitivity 0 or with a bottom-crossing
mitigation goes red. ⚠️ Its one reading not settled by a capture: `sens = input.int(28)` then
`sens /= 100` is read as 0.28 (the engine, and the reference) — TradingView's operators page says
int division "is always a number with a fractional value", and the script's own tooltip ("Lower the
sensitivity to show more order blocks") only makes sense that way; an `int` variable taking a
fractional `/=` is not witnessed. Queued: Q-O1c.
Rails: `ast/o1DrawingOnly.test.js` (+7: same plot two spellings, `by` and descending, four shapes left
alone), `vendorHarness.o1Sonarlab.test.js` (3); 8 mutations: 7 red (incl. both rules on the sonarlab
rail and two reference perturbations), 1 equivalent survivor named (accepting a body longer than two
statements still requires `break` second, and anything after `break` never runs).

### O1 - where the branch leaves the 39 (base `a09ae5dbed` → tip `c82c14ad0c`)

| | base | tip |
|---|---|---|
| member door attach, objects off / on / on + runtime | 52 / 75 / 78 | 54 / **79** / **82** |
| `pine:no-output` / `pine:object-removal-lost` | 33 / 6 | **31 / 6** — out: `fib-retracement` (G7), `sonarlab-order-blocks` (G2a + G2b); `trendline-pivots-quantvue` moved no-output → removal-lost (G8) |
| attached from outside the 39 | - | `auto-trendline-dojiemoji` (was `pine:state`), `pa-zigzag-fibonacci-fan` (was `pine:reassign`), both G8 |
| previously attached scripts lost | - | 0, every state |
| committed harness dir (138), objects pane on | overall MATCH 52, objects 73 | identical, 0 entries changed |
| …objects pane on + runtime pane on | overall 53, objects 78 | identical, 0 entries changed |
| …objects pane off | overall 39, objects 60 | identical, 0 entries changed |
| translation census (`corpus_metric.json`) | host 71 / screener 64 | host 75 / screener 65 |

What is left of the 37, by the cause table above: G1 collections / UDTs 11, G2 loop values 5
(running totals, ruling R7), G4 data 5, G3 a function's own state 4, G5 the clock 4 (capture-bound),
G6 builtins 4, G9 a user tuple 1, G10 2, and `trendline-pivots-quantvue` (for-in locals + getters of
the iterated handle). Tried and NOT kept: hoisting a once-called top-level function's body
(fvg-detector, market-structure-inducements) — measured, each next wall is a block-valued `if` /
a `string` state (`pine:text-value`), so nothing moves.
## Wave 15 integration (2026-10-02) - L1 + B1 + H1 + RT1, and what H1 re-admitted

Branch `integrate/wave15-2026-10-02`. Six-shard gate: 6 NEW against the baseline, 125 no
longer failing, 2,485 files, totals reconcile. Three are master's known reds
(`entryExcludesChartEngine` x2, `objectFnInline.vendor` sector-rotation). The other three, and
two RT1 rails found by the focused run, were rule-meets-rule, none a regression:

| rail | what moved | evidence |
|---|---|---|
| `rt1RuntimeFallback` (qqe-signals, pivot-point-supertrend) | the host lane now serves both, so the door never reaches the runtime fallback | `vendorHarness.h1Ratchet`: every label TradingView's |
| `rt1RuntimeFallback` (pivot-point-supertrend `Buy`) | the runtime `Buy` now AGREES with TradingView; RT1's disagreement was the pivot tie, which the runtime lane reads from the shared house column, not the `na` test | `vendorHarness.h1PivotTies`; the decline keeps a door witness on `trend-targets-algoalpha` |
| `graphSaveDoor`, `paramSingleTranslation`, `builderInputs.symbolClosure` | `high_engagement__03-supertrend-kivancozbilgic` (KivancOzbilgic SuperTrend) translates again: R-F had refused its band, H1 admits the ratchet | same ratchet shape graded on `pivot-point-supertrend`; host vs runtime on RDDT's 631 listing bars, all six rows: Up Trend 375 bars, Down Trend 247, UpTrend Begins 5, Buy 5, DownTrend Begins 6, Sell 6 - identical drawn sets, 0 values differ |

The save door has its demonstration back: SuperTrend's document is 383,178 B and reduces to
6,751 B (x56.8) with every parameter placed, reading back as the same indicator.
No TradingView capture of SuperTrend itself exists yet; it is queued as a cheap confirmation.
## RT2 - the runtime document states its repaint class (2026-10-02, step 65)

Branch `pine/rt2-runtime-repaint`, base `pine/rt1-runtime-fallback` (`b711ef5c6a`); wave 10
(`e4e24524ef`) was already an ancestor, nothing to merge. Behind `VITE_PINE_RUNTIME_PANE_ENABLED`,
still OFF; the store's runtime door behind `PINE_RUNTIME_SAVE_ENABLED`, still OFF.

### The rule, as implemented

`engine/runtime/runtimeRepaint.js::runtimeRepaintOf(source)` returns the host linter's class
(`non-repainting` / `preview-repaints` / `repaints`) by the host's own `modeFromReach`, as the
WORST reach over the reads the program makes. Reads are taken off a small lexer (comments and
strings dropped; dotted names joined across horizontal whitespace exactly as `pine.js::lexPine`
joins them). Everything the per-bar run computes from bars at or before its own bar reaches 0;
a later bar can reach a run only through what it is HANDED, and `runtimeRepaint.json` names those
reads:

| read | reach | authority |
|---|---|---|
| a clock leaf (`barstate.*`, `bar_index`, `time`, `dayofweek`, ... 18 spellings) | the HOST linter's `astReach({type:'series', name: leaf})` over `closedTable.json`, joined with `clockEdge` | the shared table; the spelling -> leaf map is railed against `pine.js` (`pineClockKeyOf`, `BUILTIN_BARSTATE_SERIES`) |
| `clockEdge`: `islast`, `islastconfirmedhistory` | 1 | FINDING, below |
| `clockEdge`: `lastbarindex`, `lastbartime`, `lastbar{year,month,dayofmonth,hour,minute}` (`last_bar_index`, `last_bar_time`, `timenow`) | unbounded | FINDING, below |
| `varip`, `barstate.isnew`, `chart.left/right_visible_bar_time`, `barmerge.lookahead_on` | unbounded | runtime table (the host refuses or has no node for these) |
| `lookahead =` / `calc_on_every_tick =` other than `barmerge.lookahead_off` / `false` | unbounded | runtime table |
| `request.security` / `security` NOT spelled as this chart at this period (`syminfo.tickerid`, `timeframe.period` or `""`, positional or named) | unbounded | runtime table |
| any other `request.*` | unbounded | runtime table |

A source the lexer cannot read (an unterminated string) has no stated class:
`runtime:repaint-unstated`, the only way left to reach it.

The document carries the class: every drawn row's `mode` AND `plots[].forward` (the one field
`defSchema` lets a non-tree plot state), so `meta.repaint` (worst row) and the pane's own notice
(`repaintVerdict.js` through `lint.js::lintDefinition`'s hand-written branch, `modeFromReach`
again) say it, plus a disclosure naming the reads. Conservative by construction: the class is the
whole program's, so a read that feeds only an undrawn value still labels every row.

**Declined by name, newly said (it was hidden behind the regex):** a `request.security` the
lowering does not fold into the chart's own expression reads bars the pane never hands the run
(`computeRuntimeColumns` passes no `requestBars`; the VM would answer `na`). The door declines it
(`runtime:request`, from the probe's new `requests` count) and `computeRuntimeColumns` refuses it
at the run, so a stored document cannot draw a blank column either.

**Server parity.** `api/services/runtime_repaint.py` mirrors the lexer and rules over the same
JSON and the host's `ast_lint.ast_reach` / `mode_from_reach`. `tests/fixtures/runtime_repaint/
corpus.json` holds the JS answer for all 266 corpus scripts (sha256 of the LF text, class,
forward, reads); `runtimeRepaint.test.js` writes/compares it, `tests/test_runtime_repaint.py`
holds Python to the same rows. The save door re-derives the class, refuses a document whose
`meta.repaint` or a drawn row's `forward` disagrees (both directions), and stamps the derived
class. Corpus: 113 non-repainting, 31 preview-repaints, 122 repaints; reads most often
`barstate.islast` 85, `request.security` 66, `barmerge.lookahead_on` 30, `security` 25.

### FINDING for the integrator (railed, not acted on)

`closedTable.json::clock` declares `islast`, `islastconfirmedhistory`, `lastbarindex`,
`lastbartime` and `lastbar{year,month,dayofmonth,hour,minute}` with `lookback: 0` and no
`forward`, so the HOST linter answers reach 0 (`non-repainting`) for them. By the linter's own
one-sentence rule that is not true: `runtimeRepaintEdge.test.js` moves the fetch through
`indicators.js::computeClock` (N vs N+1 / N+2 bars, newest forming vs closed; a daily fixture
across a year end and a 5-minute one across midnight) and finds EXACTLY those nine leaves moving
on a closed bar, with `islast` / `islastconfirmedhistory` final one bar later and the rest never.
The runtime document carries the edge in `runtimeRepaint.json::clockEdge`, joined with (never
replacing) the host answer - the rail proves that moving a host declaration moves the runtime
answer. Declaring `forward` on those leaves in the shared table would fix both lanes at once, but
it moves host badges, `canSaveFormula`, the saved definitions' relint and the alert repaint gate,
so it is a ruling, not this lane's change.

### Measured (base `b711ef5c6a` / tip `a210db44dd`)

| | base | tip |
|---|---|---|
| member door attach off / on / on + runtime | 45 / 68 / 71 | 45 / 68 / **71** |
| rows changed off / on | - | 0 / 0 (base vs base 0) |
| rows changed on + runtime | - | 127: every `repaint-unstated` row now names its real wall; 0 attach |
| `runtime:repaint-unstated` | 127 | **0** |
| the 127 now decline at | - | library 27, call-undeclared-builtin-state 11, pine:request 9, runtime:statement 8, pine:builtin 8, input-kind 6, history-dynamic-offset 5, history-expression 4, ... runtime:request 3, varip 3 |
| the 47, pane on / off / on + runtime | 29 / 16 / 30 MATCH | identical, 0 entries changed |
| harness dir, pane on / off | 47 / 34 MATCH | identical, 0 entries changed |
| harness dir, pane on + runtime | 49 MATCH, 26 DIVERGE | 49 MATCH, **28** DIVERGE: `vw-int-array-avg` and `vw-int-array-avg-neg` |
| translation census | | unchanged (host translation untouched; `corpus_metric.json` untouched) |
| notebook first-open | 2,148,818 B | 2,148,818 B (+0, PASS) |
| pine chunk / total JS | 418,281 / 14,181,373 B | 418,281 / 14,189,502 B (+8,129: `runtimeRepaint.js` + its JSON in the member pane chunk and the worker) |
| `paramIds.test.js` | green | green, no edit |

Why nothing newly attaches: with the gate removed outright (a probe run, not shipped) 0 of the
127 attach - every one stops at a later wall. The classifier removes a wall that was hiding the
real ones; it does not move the metric by itself. No newly attached script, so no new perf row.

**The two DIVERGE added (runtime flag on, harness dir), and why they are not drawings.** Both
`vw-int-array-avg` probes now reach the runtime document (they read `barstate.islast` /
`barstate.isfirst` only; class `preview-repaints`). Every PLOT stays INCONCLUSIVE ("computeFor
returned no column"): the document is a FALLBACK, R-W applies, and the harness' bars are not
proven to start at the listing, so `runtime:history-start` computes nothing - nothing is drawn.
The DIVERGE is the OBJECTS row only: the document carries the host lane's object program (lines /
labels whose text depends on `array.avg` of an int array) and the harness grades the counts and
texts it would draw (e.g. labels 25 vendor vs 1 ours). That is the RT1 object-carrying rule
applied to two scripts the regex used to stop, not a wrong drawing of a value: under
`runtimeHistory: 'listing'` a member's chart either computes the run on a listing-start series or
draws nothing; the host object program itself is unchanged and would be graded the same on the
host lane. Left as found and named here; the integrator decides whether a runtime document should
carry the host object program at all when its own run computes nothing.

### Rails and mutations

`runtime/__tests__/runtimeRepaint.test.js` (18: rules with controls, one-authority, spelling map,
corpus fixture), `runtime/__tests__/runtimeRepaintEdge.test.js` (8: the edge, measured),
`vendorHarness.rt2RuntimeRepaint.test.js` (6: on the committed ADX capture a stated
`preview-repaints` / `repaints` document labels every row, its notice names the read, and it
draws column-for-column what the graded MATCH document draws; the request decline at door and
run), `tests/test_runtime_repaint.py` (17), `tests/test_runtime_definitions.py` (the store,
incl. both disagreement directions). Two RT1/C23 rails used an unused `request.security` to make
a script unroutable; both now use a `varip` (declined `runtime:varip`).

17 mutations, each restored by bytes + sha256, each red on its own: edge join removed (JS 8 red;
Py 8 red), `islastconfirmedhistory` dropped from `clockEdge` (4), `varip` dropped (2), every
request the identity (2), comments read as code (2), dotted names not joined (Py 1), rows
hard-coded `non-repainting` (2), `forward` not stamped (3), door request decline removed (1), run
request refusal removed (1), server `meta.repaint` check removed (2), server stamp hard-coded (1),
server `forward` check removed (1), identity timeframe loses `""` (JS 1, Py 1), `pineClockKeyOf`
answers null (1).

## RT3 - the runtime lane's next walls: `na` conditions, bounded dynamic offsets, four builtins, frame-sized windows (2026-10-02, step 66)

Branch `pine/rt3-runtime-walls`, base `integrate/wave15-2026-10-02` (`a09ae5dbed`), RT2 merged
(`7008853902` -> `3f344bfeb0`) and the wave-15 tip (`529338e612` -> `6d880ddbd1`). Behind
`VITE_PINE_RUNTIME_PANE_ENABLED`, still OFF. Every "before" number below is the RT2 tip measured
on this box with RT3's source files swapped back (`git cat-file` blobs, restored and sha-verified).

### 1. `runtime:na-test` - an `na` condition reads as false (`91b3567731`)

- **One authority.** `interpret.js::pineBool` (na and 0 are false, any other number true) and
  `naConditionIsFalse(version)` (the LEXED pragma; v >= 4). The host lane's listing-pass
  `pineBoolAt` now reads `pineBool`; the runtime lowering reads a condition as `x != 0`, which is
  `pineBool` by construction (railed on na, 0, -0, +-1, fractions, +-Infinity).
- **Where it applies:** a `?:` test (both arms still evaluate; only the na test changes answer),
  `if` (already `JUMP_IF_FALSE`), and a v6 `not` (a v6 bool is never na, so a NaN this lane holds
  stands for false). Only with `historyFromListing`: off the listing a NaN can mean "not
  computable from this window", the split H1 makes in the host lane. The fallback probe lowers as
  the fallback runs (listing); a document run passes its own flag.
- **Evidence:** v4 - qqe-signals (bar 73) and pivot-point-supertrend RDDT 1D, runtime columns equal
  the capture on every plot, and with the rule mutated off qqe diverges at bar 73 again; v5 -
  `vw-var-seed` SPY 1D (5 `?:` tests that can be na) now MATCHes on all 8,473 bars, and cc-yata's
  54 plots grade identically; v6 - argued from Pine (bools are never na; `bool(na)` is false).
  Below v4 nothing is claimed: `TERNARY`'s na stands and the script is declined by name.
- **Still declined (`runtime:na-test`):** a v4/v5 `or` / `not` over an operand that can be na -
  `na or true` is true or na depending on whether the operand is read as false, and no capture
  separates the two (cc-yata grades the same either way). Probe and queue:
  `docs/pine/capture-queue-2026-10-02-rt3-na-logic.md`, `tools/visual_conformance/probes/rt3-na-logic.pine`.
  `and` is settled either way and is not counted.

### 2. `runtime:history-dynamic-offset` - a bound proved before bar 0 (`c44e7d6667`)

`READ_HIST_SLOT_DYN` was reserved in 2F-2 "until the ring depth it may reach is statically
bounded". `offsetRange` proves it by interval arithmetic: a whole number that folds (frozen
resolver, frame constants first, constant arithmetic via `bind.js::foldScalar`), a `for` counter
whose bounds fold and which the body never assigns, `+ - *` and unary minus. The ring is sized to
the bound (<= 5000, Pine's own `max_bars_back` ceiling); the IR checks the depth against the ring
of the frame it is in (main entry, or every call site's block); the VM reads `na` before bar 0,
the current bar for an na offset (C29), and **refuses by name** an offset past the ring rather
than read a wrapped cell. A bound stopped by a function parameter refuses carrying the name, so the
call site specialises (C35). The proof uses a side-effect-free evaluator (`constValueOf`).
Graded (no capture covers these scripts; argued exactly): a descending loop with `n - 1 - j` equals
the constant-offset spelling; Pine's own `pine_wma` loop equals `ta.wma` at two call sites.

### 3. `runtime:call-undeclared-builtin-state` - four builtins Pine defines (`90129016ba`)

`iff` (v1-v4) is the ternary; `vwma` / `linreg` are the HOST lane's own `BUILTIN_CALL_TREE`
expansions asked with the folded length/offset; `alma` is TradingView's published `pine_alma`.
Graded against independent JS references (direct least-squares fit, `pine_alma`,
sma(src*vol)/sma(vol)). The four rails that used `ta.vwma` as "genuinely undeclared" use `ta.cog`.
Left (10): `security` (v4 spelling, 4), `time(res)`, `tostring`, a method form on an array declared
from a text split (`deviations.size`), `ta.pivot_point_levels`.

### 4. `runtime:function-global-state` - a frame-sized window over a price series (`0b8ed8f12d`)

Five of six were `f(int len) => ta.highest(high, len)`: the price SOURCE was reported as "a
mutable GLOBAL" because the LENGTH is a frame slot. With a pure source and a length the call site
fixes, the call is the columnar lane's column (equal to the pasted-constant spelling). Left (1):
support-and-resistance reads a real mutable global. Also measured and NOT landed: a session text
fixed by a call site (`inSession(sess) => not na(time(timeframe.period, sess))`) - it works on
fixtures but moved no corpus script (every such script hits `input.session`'s `pine:input-kind`,
RT4's, or a timezone / `time(res, ...)` first), so it was set aside rather than shipped untested on
real code.

### 5. `runtime:library` - content, not code (`691047caf4`)

The runtime lane already calls the same `linkLibraries` after `lexPine`, reading the client
registry the doors fill. A door-level rail proves an imported fixture library is drawn by the
runtime lane equal to the function pasted in, and declines by name with the registry empty. The
33 at the door are 33 libraries not in the (empty) local store.

### Measured (RT2 tip / RT3)

| | before | after |
|---|---|---|
| member door, objects on + runtime on | 78 | **81** (+delta-rsi-oscillator-strategy, +fibonacci-dolphintradebot, +trend-targets-algoalpha), **0 lost** |
| runtime census compiled (bare / object trees) | 19 / 31 | 21 / 33 |
| door declines: `na-test` | 3 | 1 (cc-yata) |
| `history-dynamic-offset` | 12 | 9 |
| `call-undeclared-builtin-state` | 17 | 10 |
| `function-global-state` | 6 | 1 |
| `library` | 33 | 33 |
| `statement` | 12 | 14 (scripts reaching it from walls above) |
| harness dir, objects + runtime on | MATCH 53 / INC 53 / DIV 32 | MATCH 54 / INC 52 / DIV 32 (only vw-var-seed changed, INCONCLUSIVE -> MATCH) |

Scripts that moved to a different, later wall: 72s-strategy (pine:statement), advanced-custom-multi-ma,
atr-god-strategy, momentum-based-zigzag (runtime:history-expression - RT4's), atr-stepped-pdf-ma
(withheld-all, per-bar colour), kernel-channel-backquant and volatility-trend-score (presentation),
linear-regression-channel-breakout (strategy-call), neural-network (pivot rightbars from a frame),
nonlinear-regression-zlma (pine:statement), smoothed-gaussian (fill gradient), auto-harmonic
(object-op), macd-with-filter (text-value), market-structure-break-order-block and
ict-institutional-order-flow (history-dynamic-offset), volumized-order-blocks (pine:builtin),
williams-fractal (`valuewhen` in a function), strong-start-rvol-dashboard (no-output).
## RT4 - the shared clock table tells the truth, drawings go with their run, and the walls behind the walls (2026-10-02, step 68)

Branch `pine/rt4-runtime-truth`, base `integrate/wave15-2026-10-02` (`7008853902`). Runtime pane still
behind `VITE_PINE_RUNTIME_PANE_ENABLED` (OFF). Measurements: member-door census (all three states),
runtime corpus census, the vendor harness over the committed dir and the 47, each pane off / on /
on + runtime, before and after every commit; numbers read from each run's `census.json` /
`verdicts.json`.

### 1. RULED: the shared clock table declares the right edge (`3a77b89423`)

`closedTable.json::clock` now carries `forward: 1` on `islast` and `islastconfirmedhistory` and
`forward: "unbounded"` on `lastbarindex`, `lastbartime` and the five `lastbar*` date parts, edited
as text (one note, `_clock_right_edge`, classified DROP in `manifestProse.js`). The reaches are the
ones `runtimeRepaintEdge.test.js` measures through `indicators.js::computeClock`; that rail now
derives the declaring set from the SHARED table and holds it to the measurement (stable control:
`isconfirmed`, `barindex`). Both linters (`lint.js`, `ast_lint.py`) name a clock leaf's forward
reach the way they name a call's. `runtimeRepaint.json::clockEdge` and its join are gone in JS and
Python; a rail proves that deleting the shared declaration leaves nothing answering 1.

| consumer | before | after | evidence |
|---|---|---|---|
| host badge (`lintRepaint`) on a tree reading a leaf | non-repainting | `islast`/`islastconfirmedhistory` preview-repaints; the seven broadcasts repaints | `runtimeRepaintEdge.test.js` (RT4 block) |
| `canSaveFormula` | saves | `islast` needs the acknowledgement; `lastbarindex - barindex < 10` refused even acknowledged; `isconfirmed` saves (control) | same file |
| alert repaint gate (`_gate_repaint`), fresh save | admitted | `islast` refused without an ack; `lastbarindex` refused | `tests/test_user_definition_relint.py::test_RT4_...` |
| relint pass, rows saved before | - | stored `non-repainting` vs current preview-repaints / repaints: reported as direction B (STORED_LOOSER), never flipped; a stable-leaf row produces no finding | same test |
| corpus host translation | - | 0 output trees of the 266 read any of the nine leaves (they are read in object programs only: max-pain, price-action-fibonacci, tradingview-alerts-to-mt4), so 0 host badges moved | lane badge census, base vs after identical |
| member-door census off / on / on + runtime | 52 / 75 / 78 | 52 / 75 / 78, 0 rows changed | census.json |
| harness dir and the 47, all three states | - | 0 entries changed | verdicts.json |
| runtime corpus census, runtime repaint corpus fixture | - | identical (the reaches did not change, only their authority) | runtimeCorpusCensus log; `runtimeRepaint.test.js` |

Not measured: how many definitions saved in production read these leaves (the relint pass names
them when run; it was not run against production).

### 2. RULED: a runtime document's drawings go with its run (`169eae248a`)

`nativeRegistry.runtimeObjectsWithheld(def, cols)` is the one gate: a `compute.kind: 'runtime'`
document carrying an object program whose run produced none of its columns on this chart
(history-start, time budget, request, a reached `runtime.error`, or in flight) draws none of it,
named `runtime:objects-without-run` with the run's own guard. The binder records what step 1
computed per instance and clears the object layer; the harness asks the same function.

Harness dir, pane on + runtime: `vw-int-array-avg` and `vw-int-array-avg-neg` overall DIVERGE ->
INCONCLUSIVE, objects row DIVERGE -> INCONCLUSIVE ("withheld by name (runtime:objects-without-run)
... (runtime:history-start)"). DIVERGE 32 -> 30, INCONCLUSIVE 53 -> 55, 0 other entries; the 47
and the other states unchanged; census 0 rows. Neither became MATCH: the capture does not start at
the listing, so the run computes nothing and nothing is drawn. Control (railed): the same document
over the same bars with the listing fact stated computes its columns and draws its labels, through
the registry gate and through the real binder.

### 3. The runtime walls: measured, none loosened (`3157905b21`)

`rt4WallsBehind.measure.test.js` (opt-in `RT4_WALLS=1`) rewrites each wall's construct in memory to
the nearest spelling the lanes hold and runs the real member door: **0 of 23 attach**.

| wall (count on this census, runtime state) | next wall after the rewrite |
|---|---|
| `runtime:varip` (3) | function-global-state; install door (vwap lookback 1210 > 960); runtime:colour |
| `pine:input-kind` (6) | pine:function (`timestamp`); pine:builtin (`chart.right_visible_bar_time`); runtime:statement; function-global-state; runtime:function; runtime:array |
| `pine:builtin` (11) | request-with-state; block-value; pine:function (`time_close` with 2 args); text-value x2; a second builtin x3 (`str.tostring`, `chart.right_visible_bar_time`); pine:type |
| `runtime:history-expression` (4) | pine:request (logistic-regression's `security('', reso, ...)`); function-global-state (strong-start); the other two read `request.security` of other symbols |
| `runtime:request` (3) | unchanged, below |

`runtime:request`: the brief asked to hand the run the bars the host lane serves (C26 other symbols
from committed captures, C41 weekly/monthly from daily). None of the three is in that set:
`4c-nyse-market-breadth-ratio` reads `USI:UVOL` / `USI:DVOL` / `USI:ADD` ... (no `symbolScope.json`
row; the host refuses it `pine:request`), `multi-timeframe-trend-indicator` passes the timeframe as
a function parameter, `tehthomas-aligned-timeframe-fair-value-gaps` computes it
(`getAlignedTimeframe()`) and asks `lookahead_on` (and is drawing-only, O1's lane). The decline
stays: plumbing with no corpus script or capture to grade it would be an ungraded path.

`varip` was not admitted although Pine runs it as `var` on historical bars: 0 of 3 would attach, and
on the forming bar it differs by tick count, which this lane cannot reproduce.

### Rails and mutations

`runtime/__tests__/runtimeRepaintEdge.test.js` (11), `runtimeRepaint.test.js`, `ast/lint.test.js`,
`closedTable.test.js`, `manifestFormatting.test.js`, `manifestProse.test.js`;
`tests/test_ast_clock_parity.py`, `tests/test_ast_lint.py`, `tests/test_runtime_repaint.py`,
`tests/test_user_definition_relint.py` (RT4 case); `vendorHarness.rt4ObjectsWithRun.test.js` (8).
Mutations, each red on its own, bytes restored and sha verified: `islast`'s `forward` deleted (JS 11
red, Py 5 red); `lastbarminute` `unbounded` -> 1 (2); JS linter's clock reason removed (1); runtime
`clockLeafReach` -> 0 (8); Python clock reason removed (2); Python `clock_leaf_reach` -> 0 (6);
binder gate removed (1); harness gate removed (2); gate always null (4); computed-columns check
removed (2).

Open: a definition stored before `3a77b89423` that reads one of the nine leaves stays admitted under
its old badge until direction B is decided for it (the relint pass names it). `pine:builtin` reads
11 on this census, not RT2's 8 (counted off `runtimeDeclined.code`, runtime state).
## H2 - the host translator's next three walls: a comma line of statements, and what the rest needs (2026-10-02, step 69)

Lane H2 of the "import any TradingView Pine script" program, branch `pine/h2-host-state`, base
`integrate/wave15-2026-10-02` (`7008853902`). Goal metric: the member-door census over the 266 committed scripts.

### The walls, by shape (first refusal per script at base, objects pane on)

Census at base (`memberDoorCensus.measure.test.js`, `VENDOR_BATCH_CENSUS_RUNTIME=1`): off 52 / on 75 / on + runtime
78 of 266. The three walls hold **15 + 11 + 11 = 37** scripts. The exact construct below is read off each refusal's
own locator (`translatePine(...).refusals[].line`), not from the message, which for `pine:state` is generic.

| wall | shape | scripts (construct, line) | owner / outcome |
|---|---|---|---|
| `pine:reassign` | **R-a** a comma line `x = na , x := ...` inside a helper | 3-level-zigzag-semafor (`int _direction = na , _direction := switch`, 18, through `zigzag`); pa-zigzag-fibonacci-fan (`int _dir = na , _dir := ... nz(_dir[1])`, 16) | **served, commit 1** (`commaStatementSplit`) |
| `pine:reassign` | **R-b** a name written by a running total in a counted `for` | machine-learning-moving-average-backquant (`currentCluster`, 138); moving-averages-as-support-resistance-mtf (`min_higher := array.get(...)`, 51); order-block-finder (`upcandles`, 47) | ruling R7 (loop totals belong to the runtime lane); not this lane |
| `pine:reassign` | **R-c** a name written in a block after a `for` the fold steps over | delta-imbalance-map-joat (`newBullZone`, 209; `for`@173); smart-money-volume-activity-algoalpha (`retailBullBar`, 128; `for`@105); smt-divergence-ict-killzones (`alert_bear`, 346; `for`@329); supply-demand-mtf-flux-charts (`renderBreakLabelBuyside`, 447; `for`@431); support-and-resistance-logistic-regression-flux-charts (`_supportRetestDetected`, 236; `for`@233); volatility-coil-edge-bullbyte (`isContracted := isContracted or ...`, 382; `for`@378) | R7 / the loop's writes are the runtime lane's (C31 `loopWriteRefusal`); not this lane |
| `pine:reassign` | **R-d** `varip` state with dynamic `[barIndex]` reads | bolingger-bands-inside-bar-boxes (`IBStatus := true`, 129; stopped at 98); inside-bar-boxes (`f := true`, 56; stopped at 34) | `varip` + `high[barIndex]` with a stateful index; refused (no exact shape) |
| `pine:reassign` | **R-e** a UDT field written in a block | ict-turtle-soup-flux-charts (`sellAlertTick`, 176; stopped at `newTS.lastHourHigh`) | UDTs are H3's (`pine:type`); not this lane |
| `pine:reassign` | **R-f** a tuple part reassigned through its own history | williams-fractal-trailing-stops (`isWilliamsHigh := isWilliamsHigh[1] ? false : isWilliamsHigh`, 59-62) | open (one script; its next wall is `var bool _flipShortNow` in `f_flip`, 122) |
| `pine:state` | **S-a** a recurrence with no window (an IIR or a deadband) | adx-and-di-for-v4 (Wilder `x := nz(x[1]) - nz(x[1])/len + dm`, 19/22); smoothed-gaussian-trend-filter-algoalpha (`runningFilterValue` poles, 34); deadband-hysteresis-filter-backquant (`dbhf += response * (...)`, 48) | never exact from an unknown start; the runtime lane draws adx from the listing; refused here |
| `pine:state` | **S-b** a counter whose reset test compares the state with a CONSTANT | fvg-trend (`if fvgCounter < 0 / fvgCounter := 0`, 14-25); trend-targets-algoalpha (`rejcount += 1` / `rejcount > 0` reset, 60-66) | H1 refused the constant on purpose (`switchedCounter.test.js`); see below |
| `pine:state` | **S-c** coupled flags and latches across several `var`s | inside-bar-range-mother-candle-breakoutbreakdown (`breakoutOccurred`/`breakdownOccurred`, 44-45); wyckoff-accumulation-distribution (`scBarIndex`, 87; latch-once `is*Flag`); smc-structures-and-multi-timeframe-fvg-ma-py (`structureLow`, 554) | latch-once never forgets (C12); the runtime lane draws two from the listing; refused here |
| `pine:state` | **S-d** a comma line of `:=` inside an `if` (a two-slot shift register) | auto-trendline-dojiemoji (`recent_dn2:=recent_dn1, i_recent_dn2 := i_recent_dn1`, 119/124) | **served, commit 1** (same split as R-a) |
| `pine:state` | **S-e** `varip` | ema-92150-vwap-macd-rsi-pro-v6 (`varip vwap_value = ta.vwap(hlc3)`, 41) | intrabar persistence; refused by name in both lanes |
| `pine:state` | **S-f** a stop's own previous value inside an `if` | neural-network-buy-and-sell-signals (`buy_signal_shortStopPrev = nz(buy_signal_shortStop[1], ...)`, 645/683) | block-local stop (H1's last shape); refused |
| `pine:block` | **B-a** a counted `for` in a helper, summing over a window | atr-stepped-pdf-ma-loxx (`_pdfma`, 36); kalman-price-filter-backquant (`f_kalman`, 36); kernel-channel-backquant (`kernelMu`, 59); nadaraya-watson-rational-quadratic-kernel-non-repainting (`kernel_regression`, 24); nonlinear-regression-zero-lag-moving-average-loxx (`nonLinearRegression`, 41); one-sided-gaussian-support-resistance-rate-loxx (`_smthMA`, `matrix`, 70); trend-line-harrybot (`care`, 34); volume-divergence-by-mm (`pine_wma`, 10) | ruling R7: numeric accumulators in a counted `for` are the runtime lane's; not this lane |
| `pine:block` | **B-b** a `for` over a drawing array in a helper | liquidity-levels-sonarlab (`remove_mitigated_lines`, 96) | object lane (O1); not this lane |
| `pine:block` | **B-c** a block-valued REASSIGNMENT `x := if ...` | sessions (`londonLow := if londonSession`, 41, x8) | open; its next wall is the session clock on a daily chart |
| `pine:block` | **B-d** `float maOut = switch maType` in a helper of a strategy | atr-god-strategy-by-tradesmart (`switch_ma`, 205); its first refusal is `pine:declaration-strategy` (6) | R1's strategy door first |

So of 37, the host translator's own reassign/state/block handling owns **R-a, R-f, S-b, S-d, B-c** (7 scripts); the
other 30 are rulings or other lanes (R7 x 17, UDT, objects, `varip`, latches, IIRs).

### Served (steps 1-2), and the evidence

1. **A comma line whose last segment opens a block** (`commaStatementSplit`, `pine.js`): every segment a binding or a bare-name
   mutation, a block opener only in the LAST segment, which then owns the body. Pine runs comma-separated statements left to
   right, so the split is the language's definition. Built before O1's G8 landed; on the merge O1's `isReassignSegment` takes
   the no-block case (it runs first) and H2 keeps only the block case. Rail `ast/h2CommaStatements.test.js` (the comma form
   translates byte-equal to the separate lines). Mutations (pre-merge): split disabled 8 red, segments reversed 6 red, body on
   the first segment 1 red, continuation guard dropped 1 red.
2. **A block-valued reassignment** `x := if ...` / subject-less `x := switch`, at the top level and in a helper. `if` folds
   through `foldIfChain` (the `x = if` reader); the switch becomes `nz(c1) ? v1 : nz(c2) ? v2 : d` - first true arm wins, a
   bare `=>` is the last else, no bare arm yields `na`, and a condition that is not a comparison is read through `nz` because
   Pine treats an `na` condition as false while this engine's `?:` answers `na`. A subject switch in `:=`, an arm with a
   block, a bare arm not last, and `+=` keep their refusal. Rail `ast/h2BlockReassign.test.js` (each form equals its
   written-out ternary, trees compared whole). Mutations M1-M7 (each half off, `nz` reading dropped, bare arm anywhere,
   no-default yields the last value) each red.

Graded on real bars (`vendorHarness.h2CommaStatements`, RDDT 1D, 631 listing bars; no TradingView capture of any of these
scripts exists): pa-zigzag-fibonacci-fan's 9 plots equal the runtime lane (`computeRuntimeColumns`) bar for bar, drawn and
withheld alike; auto-trendline-dojiemoji equals a hand replay of the script (H1's TradingView pivot tie rule), as published and
with every marker switched on, no replay mark withheld; 3-level-zigzag-semafor's `zigzag()` verbatim (its zigzag and its
`_direction` state) equals the runtime lane on every drawn bar and withholds nothing it draws.

### Measured

| | O1 tip `633b9a7c54` (pine.js swapped in) | H2 tip (merge) |
|---|---|---|
| member door off / on / on + runtime | 54 / 79 / 82 | 54 / 79 / 82 (0 attach change, 0 lost) |
| rows changed | - | 2 per state: 3-level-zigzag-semafor `pine:reassign` -> `pine:function`, sessions `pine:block` -> `pine:function` |
| vendor harness, all 171 (on / off / runtime MATCH) | 60 / 47 / 61 | identical, 0 entries change |
| harness dir 138 (on / off / runtime MATCH) | 52 / 39 / 53 | identical, 0 entries change |
| translation census host / screener | 75 / 65 | 75 / 66 (3-level-zigzag on the screener) |

Before O1 merged (base `7008853902`): 52 / 75 / 78 -> 54 / 77 / 80, with pa-zigzag-fibonacci-fan and auto-trendline-dojiemoji
attaching through step 1 - the same two O1's G8 attaches, so on the merge they count once, as O1's.

### Next walls of the scripts H2 moved

- 3-level-zigzag-semafor: `time(tf)` of a LOWER timeframe (`ta.change(time(tf2))`, lines 35-36) and `request.security`
  with `lookahead_on` - the clock / lower-timeframe lanes.
- sessions: `time(timeframe.period, sess)` with a session wrapping midnight on a daily chart - the clock lane.

### Open, for the integrator

- **S-b, a counter reset by a CONSTANT threshold** (fvg-trend, trend-targets-algoalpha). H1's `forgetsOnReset` refuses a
  constant on purpose, and admitting it is not enough on its own: trend-targets' `rejcount > 0` reset never collapses the
  range (the domain does not know the counter is >= 0), so it would be admitted and withheld on every bar. fvg-trend's sign
  reset does collapse after the first opposite gap. Not loosened without a capture; a probe that grades a sign-reset counter
  would settle it.
- **R-f, a tuple part read through its own history** (williams-fractal-trailing-stops): one script, and its next wall is a
  latch in `f_flip` (S-c). Not built.
## H3 - the host translator's language-feature walls at the member door, by construct (2026-10-02, step 70)

Lane H3, branch `pine/h3-host-collections`, base `integrate/wave15-2026-10-02` (`7008853902`). Codes in scope:
`pine:collection`, `function`, `tuple`, `function-def`, `type`, `arity`, `builtin`, `na`, `window`, `text-value`,
`input-kind`, `cycle`. H2 owns `pine:reassign` / `state` / `block`; O1 owns `pine:no-output`; RT3/RT4 own the runtime lane.

### Census at base (member door, `memberDoorCensus.measure.test.js`, objects flag on, runtime state measured)

Attach: off **52** / on **75** / on + runtime **78** of 266. First refusal at an H3 code: **47** scripts
(collection 9, function 9, tuple 6, function-def 4, type 4, arity 3, builtin 3, na 2, window 2, text-value 2,
input-kind 2, cycle 1). The census records only the FIRST refusal; every refusal of each script was then read off
`translatePine` (same options as the door) and each candidate fix was tried as a source rewrite through
`enterMemberDoor` to find the NEXT wall before building anything (scratch harness, not committed).

### The constructs, grouped by shape (first refusal; `RT` = the runtime lane's `runtimeDeclined.code` for that script)

| shape | scripts (first refusal) | construct named | RT declines at | owner |
|---|---|---|---|---|
| an array mutated in a block / function / loop, or read where nothing creates it | double-topbottom-ultimate-os, elliot-wave-detector-pro, fibonacci-dolphintradebot, machine-learning-knn-based-strategy, market-structure-break-order-block, range-filter-bs-signals, range-filter-dw, renko-candles-overlay | `array.unshift/push/shift` at the named line; `rfilt` read with no creator | directive, pine:builtin, na-test, pine:input-kind, function-global-state, history-dynamic-offset, runtime:array, pine:builtin | RUNTIME lane: the columnar host lane cannot hold slots that change per bar under a condition |
| a sorted-array percentile | bollinger-band-width-percentile | `array.binary_search_rightmost` | runtime:statement | RUNTIME lane |
| a user-defined type's field / method | candelacharts-equal-highslows-eqheql, support-resistance-mtf-flux-charts, volatility-trend-score-backquant, volume-delta-hapharmonic | `bull_alert.ehl`, `alerts.get`, `c.score`, `ohlcv.V` | runtime:loop, runtime:array, history-dynamic-offset, pine:builtin | RUNTIME lane (UDT objects mutated per bar); 12 scripts in all carry a UDT refusal |
| `[a, b] = helper(...)` where the HELPER was refused | anchored-vwap-pinch-handoff, delta-rsi-oscillator-strategy, linear-regression-channel-200, linear-regression-channel, volume-profile-bar-magnified-order-blocks | the sentence said "no tuple form for `calculateRegression`"; the real wall is the helper's own (a `for` running total, ruling R7) | call-windowed-state, history-dynamic-offset, runtime:function, pine:colour-value, pine:request | sentence: H3; the wall: H2 / R7 |
| `ta.vwap(src, anchor, k)` tuple with bands | volume-suite-by-leviathan | `[vwap, up, dn] = ta.vwap(hlc3, timeframe.change(len5), vwapstd)` (+ `request.security_lower_tf` tuples) | call-windowed-state | refused (computed anchor, lower timeframe) |
| a helper ending in `x := f(nz(x[1]))` | blackflag-fts, boom-hunter-entry-point, macd-with-filter-visual-backtest, optimized-trend-tracker | `Wild_ma`, `eot_func`, `smooth`, `Var_Func` "end in no value" | pine:arity, pine:statement, function-global-state, history-dynamic-offset | read as a value it is a zero-seeded IIR recurrence = `pine:state` (H2 / R-W) |
| `time(tf)` / `time(tf, session)` | chart-champions-part-1, initial-balance-ib, session-highs-and-lows-smc, smart-money-concepts-by-welotrades, zigzag-ma-pattern-recognition | session strings, computed timeframes | call-undeclared-builtin-state, runtime:statement, pine:input-kind, pine:function | the clock lane (C49) |
| one-argument `ta.barssince` (unbounded) | momentum-based-zigzag | `ta.barssince(QQExlong == 1)` | call-undeclared-builtin-state | refused: the count before the first true in the loaded bars is the listing's (R-W) |
| `ta.alma` | highlow-channel-swing | `alma(high, length_ma, 0.85, 6)` | pine:function | H3: a pure window function |
| `ta.nvi` | smart-money-interest-index, smart-money-volume-index | ruled (cumulative from the first bar) | pine:function | stays refused |
| `vwap(src)`, src not `hlc3` | cpr-with-mas-super-trend-vwap, rsi-vwap-indicator | `vwap(close)` | pine:arity | H3 |
| 1-arg `barssince` in v4 | inside-bar-strategy-w-sl | `barssince(cond)` | pine:collection | as momentum-based-zigzag |
| built-ins not held | liquidity-engulfing-displacement-msf, multiple-mtf-moving-average-xdecow, smarter-snr | `barstate.isnew` (ruled), `timeframe.in_seconds`, `str.length` | lower-tf:store-unmeasured, request-with-state, pine:builtin | next walls: `pine:request` (xdecow), `pine:window` (smarter-snr) |
| `fixnan` | breaks-and-retests-hg, support-and-resistance | `fixnan(x)` | expression-statement, function-global-state | H3 |
| a non-integer / per-bar length | relative-volume, trend-levels-chartprime | `wma(src, length/2)` (ruled: floor vs round), `ta.highest(bars)` with `bars` a counter | pine:window, pine:function | stays refused |
| text feature | relative-volume-at-time, renderingnature-smc-reversal-engine | label text | input-state, pine:input-kind | O1 / text lane |
| `input.time` | open-interest-profile-fixed-range, session-hilo | `input.time(defval = timestamp(...))` | pine:input-kind, runtime:statement | H3 candidate (param ids) |
| `pine:cycle` on a helper whose body is a `switch` / `if`, called with an argument that goes through the same helper | heikin-ashi-true-strength-index-and-ott-erebor | `ma1(ma1(x, ...), ...)` read as "`ma1` is defined in terms of itself" | runtime:presentation | H3: a FALSE refusal |

Source-rewrite trials (each construct replaced by a translatable stand-in, the rest of the script untouched):
`vwap(src)` -> cpr ATTACHES, rsi-vwap stops at the 960-bar budget (`rsi` around a session `vwap`), camarilla at
`pine:request`; `alma` -> highlow-channel-swing ATTACHES, relative-volume still stops at its `length/2` ruling;
`fixnan` -> support-and-resistance ATTACHES, blackflag and breaks-and-retests stop at their helpers; `input.time` ->
session-hilo ATTACHES, open-interest-profile stops at `chart.right_visible_bar_time`; `timeframe.in_seconds` ->
xdecow stops at `pine:request`; `str.length` -> smarter-snr stops at `pine:window`.

### What H3 served, refused and routed (2026-10-02, after the O1 merge `633b9a7c54`)

| commit | construct | outcome | evidence |
|---|---|---|---|
| `d0a85007e0` | a helper whose body is a `switch` / valued `if`, called again through its own argument (`ma1(ma1(x, 25, t), 13, t)`) | the false `pine:cycle` is gone: each call resolves its body on its own cycle stack; a helper calling itself is still `pine:cycle` (`MAX_CALL_DEPTH`) | `ast/pineH3HelperCycle.test.js` (11; the reference is the ternary-bodied helper, which always took the direct path). heikin-ashi-tsi-ott-erebor's first wall moves `pine:cycle` -> `pine:state` (H2's). COST, measured: that script's strict translation went 0.4 s (to the false refusal) -> ~2.5-3 s alone, 32,708 `ma1` and 13,264 `double_smooth` inlinings (substitution re-resolves the nested 14-arm helper per reference). The translation census runs at a 2,000 ms budget, so that one row now reads `pine:timeout` on a loaded box and not on a quiet one; the committed `corpus_metric.json` row was left as first measured. Revert is the single commit |
| `f97cbdb76c` | `ta.vwap(source)` / v4 `vwap(source)` for a bar price (`open/high/low/close/hl2/ohlc4/hlcc4`) | served as `vwapOf(source)`: the SAME accumulator as `vwap()` (`computeVWAP` / `compute_vwap_raw` take an optional price column), so the two cannot disagree on a session boundary; a non-finite price blanks the rest of its session. A computed source (`ta.vwap(ta.sma(close, 5))`, `close * 2`, `volume`) keeps `pine:arity`, now saying the `na`-term behaviour is unmeasured | graded bar for bar on `vw-clock-vwap-spy-5-ext-2026-09-28`: TradingView's `ta.vwap(close)` = V08 + V09, 191 bars of the full session after the leading partial one, worst difference < 1e-6, both lanes (`vendorHarness.h3VwapSource.test.js` 9, `tests/test_ast_vwap_of.py` 4), plus the control that our `vwap()` = V09 on the same bars; conformance case `vwap_of_close_session` (both lanes, 579 bars, across the Friday 20:00 ET = 00:00 UTC print). Manifest +1 function (78 -> 79); count rails, sentence grammar, `GRAMMAR.md`, `lookback_agreement.json` moved with it. Pine semantics, stated as such: `ta.vwap(src)` is `sum(src*volume)/sum(volume)` since the session anchor. 7 mutations, each red |
| `14630ec3f4` | `[a, b] = helper(...)` where the helper was refused | the sentence names the helper's own wall instead of "no tuple form for `helper` - the ones it can take apart are ta.bb ..."; the guard stays `pine:tuple` | `ast/pineH3TupleOpaque.test.js` (3, two controls); mutation red |

**Refused, by decision:**

- **`alma`** (highlow-channel-swing would attach with it, relative-volume would not): `r11-alma-spy-2026-09-11` read
  a COMPILE FAILURE for bare `alma`, and the rail `refusalsThatMeanOppositeThings` pins that refusal "correct
  forever". That probe was `//@version=6`; both corpus sites are `//@version=4`, where the v4 manual lists
  `alma(series, length, offset, sigma)`. The ruling's evidence does not reach v4, but nothing committed says what
  v4 `alma` computes either, so it stays refused. Q-H3c (`h3-alma-v4.pine`) settles it.
- **`fixnan`** (support-and-resistance would attach with it): it is exact after the first non-`na` value in the
  loaded bars and `na` before it, which is the warm-up bargain, but its lookback is unbounded and the existing
  ruling (`pine.js`, "state with no warm-up a member could state") is explicit. Left for an owner ruling.
- **`input.time`** (session-hilo would attach with it): retired by measurement (R15/R16, "6 reach a column, under the
  threshold"), and Pine's `time` is milliseconds where this engine's is seconds (`PINE_CLOCK_MISMATCH`).
- **Helpers ending in `x := f(nz(x[1]))`** (blackflag-fts, boom-hunter, macd-with-filter, optimized-trend-tracker):
  read as values they are zero-seeded IIR recurrences, i.e. `pine:state` (H2 / R-W). The "ends in no value" sentence is
  left as it is.

**Routed to the runtime lane** (the columnar lane cannot hold slots that change per bar under a condition, nor an
object whose fields are mutated per bar): arrays mutated in a block / function / loop (8 scripts) and the
sorted-array percentile (bollinger-band-width-percentile); user-defined types (4 first walls, 12 scripts carry one).
The runtime lane declines each of them today, at its own walls (table above, `RT` column, from the census'
`runtimeDeclined`): `runtime:array` 2, `history-dynamic-offset` 3, `function-global-state` 1, `runtime:loop` 1,
`runtime:directive` 1, `runtime:statement` 1, `na-test` 1, and `pine:builtin` / `pine:input-kind` 4. Those are RT3/RT4's.

### Measured (base = the O1 merge `633b9a7c54` / tip `14630ec3f4` + this doc)

| | base | tip |
|---|---|---|
| member door off / on / on + runtime | 54 / 79 / 82 | **55 / 80 / 83**: + `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri`; 0 previously attached lost |
| first refusal moved without attaching | - | heikin-ashi-tsi-ott-erebor `pine:cycle` -> `pine:state`; rsi-vwap-indicator `pine:arity` -> the install door's `compute.budget` (976 > 960: an `rsi` around a session `vwapOf`); 9 rows change text in all |
| translation census host / screener ok | 75 / 65 | 77 / 65 |
| harness (all captures, 171), pane off / on / on + runtime | MATCH 47 / 60 / 61 | MATCH 47 / 60 / 61; **0 MATCH -> DIVERGE** |
| harness entries that moved | - | `vw-clock-vwap-spy-5-ext-2026-09-28` INCONCLUSIVE -> INCONCLUSIVE (the script now attaches: V01-V06, V11-V14 MATCH on 300 bars; the four vwap rows sit in the session warm-up, inconclusive); `vw-clock-vwap-spy-1d-2026-09-27` INCONCLUSIVE -> **DIVERGE** on V07-V10 only: on the harness's 1D bars `t` is a date key, `computeVWAP`'s unit gate refuses it, and every vwap row is `na` where TradingView draws (each daily bar its own session, so V10 = hlc3). That is the pre-existing behaviour of the bare `vwap()` on a daily chart, reached now because the script attaches; no value is drawn wrong, the rows are blank. Owner/integrator question below |

Focused runs (scratch logs under the lane's `h3lane/`): `ast/pine*` + `corpusMetric` on the tip, 118 files, Tests 2 failed | 1456 passed - `pineProbeReplay` (step hashes for 72s-hull / adaptive-trend) and `pineTimeAnchorAccept` (pa-zigzag's message), **both red identically on the O1 base bytes**. After the last commit, the rails this lane edited: 6 vitest files (formulaDocs, pineBareArityShortFormAccept, parse,
sentence, pine.derived, h3VwapSource) Tests 195 passed (195); pytest test_ast_interpret / _vwap_parity / _conformance / _scalars / _vwap_of 346 passed, 5 skipped. Wider runs were taken BEFORE the count rails were updated, so they are not tip measurements: `ast/ runtime/ builder/` 506 files, Tests 8 failed | 7513 passed (the stale count rails, `pineStrictCensus`'s wall-clock timeout, four opt-in `*.measure.test.js` red on the base bytes too); a 36-file pytest set 10 failed | 1003 passed (`test_concept_vocabulary`, `test_definition_concierge`, `test_starter_library`, the same 10 on the base bytes). `paramIds.test.js` green, no edit.

### Questions for the integrator

1. **A daily-chart `ta.vwap`.** TradingView draws a daily vwap as each bar's own price (one session per bar); the
   harness's daily bars carry a date key, so `computeVWAP` refuses them and every vwap row on a daily chart is blank.
   Serving it would mean the accumulator accepting a date-keyed bar as its own session; Q-H3a (`h3-vwap-source` on
   SPY 1D) would grade it.
2. **The nested-helper cost** (first row above): keep the correct `pine:state` at ~3 s of translation for that one
   script, or revert `d0a85007e0` and keep the fast, wrongly worded `pine:cycle`.
3. **`alma` in v4** and **`fixnan`**: rulings, with Q-H3c queued for the first.

## CAP - capture round 4 (2026-10-02)

Lane CAP, branch `pine/cap-captures` (merged into `integrate/wave16-2026-10-02` at `304a6ec692`). 64
TradingView captures for the wave-15 queues under `tests/fixtures/vendor/harness/*-2026-10-02.json`, each
read with `tv_capture.js` and assembled by `verify_capture.mjs` (PASS), graded in
`vendorHarness.capRound4.test.js`, `vendorHarness.rt1NaTest.test.js` and
`vendorHarness.supertrendKivanc.test.js`; known divergences are `it.fails`.

What TradingView answered:

| queue | fact |
|---|---|
| Q-NA | a `?:` whose test is `na` takes the ELSE branch, for every test shape and version (v4, v5, v6), incl. `x[1]` before bar 0 and `bool b = na`; v6 refuses `bool b = na` at compile time |
| Q-O1c | `sens = input.int(28)` `sens /= 100` is 0.28 (an input int keeps the fraction); `a = 28` `a /= 100`, `28 / 100` and `c := c / 100` are 0 (a `const int` quotient truncates) |
| Q-H1 | SuperTrend: 6 rows MATCH from the listing; ratchet SPY R01-R04, R06, R07 MATCH, R05 converges by bar 446 |
| Q-L1 | a library export is the same function written inline |
| Q-S1 | a strategy's plots equal its indicator twin on 635 bars |
| Q-B1 | the LATER `barcolor` wins; `offset` / `show_last` are render-time only (the per-bar record sits on the unshifted bar); a v4 `bgcolor` with no `transp` takes transparency 90 (screenshot `docs/pine/vendor-harness/cap-round4/vw-bgcolor-barcolor-spy-1d-2026-10-02.png`) |
| bar origin | `bar_index` on SPY 1D with 300 bars loaded starts at 8177 (the true bar 0); intraday RDDT 5 starts at 0 on the first LOADED bar |
| clock | `time("W")` at RDDT listing bars 0/1 is calendar Monday 09:30 |
| arrays | `min` / `max` / `sum` / `avg` skip `na`; `indexof` / `includes(na)` are -1 / false; `get(a, -1)` is the last element |
| gradient | equal or `na` bounds give r = g = b = 0, t = 100 |
| mintick | ETFs and preferreds 0.01, warrants 0.0001 |

Not taken: Q-R2 / request-realtime (needs RTH), lower-timeframe row 9, rows 10-16.
## RT5 - the runtime lane draws its own objects (2026-10-02, step 72)

Branch `pine/rt5-runtime-objects` (from `pine/o1-drawing-only` `633b9a7c54`, merged with
`integrate/wave16-2026-10-02` `666ea1c854`). Dark: behind `VITE_PINE_RUNTIME_PANE_ENABLED`.

**What is served.** When `runtimeLaneDefinition` takes a document and the HOST object program
would draw nothing (absent, empty, or withheld for a lost removal), and the run builds WITH its
drawings (`buildRuntimeIr({objectsInRun})`, lowering at least one drawing op), the document is
minted `compute.objects: true` and its objects come from the SAME run that computes its columns
(RT4's ruling holds by construction: no run, no drawing). Families: line, label, box, table
(+cells), linefill. Withheld by name: polyline / `chart.point` (the chart has no polyline). The
store is `engine/runtime/objectStore.js` and reuses the host's measured rules: C7 collector
(above cap + 5, oldest go until cap, same-bar creations and variable-held objects spared, an
array/UDT-held object reached withholds the family), one table per position (newest wins), one
linefill per line pair and it dies with its lines, bar coordinates truncated toward zero (C48),
`na` colour `#00000000`, per-version capacities. `str.tostring` is served in the run for the
literal `#`/`0` formats only (`objectRuntime.formatNumber`, lifted, unchanged). A drawing-only
document carries a hidden anchor row; the server accepts `objects: true` with no outputs.

**Refused by name (drawing build only, so nothing that already attached can move):**
* `runtime:conditional-history` - a `ta.*` call, a block local's `[k]`, a parameter's or body
  local's `[k]`, or `bar_index[k]` inside a function body, read inside a block or call that does
  not run on every bar. Witnessed: `vw-call-site-history-*` (C01-C05, D01/D02 diverge from the
  every-bar plots; A13/C06 `bar_index[k]` and A14 `volume[5]` are the chart's) and
  `vw-fn-series-history` (S02 `bar_index[k]` NaN in a function, S01/S03-S07 the chart's, C01/C02
  NaN). The chart's own series (`open..ohlc4`, `hlcc4`, `time`, `time_close`) and arithmetic over
  them keep the chart's history anywhere; `bar_index[k]` keeps it in a global block. A function
  is judged at its call site (its body is compiled at depth 0). A TOP-LEVEL binding that carries
  history is a slot evaluated on every bar, never a macro a block expands (and so evaluates)
  only when it runs - this is what keeps `atr-support-and-resistance` and `trendlines` building.
* `runtime:object-op` "a drawing call inside one arm of `?:`" - this lane evaluates both arms
  every bar (`liquidity-pools`: 502 labels against TradingView's 91 before the refusal). The
  host lane's G7 equivalence (O1) would serve it as `if`; Q-RT5a asks the vendor first.

**Measured** (`rt5RuntimeObjects.measure.test.js`, `RT5_MEASURE=1`, 67 captures with object
records; direct = the drawing build run on the capture's own bars, counts per family + label
texts as a multiset):
* 19 build; **17 agree** on every family count (and label texts where recorded): the six
  `vw-object-gc-{a,b,c}` 1D/1W (the collector, id for id), `vw-int-array-avg(-neg)`,
  `vw-tf-period` 1D/1W/1M, `options-max-pain-calculator-backquant` (tables + cells),
  `fibonacci-pivot-points-cc`, `ultimate-pivot-points`, `contraction-box-doji-lines`,
  `makuchaku039s-trade-tools-fair-value-gaps`, `atr-support-and-resistance`, `trendlines`.
* 2 not comparable: `vw-runtime-error-spy-1d` (54 vs 50 labels, texts `2100..` vs `6000..`): the
  capture's bars do not start at the listing (bar_index 0 here is TradingView's ~3,700), so the
  collector's phase and the printed `bar_index` differ - the door refuses that history (R-W).
* Refused by name instead of drawing wrong: `liquidity-pools` (`?:` arm), the three
  `vw-call-site` / `vw-fn-series` captures (`runtime:conditional-history`).
* Door verdicts in the runtime state: identical before/after (MATCH 40, DIVERGE 20,
  INCONCLUSIVE 2, none 5); every capture's objects still come from the host lane, because every
  capture's host program draws.
* Timing (direct run, objects included): 8,473 bars 336-350 ms (gc probes), 4,800 bars 532 ms,
  632 bars <= 557 ms.

**Census** (`memberDoorCensus.measure.test.js`, `VENDOR_BATCH_CENSUS_RUNTIME=1`, 266 files):
before off 54 / on 79 / runtime 82; after off 54 / on 79 / runtime 82 - **0 moved, 0 lost**.
Of the O1 drawing-only scripts, three now fail on a named runtime wall instead of the old
`runtime:object-op`: `trendlinesample` (`runtime:conditional-history`, `sup[1]` of a drawing
handle inside `if barstate.islast`), `trendline-pivots-quantvue` (`runtime:loop`, `for ... in`),
`order-blocks` (`runtime:na-test`). None of the corpus attaches through RT5 yet: the scripts it
would serve are walled first by the runtime lane's other walls (libraries, undeclared builtin
state, dynamic offsets, statements).

**Rails:** `runtime/__tests__/rt5RuntimeObjects.test.js` (15), `builder/memberPane/
runtimeObjectsDoor.test.js` (7), `tests/test_runtime_definitions.py` (22). Mutations, each
restored from captured bytes and sha-verified: guard off, top-level macro, `?:` arm drawing,
call-site function check, `bar_index` in a global block, chart-history set emptied, door host
check, door routing, collector at cap instead of cap + 5, server `objects` value, server empty
outputs - each turns its rail red. One guard was REMOVED on its mutation (a user-function
"folded into a column" check that left every rail green).

**Capture queue:** `capture-queue-2026-10-02-rt5-runtime-objects.md` (Q-RT5a,
`probes/vw-rt5-arm-draw-block-history.pine`): a drawing in a `?:` arm, and a block local's `[1]`.
**Wave 16 / CAP2 follow-up (2026-10-03).** Merged `integrate/wave16-2026-10-02` (`3f9c35aebd`).
* **Graded against CAP2's captures through the runtime door** (`vendorHarness.coverageAudit`,
  re-pinned): `fibonacci-dolphintradebot` RDDT is now **MATCH** - 7 lines + 7 labels against
  TradingView's 7 + 7, label texts agree, colours agree on 21 / 21 paired slots, both char plots
  MATCH (coordinates are not compared by v1). SPY: `runtime:history-start` (not from the listing),
  as its plots already were. `wyckoff-accumulation-distribution`: the run owns its 12 / 22 boxes
  and draws none, by name - RDDT stops on an engine error (`array.max of an empty array`, the same
  failure that already left its 8 plots without a column), SPY on `runtime:calc-bars-count`.
* What dolphin needed: a comma line of statements (`label.delete(a[1]), line.delete(b[1])`) is
  split by the host object lane's own rule (`objectFnInline.splitCommaStatements`, one authority);
  `math.round_to_mintick(x)` is `math.round(x / syminfo.mintick) * syminfo.mintick` (Pine: nearest
  tick, ties up, as `math.round`; the tick settled at bind).
* `runtime:calc-bars-count`: `calc_bars_count = N` makes TradingView run the script on its last N
  bars; no lane honours it, so a run that owns its drawings refuses them by name on a longer chart.
* A run whose drawings fail (a named wall, an engine error, `calc_bars_count`) keeps its PLOTS:
  the plain run computes the columns and the drawings are withheld by name
  (`runtimeObjectsWithheldOf`). A reached `runtime.error` and the time / history budgets are as before.
* **Census on the merged tree** (`--maxWorkers=1`): wave-16 baseline off 55 / on 80 / runtime 86;
  with RT5 off 55 / on 80 / **runtime 87**. **Lost: none. Gained: `renko-candles-overlay`**
  (runtime lane, drawings owned by the run: on 5,000 synthetic daily bars 2 lines, 2 labels,
  142 boxes; median **1,082 ms** of 5 runs on this loaded box, against the pane's 1,000 ms time
  budget, so a 5,000-bar chart may decline it by `runtime:time-budget`). It has no capture:
  Q-RT5b. Wall changes among the O1 scripts: trendlinesample -> `runtime:conditional-history`,
  trendline-pivots-quantvue -> `runtime:loop`, order-blocks -> `runtime:na-test`,
  auto-harmonic-patterns -> `pine:colour-value`, liquidity-levels-sonarlab -> `runtime:block-value`.
* **Bundle** (`vite build`, wave-16 base vs RT5): `runtimeWorker` 952,380 -> 982,658 B
  (+30,278; gzip 296,468 -> 306,604, +10,136); `runtimeAsync` 161,865 -> 188,675 (+26,810; gzip
  50,553 -> 59,499); `StockChart` 708,350 -> 709,352 (+1,002; gzip +388). Main `index` unchanged.
* **Rails:** `rt5RuntimeObjects.test.js` 15, `runtimeObjectsDoor.test.js` 7, `coverageAudit` 47 -
  69 / 69 at `--maxWorkers=1`. Further mutations, each red: calc-bars check off; `>` made `>=`;
  fallback catch rethrows; comma split off; `round_to_mintick` desugar off; tick dropped from it.
  The split was first restricted to lines whose every segment is a drawing call; removing the
  restriction left every rail green, so the host rule is used unrestricted and a mixed line is railed.

## F1 - the round-4 divergences: const-int division, `na` `?:` tests, paints, helpers called once, daily `ta.vwap`, and drawings TradingView kept from before the window (2026-10-02, step 73)

Lane F1, branch `pine/f1-capture-divergences` (from `integrate/wave16-2026-10-02` 304a6ec692, merged with
a66bae77b7 at 2cdef958e9, e3b87af31b at e51e2e71db and 820ed815c9 at d1b56850cf). Brief: every real DIVERGE CAP's 64 captures
exposed (section CAP), integer division first because it is in production; item 7 (daily `ta.vwap(src)`,
Q-H3a) added by the integrator. Correctness over coverage: what could not be made right is withheld by name.

### Fixed

| item | cause | fix | before -> after |
|---|---|---|---|
| **(1) integer division** (Q-O1c `vw-int-division-*`, D01-D05) | `/` between two `const int`s was always a float; TradingView truncates it before v6 (`a = 28; a /= 100` and `28 / 100` are 0) and keeps the fraction for an `input.int` (`sens /= 100` is 0.28) | host: `pine.js::pineConstIntValue` folds `/` over two const ints (literals, top-level `int` / untyped writes of const ints, never an input, a loop counter or a value reassigned under a block) to the truncated quotient, v1-v5 only (`constIntDivisionTruncates`); the runtime lane folds the same tree (`pineRuntimeFrontend.js`); Python mirrors the tree, so it needs no change | D02 / D03 / D05 DIVERGE -> agree (the capture stays INCONCLUSIVE only because its constant rows are hidden from the pane); D01 / D04 MATCH unchanged. Corpus outputs changed: `relative-volume` (a `const int` quotient in a window length) and the `pine:window` guard on `3-level-zigzag-semafor`, `relative-volume`, `renderingnature-smc` |
| **(4) Q-NA `?:` tests** (`rt1-na-test-v4/v5/v6`, A02 / A05) | from the listing a `?:` whose test is `na` takes the ELSE arm in every version CAP probed; the host lane's `TERNARY` carried `na` through | host: `interpret.js::PINE_TERNARY` under `pineTernaryFor(opts)` (from the listing and a v4+ document, `meta.naConditionFalse`, threaded by `nativeRegistry.listingOptsFor`); runtime already read the test as a condition (RT3) | rt1 v6 MATCH; v4 / v5 A02 / A05 agree (INCONCLUSIVE only for hidden constant rows); the `it.fails` in `rt1NaTest` removed. `and` / `or` / `not` (Q-NL) are F2's (`pine.js::naOperandReadAsFalse`): F1 had built the same rule in `interpret.js` and removed its copy at the e3b87af31b merge so the rule has one authority |
| **(5) paints** (Q-B1, `vw-bgcolor-barcolor-spy-1d`, `vw-bgcolor-v4-default-spy-1d`) | `offset` / `show_last` were withheld; a v4 `bgcolor` with no `transp` was withheld | a whole-number `offset` / `show_last` literal rides on the paint (`rec.offset` / `rec.showLast`, `defSchema` validates) and is applied at render time (`binder.js::paintRenderColours`), on both lanes (the runtime lane copies them onto its paint); a computed or `na` one stays withheld (`paint:offset` / `paint:show-last`); a v3/v4 `bgcolor` with no `transp` over a plain colour takes 90 (`V4_BGCOLOR_DEFAULT_TRANSP`), over a colour with its own alpha stays withheld (`paint:v4-default-transp`). Later-`barcolor`-wins is RT6's (`binder.js::syncPaints`); F1's copy was removed at the merge | vw-bgcolor-v4-default MATCH; vw-bgcolor-barcolor O1-O3, S1, P1, P2 agree, O4 (`offset = na`) withheld by name. `wyckoff-accumulation-distribution`'s only output (`barcolor(..., offset = -2)`) now attaches on the runtime lane |
| **(6) helpers called once** (`once-ta-helper-{rddt,spy}-1d`) | a one-expression helper reading `ta.*` history, called from a `barstate.islast` block, was refused (`fn:conditional-history`) | `objectFnInline.js::oneExecutionTokens` inlines a one-expression history helper and reads it with its one-run rewrite; `ta.rsi` / `ta.stdev` / `ta.atr` / `ta.change` / `ta.cum` (block-only rows in C48) and `ta.wma` are one-run rows inside a helper too (`helper: true`) | RDDT and SPY MATCH (14 labels each) |
| **(7) daily `ta.vwap(src)`** (Q-H3a `h3-vwap-source-spy-1d`, `vw-clock-vwap-spy-1d`) | `computeVWAP`'s unit gate refuses a date-keyed daily bar, so a daily `vwap` was blank | `interpret.js::dailySessionVwap`: on a `D` chart whose every bar is keyed `'YYYY-MM-DD'`, each bar is its own session, so `vwap(src)` is the bar's own `src` (`hlc3` for `vwap`). The server sweep's integer day keys keep the refusal (`nanLaundering.test.js` pins it) | vw-clock-vwap-spy-1d MATCH 16 / 16; h3-vwap-source S01-S08 agree (S09 refused `pine:arity`, so the capture stays INCONCLUSIVE); cpr-with-mas RDDT DIVERGE -> MATCH, SPY VWAP agrees |

### Withheld by name

| item | cause | what the member sees |
|---|---|---|
| **(2) sonarlab-order-blocks SPY / AAPL / BRK.A** box counts | the boxes live in a `var` list grown on every bar; a capture window that does not start at the listing cannot hold the boxes TradingView made before it, so the count can never agree | off the listing, a `var` (persist) list of drawings is withheld whole: `objectRuntime.js`, `objects:off-listing` (`ctx.offListing`, from `reader.historyFromListing`). A list this run can show holds only window objects keeps drawing: (a) capped FIFO and evicted on this run — `push` + remove index 0, or `unshift` + remove `size - 1`, under a guard on its own size or on a sibling list grown under the same guards (`>` or `>=`), every removal checked at run time to take the oldest end; (b) RENEWED — cleared unconditionally (`collclear`, every bar or the last bar). rsi-horizontal SPY, average-day-range-adr-pivots SPY and ict-killzones-pivots-tfo SPY (CAP3) stay MATCH. The harness grades the rest "withheld by name" (F3's rule); the withheld objects ride on the run as `offListingLive` for diagnostics only (F4's window analysis) |
| **(3) auto-trendline-dojiemoji** 2 lines | a removal the program loses (`line.delete` of a line pushed in a branch the lane cannot follow) | withheld whole by F3's `pine:object-removal-lost`; graded withheld by name |

### Open for the integrator

| item | state |
|---|---|
| CAP3 signatures `htf-liquidity-dashboard-tfo-spy-1d` and `institutional-smc-order-flow-matrix-pro-spy-1d` (`cap3-spy-gap-verdicts.json`) | both were DIVERGE before F1 and stay DIVERGE; F1 withholds their `var`-list lines / boxes off the listing (htf: four of six level lists never reach their cap inside the window, so this run cannot show what TradingView's older bars left; smc: F4 measured its shortfall as the window). The pinned signature still records the count rows (`tableCells 30/3`; `lines 198/34`, `labels 449/81`), so the two `control:` rows in `vendorHarness.coverageAudit` CAP3 are red. F1 did not re-pin a CAP3 signature (another lane's measurement); re-pinning them to `objects: ["DIVERGE", []]` is the integrator's call |

### Not fixed

| item | cause | state |
|---|---|---|
| ratchet R03 (RDDT bar 0) | the listing pass reads bar 0's `nz(self[1], 1) == -1` before the state exists; the reading needs a spelled seed (`readingSeed`), which exists only in switched marks | open, `it.fails` kept |
| h3-vwap-source S09 | `ta.vwap(src, anchor)` with an anchor: refused `pine:arity` | open, refused by name |

### Measured

| | base | F1 |
|---|---|---|
| member door census off / on / runtime (measured before the e3b87af31b merge, on a66bae77b7 bytes) | 55 / 80 / 86 | 55 / 80 / **87** (+ cc-yata, runtime); 0 lost |
| committed harness (252 captures), objects pane on (same tree) | MATCH 65 · DIVERGE 64 · INCONCLUSIVE 123 | MATCH **70** · DIVERGE **47** · INCONCLUSIVE 135; 0 MATCH lost |
| committed harness, runtime pane on (same tree) | MATCH 71 · DIVERGE 76 | MATCH **76** · DIVERGE **59** |
| census and harness on the final merged tip (d1b56850cf) | not measured | not measured (integrator: focused rails only) |

Corpus outputs whose computation moved: `relative-volume` (a `const int` quotient in a window length); the
`pine:window` guard on `3-level-zigzag-semafor`, `relative-volume`, `renderingnature-smc`; `cc-yata` attaches on
the runtime lane; `wyckoff-accumulation-distribution` gains its offset `barcolor` (RF fixture re-written for it
alone). Python: the const-int fold happens in the tree the Python lane reads, so `api/` needs no change.

## CAP2 - coverage audit (2026-10-02)

Lane CAP2, branch `pine/cap2-coverage-audit` (from `integrate/wave16-2026-10-02` 304a6ec692, wave-16 tip
666ea1c854 merged in at 310a2ab38a). Question: of the corpus scripts the member door ATTACHES, which have
never been graded against TradingView, and what does the harness say once they are?

**Census** (`memberDoorCensus.measure.test.js`, `VENDOR_BATCH_CENSUS_RUNTIME=1`): base tree off 54 / on 79 /
+runtime 85 of 266; wave-16 tree off 55 / on 80 / +runtime 86 (the one new attach:
`cpr-with-mas-super-trend-vwap-by-guruprasadmeduri`). Joined to every capture under `tests/fixtures/vendor`
by `source.sha256` == the corpus file's sha256: 61 of 79 attached scripts already had a capture; 18 did not,
plus 4 of the 6 runtime-only attaches. List, most-boosted first: `cap2-coverage-list-2026-10-02.json`.

**Captures.** Each script added to the rig (`01f1AcIj`) as an unsaved draft (Monaco buffer written and
read back by sha256, binding gate exactly one `Add to chart` / zero `Update on chart`), read with
`tv_capture.js`, moved by the clipboard with the page receipt (chars + FNV-1a over UTF-16 code units)
re-checked on the shell side, assembled by `verify_capture.mjs` - all 50 CAP2 captures re-verified
`VERDICT: PASS (50/50)`. NYSE:RDDT 1D from the listing (636 bars, `startsAtBar0`) and AMEX:SPY 1D (1800 bars
from 2019-08-06, not from the listing) for every non-trivial script. `tv_capture.js` gained an opt-in
`allowEmptyPlots` (a study whose only plot is `plot(na)` and that holds drawings). Every study removed
after its capture; the rig was left at 0 studies, 0 drawings, NYSE:RDDT 1D.

**Verdicts** (`vendorHarness.coverageAudit.test.js`, 47 tests; MATCH = `expect`, DIVERGE = `it.fails` +
a control naming the bars). Door state: objects pane on; runtime pane on for the runtime-only four.

| script | capture(s) | verdict (plots / objects) | diverging items, bars, family |
|---|---|---|---|
| atr-bands | rddt | MATCH / MATCH | - |
| cdc-btc-rainbow-road | spy (RDDT not capturable: SMA 730 > 636 bars, TradingView holds 0 rows) | MATCH / - | - |
| macd-shortlong-strategy-...-input-optimizer | rddt | MATCH / - | - |
| rsi-horizontal-resistance-levels | rddt, spy | - / MATCH (5 lines, colours) | - |
| tradingview-alerts-to-mt4-mt5-strategy-example | rddt | MATCH / MATCH (table cells, colours) | - |
| tradingview-alerts-to-mt4-mt5-forex-... | rddt | MATCH / - | - |
| atr-trailing-stop-by-ceyhun | rddt, spy | RDDT plots MATCH; SPY DIVERGE / DIVERGE | SPY Slow Trail na-vs-value 949 bars from 522 (scattered), BUY from 554 (14), SELL from 531 (16), barcolor from bar 0; both: 1 label not drawn (no drawing program) |
| cpr-with-mas-super-trend-vwap | rddt, spy | DIVERGE / - | VWAP na on ours: RDDT all 636 bars, SPY 960..1799; SPY CP/BC/TC/D-S1/D-R1 colour on bar 1 only (TradingView transparent); SPY EMA converging prefix 50..412 |
| implied-volatility-suite | rddt, spy | DIVERGE (colour) / - | Volatility Data values agree; per-bar colour differs from 364 (RDDT) / 412 (SPY), persistent (ours gold #c9a84c, TradingView #ff5252) |
| multicator-table | rddt, spy | plots MATCH / DIVERGE | TradingView 72 drawings (2 tables, 60 cells, 5 boxes, 5 labels); our script has no drawing program |
| optimized-keltner-channels-sltp-strategy | rddt, spy | DIVERGE | RDDT two untitled plots na vs 0 on bar 0 only; SPY Upper/Basis/Lower converging prefixes (window, not a maths delta) |
| pmax-explorer | rddt, spy | RDDT PMax / MA MATCH; SPY DIVERGE / DIVERGE | SPY PMax na-vs-value 1139 bars 512..1799 (persistent), MA converging prefix 10..84; screener label not drawn; Buy/Sell UNMAPPED (repeated titles) |
| supertrend-strategy | rddt, spy | plots MATCH / paints DIVERGE | barcolor withheld (expression colour) |
| support-and-resistance | rddt, spy | RDDT MATCH; SPY DIVERGE | SPY both plots na vs value bars 20..51 (window start, fixnan pivots) |
| support-and-resistance-multi-time-frame | rddt, spy | DIVERGE | RDDT Resistance Weekly na 15 bars from 161, Support Weekly 3 from 476; SPY all six levels, Support Monthly na 735..1799 persistent |
| swing-highlow-zigzag-chartprime | rddt, spy | - / DIVERGE | Swing H / Swing L labels not drawn (2 vs 0); SPY lines 52 vs 12 |
| twin-range-filter | rddt, spy | SPY MATCH; RDDT DIVERGE | RDDT Long na-vs-1 on 5 bars from 177, Short on 6 from 171 |
| trend-targets-algoalpha (runtime) | rddt, spy | RDDT plots MATCH / DIVERGE; SPY declined | RDDT label text full precision vs tick-rounded ("TP1 ▸ 177.5276604489" vs "177.53"), barcolor not drawn; SPY `runtime:history-start` |
| wyckoff-accumulation-distribution (runtime) | rddt, spy | DIVERGE | 12 / 22 boxes not drawn (no drawing program); offset barcolor withheld; 8 plots no column |
| fibonacci-dolphintradebot (runtime) | rddt, spy | RDDT chars MATCH / DIVERGE | 14 drawings (fib lines + labels) not drawn |
| delta-rsi-oscillator-strategy (runtime) | rddt, spy | INCONCLUSIVE | the run attaches and computes no column for Buy / Sell / Exit Long / Exit Short |
| opening-range-initial-balance-opening-price | rddt | INCONCLUSIVE | 11 of 15 items UNMAPPED (TradingView repeats titles Shapes / OR Low / IB Low); intraday script on a daily chart |
| supertrend-explorer | - | refused BY TradingView | "Invalid symbol: {symbol}" at default inputs (one of 38 hard-coded `input.symbol` tickers no longer resolves) |

Counts, by script (23): **MATCH 6**, **DIVERGE 14**, **INCONCLUSIVE 2**, vendor-refused 1. The fix work the
DIVERGE rows name, by family: drawings with no drawing program (multicator, pmax label, atr-trailing label,
wyckoff, fibonacci-dolphin, zigzag labels); na where TradingView carries a value (cpr VWAP on a daily chart,
pmax PMax, atr-trailing SPY, S/R-MTF higher-timeframe levels, twin-range RDDT signals); colour (IV suite,
cpr bar 1); text precision (trend-targets labels); withheld barcolor (supertrend-strategy, wyckoff).
Converging prefixes on SPY are window effects, not maths.

**Queues taken.**
- RT3 Q-NL-a/b (`rt3-na-logic.pine` v5 and `rt3-na-logic-v4.pine`, RDDT 1D): `or` / `not` read an `na` operand
  as FALSE in both v5 and v4, and the result is never `na` (B04/B05 = 2). Our door today: B02, B03, B07
  diverge (na where TradingView answers), B04/B05 diverge - the queue's first branch is the fix.
- H3 Q-H3a `h3-vwap-source` SPY 1D (1800): every S-row valued on every bar. Q-H3b the same on SPY 5 regular
  (1300 bars, 13 resets). Q-H3c `h3-alma-v4`: v4 bare `alma` compiles; A03..A06 within 4.5e-13 of the
  reference on SPY, exact on RDDT; first value bar 8. Our door refuses both probes whole (`pine:arity` for
  S09, `pine:block` for the probe's own reference `for`), so the vendor readings stand alone.
- CAP row 9: `vw-lower-tf-1-30.pine` on SPY 1D - `"30"` last-intrabar close/time and `security_lower_tf`
  size equal TradingView's own 30m bars on 641 / 641 days, `"1"` on 23 / 23 (1m history 258 days); both
  probes on SPY 1M from 1993-01; `vw-lower-tf.pine` on NYSE:CAVA 1D from the listing: `lookahead_on` below
  the chart is `na` on the listing day and the first intrabar after it (the second symbol C41 asked for).
- Not taken: CAP rows 10-16 (no probes exist; 16 is not a TradingView capture), row 7 and anything needing a
  forming bar (next RTH session). H2 / RT5 / F1 / L2 pushed no capture queue at audit time.
## RF - the runtime pane made ready to switch on, and the plan for it (2026-10-02, step 77)

Branch `pine/rf-runtime-readiness`, base `integrate/wave16-2026-10-02` (`666ea1c854`). Nothing
flipped: `VITE_PINE_RUNTIME_PANE_ENABLED`, `PINE_RUNTIME_SAVE_ENABLED` and `PINE_RUNTIME_KILL_LIST`
are exactly as they were. The plan is `docs/pine/runtime-pane-switch-on-plan.md`; raw evidence is
`docs/pine/evidence/rf-runtime-readiness-2026-10-02/` (committed before this section was written).

### What switching on adds

Member-door census (`memberDoorCensus.measure.test.js`, `VENDOR_BATCH_CENSUS_RUNTIME=1`) on this
tree: 55 / 80 / **86** (off / on / on + runtime). Six scripts attach only through the runtime lane:
adx-and-di-for-v4 (capture: **MATCH**), inside-bar-range (capture: plots and objects MATCH, paints
**DIVERGE**: its two `barcolor`s are not drawn by a runtime document), and four with **no capture**:
delta-rsi-oscillator-strategy, fibonacci-dolphintradebot, trend-targets-algoalpha,
wyckoff-accumulation-distribution. Ruling R-RT names wyckoff as graded MATCH; no wyckoff capture
exists (RT1 already called it ungraded).

### Performance, measured (`runtimePaneReadiness.measure.test.js`, `tools/runtime_pane_worker_probe.py`)

| script | door (main thread, cold / warm; of which the runtime probe) | 5,000 D, real browser worker | 11,534 D, node | 20,208 / 32,000 x 5m |
|---|---|---|---|---|
| adx-and-di-for-v4 | 20 / 15 ms (4 ms) | 99-136 ms | 432 ms | `runtime:limit` |
| delta-rsi-oscillator-strategy | 39 / 47 ms (14 ms) | `runtime:failed` (array.sum over na) | same | `runtime:limit` |
| fibonacci-dolphintradebot | 137 / 156 ms (20 ms) | 1,191-1,241 ms, **`runtime:time-budget`** | 4,397 ms | `runtime:limit` |
| inside-bar-range | 26 / 20 ms (3 ms) | 84-114 ms | 534 ms | `runtime:limit` |
| trend-targets-algoalpha | **1,124 / 1,019 ms** (10 ms: the host translator is the cost) | 172-184 ms | 2,468 ms, budget | `runtime:limit` |
| wyckoff-accumulation-distribution | 62 / 74 ms (11 ms) | `runtime:failed` (array.max of empty) | same | `runtime:limit` |

Node peak heap during a run 6-64 MB (fibonacci highest). Browser: worst main-thread frame gap during
any run **17 ms** (control: a 400 ms deliberate block read 383 ms; headless Chromium reports no
`longtask` entries at all, so that instrument cannot clear anything); `postMessage` 1-2 ms at 5,000
bars, 13-17 ms at 32,000. Worker bundle 1,303,711 B / 380,686 B gzip (standalone, the app's prose
stripping applied; the in-app chunk not measured, the full build is blocked, below). Every intraday
series past 20,000 bars stops `runtime:limit` (`limits.js` `HISTORY`); a fallback document is refused
`runtime:history-start` on every intraday chart before that (R-W).

### Fixed (each measured first, each mutation-proved)

1. **Named stops.** A VM limit and any other run throw reached the registry as `engine:error` with
   text like `HISTORY_EXCEEDED - ceiling 20000, reached 20208`. Now `runtime:limit` / `runtime:failed`
   name the limit or the failing call and the bar (`runtimeColumns.js`). Mutation: 3 red.
2. **The member reads why.** No surface rendered a column error (`columnErrors` is "not UX", C2A.8),
   so a runtime pane refused on a chart drew an empty pane with no sentence: every intraday chart and
   every daily chart not reaching the listing. `nativeRegistry.runtimeRunStopOf` words it; the binder
   publishes it on the same strip as C43's `runtime.error` and clears it on release and on disable.
   Mutations: binder publish 2 red, disable clear 1 red.
3. **Worker failure.** RT1 re-ran a dead worker's jobs on the main thread (a full budget of frames
   each, per update on a live chart); a hung worker left the pane in flight forever. Now: watchdog
   (`RUNTIME_WORKER_WATCHDOG_MS` 20 s, `runtime:worker-unresponsive`), death answered
   `runtime:worker-failed`, at most `RUNTIME_WORKER_MAX_STARTS` (3) workers per tab, and only a browser
   that cannot construct a worker runs on its own thread. A live chart's flood of new bars arrays
   keeps only the newest waiting run per pane. Mutations: watchdog 1, coalescing 1, re-run-here 3,
   start cap 1 red (its duplicate copy in `workerOf` was inert, the mutation survived, so it is gone).
4. **Lane chunk load failure** was retried on every paint and said nothing: now remembered for the
   tab, named `runtime:load-failed`, the loader called once. Mutation: 1 red.
5. **The kill list on an open tab.** `installUserDefinitions` only added: a re-read serving a listed
   runtime document (stamp or latched list) was refused while the copy installed before the kill kept
   drawing until reload. The install door now uninstalls a killed id. Mutation: 3 red.
6. **Bar colours were undisclosed.** RT1's "Not drawn by this pane" read `t.outputs`; B1 moved
   `bgcolor` / `barcolor` to `t.presentation.paints`, so 3 of the 6 documents (inside-bar,
   trend-targets, wyckoff) silently omitted bar colours TradingView paints. Now named. Mutation: 2 red.

H14: a runtime landing re-renders the chart through `useServerColumns`; the rail renders a real pane
under that hook and asserts a bounded, quiescent render count with one worker run, and that a host
handing new bars every render keeps at most one run waiting.

### Save / load and the kill list (with `PINE_RUNTIME_SAVE_ENABLED` on in a test)

`tests/fixtures/runtime_documents/documents.json` is the six documents as the door mints them (held
to the door by `runtimeDocumentRoundTrip.test.js`, which also re-installs each from JSON and compares
its columns on 5,000 daily bars). `tests/test_runtime_document_round_trip.py`: five reload
byte-identical with the repaint class re-derived server side (RT2) and equal to the door's; a
misstated class is refused both ways; a source edit is a new version and rev; **trend-targets
(~84 KB) is refused by the 64 KiB cap**, by name; off, every one is refused with the store's
sentence; a kill by source hash stamps the served row, leaves the stored row byte-identical, and
unlisting restores it.

### Tests

vitest (repo config, jsdom, before the shared install broke): 9 files, 85 passed (incl.
`runtimePaneSafety.test.jsx` 19). vitest (node environment, scratch config): 11 files, 94 passed.
pytest `test_runtime_document_round_trip.py`, `test_runtime_definitions.py`,
`test_runtime_repaint.py`: 53 passed. `runtimePaneSafety.test.jsx` was not re-run after `54c5e82ea7`
(the shared jsdom stopped loading); the commits after it change the install door and the paint
disclosure, which that file exercises only with no kill list and a paint-free script.

### Open (owners in the plan)

D1 a staged cohort gate (the server half exists in `rollout_gate`; the client consumes no cohorts);
D2 the 64 KiB cap vs trend-targets; D3 fibonacci at the budget; D4 carry host paints on a runtime
document; D5 intraday `HISTORY`; D6 restate R-RT's allowlist (only adx-and-di qualifies today).
Captures for delta-rsi, fibonacci-dolphintradebot, trend-targets and wyckoff go to CAP2.
**Environment:** the shared `node_modules` lost `@asamuzakjp/css-color`, `@adobe/css-tools` and
`@discord/embedded-app-sdk` mid-session; jsdom tests and `vite build` cannot run until it is
reinstalled.
## L2 - the scripts that import a library, measured with the libraries, and their next walls (2026-10-02, step 74)

Lane L2, branch `pine/l2-library-scripts`, base `integrate/wave16-2026-10-02` (`304a6ec692`), merged with the wave-16 tip
`666ea1c854` (H2 + H3) before the final census. Production's library store holds all 50 libraries the corpus imports;
every census in the repository runs with an EMPTY registry. L1 already shipped the opt-in loader
(`ast/__tests__/pineLibraryStoreLoader.js`, `PINE_LIBRARY_STORE=<scratch dir>`), read by the member-door census, the
runtime census and `libraryImportersCensus.measure`; it is never on by default and no library source is committed.

### The true census (member door, `memberDoorCensus.measure.test.js`, off / on / on + runtime, 266 scripts)

| tree | empty registry (production today) | 50 libraries loaded |
|---|---|---|
| wave-16 tip `666ea1c854` | 55 / 80 / 86 | 55 / 82 / 88 |
| L2 tip `25012b2311` | 55 / 80 / 86 | **55 / 82 / 89** |

Importers past the import wall: empty registry host 4 / 34, runtime 1 / 34; loaded host 30 / 34, runtime 30 / 34. The two
the libraries unblock at the door (objects pane on): `all-chart-patterns-theeccentrictrader`, `black-scholes-...-loxx`
(both host lane). L2 adds `rolling-vwap` (runtime lane, 7 plots; ungraded - capture Q-L2a). The four that stay at the
import wall import a v5 library into a v6 script (`fx-market-sessions`, `auto-trendlines-tradingfinder`,
`machine-learning-lorentzian-classification__21f5`, `rate-of-change`): TradingView compiles each at its own version and
this engine one program at one version - refused by name, not a capture question (Q-L2b). Runtime census (store
loaded): `runtime:function` first walls 11 -> 3, compiled end to end 23 -> 23.

### Constructs admitted (one per commit)

1. **Default parameter values, runtime lane** (`4106fc6be2`). The first runtime wall of 7 importers (ta/7, ta/9,
   ZenLibrary, reees/TA, MLExtensions, chart-vwap, adaptive-trend). Pine: an omitted trailing argument runs the body
   with the declared default; Q-L1 pins it for a series default (L05 == L03 on every bar). Compiled as the default
   written at the call, which is exact only for a value that cannot depend on where it is read: literals, dotted
   built-in constants, Pine's built-in bar series (refused by name if the caller binds that name). Anything else keeps
   the header refusal. Rail `builder/memberPane/runtimeParamDefaults.test.js`; 3 mutations, each red.
2. **Q-L1 graded MATCH** (`553fe7bf1c`): a fixture library written for the rail at `TradingView/ta/7`, member door,
   runtime pane: 7 / 7 plots MATCH on 636 bars; control (default `source = low`) DIVERGES on L05 only; opt-in real ta/7
   from the store MATCH (measured 2026-10-02). The host lane still refuses a header with defaults; the runtime lane draws it.
3. **A required parameter behind an optional one** (`594271632a`): only trailing omissions are completed, so the rule
   that refused such headers bought nothing; a call leaving the required one out keeps its arity refusal. 2 red.
4. **A tab is one indent level** (`3d79658033`, `pine.js` lexer, both lanes): Pine's "four spaces or a tab";
   TradingView/ta/9's `supertrend` mixes the two in one body. Before/after digest over all 266 (host formulas, runtime
   IR, with and without the store): 0 compiled outputs changed; 3 refusals moved. 2 red.

### Each library script's next wall (L2 tip, store loaded; host | runtime)

| script | host | runtime |
|---|---|---|
| adaptive-trend-following-suite-alpha-extract | pine:function-def (a header with defaults, host) | pine:role-order (`ta.cci` source) |
| all-chart-patterns-theeccentrictrader | attached (host, objects) | runtime:statement (`ta.valuewhen` in a function, PubLibSwing/3:68) |
| atr-stop-loss-indicator | pine:function-def (ZenLibrary:17, host) | `syminfo.mintick` unsettled (bind-time text) |
| atr-trend-bands-misu | pine:timeout | runtime:colour |
| auto-trendlines-tradingfinder | pine:module (v5 library in v6) | runtime:library (same) |
| black-scholes-...-loxx | attached (host, objects) | pine:function (`timestamp`) |
| bull-vs-bear-market-intraday-sessions | pine:no-output (O1) | runtime:udt-method (arraymethods/1:30 overload) |
| candlestick-patterns-on-backtest | pine:object-removal-lost | pine:input-kind (`input.time`) |
| chart-vwap | pine:tuple (H3) | pine:statement |
| cvd-cumulative-volume-delta-candles | pine:type (H3) | runtime:switch (lower_tf/5:78) |
| cvd-cumulative-volume-delta-chart | pine:function (`chart.bars`) | pine:builtin (`chart.left_visible_bar_time`) |
| delta-volume-candles-lucf | pine:tuple (H3) | runtime:switch (lower_tf/4:113) |
| deviation-scaled-moving-average-loxx | pine:arity (`ta.change` 2 args) | pine:builtin (`ticker.heikinashi`) |
| fx-market-sessions | pine:module (v5 in v6) | runtime:library |
| heikin-ashi-supertrend | pine:strategy-call | runtime:presentation (`plotcandle`) |
| kalman-psar-backquant | pine:state (H2) | runtime:function (a `[` in a header) |
| machine-learning-lorentzian-classification__21f5 | pine:module (v5 in v6) | runtime:library |
| machine-learning-lorentzian-classification__5c79 | pine:type (H3) | runtime:call-windowed-state (MLExtensions:121, `ta.rsi`) |
| machine-learning-rsi-bullvision | pine:tuple (H3) | pine:block |
| pivot-trendlines-with-breaks-hg | pine:arity | pine:na (`fixnan`) |
| rate-of-change | pine:module (v5 in v6) | runtime:library |
| rolling-vwap | pine:block (H2) | **attached** (runtime lane, ungraded, Q-L2a) |
| rsi-trendlines-with-breakouts-hg | pine:arity | pine:na (`fixnan`) |
| smart-money-breakout-channels-algoalpha | pine:function (`ta.barssince`) | runtime:call-undeclared-builtin-state (`timeframe.in_seconds`, ta/10:415) |
| smart-money-concept-tradingfinder | pine:object-removal-lost | runtime:array (`array.insert`, RT5) |
| smc-structures-and-multi-timeframe-fvg | pine:state (H2) | pine:input-kind (`input.timeframe`) |
| std-filtered-adaptive-exponential-hull-loxx | pine:block (H2) | pine:builtin (`ticker.heikinashi`) |
| stop-loss-clustering-breakouts-kioseff | pine:reassign (H2) | pine:statement |
| strength-of-divergence-across-multiple-indicators | pine:no-output (O1) | runtime:statement (`pivothigh` sized by a parameter, reees/TA:148) |
| supertrend-relative-volume-kernel-optimized-flux | pine:tuple (H3) | runtime:array (after ta/9's tab line) |
| trailing-take-profit-trailing-stop-loss | pine:block (H2) | pine:statement (`export enum` with values, chrono_utils/7:31) |
| volatility-stop-mtf | pine:tuple (H3) | pine:builtin (`timeframe.from_seconds`) |
| volume-footprint-measuring-classical-indicators | pine:input-kind (`input.enum`) | pine:statement |
| volume-profile-plus | pine:no-output (O1) | pine:builtin (`chart.left_visible_bar_time`) |

Owned elsewhere and not touched: H2 (`pine:block` / `state` / `reassign`), H3 (`pine:tuple` / `type` / `function-def`
in the host), RT5 (`runtime:array`, object drawing), O1 (`pine:no-output`). Open, not attacked: host-lane defaults
(H3's code), `export enum` with string values in a library, `runtime:switch` (lower_tf), `ta.valuewhen` inside a
function, `runtime:udt-method` overloads, a v5 library under a v6 script.

### Measurement notes

The shared `app/node_modules` lost 13 entries mid-session (restored by the integrator); L2's last suites and every
final census ran from scratch checkouts (`git archive` of the tip / of `666ea1c854`) with a junction to an intact
install. The wave-16 base census with the store died once out of memory (no totals line) and was re-run alone; the
runtime census's three timed-out cases on the base run are load (its compiled line printed).

## H4 - loops on the runtime lane: the walls in front of a counted `for`, and refused rows that drew what TradingView hides (2026-10-02, step 76)

Lane H4 of the "import any TradingView Pine script" program, branch `pine/h4-loops`, base
`integrate/wave16-2026-10-02` (`a242ed77f6`). Target: the loop wall class (ruling R7) - H2's R-b / R-c / B-a
(17 scripts) and O1's G2 (a value a loop computes).

### Route, decided per shape

Ruling R7 already put numeric accumulators in a counted `for` on the RUNTIME lane, and that lane runs a counted
`for` natively (`pineRuntimeFrontend.js` `forStmt`; `INSTRUCTIONS_PER_BAR` unchanged). The host columnar fold was
measured out by WAVE2-A (counted-`for` accumulators: 63 of 379 have a knowable bound, 1 of 379 admissible), and an
exact closed form exists only for a window whose every element is defined, which a loop does not guarantee (`na`
in `+` poisons the loop's total; a window sum does not say so). So **every shape below is served on the runtime
lane; nothing is folded on the host lane**, and the Python mirror is untouched (no host tree changes; translation
census 75 / 66 at base and tip).

What stopped the loop scripts were walls IN FRONT of the loop, read off each script's own `runtimeDeclined`
(member-door census, runtime state):

| shape | scripts | wall at base | outcome |
|---|---|---|---|
| **L1** a call-site length that is constant ARITHMETIC (`pine_wma(v4, vl5)`, `vl5 = vl3 + vl4`) | volume-divergence-by-mm (B-a) | `runtime:history-dynamic-offset` (`y` sizes a window) | **served**: `constantArgOf` folds constant arithmetic the way `constValueOf` already folded a loop bound (`foldScalar` over the frozen resolver). `/` and `%` keep their refusal (Pine's integer division is version-dependent). Next wall: `runtime:call-windowed-state` (`pivotlow` over runtime state) |
| **L2** a helper whose body ENDS in an `if` around a `for` (`f_init(p) => if na(..)` / `for ...`) | kalman-price-filter-backquant (B-a) | `runtime:block-value` (an `if` arm must yield a value) | **served**: `endsInLoop` compiles it VALUELESS, the rule C18 already applies to a bare trailing loop; a call that READS the value still refuses by name (`runtime:function`). Pine discards it at a statement call, as here. Next wall: the plot's per-bar colour |
| **L3** `array.size(array.from(e1..eN))` as a loop bound | nadaraya-watson-rational-quadratic-kernel-non-repainting (B-a) | `runtime:history-dynamic-offset` (`_size`), then `pine:collection` | **served**: N on every bar (`fromLiteralSizeOf` / `substFromSizes`), read through a once-bound name and never through a slot that shadows it, lowered only when every element is a bare name or literal (no skipped effect). Next wall: the plot's per-bar colour |
| **L4** a REFUSED row's `display = display.none` and `offset` | nadaraya-watson (`Alert Stream`), wyckoff-accumulation-distribution (8 markers, `offset = -pivotLen`) | none: a wrong drawing | **fixed**: two spreads (`pine.js` outputs, `builderInputs.annotate`) dropped the non-enumerable `_offsetWritten`, so RT1's offset guard never saw a refused row's offset, and a refused row never carried `hidden`. Now `_authorHidden` is read by the reader a translated row uses (`outputHidden`), both facts survive both copies, and the runtime document skips a hidden row and withholds a shifted one by name |

Refused, named, not this lane's (each script's final `runtimeDeclined`): R-b machine-learning-ma
(`pine:role-order`, `ta.cci`), moving-averages-sr-mtf (`security`), order-block-finder (`tostring`); R-c
delta-imbalance (`var tablePos = switch`), smart-money-volume (`barstate.isnew`), smt-divergence and
volume-profile-v054beta and session-tpo-profile (a non-literal session), supply-demand (`input.timeframe`),
sr-logistic-regression (`for ... in` over a UDT list, H3's), volatility-coil (`_compMinBars` reassigned under a
text-input switch, sizing `ta.atr`); B-a atr-stepped / kalman / NW (per-bar plot colour), kernel-channel
(`plotcandle`), one-sided-gaussian (`matrix.new`), nonlinear-regression (a trailing comma ends line 93: a comma
line, H2's / O1's), trend-line-harrybot (`[a, b] = if` with drawings); G2 trendlinesample (`line.new`: the runtime
fallback draws no objects), support-and-resistance x2 (`short_term_top`, a global read in a frame; `for i = 1 to
ta.barssince(r)`, an unbounded dynamic offset, correctly refused), fibonacci-retracement-statistics (`int` over
state).

### Evidence

No TradingView capture of any loop script exists. `vendorHarness.h4Loops` (13 tests) holds the runtime lane's
columns to a HAND REPLAY written from Pine's semantics (a `for` runs `from`..`to` inclusive; `x[i]` before bar 0
is `na`; `na + x` is `na`; an `na` comparison is false) on every NYSE:RDDT listing bar (631): `pine_wma(close,
13)` with the length spelled `vl1 + vl2` (619 drawn, na-ness identical), the kalman filter verbatim (631), the NW
kernel's 27-pass loop (605), and a top-level running total (ruling R7). Controls: `/` and `%` lengths still
refuse; a helper whose `if` ends in a value still returns it; a parameter spelled like a once-bound global is the
argument; an `array.from` element that is a call is not folded; the door draws `vis`, skips `display.none`,
withholds `offset`. Probe `tools/visual_conformance/probes/vw-h4-loops.pine` (static colours; draws all four rows
on the runtime lane) is queued as Q-H4a (`docs/pine/capture-queue-2026-10-02-h4-loops.md`).

Mutations (each restored from captured bytes, sha verified, `git status` clean after): arithmetic fold off (3 red),
`/` admitted (1), `endsInLoop` bare-only (2), `array.from` count off (2), shadow guard off (1), `plainOnly` off
(1), `_authorHidden` unset (1), `keepHiddenFacts` no-op (1), `carryHandoffs` keys dropped (1), the door ignoring
`_authorHidden` (1): 10 of 10 red.

### Measured (base `a242ed77f6` -> tip)

| | base | tip |
|---|---|---|
| member door off / on / on + runtime | 54 / 79 / 85 | 54 / 79 / **84**; off and on: 0 rows changed |
| runtime rows changed | - | kalman `runtime:block-value` -> withheld-all (colour); NW `history-dynamic-offset` -> withheld-all (colour); volume-divergence `history-dynamic-offset` -> `call-windowed-state`; **wyckoff-accumulation-distribution attached -> declined** |
| harness dir (202 entries), on / off / runtime MATCH | 56 / 41 / 62 | 56 / 41 / 62; 0 entries changed (note below) |
| translation census host / screener | 75 / 66 | 75 / 66 |

**The one lost attach is a wrong drawing withdrawn.** wyckoff's eight `plotshape`s carry `offset = offsetVal`
with `offsetVal = -pivotLen`; at base the runtime document drew them on the bar that computed them, `pivotLen`
bars right of where TradingView draws them, because the offset fact was dropped by a spread before RT1's own
guard could read it (ungraded: no capture). Now each row is withheld by name ("drawn away from its own bar").

Harness note: the full runtime-state sweep at tip read 3 plots of `vw-deadband-ticks-aapl-1d` as INCONCLUSIVE
("computeFor returned no column"); re-run alone twice at tip they read MATCH on 11,534 bars, as at base. That is
the runtime pane's 1,000 ms per-indicator wall-clock budget on a box at 2 GB free, not the code; counted as 0
changed.

### Next wall, measured by substitution (not built)

A runtime row's **per-bar colour** (`runtimeRowPresentation`: a `colorDynamic` row is withheld) is the wall in
front of atr-stepped-pdf-ma, kalman-price-filter and nadaraya-watson (all three now past their loop walls) and of
deadband-hysteresis-filter, fvg-trend and parabolic-sar. Substituting "carry it as the default colour" at tip
attaches those six (84 -> 90, scratch census `h4-census-colourprobe`, file restored by bytes; a measurement, not a
design: a default colour where TradingView paints two would be a wrong drawing). Carrying it needs a runtime-computed colour column and a palette the document can name: the
presentation half of the runtime lane, RT's to own.

## F2 - plot values and per-bar colours that disagreed with TradingView on CAP2's captures (2026-10-02, step 78)

Lane F2, branch `pine/f2-value-divergences` (from `integrate/wave16-2026-10-02` 3f9c35aebd, merged with
a66bae77b7 at 0bdb2c685c). Brief: the plot-value and per-bar-colour divergences CAP2 graded (section CAP2),
wrong values first, then values drawn as `na` where TradingView draws one. Lane F1 owns integer division,
sonarlab, auto-trendline, Q-NA `?:` rows, bgcolor/barcolor paints (B1), daily-vwap and once-ta-helper; F3
owns drawings; H4 owns loops, RT5 objects and L2 libraries.

### Fixed (wrong values / wrong colours)

| item | cause | fix | before -> after |
|---|---|---|---|
| implied-volatility-suite, Volatility Data colour (RDDT from 364, SPY from 412; 272 / 1,388 bars) | `col = if (VolatilityChoice == ...) ... else if ...` is an if EXPRESSION; `foldIfChain` builds its value as a ternary whose arms are `bound` nodes, and every colour reader in `pine.js` (`staticColourOf`, `colourConditional`, `colourIndexChain`, `staticColourArity`, `colourHelperAlpha`, `settledColourNode`) opened only `name` nodes, so the colour fell to `colorDynamic` and drew in the pane's gold | `openBoundArm`: an `expr` arm whose scope is the chain's own is opened like a name, in all six readers; an arm with a scope of its own stays declined | DIVERGE -> **MATCH** on both captures, colour compared on every valued bar (`vendorHarness.coverageAudit`, F2 control) |
| rt3-na-logic v5 and v4 (RT3 Q-NL): B02, B03, B07 drawn `na`; B04 `na(w or false)` and B05 `na(not w)` drawn 1 where TradingView draws 2 | `logical` / `!` carry a `NaN` operand through (the `{0,1,NaN}` domain); TradingView reads an `na` operand of `and` / `or` / `not` as false in v4 and v5 and never answers `na` | host lane: `pine.js::naOperandReadAsFalse`, called from the Resolver's one condition hook, re-reads an `and` / `or` / `not` operand that can be `na` as `x != 0` (= `interpret.js::pineBool` by construction) where `interpret.js::naConditionIsFalse(version)` says so and the version is 4 or 5; comparisons, literals, logical ops over them and a member's declared input are never-na and keep their bytes. Runtime lane: `lowerIr.js` reads both operands of v4/v5 `and` / `or` and the operand of `not` as conditions from the listing, and no longer counts them (`naTestsOf`). No Python change: the cast is `!=`, whose `_cmp` is the same in `ast_interpret.py` | DIVERGE -> INCONCLUSIVE on both: every graded row MATCH; the four INCONCLUSIVE rows (B01, B06, B07, B09) are hidden constant rows whose values agree on 636 / 636 bars |
| cpr-with-mas-super-trend-vwap SPY: CP / BC / TC / D-S1 / D-R1 colour on bar 1 (TradingView transparent, ours blue / green / red) | not a product defect: the colour rule `DayPivot != DayPivot[1] ? na : color.blue` reaches 2 bars, the value 1; on a capture not from the listing bar 1's colour compares against a bar before the window. The harness excused the value's reach only | `compare.mjs::colourWarmupOf`: a plot's colour is compared from its colour rule's own `maxLookback` (`ourSide.js::colourRuleLookback`), never on a capture from the listing and never past a declared `capture.warmup` | 5 items DIVERGE -> MATCH (the capture stays DIVERGE on VWAP and EMA, below) |

Measured on the way and kept out: casting v6 too moved `trend-duration-forecast-chartprime` (v6,
`var trend = bool(na)`, `if trend or not trend`) MATCH -> DIVERGE (its latch's `!= 0` became a probe literal;
28 labels went unknown), so v6 is left byte for byte; wrapping declared bool inputs put
`keltner-center-of-gravity-channel` over the install door's node budget (MATCH -> refused), so a declared
input is never-na. Both are railed.

### Not fixed, with the cause found (no value is drawn wrong unless stated)

| item | cause | owner / state |
|---|---|---|
| cpr VWAP `na` (RDDT all 636, SPY 960..1799) | `computeVWAP`'s unit gate refuses a date-keyed daily bar (`VWAP_MIN_INSTANT`), so a daily `vwap()` is blank; CAP2's Q-H3a SPY 1D capture has TradingView drawing each daily bar's own session (H3 question 1) | the daily-vwap construct is **F1's** (`vw-clock-vwap`); not touched here. Missing, not wrong |
| cpr EMA, keltner Upper / Basis / Lower, pmax Moving Avg Line: SPY converging prefixes | the SPY captures start 2019-08-06, not at the listing; TradingView's EMA / RMA state carries 26 years this window does not hold, so its seed is not reproducible from the capture. Ours is seeded at the window and converges (cpr EMA error 7.7e-1 -> 3.9e-7 over bars 50..412) | **question for the integrator.** Withholding a smoother's first ~300-500 bars off the listing would turn every off-listing capture's MATCH warm-up into `na` mismatches under today's harness rules (0 MATCH -> DIVERGE is this lane's rule), and is a product change for every EMA / RMA on every chart. These ARE wrong values on screen until they converge |
| optimized-keltner RDDT: the two untitled plots `na` on bar 0 (TradingView 0) | `bprice = 0.0` / `bprice := crossUpper ? close + mintick : nz(bprice[1])` - a non-`var` recurrence; `listingPass` keeps both bar-0 readings (seed `na`, or the update) because the tree does not record the spelling, and they disagree only on bar 0. A spelled reading (`readingSeed`) exists only inside switched marks | open; missing, 1 bar |
| atr-trailing-stop SPY: Slow Trail `na` from 522 (949 bars), BUY from 554, SELL from 531 | the H1 ratchet's range window cannot narrow the state after bar 522 on a window that starts 2019-08 (probe: `switchedDependencyMask` = 1 from 522, `+/-1e12` propagate); TradingView's value comes from history before the window. From the listing (RDDT) every plot MATCHes | open; missing, not wrong |
| atr-trailing-stop SPY barcolor from bar 0; supertrend-strategy barcolor withheld | paints (`bgcolor` / `barcolor`): warm-up of a paint off the listing, and an expression barcolor | **F1's** (B1) |
| pmax-explorer SPY PMax `na` 512..1799; support-and-resistance SPY 20..51; S/R-MTF weekly / monthly levels; twin-range RDDT Long / Short | not traced in this lane | open, missing values (none drawn wrong as graded) |

### Measured

| | base (a66bae77b7 bytes, this lane's files swapped back) | tip (0bdb2c685c) |
|---|---|---|
| member door census off / on / on + runtime env | 55 / 80 / 80 | 55 / 80 / 80, 0 rows changed |
| harness, all 285 captures, pane off | MATCH 56 · DIVERGE 60 · INCONCLUSIVE 169 | MATCH 58 · DIVERGE 56 · INCONCLUSIVE 171 |
| harness, pane on | MATCH 74 · DIVERGE 72 · INCONCLUSIVE 139 | MATCH 76 · DIVERGE 68 · INCONCLUSIVE 141 |
| harness, pane on + runtime env | MATCH 74 · DIVERGE 72 · INCONCLUSIVE 139 | MATCH 76 · DIVERGE 68 · INCONCLUSIVE 141 |
| entries moved (all three states) | - | implied-volatility-suite rddt / spy DIVERGE -> MATCH; rt3-na-logic / -v4 DIVERGE -> INCONCLUSIVE. **0 MATCH -> DIVERGE**, nothing newly withheld |

⚠️ After the GT merge the runtime pane needs GT's per-member stage, so `VITE_PINE_RUNTIME_PANE_ENABLED` alone
no longer reaches it: the "+ runtime" census and harness state read the same as "on" (80, not CAP2's 86), and
14 runtime-pane tests in `vendorHarness.coverageAudit` / `rt1RuntimeFallback` fail identically on the pure
a66bae77b7 bytes under this lane's node-environment runner. Before the merge (on 3f9c35aebd) the runtime
state moved `institutional-smc-order-flow-matrix-pro` DIVERGE -> MATCH and `cc-yata` attaches on the runtime
pane (its `or` / `not` are no longer counted `runtime:na-test`), railed in `rt1RuntimeFallback`.

Saved documents: `saved-documents-pre-c46.json` fingerprints re-taken for 7 scripts whose computation this
lane corrected (btc-charlie, engulfingcandle, implied-volatility-suite, momentum-volatility-scanner,
opening-range, pivot-high-low-points, trend-lines-sr); every id, name, title, type, default, locator count
and saved value verified unchanged first. `paramIds.test.js` green on the merged tip (4 passed, 1 skipped), no
edit.

Mutations (each restored from captured bytes, sha256 verified): M1 `openBoundArm` never opens - 3 red;
M2 colour warm-up = value warm-up - 1 red; M3 host cast off - 4 red; M4 runtime `and` / `or` reverted -
2 red; M5 runtime `not` back to v6-only - 4 red; M6 declared input not never-na - 1 red; M7 v6 cast too -
1 red.

## F3 - drawing divergences on the host object lane: `str.tostring` formats, and withheld drawings named (2026-10-02, step 79)

Lane F3, branch `pine/f3-drawing-divergences` (from `integrate/wave16-2026-10-02` `3f9c35aebd`). Brief: the
DRAWING (object) divergences CAP2 found on scripts that attach in production; fix to MATCH or withhold by name.
Plot values belong to F2; runtime-native objects to RT5.

**One cause behind two of them.** The object lane printed a number through `str.tostring` with a format it
did not read, and printed something anyway (or refused the whole create):

| format | was | now | witness |
|---|---|---|---|
| `format.mintick` | read as "no format": ten decimals, `177.5276604489` | rounded to the symbol's tick, the tick's decimals, trailing zeros KEPT (`pineTextFormat.js::tickNumberText`); the node carries `tick: 'syminfo.mintick'` and the binding settles it from the witnessed tick table (`objectProgram.js::bindObjectProgram`, re-settled per binding, never kept from another symbol); unsettled, >= 1000, an exact tie or a negative zero is WITHHELD | 11 labels whose own `y` is the printed number: trend-targets RDDT + SPY, trend-lines-supports-and-resistances RDDT (`263.4999` -> `"263.50"`), htf-candle-footprint RDDT |
| words around a pattern, `"Swing H  (#,###.####)"` | refused on a getter (`create:label` lost); `String(n)` on a series (the words gone) | Java DecimalFormat prefix / suffix + grouping (`tostringPatternOf` / `formatPatternedNumber`); WITHHELD: a separator that would appear, a negative under a prefix, `%` `‰` `¤` `'` `;` | swing-highlow-zigzag RDDT + SPY, both labels |
| a non-literal format (`format.volume`, `format.percent`, a script's own `f_tickFormat()`) | ten decimals | carried with the format NAMED (`fmtUnread`, `objectDiagnostics.textFormatUnread`): `na` prints `NaN` (witnessed under a computed format: position-size-calculator RDDT, `"Position Size : NaN"`), any finite value WITHHELD | position-size-calculator RDDT |

The `str.tostring` renderings now live in `pineTextFormat.js` beside `str.format`'s (the plain `#`/`0` path
moved there unchanged as `formatPlainNumber`), so the grammar the translator admits and what the runtime
draws are one module; the runtime pane reads values through the same object program, so both lanes take it.

**Per script** (door state as CAP2: objects pane on; runtime pane for the runtime-only attaches):

| script | cause | F3 | objects before -> after |
|---|---|---|---|
| trend-targets-algoalpha RDDT (runtime) | `format.mintick` read as no format | FIXED (tick) | DIVERGE (labels text) -> **MATCH** (5 lines, 5 labels, 15 colour slots); the capture still DIVERGEs on the barcolor: a runtime-lane document carries no `paints` (F1/RT) |
| trend-targets-algoalpha SPY (runtime) | the run declines `runtime:history-start` (R-W fallback rule: the window is not from the listing) | confirmed, not loosened | unchanged |
| swing-highlow-zigzag RDDT | `"Swing H  (#,###.####)"` on a getter refused | FIXED (affix grammar) | DIVERGE -> **MATCH**, whole capture MATCH |
| swing-highlow-zigzag SPY | labels: same; lines 52 vs 12: a WINDOW - TradingView ran the script over SPY's whole history and the zigzag segments it never deletes carry 1993-2019 prices; 35 of its 52 lines lie wholly below the window's lowest low (218.26) | labels FIXED; lines are not an engine divergence | labels 2/0 -> 2/2 with TradingView's text; lines 52/12 unchanged (pinned with the proof) |
| multicator-table RDDT / SPY | the object gate withholds the whole program (`pine:object-removal-lost`: HUD lists lose pushes - `visibleRange` is a tuple function - that a later `box.delete`/`label.delete` reads); 43 of 60 cell texts read `math.round_to_mintick`, `format.volume` or a `ThemePalette` UDT field; border/frame/cell colours read UDT fields | WITHHELD by name (the door's own "its drawings are not shown" sentence) | DIVERGE "no drawing program" -> DIVERGE, `withheld: pine:object-removal-lost` |
| atr-trailing-stop RDDT / SPY | the info label's text reads an unbounded `ta.barssince` (`pine:function`), its `x` is `timenow` | WITHHELD by name | `withheld: pine:object-ops-refused` |
| pmax-explorer RDDT / SPY | the screener label lists 38 other symbols' states (`request.security` per symbol, `pine:request`) | WITHHELD by name | `withheld: pine:object-ops-refused` |

**Harness.** A drawing the door WITHHELD is a named gap, not a script without a drawing program:
`ourSide.js::drawingWithheldBy` (host lane only) names the object gate's guard, or `pine:object-ops-refused`
when the program kept none of the steps it attempted (drop keys + reader-level names);
`compare.mjs::compareObjects` grades it DIVERGE with `withheld` and the reason - the rule `comparePaints`
applies to a withheld paint. Also renamed on the way: auto-trendline (F1), dual-view-htf-candlestick,
trend-lines-supports-and-resistances. Verdicts unchanged.

**Measured** (worktree `.claude/worktrees/f3`; harness sweep = every capture under `tests/fixtures/vendor`,
285 graded files x 2 door states, `--maxWorkers=1`, node environment):

| | base `3f9c35aebd` | F3 |
|---|---|---|
| member-door census off / on / +runtime | 55 / 80 / 86 | 55 / 80 / 86 |
| object verdict MATCH (on / runtime) | 117 / 133 | **118 / 135** |
| capture verdict MATCH (on / runtime) | 73 / 79 | **74 / 80** |
| MATCH -> anything else | - | **0** |

The one MATCH -> DIVERGE the first cut produced (position-size-calculator: its `tostring(abs(size),
f_tickFormat())` was refused, and TradingView prints `NaN` there) is why a non-literal format is carried
with `na` drawn rather than refused.

**Rails.** `strTostringFormat.vendor.test.js` (25: A tick against 11 vendor labels, B affix against the
zigzag labels, C every withheld case, D translator, E binding, F runtime end-to-end + position-size MATCH);
`vendorHarness.coverageAudit` re-pinned (zigzag RDDT joins MATCH; atr / multicator / pmax controls name the
withholding; zigzag SPY control proves the window; trend-targets control reads objects MATCH); three older
pins re-stated where F3 changed a refusal on purpose (`objectRuntime.test.js` grouping now withheld,
`c33ObjectReads` / `objectForInLoops` use `%` as the still-refused format). Mutations, each red, each
restored by captured bytes (sha checked): tick marker dropped; tick decimals trimmed; affix dropped;
grouping not withheld; unread format drawn; stale tick kept on re-bind; getter grammar not extended;
comparator ignoring `withheld`.

**For RT5 (runtime-native drawing), not built here:** wyckoff-accumulation-distribution (RDDT 12 / SPY 22
boxes: `trendBox := box.new(...)` then `box.set_bgcolor` / `box.set_text` in a `pine:state` script - the
runtime run has no drawing program; its offset barcolor is withheld, a paint); fibonacci-dolphintradebot
(RDDT 7 lines + 7 labels from the zigzag held in `array.new_float` - `pine:collection` - via `var line` /
`var label` registers).

**Open.** (1) multicator's tables could be drawn alone only with `math.round_to_mintick`, `format.volume`
and UDT colour fields on the host lane (value grammar, not drawing) plus a family-scoped withhold of the HUD;
nothing smaller would MATCH. (2) `format.mintick` on a getter (`{t:'val'}`) is still refused; no capture
asks for it. (3) Grouping (`1,234.5`) and `format.mintick` >= 1000 wait for a capture that shows them.

## GT - the runtime pane's switch-on rulings: a per-member stage, the starter allowlist, the runtime cap, and the repaint-label notice (2026-10-02, step 80)

Branch `pine/gt-runtime-switch-on`, base `integrate/wave16-2026-10-02` (`67809e4882`). Implements the
owner's rulings of 2026-10-02 on RF's open decisions (`docs/pine/runtime-pane-switch-on-plan.md`).
**Nothing flipped**: no Railway variable was set, nothing pushed to master or production. The
operator steps, in order, with rollback, are the plan's new section *GT operator steps*.

### What was built

| ruling | server | client | rails |
|---|---|---|---|
| **D1** admins first, then everyone | `PINE_RUNTIME_STAGE` (`off` / `admins` / `all`) read PER REQUEST in `runtime_definitions.stage` / `pane_permitted`, default `off` pinned in source and declared as `PINE_RUNTIME_MODE_FLAGS` (the mode-flag index derives it); an unrecognised value is `off`. Rides `_access_payload` as `pine_runtime_pane_enabled`, resolved for the member (no new endpoint, never raises). The SAVE door asks the saving member the same question: the router passes `user["role"]` into `user_definitions.save(role=...)` on POST, PUT and the shared install; a missing role is a member's | `runtimePaneEnabled()` = build flag (`runtimePaneBuilt`) AND the per-member answer, LATCHED per tab (`latchRuntimePanePermission`, first payload wins, disagreements counted; nothing latched = not permitted). `AuthContext.applyServerFlags` feeds every auth path | `tests/test_pine_runtime_switch_on.py` (D1 block), `engine/__tests__/runtimeSwitchOn.test.js` (D1 block) |
| **D2** runtime cap 128 KiB | `runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES` used by `_save_runtime`; formulas keep `MAX_DEFINITION_BYTES` (64 KiB) | - | trend-targets (83,875 B) saves and reloads identically; a document padded past 128 KiB is refused with the runtime number; a formula between 64 and 128 KiB is still refused at 64 KiB |
| **D3 / D4 / D5** | unchanged by ruling (1,000 ms budget, bar-colour disclosure, 20,000-bar intraday limit) | unchanged | no number moved |
| **D6** starter allowlist | `api/data/pine_runtime_allowlist.json` (adx-and-di-for-v4 only, sha256 `d0853c47...`, evidence named) ∪ `PINE_RUNTIME_ALLOWLIST`, read per call; ids are not entries; empty union = none; unreadable file = nothing (fail closed). An ungraded script is refused at save; a stored one is SERVED stamped `meta.runtimeNotGraded` (never deleted or rewritten); the runtime-kill read carries `allow` | the allowlist is latched from the same read as the kill list (`MemberPane`); `memberPaneDefinition` declines a script not on it right after the kill list as `runtime:not-yet-graded` with the HOST lane's sentence; nothing latched = nothing graded; the install door refuses the server's stamp | both files (D6 blocks); `tests/test_runtime_definitions.py` and `tests/test_runtime_document_round_trip.py` open the two new doors for their own (shape / round-trip) rails |
| **RT4 follow-up** the member is told | `user_definition_relint.member_notice` turns a direction-B finding (stored label LOOSER than today's measurement) into `repaint_notice` on the served row (list and get), memoised per stored version; the stored label is never touched | `BuilderSheet` shows the server's sentence, verbatim, when its owner opens that definition (`data-testid="repaint-label-notice"`) | server: a pre-fix `islast` row carries the notice and keeps `non-repainting`, a stable-leaf row and a fresh save carry none; client: `BuilderSheet.repaintNotice.test.jsx` (rendered text, with a control) |

Also: `tools/runtime_pane_smoke.py` gains check **[5] STAGE** (`--expect-pane on|off`: the smoke
account is an admin, so `off` at stage off and `on`, with the graded script listed, at admins or
all), railed by `tests/test_runtime_pane_smoke.py`. `PINE_RUNTIME_SAVE_ENABLED` and
`PINE_RUNTIME_STAGE` are declared in `docs/feature_flags.json` (`dark`); the first had no entry and
kept `tests/test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared` **red on the
wave-16 base** (measured before any GT edit). `VITE_PINE_RUNTIME_PANE_ENABLED`'s entry now says the
pane needs both halves. `src/test-setup.js` permits the pane and grades every script before each
test, so the lane's own suites keep measuring the lane; GT's rails reset both and measure the doors
in their production state.

### Mutations (each alone; bytes captured and restored, sha verified; unmutated control green)

Server (`tests/test_pine_runtime_switch_on.py`, 30): stage default `all` (red); the stage captured at
import (13 red); `admins` admits members (red); save ignores the permission (red); save ignores the
allowlist (red); the allowlist admits every hash (red); a served ungraded row not stamped (red);
runtime cap = formula cap (red); formula cap doubled (red); the router drops the role (red); the
notice never served (red); a notice on every row (red). Client (`runtimeSwitchOn.test.js`, 15): the
gate ignores the permission (4 red); latch last-wins (1); nothing latched = permitted (4); the door
skips the allowlist (2); an empty list = everything (1); the install door ignores the stamp (1);
MemberPane never latches `allow` (1); AuthContext never latches (1); ids admitted to the allowlist
(1). Notice render removed (`BuilderSheet.repaintNotice.test.jsx`, 1 red).

### Tests (totals lines)

pytest: `test_pine_runtime_switch_on.py` 30 passed; `test_runtime_definitions.py` +
`test_runtime_document_round_trip.py` 38 passed; `test_feature_flag_ledger.py` +
`test_vite_flag_ledger.py` + `test_dockerfile_vite_build_args.py` + `test_visibility_flag_ledger.py`
294 passed; `test_feature_status.py`, `test_charts_list_subscribe_flag.py`, `test_hub_preview_flag.py`,
`test_breadth_dc_flags.py`, `test_user_definition_relint.py`, `test_user_definitions.py`,
`test_runtime_repaint.py` 251 passed; `test_runtime_pane_smoke.py` 7 passed. vitest
(`--maxWorkers=1`): `runtimeSwitchOn.test.js` 15 passed; 11 runtime / object / vendor-harness files
128 passed; 14 more (member-pane doors, kill switch, round trip, library door, `src/context`) 114
passed; a batch of 10 (`runtimePaneSafety.test.jsx`, `runtimeAsync`, `runtimeWallsC23`,
`simpleArgWindow`, `runtimeErrorNotice`, `chartClockNotice`, the kill switch, the round trip, the
library door, `memberPaneGate`) 9 files passed and `memberPaneGate.test.js` timed out at 15 s under
load, then passed alone with `--testTimeout=200000` (two whole-source sweeps over a flag GT does
not touch); `BuilderSheet.repaintNotice.test.jsx` + `BuilderSheet.edit.test.jsx` 22 passed;
`components/screener/reachable.test.js` 17 passed. The shared `node_modules` RF found broken was
whole for this lane (373 entries; jsdom suites ran).

### Open

- The allowlist identity is the sha256 of the source **as written**: a member's copy of
  adx-and-di-for-v4 that differs by one byte (line endings, trailing newline) declines
  `runtime:not-yet-graded`. How often a pasted copy matches the corpus bytes: not measured.
- How many production definitions carry a direction-B label (and so the new notice): not measured.
- A runtime document saved by an admin at stage `admins` stays in the store when the stage returns
  to `off`; it is not drawn (the client gate) and not deleted, by design.
## CAP3 - standing capture lane: the queue captured, and 69 SPY 1D gap captures graded (2026-10-03, step 81)

Lane CAP3, branch `pine/cap3-captures`, base `integrate/wave16-2026-10-02` (`0dffcab3f0`), merged with the wave-16
tip `b65e247685` (H4 + RT5) at `cc50d7d809`.

**Visibility gate.** The first attempt was blocked: the extension's tab group sat in a Chrome window whose active tab
was a plain New Tab, so the rig read `visibilityState "hidden"`; nothing was captured until the owner made the rig
tab active (gate then `visible`, window bottom 7 px over the work area, as recorded before). After a session restart
the new tab group's rig tab read `hidden` again and the lane stopped there (below).

**Route.** Each script went onto the rig (`01f1AcIj`) as an unsaved draft: the editor buffer reset to the untouched
`Create new > Indicator` template and the menu used, source moved in through the OS clipboard into an injected
textarea and written into the editor only when its sha256 equalled the committed file's (read back equal every time;
one wrong expected sha was refused and nothing was written), binding gate (one `Add to chart`, no `Update on
chart`) checked in the same evaluation as the click. Read with `tv_capture.js`; out through the clipboard with the
page receipt (chars + FNV-1a) re-checked on the shell; `verify_capture.mjs --assemble` VERDICT: PASS for every file.
Each study removed after its capture; the rig was left with 0 studies.

**Queue.**

| item | capture(s) | vendor fact | our door |
|---|---|---|---|
| Q-L2a `rolling-vwap` | RDDT 1D (636, listing), SPY 1D (1800) | 7 plots + 1 info table cell ("1M") | runtime + 50-library store: RDDT plots 7/7 MATCH on 636 bars, objects DIVERGE (table drawn with no cell); SPY declined (`runtime:history-start`); empty registry refuses on the import |
| Q-RT5a `vw-rt5-arm-draw-block-history` | RDDT 1D (636) | 308 labels = 308 UP bars; T02 present exactly on UP bars; B01 = previous UP bar's `bar_index`, `na` on non-UP bars and the first UP bar | still refused `pine:drawing` after the RT5 merge (the ternary-arm label) |
| Q-H4a `vw-h4-loops` | RDDT 1D (636), SPY 1D (1800) | L1/L2/L3 equal a hand replay on all 636 RDDT bars (L1 from bar 12, L3 from 2) | runtime (H4 merged): RDDT MATCH 4/4 rows; SPY no column; objects pane alone `pine:block` |
| Q-RT5b `renko-candles-overlay` | RDDT 1D (636), SPY 1D (1800) | 142 / 141 boxes, 2 lines, 2 labels | runtime (RT5 merged): RDDT MATCH (counts, texts, colours on 290 slots, paint); SPY paint MATCH, the run draws nothing (INCONCLUSIVE); objects pane alone `pine:collection` |
| Q-L2b | - | not a capture (v5 library under v6) | - |

**SPY 1D gap list** (`cap3-spy-1d-gap-list-2026-10-03.json`: 71 runtime-state attaches without a SPY 1D capture over
1,000 bars, census with the libraries loaded 55 / 82 / 89). 36 captured (all 1800 bars from 2019-08-06), graded in
the state each attaches in, signatures in `app/.../vendorHarness/cap3-spy-gap-verdicts.json` (written by
`cap3SpyGaps.measure.test.js`, read by `vendorHarness.coverageAudit.test.js` through one `cap3Signature`):
**MATCH 11** - average-day-range-adr-pivots, candlestick-patterns-identified, donchian-channels, engulfingcandle,
extrapolated-pivot-connector, fib-retracement, ict-ipda-look-back, ict-killzones-pivots-tfo,
linear-regression-channel-tradingfinder, liquidation-levels, liquidity-engulfing-candles. **DIVERGE 24**, by family:
converging prefixes (the window does not start at SPY's listing: artemis, atr-bands, atr-trailing-stoploss,
btc-charlie, cumulative-volume-delta, elliott-wave-3, ema-ribbon, keltner-cog, keltner-channels-bands); na-vs-value
(atr-support-and-resistance RSI mid lines, inside-bar Shapes bar 2); barcolor (atr-s&r, atr-trailing-stoploss,
btc-charlie, elliott-wave-3, ema-ribbon, fibonacci-pivot-points, heat-map-seasons, inside-bar notDrawn); objects not
drawn or short (atr-s&r lines 306/0 boxes 54/0, liquidity-heatmap labels 421/0, institutional-smc lines 198/34 labels
449/81, all-chart-patterns lines 100/42 labels 56/22, artemis lines 171/33 labels 198/38, htf-candle-footprint
lines 6/0 labels 3/0 boxes 11/3, k-clustering lines 9/0, contraction-box lines 204/178 boxes 53/54,
high-low-open-mid labels 504/502, auto-trendline 2 drawings with no drawing program); table cells (htf-liquidity
30/3, black-scholes 22/8 - time-dependent expiry, ema-ribbon 48/37, heat-map 31/30, k-clustering 8/5, artemis
21/15); dual-view object texts/colours. **INCONCLUSIVE 1** - adx-and-di-for-v4 (runtime run computes no column on
SPY). Coverage audit with the library store: 125 / 125 green; the signature control was mutation-checked (a changed
count reds it).

**Gap list 37-70** (33 scripts, `supertrend-explorer` skipped - TradingView refuses it, CAP2), captured after the
owner reconnected the rig's "Session disconnected" dialog; gate = visible + nonzero size + chart present, `hasFocus`
recorded as observed (false on most evaluations, true at the end). Same route and receipts; every file 1800 bars,
`verify_capture` PASS. All attach in the objects-pane state. **MATCH 8** - multi-timeframe-supply-demand-zones,
pivot-point-supertrend, position-size-calculator, qqe-signals, rvol, tradingview-alerts-to-mt4-mt5 (both),
ultimate-pivot-points. **DIVERGE 24**: converging prefixes (macd-shortlong 6/6, madrid-moving-average-ribbon 18/18,
momentum-volatility-scanner histo, reverse-stochastic-momentum-index 7/7, zero-lag-ma-trend-levels 4/4); `na`-vs-value
(mcclellan Osc persistent, momentum-volatility-scanner Bullish Shift, pa-zigzag-fibonacci-fan 8/9 fan levels,
trendlines both trendline plots); objects not drawn (options-max-pain lines 24/0 labels 15/0 boxes 13/0,
poor-man's-volume-profile lines 2/0 labels 40/0, sector-rotation lines 55/0 boxes 504/0, smt-divergence lines 504/0
labels 504/0, volume-profile lines 203/0, vold-market-breadth table cells 2/0); objects short (market-structure-by-leviathan
lines 117/21 labels 368/63, pro-trading-art lines 102/13 labels 204/26, vdubus lines 504/272 labels 129/23,
rsi-swing lines 50/43 labels 50/42, liquidity-pools labels 504/254, trendlines lines 52/25, zero-lag labels 51/30,
trend-duration-forecast labels 55/52, price-action-as-in-book lines 502/500, position-size-calc cells 10/9);
objects over (makuchaku FVGs boxes 51/55); object texts/colours only (trend-lines-supports-and-resistances).
**INCONCLUSIVE 1** - opening-range-initial-balance (vendor title "Shapes" not unique, unmapped).

**RT6 queue (Q-RT6a-f)**, RDDT 1D from the listing (636 bars), graded in the runtime state, signatures in
`cap3-rt6-verdicts.json`: kalman-price-filter and deadband-hysteresis-filter MATCH; nadaraya-watson INCONCLUSIVE (Alert
Stream `pine:block`); atr-stepped-pdf-ma INCONCLUSIVE (Long/Short not carried); parabolic-sar DIVERGE (54 labels, no
drawing program); probe `vw-rt6-runtime-colour` colours C01-C05 DIVERGE from bar 0 (ours `#c9a84c`; vendor
`color.new(na,40)` = `#00000099`, `color.new(c,na)` = `#ff525200`, `color.rgb(na,...)` = `#000000ff`), B01 barcolor withheld.

**Instrument finding - a runtime-state grade is wall-clock bound.** `RUNTIME_PANE_TIME_BUDGET_MS = 1000`
(`runtime/runtimeColumns.js`) is applied on the harness's synchronous path too (`runtimeColumns.js:391`), and the
grade of atr-stepped / nadaraya-watson takes ~0.8-1.2 s on this box. Measured: one measure run rewrote atr-stepped's
first plot MATCH -> INCONCLUSIVE ("computeFor returned no column"); a probe flipped it MATCH / INCONCLUSIVE depending on
which capture ran first; one coverage-audit run failed nadaraya's control (INCONCLUSIVE at 1,202 ms) while the browser
lane was capturing. The committed RT6 signatures were kept (never re-blessed from a loaded run). A runtime-state
signature is therefore load-sensitive until the harness runs without the pane budget (or with a fixed `now`).

**Left.** Nothing in the CAP3 queue. F1 / F2 / F3 / GT pushed no capture queue.

## RT6 - per-bar colour on the runtime lane: plot colours, bar colours and backgrounds from the same run (2026-10-03, step 82)

Branch `pine/rt6-runtime-colour`, base `integrate/wave16-2026-10-02` (`fa5cc79f99`, merged forward to `8fbdc5b561`).
Target: H4's measured wall - a runtime row could carry only ONE static colour, so a per-bar colour (`plot(x, color =
cond ? a : b)`, `color.new(<var colour>, t)`, a `bgcolor` / `barcolor` the host could not fold) was withheld, and RF
disclosed runtime bar colours as "not drawn".

### What is carried, and how

1. **The colour is computed by the run that computes the value.** `pineRuntimeFrontend.js::describeColour`: for
   `plot` / `plotshape` / `plotchar` with a `color =` (named, or `plot`'s positional third), the colour expression is
   lowered in the call's own statement position into an output `{call: 'colour', of}`; the plot's descriptor carries
   `colour: {output}` (or `colour: {refused}` - fail-soft, the script still builds). OPT-IN (`opts.plotColours`, asked
   only by `runtimeColumns.js`' probe and compute), and the colour outputs take their indices AFTER every other output,
   so no stored `compute.outputs` index moves. Paint outputs (`bgcolor` / `barcolor`) already were the colour; their
   descriptors now carry `line`, `transp` and `colourOpaque`.
2. **The document names a colour column.** `memberPaneDefinition.js::runtimeRowPresentation` / `runtimeRowColour`: a row
   the host marks per-bar (`colorDynamic`, two-colour, palette, gradient) gets `colorMode: 'column:<k>'` +
   `colorPacked: {transparency?}`, where `<k>` is a hidden row mapped to the colour output. Paints: each host paint
   record (`t.presentation.paints`) is paired with the run's paint output of its kind by source order; drawn paints ride
   `definition.paints` with the same `colorPacked`. `defSchema` admits `colorPacked` (plot, fill and paint) and refuses
   a malformed one by name.
3. **Drawn by the host renderer.** `pool.columnColorsForPlot` answers `{packed}`; `binder.pointColour` ->
   `pool.packedPointColour` turns the packed `0xTTBBGGRR` into `#RRGGBB(AA)` through the one byte order
   (`packedToObjectHex`). A run `na` colour: no colour for a paint or fill (unpainted), a transparent point for a plot
   (TradingView hides a plot point whose colour is `na`; the host palette's `na` entry draws the same).
4. **Transparency rules, each from a witness.** A style transparency folds into an OPAQUE colour only - the vendor fold
   (`compare.mjs::withStyleTransparency`), alpha `round((100 - t) * 255 / 100)` in integers (floating point gave 25 for
   `transp=90` where the fold reads 26). `transp =` as written; a v3/v4 `bgcolor` with none takes **90** (CAP round 4,
   `vw-bgcolor-v4-default-spy-1d-2026-10-02`, `styleState` T1/T3). A transparency is applied only over a colour PROVABLY
   opaque on every bar (`opaqueColour`: a 6-digit literal, a named colour, `color.rgb` of three, an `input.color` / v4
   `input` default of one, a ternary of such or `na`); otherwise the row / paint is withheld by name.
5. **The later `barcolor` wins within one script** (`binder.syncPaints`): CAP round 4's P1/P2 screenshot
   (`docs/pine/vendor-harness/cap-round4/vw-bgcolor-barcolor-spy-1d-2026-10-02.png`) shows P2 painting over P1. Two
   different scripts that disagree on a bar still leave it its own colour (`conflicts`) - no capture says which wins.
6. **`color.new` / `color.rgb` over `na` are `na`** (`runtime/colours.js`). They answered transparent black at the
   requested transparency - a visible shade where Pine holds the `na` colour. Unwitnessed; queued (Q-RT6a C03-C05).
7. A v4 generic `input(defval = <colour>)` is a colour on the runtime lane (parabolic-sar's `colup` / `coldn`), lowered
   to its default as `input.color` already was.

**Withheld by name:** a `plotshape` / `plotchar` whose colour changes per bar (the marker layer reads two colours, not a
column); a script below v4 (no capture of its colour rules); an unread `transp`; a transparency over a colour that may
carry its own; a colour this lane could not compute; every paint the host withheld for a reason other than its colour
(`offset`, `show_last`, `display`, an argument it cannot read) - the run computes a colour, not where TradingView draws it.

### Graded

| capture | before (integrate, runtime pane permitted) | RT6 |
|---|---|---|
| fvg-trend RDDT 1D (listing) | refused | `fvgCounter` MATCH with colour compared; `bgcolor(..., transp=90)` **agree**; overall INCONCLUSIVE only for `plot(0, color=color.black)` (a constant, hidden by the host on both lanes) |
| inside-bar-range RDDT 1D (listing) | DIVERGE (paints notDrawn / withheld) | **MATCH**: both barcolors agree on 632 / 632 (83 / 76 painted) |
| inside-bar-range SPY 1D (not from the listing, CAP3) | DIVERGE | DIVERGE: each barcolor differs on **1** of 1,800 bars (bars 0 and 2: TradingView paints, ours `na`), the seed bar where the routed document's plot already reads `na` against TradingView's 1 |
| trend-targets-algoalpha RDDT 1D (listing) | DIVERGE (barcolor notDrawn) | barcolor **agree**; `Baseline` now drawn: colour 0 mismatches of 414 compared, its VALUE diverges on 82 bars (`na` at bar 140, converging to 1e-9 by bar 221, maxRel 3e-4) - a seed defect of the run, pinned in `vendorHarness.coverageAudit` |
| vw-deadband-ticks AAPL / SPY 1D | DIVERGE | INCONCLUSIVE: `DBHF` MATCH (11,534 / 8,473 bars), barcolor agree; left only `D01_mintick` (not carried) |
| vw-deadband-ticks BRK.A 1D | DIVERGE (barcolor withheld) | DIVERGE (barcolor notDrawn): the run computes no column on this window, so neither plots nor paint draw |

Harness dir (295 captures, runtime pane PERMITTED - see the instrument note): **MATCH 86 -> 87, DIVERGE 94 -> 91,
INCONCLUSIVE 115 -> 117; 0 MATCH -> DIVERGE.** The five loop scripts with no capture are held to HAND REPLAYS of their
colour rule over the run's own value column on NYSE:RDDT's 631 listing bars (`vendorHarness.rt6RuntimeColour`):
kalman (`color.new(barColour, 40)` and its barcolor, every bar), deadband (same shape from `input.color`s),
nadaraya-watson (the rate rule, `smoothColors` off), atr-stepped (`contSwitch` replayed from the stepped line;
`colorbars` off so no paint), parabolic-sar (the SAR replayed whole - value and colour - v4 palette). Each replay shows
both colours on more than 20 bars. Captures queued for CAP3: `docs/pine/capture-queue-2026-10-03-rt6-colour.md` (Q-RT6a
probe `tools/visual_conformance/probes/vw-rt6-runtime-colour.pine`, Q-RT6b-f the five scripts).

### Measured

| | integrate (`a572cdd7af`, RT6 files at their bytes) | RT6 tip |
|---|---|---|
| member door off / on / on + runtime | 55 / 80 / 87 | 55 / 80 / **93** |
| rows moved | - | attach: atr-stepped-pdf-ma-loxx, deadband-hysteresis-filter-backquant, fvg-trend, kalman-price-filter-backquant, nadaraya-watson-rational-quadratic-kernel-non-repainting, parabolic-sar (each `runtime:withheld-all` -> attached, 1 plot); trend-targets plots 4 -> 5; auto-harmonic-patterns and linear-regression-channel stay declined at their next wall (`pine:colour-value` -> `pine:builtin` / `runtime:na-test`); off and on: 0 rows; 0 attaches lost |

Mutations (bytes captured, restored, sha verified; `git status` clean after): colour output never emitted, door ignores
the run colour, `na` colour drawn as the series colour, style transparency ignored, v4 default 90 dropped, the opacity
guard removed (plot, and paint), `color.new` over `na` a colour again, later barcolor no longer winning, paints not
carried, colour outputs not appended last, schema accepting any transparency: **14 of 14 red** (three survived the first
pass and got rails: `paintRender`'s packed `na` point, and fvg-trend source variants in `vendorHarness.rt6RuntimeColour`).

**Fixture:** `tests/fixtures/runtime_documents/documents.json` re-minted from the door (RT6 changes inside-bar and
trend-targets; wyckoff is now an objects-only runtime document with an EMPTY `compute.outputs` - its 8 markers are
withheld for `offset` (H4) and RT5 draws its objects). The server's `test_runtime_document_round_trip` reds on that
wyckoff entry (`repaint_stamp` of no outputs); `runtime_definitions.validate` would refuse it too ("required non-empty
object"). Not RT6's - H4 x RT5 - but surfaced by this re-mint.

### Instrument note (GT)

Since GT, `src/test-setup.js` permits the runtime pane in a `beforeEach`. `vendorHarness.corpus.test.js` grades the
whole directory at COLLECTION time (`const run = runHarness(dirs)` in the `describe` body), before any `beforeEach`, so
the harness CLI now grades with the runtime pane NOT permitted whatever `VITE_PINE_RUNTIME_PANE_ENABLED` says (measured:
295 captures, identical MATCH 77 / DIVERGE 84 / INCONCLUSIVE 134 at tip and base). The numbers above come from the same
`runHarness` called inside an `it`.

### Open

- GT: the harness CLI grades without the runtime permission (above).
- H4 x RT5: wyckoff's runtime document has no drawn row; the store and its round-trip rail refuse it.
- RT: the run's seed on trend-targets' `Baseline` (bar 140 `na`, converging prefix) and on inside-bar-range SPY bar 2.
- A per-bar colour on a `plotshape` / `plotchar` (needs a per-point colour in `markerPrimitive.markersFor`), and a fill's
  colour on a runtime document (the runtime lane emits it; the document carries no runtime fill yet).
- CAP3: Q-RT6a-f.
## F4 - the CAP3 SPY 1D drawing and table divergences: window, collector cycle, and two engine bugs (2026-10-03, step 85)

Lane F4, branch `pine/f4-spy-drawings` (from `integrate/wave16-2026-10-02` `8fbdc5b561`). Brief: the DRAWING and TABLE
divergences CAP3 pinned on AMEX:SPY 1D (1,800 bars from 2019-08-06, not from SPY's 1993 listing); classify each as a
window effect, a collector difference or an engine bug; fix to MATCH or withhold by name. Rail:
`vendorHarness.f4SpyDrawings.test.js` (20 tests; 2 need the library store).

**How a window is proved here (stronger than F3's price test).** The capture's `id` is TradingView's ONE creation counter
across lines, labels and boxes, and ours (`nextId`) is too. Where every object we hold is TradingView's at one fixed id
offset (same family, caption and price), the objects we lack with ids below that offset were made before our bar 0.
SPY's `bar_index` of our bar 0 is read off TradingView's own control row in `vw-offset-na-spy-1d-2026-09-30` (8175 on
2025-07-23, which is our bar 1498): **SPY bar 6677**. Where a script makes one object per bar, the offset and Pine's
collector (cap + 5, oldest go until cap; `objectRuntime.js::collect`) then predict both sides' counts from creation
totals alone.

| script | CAP3 objects (vendor/ours) | class | F4 | proof / owner |
|---|---|---|---|---|
| all-chart-patterns-theeccentrictrader (library) | lines 100/42, labels 56/22 | ENGINE, two bugs | **FIXED -> whole capture MATCH**, 156/156 objects TradingView's id for id | (1) the linker spelled a library value and a library function of one name (`PubLibTrend/3`: `rlut = rlut()`, `dt`, `ut`, `rldt`) as ONE mangled name, so `tr.rlut()` read as a call of a value (`pine:function __lib3_rlut`) and every pattern guard built on those trends was refused (184 updates, 20 captions); `pineLibraries.js::mangleValue` spells the value `__lib<n>_<name>__value` only where the unit also defines a function of that name. (2) `label.new(..., text = na)` printed `NaN`; TradingView holds `""` (8 labels in this capture); `textNodeOf` reads a bare `na` text as the empty string (`str.tostring(na)` still prints `NaN`, F3) |
| contraction-box-doji-lines | lines 204/178, boxes 53/54 | WINDOW (collector cycle) | pinned | 231 of our 232 objects are TradingView's at id + 7345; the 26 we lack have ids <= 7345 (all lines); `box.new` runs every bar, so 7345 - 6677 = 668 doji lines came before; the collector gives held(668+178, 200) = **204** and held(6677+1800, 50) = **53**, ours held(178, 200) = 178 and held(1800, 50) = **54**: all four counts from arithmetic; our one extra is our oldest box. RDDT MATCH |
| high-low-open-mid-ranges | labels 504/502 | WINDOW (collector cycle) | pinned | all 1005 objects we hold are TradingView's at id + 92609; the 2 it holds beyond ours (`LO / 529.57`, `LM / 528.895` captions) are its two oldest; both counts sit inside the [500, 505] band of max_labels_count = 500. RDDT MATCH 504/504. Not derivable exactly (labels are deleted per bar, so the cycle depends on the whole history) |
| artemis-oscillator-pro | lines 171/33, labels 198/38 | WINDOW | pinned | our 71 objects are TradingView's 299..369 exactly; its other 298 have ids <= 298 and ALL lie wholly below the window's lowest low (218.26). RDDT 13/13, 17/17 |
| artemis-oscillator-pro | table cells 21/15 | ENGINE (runtime wall) | withheld by name | 5 cells `cell:text` (AOP score, trend, confidence, bar, `N bars` read the KNN state; `runtime:call-windowed-state`); RDDT 21/16, same cause. Owner: RT7 |
| institutional-smc-order-flow-matrix-pro | lines 198/34, labels 449/81 | WINDOW + owner-gated warm-up + converging prefix | pinned | 116 of our 118 pair in order by value; the 2 unpaired are ITH/ITL badges at `high[k] + atr * 0.25` on bars 31/41 whose RMA has not converged (TradingView's twins sit < 0.01 away; F2's class); of the 532 vendor objects we lack, 474 lie wholly outside the window's price range and the other 58 are ranked before our bar 250 (pre-window or inside the `PINE_STATE_WARMUP` curtain C16 pins on RDDT; the dense rank cannot separate the two); **none was made after the warm-up**. RDDT MATCH |
| atr-support-and-resistance | lines 306/0, boxes 54/0 | ENGINE (+ window on top) | withheld by name (C45) | the four extend/break loops read a float array (`guard:loop` `pine:block`), so every zone is withheld (`geometry:lost`); RDDT is 20/0 + 20/0 for the same reason; 219 of SPY's 306 lines lie below the window anyway. The runtime lane draws these zones (RT5's direct run agrees on RDDT) but a host-attached script never reaches it. Owner: runtime objects (RT lanes) |
| liquidity-heatmap-nephew-sam | labels 421/0 | ENGINE (+ window) | withheld by name | all 14 label creates read lower-timeframe requests (`guard:create` `pine:request`); 305 of 421 lie below the window. Owner: H5 (requests) |
| htf-candle-footprint-cartel-console | lines 6/0, labels 3/0, boxes 11/3 | ENGINE | withheld by name | the levels read a UDT field (`pine:type` `HL.size`; runtime `runtime:loop`); the 3 boxes we draw ARE TradingView's (id + 5, same prices). Owner: RT7 |
| k-clustering | lines 9/0; cells 8/5 | ENGINE (budget) | withheld by name (C18) | the last bar needs 800,613 VM instructions over `INSTRUCTIONS_PER_BAR` 200,000, same on RDDT; raising a budget is RT7's |
| htf-liquidity-dashboard-tfo | cells 30/3 | ENGINE | withheld by name | the dashboard rows read 9 other symbols (`cell@135-137 pine:request`; AUDUSD, ES1! ... have no captures); lines 6/6 and labels 6/6 agree. Owner: H5 |
| ema-ribbon-trend-filter-strixedge | cells 48/37 | ENGINE | withheld by name | 11 cells `cell:text` read 15/60/240-minute requests (`lower-tf:store-unmeasured`). Owner: H5 / lower-tf lane |
| heat-map-seasons | cells 31/30 | ENGINE (colour) | withheld by name (C45 held colour) | the gauge cell's bgcolor runs `ta.highest` in one arm of `?:` (`fn:conditional-history`@43), so the cell is held, not painted. Owner: RT6 (runtime colour) |
| auto-trendline-dojiemoji | 2 drawings | ENGINE | already withheld by name | `pine:object-removal-lost` (line.delete); the RDDT capture is F1's |
| dual-view-htf-candlestick-patterns-theultimator5 | texts / colours | ENGINE | already withheld by name | `pine:object-removal-lost` (coll:diverged, guard:copy/delete/loop, loop:bounds) |
| black-scholes | cells 22/8 | clock | left (brief) | regenerating the signatures moved its cell count 8 -> 6 (the hour the measure ran); the rail strips that count (`WALL_CLOCK`) |

**Measured** (worktree `.claude/worktrees/f4`, `--maxWorkers=1`, library store loaded unless said):

| | base `8fbdc5b561` | F4 |
|---|---|---|
| harness sweep (328 graded files under `tests/fixtures/vendor`): capture MATCH, objects pane on / + runtime | 85 / 95 | **86 / 96** |
| object verdict MATCH, on / + runtime | 137 / 161 | **138 / 162** |
| MATCH -> anything else | - | **0** (only all-chart-patterns SPY moved, both states, DIVERGE -> MATCH) |
| member-door census off / on / + runtime (libraries) | 55 / 82 / 90 | 55 / 82 / 90, 0 rows changed |
| census, empty registry | not measured on base | 55 / 80 / 87 |

**CAP3 signatures** regenerated with `cap3SpyGaps.measure.test.js` (store loaded): all-chart-patterns DIVERGE (lines
100/42, labels 56/22) -> **MATCH**; black-scholes tableCells 8 -> 6 (wall clock, unpinned by design). No other row moved.

**Rails.** `vendorHarness.f4SpyDrawings.test.js` 20 (18 + 2 store-only); `ast/pineLibraryValueFnName.test.js` 4 (a
fixture library and a second library importing it, both lanes and the object guard, plus the control that a value with
no function of its name keeps its old spelling); `vendorHarness.coverageAudit` 125 / 125 with the store, 118 + 7 skipped
without. Mutations, each red, each restored by captured bytes (sha checked): the value spelled as the function again
(2 of 4 red: host lane and object guard; the runtime lane already linked it correctly); the bare-`na` text rule removed
(the `text = na` rail red).

**Open.** (1) atr-support-and-resistance: serving its zones needs float arrays on the host object lane or the runtime
lane drawing a host-attached script's objects; both are runtime-lane routing decisions. (2) heat-map's gauge: a `ta.*`
window over the bars one arm of `?:` ran (RT6). (3) `src/__tests__/sourcesAreText.test.js` failed twice in seven runs,
both times only when the run took 28-38 s on a loaded box; it passes alone in about 2 s on the same tree.
## RT7 - the runtime lane's next walls: measured reductions, per-call-site two-input state, fixnan, and a 5x faster VM (2026-10-03, step 83)

Branch `pine/rt7-runtime-walls`, base `integrate/wave16-2026-10-02` (`b65e247685`), merged with the wave-16
tip `e3b87af31b` (F2/F3/GT/RT6/CAP3) before the final census. Runtime pane still dark.

### 1. `array.max of an empty array` (RT5's wyckoff stop) - settled from a capture (`edc1049ba2`)

`vw-array-na-spy-1d-2026-10-02` (probe `vw-array-na.pine`, Q-C47-3, captured by CAP2) already answered
the neighbouring questions: over `(3, na, 1, 2)` `array.min/max/sum/avg` read `1 / 3 / 6 / 2` (na
SKIPPED; avg of the three real elements), `array.min(na, na)` is `na`, `indexof(a, na)` is `-1`,
`includes(a, na)` is false, v6 `array.get(a, -1)` is the last element, and the artemis-style KNN vote
over na distances runs. The runtime lane now answers exactly those (`collections.js::realsOf`,
`indexOfValue`, v6 negative index via `budget.pineVersion`), and `rt7ArrayNa.test.js` runs the probe
text on the capture's bars: all 12 rows equal TradingView on every bar. An EMPTY array under
`array.max/min` has the same zero real elements as N05, and TradingView demonstrably does not stop on
it (wyckoff's `myhigh/mylow` reduce an empty array while `boxlen` is na; TradingView draws through
those bars): served as `na`. `array.sum/avg` over zero real elements stay a named stop (unmeasured;
Q-RT7a). **wyckoff RDDT: the run now draws its 12 boxes, top/bottom/text equal to the capture and
x-ranks equal** (`vendorHarness.rt7Walls`); coverageAudit's objects verdict for it is MATCH (overall
still DIVERGE on the offset `barcolor`, withheld by name). artemis' KNN vote as written now reads
TradingView's `80%`. On 5,000 AAPL bars wyckoff stops on `LOOP_ITERATIONS` (run-wide 100,000) by name.

### 2. `ta.valuewhen` / the cross family inside a function (`10d4e9545a`)

`OP.CARRIED2` had no frame-relative base. The two-input store is now materialised per call site
(`carried2Base`, as `carriedBase`). Graded against a hand replay and against the same calls at top
level (`rt7Carried2InFunction.test.js`); williams-fractal and boom-hunter move to their next walls
(`pine:text-value`, `security`). Also: a `ta.pivothigh/low` `rightbars` a call site, input or
constant fixes is folded (`constValueOf`) instead of refused "write it as a plain whole number", and
the canonical `x[k]` reaches this lane in its own parse shape (a literal `R > 0` in a function body
was refused "a bar offset counts backwards"); such pivots over runtime state stop on their true wall
(`runtime:history-expression`), by name (`rt7PivotRightbars.test.js`). A pivot over runtime state
needs its own committed series: not built.

### 3. `fixnan` (`0dc53226fd`)

Pine's `fixnan(x)` on the runtime lane as a carried cell (`CARRIED.fixnanPine`, runtime-only, per
call site), owned at arity 1 (`RUNTIME_PINE_TWINS`). Graded against a hand replay of the reference
sentence (`rt7Fixnan.test.js`); capture queued (Q-RT7b). The two hg trendline scripts move to
`pine:undefined` (`l1`, a `var line` inside HoanGhetti/SimpleTrendlines' `new()`).

### 4. Performance (`d289bcc940`) - the budget stays; the runtime is faster

Profiled (`rt7Perf.measure.test.js`, inspector profile): `execute` was 40-55% and `etClockParts`
(Intl.formatToParts per bar) up to 18%. The VM's `switch` labels were `case OP.X:` - each a property
load and a compare in a linear scan of 56 labels per instruction; they are now named Smi literals
(`case 13 /* OP.DIV */:`), so V8 uses a jump table, held to `OP` by `rt7VmDispatch.test.js`. The ET
clock parts are kept per UTC hour. Median of 7 on the last 5,000 AAPL daily bars from the listing:

| script | before | after |
|---|---|---|
| renko-candles-overlay | 797 ms | 214 ms |
| fibonacci-dolphintradebot | 1,079 ms | 221 ms |
| trend-targets-algoalpha | 576 ms | 84 ms |
| adx-and-di-for-v4 | 162 ms | 34 ms |
| inside-bar-range | 171 ms | 33 ms |

Every column and object digest identical before/after; harness sweep identical entry for entry.

### Measured

| | before | after |
|---|---|---|
| member door off / on / on + runtime (libraries loaded, wave-16 tip) | 55 / 82 / 99 | 55 / 82 / 99, **0 lost, 0 gained** |
| runtime rows moved to a later wall | - | 7 (boom-hunter, market-structure-inducements, neural-network, two hg trendlines, strength-of-divergence, williams-fractal) |
| harness dir, objects off / on (merged tree, 328 entries) | 61/71/191 ; 84/89/150 MATCH/DIV/INC | identical, entry for entry |
| harness dir, runtime pane permitted (scratch sweep, merged tree) | MATCH 94 / INC 133 / DIV 96 | MATCH 94 / INC 133 / DIV 96; one entry changed: wyckoff RDDT objects INCONCLUSIVE -> **MATCH** (overall stays DIVERGE, the offset barcolor) |
| renko-candles-overlay RDDT (CAP3 capture) through the runtime door | MATCH | MATCH (2/2 items, objects MATCH) |
| 5,000-bar run, renko / dolphin | 797 / 1,079 ms | 214 / 221 ms |

### Rails and mutations

`rt7ArrayNa` (5), `rt7Carried2InFunction` (3), `rt7PivotRightbars` (3), `rt7Fixnan` (3),
`rt7VmDispatch` (4), `vendorHarness.rt7Walls` (2); re-pinned: `arrays`, `methodsAndArrayMembers`,
`c47SimpleSwitch` (the KNN vote now runs and reads 80%), `coverageAudit` (wyckoff), `runtimePaneSafety`
(named-stop fixture is `array.sum` of an empty array), `carriedState` (two runtime-only members).
Mutations, each restored from captured bytes and sha-verified: carried2Base ignored in the VM (3 red);
carried2 locals pushed to main (3 red); rightbars fold off (2 red); canonical offset shape reverted (2
red); one dispatch literal changed (1 red); fixnan step returns its input (2 red).

### Open

- Q-RT7a/b (`capture-queue-2026-10-03-rt7-empty-reduce-fixnan.md`): empty / all-na `sum`/`avg`; fixnan.
- `vendorHarness.corpus.test.js` runs `runHarness` at collection time, before GT's `beforeEach` permits
  the runtime pane, so since GT its runtime state grades nothing through the runtime door (measured:
  on == runtime entry for entry); RT7 measured with a scratch harness that permits first.
- Not attacked, each measured to stop again behind it (substitution probe): `runtime:switch`
  (lower_tf), method overloads, `export enum` with values, `timeframe.in_seconds/from_seconds`,
  `input.time/timeframe/enum` (next: `timestamp`, `chart.right_visible_bar_time`, `map.new`, ...),
  the `ta.cci` source role (next: `pine:block`, `array.sort`), `ticker.heikinashi` (next: `haopen`
  in the library), `chart.left_visible_bar_time` (refused by name, `pine:builtin`).
- Five corpus measure tests time out at 15 s under load (pre-existing: also at `b65e247685`).

## H5 - host-lane values: default parameters, a listing's period anchor, a request timeframe through a parameter, `round_to_mintick`, `format.volume` (2026-10-03, step 84)

Lane H5, branch `pine/h5-host-values`, base `integrate/wave16-2026-10-02` (`a66bae77b7`), merged
with the wave-16 tip `c91e9fe3c8` before the final census. Target: the host (columnar) translator's
next walls, plus F4's request-held drawings. One construct per commit.

### Census at base (`memberDoorCensus`, off / on / on + runtime)

Empty registry **55 / 80 / 87**; libraries loaded **55 / 82 / 90**. First refusals at H5's codes
(objects on): `pine:function-def` 4 (empty registry) / 6 (libraries), `pine:request` 18. Every
refusal of every script was read off `translatePine` with the door's options before building. The
four empty-registry `function-def` scripts (blackflag, boom-hunter, macd-with-filter,
optimized-trend-tracker) refuse for a function that ends in no value, not for defaults, so the
default-parameter construct attaches none of them; it moves first walls and makes graded captures
draw on the host lane.

### What H5 served

| commit | construct | outcome | evidence |
|---|---|---|---|
| `8579b64f75` | `interpret.js::periodAnchorMask` (+ `ast_interpret.py`) withheld the reach of "the bar before the series" even FROM THE LISTING | from the listing (ruling R-W, `opts.historyFromListing`) there is no earlier bar, so a read there is Pine's `na`, as `historyReadMask` already ruled; off the listing unchanged | `vendorHarness.h5ListingAnchor`: `vw-library-import-rddt-1d` L03/L04 (`var` maxima reset at a new month/week) at the top level, 636/636 MATCH (was 385 matching, 251 `na`); control off the listing keeps 385 / 251 in warm-up. `c49CapturedClock` re-pinned: SPY's new-period events are served and equal on bar 0. Parity fixture +2 cases. Mutations: JS 4 red, Python 2 red. Sweep: 0 verdicts changed |
| `71ca1694c5` | `pine:function-def`: a user or library function whose parameters declare DEFAULTS | the plot lane reads the header (C47 confined it to the drawing lane to protect parameter ids; since C46 an id is the input's place in the source, so that hazard is gone). ONE default rule for both lanes, `pine.js::paramDefaultShapeOk` (a literal, a dotted built-in constant, a bar series); the runtime frontend imports it instead of keeping its own copy. A bar-series default that the caller's or the declaring scope rebinds is refused by name. A required parameter behind an optional one is read (only trailing omissions are filled; arity still enforced) | `vendorHarness.h5DefaultParams`: `vw-default-param-spy-1d` D01-D15 MATCH on 1,800 bars with the runtime pane OFF (control `k = 8` DIVERGES on D01 only); Q-L1 with the L2 fixture library, 7 plots MATCH on 636 bars on the host lane (control `source = low` DIVERGES on L05 only). `runtimeParamDefaults` now holds the host lane's columns equal to the forced runtime lane's. Mutations: 16 / 6 / 1 / 2 red. Census unchanged; first walls moved: adaptive-trend function-def -> block, atr-stop-loss function-def -> builtin (`syminfo.type`), volatility-stop-mtf tuple -> state, supertrend-relative-volume tuple -> timeout. Sweep: vw-default-param objects None -> MATCH (still INCONCLUSIVE overall: D00 withheld for `bar-index:window`) |
| `0df971ee42` | `pine:request`: `f(string tf) => request.security(<own symbol>, tf, ...)` called with a literal or an input | the plot lane reads the parameter as its caller's argument (C33 did this on the object pass only, for the same parameter-id reason). An unservable timeframe keeps `pine:request` (control `f("3D")`) | `vendorHarness.h5RequestParam`: `average-day-range-adr-pivots-rddt-1d` with the runtime pane OFF, MATCH, 7 plots x 632 bars. `c33ObjectReads` re-pinned. Mutation red. Census 55 / 80 / 87 -> **56** / 80 / 87 (libraries 55 / 82 / 90 -> 56 / 82 / 90); camarilla request -> window, advanced-custom request -> block. Sweep: ADR (off) INCONCLUSIVE -> MATCH |
| `7d12c5cbb8` | `math.round_to_mintick(x)` on the host lane | resolved in `resolveTableCall` as `math.round(x / syminfo.mintick) * syminfo.mintick`, so the tick is the binding's like every `syminfo.mintick`, and the host lane and RT5's runtime desugar compute the same thing | `vendorHarness.h5MulticatorValues`: a probe printing multicator's cell expressions (open, close, SMA 50/100/200, EMA 50, RSI 14, ATR 14) through `str.tostring(math.round_to_mintick(v))`, run through the member door on `multicator-table-{rddt,spy}-1d`'s own bars: all 8 equal TradingView's text on both symbols (control: plain `math.round` differs). Mutation 2 red. Sweep and census unchanged |
| `7a8404c9f7` | `str.tostring(x, format.volume)` | read only where captures pin it (`pineTextFormat.js::volumeNumberText`): magnitude in millions or billions, three decimals, the third decimal non-zero, minus sign first. Below a million, a trailing zero, an exact tie, a unit roll-over and >= 10^12 are WITHHELD. `format.percent` stays unread (F3's rule) | witnesses, each our own computation on the capture's bars against TradingView's printed cell: RDDT volume 3,125,951 -> `3.126M`, SPY 46,335,295 -> `46.335M`, RDDT OBV from the listing -29,983,517 -> `-29.984M`; SPY `10.801B` pins the suffix. Through the door the volume cell prints TradingView's text on both symbols; the OBV cell is not drawn (`ta.obv` is not served on this lane, so it is dropped, never printed wrong). F3's `format.volume` pins re-stated on `format.percent`. Mutations: trailing-zero rule dropped 1 red; renderer bypassed 2 red |

### Refused on purpose: F4's request-held drawings and the rest of the 18

Rule: a request whose data we do not hold stays refused. Each request was read for what it resolves
to:

- **liquidity-heatmap** (14 label creates): every guard reads `resolutionInMinutes("3" | "240")`,
  a request with `timeframe.multiplier` inside it. `3` is not a timeframe this store builds
  (`LOWER_TF_SOURCE` has no `3`), `240` is behind the intraday gate (`lower-tf:store-unmeasured`),
  and `timeframe.*` read inside a request is unmeasured. Not served; Q-H5b queued
  (`vw-h5-request-timeframe-text`).
- **htf-liquidity** cells: AUDUSD / EURUSD / GBPUSD / USDJPY and other symbols with no capture.
  Data not held.
- **ema-ribbon** cells: 15 / 60 / 240-minute requests, all `lower-tf:store-unmeasured`. That is the
  product's intraday data gate, not a translator construct.
- Others left at `pine:request`: other symbols (4c-nyse `USI:`, ad-line `SP:`, sub `INDEX:`,
  swing-points / open-interest computed BINANCE symbols, previous-n-days `tickerid(..., session)`),
  lower timeframes behind the intraday gate (mtf-dashboard, multi-timeframe-rsi, take-profit,
  multi-timeframe-trend-indicator), and computed timeframes (cppivot's ternary, delta-volume's
  `tostring(size)`, camarilla-screener).

### Measured

| | base `a66bae77b7` | after H5 (pre-merge) | merged with `c91e9fe3c8` |
|---|---|---|---|
| member door off / on / + runtime, empty registry | 55 / 80 / 87 | **56** / 80 / 87 | 56 / 80 / 96 |
| same, libraries loaded | 55 / 82 / 90 | **56** / 82 / 90 | 56 / 82 / 99 |
| previously attached lost | - | **0** | - |
| `corpusMetric` host / screener | 77 / 66 | 77 / 66 (three rows' first guard changed) | - |
| harness sweep | - | per commit: 0 MATCH -> DIVERGE | merged baseline (368 captures) off 73 / on 95 / runtime 107 MATCH; libraries 73 / 96 / 109 |

The merged-tree column moves because of the lanes merged in, not H5's commits. `paramIds.test.js`
green at every commit (nothing appended). Known reds left as found, all red identically on the base
bytes: `vendorHarness.capRound4` (6, the Q-O1 pins), `pineProbeReplay`'s budget-step hash
(72s-hull, adaptive-trend), `pineStrictCensus` (15 s timeout).

### Open

1. **`pineProbeReplay`**: adaptive-trend's step count moves with the default-parameter admission
   (more of it translates). Re-pinning the table is the integrator's call; the rail was already
   red at base.
2. **Q-H5a / Q-H5b** (`docs/pine/capture-queue-2026-10-03-h5-values.md`): `format.volume` below a
   million and with trailing zeros; `timeframe.*` inside a request at W / M / 240 / 3.
3. **multicator-table** still cannot be drawn: its cells now compute correctly on the host lane,
   but the whole drawing is withheld for the HUD's lost removals (`pine:object-removal-lost`), and
   colour cells read `ThemePalette` UDT fields, which H5 did not attempt.
## F6 - the second CAP3 SPY 1D batch of drawing divergences: window, collector, one engine fix, owners named (2026-10-03, step 88)

Lane F6, branch `pine/f6-spy-drawings-2` (from `integrate/wave16-2026-10-02` `c91e9fe3c8`). Brief: the DRAWING divergences of
the second CAP3 SPY 1D batch (1,800 bars from 2019-08-06, not from SPY's listing), classified by F4's method. Rail:
`vendorHarness.f6SpyDrawings.test.js` (31 tests, no store needed).

**Two pairing methods.** Where every object we hold is TradingView's at one fixed id offset (same family, caption, price),
that offset is the proof (F4). Where the ids drift, pairing is IN ORDER: a longest common subsequence over family, caption and
price. Every object we hold paired in order, plus "what only TradingView holds is its OLDEST of each family", is the window.

| script | CAP3 objects (vendor/ours) | class | F6 | proof / owner |
|---|---|---|---|---|
| makuchaku FVGs | boxes 51/55 | WINDOW (collector cycle) - not a wrong drawing | pinned | all 51 vendor boxes are ours at id + 2096; our 4 extra are our 4 oldest. The script makes only boxes, so TradingView's ids 2701..2751 ARE its box count: 2,751 since the listing, ours 2,751 - 2,096 = 655. Collector: held(2751, 50) = **51**, held(655, 50) = **55**. RDDT MATCH |
| pro-trading-art | lines 102/13, labels 204/26 | WINDOW | pinned | all 39 ours at id + 267; its 267 others have ids <= 267, 234 wholly outside the window's prices. RDDT MATCH |
| rsi-swing | lines 50/43, labels 50/42 | WINDOW | pinned | all 85 ours at id + 360; its 15 others predate our first object. RDDT MATCH |
| price-action-as-in-book | lines 502/500 | WINDOW (collector) | pinned | all 507 ours at id + 3768; 2 older vendor lines. RDDT MATCH |
| trend-duration-forecast | labels 55/52 | WINDOW | pinned | all 53 ours at id + 887; 3 older vendor labels. RDDT MATCH |
| liquidity-pools | lines 504/502, labels 504/254 | WINDOW + collector | pinned | all 756 ours pair IN ORDER; the unpaired vendor objects are exactly its 2 oldest lines and 250 oldest labels (150 wholly outside the window's prices). No single offset: the script runs `linefill.new` on every bar and the two creation counters part a few ids per pool, in order. Lines sit in the cap band on both sides; TradingView's labels at the cap (history from 1993), ours 254 below it. RDDT MATCH |
| vdubus | lines 504/272, labels 129/23 | WINDOW + ENGINE (C22, withheld per bar) | pinned | all 295 ours pair in order (nothing we draw is wrong). SPY has two bars that are BOTH a 9-bar pivot high and low (348, 1554); there the fast engine's zig-zag takes two `array.unshift`s in one bar and the host lane withholds every step reading those arrays while either value is among the ten kept (`windowAmbiguousSteps`). Of 338 vendor objects we lack: 277 pre-window, 9 made while the zig-zag still held pre-window pivots, 52 inside the two spans [287, 523] and [1454, 1728] (4 pivots before each doubled bar to the 10th after). RDDT has no doubled bar and MATCHES. Serving it needs the runtime lane, which refuses `ta.macd` with 4 arguments (`pine:arity`). Owner: RT9 (runtime draws a host-attached script) |
| market-structure-by-leviathan | lines 117/21, labels 368/63 | WINDOW + **ENGINE, OPEN** | pinned as open | 83 of 84 ours at id + 401, the 401 others predate our bar 0 (348 outside the prices). **One wrong caption:** the swing high at our bar 524 reads `LH`, TradingView `HH`. `prevHigh` is `accum(na, c ? pivHi : self, 250)`; the previous high (bar 272, confirmed at 292) lies 252 bars back, past the bounded window, so `pivHi >= prevHigh` reads the seed `na`. Not a warm-up: the same shape plots the SEED mid-chart (`var float lvl = 0.0` plotted 0 at SPY bars 542-543 where Pine holds 358.75). Owner F5 (the bounded accumulator / `PINE_STATE_WARMUP`). Measured candidate fix below |
| parabolic-sar (RDDT, runtime) | labels 54/0 | ENGINE | **FIXED -> MATCH** | the runtime document had no drawing program: `probeRuntimeProgram(objectsInRun)` refused `round_to_mintick` (`runtime:call-undeclared-builtin-state`). v4's bare `round_to_mintick` is `math.round_to_mintick` unless the script defines a function of that name (`pineRuntimeFrontend.js`, RT5's rule). 54/54 labels, every text and colour |
| options-max-pain | lines 24/0, labels 15/0, boxes 13/0, cells 16/12 | WINDOW RULE (C18) | withheld (runtime values) | every drawing reads runtime values, served only from the listing (`runtimeObjectValues` -> `runtime:not-from-listing`); RDDT (from the listing) is served and MATCHES. Its last-bar values do not depend on history, but the rule cannot know that. Owner F5 |
| poor-man's volume profile | lines 2/0, labels 40/0 | ENGINE (budget + setter) | withheld | the 40 row labels read a last-bar loop over `INSTRUCTIONS_PER_BAR` (`runtime:INSTRUCTIONS_PER_BAR`, owner RT7); the 2 bound lines a `line.set_xloc` the host lane does not carry (`geometry:lost`). Same on RDDT |
| sector-rotation | lines 55/0, boxes 504/0 | ENGINE (builtin) | withheld by name | all creates and loops read `chart.left_visible_bar_time` (the member's viewport; no capture fixes it), runtime lane behind `pine:request`. Owner H5 |
| smt-divergence | lines 504/0, labels 504/0 | ENGINE (request) | withheld by name | reads `XAUUSD`, a bare symbol (`other-symbol:bare`). Owner H5 |
| volume-profile | lines 203/0 | ENGINE | withheld | profile lines updated inside a loop whose bound reads `va_up`, which `draw` changes (`loop:bounds` pine:state); runtime refuses a `ta.highest` whose length is known only at run time (`runtime:history-dynamic-offset`). Owner RT9 |
| vold-market-breadth | cells 2/0 | ENGINE (request) | withheld | `cell:text` x2, the cells read `request.security` of breadth symbols. Owner H5 |
| position-size-calc | cells 10/9 | ENGINE (request) | withheld | the one missing cell is "Lots", the only one that divides by `request.security`'s FX rate. Owner H5 |
| trend-lines-supports-and-resistances | texts/colours | ENGINE | already withheld by name | `pine:object-ops-refused` (its loops carried none of 6 steps); the runtime lane stops at `alert.freq_once_per_bar` (`pine:builtin`). Owner H5 (builtin), then RT9 |

**Measured** (worktree `.claude/worktrees/f6`, `--maxWorkers=1`, library store loaded):

| | base `c91e9fe3c8` | F6 |
|---|---|---|
| harness sweep (328 files): capture MATCH, objects pane on / + runtime | 96 / 109 | **96 / 110** |
| object verdict MATCH, on / + runtime | 155 / 187 | **155 / 188** |
| MATCH -> anything else | - | **0** (only parabolic-sar RDDT moved, runtime state, DIVERGE -> MATCH) |
| member-door census off / on / + runtime (libraries) | 55 / 82 / 99 | 55 / 82 / 99, census JSON byte-identical |

**CAP3 signatures** regenerated with `cap3SpyGaps.measure.test.js` (store loaded): parabolic-sar RDDT (in
`cap3-rt6-verdicts.json`) DIVERGE -> **MATCH**. No SPY gap row moved.

**Mutations** (each red, each restored by captured bytes, sha checked): the bare-name clause removed (2 red: the probe
and the MATCH); the "script defines its own `round_to_mintick`" guard removed (1 red: the own-function rail, whose
labels then print the tick-rounded SAR instead of the function's `7`).

**The leviathan fix that was measured and NOT shipped.** Admitting a hold-or-set `var` body (`c ? v : self`) as SWITCHED
(C12s: publish only where a set lies inside the window) at the `var` site turns the wrong `LH` into a withheld label and the
plotted `0` into a gap. Over the harness it also moved: pa-zigzag-fibonacci-fan SPY DIVERGE -> MATCH, sonarlab BRK-A
DIVERGE -> MATCH, but **trend-targets-algoalpha RDDT (runtime) objects MATCH -> DIVERGE** (the object lane marked every
bar of its `trend` guard unknown even from the listing: 0 drawn) and sonarlab AAPL/SPY box counts moved. Applying it at
the `:=` site as well also turned qqe-signals RDDT MATCH -> DIVERGE. Zero MATCH -> DIVERGE is the bar, so it is handed to
F5 with that evidence; the patched file is kept off-branch in the lane's scratchpad.

**Open.** (1) leviathan's bounded-accumulator gap (above, F5). (2) `runtime/__tests__/objectLane*.measure.test.js` time
out at 15 s under load (3 of 3 with F6, 4 of 4 on base at the same moment: pre-existing).
