# Cutover Plan — Move Massive OPRA Consumer from WEB → WORKER (Zero-Gap Deploys)

*Generated 2026-07-07 from a 5-dimension code map + synthesis. The env flip is trivial and already built; the flow.db data-sharing bridge is the real, unbuilt work and gates the entire cutover.*

**Status: NOT ready to execute. The data-sharing solution does not exist in the code yet — it is the single largest remaining work item, not a config flip.** Everything else (graceful stop, worker start path, env gate) is already built and dormant.

---

## 1. Current state

- **Where the consumer runs today:** On the **WEB** service. `api/main.py` FastAPI lifespan calls `massive_ws_worker.start()` (main.py:2727-2731), inside the `if acquire_scheduler_lock():` block, spawning a daemon thread `massive-ws-consumer` running its own `asyncio.run(_consumer_root())`. Every web/frontend deploy restarts this process and drops the single Massive OPRA WS connection → the ~36s feed gap we are trying to eliminate.
- **What the worker already does:** `api/worker_main.py:444` already calls `_start_massive_ws()` → the *identical* `massive_ws_worker.start()`. The worker boot runs prewarmer, R2 uploader, keepwarm, `start_liveflow_monitor()` (the independent P3 oracle), memwatch, then `uvicorn.run(_build_app())`. **The worker's `_build_app()` exposes ONLY `/internal/health` and `/api/health`** (worker_main.py:336-393) — it does **not** include `flow_router` or any `/api/flow/*` read endpoint today.
- **What decides which pod connects:** purely the per-service env var `MASSIVE_WS_ENABLED` (default `"1"`, massive_ws_worker.py:80). Both pods call `start()`; only the one with `=1` connects. Massive allows **one** options WS connection per account, so exactly one pod may be `=1` at a time.
- **DRY_RUN status:** `MASSIVE_WS_DRY_RUN` (default `"0"`) gates **FlowDB writes only, not the WS connection** (massive_ws_worker.py:85; the write skip is the `if DRY_RUN:` branch ~massive_ws_worker.py:1168). The worker is truly disabled only by `MASSIVE_WS_ENABLED=0`. **⚠️ Flipping the worker to `ENABLED=1` "for a DRY_RUN staging test" while web is still `=1` would open a second live connection and cause a flapping outage.**
- **Graceful stop is built and portable:** `massive_ws_worker.stop(5.0)` (massive_ws_worker.py:2135-2189). Web already invokes it after `yield` (main.py:2810-2823). The P1 spec says the identical block drops into `worker_main`'s shutdown path at cutover — that wiring is **not yet present** in worker_main.

---

## 2. THE DATA-SHARING PROBLEM & SOLUTION — the crux

**The problem (verified in code):**
- The consumer writes `flow.db` at `FLOW_DB_PATH` (default `/data/flow.db`).
- Railway volumes are **single-attach**: web's `/data` and worker's `/data` are **different disks**. No shared filesystem.
- The **read path runs on WEB and opens the file directly**: `api/flow_router.py:49-50` does `DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")` then `db = FlowDB(DB_PATH)` at module import. There is **no proxy, no httpx, no private-networking, no R2 read-bridge** anywhere in the repo.
- Same-volume co-tenants also open `/data/flow.db` directly: `baselines.py`, `color_rebuild.py`, `dealer_positioning.py`, `flow_gap_autofill.py` (P2), `flow_backup.py` (B4), `notable_flow.py`, `flow_summary.py`, `cluster_filter.py`.
- The only R2 rail for flow.db is `flow_backup.py` — a **nightly disaster-recovery snapshot**, explicitly **not** a live read-sync.

**So: if you flip the writer to the worker today, the worker writes its own `/data/flow.db` and the web endpoints keep serving web's now-frozen copy. OptionsFlow would silently go stale. This is the unsolved architectural blocker.**

**Options considered:**

| Option | Mechanism | Verdict |
|---|---|---|
| **A. R2 live-sync** | Worker writes locally; web periodically pulls flow.db from R2. | ❌ Reject. ~792MB DB, grows intraday; minutes of read staleness on a *live* feed; SQLite/WAL point-in-time sync is fragile and egress-costly. Defeats "live." |
| **B. DB + readers move to WORKER; WEB reverse-proxies `/api/flow/*` over Railway private networking** | flow.db becomes worker-owned. Worker's `_build_app()` mounts `flow_router` (+ co-tenant read/write routers). Web's `flow_router` endpoints become thin reverse-proxies to `http://<worker>.railway.internal:$PORT/api/flow/*`. Frontend still hits web; web forwards on CF-cache-miss only. | ✅ **Recommend.** Correct SQLite end-state: single writer + all readers on one volume. **Ravi's `massive_ws_worker` write path is untouched — it just runs in a different process.** |
| **C. DB + readers stay on WEB; WORKER consumer writes back to web over private net** | Consumer runs on worker; POSTs aggregated rows to a new private write endpoint on web; buffers/retries across web restarts. | ⚠️ Alternative. **Permanently reworks Ravi's hot write path** (SQLite flush → HTTP), adds a network dependency to every flush, needs write-buffering during web deploys. More Ravi-area risk. |

**Recommendation: Option B.** SQLite wants one process, one volume — B is the only option that keeps that invariant end-to-end. B does not touch Ravi's ingest/write code at all (the consumer keeps writing local SQLite via `FlowDB.insert_csv`; it just runs on the worker). Read responses are already Cloudflare-edge-cached + in-memory LRU, so the private-net proxy hop happens only on cache-miss. The proxy also cleanly covers the T+1 CSV upload (web forwards `POST /api/flow/upload` to the worker).

**Tradeoffs of B to accept:** (1) one-time migration of the ~792MB flow.db from web's volume to worker's; (2) co-tenant scheduled jobs (baselines, color_rebuild, dealer_positioning, gap_autofill P2, flow_backup B4) must run **on the worker** where the DB now lives; (3) web's `flow_router` must be rewritten as a reverse-proxy. Real engineering — plan a build + review cycle before any cutover night.

---

## 3. What's already done vs left

**✅ Already built:** worker start path (dormant, gated `MASSIVE_WS_ENABLED=0`); per-service env kill-switch; graceful `stop()`; independent monitor (P3) on worker; shared `railway.json` role-switch + `drainingSeconds:30` + `exec` PID-1 + `--timeout-graceful-shutdown 5`; flow.db R2 backup (usable as migration transport).

**❌ Left to build (the real work — none exists yet):**
1. **The data-sharing bridge (Option B):** worker `_build_app()` mounts `flow_router` + co-tenant flow routers; web's `flow_router` rewritten as a private-net reverse-proxy. **Make-or-break, 0% done.**
2. **Worker shutdown wiring:** drop `massive_ws_worker.stop(5.0)` into `worker_main`'s SIGTERM path.
3. **One-time flow.db volume migration** script (web → R2 → worker) with row-count + `integrity_check` verification.
4. **Move co-tenant schedulers** to the worker.
5. **Railway private networking** enabled web↔worker; capture worker internal hostname.
6. **Re-point the monitor** to the new consumer location.
7. **Worker boot-order audit** — nothing slow before `uvicorn` (2026-07-02 incident class).
8. **Precondition:** P0–P3 green ≥1 week incl. ≥1 deploy day. (7/7 is an observation day — do NOT cut over on unproven hardening.)
9. **Massive sandbox / 2nd API key** to test the worker connection live before cutover.

---

## 4. Exact ordered cutover steps (after-close only)

**Zero-data-loss principle:** run the cutover **after 4:20 PM ET when OPRA is silent** — even a multi-minute handoff loses nothing; any residual intraday gap heals T+1 via `flow_gap_autofill`. Never cut over 9:15a–4:20p.

**Pre-cutover:** Option B proxy + worker flow routers + worker `stop()` wiring + migration script all shipped dark on master and verified in staging with the sandbox key.

1. **Freeze check** — clock ≥ 4:20 PM ET, no active prints, P0–P3 scorecard green for the required window.
2. **Snapshot web's flow.db → R2** — record row count + `/api/flow/version`.
3. **Migrate DB → worker volume** — worker pulls the snapshot; **verify worker row count == web** and `PRAGMA integrity_check` = ok.
4. **Release the slot on web FIRST** — web `MASSIVE_WS_ENABLED=0`, deploy; verify web released the Massive slot (never two `=1` pods).
5. **Ship web's flow_router reverse-proxy** — verify web `/api/health` green.
6. **Claim the slot on worker** — worker `MASSIVE_WS_ENABLED=1`, `DRY_RUN=0`, deploy; verify connection established + consumer-state running.
7. **Verify read topology** — `GET /api/flow/data` through web→worker proxy returns 200 with data; OptionsFlow UI renders; `/api/flow/version` matches.
8. **Move co-tenant jobs** to the worker; verify each reads the worker's local DB.
9. **Re-point the monitor** to the worker; confirm HEALTHY.
10. **Overnight watch** — scorecard, no BLIND_DB/WORKER_DOWN alerts.
11. **Next trading day (the real success test):** watch first 9:30 prints land in the worker DB via the proxy, then do a **deliberate market-hours WEB deploy** and confirm **zero flow gap**. That is P5's definition of done.

---

## 5. Rollback

**Instant rollback (after-hours, clean):** worker `MASSIVE_WS_ENABLED=0`, web `=1`, deploy web (P1 `stop()` closes the worker WS cleanly; web reclaims the slot + resumes writing its local DB). Revert/flag-off the web `flow_router` proxy commit. The cutover→rollback window backfills T+1 via `flow_gap_autofill`.

**Emergency rollback DURING market hours:** still a single env-flip + web deploy, but writes since cutover live on the worker volume; rolling to web loses the intraday delta until T+1 gap-fill heals it. Accept that (P2 covers it) — do NOT reconcile DBs mid-session. Pre-agree rollback triggers with Ravi: WS flap loop, worker `/api/health` failing, consumer-state stale >180s, OptionsFlow stale/empty via the proxy.

---

## 6. Risks & unknowns (verify first)

- **Live Railway env values not readable from the repo** — confirm on the dashboard/API before cutover: `MASSIVE_WS_ENABLED` + `MASSIVE_WS_DRY_RUN` per service, `WORKER_ENABLED=1` on worker, `LIVEFLOW_MONITOR_ENABLED=1` on worker, no `FLOW_DB_PATH` override on worker.
- **Scheduler lock semantics** — confirm `acquire_scheduler_lock()` can't be held simultaneously by the worker, or the worker consumer could be silently gated off after cutover.
- **792MB live migration integrity** — copy with online `.backup()` (flow_backup already does this); verify row counts + `integrity_check` on the worker copy.
- **Worker boot order** — audit that neither the consumer nor the newly-mounted flow_router can block `/api/health`.
- **Massive sandbox/2nd key** — unconfirmed; without it the worker connection can't be validated live before cutover night.
- **Private-networking hostname/port** — worker's `.railway.internal` name + listen port for the proxy target; zero repo references today.

---

## 7. Ravi coordination

**Needs Ravi's sign-off (his ingest/worker area):** the topology decision (Option B vs C); any change to `massive_ws_worker.py` (Option B leaves it byte-for-byte unchanged — that's why it's chosen); `worker_main.py` boot order + `stop()` shutdown wiring; the live env flips on the worker.

**Can be prepped/tested independently (app/API, not Ravi's ingest):** rewriting web's `flow_router.py` as a reverse-proxy; the one-time DB migration script; Railway private-networking config + hostname capture; re-pointing `liveflow_monitor`; verifying current Railway env values.

---

## 8. Today (safe, no deploy) vs after-close only

**TODAY — no deploy, no risk:**
- Read the live Railway env values (§6).
- Accumulate the P0–P3 green window (7/7 is observation — no market-hours deploys 9:15a–4:20p).
- **Build the Option B bridge on a branch** (worker flow routers + web reverse-proxy + worker `stop()` wiring) and run `/code-review` — deploy-free until merged.
- Write + dry-run the flow.db migration script against a scratch path.
- Enable Railway private networking (config only); record the worker internal hostname.
- Confirm/obtain the Massive sandbox key.
- Stage (do not apply) the env flips and get Ravi's sign-off on the sequence.

**AFTER-CLOSE ONLY (≥4:20 PM ET):** the live env flips + web/worker deploys (§4 steps 4-6); the one-time live flow.db migration (while OPRA is silent = zero loss); the flow_router proxy deploy + monitor re-point. The market-hours zero-gap validation deploy happens the **next** trading day.

**Hard invariants:** one Massive connection at a time (never two pods `=1`); `DRY_RUN` is NOT slot protection; `lifespan=` not `on_event`; nothing slow before `uvicorn` on the worker; keep `exec` + `drainingSeconds:30` + `--timeout-graceful-shutdown 5` intact.

---

**Bottom line:** the env flip is trivial and reversible; the **flow.db data-sharing bridge (Option B: DB→worker, web reverse-proxies `/api/flow/*` over private networking) is the real, unbuilt work** and gates the entire cutover. Build and review it first, migrate the DB after-close when the feed is silent, flip web→0 before worker→1, and prove zero-gap with a deliberate market-hours web deploy the next morning.
