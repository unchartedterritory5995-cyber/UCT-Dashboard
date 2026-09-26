---
id: ADR-0043
title: A guard is fixed by re-timing the job, never by moving a shared rule — and it ships with a rail that has been watched to fire
status: accepted
date: 2026-09-26 — ⛔ DECIDED, NOT SHIPPED
decided_by: the programme (gate item 14 author, verified independently at source)
gate_item: 14, 27
promotion: ⚠️ ON THE BOUNDARY, and said rather than forced: the DECISION (which fix, and that it needs a rail) has locked; the CHANGE has not shipped and needs an explicit owner deploy authorisation plus a member-impact paragraph. It is promoted because it is an architectural consequence about how this codebase writes guards, not just a bug.
supersedes: none
superseded_by: none
register_row: none
---

# ADR-0043 — A guard is fixed by re-timing the job, never by moving a shared rule — and it ships with a rail that has been watched to fire

**STATUS: ACCEPTED** · 2026-09-26 — ⛔ DECIDED, NOT SHIPPED · decided by the programme (gate item 14 author, verified independently at source) · gate item 14, 27

**Why it is an ADR and not a tracker row:** ⚠️ ON THE BOUNDARY, and said rather than forced: the DECISION (which fix, and that it needs a rail) has locked; the CHANGE has not shipped and needs an explicit owner deploy authorisation plus a member-impact paragraph. It is promoted because it is an architectural consequence about how this codebase writes guards, not just a bug.

## Context — a verified production defect

The morning-wire missed-run watchdog **cannot fire on the morning it was built for.** Three facts,
each true on its own (`12-decisions/DECISION_CARDS_2026-09-26.md:758-764`):

1. **The watchdog runs once, at 09:05 ET, weekdays** — `api/main.py`,
   `register_wire_watchdog_job`: `CronTrigger(day_of_week="mon-fri", hour=9, minute=5,
   timezone=_ET)`.
2. **Its test is `if wire_date < expected`**, where `expected = _expected_wire_date()` — an
   alias (`api/routers/engine_data.py:58-68`) delegating to
   `api/services/engine.py::expected_wire_date`.
3. **`expected_wire_date()` ROLLS BACK ONE DAY before 09:30 ET:**
   `if now.weekday() < 5 and (now.hour, now.minute) < (9, 30): d = d - timedelta(days=1)`.

⛔ **So at 09:05, `(9, 5) < (9, 30)` is TRUE and `expected` is YESTERDAY. A wire that missed
this morning's run is dated yesterday. `yesterday < yesterday` is FALSE. The alert does not fire
— and because the job runs only at 09:05, it does not fire later that day either. It can only
fire once the payload is TWO days stale.**

⚠️ **The member badge has the same root and a different blast radius.**
`engine.py::wire_freshness` returns `"fresh" if wire_d >= expected_wire_date()`, so before 09:30 a
one-day-stale payload reads **fresh**, then self-corrects at 09:30. **So the badge is wrong only
during 07:35–09:30 ET; the ALERT is wrong all day** — and 07:35–09:30 is the entire
pre-open window, which is what the morning wire is FOR (`:766`).

## Decision

1. **Move the cron past the rollback boundary** — `hour=9, minute=35` (or later) instead of
   `minute=5`. After 09:30 `expected` is today, a one-run miss gives `yesterday < today` →
   True, and the alert fires correctly (`:776`).
2. ⭐ **Preferred over changing `expected_wire_date()`**, because that function is deliberately
   ONE COPY shared with `/api/leadership`, the breadth payload and the exposure payload — its
   own docstring says two implementations *"would drift into two different answers on the same
   day"*. **Re-timing one job touches one caller; changing the shared rule moves the member-facing
   freshness boundary for every surface that reads it** (`:776`).
3. ⚠️ **A rail must come with it, or the fix is unprovable:** a test that pins the job's
   scheduled minute ON THE FAR SIDE of the 09:30 boundary, and asserts the comparison FIRES for a
   one-day-stale payload at the scheduled time. **A guard nobody has watched fail is not a guard**
   (`:778`).

## Alternatives actually considered

1. **Change `expected_wire_date()`'s rollback.** Rejected — one shared authority, four
   consumers, and the member-facing freshness boundary moves for all of them.
2. **Add a second watchdog run later in the day.** Not proposed; re-timing the single run is
   strictly smaller.
3. **Ship the fix without a rail.** Rejected by clause 3.

## Consequences — why this is an architecture decision and not a bug report

* ⭐⭐ **It is the `gate_that_cannot_fail` class.** **The guard's own docstring names the
  case it misses**: it says it fires when the served wire *"still carries a pre-today date"*
  — but at 09:05 a pre-today date is precisely the EXPECTED state, by the very function it
  asks. **The docstring and the comparison disagree, and the docstring is the one a reader
  believes.** (`:768-770`)
* ⚰️ **The incident it was built to catch is recorded, dated, in a docstring twelve lines
  away.** `wire_freshness`'s own block: *"On 2026-08-14 the 06:35 run crashed before pushing and
  the dashboard served the prior day's rating all day with nothing on screen, or in the payload,
  able to say so."* **That is this exact failure, and the watchdog added to catch it still cannot.**
  (`:772`)
* ⛔ **NOT SHIPPED. This is a `master` change and master is production**, so it needs an
  explicit owner *"deploy"* plus a member-impact paragraph. Recorded so the finding cannot be lost;
  **the decision to ship is the owner's** (`:780`).
* The general form binds every guard in the estate: **a guard whose docstring and whose comparison
  disagree is a guard that has never been watched to fire.**
* ⛔⛔ **RE-AFFIRMED 2026-09-26, and the re-affirmation is the point.** A later owner
  instruction to *"make judgement calls and decisions"* was explicitly held **not** to authorise
  this deploy: *"'Make judgement calls and decisions' was said in the context of two research
  questions, and reading it as deploy authorisation would be exactly the inference that rule exists
  to prevent — the same shape as defaulting over an unread answer (CARD 17) or reading a
  clearance as covering feeds nobody has bought (CARD 26 §4)."* **The fix, its one-line change
  and its required rail are all recorded and ready; it ships when the owner says the word**
  (`12-decisions/DECISION_CARDS_2026-09-26.md:828-830`). See ADR-0008 and ADR-0015 for the other
  two instances of that inference class.

## Sources

- `12-decisions/DECISION_CARDS_2026-09-26.md:754-781`
- `00-program-control/MASTER_CHECKLIST.md:20`
