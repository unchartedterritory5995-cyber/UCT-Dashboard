---
id: ADR-0052
title: BRK-09 (transcripts) is DOWNGRADED to INFERRED and must not drive priority — re-read first, build second
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: 9
promotion: Locked: a priority decision with a named precondition (a coverage re-read) and a stated reason the feature is not the actionable half. It is the counterweight to ADR-0012's coverage thesis.
supersedes: BRK-09's presentation as "the biggest silent failure"
superseded_by: none
register_row: none
---

# ADR-0052 — BRK-09 (transcripts) is DOWNGRADED to INFERRED and must not drive priority — re-read first, build second

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item 9

**Why it is an ADR and not a tracker row:** Locked: a priority decision with a named precondition (a coverage re-read) and a stated reason the feature is not the actionable half. It is the counterweight to ADR-0012's coverage thesis.

**Supersedes:** BRK-09's presentation as "the biggest silent failure"

## Context

Item 9 flagged BRK-09's break-out as **inferred, not evidenced** — no JTBD verdict names an
external transcript product, and **neither AlphaSense nor Quartr is a tool the owner was asked
about** (`12-decisions/DECISION_CARDS_2026-09-26.md:824`).

## Decision

✅ **It stays in the ledger as INFERRED and is excluded from the top of any roadmap** until
`RG-15`'s coverage re-read happens — still `planned` 24 days on (`:824`).

⚠️ **The actionable half is the MONITOR, not the feature.** The coverage reading was
`transcript: null (n=0)`, and **if that is stale the row collapses from "biggest silent failure" to
"fine, needs a monitor"**. ⛔ **Re-read first, build second** (`:824`).

## Alternatives actually considered

1. **Build the transcript coverage feature on the inferred break-out.** Rejected — the
   evidence is an `n=0` reading nobody has re-taken, and ADR-0005 is exactly about not trusting a
   dated cell in either direction.
2. **Drop the row.** Rejected — it stays in the ledger, labelled INFERRED.

## Consequences

* ⭐ **This is the necessary counterweight to ADR-0012.** Under an aggregation thesis every
  named gap is a reason to build, so **a gap whose evidence is one stale null reading is the exact
  place the thesis would spend the most money for the least reason.** The rule the pair produces:
  *a coverage gap is a build candidate only after its absence has been re-measured.*
* It is the same shape as ADR-0041/0042 (a dated claim about a dependency) and ADR-0005 (a dated
  cell), applied to a gap rather than to a capability.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:820-824`
