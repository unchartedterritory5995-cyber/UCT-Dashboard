---
id: B-BBG-07
title: Bloomberg Terminal — collaboration, export, and API
role: Bloomberg workflow slice 7 (collaboration, export, API)
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — IB/MSG chat, NOTE, screenshots/print, Excel add-in, BLPAPI/SAPI/B-PIPE/Data License, Terminal Connect/App Portal, mobile (BBA), and the licensing posture governing what data may leave the Terminal
confidence: 🟡 overall
evidence_ceiling: "Terminal help (HELP DAPI/BQLX/IB) and the paid Terminal subscription agreement are behind the Terminal itself and are not public. Only the TRIAL licence terms are published, so all redistribution rules below are read off a trial contract, not the commercial one. Download-limit numbers are deliberately unpublished by Bloomberg. Practitioner accounts of IB in daily use were not reachable (the session's web-search budget was exhausted before Reddit/WSO could be queried), so 'why IB is sticky' is inferred from Bloomberg's own copy plus one 2013 statistic I could only read as a search snippet."
sources: 13 primary; 13 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-07 — Bloomberg Terminal: collaboration, export, and API

**Scope note.** This file covers one workflow slice: how content and data get *out of* one user's Terminal
and *into* another person, another application, a spreadsheet, or a server — and what Bloomberg permits and
polices at that boundary. Sibling roles cover search/navigation, workspaces, news/alerts, earnings,
fundamentals, screening/charting, and the "why they stay" synthesis.

**Reading conventions.** Every claim below carries a source number `[n]` resolving to the SOURCES list, a
tier label, and an evidence class: **verified** (read in a primary document myself) · **demonstrated** (seen
in an official video/demo transcript) · **claimed** (Bloomberg marketing) · **reported** (practitioner or
third party) · **speculated** (my inference, labelled as such). Benchmarks are learning, not specification:
nothing here means UCT should build it.

---

## Topic 1 — Instant Bloomberg (IB): chat as the workflow spine

**OBSERVATION.** IB is not a chat app bolted onto a data terminal; Bloomberg positions it as the centre of
the product. It is a multi-window chat tool with persistent rooms, tabs and folders, a "blast" send to many
recipients at once, in-chat search (Ctrl+F), @mentions and emoji reactions — i.e. the ordinary furniture of a
modern chat client — but with three things ordinary chat does not have: (a) **structured data links** that
turn a mentioned instrument into a clickable route back into Terminal functions, so a recipient can respond
in one click; (b) **natural-language capture of "security details, metadata and intent"** out of free chat
text; and (c) **surveillance built into the same product**, marketed as "customizable surveillance and
security" with real-time preventative controls [1].

Bloomberg's own collaboration hub describes IB as letting a user "Chat live and easily send screenshots,
data, news and more to colleagues, clients and the broader financial community", and names **IB Forums** —
"Community-based chats" — as a separate, discovery-oriented surface alongside 1:1 and room chat [2].

The messaging family around IB is older and wider than IB itself. Bloomberg's own function guide lists a
message *system* home page `MSGM<GO>` that fronts: `MSG<GO>` (incoming messages), `MSG9<GO>` (greeting,
copy-to-another-user, notification alerts, spam levels), `IB<GO>` ("a multi-window chat communication tool
within the BLOOMBERG PROFESSIONAL service"), `SPDL<GO>` (speed-dial list doubling as an address book),
`BMAIL<GO>` (email compliance information) and `PFM<GO>` (file folders, and sending files through the
Bloomberg message system) [3]. MSG reaches outside the network: university guidance states MSG "will also
send email to other provider accounts" [4].

**EVIDENCE.**
- [1] `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/instant-bloomberg` — official product page, fetched 2026-09-02 — **claimed** (feature list) / **verified** (that Bloomberg says it).
- [2] `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/` — official product page, fetched 2026-09-02 — **claimed**.
- [3] `data.bloomberglp.com/professional/sites/4/2015/03/basic_tech_functions.pdf` "Basic Bloomberg Tech Functions" — official Bloomberg function guide (2015), text extracted 2026-09-02 — **verified**.
- [4] McGill Library Bloomberg guide — university library guide, fetched 2026-09-02 — **reported**.

**INTERPRETATION.** The design decision worth naming is that IB is a **transport for objects, not for text**.
A ticker in a chat line is a live handle; a chart can be sent as a screenshot *from the actions menu, on the
fly* [1]; and the compliance layer is in the same product rather than a bolt-on. That is what makes chat the
place work happens rather than the place work is discussed. The corollary — and it is the whole moat — is
that this only pays off when the counterparty is on the same network.

**RELEVANCE TO UCT.** UCT already owns a community network (Discord) and does not need to build one. What
maps is the *object* idea: today UCT's Discord surfaces (`/buzz`, `/chart`, the index-close post, the desk
announcements) push **rendered images and prose**. The IB idiom is to push a *handle* — a ticker, a level, a
saved scan — that the recipient can click back into the workstation. For the desk persona (a handful of
traders sharing a call intraday) this is the difference between "here's a screenshot of my setup" and "open
my setup". For the member persona it is a re-entry path from Discord back into TERMINAL-NEXT.

**CONFIDENCE.** 🟢 for what IB *is* and what Bloomberg says it does (two official pages plus an official
function guide agree). 🔴 for **how it actually feels in a trader's day** — I could not reach a single
first-hand practitioner account before the search budget ran out. Ceiling: a Reddit/WSO/Bloomberg-user
interview, or a recorded "day on the Terminal" transcript, would raise this. The owner could plausibly supply
it from anyone in his network with Terminal access.

**RECOMMENDATION (hypothesis).** *If a shared artefact carries a machine-readable handle rather than a
picture, the receiving surface can act on it, and collaboration stops being a screenshot graveyard.* Testable
cheaply: one Discord message format that embeds a deep link into TERMINAL-NEXT state.

**OPEN QUESTION.** Does IB's "structured data link" survive a copy-paste out of Bloomberg, or is it only live
inside the network? That determines whether the idea is "shareable object" or "walled-garden object".

---

## Topic 2 — The network effect, and how large it actually is

**OBSERVATION.** Bloomberg quantifies the network on its own collaboration page: the Terminal "gives you
immediate membership to a community of more than 350,000 of the world's most influential decision makers" [2].
Its App Portal partner brochure (2022) uses a different number for the same population — "a client base of
more than 325K Terminal users" [5]. A 2013 Bloomberg press release is widely quoted as saying IB then had
315,000 users exchanging more than 200 million email messages and about 20 million chats per day; I could
**not** open that page (bloomberg.com returned 403) and read it only as a search-engine summary [6].

**EVIDENCE.**
- [2] official product page, 2026-09-02 — **claimed**, current.
- [5] `assets.bbhub.io/professional/sites/10/App-Portal-Introductory-Guide.pdf` — official Bloomberg partner brochure, ©2022, text extracted 2026-09-02 — **claimed**, historical (2022).
- [6] Bloomberg press release "An Innovation for Instant Bloomberg" (2013), page inaccessible (HTTP 403); figures read from a search-result summary only — **reported**, historical, low reliability.

**INTERPRETATION.** The two official numbers (325K in 2022 marketing, 350K+ in 2026 marketing) are marketing
counts, not audited subscriber counts, and they are for *Terminal users*, not IB users. The daily-volume
figure is the interesting one — chats-per-day is the metric that shows the network is *load-bearing* rather
than merely large — and it is exactly the figure I could not verify. Treat 200M/20M as folklore until someone
opens the primary.

**RELEVANCE TO UCT.** This is the part of Bloomberg that is **explicitly not copyable** and should be named
as such in synthesis so no one budgets for it. UCT's honest analogue is a few hundred members and one small
desk; the value has to come from depth of integration inside one user's day, not from who else is reachable.

**CONFIDENCE.** 🟡 on the size (two official but inconsistent marketing numbers). 🔴 on the activity volume.
Ceiling: Bloomberg does not publish audited subscriber counts; no accessible source will fix this.

**RECOMMENDATION (anti-pattern).** *Do not benchmark a collaboration feature against IB's stickiness.* IB's
stickiness is a population property. A feature copied from it lands in a room with a hundredth of the
population and reads as an empty chat app.

**OPEN QUESTION.** What fraction of IB traffic is intra-firm (colleagues) versus cross-firm (counterparties)?
Only the cross-firm half is a true network effect; the intra-firm half is a feature UCT's desk could match.

---

## Topic 3 — NOTE: capture, tag, publish

**OBSERVATION.** `NOTE` is Bloomberg's in-Terminal note-taking and internal-publishing surface. Bloomberg
describes it as "Jot it down, tag it, and publish (or save for internal collaboration)" [2]. Secondary
guidance adds the mechanics: notes can be tagged "based on securities, people, sectors, regions, or custom
themes for ease of discovery"; a user can create a **community** and "share notes between colleagues and
assign permissions for viewing or editing"; notes can contain images, tables, hyperlinks and attachments; and
"All notes are saved to the user's account, meaning they can access them from any Bloomberg Terminal" [4].
There is also a browser extension, "Bloomberg Terminal: Clip to NOTE", indicating a supported path for
capturing *web* content into a Terminal note [7].

**EVIDENCE.**
- [2] official product page, 2026-09-02 — **claimed**.
- [4] McGill Library Bloomberg guide — university library guide, 2026-09-02 — **reported**.
- [7] Chrome Web Store listing "Bloomberg Terminal: Clip to NOTE" — official Bloomberg-published extension, seen in search index 2026-09-02 (listing not opened) — **reported**.

**INTERPRETATION.** Three properties matter and they are all structural rather than cosmetic: notes are
**account-bound, not machine-bound** (portable across Terminals); **tag-anchored to securities** (so a note
is discoverable from the instrument, not only from a notes list); and **permissioned per community** (view vs
edit), which makes "internal research" a first-class object rather than an email.

**RELEVANCE TO UCT.** This maps almost one-for-one onto UCT's Journal 2.0 **Notebook** (long-form notes,
folders + tags, optional ticker, hero image) and the note-connector work. The gap worth noting is direction of
travel: UCT's notebook is reachable *from the notebook*; Bloomberg's NOTE is reachable *from the security*.
For a desk, "show me every note I have ever written about NVDA, on NVDA's page" is a different product from
"search my notes for NVDA". UCT already has the tag (`optional ticker`) that would make this a read-side
change rather than a schema change.

**CONFIDENCE.** 🟡. The Bloomberg product page confirms the shape in one sentence; the mechanics
(communities, permissions, account-bound storage) come from a single university guide and I could not open
Bloomberg's own NOTE press release (403). Ceiling: `HELP NOTE <GO>` inside a Terminal, or the Bloomberg press
release, both currently unreachable.

**RECOMMENDATION (hypothesis).** *A note anchored to a security and surfaced on that security's page turns a
journal into an institutional memory; a note filed in a folder stays a diary.*

**OPEN QUESTION.** Does NOTE feed the same research-management/search index as third-party research (`RSCH`),
i.e. does an internal note rank beside a sell-side PDF in one search? If yes, that is the real design point,
and it is closer to UCT's AI-search layer than to its notebook.

---

## Topic 4 — Screenshots, printing, and the export menu (the low-tech egress paths)

**OBSERVATION.** The Terminal's built-in "get this off my screen" paths are narrow and explicitly incomplete:

- **`GRAB <GO>`** — screen capture. University guides converge on the same wording: "To save a screen go to
  Export, click on Grab Screen. Not all screens can be saved. You can also type GRAB <GO>" [8][9], and GRAB
  emails the capture to the user, historically as a GIF [8]. Multiple guides independently note that **not
  all screens can be grabbed** [8][9].
- **Export to Excel** — "This exporting capability is limited to certain data elements within Bloomberg. Not
  all data can be exported. When this function is available it will be listed under OPTIONS not export!" [9].
  So the export affordance is not even in a consistent place in the UI.
- **Copy-drag** — dragging across a Terminal table copies it without Ctrl+C, then needs Excel's
  Text-to-Columns "Fixed width" to become tabular again [8][9]. That is a 2005-era clipboard contract.
- **Green `PRINT` key** — "prints only the screen you are currently on, unless you type in the # of pages to
  print first" [8][9].
- **`DOCS <GO>`** — "provides the user access to online Bloomberg documents which may be downloaded using
  Adobe Acrobat or Excel" [3]. This is the one path Bloomberg documents as producing a *file*.

**EVIDENCE.**
- [8] Boston College Bloomberg exporting guide — university library guide, fetched 2026-09-02 — **reported**.
- [9] University of Utah Bloomberg exporting guide — university library guide, fetched 2026-09-02 — **reported**.
- [3] official Bloomberg function guide (2015) — **verified**.

**INTERPRETATION.** The picture is coherent once you stop reading it as neglect: **Bloomberg does not want the
screen to be a general-purpose export surface.** Screenshots are permitted (and are the sanctioned way to
share a view, including into IB [1]); structured data export is deliberately per-function, inconsistent, and
in several places absent. Screenshots are also, per one guide, the way students capture data *without*
consuming the download budget [10] — i.e. a picture is free, a number is metered. That is a policy expressed
as a UI.

**RELEVANCE TO UCT.** Directly inverted for UCT: UCT's members *should* be able to take their data with them,
and TERMINAL-NEXT has no per-datapoint metering pressure. But two mechanics transfer. First, **share-as-image
is the universal fallback and deserves to be first-class** — UCT already renders charts server-side for
Discord, and "grab this panel as an image, addressed to a person" is a cheap, high-use verb. Second, the
Bloomberg failure to note is that the export control lives in a *different menu on different screens*
("under OPTIONS not export"). A single, always-present, always-in-the-same-place export verb is a low-cost
differentiator.

**CONFIDENCE.** 🟢 that these are the mechanisms (four independent university guides plus Bloomberg's own
function guide agree, and they agree in the same words, which is itself weak evidence that they descend from
one Bloomberg handout). 🟡 on current behaviour: several of these guides are undated or old, and the GIF
detail in particular may have changed.

**RECOMMENDATION (anti-pattern).** *An export affordance that lives in a different menu depending on the
screen teaches users that export is unreliable, and they fall back to screenshots forever.*

**OPEN QUESTION.** Does GRAB now produce PNG and post directly into an IB chat, or still email a GIF? The
sources are old and this is the single most-used collaboration verb on the Terminal.

---

## Topic 5 — The Excel add-in: BDP / BDH / BDS / BEQS, wizards, and BQL

**OBSERVATION.** The Excel add-in is Bloomberg's real export product, and it is a *formula language*, not a
download button. From Bloomberg's own Excel Add-in Desktop Guide [11]:

- **Security syntax** is a grammar: `<Name>[Exchange][Coupon][Maturity]<Yellow Key>[Type]`, where only Name
  and Yellow Key are mandatory — `IBM US Equity`, `CT10 Govt`, `SPX Index`, `CLZ7 Comdty`.
- **`=BDP(security, field)`** — one security, one field, one cell. Optional `UpdFreq` sets streaming tick
  frequency in milliseconds: "The default is 300 milliseconds", values in increments of 100, minimum 300.
- **`=BDH(security, field(s), start date, end date, opt arg 1, opt arg 2)`** — history; dates may be relative
  (`-6CQ`); a blank end date means "to today".
- **`=BDS(security, field, opt arg 1, opt arg 2)`** — multi-cell bulk/descriptive data.
- **`=BEQS(screen name, ...)`** — runs a **saved `EQS` screen** from the Terminal inside Excel, with
  `ScreenType=C` for Bloomberg screens vs `B` for user screens, and an optional `Group=`. Returns
  `#N/A Invalid Screen Name` if the screen is gone.
- **Wizards** wrap all of it: Import Data wizard (real-time snapshot / end-of-day history / intraday bars /
  intraday ticks), Fundamentals Analysis wizard, Field Search, Function Builder, Spreadsheet Builder,
  Template Library, Populate Table, Formula Conversion Tool, Scenario Builder, Smart Tags.
- Crucially, the security-list step can **load lists the user already built in the Terminal**: Launchpad
  monitor (`BLP`), `NW` monitor, portfolios (`PLST`), security lists (`LIST`), equity screens (`EQS`),
  execution management (`EMS`) [11].

**BQL** is the newer layer. Bloomberg has added BQL functions to the Excel add-in — `BQL`, `BQL.Query`,
`BQL.Dates`, `BQL.Params`, `BQL.Expr` [12] — and a **BQL Builder** now sits in the Bloomberg ribbon beside
Spreadsheet Builder and Function Builder [13]. Its point is where the computation happens: BQL is "a new,
more powerful API based on normalized, curated, point-in-time data that allows you to perform aggregation,
screening, calculations, and other analysis on Bloomberg's servers" [14], so "you only download the data you
need" and are "much less likely" to hit the download limits [14][10]. Official documentation lives at
`HELP BQLX <GO>` and `DAPI <GO>` — both inside the Terminal [10][13].

**Provenance is a first-class feature here.** The guide documents a **Data Transparency** tool alongside the
Fundamentals wizard: it "enables you to view the value look-up and the composite numbers that make up the
value", with drill-down through multiple levels, colour-coded — green means a composite you can drill into,
blue means a **source document**, and clicking it launches the report [11].

**EVIDENCE.**
- [11] `wu.ac.at/.../bloomberg_excel_desktopguide.pdf` — **Bloomberg's own** "Excel Add-in Desktop Guide", hosted by WU Vienna; text extracted 2026-09-02 — **verified** (official manual; undated in the extracted text, so treat version as unknown).
- [12] FinTools "BQL for Excel" — practitioner/vendor page, fetched 2026-09-02 — **reported** (function *names* only; no per-function description).
- [13] Penn Libraries "API/Excel" Bloomberg guide — university library guide, fetched 2026-09-02 — **reported**.
- [14] NYU Libraries Bloomberg BQL guide — university library guide, fetched 2026-09-02 — **reported**.
- [10] Emory Libraries "Bloomberg Monthly Data Download Limits" PDF — university library guide, text extracted 2026-09-02 — **reported**.

**INTERPRETATION.** Three things are load-bearing and all three are about *continuity*, not about Excel:

1. **The spreadsheet inherits the Terminal's state.** A saved screen (`BEQS`), a Launchpad monitor, a
   portfolio — the work a user already did in the workstation is addressable by name from outside it. The
   export surface is not a separate universe; it is a *second view of the same objects*.
2. **The expensive computation moved server-side (BQL) and the client became a query.** This is framed as a
   cost/limit story, but the design consequence is bigger: the client is no longer where correctness lives.
3. **Data Transparency answers "where did this number come from" with a click, down to the source document.**
   That is the strongest single idea in this whole slice.

**RELEVANCE TO UCT.** (1) maps to UCT's saved screens / watchlists / `charts_workspace_layout` — TERMINAL-NEXT
should treat "a thing the user saved" as an addressable name that other surfaces (an export, a Discord post,
a voice command, an API call) can reference, rather than something reachable only by clicking it. (3) is the
one UCT should take most seriously: UCT's own memory already encodes "groundedness = a named FIELD PATH", and
the `CoverageLine` idiom (evaluated · answered · dropped · not computable) is the same instinct applied to a
result set. Data Transparency is that instinct applied to a *single number*, with the source document one
click away. (2) is a warning as much as a lesson: UCT's analogue of "compute server-side to avoid the meter"
is "compute server-side to avoid the vendor bill", and UCT already has that shape in its cache tiers.

**CONFIDENCE.** 🟢 on BDP/BDH/BDS/BEQS syntax, wizards and Data Transparency (read verbatim in Bloomberg's own
manual). 🟡 on BQL (no Bloomberg-published BQL page was reachable; the five function names come from a vendor
page and the behaviour from two university guides that agree). Ceiling: `HELP BQLX <GO>` is Terminal-only.

**RECOMMENDATION (hypothesis).** *If every number a workstation shows can be drilled to the composite values
and the source document behind it, users stop building a private shadow spreadsheet to check it.* That is a
retention mechanic disguised as a provenance feature.

**OPEN QUESTION.** Does Data Transparency exist on the Terminal side (in `FA`), or only in the Excel wizard?
If only in Excel, then Bloomberg's answer to "prove this number" lives *outside* the terminal — which would be
a notable admission and would change the recommendation above.

---

## Topic 6 — Download limits: the meter, and the deliberate absence of a gauge

**OBSERVATION.** Every path out of the Terminal into Excel is metered, and this is the single most-documented
frustration in the entire university-guide corpus. What the sources agree on:

- Limits attach to **the terminal, not the account**: "Limits are associated with each terminal, not your
  personal account, and cannot be reset" [10]; corroborated: "the monthly data limit is tied to individual
  terminal and not individual account ID" [15].
- Enforcement is **hard and non-negotiable**: limits are "controlled and strictly enforced by Bloomberg, and
  its staff will not reset the limit under any circumstances" [10].
- The user finds out **by failing**: "There is no way of knowing whether the monthly data limit has been
  reached until it has been exceeded" [10]; UIBK says the same [16].
- The error surface is a cell value — `#N/A Limit`, and per Penn also `#N/A Dly Lmt` / `#N/A Mth Lmt` for the
  daily/monthly cases and `#N/A Authorization` for entitlement failures [13][10][15][16].
- On the API side the same condition is a typed error: Bloomberg's developer guide documents `//blp/refdata`
  `ResponseError` categories `LIMIT` with sub-categories `DAILY_LIMIT_REACHED`, `MONTHLY_LIMIT_REACHED`,
  `MANUALLY_DISABLED`, `FREE_TRIAL_TERM_LIMIT_REACHED` [17].

**And here is the finding that governs everything else:** Bloomberg **does not publish the numbers**. Emory
states it flatly: "Bloomberg does not state what the explicit limits are, and there is no programmatic way of
finding out what the limits are or what proportion of your limits you have used" [10]. Consistent with that,
the secondary numbers in circulation **contradict each other**: UIBK reports Bloomberg "does not recommend
more than 2500 unique identifiers per month" [16]; other library sources circulate 5,000–7,000 unique
identifiers/month and 500,000 hits/day (I saw these only in search summaries and did not verify them). The
**one** number I found corroborated in a fetched source is the real-time cap: Penn states a "maximum of 3,500
concurrent real-time security subscriptions/hits across all open tables" [13].

The **API request-shape limits** are published, and are a different thing entirely: per Bloomberg's developer
guide, "400 fields for reference data request and 25 fields for historical data request", with the library
splitting securities into groups of 10 and fields into groups of 128, against a default
`MaxPendingRequests` of 1,024 [17].

Finally, the workaround Bloomberg's own ecosystem recommends is telling: "Use the Worksheet (W<GO>) function
in the Bloomberg terminal; this is like a spreadsheet but without download limits" [10].

**EVIDENCE.**
- [10] Emory Libraries handout — university library guide, **verified as read**, **reported** as to Bloomberg's policy.
- [13] Penn Libraries — university library guide, 2026-09-02 — **reported**.
- [15] SMU LibFAQ "#NA limit" — university library FAQ, 2026-09-02 — **reported**.
- [16] `uibk.ac.at/.../bloomberg-terminal_limit.pdf` — university handout, text extracted 2026-09-02 — **reported**.
- [17] BLPAPI Core Developer Guide v1.6 (2016) — official Bloomberg developer doc, text extracted 2026-09-02 — **verified**, but **historical** (2016; current limits may differ).

**INTERPRETATION.** The metering boundary is drawn at **egress**, not at work. Inside the Terminal, `W<GO>`
gives you a spreadsheet with no limit at all; the moment the same data crosses into *your* Excel, it is
counted. That is a licence being enforced by an engineering mechanism, and it is internally consistent with
the contractual position in Topic 8. The **absence of a gauge** is harder to defend on any reading other than
deliberate: a hard cap with no meter, no reset, and a shared-resource blast radius (one student exhausts a
department's month [16]) is about as user-hostile as a limit can be built.

**RELEVANCE TO UCT.** UCT meters several things already — LLM daily caps (`CATALYST_COST_CAP_DAILY`,
`COT_NARRATIVE_DAILY_CAP`, the brain-engine `$5/day`), per-user voice minute caps (`mode_d`), and provider
quotas (AlphaVantage 25/day, the Finviz/FMP row ceilings). Bloomberg's failure is a directly applicable
warning: **a cap without a visible remaining-budget reading converts a cost control into a mystery outage**,
and the user's only feedback is a broken cell. UCT's `CoverageLine` already proves the team knows the fix —
say *why* a result set is short, in words, above the counts. The same treatment belongs on any cap that can
silently truncate a member-facing surface.

**CONFIDENCE.** 🟢 that limits exist, are per-terminal, are strictly enforced, surface as `#N/A Limit`, and
have typed API equivalents (official developer guide + four independent guides). 🔴 on **the numbers**, and
this is a real ceiling rather than a research failure: Bloomberg does not publish them and one primary source
says so explicitly. Named ceiling-raiser: a Terminal user running `DAPI <GO>` and reading Bloomberg's own
limits documentation, which is Terminal-only. The owner could obtain this from any contact with Terminal
access; no public source will.

**RECOMMENDATION (anti-pattern, high confidence).** *Never ship a hard cap without a meter.* If TERMINAL-NEXT
throttles anything a member can hit, the remaining budget must be readable *before* the failure, and the
failure message must name the cap rather than render as absent data.

**OPEN QUESTION.** Does Bloomberg meter *reads* or *unique securities*? Emory says the limit is "driven
largely, but not exclusively, by the number of securities retrieved" and UIBK says re-using a security within
a month does not count twice [10][16] — that is a de-duplicated universe cap, not a request cap, and it
implies Bloomberg is pricing *breadth of coverage taken off-platform*, not load. If so, the analogue for UCT
is not rate-limiting; it is universe licensing.

---

## Topic 7 — The API family: Desktop API, Server API (SAPI), B-PIPE, Data License

**OBSERVATION.** Bloomberg ships **one programming interface (BLPAPI) across four commercial products**, and
the difference between them is licensing and responsibility, not code. Bloomberg's own developer guide states
it plainly: "All API products share the same programming interface and behave almost identically. The main
difference is that customer applications using the enterprise API products (which exclude the Desktop API)
have some additional responsibilities, such as performing authentication, authorization and permissioning
before distributing/receiving data" [17].

The tiers:

| Product | Runs where | Who authenticates | Bloomberg's public framing |
|---|---|---|---|
| **Desktop API (DAPI)** | The user's own PC, alongside a logged-in Terminal, via the local `bbcomm` process; **"only supported on Microsoft Windows"** [17] | Bloomberg (the Terminal session is the entitlement) | The Excel add-in and local scripts |
| **Server API (SAPI)** | A firm's server | The app, via `//blp/apiauth`; still tied to a live user session — "SAPI data is only delivered to Bloomberg users with an active Bloomberg Professional service session" [18] | "a powerful complement to the Bloomberg Terminal"; "Built-in, robust entitlements control"; "Data usage monitoring and management" [18] |
| **B-PIPE** | Firm infra or cloud; ticker plants in major hubs | The firm, through **EMRS** | "35 million instruments", "330+ exchanges and 5,000+ contributors"; EMRS "empowers firms to supervise entitlements for individual users, user groups, applications and publishing services"; supports "non-display (black box) applications" [19] |
| **Data License** | Bulk/enterprise, off-Terminal | Contractual | "100B+ Data points published daily", "70M+ Financial instruments"; REST API, SFTP, "natively in all major cloud providers"; content "aligns with the data on the Bloomberg Terminal" [20] |

Language/platform reality (official API library page, v3.26.7.1, fetched 2026-09-02): Java / C# (.NET) / C++
supported on Windows and Java/C++ on Linux, macOS ARM marked **experimental**, and a hard statement that
"These Bloomberg API libraries cannot be used by Bloomberg Professional terminal users (which use the Desktop
API). They are only compatible with the Bloomberg Server API and B-Pipe data feed products" [21]. Python is
distributed as `blpapi` wheels from Bloomberg's own index (`bcms.bloomberg.com/pip/simple`) — i.e. **not on
PyPI**, under a bespoke `LicenseRef-Bloomberg-BLPAPI` licence [21][22]. Bloomberg additionally documents a
COM Data Control for Excel, and Perl/Python/COM built on top of the C API [17].

Service model (from the developer guide, **verified**): `//blp/mktdata` is subscription-paradigm streaming;
`//blp/refdata` is request/response; `//blp/mktdepthdata` is **B-PIPE only**; there are also `//blp/mktvwap`
(custom VWAP), `//blp/mktbar`, `//blp/mktlist`, `//blp/apiflds` (field discovery, the API twin of `FLDS <GO>`)
and an instrument-lookup service mirroring `SECF <GO>` [17]. Bloomberg names the three paradigms explicitly:
**Request/Response, Subscription, and Publishing** — the third lets customer applications *contribute* data
back into the Bloomberg infrastructure or distribute it internally [17].

**EVIDENCE.**
- [17] BLPAPI Core Developer Guide v1.6 (2016) — official developer doc — **verified**, historical.
- [18] `professional.bloomberg.com/products/data/data-connectivity/server-api/` — official product page, 2026-09-02 — **claimed**.
- [19] `professional.bloomberg.com/products/data/enterprise-catalog/real-time-data-feed/` — official product page, 2026-09-02 — **claimed**.
- [20] `professional.bloomberg.com/products/data/data-management/data-license` — official product page, 2026-09-02 — **claimed**.
- [21] `professional.bloomberg.com/support/api-library/` — official support page, 2026-09-02 — **verified** (library matrix and the Linux/Desktop-API exclusion are stated there).
- [22] `blpapi` package metadata / Bloomberg pip index — read via search summary, not fetched — **reported**.

**INTERPRETATION.** The architecture is a **single API with four price/responsibility tiers**, and the tier
boundary is exactly the boundary of *who is accountable for entitlements*. Desktop API: Bloomberg is, because
there is a person logged in. Server API: shared, because the session still exists but an application is the
consumer. B-PIPE: the firm is, via EMRS, which is why B-PIPE is the only tier permitted to feed non-display
algorithmic systems. Data License: contractual, off-Terminal, enterprise. The elegance is that a developer's
code barely changes across the tiers — only the auth preamble does. The Linux exclusion for Desktop API is
the tell: the desktop tier is deliberately shackled to a machine running a Terminal.

**RELEVANCE TO UCT.** TERMINAL-NEXT has no equivalent tiering problem today (one FastAPI backend, one member
population, no redistribution licence to police), so the *licensing* lesson is inapplicable. What is highly
applicable is the **API shape**: one interface, four services, with `//blp/apiflds` letting an application
*discover the field dictionary at runtime* rather than hard-coding it. UCT's own indicator platform has
repeatedly been bitten by hand-typed enumerations drifting from the source that owns them (the widget
registry, the writer index, the COT route count, the setup catalogue). Bloomberg's answer — make the schema
introspectable and have the client ask — is the structural fix for that entire defect class, and it is
already half-built in UCT's `feature_flag_index.py` / `registry.test.js` idiom.

**CONFIDENCE.** 🟢 on the four-tier architecture, the paradigms, the service names and the platform matrix
(one official developer guide read verbatim, plus a current official library page). 🟡 on **current
commercial terms** — the developer guide is v1.6/2016 and Bloomberg's product pages are marketing. Ceiling:
Bloomberg's *Enterprise* User/Developer guides (referenced by the Core guide but not fetched) and the actual
B-PIPE/SAPI contracts, which are not public.

**RECOMMENDATION (hypothesis).** *One API surface with an introspectable field dictionary, and a thin auth
layer that varies by consumer class, scales further than four bespoke APIs.* For UCT the cheap version is:
make the definition tree (`screener_rows` scalars, widget registry, flag ledger) queryable by the client,
and let every consumer — the UI, the AI-search layer, the voice tools, a member's export — read the same
dictionary.

**OPEN QUESTION.** Are the 400-field / 25-field / 10-security chunking limits [17] still current a decade
later? They shape any client design and I only have a 2016 statement.

---

## Topic 8 — What may leave the Terminal, and how Bloomberg polices it

**OBSERVATION.** This is the sharpest-edged part of the slice, and Bloomberg's position is available verbatim
— but only in the **Trial** licence, which Bloomberg publishes [23]. The paid Terminal subscription agreement
is not public. With that caveat stated up front, the trial terms say:

On **use and re-routing** (§4(a)): information may be used "only for the benefit of the Trial Subscription
through which such Information was initially received, and not for enterprise use", and "Re-routing of
Information … from any Receiving Device to any other device or medium is prohibited". Further: information
"may never be used as inputs into any non-user-based, non-display application (e.g., automated algorithmic
trading applications)" [23].

On **sharing a seat** (§4(b)): the subscription is "for the User's individual use only and on one Receiving
Device"; with a secure identification device the user may use multiple devices "but never on more than one
device at a time"; the recipient "shall not permit the Services to be shared, switched or replicated between
two or more persons"; and "User may not broadcast, redistribute, or otherwise move Information or Resultant
Information to any person" [23].

On the **Desktop API specifically** (§4(c)) — this is the clause that governs the Excel add-in: downloaded
information may be used "only on or from the Designated Authorized Computer that received the Downloaded
Information via the Desktop API"; it may not "be reproduced, shared, broadcast or otherwise copied or moved to
or used in any fashion on any device, display, application or printer" other than that computer; and "SR shall
not store all or any part of the Downloaded Information in databases for access by any Authorized Computers
other than the Designated Authorized Computer" [23]. A university guide states the same rule in one line:
"Data obtained through the Bloomberg Desktop (Excel) API may not leave the local machine you used to access
the Bloomberg service" [13].

On **competing uses** (§4(e)): the data may not be used to "improve the quality of data sold or contributed
by SR to any party", for "any automated data validation or verification", or in any way that could displace
a third party's subscription to Bloomberg [23].

On **enforcement** (§10): "The SP Group may monitor, either physically or electronically (including remotely),
[the recipient's] use of the Services", explicitly including "monitoring of SR's requests for Information for
purposes of verifying SR's compliance with this Agreement"; Bloomberg "may audit … compliance … at any time"
and may require access to premises, systems and receiving devices, plus "a management employee available to
assist with the auditing" [23].

Note the two mechanisms that *are* sanctioned egress:
- **Compliance archiving.** Third-party archivers ingest IB directly — Smarsh states it "captures content
  directly from the Instant Bloomberg via SFTP connections", covering "one-to-one, group and channel
  communications, along with files that are shared as part of a conversation" [24]; SteelEye markets the same
  capability without naming the mechanism [25]. So chat leaves the network, wholesale, when a regulator
  requires it — by a Bloomberg-provided pipe.
- **Screenshots.** Permitted, shareable into IB [1], and untracked against download limits [10].

**EVIDENCE.**
- [23] `service.blpprofessional.com/trial/en.pdf` — **Bloomberg Trial License Terms of Service** (official Bloomberg legal document, doc ref 600155460_12), text extracted 2026-09-02 — **verified** as to the trial licence; **not verified** as to the commercial one.
- [13] Penn Libraries — university library guide — **reported**, corroborating.
- [24] Smarsh "Instant Bloomberg" channel page — vendor page, fetched 2026-09-02 — **reported**.
- [25] SteelEye Bloomberg IB connector — vendor page, fetched 2026-09-02 — **reported** (no mechanism stated).
- [1][10] as above.

**INTERPRETATION.** Bloomberg's policy is coherent across three enforcement layers, and it is worth naming all
three because most write-ups only see one:

1. **Contractual** — per-person, per-device, no redistribution, no non-display use, audit rights.
2. **Mechanical** — download limits that bind to the *terminal* (Topic 6), and a Desktop API that only runs on
   a Windows machine with a live Terminal session (Topic 7).
3. **Architectural** — the paths that *are* wide open (screenshots, chat, App Portal sandbox) are ones where
   the data arrives as a picture or stays inside Bloomberg's own boundary.

The commercial logic is visible in §4(e): the prohibition is not really about copying, it is about **not
letting a customer become a competitor or a supplier to one**. And the tiering in Topic 7 is the pressure
valve — if you genuinely need to redistribute, you buy B-PIPE or Data License, where EMRS makes you account
for every entitled user and Bloomberg gets paid per seat downstream.

**RELEVANCE TO UCT.** Two distinct lessons, in opposite directions.

*Anti-pattern to avoid:* UCT's members are retail-plus and its desk is small. Any export restriction UCT
inherits from a vendor (Massive, FMP, Finnhub, AlphaVantage, CFTC) should be **surfaced as a stated policy,
not discovered as a failed export**. Bloomberg's model works because it is a monopoly; UCT's would just annoy.

*Genuinely transferable:* Bloomberg's per-device, session-bound entitlement model is the mature version of a
problem UCT will eventually face — one paid seat, many humans. UCT already has `AuthGuard`, `FREE_PAGES` and
plan gating, but not a stated position on seat sharing. The Bloomberg answer worth studying is **`LOGU`/`LOGR`**
[3]: rather than pretending sharing does not happen, Bloomberg built a *sanctioned, logged* mechanism for one
Bloomberg Anywhere user to authorise another **within the same firm** to log in as them, and a matching command
to log back. Naming and instrumenting the workaround beats prohibiting it and being evaded.

**CONFIDENCE.** 🟡 overall — and the reason is precise. The clauses are **verbatim from a Bloomberg-published
legal document**, so the *wording* is 🟢; but it is the **trial** agreement, and I have no public evidence that
the commercial Terminal agreement says the same. Two independent signals point the same way (Penn's one-line
restatement of the Desktop API rule [13], and the mechanical enforcement in Topic 6 which only makes sense
under such terms), which is why this is 🟡 rather than 🔴. **Named ceiling-raiser:** a copy of the commercial
Bloomberg Terminal subscription agreement, or Bloomberg's "Desktop API Guidelines" (referenced by Penn [13],
not publicly reachable). A firm with a Terminal seat could supply both; no web source will.

**RECOMMENDATION (hypothesis).** *Sanction and instrument the workaround rather than prohibiting it.*
`LOGU`/`LOGR` turns an unenforceable rule into a logged event. Where UCT cannot prevent a behaviour (shared
logins, exported watchlists, screenshotted charts), the cheaper and more honest control is to make the
supported version better than the workaround and to record it.

**OPEN QUESTION.** Does the commercial agreement retain the §4(a) ban on non-display/algorithmic use for
Desktop API data? If it does, then every quant using `blpapi` from a desktop is technically outside terms,
which would be a remarkable and widely-ignored rule — and worth knowing before citing Bloomberg as a model
for anything.

---

## Topic 9 — Terminal Connect, App Portal and IB Connect: letting other software in

**OBSERVATION.** Bloomberg's answer to "our users have other applications" is not to open its data; it is to
**let other applications drive the Terminal**.

**Terminal Connect** is "a programming interface that allows you to initiate Bloomberg functions from any
proprietary application (OMS, CRM, Research, Risk platforms, etc.) and Microsoft Excel spreadsheets as well as
synchronize with Bloomberg Launchpad and embed select Bloomberg Launchpad components into a proprietary
application" [26]. The pitch is anti-application-hopping: "You enter data once and Terminal Connect fills in
the information across all of your screens", with a claimed saving of "10 to 30 minutes per day" per user [26].
Note the direction of travel: **functions and workspace components flow outward; data does not.**

**App Portal (`APPS <GO>`)** is the store, and it inverts the same relationship: third-party web apps are
delivered *as Bloomberg functions*. "An application that once resided on a browser is now delivered as a
Bloomberg function" [5]. Partners get: Single Sign-On off Terminal credentials; "Synchronize" — "A client's
universe or portfolio is visible and accessible without any retyping/copying-pasting to your application";
Desktop API access for custom analysis; an SDK supporting WPF desktop and HTML5 web apps; a **sandbox** —
"App Portal apps run in a sandboxed environment ensuring our shared clients security and privacy"; managed
version control and deployment; a built-in payment system handling "accounting, collections and invoice
processing"; usage analytics; and distribution to "more than 325K Terminal users" [5]. Integration extends
into Bloomberg's own trading systems (TOMS, EMSX) [5].

**IB Connect** does the same for chat, in both directions: "IB Connect on Demand" lets a user right-click to
send content to client applications, and "IB Connect Chat Initiation" pushes content from external apps into
chat [1]; intra-firm and cross-firm chatbots let firms surface information from internal systems directly into
an IB room, with an SDK to build them [1][27].

**EVIDENCE.**
- [26] `data.bloomberglp.com/professional/sites/10/Fact-Sheet-Terminal-Connect.pdf` — official Bloomberg fact sheet, ©2018, text extracted 2026-09-02 — **verified** (document), **claimed** (the time-saving figure).
- [5] App Portal Introductory Guide PDF, ©2022 — official Bloomberg brochure, text extracted 2026-09-02 — **verified** (document), **claimed** (benefits).
- [1] Instant Bloomberg product page — official, 2026-09-02 — **claimed**.
- [27] WatersTechnology coverage of Bloomberg chatbots — trade press, read via search summary only — **reported**.

**INTERPRETATION.** This is the most strategically interesting pattern in the slice. Bloomberg's integration
posture is **asymmetric by design**: it will spend real engineering to let your OMS open a Bloomberg function,
to let your app read the *user's own* portfolio list, and to let your chatbot post into an IB room — because
every one of those makes the Terminal more central. It will not let the data out (Topic 8). Integration and
data-openness are decoupled, and Bloomberg has chosen a lot of the first and none of the second.

Two second-order details are worth stealing regardless of that posture. First, **the store handles billing,
deployment and version control for partners** [5] — Bloomberg removed the boring blockers to third-party
extension, not just the technical ones. Second, **the sandbox** [5]: third-party code runs constrained, which
is what makes "let anyone extend the workstation" survivable.

**RELEVANCE TO UCT.** TERMINAL-NEXT is being designed for a desk of a few and members of a few hundred; a
partner app store is not on the table. But the *inward-facing* version is: the desk's own scripts (the morning
wire engine, the scanner, the breadth collector, the UCT20 harness, the brain pack) are already "third-party
applications" relative to the dashboard, and they currently talk to it through one blunt door (`POST /api/push`)
plus a scatter of admin endpoints. A **Terminal-Connect-shaped control surface** — "open ticker X at TF Y in
layout Z", "load this scan", "flag these names" — would let those existing programs drive the workstation
instead of pushing blobs at it. UCT already has the primitive: `voice_client_action_tools.py` navigates members
to routes, and `PAGE_ALIASES` is pinned by `test_navigation_targets_resolve.py`. That is Terminal Connect's
first 20% already built for a different consumer.

**CONFIDENCE.** 🟢 on what these products are and what Bloomberg claims for them (two official PDFs read
verbatim plus a current product page). 🔴 on **adoption and real-world quality** — I have no evidence about how
many App Portal apps exist, whether partners find it worthwhile, or whether Terminal Connect is widely used.
Ceiling: `APPS <GO>` inside a Terminal would answer the first question in one screen.

**RECOMMENDATION (hypothesis).** *A workstation that other programs can drive becomes the place work
converges, even if it never opens its data.* For UCT: expose a small, stable, named action surface for the
desk's own tooling before building any new cross-application feature.

**OPEN QUESTION.** Does Terminal Connect let an external app *read* Launchpad state, or only *write* to it and
embed components? The fact sheet says "synchronize" and "embed select components" [26], which is ambiguous, and
the read/write direction is the whole question for anyone copying the idea.

---

## Topic 10 — Mobile: Bloomberg Anywhere and the Bloomberg Professional app

**OBSERVATION.** The mobile product is gated and companion-shaped, not parity-shaped. Apple's listing for
Bloomberg Professional states: "This app is only accessible by Bloomberg Terminal clients with a Bloomberg
Anywhere subscription" [28]. The advertised capability set is deliberately narrow and collaboration-first:

- **IB** — "Exchange ideas, research, pricing, indications of interest and more with a global network of
  financial professionals", explicitly "with the same compliant communication capture as on the Terminal" [28].
- **Worksheets** — "Access worksheets away from the Terminal, monitor watchlists in real time and view related
  news, events, research and charts" [28].
- **News and research**, including "AI-powered document search" [28].
- **Market data** across asset classes, with analyst recommendations, estimates and ownership [28].
- **ASKB** — "A new conversational AI interface that transforms how financial professionals discover, analyze
  and act on market intelligence" [28].

Authentication is biometric via the **B-Unit** app: the login is "scanning a QR code and verifying identity
with device biometric authentication" [29], replacing the physical B-Unit fingerprint fob. The Terminal's own
function guide confirms the enrolment path — `BA <GO>` "enables a Bloomberg user to convert from a traditional
Bloomberg to BLOOMBERG ANYWHERE. As well as enrolls the B-UNIT login authentication device" [3] — and the
seat-portability rules in Topic 8 ("never on more than one device at a time" [23]) are what make this
architecture necessary.

**EVIDENCE.**
- [28] Apple App Store listing, Bloomberg Professional — official product listing, fetched 2026-09-02 — **claimed** (the version/date reported by the fetch, 2.2617 / 2024-08-24, looks inconsistent with the ASKB release notes and should not be relied on).
- [29] Bloomberg B-Unit app listings and Bloomberg's own B-Unit user guide PDF — official, read via search summary — **reported**.
- [3] official function guide (2015) — **verified**.
- [23] Trial TOS — **verified** (trial only).

**INTERPRETATION.** Bloomberg chose the *three* things that survive a phone screen — **chat, watchlists, and
news** — plus a conversational AI layer as the new front door for everything else. It did not attempt to port
the workspace. That is a real design position: on mobile, the Terminal's value is being *reachable* and
*monitorable*, not operable. ASKB is the interesting hedge — a conversational interface is how you offer 40,000
functions on a 6-inch screen without a navigation model.

**RELEVANCE TO UCT.** Directly applicable and partly contradicted by UCT's current direction. UCT's stated
mobile goal is "near-full feature parity (TradingView-mobile quality, including touch charting)", and its
touch tier is ≤1024px across 54 stylesheets. Bloomberg — with vastly more resources — explicitly did *not*
chase parity; it shipped chat + watchlists + news + an AI front door. That is not proof UCT is wrong (UCT's
members are retail and phone-first in a way Bloomberg's are not), but it is a strong benchmark data point for
the Terminal-Next mobile scope decision, and it argues that **the AI-search layer is the correct mobile
navigation model**, which UCT already has built.

**CONFIDENCE.** 🟡. The feature list is from an official store listing (reliable as marketing) but the version
metadata returned by the fetch is internally inconsistent, and I have **no** evidence about how the app
actually performs or what practitioners use it for. Ceiling: hands-on use, or a practitioner account.

**RECOMMENDATION (hypothesis).** *On a phone, a professional workstation should aim to be reachable and
monitorable, with a conversational front door — not operable.* Cheap test for UCT: instrument which routes
phone sessions actually use today, before spending more on touch-charting parity.

**OPEN QUESTION.** Can a user *act* from mobile — place an order, edit a worksheet, create an alert — or only
read and chat? That single answer decides whether "companion" is the right word.

---

## GAPS (budget not reached / unreachable)

1. **No practitioner voice at all.** The session's shared web-search budget (200/200) was exhausted at tool
   call ~29, before Reddit, Wall Street Oasis, or "a day on the Bloomberg terminal" write-ups could be queried.
   Every "how it feels" claim in this file is therefore inferred from Bloomberg's own copy or from university
   guides written for students, not from anyone who negotiates bonds in IB. **This is the single largest gap**
   and it particularly weakens Topics 1, 2 and 10.
2. **Terminal-only documentation.** `HELP DAPI <GO>`, `HELP BQLX <GO>`, `HELP IB <GO>`, `HELP NOTE <GO>`,
   `APPS <GO>` and `DLIM`-style limit reporting are all inside the Terminal. Several of my 🔴/🟡 ratings would
   move to 🟢 with one hour on a Terminal.
3. **The commercial subscription agreement is not public.** All of Topic 8 rests on the *trial* licence.
4. **Download-limit numbers are unpublished by design** (Emory states this explicitly [10]); the circulating
   figures contradict each other and I verified only the 3,500 concurrent real-time subscription cap [13].
5. **bloomberg.com returns 403 to WebFetch**, which blocked: the IB statistics press release, the NOTE press
   release, the "Terminal Essentials: IB, Worksheets & Launchpad" article, the "Pro Tips: turn IB chats into
   action" article, and Bloomberg's compliance-fundamentals pages. `professional.bloomberg.com` and
   `data.bloomberglp.com` / `assets.bbhub.io` do respond — future roles should prefer those hosts. A browser
   tool might get past the 403; I did not spend budget trying since the search budget was already gone.
6. **BLPAPI evidence is a 2016 document (v1.6).** Request-size limits, service lists and platform support may
   have moved. The current official library page [21] confirms the *platform* picture but not the limits.
7. **Not investigated:** `MSG` composition/attachment mechanics in detail; Bloomberg Vault; the compliance
   product family (`CMPC`); whether IB interoperates with Symphony/Teams; Bloomberg's 2013 reporter-access
   controversy (I know of it but found no citable source this session, so it is deliberately **not** asserted
   anywhere above); pricing of B-PIPE/SAPI/Data License tiers.

## SOURCE-HANDLING OBSERVATIONS

- No prompt-injection-style text was encountered in any fetched page or PDF.
- One search result — a GitHub repository (`api-evangelist/bloomberg-instant-messaging`) — presents a
  descriptive summary of Instant Bloomberg in a form that reads like official documentation but is a
  third-party artefact. **I did not use it as evidence** and note it here because it is the kind of source that
  would otherwise be mistaken for primary.
- Several university library guides reproduce identical sentences about GRAB and export ("Not all screens can
  be saved", "under OPTIONS not export"). Their agreement is therefore **not independent corroboration** — they
  most likely descend from one Bloomberg-supplied handout. I have treated them as one source of medium weight,
  not four.
- The `#N/A Limit` figures that circulate (2,500 / 5,000–7,000 identifiers per month, 500,000 hits/day) are
  mutually inconsistent across guides, and one primary-ish source says Bloomberg publishes none of them. Any
  synthesis that quotes one of those numbers as fact is repeating folklore.

## SOURCES

Tier key, following the preamble's ordering: **T-A** official documentation/help · **T-B** official
manuals/function guides · **T-C** official product pages · **T-D** official APIs/developer docs · **T-E**
official legal terms · **T-L** university library guides (credible professional tutorials) · **T-V**
vendor/trade-press/practitioner.

| # | Source | Tier | Fetched | Class |
|---|---|---|---|---|
| 1 | Instant Bloomberg product page — `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/instant-bloomberg` | T-C | 2026-09-02 | claimed |
| 2 | Collaboration Tools hub — `professional.bloomberg.com/products/bloomberg-terminal/collaboration-tools/` | T-C | 2026-09-02 | claimed |
| 3 | "Basic Bloomberg Tech Functions" PDF (2015) — `data.bloomberglp.com/professional/sites/4/2015/03/basic_tech_functions.pdf` | T-B | 2026-09-02 | verified |
| 4 | McGill Library — Bloomberg guide — `libraryguides.mcgill.ca/finance/bloomberg` | T-L | 2026-09-02 | reported |
| 5 | Bloomberg App Portal Introductory Guide PDF (©2022) — `assets.bbhub.io/professional/sites/10/App-Portal-Introductory-Guide.pdf` | T-C | 2026-09-02 | verified/claimed |
| 6 | Bloomberg press release "An Innovation for Instant Bloomberg" (2013) — **HTTP 403, snippet only** | T-C | 2026-09-02 | reported (low) |
| 7 | Chrome Web Store — "Bloomberg Terminal: Clip to NOTE" (listing not opened) | T-C | 2026-09-02 | reported |
| 8 | Boston College Libraries — Bloomberg exporting guide — `libguides.bc.edu/Bloomberg/exporting` | T-L | 2026-09-02 | reported |
| 9 | University of Utah — Bloomberg exporting/screenshots guide — `campusguides.lib.utah.edu/c.php?g=160745&p=1052144` | T-L | 2026-09-02 | reported |
| 10 | Emory Libraries — "Bloomberg Monthly Data Download Limits" PDF — `libraries.emory.edu/media/10291` | T-L | 2026-09-02 | reported |
| 11 | **Bloomberg Excel Add-in Desktop Guide** PDF (Bloomberg-authored; hosted by WU Vienna) — `wu.ac.at/fileadmin/wu/s/library/databases_info_image/bloomberg_excel_desktopguide.pdf` | T-B | 2026-09-02 | verified |
| 12 | FinTools — "BQL for Excel" — `fintools.com/resources/financial-data/bql-for-excel/` | T-V | 2026-09-02 | reported |
| 13 | Penn Libraries — Bloomberg "API/Excel" guide — `guides.library.upenn.edu/bloomberg/excel` | T-L | 2026-09-02 | reported |
| 14 | NYU Libraries — Bloomberg Query Language guide — `guides.nyu.edu/bloombergguide/bloomberg-query-language-bql` | T-L | 2026-09-02 | reported |
| 15 | SMU LibFAQ — "#NA limit" error — `libfaq.smu.edu.sg/faq/134764` | T-L | 2026-09-02 | reported |
| 16 | Univ. Innsbruck — "Bloomberg Data Limits for Excel" PDF — `uibk.ac.at/media/filer_public/38/76/…/bloomberg-terminal_limit.pdf` | T-L | 2026-09-02 | reported |
| 17 | **BLPAPI Core Developer Guide v1.6 (2016)** PDF — `data.bloomberglp.com/professional/sites/10/2017/03/BLPAPI-Core-Developer-Guide.pdf` | T-D | 2026-09-02 | verified (historical) |
| 18 | Server API (SAPI) product page — `professional.bloomberg.com/products/data/data-connectivity/server-api/` | T-C | 2026-09-02 | claimed |
| 19 | B-PIPE / Real-Time Market Data Feed product page — `professional.bloomberg.com/products/data/enterprise-catalog/real-time-data-feed/` | T-C | 2026-09-02 | claimed |
| 20 | Data License product page — `professional.bloomberg.com/products/data/data-management/data-license` | T-C | 2026-09-02 | claimed |
| 21 | Bloomberg API Library support page (libraries v3.26.7.1) — `professional.bloomberg.com/support/api-library/` | T-A | 2026-09-02 | verified |
| 22 | `blpapi` Python package metadata / Bloomberg pip index (`bcms.bloomberg.com/pip/simple`) — via search summary | T-D | 2026-09-02 | reported |
| 23 | **Bloomberg Trial License Terms of Service** (doc 600155460_12) — `service.blpprofessional.com/trial/en.pdf` | T-E | 2026-09-02 | verified (trial only) |
| 24 | Smarsh — Instant Bloomberg channel page — `smarsh.com/channel/instant-bloomberg/` | T-V | 2026-09-02 | reported |
| 25 | SteelEye — Bloomberg IB data connector — `steel-eye.com/data-connectors/bloomberg-ib` | T-V | 2026-09-02 | reported |
| 26 | **Bloomberg Terminal Connect Fact Sheet** PDF (©2018) — `data.bloomberglp.com/professional/sites/10/Fact-Sheet-Terminal-Connect.pdf` | T-C | 2026-09-02 | verified/claimed |
| 27 | WatersTechnology — Bloomberg chatbots coverage — via search summary only | T-V | 2026-09-02 | reported |
| 28 | Apple App Store — Bloomberg Professional (`id407761767`) | T-C | 2026-09-02 | claimed |
| 29 | Bloomberg B-Unit app + B-Unit User Guide PDF — via search summary | T-C | 2026-09-02 | reported |

**Primary (Bloomberg-published): 1, 2, 3, 5, 6, 7, 11, 17, 18, 19, 20, 21, 23, 26, 28, 29 — of which I read
the full text of 3, 5, 11, 17, 23, 26 and the rendered page of 1, 2, 18, 19, 20, 21, 28.**
**Secondary: 4, 8, 9, 10, 12, 13, 14, 15, 16, 22, 24, 25, 27.**
