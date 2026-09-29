# Economic Data — Phase 1 implementation contract

Branch `feat/economic-data-p1` (worktree `C:\w\econ1`, base origin/master `3b6cd17e8`).
Inputs: `C:\Users\blake\uct-econ-phase0\` (PHASE0_REPORT.md, econ_catalog.csv, licensing.md, proofs.md, proofs/).
**Every module builds against this document.** If implementation needs to change a contract here, change this file in the same edit.

## Locked owner rulings (2026-09-28)
1. Free keys for BLS/BEA/Census/EIA; server-side env only; keyless mode where the agency allows it.
2. Canonical id `ECON:<SYMBOL>`, display `<SYMBOL>`, source grammar `econ:<SYMBOL>`.
3. Dedicated ingestion service (`python -m api.econ_main`), isolated from web/worker/bars-api.
4. Primary econ charts AND overlays are V1 targets; Phase 1 proves the data contract + harness.
5. Default placement = AVAILABLE AT (release time); observation period always preserved.
6. Charts show latest revision; storage is append-only; PIT class explicit per observation.
7. Entitlement = `api.bars_auth.require_bars_access` (→ `meets_plan_gate`: admin/allowed plan/comped/trial). ONE authority. Never `require_paid`.
8. Add Indicator 6th tab = Phase 2. 9. YELLOW never enabled without `permission_granted` + approval ref. 10. FRED is never a production source.

## Package layout (`api/services/econ/`)
| Module | Owns |
|---|---|
| `model.py` | enums + records (DONE — import from here, do not redefine) |
| `registry/series.json` | THE registry (all 237 catalog rows, cohort flagged). Hand-edited going forward |
| `registry.py` | load + validate (`validate_registry()` returns list of errors; import-time assert in service), `get(symbol)`, `enabled()`, `cohort()`, search view |
| `licensing.py` | clearance rail: `production_eligible(spec) -> (bool, reason)` |
| `secrets.py` | provider key lookup from env + `redact(text)` scrubbing every configured secret value and known secret param names |
| `http.py` | the only network client: redacting, bounded retries, 429/Retry-After, 5xx backoff+jitter, timeouts, conditional GET (ETag/Last-Modified) |
| `adapters/base.py` | `Adapter` protocol (below) + registry of adapters by name |
| `adapters/{bls,bea,census,fed_ddp,nyfed,fiscaldata,eia,dol,fhfa,nyfed_esms}.py` | one per provider family |
| `store.py` | `econ.db` SQLite (WAL), numbered migrations, append-only observations, queries |
| `derive.py` | deterministic derived series with PIT-correct vintage propagation |
| `validate.py` | payload + observation validation (fail closed) |
| `calendar.py` + `calendars/*.json` | release calendar events (feeds, configured schedules, rules) |
| `currentness.py` | state machine per series |
| `ingest.py` | pipeline: fetch → archive → normalize → validate → diff → write → derive → publish → state |
| `scheduler.py` | due-work computation from DB state, leases, backoff |
| `publish.py` + `serving.py` | per-series artifacts (local dir / R2 via `api.services.data_sync`) and the web read path |
| `service.py` | long-running loop + health/status HTTP |
| `api/econ_main.py` | entrypoint |
| `api/routers/econ.py` | member API (flag `ECON_ENABLED`, gate `require_bars_access`) |

## Registry entry (`registry/series.json` → list of objects)
```
symbol            "USCPI"            (canonical = "ECON:USCPI")
name, short_name, description, category, subcategory, country:"US"
role              member|support
status            enabled|disabled|unverified|excluded
cohort            true|false          (the 41 proving series + their support parents)
source: {agency, dataset, provider_series_id, adapter, params:{...adapter-specific}, official_url,
         verified: bool, verified_evidence: "text/URL/proof file"}
frequency         D|W|M|Q|A|IRREG ;  week_anchor SAT|FRI|WED|MON|""
units: {raw, display, fmt, scale}      fmt ∈ num0 num1 num2 num3 pct1 pct2 pp2 bps0 usd_compact k_persons mbbl bcf usd3
seasonal_adjustment SA|NSA|SAAR|NSA-based|SA-based|mixed
history_start     ISO-ish from catalog
release: {calendar_key, cadence, typical_time_et | null, precision_hint, lag_rule: {kind, days}}
revision: {type: none|minor_routine|annual_benchmark|comprehensive|seasonal_factor_revision}
pit: {backfill_class: "U"|"L"}         (U only when revision.type == none)
derivation        null | {op, inputs:[symbols], params:{}, version:int}
licensing: {class: GREEN|YELLOW|RED, clearance, attribution_key, notice_required: bool, approval_ref: null}
aliases, synonyms  (normalized: lower-case, trimmed, deduped)
presentation: {style: line|step|histogram|area}
catalog_row       original catalog notes (provenance)
```
Rails (`validate_registry`): unique symbols; `ECON:`+symbol parses; display symbol not in the equity index snapshot we have (cap_universe) — collision list; adapter exists; enums valid; units.fmt valid; derivation inputs exist and are not circular; `status==enabled` ⇒ `licensing.clearance ∈ {cleared, permission_granted}` AND class != RED AND `source.verified` (derived: all inputs enabled-or-support-verified); `permission_granted` ⇒ `approval_ref` non-empty; `notice_required` ⇒ `attribution_key` resolves in `attributions.json`; aliases normalized & globally unique; no two enabled entries share (adapter, provider_series_id, params) unless declared twins; FRED agency never enabled (`licensing.py` hard-refuses any source whose agency/adapter is FRED).

## Adapter contract (`adapters/base.py`)
```python
class Adapter(Protocol):
    name: str                         # "bls"
    key_env: str | None               # "BLS_API_KEY" or None
    max_series_per_request: int
    def fetch(self, specs: list[SeriesSpec], *, mode: Literal["history","latest"],
              start: date | None, end: date | None, http: HttpClient) -> list[FetchResult]
    # optional:
    def calendar_events(self, horizon_days: int, http) -> list[CalendarEvent]
```
- **Provider "no data" on a DAILY series is not an observation (2026-09-29).** fed_ddp drops `ND` rows of frequency-D series (release zip code list CL_OBS_STATUS: A Normal · NA Not available · ND No data · NC Not calculable; H.15 carries ND exactly on market holidays). `NA`/`NC`/empty stay `None` (a missing value on a day that exists); ND on a non-daily series stays `None`. NY Fed and fiscaldata emit only published business days (0 null rows stored). `validate.check_partial` tolerates a stored daily NULL the payload no longer carries (a pre-fix DB), never a stored value.
- Adapters ONLY normalize provider payloads to `RawObs` (ISO `period_start/period_end`, float|None). All period grammar lives in the adapter (M01→month bounds, Q→quarter bounds, week-ending anchors).
- `request_key` is a redacted identity (e.g. `bls:v2:CUSR0000SA0,CUUR0000SA0:2016-2026`). Never contains a key.
- Keyless fallback: when the key env is absent, adapters use the agency's approved keyless path (BLS v1 / BEA flat files / Census xlsx / EIA ir.eia.gov files) if one exists, else raise `SourceUnavailable("key not configured")`.
- An adapter never decides currentness, never writes the store, never logs payloads.

## Store (`econ.db`, env `ECON_DB_PATH`, default `/data/econ.db` if `/data` exists else `./econ.db`)
```
acquisition(acq_id PK, adapter, request_key, started_at, finished_at, http_status, outcome,
            payload_sha256, payload_bytes, source_published_at, archive_ref, error)   -- error REDACTED
release(release_id PK, release_key UNIQUE, calendar_key, kind 'live'|'backfill'|'derived',
        scheduled_at NULL, created_at, acq_id)
observation(series_id, period_start, release_id, period_end, value NULL, flag, available_at INT NOT NULL,
            available_method, pit_class, acq_id NULL, inputs NULL, ingested_at, validated_at,
            PRIMARY KEY(series_id, period_start, release_id))          -- APPEND-ONLY
calendar_event(event_id PK, calendar_key, period_label, sched_date, sched_time NULL, tz, precision,
               source, provenance, fetched_at, superseded_at NULL)
series_state(series_id PK, state, latest_period, latest_available_at, expected_period, expected_by,
             next_event_id, last_success_at, last_attempt_at, failures, reason, updated_at)
http_validator(request_key PK, etag, last_modified, updated_at)
lease(name PK, owner, expires_at)
validation_event(id PK, series_id, at, severity, reasons, acq_id)
```
- **Append-only**: no UPDATE/DELETE on `observation` (a SQLite trigger RAISEs on both). A new row is written only when (value, flag) differs from the current latest vintage for that (series, period) — re-seeing an identical value is a no-op (idempotent retries). Same `release_key` twice → same release row (UNIQUE + INSERT OR IGNORE).
- **Latest**: per (series, period_start) the row with max(available_at, release_id).
- **As-of T**: same restricted to `available_at <= T`.
- Queries: `meta`, `history(series, start=None, end=None, asof=None)`, `latest(series, asof=None)`, `since(series, available_after)`, `versions(series, period_start)`, `state(series)`.
- **As built (`store.py`)**: `connect(path=None, readonly=False) -> Store` (autocommit; `Store.tx()` = BEGIN IMMEDIATE, nests). Schema additions over the sketch above: `observation` is `WITHOUT ROWID`, `flag TEXT NOT NULL DEFAULT ''`, `pit_class CHECK IN (V,U,L,X)`; `release.kind CHECK IN (live,backfill,derived)` (also checked in Python — `INSERT OR IGNORE` would swallow the CHECK); `calendar_event` has a UNIQUE partial index on `(calendar_key, period_label) WHERE superseded_at IS NULL`; `validation_event.severity ∈ reject|quarantine|warn`, `reasons` = JSON list. Indexes: `observation(series_id, period_start, available_at, release_id)`, `observation(series_id, available_at)`, `acquisition(adapter, started_at)`, `acquisition(request_key, started_at)`, `calendar_event(sched_date, calendar_key)`, `validation_event(series_id, at)`. `PRAGMA recursive_triggers=ON` so `INSERT OR REPLACE` (an implicit delete) also hits the append-only trigger.
  - Writes: `upsert_release(release_key, calendar_key, kind, scheduled_at, acq_id) -> release_id`; `record_acquisition(adapter, request_key) -> acq_id` / `finish_acquisition(acq_id, outcome=, http_status=, payload_sha256=, payload_bytes=, source_published_at=, archive_ref=, error=)` (error passed through `secrets.redact` when importable, capped 2000 chars); `write_observations(series_id, release_id, rows) -> WriteStats(inserted, unchanged, revised)` with rows `(period_start, period_end, value, flag, available_at, available_method, pit_class, acq_id, inputs)` — `inserted` = first vintage of a period, `revised` = new vintage of an existing period; the same release re-sent with a DIFFERENT value for a period it already holds raises `StoreConflict`; non-finite values raise. `append_vintages(series_id, rows+release_id)` = raw append for derive.py (it does its own timeline diff).
  - Reads: `latest_rows(series, asof=None, start=None, end=None)` (alias `history`; `start/end` filter `period_start`) returns `LatestRow(period_start, period_end, value, flag, available_at, first_available_at, available_method, pit_class, release_id, n_versions)` — `first_available_at` = min(available_at) of the period's vintages visible at `asof`, which is where the serving contract places the point. `latest_point` (alias `latest`), `versions`, `vintages(series)` (all rows), `since`, `period_bounds(series, asof=None) -> {oldest, newest, count}`, `get_state/put_state` (alias `state`; merge semantics), `put_event` (insert-or-supersede on date/time/tz change) / `events` / `next_event` / `get_event` / `delete_event` (= supersede, never physical), `get_validator/put_validator`, `acquire_lease/renew_lease/release_lease/lease_holder` (atomic, expiry-based), `add_validation_event/validation_events`, `list_acquisitions/get_acquisition`. `meta` is registry-owned, not a store query.
  - Measured (laptop, WAL, tmp file): 100k-row `write_observations` ≈ 0.7 s; `latest_rows` over 20k periods / 30k vintages ≈ 70 ms.

## Time + PIT rules
- `available_at` (unix s UTC): live capture = `max(scheduled_at, ...)` if seen inside its scheduled window, else first-seen (`detected`); provider-stated publication time wins when present and ≤ first-seen. Never earlier than scheduled; never later than first-seen.
- Backfill: one `release` of kind `backfill` per (series, run); per-observation `available_at` = `backfill_timing.place` (as built 2026-09-29, full audit in `BACKFILL-TIMING.md`): registry `release.lag_rule` → holiday/closure/era bounds (late side only) → funding-lapse floor `max(t, window end)` with PIT → L → SNAP to the agency-stated release time of the period (`calendars/release_history.json`, authoritative/configured calendar events; inferred BEA/MTS labels lag-guarded and never used inside a lapse) → capped at first sighting unless snapped, never before a matched schedule. `available_method` = `rule` | `rule:lapse` | `scheduled:history` | `scheduled:calendar`. `pit_class = U` if `revision.type == none` else `L`, and U → L for back-cast/rebased periods (`BACKCAST_BEFORE`) and lapse-affected rows.
- Derived: value for period p at time T = f(inputs as-of T); vintage change points = union of input change times; `available_at = max(input available_at)`; `pit_class = weakest(inputs)`; `inputs` column records the input (series, period, release_id) cells. Derivation version bump ⇒ new derived release rows, old ones untouched.
- **As built (`derive.py`)**: `available_method` of a derived row = `derived:<op>@<version>` (prefix before `:` is `AvailableAtMethod.DERIVED`). One release per `(symbol, version, available_at)`, key `derived:<SYMBOL>@<version>:<available_at>`. Ops: `yoy_pct` (lag 12 M / 4 Q / 52 W / 1 A), `mom_pct`, `pct_change(n)`, `diff(n=1)`, `spread(a,b)`, `sub(a,b,...)`, `ratio_pct(a,b, scale=100)` / `ratio(scale=1)`, `sma(n)`, `sum(n)`; input transform `params.transforms={SYM:"eop_q"}` (or `params.transform`) = the quarter's latest-period_end daily observation VISIBLE at T. Identity inputs share the derived frequency; M/Q/W/A lags are calendar shifts (a missing period is never bridged), D lags are positional. NA input or divide-by-zero ⇒ explicit NA derived value. `compute_derived(store, spec)` RECONCILES the desired vintage timeline with the stored one (any version) and emits rows only where they disagree ⇒ idempotent, and a version bump writes only disagreements. `_check_no_leak` refuses to emit a vintage earlier than any input used; `audit_derived(store, symbol)` re-proves it from stored rows. Not yet: `align_w` (USNETLIQ).
  - **Float noise decision (2026-09-29): storage stays full precision.** Example: UST10Y2Y `5.17 - 4.81` is stored as `0.3600000000000003`. Rounding to 12 significant digits at compute time was rejected, because `_reconcile` compares values EXACTLY. A version bump would therefore append a new vintage (and, for a daily series, one release per day) for almost every derived row in any existing DB: about 13k rows and releases for UST10Y2Y alone. That is the vintage storm the owner ruled out. Display formatting handles it: every consumer formats through `units.fmt` (`pp2` → `0.36`) on the axis and in the legend, and the error is < 1e-15 relative. The member API returns the stored float and clients format it.
- **Validation (`validate.py`)**: `validate_fetch(spec, fetch_result, store, now=, mode="latest"|"history", start=, end=, requested_ids=) -> (accepted, reasons)`; accepted is empty whenever reasons is non-empty. Reason prefixes: `identity schema numeric duplicate ordering scale mutation partial plausibility`; `severity(reasons)` = `quarantine` iff every reason is `plausibility`. Revision windows: none=0 periods, minor_routine=3 periods, seasonal_factor_revision=5y, annual_benchmark=10y, comprehensive=unlimited, unknown type ⇒ reject. Weekend daily obs reject unless `spec.validation.allow_weekend`. Reasons never echo raw labels/values.

## Currentness
`series_state.state` ∈ model.Currentness. CURRENT iff `expected_period` (from the calendar event or rule) ≤ `latest_period` of a VALIDATED row acquired after the scheduled time. No calendar knowledge ⇒ NO_EXPECTATION. Disabled ⇒ NOT_PRODUCTION.

## As built (release system)
Full detail in `RELEASE-SYSTEM.md`; the contract points every module relies on:
- **Enum additions (`model.py`)**: `Currentness.UNCONFIRMED` (a revision-only release past its window: period held, a validated fetch after the schedule, but no changed value and no provider publication time — neither CURRENT nor DELAYED) and `SchedulePrecision.TIME_CONFIGURED` (date from an official publication that gives no time, e.g. the OMB PFEI for BLS; time configured from agency practice with a citation; must never be presented as agency-published).
- **Event label grammar**: `YYYY-MM` · `YYYYQn` · `YYYY` · `YYYY-MM-DD`, optionally suffixed `/rev<n>` when the release REVISES an already-published period instead of adding one (`2026Q2/rev2` = GDP third estimate, `2026-10/rev1` = G.17 annual revision). One active event per (calendar_key, label), which is why revisions need their own label. A revision event is satisfied only by a positive provider signal after its schedule.
- **Side tables adopted into store migration 2**: `series_ops`, `provider_ops`, `provider_quota`, `calendar_coverage` are created by `store.py` migration 2 with `CREATE TABLE IF NOT EXISTS` (column-identical to the owners' DDL, pinned by `test_store.py`), so a v1 DB that already holds them from the ad-hoc path migrates in place; `currentness.ensure_ops_schema` / `calendar.ensure_schema` remain as harmless no-ops.
- **Validator-deferral proxy**: adapters receive `ingest.DeferringHttp`, never the raw `HttpClient`. Every GET is `defer_validators=True`; an adapter's own `commit_validators` (fed_ddp, bea) is queued and committed only when NO series in the call was rejected and every requested series was carried. A validation-failed or incomplete payload therefore never stores an ETag/Last-Modified and can never make later polls 304 (`test_ingest.py::test_fed_validation_failed_payload_stores_no_validator_and_next_poll_is_full` + negative control).
- **available_at vs schedule**: `available_at` is never earlier than the matched event's scheduled time. When the schedule is LATER than the first sighting (a provider posted early, or a backfill rule time falls before the known event), the row is placed at the **scheduled** time — the schedule wins over first sighting, so an early post is invisible to `asof` queries before the official release.
- **`next_release`** (`publish.next_release`): the first FUTURE event — `series_state.next_event_id` (currentness' first event with `scheduled_at > now` on the series' grid) is preferred; the calendar fallback skips events already passed today. A hole (`precision: unknown`) is published as `{date: null, time: null, precision: "unknown"}` because its `sched_date` is only the earliest possible day.

## Member API (`api/routers/econ.py`, 404 unless `ECON_ENABLED=1`, `require_bars_access` except status)
- `GET /api/econ/catalog` → enabled member series: `{symbol, id, name, short_name, description, category, subcategory, frequency, week_anchor, units:{display,fmt,scale}, seasonal_adjustment, presentation, source:{agency,dataset,official_url,attribution_key}, aliases, synonyms, history_start}` + `attributions` map (notice texts). Never licensing internals, keys, adapter params.
- `GET /api/econ/series/{symbol}?asof=<unix>&start=&end=` (symbol may be `USCPI` or `ECON:USCPI`) →
```
{ "id":"ECON:USCPI", "symbol":"USCPI", "view":"latest"|"asof", "asof":null,
  "meta":{...catalog row...},
  "currentness":{"state","latest_period","expected_period","next_release":{"date","time"|null,"tz","precision"}},
  "columns":["t","v","ps","pe","pit"],
  "points":[[t_available_unix, v|null, "YYYY-MM-DD", "YYYY-MM-DD", "V"|"U"|"L"|"X"], ...]  (sorted by t, then pe) }
```
  In `latest` view each period appears once (latest revision) at its latest `available_at`? NO — at its FIRST availability: a point is placed at the time the period first became known, carrying the latest value (release-date placement; the value is latest-revised by owner ruling #6). `asof` view: each period's value as known at T, placed at first availability, filtered to `t <= T`.
- `GET /api/econ/status` (unauthenticated, dates/states only, snapshot — never computes): per series `{symbol, state, latest_period, expected_period, next_release, last_success_at}` + service heartbeat.
- ETag + `Cache-Control: private` (entitlement-gated).
- **As built** (`publish.py`/`serving.py`/`routers/econ.py`, full detail in `API.md`): `meta.source` also carries `provider_series_id` + `line`; `meta.derivation = {op, inputs}|null`; `start/end` filter `period_start`; artifacts `econ/v1/{series,vintages}/<SYM>.json.gz` + `catalog.json` + `status.json`, `?asof=` answered from the vintages artifact; not-servable → 404 `not_found`, enabled-but-unpublished → 404 `no_data`; flag 404 precedes auth. `/api/bars/ECON:*` is an explicit 404 before any bars machinery.

## Frontend seam
Source grammar `econ:<SYMBOL>` in `engine/sourceRef.js` (distinct from `sym:` and `fund:`), fetched via a clone of `fundamentalSeries.js` (`economicSeries.js`), projected with the shared as-of machinery (`projectAsOf`) with per-frequency max age, gap runs via `gapRuns.js` (lineage widened to econ), formats via the shared format registry. Never `/api/bars`, never `sym:`.

As built (frontend, Phase 1) — contract points the backend must match:
- Grammar: `econ:<SYMBOL>` lower-case prefix, one segment, symbol `[A-Z][A-Z0-9_]{1,31}` (a superset of `model.SYMBOL_RE`; an unknown symbol is a 404 → NO_DATA). `econ:X:field` is refused. `ECON:X` is the API id, read by `economicSymbolOf`, not a source string.
- Points: read BY `columns` name; `v: null` rows are KEPT and end the carry (a provider-stated missing period shows as a gap, never bridged). Points are re-sorted by (t, pe) client-side.
- Staleness (max age from AVAILABILITY `t`, calendar days — 2026-09-29; was "from `pe`", which blanked FHFA, released ~60 d after its month, for most of every month): the backend states `meta.max_age_days` (registry frequency default D 10 · W 13 · M 45 · Q 120 · A 400 · IRREG `null` = ∞, or `presentation.max_age_days`) and it wins; the frontend table `ECON_MAX_AGE_DAYS` mirrors it as a fallback. Overlay: `projectAsOfIndices(..., {ageFrom: 'available'})` (fundamentals keep `ageFrom: 'period'`, unchanged). Series-native timeline: age from the row's own placement date. The first letter of `meta.frequency` is read (`D`/`W`/`M`/`Q`/`A`, or `IRREG`).
- Same-date collapse on the series-native timeline: a NULL never displaces a VALUED point (either order); between two valued points (or two nulls) the later period wins.
- As-of payloads: `currentness` = `{"state": null, "historical": true}` from the backend; the frontend pins any as-of view to historical regardless.
- Intraday projection is STRICT for econ: a point applies to bar [a,b) only if `t < b` (an 08:30:00 print lands in the 08:30 bar, never in the 08:25 bar that closed at that instant). D/W/M use the fundamentals rule unchanged (16:00 ET reference; `t <=`).
- Units: displayed value = `v * units.scale`, then `units.fmt`. So raw-millions USD → `usd_compact`, scale 1e6 (773900 → `$773.90B`); raw thousand barrels → `mbbl`, scale 1e3 (426398 → `426.4M bbl`); raw thousands of jobs → `k_persons`, scale 1e3 (162 → `162.0K`); claim counts → `k_persons`, scale 1. `bps0` prints `v*scale` as bp (a percent series needs scale 100). The axis and the legend use the same function.
- Presentation: `meta.presentation.style` is the instance default (`step` stays step for econ, unlike market indicators); candles never.
- Legend shows the observation period of the point under the crosshair: M `Aug 2026`, Q `Q2 2026`, W `wk 9/19` (pe), D/IRREG `Sep 25, 2026`, A `2025`.
- Placement: default AVAILABLE (t); `placement: 'period'` (by `ps`) is supported by the data path as a parameter, with no UI.

## Env vars
`ECON_ENABLED` (web router), `ECON_SERVICE_ENABLED` (railway start branch), `ECON_DB_PATH`, `ECON_ARTIFACT_DIR`, `ECON_SERVING_SOURCE` (r2|local|db), `ECON_ARCHIVE` (off|local|r2), `BLS_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`, `EIA_API_KEY`.
