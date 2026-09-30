# Economic Data Phase 1: the release system

This covers the release calendar, currentness, the ingest pipeline, the scheduler and the dedicated service.
It builds on `PHASE1-DESIGN.md` (binding) and the research in `uct-econ-phase0/phase1_research_calendar_claims.md`.

| File | What it does |
|---|---|
| `api/services/econ/calendar.py` + `calendars/*.json` | Release events: feeds, the agency page, configured files and rules. Also period labels and `expected_period` |
| `api/services/econ/currentness.py` | Pure `evaluate()`, the facts it reads, the ops side tables and `refresh_state` |
| `api/services/econ/ingest.py` | `run_fetch` / `backfill`. Runs fetch → archive → validate → diff → write → derive → publish → state |
| `api/services/econ/scheduler.py` | Works out due work from the DB. Also polling profiles, leases, quota, backoff and reconcile |
| `api/services/econ/service.py` | The loop, the health/status HTTP server and JSON logging |
| `api/econ_main.py` | Entrypoint: `python -m api.econ_main [--once] [--backfill SYMBOLS] [--status] [--db P] [--no-feeds]` |
| `railway.econ.json` | Config-as-code for the future econ service only (`python -m api.econ_main`). The shared `railway.json` is untouched; see `DEPLOYMENT.md` |

## 1. Calendar

### Event model
`calendar_event` rows are written with `store.put_event`. Each row has `calendar_key`, `period_label`, `sched_date` (ET), `sched_time` (`HH:MM` ET or NULL), `tz`, `precision`, `source` and `provenance`. When a date or time changes, the new row supersedes the old one, and nothing is ever physically deleted.

**Source class** (`model.ScheduleSource`) says who stated the date:

| class | meaning | used by |
|---|---|---|
| `authoritative_feed` | machine-readable agency calendar | BEA `release_dates.json` (exact UTC), fiscaldata release calendar (MTS) |
| `authoritative_page` | agency HTML table, parsed | Census economic-indicator list view (sort keys `A{YYYYMMDDHHMM}` / `A{YYYYMM}`) |
| `configured` | an operator transcribed it, with a citation | `bls_2026.json` (OMB PFEI + agency practice), `fed_g17.json`, `fhfa_hpi.json`, `nyfed_esms.json`, the EIA holiday table |
| `rule` | a cadence rule published by the agency | H.15, H.4.1, H.6, NY Fed EFFR/OBFR/SOFR/RRP, DTS, Debt to the Penny, EIA WPSR/gasoline, DOL claims, past MTS |

**Precision** (`model.SchedulePrecision`) says how certain the date and time are:
- `exact`: the agency stated both the date and the time.
- `time_configured`: **added in this phase.** The date comes from an official publication, but that publication gives no time, so the time is configured from agency practice and cited in provenance. BLS works this way because the PFEI lists dates only. Polling windows open at the configured time. The status surface must not present that time as published by the agency.
- `rule`: the date and time come from a published cadence rule.
- `date_only`: the date is known but the time is not. The system never invents a time such as 08:30. Example: a DOL claims week that contains a holiday.
- `unknown`: **a hole.** UCT knows a release exists for this period but not when. Examples: the October 2026 MTS is missing from the fiscaldata feed, and Thanksgiving-week DOL claims have no published shift rule. `sched_date` is the earliest day the release could appear. A hole can only yield NO_EXPECTATION, or CURRENT once the period is held. It never yields CHECKING or DELAYED.

A BLS provenance string looks like this: `[bls_2026] date: OMB PFEI 2026 <url> (sha256 …) | time: CONFIGURED agency practice 08:30 ET …`.

### Period labels
`YYYY-MM` · `YYYYQn` · `YYYY` · `YYYY-MM-DD`, where the last form is a daily observation date or the week-ending date of a weekly period. A label may end with `/rev<n>` when the release **revises** a period that is already published instead of adding a new one. For example, `2026Q2/rev2` is the GDP third estimate and `2026-10/rev1` is the G.17 annual revision. The store keeps one active event per (key, label), which is why revisions need their own label.

`expected_period(spec, event)` returns `Expected(period_start, period_end, label, kind='new'|'revision', revision)` on the spec's frequency grid. It returns `None` when the label cannot be read on that grid, for example a quarterly label on a monthly series or a weekly label on the wrong anchor day.

### Coverage
The side table `calendar_coverage(calendar_key, provider, source, coverage_start, coverage_end, …)` records the date up to which a calendar claims to list every release. Once that date has passed and no future event is known, the series becomes **NO_EXPECTATION**. So `bls_2026.json` (coverage end 2026-12-31) cannot keep a series CURRENT into 2027. Rules have no coverage end because their horizon is regenerated on every refresh. There is also a backstop: a rule key whose newest event is older than 6 d (D), 12 d (W), 50 d (M), 110 d (Q) or 400 d (A), with no future event, is also NO_EXPECTATION.

### Providers (`calendar.refresh(store, now, http=, feeds=, payloads=)`)
- **BEA feed.** Covers `bea:gdp` and `bea:pio`. Duplicates are dropped. The GDP estimate is read from the lag after quarter end: ≤45 d is the advance estimate (NEW), ≤75 d is `/rev1`, ≤110 d is `/rev2`, and anything later is `/rev3`. Labels are forced to increase strictly within a quarter. The post-shutdown catch-up releases in Jan–Apr 2026 may be mislabelled. They are in the past, and only the latest past event drives currentness. PIO carries the month before the release month.
- **Census page.** Covers `census:marts|resconst|m3adv|m3|ft900|ressales|vip|mtis|mwts`. A page with fewer than 100 rows is **refused**; the phase-0 copy had only 22.
- **fiscaldata feed.** Covers `fiscal:mts`. Times are read as UTC; that offset is inferred from the 1 h shift at DST end and is not documented by Treasury. A month inside the feed window that has no MTS row becomes a hole. The 8th-business-day rule is used **only** for months before the feed window, never to fill a hole or forecast.
- **Configured files.** Rows are `[date, label(, time)]`, with a coverage block and citations.
- **Rules.** H.15: observation d → next business day 16:15. H.4.1: Thursday 16:30 for the Wednesday level, moved to the next business day on a holiday. H.6: fourth Tuesday at 13:00, moved to the next business day on a holiday, carrying the previous month. EFFR/OBFR: next business day 09:00. SOFR: next business day 08:00. RRP: same day 13:15. DTS: next business day 16:00. Debt to the Penny: next business day 16:15. WPSR: Wednesday 10:30 for the week ending the previous Friday; exceptions come from the holiday table, and an unlisted holiday week is `unknown`. Gasoline/diesel: the Monday survey is released Tuesday 10:00 (EIA schedule page: "published around 10:00 a.m. Tuesday eastern time, except on government holidays, when the data are released on Wednesday"); a holiday Monday or Tuesday moves it to Wednesday 10:00 (corrected 2026-09-29 — the first cut said Monday 17:00, which made USGASPRICE falsely DELAYED on real data). DOL claims: Thursday 08:30; a week with a holiday Mon–Wed is `date_only`, and a Thursday holiday is `unknown`.
- **Failure handling.** A feed that fails to fetch or parse keeps its stored events, and the refresh summary records a redacted error. A future event that has disappeared from its source is withdrawn (superseded). Past events are never withdrawn.

## 2. Currentness (`currentness.evaluate`, pure)

`evaluate(spec, facts, events, now, coverage_end=None) -> Verdict`. The result can be unpacked as `(Currentness, reason, expected, next_release)`. Facts come from the DB: the newest held period, the newest `ingested_at` (a value changed at that time), the last validated fetch and its provider publication time, failures, the quota block, and the last validation failure. A derived series takes its fetch facts from its inputs.

**Rule: HTTP 200 never implies CURRENT.**
- A **new-period** event is satisfied when its period is held. Only validated rows are ever stored.
- A **revision** event is satisfied when the period is held **and** the provider gave a positive signal after the scheduled time. A signal is either a new vintage (a changed value) or a validated fetch that carried a provider publication time at or after the schedule, such as BEA `Last-Modified`.

Precedence (the first match wins):

| # | state | when |
|---|---|---|
| 1 | NOT_PRODUCTION | not enabled / not production-eligible |
| 2 | VALIDATION_FAILED | the latest validation rejection is newer than the latest validated success. Last good data stays served |
| 3 | UNINITIALIZED / SOURCE_UNAVAILABLE | no data yet (SOURCE_UNAVAILABLE if the source is failing) |
| 4 | NO_EXPECTATION | no event; coverage expired with no future event; stale rule horizon; the current event is a hole whose period is not held |
| 5 | CURRENT | the current event (the latest with `scheduled_at <= now`) is satisfied |
| 6 | **UNCONFIRMED** | revision event past its window, period held, validated fetch after the schedule, **no** signal |
| 7 | SOURCE_UNAVAILABLE | ≥3 consecutive failures, or quota exhausted (`blocked_until`), and the event is not satisfied |
| 8 | DELAYED | an **earlier** event's new period is still missing past that event's own window (a newer event does not reset the clock) |
| 9 | CHECKING | inside `[scheduled_at, window_end)` |
| 10 | DELAYED | past `window_end` |

`window_end` is scheduled time plus grace. Grace is 60 min for BLS, BEA, Census, DOL, FHFA, Fed monthly/weekly, ESMS and MTS; 90 min for EIA; and **one business day** for the daily families (H.15, NY Fed rates, RRP, DTS, Debt to the Penny). A date-only event gets its whole ET day plus the family grace.

**`model.py` additions (enum members only):**
- `Currentness.UNCONFIRMED`: needed because a revision-only release, such as the GDP third estimate, can legitimately republish identical values with no timestamp. Calling that CURRENT would break the HTTP-200 rule, and calling it DELAYED would be a false alarm.
- `SchedulePrecision.TIME_CONFIGURED`: see §1.

`refresh_state` writes `series_state`:
- `state`
- `latest_period` (the period_start ISO date)
- `expected_period` (the **period_start ISO date** of the current event's period)
- `expected_by` (= window_end)
- `next_event_id`
- `last_success_at` / `last_attempt_at` / `failures`
- `reason` (human-readable; it names the label, event, precision and source)

## 3. Ingest (`ingest.run_fetch`)

1. One `call:` acquisition row per adapter call, plus one acquisition row per `FetchResult`: request_key (redacted), status, sha256, bytes, `source_published_at`, archive_ref.
2. The adapter receives a `DeferringHttp`. Every GET uses `defer_validators=True`. Any `commit_validators` call the adapter makes is **queued**, and the queue is committed only if nothing in the call was rejected. A payload that fails validation therefore can never turn later polls into 304s. This holds even for adapters that commit eagerly, such as `bea.py`.
3. `ECON_ARCHIVE=local` writes `ECON_ARCHIVE_DIR/<adapter>/<sha256>.bin` once. If the bytes contain a configured secret value, archiving is refused. **Retention** (2026-09-29): decided after the write step. A live poll's payload is archived only when it wrote at least one row or failed validation; history/backfill/reconcile payloads are always archived. `tools/econ/prune_archive.py` (dry run by default) prunes an existing archive to the same rule.
4. `validate.validate_fetch` runs per (series, result), with `requested_ids` set to all series in the call. If any reason is found, a `validation_event` is recorded, the series gets VALIDATION_FAILED facts, **nothing is written** and the last good data is kept. `MalformedPayload` or `ValidationFailed` raised by the adapter is also treated as a validation failure. An empty result for a requested series counts as a failure (`empty`), not a success.
5. Rows are diffed against the stored latest vintages. A release row exists **only if something is written** under it, so a retry produces zero observation rows and zero release rows.

Release keys:
- live, event matched: `<calendar_key>:<label>`
- live, no event matched: `<adapter>:<series>:<UTC date>`
- backfill or gap fill: `backfill:<series>:<run_id>`
- intra-release correction: `<key>#c<n>`. The same release plus period with a different value is written at detection time and never overwrites.

Revisions published together with a new period join that period's release.

`available_at` rules. The time is never earlier than the scheduled time.
- **Live, event matched.** If the row is seen within 180 s of the schedule, or before it, `available_at` is the scheduled time (`scheduled`). If the provider states a publication time between the schedule and the first sighting, that time is used (`source_timestamp`). Otherwise it is the first sighting (`detected`). If the row is seen after the event's window, it is `detected`.
- **Live, no event.** The provider's time if it is at or before the first sighting, otherwise the first sighting.
- **Backfill or gap fill.** `backfill_timing.place` (2026-09-29; `BACKFILL-TIMING.md`): the registry `lag_rule`, made late-side across holidays, executive-order closures and unevidenced eras; a funding-lapse floor (PIT → L); then **snapped** to the agency-stated release time of that period (release history table or an authoritative/configured calendar event). An unsnapped time is capped at the first sighting, and a row is never earlier than a matched event's schedule. `pit` is the spec's `backfill_class`, downgraded U → L for back-cast/rebased periods and lapse rows.
- **Revision found by a history pull.** First sighting, `detected`, `pit=V`.
- **First-ever data for a series in latest mode.** Treated as history (rule times), so the chart does not show a cluster of points at "now".

Derived series downstream of a changed series are recomputed with `derive.derive_and_write`, transitively. The publish hook is `publish.publish_series(store, sym, now=)`, and its import is guarded. `series_ops.publish_pending_at` is stamped **before** the write and cleared after a successful publish. On boot, `ingest.republish_pending` re-publishes anything written but never published. `backfill(store, specs, start)` runs history mode grouped by adapter; re-running it writes nothing.

## 4. Scheduler

Every decision is recomputed each tick from `calendar_event`, `observation`, `series_ops`, `provider_ops`, `provider_quota` and `lease`. That makes restarts exact: a restart one minute before a release recomputes the probe and burst; a restart mid-burst polls at `last_attempt + interval`; and a restart after a write republishes.

| profile | schedule (elapsed = now − scheduled) |
|---|---|
| burst (default) | T−2 min probe; poll AT T; every 20 s to T+10 min; every 2 min to T+60; hourly to the end of the ET day; every 6 h after that until satisfied |
| daily | T−2 min probe; every 5 min for 30 min; every 15 min to T+2 h; hourly to end of day; every 3 h after that |
| bls_keyless | no probe; T+0, 1, 3, 7, 15, 30, 60 min; every 2 h to end of day; every 12 h after that. About 14 requests on a release day, under the 25/day limit (tested) |
| hole | every 3 h |

- **Batching.** All due series of one adapter form ONE job and ONE `adapter.fetch`, and the adapter chunks them. All BLS series due in the same window share one query.
- **Leases.** A job runs under the lease `ingest:<adapter>`. The owner is `host:pid:uuid` and the TTL is 600 s. After taking the lease, the job **re-checks** which of its series are still due, so a second instance that computed the same job does nothing. When the service boots, `reclaim_stale_leases` frees leases left by a dead process on the **same host**, meaning a pid equal to ours (pid reuse, as in container pid 1) or a pid that is provably dead on POSIX. Leases held by other hosts expire by TTL.
- **BLS attempts per poll** (2026-09-29). `HttpClient` caps api.bls.gov at **2 attempts per request** (`DEFAULT_HOST_MAX_ATTEMPTS`). Every attempt, a 503 included, is counted in `stats()` and charged to the quota. After that, the poll fails and the next poll comes from the schedule plus provider backoff. One JOLTS poll had spent 12 attempts (10× 503).
- **Quota.** `provider_quota(provider, ET day, used)`. BLS allows 500/day with a key and 25/day without one; `ECON_BLS_DAILY_LIMIT` overrides this. Usage is the maximum of the HttpClient host-count delta and the estimate. A job that would go over the limit is not sent. Its series get `last_failure_kind='quota'` and `blocked_until` = the next ET midnight, which makes them SOURCE_UNAVAILABLE, and the provider backs off until then.
- **Provider quota refusal** (2026-09-29, real). BLS v1 keyless answered `daily threshold reached` at 00:11 ET — after the ET day rolled over — and again at 03:11 ET, each time after 3 successful windows (4th query refused), so the provider's reset is NOT ET midnight and its accounting is unknown. An adapter error with `reason == "quota"` is classified `quota`: the series get `blocked_until` and the provider `backoff_until` = `now + ingest.QUOTA_PROBE_S` (3 h, capped at the adapter's `not_before`); the scheduler's own 15-min source backoff never shortens it, and `ingest.backfill` refuses to send while a provider is backing off.
- **First fetch of a daily-quota provider** (BLS keyless): an uninitialized series is fetched with ONE recent 10-year window (1 query), never the 12-query 1913.. history — a refused window throws the whole call away. Older history is an operator backfill, sent window by window (`ingest.backfill(start=, end=)`), which takes the same `ingest:<adapter>` lease as the scheduler so it never races a live job.
- **Backoff.** After a failed call, the provider waits `min(900 s, 30 s·2^(n−1))`. The wait is cleared on the next success.
- **Reconcile.** A bounded history re-pull, once a week per series: 10 years, or 2 years for daily series. It never runs while a live window is open for that adapter, within 30 min of a probe, within 6 h of any attempt on the series, or, for BLS, when more than half the daily quota is used. One series is reconciled per adapter per tick. Changed values become new `detected` vintages.

## 5. Service

- **`boot()`**:
  1. Validate the registry; any error raises `RefuseToStart` (exit 2).
  2. Create the side tables.
  3. Reclaim stale leases.
  4. Re-publish rows whose publish never ran.
  5. Refresh calendars (the three feeds via `HttpClient` unless `--no-feeds`).
  6. Refresh every enabled series' state.
  7. Publish the catalog and status when `publish.py` targets are configured.
- **`tick()`**: calendar refresh every 6 h → scheduler jobs → states (after jobs, or every 60 s) → status snapshot (after jobs, or every 15 s) → `publish.publish_status` heartbeat.
- **`run_forever()`**: sleeps until `scheduler.next_wake` (at most 60 s), in chunks of at most 5 s. On SIGTERM or SIGINT, `stop()` lets the **current job finish**; its lease is released in `finally`, then `shutdown()` stops the HTTP server and releases every lease this owner holds.
- **HTTP on `$PORT`**, using a stdlib `ThreadingHTTPServer` in a daemon thread:
  - `GET /health` and `/api/health` (Railway's `healthcheckPath`): 200 when the heartbeat is at most 180 s old, otherwise 503.
  - `GET /status`: serves the snapshot the loop last built. **The handler never touches the database**, because sqlite connections are per-thread and a status route that computes on request was the cause of the 87 s market-indicators status.
- **Status fields**:
  - `service` {version, owner, started_at, uptime_s, heartbeat_at, ticks}
  - `registry` {total, enabled, cohort, enabled_cohort}
  - `enabled_series`
  - `states` (counts)
  - `next_releases` (top 10, grouped by calendar event, with symbols)
  - `last_success_by_provider`
  - `delayed` (DELAYED / SOURCE_UNAVAILABLE / UNCONFIRMED)
  - `validation_failures` (latest 20)
  - `providers` {consecutive_failures, last_error (REDACTED), backoff_until, …}
  - `retry` (series with failures or blocks)
  - `quota.bls` {day, used, limit}
  - `keys_configured` (booleans only)
  - `calendars` (key, provider, source class, coverage_end, next event)
  - `calendar_refresh`
  - `recent_jobs`
  - `adapter_import_errors`

  The serialized body passes through `secrets.redact` again before it is sent.
- **Logging**: `configure_logging()` writes one JSON object per line, with message and exception text redacted. One line per currentness transition (`econ.currentness: SYM OLD -> NEW (reason)`, logged by `refresh_state` wherever it runs) and one per scheduler job that ran or was refused (`econ.service: job <adapter> <purpose> <symbols> -> <status> written=N requests=N`). Never a value.
- **Environment variables**:
  - (no start-branch variable: the service boots from `railway.econ.json`, see `DEPLOYMENT.md`)
  - `ECON_DB_PATH`
  - `ECON_ARCHIVE`: `off` or `local`
  - `ECON_ARCHIVE_DIR`
  - `ECON_ARTIFACT_DIR` / `ECON_PUBLISH_R2`: used by publish.py
  - `ECON_BLS_DAILY_LIMIT`
  - the four provider key variables
  - `PORT`

## 6. Side tables (created idempotently with `CREATE TABLE IF NOT EXISTS`)

Adopted into `store.py` **migration 2** (also `CREATE TABLE IF NOT EXISTS`, column-identical to the owners' DDL, pinned by `tests/econ/test_store.py`), so a DB created before the adoption migrates in place with its rows. The owners' `ensure_*` calls remain and are no-ops.

| table | owner | purpose |
|---|---|---|
| `series_ops` | currentness.py | per series: last attempt / success / provider publication time, consecutive failures + kind, redacted last error, last validation failure, `blocked_until`, last reconcile / backfill, `publish_pending_at` |
| `provider_ops` | currentness.py | per provider: consecutive failures, redacted last error, last success, `backoff_until` |
| `provider_quota` | currentness.py | per provider, per ET day: requests used |
| `calendar_coverage` | calendar.py | per calendar key: provider, source class, coverage window, refreshed_at |

## 7. Operator procedures

**BLS annual import (every late September, for the following year):**
1. Poll `https://statspolicy.gov/assets/fcsm/files/docs/` for `OMB_pfei_schedule_release_dates_cy<YEAR>.pdf`. Check that `Content-Type: application/pdf`; a miss returns the home page as HTTP 200. File names vary between years.
2. Record the sha256, the PDF ModDate and the server Last-Modified. Render page 4 (BLS/FRB) and transcribe it by hand; the text layer is garbled OCR.
3. Write `calendars/bls_<YEAR>.json`, copying the structure of `bls_2026.json`:
   - Set `coverage.end` to `<YEAR>-12-31`.
   - Keep `precision: time_configured` and the `time_0830` / `time_1000` citations.
   - Take JOLTS dates from a secondary calendar, keep them as lower confidence and label them "not in PFEI". Do not cite FRED as a data dependency.
4. Cross-check every row against at least one secondary calendar, for example the NY Fed national economic calendar. **A disagreement blocks that row until a person resolves it.** This failure mode happened in Jan–Apr 2026, when the PFEI was not revised after the shutdown.
5. Add the file to `CONFIGURED_FILES` and update `KNOWN_CALENDARS` if the id changes. Run `pytest tests/econ -q`. Deploy before Jan 1; otherwise every `bls:*` series shows NO_EXPECTATION from Jan 1, which is by design.

**Release-day verification** (currently manual; there is no automated day-of check): after each scheduled BLS release, `/status` should show `CURRENT` for the series whose period advanced. A series still CHECKING or DELAYED 60 min after the time means either the date is wrong or the release is late. Check the agency's news release, then fix the configured file (supersede the event) or wait.

**After any federal funding lapse or announced reschedule:** treat every configured calendar as unverified. Re-diff it against the agencies and secondary calendars and re-import. Feeds (BEA/Census/fiscaldata) pick up reschedules on their own at the next 6-hourly refresh, and cancelled future events are withdrawn.

**Other configured files:**
- `fed_g17.json` (2027 is already listed): refresh every year from the G.17 page.
- `fhfa_hpi.json` (through Dec 2027).
- `nyfed_esms.json`: coverage ends 2026-12-31, so re-import 2027 from the NY Fed grid.
- `eia_wpsr_holidays.json`: import the next year's holiday rows. Until then, holiday weeks are `unknown` rather than guessed.

## 8. Known limits
- The H.15 and NY Fed rules use the **federal** business-day calendar. A federal business day with no Treasury market data, such as Good Friday, shows CHECKING and then DELAYED until the next observation arrives.
- The Fed will remove DDP "Build Your Package" during the week of Nov 9 (see the research notes). This is a risk to the fed_ddp adapter, not to the calendar.
- DOL claims holiday weeks are `date_only` or `unknown` by design. The research found no published shift rule.
- `reclaim_stale_leases` cannot check pid liveness on Windows (dev only). There it reclaims only same-pid leases.
- Placement is at the scheduled time when a row is first seen within 180 s. BLS/BEA publish exactly on time, and a lag of a few seconds on the API side is not modelled as a later time.

## 9. Simulations (`tests/econ/test_release_simulation.py`)
The scenarios:
- on time
- 10 minutes late
- 5xx then recovery (real `HttpClient` with a fake transport)
- 429 with Retry-After
- network timeout
- malformed payload
- identical 200s
- a revision after the first release
- restart 1 minute before a release after a crash that left a lease held
- restart during polling
- restart after acquisition but before publication
- a duplicate worker
- the keyless BLS profile staying within quota
- BLS quota exhausted

**Negative controls:**
- A mutant that marks CURRENT on any successful fetch is caught.
- A mutant with no clamp on `available_at` is caught by the leak invariant.
- Forced retries create zero release rows.

Every scenario ends by checking the leak invariant: no stored row is available before its release's scheduled time.
