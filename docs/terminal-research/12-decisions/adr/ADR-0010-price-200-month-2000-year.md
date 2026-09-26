---
id: ADR-0010
title: UCT Intelligence is $200/month or $2,000/year; the $7/week is a different product
status: accepted
date: 2026-09-26
decided_by: the OWNER
gate_item: 13, 23, 27
promotion: Locked hard: an owner ruling on his own product's price, explicitly *"Reversal condition: none"*.
supersedes: the published claim that "the programme has two contested prices, neither owner-ratified" (four artifacts: CARD 17, MASTER_CHECKLIST row 13, OWNER-ACTIONS §4, and a brief to two agents)
superseded_by: none
register_row: none
---

# ADR-0010 — UCT Intelligence is $200/month or $2,000/year; the $7/week is a different product

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER · gate item 13, 23, 27

**Why it is an ADR and not a tracker row:** Locked hard: an owner ruling on his own product's price, explicitly *"Reversal condition: none"*.

**Supersedes:** the published claim that "the programme has two contested prices, neither owner-ratified" (four artifacts: CARD 17, MASTER_CHECKLIST row 13, OWNER-ACTIONS §4, and a brief to two agents)

## Context

One seed-fact sentence — `00-program-control/charter/OWNER_SEED_FACTS.md:61`, *"one paid tier
whose paywalled item is the Morning Wire, with a $7 weekly promo"* — spliced a **UCT
Intelligence tier statement** and a **different product's promo price** into one sentence. Every
downstream reading inherited the splice, and it was published in four places as a contradiction
(`12-decisions/DECISION_CARDS_2026-09-26.md:633-635`).

## Decision

✅✅ **There was never a price contradiction — there are two products**
(`:626`).

* **UCT Intelligence — $200/month or $2,000/year.** Owner-ratified. Corroborated by
  `app/src/pages/Pricing.jsx`, whose docstring records it as the *"owner-approved strategy"* of a
  dated **2026-07-11 premium reposition**: one plan, everything unmetered, **two months free** on
  the annual, a **7-day free trial with card required**, one-click cancel, no free tier on the
  marketing pages (`:628`).
* **The $7/week is the Whop plan — a SEPARATE PRODUCT** (a live-trading Discord), merely
  *promoted* through the wire's Substack. First-hand from the code that renders it,
  `morning-wire/substack/promo.py`: *"The Whop plan is one WEEK for $7 — 'month' shipped in
  the copy for a while and was false."* (`:629`)

⭐ **The monthly needed no guess.** The owner typed the annual unambiguously as $2,000/year
and mistyped the monthly as "$00". `$2,000 / (12 − 2 months free) = $200`, which is exactly
what the code says — so the monthly is **derivable from the owner's own annual figure plus
the code's two-months-free term** (`:631`).

## Alternatives actually considered

1. **Treat the two figures as a live contradiction and escalate.** That is what was published,
   and it was wrong: the figures were never about one product.
2. **Ask the owner to confirm the monthly.** Rejected as unnecessary once the arithmetic closed
   against the code (`:631`).

## Consequences

* ⭐ **One document had it right the whole time**, which is the part worth learning from:
  `09-security-licensing-cost/cost-model-data.md:290` already recorded *"the wire promo is $7 for
  one week (`morning-wire/substack/promo.py:68`)"* — a promo, with a period, cited to its
  source. ⛔ *"So 'the programme has two contested prices' was my generalisation from the
  seed-fact line, not a fact about the programme"*, published in four places before checking
  whether any document had already resolved it (`:635`).
* ✅ **The cost model did not err.** `cost-model-ai-infra.md:36` ran both branches
  explicitly. What this ruling does to it is narrow: the $30 ARPU floor loses one of its three
  supports (the $7 promo was never this product's ARPU) and keeps the two genuine competitor
  comparables — Benzinga Basic $30.58 and Unusual Whales Basic $34 annual-effective.
  ⛔ **The $30 branch survives as a COMPETITOR floor and must never again be labelled as
  UCT's own** (`:637`).
* ⚠️ **Still open, still the owner's: the seat model.** (`:639`) — then de-scoped
  by ADR-0014. The trial is answered by the same code docstring (7 days, card required).
* `GOVERNING_PRINCIPLES.md:78` was corrected in place to carry this ruling.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:624-643`
- `00-program-control/charter/OWNER_SEED_FACTS.md:61`
- `00-program-control/GOVERNING_PRINCIPLES.md:78`
- `09-security-licensing-cost/cost-model-data.md:290`
