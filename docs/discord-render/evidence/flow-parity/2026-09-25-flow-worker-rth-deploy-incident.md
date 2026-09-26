# Incident: a flow-worker deploy during market hours took the whole Options Flow family down (2026-09-25)

**Owner of the mistake:** the flow session (this author). **Member impact:** every Options
Flow surface (the page, Live Flow, Top Flow, Discord `/flow`) answered 502 from 09:59 CT for
most of the session, with ~7-minute readable windows after each restart; the OPRA tape has no
live prints after 09:47 CT until the T+1 flat file lands tonight.

## Timeline (CT; deploy records in UTC on the Railway side)

| time | event | evidence |
|---|---|---|
| 09:42 | `b13c04c4c` (ETF floors, touches `api/live_massive_router.py`, on flow-worker's watch list) pushed to master **during RTH** after the author offered to hold until 16:00 ET and heard nothing | `git log`, pre-push guard "master is quiet" |
| 09:47 | last live print inserted (`last_event_at 14:47:02Z`) — the old container's socket during the swap | `/api/live/massive/status` |
| 09:52 | new container SUCCESS; consumer subscribing to the Q pool but `connected: false`; no inserts | flow-worker log, status |
| 09:59:39 | `flow_watchdog`: "tape FROZEN — no flow.db inserts for 303s during market hours" → `os._exit(43)`. Railway attempted a restart (log shows only "Mounting volume"), then marked the deployment **CRASHED** and did not bring it back | flow-worker log, `railway deployment list` |
| 10:22 | `railway redeploy --service flow-worker` (the repo's recorded recovery for a crashed deploy) | this session |
| 10:28 | up; `connected: false`, `last_event_age_sec` climbing from 2534 | status poll every 30 s |
| 10:36:10 | watchdog exit again ("no inserts for 300s"), deployment CRASHED again | flow-worker log |
| 10:38 | attempt to set `FLOW_FREEZE_WATCHDOG_ENABLED=0` (the lever that breaks the loop) refused by the operator harness as a safeguard change; handed to the owner | this session |
| 12:51 | HTTP up again (a further restart), consumer still `connected: false`, age 11,060 s | status |
| 13:20 | 502 again — the loop continues until the watchdog's window closes at 15:55 ET | status |

Ruled out: a second client on the Massive options key (no local backend on the operator's
box; only `flow-worker` carries `MASSIVE_WS_ENABLED=1` across all seven services). The code
change is read-only rollup logic and the tape ran the whole morning on the identical perf
commit, so the deploy — the socket handoff — is the cause, not the diff.

## What the mechanics turned out to be (measured today, not in any runbook before)

1. A mid-session flow-worker swap can leave the NEW consumer unable to authenticate for far
   longer than the "10–30 s zombie overlap" the code assumes. Today it never reconnected.
2. `flow_watchdog` then kills a process that is serving HTTP perfectly well, because its
   freeze rule cannot tell "consumer wedged" from "consumer cannot get the socket".
3. Railway marks the exited deployment **CRASHED** and does **not** restart it (the log shows
   one restart attempt that printed nothing after mounting the volume). So each watchdog exit
   is a full outage of the flow family, not a 60 s blip.
4. `railway redeploy` buys ~7 minutes of HTTP and then repeats 2–3. Two kicks were tried; the
   runbook's "do not restart-loop" rule is right.
5. The only lever that breaks the loop without a human at Massive is
   `FLOW_FREEZE_WATCHDOG_ENABLED=0` + restart, so the consumer's reconnect ladder can reach its
   600 s rung while HTTP stays up. That is an owner action.

## The rule this writes into `docs/runbooks/deploy-windows.md`

**A change to any flow-worker watch-list file ships after 16:00 ET or on a weekend, with no
exceptions and no override.** "Never delay a deploy" is a rule about `web`. Offering to hold
and hearing nothing is not permission.

## Related

- `docs/runbooks/liveflow-unstick.md` (the gates and the escalation to Massive support)
- `api/flow_watchdog.py` (the freeze rule), `api/massive_ws_worker.py` (`MAXCONN_LADDER`)
- memory: `project_discord_flow_card_parity_2026_09_24`
