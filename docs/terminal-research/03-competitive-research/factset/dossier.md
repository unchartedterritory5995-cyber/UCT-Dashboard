---
id: B-FDS-01
title: FactSet — benchmark product dossier (Wave 1b draft)
role: Benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: FactSet (FactSet Workstation, FactSet Intelligence / Mercury, StreetAccount, Portfolio Analytics, Excel/Office integration)
confidence: 🟡 overall (🟢 on published capability + AI stack + corporate scale; 🔴 on in-product navigation, density, and per-seat price)
evidence_ceiling: The FactSet Workstation is entirely behind a paid login; every interactive product tour on factset.com is form-gated; the developer portal and support/Online Assistant blocked unauthenticated fetches; and FactSet publishes NO list price. Sections C (navigation), H (search/commands), G (customization), J (UX) and K (performance) are reconstructed from official marketing copy plus two university library guides, not from the product. A screenshot walkthrough, an academic seat (Yale/uOttawa-style ID), or one practitioner interview would raise C/G/H/J/K from 🔴/🟡 to 🟢.
sources: 14 primary; 4 secondary
uct_relevance: medium
status: draft
date: 2026-09-02
---

> **Reading note for synthesis.** Everything below was gathered on 2026-09-02 from public sources only. FactSet is an ENTERPRISE product with no self-serve tier and no public price, so the evidence profile is inverted from a prosumer benchmark: what FactSet *sells* is very well documented, what it *feels like to use* is almost entirely undocumented in public. Where that bites, the section says so rather than inventing a workflow. Benchmarks are sources of learning, not specifications: nothing here is a requirement for TERMINAL-NEXT.
>
> **Naming correction for the program.** The dispatch names "the FactSet Mercury AI assistant". As of 2026-09-02 FactSet's public umbrella brand is **FactSet Intelligence** — a three-layer stack — and **Mercury** now appears as the *engine underneath* named features (Portfolio Assistant in PM Hub, Transcript Assistant, the Conversational API), not as the headline consumer-facing brand. Use "FactSet Intelligence (Mercury-powered)" in downstream documents.

---

## A — Executive summary

**OBSERVATION.** FactSet is a ~$2.3B-revenue (FY2025) enterprise financial data-and-analytics business whose flagship surface, the **FactSet Workstation**, is marketed as an "All-In-One Financial Data & Analytics Platform" that "connects 800+ data sources — including our proprietary data, your in-house content, and leading third-party data — in a single, unified view". It claims **200K+ Workstation users** and, at the corporate level, **~240K global users** and **95+% ASV retention** for fiscal 2025. Its 2026 positioning is AI-first: **FactSet Intelligence**, "a modular, high-performance AI stack purpose-built for financial professionals", layered as **Data Layer → Agent Platform → Intelligent Workflows**.

**Apparent PHILOSOPHY (one sentence).** *Be the trusted, entitlement-enforced, audit-ready substrate under the customer's existing workflow — Excel, PowerPoint, the CRM, and now the customer's own LLM — rather than a destination screen the analyst is supposed to live inside.* Every FactSet page returns to the same three words: **connected, governed, auditable**; the product's centre of gravity is the *link back to source*, not the chart.

**EVIDENCE.** [S1] factset.com Workstation product page (Tier: official product page; fetched 2026-09-02; **verified**). [S2] factset.com/ai (Tier: official product page; 2026-09-02; **verified**). [S13] investor.factset.com (Tier: official investor page; 2026-09-02; **verified** — "$2.3B ANNUAL REVENUE · 95+% ASV RETENTION · ~240K GLOBAL USERS · *Fiscal 2025 highlights as of August 31, 2025*").

**INTERPRETATION.** FactSet has deliberately chosen *substrate* over *destination*. Bloomberg's moat is the screen and the chat; FactSet's stated moat is symbology, entitlements and provenance — "permanent entity and security identifiers", and "each individual human's specific research, watchlists, portfolios, analytics, and third-party data access entitlements … are stored at and enforced by FactSet" [S3]. That is a different bet, and it is the bet that survives the arrival of general-purpose LLMs: if the answer is going to be generated in ChatGPT or Claude anyway, own the *governed pipe* into it. FactSet's AI page lists ChatGPT, Claude, Cursor, Databricks, GitHub Copilot, Google Gemini, Microsoft Copilot Studio and Perplexity as destinations it feeds [S2].

**RELEVANCE TO UCT.** UCT's desk is the mirror image: it *is* the destination screen, and its differentiation is proprietary intelligence (the wire, the brain KB, UCT20, exposure rating) rather than licensed breadth. FactSet is therefore useful to TERMINAL-NEXT mostly as a **discipline benchmark on provenance**, not as a feature list.

**CONFIDENCE.** 🟢 (official primary sources, dated, quoted). Ceiling: none for this section.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT treats "every generated sentence carries an in-context link to the artifact that produced it" as a platform invariant rather than a per-feature nicety, *then* the desk's trust in AI surfaces rises faster than adding new AI surfaces would raise it. FactSet says it this way: "Regardless of source, all responses have full in-context source linking for verification and identification of the data lineage" [S3]. UCT already has this instinct (the COT narrative grounding gate; a facts module as the only numbers an LLM may cite) — FactSet's evidence is that a large enterprise made it a *policy layer*, not a feature.

**OPEN QUESTION.** Does FactSet's source-linking hold for *derived* numbers (an attribution figure, a screened universe) or only for retrieved documents? Public copy does not distinguish.

---

## B — User types / personas served

**OBSERVATION.** FactSet's own list, verbatim from the Workstation FAQ: "wealth managers, asset owners, asset managers, banks, corporations, hedge funds, insurers, private equity managers, consultants, government agencies, legal professionals, and more, scaling from individual users to firm-wide deployments" [S1]. Workflow-level personas are enumerated separately as seven **Workflow Solutions** tabs: *Banker Efficiency · Data & Integration · Investment Research · Portfolio Analytics · Portfolio Management & Trading · Quantitative Research · Wealth Management* [S1]. AI for Wealth adds a role breakdown: *Financial Advisors · Operations Teams · Investment Teams · End Clients* [S10]. Academic access is a real, distinct persona: Yale grants undergraduates and Master's students **web access only**, while faculty and Ph.D. students get "the FactSet Workstation client with the Excel Add-In" [S15].

**EVIDENCE.** [S1] official product page, **verified**. [S10] official product page, **verified**. [S15] Yale Library research guide (Tier: university library guide / credible professional tutorial; fetched 2026-09-02; **reported**, since it describes Yale's licence not FactSet's general terms).

**INTERPRETATION.** There is no retail persona and no individual-trader persona anywhere in FactSet's public taxonomy. The nearest analogue to UCT's owner-operator is the **hedge fund** tour and the **Investment Research** workflow — and even there the framing is team-and-compliance ("Keep a compliant record of your research and team interactions to stay transparent for regulators and investors" [S1]). The *only* single-user framing FactSet offers is the academic one, and it is deliberately a lesser tier (web, no Excel add-in for undergrads).

**RELEVANCE TO UCT.** TERMINAL-NEXT's primary persona (a small internal desk trading US equities and options, then members) is *not* a persona FactSet serves. Where FactSet's persona work is transferable is the **tiering shape**: web-lite for the many, full client + Excel for the few. UCT already runs a free/paid split; FactSet's version keys the split on *integration depth* rather than on data.

**CONFIDENCE.** 🟢 for the enumerated personas; 🟡 for the inference that no retail persona exists (absence-of-evidence on a marketing site is weak, but the pricing page's "Contact us to discuss the cost of FactSet with our Sales Team" [S4] corroborates it).

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT ever tiers surfaces, splitting on **integration depth** (does this tier get the Excel/API/export path?) may be more defensible than splitting on **data access**, because it degrades gracefully and does not make the cheaper tier feel lied to.

**OPEN QUESTION.** What fraction of FactSet's ~240K users are Workstation seats versus API/feed/widget consumers? 200K+ vs ~240K implies most are seats, but the two numbers come from different pages and may count differently.

---

## C — Navigation: how users move

**OBSERVATION — PARTIALLY NOT DETERMINED.** FactSet publishes essentially nothing about in-product navigation. What is publicly established:

- Two distinct surfaces: a **web platform** at `my.factset.com` / `login.factset.com`, and an installed **Workstation client** [S15][S16].
- The Workstation desktop has a **Learning tab "located in the upper-left corner of the FactSet desktop"** and an **Online Assistant reached via a "? icon on the upper-right corner of the FactSet desktop"** [S15].
- Excel is reached, in the current Microsoft 365 build, by "opening Excel, clicking the Add-ins section, and selecting **FactSet 365**" [S16].
- Marketing describes the environment as "an open, flexible environment", with "Sophisticated alerting, charting, and screening tools" [S1] — no statement about tabs, workspaces, command lines, or keyboard-driven navigation.

**EVIDENCE.** [S15] Yale Library guide (university library guide; 2026-09-02; **reported**). [S16] uOttawa Financial Research Lab guide (same tier; 2026-09-02; **reported**). [S1] official page (**claimed** — marketing adjectives, not navigation facts). Attempts that FAILED and define the ceiling: `factset.com/tour/ai-enabled-document-search` renders only "Fill out the form to try FactSet's AI-Enabled Document Search for free" — the tour itself is behind a lead form [S12]; `developer.factset.com` returned 404/empty body to unauthenticated fetch; `support.factset.com` and the Online Assistant require a client login.

**INTERPRETATION.** FactSet is *not* a mnemonic-command terminal in the Bloomberg sense in its public presentation — there is no equivalent of Bloomberg's published `<GO>` grammar anywhere on factset.com. The published navigation primitives are a **menu/desktop chrome** (Learning tab, "?" assistant) plus, increasingly, **natural language as the navigation layer**: Pitch Creator's "Company Research" step says "Conduct company research all within FactSet's central global assistant by simply asking questions" and "Leverage natural language to screen for companies based on criteria … eliminating the need to manually enter screening categories or criteria" [S8]. That is a strong signal that FactSet's own answer to "how do users move" in 2026 is *ask, don't navigate*.

**RELEVANCE TO UCT.** The TERMINAL-NEXT navigation question (command palette vs menus vs search) cannot be settled from FactSet. What FactSet *does* contribute is the observation that a mature enterprise vendor is publicly repositioning natural-language query as a **replacement for form-filling a screener**, not merely as a chat sidebar.

**CONFIDENCE.** 🔴. Ceiling: the Workstation UI is login-only and every demo is form-gated; I did not fill forms, log in, or sign up. Raised by: an owner-supplied screen recording, an academic ID (Yale-style, ~7–10 business days per [S15]), or a practitioner walkthrough.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT builds a natural-language entry point, the FactSet framing suggests it should **produce a saved, editable artifact** (a screen, a chart, a list) rather than only prose — Pitch Creator's screening claim is explicitly "get auditable results", i.e. the NL step outputs a re-runnable object.

**OPEN QUESTION.** Does the FactSet Workstation have a keyboard-first command surface at all, and is there any published shortcut grammar? (Not found in any public source.)

---

## D — Capability map (Part XIII taxonomy)

Grouped by the taxonomy; **bold** items are named by FactSet itself.

| Taxonomy area | FactSet capability (public evidence) | Source | Grade |
|---|---|---|---|
| **Market overview** | Real-time market data across "global markets, industries, and public and private companies across multiple asset classes"; **StreetAccount** market synopsis (live headlines such as "Bearish spin to start September", "Global bond yield backup" rendered on the product page) | [S1][S7] | verified |
| **Security pages** | Company research via "central global assistant"; fundamentals, estimates, ownership, transactions, pricing named as report families | [S8] | verified |
| **Fundamentals** | 800+ data sources; **1,100+ datasets** for quant/backtesting; academic guide cites "financial data on 70,000+ companies, historical metrics for 70+ countries, 5,000 global indices plus fixed income and commodities" | [S1][S15] | verified / reported |
| **News** | **StreetAccount** — proprietary curated news across US, Canada, Europe, APAC; written by "former analysts, portfolio managers, traders, and economists"; delivered via Workstation, **StreetAccount web, email, iOS application, or API**; sources scanned include "press releases, SEC filings, government and regulatory websites, U.S. Appeals Court rulings, prominent newspapers, sell-side research notes, business networks, various X (Twitter) accounts, and industry publications" | [S7] | verified |
| **Earnings** | Earnings Previews, **Conference Call Guidance**, **Street Takeaways** ("brokers' reactions to major corporate events"); calendars with "conference call dates, times, and dial-in information"; consensus vs actual EPS/Sales; **Transcript Intelligence via StreetAccount** = "full, LLM-generated earnings transcript summaries, including Guidance, Q&A, and Key Themes" reviewed by human experts; **Transcript Assistant** two-way chat over transcripts | [S7][S2] | verified |
| **Economic** | Not separately productised in public copy; "economic releases" named as an event class in Investment Research | [S5] | claimed |
| **Screening** | "advanced screening to test ideas across equities, M&A, PE/VC"; "**Screen 10M+ private companies** for M&A targets"; **Universal Screening** with a saved-screen library exposed via a **Universal Screening API**; **Screening for Dealmakers** | [S1][S14] | verified |
| **Charting** | "Sophisticated alerting, charting, and screening tools"; **Chart Creator** inside Pitch Creator; live-linked Excel/PowerPoint charts "that update automatically" | [S1][S8] | verified (existence) / 🔴 (capability depth) |
| **Alerts** | "custom alerts, advanced filters"; StreetAccount "highly filterable news alerts, sent straight to your inbox"; AI for Wealth "real-time alerts on portfolio drift, performance trends … progress toward goals" | [S1][S7][S10] | verified |
| **Portfolio / watchlist** | **Portfolio Analytics**: performance, risk, exposure, attribution; **10+ attribution models** incl. Fixed Income Attribution and Investment Process Attribution; scenario analysis and stress testing; **four optimizers and 120+ risk models** (quant); **PM Hub** for real-time composition/performance/risk | [S6][S1][S2] | verified |
| **Documents** | **AI-Enabled Document Search** — "simplifies filings, news, and transcripts into auditable insights"; **Internal Research Notes (IRN)** as the research-of-record store | [S12][S5] | verified (existence) |
| **Collaboration** | IRN: "Establish seamless communication and collaboration across your firm"; "Keep a compliant record of your research and team interactions to stay transparent for regulators and investors" | [S5][S1] | verified |
| **AI** | See Section I — **FactSet Intelligence** (Data Layer / Agent Platform / Intelligent Workflows), Mercury, Agent Hub, MCP servers, Conversational API, Pitch Creator, Portfolio Commentary, Draft/Topic Assistant, Theme Intelligence, Signals API | [S2][S3] | verified |
| **Command / keyboard** | NOT DETERMINED — no public evidence of a command grammar or shortcut set | — | 🔴 |
| **Workspaces** | NOT DETERMINED beyond "open, flexible environment" and per-firm configurability ("deeply configurable tools") | [S1][S5] | 🔴 |

**INTERPRETATION.** The map has a distinctive shape: **extremely deep on portfolio/attribution/screening/documents, deliberately shallow in public on charting and on the terminal chrome**. FactSet does not compete on the chart. It competes on *the number that survives an audit* — the Portfolio Analytics MCP page is explicit: "results … validated by FactSet — so your AI works from numbers that hold up in compliance reviews, client reporting, and audits" [S2].

**RELEVANCE TO UCT.** Two areas map onto TERMINAL-NEXT directly: (1) **earnings preparation** — StreetAccount's *Earnings Preview → Conference Call Guidance → Street Takeaways* triad is a fully-worked information architecture for Workflow B, and UCT's calendar/earnings modal already has the raw parts (expected move, beat history, transcripts, call recap) without that named spine; (2) **news curation as a product, not a feed** — StreetAccount's whole pitch is subtraction ("only the most material and market-moving content is distilled and delivered"), which is the same claim UCT's catalyst engine and morning wire make.

**CONFIDENCE.** 🟢 for existence and naming; 🟡 for depth (marketing bullets, not documentation); 🔴 for charting depth, workspaces, and keyboard.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT names its earnings surface's sections after the *decision* rather than the *data* — a "what changed in guidance" block and a "what the street said back" block, in StreetAccount's shape — *then* the earnings modal reads as a brief rather than a dashboard, at no data cost, because UCT already fetches the underlying transcript and estimate-revision material.

**OPEN QUESTION.** Is AI-Enabled Document Search a distinct application or a mode of the global assistant? The tour page treats it as a product; the AI page does not list it among Intelligent Workflows.

---

## E — Workflows (Part XIV A–G), brief

Wave 2 reconstructs five of these in depth; this is a first pass with explicit unknowns.

- **A — "Why is this stock moving?"** Publicly evidenced path: StreetAccount real-time curated headline + Street Takeaways + **Security Explanation** in PM Hub, which "quickly summarizes transcripts and news to identify key factors driving security performance in the market" [S2][S7]. *Missing in public evidence:* any intraday microstructure, flow, or dealer-positioning layer — FactSet's answer to "why" is narrative-and-fundamental, not tape-based. 🟡
- **B — "Prepare me for earnings."** The best-evidenced workflow FactSet has. Calendar (dates, times, dial-ins) → Earnings Preview → consensus vs actual EPS/Sales → **Transcript Intelligence** LLM summary (Guidance / Q&A / Key Themes, expert-reviewed) → **Transcript Assistant** two-way chat → export to other FactSet apps or external tools [S7][S2]. 🟢 on the published spine; 🔴 on screens.
- **C — "Research this company from scratch."** Pitch Creator's **Company Research** step is the public articulation: ask in natural language; "All queries have links auditing back to source material, so you can easily identify how the response was generated"; then fundamental research "across pricing, financials, estimates, ownership, transactions, and more" [S8]. Documents leg via AI-Enabled Document Search [S12]; notes leg via IRN + Draft Assistant [S2][S5]. 🟡
- **D — "What matters today."** StreetAccount is the whole answer: curated, filterable, bulleted, pushed to inbox/mobile [S7]. Notably FactSet ships **no** "your daily brief" AI artifact in public copy — the human desk of former analysts *is* the brief. 🟡
- **E — "Find a trade."** Screening is idea-generation for *deals and mandates* more than for trades: "test ideas across equities, M&A, PE/VC", "Screen 10M+ private companies for M&A targets and origination opportunities" [S1]. Quant path: 1,100+ datasets, backtesting, "four optimizers and 120+ risk models" [S1]. **Signals API** offers "predictions on companies and stock prices" [S5]. *Missing:* any entry/stop/target or execution-timing concept in public material. 🟡
- **F — "Monitor my universe."** Alerts + watchlists + portfolio-drift alerts (AI for Wealth) + "custom news alerts and filter company information by portfolio, index, keyword" [S5][S10]. Entitlement copy confirms per-user watchlists are first-class objects: "each individual human's specific research, watchlists, portfolios, analytics … entitlements" [S3]. 🟡
- **G — "Understand the regime."** WEAKEST publicly. Nothing in FactSet's public material corresponds to a market-regime read. The nearest artifacts are Portfolio Analytics **scenario analysis and stress testing** [S6] and macro/sector commentary on FactSet Insight [S18]. FactSet appears to treat regime as an input the *client* brings. 🔴

**RELEVANCE TO UCT.** The asymmetry is the finding: FactSet is strongest exactly where UCT is thinnest (B, C, F at institutional depth) and effectively absent where UCT's proprietary intelligence lives (A intraday, E as an actual trade, G as a stated regime). That is a *complementarity* map, not a gap list.

**CONFIDENCE.** 🟡 overall. Ceiling: no screens, no demo access — the step sequences above are assembled from product copy and could be wrong about ordering and about what lives on one screen versus several.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's Workflow G (regime) is treated as a first-class, named, always-visible object, it is a genuine differentiator versus the enterprise incumbents — FactSet, the largest of the mid-tier, publishes nothing that answers it.

**OPEN QUESTION.** Does FactSet ship any daily generated brief to individual users (the equivalent of the morning wire), or is StreetAccount's human desk the entire answer?

---

## F — Data

**OBSERVATION.** Coverage claims, all FactSet's own: **800+ data sources** unified in the Workstation; **1,100+ datasets** available programmatically for quant work; **"100+ third-party and 40+ proprietary datasets"** (pricing page's framing) [S1][S4]. Content types: "public and private data across company, security, real-time market, alternative, and event-driven data and multiple asset classes"; private markets "including millions of private companies across PE, VC, and private credit"; screening reaches **10M+ private companies** [S1]. Symbology is presented as a core asset: "permanent entity and security identifiers" and "connecting all your different data sources to a single master identifier" [S1]. Delivery: "major cloud providers, FactSet-hosted environments, comprehensive data feeds, APIs, web components", with named ecosystem integrations to **Snowflake** and **Databricks** [S11][S6]. API families exposed over MCP: "Fundamentals, Estimates, Ownership, M&A, Pricing (FGP), People, Events, and Supply Chain" [S2]. Academic guide reports "70,000+ companies, historical metrics for 70+ countries, 5,000 global indices plus fixed income and commodities markets" [S15].

**Real-time vs delayed:** FactSet's governance page confirms real-time exchange data is an **entitlement**, enforced per human: "third-party entitlements … (real-time exchange, news, brokers, ratings, indices) are stored at and enforced by FactSet" [S3]. StreetAccount is described as real-time [S7]. **NOT DETERMINED:** which exchanges, at what latency, and how professional/non-professional status is handled — no public page addresses this.

**History depth: NOT DETERMINED.** No public FactSet page states history depth in years for any dataset. Only proxy: acquisitions of CUSIP Global Services (announced 2021-12-27, $1.925B) and Truvalue Labs (2020) signal identifier and alt-data depth [S17].

**EVIDENCE.** [S1][S2][S3][S4][S6][S11] official pages, **verified/claimed**; [S15] library guide, **reported**; [S17] Wikipedia, **reported** (names/dates only, per preamble).

**INTERPRETATION.** FactSet's data story is *joinability*, not volume. The repeated emphasis on a single master identifier and on permanent entity IDs is the actual product; "800+ sources" is the marketing surface over it.

**RELEVANCE TO UCT.** UCT's ticker-resolution and symbology pain is real and recurring in its own history (dual-class symbol mapping applied at one boundary only; the lesson that RS/EMA/MA/GAP/PEG are also real tickers). FactSet's answer — one permanent identifier owned centrally, everything else joined to it — is the industrial version of that lesson.

**CONFIDENCE.** 🟢 on stated coverage; 🔴 on history depth, latency, and professional/non-professional handling. Ceiling: FactSet publishes coverage as marketing counts, never as a data dictionary; the data dictionary ("Data Navigator") is client-only [S7].

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT establishes ONE internal permanent security identifier and requires every new source to join to it at ingest (rather than at read), *then* the class of defect UCT keeps rediscovering — two authorities over one value — becomes structurally harder to create. This is a hypothesis about architecture, not a request to build a symbology product.

**OPEN QUESTION.** What is FactSet's real-time market-data latency and exchange coverage, and does it distinguish professional from non-professional users at all (it may simply not sell to non-professionals)?

---

## G — Customization

**OBSERVATION — LARGELY NOT DETERMINED.** Public evidence establishes only that customization exists and is firm-level as much as user-level:

- "Your workflow is unique, so your platform should follow… an open, flexible environment" [S1].
- "Choose from pre-built reports or create custom views to fit your firm's needs" (Portfolio Analytics) [S6].
- "we will configure our tools around your existing workflow… deeply configurable tools" (IRN / Investment Research) [S5][S1].
- Wealth: "Deploy firm-approved model portfolios across advisors from research to delivery" and "a customizable digital portal" (Advisor Dashboard) [S1][S10].
- Templates are a named artifact in the banking workflow: Pitch Creator's **Template Assistant** and **Reslide** [S8].
- Excel/PowerPoint: "Build live-linked Excel and PowerPoint models and charts that update automatically" [S1]; the add-in ships as **FactSet 365** inside Microsoft 365 [S16].

**NOT DETERMINED:** layout persistence, tab/window model, multi-monitor behaviour, column-level table customization, per-user watchlist mechanics beyond their existence as entitled objects.

**EVIDENCE.** [S1][S5][S6][S8][S10] official, **claimed**; [S16] library guide, **reported**.

**INTERPRETATION.** FactSet's customization story is **institutional templating** (the firm configures once, advisors/analysts inherit) far more than **personal workspace building**. "Extend the reach of home office and CIO teams by embedding proprietary research, firm priorities, and investment guidance directly into advisor workflows" [S10] is the clearest statement of that model.

**RELEVANCE TO UCT.** This is a genuinely transferable idea for the members side of TERMINAL-NEXT: the firm (UCT) authors a canonical layout/model and members inherit it, rather than each member assembling a workspace from an empty grid. UCT's Charts workspace today is the opposite (empty grid + widgets); a "firm-approved starting workspace" is closer to FactSet's shape and to UCT's own starter-library idiom for scans.

**CONFIDENCE.** 🔴 on mechanics, 🟡 on the institutional-templating model. Ceiling: same login wall; a screenshot walkthrough would resolve it.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT ships **firm-authored default workspaces that arrive editable** (the idiom UCT already uses for starter scans, where the firm's setups ship as ordinary definitions editable on arrival), *then* the empty-grid cold start disappears without creating a second, read-only class of object to maintain.

**OPEN QUESTION.** Does FactSet persist layouts per user across the web and desktop surfaces, or are they separate worlds?

---

## H — Search / commands

**OBSERVATION.** FactSet's public search story in 2026 is **natural-language-first**, not command-first:

- "Get actionable answers faster with custom alerts, advanced filters, and **AI-powered Q&A**" [S1].
- "With our adaptive AI-powered conversational assistant, intelligent Q&A will help drive your earnings season" [S5].
- Pitch Creator: "Conduct company research all within FactSet's **central global assistant** by simply asking questions"; "**Search Intelligence**" is a named module; NL screening "eliminat[es] the need to manually enter screening categories or criteria" [S8].
- MCP framing: a "standardized framework that turns user prompts into precise API calls" [S2].
- Ticker resolution: **NOT DETERMINED**. No public source describes how FactSet disambiguates an ambiguous symbol.
- Command palette / shortcut grammar: **NOT DETERMINED** — nothing published.

**EVIDENCE.** [S1][S2][S5][S8] official, **verified** as claims about shipped features (Pitch Creator and the Conversational API have dated catalogue entries — the Conversational API page carries "**Added November 15, 2024**" [S9]).

**INTERPRETATION.** "Turns user prompts into precise API calls" is the load-bearing sentence. FactSet is not describing a chatbot over documents; it is describing **NL as a compiler to a typed query**. That is materially different from RAG-over-text and it is what makes the output auditable — you can show the call that produced the number.

**RELEVANCE TO UCT.** This is the strongest single transferable idea in the dossier for UCT's AI Search / Concierge work. UCT already has the shape in one place (a concierge box turning English into a SCAN definition, which is then an ordinary editable object). FactSet's evidence is that an enterprise vendor bet its AI positioning on exactly that pattern rather than on free-text answers.

**CONFIDENCE.** 🟡 (claims are official and dated, but no demonstration was accessible). Ceiling: the tours are form-gated; I did not fill the form.

**RECOMMENDATION (hypothesis).** *If* every NL request in TERMINAL-NEXT compiles to a **named, inspectable, re-runnable object** (a scan definition, a chart config, a screen) rather than to prose, *then* the AI surface becomes auditable by construction and the "hallucinated number" failure mode largely disappears — because the number is computed by the same engine the rest of the terminal uses.

**OPEN QUESTION.** When FactSet's NL screening returns "auditable results", is the compiled screen exposed to the user as an editable Universal Screen, or only as a result set with citations?

---

## I — AI: shipped vs marketing

**OBSERVATION — the most evidenced section.** FactSet's AI is branded **FactSet Intelligence** and structured in three layers [S2]:

1. **DATA LAYER** — "Unified structured and unstructured content from internal, client, and third-party sources… a single, trusted foundation of high-quality financial data."
2. **AGENT PLATFORM** — "The complete infrastructure for building and running agentic workflows with MCP-enabled data, orchestration, evaluation, and quality controls—so every workflow is grounded, governed, and scalable."
3. **INTELLIGENT WORKFLOWS** — "purpose-built experiences for specific user and firm types."

Named features, with what each does (all [S2] unless noted):

| Feature | What it does | Status signal |
|---|---|---|
| **FactSet Mercury** | The conversational engine underneath named assistants; "a single, trusted conversational interface" [S3] | Shipped; now positioned as engine, not headline brand |
| **Portfolio Assistant** (in **PM Hub**) | "powered by FactSet Mercury… ask natural language questions about your portfolio's performance, risk, or composition, and receive accurate, **auditable** answers" | Shipped |
| **Security Explanation** | "summarizes transcripts and news to identify key factors driving security performance" | Shipped |
| **Transcript Assistant** | Two-way chat over earnings transcripts; export to FactSet apps and external tools | Shipped |
| **Portfolio Commentary** | Auto-generated attribution commentary with four insight types (executive summary, subperiod analysis, market review, most-impactful securities) + "direct source-linking to verify data" | Shipped |
| **Pitch Creator** | Company Research · Search Intelligence · Chart Creator · Slide Assistant · Template Assistant · Tombstone Generator · Reslide · Office Refresh; "Text to Formula" builds Excel codes [S8] | Shipped |
| **IRN AI**: Draft Assistant / Topic Assistant / Theme Intelligence | Draft gathering with "source links attached directly to your draft"; auto-tagging; trending-theme word cloud | Shipped |
| **MCP server** + **Portfolio Analytics MCP** | FactSet content and governed analytics into external LLMs | Shipped (catalogued products) |
| **Conversational API** | "API access to a conversational experience… powered by FactSet Mercury" | **Added November 15, 2024** [S9] |
| **Agent Hub** | Named in the governance statement alongside Mercury as part of "FactSet's suite of generative and agentic AI products" [S3] | Named only — no product page found |
| **AI for Banking / AI for Wealth** | Packaged agentic workflows; Wealth is built with "TIFIN.AI's… advisor workflow technology" and cites "FactSet's **domain-specific LLM**" [S10] | Shipped |
| **Signals API** | "AI-powered… review predictions on companies and stock prices" [S5] | Shipped |

**Grounding / citation behaviour — the strongest published commitment found anywhere in this benchmark set:**

- "FactSet employs **Retrieval Augmented Generation (RAG)** methods that pair generative AI models with our own fact-based data to avoid data hallucinations." [S2]
- "Regardless of source, **all responses have full in-context source linking** for verification and identification of the data lineage." [S3]
- "Generative output is **clearly labelled** throughout the user interface with linked references to the sources to promote transparency, auditability, and explainability. **Output benchmarking**, as well as **human oversight**, will be used to monitor accuracy and reliability… and to understand and adjust for unintended bias and natural response-drift." [S3]
- Human-in-the-loop is explicit for content: StreetAccount's "LLMs, curated by experts, create AI-generated StreetAccount summaries that **are reviewed by those same experts**" [S7].
- Deployment guardrails: private LLM instances only, "FactSet does not use public LLMs via public endpoints"; zero data retention at hosting platforms; prompts/responses not used for unsupervised training; logs kept 24 months; data processed and stored in the United States unless otherwise requested; "AI Firewalls at appropriate locations within our federation pipeline"; entitlements enforced per human including for agents [S3].
- Disclaimer, verbatim and notable: "FactSet does not offer investment advice… AI responses are provided for informational purposes only and do not constitute advice, rating, projection, or opinion" [S3].

**Marketing vs shipped.** Almost everything above sits on a product page with a Try-for-Free CTA, which is a shipped-product signal but not a demonstration. Items to flag as **claimed, not demonstrated**: "agentic research workflows" as an end-to-end capability; **Agent Hub** (named once, no page); the "deploys in weeks, not months" claim for AI for Wealth [S10]; and the awards list (AI Excellence 2026, "AI-powered Financial Data Automation Tool of the Year 2026") which is marketing.

**EVIDENCE.** [S2][S3][S7][S8][S9][S10] official product/governance pages, fetched 2026-09-02; **verified** as published claims; **not demonstrated** (no accessible demo).

**INTERPRETATION.** FactSet has made **auditability the product** of its AI, not intelligence. Read [S3] as a whole and it is a compliance document dressed as marketing — and that is the point: its buyer is a risk committee. The single most reusable idea is that *labelling* and *linking* are stated as UI invariants ("clearly labelled throughout the user interface with linked references"), not per-feature options.

**RELEVANCE TO UCT.** UCT's own AI surfaces (Compass, wire, COT narrative, catalyst theses, calendar recaps) already enforce grounding in places and not in others. FactSet's evidence supports the stronger, cheaper move: make *provenance rendering* a shared component every AI surface must use, so a surface without citations is structurally impossible rather than merely discouraged.

**CONFIDENCE.** 🟢 on what FactSet publishes; 🟡 on what actually renders in-product (no demo access). Ceiling as in Section C.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT adopts one rule — **no generated sentence renders without a resolvable link to the artifact that produced it, enforced by the render component and not by the prompt** — *then* the desk's willingness to act on AI output rises, and the failure mode UCT has already met (a swallowed error rendering failure as fact; a warm pass that persists nothing reading as healthy) becomes visible instead of silent.

**ANTI-PATTERN TO NOTE.** FactSet's own copy hedges hard ("may contain inaccuracies, including those unique to generative artificial intelligence"). A terminal for a *trading desk* cannot resolve into hedging — UCT's own report-card experience (opinionated rungs failing because the model hedged, fixed by making the verdict STRUCTURAL rather than prompted) is the counter-lesson. Take FactSet's provenance; do not take its refusal posture.

**OPEN QUESTION.** Does Mercury's source-linking cover *computed* values (attribution, screens) or only retrieved documents? [S2]'s Portfolio Analytics MCP language ("results… validated by FactSet") suggests the former, but nothing states it.

---

## J — UX: strengths, weaknesses, density, onboarding

**OBSERVATION — MOSTLY NOT DETERMINED; what is evidenced:**

- **Onboarding is high-touch and slow by design.** Academic ID requests are "typically processed by FactSet within 7–10 business days" [S15]; commercial access is "Contact Us For A Personalized Proposal" [S4]. There is no self-serve path anywhere.
- **Learning is a first-class in-product surface**: a "Learning tab" in the desktop chrome, "FactSet Learning Modules, featuring eLearning courses that can help you learn FactSet at your own pace", a 24/7 help desk (1-877-FACTSET), and an Online Assistant behind "?" [S15]. A vendor that ships a *tab* for learning is telling you the product is not self-evident.
- **Service is the stated differentiator**, quoted by FactSet from a client: "nothing was even close to the capability of the FactSet software—**and its service was unmatched**" [S1].
- **Density / information architecture: NOT DETERMINED.** No screenshots accessible.
- **Learning curve:** secondary sources consistently describe a steep one, but the pages that say so are SEO comparison/aggregator content, which the evidence standard excludes as evidence. Recorded as **unverified secondary sentiment, not a finding**; the specific pages seen are named in GAPS so a later reader knows they were rejected rather than missed.

**EVIDENCE.** [S15] library guide, **reported**; [S1][S4] official, **claimed**. Failed: G2 reviews returned HTTP 403; Reddit was not reachable under this session's browser permissions.

**INTERPRETATION.** The onboarding shape (weeks to access, a training curriculum inside the product, a 24/7 human desk) is itself the UX statement: FactSet optimises for a *trained* user with an account manager, not for a user who arrives alone. That is a legitimate design position and it is the opposite of what a two-person trading desk needs.

**RELEVANCE TO UCT.** TERMINAL-NEXT's users arrive alone. The transferable piece is *not* the learning curriculum — it is the observation that **a product needing a Learning tab has already lost the discoverability argument**. UCT's own history has the same tell (a first-run hint gated by one storage flag; a read-only Settings list enumerating six ways to reach the same assistant — six doors is a discoverability problem stated as a feature).

**CONFIDENCE.** 🔴 for in-product UX; 🟡 for onboarding shape (the library guide is credible for the academic path only). Ceiling: no screenshots, no demo, no accessible review corpus.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT counts its **doors per capability** and drives that number toward one, *then* the need for an in-product learning surface falls — and the count is measurable today, unlike "is it intuitive".

**OPEN QUESTION.** What does a FactSet Workstation screen actually look like at 1080p — how many panes, how dense, how much chrome? Unanswerable from public sources.

---

## K — Performance and density claims (all labelled reported/claimed)

**OBSERVATION.** FactSet publishes **no** latency, load-time, or throughput figures. What exists is time-to-outcome marketing:

- "Create a high-quality pitchbook **in the time it takes to read one**" [S8].
- "Create polished proposals **in as little as three minutes**" (FactSet Proposal Generation) [S10].
- "Deliver client-ready summaries and action items **in minutes, not hours**" [S10].
- "**deploys in weeks, not months**" [S10].
- "turning prompts into working code and **cutting integration time from weeks to minutes**" (Claude Code + MCP demo blurb) [S2].
- Scale-side: "200K+ users" [S1]; "~240K global users", "95+% ASV retention" [S13].

**EVIDENCE.** [S1][S2][S8][S10][S13] official pages; all **claimed** except the FY2025 scale figures, which are **verified** investor-relations disclosures.

**INTERPRETATION.** Every performance claim FactSet makes is about **human minutes saved**, never about **milliseconds rendered**. For an enterprise research platform that is the honest metric; for a trading terminal it is not.

**RELEVANCE TO UCT.** TERMINAL-NEXT's performance bar is set by UCT's own tape and chart surfaces, not by FactSet. But the framing is worth borrowing for the *research* half of the terminal: the earnings/brief/scan surfaces should be measured in "minutes to a decision", and that number should be measured, not asserted (UCT has the scar: a measured delta is not a measured cost; an acceptance number is a forecast until derived).

**CONFIDENCE.** 🟡 (the claims are accurately transcribed; their truth is untested). Ceiling: no independent benchmark of FactSet exists publicly.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT declares a per-surface time-to-answer target and instruments it, *then* "is the terminal fast" becomes falsifiable; adopting FactSet's *minutes-saved* vocabulary without instrumentation would just import their marketing.

**OPEN QUESTION.** Does the Workstation render locally (installed client) or stream? The existence of a separate installed client alongside a web app implies a real architectural difference in responsiveness that nothing public describes.

---

## L — Pricing / business model

**OBSERVATION.** FactSet publishes **no price at any tier**. The pricing page is a contact form: "Flexible Tools, Tailored Pricing… **Contact us to discuss the cost of FactSet with our Sales Team.** / Contact Us For A Personalized Proposal" [S4]. Every product page terminates in "TRY FOR FREE" (a lead form) or "Connect With Us For A Free Trial" [S1][S7][S8][S10].

**What can be established with dated primary numbers** [S13], fiscal 2025 highlights as of 2025-08-31:

- Annual revenue **$2.3B**
- ASV retention **95+%**
- Global users **~240K**
- "45+ Years" of revenue growth

**DERIVED (label as derived, not a price):** $2.3B ÷ ~240K users ≈ **~$9,600 of annual revenue per user**. This is a *blended* figure — it includes data feeds, APIs, CUSIP licensing and managed services that are not seats — so it is a shape-of-magnitude proxy for a Workstation seat and must never be quoted as a seat price.

**Business-model shape (evidenced):**

- **Per-firm, negotiated, ASV-based** (Annual Subscription Value is FactSet's own headline metric [S13]) — not per-seat list pricing.
- **Enterprise deployment options** including single-tenant VPC: "Deploy securely in your firm's single-tenant VPC with human oversight on every output" [S2].
- **Data add-ons are the growth vector**: "100+ third-party and 40+ proprietary datasets" [S4]; an **AI Partner Program** licenses FactSet data to third-party AI products [S2].
- **Third-party entitlements are metered per human** (real-time exchange, news, brokers, ratings, indices) [S3] — the structural place where "data add-ons" live.
- **Professional / non-professional distinction: NOT DETERMINED.** FactSet appears not to sell to non-professionals at all; the only non-professional channel found is academic, granted to universities with a 7–10 business-day ID process and a non-commercial-use restriction [S15][S16].

**Corporate context (secondary, names/dates only):** founded September 1978 (Howard Wille, Chuck Snyder), Norwalk CT; NYSE:FDS since 1996; S&P 500 since 2021-12-20; FY2025 revenue $2.32B, operating income $748M; ~12,800 employees (2025); acquisitions include Truvalue Labs (2020), Cobalt Software (2021-10), CUSIP Global Services (announced 2021-12-27, $1.925B), LiquidityBook (2025-02, $246.5M), LogoIntern/TableTop Data (2025-03); CEO Sanoke Viswanathan, CFO Helen Shan [S17].

**EVIDENCE.** [S4][S13] official, **verified**; [S2][S3] official, **verified** as claims; [S17] Wikipedia (Tier: general web — used only for names/dates as the preamble permits), **reported**.

**INTERPRETATION.** The absence of a price is itself the business model: negotiated ASV per firm, expanded by entitlements and datasets, defended by 95+% retention. There is no acquisition funnel a single trader can enter.

**RELEVANCE TO UCT.** No pricing lesson transfers directly — UCT sells to individuals at published prices. The one structural observation worth carrying: FactSet's *retention* number is the headline metric, not ARPU or growth. For a members product, "what fraction renewed" is a more honest health metric than "how many signed up".

**CONFIDENCE.** 🟢 on "there is no public price" and on the FY2025 figures; 🔴 on any actual seat cost. Ceiling: FactSet does not disclose seat pricing; only a client contract, an RFP response, or a public-sector procurement record would. The owner could plausibly obtain a quote via the contact form — which I did not submit and would not without instruction.

**RECOMMENDATION (hypothesis).** *If* the program needs a price anchor for the enterprise tier of the benchmark map, use FactSet's **ASV-per-user derived figure with its caveat** rather than any comparison-site number; the comparison sites in this space are affiliate-driven and the evidence standard excludes them.

**OPEN QUESTION.** What does one FactSet Workstation seat actually cost in 2026, and how much of that is base versus real-time exchange entitlements?

---

## M — Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **Provenance as a render-layer invariant, not a per-feature choice.** *Hypothesis:* if every AI-generated sentence in TERMINAL-NEXT must pass through one component that requires a resolvable source link, the "plausible number rendered as fact" class disappears. **Serves:** every AI surface; most acutely Workflow B (earnings brief) and D (what matters today). **FactSet evidence:** "all responses have full in-context source linking" and "Generative output is clearly labelled throughout the user interface with linked references" [S3]. 🟢 evidence / 🟡 transferability.
2. **NL compiles to an object, not to prose.** *Hypothesis:* if natural-language requests produce a named, editable, re-runnable artifact (scan, chart, screen), the AI becomes auditable by construction and reuses the engine the rest of the terminal trusts. **Serves:** Workflow E (find a trade), C (research from scratch). **Evidence:** "turns user prompts into precise API calls" [S2]; NL screening "get auditable results in seconds" [S8]. 🟡.
3. **The StreetAccount triad for earnings: Preview → Guidance → Street Takeaways.** *Hypothesis:* naming the earnings surface's blocks after the decision (what was expected / what changed in guidance / how the street reacted) rather than after the data source makes it read as a brief. **Serves:** Workflow B. **Evidence:** [S7]. UCT already fetches all three inputs. 🟢 evidence / 🟢 transferability.
4. **Human review as a published product property.** *Hypothesis:* stating "expert-reviewed" where it is true, and *not* stating it where it is not, is worth more to a paying desk than a broader AI claim. **Evidence:** StreetAccount's LLM summaries are "reviewed by those same experts" [S7]. **Serves:** the morning wire's auto-send question — this is a third option between "owner edits every draft" and "unedited auto-send": *published as machine-generated, with a named review status*. 🟡.
5. **Firm-authored defaults that arrive editable.** *Hypothesis:* shipping a curated default workspace/model that a member can immediately modify beats an empty grid, and beats a read-only "official" class. **Evidence:** "Deploy firm-approved model portfolios across advisors from research to delivery" [S1]; "embedding proprietary research, firm priorities, and investment guidance directly into advisor workflows" [S10]. UCT's starter-scan idiom already matches. **Serves:** onboarding, Workflow F. 🟡.
6. **One permanent identifier, joined at ingest.** *Hypothesis:* a single internal security identity, with every source joined to it at ingest rather than at read, removes a recurring defect class. **Evidence:** "permanent entity and security identifiers"; "connecting all your different data sources to a single master identifier" [S1]. **Serves:** everything. 🟡 (architectural, expensive).
7. **Entitlements enforced per human, including for agents.** *Hypothesis:* if TERMINAL-NEXT ever exposes tools to an agent (voice, Compass, MCP), the agent must inherit the *user's* entitlements, not the process's. **Evidence:** "access to our system is identified at all times to a specific human, or an agent or machine working on behalf of a human" [S3]. **Serves:** the members tier and any future API. 🟢 evidence.
8. **Export as a first-class exit, not an afterthought.** *Hypothesis:* a research surface that cannot leave the terminal (to a spreadsheet, a note, a message) will be used less than one that can. **Evidence:** Transcript Assistant "Seamlessly export transcripts and data to other FactSet applications and external tools"; live-linked Excel/PowerPoint [S7][S1]. UCT's save-quote-to-note button is the same instinct, applied narrowly. **Serves:** C, B. 🟡.

---

## N — Bad ideas for UCT (avoid, and why)

1. **The lead-form wall.** Every FactSet surface — including its *product tours* — terminates in a form [S1][S8][S12]. A terminal whose demonstrations cannot be seen without contact is unevaluable; it also made this dossier's C/G/H/J/K sections 🔴. **Anti-pattern for TERMINAL-NEXT's public and member-facing surfaces.**
2. **A Learning tab as the answer to complexity.** Shipping an in-product curriculum [S15] is a legitimate enterprise choice and a bad signal for a desk tool. If a capability needs a course, the capability needs a redesign.
3. **Hedged AI output.** "AI responses are provided for informational purposes only and do not constitute advice, rating, projection, or opinion" [S3] is correct for FactSet's liability posture and fatal for a trading desk's decision loop. UCT has already learned this the expensive way (structural verdicts beat prompted decisiveness). Take the provenance; leave the hedge.
4. **Marketing counts as capability documentation.** "800+ data sources", "1,100+ datasets", "10M+ private companies", "120+ risk models" [S1] are unfalsifiable and undated. UCT's own recurring defect is exactly this shape — a hand-typed count beside the artifact it claims to describe. **Do not import counted claims into TERMINAL-NEXT docs; derive them.**
5. **Institution-first customization with no personal layer.** FactSet's configurability is largely firm-level [S5][S10]. For a two-person desk that is overhead with no payoff; personal layout state is the thing that matters.
6. **Two surfaces with different capabilities (web vs installed client).** Yale's guide shows undergrads get web while faculty get the client + Excel add-in [S15]. Whatever the licensing reason, "the web version can't do X" is a support burden and a trust cost. TERMINAL-NEXT should keep one capability surface.
7. **Splitting AI into a dozen separately-branded assistants.** Mercury, Portfolio Assistant, Transcript Assistant, Draft Assistant, Topic Assistant, Theme Intelligence, Search Intelligence, Slide Assistant, Template Assistant, Security Explanation, Signals, Agent Hub [S2][S8] — a user cannot hold that map. UCT's single Compass identity across surfaces is the better pattern and should not be fragmented.

---

## O — Screenshots / evidence links

No images are reproduced. Public evidence artifacts, all fetched 2026-09-02:

- **Product page with live product content rendered inline** (StreetAccount's page renders real headlines with timestamps — the closest thing to a public screenshot of FactSet news output): https://www.factset.com/marketplace/catalog/product/streetaccount
- **Interactive product tours (ALL FORM-GATED — listed for a future authenticated pass):**
  - AI-Enabled Document Search — https://www.factset.com/tour/ai-enabled-document-search
  - Whole Portfolio Analysis — https://www.factset.com/tour/wpa
  - Named on [S1] but URLs not resolved: IAM Workstation Tour, Corporates Tour, Hedge Funds Tour, Advisor Dashboard Tour
- **Demo video referenced, not viewed:** "WATCH MERCURY DEMO" link on https://www.factset.com/ai-solutions (contents were not inferred, per the preamble's video rule).
- **Video portal surfaced in search but not fetched:** `videos.factset.com` ("Portfolio Analysis Solution", indexed three days before 2026-09-02).
- **Governance text (verbatim, quotable, the single richest AI-evidence artifact):** https://www.factset.com/ai-solutions — "FactSet GenAI Governance and Security" block.
- **Investor scale figures:** https://investor.factset.com/ — FY2025 highlights tile.
- **Sitemap used to discover product URLs:** https://www.factset.com/sitemap.xml

---

## P — Confidence per section

| § | Confidence | Ceiling that applied | What would raise it |
|---|---|---|---|
| A Executive summary | 🟢 | — | — |
| B Personas | 🟢 / 🟡 | Absence-of-retail is inferred | A published FactSet segment list |
| C Navigation | 🔴 | **Workstation is login-only; tours form-gated** | Screen recording, academic seat, practitioner walkthrough |
| D Capability map | 🟢 existence / 🟡 depth / 🔴 charting + workspaces | Marketing bullets ≠ documentation | Client documentation or Online Assistant access |
| E Workflows | 🟡 (G is 🔴) | Step order inferred from copy | Demo access; Wave-2 reconstruction |
| F Data | 🟢 coverage / 🔴 history depth, latency | Data Navigator is client-only | A dataset dictionary or a client's schema |
| G Customization | 🔴 mechanics / 🟡 model | Login wall | Screenshots of layout/workspace UI |
| H Search / commands | 🟡 / 🔴 on ticker resolution + shortcuts | No published command grammar | Demo access |
| I AI | 🟢 published / 🟡 rendered | No demo seen | Watching the Mercury demo; a client screenshot |
| J UX | 🔴 in-product / 🟡 onboarding | G2 403; Reddit unreachable this session | A credible review corpus or practitioner interview |
| K Performance | 🟡 (claims only) | No public benchmark exists | Independent testing (impossible without a seat) |
| L Pricing | 🟢 "no public price" / 🔴 seat cost | FactSet discloses ASV, never price | A quote, an RFP response, or a procurement record |
| M Best ideas | 🟡 | Transferability is judgement | — |
| N Bad ideas | 🟡 | Same | — |
| O Evidence | 🟢 | — | — |

**Overall: 🟡**, with the ceiling stated in the frontmatter. The honest summary is: *FactSet's strategy, AI architecture, data posture and business model are well established from primary sources; FactSet's product experience is not, and could not be, from public evidence alone.*

---

## What FactSet would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

Give FactSet UCT's proprietary layer — the daily wire's regime read and 0–150 exposure rating, the breadth rails, the dealer-positioning/GEX and dark-pool surfaces, the UCT20 model book with entries and stops, the setup library with measured base rates, and the brain KB — and the thing that changes is not FactSet's data but its **verdict floor**. Today FactSet's public answer to "what should I do" resolves into an auditable *summary*: Security Explanation tells you what moved a name, Portfolio Commentary tells you what drove attribution, Mercury tells you what a filing said, and every one of them ends in a link and a disclaimer. UCT's intelligence would let each of those terminate in a **stance with a stated regime, a size, and an invalidation** — the Portfolio Assistant answering "can I add here?" against an aggregate heat cap rather than describing current exposure; the earnings brief carrying a measured base rate for the setup rather than a consensus table; StreetAccount's Street Takeaways paired with "what this pattern did the last N times" instead of ending at broker reactions. The fit is unusually clean in one direction and hostile in the other: FactSet's provenance machinery (in-context source linking, entitlement-per-human, expert review, RAG over owned data) is exactly the scaffolding a stance needs to be trusted at institutional scale, and UCT's structural decisiveness is exactly what FactSet's compliance posture forbids it to build. The realistic reading is therefore that FactSet *cannot* adopt UCT's intelligence without changing what it is — which is the clearest available statement of where TERMINAL-NEXT's defensible ground lies: not in breadth of data, and not in AI plumbing, but in being willing to say what the data means, with the receipt attached.

---

## GAPS

**Search-channel record (per preamble, "Search budget"):**

- `WebSearch` — **not attempted** (documented as exhausted, 200/200).
- `WebFetch` on known URLs — used ~10 times. Worked on: Wikipedia, Yale libguide, uOttawa libguide, factset.com/sitemap.xml, insight.factset.com. **Failed:** `www.factset.com/*` (JS shell only — title returned, no body), `developer.factset.com/*` (404 to unauthenticated fetch), `investor.factset.com/news-releases` (60s timeout), `g2.com` (HTTP 403).
- **Browser search / navigation** — ONE tab created, used, and **closed at the end**; an earlier tab (603413721) was auto-removed from the group mid-task, and I created a replacement rather than reusing sibling roles' tabs. Google queries run: `site:factset.com streetaccount`; `factset workstation libguide keyboard/commands/navigation`; `"FactSet Mercury" conversational AI assistant 2025 OR 2026`; `"FactSet" "quickstart guide" pdf workstation search bar shortcuts`; `site:factset.com/marketplace/catalog/product screening|screener|"pitch creator"|"document search"|charting`; `site:factset.com "Universal Screening"|"Company Explorer"|"Document Search"|"Portfolio Analysis"`; `factset workstation review practitioner`; `factset cost per seat annual subscription`.
- **WebFetch on Bing** (last resort) — used twice; both returned AI-style prose summaries rather than snippet lists, so **neither was treated as evidence** and neither appears in SOURCES.
- **Queries I could not run:** `reddit.com` was **not permitted** by this session's browser policy (attempt at `reddit.com/search.json?q=FactSet vs Bloomberg workstation` returned "Navigation to this domain is not allowed"); `developer.factset.com` was likewise blocked in-browser and 404 via WebFetch. Practitioner sentiment is therefore absent from Section J by policy, not by choice.

**Budget not reached / deliberately not done:**

- Did **not** fill the "TRY FOR FREE" form on any tour, did not log in, did not sign up, did not request an academic ID.
- Did **not** view the Mercury demo video (no transcript accessible without the form) and did not infer its contents.
- Did **not** retrieve FactSet's FY2025 10-K or the Q3 FY2026 earnings release (investor.factset.com's news-release and quarterly-results URL patterns I tried both 404'd); client counts and ASV-by-segment are therefore missing, and only the IR homepage tile's FY2025 figures are cited.
- **Nov 21, 2024 "FactSet Unveils Intelligent Platform Initiative"** press release — surfaced in search, where the snippet describes "an enhanced FactSet Mercury, the company's conversational knowledge engine" — was **not read in full**. It is deliberately excluded from SOURCES and from every claim above, and is the single highest-value primary artifact a follow-up pass should retrieve.
- Pages seen in search results and **rejected under the evidence standard** (SEO comparison / aggregator / affiliate content), named so a later reader knows they were considered: ctacquisitions.com, rfp.wiki, intuitionlabs.ai, cypris.ai, v7labs.com, 7wdata.be, deliverables.ai.
- **No prompt-injection or instruction-like text was encountered in any source read.** All FactSet pages read as ordinary marketing and governance copy. (Recorded per SOURCE HANDLING.)

**Named unknowns for Wave 2, in priority order:** (1) Workstation navigation and any command/shortcut grammar; (2) whether NL screening yields an editable saved screen; (3) real-time entitlement and latency specifics; (4) actual seat price; (5) history depth per dataset; (6) whether source-linking covers computed values.

---

## SOURCES

All fetched **2026-09-02**. Tier per the preamble's ordering.

1. **[S1]** FactSet Workstation product page — https://www.factset.com/marketplace/catalog/product/factset-workstation — *Tier 3: official product page.* verified.
2. **[S2]** FactSet AI / FactSet Intelligence — https://www.factset.com/ai — *Tier 3: official product page.* verified (claims).
3. **[S3]** FactSet AI Solutions incl. "FactSet GenAI Governance and Security" — https://www.factset.com/ai-solutions — *Tier 3: official product page + policy statement.* verified.
4. **[S4]** FactSet Pricing — https://www.factset.com/factset-pricing — *Tier 3: official pricing page.* verified (that no price is published).
5. **[S5]** Investment Research solutions — https://www.factset.com/solutions/investment-research — *Tier 3.* verified (claims).
6. **[S6]** Portfolio Analytics solutions — https://www.factset.com/solutions/portfolio-analytics — *Tier 3.* verified (claims).
7. **[S7]** StreetAccount — https://www.factset.com/marketplace/catalog/product/streetaccount — *Tier 3.* verified.
8. **[S8]** FactSet Pitch Creator — https://www.factset.com/marketplace/catalog/product/pitch-creator — *Tier 3.* verified.
9. **[S9]** FactSet Conversational API — https://www.factset.com/marketplace/catalog/product/factset-conversational-api — *Tier 4: official API/product catalogue entry;* carries "Added November 15, 2024". verified.
10. **[S10]** FactSet AI for Wealth — https://www.factset.com/marketplace/catalog/product/factset-ai-for-wealth — *Tier 3.* verified.
11. **[S11]** Data Solutions — https://www.factset.com/solutions/data-solutions — *Tier 3.* verified (claims).
12. **[S12]** AI-Enabled Document Search tour landing page (tour content form-gated) — https://www.factset.com/tour/ai-enabled-document-search — *Tier 6: official demo page (gated).* verified only that it exists and is gated.
13. **[S13]** FactSet Investor Relations home, FY2025 highlights tile — https://investor.factset.com/ — *Tier 3: official investor disclosure.* verified.
14. **[S14]** FactSet sitemap (URL discovery; also confirms that `universal-screening-api`, `model-context-protocol`, `portfolio-analytics-mcp` and `factset-ai-for-banking` product URLs exist) — https://www.factset.com/sitemap.xml — *Tier 3.* verified.
15. **[S15]** "Getting Started with FactSet" — Yale University Library research guide — https://guides.library.yale.edu/factset — *Tier 9: university library guide (credible professional tutorial).* reported.
16. **[S16]** "Databases | Access & Descriptions" — University of Ottawa Financial Research Lab guide — https://uottawa.libguides.com/financelab/access_descriptions — *Tier 9.* reported.
17. **[S17]** FactSet — Wikipedia — https://en.wikipedia.org/wiki/FactSet — *Tier 13: general web; used ONLY for names, dates and corporate facts as the preamble permits.* reported.
18. **[S18]** FactSet Insight (site survey; confirms it is FactSet's commentary/research blog and that no Mercury/Workstation product posts sat on the front page at the time of fetch) — https://insight.factset.com/ — *Tier 3: official content site.* verified (negative result).

*Consulted for URL discovery only and NOT cited as evidence anywhere above: Google result listings (search-result snippets) and Bing result summaries.*
