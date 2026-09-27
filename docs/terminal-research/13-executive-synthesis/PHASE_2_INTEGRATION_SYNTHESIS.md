---
id: PHASE2-SYNTHESIS
title: Phase 2 Integration Synthesis — Architecture / Design Close
role: closes Phase 2 (product/IA/data architecture + F-09); the checkpoint artifact before the Implementation Gate
date: 2026-09-02
status: final — presented to owner, awaiting decision
---

# Phase 2 Integration Synthesis

Phase 2 was authorized as a CONDITIONAL GO from the Day 1 Readiness Review: architecture and
design work, explicitly not implementation. This document closes it.

## 1. What Phase 2 produced

Four durable artifacts, all committed:

- **A. Product Architecture** — `05-product-strategy/product-architecture.md` (719 lines). A
  sharpened product thesis, a seven-state interaction loop (ORIENT/LOAD/READ/DECIDE/ACT/RECORD/
  LEARN), an explicit platform-vs-application contract, and a 32-system decomposition (12 platform,
  5 data-platform, 14 applications, 1 intelligence layer) — revised from the Readiness Review's
  23-system sketch with an explicit change table citing evidence for every split, merge, or
  addition.
- **B. Information / Interaction Architecture** — `06-ux-and-information-architecture/
  information-architecture.md` (753 lines). Five shared primitives, a five-level information
  hierarchy whose load-bearing new surface is the entity page (consolidating eleven per-ticker
  doors into one address), six workflow chains stated step-by-step against real capability-ledger
  rows, and eighteen explicitly named Bloomberg/Gödel paradigms rejected with reasons.
- **C. Provider & Data Architecture** — `07-technical-architecture/data-architecture.md` (1,715
  lines after F-09 integration). The Provider Abstraction Layer pattern, the canonical entity/
  symbol master design, time and corporate-actions/adjustment policy, provenance and freshness
  metadata, licensing/entitlement metadata tied to the licensing register's evidence classes, and
  a full F-09-integrated licensing/gap disposition.
- **D. Capability-to-Infrastructure Matrix** — `05-product-strategy/capability-infrastructure-
  matrix.md` (33 rows). Every application/system from the product architecture mapped to its
  actual current UCT provider(s), support level, normalization need, and remaining gap — explicitly
  distinct from the still-not-started competitor-facing "Cross-Product Capability Matrix" (F-05).

Plus **F-09** (`02-data-providers/provider-master-ledger.md`, 56.8 KB): the 48 providers
restructured into a 17-category per-asset-class matrix with the owner's A–G usage taxonomy
(~20 A, 6 B, 5 C, 3 D, 12 E, 11 F, 9 G capabilities) and explicit technical-access-vs-contractual-
rights separation. It was integrated into the Provider & Data Architecture via surgical edits, not
a wholesale rewrite, and every "SHARPEN WITH F-09" placeholder from the draft pass was replaced
with F-09's actual finding.

Plus **E** (`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md`) and this document (**G**). **F**
(open owner decisions) was not spun up as a new file — `OWNER_DECISIONS.md` and
`OWNER_INPUTS_REQUESTED.md`, the program's existing standing registers, were updated instead, to
avoid creating a second authority over the same information.

## 2. Adversarial validation — what was found and fixed

An independent validator read all four documents against the source research and found six
genuine issues (verdict: `accept_with_fixes_needed`). All six were corrected, not merely noted:

1. **(High)** A citation — "Gödel's `TREND` renders delisted tickers struck-through" — was
   attributed to "the Gödel dossier" in three documents, but the synthesized `dossier.md` doesn't
   contain this detail. Investigation traced it to a real, **VERIFIED**-tier line in the accepted
   leaf file `godel/02-verification.md` (line 98) that the pod-synthesis dropped when writing the
   dossier. **The claim is true and sourced — the citation was imprecise, not fabricated.** All
   three documents now cite the correct source; the dossier's own minor completeness gap is noted
   for a future pass, not treated as urgent.
2. **(Medium)** The capability matrix's frontmatter claimed the capability ledger has 346 rows.
   Independently re-measured: 178. Fixed, and reworded to never restate a bare count again.
3. **(Medium)** Product Architecture and Information Architecture disagreed on the Context
   Channel's payload-kind vocabulary (five kinds vs. six, missing `event`) — the exact
   "second-authority-over-one-value" defect this program repeatedly flags in the source research.
   Reconciled to IA's six-kind list, since every IA workflow chain depends on `event`.
4. **(Medium)** Information Architecture's three-surface-kind workspace model (fixed page, board,
   entity page) wasn't reflected in Product Architecture's S1 system, which still named only two
   layers. Fixed — S1 now names all three and clarifies the entity page's ownership split.
5. **(Low)** S8 (Provenance) and I1 (Intelligence Layer) both claimed ownership of "the one
   provenance renderer." Fixed — I1 now explicitly composes on top of S8's renderer rather than
   building a competing one.
6. **(Low)** The capability matrix cited F-09 §3.1 for a SEC-EDGAR-for-fundamentals class-C
   finding that F-09 only actually enumerated for ownership data. Reworded as this document's own
   analogous extension, not a direct F-09 citation.

The validator also explicitly confirmed several things were **clean**: no accidental Bloomberg/
Gödel cloning found anywhere; every PROVISIONAL/OWNER-INPUT-REQUIRED marker applied consistently,
with no owner-bound item silently treated as decided; ten-plus spot-checked provider claims in the
capability matrix all traced correctly to F-09/F-03b rows; GOVERNING_PRINCIPLES §13's scope
defaults quoted correctly everywhere they're cited; core UCT infrastructure claims (the 154-tool
registry, `grade_ticker`, `STREAM_MAX_SUBSCRIBERS=300`) all confirmed present and accurately
quoted — no instance found of the architecture assuming infrastructure UCT doesn't have.

## 3. Material changes from the Day 1 thesis

Phase 2 did not overturn the Day 1 product thesis — it sharpened and operationalized it:

- The thesis's "persistent context spine" idea became a concrete, four-part design: a typed
  Context Channel (S4), a permanent Entity Master (S3) with FIGI as the external mapping, a
  Canonical Data Model with a metric address book (D2), and one addressable entity page consuming
  all three.
- "One verdict shape, not one per surface" (product-architecture.md's own sharpening of the Day 1
  thesis) is now a structural design — the verdict renders through S8's shared provenance
  component regardless of which application requested it — rather than a stated aspiration.
- The Day 1 thesis's P-α/P-β candidates ("decisive, with the receipt attached" / "the desk's own
  prior view is the fifth perspective") are now load-bearing in the interaction loop's LEARN state
  and A13 (Journal & Track Record) — not aspirational, designed.
- The Readiness Review's 23-system sketch grew to 32 systems under closer design scrutiny — this
  is a refinement (splitting Entity Master from Context Bus, Streaming from Caching, adding
  Presentation Primitives, Session/Market Clock, and Rollout/Cohort as named platform systems),
  not a scope expansion; every split is evidence-cited in product-architecture.md's own change
  table.
- One genuine open question the Day 1 thesis didn't surface: which of UCT's **two existing regime
  classifiers** becomes the single authority for the Breadth/Regime system and the verdict gate
  (D13 in the decision register) — a technical-discovery item, not a research gap.

## 4. Results of F-09

F-09 restructured the 48-provider ledger into a 17-category capability matrix with the owner's
A–G taxonomy. Headline: **~20 capabilities class A (in active use), only 9 genuinely class G
(missing from the stack entirely)**. The single most consequential class-G gap: **licensed
futures quotes** (NQ/ES/RTY/BTC) — the current incumbent (yfinance) is simultaneously the *only*
source and the *worst-licensed* (Unsuitable/X-class) row in the entire register, making this the
one gap where a new, licensed vendor plausibly *reduces* risk rather than adding it. F-09 also
independently resolved two standing open questions while grepping repos it wasn't required to
re-open: confirmed Buffer is driven from `uct-clips`, not the dashboard (closing D-14's open
question), and found a **second** independent consumer of the owner's Anthropic subscription seat
(`daily_recap.py`, alongside the already-known `desk_insights_polish.py`) — widening, not
resolving, the existing ESC-17 owner escalation.

F-09's findings were integrated into the Provider & Data Architecture via 15 surgical edits (not
a rewrite) — every "awaiting F-09" placeholder from the draft pass now carries F-09's actual
finding, and the licensing/entitlement metadata section gained a new per-capability technical-
access-vs-contractual-rights table F-09 specifically enabled.

## 5. Remaining owner decisions — the consolidated packet

Nothing below has been decided by silence. Each is designed to stay reversible.

**Facts only you can supply** (`OWNER_INPUTS_REQUESTED.md`):
- **OI-03(a)/(b)** — Massive plan tier; FMP DDLA existence. Gates D5 (member-facing licensing) and
  57 licensing-register rows.
- **OI-06** — one observed or narrated desk morning. Gates D1 (workspace final lock) and D2
  (command-grammar default) — the single highest-leverage input remaining.
- **OI-08 / OI-18** — Bloomberg / Gödel access. Validation-tier only; nothing in the architecture
  depends on either.
- **OI-21 (new this checkpoint)** — four read-only telemetry queries plus a `charts_workspace_
  layout` distribution query. Sharpens S6 Personalization's build order and A8's feed posture;
  blocks neither's baseline build.

**Decisions only you can make** (`OWNER_DECISIONS.md`):
- **D-002** (standing) — licensing exposure posture; proceeding on (b)+(c) provisionally.
- **D-003 (new this checkpoint)** — decisiveness for two audiences (register item D9). The
  research surfaces this tension but cannot resolve it; the architecture renders either answer as
  a configuration value.

Nothing else in the four Phase 2 documents or F-09 requires your input to proceed into further
design or technical-discovery work.

## 6. Remaining architectural uncertainties

Distinct from owner-bound items — these are open technical questions the architecture flagged
honestly rather than guessed at:

- Whether Massive/FMP API responses already carry a `figi` field (a live read, not a design
  question) — decides whether the Entity Master's external mapping is a zero-cost join or a new
  lookup.
- Whether FMP exposes XBRL-tag-level granularity a canonical fundamentals schema could map to
  directly.
- Whether Massive's Business-tier grant (if confirmed) reaches *derived works* (charts, breadth,
  composites) or only the underlying display — the one open licensing question that would block
  any new publication surface for UCT's own differentiated derived products (composites like
  UCT20 NAV, the Exposure Rating).
- **D13 — which of UCT's two existing regime classifiers is the one authority** for Breadth/Regime
  and the verdict gate (new, surfaced by Phase 2's design work, not previously known).
- Whether a market-calendar library (e.g. `pandas_market_calendars`) actually covers UCT's specific
  exchange mix.

## 7. Existing-codebase technical discovery now required

The Readiness Review's Part 8 assessment (most existing-system discovery already done via
D-01–D-14) stands. Phase 2 adds exactly one new item to that narrow list:

- **D13's regime-classifier comparison** — a direct read comparing the engine's `market_regimes`
  table output against the dashboard's own classifier output on the same historical dates. This is
  a targeted code/data comparison, not a research task, and should run before A11 (Breadth/Regime)
  or the Intelligence Layer's verdict gate move past design into specification.

Everything else Part 8 named (the Railway-flag-state broad read, RG-16/24/25/26/27) remains
accurate and unchanged by Phase 2.

## 8. Recommended Phase 3

Given the depth Phase 2 reached, Phase 3 is **narrow, targeted technical validation and functional
specification** — not another architecture pass, and explicitly not implementation:

1. **Close D13** (the regime-classifier comparison) and the handful of Part 8/RG technical-
   discovery items — cheap, fast, orchestrator-executable.
2. **PRD / functional specification**, scoped system-by-system against product-architecture.md's
   32-system decomposition, starting with the systems marked **LOCKED** in the decision register
   (D3 Entity Master, D4 Provider Abstraction, D6 Provenance, D7 Alerts) since those need no further
   owner input to specify precisely.
3. **Technical specification** for the same LOCKED systems, once the PRD exists for them.
4. Hold PRD/spec work on the **PROVISIONAL/OWNER-BOUND** systems (workspace final form, command-
   grammar default, the two audience-decisiveness branches, member-facing licensing surfaces) until
   OI-06 and OI-03(a)/(b) land — draft provisionally where the architecture already provides a
   working default, per each document's own PROVISIONAL markers.
5. Do **not** begin implementation sequencing (H) or prototypes beyond what's already named
   (the RG-27 popout spike, only if D1 moves) until the PRD/spec pass has produced something to
   sequence.

## 9. Exact implementation prerequisites

Before any application code changes, this program's own standard requires, at minimum:
- A PRD/functional spec for the specific system being implemented (not yet produced — Phase 3's
  job).
- A technical spec for that system, reviewed against this architecture (not yet produced).
- For any system touching a PROVISIONAL/OWNER-BOUND item, the relevant owner input actually landed
  (not a provisional default carried into implementation).
- Confirmation the protection rail still passes (empty app-code diff, production health) at the
  moment implementation begins — trivial to re-check, not yet done because nothing has changed.
- An explicit owner go-ahead for that specific implementation slice — this document does not
  request or assume one.

## 10. GO / CONDITIONAL GO / NO-GO

# CONDITIONAL GO — for Phase 3 (technical validation + functional/technical specification), NOT for implementation.

**Why:** Phase 2 produced a coherent, cross-validated architecture across product, interaction, and
data dimensions, with F-09 integrated and an adversarial pass that found and fixed six genuine
defects rather than rubber-stamping the work. Four of the original nine decisions are now
**LOCKED** with no counter-evidence found (D3 Entity Master, D4 Provider Abstraction, D6 Provenance,
D7 Alerts) — real, specifiable ground. Two are owner-bound and explicitly cannot lock without you
(D5 licensing, D9/D-003 decisiveness) — the architecture is designed so neither blocks the LOCKED
systems' specification work. The rest are evidence-recommended and reversible, gated on OI-06.

**Conditions:**
- Do not finalize any PRD/spec for a PROVISIONAL/OWNER-BOUND system ahead of its gating input.
- Close D13 (regime-classifier authority) before A11/the verdict gate move into specification.
- Continue treating OI-03(a)/(b), OI-06, OI-08, OI-18, OI-21, and D-003 as open — none are decided
  by this document or by your prior silence.

**Exact next action:** your explicit go-ahead for Phase 3 as scoped in §8 above. Not started.

**No application code has been touched. No implementation branch exists. No Phase 3 work has begun.**
