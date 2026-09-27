---
id: ADR-0032
title: `stale-swr` counts as SERVED; gate on latency, report the tier mix beside it, keep one RTH tier alarm
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation
gate_item: 24, 25
promotion: Locked: a ruling with a stated reversal condition that is a named future observation, not an awaited input. ⚠️ But it is NOT EVALUABLE today, and the record says so.
supersedes: ADR-0031
superseded_by: none
register_row: none
---

# ADR-0032 — `stale-swr` counts as SERVED; gate on latency, report the tier mix beside it, keep one RTH tier alarm

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation · gate item 24, 25

**Why it is an ADR and not a tracker row:** Locked: a ruling with a stated reversal condition that is a named future observation, not an awaited input. ⚠️ But it is NOT EVALUABLE today, and the record says so.

**Supersedes:** ADR-0031

## Context

The warm-ratio gate called a 104 ms cache-served response a total failure (ADR-0031).

## Decision

**`stale-swr` counts as SERVED, and the ≥ 99 % `mem`/`sqlite` gate is retired in favour of a
latency gate**, on the same one command
(`12-decisions/DECISION_CARDS_2026-09-26.md:209-220`):

* **Gate on latency, not tier:** **p95 ≤ 250 ms per timeframe, measured on a pod ≥ 300 s
  old.**
* **Report the tier mix beside it, never as a pass/fail** — `stale-swr` share is a
  *freshness* signal and belongs in the same row as the revalidation question.
* ⚠️ **Keep one tier-based alarm:** any `fetch`/`miss` share above ~10 % on intraday
  during **RTH** is still a real regression (that is the August defect), and `stale-swr` is *not*
  exonerated there — *"a stale intraday bar during the session is a different product than a
  stale daily bar after the close"*, and the run that motivated this was taken after the close.

**Reversal condition:** an RTH run showing `stale-swr` on intraday with materially wrong prices,
which would make the tier the right gate after all (`:222-224`).

Item 25's OBS-1 supplies the missing definition: **client wall-clock**, n ≥ 60 per timeframe,
with the tier mix beside and never as pass/fail (`10-roadmap/observability-plan.md:759-776`).

## Alternatives actually considered

1. **Keep the tier gate and accept it fails on daily.** Rejected — a gate a healthy system
   fails gets waived (ADR-0033).
2. **Gate on server compute instead of client wall-clock.** Named as OBS-1's overturn: read `dur`
   from `Server-Timing` (`bars.py:912-927`), which `bars_warmth_audit.py:62-64` currently
   discards, and set a lower bar (`observability-plan.md:759-776`).

## Consequences

* ⛔⛔ **The gate cannot be evaluated today on the timeframe that motivated it.** The
  recorded *"daily p50 104 ms / max 301 ms — PASS"* was read off the **COLD** line at
  `bars_warmth_audit.py:113-116`, which prints p50 and **max**, never p95
  (`observability-plan.md:50-115`, finding 3). Two lines of a tool are the whole fix, and item 25
  G-2 states it with the control that proves it landed (`:351-395`).
* Item 24's §2.1 carries the same finding as *"the serving layer is fast, and its stated gate
  is unusable"* (`07-technical-architecture/realtime-performance-architecture.md:286-306`).
* ⚠️ The pod-age precondition (≥ 300 s) is itself load-bearing and is OBS-7's
  shipped default (`observability-plan.md:759-776`).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:203-224`
- `10-roadmap/observability-plan.md:50-115,351-395,759-776`
- `07-technical-architecture/realtime-performance-architecture.md:286-306`
