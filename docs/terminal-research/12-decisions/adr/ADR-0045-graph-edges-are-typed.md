---
id: ADR-0045
title: Dependency-graph edges are TYPED, because they have different unblocking actions
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 29 / H-04)
gate_item: 29
promotion: Locked: a structural decision about the graph's own schema, with a stated reason, and it changes what a reader is told to do.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0045 — Dependency-graph edges are TYPED, because they have different unblocking actions

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 29 / H-04) · gate item 29

**Why it is an ADR and not a tracker row:** Locked: a structural decision about the graph's own schema, with a stated reason, and it changes what a reader is told to do.

## Context

Item 29 built the dependency graph: **118 nodes, 109 edges**, counts DERIVED by parsing the
finished adjacency table back out of the file
(`00-program-control/MASTER_CHECKLIST.md:35`; `10-roadmap/dependency-graph.md:183-215`).

## Decision

**Edges are typed** — code 67 · decision 21 · rail 10 · measurement 9 ·
vendor 2 — ⭐ **because they have different unblocking actions, and a graph that conflates
them tells a reader to write code when they should send an email**
(`MASTER_CHECKLIST.md:35`; `dependency-graph.md:139-156`).

## Alternatives actually considered

1. **Untyped edges.** Rejected on the sentence above.
2. **Fan the measurement floor out as many edges.** Rejected deliberately: `FB-OBS-01` *"blocks
   almost nothing from being built and it blocks a large share of the graph from being believed"*,
   so it is ranked by a different quantity rather than modelled as twenty fanned-out edges
   (`dependency-graph.md:68-120` H2, and §2.3).

## Consequences — the findings the typing produced

* ⭐⭐ **The graph is WIDE AND SHALLOW — depth 3, and 40 of 85 items have no hard
  prerequisite — so delivery is NOT dependency-bound, it is CONCURRENCY-bound.** Quantified
  from figures already paid for: 40 startable → **3 lanes** (agent cap) → **1 at
  verification** (one gate at a time on this box) → **1 master merge in flight** → **0
  lanes** on flow-worker watch paths during RTH (`MASTER_CHECKLIST.md:35`).
* ⛔ **Parallelism DECAYS with depth** — four chains disjoint at depth 0–1 converge to
  one front by depth 3, the opposite of what a 40-wide in-degree-zero set suggests (`:35`).
* ⭐ **A sixth shared resource nobody counts: this box is also the DATA PRODUCER** for the
  scheduled member-facing jobs, so a 46–92 min gate can contend with one (`:35`;
  `dependency-graph.md:502-585`).
* **Two of the top nine nodes cannot be cleared by engineering at all** and together sit above 15
  nodes: an identifier measurement and **the owner naming a quiet window** (`:35`).
* **Four edges are declared only on the prerequisite's side**, so a graph built from dependents'
  fields alone loses them (`:35`; `dependency-graph.md:668-678`).
* ⚠️ Self-flagged most-likely error, carried: *"the four-chain assignment is a judgement
  from row letters, not file-derived, so two lanes it calls disjoint could collide in one file"*
  (`:35`).
* ⛔ **Not decided:** sequencing in time (item 28 owns it), scope (item 27), priority (item
  17), sizing (item 16), or any of the 18 `DEC-*` nodes (`dependency-graph.md:807-836`).

## Sources

- `10-roadmap/dependency-graph.md:68-180,183-215,356-375,502-585,605-651,668-678,807-836`
- `00-program-control/MASTER_CHECKLIST.md:35`
