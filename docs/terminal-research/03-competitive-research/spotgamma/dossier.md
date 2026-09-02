---
id: B-SG-01
title: SpotGamma — dealer positioning and gamma analytics (benchmark dossier)
role: Benchmark product dossier author (STANDARD depth)
wave: 1b
group: B
category: competitor
scope: SpotGamma (spotgamma.com) — HIRO, TRACE, Equity Hub, Tape, Compass/Scanners, Volatility Dashboard, Canvas, Founder's Note
confidence: 🟡
evidence_ceiling: No subscriber seat. Every in-app behaviour (real latency, screen density, keyboard/command surface, actual layout) is reconstructed from official help-centre prose and product marketing pages, never observed. One month of Alpha ($299) or subscriber screenshots/screen recordings would raise C, H, J and K from 🟡/🔴 to 🟢.
sources: 26 primary; 1 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# SpotGamma — benchmark dossier (B-SG-01, STANDARD depth)

**Scope note.** This dossier is written for TERMINAL-NEXT programme synthesis and must stand alone. Benchmarks are sources of learning, not specifications: nothing below implies UCT should build it. TERMINAL-CURRENT is the existing `/calendar` surface (display-named "UCT Terminal"); TERMINAL-NEXT is the workstation being designed. No internal UCT files were read for this report; every comparison to UCT rails is made from the programme brief only.

**How evidence is labelled.** `verified` = stated in SpotGamma's own documentation or product pages · `demonstrated` = seen in an official demo/video transcript · `claimed` = marketing copy · `reported` = practitioner account · `speculated` = my inference. Source tiers follow Document C Part XII, tier 1 being official documentation/help centre.

**Method and channel (per the Search-budget rule).** `WebSearch` was assumed exhausted and never used. Evidence came from (a) `WebFetch` on known spotgamma.com product/pricing pages, and (b) `WebFetch` and one browser tab against the **Zendesk Help Center public JSON API** at `support.spotgamma.com/api/v2/help_center/...`. The HTML help centre (`support.spotgamma.com/hc/en-us`) returns **HTTP 403** to `WebFetch`; the JSON API on the same host does not. That API returns article `title`, `updated_at`, `html_url` and full `body`, which is why this dossier can date individual claims. One browser tab was opened for the 403-blocked HTML pages and is closed (the shared tab group was being churned by sibling roles; no tab of mine remains open).

---

## A. Executive summary

**OBSERVATION.** SpotGamma is a subscription **options-positioning analytics service** for retail and prosumer traders. It does not try to be a terminal in the Bloomberg sense: it has no fundamentals, no filings, no news feed, no portfolio, no order routing. It sells one thing — a model of **where dealers are hedged and what that implies about support, resistance and volatility regime** — expressed as (i) a small set of named, proprietary price levels, (ii) real-time flow and heatmap visualisations, and (iii) a twice-daily human-written note that tells you what the levels mean today. Founded by Brent Kochuba in 2020; Matthew Fox is CEO.

Its apparent **PHILOSOPHY (Part CCXLVII)**, in one sentence: *the options market moves the stock market, so publish a small number of opinionated, named levels that a non-professional can act on before price gets there — and sell the daily interpretation alongside the data rather than leaving the user to derive it.*

**EVIDENCE.**
- "Where options _flow_ the markets go" and "See what the professionals see" — spotgamma.com home page (tier: official product page; fetched 2026-09-02; `claimed`).
- Founded by Brent Kochuba, 2020; CEO Matthew Fox; mission "to empower traders to make confident decisions by pairing precise data with clear insights"; goal "to make sure all investors have the ability to see what the professionals see" — https://spotgamma.com/about/ (tier: official; 2026-09-02; `claimed`).
- Product roster (Founder's Note, Equity Hub, Options Calculator, Compass Super Scanner, TRACE Heatmap, HIRO Indicator, Volatility Dashboard, TAPE, FlowPatrol Report) — spotgamma.com home page (tier: official; 2026-09-02; `verified` as the product list).
- Help-centre category index confirming the shipped surface set: Glossary · Subscription & Membership · Founder's Note · Reports · HIRO Indicator · Volatility Dashboard · TRACE Heatmap · Tape · Equity Hub™ · Scanners & Compass · Options Calculator · Indicies · Canvas · Futures Integrations · SpotGamma Academy · Referral Partner Program — `https://support.spotgamma.com/api/v2/help_center/en-us/categories.json` (tier: official help centre; fetched 2026-09-02; `verified`). Category `created_at` dates are in the payload: **Canvas 2026-06-29**, **Reports 2026-09-01** — i.e. two of the fourteen product areas are less than ten weeks and one day old respectively.

**INTERPRETATION.** SpotGamma is the clearest public example of a **narrow-domain intelligence product that ships an opinion, not a dataset**. Its moat is naming: "Call Wall", "Put Wall", "Volatility Trigger™", "Hedge Wall", "SpotGamma Gamma Index™" are trademarked or trademark-styled vocabulary that subscribers learn and then cannot get elsewhere. The help centre's largest category by article count is the **Glossary** (roughly 210 articles across seven sections, including a 14-article "SpotGamma Key Levels" section) — the vocabulary *is* the product surface.

**RELEVANCE TO UCT.** Directly comparable to UCT's dealer-positioning/GEX rails and to the Morning Wire's job of turning a regime read into a day plan. Personas served: the internal desk (Workflow G, "understand the regime") and the member who wants a level to trade against.

**CONFIDENCE.** 🟢 for what the product is and who runs it. Ceiling: none for section A.

**RECOMMENDATION (hypothesis).** *A small, named, stable vocabulary of levels beats a large configurable one.* If TERMINAL-NEXT publishes positioning, it may be worth naming a fixed handful of levels and never renaming them, because the name is what a member can carry between the wire, the chart and the Discord.

**OPEN QUESTION.** Does SpotGamma's level vocabulary retain users because it is *good*, or because switching cost is high once a trader has internalised it? Cannot be distinguished from public evidence.

---

## B. User types / personas served

**OBSERVATION.** Three visible personas, and one absent one.

1. **The index/0DTE day trader** — buys Alpha for TRACE and HIRO, works SPX/SPY/ES intraday against gamma levels. TRACE is S&P-only and updates every minute; there is a 0DTE toggle on the strike plot.
2. **The single-name swing trader** — buys Essential (or Alpha) for Equity Hub levels across 3,500+ names, Compass/Scanners for idea generation, and the Founder's Note for context.
3. **The futures trader** — served indirectly: SpotGamma maps its index "combo" levels onto ES, NQ, RTY and YM and pushes them into Bookmap, NinjaTrader, Jigsaw, eSignal, Sierra Chart and TradingView.

Absent: **the institution**. There is no enterprise tier, no seat-based firm pricing, no compliance/entitlement machinery in any public document, and **no public API**.

**EVIDENCE.**
- "A public API is not yet available." — "Does SpotGamma have an API? Can I export data?", https://support.spotgamma.com/hc/en-us/articles/50266085426195-Does-SpotGamma-have-an-API-Can-I-export-data (tier: official help centre; updated 2026-07-16; `verified`). Export exists only as "a download button located above the data grid" in Equity Hub.
- Combos map "to matching levels in ES, NQ, RTY, and YM respectively so that futures traders can know exactly what levels correspond to the combos" — Glossary → "Combos" (updated 2026-07-09; `verified`).
- Futures Integrations category lists TradingView, Bookmap, NinjaTrader, Jigsaw, eSignal, Sierra Charts (tier: official; `verified`).
- Discord is tiered: standard and pro discussion/chart channels, with pro members reaching per-stock charts; "SpotGamma's Discord chat room is free and open to all current SpotGamma Subscribers." — Subscription & Membership → Discord articles (updated 2023-11-24 / 2023-12-13; `verified`).
- "SpotGamma does not currently support commodity options (Gold, Oil, Silver, Crude, etc.)" — Glossary → Getting Started (updated 2026-03-26; `verified`).

**INTERPRETATION.** SpotGamma deliberately serves the *self-directed individual*, and integrates with the tools that individual already pays for rather than trying to replace them. The absence of an API is a strategic tell: the value is the interpretation, and an API would let a quant reproduce the levels and drop the subscription.

**RELEVANCE TO UCT.** UCT's population is the same shape — self-directed members plus a small internal desk — and UCT already owns the "integrate with the chart the member already uses" surface via its TradingView/Pine parity work.

**CONFIDENCE.** 🟡. Personas are inferred from tier boundaries and integration lists, not from stated customer segments. Ceiling: no published customer breakdown; a SpotGamma conference talk or investor deck would raise it.

**RECOMMENDATION (hypothesis).** *Publishing levels into the member's existing chart may be worth more than another in-app chart.* SpotGamma spends real engineering on six third-party charting integrations rather than making its own chart the destination.

**OPEN QUESTION.** How many subscribers actually consume levels through the integrations versus the web app? Unknowable publicly.

---

## C. Navigation: how users move

**OBSERVATION.** A **left navigation menu** with named sections (one confirmed section name: "Market Central", which contains Canvas). Within a tool, the unit of navigation is a **ticker box at the top of the page**, plus a **watchlist pane**. Since June 2026 there is also **Canvas**, a workspace layer that lets a user assemble components onto a page and page between saved Workspaces from a dropdown at the top.

**EVIDENCE.**
- "Canvas can be accessed in the Market Central section of the left navigation menu." — "What is Canvas?" (updated 2026-06-29; `verified`).
- "Type in the ticker name in the search box to populate on the grid." — "What is SpotGamma Compass?" (updated 2026-02-19 / prior 2025-04-01 revision; `verified`).
- Equity Hub: "type the symbol at the top of the page to pull the charts for that name into view" (`verified`).
- Watchlist: "add or remove symbols at any time directly from the Watchlist pane by clicking '+ Add to watchlist' then searching for the symbol you're wanting to monitor or by selecting it from the drop down list" — "How do I add tickers to my Equity Hub™ Watchlist?" (updated 2023-02-26; `verified`).
- "Any layout you design is saved as a separate Workspace. You can page between Workspaces using the dropdown at the top." — Canvas → "Can I save more than one layout?" (2026-06-29; `verified`).
- Alert chrome: "When an alert fires, you will find the alert bell icon on the top right of the application turns red." — HIRO Flow Alerts article (updated 2026-07-26; `verified`).

**INTERPRETATION.** This is a **conventional SaaS shell**: left nav, per-page ticker input, top-right alert bell, workspace dropdown. There is no evidence of a command palette, a global omni-search, or ticker resolution across surfaces. Ticker state is per-page unless the user has explicitly *grouped* components inside a Canvas workspace.

**RELEVANCE TO UCT.** Directly comparable to UCT's `/charts` workspace shell and its left `NavBar`. Note the ordering of history: SpotGamma reached workspaces **in 2026**, years after shipping the analytics — the analytics came first and the workspace was retro-fitted.

**CONFIDENCE.** 🟡 for the elements named above (each is a direct quote from official docs). 🔴 for anything not named — I cannot say whether a command palette or keyboard navigation exists, only that the help centre never mentions one. **Ceiling: no seat.** A subscriber screen recording or a single authenticated session would settle it.

**RECOMMENDATION (hypothesis, phrased as a caution).** *An analytics product that grows tool-by-tool will accumulate per-page ticker boxes and later need a workspace layer to reunify them.* If TERMINAL-NEXT expects many surfaces, deciding the symbol-propagation model **before** the surfaces may be cheaper than retro-fitting one.

**OPEN QUESTION.** Does SpotGamma have any keyboard-first navigation at all? Not one help-centre article mentions a shortcut — which is weak evidence of absence, not proof.

---

## D. Capability map (Part XIII taxonomy)

Each row is anchored to an official surface. "—" means **no public evidence of any such capability**, which for this product is usually a deliberate scope decision rather than a gap.

| Part XIII area | SpotGamma | Evidence status |
|---|---|---|
| **Market overview** | "Indicies" pages for S&P 500 / Nasdaq / Russell: Gamma Model, Vanna Model, Delta Model, SIV Index, Gamma & Delta Tilt, Expiration Concentration, Combo Strikes, 0DTE Volume/OI, Equity Put/Call Ratio, Price vs 2M/6M Realized Vol, 5-Day & 30-Day Return Histogram, Concentration Table, Strike Table, Options Risk Reversal, Real Time Updates chart | `verified` (help-centre section list, category `Indicies`) |
| **Security pages** | Equity Hub per-symbol: Composite View, Put & Call Impact, Live Price & SG Levels, 10-day history, Options Impact gauge, Dark Pool Indicator | `verified` |
| **Fundamentals** | — | no surface exists |
| **News** | — (no news feed; the Founder's Note is commentary, not a feed) | no surface exists |
| **Earnings** | Only *Implied Earnings Moves* as a free chart; no estimates, transcripts or history | `verified` (free-tools page) |
| **Economic** | Term Structure overlays "economic events"; no calendar product | `verified`, thin |
| **Screening** | 15 named scanners in four families + Compass 2-D grid over 3,500 names; Equities Table with filterable/customisable columns | `verified` |
| **Charting** | Domain charts only (heatmaps, strike plots, HIRO flow, IV surfaces). Price charting is delegated to TradingView/Bookmap/NinjaTrader/Sierra/eSignal/Jigsaw via level files | `verified` |
| **Alerts** | HIRO Flow Alerts; Equity Hub Call Wall / Put Wall alerts ("Breached", "Within 1%"); bell icon + alerts log | `verified` |
| **Portfolio / watchlist** | Watchlist only. No positions, no P&L, no journal | `verified` |
| **Documents** | — | no surface exists |
| **Collaboration** | Discord (tiered channels, weekly trade ideas, Monday "top 5 Gamma Squeeze Candidates", a SpotGamma Bot that renders shareable charts); twice-weekly live Q&A webinars Mon/Thu 1:00 PM ET | `verified` |
| **AI** | — see section I | — |
| **Command / keyboard** | — no public evidence | 🔴 |
| **Workspaces** | Canvas: Workspaces → Containers (1–5 components, tabbed or single) → Components (30+); grouping links components to one ticker | `verified` |

**EVIDENCE (selected direct quotes).**
- Scanners: "highlights names that have unusually expensive options" (Volatility Risk Premium) and "highlights stocks that have potential for an explosive upside move" (Squeeze) — Scanners & Compass category (articles updated Feb–Jun 2026; `verified`). Named scanner set: Volatility Risk Premium, Squeeze, Most Call Gamma, Lowest Put/Call Ratio, Gamma Squeeze, Bullish Dark Pool Readings, Most Put Gamma, Highest Put/Call Ratio, Bearish Dark Pool Readings, 1% Margin of Hedge Wall, Top Gamma/Delta Expiring Friday, Largest Delta Positions, 1% Margin of Key Delta Strike, High Impact.
- Compass: "plot multiple stocks across a 2-dimensional grid to assess both the volatility expectations and directional positioning"; axes are **IV Rank** and **Risk Reversal Rank**, each "compared to the prior year's values"; two modes, **Guided View** (preset axes) and **Explorer View** (customisable x/y/z) — Scanners & Compass category (`verified`).
- Tape: "A live stream of every listed US options transaction, with full trade detail: ticker, strike, expiration, premium, size, side, direction, plus identifiers of sweep, cross, or block trades"; Highlights screeners update "every 30 seconds"; "20+ customizable metrics for each trade" — https://spotgamma.com/tape/ (tier: official product page; 2026-09-02; `claimed`/`verified` mix — treat latency numbers as `claimed`).
- Alerts: "The HIRO Flow Alert flags large option flows in real time so you can be notified when significant options activity takes place for a name you follow." and "SpotGamma HIRO users can toggle specific alerts to be notified when the Put Wall is Breached, or when a name is Within 1% of its Put Wall." (updated 2026-05-27 / 2026-07-26; `verified`).

**INTERPRETATION.** The capability map is **deliberately L-shaped**: extremely deep in one column (options positioning), empty in nine others. Everything that is not positioning is either delegated (price charting → TradingView) or simply refused (fundamentals, news, documents). The *only* general-purpose primitives it kept are watchlist, alerts and workspaces — precisely the three that make a narrow tool usable daily.

**RELEVANCE TO UCT.** UCT's options-flow, dark-pool and GEX rails occupy the same column, and UCT already owns the nine columns SpotGamma refused. The interesting question for TERMINAL-NEXT is not "what is SpotGamma missing" but "which three primitives make a narrow surface into a daily habit".

**CONFIDENCE.** 🟢 for presence/absence of each surface (the help-centre category and section index is an authoritative inventory). 🟡 for the internals of each surface.

**RECOMMENDATION (hypothesis).** *Watchlist + alerts + workspaces are the minimum viable "home" for any analytic surface.* A positioning rail with none of the three is a page a member visits when reminded; with all three it is a page they leave open.

**OPEN QUESTION.** Which of the 15 scanners actually get used? SpotGamma publishes no usage data.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five in depth

**A — "Why is this stock moving?"** *Partially served, and only through one lens.* The user types the symbol at the top of Equity Hub, reads the Composite View for options influence, then the Put & Call Impact chart for where gamma flattens, then the 10-day history of Call Wall / Put Wall / Hedge Wall for whether levels are rising or falling, then Live Price & SG Levels for distance to the nearest level; HIRO shows whether real-time flow is pushing the name. **What is missing: the actual cause.** There is no news, no filing, no earnings item — SpotGamma answers "what is the options market doing about it", never "what happened". Evidence: "Equity Hub Trading Checklist" (2024-04-09), "HIRO Indicator Trading Checklist" (2024-04-07); quotes "Darker red or green coloration means there is larger options influence." and "Movement upwards in key levels can indicate bullishness." (`verified`).

**B — "Prepare me for earnings."** *Barely served.* A free **Implied Earnings Moves** chart, and the Founder's Note checklist's Step Three tells the trader to "check earnings/economic calendars" — i.e. it directs the user *off-product*. No estimates, no transcripts, no beat history. Evidence: spotgamma.com/free-tools/ (`verified`); Founder's Note trading checklist (`verified`).

**C — "Research this company from scratch."** *Not served.* No fundamentals, no filings, no descriptions. Out of scope by design.

**D — "What matters today."** *Strongest workflow.* Two artefacts: the **Founder's Note**, written by Brent Kochuba, delivered pre-open (AM note between 5:30 and 8:30 AM ET) and post-close (4:00–7:00 PM ET), emailed as a notification with a preview that redirects to the site, archived at `dashboard.spotgamma.com/foundersNotes`; and the **Opening Setup** report, new on 2026-09-01: "SpotGamma's Opening Setup is a four-page report delivered every morning before the market opens", carrying a 0–100 **SG Flow Signal** market-sentiment gauge, setup profiles screening for volatility extremes, the eight largest institutional positions by premium, and a probability-of-profit column. Plus **FlowPatrol**, a daily flow report built on the Synthetic OI model: "FlowPatrol is built to surface impactful trades taking place from across the options market." Evidence: Founder's Note category (`verified`); Reports category, articles dated 2026-09-01 (`verified`).

**E — "Find a trade."** *Served by scanners and Compass.* 15 scanners plus a two-axis Compass (IV Rank × Risk Reversal Rank) over 3,500 names, with Explorer View allowing custom axes. Compass is explicitly framed as screening for *mispricing and positioning*, not for price setups. The Opening Setup report is careful: "Nothing in the report is a recommendation to buy or sell any security." (`verified`).

**F — "Monitor my universe."** *Served thinly.* Watchlist pane + Call Wall / Put Wall proximity alerts + HIRO Flow Alerts + a bell icon. No portfolio, no positions, no risk aggregation. The Canvas grouping feature is the closest thing to a monitoring layout: components in a group all follow one ticker.

**G — "Understand the regime."** *This is the product.* **Volatility Trigger™** ("Detects the level below which we expect bearish feedback loops to start kicking in"; "generally the last major support above the Put Wall"; SpotGamma publishes that when SPX opens above VT, average 5-day realised volatility is 13% versus 18% below), **Zero Gamma** ("Not support and resistance, but rather informative of the regime and climate"; "Sets the line of where negative or positive market gamma begins"), the **SG Gamma Index™**, and TRACE's colour regime (blue = positive gamma / lower expected volatility; red = negative gamma / higher expected volatility). Evidence: Glossary → Key Levels, Volatility Trigger™ (updated 2026-08-17) and Zero Gamma (updated 2026-08-17) (`verified`); TRACE category (2024-09-20) (`verified`).

**INTERPRETATION.** SpotGamma's workflow coverage is the exact inverse of a research terminal: G and D are excellent, A is one-sided, B/C/F are stubs. It closes the loop by **writing the day's interpretation itself** rather than assuming the user will assemble it — the Note is the product that makes the levels usable.

**RELEVANCE TO UCT.** This is precisely the Morning Wire's role in the UCT ecosystem, and precisely the gap TERMINAL-NEXT would sit in. SpotGamma demonstrates that "a daily human note anchored to the same named levels the app shows" is commercially viable at $99–$299/month.

**CONFIDENCE.** 🟡. The workflow steps come from official "trading checklist" articles, which describe an intended routine rather than an observed one; I never watched a user execute them. **Ceiling: no seat, no screen recording.**

**RECOMMENDATION (hypothesis).** *A daily note that cites the same named levels the surfaces render turns a dashboard into a routine.* Worth testing whether TERMINAL-NEXT's regime surfaces and the wire share one vocabulary strictly enough that a member can move between them without translation.

**OPEN QUESTION.** How much of SpotGamma's retention is the Note versus the tools? A tier that sold the Note alone would answer it; none exists.

---

## F. Data

**OBSERVATION.**
- **Source:** OPRA plus direct exchange feeds; all published metrics are SpotGamma's own calculations on top.
- **Asset classes:** US listed equities, ETFs and index options; index futures **mapped** (ES/NQ/RTY/YM) rather than sourced. **No commodity options.**
- **Coverage:** 3,500+ US stocks/ETFs/indices for Equity Hub and Compass; 3,000–3,500+ for Tape (marketing copy says both on different pages); **400+ symbols for HIRO**; **SPX/SPY/ES only for TRACE**.
- **Real-time vs daily:** a genuine two-speed model. Real-time or near-real-time: HIRO, Tape, TRACE (1-minute), Volatility Dashboard current-day, Real Time Updates chart. Once per day: Equity Hub level models (Total OI "updates nightly before market open"; Synthetic OI "updates daily before market open"), and the third-party level files, which "automatically update at 3 AM EST daily".
- **History depth:** Compass ranks against "the prior year's values" and is "backed by one year of backtesting data"; Equity Hub offers a **Historical Lookback** of "one year of historical data" plus a 10-day level history; HIRO offers a 5-day historical lookback; TRACE projects 5 days forward.

**EVIDENCE.**
- "OPRA (Options Price Reporting Authority) — the consolidated feed of options quotes and trade data from all US options exchanges" — "Where does SpotGamma's data come from?", https://support.spotgamma.com/hc/en-us/articles/50266146223123-Where-does-SpotGamma-s-data-come-from (tier: official help centre; updated 2026-08-07; `verified`). The same article states the published metrics (GEX, HIRO, Call/Put Walls) are SpotGamma's own calculations, not third-party.
- Total OI model: "Pulls in total OI, includes some SpotGamma adjustments, and predominantly assumes that options are sold by market makers." Synthetic OI model: "Enhances data precision by eliminating assumptions and categorizing transactions based on multiple new data feeds and proprietary SpotGamma algorithms." — Equity Hub category, "What is the Equity Hub Synthetic OI (Open Interest) Model?" (updated 2026-08-24; `verified`).
- "Negative OI values mean that SpotGamma estimates market makers are net short those options contracts." — Equity Hub category (updated 2026-05-06; `verified`).
- "The data powering TRACE updates every 1-minute throughout the trading day" — TRACE category (2024-09-20; `verified`).
- "Once installed, TradingView levels automatically updated at 3 AM EST daily." — Futures Integrations (updated 2026-08-31; `verified`). URL rotation: the level-file URL changes monthly on the second Sunday, with email notice.
- HIRO "aggregates the delta notional value from every option trade, estimating the hedging requirement associated with each transaction"; covers "400+ stocks, ETFs, and indices" — HIRO category (`verified`).
- "SpotGamma does not currently support commodity options (Gold, Oil, Silver, Crude, etc.)" — Getting Started (updated 2026-03-26; `verified`).

**INTERPRETATION.** The **Total OI vs Synthetic OI** split is the single most instructive data decision in this product. Total OI is honest about its assumption ("predominantly assumes that options are sold by market makers"); Synthetic OI is the paid upgrade that removes it. SpotGamma sells the *removal of a modelling assumption* as the tier boundary — and documents the assumption plainly in the free-of-charge-to-read help centre. It also ships **negative open interest** as a first-class, explained output rather than clamping it to zero.

**RELEVANCE TO UCT.** UCT's GEX and dealer-positioning rails face the identical assumption (who sold the option). Publishing which assumption a number rests on, in the number's own documentation, is the transferable practice here — it matches UCT's existing standing rule that a claim must name a field path.

**CONFIDENCE.** 🟢 for source, coverage counts and the two-speed refresh model (all directly quoted from dated official articles). 🟡 for latency figures, which are marketing claims I could not measure. **Ceiling:** measured latency needs a seat and a clock.

**RECOMMENDATION (hypothesis).** *Name the assumption beside the number, and make removing it the upgrade.* A positioning rail that says "this number assumes dealers are short every option" in the tooltip is more defensible than one that does not, and the honest version is also the sellable one.

**OPEN QUESTION.** What exactly are the "multiple new data feeds" behind Synthetic OI? Deliberately undisclosed. This is the one methodological gap that no amount of public reading will close.

---

## G. Customization

**OBSERVATION.** Customisation arrived late and is concentrated in **Canvas** (June 2026). Three nested objects: **Workspace** (a saved page, switchable via a dropdown at the top) → **Container** (a movable, resizable region holding 1–5 components, either tabbed or single) → **Component** (30+ available: HIRO, TRACE, Tape, Compass, Founder's Notes, Volatility Dashboard charts, Equity Hub charts). **Grouping** links components so that changing the ticker in one changes it in all. Elsewhere: the Equities Table supports filtering and custom columns; Tape supports 20+ per-trade filter metrics with saveable configurations; HIRO exposes toggles for Total/Put-Call, All Trades/Next Expiry, rolling window (1-minute to 1-day), timezone/trading hours, log scaling and custom technical indicators.

**EVIDENCE.**
- "HIRO, Tape, and TRACE are limited to two instances per Workspace." — Canvas → "Are there limits on how many components I can add?" (2026-06-29; `verified`).
- "Only SpotGamma charts pointed at a single ticker can be grouped, such as Equity Hub charts." and "Changing the ticker in any grouped component updates the ticker for every other component." — Canvas → "Which components can be grouped?" / "Canvas Grouping" (2026-06-29; `verified`). Components showing multiple tickers (Compass) cannot be grouped; a component belongs to at most one group.
- "Any layout you design is saved as a separate Workspace." (2026-06-29; `verified`).
- "Grouping is ideal when you want to analyze multiple stocks quickly from several different angles." — Canvas (2026-06-29; `claimed`).
- Equity Hub export: "a download button located above the data grid" (2026-07-16; `verified`).
- No multi-monitor feature is documented anywhere. No mobile app is documented anywhere.

**INTERPRETATION.** Canvas is a straightforward **grid workspace with symbol-link groups** — the same design pattern as a professional charting platform's colour-link groups, arrived at independently. The **per-component instance cap** (two each for HIRO, Tape, TRACE) is the notable detail: it is almost certainly a cost/streaming guard expressed as a product rule, and SpotGamma chose to state it in the documentation rather than let a user hit an opaque failure.

**RELEVANCE TO UCT.** This is a near-exact analogue of UCT's `/charts` workspace with its A/B/C/D colour groups and its multi-chart grid cap. SpotGamma reached the same two conclusions — link groups, and a hard cap on expensive components — which is corroboration that both are forced by the physics rather than by taste.

**CONFIDENCE.** 🟢 for the Canvas model (four direct quotes from dated official articles). 🔴 for multi-monitor, mobile and templates — no evidence either way. **Ceiling: no seat.**

**RECOMMENDATION (hypothesis).** *Publish the cap.* If a workspace limits expensive widgets, saying so in the docs ("two instances per workspace") converts a mysterious failure into an understood rule. Worth considering wherever TERMINAL-NEXT bounds a costly component.

**OPEN QUESTION.** Are Workspaces shareable between users, or exportable? Not documented — and for a desk that wants a standard layout, that is the question that matters.

---

## H. Search / commands

**OBSERVATION.** Search is **per-surface ticker entry**, not global. Compass: "Type in the ticker name in the search box to populate on the grid." Equity Hub: "type the symbol at the top of the page". The watchlist offers a search-or-dropdown symbol picker. **No command palette, no global search, no keyboard shortcut is documented anywhere in the help centre**, across all sixteen categories.

**EVIDENCE.** Compass and Equity Hub quotes above (`verified`); watchlist quote in section C (`verified`); absence established by a full-text search of the help centre for keyboard/shortcut/palette terms returning nothing relevant (tier: official help centre index; 2026-09-02).

**INTERPRETATION.** Navigation efficiency is not a competitive axis for SpotGamma. Its users spend the session watching two or three symbols, not traversing hundreds — so per-page ticker entry is adequate and a palette would be over-engineering for the persona.

**RELEVANCE TO UCT.** A useful negative datapoint for TERMINAL-NEXT: a successful positioning product ships with *no* command surface. Whether a desk that traverses many names needs one is a different question, and SpotGamma's silence is not evidence against it.

**CONFIDENCE.** 🔴 for the negative claim. Absence from documentation is weak evidence of absence from the product; help centres routinely omit shortcuts. **Ceiling:** one authenticated session pressing `Ctrl+K` would settle it. The owner could supply this with a one-month Alpha subscription or a subscriber's screen recording.

**RECOMMENDATION (hypothesis, weak).** *Command surfaces may be a desk feature, not a member feature.* Worth separating the two personas before investing in one for TERMINAL-NEXT.

**OPEN QUESTION.** Does the app resolve ambiguous tickers (e.g. `BRK.B` vs `BRK-B`) and does it search company names, or symbols only? Undetermined.

---

## I. AI

**OBSERVATION.** **There is no shipped AI feature and no AI marketing.** A full-text search of the help centre for artificial intelligence, machine learning, assistant, chatbot and automated summaries returns nothing. The nearest thing is the **Opening Setup** report, described as algorithmically generated from a proprietary pipeline (a 0–100 SG Flow Signal, screened setup profiles, ranked institutional positions) — statistical, not generative. **FlowPatrol** is human analysis of algorithmically surfaced data. The Founder's Note is written by a named human, Brent Kochuba.

**EVIDENCE.**
- Help-centre search for AI/ML/assistant/chatbot terms: no relevant articles (tier: official help centre full-text search; 2026-09-02; `verified` as an absence within that corpus).
- "SpotGamma's Opening Setup is a four-page report delivered every morning before the market opens." and "Nothing in the report is a recommendation to buy or sell any security." — Reports category (created 2026-09-01; `verified`).
- Founder's Note authored by Brent Kochuba, twice daily (`verified`).
- No AI claim appears on the home page or the pricing page (2026-09-02).

**INTERPRETATION.** This is a **deliberate and notable abstention** in 2026. A product whose entire value is "trust these numbers" has chosen not to put a generative layer between the user and the numbers; instead it scaled interpretation by hiring a person to write twice a day and by shipping a deterministic report. For a domain where a fabricated level would be indistinguishable from a real one until the trade loses money, that is a coherent risk position — not a technology gap.

**RELEVANCE TO UCT.** UCT runs a grounded-LLM layer (wire, coaching, COT narrative) with grounding gates. SpotGamma's abstention is the strongest available public argument that in positioning analytics the **binding constraint is groundedness, not fluency** — and it is evidence that a competitor can win this niche with zero AI.

**CONFIDENCE.** 🟡. Absence-of-AI is established only within the documentation corpus and the public marketing pages; an unannounced in-app feature would not appear there. **Ceiling: no seat.** A subscriber could confirm in thirty seconds.

**RECOMMENDATION (hypothesis).** *In positioning analytics, a narrated number must be traceable to the number.* SpotGamma's structure — deterministic report + named human commentary — is one way to get there; UCT's grounding-gate approach is another. The transferable idea is that **the interpretation layer should not be able to invent a level**, whichever mechanism enforces it.

**OPEN QUESTION.** Is SpotGamma abstaining on principle, on cost, or merely not yet shipped? No public statement exists.

---

## J. UX: strengths and weaknesses

**OBSERVATION.**

*Strengths.*
- **A vocabulary a beginner can learn.** Each key level has a help article structured as "Basic Points" → "Intermediate" → strategy, so a member can enter at their own depth. The Glossary carries ~210 articles across seven sections, including 38 beginner and 56 advanced trading concepts.
- **Every tool has a "How to Trade with…" checklist article** — Founder's Note, Equity Hub, HIRO, Volatility Dashboard each have a numbered routine. The product ships not just the surface but the ritual.
- **Published hit rates on its own levels.** "The Call Wall has held in 83% of daily trading sessions"; "The Put Wall has held in 89% of daily trading sessions."
- **Consistent colour semantics** across tools (blue = positive gamma / stability; red = negative gamma / volatility in TRACE; red = below-average IV, green = elevated IV in the Fixed Strike Matrix — note these two conventions are *not* the same, see weaknesses).
- **Educational onboarding is a named product**: the "How To Use SpotGamma (HTUSG) Course — a self-paced video course walking through every tool on the platform", plus "Q&A Webinars — live Q&A sessions every Monday and Thursday at 1:00 PM ET".

*Weaknesses / anti-patterns.*
- **Colour means opposite things in different tools.** Red is "danger / negative gamma" in TRACE and "below-average IV" (i.e. cheap options, often an opportunity) in the Fixed Strike Matrix. Both are documented; neither is reconciled.
- **Naming collisions in the user's own head**: Key Gamma Strike, Large Gamma Strike, Absolute Gamma and Key Delta Strike are four separate levels with overlapping definitions, distinguished partly by *which product surface they appear on* (Large Gamma Strike on index products, Key Gamma Strike on stocks in Equity Hub). That is a taxonomy whose boundary is the implementation, not the concept.
- **Documentation drift.** The help centre currently carries **two different price lists** (see section L). A pricing page and a help article disagreeing is the classic second-authority-over-one-value defect.
- **"Indicies" is misspelled** as a top-level category name in production since 2023-03-30.
- **Level files rotate URLs monthly** (second Sunday), requiring every integration user to re-paste a URL — a recurring manual chore designed into the product.
- **No documented mobile experience** at all.

**EVIDENCE.** Glossary section/article inventory from the help-centre API (`verified`); "The Call Wall has held in 83% of daily trading sessions" / "The Put Wall has held in 89% of daily trading sessions" — Founder's Note category (`verified`, `claimed` as a statistic since no methodology or sample window is published); HTUSG and Q&A quotes — Getting Started (updated 2026-03-25; `verified`); Fixed Strike Matrix colour convention — Volatility Dashboard category (2023-12-11; `verified`); TRACE colour convention — TRACE category (2024-09-20; `verified`); monthly URL rotation — Futures Integrations (updated 2026-08-31; `verified`); category name "Indicies" — categories.json, `created_at` 2023-03-30 (`verified`).

**INTERPRETATION.** SpotGamma's UX strength is **pedagogical**, not interactional: it wins by teaching a vocabulary and a ritual, and it tolerates real inconsistency in the surfaces themselves. The published hit rates are the most interesting artefact — and also the most dangerous, because **83% and 89% are quoted without a base rate**. Any strike near the money "holds" on a large fraction of days; without the base rate for an arbitrary nearby strike, those figures describe the market's daily range distribution as much as the level's predictive power.

**RELEVANCE TO UCT.** The base-rate point is a direct echo of an existing UCT lesson about hit rates. The "every tool ships a checklist article" pattern maps onto UCT's coaching layer. The colour-semantics collision is a caution for any multi-surface UCT design where red/green already carries P&L meaning.

**CONFIDENCE.** 🟡. Strengths and weaknesses are drawn from documentation and marketing, not from using the product; a real density/onboarding judgement needs a seat. **Ceiling: no seat, no screenshots at native resolution.**

**RECOMMENDATION (hypothesis).** *A published hit rate without its base rate is a liability, not a feature.* If TERMINAL-NEXT publishes level statistics, pairing each with the base rate for a comparable arbitrary level would make it more defensible than the benchmark. Corollary anti-pattern: **do not let one colour carry two meanings across surfaces**.

**OPEN QUESTION.** What sample window and definition of "held" produce 83%/89%? Unpublished.

---

## K. Performance

**OBSERVATION.** All figures below are **claimed by the vendor**, never measured by me.

| Surface | Claimed cadence |
|---|---|
| TRACE | "updates every 1-minute throughout the trading day" |
| HIRO | real-time; historically improved "to 30 second increments, from 60 second increments" (change announced March 2022) |
| Tape flow | "real-time data on every options transaction" |
| Tape Highlights screeners | "every 30 seconds" |
| Equity Hub Total OI | nightly, before market open |
| Equity Hub Synthetic OI | daily, before market open; "near real-time" positioning shifts (marketing) |
| Volatility Dashboard | real-time current-day, end-of-day for history |
| Third-party level files | 3 AM EST daily |
| Founder's Note | AM 5:30–8:30 AM ET; PM 4:00–7:00 PM ET |

**EVIDENCE.** TRACE quote — TRACE category (2024-09-20; `claimed`). HIRO 60s→30s — spotgamma.com/hiro/ announcements (2022-03; `claimed`, and *historical*, not necessarily current). Tape figures — spotgamma.com/tape/ (2026-09-02; `claimed`). Equity Hub model cadence — Equity Hub category (updated 2026-08-24; `verified` as documented behaviour). 3 AM EST — Futures Integrations (updated 2026-08-31; `verified`). Founder's Note windows — Founder's Note category (`verified`).

**INTERPRETATION.** The architecture implied by these numbers is a **1-minute batch for the heavy heatmap, a streaming path for flow, and a nightly batch for the level models**. Nothing suggests sub-second anywhere. That is a meaningful benchmark: a commercially successful positioning product does not need tick-level latency, because the *decision* it supports (is price near a level, is flow pushing) resolves on a scale of minutes.

**RELEVANCE TO UCT.** UCT already runs a push bars rail and a live options tape at tighter cadence than this. The learning is not "go faster" but "the level model itself can be a nightly batch" — which is cheap, and is what SpotGamma charges $299/month for.

**CONFIDENCE.** 🔴 as *performance*. These are cadence claims, not observed responsiveness; I measured nothing, and I saw no density figures at all. **Ceiling: no seat.** A single session with the network tab open would convert every row above from `claimed` to `verified`.

**RECOMMENDATION (hypothesis).** *A positioning model refreshed nightly, plus a real-time overlay of where price sits against it, may be sufficient.* Worth testing before assuming a positioning surface needs streaming recomputation.

**OPEN QUESTION.** Is the 1-minute TRACE cadence a model constraint or a delivery constraint? Undetermined.

---

## L. Pricing / business model

**OBSERVATION.** Two consumer tiers, per-seat, self-serve, no enterprise offering, no free trial documented, no prorated refunds.

| | Essential | Alpha |
|---|---|---|
| Monthly | **$99/mo** | **$299/mo** ("Most Popular!") |
| Annual (standard) | **$74/mo, billed $891/yr** | **$224/mo, billed $2,691/yr** |
| Annual (promo shown 2026-09-02) | **$45/mo — $534 first year**, then $891 "loyalty rate" | **$125/mo — $1,494 first year**, then $2,691 "loyalty rate" |
| Includes | Founder's Note, FlowPatrol, Key Levels, Equity Hub (Total OI lens), Compass & Scanners, Tape, Options Calculator, Discord, weekly/biweekly live Q&A | Everything in Essential **plus TRACE, HIRO, Volatility Dashboard, Equity Hub Synthetic OI lens** |

Free, no subscription: SPX Gamma Exposure chart, Options Profit Calculator, Implied Earnings Moves chart, Volatility Ranking chart. Free with registration: the daily FlowPatrol report (one week free).

**EVIDENCE.**
- https://spotgamma.com/pricing/ (tier: official pricing page; fetched 2026-09-02; `verified`): monthly $99 / $299; annual promo "50% off" at $45/mo ($534 first year, $891 loyalty rate) and $125/mo ($1,494 first year, $2,691 loyalty rate).
- "What is the cost of a SpotGamma Subscription?", https://support.spotgamma.com/hc/en-us/articles/1500002666102-What-is-the-cost-of-a-SpotGamma-Subscription (updated 2026-08-07; `verified`): Essential "$99", Alpha "$299"; annual "$74 per Month, Billed $891 Annually" and "$224 per Month, Billed $2,691 Annually" at a stated 25% saving.
- ⚠️ **Contradiction inside SpotGamma's own help centre.** A second, later article (updated 2026-03-26 in the same corpus) states Essentials at "$9/month or $4/month billed annually" and Alpha at "$99/month or $24/month billed annually". Two official sources disagree by an order of magnitude. **I treat $99 / $299 as the standing price** because it is corroborated by the live pricing page *and* by the more recently updated cost article (2026-08-07), and because $891 and $2,691 annual figures appear identically in both of those. The $9/$99 figures are recorded here as an unresolved documentation defect, not as a price.
- Tier boundary: Total OI "available to Essential and Alpha subscribers"; Synthetic OI "Alpha-only access" — Equity Hub category (updated 2026-08-24; `verified`).
- Cancellation: "You will have access to your SpotGamma subscription until your next renewal date."; monthly cancellable before renewal with no prorated refund; annual not partially refundable once service begins — Subscription & Membership category (updated 2024-05-31 / 2026-08-16; `verified`).
- No professional/non-professional data distinction appears anywhere — consistent with OPRA-derived aggregates rather than redistributed quotes.

**INTERPRETATION.** The tier boundary is drawn along **model quality and real-time visualisation**, not along data volume: Essential gets all 3,500 names with an assumption baked in; Alpha removes the assumption and adds the three real-time surfaces (TRACE, HIRO, Volatility Dashboard). That is a clean, defensible ladder — the free tier hands out a *snapshot* (SPX gamma chart), Essential hands out a *daily model*, Alpha hands out *the intraday view*.

**RELEVANCE TO UCT.** UCT's own tiering question is the same shape. The transferable structure is: **snapshot free → daily model paid → intraday paid more**, with the upgrade being a *better assumption*, not merely more rows.

**CONFIDENCE.** 🟢 for $99/$299 and the annual figures (two independent official sources agree). 🟡 overall because the vendor's own documentation contradicts itself; the promo figures are dated 2026-09-02 and will expire.

**RECOMMENDATION (hypothesis).** *Tier on the quality of the model, not the size of the dataset.* "Same coverage, fewer assumptions" is a boundary a member can understand and a boundary that does not degrade the free/cheap tier into uselessness.

**OPEN QUESTION.** What is the actual Essential/Alpha mix? Alpha is marked "Most Popular!", which is marketing placement, not evidence.

---

## M. Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **Name a small fixed set of levels and never rename them.** *Hypothesis:* a member who can say "we're above the Volatility Trigger" carries the regime read between the wire, the chart and the Discord without translation; a member who must say "the level from the third column of the positioning table" cannot. **Workflow G** (understand the regime), and the Morning Wire's voice. *Cost:* the names become a permanent compatibility surface — renaming one later is a migration, not an edit.

2. **Publish the assumption beside the number, and sell its removal.** *Hypothesis:* documenting "this model assumes dealers sold every option" in the metric's own tooltip makes a positioning rail defensible under member scrutiny, and it also produces the natural upgrade boundary (Total OI → Synthetic OI). **Workflow G**, and any UCT surface that publishes a dealer-positioning number.

3. **Ship a "how to trade with this" routine alongside every analytic surface.** *Hypothesis:* SpotGamma has a numbered checklist article for each of the Founder's Note, Equity Hub, HIRO and the Volatility Dashboard; the ritual is what converts a page into a habit. **Workflow D and F**, and a natural fit for UCT's existing coaching layer, which could deliver the checklist in context rather than as a help article.

4. **Symbol-link groups plus a published per-component cap.** *Hypothesis:* "changing the ticker in any grouped component updates it in every other" is the right default for a multi-panel workstation, and stating the expensive-widget cap in the docs ("two instances per Workspace") is cheaper than an opaque failure. **Workflow A and F.** UCT already has the group mechanic; the *publishing the cap* half is the new idea.

5. **A two-speed data contract, stated out loud.** *Hypothesis:* users tolerate a nightly model far better when the product says which parts are nightly and which are live. SpotGamma tells you the levels land at 3 AM and the flow is live. **Workflow D and G.** This is cheap and it prevents the worst failure mode — a member trading a stale level believing it is fresh.

6. **A daily human note anchored to the same vocabulary as the surfaces.** *Hypothesis:* the Founder's Note is what makes the levels usable, and it works because it cites the exact same named levels the app renders. **Workflow D.** UCT already has the wire; the transferable constraint is *vocabulary identity* between the wire and the surfaces.

7. **Deliver levels into the chart the member already uses.** *Hypothesis:* six third-party integrations (TradingView, Bookmap, NinjaTrader, Jigsaw, eSignal, Sierra Chart) suggest the destination for a level is the member's chart, not the vendor's page. **Workflow F.** UCT's existing Pine parity work is the same bet.

8. **An "Options Impact" gauge — how much does positioning matter for *this* name.** *Hypothesis:* "The Options Impact gauge measures how large gamma exposure is relative to the stock's notional trading volume" is a **relevance gate**: it tells a user when to *ignore* the positioning read. A rail that says when not to trust it is more trustworthy. **Workflow A.**

---

## N. Bad ideas for UCT (features/conventions to avoid, and why)

1. **A published hit rate without its base rate.** "The Call Wall has held in 83% of daily trading sessions" is unfalsifiable and probably flattering: no sample window, no definition of "held", no comparison to an arbitrary nearby strike. Copying the *format* of this claim would import the defect. If UCT publishes a level statistic, publish the base rate beside it or publish nothing.

2. **One colour, two meanings across surfaces.** Red is negative gamma (bad) in TRACE and below-average IV (potentially good) in the Fixed Strike Matrix. In a product where UCT already spends red/green on P&L and on breadth heat, a third contradictory semantic would be actively harmful.

3. **A taxonomy whose boundary is the implementation.** Absolute Gamma / Key Gamma Strike / Large Gamma Strike / Key Delta Strike are distinguished partly by which product page they appear on (index vs equity). Four near-synonyms is three too many, and "which surface am I on" is not a concept boundary.

4. **A monthly-rotating integration URL.** Level files change URL on the second Sunday each month, so every integration user re-pastes a URL twelve times a year or silently trades yesterday's levels. Any UCT export must either be stable or must fail loudly when stale — a silently-stale level file is the worst of both.

5. **Letting the documentation carry two prices.** SpotGamma's own help centre currently states both $99/$299 and $9/$99. Two authorities over one value, in the artefact a prospect reads first.

6. **Growing tool-by-tool and retro-fitting the workspace.** Canvas landed in June 2026, years after the tools. The consequence is visible: components that cannot be grouped (Compass), per-component instance caps, and a per-page ticker box that the workspace has to reconcile. For TERMINAL-NEXT, deciding symbol propagation before the surfaces is likely cheaper.

7. **Refusing an API entirely.** Defensible for SpotGamma's moat, but UCT already has an internal desk that consumes its own data. Copying the "no API" posture would be copying a *commercial* decision as if it were an *architectural* one.

8. **Shipping no mobile story.** Not one help-centre article addresses mobile. UCT's member base is demonstrably touch-heavy; this is a gap to notice, not a pattern to adopt.

---

## O. Screenshots / evidence links (no images reproduced)

Official product pages carrying screenshots and interactive demos (fetched 2026-09-02):
- https://spotgamma.com/ · https://spotgamma.com/pricing/ · https://spotgamma.com/hiro/ · https://spotgamma.com/trace/ · https://spotgamma.com/equity-hub/ · https://spotgamma.com/tape/ · https://spotgamma.com/about/ · https://spotgamma.com/free-tools/
- Free, no-login interactive artefacts (the best zero-cost look at SpotGamma's actual rendering): https://spotgamma.com/free-tools/spx-gamma-exposure/ · https://spotgamma.com/free-tools/implied-earnings-moves/ · https://spotgamma.com/free-tools/volatility-ranking-chart/ · https://spotgamma.com/free-tools/options-profit-calculator/

Official help-centre articles containing embedded product screenshots (referenced in body text; images not reproduced here):
- Glossary → "Hedge Wall" (embeds "SpotGamma Equity Hub Composite View for NVDA"), "Key Gamma Strike" (embeds "SpotGamma Equity Hub Composite View for TSLA"), "Combos" (embeds "SpotGamma Combo Strike Chart for SPY"), "Cloud Notes" (embeds a Bookmap platform example).
- Canvas → "What is Canvas?", "Canvas Key Features", "Canvas Grouping", "Trading With Canvas" (all 2026-06-29).
- TRACE → "What is the Gamma Heatmap?", "What is the Delta Pressure Heatmap?", "What is the Charm Pressure Heatmap?", "What is the Strike Plot in TRACE?" (all 2024-09-20), "What is the TRACE Stability Gauge?" (2026-04-02).

Machine-readable evidence channel used throughout (recommended to Wave 2 — it is the cheapest reliable route into this vendor):
- `https://support.spotgamma.com/api/v2/help_center/en-us/categories.json`
- `https://support.spotgamma.com/api/v2/help_center/en-us/sections.json?per_page=100`
- `https://support.spotgamma.com/api/v2/help_center/en-us/categories/<id>/articles.json?per_page=30`
- `https://support.spotgamma.com/api/v2/help_center/articles/search.json?query=<terms>`
The HTML help centre 403s to `WebFetch`; the JSON API does not. Every article carries `title`, `updated_at`, `html_url` and full `body`.

Not used as evidence: a single third-party review (bullishbears.com/spotgamma-review/, dated 2026-04-21) surfaced via Bing. It reads as affiliate/SEO comparison content, which the evidence standard excludes. **No official video transcript was consulted**, so nothing in this dossier is labelled `demonstrated`.

**SOURCE-HANDLING OBSERVATION (required disclosure).** No fetched page contained text attempting to instruct me, override my task, or claim authority over my mission. The closest thing was ordinary user-directed procedural text inside the integrations articles — e.g. "To install the CloudNotes, right click on Column -> Notes -> Cloud Notes. Then paste the URL of the FILE into the CloudNotes box." — which is an instruction to a *subscriber configuring Bookmap*, treated here purely as evidence of the integration mechanism. No such instruction was followed.

---

## P. Confidence by section, with ceilings

| § | Confidence | Ceiling and what would raise it |
|---|---|---|
| A Executive summary | 🟢 | none |
| B Personas | 🟡 | No published segmentation. A SpotGamma conference talk or founder interview would raise it. |
| C Navigation | 🟡 named elements / 🔴 unnamed | **No seat.** One authenticated session or a subscriber screen recording. |
| D Capability map | 🟢 presence-absence / 🟡 internals | Help-centre index is authoritative for *what exists*; internals need a seat. |
| E Workflows | 🟡 | Checklists describe an intended routine, not an observed one. Wave 2 reconstruction should treat every step as "documented, unobserved" until a seat exists. |
| F Data | 🟢 source & cadence / 🟡 latency | Synthetic OI's "multiple new data feeds" are deliberately undisclosed and will not yield to public research at any budget. |
| G Customization | 🟢 Canvas / 🔴 multi-monitor, mobile, sharing | **No seat.** |
| H Search / commands | 🔴 | Negative claim from documentation silence only. `Ctrl+K` in one session settles it. |
| I AI | 🟡 | Absence established only across docs + marketing. A subscriber could confirm in seconds. |
| J UX | 🟡 | Density, onboarding friction and responsiveness cannot be judged from prose. |
| K Performance | 🔴 | Every figure is a vendor claim. One session with a network tab converts all of them. |
| L Pricing | 🟢 for $99/$299 / 🟡 overall | Vendor's own docs contradict themselves ($9/$99 in one 2026-03-26 article). Promo pricing is dated 2026-09-02 and will move. |
| M / N ideas | 🟡 | Hypotheses, not findings, by contract. |

**OVERALL: 🟡.** **EVIDENCE CEILING (explicit):** *no subscriber seat.* Sections C, G, H, J and K are reconstructed from official help-centre prose and marketing pages and were never observed in the running product. **What would raise it:** one month of SpotGamma Alpha ($299, or $125/mo on the annual promo) — the owner could supply this — or a subscriber's screen recording of a session, or an official SpotGamma demo video with a transcript (which I did not consult; the search budget was spent on primary documentation instead). An honest reading of this dossier is: *the capability map, the data contract, the level vocabulary and the pricing are solid; the interaction design is inferred.*

---

## Final section — what SpotGamma would look like with UCT's proprietary intelligence (Part XXVI)

🟡 SpotGamma today stops at the level: it tells you where the Call Wall is, that it "held in 83% of daily trading sessions", and — through the Founder's Note — what Brent Kochuba thinks that means for the index this morning. It has no view of *you*. Give it UCT's proprietary layer and the missing half arrives: the knowledge base of setups and playbooks would let a Call Wall stop being a generic resistance line and become "this is the same structure that has produced a 61% win rate on your remount setup when the Volatility Trigger was above spot"; the personal-edge engine would gate the read on the user's own expectancy per setup rather than on the firm's aggregate; the regime classifier and exposure rating would replace a single Volatility Trigger with a scored, exposure-sized answer to "how much should I have on today"; and the journal would close the loop by measuring whether trading against SpotGamma's levels actually made *this* trader money, which is the one number SpotGamma structurally cannot produce because it never sees a fill. The Founder's Note would become a per-member note rather than one note for everyone, grounded in the same named levels but scored against the reader's book. The honest counterweight: SpotGamma's abstention from AI is a coherent risk position in a domain where a fabricated level is indistinguishable from a real one until money is lost, and any UCT-flavoured version of this product would be trading that safety for personalisation — which is only a good trade if the grounding gates hold, and if the personalised claim can still name the field path it came from.

---

## GAPS (budget not reached / not reachable)

- **No subscriber seat, therefore no observed UI.** Sections C, G, H, J, K are documentation-derived. This is the dossier's single dominant ceiling and it is nameable and purchasable: one month of Alpha.
- **No official video transcript consulted.** The evidence standard ranks official training content and video transcripts above practitioner commentary; I spent the budget on the help-centre corpus instead, which was denser per call. SpotGamma's YouTube channel and the "How To Use SpotGamma (HTUSG)" course are the untouched tier-1 sources. **Wave 2 should start there** — the HTUSG course walks "every tool on the platform" and would close most of C/G/H/J.
- **Search channel used:** `WebFetch` on known URLs (primary), plus the Zendesk help-centre JSON API (primary, and the workaround for the HTML 403), plus one browser tab for the initially-403'd HTML, plus **one** Bing query for practitioner commentary. `WebSearch` was never invoked (assumed exhausted per the preamble).
- **Queries I could not run:** targeted searches of trader forums (Reddit r/options, Elite Trader) for reported subscriber experience — the shared browser tab group was being churned by sibling roles and my tabs were closed under me twice, so I abandoned forum sweeps rather than fight for the tab. Practitioner evidence in this dossier is therefore **absent**, not merely thin, and no claim rests on it.
- **Synthetic OI methodology** is deliberately undisclosed by the vendor ("multiple new data feeds and proprietary SpotGamma algorithms"). No public source will close this; do not spend Wave 2 budget on it.
- **Two open contradictions left unresolved on purpose,** because resolving them by picking the prettier number would be worse than recording them: (i) the $99/$299 vs $9/$99 price conflict inside SpotGamma's own help centre; (ii) Tape ticker coverage stated as "3,000+" on one official page and "3,500+" on another.
- **Not attempted, by rule:** no login, no signup, no trial, no form submission, no purchase.

---

## SOURCES

Tier key: **T1** official documentation / help centre · **T2** official product & pricing pages · **T3** official company pages · **T7** general web search (used only to look for practitioner sources; not cited as evidence).

**Primary (26)** — all fetched 2026-09-02 unless the article's own `updated_at` is given.

1. T2 — https://spotgamma.com/ (home; positioning, product roster).
2. T2 — https://spotgamma.com/pricing/ (tiers, monthly + annual + promo).
3. T2 — https://spotgamma.com/hiro/ (HIRO product page; 2022 cadence announcements).
4. T2 — https://spotgamma.com/trace/ (TRACE product page).
5. T2 — https://spotgamma.com/equity-hub/ (Equity Hub product page; Total OI vs Synthetic OI lenses, Options Impact Score, Historical Lookback).
6. T2 — https://spotgamma.com/tape/ (Tape product page; flow/contract/summary/highlights, 30s refresh, 20+ filters).
7. T3 — https://spotgamma.com/about/ (Kochuba, 2020, CEO Matthew Fox, mission).
8. T2 — https://spotgamma.com/free-tools/ (free tool inventory; FlowPatrol registration).
9. T1 — `support.spotgamma.com/api/v2/help_center/en-us/categories.json` (16 categories with created_at; Canvas 2026-06-29, Reports 2026-09-01).
10. T1 — `.../en-us/sections.json?per_page=100` (full section inventory across all categories).
11. T1 — Glossary → SpotGamma Key Levels, section 1500001160601, 14 articles (Absolute Gamma 2026-07-21; Call Wall 2026-08-24; Cloud Notes 2026-06-16; Combos 2026-07-09; Hedge Wall 2026-08-22; Key Delta Strike 2026-07-14; Key Gamma Strike 2024-04-28; Large Gamma Strike 2026-08-06; Put Wall 2026-08-30; Reference Price; SG Implied 1-Day Move 2026-07-08; SG Implied 5-Day Move 2026-07-08; Volatility Trigger™ 2026-08-17; Zero Gamma 2026-08-17).
12. T1 — HIRO Indicator category 4418014983187 ("About the SpotGamma HIRO Indicator", "Using…", "How to Trade with…").
13. T1 — Scanners & Compass category 27544271731219 (Compass Guided/Explorer View; 15 named scanners; articles Feb–Jul 2026).
14. T1 — Reports category 54991632092819 (Opening Setup articles 2026-09-01; "What is FlowPatrol?" 2025-08-08).
15. T1 — Equity Hub™ category 360006259813 (Synthetic OI 2026-08-24; Equity Hub™ Levels 2026-05-06; negative OI 2026-05-06; Dark Pool Indicator).
16. T1 — TRACE Heatmap category 33607754385939 (Gamma / Delta Pressure / Charm Pressure heatmaps, Strike Plot, GEX — 2024-09-20; Stability Gauge 2026-04-02; ES futures guidance 2026-03-25).
17. T1 — Volatility Dashboard category 23981957172499 (Fixed Strike Matrix, Term Structure, Volatility Skew — 2023-12-11; VIX Term Structure 2025-12-22; look-back 2026-03-25; trading checklist 2024-04-09).
18. T1 — Founder's Note category 360006240953 ("Founder's Note", "How to Trade with the Founder's Note"; AM/PM windows, Call Wall 83% / Put Wall 89%).
19. T1 — Canvas category 53009462515731 / section 53009457260179, 9 articles all 2026-06-29 (Workspaces, Containers, Components, grouping, instance limits).
20. T1 — Futures Integrations category 1500000228282 (TradingView 2026-08-31; NinjaTrader 2026-08-26; Sierra Chart 2026-07-06; Bookmap, Jigsaw, eSignal; 3 AM EST daily update; monthly URL rotation).
21. T1 — Subscription & Membership category 1500000211921 (subscription levels 2026-08-07/2026-08-16; cost article 1500002666102 updated 2026-08-07; cancellation 2024-05-31; Discord 2023-11-24 / 2023-12-13).
22. T1 — https://support.spotgamma.com/hc/en-us/articles/50266085426195-Does-SpotGamma-have-an-API-Can-I-export-data (updated 2026-07-16) — "A public API is not yet available."
23. T1 — https://support.spotgamma.com/hc/en-us/articles/50266146223123-Where-does-SpotGamma-s-data-come-from (updated 2026-08-07) — OPRA + exchange feeds + proprietary calculations.
24. T1 — Glossary → Getting Started section 15412865207443 (HTUSG course; Mon/Thu 1:00 PM ET Q&A — 2026-03-25; no commodity options — 2026-03-26; SpotGamma Gamma Index™ and the per-metric definitions — 2023-04-02).
25. T1 — Help-centre search, alerts (`.../articles/search.json?query=alerts...`): "What are HIRO Flow Alerts?" 2026-07-26; "What are the Equity Hub™ Call and Put Wall Alerts?" 2026-05-27; HIRO Indicator Trading Checklist 2026-06-29; HIRO chart axes 2026-06-30.
26. T1 — Help-centre search, navigation & watchlists: "What is Canvas?" 2026-06-29 (left-nav "Market Central"); "What is SpotGamma Compass?" (ticker search box); "How do I add tickers to my Equity Hub™ Watchlist?" 2023-02-26; "How do I remove symbols from my watchlist?" 2022-02-15; "Trading With Canvas" 2026-06-29. Plus the AI-term search returning no relevant articles (the basis for section I's negative finding).

**Secondary (1) — surfaced, examined, and NOT used as evidence.**

27. T7 — Bing query `"SpotGamma" review subscriber experience HIRO worth it` (2026-09-02). Only third-party result of any substance: bullishbears.com/spotgamma-review/ (2026-04-21), which reads as affiliate/SEO comparison content and is excluded by the evidence standard. Recorded here so a later reader knows the practitioner tier was looked for and found empty, not skipped.
