---
id: ADR-0046
title: `FB-D2-01 ← FB-D1-01` is deliberately NOT an edge
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 29)
gate_item: 29
promotion: Locked as an explicit REJECTION with a named reversal condition. A rejected edge recorded nowhere is re-added by the next reader, which is the whole argument for an ADR set.
supersedes: the boundary matrix's D2 row read as an adapter-before-model ordering
superseded_by: none
register_row: none
---

# ADR-0046 — `FB-D2-01 ← FB-D1-01` is deliberately NOT an edge

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 29) · gate item 29

**Why it is an ADR and not a tracker row:** Locked as an explicit REJECTION with a named reversal condition. A rejected edge recorded nowhere is re-added by the next reader, which is the whole argument for an ADR set.

**Supersedes:** the boundary matrix's D2 row read as an adapter-before-model ordering

## Context

The boundary matrix's D2 row sequences legacy data classes *"through D1-shaped readers until each
class is migrated, never migrated by fiat"*, which reads like an adapter-before-model ordering
(`10-roadmap/dependency-graph.md:679-690`).

## Decision

⛔ **`FB-D2-01 ← FB-D1-01` is NOT in the adjacency table.** It is rejected because it
would **serialise the two heaviest nodes in the graph (XL behind L) on evidence that speaks only to
legacy migration, not to D2's new Terminal-Next classes** — and item 16 records `FB-D2-01` as
waiting on nothing (`:679-690`).

⭐ *"A false dependency serialises work that could have run in parallel and nobody re-checks
it; these are precisely the two nodes where that would cost the most."*

⚠️ **Reversal condition:** if the first ten figures `FB-D2-01` addresses turn out to be
legacy-sourced, the edge becomes real and both nodes land in chain A (`:690`).

## Alternatives actually considered

1. **Add the edge.** Rejected above.
2. **Add it with a note.** Rejected implicitly: an edge is an edge to a reader, and a note does not
   un-serialise the work.

## Consequences

* The rejection is recorded in the document rather than merely absent from the table, so a reader
  cannot re-derive it as an oversight (`:679-690`).
* ⚠️ Item 29 also records **four architecture requirements with hard prerequisites in the
  graph and NO backlog item** — `ARCH05-R5`, `ARCH05-ALLOWLIST`, `ARCH06-CHOKEPOINT`,
  `ARCH06-DATACLASSES` — carried as `ARCH*` nodes *"so the graph is not silently short an
  edge"*, and explicitly **not proposed as items**. Three of the four cluster on one boundary: the
  entitlement object and the grounding contract (ADR-0020, ADR-0022) (`:691-706`).
* ⛔ **A node absent from the adjacency table is unexamined, not independent**
  (`:807-836`, point 9).

## Sources

- `10-roadmap/dependency-graph.md:679-706,807-836`
