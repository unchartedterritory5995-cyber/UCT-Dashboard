---
id: ADR-0004
title: Capability status has THREE states, not two
status: accepted
date: 2026-09-26
decided_by: programme (gate item 15 author)
gate_item: 3, 15, 31
promotion: Locked: it was applied to a real subsystem, published in the checklist, and the ledger's two-state reading was struck as a result. The ledger SCHEMA change it implies is unshipped, and that is stated below.
supersedes: the two-state present/absent reading of `01-existing-system/capability-ledger.md`'s rows
superseded_by: none
register_row: none
---

# ADR-0004 — Capability status has THREE states, not two

**STATUS: ACCEPTED** · 2026-09-26 · decided by programme (gate item 15 author) · gate item 3, 15, 31

**Why it is an ADR and not a tracker row:** Locked: it was applied to a real subsystem, published in the checklist, and the ledger's two-state reading was struck as a result. The ledger SCHEMA change it implies is unshipped, and that is stated below.

**Supersedes:** the two-state present/absent reading of `01-existing-system/capability-ledger.md`'s rows

## Context

The capability ledger's rows classify a capability as present or absent. Gate item 15 found the
**Wisdom Loop** shipping with **zero** ledger rows — 111 files, six packages, a 32-table
schema, six routers included unconditionally, `grep -ci wisdom` returning **0** — and
reported it as `ADMIN-MOUNTED`, *"a third state distinct from absent and from serving members,
with no flag state asserted anywhere"* (`00-program-control/MASTER_CHECKLIST.md:21`). The same
pass found five of fourteen accumulated assets at `NO-SURFACE-FOUND`, *"because a store with no
surface has no home in the capability ledger's taxonomy at all"* (`:21`).

## Decision

A capability is recorded in exactly one of **three** states:

1. **absent** — it does not exist;
2. **ships at admin level with no member surface** — mounted, reachable by staff, invisible
   to members;
3. **populated and serving members**.

## Alternatives actually considered

1. **Present / absent.** Rejected: it forces an admin-mounted subsystem into "absent", and that
   is the cell that gets acted on — *"which makes this file a generator of duplicate work"*
   (`01-existing-system/capability-ledger.md:15`).
2. **Present / absent plus a flag column.** Rejected because the flag state is unread
   (ADR-0003); the middle state has to be assertable without it.

## Consequences

* ⛔ An "absent" cell in the ledger is **not** evidence that something is absent
  (`capability-ledger.md:15`). Two further instances in the same period: the AI print explainer
  is **MOUNTED** in production (`OptionsFlow.jsx:57` imports it, `:3419` renders it) while
  `_merge-master`'s `CLAUDE.md` still says it is *"deliberately not imported"*; and
  `CommandPalette` is recorded elsewhere as PROVISIONAL-SHIPPED (`capability-ledger.md:15`).
* ⚠️ **The ledger's taxonomy was not amended.** This ADR records the decision; the
  schema change is unshipped, so the third state currently exists only in prose in
  `MASTER_CHECKLIST.md:21` and in the consumers that adopted it.
* Consumers must therefore state which state they mean. Item 15's `NO-SURFACE-FOUND` and
  `ADMIN-MOUNTED` labels are the working vocabulary.

## Sources

- `00-program-control/MASTER_CHECKLIST.md:21`
- `01-existing-system/capability-ledger.md:15`
- `05-product-strategy/proprietary-advantage-inventory.md:301-303` (the `NO-SURFACE-FOUND` definition, and its own warning that it is *"an absence of evidence from this pass, not proof of"* absence) and `:310,314,316` (three of the rows carrying it)
