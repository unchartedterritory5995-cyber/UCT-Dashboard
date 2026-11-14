# worker: deploys are MANUAL

**Read this before you change ANY file the `worker` service runs** (`api/worker_main.py`,
`api/services/data_sync.py`, `api/services/bars_*`, the prewarmers, `requirements.txt`, ...).

## ⛔⛔ The rule (owner decision 2026-11-13)

**worker AUTO DEPLOY IS DISABLED in Railway** (worker → Settings → Source → Branch connected to
production → "Auto deploy is disabled"). A push or a merged PR no longer restarts it. Your
change reaches the worker only when someone deploys it by hand, **outside market hours**.

Why (measured 2026-11-12): the worker builds the R2 snapshots every other service pulls bars
from. In the rowid bars.db (41 GB) one 20-minute delta took 40+ minutes and the daily base takes
hours, and every master merge restarted the worker, so both died unfinished. **No upload shipped
from 2026-11-10 07:17 UTC to 2026-11-13** (worker `/internal/health`: `uploader_alive=false`,
`seconds_since_last_upload` 244k). The clustered-layout rollout (PR #1102, `SNAPSHOT_CLUSTER=1`,
set 2026-11-13 03:09 UTC) needs the base build to run for hours uninterrupted.

## How to deploy the worker (by hand)

1. **When:** after 16:15 ET and before 07:45 ET on a trading day, or a weekend. Check first that
   no base build is running (below): a deploy kills it, and it starts over the next ET day.
2. **How:** Railway → project `luminous-recreation` → `worker` → Ctrl/Cmd+K →
   **"Deploy latest commit"**. (`railway redeploy --service worker` re-runs the CURRENT image.)
3. **Verify:** the new deployment's commit is the one you meant, then `/internal/health` on the
   pod (below) shows `uploader_alive: true` within ~25 minutes.

## How to read the uploader's state

```sh
# on the pod (railway ssh --service worker), python because the image has no curl:
python3 -c "import urllib.request,os;print(urllib.request.urlopen('http://127.0.0.1:%s/internal/health'%os.environ.get('PORT','8080')).read().decode())"
```

`uploader_last_attempt_at` is set only when an attempt FINISHES, so `null` on a pod that has been up
for an hour means the first delta is still running. `base_upload_started_at` non-null = a base is
building: do not deploy. Log lines to look for: `uploaded delta`, `uploaded base snapshot`,
`snapshot clustered (WITHOUT ROWID)`, `snapshot NOT clustered`.

## The clustered layout (bars.db sorted by ticker) — how a pod switches, and the levers

Every service that holds `bars.db` switches through ONE path, `data_sync.adopt_clustered_store`:
download the latest clustered base, verify it, carry this pod's newer rows into it, swap under
the write + swap locks. web and bars-api switched on 2026-11-13/14; the worker runs it at boot
since `f48fcaf184`.

- `BARS_ADOPT_CLUSTERED=1` turns it on (one-shot: marker `/data/.adopted_clustered`). It runs only
  in the quiet window (20:15-03:45 ET weekdays, all weekend) unless `BARS_ADOPT_IGNORE_WINDOW=1`.
- **It survives restarts.** The working folder is `/data/adopt_<snapshot ts>`; every other `adopt_*`
  folder is a dead run's leftover and is swept at the start. Once the download passes its checks it
  is marked `.verified`, and a restart resumes from the merge (log: `resuming the verified download`).
- On the worker, deltas and the daily base pause while it runs (uploader outcome `adopting`).
- **Restart the service after the swap.** Idle threads keep the old file open until they next touch
  `bars.db`; on web that held 14 GB of disk.
- `BARS_REINSTALL_TOKEN=<new token>` re-installs the full clustered base over a store that is
  already clustered but PARTIAL, through the same safe path, once per distinct token. Use it, never
  `force_resync` / `FORCE_RESYNC_ON_BOOT`: those delete the live file under open connections.
  ⚰️ 2026-11-14: the boot smoke probe ran `ORDER BY rowid` on the new layout, read the error as
  corruption, and the boot resync deleted web's freshly adopted 19.7 GB store (fixed `9f66068877`).

## Do not re-enable auto deploy without the owner.
