# UCT Indicators — Competitive Benchmark

**Audit date:** 2026-10-13. All competitor sources were checked on this date.

**Competitors:** TradingView, TC2000, TrendSpider, Deepvue, thinkorswim, StockCharts, plus MarketSurge. MarketSurge was added because it is the incumbent tool for IBD-style momentum traders.

**Sources:**
- Competitor research, with every URL, per-claim evidence level and a "could not verify" list: `workstreams/WS7-competitor-research.md`.
- UCT facts: the verified inventory (`01-CAPABILITY-INVENTORY.md`). UCT is scored on what **members get in production today**. Dark or admin-only capabilities are noted separately and are not counted in the score.

## Evidence levels

| Tag | Meaning |
|---|---|
| D | Official documentation |
| P | Official product or marketing page |
| C | Community, forums or reviews |
| U | Unknown or unverifiable |
| T | Demonstrated by testing (applies to UCT only) |

We did not hands-on test any competitor product. No accounts were created.

## Scoring rubric (0–5, the same for every platform)

| Score | Meaning |
|---|---|
| 0 | Absent |
| 1 | Minimal or token: exists but would not satisfy a serious trader |
| 2 | Basic: covers the common case, with obvious gaps |
| 3 | Competent: what a serious trader reasonably expects; gaps are niche |
| 4 | Strong: clearly above typical; few gaps |
| 5 | Category-leading: the reference others are measured against |

A score is given only when the evidence supports it. "U" means unknown, not zero.

**Confidence:**
- **H** — official documentation for competitors, or code plus tests for UCT.
- **M** — product pages, or documents that conflict.
- **L** — community sources.

## Matrix

| # | Dimension | UCT | TradingView | TC2000 | TrendSpider | Deepvue | thinkorswim | StockCharts | MarketSurge |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Built-in indicator breadth | **2** (55 built-ins + 79 formula fns) H | 5 (400+) M | 2–3 (counts conflict) L | 4 (120–400+, conflicting) M | 3 (276 measures) M | 4 (300–400+) M | 3 ("dozens", well documented) H | 2 L |
| 2 | Custom indicator creation | **3** (formula + picker + 3 import doors + starters) H/T | 5 (Pine v6) H | 3 (PCF + Condition Editor) H | 5 (JavaScript + visual scripting) H | 0 (no user scripting) H | 4 (thinkScript + Condition Wizard) H | 1 (scan syntax only) H | 0 U |
| 3 | Formula expressiveness | **2** (no loops/arrays/var; no length params; 128-node cap) H/T | 5 H | 2 (single expression; "not a full scripting language") H | 5 H | 0 | 3–4 (`rec`, `fold`, `script{}`) H | 1 H | 0 |
| 4 | Rendering and visual customisation | **3** (fills, bg/bar colour, per-bar colour, tables, objects; several silent gaps) H/T | 5 H | 3 (conditional palettes since v25) H | 3 (lines, histograms, candle colour, HTML tables) M | 2 M | 4 (clouds, bubbles, price/bg colour) H | 2 H | U |
| 5 | Multi-pane | **3** (merge, move to price, above/below, resize, reorder) H/T | 5 H | U | U | U | 3 (upper/lower subgraphs) M | 3 (12 panels) H | U |
| 6 | Multi-timeframe | **2** (natives: calc timeframe; formulas W/M only) H | 5 H | 1 (no in-formula MTF) H | 4 M | U | 3 (at or above chart period; not in scans) H | U | U |
| 7 | Cross-symbol / RS | **3** (RS line vs SPY/QQQ/IWM; `sym()` benchmark roster; UCT breadth series) H | 5 H | 3 (RS via child indicator) H | 3 M | 4 (RS ratings + RS line) M | 3 (`close("SYM")`) H | 4 (ratio symbols everywhere, RRG) H | 4 (RS rating, blue dot) L |
| 8 | Alerts on custom logic | **3** (server-side alerts on user formulas; 14 native alertable; parameter-seeding caveat) H | 5 (server 24x7, 20–1,000 by plan) H | 4 (PCF alerts, 100/1,000) H | 4 (custom JS; 10–400) H | 2 M | 3 (one-plot study alerts) H | 3 H | U |
| 9 | Screener integration (same formula) | **3** (same tree for chart, paint, alert, scan; **not** columns; second screener grammar) H | 3 (Pine Screener, Premium+, one script, manual rescans) H | **5** (same PCF in scan, column, sort, alert, plot) H | 4 (custom JS in scanners) H | 3 (presets, no formulas) M | 3 (one plot; no MTF in scans) H | 3 H | 3 L |
| 10 | Strategy testing / historical analysis | **1** for indicators (no strategy tester on user indicators; MI event studies cover breadth/price only) M | 5 H | 1 (condition history only) H | 5 (no-code tester, bots) M | 0 M | 4 (`AddOrder` + report) H | U | U |
| 11 | Sharing and reuse | **3** (version-pinned links, public library, install = own copy; re-pin gap) H | 5 (public, protected, invite-only, libraries) H | U | 4 (links, encrypted source, marketplace) M | U | 3 (tos.mx links) H | 2 U | 0 |
| 12 | Ease for beginners | **3** (picker, starters, plain-English read-back, repaint warnings; error messages weak) H/T | 3 (Copilot is a paid add-on; no visual builder) H | 4 (EasyScan Wizard) M | 4 (visual scripting, NL scans) M | 4 (drag-drop, AI screens) M | 4 (Condition Wizard) H | 3 M | 3 L |
| 13 | Power for advanced traders | **2** H | 5 | 2 | 5 | 1 | 4 | 1 | 1 |
| 14 | Performance and documented limits | **U/2** (limits enforced; no incremental eval; no gated benchmark) H | U (many documented limits; perf not measured) | U | U | U | U | U | U |
| 15 | AI-assisted creation | **2** for members (`/propose` NL→formula, screenshot import); Agent and Create Indicator admin/cohort only H | 4 (Copilot writes, fixes, applies Pine; paid) H | 0 C | 5 (Claude assistant + Sidekick agent; translates pasted code) H | 3 (NL screens) M | 0 (for thinkScript) M | 1 (explains only) M | U |
| 16 | Calculation transparency and reliability | **4** (plain-English read-back of every formula; repaint verdicts; cross-lane parity tests; TradingView capture harness). Offset by the P0 import labels H/T | 3 (much built-in source published) M | 3 (formula tables) H | U | 3 H | 3 H | **5** (ChartSchool) H | U |
| 17 | Workflow efficiency | **2** (no undo, no apply-to-all/sync, template flag unclear; good chip menu) H | 5 (templates, apply to layout, sync) H | 3 H | 3 M | 3 M | 3 H | 3 H | 2 L |
| 18 | Unique / proprietary | **4** (multi-language deterministic import; proprietary breadth/MI/econ series; formula↔alert↔scan parity) H | 5 (Pine ecosystem) H | 4 (EasyScan/PCF columns, Market Indicator) H | 4 (auto trendlines, Raindrop, bots, code conversion) H | 4 (RS/EPS/Composite ratings) M | 3 (Condition Wizard, `rec`/`fold`) H | 4 (ChartSchool, ratio symbols, RRG) H | 4 (IBD ratings) L |
| + | **Cross-platform script import** | **4** relative to the market; ~32% Pine census attach; P0s open H/T | 1 (v5→v6 only) H | 0 H | 3 (AI translation "in the majority of cases", unverified; paid conversion service) M | 0 | 0 | 0 | 0 |

**Not counted in UCT's score:**
- the Pine runtime VM, dark (exact on stateful scripts in this audit);
- UCT Agent indicator authoring, admin-only;
- Create Indicator conversation, admin or cohort.

Lighting these up would raise UCT's dimensions 3, 13 and 15, and its import score.

## Where UCT matches or exceeds

1. **Cross-platform import.** UCT is the only platform found that deterministically imports from three other platforms' languages. It also names each refusal and exposes the translated formula. TrendSpider relies on an LLM plus a paid conversion service, and TradingView converts only between its own versions. This is a real gap in the market, and UCT already occupies it. [WS7 §4, D/P]
2. **Formula transparency.** Every formula gets a plain-English read-back generated from the tree, not by a model. Repaint verdicts come with bar counts. Chart, alert and scan are guaranteed to compute the same value through cross-lane parity tests. No competitor documents an equivalent of the last guarantee. [WS4, WS8]
3. **One formula across chart, candle colour, alerts and scans.** This matches TC2000's strongest idea on four of its five surfaces; columns are the gap. [WS4]
4. **Proprietary market context:**
   - UCT breadth series (45 symbols), 193 Market-Indicator series and 237 economic series.
   - RS line and ADR%/RVOL-style studies built for momentum traders.
   - Deepvue and MarketSurge differentiate on proprietary ratings. UCT's analogue is breadth and market-condition data. [WS1 §1.4]
5. **Safety.** Interpreted execution and server-side gates per call. TradingView's sandbox is equally safe; UCT's is simply well verified. [WS8]

## Where UCT is behind

1. **Expressiveness for advanced users** (dimensions 3, 6, 13): no parameterized lengths, no user functions, no intraday MTF in formulas, and no loops or state in members' production lane. TradingView, TrendSpider and thinkorswim are all well ahead.
2. **Workflow** (dimension 17):
   - no undo;
   - no apply-to-all-charts;
   - toggle-off destroys configured instances (P0-6).
3. **Backtesting** (dimension 10): there is no strategy testing on user indicators. TradingView, TrendSpider and thinkorswim all have it. This audit does not recommend chasing it first; see the roadmap.
4. **AI for members** (dimension 15): TradingView Copilot (live in Supercharts since 2026-09-28) and TrendSpider Sidekick (2026-04-29) are shipped to paying users. UCT's richer Agent is admin-only.
5. **Formula columns** (dimension 9): TC2000's sortable, colour-coded PCF columns are the benchmark for momentum scanners. UCT cannot put a user formula in a watchlist column.

## Pricing context (official pricing pages)

TradingView limits indicators per chart by plan:
- Basic: 2
- Essential: 5
- Plus: 10
- Premium: 25
- Ultimate: 50

TradingView technical alerts range from 20 to 1,000. TC2000 requires the $49.99 Premium plan for PCFs and scanning. TrendSpider's plans run $52–349 per month, with 10–400 alerts.

UCT enforces no per-chart indicator cap in code (not audited as a product decision). Full tables are in WS7 §5.

## Caveats

- Competitor built-in counts conflict across their own pages. These are recorded as ranges.
- Competitors' runtime performance is undocumented. Dimension 14 is therefore U for all.
- MarketSurge cells rest on community sources only, because IBD's site was not reachable.
- TradingView's Copilot usage cap and price are undisclosed.
