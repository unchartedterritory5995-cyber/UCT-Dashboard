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
| `atr-support-and-resistance` | lines 20/0; boxes 20/0 | C12 values computed in multi-statement blocks (`pine:block`) | C11 arrays |
| `average-day-range-adr-pivots` | lines 2/0; boxes 2/0; cells 4/2; cell text | C13 drawing functions called inside an expression (`fn:in-expression` ×16) | C8 `timeframe.change` (32), C11 drawing arrays, C16 `table.merge_cells` |
| `dual-view-htf-candlestick-patterns-theultimator5` | no drawing program (436 held) | C11 arrays of drawings written in blocks | C12 |
| `ema-ribbon-trend-filter-strixedge` | cells 48/34; cell text | C10 `request.security` in cell text (54 trees) | C15 `str.tostring` form, `size.*`/`position.*` as values |
| `extrapolated-pivot-connector` | no drawing program (6 held) | C9 dynamic history offset (`n[n - a1 + length]`) | C1 plot titles HTML-escaped; C6 comma-separated statements (`label.delete(a[1]),label.delete(b[1])…`) |
| `heat-map-seasons` | tables 1/8; cells 31/24; cell text | **C4 table re-created every bar — TradingView keeps one per position; we refuse at 8** | **C5 `\n` escape** |
| `high-low-open-mid-ranges` | lines 504/0; labels 504/0; cells 45/1; texts | C13 `fn:in-expression` (19 drawing-function calls) | C7 GC slack (500→504) |
| `htf-candle-footprint-cartel-console` | lines 6/0; labels 6/0; boxes 13/0; cells 2/1; texts | C8 `timeframe.change` (48 trees) | C11 |
| `htf-liquidity-dashboard-tfo` | lines 6/0; cells 30/3; texts | C11 UDT fields (`s0d_highs.size` …) | C12, C13 `fn:conditional-history` |
| `ict-ipda-look-back` | lines 3/0; boxes 6/0; tables 1/8 | **C4 — the run REFUSES at bar 8 (`more than 8 live table objects`) and stops stepping, so every line and box is lost** | — |
| `ict-killzones-pivots-tfo` | cells 3/1; cell text | C11 UDT/arrays (`kz1._box.size` …) | C13 |
| `institutional-smc-order-flow-matrix-pro` | lines 18/27; labels 34/43; boxes 2/0 | C11 arrays of boxes + lost deletes (`guard:delete` ×2 → extra lines/labels) | C9 |
| `k-clustering` | lines 9/0; cells 8/5; cell text | C11 UDT/array (`n_clust.get`, 120 trees) | — |
| `linear-regression-channel-…-existing-trend-lines` | lines 5/0 | C10 `request.security` (create:line ×5) | — |
| `liquidation-levels` | no drawing program (10 held) | C8 `time_close` (40 trees) | C15 `str.format` (20) |
| `liquidity-heatmap-nephew-sam` | labels 27/0; label text | C17 a function definition read in a guard (`pine:function-def`) | C5 |
| `liquidity-pools` | lines 182/0; labels 91/0; label text | **C2 the object lane never receives `newestBarIsForming`, so `barstate.isconfirmed` is `na` in every object tree and `swing_h` never fires** | **C3 `linefill.new` on the same two lines REPLACES (vendor 91 fills = 182 lines / 2; ours evicts through 500)**, C9 |
| `makuchaku039s-trade-tools-fair-value-gaps` | boxes 51/50 | C7 GC slack (vendor holds ids 139..189 = newest 51 of 189 at default 50) | — |
| `market-structure-by-leviathan` | lines 6/133; labels 22/133; label text | C12 `var` state reassigned inside `if` blocks (`prevHigh` "nothing updates") → guards dropped, remaining creates over-fire | — |
| `momentum-volatility-scanner` | cells 12/11; cell text | C16 `table.merge_cells` unsupported | — |
| `multi-timeframe-supply-demand-zones` | boxes 504/500 | C7 GC slack (all 504 created on one bar; vendor keeps all 504 at max 500) | C13 |
| `options-max-pain-calculator-backquant` | lines 10/0; labels 8/0; boxes 13/0; cells 16/11; texts | C11 arrays + `while` loops in functions (loop-blocked `box.new`/`label.new`/`line.new`) | C5 |
| `poor-man039s-volume-profile` | labels 40/0; label text | C8 `time_close` (160 trees → 159 `update:props`, 40 `create:label`) | C12 `pine:reassign` |
| `position-size-calc` | cells 10/0; cell text | C12 block-computed cell text (`guard:cell` ×10) | — |
| `position-size-calculator` | labels 4/50; label text | **C6 comma-separated statements: `var l = label(na), label.delete(l), l := label.new(…)` keeps only the LAST statement — the `var` and the `delete` vanish, so labels accumulate to the cap** | **C5 `\n` escape** |
| `pro-trading-art-double-top-bottom-with-alert` | lines 7/0; labels 14/0; label text | C11 UDT (`top.first`) | — |
| `reverse-stochastic-momentum-index-on-chart` | no drawing program (1 held) | C8 `time_close` | — |
| `rsi-swing-indicator` | lines 11/0; labels 11/0; label text | C12 `var` state reassigned in blocks (label guards truthy 0/632) | C14 getter in a coordinate (`label.get_x`) |
| `sector-rotation` | boxes 504/0 | C8 `chart.left_visible_bar_time` (viewport-dependent — not answerable on a bar series) | C7 |
| `smt-divergence-ict-01-…` | lines 500/0; labels 500/0; label text | C9 dynamic history offset (`low[bar_index - x]`) | — |
| `trend-duration-forecast-chartprime` | lines 1/0; labels 28/0; cells 34/0; texts | C11 UDT/array methods (`bullishCount.avg` …) | C2, C5, C14 |
| `trend-lines-supports-and-resistances` | no drawing program (14 held) | C13 `fn:loop` / `fn:conditional-history` → a lost removal → drawing withheld | — |
| `ultimate-pivot-points` | lines 51/50; labels 51/50 | C7 GC slack (vendor holds the newest 51 at default 50) | C14 getter in a guard (9 `update`s dropped) |
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
| **C7** | vendor garbage collection is documented as *approximate* ("more drawings than the specified count may be displayed"); measured slack: +1 at default 50, +4 at 500 — but `contraction-box` holds exactly 50 with the same one-per-bar pattern, so no rule reproduces all six cases yet | makuchaku, ultimate-pivot-points, multi-timeframe-supply-demand-zones | **not yet** — no rule fits every measurement |
| C8 | clock builtins we do not hold: `time_close`, `timeframe.change`, `chart.left_visible_bar_time` (the last is viewport state and unanswerable) | liquidation-levels, poor-man, rsmi, adr, htf-footprint, sector-rotation | needs a declared clock column each |
| C9 | a history offset that is an expression (`x[bar_index - k]`) | artemis, extrapolated, smt-divergence | large — the columnar lane requires literal windows by design |
| C10 | `request.security` in object text/coordinates | artemis, ema-ribbon, linear-regression, vold | large — needs the MTF data seam |
| C11 | arrays / UDTs / methods holding drawings or values | dual-view, htf-liquidity, KZP, smc, k-clustering, max-pain, PTA, trend-duration, vdubus | large |
| C12 | values or `var` state computed across a multi-statement block | atr-sr, market-structure, rsi-swing, position-size-calc | large |
| C13 | user drawing functions the inliner refuses (`in-expression`, `conditional-history`, `loop`) | adr, OHLM, TSR | medium, per refusal kind |
| C14 | object getters in a coordinate or guard | (secondary) rsi-swing, ultimate, trend-duration | medium |
| C15 | text builtins / constants in value position (`str.format`, `size.*`, `position.*`) | (secondary) | small each |
| C16 | `table.merge_cells` | momentum-volatility-scanner | small |
| C17 | a function definition read inside a guard | liquidity-heatmap | medium |

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

| 6 | C3 one linefill per pair of lines, none without them | _this commit_ | 14 / 47 | 171 / 252 | linefills are not a graded family, so the score cannot move; measured directly instead: `liquidity-pools` fills 500 → **91 = vendor 91**, `price-action-…` 19 = vendor 19 (unchanged), `linear-regression-…` 2 → 0 against vendor 2 — its two fills had been attached to lines we never draw (C10), so the old 2 was a coincidence of counts, not a drawing |

(rows are appended as each class lands)
