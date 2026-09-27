---
id: ADR-0016
title: Promotion between the fixed and composable layers is GENERIC, never a bespoke widget per function
status: accepted
date: 2026-09-25
decided_by: the programme (gate item 20, ARCH-02 input)
gate_item: 20
promotion: ⚠️ ON THE BOUNDARY, and said rather than forced: the hybrid lock it sits under is PROVISIONAL, but this commitment is stated as *"true under B and under C"* by CARD 13, so it is locked independently of the lock above it.
supersedes: none
superseded_by: none
register_row: DEC-01 (Workspace model)
---

# ADR-0016 — Promotion between the fixed and composable layers is GENERIC, never a bespoke widget per function

**STATUS: ACCEPTED** · 2026-09-25 · decided by the programme (gate item 20, ARCH-02 input) · gate item 20

**Why it is an ADR and not a tracker row:** ⚠️ ON THE BOUNDARY, and said rather than forced: the hybrid lock it sits under is PROVISIONAL, but this commitment is stated as *"true under B and under C"* by CARD 13, so it is locked independently of the lock above it.

**Register:** DEC-01 (Workspace model) — `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` remains the authority for that row. This ADR records only what locked after 2026-09-02 and is not in the register.
## Context

UCT runs a working composable board whose panel set is an **18-entry hand-curated
`WIDGET_REGISTRY`** that *"grows slower than the product does"*
(`06-ux-and-information-architecture/fixed-modular-hybrid.md:160-161`, citing C5-01 §0 and
D-06 §1.1). C5-01's anti-pattern is named: *"a workspace that can only contain things
somebody remembered to build a widget for"* (`:158`).

## Decision

**The number of registry entries must stop being the bound on what the board can hold**
(`:165-167`). Promotion is one generic operation — *"open this page as a panel"* — not a
widget authored per function.

⛔ **The commitment is NOT "replace the registry"** (`:165`). The registry is good and
reusable: it deliberately imports no components, no hosts and no CSS so any host can read it, and
`menus.*` already models per-shell availability. Adopt it essentially unchanged and **add a
`menus.terminal` flag rather than fork it** (`:162-163`; D-06 §1.1).

## Alternatives actually considered

1. **Keep authoring registry entries per surface (option A's shape).** Rejected: *"a hybrid whose
   panel set is a hand-maintained subset of the product's own surface area re-buys the ceiling
   that made this question worth asking"* (`:167`).
2. **Fork the registry for Terminal-Next.** Rejected — one flag, not a fork.

## Consequences

* ⛔ **A named test must run before ARCH-02 is authored and before any new registry entry
  is:** take one existing route that is *not* in the registry and mount it as a panel through a
  generic path. **If that costs a bespoke widget, option B is more expensive than the document
  assumes** and §7's overturn table applies (`:174-178`). The test is **unrun**.
* ⚠️ That unrun test is signal 2 of the overturn table: *"the generic-promotion test in
  §4 costs a bespoke widget per route → B's price is wrong; re-cost against A"*
  (`:302`ff).
* CARD 13 makes this survive the provisional lock: *"Every commitment in C5-03 — generic
  promotion, one versioned document, the panel-isolation invariant — is true under B and
  under C, and only the shell shape differs. Nothing on the critical path has to wait for this
  lock."* (`12-decisions/DECISION_CARDS_2026-09-26.md:149-152`)

## Sources

- `06-ux-and-information-architecture/fixed-modular-hybrid.md:152-178,302`
- `12-decisions/DECISION_CARDS_2026-09-26.md:138-152`
- `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:63-72` (DEC-01, the tracker row)
