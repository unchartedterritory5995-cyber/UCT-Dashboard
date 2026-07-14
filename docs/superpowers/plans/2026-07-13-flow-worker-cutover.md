# Flow-Worker Cutover (P5 completion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (single-operator ops+code evening; subagent-per-task not recommended — steps share live infra state). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Massive OPRA consumer + flow.db ownership from `web` to the `flow-worker` service so web deploys never touch the options tape (single Massive connection; no commercial-API dependency).

**Architecture:** Web keeps auth + SPA + everything non-flow. flow-worker becomes the single writer AND single reader host of flow.db (consumer + T+1 flat-files + gap-fill + backup all run there). Web forwards every flow-family request through the already-built `api/flow_proxy.py` reverse proxy (HMAC-vouched auth, SSE passthrough) over Railway private networking. Rollback = flip the same env vars back.

**Tech stack:** FastAPI + httpx proxy, Railway (3 services, single-attach volumes), Massive OPRA WS + S3 flat files, R2 (flow_backups/), SQLite WAL.

## Global Constraints

- **Timing: everything after-hours.** Start ≥ 8:15 PM ET (clears the 8:05 PM market_ingest push). Finish verification before ~2:30 AM ET (flow-backup job). Options tape is closed — flow.db is STATIC all evening, which is what makes the copy/flip seam-free.
- **Single Massive slot:** at no point may BOTH services have `MASSIVE_WS_ENABLED=1` with deployed env. Order of operations below enforces web-off-before-flow-worker-on.
- **GO GATE: Ravi's thumbs-up required before Phase C** (he owns `massive_ws_worker.py`, `live_massive_router.py`, `schwab_router.py`/`schwab_service.py`, `LiveFlowMassive.jsx`, and he re-routed the Discord auto-push today). Also ask him to hold his pushes during the flip window (~30 min).
- **Do NOT edit Ravi-owned files** without his explicit ack (Task A3 is coordinate-first).
- Work in a fresh worktree from origin/master (`.worktrees/flow-cutover`); never the stale main tree; ship via `git push origin <branch>:master`; explicit paths only (house rules).
- flow-worker has NO GitHub trigger — its deploys happen ONLY via `railway up -s flow-worker` from the worktree (Phase C) until Phase E reconnects the trigger.
- Cloudflare 1010-blocks bare curl UAs on some paths — always pass `-H "User-Agent: Mozilla/5.0"` when curling uctintelligence.com.
- `railway variables --set` STAGES values; they apply only on the service's next deploy. `railway ssh` needs `MSYS_NO_PATHCONV=1` and `--service <name>`; remote python is `/opt/venv/bin/python` (bare python3 lacks app deps); pass scripts as `echo <b64> "|" base64 -d "|" /opt/venv/bin/python`.

## Current state (verified 2026-07-13 evening)

| | web | flow-worker |
|---|---|---|
| MASSIVE_WS_ENABLED | 1 (owns consumer) | 0 |
| MASSIVE_WS_DRY_RUN | 0 | (unset — must set 0) |
| FLOW_BACKUP_ENABLED / FLOW_GAP_AUTOFILL_ENABLED | 1 / 1 | 0 / 0 |
| FLOW_READS_PROXY_ENABLED | 0 | n/a (FLOW_PROXY_TRUST=1 set) |
| MASSIVE_S3_* (flat files) | set (4 vars) | MISSING |
| DISCORD_MASSIVE/LIVE_FLOW webhook | set | MISSING (only generic DISCORD_WEBHOOK_URL) |
| flow.db | LIVE (~800MB, /data) | FROZEN at 7/10 |
| Deploy trigger | GitHub auto | DISCONNECTED (manual `railway up` only) |

Known landmines found in recon (each has a task): **(1)** `flow_proxy` router is never registered — the flag does nothing today. **(2)** `massive_flatfiles_worker` (T+1 archive, 11:30/12:00/12:30 ET) registers only in web's scheduler — post-flip it would write to web's frozen copy. **(3)** Sidecar configs live NEXT to flow.db and must move with it: `curated_thresholds.json`, `auto_push_config.json` (Ravi's re-route today), `dormant_tickers.json`. **(4)** `schwab_service.py:704` writes into FlowDB from web — Ravi-owned, needs his call. **(5)** `flow_explain.py` greps clean of flow.db — confirm once, then it's a non-issue.

---

### Task 0: Preconditions + GO gate (read-only)

**Files:** none (checks only)

- [ ] **Step 0.1: Ravi GO.** Confirm his 👍 on the cutover message (DM). Ask him to hold pushes during the flip. If he flags concerns about `schwab_service`/`live_massive_router`, resolve before Phase C.
- [ ] **Step 0.2: Fresh worktree.**
```bash
git -C /c/Users/Patrick/uct-dashboard fetch origin
git -C /c/Users/Patrick/uct-dashboard worktree add /c/Users/Patrick/uct-dashboard/.worktrees/flow-cutover -b flow-cutover origin/master
cd /c/Users/Patrick/uct-dashboard/.worktrees/flow-cutover
```
- [ ] **Step 0.3: Services healthy.** `railway deployment list -s flow-worker --limit 1` → SUCCESS; `railway deployment list -s web --limit 1` → SUCCESS; `curl -sS -H "User-Agent: Mozilla/5.0" https://uctintelligence.com/api/health` → 200.
- [ ] **Step 0.4: Snapshot CURRENT web env** (Ravi's webhook re-route may have changed values today):
```bash
railway variables -s web | grep -E "MASSIVE_S3|DISCORD_MASSIVE|DISCORD_LIVE_FLOW" 
```
Record the 4 `MASSIVE_S3_*` values + whichever `DISCORD_*_WEBHOOK_URL` values exist — they get copied to flow-worker in Task C2.
- [ ] **Step 0.5: Confirm flow_explain is a non-issue.** `grep -n "flow_db\|flow\.db" api/flow_explain.py` → expect ZERO hits (it stores explanations in its own flow_explain.db and receives print data from the request). If hits appear (code moved), STOP and add a bridge task before proceeding.
- [ ] **Step 0.6: Audit the Schwab ingest (Ravi-owned).** `sed -n '690,720p' api/schwab_service.py` + `grep -n "SCHWAB.*ENABLED\|schwab" api/main.py | head`. Determine: is the FlowDB write path live in prod (env-gated on web)? If YES → ask Ravi in the DM whether to (a) disable during cutover or (b) have it POST to flow-worker later (follow-up). Do not edit his file tonight. If dormant → note and move on.

### Task A1: Register the flow read-proxy on web (the missing wire)

**Files:**
- Modify: `api/flow_proxy.py` (add `register_on(app)` helper at end of file)
- Modify: `api/main.py` (one gated call, placed BEFORE the first flow-family `include_router`)
- Test: `tests/test_flow_proxy_register.py` (new)

**Interfaces:**
- Produces: `flow_proxy.register_on(app: FastAPI) -> bool` — registers the catch-all proxy router iff `PROXY_ENABLED and WORKER_INTERNAL_URL`; returns True when registered. main.py consumes it.

- [ ] **Step 1: Write the failing test** (`tests/test_flow_proxy_register.py`):
```python
"""register_on(): the proxy mounts only when enabled, and its routes win
because they register BEFORE the local flow routers (FastAPI first-match)."""
import importlib
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _reload(monkeypatch, enabled: str):
    monkeypatch.setenv("FLOW_READS_PROXY_ENABLED", enabled)
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://flow-worker.railway.internal:8080")
    from api import flow_proxy
    importlib.reload(flow_proxy)
    return flow_proxy


def test_register_on_disabled_is_noop(monkeypatch):
    fp = _reload(monkeypatch, "0")
    app = FastAPI()
    assert fp.register_on(app) is False
    paths = {r.path for r in app.routes}
    assert not any(p.startswith("/api/flow") for p in paths)


def test_register_on_enabled_mounts_and_wins(monkeypatch):
    fp = _reload(monkeypatch, "1")
    app = FastAPI()
    assert fp.register_on(app) is True

    @app.get("/api/flow/data")          # local route registered AFTER proxy
    def local_flow_data():
        return {"src": "local"}

    # Proxy route exists for every prefix
    paths = {getattr(r, "path", "") for r in app.routes}
    assert any(p.startswith("/api/flow") for p in paths)
    # First-match wins: request resolves to the proxy handler (upstream
    # unreachable in tests -> its honest 502), NOT the local route.
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/flow/data")
    assert r.status_code == 502
    assert r.json() != {"src": "local"}
```
- [ ] **Step 2: Run it — must fail.** `python -m pytest tests/test_flow_proxy_register.py -v` → FAIL (`AttributeError: module 'api.flow_proxy' has no attribute 'register_on'`).
- [ ] **Step 3: Implement `register_on` at the bottom of `api/flow_proxy.py`:**
```python
def register_on(app) -> bool:
    """Mount the read-proxy on web. MUST be called BEFORE the local flow
    routers are included (FastAPI resolves first match), so when the flag is
    on the proxy wins and web's frozen flow.db is never consulted. Off by
    default -> zero change. Returns True iff registered."""
    if not (PROXY_ENABLED and WORKER_INTERNAL_URL):
        return False
    app.include_router(build_flow_proxy_router())
    logger.info("[flow-proxy] READ PROXY ACTIVE -> %s (prefixes: %s)",
                WORKER_INTERNAL_URL, ", ".join(PROXY_PREFIXES))
    return True
```
- [ ] **Step 4: Wire into `api/main.py`.** Find the FIRST flow-family include (`grep -n "include_router(top_flow_router)\|include_router(flow_router)" api/main.py` — currently `app.include_router(top_flow_router)` at ~:3217 / `flow_router` at ~:3251). Insert IMMEDIATELY ABOVE the top_flow include:
```python
# Flow read-proxy (P5 cutover): registered BEFORE every local flow-family
# router so, when FLOW_READS_PROXY_ENABLED=1, all flow.db-backed reads are
# forwarded to the flow-worker (the single writer+reader of flow.db) and
# web's local copy is never consulted. Dark by default.
try:
    from api import flow_proxy as _flow_proxy
    if _flow_proxy.register_on(app):
        print("[startup] flow read-proxy ACTIVE -> flow-worker")
except Exception as _e:  # noqa: BLE001
    print(f"[startup] flow read-proxy registration failed (non-fatal): {_e}")
```
- [ ] **Step 5: Tests pass.** `python -m pytest tests/test_flow_proxy_register.py tests/test_flow_proxy.py tests/test_flow_proxy_auth.py -v` → ALL PASS. Also `python -m py_compile api/main.py api/flow_proxy.py`.
- [ ] **Step 6: Commit.**
```bash
git add api/flow_proxy.py api/main.py tests/test_flow_proxy_register.py
git commit -m "feat(flow): register the P5 read-proxy on web (dark until FLOW_READS_PROXY_ENABLED=1)" -- api/flow_proxy.py api/main.py tests/test_flow_proxy_register.py
```

### Task A2: T+1 flat-file ingest moves with flow.db (flow-worker scheduler)

**Files:**
- Modify: `api/flow_worker_main.py:126-152` (`_start_flow_schedulers`)
- Test: `tests/test_flow_worker_schedulers.py` (new)

**Interfaces:**
- Consumes: `massive_flatfiles_worker.register_jobs(scheduler) -> bool` (existing; self-gated on `MASSIVE_FLATFILES_ENABLED` default 1 + `MASSIVE_S3_*` creds).

- [ ] **Step 1: Failing test** (`tests/test_flow_worker_schedulers.py`):
```python
"""flow-worker registers the T+1 flat-files cron next to gap-fill + backup —
flow.db lives on ITS volume post-cutover, so the archive ingest must run there."""
from unittest import mock


def test_flow_worker_registers_flatfiles(monkeypatch):
    from api import flow_worker_main
    calls = []
    fake = mock.MagicMock()
    fake.register_jobs.side_effect = lambda s: calls.append("flatfiles") or True
    monkeypatch.setattr("api.massive_flatfiles_worker.register_jobs",
                        fake.register_jobs, raising=True)
    # gap-fill/backup/integrity are exercised elsewhere; let them no-op
    monkeypatch.setattr("api.flow_gap_autofill.startup_check", lambda: None)
    monkeypatch.setattr("api.flow_gap_autofill.register_jobs", lambda s: False)
    monkeypatch.setattr("api.flow_backup.register_jobs", lambda s: False)
    monkeypatch.setattr("api.flow_backup.startup_integrity_check", lambda: {"ok": True})
    flow_worker_main._start_flow_schedulers()
    assert "flatfiles" in calls
```
- [ ] **Step 2: Run — must fail.** `python -m pytest tests/test_flow_worker_schedulers.py -v` → FAIL (flatfiles never called).
- [ ] **Step 3: Implement.** In `_start_flow_schedulers`, after the flow_backup block and before `if n:`, add:
```python
        try:
            from api import massive_flatfiles_worker
            if massive_flatfiles_worker.register_jobs(sched):
                n += 1
                log.info("[startup] flat-files T+1 cron registered on flow-worker")
        except Exception as e:  # noqa: BLE001
            log.warning("flat-files scheduling failed: %s", e)
```
- [ ] **Step 4: Pass.** `python -m pytest tests/test_flow_worker_schedulers.py -v` → PASS. `python -m py_compile api/flow_worker_main.py`.
- [ ] **Step 5: Commit.**
```bash
git add api/flow_worker_main.py tests/test_flow_worker_schedulers.py
git commit -m "feat(flow-worker): register T+1 flat-files cron (archive ingest follows flow.db at cutover)" -- api/flow_worker_main.py tests/test_flow_worker_schedulers.py
```

### Task A3: Ship the code (one after-hours web deploy)

- [ ] **Step 1:** `python -m pytest tests/test_flow_proxy_register.py tests/test_flow_worker_schedulers.py tests/test_flow_proxy.py tests/test_flow_proxy_auth.py tests/test_flow_backup.py -q` → all green.
- [ ] **Step 2:** Push (hook allows after-hours): `git push origin flow-cutover:master`. Also commit this plan file if not already on master.
- [ ] **Step 3:** Watch web+worker deployments to SUCCESS (`railway deployment list -s web --limit 1` until SUCCESS; ~10-25 min). Web boots with proxy still DARK (flag 0) — zero behavior change tonight so far. Verify `curl -sS -H "User-Agent: Mozilla/5.0" https://uctintelligence.com/api/health` → 200 and `/api/flow/data?days=1` → 200 (still web-local).

### Task B1: Fresh flow.db snapshot to R2 (source: web, post-close = complete day)

- [ ] **Step 1:** Trigger: `curl -sS -X POST -H "Authorization: Bearer $PUSH_SECRET" -H "User-Agent: Mozilla/5.0" "https://uctintelligence.com/api/flow-backup/run"` (PUSH_SECRET from `railway variables -s web`). Expected: `{"status":"started"...}` or run record.
- [ ] **Step 2:** Verify the object landed (local machine, DATA_SYNC creds from `railway variables -s web`, R2 checksum knobs per uct-conventions):
```python
# save as /tmp check not needed - run inline with python -c
import boto3, os
c = boto3.client("s3", endpoint_url=ENDPOINT, aws_access_key_id=KEY,
    aws_secret_access_key=SECRET, region_name="auto",
    request_checksum_calculation="when_required", response_checksum_validation="when_required")
print([o["Key"] for o in c.list_objects_v2(Bucket="uct-bars-snapshots", Prefix="flow_backups/")["Contents"]][-3:])
```
Expected: `flow_backups/flow-2026-07-13.db.gz` present with tonight's timestamp (~150-300MB).

### Task B2: Restore snapshot + sidecars onto flow-worker's volume

flow-worker is Online but DARK (no traffic) — safe to swap the file under it.

- [ ] **Step 1: Restore flow.db** via railway ssh. Write locally `restore_flow.py`:
```python
import boto3, gzip, os, shutil, sqlite3
ep=os.environ["DATA_SYNC_ENDPOINT_URL"]; ak=os.environ["DATA_SYNC_ACCESS_KEY"]; sk=os.environ["DATA_SYNC_SECRET_KEY"]
c=boto3.client("s3",endpoint_url=ep,aws_access_key_id=ak,aws_secret_access_key=sk,region_name="auto",
  request_checksum_calculation="when_required",response_checksum_validation="when_required")
c.download_file("uct-bars-snapshots","flow_backups/flow-2026-07-13.db.gz","/data/flow.db.gz")
with gzip.open("/data/flow.db.gz","rb") as f, open("/data/flow.db.new","wb") as o: shutil.copyfileobj(f,o)
ok=sqlite3.connect("/data/flow.db.new").execute("PRAGMA quick_check").fetchone()[0]
assert ok=="ok", ok
for s in ("/data/flow.db-wal","/data/flow.db-shm"):
    try: os.remove(s)
    except FileNotFoundError: pass
os.replace("/data/flow.db.new","/data/flow.db"); os.remove("/data/flow.db.gz")
print("restored:", os.path.getsize("/data/flow.db"), "bytes; quick_check:", ok)
```
Run: `B64=$(base64 -w0 restore_flow.py); MSYS_NO_PATHCONV=1 railway ssh --service flow-worker -- echo $B64 "|" base64 -d "|" /opt/venv/bin/python`
Expected: `restored: ~8xxxxxxxx bytes; quick_check: ok`.
- [ ] **Step 2: Copy the 3 sidecars** (thresholds, auto-push config incl. Ravi's re-route, dormant list). For each `F` in `curated_thresholds.json auto_push_config.json dormant_tickers.json`:
```bash
B64=$(MSYS_NO_PATHCONV=1 railway ssh --service web -- base64 -w0 /data/$F)
MSYS_NO_PATHCONV=1 railway ssh --service flow-worker -- echo $B64 "|" base64 -d ">" /data/$F
```
(If a file doesn't exist on web, skip it — defaults apply.) Verify: `railway ssh --service flow-worker -- ls -la /data/`.
- [ ] **Step 3: Row-count sanity** (web vs restored copy — same evening, tape closed, should match exactly): run on BOTH services via ssh: `/opt/venv/bin/python -c "import sqlite3;print(sqlite3.connect('/data/flow.db').execute('select count(*), max(rowid) from flow').fetchone())"` (adjust table name if `flow` differs — check `flow_db.py` schema first). Expected: identical tuples.

### Task C1: Stage env flips (both services — nothing applies until deploys)

- [ ] **Step 1: web** (consumer off, safety nets off, proxy ON):
```bash
railway variables -s web --set "MASSIVE_WS_ENABLED=0" --set "FLOW_BACKUP_ENABLED=0" \
  --set "FLOW_GAP_AUTOFILL_ENABLED=0" --set "MASSIVE_FLATFILES_ENABLED=0" \
  --set "FLOW_READS_PROXY_ENABLED=1"
```
- [ ] **Step 2: flow-worker** (consumer on, safety nets on, S3 + webhooks copied from Step 0.4 values):
```bash
railway variables -s flow-worker --set "MASSIVE_WS_ENABLED=1" --set "MASSIVE_WS_DRY_RUN=0" \
  --set "FLOW_BACKUP_ENABLED=1" --set "FLOW_GAP_AUTOFILL_ENABLED=1" \
  --set "MASSIVE_S3_ENDPOINT=<from 0.4>" --set "MASSIVE_S3_BUCKET=flatfiles" \
  --set "MASSIVE_S3_ACCESS_KEY=<from 0.4>" --set "MASSIVE_S3_SECRET=<from 0.4>" \
  --set "DISCORD_LIVE_FLOW_WEBHOOK_URL=<from 0.4>"
```
(Also `DISCORD_MASSIVE_WEBHOOK_URL` if web has it — the push code prefers it.)

### Task C2: The flip — web first, then flow-worker (single-slot ordering)

- [ ] **Step 1:** `railway redeploy -s web -y` → wait SUCCESS (~1-2 min swap now that boot is fast). Web's consumer is now OFF and the proxy is ON (pointing at flow-worker, whose consumer is still off — fine, evening data is static and reads serve from the restored copy).
- [ ] **Step 2: Immediately verify reads-through-proxy** (before flipping the consumer):
  - `curl -sS -H "User-Agent: Mozilla/5.0" -o /dev/null -w '%{http_code} %{size_download}B\n' "https://uctintelligence.com/api/flow/data?days=1"` → `200` with ~13MB (served from flow-worker's restored db).
  - Discriminator: `curl -sS -H "User-Agent: Mozilla/5.0" "https://uctintelligence.com/api/liveflow/consumer-state"` → must show `"enabled": false` (flow-worker's still-off consumer) — PROOF the proxy path is active (web's local consumer-state would be stale/off too now, so also check web logs for the `[startup] flow read-proxy ACTIVE` line via `railway logs -s web -n 50`).
- [ ] **Step 3:** Deploy flow-worker with the new image (A2 code) + staged env: from the worktree — `railway up --detach -s flow-worker -e production -p d6574d0b-7973-4ece-b35c-65c0ad4c453d -m "P5 cutover: consumer+flow.db ownership"` → watch `railway deployment list -s flow-worker --limit 1` to SUCCESS.
- [ ] **Step 4:** `railway logs -s flow-worker -n 60` — expect, in order: `starting Massive OPRA consumer` → `Massive OPRA consumer started` → scheduler lines for gap-fill + backup + flat-files → `Uvicorn running`. NO `max_connections` strikes (web released the slot in Step 1). A single transient strike + 30s cooldown is acceptable; repeated strikes = web didn't release → check Step 1 actually deployed.

### Task D: Verification (tonight)

- [ ] **Endpoints through the proxy** (all with browser UA, all expect 200):
```
/api/flow/data?days=1        -> 200, fresh 7/13 rows (spot-check CreatedDate)
/api/flow/ticker/SPY         -> 200 (Ravi's route, via proxy)
/api/live/massive/day-stats  -> 200
/api/live/massive/thresholds -> 200 (sidecar survived)
/api/live/massive/auto-push-config -> 200 (Ravi's re-route intact — compare to pre-flip value)
/api/flow-gap-fill/status    -> 200, shows the 7/13 failed runs manifest (restored db carried it)
/api/liveflow/consumer-state -> "enabled": true, "connected": true (flow-worker's consumer!)
```
- [ ] **SSE through the proxy** (the instant tape): `curl -N -sS -H "User-Agent: Mozilla/5.0" "https://uctintelligence.com/api/live/massive/stream" | head -c 400` → event-stream bytes/heartbeat within ~15s (tape closed: heartbeats only is fine). This exercises `_proxy`'s SSE passthrough branch.
- [ ] **Pages live** (Playwright against prod; NEVER `networkidle` on SSE pages): /options-flow renders rows; /live-massive shows LIVE pill + day chips; no console errors on either.
- [ ] **Web boot fingerprint:** `railway logs -s web -n 100 | grep -E "flow read-proxy|massive-ws"` → `flow read-proxy ACTIVE` present; consumer disabled line present.
- [ ] **Regression sweep of NON-flow surfaces** (they must be untouched): /api/health 200, /api/bars/SPY?tf=D 200, a Journal endpoint 200, Floor chat page loads.
- [ ] **Notify Ravi in the DM:** flip done, what moved, watch-for list, and that his auto-push config + thresholds carried over.

### Task D2: Tomorrow-morning watch (first live session on the new owner)

- [ ] 8:05-8:20 AM ET: `/api/flow-gap-fill/status` → the 08:00 run on flow-worker shows `completed` for 7/13 with `rows_inserted > 0` across the 3 windows (backfill finally lands INTO the live db).
- [ ] 9:32-9:40 AM ET: `/api/liveflow/consumer-state` → `trades_received` climbing; `/api/live/massive/day-stats` populating for 7/14; LiveFlow page ticking; zero `maxconn_strikes`; Discord auto-pushes arriving in the re-routed channel.
- [ ] Any failure at the open → execute Rollback (below) — takes ~5 minutes, and web's copy heals via T+1.

### Task E: Post-flip housekeeping (same night or next evening)

- [ ] **E1: Reconnect flow-worker auto-deploy with NARROW watch paths** (Railway dashboard → flow-worker → Settings): reconnect repo trigger, branch master, watch paths:
```
/api/flow_worker_main.py
/api/massive_ws_worker.py
/api/massive_flatfiles_worker.py
/api/flow_db.py
/api/flow_router.py
/api/flow_summary.py
/api/flow_backup.py
/api/flow_gap_autofill.py
/api/flow_reconcile_router.py
/api/live_massive_router.py
/api/liveflow_*.py
/api/worker_main.py
/api/dealer_positioning*.py
/api/notable_flow*.py
/api/oi_snapshot*.py
/requirements.txt
/railway.json
/nixpacks.toml
```
Then run the two-commit smoke test from `docs/superpowers/specs/liveflow-deploy-survival/p0-config-runbook.md` Step 5 (negative: app/src-only commit → flow-worker does NOT deploy; positive: touch `api/flow_db.py` comment → it does). Alternative (also acceptable): stay manual-deploy-only; document that choice.
- [ ] **E2: Docs + memory.** Update `CLAUDE.md` "Live Options Flow — Deploy Survival" section (consumer now on flow-worker; web env lines flipped; deploys of web no longer gap the tape — flow-worker deploys still do, keep them after-hours). Update user-memory `project_flow_worker_outage_2026_07_13.md` + MEMORY.md line (standby → OWNER). Note the deploy-freeze hook stays (bars worker + general hygiene + flow-worker api-path deploys still matter).
- [ ] **E3: Backlog tickets (do NOT build tonight):** schwab_service FlowDB write routing (Ravi), commercial-API 2nd connection = zero-gap flow-worker deploys, retire web's frozen /data/flow.db after ~30d green (reclaim ~800MB), flow-explain deep-link check.

## Rollback (any point, ~5 min)

```bash
railway variables -s web --set "MASSIVE_WS_ENABLED=1" --set "FLOW_BACKUP_ENABLED=1" \
  --set "FLOW_GAP_AUTOFILL_ENABLED=1" --set "MASSIVE_FLATFILES_ENABLED=1" --set "FLOW_READS_PROXY_ENABLED=0"
railway variables -s flow-worker --set "MASSIVE_WS_ENABLED=0"
railway redeploy -s flow-worker -y        # consumer OFF first (frees the slot)
railway redeploy -s web -y                # web resumes as owner
```
Same-evening rollback = zero data loss (tape closed, nothing written anywhere). Next-day rollback = web's copy is missing the interim prints → its re-enabled gap-fill heals from the T+1 flat file on the next 16:45/21:00/08:00 run. The A1/A2 code is dark-flagged and needs no revert.

## Self-review notes

- Spec coverage: consumer move ✓ (C1/C2), reads ✓ (A1+C2), writes: WS ✓, T+1 archive ✓ (A2), gap-fill ✓ (env), backup ✓ (env), BBS/CSV upload ✓ (flow_router mounts on flow-worker; proxy forwards POST bodies), sidecar configs ✓ (B2), Discord pushes ✓ (env + sidecar), SSE tape ✓ (proxy passthrough + D check), auth ✓ (vouch headers, FLOW_PROXY_TRUST already set), schwab ✓ (0.6 coordinate), flow-explain ✓ (0.5 confirm-non-issue), rollback ✓, morning watch ✓.
- Types/names: `register_on` consistent A1↔main.py; `register_jobs` signature matches existing callers.
- No placeholders except values deliberately captured at runtime (`<from 0.4>` secrets — never written to disk/plan).
