# UCT Indicators — Executive Summary

**Date:** 2026-10-13
**Scope:** audit of production (master = production `84164aee3d`). No code, configuration or production state was changed.
**Detail:** the five companion documents in this folder, plus eight evidence appendices.

## How complete is our indicator system?

**The core is solid and correct. The edges are where it lets traders down.**

- **The maths is right.** I recomputed the main indicators independently: moving averages, RSI, Bollinger Bands, MACD, VWAP, Stochastic, OBV and ATR. They match the textbook definitions to rounding error. The browser and the server produce the same numbers, so a chart, an alert and a scan agree. There is no lookahead, and the same input always gives the same output.
- **The breadth is mid-tier.**
  - 55 built-in indicators: 13 fully working, 41 working with limitations, 1 partial (Ichimoku).
  - A formula language with 79 functions.
  - Imports from TradingView, thinkorswim and TC2000.
  - That is respectable, but well short of TradingView (400+ built-ins) or thinkorswim (300+).
- **Advanced traders hit walls quickly.** Indicator lengths can't be settings inside a formula. Formulas can't read daily data on an intraday chart. A formula can't reuse another indicator. In production there are no loops or running state.
- **Some promises are broken.** Seven findings meet the brief's definition of P0 (below). Most concern imports or settings, not the core maths.

## What are we already doing particularly well?

1. **Cross-platform import is genuinely ours.** No competitor deterministically imports scripts from several other platforms. TrendSpider uses AI translation, and TradingView only upgrades its own versions. Every import that reaches the chart computes correctly, apart from the three P0s below.
2. **Transparency.** Every formula is explained in plain English, generated from the formula itself rather than by an AI. Repainting is measured and disclosed. Chart, alert and scan are guaranteed by tests to compute the same value.
3. **One formula works across chart, candle colours, alerts and scans.** Both of the owner's example ideas can be expressed and rendered today:
   - green candles when the 9 EMA is above the 20 EMA on rising volume;
   - highlighting RSI above 70 over a rising 50-day MA.
4. **Safety.** Formulas are interpreted, never executed as code. Paid, admin and dark features are enforced on the server.
5. **Proprietary market data no charting rival has:** UCT breadth series, 193 market-indicator series, 237 economic series and the RS line.

## What are our biggest weaknesses?

1. **Imports sometimes say "Exact" when they are not.**
   - A TC2000 Stochastic imports with its inputs in the wrong order.
   - A thinkorswim weekly average imports as a daily one, while the message says "the values are the same".
   - A Pine running total covers only the bars we have loaded.
   - The Pine paste box and the chart give contradictory verdicts on the same script.
2. **Indicator settings are fragile.** Turning an indicator off from the Library or with a keyboard shortcut deletes every copy of it, including tuned settings. Nothing undoes indicator changes.
3. **Imports lose their visual styling.** No thinkScript import kept its styling in our tests: arrows, histograms, colours, levels and clouds were all lost. Pine imports lose levels, line widths and arrows.
4. **Expressiveness ceiling.** Most stateful Pine scripts (59% use `var`) are blocked in production. The engine that runs them exactly exists, but is switched off by owner decision.
5. **Workflow.** There is no "apply to all charts", no indicator sync across charts, and no undo.

## Where do we match or exceed competitors?

Scores are 0–5 on one rubric for every platform. The full table, with evidence and confidence, is in `02-COMPETITIVE-BENCHMARK.md`.

| Area | UCT | Best competitor |
|---|---|---|
| Cross-platform import | **4** | TrendSpider 3 (AI-based); others 0–1 |
| Calculation transparency | **4** | StockCharts 5 (ChartSchool) |
| Same formula in chart, alert and scan | 3 | TC2000 5 (also as watchlist columns) |
| Rendering | 3 | TradingView 5 |
| Expressiveness, MTF, advanced power | 2 | TradingView 5, TrendSpider 5 |
| Workflow | 2 | TradingView 5 |
| AI for members | 2 | TrendSpider 5, TradingView 4 |
| Backtesting | 1 | TradingView 5, TrendSpider 5 |

## Top five improvements to prioritise

1. **Make every import honest and correct.**
   - Fix the three wrong-value imports.
   - Show one verdict per import.
   - Report values, visuals, inputs and behaviour separately.
   - Never say "Exact" without proof.
2. **Protect traders' configured studies.** "Off" should never delete other copies. Make every indicator change undoable, and say so when an indicator can't be shown.
3. **Keep visuals on migration.** Carry Pine levels, line widths and arrows, and thinkScript arrows, histograms, colours, clouds and placement. Finish the in-progress thinkScript styling work, with its owner.
4. **Lift the formula ceiling.**
   - Lengths as settings.
   - "Price crosses VWAP".
   - Daily and hourly data on intraday charts.
   - The missing classics: SuperTrend, OBV, ALMA and others.
   - Every addition reaches every import door at once.
5. **Formula columns and "one condition, many surfaces."** A user formula as a sortable, colour-coded watchlist or screener column. One saved condition driving candle colour, an alert and a scan together, edited once.

## What would make UCT genuinely different?

- **The trusted place to migrate to.** Paste a whole set of TradingView, thinkorswim or TC2000 indicators. Get an itemised, honest report. "Exact" means it was checked against the original platform's numbers.
- **Market-aware indicators.** Formulas that read UCT breadth, regime and relative strength. For example: colour candles only when breadth is healthy. No competitor offers this, and the data already exists in UCT.
- **Build once, use everywhere.** The same formula on the chart, the candles, the watchlist column, the alert and the scan, without copy-paste drift.
- **Explain every number.** Plain-English calculation explanations generated for every indicator and formula.

## What should we build first?

**Phase A — Stabilization**, starting with three items:
1. **Fix the import P0s.** Correct `STOC`, thinkScript weekly/monthly reads and Pine `ta.cum`. Each fix gets a test against independent maths.
2. **One honest import verdict.**
3. **Protect configured studies.**

All three are mostly medium-sized and need no new architecture. They protect the migration story before it grows.

The full phased plan is in `04-RECOMMENDED-ROADMAP.md`:
- Phase A: Stabilization;
- Phase B: Parity;
- Phase C: Differentiation;
- Phase D: Advanced intelligence.

## Critical defects found (P0)

I confirmed P0-1, P0-2, P0-4 and P0-6 in the code myself. P0-4 is also confirmed in the browser.

| ID | Defect |
|---|---|
| P0-1 | TC2000 `STOC` imports with its inputs in the wrong order. Values are wrong, and the label says "Exact import" |
| P0-2 | thinkScript weekly and monthly reads inside functions compute on daily bars. The label says "the values are the same" |
| P0-3 | Pine `ta.cum` is drawn over loaded bars only, with no disclosure. The paste box refuses it for exactly that reason |
| P0-4 | The Ichimoku cloud isn't projected forward and has no fill. Cloud alerts inherit the error. The code calls this a "preserved quirk" awaiting owner sign-off |
| P0-5 | The "Last value horizontal" plot style just draws a normal line |
| P0-6 | Turning an indicator off from several surfaces deletes every copy of it and its settings, with no undo |
| P0-7 | Pine import verdicts contradict what the chart does |

**Also urgent (P1):** 68 backend security and integrity tests have been red since 10-08 because of a fixture change. Production is still protected, but a regression in those guards would no longer be caught. The fix is about a day.

## Confidence and limitations

- **Live production not read.** The production environment wasn't readable from this session, so feature-flag states come from the repository's flag ledger. Two ledger entries contradict themselves.
- **Limited browser checks.** I ran one session on synthetic data only. Some rendering findings rest on code reading plus probes.
- **No paid AI calls.** The AI features were judged from code and mocked tests.
- **Competitors from public docs only.** Facts are from public documentation checked today. I tested no competitor products hands-on, and unverifiable cells are marked unknown.
- **Shared-machine benchmarks.** Performance was measured with other work running on the same machine, so only ratios are reported.
