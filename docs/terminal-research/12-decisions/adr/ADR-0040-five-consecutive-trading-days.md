---
id: ADR-0040
title: The MVP span is a run of at least five consecutive trading days (SM-11)
status: superseded
date: in force until 2026-09-26
decided_by: the programme (SM-11, a defaultable ruling)
gate_item: 27
promotion: Promoted as a SUPERSEDED record. It was a published default inside an accepted deliverable, defended there on a stated reason, and the reason was wrong in a way worth preserving.
supersedes: none
superseded_by: ADR-0039
register_row: none
---

# ADR-0040 — The MVP span is a run of at least five consecutive trading days (SM-11)

**STATUS: SUPERSEDED** · in force until 2026-09-26 · decided by the programme (SM-11, a defaultable ruling) · gate item 27

**Why it is an ADR and not a tracker row:** Promoted as a SUPERSEDED record. It was a published default inside an accepted deliverable, defended there on a stated reason, and the reason was wrong in a way worth preserving.

⛔⛔ **SUPERSEDED BY ADR-0039 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

SM-11 supplied the missing field of the charter's MVP sentence: who decides *"we prefer it"*, and
in what form. Its default: *"a dated sentence naming (a) the workflow, (b) the external tool it
displaced, and (c) the span, default ≥ 5 consecutive trading days"*
(`10-roadmap/success-metrics.md:540`).

## Decision as taken

A run of at least five consecutive trading days, defended on the ground that **5 trading days is
one full week, matching the span every S7 dark bar in this programme already uses, so it
introduces no new number** (`success-metrics.md:540`).

## Why it was retired

⛔ **It is a conjunction of five events that a HEALTHY product fails** whenever the workflow
legitimately is not wanted: a holiday, travel, no setup that morning. **That is ADR-0036's defect
exactly** — a bar whose failure mode is the product behaving correctly — and the same
author had ruled on ADR-0036 *hours before proposing it*
(`12-decisions/DECISION_CARDS_2026-09-26.md:497-506`).

⭐ **And the defence was the weak point:** *"'Introduces no new number' is a fine reason for a
display constant and a bad one for a statistical parameter."* (`:506`)

## Consequences

* Superseded by ADR-0039: **K of N ELIGIBLE OCCASIONS**, where K and N are derived from a
  **baseline phase that first measures how often the workflow occurs at all**. *"A rate needs a
  denominator somebody measured, not a span somebody liked."* (`:508-510`)
* ✅ `10-roadmap/success-metrics.md:540` carries the supersession in place, so the accepted
  document and this record agree.
* ⭐ SM-11 also said of itself that it *"should be deleted the day OI-02 is answered rather
  than reconciled with it"* — a self-expiring default, which is the right shape even though
  the number was wrong (`success-metrics.md:540,559`).

## Sources

- `10-roadmap/success-metrics.md:540,559`
- `12-decisions/DECISION_CARDS_2026-09-26.md:497-510`
