# Economic Data Phase 1 — performance (real local backfill + running service)

Measured 2026-09-28/29 on the dev laptop (Windows 11, Python 3.12, SQLite WAL), against the real cohort store
`C:\w\econ1-data\econ.db` built by `python -m api.econ_main --backfill` (keyless, sequential, no R2). Tools:
`C:\w\econ1-data\tools\perf_store.py`, `perf_latest.py` (read-only / copy-of-DB), raw output in
`C:\w\econ1-data\perf_*.json`.

## 1. Backfill (history mode, one `run_fetch` per adapter)

| adapter | series | HTTP requests | wall (s) | rows written | notes |
|---|---:|---:|---:|---:|---|
| nyfed | 5 | 42 | 22.6 | 16,961 | API pages by date range (EFFR from 2016, target range from 2008, SOFR 2018, RRP 2013) |
| fed_ddp | 5 | 4 | 10.7 | 33,363 (+13,129 derived UST10Y2Y) | 4 release-page zips (H.15 4.3 MB, H.4.1 9 MB, H.6 1.4 MB, G.17 8.6 MB), streamed |
| bea | 5 | 2 | 15.0 | 2,575 (+799 USPCEPIYOY) | NipaDataQ/M.txt, ~35 MB each |
| census | 3 | 4 | 1.2 | 1,618 | econ_export CSV (+ M3ADV advance) |
| dol | 1 | 3 | 2.7 | 3,116 | r539cy XML + press PDF (1 redirect) |
| eia | 2 | 4 | 42.8 | 4,179 | 2 leaf pages + 2 one-byte `Range` probes; **eia.gov answered 8–18 s per request that night** (curl-confirmed) |
| fhfa | 1 | 1 | 2.1 | 426 | hpi_master.csv 17 MB |
| fiscaldata | 3 | 4 | 4.4 | 13,827 (+133 USDEBTGDP) | |
| nyfed_esms | 1 | 1 | 0.6 | 303 | |
| bls (keyless v1) | 9 | 1 (+ refused) | — | 965 (2017–2026 window, by the service) | see §1a |
| **total non-BLS** | 26 | **65** | **~102** | 76,368 + 14,061 derived | each adapter run also paid ~0.3 s of process boot |

**1a. BLS keyless is quota-bound, not time-bound.** A full 1913–2026 history is 12 v1 queries (10 years each, all 9
series batched). On 2026-09-29 the v1 API answered `REQUEST_NOT_PROCESSED … daily threshold` at 00:11 ET and again at
03:11 ET, each time on the 4th query (3 windows succeeded, then refused — the whole call is discarded), so its reset is
not ET midnight and its accounting is not "25/day by ET date". Fixes in this pass: quota refusals block the provider
for 3 h instead of retrying at the 15-min source backoff; the first fetch of an uninitialized BLS series is ONE recent
window (1 query: 2017–2026, 965 rows, succeeded 09:11 ET); older windows are sent one query at a time by an operator
backfill that takes the scheduler's lease. At release time (JOLTS 10:00 ET) api.bls.gov answered **503** for ~3 min;
the HTTP client's 5 attempts per call were all counted against the local quota (12 attempts for one successful poll).
**Fixed 2026-09-29:** `HttpClient` now makes at most **2 attempts per BLS request** (`DEFAULT_HOST_MAX_ATTEMPTS`), every
attempt is still counted and charged, and the next try comes from the poll schedule + provider backoff
(`test_scheduler.py::test_bls_503_storm_costs_two_attempts_per_poll_and_every_attempt_is_charged`). The same 503 storm
now costs ≤ 2 quota units per poll instead of ≤ 5.

## 2. Incremental (latest-mode) fetch per adapter — one poll, then an immediate second poll

| adapter | 1st poll: requests / wall (s) | 2nd poll: requests / wall (s) | 2nd-poll result |
|---|---|---|---|
| bea | 2 / 4.83 | 2 / 0.29 | **304 not_modified** (ETag/Last-Modified) |
| fed_ddp | 4 / 7.19 | 4 / 0.80 | **304 not_modified** |
| census | 4 / 0.93 | 4 / 0.94 | unchanged (no validators) |
| dol | 3 / 1.64 | 3 / 1.27 | unchanged |
| eia | 4 / 46.6 | 4 / 41.2 | unchanged (slow origin, see above) |
| fhfa | 1 / 1.88 | 1 / 1.32 | unchanged (17 MB every poll; no validators) |
| fiscaldata | 3 / 1.49 | 3 / 0.81 | unchanged |
| nyfed | 3 / 1.81 | 3 / 0.61 | unchanged |
| nyfed_esms | 1 / 0.35 | 1 / 0.06 | unchanged |
| bls (live, real JOLTS release) | 1 query / ~1 s when 200 | — | 503 ×10 then 200 at 10:03 ET |

Live service polls observed (2026-09-29, `logs/service.log`): SOFR probe 07:58 + poll 08:00 (1 request each, row at
08:00:00); EFFR 1 request per poll; FHFA probe 08:58, 09:00:02 (not yet), 09:00:22 (24 rows) — 20 s burst cadence.

## 3. Service footprint (`python -m api.econ_main`, idle between releases)

| metric | value |
|---|---|
| RSS | 44 MB idle after boot; 56 MB after 7 h incl. FHFA (17 MB CSV) / EIA / BLS parses |
| CPU | 2 s in the first 21 min (boot included); 43 s over 6.9 h including all live fetches ≈ **0.17 % of one core** |
| ticks | ~1 per minute (419 in 6.9 h); `/status` is a snapshot, the handler never touches the DB |
| threads | 3 (loop, HTTP server, main) |

## 4. Storage

| item | size |
|---|---|
| `econ.db` (42 series, 91,863 vintage rows, 14,040 releases) | **16.2 MB** (≈ 176 B per observation incl. both indexes + release rows) |
| rows by table | observation 91,863 · release 14,040 · calendar_event 502 · acquisition 54 · series_state/series_ops 42 · calendar_coverage 32 |
| artifacts (`econ/v1/series` + `vintages` + catalog + status, 33 series) | 2.36 MB on disk (series 1.15 MB gz + vintages 1.16 MB gz; catalog 40 KB; status 9.6 KB) |
| raw archive (`ECON_ARCHIVE=local`, content-addressed) | **142 MB** after the backfill + one day of polls: 124.7 MB = one-time history payloads (21 files), 17.5 MB = the live day. It is NOT a daily rate |

`release` rows: 13,129 of 14,040 are derived UST10Y2Y releases — derive.py writes one release per distinct input
`available_at`, i.e. one per trading day for a daily derived series.

## 5. Store query latency (real DB, median of 20, ms)

| series (periods) | history full | 5-y range | latest | as-of full (T−1y) | as-of latest | since 30 d | versions | bounds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| UST10Y (16,889 D) | 42.7 | 5.4 | 1.10 | 48.5 | 2.74 | 0.04 | 0.006 | 3.96 |
| USDEBT (8,401 D) | 22.6 | 4.3 | 0.56 | 23.0 | 1.38 | 0.04 | 0.006 | 1.93 |
| USICSA (3,116 W) | 8.3 | 0.97 | 0.21 | 8.5 | 0.53 | 0.01 | 0.006 | 0.71 |
| USPCEPI (811 M) | 2.1 | 0.22 | 0.07 | 2.1 | 0.15 | 0.006 | 0.006 | 0.17 |
| USRGDPQA (317 Q) | 0.79 | 0.08 | 0.04 | 0.82 | 0.07 | 0.003 | 0.006 | 0.07 |
| USCPI (116 M, 2017+) | 0.48 | 0.27 | 0.04 | 0.45 | 0.06 | 0.014 | 0.013 | 0.04 |

Registry: load 22–28 ms, `validate_registry()` 9–34 ms (237 entries, 646 KB JSON).

## 6. Publish payload build (per series, in-process)

| series | points | build (ms) | series raw / gz | vintages build (ms) | vintages raw / gz |
|---|---:|---:|---|---:|---|
| UST10Y | 16,889 | 52 | 802 KB / 180 KB | 37 | 834 KB / 182 KB |
| UST10Y2Y | 13,129 | 41 | 760 KB / 153 KB | 28 | 827 KB / 182 KB |
| USDEBT | 8,401 | 25 | 507 KB / 159 KB | 19 | 556 KB / 159 KB |
| USICSA | 3,116 | 10 | 161 KB / 39 KB | 6 | 179 KB / 39 KB |
| USPCEPI | 811 | 2.7 | 41 KB / 12 KB | 1.7 | 45 KB / 11 KB |
| USRGDPQA | 317 | 1.1 | 16 KB / 4.5 KB | 0.6 | 17 KB / 3.9 KB |

All 42 enabled series: series artifacts 1.15 MB gz, vintages 1.16 MB gz, catalog build 1.5 ms. Matches the API.md
estimate (5–6 MB gz for the whole set was a random-value worst case; real data compresses ~2.5× better).

## 7. Extrapolation to 151 / 237 / 1,000 series

Assumptions: frequency mix of the full 237-row registry (M 67 %, D 14 %, W 11 %, Q 8 %) applied to every target;
rows per series from this cohort (D ≈ 8,300 incl. derived, W ≈ 2,100, M ≈ 700, Q ≈ 250); 176 B per row (measured,
indexes + releases included); one year of live vintages adds ≈ 3 % (monthly revisions of the last 1–3 periods, weekly
claims revisions, daily series ~0). Archive growth is driven by a handful of large files (H.15 zip 4.3 MB per daily
change, H.4.1 9 MB weekly, BEA 2×35 MB per GDP/PIO release, FHFA 17 MB monthly).

| target | est. rows | est. `econ.db` | Phase 0 estimate | artifacts (gz, series+vintages) | backfill wall (sequential) |
|---|---:|---:|---|---:|---|
| 42 (measured) | 91.9 k | 16.2 MB | — | 2.3 MB | ~102 s + BLS quota days |
| 151 | ≈ 290 k | **≈ 50 MB** | ~30 MB | ≈ 7 MB | ~10 min + BLS (keyed: minutes) |
| 237 | ≈ 450 k | **≈ 80 MB** | — | ≈ 11 MB | ~16 min |
| 1,000 | ≈ 1.9 M | **≈ 340 MB** | 150–250 MB | ≈ 47 MB | ~65 min (≈ 4 s per series, sequential, measured mix) |

- The DB is ~1.5× the Phase 0 estimate because every observation row carries two secondary indexes and a full
  provenance tuple, and daily derived series create one `release` row per day. Both are cheap to shrink if it ever
  matters (collapse derived releases per run; drop `observation(series_id, available_at)` if `since()` moves to the
  release table) — not needed at 151 (≈ 50 MB).
- **Raw archive (re-measured 2026-09-29).** Retention now keeps a live payload only when the poll WROTE ≥ 1 row or
  FAILED validation. History/backfill/reconcile pulls are always kept, and identical bytes are stored once
  (content-addressed `<sha256>.bin`, verified by `tools/econ/prune_archive.py --verify`: 27/27 files hash to their
  names).

  **Measured on the live day** (09-29, 11 live result payloads):

  | rule | kept |
  |---|---|
  | old (every distinct payload) | 34.7 MB |
  | new | **17.5 MB** |

  The difference is FHFA's 17 MB pre-release poll, which differed from the release file and wrote nothing.

  **Projection at the cohort's cadence, new rule:**

  | payload | calculation | per year |
  |---|---|---|
  | BEA flat files (dominant) | ~35 MB per GDP/PIO release day × ~24 | ≈ 0.85 GB |
  | FHFA CSV | 17 MB × 12 | ≈ 0.2 GB |
  | DOL press PDFs | 0.7 MB × 52 | ≈ 36 MB |
  | EIA pages | 2 × 0.2 MB × 52 | ≈ 21 MB |
  | fed_ddp latest (`lastobs`) | KB per poll; the G.17 full-file fallback 8.6 MB × 12 ≈ 0.1 GB | ≈ 0.1 GB |
  | NY Fed / fiscaldata / Census / BLS | KB-sized | small |
  | **total** | | **≈ 1.2–1.3 GB/yr (≈ 3.5 MB/day)** |

  The old rule adds every changed-but-unwritten payload on top of this. The earlier "3–4 GB/yr, H.15 ≈ 1.1 GB" line
  assumed a full H.15 zip per day, but latest-mode polls use `lastobs`.

  `tools/econ/prune_archive.py` (dry run by default) prunes an existing archive to the same rule. On the current
  archive it keeps 27 files (15 that wrote rows, 12 siblings of a call that wrote rows) and would prune 2 NY Fed
  polls (< 0.1 MB). Before production: archive to R2 with a lifecycle rule; BEA's full flat files are the one
  payload worth a size-based policy.
- Query latency is linear in periods returned; the worst full-history read (16.9 k daily points) is 43 ms, and the
  member path reads the prebuilt artifact, not the DB.
- BLS keyless cannot scale: 1,000 series is ~40 v1 queries per history window × 12 windows. A BLS key (v2, 500/day,
  50 series × 20 years per query) is required well before 151.
