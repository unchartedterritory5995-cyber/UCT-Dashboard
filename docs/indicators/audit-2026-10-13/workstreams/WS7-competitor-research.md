# WS7: Competitive Benchmark Research (Indicators)

- Audit: UCT Indicators audit, 2026-10-13
- Scope: what competitors can do, from public sources only. UCT is not described or scored here.
- Method: WebSearch and WebFetch of official docs, product pages and blogs. No logins, no accounts. All sources were checked on **2026-10-13**.
- Evidence tags:
  - **[DOC]** official documentation or help center;
  - **[PRODUCT]** official marketing, pricing or blog page;
  - **[COMMUNITY]** third-party reviews, forums or GitHub;
  - **[UNVERIFIED]** could not confirm.
  - UNKNOWN means not established.
- Caveat: vendors' comparison pages (for example Deepvue's "vs" pages) are [PRODUCT] about the vendor itself, but only [COMMUNITY]-grade when they describe a rival.

## Competitors covered and why

| Platform | Why included |
|---|---|
| TradingView | Required. The de facto scripting benchmark (Pine Script v6). |
| TC2000 | Required. The PCF, EasyScan and watchlist-column benchmark for momentum and swing traders. |
| TrendSpider | Required. JavaScript scripting, AI coding and automated technical analysis. |
| Deepvue | Required. The modern growth/momentum benchmark (RS rating, preset scans). |
| thinkorswim (Schwab) | Required. thinkScript and the Condition Wizard. |
| StockCharts | Required. Scan syntax, ACP, ChartSchool transparency. |
| **MarketSurge (IBD)** (added) | The incumbent momentum/CAN SLIM tool (RS line and blue dot, RS rating, patterns). It sets the baseline for proprietary-rating workflows that have no scripting. |
| *PineTS / Vela (LuxAlgo)* (noted, not profiled) | Not a competitor charting platform in the user's list. It is included in the import landscape because it is the only native Pine runtime found outside TradingView. This bears directly on the migration goal. |

NinjaTrader, MotiveWave and Sierra Chart are not profiled. They appear only in the import landscape (community evidence that none offers a Pine import).

---

## 1. Per-competitor profiles

### 1.1 TradingView

**Built-ins and community.** TradingView claims "400+ built-in indicators and strategies", 100,000+ public community indicators and 21 chart types [PRODUCT, tradingview.com/features].

**Language.** Pine Script v6 (released November 2024 [DOC, release notes]). It is written in a cloud Pine Editor. The editor moved to a side panel with split view in August 2025, and it offers autocomplete, version control, a profiler and a debugger [DOC/PRODUCT]. There is no visual or no-code builder. Since September 2026, AI Copilot can write Pine (see AI below).

**Expressiveness** [DOC]:
- Loops: `for`, `while` and `for…in` loops with break/continue. The loop timeout is 500 ms per bar.
- Collections and types: arrays, matrices and maps (100,000 elements; maps 50,000 pairs). Also user-defined types (UDTs), methods, enums, user functions, and `var`/`varip` state.
- Data requests: `request.security` and `request.security_lower_tf` cover other timeframes and other symbols. Requests have been dynamic by default in v6 (series arguments, calls inside loops and conditionals). Other request functions:
  - `request.financial`, `request.economic`, `request.earnings`, `request.dividends`, `request.splits`;
  - `request.seed`, `request.currency_rate`;
  - `request.footprint` (January 2026).
- Drawing objects: line, label, box, polyline, table and linefill.
- Libraries: you can export functions, methods, UDTs, enums and (since June 2025) constants. Libraries must be published, either publicly or privately, and are imported with a pinned version.

**Rendering** [DOC]:
- `plot` has many styles. Dashed and dotted `linestyle` arrived in September 2025.
- Other visual calls: `fill`, `bgcolor`, `barcolor`, `plotshape`, `plotchar`, `plotcandle` and `plotbar`.
- Labels and tables. Since September 2026, tables can move to a bottom-panel tab.
- Colour is set per bar through series colour arguments.

**Panes** [DOC, support]:
- Indicators can be moved between panes ("Move To", or drag), merged into the main pane, and maximized with a double-click.
- Up to 16 charts per tab on Ultimate [PRODUCT, pricing].
- No documented cap on pane count (UNKNOWN).

**MTF.** In scripts through `request.security`. On the chart, built-ins expose a timeframe input [DOC].

**Cross-symbol.** Through `request.security` with any symbol. On the chart, Compare/overlay and spread expressions [DOC/PRODUCT]. *Spread-expression syntax was not re-verified this session.*

**Alerts** [DOC]:
- `alert()` and `alertcondition()` work on custom scripts. "TradingView alerts run 24x7 on our servers".
- Alerts fire only on realtime bars, and they snapshot the script and settings when created.
- Tier counts are in §5.

**Screener.** The Pine Screener (Premium and above) runs one Pine indicator per screen over a watchlist or an index of up to 4,000 symbols [DOC]:
- The script's plots become columns and filters. It also supports `alertcondition` filters.
- At most 40 `request.*` calls.
- Fixed timeframes only: 1, 5, 15 and 30 minutes; 1, 2 and 4 hours; 1 day, 1 week and 1 month.
- No indicator-on-indicator.
- Results need a rescan. The update was not continuous [DOC].
- Since 1 September 2026 it can scan index constituents and pick any script, including invite-only and purchased ones [PRODUCT, blog].

**Backtesting** [DOC/PRODUCT]:
- The Strategy Tester has a 9,000-order cap, or 1,000,000 with Deep Backtesting.
- July 2026 added `calc_on_every_history_tick` and a bar-detalization menu [DOC].

**Sharing** [DOC/PRODUCT]:
- Scripts can be published open-source, protected or invite-only (invite-only needs Essential or above).
- Private libraries.
- Since 14 August 2026, a moderation-first review applies to public scripts, with a limit of 5 new public scripts per 24 hours and 15 per 30 days.

**AI.** AI Copilot entered public beta as a Chrome extension on 2 April 2026 and became native in Supercharts on 28 September 2026 [PRODUCT, blog]. It:
- writes Pine indicators and strategies, compiles them, reads errors and fixes them, then adds them to the chart [DOC, support 43000795135];
- also edits charts, draws levels, screens, manages watchlists and alerts, and analyzes fundamentals and news [DOC, support 43000795131].

It is a paid add-on on all paid plans, with an undisclosed monthly usage cap [DOC]. The older support article "Will AI help me write…" still warns that AI "hallucinate[s] language features" [DOC].

**Limits** [DOC, Pine limitations]:
- Execution: 20 s total (Basic) or 40 s (other plans); 500 ms per-bar loop; 2-minute compile.
- Visuals: 64 plots; 500 lines, labels and boxes; 100 polylines; 9 tables.
- Data: 40 `request.*` calls (64 on Ultimate); 100,000 to 200,000 intrabars.
- Size: 100,256 compiled tokens; 1,000 variables per scope.
- History: `max_bars_back` 5,000 (10,000 for OHLCT); 500 bars forward.

**Transparency.** Built-in indicator help pages exist, and many built-ins are viewable as Pine source. *Source visibility for every built-in was not re-verified (UNKNOWN for "all").*

**Workflow** [DOC]:
- Indicator templates.
- "Add this indicator to the entire layout" and "Apply these indicators to the entire layout".
- Layout sync of symbol, interval, crosshair, time and drawings.

**Unique.**
- The largest public script ecosystem.
- Pine Screener.
- Server-side alerts on any script.
- Copilot that writes Pine.

### 1.2 TC2000 (Worden)

**Built-ins.**
- The official Built-in Indicators Table in the PCF help lists about 40 indicators with PCF syntax [DOC].
- Third-party reviews claim "100+" to "240+" chart indicators [COMMUNITY]. The exact count is UNKNOWN.

**Language.** Personal Criteria Formulas (PCF) [DOC]:
- An expression language: price variables with offsets (`C`, `C1`, `H(10)`), built-in functions (`AVGC20`, `XAVGC9`, `MAXH52`, `MINL`, and so on), arithmetic, relational and boolean operators, `IIF`, `CountTrue`, `SinceTrue`, `TrueInRow`, `XUP`/`XDOWN`, `GREATEST`/`LEAST`, and trigonometric functions.
- TC2000 itself says PCF "isn't a full scripting or programming language".
- No visual editor for PCF itself. The EasyScan Condition Editor and Wizard is the no-code path [DOC].

**Expressiveness** [DOC]:
- No loops, arrays, user functions or variables are documented. Bounded-period functions only ("cannot be left open ended").
- A PCF's timeframe is the one set for the PCF or the chart. The help says "there is not an automated way" to compute daily values on an intraday timeframe.
- Cross-symbol inside PCF is not documented (UNKNOWN; likely no).
- "Custom PCF Child Indicator" can reference any plotted indicator, including ones PCF cannot express (Relative Strength, PSAR, bid/ask).

**Rendering** [DOC/PRODUCT]:
- PCFs plot as **Custom PCF Indicator**, **% True** and **Channel** indicators.
- Version 25 (January 2025) added "conditional color palettes on price & indicators" and "plot past performance of conditional colors".

**Panes.** Supported. A child indicator overlays and scales with its parent [DOC]. Pane limits: UNKNOWN.

**MTF.** Timeframe linking between windows [DOC]. In-formula MTF is not supported (see above).

**RS.** Relative Strength indicator, usable as a PCF child [DOC]. Price overlay of another symbol: UNVERIFIED.

**Alerts** [DOC/PRODUCT]:
- Price, trendline, EasyScan, indicator-condition and PCF ("Write Formula") alerts.
- Email, text, and mobile push (February 2026 [COMMUNITY]).
- 100 concurrent alerts on Premium and 1,000 on Premium Plus [PRODUCT, pricing].
- Server-side execution while the app is closed: UNVERIFIED.

**Screener** [DOC/PRODUCT]:
- EasyScan uses PCF conditions.
- **The same PCF is used as a watchlist value column and a sortable column.** Condition columns show true or false with a colour and a sort direction (Condition Editor Display tab).
- "Live auto-refreshing filters & sorts", and up to 5 streaming scans on Premium Plus.
- **Market Indicator / Market Gauge** plots how many stocks pass a scan historically, over 1,500 bars.

**Backtesting.** No strategy backtester (UNVERIFIED negative). Historical condition testing comes through Market Indicator plots [DOC].

**Sharing.** UNKNOWN (no official doc found on PCF sharing or protection).

**AI.** None documented. A Deepvue comparison page states TC2000 has no conversational AI [COMMUNITY-grade].

**Limits.** No PCF length or bar limits are documented (UNKNOWN). PCFs require Premium (Gold) or above [PRODUCT].

**Transparency.** Strong. Help pages give each indicator's formula and PCF syntax [DOC].

**Unique.** EasyScan, plus a PCF used everywhere (scan, column, sort, alert, plot), plus condition-coloured columns and Market Indicator breadth-of-scan plots.

### 1.3 TrendSpider

**Built-ins.** Counts conflict between its own pages: "120+", "300+" and "400+" [PRODUCT]. Treat it as roughly 300 (low confidence).

**Language** [DOC, help kb]:
- Plain JavaScript.
- A built-in VS Code-based editor, or your own IDE with sync, with browser dev-tools debugging.
- No-code paths: a visual script editor, a no-code Strategy Tester and Scanner, and "human language scripting" (14 October 2025) for scans [PRODUCT].

**Expressiveness** [DOC/PRODUCT]:
- Full JavaScript: loops, arrays, functions and state.
- `request.history(symbol, timeframe)` for other symbols, timeframes and chart types.
- HTTP GET to third-party APIs and select NPM packages.
- Helpers for trendlines, patterns and candlesticks.

**Rendering** [DOC]:
- Lines, signals, histograms and candle colouring.
- HTML overlays, including tables and charts.
- *A fill and cloud API list was not retrieved (platform-docs page rendered empty).*

**MTF.** Multi-Timeframe Analysis overlays higher-timeframe indicators, patterns, trendlines and Fibonacci levels on lower-timeframe charts [PRODUCT].

**RS.** Price Compare indicator, and a "Symbol" input on all lower indicators [PRODUCT blog].

**Alerts.** Custom indicators work in alerts, scanners, strategies and bots [DOC]. Dynamic trendline and pattern alerts. Counts are in §5. Server-side: yes, implied by bots and scheduled scans, but not explicitly verified (UNVERIFIED).

**Screener.** Custom JS indicators are usable in scanners [DOC]. Scheduled scans: 3 to 10 depending on plan [PRODUCT].

**Backtesting.** No-code Strategy Tester. Depth runs from 2,000 to 30,000 bars and 50 to 510 symbols depending on plan [PRODUCT].

**Sharing** [PRODUCT blog]:
- Link-based sharing with optional hidden source, using "code minification, obfuscation, and AES-based encryption".
- An add-on marketplace [DOC].
- No public script library was found.

**AI** [DOC/PRODUCT]:
- An AI Coding Assistant (Claude 4.5) in the editor (Ctrl+K). It writes and debugs indicators and **translates indicators from other platforms when you paste the source**.
- Sidekick agentic coding (29 April 2026) builds step by step and checks the rendered output. It uses credits; all plans include 25 free Sidekick messages per month.
- AI Strategy Lab (machine-learning models).

**Limits.** Script runtime limits are not documented in what was retrieved (UNKNOWN).

**Unique** [PRODUCT/DOC]:
- Automated trendlines, Fibonacci levels and pattern detection.
- Patented Raindrop charts.
- Strategy bots.
- An official Code Conversion program: TrendSpider quotes for converting an indicator "from whatever language" into its JavaScript. *The fetched page content conflicted with the search snippet, so this is medium confidence.*

### 1.4 Deepvue

**Built-ins.**
- "276 technical measures" as conditions and columns.
- 166 technical column fields.
- DV-branded proprietary indicators: RS Line, Stage Analysis, AVWAP, Enhanced Volume, Market Cycle, RMV, ADR %, TTM Squeeze, Webby RS variants [PRODUCT/DOC].

**Language.** None. Its knowledge-base "Custom Indicators" are Deepvue-built configurable indicators, not user scripts [DOC]. The screener is drag-and-drop ANY/ALL groups "without a formula bar or syntax" [PRODUCT].

**Rendering, panes, MTF.** Not documented in detail (UNKNOWN).

**RS** [PRODUCT]:
- Native RS, EPS and Composite ratings, shown everywhere: screens, charts, watchlists.
- RS Line.

**Alerts.** Price, trendline and indicator alerts by email, SMS or pop-up. Deepvue says "deeper automation… on the way" [PRODUCT/DOC]. Counts: UNKNOWN.

**Screener.** 100+ preset screens from named traders and 200+ filters. Every column is filterable and sortable [PRODUCT].

**Backtesting.** None. Deepvue describes itself as "designed around live discretionary research" [PRODUCT].

**Sharing.** UNKNOWN.

**AI.** Deepvue AI: right-click "why did it move", watchlist summaries and plain-English screen building [PRODUCT].

**Pricing.** $49 per month, or $41 per month billed annually; one plan [PRODUCT].

**Unique.** Momentum-native ratings and presets with zero coding.

### 1.5 thinkorswim (Schwab)

**Built-ins.** "400+" or "300+" studies per Schwab pages (via search; schwab.com fetch was blocked) [PRODUCT, medium confidence].

**Language.** thinkScript, written in the thinkScript IDE. No-code path: the **Condition Wizard**, used for Study Alerts, Custom Quotes and Stock Hacker filters [DOC].

**Expressiveness** [DOC]:
- Variables and state:
  - `def`, `rec` (recursive variables);
  - `CompoundValue` to seed recursion;
  - `if`/`switch`, `input`, `declare`.
- Iteration: `fold … with … while … do` (bounded iteration). No `for`/`while` statements outside `fold`.
- No arrays or maps (none among the reserved words or documented constructs; absence-based, medium confidence).
- User functions through `script {}`. `reference` calls built-in studies.
- Cross-symbol: `close("GOOG")`.
- Secondary aggregation (MTF) through `period = AggregationPeriod.X`, but **only at or above the chart period**, and one secondary period per variable.
- No drawing-object API: there are no line or label objects with IDs. Libraries: none.

**Rendering** [DOC]. Look & Feel functions:
- `AddCloud`, `AddLabel`, `AddChartBubble`, `AddVerticalLine`;
- `AssignPriceColor` (bar colour), `AssignBackgroundColor`, `AssignValueColor` (per-bar colour), `AssignNormGradientColor`;
- `SetPaintingStrategy`, `SetStyle`, `SetLineWeight`, `DefineGlobalColor`, `Hide`, `SetChartType`, and others (26 functions).

**Panes.** Upper and lower subgraphs. Detailed pane controls were not verified (UNKNOWN).

**Alerts** [DOC]:
- Study Alerts on custom studies or expressions. They need **exactly one plot**, and colour/look inputs are unavailable.
- Server-side execution and alert counts are not documented (UNKNOWN).

**Screener** [DOC]:
- Stock Hacker study filters accept thinkScript with exactly one plot. **Secondary aggregation is not allowed.** Up to 25 filters.
- Data windows: 15 days for 1–30-minute bars, 270 days for 1–4-hour bars, 4 years for 1–4-day bars, 6 years for weekly, 20 years for monthly.
- Custom Quotes (watchlist columns) run thinkScript with one plot. They support recursion and `AssignBackgroundColor`. Columns are sortable.

**Backtesting.** Strategies use `AddOrder`, and the Strategy Report gives P/L on chart signals [DOC]. The thinkOnDemand replay tool was not re-verified.

**Sharing.** tos.mx share links for studies, strategies, scans, custom quotes and more, with update history [DOC]. Code protection: none documented.

**AI.** None for thinkScript. Schwab's "Charley" assistant (from October 2026) targets Schwab.com and the mobile app, not thinkorswim scripting [PRODUCT, press release].

**Cost.** Free with a Schwab account [COMMUNITY-common knowledge; not re-verified, UNVERIFIED].

**Unique.**
- The Condition Wizard bridges no-code and code.
- One study definition reused across chart, column, scan, alert and conditional orders.

### 1.6 StockCharts

**Built-ins.** "Dozens" of indicators and overlays in ACP [DOC]. 14 new and enhanced SharpCharts indicators in June 2026 [PRODUCT, via search; What's New fetch failed]. The exact count is UNKNOWN.

**Language.** No user indicator language:
- Scan syntax is used for advanced scans and technical alerts [DOC].
- Custom series can be uploaded as a User Defined Index (Extra and above) [COMMUNITY, StockCharts forum].
- Free and paid ACP plug-ins come from StockCharts [DOC].

**Expressiveness.** Scan syntax offers indicator clauses with parameters, arithmetic, min/max, percent change, candlestick and point-and-figure patterns, and group or ChartList membership [DOC]. Timeframe offsets and user variables were not verified (UNKNOWN).

**Rendering and panes** [DOC]:
- ACP has up to 12 chart panels.
- Indicator panels can be repositioned.
- Templates and colour schemes.

**RS** [DOC]:
- Ratio symbols such as `IBM:$SPX` work anywhere a ticker can be entered, with formulas documented per OHLCV field.
- Difference symbols.
- Price Relative indicator and RRG charts.

**Alerts.** Price alerts from the chart. "Advanced alerts" use scan syntax. Counts are in §5.

**Screener.** Advanced Scan Workbench, plus "The Screener" (no syntax, 17 July 2026) [PRODUCT, via search].

**Backtesting.** None found (UNKNOWN).

**Sharing.** Public ChartLists exist (not re-verified).

**AI.** Chat Assistant that explains indicators and workflows [PRODUCT article]. No code generation found.

**Transparency.** **ChartSchool** is the best-documented calculation reference among the competitors: per-indicator formulas, including ratio-symbol OHLC math [DOC].

**Unique.** ChartSchool, ratio-symbol syntax everywhere, and RRG.

### 1.7 MarketSurge (IBD), added

- **Built-ins.** About "70+ technical or fundamental data points", proprietary IBD ratings (RS, Composite, EPS), the RS Line, and "RS Line Blue Dot" lists [COMMUNITY; investors.com is blocked to the fetch tool].
- **Language.** None found (UNKNOWN; likely none).
- **Screener.** Custom screens over 8,000+ stocks and ETFs [COMMUNITY].
- **Patterns.** Automated base-pattern recognition with buy zones [COMMUNITY].
- **Pricing.** $149.99 per month or $1,499 per year [COMMUNITY].

---

## 2. Dimension × competitor matrix

Legend:
- D = [DOC], P = [PRODUCT], C = [COMMUNITY], U = UNKNOWN or UNVERIFIED.
- TV = TradingView; TS = TrendSpider; DV = Deepvue; TOS = thinkorswim; SC = StockCharts; MS = MarketSurge.

The matrix is split into three tables of six dimensions each, with the same columns.

**Dimensions 1–6: languages, rendering, panes and timeframes**

| Dimension | TradingView | TC2000 | TrendSpider | Deepvue | thinkorswim | StockCharts | MarketSurge |
|---|---|---|---|---|---|---|---|
| 1. Built-in breadth | 400+ built-ins (P) | about 40 in PCF table (D); 100–240+ (C) | 120–400+, conflicting (P) | 276 measures (P) | 300–400+ (P) | "dozens" (D) | about 70+ data points (C) |
| 2. Custom creation | Pine v6, cloud IDE; no visual builder (D) | PCF expressions + Condition Editor (D) | JavaScript, VS Code editor, visual scripting (D/P) | none (D/P) | thinkScript IDE + Condition Wizard (D) | none; scan syntax and UDI upload (D/C) | none (U) |
| 3. Expressiveness | loops, arrays, maps, matrices, UDTs, functions, `var`, MTF, cross-symbol, drawings, libraries (D) | no loops, arrays or functions; bounded functions; no in-formula MTF (D) | full JavaScript, `request.history` for MTF and symbols, HTTP, NPM (D/P) | n/a | `rec`, `fold`, `script{}`, cross-symbol, MTF at or above chart period; no arrays, drawings or libraries (D) | scan-clause only (D) | n/a |
| 4. Rendering | plots, fills, bgcolor, barcolor, shapes, labels, tables, per-bar colour (D) | PCF indicator, % True, Channel; conditional colour palettes (D/P) | lines, histograms, candle colour, HTML tables (D) | configurable DV indicators (D) | `AddCloud`, labels, bubbles, price, background and value colour (D) | templates, colour schemes (D) | U |
| 5. Panes | move, merge, maximize; 16 charts per tab (D/P) | child overlays parent (D); otherwise U | U | U | upper and lower subgraphs (U) | 12 panels; reposition (D) | U |
| 6. MTF | script + chart (D) | timeframe linking only (D) | MTF overlay (P) + script (D) | U | higher timeframe only; not in scans (D) | U | U |

**Dimensions 7–12: data, alerts, screening, testing, sharing and ease of use**

| Dimension | TradingView | TC2000 | TrendSpider | Deepvue | thinkorswim | StockCharts | MarketSurge |
|---|---|---|---|---|---|---|---|
| 7. Cross-symbol and RS | `request.security`, compare (D) | RS indicator via child (D) | Price Compare, Symbol input (P) | RS rating, RS Line native (P) | `close("SYM")` (D) | ratio and difference symbols everywhere, RRG (D) | RS rating, RS Line blue dot (C) |
| 8. Alerts on custom logic | yes, server-side 24x7 (D); 20–1,000 by plan (P) | PCF alerts; 100 or 1,000 (P/D) | yes, on custom JS (D); 10–400 (P) | price, trendline, indicator (P) | one-plot study alerts (D); count U | scan-syntax alerts; 1–250 (P) | U |
| 9. Screener + formula reuse | Pine Screener: plots become columns; 4,000 symbols; one script; Premium+ (D) | **same PCF in scan, column, sort, alert, plot** (D) | custom JS in scanners (D) | presets; columns filterable and sortable; no formulas (P) | thinkScript in scans and columns; one plot; no MTF in scans (D) | scan syntax (D) | custom screens (C) |
| 10. Backtesting | Strategy Tester, Deep Backtesting (D) | condition history only (D) | no-code tester, bots (P) | none (P) | `AddOrder` + Strategy Report (D) | U | U |
| 11. Sharing | open, protected, invite-only, private libraries; moderation from 14 August 2026 (D/P) | U | links, encrypted hidden source, marketplace (P/D) | U | tos.mx links (D) | ChartLists (U) | n/a |
| 12. Beginner no-code | Copilot (P/D); no visual builder | EasyScan Wizard (P/D) | visual scripting, NL scans, AI (P) | drag-drop + AI screens (P) | Condition Wizard (D) | The Screener (P) | presets (C) |

**Dimensions 13–18: power, limits, AI, transparency, workflow and unique features**

| Dimension | TradingView | TC2000 | TrendSpider | Deepvue | thinkorswim | StockCharts | MarketSurge |
|---|---|---|---|---|---|---|---|
| 13. Advanced power | very high | low–medium | very high | low | medium–high | low | low |
| 14. Documented limits | many (§3.1) (D) | none documented (U) | backtest depth (P); runtime U | U | scan data windows (D) | per-tier counts (P) | U |
| 15. AI indicator creation | Copilot writes, fixes and applies Pine; paid add-on (D/P) | none (C) | Claude assistant + Sidekick agent; translates pasted code (D/P) | NL screens (P) | none for thinkScript (P) | chat explains only (P) | U |
| 16. Calculation transparency | built-in docs; much built-in source (D, partial) | formula tables per indicator (D) | U | DV docs per indicator (D) | reference per function (D) | **ChartSchool** (D) | U |
| 17. Workflow | templates; apply to layout; sync (D) | layouts, column sets (D) | workspaces 5–20 (P) | presets (P) | sharing everything (D) | chart templates (D) | lists (C) |
| 18. Unique | Pine ecosystem, Pine Screener, Copilot | EasyScan + PCF columns + Market Indicator | auto trendlines, Raindrop, bots, code conversion | RS, EPS and Composite ratings, trader presets | Condition Wizard, `fold`/`rec` | ChartSchool, ratio symbols, RRG | IBD ratings, blue dot |

Source URLs for each cell are in §6.

---

## 3. Language reference summary

### 3.1 Pine Script v6 (TradingView), [DOC]

**Execution model.** The script runs once per historical bar, then on every realtime tick. Before each realtime recalculation there is a rollback. `var` persists across bars but rolls back intrabar. `varip` escapes rollback and can therefore repaint after a reload. Strategies calculate on bar close unless `calc_on_every_tick` is set. Alerts fire only on realtime bars.

**Constructs:**
- Types: series, simple, const and input qualifiers; UDTs, methods, enums.
- Collections: arrays, matrices, maps.
- Loops: `for`, `while`, `for…in`; `switch`; `once` (August 2026); multiline strings (April 2026); history operator `[]`.
- Data: `request.*` (see §1.1).
- Drawings: line, label, box, polyline, table, linefill.
- Outputs: `strategy.*`; `alert()` and `alertcondition()`.
- Libraries: `import user/lib/version`; exported functions cannot use non-const globals or `input.*`.

**MTF semantics.**
- `request.security(sym, tf, expr, lookahead)`. The documented non-repainting pattern is `expr[1]` with `lookahead_on`.
- `request.security_lower_tf` returns intrabar arrays.
- v6 makes requests dynamic by default.

**Limits.**
- Execution: 64 plots; 40 (or 64) `request.*` calls; 500 ms per-bar loop; 20 or 40 s total runtime.
- Drawings: 500 lines, labels and boxes; 100 polylines; 9 tables.
- Size: 100,256 tokens; 1,000 variables per scope.
- History: `max_bars_back` 5,000 (OHLCT 10,000).
- Strategies: 9,000 orders.

**Version history:**
- v4 to v5: the namespaces (`ta.`, `request.`) and libraries appear.
- v5 to v6 (November 2024):
  - dynamic requests;
  - no implicit int/float to bool, and bool cannot be `na`;
  - const int division returns a fraction;
  - lazy `and`/`or`;
  - `when=` removed;
  - `transp` removed;
  - negative array indices.
- The editor auto-converts **v5 to v6 only**. Earlier versions convert in steps (v4 to v5 has its own converter; *not re-verified*).

### 3.2 thinkScript (thinkorswim), [DOC]

**Execution model.** A bar-series expression language: each `def` or `plot` is a series. `rec` holds self-referencing state, and `CompoundValue(n, visible, historical)` seeds it. There is no tick-level rollback model documented.

**Constructs:**
- Keywords: `def`, `plot`, `input`, `declare` (lower, upper, `hide_on_intraday`, …), `rec`, `if/then/else`, `switch/case`, `fold i = a to b with v = init while cond do expr`, `script Name { … }` (user functions), `reference Study` (built-ins only).
- Data access: `close("SYM")` for cross-symbol, `close(period = AggregationPeriod.WEEK)` for MTF, `priceType` for bid, ask and mark.
- Strategies: `AddOrder`.
- Look & Feel: 26 functions, including `AddCloud`, `AddLabel`, `AddChartBubble`, `AssignPriceColor`, `AssignBackgroundColor`, `AssignValueColor`.

**Absent.** Arrays, maps, general loops, drawing-object handles and libraries. *This is inferred from the reserved-word list and the reference structure, so medium confidence.*

**Limits:**
- Secondary aggregation must be at or above the chart period, with one secondary period per expression.
- Scans, columns and alerts need **exactly one plot**.
- **No secondary aggregation in Stock Hacker scans.**
- Scan data windows depend on aggregation (15 days to 20 years).
- Bid, ask and mark are intraday only, up to 15 days.

### 3.3 TC2000 PCF, [DOC]

**Model.** Each formula is a single expression evaluated on the PCF's timeframe, or on the chart's timeframe when plotted. It returns either a number (indicator PCF) or a boolean (condition PCF).

**Syntax:**
- Price variables: `O H L C V` with offsets (`C5` or `C(5)`).
- Built-ins in dot or positional form: `AVGC20`, `AVG(C,20)`, `XAVGC9.1`, `MAXH52`.
- Logic: relational and boolean operators, `NAND`/`NOR`/`XOR`, `IIF(b,t,f)`, `CountTrue`, `SinceTrue`, `TrueInRow` (bounded periods), `XUP`/`XDOWN`, `GREATEST`/`LEAST`, `ABS`, `MOD`, integer divide, power, trigonometric functions.
- Boolean values convert to −1 or 0 numerically.

**Absent.** Loops, variables, user functions, in-formula MTF and documented cross-symbol access.

**Workarounds.** Child indicators reach otherwise inexpressible indicators such as RS and PSAR.

**Can PCFs plot?** Yes, as Custom PCF Indicator, % True and Channel indicators.

**Used in.** EasyScan, watchlist value and condition columns (sortable and coloured), alerts and Market Indicator plots.

**Limits.** None documented. Requires Premium or above.

---

## 4. Cross-platform import landscape

**Native import of another platform's script is essentially absent among mainstream charting platforms.** It is a gap.

| Path | Status | Evidence |
|---|---|---|
| Pine → TradingView alternatives (TC2000, thinkorswim, StockCharts, Deepvue, MarketSurge) | **No import feature found.** | Absence of docs [U]; community guides say no automatic converter [C] |
| Pine or any language → TrendSpider | **AI-assisted translation**: paste the source into the editor and ask the Claude assistant to translate. Works "in the majority of cases" per TrendSpider, but is not deterministic. There is also a **Code Conversion service** (quoted, possibly free). | [DOC] help kb; [PRODUCT] blog; conversion page medium confidence |
| Pine → thinkScript, or the reverse | Manual or freelance only. GitHub collections of hand ports exist. | [C] |
| Pine → NinjaTrader, Sierra Chart, MotiveWave | No official import. Sierra Chart staff point to third-party programmers. MotiveWave users have *requested* a Pine-style scripting interface. | [C] forums |
| **Pine → anywhere: PineTS (LuxAlgo)** | An open-source transpiler and runtime for native Pine v5 and v6 in Node.js or the browser. LuxAlgo acquired it. Claims 1:1 syntax and covers arrays, matrices, maps, UDTs, `request.security`, the strategy namespace and drawing namespaces. Native execution is marked "experimental" and full v6 is "in progress". **Licence: AGPL-3.0 or commercial.** It powers Vela, LuxAlgo's charting platform that runs pasted Pine and the LuxAlgo Library "unmodified". Protected or invite-only scripts cannot run (no source). | [C] GitHub README; [PRODUCT] LuxAlgo blog of 22 September 2026 |
| Pine v5 → v6 within TradingView | The built-in editor converter (v5 to v6 only). | [DOC] |

**Implication** (a fact pattern, not a recommendation):
- Deterministic multi-language import (Pine plus thinkScript plus PCF) is not offered by any mainstream platform reviewed.
- The closest offerings are LLM translation (TrendSpider, and implicitly TradingView Copilot, which writes Pine but does not import other languages; UNVERIFIED whether it translates) and one Pine-only runtime (PineTS/Vela).
- PCF's small grammar makes it the most mechanically translatable. thinkScript's `rec`/`fold`/`CompoundValue` map to state plus bounded loops. Pine's tick-rollback execution model and its drawing limits are the hardest parts to reproduce faithfully. LuxAlgo itself notes ports diverge on "series semantics, indicator seeding, and request.security()".
- Licence caution: PineTS is AGPL, and "Pine Script" is a TradingView trademark.

---

## 5. Pricing and tier limits that affect indicators

### TradingView [PRODUCT, tradingview.com/pricing; annual prices per month]

| Plan | Price | Indicators per chart | Charts per tab | Price alerts | Technical alerts | Watchlist alerts | Historical bars | Invite-only publishing | Pine Screener |
|---|---|---|---|---|---|---|---|---|---|
| Basic | Free | 2 | 1 | 3 | — | — | 5K | ✗ | ✗ |
| Essential | $12.95 | 5 | 2 | 20 | 20 | — | 10K | ✓ | ✗ |
| Plus | $29.95 | 10 | 4 | 100 | 100 | — | 10K | ✓ | ✗ |
| Premium | $59.95 | 25 | 8 | 400 | 400 | 2 | 20K | ✓ | ✓ |
| Ultimate | $199.95 | 50 | 16 | 1,000 | 1,000 | 15 | 40K | ✓ | ✓ |

Further limits by plan:
- Pine: 40 `request.*` calls, or 64 on Ultimate.
- Execution: 20 s on Basic, 40 s on paid plans.
- Intrabars: 100K basic, 125K Expert, 200K Ultimate.
- AI Copilot is a separate paid add-on on any paid plan, with an undisclosed usage cap [DOC].

### TC2000 [PRODUCT, tc2000.com/pricing; monthly]

| Plan | Price | Key indicator-related limits |
|---|---|---|
| Basic | $24.99 | Charts and streaming watchlists. **No PCFs and no EasyScan.** Alerts unspecified. |
| Premium (Gold) | $49.99 | PCFs, EasyScan, real-time scan and sort, history columns, **100 alerts** |
| Premium Plus (Platinum) | $99.99 | Live auto-refresh filters and sorts, intraday performance columns, **1,000 alerts**, up to 5 streaming scans |

### TrendSpider [PRODUCT, trendspider.com/pricing; monthly range shown]

| Plan | Price | Active alerts | Bots | Workspaces | Backtest | Scans | Sidekick |
|---|---|---|---|---|---|---|---|
| Standard | $52–89 | 10 | 5 | 5 | ≥2h, 2K depth, 50 symbols | ≥2h, 3 scheduled | 25 free messages per month |
| Premium | $65–149 | 50 | 10 | 10 | ≥5m, 10K, 150 symbols | 5 scheduled | 25 free per month |
| Enhanced | $87–199 | 100 | 50 | 15 | ≥1m, 20K, 250 symbols | 7 scheduled | 25 free per month |
| Advanced | $154–349 | 400 | 100 | 20 | ≥1m, 30K, 510 symbols | 10 scheduled | 25 free per month |

Indicators-per-chart caps are not stated (UNKNOWN).

### Other platforms

- **StockCharts** [PRODUCT]:

  | Plan | Price per month | Indicators + overlays per chart | Price alerts | Advanced alerts | Scans |
  |---|---|---|---|---|---|
  | Free | Free | 3 + 3 | 2 | 1 | 1 |
  | Basic | $19.95 | 25 + 25 | 100 | 100 | 200 |
  | Extra | $29.95 | 25 + 25 | 500 | 250 | 500 |
  | Pro | $49.95 | 25 + 25 | 500 | 250 | 500 |

- **Deepvue.** $49 per month, or $41 per month billed annually [PRODUCT].
- **MarketSurge.** $149.99 per month [C].
- **thinkorswim.** Free with an account [U].

---

## 6. Sources (all checked 2026-10-13)

### TradingView

| URL | Level | Used for |
|---|---|---|
| https://www.tradingview.com/pine-script-docs/writing/limitations/ | DOC | Pine limits |
| https://www.tradingview.com/pine-script-docs/release-notes/ | DOC | v6 date; 2025–2026 features |
| https://www.tradingview.com/pine-script-docs/language/execution-model/ | DOC | execution model |
| https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/ | DOC | `request.*`, dynamic requests |
| https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/ | DOC | v5→v6 changes, converter |
| https://www.tradingview.com/pine-script-docs/concepts/libraries/ | DOC | libraries |
| https://www.tradingview.com/pine-script-docs/language/loops/ | DOC | loops |
| https://www.tradingview.com/pine-script-docs/concepts/alerts/ | DOC | alerts, server-side |
| https://www.tradingview.com/support/solutions/43000742436-tradingview-pine-screener-key-features-and-requirements/ | DOC | Pine Screener limits |
| https://www.tradingview.com/blog/en/pine-screener-update-60542/ | PRODUCT | Pine Screener update (1 September 2026) |
| https://www.tradingview.com/blog/en/updated-script-publishing-60116/ | PRODUCT | publishing moderation and limits |
| https://www.tradingview.com/pricing/ | PRODUCT | tiers |
| https://www.tradingview.com/features/ | PRODUCT | counts |
| https://www.tradingview.com/blog/en/tradingview-ai-chart-copilot-beta-57730/ | PRODUCT | Copilot beta |
| https://www.tradingview.com/blog/en/ai-copilot-now-on-tradingview-61231/ | PRODUCT | Copilot native (28 September 2026) |
| https://www.tradingview.com/support/solutions/43000795135-create-indicators-and-strategies-with-ai-copilot/ | DOC | Copilot writes Pine |
| https://www.tradingview.com/support/solutions/43000795131-getting-started-with-ai-copilot/ | DOC | Copilot plans and capabilities |
| https://www.tradingview.com/support/solutions/43000701444-will-ai-help-me-write-and-publish-pine-script-indicators/ | DOC | AI caution |
| https://www.tradingview.com/support/solutions/43000762829-how-to-move-an-indicator-to-the-main-pane/ and …/43000482921-… | DOC | panes |
| https://www.tradingview.com/support/solutions/43000543048-what-are-indicator-templates/ and …/43000762823-… | DOC | templates, apply to layout |

### thinkorswim

| URL | Level | Used for |
|---|---|---|
| https://toslc.thinkorswim.com/center/reference/thinkScript (and /Reserved-Words, /Reserved-Words/fold, /Reserved-Words/script, /Functions/Look---Feel) | DOC | language reference |
| https://toslc.thinkorswim.com/center/reference/thinkScript/tutorials/Advanced/Chapter-11---Referencing-Secondary-Aggregation | DOC | MTF rules |
| https://toslc.thinkorswim.com/center/reference/thinkScript/tutorials/Advanced/Chapter-13---Referencing-Other-Data.html | DOC | cross-symbol, `reference` |
| https://toslc.thinkorswim.com/center/howToTos/thinkManual/Scan/Stock-Hacker/studyfilters | DOC | scan restrictions |
| https://toslc.thinkorswim.com/center/howToTos/thinkManual/MarketWatch/Alerts/studyalerts | DOC | study alerts |
| https://toslc.thinkorswim.com/center/howToTos/thinkManual/MarketWatch/Quotes/customquotes | DOC | custom columns |
| https://toslc.thinkorswim.com/center/howToTos/thinkManual/charts/Useful-Tools/Condition-Wizard | DOC | no-code |
| https://toslc.thinkorswim.com/center/howToTos/thinkManual/Tools/Sharing. | DOC | sharing |
| https://toslc.thinkorswim.com/center/reference/thinkScript/tutorials/Basic/Chapter-7---Creating-Strategies | DOC | `AddOrder` (search snippet) |
| https://pressroom.aboutschwab.com/press-releases/press-release/2026/Meet-Charley-Schwabs-New-AI-Powered-Assistant-Designed-to-Help-Clients-Get-Answers-and-Take-Action/default.aspx | PRODUCT | Charley (search snippet) |
| https://www.schwab.com/trading/thinkorswim/desktop | PRODUCT | 300/400+ studies (search snippet only; fetch blocked) |

### TC2000

| URL | Level | Used for |
|---|---|---|
| https://help.tc2000.com/m/69445/l/745531-personal-criteria-formula-syntax-table | DOC | syntax |
| https://help.tc2000.com/m/69445/l/756152-how-to-design-basic-indicator-formulas-pcfs | DOC | PCF plotting, timeframe |
| https://help.tc2000.com/m/69445/l/755637-inline-if-and-converting-conditions-to-indicators | DOC | functions, "not full language" |
| https://help.tc2000.com/m/69401/l/1687603-how-to-create-a-custom-pcf-child-indicator | DOC | child indicators |
| https://help.tc2000.com/m/69445/l/756190-built-in-indicators-table | DOC | about 40 indicators |
| help.tc2000.com Condition Editor, value column, Market Indicator articles (search results) | DOC | columns, sort, colour, scan history |
| https://www.tc2000.com/pricing | PRODUCT | tiers |
| https://www.tc2000.com/features/whatsnew | PRODUCT | v25 features |
| https://www.liberatedstocktrader.com/tc2000-review/ and others | COMMUNITY | indicator counts, no backtesting |

### TrendSpider

| URL | Level | Used for |
|---|---|---|
| https://help.trendspider.com/kb/indicators/custom-indicators-js-scripting | DOC | JavaScript, AI translation, integration |
| https://trendspider.com/developers/capabilities/ | PRODUCT | IDE, NPM, external data |
| https://trendspider.com/developers/code-conversion/ | PRODUCT | conversion program (conflicting fetch) |
| https://trendspider.com/blog/sidekick-agentic-coding/ | PRODUCT | Sidekick (29 April 2026) |
| https://trendspider.com/blog/trendspiders-human-language-scripting-is-here/ | PRODUCT | NL scans (14 October 2025) |
| https://trendspider.com/blog/trendspider-software-update-custom-indicator-script-sharing/ | PRODUCT | sharing, encryption |
| https://trendspider.com/blog/trendspider-software-update-custom-scripting-upgrades/ | PRODUCT | `request.history` (search snippet) |
| https://trendspider.com/pricing/ | PRODUCT | tiers |
| https://help.trendspider.com/kb/raindrop-charts-tm | DOC | Raindrop |

### Deepvue

| URL | Level | Used for |
|---|---|---|
| https://deepvue.com/deepvue-for-tradingview-users/ | PRODUCT | native indicators, AI, price |
| https://deepvue.com/deepvue-vs-tc2000/ | PRODUCT | no-code, alerts, price |
| https://deepvue.com/deepvue-vs-trendspider/ | PRODUCT | no backtesting |
| https://docs.deepvue.com/categories/custom-indicators | DOC | DV-built indicators |
| https://deepvue.com/technical-stock-screener and https://deepvue.com/screener/ | PRODUCT | 276 measures, no syntax |

### StockCharts

| URL | Level | Used for |
|---|---|---|
| https://stockcharts.com/pricing/ | PRODUCT | tiers |
| https://help.stockcharts.com/charts-and-tools/stockchartsacp | DOC | ACP |
| https://help.stockcharts.com/scanning-and-alerts/scan-syntax-reference | DOC | scan syntax |
| https://help.stockcharts.com/data-and-ticker-symbols/ticker-symbols/ratio-and-difference-symbols | DOC | ratio symbols |
| https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/price-relative-relative-strength | DOC | ChartSchool |
| https://articles.stockcharts.com/article/stockcharts-insider-more-this-ai-chat-assistant-isnt-just-a-tool-its-a-thinking-upgrade/ | PRODUCT | Chat Assistant (search snippet) |
| https://c.stockcharts.com/new/ | PRODUCT | The Screener, June 2026 indicators (search snippet; fetch failed) |
| https://scan.stockcharts.com/discussion/366/… | COMMUNITY | UDI as custom indicator |

### MarketSurge, import landscape and community sources

| URL | Level | Used for |
|---|---|---|
| https://www.findmymoat.com/tools/marketsurge and https://www.wallstreetzen.com/blog/ibd-marketsurge-review/ | COMMUNITY | MarketSurge features and price |
| https://github.com/LuxAlgo/PineTS | COMMUNITY (vendor repo) | PineTS coverage, AGPL |
| https://www.luxalgo.com/blog/run-pine-script-outside-tradingview/ | PRODUCT (LuxAlgo) | Vela, caveats (22 September 2026) |
| https://www.sierrachart.com/SupportBoard.php?ThreadID=82905 | COMMUNITY | no Pine import |
| https://forum.motivewave.com/threads/i-dont-expect-this-feature-to-be-implemented-but-it-would-be-nice.47/ | COMMUNITY | Pine-like scripting request |
| https://github.com/0x0Zeus/tradingview-to-thinkorswim | COMMUNITY | manual ports |
| https://www.freeindicators.com/guides/convert-tradingview-pine-script-to-ninjatrader/ | COMMUNITY | no automatic converter |

---

## 7. Could not verify (UNKNOWN or UNVERIFIED)

1. **Exact built-in counts:**
   - TC2000: about 40 in the PCF table, versus 100–240+ in reviews.
   - TrendSpider: its own pages say 120+, 300+ and 400+.
   - thinkorswim: 300+ versus 400+.
   - StockCharts: "dozens".
2. **TradingView:**
   - pane-count cap;
   - whether every built-in exposes source;
   - spread-expression syntax;
   - Copilot usage-cap numbers and price;
   - whether Copilot translates thinkScript or PCF into Pine.
3. **TC2000:**
   - whether alerts run server-side while the app is closed;
   - PCF length and bar limits;
   - cross-symbol inside PCF;
   - sharing and protection of PCFs;
   - Basic-tier alert count;
   - absence of a strategy backtester (only review-sourced).
4. **TrendSpider:**
   - full paint and fill API (the docs page rendered empty);
   - script runtime limits;
   - indicators-per-chart cap;
   - the Code Conversion page (fetch and snippet disagreed).
5. **Deepvue:** alert counts, pane and MTF features, sharing.
6. **thinkorswim:**
   - alert counts and whether alerts are server-side;
   - detailed pane controls;
   - definitive absence of arrays (inferred);
   - platform cost.
7. **StockCharts:** backtesting; scan-syntax timeframe offsets and variables; ChartList sharing details.
8. **MarketSurge:** everything (the official site is blocked to the fetch tool; community sources only); whether any custom formula exists.
9. **Pine v4 → v5 converter:** not re-verified this session.
