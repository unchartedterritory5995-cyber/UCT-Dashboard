---
id: ADR-0013
title: Full substitution is bounded at execution — a workflow ending in "place the trade" is a STRUCTURAL break-out
status: accepted
date: 2026-09-26 (consequence of a standing default dated 2026-09-01)
decided_by: the programme, recording the boundary the owner's thesis runs to
gate_item: 13, 14, 27
promotion: Locked: the standing default is a charter fact, and the consequence — that a break-out is structural rather than a coverage failure — is now a field in an accepted deliverable. ⚠️ The card is explicit that the ceiling is a CONSEQUENCE recorded, not a ruling, and the owner may move it.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0013 — Full substitution is bounded at execution — a workflow ending in "place the trade" is a STRUCTURAL break-out

**STATUS: ACCEPTED** · 2026-09-26 (consequence of a standing default dated 2026-09-01) · decided by the programme, recording the boundary the owner's thesis runs to · gate item 13, 14, 27

**Why it is an ADR and not a tracker row:** Locked: the standing default is a charter fact, and the consequence — that a break-out is structural rather than a coverage failure — is now a field in an accepted deliverable. ⚠️ The card is explicit that the ceiling is a CONSEQUENCE recorded, not a ruling, and the owner may move it.

## Context

CARD 12's aggregation thesis (ADR-0012) invites the question *"can a member place the trade
here?"*, so the boundary had to be named before a coverage ledger could be honest.

## Decision

⛔⛔ **"Only use our site" cannot include placing the trade.** A standing governing
default is **no execution and no order management**
(`00-program-control/GOVERNING_PRINCIPLES.md:78`, from
`00-program-control/charter/OWNER_SEED_FACTS.md:75`), and item 13's
*"structurally undisplaceable"* row is **thinkorswim precisely because it is inseparable from a
funded brokerage account**. So full substitution is achievable for **research and analysis** and
structurally bounded at **execution** (`12-decisions/DECISION_CARDS_2026-09-26.md:686-688`).

⭐ **The recording rule this produces:** a workflow ending in "place the trade" leaves our
site **by design**, and must be recorded as a **STRUCTURAL break-out** rather than counted as a
coverage failure somebody could fix (`:690`).

## Alternatives actually considered

1. **Count the break-out as a coverage gap.** Rejected: it makes the coverage ledger permanently
   and unfixably red, which is how a ledger gets ignored.
2. **Propose execution.** ⚠️ Explicitly not done. *"Moving that boundary is an owner
   decision and nothing in this programme proposes it."* (`:690`)

## Consequences

* Item 14's BREAK-OUT POINT field classes order placement STRUCTURAL by this default, and 14 of
  38 workflows STRUCTURAL overall (`00-program-control/MASTER_CHECKLIST.md:20`).
* Item 13's *"structurally undisplaceable"* verdict on thinkorswim is not a research failure and
  no feature can retire it (`:684`, `MASTER_CHECKLIST.md:19`).
* The same shape applies to two licensing rows carried forward: **LIC-06** (*"no terms document
  exists at all"*) and **LIC-08** (*"no purchasable remedy at any price"*). *"A gap with no
  purchasable remedy is a permanent product boundary, like the no-execution ceiling — not a
  backlog item."* (`:750`)
* ⭐⭐ **BOUNDED 2026-09-26 by ADR-0049, and the boundary is narrower than a reader would
  assume: §13 governs ORDER FLOW, and HISTORICAL BACKTESTING is IN CHARTER.** *"No order
  exists at any point, so there is nothing for 'no execution or order management' to attach to"*
  — and a backtest already ships, mounted and member-facing
  (`12-decisions/DECISION_CARDS_2026-09-26.md:794,788`). ⛔ **Do not cite this ADR as barring
  computation over past data.** The four edges that remain barred are ADR-0049's.
* ⚠️ Status note: the card labels this a *consequence recorded here, not a ruling*
  (`:712`). It is promoted because the consequence has been acted on in an accepted deliverable.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:686-690,712,750`
- `00-program-control/GOVERNING_PRINCIPLES.md:78`
- `00-program-control/charter/OWNER_SEED_FACTS.md:75`
- `00-program-control/MASTER_CHECKLIST.md:19,20`
