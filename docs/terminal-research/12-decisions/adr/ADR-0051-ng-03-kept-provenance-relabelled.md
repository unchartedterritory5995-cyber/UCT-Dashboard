---
id: ADR-0051
title: NG-03 (no broker write path) is KEPT — and relabelled DERIVED, not owner-ruled
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation (integrator-ratified)
gate_item: 18
promotion: Locked: a rule kept and its PROVENANCE corrected, which is a decision about the register's own honesty rather than about the product. The row count is unchanged; the provenance column changes.
supersedes: NG-03's presentation as an owner-ruled non-goal
superseded_by: none
register_row: none
---

# ADR-0051 — NG-03 (no broker write path) is KEPT — and relabelled DERIVED, not owner-ruled

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation (integrator-ratified) · gate item 18

**Why it is an ADR and not a tracker row:** Locked: a rule kept and its PROVENANCE corrected, which is a decision about the register's own honesty rather than about the product. The row count is unchanged; the provenance column changes.

**Supersedes:** NG-03's presentation as an owner-ruled non-goal

## Context

Item 18 flagged NG-03 honestly as **its own extension** of `GOVERNING_PRINCIPLES.md` §13
rather than a cited ruling, and offered to demote it
(`12-decisions/DECISION_CARDS_2026-09-26.md:822`).

## Decision

✅ **Keep the rule.** A send-to-broker bridge is an order path under another name, and
ADR-0012's own reasoning is that **a bridge keeps the incumbent permanently in the loop, which is
the opposite of substitution** (`:822`).

⚠️ **But relabel it: DERIVED (integrator-ratified 2026-09-26), not owner-ruled.**
⛔ *"A register that blurs which rows the owner ruled and which were inferred is the
second-authority defect in a new costume, and item 18's own admissibility rule says that file may
not originate a non-goal."* **The row count stays 24; the provenance column changes** (`:822`).

## Alternatives actually considered

1. **Demote NG-03 and delete it.** Rejected — the rule is right; only its label was wrong.
2. **Leave it presented as owner-ruled.** Rejected on the sentence above.

## Consequences

* ADR-0049's edge 2 (no broker write path) rests on this row, and now rests on it with the correct
  provenance attached.
* ⭐ The general form, and it generalises past this row: **a register must distinguish what the
  owner ruled from what an integrator inferred, or an inference acquires the owner's authority by
  adjacency.** Compare ADR-0008, where an unread owner document was overwritten by a default; this
  is the mirror failure — a default acquiring owner status.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:820-822`
- `00-program-control/GOVERNING_PRINCIPLES.md:78`
- `05-product-strategy/non-goals.md` (NG-03)
