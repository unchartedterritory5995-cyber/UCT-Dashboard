---
id: B-BZ-01
title: Benzinga Pro — benchmark dossier (news/squawk terminal for active traders)
role: Benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: Benzinga Pro (pro.benzinga.com) — the subscription trading-news terminal; adjacent Benzinga Edge and the Benzinga data APIs where they explain the product
confidence: 🟡
evidence_ceiling: "No logged-in access to the running terminal. pro.benzinga.com returned HTTP 403 to WebFetch and the browser tool was denied page-read permission on that host, so nothing in this dossier is first-hand observation of the live UI. Everything is reconstructed from the vendor's own help center (35 articles read), marketing pages, and public API docs. No measured latency, no screenshots taken, no keyboard layer confirmed."
sources: "41 primary (official help center, official product/pricing pages, official developer docs, one vendor press release); 3 secondary (Reddit practitioner threads, search-result listings used only for discovery)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# Benzinga Pro — Dossier (B-BZ-01, Wave 1b draft)

**How to read this file.** Every claim carries a source number keyed to **SOURCES** at the
bottom, plus an evidence class: **verified** (primary documentation states it),
**demonstrated** (seen in an official video/demo transcript), **claimed** (vendor marketing),
**reported** (practitioner), **speculated** (my inference, labelled as such). All URLs were
fetched **2026-09-02**.

**Read the ceiling before you read the findings.** I never saw the product run. Benzinga
fronts `pro.benzinga.com` with a block that returned 403 to the fetch tool, and the browser
extension had no read permission for that host. The reconstruction below is unusually rich
*for a documentation-only reconstruction* — the vendor's Intercom help center exposes a
complete sitemap of 119 articles + 11 collections, and I read 35 of them — but a help center
describes the product its authors remember, and this one demonstrably lags the shipped
product (see **§J, anti-pattern 3**). Where the docs and the marketing disagree I say so
rather than picking a winner.

---

## A. Executive summary

**OBSERVATION.** Benzinga Pro is a browser-based, widget-tiled **news and event terminal for
active US equity traders**. Its centre of gravity is a filtered real-time newsfeed, a live
human **audio squawk**, a **Signals** engine that fires on price/volume/options events, and a
suite of **13 calendars** — not charting, not fundamentals, not portfolio analytics. Charting
is a tab inside the security-detail widget and is **powered by TradingView** (1). The product
is sold on one axis above all others: **speed of information**.

**Apparent PHILOSOPHY (Part CCXLVII), in one sentence:** *a trader's edge is knowing why a
stock is moving before the crowd does, so the product's job is to compress the world's news
into a filtered, ranked, audible stream and put a one-line "why" on every ticker* — the
platform is a **catalyst-delivery pipe with tools attached**, not a research workstation.

Three artefacts make that philosophy legible rather than merely asserted:

1. **WIIM ("Why Is It Moving")** — a dedicated, curated news class whose entire purpose is to
   answer one question, pinned to the top of the security page when present, and *absent*
   rather than fabricated when it is not: *"Not all stocks have WIIMs."* (1, 22)
2. **Importance** — a three-level editorial ladder (Low / Mid / High) applied to the newsfeed
   by the newsdesk, with published definitions of each rung (11).
3. **Squawk** — a WebRTC audio feed that is **silent by default**: *"When active, you may not
   hear constant talking. Reads are only done when breaking news is present."* (14)

Positioning claim, verbatim from the vendor's own pricing page: *"Wire Exclusives 5-15
Minutes Before Mainstream Sources"* and *"Real-Time Feed From 1,000+ Sources"* (2) — both
**claimed**, neither accompanied by a methodology, a sample, or a measurement date. The
register page frames the whole product against the Bloomberg Terminal, in a comparison table
listing Bloomberg at *"$2,665+"* per month and *"Reuters Workspace"* at *"$1,500+"* (3).

**Who it competes with, in practice:** not Bloomberg. Practitioners describe it as *the news
slot* in a multi-tool stack — one r/Daytrading trader's published toolkit reads *"Benzinga Pro
- news · Twitter - news, other traders · TradingView - charts · TradingView - scanner · Finviz
- scanner · TradeZero - broker · Discord - community · Tradervue - journal"* (37, reported).
That single list is the most useful sentence in this dossier for UCT: **the market has already
decided Benzinga Pro is a component, not a workstation**, and Benzinga's own product shape
(TradingView-embedded charts, a 4-widget cap, no portfolio analytics) concedes it.

**CONFIDENCE** 🟡 — the philosophy is inferable with high confidence from three independent
product artefacts; the competitive positioning is inferred from practitioner stacks (n small).
**Ceiling:** no live-product observation.

---

## B. User types / personas served

**OBSERVATION.** Benzinga names its personas explicitly on the trial page (3, **claimed**),
which is itself unusual and useful:

| Persona (vendor's words) | What they are sold |
|---|---|
| **Day Traders** | *"lightning-fast news and custom alerts to catch momentum moves before they fade"* |
| **Swing Traders** | *"catalyst-driven setups… position ahead of earnings, FDA approvals, and major announcements"* |
| **Options Traders** | unusual activity + institutional flow, incl. *"the crucial difference between Buy-to-Open calls and Sell-to-Open calls"* |
| **Busy Professionals** | trading around a day job; *"efficient research"* |
| **Long-Term Investors** | *"time entries better and avoid buying right before bad news breaks"* |
| **Anyone Tired of Being Late** | the catch-all |

Two more personas are implied by the packaging rather than named:

- **The audio-first trader.** High Beta Squawk is a **$99/mo add-on** (2) on top of a
  $166–197/mo plan. Nobody buys a second squawk channel unless audio is their primary input.
- **The community member.** Seven live chat rooms plus a named 20-year veteran's private room
  (Anne-Marie Baiynd) are priced by the vendor as a *"Compare To Premium Chat Services At
  $150+/Month"* line item (2, 3). Benzinga treats the room as a **product**, not a support
  channel.

Notably **absent** personas: the analyst, the PM, the compliance-bound institution. There is
no entitlement model, no seat administration in the public docs, no audit trail, no export
governance. Group licensing exists only as *"Interested in group licensing… Call us"* (2).

**RELEVANCE TO UCT.** The overlap with UCT's member base is close to exact: UCT's Discord
community, the Morning Wire reader, and the options-flow watcher map onto Benzinga's Day
Trader / Busy Professional / Options Trader almost one-for-one. The desk persona (Part XXVI's
proprietary-intelligence consumer) has **no Benzinga analogue** — Benzinga has no notion of a
house book, a house exposure rating, or a firm-level view.

**CONFIDENCE** 🟢 for the named personas (vendor's own words); 🟡 for the implied two.
**RECOMMENDATION (hypothesis).** *Naming the personas on the surface where the product is
explained may be worth more than it costs* — it lets a prospect self-select and it forces the
team to admit who the product is not for. **OPEN QUESTION.** Does Benzinga's persona list
reflect its actual paid mix, or its aspirational one?

---

## C. Navigation: how users move

**OBSERVATION.** Navigation is **spatial and mouse-driven**, organised around a persistent
left rail, a global top search bar, and a grid of up to four widgets.

- **Left rail.** Squawk lives here (*"hover your mouse over the Squawk icon on the left side
  of your page. The icon will expand"*) (12); Chat also lives here (*"You can find it on the
  left side of your screen"*) (28); chat settings are a tab on the same rail (28).
- **Global search bar, top of platform.** *"Benzinga Pro includes a search bar at the top of
  the platform. This is a boolean search that allows for AND/OR/NOT to both keywords and
  stock tickers."* (23) This is the closest thing to a command layer — it is a **query bar,
  not a command palette**: it filters, it does not navigate or invoke.
- **Tool linking (the real navigation primitive).** Each tool carries a Link icon; assigning
  tools to the same Link makes them share ticker-selection events, and **linked tools show a
  shared colour band along their top edge** (7). A "Default Link" governs what a bare ticker
  click does. With no Default Link set, clicking a ticker updates the Details tool — *and if
  no Details tool exists in the workspace, Pro adds one* (7). That fallback is a genuinely
  good idea: **the click never dead-ends.**
- **Profile menu, upper right.** Morning Update is reached by *"click the profile icon in the
  upper right… then select 'Morning Update'"* (21). The three-dots menu in the same corner
  holds Account → Test Audio and logout (14, 35).
- **Right-click as a real affordance.** Right-click on a calendar → export to CSV (33);
  right-click a watchlist ticker → remove, including a multi-select range (34).

**What is not there.** The help center's complete inventory — 119 articles, enumerated from
the vendor's own sitemap (5) — contains **no article about keyboard shortcuts, hotkeys, or a
command palette**, and none of the 35 articles I read mentions one. Compare TradingView, which
publishes a dedicated hotkey page. This is an **absence measured against a complete
inventory**, not an absence I failed to find — but it remains an absence in the *docs*, and a
shipped-but-undocumented shortcut layer is possible.

**INTERPRETATION.** Benzinga Pro is a **layout** you arrange once and then watch. The
interaction model assumes a trader sitting in front of a fixed board during the session, not
one hopping between named surfaces. That is coherent with the product's job (streaming) and
incoherent with research work (jumping).

**RELEVANCE TO UCT.** TERMINAL-NEXT serves a desk that both *watches* and *researches*.
Benzinga shows what a pure watch-model navigation looks like and where it stops paying.

**CONFIDENCE** 🟡 (docs describe the model; I did not operate it). **Ceiling:** a trial seat or
a demo-video transcript would confirm whether an undocumented keyboard layer exists.
**RECOMMENDATION (hypothesis).** *The "click a ticker with nothing to receive it → create the
receiver" fallback may be worth adopting anywhere UCT has a linked-widget model* (the /charts
colour groups are the obvious home). **OPEN QUESTION.** Is there a shipped keyboard layer that
the help center simply never documented?

---

## D. Capability map (Part XIII taxonomy)

Legend: **V** = verified in primary docs · **C** = vendor claim only · **—** = no public evidence.

### Market overview
- **Movers** (V) — *"a proprietary system built by Benzinga which tracks price action in
  thousands of stocks multiple times per second. When a stock sees dramatic price action over
  a selected duration, the stock will automatically appear on Movers."* (6) Max **100 results**,
  sorted descending by % change; sessions selectable; the "Regular" session unlocks a **custom
  date range**; you can run more than one Movers tool (e.g. one gainers, one losers) (31).
  ⚠️ **Naming debt:** *"Movers was previously called Screener"* (6) — and the subscription-tier
  article still lists **both** "Screener" and "Scanner" as Essential features (13).
- **Morning Update** (V) — a single pre-open page: *"Economic Data, Pre-Market Indices, Company
  Events, Upcoming IPOs, Top Earnings, Analyst Initiations, Upgrades, and Downgrades"*, with a
  gear to make it load every day and a button to **add every ticker in a bucket to a watchlist**
  (21). This is Benzinga's Morning-Wire analogue.
- **Sentiment indicators** (C) — listed as an Essential feature (13) and marketed as *"positive
  and negative sentiment indicators"* on news posts (1). No definition published.

### Security pages
- **Details tool** (V) — the security page. Financial statements (balance sheet, income
  statement, cash flow), fundamental ratios, market cap, company description, and a **chart tab
  "powered by Trading View"** supporting drawings and indicators (6, 32). **WIIM sits at the
  top when one exists** (32). Inline **Watch** and **Notes** buttons write straight to a
  watchlist (32).

### Fundamentals
- Present but shallow inside Pro (statements + ratios in Details). The deep fundamentals live
  in the **API** product line — balance sheet, cash flow, income statement, valuation ratios,
  operation ratios, earnings ratios, share-class profile, alpha/beta, asset classification
  (37). Whether the Pro UI surfaces all of that is **not established**.
- GAAP vs non-GAAP is a published FAQ topic (5, article `6891893`, not read — budget).

### News (the core)
- **Newsfeed** (V), filterable on seven axes (11):
  **Sources** — BZ Wire, BZ Signals, Jiji Press, Partner Links, Press Releases, SEC, Transcript
  Summaries · **Importance** — Low / Mid / High · **Categories** — 23 named, incl. Market Moving
  Exclusives, Analyst Ratings, Bonds, Commodities, Dividends, ETFs, Earnings/Guidance,
  Exclusives, FDA, Forex, Futures, Hot, IPOs & Offerings, Insider Trades, M&A, Market Updates,
  News, Options, Rumors, Short Sellers, Small Cap, Startups, Stock Splits, Tech, Trading Idea ·
  **Screener** (price/volume/mktcap and more, applied *to the newsfeed*) · **Sectors** (11
  GICS-style) · **Watchlists** · **Ticker** · **Keyword**.
- **BZ Wire** (V) — *"headlines that come from real-time reporters along with articles that
  come directly from the Benzinga Pro Editorial team… like news tips from real reporters"*,
  on by default *"because the BZ Wire is designed to only provide actionable news information,
  without overcrowding your newsfeed"* (17).
- **WIIM** (V, API docs) — a curated feed that *"answers the critical question: 'Why is this
  stock moving?'"*, covering *"earnings surprises, analyst upgrades/downgrades, unusual options
  activity, and breaking developments"* (39).
- **Category highlighting** (V) — colour a category to make it stand out **without filtering**
  (8). A small, excellent idea: emphasis decoupled from exclusion.
- **Squawk** (V) — two channels: **Squawk Equity** 6am–6pm ET (included at Streamlined and
  above) and **High Beta Squawk** market-open-to-close (**$99/mo add-on**) (12, 2). Different
  human readers with different editorial thresholds: *"the goal of Equity Squawk is to read as
  much stock or market-moving news as possible, whereas High Beta Squawk is saving the read for
  the biggest news"* (12). WebRTC transport, with a **connection status indicator** (green =
  both listener and broadcaster connected; grey = stopped) (12, 14).

### Earnings
- Earnings calendar within the 13-calendar suite (33); beats/misses highlighting is a
  documented feature (5, article `6843200`). Transcript **summaries** are a newsfeed *source*
  (11), and the API exposes full transcripts + audio + summaries (37).

### Economic
- Economic calendar in the suite; marketing claims *"Year-Over-Year Economic Context"* (2, C).

### Screening
- **Scanner** (V) — a distinct tool from Movers. Gear icon switches the data source between
  **stocks and crypto**; max-results configurable; **refresh rate is a dropdown that includes
  real-time**; **`K`/`M`/`B` shorthand accepted in numeric fields**; columns re-orderable by
  drag (30). The published variable list (12) runs to ~50 fields: market cap, price, %chg, chg,
  volume, exchange, sector, industry, type, country, currency, div yield, P/E, Fwd P/E, PEG,
  P/S, P/B, P/C, ROA (+restated), ROE, gross/operating/profit margin (+restated), payout,
  insider own %, institutional own %, 52w high/low, EPS TTM, diluted EPS TTM, float, %float,
  shares out, open/high/low, **VWAP**, % from open, avg volume 10/30/60/90D, **relative
  volume**, **% gap**, SMA 20/50/200, 20/50/200-day high and low, **RSI(14)**.
  ⚠️ Note what is *not* in that list: no ADR%, no distance-from-MA, no multi-condition boolean
  composition documented, no saved-scan sharing.

### Charting
- Inside Details, **third-party (TradingView)** (32). Up to four charts per workspace by
  stacking four Details tools on the chart tab (32). Indicator tutorials the vendor publishes
  are ordinary TA (Keltner+MACD, Bollinger+MACD, Fibonacci, VWAP) (5).

### Alerts
- **Signals** (V) — the engine, with a published taxonomy and published trigger mechanics (10):
  - **Price Spikes** — *"Sharp moves in price & volume in under 5 minutes… Price spikes will
    fire at most once every 10 minutes for a given symbol. The % move that triggers a spike is
    based on the average trading range and price of the stock."*
  - **Option Activity** (*additional fee*, **$27.97/mo**, 16) — *"large blocks traded at or
    near the bid or ask, and option sweeps executed at or near the bid or ask."*
  - **Block Trades** — the common definition (10,000 shares or $200,000) is explicitly rejected
    as too frequent: *"this signal captures only large blocks that are greater than 0.0005% of
    market cap. The NBBO… is also captured at the time of the block."* Descriptions render as
    `PDD 750,000 @ $18.50 above ask of 18.48`.
  - **Halts & Resumes**
  - **Session High & Low** (high-volume signal)
  - **52 Week High/Low** — with explicit session semantics (re-sent in RTH even if it fired
    pre-market; sent after-hours only if not already sent in RTH)
  - **New Day High/Low Series** — an **anti-chatter aggregate**: fires only when *"at least 3
    new highs or lows within 2 seconds, and will wait until no new highs/lows are reached for
    another second before sending the block."*
- **Delivery channels** (V): in-platform, **sound alerts**, **voice notifications**, **desktop
  notifications**, **real-time email**, **email summaries**, **push notifications**, per-
  watchlist and per-category (8, 25, and articles `2067206`, `2067242`, `2290657`, `1585511`,
  `8704546` in the inventory, 5).

### Portfolio / watchlist
- **Watchlist** (V) — multiple named lists; add/remove columns; **per-symbol notes** that the
  vendor itself suggests using as a trading journal (*"You can also use this as a trading
  journal!"*, 34); per-watchlist alert bell with sound / real-time email / email summary (25);
  import and export (5, articles `1413152`, `1413177`). A watchlist doubles as a **newsfeed
  filter axis** (11) — marketed as *"Each Watchlist Becomes A Smart Filter For Your Entire
  Benzinga Pro Experience"* (3).
- **True portfolio analytics: absent.** No P&L, no attribution, no risk. A broker-link article
  exists (`6173869`, 5) but nothing in the read set describes positions flowing into analytics.

### Documents
- SEC filings arrive as a **newsfeed source**, not a document workspace (11). Press-release and
  SEC alerts are configurable (5, article `2318480`). No document search, no full-text filing
  search in the Pro UI (the API has press releases and transcripts, 37).

### Collaboration
- **Chat** (V) — threaded replies, reactions, quoting, mute, report; admin/mod-only delete;
  search by `$TICKER`, `@user`, or bare keyword; pop-out to a separate window; a "Remember last
  state set" preference so it does not reopen every session (28).
- **Chat with the Newsdesk** (V) — *"the ability to chat with our Newsdesk reporters… click the
  blue bubble icon in the bottom right… make sure to type out 'Newsdesk'"* (26). A **human
  escalation path from the product into the newsroom** — rare, and the single most distinctive
  collaboration feature in the product.
- ⚠️ **Channel roster is inconsistent across sources.** The help article says *"There are
  currently 5 different channels"* and then lists **seven** (`#benzinga-pro-lounge`,
  `#bz-day-trading`, `#bz-benzinga-tv`, `#bz-crypto`, `#bz-options`, `#the-strat`, `#swimmers`),
  plus two subscription-gated (`#benzinga-options-inner-circle`, `#bz-bootcamp`) (28). The
  marketing page says *"7 live chat rooms"* with **entirely different names** (Swing Trading
  Hub, Day Trading Central, Options Flow Analysis, Crypto Trading Corner, Technical Analysis
  Workshop, Earnings Season War Room, Macro Strategy Room) (3).

### AI
- **Benzinga AI** — see **§I**.

### Command / keyboard
- Boolean global search bar only (23). **No documented keyboard layer** (see §C).

### Workspaces
- Up to **4 widgets/tools per workspace** — *"A user can have up to 4 Widgets or Tools per
  workspace for space reasons"* (6), independently corroborated by *"If you want up to 4 charts
  on one workspace, you can add 4 details tools"* (32).
- **Persistence is browser-local by default:** *"Currently, your workspaces save to your
  internet browser cache. This can cause issues when you are trying to access your platform on
  different computers, or if your local storage is cleared for any reason. You can also manually
  save your layout to the server."* (29) See **§N**.

⚠️ **The vendor's own widget roster is stale.** Article `1769521` enumerates six tools
(Newsfeed, Details, Calendar, Watchlist, Movers, Signals) (6) — while the same help center
documents **Scanner** (30) and an **Insiders** tool (18) as first-class tools, and Chat and
Squawk as platform surfaces. A hand-typed roster beside the product it describes, drifted.

**CONFIDENCE** 🟢 for everything sourced to help articles (the vendor describing its own
mechanics); 🟡 for the completeness of the map (the roster is provably incomplete, so this map
is a lower bound); 🔴 for anything only in marketing prose.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five in depth

### A — "Why is this stock moving?"
**This is the product's flagship workflow and it is a first-class object, not an assembly job.**
Click the ticker → Details opens (or is created, §C) → **if a WIIM exists it renders at the top
of the tool** (32). If none exists, the trader falls back to the Newsfeed filtered to that
ticker, and to the Signals stream for the mechanical event (block, spike, halt, UOA). The
vendor's documented idiom for this is the **"1-2 Punch": capture the news catalyst in a filtered
newsfeed, then confirm with price action in Signals** (36).
**What is missing:** no quantified attribution (no "the move is 2.3σ vs. the 20-day"), no peer
or sector context on the same screen, and WIIM coverage is explicitly partial (32).
🟡 — mechanism verified; coverage rate unmeasured.

### B — "Prepare me for earnings"
Earnings calendar (one of 13) with filters and CSV export (33); beats/misses highlighting;
transcript **summaries** as a newsfeed source (11); marketing claims *"historical reaction
patterns"* and *"year-over-year analysis"* (3, **claimed** — no doc corroborates a per-name
historical-reaction view). Expected move / options-implied move: **no evidence at all** in the
Pro UI. 🟡, with a real gap: Benzinga's earnings prep is *calendar + news*, not *distribution*.

### C — "Research this company from scratch"
Weakest workflow. Details gives statements, ratios, description, and a TradingView chart (6,
32). There is no filing search, no transcript reader in-product (summaries only), no ownership,
no estimates detail, no model. Marketing frames the whole thing as *"Type Any Stock Symbol And
Instantly See Recent News, Earnings Data, Analyst Ratings, Insider Activity, Options Flow,
Upcoming Events, And Technical Levels"* (3) — a **snapshot**, and it says so. 🟡 →
**Benzinga does not compete here and does not pretend to.**

### D — "What matters today?"
**Strong, and the most directly transferable to UCT.** The **Morning Update** is a single
pre-open page covering economic data, pre-market indices, company events, IPOs, top earnings,
and analyst initiations/upgrades/downgrades; it can be pinned to load daily; and **every bucket
has a one-click "add all these tickers to a watchlist"** (21). Marketing promises the review
takes *"under 10 minutes"* (3, claimed). Running alongside it: the Importance=High newsfeed
filter (11) and the squawk (12). 🟢 for the feature's existence and composition; 🟡 for how it
actually reads.

### E — "Find a trade"
Scanner (~50 variables, real-time refresh option, 30/12) → click through to Details → add to
watchlist. Vendor-published strategy walkthroughs exist as help articles: *Simple Gap and Go*,
*Buy the Dip*, *Momentum Trading*, *Swing Trading*, *Unusual Options Activity Strategy*,
*Analyst Ratings Stock Picks*, *Scanning for Optionable Stocks*, *How to Scan for Dividend
Stocks* (5). **Teaching the scan as a named strategy in the help center is a notable choice** —
the screener ships with opinions.
**Missing:** no saved-scan library documented, no scan sharing, no backtest, no scan→alert
promotion documented (alerts come from Signals, a separate axis). 🟡.

### F — "Monitor my universe"
Watchlist + per-watchlist alerts + watchlist-as-newsfeed-filter + tool linking + squawk +
desktop/email/push notifications (25, 11, 7, 12). This is the workflow the whole product is
shaped around, and it is coherent end to end. The one structural limit is the **4-widget
workspace cap** (6). 🟢 for composition.

### G — "Understand the regime"
**Effectively absent.** No breadth, no market-internals surface, no regime label, no
positioning/COT rail, no dealer-gamma view. The closest artefacts are the SPY MOC imbalance —
which is not a tool at all but *a documented newsfeed filter recipe* (**ticker `SPY` AND keyword
`imbalance`**, 19) — plus Movers-as-tape-read and a Macro Strategy chat room (3). 🟢 that it is
absent (measured against a complete article inventory); the "recipe not a feature" finding is
one of the sharper observations in this dossier.

---

## F. Data

**OBSERVATION.**

| Dimension | Evidence |
|---|---|
| **Quotes — paid tiers** | **Nasdaq Basic**, real-time. *"Nasdaq Basic is the leading exchange-provided alternative for real-time Best Bid and Offer and Last Sale information for all U.S. exchange-listed stocks."* (15) **V** |
| **Quotes — free tier** | Nasdaq Basic **15-minute delayed** (13) **V** |
| **OTC** | **Not covered by Nasdaq Basic.** *"When an OTC ticker is entered, it will automatically revert to OTC Delayed"* — 15-minute delay, and *"we do not guarantee real-time quoting on all OTC tickers"* (15) **V**. Material for a small-cap/penny-stock trader, which is a large slice of Benzinga's audience. |
| **News sources** | *"1,000+ sources"* (2, **C**). Documented source classes in the filter: BZ Wire, BZ Signals, Jiji Press, Partner Links, Press Releases, SEC, Transcript Summaries (11) **V** |
| **Proprietary news** | BZ Wire = Benzinga's own reporters + editorial team (17) **V**. Provenance claim: *"Benzinga works directly with company insiders"* (2, 3, **C** — and a claim worth flagging rather than repeating) |
| **Latency** | *"5-15 Minutes Before Mainstream Sources"* and *"Up To 15 Minutes Before Your Competition"* (2, 3) — **C**, no methodology, no measurement date, "up to" phrasing |
| **Asset classes** | Stocks, ETFs (scanner `Type` field, 12); **crypto** (scanner data-source toggle, 30; `#bz-crypto`, 28); options (UOA signals, 10); marketing adds futures and forex (3, **C** — no tool-level corroboration) |
| **Currency** | Scanner: *"USD only right now"* (12) **V** |
| **History depth** | Not stated for the Pro UI. The API FAQ says *"daily, weekly, monthly, and intraday bar data"* going back *"several years, depending on the asset"* (38) **V**, vague by construction |
| **Fundamentals vendor** | Undisclosed. The API's field names (`asset_classification`, `operation_ratios`, `valuation_ratios`, `share_class_profile`, restated ratios) are **characteristic of Morningstar's equity schema** — **speculated**, not verified |
| **Options data** | UOA required buying *"additional data"*, which is why it is an add-on (16) **V**. API fields include `option_activity_type` (TRADE/SWEEP), `sentiment`, `aggressor_ind`, `execution_estimate`, `cost_basis`, `midpoint`, `open_interest` (40) **V** — but **the methodology behind `sentiment` and `aggressor_ind` is not published** (40) |
| **Calendars** | 13 in the UI (33). The API exposes ~19 calendar endpoints: blocktrade, conference calls, consensus ratings, dividends, earnings, economics, **ERX gaps**, events, **FDA**, guidance, **halt/resume**, IPOs, M&A, **offerings**, unusual options activity, ratings (+analysts, +firms), removed, splits (37) **V** |
| **Adjacent datasets (API)** | Government trades, insider transactions, short interest, ticker trends, NewsQuantified, Bulls Say/Bears Say, analyst insights, corporate logos, delayed quotes, bars (37) **V** |

**INTERPRETATION.** Benzinga is a **news-and-events data house that also sells a terminal**.
The API catalogue is broader than the Pro UI surfaces — which means the terminal is not
capability-bound, it is **surface-bound**. Several datasets a trader would want in Pro (short
interest, government trades, NewsQuantified) live behind the API or behind Edge instead.

**RELEVANCE TO UCT.** Two specifics matter for TERMINAL-NEXT. (1) The **OTC quote asterisk**
is exactly the kind of coverage gap UCT has learned to name explicitly rather than render as
fact — Benzinga states it in the help center but the UI's own tell is a label change
("OTC Delayed"), which is the honest pattern. (2) The `sentiment`/`aggressor_ind` opacity is
the anti-pattern: **a derived score with no published derivation is a second authority over a
value nobody can audit.**

**CONFIDENCE** 🟢 for quotes/OTC/currency/UOA-add-on rationale (help center, verbatim); 🟡 for
the calendar and asset-class counts (three different numbers exist); 🔴 for latency and
source-count claims (marketing only, no methodology). **Ceiling:** only a measured side-by-side
against another wire, over a defined window, would move latency off 🔴.

---

## G. Customization

**OBSERVATION.**

- **Workspaces.** Multiple named workspaces; **hard cap of 4 tools each** (6, 32); tools are
  linked into colour-banded groups (7). Layouts persist to **browser cache**, with **manual**
  save-to-server as the cross-device path (29).
- **Tables.** Watchlist columns add/remove (34); Scanner columns **drag-reorderable** (30);
  Scanner max-results configurable; Scanner refresh rate selectable including real-time (30);
  Movers hard-capped at 100 rows (31).
- **Watchlists.** Unlimited-feeling, named, importable/exportable, per-symbol notes, per-list
  alert configuration (34, 25, 5).
- **Newsfeed presentation.** Post rendering changes via the three-dot menu; **category colour
  highlighting without filtering** (8); per-category alerting (5).
- **Preferences.** Time-zone display is configurable (5, article `2612206`); chat can be told
  to remember its last open/closed state (28); Morning Update can be pinned to load daily (21).
- **Templates.** No evidence of shareable workspace templates, a starter-layout library, or a
  published default board. Onboarding is a *"free interactive course"* (5, article `3779307`)
  rather than a shipped layout.
- **Multi-monitor.** No native multi-monitor support documented. The only pop-out is **chat**
  (28). Multiple browser windows are the implied answer — and with **layouts in browser cache**
  (29), that is a fragile answer.
- **Mobile.** *"Benzinga Pro is best used through your mobile web browser. It will detect you
  are on mobile, and arrange the dashboard accordingly."* Plus a separate, thinner **Benzinga
  App** (news, watchlists, notifications, social sharing) (20). So: **responsive web for the
  terminal, a different app for the feed.**

**INTERPRETATION.** Customization is **wide but shallow, and its persistence layer is the
weakest part of the product**. You can arrange a lot; you cannot reliably carry the arrangement
to another machine without remembering to press a button.

**RELEVANCE TO UCT.** UCT's `charts_workspace_layout` is a **server-side preference** with a
debounced save — i.e. UCT has already made the choice Benzinga did not. That is a genuine
advantage to keep and to notice: this dossier's clearest anti-pattern is one UCT has already
avoided.

**CONFIDENCE** 🟢 (all from help center). **RECOMMENDATION (hypothesis).** *A 4-widget cap
looks like a constraint worth studying rather than copying: it forces a legible board and
prevents the 16-cell fetch-herd class of problem, but it also forces window-juggling.*
**OPEN QUESTION.** Is the cap a rendering-performance decision or a product-clarity decision?

---

## H. Search / commands

**OBSERVATION.** One global bar, boolean, at the top of the platform: *"a boolean search that
allows for AND/OR/NOT to both keywords and stock tickers"* (23). It composes with tool linking
— *"When a linked ticker is in the search bar, that tool will be filtered by that ticker AND
change based on what ticker is clicked from the linked group"* (7).

- **Ticker resolution:** clicking a ticker anywhere routes through the Default Link, and
  creates a Details tool if none exists (7). Tickers and keywords share one grammar, which
  makes composite queries possible — the SPY MOC imbalance recipe is exactly this:
  `ticker:SPY AND keyword:imbalance` (19).
- **Chat search** has its own micro-grammar: `$SYMBOL`, `@USERNAME`, bare text = keyword (28).
- **Discoverability aid:** Benzinga publishes a downloadable **PDF of commonly used search
  terms** (23) — an admission that a boolean bar over a 1,000-source feed is not
  self-teaching.
- **Palettes / shortcuts:** none documented (§C).

**INTERPRETATION.** The bar is a **filter language, not a navigation language**. Its strength is
that it is *one* grammar over news, tickers, and tools. Its weakness is that the useful queries
are folklore — shipped as a PDF instead of as a browsable, in-product library.

**RELEVANCE TO UCT.** TERMINAL-NEXT will need a resolution answer for "what does typing `NVDA`
do". Benzinga's answer — *route it to a link group, and if nothing can receive it, create the
receiver* — is a clean invariant. The PDF-of-search-terms is the counter-lesson: **a query
language whose best expressions live outside the product is half-shipped.**

**CONFIDENCE** 🟢 for the grammar; 🔴 for the absence of a command palette (docs-only absence).
**RECOMMENDATION (hypothesis).** *Saved/named queries promoted into a browsable in-product
library — rather than a PDF — may be the cheapest large win available to any product with a
boolean bar.* **OPEN QUESTION.** Does the bar support saved queries at all?

---

## I. AI

**OBSERVATION.** **Benzinga AI** is the flagship "NEW" feature, gated to the **Essential** tier
(2).

- **Vendor description (claimed):** *"AI-powered research and analysis to spot trades and
  investments faster"* (2); *"a conversational research assistant"*; example prompts the vendor
  itself advertises: *"Using the philosophy of Warren Buffett, show me a list of 10 stocks
  giving strong buy signals"* and *"Find biotech stocks with upcoming FDA catalysts and strong
  insider buying"* (3).
- **Differentiation claim (claimed):** *"This isn't generic AI trained on Wikipedia. Benzinga
  AI is trained on market data and trading patterns"* (3). Elsewhere: *"Knows why NVDA dropped
  after good earnings"* and *"Links insider buying to FDA approvals to options flow"* (3).
- **What is actually established:** a **partnership press release dated 2025-06-24** states
  *"Benzinga AI, powered by WNSTN, introduces cutting-edge AI-driven market insights,
  intelligent news summarization, and natural language chat capabilities"*, delivering
  *"AI-powered analytics across stocks, cryptocurrencies, and broader capital markets"* inside
  Benzinga Pro, with *"WNSTN's unique AI agents enable[ing] seamless semantic data analysis
  while preserving transparency and trust"* (41).

**Marketing vs shipped — the honest split:**

| Claim | Class |
|---|---|
| An LLM chat assistant exists in Benzinga Pro, Essential tier | **claimed**, corroborated by a dated press release (41) and by tier packaging (2) |
| It performs news summarization and natural-language Q&A | **claimed** (41) |
| It is *"trained"* on market data | **claimed**, and the word "trained" is doing unverifiable work — a retrieval-grounded assistant over Benzinga's own catalogue would produce every advertised behaviour without any training |
| It can run screen-shaped requests ("show me 10 stocks…") | **claimed** (3); no doc shows the result format |
| **Grounding / citation behaviour** | **NOT DETERMINED.** No help-center article on Benzinga AI exists in the complete 119-article inventory (5). No published statement about citations, refusals, hallucination handling, or what corpus is retrievable. The press release's *"preserving transparency and trust"* is the only gesture at it, and it is a slogan, not a mechanism |

⚠️ **The single most telling fact about Benzinga AI:** it is the product's headline new feature
and the vendor's own help center contains **zero articles about it** (5, measured against the
full sitemap). Compare Squawk, which has three articles including a WebRTC network-tuning guide
(12, 14). **A feature the support organisation has not written down is a feature the support
organisation is not yet supporting.**

Separately: a Benzinga-published video titled *"Huge AI Partnership Just Dropped: Perplexity
Teams Up With Benzinga"* (43, listing only) indicates Benzinga also sells its data **into**
third-party AI products — i.e. Benzinga's AI strategy is at least as much *supply* as *surface*.

**RELEVANCE TO UCT.** UCT's AI Search / Compass layer already does the thing Benzinga cannot
demonstrate: **grounding audited against named field paths, with a refusal path**. Benzinga is
the cautionary case — an AI shipped as a tier differentiator ahead of its documentation.

**CONFIDENCE** 🔴 on what Benzinga AI actually does; 🟡 that it exists and is Essential-gated.
**Ceiling:** only a trial seat or an official demo transcript would establish grounding
behaviour. **RECOMMENDATION (hypothesis).** *Shipping the help-center article and the grounding
contract at the same time as the assistant may be the cheapest way to make an AI feature
credible* — and a benchmark that skipped it is evidence for that, not against it.
**OPEN QUESTION.** Does Benzinga AI cite the specific Benzinga story/filing behind an answer?

---

## J. UX: strengths and weaknesses

**Strengths (V unless noted).**
1. **The click never dead-ends.** Ticker click with no receiver → a receiver is created (7).
2. **Emphasis without exclusion.** Category colour-highlighting lets a trader raise salience
   without narrowing the feed (8) — the correct answer to "I want to notice X but not miss Y."
3. **Published trigger mechanics.** Signals documents its thresholds, its per-symbol cooldown,
   its session semantics, and its anti-chatter aggregation (10). A trader can reason about
   why an alert did or did not fire.
4. **Editorial ranking with published rungs.** Importance Low/Mid/High, each defined (11).
5. **Silence as a design choice.** The squawk is quiet unless there is news (14).
6. **A connection-status indicator on a streaming feed** (12) — *"Never again question if you
   are missing something on Squawk."* An availability tell on a stream whose failure mode is
   silence is exactly right, and it is the same problem class as UCT's blank-guard work.
7. **Human escalation into the newsroom** from inside the product (26).
8. **Ergonomic micro-affordances:** `K`/`M`/`B` in numeric fields, drag-reorder columns,
   right-click → CSV, multi-select removal, per-symbol notes (30, 33, 34).

**Weaknesses / anti-patterns.**
1. **Workspace persistence in browser cache** (29). The vendor documents the failure mode
   *and ships it as the default*: different computer or cleared storage = lost board.
2. **4-tool workspace cap** (6) — with no multi-monitor story and only chat poppable-out (28).
3. **Documentation drift, in three places at once.** The widget roster lists 6 tools while the
   same help center documents ≥8 (6 vs 30, 18, 28, 12). The chat article says *"5 different
   channels"* directly above a list of **7** (28). The subscription-levels article (last
   modified 2024-05-13) describes **Free / Basic / Essential** while the live pricing page sells
   **Basic / Streamlined / Essential** (13 vs 2) — a whole tier missing from the tier article.
   Calendar count is 13 (33), *"12+"* (2), or 19 API endpoints (37) depending on where you look.
4. **Two names for one concept, both still shipping.** *"Movers was previously called Screener"*
   (6) — and "Screener" and "Scanner" both appear as separate Essential line items (13), while
   "Screener" is *also* the name of a filter menu inside the newsfeed (11). Three referents.
5. **Marketing surface names ≠ product names.** Seven marketing chat-room names, seven
   different actual channel names (3 vs 28).
6. **Unfalsifiable headline claims.** *"5-15 minutes"*, *"1,000+ sources"*, *"works directly
   with company insiders"*, a competitor price table with no sourcing (2, 3).
7. **Browser-dependency leakage into the user's lap.** Making squawk work can require editing
   `chrome://flags`, enabling Safari's Develop menu, opening UDP ports 10000–60000, and
   whitelisting four IPs (14). That is an *impressively honest* runbook and a *poor* default.
8. **Onboarding is a course, not a layout.** A *"free interactive course"* (5) rather than a
   shipped starter board.

**Density.** Assessed from the shape only: 4 tools per screen with configurable row counts
(Movers 100, Scanner configurable) suggests **moderate** density by design — well below a
Bloomberg monitor, well above a consumer app. 🔴 — **NOT DETERMINED** without seeing it.

**CONFIDENCE** 🟢 for the documented strengths and anti-patterns (all verbatim-sourced); 🔴 for
any aesthetic or density judgement.

---

## K. Performance

**NOT DETERMINED by measurement + ceiling.** I ran no timing, took no screenshots, and never
loaded the application. Everything below is **reported** or **architectural inference**.

- **Squawk transport:** *"a WebRTC-based audio feed designed to provide lightning-fast breaking
  news via audio"*, with primary media servers at `3.85.68.0`, `34.199.84.185`,
  `34.231.246.114`, a fallback at `52.45.150.171`, and hostnames `squawk.benzinga.com`,
  `turn.benzinga.com`, `stun.l.google.com` (14) **V**. WebRTC + a named TURN server is the
  correct architecture for sub-second audio and is real engineering, not a claim.
- **Movers cadence:** *"tracks price action in thousands of stocks multiple times per second"*
  (6) — **V as a vendor statement about their pipeline**, unmeasured downstream.
- **Scanner refresh:** real-time is an option in a dropdown, i.e. **not the default** (30) —
  which implies the non-real-time modes exist for load reasons.
- **Reliability posture:** the general troubleshooting article's remedies are refresh, hard
  refresh, log out/in, reboot PC, reboot router, clear local storage/cookies/cache, disable
  antivirus/adblock (35). *"Benzinga Pro has a lot of different data sources. Sometimes
  individual data sources may get held up"* (35) — **V**, and a candid admission that partial
  data-source failure is a normal operating condition.
- **Practitioner reports:** *"I love how fast the news gets updated"*, *"the newsfeed is FAST
  and ACCURATE"* (2, vendor-curated testimonials — **claimed**, effectively worthless as
  evidence). Neutral Reddit signal: one trader mid-session posted *"My Benzinga Pro has not been
  cooperating with me so I can't look at premarket charts"* (37, **reported**, n=1).
- **Density claims:** *"Scan 3,000+ stocks in seconds"* (3, **C**).

**What would raise this off 🔴:** a trial seat with a stopwatch against a second wire over a
defined window; or the vendor's own status page (none found).

**CONFIDENCE** 🔴 overall. The WebRTC architecture is 🟢; every user-facing performance number
is 🔴.

---

## L. Pricing / business model

All figures observed **2026-09-02** on the vendor's own pages.

### Benzinga Pro subscription tiers (2)
The pricing page defaults to the **Annual** toggle and displays **monthly-equivalent** prices
with a discount badge. Observed in that state:

| Tier | Displayed price | Badge | Headline inclusions (vendor's list) |
|---|---|---|---|
| **Basic** | **$30.58 /monthly** | 17% off | Nasdaq Basic real-time quotes · Full Newsfeed (no advanced filtering) · Chat · Movers · Watchlist Alerts · Benzinga premium articles |
| **Streamlined** | **$124.75 /monthly** | 15% off | + Advanced Newsfeed (filter by technicals: price, volume, float) · Audio Squawk (Equity) · High Beta Squawk offered as $99/mo add-on |
| **Essential** | **$166.42 /monthly** | 16% off | + Benzinga Edge research ("$199/year value") · Real-Time Scanner · Elite Trading Community · Market Events Calendar · Signals · Insiders · Research · Sensa Market · High Beta Squawk ($99/mo add-on) · **Benzinga AI (NEW)** |

⚠️ **Monthly-billing list prices were not observable.** They render only on toggling to
"Monthly"; a DOM read of the page found **no** monthly figures present (they are fetched or
computed on interaction). I did not interact with the control. The one hard monthly number the
vendor publishes elsewhere: the trial page states *"Cancel Before Day 14 to Avoid Charges, or
Keep Going and Pay **$197/Month** Starting Then"* (3) — i.e. **Essential monthly ≈ $197**.

### Add-ons
- **Unusual Options Activity signal add-on: $27.97 / month**, billed on the subscription
  interval, and subscription coupons apply to it (16) **V**. Rationale published: *"In order to
  develop this signal, we had to purchase additional data, and thus we charge for the add-on."*
- **High Beta Squawk: $99 / month** add-on (2) **V**.

### Free tier and trial
- **Free:** Nasdaq Basic 15-min delayed quotes · BZ Wire newsfeed only, search but **no
  filters** · Watchlist · Movers current session only · Details with key stats · Chart (13) **V**.
- **14-day free trial**, *"Cancel anytime"* (2, 3). Trial users get read-only access to all chat
  rooms and can post only in a Trial Users room (3, 28) **V**.

### Benzinga Edge (bundled into Essential; also sold standalone) (36)
- Normal **$228/year ($19.00/month)**; new-member offer **$129/year ($10.75/month)**, marketed
  as 43% off.
- ⚠️ **Internal inconsistency:** the Pro pricing page values Edge at *"$199/year"* and the Edge
  page's own normal price is **$228/year** (2 vs 36).
- Contents: **Edge Stock Rankings** scoring stocks on **five metrics — Momentum, Growth,
  Quality, Value, Trends** (this is the *"0-100 Proprietary Ranking System"* the Pro pages
  advertise, 2/3); rankings leaderboards; three Top-10 power lists; the "Whisper Index"; two
  model portfolios; Chart-of-the-Day; Government Trade Tracker; Insider Trading Tracker; 10+
  event calendars; a stock screener with *"100+ customizable filters"*; smart calculators;
  Unusual Options Activity; Wall Street Ratings across *"Wall Street's top 1000 analysts"*;
  three weekly research reports; real-time portfolio alerts; unlimited watchlists.

### Model
- **Per-seat, self-serve, credit-card, monthly or annual.** No professional/non-professional
  distinction is published — Nasdaq Basic is redistributed on one licence class with no
  exchange-fee passthrough visible, which is itself informative (**speculated:** consistent with
  a purely non-professional subscriber base).
- **Group licensing exists only as a phone number** (2) — enterprise is not a self-serve motion.
- **Adjacent revenue:** the **API/data business** (37) with SDKs, webhooks, TCP and WebSocket
  feeds, and an explicit `partners@benzinga.com` channel; **Benzinga Research** newsletters and
  trading schools, sold separately and explicitly **not** including Pro (*"Benzinga pro is not
  included with any Benzinga Research subscriptions"*, 21b) **V**; an **affiliate program** (1);
  and **data supply into third-party AI** (43, listing only).
- **Refunds:** 7-day refund window on subscription purchases; monthly renewals non-refundable;
  annual renewals refundable within 7 days of renewal; intro-price offers carry no refund
  window (21b) **V** — note this is documented for the *Research* site and may or may not govern
  Pro; a separate Pro refund-policy article exists (5, article `2136887`, not read).
- **Scale claim:** *"Join 40,000+ traders"* (2, 3) **C**. Social proof: *"Rated 4.5/5 | 155
  reviews"* with **no named review platform** on the page (2).

**Historical anchor (reported).** In December 2020 a r/Daytrading poster described *"$99 p/m for
the basic version of Benzinga Pro, or… the Essential version at $177 p/m"* (37). Against
today's ~$197/mo Essential and $30.58/mo annual-equivalent Basic, the shape of the change is:
**Essential up modestly; the entry tier restructured and cut hard, with a new middle tier
(Streamlined) inserted.**

**CONFIDENCE** 🟢 for every price I read directly, as of 2026-09-02; 🔴 for monthly list prices
on Basic/Streamlined (not observable without interacting); 🟡 for the model inference.
**Ceiling:** toggling the pricing control, or a checkout page, would resolve the monthly rates.

---

## M. Best ideas for UCT (hypotheses, each named to a workflow)

Framed as hypotheses. *"Benzinga does Y"* never implies *"UCT should build Y."*

1. **A published, three-rung editorial importance ladder on the news surface.**
   Benzinga's Low / Mid / High each carry a written definition of what earns that rung (11).
   *Hypothesis:* a member deciding whether to read something acts on a rung faster than on a
   score, **provided the rung's definition is published beside it**. → Workflow **D** ("what
   matters today"), and UCT's Catalyst tile / Morning Wire.
   ⚠️ Benzinga's rungs are **editorially assigned by a newsdesk**. UCT has no newsdesk; the
   honest analogue is a *derived* rung whose derivation is published, not a hand-assigned one.

2. **A one-line "why is it moving", pinned to a fixed slot, allowed to be absent.**
   WIIM renders at the top of Details when present, and the docs state plainly that not every
   stock has one (32, 39). *Hypothesis:* the value is in the **fixed location plus the honest
   blank** — a slot that is sometimes empty is trusted; a slot that is always filled is not.
   → Workflow **A**. UCT's catalyst `thesis_text` is the existing home.

3. **Emphasis decoupled from exclusion.** Colour-highlight a category to raise its salience
   *without* filtering the feed (8). *Hypothesis:* every filter UI should have a "highlight"
   mode, because the real user need is usually *notice*, not *hide*. → Workflows **D**, **F**.

4. **Publish the alert mechanics, including the suppression rules.** Benzinga documents that
   price spikes *"fire at most once every 10 minutes for a given symbol"*, that the threshold
   scales with the stock's average range, and that the day-high/low *Series* variant requires
   ≥3 highs within 2s then 1s of quiet (10). *Hypothesis:* publishing the cooldown and the
   aggregation window converts "why didn't I get an alert" from a support ticket into a
   readable rule. → Workflow **F**; UCT's awareness-engine cooldowns are the direct analogue.

5. **An anti-chatter aggregate as a first-class signal, not a setting.** The "New Day High/Low
   **Series**" ships as its own signal type rather than a checkbox on the noisy one (10).
   *Hypothesis:* naming the quiet variant makes it discoverable in a way a buried debounce
   setting never is. → Workflow **F**.

6. **A streaming feed that advertises its own liveness.** The squawk's green/grey connection
   dot exists specifically so the user is never silently disconnected (12). *Hypothesis:* every
   UCT surface whose failure mode is *silence* (live flow, bars push, squawk-like audio) should
   carry a liveness tell that distinguishes "quiet market" from "dead pipe" — the same
   distinction `CoverageLine` already makes for screens.

7. **A single pre-open page with one-click bucket→watchlist.** The Morning Update's buckets each
   have an "add all these tickers to a watchlist" button (21). *Hypothesis:* the expensive part
   of a morning brief is not reading it, it is **acting on it** — a brief that ends in a
   watchlist has closed the loop. → Workflow **D**; UCT's Morning Wire is the obvious host.

8. **One boolean grammar over tickers *and* keywords, shared by every tool.** `SPY AND
   imbalance` is a *feature* built from a *grammar* (19, 23). *Hypothesis:* a sufficiently
   expressive single bar removes the need to ship a tool for every question — but only if the
   good queries ship **in-product** (see §N.6). → Workflows **A**, **D**, **E**.

9. **Silence as a design default for audio.** *"Reads are only done when breaking news is
   present"* (14). *Hypothesis:* an audio channel that talks constantly gets muted; one that
   only speaks on events gets left on. → any UCT audio/voice surface.

10. **Notes attached to a watchlist row, explicitly framed as a journal** (34). *Hypothesis:*
    the cheapest journal is the one written where the decision is made, not in a separate tab.
    → UCT Journal 2.0 ↔ watchlist bridge. → Workflow **F**.

11. **Ergonomic micro-affordances that cost almost nothing:** `K`/`M`/`B` shorthand in numeric
    filter fields; drag-reorderable columns; right-click → export CSV; multi-select removal
    (30, 33, 34). *Hypothesis:* these are individually trivial and collectively the difference
    between a tool a desk uses daily and one it tolerates.

12. **The link-group colour band, extended to the search bar.** UCT already has A/B/C/D colour
    groups on `/charts`. Benzinga adds two things UCT does not obviously have: a **coloured band
    drawn on the tool's own edge** so group membership is visible without hovering, and the
    ability to **subscribe the search bar itself** to a group (7). → Workflows **A**, **F**.

---

## N. Bad ideas for UCT (things to avoid, and why)

1. **⛔ Persisting workspace layout to browser storage as the default, with manual
   save-to-server as the escape hatch** (29). The vendor documents the failure mode in the same
   breath as the design. UCT's server-side `charts_workspace_layout` is already the right
   answer — **this is a decision worth not revisiting.**

2. **⛔ A hard numeric cap on tools per workspace** (4) with no multi-monitor story (6, 32, 28).
   Whatever its origin, the visible consequence is that a trader who wants five things runs two
   browser windows — and the layout of the second one lives in the same fragile cache.

3. **⛔ Hand-typed rosters and counts beside the lists they describe.** Benzinga does this **four
   separate times**: 6 widgets listed where ≥8 exist (6); *"5 different channels"* above a list
   of 7 (28); 13 vs "12+" vs 19 calendars (33, 2, 37); a tier article missing an entire shipped
   tier (13 vs 2). This is the exact defect class UCT's own CLAUDE.md keeps re-committing. The
   transferable rule is not "count better" — it is **derive the roster from the artifact that
   owns it**.

4. **⛔ Fragmenting a core capability into per-signal add-ons.** UOA at $27.97/mo and High Beta
   Squawk at $99/mo sit **on top of** a $166–197/mo tier (16, 2). The published rationale for
   UOA is honest (data cost, 16) but the effect is a customer who pays $197 and still cannot see
   options flow. → UCT's `tier` is a badge and its FREE_PAGES boundary is coarse-grained;
   *keep it that way* rather than importing a per-signal paywall.

5. **⛔ A derived score with an unpublished derivation.** `sentiment` and `aggressor_ind` ship in
   the options-activity payload with no documented methodology (40); the "0-100 ranking" is
   described by its five input names and nothing else (36); "Sentiment Indicators" is a
   tier-list bullet with no definition anywhere (13). → UCT's exposure rating and COT read both
   publish their arithmetic; a benchmark that does not is evidence for continuing to.

6. **⛔ Shipping the good queries as a PDF.** The boolean bar's best expressions live in a
   downloadable document (23) and in scattered help articles (the SPY MOC recipe, 19). A query
   language whose library is outside the product is half-shipped — the in-product analogue UCT
   already has is the starter-scan library.

7. **⛔ Latency and provenance claims without a measurement.** *"5-15 minutes before mainstream
   sources"*, *"1,000+ sources"*, *"works directly with company insiders"* (2, 3). None carries
   a method, a window, or a date. → UCT's own speed claims should carry the run that produced
   them.

8. **⛔ A competitor comparison table with unsourced prices.** Bloomberg at *"$2,665+"*/mo and
   *"Reuters Workspace"* at *"$1,500+"* (3) — note also that "Reuters Workspace" is not the
   product's current name (it is LSEG Workspace), which is the tell.

9. **⛔ Shipping an AI tier-differentiator ahead of its documentation.** Benzinga AI gates the
   Essential tier and has **zero help-center articles** (5). Squawk, an older feature, has three
   including a network runbook (12, 14). → whatever UCT ships in AI Search / Compass, the
   grounding contract and the support article are part of the feature.

10. **⚠️ (Observation, not condemnation) Embedding a third-party chart engine** (32). Benzinga
    ships TradingView inside Details. It is a defensible build/buy call for a news company. It
    is also why Benzinga can never make the chart the centre of its product — and UCT, which
    owns its chart stack down to the single-writer invariant, has the opposite constraint set.
    Worth noticing as a **fork in strategy**, not copying in either direction.

---

## O. Screenshots / evidence

No images are reproduced. Pointers only.

- **Official screenshots** are embedded inside the help-center articles cited throughout —
  notably the Squawk expanded-icon panel and status dots (12), the Tool-Linking link icon and
  colour band (7), the newsfeed filter menu (11), the Morning Update profile-menu path (21),
  the watchlist alert bell (25), the newsfeed-filter recipe for SPY MOC imbalance (19), and the
  Insiders presets dropdown (18).
- **Official audio sample.** The trial page hosts a playable **Audio Squawk sample** ("Please
  click below to listen to a sample") (3) — the only public artefact that demonstrates the
  squawk's cadence without a subscription. Worth a Wave-2 listen for Workflow D.
- **Official video.** 28 "Tutorial Videos", 8 "1 Minute Tool Tip Videos", 4 "Indicator Videos"
  and 4 "Strategy Outlines" collections in the help center (4, 5). Several articles I attempted
  are **video-only** and returned no text (`4378192` saving-your-layout; `8677400` customizable
  dashboard; `5881466` scanner best practices). **These are the highest-value unread evidence in
  the entire product** — they are official demonstrations of the exact workflows Wave 2 must
  reconstruct. Transcripts were not attempted (budget).
- **Third-party video reviews** (listed for Wave 2 triage, **not used as evidence**): "Benzinga
  Pro Review and Tutorial - Is It Worth Paying For?" (Day Trade Review, 2025-04-01, ~13:43);
  two Modest Money reviews (2025-08-12; 2025-02-26) (43). Modest Money is an affiliate site —
  treat the transcript as demonstration of the UI only, never as assessment.
- **Deliberately excluded as evidence** per the preamble: `daytradingtoolkit.com`,
  `curvedtrading.com`, `investingwithai.com`, `tradersagency.com` "Benzinga Pro Review 2026"
  pages surfaced in search (43) — SEO/affiliate comparison content.

---

## P. Confidence per section

| § | Confidence | Ceiling that applied | What would raise it |
|---|---|---|---|
| A Executive summary | 🟡 | No live-product view | Trial seat |
| B Personas | 🟢 named / 🟡 implied | — | Paid-mix data (never public) |
| C Navigation | 🟡 | Docs describe, I did not operate | Trial seat, or a tutorial-video transcript |
| D Capability map | 🟢 per item / 🟡 completeness | The vendor's own roster is provably incomplete → this map is a **lower bound** | Trial seat; the 28 tutorial videos |
| E Workflows | 🟡 (G: 🟢 absent) | No hands-on run-through | Wave-2 reconstruction from official videos + a seat |
| F Data | 🟢 quotes/OTC / 🔴 latency & source count | Latency is marketing-only | A measured side-by-side vs another wire |
| G Customization | 🟢 | — | Multi-monitor behaviour unobserved |
| H Search / commands | 🟢 grammar / 🔴 absence of a palette | Docs-only absence | Trial seat |
| I AI | 🔴 behaviour / 🟡 existence | **Zero help-center coverage of the flagship AI feature** | Trial seat; an official Benzinga AI demo |
| J UX | 🟢 documented items / 🔴 density & aesthetics | Never saw a pixel | Screenshots; a seat |
| K Performance | 🔴 (WebRTC architecture 🟢) | No measurement taken | Stopwatch on a trial seat; a status page (none found) |
| L Pricing | 🟢 observed / 🔴 monthly list prices | Monthly rates render only on interaction | Toggle the control, or a checkout page |
| M / N Ideas | 🟡 | Hypotheses by construction, not findings | UCT-side testing |
| O Evidence | 🟢 | — | Fetch the video transcripts |

**Overall: 🟡.** The documentation-only reconstruction is unusually complete for its class —
the vendor's own help center is the primary source for ~80% of the substantive claims here, and
the API docs independently corroborate the data catalogue. What is genuinely missing is
**everything that requires seeing it run**: latency, density, responsiveness, the AI's grounding
behaviour, and whether a keyboard layer exists.

**Named ceiling and how to lift it.** `pro.benzinga.com` returned **HTTP 403** to the fetch tool
and the browser tool was **denied read permission** on that host; `www.benzinga.com` and
`help.benzinga.com` were readable. The owner *could* supply a **14-day free trial seat** (2) —
which would lift §C, §I, §J, §K and §L in one move — but a trial requires account creation,
which this role is barred from performing. The cheaper, permission-safe lift is **transcripts of
the 40 official tutorial/tool-tip videos** (4, 5), which are demonstrations by the vendor of the
exact workflows Wave 2 must reconstruct.

---

## What this product would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

Benzinga Pro is a superb **pipe** with almost nothing flowing through it that Benzinga itself
believes. Its Importance rung is a newsdesk editor's opinion; its WIIM is a reporter's sentence;
its "0-100 ranking" is five undisclosed factor scores; its AI answers questions with no
published grounding. Bolt UCT's intelligence onto that pipe and the *pipe* stops being the
product. The Importance ladder would stop being editorial and become **derived from the house
regime and the day's exposure rating** — "High" would mean *high given a UCT exposure of 30 and
a Stage-4 tape*, not *high in general* — and because UCT publishes the arithmetic behind
exposure, breadth and the COT read, the rung would carry its own derivation instead of a
newsdesk's taste. WIIM would stop being one reporter's sentence and become the **catalyst
thesis grounded in named field paths**, with the honest blank preserved: UCT already refuses to
render a number it cannot compute, which is precisely the discipline a "why is it moving" slot
needs. The Signals taxonomy — genuinely good mechanics, published cooldowns and all — would fire
against the **UCT20 book, the model-book setup library and the member's own journal**, so a
price spike on a name the desk owns at a known stop is a different alert from the same spike on
a name nobody holds. Movers would carry the **house regime banner** and the setup grade rather
than a bare % change. The scanner's fifty generic ratios would be joined by the firm's actual
edge — ADR, distance from the 20EMA, pole, base stage, the candle score — and the strategy
articles Benzinga ships as help-center folklore would ship instead as **editable starter
definitions inside the product**. And the AI, instead of promising it "knows why NVDA dropped",
would answer through `grade_ticker`'s structural verdict: regime first, every number
tool-sourced, decisive by construction, with the refusal path intact. The honest inverse is
worth stating too, because it is the actual lesson for TERMINAL-NEXT: **UCT already has the
intelligence and lacks Benzinga's pipe** — the sub-second wire, the human squawk, the
1,000-source ingest, the newsroom you can chat with. Benzinga's twelve years of newsroom
infrastructure is not a feature UCT can decide to have, and the useful reading of this dossier
is that TERMINAL-NEXT should compete on the half Benzinga cannot buy, not the half it already
owns.

---

## GAPS (budget not reached / not reachable)

1. **The running product was never observed.** `pro.benzinga.com` → HTTP 403 via WebFetch;
   browser read-permission denied for that host. No screenshots, no timings, no keyboard probe.
   **This is the dossier's dominant ceiling.**
2. **`WebSearch` was unavailable** (shared session cap exhausted before this role started, per
   the preamble). **Channels actually used:** (a) WebFetch on known URLs — worked for
   `docs.benzinga.com`, Wikipedia, `theindustryspread.com`, `bing.com`; **blocked (403)** for
   all `benzinga.com`, `help.benzinga.com` and `benzingapro.zendesk.com` hosts; **blocked**
   for `reddit.com` ("unable to fetch"). (b) Browser in ONE tab (created, used, **closed**) —
   worked for `www.benzinga.com`, `help.benzinga.com`, `bing.com`, `reddit.com/*.json`;
   `pro.benzinga.com` read-denied. (c) Google/Reddit navigation permission **fluctuated
   mid-session** (two batches failed with "Navigation to this domain is not allowed" on hosts
   that had worked minutes earlier, then worked again) — I fell back to Bing.
3. **Queries I could not run:** Trustpilot/G2/Capterra review corpora (the pricing page's
   *"4.5/5 | 155 reviews"* names no platform, so the corpus is unidentified); r/Daytrading and
   r/options **comment** bodies (only post bodies were retrievable before reddit navigation was
   blocked, n≈6 posts); any query needing `WebSearch`'s ranking.
4. **Monthly (non-annual) list prices for Basic and Streamlined.** Not present in the DOM; they
   render on toggling the Annual/Monthly control. I did not interact with the control. Only the
   annual-equivalent monthlies and the trial page's "$197/Month" are established.
5. **~84 help-center articles unread** of the 119 in the inventory (5) — including the Pro
   refund policy (`2136887`), GAAP/non-GAAP (`6891893`), broker linking (`6173869`), beats/misses
   highlighting (`6843200`), UOA calendar filters (`5076988`), and the entire "Multi-leg Option
   Strategies" and "Strategy Outlines" collections. Budget.
6. **All 40 official video assets unwatched and untranscribed** (28 tutorials + 8 tool-tips +
   4 indicator videos). Three articles returned "no text content" because they are video-only.
   **Highest-value remaining evidence.**
7. **Benzinga AI has no primary documentation of any kind** — not a gap in my search, a gap in
   the vendor's corpus (measured against the full sitemap). §I is 🔴 by necessity.
8. **UOA `sentiment` / `aggressor_ind` methodology** requested from the API docs and **not
   published** (40). The fundamentals vendor is likewise undisclosed (my Morningstar guess is
   labelled speculated).
9. **No SOURCE HANDLING incidents to report.** Nothing in the ~45 pages read contained text
   directed at the reader as instructions, prompt-injection, or attempts to redirect this task.
   The only text worth flagging as *rhetoric rather than fact* is ordinary marketing copy —
   *"works directly with company insiders"*, the unsourced competitor price table, and
   *"Benzinga AI is trained on market data"* — all recorded above as **claimed**, none acted on.

---

## SOURCES

Tiers per the preamble's hierarchy. All fetched **2026-09-02**.

**Official product / marketing pages (Tier: official product pages & pricing)**
1. Benzinga Pro overview — https://www.benzinga.com/pro/ — *claimed*
2. Benzinga Pro pricing — https://www.benzinga.com/pro/pricing/ — *claimed / prices verified as displayed*
3. Benzinga Pro free-trial page — https://www.benzinga.com/pro/register/ (resolves to `/pro/register-1`) — *claimed*
36. Benzinga Edge — https://www.benzinga.com/edge — *claimed / prices verified as displayed*

**Official help center (Tier: official documentation / help centers)** — all under `https://help.benzinga.com/en/`
4. Help Center home (11 collections) — `/`
5. Help Center sitemap — https://help.benzinga.com/sitemap.xml — **the complete article inventory: 119 articles + 11 collections, with lastmod dates**
6. What is a Widget? — `/articles/1769521-what-is-a-widget`
7. Tool Linking — `/articles/6792965-tool-linking`
8. Getting Started: Newsfeed — `/articles/1413278-getting-started-newsfeed`
10. Signals: What's That? — `/articles/2568655-signals-what-s-that`
11. How Do I Filter My Newsfeed? — `/articles/1769530-how-do-i-filter-my-newsfeed`
12. What Is Squawk and How Do I Use It? — `/articles/2106004-what-is-squawk-and-how-do-i-use-it` (lastmod 2026-01-16)
12b. Screener Variables Cheat Sheet — `/articles/3322626-screener-variables-cheat-sheet`
13. What is the difference between subscription levels? — `/articles/2067149-...` (lastmod 2024-05-13 — **stale: omits the Streamlined tier**)
14. Squawk tips and troubleshooting — `/articles/3521474-squawk-tips-and-troubleshooting` (lastmod 2025-02-26)
15. Real-Time Quotes: Nasdaq Basic — `/articles/2597103-real-time-quotes-nasdaq-basic`
16. Unusual Options Activity Add-on — `/articles/4797494-unusual-options-activity-add-on`
17. What is the BZ Wire? — `/articles/1419321-what-is-the-bz-wire`
18. Insiders Tool Help Documentation — `/articles/8125463-insiders-tool-help-documentation`
19. How do I find SPY MOC Imbalance data in Pro? — `/articles/6161669-...`
20. Is There a Benzinga Pro App? — `/articles/2221758-is-there-a-benzinga-pro-app`
21. Benzinga Morning Update — `/articles/11173560-benzinga-morning-update` (lastmod 2025-05-07)
21b. Research Site FAQ — `/articles/7242187-research-site-faq` (lastmod 2025-12-09)
22. How Much is Benzinga Pro? — `/articles/2067197-how-much-is-benzinga-pro` (lastmod 2025-12-09)
23. Keyword Searches: What Makes a Good Search Term? — `/articles/2221714-...`
25. How Do I Set Up Watchlist Alerts? — `/articles/2318473-...`
26. How Do I Live Chat With the Benzinga Newsdesk? — `/articles/2190512-...`
27. What does the "Importance" column in the calendar mean? — `/articles/5671950-...`
28. Benzinga Pro Chat — `/articles/2218011-benzinga-pro-chat`
29. Why Aren't My Workspaces Saving? — `/articles/2463416-...`
30. Getting Started: Scanner — `/articles/5149791-getting-started-scanner`
31. Getting Started: Movers — `/articles/2017151-getting-started-movers`
32. Getting Started: Details — `/articles/1413286-getting-started-details`
33. Getting Started: Calendar — `/articles/1413267-getting-started-calendar`
34. Getting Started: Watchlist — `/articles/3475187-getting-started-watchlist`
35. Benzinga Pro General Troubleshooting Tips — `/articles/3779904-...`

*(Article 9 in an earlier numbering was merged into 12; 24 into 23. Numbering is stable as
printed above — this list is the authority, not the in-text ordering.)*

**Official developer documentation (Tier: official APIs / developer docs)**
37. Benzinga API complete documentation index — https://docs.benzinga.com/llms.txt — *verified*
38. Benzinga API FAQ — https://docs.benzinga.com/introduction/faq.md — *verified*
39. WIIMs overview — https://docs.benzinga.com/api-reference/news-api/wiims/overview.md — *verified*
40. Unusual Options Activity endpoint — https://docs.benzinga.com/api-reference/calendar-api/get-optionactivity.md — *verified*

**Vendor press release (Tier: company announcement, carried by a trade outlet)**
41. "Benzinga Partners With WNSTN To Power Benzinga AI Across Its Platform", 2025-06-24 —
    https://theindustryspread.com/benzinga-partners-with-wnstn-to-power-benzinga-ai-across-its-platform/
    — *claimed*. (The PR Newswire original was 404 at the URL pattern I tried; the same release
    also appears on Global Banking & Finance Review and Insider Monkey per 43.)

**Practitioner / community (Tier: high-quality community discussion)**
37b/42. r/Daytrading search results (post bodies), retrieved via
    `https://www.reddit.com/r/Daytrading/search.json?q="Benzinga Pro"&sort=top&t=all` —
    *reported*. Threads referenced: "$400k+ profit, 20,000% account growth in 1.5 years
    daytrading" (`/r/Daytrading/comments/rrxxxx`, the published tool-stack list, 2022-01-02);
    "Does anyone have/use Benzinga Pro? Looking for opinions"
    (`/r/Daytrading/comments/k63afr/`, 2020-12-03, 28 comments — **post body only; comments not
    retrievable**); "Source of news whilst trading"; "For trading on news catalyst, is Benzinga
    pro the best?" (`/r/Daytrading/comments/ju4smw/`); "Just started, some resources I've found
    helpful"; "What's the best black Friday deal for software?".

**Discovery only — not used as evidence**
43. Bing search-result listings (used to locate the WNSTN release and to enumerate third-party
    video reviews). Affiliate/SEO review sites surfaced there
    (`daytradingtoolkit.com`, `curvedtrading.com`, `investingwithai.com`, `tradersagency.com`)
    were **deliberately not read or cited**, per the preamble's evidence standard.
44. Wikipedia search for "Benzinga" — https://en.wikipedia.org/w/index.php?search=Benzinga —
    **no article exists**; recorded so nobody re-runs it for founding/ownership facts.
