---
id: ADR-0019
title: No layout-library migration: react-grid-layout stays
status: accepted
date: 2026-09-25
decided_by: the programme (gate item 20)
gate_item: 20
promotion: Locked as a refusal, on a measured basis (seven surveyed libraries, none shipping a schema-version field). ⚠️ The LIBRARY question for the final hybrid lock stays open in the register; this record is only the refusal to migrate now.
supersedes: none
superseded_by: none
register_row: DEC-01 (Workspace model)
---

# ADR-0019 — No layout-library migration: react-grid-layout stays

**STATUS: ACCEPTED** · 2026-09-25 · decided by the programme (gate item 20) · gate item 20

**Why it is an ADR and not a tracker row:** Locked as a refusal, on a measured basis (seven surveyed libraries, none shipping a schema-version field). ⚠️ The LIBRARY question for the final hybrid lock stays open in the register; this record is only the refusal to migrate now.

**Register:** DEC-01 (Workspace model) — `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` remains the authority for that row. This ADR records only what locked after 2026-09-02 and is not in the register.
## Context

The fixed/modular/hybrid question reads as a layout question. It is not: **six of the seven
failure modes a workspace actually suffers are persistence failures, not layout failures, and none
of seven surveyed layout libraries ships a schema-version field or a migration story**
(`06-ux-and-information-architecture/fixed-modular-hybrid.md:24-27`, C5-01 §0/§7/§8).

## Decision

⛔ **Nothing in gate item 20 authorises replacing react-grid-layout**
(`:318-324`). C5-01 §10 settles that a dock library buys **no** schema safety, that UCT
already has tabs/float/popout bespoke on RGL, and that grid→dock is *"a **re-authoring**, not
a schema bump"*.

## Alternatives actually considered

1. **Migrate to a dock library (dockview / FlexLayout).** Rejected on the schema finding above,
   and constrained separately: overturn signal 4 is *"the popout spike (RG-27) shows
   dockview/FlexLayout breaks the one-SSE-pool property"* — which *"constrains LIBRARY, not
   this decision"*, since UCT's popout is a React portal into `window.open`, one pool
   browser-wide (`:302`ff).
2. **Stay on RGL forever.** Not decided. The library question for the final hybrid lock remains
   gated on RG-27 and the `charts_workspace_layout` distribution query
   (`06-ux-and-information-architecture/information-architecture.md:164-170`,
   `:641`ff; `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:63-72`).

## Consequences

* The Workspace Document is **library-agnostic** — a dock library would read the same
  document — which is exactly why ADR-0017 can be taken now and this one can be deferred
  (`information-architecture.md:692`, PR-1).
* ⚠️ Also not decided by item 20: any `StockChart` scope call (RG-05), ARCH-01/02/03
  content, and **the mobile workspace model** — `<640px` bypasses the grid entirely for
  `MobileWorkspace`, and the registry admits exactly five types on `menus.mobile`
  (`fixed-modular-hybrid.md:318`ff).

## Sources

- `06-ux-and-information-architecture/fixed-modular-hybrid.md:17-27,302,318-334`
- `06-ux-and-information-architecture/information-architecture.md:164-170,692`
- `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:63-72`
