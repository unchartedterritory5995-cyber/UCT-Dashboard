---
id: ADR-0044
title: The event-loop killer stays unarmed, the arming condition is named — and the arming PROCEDURE is unsatisfiable as written
status: accepted
date: 2026-09-26
decided_by: the programme under owner delegation; the procedure finding is gate item 25's
gate_item: 24, 25
promotion: Locked: a decision NOT to act, with a named condition rather than a matter of taste — and then a second finding that the shipped arming procedure cannot be executed at all, which changes what the condition means.
supersedes: the runbook's own "3–5× observed max_lag" heuristic as applied to an after-hours sample
superseded_by: none
register_row: none
---

# ADR-0044 — The event-loop killer stays unarmed, the arming condition is named — and the arming PROCEDURE is unsatisfiable as written

**STATUS: ACCEPTED** · 2026-09-26 · decided by the programme under owner delegation; the procedure finding is gate item 25's · gate item 24, 25

**Why it is an ADR and not a tracker row:** Locked: a decision NOT to act, with a named condition rather than a matter of taste — and then a second finding that the shipped arming procedure cannot be executed at all, which changes what the condition means.

**Supersedes:** the runbook's own "3–5× observed max_lag" heuristic as applied to an after-hours sample

## Context

Observe mode measured **max lag 14.9 ms over 330 checks** against a **30-second** wedge threshold
— three orders of magnitude of headroom, no missed checks
(`12-decisions/DECISION_CARDS_2026-09-26.md:272-274`).

## Decision

1. **Leave `WATCHDOG_ENABLED` unset. `enabled:false` is the correct state today.** *"That is not
   an argument for arming; it is an argument that nothing is currently wedging, which means arming
   buys no protection today and adds a process that can `os._exit` the member-facing pod."*
   (`:270-275`) ⚠️ The flag's live state is **UNREAD** (ADR-0003).
2. **The condition to arm, stated so it is not a matter of taste:** one observation window that
   **spans a market open** and a **heavy-job window**, showing max lag still far below `wedge_sec`.
   **Every window measured so far is after the close** (`:277-280`).
3. ⛔ **The runbook's own "3–5× observed max_lag" heuristic must NOT be applied to a
   27-minute after-hours sample** — 3–5× of 14.9 ms is ~60 ms, *"which would be a
   vastly more aggressive trigger than the 30 s the watchdog actually ships with"*
   (`:280-282`).

## ⛔⛔ And the procedure as written cannot be executed

`event_loop_watchdog._state["max_lag_ms"]` starts at `0.0` in `_fresh_state()`
(`api/event_loop_watchdog.py:122`, installed `:136`) and only ratchets up in-process
(`:307-308`, `:356-357`). Its own runbook, in the same file, says to watch it *"for a few days"*
across a market open and a heavy-job window (`:46-49`). **Median pod life is 26 minutes.** *"A
maximum-since-boot cannot span days on a process that lives 26 minutes, so the number the arming
decision is supposed to rest on has never existed."*
(`10-roadmap/observability-plan.md:50-115`, finding 2)

⚠️ Item 25 is careful about what that argues: *"that is an argument about the procedure,
not about arming"* (`:830`, point 1).

## Alternatives actually considered

1. **Arm it now on the measured headroom.** Rejected — headroom is evidence nothing is
   wedging, not evidence a killer is wanted.
2. **Arm it at 3–5× the observed maximum.** Rejected on clause 3.
3. **Keep waiting for the runbook's multi-day window.** ⛔ Impossible on a 26-minute pod. S5
   in item 25's signal table is the instrument that could eventually satisfy clause 2, and item 25
   takes **no position on the threshold** (`:830`, point 1).

## Consequences

* ⛔ Item 24 supplies the headroom figure and explicitly does not decide arming
  (`07-technical-architecture/realtime-performance-architecture.md:332-342,589-604`, point 4).
* ⛔ Item 25 wires **nothing** to `os._exit`, a redeploy, or a flag flip — every PAGE is a
  notification (`observability-plan.md:830`, point 2).
* The signal itself is a **cumulative** quantity and so must move out of per-process state before
  clause 2 can ever be evaluated (ADR-0030).

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:268-283`
- `10-roadmap/observability-plan.md:50-115,830`
- `07-technical-architecture/realtime-performance-architecture.md:332-342,589-604`
