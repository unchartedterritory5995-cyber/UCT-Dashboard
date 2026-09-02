---
id: C6-01
title: AI-native financial tools survey
role: Domain pod — AI-native financial tools (Parts XXV, XIII §13, CXXXV)
wave: 1b
group: C
category: domain
scope: Shipped vs demoed AI across financial research/trading products; grounding and citation behaviour; "why is it moving"; natural-language screening; the agent-facing turn
confidence: 🟡 overall
evidence_ceiling: No paid seat on ANY product in this survey. Every behavioural claim about an AI surface below is the vendor's own description or a Wave 1b dossier's reading of it — not an observed run. That includes every citation mechanism described here. Raising it needs one logged-in session per product with (a) a deliberately unanswerable prompt and (b) a claim traced to its cited source. The owner could supply TradingView (~$13/mo) and Perplexity Pro cheaply; AlphaSense/LSEG/FactSet/Bloomberg/Rogo are enterprise-sales-gated and will stay 🟡.
sources: 12 internal Wave 1b dossier sections (cited, not re-derived) + 9 external primary/official pages fetched 2026-09-02; 5 secondary
uct_relevance: high
status: draft
date: 2026-09-02
---

# AI-native financial tools — survey

**What this file is.** A CROSS-PRODUCT survey of AI in financial software. Where a Wave 1b
dossier already established a fact, it is **cited, not re-derived** — §I of each dossier is the
source of record for that product and this file does not repeat its evidence chain. Original
research here covers the three products with **no dossier** (Perplexity Finance, Fintool, Rogo)
and the cross-product patterns that only appear when the twelve are read side by side.

**Terms.** TERMINAL-NEXT = the workstation being designed. TERMINAL-CURRENT = the existing
`/calendar` surface (display-named "UCT Terminal"). Nothing below is a requirement. "Product X
does Y" never implies "UCT should build Y".

**Evidence classes** used throughout: **verified** (primary doc) · **demonstrated** (seen in an
official demo/video transcript) · **claimed** (marketing) · **reported** (practitioner/press) ·
**not determined**.

---

## 0. THE SURVEY TABLE

Read the **grounding mechanism** column first — it is the axis on which these products actually
differ. Every other column is table stakes.

| Product | Shipped AI (documented, dated) | Announced / demoed only | Grounding + citation mechanism (vendor's words) | NL screening | "Why is it moving" | Class | Conf |
|---|---|---|---|---|---|---|---|
| **Fiscal.ai** (ex-FinChat) | Doc-scoped AI summaries on 10-K/10-Q/transcripts/IR decks **with citation support** (2026-05-13); AI company reports w/ PDF export; AI NL screening; AI Prompt Templates (2026-02-20); **Fiscal MCP sold as a standalone product since 2026-07-16** with a named **Skills catalogue** (`financials-pull`, `comp-set`, `valuation`, `screener`, `watchlist-monitor`, …) | Nothing material. The *conversational* Copilot appears retired — the word is absent from the changelog after 2025-01 | Every figure carries a click-through that **opens the source PDF at the exact page**. MCP **inherits plan entitlements**: an assistant "can only retrieve data you could retrieve yourself with your API key for the same tickers, periods, and features" | ✅ NL screening + a `screener` skill | ➖ | Verified (MCP, skills, entitlement rule); claimed (91% FinanceBench) | 🟢 shipped 🔴 accuracy |
| **AlphaSense** | Generative Search (research-plan framing; 12-month default window; Gemini for the web-search path); **Deep Research** (2025-06-13; five stages; 10–30 min); **Smart Summaries** (3000+ companies; earnings summaries within ~5 min); Workflow Agents (13 deal agents incl. CIM Analyzer) | **SuperAnalyst** — press release 2026-06-03, product page says **"Coming Soon"**, early access only, **zero customer statistics** | Sentence-level citations; selecting a summary opens the document **with the passage highlighted**; **highlight any text in the answer → verify that specific claim**. Help centre's honest version: if there is no answer it "will say so, instead of fabricating a response" | ➖ (search, not screen) | Partial — Smart Summaries' Upgrades & Downgrades / Strengths & Threats | Verified (shipped set + SuperAnalyst's non-GA status) | 🟢 shipped 🟡 quality |
| **LSEG Workspace** | **AI Search GA 2026-06-23** (needs Workspace ≥1.26.504 or 2.0; excluded from Access/Students/Kiosk/Media editions and from mainland China); Company Intelligence agent (2026-07, "several thousand users"); Deep Research agent; Advanced Dealing NLP; Teams AI Library | Company Intelligence in Teams "coming soon" | **The best-specified contract in the set.** Clickable citations w/ snippet previews; **"When data is presented in a table, each value carries its own citation"**; document citations open a canvas view and **highlight the exact passage**; **licensed third-party research is NEVER summarised — verbatim extracts only, unblended, page-metered**. Publishes a **Known issues** table at GA and an acceptable-use clause on prompt injection | ➖ | ➖ — and **"Real-time data is not currently supported"** | Verified (near-total direct quotation from versioned LSEG docs) | 🟢 |
| **Bloomberg** | AI News Summaries over 30,000 sources; **AI-Powered Earnings Call Summaries** (2024-01-22) w/ a fixed topic taxonomy (guidance, capital allocation, hiring, macro, new products, supply chain, consumer demand); `DS` Document Search NL over ~200M docs w/ AI topic overviews | **ASKB** conversational/agentic — **in beta**; ASKB Workflows (earnings prep, post-event, meeting prep); desktop↔mobile mid-thread continuity | "Grounds every response in high-quality, trusted data and includes **transparent attribution** to original research documents and news sources." Call summaries: **clicking a summary point jumps to the corresponding excerpt in the transcript**, and links out to `MODL`/`BDVD`/`SPLC` | ➖ | Closest: `DS` topic trends + the call-summary driver taxonomy | Claimed (product page) + Reported (trade press). **No primary technical doc, no demo** | 🟡 |
| **FactSet** | **Mercury** as the conversational engine (no longer the headline brand); Portfolio Assistant; **Security Explanation**; Transcript Assistant; Portfolio Commentary; Pitch Creator; IRN AI; **MCP server + Portfolio Analytics MCP**; Conversational API (2024-11-15) | **Agent Hub** — named once in a governance statement, no product page; end-to-end "agentic research workflows"; "deploys in weeks, not months" | RAG "to avoid data hallucinations"; **"all responses have full in-context source linking"**; generative output **"clearly labelled throughout the user interface with linked references"** — stated as a **UI invariant, not a per-feature option**; private LLM instances only; **entitlements enforced per human, including for agents**; 24-month log retention | ➖ | ✅ **Security Explanation** — "summarizes transcripts and news to identify key factors driving security performance" — the closest productised "why is it moving" in the set | Verified as published; **not demonstrated** | 🟢 published 🟡 in-product |
| **Quartr** | AI chat over the first-party corpus with **per-query model choice ("such as Claude, GPT, or Gemini")**; AI summaries at **three lengths** with embedded refs (API-verified 2025-06-10); Chapters (2025-05-05, hierarchical 2025-08-20); **Automations** (2026-08-24 — prompt + trigger, "run whether or not you are logged in"); **Quartr MCP** in Claude / Codex / Perplexity; AI-estimated report dates | The "AI infrastructure for company research" framing; "no hallucination" on the MCP page; "unmatched accuracy"; a customer's "cuts research time by 70%" | "**Every answer includes direct links to the exact pages** used to generate the response", opening side-by-side with the chat. ⚠️ Chat can **"optionally source wider web results beyond company documents"** — a mode switch that silently changes the provenance guarantee the product is sold on; **no public page describes how a mixed answer is labelled** | ➖ | ➖ — Quartr never renders a view. No score, no rating anywhere in the product | Verified (dated changelogs + API docs) | 🟢 shipped 🔴 web-mix |
| **TradingView** | **AI Screener** — 2026-08-17, public beta, **Stock Screener only**, all paid plans, monthly request balance resetting on the 1st; templates don't consume balance | Other asset classes "to follow"; no mobile | **No citation machinery at all — the artefact IS the citation.** An **Explanation** function shows every applied filter with reasoning, plus how results are sorted and which columns were added. ⚠️ Destructive default: "Running an AI request **replaces** any manually set filters"; no documented merge or undo | ✅ **The exemplar.** NL → a *finished, editable screen*: "Your idea arrives as a finished screen, not a to-do list" | ➖ | Verified as TV's description; behaviour **claimed** until run | 🟡 |
| **Unusual Whales** | **Mr. Whale** chat (2026-05-19) + four automation types — Newsletters / Research / Feed Monitor / Scheduled Run — metered 1×/2×/3× by tier; **MCP server** (2026-03-12); a **published agent skill file** (`/skill.md`); MCP **builder prompts** + `get_build_recipe`; AI-generated ticker-page news items | ➖ | Mr. Whale: **NOT DETERMINED** — no public transcript, no citation example, subscription-gated. The **agent layer's** grounding is an **endpoint whitelist**: the skill file "emphasizes avoiding 'commonly hallucinated' endpoints through strict adherence to a whitelisted set of verified URLs" | ➖ (but the alert formula language is an NL-adjacent DSL) | Adjacent and better: `option-stance` — a **deterministic 0–5 `fit_score` with named 0–1 sub-scores** (`iv_regime`, `greeks_fit`, `dte_fit`, `liquidity`, `earnings_timing`) + a narrating `explanation` + a standing `disclaimer` on every response | Verified (agent layer + option-stance, both in the official spec) | 🟢 agent layer 🔴 chat |
| **Perplexity Finance** *(new research)* | **"Computer for Finance"** — a dashboard (US Markets · Crypto · Earnings · Predictions · Screener · Politicians · Watchlist · Portfolio · Workflows · App Gallery) sitting on **40+ live finance tools** callable by Computer; Plaid brokerage connect for portfolio analytics; Polymarket prediction markets on entity pages; **Premium Sources** (Statista, CB Insights, PitchBook) cited inline | **Personal Computer** (dedicated Mac mini, 24/7) — **waitlist open**; Computer for Enterprise / Comet Enterprise; the four-API platform (Search, Agent, Embeddings, Sandbox) | "In finance, the data has to be correct, current, and auditable… **Every figure is fully traceable back to its original source.**" Premium Sources "are cited in research queries and can link to the right source, automatically." Personal Computer: "Sensitive actions require approval, and every session includes a full audit trail. A kill switch gives users immediate control" | ✅ Screener exists, with published limits: **US + Indian equities only; last annual filing; max 1000 rows/query** | ✅ Generated per-list/per-day market commentary (e.g. "no major earnings or corporate announcements driving today's price action") | Verified (live pages + official blog, 2026-09-02); the $1.6M/3.25-years productivity figure is a **vendor self-study** | 🟡 |
| **Fintool** *(new research)* | **Gone as a standalone product.** V5 (Jan 2026) was "a fully agentic experience" writing a DCF in Excel, an earnings deck in PowerPoint, a memo in Word | — | Not determinable now: **`fintool.com` 301-redirects to `microsoft.com/en-us/microsoft-365`** (observed 2026-09-02) | — | — | Verified (301 observed + founder's own post 2026-04-18 + trade press) | 🟢 on the acquisition 🔴 on the product's mechanics |
| **Rogo** *(new research)* | Platform of "Rogo agents" over LSEG, Dow Jones, FactSet, Capital IQ, PitchBook, Preqin, Daloopa, SEC filings, **Quartr transcripts**, live web/news; **AI Table**, Prompt Library, ~9 named automated workflows (Earnings Comp Analysis, Public Company Strip Profile, Meeting Prep, News Run, Proofread My Deck…); Governance & Permissions; single-tenant deployment; SOC2/ISO 27001 | **Felix** — an email-a-colleague agent ("Shell the deck… Build the model… Draft the memo"), behind **Request Access** | **The weakest published contract of any AI-first vendor here.** The only statement is a feature bullet, **"Transparent, auditable sources"**, plus "auditable Excel models" and "Comprehensive audit trails". **No description of how a citation renders, what it links to, or what happens when the answer is not in the corpus.** Differentiator claimed as *training*: "Custom-trained LLMs built for finance, using professionally labeled data" | ➖ | ➖ | Claimed (marketing pages only); customer names + 50,000 users / 150,000 daily queries / 350+ institutions are **vendor claims** | 🔴 mechanism 🟡 existence |
| **Benzinga Pro** | **Benzinga AI**, Essential-tier gated, "powered by WNSTN" (PR 2025-06-24): NL chat + news summarization | Everything behavioural. The vendor's own help centre contains **ZERO articles** about it across a 119-article inventory | **NOT DETERMINED.** No published statement on citations, refusals, hallucination handling, or what corpus is retrievable. "Preserving transparency and trust" is the only gesture, and it is a slogan | Claimed ("show me a list of 10 stocks giving strong buy signals") | Claimed ("Knows why NVDA dropped after good earnings") | Claimed only | 🔴 |
| **Koyfin** | **Transcript Summaries and nothing else** (v3.69, 2025-09-18; all paid plans, unlimited; transcripts 2015+) | ➖ | **Names no model and describes no citation or link-back.** The summary sits beside the full transcript; that **adjacency is the verification path** | ❌ | ❌ | Verified against the full help taxonomy + release index | 🟢 |
| **SpotGamma** | **NONE — a deliberate abstention.** Nearest thing is the algorithmically-generated Opening Setup (0–100 SG Flow Signal); FlowPatrol and the Founder's Note are written by a named human | ➖ | n/a | ❌ | ❌ | Verified as an absence within the documentation corpus | 🟡 (no seat) |
| **Gödel Terminal** | **No AI feature anywhere** — not in the command reference, not on the pricing page, and **not on its own published "Working on" roadmap** (PORT, MEMB, EQS v2/v3, GF/EQRV, ETFs, private companies, podcasts) | ➖ | n/a | `EQS` is tagged BETA — conventional filters, not NL | ➖ | Verified (official docs + pricing, 2026-09-02) | 🟢 as an absence |

---

## 1. Shipped vs demoed: the line is drawn by the help centre, not the press release

**OBSERVATION.** Across twelve products, one test separated shipped AI from announced AI almost
perfectly: **does the vendor's own support organisation document it?**

- AlphaSense's Generative Search, Deep Research, Smart Summaries and Workflow Agents each have
  help articles with configuration steps. **SuperAnalyst** has a press release, a *"Coming
  Soon"* label, four help articles written ahead of GA, and no customer statistics [D2].
- LSEG publishes an AI Search FAQ (21pp), an AI Explainability Note, release notes **and a
  Known-issues table** — and AI Search is GA [D3].
- Benzinga AI is the product's headline tier differentiator and the help centre contains **zero
  articles about it**, measured against the complete 119-article sitemap [D8].
- Rogo's Felix sits behind "Request Access"; Perplexity's Personal Computer behind a waitlist
  [S1, S3].

**EVIDENCE.** Dossier §I sections [D1–D11] (internal, Wave 1b, all fetched 2026-09-02); Rogo
`rogo.com/felix` [S3]; Perplexity `hub/blog/everything-is-computer`, 2026-03-11 [S1].

**INTERPRETATION.** A support article is expensive and boring, which is exactly why it is
evidence: nobody writes one for a feature that is not carrying real user load. A press release
is cheap. The strongest single discriminator in this survey is not the marketing page, the demo
video or the funding round — it is **whether the people who answer the phone have written the
feature down**.

**RELEVANCE TO UCT.** Bears on how TERMINAL-NEXT's own AI surfaces are judged internally. UCT's
repository history already contains the mirror image of Benzinga's defect — features shipped,
green-tested and connected to nothing, while the documentation asserted they were live. The
external control is now on record: a well-funded competitor shipped its flagship AI ahead of a
single support article, and that gap is the most-cited fact about it.

**CONFIDENCE.** 🟢 for the pattern (it is a property of the artifacts themselves, and I counted
Benzinga's inventory via the dossier's measured sitemap, not an estimate).

**RECOMMENDATION (hypothesis).** *If an AI surface ships without the artifact that says what it
can and cannot do, the first thing members learn about it will be its failure mode.* Shipping
the "what this surface cannot currently do" note **in the same commit as the surface** is the
cheapest credibility available — and LSEG's published Known-issues table is proof that admitting
citation bugs at GA does not sink a product.

**OPEN QUESTION.** Does any vendor in this set publish an accuracy or refusal metric? **None
found.** Every accuracy number located (Fiscal.ai's 91% FinanceBench, "99.5%+", AlphaSense's "no
hallucinations", Quartr's 70%) is either a benchmark self-report or a customer's testimonial.

---

## 2. Grounding and citation: five mechanisms, ranked by what verification costs the reader

**OBSERVATION.** The products do not differ much in *whether* they claim grounding — all of them
do. They differ enormously in **what a sceptical reader has to do to check one claim.** Five
distinct mechanisms are visible, and they form a ladder:

| # | Mechanism | Cost to verify one claim | Who ships it |
|---|---|---|---|
| 1 | **Per-value citation inside a table** — every cell carries its own source | One click, and the unit of doubt is the number | LSEG AI Search [D3] |
| 2 | **Highlight-to-verify** — select any sentence of the answer, ask the system to substantiate *that* | One gesture, user-chosen granularity | AlphaSense [D2] |
| 3 | **Deep link to the exact span** — citation opens the source at the right page/passage/excerpt | One click, but the unit is the passage | Fiscal.ai (source PDF at the exact page), LSEG (highlighted passage), Bloomberg (jump to the transcript excerpt), Quartr ("direct links to the exact pages") [D1, D3, D4, D6] |
| 4 | **Configuration-as-answer** — the model emits an inspectable artefact, not prose | Zero clicks: reading the filters *is* the verification | TradingView AI Screener; UW `option-stance`'s decomposed sub-scores [D7, D9] |
| 5 | **Adjacency** — the summary sits beside the source and that is the whole contract | One glance, but no mapping from claim to passage | Koyfin [D10] |
| — | **None published** | Unbounded | Benzinga AI, Rogo, Mr. Whale [D8, S2, D9] |

Two structural refinements sit on top of the ladder:

- **LSEG's three-tier content policy.** Its own structured data gets per-value inline citations;
  documents get passage highlighting; **licensed third-party research is never summarised at
  all** — verbatim extracts, surfaced as a distinct source, never blended, metered per page
  displayed. The rule exists for contractual reasons and produces an unexpectedly good epistemic
  result: *the content the vendor does not own is never paraphrased by a model* [D3].
- **FactSet states labelling and linking as a UI invariant**, not a per-feature option:
  generative output is "clearly labelled throughout the user interface with linked references"
  [D5]. That is a rendering-layer rule, which is enforceable; a prompt rule is not.

**EVIDENCE.** [D1–D10] dossier §I sections, all fetched 2026-09-02, quotes as recorded there.

**INTERPRETATION.** Rank 4 is the interesting one because it needs no citation machinery at all.
A generated *screen* is falsifiable — a user can read the filters and disagree with one. A
generated *paragraph* is not; it can only be accepted or rejected whole. TradingView reached
that from the screening end and Unusual Whales reached it from the scoring end
(`option-stance`: a computed score, named sub-scores, prose that narrates rather than decides),
and neither cites a single source.

The ladder also exposes a **failure direction**. Quartr — whose entire pitch is "sourced
exclusively from first-party information" — ships an **optional wider-web mode**, and no public
page says how a mixed answer is labelled [D6]. A provenance guarantee with a toggle is a
provenance guarantee that fails silently, because the reader cannot tell from the answer which
mode produced it.

**RELEVANCE TO UCT.** UCT's existing rails (the COT narrative gate that stores nothing when a
number in the prose is absent from the facts; `cotFacts.js` as the only numbers the LLM may cite;
`grade_ticker`'s computed verdict) sit at ranks 1 and 4 already — **UCT's enforcement is stronger
than any vendor's published posture, because it fails closed.** What UCT does not have, on this
evidence, is the *reader-side* half: the gesture that turns a rendered claim back into its
source. AlphaSense's highlight-to-verify and LSEG's per-cell citation are the two ideas in this
survey that UCT has no analogue for.

**CONFIDENCE.** 🟡. The ladder is 🟢 as a description of what the vendors **publish**; it is 🟡
as a description of what renders in-product, and 🔴 for anything below rank 3 — **not one of
these mechanisms was observed running.** Ceiling named in the frontmatter.

**RECOMMENDATION (hypotheses).**
1. *A generated number should carry its own citation, not share one with a paragraph.* LSEG's
   per-cell rule is the highest-value transferable idea in this survey for a wire or a Compass
   answer that renders a table.
2. *Provenance rendering should be a shared component every AI surface must route through, so a
   surface without citations is structurally impossible rather than merely discouraged* — FactSet's
   invariant framing, which is enforceable in a way a prompt is not.
3. **Anti-pattern:** *never ship a mode switch that changes the provenance guarantee without
   changing the rendering.* If TERMINAL-NEXT ever lets an answer draw outside its grounded corpus,
   the label belongs on the sentence, not on the session.
4. **Anti-pattern:** *never ship "no hallucinations" as a product claim.* Two vendors here do
   (AlphaSense's homepage, Quartr's MCP page) and both are contradicted by their own help centres,
   which state the defensible version instead ("it will say so, instead of fabricating") [D2, D6].

**OPEN QUESTION.** Does any of these citation systems cover **computed** values — a screen result,
an attribution number, a derived ratio — or only retrieved documents? FactSet's Portfolio
Analytics MCP language hints at the former; nothing in the set states it [D5]. This matters most
to UCT, whose highest-value numbers (breadth, exposure, flow) are all computed, not retrieved.

---

## 3. "Why is it moving" is the thinnest capability in the entire set

**OBSERVATION.** Given how central the question is to a trading desk, the productised answers are
startlingly sparse:

- **FactSet Security Explanation** — "summarizes transcripts and news to identify key factors
  driving security performance". This is the only named, first-class feature in the survey whose
  stated job is attribution of a price move [D5].
- **Bloomberg** — no named feature. The adjacent machinery is `DS` topic trends and the earnings
  call summary's fixed driver taxonomy (guidance, capital allocation, hiring, macro, new products,
  supply chain, consumer demand) [D4]. Note that this taxonomy is itself a "why" spine.
- **Perplexity Finance** — generated per-day commentary on list and entity pages, including the
  *negative* answer: "no major earnings or corporate announcements driving today's price action"
  [S4, indexed snippet; the live pages render this text client-side].
- **Unusual Whales** — no "why", but the best-shaped *adjacent* artefact: `option-stance`'s
  decomposed `fit_score` with named sub-scores and a narrating explanation [D9].
- **Benzinga** — claims it ("Knows why NVDA dropped after good earnings") with no mechanism
  published anywhere [D8].
- **Koyfin, SpotGamma, Gödel, TradingView, Quartr, Fiscal.ai, AlphaSense, LSEG, Rogo** — nothing.

**EVIDENCE.** [D4, D5, D8, D9] dossier §I; [S4] Google index snippets of `perplexity.ai/finance/lists`
pages, 2026-09-02 (secondary — the snippet is the evidence that the text exists; I could not read
the rendered page logged out).

**INTERPRETATION.** Three readings, and I cannot separate them from public evidence. (a) The
question is genuinely hard to ground — a driver attribution is a causal claim, and no citation
mechanism on the ladder in §2 can substantiate causation, only quotation. (b) It is commercially
unattractive: being wrong about *why* is memorable in a way that being wrong about *what* is not.
(c) It is already served by the news feed and nobody wants to put a model between the trader and
the tape.

The one existence proof that the shape is solvable is **Perplexity's negative answer**. Stating
"nothing is driving this today" is the honest output that a driver-attribution feature must be
able to produce, and it is precisely the output a fluency-optimised model will never volunteer.

**RELEVANCE TO UCT.** This is the single largest **unclaimed** capability in the benchmark set,
and UCT is unusually positioned for it: the catalyst engine already composes a multi-source
thesis per ticker with source signals and a `catalyst_at` timestamp, and the wire already renders
driver narrative. The competitive observation is that **the biggest vendors in the space have not
productised this**, which is either an opportunity or a warning that they tried and stopped.

**CONFIDENCE.** 🟡 overall — 🟢 that the capability is absent from ten of twelve products (an
absence measured across §I sections and command references, not an estimate); 🔴 on FactSet's
Security Explanation actually working, which is a product-page sentence and nothing more.

**RECOMMENDATION (hypothesis).** *A "why is it moving" surface earns trust through its negative
answers, not its positive ones.* A driver panel that can say "nothing specific — this is a beta
move with the sector" on the days that is true is more valuable than one that always finds a
reason; and the deterministic version of that claim (move vs sector/beta, with the residual
named) is checkable, where a narrated cause is not.

**OPEN QUESTION.** Does Bloomberg's ASKB answer "why is X moving" with cited stories, and does it
refuse when the tape has no story behind it? That is the question this survey most wants answered
and cannot reach without a Terminal.

---

## 4. Natural-language screening: the answer is a configuration, not a paragraph

**OBSERVATION.** Only three products ship NL screening, and one of them is the design lesson.

- **TradingView AI Screener** (2026-08-17, public beta, Stock Screener only, paid plans, monthly
  request balance). The user types an idea and receives *a finished screen* — filters, result
  columns and sorting set, view switched to table if needed. Its **Explanation** function shows
  every applied filter with reasoning plus how results are sorted and which columns were added.
  Documented flaw: an AI request **replaces** hand-set filters, with no merge or undo [D7].
- **Fiscal.ai** — AI NL screening in-product plus a `screener` skill on the MCP [D1].
- **Perplexity Finance** — a Screener tab with explicitly published limits: **US and Indian
  equities only, data from the last annual filing, maximum 1000 equities per query** [S2].
- **Benzinga** advertises screen-shaped prompts; no result format is documented anywhere [D8].
- **Gödel's** `EQS` is a conventional BETA filter screener, not NL [D12].

**EVIDENCE.** [D1, D7, D8, D12] dossier §I / capability inventory; [S2] `perplexity.ai/finance/screener`,
read live 2026-09-02 (verified — the limits are printed on the page).

**INTERPRETATION.** TradingView's framing — *"Your idea arrives as a finished screen, not a
to-do list"* — is the whole idea, and the Explanation panel is what makes it safe. The output is
**falsifiable at the level of a single filter**. That is a materially better risk posture than
any prose-with-citations product in this set, and it costs no citation machinery at all.

Perplexity's contribution is the opposite kind of honesty: it **prints its own limits on the
screener**. "Data shown is from last annual filing" is a sentence that will lose a sale and
prevent a wrong trade, and no other product in this survey states its screening data vintage at
the point of use.

**RELEVANCE TO UCT.** UCT's Concierge (English → a scan definition) is already rank-4 architecture
by construction — the artefact it emits is an editable definition, and `CoverageLine`'s four
counts (evaluated · answered · dropped · not computable) are the same instinct as Perplexity's
printed limits: *a short result set must say whether it is a quiet market or a gap in what we
hold.* The gap versus TradingView is the **Explanation** panel — a rendered diff of what the AI
changed and why.

**CONFIDENCE.** 🟡. Nobody ran the AI Screener; the behaviour is TradingView's own description.
Perplexity's screener limits are 🟢 (printed on a live page I read).

**RECOMMENDATION (hypotheses).**
1. *An AI feature that emits an editable configuration and shows its reasoning as a diff to that
   configuration will be trusted faster than one that emits prose, even well-cited prose* —
   because the user can disagree with one filter instead of accepting or rejecting a whole answer.
2. **Anti-pattern:** *never let an AI request overwrite hand-set state.* Stage the AI-built
   configuration **beside** the current one. TradingView's documented destructive default is the
   clearest avoidable mistake in this survey.
3. *Print the data vintage at the point of use*, Perplexity-style, wherever a screen runs on
   anything other than today's data.

**OPEN QUESTION.** What does TradingView's Explanation panel show when the model **misreads** the
prompt — a confident wrong rationale, or an admission of ambiguity? A $12.95/mo seat answers this,
and it is the highest-value cheap follow-up in this file.

---

## 5. The agent-facing turn: MCP servers, skill files, and entitlement inheritance

**OBSERVATION.** Seven of the twelve products now ship a machine-facing surface, and several are
investing there **instead of** in their own chat box.

| Product | Agent surface | Shipped |
|---|---|---|
| Fiscal.ai | **Fiscal MCP**, sold as a **standalone product** since 2026-07-16; Skills catalogue; native connectors for Claude, ChatGPT/Codex, Gemini Enterprise | ✅ [D1] |
| Quartr | **Quartr MCP** in Claude (2026-03-30), Codex (2026-06-02), Perplexity (2026-06-08); included with Pro; **excluded from the free student plan** | ✅ [D6] |
| Unusual Whales | MCP server (2026-03-12) + **published `/skill.md`** + OpenAPI spec + MCP builder prompts (`build_dashboard_app`, `build_confluence_alert`, …) + `get_build_recipe` | ✅ [D9] |
| FactSet | MCP server + Portfolio Analytics MCP; Conversational API since 2024-11-15 | ✅ [D5] |
| Perplexity | Consumes them — Computer calls **40+ live finance tools**; also publishes Search / Agent / Embeddings / Sandbox APIs | ✅ [S1] |
| Bloomberg | ASKB Workflows (in-product agentic), no public MCP found | 🟡 [D4] |
| Gödel | **No public self-serve API**, and the question recurs unanswered in its own community for ~9 months. Its `/pricing` says "Coming soon… join the waitlist" while `/docs` says REST+WebSocket "to enterprise customers on a case-by-case basis" — **two official pages, same day, not saying the same thing** | ❌ [D12] |

Two mechanisms are worth extracting whole:

- **Entitlement inheritance (Fiscal.ai).** *"Your assistant can only retrieve data you could
  retrieve yourself with your API key for the same tickers, periods, and features."* The docs
  further warn that a tool being *visible* in Claude or ChatGPT does not mean the account is
  entitled to it [D1]. FactSet states the same principle from the governance side: entitlements
  enforced per human, **including for agents** [D5].
- **The endpoint whitelist (Unusual Whales).** The published skill file "emphasizes avoiding
  'commonly hallucinated' endpoints through strict adherence to a whitelisted set of verified
  URLs", and mandates the auth headers and GET-only usage [D9]. **The whitelist is the
  load-bearing half** — it exists to stop the agent inventing endpoints, which is the dominant
  failure mode of an LLM against an undocumented API.

**EVIDENCE.** [D1, D4, D5, D6, D9, D12] dossier §I / capability inventories; [S1] Perplexity blog
2026-03-11 (verified quote: "over 40 live finance tools pulling directly from SEC filings,
FactSet, Coinbase, Quartr, and other authoritative sources. No setup, no license, no API key").

**INTERPRETATION.** Fiscal.ai's trajectory is the clearest strategic statement in the survey: it
built a conversational Copilot, stopped mentioning it after January 2025, and now sells an MCP.
The implied conclusion is that **the interface for AI research will be owned by the model
vendors, and the defensible position is being the tool those agents call.** Unusual Whales made
the same bet from a retail base; Quartr made it while keeping its own chat.

The counter-observation is Perplexity: it is the **consumer** side of that trade, and its
provider footer is a roll-call of this very benchmark set — Financial Modeling Prep, **Unusual
Whales**, **Quartr**, **Fiscal.ai**, S&P Global, Polymarket, **TradingView** [S2]. Four products
in this survey are simultaneously competitors to each other and suppliers to a fifth.

**RELEVANCE TO UCT.** UCT already has the hard half: one tool facade shared by voice and text
chat, so the two surfaces cannot diverge. An external-agent surface would be a **third consumer
of that same facade** — and the transferable rule is that it must reuse the *same* entitlement
object the web session uses. An agent path with its own authorisation logic would be a second
authority over "what may this member see", which is a defect class UCT has paid for repeatedly.
Note also that UCT is on the *supply* side of Perplexity's diagram in one respect already: its
own AI stack consumes Perplexity for catalyst enrichment.

**CONFIDENCE.** 🟢 on the existence and dates of these agent surfaces (developer docs and dated
changelogs); 🟡 on the strategic reading; 🔴 on whether any of them is used at volume.

**RECOMMENDATION (hypotheses).**
1. *If UCT ever exposes its brain to external agents, the entitlement check must be the same
   object the web session uses* — not a parallel implementation.
2. *A published endpoint whitelist plus a skill file is a cheap, high-leverage way to make a data
   product agent-addressable, and the whitelist is the load-bearing half.* It would serve the
   desk's own tooling before it served a single member.
3. **Anti-pattern (Gödel):** *two official pages describing the same API differently, on the same
   day, is the second-authority defect at documentation scale* — and the public evidence is that
   it went unresolved for ~9 months while users kept asking.

**OPEN QUESTION.** Do any of these MCP servers meter or bill differently from the web product,
and does an agent's call count against the same fair-use ceiling as the human's? Only Quartr
("included with Pro at no extra cost") and Unusual Whales (tier-metered 1×/2×/3×) say anything.

---

## 6. Perplexity Finance — the aggregator that assembled the benchmark set *(new research)*

**OBSERVATION.** Perplexity Finance is no longer a stock-quote page; it is positioned as
**"Computer for Finance"**, described by Perplexity as *"the data and analysis layer underneath
Computer, Deep Research, and Search, plus a dedicated dashboard for following real-time markets
and news"* [S1, 2026-03-11].

- **Dashboard surfaces** (read live, logged out, 2026-09-02): US Markets · Crypto · Earnings ·
  Predictions · Screener · Politicians · Watchlist · Portfolio · Workflows · App Gallery [S2].
- **Entity pages** carry Symbol / IPO date / CEO / employees / sector / industry / country /
  exchange, **Analyst Consensus**, **Related Prediction Markets**, and Peers [S2]. A prediction-market
  module on a company page is a pattern found nowhere else in this survey.
- **Screener limits, printed on the page:** *"Results limited to US and Indian equities. Data
  shown is from last annual filing. Maximum of 1000 equities returned per query."* [S2]
- **Tooling claim:** *"Computer now has access to over 40 live finance tools pulling directly from
  SEC filings, FactSet, Coinbase, Quartr, and other authoritative sources… Every figure is fully
  traceable back to its original source."* [S1]
- **Premium Sources** (Statista, CB Insights, PitchBook) are *"cited in research queries and can
  link to the right source, automatically"* [S1].
- **Brokerage connection via Plaid** for portfolio analytics on real holdings; Polymarket
  prediction data throughout [S1, S2].
- **Personal Computer** (a dedicated Mac mini running 24/7) is **waitlist-only**; its safety
  posture is stated as *"Sensitive actions require approval, and every session includes a full
  audit trail. A kill switch gives users immediate control."* [S1]
- A vendor self-study claims Computer *"saved our internal teams $1.6M in labor costs and
  performed 3.25 years of work in only four weeks"* over 16,000 queries [S1] — **claimed**, and
  the measurement is of Perplexity's own staff.

**⚠️ A drift worth recording.** The blog names **FactSet** among the sources behind Computer's
finance tools [S1]; the live dashboard's own attribution footer names **Financial Modeling Prep,
Unusual Whales, Quartr, Fiscal.ai, S&P Global, Polymarket and TradingView** — and not FactSet
[S2]. The two lists have different scopes (agent tools vs dashboard data), so this is a
**nuance, not a contradiction** — but a reader cannot tell which providers stand behind a given
number from either page alone.

**EVIDENCE.** [S1] `perplexity.ai/hub/blog/everything-is-computer`, official blog dated 2026-03-11,
read via browser 2026-09-02 — **verified** as Perplexity's own statement. [S2]
`perplexity.ai/finance`, `/finance/screener`, `/finance/workflows`, `/finance/NVDA`, read via
browser 2026-09-02 — **verified** (nav, footer, screener limits, entity-page modules). WebFetch
returned HTTP 403 on all `perplexity.ai` paths; the browser channel was required.

**INTERPRETATION.** Two things matter here more than the feature list.

First, **the attribution footer is a map of the market.** Four products with their own Wave 1b
dossiers — Unusual Whales, Quartr, Fiscal.ai, TradingView — appear as *suppliers* to Perplexity.
The AI-native layer is not competing with the data layer; it is **renting** it. That reframes
"who is the competitor" for any product whose moat is proprietary data.

Second, **Perplexity ships the honest-limits sentence that the specialists do not.** A screener
that prints "data shown is from last annual filing" is telling the user the one thing most likely
to make its answer wrong. That is the same instinct as LSEG's Known-issues table and the opposite
of Benzinga's silence.

**RELEVANCE TO UCT.** Bears on `/ai-search` and on any "ask the terminal" surface. The
directly-comparable pattern is the printed-limit sentence, which UCT already has one instance of
(`CoverageLine`'s "that is a gap in what we hold, not a quiet market") and could generalise. The
strategic note is less comfortable: a general-purpose assistant with rented data now covers
watchlist, portfolio, screening, earnings and prediction markets for free, so **a paid terminal's
defensibility has to be the proprietary rails and the coaching, not the surface area.**

**CONFIDENCE.** 🟢 for the dashboard surfaces, entity modules, provider footer and screener limits
(read directly off live pages). 🟡 for the "40+ tools" and traceability claim (official blog, not
demonstrated). 🔴 for the productivity study. **Ceiling:** logged out, so Workflows, App Gallery,
Portfolio and any actual generated answer were not reachable; a free account would open most of it.

**RECOMMENDATION (hypothesis).** *Where a surface runs on data with a vintage or a coverage
boundary, print the boundary on the surface.* Perplexity does this on the one screen where it
matters most, and it costs a sentence.

**OPEN QUESTION.** Does a Perplexity Finance answer render per-figure citations back to FMP /
Quartr / Fiscal.ai, or only a general source list? "Every figure is fully traceable" is the claim;
one logged-in query would settle whether it is rank 1 or rank 5 on the §2 ladder.

---

## 7. Fintool — the AI-native equity-research product that became a feature *(new research)*

**OBSERVATION.** Fintool no longer exists as a standalone product. **`fintool.com` returns HTTP
301 to `microsoft.com/en-us/microsoft-365`** (observed directly, 2026-09-02) [S5]. Its CEO and
co-founder Nicolas Bustamante announced on **2026-04-18** that **Microsoft acquired Fintool**,
writing that the team would take its *"expertise and IP"* into Microsoft 365 and Office for
financial services [S6]. Corroborated by trade press the same day and after [S7].

What it had been: an AI equity-research copilot for institutional investors over SEC filings and
earnings calls; **V5 (January 2026) was "a fully agentic experience"** in which an agent worked
autonomously to *"build a DCF model in Excel, an earnings deck in PowerPoint, or a research memo
in Word"*, serving *"thousands of professional investors across hedge funds, asset management,
and investment banking"* [S6, founder's account — **claimed** as to scale].

**EVIDENCE.** [S5] direct observation of the 301 redirect via WebFetch, 2026-09-02 — **verified**.
[S6] `nicolasbustamante.com/blog/microsoft-has-acquired-fintool`, the founder's own post, dated
2026-04-18 — **verified** as his statement, **claimed** as to customer scale. [S7] Neowin
(2026-04-18), Pulse 2.0 (2026-04-21) — **reported**; a low-tier aggregator dates the deal to March
2026, which contradicts the founder and the trade press and is **not used**.

**INTERPRETATION.** The V5 output list — Excel model, PowerPoint deck, Word memo — is the
acquisition thesis stated in advance. Fintool's agent was already producing Office artifacts, so
the shortest path to distribution was to *be* Office. Read alongside §5, this is the same
conclusion Fiscal.ai reached by a different route: **the standalone AI research interface is not
where the value settles.** Fiscal.ai chose to be the tool an agent calls; Fintool chose to be
inside the suite the analyst already has open. Neither kept the chat box.

The **Rogo** contrast (§8) is the third branch: stay standalone, but sell to the institution
rather than the analyst, and make governance the product.

**RELEVANCE TO UCT.** A caution against reading any of these products as a stable benchmark. Two
of the AI-native names on this contract's own list (Fintool; arguably Fiscal.ai's Copilot) no
longer exist in the form the contract describes, within roughly a year. It also bears on
TERMINAL-NEXT's positioning: UCT's members do not live in Office or in Perplexity — they live in
the Discord and the dashboard — which is a distribution asset the acquired product did not have.

**CONFIDENCE.** 🟢 that Fintool was acquired and is gone as a standalone (a redirect I observed
plus the founder's own dated post plus trade press). 🔴 on its grounding and citation mechanics,
which are now unrecoverable from public sources — the product pages are gone.

**RECOMMENDATION (hypothesis).** *An AI research product whose output is a document is competing
with the document editor, and the document editor has the distribution.* Where TERMINAL-NEXT's AI
produces artifacts, the durable ones are the artifacts only UCT can produce — a scan definition
against UCT's rails, a verdict against the book, a wire segment — not a generic memo.

**OPEN QUESTION.** Did any Fintool grounding documentation survive (docs subdomain, Wayback, YC
materials)? It was one of the few products in this class built explicitly on SEC filings, and its
citation design would have been the most directly transferable in the survey.

---

## 8. Rogo — enterprise agents with the weakest published grounding contract *(new research)*

**OBSERVATION.** Rogo (`rogo.com`, formerly `rogo.ai`) sells AI agents to financial institutions
that *"understand financial workflows and execute end-to-end work across deals and investments"*,
producing *"auditable Excel models, investment memos, diligence materials, and slide decks"* [S8].

- **Data sources named:** LSEG, Dow Jones, FactSet, Capital IQ, PitchBook, Preqin, Daloopa, SEC
  filings, international filings, real-time web & news, and **transcripts via Quartr** [S9].
- **Product surfaces:** AI Table interface, Prompt Library, Custom-Trained Models, firm-specific
  workflows, proprietary document interrogation, integrations, **Governance & Permissions**,
  single-tenant deployment [S9].
- **Named automated workflows:** Earnings Comp Analysis, Public Company Strip Profile, Meeting
  Prep, Private Company Profile, Personal Bio, Financial Sponsor Overview, News Run, Secondaries
  Buyer Overview, Proofread My Deck [S9].
- **Felix** — an agent you *email* like a colleague ("Shell the deck… Build the model… Draft the
  memo") — is behind **Request Access**, i.e. not generally available [S3].
- **Scale and customers, all vendor-claimed:** 50,000+ bankers and investors, 150,000+ daily
  queries, 350+ institutions; named testimonials from Truist Securities, Nomura and Baird [S8].
- **Compliance posture:** SOC 2, ISO 27001, GDPR, CCPA; "No training on your data"; "End to end
  encryption"; "Comprehensive audit trails" [S9].

**The gap.** Across the homepage, the product page and the Felix page, the **entire published
grounding contract is one feature bullet — "Transparent, auditable sources"**. There is no
statement of how a citation renders, what it links to, whether a figure traces to a page, or what
happens when the answer is not in the corpus [S3, S8, S9]. The differentiator is instead framed as
*training*: *"Custom-trained LLMs built for finance, using professionally labeled data tailored to
the workflows and precision standards of investment banking"* [S9].

**EVIDENCE.** [S8] `rogo.com`, [S9] `rogo.com/product`, [S3] `rogo.com/felix` — all official
marketing pages, fetched 2026-09-02, **claimed**. `rogo.ai` 301s to `rogo.com` (observed).

**INTERPRETATION.** Rogo and FactSet sell to the same buyer — a risk committee — and reach it
differently. FactSet's AI copy reads as a compliance document: RAG, in-context source linking as a
UI invariant, private LLM instances, entitlements enforced per human including for agents, 24-month
log retention [D5]. Rogo's reads as a productivity pitch with a security appendix. **"Auditable"
appears as an adjective on the output and on the log, never on the sentence.** For a product whose
deliverable is an investment memo, that is the load-bearing missing detail.

The word "trained" is doing the same unverifiable work it does in Benzinga's copy [D8]: a
retrieval-grounded system over the same source list would produce every advertised behaviour
without any training, and no public evidence distinguishes the two.

**RELEVANCE TO UCT.** Rogo is the control case for §2's thesis. It is the best-funded, most
enterprise-credentialed AI-first product in this survey, and it publishes **less** about grounding
than Koyfin does about a transcript summary. If a buyer that sophisticated is not demanding a
published mechanism, then the mechanism is not yet a purchase criterion — which means UCT's
grounding gates are, for now, an internal correctness asset rather than a marketing one.

**CONFIDENCE.** 🟡 that Rogo exists at the scale claimed and ships the named workflows (official
pages, named customers, but every number is self-reported). 🔴 on grounding, citation, refusal and
hallucination behaviour — **nothing is published**. **Ceiling:** enterprise sales gate; only a
demo or a customer interview would raise it, and the owner cannot supply either.

**RECOMMENDATION (hypothesis).** *"Auditable" applied to an output is not a grounding claim; it is
a records-retention claim.* Where TERMINAL-NEXT describes its own AI, the distinction worth
holding is between **traceability of the sentence** and **retention of the session** — Rogo
publishes the second and calls it the first.

**OPEN QUESTION.** Does Rogo's output carry inline citations into LSEG / Capital IQ / Quartr
content — and if so, how does it satisfy the licensing constraint that LSEG solves by refusing to
summarise third-party research at all [D3]?

---

## 9. Abstention is a strategy, and three products are running it

**OBSERVATION.** Three products in the set ship essentially no generative AI, and each abstains
for a different, legible reason.

- **SpotGamma** — none at all. A full-text help-centre search for AI / machine learning /
  assistant / chatbot returns nothing. Interpretation is scaled instead by a **deterministic**
  Opening Setup report (0–100 SG Flow Signal) and by a **named human** writing twice daily [D11].
- **Koyfin** — exactly one AI feature, **Transcript Summaries**, aimed at the single place where
  an LLM is low-risk and high-value: compressing a long document whose source sits adjacent. Its
  homepage and pricing page carry *"Let AI tell you about Koyfin"* buttons that are **outbound
  links to third-party chatbots, not a product capability** [D10].
- **Gödel Terminal** — no AI anywhere, and — the stronger fact — **no AI item on its own published
  "Working on" roadmap** [D12].

**EVIDENCE.** [D10, D11, D12] dossier §I / capability inventories, 2026-09-02 — each **verified as
an absence within the documentation corpus**, which is a weaker claim than absence in the product.

**INTERPRETATION.** Koyfin's restraint is probably **forced**: its fundamentals are licensed from
S&P Capital IQ under terms strict enough to forbid an API, and feeding that data to a model and
reselling the output is a licensing conversation, not an engineering one — transcripts are the
corner of its corpus where the rights are cleanest [D10, dossier's inference]. SpotGamma's is a
**risk position**: in positioning analytics a fabricated level is indistinguishable from a real
one until the trade loses money [D11]. Gödel's is **stage**: a small team at $996/seat is buying
breadth of function first.

Together they are the counter-evidence to "everyone is shipping AI". Three viable products in
this benchmark set are not, and one of them (Koyfin) is the closest prosumer competitor to a
research terminal.

**RELEVANCE TO UCT.** Two consequences. (a) UCT's data is largely **its own**, so the licensing
wall that caps Koyfin does not apply — that competitive gap is currently unclaimed. (b)
SpotGamma's abstention is the strongest public argument that in positioning analytics **the
binding constraint is groundedness, not fluency** — a competitor can win the niche with zero AI.

**CONFIDENCE.** 🟡. Absence is established within documentation and public marketing only; an
unannounced in-app feature would not appear there. A subscriber could confirm SpotGamma in thirty
seconds.

**RECOMMENDATION (hypothesis).** *The highest-trust placement for an LLM in a financial product is
summarising a document whose source is on screen beside the summary* — Koyfin's one bet. Wherever
TERMINAL-NEXT puts a generated claim **without** the source adjacent, it is taking on a materially
larger trust burden, and the grounding gate should be the default rather than the exception.

---

## 10. Anti-patterns collected from the set

Each is a hypothesis phrased as a thing to avoid, with the benchmark that produced it.

1. **"No hallucinations" as a product claim** — AlphaSense's homepage and Quartr's MCP page both
   say it; both vendors' help centres state the weaker, defensible version instead. It is
   unfalsifiable, and the first counterexample a user finds costs more trust than the claim bought
   [D2, D6].
2. **A provenance mode switch with no rendering change** — Quartr's optional wider-web mode
   silently changes the guarantee the whole product is sold on, and no page says how a mixed
   answer is labelled [D6].
3. **A destructive AI default over hand-set state** — TradingView's AI Screener replaces manually
   set filters with no documented merge or undo [D7].
4. **Shipping an AI feature ahead of its own support documentation** — Benzinga AI is the tier
   differentiator and has zero help-centre articles out of 119 [D8].
5. **Two official pages describing one capability differently on the same day** — Gödel on its API
   ("Coming soon / waitlist" vs "REST and WebSocket… case-by-case"), and LSEG on its own model
   stack (GPT-5 + Claude Opus 4.6 in the FAQ; GPT-4 + ADA2 **plus an opt-in Bing fallback** in the
   Explainability Note). LSEG has one of the best grounding contracts in the industry and *still*
   ships two live descriptions of its model stack that disagree [D3, D12].
6. **A hand-typed count beside the list it describes** — Fiscal.ai's launch post says **22**
   skills, its developer docs say **28**; both official, both current [D1]. Recorded because it is
   the same defect class UCT keeps paying for, and it is evidently universal.
7. **"Auditable" used of an output or a log when the reader needs it of a sentence** — Rogo [S8, S9].
8. **A refusal posture that resolves into hedging** — FactSet's copy hedges hard ("may contain
   inaccuracies…"), and LSEG's worked example refuses to answer "Should I buy Tesla?" at all. Both
   are correct for a vendor serving strangers. UCT's `grade_ticker` deliberately does the opposite
   — decisiveness made structural rather than prompted — because it serves a coached membership.
   **This tension deserves an explicit program decision for TERMINAL-NEXT, not a drift** [D3, D5].

---

## GAPS

- **No seat on any product.** Nothing in this survey was observed running. Every citation
  mechanism in §2 is a vendor's description. This is the governing ceiling and it caps the whole
  file at 🟡.
- **Search channel.** `WebSearch` was pre-exhausted for the session (200/200) per the preamble, so
  external research used: WebFetch on known URLs (Rogo ×3, Fintool ×2, the founder's blog, Bing
  ×2) and **one browser tab** for `perplexity.ai` (which 403s to WebFetch on every path) plus two
  Google queries. **The tab was closed.** Bing returned unusable results for the Perplexity
  Finance query (ten Zhihu pages) — that query was re-run through the browser instead.
- **Perplexity, logged out.** Workflows, App Gallery, Portfolio, and any generated answer were not
  reachable. Entity pages rendered their skeleton (module names) but not their values, so the
  "why is it moving" commentary in §3 rests on Google's index snippets rather than a page I read.
  **A free account would close most of this and is the cheapest single follow-up in the file.**
- **Fintool's mechanics are unrecoverable.** Product pages are gone behind the Microsoft redirect;
  Wayback was not attempted within budget.
- **Rogo's grounding is unpublished, not merely unfound.** Three official pages were read and none
  addresses it. Only a demo or a customer would resolve it.
- **Bloomberg ASKB** remains the biggest single blind spot: it is the most consequential AI product
  in the set and everything known about it is a product-page sentence plus one trade-press article
  [D4].
- **Not attempted within budget:** official YouTube/demo transcripts for any product (the preamble
  permits transcripts; none was pulled); AlphaSense's four SuperAnalyst help articles; LSEG's AI
  Search release-note history beyond the GA Known-issues table; any pricing/metering detail on AI
  request quotas (TradingView's "monthly balance" number is stated to exist and never published).
- **Not re-derived, by contract:** everything in the twelve dossier §I sections. Where this file
  and a dossier disagree, the dossier is the source of record.
- **No internal UCT file was read.** This role's contract names none, so all "RELEVANCE TO UCT"
  statements are carried from the dossiers' own relevance sections, which cite UCT specifics.

**Prompt-injection / instruction-shaped content observed.** One item, recorded not acted on: the
LSEG AI Search FAQ closes with a user agreement asking users to *"Use AI Search responsibly and
avoid prompt injections"* and forbidding hidden instructions, with account suspension as the
penalty [D3]. It is addressed to Workspace's users, not to an agent, and nothing in it was
followed. It is logged because **a published acceptable-use clause on prompt injection is itself a
product decision** TERMINAL-NEXT may want to copy. Nothing else read for this file — including
Rogo's, Perplexity's and Fintool's pages — contained text addressed to an AI agent or attempting
to redirect this task.

---

## SOURCES

### Internal — Wave 1b dossiers (cited, not re-derived; all sections fetched/authored 2026-09-02)

- **[D1]** `03-competitive-research/finchat/dossier.md` §I — Fiscal.ai (ex-FinChat): three AI
  generations, MCP + Skills, entitlement inheritance, the 22-vs-28 skill-count drift.
- **[D2]** `03-competitive-research/alphasense/dossier.md` §I — Generative Search, Deep Research,
  Smart Summaries, Workflow Agents, SuperAnalyst "Coming Soon", highlight-to-verify.
- **[D3]** `03-competitive-research/lseg-workspace/dossier.md` §I.1–I.4 — AI Search GA 2026-06-23,
  per-value table citations, three-tier content policy, model-vintage discrepancy, Known issues,
  privacy posture, prompt-injection clause.
- **[D4]** `03-competitive-research/bloomberg/03-news-alerts.md` §11 + `04-earnings-estimates.md`
  §8 — AI News Summaries, ASKB beta, AI-Powered Earnings Call Summaries (2024-01-22), `DS`.
- **[D5]** `03-competitive-research/factset/dossier.md` §I — FactSet Intelligence three layers,
  Mercury, Security Explanation, MCP servers, in-context source linking as a UI invariant.
- **[D6]** `03-competitive-research/quartr/dossier.md` §I — AI chat with per-query model choice,
  summaries, Chapters, Automations, Quartr MCP, the optional wider-web mode.
- **[D7]** `03-competitive-research/tradingview/dossier.md` §I — AI Screener (2026-08-17),
  Explanation function, destructive filter replacement, metering.
- **[D8]** `03-competitive-research/benzinga-pro/dossier.md` §I — Benzinga AI, WNSTN partnership
  PR (2025-06-24), the zero-help-articles measurement.
- **[D9]** `03-competitive-research/unusual-whales/dossier.md` §I — Mr. Whale, MCP + `/skill.md` +
  endpoint whitelist, `option-stance`'s decomposed score.
- **[D10]** `03-competitive-research/koyfin/dossier.md` §I — Transcript Summaries (v3.69,
  2025-09-18) as the only AI feature; the outbound "Ask ChatGPT/Claude/Gemini" buttons.
- **[D11]** `03-competitive-research/spotgamma/dossier.md` §I — verified absence of AI.
- **[D12]** `03-competitive-research/godel/01-evidence.md` §3 — capability inventory, "Working on"
  roadmap with no AI item, the `/pricing` vs `/docs` API contradiction.

### External (all fetched 2026-09-02)

- **[S1]** `https://www.perplexity.ai/hub/blog/everything-is-computer` — official Perplexity blog,
  dated 2026-03-11. Tier: official product blog. **Verified** as Perplexity's statement; the
  $1.6M / 3.25-years productivity figure is **claimed** (internal study). Read via browser
  (WebFetch 403s on this host).
- **[S2]** `https://www.perplexity.ai/finance`, `/finance/screener`, `/finance/workflows`,
  `/finance/NVDA` — official live product. Tier: official product page. **Verified** (navigation,
  entity-page modules, screener limits, data-provider attribution footer). Read via browser, logged
  out; values render client-side and were not visible.
- **[S3]** `https://rogo.com/felix` — official product page. Tier 3. **Claimed**. Felix's
  capabilities and its Request-Access gate.
- **[S4]** Google index snippets for `site:perplexity.ai /finance/lists` pages. Tier: secondary
  (search-engine index). **Reported** — used only as evidence that generated daily commentary text
  exists on those pages, not for its content.
- **[S5]** `https://fintool.com` and `https://www.fintool.com` — both return **HTTP 301 to
  `https://www.microsoft.com/en-us/microsoft-365`**. Tier: direct observation. **Verified**.
- **[S6]** `https://nicolasbustamante.com/blog/microsoft-has-acquired-fintool` — the CEO and
  co-founder's own post, dated **2026-04-18**. Tier: primary founder statement. **Verified** as his
  announcement; **claimed** as to customer scale and V5 capability.
- **[S7]** Neowin, *Microsoft acquires Fintool to supercharge Excel with…*, 2026-04-18; Pulse 2.0,
  2026-04-21. Tier: trade press. **Reported** — corroborate date and acquisition. A low-tier
  aggregator dating the deal to March 2026 was **excluded** as contradicted by both.
- **[S8]** `https://rogo.com/` (301 from `rogo.ai`) — official homepage. Tier 3. **Claimed** —
  agent framing, named customers (Truist Securities, Nomura, Baird), 50,000+ users / 150,000+ daily
  queries / 350+ institutions.
- **[S9]** `https://rogo.com/product` — official product page. Tier 3. **Claimed** — data-provider
  list, named workflows, "Transparent, auditable sources", custom-trained-LLM claim, compliance
  certifications.
- **[S10]** `https://www.bing.com/search?q="Fintool"+AI+equity+research+SEC+filings+citations` and
  `google.com/search?q=Microsoft+acquires+Fintool…` — Tier: secondary aggregators, used **only** to
  locate primary sources; every claim above is attributed to the primary it pointed to.

**Excluded as evidence** per the preamble's ban on SEO/AI-generated comparison content: aggregator
"tool directory" pages and AI-written summary posts encountered while locating [S6] and [S7]; their
factual claims were directionally consistent with the primaries but are not cited.
