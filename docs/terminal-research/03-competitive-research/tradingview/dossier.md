---
id: B-TV-01
title: TradingView benchmark dossier
role: Benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: TradingView (Supercharts, screeners, alerts, Pine Script, community, desktop app)
confidence: 🟡
evidence_ceiling: "No authenticated session: every claim below is from public docs, public product pages, and two unauthenticated rendered surfaces (/screener/, /chart/). Nothing behind login was observed — no saved-layout UX, no alert-creation dialog, no watchlist internals, no AI Screener run, no latency measurement. Practitioner commentary was unreachable within the search budget (WebSearch exhausted; Reddit blocked to WebFetch; browser SERPs returned off-topic results), so Sections J and K are documentation-inferred, not user-reported."
sources: "48 primary (official docs, help center, product pages, official blog, two rendered product surfaces); 2 secondary (search-engine result pages used only for URL discovery, not as evidence)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-TV-01 — TradingView

**All URLs fetched 2026-09-02.** Evidence labels used throughout: **verified** (read on an official TradingView page/doc), **demonstrated** (observed in the running product without logging in), **claimed** (TradingView marketing), **reported** (third party), **speculated** (my inference, flagged).

**Naming note for this program:** UCT's existing `/calendar` surface is TERMINAL-CURRENT; the thing being designed is TERMINAL-NEXT. Nothing in this dossier is a requirement for either.

---

## A. Executive summary

**OBSERVATION.** TradingView is a browser-first (plus desktop and mobile) charting and market-analysis platform wrapped in a publishing community. Its charting product has an official product name — **Supercharts** — and the help center defines it as the centre of the platform: "Supercharts are the core of TradingView. They allow you to track price changes, compare assets, and access other TradingView products for a full financial analysis experience." Around that core sit screeners, heatmaps, watchlists, alerts, news, an economic calendar, symbol pages, portfolios, paper trading, live broker order routing, a scripting language (Pine Script v6) with a public script library, and a social layer (Ideas, Minds, chats). It sells to individuals on a five-tier consumer subscription ladder from $0 to $199.95/month, with exchange market-data entitlements sold separately as add-ons.

**EVIDENCE.**
- Supercharts definition — https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/ (Tier 1, official help center, 2026-09-02) — **verified**.
- Platform philosophy — https://www.tradingview.com/about/ (Tier 3, official product page, 2026-09-02): the site states it is "used by 100M+ traders and investors worldwide", describes itself as "a charting platform and social network", and puts its motto **"Look first / Then leap"** at the centre — **claimed** (the 100M figure is self-reported marketing).
- Pricing ladder — https://www.tradingview.com/pricing/ (Tier 3, 2026-09-02) — **verified**.

**INTERPRETATION.** The apparent PHILOSOPHY is *"the chart is the workstation, and everything else is an accessory to it."* Every other surface — screener, news, watchlist, alerts, order ticket, portfolio, community post — is either reachable from the chart, embedded in the chart's chrome, or shaped so its output lands back on a chart. A second, weaker philosophy sits under it: *"the user's own tools are first-class"* — Pine Script means a user-authored indicator is not a plugin, it is the same kind of object as a built-in, can be screened on (Pine Screener), alerted on, backtested, and published to 100k+ others.

**RELEVANCE TO UCT.** UCT already runs a Lightweight-Charts-based `/charts` workspace and has Pine parity work in flight, and links members out to TradingView today. The transferable observation is not "build charts" — it is the *centre-of-gravity* decision: TradingView never asks the user to leave the chart to do the next thing.

**CONFIDENCE.** 🟢 for what the product is and how it is sold. Ceiling: none for this section.

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT picks one surface as its centre of gravity and makes every other capability reachable without leaving it, navigation cost drops more than adding any single new capability would.* TradingView's centre is the chart; UCT's desk may want a different centre (a symbol dossier, or the day's tape) — the lesson is that there should be exactly one.

**OPEN QUESTION.** Is UCT's centre of gravity the chart, or the "what matters today" surface? TradingView answers this differently from every fundamentals-first benchmark in this program, and the answer determines the whole navigation model.

---

## B. User types / personas served

**OBSERVATION.** Four distinguishable populations, and the pricing ladder is explicitly built to sort them:

1. **The free chart user** (Basic, $0): 1 chart per tab, 2 indicators, 3 price alerts, 1 watchlist, 5K historical bars, delayed data. This tier exists to be the internet's default chart — it is the surface embedded in blog posts, Discords and broker sites.
2. **The active retail trader** (Essential/Plus, $12.95/$29.95): 2–4 charts per layout, 5–10 indicators, 20–100 price alerts + 20–100 technical alerts.
3. **The serious prosumer / small desk** (Premium, $59.95): 8 charts per layout, 25 indicators, 400 alerts, 2 watchlist alerts, 20K bars, second-based intervals and deep backtesting.
4. **The professional** (Ultimate, $199.95): 16 charts, 50 indicators, 1,000 alerts, 15 watchlist alerts, 40K bars, 200 parallel connections. The pricing page states plainly: "Only the Ultimate plan is available for professional users."

A fifth population is served by a different product entirely: the **script author**, who publishes to the community library (100,000+ public indicators claimed) and is now courted by a Creator Program (blog, Aug 12).

**EVIDENCE.** https://www.tradingview.com/pricing/ (Tier 3, 2026-09-02) — **verified**. https://www.tradingview.com/features/ (Tier 3, 2026-09-02) — counts are **claimed**. TradingView Creator Program — https://www.tradingview.com/blog/en/ (Tier 3, official blog index, 2026-09-02) — **verified** that the post exists.

**DISCREPANCY WORTH RECORDING.** Two official TradingView sources disagree about how many plans exist. The public pricing page lists **five** (Basic, Essential, Plus, Premium, Ultimate) and says only Ultimate serves professional users. But the Pine Script limitations doc lists an **"Expert"** tier with its own limits (25,000 historical chart bars, 125,000 intrabars — both strictly between Premium and Ultimate), and the Bar Replay help article refers to "Premium and professional plans (Expert and Ultimate)". So an Expert tier exists somewhere — legacy, regional, or professional-only and unlisted — and the consumer pricing page does not show it.

**EVIDENCE.** https://www.tradingview.com/pine-script-docs/writing/limitations/ (Tier 1, official docs, 2026-09-02) and https://www.tradingview.com/support/solutions/43000692816-how-much-data-is-available-for-bar-replay/ (Tier 1, 2026-09-02) — both **verified**; the contradiction with the pricing page is real, not an artefact of my reading.

**INTERPRETATION.** The ladder is not sold on *features* so much as on *quantities* — how many charts, how many indicators, how many alerts, how much history. That is a deliberate and unusually legible packaging choice: a user can predict which tier they need by counting their own workflow.

**RELEVANCE TO UCT.** UCT's own tiering is `FREE_PAGES` + a paid gate + admin. TradingView shows a third model — same features everywhere, metered quantities — which suits a desk-first product where the desk needs 16 charts and a member needs 2.

**CONFIDENCE.** 🟢 on the five public tiers and their limits; 🟡 on the Expert tier's existence and meaning. Ceiling: the Expert tier is not visible without whatever account state exposes it; a screenshot from a professional subscriber would resolve it.

**RECOMMENDATION (hypothesis).** *Metering quantities (charts, alerts, saved layouts, history depth) rather than gating features may let UCT ship one product to desk and members and still price them differently.*

**OPEN QUESTION.** What is the "Expert" plan, and why is it absent from the public pricing page while two official docs reference it?

---

## C. Navigation

**OBSERVATION.** TradingView's navigation has four independent doors and the product deliberately does not force a hierarchy between them:

1. **Type-to-search on the chart.** No focus click, no palette hotkey, no search box to find: with the chart focused, you simply start typing a ticker. The help center says so directly — "To change the symbol or ticker, type the name asset you're looking for directly into your keyboard. A search box will appear and you can select the symbol you want." This is the single highest-leverage navigation idiom on the platform.
2. **Chart chrome.** Top toolbar (symbol, interval, chart type, indicators, alerts, layouts), left toolbar (drawings), right toolbar/sidebar (watchlist with details and news, alerts panel, object tree and data window), bottom panel (Pine editor, strategy tester, trading panel). Those are the interface regions the official "Getting started with Supercharts" article enumerates.
3. **Keyboard shortcuts, documented as a first-class surface.** TradingView publishes a dedicated shortcuts page whose own copy says shortcuts exist to "Manage watchlists, set alerts, navigate Supercharts", organised into **seven** categories: Chart · Indicators and drawings · Watchlist · Screener · Pine Script® Editor · Trading · Alerts. Shortcuts are not chart-only; they cover the screener and the order ticket too.
4. **Modifier-key spatial actions.** "Press Alt + Ctrl on Windows or ⌥⌘ on Mac, and a button with a '+' icon will appear under the cursor" — from which the user creates an order, an alert, or a price line *at the price the cursor is on*. Navigation and action collapse into one gesture at a coordinate.

Site-level navigation is conventional (top nav → Products / Community / Markets / News / Brokers), and the help center is a 22-category knowledge base.

**EVIDENCE.**
- Type-to-search — https://www.tradingview.com/support/solutions/43000543012-how-do-you-change-the-symbol-or-ticker-on-a-chart/ (Tier 1, 2026-09-02) — **verified**.
- Interface regions — https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/ (Tier 1) — **verified**.
- Shortcut categories — https://www.tradingview.com/support/shortcuts/ (Tier 1, read in-browser 2026-09-02) — **verified** (category names); the individual key bindings sit behind accordions I did not open, see GAPS.
- Cursor `+` gesture — https://www.tradingview.com/support/solutions/43000699223-how-to-create-an-order-alert-and-price-line-anywhere-on-the-chart/ (Tier 1) — **verified**.

**INTERPRETATION.** There is no command palette in the Bloomberg or VS Code sense. Instead there are three cheaper primitives that cover most of what a palette would do: bare typing = symbol navigation; a modifier + cursor = act at a price; documented hotkeys per surface = act without the mouse. The absence of a palette is arguably the design: for a chart-centred product, *the chart itself is the address bar*.

**RELEVANCE TO UCT.** UCT's `/charts` ChartWidget already implements click-to-focus + type-to-search prefilled from the first character, plus rAF refocus after a ticker pick. That is the same idiom, independently arrived at. The parts UCT does not yet have are (a) the modifier+cursor "act at this price" gesture, and (b) a *published* shortcut inventory that spans non-chart surfaces.

**CONFIDENCE.** 🟢 on the four doors. 🟡 on the specific key bindings. Ceiling: the shortcut list is behind client-side accordions; opening them needs a click-capable browser pass or a logged-in screenshot.

**RECOMMENDATION (hypothesis).** *A modifier+cursor "act at this price" gesture (create alert / create order / drop a level) may be a higher-yield addition to TERMINAL-NEXT than a command palette, because it removes a dialog rather than adding a launcher.*

**OPEN QUESTION.** Does TradingView expose any text-command entry at all (e.g. typing an interval or a command rather than a ticker), or is bare typing exclusively symbol search?

---

## D. Capability map (Part XIII taxonomy)

The most reliable capability map is TradingView's own help-center taxonomy: **22 knowledge-base categories**, each with folder counts. That is a self-declared inventory, which makes it better evidence than any marketing page.

**EVIDENCE (all Tier 1, official help center, 2026-09-02, verified):** https://www.tradingview.com/support/knowledge-base/ and the category pages listed inline below.

| Part XIII bucket | What TradingView ships | Evidence |
|---|---|---|
| **Market overview** | `/markets/` hub: Indices, US stocks, World stocks, Crypto, Futures & commodities, Forex, Government bonds, Corporate bonds, ETFs, Economy. Heatmaps for stocks, ETFs and crypto (help category *Heatmap*: 3 folders — how to work with, how to share, update frequency). | /markets/ · /support/categories/heatmap/ — **verified** |
| **Security pages** | Symbol pages with tabs: Overview · Financials · Documents · News · Community (Minds) · Technicals · Forecast · Seasonals · Options · ETFs · Bonds. | /symbols/NASDAQ-NVDA/ — **verified** |
| **Fundamentals** | Help category *Financials* is the largest data taxonomy on the platform: Income Statements (55 articles) · Balance Sheet (69) · Cash Flow (46) · Statistics (124) · Overview (21) · Crypto (63) · Bonds (91) · ETF (39) · Futures (4) · IPO data (7) · Earnings, Splits & Dividends (6) · Key data points (11) · Common questions (7). | /support/categories/financials/ — **verified** |
| **News** | `/news/` with sections Top stories, Markets (by asset), Corporate activity (IPOs, earnings, dividends, M&A, management changes), Crypto, Economics; plus per-symbol feeds. Named providers include Reuters, MarketWatch, Dow Jones Newswires, Trading Economics, dpa-AFX, BusinessWire, Cointelegraph. Some provider content is paywalled ("Start a free trial to read this news"). Help category *News* → one folder, "News Flow" (11 articles). | /news/ · /support/categories/news/ — **verified** |
| **Earnings** | Earnings calendar at /markets/stocks-usa/earnings/ with columns for report timing, company, estimated EPS, actual EPS, surprise %, market cap; sortable; filterable by period, country, timezone. Earnings dates also appear as screener filters ("Recent earnings date", "Upcoming earnings date"). | /markets/stocks-usa/earnings/ · /screener/ — **verified / demonstrated** |
| **Economic** | Economic calendar claiming "more than 300,000 economic indicators from over 190 countries", filterable by importance, country, timezone and category, with actual / forecast / prior columns. Help category *Data* contains a "List of available economic data" folder with **318 articles**. | /economic-calendar/ (**claimed** counts) · /support/categories/data/ (**verified**) |
| **Screening** | Six screeners per the features page (Stocks, Bonds, ETFs, Crypto coins, CEX pairs, DEX pairs) and "400+ filter fields". Help category *Screener*: Features and tools (13), Calculations and formulas (21), FAQ (8), Pine Screener (1), plus one article per screener type. **Pine Screener** scans a watchlist *or* an index of "up to 3,500 symbols" using any Pine indicator with plots. **AI Screener** (public beta) turns a natural-language prompt into a finished screen. | /features/ (**claimed**) · /support/categories/screener/ (**verified**) · blog posts (**verified**, see §I) |
| **Charting** | Supercharts. Features page claims **21 chart types**, "400+ built-in indicators and strategies", "110+ smart drawing tools", "100,000+ public indicators". The help center's *Indicators* category documents **209 built-in indicators**, 20 chart-pattern articles, 8 volume-profile articles, 2 TPO articles. *Chart* category has 17 folders including Bar Replay (7), multi-chart mode (9), shortcuts and tips (24), chart types (30), candlestick patterns (45). Second-based and tick-based intervals and custom intervals are documented. | /features/ (**claimed**) · /support/categories/indicators/ · /support/categories/chart/ (**verified**) |
| **Alerts** | Help category *Alerts*: Alerts settings (34 articles), Alerts notifications (6), Webhooks usage (8), troubleshooting (12). Price alerts and technical (indicator) alerts are separate quotas on the pricing page; watchlist alerts are a third quota available only on Premium (2) and Ultimate (15). Alerts can now be attached to long/short position drawings so "A single alert watches your entry, stop loss, and take profit". Standard alert lifetime is two months; Premium and Ultimate get an open-ended option. | /support/categories/alerts/ · /pricing/ · blog 2026-08-28 · /support/solutions/43000520149-about-webhooks/ — **verified** |
| **Portfolio / watchlist** | Help category *Watchlist*: How to manage my lists (13), viewing problems (2), Change/Change% calculation (1), customising the Details section (1), text notes (2). Help category *Portfolio*: Portfolio management (8), Transaction management (5), Portfolio summary (4), Overview (5), Holdings (1), Transactions (1), Analysis (7), FAQ (15), tips (3). Portfolios recently gained the ability to "add positions, not transactions" and smarter stock-split handling. | /support/categories/watchlist/ · /support/categories/portfolio/ · blog 2026-08-19 and 2026-08-24 — **verified** |
| **Documents** | Symbol pages carry a **Documents** tab; the financials pages credit "SEC filings and other documents provided by **Quartr**". | /symbols/NASDAQ-NVDA/ · /support/categories/financials/ — **verified** |
| **Collaboration** | Help category *Social network*: House rules (11), ideas and scripts (23), TradingView chats (4), sharing charts/ideas (3), moderation (10), social features (12), Free user FAQs (12). Ideas carry a long/short bias tag, likes, comments, author profiles; there are Editors' Picks and a Boost mechanism. Layouts can be shared by link, with edit rights retained by the owner. | /support/categories/socialNetwork/ · /ideas/ · layouts guide — **verified** |
| **AI** | One shipped AI feature found: the **AI Screener** (public beta, Stock Screener only, all paid plans). See §I. | blog 2026-08-17 — **verified** |
| **Command / keyboard** | Seven documented shortcut surfaces (§C) plus the modifier+cursor `+` gesture. No command palette found. | /support/shortcuts/ — **verified** |
| **Workspaces** | Chart layouts (saved workspaces including settings, indicators and drawings), indicator templates, multi-chart layouts with per-axis sync, desktop multi-monitor windows. See §G. | layouts guide · templates article · multi-chart folder · /desktop/ — **verified** |
| **Trading (extra bucket)** | Help category *Trading*: trading essentials (18), basics (21), general questions (21), **Paper Trading** (14), **The Leap** (9), order tickets (10), Levels (2), order presets (6), mobile trading (3), plus **40+ broker-specific folders**. The brokers page lists 28+ integrated brokers (OANDA, Interactive Brokers, TradeStation, Webull, NinjaTrader, Tradovate, Alpaca, Coinbase Advanced, Kraken, OKX, moomoo, FOREX.com, AMP Futures…). | /support/categories/trading/ · /brokers/ — **verified** |
| **Scripting (extra bucket)** | Pine Script v6 — indicators, strategies and libraries, executed on TradingView's servers. Pine Seeds allows importing custom data via GitHub (folders: Data requirements 7, TradingView UI 5, GitHub 7). | /pine-script-docs/welcome/ · /support/categories/pineSeeds/ — **verified** |

**INTERPRETATION.** The capability map is far wider than "a charting site", but the depth is uneven and the unevenness is systematic: anything that renders *on or beside a chart* is deep (chart types, drawings, indicators, alerts, replay, multi-chart sync), and anything that is a *table of records* is broad but shallow (portfolios, documents, news archive). Fundamentals are an exception — the Financials help taxonomy (500+ articles across statements, statistics, bonds, ETFs, crypto) is genuinely deep, but it is delivered as data *fields available to charts and screeners*, not as a research workflow.

**RELEVANCE TO UCT.** UCT's Part XIII gaps versus this map are mostly deliberate (no bonds, no DEX). The two buckets where TradingView is materially ahead of TERMINAL-CURRENT are **alerts as a first-class quota'd product with three distinct alert kinds** and **user scripting as a first-class object** (screen on it, alert on it, backtest it, publish it).

**CONFIDENCE.** 🟢 on the taxonomy and folder counts (read directly off official pages). 🟡 on the marketing counts (400+ indicators, 110+ drawing tools, 3,539,722 instruments) — these are TradingView's own numbers and the help center's own count of built-in indicator articles is 209, which does not obviously reconcile with "400+".

**RECOMMENDATION (hypothesis).** *Publishing a self-describing capability taxonomy — a help-center-shaped inventory of what the product does, with per-area article counts — is itself a product feature: it lets a user (and a competitor, and an agent) verify coverage without a demo.* UCT's own CLAUDE.md repeatedly records the cost of hand-typed counts drifting from the artefact they describe; TradingView's taxonomy is generated from the article store, so it cannot drift.

**OPEN QUESTION.** Does "400+ built-in indicators and strategies" count strategies and variants that the 209-article help taxonomy does not, or is one of the two numbers stale?

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five in depth

**A. "Why is this stock moving?"** — Type the ticker on any chart (no click). The right sidebar shows watchlist → details → news for the symbol. Switch to the symbol page for News, Community (Minds) and Technicals tabs. What is missing: no synthesised *why*. TradingView presents headlines, a technical-ratings gauge and community posts and leaves the causal read entirely to the user. There is no equivalent of a catalyst thesis. **🟡 — documented surfaces verified; the actual sequence not walked while logged in.**

**B. "Prepare me for earnings."** — Earnings calendar (`/markets/stocks-usa/earnings/`) gives report timing, EPS estimate, EPS actual, surprise % and market cap, sortable and filterable by period/country. The symbol page adds Financials, Forecast (analyst targets/ratings), Documents (Quartr-sourced filings) and Options (chain with greeks and IV). Screener filters include "Upcoming earnings date". What is missing from public evidence: no transcript surface, no expected-move calculation, no post-call recap. **🟡.**

**C. "Research this company from scratch."** — Symbol page tab walk: Overview → Financials → Documents → News → Technicals → Forecast → Seasonals → Options → ETFs → Bonds. That is a genuinely complete *record*, and the Financials taxonomy behind it is deep. What is missing: no notes, no saved research object, no way to attach your own conclusion to the company other than a watchlist text note or a published Idea. **🟢 on the surfaces; 🟡 on the workflow.**

**D. "What matters today?"** — `/markets/` overview + heatmaps + news Top Stories + economic calendar + earnings calendar. Four separate destinations, no single composed answer. TradingView has no morning brief. **🟡.**

**E. "Find a trade."** — This is TradingView's strongest workflow and it has three distinct routes: (1) the **Stock Screener** with quick filters and 13 column presets (see §D and §G); (2) the **Pine Screener**, which runs any plotting Pine indicator across a watchlist or an index of up to 3,500 symbols — i.e. *your own setup logic becomes the scan*; (3) the **AI Screener**, natural language → finished screen. Results are one click from a chart, and from the chart the modifier+cursor gesture places the order or the alert. **🟢.**

**F. "Monitor my universe."** — Watchlists (with per-symbol text notes and a customisable Details section), watchlist alerts (Premium/Ultimate only, 2 and 15 respectively), price alerts and technical alerts with their own quotas, webhook delivery, and multi-chart layouts with symbol/interval/date-range sync. What is missing: watchlist *alerts* are the scarcest quota on the entire ladder (2 on a $59.95 plan), which is a strong signal that fan-out monitoring is expensive for them to serve. **🟢 on mechanics, 🟡 on how it feels at scale.**

**G. "Understand the regime."** — Weakest of the seven. Heatmaps, the `/markets/` hub, yield-curve comparison across "40+ major economies", the economic calendar, and community sentiment. There is no regime label, no breadth composite, no exposure recommendation. A user assembles the regime read themselves from indicators and heatmaps. **🟡 — I found no regime product; absence is inferred from a complete category listing, which is reasonable but not proof.**

**RELEVANCE TO UCT.** The shape is instructive: TradingView is excellent at **E** (find a trade) and **F** (monitor), adequate at **C** (research the record), and essentially absent at **D** (what matters today) and **G** (regime). UCT's morning wire, breadth rails, UCT exposure rating and catalyst engine occupy exactly the two workflows TradingView leaves empty. That is the clearest positioning fact in this dossier.

**CONFIDENCE.** 🟡 overall. Ceiling: none of these were walked end-to-end in a logged-in session; each is reconstructed from official documentation of the individual surfaces. A subscription (any paid tier, $12.95/mo) would raise all seven to 🟢, and the owner could supply one.

**OPEN QUESTION.** Does TradingView's Ideas/Minds layer function as a de-facto "what matters today" for its users — i.e. is the community the missing product?

---

## F. Data

**OBSERVATION.**
- **Coverage (claimed).** "3,539,722 instruments", "70+ stocks and 70+ crypto exchanges", "40+ centralized exchanges" for the CEX screener, macro data for "80+ countries" and "400+ economic metrics", yield curves for "40+ major economies".
- **Named vendors (verified).** The financials help pages credit: "Select market data provided by **ICE Data Services**", "Select reference data provided by **FactSet**", and "SEC filings and other documents provided by **Quartr**". The news product names Reuters, MarketWatch, Dow Jones Newswires, Trading Economics, dpa-AFX, BusinessWire and Cointelegraph. The data-coverage page references direct exchange relationships with CME Group, Cboe, ICE and EUREX among others.
- **Delayed vs real-time.** Real-time is an *entitlement bought per exchange*, separate from the plan. Observed US equity add-on prices: NASDAQ $3.00/mo non-pro vs $27.00/mo pro; NYSE $3.00 vs $48.00; NYSE Arca $3.00 vs $25.00; OTC Markets $3.00 vs $50.00 (OTC free tier shown as 15-min delayed); a **US Stock Markets bundle** (NYSE, NASDAQ, NYSE Arca, NASDAQ GIDS, OTC) at **$9.95/mo non-professional, not available to professionals**. Across all exchanges the page's range runs $0–$548/month.
- **History depth.** Chart bars are a plan quota: Basic 5K → Essential/Plus 10K → Premium 20K → (Expert 25K) → Ultimate 40K. Bar Replay intraday depth is separately tiered — Essential gets 6 months of 1-minute / 30 months of 5-minute; Plus gets 1 year of 1-minute / 5 years of 5-minute; "Premium and professional plans (Expert and Ultimate)… allow you to play absolutely all time-based data available in TradingView's data storage." Ultimate additionally gets **historical tick data up to 7 days back**. Seconds-based data begins **2022-08-17** platform-wide.
- **Asset classes.** Equities, ETFs, indices, futures, forex, bonds (government and corporate), crypto (spot, swap, derivatives, CEX and DEX), economic series, options.
- **Pine data limits.** 5,000-bar historical buffer for most series (10,000 for OHLCT and time); intrabar requests capped at 100,000 bars on Basic–Premium, 125,000 on Expert, 200,000 on Ultimate; 40 unique `request.*` calls (64 on Ultimate).

**EVIDENCE.** https://www.tradingview.com/features/ (**claimed**) · https://www.tradingview.com/data-coverage/ (**verified** prices, read 2026-09-02) · https://www.tradingview.com/support/categories/financials/ (**verified** vendor credits) · https://www.tradingview.com/news/ (**verified** provider names) · https://www.tradingview.com/pricing/ (**verified** bar quotas) · https://www.tradingview.com/support/solutions/43000692816-how-much-data-is-available-for-bar-replay/ (**verified**) · https://www.tradingview.com/pine-script-docs/writing/limitations/ (**verified**). All Tier 1–3, 2026-09-02.

**INTERPRETATION.** TradingView unbundles data from software completely. The software costs $12.95–$199.95; the data costs whatever the exchange charges, and the professional/non-professional distinction is enforced at the *data* layer, not the software layer. The $9.95 non-professional US bundle versus $150/mo if a professional bought the same four exchanges individually is the entire economics of the retail model.

**RELEVANCE TO UCT.** UCT's desk sits on Massive/Polygon-compatible data plus FMP, Finnhub, AlphaVantage and yfinance, and its members never see an entitlement decision. TradingView's model is a warning as much as a lesson: unbundled data is honest and scalable, but it puts a licensing question in front of the user before they can see a price tick.

**CONFIDENCE.** 🟢 on vendors, entitlement model and history quotas (all read on official pages). 🟡 on the marketing coverage counts.

**RECOMMENDATION (hypothesis).** *Publishing the data lineage per surface — which vendor supplies which field — is cheap and increases trust disproportionately.* TradingView credits ICE, FactSet and Quartr by name inside its help center; UCT's own history (the retired-provider incident, the "a provider key on Railway is not evidence we use it" lesson) suggests a visible per-field lineage would pay for itself internally before it ever pays for itself with members.

**OPEN QUESTION.** Which specific fields come from FactSet (reference data) versus ICE (market data)? The credit line does not say, and it matters for anyone reasoning about fundamentals quality.

---

## G. Customization

**OBSERVATION.**
- **Chart layouts** are the primary workspace object: a layout captures "its look, fill, design, and all of the chart settings, and even includes drawings". Managed from a "Manage layouts" control with Create new layout, Save (Ctrl+S / Cmd+S), **Autosave toggle**, Make a copy, Export chart data (CSV), Open layout, and — when sharing is enabled — Copy link, where the recipient can view but only the owner can edit. Saved-layout counts are a plan quota: 1 (Basic), 5 (Essential), 10 (Plus/Premium/Ultimate).
- **Indicator templates** group several indicators into one package applied in a click; six built-in templates ship (Bill Williams' 3 Lines, Displaced EMA, MA Exp Ribbon, Oscillators, Swing Trading, Volume Based) and users save their own from whatever is currently on the chart.
- **Multi-chart layouts** are documented as a nine-article topic covering: syncing charts in a layout, syncing *selected* charts (not just all), resizing panes, synchronising the date range, showing the same symbol at different timeframes, and applying the same settings to all charts. Charts per layout is the headline plan quota (1/2/4/8/16).
- **Tables/columns.** Demonstrated live on `/screener/`: a quick-filter row (Price · Chg % · Mkt cap · P/E · EPS dil growth · Div yield % · Sector · Analyst rating · Perf % · Revenue growth · PEG · ROE · Beta · Recent earnings date · Upcoming earnings date) above **13 named column presets**: Overview · Performance · Technicals · Extended hours · Forecasts · Valuation · Dividends · Profitability · Income statement · Balance sheet · Cash flow · Per share · More. Universe selector: All stocks / US / **Watchlist** / **Index**.
- **Watchlists.** Multiple lists on every paid tier (1 on Basic); documented features include per-symbol **text notes**, a customisable **Details section**, and a documented Change/Change% calculation.
- **Multi-monitor.** The desktop app claims "Native multi-monitor support… without any of the limitations browsers traditionally face", "Symbol syncing between tabs", and "Synchronized workspace crosshairs" that "move in tandem across all your displays", on Windows, macOS and Linux, with layouts, watchlists and settings syncing across web, mobile and desktop.
- **Preferences** are account-level and sync across devices; the *Profile settings* help category exists separately.

**EVIDENCE.** https://www.tradingview.com/support/solutions/43000746975-tradingview-layouts-a-quick-guide/ · https://www.tradingview.com/support/solutions/43000543048-what-are-indicator-templates/ · https://www.tradingview.com/support/folders/43000578567-how-to-work-in-the-multi-chart-mode/ · https://www.tradingview.com/screener/ (**demonstrated**, rendered 2026-09-02) · https://www.tradingview.com/support/categories/watchlist/ · https://www.tradingview.com/desktop/ (**claimed**) · https://www.tradingview.com/pricing/. All 2026-09-02.

**INTERPRETATION.** Three customisation objects, cleanly separated by lifetime: the **layout** (a saved workspace), the **indicator template** (a saved analysis stack, portable across layouts), and the **column preset** (a saved way of reading a table). Most platforms conflate at least two of these. The separation is what lets a user carry one analysis stack across many workspaces.

**RELEVANCE TO UCT.** UCT's `/charts` already persists `charts_workspace_layout` (arrangement) separately from `chart_settings` (seed) and named grid templates that *do* store tickers/tfs/chartTypes. TradingView adds a fourth object UCT does not have — the **indicator template** as a portable analysis stack — and a behaviour UCT does not have: **Autosave as a user-visible toggle** rather than an always-on debounce.

**CONFIDENCE.** 🟢 on layouts, templates, screener columns and plan quotas. 🟡 on watchlist internals (import/export, sharing, colour flags were not confirmed either way — the help category exists but the article bodies were not read). Ceiling: a logged-in session or one screenshot of the watchlist menu would settle it.

**RECOMMENDATION (hypothesis).** *Separating "the arrangement", "the analysis stack" and "the way I read a table" into three independently saved, independently shared objects may reduce TERMINAL-NEXT's template proliferation more than adding more templates would.* Corollary hypothesis: *making autosave a visible toggle rather than an invisible debounce gives the user a mental model of when their work is safe.*

**OPEN QUESTION.** Can TradingView watchlists be imported/exported, coloured/flagged, and shared to other users — and is a watchlist a first-class shareable object like a layout is?

---

## H. Search / commands

**OBSERVATION.** Symbol resolution is `EXCHANGE:TICKER` (e.g. `NASDAQ:NVDA`, observed in the chart URL `/chart/?symbol=NASDAQ%3ANVDA`), and the URL is addressable — a chart for any symbol is a GET away, which is what makes TradingView the internet's default embeddable chart. The search itself is opened by *typing*, not by clicking (§C). Dual-class symbology renders as `BRK.A` in the screener. Beyond symbol search:
- **Screener as search**: 400+ filter fields (claimed), with universe scoping to a watchlist or an index.
- **Pine Screener as search**: point any plotting indicator at up to 3,500 symbols.
- **AI Screener as search**: natural language, any language ("best results are achieved in English"), typo-tolerant — the blog gives the example of reading "golden gross" as *golden cross*.
- **Help-center search** exists but the knowledge base is primarily navigated by its 22 categories.

No command palette, no ticker-plus-function grammar (nothing resembling Bloomberg's `AAPL US Equity DES <GO>`).

**EVIDENCE.** /chart/?symbol=NASDAQ:NVDA (**demonstrated**) · /screener/ (**demonstrated**) · https://www.tradingview.com/blog/en/ai-screener-60101/ (**verified**) · https://www.tradingview.com/blog/en/pine-screener-update-60542/ (**verified**) · https://www.tradingview.com/support/solutions/43000543012-how-do-you-change-the-symbol-or-ticker-on-a-chart/ (**verified**). All 2026-09-02.

**INTERPRETATION.** TradingView has replaced the command grammar with three search *modes* aimed at different intents: I know the name (type it), I know the criteria (screener), I know the idea but not the criteria (AI Screener). That is a defensible alternative to a palette for a retail audience — a grammar has to be learned, and TradingView's audience churns.

**RELEVANCE TO UCT.** UCT's `SymbolSearch` with predictive `/api/ticker-search`, POPULAR fallback and "Go to {TICKER}" row already covers mode one well. Mode three (English → a scan) maps directly onto UCT's existing Concierge box (`ConciergeBox.jsx` → a definition tree scan) — TradingView's version is the same idea shipped to 100M users, and its *Explanation* panel (below) is the part UCT should study.

**CONFIDENCE.** 🟢 on symbol addressing and the three search modes; 🟡 on the absence of a palette (absence inferred from a complete shortcut-category list plus the help taxonomy, not from a definitive statement).

**RECOMMENDATION (hypothesis).** *Three explicit search modes — name, criteria, intent — may serve TERMINAL-NEXT better than one omnibox, because they let each mode's result set be shaped correctly (a symbol, a table, a saved scan) instead of guessing.*

**OPEN QUESTION.** Is there any documented text-command syntax (interval codes, comparison syntax like `AAPL/QQQ`) typed into the same box as symbol search?

---

## I. AI

**OBSERVATION.** Exactly one shipped, user-facing AI feature was found: the **AI Screener**, announced 2026-08-17.

- **What it does:** the user types a screening idea in natural language and receives a *finished* screen — filters, result columns and sorting all set, with the layout switched to table view if needed. The blog's framing: "Your idea arrives as a finished screen, not a to-do list."
- **Grounding / transparency:** it ships with an **Explanation** function that shows every applied filter with reasoning, plus "a breakdown of how the results are sorted and which columns were added." This is the most important detail in the feature: the AI's output is *inspectable as configuration*, not as prose. The user does not have to trust the answer; they can read the screen it built.
- **Destructiveness:** "Running an AI request replaces any manually set filters (the selected market remains unchanged unless specified in your prompt)."
- **Availability and metering:** "The AI Screener is available across all paid plans." A monthly request balance is displayed above the input and "resets on the first of every month"; pre-made templates do not consume the balance.
- **Scope and status:** public beta, **Stock Screener only**, "additional asset classes to follow", no mobile support yet.
- **Disclaimer:** results "serve as a starting point for your own research, not financial advice or recommendations."

Adjacent-but-not-AI: **Technical Ratings** on symbol pages is a deterministic indicator aggregate, not a model. Community "Minds" and Ideas are human-authored. I found no chat assistant, no document Q&A, no news summarisation, and no citation-bearing generative answer anywhere on the platform.

**EVIDENCE.** https://www.tradingview.com/blog/en/ai-screener-60101/ (Tier 3, official blog, 2026-08-17, read 2026-09-02) — **verified** as TradingView's own description; the *behaviour* is **claimed** until run. https://www.tradingview.com/blog/en/ (Tier 3, 2026-09-02) — recent-shipping list, **verified**.

**INTERPRETATION.** TradingView's AI bet is deliberately narrow and, on the evidence, unusually well-designed for trust: it does not generate an *answer*, it generates a *configuration*, and it shows you the configuration. A generated screen is falsifiable — the user can read the filters and disagree with one. A generated paragraph is not. That is a materially different risk posture from every AI-native research product in this benchmark set, and it is achieved without any citation machinery at all, because the artefact *is* the citation.

The one flaw visible from the documentation: "Running an AI request replaces any manually set filters" is a destructive default on a surface where users invest effort. There is no documented merge or undo.

**RELEVANCE TO UCT.** UCT's Concierge (English → a scan definition), the Compass grade/verdict stack, and the wire's grounding gate all live in this territory. The transferable idea is the **Explanation panel**: UCT's own hardest-won lessons (the COT narrative grounding gate that refuses to store prose containing a number absent from the facts; `CoverageLine`'s four counts; "a warm pass that persists nothing reads as healthy") point the same direction — *make the machine's work inspectable as structure, not as prose.* TradingView reached the same conclusion from the opposite end.

**CONFIDENCE.** 🟡. Ceiling: I did not run the AI Screener (that requires a paid account). Everything above is TradingView's own description of its behaviour. A single logged-in run with a deliberately ambiguous prompt — and a look at what the Explanation panel says when the model guesses wrong — would move this to 🟢 and is the single highest-value follow-up in this dossier. The owner could supply it with a $12.95 Essential subscription.

**RECOMMENDATION (hypothesis).** *An AI feature that emits an editable configuration (a scan definition, a filter set, a watchlist) and shows its reasoning as the diff to that configuration will be trusted faster than one that emits prose, even a well-cited one — because the user can disagree with one filter instead of accepting or rejecting a whole answer.* Anti-pattern hypothesis: *replacing the user's hand-set filters without a merge or undo is the wrong default; TERMINAL-NEXT should stage an AI-built configuration beside the current one, not over it.*

**OPEN QUESTION.** What does the Explanation panel show when the model misreads the prompt — a confident wrong rationale, or an admission of ambiguity? And what is the monthly request quota per tier (the blog says a balance exists but never states the number)?

---

## J. UX

**OBSERVATION — strengths.**
- **Zero-friction symbol change.** Typing with the chart focused is the fastest ticker switch in this benchmark set; it costs no click and no learned chord.
- **Act at a coordinate.** Alt+Ctrl / ⌥⌘ surfaces a `+` under the cursor that creates an order, alert or price line at that price — the dialog is replaced by a gesture.
- **Density is user-chosen, not imposed.** The plan ladder *is* the density control: 1 chart and 2 indicators, or 16 charts and 50 indicators, same product.
- **One consistent chart everywhere.** The same Supercharts engine backs the standalone chart, symbol pages, screener drill-downs and embeds — so the muscle memory transfers.
- **Shortcuts documented across seven surfaces**, including screener and alerts, not just the chart.

**OBSERVATION — weaknesses and anti-patterns.** The strongest available evidence for TradingView's UX problems is its own help center, whose folder titles are user complaints:
- The Chart category's largest folder is **"I can't find a certain feature or setting" — 43 articles.** A 43-article folder devoted to *locating* features is a discoverability finding, not a support statistic.
- Also in that category: "Chart and/or indicators are being displayed incorrectly" (16), "Charts are not saving/not syncing" (10), "Cursor is being moved or displayed incorrectly" (4), "Why I'm getting a message/warning/notice on my chart page?" (5), "Why my color theme isn't getting saved?" (1).
- Data category: "I see an incorrect price and/or a gap in data" (10 articles), "I'm unable to find a specific ticker symbol and/or market" (14).
- Alerts category: "Alerts are being triggered incorrectly / not being triggered" (12 articles).
- The AI Screener's documented destructive default ("Running an AI request replaces any manually set filters").
- The professional/non-professional data split means a user can be on a $199.95 plan and still not see a real-time print until a separate entitlement is bought — a two-axis pricing model that is honest but confusing.

**Onboarding.** The help center leads with a "Getting started" hub and a six-article Supercharts learning folder plus 45 candlestick-pattern articles and 30 chart-type articles — i.e. onboarding is *educational content*, not a product tour. The free tier is the real onboarding: it is fully functional for one chart.

**EVIDENCE.** https://www.tradingview.com/support/categories/chart/ · /data/ · /alerts/ (Tier 1, folder titles and counts read 2026-09-02) — **verified**. https://www.tradingview.com/blog/en/ai-screener-60101/ — **verified**. https://www.tradingview.com/support/getting-started/ — **verified**.

**INTERPRETATION.** TradingView's UX bargain is: *maximum capability, minimum imposed structure, and you will occasionally not be able to find something.* For a platform serving both a first-week retail user and a 16-chart professional, that is a coherent trade — but the 43-article "I can't find a feature" folder is the price, and it is paid every day.

**RELEVANCE TO UCT.** UCT's own repository history is full of the same failure class in a different register — features built, tested, green and unreachable; a nav entry documented for a page no route reaches. TradingView's help center is what that failure looks like when the features *are* reachable but not *findable*. Both are discoverability debt; only one is visible in a test suite.

**CONFIDENCE.** 🔴 for lived UX. **Ceiling, named explicitly:** I have no practitioner accounts and no logged-in session. WebSearch was exhausted before this role started; Reddit's JSON API is blocked to WebFetch and, when read through the browser, returned results unrelated to TradingView; the one professional review site I tried (stockbrokers.com) 404'd. Everything in this section is inferred from the *shape* of official support documentation, which is real evidence about where users get stuck but is not the same as hearing a user. What would raise it: three to five practitioner accounts from r/TradingView, r/Daytrading or a professional review (Investopedia, StockBrokers.com), or the owner's own account of using it — the owner is an active user and could supply this in five minutes.

**RECOMMENDATION (hypothesis).** *Counting a product's own "I can't find X" support surface is a cheap, honest discoverability metric — if TERMINAL-NEXT ever accumulates a support corpus, the folder that grows fastest names the navigation defect.* Anti-pattern hypothesis: *capability without a findability budget converts into support volume, not user value.*

**OPEN QUESTION.** What do actual daily users say the top three frustrations are — and does "can't find the setting" appear among them, or is the help-center shape an artefact of TradingView's support taxonomy rather than user pain?

---

## K. Performance

**OBSERVATION.** **NOT DETERMINED.** No measured evidence.

What can honestly be said:
- The chart at `/chart/?symbol=NASDAQ:NVDA` rendered and served an OHLC legend without authentication when loaded 2026-09-02 — **demonstrated**, but no timing was captured.
- `/screener/` rendered a full sortable table of ~100 US equities with 13 populated columns on an unauthenticated load — **demonstrated**.
- TradingView's own performance language is marketing: the desktop app promises "extra power, extra speed and extra flexibility" over the browser, with **no benchmarks given**. Label: **claimed**.
- Two structural facts bound the problem rather than measure it: charts per layout scale to **16** and indicators per chart to **50** on Ultimate (so 800 indicator instances in one workspace is a supported configuration), and **parallel connections** scale 2 → 200 across the ladder, which is TradingView explicitly metering concurrency as a cost.
- Pine execution is server-side and time-boxed: **20 seconds** script execution on basic accounts, **40 seconds** otherwise, **500 ms** per bar for loops, two-minute compile ceiling. Those are the only hard performance numbers TradingView publishes anywhere I found.

**EVIDENCE.** https://www.tradingview.com/desktop/ (**claimed**) · https://www.tradingview.com/pricing/ (**verified**) · https://www.tradingview.com/pine-script-docs/writing/limitations/ (**verified**) · rendered pages (**demonstrated**). All 2026-09-02.

**INTERPRETATION (speculated, flagged).** The 200-parallel-connections ceiling on Ultimate and the 2-connection floor on Basic suggest streaming fan-out — not rendering — is TradingView's scaling constraint, the same constraint UCT met in its own SSE-pooling work. That is a guess from a pricing table, not a measurement.

**RELEVANCE TO UCT.** The one directly transferable number is the **server-side script timeout**: TradingView bounds user-authored computation at 20–40 s and publishes the bound. UCT's Pine parity work has no published equivalent.

**CONFIDENCE.** 🔴. **Ceiling:** performance cannot be assessed without instrumented sessions (DevTools timings on a 16-chart Ultimate layout, or a cold-load waterfall). What would raise it: a logged-in Premium/Ultimate session with browser performance capture, or credible practitioner reports of lag at high chart counts. The owner, as a TradingView user, could capture a cold-load waterfall on their own account in minutes — that is the cheapest path to 🟡.

**RECOMMENDATION (hypothesis).** *Publishing a hard, honest ceiling for user-authored computation (as TradingView does for Pine: 20 s / 40 s / 500 ms per bar) converts an unbounded support problem into a documented contract.*

**OPEN QUESTION.** At what chart count does a TradingView layout become perceptibly slow on ordinary hardware, and does the desktop app actually change that number?

---

## L. Pricing / business model

**OBSERVATION.** Two independent axes: software subscription, and market-data entitlements.

**Software (per seat, per month, USD, read 2026-09-02):**

| Plan | Price | Charts/tab | Saved layouts | Indicators/chart | Price alerts | Technical alerts | Watchlist alerts | Historical bars | Parallel connections | Trial |
|---|---|---|---|---|---|---|---|---|---|---|
| Basic | $0 | 1 | 1 | 2 | 3 | — | — | 5K | 2 | n/a, no card |
| Essential | $12.95 | 2 | 5 | 5 | 20 | 20 | 0 | 10K | 10 | 30 days |
| Plus | $29.95 | 4 | 10 | 10 | 100 | 100 | 0 | 10K | 20 | 30 days |
| Premium | $59.95 | 8 | 10 | 25 | 400 | 400 | 2 | 20K | 50 | 30 days |
| Ultimate | $199.95 | 16 | 10 | 50 | 1,000 | 1,000 | 15 | 40K | 200 | 14 days |

Annual billing is the same headline rate billed yearly, saving $24 / $60 / $120 / $480 respectively (a ~17% discount is highlighted). "Refunds are available for annual plans only" within 14 days; no refunds on monthly plans or on market-data subscriptions. All tiers, including Basic, are ad-free and include web, desktop and mobile.

**Data add-ons (per exchange, per month):** NASDAQ $3.00 non-pro / $27.00 pro; NYSE $3.00 / $48.00; NYSE Arca $3.00 / $25.00; OTC Markets $3.00 / $50.00; **US Stock Markets bundle $9.95 non-professional, unavailable to professionals**. The full range across all exchanges runs $0–$548/month.

**Professional / non-professional:** enforced twice. On the software side, "Only the Ultimate plan is available for professional users." On the data side, professional rates are 8–17× non-professional rates for US equities and the cheap bundle is withdrawn entirely.

**Per-seat, not per-firm.** Nothing on the pricing page describes team, enterprise or firm licensing; the model is individual subscriptions with a professional surcharge. (A separate charting-library/widget business exists but was outside this dossier's scope.)

**EVIDENCE.** https://www.tradingview.com/pricing/ and https://www.tradingview.com/data-coverage/ (Tier 3, official, 2026-09-02) — **verified**.

**INTERPRETATION.** The ladder is a *quantity* ladder, and the jump that matters is Premium ($59.95) → Ultimate ($199.95): a 3.3× price for 2× charts and 2× indicators, but also the only door open to professionals. Ultimate is priced as a professional licence wearing a consumer plan's clothes.

**RELEVANCE TO UCT.** UCT's members are non-professionals; its desk is not. TradingView demonstrates that the professional/non-professional line can be enforced entirely at the entitlement layer without a separate product — which is the cheap version of "one product, two audiences" that TERMINAL-NEXT is being designed for.

**CONFIDENCE.** 🟢. Ceiling: none for the public consumer ladder. 🟡 on whether a firm/enterprise offering exists that is simply not on this page.

**RECOMMENDATION (hypothesis).** *A quantity-metered ladder (charts, alerts, layouts, history) may let UCT serve desk and members from one build; the alternative — feature gating — has already cost UCT real defects (`FREE_PAGES` divergence across AuthGuard, NavBar and MobileNav).*

**OPEN QUESTION.** Does TradingView sell a firm/team licence at all, and how does it treat a small proprietary desk (professional by exchange definition) that wants 5 seats?

---

## M. Best ideas for UCT

Each stated as a hypothesis, with the UCT workflow it serves. **None of these is a requirement.**

1. **Type-to-navigate as the universal idiom.** *If any focused surface in TERMINAL-NEXT accepts bare typing as "go to this symbol", the cost of moving between names collapses to near zero.* Serves Workflow F (monitor my universe) and A (why is this moving). UCT's ChartWidget already does this on `/charts`; the hypothesis is that it should be true on the calendar, the screener and the flow surfaces too. Evidence: §C. 🟢

2. **Modifier+cursor "act at this price".** *A single chord that turns the cursor's price into an alert, an order or a level removes a dialog from the most common repeated action on a chart.* Serves E and F. Evidence: §C, official help article. 🟢

3. **AI that emits an inspectable configuration, plus an Explanation panel.** *A generated scan definition with a visible filter-by-filter rationale is falsifiable in a way a generated paragraph is not, and will be trusted faster.* Serves E (find a trade) and connects directly to UCT's existing Concierge → definition-tree path. Evidence: §I. 🟡 (behaviour not observed).

4. **Three separately saved customisation objects.** *Arrangement (layout) · analysis stack (indicator template) · table reading (column preset) should be independent, independently shareable objects.* Serves every workflow; specifically addresses UCT's template proliferation between `charts_workspace_layout`, `chart_settings`, `multichart_state` and named grid templates. Evidence: §G. 🟢

5. **Autosave as a visible toggle.** *Showing the user whether their workspace is being saved — and letting them turn it off — gives them a mental model UCT's invisible 500 ms debounce does not.* Serves workspace trust. Evidence: layouts help article. 🟢

6. **User scripts as first-class objects across surfaces.** *If a user-authored (or firm-authored) signal can be charted, screened on, alerted on and backtested without being re-implemented per surface, the firm's setup library stops being four copies of one grammar.* This is the Pine Screener idea — point any plotting indicator at up to 3,500 symbols. It maps onto UCT's `starterScans.json` / definition-tree / `engine.candidate_rows()` single-reader work, and onto the existing lesson that one grammar with four hand-written copies is a defect. Serves E and F. Evidence: §D, §E. 🟢

7. **Quantity metering instead of feature gating.** *Same build for desk and members, differing by counts.* Serves the whole program's "desk first, members second" constraint. Evidence: §L. 🟢

8. **Named per-field data lineage.** *Crediting the vendor behind each data family (as TradingView credits ICE, FactSet and Quartr) is cheap and buys disproportionate trust — internally most of all.* Serves C and F, and directly addresses UCT's own retired-provider incident class. Evidence: §F. 🟢

9. **A generated, self-describing capability taxonomy.** *A per-area inventory produced from the artefact store cannot drift the way a hand-typed list does.* This is the same defect class UCT's CLAUDE.md documents repeatedly (the writer-index "FOUR", the COT router's "4 routes", the widget-type count). TradingView's 22-category / N-articles-per-folder help center is that inventory. Serves onboarding and internal navigation. Evidence: §D. 🟢

10. **Bar Replay depth as a tiered, published number.** *Publishing exactly how far back replay works per plan and per interval (Essential: 6 months of 1-minute; Plus: 1 year; Premium and above: everything) turns an unbounded expectation into a contract.* Serves E (practice and study). Evidence: §F. 🟢

---

## N. Bad ideas for UCT

1. **Do not replace a user's hand-built configuration with an AI result.** TradingView's AI Screener documents exactly this: "Running an AI request replaces any manually set filters." A user who spent ten minutes on a screen and loses it to one prompt learns not to use the prompt. Stage beside, don't overwrite.
2. **Do not let capability outrun findability.** A 43-article help folder titled "I can't find a certain feature or setting" is the observable end state. If TERMINAL-NEXT adds surfaces faster than it adds ways to reach them, it buys the same debt — and UCT's history shows the failure is *worse* for a small team, because there is no support corpus to reveal it.
3. **Do not make the user resolve entitlements before they see a price.** The professional/non-professional split, four separately-priced US exchanges, and a bundle that professionals cannot buy is honest but is a licensing quiz in front of a chart. UCT's members should never meet this.
4. **Do not put social/community output where a decision is made.** Ideas and Minds are on the symbol page beside Financials and Technicals. For a members' product with a paid signal, mixing user opinion into the same surface as the firm's read invites the two to be confused. (UCT's own parked-features decision — no test posts in the member server before ~750 members — is the same instinct.)
5. **Do not treat "more indicators" as a capability axis.** 400+ built-ins, 100,000+ public scripts, and 50 per chart on the top tier is a market position, not a workflow. UCT's own hard-won lesson — a hit rate is meaningless without its base rate — is the counterweight: for the desk, the number of *validated* signals matters and the number of *available* ones does not.
6. **Do not ship a scarcity that reads as a defect.** Watchlist alerts are 0 on Essential and Plus, 2 on Premium, 15 on Ultimate. A user on a $29.95 plan who reads "watchlist alerts: 0" cannot tell a business decision from a broken feature. If TERMINAL-NEXT meters something to zero at a tier, it should say why in the same place.
7. **Do not rely on marketing counts internally.** TradingView's own two numbers for built-in indicators ("400+" on the features page, 209 help articles in the Indicators category) do not obviously reconcile. Any count UCT publishes should be derived from the artefact, not typed beside it.

---

## O. Screenshots / evidence links

No images reproduced. Links to official evidence surfaces:

- Supercharts, live and unauthenticated: `https://www.tradingview.com/chart/?symbol=NASDAQ%3ANVDA` (observed rendering NVDA with an OHLC legend, 2026-09-02)
- Stock Screener, live and unauthenticated: `https://www.tradingview.com/screener/` (observed with quick-filter row and 13 column presets, 2026-09-02)
- Official product pages: `/pricing/` · `/features/` · `/about/` · `/desktop/` · `/data-coverage/` · `/markets/` · `/news/` · `/economic-calendar/` · `/brokers/` · `/ideas/` · `/scripts/` · `/portfolios/`
- Symbol page: `https://www.tradingview.com/symbols/NASDAQ-NVDA/` and its `/options/` sub-tab
- Help center root taxonomy: `https://www.tradingview.com/support/knowledge-base/` (22 categories)
- Shortcuts page: `https://www.tradingview.com/support/shortcuts/` (7 categories, bindings behind accordions)
- Pine Script docs: `https://www.tradingview.com/pine-script-docs/welcome/`, `/writing/limitations/`, `/concepts/alerts/`, `/concepts/strategies/`
- Official blog (release notes): `https://www.tradingview.com/blog/en/` and the four dated posts in §SOURCES

No official video transcripts were used; no demo recordings were consulted. Nothing was inferred from a video.

---

## P. Confidence per section

| § | Confidence | Ceiling and what would raise it |
|---|---|---|
| A Executive summary | 🟢 | none |
| B Personas | 🟢 (five public tiers) / 🟡 (Expert tier) | Expert tier is unlisted publicly; a professional subscriber's plan page or a screenshot would resolve it |
| C Navigation | 🟢 (four doors) / 🟡 (bindings) | Shortcut bindings sit behind client-side accordions; a click-capable browser pass or a logged-in screenshot |
| D Capability map | 🟢 (help taxonomy) / 🟡 (marketing counts) | Marketing counts unverifiable without an inventory; help-center counts are already authoritative |
| E Workflows | 🟡 | None of the seven was walked end-to-end while logged in; any paid tier ($12.95 Essential) would raise all seven to 🟢. **Wave 2 should not reconstruct these from this dossier alone.** |
| F Data | 🟢 (vendors, entitlements, history) / 🟡 (coverage counts) | Field-level lineage (which fields are FactSet vs ICE) is not published |
| G Customization | 🟢 (layouts, templates, columns) / 🟡 (watchlists) | Watchlist import/export, colour flags and sharing unconfirmed; one logged-in screenshot of the watchlist menu settles it |
| H Search / commands | 🟢 / 🟡 (palette absence) | Absence of a command grammar is inferred from complete category lists, not stated |
| I AI | 🟡 | AI Screener not run. **Highest-value single follow-up in this dossier**: one logged-in run with a deliberately ambiguous prompt, watching the Explanation panel |
| J UX | 🔴 | No practitioner voices and no logged-in session. WebSearch exhausted before this role; Reddit blocked to WebFetch and off-topic via browser; stockbrokers.com 404. 3–5 practitioner accounts or the owner's own usage account would raise it to 🟡/🟢 |
| K Performance | 🔴 | No measurements exist here at all. A cold-load waterfall and a 16-chart layout timing on a real account — the owner could capture this in minutes |
| L Pricing | 🟢 / 🟡 (firm licensing) | Consumer ladder fully verified; team/enterprise terms not published on this page |
| M Best ideas | 🟢/🟡 per item, marked inline | — |
| N Bad ideas | 🟢 | Each grounded in a verified observation |
| O Evidence | 🟢 | — |

**Overall: 🟡.** The product's *shape* is well evidenced from primary sources; the product's *feel* is not evidenced at all.

---

## What TradingView would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

TradingView's two empty workflows are exactly UCT's two proprietary ones. Bolt UCT's morning wire, breadth rails, UCT Exposure Rating, Model Book and catalyst engine onto Supercharts and the platform stops being a place where you *look* at the market and becomes a place that tells you what the market is doing before you ask. Concretely: the `/markets/` hub would open on a regime label and an exposure number rather than a grid of quotes, so Workflow G would have an answer instead of a heatmap; the symbol page would gain a *why is this moving* panel — a catalyst thesis with named sources and a timestamp — sitting where Technical Ratings currently offers a gauge with no causation; the screener's saved screens would carry the firm's base rates beside each row (this setup, this regime, n trades, expectancy in R), converting "400+ filter fields" from a menu into a ranked prior; the AI Screener's Explanation panel would cite the firm's own KB passage behind each filter rather than the model's rationale; and Bar Replay would replay *the Model Book's* labelled setups rather than raw bars, turning practice into a graded exam. The honest counter-observation is that this is a mismatch of populations as much as a merger of products: TradingView's philosophy is *"look first, then leap"* — the platform deliberately refuses to tell 100 million users what to do, and UCT's intelligence exists precisely to tell a small desk what to do. Grafting a verdict engine onto a look-first platform would either be ignored at scale or would make TradingView liable for opinions it has spent a decade avoiding. The transferable version is narrower and more useful: **UCT should build TradingView's chart-centred navigation around UCT's regime-and-catalyst intelligence, not the reverse.**

---

## GAPS

**Search channel used.** Per the preamble's search budget: (1) **WebFetch on known URLs** did nearly all the work — 40+ official TradingView pages, docs, help-center categories, folders, articles and blog posts. (2) **Browser, one tab, closed afterwards** (tab 603413695, created and closed within this role) — used for four things WebFetch could not read: the Google SERP that confirmed "Supercharts" is the official product name and revealed the help-center URL shape; the Bing SERP that revealed `https://www.tradingview.com/support/shortcuts/`; the rendered `/screener/` and `/chart/` surfaces; and one Reddit JSON attempt. (3) **WebFetch on Bing/DuckDuckGo/Mojeek** was tried and largely failed — Bing returned unrelated results for `site:` queries, DuckDuckGo served a CAPTCHA (not solved, not attempted), Mojeek returned 403.

**Budget not reached — specific gaps:**

1. **No authenticated session anywhere.** This is the dominant ceiling. Everything about how the product *feels* — saved-layout management, the alert-creation dialog, watchlist internals, the AI Screener actually running, the Explanation panel's real output, multi-chart at 8 or 16 panes — is undemonstrated. A $12.95 Essential subscription (or the owner's existing account) closes most of it.
2. **Individual keyboard bindings not extracted.** `https://www.tradingview.com/support/shortcuts/` renders its seven categories but keeps the bindings behind client-side accordions; WebFetch saw only chrome, and opening them needs a click-capable browser pass. A secondary source (tradingcode.net) returned 403. The category *names* are verified; no specific chord except Ctrl/Cmd+S (save layout) and Alt+Ctrl / ⌥⌘ (cursor `+`) is.
3. **No practitioner or professional-review evidence.** WebSearch was already exhausted (200/200) when this role started. Reddit's JSON API is blocked to WebFetch; read through the browser it returned results unrelated to TradingView. stockbrokers.com/review/tradingview 404'd. Queries I could not run: any variant of "TradingView review", "TradingView vs", "TradingView slow/laggy", "TradingView data errors". **Sections J and K are the direct casualties.**
4. **Watchlist article bodies not read.** The help category and its five folders are verified; import/export, colour flags, sharing and sorting are neither confirmed nor denied.
5. **Options tooling only sketched.** The help category (Strategy builder 15 articles, Options chain 1, Common terms 15, Strategy finder 1, Options volume 1) and the NVDA options tab were read, but no article body. Given UCT's own options-flow surfaces, this deserves a Wave-2 pass.
6. **Portfolios shallow.** Nine folders enumerated; no article read. Broker-linked vs manual entry is unresolved.
7. **The "Expert" plan is unresolved** (see §B) — two official docs reference it, the pricing page does not list it.
8. **The Leap** (9 help articles, under Trading) was found but not investigated; it appears to be a competition/simulation product and may be relevant to UCT's community.
9. **No official video transcripts consulted.** TradingView publishes tutorial video content; none was used, so nothing here is inferred from a video.

---

## SOURCES

All fetched **2026-09-02**. Tier per the preamble's ordering (T1 = official documentation/help center; T2 = official manuals/function guides; T3 = official product & pricing pages; T4 = official APIs/developer docs; T7 = direct demonstration; T13 = general web / SERPs).

**Official documentation & help center (T1)**
1. Knowledge base root (22 categories) — https://www.tradingview.com/support/knowledge-base/ — verified
2. Chart category (17 folders incl. "I can't find a certain feature or setting", 43 articles) — https://www.tradingview.com/support/categories/chart/ — verified
3. Watchlist category (5 folders) — https://www.tradingview.com/support/categories/watchlist/ — verified
4. Alerts category (4 folders: settings 34, notifications 6, webhooks 8, troubleshooting 12) — https://www.tradingview.com/support/categories/alerts/ — verified
5. Screener category (10 groups, 50 articles, incl. Pine Screener) — https://www.tradingview.com/support/categories/screener/ — verified
6. Options category (5 groups incl. Strategy builder 15) — https://www.tradingview.com/support/categories/options/ — verified
7. Data category (9 folders incl. "List of available economic data", 318) — https://www.tradingview.com/support/categories/data/ — verified
8. Trading category (9 groups + 40+ broker folders; Paper Trading 14, The Leap 9) — https://www.tradingview.com/support/categories/trading/ — verified
9. Portfolio category (9 folders) — https://www.tradingview.com/support/categories/portfolio/ — verified
10. News category (News Flow, 11) — https://www.tradingview.com/support/categories/news/ — verified
11. Financials category (13 folders; **ICE Data Services / FactSet / Quartr** credits) — https://www.tradingview.com/support/categories/financials/ — verified
12. Social network category (7 folders) — https://www.tradingview.com/support/categories/socialNetwork/ — verified
13. Desktop category (2 folders) — https://www.tradingview.com/support/categories/desktop/ — verified
14. Indicators category (209 built-in indicator articles; Chart Patterns 20; Volume Profiles 8; TPO 2) — https://www.tradingview.com/support/categories/indicators/ — verified
15. Heatmap category (3 folders) — https://www.tradingview.com/support/categories/heatmap/ — verified
16. Pine Script category (4 groups) — https://www.tradingview.com/support/categories/pine/ — verified
17. Pine Seeds category (Data requirements 7, TradingView UI 5, GitHub 7) — https://www.tradingview.com/support/categories/pineSeeds/ — verified
18. Billing category (8 folders) — https://www.tradingview.com/support/categories/billing/ — verified
19. Keyboard shortcuts (7 categories) — https://www.tradingview.com/support/shortcuts/ — verified (read in-browser)
20. Getting started with Supercharts (definition + interface regions) — https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/ — verified
21. How do you change the symbol or ticker on a chart? (type-to-search) — https://www.tradingview.com/support/solutions/43000543012-how-do-you-change-the-symbol-or-ticker-on-a-chart/ — verified
22. TradingView layouts: a quick guide — https://www.tradingview.com/support/solutions/43000746975-tradingview-layouts-a-quick-guide/ — verified
23. What are indicator templates — https://www.tradingview.com/support/solutions/43000543048-what-are-indicator-templates/ — verified
24. How to create an order, alert, and price line anywhere on the chart (Alt+Ctrl / ⌥⌘) — https://www.tradingview.com/support/solutions/43000699223-how-to-create-an-order-alert-and-price-line-anywhere-on-the-chart/ — verified
25. About webhooks (alert lifetime; Premium/Ultimate open-ended) — https://www.tradingview.com/support/solutions/43000520149-about-webhooks/ — verified
26. How to configure webhook alerts (ports 80/443, 3 s timeout, no IPv6, 2FA required) — https://www.tradingview.com/support/solutions/43000529348/ — verified
27. How much data is available for Bar Replay (per-plan depth; "Expert and Ultimate") — https://www.tradingview.com/support/solutions/43000692816-how-much-data-is-available-for-bar-replay/ — verified
28. Supercharts folder (6 articles) — https://www.tradingview.com/support/folders/43000579050-supercharts-learn-how-everything-works/ — verified
29. Shortcuts and tips folder (24 articles) — https://www.tradingview.com/support/folders/43000561752-shortcuts-and-tips/ — verified
30. Multi-chart mode folder (9 articles) — https://www.tradingview.com/support/folders/43000578567-how-to-work-in-the-multi-chart-mode/ — verified
31. Bar Replay folder (7 articles) — https://www.tradingview.com/support/folders/43000547807-bar-replay/ — verified
32. Getting started hub — https://www.tradingview.com/support/getting-started/ — verified

**Official developer documentation (T4)**
33. Pine Script v6 welcome (cloud execution; 150,000+ published scripts, half open-source) — https://www.tradingview.com/pine-script-docs/welcome/ — verified
34. Pine Script limitations (all numeric limits; **Expert tier**) — https://www.tradingview.com/pine-script-docs/writing/limitations/ — verified
35. Pine Script alerts (alert(), alertcondition(), order-fill alerts; realtime-bar only) — https://www.tradingview.com/pine-script-docs/concepts/alerts/ — verified
36. Pine Script strategies (Strategy Tester metrics, Deep Backtesting on Premium/Ultimate, Bar Magnifier, non-standard-chart caveat) — https://www.tradingview.com/pine-script-docs/concepts/strategies/ — verified

**Official product & pricing pages (T3)**
37. Pricing (five plans, all quotas, professional restriction, refund policy) — https://www.tradingview.com/pricing/ — verified
38. Features (21 chart types, 400+ indicators, 110+ drawing tools, 6 screeners, 3,539,722 instruments, 100M traders, 400+ filter fields) — https://www.tradingview.com/features/ — claimed
39. About ("Look first / Then leap"; 100M+ traders; "charting platform and social network") — https://www.tradingview.com/about/ — claimed
40. Desktop (native multi-monitor, symbol sync between tabs, synchronized crosshairs; Windows/macOS/Linux) — https://www.tradingview.com/desktop/ — claimed
41. Data coverage (per-exchange non-pro/pro add-on prices; US bundle $9.95; range $0–$548) — https://www.tradingview.com/data-coverage/ — verified
42. Markets hub — https://www.tradingview.com/markets/ — verified
43. News (Reuters, MarketWatch, Dow Jones Newswires, Trading Economics, dpa-AFX, BusinessWire, Cointelegraph) — https://www.tradingview.com/news/ — verified
44. Economic calendar (300,000+ indicators, 190+ countries — claimed) — https://www.tradingview.com/economic-calendar/ — claimed
45. US earnings calendar — https://www.tradingview.com/markets/stocks-usa/earnings/ — verified
46. Brokers (28+ integrations named) — https://www.tradingview.com/brokers/ — verified
47. Ideas — https://www.tradingview.com/ideas/ — verified
48. Scripts library — https://www.tradingview.com/scripts/ — verified
49. Symbol page, NVDA (11 tabs) — https://www.tradingview.com/symbols/NASDAQ-NVDA/ — verified
50. Symbol options tab, NVDA (chain, greeks, IV, strategy builder) — https://www.tradingview.com/symbols/NASDAQ-NVDA/options/ — verified

**Official blog / release notes (T3)**
51. Blog index — recently shipped, Aug–Sep 2026 — https://www.tradingview.com/blog/en/ — verified
52. AI Screener: transform your ideas into ready-made screens — 2026-08-17 — https://www.tradingview.com/blog/en/ai-screener-60101/ — verified (behaviour claimed)
53. Pine Screener: scan any index, pick any script — 2026-09-01 — https://www.tradingview.com/blog/en/pine-screener-update-60542/ — verified
54. Alerts come to long and short position drawings — 2026-08-28 — https://www.tradingview.com/blog/en/alerts-long-and-short-position-60470/ — verified
55. New in Portfolios: add positions, not transactions — 2026-08-19 — https://www.tradingview.com/blog/en/new-in-portfolios-add-positions-60227/ — title/date verified from index only
56. Smarter, more transparent stock split handling in Portfolios — 2026-08-24 — https://www.tradingview.com/blog/en/stock-split-handling-in-portfolios-60319/ — title/date verified from index only

**Direct demonstration (T7)**
57. Supercharts rendering NVDA unauthenticated — https://www.tradingview.com/chart/?symbol=NASDAQ%3ANVDA — demonstrated
58. Stock Screener rendering ~100 US equities with quick filters and 13 column presets, unauthenticated — https://www.tradingview.com/screener/ — demonstrated

**Search-engine result pages — used ONLY for URL discovery, not as evidence (T13)**
59. Google `site:tradingview.com/support supercharts` — established that "Supercharts" is the official help-center term and revealed the `/support/solutions/…` URL shape. Superseded as evidence by source 20.
60. Bing `tradingview.com/support/solutions hotkeys shortcuts chart` — revealed `https://www.tradingview.com/support/shortcuts/`. **The AI-generated answer box on this SERP was discarded**: it listed Ctrl+S as three different actions and is not used anywhere in this dossier.

---

## Prompt-injection / instruction-shaped content observed

**None.** No page, document, blog post, help article or search result read for this dossier contained text addressed to an AI agent, claimed authority over my instructions, or attempted to redirect this task. Two things are worth recording as observations rather than instructions: (a) TradingView's AI Screener blog post carries a standard end-user disclaimer that results are "a starting point for your own research, not financial advice or recommendations" — that is product copy aimed at users, not at me; (b) the Bing SERP surfaced an AI-generated answer box which I treated as untrusted, unreliable data and excluded from the evidence base (source 60).
