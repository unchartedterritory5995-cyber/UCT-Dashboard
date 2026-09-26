---
id: ADR-0050
title: The unit of account: JOBS carry the verdict, FEATURES carry the evidence
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: 9, 10, 18
promotion: Locked: a ruling on the unit two accepted deliverables disagreed about, decided because *"several rows FLIP VERDICT between the two units"*. Its reversal condition is a re-aggregation of an existing table, not a rewrite — which is itself part of the decision.
supersedes: the implicit use of FEATURES as the verdict unit in a coverage ledger
superseded_by: none
register_row: none
---

# ADR-0050 — The unit of account: JOBS carry the verdict, FEATURES carry the evidence

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item 9, 10, 18

**Why it is an ADR and not a tracker row:** Locked: a ruling on the unit two accepted deliverables disagreed about, decided because *"several rows FLIP VERDICT between the two units"*. Its reversal condition is a re-aggregation of an existing table, not a rewrite — which is itself part of the decision.

**Supersedes:** the implicit use of FEATURES as the verdict unit in a coverage ledger

## Context

Gate item 18 adopted *best MECHANISM per JOB*; gate item 9 headlined JOBS and built an 80-row
named-feature table underneath, **and found that several rows FLIP VERDICT between the two units**
— *"which is what made this worth deciding rather than leaving implicit"*
(`12-decisions/DECISION_CARDS_2026-09-26.md:806`).

## Decision

**JOBS carry the verdict. FEATURES carry the evidence.**

⭐ **The decisive argument is the owner's own success test.** ADR-0012 states the goal as
*"someone can only use our site"* — a claim about whether a person can **FINISH**, which is a
property of a completed task, not of a feature checklist. *"Nobody keeps a tab open for a feature;
they keep it open for a step they cannot complete here."* So the verdict layer must be the job
(`:810`).

⛔ **And a feature-unit ledger fails in BOTH directions, which a job-unit one does not**
(`:812-814`):

* It would let us **claim coverage while a member still breaks out** — we ship "a chart", so
  the cell reads COVERED, while the one step they need is missing.
* It would let us **report a gap where none exists** — a competitor's named feature we achieve
  by a different mechanism reads as absent. **That is the error that produced two withdrawn rows in
  item 14 and five false absence claims in item 9's inputs.**

**And one requirement on every document:** ⛔ **state which unit its headline counts, in one
line, at the top** — *"an implicit unit is how a number comes to mean something different to
its next reader"* (`:818`).

## Alternatives actually considered

1. **Features as the verdict unit.** Rejected on the two-direction failure above, and separately
   because a one-for-one feature copy *"would violate the charter's no-Frankenstein clause by
   construction"* (`:816`; `00-program-control/GOVERNING_PRINCIPLES.md:60`).
2. **Rework items 18 and 9 onto one unit.** ✅ Unnecessary: *"items 18 and 9 both STAND AS
   WRITTEN and there is no rework"* (`:818`).

## Consequences

* ⭐ **Features staying as the EVIDENCE layer is not a compromise — it is what makes the
  ruling cheap to reverse.** Item 9 §2.2's 80 competitor features are named verbatim and keyed
  to job rows, so a feature-level recount is a **re-aggregation of an existing table, not a
  rewrite**; and a marketing-facing parity view needs no new work (`:816`).
* **Reversal condition:** an owner sentence preferring literal feature parity; the recount is then
  a re-aggregation of item 9 §2.2 and nothing is rewritten (`:818`).
* This is the unit ADR-0012's coverage constraint and ADR-0013's BREAK-OUT POINT field are both
  measured in — item 14's per-workflow break-out classes are job-shaped, not feature-shaped
  (`00-program-control/MASTER_CHECKLIST.md:20`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:804-818`
- `00-program-control/GOVERNING_PRINCIPLES.md:60`
- `00-program-control/MASTER_CHECKLIST.md:20`
