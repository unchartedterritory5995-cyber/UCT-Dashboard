---
role: Research-to-Execution Readiness Review
date: 2026-09-02
requested_by: owner
scope: Full terminal-research corpus, Day 1 close
status: FINAL — presented to owner, awaiting decision
---

# Research-to-Execution Readiness Review — Day 1 Checkpoint

This is a formal checkpoint, not a research artifact in the wave sense. It answers one question:
has the work completed so far given the program enough validated information to move from
discovery/research into architecture, product specification, technical discovery, and eventually
implementation planning?

Method: Part 1 was verified directly against source-of-truth files (git, workflow journals,
program-control files) by the orchestrator. Parts 2–5 were produced by two independent forked
agents reading the full corpus fresh (not from conversation memory), each cross-checked against
the actual files before being incorporated here. Parts 6–11 are the orchestrator's own synthesis
and judgment, informed by Parts 1–5, the D-01–D-14 existing-system archaeology, and the CLAUDE.md
system context already available this session.

---

## 1. Repository / Workflow Integrity

**Committed state:** clean. `git status --short` shows exactly one untracked file:
`05-product-strategy/domain-events-intelligence.md`, a 635-byte frontmatter-only stub from the
C2-02 (events intelligence) task, explicitly discarded per its own contract note and tracked
forward as RG-30 — not a completed artifact and never intended to be committed.

**Application code:** untouched. `git diff --stat 9c3df14b9 -- . ':(exclude)docs/terminal-research'`
is empty. Every commit since Step Zero has touched only `docs/terminal-research/`.

**Push state:** fully synced — `git log origin/terminal-research..HEAD` is empty.

**Completed recovery/research workflows (this session), verified via each workflow's own
journal.jsonl, not self-report:**

| Workflow | Purpose | Agents | Result |
|---|---|---|---|
| `wf_ff0deab0-60a` | Six-task Wave-2 recovery + Day 1 synthesis | 7/7 done, 0 errors | All 7 accepted (5 clean, 1 — Bloomberg — needed a deepening pass, 1 — the synthesis — needed a fact-check + 2 corrections) |
| `wf_d43f291c-8c8` | Bloomberg multi-asset deepening + adversarial verify | 2/2 done, 0 errors | Accepted — 33/36 owner-named topics covered, 3 honest ceilings, zero fabrication, zero regression |
| `wf_8e632cf1-60d` | Day 1 synthesis fact-check | 1/1 done, 0 errors | Accepted — high reliability, 2 genuine drifts found and corrected in place |

**Active agents/workflows:** none. No background tasks are running as of this review.

**Placeholders/stubs/unresolved recovery state:** one — `domain-events-intelligence.md` (C2-02),
635 bytes, discarded, RG-30. No other stub, partial contract, or unresolved recovery item exists;
`MASTER_CHECKLIST.md` and `RESEARCH_GAPS.md` were both stale relative to this session's work (still
describing Bloomberg/Gödel as incomplete and RG-28 as fully open) and have been corrected and
committed as part of this review.

**F-09 / Provider Master Ledger — what exists vs. what the queued wave adds** (full reasoning in
Part 3): `provider-ledger.md` (F-03b, 48 rows, accepted) already gives, per provider: an evidence
tier (KEY-PRESENT → CONTRACT-ACTIVE), the data classes served, call sites to file:line, a
core/retirement/dormant verdict, a licensing class, and an explicit list of data classes with NO
provider at all. F-09's contract (`contracts/F-09.md`, written, not dispatched) would re-slice
this same evidence by **capability/asset-class** (17 categories) instead of by provider, apply the
owner's specific **A–G status taxonomy** uniformly, and separate technical access from contractual
rights at the **per-capability** level rather than per-provider. This is real, useful additional
granularity — it is not a re-discovery of anything, and it is not required to start architecture
work (see Part 3's explicit BLOCKING-vs-ARCHITECTURE-BOUND determination).

---

## 2. Executive Synthesis Quality Audit

**Verdict: genuine integration, not concatenation.** An independent fresh read of the full,
current `DAY_1_EXECUTIVE_SYNTHESIS.md` (1,301 lines, post-correction) found synthesis-only claims
that no single input states — e.g., §1 pairs D-13's proprietary-asset findings against C6-02's AI
grounding findings into a claim neither source makes alone ("the desk's proprietary numbers are the
ones its AI cannot cite"), and §12's architecture implications are built on that pairing, not
restated from either source. §11 actively reconciles four separately-evidenced product-thesis
candidates against each other and against a named tension elsewhere in the document, rather than
listing them. §4.1b (the post-hoc Bloomberg multi-asset integration, added during this review's
preparation) applies UCT's own build-vs-buy framing to new evidence and cross-references the
document's own anti-pattern framework, rather than appending a disconnected fact. §13 independently
resolves 12 named cross-artifact contradictions in Position A / Position B / Reconciliation form.

Where the document is more list-shaped (§2 "known with high confidence," §6 existing-system
findings), that is appropriate to their inventory function, not a defect.

**The two QC corrections read cleanly.** Both are inline, dated, clearly labeled, and a full-text
grep confirmed no dangling reference to either fabricated claim survives elsewhere in the document.

**One genuine gap found, not previously flagged:** `OPEN_QUESTIONS.md`'s OQ-14 — the Discord bot's
`get_catalyst_calendar_context` is a second, unreconciled authority on earnings report dates,
alongside `/api/calendar`. This is an instance of exactly the defect class the synthesis already
discusses at the pattern level (§6.6, "the estate's most expensive defect class"), but this specific
instance isn't individually cited in §13's contradiction list. Minor, worth a one-line addition on
the next revision — not a quality failure and not worth a re-dispatch on its own.

No other unflagged contradiction of comparable weight was found after cross-reading the dossiers,
internal-system files, and licensing/cost artifacts against the synthesis's claims.

---

## 3. Research Completeness Classification

Every row of `RESEARCH_GAPS.md` (RG-01–30), `CRITICAL_PATH.md` (CP-01–12), and `OPEN_QUESTIONS.md`
(OQ-01–16) was reviewed. Items with no material architectural weight are omitted below rather than
padded in.

### A. BLOCKING — none found

This is itself the headline finding. The closest candidate, CP-03 (licensing), does not qualify:
D-001 (desk-first) is a standing decision that "lets Day 2 proceed at all" regardless of how the 81
Restricted licensing rows eventually resolve — a desk-scoped terminal is real, buildable
architecture independent of the member-facing licensing question. Nothing else in the corpus
(capacity envelope, workspace decision, unobserved desk workflow) blocks the *activity* of
architecting, even though each bounds a specific decision within it.

### B. ARCHITECTURE-BOUND

| Item | Why B, not A | What it bounds | Locks before |
|---|---|---|---|
| OI-03(a)/(b) — Massive tier, FMP DDLA | Provider-abstraction and desk-scoped data architecture can proceed now | The member-facing data-display decision (D-002); 57 licensing rows move on these facts | ARCH-06, the member-facing branch of ARCH-04 |
| F-09 Provider Master Ledger | F-03b already sufficient to start (see Part 1) | The provider-abstraction layer's per-capability licensing columns; the 7 retirement/consolidation decisions | Those specific decisions, not architecture generally |
| CP-06 capacity envelope (D-05) | §12.2 already sketches streaming/caching architecture on labeled assumptions | ARCH-07's actual numbers | ARCH-07 finalization |
| OI-06 — observed desk morning | §12.1 already proposes provisional workspace/IA direction | The command-grammar default (noun-first vs verb-first) and the workspace fixed/modular/hybrid lock | IA spec finalization, C5-03 |
| `charts_workspace_layout` telemetry query | Provisional workspace architecture can start from the two-layer reframing already in §12.1 | C5-03's final lock | C5-03 |
| Decisiveness-for-two-audiences (§13.4) | Doesn't block AI-architecture design | Whether the provenance component renders one verdict-shape or two | The GOVERNING_PRINCIPLES revision the synthesis itself recommends |
| Four telemetry queries (page_views, calendar_seen, alerts_fired, ai_search_log) | Cost models already ship as labeled assumptions | The commercial/pricing architecture and final merged cost model | Cost-model finalization |

### C. IMPLEMENTATION-BOUND

Adjustment-scope drift check (C7-02, one-symbol comparison); the dockview/FlexLayout popout spike
(RG-27, an afternoon, only if C5-03 makes it decision-relevant); the unauthenticated `/api/*` route
sweep (A-06 — the *pattern*, server-side auth on every endpoint, is already an architecture decision;
the sweep just enumerates which existing routes need the fix); `sec_filings.py` polling cadence;
`IMPLIED_ENRICHMENT_CUTOVER` flag state.

### D. VALIDATION / ENRICHMENT

**OI-08** (Bloomberg access) and **OI-18** (Gödel trial) both land here, not higher: every
transferable idea the synthesis actually carries forward is corroborated by 3+ independently
witnessed vendors, never solely dependent on Bloomberg or Gödel alone. Neither closes a gap the
current product direction rests on. Also here: OPRA/AI-Console telemetry (sharpens E-06's cost
model from assumption to measurement, not required to design the AI architecture); additional
benchmark seats beyond what's already used.

### E. OPTIONAL / DEFERABLE

FRED arm-or-retire housekeeping; Discord bot's operational status (a different product); SpotGamma's
proprietary methodology (already closed as unknowable by design); the 25-vs-30 base-structure-count
documentation drift.

---

## 4. Capability → Infrastructure Mapping

Grounded directly in `capability-ledger.md` (211 rows) and `provider-ledger.md` (48 rows), not
inferred. The full capability-by-capability table (~30 rows, covering market data, streaming,
fundamentals, estimates, corporate actions, ownership, people/company intelligence, news, alerts,
watchlists, charting, screening, calendar, portfolio/risk, options/derivatives, AI, symbol/entity,
provider abstraction, provenance, licensing, personalization, workspace, command/search, and
multi-asset breadth) is preserved in full in the forked agent's transcript and summarized by
category below; the complete row-by-row table is available on request and should be folded into
the F-05 Cross-Product Capability Matrix deliverable directly.

**Headline, evidenced rather than assumed: of the roughly 30 capability areas surveyed, about
two-thirds are already substantially supported by existing UCT infrastructure** (market data,
streaming, fundamentals, transcripts, ownership, watchlists, charting, screening, calendar, AI/
intelligence, options/derivatives-flow — several of these, especially options flow and the AI
layer, are genuine strengths ahead of the benchmarked competitors, confirmed by the competitors'
own dossiers admitting the gap). A second tier is a **normalization or abstraction problem on data
UCT already owns**: symbol/entity identity, provider abstraction (one proven pattern exists in
`stripe_service.py`, unapplied to data providers; six independent FMP helper functions with no
shared budget are the debt case study), data provenance (real mechanisms exist scattered across
screener/COT/AI-Search, no shared component), and the alert-type taxonomy (five-plus subsystems,
one shared delivery seam already, no unified trigger model). A small third tier is **genuinely new
infrastructure**: people/company intelligence (no equivalent anywhere in the ledger), corporate
actions beyond splits/dividends, and portfolio/risk analytics beyond position tracking. One
capability class — multi-asset breadth (FX/commodities/rates/fixed income) — is **deliberately out
of scope**, consistent with an existing owner default already recorded in `GOVERNING_PRINCIPLES.md`
§13.

**This is not a "build a terminal from scratch" problem. It is predominantly a "unify, extend, and
give a workspace-native UI to an already-large estate" problem**, with a small, well-bounded set of
genuinely new builds layered on top.

---

## 5. Proposed UCT Terminal System Architecture

Twenty-three systems were derived from the evidence, organized by responsibility rather than by
existing file boundaries. Each is tagged with its build condition per Part 4:

**Extend, already strong:** Market Data, Realtime Streaming/Caching, Fundamentals/Estimates,
Transcripts, Ownership, Watchlists, Screening/Discovery, Options/Derivatives (a genuine
differentiator), AI/Intelligence Layer (the actual moat — see Part 6), Charts/Analytics (extend
*behind a hard contract*; the capability ledger's own "never refactor inside Terminal-Next scope,
consume via ChartPane" verdict should be binding, not advisory, given this is a single 15,500-line
component with an AST-railed six-writer invariant).

**Consolidate / add a missing shared layer on top of existing plumbing:** Alerts/Monitoring (unify
five-plus subsystems around one trigger taxonomy, reusing the existing delivery seam), Data
Provenance (generalize `CoverageLine`/COT-gate/AI-Search-citations into one rendering component),
Personalization (extend three specific already-evidenced moves), Cross-Module Context Propagation
(generalize the existing 4-colour-group link mechanism into a typed channel payload).

**Rebuild / new build on top of existing data:** Persistence/User State (the versioning pattern
already exists in `chart_settings`; apply it to the workspace document, don't invent a new pattern),
Terminal Shell/Workspace (extend the RGL/widget system; rebuild only the persistence layer),
Global Search/Command System (the backend tool registry and ticker search both exist; the missing
piece is a frontend command-palette surface), Licensing/Entitlements (the mechanism exists; the
actual tier numbers are owner-input-bound, not an engineering task).

**Genuinely new infrastructure:** Security/Symbol/Entity Context (no symbol master exists today —
the clearest infrastructure gap the research found), Provider Abstraction Layer (the second
clearest gap — one proven pattern, unapplied to data providers), Corporate Actions (small,
bounded scope beyond splits/dividends), Portfolio/Risk analytics (position tracking already
extends; aggregate risk/scenario work is new — and its most portable borrowed idea, per the
Bloomberg deepening pass, is presenting risk as a narrative over UCT's *existing* regime/breadth
data, not a new asset class).

**Extend carefully, coexistence-scoped:** Events/Calendar — this *is* TERMINAL-CURRENT; nine reader
classes depend on the existing `/api/calendar` contract, so any Terminal-Next work here is a
coexistence problem before it is a green-field one.

**Evaluate, don't assume:** People/Company Intelligence — no dossier established this as
load-bearing for UCT's desk-first, options-heavy positioning; it is a Bloomberg/institutional-
research pattern, not confirmed table-stakes here.

### Paradigms to intentionally NOT reproduce

- **Bloomberg's multi-asset breadth as an architecture target** — zero FX/commodities/rates/
  fixed-income provider coverage today, an existing owner default excluding these from V1; chasing
  it is the synthesis's own named "Temptation 2" (research-terminal envy) in a multi-asset costume.
- **Bloomberg's "inputs, not a verdict" philosophy** — Bloomberg's own dossier says there is "no
  such formula." UCT's `grade_ticker` structural verdict is the opposite, already-shipped bet;
  copying Bloomberg's screen-full-of-inputs posture would abandon a real working advantage.
- **FactSet's twelve-assistant AI sprawl** — UCT already has an early version of this defect
  (six-plus AI doors); route them through one provenance component rather than add a seventh.
- **Unfalsifiable published statistics** (SpotGamma's uncorroborated hit rates, multiple dossiers'
  drifting self-reported counts) — UCT's own six-gate lift-ledger discipline is already the
  stronger, opposite pattern and should be protected, not diluted by importing looser norms.
- **Gödel's bet that cloning Bloomberg's exact grammar captures switching muscle memory** — no
  evidence this is the right onboarding bet for UCT's actual member base.
- **Any surface that publishes two different counts of itself** — already UCT's own most
  expensive, most recurrent tech-debt pattern (TD-19, six-plus instances); the benchmarks confirm
  it isn't a UCT peculiarity, which is a reason to fix it harder, not import more of it.
- **A no-mobile-story posture** — UCT's member base is measurably touch-heavy; a gap to avoid.

---

## 6. Core Product Thesis

**The job.** Today's UCT experience is a wide set of independently-strong tabs (Journal, Charts,
Screener, Breadth, Options Flow, Compass, Model Book) that don't share context — no persistent
loaded-security, no cross-panel propagation, no symbol master. Every competitive dossier this
program produced converges on the same underlying mechanic for what makes a "terminal" feel like
one product rather than a bundle: a persistent, addressable context (the loaded security)
that every panel reads without re-entry, plus one grammar for reaching any function. UCT
Terminal's job is to give the *existing* UCT capability estate that spine — not to build new
capability so much as to make the capability that already exists behave like one coherent
instrument instead of eleven good tools.

**Terminal-grade without mimicking Bloomberg.** The transferable mechanics are: one persistent
context object, provenance on every number, saved things become addressable names, and a
command surface fast enough that a desk never has to reach for a mouse. None of that requires
Bloomberg's twelve-lane, ten-asset-class taxonomy of *places to look*. "Terminal-grade" here means
*decisive and fast*, not *exhaustive*.

**Where UCT should be dramatically simpler than Bloomberg.** No multi-asset breadth (§5's
out-of-scope list). No twelve-lane navigation model — UCT's data estate is options/equities-scoped,
so the navigation surface should be scoped to match, not padded to look comprehensive. Fewer AI
doors, not more (one provenance-routed layer, not FactSet's twelve). A curated-first news posture
by design, with a browsable escape hatch, rather than a firehose feed.

**Where AI produces an advantage no traditional terminal has.** Bloomberg's own dossier states
plainly there is "no such formula" — the analyst still assembles the read, every time, on every
seat, for every stock. `grade_ticker`'s structural GO/HOLD/SKIP verdict, grounded in UCT's own
regime classifier and sizing engine, is the opposite bet, already shipped. Layered on top of that:
UCT's 8,500-entry proprietary knowledge base and six-gate-honest lift ledger (D-13) are exactly the
"decision provenance and first-party narrative" moat the synthesis identifies (§7) — and, distinct
from every benchmarked competitor, UCT can eventually show a member their *own* track record beside
the firm's, which is candidate thesis P-β ("the desk's own prior view is the fifth perspective") —
no dossier in the competitive set found an equivalent.

**Workflows that should unify.** News (currently three unconnected taxonomies: catalyst tags,
themes, cashtags). Alerts (five-plus independently-built subsystems sharing one delivery seam but
no shared trigger model). The AI surface (six-plus doors today). Symbol context (no persistence
across panels — clicking a ticker in one tile does not currently move the rest of the screen).

**The primary interaction loop, as the evidence supports it:** load a security or open a workspace
board → context propagates across every panel without re-entry → the AI layer surfaces a
provenance-sourced, decisive read (not just organized inputs) → the member acts (journal, alert,
size) → the outcome feeds back into personalization and the member's own coaching history. This is
P-α ("decisive, with the receipt attached") and P-β ("the desk's own prior view is the fifth
perspective") combined — the synthesis's own §11 already concludes these two are "compatible and
probably one thesis."

**Roles of the supporting systems.** Command/search: fast, keyboard-first access to the *existing*
154-tool registry and entity resolution — a frontend problem, not a new backend. Context: the
Symbol/Entity system propagating a persistent loaded-security across the workspace — the clearest
new backend build the research found. Personalization: extend three specific, already-evidenced
moves (publish density ceilings, name non-autosaving objects, extend the firm-editable pattern from
scans to boards) rather than invent a new subsystem. Workspaces: extend the existing RGL/widget
system; rebuild only the persistence layer, using the versioning pattern that already exists in
`chart_settings`. Intelligence: the actual moat — give it a provenance component and a stable tool
contract, don't build a new AI system next to it.

**The plausible moat, tied to evidence, not aspiration.** Not data volume — every dossier in the
set treats data as a commodity a well-funded competitor could eventually replicate; several name
the network effect (Bloomberg's chat) or first-party context (AlphaSense, Koyfin) as the actual
differentiator instead. UCT's analogous moat is: (1) a shipped, structural decision-verdict
mechanism no benchmarked competitor has (`grade_ticker`); (2) an honestly-gated, first-party
proprietary track record (D-13's KB and lift ledger); (3) options-flow/GEX depth the dossiers
themselves admit Bloomberg and Gödel lack. One open strategic question the research surfaces but
does not resolve: UCT has no analogue to Bloomberg's IB chat network effect at all — whether that
is an intentional non-goal (UCT is not recruiting Bloomberg refugees) or a genuine future gap is a
product call the evidence cannot make; it belongs in Phase 2's product-vision work, not decided
here.

---

## 7. Architectural Decision Register

Nine decisions, each genuinely load-bearing — not padded to lengthen the list.

**D1 — Workspace model: fixed / modular / hybrid.**
*Why it matters:* determines the whole shell architecture and the persistence-layer design.
*Options:* fixed pages; fully modular dock (react-mosaic/dockview/FlexLayout style); hybrid
(fixed market-wide pages + a composable, portfolio-specific board layer).
*Evidence:* C5-01 found six of seven observed workspace failure modes across the benchmark set are
persistence failures, not layout failures, and no surveyed dock library solves UCT's own
unversioned-`charts_workspace_layout`-blob problem by itself.
*Recommendation:* hybrid — the evidence leans this way, but lock only provisionally; OI-06 and the
`charts_workspace_layout` telemetry query should confirm before final lock.
*What would change it:* a desk-observed morning showing the desk wants a fully modular surface, or
the popout spike (RG-27) revealing dockview/FlexLayout breaks the SSE-pool property in a way a
hybrid model would avoid.
*Locks:* before shell/workspace implementation, not before architecture drafting (C5-03).

**D2 — Command-grammar default: noun-first vs. verb-first.**
*Why it matters:* C4-01 calls this the sharpest fork in the whole command-grammar survey; UCT
cannot have both as default.
*Options:* Bloomberg-style `TICKER <FUNCTION>` noun-first; palette-style `Ctrl-K` verb-first.
*Evidence:* currently unmeasured against the desk's actual habitual action vs. a new member's first
action — genuinely unresolved, not under-researched.
*Recommendation:* none — this is squarely OI-06-gated.
*What would change it:* the observed desk morning.
*Locks:* before the IA/command-system spec finalizes.

**D3 — Symbol/Entity master design.**
*Why it matters:* nearly every other system (context propagation, provenance, alerts, watchlists)
depends on a stable identity underneath the ticker string.
*Options:* adopt FIGI (free, MIT-licensed, permanence-by-design, already cited as prior art by two
competitor dossiers) as the external mapping with an internal permanent entity ID; continue the
current string-key + one-vendor-boundary-rewrite approach.
*Evidence:* `domain-symbol-master-time.md` — no symbol master exists today; adjustment is currently
a symptom (`_is_intraday_stale()`), never a stated policy.
*Recommendation:* adopt an internal permanent entity ID with FIGI as the external mapping, tickers
as a dated alias list; store adjustment as a labeled policy, not a fallback trigger.
*What would change it:* nothing found in the research argues against this; it is the clearest,
best-evidenced recommendation in this register.
*Locks:* the schema before implementation begins; design work can and should start immediately.

**D4 — Provider Abstraction Layer pattern.**
*Why it matters:* determines how every future data-model and provider-swap decision gets made.
*Options:* an anti-corruption-layer per vendor with a canonical internal model (the pattern
`stripe_service.py` already proves works in this codebase); continue direct per-vendor client code.
*Evidence:* six independent FMP helper functions with no shared budget is the concrete debt case
study; the ACL pattern already exists and works for exactly one integration (Stripe).
*Recommendation:* adopt the ACL pattern; use the FMP-helper consolidation as the first proof case.
*What would change it:* nothing found argues against it.
*Locks:* before ARCH-04 (data architecture) finalizes.

**D5 — Member-facing data-licensing posture (D-002).**
*Why it matters:* decides whether raw vendor data can ever display to a non-desk member.
*Options:* Restricted-pending-contract (current default); Likely Allowed on confirmation of
Massive's tier and/or an FMP DDLA.
*Evidence:* the licensing register's 81 Restricted rows collapse to 27 if both OI-03(a) and
OI-03(b) resolve favorably; 13 of the remaining 27 are fixable by engineering alone.
*Recommendation:* none — explicitly the owner's call, and explicitly not researchable further.
*What would change it:* OI-03(a)/(b) only.
*Locks:* before ARCH-06 and any member-facing data-display feature; does NOT block desk-scoped
architecture work.

**D6 — AI provenance component: shared vs. per-surface.**
*Why it matters:* determines whether "every AI answer is cited" is a structural guarantee or a
per-feature discipline that will eventually lapse.
*Options:* one shared rendering component every AI/data surface routes through; continue
per-surface provenance (`CoverageLine`, the COT gate, AI-Search's citation chips, each separately
built).
*Evidence:* the synthesis (§12.3) already names this as a load-bearing recommendation; the
individual mechanisms all already exist and work, just not as one shared primitive.
*Recommendation:* adopt as a shared platform primitive — low controversy, high leverage, no
identified counter-evidence.
*What would change it:* nothing found.
*Locks:* early, before ARCH-05 finalizes; this is cheap to decide now.

**D7 — Alert-type taxonomy: unified vs. fragmented.**
*Why it matters:* five-plus alert subsystems exist today, sharing one delivery seam
(`deliver_alert_payload`) but no shared trigger model.
*Options:* unify around one taxonomy; continue building new alert types as one-off subsystems.
*Evidence:* the delivery infrastructure is already shared; the gap is purely a trigger-taxonomy
abstraction, which is cheap relative to the alternative of a sixth independent alert subsystem.
*Recommendation:* unify.
*What would change it:* nothing found.
*Locks:* before the Alerts system spec.

**D8 — Corporate-actions and portfolio-risk scope: build now or defer.**
*Why it matters:* both are genuinely new infrastructure with no current UCT equivalent.
*Options:* build in this phase; defer to a later roadmap horizon.
*Evidence:* no dossier or internal-system finding establishes either as near-term desk-blocking;
they surfaced as capability gaps, not as demonstrated desk needs.
*Recommendation:* defer — treat as MVP/roadmap-scoping decisions (H-01), not now.
*What would change it:* OI-06 revealing the desk actually needs one of these daily.
*Locks:* at MVP/roadmap definition, not before.

**D9 — Decisiveness for two audiences (desk vs. member).**
*Why it matters:* determines whether the provenance/verdict component renders one shape or two.
*Options:* decisive-by-default for everyone; graduated/coached posture for non-desk members.
*Evidence:* §13.4 of the synthesis surfaces the tension (LSEG/FactSet refuse the verdict for
strangers; UCT already computes one for a coached membership) but does not resolve it — this is a
genuine product decision, not a research gap.
*Recommendation:* none — the synthesis's own recommended path (a GOVERNING_PRINCIPLES revision) is
correct; this needs owner judgment, not more evidence.
*Locks:* before ARCH-05 finalizes.

---

## 8. Existing Codebase Discovery Needs

**Most of this is already done.** Before this session's recovery work, the program's own Group D
roles produced 8,026 lines of direct codebase archaeology across eight files (`frontend-
archaeology.md`, `backend-archaeology.md`, `database-and-infrastructure.md`, `terminal-current-
map.md`, `ecosystem-cartography.md`, `state-persistence-and-workspaces.md`, `flags-and-
entitlements.md`, `testing-reliability-observability.md`). This maps to nearly every item on the
checklist: routes/components, state architecture, existing APIs, data fetching, provider
integrations, backend services, Railway topology, database/storage, caching, auth, symbol/entity
handling (confirmed absent), news/calendar infrastructure, personalization state, the design
system, reusable components, and — via the 211-row `capability-ledger.md` — a direct answer to
"what do we already have that research might not know about."

**What genuinely remains — narrow, mostly read-only probes, not a new phase:**
1. RG-25 — edge caching + SSE reconnect semantics on flow endpoints (three `curl -I` calls, one grep).
2. RG-26 — panels-per-session load assumption (no measurement exists; carry as a labeled ARCH-07 assumption, don't block on it).
3. RG-27 — does a dock-library popout preserve the opener's React tree / the one-SSE-pool property (prototype only if D1's workspace decision makes it decision-relevant).
4. RG-24 — which ticker-mentions door is actually live (a 15-minute targeted read).
5. RG-16 — `MASSIVE_SECRET_KEY` code-path scope (resolves from D-03's existing call-site table).
6. **The single largest remaining ceiling across the whole archaeology, named by `backend-
   archaeology.md` itself: which flags are actually SET on Railway in production** — every "dark by
   default" statement in the corpus is a source-code default, not an observed state. Orchestrator-
   only (DL-012, names/flags only, never secret values); should run once, broadly, early in Phase 2.
7. No production data anywhere in the corpus (row counts, real layout-blob sizes, alert-fire
   counts). This is D-13's own bounded-unknown list; closes via OI-06 plus a handful of owner-run
   read-only queries, not a discovery phase.
8. No test-suite execution anywhere in the archaeology (by design, to protect Terminal-Current).
   Any architecture claim of "X is already tested" should be spot-verified once, not assumed.

None of items 1–8 blocks *starting* architecture work. Item 6 and item 7 are worth doing once,
broadly, early in Phase 2 — they retire the single biggest evidence ceiling in the internal-system
corpus cheaply. Items 1–5 are narrow, decision-triggered probes that should happen exactly when the
architecture decision needing them comes up (see Part 7), not before.

---

## 9. Phase 2 Recommendation

**Objective:** turn the now-substantially-complete research corpus into the architecture-phase
deliverables Document C's own plan always specified (`MASTER_CHECKLIST.md` rows 9, 12–15, 18–24) —
not implementation, not another broad research wave.

**Workstreams:**

1. **Product Architecture & Vision** (F-05 cross-product capability matrix + best-of-breed matrix,
   F-07 persona/JTBD/workflow library, `product-vision.md` + `non-goals.md`) — draws directly on
   Parts 4–6 of this review; the underlying evidence is already gathered, so this should move fast.
2. **Information Architecture / Command System** (`information-architecture.md`, the workspace
   decision C5-03, the command-grammar decision D2) — draft provisionally now per §12.1 of the
   synthesis; final lock gated on OI-06.
3. **Provider / Data Architecture** (`data-architecture.md` incorporating D3's symbol/entity master
   design and D4's provider-abstraction pattern) — start drafting the pattern on F-03b now; fold in
   F-09's granularity once it lands.
4. **F-09 Provider Master Ledger** — run in parallel with workstreams 1 and 3, narrowly scoped
   exactly per its existing contract (no expansion). Sharpens specific decisions; does not gate
   the other workstreams' start.
5. **Narrow targeted technical discovery** — the Part 8 items (the broad Railway-flag-state read
   foremost, plus RG-16/24/25/26/27), run cheaply and in parallel, not as a separate phase.

**Dependencies:** workstream 2's final lock needs OI-06; workstream 3's member-facing branch needs
OI-03(a)/(b); everything else proceeds now.

**Deliverables:** the specific `MASTER_CHECKLIST.md` rows named above, plus an updated
`AGENT_REGISTRY.md`/`CRITICAL_PATH.md` reflecting their completion.

**Acceptance criteria:** every deliverable evidence-cited per the program's existing standard;
reviewed for contradictions the way Part 2 of this review was conducted, before being marked
accepted.

**Gates:** PRD/functional specification (F), technical specification (G), and implementation
sequencing (H) explicitly wait for Phase 2's output plus the owner's sign-off on the product
vision and the decisions in Part 7's register that need it.

**What should NOT happen yet:** implementation (J); prototypes beyond the one narrowly-scoped
popout spike (RG-27), and only if D1 makes it decision-relevant; a full PRD/functional spec
(premature until product-vision and IA exist); any application-code change.

---

## 10. Research Stopping Rule

**What we now know with sufficient confidence:** the existing UCT capability landscape (211-row
ledger, 8,000+ lines of archaeology); the competitive landscape (13 dossiers, all evidence-tiered,
Bloomberg now deepened across 33 of 36 owner-named topics); the licensing shape (118-row register,
the two swing facts identified precisely); the cost shape (both cost models, labeled assumptions
stated as such); the proprietary-asset moat (D-13); 40 executive questions scored (10 green/23
yellow/7 red) and 35 hypotheses scored (8 supported/12 partial/3 unsupported/12 unknown).

**What remains genuinely uncertain:** the desk's actual daily workflow rhythm (OI-06); Bloomberg's
and Gödel's most experiential, pixel-level UX claims (OI-08/18); the production capacity envelope
(D-05); a handful of narrow code-path questions (Part 8, items 1–5); member-facing licensing
(owner-input-bound).

**Do these uncertainties justify more BROAD research? No.** Part 3 found zero BLOCKING items after
a rigorous, non-padded review. The remaining uncertain items are each one of: owner-input-bound
(more research cannot resolve them, only asking can), narrow and targeted (minutes to an afternoon,
not a wave), or capped by public-source availability in a way no further searching closes (OI-08/18
— this is a genuine ceiling, not a research shortfall; more dossier-reading cannot manufacture a
Bloomberg seat).

**What should become targeted/on-demand instead of broad:** the Part 8 narrow items; F-09 (already
scoped narrowly); any *future* competitor-dossier deepening should only happen if a specific
architecture question surfaces that a specific dossier can answer — not as a standing wave.

**What is now gained more efficiently by architecture/design work than by more dossier research:**
essentially everything in Part 7's decision register. The workspace model, the command-grammar
default, the symbol-master schema, and the provider-abstraction pattern are design questions now,
not research questions — they need a small number of owner inputs and design judgment, not more
reading.

---

## 11. Final Recommendation

# CONDITIONAL GO

**Why:** Part 3's classification found zero BLOCKING items after a rigorous, evidence-grounded
review — nothing in the corpus makes starting architecture work irresponsible. Part 4 found
roughly two-thirds of the capabilities a terminal needs are already substantially supported by
UCT's existing infrastructure, meaning architecture work has real, specific ground to stand on
rather than a blank page. Part 5 produced a coherent 23-system decomposition, each system's build
condition evidenced, not guessed. Part 6 grounds a specific, evidence-tied product thesis rather
than an aspirational one. Part 7 identifies nine genuinely load-bearing decisions, two of which
(D5 licensing, D9 decisiveness) are explicitly owner-judgment calls the evidence cannot make for
you, and several of which (D2 command grammar, D1 workspace model's final lock) benefit materially
from OI-06 before they finalize. That is the "conditional" in this recommendation: proceed into
Phase 2 now, but do not finalize the specific decisions that are genuinely input-bound until those
inputs land.

**Conditions:**
- Do not finalize D5 (member-facing licensing architecture) or ARCH-06 until OI-03(a)/(b) resolve.
- Do not finalize D1 (workspace model) or D2 (command-grammar default) until OI-06 lands, though
  provisional design work on both should proceed now per §12.1 of the synthesis.
- Do not treat OI-08/OI-18 as blocking anything — they are Category D (validation/enrichment), not
  gates.

**Exact next action:** begin Phase 2 workstreams 1–3 (Product Architecture & Vision, Information
Architecture, Provider/Data Architecture) as defined in Part 9 — **pending your explicit
go-ahead**, per your instruction not to begin Phase 2 automatically.

**Should the queued F-09/DL-022 wave run now, later, be narrowed, or be canceled?** Run now, in
parallel with the Phase 2 architecture workstreams, exactly as currently scoped in
`contracts/F-09.md` — no expansion, no narrowing. It sharpens specific licensing/retirement
decisions rather than gating the start of architecture work (Part 3's explicit finding), so there
is no reason to delay it, and no reason to widen its scope beyond what the owner already directed
via DL-022. **This requires your go-ahead to dispatch — not yet sent.**

**Open items requiring you personally:** OI-03(a)/(b) (Massive tier, FMP DDLA), OI-06 (an observed
or narrated desk morning), OI-08 (Bloomberg access), OI-18 (Gödel trial), the four telemetry
queries against `auth.db` (§9 item 3 of the prior close report), and the D9 decisiveness-for-two-
audiences product call. None of these are being treated as approved or rejected by your prior
silence — they remain open, exactly as you instructed.

**Open items that can be resolved independently, later, without you:** the Part 8 narrow technical-
discovery items (RG-16/24/25/26/27, the broad Railway-flag-state read); F-09 (once you authorize
dispatch, it needs no further owner input to execute); the C2-02 events-intelligence re-dispatch,
if and when you want research resumed (I am treating that as still paused, per your explicit
instruction not to launch another broad research wave — C2-02 is a research task, not an
architecture one, so it stays deferred until you say otherwise).

---

*This review is stopped here, per instruction. No Phase 2 work has begun. F-09 has not been
dispatched. No application code has been touched. Waiting on your decision.*
