---
id: ADR-0009
title: ONE paid tier. No free tier. No second paid tier.
status: accepted
date: 2026-09-26
decided_by: the OWNER, verbatim
gate_item: 23, 27, 29
promotion: Locked hard: an owner ruling with NO reversal condition — *"changing it needs a new owner instruction"*. This is the clearest post-2026-09-02 lock in the programme.
supersedes: ADR-0008
superseded_by: none
register_row: none
---

# ADR-0009 — ONE paid tier. No free tier. No second paid tier.

**STATUS: ACCEPTED** · 2026-09-26 · decided by the OWNER, verbatim · gate item 23, 27, 29

**Why it is an ADR and not a tracker row:** Locked hard: an owner ruling with NO reversal condition — *"changing it needs a new owner instruction"*. This is the clearest post-2026-09-02 lock in the programme.

**Supersedes:** ADR-0008

## Context

The programme had drifted off a seed fact dated 2026-09-01 and defaulted to two paid tiers
(ADR-0008). The owner corrected it.

## Decision

✅ **The owner's ruling, verbatim, 2026-09-26: "there is one paid tier only that is it."**
(`12-decisions/DECISION_CARDS_2026-09-26.md:232`)

**One paid tier. No free tier. No second paid tier. Terminal-Next sits inside that single paid
boundary.** This is an owner decision, not a delegated determination, so **it carries no reversal
condition** (`:234-236`).

## Alternatives actually considered

1. **Two paid tiers** — ADR-0008, vetoed.
2. **A free tier** — also excluded. The code's own state corroborates: the Morning Wire is
   the only free page (`AuthGuard.jsx` `FREE_PAGES = ['/morning-wire']`) and every other route is
   paid-gated server-side (`00-program-control/GOVERNING_PRINCIPLES.md:78`, DL-010).

## Consequences — each one forecloses work

1. ⛔ **No tier-comparison surface, ever.** No pricing table, no upgrade affordance, no
   locked-behind-a-higher-tier state, no per-tier entitlement rows. *"A design leaving room for a
   second tier is carrying dead weight."* (`:252-254`)
2. ⭐ **The entitlement architecture is SIMPLER than gate item 23 assumed and survives
   anyway.** That document was deliberately written to express *a* tier boundary rather than a
   count, so its tier axis now **collapses to a binary**: paid or not.
   *"Re-read it with that in mind rather than rewriting it."* (`:255-258`)
3. **The dark-cohort ladder is unaffected. Cohorts are not tiers.** A named cohort inside the
   single paid tier is still how Terminal-Next ships dark (`:259-260`).
4. ⚠️ **Still undecided and still not the programme's: price, trial, seat model.** One
   paid tier says nothing about what it costs (`:261-262`). Price was settled separately —
   ADR-0010; the seat model was then de-scoped — ADR-0014.
5. ⛔ **The free-page choice now carries more weight.** With a single paid tier the paywall is
   one binary line, so *which* page is free is the only remaining lever on acquisition — a
   marketing decision, deliberately untouched (`:264-266`).
6. Item 29 refuses to reopen it: *"There is one paid tier; no node here is 'build the tier
   gating', no chain forks by tier"* (`10-roadmap/dependency-graph.md:807`, point 6).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:227-266`
- `00-program-control/charter/OWNER_SEED_FACTS.md:61`
- `00-program-control/GOVERNING_PRINCIPLES.md:78`
- `10-roadmap/dependency-graph.md:807`
