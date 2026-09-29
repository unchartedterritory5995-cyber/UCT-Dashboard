# Economic Data — deployment configuration

**Status: nothing is deployed.** This records how the future econ ingestion
service is configured, so that deploying it later changes nothing else.

## The econ service has its own Railway config: `railway.econ.json`

| Field | Value |
|---|---|
| build | identical to the shared `railway.json` (NIXPACKS, same `buildCommand`) |
| `deploy.startCommand` | `python -m api.econ_main` |
| `deploy.healthcheckPath` | `/api/health` — answered by `api/services/econ/service.py` (200 while the loop heartbeat is fresh, else 503), on `$PORT` |
| `deploy.healthcheckTimeout` | 600 |
| `deploy.restartPolicyType` | `ALWAYS` |
| `deploy.drainingSeconds` | 30 |

Only the econ service may point its Railway "config file path" at
`railway.econ.json`. No other service references it
(`tests/econ/test_service.py` checks that no other `railway*.json` names
`econ_main`).

## Why not a start branch in the shared `railway.json`

Phase 1 originally added an inert `ECON_SERVICE_ENABLED=1` branch to the
shared `railway.json` start command. That was removed during integration with
master, for one reason:

**flow-worker's Railway watch list includes exactly `railway.json`**
(`tools/flow_worker_watch_coverage.py`, `tests/test_flow_worker_watch_coverage.py`).
Any edit to that file restarts flow-worker, which leaves a gap in the live
options tape. An econ-only change must never restart flow-worker, so the econ
service gets its own file and the shared `railway.json` stays byte-identical to
master.

Side effects of the new file:

- **web** watches `railway*.json` (`railway.web.json`), so a change to
  `railway.econ.json` rebuilds web. That is acceptable: web also rebuilds on any
  `api/**` change, and every econ change touches `api/**` anyway.
- **flow-worker, worker and bars-api** do not watch `railway.econ.json`, so they
  are not restarted by it.
- `tests/test_term018_every_guard_can_fire.py` reads every `railway*.json` start
  command to find boot modules, so it now also sees `api/econ_main.py`.

## At deploy time (owner decision, not done)

1. Create a dedicated Railway service with config file path `railway.econ.json`
   and a volume for `ECON_DB_PATH`.
2. Set the provider keys (`BLS_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`,
   `EIA_API_KEY`) on that service only.
3. `ECON_PUBLISH_R2=1` on the econ service only, once artifacts are validated.
4. On web: `ECON_SERVING_SOURCE=r2`, then `ECON_ENABLED=1`
   (see `docs/feature_flags.json`).

The web and worker boots do not start the econ service or its scheduler.

## Production storage (dark deployment design — owner ruling 2026-09-29)

| Item | Design |
|---|---|
| Location | `econ.db` (SQLite, WAL) on a DEDICATED Railway volume mounted at `/data` on the econ service ONLY (`ECON_DB_PATH=/data/econ.db`). No other service mounts it; web never opens it (web serves published artifacts). It is NOT bars.db and NOT any existing store — nothing unrelated is created, copied or replaced. |
| Initialisation | Fresh: `store.connect()` creates schema via numbered migrations (`PRAGMA user_version`), then the service backfills the enabled cohort from the agencies. The developer DB (`C:\w\econ1-data`) is NEVER copied to production. |
| Append-only | SQLite triggers `observation_no_update` / `observation_no_delete` RAISE on UPDATE/DELETE/REPLACE (recursive_triggers on); verified again on every backup. |
| Migration/version identity | `PRAGMA user_version` (currently 2); a DB written by a newer build is refused at boot (`SchemaTooNew`). |
| Persistence | Railway volume (survives restarts/redeploys). Irreplaceable content = LIVE vintages captured at release time; everything else is re-acquirable. |
| Backup | Daily verified SQLite online backup (`api/services/econ/backup.py`, `ECON_BACKUP=1`): one self-contained file under `/data/econ-backups`, integrity + append-only triggers checked, newest `ECON_BACKUP_KEEP` (7) kept. Optional off-volume copy `ECON_BACKUP_R2=1` → `econ/v1/backup/econ-YYYYMMDD.db.gz` in the data_sync bucket (econ prefix only). |
| Recovery | Stop service → replace `/data/econ.db` with a verified backup → start. Boot recovery reclaims stale leases, re-publishes pending series, refreshes calendars/states; release windows re-acquire anything newer. Total loss without backup = re-backfill (minutes) + loss of live vintages since the last backup (PIT class of re-backfilled rows is honestly L/U, never V). |
| Raw archive | `ECON_ARCHIVE=local`, `ECON_ARCHIVE_DIR=/data/econ-archive` (retention rule: rows-written / validation-failed / history only; ≈1.2–1.3 GB/yr projected). |
| Expected growth | ≈ 18 MB DB for the 42-series cohort; ≈ 50 MB at 151; artifacts a few MB; archive ≈ 3.5 MB/day. A 5 GB volume covers years. |
| Ownership / single writer | Exactly one writer: the econ service (1 replica). Scheduler/service modules are importable only from `api/econ_main.py` and the econ package (`tests/econ/test_backup_and_ownership.py`); leases in econ.db guard even a mistaken second process; web/worker/bars-api boots never start it. |
| Rollback | Code: web/worker/bars-api carry only dark code (router 404 while `ECON_ENABLED` unset; `ECON:*` refusal guards) — revert the merge commit. Service: stop/delete the econ service; its volume can be detached and kept. Nothing in any other store changes, so rollback touches nothing else. |

## Dark-deployment service settings (the `econ-ingest` service)

- Source: repo `UCT-Dashboard`, branch **`econ/service`** (a deploy branch pointing at the integrated commit), watch patterns `__econ_service_pinned_never_matches__/**` — unrelated pushes never restart it (release-time safety); deploys are explicit (`railway redeploy --from-source` after moving the branch). Same pattern as `fundamentals-v5-runner` / `breadth-v2-runner`.
- Config file path: `railway.econ.json` (start `python -m api.econ_main`, health `/api/health`).
- Replicas: 1. Volume: new, mounted at `/data`.
- Variables: `ECON_DB_PATH=/data/econ.db`, `ECON_ARTIFACT_DIR=/data/econ-artifacts`, `ECON_ARCHIVE=local`, `ECON_ARCHIVE_DIR=/data/econ-archive`, `ECON_BACKUP=1`, `ECON_PUBLISH_R2=0` (dark), `ECON_BACKUP_R2=0` (until the owner arms off-volume backup), provider keys only when available (`BLS_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`, `EIA_API_KEY`).
- web: `ECON_ENABLED` stays UNSET (member API 404). Member enablement is a separate owner decision.
