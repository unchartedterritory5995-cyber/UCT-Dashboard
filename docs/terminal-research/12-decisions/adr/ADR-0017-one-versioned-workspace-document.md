---
id: ADR-0017
title: The workspace is ONE versioned document in its own store; `user_preferences` is the scalar-settings store
status: accepted
date: 2026-09-25
decided_by: the programme (gate item 20)
gate_item: 20
promotion: Locked: it RESOLVES a direct contradiction between two accepted inputs by sequencing them, and the resolution is a ruling with both halves ordered. ⚠️ It sits under a provisional hybrid lock but is *"true under B and under C"* (CARD 13).
supersedes: the reading of D-06 and D-11 as rivals on this question
superseded_by: none
register_row: DEC-01 (Workspace model)
---

# ADR-0017 — The workspace is ONE versioned document in its own store; `user_preferences` is the scalar-settings store

**STATUS: ACCEPTED** · 2026-09-25 · decided by the programme (gate item 20) · gate item 20

**Why it is an ADR and not a tracker row:** Locked: it RESOLVES a direct contradiction between two accepted inputs by sequencing them, and the resolution is a ruling with both halves ordered. ⚠️ It sits under a provisional hybrid lock but is *"true under B and under C"* (CARD 13).

**Register:** DEC-01 (Workspace model) — `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` remains the authority for that row. This ADR records only what locked after 2026-09-02 and is not in the register.

**Supersedes:** the reading of D-06 and D-11 as rivals on this question
## Context

⛔ **The sharpest substantive divergence in the input set, and a decision document that did
not resolve it would be decoration** (`06-ux-and-information-architecture/fixed-modular-hybrid.md:181-184`):

* **D-06 says version it in place:** *"Stamp a `version` on `charts_workspace_layout` before
  Terminal-Next touches it, and retire the `maxBottom` heuristic in the same commit"*
  (`:186-188`).
* **D-11 says the store is the wrong primitive:** *"Treat `user_preferences` as the SCALAR-SETTINGS
  store. Give a TERMINAL-NEXT workspace its own store, modelled on `charts_layout_service.py` /
  `user_definitions.py` (own SQLite file, WAL, `_WRITE_LOCK`, explicit caps, an explicit delete)"*
  (`:189-194`).

## Decision — both, sequenced; they are a bridge and a destination, not rivals

**D-11 wins on the destination. D-06 wins on the interim.** (`:196-200`)

1. **Now, before Terminal-Next touches the blob:** stamp a version on
   `charts_workspace_layout` and retire the `maxBottom` heuristic in the same commit.
   §3 measured **17 live boards, none of them versioned**; they need a schema handle before
   anything migrates them (`:202-208`).
2. **For Terminal-Next: its own store, D-11's shape.** The disqualifying facts are not aesthetic
   — `user_preferences` is *"an unversioned, uncapped, undeletable key→TEXT table"*,
   there is **no DELETE route** (`delete_user_preference` exists and is imported with no caller),
   dead keys accumulate permanently, and prefs are inlined into `/me` so *"a large workspace blob
   is paid for on every page load by every surface"* (`:210-219`).

⭐ **The repo already argued this against itself**: `user_definitions.py` opens with
*"WHY NOT `user_preferences` — ALSO MEASURED: `user_preferences` has NO SIZE LIMIT and NO
DELETE ROUTE… This store names its caps and ships a delete"* (`:216-219`).

⛔ **The version stamp is the migration bridge, not a substitute for it. Anyone who ships
step 1 and stops has left the board on a store whose own repo documents why it is wrong for
this.** (`:221-223`)

## Alternatives actually considered

1. **Version in place and stop** (D-06 alone). Rejected by the sentence above.
2. **Go straight to the new store** (D-11 alone). Rejected: 17 live unversioned boards need a
   schema handle before migration.
3. **Keep the family of keys.** Rejected — D-11 calls the single versioned document
   *"the single strongest argument in the codebase"* for the change (`:193-194`).

## Consequences

* ⚠️ **The inputs disagree on how many keys "the workspace" is: D-06 says fourteen,
  D-11 says eight.** This document means **D-11's eight**, because the number that decides the
  design is *the set that must commit or roll back together* — the apply bundle
  (`:224-232`). Reported, both readings named (ADR-0006).
* Item 29's H3 carries the ordering consequence: **`FB-S5-01` cannot ship before `FB-X1-02`**
  — *"a versioned document is worth little in an unbacked store"*
  (`10-roadmap/dependency-graph.md:68`ff, H3).
* Overturn signal 5: a measured incident on the corrupt-blob path raises this from "sequenced" to
  "urgent"; §3 currently shows 0 of 17 unparseable (`:302`ff).
* ⚠️ **Not decided here:** any cross-device ruling. Drawings and `uct.watchlist.cols`
  are device-local while `tracings_doc` syncs, which D-11 records as *"an accident of
  implementation order, not a decision"* — it needs its own ruling (`:318`ff).

## Sources

- `06-ux-and-information-architecture/fixed-modular-hybrid.md:179-232,302,318`
- `10-roadmap/dependency-graph.md:68`
- `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:63-72` (DEC-01)
