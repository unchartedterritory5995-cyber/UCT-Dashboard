---
id: ADR-0008
title: Two paid tiers and no free tier
status: superseded
date: 2026-09-26 (ruled and overturned the same day)
decided_by: the programme, as a defaultable ruling
gate_item: 23, 27
promotion: Promoted as a SUPERSEDED record. It was a real ruling, published, and acted on downstream for part of a day; an ADR set that shows only the replacement cannot stop it being re-proposed.
supersedes: none
superseded_by: ADR-0009
register_row: none
---

# ADR-0008 — Two paid tiers and no free tier

**STATUS: SUPERSEDED** · 2026-09-26 (ruled and overturned the same day) · decided by the programme, as a defaultable ruling · gate item 23, 27

**Why it is an ADR and not a tracker row:** Promoted as a SUPERSEDED record. It was a real ruling, published, and acted on downstream for part of a day; an ADR set that shows only the replacement cannot stop it being re-proposed.

⛔⛔ **SUPERSEDED BY ADR-0009 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

S9 (entitlements) needed a tier shape to design against. The evidence in hand was:
the free-page whitelist is one page, everything else already gates server-side, and A14's shipped
door is paid-gated the normal way (`12-decisions/DECISION_CARDS_2026-09-26.md:238-242`).

## Decision as taken (WRONG)

*"Two paid tiers and no free tier, with Terminal-Next entirely inside the existing paid
boundary."* (`DECISION_CARDS_2026-09-26.md:229`)

## Why it was wrong — two separate failures, and the second is the expensive one

1. ⛔ **None of the cited evidence spoke to how many PAID tiers there are. A second tier was
   inferred from nothing** (`:241-242`).
2. ⚰️⚰️ **The answer was already in this programme's own charter and was not
   read.** `00-program-control/charter/OWNER_SEED_FACTS.md:61`, §6, dated **2026-09-01**
   — twenty-five days before the default was taken — reads *"one paid tier whose
   paywalled item is the Morning Wire, with a $7 weekly promo."* It was found by the
   gate-item-13 author while sourcing displacement evidence (`:244`).

⭐ **So the owner did not overturn a defensible default — he restored a fact the
programme had drifted off** (`:246`).

## The rule this failure produced (binding on every future default)

> *"Any future defaultable ruling states which owner-input documents were searched before it
> defaults — a default over an unread answer is not a default, it is an overwrite."*
> (`:246`)

## Consequences

* Superseded by ADR-0009 the same day.
* ⚰️⚰️ The second half of the same seed-fact line then sent the author down a
  false trail, published in four artifacts as *"two price artifacts disagree in kind, neither
  owner-ratified"* — closed by the owner in one sentence and recorded as ADR-0010
  (`:248`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:227-249`
- `00-program-control/charter/OWNER_SEED_FACTS.md:61`
