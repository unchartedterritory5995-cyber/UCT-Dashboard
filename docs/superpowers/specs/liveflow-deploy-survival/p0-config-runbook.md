# P0 CONFIG Runbook — Deploy-Survival Substrate (web + worker, Railway)

**Scope:** config only, no Ravi-owned files. One railway.json commit + one dashboard settings change + verification deploys. Execute **after 8:30 PM ET** (options tape closed; clear of the 8:05 PM market_ingest push).
**Verified timing model:** both services carry single-attach volumes → every deploy is **stop-then-start** (Railway docs: no overlap possible, "small amount of downtime... even if there is a healthcheck"). The drain window therefore sits **inside** the deploy-downtime path. Defaults today: drain **0s** (SIGKILL immediately), overlap 0s (and impossible here).

**Two corrections that change the plan (verified against origin/master @ `054c60cd`):**
1. The startCommand is a shell `if` wrapper → uvicorn is a **child of sh, not PID 1** → SIGTERM dies at the shell. Drain without `exec` = 30s zombie WS + still-dirty kill = **worse than today**. `exec` and `drainingSeconds` must land in the **same commit**.
2. `api/main.py` **already uses `lifespan=`** (`FastAPI(..., lifespan=lifespan)` at :2758; `yield` at :2753). The plan's `@app.on_event("shutdown")` instruction for P1 would be **silently ignored**. P1's stop() must go after the `yield`, next to `_scheduler.shutdown(wait=False)`.

---

## Step 0 — Preconditions (read-only, any time)
- In the linked repo dir: `railway status` — confirm project **luminous-recreation**, service **web**.
- Dashboard → each service → Variables: confirm `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` / `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` are **not set** (avoid dual source of truth; config-as-code will own drain). Confirm web `MASSIVE_WS_ENABLED=1, DRY_RUN=0`; worker `=0, DRY_RUN=1`.
- Dashboard → web → Settings: watch paths empty (deploys on every commit — expected, unchanged tonight). Worker → Settings: watch paths empty (to be set in Step 2).
- Record current Active deployment IDs for both services (rollback reference).

## Step 1 — Prepare the railway.json commit (isolated worktree; do NOT push yet)
Per house rules: work against origin/master in an isolated worktree; never `git add -A`; ship via `push origin <branch>:master`. Patrick owns this file.

Edit `railway.json` deploy block to exactly:
```json
"deploy": {
  "startCommand": "if [ \"${WORKER_ENABLED:-0}\" = \"1\" ]; then exec python -m api.worker_main; else exec uvicorn api.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 5; fi",
  "drainingSeconds": 30,
  "healthcheckPath": "/api/health",
  "healthcheckTimeout": 600
}
```
- `exec` in **both** branches → the real process becomes PID 1 and receives SIGTERM.
- `--timeout-graceful-shutdown 5` (exists in uvicorn 0.41.0; default None = wait forever): open SSE streams are cancelled at 5s and — verified from 0.41.0 source — the lifespan **shutdown phase still runs afterward** (this is what will execute P1's stop()). Shutdown budget: 5s SSE + ≤5s stop() join + non-blocking scheduler shutdown ≈ ≤12s ≪ 30s drain.
- `drainingSeconds: 30` = SIGTERM→SIGKILL buffer (Massive guidance headroom). Config-as-code overrides dashboard — do NOT also set the env var or Settings-pane value.
- ⛔ Do **NOT** add `watchPatterns` to railway.json — the file is shared by both services; an api-only list would stop web from deploying frontend commits.
- Optional consistency (inert, overridden by railway.json): prefix `exec` in Procfile and nixpacks.toml `[start]`. Skip if keeping the diff minimal.

**Verification (pre-push):** `python -c "import json;json.load(open('railway.json'))"` parses; `sh -n` mental check of the quoted command; diff touches railway.json only.

## Step 2 — Worker watch paths (dashboard, no redeploy)
Dashboard → **worker** service → Settings → Watch Paths (gitignore-style, evaluated from repo root; root-anchor everything):
```
/api/**
/requirements.txt
/railway.json
/nixpacks.toml
/Procfile
/runtime.txt
```
Apply via staged changes using **Alt+click "Deploy"** (commits config **without** redeploying — watch paths are evaluated at push time, no restart needed). If Alt-commit is unavailable, plain Deploy costs one after-hours worker restart (acceptable; consumer there is DRY_RUN).

**Verification:** staged-changes banner clears; Settings shows the six patterns; worker's Active deployment unchanged (if Alt-committed).
**Rollback:** clear the field → Alt+Deploy.

## Step 3 — Push the commit (the ONE coordinated deploy)
`git push origin <branch>:master`
Expected: **web** deploys (no watch paths) AND **worker** deploys (`/railway.json` matches its new patterns). This teardown is **sacrificial** — the replaced deployments predate the config, so they still die with 0s drain (market closed, costs nothing). Protection begins with the deployments created from this commit.

**Verification:**
- Both services build and go Active on commit SHA; `curl https://uctintelligence.com/api/health` → 200.
- New deployment details show the new startCommand.
- `GET /api/live/massive/status` → `connected: true` within a few minutes; `/api/stream/status` sane; fundamentals-health clean.

**Rollback:** `git revert <sha>` + push (one more after-hours deploy). Reverting restores the old startCommand and removes `drainingSeconds` (back to 0s/SIGKILL — i.e., today's behavior, never worse).

## Step 4 — Controlled teardown verification (web)
Dashboard → web → latest deployment → **Redeploy**. This tears down a deployment that **carries** exec+drain — the first real test.

Watch the **old** deployment's logs for, in order:
1. `Shutting down` — uvicorn received SIGTERM ⇒ **exec worked** (absence = R1 failure → revert, investigate).
2. `Waiting for connections to close.` then (≤5s later) `Cancel N running task(s), timeout graceful shutdown exceeded` — SSE bounded-cancel worked.
3. `Application shutdown complete.` / `Finished server process` — lifespan shutdown ran (P1's stop() will slot in here).

Measure and record:
- **T_exit** = SIGTERM→`Finished server process` (expect ~6-10s).
- **T_gap** = old `Finished server process` → new `Starting Container`.
  - T_gap ≈ seconds → drain is **max-grace** (early exit proceeds early): added deploy latency ≈ T_exit only. Expected per standard container semantics, but not explicitly documented by Railway — this measurement is the proof.
  - T_gap ≈ 30s regardless → **fixed wait**: edit `drainingSeconds` to 10 in a follow-up commit (graceful path needs ≤10s).
- Check the restart endpoint: with old-process death ~8s post-SIGTERM and new boot ~30-60s later (volume remount + container start), Massive's 10-30s dead-session hold has often expired → expect fewer/no `max_connections` at hello **even before P1**. Record whether the cooldown was hit.

## Step 5 — Watch-path smoke test (two throwaway commits, after hours)
Failure mode being tested: bad patterns **silently** skip all future worker deploys (docs: unmatched changes "skip creating a new deployment" — no error anywhere).
1. **Negative:** commit touching only `app/src/` (or `docs/`) → push. Expect: **web deploys** (control proves the push registered), **worker does NOT** (no new deployment in its list for that SHA).
2. **Positive:** commit touching `api/` (e.g. add `api/.watchpath-smoke`) → push. Expect: **worker deploys** (and web too).
If positive fails: patterns are wrong — clear worker watch paths (rollback to deploy-on-everything), fix, retest. Delete the smoke file in the positive commit's cleanup or fold it into the next real change.

## Step 6 — Record + handoff
- Log measured T_exit / T_gap / cooldown-hit into the spec's loss-budget table.
- Send Ravi the corrected P1 registration instruction (lifespan `yield`, **not** on_event) with the two grep proofs (`lifespan=lifespan` @ main.py:2758; zero on_event in api/).
- Note for the spec: `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` is a no-op/never-set for both services (volumes forbid overlap) — the Q6 answer is that **no pre-deploy overlap exists for web**; drain-then-start is the only lever, and it is now set via `deploy.drainingSeconds` in railway.json (dashboard Settings pane and the service variable are equivalent alternatives; config-as-code wins on conflict).

## What P0 does and does not fix
- **Fixes:** creates the drain window; makes SIGTERM actually reach uvicorn; bounds SSE so shutdown can complete; likely pushes the new process's first WS connect past Massive's dead-session hold; stops frontend commits from rebuilding worker.
- **Does NOT fix:** the WS close frame. The consumer's daemon thread still dies without a close frame at interpreter exit until **P1's stop()** runs in the lifespan shutdown phase. P0 is the substrate that makes P1 possible — deploy-gap ~15-60s arrives only with P0+P1 together.

## Deploy-count ledger (minimum path)
| Action | Web deploys | Worker deploys |
|---|---|---|
| Step 2 watch paths (Alt-commit) | 0 | 0 |
| Step 3 railway.json commit | 1 (sacrificial teardown) | 1 |
| Step 4 verification redeploy | 1 | 0 |
| Step 5 smoke commits | 2 | 1 |
| **Total (all after hours)** | **4** | **2** |

---
## Risk appendix

**P0-R1** (high×critical): SIGTERM never reaches uvicorn: railway.json startCommand is a shell `if` wrapper, so uvicorn/python runs as a CHILD of sh, not PID 1. Railway delivers SIGTERM to PID 1; non-interactive sh does not forward it. Setting drainingSeconds=30 WITHOUT fixing this is strictly worse than today: 30s of zombie WS holding the Massive session, then SIGKILL — still a dirty close, plus 30s longer deploy.
- Mitigation: Add `exec` to BOTH branches of the startCommand in the SAME commit that adds drainingSeconds (atomic: drain never exists without exec). `exec` makes uvicorn (web) / python (worker) replace the shell as PID 1. This exact failure mode is documented by Railway staff in the Help Station draining-seconds thread (npm/shell wrappers swallow SIGTERM).
- Verify: During the controlled after-hours redeploy, the OLD web deployment's logs must show uvicorn's 'Shutting down' line within ~1s of teardown start, followed by 'Application shutdown complete.' and 'Finished server process'. Absence of 'Shutting down' = signal did not propagate.

**P0-R2** (high×critical): P1's stop() hook, registered per the plan's instruction ('@app.on_event("shutdown") — do NOT introduce lifespan='), would SILENTLY NEVER RUN: origin/master api/main.py already uses `app = FastAPI(..., lifespan=lifespan)` (line 2758). Starlette ignores on_event handlers when a lifespan context manager is passed. The plan's premise is inverted.
- Mitigation: Correct the P1 spec before sending to Ravi: register stop() inside the existing lifespan asynccontextmanager AFTER the `yield` at api/main.py:2753, next to the existing `_scheduler.shutdown(wait=False)` / `stop_snapshot_scheduler()` shutdown block, defensively via `stop = getattr(massive_ws_worker, 'stop', None)`.
- Verify: grep origin/master api/main.py: `lifespan=lifespan` present at :2758, zero on_event registrations (verified this session). After P1 lands, teardown logs must show the stop() log line between uvicorn's 'Shutting down' and 'Application shutdown complete.'

**P0-R3** (medium×high): Bad worker watchPatterns silently stop ALL worker deploys (unmatched commits 'skip creating a new deployment' with no alert) — the bars pipeline code would freeze at today's version indefinitely.
- Mitigation: Use root-anchored gitignore-style patterns (`/api/**`, `/requirements.txt`, `/railway.json`, `/nixpacks.toml`, `/Procfile`, `/runtime.txt`) and run the two-commit smoke test (positive: api/ touch must deploy worker; negative: app/src-only touch must NOT) the same night.
- Verify: Worker service Deployments list shows a new deployment for the positive-test commit SHA and none for the negative-test SHA (web deploys both — it is the control).

**P0-R4** (medium×high): Putting watchPatterns (or per-service values) into railway.json: the file is SHARED by web and worker (same repo, same path). `build.watchPatterns` there would apply to BOTH services — worker's api-only list would stop web from deploying frontend commits; config-as-code always overrides dashboard.
- Mitigation: Hard rule in the runbook + PR review: watchPatterns are set ONLY per-service in the dashboard. railway.json carries only what must be identical for both services (startCommand branch-by-env, drainingSeconds).
- Verify: Post-change `git show origin/master:railway.json` contains no watchPatterns key; a frontend-only commit still deploys web.

**P0-R5** (low×medium): Railway's drain may be a FIXED wait rather than max-grace (docs say only 'given time to gracefully shutdown'; staff phrasing 'allowed to stay alive' implies max-grace but early-exit-proceeds-early is not explicitly documented). For a volume service the drain sits IN the downtime path (old must exit and unmount before new starts), so a fixed wait adds a flat +30s to every web deploy.
- Mitigation: Measure during the controlled redeploy: gap from old deployment's 'Finished server process' to new deployment's 'Starting Container'. If gap ≈ full 30s despite ~8s exit, drop drainingSeconds to 10 (graceful path needs ≤10s: 5s SSE cancel + ≤5s stop() join).
- Verify: Timestamped log comparison across old/new deployments in the Railway dashboard; record the measured added latency in the spec's loss-budget table.

**P0-R6** (high×low): The deploy that SHIPS these changes is sacrificial: the deployment being replaced was created without drainingSeconds/exec, so it still tears down with 0s drain and a dirty WS death (config-as-code applies 'only for the current deployment' — i.e. protection starts with the deployment created FROM the commit).
- Mitigation: Land everything after hours (≥8:30 PM ET) when the OPRA tape is closed; the sacrificial teardown costs nothing. Never land this mid-market.
- Verify: Deploy timestamps in Railway dashboard are outside 9:30 AM–4:15 PM ET; /api/live/massive/status shows connected:true after the new deployment is Active.

**P0-R7** (low×low): uvicorn's bounded graceful shutdown cancels live SSE streams (/api/stream/prices) at the 5s mark on every deploy; and the lifespan shutdown phase could in principle exceed the 30s drain if a shutdown hook blocks.
- Mitigation: SSE cancel is the intended behavior — browser EventSource auto-reconnects to the new deployment (same downtime users already experience on stop-then-start deploys). Shutdown-phase budget: 5s SSE + ≤5s stop() join + non-blocking scheduler shutdown ≈ ≤12s ≪ 30s. Keep the rule: nothing unbounded may be added after the lifespan yield.
- Verify: Old-deployment teardown logs show 'Cancel N running task(s), timeout graceful shutdown exceeded' (or clean connection close) then 'Finished server process' within ~15s of SIGTERM; streaming resumes on the new deployment (event loop health check clean).
