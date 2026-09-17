# Row 5 — the refusal's real cause, captured for the first time

⛔ **THIS IS THE OBSERVATION SMOKE-3.5 NAMED AS MISSING.** Its row-5 note says the cause is
*"recoverable only from web's `[flow] fetch failed …` warning line or flow-worker's access log via
the `cid` query parameter, and **both age out of Railway's retained window**. Capture them during
the run or not at all."* This is that capture.

## The pre-market control run — 2026-09-17 09:09 ET

**Command:** `/flow ticker:SPY days:30` in `#render-smoke`, commit `d9455a6d64a5`.

**What the member saw** (8:09 AM CT = 09:09 ET):

> ⚠️ The flow feed is reconnecting — couldn't read **SPY** right now. Try again in a moment.

**What `web` actually logged**, read 90 s later and therefore inside the retention window:

```
2026-09-17 13:10:08,217 WARNING api.routers.discord_interactions: [flow] fetch failed SPY (30): timed out
```

⭐⭐ **IT IS A TIMEOUT, AND THE MEMBER SENTENCE CANNOT SAY SO.** `api/routers/discord_interactions.py:228`
is `httpx.get(f"{WORKER_INTERNAL_URL}/api/live/massive/ticker-flow", …, timeout=timeout_s)`, and the
`httpx.TimeoutException` branch at `:229` sets `fail_cls = "flow_timeout"`, `fail_detail = "no answer
in {timeout_s}s"`. **That classification is computed and then thrown away**: the member gets the
pre-V2 catch-all, which says *the flow feed is reconnecting* for a timeout, a transport error, an
HTTP 5xx and a genuinely reconnecting feed alike. Wiring `fail_fn` is the V2 failure contract, and
V2 is dark — so this is OI-45's family again: **the diagnosis exists, in a variable, and no door
carries it out.**

⚠️ `(30)` in the log line is the **days** argument, not the timeout: the format is
`"[flow] fetch failed %s (%s): %s" % (ticker, days, e)`. The timeout value is `timeout_s` and is
**not in the line** — a second thing the log cannot tell you.

## The flow-worker half: NO record, and that proves nothing

`railway logs --service flow-worker` across 13:08–13:11 carries **only its own APScheduler lines**
(`catch_up`, `auto_push_scan_single`, every one "executed successfully" in ~1 ms). There is no line
for the inbound `ticker-flow` request.

⛔ **DO NOT READ THAT AS "THE REQUEST NEVER ARRIVED."** The 500 captured lines contain **no inbound
request line of any kind** — flow-worker is not emitting access logs at this level — so the
instrument could not have seen a presence, and its silence distinguishes nothing. *An absence is
evidence only if the instrument could have seen a presence.* The `cid` is passed as a query
parameter precisely so a flow-worker access log could join the two halves; today there is no such
log to join to.

**So the honest reading is:** web asked flow-worker for `SPY/30` and did not get an answer inside
its timeout. Whether flow-worker never received it, received it and was slow, or answered too late
is **NOT ESTABLISHED** by anything captured here.

## What this does to the "pre-market" hypothesis

SMOKE-3.5 records that row 5 was run at 08:10 ET on 2026-09-14 and 2026-09-15 and refused both
times, and that *"pre-market is a plausible benign explanation and is NOT established."*

This run is the **pre-market half of a controlled pair** on one commit and one pod. The 10:00 ET
run is the other half. ⭐ **A timeout is not obviously a pre-market phenomenon** — a feed that is
merely empty before the open would answer quickly with nothing, not fail to answer — so the
hypothesis is already looking weak. **One reading is not a result.** The RTH run decides it, and
its own `[flow]` line must be captured the same way.
