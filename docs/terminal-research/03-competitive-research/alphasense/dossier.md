---
id: B-AS-01
title: AlphaSense benchmark dossier
role: Benchmark product dossier author (AlphaSense)
wave: 1b
group: B
category: competitor
scope: AlphaSense (alpha-sense.com) — AI research and document-search platform
confidence: 🟡 overall
evidence_ceiling: No logged-in observation. AlphaSense is a closed, quote-priced enterprise platform with no free tier, no public demo instance and no published API reference; every UI claim below is reconstructed from the vendor's own help centre and marketing, never from the running product. Screenshots embedded in help articles were not viewed (text extraction only). Latency, density and pricing figures are vendor-claimed or practitioner-reported, never measured. A seat (or a recorded demo walkthrough) would raise C, G, H, J and K from 🟡/🔴 to 🟢.
sources: 31 primary; 5 secondary
uct_relevance: medium
status: draft
date: 2026-09-02
---

# AlphaSense — benchmark dossier (Document C Part LX)

**Naming note, load-bearing for every later wave.** The research product is at
**`alpha-sense.com`** (hyphenated). **`alphasense.com` is an unrelated gas-sensor
manufacturer.** Any source citing `alphasense.com` for this product is describing the
wrong company and must be discarded. The in-product domain is `research.alpha-sense.com`;
the help centre is `help.alpha-sense.com` (a Zendesk instance, publicly readable).

**Source-handling note.** Nothing read during this research contained text directed at the
agent, instructions to change behaviour, or claims of authority. One near-miss worth
recording for Wave 2: AlphaSense's own `/compare/alphasense-vs-bloomberg` page surfaces in
search results with the phrases *"Steep learning curve for new users"* and *"AI and genAI
capabilities are less robust"* — those are **AlphaSense's characterisation of Bloomberg**,
not of itself, and a snippet-level read would invert the attribution. Verify the subject of
any con-list scraped from a vendor comparison page.

---

## A — Executive summary

**OBSERVATION.** AlphaSense is an enterprise **research and document-search platform**, not
a trading terminal. It indexes a licensed corpus the vendor sizes at *"500+ million premium
financial and business documents"* — SEC and global filings, earnings-call transcripts,
sell-side broker research, expert-network interviews (Tegus), news/trade press, regulatory
publications, plus a firm's **own internal documents** — and puts an AI layer over the whole
of it: keyword/boolean **Document Search**, conversational **Generative Search**, an
autonomous **Deep Research** mode, scheduled **Workflow Agents**, and (announced 2026-06-03,
early-access only) an always-on agent called **SuperAnalyst**. It sells annually, per seat
or per enterprise package, with no published price. Founded 2011 by Jack Kokko (CEO) and Raj
Neervannan (CTO); HQ Hudson Yards, New York. It raised $350M at a $7.5B valuation on
2026-06-03, roughly double the $4B set in June 2024 when it simultaneously agreed to buy
Tegus for $930M.

**Its philosophy, in one sentence (Part CCXLVII):** *the answer is worthless unless you can
click straight through to the sentence it came from* — AlphaSense sells **auditability of
generated research over a licensed corpus**, and treats every AI surface as a citation
machine first and a writing machine second.

**EVIDENCE.**
- Corpus size, positioning, customer count, Forrester claim — `https://www.alpha-sense.com/` (T1 official product page, fetched 2026-09-02). *Claimed:* "Trusted by 7,000+ of the world's largest enterprises"; "Named the only Leader in The Forrester Wave™: Market And Competitive Intelligence Platforms, Q3 2026".
- Founding, founders, HQ, acquisition list — `https://www.alpha-sense.com/about/` (T1, 2026-09-02). *Verified (official self-description):* founded 2011; Kokko + Neervannan; Hudson Yards NYC; "Acquisitions of Tegus, BamSEC, Canalyst, and Sentieo…".
- Funding + Tegus price — Reuters, 2024-06-11, "AlphaSense valued at $4 bln in latest funding, agrees $930 mln deal for rival Tegus"; Reuters/WSJ, 2026-06-03, "$350 million at a valuation of $7.5 billion" (T-secondary: credible financial press, read via Google result snippets, 2026-09-02). Corroborated by AlphaSense's own press release `/press/alphasense-raises-350m-at-7-5b-valuation…` (T1).

**INTERPRETATION.** AlphaSense's moat is *content licensing plus indexing*, not UI. The AI
layer is the sales story, but what a competitor cannot copy is 1,500+ broker-research
providers, 300k+ expert transcripts and a normalised filings index. Every AI feature it
ships is deliberately constrained to that corpus — Deep Research is marketed explicitly
against tools "limited to content scrapable on the open web". That constraint is the
product: bounded corpus → checkable citation → defensible answer.

**RELEVANCE TO UCT.** Nearest UCT surfaces are the **AI Search** layer, the **Morning Wire**
grounding gate, and the **earnings modal / calendar research** stack — all of which already
face the same problem (an LLM writing over a bounded internal corpus, where a fabricated
number is a member-visible failure). AlphaSense is *not* a benchmark for TERMINAL-NEXT's
market-data, options-flow, breadth or charting lanes; it has none of them.

**CONFIDENCE.** 🟢 for identity, ownership, funding and corpus positioning (multiple
independent primary + credible-press sources agree). 🟡 for "philosophy", which is an
inference from consistent vendor language rather than a stated principle.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's AI answers are scoped to an explicitly
bounded, named corpus (wire history, KB, filings, transcripts, the desk's own notes) and
every sentence deep-links into it, *then* the desk will trust AI output enough to act on it
— which is the gate UCT's own report card (12/50 baseline) says has not been cleared.

**OPEN QUESTION.** Does AlphaSense refuse to answer when its corpus is thin, or does it
answer weakly? The help centre asserts the former ("Gen Search will say so, instead of
fabricating a response") but that is a vendor claim with no published eval behind it.

---

## B — User types / personas served

**OBSERVATION.** AlphaSense segments by **firm type**, not by job-to-be-done, and its
segmentation spans well beyond finance. Named on the homepage and platform pages:

- **Financial services** — Investment & Corporate Banking, Hedge Funds, Private Equity, Asset Management, Venture Capital.
- **Corporates** — Life Sciences & Healthcare, Tech/Media/Telecom, Energy, Industrials, Consumer Goods & Retail.
- **Professional services** — Consulting, Law Firms, Insurance.

Two structural persona splits show through the product itself:

1. **Investor vs corporate.** Broker research is entitlement-gated and requires a named broker relationship; *"Wall Street Insights is the first and only equity research collection purpose-built for the corporate market"* — i.e. a separate, licensed way for non-investors to read sell-side.
2. **User vs administrator.** The **Credit Usage Dashboard** is admin-only and exists to answer "who is driving spend", implying a procurement/ops persona distinct from the analyst.

A third persona is implied by the help centre's **AlphaDemics** certification and "Register
for Live Training" articles: this is a product with an onboarding cost high enough to
warrant a training curriculum.

**EVIDENCE.**
- Segment list — `https://www.alpha-sense.com/` and `https://www.alpha-sense.com/platform/` (T1, 2026-09-02), which enumerate solution URLs per segment.
- Broker entitlement + WSI quote — `https://help.alpha-sense.com/hc/en-us/articles/41944201012115-Broker-Research-in-AlphaSense` (T1 help centre, 2026-09-02). *Verified:* access requires contacting an account manager with "your brokers' contact information (firm, first and last name, email address)".
- Admin persona — `https://help.alpha-sense.com/hc/en-us/articles/53749621606419-Credit-Usage-Dashboard` (T1, 2026-09-02). *Verified:* dashboard is admin-restricted, includes a "Usage by User" table.
- Training — `https://help.alpha-sense.com/hc/en-us/categories/41093558093843-Get-Started` (T1, 2026-09-02), listing AlphaDemics and Register for Live Training.

**INTERPRETATION.** The persona that matters most is the **junior-to-mid analyst doing
document-heavy diligence** — everything from Workspaces to Deep Research to the Due
Diligence agent set is shaped around a multi-day research project, not a trading session.
There is no persona resembling an intraday trader anywhere in the product surface.

**RELEVANCE TO UCT.** UCT's persona set is the inverse: the **desk trader** first, then the
**member**. The one AlphaSense persona that maps is the *admin/owner watching LLM spend* —
UCT already has this problem (`CATALYST_COST_CAP_DAILY`, the $5/day theme-engine cap, the
LLM cost doctrine) but has no equivalent of a single per-seat consumption view.

**CONFIDENCE.** 🟢 for the published segmentation (it is the vendor's own nav). 🟡 for the
inferred "junior analyst is the centre of gravity" reading — that is my inference from
feature shape, not a vendor statement.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT ships an AI layer with metered cost,
*then* an owner-visible consumption view keyed by user and by surface (not just a daily
dollar cap) will be needed before members can be let onto it — the cap tells you when you
stopped, not who spent it.

**OPEN QUESTION.** Does AlphaSense distinguish a "professional/non-professional" data
entitlement the way market-data vendors must? Nothing in the public material suggests it
does — its content is documents, not exchange data — but this is unconfirmed.

---

## C — Navigation: how users move

**OBSERVATION.** Navigation is organised around a **left icon toolbar** whose entries map to
modes, not to securities. Confirmed entry point: Document Search is reached by clicking
*"the magnifying glass icon in the left toolbar"*. Modes evidenced across the help centre:
Generative Search, Document Search, Company Profiles, Dashboards, Workspaces, Notebook,
Search Library, Workflow Agent Library.

The **content model** — the thing a user actually navigates — is the **Four Perspectives**,
AlphaSense's own taxonomy of every document in the corpus:

| Perspective | Contents (vendor's words, paraphrased) |
|---|---|
| **Company** | Documents published by a company — 10-Q, 10-K, earnings calls, presentations, press releases, ESG reports |
| **Analyst** | Research published by expert researchers — sell-side company/industry/macro reports |
| **News & Regulatory** | News and trade journals plus government-agency and NGO publications |
| **Expert** | First-hand accounts — former employees, customers, competitors, channel partners |

Inside Document Search there are **two independent search bars at the top**: a left
**Keyword Search** bar (trends across companies) and a right **Company & Ticker Search** bar
(documents for named organisations). Either or both can be used. Results render in a
left-hand list with **Vertical Source Filters** and a **Source Sort** control offering Score
(relevancy), Date, Pages, Companies, Source and **Sentiment** (including sentiment *change*,
event transcripts only).

**EVIDENCE.**
- Toolbar + two search bars + sort options — `https://help.alpha-sense.com/hc/en-us/articles/41636391262739-Introduction-to-Document-Search-Navigation` (T1, 2026-09-02). *Verified* for the named UI elements; the article does **not** document the document-viewer pane or any keyboard behaviour.
- Four Perspectives — `https://help.alpha-sense.com/hc/en-us/articles/41245560097171-A-Guide-to-the-Four-Perspectives-in-AlphaSense` (T1, 2026-09-02). *Verified* for the four names and their contents; the article does **not** state how a user switches between them in the UI.
- Mode inventory — help-centre category listings for Search, Monitor, Analyze, Get Started (T1, 2026-09-02).

**INTERPRETATION.** This is a **search-first, mode-based** shell, closer to a legal-research
tool (Westlaw/Lexis) than to a market terminal. There is no evidence of a Bloomberg-style
command line, a ticker-first home screen, or a mnemonic language. The Four Perspectives are
the interesting design object: they are a *source-provenance* axis rather than an
*asset-class* or *function* axis, and they let a single query be re-cut by "who is talking"
— company, sell-side, press, insider.

**RELEVANCE TO UCT.** TERMINAL-NEXT's research surfaces (earnings modal, AI Search, calendar
brief) already fan out over heterogeneous sources — filings, transcripts, wire history,
Perplexity, tweets, broker-ish commentary — and currently present them as *sections*. The
Four Perspectives suggests presenting them as *a provenance filter over one result set*
instead, which is a different and cheaper interaction.

**CONFIDENCE.** 🟡. Ceiling: the two load-bearing navigation questions — how a user switches
perspective, and what the document viewer looks like — are **not answered by any public
source I could reach**, because the help articles that would answer them carry screenshots I
could not view. A recorded product walkthrough or a seat would raise this to 🟢.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT tags every retrieved item with a
provenance class (company-published · professional-analysis · press · primary/insider) and
exposes that as a first-class filter, *then* a desk user can answer "who is actually saying
this?" in one click instead of reading four separately-styled panels — and the AI layer gets
a free grounding axis to cite along.

**OPEN QUESTION.** Is there a keyboard-driven navigation path at all? Nothing in the public
help centre mentions shortcuts, a command palette, or hotkeys — for a product sold to
analysts who live in it all day, that absence is either a real gap or a documentation gap,
and I cannot distinguish them.

---

## D — Capability map (Part XIII taxonomy)

**OBSERVATION.** Mapped against the Part XIII taxonomy, with what AlphaSense actually ships
in each cell:

| Taxonomy cell | AlphaSense capability | Status |
|---|---|---|
| **Market overview** | None. No index/tape/market-wide dashboard. **Sentiment Indices** page exists as a marketing/data artefact. | absent |
| **Security pages** | **Company Profiles** — Summary, Company Overview, Workflow Agents, "Market Data, Financial Performance, & Peers", "Earnings Commentary & Call Sentiment", Results. Sub-tabs: Financial Overview, Valuation & Ratios, Statements (10-yr income/BS/CF), Comparables, Charting, M&A, Pre-IPO Funding Rounds, Shareholders, Workforce Data. | shipped |
| **Fundamentals** | As-reported historicals, segment financials, consensus estimates, market data; **Canalyst** models + Updater Tool + Excel add-in; **Industry Comps & Models**; **Table Tools** and **TableX** extraction from filings. | shipped |
| **News** | News & Regulatory perspective; RSS feed ingestion (user-added); trade press. | shipped |
| **Earnings** | Transcript library; **Transcript Summaries**; **Smart Summaries** (highlights / lowlights / guidance / Q&A); **Sentiment Analysis** on calls; **Events Calendar**; live-event audio with mobile access; **Snippet Explorer**; **Blacklining** (diff between major filings). | shipped, strong |
| **Economic** | Macro research via analyst + regulatory perspectives (EIA, DoE cited). No economic-release calendar, no time-series macro database. | thin |
| **Screening** | Financial screening inside Financial Data; **Industry Comps**; **Deal Agent (M&A Screener)**. No technical/price screener. | partial |
| **Charting** | A "Charting" tab inside Company Profile financials ("customizable visualizations"). No technical charting, no drawing tools, no intraday. | minimal |
| **Alerts** | **Saved Searches → email alerts** (name, frequency, delivery time); iOS notification alerts; agent-completion in-app + email notifications. | shipped |
| **Portfolio / watchlist** | **Watchlists** (shareable), **Tags** + **Tag Manager**, **Bookmarks**, **Highlight Tags** for annotation. No positions, no P&L, no risk. | watchlist only |
| **Documents** | The core. SEC filings (S-1, 10-K, 10-Q, 8-K, proxies, Forms 3/4/5, 13D, 144, SD/SDA, X-17A-5, CERT, EFFECT, N-CEN), global filings, Companies House, FDIC, FERC; broker research from 1,500+ providers; 300k+ expert transcripts across 29k+ companies, 8k+ added monthly; **internal firm content** via Enterprise Intelligence connectors (SharePoint, Drive, Zoom, API upload, bulk folder/ZIP upload). | shipped, the moat |
| **Collaboration** | **Notebook** / **Notebook+** (notes, drafts, capture, share, mobile), share documents and searches, shared watchlists, organisational agents. | shipped |
| **AI** | **Generative Search**, **Deep Research**, **Generative Grid**, **Workflow Agents** (13 due-diligence deal agents as of Aug 2026, incl. **CIM Analyzer**), **Smart Summaries**, **Work Products** (decks/models/memos), **SuperAnalyst** (early access). | shipped + one announced |
| **Command / keyboard** | Boolean query language in the keyword bar (see H). **No documented shortcuts or command palette.** | query language only |
| **Workspaces** | **Workspaces** — a container for threads, up to 5,000 uploaded docs each, folders, saved searches, grids, reports; **Due Diligence Workspace** with kickoff flow; **Dashboards** (filter bar, custom filters, keyword variables, dashboard properties, ask-questions-of-your-dashboard). | shipped |

**EVIDENCE.** Composite of T1 help-centre category listings and articles fetched 2026-09-02:
Search / Monitor / Content / Analyze / Get Started / Product Updates categories; Company
Profiles (`…/42623871994131`); Workflow Agents (`…/43235900768915`); Workspaces
(`…/51087728136979`); Smart Summaries (`…/41669307479443`); Sentiment (`…/41711605431059`);
SEC Filings Content Overview (`…/41887692936083`); Broker Research (`…/41944201012115`);
Product Updates — August 2026 (`…/54995224793875`); plus `https://www.alpha-sense.com/platform/`
and `https://www.alpha-sense.com/platform/expert-insights/` (T1). Expert-library counts
(300k+ insights, 29k+ companies, 8k+ transcripts/month) are *claimed* on the expert-insights
product page. Broker count (1,500+ providers; Morgan Stanley, BofA, Barclays, Cowen,
Deutsche Bank, Evercore ISI, HSBC named) is *verified* in the help centre.

**INTERPRETATION.** Read as a shape, AlphaSense is **90% documents-and-AI, 10% numbers, 0%
market**. It has deliberately not built the left half of a terminal (tape, charts, screens,
regime) and has instead gone very deep on the right half (documents, transcripts, experts,
internal content, generation). The Aug-2026 release notes confirm the direction of travel:
every shipped item that month was about ingesting more content (Zoom, bulk folders, doc
classification), extracting from it better (Smarter TableX), or agentifying it (six new deal
agents, CIM Analyzer).

**RELEVANCE TO UCT.** UCT already owns the left half AlphaSense lacks (breadth, COT, flow,
GEX, charts, live prices) and is thin exactly where AlphaSense is deep (a searchable,
citable document corpus spanning filings + transcripts + the firm's own KB and wire
history). The complementarity is close to perfect, which makes AlphaSense a *capability
donor* rather than a competitor.

**CONFIDENCE.** 🟢 for capability existence and naming (all from the vendor's own
documentation). 🟡 for depth/quality of each cell — a feature named in a help article is
evidence it exists, not evidence it is good.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT treats "documents the desk has already
read" (wire archive, Model Book notes, Notebook entries, transcripts, filings) as a
**first-class indexed corpus** rather than as per-page fetches, *then* one AI surface can
serve earnings prep, thesis review and post-mortem — where today each surface re-fetches and
re-prompts independently.

**OPEN QUESTION.** How much of the Financial Data layer is genuinely AlphaSense's versus
resold? The help centre names *no* third-party vendor (see F) — unusual, and it matters for
anyone judging estimate quality.

---

## E — Workflows (Part XIV A–G)

Brief per Part XIV; Wave 2 reconstructs five in depth.

**A — "Why is this stock moving?"** *Weak-to-partial.* AlphaSense has no price tape, no
intraday chart and no live quote surface, so it cannot answer the price half of the
question. What it can do: open the Company Profile, read "Earnings Commentary & Call
Sentiment", scan the Results panel across all four perspectives, and ask Generative Search
directly. Smart Summaries land earnings summaries *"within five minutes"* of a call, which
is the one genuinely time-sensitive path. **Missing:** the move itself.

**B — "Prepare me for earnings."** *Strongest workflow in the product.* Events Calendar →
live event (with mobile listen and calendar sync to Outlook/Gmail, added Aug 2026) →
transcript → Transcript Summaries and Smart Summaries (highlights, lowlights, guidance, Q&A)
→ sentiment score and sentiment *change* vs prior calls → Snippet Explorer for a phrase
across quarters → Blacklining to diff the filings → broker reaction via the Analyst
perspective → expert transcripts for channel colour. There is a dedicated *"Search Library:
Earnings Season"* of pre-built queries.

**C — "Research this company from scratch."** *The flagship.* Open a Workspace → Deep
Research prompt → the agent plans, searches, iterates, reasons, reports and audits over
10–30 minutes → output is a cited report; drop internal documents in (up to 5,000 per
workspace); build a Generative Grid to compare across names; export via Work Products to
PowerPoint/Excel/Word; commission an expert call (AI-led or human-led) if the corpus is
thin.

**D — "What matters today?"** *Present but asynchronous.* Dashboards with filter bars and
keyword variables; saved searches that email on a chosen frequency and delivery time;
Workflow Agents that run and email results; iOS push. There is no "market open" surface and
no synchronous morning read — the product's unit of time is the *day-or-longer research
task*, not the session.

**E — "Find a trade."** *Effectively absent.* Screening exists over fundamentals (Industry
Comps, financial screening) and over deals (Deal Agent / M&A Screener, CIM Analyzer), but
there is no price/volume/technical screener, no setup taxonomy, no entry/stop/target
construct anywhere in the product. AlphaSense generates *conviction inputs*, not trades.

**F — "Monitor my universe."** *Solid.* Watchlists (shareable), Tags + Tag Manager,
Bookmarks, Company Profile coverage, Events Calendar, saved-search alerts, scheduled custom
Workflow Agents, mobile notifications. Note a deliberate consolidation: *"Company Profile
Follow alerts have been automatically converted to Doc Search Saved Searches"* — two
monitoring mechanisms were merged into one.

**G — "Understand the regime."** *Weak.* No breadth, no positioning, no internals, no
regime construct. The closest artefacts are the public **Sentiment Indices** page and macro
research reachable through the Analyst and News & Regulatory perspectives. A user can *read*
about the regime; the product does not *compute* one.

**EVIDENCE.** As section D, plus specifically: Smart Summaries timing and coverage
(`…/41669307479443`, T1, updated 2025-08-18, *"over 3000 companies"*, earnings summaries
within five minutes, research/expert summaries twice daily); Deep Research five-stage
pipeline and 10–30 minute runtime
(`https://www.alpha-sense.com/resources/product-articles/introducing-deep-research-in-alphasense/`,
T1 product article, announced 2025-06-13); Workflow Agents 5–15 minute background runtime
and email-on-completion (`…/42623871994131`, T1); saved-search alert fields and the Follow →
Saved Search conversion (`…/41815267178899`, T1); calendar sync and 13 deal agents (August
2026 release notes, T1).

**INTERPRETATION.** The clean split is **B and C are best-in-class; A, E and G are not
served at all.** AlphaSense's clock runs in minutes-to-days. A trading desk's clock runs in
seconds-to-hours. That is not a gap in AlphaSense — it is the product's deliberate scope.

**RELEVANCE TO UCT.** Workflow B is where UCT and AlphaSense collide directly: UCT's
earnings modal already does expected move, beat history, AI call recap, verbatim transcripts
and TTS. AlphaSense adds four things UCT does not have — **sentiment change across quarters**,
**blacklining between filings**, **a phrase-across-quarters explorer (Snippet Explorer)**,
and **pre-built query libraries for earnings season**. Workflows E and G, which are UCT's
core strengths, are AlphaSense's blind spots — a useful confirmation that no single vendor
covers TERMINAL-NEXT's span.

**CONFIDENCE.** 🟡 for B, C, D, F (documented step-by-step in the help centre but never
observed running). 🟢 for the *absences* in A, E, G — an absence across a complete help
centre, a complete product nav and 16 months of release notes is strong evidence.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's earnings prep adds **sentiment delta
vs the prior four calls** and a **phrase-across-quarters explorer** over the transcripts it
already fetches, *then* the desk gets the two things AlphaSense users cite as habit-forming,
at near-zero marginal data cost — UCT already stores the transcripts.

**OPEN QUESTION.** What does a Deep Research report actually look like at the end of 30
minutes — length, structure, citation density, and how often it is used versus abandoned?
No public sample output exists.

---

## F — Data: coverage, vendors, latency, asset classes, history

**OBSERVATION.**

- **Corpus size:** *"500+ million premium financial and business documents"* (claimed).
- **Filings:** SEC (S-1, 10-K, 10-Q, 8-K, proxies, Forms 3/4/5, Schedule 13D, Form 144, foreign investment disclosures, SD/SDA, X-17A-5/A, CERT, EFFECT, N-CEN), global filings, UK Companies House, FDIC, FERC. **History depth and post-EDGAR latency are not stated anywhere in the public documentation.**
- **Broker research:** 1,500+ research providers; Morgan Stanley, Bank of America, Barclays, Cowen, Deutsche Bank, Evercore ISI, HSBC named. **Entitlement-gated** — a user supplies their broker contacts and access is provisioned. "Wall Street Insights" is the separately-licensed corporate-market collection. Broker research **cannot be downloaded via the API**.
- **Expert content (Tegus):** 300,000+ investor-led insights, 29,000+ companies, 8,000+ transcripts added monthly, public and private markets; three types — Investor-Led Discussions, Channel Checks, Voice of Customer. Live calls in two formats: **AI-Led Expert Calls** (an AI interviewer) and human-led.
- **Financial data:** as-reported income statement / balance sheet / cash flow, segment financials, consensus estimates, market data (stock price and volume), 10-year statement history in Company Profile, M&A, pre-IPO funding rounds, institutional holdings and insider transactions, workforce/headcount analytics. Canalyst models supply the model layer.
- **Internal content:** SharePoint, Google Drive, Zoom (Aug 2026), API upload, bulk folder/ZIP upload, RSS feeds — indexed alongside licensed content.
- **Asset classes:** equities and corporate credit-adjacent documents only. **No futures, FX, options, crypto, or rates data of any kind.**
- **Real-time vs delayed:** market data is described only as "stock pricing and volume metrics" with no latency statement. The only latency figures published anywhere are *content* latencies: earnings Smart Summaries within five minutes; research and expert-call summaries refreshed twice daily.

**Vendor disclosure — a notable negative finding.** The help centre's own article titled
**"AlphaSense Financial Data Sources"** names **no third-party vendor at all**. It
distinguishes only *"AlphaSense data"* (extracted directly from filings) from unnamed
*"third-party data providers"*.

**EVIDENCE.** `https://help.alpha-sense.com/hc/en-us/articles/54133001189907-AlphaSense-Financial-Data-Sources`
(T1, 2026-09-02) — *verified* that no vendor is named. `…/41887692936083-SEC-Filings-Content-Overview`
(T1) — filing types verified; *verified absent*: history depth and latency.
`…/41944201012115-Broker-Research-in-AlphaSense` (T1) — provider count, named firms,
entitlement flow, API download restriction. `https://www.alpha-sense.com/platform/expert-insights/`
(T1) — expert counts, *claimed*. `…/42623871994131-Company-Profiles` (T1) — 10-year
statements, shareholders, workforce. August 2026 release notes (T1) — Zoom connector, bulk
folder upload, Latest Shareholder View.

**INTERPRETATION.** The refusal to name financial-data vendors is a deliberate posture, and
it is the single largest unverifiable claim in the product. For a research platform, "we
extract from the filing ourselves" is a strong claim (it implies no vendor-normalisation
lag) and an unfalsifiable one from outside. Meanwhile the *content* latencies AlphaSense
does publish are all measured in minutes-to-twice-daily, which confirms the product's clock.

**RELEVANCE TO UCT.** Two directly usable observations. (1) **Entitlement-gated content is a
product shape, not just a licence problem** — AlphaSense makes the gate visible and
provisions per-user; UCT's paid-vs-free split (`FREE_PAGES`, `require_paid`) is the same
shape and could similarly be presented as "you have access to X, ask us for Y" rather than a
hidden page. (2) **Publishing content latency per source builds trust cheaply** — "earnings
summary within five minutes, expert summaries twice daily" is a freshness contract; UCT's
own recurring failure mode (a stale surface that looks live) is exactly what such a contract
prevents.

**CONFIDENCE.** 🟢 for what is covered (filing types, broker providers, internal connectors —
all in official docs). 🔴 for **history depth, filing latency, market-data latency and every
underlying financial-data vendor** — these are not disclosed publicly and I could not
establish them. What would raise it: a seat (the in-product source footers usually name
vendors), or a vendor data-sheet obtained through sales.

**RECOMMENDATION (hypothesis).** *If* every TERMINAL-NEXT data surface carries a stated
freshness contract ("this is as of X; it refreshes every Y"), *then* the class of defect
UCT keeps rediscovering — a green-looking surface serving stale data — becomes visible to
the user rather than only to a monitor.

**OPEN QUESTION.** How far back do the filings and transcripts go? For a Model Book–style
historical study this is the load-bearing number, and no public source states it.

---

## G — Customization

**OBSERVATION.**

- **Dashboards** — the primary personalised surface. Documented controls: **Dashboard Properties**, a **Filter Bar**, **Custom Dashboard Filters**, **Keyword Variables** (parameterised queries), proprietary-document panels, and (2026) *"Ask Questions About Your Dashboard with Generative Search"*.
- **Workspaces** — project containers: threads, folders, up to **5,000 uploaded documents each** (unlimited total), drag-and-drop upload, saved searches, grids, reports, internal connectors. A **Due Diligence Workspace** template with a kickoff flow.
- **Watchlists** — shareable; on iOS, searches can be filtered by watchlist, default brokers and favourite brokers.
- **Tags / Tag Manager / Bookmarks / Highlight Tags** — a user-defined classification layer over documents and notes, with an admin-ish Tag Manager.
- **Saved searches** — reusable queries that double as alert definitions.
- **Search Library** — vendor-curated ready-made queries by use case, plus organisation-level saved content.
- **Agents** — **Organisational Agents** created by administrators for firm-wide use; **custom Workflow Agents** are the only ones that can be scheduled.
- **Tables/columns** — Industry Comps gained pin-favourites, auto-saved views, a country filter and Select-All/Deselect-All in Aug 2026; **Table Tools** and **Tegus Formula Builder** parameterise data pulls into Excel.
- **Office surface** — native **PowerPoint and Excel add-ins**; Canalyst Modeling Tools Excel add-in; the Tegus Formulas add-in is being migrated into an "AlphaSense Data & Models Excel add-in".
- **Multi-monitor / layouts** — **no evidence of any layout, panel-arrangement or multi-monitor feature.** Nothing in the help centre describes moving, resizing or saving panel layouts.

**EVIDENCE.** Monitor category listing and Dashboards articles (T1, 2026-09-02); Workspaces
(`…/51087728136979`, T1) for the 5,000-document limit and contents; Workflow Agents
(`…/43235900768915`, T1) for the scheduling asymmetry — *verified:* library agents cannot be
scheduled, organisational agents' scheduling is "not currently supported", only custom
workflows can be scheduled; Analyze category (T1) for Table Tools, Canalyst add-in, Tegus
formulas; August 2026 release notes (T1) for Industry Comps view-saving and bulk upload;
Get Started / iOS articles (T1) for watchlist filtering on mobile.

**INTERPRETATION.** Customisation is **content-shaped, not layout-shaped**. A user
personalises *what is watched and what is asked*, never *where things sit on screen*. That
is a coherent choice for a document platform and a poor fit for a trading workstation, where
spatial layout carries state. The scheduling asymmetry is the sharpest detail: the agents
that ship pre-built (the ones a new user would reach for) are exactly the ones that cannot
run on a schedule, so automation requires authoring your own — a real onboarding cliff
between "try it" and "rely on it".

**RELEVANCE TO UCT.** UCT already has the layout half (charts workspace, react-grid-layout,
widget registry, multi-chart grid, saved layouts) and is thinner on the *content* half —
there is no parameterised saved-query object that doubles as an alert and as a dashboard
panel. AlphaSense's **Keyword Variables** (one query template, many instantiations) is the
idea most directly portable to UCT's screener/scan definitions.

**CONFIDENCE.** 🟢 for the customisation objects that exist. 🟡 for their limits (only the
5,000-doc workspace cap is published). 🟢 for the *absence* of layout/multi-monitor features
— absent across the entire help centre and 16 months of release notes.

**RECOMMENDATION (hypothesis).** *If* a saved TERMINAL-NEXT query is **one object** that can
be viewed as a panel, fired as an alert and handed to an agent as a schedule — rather than
three separate objects as UCT has today (screener definition, watchlist alert, scan sweep) —
*then* the desk stops maintaining three copies of the same intent, which is the
second-authority-over-one-value defect in a different costume.

**OPEN QUESTION.** Can a user reorder or hide the left-toolbar modes, or is the shell fixed?
Not documented anywhere public.

---

## H — Search / commands

**OBSERVATION.** AlphaSense's command surface is a **query language, not a command palette**.
The keyword bar supports:

| Operator | Behaviour (per the vendor's reference) |
|---|---|
| `AND` | both terms must appear |
| `OR` | either term |
| `NOT` | exclude |
| `NEAR(n)` — e.g. `NEAR2`, `NEAR10` | terms within n words, same sentence, any order |
| `PHRASE(n)` — e.g. `PHRASE1` | terms within n words, same sentence, **in order** |
| `( )` | group a single concept |
| `TITLE( )` | match keyword or smart synonym **in the title only** |
| `in:[content]` | scope to a content type from inside the keyword bar |
| `" "` | exact phrase; **suppresses stemming** |
| `positive` / `negative` | sentiment-scoped context search |
| `#`, `$`, `%` | search numeric values |

**Documented limits:** `OR`, `NOT`, `NEAR` and `PHRASE` **cannot be nested inside** `NEAR` or
`PHRASE`, and `NEAR`/`PHRASE` enforcement is restricted when combined with other required or
excluded keywords.

**Ticker resolution** is a *separate bar* — Company & Ticker Search — not a mode of the
keyword bar. Supporting features: **Smart Synonyms** (a query for a concept expands to its
vocabulary), **Sentiment Smart Synonyms**, **Reverse Ticker Searches**, **Section Search**
(scope to a filing section), **Filtering for Analysts** and **Filtering for Broker Research**,
and searching **private companies** and **primary vs secondary mentions**.

**No keyboard shortcuts, hotkeys or command palette are documented anywhere in the public
help centre.**

**EVIDENCE.** `https://help.alpha-sense.com/hc/en-us/articles/41630689127571-Boolean-Logic-Quick-Reference-Guide`
(T1, 2026-09-02) — operators and nesting limits *verified*. Search category listing (T1) for
Company & Ticker Search, Keyword Search, Reverse Ticker Searches, Smart Synonyms. Content
category listing (T1) for Section Search and the analyst/broker filters. Absence of shortcuts:
searched the Get Started, Search and Product Updates categories and the site help index; no
hit.

**INTERPRETATION.** Two search grammars coexist — a precise boolean one for people who know
what they are looking for, and a natural-language one (Generative Search) for people who do
not. AlphaSense keeps both and even ships an article titled *"When to use Document vs
Generative Search?"*, which is an admission that the boundary confuses users. **Smart
Synonyms is the quietly important feature**: it means a boolean query does not have to
enumerate vocabulary, which is normally what makes boolean unusable for non-librarians.

**RELEVANCE TO UCT.** UCT's screener has the mirror-image problem: a **Builder** (structured
criteria) beside a **Concierge** (English → scan). AlphaSense's answer — keep both, document
the boundary explicitly, and add a synonym-expansion layer so the structured path is not
punishingly literal — is directly applicable. `NEAR(n)`/`PHRASE(n)` over transcripts is also
a genuinely missing UCT capability: "guidance NEAR5 cautious" across four quarters is not
expressible in any current UCT surface.

**CONFIDENCE.** 🟢 for the operator set and its documented limits (a dedicated official
reference page). 🔴 for keyboard/command efficiency, which I could not establish at all —
absence of documentation is not proof of absence. A seat, or a demo video showing an analyst
working at speed, would settle it.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's transcript and filing search supports
ordered and unordered proximity operators plus a synonym-expansion layer, *then* the desk can
ask questions of the corpus that neither keyword search nor an LLM answers well — and the
proximity hit becomes a citable span the AI layer can quote.

**OPEN QUESTION.** How does Generative Search decide *which* documents to reason over — is
the boolean layer used as a retrieval pre-filter, or is retrieval purely semantic? The
"Using Generative Search on Select Documents" article implies the user can pin the set, but
the default behaviour is undocumented.

---

## I — AI: what is shipped vs marketed

**OBSERVATION.** Five distinct AI surfaces, at four different maturities.

**1. Generative Search — shipped, the centre of the product.** Conversational. The vendor
describes it as creating a research plan *"much like a lead analyst would"*. It reviews *all*
content in the user's account **including their integrated internal content**. Citation
behaviour is the important part: *"Each summarized insight includes direct citations to the
source material it was generated from"*, selecting a summary opens the source document with
**the relevant passage highlighted**, and highlighting any text in the response lets the user
ask a follow-up or verify that specific claim. Default timeframe is **the past 12 months**.
Suggested follow-up questions are offered; context carries across turns. **Web search is
available via the Gemini model** — the only third-party model named anywhere in the public
documentation. Financial data was integrated into Generative Search (dedicated help article),
and slide creation was added.

**2. Deep Research — shipped 2025-06-13.** A longer-running mode: *"dozens of searches"*
over *"thousands of potentially relevant results"*, 10–30 minutes per query, through five
explicit stages — Planning, Searching & Iterating, Reasoning, Reporting,
Reviewing/Auditing — ending in inline citations. Positioned explicitly against web-scraping
research agents.

**3. Smart Summaries — shipped, active as of 2025-08-18.** Structured summaries per content
type: earnings calls get highlights / lowlights / guidance / Q&A; company pages get Upgrades
& Downgrades, Strengths & Opportunities, Weaknesses & Threats, Competition. **Deep-linked
citations to the exact snippet.** Coverage *"over 3000 companies"*; earnings summaries appear
within five minutes; research and expert-call summaries refresh twice daily.

**4. Workflow Agents — shipped, partially.** Library agents (manual trigger only),
organisational agents (admin-created, cannot be scheduled), custom agents (schedulable). Run
5–15 minutes in the background, notify in-app and by email. 13 due-diligence deal agents as
of Aug 2026, including a **CIM Analyzer** that produces cited screening memos from an
uploaded CIM.

**5. SuperAnalyst — announced 2026-06-03, NOT generally available.** Press release date
2026-06-03; *"available to select enterprise customers through early access"*. The product
page carries a **"Coming Soon"** label and an early-access signup. Claims: always-on 24/7
monitoring, autonomous expert identification *and conducting calls*, Excel/Word/PowerPoint
generation, retained project memory, user-defined "Skills". **No customer statistics, no
performance data, no case studies accompany any of it.**

**Grounding posture.** The homepage claims *"Sentence-level citations with no
hallucinations"*. The help centre states the weaker and more defensible version: if there is
no answer, *"Gen Search will say so, instead of fabricating a response"*. **No public
evaluation, benchmark, or accuracy figure supports either claim.**

**EVIDENCE.** `…/41666587181203-Interacting-with-Generative-Search` (T1, 2026-09-02) —
citations, highlight-to-verify, 12-month default, Gemini web search, refusal behaviour.
`https://www.alpha-sense.com/resources/product-articles/introducing-deep-research-in-alphasense/`
(T1, dated 2025-06-13, attributed to Chris Ackerson, SVP Product) — five stages, 10–30 min.
`…/41669307479443` (T1, updated 2025-08-18) — Smart Summaries structure, deep-linked
citations, 3000+ companies, five-minute earnings latency. `…/43235900768915` (T1) — agent
tiers and scheduling. `https://www.alpha-sense.com/platform/superanalyst/` (T1, 2026-09-02)
— *"Coming Soon"*. `https://www.alpha-sense.com/press/alphasense-introduces-superanalyst…/`
(T1 press release, 2026-06-03) — early access; Kokko quote: *"SuperAnalyst becomes an
extension of teams by continuously monitoring, analyzing, and completing workflows."*
Homepage (T1) — the no-hallucinations claim.

**INTERPRETATION.** **Marketing vs shipped, cleanly separated:** Generative Search, Deep
Research, Smart Summaries and Workflow Agents are *shipped and documented for end users*
(help articles with configuration steps are strong evidence a feature exists in the product);
**SuperAnalyst is marketing** — a press release, a "Coming Soon" page, four help articles
written ahead of general availability, and zero evidence of a user running it. The gap
between "sentence-level citations with **no hallucinations**" (homepage) and "it will say so
instead of fabricating" (help centre) is the gap between a marketing absolute and an
engineering behaviour, and the help centre is the honest one.

The genuinely transferable engineering idea is **highlight-to-verify**: selecting text in the
generated answer and asking the system to substantiate *that specific claim*. It converts
verification from a chore into a gesture, and it is the mechanism that makes the citation
promise actually usable rather than decorative.

**RELEVANCE TO UCT.** Directly comparable to UCT's own grounding work — the COT narrative
gate (every number in the prose must appear in the facts, else nothing is stored), the wire
critic, the report-card golden set, `cotFacts.js` as the only numbers the LLM may cite. UCT's
approach is *stricter* than AlphaSense's published posture: UCT refuses to store ungrounded
prose; AlphaSense cites and lets the reader check. The two are complementary — UCT has the
gate, AlphaSense has the verification UX.

**CONFIDENCE.** 🟢 for what is shipped and for SuperAnalyst's non-GA status (a "Coming Soon"
label and an early-access press release are unambiguous). 🟡 for how well any of it works —
**no accuracy evidence exists publicly for any AlphaSense AI feature**, which is the single
biggest evidence ceiling in this dossier. What would raise it: a seat plus a golden-set
replay, or a published third-party evaluation.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's AI answers support
**highlight-any-sentence → "show me where this came from"**, deep-linking to the exact span
in the source rather than to the source document, *then* the desk's trust in AI output
becomes a function of one gesture rather than of the model's reputation — and the same
mechanism doubles as the fastest way to catch a fabrication.

**ANTI-PATTERN, flagged here rather than in N because it is an AI claim.** Never ship
"no hallucinations" as a product claim. It is unfalsifiable, it is contradicted by the
vendor's own help centre, and the first counterexample a user finds costs more trust than
the claim ever bought.

**OPEN QUESTION.** Which model or models sit behind Generative Search and Deep Research?
Gemini is named only for the web-search path; the reasoning models are undisclosed, as is
whether firms can pin or opt out of a given model.

---

## J — UX: strengths, weaknesses, density, onboarding

**OBSERVATION.**

**Strengths (from documentation structure and reported use).**
- **One corpus, many lenses.** The Four Perspectives let a single query be re-cut by who is speaking, which is a genuinely economical interaction.
- **Verification is one gesture.** Citation → highlighted passage in source; highlight text → verify claim.
- **The summary is a structure, not a paragraph.** Highlights / lowlights / guidance / Q&A, or Strengths / Weaknesses / Competition — the same shape every time, so the eye learns where to look.
- **Cross-surface consistency.** Generative Search is reachable from Company Profiles, Dashboards, Workspaces and selected document sets — one AI affordance, many contexts.
- **Real mobile.** iOS and Android apps with live-event listening, notifications, watchlist-filtered search and Notebook+ — not a responsive afterthought.

**Weaknesses.**
- **Two search paradigms with a confusing boundary** — evidenced by the existence of an official article titled *"When to use Document vs Generative Search?"*.
- **Automation cliff.** The agents a new user meets (library, organisational) cannot be scheduled; only self-authored custom agents can.
- **Onboarding cost is institutionalised.** A certification programme (AlphaDemics), live training sessions and a downloadable user guide are the vendor's own admission that the product is not learnable by exploration.
- **Reported:** practitioner reviews consistently cite a steep learning curve, cost, and an interface that *"can feel complex/slow for some users"*, with slow loading of large PDFs mentioned specifically.

**Density.** Not directly observable. The documented shell — left icon toolbar, two top search
bars, left result list, right document viewer — implies a **two-pane document-reader density**,
far lower than a trading terminal's. This is inference, not measurement.

**Anti-patterns worth naming.** (1) The **"no hallucinations"** absolute (see I). (2) A
**"Coming Soon"** product page with four help-centre articles written for it — documentation
that describes an unavailable feature is exactly the "documented but unreachable" failure
mode UCT has paid for repeatedly, and here it is shipped deliberately as marketing.
(3) **Entitlement opacity** — broker research access requires an email exchange with an
account manager, so what a user can see is not discoverable from inside the product.

**EVIDENCE.** Strengths and weaknesses inferred from T1 help-centre structure (categories,
article titles, the "When to use Document vs Generative Search?" article listed under Get
Started). Practitioner reports (T-secondary, *reported*, read via Google result snippets
2026-09-02): G2 AlphaSense reviews — *"despite the learning curve and cost"*, *"some premium
content and features can be expensive"*; AWS Marketplace reviews — *"Interface can feel
complex/slow for some users"*; IntuitionLabs, 2025-11-28 — "Steep Learning Curve",
"slow loading large PDFs". Mobile: Get Started category articles for iOS/Android (T1).

**INTERPRETATION.** AlphaSense's UX is optimised for a user who has been **trained** and who
returns daily to a research task, not for a user who drops in. That is a defensible enterprise
trade — but it is the opposite of what a desk tool needs at 9:28 a.m.

**CONFIDENCE.** 🟡 for strengths (documented, not observed). 🟡 for weaknesses (multiple
independent practitioner sources agree, but all are review-aggregator text of unknown
recency and provenance). 🔴 for density — **not measured, and unmeasurable without a seat**.
Screenshots exist in help articles I could not view; a screen-recorded demo would raise this
to 🟡 and a seat to 🟢.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT ever needs a certification programme to
be usable, the design is wrong for the desk — treat AlphaSense's AlphaDemics as a **warning
marker**, not a feature to copy. The transferable half is the *structured summary shape*
(same headings every time), which lowers learning cost instead of institutionalising it.

**OPEN QUESTION.** How many clicks from login to "the answer to a specific question about a
specific company"? Unmeasurable from outside, and the number that would most cleanly
characterise the UX.

---

## K — Performance

**OBSERVATION.** Every performance figure available is **vendor-claimed or
practitioner-reported**; none is measured.

| Figure | Value | Label |
|---|---|---|
| Deep Research query runtime | 10–30 minutes | claimed (product article) |
| Workflow Agent runtime | 5–15 minutes, background, emailed on completion | claimed (help centre) |
| Earnings Smart Summary availability | within five minutes of the call | claimed (help centre) |
| Research / expert-call summary refresh | twice daily | claimed (help centre) |
| Interface responsiveness | "can feel complex/slow for some users"; slow loading of large PDFs | reported (review aggregators) |
| Infrastructure | 2025 partnership with **Cerebras Systems** "to deliver faster and more precise insights" | claimed (about page) |

**EVIDENCE.** Deep Research article (T1, 2025-06-13); Company Profiles (T1) for agent
runtime; Smart Summaries (T1, updated 2025-08-18) for the five-minute and twice-daily
figures; `https://www.alpha-sense.com/about/` (T1) for Cerebras; G2/AWS/IntuitionLabs
(T-secondary, *reported*) for perceived slowness.

**INTERPRETATION.** The published numbers are **workflow latencies, not interaction
latencies** — AlphaSense measures itself in "how long until the report is ready", never in
"how long until the pane paints". That is coherent for research and disqualifying for
trading. The Cerebras partnership is the only signal that interaction latency is being
engineered at all, and it is a press-release-grade signal.

**RELEVANCE TO UCT.** A direct contrast worth holding: TERMINAL-NEXT is being designed for a
desk whose tolerance is measured in hundreds of milliseconds. Nothing about AlphaSense's
performance posture transfers — but the *practice* of publishing a per-feature latency
expectation ("this takes 10–30 minutes, we will email you") is worth copying for UCT's own
long-running AI jobs, which currently either block or complete silently.

**CONFIDENCE.** 🔴 as a performance assessment. Nothing here was measured; the figures are
the vendor's own and the qualitative reports are third-hand. What would raise it: a seat plus
a timed walkthrough of the same task, or a screen-recorded demo with visible clock.

**RECOMMENDATION (hypothesis).** *If* a TERMINAL-NEXT AI action will take longer than a few
seconds, *then* it should state its expected duration up front and deliver asynchronously
with a notification — AlphaSense's 10–30-minute Deep Research is only tolerable because it
tells you first.

**OPEN QUESTION.** Does the reported slowness come from the document viewer (large PDFs) or
from search itself? The two have completely different design implications.

---

## L — Pricing / business model

**OBSERVATION.** **No price is published anywhere.** The pricing page lists two packages
plus two add-ons, all quote-based:

| Item | Contents | Price |
|---|---|---|
| **Market Intelligence** | Business data, AI workflows, ETL integration services, 24/7 support, enterprise-grade data protection | not published |
| **Enterprise Intelligence** | Everything above **plus AI search over internal content**, additional cloud-hosting options, API uploads, customised training, IT support | not published |
| **Expert Calls** (add-on) | 1 million pre-qualified experts, claimed savings "up to 70% versus traditional networks", transcriptions, translations, compliance portal | not published |
| **Canalyst Financial Models** (add-on) | AI-generated financial tables, industry KPIs, non-GAAP metrics, Excel tools | not published |

Contract shape, stated by the vendor: *"We provide annual subscriptions for all team sizes,
ranging from enterprise packages to per-seat options."* So **both** per-seat and per-firm
pricing exist. Broker research is a **separate entitlement** requiring the customer's own
broker relationships. **Wall Street Insights** is a distinct licensed collection for
corporates. There is **no free tier and no self-serve signup** — every path ends at "connect
with our sales team".

**A second, newer axis: consumption.** AlphaSense now meters AI usage in **credits**.
Generative Search, "ThinkLonger" and Deep Research each consume credits at different rates
against an organisation-wide allocation that **resets at contract renewal**. An admin-only
**Credit Usage Dashboard** shows credits consumed as a percentage and a count, pacing against
remaining contract time, a **forecast line** for whether the org will exhaust credits early,
and per-user consumption; the same data is exposed via a **Credit Usage API**.

**Reported market pricing** (T-secondary, *reported*, not verified): Vendr's buyer guide,
last updated **February 2026**, from **38 purchases** — median contract value **$17,500/year**,
range **$9,250 to $51,000**. Reported negotiation patterns: 25–50 seats commonly achieve
"15–30% lower per-seat pricing"; multi-year 10–20% discounts; annual prepayment 5–10%.

**Corporate context.** $350M raised at a **$7.5B** valuation on **2026-06-03** (led by
Vitruvian Partners, with Accenture Ventures and J.P. Morgan), roughly double the **$4B** set
on **2024-06-11**, the same day it agreed to acquire **Tegus for $930M**. Prior acquisitions:
Sentieo, BamSEC, Canalyst.

**Professional/non-professional distinction:** none found. AlphaSense licenses documents, not
exchange data, so the market-data professional/non-professional regime does not appear to
apply.

**EVIDENCE.** `https://www.alpha-sense.com/pricing/` (T1, 2026-09-02) — packages, add-ons,
the annual-subscription quote, no figures. `…/53749621606419-Credit-Usage-Dashboard` (T1) —
credit model, admin-only dashboard, forecast, API. `…/41944201012115` (T1) — broker
entitlement, Wall Street Insights. `https://www.vendr.com/buyer-guides/alphasense`
(T-secondary, aggregated transaction data, last updated Feb 2026) — median/range/sample.
Reuters 2024-06-11 and Reuters/WSJ 2026-06-03 (T-secondary, credible financial press, read
via Google result snippets 2026-09-02), corroborated by AlphaSense's own press releases (T1).

**INTERPRETATION.** The business model is moving from **pure seat licensing to seat + AI
consumption**, and the Credit Usage Dashboard is the tell: AlphaSense has decided AI cost is
variable enough to require customer-visible forecasting rather than absorption. The
forecast-line design ("will you run out early?") is notably better than a hard cap — it warns
before it bites.

**RELEVANCE TO UCT.** This is the section with the sharpest transferable idea for UCT. UCT's
LLM spend is currently governed by **daily hard caps** ($15/day catalyst hard cutoff, $5/day
theme engine, a 300/day COT narrative cap) that fail *closed and silently* — the surface
degrades and only a log says why. AlphaSense's model is **allocation + pacing + forecast +
per-user attribution**, which answers "who spent it and will we run out" before the cutoff
fires. UCT's own memory records the cost-doctrine principle ("never downgrade a model for
cost"); a pacing forecast is the mechanism that makes that principle survivable.

**CONFIDENCE.** 🟢 for the model's *shape* (packages, annual, per-seat-or-enterprise, credits,
no free tier — all from the vendor's own pages). 🔴 for actual prices — **AlphaSense
publishes none, so no price in this dossier is verified**; the Vendr figures are aggregated
third-party transaction data of unaudited provenance and should be treated as an
order-of-magnitude only. What would raise it: a quote obtained through sales (the owner could
plausibly request one), or a public-sector procurement disclosure.

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT's AI budget is expressed as an allocation
with a **pacing forecast and per-surface attribution** rather than a daily hard cap, *then*
the owner learns that a cap is coming days before a member-visible surface goes quiet — which
is the exact failure UCT's flag-ledger work says is invisible today (off-and-unset is
indistinguishable from off-on-purpose).

**OPEN QUESTION.** What is a single seat's list price, and how much of the median $17,500
contract is the base seat versus broker-research and expert-call add-ons? Unknowable from
public sources.

---

## M — Best ideas for UCT

Each stated as a hypothesis with the UCT workflow it serves. **None of these is a
requirement**; they are transferable observations from a benchmark.

**M1 — Provenance as a first-class filter (the Four Perspectives).** *If* every item in a
TERMINAL-NEXT result set carries a provenance class — company-published · professional
analysis · press · primary/insider — and that class is a filter over one unified result set,
*then* the "who is actually saying this?" question is answered in one click instead of by
reading four separately-styled panels. **Serves:** Workflow C (research from scratch) and
Workflow A (why is it moving) on the fundamental side. **Cost:** a tagging pass on existing
sources; no new data.

**M2 — Highlight-to-verify.** *If* selecting any sentence in a generated answer opens the
exact source span that produced it, *then* verification becomes a gesture rather than a task.
**Serves:** AI Search, Morning Wire, the COT weekly read, earnings recaps — every UCT surface
where an LLM writes over facts. This is the strongest single idea in the dossier and it
composes with UCT's existing grounding gate rather than replacing it: the gate stops
ungrounded prose from shipping, highlight-to-verify lets a human check the prose that did.

**M3 — Structured summaries with fixed headings.** *If* an AI summary always has the same
shape for the same content type — highlights / lowlights / guidance / Q&A for an earnings
call — *then* the reader's eye learns the layout and scanning cost drops to near zero.
**Serves:** Workflow B (earnings prep), the earnings modal, the wire's segment structure.
UCT already does this in the wire; AlphaSense shows it generalises to every AI surface.

**M4 — Sentiment *change*, not sentiment level.** AlphaSense's transcript sort offers
sentiment **change comparison** for event transcripts, and its sentiment is normalised
against two years of transcripts. *If* TERMINAL-NEXT reports a call's tone **relative to that
company's own prior calls** rather than as an absolute score, *then* the number carries
information a base-rate-free score does not. **Serves:** Workflow B. **Note:** this is
precisely UCT's own `lesson_a_hit_rate_is_meaningless_without_its_base_rate` applied to tone.

**M5 — Proximity operators and synonym expansion over the transcript corpus.** *If* the desk
can ask `guidance NEAR5 cautious` across four quarters, and the query auto-expands to the
concept's vocabulary, *then* a class of question becomes answerable that neither keyword
search nor an LLM handles well — and the hit is a citable span. **Serves:** Workflows B and C;
feeds M2.

**M6 — Blacklining between filings.** *If* consecutive 10-K/10-Q risk-factor and MD&A sections
are diffed automatically, *then* "what changed" is answered without reading either document.
**Serves:** Workflow B and C. Mechanically cheap; UCT already fetches filings via EDGAR.

**M7 — One saved-query object that is a panel, an alert and an agent schedule.** *If*
TERMINAL-NEXT's saved query is a single object with parameterised variables (AlphaSense's
"Keyword Variables") that can be rendered as a dashboard panel, fired as an alert, or handed
to a scheduled agent, *then* the desk maintains one intent instead of three copies of it.
**Serves:** Workflow F (monitor my universe). **Note:** UCT today has three separate objects
— screener definition, watchlist alert, scan sweep — which is a second-authority-over-one-value
shape.

**M8 — Credit allocation with a pacing forecast and per-user attribution.** *If* AI spend is
an allocation with a forecast line ("at this rate you exhaust credits on the 19th") and a
per-surface/per-user breakdown, *then* the owner sees a cap coming instead of discovering it
from a degraded surface. **Serves:** every UCT LLM lane (catalyst engine, theme engine, COT
narrative, Compass, wire).

**M9 — Published freshness contracts per source.** *If* each data surface states "as of X,
refreshes every Y" (AlphaSense: earnings summaries within five minutes, expert summaries twice
daily), *then* the stale-surface-that-looks-live defect becomes visible to the user, not just
to a monitor. **Serves:** Workflow D and F, and the whole dashboard.

**M10 — Internal content indexed beside external content.** AlphaSense's Enterprise
Intelligence indexes a firm's own memos and decks alongside licensed filings, and its
Generative Search reasons across both. *If* TERMINAL-NEXT indexes the desk's own artefacts —
wire archive, Model Book theses, Notebook entries, journal notes, session transcripts — into
the same searchable corpus as filings and transcripts, *then* "what did we say about this last
time?" becomes a first-class question. **Serves:** Workflows C and G, and the Compass coaching
layer, which currently reaches these stores through separate tools.

**CONFIDENCE.** 🟡 on all ten as *transferable*: each is grounded in verified AlphaSense
behaviour, but whether it transfers to a trading desk is a judgement I cannot test from here.

---

## N — Bad ideas for UCT (things to avoid)

**N1 — "No hallucinations" as a product claim.** Unfalsifiable, contradicted by the vendor's
own help centre (which promises only that the system will say it has no answer), and one
counterexample costs more trust than the claim buys. **Avoid absolutes about model behaviour;
ship the mechanism instead.**

**N2 — Documentation for an unshipped feature.** SuperAnalyst has a "Coming Soon" product
page, a press release and **four help-centre articles** written before general availability.
That is precisely the *documented-but-unreachable* failure UCT has repeatedly paid for; the
only difference is that AlphaSense does it on purpose as marketing. Inside a codebase or a
docs tree it teaches the next engineer that the orphan is the idiom.

**N3 — An automation cliff between "try" and "rely".** Pre-built agents cannot be scheduled;
only self-authored ones can. A user who validates the product on the easy path then discovers
the easy path cannot be automated. **If a capability is discoverable, it should be
schedulable.**

**N4 — Certification as a substitute for learnability.** AlphaDemics plus live training is an
admission the product is not learnable by exploration. For a desk tool used under time
pressure, that is disqualifying.

**N5 — Two search paradigms with an undocumented boundary.** The existence of an official
"When to use Document vs Generative Search?" article is the tell. UCT's Builder/Concierge
split has the same risk — keep both, but make the boundary a UI affordance, not an article.

**N6 — Entitlement opacity.** Content a user cannot see is also content they cannot discover;
unlocking it requires emailing an account manager with broker contact details. UCT's
free/paid boundary should show the locked thing and its unlock path in place, not hide it.

**N7 — Workflow latency as the only published performance number.** AlphaSense never publishes
an interaction latency. For TERMINAL-NEXT the interaction number is the one that matters, and
a product culture that only measures job duration will not notice a slow pane.

**N8 — Layout-free customisation.** AlphaSense lets you customise *what* but never *where*.
For a desk workstation, spatial layout carries state (which pane is the chart, which is the
tape); a content-only personalisation model does not transfer.

**N9 — Quote-only pricing with no self-serve path.** Appropriate for $17.5k enterprise
contracts, actively wrong for a member-facing product. Noted only so nobody imports the
posture along with the ideas.

**CONFIDENCE.** 🟢 on N1, N2, N3, N5 (each is directly evidenced in official material).
🟡 on N4, N6, N7, N8 (inference from documented shape plus practitioner reports).

---

## O — Screenshots / evidence

**Images were not viewed.** All extraction was text-only; the help-centre articles and product
pages below embed official screenshots and product imagery that a Wave-2 verifier with browser
access should open directly. **No image is reproduced here.**

Official screenshot- and demo-bearing pages:
- `https://www.alpha-sense.com/platform/` — platform overview with product imagery
- `https://www.alpha-sense.com/platform/superanalyst/` — SuperAnalyst "Coming Soon" page
- `https://www.alpha-sense.com/platform/expert-insights/` — Tegus expert library
- `https://www.alpha-sense.com/platform/financial-data/`, `/platform/add-ins/`, `/platform/connectors/`, `/platform/enterprise/`, `/platform/wall-street-insights/`
- `https://www.alpha-sense.com/resources/product-articles/introducing-deep-research-in-alphasense/` — Deep Research walkthrough with stage imagery
- `https://help.alpha-sense.com/hc/en-us/articles/41636391262739-Introduction-to-Document-Search-Navigation` — the Document Search shell
- `https://help.alpha-sense.com/hc/en-us/articles/42623871994131-Company-Profiles` — the security page
- `https://help.alpha-sense.com/hc/en-us/articles/41669307479443` — Smart Summaries with citation UI
- `https://help.alpha-sense.com/hc/en-us/articles/51087728136979-Getting-Started-with-Workspaces`
- `https://help.alpha-sense.com/hc/en-us/articles/53749621606419-Credit-Usage-Dashboard`
- `https://help.alpha-sense.com/hc/en-us/categories/40996539323155-Product-Updates` — 16 months of dated release notes, the best single artefact for tracking shipped-vs-announced

Other evidence surfaces not yet exploited:
- `https://www.alpha-sense.com/customer-story-hub/` — case studies (workflow claims, customer-attributed)
- `https://events.alpha-sense.com/alphasummit` — AlphaSummit 2026; conference sessions may yield demo transcripts
- `https://www.alpha-sense.com/sentiment-indices/` and `/earnings/` — public data artefacts, free to inspect
- `https://research.alpha-sense.com/login/` — the product itself, login-gated (**not** to be logged into)

**CONFIDENCE.** 🟢 that these URLs exist and are the right places to look. 🔴 on their visual
content — unviewed.

---

## P — Confidence per section, with ceilings

| § | Confidence | Ceiling and what would raise it |
|---|---|---|
| A Executive summary | 🟢 | Philosophy is inferred (🟡); a vendor design-principles statement would confirm |
| B Personas | 🟢 published / 🟡 inferred | Sales collateral by segment, or a customer interview |
| C Navigation | 🟡 | **Perspective-switching and the document viewer are undocumented publicly.** A seat or a recorded walkthrough → 🟢 |
| D Capability map | 🟢 existence / 🟡 depth | Depth per cell needs hands-on use |
| E Workflows | 🟡 present / 🟢 absent | Wave 2 reconstruction; a demo would settle B and C |
| F Data | 🟢 coverage / 🔴 vendors, latency, history depth | **No financial-data vendor is named publicly and no history depth is stated.** A seat (in-product source footers) or a sales data-sheet |
| G Customization | 🟢 objects / 🟡 limits / 🟢 layout absence | Admin console access for the limits |
| H Search / commands | 🟢 operators / 🔴 keyboard efficiency | **No shortcuts documented anywhere; absence ≠ proof.** A demo video of an analyst at speed |
| I AI | 🟢 shipped-vs-announced / 🟡 quality | **No accuracy evidence exists publicly for any AlphaSense AI feature.** A seat + golden-set replay, or a third-party evaluation |
| J UX | 🟡 / 🔴 density | Density unmeasured; screenshots unviewed. A seat, or opening the help-article images |
| K Performance | 🔴 | **Nothing measured; all figures vendor-claimed or third-hand.** A timed walkthrough on a seat |
| L Pricing | 🟢 model shape / 🔴 actual prices | **AlphaSense publishes no price.** A sales quote (the owner could request one) |
| M Best ideas | 🟡 | Judgement about transfer, not a factual claim |
| N Bad ideas | 🟢 on the evidenced four / 🟡 on the rest | — |
| O Evidence | 🟢 URLs / 🔴 visual content | Open the images |

**Overall: 🟡.** The dossier is strong on *what exists and what does not* (the vendor's own
help centre is unusually complete and publicly readable) and weak on *how well it works* — a
gap no amount of further public research closes. The single highest-value unlock is a seat or
a recorded demo; the second is a sales quote.

---

## Final section — what AlphaSense would look like with UCT's proprietary intelligence (Part XXVI) 🟡

AlphaSense today can tell you everything that has been *said* about a company and nothing
about what the tape is *doing* — it has no price, no volume, no breadth, no positioning, no
regime, and no notion of a trade. Give it UCT's proprietary layer and the product changes
category rather than degree: the Company Profile's "Earnings Commentary & Call Sentiment"
block would sit above a **UCT exposure score and regime label**, so a bullish transcript read
during a hostile regime would carry its own contradiction on the same screen; Smart Summaries
would gain a fifth section — *what the options market is pricing* — from UCT's expected-move
and GEX rails, turning "management guided cautiously" into "management guided cautiously and
the straddle says ±9%"; Deep Research, which today reasons only over documents, would reason
over **the desk's own realised outcomes** — the Model Book's labelled setups, the journal's
per-setup expectancy, the UCT20 record — so a thesis report could end not with a summary but
with *"this pattern has occurred 14 times since 2021; here is the base rate, and here is your
personal expectancy on it"*, which is precisely the claim AlphaSense structurally cannot make
because it has never seen a trade. Workflow Agents would stop being research schedulers and
become **watchers with a market clock**: fire on a stop breach, a regime flip, a
positioning extreme, an unusual-flow print — not just on a filing. And the Four Perspectives
would gain a fifth, the one nobody else can license: **the desk's own prior view**, so every
answer arrives beside what this firm already believed and whether it was right. The
uncomfortable half of the exchange is equally clear — UCT would gain 500 million cited
documents and 300,000 expert transcripts it will never own — which is why the honest reading
of this dossier is that AlphaSense and UCT are **complements, not competitors**, and the
transferable assets are its citation discipline, its provenance taxonomy and its cost-pacing
model, not its product shape. 🟡 — this is a reasoned projection, not an observation, and
nothing in it is evidenced.

---

## GAPS (budget not reached / not reachable)

**Search channel used.** `WebSearch` was not attempted (the preamble records the shared
session cap as exhausted). Evidence was gathered by **WebFetch on known URLs** (31 fetches
against `alpha-sense.com` and `help.alpha-sense.com`, plus Vendr), **one Bing WebFetch**
(low yield), and **browser search in ONE tab** (three Google queries — Tegus/funding,
$7.5B round, practitioner reviews — tab `603413712`, created and **closed** at the end of
the session; other tabs visible in the group belong to sibling roles and were not touched).

**Not reachable from public sources — the honest ceiling list:**
1. **Any AI accuracy evidence.** No benchmark, eval, error rate or third-party assessment exists publicly for Generative Search, Deep Research or Smart Summaries. Every quality claim in section I is the vendor's.
2. **The running UI.** No perspective-switcher, document viewer, keyboard model, information density or click-path could be observed. Help-article screenshots were not viewed (text extraction only). *No login was attempted and none should be.*
3. **Financial-data vendors.** The help centre's own "Financial Data Sources" article names none.
4. **Filings history depth and post-EDGAR latency.** Not stated in the SEC or global filings overviews.
5. **Any actual price.** AlphaSense publishes none. The Vendr median ($17,500/yr, 38 purchases, Feb 2026) is aggregated third-party data of unaudited provenance.
6. **API documentation.** A Credit Usage API and API uploads are referenced, but no public API reference was found. Broker research is explicitly excluded from API download.
7. **SuperAnalyst in use.** Announced 2026-06-03, early access only; no user account of it exists.
8. **Wave-2 targets I did not open:** the customer-story hub (case studies), the AlphaSummit session catalogue (possible demo transcripts), the `/compare/*` pages (vendor-authored, treat as marketing — and see the attribution trap flagged at the top), the free `/sentiment-indices/` and `/earnings/` public artefacts, and monthly release notes before Aug 2026 (only Aug 2026 was read in full).
9. **Queries I could not run:** anything requiring `WebSearch`; any Reddit/practitioner-forum thread (none surfaced in the three browser queries); G2 and AWS Marketplace review pages were read only as search-result snippets, never as full pages, so the practitioner evidence in J and K is second-hand and should be re-fetched directly in Wave 2.

**Prompt-injection observations:** none. No source contained text addressed to an agent or
attempting to redirect this task. One attribution trap (AlphaSense's own comparison page
describing *Bloomberg's* weaknesses in snippet text that reads as self-description) is
recorded at the top of this file.

---

## SOURCES

**Primary — Tier 1 (official product pages, official help centre, official press releases).
All fetched 2026-09-02.**

1. `https://www.alpha-sense.com/` — homepage; positioning, corpus size, customer count, segments, Forrester claim.
2. `https://www.alpha-sense.com/platform/` — capability inventory and sub-page URL map.
3. `https://www.alpha-sense.com/pricing/` — packages, add-ons, annual-subscription statement, absence of figures.
4. `https://www.alpha-sense.com/about/` — founding 2011, Kokko + Neervannan, Hudson Yards, acquisition list, Cerebras 2025.
5. `https://www.alpha-sense.com/newsroom/` — press-release index; media-coverage references to WSJ and Axios.
6. `https://www.alpha-sense.com/platform/superanalyst/` — "Coming Soon" label, capability claims, early access.
7. `https://www.alpha-sense.com/platform/expert-insights/` — Tegus library counts, transcript types, AI-led vs human-led calls.
8. `https://www.alpha-sense.com/resources/product-articles/introducing-deep-research-in-alphasense/` — Deep Research, dated 2025-06-13, five stages, 10–30 min.
9. `https://www.alpha-sense.com/press/alphasense-introduces-superanalyst-the-always-on-ai-execution-layer-for-decision-grade-intelligence/` — dated 2026-06-03; early access; Kokko quote.
10. `https://help.alpha-sense.com/` — help-centre index; eight categories.
11. `https://help.alpha-sense.com/hc/en-us/categories/41093681835923-Search` — Search category article inventory.
12. `https://help.alpha-sense.com/hc/en-us/categories/41093710969363-Content` — Content category inventory.
13. `https://help.alpha-sense.com/hc/en-us/categories/41093658532883-Monitor` — Monitor category inventory.
14. `https://help.alpha-sense.com/hc/en-us/categories/41212838425619-Analyze` — Analyze category inventory.
15. `https://help.alpha-sense.com/hc/en-us/categories/41093558093843-Get-Started` — onboarding, AlphaDemics, mobile apps.
16. `https://help.alpha-sense.com/hc/en-us/categories/40996539323155-Product-Updates` — 16 dated release-note articles; most recent August 2026.
17. `https://help.alpha-sense.com/hc/en-us/articles/41636391262739-Introduction-to-Document-Search-Navigation` — shell, two search bars, source filters, sort options.
18. `https://help.alpha-sense.com/hc/en-us/articles/41630689127571-Boolean-Logic-Quick-Reference-Guide` — operator set and nesting limits.
19. `https://help.alpha-sense.com/hc/en-us/articles/41666587181203-Interacting-with-Generative-Search` — citations, highlight-to-verify, 12-month default, Gemini web search, refusal behaviour.
20. `https://help.alpha-sense.com/hc/en-us/articles/42623871994131-Company-Profiles` — profile tabs, financial sub-tabs, agent runtime.
21. `https://help.alpha-sense.com/hc/en-us/articles/43235900768915-AlphaSense-Workflow-Agents` — agent tiers, Deal Agent, scheduling asymmetry.
22. `https://help.alpha-sense.com/hc/en-us/articles/41711605431059-How-We-Calculate-Sentiment` — −100..100 scale, sentence + document level, 2-year normalisation, model-based.
23. `https://help.alpha-sense.com/hc/en-us/articles/41669307479443` — Smart Summaries; updated 2025-08-18; 3000+ companies; five-minute earnings latency; twice-daily refresh.
24. `https://help.alpha-sense.com/hc/en-us/articles/41944201012115-Broker-Research-in-AlphaSense` — 1,500+ providers, named brokers, entitlement flow, Wall Street Insights, API download exclusion.
25. `https://help.alpha-sense.com/hc/en-us/articles/41887692936083-SEC-Filings-Content-Overview` — filing types; history depth and latency absent.
26. `https://help.alpha-sense.com/hc/en-us/articles/54133001189907-AlphaSense-Financial-Data-Sources` — data categories; **no vendor named**.
27. `https://help.alpha-sense.com/hc/en-us/articles/51087728136979-Getting-Started-with-Workspaces` — 5,000-doc cap, contents, deliverables.
28. `https://help.alpha-sense.com/hc/en-us/articles/41815267178899-Save-Searches-and-Create-Email-Alerts-in-AlphaSense` — alert fields, dashboard save, Follow → Saved Search conversion.
29. `https://help.alpha-sense.com/hc/en-us/articles/53749621606419-Credit-Usage-Dashboard` — credit model, admin-only, pacing forecast, Credit Usage API.
30. `https://help.alpha-sense.com/hc/en-us/articles/54995224793875-AlphaSense-Product-Updates-August-2026` — Zoom connector, 13 deal agents, CIM Analyzer, bulk folder upload, Smarter TableX, Industry Comps views, calendar sync, Latest Shareholder View.
31. `https://help.alpha-sense.com/hc/en-us/articles/41245560097171-A-Guide-to-the-Four-Perspectives-in-AlphaSense` — Company / Analyst / News & Regulatory / Expert.

**Secondary.**

32. Reuters, **2024-06-11** — "AlphaSense valued at $4 bln in latest funding, agrees $930 mln deal for rival Tegus" (credible financial press; read via Google result snippet 2026-09-02, corroborated by SiliconANGLE and The Business Times same date).
33. Reuters / WSJ, **2026-06-03** — $350M raised at $7.5B valuation, led by Vitruvian Partners with Accenture Ventures and J.P. Morgan (credible financial press; snippet, corroborated by AlphaSense's own press release, T1).
34. `https://www.vendr.com/buyer-guides/alphasense` — last updated **February 2026**; median $17,500/yr, range $9,250–$51,000, 38 purchases; negotiation patterns (aggregated third-party transaction data; **reported**, unaudited).
35. G2 AlphaSense reviews and AWS Marketplace AlphaSense reviews — learning curve, cost, "Interface can feel complex/slow for some users" (**reported**; read via Google result snippets only, never as full pages — re-fetch in Wave 2).
36. IntuitionLabs, **2025-11-28**, "AlphaSense: How the AI Market Intelligence Platform Works" — steep learning curve, slow loading of large PDFs (**reported**; snippet only; secondary analysis site, weakest source in this list).
