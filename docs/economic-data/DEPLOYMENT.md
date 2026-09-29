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
