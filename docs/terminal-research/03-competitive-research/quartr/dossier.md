---
id: B-QTR-01
title: Quartr — events / IR intelligence dossier
role: benchmark product dossier author
wave: 1b
group: B
category: competitor
scope: Quartr (Quartr Pro · Quartr API · Quartr MCP · free mobile app)
confidence: 🟡
evidence_ceiling: "product interior is login-gated (web.quartr.com); no screenshot, trial seat or demo transcript was reachable — navigation, customization, keyboard behaviour, UX and responsiveness are reconstructed from the vendor's own feature pages plus its public developer docs, never observed"
sources: 39 primary; 3 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# Quartr — benchmark dossier (Document C Part LX template)

> **Reading note for synthesis.** Two evidence classes are mixed here and are labelled per claim.
> The **developer documentation** (`quartr.com/docs/**`) is the strongest material in this file:
> it carries contractual SLAs, identifier semantics, rate limits and dataset boundaries, and it
> contradicts nothing on the marketing site. The **feature pages** (`quartr.com/features/*`,
> `/pro`, `/mobile`, use-case pages) are vendor marketing — they describe the UI but are not
> evidence that the UI behaves as described. **Nothing in this dossier was seen running.**
>
> A second caveat that applies to every quote below: pages were retrieved through a
> fetch-and-extract pipeline that converts HTML to markdown and summarises it. Quotes are
> reproduced as that pipeline returned them and are ≤40 words each; treat them as accurate in
> substance, not as byte-verified transcription. Wave 2 should re-pull any quote it wants to
> lean on.

---

## A. Executive summary

**OBSERVATION.** Quartr is a Swedish-founded company-research platform whose entire product is
built on **first-party issuer communications** — earnings calls (live and archived), transcripts,
slide decks, filings and reports — for 16,000+ public companies across 65+ markets. It sells three
things off one corpus: **Quartr Pro** (an AI research workstation for finance professionals), the
**Quartr API** (the same corpus as a data feed for platforms and AI builders), and **Quartr MCP**
(the corpus exposed directly inside Claude / ChatGPT / Codex / Perplexity, included with Pro). A
**free mobile app** sits under all of it as the funnel. It positions itself as "AI infrastructure
for company research" and as "the world's leading IR data layer".

**PHILOSOPHY (Part CCXLVII), one sentence:** *everything a public company says is the dataset, the
number is somebody else's job* — Quartr deliberately owns the **qualitative, primary-source,
traceable** half of research and refuses the price/estimates/screening half almost entirely.

**EVIDENCE.**
- https://quartr.com/ — Tier 3 (official product page), fetched 2026-09-02 — *verified* (as a
  statement of positioning; the coverage figures are *claimed*): "everything said and published by
  public companies, structured for AI"; "more than 800 of the world's most demanding financial
  institutions and technology companies"; named clients Stifel, Yahoo!, Perplexity, Morningstar,
  Janus Henderson.
- https://quartr.com/api — Tier 3, 2026-09-02 — *claimed*: "the world's leading IR data layer",
  "no middleware", "one API, fewer dependencies".
- https://quartr.com/docs/ + https://quartr.com/docs/llms.txt — Tier 4 (official developer docs),
  2026-09-02 — *verified*: eight datasets, all of them documents/audio/summaries. **There is no
  price, volume, estimates, ownership or fundamentals dataset in the API index.** The one
  quantitative dataset (`Segments`) is marked **[Legacy]**.
- https://quartr.com/newsroom — Tier 3, 2026-09-02 — *claimed*: "$18M" raise dated **2026-07-27**;
  Automations launched **2026-08-24**; MCP into Claude **2026-03-30**, Codex **2026-06-02**,
  Perplexity **2026-06-08**; logo rebrand **2026-07-08**.

**INTERPRETATION.** Quartr is not a terminal. It is a **corpus company** with three delivery
surfaces, and the newest surface (MCP) is explicitly *not a UI at all* — it is the product
delivered into somebody else's agent. The 2026 product history reads as a deliberate migration
from "an app that plays earnings calls" to "the retrieval layer other people's AI sits on top of."

**RELEVANCE TO UCT.** Closest to the TERMINAL-CURRENT `/calendar` earnings surface and the
earnings-research modal, and to the AI-search / Ask-AI layer. Quartr is the sharpest available
answer to *"what does a best-in-class 'prepare me for earnings' surface look like when that is the
whole company"*.

**CONFIDENCE.** 🟢 for what the product is and sells. 🟡 for the coverage numbers (see §F — the
vendor's own pages disagree with each other). Ceiling: none for this section.

**RECOMMENDATION (hypothesis).** A UCT hypothesis worth testing: *TERMINAL-NEXT's earnings surface
should decide, explicitly and in writing, whether it is a **corpus** surface (primary documents,
traceable) or a **read** surface (UCT's interpretation), because Quartr's coherence comes from
never blending the two in one pane.*

**OPEN QUESTION.** Does Quartr's refusal of price/estimates data reflect strategy (stay
complementary so terminals and platforms buy the API rather than fear it) or capability?

---

## B. User types / personas served

**OBSERVATION.** Eight named segments, split cleanly into *buyers of the workstation* and *buyers
of the feed*, plus a free-and-academic tier that is pure funnel.

| Segment | Surface sold | Named evidence |
|---|---|---|
| Hedge funds | Quartr Pro | "Trusted by 4 of 5 largest hedge funds globally" (claimed) |
| Asset management | Quartr Pro | GAM Investments, Janus Henderson, Nordea, SEB, Danske Bank |
| Sell-side equity research | Quartr Pro | Stifel, Kepler |
| **Investor relations teams** | Quartr Pro | Ciena, Shopify, H&M, PUMA, Epiroc, KLA |
| Financial research platforms | Quartr API | Morningstar, RavenPack, Boosted.ai, Blueflame AI, Acuity, Rogo |
| Trading / brokerage platforms | Quartr API | Public, Toss |
| Media platforms | Quartr API | Yahoo!, NAVER |
| **AI companies / agents** | API + MCP | Perplexity, ChatGPT/Codex, Claude |
| Students & professors | Quartr Pro, **free** | student funds, investing clubs, professors |
| Retail / anyone | free mobile app | 4.8/5 claimed |

**EVIDENCE.** https://quartr.com/ (footer use-case taxonomy), https://quartr.com/customers,
https://quartr.com/use-cases/hedge-funds, https://quartr.com/use-cases/investor-relations,
https://quartr.com/students — all Tier 3, 2026-09-02, *claimed* except the customer names, which
are *reported* by Quartr with attributed quotes.

**INTERPRETATION.** The **IR-team persona is the unusual one** and it is load-bearing: the same
corpus that lets a fund read a competitor's slides lets an IR team benchmark its own deck against
peers. That is a two-sided market off one dataset, and it explains the slide-history feature
existing at all. The "AI companies" persona is newer and is the growth story.

**RELEVANCE TO UCT.** UCT's personas are the internal desk first, members second. Quartr's
two-sided trick has no UCT analogue (UCT has no issuer-side customer) — but the *free app →
paid workstation* ladder maps directly onto UCT's FREE_PAGES → paid ladder.

**CONFIDENCE.** 🟢 (segments and named clients are on official pages). 🔴 for any claim about how
these personas actually use it day to day — no practitioner interviews were reachable.

**RECOMMENDATION (hypothesis).** *A benchmark's persona list is a map of who pays, not of who is
served well; UCT should read Quartr's IR persona as evidence that one corpus can serve two
opposed readers, and check whether UCT's own corpus (the wire, the book, the KB) has a second
reader it is not selling to.*

**OPEN QUESTION.** Do IR teams and funds share one product build, or is there a separate IR
configuration behind the login?

---

## C. Navigation — how users move

**OBSERVATION.** Reconstructed, not observed. The public evidence describes a **company → event →
document** spine, with three entry doors: the **event calendar**, **global search**, and
**watchlists**. Deep links land on "the exact page in the original document." The web app lives at
`web.quartr.com`; the marketing site is `quartr.com`.

Documented movements:
- **Calendar → event page.** "Users click calendar events to access dedicated event pages" showing
  "live audio, real-time transcripts, slide presentations, summaries, or on-demand replays."
- **Search → source.** Clicking a global-search result "open[s] the exact page in the original
  document" with the keyword highlighted.
- **Citation → source, side-by-side.** In AI chat, "click any citation to open the source document
  side-by-side with the chat."
- **Alert → the sentence.** "You can jump directly to the exact sentence in the transcript" and
  play the audio from that moment.
- **Slide → its own history.** "Press a specific slide and the history comparison appears below it."
- **Watchlist as a filter, and as an `@` mention.** Watchlists filter search results and calendar
  views, and are addressable inside AI chat via `@` mentions.
- **Chapters** ("Prepared Remarks", "Q&A", nested to level 3) give in-event navigation on both
  audio and transcript.

**EVIDENCE.** https://quartr.com/features/event-calendar · /features/global-search ·
/features/ai-chat · /features/keyword-alerts · /features/slide-history-comparison ·
/features/watchlists — Tier 3, 2026-09-02, *claimed*. https://quartr.com/docs/datasets/chapters.md
— Tier 4, 2026-09-02, *verified* (the chapter model exists in the API, with `level`,
`startTimestamp`/`endTimestamp` in seconds, and the invariant "Chapters are always contained
within the timestamp range of their parent").

**Command palette / keyboard shortcuts: NOT DETERMINED.** No public page, help centre or doc
mentions a command bar, hotkeys, or a keyboard-first mode. `support.quartr.com` does not resolve
(DNS failure, 2026-09-02) and no separate help centre was found. Ceiling: a Pro seat or an
official demo recording would settle it.

**INTERPRETATION.** Every documented navigation action is **the same primitive**: *take me to the
exact place this claim came from.* Calendar, search, alert, citation and slide-history are five
doors onto one behaviour. That is an unusually disciplined interaction model, and it is the single
most transferable thing in this dossier.

**RELEVANCE TO UCT.** Directly relevant to TERMINAL-NEXT's earnings modal and AI-search: UCT
already enforces grounding gates server-side (the COT narrative gate, the wire's groundedness =
"a named FIELD PATH" rule). Quartr's contribution is that grounding is a **navigation** feature,
not just a validation feature — the citation is a door, not a footnote.

**CONFIDENCE.** 🟡 on the described flows (vendor-described, coherent, corroborated by the API's
chapter/identifier model). 🔴 on anything keyboard/palette-shaped. Ceiling as stated above.

**RECOMMENDATION (hypothesis).** *Every AI-generated sentence in TERMINAL-NEXT should be clickable
to the artifact that produced it, opened beside the answer rather than replacing it — and the same
click target should serve alerts, search hits and calendar rows, so one interaction is learned once.*

**OPEN QUESTION.** Is there any keyboard-driven navigation in Quartr Pro at all, or is it an
entirely pointer-driven product? (This matters: a research-first product may legitimately not need
a terminal-style command line.)

---

## D. Capability map (Part XIII taxonomy)

| Taxonomy slot | Quartr | Evidence class |
|---|---|---|
| **Market overview** | ❌ none. No index, breadth, macro, sector or movers surface. | verified by absence across /features and the API dataset index |
| **Security pages** | 🟡 partial — a *company* page (events, documents, materials), not a *security* page. No quote, chart, or price history. | claimed (/companies, /features) |
| **Fundamentals** | ❌ effectively none. The only quantitative dataset, `Segments` (net sales / operating income by product line or geography, **S&P 500 only, from annual reports**), is marked **[Legacy]** and "is currently not offered to new partners". AI chat can *extract* tables from documents, which is not the same as holding a fundamentals dataset. | verified (docs/datasets/company-segments.md) |
| **News** | 🟡 first-party only — filings, reports, 8-K/press equivalents. No third-party newswire, no aggregation. | verified (docs dataset list) |
| **Earnings** | 🟢 **the product.** Live audio, live transcripts, archived audio, edited transcripts with speaker identification, slides, reports, chapters, AI summaries. | verified (docs) |
| **Economic** | ❌ none. | verified by absence |
| **Screening** | 🟡 only *linguistic* screening — global/transcript/slide/filings search across the corpus, filterable by company, watchlist, industry, date, document type; and AI chat over a watchlist. No quantitative screener. | claimed (/features/global-search) |
| **Charting** | ❌ none. No price chart anywhere in the public product description. | verified by absence |
| **Alerts** | 🟢 keyword alerts scoped to **followed companies *or* all public companies**; live-event start alerts; automation-completion alerts. Desktop + mobile push + email. | claimed (/features/keyword-alerts, /features/automations) |
| **Portfolio / watchlist** | 🟡 watchlists yes (multiple; a company may sit in several); **no portfolio, no positions, no P&L.** | claimed (/features/watchlists) |
| **Documents** | 🟢 best-in-class for its slice: 10-K/10-Q/8-K "and global equivalents", proxy statements, registration statements, interim reports, slide decks as PDF, raw **and parsed markdown** delivery. | verified (docs; api-updates changelog 2025-12-18) |
| **Collaboration** | 🔴 NOT DETERMINED. Transcript highlighting ("easily store key findings") and saved/reusable prompt templates exist; no sharing, comments, teams or workspaces are described anywhere public. | ceiling |
| **AI** | 🟢 AI chat with per-query model choice (Claude / GPT / Gemini), citations, saved prompt templates with variable placeholders, document upload, AI summaries (three lengths, with source references), Automations, MCP. | claimed (/features/ai-chat, /features/automations); summaries *verified* in docs |
| **Command / keyboard** | 🔴 NOT DETERMINED (see §C). | ceiling |
| **Workspaces** | 🔴 NOT DETERMINED. No layout, panel or multi-monitor language found. Cross-device *sync* is claimed; cross-device *layout* is not mentioned. | ceiling |

**INTERPRETATION.** The map has an unmistakable shape: **six of fifteen slots are deliberately
empty.** Quartr is not an incomplete terminal; it is a complete *document* product. The `Segments`
legacy note is the tell — the one time they shipped numbers, they pulled it back from new
customers pending "an expansion of coverage and improvement of data quality."

**RELEVANCE TO UCT.** UCT owns almost exactly the complement: breadth, regime, COT, options flow,
dark pool, charts, screener, a model book, a book of positions. UCT's weakest column is the one
Quartr owns outright — primary-document depth on earnings.

**CONFIDENCE.** 🟢 for the present capabilities; 🟡 for the absences (absence is argued from the
vendor's own exhaustive features page and the API's own dataset index, which is strong but not
proof — a Pro seat could reveal an unadvertised surface).

**RECOMMENDATION (hypothesis).** *TERMINAL-NEXT should treat "primary-document depth" as a
capability column it currently scores near-zero on, and decide explicitly whether to buy it
(Quartr's own API is sold for exactly this), build a thin version, or declare it out of scope —
rather than letting it stay an unnamed gap.*

**OPEN QUESTION.** Is there any in-product collaboration (share a highlight, a chat thread, a
watchlist) behind the login? For a hedge-fund buyer that is normally table stakes.

---

## E. Workflows (Part XIV A–G) — brief; Wave 2 reconstructs five

**A — "Why is this stock moving?"** 🟡 *Partial by construction.* If the move is IR-driven, Quartr
is fast: filings "available for 90% within 15 minutes of public release", summaries "available
minutes after documents are published" and updating in real time as slides and transcripts land,
plus a live transcript inside seconds of the call starting. **If there is no IR event, Quartr has
nothing to say** — no price, no volume, no newswire, no flow. *Missing: the move itself.*

**B — "Prepare me for earnings."** 🟢 *The flagship.* Calendar (filtered by watchlist) → the
company's prior events → archived audio + edited transcript with speaker identification → slide
history comparison quarter-by-quarter to see which KPIs were added, dropped or re-emphasised → AI
chat across several years of transcripts for messaging/KPI drift → an Automation armed to run the
moment the next transcript publishes. *Missing: consensus estimates, options-implied expected
move, historical price reaction, whisper numbers — every quantitative element of an earnings
preview.*

**C — "Research this company from scratch."** 🟡 Strong on the qualitative half: every filing,
transcript and deck the company has published, searchable, with an AI chat grounded in it and a
citation to the exact page. *Missing: financials, valuation, ratios, ownership, peers as numbers.*

**D — "What matters today."** 🟡 Daily (or weekly) recap email built from followed companies,
event calendar, activity feed, live-start push notifications, keyword alerts. *Missing: anything
market-wide — no movers, no breadth, no regime. "Today" here means "today for my list."*

**E — "Find a trade."** 🔴 Not served, and not attempted. The nearest thing is a **language
screen**: search the whole corpus for a phrase ("pricing power", "destocking") across *all* public
companies and read who is saying it. That is idea generation, not trade location — no entry, stop,
size, or setup exists anywhere in the product.

**F — "Monitor my universe."** 🟢 Watchlists + keyword alerts (scopable beyond the watchlist to
all public companies) + Automations that "run whether or not you are logged in" + daily recaps +
push on live-call start. Genuinely strong. *Missing: bulk watchlist import is undocumented;
watchlists appear to be built by following companies one at a time.*

**G — "Understand the regime."** 🔴 Absent. No macro, index, breadth or positioning data.
The only regime read available is *bottom-up* — aggregate what managements are saying across a
sector — which the search + AI chat make possible but which the product does not package.

**EVIDENCE.** https://quartr.com/docs/data-overview.md (Tier 4, 2026-09-02, **verified** SLAs);
/features/summaries, /features/slide-history-comparison, /features/automations,
/features/keyword-alerts, /features/event-calendar, /features/global-search, /use-cases/hedge-funds
(Tier 3, *claimed*).

**INTERPRETATION.** Quartr scores 🟢 on exactly two of seven UCT workflows and 🔴 on two. That is
not a weakness in Quartr; it is the clearest available demonstration that **a product can be
world-class by serving two workflows completely instead of seven partially.**

**RELEVANCE TO UCT.** TERMINAL-NEXT covers most of A/D/E/F/G already and is weakest exactly where
Quartr is strongest (B and the document half of C).

**CONFIDENCE.** 🟡 — workflow steps are assembled from vendor feature descriptions in a plausible
order; the ordering is my reconstruction, not observed. Ceiling: a Pro seat or a recorded demo.

**RECOMMENDATION (hypothesis).** *Wave 2 should reconstruct Workflow B against Quartr in depth,
because it is the only benchmark in the universe whose entire company is that one workflow — and
because UCT's own earnings modal is the surface most likely to be judged against it.*

**OPEN QUESTION.** How much of Workflow B is actually done in the **mobile** app rather than
desktop? (The free app claims live audio, transcripts, AI chat, calendar and alerts — that is
most of the workflow.)

---

## F. Data — coverage, vendors, latency, asset classes, history

**OBSERVATION — the coverage numbers do not agree with each other.**

| Figure | Where |
|---|---|
| 15,200+ companies · 62+ markets | quartr.com homepage |
| 16,000+ companies · 65+ markets | /api, /pro, /mcp, docs introduction |
| 15,000+ companies | /features/ai-chat, /features/live-calls-and-transcripts |
| 40M+ first-party documents | /features/global-search |
| 48M+ first-party documents | homepage |
| 50M+ first-party documents | /pro, /api, /mcp |
| 760+ clients / 800+ clients | homepage / /api, /pro |

**Contractual delivery SLAs (the strongest evidence in this dossier — Tier 4, *verified*):**
- Live content: **"90% streamed and transcribed within 5 seconds of event start"**
- Transcripts: **"Available for 95% of events within 45 minutes after conclusion"**
- Audio recordings: "90% of events within 20 minutes after conclusion"
- Filings/reports: "90% within 15 minutes of public release"
- Slides: "90% of events within 30 minutes of public release"
- Edited transcripts: "within a couple of hours after conclusion"
- Webhooks fire "within seconds"; Snowflake shares refresh **daily**.

**Sourcing.** First-party only — Quartr takes the issuer's own audio, documents and decks. **No
third-party vendor is disclosed anywhere**, and the transcription appears to be in-house: the
changelog records "In-House Transcripts (typeId = 22)" shipping 2025-03-18 with speaker
identification from mid-April 2025.

**Known data limits (verified, from the docs — these are the honest bits marketing omits):**
- **"Transcripts are only available for events conducted in English."** In a 65-market product
  that is a large asterisk.
- Speaker attribution is best-effort: "It's not always possible to identify who is speaking",
  yielding null name/role/company; during high-volume periods attribution "may be prioritized by
  market relevance"; **older transcripts are not retroactively upgraded.**
- Live transcript words can be `[indiscernible]` with confidence scores, and the speaker index
  "can be missing, especially for low-confidence phrases."
- CIK coverage "primarily includes US-listed companies."
- **History depth is never stated.** The backlog dataset docs do not say how far back audio or
  transcripts go, and no page does.

**Asset classes.** Public equities only. No fixed income, FX, commodities, crypto, futures, or
options data of any kind.

**EVIDENCE.** https://quartr.com/docs/data-overview.md · /docs/datasets/earnings-call-transcripts.md
· /docs/datasets/live-earnings-call-transcripts.md · /docs/datasets/companies.md ·
/docs/datasets/company-segments.md · /docs/changelogs/api-updates.md — all Tier 4, 2026-09-02,
*verified*. Coverage figures: Tier 3 pages listed above, *claimed*.

**INTERPRETATION.** The docs are markedly more honest than the marketing, and the gap between them
is the useful finding: **the SLA is a percentile promise with a stated failure rate, while the
homepage is a round number that moves between pages.** A serious integrator should quote the docs
and ignore the homepage. The English-only transcript limit is the single most consequential
constraint and appears on no marketing page I fetched.

**RELEVANCE TO UCT.** Two things. (1) UCT's own doctrine — *measure it, don't quote it*; a
hand-typed count beside the artifact that owns it — is being violated here by a vendor at scale,
which is useful corroboration that the failure mode is universal. (2) The **percentile SLA is a
publishable shape** UCT does not currently use for its own rails (bars freshness, wire push,
breadth collector all have watchdogs but no stated percentile commitment).

**CONFIDENCE.** 🟢 for the SLAs and the documented limits (official developer documentation).
🟡→🔴 for coverage magnitude — the vendor contradicts itself, so no single number should be cited.
🔴 for history depth (unstated anywhere). Ceiling: an API key would settle depth in one query;
the owner could request one via the docs portal, or a sales conversation would answer it.

**RECOMMENDATION (hypothesis).** *Every UCT freshness rail should carry a percentile-and-window
SLA stated in the same words as its alert ("95% of X within N minutes"), so that "is this healthy"
becomes a measurement rather than a judgement — and so a degraded-but-not-dead feed is visible.*

**OPEN QUESTION.** How far back does the archive actually go, and does the English-only transcript
limit apply to the AI chat's answers too (i.e. does a Japanese call simply not exist to the model)?

---

## G. Customization

**OBSERVATION.** Light, by terminal standards, and deliberately so.
- **Watchlists:** multiple, created from the user profile on desktop or mobile; a company "can be
  included in one, several, or all of your watchlists"; used as portfolios, sectors, regions,
  strategies or peer groups. They filter search, filter the calendar, and are addressable in AI
  chat via `@`. **No documented bulk import, no sharing, no stated limit.**
- **Calendar views:** filter by company, watchlist, industry, event type, date range; sync to
  Outlook / Gmail / iCal, with updates propagating when times change.
- **Saved prompts:** AI chat prompts save as **templates with variable placeholders** — the
  closest thing to a saved layout in the product.
- **Automations:** the persistent user-configured object — trigger mode (on publication, with a
  choice of *which* document starts the run: first published, transcript, slides, or report) or
  schedule mode (daily/weekly/monthly).
- **Recap preferences:** daily vs weekly, set under Profile → Newsletters & updates.
- **Cross-device sync:** followed companies, chats and automation results sync desktop ↔ mobile;
  offline capability is claimed on mobile.
- **Layouts / panels / multi-monitor / column configuration: NOT DETERMINED** — no public mention
  of any of it. Given the product's shape (document reading, not grid watching), a workspace
  system may simply not exist.

**EVIDENCE.** /features/watchlists · /features/event-calendar · /features/automations ·
/features/ai-chat · /features/daily-and-weekly-recaps · /pro — Tier 3, 2026-09-02, *claimed*.

**INTERPRETATION.** The unit of customization is **the question, not the screen.** A saved prompt
with placeholders plus a publication trigger is a far more powerful piece of personal
configuration than a saved column set, and it is the one Quartr chose to build.

**RELEVANCE TO UCT.** UCT has heavy screen-level customization already (charts workspace, widget
registry, multi-chart grid, watchlist columns/presets). What it does not have is a *saved question*
object owned by a member.

**CONFIDENCE.** 🟡 (all vendor-described). 🔴 on layouts/multi-monitor. Ceiling: a Pro seat.

**RECOMMENDATION (hypothesis).** *A saved prompt + trigger ("run this when my ticker publishes a
transcript") may be a higher-value personalization primitive for TERMINAL-NEXT than another layout
knob — and UCT already has the scheduler, the LLM cost guard and the delivery channels (in-app
insight, email, Discord) to carry it.*

**OPEN QUESTION.** Are watchlists importable in bulk (CSV/paste), or must a user follow companies
one at a time? For a 300-name universe that is the difference between usable and not.

---

## H. Search / commands

**OBSERVATION.**
- **Global search** spans transcripts, filings and slides at once; quoted phrases force exact
  matching ("to exclude synonyms"); filters by company, watchlist, industry, date range and
  document type; results show **"every relevant mention, with speaker attribution, document type,
  and date"**; clicking opens the exact page with the term highlighted in context. Three scoped
  variants exist alongside it (transcript search, slide search, filings search).
- **Ticker resolution is a documented, honest problem.** The API's company endpoint accepts five
  identifier families — `companyId` (Quartr's own), ticker (as exchange-ticker pairs; a company can
  have several listings), **ISIN** ("globally unique … for cross-system matching"), **CIK**
  ("10-digit zero-padded string", US filers only) and **OpenFIGI** (figi / compositeFigi /
  shareClassFigi). The docs state plainly that querying by ticker returns **"all companies matching
  that symbol … regardless of exchange"** and that you must add `exchanges` to disambiguate. Up to
  100 values per identifier parameter.
- **Command palette / shortcuts: NOT DETERMINED** (see §C).

**EVIDENCE.** https://quartr.com/features/global-search — Tier 3, *claimed*.
https://quartr.com/docs/datasets/companies.md and /docs/rest-api/fetching-data.md — Tier 4,
2026-09-02, ***verified***.

**INTERPRETATION.** Quartr's search is a **document retrieval** engine, not a symbol resolver, and
its identifier model says so out loud: the ticker is treated as an ambiguous *user input*, while
`companyId`/ISIN/FIGI are the machine identities. Every response carries `companyId`.

**RELEVANCE TO UCT.** This lands squarely on UCT's own recorded lesson that *a symbol universe does
not settle a ticker match* (RS/EMA/MA/GAP/PEG are real tickers). Quartr's answer — a first-class
internal id, with ticker demoted to a lookup that explicitly may return several companies — is the
structural version of that lesson.

**CONFIDENCE.** 🟢 on identifiers and resolution semantics (developer docs). 🟡 on the search UI.
🔴 on keyboard/palette.

**RECOMMENDATION (hypothesis).** *TERMINAL-NEXT should carry an internal company id alongside the
ticker on every surface that joins data across sources, and should treat a bare ticker as an
ambiguous query that may legitimately return more than one row — the way Quartr's API does — rather
than as an identity.*

**OPEN QUESTION.** Does the product surface the exchange disambiguation to a human user, or only to
the API?

---

## I. AI — shipped vs marketing

**Shipped (described as live, with dated release evidence):**
- **AI chat** over the whole first-party corpus, with **per-query model choice — "such as Claude,
  GPT, or Gemini"** — answers "sourced exclusively from first-party information", and **"Every
  answer includes direct links to the exact pages used to generate the response"**, opening
  side-by-side with the chat. Supports document upload, table/chart extraction, and saved prompt
  templates with placeholders. Launched on mobile 2025-10-28; 2025 Pro update bundle dated
  2026-01-08.
- **AI summaries** — API-verified: available at document and event level, **three lengths**, with
  **embedded source references**; shipped in the API 2025-06-10; "available minutes after documents
  are published" and updated as further documents land.
- **Chapters** — API-verified, shipped 2025-05-05, hierarchical since 2025-08-20.
- **Automations** — launched 2026-08-24; prompt + trigger; results carry citations and land in
  chat, email, activity feed and mobile push; "run whether or not you are logged in."
- **Quartr MCP** — live in Claude (2026-03-30), Codex (2026-06-02), Perplexity (2026-06-08);
  included with Pro at no extra cost; **explicitly excluded from the free student plan**.
- **AI-estimated report dates** in the calendar ("AI-estimated report dates", per /pro).

**Marketing, or unverifiable:** the framing "AI infrastructure for company research"; "no
hallucination" claims on the MCP page; "unmatched accuracy" on transcripts; "cuts research time
… by 70%" (attributed to Boosted.ai, a customer, not measured by Quartr).

**One flag worth recording.** AI chat can "**optionally sourc[e] wider web results beyond company
documents**." That is a mode switch that silently changes the provenance guarantee the entire
product is sold on. No public page describes how a mixed answer is labelled.

**EVIDENCE.** /features/ai-chat · /features/automations · /features/summaries · /mcp · /newsroom
(Tier 3, *claimed*); /docs/changelogs/api-updates.md · /docs/datasets/chapters.md (Tier 4,
*verified* — these are the dated, shipped facts).

**INTERPRETATION.** Quartr's AI is **retrieval-shaped, not opinion-shaped**: it summarises, cites,
extracts and monitors, and it never renders a view. There is no "should I buy this", no score, no
rating anywhere in the product. Combined with the model-choice feature, the honest reading is that
Quartr sells the *corpus and the citation*, and rents the reasoning from whoever the user prefers.

**RELEVANCE TO UCT.** UCT's Compass/mentor stack is the opposite bet — decisiveness is
*structural* (`grade_ticker`'s computed verdict, the unskippable §11 protocol). Quartr is the
control case for "grounded but never opinionated". Both bets fail differently: Quartr's fails as
*so what*, UCT's fails as *wrong with confidence*.

**CONFIDENCE.** 🟢 that these features are shipped (dated changelogs + newsroom + API docs).
🟡 on behaviour quality — no output was observed. 🔴 on the web-results mixing behaviour.

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT ever lets an answer draw on sources outside its
grounded corpus, the provenance must be visible per sentence, not per session — Quartr's optional
web mode is the anti-pattern to avoid inheriting, and UCT's existing grounding gate (every number
in the prose must appear in the facts) is the right shape to extend rather than relax.*

**OPEN QUESTION.** When web results are mixed in, does the answer distinguish them from first-party
citations — and is the mode sticky?

---

## J. UX — strengths, weaknesses, density, onboarding

**Strengths (claimed, coherent, and corroborated by the data model).**
- **One primitive, five doors** (see §C): the click always lands on the source.
- **No registration friction on live calls** — "Tap to start listening live – no manual
  registrations and no webcast links required." This removes a genuinely awful real-world step
  (IR-site webcast registration) and is probably the original reason the app got adopted.
- **Playback that respects the reader**: variable speed with the transcript staying in sync, and
  automatic reset to 1× when playback catches up to live.
- **Progressive enrichment**: a summary appears from the report, then improves as slides and then
  the transcript arrive — the page gets better while you read it rather than being empty until
  complete.
- **Free mobile app with the core loop intact** (live audio, transcripts, calendar, alerts, AI
  chat), synced with desktop.

**Weaknesses / risks (inferred, 🔴 — none observed).**
- **Density is low by terminal standards.** Everything described is a document reader, a calendar,
  a chat and a list. There is no grid, no multi-pane workspace, no numeric table of any size. A
  desk trader would find it airy; an analyst would not care.
- **No price context anywhere** means the user must leave the product to answer "and what did the
  stock do?" — a guaranteed context switch in the middle of the flagship workflow.
- **Coverage-number inconsistency across the vendor's own pages** is a trust smell for a product
  whose entire pitch is traceability.
- **Onboarding: NOT DETERMINED.** No help centre resolves (`support.quartr.com` → DNS failure).
  The only visible onboarding is a **recurring live webinar programme** — "An introduction to
  Quartr Pro" runs 2026-09-17, 11-10 and 12-15; "Quartr's AI chat" 09-30 and 12-04; plus
  role-specific sessions for IR (10-15), sell-side (10-28) and buy-side (11-26). **A product that
  schedules a monthly introductory webinar is telling you its onboarding is human-assisted**, and
  its API onboarding is explicitly a three-phase sales motion (discovery/scoping → pilot/validation
  → production scaling).

**EVIDENCE.** /features/live-calls-and-transcripts · /features/summaries · /mobile · /webinars ·
/api (Tier 3, 2026-09-02, *claimed*); support.quartr.com DNS failure observed 2026-09-02.

**INTERPRETATION.** Quartr's UX bet is **fewer objects, better transitions**. It has perhaps six
nouns (company, event, document, slide, chapter, watchlist) and spends its design budget on the
verbs between them.

**RELEVANCE TO UCT.** TERMINAL-NEXT will have far more nouns than six. Quartr is the reminder that
the *transitions* — what a click on a number does — are where a product feels intelligent, and
UCT's own recorded failures (a filter family with no view; built, tested, green and unreachable)
are transition failures, not feature failures.

**CONFIDENCE.** 🟡 strengths, 🔴 weaknesses and onboarding. Ceiling: nothing here was seen; a demo
seat, a recorded webinar, or official screenshots would move all of it.

**RECOMMENDATION (hypothesis).** *Count TERMINAL-NEXT's nouns. If the count is large, the design
budget belongs in transitions between them, not in new panes — and a recurring "introduction"
webinar is the smell that says the product did not teach itself.*

**OPEN QUESTION.** How does Quartr Pro handle a user's first session with an empty watchlist? (The
whole product is watchlist-shaped; cold start is where document products usually fail.)

---

## K. Performance (all figures **reported/claimed** by the vendor)

- **Live transcription:** "90% streamed and transcribed within **5 seconds** of event start"
  (contractual SLA, docs — the strongest of these). Marketing states "close to zero delay" and
  "live real-time transcripts in over **97%** of cases".
- **Post-event:** transcripts for 95% of events within 45 minutes; audio for 90% within 20 minutes;
  filings for 90% within 15 minutes; slides for 90% within 30 minutes; edited (speaker-identified)
  transcripts "within a couple of hours".
- **Summaries:** "available minutes after documents are published", updating in real time.
- **API:** default **50 requests/second per key**, tier-dependent, `429` with reset headers on
  exceed; cursor pagination with `limit` default **10**, and an explicit recommendation to poll
  `updatedAfter` with **`limit=500`** for incremental sync; webhooks "within seconds" with retries
  and signed payloads; **Snowflake shares refresh daily** (much coarser than the REST path — a real
  architectural distinction, not a footnote).
- **UI responsiveness: NOT DETERMINED.** No public figure, and nothing was observed.

**EVIDENCE.** /docs/data-overview.md · /docs/rest-api/auth.md · /docs/rest-api/fetching-data.md
(Tier 4, *verified as published commitments*); /features/live-calls-and-transcripts (Tier 3,
*claimed*).

**INTERPRETATION.** Every one of these is a **percentile with a named window** — the vendor states
its own failure rate (10% of live events are *not* transcribed within 5 seconds, and they say so).
That is a materially more honest performance claim than "real-time".

**RELEVANCE TO UCT.** UCT's bars, wire and breadth rails all have watchdogs but state no
percentile commitment; the recorded lesson that *uptime is a deploy signal, not a sleep signal* is
the same problem from the other end. A percentile SLA is a measurable promise a watchdog can grade.

**CONFIDENCE.** 🟡 — published commitments, independently unverified. Ceiling: measuring these
would need an API key and a market-hours harness; the owner could obtain a key or a trial.

**RECOMMENDATION (hypothesis).** *Restate UCT's freshness guarantees as percentile SLAs and have
each watchdog grade against the stated percentile, so "degraded" becomes a state distinct from
"up" and "down".*

**OPEN QUESTION.** Is the 97% live-transcript figure measured over all 65 markets, or only over
English-language calls (which is the only place transcripts exist at all)?

---

## L. Pricing / business model

**OBSERVATION. There is no published price for anything Quartr sells to professionals.**

| Offer | Price | Evidence |
|---|---|---|
| **Mobile app** | **Free** — "completely free to use" | /mobile, Tier 3, 2026-09-02, *claimed* |
| **Quartr Pro** | **Not published.** "Scalable pricing for multi-seat deals"; "Enterprise deal options available"; the only CTA is **Contact sales** / Book demo | /pricing, Tier 3, 2026-09-02, *verified as an absence* |
| **Quartr API** | Not published. "Enterprise & bundle options"; three-phase onboarding via sales | /pricing, /api, Tier 3 |
| **Quartr MCP** | **Included with Quartr Pro at no additional cost**; requires a paid Pro subscription; **not available on student plans** | /mcp, Tier 3, *claimed* |
| **Students & academics** | **Free — 100% of Quartr Pro** for student-run funds, investing clubs and professors | /students, Tier 3, *claimed* |

**Structure.** Per-seat with multi-seat scaling (the wording "multi-seat deals" implies seat-based
with volume tiers, not per-firm), plus an enterprise tier, plus a separate data-feed business
priced by sales conversation, plus bundling between the two ("Enterprise & bundle options").
**No professional/non-professional distinction is mentioned anywhere** — unsurprising, since
Quartr distributes no exchange market data and therefore has no exchange-fee obligation. That
absence is itself informative: an IR-document product escapes the entire pro/non-pro apparatus.

**Corroboration of the absence.** A Google search (2026-09-02, one tab, closed) returned no source
carrying a Quartr Pro price; third-party aggregator pages say "Pricing on request" / "Custom
enterprise pricing", and one MCP directory entry states plainly that "A paid Quartr Pro
subscription is mandatory, and it has no published price." — Tier 10 (general web), *reported*,
used only as corroboration that no price exists publicly.

**INTERPRETATION.** The ladder is: **free app (retail, top of funnel) → free students (future
buyers) → sales-priced Pro (the revenue) → sales-priced API (the growth) → MCP as a free
sweetener that makes Pro stickier inside the buyer's own AI tools.** MCP-included-with-Pro is the
notable move: it converts a subscription into a data source inside Claude/ChatGPT, which is
retention disguised as a feature.

**RELEVANCE TO UCT.** UCT prices publicly and sells to members; contact-sales opacity is the wrong
model for that business. But the **free tier as a real product** (Quartr's free app carries live
audio, transcripts, calendar, alerts *and* AI chat) is a much more generous free tier than UCT's
FREE_PAGES, and it is doing genuine funnel work.

**CONFIDENCE.** 🟢 that no price is published (checked the pricing page directly plus a search).
🔴 on actual contract values. Ceiling: only a sales conversation or a leaked contract would give
numbers, and **I did not and must not initiate one**; the owner could request a quote if the number
matters to the program.

**RECOMMENDATION (hypothesis).** *A free tier that contains a complete workflow (not a crippled
sample) may convert better than a broad-but-shallow one — worth testing against UCT's current
FREE_PAGES split, which is page-shaped rather than workflow-shaped.*

**OPEN QUESTION.** Roughly what does a Pro seat cost, and does the API price on volume, on
datasets, or on redistribution rights? (Redistribution is the question that decides whether UCT
could ever surface Quartr content to members.)

---

## M. Best ideas for UCT (each a hypothesis, with the workflow it serves)

1. **The citation is a door, not a footnote.** Every AI sentence opens its exact source page
   *beside* the answer. → *Hypothesis: TERMINAL-NEXT's AI answers become verifiable-by-click, and
   the same click target serves alerts, search hits and calendar rows.* Serves Workflows B and C;
   extends UCT's existing server-side grounding gates into the UI.
2. **Saved prompt + publication trigger ("Automations").** A prompt saved once, run automatically
   the moment a named artifact publishes, results delivered to feed/email/push and synced. →
   *Hypothesis: a member- or desk-owned "standing question" object is a higher-value
   personalization primitive than another layout knob.* Serves Workflow F. UCT already owns every
   part needed (scheduler, LLM cost guard, insight queue, email/Discord delivery).
3. **The diff is the signal (slide history comparison).** Compare the *same* artifact across
   periods and surface what was added, dropped or reworded. → *Hypothesis: generalise beyond
   slides — diff a company's guidance language, diff a scan definition's result set week over
   week, diff the wire's own segments — because "what changed" is cheaper to compute and easier to
   act on than "what is".* Serves Workflows B and G.
4. **Hierarchical, timestamped chapters with a containment invariant.** `level` 1..n, each child's
   range strictly inside its parent's, served for both audio and transcript. → *Hypothesis: UCT's
   Desk session insights (which already produce chapters from Zoom transcripts) should adopt the
   levelled+contained model rather than a flat list, so a long session becomes navigable at two
   depths.* Serves the Desk workflow directly.
5. **Percentile SLAs as the public shape of freshness.** "95% of events within 45 minutes", with
   the failure rate stated. → *Hypothesis: each UCT rail states a percentile SLA and its watchdog
   grades against it, making "degraded" a distinct state from "up".* Serves every workflow;
   matches UCT's measure-don't-quote doctrine.
6. **Label an estimated date as estimated.** Quartr's calendar carries "AI-estimated report dates"
   as an explicit class. → *Hypothesis: TERMINAL-NEXT's calendar should render confirmed vs
   estimated vs inferred dates as visibly different objects*, which is the honest-uncertainty
   pattern UCT already applies to `implied_move_pct` sparsity.
7. **Alert scope as a first-class toggle: my list *or* the whole market.** Keyword alerts run over
   followed companies **or** all public companies, turning monitoring into discovery. →
   *Hypothesis: UCT's alerting should offer the market-wide scope explicitly*, which is idea
   generation UCT currently gets only from scans. Serves Workflows E and F.
8. **Identifier discipline.** Internal `companyId` on every response; ticker demoted to an
   ambiguous lookup that "returns all companies matching that symbol regardless of exchange";
   ISIN/CIK/FIGI for cross-system joins. → *Hypothesis: adopt an internal company id for every
   cross-source join in TERMINAL-NEXT*; this is the structural form of UCT's own recorded lesson
   that a symbol universe does not settle a ticker match.
9. **Progressive enrichment of a page.** The summary exists minutes after the report, then
   improves as slides and transcript arrive. → *Hypothesis: a UCT earnings page should render its
   best current answer immediately and visibly upgrade itself*, rather than waiting for
   completeness (and never rendering a failure as a fact — UCT's `.catch(() => null)` lesson).
10. **Remove the registration step.** "No manual registrations and no webcast links required" is
    the whole reason retail adopted the app. → *Hypothesis: find TERMINAL-NEXT's equivalent
    friction step — the thing a user currently does outside the product to complete a workflow —
    and absorb it.*

---

## N. Bad ideas for UCT (avoid, with reasons)

1. **Contact-sales-only pricing.** Right for enterprise data, wrong for a member business; it
   makes the product unevaluable and kills self-serve conversion. UCT should keep prices public.
2. **Coverage counts that disagree across your own pages** (15,000 / 15,200 / 16,000 companies;
   40M / 48M / 50M documents; 760 / 800 clients). This is precisely the hand-typed-count-beside-
   the-artifact defect UCT's own codebase keeps paying for. *Anti-pattern: never publish a number
   next to the thing that owns it — derive it or omit it.*
3. **An optional "wider web" mode inside a product sold on first-party grounding**, with no
   documented per-sentence provenance. A mode switch that silently changes the trust contract is
   worse than not offering the mode.
4. **Shipping a dataset then withdrawing it from new customers** (`Segments`, S&P 500 only, now
   "not offered to new partners"). Existing customers keep it; new ones cannot buy it — two
   product surfaces, one name. If UCT retires a data surface, retire it for everyone or keep it
   for everyone.
5. **Watchlists you can only build one company at a time.** No bulk import is documented. UCT's
   watchlists already have CSV import and paste — do not regress toward follow-one-at-a-time.
6. **A research surface with no price context.** For Quartr this is strategy; for UCT it would be
   a second authority on "what happened" living next to the tape. Any TERMINAL-NEXT document
   surface must sit beside the price, not instead of it.
7. **Human-assisted onboarding as the plan.** A monthly "An introduction to Quartr Pro" webinar is
   a confession that the product does not teach itself. UCT's members will not attend a webinar.
8. **Full free access for a whole class of users (students).** Correct for Quartr's funnel;
   directly against UCT's own standing constraint that member/population traffic must not ride the
   owner's seat or an uncapped lane. A giveaway tier needs its own budget or it is a cost leak.
9. **English-only transcription presented as 65-market coverage.** The limit is real, documented,
   and appears on no marketing page. *Anti-pattern: a coverage number whose caveat lives only in
   the developer docs.*

---

## O. Screenshots / evidence links (never reproduced here)

Pages carrying official product imagery (not reproduced; open them directly):
- Product surfaces: https://quartr.com/pro · https://quartr.com/mobile · https://quartr.com/mcp
- Feature pages, each with its own product imagery: https://quartr.com/features and its children
  `/features/ai-chat`, `/features/automations`, `/features/global-search`,
  `/features/live-calls-and-transcripts`, `/features/summaries`,
  `/features/slide-history-comparison`, `/features/keyword-alerts`, `/features/watchlists`,
  `/features/event-calendar`, `/features/export`, `/features/daily-and-weekly-recaps`
- Public, login-free content surfaces (the closest thing to seeing real output):
  **https://quartr.com/events** — real event summary cards with company, ticker, event label and a
  headline read; **https://quartr.com/companies** — the public company directory (paginated, 161
  pages at fetch time).
- Developer-portal imagery + the API console: https://quartr.com/docs/ · portal at
  `https://portal.quartr.dev` (login-gated; not accessed) · OpenAPI spec at
  `https://api.quartr.com/public/v3/openapi.json`
- **Demo / walkthrough recordings: none found.** https://quartr.com/webinars lists only *upcoming*
  live sessions (2026-09-02 through 2026-12-15) with no archive and no transcripts. No official
  demo video transcript was reachable, so **no claim in this dossier is sourced from a video**.

---

## P. Confidence per section + ceiling

| § | Confidence | Ceiling / what would raise it |
|---|---|---|
| A Executive summary | 🟢 | — |
| B Personas | 🟢 named segments · 🔴 actual usage | practitioner interviews; none reachable |
| C Navigation | 🟡 flows · 🔴 keyboard/palette | a Pro seat, an official screenshot set, or a recorded walkthrough |
| D Capability map | 🟢 present · 🟡 absent | absences argued from the vendor's own exhaustive feature list + API dataset index |
| E Workflows | 🟡 | step ordering is my reconstruction; Wave 2 should redo B against a live seat |
| F Data | 🟢 SLAs & documented limits · 🟡→🔴 coverage magnitude · 🔴 history depth | an API key (owner could request one via the docs portal) |
| G Customization | 🟡 · 🔴 layouts | a Pro seat |
| H Search / identifiers | 🟢 identifiers (docs) · 🟡 search UI · 🔴 shortcuts | a Pro seat |
| I AI | 🟢 shipped-ness (dated changelogs) · 🟡 quality · 🔴 web-mixing behaviour | a Pro seat; MCP access requires a paid subscription |
| J UX | 🟡 strengths · 🔴 weaknesses, onboarding, density | nothing was observed; `support.quartr.com` does not resolve |
| K Performance | 🟡 (published commitments, unverified) | an API key + a market-hours measurement harness |
| L Pricing | 🟢 that nothing is published · 🔴 actual numbers | a sales quote — **owner-only**; agents must not initiate |
| M / N Ideas | 🟡 (hypotheses, deliberately) | — |
| O Evidence | 🟢 for links · 🔴 no demo recording exists publicly | an official walkthrough recording |

**Overall: 🟡.** The document/data layer is documented to a high standard and is 🟢; the *product
interior* — every screen, every interaction, every keystroke — is 🔴 and was reconstructed from
marketing copy. **The single highest-value ceiling-breaker is a Quartr Pro demo seat**, which
Quartr offers via "Book demo" on every page. That is an owner action (it involves a form and an
identity) and is explicitly outside an agent's permitted actions.

---

## What Quartr would look like with UCT's proprietary intelligence (Part XXVI) — 🟡

Quartr today can tell you, with a citation, exactly what a management team said and how that
language has drifted over eight quarters — and then it stops, because it holds no price, no
positioning and no view. Give it UCT's proprietary layer and the citation stops being the end of
the sentence: the same event page would open with the regime read and the UCT exposure score
framing whether *any* of this is actionable today, the slide-history diff would be scored against
the firm's own setup templates and the member's personal per-setup expectancy rather than left as
a neutral observation, the keyword alert that fires when a CEO says "destocking" would arrive
already joined to that name's dealer positioning, dark-pool prints and options flow in the hour
around the sentence, and the AI chat's answer would end where Compass begins — a regime-first,
tool-sourced GO/HOLD/SKIP with an entry, a stop and a size, every number traceable the way Quartr
already traces every quote. The corpus would stop being a research archive and become the
*catalyst half* of a trade decision whose other half UCT already owns: Quartr knows what was said,
UCT knows what the tape did about it and what this desk has historically done with that
combination. The honest caveat is that this fusion inherits both failure modes at once — Quartr's
"grounded but so what" and UCT's "decisive and occasionally wrong" — so the merged surface would
need the provenance line to state, per sentence, whether it is quoting an issuer, measuring the
tape, or rendering a UCT opinion.

---

## GAPS (budget and channel)

- **`WebSearch` was not used** — the program preamble records the shared per-session cap as
  exhausted (200/200). Channel actually used: **WebFetch on known URLs** for 39 of 42 sources
  (quartr.com, its feature pages, and `quartr.com/docs/**`, which self-publishes an
  `llms.txt` index that made exhaustive doc coverage cheap), plus **one browser tab** for two
  Google queries, closed immediately afterwards.
- **WebFetch-on-Bing failed badly and should not be retried by later roles.** Two queries
  (`"Quartr Pro" pricing…`, `"Quartr" app store…`) returned wholly unrelated results — adult-site
  and foreign-language listings with zero relevance to the query. Bing via WebFetch appears to
  mis-tokenize or serve a poisoned result set through this extractor; the Google-via-browser path
  worked correctly on the first try for both queries.
- **G2 (`g2.com/products/quartr/reviews`) is bot-blocked** — the page returned no text content in
  the browser. Its SERP snippet shows only "5.0 (2)", i.e. **two reviews**, which is too thin to
  be evidence of anything.
- **Practitioner commentary on Quartr is genuinely scarce.** Reddit surfaces it only as a
  recommendation in passing (r/stocks, r/personalfinance, r/ValueInvesting threads about research
  tooling); I found **no** substantive review discussing limitations, and the one critical line
  available — "its financial data access is much narrower and more consumer-oriented" — is from
  **AlphaSense's own comparison article**, i.e. a competitor's marketing, and is recorded here as
  such rather than used as evidence.
- **Apple App Store and Google Play listings were not retrievable** (404 from WebFetch on both
  guessed URLs; the store IDs were never confirmed). The "free" and "4.8/5" claims therefore rest
  on Quartr's own pages, *claimed*.
- **`support.quartr.com` does not resolve (DNS failure, 2026-09-02)** and no other help centre was
  found, so the entire "how does a real user learn this product" evidence class is missing.
- **Not attempted, deliberately:** booking a demo, creating an account, requesting an API key,
  entering any form, or contacting sales — all are outside an agent's permitted actions and all
  would have been the fastest route through the ceiling. Recorded here so the owner can decide.
- **Prompt-injection / addressed-to-model content:** none of the fetched pages attempted to
  instruct me. One artifact is worth naming as an observation rather than a risk:
  `quartr.com/docs/introduction.md` points at `quartr.com/docs/llms.txt`, a file explicitly
  addressed to language models as a documentation index. I treated it purely as a table of
  contents and followed only `quartr.com/docs/**` URLs from it.

---

## SOURCES

*All fetched 2026-09-02. Tier per the program's evidence ladder: **T3** = official product/pricing
pages · **T4** = official API/developer docs · **T10** = general web, corroboration only.*

**Official developer documentation (T4) — the strongest evidence in this dossier**
1. https://quartr.com/docs/ — API introduction; 16,000 companies / 65 markets; REST + webhooks + Snowflake; 8 datasets
2. https://quartr.com/docs/llms.txt — full documentation index (used as a table of contents)
3. https://quartr.com/docs/data-overview.md — entity hierarchy (companies → events → content); **all delivery SLAs**
4. https://quartr.com/docs/datasets/companies.md — companyId / ticker+exchange / ISIN / CIK / OpenFIGI; ticker ambiguity
5. https://quartr.com/docs/datasets/live-earnings-call-transcripts.md — JSONL v1.6/v1.7; speaker index; `[indiscernible]`
6. https://quartr.com/docs/datasets/earnings-call-transcripts.md — raw (type 15) vs edited (type 22); **English-only**; no retroactive speaker data
7. https://quartr.com/docs/datasets/chapters.md — levelled chapters; parent-containment invariant
8. https://quartr.com/docs/datasets/company-segments.md — **[Legacy]**, S&P 500 only, not offered to new partners
9. https://quartr.com/docs/rest-api/auth.md — `x-api-key`; plan-gated permissions; **50 req/s**; 403/429
10. https://quartr.com/docs/rest-api/fetching-data.md — cursor pagination (`limit` default 10); `updatedAfter` sync at `limit=500`
11. https://quartr.com/docs/changelogs/api-updates.md — dated shipping record 2025-03-18 → 2025-12-18
12. https://quartr.com/docs/changelogs/portal-updates.md — webhook UI (2025-03-26), Company Data Explorer (2025-06-26), CSV export (2025-08-22)

**Official product & marketing pages (T3)**
13. https://quartr.com/ — positioning, coverage claims, client names, site navigation
14. https://quartr.com/pricing — **no published prices**; "multi-seat deals"; Contact sales
15. https://quartr.com/pro — Pro feature set; "4 of 5 largest hedge funds"; AI-estimated report dates
16. https://quartr.com/api — 7 datasets; "no middleware"; 3-phase onboarding
17. https://quartr.com/mcp — MCP clients; included with Pro; **excluded from student plans**
18. https://quartr.com/mobile — **free**; live audio, transcripts, AI chat, calendar sync, alerts
19. https://quartr.com/features — the canonical feature inventory (15 features, 3 groups)
20. https://quartr.com/features/ai-chat — citations open side-by-side; **model choice (Claude/GPT/Gemini)**; optional web results
21. https://quartr.com/features/automations — trigger vs schedule mode; document-choice trigger; runs logged-out
22. https://quartr.com/features/global-search — 40M+ documents; exact-phrase quoting; speaker attribution in results
23. https://quartr.com/features/live-calls-and-transcripts — no registration; variable speed; "over 97%"
24. https://quartr.com/features/summaries — minutes after publication; per-line source links; progressive enrichment
25. https://quartr.com/features/slide-history-comparison — quarter/year comparison; inflection points
26. https://quartr.com/features/keyword-alerts — followed **or all** public companies; jump to the sentence
27. https://quartr.com/features/watchlists — multiple lists; `@` mentions in chat; filters search + calendar
28. https://quartr.com/features/event-calendar — filters; Outlook/Gmail/iCal sync; calendar → event page
29. https://quartr.com/features/export — PDF chat sessions; Excel tables/charts; traceability retained
30. https://quartr.com/features/daily-and-weekly-recaps — Profile → Newsletters & updates
31. https://quartr.com/integrations — Claude, ChatGPT Codex, **Snowflake**
32. https://quartr.com/customers — GAM, Boosted.ai, Ciena, Janus Henderson, Perplexity, SEB, Nordea, PUMA, Public, Toss, NAVER…
33. https://quartr.com/use-cases/hedge-funds — the buy-side workflow narrative
34. https://quartr.com/use-cases/investor-relations — the IR-team workflow; Shopify, H&M, Ciena
35. https://quartr.com/students — **Quartr Pro free** for student funds, clubs, professors
36. https://quartr.com/newsroom — dated milestones incl. **$18M (2026-07-27)**, Automations (2026-08-24), MCP launches
37. https://quartr.com/webinars — the recurring onboarding webinar programme (Sep–Dec 2026)
38. https://quartr.com/events — public event-summary cards (login-free)
39. https://quartr.com/companies — public company directory, 161 pages (login-free)

**Secondary / corroboration only (T10 — general web)**
40. Google SERP, `"Quartr Pro" price OR pricing cost per seat subscription`, read in one browser tab and closed — corroborates that **no price is published anywhere**; surfaces third-party pages stating "Pricing on request" and "no published price".
41. Google SERP, `quartr reddit review … limitations OR downside OR missing` — establishes that **substantive practitioner criticism does not exist publicly**; Quartr appears only as a passing recommendation in r/stocks / r/personalfinance / r/ValueInvesting tooling threads.
42. AlphaSense product article (via SERP snippet, 2026-06-28) — "**Quartr for live earnings call transcripts.** Still, its financial data access is much narrower and more consumer-oriented…" — recorded as **a direct competitor's marketing**, not as an assessment.
