---
id: C2-01
title: News architecture patterns — ingestion, tagging, ranking, alerting across benchmark products
role: Domain pod — news architecture patterns
wave: 1b
group: C
category: domain
scope: Ingestion and multi-source aggregation; dedupe/story-versioning; entity tagging and the topic spine; importance ranking (editorial vs algorithmic — Benzinga's ladder, Bloomberg's NI codes); latency tiers and their cost; personalization by watchlist; saved-search-to-alert promotion; read/unread and noise control; feeds vs panels vs streams as surface shapes
confidence: 🟡
evidence_ceiling: No hands-on access to any live product. Bloomberg evidence is Wave-1b's dossier, already CAPTCHA-limited on several primary pages. Benzinga evidence combines the Wave-1b dossier with five fresh fetches against Benzinga's own API reference (2026-09-02) — genuinely primary but scoped to the API surface, not the Pro UI. Koyfin and AlphaSense evidence is Wave-1b's dossier D-sections only, not independently re-verified. WebSearch was exhausted before this role started (per-session cap hit by earlier roles); all evidence here is WebFetch on known/derived URLs plus the internal dossiers this contract names. No browser-search fallback was used (no query needed one this pass — every fetch targeted a specific known documentation path).
sources: 6 primary (Benzinga API reference, fetched fresh this pass); 4 secondary-primary (Wave-1b dossiers: Bloomberg, Benzinga Pro, AlphaSense, Koyfin — each independently source-graded therein); 2 internal (provider ledger, existing-ai-systems)
uct_relevance: high
status: draft
date: 2026-09-02
---

# C2-01 — News Architecture Patterns Across Benchmark Products

**Framing note.** This file synthesizes *design patterns*, not a product review. Every
section asks: what structural choice does a news surface make, and does UCT's current data
diet make that choice reachable, partly reachable, or blocked. Benchmarks are sources of
learning — nothing here says TERMINAL-NEXT should build what a competitor built.

**What this file draws on.** Four Wave-1b dossiers already did the primary-source legwork
this contract points at: Bloomberg (`03-competitive-research/bloomberg/03-news-alerts.md`,
12 sections, 27 sources, dense), Benzinga Pro (`03-competitive-research/benzinga-pro/dossier.md`
§D "News (the core)" + §D "Alerts"), AlphaSense (`.../alphasense/dossier.md` §D), and Koyfin
(`.../koyfin/dossier.md` §D + workflow D). I re-cite their findings rather than re-deriving
them (the contract's instruction), and I add five **fresh fetches this pass** against
Benzinga's own API reference (`docs.benzinga.com`) that reached primary schema detail none
of the four dossiers had — the WIIM/News API field list, the WebSocket stream's event model,
and the removed-news endpoint. Those are new evidence, credited as such below. Two internal
files ground the "achievable today" columns: `02-data-providers/provider-ledger.md` (what
UCT already pays for) and `08-ai/existing-ai-systems.md` §1 (what UCT already summarizes).

---

## 1. Ingestion: one spine, many mouths, or many spines glued at the UI?

**OBSERVATION.** The four products split into two ingestion shapes. Bloomberg and Benzinga
are **wire aggregators with a proprietary editorial layer on top** — Bloomberg blends
1,000+ external providers plus its own 2,700-journalist newsroom into one tagged pool
(`03-news-alerts.md` §10); Benzinga blends its own **BZ Wire** (staff + "news tips from
real reporters") with **Jiji Press, Partner Links, Press Releases, SEC filings and Transcript
Summaries** as distinct, separately-filterable *Sources* inside one newsfeed (Benzinga
dossier §D, citing help article 11). Koyfin and AlphaSense are **single premium feed +
document corpus** shapes: Koyfin licenses one wire (**MT Newswires**) and organizes it into
category sections (Koyfin dossier §D, [S27]); AlphaSense ingests filings, transcripts and
broker research as documents, plus "RSS feed ingestion (user-added)" as its only news-proper
lane (AlphaSense dossier §D) — it is not primarily a news product at all.

**EVIDENCE.** Bloomberg dossier §10 (news product page, Tier 3, 🟡): "2,700 journalists,
1,000+ external news providers, 146 global bureaus." Benzinga dossier §D (help article 11,
Tier 2, 🟢): seven newsfeed source types including SEC and Transcript Summaries as first-class
sources, not a separate tab. Koyfin dossier §D ([S27], Tier T1, 🟢): "MT Newswires premium
feed." AlphaSense dossier §D (Tier T1, 🟢): "News & Regulatory perspective; RSS feed
ingestion (user-added); trade press" — the thinnest news lane of the four by the dossier's
own read.

**INTERPRETATION.** The choice is not "how many wires" but **whether the product treats a
wire as a *source tag on one feed* or as a *separate surface*.** Bloomberg and Benzinga both
choose the former — `NH` (source) is one axis beside `NI` (topic) in the same query grammar
(Bloomberg §3); Benzinga's *Sources* filter sits beside *Categories*, *Sectors*, *Watchlists*
in one filter panel (Benzinga §D). That is what makes a saved filter combine "this topic,
from this source, about this ticker" as one object rather than three separate lookups.

**RELEVANCE TO UCT.** UCT's news ingestion is already multi-source but the sources are not
one filterable pool — they are a **priority-ordered fallback chain**, not a blend. Per the
provider ledger's News row: `AV NEWS_SENTIMENT → 7 RSS feeds → Massive /v2/reference/news →
FMP stable/news/* → Finviz news_export → Google News RSS` (`provider-ledger.md:193`), where
each later source is consulted *only when the earlier one fails or is throttled*
(`engine.py::get_news()`), not blended with it. That is architecturally the opposite of
Bloomberg/Benzinga's "many sources, one filterable pool" — it is closer to a single degraded
pipe with five backup pipes behind it. The Twitter/X poller (`twitterapi_io.py`) and the
Stock Catalysts engine's 8 parallel source pulls (`CLAUDE.md` "Stock Catalysts" section) are
the one place UCT already does true multi-source blending — but that blend feeds a
20-row-per-day synthesis, not a general newsfeed a user can filter by source.

**CONFIDENCE.** 🟢 on what each product's dossier documents. 🟡 on whether "fallback chain
vs blended pool" is UCT's deliberate design or an artifact of quota management (AV 25/day,
Finnhub rate limits) — the provider ledger frames it as cost-driven, not editorially chosen.

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT ever exposes a general newsfeed (as
opposed to the curated Stock Catalysts tile), the fallback chain would need to become a
*source tag* on unified stories rather than a silent substitution — otherwise a user cannot
learn "I get RSS on quiet days and AV on quota-available days," which is exactly the kind of
undisclosed mode-switch the Bloomberg dossier's §2 flags as the thing a vendor should *name*,
not hide (Bloomberg §2, "naming the mode").

**OPEN QUESTION.** Does UCT's catalyst engine's 8-source blend ever get exposed to a member
as "why this row exists," the way Bloomberg's tag-vs-keyword split is user-visible? The
catalyst tile's ⓘ citations popover (`CatalystTable.jsx`, per `CLAUDE.md`) suggests partial
yes — worth confirming against the live UI, which this role could not reach.

---

## 2. Entity tagging and the topic spine: three different shapes for "what is this about"

**OBSERVATION.** Three distinct tagging architectures, at three different scales:

- **Bloomberg**: two orthogonal controlled dictionaries — `NI` (topic, "thousands of subject
  or topic codes") and `NH` (source/wire) — plus security tickers and person BIO codes, with
  a stated **composability rule**: `NI ECO BN` = topic × source, source always second
  (Bloomberg §3). Everything downstream (search, security page, alert, Launchpad, the
  enterprise feed) reads the *same* filter expression.
- **Benzinga**: a flatter, product-scoped taxonomy — **23 named Categories** (Market Moving
  Exclusives, Analyst Ratings, FDA, M&A, Rumors, Short Sellers, …), plus a separate
  **Channels** dictionary reachable via API (`get-available-news-channels`, fetched this
  pass) whose own documentation states *"Channels can have sub-channels, but they will all be
  listed as their own item"* — i.e. **deliberately flattened, not hierarchical**, unlike
  Bloomberg's drill-down (`NI <GO>` → Topics → Business News → Industries → Technology,
  Bloomberg §3). Ticker association is itself two-tiered: the News API's `stocks` array
  distinguishes `tickers` (any mention) from `primaryTickers` ("filters by primary ticker
  association only") — a coarser but real analogue of Bloomberg's per-tag relevancy score
  (Bloomberg §7).
- **Koyfin**: **"over 700 topics"** for custom news screens (Koyfin dossier §D, [S27]), plus
  a separate per-security **Highlight Terms** mechanic (colour a term without filtering,
  the same idea as Bloomberg's category-colouring, §6) — but no published relationship
  between the 700 topics and any other taxonomy in the product (no cross-reference to
  screener criteria or watchlist tags documented).
- **AlphaSense**: no topic dictionary at all in the news lane — classification lives in its
  document layer instead (Company Profiles, Industry Comps), and news proper is the thinnest
  capability of the four (AlphaSense dossier §D: "thin").

**EVIDENCE.** Bloomberg §3 (Bloomberg-authored *News Searches* PDF, Tier 2, 🟢, verbatim NI/NH
grammar + composability rule). Benzinga dossier §D (help article 11, Tier 2, 🟢, 23-category
list) + **fresh fetch this pass**: `docs.benzinga.com/api-reference/news-api/channels/get-available-news-channels.md`
(Tier 2, official API reference, fetched 2026-09-02, 🟢) — "flat list... Channels can have
sub-channels, but they will all be listed as their own item"; `docs.benzinga.com/api-reference/news-api/wiims/get-wiims.md`
and `.../get-news-items.md` (same tier, same date, 🟢) — `stocks` array with `tickers` vs
`primaryTickers` as separate filter parameters. Koyfin dossier §D ([S27], Tier T1, 🟢).
AlphaSense dossier §D (Tier T1, 🟢).

**INTERPRETATION.** Bloomberg's hierarchy buys drill-down navigation at the cost of a
classification department (2,700 journalists) UCT cannot replicate. Benzinga's flat channel
list is the cheaper shape — a tag is a tag, sub-channels are just more tags — and it still
gets 90% of the value (filter by X) without needing anyone to maintain a hierarchy. The
`tickers`/`primaryTickers` split is the single most transferable idea in this section: it is
a *cheap, binary* version of Bloomberg's relevancy score (one bit — "primary or not" — rather
than a continuous 0–1 weight), and it is exactly the axis UCT's own cashtag extractor lacks
(the tweet-ticker-extraction regex, per the provider ledger, "treats every `$TICKER` in a
tweet as equally about that ticker" — this is the Bloomberg dossier's §7 finding restated in
UCT's own code).

**RELEVANCE TO UCT.** UCT already runs **three unrelated classification systems** the
Bloomberg dossier's §3 flagged as an anti-pattern risk: the catalyst engine's deterministic
tagger (`Earnings > Catalyst > Gapper > News`, per `CLAUDE.md`), the theme taxonomy
(`themes_taxonomy.json`, 112 themes / 2,029 holdings, per `CLAUDE.md`), and the cashtag
regex on tweets. None of the four benchmarked products has three separate taxonomies for
"what is this story about" — Bloomberg has one (with a source axis beside it), Benzinga has
one (categories) plus a orthogonal source axis, Koyfin has one (700 topics). The **Benzinga
flat-channel shape** — cheap to build, cheap to extend, still filterable — is the more
realistic transferable pattern for UCT than Bloomberg's hierarchy, given UCT has no
newsroom to maintain a taxonomy against.

**CONFIDENCE.** 🟢 on all four products' tagging shapes (each Tier 2/T1, vendor-authored).
🟡 on whether Koyfin's 700 topics are hand-curated or algorithmically derived — not stated
in the dossier.

**RECOMMENDATION (hypothesis).** A `primary` vs `mentioned` boolean on any UCT story-to-
ticker join (catalyst engine, tweet cashtags, RSS-to-ticker matching) is a small, well-
precedented change that would let UCT's catalyst scoring stop treating "$NVDA is the subject"
and "$NVDA is in a list of nine peers" as the same signal — which the provider ledger and the
Bloomberg dossier both independently identify as a live source of noise in `/buzz`.

**OPEN QUESTION.** Does Benzinga's `primaryTickers` field get populated by an editor, an
algorithm, or the wire source itself (i.e. is it something UCT could derive cheaply from its
own RSS/AV feeds, or is it Benzinga-proprietary labor)? Not documented in the fetched schema.

---

## 3. Importance ranking: editorial ladders sit on top of algorithmic scores

**OBSERVATION.** This is where the fresh fetches this pass materially extend the Wave-1b
dossier. The Benzinga Pro *UI* exposes a **three-rung editorial ladder** — Importance
Low / Mid / High — as a newsfeed filter (Benzinga dossier §D, help article 11, 🟢). But the
underlying **API schema, fetched fresh this pass, exposes a five-point integer**:
`importanceRank` (request parameter, 1–5) and `importance_rank` (response field, "Priority
level (1-5)"), independently confirmed on both the News API (`get-news-items.md`) and the
WIIM API (`get-wiims.md`). **The three-rung UI is a coarsened view of a five-point internal
score** — the dossier's own text ("published rungs," Benzinga §J) did not have this detail;
the API docs do not state the Low/Mid/High-to-1–5 mapping either, so the exact bucketing is
still unconfirmed, but the existence of a finer internal scale under an editorial-looking
3-bucket UI is now primary evidence, not inference.

Bloomberg runs the opposite architecture — **three separate, unblended** signals rather than
one score at different resolutions: editorial rank (TOP, "criteria including the news
judgment of the editors... breadth of readership, relevance and time," Bloomberg §7),
algorithmic relevancy scores on tags (machine-readable feed only, per a 2015 Tier-4 fact
sheet — dated), and read-attention as its own ranked surface (`READ`, `MCN`, `MNI`, each with
time-tail grammar `1H`/`1W`/`1M`/`1Y`). Bloomberg's own doc states the philosophy directly:
these are different questions, not blended into one number (Bloomberg §7).

**EVIDENCE.** Benzinga dossier §D + §J (help article 11, Tier 2, 🟢, "Importance Low/Mid/High,
each defined" — but the actual rung *definitions* were behind a 403-walled help article this
role also could not reach: `help.benzinga.com/en/articles/1769530-how-do-i-filter-my-newsfeed`,
attempted fresh this pass, 403). **Fresh evidence this pass** (Tier 2, official API reference,
fetched 2026-09-02, 🟢): `docs.benzinga.com/api-reference/news-api/get-news-items.md` —
`importanceRank` request param "Integer 1-5 ranking"; response field `importance_rank`
(example value shown: 1); explicit fetcher note: *"The API documentation does not explicitly
map Low/Mid/High labels to specific importanceRank numeric values."* Bloomberg §7 (Bloomberg-
authored *News Searches* PDF p.5–6, Tier 2, 🟢, TOP-ranking quote verbatim) + a 2015 Tier-4
fact sheet for the relevancy-score claim (🟡, dated).

**INTERPRETATION.** Two lessons, and they point in different directions. **Bloomberg's
lesson**: don't blend distinct questions ("editors think this matters," "this story is
strongly about X," "readers are actually reading this") into one score — give each its own
surface. **Benzinga's lesson, newly visible via the API**: a *simple, coarse, user-facing*
ladder can sit on top of a *finer internal* score without contradiction — Low/Mid/High is
legible to a human filter UI; 1–5 is legible to a scoring/sorting algorithm underneath it.
These are not opposed patterns — Benzinga's is a special case of "don't force the user to
see the algorithm's precision," which is itself a form of the same discipline Bloomberg
practices (surface only the question the user is actually asking).

**RELEVANCE TO UCT.** UCT's catalyst engine already does something closer to Bloomberg's
one-score approach: `score = gap_pct + log(vol_x)*15 + tweets*5 + rss*8 +
earnings_reported*20 + scanner_setup*12 + sector_momentum*5 − penny_penalty`
(`CLAUDE.md`, catalyst scoring), a single blended number that then drives a forced 10/5/3/2
category quota. That is architecturally distinct from both benchmarks: neither Bloomberg
(three separate surfaces) nor Benzinga (one coarse UI ladder over one fine internal score,
same *kind* of number at two resolutions) blends *heterogeneous* signals — gap%, tweet count,
scanner-setup match — into one sum the way UCT's catalyst score does. The forced quota is
UCT's own answer to the risk Bloomberg's separation avoids (one loud signal dominating), and
it operates on the *output* (which rows get shown) rather than the *score* (how a row is
computed) — a distinct mitigation, not the same one.

**CONFIDENCE.** 🟢 on the Benzinga 1–5/Low-Mid-High finding (two independent API-doc fetches,
same date, consistent) — but 🟡 on the Low/Mid/High↔1–5 mapping specifically, which remains
undocumented anywhere this role reached. 🟢 on Bloomberg's three-surfaces-not-one-score
architecture (Bloomberg-authored, Tier 2).

**RECOMMENDATION (hypothesis).** If UCT's catalyst score is ever exposed to a member (rather
than only its *rank* via the quota), the Benzinga pattern — a coarse three-bucket label over
a finer internal number — is a cheaper legibility fix than exposing the raw formula, and
avoids the Bloomberg dossier's warning that a formula "one bad week from being read as a bug"
(Bloomberg §2) needs either an explained default or a hidden precision layer. The stronger,
harder recommendation is the Bloomberg one: consider whether "editorial/curated" (the
catalyst tile's forced mix), "algorithmic strength" (the composite score) and "what the desk
actually read" (an analogue of `READ`/`RECE` — UCT has no such surface today) should stay
three separate, separately-addressable things rather than staying fused.

**OPEN QUESTION.** Is Benzinga's `importance_rank` computed per-story algorithmically, or is
it an editor's 1–5 dial that the UI happens to bucket into three labels? The API schema
cannot answer this — it is a request/response contract, not a production description.

---

## 4. Dedupe, story versioning, and retraction — the one place fresh evidence overturns a dossier gap

**OBSERVATION.** The Bloomberg dossier records an explicit, honest gap: *"I found no evidence
of automated near-duplicate collapsing in the Terminal UI... I am not treating it as evidence
of absence"* (Bloomberg §7). **Benzinga's API, fetched fresh this pass, closes the analogous
gap for its own product**, and does so with three independent mechanisms:

1. **`original_id`** — a response field on every news item, documented as referencing
   "duplicate/updated stories." A later revision or duplicate of a story is *linked back* to
   its original, not silently replaced or silently duplicated.
2. **A dedicated removal channel** — `GET /removed-news` (fetched fresh this pass) returns
   `{id, updated}` pairs for articles removed from the feed since a timestamp, with **no
   stated reason** ("does not explain the reasons... retractions, corrections, duplicate
   suppression, or other causes" per the fetcher's honest read of the doc). Removal is a
   first-class, separately-pollable event, distinct from an update.
3. **A typed WebSocket event model** — the real-time stream (`get-news-stream.md`, fetched
   fresh this pass) pushes `{"data": {"action": "created" | "updated" | "deleted", ...}}` —
   dedupe/correction is not implicit in a re-fetch; it is an explicit action verb a client
   must handle. The stream also documents a **`replay`** client command: *"Replay up to the
   last 100 cached messages"* — a bounded reconnect-gap-fill buffer.

**EVIDENCE.** All three points: **fresh fetches this pass**, Tier 2 (official API reference,
`docs.benzinga.com`), fetched 2026-09-02. `get-news-items.md` — `original_id` field.
`get-removed-news.md` — full field list `{id, updated}`, verbatim quote above. `get-news-stream.md`
— `wss://api.benzinga.com/api/v1/news/stream`; message schema with `action` enum; `ping`/
`replay` client commands, "Replay up to the last 100 cached messages" (verbatim). No
documented latency SLA on the stream itself — the fetcher's read: "suggesting eventual
consistency rather than guaranteed ordering," which I flag as an inference, not a quote.

**INTERPRETATION.** Benzinga's shape is **event-sourced, not snapshot-polled**: a consumer
that wants a *correct current state* (not just a firehose) needs to apply `created` /
`updated` / `deleted` in order, and needs the `replay` buffer to recover from a dropped
connection without re-fetching the whole feed. That is a materially different integration
contract than "poll a REST endpoint every N seconds and diff it yourself," and it is the
concrete mechanism Bloomberg's UI-level docs never surface (Bloomberg's own dedupe story
remains genuinely unknown — this section does not resolve that gap, only Benzinga's).

**RELEVANCE TO UCT.** This is directly load-bearing for two live UCT surfaces. First, the
**Twitter/tweet ingestion pipeline** (`tweet_poller.py`, `since_id` pagination per `CLAUDE.md`)
is REST-poll-and-diff, with no explicit correction/deletion channel — a deleted or edited
tweet has no analogue to Benzinga's `action: deleted`. Second, and more directly: **UCT's own
news ingestion (AV/RSS/Massive/FMP/Finviz) has no retraction or update-tracking mechanism
documented anywhere in the provider ledger** — a story that is later corrected or pulled by
its source has no path to being un-shown on a UCT surface. Given UCT does not currently
expose a general newsfeed a member browses story-by-story (the Stock Catalysts tile is a
20-row synthesis, refreshed wholesale on a schedule, not an append-only stream a user scrolls),
this gap is currently low-consequence — but it would become load-bearing the moment
TERMINAL-NEXT ships anything closer to a scrollable feed.

**CONFIDENCE.** 🟢 on all three Benzinga mechanisms — primary, fresh, consistent across three
independent endpoints fetched the same day. 🔴 remains correct for Bloomberg's dedupe
(absence of evidence, not evidence of absence — carried forward from the Wave-1b dossier
unchanged). 🟡 on whether Benzinga's `original_id`/`deleted` mechanisms are used consistently
in practice (the schema documents the *capability*, not measured behavior).

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT ever builds a scrollable/streamed news
surface (as opposed to a wholesale-refreshed digest), the transferable structural idea is
**explicit `created`/`updated`/`deleted` events with a bounded replay buffer**, not a bare
poll-and-diff. It is cheap relative to the alternative (silent duplicate rows, or silently
stale rows a member acts on after a retraction). This is a stronger, more concrete version of
the Bloomberg dossier's more general "vendor tells you which of its own content to distrust"
observation (Bloomberg §6) — Benzinga's version is machine-readable, not editorial prose.

**OPEN QUESTION.** Is `original_id` populated for (a) a genuine correction to the same story,
(b) a near-duplicate from a different provider, or (c) both, treated identically? The schema
cannot distinguish these, and the distinction matters for what a "12 similar stories, click to
expand" affordance (the Bloomberg dossier's own open question, §7) would need underneath it.

---

## 5. Latency tiers and what they cost

**OBSERVATION.** All four products separate "what a human sees" from "what a machine can
act on in milliseconds," and price the second tier as an entirely different product.
Bloomberg's Terminal-facing marketing is about **breadth and curation**, not speed; its
millisecond claims attach only to **Event-Driven Feeds**, sold "only for black box
applications," with a stated historical archive to 1992 for backtesting (Bloomberg §10, a
2015 Tier-4 fact sheet — dated but structurally telling). Benzinga's marketing claims speed
directly at the human tier — *"5-15 Minutes Before Mainstream Sources"*, *"Real-Time Feed
From 1,000+ Sources"* — but the Wave-1b dossier explicitly grades this **🔴 unfalsifiable**:
"no methodology, no measurement date, 'up to' phrasing" (Benzinga dossier §F, §N). The fresh
API fetch this pass adds one concrete data point neither dossier had: Benzinga's WebSocket
stream documentation itself makes **no latency SLA claim** even where a vendor would have the
strongest incentive to (a paid real-time data product) — consistent with the dossier's
skepticism about the marketing-tier "5-15 minutes" figure.

**EVIDENCE.** Bloomberg §10 (Tier 2 + Tier 4, 🟡 — dated 2015 figures, explicitly flagged as
such). Benzinga dossier §F, §J item "Unfalsifiable headline claims" (Tier 2 marketing pages,
🔴 by the dossier's own grading). **Fresh fetch this pass**: `get-news-stream.md` (Tier 2,
🟢 for what it does *not* claim — "no explicit SLAs, latency metrics, or delivery guarantees").
Koyfin and AlphaSense dossiers do not address latency as a marketed axis at all (absence
noted, not evidence of no latency tier existing).

**INTERPRETATION.** The pattern across all evidence gathered — Wave-1b's and this pass's — is
that **the speed claim a vendor is willing to put a number on is never at the human-facing
tier.** Bloomberg segments explicitly (Terminal = breadth, EDF = milliseconds, sold
separately, to a different buyer). Benzinga's marketing claims a number at the human tier
("5-15 minutes") but its own technical documentation, where the actual engineering
commitment would have to live, states none. That gap between the marketing tier and the
documentation tier is itself the finding: **a latency number a vendor will not put in its API
docs is not an engineering commitment**, it's a claim.

**RELEVANCE TO UCT.** UCT is a discretionary swing/options desk, not HFT — so, per the
Bloomberg dossier's own framing, the machine-tier proposition is irrelevant and the relevant
comparison is Terminal-vs-Terminal (breadth + routing), not Terminal-vs-EDF (speed). UCT's
actual latency postures, per the provider ledger: Massive WS pushes options trades and
developing bars in near-real-time (row 2, `MASSIVE_WS_ENABLED`); the Twitter poller runs a
2-minute burst cadence pre-market (per `CLAUDE.md`); the Stock Catalysts tile refreshes every
5 minutes pre-market. None of these numbers has ever been marketed externally, which is
arguably the more honest position of the four products surveyed — UCT has no "5-15 minutes
before mainstream" claim to defend or retract.

**CONFIDENCE.** 🟡 overall — 🟢 on Bloomberg's segmentation and Benzinga's SLA-silence in its
own docs (both directly sourced); 🔴 on whether Benzinga's marketed 5-15 minute figure is
true, false, or unmeasurable by an outside party — genuinely unknown, not merely unverified.

**RECOMMENDATION (hypothesis).** If UCT ever markets a latency claim (e.g. "catalysts surface
within N minutes of the wire"), the transferable discipline from this pass is: **a latency
claim that does not appear in the thing engineers actually build against (an API/webhook
contract) is a marketing number, not a product spec** — and the two should not be allowed to
drift the way Benzinga's own marketing and its own API documentation currently do.

**OPEN QUESTION.** None of the four dossiers, nor this pass, reached a genuinely measured
side-by-side latency comparison between any two of these products. That measurement — the
Bloomberg dossier's own §10 open question — remains open across every product surveyed.

---

## 6. Personalization by watchlist: news as a filter axis, not a separate feature

**OBSERVATION.** Three of four products treat "my watchlist" as a **filter parameter on the
same newsfeed**, not a separate personalized product:

- **Benzinga**: watchlists are explicitly one of the newsfeed's seven filter axes (Benzinga
  dossier §D, help article 11), marketed directly — *"Each Watchlist Becomes A Smart Filter
  For Your Entire Benzinga Pro Experience"* (source 3, marketing page, 🟡).
- **Koyfin**: **Watchlist News** surfaces "articles, press releases, filings, and
  transcripts" in real time against a list (Koyfin dossier §D, [S10]), and this is paired
  with **Document Alerts** — one of Koyfin's four alert types is specifically "a filing, a
  press release, a transcript appearing... as a peer of price" (Koyfin dossier §D,
  RELEVANCE-TO-UCT note already in that dossier). This is the single alert-type combination
  none of the other three products documents as cleanly: *document arrival* as an alertable
  event class, orthogonal to price.
- **Bloomberg**: personalization is a *saved search* promoted to a page section (`MYN`), not
  a watchlist filter per se — `CN <GO>` (news tagged to a loaded security) is the nearest
  equivalent, one ticker at a time, not a list (Bloomberg §1, §4).
- **AlphaSense**: Watchlists exist (shareable) but the dossier does not document a watchlist-
  scoped news view — the personalization axis is Tags/Bookmarks/Highlight Tags on documents,
  not a feed (AlphaSense dossier §D).

**EVIDENCE.** Benzinga dossier §D (help article 11, Tier 2, 🟢) + source 3 (marketing, Tier
🟡). Koyfin dossier §D ([S10], [S26], Tier T1, 🟢). Bloomberg §1, §4 (Bloomberg-authored,
Tier 2, 🟢). AlphaSense dossier §D (Tier T1, 🟢, by absence).

**INTERPRETATION.** Koyfin's document-alert framing is the most structurally interesting of
the four: it treats "a company said something" (filing, PR, transcript) as an event class of
the *same rank* as "the price moved," delivered through the *same* alert pipe (Desktop/Email/
Mobile Push, per the Koyfin dossier's D table). That is a genuinely different primitive from
"news matching my watchlist appears in a feed" — it is "the arrival of a specific document
type is itself an alertable fact."

**RELEVANCE TO UCT.** UCT already has the watchlist-as-filter half: `ticker_tags`,
`watchlist_items`, and — per `CLAUDE.md` — "a watchlist doubles as a newsfeed filter axis" is
explicitly how the *tweet* surfaces already work (`useTickerTweets`, MoversSidebar). What UCT
lacks is Koyfin's other half: **document arrival as an alert type**. UCT's `watchlist_alerts`
table is `(sym, target_price, direction)` — price only. The calendar's pre-report alerts
(`calendar_alerts.py`) are the nearest UCT analogue to a document-adjacent alert (an event is
approaching), but nothing alerts on "a new SEC filing just posted for a symbol I watch,"
despite UCT already ingesting EDGAR (`api/services/sec_filings.py`, provider ledger row 19,
"core / underutilized... the free, unrestricted substitute for filings-derived fundamentals").
This is a concrete, evidence-backed gap: **the data source exists (EDGAR, free, already
wired), the alert infrastructure exists (`watchlist_alert_service`, five channels), and the
missing piece is a trigger type, not a data source or a delivery pipe.**

**CONFIDENCE.** 🟢 on all four products' documented shapes. 🟢 on UCT's current alert-type
vocabulary and EDGAR wiring (both from primary internal sources — `CLAUDE.md` and the
provider ledger, not inferred).

**RECOMMENDATION (hypothesis).** A "new filing" alert type on `watchlist_alert_service`,
sourced from the already-wired EDGAR client, is the single highest-leverage idea in this
report by the "data exists, pipe exists, only the trigger is missing" test — it costs a new
row type and a poll against a free API UCT already calls, not a new vendor relationship.

**OPEN QUESTION.** Does UCT's EDGAR polling (`sec_filings.py`) currently run on any schedule
independent of a user request, or is it fetched only when a member opens a filings tab? If
it is request-driven only, a document-alert feature needs a background poll added, not just
a UI surface — this role could not confirm the scheduling from the files it was permitted to
read.

---

## 7. The promotion path: saved search → named object → alert

**OBSERVATION.** Every product with a saved-search feature converts it into a *standing,
addressable* object, but the addressability differs sharply in kind:

- **Bloomberg**: the strongest version. A saved search becomes an **NI code** — the vendor's
  own tip: *"Give it a short, easy to type name as once it's saved, it becomes an NI code for
  you"* — indistinguishable in the query grammar from a built-in topic. `NLRT` lists/edits/
  suspends/activates it; `Suspend Alert` pauses **without destroying the search** (Bloomberg
  §4). One object, many renderers (search result, alert, `MYN` section, Launchpad tab).
- **Benzinga**: alerts are a **separate engine (Signals)** from saved newsfeed filters — there
  is no documented promotion path from "a filtered newsfeed view" to "a Signal." Signals fire
  on a fixed published taxonomy (Price Spikes, Option Activity, Block Trades, Halts, 52-Week
  H/L, New Day H/L Series — Benzinga dossier §D, help article 10, 🟢) — a user *configures*
  parameters on each type; a user does not *promote* an arbitrary saved query into one, the
  way Bloomberg promotes `N WARREN BUFFETT AND "BASEBALL"` into `NI BUFFBALL`.
- **AlphaSense**: **Saved Searches → email alerts** directly, with name/frequency/delivery-
  time configuration (AlphaSense dossier §D, 🟢) — closer to Bloomberg's shape than
  Benzinga's, but scoped to documents, not a general news taxonomy, and with no evidence of
  the search becoming a *reusable, addressable* object beyond the alert itself (no analogue of
  `NI BUFFBALL` being typeable elsewhere in the product).
- **Koyfin**: alerts (Price/Valuation/Technical/Documents) are created **per-security** from a
  quote box or a table right-click (Koyfin dossier §D, [S26]) — object-first, like UCT's
  current `watchlist_alerts`, not query-first like Bloomberg's promotion path.

**EVIDENCE.** Bloomberg §4 (Bloomberg-authored, Tier 2, 🟢, two independent institutional
corroborations of the `NLRT` half). Benzinga dossier §D (help article 10, Tier 2, 🟢, full
Signals taxonomy). AlphaSense dossier §D (Tier T1, 🟢). Koyfin dossier §D ([S26], Tier T1,
🟢, "v3.66, published 2025-06-19").

**INTERPRETATION.** Bloomberg is the outlier, and deliberately so: **query-first** design
where the alert is a delivery *setting* on a named, reusable, typeable object. The other
three are variants of **object-first** design: pick an alert *type* from a fixed menu, attach
it to a security or a saved document search, done. Object-first is cheaper to build (no
general query language, no promotion mechanism) and covers most real usage; query-first is
more powerful but requires the underlying command grammar Bloomberg built for search anyway
(§2) — the promotion path is nearly free *given* that grammar already exists, and prohibitive
without it.

**RELEVANCE TO UCT.** UCT is squarely **object-first** today, like Benzinga/Koyfin/
AlphaSense, not Bloomberg — this was already the Wave-1b Bloomberg dossier's own finding
(§4 RELEVANCE TO UCT), and nothing in this pass's fresh material changes it. UCT has real
"saved definitions" (Screener's `user_definitions`, the `starter_library`) and a real
five-channel alert delivery service (`watchlist_alert_service`), and — as the Bloomberg
dossier already noted — **no promotion path between them**: a saved scan definition cannot
become a standing alert the way `NI BUFFBALL` becomes `NLRT`-manageable. Given UCT has no
newsroom-scale query grammar to build a Bloomberg-style promotion path on top of, the more
realistic near-term model is Benzinga/Koyfin's: **a fixed, published taxonomy of alert types**
(UCT already half-has this: price alerts, catalyst-match alerts, calendar pre-report alerts —
each independently implemented) rather than a general search-to-alert promotion. The gap
worth closing is not "build Bloomberg's grammar," it is "make the existing fixed alert types
feel like one system" — which is closer to Bloomberg's §5 finding (one consumption inbox,
many creation surfaces) than to its §4 finding (query promotion).

**CONFIDENCE.** 🟢 on all four products' documented shapes. 🟢 on UCT's current object-first
posture (internal, direct: `CLAUDE.md` watchlist-alerts schema `(sym, target_price,
direction)`).

**RECOMMENDATION (hypothesis).** Given UCT's existing shape, the transferable move is
Benzinga/Koyfin's (a well-published, fixed alert-type taxonomy that spans price, document
arrival [§6], and catalyst-match) rather than Bloomberg's query-promotion pattern, which
presumes infrastructure UCT does not have and has no near-term reason to build for this
purpose alone.

**OPEN QUESTION.** Would UCT's Screener saved-scan definitions (`user_definitions.py`) be
cheap to wire as a sixth alert *source* into the existing `watchlist_alert_service` fan-out —
i.e. is the missing piece a UI affordance or a genuine backend gap? Not determined by the
files this role was permitted to read.

---

## 8. Feeds vs panels vs streams: the surface shapes, and what each is for

**OBSERVATION.** Every product studied deploys **at least two** of these three surface
shapes, deliberately, for different jobs:

- **Feed** — a browsable, filterable, scrollable list the user actively queries: Bloomberg's
  `N`/`TOP`/`READ`, Benzinga's Newsfeed, Koyfin's Markets News sections + custom screens.
- **Panel** — a bounded, contextual slice attached to a security or a page: Bloomberg's `CN`
  (news tagged to the loaded security), Benzinga's WIIM pinned atop Details, Koyfin's
  company-news two-panel viewer with *Customize Sources*/*Highlight Terms*.
- **Stream** — an always-on, ambient, low-friction channel that does not require a query:
  Bloomberg's `NH` ticker kept pinned "at the bottom of whatever I'm using" (Bloomberg §12,
  practitioner evidence), Benzinga's **Squawk** (an audio stream, silent by default, "reads
  are only done when breaking news is present" — Benzinga dossier §D/§J), and — confirmed
  fresh this pass — Benzinga's **WebSocket news stream** as the machine-facing equivalent
  (`get-news-stream.md`).

**EVIDENCE.** Bloomberg §1, §3, §12 (Bloomberg-authored + one practitioner deck, Tier 2/10,
🟢/🟡). Benzinga dossier §D, §J (help articles 11, 12, 14, Tier 2, 🟢). Koyfin dossier §D
([S28], Tier T1, 🟢). Fresh fetch this pass for the WS-stream half (Tier 2, 🟢).

**INTERPRETATION.** The three shapes answer three different questions a trader asks at
different moments: **feed** = "let me go look," **panel** = "tell me about *this one thing*
right now," **stream** = "tell me the instant it happens, without me asking." The products
that feel complete (Bloomberg, Benzinga) ship all three; the ones that feel thinner on news
specifically (AlphaSense, and Koyfin relative to the other two) ship feed + panel but not a
true ambient stream — AlphaSense has none of the three in the news-proper sense (its
"stream" equivalent is agent-completion notification, a different job); Koyfin's closest
analogue to a stream is push-alert delivery on a document/price event, which is closer to
"panel triggered by an event" than to Bloomberg's/Benzinga's always-on ambient channel.

**RELEVANCE TO UCT.** UCT has **panel** (TickerPopup, EarningsResearchModal, the calendar's
per-symbol enrichment) and a version of **stream** (`TapeFeed.jsx` on the Dashboard, reading
`/api/tweets/feed`, per `CLAUDE.md`) — but essentially **no general feed**: there is no page
where a member browses/filters "all news" the way Bloomberg's `N` or Benzinga's Newsfeed
does. The Stock Catalysts tile is closer to a curated **panel-at-dashboard-scale** (20 rows,
scored, refreshed wholesale) than to a **feed** (browsable, filterable, user-queried). This
is a genuine structural gap relative to every benchmark studied except AlphaSense (which is
not a news product) — though it may be a deliberate one: UCT's `CLAUDE.md` philosophy
throughout (the wire, the catalyst tile, the quota-forced mix) leans hard toward *curated*
over *browsable*, which is closer to Bloomberg's `TOP`-first default (§1) than to raw `N`.

**CONFIDENCE.** 🟢 on the three-shape taxonomy holding across all four products (directly
observed in each dossier). 🟡 on whether UCT's absence of a general feed is a considered
choice or an unbuilt one — `CLAUDE.md` documents deliberate curation elsewhere (the catalyst
quota, the wire's edited voice) but never states "we deliberately do not ship a browsable
newsfeed."

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT stays curation-first (consistent with
UCT's existing product philosophy), the Bloomberg §1 pattern — pair every curated surface
with an explicit "show me everything you filtered out" escape hatch — is the cheaper,
lower-risk move than building a full browsable feed from scratch, and it is consistent with
what UCT has already half-built (the catalyst tile's ⓘ citations popover and 🔎 "why isn't X
here" widget, per `CLAUDE.md`, are exactly this instinct at ticker granularity).

**OPEN QUESTION.** Is a general, browsable newsfeed in scope for TERMINAL-NEXT at all, or is
curation-first a settled product decision this contract should not relitigate? This role has
no visibility into that decision and flags it rather than assuming either answer.

---

## 9. Read/unread and noise control — thin evidence outside Bloomberg, worth naming honestly

**OBSERVATION.** Bloomberg is the only one of the four products whose dossier documents a
**measured, taught noise-reduction loop** — the "stories per hour" readout at authoring time,
the published exclusion-code list, and the backwards discovery move (`2 <GO>` on an offending
story to learn its code) — covered in depth in Bloomberg §6 and not re-derived here. Benzinga
has one adjacent idea, **category highlighting** ("colour a category to make it stand out
*without filtering*" — Benzinga dossier §D, help article 8, 🟢) — emphasis decoupled from
exclusion, the same principle Koyfin's *Highlight Terms* implements per-security (Koyfin
dossier §D, [S28]). None of the three non-Bloomberg products document a **read/unread state**
on news items at all — this role found no evidence, in any of the four dossiers or in this
pass's fresh fetches, of a per-user read/unread marker on a news feed in any of these four
products. Koyfin's alert bell and Bloomberg's `RECE` (last ~200 opened stories) are the
nearest analogues, and neither is a read/unread *state on the feed itself*.

**EVIDENCE.** Bloomberg §6 (full detail already in that dossier, not repeated here — 🟢).
Benzinga dossier §D (help article 8, Tier 2, 🟢). Koyfin dossier §D ([S28], Tier T1, 🟢).
Absence of read/unread: checked against all four dossiers' §D capability tables plus this
pass's Benzinga API fetches (no `read`/`seen` field in any fetched schema) — **absence of
evidence across five independent sources, not proof of absence in any live product.**

**INTERPRETATION.** This is a genuinely thin section and the honest read is that the
benchmark set does not answer the read/unread question well — it may be a UI-only mechanic
none of the vendors document in help centers (a plausible, mundane explanation), or it may
genuinely be absent from products built for "the newest story matters, not my history with
it." UCT should not infer either conclusion from this evidence.

**RELEVANCE TO UCT.** UCT's closest existing analogue is `calendar_seen.py` (per `CLAUDE.md`,
"read-unseen via `calendar_seen.py`" on the My Stocks calendar hub) — a read/unread mechanic
that already exists on a *different* UCT surface than news. If TERMINAL-NEXT ships a general
feed (§8's open question), that module is the nearer starting point than anything in this
benchmark set.

**CONFIDENCE.** 🟡 low-but-honest. This section is closer to a documented gap in the evidence
than a finding.

**RECOMMENDATION (hypothesis).** None strong enough to state as a hypothesis from this
evidence alone — flagged as a genuine open area rather than forced into a recommendation.

**OPEN QUESTION.** Does any of the four products expose read/unread on news at all, and if
Bloomberg's `RECE` is the closest analogue, is "last ~200 opened" a *read history* (passive,
automatic) or a *read/unread state* (active, per-item)? The Bloomberg dossier does not
resolve this distinction and neither could this pass.

---

## 10. Capability map — what's achievable with UCT's current sources today

Legend: **have** = data/infra already wired · **partial** = wired but not blended/exposed
this way · **needs provider** = no current source · **needs engineering only** = source and
infra both exist, only the feature is missing.

| Pattern (§) | UCT today | Status | Evidence |
|---|---|---|---|
| Multi-source blended pool (§1) | Fallback chain (AV→RSS→Massive→FMP→Finviz→Google), not a blend | **partial** | provider-ledger.md:193 |
| Source as a filter axis on one feed (§1) | No general feed to filter | **needs engineering** (feed itself, §8) | — |
| Primary vs mentioned ticker tagging (§2) | Cashtag regex treats all mentions equally | **needs engineering only** | provider-ledger.md; CLAUDE.md Twitter section |
| Flat topic/channel taxonomy (§2) | Three unconnected taxonomies (catalyst tags, themes, cashtags) | **have, unconsolidated** | CLAUDE.md (Theme Tracker, Stock Catalysts sections) |
| Coarse UI label over fine internal score (§3) | Catalyst score is one blended formula, no coarse/fine split | **needs engineering only** | CLAUDE.md catalyst scoring |
| Separate editorial/algorithmic/read-attention surfaces (§3) | Not separated; no "most-read" surface exists | **needs engineering** | — |
| Explicit created/updated/deleted event model (§4) | Poll-and-diff on tweets; no retraction path on news | **needs engineering** | CLAUDE.md Twitter section; provider-ledger.md |
| Document-arrival as an alert type (§6) | EDGAR wired, alert infra wired, no filing-alert type | **needs engineering only** | provider-ledger.md row 19; CLAUDE.md watchlist_alerts |
| Watchlist as a news filter axis (§6) | Live today for tweets (`useTickerTweets`) | **have** | CLAUDE.md Twitter News Ingestion |
| Query-first saved-search promotion (§7) | Object-first alerts only; no promotion path | **needs engineering, low priority** (no query grammar to promote from) | CLAUDE.md; Bloomberg dossier §4 |
| Fixed, published alert-type taxonomy (§7) | Exists per-subsystem, not unified | **have, unconsolidated** | CLAUDE.md (watchlist/catalyst/calendar alerts) |
| Ambient ("stream") surface (§8) | `TapeFeed.jsx` on Dashboard | **have** | CLAUDE.md Twitter News Ingestion |
| Contextual ("panel") surface (§8) | TickerPopup, EarningsResearchModal, per-symbol enrichment | **have** | CLAUDE.md |
| Browsable, filterable general feed (§8) | None | **needs engineering** (open product-scope question) | — |
| Curated-page + escape-hatch pairing (§1, §8) | Stock Catalysts tile has ⓘ citations + 🔎 why-not widget | **have, at ticker granularity only** | CLAUDE.md Stock Catalysts section |
| Read/unread on a feed (§9) | Exists on Calendar (`calendar_seen.py`), not on any news surface | **partial, wrong surface** | CLAUDE.md Calendar section |

**RELEVANCE TO UCT.** Reading the table as a whole: UCT's biggest *engineering-only* wins
(no new vendor, no new data) are the two flagged "needs engineering only" rows — primary/
mentioned ticker tagging, and a document-arrival alert type off the already-wired EDGAR
client. The larger structural gaps (a general feed, an explicit event model, separated
editorial/algorithmic/read-attention surfaces) are real product decisions this contract does
not have standing to make, and are flagged as open questions above rather than implied
recommendations.

---

## 11. Anti-patterns observed across the benchmark set (do not copy)

1. **Unfalsifiable latency marketing separated from the technical contract** (§5) — Benzinga's
   "5-15 minutes" claim appears nowhere in its own API documentation. If UCT ever markets a
   speed claim, it should be traceable to the same number an engineer builds against.
2. **Documentation drift across a vendor's own materials** (Benzinga dossier §J: a widget
   roster that omits shipped tools in one article while another documents them; "5 channels"
   text sitting directly above a list of 7; a stale tier article missing a whole pricing
   tier). UCT's own `CLAUDE.md` already fights this exact defect class internally (the
   "⚰️ DOCUMENTED BUT UNREACHABLE" section, the writer-index "FOUR" pattern) — worth reading
   the Benzinga findings as independent confirmation the failure mode is common, not UCT-
   specific.
3. **A blended score with no explanation of its own tradeoff** (§2, §3 — Bloomberg's explicit
   counter-example: the vendor's own help text states *when* tag-search will miss a story).
   A scoring formula published nowhere a user can read it is the anti-pattern Bloomberg's
   documentation habit avoids.
4. **Workspace/state persisting only client-side with no server backup** — not a news-specific
   finding (it is Benzinga's own §N "bad idea," about workspace layout, not news) but adjacent
   enough to flag: if a future "my saved news filters" feature ships, it should not repeat
   Benzinga's browser-cache-only default.

---

## GAPS (budget not reached / evidence unreachable)

1. **Benzinga's exact Low/Mid/High ↔ 1-5 `importanceRank` mapping** — the help article that
   would define the three rungs (`help.benzinga.com/en/articles/1769530-how-do-i-filter-my-newsfeed`)
   returned HTTP 403 to a fresh fetch this pass, consistent with the Wave-1b dossier's own
   evidence ceiling ("no logged-in access... 403 to WebFetch"). The API schema confirms the
   1-5 scale exists but not the bucketing.
2. **Bloomberg's ALRT price/technical alert-builder grammar and BLRT internals** — both
   already flagged as gaps by the Wave-1b Bloomberg dossier (CAPTCHA-walled); not re-attempted
   this pass, since re-spending budget against a documented CAPTCHA wall was judged low-value
   per the preamble's search-budget guidance.
3. **Whether Benzinga's `original_id`/`deleted` event model is actually exercised in
   production**, vs documented-but-rarely-triggered. The schema is primary evidence of
   capability, not of measured behavior — no dated production log was reachable.
4. **A genuinely measured latency comparison between any two products** — remains open across
   every source consulted, this pass and Wave-1b's.
5. **Koyfin's and AlphaSense's news architecture below the help-center layer** — this pass
   relied entirely on the Wave-1b dossiers for both (no re-fetch attempted; their D-sections
   were judged sufficiently primary and specific already, and the contract names Koyfin
   "section D news" specifically as the allowed read).
6. **TradingView, StreetAccount, FactSet or other news products outside the four named
   dossiers** — one exploratory fetch (`tradingview.com/support/.../news-flow`) 404'd; not
   pursued further, since WebSearch (which would normally locate the correct URL) was
   exhausted per the preamble, and the contract does not name TradingView as an allowed
   dossier to read.
7. **Whether UCT's EDGAR client (`sec_filings.py`) polls on a schedule or only on request** —
   needed to size the §6 "document-arrival alert" recommendation's true engineering cost;
   not determined from the files this contract permitted.

**What would raise confidence.** (a) A logged-in Benzinga Pro session (or the owner's
14-day trial seat, per the Wave-1b dossier) would settle gap 1 and give first-hand UI
evidence throughout. (b) A single hour on a library-bookable Bloomberg Terminal would settle
several Bloomberg-side gaps already named in that dossier. (c) A direct read of
`api/services/sec_filings.py` (outside this contract's internal-file allowlist) would settle
gap 7 in minutes.

---

## SOURCES

**Fresh primary — fetched this pass, 2026-09-02, Tier 2 (official API reference)**

1. Benzinga, WIIM overview — `https://docs.benzinga.com/api-reference/news-api/wiims/overview.md`
2. Benzinga, WIIM API request/response schema — `https://docs.benzinga.com/api-reference/news-api/wiims/get-wiims.md`
3. Benzinga, News API request/response schema — `https://docs.benzinga.com/api-reference/news-api/get-news-items.md`
4. Benzinga, Removed News endpoint — `https://docs.benzinga.com/api-reference/news-api/get-removed-news.md`
5. Benzinga, real-time News WebSocket stream — `https://docs.benzinga.com/ws-reference/data-websocket/get-news-stream.md`
6. Benzinga, News Channels endpoint — `https://docs.benzinga.com/api-reference/news-api/channels/get-available-news-channels.md`

**Attempted and blocked this pass (recorded so nobody re-spends budget)**

7. `https://help.benzinga.com/en/articles/1769530-how-do-i-filter-my-newsfeed` — HTTP 403.
   Would answer GAP #1 (Low/Mid/High rung definitions).
8. `https://www.tradingview.com/support/solutions/43000549596-news-flow/` — HTTP 404
   (guessed URL; not pursued further per the search-budget note — WebSearch exhausted).

**Secondary-primary — Wave-1b dossiers, read this pass, each independently source-graded
within its own file (not re-graded here; see each dossier's own §SOURCES for full citations)**

9. Bloomberg — `03-competitive-research/bloomberg/03-news-alerts.md` (all 12 sections read in
   full this pass; 27 sources cited therein, Tier 2 through Tier 11).
10. Benzinga Pro — `03-competitive-research/benzinga-pro/dossier.md` §D "News (the core)",
    §D "Alerts", §J "UX", §N "Bad ideas" (read this pass; 40 sources cited therein).
11. AlphaSense — `03-competitive-research/alphasense/dossier.md` §D "Capability map" (read
    this pass).
12. Koyfin — `03-competitive-research/koyfin/dossier.md` §D "Capability map" + Workflow D
    "What matters today" (read this pass).

**Internal — read per this contract's explicit allowance**

13. `02-data-providers/provider-ledger.md` — rows 1, 4-12, 40; News data-class row (line 193);
    read in full to line 89, then targeted `grep -i news` sweep to line 517 for completeness.
14. `08-ai/existing-ai-systems.md` §1 "Surfaces" (lines 70-160) — member-facing AI surfaces,
    for the "what UCT already summarizes" comparison.

**Source-handling note.** Nothing read in any fetch or dossier this pass contained text
attempting to redirect this role's behavior. The Benzinga API documentation is generated
technical reference material (parameter tables, schema definitions) with no embedded prose
of the kind that could carry an instruction; none was found.
