---
id: ADR-0006
title: A contradiction between documents of equal standing is REPORTED, never resolved by the reporter
status: accepted
date: 2026-09-26
decided_by: programme
gate_item: 13, 14, 15, 31
promotion: Locked: three deliverables applied it in the same week and each published its unresolved list rather than picking a winner.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0006 — A contradiction between documents of equal standing is REPORTED, never resolved by the reporter

**STATUS: ACCEPTED** · 2026-09-26 · decided by programme · gate item 13, 14, 15, 31

**Why it is an ADR and not a tracker row:** Locked: three deliverables applied it in the same week and each published its unresolved list rather than picking a winner.

## Context

Gate items 13, 14 and 15 each found numbers disagreeing between accepted documents, and each
declined to pick a winner. Item 13 *"reports two internal contradictions it did NOT resolve, each
between two documents of equal standing"* (`00-program-control/MASTER_CHECKLIST.md:19`); item 14
records **six** (`:20`); item 15 records the three-way `cap_universe` split as
*"⛔ Not resolved"* (`05-product-strategy/proprietary-advantage-inventory.md:707`).

## Decision

A document that finds two accepted artifacts disagreeing **prints both readings with both
citations and stops**. Resolution requires re-deriving from the primary source, which is a
separate act with its own record.

## Alternatives actually considered

1. **Take the more recent reading.** Rejected, and CARD 23 is the counter-example: the
   "two contested prices" were not a contradiction at all — one seed-fact sentence had
   spliced a UCT Intelligence tier statement and a **different product's** promo price, and
   picking a winner would have hard-coded the wrong product's price into the programme
   (`12-decisions/DECISION_CARDS_2026-09-26.md:633-635`).
2. **Take the code.** Correct where a document disagrees with source — and used, e.g. the
   tick stream's provider (`09-security-licensing-cost/data-use-classification.md:1142`). It does
   **not** apply between two documents neither of which is source.
3. **Carry one value silently.** Rejected: that is how `cap_universe` reached three live values.

## Consequences — the live contradictions this set carries forward unresolved

| contradiction | readings | recorded at |
|---|---|---|
| `cap_universe` | **3,742** (ledger A8) · **3,721** (D-13 §2a, the wire payload key) · **3,640** (`api/data/cap_universe.json` at `origin/master`) | `01-existing-system/capability-ledger.md:21,59`; `proprietary-advantage-inventory.md:705-707` |
| `posts_total` | **88** (D-13 §2f and `voice_profile.json`) · **92** (D-13 §11) · a **third** value recorded by item 15 (*"now three values, not two"*) | `04-workflows/jobs-to-be-done.md:702`; `04-workflows/workflow-library.md:1375`; `proprietary-advantage-inventory.md:697` |
| the breadth collector's hour | **15:15 CT** · **16:15 ET** · *"the 4:15 collector"* | `capability-ledger.md:172`; `01-existing-system/ecosystem-cartography.md:414`; item 14's row at `MASTER_CHECKLIST.md:20` |

⛔ The breadth-collector hour is the one that matters operationally: item 14 records that the
three readings sit **while gating a member-visible state change** — the intraday breadth row
is hidden once the collector writes the day (`MASTER_CHECKLIST.md:20`).

⭐ Also carried: `10-roadmap/rth-scheduling.md:3` says "Nine" tasks above its own eight-row
table (`MASTER_CHECKLIST.md:20`); and ADR-0005's consequence — item 27's ceiling still
carries the superseded "always understates" framing.

## Sources

- `00-program-control/MASTER_CHECKLIST.md:19,20,21`
- `01-existing-system/capability-ledger.md:21,172`
- `01-existing-system/ecosystem-cartography.md:414`
- `04-workflows/workflow-library.md:1375-1376`
- `04-workflows/jobs-to-be-done.md:702,705-706`
- `05-product-strategy/proprietary-advantage-inventory.md:697,705-707`
- `12-decisions/DECISION_CARDS_2026-09-26.md:633-635`
- `09-security-licensing-cost/data-use-classification.md:1142`
