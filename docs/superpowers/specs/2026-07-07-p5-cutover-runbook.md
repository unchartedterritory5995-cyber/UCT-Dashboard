# P5 Cutover Runbook — dedicated flow-worker (Option C)

*Execute in order. Each step has a VERIFY gate — do not proceed until it passes.
The FLIP (step 6) is the only feed-affecting step; do it ≥4:20 PM ET (OPRA
silent) and ideally timed so you can watch the next 9:30 open. Rollback is one
env flip.*

**State as of 2026-07-07 evening:** all P5 code is on master + deployed dark
(flags off). The `flow-worker` service is created with dormant env
(`FLOW_WORKER_ENABLED=1`, `MASSIVE_WS_ENABLED=0`, `WORKER_SERVES_FLOW=1`,
`FLOW_PROXY_TRUST=1`, + secret refs to web) but has **no source connected** and
**no volume** yet.

---

## 1. Connect source + volume to `flow-worker`  *(you — Railway dashboard, ~3 min)*
Railway gates GitHub-repo connection to the UI (it grants deploy access to the code).
- flow-worker → **Settings → Source → Connect Repo** → the UCT-Dashboard repo, branch **`master`**.
- flow-worker → **Settings → Volumes → attach** a volume at mount path **`/data`**.
- It will build (~10 min) and boot **dormant** (consumer off, `MASSIVE_WS_ENABLED=0`).

**VERIFY:** flow-worker deploy = SUCCESS; its logs show
`[startup] flow-worker: consumer + flow routers only`.

## 2. Dress rehearsal — dormant boot  *(me — CLI, zero feed risk)*
```
railway service logs --service flow-worker   # confirm boot, no crashes
# via private net from web (or a temporary check): GET <flow-worker>.railway.internal:$PORT/api/health -> {"service":"flow-worker",...}
```
**VERIFY:** `/api/health` returns `service: flow-worker`, consumer `connected:false`
(it's dormant — correct). Flow routes resolve (empty DB, 200). If it crashes, STOP
and fix — the live feed is untouched (web still owns the consumer).

## 3. Enable the flow schedulers on flow-worker  *(me)*
```
railway variables --set FLOW_BACKUP_ENABLED=1 --set FLOW_GAP_AUTOFILL_ENABLED=1 --service flow-worker
```
(These own flow.db post-cutover. They are still ON on web now — disabled in step 7.)

## 4. Capture the private hostname  *(me)*
Note flow-worker's internal address: `http://<flow-worker>.railway.internal:$PORT`
(the value web's proxy will target in step 6).

## 5. Migrate flow.db  →  flow-worker volume  *(me — after-hours)*
```
# on WEB (owns flow.db today):
railway ssh --service web  '/opt/venv/bin/python scripts/flow_db_migrate.py --export'
# on FLOW-WORKER (pulls + installs to its /data):
railway ssh --service flow-worker '/opt/venv/bin/python scripts/flow_db_migrate.py --import'
```
**VERIFY:** import prints `IMPORT OK: installed N rows` with N == web's row count,
integrity ok, WAL sidecars cleared.

## 6. THE FLIP  *(me — ≥4:20 PM ET; the only feed-affecting step)*
Order is load-bearing — never let two pods hold `MASSIVE_WS_ENABLED=1` (flapping trap).
```
# a) web releases the Massive slot FIRST:
railway variables --set MASSIVE_WS_ENABLED=0 --service web ; railway redeploy --service web -y
#    VERIFY web released it: /api/liveflow/consumer-state shows stopped/disconnected.
# b) flow-worker claims the slot:
railway variables --set MASSIVE_WS_ENABLED=1 --service flow-worker ; railway redeploy --service flow-worker -y
#    VERIFY flow-worker consumer connected=true, max_id advancing.
# c) web starts proxying flow reads to the worker:
railway variables --set FLOW_READS_PROXY_ENABLED=1 --set WORKER_INTERNAL_URL=http://<flow-worker>.railway.internal:$PORT --service web
railway redeploy --service web -y
```
**VERIFY:** `https://uctintelligence.com/api/flow/version` returns JSON via the proxy;
the OptionsFlow UI renders live data.

## 7. Retire the web-side flow jobs  *(me)*
```
railway variables --set FLOW_BACKUP_ENABLED=0 --set FLOW_GAP_AUTOFILL_ENABLED=0 --service web
# repoint the monitor to poll the flow worker (it now maps proxied-502 -> WORKER_DOWN):
# (monitor runs on the bars worker; LIVEFLOW_STATUS_URL/CONSUMER_STATE_URL already hit web,
#  which proxies to flow-worker — the 502->WORKER_DOWN fix covers it.)
```

## 8. The real success test  *(next trading day)*
At 9:30 open, confirm flow prints land on the worker via the proxy. Then do a
**deliberate market-hours WEB deploy** and confirm **zero flow gap**. That is P5 done.

---

## ROLLBACK (any time, ~2 min)
```
railway variables --set MASSIVE_WS_ENABLED=1 --service web ; railway redeploy --service web -y   # web reclaims consumer
railway variables --set MASSIVE_WS_ENABLED=0 --service flow-worker                                # flow-worker releases
railway variables --set FLOW_READS_PROXY_ENABLED=0 --service web ; railway redeploy --service web -y  # web serves flow locally
```
Web's flow.db is unchanged by the flip; any intraday delta heals T+1 via gap-fill.
Past ~1 trading day, rollback is a reverse migration, not a flag flip — decide
fix-forward vs rollback within that window.

## Hard invariants
- Never two pods `MASSIVE_WS_ENABLED=1` at once (flapping).
- Flip after 4:20 PM ET / before 9:15 AM ET only.
- `exec` + drainingSeconds:30 + `--timeout-graceful-shutdown 5` stay intact (they are).
- Keep `grep -c broker_sync api/main.py` ≥ 7 on any web push (currently 9).
