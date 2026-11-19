# Railway stops reading config files on 2026-12-01: what was done, and the rule from now on

**Read this before you edit `railway.json` or `railway.web.json`, or change a build or deploy
setting of `web`, `worker` or `flow-worker`.**

## The short version

- On **2026-12-01** Railway stops reading `railway.json` / `railway.toml` (hard cutoff, Railway's own
  notice). From that day a service runs on the settings Railway has **stored** for it (what its
  Settings page shows). Railway never copied a config file's values there.
- Three services were built from a config file and had stored settings that would have changed them
  on that day. On **2026-11-14** their stored settings were written to match their files. Nothing was
  deployed. The cutoff should now change nothing for them.
- **From now on:** the config files stay in the repo as the declared settings. After you merge a
  change to one, run `python tools/railway_stored_settings.py --apply --service <name>` for each
  service built from that file. Until 2026-12-01 Railway also still reads the file at deploy time;
  after it, `--apply` is the only way your change arrives.

## Which services, and what they would have lost

Read from each service's last successful deployment (which file it was built from) and from
Railway's stored settings, 2026-11-14:

| Service | Built from | Stored before 2026-11-14 | On 2026-12-01 it would have... |
|---|---|---|---|
| `web` | `railway.web.json` | generic builder; no Dockerfile path, health check, watch paths, restart policy or draining | built without `Dockerfile.web` and gone live with no health check |
| `worker` | `railway.json` | generic builder; a pip-only build; health path `/internal/health`; start `python -m api.worker_main` | changed builder, build and health check at its next deploy |
| `flow-worker` | `railway.json` | generic builder; **no start command**, no health check | started the wrong process at its next deploy: the options tape stops |

The other nine services already ran with no config file (their deployments show none) and are not
affected: `bars-api`, `breadth-v2-runner`, `chart-renderer`, `econ-ingest`, `fundamentals-v5-runner`,
`terminal-next-monitor`, `trade-exchange-news-receiver`, `tx-recap`, `web-front`. Three config files in
the repo are read by no service today: `railway.econ.json`,
`services/pine_runtime/railway.json`, `services/trade_exchange_news_staging_web/railway.json`
(`services/trade_exchange_news_receiver/railway.json` matches that service's stored settings but its
deployments read no file either).

`stream-ingest` (created 2026-11-14) is the proof that a NEW service reads no config file: its first
deploy ignored `railway.ingest.json` and started the default command (the whole web app). Its
settings were then typed into Railway by hand, and it is in `SERVICES` so the tool compares them
with `railway.ingest.json` (watch paths included) from now on.

### `stream-ingest` and `stream-edge`: the files follow the services (owner decision 2026-11-19)

Both were created by hand, have never read a config file (every deployment: `configFile` null,
`fileServiceManifest` empty) and are live (ingest since 2026-11-17, edge serving every member since
2026-11-19). The cutoff changes nothing for them: they already run on stored settings. Their files
had drifted from those settings (builder `NIXPACKS`, and on edge a build command, draining 10 s and a
60 s health-check timeout that Railway never stored). The owner's decision: make the files say what
the services really run on, so that `--apply --service stream-ingest --service stream-edge` changes
**only watch paths**. `tests/test_railway_stored_settings.py` pins that against the stored values.

- `railway.ingest.json`: no builder. Build command, start, health check (`/api/health`, 120 s),
  draining 15 s, overlap 0 and restart policy equal what is stored.
- `railway.edge.json`: no builder, no build command, no draining, no health-check timeout (Railway
  stores none of the three). Start, health check (`/healthz`) and restart policy equal what is stored.
- **Why neither file names a builder.** Railway stores and reports `RAILPACK` for both (stored
  settings and every deployment's `serviceManifest.build.builder`), yet the build log of each one's
  last successful deployment says `using build driver nixpacks-v1.41.0` and runs `/nixpacks.toml`'s
  setup and install. `econ-ingest` is the same; `tx-recap`, also stored `RAILPACK`, builds with
  `railpack-v0.43.0`. Which builder a stored `RAILPACK` yields is therefore not settled here, and
  writing either name could change how a live service builds. With no builder in the file the tool
  neither compares nor writes one. `nixpacks.toml` stays in stream-edge's watch paths for the same
  reason: it shapes the image.

## The tool

```sh
python tools/railway_stored_settings.py                          # compare every service. exit 0 same / 1 different / 2 could not tell
python tools/railway_stored_settings.py --service web            # compare only web (repeat --service for more)
python tools/railway_stored_settings.py --apply --service web    # store what web's file says. Does NOT deploy.
python tools/railway_stored_settings.py --self-check
```

- It compares every setting a config file supplies with what Railway has stored, for the services
  in `SERVICES` in the tool (the three above plus `stream-ingest` and `stream-edge`).
- `--service NAME` (repeatable) limits a compare or an apply to the named services; an unknown name
  is refused (exit 2), never read as "the same".
- **`--apply` refuses to run without at least one `--service`** (since 2026-11-19). A bare `--apply`
  wrote every service whose stored settings differed; on 2026-11-19 that included `stream-ingest`
  and `stream-edge`, whose files then said builder `NIXPACKS` while Railway had `RAILPACK` stored.
  Name the service you mean to change.
- `--apply` writes only where something differs, through Railway's `serviceInstanceUpdate` API call.
  Measured four times on 2026-11-14: the call stores the settings and starts **no** deployment. A
  service picks stored settings up at its next deployment.
- It refuses a config key it has no stored field for. `tests/test_railway_stored_settings.py` runs
  the same check on the repo's real files in CI (`.github/workflows/railway-config.yml`), so such a
  key cannot be merged quietly.
- It needs a Railway CLI of **version 5 or newer**, signed in, run from a folder linked to the
  project. The shared CLI on this PC is 4.35.0 (other tooling depends on it), so point the tool at
  the separate copy: `RAILWAY_CLI=C:\Users\Patrick\railway-iac\cli\node_modules\@railway\cli\bin\railway.exe`.

⛔ **A version 5 CLI updates "the Railway CLI" by itself, through npm, and that means the SHARED
global copy.** On 2026-11-14 the separate 5.74 copy upgraded the global install from 4.35.0 to 5.74.0
within minutes of first use. It was put back and auto-update was turned off
(`railway autoupdate disable`, stored in `~/.railway`). If you ever install another copy, run that
command with it first and check `railway --version` afterwards.

## What is proven and what is not

Proven on production, 2026-11-14:

- Railway accepts and returns every stored setting written for the three services (read back field
  by field; `tools/railway_stored_settings.py` exit 0).
- Each kind of stored setting already runs in production on a service that reads no config file:
  Dockerfile path (`web-front`, `chart-renderer`), start command and health check (`web-front`,
  `trade-exchange-news-receiver`), draining and overlap (`trade-exchange-news-receiver`), watch
  paths (most services).
- **A stored Nixpacks builder with the stored build command works with no config file.** A throwaway
  service with no variables, no volume and a do-nothing start command was given `flow-worker`'s
  builder and build command and connected to this repo. A new service cannot read a config file at
  all, which is exactly the condition after the cutoff. Its deployment read no file, built with
  `NIXPACKS` and `/nixpacks.toml`, and its container started on the stored start command and stayed
  up. The service was deleted afterwards.

NOT proven, because it needs a deploy of the real service with no file read:

- `web`, `worker` and `flow-worker` themselves building from stored settings only. By construction
  the stored settings equal the file-supplied ones, so the result should be identical.
- **For `worker` and `flow-worker` the first such deploy is the first manual deploy after
  2026-12-01.** Whoever does it: follow `docs/runbooks/worker-deploys.md` /
  `docs/runbooks/flow-worker-deploys-and-flow-db.md` as always, and additionally check the new
  deployment's start command and builder in Railway (Deployments > the deployment > Details) before
  trusting it. If the build fails, the old deployment keeps running: nothing is lost, fix the stored
  settings (`--apply`) and deploy again.

## Things that will mislead you

- **Do not run `railway config migrate` on this project.** Railway's migration tool does not
  recognise a config file named `railway.web.json`, so it leaves `web` out entirely, and it assigns
  the root `railway.json` to eleven services including `web-front`. Its `cutover` only clears a
  custom config path, which only `web` has, and clearing it would make `web` read the root
  `railway.json` (the worker start command). Its own status line says "No services read Config as
  Code" for this project. None of that is safe here.
- **Do not clear `web`'s Config File path before 2026-12-01** for the same reason: with no custom
  path Railway reads the root `railway.json`.
- After a stored-settings update, the record of the service's already-running deployment shows
  `builder: RAILPACK` and `runtime: UNSPECIFIED` where it showed the real values before (seen on all
  three services; images and containers unchanged). Read the builder from a deployment made after
  the update, not from that record.
- **The builder field is not proof of the builder.** On 2026-11-19 `stream-ingest`, `stream-edge` and
  `econ-ingest` all read `RAILPACK` (stored and in the deployment manifest) and all built with
  `nixpacks-v1.41.0`. The build log's `using build driver ...` line is what says which builder ran.
- `tools/railway_config_audit.py` still fails two older checks that have nothing to do with this
  (`worker` watch paths, `MASSIVE_WS_ENABLED` on `web`), and no scheduled task runs it.
- The watch-path table in `docs/runbooks/deploy-windows.md` is from 2026-09-12; its `web` row is wrong.

## After 2026-12-01

The config files are no longer read by Railway. They remain the declared settings, kept honest by the
tool. Nothing needs to be deleted on the day. If Railway's Infrastructure as Code (`.railway/railway.ts`,
`railway config plan/apply`) is adopted later, note that one file then describes the whole project and
leaving a service out of it means deleting that service, unless the file exports a named partial.
