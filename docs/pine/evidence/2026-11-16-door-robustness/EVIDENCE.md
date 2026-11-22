# Door robustness: the member door says why, and four smaller walls (evidence)

Branch `fix/pine-coverage-door-robustness`, merged with master `97558781fa` (`SCRIPT_ENGINE_VERSION = 60`).
Engine number PENDING (two `NUMBER PENDING` lines in `scriptEngineVersion.js`); the coordinator numbers the
train. Unit brief: scripts that pass translation and then fail at the door (wall analysis of the engine-60
runtime-on census, 412 failing scripts).

## 1. "Attached but did not install": 11 scripts, one cause, two defects

Every one of the 11 census rows that attached and then did not install is a `compute.budget` cap at the
install door (`validateUserDefinitions` -> `validateAstLane` -> `checkBudget`). None is a throw.

| script | cap | the script needs | cap |
|---|---|---:|---:|
| reference:check-head-and-shouldersmask-man | lookback | 2547 bars | 960 |
| reference:range-filter-buy-and-sell-5min | lookback | 1052 | 960 |
| committed:volume-spikes-growing-volume-signals-with-alerts-scanner | lookback | 1000 | 960 |
| reference:ut-bot-linreg-candles-longevity-zones-sr-dashboard | lookback | 1000 | 960 |
| reference:vwapmvwapema-crossover | lookback | 981 (`vwap()` is one whole session) | 960 |
| committed:rsi-vwap-indicator | lookback | 976 (`vwapOf()`, one whole session) | 960 |
| reference:multi-timeframe-vwap-v5 | distinct series | 9 | 8 |
| committed:vwap-fibo-dev-extensions-strategy | distinct series | 9 | 8 |
| committed:mtf-key-levels-support-and-resistance | distinct series | 10 | 8 |
| committed:swing-points-and-liquidity-by-leviathan (after peel) | distinct series | 14 | 8 |
| reference:tradingviews-technical-analysis | formula size | 334 nodes | 128 |

(The numbers are the install door's own measurement, `installError` on the engine-60 runtime-on census rows.)

The two defects: (a) `memberPaneDefinition` answered `ok: true`, `MemberPane` installed nothing and said
nothing, so a member saw an empty pane with no sentence; (b) because the host lane "attached", the per-bar
lane (the door's general fallback since RT1) was never asked.

Fix (coordinator ruling A): the door asks the install door's own validation of the document it built
(`memberPaneDefinition.js::hostInstallRefusalOf`, one authority: `validateUserDefinitions`), refuses under the
budget's own guard with the plot and the number in plain words, or under `pine:install` (the door's own
document failing its own check, an engine fault) for anything else, and offers the script to the per-bar lane
as it does every host refusal. No cap moves.

### 1.1 The caps, what they are derived from, and what TradingView allows (for the coordinator's ruling)

| cap | value | derived from (JS / Python twin) | what TradingView itself allows (verbatim, Pine user manual "Limitations") |
|---|---:|---|---|
| `maxLookback` | 960 | `budget.js::DEFAULT_BUDGET` = `max(NESTED_RECURRENCE_WARMUP 550, SESSION_MAX_BARS 960)`; `SESSION_MAX_BARS` is `closedTable.json::sessionMaxBars` (one ET calendar day, 04:00-20:00, at one-minute bars). Twin: `api/services/ast_budget.py::DEFAULT_BUDGET`, same expression. It is also the ceiling on a bar offset. | "Other limitations > Maximum bars back": history references are "limited to a maximum of 5000 bars for most series." "Some built-in series like open, high, low, close, and time have larger historical buffers that can reference up to 10,000 bars." The buffer can be resized "using either the max_bars_back() function or the max_bars_back parameter of the indicator() or strategy() declaration statement." |
| `maxSeriesRefs` | 8 | `budget.js`: spec section 5's perf budget (at most 8 panes per chart); counts DISTINCT base series per formula. Twin: `ast_budget.py`. ⚠️ The comment in `budget.js` says this cap is UNREACHABLE because the closed table declares five series; four sample scripts reach it (9, 9, 10, 14), so that comment is stale (the series a request or another symbol reads count as distinct series now). Recorded, not edited here. | No per-formula series limit is published. The nearest published limits: "Chart visuals > request.*() calls": "A script can use up to 40 unique calls to the functions in the request.*() namespace" ("or up to 64 unique calls if the user has the Ultimate plan"). "Chart visuals > Plot limits": "A maximum of 64 plot counts are allowed per script." |
| `maxNodes` | 128 | `budget.js`: "far past anything a human composes" (the committed AST corpus topped out at nine nodes when it was set). Twin: `ast_budget.py`. | No per-expression limit is published. The nearest: "Script size and memory > Compiled tokens": "The IL form of each indicator, strategy, and library script can contain a maximum of 100,256 tokens." "Variables per scope": "Scripts can contain up to 1,000 variables in each of its scopes." "Time > Loop execution": "The execution time for any loop on any single bar is limited to 500 milliseconds." |

Source of the quotes: https://www.tradingview.com/pine-script-docs/writing/limitations/ (read 2026-11-16). The
v6 reference entry for `indicator(max_bars_back)` could not be read (the page returned only its shell), so it is
not quoted. Compute cost of a raised cap was NOT measured (ruling A: a separate unit).

### 1.2 Before and after, by the census's own predicate

Scoped census on this branch: the measuring test itself (`coverageMapDoorCensus.measure.test.js`), both lanes,
over the 49 target scripts and a control set of 70 (every sample script declaring a `var string`, 45, and 25
seeded-random scripts that paint), against the engine-60 census rows. Head `676a319edc` (master engine 61 merged).
`LANE MEASURED: production (gate CLOSED, runtime lane reached 0, host refusals 286)`;
`LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 456, host refusals 422)`; 119 rows each.

| script | production lane, before -> after | runtime-on lane, before -> after |
|---|---|---|
| reference:check-head-and-shouldersmask-man | attached, not installed -> refused `budget:lookback` | not installed -> **transfers** (the per-bar lane attaches) |
| reference:multi-timeframe-vwap-v5 | attached, not installed -> refused `budget:series` | not installed -> **transfers** (per-bar lane) |
| reference:range-filter-buy-and-sell-5min | attached, not installed -> refused `budget:lookback` | not installed -> **transfers** (per-bar lane) |
| committed:mtf-key-levels-support-and-resistance | attached, not installed -> refused `budget:series` | not installed -> **transfers** (per-bar lane) |
| reference:tradingviews-technical-analysis | attached, not installed -> refused `budget:nodes` | not installed -> refused (`budget:nodes`; per-bar lane declines `runtime:conditional-history`) |
| reference:vwapmvwapema-crossover | attached, not installed -> refused `budget:lookback` | not installed -> refused (per-bar lane declines `budget:lookback`) |
| reference:ut-bot-linreg-candles-longevity-zones-sr-dashboard | attached, not installed -> refused `budget:lookback` | not installed -> refused (per-bar lane declines `budget:lookback`) |
| committed:volume-spikes-growing-volume-signals-with-alerts-scanner | attached, not installed -> refused `budget:lookback` | not installed -> refused (per-bar lane declines `pine:function`) |
| committed:rsi-vwap-indicator | attached, not installed -> refused `budget:lookback` (places orders) | not installed -> refused (`budget:lookback`; places orders) |
| committed:vwap-fibo-dev-extensions-strategy | attached, not installed -> refused `budget:series` (places orders) | not installed -> per-bar lane attaches; places orders, never counted |
| committed:swing-points-and-liquidity-by-leviathan | refused `pine:request`, unchanged (its install wall was after a peel) | unchanged |
| reference:volume-pace-pressure-table | dirty (2 `cell:text`) -> **transfers** | dirty -> **transfers** |
| control: reference:williams-r-rsi-ema-tendance-silver-wong | dirty (3 labels dropped, `pine:text-value`) -> **transfers** | dirty -> **transfers** |

Totals: targets production 1 -> 2 and runtime-on 6 -> 11 (+5); controls production 7 -> 8 and runtime-on
11 -> 12 (+1, williams-r). No target or control transfers less. Under the EARLIER paint rule the same rows give
the same totals on this tree (2 and 11; 8 and 12): the paint-rule correction moves no counted script in this set
(the order-placing committed:supertrend-strategy loses its paint wall on the runtime-on lane, and is never counted).

⚠️ The four runtime-on gains are the census's upper bound (the per-bar lane is DARK, and the census lets every
script through its allowlist). In the product the per-bar lane draws only a script graded MATCH
(`runtimeNotGradedOf`); none of the four is graded today. What this PR gives a member on the production lane is
the named refusal instead of a silent empty pane.

## 2. The regression: volume-pace-pressure-table, and a `var string` in a drawing text

Two separate causes, both fixed:

1. `pine.js::stringVarTextOf` (coordinator ruling B). The drawing lane's text reader had no branch for a
   `state` binding, so a `var string` fell to the numeric last resort, which CBC-FMT F11 refuses as `pine:type`.
   A `var string` (known by its declaration's seed) is now read from its writes where no bar-to-bar memory is
   needed: a text seed never written; a write on every bar; a write under a guard that is the same on every bar
   (literals and chart-period reads folded at this translation's period; an input is never such a guard); a write
   in both branches of an `if / else`. Refused by name (`pine:text-value`): a latch (a write under a guard that
   varies bar to bar with no write in the other branch), a self-append, and an `na` seed shown as text (probe
   Q-ROB1). A `var` not declared `string` still reaches F11's `pine:type` (CBC-FMT's rail
   `strTostringCore.cbcfmt` green; `doorRobustness.test.js` asserts it for `var float` and an untyped `var`).
   ⚠️ Conservative where it could serve: `if timeframe.isdaily` does not fold as a constant in this reader
   (`timeframe.isminutes` and `timeframe.multiplier` do), so such a write is refused as a latch.
2. A cell that never runs on a chart of this period (`guardOf` -> `never`, only for a guard made of chart-period reads and literals: `periodOnlyGuard`; a guard that reads an INPUT never counts, because the object pass folds an input at its default and a member may turn it on. The first cut used every decided guard, and the cloud's `partialDrawing` rail caught it on htf-liquidity-dashboard-tfo: 24 cells under `if _use and …` rows stopped being counted as lost). The two pace cells sit inside
   `if timeframe.isminutes and timeframe.multiplier < 60`, false on every bar of a daily chart, and their text
   reads `var string`s still holding their `na` seed there. TradingView never draws them on a daily chart: the
   licence-held captures `volume-pace-pressure-table-{rddt,spy}-1d-2026-11-14` (s4-prove-drawn) read one 2 x 3
   table of six cells and no pace cell. Such a cell, when its text cannot be read, is named
   (`objectDiagnostics.neverRunOps`) and not counted as a loss; a chart of a period where it would run refuses
   the drawings by name (`meta.periodReads`, objects stamp; railed). Only the cell-text failure path changes.

## 3. Instrument correction (coordinator ruling C): the paint rule

A paint counts as withheld only when the document the member gets does not draw it
(`tools/pine_coverage/paint_predicate.mjs`, imported by both measuring tests, with a self-check rail;
`coverage_map.py`, `COVERAGE-MAP.md` and the dated 2026-11-16 page say so). Every census row now carries both
counts and both `clean`s. On the scoped set the headline is the same under both rules; the full 679 under both
rules is the coordinator's census.

## 4. Not freed, by name

| script(s) | wall | what would settle it |
|---|---|---|
| tradingviews-technical-analysis, vwapmvwapema-crossover, ut-bot-linreg, volume-spikes; rsi-vwap and vwap-fibo (orders) | the named budget refusal on the production lane; the per-bar lane's own walls (1.2) | the cap ruling (1.1); those walls |
| heat-map-seasons | `barcolor` `paint:colour` (two `color.from_gradient` with `ta.highest` / `ta.lowest` bounds chosen by a ternary); the per-bar read (DIV-4) declines `runtime:call-undeclared-builtin-state` (`ta.correlation` upstream). Its committed captures DIVERGE on objects (31 vs 30 table cells), so no capture witnesses its paint either | the per-bar lane declaring `ta.correlation`'s state; the objects divergence |
| dot-dynamics | `barcolor` `paint:colour`; DIV-4 declines `runtime:call-undeclared-builtin-state` (`avg`, v4). Its licence-held capture grades MATCH on 15 items on this tree with the paint withheld (not graded) | the per-bar lane declaring `avg` |
| relative-strength-index-divergences-libertus | two v4 `bgcolor` with no `transp` over `color.new(c, 50)`: `paint:v4-default-transp`; its licence-held capture DIVERGEs (1 of 2 items) | probe Q-ROB3 (`vw-rob3-v4-bgcolor-own-alpha.pine`): the chart model alone reads transparency 90 AND alpha 0.5 |
| atr-trailing-stoploss-strategy, supertrend-strategy (committed), trailing-sl-strategy | place orders, never counted (supertrend-strategy's paint is drawn on the runtime-on lane) | - |
| `pine:timeout` (8) | on the runtime-on lane 5 already transfer (cc-yata, parabolic-sar, market-structure-luxalgo, psar-alerts-quantnomad, volume-supertrend-ai); momentum-based-zigzag stops at `runtime:conditional-history`, smoothed-gaussian at `pine:state` / `pine:statement`, ai-supertrend-x and multi-timeframe-trend at `pine:request` | the runtime walls named |
| `pine:roundtrip` (16 rows, 2 in this family) | each script is stopped first by another wall on both lanes (request, statement, function, reassign, window: the census rows) | - |

The `pine:timeout` depth stop: every case read here is a set of variables that each read another's previous bar
(`trend`, `sar`, `ep`, `af`), which this lane expands by re-reading definitions until the 400-level bound. That is
a limit of the columnar lane (the per-bar lane computes them), but the sentence calls it "a translator defect, not
a limit on the script". The existing cycle detector (`pine:cycle`) does not see a coupled recurrence, so it cannot
say so cheaply; per the coordinator's ruling the sentence is left as it is and noted here.

## 5. Witnesses, regraded on this branch

`evidence_engine.py regrade` over a scratch store holding only the affected licence-held captures (scratch
ledger; nothing filed in the repo), head `ef326c36ec`, engine 61 + this branch:

| capture (licence-held) | engine 54 (ledger) | this branch |
|---|---|---|
| volume-pace-pressure-table-rddt-1d-2026-11-14 | MATCH / MATCH | MATCH / MATCH (all 1 items agree) |
| volume-pace-pressure-table-spy-1d-2026-11-14 | MATCH / MATCH | MATCH / MATCH (all 1 items agree) |
| williams-r-rsi-ema-tendance-silver-wong-rddt-1d-2026-11-15 | DIVERGE / DIVERGE (1 of 4) | **MATCH / MATCH (all 4 items agree)** |
| dot-dynamics-rddt-1d-2026-11-15 | DIVERGE / DIVERGE | MATCH / MATCH (all 15 items agree; its paint withheld, not graded) |
| relative-strength-index-divergences-libertus-rddt-1d-2026-11-15 | DIVERGE / DIVERGE | DIVERGE / DIVERGE (1 of 2) |

(production / runtime-on.) The williams-r labels this branch newly draws are the ones the capture reads
(`Cross Tenkan/Kijun`, `Cross EMA9/EMA18`): the newly served output is witnessed. volume-pace-pressure-table
draws what it drew before engine 59, and both captures MATCH. The dot-dynamics move from DIVERGE is master's
engines 55-61, not this branch (its paint stays withheld); recorded, not claimed.

## 6. Harness verdict moves (cloud, pine-heavy run on `2df75b8b17`), and admission of the newly reached scripts

Production lane: no verdict moves against master's committed snapshot. Runtime-on lane, two moves, both
**new by reach, not a changed drawing** (coordinator ruling A): `mtf-key-levels-support-and-resistance-rddt-1d-2026-11-14`
and `-spy-1d-2026-11-14` go INCONCLUSIVE ("refused on our side: install door refused") -> DIVERGE (2 of 5 items),
because the door now offers the budget-refused script to the per-bar lane, whose drawing of it diverges:
`D-VWAP` 6 bars off in the 2nd decimal (first at bar 114, 57.3 vs 57.29), labels 27 vs 3, lines 23 vs 22 with a
line's y1 off (103.2824 vs 101.27). W-, M- and Y-VWAP agree on every bar. Each item is a backlog row (Q-ROB5,
Q-ROB6, Q-ROB7, disposition `engine-gap`, in the door-robustness capture queue).

The real admission on this tree (`runtime_definitions.capability_admitted` / `not_graded`, with
`PINE_RUNTIME_CAPABILITY_ADMISSION=on`, against the committed registry) for the four scripts the per-bar lane
newly reaches:

| script | admitted? | reason | captures |
|---|---|---|---|
| committed:mtf-key-levels-support-and-resistance | **no**: `runtime:not-yet-graded` | capabilities `obj:table`, `request-other` not admitted | 2 committed, runtime-on DIVERGE (above): no kill-list entry is needed, the pane never draws it |
| reference:check-head-and-shouldersmask-man | **yes**, by capability | - | none (committed or licence-held) |
| reference:multi-timeframe-vwap-v5 | **yes**, by capability | - | none |
| reference:range-filter-buy-and-sell-5min | not yet: `pending` (the detector's budget did not settle its set) | the door says "still being checked" | none |

So two of the newly reached scripts are drawn by the per-bar lane for a member whose pane is permitted, on
capability evidence and with no capture of their own; no DIVERGE is known for either. That is capability
admission working as admitted; a capture of each is the way to know (queue rows are the coordinator's call).
