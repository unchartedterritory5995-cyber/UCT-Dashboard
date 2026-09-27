---
id: B-LSEG-01
title: LSEG Workspace — benchmark product dossier
role: Benchmark product dossier author (LSEG Workspace, formerly Refinitiv Eikon)
wave: 1b
group: B
category: competitor
scope: LSEG Workspace — the desktop/web/Excel/Teams financial workstation that replaced Refinitiv Eikon; its navigation, capability map, data, AI layer, customisation, and commercial model
confidence: 🟡 (naming/retirement/AI/surfaces/limits 🟢 · app-level workflow mechanics 🟡 · pricing, lived UX, measured performance 🔴)
evidence_ceiling: "No Workspace licence, no screenshots, no session recordings, no demo access. LSEG publishes NO price list and no public tier table — Section L is 🔴 and every dollar figure in circulation comes from SEO comparison pages the evidence standard excludes. Professional-review tier is unreachable from this agent: trustradius.com 403s, g2.com 403s (reported by B-BBG-01), and the practitioner SERP for 'Workspace slow/clunky' returns only rfp.wiki AI-generated comparison pages. LSEG's authenticated site (myaccount.lseg.com, the Workspace technical documentation site, the Learning Centre catalogue) is login-gated, so per-app user guides (Screener, Monitor, Charts, Alerts, PAL) were NOT reachable — Section D/E app mechanics lean on ONE university library guide. Raised by: a 30-day trial (LSEG offers one free, self-serve), a practitioner interview, or an owner-supplied screenshot set."
sources: "24 primary (LSEG-authored product pages, support PDFs, release notes); 6 secondary (one university library guide, one investor-KPI aggregator, four excluded-tier comparison/directory pages recorded only as leads)"
uct_relevance: high
status: draft
date: 2026-09-02
---

# LSEG Workspace — benchmark product dossier

**Reading note for synthesis.** This is a Wave-1b FIRST DRAFT. A workflow reconstructor (Wave 2)
and a verifier follow; five of the Part XIV workflows in Section E are sketched here and
reconstructed in depth later. Where a claim could not be reached, it says **NOT DETERMINED** and
names the ceiling rather than guessing.

**Benchmark discipline.** "LSEG Workspace does Y" never means "TERMINAL-NEXT should do Y". Every
item in Section M is phrased as a hypothesis for the program to test.

**Naming, settled.** The universe validator's finding is confirmed against LSEG's own page:
*"Eikon was withdrawn from LSEG's product line on 30th June 2025"* — LSEG's Eikon product page,
fetched 2026-09-02 [S2, tier 1, **verified**]. **Refinitiv Eikon is dead; LSEG Workspace is the
current product.** The rebrand of the software itself is older than the sunset: Workspace release
1.23 (21 September 2023) lists *"LSEG Workspace rebranding"* as its headline enhancement, and
releases before it are titled "Refinitiv Workspace" [S16, tier 2, verified]. Use **LSEG Workspace**
throughout; "Eikon" only when describing history.

**A note on document vintage.** Three LSEG-authored documents disagree about which LLMs power the AI
layer, and the disagreement is dated, not contradictory — see Section I.3. This dossier flags every
place a fact has a version stamp, because Workspace ships its *desktop container* a few times a year
and its *web apps* continuously, so "current" means different things per surface.

---

## A. Executive summary

**OBSERVATION.** LSEG Workspace is the London Stock Exchange Group's flagship multi-asset financial
workstation — the successor to Refinitiv Eikon, itself the successor to Thomson Reuters Eikon. It is
sold as a **per-user licence that carries the whole application catalogue**, delivered
simultaneously as a Windows/macOS desktop container, a browser app, a Microsoft Excel/PowerPoint
add-in, a Microsoft Teams app, and iOS/Android apps. Its positioning sentence is:
*"Workspace brings together trusted data, market-moving news, powerful analytics and AI-powered
intelligence in one connected experience"* [S1, tier 3, **claimed**].

**EVIDENCE.**
- S1 https://www.lseg.com/en/data-analytics/products/workspace — tier 3 (official product page), fetched 2026-09-02. **claimed**.
- S22 LSEG Workspace *Service Overview* PDF — tier 1 (official manual), fetched 2026-09-02. **verified**:
  *"LSEG applications are not available for purchase individually but are packaged into propositions
  based on user workflows. LSEG Workspace contains all the available LSEG applications."*
- S17 *Desktop and Web Comparison* PDF, document version 100.02, dated 29/04/2026 — tier 1. **verified**.
- S7 https://www.lseg.com/en/data-analytics/products/workspace/download-workspace — tier 3, fetched
  2026-09-02: desktop installer **version 1.26.739** for Windows and macOS; separate HERE Core builds;
  iOS and Android apps. **verified**.

**INTERPRETATION — the product's philosophy, in one sentence (Part CCXLVII).**
*Workspace's philosophy is that the terminal is an **entitlement-shaped container**: LSEG sells one
seat, ships every application into it, and lets the customer's licence — not the UI — decide what
that seat can see, so the product's job is to make an enormous permissioned catalogue discoverable
rather than to be opinionated about what a user should look at.*

Three consequences fall out of that philosophy and recur throughout this dossier:

1. **Discovery is the core UX problem, not layout.** The search bar is the front door to *apps*,
   *instruments* and now *answers* alike; onboarding asks for job role and asset class purely so
   LSEG can *"make it easier for you to find the features and functionality that are important to
   your workflows"* [S22, tier 1, verified].
2. **Two users of "the same product" genuinely see different things.** LSEG says so explicitly about
   its AI layer: *"Answers are based on the data and content that each user is individually entitled
   to access through their Workspace licence"* [S19, tier 1, verified].
3. **The surface is not the product; the entitlement is.** Excel, Teams, browser and desktop are
   delivery channels over one licence — and they are *not* feature-equal (Section C.4).

**RELEVANCE TO UCT.** UCT's desk and members are the opposite shape: one entitlement tier per user
(free / paid / admin), a small curated catalogue, and a strong house opinion about what matters
today. Workspace is therefore most useful to TERMINAL-NEXT as a **negative control on breadth** and
a **positive control on provenance** — its citation and entitlement machinery is worth studying;
its "everything is in here somewhere" catalogue is the failure mode UCT already avoids.

**CONFIDENCE.** 🟢 for the identity, surfaces, business shape and the retirement date. 🟡 for the
philosophy statement (an interpretation, not a quote).

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT should state its own one-sentence philosophy in
writing before Phase One and test every screen against it — Workspace's coherence comes from having
one, and its sprawl comes from that one being *"contains all the available LSEG applications"*.

**OPEN QUESTION.** Does Workspace's per-user "propositions" model mean two traders at the same desk
can silently disagree about a number because one is entitled to a dataset the other is not? The AI
FAQ implies yes; nothing found says how the product surfaces that to the pair.

---

## B. User types / personas served

**OBSERVATION.** LSEG names five customer-facing personas on the product page and ships a distinct
marketing surface (and, in at least two cases, a distinct edition) for each:

| Persona | LSEG's own page | Notes |
|---|---|---|
| **Wealth advisors** | `/wealth-management-solutions/automate-advisor-workflow/workspace-wealth-advisors` | Purpose-built edition; client-centric portfolio views, Watchlist Pulse, Lipper fund data, return attribution [S13] |
| **Investment bankers** | `/investment-banking/workspace-investment-banking` | Deals, league tables, tearsheets [S1 link map] |
| **Sales and traders** | `/products/workspace/sales-traders` | *"For your equities, fixed income, commodities, corporate treasury, central banks and FX workflows"*; real-time monitoring, price/liquidity discovery, *"advanced execution (manual, automated, algorithmic)"* [S12] |
| **Analysts and portfolio managers** | `/asset-management-solutions/workspace-analysts-portfolio-managers` | [S1 link map] |
| **Academia / students** | `/products/workspace/workspace-for-students` | Reduced entitlements; explicitly **excluded from AI Search** [S14, S19] |

**EVIDENCE.**
- S1 (tier 3, claimed) — persona list and URL map, fetched 2026-09-02.
- S12, S13, S14 (tier 3, claimed) — fetched 2026-09-02.
- S19 *AI Search FAQ*, July 2026 (tier 1, **verified**) — AI Search *"is not available: On Workspace
  Access, Workspace for Students, Workspace for Kiosk, and Workspace for Media"*. This is the only
  place found that **names the edition family**: Workspace, Workspace Lite, Workspace Access,
  Workspace for Students, Workspace for Kiosk, Workspace for Media, plus **Workspace 2.0** (the
  HERE Core desktop, cf. S17's *"Workspace for HERE Core (desktop versions 2.x)"*).
- S22 (tier 1, **verified**) — first-run onboarding collects *"job role, asset classes (if relevant
  to your role) and the selection of your primary asset class"*.

**INTERPRETATION.** The persona model is **declared at onboarding and then used to re-rank the UI**,
not just to pick a landing page. That is a materially different design from "pick a template": the
product keeps collecting *"source/internal product hits, user job functions, locations, and asset
classes … for the purposes of tailoring the discoverability of applications and menus"* [S22, tier 1,
verified]. Workspace personalises **the menu**, not the content.

**RELEVANCE TO UCT.** The nearest UCT analogue is the free/paid/admin split plus the Compass
`trader_profile`. Workspace's model suggests a third axis UCT does not currently have: **a declared
role that re-ranks navigation**. For the desk this is near-worthless (one role); for members it maps
onto a real distinction (swing trader vs options-flow watcher vs someone here for the wire only).

**CONFIDENCE.** 🟢 on the persona list and the edition names. 🔴 on what each edition actually
*withholds* — no public entitlement matrix was reachable.

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT ever adds a role declaration, it should re-rank
**navigation** and leave **content** untouched — Workspace demonstrates that the reversible,
low-blast-radius half of personalisation is the menu.

**OPEN QUESTION.** What does "Workspace Access" (the cheapest named edition) actually include? It is
named only in an exclusion list.

---

## C. Navigation: how users move

### C.1 The frame

**OBSERVATION.** The Workspace toolbar has nine numbered elements, enumerated by a university
library guide that walks students through the UI: **App library · Home page · Navigation bar ·
Search bar · Tiles · Alerts · User menu · Help · App menu** [T1].

**EVIDENCE.** T1 — University of Warwick Library, *LSEG Workspace* business & economics guide,
https://warwick.libguides.com/buseco/workspace — tier 9 (university library guide; the evidence
standard rates these alongside credible professional tutorials), fetched 2026-09-02. **reported**.

### C.2 Search is the primary verb

**OBSERVATION.** Three distinct things are reached by typing into one bar:

1. **Instruments** — *"Click in the Search bar and type in the name or ticker (code) for an
   individual company, equity or index"*; Workspace *"will suggest matching data sources"* [T1].
2. **Applications, by short code** — typing **`SCREENER`** into the search bar opens the Screener app
   [T1]. The Teams guide confirms short codes are a first-class idiom across surfaces: to share a
   Workspace link you type **`RIC <space> App short code`** [S23, tier 1, verified]. Help is reached
   the same way: *"Typing 'Help' in the search field and selecting 'Help & Support'"*; so is the
   Feedback app and the Content Kiosk [S22, tier 1, verified].
3. **Answers** — pressing Enter on a natural-language question, or picking the *AI Search* option
   from the dropdown, routes the same bar to the LLM layer; an **AI button sits immediately to the
   right of the search bar** [S19, tier 1, verified].

**INTERPRETATION.** This is the single most transferable structural fact in the dossier. Workspace
did **not** add a separate "Ask AI" destination. It made the existing command bar polymorphic:
ticker → security page, short code → app, sentence → grounded answer. The disambiguation is done by
what you typed plus an explicit dropdown option, so the AI path is *offered*, never *assumed*.

**Search is also geographically biased on purpose.** Onboarding sets a *"Location for Search"*, which
*"provides a focus for search results, giving higher priority to local terms. For example, searching
'BP' with Italy selected as your preference may give a higher priority to Banco Populaire over
British Petroleum"* [S22, tier 1, **verified**]. Workspace also *"uses data in word search terms
entered by individual users and stores them to enable the product to suggest previous search terms"*
[S22].

**RELEVANCE TO UCT.** UCT already has a polymorphic-ish surface (`SymbolSearch` + the voice/Compass
layer) but they are separate doors. Workflow D ("what matters today") and E ("find a trade") are
exactly the cases where a member types a sentence into a box that only understands tickers.

**CONFIDENCE.** 🟢 that the bar resolves tickers, short codes and questions (three independent LSEG
documents plus the library guide). 🟡 on the exact disambiguation UI (one screenshot-free description).

### C.3 Windows, tiles and layouts

**OBSERVATION.** Two window models exist and they are surface-dependent:

- **Tiles / Tile Manager** on the ElectronJS desktop — LSEG's own footnote defines Tiles as
  *"Advanced market monitoring (traditionally, trading) workflows, with floating windows and search
  bar"* [S17, tier 1, **verified**]. The Tile Manager has accumulated *"the ability to group and
  auto-group"* (1.19.1), an *"Auto arrangement feature"* (1.14), a *"My Tile set area"* (1.14) and
  *"Improved Edit mode"* (1.15) [S16, tier 2, verified].
- **HERE Dock** on the HERE Core desktop (formerly OpenFin; Workspace 2.x) — same column, different
  window manager [S17].
- **Layouts** — *"Create personalised views of LSEG Workspace to monitor your favourite companies"*
  [T1].
- **Deep links** — available on desktop, *"Under development"* on HERE Core [S17].

**INTERPRETATION.** Workspace kept the trading-floor idiom (many small floating tiles, each with its
own search bar) as a *mode* rather than the default, and is mid-migration to a third-party window
manager. The 2026 "new Workspace" update leads with *"better window management"* and *"window
docking"* [S9, tier 3, claimed].

### C.4 The surfaces are NOT feature-equal — and LSEG publishes the matrix

**OBSERVATION.** LSEG ships a *Desktop and Web Comparison* document whose entire purpose is to tell
you what you lose by choosing a surface [S17, tier 1, **verified**]:

| | Desktop (ElectronJS) | HERE Core | Web |
|---|---|---|---|
| Platform | ElectronJS | HERE Core | HTML5 web app |
| Min. screen resolution | 1280 × 1024 | 1280 × 1024 | 1024 × 758 |
| Excel COM add-in | Yes (full) | Yes (standalone COM, installed with Workspace) | **Not available** |
| Workspace **Lite** add-in (AppSource) | Yes, *"less functionality"* | Not available | Yes, *"less functionality"* |
| Data API | Desktop Data API incl. **Eikon Data API for Python** | *"Under development"* | Delivery Platform TypeScript, Python and .Net libraries |
| Side-by-Side (SxS) 3rd-party API | Yes | *"Under development"* | Yes |
| Window management | Tile Manager | HERE Dock | — |
| Deep links | Yes | *"Under development"* | — |
| **Streaming data limit** | **2,500 RICs** hosted (no limit customer-managed) | same | **1,000 RICs per browser tab** |
| Send by email | Yes | Yes | **News only** |
| Messenger | Yes | Yes, but *"Pop-up messages are not available, currently"* | Yes |

Two further dated facts from the same document: **AppStudio was decommissioned in July 2025**, and
the *"Eikon Data API for Python"* survives, by name, on the desktop surface a year after Eikon itself
was withdrawn.

**INTERPRETATION.** The 2,500-vs-1,000 RIC streaming cap is the sharpest number in this dossier. It
says the browser build is not a thin skin over the desktop — it is a **materially smaller real-time
surface**, and LSEG raises it only by request (*"To have this raised to 5000, submit a request to
your account manager"*). Any "web parity" claim about a professional terminal should be read against
a number like this.

**RELEVANCE TO UCT.** UCT is web-only with an SSE pool that unions tickers browser-wide and caps
buckets (`MAX_SSE_TICKERS`). Workspace's published cap is the same class of constraint, made public
and made *negotiable*. UCT's equivalent constraint is invisible to members.

**CONFIDENCE.** 🟢 — direct from a versioned LSEG document.

**RECOMMENDATION (hypothesis).** TERMINAL-NEXT should publish its own surface-capability matrix
(desktop-class browser vs tablet vs phone) as a **product artefact**, not a doc comment. Workspace
demonstrates that being explicit about what a surface *cannot* do is a trust feature, not an
admission.

**ANTI-PATTERN NOTED.** Two desktop containers (ElectronJS and HERE Core) with a *"Under
development"* column between them means some customers have been running a build that is missing
deep links and the Python API for an unstated period. A migration that leaves capability holes open
across releases is exactly the shape UCT's own retirement work (live-scan, patterns page) tries to
avoid.

### C.5 Keyboard

**OBSERVATION.** Evidence for a keyboard-first culture exists but is thin and workflow-specific:
release 1.24 (08 December 2023) shipped *"Keyboard mode selection in Configuration Manager"*, and
1.26.8 (05 September 2026) added *"New keyboard shortcuts for Advanced Dealing"* — **Shift+F2 = Pick
up, Shift+F3 = New trade, Shift+F4 = End** [S16, tier 2, **verified**].

**INTERPRETATION.** A configurable *keyboard mode* strongly implies Workspace can emulate an older
key map (almost certainly Eikon's) — but nothing found says so, and the only shortcuts LSEG has
documented in three years of release notes are FX dealing commands. **NOT DETERMINED:** whether
Workspace has a Bloomberg-style universal command grammar. Ceiling: the in-product help and the
authenticated documentation site are login-gated.

**CONFIDENCE.** 🔴 on keyboard depth. This is the largest single gap in Section C and Wave 2 should
target it.

---

## D. Capability map (Part XIII taxonomy)

Every app name below is quoted from an LSEG document or the library guide; none is inferred from a
screenshot. Where a taxonomy slot has no named app, it says so.

| Part XIII slot | Named in Workspace | Evidence / status |
|---|---|---|
| **Market overview** | Home page; **Reuters Top News**; **Workspace Top 50** (*"Monthly view of the most searched commodities and equities worldwide"*); World Clock | S8/S23, tier 3/1, claimed·verified |
| **Security pages** | **Company Overview** with *"Dynamic Company Overview tabs"* (1.19); **Guidance** app (*"presents company statements in one location"*); Deals **Tearsheet** | S16, tier 2, verified |
| **Fundamentals** | LSEG **Company Fundamentals** (*"99% of global market cap, across 120 countries"*); financial statements, operating KPIs (store counts, subscribers, ARPU, production volumes), officers & directors incl. compensation | S3/S19, tier 3/1 |
| **News** | **Reuters News** (exclusive) + *"more than 10,000 other authoritative news sources"* incl. Dow Jones (WSJ, Barron's, MarketWatch), CNBC, AP, BBC, S&P Global Commodity Insights, Argus, IFR, LPC, PFI, Zawya; *"more than 2,500 journalists"* | S3, tier 3, claimed |
| **Earnings** | **Transcripts** (earnings calls, guidance/trading updates, strategy meetings, roadshows, AGM/EGM, M&A calls, IMS calls); **I/B/E/S Estimates** (23,000 companies, 90 countries); **StarMine** SmartEstimates + accuracy-weighted analyst rankings; company guidance ranges; segment and industry estimates; estimate revisions | S3/S19, tier 3/1 |
| **Economic** | LSEG **Datastream** (*"120 years of information"*); 9.5M active economic time series; interest-rate, credit and inflation **curves** | S3/S11/S19 |
| **Screening** | **Screener** app (UNIVERSE → QUICK FILTERS → Add Filter → Currency → Add Column via **Data Item Library** → Series checkbox for time series); **ADVRES** (Advanced Research) for document search; peer comparison; index constituents | T1 (tier 9), S19 (tier 1) |
| **Charting** | **Financial Chart**; **Datastream Chart Studio**; **Chart Builder** (Excel add-in); crosshair-free spec unknown; intraday intervals *"1-minute to daily"* | T1, S16 |
| **Alerts** | Alerts toolbar item; email alerts (address verified within 48h at onboarding); **mobile push notifications** since 1.17; **Watchlist Pulse** (wealth edition) | S22, S16, S13 |
| **Portfolio / watchlist** | **Portfolio & List (PAL)** application; **Model portfolio** type (1.19); Lists (Excel ribbon); Watchlist Pulse | S16, S18, S13 |
| **Documents** | US filings (10-K, 10-Q incl. MD&A and risk factors); transcripts; **Aftermarket Research (AMR)** broker research; **SDC Platinum** deals; **Content Kiosk** (catalogue of purchasable content) | S19, S14, S22 |
| **Collaboration** | **LSEG Messenger**; **Open Directory** (cross-firm chat over Microsoft Teams); **Workspace for Microsoft Teams**; **Asset Library** (share assets across Excel and PowerPoint); screen capture & send screenshot; send by email | S23/S24/S18, tier 1, verified |
| **AI** | **AI Search** (+ AI chat); **Company Intelligence** agent; **Deep Research** agent; **Advanced Dealing** NLP; **Teams AI Library**; **Tradefeedr** analytics-by-chat | S19/S20/S4/S10 |
| **Command / keyboard** | Search bar (ticker · short code · question); `RIC <space> App short code`; App Library; Launcher; Configuration Manager keyboard mode | S23/S19/S17/S16 |
| **Workspaces** | **Layouts**; **Tiles** + **Tile Manager** (group, auto-group, auto-arrange, My Tile set); **HERE Dock**; light/dark theme; four instrument-movement colour templates (American, European, Asian 1 & 2) | T1/S16/S22 |
| **Code / extensibility** | **CodeBook** (cloud Jupyter-style Python, *"zero-footprint … preloaded with popular APIs and software libraries"*); LSEG Data Platform Libraries (Python, TypeScript, .Net); Eikon Data API for Python (desktop); Side-by-Side API; **VS Code extension** for the LSEG Analytics API; **Model-as-a-Service** marketplace | S11/S22/S17/S15 |
| **Execution** | **REDI on Workspace** (EMS embedded in the platform); Advanced Dealing (FX) | S8/S20 |

**INTERPRETATION.** Two slots are unusually strong relative to a retail-facing terminal: **documents**
(filings + transcripts + licensed broker research, all searchable) and **collaboration** (a chat
network with a *cross-firm directory*). Two are unusually weak in public evidence: **charting** —
three chart products are named across the corpus and none is described in feature terms anywhere
public — and **alerts**, where nothing found describes alert *conditions* at all.

**RELEVANCE TO UCT.** The taxonomy slot where UCT is structurally ahead is **market overview**:
Workspace's is a news list plus a most-searched leaderboard, whereas UCT ships a computed daily
regime (exposure rating, breadth, the wire). The slot where Workspace is furthest ahead is
**documents**.

**CONFIDENCE.** 🟢 on the app *names* (every one is quoted). 🔴 on what most of them can actually do.

**OPEN QUESTION.** Is there any alerting in Workspace beyond news/price notification — e.g. an alert
on a screener result set changing? Nothing in the reachable corpus says.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five

Each entry states the **reconstructed path**, then what is **missing or unknown**. These are sketches
built from documented mechanics, not observed sessions; treat all as 🟡 unless marked.

**A — "Why is this stock moving?"**
Search bar → ticker → Company Overview; Reuters News + the 10,000-source feed on the same page; AI
Search will answer the question conversationally with citations. **Missing:** AI Search *"currently
surfaces market data and pricing as end-of-day values. Real-time data is not currently supported"*
[S19, tier 1, **verified**] — so the AI layer structurally cannot answer "why is it moving *right
now*". The intraday answer lives in the streaming Monitor/Tile world, the narrative answer lives in
the AI world, and the two do not meet. 🟢 on that gap; it is stated by LSEG.

**B — "Prepare me for earnings."**
I/B/E/S consensus + StarMine SmartEstimates + company guidance ranges + prior transcripts; AI Search
can summarise a transcript, and *"For transcripts, an AI-generated summary is available as a tab
alongside the full transcript"* [S19, verified]. Company Intelligence agent produces a shareable
overview including *"analyst research, deals, events and ownership"*, exportable to PDF/Word with
tables to Excel [S10]. **Missing:** no evidence of an *expected-move* or options-implied component —
FX/equity options with Greeks exist as data, but nothing joins them to an earnings-prep view.

**C — "Research this company from scratch."**
Strongest workflow. Company Overview → fundamentals → filings (10-K/10-Q with MD&A and risk factors)
→ transcripts → AMR broker research (entitlement-gated) → ownership → deals/tearsheets → peers →
export to Excel/PowerPoint via the Asset Library. The Company Intelligence agent compresses the first
pass to *"seconds"* [S10, tier 3, claimed]. **Missing:** nothing material.

**D — "What matters today?"**
Home page Top News; Workspace Top 50 (most-searched, **monthly**, not daily); Reuters Top News in
Teams; alert emails. **Missing:** no evidence of a *computed* daily state — no regime read, no
breadth summary, no "here is today's tape in one paragraph". Workspace's answer to "what matters" is
**what other people are searching for and what Reuters published**, which is a popularity signal and
an editorial signal, not an analytical one. 🟡 (absence of evidence in a corpus that is
marketing-heavy).

**E — "Find a trade."**
Screener app: pick UNIVERSE → quick filters → filters → currency → add columns from the Data Item
Library → optionally tick **Series** for historical time series → export to Excel [T1]. AI Search
also supports *"screening to build custom datasets or universes"* in natural language [S19].
**Missing:** the Screener as documented is a **fundamental/reference** screen. Nothing found
describes technical criteria, pattern conditions, or intraday screening. LSEG's own AI limitation is
telling here too: *"we do not currently support exact dates or custom date ranges"* [S19, verified].

**F — "Monitor my universe."**
Tiles/Tile Manager (floating windows, per-tile search bar, group and auto-group), Layouts, PAL,
Watchlist Pulse, alerts, mobile push. Hard ceiling: **2,500 streaming RICs** desktop / **1,000 per
browser tab** [S17, verified]. **Missing:** no public description of what a Monitor row can compute.

**G — "Understand the regime."**
Datastream (120 years) + economic series + curves + MarketPsych (sentiment analytics) + ESG. The
Deep Research agent *"explores complex financial questions across multiple data sources"* drawing on
*"Datastream pricing and I/B/E/S estimates"* [S4, tier 3, claimed]. **Missing:** regime here is a
**research capability**, not a **product state**. There is no evidence of Workspace ever telling a
user "the market is in X" unprompted.

**INTERPRETATION across A–G.** Workspace is overwhelmingly strong on **C** and weakest on **D** and
**G** — precisely the inverse of UCT's shape. The structural reason is the philosophy in Section A:
a container sized by entitlement cannot easily assert a house view, because the house view would be
a claim that some users' data does not support.

**RELEVANCE TO UCT.** This is the single most important comparative finding in the dossier and
Section M leads with it.

**CONFIDENCE.** 🟡 overall; 🟢 only on the specific quoted limitations (no real-time AI, no custom
date ranges, RIC caps).

---

## F. Data

**OBSERVATION — coverage, as LSEG states it** [S3, tier 3, **claimed**; figures are marketing figures
and are not independently checked]:

- Datastream: *"120 years of information"*
- Company Fundamentals: *"99% of global market cap, across 120 countries"*; elsewhere *"116K
  companies across 150+ exchanges"* [S14] and *"over 100,000 companies"* for the Data-as-a-Service
  fundamentals set [S15]
- I/B/E/S Estimates: *"23,000 companies in 90 countries"*, and **340+ consensus measures** [S19]
- Lipper: *"360,000 collective investments in over 80 countries"*
- ESG: *"over 90% of global market cap"*, *"1,000+ ESG metrics"*
- Research: *"nearly 1,300 actively contributing providers from 87 countries"*
- Pricing: *"2,000 contributing sources"*
- CodeBook page: *"9.2M company financial data points annually, 1.2M equity quotes, 9.5M fixed income
  securities, and 9.5M active economic time series"* [S11]

**Asset classes.** Equities, fixed income (bond pricing/analytics by ISIN/RIC/CUSIP, bond futures,
IRS incl. tenor-basis and cross-currency), FX (spot, forwards, forward curves, **volatility
surfaces**), options (vanilla, Asian, barrier, binary; FX and equity underlyings, **with full
Greeks**), commodities, funds, private markets (Nasdaq eVestment, Preqin), ESG [S19, tier 1,
verified; S8].

**Real-time vs delayed — the important distinctions, all verified:**
- Streaming real-time exists and is **capped by RIC count** (2,500 desktop / 1,000 per browser tab),
  raisable to 5,000 on request; **no cap** in a customer-managed RTDS deployment [S17].
- Deployment is **LSEG hosted** or **customer managed** (feeds and a Real-Time Distribution System on
  the customer site) [S22].
- **The AI layer is end-of-day only** [S19] — see I.4.
- AI Search content freshness: transcripts and filings *"typically available within two hours"*,
  broker research *"within eight hours"*, news *"updated continuously"* [S19].

**History depth ceilings that were found:**
- News in AI Search: *"Up to 15 months of historical coverage"* [S19]
- AMR in AI Search: *"18 months of AMR history. This will increase incrementally on a
  quarter-by-quarter basis"* [S19]
- Intraday high-frequency data, academic entitlement: *"Available on LSEG Workspace for the previous
  90 days only"* [T1, tier 9, reported]
- Datastream, academic entitlement: 10 million data points per month standard [T1]

**INTERPRETATION.** The depth story is bimodal. Datastream's 120 years and the full derivative
analytics stack are genuinely deep. But the **AI-reachable** corpus is shallow and recent (15 months
of news, 18 months of research, end-of-day prices), which means the modern front door reaches a much
smaller product than the classic one. Workspace has, in effect, two data products behind one bar.

**RELEVANCE TO UCT.** UCT's AI surfaces (AI Search, Compass, the brain KB) have the mirror-image
risk: a member types a question into a natural-language box and cannot tell whether the answer came
from live bars, the nightly snapshot, or an 8,500-entry KB. Workspace's response is to *document the
freshness per content type* in the FAQ the user can open.

**CONFIDENCE.** 🟢 on the freshness/ceiling statements (LSEG's own FAQ). 🟡 on coverage counts (all
marketing). 🔴 on latency — no figure was found anywhere.

**RECOMMENDATION (hypothesis).** Publish a per-source freshness table for every UCT AI surface and
make it reachable from inside the surface. Workspace's FAQ answers "how often is the data refreshed?"
in five lines; UCT's members currently have no way to ask.

**OPEN QUESTION.** Is the 2,500-RIC cap per user or per installation, and does an options chain count
one RIC per contract? (This determines whether the cap is generous or crippling for a flow desk.)

---

## G. Customization

**OBSERVATION.** What is verifiably customisable:

- **Layouts** — named, persisted, described as *"personalised views of LSEG Workspace to monitor your
  favourite companies"* [T1].
- **Tiles** — floating windows, each with its own search bar; grouped, auto-grouped and auto-arranged
  by Tile Manager; **My Tile set** as a saved collection [S16/S17].
- **Screener columns** — added from the **Data Item Library**, with an optional **Series** checkbox
  that turns a column into a historical time series, and a per-screen output **currency** [T1]. This
  is the most concrete table-customisation evidence in the corpus.
- **Theme** — light or dark, chosen at onboarding [S22].
- **Instrument movement colours** — four templates: *"American, European and Asian 1 & 2"* [S22].
  (i.e. red/green up-down conventions differ by region and Workspace ships all of them.)
- **Language** — UI in English, Simplified Chinese, Japanese; **content languages** chosen separately
  and multi-select [S22].
- **Location for Search** — biases search ranking (Section C.2).
- **Alert email** — set at onboarding, verified within 48 hours [S22].
- **Excel** — Formula Builder for *"complex calculations … for advanced modelling"*, Annotations,
  Logos, Asset Library, Chart Builder, Deals BI, RMS, Audit; the Lite add-in explicitly drops
  *"Deals BI, RMS, Audit, or Screener"* [S18, tier 1, verified].

**Multi-monitor.** **NOT DETERMINED.** The system-requirements page specifies *"PCI Express (PCIe)
card with minimum of 256MB memory per port"* — a per-port graphics requirement that strongly implies
multi-monitor is an assumed deployment — but no document found states a supported monitor count
[S6, tier 1]. Ceiling: the IT-managed installation guides are the likely home for this.

**INTERPRETATION.** Two of these are quietly excellent and both concern **making the same product
readable to different humans** rather than making it configurable for its own sake: the four
regional up/down colour templates, and separating *interface language* from *content language*.
Neither is a power-user feature; both are respect-for-the-reader features.

**RELEVANCE TO UCT.** UCT's chart settings already carry per-user colour and a theme system, and the
Model Book/Charts work has repeatedly hit the "a pinned theme-invariant token orphans descendants"
class of bug. The regional colour templates are a reminder that up/down colour is a **locale**
concern, not just an aesthetic one — UCT's Discord and member base skew US but are not exclusively so.

**CONFIDENCE.** 🟢 on everything quoted. 🔴 on multi-monitor, saved-layout limits, and whether layouts
are shareable between users.

**RECOMMENDATION (hypothesis).** Separating "language of the chrome" from "language of the content"
is the generalisable move: TERMINAL-NEXT's analogue is separating **density of the chrome** from
**density of the content** — a desk user who wants a compact UI does not necessarily want terser
prose in the wire.

---

## H. Search / commands (navigation efficiency)

Covered mechanically in C.2; this section records the efficiency claims and their gaps.

**OBSERVATION.**
- **Ticker resolution** is fuzzy and *localised*, not exact-match: suggestions are ranked, and
  ranking is biased by the user's declared Location for Search [S22, T1]. RICs (Reuters Instrument
  Codes) remain the canonical identifier — the Teams share syntax is literally `RIC <space> App short
  code` [S23], and streaming limits are counted in RICs [S17].
- **Identifier breadth** is unusually wide: ISIN, SEDOL, LEI, CUSIP, PermID, plus TRBC/GICS/NAICS/SIC/ICB
  classifications, all listed as AI-Search-reachable company data [S19, verified].
- **App short codes** exist and are typed into the same bar (`SCREENER`, `Help`, `Feedback`,
  `Content Kiosk`, `ADVRES`) [T1, S22].
- **Search history** is stored and re-suggested [S22].
- **Deep links** jump from a citation or a share into the exact place in a Workspace app [S19, S17].

**INTERPRETATION.** The command surface is a **superset resolver** rather than a grammar. Bloomberg's
model is `<TICKER> <FUNCTION> <GO>` — a two-token grammar the user composes. Workspace's is one box
that classifies. The Workspace model is far easier to learn and structurally weaker at *composition*:
there is no evidence you can express "this ticker, in that app, on that timeframe" in one keystroke
sequence the way a function-code grammar allows.

**RELEVANCE TO UCT.** TERMINAL-NEXT has to choose between these two idioms early, because they imply
different data models (a classifier needs ranking signals; a grammar needs a registry of verbs). UCT
already has the registry half — `WIDGET_REGISTRY`, the route taxonomy in `navGroups.js`, the voice
`_PAGE_DESCRIPTIONS` map — and `tests/test_navigation_targets_resolve.py` already proves the aliases
resolve. That is most of a grammar's substrate, unused.

**CONFIDENCE.** 🟡 — the classifier reading is an interpretation across four documents; no single
source describes the resolver.

**RECOMMENDATION (hypothesis).** A one-box resolver and a two-token grammar are not exclusive: ship
the resolver as the default and let a space-separated second token pin the destination
(`NVDA flow`, `NVDA wire`, `NVDA levels`). Test whether desk users converge on the grammar and
members stay on the resolver.

**OPEN QUESTION.** Does Workspace support a *history* of commands (recall the last N), and is there
any command palette distinct from the search bar? Not found.

---

## I. AI — the best-evidenced section in this dossier

LSEG publishes an **AI Search FAQ** (21pp, July 2026), an **AI Explainability Note**, and **AI Search
Release Notes** including a *Known issues* table. This is a level of public candour worth studying in
its own right.

### I.1 What shipped, and when

**OBSERVATION.** **AI Search reached general availability on 23 June 2026**, after a pilot [S21, tier
1, **verified**]. It requires **Workspace version 1.26.504 or above**, or Workspace 2.0, and is
excluded from Workspace Access, Students, Kiosk and Media editions, and **from users in mainland
China** [S19, verified].

Three named AI products:
1. **AI Search** (and AI chat) — GA.
2. **Company Intelligence** agent — launched July 2026, *"currently live with several thousand
   users"*; outputs export to PDF/Word, tables to Excel; Teams availability *"coming soon"* [S4/S10,
   tier 3, **claimed**].
3. **Deep Research** agent — available in Workspace and Workspace for Teams [S4, tier 3, claimed].

Plus three narrower AI uses documented in the Explainability Note: **Advanced Dealing** NLP (converts
FX chat text ↔ structured trade forms via Microsoft Language Studio), **Teams AI Library** (converts
a typed query into a bot command or API call), and **Tradefeedr** (execution analytics from
unstructured chat queries) [S20, tier 1, verified].

### I.2 Grounding and citation behaviour — the mechanism, quoted

**OBSERVATION.** [S19, tier 1, **verified**; emphasis mine]

- *"Answers include clear, clickable citations with snippet previews."*
- *"For structured data – such as fundamentals, estimates, pricing, FX, fixed income, deals, and ESG
  – citations appear inline at the point of use, so every figure can be traced back to its source.
  **When data is presented in a table, each value carries its own citation.**"*
- *"For document-based citations, clicking a citation opens the source document in a dedicated canvas
  view"*, and *"clicking a citation will highlight the exact passage in the document"*.
- Charts are auto-rendered from quantitative answers across 13 named types (line, vertical/horizontal
  bar, dual-axis, area, donut, radar, scatter, bubble, waterfall, heatmap, Sankey), with metric
  cards, reference-line annotations, hover values, and *"Workspace colour palette and styling applied
  consistently across all charts"*.
- **Premium content is never summarised.** For Aftermarket Research: *"AI Search does not generate AI
  summaries of AMR content. You are shown verbatim extracts taken directly from the underlying AMR
  report. No generative AI interpretation, rewriting, or summarisation of AMR content is performed."*
  And *"AMR content is always surfaced as a distinct content source"* — never blended.
- AMR usage is **metered at page level**, triggered when an extract is *displayed* regardless of
  click-through, deduped within 24 hours including on revisiting an old chat.

**INTERPRETATION.** This is the most sophisticated grounding contract found in any benchmark so far,
and its cleverest property is **the three-tier content policy**: LSEG's own structured data gets
per-value inline citations; documents get passage-level highlighting; **licensed third-party research
gets verbatim-only, unblended, metered extracts**. The third tier exists for contractual reasons, but
it produces an unexpectedly good epistemic result — *the content LSEG does not own is never
paraphrased by a model*.

### I.3 The models — and a documented vintage discrepancy

**OBSERVATION.** The AI Search FAQ (July 2026) says: *"AI Search currently uses two Large Language
Models: GPT-5 and above, and Claude Opus 4.6 and above … hosted in LSEG's secure Azure cloud
infrastructure, for Retrieval Augmented Generation (RAG) and orchestration"* [S19, tier 1, verified].

The AI Explainability Note describes a differently-shaped system: *"The models used include the ADA2
embedding model and OpenAI's GPT4 model. Access to the models is provided by the Azure OpenAI
Service"*, and adds a feature the FAQ never mentions — **an optional Bing fallback**: the system will
*"Generate an answer using Bing Search if no relevant information is found using LSEG data, and if
the user has turned this option on"*, a choice offered *"when they first open LSEG Workspace AI"*
[S20, tier 1, verified].

**INTERPRETATION.** These are two generations of the same product documented side by side on the same
website: the Explainability Note describes the older "LSEG Workspace AI" (GPT-4 + ADA2 + opt-in Bing
grounding); the FAQ describes GA AI Search (GPT-5 / Claude Opus 4.6, RAG + orchestration). **Neither
document is dated in a way that resolves which governs today**, and the Bing fallback is a material
governance fact — an ungrounded web answer inside a product whose entire pitch is grounding. A
customer reading the two documents cannot tell whether that door is still open.

⛔ **This is the "second authority over one value" defect at documentation scale**, and it is worth
recording as a benchmark-derived lesson: LSEG has one of the best-specified AI grounding contracts in
the industry and *still* ships two live descriptions of its own model stack that disagree.

### I.4 What LSEG says it CANNOT do (all verified, all quoted)

- *"Does AI Search have access to real-time market data? … **Real-time data is not currently
  supported.**"*
- *"we do not currently support exact dates or custom date ranges"* (relative dates only).
- *"it does not provide financial or investment advice or trade recommendations"* — with a worked
  example: *"if you ask, 'Should I buy Tesla?', AI Search will not give a yes or no answer. Instead,
  it will present a balanced overview of relevant data … alongside a disclaimer."*
- *"generative AI can produce variable outputs — repeating the same question may return slightly
  different wording, and in rare cases responses may be incomplete or outdated. **You should always
  verify critical figures against the cited source before relying on them.**"*
- *"AI-generated responses are not deterministic, even with the same question and the same data
  access, answers may vary between users or across sessions."*
- **Fair-use limits**, reset monthly, and LSEG names them for what they are: *"The current limits
  should be viewed as operational safeguards rather than long-term commercial entitlements. As AI
  Search matures, we expect to introduce commercial licensing models…"*
- Published **Known issues** at GA [S21]: citations *"may show incomplete attribution … and, on
  occasion, can be missing from responses"*; tables sometimes render as plain text; documents
  sometimes fail to open in the viewer; Safari copy broken; charts not always included when copying;
  *"On smaller screens, layout issues may occur"*; *"Under heavy usage, a small percentage of
  requests may fail"*; *"Some accessibility features, such as screen reader support and keyboard
  navigation, are still being improved."*

**Privacy posture** [S19, verified]: chat history stored in an LSEG tenant; prompts processed in a
Microsoft tenant which *"may retain your chat history for up to 30 days for safety and content
monitoring"*; history used **anonymised** for evaluation; **not** used to train models (the FAQ
question "Does AI Search use my questions or prompts to train the AI model?" is in the contents,
answered in the affirmative-safety direction elsewhere in the same section); PII is scanned for in
both directions and *"If we detect personal data in your query or in our response, we may decline to
respond"*; users can opt out entirely via their account manager.

**Prompt-injection observation (recorded, not acted on).** The FAQ's closing page is a user
agreement that asks users to *"Use AI Search responsibly and avoid prompt injections"* and not to
insert *"hidden instructions, misleading inputs, commands, or special phrases intended to confuse the
model, break the rules, bypass restrictions, or override its normal behaviour"*, with access
suspension as the penalty [S19]. This is directed at Workspace's users, not at this agent, and no
instruction in the source corpus was followed; it is logged here because a **published
acceptable-use clause on prompt injection** is itself a product decision UCT may want to copy.

**RELEVANCE TO UCT.** Directly comparable to UCT's own AI rails: the COT narrative's grounding gate
(every number in the prose must appear in the facts, else nothing is stored), `validate_chat_output`,
`grade_ticker`'s "the model narrates but cannot hedge or fabricate", and the report-card's auto-fail
safety tokens. UCT has arguably *stronger* enforcement (a gate that refuses to publish) where LSEG
has *stronger disclosure* (a public FAQ that tells the user exactly what to distrust).

**CONFIDENCE.** 🟢 — this section is almost entirely direct quotation from versioned LSEG documents.
The only 🟡 is which model stack is live today (I.3).

**RECOMMENDATION (hypotheses).**
1. **Per-value citation in tables.** *"When data is presented in a table, each value carries its own
   citation"* is the highest-value idea in this dossier for UCT's wire and Compass surfaces: not
   "here are my sources" at the end, but a source per cell.
2. **A three-tier content policy.** UCT already has content it owns (breadth, flow, the book), content
   it licenses (vendor bars, news), and content members write. Adopting LSEG's rule — *never paraphrase
   what you do not own; quote it verbatim, attributed, unblended* — would resolve several open
   questions at once.
3. **Publish the known-issues table.** LSEG shipped a GA product with its citation bugs listed in
   public. UCT's equivalent (an artifact-level "what this surface cannot currently do") would be
   cheap and would convert several recurring member-support questions into documentation.
4. **Refuse the verdict where the data cannot support it, and say so in the same breath.** LSEG's
   "Should I buy Tesla?" answer is a template: refuse the recommendation, deliver the balanced data,
   name the disclaimer — which is the *opposite* posture to UCT's deliberate `grade_ticker`
   decisiveness. Both are defensible; the difference is that LSEG serves strangers and UCT serves a
   coached membership. **This tension deserves an explicit program decision, not a drift.**

**OPEN QUESTION.** Is the Bing fallback still live, and if so is it on by default for new users?

---

## J. UX: strengths and weaknesses

**Strengths (evidenced).**
- **One front door.** Ticker, app and question all start in the same box (C.2).
- **Progressive onboarding that buys something.** The first-run flow asks five questions (role, asset
  classes, primary asset class, languages, theme, movement colours) and each has a visible payoff
  [S22, verified].
- **Explicit surface honesty.** LSEG publishes what the web build cannot do (C.4).
- **Support inside the product.** Live chat 24/7 in English, plus local-language support across 18
  languages; help and feedback reachable by typing their names into the search bar [S22, verified].
- **Density is chosen, not imposed.** Tiles are described as the *traditional trading* mode, i.e.
  maximum density is opt-in [S17].

**Weaknesses (evidenced, and thinner).**
- **Two desktop containers mid-migration**, with a documented `Under development` column between them
  (deep links, Data API, SxS all missing on HERE Core) [S17].
- **Accessibility is behind.** *"Some accessibility features, such as screen reader support and
  keyboard navigation, are still being improved"* at AI Search GA [S21], and LSEG publishes a VPAT
  rather than a conformance claim [S1 link map].
- **Small screens are a known problem in the AI surface** [S21].
- **The AI layer and the real-time layer do not meet** (E.A, F).
- **Keyboard depth is undocumented** (C.5) — for a product whose lineage is a trading terminal, three
  years of release notes surface exactly three keyboard shortcuts, all FX dealing.

**Onboarding.** Beyond the first-run flow: welcome emails with unique credential links; an LSEG
Academy with a *"LSEG Finance Essentials certification"* and *"Become LSEG Workspace certified"*
[S14, tier 3, claimed]. A vendor that sells a certification is a vendor that expects a learning curve.

**Anti-patterns to name.**
- **A "Lite" tier defined by subtraction.** The Lite add-in is described by what it lacks
  (*"Do not require advanced features, such as Deals BI, RMS, Audit, or Screener"*) [S18]. Defining a
  tier as a hole-punched superset is how you end up unable to answer "what is Lite *for*".
- **Editions named only in exclusion lists.** "Workspace Access", "Kiosk" and "Media" appear in this
  corpus **only** as things AI Search is not available on [S19].

**EVIDENCE.** All of the above from S17/S19/S21/S22/S18/S14 — tier 1–3, **verified** except where the
tier says claimed.

**EVIDENCE CEILING — this section is the weakest in the dossier.** The lived experience of using
Workspace is not reachable: trustradius.com returns 403; g2.com returns 403 (as B-BBG-01 also found);
the practitioner SERP for performance and usability complaints returns only **rfp.wiki**, an
AI-generated comparison-page network the evidence standard explicitly excludes. Those pages do
consistently repeat a theme — a *"rocky"* Eikon→Workspace migration and lost *"power-user
shortcuts"* — which is **recorded as a LEAD to verify, not as evidence** [T4]. It would be raised by:
a 30-day trial, a practitioner interview, or one screenshot set.

**CONFIDENCE.** 🟡 on strengths (vendor-sourced), 🔴 on weaknesses as *experienced*.

---

## K. Performance (all REPORTED or inferred — no measurement was possible)

**OBSERVATION.**
- **Stated system requirements** [S6, tier 1]: 8 GB RAM, Intel 5th-gen Core i (desktop access
  *"Intel i7 or faster"*), Windows 10 64-bit or macOS 10.13+, 1920×1080 (desktop) / 1920×1280 (web),
  3–5 GB disk, *"PCI Express (PCIe) card with minimum of 256MB memory per port"*.
- **The desktop is Electron**, and its release history is largely Electron-version and
  installer-stability work: *"Upgrade to Electron 11"* (1.14), *"Upgrade to version 23 of Electron"*
  (1.22), *"New version of Electron"* (1.26.1) [S16, tier 2, verified].
- **Recent releases are explicitly performance-motivated.** 1.26.7 MR2 (22 August 2026): *"Ability to
  enable / disable Chromium's default background throttling by configuring the local setting"*,
  *"Several improvements to reduce background activity and enhance performance"* [S16, verified].
- **Density ceiling is published as a number**: 2,500 streaming RICs desktop, 1,000 per browser tab
  [S17, verified].
- **AI performance is caveated at GA**: *"Under heavy usage, a small percentage of requests may fail
  or return errors"* and *"Very complex queries may occasionally hit system limits, resulting in
  incomplete responses"*; *"complex queries involving multiple data sources or detailed analysis may
  take a little longer to respond"* [S21/S19, verified].
- **Support policy**: LSEG supports *"versions of Workspace released during the previous nine months
  (the obsolescence period)"* [S16, verified].

**INTERPRETATION.** An Electron shell that ships a user-facing toggle for *Chromium background
throttling* is a product that has been fighting the same class of problem UCT has (hidden tabs
throttling timers, background work competing with paint). LSEG's answer was to expose the trade-off
as a setting rather than pick for the user — arguably an admission that neither default is right for
everyone.

**RELEVANCE TO UCT.** UCT already knows *"a hidden chrome tab defers paint and throttles timers"*.
Workspace exposing it as a configurable local setting is a data point for TERMINAL-NEXT: on a desk
machine with a terminal in a background monitor, throttling is a bug; on a laptop it is a battery
feature.

**CONFIDENCE.** 🔴 on anything resembling measured responsiveness. No latency figure, no render
budget, no benchmark, no independent test was found anywhere. Everything above is a **requirement,
a limit, or a vendor caveat** — not a measurement. Raised by: a trial with a stopwatch.

---

## L. Pricing / business model

**OBSERVATION — the verified half.**
- **LSEG publishes no price for Workspace anywhere on its own site.** Neither the product page, the
  trial page, the wealth/traders/academia pages, nor the Service Overview contains a figure
  [S1/S5/S12/S13/S14/S22, all fetched 2026-09-02].
- **Applications are not sold individually.** *"LSEG applications are not available for purchase
  individually but are packaged into propositions based on user workflows. LSEG Workspace contains
  all the available LSEG applications."* [S22, tier 1, **verified**]
- **The licence is per named user and covers all three surfaces.** *"By purchasing a license for LSEG
  Workspace you can access LSEG Workspace through a desktop application, web portal, and mobile
  device."* It is *"an individual information service for the use of the licensed user only"*
  [S22, verified].
- **Additional content is a separate purchase**, browsable in-product: *"You can find a catalogue of
  content available for purchase in the Content Kiosk application"* [S22, verified].
- **Seat administration is self-service** for purchase/user-swap/assign-unassign/user-detail changes,
  via License Management tools; cancellation and international relocation are not [S24, verified].
- **Trial**: 30 days, free, for *"a new LSEG customer"*, requestable from *"the LSEG Workspace
  e-commerce site"*; full support during trial; access ends if no purchase [S5/S24, verified].
- **Add-on economics that ARE public:**
  - **Workspace in Teams is free** to anyone with an active Workspace licence [S24, verified].
  - **Open Directory requires a separate LSEG Messenger licence** [S24, verified].
  - **AMR (broker research) is a separate subscription** and is **metered by page view** — an AI
    Search answer that shows an AMR extract *"triggers a page-level usage event … regardless of
    whether you click through to the full report"* [S19, verified].
  - **AI Search is currently free-of-additional-charge under fair use**, and LSEG has said in writing
    that this is temporary: *"we expect to introduce commercial licensing models"* [S19, verified].
- **Professional vs non-professional**: **NOT DETERMINED.** No such distinction appears anywhere in
  the reachable corpus. The nearest analogues are the entitlement-limited editions (Students, Kiosk,
  Media, Access).

**EVIDENCE CEILING — the unverified half.** A public-web search returns a tight cluster of dollar
figures (roughly **$10,000–$25,000 per user per year**, most commonly **~$22,000**, with one source
quoting **$1,000–$2,500 per user per month**). **Every one of those sources is a vendor-comparison,
procurement-marketplace or AI-generated SEO page** — Vendr, Hudson Labs, investables.ai, PageCrawl,
Amafi, nownews.dev — i.e. precisely the tier the evidence standard tells this program to exclude.
They are recorded as **[T2] leads, not evidence**. One of them states the situation accurately and is
worth repeating for that reason alone: *"LSEG Workspace is quote-only and publishes no price list."*
A UK/EU public-procurement award naming a Workspace seat price was searched for and **not found**.
This section would be raised by: an owner-supplied quote, a public-sector contract award, or a
university library's published database-cost disclosure.

**INTERPRETATION.** The commercial model is **"one seat, whole catalogue, negotiated per firm, with
metered premium content on top."** That combination explains the product's philosophy (Section A): if
every seat carries every app, the only levers left are *which datasets the seat is entitled to* and
*how much metered content it consumes* — so entitlement *becomes* the product.

**RELEVANCE TO UCT.** UCT's tiers are the inverse: a small catalogue, a public price, a badge-shaped
`tier`. The transferable observation is not the price — it is **metering a premium third-party
content type by view, inside an AI answer, with a documented 24-hour dedup window**. UCT will face
exactly this the moment an AI surface starts quoting a licensed source.

**CONFIDENCE.** 🟢 on the model shape and every add-on rule quoted. 🔴 on any number.

---

## M. Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **Per-value citation inside tables.** *Hypothesis:* if every number in a wire table, a Compass
   answer, or a COT read carries its own source pin (not a footnote at the end), members will trust
   and act on the surface more, and the grounding gate becomes visible rather than invisible.
   *Serves:* Workflow A, B, G; the Morning Wire; Compass chat. *Evidence:* S19 §Key features.
   *Cost signal:* UCT already stores the facts a narrative was grounded on (`cotFacts.js`,
   `cot_narratives`), so the pin is a rendering change more than a data change.

2. **A three-tier content policy: own it → paraphrase; license it → quote verbatim, unblended,
   attributed; member content → never synthesise into house voice.** *Hypothesis:* this removes a
   whole class of future licensing and trust problems before UCT has them. *Serves:* every AI surface.
   *Evidence:* S19 AMR section. *Anti-drift value:* it is a rule a reviewer can check, not a taste.

3. **A published, per-surface capability matrix.** *Hypothesis:* stating what the phone/tablet/desktop
   build cannot do converts support load into documentation and prevents the "documented but
   unreachable" class of claim. *Serves:* the mobile-seamless initiative; onboarding. *Evidence:* S17.

4. **A published per-source freshness table, reachable from inside the surface.** *Hypothesis:* the
   commonest silent failure in a data terminal is a user assuming a number is live. *Serves:*
   Workflow D and F; the breadth live row; the flow tape. *Evidence:* S19 §How often is the data
   refreshed.

5. **Separate interface locale from content locale.** *Hypothesis:* the generalisation — separating
   *chrome density* from *content density* — lets one product serve the desk (maximum density) and a
   new member (maximum explanation) without forking screens. *Serves:* all personas. *Evidence:* S22.

6. **Regional up/down colour templates as a first-class setting.** *Hypothesis:* cheap, and it is a
   correctness issue for non-US members, not a preference. *Serves:* charts, breadth, flow.
   *Evidence:* S22 (American / European / Asian 1 & 2).

7. **A published known-issues table shipped WITH a feature at GA.** *Hypothesis:* UCT's recurring
   "built, tested, green and unreachable" failure would be caught earlier if every ship required
   writing down what the feature still cannot do. *Serves:* the whole program. *Evidence:* S21.

8. **An acceptable-use clause on prompt injection for member-facing AI.** *Hypothesis:* stating the
   rule publicly makes enforcement (rate-limiting, suspension) legible rather than arbitrary.
   *Serves:* AI Search, Compass, the voice assistant. *Evidence:* S19 final page.

9. **Onboarding that asks for role + primary focus, and spends it on NAVIGATION only.** *Hypothesis:*
   re-ranking the menu is the reversible, low-blast-radius half of personalisation; re-ranking content
   is the half that creates two members who disagree about the tape. *Serves:* member onboarding.
   *Evidence:* S22.

10. **Metering premium third-party content by view, with a 24-hour dedup window, counted at the point
    of DISPLAY.** *Hypothesis:* if UCT ever surfaces licensed research or a paid data extract inside
    an AI answer, this is the already-solved shape. *Evidence:* S19 AMR section.

11. **Expose the background-throttling trade-off as a setting rather than choosing for the user.**
    *Hypothesis:* a desk machine with a terminal on a background monitor and a member's laptop want
    opposite defaults. *Serves:* the flow tape, live charts. *Evidence:* S16 (1.26.7 MR2).

---

## N. Bad ideas for UCT (avoid, and why)

1. **"One product, everything in it, entitlement decides what you see."** This is Workspace's
   philosophy and it is the direct cause of its weakness on Workflows D and G: a container cannot
   hold a house view. UCT's edge *is* the house view. **Do not let TERMINAL-NEXT drift toward a
   catalogue.**

2. **A "Lite" tier defined by subtraction.** *"Do not require advanced features, such as Deals BI,
   RMS, Audit, or Screener"* [S18] describes a hole, not a job. UCT's free tier already risks this
   shape (`FREE_PAGES` is a whitelist). Define a tier by the workflow it completes.

3. **Two shells mid-migration with an "Under development" column between them.** [S17] Whatever
   TERMINAL-NEXT's shell decision is, ship one. UCT has independently learned this
   (`MobileTabBar` removal: *one menu, and every trigger opens THAT*).

4. **An AI layer that cannot see real-time data, inside a real-time product.** [S19] For UCT this
   would be fatal, not merely awkward: a member asking Compass "why is this moving" during RTH must
   not be silently answered from yesterday's close. If a UCT AI surface is EOD-bound, it must **say
   so in the answer**, not in a FAQ.

5. **Naming editions only in exclusion lists.** "Workspace Access / Kiosk / Media" appear in this
   entire corpus only as things AI Search is *not* available on. A product tier nobody can describe
   is a tier nobody can sell — and, closer to home, a flag whose OFF state is indistinguishable from
   never-set (`project_feature_flag_ledger`).

6. **Publishing three live documents that disagree about your own AI stack.** [I.3] LSEG has the best
   grounding contract in the benchmark set and still ships a GPT-4+Bing description alongside a
   GPT-5/Claude description. Documentation drift is the same defect class as a second authority over
   one value.

7. **Marketing coverage counts that disagree across your own pages.** *"99% of global market cap,
   across 120 countries"* [S3] vs *"116K companies across 150+ exchanges"* [S14] vs *"over 100,000
   companies"* [S15]. Three numbers, one product, three pages. **Derive the number through the
   shipping reader or do not print it.**

---

## O. Screenshots / evidence (links only; no images reproduced)

Official documents downloaded and read in full (all under
`https://www.lseg.com/content/dam/data-analytics/en_us/documents/support/workspace/`):

- `release-notes.pdf` — Workspace **1.26.8**, document version 1268.01, release date **05 September
  2026**, build 1.26.831; version history back to 1.12 (November 2020).
- `desktop-web-comparison.pdf` — document version 100.02, dated 29/04/2026.
- `add-in-comparison.pdf` — **Version 1.26.5**; full Excel/Word/PowerPoint ribbon function matrix
  across four add-ins.
- `lseg-workspace-ai-search-faq.pdf` — **July 2026**, document version 100.01, 21pp.
- `ai-search-release-notes.pdf` — **June 2026**, document version 2606.01; GA date 23 June 2026;
  includes the *Known issues* table.
- `ai-explainability-note.pdf` — undated; covers Workspace AI, Advanced Dealing, Teams AI Library,
  Tradefeedr.
- `service-description.pdf` — LSEG Workspace *Service Overview*, 29pp.
- `teams-user.pdf` — *LSEG Workspace | Teams with Open Directory User Guide*, 23pp.
- `teams-service-description.pdf` — 16pp.

Other LSEG documents catalogued but **not read** (available to Wave 2 at the same path):
`accessibility-vpat.pdf`, `admin-panel-config.pdf`, `admin-tools-config.pdf`, `installation.pdf`,
`here-core-faq.pdf`, `entra-faq.pdf`, `support-policy.pdf`, `system-requirements.pdf`,
`system-test.pdf`, `add-in-admin.pdf`, `add-in-release-notes.pdf`, `messenger-release-notes.pdf`,
`user-message-feed-tech-overview.pdf`, `teams-installation.pdf` (45pp — the likely home of Open
Directory chat-room and group-management mechanics), `pdp-dacs-config.pdf`, `wss-config.pdf`.

**No official screenshots, demo videos or session recordings were located** on a public, unauthenticated
URL. The library guide [T1] describes screens in prose. Product-page imagery is marketing composite.

---

## P. Confidence by section

| § | Confidence | Ceiling and what would raise it |
|---|---|---|
| A Executive summary | 🟢 identity/surfaces; 🟡 philosophy | Philosophy is my interpretation across S1/S17/S22 |
| B Personas | 🟢 names; 🔴 what editions withhold | No public entitlement matrix; a sales quote would raise it |
| C Navigation | 🟢 frame, surfaces, tiles; 🟡 search disambiguation; **🔴 keyboard** | Login-gated in-product help; a trial or screenshots |
| D Capability map | 🟢 app names; 🔴 app capabilities | Per-app user guides are behind the authenticated docs site |
| E Workflows | 🟡; 🟢 only on quoted limitations | No observed session. Wave 2 reconstructs five |
| F Data | 🟢 freshness/limits; 🟡 coverage counts; 🔴 latency | Coverage is marketing; no latency figure exists publicly |
| G Customization | 🟢 quoted items; 🔴 multi-monitor, layout sharing | IT-managed installation guides not read |
| H Search/commands | 🟡 (interpretation across 4 docs) | No single doc describes the resolver |
| I AI | 🟢 (best-evidenced); 🟡 which model stack is live | S19 vs S20 disagree; only LSEG can resolve it |
| J UX | 🟡 strengths; **🔴 weaknesses as experienced** | trustradius 403, g2 403, practitioner SERP = excluded tier. A trial or an interview |
| K Performance | 🔴 | No measurement anywhere. A trial with a stopwatch |
| L Pricing | 🟢 model shape; **🔴 every number** | LSEG publishes no price. A quote, a procurement award, or a library disclosure |
| M / N | 🟡 (hypotheses by construction) | — |
| O Evidence | 🟢 | — |

---

## What LSEG Workspace would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

Workspace's two weakest workflows are D ("what matters today") and G ("understand the regime"), and
the reason is structural rather than technical: a product whose philosophy is *"contains all the
available LSEG applications"*, sized per seat by entitlement, cannot assert a house view — any
assertion would be a claim some subscribers' data does not support. Drop UCT's proprietary layer into
that container and the missing half appears at once. The Home page stops being Reuters Top News plus
a monthly most-searched leaderboard and becomes a **computed daily state**: the exposure rating with
its gate reason, the breadth participation read, the distribution-day count, the regime label — with
Workspace's own citation machinery pinning every one of those numbers to the collector run that
produced it, per value, the way it already pins a fundamentals figure. The Screener stops being a
reference-data filter and gains the setup grammar — pattern, base stage, EMA proximity, ADR, relative
strength — so Workflow E ends in a named setup with an entry, a stop and a size rather than a
spreadsheet. Company Overview grows a *"what the tape did after this catalyst last time"* panel from
the analog engine. And the AI layer — which today explicitly refuses a verdict and returns a balanced
overview instead — could keep that refusal for strangers while offering, to an entitled desk seat,
the `grade_ticker` shape: a **structurally decisive**, tool-sourced GO/HOLD/SKIP whose decisiveness
comes from deterministic gates rather than model confidence, with every number carrying the inline
citation Workspace already renders. The interesting part is that this is not a data problem for LSEG
— they have deeper history, better filings, and Reuters. It is a **posture** problem: they have built
the finest apparatus in the industry for proving where a number came from, and then declined to say
what any of it means. UCT's proprietary intelligence is precisely the missing sentence at the end.
🟡 — this paragraph is a designed thought experiment, not a finding.

---

## GAPS (budget/reach not achieved)

1. **Search channel used.** `WebSearch` was assumed exhausted per the preamble and never called.
   Evidence came from (a) **WebFetch on lseg.com URLs**, seeded by asking the Workspace product page
   to enumerate its own link map — this was the highest-yield single move and is recommended to
   sibling roles; (b) **direct `curl` download of LSEG support PDFs + local `pypdf` extraction**,
   because WebFetch's summariser returned "corrupted PDF" on a 540 KB file it could not parse — the
   local-extraction path recovered nine documents WebFetch could not read; (c) **browser Google
   search in ONE tab, now closed** (5 queries).
2. **Queries that could not be run / returned nothing usable.** `warwick.libguides.com` is
   permission-blocked for browser page-reads in this session (WebFetch retrieved it instead);
   `trustradius.com` 403; `bing.com` via WebFetch mis-tokenised `"LSEG Workspace"` and returned the
   LSEG homepage; a procurement-award search for a Workspace seat price returned nothing.
3. **Authenticated sources not reached (the dominant ceiling).** `myaccount.lseg.com`, the "Workspace
   section of the authenticated website", the Workspace technical documentation site, and the
   Learning Centre catalogue are all login-gated. **Per-app user guides — Screener, Monitor, Charts,
   Alerts, PAL — live there.** Sections D, E and G are capped by this and by nothing else.
4. **Not read, but public and available to Wave 2:** `teams-installation.pdf` (45pp, Open Directory
   chat rooms and group management), `messenger-release-notes.pdf`, `add-in-release-notes.pdf`,
   `accessibility-vpat.pdf`, `here-core-faq.pdf`, `support-policy.pdf`, `system-test.pdf`, and the
   four persona pages for investment banking and asset management (link map in S1).
5. **Not attempted, deliberately:** the free 30-day trial. It requires a signup form and account
   creation, which this agent is prohibited from doing. **The owner could obtain one** — LSEG offers
   it self-serve to new customers — and it would raise Sections C (keyboard), D (app capabilities),
   E (all seven workflows), J (UX) and K (performance) from 🔴/🟡 to 🟢 in a single afternoon. This is
   the highest-leverage unblock available to this dossier.
6. **Pricing is unreachable by design.** No further public search is likely to help; Section L should
   be treated as closed at 🔴 unless the owner supplies a quote.

---

## SOURCES

**PRIMARY — LSEG-authored (tier 1 = official manual/support doc; tier 2 = official release notes;
tier 3 = official product/marketing page). All fetched 2026-09-02.**

1. **[S1]** LSEG Workspace product page — https://www.lseg.com/en/data-analytics/products/workspace — tier 3
2. **[S2]** Eikon product page (retirement notice) — https://www.lseg.com/en/data-analytics/products/eikon-trading-software — tier 3
3. **[S3]** Workspace data and content — https://www.lseg.com/en/data-analytics/products/workspace/data-and-content — tier 3
4. **[S4]** Workspace AI capabilities — https://www.lseg.com/en/data-analytics/products/workspace/workspace-ai-capabilities — tier 3
5. **[S5]** Workspace free trial — https://www.lseg.com/en/data-analytics/products/workspace/free-trial — tier 3
6. **[S6]** Workspace technical specifications — https://www.lseg.com/en/data-analytics/products/workspace/workspace-technical-specifications — tier 1/3
7. **[S7]** Download Workspace (installer v1.26.739) — https://www.lseg.com/en/data-analytics/products/workspace/download-workspace — tier 3
8. **[S8]** Workspace updates index — https://www.lseg.com/en/data-analytics/products/workspace/updates — tier 3
9. **[S9]** Update: *Improved security, seamless navigation* (July 2026) — https://www.lseg.com/en/data-analytics/products/workspace/updates/improved-security-seamless-navigation — tier 3
10. **[S10]** Update: *LSEG launches Company Intelligence in Workspace* (July 2026) — https://www.lseg.com/en/data-analytics/products/workspace/updates/lseg-launches-company-intelligence-agent-in-workspace — tier 3
11. **[S11]** CodeBook product page — https://www.lseg.com/en/data-analytics/products/codebook — tier 3
12. **[S12]** Workspace for sales and traders — https://www.lseg.com/en/data-analytics/products/workspace/sales-traders — tier 3
13. **[S13]** Workspace for wealth advisors — https://www.lseg.com/en/data-analytics/wealth-management-solutions/automate-advisor-workflow/workspace-wealth-advisors — tier 3
14. **[S14]** Workspace for academia/students — https://www.lseg.com/en/data-analytics/products/workspace/workspace-for-students — tier 3
15. **[S15]** LSEG–Microsoft partnership — https://www.lseg.com/en/microsoft-partnership — tier 3
16. **[S16]** *LSEG Workspace Release Notes* v1.26.8 (doc 1268.01; release 05 Sep 2026; build 1.26.831) — `…/support/workspace/release-notes.pdf` — tier 2
17. **[S17]** *Desktop and Web Comparison* (doc 100.02, 29/04/2026) — `…/support/workspace/desktop-web-comparison.pdf` — tier 1
18. **[S18]** *Add-in Comparison* v1.26.5 — `…/support/workspace/add-in-comparison.pdf` — tier 1
19. **[S19]** *LSEG Workspace AI Search FAQ*, July 2026 (doc 100.01) — `…/support/workspace/lseg-workspace-ai-search-faq.pdf` — tier 1
20. **[S20]** *AI Explainability Note* — `…/support/workspace/ai-explainability-note.pdf` — tier 1
21. **[S21]** *AI Search Release Notes*, June 2026 (doc 2606.01; GA 23 Jun 2026) — `…/support/workspace/ai-search-release-notes.pdf` — tier 2
22. **[S22]** *LSEG Workspace Service Overview* — `…/support/workspace/service-description.pdf` — tier 1
23. **[S23]** *LSEG Workspace | Teams with Open Directory User Guide* — `…/support/workspace/teams-user.pdf` — tier 1
24. **[S24]** *LSEG Workspace for Teams — Service Description* — `…/support/workspace/teams-service-description.pdf` — tier 1

**SECONDARY**

25. **[T1]** University of Warwick Library — *LSEG Workspace* guide, Business & Economics Databases — https://warwick.libguides.com/buseco/workspace — **tier 9** (university library guide), fetched 2026-09-02. **reported.** Source of the toolbar anatomy, the Screener walkthrough, and the academic-entitlement limits (90-day intraday, 150 AMR pages/day, 10M Datastream points/month, 7-day licence assignment).
26. **[T2]** Public-web pricing cluster — Vendr, Hudson Labs, investables.ai, PageCrawl.io, Amafi.ai, nownews.dev (Google SERP, 2026-09-02). **EXCLUDED TIER** (SEO / vendor-comparison / AI-generated). Recorded as a **lead only**: figures cluster at ~$10k–$25k per user per year, most often ~$22k. Not used as evidence anywhere above.
27. **[T3]** AlphaSpread investor-KPI listing reproducing LSEG results-pack metrics (*"Messaging monthly active users 40,000"*, *"Open Directory customers onboarded: over 20"*) — https://www.alphaspread.com/security/lse/investor-relations — **tier 12** (aggregator). **reported, unverified against LSEG's own investor materials.** Not relied on above.
28. **[T4]** rfp.wiki comparison pages (Eikon→Workspace migration described as *"rocky"*, *"power-user shortcuts"* lost, *"dense and slow at times"*) — **EXCLUDED TIER** (AI-generated comparison network). Recorded in Section J as a **lead to verify**, explicitly not as evidence.
29. **[T5]** SourceForge / Slashdot software-directory listings reproducing LSEG Messenger marketing copy (*"over 30,000 firms spanning more than 180 countries"*, *"offered at no cost with Eikon"*) — **tier 13**, and **stale** (references the retired Eikon). Not relied on above.
30. **[T6]** LSEG Learning Centre — https://www.lseg.com/en/training/learning-centre — tier 3. Fetched; catalogue is behind sign-in, so it yielded nothing beyond confirming that Workspace certification exists.
