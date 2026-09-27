---
id: ADR-0037
title: S7 scan-membership FLIP bar v1: `legacy_only == 0` over ≥ 5 sessions on ≥ 3 definitions held by ≥ 2 real members
status: superseded
date: 2026-09-25, superseded 2026-09-26
decided_by: the programme under owner delegation
gate_item: n/a (S7 checkpoint)
promotion: Promoted as a SUPERSEDED record: it is the second instance of the same unreachable-bar defect, one day after the first was re-cut, which is the fact worth preserving.
supersedes: none
superseded_by: ADR-0038
register_row: none
---

# ADR-0037 — S7 scan-membership FLIP bar v1: `legacy_only == 0` over ≥ 5 sessions on ≥ 3 definitions held by ≥ 2 real members

**STATUS: SUPERSEDED** · 2026-09-25, superseded 2026-09-26 · decided by the programme under owner delegation · gate item n/a (S7 checkpoint)

**Why it is an ADR and not a tracker row:** Promoted as a SUPERSEDED record: it is the second instance of the same unreachable-bar defect, one day after the first was re-cut, which is the fact worth preserving.

⛔⛔ **SUPERSEDED BY ADR-0038 — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

CARD 2 set the scan-membership FLIP bar at *"`legacy_only == 0` over ≥ 5 sessions on ≥ 3
definitions held by ≥ 2 real members"*, with one synthetic screen enough to **assemble CP4**
but not to flip (`12-decisions/DECISION_CARDS_2026-09-25.md:67-73`).

## Decision as taken

Flip on five sessions of fires across ≥ 3 definitions held by ≥ 2 real members.

## Why it was retired

⛔ **A predicate here is keyed on a FIRE, not a subscription.** Measured on the pod:
`screen_alert_subs` = **4 rows / 2 users**; `screen_alerts_fired` = **4 rows / 1 user**. The
owner's three screens are armed with **zero fires**, so the bar needs membership *movement* in
26wk HV / Above 50 on volume / Oops Reversal — **which is unbounded in sessions**
(`12-decisions/DECISION_CARDS_2026-09-26.md:84-90`).

⛔ *"This is the same trap CARD 1's original `agreed ≥ 20` bar had, and it was already
re-cut once for exactly this reason."* (`:90`)

## Consequences

* Superseded by ADR-0038.
* ✅ The CP4 half was satisfied independently and the cohort was never the limit: the s7-dark
  cohort already held all 29 members (`seed_cohort_all_members` added 0), so *"the absence of real
  member alerts and subscriptions was"* the limit — and **no further widening step exists**
  (`12-decisions/DECISION_CARDS_2026-09-25.md:81-85`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-25.md:67-85`
- `12-decisions/DECISION_CARDS_2026-09-26.md:82-111`
