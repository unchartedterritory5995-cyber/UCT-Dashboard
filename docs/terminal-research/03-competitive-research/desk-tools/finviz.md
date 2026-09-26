---
id: B-DESK-03
title: Finviz (Elite) — desk tool benchmark
role: B-DESK-03
wave: 1b
group: B
category: competitor
scope: Finviz / Finviz Elite
confidence: 🟡 overall
evidence_ceiling: "Finviz's own docs/pricing/screener pages were reachable and are primary evidence for product facts; the DESK'S OWN hand-usage of Finviz (vs. the automated scanner's Finviz dependency) is not observable from code and is not confirmed by the owner in this pass — that split is inferred from what IS and ISN'T wired into the pipelines. A short owner interview or screen-share would raise this to 🟢. finviz.com/backtests.ashx returned 410 Gone (page retired/moved); the Backtests feature is confirmed only by 2025-2026 secondary sources, not a primary Finviz doc page reached this session."
sources: "9 primary (finviz.com pages, fetched 2026-09-02); 6 secondary (practitioner reviews, fetched 2026-09-02); 2 internal (D-13, D-14)"
uct_relevance: high
status: draft
date: 2026-09-02
---

## 1–2. What the desk uses it for today, and the workflows it owns

### OBSERVATION

Finviz Elite is a **hard operational dependency**, not a convenience link, for exactly one
workflow: the pre-market scanner that seeds the Morning Wire's candidate list.
`uct-intelligence/scripts/scanner_candidates.py` runs **three Finviz screener queries**
every morning — `PULLBACK_MA` (30 max), `REMOUNT` (10 max), `GAPPER_NEWS` (10 max) — through
a dedicated client, `morning-wire/finviz_client.py` (20 references to `elite.finviz.com`).
Output feeds a 7-criteria candle score (0–110) and a wedge/flag pattern detector
(`_detect_wedge_flag`) that are entirely UCT's own code; Finviz's role is narrowly the
**universe screen**, not the scoring. This is a real dependency with an observed failure
mode: a 2026-08-31 dry run logged `"PULLBACK_MA — no results from Finviz"` three times and
the run was flagged `SCAN HEALTH FAILED` — when Finviz is down or rate-limited, the scanner
emits zero candidates, silently thinning the morning wire's Top-5 picks pool.

The second, lighter workflow is **static chart PNG embedding**: `chart.ashx?t={sym}&ty=c&ta=1&p=d|w`
is used as the Daily/Weekly tab option on dashboard drill surfaces (the Breadth
`DrillModal` and `ThemeTracker`), alongside a TradingView iframe tab. This is display-only —
no data flows back into UCT's engine from it.

Separately, `api/services/screener/finviz_universe.py` exists among 41 screener-engine
modules (with `base_catalog.py`, `candles.py`, `candle_backtest.py`, `scan_evaluator.py`,
`saved_screens.py`, `ranking.py`, etc.) — the name implies Finviz supplies or aligns UCT's
own **screener universe** (separately, the dashboard's ticker/company universe is
`cap_universe.json`, 3,742 tickers), distinct from the scanner's live Finviz queries.

A cross-system convention worth flagging: UCT's scanner market-cap floor is **exactly
$300M** (`uct_intelligence/screener.py:470`, `scripts/breadth_collector.py:67`,
`UNIVERSE_CAP_FLOOR = 300_000_000`) — and Finviz's own screener market-cap bucket named
**"Small"** is defined as **$300M–$2B**, so a Finviz filter of "Small and above" (what the
owner calls the standing **"Small+ over $300mln"** filter) reproduces UCT's floor exactly by
construction, not by coincidence — the floor is Finviz's own bucket boundary.

### EVIDENCE
- Internal, CONFIRMED (D-14 §7 "Desk tools and external sites"): `morning-wire/finviz_client.py`,
  `uct-intelligence/scripts/scanner_candidates.py`, `logs/scanner_2026-08-31.log` quote.
  `01-existing-system/ecosystem-cartography.md` lines 237–247, 839.
- Internal, CONFIRMED (D-13 §6, §10): `api/services/screener/` module list (line 522–529);
  market-cap floor table (line 878, `05-product-strategy/proprietary-asset-inventory-raw.md`).
- Primary, tier 1, verified, fetched 2026-09-02: `https://finviz.com/screener.ashx` —
  "Small: $300 million–$2 billion" bucket definition.

### INTERPRETATION
Finviz is UCT's **screening engine of record for one specific automated pipeline**, not a
general data backbone — the desk's own reliance on Finviz outside that pipeline (map, news,
insider, ad hoc screens) is not visible in any repo and can only be a hypothesis pending
owner confirmation.

### RELEVANCE TO UCT
Directly answers Q8 (which visits the scanner replaces): the scanner already fully absorbed
the *screening query* into an automated pipeline; a trader no longer manually runs
PULLBACK_MA/REMOUNT/GAPPER_NEWS by hand — but the pipeline's uptime is now hostage to
Finviz's uptime and rate limits.

### CONFIDENCE
🟢 for the code-level dependency and its failure mode (D-14 quotes a real log line).
🔴 for "does the desk ALSO use Finviz Elite by hand daily" — no source in this program answers
that; ceiling = owner confirmation.

### RECOMMENDATION
Treat the scanner's Finviz dependency as a resilience gap, not a feature gap: the fix is not
"absorb Finviz into Terminal-Next" so much as "stop depending on a single external screener
for the scan's UNIVERSE step" — UCT's own `scan_evaluator.py`/`saved_screens.py` definition-tree
engine (Phase E) already re-implements arbitrary filter combinations server-side; the open
question is whether it can supply the same technical pre-filter (EMA proximity, volume
N-week-low, etc.) Finviz currently does, or whether it depends on Finviz's live technical
computation.

### OPEN QUESTION
Could `scan_evaluator`'s definition-tree engine reproduce PULLBACK_MA/REMOUNT/GAPPER_NEWS's
technical pre-filter without a Finviz round-trip, or does Finviz supply a computation
(e.g., real-time technical criteria across the whole market) UCT's own screener rows don't
carry?

---

## 3–4. What a member likely uses it for, and switching-cost inventory

### OBSERVATION
No source in D-13/D-14 shows Finviz wired into any **member-facing** UCT surface for
screening, news, insider data, or maps — those are separately, natively built: UCT has its
own Insider Activity tile (Finnhub-backed, per the dashboard's data-source table), its own
News feed (AlphaVantage + 7-source RSS fallback), and its own Breadth heatmap (ECharts
treemap over breadth metrics, not a sector/stock price-change map). The one place a Finviz
image reaches a member's screen is the DrillModal/ThemeTracker Daily/Weekly chart tab
(display-only PNG). Finviz's public product surface (screener, maps, insider page, news,
quote pages) is otherwise a **hand tool the owner/traders open in a separate browser tab**,
per the contract's own framing of the desk's daily defaults — this program has no code
evidence either confirming or denying that habit's depth.

Finviz Elite's screener/pricing pages (primary, fetched 2026-09-02) describe the actual
member-facing feature set a trader who DOES open Finviz by hand would be using: **20+
customizable filters across Descriptive/Fundamental/Technical/News/ETF categories, 200
preset scans** (Top Gainers/Losers, New High, Overbought/Oversold, chart-pattern presets
like Wedge Up/Head & Shoulders/Double Top), a **stock map/treemap**, an **insider trading
feed** (transaction type, price, shares, value, SEC Form 4 link — free tier, Elite adds
export), **real-time quotes + multi-layout intraday charting** (Elite-only; free tier is
delayed/EOD only), and a **backtests** feature (Elite-only per 6 independent secondary
sources — InvestmentZen, Spartan Trading, StockBrokers.com, FinMasters, Shibui Finance,
VectorVest — all describing a technical-signal backtester "over 100 indicators"; the direct
`finviz.com/backtests.ashx` URL returned 410 Gone this session, so it may have moved into
the Elite charting UI rather than being retired).

### Switching-cost inventory
- **Data**: none proprietary to Finviz that UCT doesn't already source elsewhere (insider →
  Finnhub; news → AlphaVantage/RSS; charts → Massive/Lightweight Charts). The scanner's
  Finviz-sourced *candidate universe* is the one irreplaceable data flow today.
- **Habits**: Finviz's 200 preset scans and its "Small+" market-cap bucket language are a
  known idiom the owner has already imported verbatim into UCT's own floor constant — a
  genuine habit-transfer, evidenced by the identical $300M boundary.
- **Integrations**: `FINVIZ_API_KEY` env var, `elite.finviz.com` endpoint — a single
  narrow integration point (`finviz_client.py`), low technical switching cost to replace if
  a substitute screening source existed.
- **Keyboard muscle memory**: not observable from code.
- **Broker linkage**: none — Finviz has no brokerage integration; this switching-cost
  dimension does not apply to this tool.

### EVIDENCE
- Internal, CONFIRMED: dashboard Insider/News/Breadth-heatmap data sources
  (`app-CLAUDE.md`-documented data-source table, cross-checked against D-13's screener/breadth
  module inventory — not independently re-derived from code by this role per the DO-NOT
  constraint).
- Primary, tier 1, fetched 2026-09-02: `https://finviz.com/screener.ashx`,
  `https://finviz.com/insidertrading.ashx`, `https://finviz.com/`.
- Secondary, tier "professional reviews", fetched via Google SERP snippets 2026-09-02:
  InvestmentZen, Spartan Trading, StockBrokers.com, FinMasters, Shibui Finance, VectorVest —
  all independently describe an Elite "Backtests" feature; treated as **reported**, not
  verified, since the primary backtests page 410'd.

### INTERPRETATION
The desk's Finviz footprint is narrower than the contract's framing implies: it is not "the
desk lives in Finviz all day" so much as "one scheduled script queries Finviz three times a
morning, and everything else Finviz offers is either replaced by UCT-native equivalents or
is an unverified hand-habit."

### RELEVANCE TO UCT
For Q9/Q10 (absorb vs. leave-external): most of Finviz's member-visible surface (maps, news,
insider, quote pages) is **already redundant** with something UCT built natively — the
gap is not "UCT lacks this," it's "UCT already shipped an equivalent and nobody measured
whether members still leave for Finviz anyway."

### CONFIDENCE
🟡 — the "already covered" claim is solid (D-13/D-14 confirm the native equivalents exist);
whether members still prefer Finviz's versions is untested. **Ceiling**: a member survey or
outbound-click analytics (if UCT tracks external link clicks) would settle this.

### RECOMMENDATION
Before building anything new to compete with Finviz's maps/news/insider surfaces, measure
whether members currently click out to Finviz at all — if UCT's native Insider/News/Breadth
tiles are unused-Finviz-substitutes nobody asked for, that's a different problem than a
missing feature.

### OPEN QUESTION
Does UCT log or track outbound clicks to `finviz.com`/`elite.finviz.com` from any
member-facing surface, and if so, what is the actual click volume?

---

## 5. Absorb / integrate / leave-external verdicts

| Workflow | Verdict (hypothesis) | Basis |
|---|---|---|
| Scanner's 3 automated screens (PULLBACK_MA/REMOUNT/GAPPER_NEWS) | **Integrate-harden, don't absorb yet** | Hard dependency with an observed outage (D-14); UCT's `scan_evaluator` definition-tree engine is a plausible eventual replacement for the *filter logic*, but nothing in D-13/D-14 confirms it reaches Finviz's live technical criteria without a round-trip. Absorbing prematurely risks silently degrading the candle score's inputs. |
| Static chart PNG on DrillModal/ThemeTracker (`chart.ashx`) | **Absorb** | UCT's own Lightweight Charts (`StockChart`) already renders daily/weekly candles with a richer feature set (crosshair OHLCV legend, live streaming, MA overlays) than a static PNG; the Finviz tab appears to be a legacy/cheap fallback, not a capability gap. |
| Maps / heatmap | **Leave-external, low priority** | UCT's Breadth heatmap is a different instrument (metric treemap, not a stock/sector price-change map); no evidence any pipeline or member surface needs a Finviz-style map replicated. |
| News | **Already absorbed** | UCT's AlphaVantage+RSS pipeline (7 sources) is a native equivalent; Finviz is not wired into it at all. |
| Insider data | **Already absorbed** | UCT's Insider Activity tile is Finnhub-backed; Finviz's insider page is not integrated. |
| Backtests / correlation / advanced charting | **Leave-external** | Desk/member hand-tool territory with no pipeline dependency; UCT's own `candle_backtest.py` module suggests a parallel internal capability already exists for candle-pattern backtesting specifically, narrowing (not eliminating) the gap. |

### CONFIDENCE
🟡 across the board — each verdict is a hypothesis built on what is/isn't wired into the
four repos (🟢 for that part) plus an inference about capability parity (🟡–🔴, since no
side-by-side feature test was run).

---

## 6. Finviz's own AI/automation features

### OBSERVATION
Finviz shipped **automatic candlestick pattern detection** on charts, Elite-only, per its
own blog (dated **2026-08-27** — one week before this fetch). It detects **14 named
patterns** (Doji, Hammer, Hanging Man, Inverted Hammer, Shooting Star, Marubozu, Engulfing,
Harami, Morning Star, Evening Star, Three White Soldiers, Three Black Crows, +2 more),
overlays labels/highlights across intraday/daily/weekly/monthly timeframes, and lets a user
filter by bullish/bearish/neutral sentiment and toggle specific patterns. Finviz's own
framing: it turns "visual history into something you can scan in seconds."

No other AI feature (natural-language screener, LLM chat, sentiment summarization) was
found on the pages reached this session.

### EVIDENCE
Primary, tier 1, verified, fetched 2026-09-02:
`https://finviz.com/blog/introducing-automatic-candlestick-detection-on-finviz-charts/`
(publish date 2026-08-27); `https://finviz.com/news.ashx` (surfaces the same feature via a
homepage-style callout).

### INTERPRETATION
This is a close structural cousin of two things UCT already has: the scanner's
`_detect_wedge_flag` orderly-pullback detector and the dashboard's 50-detector Pattern
Engine bridge (per user-memory context, not re-verified here since it's app code). Finviz
ships pattern detection as a **chart overlay a human scans visually**; UCT's pattern
detection is already a **queryable backend signal** (feeds Compass tools, the scanner
score). The gap is not capability, it's surfacing: does a UCT chart show detected patterns
inline the way Finviz's now does?

### RELEVANCE TO UCT
Directly useful for the Terminal-Next chart surface: Finviz just validated (2026-08-27,
industry-current) that "detected pattern as a chart overlay with a bullish/bearish filter
toggle" is a feature traders want enough to ship and market. UCT's own `StockChart` already
computes comparable pattern data server-side for other consumers (scanner, Compass) — the
open question is whether it's ever rendered as an inline chart overlay.

### CONFIDENCE
🟢 on what Finviz shipped and when (primary, dated, verified).
🔴 on "does UCT already do this on-chart" — this role did not read chart component code
(explicitly out of scope); flagged as a hypothesis for the chart-focused role/synthesis to
verify.

### RECOMMENDATION
Hypothesis for synthesis: an inline pattern-overlay toggle on UCT's own chart, sourced from
the existing pattern-detection backend, would match a feature Finviz shipped one week before
this research and marketed as a headline capability — worth a cheap feasibility check before
assuming it needs new detection logic (the detection may already exist; only the overlay
rendering would be new).

### OPEN QUESTION
Does any existing UCT chart surface (StockChart, Multi-Chart Grid, Model Book) already
render detected setups/patterns as an inline overlay, or only as a separate score/badge?

---

## 7. Pricing / tier facts

### OBSERVATION
Two consistent Elite price points, both primary, both fetched 2026-09-02:
- **Monthly billing: $39.50 USD/month.**
- **Annual billing: $299.50 USD/year** (≈ $24.96/month equivalent — the "$24.96/mo" figure
  repeated across multiple Finviz pages as the marketing headline price is the annual plan's
  effective monthly rate, not a separate cheaper tier).
- **7-day free trial, requires a credit card, auto-renews to the paid plan.**
- No evidence of a separate "Elite+" or higher tier was found on `elite.ashx`.

Free vs. Elite delta (primary, `elite.ashx`): real-time vs. delayed quotes; premarket/AH
sessions; intraday charts (free tier has none); 200 vs. 50 screener presets; up to
100/120/50 rows per page vs. 20/36/10; unlimited alerts vs. none; full ETF holdings vs.
none; Excel export + API access (Screener/Portfolio/Groups/Options/News) vs. none; 100
portfolios × 500 tickers vs. 50 × 50; 8 years of financial statements vs. 3.

### EVIDENCE
Primary, tier 1, verified, fetched 2026-09-02: `https://finviz.com/elite.ashx`.
`https://finviz.com/pricing.ashx` returned 404 — pricing lives only on `elite.ashx`.

### CONFIDENCE
🟢 — single consistent primary source, internally consistent (monthly vs. annual math checks
out), fetched same-day.

### RECOMMENDATION
None — factual reference only.

### OPEN QUESTION
None.

---

## GAPS

- **WebSearch was exhausted (per program-wide budget note)**; used WebFetch on known Finviz
  URLs as the primary channel, plus **one** Google SERP page in one browser tab (query:
  `"Finviz" Elite "Backtests" screener signal`), closed immediately after reading — per the
  search-budget instructions.
- `finviz.com/help.ashx` (404), `finviz.com/pricing.ashx` (404), `finviz.com/backtests.ashx`
  (410 Gone), and `finviz.com/map.ashx` (fetched but the extraction model returned no
  substantive content) were all unreachable or unproductive — Backtests and Maps feature
  detail rest on secondary sources / homepage nav labels only, not a dedicated primary page.
- **No API documentation was reached** — the Elite page confirms API access exists for
  "Screener, Portfolio, Groups, Options, News" but no endpoint/rate-limit/format detail was
  found.
- **The desk's actual hand-usage of Finviz beyond the automated scanner is unconfirmed** —
  this is the single biggest gap for the Q8–Q10 questions this contract exists to answer,
  and it requires the owner, not more web research.
- Correlation-matrix feature (mentioned in the contract prompt) was not independently
  verified this session — not reached in any fetch.

## SOURCES

1. `https://finviz.com/elite.ashx` — primary, tier 1, verified. Fetched 2026-09-02.
2. `https://finviz.com/screener.ashx` — primary, tier 1, verified. Fetched 2026-09-02.
3. `https://finviz.com/` (homepage) — primary, tier 1, verified. Fetched 2026-09-02.
4. `https://finviz.com/insidertrading.ashx` — primary, tier 1, verified. Fetched 2026-09-02.
5. `https://finviz.com/quote.ashx?t=AAPL` — primary, tier 1, verified. Fetched 2026-09-02.
6. `https://finviz.com/news.ashx` — primary, tier 1, verified. Fetched 2026-09-02.
7. `https://finviz.com/blog/introducing-automatic-candlestick-detection-on-finviz-charts/` —
   primary, tier 1, verified, dated 2026-08-27. Fetched 2026-09-02.
8. `https://finviz.com/map.ashx` — primary but unproductive (page fetched, no substantive
   content extracted). Fetched 2026-09-02.
9. `https://finviz.com/help.ashx`, `https://finviz.com/pricing.ashx`,
   `https://finviz.com/backtests.ashx` — attempted, unreachable (404/404/410). Fetched
   2026-09-02.
10. Google SERP for `"Finviz" Elite "Backtests" screener signal` (one browser tab, closed
    after reading), surfacing secondary/practitioner sources: InvestmentZen, Spartan
    Trading, StockBrokers.com, FinMasters, Shibui Finance, VectorVest — all tier
    "professional reviews," reported not verified. Fetched 2026-09-02.
11. Internal: `docs/terminal-research/01-existing-system/ecosystem-cartography.md`
    (D-14) — §"Providers", §6.1–6.3, §7 "Desk tools and external sites" — read in full
    relevant sections, CONFIRMED.
12. Internal: `docs/terminal-research/05-product-strategy/proprietary-asset-inventory-raw.md`
    (D-13) — §6 "Themes, Screener, Catalysts, Breadth, COT, Indicators", §10 "The UCT way
    in code" — read in full relevant sections, CONFIRMED.
