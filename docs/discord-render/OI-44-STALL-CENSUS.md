# OI-44 — the event loop is blocked for seconds at a time, all day, at every uptime

**Measured 2026-09-15 21:42 ET → 2026-09-17 07:32 ET. 34 pods, 1,292 readings, 28 gaps,
33.9 hours.** Collected unattended by `UCT-D14-Monitor`; re-derive with
`python docs/discord-render/instruments/d14_stall_census.py`.

---

## THE VERDICT

**OI-44 is CONFIRMED, and it is not the defect it was named as.** R43 asked whether a
≥1,000 ms stall appears in the boot window on ≥2 of the first 5 pods. It does — but that
framing understates it by more than half.

| measure | value |
|---|---|
| stalls ≥ 1,000 ms | **42 events — 29.7/day** |
| …of which **provably past uptime 900 s** | **27** |
| stalls ≥ 5,000 ms (R34 tier 1) | **11 events — 7.8/day** |
| pods affected | **15 of 34** |
| **largest single block** | **80,249 ms — at uptime 2,510–2,838 s** |

⛔⛔ **Q6's "STARTUP-CLASS" VERDICT IS OVERTURNED.** D-12 reached it from SEVEN trailing
windows on ONE pod over 30 minutes, and by the rule it was applied honestly — the clean
post-minute-15 window really was observed. It was simply a verdict about one pod.
**27 of 42 stalls are provably past the 900 s floor**, including 80 s, 20 s and 14 s blocks
on a pod that had been up for 40–58 minutes. This is not a startup artifact. It is
continuous.

⭐ **The verdict is robust to the grouping.** Three successive pod-identity schemes (raw
sha, 60 s boot bucket, 120 s boot cluster) gave 42–44 events and **27 settled in every
one**. The conclusion does not depend on the identity fix below.

---

## THE WORST OF IT — one pod, Wed 16 Sep, post-close

`fea2778d85cd`, four escalating blocks in 40 minutes:

| ET observed | uptime range | block |
|---|---|---|
| 16:23:06 | 722–1,041 s | 3,141 ms |
| 16:46:04 | 2,109–2,419 s | **20,621 ms** |
| 16:53:03 | 2,510–2,838 s | **80,249 ms** |
| 17:03:44 | 3,173–3,483 s | 14,175 ms |

**80 seconds** is 26.7× the 3 s Discord ack budget. For that window every member request to
`web` — the SPA, every `/api/*` call, every interaction — was behind a blocked loop. The
cluster sits just after the 16:00 ET close, when the breadth collector, the EOD updaters and
`/api/push` all land. ⚠️ **That is a hypothesis, not a finding**: the monitor reads the loop,
not the request log. Attribution needs W1's durable stall record, which timestamps each stall
so it can be joined to what the pod was doing.

And one long-lived pod, `9081799f2973`, stalled ≥1,000 ms **fifteen times** between uptime
99 s and 29,850 s (8.3 hours) — 00:12, 01:01, 02:09, 03:46, 04:17 ET among them. Intervals
of 31–97 minutes: recurring, but not on a clean period, so **no single cron explains it**.

---

## CONSEQUENCES

**1. R35 fires. The tier-1 page rate would be 7.8/day against a threshold of 2.**
R35 says the response is to fix the cause, never to raise the number. **OI-44 becomes
D-14's first work item**, ahead of the canary.

**2. ⛔ Batching the other workstreams' deploys would NOT fix this.** The expectation was
that ~20 deploys/day × one boot-window block was the cost. **27 of 42 stalls are settled,
not boot** — they happen on pods that have been up for tens of minutes to hours. Fewer
deploys would remove some of the 11 boot-class events and none of the 27 settled ones.

**3. C-02 is not closed and is worse than characterised.** C-02 is "ack and renderer fail
together because the one loop is blocked". This is that mechanism, measured, at 29.7 events
a day.

**4. The member flip (R40/W6) should not precede the fix.** V2 ack lives on this loop. An
80 s block is a mass ack failure whatever the render path does, and R41's rollback cannot
help — rollback changes which code serves, not whether the loop is blocked.

---

## WHAT THE INSTRUMENT GOT WRONG FIRST — three bugs, each a known class

Recorded because each would have published a confidently wrong number, and two were caught
only by the self-check.

1. **A running-maximum detector goes blind after a big stall.** `max_ms` is a trailing
   ~5-minute window and DECAYS; a running max never does, so after an 80 s stall nothing
   smaller is ever counted again. Found 24 events; the correct detector finds 42. **-43%.**
2. **A stall present in a pod's FIRST reading was never counted** — exactly the boot-window
   class the census exists to measure. The `--self-check` planted two stalls and the detector
   reported one.
3. ⛔⛔ **A COMMIT SHA IS NOT A POD IDENTITY.** `RAILWAY_GIT_COMMIT_SHA` names the commit;
   several pods run the same commit. Grouping by it merged 2–3 independent uptime clocks into
   one series, which interleaved on sort and counted `465b12e3601f`'s single 18,741 ms stall
   **three times**. Identity is `(sha, boot)` where boot = observation − uptime, clustered at
   120 s — at 150 s it merged two pods that booted 133 s apart.
   (`lesson_an_identity_join_is_not_a_correctness_check`.)

The census now reports **identity coherence** (pods whose wall-clock is non-monotonic) and
requires it to be 0. It is.

⭐ **And the whole dataset exists only because the poller writes explicit `gap` records.**
28 of them are in the file. A silent absence would have read as "no stalls overnight" —
and for the first 15 minutes it was doing exactly that, from a scheduled task whose Railway
CLI could not resolve its project.

**Every count here is a LOWER BOUND**: two stalls inside one 90 s poll gap are one
observation, and a stall smaller than the window's current max is invisible.

---

## NEXT

1. **W1 commit A** — the durable stall record is now the attribution instrument, not just a
   better diary. It must record wall-clock + uptime so a stall can be joined to the request
   log and the scheduler table.
2. **Correlate** the post-close cluster against the APScheduler job table and `/api/push`.
3. **Fix per R43** — move the blocking work off the loop, with the rail (a synthetic boot on
   fixed code shows no ≥1,000 ms stall) and the mutation (fix removed → RED).
4. Re-run this census across the next 10 pods after the fix. The number to beat is
   **29.7/day and 7.8/day**.
