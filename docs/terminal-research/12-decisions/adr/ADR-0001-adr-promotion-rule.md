---
id: ADR-0001
title: A decision that has LOCKED earns an ADR; the register stays the tracker
status: accepted
date: 2026-09-26
decided_by: this deliverable, applying MASTER_CHECKLIST row 31's own rule
gate_item: 31
promotion: It is the rule this whole set is written under, and row 31 states it rather than this file inventing it.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0001 — A decision that has LOCKED earns an ADR; the register stays the tracker

**STATUS: ACCEPTED** · 2026-09-26 · decided by this deliverable, applying MASTER_CHECKLIST row 31's own rule · gate item 31

**Why it is an ADR and not a tracker row:** It is the rule this whole set is written under, and row 31 states it rather than this file inventing it.

## Context

`00-program-control/MASTER_CHECKLIST.md:37` (gate item 31) reads: *"NOT STARTED (individual
formal ADRs, written when a decision genuinely locks) — but
`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md` (Phase 2, ACCEPTED 2026-09-02) is now the
living tracker feeding them: 13 decisions, 4 already LOCKED with no counter-evidence found."*
The register says the same thing from its own side: *"Formal ADRs … get written when a
decision genuinely LOCKS — most of the items below are not there yet. This register is the
tracker; ADRs are the record of what shipped."*
(`12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:11-13`).

Nearly a month of rulings has accumulated since 2026-09-02. `DECISION_CARDS_2026-09-18.md`,
`DECISION_CARDS_2026-09-25.md` and `DECISION_CARDS_2026-09-26.md` (CARDs 9–27) postdate the
register, and six gate-item architecture documents were drafted 2026-09-25/26.

## Decision

1. **The register is the sole authority for `DEC-01` … `DEC-15`.** This set does **not**
   restate any of those rows. `ADR-INDEX.md` carries a promotion table pointing at them.
2. **An ADR is written here only when a decision has LOCKED and the register does not already
   hold it.** "Locked" means: ruled, with either no reversal condition (an owner ruling) or a
   reversal condition that is a *named future observation* rather than an input the programme is
   still waiting on.
3. **Every ADR states which side of that boundary it sits on**, in the `promotion:` field.
4. **A decision still in flux stays in the living tracker or in the decision cards.** It is not
   promoted, and `ADR-INDEX.md` says why.
5. ⭐⭐ **A superseded decision keeps its own ADR**, with `superseded_by` filled and its
   reasoning intact. This is the one convention the register does not have: the register
   overwrites its own history in place (DEC-08's reversal and DEC-14's replaced expiry condition
   survive only as `⚰️` strike blocks, and the reversals in the decision cards are not
   in the register at all).

## Alternatives actually considered

1. **One ADR per register row.** Rejected: it duplicates an ACCEPTED artifact another agent may
   be reading, and puts a second authority on fifteen values — the defect this programme
   records most often.
2. **Fold the register into this set and retire it.** Rejected: the register is ACCEPTED and not
   this deliverable's to edit; and it does a job an ADR set cannot — it tracks decisions
   that have *not* locked.
3. **Write ADRs only for the four LOCKED register rows and stop.** Rejected: it would produce a
   set whose newest decision predates every owner ruling in the programme, and would hide every
   reversal.

## Consequences

* The set's value is the **diff**: what locked after 2026-09-02 and is recorded nowhere as a
  decision. `ADR-INDEX.md` is the diff.
* ⛔ Where a decision is genuinely on the boundary, the record says so rather than forcing
  it. Three are flagged: ADR-0016/0017/0019 (item 20's commitments, taken under a lock the
  document itself calls PROVISIONAL), ADR-0025 (positions that are "keep doing what we do", not
  new commitments), and ADR-0043 (a fix decided and **not shipped**).
* ⚠️ This ADR does not amend the register, the checklist, or
  `_SHARED_PREAMBLE.md`. Nothing outside `12-decisions/adr/` was written.
* ⚰️ **AND THE ROW THAT DISPATCHES AGENTS IS STALE ABOUT THE REGISTER IT POINTS AT.**
  `MASTER_CHECKLIST.md:37` reads *"13 decisions, 4 already LOCKED with no counter-evidence found
  (D3 Entity Master, D4 Provider Abstraction, D6 Provenance Component, D7 Alert Taxonomy)"*.
  Derived from the register itself:

  ```
  grep -cE '^\| DEC-[0-9]+ \|' ARCHITECTURAL_DECISION_REGISTER.md                    -> 15
  grep -oE '^\| DEC-[0-9]+ \|[^|]*\|[^|]*\*\*Locked\*\*' ARCHITECTURAL_DECISION_REGISTER.md
        -> DEC-03 DEC-04 DEC-06 DEC-07 DEC-10 DEC-13                                   (6)
  ```

  **Fifteen decisions, six locked.** The row predates DEC-14 and DEC-15 (both Phase 3) and both of
  the locks that landed after them, and it still uses the bare-`Dn` form ADR-0001 retired.
  ⛔ **This is ADR-0002's defect in the row that briefs every agent on this deliverable** — a
  hand-typed count beside the artifact it describes. **Reported, not corrected:** the checklist is a
  control artifact and this deliverable writes only under `12-decisions/adr/`. Read the register's
  own summary table (`:265-283`), never the row.

## Sources

- `00-program-control/MASTER_CHECKLIST.md:37`
- `12-decisions/ARCHITECTURAL_DECISION_REGISTER.md:10-13,121-137,209-252`
- `00-program-control/GOVERNING_PRINCIPLES.md:100` (gate item 15's satisfying artifact includes `12-decisions/adr/`)
