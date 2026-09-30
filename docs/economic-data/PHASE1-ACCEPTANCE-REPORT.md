# UCT Economic Data — Phase 1 Acceptance Report

**Status: LOCAL ONLY — NOT DEPLOYED.** Nothing was pushed, merged, deployed or changed in production. No Railway action, no production env/DB/R2 write, no member exposure. The owner's standing hold (2026-09-29) applies: acceptance is **not** deployment authorization.

Date: 2026-09-29. Branch `feat/economic-data-p1`, worktree `C:\w\econ1`, base `origin/master 3b6cd17e8`.

Detailed evidence is in `docs/economic-data/`:
- `PHASE1-DESIGN.md` — the contract, with "As built" notes
- `RELEASE-SYSTEM.md`
- `API.md`
- `BACKFILL-TIMING.md`
- `COHORT-CENSUS.md` / `.csv`
- `LIVE-RELEASES.md`
- `PERFORMANCE.md`
- `EXPANSION-151.md` / `.csv`
- `fed-ddp-retirement.md`
- `verification/*.txt`
- `registry-corrections/*.json`
- `harness/` and `harness/real/`
- `samples/`
- `service-status-sample.json`

Local data lives in `C:\w\econ1-data\`. It holds `econ.db`, the artifacts, the raw archive, logs, and the evidence databases `econ-pre-rebuild-*.db`.

---

## 1. Executive summary

UCT now has a durable economic-data platform, running locally end to end on real authoritative data.

- **Registry.** One machine-checked registry holds all 237 catalog series. A licensing rail means RED, uncleared or FRED series cannot be enabled.
- **Adapters.** There are 10 source adapters, each verified live against official endpoints.
- **Store.** Observations are append-only (database-enforced). Each keeps its observation period, availability time, vintage identity and PIT class.
- **UCT-computed series.** These are PIT-correct.
- **Release system.** A release-aware calendar and scheduler drive a currentness state machine in which HTTP 200 never means CURRENT.
- **Service and API.** A dedicated ingestion service feeds a dark member API that uses the one canonical paid gate. `ECON:*` is isolated from every stock-bars path.
- **Frontend.** An `econ:` Universal Data source reuses the fundamentals PIT machinery. Primary-chart and overlay presentation is proven in a real browser on real data.

**Cohort result:** 42 enabled series (the 41-series cohort minus USRETAIL, plus 2 parents). All have full authoritative history and all are **CURRENT**.

**Real releases observed live:** five on 2026-09-29, from NY Fed, FHFA, EIA and BLS. Two were real revisions, stored as new vintages beside the originals:
- FHFA June: 442.53 → 442.34
- JOLTS July: 7,271 → 7,335

As-of queries return the original values before each release.

**One series is failed closed:** USRETAIL, over an unresolved Census basis conflict.

**Verdict:** **ECONOMIC DATA PHASE 1 ACCEPTED — READY FOR OWNER REVIEW, NOT DEPLOYED** (§69).

## 2. Branch / worktree / HEAD

- Branch `feat/economic-data-p1` in worktree `C:\w\econ1`, based on `3b6cd17e8` (origin/master on 2026-09-28).
- HEAD at the time of writing is listed in §62.
- origin/master has since moved to `14cb488e5` (2026-09-29). It is recorded for the integration pass and **not** merged.
- The Phase 0 audit worktree `C:\w\econ` (detached `38bb9a421`) was left untouched.
- A clean-base worktree, `C:\w\econbase`, was used for baseline test runs.

## 3. Phase 0 artifacts used

These were treated as authoritative inputs:
- `C:\Users\blake\uct-econ-phase0\PHASE0_REPORT.md`
- `econ_catalog.csv` (imported into the registry by `tools/econ/import_catalog.py`)
- `licensing.md` (for licensing classes and notice texts)
- `proofs.md` and `proofs/` (for fixtures and cross-checks)
- `phase1_research_calendar_claims.md` (BLS calendar and current-week claims research)

The 41-series cohort was used as selected. USRETAIL is failed closed, and no series was substituted.

## 4. Architecture implemented

```
agency ─► adapters/<provider>.py ─► RawObs ─► validate.py (fail closed) ─► store.py econ.db
                                                      (append-only vintages)
                                          ├─► derive.py (PIT-correct vintages)
                                          ├─► currentness.py ◄─ calendar.py
                                          └─► publish.py ─► artifacts ─► serving.py ─► /api/econ/*
                                                                                          │
                                  app: econ:<SYM> ─► economicSeries.js ─► projectEconomic
                                       ─► binder / gapRuns / formats / legend ─► pane or primary
```

- **Runtime:** `python -m api.econ_main`, which runs `service.py` with the scheduler. It is a dedicated service with an inert `ECON_SERVICE_ENABLED` start branch in `railway.json`.
- **No second chart engine:** there are no fake candles and no Market Indicators `/api/bars` path.

## 5. Canonical econ identity

- The canonical id is `ECON:<SYMBOL>` (e.g. `ECON:USCPI`).
- The member display symbol is `USCPI`.
- The Universal Data source is `econ:USCPI`.
- `model.parse_canonical()` is the one parser.

Why the colon namespace:
- The CF edge sends colon ids to web.
- The delisting cleanup exempts them.
- `/api/bars` refuses them.

The collision rail checked the registry against the equity universe, ETFs and delisted tickers and found 0 collisions.

## 6. Registry implementation

- **Source file:** `api/services/econ/registry/series.json`, one hand-edited file with 237 entries. `registry.py` loads it, validates it and provides the cohort and search views. `attributions.json` holds the notice texts.
- **Each entry carries:** identity, names, category, geography, agency, dataset, provider series id, adapter params, verification evidence, frequency and week anchor, units (raw, display, format, scale), seasonal adjustment, history start, release calendar key, typical time, lag rule, revision type, PIT backfill class, derivation, licensing, aliases/synonyms, presentation and status.
- **Status counts:**

  | Status | Count |
  |---|---|
  | enabled | 42 |
  | disabled | 138 |
  | unverified | 40 |
  | excluded (RED) | 17 |

- **Corrections:** adapter-verified corrections are applied by `tools/econ/apply_corrections.py`. A correction applies only if the current value matches its expected old value, and declined corrections are recorded.

## 7. Registry validation results

`validate_registry()` returns 0 errors on the committed registry. It enforces these rails:
- unique symbols and canonical ids
- no collisions with equity tickers
- adapters exist
- enums, formats and presentation values are valid
- enabled ⇒ cleared licensing ∧ not RED ∧ verified source
- YELLOW ⇒ `permission_granted` + `approval_ref`
- notice required ⇒ attribution resolves
- derivation inputs exist and are not circular
- aliases are normalized and unique
- no conflicting duplicate provider identities
- FRED is never enabled

Every rail has a negative control, plus mutation tests on real entries (`test_registry.py`, `test_licensing.py`).

## 8. Licensing rail

- `licensing.production_eligible()` is called at registry validation, at ingest and again at serve time.
- RED is blocked. YELLOW needs `permission_granted` plus `approval_ref`.
- FRED/ALFRED is hard-refused regardless of fields. This covers agency, adapter, URL, provider id and params, and does not match Freddie Mac.
- A series disabled after publication drops out of the catalog, the status output and the series 404 path (tested).

## 9. FRED retirement proof

- **`api/services/fred_economic.py`** is an always-refusing stub. It has no environment escape, makes no requests, and returns `{"error":"FRED retired…","retired":true}`.
- **Callers:**
  - `options_chain` uses its existing 4.5% default.
  - The voice tools degrade honestly and are removed from Compass's tool list.
  - `admin_api_health` lists the econ keys instead.
- **Licensing register:** FRED is now RED, citing `fred.stlouisfed.org/legal/` ("storing, caching, or archiving").
- **Tests:** `tests/econ/test_fred_retired.py` and the rewritten `tests/test_fred_economic.py` (with `FRED_API_KEY` set, the stub still refuses). Mutation checks: a rail made always-false fails 13 tests, and re-arming the stub on the key fails 2.

## 10. Economic observation schema

`observation(series_id, period_start, release_id, period_end, value NULL, flag, available_at, available_method, pit_class, acq_id, inputs, ingested_at, validated_at)` with primary key (series, period_start, release_id).
- `period_start` and `period_end` describe what the number measures.
- `available_at` records when it became knowable, and `available_method` how that time was established (source_timestamp, scheduled, detected, rule, derived).
- Provenance comes from `acquisition` (redacted request identity, HTTP status, payload sha256, source publication time, archive reference) and `release` (release key, calendar key, kind, scheduled time).

The full schema is in the "Store" section of `PHASE1-DESIGN.md`.

## 11. Storage architecture

- **Main store:** a dedicated SQLite file, `econ.db` (WAL), owned by the econ service. It is separate from bars.db and every other store.
- **Migrations:** numbered in `PRAGMA user_version`. The service refuses a database written by a newer build.
- **Raw archive:** content-addressed and local in Phase 1, with a retention rule (§57).
- **Served artifacts:** per-series latest and vintages files, a catalog and a status snapshot, served from local, R2 or DB. **R2 publishing is off in every local process.**

## 12. Append-only revision model

- SQLite triggers `RAISE(ABORT)` on UPDATE, DELETE and REPLACE of `observation` (tested).
- A new row is written only when (value, flag) differs from the current latest vintage for that period. Re-seeing an identical value writes nothing, so retries are idempotent.
- If the same release and period arrive with a different value (an intra-release correction), a correction release `<key>#c<n>` is created.
- **Real proof on 2026-09-29:**

  | Series | Original vintage | Revised vintage |
  |---|---|---|
  | FHFA June 2026 | 442.53 (backfill) | 442.34 (live, 13:00Z) — plus 22 other revised months |
  | JOLTS July 2026 | 7,271 (preliminary) | 7,335 (live, 14:03Z) |

  Both vintages are present for each.

## 13. PIT classification model

`model.PitClass`:

| Class | Meaning | PIT-safe? |
|---|---|---|
| **V** TRUE_VINTAGE | Captured live, or from an authoritative vintage archive | yes |
| **U** UNREVISED_HISTORY | Backfill of a series declared non-revising, timed by a proven late-side rule | yes |
| **L** LATEST_BACKFILL | Latest-known value that may include later revisions | no |
| **X** UNKNOWN | Provenance not established | no |

- Consumers use `model.PIT_SAFE = {V, U}`.
- A derived value takes the weakest class among its inputs.
- **Downgrades to L:** rows inside a funding-lapse window, CPI NSA before 1988, Treasuries before June 1977, and Debt to the Penny before 2005-04-04. The reasons are in BACKFILL-TIMING.md.
- **Local DB distribution:** V 31, U 62,843, L 36,544, X 0.

## 14. Latest query behavior

- `latest_rows()` returns, for each period, the newest vintage: highest `available_at`, then highest release id.
- The member latest view places each point at the period's **first** availability and carries the **latest revised** value (owner ruling #6).
- Latency: 1.1 ms for a latest point; 43 ms for the full history of a 16.9k-day series.

## 15. As-of query behavior

- `asof=T` restricts every query to `available_at ≤ T`. A future release is invisible, and a period before its first availability returns nothing.
- `?asof=` payloads return `currentness: {state:null, historical:true}`.
- **Proven on real data:**

  | Series | As of 1 s before the release | After the release |
  |---|---|---|
  | FHFA June | 442.53 | 442.34 |
  | JOLTS July | 7,271 | 7,335 |

- Across the whole database, 0 rows are available before their release's scheduled time.

## 16. Source adapter contract

- `adapters/base.py` defines the `Adapter` protocol: `fetch(specs, mode, start, end, http) -> [FetchResult]`, with optional calendar and probe hooks.
- `SeriesSpec` is a view over a registry entry.
- Adapters only normalize to `RawObs`. They never write the store or decide currentness.
- Each adapter supports a keyed and a keyless mode where the agency allows both, and every `request_key` is redacted.
- A `FakeAdapter` supports scripted simulations.

## 17. Adapters implemented

| adapter | source | modes | notes |
|---|---|---|---|
| bls | BLS Public Data API | v2 keyed / v1 keyless | range splitting, truncation detection, quota-aware, max 2 attempts per request, `latest_period_probe` |
| bea | BEA | API keyed / NIPA flat files keyless | Last-Modified gives the real release time; conditional GET |
| census | Census | EITS keyed / econ_export CSV keyless | 302-to-missing_key detection; advance program merge |
| fed_ddp | Federal Reserve Board | release-page XML (default), DDP package, DDP zip | survives the DDP retirement (`fed-ddp-retirement.md`); identity check on unit/multiplier; ND holiday rows dropped |
| nyfed | NY Fed Markets API | keyless | EFFR, target range, SOFR, RRP (primary ON RRP operation only) |
| nyfed_esms | NY Fed Empire State | keyless CSV | GACDISA verified |
| fiscaldata | Treasury Fiscal Data | keyless | three TGA label eras; MTS row month from `classification_desc`; release calendar |
| eia | EIA | API v2 keyed / dnav keyless | publication time from a Range probe |
| dol | DOL ETA | XML history + official press PDF | current advance week, cross-validated four ways |
| fhfa | FHFA | CSV | `place_id` USA confirmed |

## 18. 41-series cohort table

The full table is in `COHORT-CENSUS.md` §1. It has 43 registry entries: the 41-member cohort plus parents USCORECPINSA and USGDP.

**Enabled (42):**

| Group | Series |
|---|---|
| BLS | USCPI, USCPINSA, USCORECPI, USCORECPINSA, USPPIFD, USECI, USUNRATE, USNFP, USJOLTSO |
| UCT-derived | USCPIYOY, USCPIMOM, USCORECPIYOY, USNFPCHG, USPCEPIYOY, UST10Y2Y, USDEBTGDP |
| BEA | USGDP, USRGDP, USRGDPQA, USPCEPI, USCOREPCE |
| Census | USHOUST, USDURGOODS, USTRADEBAL |
| Fed Board | UST2Y, UST10Y, USFEDBAL, USM2, USINDPRO |
| NY Fed | USEFFR, USFEDFUNDSU, USFEDFUNDSL, USSOFR, USRRP, USEMPIRE |
| Treasury | USDEBT, USTGA, USMTSDEF |
| DOL | USICSA |
| EIA | USCRUDEINV, USGASPRICE |
| FHFA | USFHFAHPI |

**Failed closed:** USRETAIL (unverified). The Census econ_export history (737,763 for August) and the advance release table (773,947) differ by about 4.8% on every month; the basis (employer-only benchmark, April 2025) is unresolved.

## 19. Per-series source / provider ID

These are in `COHORT-CENSUS.md` §1 (the provider id column) and `registry/series.json` (`source.provider_series_id` plus `params` and `verified_evidence`).

Corrections found during live verification:

| Series | Change |
|---|---|
| USM2 | dataset changed to `H6_M2` |
| USINDPRO | now `G17/IP_MARKET_GROUPS` |
| USRRP | now `/api/rp/results/search.json`, primary ON RRP only |
| USEMPIRE | `GACDISA` confirmed |
| BEA levels | units are $M with UNIT_MULT 6, not $bn |
| USDEBTGDP | scale changed to 1e-4 |

## 20. Oldest / newest / count for all 41

These are in `COHORT-CENSUS.md` §1 and `.csv`. Examples:

| Series | Oldest | Newest | Count |
|---|---|---|---|
| USCPINSA | 1913-01 | 2026-08 | 1,364 |
| USCPI | 1947-01 | 2026-08 | 956 |
| UST10Y | 1962-01-02 | 2026-09 | 16,889 |
| USICSA | 1967-01 | 2026-09-19 (advance) | — |
| USRGDP | 1947Q1 | 2026Q2 | 318 |
| USFEDBAL | 2002-12 | 2026-09-23 | — |

## 21. Units / frequency verification

- **Adapter identity checks:**
  - Fed DDP: unit, multiplier and unique identifier.
  - BEA: UNIT_MULT.
  - Census: CSV header lines, including the check that catches the silently returned "CV" sampling-error series.
- **Validation checks:** the period grid (month/quarter starts, weekday anchors, business days) and the scale-slip guard (ratio versus last stored value outside [1/50, 50] is rejected).
- **Presentation:** the frontend axis and legend use one format function each.
- Units and scale are listed per series in the census.

## 22. Historical acquisition proof

- **Non-BLS backfill:** 26 series, 65 requests, about 102 s wall time, 76,368 rows plus 14,061 derived rows, 0 validation rejections.
- **BLS:** 12 keyless windows, 1913–2026, completed under the quota watcher.
- **Timing:** backfill timing was then re-placed by the late-side rules (§13, `BACKFILL-TIMING.md`).
- **Store now:** 99,418 observation rows.

## 23. Latest-value verification

- Every newest stored value matches its adapter's live verification output and every Phase 0 value (`COHORT-CENSUS.md` §verification, `verify_latest`: 0 mismatches).
- Independent secondary checks:
  - H.15 against the Treasury par curve (10Y 5.17, 2Y 4.81).
  - NY Fed EFFR against H.15, identical on all 2,657 days.
  - FT-900 exhibit 1 for the trade balance.
  - FRED checked by hand for CPI, UNRATE, NFP, PPI and JOLTS, comparison only; nothing from it is stored.
  - The Empire State report text ("7.6").

## 24. Revision proof

- **Real:** the FHFA and JOLTS revisions in §12 and §15, captured by the running local service.
- **Deterministic:** GDP 2.4 → 2.6 → 2.7 with as-of queries between each; revision after first release; correction releases (`test_store.py`, `test_release_simulation.py`).
- **Backfill honesty:** backfilled history is class L (or U only where the series is non-revising), never V.
- **Pending:** the real comprehensive-revision capture of the BEA GDP third estimate (2026-09-30 08:30 ET). The local service is running for it and it will be appended as an addendum.

## 25. Derived-series proof

- **Ops:** yoy_pct, mom_pct, pct_change, diff, spread, ratio_pct with eop_q, sub, sma and sum.
- **Vintage rule:** a derived value's change points are the union of its inputs' vintage times. `available_at` is the latest input's, and the PIT class is the weakest input's.
- **Guards:** a leak guard (a would-be early value raises `DerivationLeak`, with a mutation test) and `audit_derived` (clean on the real DB).
- **Real checks:**
  - USPCEPIYOY matches BEA's published year-over-year change (BPCERO) on 799 of 799 months.
  - UST10Y2Y 0.36 matches the Treasury par-curve spread.
  - A parent revision creates a new derived vintage and keeps the prior one (tested).

## 26. BLS calendar resolution / status

- **Dates are authoritative** from the OMB PFEI 2026 schedule (statspolicy.gov PDF). It was corrected for the post-shutdown January–April 2026 errors.
- **Times are configured** from agency practice (`precision: time_configured`).
- **JOLTS** is not in the PFEI. It is configured with lower confidence and cited.
- **Day-of verification:** api.bls.gov (not blocked) confirms each release, and the calendar is never scraped around the Akamai block.
- **Expiry:** the calendar file ends 2026-12-31, after which every BLS series reports NO_EXPECTATION until the 2027 PFEI import. The operator procedure is in `RELEASE-SYSTEM.md`.

## 27. Current-week claims resolution / status

- **Resolved and enabled.** The official DOL press PDF on `oui.doleta.gov` is reached through `weeklyRedirect.php`. It is keyless, public domain, and not behind the Akamai block, and it carries the current advance week.
- **Four cross-validations:** prose equals table; the revised prior week agrees; NSA divided by the XML seasonal factor is within 0.5% of SA (0.18% measured); the file-name date equals the embargo date.
- **History** comes from the XML (1967 onward).
- **Latest:** week of 09-19, 197,000 SA advance.

## 28. Release scheduler architecture

- **Calendar sources:**
  - BEA JSON feed (authoritative)
  - Census list view (authoritative page)
  - BLS, G.17, FHFA and ESMS (configured, cited)
  - Rules for H.15, H.4.1, H.6, NY Fed, DTS, Debt to the Penny, EIA (with its holiday table) and DOL
  - Fiscal Data calendar for MTS (the October hole is kept as a hole)
- **Coverage expiry** leads to NO_EXPECTATION.
- **Polling windows:** a probe at T−2 min; every 20 s from T to T+10 min; every 2 min to T+60; then hourly; then DELAYED.
- **Batching and quota:** BLS polls are batched and quota-tracked.
- **Reconciliation:** a weekly bounded reconciliation pass.

Details are in `RELEASE-SYSTEM.md`.

## 29. Currentness state machine

States: CURRENT, CHECKING, UNCONFIRMED, DELAYED, SOURCE_UNAVAILABLE, VALIDATION_FAILED, NO_EXPECTATION, UNINITIALIZED, NOT_PRODUCTION.

Rules:
- CURRENT requires the expected period to be present, validated and acquired after the scheduled time.
- A revision-only release needs a positive provider signal; without one it stays UNCONFIRMED.
- HTTP 200 never means CURRENT. A mutant that makes any success CURRENT fails 13 tests.

The frontend maps each backend state to a display state and fails closed:

| Backend state | Frontend state |
|---|---|
| CURRENT | current |
| CHECKING, UNCONFIRMED | updating |
| DELAYED | delayed |
| SOURCE_UNAVAILABLE, VALIDATION_FAILED | unavailable |
| NO_EXPECTATION, UNINITIALIZED, NOT_PRODUCTION, anything unknown | no_expectation |

## 30. Late-release behavior

- **Simulation:** a release arriving 10 minutes late goes CHECKING → CURRENT, and `available_at` is set to the detection or source time, not the scheduled time.
- **Real:** JOLTS answered 503 ten times at 10:00, then succeeded at 10:03. It was placed at the real availability time, 10:03.
- **Real:** EIA gasoline was posted early (08:45). It was placed at the scheduled 10:00, so nothing appears before its schedule.

## 31. Retry / recovery behavior

- **Bounded, provider-aware retries:** 5xx backoff with jitter; 429 honours Retry-After; timeouts; no retry on 4xx.
- **BLS:** a quota refusal blocks the provider for 3 hours. Each request gets at most 2 attempts, and every attempt counts against quota.
- **Validators:** they are deferred until validation passes. A validation failure never leaves a series stuck behind a 304 (regression test on the fed_ddp path).
- **Simulations covered:** 500s then recovery, a timeout, a malformed payload, and quota exhaustion.

## 32. Service restart proof

Simulations cover:
- a restart one minute before a release, after a crash that left a lease held (the stale lease is reclaimed and the release is still caught);
- a restart during polling;
- a restart after acquisition but before publish (republished exactly once).

In practice the local service was restarted three times (the two rebuilds plus a code pickup) with no lost or duplicated releases.

## 33. Idempotency proof

- A duplicate worker (two schedulers, one lease) produces exactly one ingestion.
- Forced retries create 0 duplicate release rows.
- An identical re-sighting writes 0 rows.
- Running derive twice writes nothing the second time.
- Publishing identical content is skipped via an ETag memo.

## 34. Dedicated-service runtime

- **Command:** `python -m api.econ_main [--once] [--backfill SYMS|cohort|enabled] [--status] [--db PATH] [--no-feeds]`.
- **Boot:** validates the registry (refuses to start on errors), opens the store, recovers state and schedules work.
- **Status and health:** a stdlib HTTP server on `$PORT` answers `/health` and `/status`. `/api/health` answers Railway's health check.
- **Shutdown:** SIGTERM finishes the current job and releases leases.
- **Isolation:** it is independent of web, worker, bars-api and every other service. The `railway.json` branch is inert unless `ECON_SERVICE_ENABLED=1`, which is **not set anywhere**.

## 35. Service health / status output

A redacted sample is in `docs/economic-data/service-status-sample.json`. It reports:
- version and uptime
- registry counts
- states (42 CURRENT)
- the next 10 releases, with precision and source class
- last success per provider
- delayed series and validation failures
- provider health (last error redacted, consecutive failures, backoff)
- BLS quota used
- key configured flags (booleans only)
- calendar coverage

Footprint: about 45–56 MB RSS and about 0.17% of one core.

## 36. API-key architecture

- **Keys:** `BLS_API_KEY`, `BEA_API_KEY`, `CENSUS_API_KEY`, `EIA_API_KEY`. They are server-side environment variables on the econ service only, following UCT's `<PROVIDER>_API_KEY` convention.
- **Where they are read:** only by `econ/secrets.py`.
- **Never** in the browser, the web pod, logs, status (booleans only), archives or `request_key`s.
- **Missing key:** adapters fall back to the agency's keyless mode where one exists.
- **Setup:** register the free keys at bls.gov/developers, apps.bea.gov/api/signup, api.census.gov/data/key_signup.html and eia.gov/opendata, then set them on the econ service only when deployment is authorized. **None are configured today.**

## 37. Secret-redaction proof

- **What `secrets.redact()` scrubs:** every configured secret value, in raw, URL-encoded, JSON-escaped and repr forms, plus secret parameter names (registrationkey, UserID, api_key, key, token, Authorization).
- **Where it applies:** a logging record factory scrubs every record from the econ logger tree, including tracebacks.
- **Exceptions:** exhausted retries raise `SourceUnavailable` with the underlying error hidden.
- **Tests:** a leak test sends BEA, BLS, Census and EIA calls to a fake transport that echoes the request back in a 500 body, then calls `logger.exception` on the raw `?UserID=` URL. Exception messages, reprs and caplog contain no key in any form. A **mutation control** (redact replaced by a pass-through) makes the test fail. Archived bytes are asserted secret-free.

## 38. API contract

`api/routers/econ.py` (`API.md`):
- `GET /api/econ/catalog`
- `GET /api/econ/series/{USCPI|ECON:USCPI}?asof=&start=&end=`
- `GET /api/econ/status`, which is unauthenticated and returns dates and states only, with no values

**Gating:**
- Everything is 404 unless `ECON_ENABLED=1`.
- Catalog and series use `require_bars_access` → `meets_plan_gate`, **the single canonical entitlement authority** (paid, comped, trial, admin). The response is 401 when not signed in and 403 when not entitled.
- Responses carry strong ETags and `Cache-Control: private`.

**Payload:**
- `meta` is a whitelist of public fields. Licensing internals, adapter params and keys are never included.
- Currentness and next release are included.
- `columns ["t","v","ps","pe","pit"]`.
- `max_age_days`.

**Real entitlement check** through the real router: no header → 401; wrong bearer → 401; valid → 200.

## 39. econ source-resolution proof

- `parseSource('econ:USCPI')` → `{kind:'economic', symbol}`. Unknown or malformed input → null, never Close.
- It is distinct from `sym:`, `fund:`, breadth and Market Indicators. There are 21 grammar tests and 60+ source tests.
- `economicSeries.js` fetches only `/api/econ/*` and never `/api/bars`.

## 40. Proof econ bypasses stock bars / add-ons

`test_isolation.py` replaces every downstream function with a recorder, checks for zero calls, and uses negative controls. It covers:
- `/api/bars` and `/api/bars-history` (including the proxies), `serve_bars` and `serve_bars_history`, which return an explicit 404 ("economic series are served by /api/econ") before the provider fetch, delisted lookup, add-today, tail status or warm;
- `/api/bars/warm`, the watchlist-open warm, the worker prewarm ring and the seeder tier 2, which all skip `ECON:*`;
- the delisting cleanup, which exempts colon ids;
- universe builders and the crawler, which contain no econ ids;
- the CF edge (colon ids route to web; `/api/econ` is not intercepted);
- the econ modules themselves, which import nothing from bars, massive, the market calendar, tail or breadth (AST check).

## 41. Universal Data integration

- Economic series use the existing generic `dataSeries` instances, the binder, `gapRuns` (lineage widened), the format registry, Legend V2 and the pane system.
- `projectEconomic` uses the shared `projectAsOfIndices` with three econ-only options:
  - `strict`: no one-bar intraday look-ahead;
  - `ageFrom: 'available'`;
  - `periodMonotone`: a late point for an older period never ends a newer period's carry.
- Fundamentals behaviour is unchanged (tested).

## 42. Release-date alignment proof

On real data:
- **August CPI** first appears on the 2026-09-11 08:30 ET bar (daily, weekly and 5-minute charts). The prior bar reads July.
- **FHFA July** appears on the 2026-09-29 bar, and at 13:00Z on the 5-minute chart.
- **JOLTS August** appears at 14:00Z.
- 0 bars show a value before its release.
- **Negative control:** moving `t` 15 days earlier is caught as more than 100 leaking bars.

## 43. Observation-period preservation

- Every point carries `ps` and `pe`.
- The legend shows the observation period: "334.13 · Aug 2026", "Q2 2026", "wk 9/19".
- A period-aligned placement is supported by the data path (`placement:'period'`); no UI toggle yet.

## 44. Gap behavior

- Provider NA values (for example the October 2025 CPI, cancelled in the funding lapse) are stored as null, never 0. They draw as real gaps, 0 bridged.
- H.15 holiday "no data" rows are not observations and are dropped. Afterwards UST10Y2Y has 0 masked values and 0 false breaks.
- Staleness is measured from availability, with a per-frequency `max_age_days`. The FHFA overlay has 0 false gaps.
- Remaining breaks on overlays are real: the 2025 lapse (CPI 55 days, NFP 76 days, JOLTS 70 days).

## 45–50. Line / Step / Bar / Monthly / Weekly / Quarterly proofs

Screenshots and an audit are in `docs/economic-data/harness/real/*.png` and `audit.json`: 20 real-data captures, 0 errors, 0 lines drawn through gaps.

| Proof | Series |
|---|---|
| Line | USCPI, USCPIYOY, UST10Y2Y |
| Step | USFEDFUNDSU / USFEDFUNDSL with EFFR — 4.00 / 3.75 / 3.88 |
| Bar (histogram) | USRGDPQA, USNFPCHG (negative Oct-2025), USTRADEBAL (-$88.58B) |
| Monthly | CPI, FHFA, JOLTS |
| Weekly | USICSA (Saturday anchor), USCRUDEINV (Friday) |
| Quarterly | USRGDPQA — "1.5% · Q2 2026" |

## 51. Primary economic-chart harness proof

- **Approach:** a series-native timeline (`economicTimelineOf`). Rows keyed by the Eastern Time availability date carry no OHLC fields, so there is nothing to draw candles from.
- **Rendering:** the ordinary binder draws line, step or histogram, with full history, correct units and a legend readout, and no stock ticker underneath.
- **Scenarios:** primary monthly, step (three series sharing one timeline), weekly and quarterly, all on real data.
- **Phase 2 StockChart seams:** see §67.

## 52. Overlay / source harness proof

Econ panes over a synthetic SPY-like host on daily, weekly and 5-minute charts. The results — release alignment, honest gaps and period-monotone carry — are in `audit.json` (overlay-d/w/5, overlay-fhfa-d, overlay-jolts-5).

## 53. Origin / zoom / pan proof

`navTest()` passes in every scenario: fit, zoom to a 0.25 width ratio, pan, and Origin centring the first bar. This uses the StockChart `centerFirstBar` logic.

**Minor:** fit-all on UST10Y2Y (12.6k rows) is limited by the chart library's bar spacing.

## 54. Automated test results

- **Econ backend (`tests/econ`):** 810 passed (≈552 test functions, parametrized).
- **FRED caller suites and related** (voice, admin, options, memory_probe): 626 passed.
- **Full backend suite:** 0 unexplained regressions vs base (§55).
- **Frontend econ suites:** 84 + 11 + 3 new tests, plus the period-monotone set, all passing.
- **Full frontend `vitest run`:**
  - branch: 29,534 passed / 24 failed / 63 skipped;
  - base: 29,430 passed / 25 failed / 66 skipped;
  - all 24 branch failures are on base's failure list, so **0 new failures**. The formatter census regression was fixed properly, not re-baselined.
  - `memberPaneGate` fails on base too.
- **ESLint:** clean on changed files.

## 55. Negative-control / mutation results

**Backend full-suite regression (`pytest tests`, same venv, same machine):**

| run | passed | failed | errors | wall |
|---|---:|---:|---:|---|
| base `3b6cd17e8` (`C:\w\econbase`) | 32,035 | 275 | 28 | 1:30:53 |
| branch (before the 3 fixes below) | 32,987 | 165 | 0 | 1:27:06 |

Diff of failing sets:
- **6 new vs base, and all resolved:**
  - 3 were caused by the branch and are fixed:
    - `test_visibility_flag_ledger` ×2 — `ECON_PUBLISH_R2` is now declared in `docs/feature_flags.json` (internal exposure, dark).
    - `test_gate_shards` read-set — the vitest test now reads real-payload fixtures from `app/src/econHarness/fixtures/real/` instead of `docs/`.

    After the fixes those suites give 337 passed.
  - 4 were load-sensitive flakes. `test_massive_ws_stop`, `test_note_ask` ×2 and one `test_ticker_logos` case pass in isolation on the branch (42/42), and no econ code touches them.
- **304 "fixed" vs base are environmental.** The base worktree had no `app/node_modules` during its run, so its JS-lane parity tests errored. This is not an econ effect and is not claimed as one.
- **One environment trap is recorded.** A full `vitest run` leaves a stray, gitignored `app/dist/flow-facts.cjs`. That makes `api/main.py` try to mount a missing `dist/assets`, and every import of `api.main` then fails at collection. The first branch run hit this; deleting `app/dist` fixed it. It is pre-existing behaviour, not caused by econ.

**Conclusion: 0 unexplained regressions.**

Negative controls and mutations that fail as designed:

| Control | Result |
|---|---|
| Future release leaking backward | test fails |
| Revision overwriting the original | trigger aborts |
| HTTP 200 marked CURRENT | 13 tests fail |
| Wrong units (scale slip) | rejected |
| Wrong provider id / identity (Fed unit mismatch, Census CV) | refused |
| RED series enabled | registry error |
| YELLOW without approval | error |
| Econ symbol in the stock bars path | recorder sees calls with the guard removed |
| API key in logs | leak test fails with redaction removed |
| Gap bridged | test fails |
| UNCONFIRMED mapped to current | test fails |
| Derived leak (max→min combiner) | `DerivationLeak` |
| Lapse table removed | USNFP Sept-2025 placed early and USCPINSA claims U |
| Plain placement-order projection | Dec-2025 carry blanked |
| Old staleness rule | 86 blank FHFA weekdays |

## 56. Performance measurements

From `PERFORMANCE.md`:
- **Backfill:** about 102 s for 26 non-BLS series.
- **Incremental polls:** 0.06–7 s per adapter (EIA's origin was slow at about 40 s). BEA and Fed second polls return 304.
- **Registry:** load plus validation about 35–60 ms.
- **Store queries:** full history 0.5–43 ms; latest 0.04–1.1 ms; as-of latest 0.06–2.7 ms.
- **Payload build:** up to 52 ms.
- **Service:** 45–56 MB RSS, about 0.17% of one core.

## 57. Storage measurements

- `econ.db` is 18.2 MB (99,418 observations).
- Artifacts are 2.6 MB.
- The raw archive is 137 MB. About 125 MB of that is one-time history payloads; the retention rule keeps about 3.5 MB/day, projected at about 1.2–1.3 GB/yr, dominated by BEA flat files.

## 58. Request-volume measurements

- **Backfill:** 65 requests for 26 non-BLS series, plus 12 BLS windows.
- **Steady state:** release-windowed polling, roughly 10–20k requests/month for the cohort (Phase 0 estimate confirmed).
- **Scaling limit:** keyless BLS does not scale. A BLS key is required before 151 series.

## 59. Extrapolation

| Series | Database | Artifacts | Sequential backfill |
|---|---|---|---|
| 151 | ≈ 50 MB | ≈ 7 MB | ~10 min + BLS |
| 237 | ≈ 80 MB | ≈ 11 MB | ~16 min |
| 1,000 | ≈ 340 MB | ≈ 47 MB | ~65 min |

The database is about 1.5× the Phase 0 estimate because of two indexes plus per-day derived release rows. Both are cheap to shrink and not needed at 151.

## 60. Remaining 110-series expansion analysis

From `EXPANSION-151.md`. Two of the 110 (USCORECPINSA, USGDP) are already enabled, leaving **108**:

| What's needed | Series |
|---|---|
| Registry, verification and backfill only (no code) | **82** |
| New adapter code (`treasury_tic`, `fed_policy` for IORB, `regional_fed_file`, BEA ITA, MTS table 5) | **5** |
| New derivation code | **0** |
| Provider IDs to confirm | **12** |
| Permission | **0** |
| Other: retail basis (4), plus calendar-key gaps | **9** |

Adding the missing calendar keys, with no adapter code, would bring the registry-only count to **90 of 108**.

## 61. Files changed

The full list is `git diff --stat 3b6cd17e8..HEAD`. Summary:
- **New package:** `api/services/econ/**` (model, registry plus JSON, licensing, secrets, http, adapters/*, store, derive, validate, timeutil, backfill_timing, calendar plus calendars/*, currentness, ingest, scheduler, publish, serving, service).
- **New entrypoint and router:** `api/econ_main.py`, `api/routers/econ.py`.
- **Minimal guards:** `api/routers/bars.py`, `api/routers/watchlists.py`, `api/services/bars_prewarm.py`, `api/services/bars_seeder.py`.
- **FRED retirement:** `fred_economic.py`, `options_chain.py`, `voice_tool_impls.py`, `voice_agents.py`, `voice_prompts/compass.py`, `memory_probe.py`, `admin_api_health.py`, `.env.example`, the licensing register and the provider ledger.
- **Mounts and config:** `api/main.py` (mount), `docs/feature_flags.json`, `api/auth_surface_read_baseline.json`, `railway.json` (inert branch).
- **Frontend:** `app/src/components/chart/engine/{economicGrammar,economicSeries,economicSource}.js`, plus edits to `sourceRef`, `binder`, `gapRuns`, `fundamentalAsOf`, `fundamentalFormat`, `readout`.
- **Harness:** `app/econ-harness.html`, `app/src/econHarness/**`, `app/vite.econ-harness.config.mjs`.
- **Tests:** `tests/econ/**` (fixtures included).
- **Tools:** `tools/econ/**`.
- **Docs:** `docs/economic-data/**`.

## 62. Local commit SHAs (on `feat/economic-data-p1`, none pushed)

| SHA | Summary |
|---|---|
| d80f42753 | foundation — registry, licensing, store, derive, validate, http, FRED retired |
| d894456e0 | `econ:` source and series-native harness |
| 326d070c0 | 10 adapters, member API and serving, isolation |
| 13d4ae3be | calendar, currentness, ingest, scheduler, service |
| 2fff7ea75 | 151 expansion analysis |
| 86663d302 | integration on real data, live captures |
| 711b95c03 | frontend currentness and real-data harness |
| ca302435c | late-side backfill timing, archive retention, BLS retry cap |
| 8e023b0ef | ND holiday rows, max_age from availability, as-of currentness, shared formatter |
| 722d5249f | period-monotone as-of projection |
| (next) | acceptance report, `ECON_PUBLISH_R2` ledger entry, gate read-set fixture move |

## 63. Deferred items

- **Final member UI (Phase 2):** Symbol Search Economic tab, Add Indicator Economic tab, UCT Economic Charts prebuilt lists, provenance popover, StockChart primary-chart wiring, `useEconomicSources` hook.
- **Period-aligned display toggle:** the data path supports it; there is no UI.
- **Formula language `econ` leaf.**
- **YELLOW sources** after permission.
- **Remaining 108 launch series** (§60).
- **2027 PFEI import** (the BLS calendar expires 2026-12-31).
- **Archive to R2** with a lifecycle rule (at deployment).
- **Store-level backfill-run supersession** versus a rebuild procedure (owner review, §68).
- **G.17 rebase to 2022=100** on 2026-11-24: the USINDPRO `units.raw` edit must accompany it or the identity check refuses.
- **Minor:** derived float noise (display handles it); per-day derived release rows.

## 64. Market Indicators defects confirmed untouched

The four Phase 0 defects were not fixed and are recorded in the backlog (memory `market-indicators-defects-backlog`):
- NAAIM dated by survey date;
- a failed catalogue load renders candles;
- the comped gate split;
- the add-today / tail-status add-ons run on MI symbols.

Economics inherits none of them. It uses `require_bars_access`, never `/api/bars`, never candles, and dates everything by `available_at`.

## 65. Production systems confirmed untouched

- No Railway command was run, no push was made, and no production URL was written to.
- R2 publishing is off in every process.
- Breadth V2c2, Fundamentals V5, intraday prewarm/crawler, Alerts, web, worker, bars-api, flow-worker and chart-renderer were not touched.
- All local processes (econ service, BLS watcher, harness servers) ran on this machine only. The only network egress was read-only fetches from public agency endpoints.

## 66. Main Trading status

**Never touched or read during this work.** `/charts` was never opened and `/api/auth/preferences` was never called, so the accepted fingerprint `c683e423…0397` (2180 B) could not have been changed by this project. It was deliberately not re-measured, per the instruction not to open it for a checkbox.

## 67. Exact Phase 2 implementation seams

**Symbol Search** (All | Stocks | ETFs | Indices | Breadth | Economic):
- `symbolSearchModel.js` `CHIPS` / `TYPE_LABEL` / `rowIdentity` (~445/476/491).
- `SymbolSearch.jsx` chip branch (~127-175) and glyph (not `CompanyLogo`, ~330).
- `ticker_search.py` `type=economic` (~131,188), fed from `registry.search_view()`.
- `MobileSymbolSheet.jsx` (~77-85,174).

**Add Indicator** (… | Indexes | Economic):
- `discoveryCatalog.js` `LIBRARY_TABS` (~1155), `tabOf`/`glyphFamilyOf` (~1253/1346).
- `economicResults(catalog)`, cloned from `fundamentalResults` (~1213), feeding `browsed` / `resultByKey` in `ChartSettingsIndicators.jsx` (~860-904).
- Creation is unchanged (`createFromResult → createDirectSeries`, source `econ:<SYM>`).
- Accept through ChartSettingsIndicators with both browse and search.

**Primary economic chart:**
- StockChart `barsOverride` (~SC:2424/6797) fed with `economicTimelineOf` rows.
- Disable stock-only fetches, IndexedDB, warm chain, websocket/realtime, volume, future whitespace and `startNavLoad` for econ.
- The `cs` memo returns a scalar capability for the econ family (`canonicalFamily`).
- Unit `priceFormat`; the legend bar-info strip shows value, change and period.
- Lock the timeframe to native frequency (`ChartPane.jsx` ~176/403/837).
- A registry-backed non-instrument branch in `ChartPane`, shared with MI.
- Details are in the frontend "As built" section of `PHASE1-DESIGN.md`.

**Overlays:** `useEconomicSources` (a twin of `useFundamentalSources`, next to ~SC:6432), passing `economics:` into `binder.sync` (~SC:12387).

**Prebuilt "UCT Economic Charts":** one generator in `watchlist_prebuilt.py`. Colon ids are already delist-safe and watchlist warm already skips `ECON:*`. The lists come from the Phase 0 report §30.

**Provenance display:** `/api/econ/catalog` `meta.source` plus `attributions`, rendered with `app/src/components/provenance/*` in the Track-B legend popover.

**Symbol-shape fixes for namespaced ids:** formula `TICKER_SHAPE` (`ast/parse.js:226`), phone go-to, CommandPalette, watchlist paste, `signature.py`.

## 68. Owner decisions (new in Phase 1 only)

1. **USRETAIL basis.** Which Census product defines "retail sales"? A keyed EITS check against the advance release will settle it; until then it stays failed closed. The same decision blocks 4 launch series.
2. **Correcting backfill timing after launch.** Either rebuild the backfill from the raw archive with live vintages carried verbatim (the procedure used twice here), or build a store-level backfill-run supersession. No production data exists yet, so nothing is needed before launch; decide before the first production backfill.
3. **USMTSDEF sign convention.** The provider's authoritative "deficit positive" was kept and documented rather than flipped. Confirm that's the member-facing convention you want.
4. **Fed DDP retirement.** The Fed names FRED as the successor, which licensing forbids. Release-page XML is the chosen path and is live and verified. Nothing to decide now; flagged in case the Fed also retires release-page XML.
5. **Deployment and key setup** remain yours: the four free keys, the econ Railway service, `ECON_ENABLED`, R2 publishing. **None has been done.**

## 69. Final verdict

The 41-series foundation is complete and validated. The one fail-closed series (USRETAIL) is isolated by design and does not block the architecture.

The deployment and integration plan below is prepared but **not executed**:
1. Rebase or merge `feat/economic-data-p1` onto current master (`14cb488e5`), resolving the line-keyed census tests.
2. Register the four free keys.
3. Create a small Railway service with `ECON_SERVICE_ENABLED=1`, a `/data` volume, and the econ keys only.
4. Run the backfill on that service.
5. Enable `ECON_PUBLISH_R2`.
6. Verify `/api/econ/status` read-only.
7. Only then set `ECON_ENABLED=1` on web, dark to members until the Phase 2 UI ships.

Every step waits for explicit owner authorization.

# **ECONOMIC DATA PHASE 1 ACCEPTED — READY FOR OWNER REVIEW, NOT DEPLOYED**
