---
id: ADR-0036
title: S7 flip clause v3: `new_only == 0` is the safety clause; an excluded predicate must be DISPOSITIONED
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: n/a (S7 checkpoint)
promotion: Locked: a ruling with a stated reversal condition that is a named future reading, and it is the current bar. It is also the programme's cleanest demonstration of ADR-0033.
supersedes: ADR-0035's `legacy_only == 0` clause
superseded_by: none
register_row: none
---

# ADR-0036 — S7 flip clause v3: `new_only == 0` is the safety clause; an excluded predicate must be DISPOSITIONED

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item n/a (S7 checkpoint)

**Why it is an ADR and not a tracker row:** Locked: a ruling with a stated reversal condition that is a named future reading, and it is the current bar. It is also the programme's cleanest demonstration of ADR-0033.

**Supersedes:** ADR-0035's `legacy_only == 0` clause

## Context

CARD 1's flip clause required `legacy_only == 0` across the S7 population. The 2,344 count turned
out to be **one predicate, one span, five consecutive sessions ending 2026-09-18, no sessions
gained since, `agreed` 0 over the same window** — ≈469 evaluations a session,
**a tick cadence and not a delivery rate**
(`12-decisions/DECISION_CARDS_2026-09-26.md:398-406`).

⛔⛔ **So `legacy_only` there counts alerts a member would have been SPAMMED with, which
the new rule correctly declines to send** (`:406-408`).

⭐⭐ **`legacy_only == 0` is therefore not a safety bar. It is a bar that a correct fix
makes impossible to pass** — a rule that stops a spam loop will always show
`legacy_only > 0`, so the clause treats the product's best behaviour as its blocking defect
(`:410-414`).

## Decision — FLIP when all three hold

1. **`new_only == 0` across every type.** ⭐ *This is the real safety clause, and it has held
   on four consecutive reads.* An EXTRA alert is the direction that harms a member; a suppressed
   one is the direction the new rule exists to produce (`:418-420`).
2. **`legacy_only == 0` across every predicate STILL ACCUMULATING SESSIONS.** A predicate whose
   `sessions_covered` has not advanced in five trading sessions is excluded — **named in the
   flip packet, with its counter reported beside the exclusion rather than hidden by it**
   (`:421-423`).
3. **Every excluded predicate is DISPOSITIONED before the flip**, as one of *confirmed inactive*,
   *confirmed correct suppression*, or *unexplained*. ⛔ **An `unexplained` exclusion BLOCKS
   the flip** — that is what stops clause 2 becoming a way to ignore an inconvenient counter
   (`:424-426`).

**Reversal condition:** any `legacy_only > 0` on a predicate that IS still accumulating sessions,
which restores the original unrestricted bar immediately (`:437-438`).

## Alternatives actually considered

1. **Keep `legacy_only == 0` unrestricted.** Rejected — unreachable by a correct product.
2. **Drop the counter.** Rejected: clause 2 excludes rather than drops, and clause 3 makes the
   exclusion expensive. *"The new clause asks two questions, and the second is strictly harder to
   satisfy dishonestly, because an exclusion must be named and dispositioned rather than merely
   being a zero."* (`:429-431`)

## Consequences

* ⚠️ **What would settle the remaining doubt: `is_active` on that one row.** Three of the
  four fields are already in hand from the admin report — `is_trendline: false`,
  `level_kinds: ["price"]`, one span — and **the pod read stays refused and is no longer
  load-bearing** (`:433-435`; `:17-53`). That refusal is a permission boundary, not a decision:
  *"A user saying 'you decide' does not unblock a classifier"* (`:23-27`).
* ⭐ The whole chain ADR-0034 → ADR-0035 → ADR-0036 is one worked example of
  ADR-0033, and CARD 21 draws the comparison itself: *"exactly how the warm-ratio gate failed
  earlier in this programme (CARD 16)"* (`:414`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:17-53,394-438`
