# UCT Notebook — Ultimate Competitive Roadmap

**What this document is:** the durable, long-term strategic map for UCT Notebook
becoming a credible primary knowledge environment for financial users — built on
top of, not instead of, the existing deep research. **This document does not
replace `primary-platform-master-product-spec.md` / `-master-architecture.md`**
(the authoritative product/architecture specs for what's actually being built
wave-by-wave); it summarizes the broader competitive program those specs execute
against, and points to the two research artifacts underneath it for full depth.

**Read in this order:** this document (orientation) → `competitive-gap-ledger.md`
(the living, row-level tracker — the one to check for "is X done yet") →
`notebook-ux-ui-competitive-ledger.md` (the interaction-sequence-level UX/UI
tracker — added 2026-09-06, see below) → `primary-notebook-readiness-scorecard.md`
(the current evidence-based score, now including a dedicated UX/UI section) →
`competitive-primary-platform-phase-zero.md` + `-phase-one-adversarial.md` (the
full research, for when a section below says "see Phase X §Y" and you need the
complete reasoning, not just the verdict).

**2026-09-06 addition — UX/UI is now permanent, cross-cutting, first-class.**
Every section below already described a *capability*; from this point forward,
capability parity is explicitly NOT the same thing as experience parity (see
the scorecard's own "Capability Readiness vs. Experience Readiness" section),
and every future wave's readiness checkpoint and certification must report a
UX/UI verdict alongside the functional one. This did not require rewriting any
conclusion below — every capability verdict already written stands; the UX/UI
ledger and scorecard section are additive layers on top of it, not a
replacement for it.

**Status discipline:** Phase Zero (12 dispatches) ran 2026-09-05 and produced the
original competitive matrices, personas, and P0-P3 prioritization. Phase One (9
independent adversarial dispatches, same day) red-teamed Phase Zero and corrected
six material things — most importantly, narrowing the north star and finding that
roughly half the P0 punch list was already shipped, missed by Phase Zero's own
first pass. **Where Phase Zero and Phase One disagree, Phase One's verdict is
authoritative** — it was produced specifically to stress-test Phase Zero, not to
summarize it. This document carries forward Phase One's corrected conclusions,
not Phase Zero's original ones, except where explicitly noted.

**This document's own status update, layered on top of both phases:** Waves 0-3
(Trust Foundation, Capture Completion, Ask Current Note, Thesis-Trade Link),
Stage A validation instrumentation, and Wave 4 (Search Evolution I) design all
happened in the day between Phase One's research and this document — verified
this session via three fresh, independent, read-only research passes, not
assumed from wave names. Every section below states current 2026-09-06 status,
not just the phase-research verdict.

---

## §1. North Star

**Revised by Phase One, adopted here.** Not "replace Notion/Evernote/Obsidian."
The correct north star: **UCT should be the system of record for a member's
tickers, positions, trades, and theses — used alongside their general notebook,
not instead of it.** This is cheaper to earn trust for, makes the Do-Not-Build
list (§4 below) durable rather than provisional, and repositions the closed
migration/connector program from "step one of luring you away" to "the bridge
that makes UCT useful without asking you to leave." A hybrid outcome — UCT for
financial captures, Notion/Obsidian for everything else — is an explicit
**success** state under this north star, not a fallback to fix later.
(Phase One, North Star Challenge.)

## §2. Current State

See `competitive-gap-ledger.md` for the row-level detail and
`primary-notebook-readiness-scorecard.md` for the domain scores. Headline: a
genuinely strong editor and export, a real and unusually mature capture
mechanism, a correctly-scoped and shipped trade-link layer, and one proven
(narrow) instance of the temporal-correctness moat — sitting against real,
named gaps in version history, corpus-wide AI, thesis structure, and the
snapshot-semantics extension that everything financial-native ultimately
depends on. **Composite readiness is capped at 6-7/10 across every domain**
until real Stage A member usage exists (currently zero, day 0 of
instrumentation) — this is the actual ceiling right now, not any feature gap.

## §3. Stage A/B/C

Preserved as designed, reframed by Phase One's "alongside" north star:
- **Stage A — Primary Notebook Beta.** Capture/write/organize/search/link/
  retrieve/recover/export/save-from-UCT, plus at least one concrete financial
  advantage (Ask Current Note + the entity reverse-index + a real thesis↔trade
  link). **Currently the active gate** — see the decision log for the exact 8
  criteria. Per Phase One's revised Beta definition, this is materially smaller
  than Phase Zero's original plan implied, because most of the "greenfield"
  work it assumed was already shipped.
- **Stage B — Financial Research System of Record.** Continued use of another
  notebook for unrelated/general knowledge is acceptable and expected. Unlocked
  by: the account-deletion gap fixed (**done**), trash/search trust foundation
  real (**done**), Ask Notebook + full snapshot-semantics extension live,
  trading-journal link + thesis changelog live, and the professional-analyst/PM
  persona question resolved with real usage data (**open**, see §57).
- **Stage C — Primary Notebook Ready for target financial users.** A
  representative trader/investor/researcher doesn't need another notebook for
  an important daily workflow. Not broadened into universal productivity
  parity — see §4.

## §4. Competitive Philosophy

Do not clone Notion/Evernote/Obsidian feature-for-feature. For every capability,
label MUST MATCH / MUST EXCEED / CAN DIFFER / DO NOT BUILD (see the gap
ledger's Parity/Diff column for every row). The generalizable rule Phase One
derived from three independent instances already in this codebase (chart
embeds, trade `context_at_entry`, watchlist/scanner freezing): **a capability's
live, authoritative state belongs to exactly one surface. Notebook may only
reference it via a live link or a frozen snapshot — never re-implement it.**
This single rule is what keeps Notebook from becoming a dumping ground and
is the operative test for every future roadmap addition (Phase One, "UCT
Surface Ownership").

## §5-7. Notion / Evernote / Obsidian Parity

Full matrices: Phase Zero §4-§7, §25-§27 (original), corrected by Phase One's
Competitor Blocker Challenges. Verdicts, current as of this document:
- **Notion:** true blockers are search-at-scale (UCT's own is now verified
  cheap at realistic query shapes, see §11) and *some* flexible structured-view
  mechanism (CAN DIFFER — derived financial properties beat hand-maintained
  relations for this audience, not full database parity). Notion's cited
  "Research Mode" AI should be reframed MUST EXCEED, not MATCH — UCT's
  temporal-correctness discipline is a stronger trust property for financial
  facts than generic cited RAG.
- **Evernote — the single most over-weighted competitor per Phase One.** OCR
  is a false alarm for this persona (filings/transcripts/charts are already
  digital-native) — DO NOT BUILD, confirmed. Email-to-note is real and cheap
  (the destination already exists) — worth a near-term look, unlike OCR.
- **Obsidian — genuinely the highest trust bar, correctly treated as such.**
  Lead with UCT's already-proven, round-trip-verified export as the trust
  answer, not offline (Phase One sharpens this). New finding: Obsidian is
  *also* a direct trading-journal competitor for the swing-trader slice
  (Dataview-based journal plugins with broker sync exist) — the real risk is
  discoverability, not features, since UCT's native journal is structurally
  superior to any single/dual-broker Dataview vault.

## §8. Editor

Score 6/10 (scorecard). Genuinely strong, production-verified — see gap ledger
G-030 through G-036. Real remaining gaps: command palette, find-in-note,
note-to-note link authoring, non-image attachments. None of these are P0;
none block Stage A.

## §9. Organization

Score 5/10. Folders/tags/ticker are solid and extendable. No favorites,
recents, saved views, or structured properties (G-023, G-024, G-025, G-021).
The financial-native answer to "structured properties" is a derived layer
(§13 below), not Notion-style generic databases.

## §10. Structured Research

Not a Notion-database clone. The smallest model that captures the high-value
jobs: a derived (not hand-authored) entity layer (§13) plus dynamic views over
it (active theses, catalysts in next 14 days, research needing review — the
exact list the master directive proposed is a reasonable Stage-2 view set,
none built yet, all cheap once the entity layer + thesis tags exist). G-021,
G-025 in the ledger.

## §11. Search

Score 5/10. Engine is solid; Wave 4 (date filter, query-aware snippets, BM25
ranking, entity filters) is fully designed and implementation-ready but
Stage-A-gated (see `wave4-implementation-readiness.md` for the complete
design). Real open items independent of Wave 4: the $NVDA-ticker-field gap
(G-018), the folder-sidebar correctness bug's current status (G-012, needs a
direct re-check). Evolution strategy, unchanged from Phase One: lexical → date
→ entity → (only if evidence warrants) semantic/hybrid, last not second.

## §12. Backlinks / Knowledge

Score folds into Organization (5/10). Real finding this session: Obsidian-
imported wikilinks already become genuine, navigable note-to-note links — the
rendering exists, native authoring doesn't (G-022, G-033). The correct build
is a derived reverse-index (already the design direction, Phase Zero §10/§14),
not a full graph engine.

## §13. Financial Entities

~75% already shipped per Phase One's direct verification (mention detection,
stored join table, reverse-index read all predate Phase Zero's own research).
Three-tier model — CONFIRMED (`j2_notes.ticker`) / STORED (`j2_note_embeds`,
accepted) / SUGGESTED (cashtag detection, offered never auto-committed) —
should be named as deliberate policy, not left implicit. Real remaining slice:
sector/earnings-window join (designed in Wave 4, Stage-A-gated), persisting
SUGGESTED (not just accepted) mentions so prose-only mentions get backlink
coverage, and a real class-share cashtag bug (`$BRK-B` extracts as invalid
ticker "BRK" — inherited from `/buzz`, untriggered there, will bite here).

## §14. AI

Split, per Phase One, into three tiers of a single coherent architecture
(never five disconnected AI experiences — §19 below):
- **Ask Current Note — DONE, live, Wave 2.** Score contributes to the 4/10 AI
  domain score alongside the next item's absence.
- **Ask Notebook (corpus-wide) — P1, greenfield.** Needs a genuinely new
  per-user-keyed retrieval index (never `brain_kb_service.py`'s shared-matrix
  shape), the fact/snapshot ledger (§16) for temporal correctness, and must
  ship as tools inside Compass's existing registry, not a second chat surface
  (Architecture Pre-Mortem #1 below).
- **Ask Notebook + UCT — Experiment, blocked on the external legal/data-rights
  review**, not scheduled. Fusing private notes with vendor-sourced data in
  one answer puts the data-rights boundary directly on the critical path.

## §15. Temporal Research

The strategic moat, proven for one data type. See §60-62 gap-ledger rows and
the domain score (5/10) for the honest current state: chart embeds done and
correctly nuanced (frozen query-anchor, not always frozen pixels — daily+
timeframes legitimately re-fetch); fundamentals/watchlist/scanner done;
**analyst estimates cannot be captured at all yet** (the real remaining
differentiator work, not a hardening task); a live Calendar-embed bug open.
Research Time Machine (then-vs-now comparison UI) is a real future
differentiator built ON TOP of the fact ledger once it exists — not started,
correctly sequenced after its prerequisite.

## §16. Provenance

Already the house convention, three times over (`j2_note_embeds.mode`/
`captured_at`, `j2_chat_messages.role`, ModelBook's `catalysts.source`) — the
work is extending an existing idiom to two more insertion paths (quoted
external excerpts, AI-synthesis-inserted content), not designing a new
system. Object-level (row/attribute), never block-level prose tagging or
citation-level inline markup in the note body itself (citation markup belongs
inside an Ask Notebook *answer*, a rendering concern, not a note-editing one).

## §17. Thesis Plan

Score 3/10 — genuinely early. A thesis is a bare tag today, no structured
fields. Correct build, per the product constitution's own "opt-in scaffolding,
never a mandatory form" principle: a `tags` entry + ordinary body content,
optionally templated, plus a read-time diff view against the fact ledger —
never a new mandatory object. Cite `j2_verdicts` as an existing evidence
source (Phase One's addition, not in Phase Zero). Changelog ships before any
proactive alerting (alert fatigue is structural — UCT's own Awareness Engine
already needed cooldowns for the identical reason).

## §18. Trading-Integration Plan

Score 7/10 — the strongest, best-scoped domain on the scorecard. Wave 3's
typed link layer is exactly what Phase One independently arrived at as the
correct scope, built before the recommendation existed. The proposed
standalone "Trading Journal object model" is REJECTED, not merely downgraded
— UCT already ships every component of it (position, entry/exit, catalyst
tags, chart snapshots, AI post-mortem, structured verdict, discipline
detection), more integrated than any external competitor researched. See
"UCT Surface Ownership" (§4) for why this generalizes.

## §19. AI Ownership

**One coherent AI interaction architecture, context-specific entry points —
never five unrelated experiences.** Journal 2.0/Compass remain authoritative
for trade-review AI. Notebook AI focuses on research/knowledge retrieval/
thesis analysis. Ask Notebook must expose note retrieval as tools inside
Compass's existing tool registry (the same `brain_service` facade pattern
this codebase already proved for a different bridge), never a second,
disconnected chat surface — named by Phase One's Architecture Pre-Mortem as
the single highest-probability, highest-impact long-term risk to this whole
program (already partially underway: Compass ships Pre-Trade Verdict/
Post-Mortem/tilt intervention; a parallel "Compass ↔ Voice unification, one
brain" initiative elsewhere in this codebase exists specifically to fix this
exact failure mode for a different pair of surfaces — same discipline
applies here).

## §20. Capture Plan

Score 6/10. Real, mature, unusually far along for this stage (`CaptureInboxTray`
shipped 2026-08-12, missed by Phase Zero's first pass, independently
rediscovered by 3 of Phase One's 9 dispatches, confirmed again by this
session's own research). Remaining real work: extend to 4 uncovered surfaces
(Screener, Options Flow, COT Data, Model Book), add a comment field, confirm
the destination-menu (`targetsFor()`) is actually wired to all 9 buttons.

## §21. PDF/OCR/Document Plan

No PDF/OCR capability exists anywhere. OCR itself: DO NOT BUILD (false alarm
for this persona — filings/transcripts/charts are already digital-native, per
Phase One). Plain PDF ingestion (searchable, not scanned) remains a real,
separate, untested-demand gap (G-045).

## §22. Filing/Transcript Plan

Not separately researched in depth by either phase beyond the general
document-capture question above; no filing/transcript-specific capture path
exists in Notebook today. Do not duplicate Terminal's own filing/transcript
functionality (`EarningsResearchModal`, `av_transcripts.py`) — Notebook should
preserve/reason over the research artifact via a frozen snapshot + link, per
§4's surface-ownership rule, not re-fetch or re-render it natively.

## §23. Version-History / Trust Plan

Score 6/10 (Trust/Recovery domain). Trash/undo-delete: **done** (Wave 0).
Account-deletion FK gap, Phase One's single most severe finding: **confirmed
fixed** this session (`account_purge.py` covers all 9 Notebook tables).
Version history: **still entirely absent** — the Product Constitution names it
a non-negotiable trust bar alongside trash and search, and it's the one of
the three with no current P0 disposition. This is the highest-leverage single
gap remaining in the Trust domain.

## §24. Export/Portability Plan

Score 6/10. Full-library export is genuinely strong, independently
round-trip-verified — a real advantage over Evernote. Two real gaps found
THIS session, previously unflagged by either research phase: **no single-note
export** (G-091), and **trade-link references silently drop on export**
(G-092) — the latter directly undermines the portability principle for
exactly the data type this product differentiates on. Both are cheap, real,
and recommended for near-term attention.

## §25. Mobile Plan

Score 4/10. Reachable via standard mobile nav, CSS-responsive in 7 component
stylesheets — not zero. No JS-level responsive hooks, no mobile capture/
share-sheet — a confirmed gap, explicitly and correctly deferred to Stage B
in the master architecture doc already (not a new decision this document is
making).

## §26. Offline Plan

Score 1/10, and correctly so per both phases — UCT's live-streaming
architecture makes ~90% of the product useless offline regardless of
Notebook, a structurally different starting point than Obsidian's writers-
on-a-train audience. Full offline editing: Experiment/Validate-First, low
expected value. Two cheaper, better-fit mitigations Phase One added (not in
Phase Zero): a read-only cache of recently-viewed notes, and a local draft
safety net — the second of which is **already done** (localStorage, per
keystroke, confirmed this session).

## §27. Template Plan

Score 5/10. 8 real, data-aware templates exist, all trading-ritual-shaped
(zero fundamental-research templates), no user-defined capability. Strong for
the primary beachhead persona; a real, low-priority gap for secondary
personas (add Long/Short Thesis + Company Deep Dive templates only if/when
secondary-persona investment is prioritized — not now).

## §28. Dashboard/View Plan

Not built. "Notebook Home" (recent research, active theses, upcoming
catalysts, research needing review) is a reasonable Stage-2 concept once the
entity layer and thesis tags exist to power it — no dependency blocks
*designing* it, but building it ahead of those prerequisites would mean
rebuilding it once they land.

## §29. Task/Reminder Plan

Confirmed genuinely absent for notes (distinct from the unrelated trading-
discipline "rule" display feature, which this session's research explicitly
distinguished). Not researched in strategic depth by either phase — a real
open item, low urgency, no current evidence of demand.

## §30. Collaboration Plan

Score 3/10. One real, substantial, but fully dark capability already exists
(`note_shares.py`, sanitized public read-only links, more built-out than
Phase Zero credited) — flag-gated OFF, zero validated demand. No account/team
boundary concept exists anywhere in UCT's auth system — even the lightest
sharing feature needs that decided first, a billing/product decision, not a
UI increment (Phase One's addition).

## §31. Extensibility Plan

Not built, correctly Experiment/Validate-First. A small, first-party,
tightly-scoped integration surface is the right shape if pursued at all —
never a plugin marketplace (unsandboxed execution risk unacceptable for
financial research data).

## §32. Security/Privacy Plan

Score 6/10. Tenant isolation structurally sound, consistently enforced,
spot-checked this session. Note content/attachments remain plaintext at
rest — a real, known gap; encryption is gated on a design spike because
naive column encryption would break the live plaintext-fed FTS5 index (key
management is the easy part, already solved for connector tokens).

## §33. Performance/Scale Plan

Score 5/10. `list_notes` (the real "open Notebook" path) is flat 1.3-2.3ms
even at 50k synthetic notes. Several other paths (folder counts, backlinks,
FTS at platform scale) are confirmed super-linear at 50k, not yet
root-caused. The single-uvicorn-process ceiling is a named, real, currently
unowned architectural risk — Phase One's explicit disposition:
Experiment/Validate-First, owned by platform infra, with a concrete revisit
trigger (N concurrent Notebook users, or the first feature needing an
unbounded per-request scan), not left invisible.

## §34. Competitive Gap Ledger Summary

See `competitive-gap-ledger.md` in full. Summary counts as of this document:
17 DONE, 3 REJECTED (Do-Not-Build, confirmed), 3 new findings this session, 4
designed-and-Stage-A-gated (Wave 4), 5 Experiment/validate-first, remainder
open at various priorities. Net read: roughly half of Phase One's P0 punch
list is done, including the most severe single finding (account-deletion).

## §35. Primary-Notebook Readiness Score

See `primary-notebook-readiness-scorecard.md` in full. Unweighted composite
~4.9/10 across 16 domains — presented for orientation only, not for ranking
domains against each other (they carry different strategic weight). Every
domain is capped at 6-7 until real Stage A member usage exists.

## §36. Stage A/B/C Roadmap

See §3 above. Stage A is the active gate; do not proceed to Stage B work
until it's satisfied or explicitly waived by the owner.

## §37. Likely Implementation Waves

Phase One's revised wave plan (its own "Revised Implementation Waves"
section) is the authoritative sequencing, reconciled against what Waves 0-3
actually shipped:

- **Wave -1 equivalent (account-deletion FK gap):** DONE, confirmed fixed.
- **Wave 0 (Trust):** trash/undo — DONE. Folder-sidebar fix, search-latency
  verification — status needs re-confirmation (verification is done per Wave
  4 prep; the sidebar fix itself is unconfirmed).
- **Wave 1→2 equivalent (Capture):** the mechanism shipped earlier than any
  wave plan assumed (2026-08-12) — remaining work is coverage extension +
  small UX completion (G-040, G-041).
- **Wave 2 (as actually built) — Ask Current Note:** DONE, matches Phase
  One's "ship this early, it's cheap" recommendation exactly.
- **Wave 3 (as actually built) — Thesis-Trade Link:** DONE, matches and
  exceeds Phase One's "small link/cross-nav layer, reject the object model"
  recommendation.
- **Wave 3.5 equivalent (snapshot semantics, reframed):** OPEN — the fact
  ledger + first analyst-estimates capture path + Calendar-embed fix. **This
  is the single highest-leverage remaining item** — it gates Ask Notebook,
  thesis changelog, and the temporal-correctness moat's universality claim.
- **Wave 4 (as actually being built) — Search Evolution I:** fully designed,
  implementation-ready, Stage-A-gated. See `wave4-implementation-readiness.md`.
- **Wave 5 (Ask Notebook), Wave 7-equivalent (thesis changelog):** not
  started, both depend on the fact ledger above.
- **Later waves (collaboration, mobile/offline polish):** unchanged,
  correctly deferred, validate-first.

## §38. Dependency Graph

Unchanged in shape from Phase One's own "Revised Dependency Graph" — the
fact/snapshot ledger is the single load-bearing prerequisite gating
everything AI/financial-native downstream (Ask Notebook, thesis changelog,
universal temporal correctness), not the AI feature itself. The
account-deletion fix that used to sit ahead of this entire chain is now
**done**, so the critical path today starts at: Wave 0 remaining items
(parallel, no cross-dependency) → the fact ledger (the real next
foundation-tier project) → everything downstream.

## §39. Implementation Principles

1. Evidence-ordered, not sequence-blind: research → current reality → user
   evidence → prioritize → design → implement → prove → validate (master
   directive §64). Real user evidence can and should reorder later work.
2. Verify "already shipped" against code before planning around it — this
   exact discipline is what caught roughly half of Phase Zero's original P0
   list already being done, and what caught two genuinely new gaps
   (single-note export, trade-link-drops-on-export) this session.
3. Freeze a wave once implemented + tested + E2E-proven + production-verified
   + (where applicable) member-outcome demonstrated. No endless hardening
   without evidence a specific edge case matters.
4. Every structural concept is opt-in scaffolding on a plain note, never a
   mandatory form (Core UX principle, confirmed correct by Phase One,
   confirmed to be exactly what constrains Thesis Intelligence's design).
5. A capability's authoritative state belongs to exactly one surface (§4) —
   the operative test before adding anything to Notebook.
6. **(2026-09-06) UX/UI is evaluated at every stage of every wave, not as a
   trailing polish phase** — research, product definition, architecture,
   design, implementation, testing, production validation, and member
   validation all carry an explicit UX/UI verdict alongside the functional
   one. A feature is not complete because the backend works, the UI exists,
   or tests pass — see `notebook-ux-ui-competitive-ledger.md` for the
   standing method and `primary-notebook-readiness-scorecard.md`'s UX/UI
   section for current scores. Every future wave's readiness checkpoint and
   exit certification must include a UX/UI verdict; a wave with unknown
   discoverability/information-architecture/visual-hierarchy/interaction-
   model/empty-loading-error-state/mobile/keyboard/accessibility answers is
   not implementation-ready regardless of backend completeness.

## §40. Open Questions

Carried forward, still open (Phase Zero §36, Phase One "Open Questions"):
- UCT's actual contracted FMP/Massive terms and Anthropic/OpenAI
  data-handling terms — requires the real contracts, not more research.
  **Not reopened by this document** — the rights track remains separately
  handled per standing instruction.
- **The single most consequential open question from Phase One, still
  unresolved:** does the professional-analyst/PM persona's real competitive
  set include Notion/Evernote/Obsidian at all, or is it Excel/Bloomberg/
  FactSet/internal wikis — a set this entire research program never
  examined? Needs signup-source/usage data, not more competitive research.
  Gates further investment in that persona specifically.
- Is a sell-side/buy-side analyst even permitted to put employer-owned
  research in a personal consumer SaaS notebook? Unexamined, plausibly
  disqualifying for that persona regardless of features built.
- Is current SQLite/FTS5 usage compatible with a SQLCipher-style encryption
  approach that wouldn't break search? The conflict is found; a fix is not.
- Real usage telemetry: how many current Notebook users actually have
  >100 notes in one folder? Bears directly on the folder-sidebar fix's
  real-world urgency.
- Whether UCT's target personas want any team/collaboration depth at all —
  genuinely needs usage data.
- Does real member demand exist for a narrower "financial research capture
  extension" (bookmarklet, not a general clipper)? Untested with users.

---

**This document is durable and should be updated, not replaced, as evidence
changes** — update the relevant §-section and the linked ledger/scorecard
together so the three artifacts never silently drift apart.
