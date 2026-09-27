---
id: ADR-0048
title: A14 Portfolio & Risk is out of this programme — a scope statement, not a deferral
status: accepted
date: 2026-09-25
decided_by: the programme under owner delegation
gate_item: n/a (roadmap scope)
promotion: Locked: a scope ruling with a named re-open trigger, and the card is explicit that it is a scope statement rather than a deferral — a distinction that decides whether anyone plans around it.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0048 — A14 Portfolio & Risk is out of this programme — a scope statement, not a deferral

**STATUS: ACCEPTED** · 2026-09-25 · decided by the programme under owner delegation · gate item n/a (roadmap scope)

**Why it is an ADR and not a tracker row:** Locked: a scope ruling with a named re-open trigger, and the card is explicit that it is a scope statement rather than a deferral — a distinction that decides whether anyone plans around it.

## Context

A14's member door exists — `/portfolio-heat`, A14 CP1, live since 2026-09-21 — and is the
whole of what the roadmap authorised
(`12-decisions/DECISION_CARDS_2026-09-25.md:118-124`).

## Decision

**Out of this programme, and that is a scope statement, not a deferral.** Everything beyond the
shipped door is gated on **S9 Entitlements** (not built — a business decision about tiers) and
on **D8** (a portfolio-risk deferral the owner made). *"Neither is a build item and neither is
improved by an agent guessing at it."* (`:120-124`)

**Re-open trigger:** an entitlements decision (tiers exist and S9 gets a gate), or D8 lifted in
writing (`:126-127`).

## Alternatives actually considered

1. **Defer it to a later wave.** Rejected in favour of the stronger statement: a deferral invites
   planning around a date, and there is no date.
2. **Scope it now against an assumed tier shape.** Rejected — guessing at S9 is guessing at
   the owner's business decision.

## Consequences

* ✅ **The entitlements half of the gate moved after this card.** ADR-0009 settles that there
  is **one paid tier**, and ADR-0022 records the entitlement mechanism as designed with the tier
  axis collapsing to a binary. ⚠️ That does not by itself re-open A14: the trigger names
  *"tiers exist and S9 gets a gate"*, and S9 is still not built.
* ✅ **D8's half also moved, in the other direction.** The register records DEC-08 as
  **CONFIRMED NEEDED 2026-09-20** (owner, direct: *"Yes, we need it daily"*) — no longer a
  deferral, but *"CONFIRMED NEEDED, NOT YET SCOPED"*, and A14 *"inherits this unblock … but
  still needs a scoping pass"*, plus F-09's provider gap: a genuine corporate-actions event
  calendar beyond splits/dividends **has no data provider today**
  (`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:119-137`). ⛔ **The register is the
  authority for that row; this ADR only records that the two halves of A14's gate have moved
  independently and neither has closed.**
* ⚠️ So a reader who checks only this card will conclude A14 is dormant; a reader who
  checks only the register will conclude it is wanted. **Both are true, and that is exactly the
  shape this ADR exists to make visible.**

## Sources

- `12-decisions/DECISION_CARDS_2026-09-25.md:118-127`
- `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:119-137,276`
