---
id: B-KOY-01
title: Koyfin — benchmark product dossier
role: benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: Koyfin (prosumer / advisor research & analytics platform, web + mobile)
confidence: 🟡
evidence_ceiling: "No hands-on account and no logged-in session. Everything below is reconstructed from Koyfin's own help center, pricing page, marketing pages and release notes, plus one anonymous public render of the pricing page. Nothing about rendered latency, in-app information density, or actual screen composition is verified. Practitioner sampling is thin: the shared WebSearch budget was exhausted before this role ran, Reddit's JSON API refused a scripted fetch, and Bing served a captcha (not solved). Raising it would take: a 7-day trial account driven by the owner, or one recorded practitioner walkthrough."
sources: 47 primary (official Koyfin domains); 3 secondary (search-result aggregation, one third-party directory read via snippet)
uct_relevance: high
status: draft
date: 2026-09-02
---

# Koyfin — benchmark dossier (B-KOY-01, first draft)

**Scope note for later readers.** This dossier is the Wave-1b first draft. A workflow
reconstructor (Wave 2) is expected to take Section E five workflows deep, and a verifier
follows. Every claim carries a URL and the date it was fetched (all fetches: **2026-09-02**).
Claims are labelled **verified** (read in Koyfin's own documentation), **claimed**
(Koyfin marketing about itself), **reported** (third party), or **not determined**.

Two vocabulary reminders for the program: the existing UCT `/calendar` surface is
**TERMINAL-CURRENT**; the thing being designed is **TERMINAL-NEXT**. Nothing in this
dossier is a requirement — "Koyfin does Y" never means "UCT should build Y".

---

## A. Executive summary

**OBSERVATION.** Koyfin is a browser-first (plus iOS/Android) research and analytics
platform that sells the *analysis layer* of a terminal — global fundamentals, consensus
estimates, macro series, screening, dashboards, portfolios and client reporting — while
deliberately declining to sell the *execution layer*: no order routing, no options chain,
no bid/ask, no minute or hourly candles, no API. Its self-declared audience has drifted
over the last two years from "individual investor priced out of Bloomberg" toward
"independent financial advisor who needs client-ready analytics and reports."

Its stated positioning is *"A modern investment platform for advisors and investors."*
and its mission is *"To equip every investor in the world, no matter their size, with the
best data and tools; empowering them to achieve more."* [S1, official homepage, verified]

**The product's apparent PHILOSOPHY, in one sentence:** *depth of durable data, arranged
by the user, reachable in two keystrokes — and explicitly not the tape.*

Three things make that sentence load-bearing rather than decorative:

1. **"Not the tape" is a written product decision, not an omission.** Koyfin's own
   comparison content lists as Cons: *"Not designed for active traders"*, *"No options
   data"*, *"No bid/ask spreads"*, *"No Excel plug-in"*, *"End-of-day prices for stocks
   outside the US and Canada"* [S46, official blog, 2026-01-22, claimed-about-self]. The
   charting help says plainly *"we don't currently support minute or hourly candles"*
   [S14, official help, verified].
2. **"Arranged by the user" is the interface.** Dashboards, watchlist views, financial
   analysis templates, chart templates and custom formulas are all first-class saved
   objects — and each can be given a **user-invented keyboard shortcut** [S8, verified].
3. **"Two keystrokes" is the navigation model.** `/` opens a command bar whose grammar is
   *ticker → function → enter* [S7, verified].

**Who it serves, in Koyfin's own words:** financial advisors; investment research teams
and CIOs; individual/independent investors; asset managers; equity research; schools and
universities [S1, verified].

**CONFIDENCE 🟢** on positioning and philosophy (all primary, all first-party).
**RELEVANCE TO UCT.** Koyfin is the closest public analog to the *research half* of
TERMINAL-NEXT and an explicit non-analog to the *desk half*. It is the cleanest available
demonstration that a research workstation can be excellent while being useless intraday —
which is exactly the trade TERMINAL-NEXT must not make, since the primary persona is a
desk that trades US equities and options during the session.

---

## B. User types / personas served

**OBSERVATION.** Six named audiences on the homepage, and the product has two distinct
price ladders behind them: an *investor* ladder (Free / Plus / Premium) and an *advisor*
ladder (Advisor Core / Advisor Pro), plus a custom **Teams** tier [S1, S2, verified].

| Persona (Koyfin's label) | What the product gives them | Ladder |
|---|---|---|
| Individual / Independent Investors | Watchlists, dashboards, screener, graphing, transcripts | Free → Plus → Premium |
| Asset Managers, Equity Research | Financial Analysis templates, percentile ranks, custom data | Premium |
| Financial Advisors | Model portfolios, client portfolios, proposals, reports, custodian integrations | Advisor Core / Pro |
| Investment Research Teams & CIOs | Shared watchlists + model portfolios with Viewer/Editor roles | Teams |
| Schools & Universities | (Student discount FAQ exists) | — |

**EVIDENCE.** [S1] homepage persona list; [S2] pricing ladder; [S31] Teams roles;
[S43-adjacent] a "Can I get a discount as a student?" FAQ exists in the help index [S5].
All verified, 2026-09-02.

**INTERPRETATION.** The release history is the tell about where the company actually
lives now. Of the ~14 most recent numbered releases (v3.84 → v3.97), the large majority
are advisor-side: *Reports section*, *Report Sharing*, *A new way to organize Client
Portfolios*, *Exporting Reports in Bulk*, *Editing Custom Holdings in Client Portfolios*,
*Matching your account structure to an integration*, *Short Positions in My Portfolio and
Client Portfolios*, *Contribution in Model Portfolios*, *Risk Statistics* [S44, verified].
The investor-facing surfaces (charting, screener, command bar) are mature and being
maintained, not extended. **Koyfin's centre of gravity has moved to the RIA.**

**RELEVANCE TO UCT.** UCT's persona order is inverted (desk first, members second), and
its members are active traders, not advisors reporting to clients. The transferable part
of Koyfin's persona work is the *research analyst* slice, not the advisor slice — but the
advisor slice is a live warning about what happens to a prosumer product's roadmap once a
higher-ARPU segment appears.

**CONFIDENCE 🟢** (persona list and price ladder are primary). **🟡** on the "centre of
gravity moved" reading — it is inferred from release titles, not stated.

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT ever grows a higher-ARPU adjacent
persona, the roadmap will bend toward it by default; deciding *in advance* which surfaces
are frozen-for-the-desk would keep that bend from being silent.

**OPEN QUESTION.** Is the investor ladder still growing, or is it now a funnel into the
advisor ladder? (Answerable from a year of release notes with dates — the release index
did not render dates in this fetch.)

---

## C. Navigation: how users move

**OBSERVATION.** Three concentric navigation mechanisms, in increasing order of speed.

1. **Left navigation** — the persistent section menu (customizable since v3.87,
   *"Customizable Left Navigation"* [S44, verified]).
2. **Right sidebar** — a monitoring rail holding *"watchlists, movers and news which you
   can open and close by clicking on the icons"*, with two density modes (*"Tickers and
   Company Names, or a more compact view of only Tickers"*) and a per-watchlist field
   selector. Crucially, it is a **launcher**: *"click on the securities in the right
   sidebar to load them into Koyfin functions like Snapshot (S), Estimates (EST) or
   Graph (G)"* [S9, official help, verified].
3. **Command bar** — `/` opens it, `Esc` closes it, and the grammar is *ticker →
   function → enter* [S7, verified].

**EVIDENCE.** [S6] getting-started; [S9] right-sidebar; [S7] command-bar-search. All
official help center, verified 2026-09-02.

**INTERPRETATION.** The right sidebar is doing a job UCT currently splits across
`MoversSidebar`, the watchlist widget and the tape tile: it is one always-present rail
that both *monitors* and *dispatches*. The dispatch behaviour is what makes it more than
a ticker list — a click there re-targets the main pane's current function.

**RELEVANCE TO UCT.** TERMINAL-NEXT will need to decide whether its monitoring rail is a
read-only glance or a launcher. Koyfin's answer (launcher) is the one that pays for the
pixels.

**CONFIDENCE 🟢** on the mechanisms; **🔴** on how they *feel* — no session was run.

**RECOMMENDATION (hypothesis).** A persistent right rail whose rows *retarget the active
pane* (rather than opening a modal) is a cheaper interaction than UCT's current
popup-per-ticker idiom for the "walk my universe" workflow.

**OPEN QUESTION.** Does the right sidebar retarget the whole page or only the
colour-group it belongs to? (The grouping doc suggests groups govern widgets; the sidebar
may be outside the group system.)

---

## D. Capability map (Part XIII taxonomy)

Each row: what exists, the evidence, and the honest gap.

| Taxonomy area | Koyfin | Status |
|---|---|---|
| **Market overview** | Market & macro dashboards; Movers (`MOV`); Markets News sections; Global Yields / Yield Curves / Currencies dashboards at `app.koyfin.com/gyld` with Table, Graph and **Matrix** widgets [S30] | verified |
| **Security pages** | Snapshot (`S`), company overview, percentile-rank snapshot, dividend snapshot, ETF exposure/holdings/valuation, insider ownership & transactions (v3.82, v3.96) [S17, S44, S45] | verified |
| **Fundamentals** | Financial Analysis (`FA`) with **300+ metrics** and user-built templates; ROIC; growth rates; adjusted vs unadjusted prices; ~150+ defined items in the data dictionary [S19, S35, S45] | verified |
| **News** | **MT Newswires** premium feed; sections Top News (incl. finance tweets) / Global Markets / Corporate Events / Industries / Macro / World Economy (200+ countries) / Newsletters / Analyst Changes; **custom news screens from "over 700 topics"**; company news with *Customize Sources* and *Highlight Terms*; Article Topics (Premium) [S27, S28] | verified |
| **Earnings** | Earnings calendar (`app.koyfin.com/earc`) filtered by *"major indices, ETF holdings or your watchlists"*, 90-day forward or trailing, forward shows *Wall Street average estimates* + highs/lows, trailing shows reported + *"percentage surprise vs. average estimate"*; export to *"Google or Outlook events"*; historical estimates/actuals/surprises (v3.81); actuals `A` vs estimates `E` notation, consensus average + **number of contributing analysts** + median/high/low [S20, S21, S22] | verified |
| **Economic** | Economic calendar with country + time-zone selectors; *"All widgets in the economic calendar are interactive"* — click an event for consensus + previous with an inline `G` chart; FRED tickers usable directly; Trading Economics [S22, S34, S36] | verified |
| **Screening** | **5,900+ filter criteria** over **100K+ global securities**; min/max entry with the universe's own min/max shown in grey; results push to a new or existing watchlist; table views importable from watchlists; CSV export (with a vendor carve-out); mutual-fund screener (Advisor Core), SMA screener (v3.79), ETF screener (Plus) [S16, S2, S44] | verified |
| **Charting** | Historical Graph (`G`): Line, Candles, OHLC Barchart, Area; 300+ fundamental series plottable beside price; moving averages; volume overlay; **annotation tools with CTRL+C / CTRL+V copy-paste**; Group Axis ON/OFF; log/linear; chart templates with shortcuts. **Daily minimum bar** — *"we don't currently support minute or hourly candles"* [S14] | verified |
| **Alerts** | Price, **Valuation**, **Technical indicators**, and **Documents** (press releases, news, earnings transcripts, filings). Created from a *"My Alerts"* button in any quote box or by right-clicking a ticker cell in a table. Delivered to *Desktop* (bell in right sidebar), *Email*, *Mobile Push*, each toggleable [S26, v3.66, published 2025-06-19] | verified |
| **Portfolio / watchlist** | My Portfolios (manual, CSV by ticker **or ISIN**, lots via *"+ Add Lot"*, cash + cash weighting, P/L split into *P/L (excl. FX)* / *P/L (from FX)* / *Total Return*, Exposure by security/sector/industry/asset class/country); My Watchlists (columns, groups, summary rows, views, news, sharing) [S29, S10, S11] | verified |
| **Documents** | Transcripts (`TS`) for *"9000+ public companies across the world going back to 2004"*, covering earnings calls, shareholder/analyst calls, conferences, summits, presentations, **M&A calls** and investor days, with participants grouped executives vs sell-side; filings; press releases; **Advanced Search across the entire transcript library** [S23, S24] | verified |
| **Collaboration** | Teams: shares **watchlists and model portfolios** with **Viewer / Editor** roles and admin role management; watchlist sharing; model-portfolio sharing; report sharing (v3.85); sharing in My Graphs (v3.89) [S31, S44] | verified |
| **AI** | **Transcript Summaries only** (v3.69, published 2025-09-18) — see Section I. No assistant, no chat, no grounded search. | verified |
| **Command / keyboard** | `/` command bar; function codes `G` `EST` `HDS` `MOV` `GM` `S` `TS` `FA` `MYW` `MP`; `/COMMAND` direct jump; **user-assignable shortcuts on saved chart templates, dashboards and FA templates** [S7, S8] | verified |
| **Workspaces** | My Dashboards (`MYD`) with Table/Watchlist, Historical Graph, Performance Graph, Scatter Plot and News widgets; drag-to-move, resize; blank or template start; **7 colour groups** linking widgets [S12, S13] | verified |
| *Absent by design* | Options data · bid/ask · order routing · Excel plug-in · public API · intraday bars · real-time ex-US [S46, S38, S14, S37] | verified (self-stated) |

**CONFIDENCE 🟢** on presence/absence of each capability. **🟡** on depth within each —
help articles describe features, not ceilings.

**RELEVANCE TO UCT.** The row that matters most is **Alerts**. Koyfin alerts on *document
arrival* — a filing, a press release, a transcript appearing — as a peer of price. UCT's
alert vocabulary today is price and catalyst; "this name just filed something" is a
different, cheap, and highly desk-relevant primitive.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five in depth

### A. "Why is this stock moving?"

**Path.** Right sidebar Movers (or `/MOV`) → click the name (retargets the main pane) →
`S` Snapshot for the daily move → *News, Filings & Transcripts* → company News with
*Highlight Terms* → press releases. Watchlist News surfaces *"articles, press releases,
filings, and transcripts"* in real time against a list [S10].

**What's missing, precisely.** The move itself cannot be examined below a daily bar
[S14]. There is no volume-vs-ADV framing documented, no options flow, no bid/ask, no
tape. For US names the price is *"a combination of live data and 15-minute delayed data"*
[S37] — so even the number on screen may be a quarter-hour old, and the doc does not say
which names are which.

**CONFIDENCE 🟡** (path assembled from four help articles; not observed end-to-end).

### B. "Prepare me for earnings"

**Path.** `earc` earnings calendar filtered to a watchlist / index / ETF constituents,
90 days forward → per name: `EST` for consensus average, analyst count, median/high/low,
with `A`/`E` period notation → historical actual-vs-consensus surprise (v3.81) → `TS`
transcripts back to 2004, with a **structured summary** for anything dated 2015 onward →
press releases → calendar reminder exported to Google/Outlook. [S21, S20, S23, S25, S22]

**Assessment.** This is Koyfin's second-strongest workflow and is genuinely deep on the
*estimate* and *transcript* axes. **What is missing is the trade:** no expected/implied
move, no options positioning, no historical gap statistics, no live call audio or slide
deck (that is Quartr's territory), and no post-print reaction surface.

**CONFIDENCE 🟢** on the pieces, **🟡** on the sequence.

### C. "Research this company from scratch"

**Path.** `/` + ticker → `S` snapshot → `FA` financial analysis on a saved template of
the user's own 300+-metric selection → percentile ranks (vs sector, country, region,
global, **and vs the stock's own 10-year and 20-year history**) → `EST` → `TS` +
Advanced Search for the specific question → filings → `G` charts of any fundamental
series against price. [S19, S17, S20, S24, S14]

**Assessment.** The strongest workflow in the product, and the percentile-rank layer is
the part a competitor would struggle to copy quickly. **Missing:** you cannot export the
financials you just built (vendor restriction, Section F), there is no AI Q&A over the
documents, and there is no Excel path out.

**CONFIDENCE 🟢**.

### D. "What matters today"

**Path.** Markets News category sections + custom news screens from 700+ topics → right
sidebar movers → macro/market dashboards → economic calendar.

**Assessment.** Curated by *category*, not ranked against *your book*. Watchlist News and
document alerts are the personalised half, but there is no documented synthesis —
nothing tells the user "these three of your holdings are why today matters."

**CONFIDENCE 🟡** — absence of a synthesis surface is inferred from its absence in the
help taxonomy [S5, S45], which is strong but not proof.

### E. "Find a trade"

**Path.** `My Screens`: 5,900+ criteria, min/max, save, push results into a watchlist,
inspect on a scatter plot with percentile-rank axes. [S16, S17]

**Assessment.** This finds *candidates*, not *trades*. There is no entry, no stop, no
target, no backtest, no intraday scan, and no setup taxonomy. The screener's technicals
are listed among filter categories but not enumerated.

**CONFIDENCE 🟡**.

### F. "Monitor my universe"

**Path.** Watchlists with saved Views (columns + sorts + groups + summary rows) → the
same views rendered as dashboard widgets → 7 colour groups linking widgets so selecting
in one drives the rest → alerts on price / valuation / technicals / documents delivered
to desktop, email and mobile push → Watchlist News. [S10, S11, S13, S26]

**Assessment.** **Koyfin's strongest workflow, and the one most worth studying.** It is
the only one where every surface composes: a view is portable, a group is a wire, an
alert is a document-aware tripwire, and mobile push closes the loop when the user is away.

**CONFIDENCE 🟢**.

### G. "Understand the regime"

**Path.** Global Yields / Yield Curves / Currencies dashboards (`gyld`) with a **Matrix
widget** giving *"a comprehensive global view of the market"*; FRED + Trading Economics
series plottable in `G`; Relative Strength (A/B ratio) and Relative Spread (%A − %B)
charts via the colon syntax; `GM` normalized performance. [S30, S15, S7]

**Assessment.** Strong on **macro** regime (rates, curves, FX, cross-country economics).
**Absent** on *market-internals* regime: no breadth engine, no advance/decline, no new
highs/lows, no distribution-day counting, no positioning (COT), no dealer gamma, no
volatility surface. Koyfin's regime is an economist's regime, not a tape reader's.

**CONFIDENCE 🟢** on what is present; **🟡** on the absences (inferred from the full help
taxonomy, which does list every functional area).

**RELEVANCE TO UCT (all seven).** Workflows C, F and G-macro are where Koyfin beats what
UCT has. Workflows A, D, E and G-internals are where UCT already has assets Koyfin cannot
match (breadth rails, COT, options flow, dark pool, the wire). **The complementarity is
almost exact**, which is the single most useful fact in this dossier.

---

## F. Data: coverage, vendors, latency, history

**OBSERVATION — vendors (disclosed).** Koyfin names six of what it says are *"license
agreements with over a dozen data vendors"*: **S&P Capital IQ** (*"global equity
fundamentals, consensus estimates and valuation"*), **Morningstar** (fund data), **FRED**,
**Trading Economics**, **True FX**, **Polygon** (crypto) [S36, official FAQ, verified].

**OBSERVATION — latency.** *US stocks:* *"the price data is a combination of live data and
15-minute delayed data"*. *Canada:* 15 minutes delayed. *All other countries:*
**end-of-day** [S37, verified]. Separately, live index prices are **CFD-derived**: *"We
use CFD (contract for difference) prices for indices like SPX, Nasdaq and Dow Jones which
means the prices you see on Koyfin will be slightly different than the index price you see
on sites like Yahoo finance"* — historical uses official closing prices [S40, verified].

**OBSERVATION — asset classes.** Global equities; US ETFs; US and Canadian mutual funds
(*"over 20K Canadian-based mutual funds"*); equity indices; futures (limited front-month);
FX (60 pairs plus bitcoin); government bonds across **45 countries** with yield curves for
**20 countries**; global economic data *"spanning every country"*; 15-minute delayed
intraday for all US-based closed-end funds [S34, verified].

**OBSERVATION — history depth (tier-gated, which is unusual and notable).** The *plan*
sets the history: Free = *"2Y financials & 1Y estimates"*; Plus and above = *"10Y
financials & 10Y estimates"* [S2, verified]. Estimates documentation says actuals reach
back to **2012** and projections extend to **2032**, *"with access levels varying by
subscription tier"* [S20, verified]. Transcripts reach back to **2004**; transcript
*summaries* only to **2015** [S23, S25, verified].

**OBSERVATION — extraction.** No API: *"We don't allow users to get data via API because
of restrictions from our data providers"*, followed by the strategic sentence *"They are
in the API business. We are in the analytics business."* [S38, verified]. Downloads are
partial: price, performance, technicals, percentile ranks, model portfolios, economic and
fund data can be exported; but *"Financials, Estimates, and Valuation data for global
equities are currently restricted from download by our data vendor, in tables and charts"*
[S39, verified]. Charts may be republished externally with attribution: *"Please source
Koyfin and include a link to Koyfin"* [S42, verified].

**INTERPRETATION.** Koyfin's data posture is *rented depth, sold as a view*. Its moat is
S&P Capital IQ fundamentals it cannot let you take with you. That constraint explains
three otherwise-odd product facts at once: no API, no Excel plug-in, and download carve-
outs that read as arbitrary until you know whose licence they protect. **The vendor's
contract is visible in the product's shape.**

**RELEVANCE TO UCT.** UCT's data position is the mirror image: Massive/Polygon bars,
Finnhub, FMP, CFTC, plus a *proprietary* layer (breadth history, COT rails, the KB,
options flow, the model book) that no vendor can revoke. TERMINAL-NEXT can therefore make
promises Koyfin structurally cannot — export, an internal API, reproducible receipts —
and should treat that as a positioning asset rather than plumbing.

**CONFIDENCE 🟢** (every claim is first-party FAQ text). **Ceiling:** total security
counts and per-asset history depth are not published; the data-coverage page gives
categories, not totals [S34].

**RECOMMENDATION (hypothesis).** Publishing latency *by asset class and geography* in
plain language, the way Koyfin's "Is your data live or delayed?" FAQ does, would cost UCT
one page and pre-empt the most common member misread of a delayed number.

**OPEN QUESTION.** Which US names get live data and which get the 15-minute feed? The FAQ
says "a combination" and never resolves it — a user cannot tell from the UI. This is a
genuine trust defect worth studying as an anti-pattern.

---

## G. Customization

**OBSERVATION.** Five independently saveable, independently shortcut-able object types.

1. **Dashboards (`MYD`).** Widgets: *Table/Watchlist*, *Historical Graph*, *Performance
   Graph*, plus *Scatter Plot* and *News*. *"Resizable and you can drag widgets around in
   the dashboard"*; tickers can be dragged from a table widget straight into a graph.
   Start blank or *"load a customized template with widgets selected"* [S12, verified].
2. **Dashboard colour groups — the standout.** *"7 colour groups"*; assign from the upper
   left of a widget header; new widgets default to blue. *"Once you select or add a
   security in one component, it updates the other components in this group."* And the
   part UCT does not have: a group carries **one of three selection methods** — *"Single
   Security — load one ticker at a time, Multiple Securities — load a group of tickers,
   My Watchlists — load ticker(s) from a specific watchlist"* — and changing the method in
   one widget changes it across the group. Table + the three graph widgets support single
   and multiple; Scatter Plot and News support all three [S13, verified].
3. **Watchlist Views.** A view saves *"columns, summary rows, currency, or grouping &
   sorting options"*, is *"synced with My Dashboards"*, and can be transferred onto
   screener results. Caveat, stated: *"formulas and custom columns will not be imported
   when importing an existing view"* [S11, verified].
4. **Financial Analysis templates.** `+New` → `+New Group` (e.g. "Revenue Metrics") →
   `+Data Series` from 300+ metrics; right-click for rename, font size, bold/italic,
   indentation, conditional colouring; decimals, units (millions/billions), period and
   currency conversion. Explicit warning: *"Once you've created or changed your template,
   make sure you **save** it since it isn't saved automatically"* [S19, verified].
5. **Custom formulas.** Arithmetic and parentheses over metric slots (*"A\*2 — where A
   stands for Last Price multiplied by 2"*), rendered as watchlist columns with formats
   Number / Percentage / Multiple / Basis Points / Currency. Tiered: Free *"limited to
   only 1 custom calculation per watchlist"*, Plus *"up to 10 calculations"*, Premium
   *"unlimited number of any custom columns"* [S18, verified].

**Watchlist-level customization** additionally includes custom groups created by typing
`*` before a name (e.g. `*Longs`), multi-variable *advanced sort*, per-column
right-click rename/sort/remove, drag-reorder of both rows and list tabs, bulk *Import
Securities* by paste, and summary rows showing *"average, max, min, percentiles, etc."*
that respect the active grouping [S10, verified].

**Multi-monitor:** not documented. **Not determined.**

**INTERPRETATION.** Koyfin's customization model is *objects + shortcuts*, not
*preferences*. The user does not tune a page; they mint a named thing and give it a verb.
That is a materially different mental model from UCT's `usePreferences`-blob approach and
is why a Koyfin power user can reach a bespoke 40-metric fundamentals page in four
keystrokes.

**RELEVANCE TO UCT.** UCT's `/charts` workspace already has colour groups (A/B/C/D) and
persisted layouts in `charts_workspace_layout`. Koyfin's version is the same idea, two
steps further: **seven** groups, and a group that can carry a **list** rather than a
single symbol.

**CONFIDENCE 🟢** on mechanics; **🔴** on multi-monitor and on how many objects a heavy
user actually keeps.

**RECOMMENDATION (hypothesis).** Making a UCT colour group's payload *polymorphic* —
symbol, symbol-set, or named watchlist — would let one workspace drive a whole scan
result through a widget set, which is the "monitor my universe" workflow the desk runs
every morning.

**OPEN QUESTION.** Does a Koyfin dashboard remember its group's selection-method per
widget or per group when reloaded? (The doc hints at a manual-override exception for *My
Watchlists*, which suggests a real conflict case they had to special-case.)

---

## H. Search / commands

**OBSERVATION — the grammar.** `/` opens the command bar; `Esc` closes. The documented
form is **ticker → function → enter**. Examples given: `G` price charts, `EST` estimates,
`HDS` holdings, `MOV` movers, `GM` normalized performance, `S` snapshot, `TS` transcripts,
`FA` financial analysis, `MYW` watchlists, `MP` model portfolios. A user can also *"search
by page name (e.g., 'Overview')"* rather than memorising a code, and can jump straight to
a function with `/MOV`-style direct syntax [S7, S8, verified].

**OBSERVATION — ticker resolution.** Results are *"sorted by a combination of the best
match with the search term, and the trading volume for equities and ETFs"* — for mutual
funds AUM replaces volume. Results are filterable by asset type and country, with an
advanced-search escape hatch [S7, verified].

**OBSERVATION — relative-ticker expressions.** A colon between two tickers divides one
price by the other: `AAPL:FB` graphs relative performance. It works in `G` and `GM` but
*"currently, relative tickers can't be used in Watchlists or MyDashboards"* [S7,
verified]. The two calculation modes are documented separately: **Relative Strength
(A/B)** — *"the ratio of two prices and approximates the performance of Long $1 of A vs.
Short $1 of B with daily rebalancing"* — and **Relative Spread (%A − %B)** — *"assumes an
investor is long $1 of A vs. short $1 of B at the start of the chart and doesn't
rebalance"* [S15, verified].

**OBSERVATION — user-minted verbs.** This is the most transferable single mechanic in the
product. A saved **chart template**, **dashboard**, or **FA template** can be *"assigned a
shortcut"* — documented examples `fcsp` (FCF vs Share Price), `DBOLL` (a dashboard), `RGM`
(an FA template). Chart-template shortcuts compose with a ticker (`/` → ticker → enter →
`fcsp` → enter); dashboard and FA-template shortcuts are typed directly [S8, verified].

**INTERPRETATION.** Koyfin has separated the *namespace* of navigation from the *vocabulary*
of navigation. The vendor ships nouns (tickers) and a starter set of verbs (function
codes); the user extends the verb set with their own saved artefacts. A Bloomberg-style
mnemonic system that the *user* can extend is a genuinely different thing from a fixed
mnemonic system, and it is what makes a two-letter code memorable — the user chose it.

**RELEVANCE TO UCT.** TERMINAL-NEXT will almost certainly ship a command palette. The
design question this raises is not "which routes should it know" but **"can a member add
a verb that points at their own saved view."** UCT already has the substrate for this
(saved screens, chart layouts, multichart grids, watchlists, dashboards).

**CONFIDENCE 🟢** (all documented with worked examples).

**RECOMMENDATION (hypothesis).** A command palette whose entries include *user-named
shortcuts to user-saved artefacts* would be a larger productivity win for the desk than a
larger built-in route list — and it converts each saved artefact from a thing you browse
to a thing you invoke.

**OPEN QUESTION.** Is there a shortcut-collision policy when a user's chosen code shadows
a built-in function code? (Not documented; this is exactly the class of latent conflict
UCT has already been bitten by with keyboard axes.)

---

## I. AI: shipped vs marketed

**OBSERVATION — what is shipped.** Exactly one AI-shaped feature: **Transcript Summaries**
(release v3.69, *"Published: September 18, 2025"*). *"Summaries transform a transcript
into a structured overview of the call, removing fluff while maintaining the important
details."* Output varies by event type: earnings calls yield *"key KPIs and commentary"*
in trend tables plus *"segment commentary, guidance, risks, constraints, and Q&A
highlights"*; M&A calls yield *"transaction, financial terms, deal structure, synergies,
and strategic rationale"*. Availability: *"Included with all paid plans with unlimited
usage (Plus, Premium, Advisor Core, Advisor Pro)"*, over transcripts *"dated from 2015
onwards"* [S25, official release note, verified].

**OBSERVATION — grounding and citation.** The release note **names no model** and
**describes no citation or link-back to the source passage**. Given the summary sits
directly beside the full transcript, the source is one click away — but the summary itself
does not, on the evidence available, tell you which passage a claim came from [S25,
verified for what is written; the absence is *not determined* as a product fact].

**OBSERVATION — what is marketed.** The homepage carries a section headed *"Let AI tell
you about Koyfin"* and the pricing page carries *"Let AI explain Koyfin's pricing. Pick
your favorite AI to compare plans and find the best fit"*, with **Ask ChatGPT / Ask Claude
/ Ask Gemini** buttons [S1, S2, verified]. These are outbound links to third-party
chatbots. They are not a product capability.

**INTERPRETATION.** Koyfin has, as of 2026-09-02, **no conversational assistant, no
grounded search, no AI screening, and no AI over its own numeric data.** A targeted search
for a Koyfin AI assistant announcement returned nothing [S50, secondary]. The company's
one AI investment is aimed squarely at the single place where an LLM is low-risk and
high-value: compressing a 60-page document whose source sits adjacent for verification.

That restraint is defensible and, read alongside Section F, probably forced: Koyfin's
fundamentals are licensed from S&P Capital IQ under terms strict enough to forbid an API.
Feeding that data to a model and reselling the output is a licensing conversation, not an
engineering one. **Transcripts are the corner of the corpus where the rights are cleanest.**

**RELEVANCE TO UCT.** UCT's AI surface area (Compass, the wire brain, `ask_the_brain`,
grade_ticker, call recaps, AV transcript summaries) is already far ahead of the closest
prosumer research competitor — and UCT's data is *its own*, so the licensing wall that
caps Koyfin does not apply. The competitive gap here is large and currently unclaimed.

**CONFIDENCE 🟢** that Transcript Summaries is the only shipped AI feature (verified from
the full help taxonomy and release index, not a single page). **🟡** on the licensing
explanation — that is my inference, not Koyfin's statement.

**RECOMMENDATION (hypothesis).** The "summarise the document whose source sits beside the
summary" pattern is the highest-trust AI placement in a research product, because
verification costs one glance. Where TERMINAL-NEXT puts an LLM claim *without* the source
adjacent, it is taking on a much larger trust burden — the grounding gate UCT already runs
on COT narratives is the right shape, and should be the default, not the exception.

**OPEN QUESTION.** Do Koyfin's transcript summaries cite paragraph anchors in-product?
(Answerable in 30 seconds with a trial account; not answerable from the docs.)

---

## J. UX: strengths, weaknesses, density, onboarding, anti-patterns

**Strengths (evidence-backed).**

- **One object model, reused everywhere.** A *view* is the same object on a watchlist, a
  dashboard widget and a screener result [S11]. A *template* is the same idea for charts
  and for financial analysis [S8, S19]. Learn it once.
- **Summary rows on tables** (average / max / min / percentiles) that respect grouping and
  can be individually hidden [S10]. Small feature, large analytic payoff.
- **Percentile ranks as a universal context primitive** — the same 0–100 rank appears as a
  watchlist column, a screener filter and a scatter axis, and can be taken against a
  sector, country, region, global cohort, or the stock's own 10-/20-year history [S17].
- **A monitoring rail that dispatches** rather than merely displays [S9].
- **Density is a setting, not a decision** — the right sidebar has a ticker-only compact
  mode [S9], and v3.90 shipped a *"Compact Table"* [S44].

**Weaknesses / anti-patterns (evidence-backed).**

- **Two persistence models in one product.** Watchlist column selections *"automatically
  save"* [S10]; FA templates emphatically do not — *"make sure you save it since it isn't
  saved automatically"* [S19]. A user cannot hold one mental model of when their work is
  safe. This is a *trust* bug wearing a *convenience* costume.
- **A partial copy presented as a copy.** Importing a view silently drops *"formulas and
  custom columns"* [S11]. The operation is named "import a view" and does not import the
  view. (Directly analogous to UCT's own `lesson_a_projection_drops_what_it_does_not_name`.)
- **Capability holes inside a uniform syntax.** The colon relative-ticker grammar works in
  `G` and `GM` but *"can't be used in Watchlists or MyDashboards"* [S7]. A grammar that
  works in some panes and not others teaches users to distrust the grammar.
- **Naming drift between the price page and the docs.** The pricing page sells **Premium**
  [S2]; the financial-analysis help article still gates features by *"Koyfin Plus"* and
  *"Koyfin Pro"* [S19], and the news article says *"MTN News is only available for Plus and
  Pro plans"* [S27]. A tier was renamed and the documentation sweep missed. (This is the
  same defect class as UCT's `lesson_a_display_string_sweep_misses_case_insensitive_matchers`.)
- **An unresolvable latency statement.** *"a combination of live data and 15-minute delayed
  data"* [S37], with no per-name indicator described. The user is told the number may be
  stale and not told when.
- **Onboarding is orientation, not activation.** The getting-started article's first
  instructions are to adjust browser zoom and enable dark mode [S6]. There is no described
  guided setup, no first-run template selection, no "tell us what you follow." A 7-day
  trial [S41] with an orientation-only onboarding is a short runway.

**INTERPRETATION.** Koyfin optimises for the user who has already invested an hour. Its
ceiling is high and its floor is unmanaged.

**CONFIDENCE 🟡** overall — the strengths and the specific defects are each documented in
Koyfin's own text, but "how it feels at density" is unobserved. **Ceiling:** no screenshots
were opened at scale and no session was run.

**RECOMMENDATION (hypothesis).** Pick **one** persistence contract for TERMINAL-NEXT and
enforce it: either everything autosaves or nothing does. Two contracts in one product is a
defect the user experiences as data loss.

**OPEN QUESTION.** How long does a new Koyfin user take to build their first useful
dashboard? (The 7-day trial makes this the company's most important number, and it is not
public.)

---

## K. Performance: observed responsiveness and density claims

**NOT DETERMINED + ceiling.**

No official page makes a speed, latency, throughput or density claim. The features page
carries no performance language [S3]; the investors page carries none [S4]; the marketing
copy that comes closest is *"Sharpen your insight in a snap with superb graphing
features"* [S3], which is a mood, not a measurement.

The only quantitative third-party signal located is the **Kitces AdvisorTech Directory**
entry for Koyfin: *"Adoption Rate: 3.6%"* among surveyed advisors and a *"Kitces Report
Advisor Satisfaction Score … 9.0"* [S48, third-party professional directory, read via
search-result snippet — the page itself renders client-side and returned an empty body to
a plain fetch]. Koyfin's own marketing restates this as *"financial advisors rated Koyfin
9/10 for satisfaction and value, ranking it as the highest-rated platform in the
Investment Research & Analytics category ahead of YCharts, Kwanti, FactSet, Morningstar,
and Bloomberg Terminal"* [S47, official blog, claimed].

**INTERPRETATION.** A 9.0 satisfaction score against 3.6% adoption is the signature of a
product that is loved by the people who found it and unknown to everyone else. It says
nothing about frame times.

**CONFIDENCE 🔴** on performance. **Ceiling named:** performance is only measurable from a
session. Raising it requires either (a) a trial account driven in a browser with timing
captured, or (b) an official demo video whose loading behaviour can be observed —
Koyfin's YouTube channel (`youtube.com/@Koyfin` [S43]) is the obvious candidate and was
not sampled within budget. **The owner could supply (a) in ten minutes** with a free
account; note that the free tier already includes advanced charting and market/macro
dashboards [S2], so no purchase is required.

**OPEN QUESTION.** Does a Koyfin dashboard with 8–10 widgets stay responsive, and does it
stream or poll? (Directly relevant: UCT's `/charts` grid caps at 16 cells for measured
reasons.)

---

## L. Pricing / business model

**All figures read from the live pricing page on 2026-09-02** [S2, verified].

| Tier | Price shown | Headline entitlements |
|---|---|---|
| **Free** | **$0/month** | 2Y financials & 1Y estimates · My Portfolios (single account) · advanced charting · market & macro dashboards · **2 watchlists & 2 screens** · **2 custom dashboards** · limited company snapshots · limited news |
| **Plus** | **$39/month** | 10Y financials & 10Y estimates · ETF holdings · stock & ETF screener · **unlimited** watchlists, screens and custom dashboards · 100K+ global company snapshots · press releases, filings & transcripts · premium news |
| **Premium** | **$79/month** | Everything in Plus · My Portfolio advanced analytics · unlimited custom data · unlimited custom formulas · custom financial templates · ETF valuation |
| **Advisor Core** | **$209/month** | Everything in Premium · model portfolios · client proposals & reports (**10/month**) · client portfolios · **1 custodian integration** · US & Canadian mutual funds · mutual fund screener |
| **Advisor Pro** | **$299/month** | Everything in Advisor Core · short & leveraged model portfolios · reports (**200/month**) · custom report pages · multiple integrations · PDF broker statement upload · PMS integrations · US SMAs · priority support |
| **Teams** | Custom | Contact sales; shared watchlists + model portfolios with Viewer/Editor roles [S31] |

**Other commercial terms, verified.** 7-day free trial of all features, then automatic
downgrade to Free — *"No, every new sign-up receives a 7-day free trial of all Koyfin's
features. After the trial is over, the plan automatically downgrades to a free plan"*
[S41]. 30-day refund / *"100% satisfaction guarantee"* [S2]. *"We offer a major discount
to growing advisory firms with less than $100m AUM"* [S2]. Student discount FAQ exists
[S5]. Per-seat, not per-firm, on every published tier.

**MEASURED CEILING on annual pricing.** The page carries an Annual/Monthly toggle and the
copy *"Save up to 30% with an annual plan"*. Toggled to **Annual** and to **Monthly** on
2026-09-02, the rendered figures were **identical in both states** ($39 / $79 / $209 /
$299, each labelled `/month`). The annual effective price is therefore **not determined**
from the public page; only the "up to 30%" claim is verified. Raising this needs a
checkout flow, which this role does not enter.

**Professional vs non-professional distinction: NONE published.** There is no
pro/non-pro data-entitlement split of the kind exchanges impose on real-time feeds —
consistent with Section F, where the US feed is partly 15-minute delayed and everything
outside the US and Canada is end-of-day. **Koyfin appears to avoid the pro/non-pro problem
by not selling professional real-time data at all.**

**INTERPRETATION.** The ladder's shape is the strategy. $0 → $39 → $79 is a prosumer
ladder; $209 → $299 is a business-tool ladder, and it is 3–4× the top consumer tier for
features (reports, proposals, custodian integrations) that are *workflow*, not *data*.
The company monetises **deliverables to a third party**, not depth.

**RELEVANCE TO UCT.** UCT's own tiering already treats `tier` as a badge rather than a
data gate, and its free pages are generous. Koyfin's data point worth carrying forward is
that the 5× price step was bought by **producing an artefact someone else reads** (a client
report), not by unlocking more numbers.

**CONFIDENCE 🟢** on monthly prices, entitlements and terms (read directly). **🔴** on
annual prices, with the ceiling named above.

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT ever needs a step above the current
member price, the Koyfin evidence says the step is more likely to be bought by an *output*
(a shareable, branded, defensible artefact) than by *more data*.

**OPEN QUESTION.** What does Teams actually cost per seat, and does it change the data
entitlement or only the sharing model?

---

## M. Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **Colour groups whose payload can be a LIST, not just a symbol.** Koyfin's 7 groups
   carry one of *Single Security · Multiple Securities · My Watchlists*, and switching the
   method propagates across the group [S13]. **Hypothesis:** making a UCT `/charts` colour
   group polymorphic (symbol | symbol-set | named watchlist) would turn the workspace into
   a driver for a whole scan result. *Serves Workflow F (monitor my universe) and E (find
   a trade).*
2. **User-minted command verbs pointing at user-saved artefacts.** `fcsp`, `DBOLL`, `RGM`
   [S8]. **Hypothesis:** a TERMINAL-NEXT palette that lets a member bind a two-to-five
   letter code to their own saved screen / grid / layout beats a longer built-in route
   list, because the codes the user invents are the codes the user remembers. *Serves every
   workflow; it is the navigation substrate.*
3. **"View" as a portable first-class object across table surfaces.** Columns + sorts +
   groups + summary rows, saved once, applied to a watchlist, a dashboard widget and a
   screener result [S11]. **Hypothesis:** one view object shared across UCT's screener,
   watchlist and breadth tables would remove the per-surface column configuration UCT
   currently reimplements. *Serves C, E, F.*
4. **Percentile rank as a universal context primitive.** Every metric carries its rank
   against sector / country / region / global **and against the stock's own 10- and
   20-year history**, usable as a column, a filter, or a scatter axis [S17].
   **Hypothesis:** this is the cheapest structural cure for the failure UCT already has a
   lesson about — a number shipped without its base rate. *Serves C and E.*
5. **Summary rows that respect grouping.** Average / max / min / percentiles at the foot of
   every table, per group, individually hideable [S10]. **Hypothesis:** near-zero cost,
   immediately useful on UCT's screener and breadth tables, and it makes "is this reading
   unusual?" answerable without leaving the table. *Serves E, F, G.*
6. **Document-arrival alerts as a peer of price alerts.** Koyfin alerts on press releases,
   news, transcripts and filings alongside price, valuation and technicals, with per-channel
   delivery control [S26]. **Hypothesis:** "this name just filed / just posted a release" is
   a distinct, cheap tripwire the UCT desk does not currently have as a first-class alert
   type. *Serves A, B, F.*
7. **Corpus-level document search, filtered by list.** Transcript Advanced Search runs
   across the entire library with date-range, call-type, company, **watchlist** and sector
   filters plus exclusion operators [S24]. **Hypothesis:** "search every transcript in my
   watchlist for 'tariff'" is a research verb UCT's per-ticker transcript surface cannot
   express today. *Serves C and D.*
8. **User-invented grouping without a schema change** — type `*` before a name to create
   `*Longs` inside a watchlist [S10]. **Hypothesis:** a naming convention beats a settings
   panel for user-defined buckets, and costs one parser. *Serves F.*
9. **Interactive calendar cells.** Clicking an economic event opens consensus + previous
   *with an inline chart*; *"All widgets in the economic calendar are interactive"* [S22].
   **Hypothesis:** TERMINAL-CURRENT's calendar already opens a research modal on a ticker;
   extending the same "every cell is a door" rule to macro events would make the calendar a
   regime surface, not just a schedule. *Serves B, D, G.*
10. **Publishing your own Cons.** Koyfin's competitive content lists its own limitations in
    plain language [S46], and its FAQ states latency by geography [S37]. **Hypothesis:** the
    `CoverageLine` instinct UCT already ships on the screener — telling a member what a
    surface *cannot* tell them — generalises, and is a trust asset rather than a weakness.
    *Serves every workflow.*
11. **Calendar export to Google/Outlook** [S22]. Not a new idea for UCT (`/api/calendar/
    export.ics` exists) but independent confirmation that the feature earns its place in a
    serious research product.

---

## N. Bad ideas for UCT (avoid, and why)

1. **Do not inherit the "research doesn't need intraday" assumption.** *"We don't currently
   support minute or hourly candles"* [S14] is coherent for Koyfin's persona and fatal for
   UCT's. The desk trades the session. Any TERMINAL-NEXT design borrowed from Koyfin must
   be re-examined for the assumption that a day is the smallest unit of truth.
2. **Do not ship two persistence contracts.** Auto-saving columns [S10] next to
   manually-saved templates that warn you in bold [S19] is a user-visible inconsistency
   that reads as data loss. Pick one and enforce it.
3. **Do not let an "import" silently drop what it does not name.** Importing a Koyfin view
   discards formulas and custom columns [S11]. If a UCT operation copies a subset, name the
   subset in the button.
4. **Do not let a grammar work in some panes and not others.** Relative tickers work in `G`
   and `GM` but not in watchlists or dashboards [S7]. A syntax with pane-dependent validity
   trains users out of using it at all.
5. **Do not treat "Ask ChatGPT about our pricing" as an AI feature.** Koyfin's homepage and
   pricing page both delegate explaining Koyfin to third-party chatbots with no access to
   Koyfin's data [S1, S2]. For a product whose members expect *grounded* answers, outsourcing
   the explanation of your own product is the wrong signal — and it invites confident wrong
   answers about your own tiers.
6. **Do not rename a tier without sweeping the docs.** "Premium" on the price page, "Pro" in
   the help centre [S2 vs S19, S27]. UCT has already paid for this exact defect class.
7. **Do not substitute a proxy for an index without saying so at the point of display.**
   Koyfin's live SPX/NDX/DJI are **CFD prices** and differ from the official index [S40].
   The substitution is disclosed in an FAQ, not on the number. If UCT ever renders a proxy,
   the proxy's name belongs beside the value.
8. **Do not tell a user "some of this is live and some is 15 minutes old" without telling
   them which.** [S37] This is the most damaging sentence in Koyfin's documentation, because
   it makes every displayed price conditionally untrustworthy with no way to resolve the
   condition.
9. **Do not build a product your own users cannot get data out of.** *"They are in the API
   business. We are in the analytics business"* [S38] is a defensible strategy for a
   licensee of someone else's fundamentals. UCT owns its proprietary layer, so adopting the
   same closedness would be a self-inflicted limitation with none of the licensing excuse.
10. **Do not make onboarding an orientation tour.** "Set your browser zoom and enable dark
    mode" [S6] is not activation. With a 7-day trial [S41], the first session has to produce
    one useful saved artefact.

---

## O. Screenshots / evidence links (never reproduced here)

Official surfaces carrying screenshots and animated demonstrations, all first-party:

- Help centre index and topic listings — `https://www.koyfin.com/help/` ·
  `.../help/topic/functionality/` (full article inventory of ~60 functional articles plus
  ~95 release notes; the inventory itself is the best single map of the product).
- Feature articles with embedded screenshots/GIFs: `.../help/mydashboards-myd/` ·
  `.../help/my-dashboards-groups/` · `.../help/mywatchlists/` · `.../help/charts-and-graphs/` ·
  `.../help/my-screens/` · `.../help/command-bar-search/` · `.../help/hotkeys-and-custom-shortcuts/` ·
  `.../help/master-transcript-search/` (explicitly cites "gif demonstrations").
- Release notes with per-feature imagery: `.../help/release-notes/v3-66-desktop-alerts/` ·
  `.../help/release-notes/v3-69-transcript-summaries/` · `.../help/release-notes/` (index to v3.97).
- Product marketing pages: `https://www.koyfin.com/` · `/features/` · `/for-investors/` ·
  `/pricing/`.
- Live application entry points named in the docs (public, unauthenticated URLs):
  `app.koyfin.com/earc` (earnings calendar) · `app.koyfin.com/gyld` (global yields).
- Official video: **YouTube `https://www.youtube.com/@Koyfin`** [S43] — *not sampled within
  this role's budget; the single highest-value unexploited evidence source for Sections J
  and K.* Also official: `x.com/KoyfinCharts`, `reddit.com/r/koyfin` (a company-run
  subreddit — a practitioner-voice source a Wave-2 role should mine).
- One screenshot was taken by this role of the public pricing page to resolve the
  Annual/Monthly toggle question (Section L). It was observed, not saved, and is not
  reproduced.

---

## P. Confidence by section, with ceilings

| § | Confidence | Ceiling / what would raise it |
|---|---|---|
| A Executive summary | 🟢 | — (all first-party) |
| B Personas | 🟢 list · 🟡 roadmap reading | Release notes with dates; the index rendered titles only |
| C Navigation | 🟢 mechanics · 🔴 feel | A driven session |
| D Capability map | 🟢 presence/absence · 🟡 depth | Trial account; help articles describe features, not ceilings |
| E Workflows | 🟡 | **Wave 2's job.** Paths were assembled from multiple articles, never observed end-to-end |
| F Data | 🟢 | Total security counts and per-asset history depth are unpublished |
| G Customization | 🟢 · 🔴 multi-monitor | Multi-monitor behaviour is undocumented entirely |
| H Search / commands | 🟢 | Shortcut-collision policy undocumented |
| I AI | 🟢 (that summaries are the only AI) · 🟡 (why) | Whether summaries cite source passages needs a trial account |
| J UX | 🟡 | Density and information architecture unobserved; official video would help |
| K Performance | 🔴 | **No public claim exists.** Needs a driven session or a demo video |
| L Pricing | 🟢 monthly · 🔴 annual | Annual toggle rendered identical figures 2026-09-02; only a checkout resolves it |
| M Best ideas | 🟡 (hypotheses by construction) | Each needs a UCT-side feasibility read |
| N Bad ideas | 🟢 (each grounded in a quoted defect) | — |
| O Evidence | 🟢 | YouTube and r/koyfin unsampled |

**Overall: 🟡.** Every structural claim about *what Koyfin is and does* is first-party and
verified. Nothing about *how it performs or feels* is. The named ceiling — no hands-on
account — is cheap to lift: the free tier includes charting and dashboards, so an hour with
a free login would upgrade Sections E, J and K from reconstruction to observation.

---

## Final section — Koyfin with UCT's proprietary intelligence (🟡)

**Speculative by construction; offered as a lens, not a plan.**

Koyfin's architecture is a set of user-arrangeable widgets over rented, mostly-durable
data, wired by colour groups and reached by user-minted verbs — and the thing it visibly
lacks is *a point of view about right now*. Drop UCT's proprietary layer into that shell
and the shape changes character rather than degree. The breadth rails (40+ metrics with
years of daily history and drill lists derived from the same mask that produced each
count), the COT positioning stack with its grounded weekly read, the exposure score, the
options-flow and dark-pool tape, the model book, the setup taxonomy with measured base
rates, and the KB behind Compass are all things Koyfin cannot license from S&P Capital IQ
or Morningstar at any price — they are *measurements of a firm's own process*, not vendor
feeds. In that hybrid, the percentile-rank primitive stops being a valuation-context tool
and becomes a regime tool: every breadth metric carrying its own 10-year percentile beside
today's value; every setup carrying its base rate beside its signal. The 7 colour groups
stop linking a chart to a table and start linking *a scan result to a flow tape to a
positioning read to a sized plan*, so a single selection walks the whole desk workflow. The
command bar's user-minted verbs stop being shortcuts to saved layouts and become shortcuts
to saved *questions* — `RGM` no longer means "my financial-analysis template" but "grade
this name against my regime, my book heat, and my own expectancy in this setup." And the
one AI feature Koyfin ships — a structured summary sitting beside its verifiable source —
becomes the template for every generated claim on the surface, which is the discipline UCT
already enforces on its COT narratives and should carry into TERMINAL-NEXT wholesale. The
honest caveat: this hybrid is not Koyfin-plus-features. Koyfin's restraint about the tape
is what buys it a clean, uncrowded, learnable interface; adding a live positioning-and-flow
layer to that shell is precisely the density problem TERMINAL-NEXT has to solve on its own,
and no benchmark solves it for us.

---

## GAPS (budget not reached / channel notes)

- **Search channel used.** `WebSearch` was exhausted before this role began (per the
  preamble) and was never called. Evidence was gathered by (1) **WebFetch on known URLs**
  — the overwhelming majority, including a full crawl of Koyfin's help-centre topic
  listings to enumerate every functional article; (2) **`curl` via Bash** against
  `sitemap_index.xml`, `post-sitemap.xml` and the help topic pages, to derive article
  slugs rather than guess them; (3) **one browser tab** (created, used, closed) for the
  pricing Annual/Monthly toggle and two Google result pages.
- **Queries that could not be run.** Reddit's `search.json` refused a scripted `curl`
  (served HTML). Bing served a captcha on `site:fintech.kitces.com koyfin` — **not
  solved**; the query was re-run on Google. `fintech.kitces.com`'s Koyfin detail page
  renders client-side and returned an empty body to WebFetch, so its adoption/satisfaction
  figures are cited from the Google result snippet, not the page.
- **Not sampled, and worth a Wave-2 pass:** Koyfin's official **YouTube channel**
  (`@Koyfin`) — the only realistic public route to Sections J and K; the company-run
  **r/koyfin** subreddit for practitioner voice; the `koyfin-data-dictionary` article's
  full metric list; the `portfolio-tools-functionality`, `model-portfolios`,
  `custom-news-screens` and `etf-*` articles.
- **Deliberately not attempted** (per the binding DO-NOT list): no sign-up, no login, no
  trial start, no form submission, no captcha, no purchase. Section K and the annual-price
  question are both gated behind exactly those actions, which is why both are labelled 🔴
  with the ceiling named rather than estimated.
- **One observation about source text, per SOURCE HANDLING.** Koyfin's homepage and
  pricing page both embed buttons reading *"Ask ChatGPT / Ask Claude / Ask Gemini"* that
  invite an AI to summarise Koyfin's own use cases and compare its plans. These are
  addressed at an assistant, not at the reader. They were treated as **evidence of a
  marketing choice** (recorded in Section I) and **not followed as instructions**.

---

## SOURCES

All fetched **2026-09-02**. Tier key: **T1** official documentation / help centre ·
**T2** official release notes · **T3** official product & pricing pages · **T4** official
marketing blog (treat as *claimed*) · **T5** third-party professional directory ·
**T6** general web / search aggregation.

1. `https://www.koyfin.com/` — T3, verified (positioning, personas, feature labels, "Let AI tell you about Koyfin")
2. `https://www.koyfin.com/pricing/` — T3, verified (all tiers, entitlements, guarantee, AUM discount; annual toggle measured)
3. `https://www.koyfin.com/features/` — T3, verified (12 named feature areas; no perf claims)
4. `https://www.koyfin.com/for-investors/` — T3, verified (investor positioning; compare-against list)
5. `https://www.koyfin.com/help/` — T1, verified (help taxonomy, section counts)
6. `https://www.koyfin.com/help/getting-started-with-koyfin/` — T1, verified (nav model, "over one million data points", onboarding)
7. `https://www.koyfin.com/help/command-bar-search/` — T1, verified (`/`, grammar, codes, ticker resolution, colon syntax)
8. `https://www.koyfin.com/help/hotkeys-and-custom-shortcuts/` — T1, verified (default codes; user-assignable shortcuts)
9. `https://www.koyfin.com/help/right-sidebar/` — T1, verified (rail panels, density modes, dispatch behaviour)
10. `https://www.koyfin.com/help/mywatchlists/` — T1, verified (columns, `*` groups, advanced sort, summary rows, views, news, sharing)
11. `https://www.koyfin.com/help/my-views/` — T1, verified (what a view saves; dashboard sync; formula-drop caveat)
12. `https://www.koyfin.com/help/mydashboards-myd/` — T1, verified (widget types, layout, templates)
13. `https://www.koyfin.com/help/my-dashboards-groups/` — T1, verified (7 colour groups; three selection methods)
14. `https://www.koyfin.com/help/charts-and-graphs/` — T1, verified (chart types, 300+ series, annotations, **no minute/hourly candles**)
15. `https://www.koyfin.com/help/relative-performance-relative-strength/` — T1, verified (A/B ratio vs %A−%B spread)
16. `https://www.koyfin.com/help/my-screens/` — T1, verified (5,900+ filters, 100K+ securities, export carve-out)
17. `https://www.koyfin.com/help/percentile-rank-snapshot-feature/` — T1, verified (0–100 ranks; cohorts incl. own 10Y/20Y history)
18. `https://www.koyfin.com/help/custom-formulas/` — T1, verified (operators, formats, per-tier limits)
19. `https://www.koyfin.com/help/financial-analysis-templates/` — T1, verified (300+ metrics; manual-save warning; legacy "Pro" naming)
20. `https://www.koyfin.com/help/actuals-consensus/` — T1, verified (A/E notation, analyst counts, 2012→2032)
21. `https://www.koyfin.com/help/earnings-calendar-feature/` — T1, verified (`earc`, watchlist/ETF filtering)
22. `https://www.koyfin.com/help/building-lightning-quick-earnings-and-economic-calendars-with-koyfin/` — T1, verified (90-day forward, surprise %, Google/Outlook export, interactive economic widgets)
23. `https://www.koyfin.com/help/transcripts/` — T1, verified (9000+ companies, back to 2004, event types, `TS`)
24. `https://www.koyfin.com/help/master-transcript-search/` — T1, verified (library-wide advanced search + filters)
25. `https://www.koyfin.com/help/release-notes/v3-69-transcript-summaries/` — T2, verified (published 2025-09-18; all paid plans; 2015 onward; no model named)
26. `https://www.koyfin.com/help/release-notes/v3-66-desktop-alerts/` — T2, verified (alert types incl. Documents; three delivery channels; published 2025-06-19)
27. `https://www.koyfin.com/help/markets-news/` — T1, verified (MT Newswires; sections; 700+ topics; "Plus and Pro plans")
28. `https://www.koyfin.com/help/company-news-2/` — T1, verified (two-panel viewer, Customize Sources, Highlight Terms, Article Topics)
29. `https://www.koyfin.com/help/my-portfolios/` — T1, verified (entry methods, lots, cash, P/L variants, exposures, free-tier limit)
30. `https://www.koyfin.com/help/global-bonds-yield-curves-fx/` — T1, verified (`gyld`; Table/Graph/Matrix widgets)
31. `https://www.koyfin.com/help/teams/` — T1, verified (shared assets; Viewer/Editor; admin roles)
32. `https://www.koyfin.com/help/topic/integrations/` — T1, verified (Schwab, Altruist, TradePMR, Black Diamond, IBKR, Orion, Fidelity Wealthscape, Addepar)
33. `https://www.koyfin.com/help/mobile-app-feautres/` — T1, verified (mobile feature set; iOS widgets)
34. `https://www.koyfin.com/help/data-overview/` — T1, verified (asset classes; 45 countries bonds / 20 yield curves; 60 FX pairs)
35. `https://www.koyfin.com/help/koyfin-data-dictionary/` — T1, verified (~150+ defined items; short-interest cadence)
36. `https://www.koyfin.com/help/faq/where-do-you-get-your-data/` — T1, verified (six named vendors; "over a dozen")
37. `https://www.koyfin.com/help/faq/is-your-data-live-or-delayed/` — T1, verified (US mixed live/15-min; Canada 15-min; rest EOD)
38. `https://www.koyfin.com/help/faq/can-i-get-the-data-via-api/` — T1, verified ("They are in the API business. We are in the analytics business.")
39. `https://www.koyfin.com/help/faq/can-i-download-data/` — T1, verified (download carve-out for financials/estimates/valuation)
40. `https://www.koyfin.com/help/faq/why-spx-price-differs/` — T1, verified (CFD-sourced live index prices)
41. `https://www.koyfin.com/help/faq/will-i-be-charged-after-my-free-trial/` — T1, verified (7-day trial → auto-downgrade)
42. `https://www.koyfin.com/help/faq/can-i-use-koyfin-charts-in-my-blog-or-research-report/` — T1, verified (attribution policy)
43. `https://www.koyfin.com/help/faq/does-koyfin-have-social-media/` — T1, verified (official channels incl. YouTube `@Koyfin`, `r/koyfin`)
44. `https://www.koyfin.com/help/release-notes/` — T2, verified (latest ≈ v3.97; advisor-weighted recent roadmap; dates not rendered)
45. `https://www.koyfin.com/help/topic/functionality/` (+ paginated) — T1, verified (complete functional-article inventory used as the capability map's spine)
46. `https://www.koyfin.com/blog/best-bloomberg-terminal-alternatives/` — T4, **claimed** (2026-01-22; Koyfin's own Cons list: not for active traders / no options / no bid-ask / no Excel plug-in / EOD ex-US-and-Canada)
47. `https://www.koyfin.com/blog/best-platform-investment-research-portfolio-analytics-client-proposals/` — T4, **claimed** (restates the Kitces 9/10 result and the category ranking)
48. `https://fintech.kitces.com/details/investment-management/investment-data-analytics/koyfin` — T5, **reported**, read via Google result snippet (Adoption Rate 3.6%; Advisor Satisfaction Score 9.0). Page renders client-side; direct fetch returned header only.
49. `https://www.koyfin.com/sitemap_index.xml` + `post-sitemap.xml` — T3, structural (used to locate blog URLs rather than guess them)
50. Google result pages for `"Koyfin" review … limitations` and `Kitces AdvisorTech … Koyfin` — T6, **secondary**, used only to locate primary sources and to establish the *absence* of any Koyfin AI-assistant announcement
