# Economic Data — Expansion from the 41-series cohort to the 151-series launch universe

Read-only analysis, 2026-09-28. Inputs: `api/services/econ/registry/series.json`, the adapters in `api/services/econ/adapters/`, `derive.py`, `calendar.py` + `calendars/*.json`, `registry.py`/`licensing.py`, the Phase 0 catalog (`econ_catalog.csv`, `catalog_notes.md`), and `docs/economic-data/registry-corrections/` + `verification/`. The machine-readable version is [`expansion_151.csv`](expansion_151.csv). It was generated with the live `cal.KNOWN_CALENDARS` and `derive.DERIVE_OPS`, so calendar and op coverage come from the code, not from the docs.

> **Status 2026-09-30:** this was the pre-readiness analysis. The verified outcome (what was enabled, corrected, or left off, with reasons and a local census) is [`readiness/CATALOG.md`](readiness/CATALOG.md); every registry change is in `registry-corrections/readiness.json`.

**Scope.** The 110 series with catalog `recommended_v1 == LAUNCH` (the 151 cleared launch set minus the 41 catalog COHORT rows).

> **Registry drift:** 2 of the 110 LAUNCH rows are already `status=enabled` with `cohort=true` in the registry: USCORECPINSA, USGDP. The registry's 42 enabled series are 40 catalog-COHORT rows plus these 2, and catalog-COHORT `USRETAIL` is still `unverified`. **108 series actually remain.**

## Buckets

Each series gets one **primary** bucket, which is its largest blocker (precedence E > B > C > D > F > A), and a **flags** set listing every bucket that applies.

| Bucket | Meaning | Primary | Any flag |
|---|---|---:|---:|
| **A — NO CODE** | Registry params + authoritative ID check + backfill + enable only. The implemented adapter already accepts the params shape. | 84 | 84 |
| **B — NEW ADAPTER CODE** | An agency, dataset or file shape that no implemented adapter handles. | 5 | 5 |
| **C — NEW DERIVATION CODE** | A derivation op that `derive.py` does not support. | 0 | 0 |
| **D — SOURCE CONFIRMATION** | Provider ID, column, units or start is unverified (`source.verified=false`), either directly or through a derived input. | 12 | 17 |
| **E — PERMISSION** | Licensing not GREEN/cleared. | 0 | 0 |
| **F — OTHER** | A calendar gap (the calendar_key is unknown to the release system, so currentness reports NO_EXPECTATION), calendar semantics, a methodology or basis question, or a params/calendar mismatch. | 9 | 21 |
| | **Total** | **110** | |

Of the 84 NO-CODE rows, 2 are already enabled, which leaves **82 to onboard**. One of those (USCORECAPEX) also needs a registry params fix; see below.

### What each adapter actually accepts (code inspection)

- **bls**: any series id. M01–M12 and Q01–Q04 are mapped; M13/Q05/S/A01 are skipped. Quarterly PRS (productivity) is supported.
- **bea**: `dataset` must be `NIPA`. Anything else raises `MalformedPayload("dataset … not implemented")`. Frequencies are Q, M and A through `NipaDataQ/M/A.txt` flat files, one file per frequency, so any NIPA table/line/series_code works. **ITA is not supported**, which rules out USCURACCT.
- **census**: generic over program/category/data_type through keyless `econ_export` (or keyed EITS). `EXPORT_PROGRAM` already maps marts, resconst, ressales, m3, advm3, ftd, mtis, mwts, vip, bfs, hv, qfr and qss. **M frequency only**, SA/NSA, and `advance_program` fill is supported.
- **fed_ddp**: **release-agnostic**. It builds `/releases/<rel>/data/FRB_<rel>_xml.zip` for any `params.release` matching `^[A-Za-z][A-Za-z0-9.]{0,15}$`, and the retirement doc confirms the H.8, G.19 and H.10 zips exist (HTTP 200). Identity checks derive unit, multiplier and currency from `units.raw`. **No code is needed for H.8, G.19 or H.10. Only calendars and ID checks are missing.**
- **fiscaldata**: three shapes. DAILY field (record_date = day), DTS labelled, and MTS reports (`row_key`). A monthly series whose rows are NOT month-named MTS-table-1 rows (for example MTS **table 5** filtered by `classification_desc`) falls into the DAILY path and yields day periods. `validate.py` rejects those for M, which puts **USMTSINT in bucket B**.
- **eia**: generic `<NS>.<CODE>.<F>` over the dnav LeafHandler (keyless) or the v2 seriesid/route (keyed). Only PET routes have been proven live. NG weekly storage should parse because the page format is the same, but it is untested.
- **dol**: `measure` accepts initial or continued. Continued uses the XML history path only, since the press-PDF path is initial-only.
- **Not implemented** (named in `registry.KNOWN_ADAPTERS` but with no module): `regional_fed_file`, `treasury_tic`, `fed_policy` and `treasury_curve`. The five H.15 CMT series carry `params.alt.adapter=treasury_curve` only as an **optional** authority upgrade, and the existing H.15 path works. They count as A.
- **derive**: all LAUNCH ops (yoy_pct, mom_pct, diff, spread, sub[n-ary], sma, sum) are in `DERIVE_OPS`. `align_w` appears only in `USNETLIQ`, which is catalog **LATER**, so **bucket C = 0**.
- **licensing**: all 110 are `GREEN/cleared`, so **bucket E = 0** (verified).

## Per-adapter breakdown (primary bucket)

| Adapter | Series | A NO CODE | B ADAPTER | C DERIV | D SOURCE | E PERM | F OTHER |
|---|---:|---:|---:|---:|---:|---:|---:|
| `bls` | 27 | 23 | 0 | 0 | 1 | 0 | 3 |
| `derived` | 23 | 17 | 0 | 0 | 5 | 0 | 1 |
| `fed_ddp` | 21 | 15 | 0 | 0 | 3 | 0 | 3 |
| `bea` | 12 | 10 | 1 | 0 | 0 | 0 | 1 |
| `census` | 12 | 10 | 0 | 0 | 1 | 0 | 1 |
| `eia` | 7 | 6 | 0 | 0 | 1 | 0 | 0 |
| `fiscaldata` | 4 | 3 | 1 | 0 | 0 | 0 | 0 |
| `dol` | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| `regional_fed_file` *(not implemented)* | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `treasury_tic` *(not implemented)* | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `fed_policy` *(not implemented)* | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| **Total** | **110** | **84** | **5** | **0** | **12** | **0** | **9** |

## Calendar coverage gaps (F)

`cal.KNOWN_CALENDARS` covers bea:gdp/pio, nine census:* keys, bls:cpi/empsit/ppi/eci/jolts (bls_2026.json, **coverage ends 2026-12-31**), fed:g17, fed:h15/h41/h6 (rules), nyfed:*, fiscal:dts/dtp/mts, eia:wpsr/gasdiesel, dol:claims, fhfa:hpi_monthly and nyfed:esms. A series whose key is missing can still ingest. Currentness, however, reports NO_EXPECTATION, and `/status` shows provider "unknown".

| Missing calendar_key | Series | Fix needed |
|---|---|---|
| `fed:h8` | USBANKCRED, USCILOANS, USDEPOSITS | rule: weekly Friday ~16:15 ET, Wednesday level (H.8) |
| `bls:prod` | USPROD, USULC | add to bls_2026.json (confirm dates in the PFEI) |
| `fed:g19` | USCONSCRED, USCONSCREDCHG | configured file (G.19 ~5th business day, 15:00 ET) or RSS-driven |
| `eia:ngs` | USNATGASSTOR, USNATGASCHG | rule: Thursday 10:30 ET, week ending prior Friday (+holiday table) |
| `bls:mxp` | USIMPPRICE | add to bls_2026.json (confirm dates in the PFEI) |
| `bea:ita` | USCURACCT | add "U.S. International Transactions" to BEA_RELEASES (confirm it is listed in release_dates.json) |
| `fed:h10` | USDOLLARIDX | rule: H.10 weekly Monday 16:15 (daily data) |
| `nyfed:sce` | USSCEINF1Y | configured file (SCE monthly) |
| `treasury:tic` | USTIC | configured file (TIC monthly ~18th, 16:00) |
| `fed:policy` | USIORB | event-driven (FOMC decisions); rule from the FOMC calendar |
| | **15 series** | |

Other F items that are not simple key gaps:
- **USCORPPROF**: bea:gdp is known, but `bea_events` labels every advance release as the NEW quarter. Corporate profits first appear with the 2nd estimate (Q4 with the 3rd), so the series would read DELAYED after every advance release. It needs a per-series "first carried by /rev1" rule.
- **USCORECAPEX**: calendar census:m3adv, but params have no `advance_program: "advm3"` (USDURGOODS has one). The fix is registry-only, so the primary bucket stays A.
- **Retail basis conflict** (verification/census.txt: econ_export/MRTS database Aug-2026 737,763 vs marts_current Table 1 773,947, ~5% on every month) affects USRETAILXA, USRETAILCTRL, USRETAILMOM and USRETCTRLMOM. Enabling any of them needs an owner decision. USRETAILCTRL also depends on four catalog-**LATER** inputs (USRETAILMV unverified; USRETAILGAS/BM/FS disabled). Those must be onboarded even though they sit outside the 151.

## Onboarding order (what the counts imply)

1. **Wave 1 — 82 NO-CODE series.** Per series: authoritative ID check (live fetch vs the official page), backfill, then flip to enabled. Batches: BLS 22, fed_ddp 15, BEA NIPA 9, census 10, EIA 6, fiscaldata 3, derived 17. Derived series whose inputs are LAUNCH-disabled (USCPISHYOY, USCPISCXSYOY, USCOREPPIYOY, USAHEYOY, UST10Y3M, UST10YBE, UST5YBE) must be enabled after those inputs.
2. **Calendar work (~1 small calendar.py + JSON change) unlocks 8 more** with no adapter code: USIMPPRICE, USPROD, USULC (BLS), USBANKCRED, USCILOANS (H.8), USCONSCRED, USCONSCREDCHG (G.19), and USCORPPROF (bea:gdp rev1 rule). This takes NO-CODE-for-ingestion to 90 of 108.
3. **Source confirmation (12 primary).** Most also carry an F calendar gap (H.8 deposits, H.10, NG storage). The four retail rows need the basis decision first.
4. **New adapter code (5):** `bea` ITA (USCURACCT), `fiscaldata` monthly single-row shape (USMTSINT), `treasury_tic` (USTIC), `fed_policy` (USIORB), and `regional_fed_file` for the NY Fed SCE (USSCEINF1Y). Each also needs ID confirmation and a calendar.

## Per-series table

Flags: A=no code, B=new adapter code, C=new derivation code, D=source confirmation, E=permission, F=other.

| Symbol | Category | Freq | Adapter | Provider id / derivation | Calendar | Primary | Flags | Note |
|---|---|---|---|---|---|---|---|---|
| USCORECPINSA | Inflation & Prices | M | bls | `CUUR0000SA0L1E` | `bls:cpi` | A NO CODE | A | ALREADY ENABLED (registry cohort=True though catalog says LAUNCH); nothing to do |
| USCPIFOOD | Inflation & Prices | M | bls | `CUSR0000SAF1` | `bls:cpi` | A NO CODE | A |  |
| USCPIENERGY | Inflation & Prices | M | bls | `CUSR0000SA0E` | `bls:cpi` | A NO CODE | A |  |
| USCPISHELTER | Inflation & Prices | M | bls | `CUSR0000SAH1` | `bls:cpi` | A NO CODE | A |  |
| USCPIOER | Inflation & Prices | M | bls | `CUSR0000SEHC` | `bls:cpi` | A NO CODE | A |  |
| USCPISVCXSH | Inflation & Prices | M | bls | `CUSR0000SASL2RS` | `bls:cpi` | A NO CODE | A |  |
| USCPISVCXEN | Inflation & Prices | M | bls | `CUSR0000SASLE` | `bls:cpi` | A NO CODE | A |  |
| USCPICOREGDS | Inflation & Prices | M | bls | `CUSR0000SACL1E` | `bls:cpi` | A NO CODE | A |  |
| USCPIUSEDCAR | Inflation & Prices | M | bls | `CUSR0000SETA02` | `bls:cpi` | A NO CODE | A |  |
| USCORECPIMOM | Inflation & Prices | M | derived | `mom_pct(USCORECPI)` | `bls:cpi` | A NO CODE | A |  |
| USCPISHYOY | Inflation & Prices | M | derived | `yoy_pct(USCPISHELTER)` | `bls:cpi` | A NO CODE | A | needs first: USCPISHELTER(LAUNCH/disabled) |
| USCPISCXSYOY | Inflation & Prices | M | derived | `yoy_pct(USCPISVCXSH)` | `bls:cpi` | A NO CODE | A | needs first: USCPISVCXSH(LAUNCH/disabled) |
| USPPICORE | Inflation & Prices | M | bls | `WPSFD49104` | `bls:ppi` | A NO CODE | A | ID verified; only the FRED cross-ref is "?" (not a blocker) |
| USPPIFDNSA | Inflation & Prices | M | bls | `WPUFD4` | `bls:ppi` | D SOURCE CONFIRMATION | D | WPUFD4 unverified: only the WPU prefix format was proven (via WPUFD49104); unverified: USPPIFDNSA |
| USPPIYOY | Inflation & Prices | M | derived | `yoy_pct(USPPIFDNSA)` | `bls:ppi` | D SOURCE CONFIRMATION | D | yoy_pct; blocked on its unverified input USPPIFDNSA; unverified: USPPIFDNSA; needs first: USPPIFDNSA(LAUNCH/unverified) |
| USPPIMOM | Inflation & Prices | M | derived | `mom_pct(USPPIFD)` | `bls:ppi` | A NO CODE | A |  |
| USCOREPPIYOY | Inflation & Prices | M | derived | `yoy_pct(USPPICORE)` | `bls:ppi` | A NO CODE | A | needs first: USPPICORE(LAUNCH/disabled) |
| USIMPPRICE | Inflation & Prices | M | bls | `EIUIR` | `bls:mxp ⚠` | F OTHER | F | bls:mxp has no calendar (bls_2026.json carries only cpi/empsit/ppi/eci/jolts) -> NO_EXPECTATION currentness |
| USPROD | Employment & Labor | Q | bls | `PRS85006092` | `bls:prod ⚠` | F OTHER | F | Q series (BLS adapter maps Q01-Q04); bls:prod has no calendar |
| USULC | Employment & Labor | Q | bls | `PRS85006112` | `bls:prod ⚠` | F OTHER | F | Q series; bls:prod has no calendar |
| USU6 | Employment & Labor | M | bls | `LNS13327709` | `bls:empsit` | A NO CODE | A |  |
| USLFPR | Employment & Labor | M | bls | `LNS11300000` | `bls:empsit` | A NO CODE | A |  |
| USEPOP | Employment & Labor | M | bls | `LNS12300000` | `bls:empsit` | A NO CODE | A |  |
| USEPOP2554 | Employment & Labor | M | bls | `LNS12300060` | `bls:empsit` | A NO CODE | A |  |
| USPRIVNFP | Employment & Labor | M | bls | `CES0500000001` | `bls:empsit` | A NO CODE | A |  |
| USMFGNFP | Employment & Labor | M | bls | `CES3000000001` | `bls:empsit` | A NO CODE | A |  |
| USGOVNFP | Employment & Labor | M | bls | `CES9000000001` | `bls:empsit` | A NO CODE | A |  |
| USAHE | Employment & Labor | M | bls | `CES0500000003` | `bls:empsit` | A NO CODE | A |  |
| USAWH | Employment & Labor | M | bls | `CES0500000002` | `bls:empsit` | A NO CODE | A |  |
| USAHEYOY | Employment & Labor | M | derived | `yoy_pct(USAHE)` | `bls:empsit` | A NO CODE | A | needs first: USAHE(LAUNCH/disabled) |
| USJOLTSQ | Employment & Labor | M | bls | `JTS000000000000000QUL` | `bls:jolts` | A NO CODE | A | bls:jolts dates come from a secondary calendar (lower confidence) - not a blocker |
| USJOLTSQR | Employment & Labor | M | bls | `JTS000000000000000QUR` | `bls:jolts` | A NO CODE | A |  |
| USJOLTSH | Employment & Labor | M | bls | `JTS000000000000000HIL` | `bls:jolts` | A NO CODE | A |  |
| USJOLTSL | Employment & Labor | M | bls | `JTS000000000000000LDL` | `bls:jolts` | A NO CODE | A |  |
| USCCSA | Employment & Labor | W | dol | `DOL ETA national claims (continued, SA)` | `dol:claims` | D SOURCE CONFIRMATION | D | dol adapter already supports measure=continued (XML history path; the press-PDF fast path is initial-only). Column/ID unverified; unverified: USCCSA |
| USICSA4W | Employment & Labor | W | derived | `sma(USICSA)` | `dol:claims` | A NO CODE | A | sma n=4 over enabled USICSA |
| USGDP | Growth & GDP | Q | bea | `NIPA T10105 L1 (A191RC)` | `bea:gdp` | A NO CODE | A | ALREADY ENABLED (registry cohort=True though catalog says LAUNCH); nothing to do |
| USFSPDP | Growth & GDP | Q | bea | `NIPA T10406 L8 (LB000003)` | `bea:gdp` | A NO CODE | A |  |
| USRNRFI | Growth & GDP | Q | bea | `NIPA T10106 L9 (A008RX)` | `bea:gdp` | A NO CODE | A |  |
| USPERSINC | Consumer | M | bea | `NIPA T20600 L1 (A065RC)` | `bea:pio` | A NO CODE | A |  |
| USDPI | Consumer | M | bea | `NIPA T20600 L27 (A067RC)` | `bea:pio` | A NO CODE | A |  |
| USRDPI | Consumer | M | bea | `NIPA T20600 L37 (A067RX)` | `bea:pio` | A NO CODE | A |  |
| USPCE | Consumer | M | bea | `NIPA T20600 L29 (DPCERC) / T20805 L1` | `bea:pio` | A NO CODE | A | NIPA T20600 L29 |
| USRPCE | Consumer | M | bea | `NIPA T20806 L1 (DPCERX)` | `bea:pio` | A NO CODE | A |  |
| USSAVRATE | Consumer | M | bea | `NIPA T20600 L35 (A072RC)` | `bea:pio` | A NO CODE | A | percent (no unit_mult) |
| USPCESVCXHE | Inflation & Prices | M | bea | `NIPA T20804 L28 (IA001260)` | `bea:pio` | A NO CODE | A | price index (no unit_mult) |
| USPCEPIMOM | Inflation & Prices | M | derived | `mom_pct(USPCEPI)` | `bea:pio` | A NO CODE | A |  |
| USCOREPCEYOY | Inflation & Prices | M | derived | `yoy_pct(USCOREPCE)` | `bea:pio` | A NO CODE | A |  |
| USCOREPCEMOM | Inflation & Prices | M | derived | `mom_pct(USCOREPCE)` | `bea:pio` | A NO CODE | A |  |
| USCORPPROF | Growth & GDP | Q | bea | `NIPA T61600D L1 (A051RC)` | `bea:gdp` | F OTHER | F | NIPA T61600D flat file = no adapter code, BUT calendar_key bea:gdp makes currentness expect each NEW quarter at the ADVANCE GDP release; profits first appear with the 2nd estimate (Q4 with the 3rd) -> DELAYED after every advance. Needs a calendar/period rule bea_events cannot express today |
| USCURACCT | Trade | Q | bea | `ITA Indicator=BalCurrAcct, AreaOrCountry=AllCountries, Frequency=QSA` | `bea:ita ⚠` | B NEW ADAPTER CODE | B;D;F | BEA ITA dataset: bea.py raises "dataset not implemented" for anything but NIPA (needs ITA API/keyed or ITA file path + QSA frequency); ITA indicator code unverified; bea:ita not a known calendar (BEA_RELEASES = GDP + PIO only); unverified: USCURACCT |
| USRETAILXA | Consumer | M | census | `marts/44Y72/SM` | `census:marts` | F OTHER | F | marts/44Y72 verified; inherits the open USRETAIL basis conflict (econ_export/MRTS DB vs marts_current Table 1 differ ~5%) - owner decision before presenting as advance retail sales |
| USRETAILCTRL | Consumer | M | derived | `sub(USRETAIL,USRETAILMV,USRETAILGAS,USRETAILBM,USRETAILFS)` | `census:marts` | D SOURCE CONFIRMATION | D;F | UCT-computed sub() (op supported): needs USRETAIL (COHORT, unverified) + USRETAILMV (LATER, unverified "441") + USRETAILGAS/BM/FS (LATER, disabled) onboarded; retail basis conflict; unverified: USRETAIL;USRETAILMV; needs first: USRETAIL(COHORT/unverified);USRETAILMV(LATER/unverified);USRETAILGAS(LATER/disabled);USRETAILBM(LATER/disabled);USRETAILFS(LATER/disabled) |
| USRETAILMOM | Consumer | M | derived | `mom_pct(USRETAIL)` | `census:marts` | D SOURCE CONFIRMATION | D;F | mom_pct over USRETAIL, itself still status=unverified (retail basis conflict); unverified: USRETAIL; needs first: USRETAIL(COHORT/unverified) |
| USRETCTRLMOM | Consumer | M | derived | `mom_pct(USRETAILCTRL)` | `census:marts` | D SOURCE CONFIRMATION | D;F | mom_pct over USRETAILCTRL (see above); unverified: USRETAIL;USRETAILMV; needs first: USRETAILCTRL(LAUNCH/unverified) |
| USPERMIT | Housing | M | census | `resconst/APERMITS/TOTAL` | `census:resconst` | A NO CODE | A |  |
| USNEWHOME | Housing | M | census | `ressales/ASOLD/TOTAL` | `census:ressales` | A NO CODE | A | ressales is in census EXPORT_PROGRAM; census:ressales calendar known |
| USNHMSUPPLY | Housing | M | census | `ressales/FORSALE/MONSUP` | `census:ressales` | A NO CODE | A | ressales data_type MONSUP |
| USCONSTSPD | Housing | M | census | `vip/AXXXX/T` | `census:vip` | A NO CODE | A | vip is in census EXPORT_PROGRAM |
| USCORECAPEX | Manufacturing & Business | M | census | `m3/NXA/NO` | `census:m3adv` | A NO CODE | A;F | calendar_key census:m3adv but params lack advance_program=advm3 (USDURGOODS has it) -> the advance-release event expects a month the full-M3 fetch lacks for ~1 week. Registry-param fix only |
| USFACTORD | Manufacturing & Business | M | census | `m3/MTM/NO` | `census:m3` | A NO CODE | A |  |
| USBUSINV | Manufacturing & Business | M | census | `mtis/TOTBUS/IM` | `census:mtis` | A NO CODE | A | mtis is in census EXPORT_PROGRAM; census:mtis calendar known |
| USBUSISR | Manufacturing & Business | M | census | `mtis/TOTBUS/IR` | `census:mtis` | A NO CODE | A | mtis ratio data_type IR |
| USEXPORTS | Trade | M | census | `ftd/BOPGS/EXP` | `census:ft900` | A NO CODE | A | ftd BOPGS/EXP, same program as enabled USTRADEBAL |
| USIMPORTS | Trade | M | census | `ftd/BOPGS/IMP` | `census:ft900` | A NO CODE | A | ftd BOPGS/IMP, same program as enabled USTRADEBAL |
| USGOODSBAL | Trade | M | census | `ftd/BOPG/BAL?` | `census:ft900` | D SOURCE CONFIRMATION | D | ftd/BOPG/BAL "?" - BOPG returned NA for Jan-2026; category/data_type unconfirmed; unverified: USGOODSBAL |
| USPRIME | Rates & Fed | D | fed_ddp | `H15/H15/RIFSPBLP_N.B` | `fed:h15` | A NO CODE | A |  |
| USDISCRATE | Rates & Fed | D | fed_ddp | `H15/H15/RIFSRP_F02_N.B` | `fed:h15` | A NO CODE | A |  |
| UST3M | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCM03_N.B` | `fed:h15` | A NO CODE | A | H.15 via existing fed_ddp; params.alt treasury_curve is an OPTIONAL authority upgrade (no treasury_curve module exists) - not required |
| UST6M | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCM06_N.B` | `fed:h15` | A NO CODE | A | as UST3M (alt treasury_curve optional) |
| UST1Y | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCY01_N.B` | `fed:h15` | A NO CODE | A | as UST3M (alt treasury_curve optional) |
| UST5Y | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCY05_N.B` | `fed:h15` | A NO CODE | A | as UST3M (alt treasury_curve optional) |
| UST30Y | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCY30_N.B` | `fed:h15` | A NO CODE | A | as UST3M (alt treasury_curve optional) |
| UST5YTIPS | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCY05_XII_N.B` | `fed:h15` | A NO CODE | A |  |
| UST10YTIPS | Rates & Fed | D | fed_ddp | `H15/H15/RIFLGFCY10_XII_N.B` | `fed:h15` | A NO CODE | A |  |
| UST10Y3M | Rates & Fed | D | derived | `spread(UST10Y,UST3M)` | `fed:h15` | A NO CODE | A | needs first: UST3M(LAUNCH/disabled) |
| UST10YBE | Rates & Fed | D | derived | `spread(UST10Y,UST10YTIPS)` | `fed:h15` | A NO CODE | A | needs first: UST10YTIPS(LAUNCH/disabled) |
| UST5YBE | Rates & Fed | D | derived | `spread(UST5Y,UST5YTIPS)` | `fed:h15` | A NO CODE | A | needs first: UST5Y(LAUNCH/disabled);UST5YTIPS(LAUNCH/disabled) |
| USFEDUST | Money & Liquidity | W | fed_ddp | `H41/H41/RESPPALGUO_N.WW` | `fed:h41` | A NO CODE | A |  |
| USRESBAL | Money & Liquidity | W | fed_ddp | `H41/H41/RESH4R_N.WW` | `fed:h41` | A NO CODE | A |  |
| USTGAFED | Money & Liquidity | W | fed_ddp | `H41/H41/RESPPLLDT_N.WW` | `fed:h41` | A NO CODE | A |  |
| USM1 | Money & Liquidity | M | fed_ddp | `H6/H6_M1/M1.M` | `fed:h6` | A NO CODE | A | dataset H6_M1 - confirm the Board dataset id (cf. the H6 -> H6_M2 correction) |
| USMONBASE | Money & Liquidity | M | fed_ddp | `H6/H6_MBASE/RESMO14A_N.M` | `fed:h6` | D SOURCE CONFIRMATION | D | H6_MBASE units unverified; unverified: USMONBASE |
| USM2YOY | Money & Liquidity | M | derived | `yoy_pct(USM2)` | `fed:h6` | A NO CODE | A |  |
| USBANKCRED | Credit & Banking | W | fed_ddp | `H8/H8/B1001NCBA` | `fed:h8 ⚠` | F OTHER | F | fed_ddp is release-agnostic (FRB_H8_xml.zip exists, 8.4 MB); fed:h8 has no calendar |
| USCILOANS | Credit & Banking | W | fed_ddp | `H8/H8/B1023NCBA` | `fed:h8 ⚠` | F OTHER | F | fed_ddp release-agnostic; fed:h8 has no calendar |
| USDEPOSITS | Credit & Banking | M | fed_ddp | `H8/H8/B1058NCBAM` | `fed:h8 ⚠` | D SOURCE CONFIRMATION | D;F | H.8 monthly mnemonic B1058NCBAM unverified ("weekly variant only"); fed:h8 no calendar; unverified: USDEPOSITS |
| USCONSCRED | Credit & Banking | M | fed_ddp | `G19/CCOUT/DTCTL.M` | `fed:g19 ⚠` | F OTHER | F | fed_ddp release-agnostic (G.19 release zip exists); fed:g19 has no calendar (G.19 RSS arrivals exist, no schedule) |
| USCONSCREDCHG | Credit & Banking | M | derived | `diff(USCONSCRED)` | `fed:g19 ⚠` | F OTHER | F | diff over USCONSCRED; inherits the fed:g19 calendar gap; needs first: USCONSCRED(LAUNCH/disabled) |
| USMFGPROD | Manufacturing & Business | M | fed_ddp | `G17/IP_MAJOR_INDUSTRY_GROUPS/IP.GMF.S` | `fed:g17` | A NO CODE | A |  |
| USCAPUTIL | Manufacturing & Business | M | fed_ddp | `G17/CAPUTL/CAPUTL.B50001.S` | `fed:g17` | A NO CODE | A |  |
| USDOLLARIDX | Trade | D | fed_ddp | `H10/H10/JRXWTFB_N.B` | `fed:h10 ⚠` | D SOURCE CONFIRMATION | D;F | fed_ddp release-agnostic (H.10 release zip exists); start date unverified; fed:h10 has no calendar; unverified: USDOLLARIDX |
| USSCEINF1Y | Inflation & Prices | M | regional_fed_file | `SCE chart-data xlsx (Inflation expectations, 1-yr median)` | `nyfed:sce ⚠` | B NEW ADAPTER CODE | B;D;F | no regional_fed_file adapter (NY Fed SCE chart-data xlsx); column unverified; nyfed:sce not a known calendar; unverified: USSCEINF1Y |
| USTIC | Trade | M | treasury_tic | `treasury.gov/resource-center/data-chart-center/tic mfh.txt (Grand Total)` | `treasury:tic ⚠` | B NEW ADAPTER CODE | B;D;F | no treasury_tic adapter (mfh.txt text table); row unverified; treasury:tic not a known calendar; unverified: USTIC |
| USIORB | Rates & Fed | D | fed_policy | `(no DDP mnemonic found in H.15 package)` | `fed:policy ⚠` | B NEW ADAPTER CODE | B;D;F | no fed_policy adapter (no DDP mnemonic; IORB page / FOMC implementation note); fed:policy not a known calendar; unverified: USIORB |
| USDEBTPUB | Government & Fiscal | D | fiscaldata | `v2/accounting/od/debt_to_penny : debt_held_public_amt` | `fiscal:dtp` | A NO CODE | A | same debt_to_penny shape as enabled USDEBT |
| USMTSREC | Government & Fiscal | M | fiscaldata | `v1/accounting/mts/mts_table_1 : current_month_gross_rcpt_amt` | `fiscal:mts` | A NO CODE | A | same mts_table_1 shape as enabled USMTSDEF |
| USMTSOUT | Government & Fiscal | M | fiscaldata | `v1/accounting/mts/mts_table_1 : current_month_gross_outly_amt` | `fiscal:mts` | A NO CODE | A | same mts_table_1 shape as enabled USMTSDEF |
| USMTSINT | Government & Fiscal | M | fiscaldata | `v1/accounting/mts/mts_table_5 : 'Interest on Treasury Debt Securities (Gross)' current_month_gross_outly_amt?` | `fiscal:mts` | B NEW ADAPTER CODE | B;D | mts_table_5 without row_key falls into the fiscaldata DAILY path -> period_start=period_end=record_date, which validate.py rejects for M (needs month bounds); table-5 row label unverified (alt v2/accounting/od/interest_expense needs the same monthly shape); unverified: USMTSINT |
| USDEFICIT12M | Government & Fiscal | M | derived | `sum(USMTSDEF)` | `fiscal:mts` | A NO CODE | A | sum n=12 over enabled USMTSDEF |
| USSPR | Energy | W | eia | `PET.WCSSTUS1.W` | `eia:wpsr` | A NO CODE | A |  |
| USCRUDEPROD | Energy | W | eia | `PET.WCRFPUS2.W` | `eia:wpsr` | A NO CODE | A |  |
| USGASINV | Energy | W | eia | `PET.WGTSTUS1.W` | `eia:wpsr` | A NO CODE | A | ID verified; history_start "?" only - confirm at backfill |
| USDISTINV | Energy | W | eia | `PET.WDISTUS1.W` | `eia:wpsr` | A NO CODE | A |  |
| USREFUTIL | Energy | W | eia | `PET.WPULEUS3.W` | `eia:wpsr` | A NO CODE | A | ID verified; history_start "?" only - confirm at backfill |
| USDIESELPRICE | Energy | W | eia | `PET.EMD_EPD2D_PTE_NUS_DPG.W` | `eia:gasdiesel` | A NO CODE | A |  |
| USNATGASSTOR | Energy | W | eia | `NG.NW2_EPG0_SWO_R48_BCF.W` | `eia:ngs ⚠` | D SOURCE CONFIRMATION | D;F | eia adapter is generic over <NS>.<CODE>.<F> (dnav/ng LeafHandler) but only PET routes were proven live; ID unverified; eia:ngs not a known calendar (Thu 10:30 rule missing); unverified: USNATGASSTOR |
| USNATGASCHG | Energy | W | derived | `diff(USNATGASSTOR)` | `eia:ngs ⚠` | D SOURCE CONFIRMATION | D;F | diff over unverified USNATGASSTOR; eia:ngs calendar gap; unverified: USNATGASSTOR; needs first: USNATGASSTOR(LAUNCH/unverified) |
| USCRUDEINVCHG | Energy | W | derived | `diff(USCRUDEINV)` | `eia:wpsr` | A NO CODE | A |  |
| USFHFAHPIYOY | Housing | M | derived | `yoy_pct(USFHFAHPI)` | `fhfa:hpi_monthly` | A NO CODE | A | yoy_pct over enabled USFHFAHPI |

⚠ = calendar_key not in `calendar.KNOWN_CALENDARS`.
