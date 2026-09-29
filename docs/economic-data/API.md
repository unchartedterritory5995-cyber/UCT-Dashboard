# Economic Data — member API, artifacts, serving (Phase 1, as built)

Code: `api/routers/econ.py` (routes) · `api/services/econ/serving.py` (web read path) ·
`api/services/econ/publish.py` (wire format + artifacts). Tests: `tests/econ/test_{publish,serving,router,isolation}.py`.
Contract source: `PHASE1-DESIGN.md` "Member API"; frontend reader: `app/src/components/chart/engine/economicSeries.js`.

## Routes

| Route | Gate | Answers |
|---|---|---|
| `GET /api/econ/catalog` | `require_bars_access` | `{series:[meta…], attributions:{key:notice}}` |
| `GET /api/econ/series/{symbol}?asof=&start=&end=` | `require_bars_access` | the series payload |
| `GET /api/econ/status` | **none** (values-free) | `{service:{…}, series:[{symbol,state,latest_period,expected_period,next_release,last_success_at}]}` |

- **`ECON_ENABLED=1` or 404** on every route, for every caller, admins included. It is a *router* dependency, so a dark
  feature answers 404 before auth (401/403) and before parameter validation (422).
- Entitlement = `api.bars_auth.require_bars_access` → `meets_plan_gate` (admin / pro·premium·lifetime / comped / active
  trial) or the `PUSH_SECRET` bearer. 401 = not signed in, 403 = signed in, not entitled. Same semantics as `/api/bars`.
- `symbol` = `USCPI`, `ECON:USCPI` or `econ:USCPI` (`model.parse_canonical`). Unknown, disabled, unverified, excluded,
  RED, FRED-sourced or support-only → **404 `{"detail":"not_found"}`**, never partial data. An enabled series with nothing
  published → 404 `{"detail":"no_data"}`.
- `asof`: int unix seconds `0..4102444800`; `start`/`end`: real ISO dates filtering **period_start** (inclusive),
  `start <= end`. Anything else → 422.
- Headers: strong content `ETag` (sha256 of canonical JSON, 32 hex), `If-None-Match` → 304 (list form accepted);
  `Cache-Control: private, max-age=60, stale-while-revalidate=600` (status: `private, max-age=30`). Never `public`:
  a URL-keyed shared cache would hand an entitled payload to anyone.

## Series payload

```json
{"id":"ECON:USCPI","symbol":"USCPI","view":"latest","asof":null,
 "meta":{"symbol":"USCPI","id":"ECON:USCPI","name":"CPI-U All Items (SA)","short_name":"…","description":"…",
         "category":"Inflation & Prices","subcategory":"CPI","frequency":"M","week_anchor":"",
         "units":{"display":"index","fmt":"num3","scale":1},"seasonal_adjustment":"SA",
         "presentation":{"style":"line"},
         "source":{"agency":"U.S. Bureau of Labor Statistics","dataset":"CPI (CU)","provider_series_id":"CUSR0000SA0",
                   "official_url":"https://data.bls.gov/timeseries/CUSR0000SA0","attribution_key":"bls",
                   "line":"Source: U.S. Bureau of Labor Statistics"},
         "derivation":null,"aliases":["uscpi","cusr0000sa0"],"synonyms":["cpi","…"],"history_start":"1947-01"},
 "currentness":{"state":"CURRENT","latest_period":"2026-08-01","expected_period":"2026-08-01",
                "next_release":{"date":"2026-10-15","time":"08:30","tz":"America/New_York","precision":"exact"}},
 "columns":["t","v","ps","pe","pit"],
 "points":[[1786537800,320.5,"2026-07-01","2026-07-31","V"],[1789043400,321.0,"2026-08-01","2026-08-31","V"]]}
```

- **Placement**: `t` = the period's FIRST availability; `v` = its latest value (`latest`) or its value as known at `asof`
  (`asof`, and every `t <= asof`). Sorted by `(t, pe)`. `v: null` = provider-stated missing period, kept.
- **meta is a whitelist** (`publish.meta_for`): never `licensing`, `params`, adapter, `catalog_row` (FRED equivalents),
  verification evidence or keys. Added over the design sketch: `source.provider_series_id` (public agency identity),
  `source.line` (the per-chart source line), `derivation:{op,inputs}|null` (a UCT calculation must say so — BLS/BEA/Census
  terms), `source.attribution_keys` only when more than one, `max_age_days` only when the registry sets it.
- **currentness** is read from `series_state` (owned by `currentness.py`) + the next active `calendar_event` for the
  series' `release.calendar_key` (on/after today ET). No state row → `NO_EXPECTATION` if data exists, else
  `UNINITIALIZED`: the serving layer never infers, and never claims `CURRENT` by itself.
- `attributions` (catalog) carries `{agency,text,notice_required,access_date_required,derived_rule,source_url}` per key.

## Artifacts (`publish.py`)

| Key | Content | Written |
|---|---|---|
| `econ/v1/series/<SYM>.json.gz` | the latest-view payload above | when its content hash changes |
| `econ/v1/vintages/<SYM>.json.gz` | `{v,symbol,columns:[ps,pe,t,v,pit,r],rows}` — every stored vintage | when its content hash changes |
| `econ/v1/catalog.json` | `{v,series,attributions}` | when its content hash changes |
| `econ/v1/status.json` | status + `service:{published_at,last_success_at,…}` | every call (it is the heartbeat) |

- Targets: `ECON_ARTIFACT_DIR` (local) and/or R2 via `data_sync.put_bytes` — R2 only when `ECON_PUBLISH_R2=1` **and**
  data_sync has credentials (otherwise dry). Content-addressed + idempotent: a target is skipped when an in-process memo
  or the stored object itself already has the same hash (so a restart does not re-upload). gzip `mtime=0`, so bytes are
  deterministic.
- Non-servable series publish nothing; an enabled series with no validated rows publishes nothing (→ 404 no_data).
- Entry points for the service: `publish_series(store, sym)`, `publish_catalog()`, `publish_status(store, heartbeat=)`,
  `publish_all(store)`.
- **As-of without the DB**: `?asof=` is answered from the vintages artifact by `publish.points_from_vintages`, proven
  identical to `store.latest_rows` for every (asof, start, end) combination in `test_publish.py`.
- **Size** (measured, random values = gzip worst case): monthly CPI 1947–2026, 956 periods → series 49 KB raw /
  14 KB gz, vintages 54 KB / 14 KB. Daily 1962–2026, 16.9k points → series 800 KB / 185 KB gz, vintages 833 KB / 187 KB.
  The vintages artifact ≈ the series artifact × (1 + revisions per period); for the 41 Phase 1 series (≈13 daily) the
  whole set is ≈ 5–6 MB gz. Catalog ≈ 38 KB, status ≈ 5.5 KB.

## Serving (`serving.py`)

`ECON_SERVING_SOURCE` = `r2` (default, production) | `local` (`ECON_ARTIFACT_DIR`) | `db` (dev/tests: `ECON_DB_PATH`
opened **read-only**; payload from the same `build_series_payload`). TTL cache `ECON_CACHE_TTL` (default 120 s,
≤ 2048 entries). Every answer re-checks `publish.servable` against the web build's registry (a series disabled after
publication is refused whole) and rebuilds `meta` from that registry; `status` is whitelisted field by field. A missing
status snapshot → 503 `status_unavailable`; a missing catalog artifact falls back to the registry.

## Isolation from stock bars

`/api/bars/ECON:*`, `/api/bars-history/ECON:*` and `serve_bars`/`serve_bars_history` (the bars-api tier's entry) answer
`404 {"error":"economic series are served by /api/econ"}` **before** proxy, delisted lookup, provider fetch, add-today,
tail status or warm (`api.routers.bars.is_econ_symbol`, a shape test on the whole `ECON:` namespace). `/api/bars/warm`
never kicks one; list-open warms, the worker prewarm ring and the seeder's watchlist tier skip them. The CF edge router
never sees `/api/econ/*` (its route is `/api/bars/*`); a colon-bearing symbol on `/api/bars/` goes to web. Proven in
`tests/econ/test_isolation.py`. Phase 2 seam: econ discovery is `registry.search_view()`, never the stock ticker search.

## Env

`ECON_ENABLED` (web, ledgered dark) · `ECON_SERVING_SOURCE` · `ECON_ARTIFACT_DIR` · `ECON_DB_PATH` · `ECON_CACHE_TTL` ·
`ECON_PUBLISH_R2` (service).
