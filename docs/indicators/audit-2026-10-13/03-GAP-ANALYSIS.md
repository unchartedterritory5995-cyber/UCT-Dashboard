# UCT Indicators — Gap Analysis (ranked)

**Audit date:** 2026-10-13
**Baseline:** master = production `84164aee3d`
**Branch:** `audit/indicators-competitive-2026-10-13`

**Evidence base.** Every finding below was verified against the code at the production SHA. Most were also reproduced with a scratch probe or a test run. The full evidence (path:line, probe output, test output) is in the workstream appendices under `workstreams/WS1…WS8`. Each finding cites its source appendix: `[WS5 G1]` means workstream 5, gap 1.

**Severity scale** (the brief's definitions):
- **P0** — a broken promise: wrong calculations, silent corruption, lookahead, broken persistence, unsupported behaviour presented as supported, or a security/privacy issue.
- **P1** — an essential competitive gap.
- **P2** — a high-value differentiator or significant quality gap.
- **P3** — polish.

**Effort scale:**
- **S** — less than 1 day.
- **M** — 1–5 days.
- **L** — 1–3 weeks.
- **XL** — more than 3 weeks.

> **What is not here.** Ideas with no evidence of user need, and parity items we would add only "because TradingView has it". Those are deliberately left out.

---

## Summary table

| ID | Pri | Finding | Effort | Source |
|---|---|---|---|---|
| P0-1 | **P0** | TC2000 `STOC` imports with swapped arguments; wrong values labelled "Exact import" | S (+migration) | WS6 G1 |
| P0-2 | **P0** | thinkScript weekly/monthly reads wrapped in functions/offsets compute on daily bars; labelled "the values are the same" | M | WS6 G2 |
| P0-3 | **P0** | Pine `ta.cum` drawn over loaded bars only; the paste box refuses it for that very reason; the chart door accepts it silently | S–M | WS5 G1 |
| P0-4 | **P0**\* | Ichimoku Senkou spans not projected forward, and no cloud fill. Chart and cloud alerts disagree with every vendor | M (+alert migration) | WS1 D-1 |
| P0-5 | **P0**\* | Plot style "Last value horizontal" is offered but draws a normal line | S | WS2 G2 |
| P0-6 | **P0**\* | Turning an indicator off (Library row, Ctrl+I/O/B, Alt+U, right-click submenu, Settings list) deletes **every** instance and its settings. No undo | M | WS3 G1 |
| P0-7 | **P0**\* | Pine import verdicts contradict the chart. The box says "Not supported" for scripts that attach, and "Exact/the values are the same" for scripts whose values or `na`-ness diverge | M | WS5 G2–G4 |
| P1-1 | P1 | 68 backend security/integrity tests red since 10-08 (fixture lacks `definition.version`); anti-forgery and graph-bomb rails no longer reach their guard | S | WS8 G0 |
| P1-2 | P1 | Pine objects in an own-pane script positioned in price-pane coordinates | M | WS2 G1 |
| P1-3 | P1 | Marker plots draw spurious 0/1 dots and stretch the pane's autoscale | M | WS2 G3 |
| P1-4 | P1 | VWAP alerts compute over extended hours; the chart (RTH view) does not | M | WS1 D-3 |
| P1-5 | P1 | Anchored VWAP week/month/quarter/year anchors start at the first *loaded* bar | M | WS1 D-2 |
| P1-6 | P1 | Alert parameters seeded from server defaults, not the chart instance; Stochastic slow vs fast | M | WS1 D-5 |
| P1-7 | P1 | Unresolvable instances silently vanish at paint time | M | WS3 G2 |
| P1-8 | P1 | No undo for any manual indicator action | M–L | WS3 G3 |
| P1-9 | P1 | Formula lengths cannot be parameters (`sma(close, len)` refused) | M | WS4 G-1 |
| P1-10 | P1 | "Price crosses VWAP" refused by the budget (961 vs 960) | S–M | WS4 G-2 |
| P1-11 | P1 | Formula MTF limited to W/M resampled from chart bars (no D-on-intraday, no 60m) | L | WS4 G-3 |
| P1-12 | P1 | No composition: a formula cannot read another indicator's output; no reusable functions or building blocks | L | WS4 G-4 |
| P1-13 | P1 | No incremental evaluation; every live update recomputes every formula on the main thread | L | WS8 G1 |
| P1-14 | P1 | thinkScript styling, placement and inputs lost (arrows as 0/1 lines, histograms as lines, `declare upper` ignored) | M–L | WS6 G5–G6 |
| P1-15 | P1 | thinkScript study references (`RSI()`, `MACD`, `StochasticFull`, `KeltnerChannels`, `ADX`, `VWAP`) refused | M | WS6 G4 |
| P1-16 | P1 | thinkorswim scan one-liners (`… and …`) misdetected as TC2000 and refused with wrong advice | S | WS6 G3 |
| P1-17 | P1 | Pine chart door drops `hline`, `fill(hline,hline)` and `linewidth`; draws `plotarrow` as a line, all silently | M | WS5 G5, G8–G9 |
| P1-18 | P1 | Pine true `var` state, loops, arrays, `switch`, UDTs refused in production (runtime VM dark) | XL (owner-gated) | WS5 G7 |
| P2-1 | P2 | Shared-formula endpoint returns the sharer's internal `author_id`, including for public-library entries | S | WS3 G6 |
| P2-2 | P2 | Deleted definitions keep drawing in open tabs until reload | S | WS3 G4 |
| P2-3 | P2 | Share links cannot be re-pinned; a grammar bump strands all links | M | WS3 G5 |
| P2-4 | P2 | Per-chart scope is dead code; no "apply to all charts" or indicator sync | M–L | WS3 G8 |
| P2-5 | P2 | Global hide (Alt+Shift+I) leaves fills, markers and objects drawn | S–M | WS2 G4 |
| P2-6 | P2 | Per-bar colour on Area/Baseline silently dropped; markers lose palette colours | M | WS2 G6–G7 |
| P2-7 | P2 | Error messages are vocabulary dumps with internal jargon (2.5k–900 chars), and give no did-you-mean | M | WS4 G-5, WS5 G6 |
| P2-8 | P2 | `and`/`or`/`not` in a UCT formula routed to the TC2000 reader | S | WS4 G-7 |
| P2-9 | P2 | Visual builder one level deep; cannot build numeric indicators or `1.5*sma(volume,20)` | L | WS4 G-8 |
| P2-10 | P2 | Two formula languages for screening (screener where-grammar vs the indicator AST); user formulas cannot be watchlist/screener columns | L | WS4 G-9 |
| P2-11 | P2 | Missing classics in the formula table (supertrend, obv, alma, dema/tema, sar, variance, zscore, `hl2`…) | M | WS4 G-6, WS1 G-1 |
| P2-12 | P2 | Imported source (Pine, thinkScript) not stored; choice inputs frozen | M | WS5 G11–G12, WS6 G6 |
| P2-13 | P2 | Session VWAP/AVWAP hidden on 8 offered intraday timeframes | S–M | WS1 D-4 |
| P2-14 | P2 | Missing OHLC coerced to 0.0 in the alert evaluator | S | WS1 D-6 |
| P2-15 | P2 | 7 more red backend rails + an escape-census harness that cannot run on Windows | S–M | WS8 G3–G4 |
| P2-16 | P2 | Formulas run on the main thread (the worker exists only for the dark runtime lane) | L | WS8 G2 |
| P2-17 | P2 | Formula tab saves formulas no consumer computes (`ltf`, `text_*`) | S | WS4 G-10 |
| P2-18 | P2 | PCF "Exact import" for XAVG/MACD without disclosing seed differences | S | WS6 G9 |
| P3 | P3 | Polish backlog (≈30 items) — see the list at the end | — | all |

\* An asterisk marks findings I rate P0 under the brief's definitions but that are **owner calls**. P0-4 is documented in code as a "preserved quirk awaiting owner sign-off". P0-5 has a low blast radius. P0-6 loses settings rather than data. P0-7 concerns reporting, not values.

---

## P0 — critical defects and broken promises

### P0-1 — TC2000 `STOC` argument order *(confirmed by the lead in code)*
- **Evidence:**
  - `app/src/components/chart/engine/ast/pcf.js:196` emits `stoch(close, high, low, n)`.
  - The engine signature is `(h, l, c, n)`: `interpret.js:2768`, `api/services/ast_interpret.py:2206`, `closedTable.json:1264-1279`.
  - The existing test `pcf.vocabulary.test.js:292-301` *asserts the wrong tree*.
  - The repo's own `pine.roles.test.js:128-139` documents the correct order.
- **Current:** the output is 100·(L − lowest(H))/(highest(C) − lowest(H)), ranging −146…+97 on synthetic data. `STOC14.3 < 20` is wrong on 122/400 bars. The label says **"Exact import"**.
- **Expected:** `stoch(high, low, close, n)`; a 0–100 oscillator matching TC2000.
- **Impact:**
  - Every member who migrated a TC2000 stochastic scan, column or alert gets wrong signals.
  - Chart, scan and alert agree on the wrong value, so nothing looks broken.
- **Complexity:** a one-line fix. Saved STOC definitions then change `astHash`, so armed alerts need a migration/notice plan.
- **Regression risk:** low for code; medium for stored definitions.
- **Benchmark:** TC2000's documented STOC is a 0–100 %K/%D.

### P0-2 — thinkScript MTF wrapped in functions or offsets *(confirmed in code)*
- **Evidence:**
  - `thinkscript.js:3869-3871` wraps only the price field in `tf`.
  - Corpus script 07 agrees on 0/120 tail bars, with 9.6–12.2% max error.
  - `thinkscript.aggregation.test.js` checks shape only.
- **Current:**
  - `Average(close(period=WEEK),10)` becomes a 10-*day* average of last week's close.
  - `close(period=WEEK)[1]` steps back one *day*.
  - The UI says "differences in how it is drawn only; the values are the same".
- **Expected:** `tf(sma(close,10),'W')`, which is what the Pine door already emits. Also disclose the forming-week vs last-closed-week difference.
- **Impact:** every thinkorswim MTF study migrates with wrong numbers.
- **Complexity:** M. Lift the wrapper to the enclosing expression, and add a value-checked test against an independent weekly SMA.
- **Dependency:** confirm thinkorswim secondary-aggregation semantics against one captured value.

### P0-3 — Pine `ta.cum` over loaded bars, undisclosed
- **Evidence:**
  - `pine.js:12678-12686` (deliberate host `cum`).
  - `vendorHarness.c29BarCounters.test.js:59-61` skips the assertion.
  - The repo's TradingView captures show an offset on every bar (9,300/9,300).
- **Current:** the paste box refuses `ta.cum` and explains *why it would be wrong*. "Add this script to my chart" attaches it with no note.
- **Expected:** one behaviour. Either refuse on both doors, or attach with an explicit disclosure ("running total from the first bar UCT holds, YYYY-MM-DD").
- **Impact:** about 4.8% of real scripts (`ta.cum` 2.7%, v4 `cum` 2.1%): OBV, A/D, cumulative delta.
- **Complexity:** S for the disclosure; M to anchor at the listing date where UCT holds full history.

### P0-4 — Ichimoku cloud not projected forward *(confirmed in code and in the browser)*
- **Evidence:**
  - `app/src/components/chart/indicators.js:512-522` ("NOT forward-displaced — Preserved as-is").
  - The module docstring at `:40-46` defers the fix to an "owner-signed-off change in B3" that never landed.
  - The Python twin `api/services/indicator_compute.py:873` is identical.
  - `ichimoku.spanA/spanB` are live alert addresses (`alert_series.py:204-205`).
  - The registry description promises "a projected cloud" (`nativeRegistry.js:646`).
  - Browser screenshot on synthetic bars: `evidence/ichimoku-no-forward-projection-synthetic.png`. The spans end at the last candle, there is no fill, and Chikou is shifted back.
- **Current:** UCT's cloud at bar *i* equals the standard cloud at bar *i+26*. There is no fill. Tenkan/Kijun start at bar 51.
- **Expected:**
  - Spans displaced 26 bars into the future, which needs future-axis support (`charts-future-axis-extension` already exists).
  - A fill between the spans.
  - Each line warms up on its own period.
- **Impact:** silent, plausible wrong readings, and alerts on the wrong cloud.
- **Complexity:** M, plus an alert-address migration (armed span alerts change meaning).
- **Owner call:** this is the "preserved quirk".

### P0-5 — "Last value horizontal" draws a normal line
- **Evidence:**
  - `presentation.js:72` (offered) and `:104` (maps to `'line'`).
  - `drawsHistory` (`:233`) has no caller.
  - Offered in Settings (`ChartSettingsIndicators.jsx:2719-2740`).
- **Fix:** remove the option (S) or implement it (M).

### P0-6 — Toggling an indicator off deletes all instances and their settings *(confirmed in code)*
- **Evidence:**
  - `engine/instanceControls.js:322-330` tombstones every live instance of the definition. Re-enabling (`:333-344`) revives a single `legacy:` instance with default inputs.
  - Callers:
    - `IndicatorLibraryDialog.jsx:186`
    - `StockChart.jsx:5805` (right-click submenu)
    - `StockChart.jsx:8698` (Ctrl+I/O/B, Alt+U)
    - `ChartSettingsIndicators.jsx:863`
  - Probe `probe2.audit.test.js`: two tuned RSIs become one default RSI.
- **Current:** one keystroke wipes configured studies. Legend chip / Inspector "Remove" deletes only one instance (`removeInstance`), so behaviour is inconsistent across surfaces. Ctrl+Z covers drawings only.
- **Expected:** "off" means *hide* (or removes only the targeted instance), and it is undoable.
- **Impact:** high for power users with multiple tuned instances.
- **Complexity:** M (route these doors through `removeInstance`/hide, and add undo).
- **Regression risk:** medium. `controlDoorCensus.test.js` and the migration paths reference this behaviour.

### P0-7 — Two contradictory Pine verdicts on one screen
- **Evidence:**
  - The box verdict comes from the lenient lane (`PineBox.jsx:322`); the chart uses the strict lane (`memberPaneDefinition.js:153-172`).
  - Host notes are discarded (`memberPaneDefinition.js:716-760`).
  - Unlisted note codes default to "presentation only", hence "the values are the same" (`importOutcome.js:64-73,248`).
- **Measured** (336 TradingView captures):
  - 89 "Partial import" where the chart refuses everything.
  - 67 "Not supported" where the chart attaches.
  - 16 captures with value/`na` divergence carry "the values are the same".
  - 8 diverging captures say "Exact import".
  - Strategies attach with no "orders are not simulated" note.
- **Live example (this audit, browser):** a script drawing a label and a line got "Exact import · This script offers 2 columns". The drawing objects appear only under "Show 1 line a screen does not read".
- **Expected:** one verdict, computed from the lane that will actually draw. Host notes surfaced. Unknown note codes default to *semantic* (fail honest).
- **Impact:** this is the trust contract of migration, the owner's top priority. A member cannot tell what they got.
- **Complexity:** M.

---

## P1 — essential competitive gaps

**P1-1 — red security rails.**
- **Evidence:** commit `4b9796e968` (10-08) made the save door require `definition.version`. Fixtures in four files were never updated:
  - `test_compute_graph.py` (31)
  - `test_param_manifest.py` (25)
  - `test_param_repaste_c46.py` (11)
  - `test_graph_wire_size.py` (1)
- **Effect:**
  - 62 tests raise the version error outright.
  - 6 expect a different refusal and get the version one first.
  - Production still refuses forged parameter manifests and graph bombs, but **a regression in those guards would no longer be caught**.
- **Fix:** add `version: 1` to the fixture builders (S). [WS8 G0]

**P1-2 — Pine objects in own-pane scripts.**
- **Evidence:** the object layer's `priceToY` always uses `candleSeriesRef` (`StockChart.jsx:13048,13097`, confirmed by the lead). The pane rect is computed but used for tables only (`objectLayer.js:172-195`). No refusal and no test.
- **Effect:** an RSI-pane `label.new(…,70)` lands at price 70 on the candle scale.
- **Reach:** member-reachable, because the member pane is armed.
- **Pixel check:** not done. The local dev build lacks the member-pane build flag (see Limitations). [WS2 G1]

**P1-3 — marker dots.**
- **Evidence:** marker plots are a LineSeries with `pointMarkersVisible` over 0/1 data (`pool.js:697-707`, probe).
- **Effect:** rows of dots at 0 and 1, and the 0–1 range is pulled into the pane autoscale. On price panes the dots sit at $0/$1.
- **Benchmark:** TradingView/thinkorswim draw shapes only. [WS2 G3]

**P1-4 / P1-5 / P1-6 — VWAP family and alert parameters.**
- **P1-4:** the chart filters to RTH before computing (`StockChart.jsx:8246-8262`), but the alert evaluator computes over extended-hours bars from midnight ET (`indicator_alert_evaluator.py:1078-1120`). Up to 3.4 points apart on a ~100 synthetic price. Traced in code, not run against the store.
- **P1-5:** AVWAP calendar anchors begin at the first loaded bar (`indicators.js:1056-1095`), while the explicit-date branch already refuses partial history (`:1069-1076`).
- **P1-6:**
  - A chart RSI(7) arms an RSI(14) alert unless the user edits it. This is disclosed, but it is the wrong default.
  - Chart Stochastic is slow 14/3/3, but the server computes fast only.
- [WS1 D-2, D-3, D-5]

**P1-7 / P1-8 — invisible loss and no undo.**
- **P1-7:** `normalizeInstances` drops instances whose definition no longer resolves or that carry an input the definition dropped (`engine/instances.js:604-616,706-715`). Nothing in the UI reads the dropped list.
- **P1-8:** undo covers drawings only (`StockChart.jsx:6266`). Agent ops have exact undo, but it is in-memory only (20 entries). Version History needs `WORKSPACE_DOC_STORE_ENABLED`, which the ledger marks armed since 09-27 but which is not verified live.
- **Benchmark:** TradingView has chart undo for indicator changes [UNVERIFIED in WS7; treat as an expectation, not a cited fact]. [WS3 G2–G3]

**P1-9 … P1-12 — language power.** These are the limits advanced traders hit first. [WS4 G-1…G-4]
- **P1-9 — no parameterized lengths:** `sma(close, len)` with a declared input → `resolve:window` (`builderInputs.js:395`, `parse.js:294-345`).
- **P1-10 — no VWAP crosses:** `crossOver(close, vwap())` is refused at 961 > 960 (`budget.js:163,328-334`); the code itself calls this "the formula a member types first".
- **P1-11 — limited MTF:** the formula `tf()` is W/M only (`interpret.js:152-215`). The door admits `tf(close,'D')`, but the chart then refuses it.
- **P1-12 — no composition:** no node for "the output of indicator X", `input.source` is refused, there are no user functions and no building-block library.
- **Benchmark:** Pine, thinkScript and TrendSpider JS all allow parameterized lengths, user functions, and daily-on-intraday reads [WS7 §3, DOC]. TC2000 PCF does not (no in-formula MTF, no functions).

**P1-13 — no incremental evaluation.**
- **Evidence:** the binder cache is keyed on bars-array identity (`binder.js:1655-1664`, `:740-760`), and live updates run at 1 s cadence (`utils/streamStatus.js:19`).
- **Effect:** every tick recomputes every formula over full history on the main thread. A one-bar tick cost 0.95× a cold pass in the micro-benchmark (shared-CPU; ratios only).
- **Note:** only the dark runtime lane has checkpoint resume and a worker. [WS8 G1]

**P1-14 … P1-16 — thinkScript migration blockers.** [WS6 G3–G6]
- **P1-14 — styling and inputs lost:**
  - 0 of 18 corpus scripts keep styling: arrows become 0/1 lines and histograms become lines.
  - Constant 70/30 levels are dropped.
  - `declare upper` lands in the lower pane (`BuilderSheet.jsx:1006` defaults to `'pane'`).
  - Inputs are frozen at save.
  - Partial local work exists in `C:/w/rpw` (uncommitted, incomplete — see the migration report).
- **P1-15 — study references:** `RSI()` / `RSI(14)` / `MACD` / `StochasticFull` / `KeltnerChannels` / `ADX` / `VWAP` are refused. Only 10 of 24 pinned public studies translate.
- **P1-16 — scan one-liners:** `close > Average(close,50) and volume > 500000` is detected as TC2000 (`dialect.js:93-98`) and refused with the wrong advice. This is the most common thinkorswim paste.

**P1-17 — Pine chart-door visuals.** [WS5 G5, G8, G9]
- All `hline`s are dropped on the chart door, while the box says it "carries it as a level line".
- `fill(hline,hline)` — the RSI 70/30 band — is dropped.
- `linewidth` becomes 1, silently.
- `plotarrow` is drawn as a line; `plotchar` as a circle.
- `display.data_window` plots are drawn.

**P1-18 — Pine stateful scripts (owner-gated).**
- **Current:** the runtime VM computes Supertrend and the ATR trailing stop **exactly** (0 diff on ~1,000 bars), but it is dark by three switches:
  - `VITE_PINE_RUNTIME_PANE_ENABLED`
  - `PINE_RUNTIME_STAGE`
  - `PINE_RUNTIME_SAVE_ENABLED`
- **Allowlist:** one graded script.
- **Reach:** `var` appears in 58.9% of real scripts, loops in 36.6%, arrays in about 32%. This is the single largest Pine unlock.
- **Owner instruction:** keep it disabled; this audit does not change that. [WS5 G7]

---

## P2 — high-value differentiators and quality gaps

**P2-1 — `author_id` in share resolution** (privacy, by class).
- **Evidence:** `GET /api/user-definitions/shared/{token}` returns `author_id`, the sharer's internal account id (`user_definitions.py:2527`, confirmed by the lead).
- **Reach:** public-library entries resolve through the same door, so any paid member can map listed formulas to account ids. That contradicts the design comment at `:2756-2762` ("NO AUTHOR IS RETURNED").
- **Exposure:** no email or name is exposed. [WS3 G6]

**P2-2 … P2-4 — lifecycle.** [WS3 G4, G5, G8]
- **P2-2:** deleted definitions are never uninstalled in open tabs (`hooks/useUserDefinitions.js:368-378`).
- **P2-3:** share links pin a version and cannot be re-pinned from `SharePanel`. A grammar bump strands every link.
- **P2-4:** no "this chart vs all charts" scope (`instancesForChart` has no caller); no indicator sync; MultiChartGrid edits can be masked by the first widget's instances.
- **Benchmark:** TradingView applies templates to a layout and syncs [WS7 D].

**P2-5 / P2-6 — rendering honesty.** [WS2 G4, G6, G7, G9]
- **P2-5:** global hide leaks fills, markers and objects.
- **P2-6:** area per-bar colour is dropped (LWC `AreaData` has no `color`); markers ignore palette/gradient colours.
- In-pane series reorder changes the list but not the draw order.

**P2-7 / P2-8 — error UX.**
- **P2-7:** unknown names produce a ~2.5k-character message blaming "the read-back", raw JSON trees appear in window errors, and there is no did-you-mean (`crossover` → `crossOver`).
- **P2-8:** a Pine `var` refusal is about 900 characters of internal jargon and suggests `lowest()` for Supertrend. `and`/`or` are routed to the PCF reader.
- **Benchmark:** TradingView/thinkorswim editors give positioned single-line errors [WS7 D]. UCT's positioned diagnostics are good, but the messages are not. [WS4 G-5, G-7; WS5 G6]

**P2-9 — visual builder depth.**
- One level only: no arithmetic on a side, no nested calls, no numeric indicators (`CriteriaPicker.jsx:278-330`).
- **Benchmark:** thinkorswim Condition Wizard, TC2000 EasyScan Wizard and TrendSpider visual scripting [WS7 D/P]. [WS4 G-8]

**P2-10 — two screening languages; no formula columns.**
- **Evidence:** the screener where-grammar (`api/services/screener/grammar.py`) and its English compiler are separate from the indicator AST. Watchlist columns serve native definitions only (`serverCompute`).
- **Why it matters:** TC2000's defining strength is **the same PCF in scan, sortable column, alert and plot** [WS7 D]. UCT has the shared tree for chart, colour, alert and scan, but not columns. [WS4 G-9]

**P2-11 — missing classics.**
- Formula table lacks: supertrend, obv, alma, dema/tema, kama, sar, variance, zscore, `hl2`/`hlc3`/`ohlc4`, `%`, `**`.
- 27 of 33 chart-only "Tier-1" studies have no formula, alert or screener primitive. [WS4 G-6; WS1 G-1]

**P2-12 — source and inputs on import.** Pine and thinkScript source is not stored, so re-editing means re-pasting; `input.string` options, `input.source`, `input.timeframe` and `input.symbol` are frozen. [WS5 G11–G12, WS6 G6]

**P2-13 … P2-18 — smaller correctness and hygiene items.**
- **P2-13:** Session VWAP/AVWAP are hidden on 2, 3, 10, 45, 65, 120, 195 and 240-minute charts with a vague pill.
- **P2-14:** the alert evaluator turns a NULL OHLC into 0.0 (`indicator_alert_evaluator.py:1113-1118`).
- **P2-15:** red rails beyond the concierge:
  - 7 on master:
    - 3 starter-grounding (screen removed in `602f8865ab`);
    - 1 starter docstring false positive;
    - 1 duplicate paywall sentence;
    - 2 escape-census.
  - 3 more in `test_phase_e_acceptance`: stale `~s2` semantics-hash lookup after `a06b45b7a8`. The lead checked this; it is test drift (medium confidence).
  - The escape-census harness hits a RecursionError on Windows/Py 3.12.10. **Run it on the Linux production image to confirm it is green.**
- **P2-16:** formulas run on the main thread.
- **P2-17:** `ltf()` and `text_*` save, but no consumer computes them.
- **P2-18:** PCF XAVG/MACD are labelled "Exact" without disclosing the seed difference.

---

## Known red tests: verdicts (no failure dismissed without a baseline)

| Failure | Count | Cause | Baseline evidence | Verdict |
|---|---|---|---|---|
| `test_definition_concierge.py` | 5 | 4: fixture uses `dev(close,5.0)` as "repainting"; the correct lint fix `50e43e7459` (10-07) now reads `5.0` as 5. 1: corpus gap for 4 starter screens from `602f8865ab` (09-20) | Bisect: parent of `50e43e7459` fails 1, `50e43e7459` fails 5 | Test drift. Production correct. LOW risk |
| `test_compute_graph` / `param_manifest` / `param_repaste_c46` / `graph_wire_size` | 68 | Fixtures lack `definition.version` after `4b9796e968` (10-08) | Failure text is the version refusal | Test drift, **but it disables security rails** → P1-1 |
| `test_starter_library.py` | 4 | 3 grounding (`starter_leaders_pullback` removed 09-20); 1 docstring false positive (`40c82dc9ec`) | Commit history | Drift; the starter card still renders from static JSON |
| `test_phase_e_acceptance.py` | 3 | Expects bare `def_hash`; results are keyed `…~s2` since `a06b45b7a8` (10-06) | Older baselines error at collection (environment) | Test drift, medium confidence |
| `test_user_definitions_auth::…PER_ROUTER` | 1 | Three screener routers share one paywall sentence | Known on master | Drift |
| `test_ast_interpret` / `test_ast_conformance` escape census | 2 | `json.dumps` of a 4,000-deep tree → RecursionError on Windows | **Not baselined: needs the Linux production image** | Open |
| `EvidenceTab.doors` "ANTI-ROT" | flaky | Walks and parses all of `app/src` (663 ms alone, 15 s cap) under a saturated pool | Passes alone, 74/74 | Load timeout, not a deadlock (P3) |

---

## P3 — polish backlog (abridged; full list in the appendices)

**Rendering** [WS2 G10–G12]
- `zorder.js`/`textLayout.js` have no runtime importer.
- `paneHeightMismatch` verifier ignores reorder and resize; it gives false console warnings, though the layout itself is correct.
- `histbase`, baseline baseValue and plot offset are absent ("Coming soon").
- Table cell width/height/tooltip are not carried.
- The legend value colour is static.
- `setInstancePanePosition` writes a field nothing reads.
- `plotchar` glyphs are drawn as circles.
- 8 of 12 Pine shapes are approximated.
- `style_linebr` bridges `na` gaps.

**Lifecycle** [WS3 G10–G11]
- Pane-above-price, dot size and numeric pane size have no UI.
- Templates flag: the ledger says "armed" but the baked value is "undefined" — verify.
- `mergeSettingsOverride` cannot clear a field.
- Tombstones accumulate.
- Search is substring-only with no aliases.
- Stale comments.
- Agent:
  - "remove rsi" with two RSIs gives not-found;
  - there is no `discardDraft`;
  - Agent drafts are evicted silently.

**Language** [WS4 G-11…G-14]
- The scan preflight is optimistic.
- `vwap()` on daily bars: the lanes disagree (blank vs hlc3).
- Read-back is robotic ("rising for 1 bars").
- The budget allows about 30–40 distinct terms.

**Calculation** [WS1 D-7…D-12]
- NaN-hole policy differs between native and formula lanes.
- One NaN volume blanks session VWAP.
- "Power Earnings Gap" is misnamed.
- `computeFor` does not validate inputs.
- Volume Profile is approximate and untested.
- The RS line is rounded to 6 dp.

**Security, hardening only** [WS8 G5–G12]
- No prompt-length cap on `/propose`.
- No per-user USD cap on vision.
- Telemetry POST is unrate-limited.
- Runtime strings are not charged to memory.
- No gated performance benchmark.
- Vision trusts Content-Type.
- No client cap on other-symbol fetches.

**Import** [WS5 G13–G17; WS6 G8, G10–G14]
- False repaint flag on `lookahead_on`+`[1]`.
- Machine read-back used as the description.
- The parity summary is stale (17 vs 336 captures).
- Screener-framed notes appear in the chart builder.
- Bulk intake rejects valid PCF.
- `Crosses()` function form gives a misleading error.
- PCF fundamentals other than market cap are refused.

---

## What is verified solid (so we do not rebuild it)

- **Calculation core:**
  - SMA, EMA (SMA-seeded like Pine), Wilder RSI, Bollinger (population SD, like TradingView), MACD, session VWAP (ET anchor), Stochastic, OBV and ATR (`atrPine`) match textbook definitions to ≤1.6e-13.
  - Python and JS lanes agree to 1e-11 on 19 columns.
  - No lookahead in 52 natives × 4 truncation points except Chikou, which declares it.
  - MTF daily → 5m has zero lookahead. Deterministic. [WS1]
- **Shared formula tree:** one manifest, one parser and two interpreters agree on 97/98 admitted formulas across chart, condition, scan and alert lanes. One type authority; one permission gate (`evaluability.js:343`). [WS4]
- **Sandboxing and boundaries:**
  - No `eval` or `new Function` anywhere in the chart engine; the server interprets trees.
  - Agent routes are admin-only server-side (`uct_agent.py:63`). The Pine runtime save is gated server-side per call.
  - Every read is scoped by user. 128-bit revocable share tokens. XSS-safe table cells; colour allow-list. [WS8]
- **Persistence:** deterministic instance ids that are never reused; instances independent through edit and reload; the definition store is append-only with history and 409-conflict revision checks. [WS3]
- **Import maths:** every Pine plot that reaches the chart in the 16-script corpus is numerically exact. 13 of 14 importable PCF formulas are exact; every translated thinkScript plot except script 07 is exact. Honest, specific refusals exist for many cases (TC2000 `RSI`→`WRSI`, session functions, `TTM_Squeeze`, negative offsets). [WS5, WS6]
- **Tests:** about 615 frontend indicator test files and 64 core backend files. Targeted runs in this audit: frontend 3,932 + 1,941 + 1,525 + 1,005 + 754 + 588 + 274 passed with 0 failures; backend ring-1 2,410 passed / 12 failed (all classified above). [WS1–WS8]

## Limitations of this audit

- **Production environment not read.** Flag states come from the repo ledger (`docs/feature_flags.json`) and code defaults; the live production environment was not read (production reads are not permitted from this session). Two build flags have contradictory ledger entries ("armed" but baked value "undefined"): `VITE_INDICATOR_TEMPLATES_ENABLED` and `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`.
- **Limited browser verification.** One synthetic-data session: Ichimoku confirmed, and the Pine paste-box verdict observed. The member-pane chart door was not exercised in a browser, because the local dev build does not set `VITE_PINE_MEMBER_PANE_ENABLED`, and changing flags was out of scope. G1 and G3 rest on code plus probes.
- **Benchmarks** were taken under shared CPU load; ratios only. A clean methodology is in WS8 §A4.
- **No paid AI calls.** The concierge, conversation and vision lanes were assessed via code and mocked tests only.
- **Competitor facts** are from public documentation checked 2026-10-13 (WS7). Several cells are UNKNOWN by design.
