# Economic Data Phase 1: revalidation on the integration branch

- **Scope:** accepted Phase 1 (`93ebe4ee7`) merged onto current master (`4e891b22b`).
- **Branch:** `integrate/economic-data` at HEAD `d4f37d61a`, worktree `C:\w\econint`.
- **Run:** 2026-09-29, LOCAL ONLY. No Railway, no production URL, no /charts, no Main Trading. R2 and every provider credential were blanked.

## 0. Database under test

- **Copy:** `C:\w\econ1-data\econ-accepted-2026-09-29.db` was copied to `C:\w\econint-data\econ.db`, a new directory.
- **Hash:** sha256 is `cf4840103558d273744d148901f28251c9ea453bae16002bd656b4cee2356852` before and after the run. It is identical to the preserved DB, and the copy was never written.
- **Untouched:** the live `:8787` service and its DB were not used or changed. `/health` stayed ok throughout.
- **Code path:** every check imports `C:\w\econint\api\services\econ\*` (asserted in `reval.py`). The serving checks use `serving.series()` with `ECON_SERVING_SOURCE=db` and `ECON_DB_PATH` pointed at the copy, so they go through the same `publish.build_series_payload` the publisher uses.
- **Evidence:** `reval-evidence.json` (raw), `tools/reval.py`, and `harness/audit.json`.

## 1. Real-data representative checks against the accepted census

The census CSV (`C:\w\econ1\docs\economic-data\COHORT-CENSUS.csv`, byte-identical to this branch's copy) was generated at **12:36 ET**. The accepted DB was preserved at **16:20 ET**. Between those times the running local service captured **5 live V rows**:

| Series | Period | Release | Available at |
|---|---|---|---|
| USRRP | 09-29 | `nyfed:rrp` | 13:15 ET |
| USTGA | 09-28 | `fiscal:dts` | 16:00 ET |
| UST10Y / UST2Y | 09-28 | `fed:h15` | 16:20 ET |
| UST10Y2Y | 09-28 | derived | 16:20 ET |

These are the only rows with `available_at` after 12:36 ET.

| Series | Count (census = store = serving) | Oldest | Newest | Latest | Verdict |
|---|---|---|---|---|---|
| USCPINSA | 1,364 | 1913-01 | 2026-08 | 334.98 | MATCH |
| USCPI | 956 | 1947-01 | 2026-08 | 334.131 | MATCH |
| USRGDPQA | 317 | 1947-04 | 2026-04 | 1.5 | MATCH |
| USPCEPI | 811 | 1959-01 | 2026-07 | 131.659 | MATCH |
| USDEBT | 8,401 | 1993-04-01 | 2026-09-25 | 40,097,178,119,750.91 | MATCH |
| USTGA | 5,271 → **5,272** | 2005-10-03 | 09-25 → **09-28** | 945,290 → **959,572** | MISMATCH (explained: +1 live row) |
| USMTSDEF | 155 | 2013-10 | 2026-08 | 166.80B (deficit is positive; Apr-2026 is −215.0B and Sep-2025 is −197.9B, both surpluses) | MATCH |
| UST10Y | 16,169 → **16,170** | 1962-01-02 | 09-25 → **09-28** | 5.17 → **5.24** | MISMATCH (explained: +1 live row) |
| USM2 | 812 | 1959-01 | 2026-08 | 23,342.8 | MATCH |
| USFEDBAL | 1,241 | 2002-12-12 | 2026-09-17 | 6,747,704 | MATCH |
| USEFFR | 2,658 | 2016-03-01 | 2026-09-28 | 3.88 | MATCH |
| USFEDFUNDSU / USFEDFUNDSL | 4,468 each | 2008-12-16 | 2026-09-28 | 4.00 / 3.75 | MATCH |
| USSOFR | 2,121 | 2018-04-02 | 2026-09-28 | 3.90 | MATCH |
| USRRP | 3,250 → **3,251** | 2013-09-23 | 09-28 → **09-29** | 0.851B → **11.446B** | MISMATCH (explained: +1 live row) |
| USFHFAHPI | 427 | 1991-01 | 2026-07 | 443.52 | MATCH |
| USCRUDEINV | 2,295 | 1982-08-14 | 2026-09-12 | 426,398 | MATCH |
| USGASPRICE | 1,885 (6 NA) | 1990-08-14 | 2026-09-22 | 4.465 | MATCH |
| USICSA | 3,116 | 1967-01-01 | 2026-09-13 | 197,000 | MATCH |
| USUNRATE | 944 | 1948-01 | 2026-08 | 4.1 | MATCH |
| USNFP | 1,052 | 1939-01 | 2026-08 | 159,075 | MATCH |
| USJOLTSO | 309 | 2000-12 | 2026-08 | 7,079 | MATCH |
| USCPIYOY | 1,352 | 1914-01 | 2026-08 | 3.3965 | MATCH |
| USPCEPIYOY | 799 | 1960-01 | 2026-07 | 3.7012 | MATCH |
| UST10Y2Y | 12,577 → **12,578** | 1976-06-01 | 09-25 → **09-28** | 0.36 → **0.32** | MISMATCH (explained: +1 live row) |
| USNFPCHG | 1,051 | 1939-02 | 2026-08 | 162 | MATCH |
| USDEBTGDP | 133 | 1993-04 | 2026-04 | 121.475 | MATCH |

**At the census instant** (`asof = 2026-09-29 16:36:02Z`), through both the store and the serving path:
- **42 of 42** populated cohort series match count, oldest, newest and latest exactly. This includes UST2Y and all four explained mismatches.
- The 43rd series, USRETAIL, has 0 rows and serves 404, as expected.
- The newest census-period rows of the 5 changed series are unchanged, for example UST10Y 09-25 = 5.17 (U).

**Verdict: no data regression.** The 4 mismatches in this table (5 series including UST2Y) are the accepted DB being newer than the CSV, not a code difference.

## 2. Revision and as-of through the integration serving path

`scheduled_at` in the DB is `release.scheduled_at` for the live releases:
- FHFA: `fhfa:hpi_monthly:2026-07`, 1790686800 = **2026-09-29 13:00:00Z** (09:00 ET).
- JOLTS: `bls:jolts:2026-08`, 1790690400 = **14:00:00Z** (10:00 ET).

| Series / period | `versions()` | `asof` = T−1 s | `asof` = T | Latest view |
|---|---|---|---|---|
| FHFA 2026-06 | 442.53 L `rule` @08-31 23:59 ET; 442.34 V `scheduled` @09-29 09:00 ET | **442.53** | **442.34** | 442.34, placed at the first availability, 08-31 23:59 ET |
| JOLTS 2026-07 | 7,271 L `scheduled:history` @09-01 10:00 ET; 7,335 V `scheduled` @09-29 10:00 ET | **7,271** | **7,335** | 7,335, placed at 09-01 10:00 ET |

- As-of payloads return `view: asof` and `currentness: {state: null, historical: true}`.
- The harness renders the same values (`fhfa-asof-*`, `jolts-asof-*`), with legend chips "USFHFAHPI 442.53 · Jun 2026" → "442.34 · Jun 2026" and "USJOLTSO 7.27M · Jul 2026" → "7.33M · Jul 2026".

## 3. Leak check

- **Schedule leaks:** `observation.available_at < release.scheduled_at` returns **0** of 99,423 rows. This is the same query as `rebuild_local_db.py`.
- **Derived leaks:** `derive.audit_derived` finds **0 reasons** for all 7 derived series: USCPIYOY 1,352, USCPIMOM 955, USCORECPIYOY 824, USNFPCHG 1,051, USPCEPIYOY 799, UST10Y2Y 12,578 and USDEBTGDP 133 rows.

## 4. Shutdown and holiday hardening

| Assertion | Result |
|---|---|
| USCPINSA Sep-2025 | 324.8, **PIT L**, 2025-10-24 08:30 ET `scheduled:history`. This is the BLS lapse-era actual release, which is the accepted contract (`test_backfill_timing` pins it at ≥ 10-24 08:30, and it is the snap that step 5 allows). **Note:** the 2026-01-30 catch-up floor governs only unsnapped rows. It correctly applies to Oct-2025 (NA, `rule:lapse`, L, 01-30 23:59 ET). PASS |
| USNFP Sep-2025 not before 2025-11-20 | 2025-11-20 08:30 ET, L. PASS |
| No H.15 ND holiday rows | UST10Y has 0 null rows, as do UST2Y and UST10Y2Y. PASS |
| EIA gasoline holiday weeks placed Wednesday or later | 260 holiday or closure weeks, **0** before Wednesday (for example 2026-09-07 → 09-09 23:59). PASS |
| Lapse rows | 227 `rule:lapse` rows, all L. PASS |
| `funding_lapses.json` | Present and loaded by `backfill_timing.lapses()`: 6 lapses (1995-11, 1995-12, 2013-10, 2018-12, 2025-10, 2026-01). PASS |

## 5. USRETAIL fails closed

- **USRETAIL:** `status: unverified`, `source.verified: false`. The note reads "ruling 2026-09-29: status='unverified' -- FAIL CLOSED: econ_export … differ ~4.8% …".
- **Dependent series, none enabled:**
  - USRETAILXA: `disabled`
  - USRETAILMOM: `disabled`
  - USRETAILCTRL: `unverified`
  - USRETCTRLMOM: `unverified`
  - No series containing "RET" is enabled.
- **Registry:** `validate_registry()` returns `[]`. There are 42 enabled series.
- **Serving:** `serving.series('USRETAIL')` returns `404 not_found`. The router over HTTP returns 404 with a push-secret bearer, and 401 without one. The DB holds 0 USRETAIL rows.

## 6. Security

Tests (`.venv` pytest, targeted): **124 passed, 0 failed**.

| Test file | Passed |
|---|---|
| `test_secrets` | 10 |
| `test_http` | 32 |
| `test_fred_retired` | 10 |
| `test_licensing` | 27 |
| `test_isolation` | 39 |
| `test_backup_and_ownership` | 6 |

A grep of `git diff 4e891b22b..HEAD` (99,284 added lines) for key, secret, token, `UserID`, `registrationkey`, AWS, `sk-`, `ghp_`, JWT and PEM patterns found **no real secret**. The only matches are:
- test fakes, such as `blsTESTkey1234567890`, `TESTKEY0123456789abcdef`, `beaSECRET12345`, `unknownvalue1` and `s3cret-value`;
- env-var *names*;
- the harness secret read from `process.env`;
- public Fed DDP package ids (`bf1736…`, `ccfdc0…`, `798e27…`, `809009…`);
- a public page's Adobe tag URL in a calendar fixture.

`.env.example` only retires `FRED_API_KEY`.

## 7. Chart harness, integration code, `?src=api`, against the copy

**Setup:**
- **Server:** router-only, on 127.0.0.1:8795. `tools/econ_db_server.py` is `econ_local_server.py` with `ECON_SERVING_SOURCE=db` over the copy, and it has the same push-secret door and the same credential blanking.
- **Vite:** 127.0.0.1:5191.
- **Driver:** `captureScenarios.mjs`, copied only to redirect the output and add a series-type probe (`tools/patch.py`).
- **Output:** 20 screenshots and `harness/audit.json`.

**Results:**
- **20 of 20 scenarios:** 0 errors, **0 drawn through gaps**, `navTest` ok (zoom 0.25, pan, Origin centres the first bar).
- **No candles:**
  - Econ series types are only Line (lineType 0), Line with steps (FEDFUNDS U/L, lineType 1) or Histogram (GDP, NFPCHG, TRADEBAL).
  - Primary charts have 0 candle series and no OHLC fields on the rows.
  - The only Candlestick is the SYNTHETIC host on overlays.
- **Release placement:**
  - Aug-2026 CPI first appears on the 2026-09-11 bar on the daily chart (the prior bar reads "332.813 · Jul 2026"), on the week of 09-07 on the weekly chart, and on the 5-minute chart. 0 bars show it before release.
  - FHFA July is on 2026-09-29 (daily) and 13:00:00Z (5-minute).
  - JOLTS August is at 14:00:00Z.
  - All probes are ok.
- **Gaps:**
  - The Oct-2025 CPI NA sits at 01-30 23:59 ET.
  - On the primary charts (`cpi`, `cpiyoy`) it is a real gap: 0 valued bars, 0 drawn.
  - The overlay audit reports `drawnPoints 9` (daily) and `1` (weekly), where the accepted audit reported 0. **This is not a regression.**
    - The drawn value on those bars is **Dec-2025 326.031**. That is the period-monotone carry required by `722d5249f`: a late NA for an older period never ends a newer period's carry.
    - The accepted `harness/real/audit.json` was committed at 12:37 (`8e023b0ef`), before that fix (12:42). The fix also accounts for the change from 3 to 2 render runs.
    - Proven A/B: the **accepted** frontend (`C:\w\econ1\app`, vite on :5192) against the same server draws the identical points (`tools/probe.mjs`).
    - ⚠ The harness audit's `columnFor` still calls `projectAsOfIndices` without `periodMonotone`, so its `nullPeriods.drawnPoints` misreports on overlays. This is a harness-instrument issue that predates the merge.
- **Legend:** econ chips read `USCPI 334.131 · Aug 2026`, `USRGDPQA 1.5% · Q2 2026`, `USICSA 197,000 · wk 9/19` and `USFEDFUNDSU 4.00% · Sep 28, 2026`.
  - The value is 3 decimals (`num3`), exactly as in the accepted audit. The task's "334.13" differs only in rounding.
  - **No frame suffix appears on any econ chip.** Master's `calcTimeframeCapability` refuses a calculation frame for `economic` sources ("Economic data has its own release schedule."), so `frame` is never stamped and `readout.frameSuffix` stays empty.
  - The legend matches the axis in every scenario.
- **Other diffs versus the accepted audit:** only UST10Y2Y's +1 live row (09-28 0.32).

## Verdict

- No data, as-of, leak, hardening, USRETAIL or security regression.
- The chart harness passes on the integration code.
- Flags:
  - The census CSV predates 5 live rows; this is explained, not a defect.
  - The stale accepted overlay audit and the harness `columnFor` projection omit `periodMonotone`. This is instrument-only.
