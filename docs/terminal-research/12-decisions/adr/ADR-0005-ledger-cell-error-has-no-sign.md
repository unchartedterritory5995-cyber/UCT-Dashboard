---
id: ADR-0005
title: A ledger cell is a dated measurement whose error has no reliable sign
status: accepted
date: 2026-09-26
decided_by: programme (gate item 15 author; verified independently)
gate_item: 3, 15, 31
promotion: Locked: a falsification, verified twice, with the falsified claim struck in the artifact that carried it.
supersedes: the capability-ledger banner's claim that its errors are "still every single one in the same direction" (not an ADR; the claim lived in `capability-ledger.md:15`)
superseded_by: none
register_row: none
---

# ADR-0005 — A ledger cell is a dated measurement whose error has no reliable sign

**STATUS: ACCEPTED** · 2026-09-26 · decided by programme (gate item 15 author; verified independently) · gate item 3, 15, 31

**Why it is an ADR and not a tracker row:** Locked: a falsification, verified twice, with the falsified claim struck in the artifact that carried it.

**Supersedes:** the capability-ledger banner's claim that its errors are "still every single one in the same direction" (not an ADR; the claim lived in `capability-ledger.md:15`)

## Context

The capability ledger's staleness banner generalised from four checked cells to a property of
the whole ledger: its errors were *"still every single one in the same direction"* —
understating what ships (`01-existing-system/capability-ledger.md:15`). ⛔ That framing
**licensed reading a small cell as a FLOOR**, which is the one way it could do harm.

It was falsified on 2026-09-26. Row **A8** states `cap_universe.json (3,742)`
(`capability-ledger.md:59`); `len(json.load(...))` over
`origin/master:api/data/cap_universe.json` returns **3,640** — the cell **OVERSTATES**
(`05-product-strategy/proprietary-advantage-inventory.md:668-670`;
`05-product-strategy/product-vision.md:341,346`). Over seven cells re-derived that day:
**five understated, one overstated, two were exactly right** — G6's 25-measured/3-published
and H9's taxonomy (v4.22.0 / 112 themes / 12 sectors / 2,029 holdings) both re-derived unchanged
(`capability-ledger.md:19`).

## Decision

**A ledger cell is a dated measurement whose error has no reliable sign.** Re-derive anything
load-bearing. Never treat a ledger number as a bound in either direction
(`capability-ledger.md:21`).

## Alternatives actually considered

1. **"It always understates."** Falsified by A8. It is also the more dangerous of the two errors,
   because it licenses inaction.
2. **Discard the ledger as unreliable.** Rejected: the rows were sound and five were merely
   superseded — KB 9,605→9,797 (so `CLAUDE.md`'s "8,500+" too), `book_plans`
   420→760, `setup_triggers` 243→540, wire snapshots 28→44, `market_regimes`
   148→165 (`MASTER_CHECKLIST.md:21`).

## Consequences

* ⚠️ **A live contradiction this ADR reports and does not resolve** (ADR-0006): gate
  item 27's own evidence ceiling still reads *"the capability ledger understates what ships, six
  for six"* and concludes *"the likely direction of error is that this MVP is SMALLER than
  stated, never larger"* (`10-roadmap/mvp.md:67-71`). That is the superseded framing, carried in
  a document drafted the same day.
* ⛔ `cap_universe` now has **three** live values in the programme — 3,742 (ledger A8),
  3,721 (D-13's wire payload), 3,640 (the file at master) — and the contradiction is
  recorded deliberately unresolved (`capability-ledger.md:21`;
  `proprietary-advantage-inventory.md:705-707`).

## Sources

- `01-existing-system/capability-ledger.md:15,19,21,59`
- `05-product-strategy/proprietary-advantage-inventory.md:668-679,697,705-707`
- `05-product-strategy/product-vision.md:341,346`
- `00-program-control/MASTER_CHECKLIST.md:21`
- `10-roadmap/mvp.md:67-71`
