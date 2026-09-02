---
id: B-FC-01
title: Fiscal.ai (formerly FinChat) — benchmark dossier
role: Benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: Fiscal.ai — Fiscal Terminal, Data Feed API, MCP Connectors (product formerly named FinChat)
confidence: 🟡
evidence_ceiling: No hands-on use of the terminal. The 7-day trial requires a credit card at signup and the contract forbids signing up or purchasing, so every claim about feel, density, latency and navigation is reconstructed from the vendor's own help centre, release log and tutorials. No practitioner corpus was recoverable inside the search budget.
sources: 18 primary; 0 usable secondary (1 attempted)
uct_relevance: high
status: draft
date: 2026-09-02
---

# Fiscal.ai (formerly FinChat)

> **Naming.** The company is **Fiscal.ai** (legal entity *Stratosphere Technology Inc.*, Toronto). The products are **Fiscal Terminal**, the **Fiscal.ai Data Feed API**, and **Fiscal MCP / MCP Connectors**. "FinChat" is the retired 2023–2025 brand; "Stratosphere.io" is a 2023 merger partner whose name survives as the legal entity. A reader searching for "FinChat" in six months will find nothing current — the slug of this file is historical, the product is not.

> **How this was researched.** `WebSearch` was exhausted before this role began. `docs.fiscal.ai` was reachable by `WebFetch`; `fiscal.ai` itself returns 403/429 to automated fetchers (Cloudflare), so those pages were read in **one browser tab, opened and closed by this role**, with no login, no form submission and no purchase. Where a fact rests on the vendor asserting it about itself, it is labelled **claimed**, not verified.

---

## A. Executive summary

**OBSERVATION.** Fiscal.ai is a web-based fundamental-research terminal for public equities, sold alongside an API and an MCP server that expose the same data to third-party platforms and AI agents. It began in 2023 as **FinChat**, an "ask questions about stocks" chat product with a prompt quota (10 free prompts; 50 prompts for $20/mo on a "Plus" plan), merged with the fundamentals site **Stratosphere.io** in November 2023, and rebranded to Fiscal.ai in 2025 alongside a $10M Series A led by Portage (total funding $13M; earlier backers TinySeed, Social Leverage, VanEck). The CEO states the reason for dropping "Chat" in the name plainly: *"The Chat interface has become a feature of what is possible, rather than the core fundamental problems we are solving with AI."*

**The product's PHILOSOPHY, in one sentence (Part CCXLVII):** *the durable asset is not the interface but the data contract — a number is worth having only if a human can click it and land on the exact page of the filing it came from, and that same number should reach you through a terminal, an API or an AI agent without changing.*

**EVIDENCE.**
- `https://fiscal.ai/blog/series-a-announcement/` — Tier 3 (official announcement), fetched 2026-09-02. Quote (≤40 words) above. **Verified** (rebrand, funding structure) · **claimed** (350,000 registered users).
- `https://fiscal.ai/changelog/` — Tier 1 (official release log), 2026-09-02: v1.1 (2023-04-20) "10 prompts for Free, 50 prompts for $20/mo on Plus Plan"; v2.0 (2023-11-29) "Merge with Stratosphere.io"; v5.2.1 (2025-10-02) "Removed Plus Tier". **Verified.**
- `https://fiscal.ai/` and `https://fiscal.ai/products/terminal/` — Tier 3, 2026-09-02: "Modern Financial Data Infrastructure"; "Institutional-grade data, 100% auditable to source". **Claimed.**

**INTERPRETATION.** This is the only product in the benchmark universe that has publicly *retreated* from an AI-chat identity while shipping more AI. The retreat is instructive: chat did not fail, it stopped being the differentiator once the data underneath was proprietary. Everything the company now sells — terminal, API, MCP — is a different faucet on one pipe, and the pipe's selling point is provenance plus speed (data published "in minutes" after a filing rather than days).

**RELEVANCE TO UCT.** Speaks to whoever owns AI Search, the Compass coaching layer and the wire's groundedness rails. UCT has already learned in its own domain that a claim is only as good as the field path behind it; Fiscal.ai has built a whole company around making that click-through the product.

**CONFIDENCE.** 🟢 on identity, history and positioning; 🟡 on what the terminal feels like in use. Ceiling as declared in frontmatter.

**RECOMMENDATION (hypothesis).** *If UCT's AI surfaces attached a click-through to the underlying artifact (the bar, the filing, the wire section, the KB row) rather than a citation string, groundedness would become checkable by a member instead of assertable by us.*

**OPEN QUESTION.** Did chat usage actually decline, or was it re-labelled? The changelog's last "Copilot" entries are December 2024; AI shipped after that is document-scoped summarisation, not conversation.

---

## B. User types / personas served

**OBSERVATION.** Three named audiences on the terminal product page — **Hedge Funds** ("leverage the fastest updates in fundamental data"), **Asset Managers**, **Individuals** ("powerful software and data without compromises with our individual investor plans") — plus a fourth, unlisted but structurally dominant persona: **platform builders** who embed the data (Perplexity, Kalshi, Stocktwits, MarketBeat, Alpaca, RavenPack/BigData.com, Aiera, Compound AI, NOF1 all have partnership posts). The self-serve price ladder ($49/$99 per month) is retail/prosumer; the enterprise motion is "Contact Sales".

**EVIDENCE.** `https://fiscal.ai/products/terminal/` — Tier 3, 2026-09-02 (three persona cards, verbatim labels). Partner roster derived from the blog index in `https://fiscal.ai/sitemaps/0.xml` — Tier 3, 2026-09-02 (titles only; individual partner posts not fetched). **Verified** (personas as stated) · **claimed** (customer names).

**INTERPRETATION.** The persona set has no trader in it. There is no day-trading, options, flow or intraday persona anywhere in the marketing. This is a *holding-period-weeks-to-years* product.

**RELEVANCE TO UCT.** UCT's desk is a swing/momentum equities-and-options desk. Fiscal.ai's persona set overlaps UCT's *research* half (the Model Book, Calendar, earnings prep) and not at all with its *tape* half (Live Flow, options flow, dark pool, breadth).

**CONFIDENCE.** 🟢 on stated personas; 🔴 on actual user mix (the 350,000 registered users figure is unaudited and "registered" is not "active").

**RECOMMENDATION (hypothesis).** *A benchmark whose persona list contains no trader is a fundamentals benchmark only; reading its earnings-prep workflow as a model for UCT's is sound, reading its dashboard as a model for TERMINAL-NEXT's home screen is not.*

**OPEN QUESTION.** What share of revenue is API/embed versus terminal seats? The rebrand narrative implies the former is now the strategic centre.

---

## C. Navigation: how users move

**OBSERVATION.** Navigation is **search-first and tab-based**, not command-driven. A global company search bar sits at the top of the terminal; from the dashboard, tickers are added by typing a name or ticker. A company page is a set of tabs (Overview · Financials · Estimates · Ownership · Industry · Filings · Investor Relations · Modeling), with a left sidebar offering the same destinations. The search modal can navigate **directly to a specific company tab** rather than always landing on the overview. Duplicate-tab support exists inside Dashboard, Charting, Screener and Financial Modelling, and "Query Tabs" hold multiple cross-document searches simultaneously. Some state persists across companies (financials period Annual/Quarterly/LTM/Semi-Annual; industry tab selection).

Keyboard evidence is thin and specific rather than systemic: **Ctrl+F transcript search** (with whole-word and case-sensitive matching), keyboard shortcuts attached to the annotation sidebar, and keyboard navigation in the redesigned Help Center. **No global command palette or Bloomberg-style command grammar is documented anywhere in the vendor's own materials.**

**EVIDENCE.** `https://fiscal.ai/changelog/` — Tier 1, 2026-09-02: v5.2.9 (2026-01-20) "improved search modal with direct navigation to specific company tabs"; v2.0.5 (2024-02-16) "Duplicate Tabs Feature in Dashboard, Charting, Screener, & Financial Modelling"; v5.4.4 (2026-03-06) "Query Tabs"; v5.6.4 (2026-04-28) "Enhanced Ctrl+F Transcript Search"; v5.9.7 (2026-08-27) financials-period preference persists across company pages; v5.5.2 (2026-03-20) "Annotation sharing … (also added new keyboard shortcuts)"; v5.9.5 "Redesigned desktop and mobile navigation". **Verified (vendor release log).** Company-page anatomy: `https://fiscal.ai/blog/ultimate-guide-to-using-fiscal-AI/` — Tier 1 (official tutorial), 2026-09-02.

**INTERPRETATION.** Fiscal.ai chose *fewer, deeper pages reached by typing a name* over *many surfaces reached by a memorised command*. That is the opposite pole from Bloomberg/Gödel and it is coherent with the persona: an investor opens two or three companies a day, not forty screens an hour. The cost is that power-user velocity has no ceiling-raiser — there is no documented way to go from anywhere to anywhere in one keystroke.

**RELEVANCE TO UCT.** Directly relevant to the TERMINAL-NEXT navigation question. It is the counter-example to the command-grammar cluster: a serious, well-funded product that deliberately did not build one, aimed at a user who does not need one.

**CONFIDENCE.** 🟡 — the tab/search model is documented in the vendor's own tutorial and release log; the *absence* of a command palette is an argument from silence across ~120 release entries and the help centre, which is strong but not proof. Ceiling: a single hands-on session, or one official demo video transcript, would settle it.

**RECOMMENDATION (hypothesis).** *Navigation style should be chosen from session shape, not from terminal fashion: a research surface whose user opens few entities deeply may be better served by a fast entity search plus persistent tab state than by a command grammar nobody rehearses.*

**OPEN QUESTION.** Is there an in-app shortcut sheet? Nothing in the help centre or changelog suggests one exists.

---

## D. Capability map (Part XIII taxonomy)

All entries below are **verified from the vendor's own release log, help centre or product pages**; none were exercised.

| Taxonomy slot | What Fiscal.ai ships | Evidence anchor |
|---|---|---|
| **Market overview** | Dashboard **Markets tab** = Top Stories news feed + Top Gainers/Losers; **Top Movers by Exchange**. US macroeconomic indicators shipped 2023 and are never mentioned again. No index/breadth/regime surface. | changelog v5.7.4 (2026-06-02), v5.8.8 (2026-07-16), v1.3.1 (2023-05-05) |
| **Security pages** | Company page: statistics card, business description, **Bulls Say v. Bears Say**, "What's Happening" (most important news of last 30 days), price chart; tabs for Financials, Estimates, Ownership, Industry/peers, Filings, Investor Relations, Modeling, Dividends. ETF and mutual-fund pages; select private companies (SpaceX); merged/delisted company pages. | Ultimate Guide; changelog v5.4.3, v5.7.1 |
| **Fundamentals** | 20 years / 40 quarters of IS, BS, CF, ratios; **standardized *and* as-reported** views; **Segments & KPIs** (2,500+ companies, manually verified); **Adjusted (non-GAAP) metrics**; custom metrics (re-orderable, percent-change toggle); common-size; QoQ toggle; 3/5/10-yr growth and CAGR metrics; NOPAT; per-employee metrics; ratio **formula tooltips** on hover plus a public formula list. | changelog v5.0, v5.2.2, v5.9.6, v5.9.5, v5.9.7; help FAQ |
| **News** | Proprietary Fiscal.ai news feed on company pages and dashboards, **tagged by event type and importance**, with filters; monthly AI news summaries; company news accumulation for coverage depth. | changelog v5.6.6 (2026-05-01), v5.7.3, v5.2 |
| **Earnings** | **Earnings Calendar v2**: Agenda / Day / Week / Month / **Heatmap** views, faceted search, CSV export (Max), event details, watchlist persistence, BMO vs AMC toggles; **earnings badge in the company header** for confirmed dates within 7 days showing session and exact time on hover; beats/misses vs consensus for 10+ years / 40+ quarters with a `#`/`%` toggle; transcripts available immediately after the call, auto-generated where needed; **earnings audio player** (persists across the app, click-to-audio from transcript text, redesigned as a compact bottom rail). | changelog v5.8.4, v5.9.5, v5.6.4, v5.6.5, v2.1, v5.9.7 |
| **Economic** | Effectively absent today. | argument from silence over the changelog |
| **Screening** | Metric screener over a stated **12,300-name universe** (MCP skill text) with hundreds of criteria ("200 different metrics" per the tutorial; "600+ financial line items & ratios" claimed for the AI screener in 2024), country and industry **include/exclude** toggles, min/max ranges, result sorting, result-count control, **XLSX/CSV export**, **AI natural-language screening**. | Screener tutorial; changelog v4.5.4, v2.2.0, v5.5.5; MCP skills doc |
| **Charting** | Fundamental charting across companies and metrics (line/bar, stacked, dual y-axis, index-to-0%, CAGR in legend, estimate periods drawn with striped fill, **Grid View** to isolate metrics, metric templates, invert values); price charts with custom date ranges and intraday for short durations; **technical analysis** (RSI, MACD, SMA, EMA; candlestick and line) added 2026-05-20; **shareable chart URLs** and an export modal (title, size, resolution, watermark). | changelog v5.7.1, v5.4.3, v5.4.1, v5.2.7, v1.5→v5.8.5 |
| **Alerts** | Notifications panel (news, press releases, SEC filings, IR events, quarterly results, realtime); **price alerts for stocks moving more than 5% in a day**. No user-defined threshold or condition alerts documented. | changelog v5.6.8 (2026-05-13); Ultimate Guide |
| **Portfolio / watchlist** | Dashboards as the home screen: tickers + user-chosen metric columns; **brokerage connections** (sync real positions; Interactive Brokers and Kraken named in the help centre); share counts drive allocation / industry / geography pie charts and weighted-average portfolio statistics; cash positions; **custom (non-equity) assets**; multi-currency. Free tier = 1 dashboard / 30 rows. | changelog v5.6.7, v5.4.1, v4.3; help FAQ; Ultimate Guide |
| **Documents** | Filings viewer and PDF viewer with bookmarks and document selector for multi-report events; **Query** — keyword search across *all* documents — plus Query Tabs; transcript **annotations** with highlight colours, PDF export and sharing; Morningstar research reports; **Fund Letters** from ~800 investment firms; data-correction requests submitted from inside the platform. | changelog v5.4, v5.4.4, v5.4.9, v4.5.5, v5.8.7, v5.5.2 |
| **Collaboration** | Shareable chart links and shared annotations; Enterprise/Organizations with team onboarding, billing and **role management in an admin panel**; embeddable Copilot for partner platforms. | changelog v5.0, v5.9.4, v3.6 |
| **AI** | See §I. | — |
| **Command / keyboard** | Search modal → direct tab navigation; Ctrl+F transcript search; annotation shortcuts. **No documented command palette.** | see §C |
| **Workspaces** | Duplicate tabs per module; query tabs; multiple dashboards (plan-gated); persisted period/tab preferences. **No multi-pane layout or multi-monitor story.** | changelog v2.0.5, v5.9.7 |

**INTERPRETATION.** The distribution is lopsided on purpose: fundamentals, documents and earnings are deep; market overview, economics, alerts and workspaces are shallow. Two of the shallow ones (alerts, workspaces) are exactly the slots a *monitoring* product would fill first — further confirmation this is a research product, not a monitoring one.

**RELEVANCE TO UCT.** UCT's Calendar/earnings-modal surface and its notebook/document work sit in Fiscal.ai's deep half; UCT's breadth, COT, exposure and flow rails have **no counterpart here at all**. The comparison is therefore useful for depth ideas and useless for coverage ideas.

**CONFIDENCE.** 🟢 per row on existence (vendor's own dated release entries); 🟡 on quality and on absences.

**RECOMMENDATION (hypothesis).** *A capability map derived from a dated public release log is more trustworthy than one derived from a marketing page — and a product that publishes such a log makes itself auditable by its own competitors, which is a cost worth paying.*

**OPEN QUESTION.** Are the shallow slots deliberate scope discipline or unshipped backlog? The changelog reads as discipline.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five

**A. "Why is this stock moving?" — WEAK.** Available: company page "What's Happening" (30-day news), importance-tagged news feed, notifications panel, >5% price alert, earnings badge. Missing: real-time price (quotes are **15-minute delayed**, EOD for non-first-party geographies), intraday tape, volume-versus-average context, options or flow, sector/breadth context. A user cannot answer "why is it moving *right now*" here; they can answer "what happened to this company recently".

**B. "Prepare me for earnings" — STRONGEST.** Calendar v2 (five views incl. heatmap, BMO/AMC, faceted search, watchlist persistence) → company page earnings badge with exact time → estimates page with 10y/40q beats-and-misses and high/low bands → prior transcript with Ctrl+F search, annotations and synced audio → segment/KPI history for the metrics that matter → AI summary of the filing/transcript with citations. After the print, first-party fundamentals land **3–7 minutes** later (claimed) and beats/misses are computed from as-reported data.

**C. "Research this company from scratch" — STRONG.** Overview (description, bulls/bears, stats) → Financials 20y/40q standardized *or* as-reported → Segments & KPIs → Ownership (insiders, transactions, 13F holders, insider-overlay chart) → Estimates → Filings/IR documents → **Modeling tab** with DCF, IRR, Reverse DCF and Comparables templates *pre-loaded with that company's data* → Fund Letters and Morningstar reports for outside opinion.

**D. "What matters today" — PARTIAL.** Dashboard Markets tab (top stories + gainers/losers), notifications, today's earnings calendar, importance-filtered news. There is no daily briefing artifact, no regime read, no "here is your day" composition.

**E. "Find a trade" — MISMATCHED.** The screener is fundamental (growth, quality, valuation, buyback, dividend); the vendor's own worked examples are 10-year revenue CAGR and ROIC screens. No entry/stop/target vocabulary, no setup taxonomy, no technical screening documented (TA exists on charts, not in the screener). This is idea *generation for a portfolio*, not trade *location*.

**F. "Monitor my universe" — GOOD-ENOUGH.** Dashboards with chosen metric columns, brokerage-synced real positions, notifications on filings/news/results, >5% price alerts, watchlist persistence in the calendar; the MCP **watchlist-monitor** skill is explicitly framed as "the what-changed dashboard". Ceiling: no conditional alerting.

**G. "Understand the regime" — ABSENT.** No breadth, no positioning, no volatility surface, no macro dashboard in current materials. This is the single clearest structural gap versus UCT.

**EVIDENCE.** Composed from `https://fiscal.ai/changelog/` (Tier 1), `https://fiscal.ai/blog/ultimate-guide-to-using-fiscal-AI/` and `https://fiscal.ai/blog/how-to-screen-for-stocks-on-finchat-io/` (Tier 1 official tutorials), `https://fiscal.ai/help/` FAQ (Tier 1), `https://docs.fiscal.ai/docs/guides/mcp-skills` (Tier 4) — all fetched 2026-09-02. **Verified** on feature existence; **reconstructed** on step order (no hands-on session).

**CONFIDENCE.** 🟡 overall — B and C are 🟢 on components and 🟡 on sequence; A, D, E, G are 🟡–🟢 as *negative* findings (the absences are consistent across every official artifact).

**RECOMMENDATION (hypothesis).** *Workflow B is the transferable one: UCT's earnings preparation could be judged against a product whose entire calendar exists to answer it, and the specific mechanic worth testing is the calendar's five views over one dataset rather than one view with filters.*

**OPEN QUESTION.** How does the modelling tab handle a company whose fiscal calendar is non-standard? A 2026-07-22 fix suggests this was a real defect class in charting.

---

## F. Data

**OBSERVATION.** Fiscal.ai runs a **two-tier data estate and says so publicly**:

- **First-party ("Fiscal.ai Data Feed"):** U.S., Canada, ADRs, U.K., EU — parsed from filings and IR content by "proprietary agentic infrastructure" with **human analyst verification**, published **3–7 minutes after earnings**, every figure **click-through auditable to the source page** (image, PDF and URL), available **standardized and as-reported**. Stated first-party breadth: **13,000+ public companies**.
- **Licensed:** every other geography is sourced from **S&P Capital IQ** and updates in **24–48 hours**. Research reports come from **Morningstar**.

Total stated coverage: **100,000+ public companies, ETFs and funds globally**; **Segments & KPIs for 2,500+** companies (the API docs scope segments/KPIs to "the largest 2,300 companies globally by market capitalization" — the two numbers disagree by ~200 and by *which* set is meant); screener universe stated as **12,300 names** in the MCP skills catalogue. History: **20+ annual and 40+ quarterly periods** of financials, **30+ years** of EOD prices, ~3 years of ownership, 5+ years of fund letters. Prices are **15-minute delayed** for first-party names and **end-of-day** elsewhere; intraday exists only for short-duration price charts. Asset classes: equities, ETFs, mutual funds, a handful of manually added private companies. **No options, no futures, no FX, no crypto quotes** (a Kraken *brokerage connection* exists; that is portfolio sync, not market data).

A licensing constraint is admitted in the help centre: *"Due to licensing agreements with our data providers, 20yrs of financial data is not available in the dashboard at this moment."*

**EVIDENCE.** `https://fiscal.ai/help/` FAQ answers (Tier 1, 2026-09-02) for sources, update cadence, coverage counts, the 20-year dashboard limitation, and export geography. `https://fiscal.ai/products/mcp/` (Tier 3): "Covering 13,000+ public companies across US, Canada, ADRs, UK & Europe"; data catalogue tiles including "Stock Quotes — 15-minute delayed … and EOD historical". `https://docs.fiscal.ai/` (Tier 4): history depths, "largest 2,300 companies globally" for Segments & KPIs, US-only ownership. `https://docs.fiscal.ai/docs/guides/mcp-skills` (Tier 4): "12,300-name universe". **Verified** as vendor statements · **claimed** for accuracy figures (99.5%+ accuracy, 95%+ retention on `https://fiscal.ai/blog/fiscal-ai-s-next-chapter-a-brand-built-for-the-modern-investor/`).

**INTERPRETATION.** The interesting move is not the coverage number, it is the **public admission of the seam**. Most prosumer products present one blended dataset; Fiscal.ai tells you which rows are theirs, which are S&P's, how each is refreshed, and what the licence forbids showing you. That is the same discipline UCT applies internally when it insists a number be derived through the shipping reader rather than restated — here it is applied *outward, to the customer*.

**RELEVANCE TO UCT.** Directly relevant to the wire, the Calendar's earnings pipeline and the Model Book's earnings table, all of which mix vendors (FMP, Finnhub, AlphaVantage, Massive, yfinance) and none of which tell a member which vendor answered.

**CONFIDENCE.** 🟢 on the structure and the stated numbers; 🔴 on accuracy claims (no independent verification is possible without a subscription); 🟡 on the coverage counts, which **disagree with each other across three official pages** (2,300 vs 2,500 for KPI companies; 12,300 vs 13,000 vs 100,000 for "companies").

**RECOMMENDATION (hypothesis).** *A vendor-provenance field surfaced next to a number — "who said this, when, and how fresh" — costs one column and converts an unverifiable figure into a checkable one; UCT already stores provenance for bars and does not show it.*

**OPEN QUESTION.** Which of the three published universe counts is the one the screener actually runs against? Three official pages give three answers.

---

## G. Customization

**OBSERVATION.** Customisation is **column-and-template shaped, not layout shaped**. Users choose the metric columns on a dashboard (from the same metric library the screener uses, including custom metrics and Segments/KPIs), reorder metrics, save **Metric Templates** for one-click reuse on any company, save **AI Prompt Templates**, duplicate tabs inside a module, add non-equity custom assets, switch currencies, toggle light/dark, and persist period and tab preferences across pages. Dashboards are plan-limited (free: 1 dashboard, 30 rows). There is **no evidence of movable panes, saved workspace layouts, or a multi-monitor story** — the mobile navigation was redesigned in 2026-08, and the 2024 v4.0 redesign explicitly celebrated the mobile experience, which points at a responsive single-column app rather than a tiling workstation.

**EVIDENCE.** `https://fiscal.ai/changelog/` — Tier 1, 2026-09-02: v5.3 Metric Templates; v5.4.1 AI Prompt Templates and Custom Assets; v5.5.1 metric rearrangement; v4.5.0 Custom Metrics; v2.0.5 duplicate tabs; v4.0 (2024-09-04) redesign note on mobile; v5.9.5 navigation redesign. `https://fiscal.ai/help/` FAQ — free-tier dashboard limits. **Verified (vendor release log).**

**INTERPRETATION.** Templates over layouts is the right trade for a product whose sessions are "look at one company properly", and the wrong one for a product whose sessions are "watch six things at once". It is the mirror image of UCT's `/charts` workspace, where movable widgets and saved layouts are the core idiom.

**RELEVANCE TO UCT.** A useful contrast for TERMINAL-NEXT: UCT already owns a grid-layout workspace; what it does *not* own is a cross-entity **metric template** ("apply my nine columns to any company or list"), which is cheaper than a layout and travels further.

**CONFIDENCE.** 🟡 — templates are documented; the layout absence is an argument from silence.

**RECOMMENDATION (hypothesis).** *Saved metric sets that apply to any entity may deliver more perceived customisation per unit of engineering than another draggable pane.*

**OPEN QUESTION.** Can a dashboard be shared with a team on the Enterprise plan, or is sharing limited to charts and annotations?

---

## H. Search / commands

**OBSERVATION.** One global search bar resolves companies, ETFs and funds by name or ticker, with recent searches and (since 2026-01) direct navigation into a chosen tab of the target company. Ticker resolution has had explicit maintenance: a ticker-mapping refactor "to reduce company duplication and improve consistency" (2026-06-24), secondary listings addable to dashboards, merged/delisted company pages retained, and a middleware redirect when a company's URL changes. A second, different search exists over *documents*: **Query**, a keyword search across all documents, with tabs to hold several searches at once, plus in-transcript Ctrl+F with whole-word/case-sensitive options. Metric search is a third search surface (the metric bar on dashboards, financials and charts).

**EVIDENCE.** `https://fiscal.ai/changelog/` — Tier 1, 2026-09-02: v5.2.9, v5.8.2, v4.1.2, v5.4.3, v5.7.5 (SpaceX URL migration via middleware), v5.4, v5.4.4, v5.6.4, v5.6.5 ("Integrated Segments and KPIs into the metrics search … so clients no longer require a tab visit"). **Verified.**

**INTERPRETATION.** Three searches with three scopes — entity, document, metric — and the 2026-04-30 entry shows the metric search being *widened* so that a user stops navigating to find a number. That is the same instinct as a command palette, arrived at without one: reduce navigation by making search resolve deeper.

**RELEVANCE TO UCT.** The pattern "make the search resolve the destination, not the container" is transferable to UCT's ticker search and to `/ai-search`.

**CONFIDENCE.** 🟡. Ceiling: no hands-on measurement of resolution quality or latency.

**RECOMMENDATION (hypothesis).** *Widening a search's scope so it returns the leaf (a metric, a segment, a tab) rather than the entity removes more clicks than adding a shortcut for the entity.*

**OPEN QUESTION.** Does the entity search resolve a *KPI phrase* ("AWS revenue") directly, as the metric search now does within a company?

---

## I. AI — what is shipped versus what is marketing

**OBSERVATION.** Three distinct generations are visible in the vendor's own log, and only the third is where the company now invests:

1. **Conversational Copilot (2023 → Dec 2024).** Fully conversational answering over filings, transcripts, reports, news and events, with sources shown back, screening by text prompt, chat sharing, bookmarks, follow-up suggestions, an embeddable Copilot for partners, and a Copilot API. Marketing claim from v3.10 (2024-07-15): *"Copilot Scores 91% Accuracy in FinanceBench vs. 31% for GPT-4o (w/ Internet Access)"*. After v4.4.4 (2025-01-15) the word "Copilot" never appears in the changelog again.
2. **Document-scoped AI (2025 → 2026).** AI summaries on 10-K/10-Q filings, transcripts, IR slides and Morningstar reports; AI-generated company reports with PDF export; AI natural-language screening; monthly news summaries; then, 2026-05-13, *"Enhanced AI-generated summaries … with citation support, transcript citation handling, custom summary persistence, and improved prompt quality"*, and 2026-02-20 **AI Prompt Templates** for one-click custom questions.
3. **Agent-facing AI (2026).** The **Fiscal MCP** at `https://api.fiscal.ai/mcp` (Streamable HTTP; legacy SSE), OAuth or API-key auth, sold as a **standalone product** since 2026-07-16, with native connectors for Claude, ChatGPT/Codex and Gemini Enterprise, plus a **Skills catalogue** — "an out-of-the-box prompt stored in AI memory", invoked by name (`$fiscal-comp-set`) or by asking naturally. Named skills include `financials-pull`, `financial-model` (a 10-year three-statement model), `segments-and-kpis`, `investment-research` (a ~2,000-word note), `comp-set`, `valuation` (reverse DCF, multiples, IRR), `company-snapshot`, `screener`, `watchlist-monitor`, `ownership-activity`, `price-and-capitalization`.

**Grounding behaviour** is the through-line and it is *architectural*, not prompt-level: every figure carries a click-through link that opens the source PDF **at the exact page**, and the MCP inherits plan entitlements — *"Your assistant can only retrieve data you could retrieve yourself with your API key for the same tickers, periods, and features."* The docs also warn that a tool being visible in Claude or ChatGPT does not mean the account is entitled to it.

**EVIDENCE.** `https://fiscal.ai/changelog/` — Tier 1, 2026-09-02 (all three generations, dated). `https://docs.fiscal.ai/docs/guides/mcp-integration` and `.../mcp-skills` — Tier 4, 2026-09-02 (server URL, auth, clients, entitlement caveat, skill names, "click-through audit links that open the source PDF at the exact page"). `https://fiscal.ai/blog/fiscal-ai-launches-22-investment-research-skills-for-claude-and-codex/` — Tier 3, 2026-09-02: *"A Skill is an out-of-the-box prompt stored in AI memory and ready to invoke instantly."* **Verified** (MCP surface, skill names, entitlement rule) · **claimed** (FinanceBench 91%, "99.5%+ accuracy") · **demonstrated:** nothing — no video or demo was viewed.

⚠️ **A drift worth recording:** the launch post says **22** skills, the developer docs say **28**. Both are official, both are current, and they disagree. This is the hand-typed-count-beside-the-list defect in a competitor's artifacts — evidence that the failure mode is universal, not a UCT peculiarity.

**INTERPRETATION.** Fiscal.ai concluded that the *interface* for AI research would be owned by Anthropic/OpenAI/Google, and that its own defensible position was to be the tool those agents call. It therefore stopped building a chat box and started shipping (a) citation-bearing summaries inside its own document surfaces and (b) an entitlement-respecting MCP with pre-packaged analyst workflows. The most transferable engineering idea is the **entitlement inheritance**: the agent is not a privileged caller; it can see exactly what the human's plan can see.

**RELEVANCE TO UCT.** Bears on Compass, `/ai-search`, and any future UCT MCP. UCT already has a tool registry shared by voice and text chat (one facade, two surfaces) — Fiscal.ai's version of that lesson is a third surface (external agents) sharing the same entitlement check. It also bears on the wire's groundedness gate: Fiscal.ai's answer to "did the model make this up" is not a validator, it is a link.

**CONFIDENCE.** 🟢 on the MCP surface and skills (developer docs are unambiguous); 🟡 on the *current* in-terminal AI experience (I could not open the app to see whether a chat box still exists; the release log implies AI now lives inside documents rather than in a conversation); 🔴 on all accuracy benchmarks.

**RECOMMENDATION (hypothesis).** *If UCT exposes its brain to external agents, the entitlement check should be the same object the web session uses — an agent path with its own authorisation logic would become a second authority over "what may this member see", which is the defect class UCT has paid for repeatedly.*

**OPEN QUESTION.** Does the terminal still contain a conversational surface at all, or only prompt-templated summaries over a selected document?

---

## J. UX: strengths, weaknesses, density, onboarding, anti-patterns

**OBSERVATION — strengths (inferred from the release log's own preoccupations).** Provenance is one click from any number. Two representations of the same statement (standardized / as-reported) are a toggle rather than a hidden reconciliation. Metric definitions are a hover away (ratio formula tooltips, 2026-08). State persists where it annoys most (period, industry tab, audio across pages). Charts are export-first: a share URL reproduces the exact chart, and the export modal takes a title, size, resolution and watermark — a distribution loop, since exported charts travel on social media and carry the brand back.

**OBSERVATION — weaknesses.** Onboarding is a five-step blog tutorial rather than in-product guidance, and that tutorial has **drifted from the product**: it still says "our 50,000+ stock database" (the help centre says 100,000+) and offers "Get Fiscal.ai Pro For Free … no card required", while the current FAQ says the 7-day trial **requires a credit card** and converts automatically unless cancelled. The `/pricing/` page itself shows three product cards and **no prices**; the actual price ladder is only in a Help Center FAQ answer. Free-tier limits are severe enough (1 dashboard, 30 rows, 10 years/6 quarters, 1 event) that the free product mostly demonstrates the paywall.

**Density.** Metric-table dense (dashboards and financial statements are the core screens; striped rows and borders were added app-wide in 2026-07), but *entity*-sparse: one company at a time, one dashboard at a time, no tiled panes.

**Anti-patterns.** (i) A pricing page that does not price. (ii) An evergreen tutorial that is the first thing a new user reads and is factually stale. (iii) A licence constraint surfaced as a product limitation the user must simply accept ("20yrs … not available in the dashboard"). (iv) Automatic trial-to-paid conversion behind a card.

**EVIDENCE.** `https://fiscal.ai/blog/ultimate-guide-to-using-fiscal-AI/` vs `https://fiscal.ai/help/` — both Tier 1, both fetched 2026-09-02, contradicting each other on coverage and on trial terms. `https://fiscal.ai/pricing/` — Tier 3, 2026-09-02 (three cards, "7 day free trial included upon signup", no figures). `https://fiscal.ai/changelog/` — Tier 1: v5.8.4 (striped rows/borders), v5.9.5 (ratio tooltips), v5.2.8 (watermark position on export "to prevent black bar when posting"). **Verified.**

**INTERPRETATION.** The in-product craft is visibly ahead of the surrounding artifacts. That asymmetry is itself the lesson: the documents a prospective user reads first were not on anyone's release checklist, so they aged.

**RELEVANCE TO UCT.** Recognisable. UCT's own repository history is a catalogue of documentation that outlived the code it described; a competitor's public tutorial doing the same thing is the external control proving the failure is structural, not cultural.

**CONFIDENCE.** 🟡 on strengths/weaknesses (documented but not experienced); 🟢 on the specific documented contradictions, which are directly quotable from two official pages fetched the same day.

**RECOMMENDATION (hypothesis).** *An evergreen "how to use it" artifact should carry a measured number or none at all — the fastest-rotting sentence in a product tutorial is the one with a count in it.*

**OPEN QUESTION.** Is there in-product onboarding (tours, empty-state guidance) that the tutorial is merely a supplement to? The 2025-03-11 entry "Demo Videos for Features available in app header" suggests something, and the sales page offers "Tour The Platform" behind a modal I did not open.

---

## K. Performance (label: **reported/claimed**, not measured)

**OBSERVATION.** The vendor's stated performance property is **freshness, not responsiveness**: first-party fundamentals published **3–7 minutes** after an earnings release; other geographies 24–48 hours. Speed of the *app* appears repeatedly as maintenance rather than as a claim: financials-page rework "for improved Performance/Speed/Stability on all companies" (2025-11-21), screener "optimized with batch endpoint for faster database lookups" (2026-04-17), "Improved stock price loading times on dashboards" (2026-08-21), "Dramatically improved PDF export speed for AI-generated research reports" (2026-03-30), "Optimized daily ratio financials performance" (2026-08-07). Marketing frames the pipeline claim as "ingests, parses, validates, and publishes within minutes of release".

**EVIDENCE.** `https://fiscal.ai/help/` (update-frequency FAQ) — Tier 1; `https://fiscal.ai/changelog/` — Tier 1; `https://fiscal.ai/` (pipeline section) — Tier 3. All 2026-09-02. **Claimed / reported.**

**INTERPRETATION.** A repeated cadence of speed fixes on the same three surfaces (financials, dashboards, screener) is weak evidence that those surfaces were slow — which is what a metric-table-heavy web app over 100k entities would be.

**CONFIDENCE.** 🔴 on any absolute performance statement. Ceiling: a subscription and a stopwatch, or a network trace. The owner could raise this with a single paid month; nothing else will.

**RECOMMENDATION (hypothesis).** *"Minutes after the filing" is a more defensible performance promise than "fast", because it is falsifiable by the customer on any earnings day — a latency claim tied to an external event is self-auditing.*

**OPEN QUESTION.** What is the actual observed lag between an 8-K hitting EDGAR and the number appearing? Unverifiable without an account.

---

## L. Pricing / business model

**OBSERVATION.** Three separately-sold products, one of them genuinely cheap, one enterprise, one annual-only.

**Terminal (per seat, self-serve, USD, as published 2026-09-02):**
| Plan | Monthly | Billed yearly | Notes |
|---|---|---|---|
| Free | $0 | — | 10 years & 6 quarters of financials · 2 years & 2 quarters of KPI data · **1 dashboard & 30 rows** · 1 event (calls, transcripts & slides) · 1 year & 1 quarter of estimates · global stocks/ETFs/funds |
| **Pro** | **$49/mo** | **$39/mo** | 10 years / 15 quarters of Segments & KPIs |
| **Max** | **$99/mo** | **$79/mo** | full KPI history; **financial-data export** (U.S., Canada, ADRs, U.K., EU only); earnings-calendar export |
| Enterprise | contact sales | — | team onboarding, billing, admin roles |

- **Trial:** 7 days, **credit card required at signup**, converts to paid unless cancelled. (A "Plus" tier existed until 2025-10-02 and was removed.)
- **Refunds:** annual subscriptions purchased or renewed within the past 30 days are "eligible for refund review".
- **API / MCP:** a **separate subscription from the terminal plans**, **annual only and non-refundable** when bought self-serve. Free API trial: **100 companies, 250 calls/day, 50 requests/minute**, no card. Paid limits are "defined in your terms of sale" — no public figures.
- **No professional / non-professional distinction exists**, and there is no market-data add-on ladder — consistent with quotes being 15-minute delayed and therefore outside exchange-entitlement regimes.
- Distribution extras: an affiliate programme, and partner giveaways (an eToro Club post offers members Fiscal.ai Pro).

**EVIDENCE.** Prices and trial terms: `https://fiscal.ai/help/` FAQ answers — Tier 1, fetched 2026-09-02 (verbatim: "A Pro plan at $49/month or $39/month billed yearly, and a Max plan at $99/month or $79/month billed yearly"). Product split and trial framing: `https://fiscal.ai/pricing/` — Tier 3, 2026-09-02. API limits: `https://docs.fiscal.ai/docs/guides/free-trial` and `.../rate-limits` — Tier 4, 2026-09-02. Plus-tier removal: changelog v5.2.1 — Tier 1. **Verified.**

**INTERPRETATION.** The terminal is priced as a *funnel*, not as the business: $49–$99 a month for institutional-grade fundamentals is below what the underlying licences plausibly cost, and the Series A narrative says the revenue thesis is platforms and APIs serving "millions of end users". The terminal's job is to make the data credible in public.

**RELEVANCE TO UCT.** UCT sells a membership at a comparable price point with its own proprietary intelligence. The structural question Fiscal.ai answers by example is whether the member-facing product or the data/agent layer is the durable asset — they chose the latter and repriced the former as marketing.

**CONFIDENCE.** 🟢 on all published figures (quoted verbatim from the official help centre, dated). 🟡 on the interpretation of the funnel.

**RECOMMENDATION (hypothesis).** *Publishing a price ladder only inside an FAQ answer, while the pricing page shows three unpriced cards, is a measurable friction; whatever the conversion rationale, it makes the product unquotable by anyone comparing it — including this dossier, which had to read the HTML to find the numbers.*

**OPEN QUESTION.** What does the MCP/API actually cost above the free trial? No public figure exists; every path leads to "Contact Sales".

---

## M. Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **Click-through auditability as an architectural property, not a citation style.** *Hypothesis:* if every number a UCT AI surface emits carried a link that opens the artifact it came from — the bar, the filing, the wire section, the KB row, at the exact position — groundedness would become a member-checkable property rather than a rail we grade ourselves. *Serves:* Workflow B/C, the wire's groundedness gate, Compass's citation discipline.
2. **Entitlement inheritance for agents.** *Hypothesis:* an external or internal agent should resolve exactly what the member's own session can resolve, through the same check — never a parallel authorisation path. *Serves:* any UCT MCP, Compass tools, voice parity.
3. **Standardized vs as-reported as a visible toggle.** *Hypothesis:* where UCT reconciles two vendors or two definitions (earnings dates, expected move, exposure score), showing both with a switch is more trustworthy than silently choosing one. *Serves:* Calendar, Model Book earnings table, breadth definitions.
4. **The dated public changelog as an anti-drift artifact.** *Hypothesis:* a versioned, dated release log — written at ship time, never retro-edited — is a cheaper defence against "documented but unreachable" than any audit, because it records what shipped rather than what is believed. *Serves:* the whole program; directly addresses UCT's recurring stale-documentation defect class.
5. **In-product data-correction requests with routing.** *Hypothesis:* a "this number looks wrong" control on the surface that displays the number turns members into a detection layer for exactly the drift class UCT's monitors chase. *Serves:* bars/fundamentals accuracy monitors, Calendar enrichment.
6. **Named, invocable workflows with fixed output contracts ("skills").** *Hypothesis:* the desk's repeatable analyses (grade this name, prep this earnings, what changed on my list) are better shipped as named prompts with defined outputs than as new screens. *Serves:* Compass, `/ai-search`, the morning routine.
7. **Five views over one dataset — the earnings calendar.** *Hypothesis:* Agenda / Day / Week / Month / Heatmap over a single event set, with watchlist persistence and faceted search, serves more sessions than one view with more filters. *Serves:* Workflow B and TERMINAL-CURRENT's `/calendar`.
8. **Importance as a first-class news field.** *Hypothesis:* tagging news by event type and importance at ingest — and filtering on it — beats ranking by recency for a member trying to answer "what matters". *Serves:* Workflow D, the wire, the catalyst engine.
9. **Formula on hover, plus a public formula list.** *Hypothesis:* every derived metric UCT displays should be able to show its own formula without leaving the cell; a metric whose definition is one hover away is a metric a member will trust and dispute correctly. *Serves:* breadth monitor, screener, exposure rating.
10. **Metric templates that travel across entities.** *Hypothesis:* "my nine columns, applied to any list or company" delivers customisation with none of the layout-persistence cost UCT has already paid for in `/charts`. *Serves:* Workflow F.

---

## N. Bad ideas for UCT (avoid, and why)

1. **Do not lead with a chat identity.** The vendor that named itself after chat un-named itself: *"The Chat interface has become a feature … rather than the core fundamental problems."* Naming a product after its interface freezes the roadmap into that interface.
2. **Do not let a licence constraint reach the member as an unexplained limitation.** "20 years of data is not available in the dashboard due to licensing" is a plan that promises depth the surface cannot render. If UCT gates data, the gate should be legible as a plan boundary, not as a defect.
3. **Never ship an evergreen tutorial containing a count.** Fiscal.ai's own step-by-step guide advertises "50,000+" companies and a "no card required" Pro trial that the FAQ contradicts on the same day. UCT has this defect internally; do not export it to member-facing copy.
4. **Do not publish two official counts of the same thing** (22 vs 28 skills; 2,300 vs 2,500 KPI companies; 12,300 vs 13,000 vs 100,000 companies). Derive the number from the list, or state no number.
5. **A pricing page that does not price.** Whatever it does for conversion, it makes the product uncomparable and pushes the real ladder into an FAQ nobody links.
6. **Annual-only, non-refundable self-serve** (the API/MCP terms) is the wrong contract shape for a member-facing product and would be actively hostile in UCT's community.
7. **Automatic trial-to-paid behind a card**, combined with a free tier crippled to one dashboard and thirty rows, converts the free product from a demonstration into an obstacle. UCT's free tier is a genuine surface; keep it that way.
8. **Beware the mid-life feature drift into someone else's category.** Adding RSI/MACD candlestick charting to a fundamentals terminal in 2026 does not make it a charting product; it makes a second-best chart sit beside a best-in-class statement viewer. The mirror warning for UCT: bolting deep fundamentals onto a trading terminal earns the same criticism in reverse.

---

## O. Screenshots / evidence links (no images reproduced)

- Product pages with the data catalogue and persona cards: `https://fiscal.ai/products/terminal/`, `https://fiscal.ai/products/mcp/`, `https://fiscal.ai/` — Tier 3, 2026-09-02.
- Official step-by-step tutorial, written around annotated screenshots (arrows referenced in prose; images not reproduced here): `https://fiscal.ai/blog/ultimate-guide-to-using-fiscal-AI/` — Tier 1, 2026-09-02.
- Official screener tutorial with seven worked screen definitions: `https://fiscal.ai/blog/how-to-screen-for-stocks-on-finchat-io/` — Tier 1, 2026-09-02.
- Dated release log, ~120 entries, v1.1 (2023-04-20) → v5.9.7 (2026-08-27): `https://fiscal.ai/changelog/` — Tier 1, 2026-09-02. **The single most valuable artifact in this dossier.**
- Developer documentation and guides (endpoint groups, coverage, MCP server, skills): `https://docs.fiscal.ai/`, `.../guides/getting-started`, `.../guides/free-trial`, `.../guides/rate-limits`, `.../guides/mcp-integration`, `.../guides/mcp-skills` — Tier 4, 2026-09-02.
- **Not reached:** the "Tour The Platform" demo behind a modal on the terminal page; in-app demo videos referenced by changelog v4.5.2 (2025-03-11); a YouTube channel (not located within budget). No video was watched and nothing is inferred from one.

---

## P. Confidence per section, with ceilings

| § | Confidence | Ceiling / what would raise it |
|---|---|---|
| A Executive summary | 🟢 | none |
| B Personas | 🟢 stated / 🔴 actual mix | audited user numbers; none public |
| C Navigation | 🟡 | one hands-on session or an official demo transcript would confirm the absence of a command palette |
| D Capability map | 🟢 existence / 🟡 quality | hands-on use |
| E Workflows | 🟡 (B, C stronger; A, D, E, G are negative findings) | one paid month; Wave 2 reconstruction |
| F Data | 🟢 structure / 🔴 accuracy claims | independent spot-check against filings, which needs an account |
| G Customization | 🟡 | hands-on; layout absence is argued from silence |
| H Search / commands | 🟡 | hands-on latency and resolution testing |
| I AI | 🟢 MCP & skills / 🟡 in-terminal AI / 🔴 benchmarks | opening the app; an independent FinanceBench replication |
| J UX | 🟡 (🟢 on the documented self-contradictions) | hands-on; screenshots |
| K Performance | 🔴 | a subscription and a stopwatch on an earnings day — the owner could supply this for ~$99 |
| L Pricing | 🟢 published / 🟡 API pricing unknown | a sales quote |
| M / N Ideas | 🟡 by construction (hypotheses, not findings) | testing them in UCT |
| O Evidence | 🟢 | the demo video transcript |

**EVIDENCE CEILING (restated plainly).** The terminal itself was never opened. Signup requires a credit card and this role is forbidden to sign up or purchase, so no screen, latency, density or interaction claim in this dossier rests on observation. What replaces observation is unusually good: a dated, ~120-entry official release log, a help centre with substantive FAQ answers, two official tutorials, and full public developer documentation. That combination supports strong claims about *what exists* and weak claims about *what it is like*. The named thing that would raise this dossier from 🟡 to 🟢 is **one paid month of Max (~$99) on the owner's account**, which would settle §C, §G, §J and §K in an afternoon.

---

## What this product would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

Give Fiscal.ai UCT's proprietary layer and the missing half of the taxonomy fills in at exactly the seams Fiscal.ai left open. Its company page already answers *what this business is and what it just reported, auditable to the page of the filing*; it cannot answer *whether now is the moment*. UCT's regime classifier, exposure rating, breadth rails, COT positioning, options flow and dark-pool prints would supply the missing Workflow-G spine, and the earnings badge in the header — today a date and a session time — would become a date, a session time, an implied move, a four-quarter reaction history and a regime-scaled position size, each still carrying Fiscal.ai's click-through to source. The screener, today a fundamentals sieve returning a list of businesses, would gain UCT's setup taxonomy and its base-structure library and start returning *situations* with entry, stop and invalidation, each one auditable to both the filing and the bar that produced it. Most consequentially, the Skills catalogue is the natural distribution mechanism for the UCT20 methodology: `$uct-grade-ticker` as a named, invocable workflow whose verdict is structurally computed from tool output rather than narrated by a model would be, for the first time, a firm's discipline shipped as an artifact an outside agent can run and a member can audit line by line. The trade in the other direction is the honest one to state: Fiscal.ai would gain conviction and timing; UCT would gain provenance and a 20-year statement history it does not have, and would have to accept a 15-minute-delayed, no-options data estate underneath a desk that lives on the tape.

---

## GAPS

- **Search channel used.** `WebSearch` was not attempted (shared session cap reported exhausted). `WebFetch` succeeded on `docs.fiscal.ai` (six pages) and failed on `fiscal.ai` (403 Cloudflare / 429). Everything on `fiscal.ai` was therefore read in **one browser tab, created by this role and closed at the end**; the FAQ answers, which render only on click, were recovered by reading the page's own HTML in that tab (read-only; no forms, no login, no purchase).
- **Queries I could not run.** No general web search for practitioner commentary, professional reviews, or comparison-of-record. One Reddit search (`"fiscal.ai"`, top/year, and a broader FinChat variant) returned **no usable practitioner content** — the hits were chart images posted to chart subreddits, which is at best weak evidence that the share-chart export loop works.
- **Not reached.** The app itself (card-gated trial). "Tour The Platform" demo modal. In-app demo videos (changelog v4.5.2). Any YouTube channel or conference talk. The Excel/Sheets story beyond the FAQ's "no Excel add-in". Individual partner case studies (Perplexity, Kalshi, Stocktwits, MarketBeat, Alpaca, Aiera, RavenPack, NOF1) — their existence is from a sitemap listing of post titles, and only the homepage testimonial quotes were read.
- **Unresolved contradictions inside official sources** (recorded, not reconciled): 22 vs 28 skills; 2,300 vs 2,500 KPI companies; 12,300 vs 13,000 vs 100,000 companies; tutorial's "50,000+ / no card required" vs FAQ's "100,000+ / card required".
- **Confidence deliberately withheld** on every experiential claim (§C, G, J, K) — see the evidence ceiling.
- **Source-handling observation.** No page, document or tool description encountered during this research contained text addressed to an AI agent or attempting to direct its behaviour. The nearest thing was ordinary marketing imperative ("Contact Our Sales Team", "Download Skills for Free"), which is content, not instruction, and was treated as such.

---

## SOURCES

**Primary — official (18).** All fetched **2026-09-02**.

1. `https://fiscal.ai/` — Tier 3, official home (positioning, data catalogue, testimonials, SOC 2 Type II claim).
2. `https://fiscal.ai/products/terminal/` — Tier 3, official product page (personas, research stack).
3. `https://fiscal.ai/products/mcp/` — Tier 3, official product page (13,000+ first-party companies; connector list; skills framing).
4. `https://fiscal.ai/pricing/` — Tier 3, official pricing page (three products; 7-day trial; **no figures published on the page itself**).
5. `https://fiscal.ai/help/` — **Tier 1, official help centre** (price ladder, free-tier contents, exports, data sources, update cadence, coverage counts, KPI depth by plan, refunds, trial terms, Excel add-in, 20-year licence limitation, dashboard setup, magic-link login).
6. `https://fiscal.ai/changelog/` — **Tier 1, official dated release log**, v1.1 (2023-04-20) → v5.9.7 (2026-08-27). The backbone of §D, §E, §H, §I, §J, §K.
7. `https://fiscal.ai/blog/ultimate-guide-to-using-fiscal-AI/` — Tier 1, official tutorial linked from the help centre (dashboard, company page anatomy, chart sharing, comparisons, screener).
8. `https://fiscal.ai/blog/how-to-screen-for-stocks-on-finchat-io/` — Tier 1, official tutorial (screener mechanics + seven worked screens).
9. `https://fiscal.ai/blog/series-a-announcement/` — Tier 3, official announcement (rebrand rationale, $10M Series A/Portage, $13M total, 350k registered users — **claimed**).
10. `https://fiscal.ai/blog/fiscal-ai-s-next-chapter-a-brand-built-for-the-modern-investor/` — Tier 3, official brand post (95%+ retention, 99.5%+ accuracy, 13,000+ companies — **claimed**).
11. `https://fiscal.ai/blog/fiscal-ai-launches-22-investment-research-skills-for-claude-and-codex/` — Tier 3, official launch post (skill definition, workflow categories, source-linking rationale).
12. `https://docs.fiscal.ai/` — Tier 4, official developer docs (endpoint groups, coverage, history depth).
13. `https://docs.fiscal.ai/docs/guides/getting-started` — Tier 4 (guide index, API-key auth).
14. `https://docs.fiscal.ai/docs/guides/free-trial` — Tier 4 (100 companies / 250 calls per day, no card).
15. `https://docs.fiscal.ai/docs/guides/rate-limits` — Tier 4 (50 req/min, 250/day, UTC reset; paid limits "in your terms of sale").
16. `https://docs.fiscal.ai/docs/guides/mcp-integration` — Tier 4 (server URL `https://api.fiscal.ai/mcp`, OAuth/API-key, client list, **entitlement inheritance**).
17. `https://docs.fiscal.ai/docs/guides/mcp-skills` — Tier 4 (28 skills; names; "12,300-name universe"; click-through audit links to the exact PDF page).
18. `https://fiscal.ai/sitemap.xml` → `https://fiscal.ai/sitemaps/0.xml` — Tier 3, official sitemap (site structure; existence of `/help/brokerage-connections/` with Interactive Brokers and Kraken articles; partner-post titles).

**Secondary — attempted, no usable result (1).**

19. `https://www.reddit.com/search.json?q=%22fiscal.ai%22&sort=top&t=year` (and a broader FinChat variant) — Tier 12 (community discussion), 2026-09-02. **No practitioner commentary on the product surfaced**; results were unrelated posts and chart images. Recorded so that a later role does not assume this channel was unexplored.
