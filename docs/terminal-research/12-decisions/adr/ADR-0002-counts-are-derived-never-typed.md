---
id: ADR-0002
title: Every count is derived, and the command that produced it is printed
status: accepted
date: 2026-09-02, re-affirmed 2026-09-26
decided_by: programme
gate_item: 31
promotion: Locked: it is applied without exception in every deliverable drafted since, and the register does not carry method decisions.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0002 — Every count is derived, and the command that produced it is printed

**STATUS: ACCEPTED** · 2026-09-02, re-affirmed 2026-09-26 · decided by programme · gate item 31

**Why it is an ADR and not a tracker row:** Locked: it is applied without exception in every deliverable drafted since, and the register does not carry method decisions.

## Context

The estate's own documents repeatedly carried a hand-typed count beside the artifact it
described, and the count was wrong. Master checklist row 3 previously said 211 capability rows;
the ledger's own summary *measures* 178 (`grep -c '^| [A-P][0-9]'`), and the row was corrected as
*"the same defect class this program repeatedly flags elsewhere: a hand-typed count beside the
artifact it describes"* (`00-program-control/MASTER_CHECKLIST.md:9`;
`06-ux-and-information-architecture/information-architecture.md:29`).

## Decision

Every number in a programme artifact is **derived from the artifact it describes, and the
derivation is published beside it**. A number owned by another document is cited to that
document and never restated.

## Alternatives actually considered

1. **Restate counts for readability, correct them at review.** Rejected on evidence: a count
   stated in two places reads as corroboration and survives review. The COT router said "4
   routes" above a list of five; the single-writer index said FOUR above six; the setup catalog
   said 24 in a file holding 26.
2. **Omit counts.** Rejected: the shape of a set is frequently the finding — item 15's
   *"the quarantine (19) is larger than the moat (14)"* (`MASTER_CHECKLIST.md:21`).

## Consequences

* Counts in deliverables are grep- or parse-derived and say so: item 13's 45 jobs, item 14's 38
  workflows, item 15's 71 assets, item 29's 118 nodes / 109 edges
  (`MASTER_CHECKLIST.md:19,20,21,35`).
* ⛔ This set obeys it: every count in `ADR-INDEX.md` prints its command, including the
  count of ADRs and of superseded ADRs.

## Sources

- `00-program-control/MASTER_CHECKLIST.md:9,19,20,21,35`
- `06-ux-and-information-architecture/information-architecture.md:29`
