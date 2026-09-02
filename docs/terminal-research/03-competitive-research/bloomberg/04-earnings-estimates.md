---
id: B-BBG-04
title: Bloomberg Terminal — Earnings and Estimates Workflow
role: Bloomberg: earnings and estimates
wave: 1b
group: B
category: competitor
scope: Bloomberg Terminal — earnings, estimates, guidance, transcripts, event calendar, print-day reaction
confidence: 🟡
evidence_ceiling: No terminal access. Function inventory and Bloomberg's own staged workflow are well-evidenced; screen-level layout (columns, tabs, defaults), BEst consensus construction rules (staleness/outlier handling), and any earnings implied-move screen are NOT reachable from public sources.
sources: 9 primary; 13 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# B-BBG-04 — Bloomberg Terminal: earnings and estimates

**How to read this file.** It was written by a researcher with no Bloomberg
subscription, from public sources only. Every claim is labelled
**verified** (primary evidence — Bloomberg's own documentation/product/press),
**demonstrated** (seen in an official video/demo transcript),
**claimed** (Bloomberg marketing), **reported** (practitioner or third-party
account), or **speculated** (my inference). Benchmarks are sources of learning:
"Bloomberg does Y" never implies "UCT should build Y".

**Two terms used throughout.** TERMINAL-CURRENT is UCT's existing `/calendar`
surface (display-named "UCT Terminal") — an earnings/economic calendar with a
per-ticker research modal. TERMINAL-NEXT is the workstation being designed.

---

## 0. Consolidated mnemonic inventory (the map, before the workflow)

Bloomberg addresses a security then a function: `AAPL US Equity EE <GO>`. The
security stays loaded; the function changes. Every row below is corroborated by
at least two independent sources unless marked otherwise.

| Mnemonic | What it is | Best evidence |
|---|---|---|
| **EE** | Earnings & Estimates — the **hub/menu** for the whole topic | [1][10][11][12][15][16][21] |
| **ERN** | Earnings History — reported EPS vs consensus, surprise %, **plus the price change on announcement day and the P/E effect** | [9][10][11][13][21] |
| **EEO** | Consensus Overview — aggregate estimate across all covering analysts, forward multiples | [9][10][11][12] |
| **EEB** | Estimates Consensus Detail — **broker-contributed** projections, selectable "Measure" | [9][14] |
| **EEG** | Earnings Estimates Graph — how consensus has **moved over time**, overlaid on price | [1][10] |
| **EM** | Earnings Trends / "Earnings matrix" — past earnings + growth rates **connected to** future estimates | [9][10][14][19][21] |
| **EERM** | Earnings estimate **revisions** | [9][12] |
| **SURP** | Surprise Analysis — historical surprises **and the corresponding share-price changes** | [12][15] |
| **ANR** | Analyst Recommendations — ratings distribution, target prices, **named firm and named analyst per rating** | [10][11][15][16][19][21] |
| **GUID** | Company **guidance**, current + historical, plus *Bloomberg's own adjusted guidance and confidence intervals* | [12b] (single source) |
| **EVTS** / **EVT** | Corporate **events calendar** — earnings dates/calls; carries **live and final transcripts**, presentations, models, estimates | [1][2][5][9][11][13][15] |
| **MODL** | Company Financials — consensus across **hundreds of line items incl. segment KPIs**; on print day captures reported data **within seconds** and diffs it vs consensus | [1][2][3] |
| **KPIC** | KPI Comparison — one KPI for one company **against industry peers** | [3] |
| **DS** | Document Search — AI/NLP across **200 million documents** incl. transcripts, filings, research; topic-trend analytics; `DS NOTE` = Notebook | [2][3] |
| **GF** | Graph Fundamentals — chart reported actuals against consensus; put a surprise **in historical context** | [2][11][15] |
| **ALTD** | Alternative data (card-transaction, foot-traffic) as an earnings read-through | [2] |
| **BI** | Bloomberg Intelligence — industry/company research **dashboards**, 350+ analysts | [10][11][17] |
| **EA** | Earnings analysis. **Ambiguous in the sources** — see §11 | [9][18] |
| **BBEA** | Broad-market earnings analysis menu | [9][19] |
| **NI ERN** | Global earnings **news** stream | [9][11] |
| **CN** | Company news & research for the loaded security | [9][15][21] |
| **BDVD** | Bloomberg **dividend forecast** (linked from AI call summaries) | [4][9] |
| **SPLC** | Supply-chain analysis (linked from AI call summaries) | [4] |
| **MREP** | Customizable **morning report** brief | [8] (single source) |

⚠️ **`TRAN` does not appear anywhere in the evidence.** The B-BBG contract listed
"transcripts (`TRAN`?)" as a guess. Nothing I found supports it. The transcript
doors are **EVTS** (artifact attached to the event) and **DS** (search across
transcripts). Do not carry `TRAN` forward as a fact.

⚠️ **Source [9] is Bloomberg-authored but HISTORICAL.** The "Equity Portfolio
Manager" function card hosted by U. Delaware is a genuine Bloomberg cheat sheet,
but it references BlackBerry and Bloomberg LAUNCHPAD in a form suggesting
c. 2010. Its mnemonics are corroborated elsewhere; treat its *completeness* as
dated, not its entries as wrong.

---

## 1. The workflow is staged by TIME RELATIVE TO THE PRINT, not by data type

**OBSERVATION.** Bloomberg does not organize the earnings topic as "here are the
earnings screens". It organizes it as four phases around the event, and assigns
different functions to each phase.

Bloomberg's own two published stagings:

- **Four pillars** — *Prepare* (EVTS) → *Anticipate* (EE, EEG) → *Interpret*
  (MODL, DS) → *Action & Communicate* (IB Forums). [1]
- **Five tools** — EVTS (track the event) → MODL (diff vs consensus) → ALTD
  (alt-data read-through) → DS (search the language) → GF (put the surprise in
  historical context). [2]

The webinar framing is the same axis: "a day in the life of a financial
analyst", moving through company-brief setup → managing incoming earnings
information → post-call analysis. [8]

**EVIDENCE.**
- [1] Bloomberg Professional Services, *Tools to enhance your earnings season
  analysis*, `bloomberg.com/professional/insights/markets/tools-to-enhance-your-earnings-season-analysis/`
  (read via the `professional.content.cirrus.bloomberg.com` mirror; the canonical
  host returns 403 to non-browser agents). Tier: official product/insights page.
  Fetched 2026-09-02. **Verified.** Quoted: "Link your portfolio or watchlist to
  get real-time company releases."
- [2] Bloomberg Professional Services, *Five tools to enhance your earnings
  season analysis*, same host/mirror. Official. Fetched 2026-09-02. **Verified.**
- [8] Bloomberg Professional Services, webinar page *Navigating Earnings Season:
  Essential Bloomberg Tools for Analysts*, same mirror. Official. Fetched
  2026-09-02. **Claimed** (marketing copy for a webinar I did not watch).
  Quoted: analysts face "earnings information overload and a shortage of time".

**INTERPRETATION.** The organizing question is *"where am I relative to the
print?"* — not *"what kind of data is this?"*. Before the print you are trying to
establish what is already in the price. At the print you are trying to diff
reported against expected as fast as possible. After the print you are trying to
understand the language and revise. Each phase has a different primary screen,
and Bloomberg is explicit that the same analyst walks all four in one day.

**RELEVANCE TO UCT.** TERMINAL-CURRENT's `EarningsResearchModal` is organized by
*data type* — fundamentals, SEC filings, AI call recap, sentiment, guidance,
rating changes, verbatim transcript. That is a librarian's taxonomy. The desk
persona (small options/equities desk trading around prints) and the member
persona both arrive at the modal in one of three temporal states: hunting a
setup days out, watching a print land, or reading the aftermath. Bloomberg's
staging is evidence that the temporal state is the more load-bearing axis.

**CONFIDENCE.** 🟢 for *what Bloomberg says the staging is* — it is stated twice
in Bloomberg's own words with consistent function assignments. 🟡 for *whether
users experience it that way*; I have one practitioner account (§9), not many.
Ceiling: I never saw the product; a demo transcript or a screen recording would
raise this.

**RECOMMENDATION (hypothesis).** A phase-aware earnings surface — the same
ticker, three different default views depending on whether the print is ahead,
now, or behind — may reduce the "which tab do I want" tax more than adding
another tab. Testable cheaply: instrument which TERMINAL-CURRENT modal section
is opened first, bucketed by days-to-print.

**OPEN QUESTION.** Does Bloomberg actually *switch* the default view by phase, or
does it just teach the four-phase sequence while leaving the user to navigate
manually? The marketing copy does not distinguish these, and they are very
different products.

---

## 2. `EE` is a hub with two doors to every destination

**OBSERVATION.** `EE` is a menu, not a page. From it a user navigates to ERN,
EEG, EM, EEO and ANR — **and every one of those is also directly addressable by
typing its own mnemonic**.

**EVIDENCE.**
- [10] Babson College, Stephen D. Cutler Center for Investments and Finance,
  *Equity Valuation using Bloomberg*, by Alex Bowers ('25),
  `babson.edu/media/babson/assets/cutler-center/Equity-Valuation-using-Bloomberg.pdf`.
  Tier: university tutorial (recent — 2025 author cohort). Fetched 2026-09-02.
  **Reported.** Quoted: "These functions can also be typed directly into the
  search bar." It names the fan-out set explicitly: ERN, EEG, EM, EEO, ANR.
- [15] Lei, Adam Y.C. & Li, Huihua, *Using Bloomberg Terminals in a Security
  Analysis and Portfolio Management Course*, hosted at
  `data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf`. Tier: academic
  paper hosted by Bloomberg. Fetched 2026-09-02. **Reported.** Describes EE as
  "Earnings Estimates Menu" providing "the links to the consensus and specific
  earnings estimates".
- [11] University of Scranton, Kania School of Management, *Bloomberg Training
  Manual*, `scranton.edu/academics/ksom/alperin/Bloomberg Training Manual.pdf`.
  Tier: university training material. Fetched 2026-09-02 (text extracted
  locally with `pdftotext`). **Reported.** Lists "EE- Earnings and Estimates"
  and "EEO- Consensus Overviews" as the "Other Earnings functions" reachable
  from ERN.

**INTERPRETATION.** This is a deliberate dual-affordance. The novice discovers by
walking a menu; the expert types four letters and skips it. Neither path is
second-class, and crucially the menu does not *own* its children — you can land
on `EEO` cold without passing through `EE`. Every screen is a first-class,
directly-addressable destination.

**RELEVANCE TO UCT.** TERMINAL-CURRENT already has the beginnings of this
tension: `pages/calendar/useEarningsModalRoute.js` gives the earnings modal a
URL, so a section *is* addressable (`/calendar?earnings=SYM&esection=analysts`).
That is the same idiom. The observation worth carrying is that Bloomberg treats
direct addressability as the *expert* path and the menu as the *novice* path,
and ships both without deprecating either.

**CONFIDENCE.** 🟢 — three independent sources, one of them Bloomberg-hosted, and
the dual-path claim is stated in plain words by [10].

**RECOMMENDATION (hypothesis).** Deep-linkable sections are not merely a
convenience; they may be the mechanism by which a surface stops being a modal and
starts being a workstation. Anti-pattern to avoid: a section reachable *only*
through a parent that must be traversed each time.

**OPEN QUESTION.** How much of Bloomberg's stickiness is muscle memory over
four-letter strings that no menu could replicate? B-BBG-08 owns that question;
flagging the dependency.

---

## 3. The professional's beat/miss is a LINE ITEM, not headline EPS

**OBSERVATION.** This is the single largest gap between Bloomberg's earnings
model and a retail-shaped one. `MODL` carries consensus for *hundreds* of line
items including segment-level KPIs, and the print-day diff is computed at that
granularity.

Bloomberg's own worked example is not an EPS beat. It is:

> "MODL shows that JP Morgan's loan loss provision in Q4 was $2.29 billion, 12%
> higher than brokers expected." [3]

**EVIDENCE.**
- [3] Bloomberg Professional Services, *Research on the Terminal* case study PDF,
  `assets.bbhub.io/professional/sites/10/Research-on-the-Terminal_analyst-web.pdf`.
  Tier: official Bloomberg case study. Fetched 2026-09-02, text extracted locally
  with `pdftotext`. **Verified.** Also states MODL lets you "Compare in real time
  company-reported data versus broker estimates within minutes of a company's
  earnings release".
- [2] **Verified.** MODL "captures company-reported data within seconds to show
  you how a company performed vs consensus"; described as capturing consensus
  "across hundreds of key line items, including granular KPIs and segment-level
  detail".
- [3] **Verified.** `KPIC` extends the same idea sideways: compare one company's
  KPI against named peers, and "Leverage company-reported and broker forecast
  data to understand industry inflection points."

**INTERPRETATION.** Two distinct capabilities are stacked here and they are worth
separating. (a) **Depth** — consensus exists for the segment number, not just
EPS/revenue, which means the analyst can be *right about EPS and wrong about the
thing that moves the stock*. (b) **Peer context** — the same KPI across the peer
set, so a "miss" can be recognized as an industry inflection rather than a
company failure. Bloomberg chose a bank loan-loss provision as the marquee
example precisely because it is a number no headline EPS figure would surface.

**RELEVANCE TO UCT.** TERMINAL-CURRENT's earnings model is EPS + revenue surprise
(`_normalize_earnings` / `_fmt_surprise` produce `reported_eps`, `eps_estimate`,
`surprise_pct`, `rev_actual`, `rev_surprise_pct`, `verdict`). The Model Book's
per-quarter earnings table is the same two axes. That is the correct *retail*
model and matches what free/cheap providers supply. The observation is that a
professional desk's read of "did they beat" is a different question with a
different data requirement, and that requirement is a licensed-data problem, not
a UI problem — segment-level consensus is not available from FMP/Finnhub/AV at
UCT's tier.

**CONFIDENCE.** 🟢 that Bloomberg does this and how it is marketed (three
official statements, one worked numeric example). 🔴 on *what the screen looks
like* and how the diff is presented (colour, ordering, what is surfaced first) —
I have no screenshot.

**RECOMMENDATION (hypothesis).** Do not treat this as a feature to copy — the
data is the moat, not the widget. The transferable idea is narrower and cheaper:
**a surprise number is more useful beside the peer/base-rate context than
alone.** UCT already holds the ingredients for a weak version (4Q beat history
in the calendar enrichment overlay, `hist_stats`, and a theme/peer set from the
taxonomy). Cf. `lesson_a_hit_rate_is_meaningless_without_its_base_rate`.

**OPEN QUESTION.** Where does Bloomberg's segment consensus come from — are
brokers contributing structured segment forecasts, or is Bloomberg parsing
published sell-side models? [2]'s phrase "benchmark their own forecasts vs market
consensus" implies contribution, but I could not verify the pipeline.

---

## 4. Latency is a stated, numbered product feature

**OBSERVATION.** Bloomberg publishes latency figures for the earnings capture
path and pairs them with a measurement of how fast the market actually moves.

**EVIDENCE.**
- [7] Bloomberg Professional Services, *Earnings season review with Bloomberg's
  real-time corporate earnings product*, `.../insights/data/...` (cirrus mirror).
  Official. Fetched 2026-09-02. **Verified/claimed.** "Automated extraction
  targets sub-second schematized delivery of company-specific KPIs." Extraction
  sources: "press releases, web releases and news embargoes". Study base:
  "7,381 earnings reports posted between October and December 2023 across 6,510
  of the most liquidly-traded global companies". Also: "Bloomberg analyst
  oversight ensures the accuracy of these data releases" — i.e. a human is in the
  loop by design, not merely as a fallback.
- [7] **Verified.** The Apple worked example: price moved ~2.5% inside a 30-second
  window, with most of the move around 2 seconds after the announcement.
- [2][3] **Verified.** MODL "within seconds" / "within minutes" of the release.
- [22] **Reported.** The sell-side analyst has "30 to 60 minutes between the
  release and the 8:30 a.m. ET earnings call" to get a compliance-approved
  reaction note out.

**INTERPRETATION.** Three different clocks are in play and they are not the same
clock: the *data* clock (sub-second), the *human read* clock (minutes), and the
*publication* clock (30–60 minutes). Bloomberg sells against the first, and the
first is what makes the second and third possible. Note also that the fastest
path is deliberately not fully automated — analyst oversight is advertised as a
correctness feature on the *real-time* product, which is an unusual trade to make
public.

**RELEVANCE TO UCT.** UCT's earnings actuals arrive via the daily wire push and
per-day calendar enrichment with 5-minute TTLs — a different order of magnitude
entirely, and appropriately so: UCT's desk is not trading the 2-second reaction.
The relevant read is that **UCT should be explicit about which clock it is on**,
because a surface that looks live and is fifteen minutes stale is worse than one
that says "as of 16:05 ET". TERMINAL-CURRENT already does the honest thing in
places (the calendar's Time-TBD bucket for provider gaps).

**CONFIDENCE.** 🟢 on the published numbers (Bloomberg's own words, with a
sample size). 🟡 on whether sub-second is achieved in practice — "targets" is
doing work in that sentence, and it is marketing copy.

**RECOMMENDATION (hypothesis).** A visible as-of stamp on every earnings figure
is cheaper than latency and buys most of the trust. Anti-pattern: a surface whose
freshness is inferable only from whether the number changed.

**OPEN QUESTION.** What does Bloomberg do when the automated extraction and the
analyst review disagree — is a corrected figure re-broadcast, and is the
correction visible on the terminal screen?

---

## 5. Provenance: an N and a name, but the recipe is not public

**OBSERVATION.** Bloomberg exposes consensus provenance at two levels, and
withholds a third.

**Exposed — the count.** `BEst EPS # Ests` is a first-class field: "number of
earnings per share estimates for the specified estimate period". [14] So a user
can always see *how many* analysts stand behind a number.

**Exposed — the contributors.** `EEB` (Estimates Consensus Detail) "showcases
aggregated broker-contributed projections". [14] `ANR` associates **each rating
with a firm and a named analyst**. [10] Babson states the reason plainly: you
learn over time which analysts are more accurate, and you can contact them. [10]

**Exposed — a labelled derived series.** `GUID` shows the company's own current
and historical guidance *and* "Bloomberg's own adjusted guidance and confidence
intervals", where the adjustment "measures historical performance and makes
adjustments for possible bias". [12b] Bloomberg ships the raw and the adjusted
side by side, labelled as different things.

**NOT exposed.** How BEst is *constructed*: staleness cut-offs, outlier trimming,
which contributors are excluded and when. I could not find this publicly
documented anywhere.

**EVIDENCE.**
- [14] WU Vienna University Library, *Forecasts in Bloomberg — Students Manual*,
  `library.wu.ac.at/bib/fit4research/wp-content/uploads/2024/02/Forecasts_manuals_Bloomberg.pdf`.
  Tier: university library guide. Fetched 2026-09-02, text extracted locally.
  **Reported.** "BEst EPS – consensus estimate for adjusted earnings per share.
  The consensus estimate is the mean of sell-side analyst estimates." Note
  **mean**, not median. Also names `BEst Est Long term Growth`. Also records a
  hard limitation: neither EEB nor EM "includes a tool for exporting the data" —
  multi-company forecast extraction must go through the Excel add-in's
  Spreadsheet Builder.
- [12b] Baruch College Newman Library, *Earnings — Guidance* research guide,
  `guides.newman.baruch.cuny.edu/Earnings/guidance`. Tier: university library
  guide. Fetched 2026-09-02. **Reported.** Single source for `GUID`; not
  independently corroborated.
- [6] Bloomberg Professional Services, *Company Financials, Estimates and Pricing
  Point-in-Time*, `professional.bloomberg.com/products/data/enterprise-catalog/cofi/`.
  Tier: official product page. Fetched 2026-09-02. **Verified.** "530+ data
  fields" across "85k companies"; "corporate action adjusted point-in-time
  historical and ongoing company actuals"; "Data for more than 5,000 companies in
  the major world indices are updated the same day their earnings are released;
  new data for other global companies are processed within 24 hours of filing."

**INTERPRETATION.** Bloomberg's answer to "where did this number come from" is
*attribution*, not *methodology*. You can see the N and you can see the names;
you cannot see the filter. For a desk this is usually enough — the N is the
credibility signal and the names are the follow-up path. But it means the
consensus is a black box at exactly the point where two vendors would disagree,
which is why the "which consensus" question (BEst vs I/B/E/S vs Visible Alpha
vs FactSet) is a live one for practitioners rather than a settled one.

**RELEVANCE TO UCT.** UCT's groundedness discipline already insists that a claim
carries a named field path (`lesson_three_rosters_disagree_on_who_reports_today`
— print the union; groundedness = a named FIELD PATH). Bloomberg's practice is
the same instinct applied to third-party numbers: show the count, name the
contributor. TERMINAL-CURRENT surfaces analyst consensus and price targets via
`/api/earnings/intel/{sym}` (Finnhub) without an N or contributor names beside
them. The cheap, faithful version of Bloomberg's idiom is *display the estimate
count next to the estimate*.

**CONFIDENCE.** 🟡 overall. 🟢 that `# Ests` and named-analyst attribution exist
(clear, and consistent across two sources). 🔴 on BEst construction rules —
**this is a hard ceiling: Bloomberg does not publish it.** What would raise it: a
Bloomberg terminal user reading the `HELP` page behind `EEB`/`EEO`, or Bloomberg's
Data License methodology document (not public). The owner cannot supply this
without a subscription.

**RECOMMENDATION (hypothesis).** "N analysts" beside a consensus number is a
near-free provenance upgrade and is the difference between a number and a claim.
Separately: `GUID`'s pattern — **ship the vendor-adjusted series clearly labelled
as adjusted, beside the raw** — is a defensible way to publish a derived estimate
without a second authority over one value, provided the label is unmissable.
Cf. `lesson_a_second_authority_over_one_value`.

**OPEN QUESTION.** Is BEst a mean of *all* live contributions or of a filtered
set, and how old can a contribution be before it drops out? Unanswerable from
public sources; would need terminal `HELP`.

---

## 6. Point-in-time is a separate product — today's consensus is not yesterday's

**OBSERVATION.** Bloomberg sells point-in-time company financials, estimates and
pricing as a distinct dataset [6]. The implication runs the other way: the
terminal's live consensus screens show *the current* consensus, and reconstructing
what consensus was on a past date is a different purchase.

**EVIDENCE.** [6] **Verified.** Point-in-time is framed around "daily snapshots
for every active public company ... latest reported fiscal period data, latest
annual data and LTM data ... delivered at the end of each day", and "corporate
action adjusted point-in-time historical". Restatement handling is *not* spelled
out on the public page — I looked and it is absent.

**INTERPRETATION.** This is the look-ahead-bias problem sold as a SKU. A beat/miss
computed against consensus-as-it-is-today is not the beat/miss the market traded,
because consensus drifts (which is exactly what `EEG` and `EERM` visualize — see
§7). Any historical study of "how do stocks react to beats" is measuring a
different thing depending on which consensus vintage it uses.

**RELEVANCE TO UCT.** Directly relevant to the base-structure library and any
earnings-reaction study the desk runs. UCT's calendar enrichment stores 4Q beat
history and `hist_stats`; if those are computed against currently-published
estimates, the resulting beat rates carry a look-ahead component. This is the
same failure family as
`lesson_a_cluster_bootstrap_only_corrects_the_axis_you_named` — correcting one
bias stales every claim phrased in the moved bound.

**CONFIDENCE.** 🟢 that Bloomberg sells point-in-time separately. 🟡 on the
inference about the terminal's live screens — it follows from the product split
but Bloomberg does not say "the terminal shows current consensus only".

**RECOMMENDATION (hypothesis).** Before any earnings-reaction backtest is
published, state which consensus vintage it used. A study that cannot answer that
question should carry the caveat, not the conclusion.

**OPEN QUESTION.** Do `ERN`/`SURP` store the *as-reported-at-the-time* consensus
for each historical quarter, or do they recompute against current data? This is
the single most decision-relevant unknown in this report and I could not resolve
it. A terminal screenshot of `ERN` for a name with heavily revised history would
settle it.

---

## 7. Revisions and drift are their own named surfaces

**OBSERVATION.** "What is the number" and "what has the street been doing to the
number" are separate screens: `EERM` (estimate revisions) and `EEG` (consensus
change over time, overlaid on the price chart).

**EVIDENCE.**
- [9] Bloomberg, *Equity Portfolio Manager* function card (hosted
  `my.lerner.udel.edu/wp-content/uploads/BB-Equity.pdf`). Tier: Bloomberg-authored
  cheat sheet, historical. Fetched 2026-09-02, text extracted locally.
  **Verified (as Bloomberg's own wording), historical.** "EERM Display earnings
  estimates revisions".
- [1] **Verified.** `EEG` "visualize how consensus sales side estimates have
  changed through time on a single stock plot, or on a range of financial
  measures and periods", so the analyst can "understand how the company is
  perceived by the market and what is already built into the price".
- [10] **Reported.** "The Earnings Estimates Graph (EEG) shows how consensus
  estimates change over time. There are also other measures you can select to
  overlay the stock price chart."

**INTERPRETATION.** The purpose sentence in [1] is the important part: the
pre-print job is not to forecast, it is to establish **what is already in the
price**. Consensus drift plotted against price is a direct read on that. `EEB`'s
selectable "Measure" list [14] and `EEG`'s "range of financial measures" mean
this is not an EPS-only view — the same drift question can be asked of revenue,
margins, or a KPI.

**RELEVANCE TO UCT.** The desk's actual pre-print question — "is this setup
crowded / is the good news in" — is the same question. UCT has no consensus-drift
series and cannot cheaply build one (it needs estimate history). But the *framing*
transfers: TERMINAL-CURRENT's pre-print surface currently answers "what is
expected" and not "how has what-is-expected been moving".

**CONFIDENCE.** 🟢 that both functions exist and what they are for. 🔴 on what
`EERM` actually renders (up/down revision counts? a diffusion index? by broker?)
— one dated one-line description is all I have.

**RECOMMENDATION (hypothesis).** Where a first-derivative series is unaffordable,
a coarse proxy may carry most of the signal: UCT already computes price-relative
strength and could express "expectation drift" crudely as the drift in analyst
price targets, which Finnhub does supply. Label it for what it is — a proxy, not
consensus revisions.

**OPEN QUESTION.** Does `EERM` weight revisions by broker or treat all
contributors equally?

---

## 8. Transcripts are an artifact of the EVENT, and the AI summary indexes the source rather than replacing it

**OBSERVATION.** Bloomberg does not run a transcript library. Transcripts hang off
the calendar event, and are separately searchable as a *document source*.

- `EVTS` carries "live and final transcripts, company presentations, models and
  estimates for earnings events" [2] — note **live vs final** as distinct
  artifacts.
- `DS` searches across 200 million documents, with transcripts as a selectable
  source, using NLP synonyms and AI topic overviews [2][3].
- The AI-Powered Earnings Call Summaries sit **inside** the call: summary points
  are enriched with context links out to `MODL`, `BDVD`, `SPLC`, and clicking a
  summary point **jumps to the corresponding excerpt in the transcript** [4].

**EVIDENCE.**
- [4] Bloomberg press release, *Bloomberg Launches AI-Powered Earnings Call
  Summaries*, 22 January 2024, via PR Newswire
  (`prnewswire.com/news-releases/bloomberg-launches-ai-powered-earnings-call-summaries-302040670.html`;
  Bloomberg's own `bloomberg.com/company/press/...` copy returns 403 to
  non-browser agents). Tier: official press release. Fetched 2026-09-02.
  **Verified/claimed.** Summarized topics are enumerated: guidance, capital
  allocation, hiring and labor plans, macro environment, new products, supply
  chain, consumer demand. Bloomberg Intelligence analysts trained the models.
  A quoted user (Joyce Meng, Fact Capital) says the tool "gives us a big edge"
  in synthesizing trends across companies — **claimed**, it is a vendor-selected
  testimonial.
- [3] **Verified.** `DS` "Search 200 million documents, including research,
  filings, industry news, transcripts and legal & regulatory"; topic trends
  across "any industry, security or portfolio"; findings captured into an
  integrated Notebook (`DS NOTE <GO>`) and shared through IB Chat Forums.
- [13] New York Public Library, *Company Financial Information — Earnings Calls*,
  `libguides.nypl.org/CompanyFinancialInformation/Earnings_calls`. Tier: library
  guide. Fetched 2026-09-02. **Reported.** Confirms the navigation: load the
  ticker, `EQUITY`, then `EVT <GO>`, then look for audio and/or transcript.

**INTERPRETATION.** Three design decisions worth separating.

1. **The transcript is not a destination, it is an attachment.** You reach it by
   asking about the *event*, which is how an analyst actually thinks ("the Q3
   call"), not by browsing a transcript archive.
2. **Live vs final are different artifacts with different trust.** Bloomberg ships
   both and distinguishes them rather than waiting for the good one.
3. **The summary is an index, not a substitute.** Every summary point is a
   *link* — back into the transcript excerpt, and out to the quantitative screen
   that the point implies. The AI output is a navigation layer over the source,
   which means a hallucinated point is checkable in one click.

Point 3 is the most transferable finding in this section and possibly in the file.

**RELEVANCE TO UCT.** TERMINAL-CURRENT already has the pieces: free verbatim
transcripts via AlphaVantage (`av_transcripts.py`), keyword search, TTS, and an
AI call recap with sentiment/guidance/rating-changes (`call_recap.py`, Opus +
Perplexity). What it does not have, on this evidence, is the **link discipline** —
each generated bullet anchored to the transcript span it came from, and to the
UCT screen it implies. UCT's own COT narrative rail already enforces the analogous
gate (every number in the prose must appear in the facts; otherwise nothing is
stored). Extending "grounded" from *numbers must exist* to *claims must be
clickable back to their span* is the same discipline one notch further.

**CONFIDENCE.** 🟢 on the AI-summary mechanics (Bloomberg's own press release,
specific and falsifiable). 🟢 on EVTS carrying transcripts (four sources incl.
two official). 🟡 on coverage — no numbers published for how many companies get a
live transcript or an AI summary.

**RECOMMENDATION (hypothesis).** Anchor every AI-generated earnings bullet to a
transcript offset and render it as a jump link. The cost is storing spans at
generation time; the benefit is that the summary becomes falsifiable by the reader
in one click, which is a stronger guarantee than a post-hoc grounding audit.
Anti-pattern: a summary that reads as authoritative and cannot be traced to a
sentence.

**OPEN QUESTION.** How does Bloomberg handle a *live* transcript summary that the
final transcript contradicts — is the summary regenerated, and is the earlier
version retrievable?

---

## 9. How a professional actually gets through print day

**OBSERVATION.** Assembling Bloomberg's staging [1][8] with one detailed
practitioner account [22] gives a defensible end-to-end. I mark the seams.

| Time | Action | Screen (where evidenced) |
|---|---|---|
| Days out | Link portfolio/watchlist so releases push to you; Outlook integration | `EVTS` [1][2] — **verified** |
| Days out | Establish what is in the price: consensus level + drift | `EE`, `EEG` [1] — **verified** |
| Days out | Set your own line-item forecasts against consensus | `MODL` [2] — **verified** |
| 06:00 ET | Scan overnight moves in dual-listed names | terminal, unspecified screen [22] — **reported** |
| Release | Parse the press release as it crosses; reported data captured automatically | `MODL` [2][3]; feed [7] — **verified** |
| Release +minutes | Diff reported vs consensus at line-item level; contextualize the surprise historically | `MODL`, `GF` [2] — **verified** |
| Release +30–60m | Compliance-approved one-page reaction note: beat/miss, 2–3 drivers, does it change the multiple | [22] — **reported**, not Bloomberg-sourced |
| The call | Listen for guidance changes; live transcript available | `EVTS` [2]; AI summaries [4] — **verified** |
| Post-call | Search the language; find topic inflections across the peer set | `DS`, `KPIC` [2][3] — **verified** |
| Post-call | Rebuild out-year model on new guidance; update comps | `MODL`, `GUID`, `RV` [2][12b] — **partly inferred** |
| EOD | Distribute; discuss | IB Forums, Bloomberg Notes, `MREP` [1][3][8] — **claimed** |

**EVIDENCE.**
- [22] CT Acquisitions, *Sell-Side Analyst: 2026 IB Career Guide*,
  `ctacquisitions.com/sell-side-analyst/`. Tier: practitioner/career commentary
  (secondary; not a first-person account and not verifiable). Fetched
  2026-09-02. **Reported — treat with caution.** Supplies the clock: a 6 a.m.
  start, the "30 to 60 minutes between the release and the 8:30 a.m. ET earnings
  call", the three-bullet reaction note, model rebuild by 10 a.m., recap note by
  end of day. Notably it names **Visible Alpha**, not Bloomberg, as the consensus
  source — see the caution below.

**INTERPRETATION.** Two honest caveats on this table.

First, it is a **sell-side** clock. The deliverable that sets the 30–60 minute
deadline is a published note requiring compliance sign-off. A buy-side PM has no
such deadline — their deadline is the market's, which per [7] is measured in
seconds. The workflow shape is similar; the binding constraint is not.

Second, and worth flagging plainly: **the one detailed practitioner account I
found names a Bloomberg competitor for the consensus step.** That is evidence
against the assumption that Bloomberg owns this workflow end to end, and I am
recording it rather than smoothing it over. Visible Alpha's pitch is precisely
the granular-line-item consensus that `MODL` also claims.

**RELEVANCE TO UCT.** UCT's desk is neither of these personas — it is a small
options/equities desk with no publication deadline and no compliance queue. The
part that transfers is the *sequence* and the fact that each step has a home; the
part that does not is the tempo. UCT's Morning Wire occupies roughly the `MREP`
slot (a scheduled brief) and TERMINAL-CURRENT occupies the `EVTS` + `EE` slots.
There is no UCT equivalent of the release-moment diff, and given the data
constraint in §3, there realistically cannot be a strong one.

**CONFIDENCE.** 🟡 overall — this is a *reconstruction*, not an observed workflow.
The Bloomberg-sourced rows are 🟢; the timing rows rest on a single secondary
account. **Ceiling:** I have no first-person practitioner account. What would
raise it: a Bloomberg-published day-in-the-life video transcript (the webinar [8]
promises exactly this and I could not access its content), or an interview with a
practitioner. The owner may know someone who runs this loop.

**RECOMMENDATION (hypothesis).** For a desk with no publication deadline, the
scarce resource around a print is *attention*, not speed. That argues for the
pre-print and post-print phases (§1) being the ones worth building, and for the
release-moment phase being deliberately ceded.

**OPEN QUESTION.** For a buy-side PM specifically — not a sell-side analyst —
what is actually open on the screen at the moment of the release?

---

## 10. Season-level and industry-level earnings, not just single-name

**OBSERVATION.** The terminal answers "how is earnings season going" as a
first-class question, separately from "how did this company do".

**EVIDENCE.**
- [9] **Verified (historical).** `EA` "Display current earnings season results";
  `BBEA` "Broad market earnings analysis menu"; `BBSA` "Evaluate analyst
  recommendations" (broad market); `NI ERN` "Search global earnings news";
  `WPE` "Access world price/earnings ratios".
- [17] Western University library guide, *Bloomberg — Bloomberg Intelligence*,
  `guides.lib.uwo.ca/bloomberg/intelligence`. Tier: library guide. Fetched
  2026-09-02. **Reported.** BI research "is organized into dashboards for each
  industry that are build around the constituent companies" [sic]; names
  `IFS<GO>` (industry fundamentals), `RES<GO>` (research search), and describes
  `EE` at sector/industry level giving EPS, net income and sales.
- [11] **Reported.** Bloomberg Intelligence is reachable as `BI<GO>` or scoped
  directly, e.g. `BI AIRLN <GO>` for airlines; typing `BI` autocompletes the
  sector list. Scranton calls it "the most efficient way to perform a macro and
  micro analysis of an industry and company" and lists Earnings among its topics.
- [10] **Reported.** `BICO` (BI Primer) → "Related Primers" → Industry is a second
  route into BI from a company page.

**INTERPRETATION.** There is a consistent zoom axis: name → peer set → industry →
season. `KPIC` (§3) and `DS` topic trends (§8) are the same axis expressed on a
KPI and on language respectively. The company screen is never a dead end; every
number has a "compared to whom" door.

**RELEVANCE TO UCT.** UCT has the peer/industry scaffolding already — 12 sectors
and ~112 themes in `themes_taxonomy.json`, plus the Theme Membership Engine
overlay. TERMINAL-CURRENT's earnings modal does not currently use it: a beat is
shown without the "and how did the rest of the theme do" context. That join is
cheap relative to its value and uses data UCT already holds.

**CONFIDENCE.** 🟡 — `EA`/`BBEA` rest on a single dated Bloomberg cheat sheet
[9]; BI's structure is corroborated by three sources and is 🟢.

**RECOMMENDATION (hypothesis).** "This name beat by 4%; its theme is 3-for-5 this
season" is a sentence UCT can already produce and Bloomberg charges for the
industrial version of. Worth prototyping against the existing taxonomy before
considering any licensed data.

**OPEN QUESTION.** Is BI's company-level content genuinely per-company research,
or industry research with company data attached? [17] hedges on this and it
matters for how much a small desk would get from an analogue.

---

## 11. Two loose ends I am NOT going to paper over

**`EA` is ambiguous in the evidence.** Bloomberg's own function card [9] lists
`EA` as "Display current earnings season results" — a broad-market function.
Copenhagen Business School's guide [18] titles a page *"Earnings analysis: Price
reaction (EA)"* — a single-security function. These are different scopes for the
same four letters. Possible resolutions: the mnemonic was repurposed between
c. 2010 and now; there are two functions distinguished by whether a security is
loaded; or one source is simply wrong. **I could not determine which**, and CBS's
page turned out to be a thin index page with no screenshots or step-by-step. This
is worth flagging because it is itself an observation: a four-letter namespace
collides, and a collision is invisible until someone loads the wrong context.

- [18] Copenhagen Business School libguide, *Function — Earnings analysis: Price
  reaction (EA)*, `libguides.cbs.dk/c.php?g=663644&p=4693371`. Tier: library
  guide. Fetched 2026-09-02. **Reported, thin.** Its one substantive line is a
  caveat worth keeping: analysts underestimate that there is no consistent
  relationship between the nature of a surprise and the stock movement.

**No earnings implied-move screen was found.** The contract asks about implied
move. Bloomberg clearly ships the raw materials — `OMON` (real-time option
pricing), `OVME` (price/back-test equity derivative strategies), `OSA`, and
volatility/skew analytics [20] — but **I found no evidence of a dedicated
earnings expected-move function**, and no Bloomberg page describing one. The
practitioner construction (ATM straddle for the first expiry after the print,
optionally netting the pre-earnings straddle to strip ambient vol) is well
documented by third parties but not by Bloomberg. Recording this as an unresolved
gap rather than inferring a function name.

- [20] ISEG Lisbon libguide, *Functions — Terminal Bloomberg EN*,
  `iseg.libguides.com/c.php?g=706923&p=5094213`. Tier: library guide. Fetched
  2026-09-02. **Reported.** `OMON` "See real-time pricing and market data for
  call and put options"; `OVME` "Price and back-test equity derivative products
  and strategies"; also `CACS` (corporate actions/events calendar) and `CM`
  "Monitor the key events influencing a company's stock price".

**RELEVANCE TO UCT.** TERMINAL-CURRENT computes and displays an expected move per
symbol (`get_implied_move` in the calendar enrichment overlay). On this evidence
UCT is **not** behind Bloomberg on surfacing implied move to a non-derivatives
user — if anything the calendar's inline per-name expected move is a more direct
answer to "how much is this expected to move" than anything I could verify on the
terminal. That is a genuine finding and worth not overstating: absence of public
documentation is not proof of absence in the product.

**CONFIDENCE.** 🔴 on both loose ends. Named ceiling: terminal access, or a
Bloomberg options-workflow document I did not find. The owner cannot supply
either without a subscription; a practitioner interview would resolve `EA` in
thirty seconds.

---

## 12. What a small desk should take, and what it should not

**Transferable (hypotheses, not requirements):**

1. **Stage the surface by phase relative to the print**, not by data type (§1).
2. **Every section directly addressable; the menu is an aid, not a gate** (§2).
3. **Show the estimate count beside the estimate**; name the contributor where
   you have one (§5). Near-free.
4. **Anchor every AI-generated bullet to its source span, as a jump link** (§8).
   The strongest single idea in this file.
5. **Never show a surprise without a comparison** — historical base rate, peer
   set, or theme (§3, §10). UCT already holds the data for the weak version.
6. **Ship raw and adjusted side by side, labelled** (`GUID`'s idiom, §5) rather
   than silently replacing one with the other.
7. **Distinguish provisional from final artifacts** rather than waiting for final
   (live vs final transcripts, §8).

**Not transferable / actively unwise to chase:**

- **Segment-level consensus** (§3) is a licensed-data moat, not a UI feature. No
  amount of frontend work substitutes.
- **Sub-second release capture** (§4) is a different business. UCT's desk is not
  trading the two-second reaction; building for it would be expensive and
  unused.
- **Mnemonic sprawl** — fifteen doors for one topic (§0). Bloomberg can afford
  this because its users are professionals with years of muscle memory and a
  training industry (BMC, university guides, this whole evidence base) exists to
  absorb the cost. A small desk plus retail-plus members cannot. The existence of
  Babson's and Scranton's guides *is* the cost, made visible.
- **Four-letter namespaces collide** (§11). Whatever TERMINAL-NEXT's addressing
  scheme is, it should be able to answer "did I load the thing I meant".

---

## GAPS — what the budget did not reach

1. **No screen-level detail for any function.** No screenshots, no column lists,
   no default sorts, no tab structures. Everything in §0 is *purpose*, not
   *layout*. This is the largest gap and it caps §3, §5 and §7 at 🔴 on
   presentation.
2. **BEst construction rules are not public** (§5). Hard ceiling.
3. **No earnings implied-move function verified** (§11). Unresolved, not negative.
4. **`EA` scope ambiguity unresolved** (§11).
5. **`GUID` and `MREP` each rest on a single source.** Not corroborated.
6. **`EERM` render unknown** (§7).
7. **ERN/SURP consensus vintage unknown** (§6) — the most decision-relevant open
   question in the file for anyone doing earnings-reaction research at UCT.
8. **No first-person practitioner account.** §9 is a reconstruction from one
   secondary career-guide article plus Bloomberg's own staging. The one account I
   found names a competitor for the consensus step, which I have recorded rather
   than smoothed.
9. **Bloomberg Intelligence earnings-preview content unverified** (§10) — BI
   dashboards are confirmed; a dedicated earnings-preview product within BI is
   not.
10. **Session-wide WebSearch budget was exhausted** partway through (200/200,
    shared across the wave), which cut off follow-ups on `MREP`, BI earnings
    previews, and further practitioner accounts. WebFetch remained available and
    was used for the remainder. Several university PDFs returned image-only text
    to the fetch tool and were recovered by extracting them locally with
    `pdftotext`; three targeted URL guesses (Baruch transcripts sub-page ×2,
    a Xavier derivatives PDF) returned 404.
11. **`bloomberg.com` returns 403 to non-browser agents.** Official pages were
    read via the `professional.content.cirrus.bloomberg.com` mirror and, for the
    AI-summaries press release, via PR Newswire. Content matched the search
    snippets of the canonical pages in every case, but a reader who wants to
    re-verify should use a browser on the canonical URLs.

**No prompt-injection or instruction-like text was encountered in any source
read for this report.** All sources were descriptive documentation, marketing
copy, or library guidance.

---

## SOURCES

**Primary (official Bloomberg documentation, product pages, press) — 9**

1. Bloomberg Professional Services, *Tools to enhance your earnings season
   analysis*. `https://www.bloomberg.com/professional/insights/markets/tools-to-enhance-your-earnings-season-analysis/`
   (read via `https://professional.content.cirrus.bloomberg.com/professional2023/insights/markets/tools-to-enhance-your-earnings-season-analysis/`).
   Tier: official product/insights page. Fetched 2026-09-02.
2. Bloomberg Professional Services, *Five tools to enhance your earnings season
   analysis*. `https://www.bloomberg.com/professional/insights/financial-services/five-tools-to-enhance-your-earnings-season-analysis/`
   (cirrus mirror). Tier: official. Fetched 2026-09-02.
3. Bloomberg Professional Services, *Research on the Terminal* (case study PDF).
   `https://assets.bbhub.io/professional/sites/10/Research-on-the-Terminal_analyst-web.pdf`.
   Tier: official case study. Fetched 2026-09-02.
4. Bloomberg, *Bloomberg Launches AI-Powered Earnings Call Summaries*, press
   release, 22 Jan 2024, via PR Newswire.
   `https://www.prnewswire.com/news-releases/bloomberg-launches-ai-powered-earnings-call-summaries-302040670.html`.
   Tier: official press release. Fetched 2026-09-02.
5. Bloomberg Professional Services, *Bloomberg Elevates Front Office Efficiency
   With Real-Time Events Data*. `https://www.bloomberg.com/professional/insights/press-announcement/bloomberg-elevates-front-office-efficiency-with-real-time-events-data/`
   (cirrus mirror). Tier: official press announcement. Fetched 2026-09-02.
6. Bloomberg Professional Services, *Company Financials, Estimates and Pricing
   Point-in-Time*. `https://professional.bloomberg.com/products/data/enterprise-catalog/cofi/`.
   Tier: official product page. Fetched 2026-09-02.
7. Bloomberg Professional Services, *Earnings season review with Bloomberg's
   real-time corporate earnings product*. `https://www.bloomberg.com/professional/insights/data/earnings-season-review-with-bloomberg-real-time-corporate-earnings-product`
   (cirrus mirror). Tier: official. Fetched 2026-09-02.
8. Bloomberg Professional Services, webinar page *Navigating Earnings Season:
   Essential Bloomberg Tools for Analysts*. `https://www.bloomberg.com/professional/insights/webinar/navigating-earnings-season-essential-bloomberg-tools-for-analysts/`
   (cirrus mirror). Tier: official (marketing copy). Fetched 2026-09-02.
9. Bloomberg, *Equity Portfolio Manager* function card (PDF), hosted by
   University of Delaware Lerner College.
   `https://my.lerner.udel.edu/wp-content/uploads/BB-Equity.pdf`.
   Tier: Bloomberg-authored reference card — **historical (c. 2010)**. Fetched
   2026-09-02; text extracted locally with `pdftotext`.

**Secondary (university library guides, academic, professional tutorials,
practitioner) — 13**

10. Babson College, Stephen D. Cutler Center for Investments and Finance,
    *Equity Valuation using Bloomberg*, Alex Bowers ('25).
    `https://www.babson.edu/media/babson/assets/cutler-center/Equity-Valuation-using-Bloomberg.pdf`.
    Tier: university tutorial. Fetched 2026-09-02; text extracted locally.
11. University of Scranton, Kania School of Management, *Bloomberg Training
    Manual*. `https://www.scranton.edu/academics/ksom/alperin/Bloomberg%20Training%20Manual.pdf`.
    Tier: university training material. Fetched 2026-09-02; text extracted
    locally.
12. Baruch College, Newman Library, *Earnings — Estimates, Guidance, Call
    Transcripts* research guide. `https://guides.newman.baruch.cuny.edu/Earnings`
    and **[12b]** `https://guides.newman.baruch.cuny.edu/Earnings/guidance`.
    Tier: university library guide. Fetched 2026-09-02.
13. New York Public Library Research Centers, *Bloomberg Terminal — Earnings &
    Estimates* (`https://libguides.nypl.org/c.php?g=1084166&p=8024589`) and
    *Company Financial Information — Earnings Calls*
    (`https://libguides.nypl.org/CompanyFinancialInformation/Earnings_calls`).
    Tier: library guide. Fetched 2026-09-02.
14. WU Vienna University Library, *Forecasts in Bloomberg — Students Manual*.
    `https://library.wu.ac.at/bib/fit4research/wp-content/uploads/2024/02/Forecasts_manuals_Bloomberg.pdf`.
    Tier: university library guide. Fetched 2026-09-02; text extracted locally.
15. Lei, Adam Y.C. & Li, Huihua, *Using Bloomberg Terminals in a Security
    Analysis and Portfolio Management Course*.
    `https://data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf`.
    Tier: academic working paper, Bloomberg-hosted. Fetched 2026-09-02; text
    extracted locally.
16. University of San Diego, *Common Functions Equity Research — Bloomberg
    Terminals*. `https://libguides.sandiego.edu/c.php?g=1305187&p=11445874`.
    Tier: library guide. Fetched 2026-09-02.
17. Western University, *Bloomberg — Bloomberg Intelligence*.
    `https://guides.lib.uwo.ca/bloomberg/intelligence`. Tier: library guide.
    Fetched 2026-09-02.
18. Copenhagen Business School, *Function — Earnings analysis: Price reaction
    (EA)*. `https://libguides.cbs.dk/c.php?g=663644&p=4693371`. Tier: library
    guide (thin). Fetched 2026-09-02.
19. University of Delaware Lerner, *Bloomberg Functions List* (web page).
    `https://lerner.udel.edu/seeing-opportunity/bloomberg-functions-list/`.
    Tier: business-school reference list. Fetched 2026-09-02.
20. ISEG Lisbon, *Functions — Terminal Bloomberg EN*.
    `https://iseg.libguides.com/c.php?g=706923&p=5094213`. Tier: library guide.
    Fetched 2026-09-02.
21. Corporate Finance Institute, *Bloomberg Terminal Functions & Shortcuts —
    Complete List*. `https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/`.
    Tier: professional tutorial — used for **cross-check only**, never as sole
    evidence. Fetched 2026-09-02.
22. CT Acquisitions, *Sell-Side Analyst: 2026 IB Career Guide*.
    `https://ctacquisitions.com/sell-side-analyst/`. Tier: practitioner/career
    commentary — **weakest source in this file**; sole basis for the timing rows
    in §9 and explicitly flagged there. Fetched 2026-09-02.

**Attempted and unavailable:** `bloomberg.com/professional/...` and
`bloomberg.com/company/press/...` (HTTP 403 to non-browser agents — routed via
mirror/PR Newswire); `trustradius.com/products/bloomberg-terminal/reviews`
(403); `wallstreetoasis.com/forum/equity-research/a-day-in-life-of-my-sell-side-days`
(403 — this was the intended first-person practitioner source and its loss is the
main cause of §9's 🟡); Baruch `/Earnings/transcripts` and `/Earnings/calltranscripts`
(404); Xavier derivatives exercise PDF (404).
