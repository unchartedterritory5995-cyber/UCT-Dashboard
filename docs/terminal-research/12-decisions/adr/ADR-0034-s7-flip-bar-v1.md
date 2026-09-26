---
id: ADR-0034
title: S7 price-level CP4/FLIP bar v1: `legacy_only == 0` and `agreed ≥ 20` over ≥ 5 sessions
status: superseded
date: in force until 2026-09-25
decided_by: the programme (the S7 ledger)
gate_item: n/a (S7 checkpoint)
promotion: Promoted as the head of the clearest three-generation reversal chain in the programme. The chain is why the set exists.
supersedes: none
superseded_by: ADR-0035
register_row: none
---

# ADR-0034 — S7 price-level CP4/FLIP bar v1: `legacy_only == 0` and `agreed ≥ 20` over ≥ 5 sessions

**STATUS: SUPERSEDED** · in force until 2026-09-25 · decided by the programme (the S7 ledger) · gate item n/a (S7 checkpoint)

**Why it is an ADR and not a tracker row:** Promoted as the head of the clearest three-generation reversal chain in the programme. The chain is why the set exists.

⛔⛔ **SUPERSEDED BY ADR-0035 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

The S7 ledger's CP4 bar required `legacy_only == 0 and agreed ≥ 20 over ≥ 5 sessions`
before the new price-level evaluator's alerts could reach members
(`12-decisions/DECISION_CARDS_2026-09-25.md:39-41`).

## Decision as taken

Flip when `legacy_only == 0` and `agreed ≥ 20` over ≥ 5 sessions.

## Why it was retired

⛔ **It was a forecast, and the measured base rate falsifies it.** 1 agreed event across 12
ready predicates over 10 sessions ≈ **0.008 events per predicate-session**, so 20 events needs
on the order of **200+ sessions** on these fixtures — *"a measurement that cannot complete
(the 'longer than the gap between disturbances' class)."* Most fixtures are synthetic targets
30 %–5× from the market; **they will not cross** (`:41-45`).

## Consequences

* Superseded by ADR-0035.
* ⭐ It is the first instance of ADR-0033's doctrine in this programme, and CARD 11 later cited
  it by name as the trap it was re-cutting for the second time
  (`12-decisions/DECISION_CARDS_2026-09-26.md:90`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-25.md:11-63`
