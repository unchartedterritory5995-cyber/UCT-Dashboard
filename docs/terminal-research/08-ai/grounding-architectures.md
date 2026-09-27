---
id: C6-02
title: Grounding, citation and provenance architectures
role: Domain pod — grounding/citation/provenance (Parts XXVIII, LXXXIII, LXXXIV, CCLXXXVII, appendix CDXXXIX–CDXLIV)
wave: 1b
group: C
category: domain
scope: How a financial answer is bound to its evidence — tool-based retrieval vs stuffed context, citation spans, temporal/market-clock context, refusal behaviour, evaluation harnesses for financial QA, cost and latency tiers
confidence: 🟡 overall
evidence_ceiling: The MECHANISMS here are 🟢 — they come from versioned model-provider API references that publish wire formats, so a reader can check every field against a schema. What is NOT reachable is (a) any financial vendor's citation renderer observed running (no seat on any product — ceiling inherited from C6-01), and (b) any vendor-published accuracy, refusal-rate or latency number for a financial AI product. The two quantitative findings below (FinanceBench 81%, FailSafeQA 41%) are third-party academic measurements of 2023–2025 model generations read at abstract level, not current vendor claims and not full-paper reads. Raising the ceiling needs one logged-in session per benchmark product, plus an UCT-side run of a citation-span renderer that does not yet exist.
sources: 12 primary/official (model-provider API references, W3C, NYSE, OSS docs), 2 academic-primary (arXiv abstracts); 2 internal Wave-1b reports cited not re-derived
uct_relevance: high
status: draft
date: 2026-09-02
---

# Grounding, citation and provenance architectures

**What this file is.** The layer BELOW C6-01's product survey. C6-01 established what each
financial vendor *says* its AI does and ranked five citation mechanisms by what verification
costs the reader [C6-01 §2]. This file asks the engineering question underneath: **what machinery
actually binds a generated sentence to a piece of evidence**, what that machinery costs, how it
fails, and how you measure whether it worked. Where C6-01 or D-12 already established a fact, it
is **cited, not re-derived**.

**Terms.** TERMINAL-NEXT = the workstation being designed. TERMINAL-CURRENT = the existing
`/calendar` surface (display-named "UCT Terminal"). Nothing below is a requirement; "the API
supports X" never implies "UCT should ship X".

**Two internal files supply the "already have" column** and are cited throughout:
`08-ai/existing-ai-systems.md` (**D-12**) and `08-ai/ai-native-tools-survey.md` (**C6-01**).

**Evidence classes:** **verified** (primary doc, field-level) · **demonstrated** (seen running) ·
**claimed** (vendor marketing) · **reported** (third party / practitioner) · **speculated**.
Nothing in this file is *demonstrated* — see GAPS.

---

## 1. REFERENCE PATTERNS — six architectures, ordered by where the bond is enforced

The axis that organises the whole field: **at which layer is the claim→evidence bond created,
and what still holds if the layer above it is wrong?** A bond enforced in a wire format or a
validator survives a prompt edit, a model swap and a new engineer. A bond enforced in a prompt
survives none of those.

| # | Pattern | Where the bond is created | A wrong answer looks like | Failure direction |
|---|---|---|---|---|
| **P1** | **Stuffed context + prose attribution** — retrieved text in the system prompt, model instructed to attribute | Prompt (a request) | Fluent, confident, unattributable; the reader cannot separate retrieval from recall | **Fails open** — silence reads as "nothing there" |
| **P2** | **Stuffed context + declared gaps** — same, but the *assembler* records which packs returned nothing and the answer says so | Retrieval assembler (code) | An answer that names what it does not have | **Fails visible** |
| **P3** | **Post-generation grounding gate** — every number in the prose must appear in the facts handed in, or nothing is stored | Validator (code, after the model) | Nothing renders; a deterministic template renders instead | **Fails closed** |
| **P4** | **Facts-first / computed verdict** — the numbers and the decision are computed deterministically; the model only narrates | Orchestrator (code, before the model) | Weak prose wrapped around a correct number | **Fails to a correct number** |
| **P5** | **API-level citation spans** — the provider returns a machine-checkable pointer (char / page / block / result index + verbatim `cited_text`) attached to each claim | Model API (wire format) | A claim carrying no citation object — structurally visible to the renderer | **Fails detectably** |
| **P6** | **Configuration-as-answer** — the model emits an inspectable artefact (a screen, a scored decomposition), not prose | The artefact itself | A wrong filter, which a reader can see and disagree with | **Fails legibly; needs no citation machinery** |

Three notes that matter more than the ordering:

- **P5 and P6 do not require the model to be honest.** P5 because the pointer is parsed by the
  API and is *guaranteed to point at supplied text* [S1]; P6 because there is no prose in which
  to be dishonest. P1 is the only row where the bond is a polite request.
- **The rows compose, and serious systems run three or four at once.** UCT already runs P2, P3,
  P4 and P6 (§9). It runs **no P5 anywhere** — and P5 is the only row that hands the *reader* a
  gesture, which is precisely the hole C6-01 names ("what UCT does not have… is the reader-side
  half") [C6-01 §2].
- **P3 and P5 are not substitutes.** P3 checks *the model's output against facts you already
  hold*; P5 tells you *which fact* a sentence used. A system with P3 alone knows an answer is
  clean but cannot show a member where a number came from. A system with P5 alone can point at a
  source it may have misread. The pair is the interesting configuration.

---

## 2. TOOL-BASED RETRIEVAL vs STUFFED CONTEXT — the fork moved

**OBSERVATION.** The choice is no longer symmetric: one side of it now carries provider-level
citation machinery and the other does not — but **the dividing line is not tools, it is the block
format**, and that distinction is the single most transferable fact in this file.

Anthropic's **search result content block** exists so content *you* retrieve is citable the way a
first-party web search is: *"Search result content blocks let Claude cite your own content the
same way it cites web search results: each citation carries the source and title you provided"*
[S2]. The schema is four required fields — `type: "search_result"`, `source`, `title`, and a
`content` array of text blocks — plus optional `citations.enabled` and `cache_control` [S2].
`source` is deliberately permissive: *"Any stable string works: a URL, or an internal identifier
such as `kb://article-1234`"* [S2].

Critically, it arrives by **two** routes: *"From tool calls: Your custom tools return search
results, enabling dynamic RAG applications"* and *"As top-level content: You provide search
results directly in user messages for pre-fetched or cached content"* — and in both, *"Claude
cites the search results automatically when citations are enabled. No special prompting is
needed"* [S2]. Constraints: text only (no images inside `content`); `search_result` blocks *"can
only appear in user messages (including inside tool results)"*; and citations are all-or-nothing
across a request [S2].

**EVIDENCE.** [S1] Anthropic *Citations*, Tier 1 (official API reference), fetched 2026-09-02 —
**verified**. [S2] Anthropic *Search results*, Tier 1, fetched 2026-09-02 — **verified**
(quotations are from the reference's own prose and JSON schema).

**INTERPRETATION.** D-12 records UCT's packs-vs-tools fork as live and unresolved, defaulting to
regexes because `AI_SEARCH_AGENT_AUTOROUTE` is `"0"` [D-12 §3a]. That fork was framed as *cheap
and deterministic* (regex packs) versus *better selection* (model-chosen tools). Method 2 above
dissolves the framing: **an intent-gated pack can be emitted as `search_result` blocks in the
user message and gain spans while keeping the cheap deterministic selector.** The citation win
belongs to the block format, not to the agent lane, and does not cost the agent lane's 2 quota
units or its $15/day ceiling [D-12 §3a].

The corollary is the trap. A tool that returns a plain string in a `tool_result` is **exactly as
unattributable as a stuffed pack**. Adding tools buys better *selection*; it buys provenance only
if the return value is typed.

**RELEVANCE TO UCT.** Lands on D-12's Gap #5, which it calls *"the single biggest trust gap"*:
web answers get numbered `[n]` markers while desk data gets *"a prose instruction and a judge"*,
with *"no `[desk:quote]`-style marker a renderer can link"* [D-12 §8]. The block format **is**
that marker, and `source` accepting `kb://…`-style identifiers means a desk row — a COT report
week, a breadth metric, an earnings line, a Model Book setup — has a legal, stable citation
target without pretending to be a URL.

**CONFIDENCE.** 🟢 on the mechanism and wire format (versioned official reference, field-level
quotes). 🔴 on whether it improves any UCT answer — nothing was run, and no financial vendor was
observed using it.

**RECOMMENDATION (hypotheses).**
1. *The decision worth taking is prose-stuffing vs block-passing, which is orthogonal to who picks
   the pack.* A cheap regex selector emitting citable blocks would be a strictly better version of
   today's fast lane and leaves the autoroute question untouched.
2. *Type the return value of every retrieval tool before adding another one.* A registry of 154
   tools returning untyped strings [D-12 §2c] converts to a provenance-bearing registry by
   changing the return shape, not the tool list.

**ANTI-PATTERN.** *Never let "we added tools" stand in for "we added provenance."* The
attribution comes from the block type; the tool call is irrelevant to it.

**OPEN QUESTION.** `search_result` requires *text* content and a source string. What is the
source of a **computed** number — a breadth reading, an exposure score, a flow aggregate — that
was never a document? See §4.

---

## 3. CITATION SPANS — the unit of doubt is a design decision

**OBSERVATION.** "Citation" is four granularities wearing one word, and the API makes the
differences explicit as distinct location types [S1, S2, S4]:

| Location type | Index unit | Fields |
|---|---|---|
| `char_location` | character range, **0-indexed, end exclusive** | `cited_text`, `document_index`, `document_title`, `start_char_index`, `end_char_index` |
| `page_location` | page range, **1-indexed, end exclusive** | `cited_text`, `document_index`, `document_title`, `start_page_number`, `end_page_number` |
| `content_block_location` | block range, **0-indexed, end exclusive** | `cited_text`, `document_index`, `document_title`, `start_block_index`, `end_block_index` |
| `search_result_location` | block range within one result | `cited_text`, `source`, `title`, `search_result_index`, `start_block_index`, `end_block_index` |
| `web_search_result_location` | opaque | `url`, `title`, `encrypted_index`, `cited_text` (*"Up to 150 characters"*) |

**Granularity is chosen by how you chunk, not by the model.** *"Document contents are 'chunked'
to define the minimum granularity of possible citations"*; plain text and PDF are *"chunked into
sentences"*, while custom-content documents use *"your provided content blocks… as-is and no
further chunking is done"* [S1]. The documented steer is explicit — put each RAG chunk in its own
plain-text document to get sentence citations inside it, or use custom content when the chunk
boundary *is* the honest citation boundary [S1]. For search results the equivalent lever is
prose: *"Break long content into logical text blocks to give Claude finer citation boundaries"*
[S2].

Four properties drive product decisions:

1. **Reliability is structural, not prompted.** *"Because the API parses citations into the
   response formats… and extracts `cited_text` directly, citations are guaranteed to contain
   valid pointers to the provided documents"* [S1]. A prompt saying "quote your source" carries
   no such guarantee, and Anthropic's own comparison says the feature is *"significantly more
   likely to cite the most relevant quotes… than purely prompt-based approaches"* [S1].
2. **The verbatim quote is free on the wire.** `cited_text` *"does not count toward your output
   tokens"* and, passed back on later turns, *"is also not counted toward input tokens"*;
   enabling citations costs only *"a slight increase in input tokens"* for system-prompt additions
   and chunking [S1]. Web-search citation fields `cited_text`/`title`/`url` likewise *"do not
   count toward input or output token usage"* [S4]. **The economics invert the intuition: asking
   a model to quote in prose is the expensive way to get quotes.**
3. **All-or-nothing per request, and incompatible with structured outputs.** *"citations must be
   enabled on all or none of the documents within a request"* [S1]; *"Citations are
   all-or-nothing"* for search results too [S2]. And enabling citations alongside
   `output_config.format` returns **400** — *"because citations require interleaving citation
   blocks with text output, which is incompatible with the strict JSON schema constraints of
   structured outputs"* [S1].
4. **For web search, citations are not optional.** *"Citations are always enabled for web
   search"*, and the docs add a display obligation: *"When displaying API outputs directly to end
   users, citations must be included to the original source"* [S4].

Google's Gemini grounding expresses the same idea differently: inline `annotations` on text
content carrying `type`, `url`, `title`, `start_index`, `end_index`, where *"Each annotation
includes `start_index` and `end_index` to identify which part of the text it cites"* [S3].

**EVIDENCE.** [S1][S2][S4] Tier 1 API references, fetched 2026-09-02, **verified** at field level
from the docs' own JSON examples. [S3] Tier 1, fetched 2026-09-02 — **verified as the page's
current description**, with a caveat: the field names on this page differ from earlier revisions
of the same doc (which used `groundingSupports` / `groundingChunks` / `groundingChunkIndices`).
Treat the exact names as version-bound and *"a span index range plus a source handle"* as the
durable pattern.

**INTERPRETATION.** The span is what converts C6-01's top two mechanisms from UI craft into a
data contract. LSEG's *"When data is presented in a table, each value carries its own citation"*
[C6-01 §0] is a per-cell `search_result_location`; AlphaSense's highlight-to-verify is a
character range. Those vendors are hand-building what the model API now returns natively — which
means the *rendering* is the remaining hard part, not the extraction.

The structured-output 400 is a real architectural constraint, not a bug to route around, and it
forces a choice at design time: **one call can produce a strict JSON object, or an answer with
interleaved spans — not both.** A product that wants both needs two passes: compute the object,
then narrate it with citations. That is pattern P4 arriving by a different road, and it is a
second independent argument for computing first.

**RELEVANCE TO UCT.** UCT reconstructs a weak span check *after the fact*: `coach_validation.py`
regex-matches every `$`/`%`/`R` token in the output against the injected data, and carries
documented scars from doing so (a `*`→`+` fix because `"$1000.00"` parsed as `$100` and flagged
every four-digit figure) [D-12 §6]. Span-bearing answers would retire that regex **for retrieved
text** — but not for computed numbers (§4), which is where UCT's highest-value figures live.

**CONFIDENCE.** 🟢 on [S1][S2][S4] shapes and constraints. 🟡 on [S3] field names (version drift
directly observed). 🔴 that any financial vendor renders a span rather than a document link —
none was observed.

**RECOMMENDATION (hypotheses).**
1. *Choose the citation unit before choosing the renderer.* Sentence chunking promises
   prose-level precision. For a desk pack whose atom is a **row**, block granularity is the honest
   unit, and sentence chunking would over-promise.
2. *Treat the structured-output incompatibility as confirmation of the facts-first shape.* If the
   deterministic object is computed outside the model anyway, the model's remaining job is
   narration — exactly where interleaved citations belong.

**ANTI-PATTERN.** *Never render a citation whose span you did not receive.* D-12 records UCT's
"grounded on" chips as naming **packs, not values**, with no drill-through to the row used
[D-12 §8 Gap #4]. That is a good debug affordance and it must not be promoted to a citation by
restyling it — a chip drawn from "which pack fired" asserts a bond the model never made.

**OPEN QUESTION.** Does any benchmark vendor expose its citation object (as opposed to a rendered
link) through an API or MCP server? If one does, its *granularity* would be the first observable
data point on what professionals actually verify against.

---

## 4. THE HOLE IN THE STACK — provenance for COMPUTED values

**OBSERVATION.** Every citation mechanism in §2–§3 binds a claim to **retrieved text**. None of
them binds a claim to a **computed number**. C6-01 flagged this as its own closing question —
*"Does any of these citation systems cover computed values… or only retrieved documents? …
nothing in the set states it"* [C6-01 §2] — and this pass found no counter-example: the wire
formats require a `content` array of text blocks and a source string [S1, S2].

This matters disproportionately to a trading desk, because the numbers a desk trusts most are the
ones it computes: breadth, exposure, flow aggregates, RS ranks, positioning indices, a portfolio
heat figure. A document citation is unavailable for all of them by construction.

Two established patterns fill the hole, and neither is an LLM feature:

- **Facts-first narration (P4).** The number is computed deterministically and handed to the model
  as the only figure it may use. UCT already ships two clean instances: `flow_explain.py` — *"the
  model only narrates them — it can never invent numbers we didn't hand it"* — and `cot_narrative`,
  whose gate stores nothing when a number in the prose is absent from the supplied facts [D-12 §3c].
  `cotFacts.js` as *"the ONLY numbers the LLM may cite"* is the same idea one layer up [C6-01 §2].
- **A provenance graph over the computation.** The W3C PROV data model is the standing vocabulary:
  three types — **Entity**, **Activity**, **Agent** — and relations `wasGeneratedBy`, `used`,
  `wasDerivedFrom`, `wasAttributedTo`, `wasAssociatedWith`, `actedOnBehalfOf`; its stated purpose
  is *"making judgements about information to determine whether to trust it"* [S14]. A computed
  metric is an Entity that `wasGeneratedBy` a calculation Activity that `used` named inputs. That
  is a citation target with a stable identifier — precisely what `search_result.source` accepts.

**EVIDENCE.** [S14] W3C *PROV Model Primer*, W3C Working Group Note, 30 April 2013, Tier 1
(standards body) — **verified**. [S1][S2] as above for the text-only constraint — **verified as
an absence in the schema**, which is a weaker claim than absence in the product. [C6-01 §2],
[D-12 §3c] internal.

**INTERPRETATION.** The transferable move is to make a computed value **quotable** by giving it a
row: an identifier, a value, an as-of timestamp, the inputs it used, and the version of the
calculation. Once it has that, it can be handed to the model as a `search_result` with
`source: "uct://breadth/pct_above_50sma@2026-09-02T15:45:00-04:00"` and cited like any document —
and the reader-side gesture (click the number, see the row) becomes possible for exactly the
figures a desk cares about most.

⚠️ **Scope boundary.** The canonical data model, metric dictionary and provenance *fields* are
**C7-03's** contract (`domain-data-platform.md`), and versioned calculations are named there. This
section claims only the AI-side consequence: *a metric with no addressable row cannot be cited by
any mechanism in §2–§3, no matter how good the model is.*

**RELEVANCE TO UCT.** UCT's proprietary numbers are its differentiator, and they are the ones its
AI currently cannot cite. D-12's Gap #5 reads as a rendering gap; §4 says half of it is actually a
**data-modelling** gap that no citation API will close.

**CONFIDENCE.** 🟡. The absence is established across the API references I read and C6-01's twelve
products; it is not established across every vendor's unpublished behaviour.

**RECOMMENDATION (hypothesis).** *Before building a citation renderer, check whether the numbers
worth citing have addresses.* A cheap first test: pick the ten figures a desk answer most often
states, and ask whether each has a stable id + as-of + inputs today. The ones that do not are the
ones the renderer will silently skip.

**ANTI-PATTERN.** *Do not synthesise a document to hold a number.* Rendering a computed metric
into a paragraph so it can be "cited" produces a citation that points at your own prose — a
second authority over one value, and the citation makes the fabrication look verified.

**OPEN QUESTION.** Does an as-of timestamp belong in the citation or in the value? If a member
re-opens an answer tomorrow, the cited row will have moved. Nothing in the citation APIs versions
a source.

---

## 5. TEMPORAL CONTEXT — the market clock is not a wall clock

**OBSERVATION.** A financial answer has at least **four** clocks, and the model is handed none of
them by default.

1. **The model's own horizon.** The provider publishes two distinct dates per model: *"Reliable
   knowledge cutoff: The date through which the model's knowledge is most extensive and
   reliable"* and a separate, broader *"Training data cutoff"* [S5]. They can differ — Claude
   Haiku 4.5 lists Feb 2025 reliable against Jul 2025 training [S5]. So "the model knows about
   X" is itself a two-valued question.
2. **Wall-clock now.** Nothing in the Messages API reference I read injects the current time. The
   only time-shaped input found is `user_location.timezone` (an IANA zone id) on the web search
   tool — and it *localises search results*, not the model's sense of now [S4]. **⚠️ This is an
   absence-of-evidence reading over the pages fetched, not a proof.**
3. **Source freshness.** This *is* instrumented, per source. Web search results carry `page_age`
   — *"When the site was last updated"* [S4]. Perplexity returns `date` and `last_updated` per
   search result and accepts `search_recency_filter` (hour / day / week / month / year),
   `search_after_date_filter` and `search_before_date_filter` on the request [S9].
4. **Session state.** The one no API models. NYSE publishes core hours *"9:30 a.m. to 4:00 p.m.
   ET"*, an early session *"7:00 a.m. to 9:30 a.m. ET"* and a late session *"4:00 p.m. to 8:00
   p.m. ET"*, plus full closures and **1:00 p.m. ET early closes** (2026: 3 July, 27 November, 24
   December) [S13]. "Today's move" therefore has five or six distinct meanings depending on the
   minute, and one of them is "the market is shut and has been for eleven hours".

The benchmark data point: LSEG — which C6-01 rates as having the best-specified grounding
contract in the industry — states flatly that for AI Search *"Real-time data is not currently
supported"* [C6-01 §0]. The most rigorous published contract in the set **excludes the live
clock rather than modelling it.**

**EVIDENCE.** [S5] Anthropic *Models overview*, Tier 1, 2026-09-02 — **verified** (cutoff
columns and their footnote definitions read directly). [S4][S9] Tier 1 API references,
2026-09-02 — **verified**. [S13] NYSE *Holidays & Trading Hours*, Tier 1 (the exchange itself),
2026-09-02 — **verified**. [C6-01 §0] internal.

**INTERPRETATION.** Freshness is handled everywhere as a **retrieval filter** and nowhere as a
**stated fact in the prompt**. That asymmetry is the defect: a recency filter makes the *sources*
fresh while leaving the model unable to say "the market closed three hours ago, so this is a
settled print, not a live one" — a sentence a desk answer needs constantly and cannot construct
from a `page_age`.

D-12 found the same shape inside UCT: no explicit time/market-status block in the widget system
prompt, with freshness handled by **cache salting** (`_fresh_salt()` appending a ~5-minute
`_time_bucket` when the query reads as day-recent) plus a Perplexity `recency_filter`, and a
deliberate in-code note that *"Today is deliberately excluded: the live quote pack already
answers it"* [D-12 §3d]. That reasoning is sound for *price* and insufficient for *session*: a
quote pack answers "what is it now", not "what does now mean".

**RELEVANCE TO UCT.** UCT's own product surfaces already encode session semantics that its AI
lanes apparently do not receive — the live breadth row is hidden once superseded; a carried
metric drills the session it came from rather than today's; the index-close post runs at a fixed
ET minute. Every one of those is a rule about *which clock applies*, and D-12's open question is
still open: *"Does any lane inject wall-clock ET time / session state, and if not, how does a model
answer 'is the market open' or 'what happened in the last hour' without inventing it?"* [D-12 §3d].

**CONFIDENCE.** 🟢 on the exchange session facts and the provider freshness fields (both quoted
from primary docs). 🟡 on "no API injects wall-clock time" — absence over the pages I fetched.

**RECOMMENDATION (hypotheses).**
1. *Make session state a first-class grounded fact, not an inference.* A single injected block —
   ET wall clock, session (`pre` / `RTH` / `post` / `closed` / `half-day`), minutes since the last
   session boundary, and the as-of of each pack — is cheap, deterministic and citable. It is also
   the kind of fact a grounding gate can check.
2. *Say what the answer is about, not just when it was asked.* An answer built from yesterday's
   close during pre-market should say so in the sentence, mirroring §3's rule that the label
   belongs on the claim rather than the session.

**ANTI-PATTERN 1.** *A freshness mechanism that lives only in the cache key.* Cache salting makes
the answer fresh and leaves the model ignorant of the clock — the member sees a current answer
phrased as if the market were open.

**ANTI-PATTERN 2.** *Caching a prompt prefix that contains market state for longer than the state
lasts.* Prompt caching offers a 5-minute default and a **1-hour** TTL at 2× write cost [S6]. A
one-hour cached system prefix containing "the market is open" is wrong for up to an hour, and the
cost saving is what makes it tempting.

**OPEN QUESTION.** Half-days and holidays are the concrete test: on 27 November 2026 the market
closes at 1:00 p.m. ET [S13]. Does any AI surface in the benchmark set — or in UCT — know that?
Nothing found either way.

---

## 6. REFUSAL, ABSTENTION, AND THE THREE STATES THAT KEEP COLLAPSING

**OBSERVATION.** There are **three** distinct outcomes for a retrieval-backed answer, and every
layer of the stack has been caught collapsing two of them:

| State | Correct answer | Collapsing it produces |
|---|---|---|
| (a) We retrieved, and it says X | State X, cite it | — |
| (b) We retrieved, and there is genuinely nothing | *"There is nothing"* | Confident, wrong absence claims |
| (c) We failed to retrieve | *"We could not check"* | (c) rendered as (b) = a lie a member will act on |

The provider now separates (b) from (c) **at the wire level**: web search returns HTTP 200 with a
typed error object inside the body on failure, and *"A search that succeeds but matches no results
returns an empty `content` list, not an error"* [S4]. The custom-retrieval guidance says the same
thing from the developer's side: on a failed or empty search, *"return a plain text block
describing the outcome (for example, `{"type": "text", "text": "No results found."}`) instead of
raising an error: Claude explains the empty result to the user, and the conversation continues"*
[S2].

On the model's behaviour, the published technique list is short and mechanical [S8]: *"Allow
Claude to say 'I don't know'"*; extract *"word-for-word quotes first"* for long documents;
*"Verify with citations"* — with the strong form being **retraction**: *"For each claim, find a
direct quote from the documents that supports it. If you can't find a supporting quote for a
claim, remove that claim"*; plus chain-of-thought verification, best-of-N, iterative refinement,
and *"External knowledge restriction"*. The guidance ends honestly: these *"don't eliminate them
entirely"* [S8].

And the measurement says the tension is real. FailSafeQA constructs both failure modes on purpose
— perturbed queries and **degraded, irrelevant or empty documents** — and scores Robustness,
Context Grounding and Compliance across 24 models; its headline is that *"the most robust model,
OpenAI o3-mini, fabricated information in 41% of tested cases"*, while the most compliant model
lost robustness in 17% [S11].

**EVIDENCE.** [S4][S2] Tier 1 API references, 2026-09-02 — **verified**. [S8] Anthropic *Reduce
hallucinations*, Tier 1 official guidance, 2026-09-02 — **verified**. [S11] *Expect the
Unexpected: FailSafe Long Context QA for Finance*, arXiv:2502.06329, submitted 2025-02-10, Tier
academic-primary — **reported at abstract level; the full paper was not read**, and the models
tested are a 2025 generation.

**INTERPRETATION.** The (b)/(c) collapse is the same defect at three different layers, and only
one layer has been fixed upstream:

- **UI layer** — D-12 records UCT's own incident verbatim: `.catch(() => null)` *"collapses a 502,
  a dropped connection, a redeploy and a genuinely quiet ticker into the same `null`"*, and the
  renderer printed *"No recent news for this ticker."* against NVDA while the endpoint was
  returning 15KB of headlines [D-12 §6]. Fixed in `sectionFetch.js`; **six sibling call sites did
  not migrate** [D-12 §6].
- **Prompt layer** — solved well already. `_SAFETY_BLOCKS` runs **DEFAULT TO ANSWERING** with a
  *separate* DATA-LIMITS branch: a legitimate markets question you cannot answer precisely *"is
  NOT off-topic: do NOT use the scope-refusal line"* — say in one phrase what you lack, then give
  the best read you can, and *"Never fabricate a precise figure to fill the gap"* [D-12 §6].
- **Eval layer** — still collapsed everywhere. FinanceBench's headline metric merges them:
  *"GPT-4-Turbo used with a retrieval system incorrectly answered or refused to answer 81% of
  questions"* [S10]. From a research standpoint that is one bucket; from a product standpoint a
  refusal and a wrong number are opposite outcomes. FailSafeQA is the corrective — it scores
  Compliance separately from Robustness precisely so the trade-off is visible [S11].

**RELEVANCE TO UCT.** UCT is unusually well-positioned here and has one asymmetry. Its prompt-side
refusal contract is better specified than anything C6-01 found published by a vendor, and its
`.catch(() => null)` fix names the exact incident. What it does not have is the **eval-side**
separation: neither report card, as described in D-12 §4, contains a fixture where the *correct*
answer is "we hold nothing" — so an over-refusal and a fabricated absence are both invisible to
the exam. That is `lesson_an_over_refusal_is_invisible` restated as a missing test class.

**CONFIDENCE.** 🟢 on the API-level distinction and the published techniques. 🟡 on the two
benchmark numbers (abstract-level reads of specific model generations, not current claims and not
reproducible from here).

**RECOMMENDATION (hypotheses).**
1. *Give the empty case its own return type all the way up.* The provider already does it; a
   retrieval tool that returns "no rows" as a value rather than as an exception, and a renderer
   that distinguishes both from an error, closes the loop the fetcher fix started.
2. *Add a "correct answer is a refusal" class to the exam.* FailSafeQA's shape is the cheapest
   transferable idea: deliberately empty and deliberately irrelevant context, scored on whether
   the system declines. Without it, "we improved the answers" and "we made it more willing to
   invent" are the same score movement.
3. *Score Compliance and Robustness separately, and never as one number.* One benchmark in this
   pair does; the more famous one does not, and the more famous number is the one that gets
   quoted.

**ANTI-PATTERN.** *Retraction phrased as a hedge.* The published strong form is **remove the
claim** [S8]; a system that instead appends "though this may be inaccurate" keeps the fabrication
and buys nothing — which is C6-01's anti-pattern #8 (a refusal posture that resolves into
hedging) arriving from the prompt-engineering side [C6-01 §10].

---

## 7. EVALUATION HARNESSES FOR FINANCIAL QA

**OBSERVATION.** Four evaluation shapes are publicly available, and they measure different layers.

| Harness | What it measures | Cost per run | Needs ground truth |
|---|---|---|---|
| **FinanceBench** [S10] | End-to-end open-book financial QA over public-company disclosures — 10,231 questions, headline evaluation on a 150-question sample with ~2,400 manual reviews | High (manual review) | Yes (answers + evidence strings) |
| **FailSafeQA** [S11] | Robustness to perturbed queries and to **degraded / irrelevant / empty** context; Robustness, Context Grounding, Compliance across 24 models | High (LLM-judged) | Partly — the empty-context cases are judged on abstention |
| **Ragas** [S12] | Component metrics: **Faithfulness** (response grounded in retrieved context), **Context Precision**, **Context Recall**, **Context Entities Recall**, **Response Relevancy**, **Noise Sensitivity** | Medium — *"LLM Based metrics"* make one or more LLM calls per score | Mixed; the page does not state which are reference-free |
| **UCT `--grounding-audit`** [D-12 §4] | **Retrieval only**: which context packs fired per golden question, and which required tool-groups nothing fired for — **by name** | **$0, seconds, no provider call, deterministic** | No |

**EVIDENCE.** [S10] *FinanceBench: A New Benchmark for Financial Question Answering*,
arXiv:2311.11944, submitted 2023-11-20, Tier academic-primary — **reported at abstract level**
(the abstract page was read; the full paper was not). [S11] as §6. [S12] Ragas *Available
metrics*, Tier 1 (official OSS documentation), 2026-09-02 — **verified as the metric list**;
⚠️ the page does not state which metrics are reference-free, so that column is honestly blank.
[D-12 §4] internal.

**INTERPRETATION.** Ragas's Context Precision and Context Recall measure the same axis
`--grounding-audit` measures — *did retrieval bring back the right thing* — but they do it with
LLM calls, and the audit does it with none. UCT's cheaper instrument is not a poor substitute for
the industry standard; on that one axis it is a **deterministic** version of it, and D-12 records
why it exists in the codebase's own words: an honest fast-lane run *"scored 13/30 with ELEVEN gate
misses, and several of those answers scored 4/4/4/4 from the judge — a fluent answer built without
the desk pack the question needed. That is a RETRIEVAL failure wearing an answer-quality
costume"* [D-12 §4]. That is the whole argument for measuring retrieval before paying for answers,
and it is stated better internally than in any external source found.

Two hazards are documented internally and appear nowhere in the external harnesses:

- **The anti-vacuity problem.** The fast lane always makes a web call, so the audit injects a
  synthetic `<web leg>` capture — otherwise five questions read as missing a `web_search` *"the
  lane cannot fail to have"*, i.e. *"an audit reporting a miss that is impossible"* [D-12 §4].
  Ragas and FinanceBench have no equivalent guard because they do not know the lane's shape.
- **Live-data A/B invalidity.** *"Fast-lane scores are only comparable WITHIN one session… Never
  A/B across hours; run before-and-after back to back"* [D-12 §4]. Every published financial-QA
  benchmark uses a frozen corpus and therefore never confronts this — which means **no external
  harness validates a live-market lane**, and adopting one wholesale would import a false sense of
  comparability.

**RELEVANCE TO UCT.** UCT already runs two graded exams with deploy-gate exit codes (exit 1 = do
not ship) [D-12 §4]. The gaps against the external state of the art are narrow and specific:
(i) no refusal/abstention class (§6); (ii) no retrieval audit on the Compass side — *"Exists for
the AI-Search golden set only"* [D-12 §8 row 8]; (iii) no latency axis anywhere, and D-12 says
latency classes are *inferred from timeouts and cache TTLs, not measured*, with no p50/p95
existing [D-12 GAPS].

**CONFIDENCE.** 🟢 on what each harness measures and on the internal audit's mechanism. 🟡 on the
two arXiv results (abstract-level). 🔴 on any claim about *relative* performance — nothing was run.

**RECOMMENDATION (hypotheses).**
1. *Extend the free retrieval audit to every lane before adding a single graded question.* It is
   the highest measurement-per-dollar instrument in this whole file and it already exists.
2. *Borrow Ragas's vocabulary, not its runtime.* Context precision / recall / faithfulness are
   useful names for axes UCT already gates on; adopting the names makes the internal exams legible
   to anyone who has seen the standard, at zero cost.
3. *Add a latency axis to the exam, not just a timeout to the client.* A grounding-audit-style
   deterministic pass cannot measure latency, but the answer exam already makes the calls.

**ANTI-PATTERN.** *A benchmark number quoted without its model generation and its date.* The most
circulated figure in financial-QA evaluation (FinanceBench's 81%) describes a 2023 retrieval
setup [S10]; treating it as a current statement about LLMs would be a straightforward
misreading, and it is exactly the kind of number that gets pasted into a strategy deck.

---

## 8. COST AND LATENCY TIERS

**OBSERVATION.** Grounding is priced, and the prices decide the architecture. Published rates as
of 2026-09-02 [S5, S6, S7, S4, S1]:

**Model tier** (per million tokens, input / output) — *"Comparative latency"* in the same table
runs Fable slower → Haiku fastest [S5]:

| Model | Input | Output | Context | Reliable knowledge cutoff |
|---|---|---|---|---|
| Claude Fable 5.1 | $10 | $50 | 1M | Jun 2026 |
| Claude Opus 5 | $5 | $25 | 1M | May 2026 |
| Claude Sonnet 5 | $2 | $10 | 1M | Jan 2026 |
| Claude Haiku 4.5 | $1 | $5 | 200K | Feb 2025 |

**Prompt caching** [S6]: *"5-minute cache write tokens are 1.25 times the base input tokens
price"*; *"1-hour cache write tokens are 2 times"*; *"Cache read tokens are 0.1 times the base
input tokens price"* (Fable 5.1 / Mythos 5.1 read at **0.025×**). Minimum cacheable prefix is
512–4,096 tokens depending on model, and *"Shorter prompts cannot be cached… no error is
returned."* The prefix hierarchy is **`tools` → `system` → `messages`**, and a change at one level
invalidates it and everything after. Pre-warming *"eliminates the cache-miss latency penalty on
the first user interaction"*.

**Batching** [S7]: *"reducing costs by 50%"*, *"most batches finishing in less than 1 hour"*, hard
ceiling *"either 100,000 Message requests or 256 MB in size"*, results available *"when all
messages have completed or after 24 hours, whichever comes first"*, and expired requests are not
billed. Note `max_tokens: 0` cache pre-warming is **not supported inside a batch** [S7].

**Server-side retrieval** [S4]: web search is *"$10 per 1,000 searches, plus standard token
costs"*; each search counts once regardless of result count; an errored search is not billed.
Two token levers: **dynamic filtering** (the model writes code that filters results *before* they
reach the context window) and `response_inclusion: "excluded"`, which drops consumed search blocks
from the response *"reducing output token costs for agentic workflows"*.

**Citations** [S1]: a slight input-token increase; `cited_text` free in **both** directions.
Perplexity adds a corpus lever rather than a price lever: `search_mode` of `web`, `academic` or
**`sec`** (SEC filings) [S9].

**EVIDENCE.** [S1][S4][S5][S6][S7] Anthropic Tier 1 references, all fetched 2026-09-02 —
**verified**, figures quoted. [S9] Perplexity API reference, Tier 1, 2026-09-02 — **verified**.

**INTERPRETATION.** Three latency tiers fall out, and each has a different correct grounding
posture:

| Tier | Member state | Grounding posture | Economics |
|---|---|---|---|
| **Synchronous** | waiting | cached prefix + citations on; cheapest model that clears the exam | cache read at 0.1× dominates; TTFT is the metric |
| **Deferred** | not waiting (warmers, digests, pre-generation) | full retrieval, generous timeouts | Batch at **50%**, <1h typical, 24h ceiling |
| **Free** | any | deterministic template, computed verdict, grounding audit | **$0** — the tier UCT already exploits best |

Two non-obvious interactions:

1. **A "show citations" toggle is a cache-invalidation event.** The caching doc lists *"Web search
   or citations toggle"* as invalidating **system and message caches** [S6]. So a per-user or
   per-answer citations switch is not free UI polish — it busts the cached prefix on every flip,
   and pairs badly with §3's rule that citations are all-or-nothing per request [S1, S2]. The
   cheap design is *citations always on, rendering optional*.
2. **The free tier is where grounding is strongest, not weakest.** A computed verdict, a
   templated fallback and a deterministic retrieval audit all cost nothing and all fail closed.
   The expensive tiers buy fluency and coverage, not trustworthiness.

**RELEVANCE TO UCT.** D-12 shows the deferred tier is built and barely used: `llm_batch.py` has a
durable ledger, `BATCH_DISCOUNT = 0.5`, unordered-result handling keyed strictly by `custom_id`,
and *"Exactly ONE consumer today"* — `call_recap_warmer` — while every other warmer matches the
module's own criterion [D-12 §2c]. Prompt caching sits at six call sites [D-12 §2c]. The timeout
rail is the other side of the same coin and is already the right shape: it *"never dictates a
value, only that one is stated"* [D-12 §5f].

**CONFIDENCE.** 🟢 on every published figure (quoted from versioned pricing/reference pages,
2026-09-02 — prices move, so the date is load-bearing). 🔴 on UCT's actual spend: D-12 could not
read any ledger [D-12 §5f].

**RECOMMENDATION (hypotheses).**
1. *Classify every AI surface into synchronous / deferred / free before optimising any of them.*
   The tier decides the model, the cache TTL and whether batching applies; optimising within the
   wrong tier is where the money goes.
2. *Citations always on; rendering is the product decision.* It avoids the cache invalidation, the
   all-or-nothing constraint, and the C6-01 anti-pattern of a provenance mode-switch with no
   rendering change [C6-01 §10].

**ANTI-PATTERN.** *Reaching for a cheaper model as the first cost lever.* On these numbers the
ordered levers are cache reads (10× or 40× on input), batching (2×), dynamic filtering and
response exclusion (token volume), and only then model tier — and UCT already holds a standing
doctrine that a model must not be downgraded for cost.

---

## 9. THE "ALREADY HAVE" COLUMN — UCT against the six patterns

Derived from D-12 and C6-01; nothing here was re-derived from code.

| Pattern | UCT today | Evidence | Gap for TERMINAL-NEXT |
|---|---|---|---|
| **P1** prose attribution | Yes — *"attribute them to 'UCT desk data'"* in the system prompt, plus a judge rubric axis | [D-12 §3c] | This is the weakest row and it currently carries desk provenance alone |
| **P2** declared gaps | **Yes, and well done** — `meta["grounding_gaps"]`, with the in-file reason: *"Silence reads to the model as 'the desk didn't mention it', and it invents flow"*; one symbol answering suppresses the gap | [D-12 §3a] | Extend to session/time gaps (§5) |
| **P3** post-generation gate | **Yes, multiple** — `cot_narrative` grounding gate (stores nothing on failure), `coach_validation` numeric+symbol grounding, `compass_eval/checks.py` with documented residuals | [D-12 §3c, §6] | Gates are per-surface, not a shared component |
| **P4** facts-first / computed verdict | **Yes, exemplary** — `flow_explain` (*"can never invent numbers we didn't hand it"*), `grade_ticker` (verdict computed, model narrates) | [D-12 §6], [C6-01 §2] | Not generalised; each is hand-built per surface |
| **P5** API citation spans | **NO — absent everywhere** | [D-12 §8 Gap #5] | The whole reader-side half. Web `[n]` markers exist; desk data has no linkable marker |
| **P6** configuration-as-answer | Partial — AI-Search **proposal chips** (an LLM surface *"must not mutate member state off a regex"*; the member's tap does the write) | [D-12 §6] | No generated *screen* analogue to TradingView's AI Screener [C6-01 §2] |
| **Context visibility** | **Yes, rare** — `grounding: {sources, intents}` rendered as "grounded on" chips | [D-12 §3c, §8 Gap #4] | Chips name **packs, not values**; no drill-through to the row used |
| **Retrieval measurement** | **Yes, best-in-file** — `run_grounding_audit()`, $0 and deterministic | [D-12 §4] | AI-Search golden set only; Compass has none |
| **Refusal contract** | **Yes, better than any vendor's published posture** — default-to-answering + a separate data-limits branch + hard refusals | [D-12 §6] | No exam class where the correct answer is a refusal (§6) |
| **Temporal / session context** | **NOT DETERMINED, probably absent** — freshness by cache salt, no time block found | [D-12 §3d] | Session state as a stated, gate-checkable fact (§5) |
| **Computed-value provenance** | Facts-first only; no addressable metric rows | §4, [C6-01 §2] | Owned jointly with C7-03 |

**The one-line reading:** *UCT's grounding is stronger than any vendor's published posture on the
producer side (P2/P3/P4) and has nothing at all on the reader side (P5).* C6-01 reached the same
conclusion from the product direction [C6-01 §2]; this file adds that the missing half is now a
wire format rather than a research problem — and that half of it (§4) is a data-modelling job no
citation API will do.

---

## GAPS

- **Nothing was observed running.** No product, no renderer, no answer. This is the governing
  ceiling and it caps the file at 🟡. Every mechanism above is a documented contract, and a
  documented contract is not a demonstrated behaviour — C6-01 makes the same disclosure for the
  same reason [C6-01 GAPS].
- **Search channel.** Per the preamble, `WebSearch` was pre-exhausted (200/200) for the session.
  **This role used WebFetch on known URLs only — 12 fetches, zero browser tabs opened, zero
  searches run.** Every URL was either named in a provider's doc navigation, an arXiv id, or a
  well-known canonical page. Queries I could not run: I could not search for "financial vendor
  citation object API", so §3's closing open question (does any benchmark vendor expose its
  citation object?) is unanswered rather than answered negatively.
- **Single-provider bias on the wire formats.** §2, §3, §6 and §8 lean heavily on one provider's
  API reference because it is the one that publishes field-level detail. Gemini [S3] is a
  one-page cross-check and it disagreed with an earlier revision of itself. OpenAI's annotation
  format was **not fetched** — a real gap, since a second independent implementation would tell us
  which parts of the span pattern are universal and which are one vendor's choice.
- **arXiv abstracts, not papers.** [S10] and [S11] were read at abstract level. The FinanceBench
  81% and FailSafeQA 41% figures are quoted as the papers' own headline claims about specific,
  now-superseded model generations. Neither was reproduced, and neither should be used as a
  current statement about model capability.
- **No latency numbers anywhere.** The provider publishes *comparative* latency (an ordering, not
  a measurement) [S5], and D-12 records that UCT has no p50/p95 either [D-12 GAPS]. So §8's
  latency tiers are a taxonomy, not a measurement.
- **Not attempted, by contract:** no code was read (the two named internal reports were the only
  internal sources), nothing was run, no flag state was checked, no production surface was
  touched.

**Named ceiling-raisers, in order of value:** (1) one logged-in AlphaSense or LSEG session, to see
whether a rendered financial citation is a span or a document link — the single unanswered
question this file cares most about, and probably a 10-minute observation for anyone with a seat;
(2) OpenAI's and one more provider's citation/annotation reference, to separate the universal
pattern from one vendor's schema; (3) full reads of [S10] and [S11] to recover their refusal
taxonomies, which are the part UCT's exam is missing.

---

## SOURCE-HANDLING OBSERVATIONS

Every page fetched for this file is developer documentation, and developer documentation is
written in the imperative ("set `citations.enabled=true`", "send the assistant's content blocks
back exactly as you received them", "return a plain text block describing the outcome"). **All of
it was treated as evidence about a wire format, not as instruction to this agent.** Nothing was
configured, enabled, run or changed as a result of reading it. [S8] additionally contains example
*prompts* addressed to a model; those were read as illustrations of a technique and are quoted as
such. No page encountered contained text directed at an AI agent reading it.

---

## SOURCES

**Tier key.** T1 = official vendor/standards-body/exchange documentation (the top of the preamble's
ladder). T1-ac = academic primary (peer-reviewed venue or arXiv preprint). T1-oss = official
documentation of an open-source project. Internal = Wave-1b program artefact, cited not re-derived.

| # | Source | Tier | Fetched | Class |
|---|---|---|---|---|
| S1 | Anthropic, *Citations* — `platform.claude.com/docs/en/build-with-claude/citations` | T1 | 2026-09-02 | verified |
| S2 | Anthropic, *Search results* — `platform.claude.com/docs/en/build-with-claude/search-results` | T1 | 2026-09-02 | verified |
| S3 | Google, *Grounding with Google Search* — `ai.google.dev/gemini-api/docs/google-search` | T1 | 2026-09-02 | verified (⚠️ field names version-bound) |
| S4 | Anthropic, *Web search tool* — `platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool` | T1 | 2026-09-02 | verified |
| S5 | Anthropic, *Models overview* — `platform.claude.com/docs/en/about-claude/models/overview` | T1 | 2026-09-02 | verified |
| S6 | Anthropic, *Prompt caching* — `platform.claude.com/docs/en/build-with-claude/prompt-caching` | T1 | 2026-09-02 | verified |
| S7 | Anthropic, *Batch processing* — `platform.claude.com/docs/en/build-with-claude/batch-processing` | T1 | 2026-09-02 | verified |
| S8 | Anthropic, *Reduce hallucinations* — `platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations` | T1 | 2026-09-02 | verified |
| S9 | Perplexity, *Chat Completions* API reference — `docs.perplexity.ai/api-reference/chat-completions-post` | T1 | 2026-09-02 | verified |
| S10 | Islam, Kannappan, Kiela, Qian, Scherrer, Vidgen, *FinanceBench: A New Benchmark for Financial Question Answering*, arXiv:2311.11944, submitted 2023-11-20 | T1-ac | 2026-09-02 | reported (abstract only) |
| S11 | Kamble, Russak, Mozolevskyi, Ali, Russak, AlShikh, *Expect the Unexpected: FailSafe Long Context QA for Finance*, arXiv:2502.06329, submitted 2025-02-10 | T1-ac | 2026-09-02 | reported (abstract only) |
| S12 | Ragas, *Available metrics* — `docs.ragas.io/en/stable/concepts/metrics/available_metrics/` | T1-oss | 2026-09-02 | verified (metric list) |
| S13 | NYSE, *Holidays & Trading Hours* — `nyse.com/markets/hours-calendars` | T1 | 2026-09-02 | verified |
| S14 | W3C, *PROV Model Primer*, W3C Working Group Note, 2013-04-30 — `w3.org/TR/prov-primer/` | T1 | 2026-09-02 | verified |

**Internal (cited, not re-derived).**

| Ref | File | Sections used |
|---|---|---|
| D-12 | `08-ai/existing-ai-systems.md` | §0 headline · §2c tool registries, batch, prompt caching · §3a packs-vs-tools fork · §3c citation and provenance · §3d time/market-status · §4 exams and `--grounding-audit` · §5f timeouts · §6 safety, refusal contract, `.catch(() => null)` · §8 gap table · GAPS |
| C6-01 | `08-ai/ai-native-tools-survey.md` | §0 survey table (LSEG per-value citations, "real-time data is not currently supported") · §2 the five-mechanism ladder and its UCT reading · §9 abstention · §10 anti-patterns · GAPS |
