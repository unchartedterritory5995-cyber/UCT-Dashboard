---
id: ADR-0038
title: S7 scan-membership bar v2: one fire on a definition the smoke account does not own
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: n/a (S7 checkpoint)
promotion: Locked: a ruling whose reversal condition is a named future reading, and it is the current bar.
supersedes: ADR-0037
superseded_by: none
register_row: none
---

# ADR-0038 — S7 scan-membership bar v2: one fire on a definition the smoke account does not own

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item n/a (S7 checkpoint)

**Why it is an ADR and not a tracker row:** Locked: a ruling whose reversal condition is a named future reading, and it is the current bar.

**Supersedes:** ADR-0037

## Decision — FLIP when all hold

1. **The smoke predicate reaches `verdict_ready` with `legacy_only == 0` and `new_only == 0`**
   — **met at the 2026-09-26 tick** (sessions 09-22…09-25, agreed 4, floor 5)
   (`12-decisions/DECISION_CARDS_2026-09-26.md:94-95`).
2. **At least one fire on a definition the smoke account does not own** — i.e. one real
   member's screen actually moves — with `legacy_only == 0` on it. **One fire, not five
   sessions of them** (`:96-98`).
3. **`arming_census.armed_but_never_compared` is reported, and non-empty is acceptable** — a
   silent armed definition is no longer invisible (named in the dark report as of `4885dadc2`), so
   it stops being a reason to wait (`:99-101`).

**Reversal condition:** any `legacy_only > 0` on any definition, which returns this to a
full-coverage bar (`:110-111`).

## Alternatives actually considered

1. **Keep the ≥ 3 definitions / ≥ 2 members coverage clause.** Rejected because coverage
   is now **measured on the arming side** (4 subs, 2 members, 3 definitions) instead of inferred
   from fires (`:103-106`).
2. **Wait for five sessions of real-member fires.** Rejected as unbounded (ADR-0037).

## Consequences

* ⛔ **Why this is not lowering the bar:** *"What the fires must still prove is that the new
  rule loses nothing, and one fire with `legacy_only == 0` proves that on a real member's
  definition. `n` is reported as `n`, always — a flip packet on this bar says '1 real-member
  fire', never 'verified'."* (`:103-108`)
* The real-member arming that makes this measurable was completed 2026-09-25 through the
  Screener's own bell buttons: **26wk HV**, **Above 50 on volume**, **Oops Reversal**, read back
  as exactly three, `mode: both` (`12-decisions/DECISION_CARDS_2026-09-25.md:75-79`).
* **`catalyst-match` is the next S7 increment** on evidence (58 predicates, 58 verdict-ready, 80
  agreed, zero `new_only`/`legacy_only`/`not_comparable`) — an **evidence-complete candidate,
  not a flip authorisation**, with two gates it has not passed: the filing-watch parity test and
  §2a's mandatory checklist (`12-decisions/DECISION_CARDS_2026-09-26.md:57-78`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:57-78,82-111`
- `12-decisions/DECISION_CARDS_2026-09-25.md:67-85`
