---
id: ADR-0024
title: R-17 is NOT reported closed on a source read: a finding established by probe is retired only by probe
status: accepted
date: 2026-09-26
decided_by: the programme (gate item 23)
gate_item: 23
promotion: Locked: a deliberate refusal to report progress, with the closing measurement named. It is a decision about what may be written down, which is exactly what this programme keeps paying for.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0024 — R-17 is NOT reported closed on a source read: a finding established by probe is retired only by probe

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme (gate item 23) · gate item 23

**Why it is an ADR and not a tracker row:** Locked: a deliberate refusal to report progress, with the closing measurement named. It is a decision about what may be written down, which is exactly what this programme keeps paying for.

## Context

⭐ R-17's three CONFIRMED routes now **do** declare an auth dependency in master's source:
`/api/live-prices`, `/api/snapshot`, `/api/snapshot/{ticker}`, `/api/movers`,
`/api/extended-movers` and `/api/gex/data` all carry `Depends(get_current_user)`, and the whole
`/api/bars*` and `/api/stream/bars` family carries `Depends(require_bars_access)`
(`09-security-licensing-cost/security-entitlement-architecture.md:64-104`, §2.2 has every
line). The live breadth-monitor route, which F-04 had as NOT DETERMINED, is covered too
(`00-program-control/MASTER_CHECKLIST.md:29`).

## Decision

⛔ **This does NOT close R-17 and must not be reported as closing it.** The finding was
established by probe; it can only be retired by probe. The read was of source in a master
worktree, the SHA could not be read, and **`web` deploys from `production`** — so the honest
statement is *"the omission appears remediated in source; the running service was not
measured"* (`:64-104`).

**The closing measurement is named instead:** one read-only `GET` per route
(`00-program-control/MASTER_CHECKLIST.md:29`; item 23's m2).

## Alternatives actually considered

1. **Report R-17 closed.** Rejected: *"Reporting the routes as fixed on this evidence would be
   the exact defect class this program keeps recording."* (`:761-792`, point 3)
2. **Run the probe.** Not available — the charter bars production calls except a single
   read-only `GET /api/health` where a contract allows it
   (`00-program-control/contracts/_SHARED_PREAMBLE.md:30`).

## Consequences

* The same rule binds every finding of this shape in the programme: **the evidence class that
  established a finding is the evidence class that retires it** (see also
  `_SHARED_PREAMBLE.md:38`'s CLAIM vs CONFIRMED ladder).
* ⚰️ One adjacent finding IS closed and must not be re-reported: D-10 §4.2's
  *"FREE_PAGES has three hand-synced copies"* — one module now
  (`00-program-control/MASTER_CHECKLIST.md:29`).
* ⚠️ Item 23 changed nothing in production: no route edited, no flag flipped, no
  variable set, no probe run (`:761-792`, point 5).

## Sources

- `09-security-licensing-cost/security-entitlement-architecture.md:64-104,436-494,761-792`
- `00-program-control/MASTER_CHECKLIST.md:29`
- `00-program-control/contracts/_SHARED_PREAMBLE.md:30,38`
