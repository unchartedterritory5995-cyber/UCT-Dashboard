---
id: C2-02
title: Events intelligence — catalyst timelines, time models, expected move, call workflows
role: Domain pod — events intelligence
wave: 1b
group: C
category: domain
scope: Unified catalyst timelines (earnings · economic · corporate actions · conferences · FDA · investor days · index rebalances); time-of-day and TBD handling; expected-move integration; live-call and transcript workflows; event replay
confidence: 🟡
evidence_ceiling: TERMINAL-CURRENT grounding (§2) is 🟢 — read directly from `terminal-current-map.md` §0-3, itself code-cited. External benchmark evidence is mixed tier: Quartr/Bloomberg/Koyfin/Benzinga/FactSet/TradingView/Unusual Whales/SpotGamma claims are re-cited from already-accepted Wave-1b dossiers (their own tier and confidence carried forward, not re-verified against the live product) — index rebalances, FDA calendars and Wall Street Horizon are this pass's fresh primary research (2 direct WebFetch page reads, 4 WebSearch result sets). No product in this file was used hands-on; nothing here was seen running. §7 (event replay) has almost no direct evidence in either the internal system or the benchmark set and is flagged, not smoothed over.
sources: 12 primary (5 freshly fetched/searched this pass: Wall Street Horizon, pdufa.bio, S&P 500 rebalance mechanics, FTSE Russell reconstitution, Unusual Whales API/sitemap; 7 official product/doc pages re-cited from accepted Wave-1b dossiers: Quartr, Bloomberg EVTS/CACS, Koyfin, Benzinga, FactSet/StreetAccount, TradingView, SpotGamma); 3 secondary (search-snippet-only, not independently page-fetched); 1 internal (`terminal-current-map.md` §0-3)
uct_relevance: high
status: complete
date: 2026-09-11
---

# C2-02 — Events Intelligence: Catalyst Timelines, Time Models, Expected Move, Call Workflows

**Framing note.** This file asks one question per section: what structural choice does a
benchmark product make about a class of market event, and is TERMINAL-CURRENT already making
that choice, missing it, or making a *different* one worth naming. It is not a feature request
list. Every RECOMMENDATION is a hypothesis, not a requirement — "product X does Y" never implies
"UCT should build Y" (per the program's own framing rule).

**What this file draws on.** One internal file, read in full to the depth the contract allows:
`01-existing-system/terminal-current-map.md` §0-3 (the surface anatomy, event-type data layer,
and 31-route API surface of TERMINAL-CURRENT's `/calendar`). Eight Wave-1b competitor dossiers
under `03-competitive-research/*/dossier.md` (Quartr, Bloomberg, Koyfin, Benzinga Pro, FactSet,
TradingView, Unusual Whales, SpotGamma), re-cited as evidence per the program's KNOWN FACTS
instruction rather than re-derived. Five fresh lookups this pass, done because none of the
Wave-1b dossiers covers **index rebalances** or **FDA/PDUFA catalyst calendars** as a named
event class, and the contract lists both explicitly: two direct WebFetch page reads (Wall
Street Horizon's Global Events Calendar page, pdufa.bio) and three WebSearch result sets
(S&P 500 quarterly rebalance mechanics, FTSE Russell semi-annual reconstitution, FDA/PDUFA
calendar products). `05-product-strategy/domain-news-intelligence.md` (C2-01, already accepted)
was read to avoid overlap — it owns news ingestion/ranking/dedupe; this file owns the timeline
of scheduled and semi-scheduled *events themselves*.

---

## 1. What "events intelligence" means here, and where it stops

**OBSERVATION.** The contract names seven event families — earnings, economic releases,
corporate actions, conferences, FDA, investor days, index rebalances — plus four cross-cutting
concerns: time-of-day/TBD handling, expected-move integration, live-call/transcript workflows,
and event replay. TERMINAL-CURRENT's `/calendar` (display-named "UCT Terminal") already owns
four of the seven families outright (earnings, economic, IPOs, dividends/splits) and none of
the remaining three (corporate actions beyond dividends/splits, conferences/investor days as a
scheduled event type, FDA, index rebalances). C2-01 (news architecture) owns the *feed* that
reports on an event after it happens; this file owns the *calendar* that says an event is
coming, is happening, or has just happened, and the workflows built on top of that timeline.

**RELEVANCE TO UCT.** The dividing line matters for scope discipline: a "unified catalyst
timeline" is a superset of the earnings calendar TERMINAL-CURRENT already has, not a
replacement for it. Section 2 establishes that baseline in detail so the rest of the file
argues about the *delta*, not the whole surface.

---

## 2. The TERMINAL-CURRENT baseline (grounded, not invented)

This section states only what `terminal-current-map.md` §0-3 documents, code-cited. Confidence
is 🟢 throughout unless marked otherwise — it is a direct read of an already-cited internal
artifact, not a re-derivation.

### 2.1 Shape

TERMINAL-CURRENT is a four-view earnings terminal (Wire · Board · Table · Month, plus a
5-tab `/calendar/mystocks` hub) backed by **31 HTTP routes** (27 in `calendar.py`, 4 in
`wire.py`), a **12-panel research modal** grouped into 5 tabs, and **8 non-`/calendar`
consumers** of the same `calendar_weekly` cache key (Dashboard's TheWeek tile, the `/charts`
CalendarWidget, notebook CalendarEmbed, the cookieless `/r/calendar` renderer, OptionsFlow's
load policy, calendar_alerts, the awareness engine's earnings-proximity rule, and the ICS/wire
coverage monitors). The single most load-bearing fact for this file: **`/api/calendar` is a
shared backend contract, not one page's private data** — any redesign of the *surface* is a
much smaller decision than any redesign of the *contract* (`terminal-current-map.md` §0).

### 2.2 Event types already carried

| Event type | Source(s) | Confirmed vs estimated | Where it lives |
|---|---|---|---|
| Earnings (forward + past + actuals) | EarningsWhispers, Finviz Elite, Finnhub, FMP, Massive, yfinance, AlphaVantage | `date_est` flag; per-provider disagreement resolved by a first-placement-wins rule | `_build_current_week()`, a 6-stage merge, `calendar.py:2068-2222` |
| Economic releases | ForexFactory, curated to Medium/High + Fed by `_curate_econ_events` | Provider-native; a hand-typed Fed-chair surname list is a known staleness risk (missed a new Fed Chair once) | `api/routers/calendar.py` §2 |
| IPOs | Finnhub, `ipo_calendar.py` | Provider-native | `GET /api/calendar/ipos`, unauthenticated, 6h cache |
| Dividends / splits | yfinance, `dividends_calendar.py` | Provider-native | `GET /api/calendar/dividends`, paid, 12h cache |
| Catalysts (thematic, not scheduled) | Separate catalyst engine (`/data/catalysts.db`) | N/A — same-day synthesis, not a forward calendar | Reached only *inside* the earnings modal's Catalysts panel, not part of the week payload |

**NOT present in the week payload today, confirmed by the absence of any provider row for
them in `terminal-current-map.md` §2's provider table:** corporate actions beyond dividends/
splits (no M&A, no halts, no offerings), conferences/investor days as a scheduled event class,
FDA/regulatory decision dates, and index rebalance/reconstitution dates. This is the gap
Section 3 sizes against benchmarks.

### 2.3 Time model and TBD handling (directly relevant to this contract's second concern)

TERMINAL-CURRENT's time model is **session-anchored, never clock-time**, and the file's own
words explain why: *"no clock times exist from any provider."* BMO is treated as the window
06:00–09:59 ET, AMC as 16:00–20:59 ET, and TBD as "either" (`calendarTime.js`). Roughly 10% of
Finnhub's past-day rows carry an empty `hour` field and land in a genuine **Time TBD** bucket —
named in the map as "a genuine provider gap, not a bucketing bug." Two further TBD-adjacent
mechanisms exist: a `confirmedOnly` filter keyed on the `date_est` flag (usable only for the
provider legs that populate it — an open question in the map itself), and a **date-drift
chip** (`calendar_date_integrity.py`) that renders "Date moved Jul 28 → Aug 4" when a
previously-seen date changes, fed from the same Finnhub/FMP payloads with no new provider. The
map names the competitive frame for that chip explicitly: *"Wall Street Horizon sells exactly
this to institutions: a wrong or shifted earnings date burns options traders every quarter, and
no retail product flags it."* Section 4 below tests that claim against Wall Street Horizon's
own published methodology.

The **week-anchor rule** (Monday identity on weekdays, rolls forward on Sat/Sun) is implemented
twice — once server-side, once client-side — and cross-checked by a dedicated test on every day
of the week, because a prior mismatch made "Next week ▶" a visual no-op every weekend.

### 2.4 Expected move (directly relevant to this contract's third concern)

TERMINAL-CURRENT's in-house implied-move service (`api/services/implied_move.py`, flag
`IMPLIED_ENRICHMENT_CUTOVER`, **default OFF**) computes `(call mark + put mark) / spot` and
adds a **refusal layer** derived from measurement: an ATM-moneyness bound `|K−S|/S ≤ 0.10`,
chosen because a wide strike grid over a tiny spot produced measured absurdities (MAPS 2150%,
SGMOQ 1675%, NRDY 1373%, CTSO 615% — the arithmetic was correct on 776/776 rows; the strikes
being used were simply too far from spot to mean anything). Refusals are typed: `KIND_UNAVAILABLE`
("we never got an answer") is kept structurally apart from a genuine refusal ("we asked and the
number is not usable"), because — in the map's words — *"telling a member 'we could not price
this' when the truth is 'we never asked in time' is a confident false statement."* This is a
materially more disciplined refusal model than anything found in the benchmark set for this
contract (Section 5).

### 2.5 The modal, the deep link, and what a "unified timeline" would need to preserve

The 12-panel research modal (Setup · Company/Financials · The Print [History/Brief/Call] ·
Coverage [Analysts/Catalysts/News/Filings] · Ask AI) is described in the map as "already
generic" — mounted from two routes and reusing `/research/:sym`'s own tabs — and as "the piece
most likely to survive intact" if the week views are replaced. The `?earnings=SYM&esection=`
deep link is described in-repo as "the most viral surface in the product," resolvable from cold
against three provider ladders with typed failure semantics (an unresolved symbol commits an
explicit `history_unresolved: true` guess rather than a bare shape indistinguishable from "no
history"). Any TERMINAL-NEXT unified timeline inherits an obligation to honor or redirect this
link, not silently drop it — the map calls this out as "the one most likely to be silently
dropped by a rewrite because nothing on screen advertises it."

**CONFIDENCE.** 🟢 throughout §2 — every claim traces to a code-cited line or a named test in
`terminal-current-map.md` §0-3. **EVIDENCE CEILING** carried forward from that file: whether
`IMPLIED_ENRICHMENT_CUTOVER` is actually on in production is NOT DETERMINED from the repository
alone (the map itself flags this as an open question).

---

## 3. The unified catalyst taxonomy — what benchmarks cover that TERMINAL-CURRENT does not

**OBSERVATION.** Laying the benchmark set's own capability maps against §2.2's confirmed gaps
produces a clear ladder of what a "unified catalyst timeline" would need to add, and how deep
each benchmark goes on it.

| Event family | Benchmark depth (best observed) | TERMINAL-CURRENT today | Confidence |
|---|---|---|---|
| **Earnings** | Universal across every product surveyed; Koyfin adds 90-day forward + trailing with analyst-count/median/high/low on consensus | 🟢 Already deep — 6-stage multi-provider merge, sticky actuals, forward-week dedup | 🟢 |
| **Economic releases** | TradingView: "more than 300,000 economic indicators from over 190 countries," filterable by importance/country/timezone [1]; Koyfin: country + timezone selectors, click-for-consensus-and-previous inline chart, FRED tickers usable directly [2]; Bloomberg: `BTMM` displays "all major rates, securities, and economic releases for a selected country" (single undated university manual, 🟡) [3] | 🟢 Present but curated narrowly (Medium/High + Fed only, ForexFactory) | 🟡 |
| **Corporate actions (M&A, halts, offerings, blocktrade)** | Bloomberg `CACS`: "more than 50 event types across asset classes… over one million related actions added annually," automated ingestion plus analysts who "follow the sun" [4]; Benzinga's API exposes ~19 calendar endpoints incl. blocktrade, M&A, offerings, halt/resume [5] | ❌ Absent beyond dividends/splits | 🟢 (absence is a direct read of §2.2's provider table) |
| **Conferences & investor days** | Koyfin's transcript library (`TS`) explicitly covers "shareholder/analyst calls, conferences, summits, presentations, **M&A calls** and investor days" back to 2004 [6]; Wall Street Horizon's Global Events Calendar names "Analyst Days, Company Road Shows, R&D Days, Special Business Updates" and "Presentations at Conferences, Tradeshows, Summits" among 20 tracked event types [7] | ❌ Absent as a scheduled event type (only reachable retroactively via transcripts, and TERMINAL-CURRENT has no forward conference calendar at all) | 🟢 |
| **FDA / regulatory decisions** | Unusual Whales ships a dedicated `/fda-calendar` route and `market/fda-calendar` API endpoint [8]; specialist products (pdufa.bio, BiopharmaWatch, MarketBeat) exist specifically because this is a "make-or-break" catalyst class for a name-specific subset of the universe [9] | ❌ Absent entirely | 🟢 |
| **Index rebalances / reconstitution** | Not productized as a named calendar feature in any dossier read for this contract; the mechanics exist as index-provider methodology (S&P Dow Jones: quarterly rebalance, third Friday of Mar/Jun/Sep/Dec, ~5 trading days' notice before the effective date [10]; FTSE Russell: Russell US Indexes moved to **semi-annual** reconstitution in 2026, with a named "rank day" separate from the announcement and effective dates [11]) | ❌ Absent entirely | 🟡 (mechanics are well-documented by the index providers themselves; no benchmark terminal's *UI treatment* of this event type was found in the accepted dossier set — this is a genuine gap in the research base, not just in UCT) |

**EVIDENCE.** Numbered citations resolve in §12 SOURCES. Corporate-action and rebalance rows
are the two genuinely new findings this pass adds to the program's evidence base — no existing
Wave-1b dossier names either as a first-class calendar concept.

**INTERPRETATION.** The gap is not "TERMINAL-CURRENT's calendar is thin" — §2 shows real
engineering depth on the four families it owns. The gap is that **three whole event families
that move options and equity prices on a schedule (or semi-schedule) have no presence at all**,
and two of them (corporate actions, FDA) are exactly the classes a swing/options desk would
name as catalysts distinct from earnings. Index rebalances are the odd one out: no benchmark
*terminal product* in this research base treats them as a calendar row either (they live in
index-provider PDFs and financial-media explainers, not in a "calendar" UI) — which is itself
a finding: **this may be a genuine white space, not merely a UCT gap**, or the research base
here (Bloomberg's `IPO`/`MARB` mnemonics from the Wave-1b dossier suggest M&A arbitrage gets a
monitor; nothing suggests a rebalance-effective-date monitor exists on Bloomberg either) simply
did not reach the terminal that has one.

**RELEVANCE TO UCT.** For a desk trading US equities and options, index rebalance effective
dates are a genuine, dated, high-volume catalyst (passive fund flows concentrate at the
effective open) with none of the qualitative-judgment cost of an FDA or M&A event — the dates
and constituent changes are index-provider facts, not editorial calls. That combination (cheap
to source, high-conviction timing, no editorial risk) makes it a plausible low-cost first
addition if TERMINAL-NEXT expands the timeline beyond earnings/economic.

**CONFIDENCE.** 🟢 on TERMINAL-CURRENT's current coverage (direct code citation). 🟢 on
Bloomberg CACS, Benzinga's API calendar list, Wall Street Horizon's 20 event types, and Koyfin's
transcript-event-type list (each a direct quote from an official page). 🟡 on the S&P/Russell
rebalance mechanics (WebSearch-synthesized from multiple secondary sources — CME Group's
OpenMarkets explainer, Callan, T. Rowe Price, Traders Magazine — that agree with each other and
with FTSE Russell's own press release, but I did not independently render S&P's own methodology
PDF, which 403'd a non-browser fetch; and did not independently render CME's OpenMarkets page,
which timed out on direct fetch — both are cited as WebSearch results, not page-verified).

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT adds one event family beyond
earnings/economic, index rebalances are the cheapest to source honestly (facts, not
editorial judgment) and the FDA calendar is the one with the clearest desk demand precedent
(an entire specialist-vendor category — pdufa.bio, BiopharmaWatch, MarketBeat, BPIQ — exists
solely to serve it, which is itself evidence of unmet demand a general calendar does not
serve).* Corporate actions in the Bloomberg/Benzinga sense (blocktrade, halts, offerings) are
the most expensive to source credibly and the least differentiated from what a desk already
gets from options-flow and dark-pool surfaces UCT already owns.

---

## 4. Time-of-day and TBD handling — cross-product patterns

**OBSERVATION.** Three distinct disciplines recur across the benchmark set for handling
uncertain or missing event timing, and TERMINAL-CURRENT already independently arrived at a
version of the third:

1. **Confirmed-vs-unconfirmed as an explicit status field.** Wall Street Horizon's own product
   description: *"Earnings Date Status refers to whether the company has confirmed their
   date"* — "Unconfirmed" covers both a date "gathered by their data collection process but
   still considered tentative by the company" and one "estimated by their data analysts based
   on historical trends," with a **separate field for the date and time the confirmation
   announcement itself happened** [7, direct WebFetch this pass]. This is a strictly richer
   model than TERMINAL-CURRENT's binary `date_est` flag: it distinguishes *we estimated it* from
   *the company said something tentative* from *the company confirmed it*, and timestamps the
   confirmation event itself as a trackable moment.

2. **Estimated dates as a visibly different object, not a hedge in prose.** Quartr's calendar
   carries "AI-estimated report dates" as an explicit class (Wave-1b dossier, `/pro` feature
   page, claimed) — the same honest-uncertainty pattern TERMINAL-CURRENT already applies to
   `expected_move_outcome` (null = never attempted vs a typed refusal = attempted and withheld,
   §2.4).

3. **Session-anchored windows over clock times, because clock times do not exist upstream.**
   TERMINAL-CURRENT's own BMO/AMC/TBD model (§2.3) is this pattern already, independently
   arrived at, and the map records why in the code's own words. No benchmark dossier read for
   this contract documents a materially different approach — Koyfin's earnings calendar uses
   the same `A`/`E` (actual/estimate) notation rather than a clock time, and TradingView's
   earnings calendar column is "report timing" (a session label), not a time-of-day [1].

**EVIDENCE.** [7] `https://www.wallstreethorizon.com/global-events-calendar` — direct WebFetch,
2026-09-11, verified (official product page). Quartr and Koyfin citations per Wave-1b dossiers,
already tiered therein.

**INTERPRETATION.** TERMINAL-CURRENT's TBD handling is not behind the benchmark set — its
BMO/AMC/TBD + `date_est` + date-drift-chip combination covers two of the three disciplines
above. The one gap is Wall Street Horizon's **confirmation-event timestamp** — TERMINAL-CURRENT
records that a date *changed* (the drift chip) but not that a date was *confirmed* (a distinct,
earlier-in-the-lifecycle event: "this company just told the world its report date," which is
itself sometimes market-relevant news, independent of whether the date moved).

**RELEVANCE TO UCT.** A confirmation-timestamp field would cost little relative to the existing
`calendar_date_history` table (`calendar_date_integrity.py`) — it is the same event type
(a date fact changing state) generalized by one bit (first-confirmation vs later-drift).

**CONFIDENCE.** 🟢 on Wall Street Horizon's stated field model (direct fetch, verified). 🟡 on
whether any UCT provider (EarningsWhispers, Finviz, Finnhub, FMP) actually distinguishes
"confirmed" from "estimated" upstream in a way TERMINAL-CURRENT could surface without new data
cost — NOT DETERMINED from this file's evidence; the map's own `confirmedOnly` filter section
names this as an open question already (§2.3).

**RECOMMENDATION (hypothesis).** *A three-state date-status model (estimated → company-signaled
→ confirmed, each with its own timestamp) generalizes TERMINAL-CURRENT's existing binary
`date_est` and would let the date-drift chip distinguish "we revised our guess" from "the
company changed its mind" — two very different facts to a desk currently rendered identically.*

---

## 5. Expected-move integration — how benchmarks handle it, and where UCT already leads

**OBSERVATION.** This is the one area where a direct A/B against the strongest available
benchmark (Bloomberg) favors TERMINAL-CURRENT's *design*, if not its default-off deployment
state.

- **Bloomberg has no dedicated earnings expected-move function**, per the Wave-1b dossier's
  explicit finding: *"Implied move: raw materials only — `OMON` option monitor, `OVME` strategy
  pricing; no dedicated earnings expected-move function found"* [12]. A Bloomberg user builds
  the number themselves from the options monitor; the terminal does not compute and label it as
  an earnings-specific artifact.
- **SpotGamma ships a free, narrow version**: an "Implied Earnings Moves" chart, with no
  estimates, no transcripts, no beat history attached — the Wave-1b dossier rates the whole
  earnings-prep workflow "barely served" for this reason [13].
- **Benzinga Pro has no evidence of an expected-move feature at all** in the Pro UI, per the
  Wave-1b dossier's direct read: *"Expected move / options-implied move: no evidence at all in
  the Pro UI"* [5].
- **Quartr does not attempt it** — no price, no options data of any kind is in its product by
  design (Wave-1b dossier §D).
- **TERMINAL-CURRENT's in-house replacement** (§2.4) is the only implementation in this
  research base that (a) computes the ratio from same-instant numerator/denominator, (b) bounds
  it against a measured failure mode (the 2150%-class rows), and (c) types its own refusals so a
  member is never told a confident number that was never actually attempted.

**EVIDENCE.** [12] Bloomberg Wave-1b dossier `04-earnings-estimates.md` §3 (leaf-cited,
tiered 🟢 as a direct dossier finding). [13] SpotGamma Wave-1b dossier, Workflow B section
(tiered 🟢/verified within that dossier). [5] Benzinga Pro Wave-1b dossier §E Workflow B.

**INTERPRETATION.** The implied-move space in this benchmark set is either **absent** (Bloomberg,
Benzinga, Quartr) or **shallow and unrefused** (SpotGamma's free chart, which does not appear to
carry any moneyness bound or unavailable-vs-refused distinction — the dossier records no such
mechanic). TERMINAL-CURRENT's refusal-layer design is genuinely ahead of every product surveyed
on this specific mechanic. Its problem is not the design; it is that the layer carrying that
design is **default OFF** in production (§2.4), so the shipped behavior today may be the older,
unrefused yfinance straddle path the map explicitly flags as the fallback.

**A different-shaped analog worth naming for a different event class:** pdufa.bio's FDA-catalyst
product does not price an implied move, but it does the conceptual equivalent for a
binary-outcome event — it publishes **measured base rates of pre-decision price behavior**:
*"most of the movement happens in the months before the date rather than on it,"* with a stated
median 17.8% gain 120 days before a PDUFA decision versus 2.1% the day before, and an archive of
"462 decisions already made: 347 approvals and 115 Complete Response Letters," each source-linked
with a 120-day price chart [9, direct WebFetch this pass]. This is the same underlying idea as
an "expected move" — quantify what the market has historically done around this event type —
applied to a binary regulatory catalyst instead of a continuous earnings surprise.

**RELEVANCE TO UCT.** Two distinct hypotheses follow, for two different event classes:
(1) for earnings, the existing refusal-layer design is the right shape and the open question
is a deployment decision (flip `IMPLIED_ENRICHMENT_CUTOVER`), not a design gap; (2) if
TERMINAL-NEXT ever adds FDA/regulatory events (§3), the "base-rate run-up" pattern is a more
honest analog to "expected move" than a synthetic options-implied number would be, because a
PDUFA decision's payoff is binary (approval/CRL) rather than a continuous distribution an
options market prices efficiently.

**CONFIDENCE.** 🟢 on Bloomberg/Benzinga/SpotGamma/Quartr's absence-or-shallowness (each a
direct dossier finding, not inference). 🟢 on pdufa.bio's stated methodology (direct fetch,
verified page content, quoted verbatim). 🟡 on whether pdufa.bio's specific percentages
generalize beyond its own sample — no methodology page describing the cohort or statistical
method was reachable in this pass (only the summary page was fetched).

**RECOMMENDATION (hypothesis).** *Ship `IMPLIED_ENRICHMENT_CUTOVER=1` before building anything
new in this space — TERMINAL-CURRENT already has the most disciplined expected-move design
found anywhere in this research pass, and it is not live.* Separately: *if FDA events are ever
added, do not force-fit them into the options-implied-move card; give them their own base-rate
card modeled on pdufa.bio's shape (pre-event run-up distribution + a source-linked outcome
archive), because the underlying statistics are genuinely different (binary regulatory outcome
vs continuous earnings surprise).*

---

## 6. Live-call and transcript workflows — the Quartr-anchored pattern

**OBSERVATION.** Quartr is the sharpest available answer in this research base to "what does a
best-in-class prepare-for-the-call surface look like when that is the whole company," and its
central finding transfers directly regardless of whether TERMINAL-NEXT ever resembles Quartr
in scope: **every documented navigation action in the product is the same primitive — take the
user to the exact place a claim came from** (Quartr Wave-1b dossier §C). Calendar row, search
result, keyword alert, AI-chat citation, and slide-history comparison are five different doors
onto one behavior: click → land on the source, at the sentence, with the audio cued to that
moment.

Three concrete mechanics worth naming for TERMINAL-NEXT specifically:

1. **Hierarchical, timestamped chapters with a containment invariant.** Quartr's API exposes
   `level` 1..n chapters (e.g., "Prepared Remarks," nested "Q&A" segments) with `startTimestamp`/
   `endTimestamp` in seconds and an enforced invariant that every child's range sits strictly
   inside its parent's — verified directly against Quartr's own developer documentation
   (Wave-1b dossier §C, Tier 4).
2. **Progressive enrichment of one page rather than a completeness gate.** A Quartr event page's
   AI summary exists "minutes after documents are published" from the report alone, then
   improves as slides and the transcript arrive — the page gets better while a reader is on it,
   rather than staying empty until everything has landed (Wave-1b dossier §J).
3. **A percentile-and-window SLA stated as a contractual number**, not a vague "real-time"
   claim: "90% streamed and transcribed within 5 seconds of event start," "transcripts available
   for 95% of events within 45 minutes" (Wave-1b dossier §F, Tier 4 developer docs — the
   strongest evidence class in that dossier).

**How the rest of the benchmark set compares on the same workflow:**

- **Koyfin's transcript library** is broader in scope but shallower in navigation depth:
  "9000+ public companies… going back to 2004," explicitly covering "earnings calls,
  shareholder/analyst calls, conferences, summits, presentations, M&A calls and investor days,"
  with an "Advanced Search across the entire transcript library" [6]. It has no live-call
  audio, no chapters, and no cited claim of a citation-as-navigation model — it is a search
  index over a document corpus, not an event-page product.
- **Bloomberg's `EVTS`** carries "live and final transcripts, company presentations, models and
  estimates for earnings events" as distinct artifact types [14], with a separately-launched
  AI summary feature (press release, 2024-01-22) covering "guidance, capital allocation, hiring
  and labor plans, macro environment, new products, supply chain, consumer demand" [15]. Notably,
  the Wave-1b dossier could find **no `TRAN` transcript-specific mnemonic** — the transcript
  door is `EVTS` (the event itself) plus `DS` (cross-transcript search), i.e., Bloomberg treats
  a transcript as an attachment to the calendar event, not a separate product surface — the
  opposite of Koyfin's document-library framing.
- **FactSet/StreetAccount's named triad** — Earnings Preview → Conference Call Guidance →
  Street Takeaways, with "Transcript Intelligence" (LLM-generated summaries reviewed by human
  experts) and a two-way "Transcript Assistant" chat over the transcript [16] — is the
  benchmark set's best-worked *information architecture* for this workflow, independent of
  Quartr's navigation-primitive finding. Its distinguishing property is a published human-review
  claim: *"AI-generated StreetAccount summaries that are reviewed by those same experts"* [16].

**RELEVANCE TO UCT.** TERMINAL-CURRENT already has the raw material for most of this: free
verbatim transcripts via AlphaVantage (`av_transcripts.py`), keyword search inside the modal,
TTS "Listen," and an AI call recap with sentiment/guidance/rating-change extraction
(`call_recap.py`, per `terminal-current-map.md` §1.6's panel list — `history`, `brief`, `call`
under "The Print" group). What it does not have, on the evidence in this file, is (a) Quartr's
click-to-exact-sentence-and-audio-moment navigation primitive, (b) a chapter/segment model with
Quartr's containment invariant, and (c) FactSet's named-and-reviewed triad framing (UCT's
`call_recap.py` output is not, per this contract's evidence, labeled with a review status the
way StreetAccount's is).

**CONFIDENCE.** 🟢 on Quartr's chapter model and SLA figures (Tier 4 developer docs, re-cited).
🟢 on FactSet's triad and human-review claim (official product page, re-cited). 🟢 on Bloomberg's
`EVTS`/no-`TRAN` finding (the Wave-1b dossier treats this as a corrected error, worth trusting
at the tier it states). 🟡 on how UCT's `call_recap.py` output is actually labeled to members
today — NOT DETERMINED from `terminal-current-map.md` §1-3 alone (this contract's internal-file
allowance does not extend to reading `call_recap.py` itself).

**RECOMMENDATION (hypothesis).** *Two structural additions, cheap relative to their evidence
base: (1) a chapter/segment model on TERMINAL-CURRENT's existing transcripts, even a flat one
without Quartr's full containment invariant, so "jump to the Q&A" becomes a click instead of a
scroll; (2) a visible review-status label on `call_recap.py`'s output (e.g., "AI-generated,
not reviewed" vs a future reviewed state), because StreetAccount's dossier finding is that
naming what is and is not reviewed is itself a trust-building feature, not overhead.*

---

## 7. Event replay — the weakest-evidenced section, named honestly

**OBSERVATION.** No product surveyed in this research base ships a feature that matches the
contract's "event replay" concept in the sense of *reconstructing a historical catalyst
event with its surrounding context* (the news/transcript/price action available at the time,
replayable as if watching it unfold again). The closest analogs found are narrower in
different directions:

- **TradingView's Bar Replay** is a genuine replay mechanic, but it replays **price bars only**
  — it has no catalyst awareness. It is documented as a **tiered, published-depth feature**:
  Essential gets "6 months of 1-minute / 30 months of 5-minute" replay depth, Plus gets "1 year
  of 1-minute / 5 years of 5-minute," and Premium/Ultimate ("Expert and Ultimate") "allow you to
  play absolutely all time-based data available in TradingView's data storage" [1, Wave-1b
  dossier, Tier 1 verified]. This is a strong, transferable pattern for **publishing exactly how
  far back a replay works, per plan and per interval** — but it answers "what did the tape do,"
  never "what happened and what did the tape do about it."
- **pdufa.bio's per-decision archive** (§5) is the closest thing to catalyst-aware replay found
  in this pass: each of "462 decisions already made" is stored with a 120-day price chart and a
  source link back to the FDA notice or company filing that produced it [9]. This is catalyst
  replay for one narrow event type (binary FDA decisions), not a general mechanism.
- **Quartr's on-demand replays** are full audio/transcript replays of a specific earnings call
  ("live audio, real-time transcripts, slide presentations, summaries, **or on-demand replays**"
  — Wave-1b dossier §C) — genuinely catalyst-aware, but scoped to the call itself, not to "what
  the tape did during and after."

**No product in this research base combines the two halves** — TradingView's tape-only replay
and Quartr's/pdufa.bio's catalyst-only replay — into one "replay this earnings call/FDA decision
*and* watch the price react in sync" mechanic.

**INTERPRETATION.** This is a genuine white space relative to the products surveyed, but the
finding rests on absence-of-evidence across eight dossiers plus five fresh lookups, not on an
exhaustive market survey — "event replay" as the contract phrases it may exist in a product
this pass did not reach (see GAPS).

**RELEVANCE TO UCT.** TERMINAL-CURRENT already has every raw ingredient a combined replay would
need: historical bars (Massive/Polygon-backed, 5000-bar depth per the codebase's chart
architecture), the earnings modal's History/Brief/Call panels, and (per §6) verbatim
transcripts with timestamps once a chapter model exists. No new data source is implied — only a
UI mode that plays them back in sync.

**CONFIDENCE.** 🔴 for "no such combined feature exists anywhere" — this is an absence claim
built on a bounded, named source set, not a market-wide audit. 🟢 for the specific claims about
TradingView's tiered replay depth and Quartr's on-demand replays and pdufa.bio's archive
individually (each is a direct dossier or WebFetch finding). **EVIDENCE CEILING:** a dedicated
search pass against event-study / backtesting-visualization tools (e.g., academic event-study
software, or specialist "earnings reaction replay" tools if any exist) was not run — this
contract's budget went to the five families explicitly named ahead of event replay. Named as a
gap below, not smoothed over.

**RECOMMENDATION (hypothesis).** *If TERMINAL-NEXT ever builds an event-replay mode, the
differentiated version combines TradingView's tape-replay mechanic with a synced transcript/
news timeline drawn from data TERMINAL-CURRENT already holds — worth prototyping cheaply
before assuming it needs new data, since the individual halves already exist in the codebase.*

---

## 8. Design hypotheses for TERMINAL-NEXT (aggregated)

Each restates a RECOMMENDATION above with its serving workflow; none is a requirement.

1. **Ship the existing refusal-layer expected-move design** (§5) — the highest-confidence,
   lowest-new-build recommendation in this file, because the gap is deployment, not design.
2. **A three-state date-status model** (estimated → company-signaled → confirmed, each
   timestamped) generalizing the existing binary `date_est` flag, modeled on Wall Street
   Horizon's confirmed/unconfirmed field (§4).
3. **A base-rate card, not a synthetic implied-move card, for any future FDA event type** —
   modeled on pdufa.bio's pre-decision run-up statistics and source-linked outcome archive (§5).
4. **A chapter/segment model on existing transcripts**, even flat, ahead of Quartr's full
   containment invariant, to make "jump to Q&A" a click (§6).
5. **A visible review-status label on AI-generated call recaps** — "AI-generated, not reviewed"
   as an honest default state, modeled on StreetAccount's published review claim (§6).
6. **Index rebalance effective dates as the cheapest new event family to add**, if TERMINAL-NEXT
   expands the timeline beyond earnings/economic — facts, not editorial judgment, and a known
   catalog of index-provider methodology to source from (§3).
7. **A confirmation-event timestamp reusing the existing `calendar_date_history` schema shape**
   (§4) rather than a new table — generalizing "a date changed" to also capture "a date was
   first confirmed."
8. **A combined tape-plus-transcript replay mode**, prototyped from data TERMINAL-CURRENT
   already holds before assuming new data is required (§7).

---

## 9. Anti-patterns worth naming

1. **A synthetic expected-move number with no refusal layer**, the way SpotGamma's free
   Implied Earnings Moves chart appears to work (§5) — TERMINAL-CURRENT's own measured 2150%-
   class failure mode is the concrete cost of skipping this.
2. **Treating a transcript as a separate product from the calendar event that produced it**,
   the way Koyfin's document-library framing does — Bloomberg's `EVTS`-carries-the-transcript
   model (§6) keeps the citation attached to the moment it came from, which is the property
   Quartr's whole navigation model depends on.
3. **A binary confirmed/estimated flag with no confirmation timestamp** — TERMINAL-CURRENT's
   current `date_est` model, adequate today but strictly less expressive than Wall Street
   Horizon's three-part field (§4), and the gap costs nothing to close given the schema already
   exists for date drift.
4. **Publishing coverage or performance numbers that disagree with themselves across surfaces**
   — not found in this file's own evidence base for TERMINAL-CURRENT, but flagged because
   Quartr's Wave-1b dossier records exactly this defect (15,000/15,200/16,000 companies; three
   different numbers on three of its own pages) as a trust smell for a product whose entire
   pitch is traceability — the same hand-typed-count-beside-the-artifact class this codebase
   has paid for repeatedly elsewhere.

---

## 10. GAPS

- **Index rebalance UI treatment was not found in any benchmark terminal product**, only in
  index-provider methodology documents and financial-media explainers. Whether Bloomberg,
  FactSet, or a specialist vendor surfaces rebalance effective dates as a calendar row was not
  established either way — this is a gap in the research base, named rather than assumed to be
  either "nobody has this" or "everybody has this and I missed it."
- **S&P Dow Jones' own methodology page returned HTTP 403** to a non-browser fetch, and a direct
  fetch of CME Group's OpenMarkets explainer timed out; both facts in §3/§8 rest on WebSearch's
  synthesized result set (multiple independent secondary sources agreeing), not on an
  independently rendered primary page. A browser-based fetch (via the claude-in-chrome tools)
  would raise this from 🟡 to 🟢 and was not attempted this pass given budget.
- **biopharmcatalyst.com's PDUFA calendar page could not be rendered** — the fetch returned only
  a cookie-consent shell (JS-rendered content). pdufa.bio was used instead and did render fully;
  the two products were not cross-checked against each other.
- **Whether UCT's `call_recap.py` output carries any review-status label today is NOT
  DETERMINED** — this contract's internal-file allowance is `terminal-current-map.md` §1-3 only,
  which references `call_recap.py` by name but does not detail its output labeling.
  `terminal-current-map.md` §4 onward (Persistence, Jobs, Workflows) was intentionally not read
  — out of this contract's permitted scope — and might resolve this without new external
  research.
- **No dedicated search pass was run for "event replay" as a distinct product category**
  (e.g., academic event-study tools, or a specialist product doing exactly this) — five
  searches went to the five families the contract names ahead of replay; §7's absence claim is
  bounded by that choice, not by an exhaustive market sweep.
- **Every Wave-1b-dossier-mediated claim in this file (Quartr, Bloomberg, Koyfin, Benzinga,
  FactSet, TradingView, SpotGamma, Unusual Whales) was re-cited, not re-verified against the
  live product** — per the program's explicit instruction ("cite them as evidence, do not
  re-derive"). Their own stated evidence ceilings (mostly: no hands-on seat, marketing vs
  documentation tiering) apply transitively here and are not repeated claim-by-claim above
  beyond the 🟢/🟡/🔴 markers already carried forward.
- **WebSearch worked normally this session** (unlike the killed 2026-09-02 run, whose
  `_EXTERNAL_PREAMBLE.md` records the shared cap as exhausted at that time) — five WebSearch
  calls and two direct WebFetch page reads were made without any throttling observed. Later
  roles in this wave should not assume the cap note in the preamble still applies; check fresh.

---

## 11. SOURCES

Tier per the program's evidence ladder. Fetched/searched 2026-09-11 unless noted (Wave-1b
dossier-mediated sources carry their original 2026-09-02 fetch date, preserved from the cited
dossier).

**Fresh this pass — direct WebFetch (Tier: official product page, verified)**

1. Wall Street Horizon, *Global Events Calendar* — https://www.wallstreethorizon.com/global-events-calendar — fetched 2026-09-11, **verified**. 20 event types across 11,000+ companies; sourcing methodology ("press releases, company websites, SEC and SEDAR filings, and corporate IR information"); confirmed/unconfirmed date status model quoted from the associated Wall Street Horizon documentation surfaced in the same lookup.
2. pdufa.bio — https://www.pdufa.bio/ — fetched 2026-09-11, **verified**. 47 upcoming 2026 PDUFA dates; pre-decision run-up statistics (median 17.8% at 120 days vs 2.1% day-before); 462-decision source-linked archive; 285 indexed clinical readouts.

**Fresh this pass — WebSearch result sets (Tier: mixed — index-provider primary facts triangulated across secondary explainers; not independently page-rendered)**

3. S&P 500 quarterly rebalance mechanics (third Friday of Mar/Jun/Sep/Dec; ~5 trading days' notice; announcement after close, effective the following Friday) — synthesized from CME Group *OpenMarkets*, `https://www.cmegroup.com/openmarkets/equity-index/2025/Navigating-the-S-P-500-Rebalance-A-Quarterly-Market-Ritual.html` (direct fetch timed out; used via WebSearch synthesis) plus corroborating secondary pages (StockTitan, MinMaxDoc, FatFire) surfaced in the same search — **reported/secondary**, not independently rendered.
4. FTSE Russell, *Russell Reconstitution* — https://www.lseg.com/en/ftse-russell/russell-reconstitution and the June 2026 press release https://www.lseg.com/en/media-centre/press-releases/ftse-russell/2026/ftse-russell-begins-june-2026-semi-annual-russell-us-indexes-reconstitution — via WebSearch synthesis, corroborated by Callan and T. Rowe Price explainers in the same result set. **Reported**, official press release cited but not independently page-rendered this pass.
5. FDA/PDUFA calendar product category (MarketBeat, BiopharmaWatch, Dan Sfera's Biotech Catalyst Calendar, BPIQ) — https://www.marketbeat.com/fda-calendar/upcoming/, https://www.biopharmawatch.com/fda-calendar, https://dansfera.com/, https://app.bpiq.com/pdufa-calendar — via WebSearch, used only to establish that a specialist-vendor category exists for this event type (evidence of demand), not for their individual feature claims.

**Re-cited from accepted Wave-1b dossiers (tier and fetch date as originally stated therein — 2026-09-02)**

6. Quartr — `03-competitive-research/quartr/dossier.md` §C, §F, §I (event calendar navigation primitive, chapter model at `quartr.com/docs/datasets/chapters.md`, delivery SLAs at `quartr.com/docs/data-overview.md`, on-demand replays, AI-estimated report dates) — Tier 3-4, verified.
7. Bloomberg — `03-competitive-research/bloomberg/04-earnings-estimates.md` (EVTS corporate events calendar, no dedicated expected-move function, no `TRAN` mnemonic, AI summary press release) and `03-competitive-research/bloomberg/dossier.md` (CACS corporate actions, 50+ event types / 1M+ actions/yr) — Tier 3-4, verified/claimed as marked in the source dossier.
8. Koyfin — `03-competitive-research/koyfin/dossier.md` §D, §E (earnings calendar, economic calendar, transcript library covering conferences/investor days/M&A calls, master transcript search) — Tier T1 (official help center), verified.
9. Benzinga Pro — `03-competitive-research/benzinga-pro/dossier.md` §D, §F (13-calendar UI suite, ~19 API calendar endpoints incl. FDA/halt-resume/M&A/blocktrade/offerings, no evidence of an expected-move feature) — help-center articles, verified.
10. FactSet — `03-competitive-research/factset/dossier.md` §D (StreetAccount Earnings Preview → Conference Call Guidance → Street Takeaways triad; human-reviewed AI transcript summaries) — official product page, verified.
11. TradingView — `03-competitive-research/tradingview/dossier.md` §D, §F (economic calendar scale claim, earnings calendar columns, tiered Bar Replay depth) — official docs/support pages, verified.
12. Unusual Whales — `03-competitive-research/unusual-whales/dossier.md` §D (dedicated `/fda-calendar` and `/economic-calendar` routes, confirmed via public sitemap and OpenAPI spec) — official sitemap + API spec, verified.
13. SpotGamma — `03-competitive-research/spotgamma/dossier.md` Workflow B (free Implied Earnings Moves chart; earnings-prep rated "barely served") — official free-tools page, verified.

**Internal (this contract's sole permitted internal file)**

14. `01-existing-system/terminal-current-map.md` §0-3 — TERMINAL-CURRENT surface anatomy, event-type data layer (6-stage earnings merge, ForexFactory economic curation, IPO/dividend calendars), time model (session-anchored BMO/AMC/TBD, week-anchor rule), expected-move refusal layer (`implied_move.py`, ATM-moneyness bound), date-drift chip, and 31-route API surface. Code-cited throughout; read in full for the sections this contract permits.

**Cross-reference (read, not re-cited as a claim source — used only to avoid overlap)**

15. `05-product-strategy/domain-news-intelligence.md` (C2-01, accepted) — confirmed it owns news ingestion/dedupe/ranking, not the scheduled-event timeline this file covers.
