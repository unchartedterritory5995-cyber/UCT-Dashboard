---
id: ADR-0029
title: Fix the leak before choosing a process topology, and never by deploying less
status: accepted
date: 2026-09-26
decided_by: the programme (gate items 24, 25, 29)
gate_item: 24, 25, 29
promotion: Locked: three independent deliverables state the same ordering, each with its own measurement, and item 29 calls it *"the sharpest ordering ruling in the programme"*.
supersedes: the reading of deploy frequency as a pure cost, carried by every prior document
superseded_by: none
register_row: none
---

# ADR-0029 — Fix the leak before choosing a process topology, and never by deploying less

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate items 24, 25, 29) · gate item 24, 25, 29

**Why it is an ADR and not a tracker row:** Locked: three independent deliverables state the same ordering, each with its own measurement, and item 29 calls it *"the sharpest ordering ruling in the programme"*.

**Supersedes:** the reading of deploy frequency as a pure cost, carried by every prior document

## Context

The web pod grows **+7.9 MB/min, monotonic across quartiles, 76 `[mem]` samples over 104
minutes** (`10-roadmap/dependency-graph.md:68`ff, H1, citing item 24 §2.2). Median pod life is
**26 minutes** (`07-technical-architecture/realtime-performance-architecture.md:411`ff,
§2.5).

## Decision

1. **Fix the leak before choosing a process topology.** *"'Give the terminal its own long-lived
   process' and 'the long-lived process is the problem' are the same sentence."*
   (`realtime-performance-architecture.md:568-588`, §5.1) Q7 sits downstream of a
   measurement, not of a design.
2. ⛔ **And never by deploying less.** ⭐ Item 24 re-scored frequent recycling as
   **partly load-bearing against the leak** — a 26-minute median pod life is what keeps RSS
   near 2.4 GB instead of near 11 GB — so item 25 §4.2(3) rules that the fix for a
   counter a deploy destroys is **to move the counter, never to deploy less**
   (`dependency-graph.md:68`ff).
3. **The next step is one held window with per-subsystem attribution, not a topology decision**
   (`realtime-performance-architecture.md:568-588`).

## Alternatives actually considered

1. **Give Terminal-Next its own long-lived process now.** Rejected — it is the same sentence
   as the problem.
2. **Deploy less often to stabilise measurement.** Rejected: it raises RSS and it is the remedy
   item 25 explicitly forbids.
3. **Accept the leak and raise the memory limit.** Not ruled; OBS-4 says that if a capacity
   decision raises the limit, the ceiling is re-derived from the new limit and never from the old
   number (`10-roadmap/observability-plan.md:759`ff).

## Consequences

* ⛔ **"The deploy window" is THREE quantities that all three accepted documents conflate:**
  82–119 s of `/api/*` unavailability, 3m40s–6m40s push-to-SUCCESS, ~10 min end-to-end
  — and **the first was not observed on any of five orderly deploys** watched in that
  session. The only 502 on record came from a **superseded** deploy, so the architectural cost of
  deploying is a **cold cache**, and the availability cost belongs to **pushing twice inside one
  build** (`realtime-performance-architecture.md:343`ff, §2.4;
  `00-program-control/MASTER_CHECKLIST.md:30`).
* The unblocking chain is `FB-S7-03 → FB-OBS-04 → FB-OBS-03 → DEC-TOPOLOGY`, and
  every edge on it is a measurement or code edge, **not a decision waiting on a person**
  (`dependency-graph.md:68`ff).
* ⚠️ Item 24 does **not** decide whether Terminal-Next runs in its own process, and
  item 25 does not attribute the leak — S4 measures the slope only
  (`realtime-performance-architecture.md:589-604`; `observability-plan.md:830` point 7).

## Sources

- `07-technical-architecture/realtime-performance-architecture.md:51-76,307-342,343-367,411-419,568-604`
- `10-roadmap/observability-plan.md:589-609,759-776,830`
- `10-roadmap/dependency-graph.md:68-120`
- `00-program-control/MASTER_CHECKLIST.md:30`
