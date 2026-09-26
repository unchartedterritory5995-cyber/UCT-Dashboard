---
id: ADR-0033
title: A bar a healthy system fails gets waived: re-cut it — and a re-cut must QUOTE THE READING THAT FAILED
status: accepted
date: 2026-09-26
decided_by: the programme (three-reviewer panel, adopted under owner delegation)
gate_item: 18, 24, 25, 27
promotion: Locked: it is the doctrine three separate re-cuts in this programme were performed under, plus an anti-waiver clause the panel produced that binds every future re-cut. It governs ADR-0031/0032, ADR-0034–0038 and ADR-0039/0040.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0033 — A bar a healthy system fails gets waived: re-cut it — and a re-cut must QUOTE THE READING THAT FAILED

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (three-reviewer panel, adopted under owner delegation) · gate item 18, 24, 25, 27

**Why it is an ADR and not a tracker row:** Locked: it is the doctrine three separate re-cuts in this programme were performed under, plus an anti-waiver clause the panel produced that binds every future re-cut. It governs ADR-0031/0032, ADR-0034–0038 and ADR-0039/0040.

## Context

Three bars in this programme were retired within one week, and all three failed the same way:

| bar | the healthy behaviour that failed it |
|---|---|
| the warm-ratio gate (ADR-0031) | a member served from cache in 104 ms |
| the S7 flip clause `legacy_only == 0` (ADR-0036) | a rule that correctly stops a spam loop **always** shows `legacy_only > 0` |
| *"a run of at least five consecutive trading days"* (ADR-0040) | a holiday, travel, or simply no setup that morning |

## Decision

1. ⭐⭐ **A gate a healthy system fails is a gate that gets waived.** *"A bar that treats
   correct suppression as a defect is measuring the wrong direction"*
   (`12-decisions/DECISION_CARDS_2026-09-26.md:53`), and *"a bar whose failure mode is the product
   behaving correctly"* is the defect's general form (`:504`).
2. **A bar must be reachable by the instrument that measures it.** CARD 11 re-cut the
   scan-membership bar for exactly this: *"the bar needs membership movement … which is
   unbounded in sessions. This is the same trap CARD 1's original `agreed ≥ 20` bar had, and
   it was already re-cut once for exactly this reason"* (`:90`).
3. ⛔⛔ **THE ANTI-WAIVER CLAUSE, and it is the sharpest thing the panel produced: a
   re-cut of a bar must QUOTE THE READING THAT FAILED.** *"Without that, 'we re-cut the bar' and
   'we failed and moved it' are the same sentence, and this card would otherwise be the precedent
   that makes the next waiver easy."* (`:539-543`)
4. **"Introduces no new number" is a fine reason for a display constant and a bad one for a
   statistical parameter** (`:506`).
5. **`n` is reported as `n`, always** — a flip packet says *"1 real-member fire"*, never
   *"verified"* (`:106-108`).

## Alternatives actually considered

1. **Hold the bar and wait.** Rejected where the wait cannot complete: CARD 1 measured 0.008
   agreed events per predicate-session, so `agreed ≥ 20` needed on the order of **200+
   sessions** on those fixtures — *"a measurement that cannot complete"*
   (`12-decisions/DECISION_CARDS_2026-09-25.md:39-45`).
2. **Waive the bar case by case.** Rejected — that is the failure this doctrine exists to
   prevent, and clause 3 is what makes it detectable.
3. **Lower the bar.** Each re-cut argues explicitly that it is not lowering: CARD 11's coverage
   moved to the arming side and *"what the fires must still prove is that the new rule loses
   nothing"* (`:103-108`); CARD 21's new clause *"asks two questions, and the second is strictly
   harder to satisfy dishonestly, because an exclusion must be named and dispositioned rather than
   merely being a zero"* (`:429-431`).

## Consequences

* ⛔ **A re-cut that does not quote its failing reading is indistinguishable from a waiver.**
  Applied to this set: ADR-0032 quotes *"daily is 0 % warm and p50 104 ms at the same time"*;
  ADR-0036 quotes the 2,344/one-predicate/one-span reading; ADR-0039 quotes 4 rows / 2 users and
  4 rows / 1 user.
* ⚠️ **The doctrine is dangerous in the other direction and the panel said so.** This
  programme *"has precedent for retiring a bar it fails and calling it a correction — CARD 16
  and CARD 21 are both that move, and both were right"* (`:539-541`). The clause is what keeps the
  precedent from being free.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:39-53,82-111,203-224,394-438,497-543`
- `12-decisions/DECISION_CARDS_2026-09-25.md:39-53`
