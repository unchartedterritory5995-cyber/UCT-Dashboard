---
id: B-DESK-04
title: Market Chameleon — options analytics benchmark (provisional 4th desk-tool slot)
role: B-DESK-04
wave: 1b
group: B
category: competitor
scope: marketchameleon.com
confidence: 🟡 medium-high on product surface and pricing; 🔴 on live desk usage and production-side comparison
evidence_ceiling: All findings are UI text and page structure reachable logged-out (free-tier view). Every strategy-backtest table on the site rendered "Premium" placeholders instead of numbers for a logged-out visitor, so the actual quantitative content of the backtests (average return, win rate figures) could not be observed — only their existence, filter surface, and stated methodology/caveats. No login was attempted (against contract). WebSearch was exhausted per program budget; all evidence below is direct WebFetch/browser navigation of marketchameleon.com pages, one browser tab, closed after use.
sources: 11 primary (marketchameleon.com pages, 2026-09-02); 0 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# Market Chameleon — options analytics benchmark

**Slot status.** This is the PROVISIONAL fourth desk-tool slot (B-VAL-01 recommendation), pending OI-19 on structures vs. single-legs. If OI-19 answers "structures," the orchestrator may swap this slot to OptionStrat — noted here, not resolved.

## OBSERVATION 1 — What Market Chameleon is, structurally

A single-product options/stock analytics site organized around one ticker-scoped left-hand mega-menu (STOCK INFO / FUNDAMENTALS / EARNINGS / OPTIONS / VOLATILITY / TOOLS / COMPANY INFO / NEWS / LINKS) plus market-wide "Screeners" and "Reports" sections reachable from the top nav. Every per-symbol page (e.g. `/Overview/AAPL/...`) carries a persistent header strip: last price, 30-Day IV + change, **IV30 % Rank** with a plain-English label ("49% Moderate"), option volume, market cap, next earnings date (with "(Est.)" when unconfirmed), and next "Company Event" date.

**EVIDENCE:** Direct browser navigation to `https://marketchameleon.com/` and `https://marketchameleon.com/Overview/AAPL/`, 2026-09-02. Tier: official product UI (primary). Status: verified (I loaded and read the live rendered page).

**INTERPRETATION:** The IV-Rank-with-a-label pattern (number + "Subdued/Moderate/Elevated") on every page header is the single most portable UI idiom here — it answers "is this rich or cheap right now" in one glance without the visitor picking a lookback window.

**RELEVANCE TO UCT:** UCT's screener carries `implied_move_pct` but memory records it as sparse/thin coverage; Market Chameleon's header-level IV-rank label is a candidate pattern for Terminal-Next's per-symbol chrome regardless of which options analytics surface UCT builds.

**CONFIDENCE:** 🟢 verified directly. **RECOMMENDATION:** Treat the persistent IV-rank-with-label header as a transferable idiom, not a requirement.

---

## OBSERVATION 2 — Expected move / implied-move history (the core of this benchmark)

Three distinct, separately-URLed implied-move tools exist per symbol, not one:

1. **Daily 1-day implied move vs. actual** (`/Overview/AAPL/ImpliedPriceChange/`, labeled "Implied Moves"): "We use the closest expiring options to develop a one-day expected price move (up or down) each day, and then compare those numbers to the actual price moves that occur." Rendered as a 20-day bar chart (blue = implied range, green/red = actual move direction/size) plus a data table.
2. **Earnings-specific implied move vs. actual, with a scored historical accuracy rate** (`/Overview/AAPL/Earnings/Earnings-Charts/`, labeled "Implied Moves And IV Crush"). Verbatim example pulled live: *"AAPL last reported earnings on Jul 30, 2026 AMC. The options prices predicted a ±3.7% post earnings move, compared to a -7.4% actual move. The options market overestimated AAPL stocks earnings move 77% of the time in the last 13 quarters. The predicted move after earnings announcement was ±3.9% on average vs an average of the actual earnings moves of 2.5% (in absolute terms)."* This is the tool the "expected move" language usually refers to.
3. **ATM Straddle History** (`/Overview/AAPL/ATMStraddleHistory/`) — the raw options-pricing input (at-the-money straddle cost) that the two implied-move numbers above are derived from; kept as its own page rather than folded in.

The same earnings page also shows a companion **IV crush table**: 30-day IV at −5 to +5 trading days around each of the last 13 earnings dates, plus average/max/min IV rows, with FAQ prose explaining the mechanism ("implied volatility(IV) increase several days before the earnings information is released... After the earnings report is released... implied volatility will drop back down").

**EVIDENCE:** `https://marketchameleon.com/Overview/AAPL/ImpliedPriceChange/` and `https://marketchameleon.com/Overview/AAPL/Earnings/Earnings-Charts/`, both fetched 2026-09-02. Tier: official product page (primary), the historical/aggregate stats are the site's own computed output, not third-party. Status: verified (numbers observed as rendered, logged out — this row is NOT gated).

**INTERPRETATION:** The differentiator is not "shows an expected move" (UCT already computes `implied_move_pct` per the dashboard's calendar enrichment) — it's the **scored historical calibration**: "overestimated 77% of the time in the last 13 quarters" is a standing, per-symbol accuracy record of the market's own pricing, computed automatically for every ticker with enough earnings history. That is a different asset than a single forward-looking number.

**RELEVANCE TO UCT:** UCT's calendar surface (`get_implied_move`, dashboard CLAUDE.md) computes a forward expected move per earnings but memory flags `implied_move_pct` as sparse and does not (per the reachable internal docs) track whether the market's implied move has historically over- or under-shot for that specific ticker. A "how often has AAPL's options market overpriced its own earnings move" number is a plausible, evidence-backed hypothesis for a Terminal-Next earnings surface — it is arithmetic on data UCT likely already holds (implied move at T-1 + realized move at T+1, accumulated across the `earnings_analytics` table's 40,731 rows per D-13 §1) rather than a new data source.

**CONFIDENCE:** 🟢 on what the tool shows and says; 🟡 on whether UCT's existing pipeline already computes the equivalent (D-13 documents `get_implied_move` and `IMPLIED_CAPTURE_WINDOW_DAYS` exist but does not describe a calibration/accuracy backtest — this is an inference from absence, not a confirmed gap).

**RECOMMENDATION (hypothesis):** If Terminal-Next ships an earnings-move surface, pair the forward implied move with a trailing calibration stat ("this name's options have over/under-priced its last N earnings moves by X on average") — cheap to compute from data UCT already retains, and it is the one piece of this tool that is more than a snapshot.

**OPEN QUESTION:** Does UCT's `earnings_analytics`/calendar enrichment pipeline already retain enough historical implied-move values per symbol to backtest calibration, or would this require a new stored field going forward?

---

## OBSERVATION 3 — Earnings option strategies (backtested, not just listed)

`/Overview/AAPL/Earnings/Earnings-Option-Strategies/` is a filterable historical-outcomes table, not a static strategy explainer. Filters: Buy/Sell toggle × 30 named strategy types (25-Delta Call/Put, ATM Call/Put, 75-Delta Call/Put, ATM Straddle, 25-Delta Strangle, six spread variants, ratio spreads, call/put butterflies, iron butterfly, call/put condor, iron condor, calendar call/put spread ATM & OTM, diagonal call/put spread, call buy-write ATM/25-delta, long stock only). Selecting a strategy returns a "quarter-by-quarter breakdown" (per the page's own help text) of that strategy's historical performance specifically around this ticker's earnings dates, with an explicit entry/exit timing convention ("the Day of Earnings Trading is the business day immediately following the earnings release... if AMC, the next business day").

**Explicit methodology caveat, quoted verbatim (≤40 words):** *"Average returns and occurrences are calculated from snapshots of market mid-point prices and were not actually executed, so they do not reflect actual trades, fees, or execution costs."*

A second, companion table on the Implied-Moves-and-IV-Crush page (Observation 2) offers four IV-crush-targeted strategies specifically — Calendar Call/Put Spreads, Diagonal Call/Put Spreads — each with an "Average Return / Win Rate" column, gated behind "Premium" for a logged-out visitor.

**EVIDENCE:** `https://marketchameleon.com/Overview/AAPL/Earnings/Earnings-Option-Strategies/`, fetched 2026-09-02. Tier: official product page (primary). Status: verified for structure/filters/methodology text; the actual return/win-rate NUMBERS are claimed (site markets them) but not observed — they render as "Premium" for a logged-out session, so I could not confirm accuracy or sample sizes.

**INTERPRETATION:** This is the same instinct as UCT's own base-lift ledger (D-13 §5) — measured strategy outcomes with a stated methodology and an explicit "this isn't a real fill" caveat — applied narrowly to earnings-window option strategies per single ticker, at 30-strategy granularity. Market Chameleon publishes the caveat but (as far as this logged-out pass could see) does not publish anything resembling UCT's six-gate rejection discipline (no visible sample-size floor, no null-model comparison, no stated rejection rate). It looks like a raw backtest table, not a filtered one.

**RELEVANCE TO UCT:** UCT's own doctrine (D-13 §5, §7 — "lift, never a hit rate," the flow scoreboard's locked honesty rules) is a stronger integrity standard than what this page visibly offers. If Terminal-Next ships an earnings-strategy-outcomes surface, the competitive gap to close is breadth of strategy taxonomy (30 named types) and per-ticker granularity, not measurement rigor — UCT's existing discipline is already ahead on rigor by the evidence available here.

**CONFIDENCE:** 🟡 — structure and caveats verified; performance-number accuracy and sample-size handling NOT DETERMINED (paywalled). **EVIDENCE CEILING:** a Premium login ($99/mo, see Observation 6) would be needed to see actual numbers, or a practitioner review/screenshot.

**RECOMMENDATION (hypothesis):** Don't copy the 30-strategy taxonomy wholesale — it's marketing breadth. If Terminal-Next builds an earnings-options-outcomes feature, borrow the entry/exit timing convention (explicit AMC/BMO handling) and the mid-point-price caveat, but apply UCT's own gated-publication discipline rather than this page's apparently ungated one.

**OPEN QUESTION:** Does the "Premium" gate on the strategy outcome numbers also gate sample-size (n) and confidence information, or only the headline return/win-rate? Unknown without a subscription.

---

## OBSERVATION 4 — Unusual volume + IV-rank screeners

Two market-wide daily reports, both logged-out-visible with live numbers (unlike Observation 3):

- **Unusual Option Volume** (`/Reports/UnusualOptionVolumeReport`): "Displays a list of equities whose options are exhibiting significant volume spikes... expressed as a relative volume ratio: taking today's volume divided by the equity's 90-day average volume." Shows a 10-day lookback bar chart of daily flagged-symbol counts (observed: 130–319 symbols/day, 2026-08-18 → 2026-09-01) plus filters (ETF membership, moneyness, watchlist).
- **Option Implied Volatility Rankings** (`/volReports/VolatilityRankings`): "Displays equities with elevated, moderate, and subdued implied volatility for the current trading day, organized by IV percentile Rank," explicitly framed as event-anticipation detection ("often due to an upcoming or impending event").

A related market-wide family exists but was not opened in depth: Implied Volatility Movers, Volatility Compare (peer group), Large Delta Volume Trades, S&P 500 Volume Burst Trades, Unusual Stock Volume, Volume Burst Screener, Event-Driven Screener, Big Money Stock Flow.

**EVIDENCE:** Both URLs fetched 2026-09-02. Tier: official product page (primary). Status: verified — live daily counts and filter surface observed, ungated.

**RELEVANCE TO UCT:** UCT's screener/scanner family (D-13 §6) is Finviz-scan-driven with its own 7-criteria candle score; it does not appear (per D-13/D-14) to carry a standing "unusual OPTIONS volume, relative to each name's own 90-day average, market-wide, daily-counted" report. This is a plausible gap: UCT has options-flow depth (dark-pool records, flow scoreboard) but D-13 does not describe a simple market-wide daily unusual-options-volume screener as a distinct surface.

**CONFIDENCE:** 🟢 on what these two reports show. 🟡 on whether this is genuinely absent from UCT (D-13's screener section is not exhaustive on the options-screener family).

**RECOMMENDATION (hypothesis):** A daily "which names are seeing outsized options volume relative to their own norm" market-wide table is cheap (ratio math over data UCT's flow pipeline likely already ingests) and is missing evidence of existing in UCT per D-13/D-14 — worth a one-line check against the actual screener module list before treating as a gap.

**OPEN QUESTION:** Does `api/services/screener/` (D-13 §6, 41 modules) already compute a relative-options-volume ratio anywhere, under a name this pass didn't search for?

---

## OBSERVATION 5 — Screener family (strategy-scoped, not just factor-scoped)

The Screeners top-nav resolves to a large family of PRE-FILTERED-BY-STRATEGY screeners, distinct from UCT's factor/pattern screener model: `/Screeners/Stocks`, `/Screeners/Options` ("Options By Expiration"), `/Screeners/OptionTrades` ("Option Block Trades"), `/Screeners/ETFs`, and then one screener PER OPTION STRATEGY — `BullCallSpreads`, `BullPutSpreads`, `BearCallSpreads`, `BearPutSpreads`, `CallButterflySpreads` (and its short-ATM/long-ATM mirror variants), `PutButterflySpreads` (+ mirror), `CoveredCalls`, `NakedPuts`, `LongCalls`, `LongPuts`, `Multi-Leg-Option-Trades-Screener`, `Index-Option-Multi-Leg-Trades-Screener`. Per the Premium page's own description, the Covered Call and Naked Put screeners each carry "15+ filters."

**EVIDENCE:** Link inventory extracted from live page DOM, `https://marketchameleon.com/` and the Premium feature page, 2026-09-02. Tier: official product (primary). Status: verified (URLs and labels observed directly; filter counts are the site's own claim, cross-checked against the Covered Calls/Naked Puts feature blurbs on `/Premium`).

**INTERPRETATION:** The organizing principle is "give me the best candidates FOR a strategy I've already chosen" (screen the whole market for, say, the best bull put spreads by some ranking) rather than UCT's "screen the market for a technical setup, then decide the trade." These are complementary, not substitutable — Market Chameleon's screeners presuppose the options strategy; UCT's presuppose the technical setup.

**RELEVANCE TO UCT:** Not directly transferable to UCT's swing-equity-first workflow (per D-13's setup grammar, §4) unless Terminal-Next adds an options-income workflow (covered calls / naked puts as a standing member surface) — a product-scope decision, not a technical gap.

**CONFIDENCE:** 🟢 on the taxonomy existing; 🟡 on filter depth (not opened logged-in).

**RECOMMENDATION:** Not a near-term absorb target for a swing-equity desk; flag as relevant only if UCT scopes an income/options-selling member workflow.

---

## OBSERVATION 6 — Pricing (dated 2026-09-02)

**Single paid tier, confirmed live.** "Total Access" subscription: **$99/month**, **7-day free trial**, credit card charged automatically at trial end unless canceled. Post-trial download cap: **25 downloads per rolling 24 hours** (2 during trial). No annual-discount tier, no multi-tier pricing page was found (`/Pricing` 404s; the real URL is `/Subscription/TotalAccess`, reached via the footer "Pricing" link).

A free/basic tier exists alongside it (registration-gated, not paywalled): the `/Premium` feature page repeatedly contrasts "Basic users" (e.g., "Basic users are only able to see the next three business days" of earnings/dividend dates; "Basic users are limited to trades with quantity of 200 or greater for only the current trading date") against Premium capability — so market data/screeners are visible logged-out or on a free account with reduced depth/history, and Premium unlocks: saved filter presets, CSV/Excel downloads, extended trade-history windows (60 days vs. current-day for option trades; 20 days vs. less for VWAP), peer-group analysis, custom option-strategy watchlists, and full filter sets on the strategy screeners.

**EVIDENCE:** `https://marketchameleon.com/Subscription/TotalAccess` and `https://marketchameleon.com/Premium`, both fetched 2026-09-02. Tier: official pricing/product page (primary). Status: verified.

**RELEVANCE TO UCT:** $99/mo single-tier is a useful anchor point for options-analytics-specific tooling pricing, distinct from broker platforms (free with an account) and TradingView (subscription-tiered charting). It sits well above UCT's own paywall tier framing (per dashboard CLAUDE.md, `tier` is a badge — UCT does not appear to price a comparable options-analytics add-on separately).

**CONFIDENCE:** 🟢 (directly observed, dated).

---

## OBSERVATION 7 — AI/automation features (or their absence)

No LLM-style chat, AI-generated commentary, or "ask a question" feature was found on any page visited (homepage, AAPL overview, earnings pages, screeners, pricing/premium pages). The one automation-flavored surface is **"Top 3 By Edge" / "Top 3 By Win Rate" trade ideas** (`/Overview/AAPL/Option-Trade-Ideas/Top-3-By-Edge/`): a rules-based ranking across 13 named strategies (Bull/Bear Call/Put Spreads, Debit/Credit Iron Condors, Debit/Credit Iron Butterflies, Seasonality Bullish Play, Long Call/Put/Straddle/Short Straddle) that compares each candidate's market price to a computed "Theoretical Value," surfaces the resulting "Edge %" and a "Hist. Win Rate," and explicitly frames edge as "the most important statistic" via an in-app explainer link. This reads as a quantitative/statistical ranking engine, not generative AI — no model name, no natural-language output, no citation of an LLM anywhere encountered.

**EVIDENCE:** All pages above, 2026-09-02. Tier: official product (primary). Status: verified as an absence-on-the-pages-visited, not an exhaustive site audit.

**INTERPRETATION:** This is a meaningful contrast point for UCT: Market Chameleon's "automation" is statistical (theoretical-value-vs-market-price edge, historical win rate), while UCT's Compass/grade_ticker layer (dashboard CLAUDE.md) is LLM-narrated and decision-structural (GO/HOLD/SKIP with tool-sourced numbers). Different automation philosophies, not a feature gap either direction.

**CONFIDENCE:** 🟡 — absence claim is bounded by the ~15 pages actually visited in this pass, not the whole site.

**OPEN QUESTION:** Does Market Chameleon's Developer/API page (linked in footer, not opened this pass) expose anything AI-branded that the consumer UI doesn't surface?

---

## GAPS — what this budget did not reach

- **All Premium-gated numbers** (strategy backtest returns/win-rates, saved-filter screener output, CSV downloads) — required a $99/mo login, which the contract forbids (no purchases/logins). Channel used: browser, one tab, no forms submitted.
- **thinkorswim / TradingView cross-comparison** — out of scope for this role (B-DESK-01/02 cover those); not duplicated here.
- **Developer/API page** — linked in footer, not opened; could carry pricing or capability info relevant to a "could UCT license this data" question.
- **Mobile app** — not checked; unknown if Market Chameleon ships one.
- **WebSearch** — exhausted per program budget (stated 200/200 in the preamble); this report relied entirely on WebFetch (mostly timed out, see below) and one Chrome tab's direct navigation + `document.body.innerText` extraction (get_page_text failed on several canvas-chart-heavy pages and was worked around via javascript_tool). No Google/Bing query was run — direct URL discovery via the site's own left-nav and footer links was sufficient and is arguably higher-tier evidence than a search-engine detour.
- **WebFetch** — attempted first on the homepage and `/Pricing`; both timed out (60s) rather than erroring, so the tool switched to the browser per the preamble's fallback order.
- **D-13's claimed citation for "implied capture and expected move code"** — the B-DESK contract states D-13 cites this; a full read of D-13 found no literal mention of `IMPLIED_CAPTURE_WINDOW_DAYS` or `implied_move_pct`. The dashboard's own `CLAUDE.md` (loaded automatically into this session, not one of the two named internal files) documents `get_implied_move` under the Calendar section — used above as background only, flagged here as a discrepancy between the contract's citation and what D-13 actually contains.

## SOURCES

1. https://marketchameleon.com/ — homepage, official (primary), fetched 2026-09-02, verified.
2. https://marketchameleon.com/Subscription/TotalAccess — pricing, official (primary), fetched 2026-09-02, verified.
3. https://marketchameleon.com/Premium — full feature list, official (primary), fetched 2026-09-02, verified.
4. https://marketchameleon.com/Overview/AAPL/ — per-symbol overview, official (primary), fetched 2026-09-02, verified.
5. https://marketchameleon.com/Overview/AAPL/Earnings/Earnings-Charts/ — implied moves & IV crush, official (primary), fetched 2026-09-02, verified.
6. https://marketchameleon.com/Overview/AAPL/Earnings/Earnings-Option-Strategies/ — earnings strategy backtests, official (primary), fetched 2026-09-02, verified structure/caveats; numbers paywalled.
7. https://marketchameleon.com/Overview/AAPL/ImpliedPriceChange/ — daily 1-day implied move, official (primary), fetched 2026-09-02, verified.
8. https://marketchameleon.com/Overview/AAPL/Option-Trade-Ideas/Top-3-By-Edge/ — edge-ranked trade ideas, official (primary), fetched 2026-09-02, verified.
9. https://marketchameleon.com/Reports/WeekByWeekStraddlePerformance — market-wide straddle/wing backtest screener, official (primary), fetched 2026-09-02, verified structure.
10. https://marketchameleon.com/Reports/UnusualOptionVolumeReport — unusual options volume, official (primary), fetched 2026-09-02, verified live data.
11. https://marketchameleon.com/volReports/VolatilityRankings — IV rank screener, official (primary), fetched 2026-09-02, verified live data.

Internal grounding: `docs/terminal-research/05-product-strategy/proprietary-asset-inventory-raw.md` (D-13, read in full) and `docs/terminal-research/01-existing-system/ecosystem-cartography.md` §7 (D-14, read in full).
