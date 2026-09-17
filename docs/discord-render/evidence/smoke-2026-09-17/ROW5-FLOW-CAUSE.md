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

---

## ⛔⛔ AND ROW 5 CANNOT PASS AS WRITTEN — the ETF partition is selected ONLY by the V2 handler

Row 5's assertion is *"Real contracts, not 'no significant options flow' — the C-14 ETF partition
(`discord_render.symbols.flow_source` → `etfs`)"*. **That function is called from exactly one
place, and it is not the path production runs.**

| path | call | partition |
|---|---|---|
| **pre-V2** (live on every pod) | `api/routers/discord_interactions.py:499` — `background.add_task(run_flow_card_job, app_id, token, tkr, days)` | **no `source` argument** ⇒ the signature default `source: str = "stocks"` |
| **V2** (dark) | `api/services/discord_render/commands.py:578-586` — `source = symbols.flow_source(tkr)` … `source=source` | `etfs` for an ETF or index underlying |

So `/flow SPY` on production asks flow-worker for **SPY in the `stocks` partition**, which is the
wrong partition for an ETF by C-14's own definition. **Row 5 is NOT RUNNABLE BY CONSTRUCTION while
`DISCORD_RENDER_V2_ENABLED` is unset**, for the same reason as rows 2, 3 and 7 — and this one was
hiding inside the row's own sentence: it names `discord_render.symbols.flow_source`, a function in
the V2 package, as the mechanism, and nobody asked who calls it.

⭐ **This is the FOURTH instance of the class in one programme** (OI-42 `loop`, OI-45 the page,
OI-47 the health fields, and now the flow partition). Every one has the same shape: the capability
is built, tested and correct, and the only door to it is behind the dark flag.

### What the 10:00 ET run can therefore still establish, and what it cannot

- ✅ **Whether the 30 s timeout recurs during regular trading hours.** That is the controlled pair
  this document opened, and it is unaffected by the partition question — a timeout is a failure to
  answer, not a wrong answer.
- ✅ **Row 6** — `/flow` on an equity underlying. `stocks` **is** the pre-V2 default, so row 6 is
  the one flow row that can legitimately pass today.
- ❌ **Row 5 as written.** Even a perfectly healthy read would return the `stocks` partition for
  SPY. Scoring it PASS on a card that rendered would be scoring the wrong assertion; scoring it
  FAIL would blame the run for the flag.
