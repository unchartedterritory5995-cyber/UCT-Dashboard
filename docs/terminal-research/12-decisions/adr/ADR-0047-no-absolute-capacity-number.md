---
id: ADR-0047
title: An absolute production capacity number is OUT OF SCOPE; the local sandbox answers only relative questions
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: 24, 25
promotion: Locked as a SCOPE determination with a stated reason (it needs a second Railway environment, already rejected on member-data grounds) and a restated closing condition for the blocked item.
supersedes: the treatment of an absolute production concurrency number as a missing deliverable
superseded_by: none
register_row: none
---

# ADR-0047 — An absolute production capacity number is OUT OF SCOPE; the local sandbox answers only relative questions

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item 24, 25

**Why it is an ADR and not a tracker row:** Locked as a SCOPE determination with a stated reason (it needs a second Railway environment, already rejected on member-data grounds) and a restated closing condition for the blocked item.

**Supersedes:** the treatment of an absolute production concurrency number as a missing deliverable

## Context

CP-05 needed a load target: §8 generates no load by design, and the roadmap's Rule 4 bars
running load against production. A load model needs a target that does not exist
(`12-decisions/DECISION_CARDS_2026-09-26.md:175-180`).

## Decision

1. **The local sandbox is the target, and its limits are stated rather than discovered later.**
   `scripts/hub_sandbox_boot.py` is the only non-production boot this project has that is *safe by
   construction* — AST-derived env pins, the conftest tripwire armed in-process, and a
   snapshot rail that aborts on any change to the shared data root (`:182-184`).
2. ⛔ **It cannot answer the question CP-05 actually asks.** The sandbox is one developer
   machine with a synthetic `auth.db`; production is a single Railway replica with a mounted
   volume, one uvicorn process, and one shared anyio threadpool. **A concurrency number from the
   sandbox is a number about that laptop** (`:186-189`).
3. **What the sandbox CAN give, honestly** (`:190-194`): **relative** scaling from 1 to N
   simulated panel clients; the **event-loop lag curve** under panel load, directly comparable to
   production's measured **14.9 ms max**; and the **per-panel cost** of a Terminal-Next board,
   which is the actual design input.
4. ⛔ **An absolute production capacity number is OUT OF SCOPE for this programme and should
   stop being treated as a missing deliverable.** It requires a second Railway environment, which
   the coexistence work already rejected on member-data grounds. **CP-05 closes on relative numbers
   plus the production lag baseline** (`:196-199`).

## Alternatives actually considered

1. **Load-test production.** Barred by the roadmap's Rule 4 and by the charter
   (`00-program-control/contracts/_SHARED_PREAMBLE.md:30`).
2. **Stand up a second Railway environment.** Rejected earlier, on member-data grounds.
3. **Report the sandbox number as a production capacity.** Rejected — it is a number about
   one laptop.

## Consequences

* Item 24 defers to this and names it among the things it does not decide
  (`07-technical-architecture/realtime-performance-architecture.md:589-604`, point 5); item 25 does
  the same (`10-roadmap/observability-plan.md:830`, point 4).
* ⛔ **Never write to `C:\data`** — it exists on this box, so a product path resolving to
  `/data/...` reaches the owner's LIVE files. The sandbox's snapshot rail and the repo-root
  `conftest.py` tripwire are what make a local run safe at all
  (`00-program-control/charter/OWNER_SEED_FACTS.md:26-27`;
  `00-program-control/contracts/_SHARED_PREAMBLE.md:32`).
* The scarce resource turned out to be **server time, not connection count** (ADR-0025, D10), which
  is a relative measurement the sandbox can in principle reproduce.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:175-199`
- `07-technical-architecture/realtime-performance-architecture.md:589-604`
- `10-roadmap/observability-plan.md:830`
- `00-program-control/charter/OWNER_SEED_FACTS.md:26-27`
- `00-program-control/contracts/_SHARED_PREAMBLE.md:30-32`
