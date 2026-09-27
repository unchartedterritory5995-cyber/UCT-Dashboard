---
id: B-UW-01
title: Unusual Whales — benchmark dossier (DEEP)
role: Benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: Unusual Whales (unusualwhales.com) — options-native retail/prosumer terminal
confidence: 🟡 overall (🟢 on capability inventory, pricing, free/paid boundary, alert semantics; 🔴 on subscriber-only UX, performance, workflows behind the paywall)
evidence_ceiling: No paid subscription. Every subscriber-only surface was observed in its logged-out state, where the platform serves a 2-day-delayed archive (15-min-delayed on the flow feed). Live-session density, latency, multi-monitor behaviour and the "Super Flow" customisable dashboard were NOT observed. A one-month Retail Basic seat (~$40–50) or a one-week free API trial would lift most 🔴s to 🟢.
sources: 22 primary; 3 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# Unusual Whales — B-UW-01 dossier

> **Scope note.** This dossier benchmarks a public product. Nothing in it is a requirement for
> TERMINAL-NEXT. Where a UCT surface is named it is named as *the workflow an idea would serve*,
> not as a change order. TERMINAL-CURRENT (the existing `/calendar` surface, display-named
> "UCT Terminal") is referenced only where a direct comparison is instructive.

> **Source-handling note.** Several pages read during this research contained text addressed at
> automated agents (see §O, "Agent-shell observation"). None of it was followed. It is recorded
> as an observation about the product, not as instruction.

---

## A. Executive summary

**OBSERVATION.** Unusual Whales is an options-flow-native market intelligence platform for
self-directed retail and prosumer traders. It ingests the full US options tape (OPRA), the
off-exchange (dark pool) tape, dealer-positioning data, and a long tail of disclosure datasets
(Congress, insiders, 13F, FEC, short interest, prediction markets, private markets), and it
presents all of it through one dominant idiom: **a filterable, saveable, alertable, shareable
feed**. Its own paywall copy states its positioning in five words.

**EVIDENCE.**
- `https://unusualwhales.com/dashboard` (logged out), 2026-09-02, Tier: official product page —
  **verified**. The upgrade gate lists the paid dashboard's selling points verbatim: "LIVE
  Dashboard", "Everything in One Place", "Customizable flow dashboard", **"A Bloomberg terminal
  for retail"**.
- `https://unusualwhales.com/` 2026-09-02, Tier: official marketing — **claimed**: "Institutional
  grade trading tools, AI-powered analytics, and a 100,000+ community of traders to learn from";
  "11K+ TICKERS COVERED", "1B+ DATA POINTS", "Real-time LIVE MARKET DATA".
- `https://api.unusualwhales.com/api/openapi` 2026-09-02, Tier: official API spec — **verified**:
  **221 documented REST/WebSocket paths** across 32 groups (full path inventory in §D).

**INTERPRETATION.** The product's **philosophy in one sentence: *give a retail trader the same
raw prints an institution sees, then make the filter — not the analyst — the unit of work.***
Everything else (screeners, alerts, the Discord bot, the AI assistant, the community page) is a
different delivery vehicle for the same filter primitive. Unusual Whales does not try to tell you
what a print means; it tries to make the tape addressable, and then it publishes an unusually
honest legend explaining why its own labels can be wrong (§I, §M-3).

**RELEVANCE TO UCT.** This is the closest public analog to UCT's Options Flow, Live Flow
(`/live-massive`), dark-pool and GEX surfaces, and to the Flow Record scoreboard. It also runs a
Discord bot and a paid community — the same two channels UCT runs. The desk persona is the
natural reader of §D, §G and §H; the member persona is the natural reader of §L and §N.

**CONFIDENCE.** 🟢 on what the product is and how it is positioned (its own paywall and API spec
say so). 🟡 on the philosophy sentence (an inference, not a quote).

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT treats "a saved, named, shareable filter" as a
first-class object rather than transient UI state, then a large share of the surface area UCT
currently ships as bespoke pages could be expressed as filters over one or two feeds.* Test by
counting how many current UCT screener/flow/scan surfaces reduce to a filter over a common row
shape.

**OPEN QUESTION.** Does the "Bloomberg terminal for retail" framing survive contact with the paid
product, or is the paid dashboard still a set of separate pages with a saved-layout veneer?

---

## B. User types / personas served

**OBSERVATION.** Five distinguishable buyers, priced separately.

1. **The individual options trader** — Retail Basic / Pro / Max ($50 / $75 / $120 list per month).
   The flow feed is the product.
2. **The builder / quant / "vibecoder"** — API Basic / Advanced ($150 / $375 list per month), plus
   a **free one-week API trial**. Marketing addresses this persona explicitly: "Analyze Like a
   Quant. Ship Like a Vibe Coder"; "Vibecoder friendly!".
3. **The community operator** — a Discord server owner buying the **Server Subscription at
   $124.99/mo ($1,250/yr)** so their whole server gets live data.
4. **The business / redistributor** — Startup ($750/mo, $7,500/yr), Startup + Kafka ($3,000/mo,
   $30,000/yr), Enterprise (contact sales), plus a Data Shop for bulk historical files.
5. **The politics/disclosure follower** — a distinct audience served by `/politics/*`,
   `/trump-tracker`, `/nancy-pelosi`, `/congress-trading-report-2024|2025`. This cohort arrives
   for the Congress tracker, not the tape.

**EVIDENCE.** `https://unusualwhales.com/pricing`, `?product=api`, `/pricing/more`,
`/discord-bot`, `https://api.unusualwhales.com/api/openapi` (`info.description`),
`https://unusualwhales.com/sitemap-0.xml` — all fetched 2026-09-02, Tier: official pricing/product
pages — **verified**.

**INTERPRETATION.** Persona 5 is a *top-of-funnel* persona, not a revenue persona: the Congress and
Trump trackers are free, heavily SEO'd, and press-friendly, and they exist to convert a political-
news reader into a flow-feed subscriber. Persona 3 is the most interesting commercially — UW sells
the same data twice into one community (per-user $6.99 and per-server $124.99).

**RELEVANCE TO UCT.** UCT already has personas 1, 3 and 5 in embryo (members, the Discord, the
Congress-adjacent content of the wire). It does not have persona 2 at all. The desk is a sixth
persona UW does not serve: a *professional* who trades the firm's own book.

**CONFIDENCE.** 🟢 (pricing pages are unambiguous).

**RECOMMENDATION (hypothesis).** *A free, SEO-shaped disclosure tracker is a cheaper acquisition
channel than a free tier of the core product, because it costs nothing in data licensing and
cannibalises no paid surface.* Anti-hypothesis worth testing: it may attract a cohort that never
converts.

**OPEN QUESTION.** What fraction of UW revenue is the $124.99 server tier? If it is material, it
is the single most transferable business idea here for UCT's Discord.

---

## C. Navigation: how users move

**OBSERVATION — four doors, and a command palette is one of them.**

1. **A left side menu** with pinnable items. Changelog, 2026-03-08: "Added ability to pin menu
   items to the top of the side menu".
2. **A global command palette / search**, invoked by **Ctrl-K**, with a `/` mode for **commands**.
   The 404 page renders it directly: "Try using the search below… Examples: Options Flow / Options
   Screener / Flow Alerts", with the chips `Ctrl` `K` `search` and `/` `cmds`.
3. **Deep-linkable, fully-parameterised URLs.** The options screener encodes its entire filter set
   in the query string — observed verbatim:
   `?limit=150&exclude_itm=true&issue_types[]=Common%20Stock&issue_types[]=ADR&max_dte=183&max_multileg_volume_ratio=0.1&min_ask_perc=0.7&min_volume=500&min_premium=250000&type=Calls&vol_greater_oi=true&watchlist_name=500K%20OTM%20Call%20Buyer%20Stock%20Only`.
   The screen has a *name* in the URL.
4. **Click-through between surfaces as a first-class action.** Changelog, 2026-07-24: "Clicking
   Market Tide now takes you to that minute in the flow feed." In-product help (`/overview`):
   "Left-click the contract's expiration date (ex: 5/19/2023) in the feed to open a popup with
   additional data… Right-click for more options. Click the stock price in the feed to view more
   about the ticker."

**EVIDENCE.** `https://unusualwhales.com/flow/dark_pool_flow` (404 page, 2026-09-02, direct
demonstration — **verified**); `https://unusualwhales.com/options-screener` (2026-09-02, direct
demonstration — **verified**); `https://unusualwhales.com/overview` in-product "Flow Shortcuts"
help text (2026-09-02, Tier: official in-product documentation — **verified**);
`https://unusualwhales.com/changelog` entries dated 2026-03-08, 2026-07-24, 2025-02-15 ("Added
keyboard shortcuts to the Super Flow"), 2025-09-18 ("Stock Watchlist Sidebar now allows for quick
navigation between tickers"), 2025-03-10 ("Added watchlists to website search"), 2025-02-26
("Website search updated to return options contract volume bars") — Tier: official release notes —
**verified**.

**INTERPRETATION.** Navigation is *lateral*, not hierarchical: the intended motion is
feed → row → popup → related surface, and the search bar is a jump-to rather than a discovery
tool. Note that the search bar returns **data** (contract volume bars, watchlists), not just
routes — the palette is a mini-terminal.

**RELEVANCE TO UCT.** TERMINAL-NEXT's navigation model. UCT's dashboard today is a left NavBar plus
per-page tabs; there is no global command palette. The "click a chart minute → land on that minute
in the tape" gesture is the single most terminal-like behaviour observed in this product and maps
cleanly onto UCT's breadth/flow surfaces.

**CONFIDENCE.** 🟢 on the palette existing and on URL-encoded state (both directly observed).
🟡 on how deep the palette goes — its result set could not be exercised logged out.

**RECOMMENDATION (hypothesis).** *A time-anchored cross-surface jump ("this minute, in that feed")
is worth more to a desk than another chart overlay, because it converts a chart observation into a
tape query without retyping a filter.* Serves the desk's "why is this moving" workflow (§E-A).

**OPEN QUESTION.** Is the Ctrl-K palette a fuzzy router only, or does it accept a query language
(as `/cmds` implies)?

---

## D. Capability map (Part XIII taxonomy)

**OBSERVATION.** Derived from two official artifacts — the public sitemap (routes a human uses)
and the OpenAPI spec (221 paths a machine uses). Both were read in full; nothing below is
hand-counted from memory.

| Part XIII bucket | Unusual Whales surfaces (routes / API groups) |
|---|---|
| **Market overview** | `/overview`, `/market/statistics`, `/market/maps`, `/market/trading-day`, `/monitor`, `/stats`; API: `market-tide`, `sector-tide`, `etf-tide`, `top-net-impact`, `total-options-volume`, `correlations`, `movers`, `oi-change`, `sector-etfs`, `options-pulse/{sectors,top,total}` |
| **Security pages** | `/stock/{TICKER}/overview` (+ MENU of sub-pages), `/stocks`, `/ticker-performance`, `/flow/ticker/overview`; API: 38 `stock/{ticker}/*` endpoints |
| **Fundamentals** | `/financials`, `/analyst-ratings`, `/analysts`, `/dividends`, `/stock-splits`, `/sec`, `/investor_relations`, `/institutions`, `/private-markets`; API: `income-statements`, `balance-sheets`, `cash-flows`, `financials`, `fundamental-breakdown`, `companies/{ticker}/{profile,dividends,splits,earnings-estimates,transcripts}` |
| **News** | `/news`, `/news-feed`, `/catalysts`, `/stock-talk` (a social feed); API: `news/headlines`, `potus/posts`, `potus/schedule` |
| **Earnings** | `/earnings`, `/earnings/premarket`, `/earnings/afterhours`; API: `earnings/{ticker,premarket,afterhours}`, `companies/{ticker}/transcripts/{quarter}` |
| **Economic** | `/economic-calendar`, `/economic-calendar/fed-speakers`, `/fda-calendar`, `/market-holidays`, `/trading-calendar`, `/trading-halts`, `/us-economy/tourism`; API: `economy/{indicator}`, `market/economic-calendar`, `market/fda-calendar`, `commodities/{name}`, `forex/*`, `calendar/ipo` |
| **Screening** | `/options-screener` (a.k.a. Hottest Chains), `/stock-screener`, `/hottest-contracts`, `/unusual-trades`, `/short_screener`, `/volatility-radar`, `/option-strategies`; API: `screener/{stocks,option-contracts,analysts}`, `option-activity/unusual` |
| **Charting** | `/charting`, `/charting/v2`, `/chart/fullscreen`, `/stock-chart`, `/flow/stock_chart`, `/heatmaps`, `/saved-heatmaps`, `/flow/charting`, `/compare`, `/correlation` |
| **Alerts** | `/custom-alerts`, `/custom-alerts/create`, `/custom-alerts/active`, `/custom-alerts/reference` (a **formula language**, §H), `/option-flow-alerts` (+ `/rules`); API: 5 `alerts/*` endpoints incl. `alerts/query/grammar` |
| **Portfolio / watchlist** | `/portfolios`, `/backtesting/portfolios`, `/backtesting/new`, `/flow/watchlist`, `/flow/option-watchlist`, `/flow/sectors_watchlist`, `/predictions/watchlists` |
| **Documents** | `/sec`, API `institutions/latest_filings`, `insider/*` (Form 4), `politician-portfolios/disclosures`, `congress/late-reports`, `politics/fec/*` |
| **Collaboration** | `/community` — **Filter Showcase** (published saved filters, likeable) + **Shared Chains / Most Bookmarked Chains** (community trade calls, marked to market) + in-app chat; `/stock-talk` threads; Discord + Telegram bots |
| **AI** | `/ai` (Mr. Whale: chat, Newsletters, Research, Feed Monitor, Scheduled Run), `/ai/earnings_analyst`, `/ai/tasks`; MCP server (`/public-api/mcp`), agent skill file (`/skill.md`) |
| **Command / keyboard** | Ctrl-K palette with `/cmds`; Super Flow keyboard shortcuts (changelog 2025-02-15); 84 free + 21 premium Discord slash commands |
| **Workspaces** | `/dashboard` ("Customizable flow dashboard", paywalled), **Super Flow** multi-window dashboard (30+ changelog entries), `/periscope/*` multi-chart view, saved heatmaps, per-feed saved filters |

**The options-native core — the part with no analog in general-purpose terminals:**

- **Live options flow (full tape).** Every executed options trade across all US exchanges, one row
  per transaction, enriched with NBBO bid/ask at time of trade, greeks, IV, OI, volume, premium,
  underlying price, sweep/cross/floor/auction flags, multi-leg linkage, cancel/modify status.
- **Flow Alerts** — rule-based aggregations *over* the tape (§I, and the rule catalogue below).
- **Interval Flow / Multi-leg Flow / Lit Flow / Futures Flow** — the same primitive, re-bucketed.
- **Dark pool (off-lit) flow** — `/dark-pool-flow` with a "Whale Feed" and a "Price Group" view;
  API `darkpool/recent`, `darkpool/{ticker}`, `darkpool/{ticker}/price-levels`; WebSocket channel
  `off_lit_trades`.
- **Dark-pool-versus-lit by price level** — on the ticker page, a table of *Price Group · Call Vol ·
  Put Vol · Dark Pool Vol · Lit Vol · DP %*, footnoted "Off/Lit exchanges covers everything being
  reported by Nasdaq / Finra". Observed live on AAPL: DP % ranging 26.25% → 100% across price
  buckets.
- **GEX / dealer positioning.** `/periscope/market-exposure` ("Periscope — Market Maker Exposure"),
  with chart toggles **Gamma · Vanna · Charm · Positions · Straddle**, a **Flip** highlight, modes
  **Absolute / Change**, and **lookbacks 10m / 20m / 30m** (positions-N-minutes-ago overlays).
  Plus GEX Heatmaps (shipped 2026-08-14, "near second-to-second updates" from 2026-08-25), and API
  `gex-levels`, `greek-exposure[/expiry|/strike|/strike-expiry]`, `spot-exposures[...]`,
  `greek-flow`, `max-pain`, `nope`, `oi-change`.
- **Volatility.** `iv-rank`, `interpolated-iv`, `volatility/{term-structure,realized,stats,anomaly,
  character,variance-risk-premium}`, `historical-risk-reversal-skew`, `vix-term-structure`.
- **Disclosure datasets.** Congress (4 + 4 "unusual trades" endpoints + politician portfolios),
  insiders, institutions/13F, FEC contributions and lobbying, short interest + FTDs, prediction
  markets, private markets.

**Flow Alert rule catalogue (verbatim names, official page).** Sweeps Followed By Floor · Repeated
Hits · Repeated Hits Ascending Fill · Repeated Hits Descending Fill · OTM Earnings Floor · Low
Historic Volume Floor · Floor Trade Small Cap · Floor Trade Mid Cap · Floor Trade Large Cap.

**EVIDENCE.** `https://unusualwhales.com/sitemap-0.xml`, `https://api.unusualwhales.com/api/openapi`
(998 KB YAML, read locally; 221 paths enumerated), `https://unusualwhales.com/option-flow-alerts/rules`,
`https://unusualwhales.com/dark-pool-flow`, `https://unusualwhales.com/periscope/market-exposure`,
`https://unusualwhales.com/stock/AAPL/overview`, `https://unusualwhales.com/changelog` — all
2026-09-02, Tiers 1–4 (official docs, official API spec, official product pages, direct
demonstration) — **verified**.

**INTERPRETATION.** The capability map is *wide but shallow by design*. There is no portfolio
accounting, no trade journal, no broker sync, no coaching layer, no research-document search. What
there is, is one row shape (an options transaction) exposed through a dozen aggregations, plus a
long tail of disclosure datasets that are cheap to acquire and highly shareable. The company is a
**data-plumbing business with a feed UI on top**, which is exactly why the API is a co-equal
product rather than an afterthought.

**RELEVANCE TO UCT.** Direct overlap with UCT's `/options-flow`, `/live-massive`, dark-pool and GEX
rails. Direct *non*-overlap — and therefore UCT's defensible ground — is everything downstream of
the print: the Journal, Compass coaching, the Model Book, the Morning Wire, broker mirror, and the
firm's own regime/breadth/exposure rating. UW has no equivalent of any of those.

**CONFIDENCE.** 🟢 on the inventory (two official machine-readable artifacts agree). 🟡 on which
capabilities are *good*, since most were observed only in a 2-day-delayed state.

**RECOMMENDATION (hypothesis).** *A dark-pool-versus-lit **percentage per price bucket** is a more
actionable presentation of off-exchange data than a print feed, because it answers "where is the
size sitting" rather than "what just printed".* Serves the desk's Workflow A and F.

**OPEN QUESTION.** Does UW compute GEX from open interest, from directionalized volume, or both by
default in the UI? The API changed its default to directionalized volume on 2026-08-22 — the UI's
default is unverified.

---

## E. Workflows (Part XIV A–G)

Brief by contract; Wave 2 reconstructs five in depth. Each entry names the observed path and what
is missing.

**A. "Why is this stock moving."** Ticker page (`/stock/{SYM}/overview`) opens with a stat strip
(Mkt Cap, P/E, Avg Vol, Earnings date, Div Yield), an options-volume chart with tabs *Options Vol ·
Avg Vol · Net Prem · Strikes · Stock*, a LATEST NEWS column, a Key Stats block including a **FLOW**
section (Net Prem, Net Vol, Call Prem/Vol, Put Prem/Vol with 🐻/🐂 markers), and the DP-vs-lit price
table. From any tape row you can right-click into related trades and click the price into the
ticker. **Missing:** no synthesised "here is the reason" — the user assembles the causal story.
The AI assistant (§I) is the first attempt to close that gap. **🟡** — page structure observed, but
in 2-day-delayed state.

**B. "Prepare me for earnings."** Weak. `/earnings`, `/earnings/premarket`, `/earnings/afterhours`;
API `earnings/{ticker}` and `companies/{ticker}/transcripts/{quarter}`; a "% IV Change" and
"Earnings Date Gap / Avoid earnings / Earnings week" filter across every feed; an implied-move
figure (changelog 2023-06-29 "Updated earnings implied move data"); a dedicated `OTM Earnings
Floor` alert rule. **Missing:** no estimate history table, no revision trend, no guidance parsing,
no pre/post-call briefing surface. Earnings is a *filter dimension* here, not a workflow. **🟡**.

**C. "Research this company from scratch."** Weakest workflow. Fundamentals exist (financials,
analyst ratings, institutional holdings, SEC filings, private-markets profiles) but they are
scattered across separate routes and are visibly bolted on — several fundamentals endpoints are
**Advanced-API-tier only**, added 2026-04-30. A user doing genuine company research would leave.
**🟡**.

**D. "What matters today."** Strong and distinctive. `/overview` composes Market Tide (a
proprietary minute-by-minute net-premium sentiment series), net impact (which tickers move the
tide), total options volume, sector tides, ETF tides, movers, halts, and the Large Trades table.
The Market Tide → flow-feed-at-that-minute jump (changelog 2026-07-24) is the workflow's spine.
**🟢** on structure, **🔴** on how it feels live.

**E. "Find a trade."** The product's centre of gravity. Two funnels: (i) the **live flow feed**
with ~60 filter controls; (ii) the **options screener / Hottest Chains** with named presets —
*Unusually Bullish · Unusually Bearish · Unusual Vol · IV 15–30 · Unusual Vol · IV 31–70 · Deep
Conviction Calls · Deep Conviction Puts · Long-Term Calls · Put Sells · Cheap Calls · Bullish Credit
Trades · Bearish Credit Trades*, plus a "Trade Idea" selector. Then **Flow Alerts** run the
rule-set for you so "you do not have to monitor all of the flow by yourself all day" (official
wording). Then **custom alerts** in a formula language push the result. Then the community
publishes its filters so you can adopt someone else's. **🟢**.

**F. "Monitor my universe."** Watchlists (stock and options, separately), watchlist-scoped Discord
commands (`/watchlist flow_alerts`, `/watchlist netflow`, …), `#mylist` scoping inside the alert
formula language, 17 Discord push-notification topics, mobile push, email, and AI "Feed Monitors"
that watch a feed and alert on a match. Retail Basic caps this at **5 watchlists / 25 alerts /
5 dashboards / 10 saved filters per feed**; Pro and Max are unlimited. **🟢**.

**G. "Understand the regime."** Interpreted here as *dealer positioning + market-wide sentiment*.
Periscope (Gamma/Vanna/Charm/Positions/Straddle, flip highlight, 10/20/30-minute lookbacks),
GEX heatmaps, gamma flip / call wall / put wall / gamma magnet levels, NOPE, market tide, sector
tide, VIX term structure, seasonality. **Notably absent:** any *breadth* rail — no advance/decline,
no % above moving average, no new-highs/new-lows, no distribution-day count. UW's "regime" is
entirely an options-market construct. **🟢** on what exists; **🔴** on live behaviour.

**EVIDENCE.** `/stock/AAPL/overview`, `/options-screener`, `/live-options-flow/free`,
`/option-flow-alerts`, `/custom-alerts/reference`, `/discord-bot`, `/periscope/market-exposure`,
`/overview`, `/changelog`, `/pricing` — all 2026-09-02, direct demonstration + official pages —
**verified**; workflow *quality* judgements are **reported/inferred**, not demonstrated.

**RELEVANCE TO UCT.** Workflow G is the sharpest contrast: UCT's regime rail is breadth-first
(Stockbee-style participation, MA stacks, distribution days, the UCT Exposure Rating) and UW's is
dealer-positioning-first. Neither is complete. A desk that can read *both* — participation and
dealer gamma — in one place has something neither product offers today.

**CONFIDENCE.** 🟡 overall. **Ceiling:** no logged-in session.

**RECOMMENDATION (hypothesis).** *"What matters today" is better served by one composed page with
cross-links than by a set of good separate pages, and the cross-link (chart-minute → tape-minute)
is what makes it composed rather than merely adjacent.*

**OPEN QUESTION.** How much of Workflow E's value is the filters versus the community's published
filters? If the latter dominates, the moat is social, not technical.

---

## F. Data: coverage, vendors, latency, asset classes, history

**OBSERVATION.**

*Coverage.* Options: "Full Tape, 100% market coverage" across all US exchanges (marketing claim,
consistent with the WebSocket doc's "The `option_trades` channel will stream all 6,000,000 option
trades in real-time"). Equities: "Real-Time Nasdaq Equities Data" (API tier copy). Off-exchange:
"Off/Lit exchanges covers everything being reported by Nasdaq / Finra". Universe: "11K+ TICKERS".
Also: futures (CME tape, candles, settlement, OI), crypto (OHLC, whale transactions), forex,
commodities, digital currencies, prediction markets, private markets.

*Vendors — mostly undisclosed.* The only named upstreams found were **OPRA** (condition codes in
the Data Shop dictionary: "Upstream Condition Detail — the OPRA condition code"), **FINRA/Nasdaq**
(off-lit attribution above), **SEC** (Form 4 / transaction codes), **CFTC-adjacent none**, **CME**
(futures), and — inadvertently — **Snowflake**, named by staff in the public in-app chat during an
outage ("SNOW(flake) issue") when Periscope stopped updating. Equity/options market data vendor(s)
are not disclosed.

*Latency — the free/paid boundary is a latency boundary, stated verbatim.*
- Live flow, logged out: **"Limited Flow for nonsubscribers: 15 minutes delayed, price data after
  15min for JPM, INTC, IWM, XSP only. For an aggregated rules-based feed, see flow-alerts. For full
  live data, upgrade your account."**
- Flow alerts, dark pool, options screener, ticker overview, shared chains, Periscope, logged out:
  **"Viewing data from 2 days ago. Subscribe for live data."**
- API: a `force_15_min_delay` query parameter exists on flow-alerts — "Only return trades that are
  at least 15 minutes old" — i.e. the delay is a *product control*, presumably for redistribution
  licensing, not a data limitation.
- Spot GEX: "This data updates about once per minute during the cash session." SPX Market Maker
  Exposure: **10-minute updates on Basic/Pro, 1-minute on Retail Max and on API Advanced.**
  GEX heatmaps: "near second-to-second updates" since 2026-08-25.
- Off-lit prints: "reported to the consolidated tape via a TRF (typically with a small delay), so
  `trf_executed_at` is more frequently populated on this channel and may differ from
  `executed_at`."

*History depth.* API lookback is **90 days (Trial and Startup)**, **2 years (Basic and Advanced)**.
Data Shop sells bulk historical option trades at **"$250 per month for the full market"** with a
**10% discount for data over 1 year**. Seasonality pages carry "15 years of data (if available)"
(changelog 2023-09-06). Daily flow/dark-pool downloads are included with paid dashboard plans.

**EVIDENCE.** `https://unusualwhales.com/live-options-flow/free`,
`https://unusualwhales.com/option-flow-alerts`, `https://unusualwhales.com/dark-pool-flow`,
`https://unusualwhales.com/periscope/market-exposure`, `https://unusualwhales.com/data_shop/info`,
`https://unusualwhales.com/pricing?product=api`, `https://api.unusualwhales.com/api/openapi`
(endpoint descriptions for `spot-exposures`, `off_lit_trades`, `option_trades`, `flow-alerts`),
`https://unusualwhales.com/community` (staff chat) — all 2026-09-02 — **verified**, except the
Snowflake attribution which is **reported** (staff message in a public chat, not a published
architecture statement).

**INTERPRETATION.** The **15-minute rule** is the load-bearing commercial mechanic: the tape is
worthless late, so a 15-minute delay is a complete demonstration of the product that sells the
subscription without giving anything away. The **2-day delay** on every *derived* surface is
subtler and arguably better — a delayed screener still teaches you what the screener does. UW has
found two different free-tier degradations for two different value shapes, and applied each where
it fits.

**RELEVANCE TO UCT.** UCT's own free/paid boundary (`FREE_PAGES`) is a *page* boundary: some pages
are free, some are not. UW's is a *freshness* boundary on the same page. For TERMINAL-NEXT, the
freshness boundary is more informative to a prospective member and cheaper to maintain than a
second, cut-down UI.

**CONFIDENCE.** 🟢 on latency and history (quoted from the product and the spec).
🔴 on upstream vendors. **Ceiling:** vendor identity is not disclosed anywhere public; only a
subscriber-only support answer or a licensing page would establish it.

**RECOMMENDATION (hypothesis).** *Degrade a free tier by **freshness**, not by feature, wherever the
value of the data decays with time; degrade by **feature** only where it does not.* Serves member
acquisition; testable against UCT's current `FREE_PAGES` split.

**OPEN QUESTION.** Who supplies UW's OPRA feed and its equity tape, and does the same vendor supply
its dark-pool prints? (Relevant to UCT because it bounds what a competitor's cost base looks like.)

---

## G. Customization

**OBSERVATION — customization is metered as the primary paid axis.** The three retail tiers differ
in *almost nothing except how many saved objects you may own*:

| | Retail Basic | Retail Pro | Retail Max |
|---|---|---|---|
| Custom alerts | 25 | Unlimited | Unlimited |
| Watchlists | 5 | Unlimited | Unlimited |
| Custom dashboards | 5 | Unlimited | Unlimited |
| Saveable filters per feed | 10 | Unlimited | Unlimited |
| SPX MM Exposure | 10-min | 10-min | **1-min** |
| AI usage | 1× | 2× | 3× |

Everything else in the three feature lists is byte-identical.

Other customization observed:
- **Column control everywhere.** "Columns" button on flow, dark pool, screener; changelog
  2024-04-03 "Updated the flow feed to allow for the reordering of the columns"; 2025-01-31
  "Added ability to show/hide/rearrange column headers"; 2025-02-25 column reordering on the
  options watchlist.
- **Saved filters as named objects**, with a "Select Filter" dropdown, a "My Flow" tab, and
  **session restoration** — on load the feed announced: *"Filters from previous session have been
  reloaded!"*
- **Super Flow** — a multi-window dashboard with presets, heatmap windows, contract charts, greeks,
  Market Tide/Net Flow charts, ticker interval flow, and keyboard shortcuts (30+ changelog entries,
  2024-04 → 2026-02).
- **Periscope multi-chart view** (changelog 2026-02-27).
- **Saved heatmaps** (`/saved-heatmaps`), watchlist import (2023-10-03), pinnable menu items
  (2026-03-08), configurable mobile menu layout (2025-06-30), accessibility colour schemes
  (2024-06-06, "new color schemes to support those with visual impairment"), date-format settings.
- **Universe presets** in the flow filter: Top 50 / Top 100 by option volume, SPY, QQQ, DIA,
  IWM (top 250), Magnificent 7, SMH, XBI, XLE, XLF, KRE, XRT, GDX, ARKK, FXI.

**Multi-monitor:** not observed. There is no desktop application in the sitemap; the platform is
web + iOS/Android app + Discord/Telegram bots.

**EVIDENCE.** `https://unusualwhales.com/pricing` (feature lists, 2026-09-02),
`https://unusualwhales.com/live-options-flow/free`, `https://unusualwhales.com/options-screener`,
`https://unusualwhales.com/dark-pool-flow`, `https://unusualwhales.com/changelog` — official pages
and direct demonstration — **verified**.

**INTERPRETATION.** This is the sharpest commercial insight in the dossier: **UW does not sell
data tiers to retail, it sells *how much of your own configuration you may keep*.** Every tier gets
the full real-time tape. What Pro buys is the removal of a counter. That is unusually honest (no
data is withheld) and unusually sticky (each saved filter raises switching cost), and it means the
free-to-paid *and* Basic-to-Pro conversions are both driven by the user's own accumulated work.

**RELEVANCE TO UCT.** TERMINAL-NEXT's tiering. UCT currently gates by page. A configuration-count
tier would require the workspace objects (`charts_workspace_layout`, saved screens, watchlists,
alerts) to be first-class, countable, server-side records — which several already are.

**CONFIDENCE.** 🟢 on the metering (three feature lists compared line by line). 🔴 on what Super
Flow actually looks and feels like — it is entirely behind the paywall. **Ceiling:** one month of
Retail Basic would resolve it.

**RECOMMENDATION (hypothesis).** *Metering saved configuration rather than data access converts
better and churns less, because the thing withheld is the user's own work and the thing given away
is the thing that proves the product.* Anti-hypothesis: it also means a free/Basic user can extract
full value with 10 well-chosen filters and never upgrade.

**OPEN QUESTION.** Is a "custom dashboard" in the pricing table the same object as a "Super Flow"
window layout, or two different persistence systems? (Two names for one saved object is a
documentation-drift smell — cf. §J.)

---

## H. Search / commands / the alert formula language

**OBSERVATION — the standout artifact of this whole dossier is a small, readable query language for
alerts.** `/custom-alerts/reference` documents it in the product's own words:

> "Every custom alert can be written as a single formula: `where` followed by the conditions you
> care about."

Its documented primitives:
- **Number shortcuts** — "k = thousand, m = million, b = billion, % = percent. Write `50k`, `1.5m`,
  `5%`."
- **Combinators** — "`and` needs both sides true, `or` needs one. Group with `( )` when mixing.
  `not` flips a condition."
- **Scoping** — "`$AAPL` limits to a ticker, `@tech` to a sector, `#mylist` to a watchlist. Put them
  before `where`."
- **Comparison and arithmetic** — "Fields can be compared to numbers **or to each other**, like
  `volume > open_int`. Arithmetic works too: `size * price > 50k`."
- **Five typed subjects**, each with its own field set: OPTION TRADES · OPTION CONTRACTS · INTERVAL
  FLOW · FLOW ALERT · MULTI-LEG TRADE.
- **Starter recipes** per alert type, each clickable to open in the editor.
- A machine-readable counterpart exists: API `GET /api/alerts/query/grammar`.

Alongside it: an **AI filter builder** (changelog 2025-01-15 "Added AI flow filter creator";
2025-04-29 "Added AI filter builder to the website") that composes the same formulas from English —
so the language has both a natural-language front door and a precise back door.

Ticker resolution: the global search bar returns tickers, watchlists and **options contract volume
bars** in results (changelog 2025-02-26, 2025-03-10). Contract look-up is a dedicated surface.

**EVIDENCE.** `https://unusualwhales.com/custom-alerts/reference` (Tier: official documentation,
2026-09-02) — **verified**; `https://api.unusualwhales.com/api/openapi` path
`/api/alerts/query/grammar` — **verified**; changelog entries — **verified**.

**INTERPRETATION.** Three design decisions worth stealing outright: (1) **one language across five
different feed types**, so learning it once pays five times; (2) **scope prefixes that read like
what they are** (`$TICKER`, `@sector`, `#watchlist`) — a user can guess them; (3) **field-to-field
comparison**, which is what separates a query language from a filter panel — `volume > open_int`
cannot be expressed by any number of sliders. The AI builder is positioned correctly: as a *ramp
onto* the language, not a replacement for it, so the artifact the user ends up owning is still
inspectable text.

**RELEVANCE TO UCT.** This maps almost perfectly onto UCT's screener definition tree, the
Concierge (English → a SCAN), and the Builder criteria picker: UCT has the AST and the
natural-language door but, on the public evidence available here, no small human-writable surface
syntax that a member could type, read, share, or diff. UW's evidence is that the *text form* is
what makes filters shareable (§collaboration, §M-2).

**CONFIDENCE.** 🟢 on the language's documented grammar (quoted from official docs). 🟡 on its
real expressiveness — the field lists render only for logged-in users ("loading fields…" was as far
as a logged-out session got).

**RECOMMENDATION (hypothesis).** *A saved screen expressed as short, readable text — rather than as
opaque UI state — is what makes it shareable, reviewable and portable; the AI builder should emit
that text, not replace it.* Serves the member "find a trade" workflow and the desk's scan review.

**OPEN QUESTION.** How many fields does each of the five subjects expose, and is the field set the
same one the REST screener accepts? If they diverge, that is a second-authority defect of exactly
the shape UCT's own memory warns about.

---

## I. AI: what is shipped versus what is marketed

**OBSERVATION.** Three distinct AI-shaped things, at three different maturities.

**1. Mr. Whale (shipped; chat + automations).** Added 2026-05-19 ("Added AI chat assistant"),
marketed as "your AI Analyst and Trade Finder", **metered by tier** (1× / 2× / 3× usage). Its
landing page advertises four automation types — **Newsletters** (recurring, scheduled, delivered to
inbox), **Research** (one-time multi-step deep report), **Feed Monitor** (watches live feeds, alerts
on match), **Scheduled Run** (any request on a cadence). Sample prompts shown: "Show me today's
biggest call sweeps over $1M", "Summarize NVDA's option flow heading into earnings", "Build me a
screener for unusual dark pool prints", "What's the dealer positioning telling me about TSLA?".
**Grounding/citation behaviour: NOT DETERMINED** — the assistant is subscription-gated and no
public transcript or citation example was found. Ceiling: a subscriber screenshot or a session.

**2. The agent-facing data layer (shipped, and unusually complete).** An MCP server
(`/public-api/mcp`, shipped 2026-03-12), a published **agent skill file** (`/skill.md`), an
OpenAPI spec, and — from the API changelog dated 2026-08-30 — MCP "builder prompts"
(`build_dashboard_app`, `build_confluence_alert`, `build_trading_bot`, `build_data_stream`,
`start_from_example`, `setup_api_project`) plus tools `get_build_recipe` and `get_api_examples`
pointing at a public examples repo. The skill file's own framing is notable: it "emphasizes
avoiding 'commonly hallucinated' endpoints through strict adherence to a whitelisted set of
verified URLs" and mandates headers `Authorization: Bearer …` and `UW-CLIENT-API-ID: 100001`,
GET-only.

**3. AI-generated content in the product (shipped, quality contested).** The AAPL ticker page
carried a daily 4:37 AM news item of a distinctly generated register: *"AAPL at $324.75 may break
$325 Bollinger barrier soon; MACD flat and open interest falling. A crucial 48 hours ahead."* —
three consecutive days, same minute. In the public in-app chat a paying user wrote, of the news
feed: *"paying thousands a year to get this, can't you guys license some decent data?"* Staff reply:
"understand the news leaves something to be desired. ill bump the devs."

**A shipped non-AI feature that behaves like intelligence, and is more interesting than the AI:**
the `/api/stock/{ticker}/option-stance` endpoint ranks a ticker's contracts against a chosen
**stance** (`sell_premium`, `sell_vega`, `directional`, `leaps`, `cheapies`), returning a 0–5
`fit_score`, named 0–1 sub-scores (`iv_regime`, `greeks_fit`, `dte_fit`, `liquidity`,
`earnings_timing`), a plain-language `explanation`, and — verbatim — *"This is **descriptive**
analysis of greeks / IV context / liquidity mechanics — not trade advice… Every response carries a
`disclaimer`."* The score is **decomposed and deterministic**, and the prose narrates it.

**EVIDENCE.** `https://unusualwhales.com/ai`, `https://unusualwhales.com/skill.md`,
`https://api.unusualwhales.com/api/openapi` (`info.description` changelog 2026-08-30;
`option-stance` description), `https://unusualwhales.com/changelog` (2026-05-19, 2026-03-12,
2025-04-29, 2025-01-15), `https://unusualwhales.com/stock/AAPL/overview`,
`https://unusualwhales.com/community` (chat) — 2026-09-02. Tiers: official product page, official
API spec, official release notes, direct demonstration, community discussion. Items 1–2
**verified/claimed** as marked; item 3's generated-content attribution is **inferred** from
register and timestamp regularity, not stated by UW.

**INTERPRETATION.** UW's most credible AI investment is not the chatbot — it is **making the
product legible to somebody else's agent**. A skill file, an MCP server, a whitelisted endpoint
list, and named build recipes are a bet that a meaningful fraction of users will never open the
website. Meanwhile the `option-stance` design shows the right shape for a scored judgement: a
*computed* score with *named sub-scores* and a *narrating* explanation, plus a standing disclaimer —
the model narrates, it does not decide.

**RELEVANCE TO UCT.** UCT's `grade_ticker` already embodies exactly this principle ("Decisiveness
is STRUCTURAL, not prompted") — UW's `option_stance` is independent confirmation that a
public product converged on the same architecture. The gap UCT should notice is the *other*
direction: UCT has no MCP server, no skill file, and no agent-facing contract for members or the
desk's own tooling.

**CONFIDENCE.** 🟢 on the agent layer and on `option-stance` (both in the official spec).
🔴 on Mr. Whale's grounding, citation and hallucination behaviour. **Ceiling:** subscription
required; a single logged-in session with three factual prompts would settle it.

**RECOMMENDATION (hypothesis).** *Publishing a skill file plus an endpoint whitelist is a cheap,
high-leverage way to make a data product agent-addressable, and the whitelist is the load-bearing
half — it exists to stop the agent inventing endpoints.* Serves the desk's own tooling before it
serves members.

**OPEN QUESTION.** Does Mr. Whale cite the tool results behind its numbers, and does it refuse when
the data is not there? Without that, a chat over a real-time tape is a hallucination surface with a
price tag.

---

## J. UX: strengths, weaknesses, density, onboarding, anti-patterns

**Strengths.**
- **Density that is earned.** The flow feed is a dense table with ~60 filter controls in a single
  scrollable rail, grouped under plain headings (TIME RANGE, SIDE, CHAIN ACTIVITY, OPTION TYPE,
  EQUITY TYPE, GREEKS, FLAG TYPE, EXTRA, OTHERS) — legible because the grouping is semantic.
- **Honest in-product explanation.** The `/overview` "Flow Legend" spells out that BULLISH/BEARISH
  are *fill-price-versus-NBBO* labels and then immediately undercuts its own labels: *"A trade
  transacting at the bid is not necessarily a sell, nor is a trade transaction at the ask
  necessarily a buy."* It also explains struck-out rows ("trades… have been modified or nullified…
  This is a normal occurrence"), the ex-dividend deep-ITM artefact ("This is most likely arbitrage
  and can be ignored"), the multi-leg marker's limits ("Trades missing / are not necessarily a
  single leg trade"), and that the underlying price for index tickers "is unfortunately not
  available at the moment."
- **Progressive shortcuts.** Left-click, right-click and hover each do something different on the
  same cell, and the help text says so.
- **Onboarding.** "Added interactive onboarding to several platform features" (2025-10-13); an
  "information drawer" on various pages (2025-01-15); an "information hub for educational material"
  (2024-11-29); an `Info` button on the flow, screener and Periscope surfaces.
- **Accessibility.** Colour schemes for visual impairment (2024-06-06) — rare in this category.

**Weaknesses (reported, from the public in-app chat, 2026-08/09).**
- *"SPX MM not updating for me, anybody else issues w it?"* → *"Ya same here, periscope not
  updateing"* → staff: *"SNOW(flake) issue… should be coming back up soon."*
- *"watchlist sparkline charts broken today"*; *"SPY heatmap is missing a lot of data"*.
- *"why did you guys remove the option that could let us remove the yellow line from market tide
  chart? your upgrade supposed to make things easier not harder"* — a regression complaint on a
  shipped chart control.
- *"can someone tell me what happened to live future quotes? It was under Market tab now its gone."*
- *"can you remove the Shared Chains on a ticker's overview page? it takes up space and not
  interested in what others post… and most of the time its full of expired contracts."*

**Anti-patterns observed.**
1. **Two chat surfaces, one of them dead.** The on-site `/community` chat carried *"is this chat
   dead"* — answered by staff with *"discord.gg/unusualwhales sub chat is much more active"* and
   *"would recommend discord — more staff there + community members."* A second community surface
   that the vendor itself routes away from is pure maintenance cost.
2. **Documentation that contradicts itself about its own thresholds.** `/option-flow-alerts/rules`
   states the Repeated Hits rule as *"Groups trades based on their chain within **100 milliseconds**…
   Alerts if the total amount of trades is greater than **5** and the total premium is greater than
   **10K**"* — and then its own worked example on the same page says *"RepeatedHits states that it
   groups all trades in a **2 second** time frame"* and *"To trigger an alert it says that the total
   amount of trades is greater than **10** and the total premium is greater than **50K**."* Three
   numbers disagree between the rule and the example that is supposed to illustrate it.
3. **Two prices for the same thing on adjacent pages.** `/pricing/more` renders "Free tier · paid
   from **$17/mo**" directly above a card reading "$20 → **$16**/mo".
4. **Community-count drift.** The homepage says "a **100,000+** community" and "Join over
   **100,000** traders" in its hero, and "Join of community of **80k+** like-minded traders" in its
   footer feature grid, on the same page.

**EVIDENCE.** `https://unusualwhales.com/overview`, `/live-options-flow/free`,
`/option-flow-alerts/rules`, `/pricing/more`, `/`, `/community`, `/changelog` — 2026-09-02.
Tiers: official in-product documentation; direct demonstration; community discussion (weaknesses
are **reported**, one user each, not measured).

**INTERPRETATION.** The product is strongest exactly where it is most honest and weakest exactly
where it duplicated a surface. The self-contradicting rules page is the most instructive defect for
UCT: it is a **hand-typed threshold sitting beside a worked example that was written against an
older version of the rule** — the same class of drift UCT's own CLAUDE.md documents repeatedly
(a count typed beside the list it describes).

**RELEVANCE TO UCT.** Direct: the "measure it, don't quote it" discipline UCT applies to its own
docs is exactly what would have caught defects 2, 3 and 4 here. And UCT is currently running *two*
community surfaces of its own (Discord + the in-app Community tab) — anti-pattern 1 is a live
warning, not a hypothetical.

**CONFIDENCE.** 🟢 on the strengths and on all four anti-patterns (all directly observed on official
pages). 🟡 on the weaknesses (single-user reports, unmeasured, though several were staff-confirmed
in the same thread).

**RECOMMENDATION (hypothesis).** *A worked example beside a rule is a second authority over the
rule's thresholds and will drift; the example should be generated from the rule's constants, or the
constants should not appear in prose at all.*

**OPEN QUESTION.** Are the rules-page numbers or the example numbers the live ones? A subscriber
could settle it by reading a fired alert's constituent trades (`/flow-alerts/{id}` exposes them).

---

## K. Performance

**OBSERVATION.** No measurement was possible. What exists:
- **Claimed:** "Real-time LIVE MARKET DATA"; the WebSocket doc's illustrative "3 events · 41ms";
  "near second-to-second updates" for GEX heatmaps (changelog 2026-08-25); "This data updates about
  once per minute during the cash session" for spot GEX; 10-minute vs 1-minute SPX MM exposure as a
  *paid tier difference*, which implies the underlying computation is at least minute-resolution.
- **Reported (community chat, unmeasured):** Periscope and SPX MM exposure stalling during a
  Snowflake incident; a heatmap "missing a lot of data" that self-resolved within two minutes;
  broken watchlist sparklines; one 2025-10-20 changelog entry "RESOLVED — Monday Oct 10 — site
  issues being investigated" and two more in 2024 ("**RESOLVED** Website issues, May 15";
  "**RESOLVED** April 24: Issue with NVDA options").
- **Reported (product-side):** "Improved website performance" (2023-06-27); "Updated flow feed live
  pushing logic" (2025-07-29); "Chime now works independently of other tabs" (2026-08-05) — the
  last implies the audible alert chime was previously coupled across tabs, a cross-tab-state
  problem UCT will recognise.
- **Density claim:** "6,000,000 option trades" per day streamed on one channel; "1B+ DATA POINTS".

**EVIDENCE.** `https://api.unusualwhales.com/api/openapi`, `https://unusualwhales.com/changelog`,
`https://unusualwhales.com/pricing?product=api`, `https://unusualwhales.com/community` — 2026-09-02.

**INTERPRETATION.** The only *structural* performance fact worth carrying forward is that UW sells
**refresh cadence as a tier** (10-min vs 1-min SPX exposure, $75 → $120). That is a pricing model
for expensive compute, and it is honest: the cheap tier is not broken, it is slower.

**RELEVANCE TO UCT.** UCT's own memory records that its web pod is a single uvicorn process and that
every scale win is about not fanning out per-user work. Selling cadence rather than access is one
way to bound that fan-out commercially rather than technically.

**CONFIDENCE.** 🔴. **Ceiling:** performance cannot be established without a logged-in session
during market hours plus instrumentation. A one-month Retail Basic seat and a 30-minute market-open
observation with network timing would move this to 🟡; only a paid Max seat would allow comparing
10-min against 1-min cadence.

**RECOMMENDATION (hypothesis).** *Where a real-time computation is expensive, sell its **cadence**
as the tier rather than gating access — the slower tier still demonstrates the feature and the
faster tier has an obvious, honest reason to cost more.*

**OPEN QUESTION.** What is the actual end-to-end latency from OPRA print to a row appearing in a
paid user's feed? UW never claims a number.

---

## L. Pricing and business model

All figures read **2026-09-02**, during a "Labor Day Sale" (20% off, countdown showing 6 days).
Both list and sale prices are recorded because the sale distorts the headline.

**Dashboard & Tools (per seat, retail):**

| Tier | List /mo | Sale /mo (monthly billing) | Annual (sale) | Annual (regular) | Effective /mo (annual sale) |
|---|---|---|---|---|---|
| Retail Basic | $50 | $40 ("20% Off for 3 months") | **$404/yr** | $504/yr | $34 |
| Retail Pro (most popular) | $75 | $60 | **$605/yr** | $749/yr | $51 |
| Retail Max (new) | $120 | $96 | **$980/yr** | $1,196/yr | $82 |

Tier differences: alert/watchlist/dashboard/filter caps, SPX MM exposure cadence (10-min → 1-min),
AI usage multiplier (1× / 2× / 3×). **All three include the real-time full options tape.**

**API (per seat):**

| Tier | List /mo | Sale (annual) | Lookback | Requests/day | Notes |
|---|---|---|---|---|---|
| API Trial – Basic | $50 → **Free** | billed weekly, 1 week | 90 days | 30,000 | no CME futures; websockets included |
| API Basic | $150 | $100/mo eff · **$1,200/yr** | 2 years | 80,000 | + CME futures data |
| API Advanced | $375 | $252/mo eff · **$3,024/yr** | 2 years | **Unlimited** | + 1-min SPX MM exposure, live CME tape over WS |

**Business / redistribution:** "Startup, Kafka streaming, and Enterprise plans **from $625/mo billed
annually**". API spec detail: Startup **$750/mo** or **$7,500/yr** (500 req/min, 80K daily, 90-day
lookback, commercial use included); Startup + Kafka **$3,000/mo** or **$30,000/yr** (1,000 req/min
burst, 10 concurrent). Enterprise and redistribution licensing: contact sales.

**Other lines:**
- **Whale Bundle** — Retail Max + full API + Predictions + Data Shop credits (annual only), "~30%
  savings vs. purchasing separately".
- **Unusual Predictions** — free tier (daily market summary, limited whale alerts, community
  access) + paid at $20 list / $16 sale per month.
- **Discord bot** — **User Subscription $6.99/mo**; **Server Subscription $124.99/mo or $1,250/yr**
  (unlocks premium for every member of one server). Note: "Super-buffet UW subscribers get this
  automatically when their Discord is linked in settings."
- **Data Shop** — bulk historical files; **historical option trades "$250 per month for the full
  market"**, 10% discount for >1 year. Paid dashboard subscribers accrue Data Shop credits
  (changelog 2023-12-08, 2023-07-05).
- **Telegram bot** — free, delayed, no premium tier yet ("Coming soon").
- **Free tier** — limited flow (15-min delayed, 4 tickers priced), 2-day-delayed everything else,
  Discord community access, all political/disclosure trackers.

**Professional / non-professional distinction:** none observed for market-data licensing. The
distinction UW draws is **retail vs. commercial-use/redistribution**, which is a licensing
boundary, not an exchange-status boundary. There is no per-exchange market-data add-on and no
professional-user surcharge on the retail tiers.

**EVIDENCE.** `https://unusualwhales.com/pricing`, `?product=api`, `/pricing/more`,
`/discord-bot`, `/data_shop/info`, `https://api.unusualwhales.com/api/openapi` (`info.description`)
— all 2026-09-02, Tier: official pricing pages and official API documentation — **verified**.
The $17 vs $16 discrepancy on `/pricing/more` is quoted as found.

**INTERPRETATION.** Per-seat, self-serve, credit-card, no sales call below $625/mo — the opposite
posture to every enterprise terminal in this benchmark set. The whole ladder is legible on one
page. The two most interesting rungs are (a) the **free one-week API trial**, which is how a
builder is acquired, and (b) the **$124.99 server subscription**, which is how one buyer pays for
a whole community's access — a wholesale rung that most data businesses do not have.

**RELEVANCE TO UCT.** UCT's paywall is a single paid tier plus `FREE_PAGES`. Three ideas are
relevant to the member persona: the configuration-count ladder (§G), the freshness-degraded free
tier (§F), and the community-wholesale rung. None is a requirement; all three are testable.

**CONFIDENCE.** 🟢 (every number quoted from an official page on a stated date). **Ceiling on
durability:** all prices were read during an active sale, so the "regular" column is the durable
one and the sale column will expire ~2026-09-08.

**RECOMMENDATION (hypothesis).** *A wholesale rung — one buyer pays for a whole community — can be
worth more than many individual seats when the product's value is already social.* Serves UCT's
Discord and the paid community, not the desk.

**OPEN QUESTION.** What is the actual mix between dashboard seats, API seats, and Discord server
subscriptions? Without it, the "wholesale rung" idea is a hypothesis with no denominator.

---

## M. Best ideas for UCT (hypotheses, not requirements)

**M-1 · Meter saved configuration, not data access.**
*Hypothesis:* if TERMINAL-NEXT gives every tier the same live data and tiers on **how many saved
filters / watchlists / dashboards / alerts a user may keep**, conversion is driven by the user's own
accumulated work rather than by withholding the thing that proves the product. **Serves:** the
member persona and the paywall. **Evidence:** UW's three retail feature lists are identical except
for four counters and a refresh cadence (§G). **Risk:** a disciplined user never hits the cap.

**M-2 · A small, readable filter/alert language — with the AI builder emitting it, not replacing it.**
*Hypothesis:* expressing a saved screen as short text (`$AAPL where volume > open_int and premium >
50k`) is what makes it shareable, reviewable, diffable and adoptable; a natural-language builder
should compile *to* that text so the artifact the user owns stays inspectable. **Serves:** the
member "find a trade" workflow and the desk's scan review; maps onto UCT's existing definition tree
and Concierge. **Evidence:** `/custom-alerts/reference` + `alerts/query/grammar` + the AI filter
builder shipping *alongside* rather than instead of it (§H).

**M-3 · Publish the legend that undercuts your own labels.**
*Hypothesis:* a surface that classifies (BULLISH/BEARISH, or UCT's setup grades and exposure tiers)
earns more trust by shipping, in-product, the sentence that says when the classification is wrong —
UW's *"A trade transacting at the bid is not necessarily a sell"* — than by omitting it. **Serves:**
every UCT surface that labels; especially the wire's exposure tier and the flow/dark-pool reads.
**Evidence:** `/overview` Flow Legend (§J). **Note:** this is the single most transferable *cultural*
idea in the dossier and costs nothing to implement.

**M-4 · Mark the community's shared calls to market, publicly.**
*Hypothesis:* a "Shared Chains" table that shows each community-shared contract with **Mark added ·
Last fill · Return** — including −99% and −91% next to the poster's name — is a stronger trust
signal than a curated wins feed, and it converts a chat room into a track record. **Serves:** UCT's
Discord `/chart` command, the Flow Record scoreboard, and the Model Book's teaching function.
**Evidence:** `/community` Shared Chains table, observed with 50 rows and a majority of losers
(§D, §O). **Risk:** it also publishes your community's losses; UW ships it anyway.

**M-5 · A Filter Showcase — user-published screens as a first-class, likeable object.**
*Hypothesis:* letting members publish named saved filters with a description, an author and a like
count turns the screener from a tool into a library and gives new members a cold-start path.
**Serves:** member onboarding and the screener. **Evidence:** `/community` Filter Showcase — 43
published filters across five types (Option Flow, Contract Screener, Chain OI changes, Interval
Flow, Stock Screener), top entry at 195 likes, several authored by staff (§D).

**M-6 · Degrade the free tier by freshness, not by feature.**
*Hypothesis:* a free tier that shows the *whole* product 15 minutes (tape) or 2 days (derived
surfaces) late demonstrates the value precisely and cannibalises nothing, and costs far less to
maintain than a second cut-down UI. **Serves:** acquisition; compares directly against UCT's
`FREE_PAGES` page-split. **Evidence:** the verbatim gate strings in §F.

**M-7 · Time-anchored cross-surface jumps.**
*Hypothesis:* "click a minute on the aggregate chart → land on that minute in the raw feed" is worth
more to a desk than an additional overlay, because it converts an observation into a query without
retyping a filter. **Serves:** the desk's Workflow A and D. **Evidence:** changelog 2026-07-24
(§C).

**M-8 · Sell refresh cadence as the tier where compute is expensive.**
*Hypothesis:* a 10-minute vs 1-minute split on an expensive real-time computation is an honest,
self-explaining paid upgrade and bounds per-user fan-out commercially. **Serves:** the single-pod
scaling constraint UCT already lives with. **Evidence:** Retail Basic/Pro 10-min vs Retail Max
1-min SPX MM exposure, a $45/mo list delta (§K, §L).

**M-9 · Make the product agent-addressable: a skill file plus an endpoint whitelist.**
*Hypothesis:* publishing an MCP server and a skill document with a **whitelisted endpoint list**
(explicitly to stop agents inventing endpoints) is a cheap way to serve builders and, first, the
firm's own tooling. **Serves:** the desk before members. **Evidence:** `/skill.md`, `/public-api/mcp`,
API changelog 2026-08-30 (§I).

**M-10 · Decomposed, deterministic scores with a narrating explanation.**
*Hypothesis:* a judgement surface should compute a score from **named sub-scores** and let the model
narrate it, never invent it — and should carry a standing disclaimer. **Serves:** UCT's `grade_ticker`
and the wire's picks. **Evidence:** `option-stance`'s `fit_score` + five named sub-scores +
`explanation` + `disclaimer` (§I). *Note: this is convergence, not a new idea — UCT already built
this shape. Its value here is as independent confirmation.*

---

## N. Bad ideas for UCT (avoid, and why)

**N-1 · A second community surface the vendor itself routes away from.** UW runs an on-site
`/community` chat *and* a Discord, and its own staff answer on-site questions with "discord is much
more active… would recommend discord — more staff there". A user asked "is this chat dead". UCT is
currently running the same two-surface pattern (Discord plus an in-app Community tab). *Avoid:*
maintaining a chat surface whose best answer is a link to the other chat surface. **Evidence:**
`/community` chat log, 2026-09-02, staff messages.

**N-2 · Prose thresholds beside the rule they describe.** The Flow Alert rules page states three
constants (100 ms / >5 trades / >10K premium) and its own worked example on the same page states
three different ones (2 seconds / >10 trades / >50K). *Avoid:* hand-typed constants in prose next to
the code that owns them. UCT's own conventions already forbid this; UW is the live demonstration of
the cost.

**N-3 · A community-content module bolted onto a data page with no relevance filter.** A paying user
asked UW to remove Shared Chains from the ticker overview: *"it takes up space and not interested in
what others post… most of the time its full of expired contracts."* The idea in M-4 is good; putting
it on every ticker page unfiltered and undismissable is not.

**N-4 · Emoji as data semantics.** The flow filter panel labels its own filter categories with
emoji — `Bid 🦴`, `Ask 🛍️`, `Mid ↔️`, `No Side 😐`, `China 🇨🇳`, `Volatility ⚖️`, `Dividend 🥤`, and
`🐂 %` / `🐻 %` as *column names* on the flow-alerts filter. A bone and a shopping bag are not
mnemonics for bid and ask; they are a screen-reader and an internationalisation problem, and they
make the filter set unsearchable by text. UCT's standing `no generic emoji` / `UIcon` convention is
the correct call and this is the counter-example.

**N-5 · Auto-generated ticker "news" indistinguishable from real news.** The AAPL page's daily
4:37 AM items ("MACD flat and open interest falling. A crucial 48 hours ahead.") sit in the same
LATEST NEWS list as genuine wire stories with no marking. A paying user's verdict in chat: *"very
important critical news there in the feed… paying thousands a year to get this."* *Avoid:* mixing
generated commentary into a news feed without a visible provenance mark.

**N-6 · Two prices and two community sizes on the same site.** "$17/mo" above a "$16/mo" card;
"100,000+ community" in a hero and "80k+" in the footer of the same page. Marketing numbers drift
exactly like documentation numbers, and a prospective member reads both.

**N-7 · Vendor-authored "honest comparisons" as an SEO layer.** `/guides` publishes "Best Options
Flow Scanners and Tools in 2026" and seven sibling "Best X in 2026" round-ups — the vendor ranking
its own category. Treated here as **marketing, not evidence**, and not cited anywhere above as fact.
*Avoid:* it is a short-term acquisition trade against long-term credibility, and it is the exact
source class this research programme's evidence standard rules out.

---

## O. Screenshots / evidence links

No images are reproduced. All of the following were read directly on 2026-09-02.

**Official documentation (Tier 1–2)**
- `https://unusualwhales.com/option-flow-alerts/rules` — Flow Alert rule catalogue + worked example.
- `https://unusualwhales.com/overview` — in-product "Live Flow: Large Trades General Information",
  "Flow Shortcuts", "Flow Legend", "Troubleshooting/Misc". The most substantive explanatory text on
  the site.
- `https://unusualwhales.com/custom-alerts/reference` — the custom-alert formula language.
- `https://unusualwhales.com/data_shop/info` — full column dictionary for OHLC 1-Min, OHLC Daily,
  Big Option Trades, Option Chains, Insider Trades. Useful as a reference row-shape for a tape.

**Official API / developer (Tier 4)**
- `https://api.unusualwhales.com/docs` — endpoint index (Markdown available via `Accept: text/plain`).
- `https://api.unusualwhales.com/api/openapi` — 998 KB YAML, **221 paths**; contains the changelog,
  tier pricing, and the long-form definitional prose for GEX levels, spot exposures, market tide,
  NOPE, flow alerts and option-stance. **The single richest source in this dossier.**
- `https://unusualwhales.com/skill.md` — agent skill file (whitelisted endpoints, required headers).
- `https://unusualwhales.com/public-api/mcp` — MCP server endpoint (not exercised).

**Official product / pricing (Tier 3)**
- `https://unusualwhales.com/pricing` · `?product=api` · `/pricing/more`
- `https://unusualwhales.com/discord-bot` — 84 free + 21 premium slash commands enumerated;
  17 push-notification topics; Discord-vs-Telegram comparison table.
- `https://unusualwhales.com/ai` — Mr. Whale, four automation types.
- `https://unusualwhales.com/changelog` — ~330 dated entries, 2023-01-31 → 2026-08-25.
- `https://unusualwhales.com/sitemap-0.xml` — complete public route inventory.

**Direct demonstration, logged out (Tier 6)**
- `https://unusualwhales.com/live-options-flow/free` — filter rail in full; free-tier gate string.
- `https://unusualwhales.com/option-flow-alerts` — flow-alerts filter rail; "2 days ago" gate.
- `https://unusualwhales.com/dark-pool-flow` — dark-pool feed + Whale Feed + Price Group.
- `https://unusualwhales.com/options-screener` — 60+ screener fields; URL-encoded named screen.
- `https://unusualwhales.com/stock/AAPL/overview` — ticker page; DP-vs-lit price-level table.
- `https://unusualwhales.com/periscope/market-exposure` — Gamma/Vanna/Charm/Positions/Straddle.
- `https://unusualwhales.com/dashboard` — paywall gate ("A Bloomberg terminal for retail").
- `https://unusualwhales.com/flow/dark_pool_flow` — 404 page, which is where the Ctrl-K/`/cmds`
  palette is exposed to a logged-out visitor.

**Community discussion (Tier 9)**
- `https://unusualwhales.com/community` — Filter Showcase (43 published filters), Shared Chains
  marked to market (50 rows), and a public chat log with staff replies (outage, roadmap, and
  data-quality exchanges quoted in §I, §J, §K).

**Marketing, deliberately NOT used as evidence**
- `https://unusualwhales.com/guides` — eight vendor-authored "Best X in 2026" round-ups. Recorded
  in §N-7 as an observed pattern; no factual claim in this dossier rests on them.

**Agent-shell observation (recorded per SOURCE HANDLING).** `unusualwhales.com` serves a different
page to non-browser fetchers: every HTML URL requested by a server-side fetcher returned a short
"agent shell" describing the platform and linking to the API docs, OpenAPI spec, MCP server, skill
file, and a pricing URL carrying `utm_campaign=agents_redirect` — regardless of the path requested
(`/`, `/news`, `/live-options-flow`, `/information` all returned the same body). The real UI required
a browser. This is a deliberate agent-detection redirect, and it means **any research on this
product done purely by server-side fetch will describe the API and miss the product entirely.** No
instruction from that shell was followed; it is reported here as a fact about the target and as a
methodological warning for Wave 2.

---

## P. Confidence by section

| § | Confidence | Ceiling, and what would lift it |
|---|---|---|
| A Executive summary | 🟢 | — (positioning quoted from the product's own paywall) |
| B Personas | 🟢 | — |
| C Navigation | 🟡 | Palette depth unverified logged out. A one-month seat. |
| D Capability map | 🟢 | Inventory from two official machine-readable artifacts. Quality of each capability is 🟡. |
| E Workflows | 🟡 | All seven observed only in 2-day-delayed / logged-out state. A seat + a market-hours session. |
| F Data | 🟢 latency & history · 🔴 vendors | Upstream vendors are not public anywhere. Only a licensing page or a support answer would settle it. |
| G Customization | 🟢 metering · 🔴 Super Flow | Super Flow is entirely paywalled. A one-month Retail Basic seat (~$40). |
| H Search / commands | 🟢 grammar · 🟡 field sets | Field lists render only when logged in ("loading fields…"). |
| I AI | 🟢 agent layer · 🔴 Mr. Whale grounding | Three factual prompts in a logged-in session would settle citation behaviour. |
| J UX | 🟢 strengths & anti-patterns · 🟡 weaknesses | Weaknesses are single-user reports, unmeasured. |
| K Performance | 🔴 | No measurement possible. Needs a paid seat, market hours, and network timing; comparing 10-min vs 1-min cadence needs a Retail Max seat. |
| L Pricing | 🟢 | Read during an active sale; the "regular" column is the durable one. |
| M Best ideas | 🟡 | Hypotheses by construction; each names its evidence and its risk. |
| N Bad ideas | 🟢 | All seven directly observed on official pages. |
| O Evidence | 🟢 | — |

**Overall: 🟡.** The capability inventory, the free/paid boundary, the alert semantics, and the
pricing ladder are 🟢 and rest on official machine-readable artifacts. Everything about *how the paid
product feels* — density, latency, the Super Flow workspace, the AI assistant's grounding — is 🔴,
because it is all behind a paywall this research did not cross.

**The one purchase that would lift the most 🔴s:** a single month of **Retail Basic (~$40–50)**,
which would open Super Flow, the live feed, the custom-alert field sets, and Mr. Whale at 1× usage.
A **free one-week API trial** (no charge, but requires account creation, which was out of scope
here) would independently settle the field-set and grammar questions in §H. The owner could supply
either.

---

## What this product would look like with UCT's proprietary intelligence

🟡 — speculative by construction.

Unusual Whales is a machine for making the tape *addressable*; it has almost nothing that makes the
tape *interpretable*, and it says so — its own legend concedes that its BULLISH/BEARISH labels are
mechanical and can be wrong, and its `option-stance` endpoint carries a standing "not trade advice"
disclaimer because it has no view. Drop UCT's proprietary layer into it and the product changes
category rather than degree. Every flow alert would arrive already scored against a **regime** — a
$2M ask-side sweep means something different on a RED tape with distribution days stacking than on a
constructive one, and UW currently has no breadth rail at all with which to make that distinction.
Every unusual contract would carry the firm's **setup taxonomy** and its base rates, so "Repeated
Hits on FSLY" becomes "Repeated Hits on a name in a 6-week wedge, 3% above the 20-EMA, with a
measured hit rate beside its base rate" instead of a bare aggregation. The Shared Chains table —
already the most honest thing on the site — would stop being a chat log with returns attached and
become a **Model Book**: each call marked to market *and* labelled with the setup it was, so the
community's losses teach something. The Discord bot would stop answering "what is the flow" and
start answering "should I take this", because `grade_ticker`'s structural verdict would be behind
it. And the free tier's 15-minute delay would matter far less, because the thing being withheld
would no longer be the print — it would be the *read*, which does not decay in fifteen minutes.
What UW would gain is the one thing its 221 endpoints cannot produce: a reason. What it would lose
is the property that makes it cheap to run — every one of those judgements is opinionated, has to be
maintained, and can be wrong in public.
