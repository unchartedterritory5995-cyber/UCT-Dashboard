# Resuming TERM-011 step 3 — and two corrections to the salvage commit above it

⛔⛔ **The salvage commit `07c7ffcec` contains TWO WRONG INSTRUCTIONS from me (the
integrator). Read this before following it.**

## Correction 1 — the `alert_routing` rail must be **DELETED**, not replaced

`07c7ffcec` says *"It must be REPLACED, never deleted: a rail removed is coverage removed."*
I asserted that twice — in the lane's brief and again mid-flight — and **the rail's own
author disagrees, in writing, and is right**:

> `tests/test_alert_routing.py::test_nothing_under_api_imports_this_module_yet`
> *"⭐ IF YOU ARE WIRING THE FIRST CONSUMER, DELETE THIS TEST IN THAT SAME COMMIT.
> Leaving it and marking it xfail would turn a deliberate landing into a warning nobody
> reads; deleting it is the record that step 3 happened."*

⭐ The reasoning is better than mine. That test asserts **"there are no consumers"** — a
property that does not *narrow* when step 3 lands, it simply stops being true. There is no
"narrower invariant" version of it. Step 3's coverage comes from `test_alert_destination.py`,
not from a mutilated version of a rail whose whole subject has gone.

**So: delete it, in the same commit as the conversion.** The deletion IS the record.

## Correction 2 — the second red is RED-BEFORE-GREEN, not sloppiness

`07c7ffcec` files `test_the_refusal_names_THE_PRODUCER_and_not_this_modules_plumbing` as
*"unfinished work failing its own rail"*. Accurate but unfair, and the framing matters
because it invites someone to delete the test instead of finishing it.

**It is a real defect the new layer introduces, with its rail written first.**
`alert_routing._producer_of` walks `sys._getframe(2)`. From inside `resolve_channel`, frame 2
is whoever called it — and once `alert_destination` sits between the producer and the
resolver, that is **`alert_destination`, for every producer, on every refusal**. R2's whole
point is *"an unclassified emitter fails the rail BY NAME"*, and a refusal naming the
resolver's plumbing names nobody.

⛔ **Do not "fix" it by relaxing the assertion.** The fix is that the reader derives its OWN
caller and passes it through — the test's second half already exercises the explicit
`producer=` argument, so the seam exists.

## What is actually still owed

1. Delete the `alert_routing` no-consumer rail (correction 1).
2. Make `destination_for` derive and pass its caller so refusals name the producer (correction 2).
3. ⛔⛔ **THE DELIVERABLE, AND IT IS STILL UNPROVEN:** with `DISCORD_OPS_WEBHOOK_URL` and
   `DISCORD_BUSINESS_WEBHOOK_URL` **blank** — which is how production is right now — every
   alert must land **byte-identically** where it lands today. No test demonstrating that has
   been run. An ops alert that silently goes nowhere is worse than one in the wrong room,
   because that channel carries the pager. Prove it, then mutate the blank path to route
   elsewhere and show the proof goes RED.
4. Re-gate: `test_alert_routing.py`, `test_alert_destination.py`,
   `test_chart_health_severity_vocabulary.py`, `test_chart_health_escalation.py`,
   `test_chart_health_alerts.py`, `test_term018_every_guard_can_fire.py`.
   Baseline at `07c7ffcec` was **235 passed, 2 failed**. ⛔ The emit-site pins (21/22) PASSED
   there — if they later go DOWN, read the FEWER message before touching the number.

## Scope, unchanged

Step 3 only. There are **EIGHT** steps, not seven; step 8 (remove the fallback) is admissible
only on a measured `fallback=0` over a full weekly cycle, so it is not reachable by building.
⛔ Not step 4 (second transport), not step 5 (the 9 fallback posters), not step 6 (the 13
BOTH rows — decisions, one commit each), not step 7 (door A, `alerts.py:350`).
