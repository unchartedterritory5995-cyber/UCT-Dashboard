---
id: ADR-0012
title: The product thesis is AGGREGATION toward full substitution, so COVERAGE is the binding constraint
status: accepted
date: 2026-09-26
decided_by: the OWNER, verbatim
gate_item: 9, 10, 13, 15, 27
promotion: Locked hard: *"Reversal condition: none on the thesis — it is the owner's statement of what his product is for."* It also re-ranks accepted deliverables, which a tracker row cannot do.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0012 — The product thesis is AGGREGATION toward full substitution, so COVERAGE is the binding constraint

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER, verbatim · gate item 9, 10, 13, 15, 27

**Why it is an ADR and not a tracker row:** Locked hard: *"Reversal condition: none on the thesis — it is the owner's statement of what his product is for."* It also re-ranks accepted deliverables, which a tracker row cannot do.

## Context

Every capability document in the programme had been written as if the valuable capability were the
one nobody else has.

## Decision

⭐⭐ **Verbatim, 2026-09-26: "the goal is to aggreagte all the best features so someone
can only use our site instead of the others."**
(`12-decisions/DECISION_CARDS_2026-09-26.md:674`)

⛔ **This inverts how every capability document should be read.** Under a differentiation
thesis the valuable capability is the rare one. Under an aggregation thesis the binding constraint
is **COVERAGE**, and the arithmetic is unforgiving: **any capability a competitor has and we lack
is a reason a member keeps another tab open, so ONE missing feature can defeat a hundred
proprietary ones** (`:680`).

## Alternatives actually considered

1. **Differentiation — proprietary depth decides.** Rejected by the owner's sentence. The
   consequence is a re-ranking, not new work: *"proprietary depth (item 15) stops being the thing
   that decides whether the goal is met, and gap coverage becomes it"* (`:682`).
2. **Benchmark parity.** Not the thesis, and explicitly barred elsewhere:
   *"Workflow superiority for the UCT niche, not benchmark parity"*
   (`00-program-control/GOVERNING_PRINCIPLES.md:60`). Aggregation of *the best features* is not
   the same as matching a feature list.

## Consequences

* **Item 9 (Cross-Product Capability Matrix) is now the single most goal-aligned not-started
  deliverable in the programme** — it is the coverage-gap ledger this thesis requires. Item
  10 (Best-of-Breed Matrix) is its other half (`:682`).
* ⚠️ **It RAISES item 13's bar rather than lowering it.** Item 13 verdicted five desk
  tools: one absorb-outright, two harden/bridge, one structurally undisplaceable, one never
  studied. Under *"someone can only use our site"*, **a harden/bridge verdict is not a success
  state** — a bridge keeps the incumbent in the loop permanently, the opposite of
  substitution. The verdicts stand as *measurements*; three of five now read as **unmet**, not as
  *done differently* (`:684`).
* Item 14 built the field this thesis needs and nothing else in the programme produces: a
  per-workflow **BREAK-OUT POINT** — where the flow leaves our site and for what —
  classed NONE 5 / ADDRESSABLE 7 / STRUCTURAL 14 / NOT MEASURED 1 / N/A 11, summing to 38 by
  construction so a missing field is catchable by one addition
  (`00-program-control/MASTER_CHECKLIST.md:20`).
* Licensing gets **more** important, not less: almost everything this product would aggregate is
  a derived work (`:730`). See ADR-0015.
* The ceiling the thesis runs to is ADR-0013.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:672-712`
- `00-program-control/MASTER_CHECKLIST.md:19,20`
- `00-program-control/GOVERNING_PRINCIPLES.md:60`
