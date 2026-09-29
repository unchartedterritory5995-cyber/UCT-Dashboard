# Economic Data: backfill timing (when a backfilled value became public)

A backfilled row was not seen by UCT when it was released, so its `available_at` is an **estimate**.
The contract (PHASE1-DESIGN "Time + PIT rules") is that the estimate is on the **late side**. A chart or an
`asof` query must never see a value before the agency published it. Late is safe but inaccurate; early is a
look-ahead leak.

This document is the audit of that contract for every enabled cohort series and parent (2026-09-29). It covers:
- the corrected placement algorithm (`api/services/econ/backfill_timing.py`)
- the evidence tables behind it (`calendars/release_history.json`, `funding_lapses.json`, `federal_closures.json`)
- the per-series results of the local rebuild

## 1. The placement (`backfill_timing.place`)

| step | what | direction |
|---|---|---|
| 1 | registry `release.lag_rule` (period_end + N days at T, business days, ...) | base |
| 2 | **family bounds**: holiday/closure-aware release-day rules per calendar key, plus **era margins** for periods whose release practice is not evidenced | later only |
| 3 | **PIT class** `pit.backfill_class`, downgraded U→L where the stored value was *not* what was published at the time (`BACKCAST_BEFORE`) | U→L only |
| 4 | **funding lapse**: a row of an affected family whose step-2 time falls in `[lapse start, window end]` is placed at `max(time, window end 23:59 ET)`, and its PIT class becomes L (never U/V) | later only |
| 5 | **snap**: the agency's own stated release time of *this* period replaces the estimate. Sources: (a) `release_history.json`, where a date-only row is the END of that ET day; (b) an active `calendar_event` from `authoritative_feed`/`authoritative_page`/`configured` with precision `exact`/`time_configured` and a NEW-period label equal to the row's period | = actual release |
| 6 | an unsnapped time is capped at `now` (the first sighting); the result is never earlier than a matched NEW event's schedule | clamp |

- Steps 2 and 4 can only move a row later. Step 5 is the only step that can move it earlier, and it only does so to a release time stated by the agency for that exact period.
- `test_backfill_timing.py::test_placement_is_never_earlier_than_the_old_rule_unless_snapped` pins this.
- `available_method` records the path taken:
  - `rule` (steps 1–2)
  - `rule:lapse` (step 4)
  - `scheduled:history` / `scheduled:calendar` (step 5)

**Snap guards.** A snap does not change the PIT class. Some calendar labels are **inferred by UCT**:
- BEA GDP/PIO: the feed gives dates only, and UCT reads the period from the lag.
- MTS: UCT reads the period from the release month.

These labels are wrong exactly when schedules are disrupted. For example, the 2026-01-22 BEA release is labelled `2025Q4` new, but it was the Q3 update; Q4's advance came on 02-20. So for these keys a snap needs a plausible lag (≥ 25 d for BEA, 5 d for MTS) and is never used inside a lapse window. Labels stated by the agency (Census list view, BLS PFEI transcription, FHFA, G.17, ESMS) have no such guard.

**Why the calendar snap exists (task 3).** Aug-2026 CPI was placed on 09-25 (rule period_end + 25 d), but the configured PFEI event says 09-11 08:30. Late is safe but wrong. The row is now at 09-11 08:30 (`test_calendar_snap_places_at_the_authoritative_event`).

## 2. Evidence tables

### 2a. `release_history.json`: actual historical release dates

This file is built by `tools/econ/build_release_history.py` from saved agency pages. Each source's sha256 is in the file, and the sources are stored in `C:\w\econ1-data\sources\release_history\`.

| family | periods | source | time |
|---|---|---|---|
| `bls:cpi` | 1953-01..2000-12, 2002-05..2026-07 | BLS *Historical release dates … 2000 and earlier* (PDF) + BLS archived news-release lists (Wayback 2016 and 2026) | PDF: date only → end of day. Archive: 08:30 embargo (time_configured) |
| `bls:empsit` | 1957-06..2026-08 | same | same |
| `bls:ppi` | 2002-05..2026-07 | BLS archive | 08:30 |
| `bls:eci` | 1976Q1..2026Q2 | BLS archive | 08:30 |
| `bls:jolts` | 2004-02..2026-07 | BLS archive | 10:00 |
| `eia:wpsr` | week ending 2011-08-05..2026-09-18 | EIA WPSR archive (*Release date / Data ending*) | Wednesday 10:30; any other weekday is date only. A week with no own release (2022-06-17, the systems outage) is bounded by the next listed release |
| `fed:g17` | 1997-11..2026-07 | Fed G.17 release list ("For release at 9:15 a.m."). The 2013-10-28 (Sep 2013), 2025-12-03 (Sep 2025) and 2025-12-23 (Oct+Nov 2025) catch-ups were read from each release's text | 09:15 |
| `census:resconst`, `census:m3adv`, `census:ft900` | 2013-11..2026-07 | Wayback captures of the Census list view. Only rows released on or before the capture are kept, so a stale schedule is never used | exact |

BLS lapse-cancelled periods come from the official BLS notice:
- Oct-2025 establishment data → 2025-12-16
- Sep-2025 JOLTS → 2025-12-09
- Oct-2025 PPI → 2026-01-14

### 2b. `funding_lapses.json`

`window end = max(lapse end + 60 d, last catch-up release of the family)`.

**Why 60 days is only a floor.** 60 days covers the BLS catch-ups:
- 2013: Oct CPI on 11-20 (end + 35 d)
- 2025: Sep Employment Situation on 11-20 (end + 8 d); Dec-2025 PPI moved to 2026-01-30 (end + 79 d)
- 1996: Jan-1996 CPI on 02-28 (end + 53 d)

It does not cover every family, because some catch-ups ran past it:
- Census 2013: Sep/Oct housing starts released 2013-12-18 (end + 63 d).
- Census 2025: Feb/Mar-2026 housing starts released 2026-04-29 (end + 168 d).
- BEA 2025: the Q4 second estimate on 2026-03-13 (end + 121 d).

So each lapse carries the last catch-up release actually observed per family, and the window is never shorter than 60 days.

| lapse | start | end | families (affected) | catch-up end | confidence / citation |
|---|---|---|---|---|---|
| 1995-11 | 1995-11-14 | 1995-11-19 | bls, bea, census, dol:claims, fed:g17, fiscal | — | secondary: CRS R41759. BLS footnote: Nov-1995 CPI delayed one day because BLS and Census were closed |
| 1995-12 | 1995-12-16 | 1996-01-06 | same | bls 1996-02-28 | secondary: CRS R41759. Official BLS PDF: Dec-1995 CPI 02-01, Jan-1996 CPI 02-28, Dec-1995 Employment Situation 01-19 |
| 2013-10 | 2013-10-01 | 2013-10-16 | bls, bea, census, fed:g17, eia, dol:claims | census 2013-12-18 | official: BLS shutdown notice; Census cb13-198; Fed G.17 archive (Sep IP on 10-28); EIA archive (WPSR w/e 10-11 on 10-21). DOL claims reported on schedule (secondary only) → included conservatively |
| 2018-12 | 2018-12-22 | 2019-01-25 | bea, census, fiscal:mts | bea 2019-03-29, census 2019-05-09 | official: Census notice. Commerce and Treasury lapsed; Labor and Energy were funded. MTS timing not evidenced → included |
| 2025-10 | 2025-10-01 | 2025-11-12 | bls, bea, census, dol:claims, fed:g17, fiscal:mts | bls 2026-01-30, bea 2026-03-13, census 2026-04-29, g17 2025-12-23 | official: DOL notice and P.L. 119-37; BLS revised-dates page; BEA; Census list view. EIA stated it would keep publishing → not affected |
| 2026-01 | 2026-01-31 | 2026-02-03 | bls, bea, census, dol:claims, fed:g17, fiscal:mts | bls 2026-02-27 | **secondary only** (news coverage and the BLS page's "2026 lapse" moves). Which departments lapsed is not evidenced, so every appropriated family is included (conservative wider scope) |

**Not affected (with reason):**
- Fed H.15, H.4.1 and H.6 (the Board is self-funded).
- NY Fed.
- FHFA (funded by assessments).
- DTS and Debt to the Penny: published through each lapse; their placement also uses the provider's own next observation date.
- EIA in 2018-19 and 2025.

G.17 *is* listed, because it waits for BLS source data.

### 2c. `federal_closures.json`

This table lists one-off executive-order closures, days of mourning (1994 Nixon, 2004 Reagan, 2007 Ford, 2018 Bush, 2025 Carter), and OPM emergency closures, with Federal Register citations. Each date is treated as a **non-publication** day by the family bounds. The effect can only be later: the Fed still released H.4.1 on the 2003-12-26 closure.

Evidence that closures matter: after Christmas-Friday closures, H.4.1 was released on the following Monday in 2008, 2009, 2014, 2020 and 2025. The EIA WPSR for the week ending 2025-12-19 came out Mon 12-29 at 17:00.

## 3. Per-series audit (rule vs history, and what changed)

Legend:
- **ok** = the registry rule is already late-side in the evidenced era.
- **early** = cases where the old rule placed a row before the agency's release.

The last column comes from the final local rebuild (§5; BLS then held 1977+; the 1967–76 window was written afterwards by the running pipeline under the same rules): rows whose `available_at` changed, rows that moved earlier (all by an authoritative snap), and PIT U→L downgrades.

| series | family / rule | evidence and finding | fix | re-timed / earlier / U→L |
|---|---|---|---|---|
| USCPI, USCPINSA, USCORECPI, USCORECPINSA | bls:cpi, pe+25 d 08:30 | **early**: 1953–88 releases up to 31 d after the month (1964-06, 1968-06, 1978-04); Dec-1995 CPI 32 d. The 1989–2026 max outside lapses is 24 d | history snap 1953–2026; pre-1953 era pe+60; lapses | 580 / 542 / NSA 144 (rebuild held 1977+). Pre-1988 NSA rows → L: the CPI was rebased to 1982-84=100 in Jan 1988, core was introduced Apr 1977 and back-cast |
| USPPIFD | bls:ppi, pe+25 | **early**: Feb-2004 data 47 d; 2025 lapse | history 2002+ | 202 / 196 / — |
| USECI | bls:eci, pe+35 | ok modern (31 d); 2025Q3 71 d (lapse) | history | 102 / 99 / — |
| USUNRATE, USNFP | bls:empsit, pe+12 | **early**: 1960s releases up to 16 d; Sep-2013 22 d; Sep-2025 51 d; Oct-2025 46 d | history 1957+; pre-Jun-1957 era pe+42; lapses | 579 / 573 / — |
| USJOLTSO | bls:jolts, pe+45 10:00 | **early**: Apr-2012 50 d; Aug/Sep-2013 53–54 d; Feb-2004 46 d | history 2004+; pre-2004 era pe+60 | 305 / 255 / — |
| USICSA | dol:claims, pe+6 08:30 (Fri) | ok modern: Thursday releases move earlier (Wed) on Thursday holidays. Christmas 2025 had Thu and Fri both closed. Pre-2000 practice not evidenced | Thu+Fri-closed bound; era pe+13 before 2000; lapses (2025: no releases 10-02..11-13) | 1,763 / 0 / — |
| USGDP, USRGDP, USRGDPQA | bea:gdp, pe+32 08:30 | ok modern (advance 25–30 d). Lapses: 2013 Q3 on 11-07; 2018Q4 on 2019-02-28; 2025Q3 on 12-23; 2025Q4 on 2026-02-20. Pre-1985 not evidenced | lapses; era pe+60 pre-1985; BEA feed snap with lag guard | 162 / 5 / — |
| USPCEPI, USCOREPCE | bea:pio, pe+35 | ok modern. 2025 catch-up: Oct+Nov on 2026-01-22, Dec on 02-20 | lapses; era pe+60 pre-1985; guarded feed snap | 342 / 13 / — |
| USHOUST | census:resconst, pe+22 | ok 2014+ (max 21 d outside lapses). Lapses: 2013 63 d; 2025 up to 101 d | history 2014+; era +7 d pre-2014; lapses | 724 / 62 / — |
| USDURGOODS | census:m3adv, pe+30 | ok 2014+ (max 28 d) | history; era +7 d; lapses | 329 / 62 / — |
| USTRADEBAL | census:ft900, pe+42 | ok 2014+ (max 40 d) | history; era +7 d; lapses | 314 / 70 / — |
| UST2Y, UST10Y | fed:h15, next business day 16:15 | **early before 1999**: H.15 was a WEEKLY Monday release (FRASER: 3-day lag from Friday, i.e. up to 7 d for a Monday observation). 1999–2016: daily web update, time not evidenced. Good Friday / closures | weekly-era bound (Monday after the week, end of day); daily-update era end of the next publication day; closures; next-observation day | 10y 14,313 / 0 / 4,021; 2y 10,553 / 0 / 261 (CMT not evidenced in the weekly H.15 before Jun 1977 → L) |
| USFEDBAL | fed:h41, pe+2 16:30 (Fri) | **early** after Christmas-Friday closures (Fed released Monday 2008/2009/2014/2020/2025) | Thursday → next publication day incl. closures | 8 / 0 / — |
| USM2 | fed:h6, pe+30 13:00 | ok: weekly era showed month m ~16 d after month end; monthly since 2021-02-23 on the 4th Tuesday (≤ 29th after a holiday) | 4th-Tuesday bound with closures (monthly era) | 0 / 0 / — |
| USINDPRO | fed:g17, pe+20 09:15 | **early**: 1919–53 released ~26th–31st; 1990s up to 27 d; Sep-2013 28 d; Sep-2025 64 d | history 1997-11+; era pe+40 (<1954) / pe+31 (<1997-11); lapses (source data from BLS) | 1,286 / 336 / — |
| USEFFR, USFEDFUNDSU/L | nyfed:effr, next business day 11:00 | ok, plus closures. EFFR IS published on Good Friday (NY Fed holiday schedule) | next publication day = max(next federal publication day, next observation) | 21 / 0 / —; 43 / 0 / — |
| USSOFR | nyfed:sofr, next business day 10:00 | **early** around SIFMA full closes (Good Friday, 2026-07-03: SOFR not published; Thursday's rate comes out Monday) | next-observation rule | 27 / 0 / — |
| USRRP | nyfed:rrp, same day 14:00 | ok: operation window 11:15–11:45 (2013), 12:45–13:15 (2014+); results "after completion" (time not stated) | none | 0 |
| USEMPIRE | nyfed:esms, ps+17 08:30 | ok modern (15th, or next business day) | era +7 d before 2005; calendar snap 2026 | 45 / 3 / — |
| USDEBT | fiscal:dtp, next business day 17:00 | ok for 2005-04+ | next-observation rule; closures; 1993-04..2005-04-03 → **L** ("daily figures only from April 4, 2005") | 149 / 0 / 3,004 |
| USTGA | fiscal:dts, next business day 17:00 | ok ("by 4:00 p.m. the following business day") | next-observation rule; closures | 45 / 0 / — |
| USMTSDEF | fiscal:mts, pe+15 14:00 | ok (8th business day ≤ 13th) | lapses (2018-19, 2025, 2026: not evidenced → included) | 8 / 0 / — |
| USCRUDEINV | eia:wpsr, pe+6 11:00 (Thu) | **early**: Monday-holiday weeks now release Thursday 12:00; Christmas/New Year on a Wednesday → Friday (2013/14, 2018, 2019, 2024); 2025-12-19 week → Mon 12-29 17:00; ad-hoc outages (2022-06-17 week → 06-29; 2023-11 → 11-15); 2013 lapse → Mon 10-21 | history 2011-08+; Mon–Wed holiday bound (end of the 2nd publication day after Wednesday); era pe+13 before 2011-08; lapse 2013 | 2,295 / 672 / — |
| USGASPRICE | eia:gasdiesel, pe+1 17:00 (Tue) | **early** in holiday weeks: "released on Wednesday" when Monday/Tuesday is a government holiday (since 2025-04; before, Monday ~17:00) | Mon/Tue holiday or closure → end of the 2nd publication day after the survey Monday; era +2 d before 2000; lapse 2013 | 696 / 0 / — |
| USFHFAHPI | fhfa:hpi_monthly, pe+62 09:00 | ok to the day (last Tuesday of m+2 ≤ pe+62), but the 10:00 release era could be an hour early on the boundary day | end of day pe+62; era pe+70 before 2012 | 426 / 0 / — |
| derived | max(input available_at), weakest PIT | inherit | recomputed fresh (§5) | — |

### Residual risks (documented, not fixed)
- **Ad-hoc delays with no archive.** The EIA archive shows two unannounced multi-day WPSR delays in 2022–2023. Delays of that kind before an evidence table starts are covered only by the era margins.
- **Pre-evidence eras are margins, not proof.** Examples: CPI before 1953, G.17 before 1997, GDP/PIO before 1985, DOL claims and gasoline before 2000, Census before 2014. Those series are L, apart from the CPI NSA rows, which are L before 1988 anyway.
- **Unverified times.**
  - The ON RRP result time (14:00 rule; the operation closes at 13:15) is not stated by the NY Fed.
  - The BLS 08:30 embargo is configured practice, cited in every news release header. It is not a per-release fact for 2002–2007.
- **The 2026-01 lapse is secondary only.** Its scope is deliberately wide.

## 4. Series the task named (conclusions)
- **USGASPRICE**: the rule was early in every Monday-holiday week. The row is now placed on the Wednesday side (`test_gasoline_holiday_week_is_wednesday_side`).
- **EIA WPSR crude**: holiday Thursday 12:00, Friday after a Christmas/New Year Wednesday, and Monday after Christmas 2025 — all fixed, with the EIA archive snap from 2011.
- **DOL claims**: Thursday-and-Friday-closed weeks are bounded to the next publication day, and the 2025 release gap is covered by the lapse table.
- **H.15, NY Fed, DTS next-business-day rules**: these use the federal calendar plus closures plus the provider's next observation date. H.15 before 1999 is weekly.

## 5. Local rebuild (2026-09-29): results

Totals over 80,556 backfill rows:

| outcome | rows |
|---|---:|
| re-timed | 38,344 |
| moved later | 33,234 |
| moved earlier (all authoritative snaps) | 5,110 |
| snapped to history | 5,388 |
| snapped to a calendar event | 52 |
| lapse floor applied | 227 |
| PIT U→L | 7,574 |

Rows by funding lapse: 1995-11 77, 1995-12 63, 2013-10 71, 2018-12 26, 2025-10 92, 2026-01 32.

Verification:
- counts per series are equal for backfill and live;
- the 31 live rows are identical;
- 0 leaks;
- latest values are identical for every series, derived included;
- `audit_derived` is clean;
- all four as-of probes pass.

See `LIVE-RELEASES.md` "Rebuild 2026-09-29" and `C:\w\econ1-data\rebuild-report-2026-09-29.json`.

## 6. OWNER REVIEW: correcting backfill timing after production launch

No production data exists yet, so **no action is needed before launch**. The local correction above was possible because the store is append-only for observations but the local DB could be rebuilt from scratch. That will not be true once members have seen the data.

**Option A: rebuild the backfill from the raw archive, carrying live vintages verbatim.** This is the procedure proven here (`tools/econ/rebuild_local_db.py`):
- live releases and their rows are copied byte-for-byte;
- backfill rows are re-placed from their stored values, with no re-fetch;
- derived series are recomputed;
- counts, latest values, the leak check and as-of probes are verified before the swap.

Cost: a full new DB, a maintenance window for the ingestion service, and every artifact republished. Previously served `asof` answers for backfilled periods change (by design — they were wrong). This needs no schema change and keeps the append-only guarantee *within* a DB.

**Option B: store-level supersession of a backfill run.** A new `backfill` release would supersede an older backfill release's placement, and the store would ignore superseded rows in `latest`/`asof`. This changes append-only semantics (rows become invisible without being deleted) and needs a migration plus new query semantics. It was deliberately **not** done in this pass (owner rule).

Recommendation: keep Option A as the operator procedure. Consider Option B only if production backfill corrections become routine.
