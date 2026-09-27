---
id: ADR-0014
title: Costs and usage are DE-SCOPED; licensing and permission remain fully in force
status: accepted
date: 2026-09-26
decided_by: the OWNER, verbatim
gate_item: 22, 23, 27, 34
promotion: Locked: an owner instruction that stands down a whole gate item. The only soft edge is the reading of its SCOPE, which the card states so it can be corrected in one line.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0014 — Costs and usage are DE-SCOPED; licensing and permission remain fully in force

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER, verbatim · gate item 22, 23, 27, 34

**Why it is an ADR and not a tracker row:** Locked: an owner instruction that stands down a whole gate item. The only soft edge is the reading of its SCOPE, which the card states so it can be corrected in one line.

## Context

The programme carried a cost model (gate item 34), a cost half of item 23, an AI cost-share
analysis (E-06) and an open seat-model question.

## Decision

⛔ **Owner, verbatim, 2026-09-26: "Dont worry aobut anything else on costs or uses."**
(`12-decisions/DECISION_CARDS_2026-09-26.md:676,708`)

No further cost modelling, spend estimation or usage-rate analysis. **This also closes the
seat-model question CARD 23 left open** (`:708`).

✅✅ **UPGRADED 2026-09-26 (CARD 30.3): the de-scoping of gate item 34 is now a DECISION,
not a reading.** CARD 26 §5 had recorded it as *a reading of* the owner's sentence; the owner
then said to make the calls, so *"it is now a decision, not a reading: item 34 is DE-SCOPED"*
(`12-decisions/DECISION_CARDS_2026-09-26.md:826`). ⚠️ **Licensing and permission work is
untouched and remains load-bearing** — *may this feed legally serve members* is a compliance
question, not a cost question (`:826`; ADR-0015).

⚠️ **The original scope reading, retained because it is what the upgrade ratified:**
it de-scopes **gate item 34 (Cost Model) and the cost half of item 23**, while leaving
**licensing and permission** work fully in force — *"can this feed legally serve members, and
whose advantage is it"* is a compliance question, not a cost question, and item 4's provider
ledger plus the licensing register remain load-bearing. **If item 34 is meant to be written
anyway, one sentence reinstates it.** (`:710`)

## Alternatives actually considered

1. **Read it as de-scoping licensing too.** Rejected on the compliance/cost distinction above.
2. **Read it as de-scoping only new cost work, keeping item 34.** Left as the correctable
   reading; the card says which way it went and what reverses it.

## Consequences

* ⛔ **No cost ADRs exist in this set.** The one cost-adjacent decision recorded is
  ADR-0021, and it is a **doctrine** (never downgrade a model for cost), not a number.
* Item 22's population-ceiling requirement (ADR-0020) survives as a *shape with no number in it*,
  because the owner's cost ceiling (OI-10) is Unknown and now de-scoped
  (`08-ai/ai-architecture.md:671`, point 2).
* ⚠️ The escalation threshold in `GOVERNING_PRINCIPLES.md:69` (new recurring spend
  above $250/month; any contract or vendor commitment regardless of amount) is **not** de-scoped
  by this — it governs *committing* spend, not *modelling* it.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:676,706-712`
- `08-ai/ai-architecture.md:671`
- `00-program-control/GOVERNING_PRINCIPLES.md:69`
