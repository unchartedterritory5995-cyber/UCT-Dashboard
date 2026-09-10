# Master-push coordination — flow-worker and the OPRA tape

**Why this file exists:** a second Claude session pushed to master four times on the
evening of 2026-09-09 while the options-flow gate work was frozen. None of those
pushes happened to touch a flow-worker-watched file, so nothing was lost — but the
collision is real and no automation guards against it. Coordination is the mitigation,
and it has to survive outside any one chat session.

**Owner action, highest value, do it before 09:30 ET:** relay the paragraph below to
the other session's owner.

⛔ **Do NOT rebuild the market-hours push guard.** The owner deliberately removed it on
2026-08-24 (`143cabd3a`, "no more gating pushes on the clock. Ship whenever"). It also
would not help: a hook only binds sessions that run it, and a GitHub web-UI commit
bypasses it entirely — that is documented history in this repo. Coordination through
the owner reaches writers a hook never would.

---

## The paragraph to relay

> flow-worker is a separate Railway service that runs the live OPRA options-flow
> consumer. It auto-deploys on any push to master whose diff touches one of 23 specific
> `api/*.py` files. When it redeploys, the OPRA websocket drops for the 4–7 minutes the
> container takes to start, and that tape gap is **PERMANENT** — OPRA does not replay,
> and the data is only recovered by the overnight T+1 flat file. So a master push
> touching any of those files between 09:30 and 16:00 ET destroys market data
> irrecoverably. Outside that window the same push is harmless. Nothing you pushed on
> 2026-09-09 touched that list, so nothing was lost. Please avoid pushing changes to
> those files to master during 09:30–16:00 ET on weekdays; docs, tests, and any other
> `api/` file are unaffected by flow-worker (though note `web` currently rebuilds on
> **every** master push including docs-only, which briefly blips `/api/*` for members).

## The 23 watched files

    api/massive_ws_worker.py
    api/massive_processor.py
    api/flow_db.py
    api/bs_iv.py
    api/flow_worker_main.py
    api/live_massive_router.py
    api/flow_router.py
    api/flow_router_mount.py
    api/flow_heal_enrich.py
    api/flow_gap_autofill.py
    api/massive_flatfiles_worker.py
    api/flow_watchdog.py
    api/oi_snapshots.py
    api/massive_stream.py
    api/flow_tape_spool.py
    api/flow_backup.py
    api/dealer_positioning.py
    api/flow_rest_backfill.py
    api/alpha_gold_eod.py
    api/weekly_flow.py
    api/flow_opt_aggregate.py
    railway.json
    requirements.txt

⭐ **Do not retype this list — re-derive it.** It is Railway's live
`serviceManifest.build.watchPatterns` for flow-worker and it can change without any
commit in this repo:

    railway status --json    # -> serviceInstances[].node...serviceManifest.build.watchPatterns

## What actually happened on 2026-09-09 (the measurement)

| commit | touched | flow-worker | worker | bars-api | web |
|---|---|---|---|---|---|
| `590e88084` | `api/main.py` + pattern_vision | **no rebuild** | rebuilt | rebuilt | rebuilt |
| `c7b0686e4` | `pattern_vision/store.py` | **no rebuild** | rebuilt | rebuilt | rebuilt |
| `3b043d0f8` | docs only | **no rebuild** | no | no | rebuilt |
| `8a7c23ec6` | docs only | **no rebuild** | no | no | rebuilt |

`api/main.py` is **not** on flow-worker's list — but it is one file away from being.
That is the whole margin.

The two docs-only commits still rebuilt **web**, the member-facing service, for zero
benefit. That is E6 (web's empty `watchPatterns` = *no filter*) firing twice in one
evening, and fixing it is the durable half of this problem.

Foreign session for the record: `session_01HWGkvQ2snrfWTGH5bXEL2K`, author
"Claude Fable 5", working on Pattern Vision / S7 Terminal.
