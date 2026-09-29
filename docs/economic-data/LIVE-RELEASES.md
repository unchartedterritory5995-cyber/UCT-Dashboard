# Economic Data Phase 1 — live release capture (local service, real agencies)

A local instance of the dedicated service (`python -m api.econ_main`) runs against the real backfilled
`C:\w\econ1-data\econ.db` (keyless, `ECON_PUBLISH_R2=0`, `ECON_ARCHIVE=local`, artifacts in
`C:\w\econ1-data\artifacts`, logs in `C:\w\econ1-data\logs\service.log`, status HTTP on `:8787`). It was left
RUNNING so it captures the releases below. Nothing here touches production (LOCAL ONLY, owner instruction 2026-09-29).

**Process**: started 2026-09-29 03:13 ET by `C:\w\econ1-data\start_service.ps1`; venv launcher PID **37628**, worker
PID **69928** (`C:\w\econ1-data\service.pid`). The earlier instance (04:14Z–07:13Z, worker 38684) was stopped to load
the quota fixes; its log is `logs/service-run1.log`.

## Rebuild 2026-09-29 (backfill timing corrected; see BACKFILL-TIMING.md)

Between 11:30 and 11:33 ET (15:30–15:33Z) the local DB was rebuilt under the corrected backfill placement. Nothing was re-fetched from any agency.

**Procedure**
1. Four BLS history windows (2007-16, 1997-06, 1987-96, 1977-86) completed first.
2. Stopped the BLS watcher (PIDs 24664/79436) and then the service (69928/37628). Both were checked as ours by command line, and the `lease` table was empty.
3. `PRAGMA wal_checkpoint(TRUNCATE)` and `integrity_check` = ok.
4. Ran `tools/econ/rebuild_local_db.py`, then swapped the files:
   - old → `C:\w\econ1-data\econ-pre-rebuild-2026-09-29.db` (renamed, kept);
   - rebuilt → `econ.db`.
5. Republished all 42 series artifacts locally (`publish_all`, `r2=False`).
6. Restarted the service with `start_service.ps1` (same command line) and the watcher.

**Carried and recomputed**
- Carried verbatim: acquisition (62), calendar_event (502), calendar_coverage, series_ops, provider_ops, provider_quota, series_state, and all 5 live releases with their **31 live rows**.
- Re-placed: **80,556 backfill rows**.
  - 38,344 re-timed: 33,234 later, and 5,110 earlier (every earlier one by an authoritative snap).
  - 7,574 PIT U→L.
  - 227 on a funding-lapse floor.
- Recomputed fresh: 16,419 derived rows.

**Verification** (report `C:\w\econ1-data\rebuild-report-2026-09-29.json`):
- counts per series equal the old DB for backfill + live;
- the live rows are byte-identical;
- **0** rows are available before their release's scheduled time;
- `audit_derived` is clean;
- latest (value, flag) is identical for every series, derived included.

As-of probes:

| series | period | as of | value |
|---|---|---|---:|
| FHFA | June | 08:59:59 ET | 442.53 |
| FHFA | June | 09:00 ET | 442.34 |
| JOLTS | July | 09:59:59 ET | 7,271 |
| JOLTS | July | 10:00 ET | 7,335 |

**New processes** (`service.pid`, `bls_watcher.pid`):
- service: venv launcher **51896**, worker **4056**; `/status` shows 42 CURRENT.
- watcher: launcher **25984**, worker **55432**. It resumed from its log, skipped the 4 done windows, and wrote 1967-1976 at 15:31Z under the new rules. Windows 1913–1966 are pending the BLS quota.

## Captured so far (2026-09-29, times ET; raw evidence `C:\w\econ1-data\evidence-*.json`)

Leak invariant after all captures: `observation.available_at < release.scheduled_at` → **0 rows**.

### 1. NY Fed SOFR for 09-28 — new daily period, placed at the rule time
- 07:58:00 probe (T−2 min): 1 request, nothing new. 08:00:00 poll: 1 request, **1 row**.
- `USSOFR 2026-09-28 = 3.90`, `available_at 08:00:00`, method `scheduled`, pit **V**, release `nyfed:sofr:2026-09-28`
  (scheduled 08:00, created 08:00:00). Backfill rows before it are `rule`/`L`.

### 2. NY Fed EFFR for 09-28 (+ target range) — 09:00
- 08:58:02 probe nothing; 09:00:02 poll **3 rows** (USEFFR 3.88, USFEDFUNDSU 4.00, USFEDFUNDSL 3.75), all
  `scheduled`/`V`, release `nyfed:effr:2026-09-28`.

### 3. FHFA HPI (July) — 09:00, a new period AND a real revision of 23 earlier months
- Currentness transitions (service log): `USFHFAHPI NO_EXPECTATION -> CHECKING` at 09:00:02 ("expected period 2026-07
  not held … window open for fhfa:hpi_monthly 2026-09-29 09:00 ET [exact/configured]"), then `CHECKING -> CURRENT`
  at 09:00:22. Polls: 08:58:02 probe, 09:00:02 (file not yet updated, 0 rows), **09:00:22 (24 rows)** — the 20 s burst.
- July `2026-07-01 = 443.52` new (`V`). FHFA re-estimated history in the same file: 23 earlier months got a second
  vintage under release `fhfa:hpi_monthly:2026-07`, e.g.
  | period | backfill vintage (`L`) | 09-29 vintage (`V`, 09:00) | `asof` just before 09:00 |
  |---|---:|---:|---:|
  | 2026-04 | 440.97 | 440.89 | 440.97 |
  | 2026-05 | 442.42 | 442.29 | 442.42 |
  | 2026-06 | 442.53 | 442.34 | 442.53 |
  The latest view keeps each period at its FIRST availability with the revised value; `asof` returns the old one.

### 4. EIA gasoline (Monday 09-28 survey) — the corrected Tuesday rule
- The first cut of the calendar said Monday 17:00, which made USGASPRICE falsely DELAYED on real data overnight; EIA's
  schedule page says Tuesday ~10:00 (fixed, see RELEASE-SYSTEM.md §1). EIA posted early: the probe at 09:58:00 got
  the new week (`source_published_at` from `Last-Modified` = **08:45:32**), 2 requests, 1 row.
- `USGASPRICE week ending 09-28 = 4.465`, `available_at` = **10:00 (scheduled)** although seen at 09:58 and published
  08:45 — `available_at` is never earlier than the schedule, so an `asof` at 09:59 does not see it. Release row created
  09:58:41, scheduled 10:00.

### 5. BLS JOLTS (August; revises July) — 10:00, **a real TRUE vintage**
- `USJOLTSO CURRENT -> CHECKING` at 10:00:39. api.bls.gov answered **HTTP 503** at 10:00:39 and 10:01:09 (5 attempts
  each), then 200 at 10:03:21: 2 rows, `CHECKING -> CURRENT`.
- | period | vintages | `asof` just before 10:00 | latest view |
  |---|---|---:|---|
  | 2026-07 | 7,271 `p` (`rule`, L, backfill) → **7,335** (`scheduled` 10:00, V, `bls:jolts:2026-08`) | 7,271 | 7,335, placed at 2026-09-14 10:00 (first availability) |
  | 2026-08 | 7,079 `p` (`scheduled` 10:00, V) | — | 7,079 |
- Placement: first sighting 10:03:00 (job time) is within 180 s of the schedule → `scheduled`.

### 6. BLS keyless quota (context for the above)
BLS refused at 00:11 and 03:11 ET (4th query each time; see PERFORMANCE.md §1a). With the fixes the service blocked
BLS for 3 h after each refusal, then at 09:11 ET fetched ONE recent window (2017–2026, 965 rows, 1 query) — which is
what gave JOLTS a July value to revise. Local quota ledger 2026-09-29: 21 counted attempts (4 + 4 refused-call
windows, 1 recent window, 12 HTTP attempts for the JOLTS poll incl. ten 503s).

## Releases in the capture window

| when (ET) | release | calendar key / label | series | what it proves |
|---|---|---|---|---|
| 09-29 08:00 | NY Fed SOFR (for 09-28) | `nyfed:sofr` 2026-09-28 | USSOFR | daily new period; placement at the rule time |
| 09-29 09:00 | NY Fed EFFR (for 09-28) | `nyfed:effr` 2026-09-28 | USEFFR, USFEDFUNDSU/L | same; EFFR `minor_routine` revision window |
| 09-29 09:00 | FHFA HPI (July) | `fhfa:hpi_monthly` 2026-07 | USFHFAHPI | NO_EXPECTATION → CHECKING → CURRENT (the configured file has no June event) |
| 09-29 10:00 | EIA gasoline (Mon 09-28 survey) | `eia:gasdiesel` 2026-09-28 | USGASPRICE | the corrected Tuesday-10:00 rule |
| 09-29 10:00 | BLS JOLTS (August; revises July) | `bls:jolts` 2026-08 | USJOLTSO | **real vintage**: July gets a second row, `asof` before 10:00 returns the old value |
| 09-29 16:00 / 16:15 | DTS (09-28), H.15 (09-28), Debt to the Penny | `fiscal:dts`, `fed:h15`, `fiscal:dtp` | USTGA, UST2Y/UST10Y (+UST10Y2Y), USDEBT | daily; H.15 via conditional GET (ETag change) |
| 09-30 08:30 | BEA GDP third estimate (Q2) + Personal Income (Aug) | `bea:gdp` 2026Q2/rev2, `bea:pio` 2026-08 | USRGDPQA, USRGDP, USGDP, USDEBTGDP; USPCEPI, USCOREPCE, USPCEPIYOY | **TRUE_VINTAGE revision** of Q2 (UNCONFIRMED if BEA republishes identical values); PCE new period; derived recompute |

## How to collect the evidence (coordinator)

All commands from Git Bash; the environment file blanks every R2/AWS/Cloudflare/provider-key variable.

```bash
. /c/w/econ1-data/env.sh            # sets V (venv python), DB, ECON_PUBLISH_R2=0, ECON_ARCHIVE=local
cd /c/w/econ1

# 1. is the service alive? (PID in C:\w\econ1-data\service.pid; health = heartbeat <= 180 s)
curl -s localhost:8787/health; echo
curl -s localhost:8787/status | $V -m json.tool > /c/w/econ1-data/status-$(date -u +%H%M).json

# 2. store evidence per release (versions(), latest vs as-of just before the new vintage, release keys,
#    acquisitions, validation events, series_state)
$V /c/w/econ1-data/tools/live_evidence.py USSOFR,USEFFR,USFEDFUNDSU --since "2026-09-29 00:00"
$V /c/w/econ1-data/tools/live_evidence.py USJOLTSO,USFHFAHPI,USGASPRICE --since "2026-09-29 00:00"
$V /c/w/econ1-data/tools/live_evidence.py UST10Y,UST2Y,UST10Y2Y,USTGA,USDEBT --since "2026-09-29 12:00"
$V /c/w/econ1-data/tools/live_evidence.py USRGDPQA,USRGDP,USGDP,USDEBTGDP,USPCEPI,USCOREPCE,USPCEPIYOY --since "2026-09-30 00:00"

# 3. currentness transitions + jobs (one JSON log line per state TRANSITION, `econ.currentness: SYM A -> B (reason)`,
#    and per scheduler job, `econ.service: job <adapter> <purpose> <symbols> -> <status> written=N requests=N`)
grep -E 'econ.currentness: |econ.service: job ' /c/w/econ1-data/logs/service.log | tail -80

# 4. BLS keyless quota actually used on the release day (limit 25/day)
$V -c "import sqlite3;c=sqlite3.connect(r'C:\w\econ1-data\econ.db');print(c.execute('select * from provider_quota').fetchall())"
```

What to look for:
- **JOLTS**: `USJOLTSO` period `2026-07-01` has TWO versions (the backfill `7271` with `pit L`, and a `bls:jolts:2026-08`
  row with `pit V`, `available_at` = 2026-09-29 10:00 ET, method `scheduled`), `asof_just_before_new_vintage` = 7271,
  `2026-08-01` new with `pit V`; state goes CHECKING (10:00) → CURRENT within minutes.
- **GDP third estimate**: `2026-04-01` of USRGDPQA/USRGDP/USGDP gains a `bea:gdp:2026Q2/rev2` vintage when any value
  changed (state CURRENT); if BEA republishes identical values, no row is written and the state is UNCONFIRMED unless the
  flat file's `Last-Modified` (a provider publication time ≥ the schedule) arrives — then CURRENT with zero new rows.
  USDEBTGDP must gain a derived vintage whose `available_at` equals the USGDP vintage's.
- **Leak invariant**: no row's `available_at` precedes its release's `scheduled_at`
  (`SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) WHERE r.scheduled_at IS NOT NULL AND o.available_at < r.scheduled_at` = 0).

## Still to come (the service keeps running; collect with the commands above)

| when (ET) | release | expected evidence |
|---|---|---|
| 09-29 13:15 | NY Fed RRP (09-29) | USRRP same-day row, `scheduled` |
| 09-29 16:00 / 16:15 | DTS, H.15, Debt to the Penny (09-28) | USTGA, UST2Y/UST10Y (+ UST10Y2Y derived vintage), USDEBT; H.15 is the first conditional GET that stores an ETag (`http_validator` is still empty) |
| 09-29 after 15:00Z | BLS older windows | `logs/bls_watcher.log`: one v1 query per window, 2007–2016 first; pauses 3 h on a refusal |
| 09-30 08:30 | BEA GDP third estimate + Personal Income | see "What to look for" |

## Restart / stop

```powershell
Stop-Process -Id 4056, 51896                       # worker + venv launcher (since the 2026-09-29 rebuild; C:\w\econ1-data\service.pid)
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ? { $_.CommandLine -like '*bls_backfill_when_ready*' } | % { Stop-Process -Id $_.ProcessId }
& C:\w\econ1-data\start_service.ps1               # restart (blanks every R2/AWS/Cloudflare/provider-key env var)
```
Leases expire by TTL (600 s); a restart recomputes all due work from the DB.
