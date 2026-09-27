---
id: ADR-0035
title: S7 price-level flip bar v2: `agreed ≥ 5` across ≥ 3 predicates on levels set by REAL members
status: superseded
date: 2026-09-25, superseded in part 2026-09-26
decided_by: the programme under owner delegation
gate_item: n/a (S7 checkpoint)
promotion: Promoted as the middle generation of the reversal chain. Its persistence and scope rulings still stand, and are recorded in its own Consequences below, but its `legacy_only` clause was re-cut, so the record is marked superseded and says which half survived.
supersedes: ADR-0034
superseded_by: ADR-0036 (the `legacy_only` clause only)
register_row: none
---

# ADR-0035 — S7 price-level flip bar v2: `agreed ≥ 5` across ≥ 3 predicates on levels set by REAL members

**STATUS: SUPERSEDED** · 2026-09-25, superseded in part 2026-09-26 · decided by the programme under owner delegation · gate item n/a (S7 checkpoint)

**Why it is an ADR and not a tracker row:** Promoted as the middle generation of the reversal chain. Its persistence and scope rulings still stand, and are recorded in its own Consequences below, but its `legacy_only` clause was re-cut, so the record is marked superseded and says which half survived.

**Supersedes:** ADR-0034

⛔⛔ **SUPERSEDED BY ADR-0036 (the `legacy_only` clause only) — DO NOT ACT ON THIS RECORD.** It is kept, with its reasoning intact, because deleting it is how the next engineer re-proposes it.

## Context

v1 could not complete (ADR-0034). The measured state on 2026-09-25 ~05:00Z: **13 predicates**,
**12 verdict-ready** at ≥ 5 sessions, **one genuine agreed event**, **zero `new_only`
anywhere**, `legacy_only` **2,344** on exactly one predicate, trendline/anchor-rewrite exercise
**still zero** (`12-decisions/DECISION_CARDS_2026-09-25.md:16-25`).

## Decision as taken

**FLIP when:** `agreed ≥ 5` across `≥ 3 distinct predicates`, `new_only == 0`,
`legacy_only == 0` excluding pre-window persistence, over `≥ 5 sessions`, **on levels set by
real s7-dark members** — the smoke account arms nothing by rule
(`:46-49`).

**Plus one human step, and it was completed the same day:** a real s7-dark member sets 3–5
price alerts within ~2 % of the market on liquid names through the ordinary Watchlists door
(`:50-53`). ✅ Done 2026-09-25 ~05:55Z from the owner's own account — five fixed-price
alerts within ~1–1.5 % of the market, all read back active, with the smoke account signed out
of that browser first (`:58-63`).

## Why its `legacy_only` clause was re-cut

The 2,344 was then characterised: **one predicate holds all of it, it has ONE span, the span is
five consecutive sessions ending 2026-09-18, it has gained none of the five trading sessions
since, and `agreed` over those same sessions is 0**
(`12-decisions/DECISION_CARDS_2026-09-26.md:398-406`). Read together: the legacy rule evaluated
true on essentially every tick for five days while the new rule never did — **a stale alert
sitting on the wrong side of its own level, re-firing forever.** See ADR-0036.

## Consequences

* The `legacy_only` clause is superseded by ADR-0036.
* ✅ **Its other two rulings SURVIVE and are superseded by nothing**, so they are recorded here
  rather than given a separate ADR:
  1. **Persistence semantics — one-shot.** The member-facing legacy already is:
     `watchlist_alert_service._trigger_alert` sets `is_active = 0` before any channel runs (line
     183; its docstring at 262–282 describes the silence as terminal). ⛔ *"Re-fires every minute"
     describes only the DARK mirror's stateless test, never what a member has ever received.* So
     the flip ships **one fire per predicate per arm**, exactly what members know; a member-visible
     "re-arm on the opposite cross" control is a later checkpoint, not a v1 default.
  2. **Scope — fixed-price levels only.** Trendline/anchor-rewrite has **zero** dark exercise
     (`is_trendline: false` on all 13) and stays on the legacy path until it has its own five
     sessions. (`12-decisions/DECISION_CARDS_2026-09-25.md:29-38`)
* ⭐ The "real member arms it" requirement survives untouched and is what makes both bars
  measurable at all.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-25.md:11-63`
- `12-decisions/DECISION_CARDS_2026-09-26.md:394-438`
