# INC-1 — a second copy of the app booted on the production Railway project

**2026-09-16, ~00:03–00:10 UTC. Contained. Nothing reached a member.**

While answering C.2.i, a throwaway `cutover-probe` service was created on the production
Railway project with a Custom Start Command of `echo … && exit 1` — the runbook's safety
design, whose whole purpose is that *the build proves the trigger fired and the app never
runs*. **The guard did not take effect.** `railway.json` is config-as-code and its
`deploy.startCommand` overrides the service-level setting; it falls through to
`exec uvicorn api.main:app`.

The proof needs no inference: `… && exit 1` cannot produce a SUCCESS deployment, and the
deployment reported SUCCESS with `healthcheckPath: /api/health`. The service was deleted as
soon as this was noticed; the roster is back to six.

## What contained it — and it is not what was being relied on

**The variable isolation.** The probe resolved **nine variables, all `RAILWAY_*` platform
metadata**, and nothing else. Measured, with a control: every other service in the project
carries those same nine, `web` carries 249 and `flow-worker` 67, and **not one non-platform
variable reached the probe**.

⭐ **The inverted emphasis is the lesson.** When the runbook's stop condition
(*"STOP if any variable is present and cannot be removed"*) fired on those nine names, it
looked like a false positive and was relaxed on measurement. The clause that was trusted
instead — the start command — failed silently. **The clause whose hazard was measured absent
was the safe one to relax; the clause whose hazard was merely assumed absent was not.**

## C1.1 — side-effect audit, from code

The probe's logs died with the service, so this is a trace of `api.main:app`'s boot against
exactly the environment it had. 68 distinct env gates are read in the lifespan; 55 are OFF at
their defaults. **Nothing reached a member, and no external system was written to.**

| component | would it run? | evidence |
|---|---|---|
| **Massive / OPRA tape** | **NO** | `massive.py:155` raises `RuntimeError("MASSIVE_API_KEY not set")` at client construction; `MASSIVE_WS_ENABLED` unset. **flow-worker's tape was never at risk.** |
| Discord (any channel) | NO | `DISCORD_WEBHOOK_URL` / `DISCORD_TSDR_WEBHOOK_URL` absent; `chart_health_alerts.py:49` `if not webhook:` refuses |
| Email (Resend) | NO | `RESEND_API_KEY` absent |
| R2 / S3 snapshot upload | NO | `DATA_SYNC_*` absent |
| YouTube / Zoom / Stripe | NO | credentials absent; `DESK_DAILY_SESSION_ENABLED` off |
| LLM spend (Anthropic/OpenAI) | NO | `ANTHROPIC_API_KEY` absent (`main.py:7188`) |
| Catalyst engine, Compass, Awareness, Broker sync, Calendar alerts | NO | all default-off gates (`CATALYST_ENGINE_ENABLED`, `COMPASS_AUTOMATION_ENABLED`, `AWARENESS_ENGINE_ENABLED`, `BROKER_SYNC_ENABLED`, `CALENDAR_ALERTS_ENABLED`) |
| **Substack RSS poll** | **YES — outbound GET** | `SUBSTACK_ENABLED` defaults `'1'`; boot thread (`main.py:2971`). `poll_all` is READ-ONLY (no `.post(`; the "publish" matches are field names like `published_at`). Reads the firm's own public feed. |
| **CFTC historical archive** | **YES — outbound GET, ~10 years** | `main.py:4897`: `if _cot_service.is_empty()` → true on a fresh ephemeral DB → seeds `deacot{YEAR}.zip` from cftc.gov. Public government data. |
| yfinance (Yahoo) | **possible** | `USE_REMOTE_BARS` unset so the in-process prewarmer started (`main.py:4343`). Per-ticker Massive calls raise at construction; yf-only index symbols (`^IXIC` etc.) reach Yahoo by design (`bars_fetch.py:1679`). **Not provable either way from code alone.** |
| Writes to shared state | NO | `DATA_DIR` default `/data`, **no volume attached** → an ephemeral container path, destroyed with the service. No Postgres, no Redis, no shared DB credential. |
| Member reachability | NO | no domain attached; nothing routes to it |
| Cron jobs that were default-ON | none fired | the probe lived ~20:00–20:10 ET. `AI_SEARCH_BRIEFINGS` 08:20/16:45, `TICKER_TYPES_SYNC` 05:30, `PREBUILT_REFRESH` monthly day=1, `SINGLE_STOCK_ETFS` **20:30** — 20 minutes after deletion. |
| `CONFLUENCE_ENABLED` (default-on) | NO | self-gates on `WORKER_INTERNAL_URL`, absent — inert by construction |

⚠️ **Limits of this audit, stated rather than implied.** It is a CODE trace. The container's
logs are gone, so "possible" above stays "possible". What is certain is the direction: every
write-capable external surface needs a credential the probe did not have.

## C1.2 — resource usage

Railway's `projectServiceUsage` **is** readable with `includeDeleted: true`, and the query
works — five rows came back for the surviving services (the non-vacuity control). **No usage
row is attributable to the probe.**

## Rules this produced

- **Config-as-code overrides service settings.** Before relying on any control set through a
  dashboard or API field, prove the override does not exist — read `railway.json` /
  `railway.toml` for the same key. (SD-1.3 C1.5)
- **Capture the evidence SHA before deleting the thing that carries it.**
- **A stop condition fires on the letter; measure what fired it before overriding — and
  prefer relaxing the clause whose hazard is measured absent over the one whose hazard is
  merely assumed absent.**
