# Economic Data Phase 1 — cohort census (real local backfill)

Generated from `C:\w\econ1-data\econ.db` (local, keyless, no R2) by `C:\w\econ1-data\tools\census.py` + `census_md.py` after the cohort backfill (non-BLS full history; BLS 2017+ so far, see §5), a day of live polls by the local service, and its currentness evaluation. Machine-readable copy: `COHORT-CENSUS.csv`. Times are America/New_York.

Columns: *count* = periods in the latest view; *NA* = provider-stated missing periods kept as `null`; *latest avail.* = the newest period's FIRST availability (where the point is placed) and the vintage's `available_method`; *PIT V/U/L/X* = classes over the latest view; *src pub.* = the provider publication time carried by the last validated fetch (`series_ops.last_published_at`), blank when the provider states none.

## 1. Registry entries (43 = 41 member cohort + parents USCORECPINSA, USGDP)

| symbol | status | adapter | provider id | freq | units raw → display (fmt, scale) | oldest | newest | count | NA | latest value | latest avail. (method) | src pub. | PIT V/U/L/X | revision | validation | currentness |
|---|---|---|---|---|---|---|---|---:|---:|---:|---|---|---|---|---|---|
| USCPI | enabled | bls | CUSR0000SA0 | M | Index 1982-84=100 → index (num3, 1) | 2017-01-01 | 2026-08-01 | 116 | 1 | 334.131 | 2026-09-25 08:30 ET (rule) |  | 0/0/116/0 | seasonal_factor_revision | no rejections | CURRENT |
| USCPINSA | enabled | bls | CUUR0000SA0 | M | Index 1982-84=100 → index (num3, 1) | 2017-01-01 | 2026-08-01 | 116 | 1 | 334.98 | 2026-09-25 08:30 ET (rule) |  | 0/116/0/0 | none | no rejections | CURRENT |
| USCORECPI | enabled | bls | CUSR0000SA0L1E | M | Index 1982-84=100 → index (num3, 1) | 2017-01-01 | 2026-08-01 | 116 | 1 | 337.765 | 2026-09-25 08:30 ET (rule) |  | 0/0/116/0 | seasonal_factor_revision | no rejections | CURRENT |
| USCORECPINSA | enabled | bls | CUUR0000SA0L1E | M | Index 1982-84=100 → index (num3, 1) | 2017-01-01 | 2026-08-01 | 116 | 1 | 338.041 | 2026-09-25 08:30 ET (rule) |  | 0/116/0/0 | none | no rejections | CURRENT |
| USCPIYOY | enabled | derived | yoy_pct(USCPINSA) | M | Percent → % (pct1, 1) | 2018-01-01 | 2026-08-01 | 104 | 1 | 3.39655 | 2026-09-25 08:30 ET (derived:yoy_pct@1) |  | 0/104/0/0 | none | no rejections | CURRENT |
| USCPIMOM | enabled | derived | mom_pct(USCPI) | M | Percent → % (pct1, 1) | 2017-02-01 | 2026-08-01 | 115 | 2 | 0.396018 | 2026-09-25 08:30 ET (derived:mom_pct@1) |  | 0/0/115/0 | seasonal_factor_revision | no rejections | CURRENT |
| USCORECPIYOY | enabled | derived | yoy_pct(USCORECPINSA) | M | Percent → % (pct1, 1) | 2018-01-01 | 2026-08-01 | 104 | 1 | 2.44598 | 2026-09-25 08:30 ET (derived:yoy_pct@1) |  | 0/104/0/0 | none | no rejections | CURRENT |
| USPPIFD | enabled | bls | WPSFD4 | M | Index Nov 2009=100 → index (num3, 1) | 2017-01-01 | 2026-08-01 | 116 | 0 | 157.411 (p) | 2026-09-25 08:30 ET (rule) |  | 0/0/116/0 | seasonal_factor_revision | no rejections | CURRENT |
| USECI | enabled | bls | CIS1010000000000Q | Q | Percent change, 3-month → % (pct1, 1) | 2017-01-01 | 2026-04-01 | 38 | 0 | 0.9 | 2026-08-04 08:30 ET (rule) |  | 0/0/38/0 | seasonal_factor_revision | no rejections | CURRENT |
| USUNRATE | enabled | bls | LNS14000000 | M | Percent → % (pct1, 1) | 2017-01-01 | 2026-08-01 | 116 | 1 | 4.1 | 2026-09-12 08:30 ET (rule) |  | 0/0/116/0 | seasonal_factor_revision | no rejections | CURRENT |
| USNFP | enabled | bls | CES0000000001 | M | Thousands of jobs → persons (k_persons, 1000) | 2017-01-01 | 2026-08-01 | 116 | 0 | 159,075 (p) | 2026-09-12 08:30 ET (rule) |  | 0/0/116/0 | annual_benchmark | no rejections | CURRENT |
| USNFPCHG | enabled | derived | diff(USNFP) | M | Thousands of jobs → persons (k_persons, 1000) | 2017-02-01 | 2026-08-01 | 115 | 0 | 162 | 2026-09-12 08:30 ET (derived:diff@1) |  | 0/0/115/0 | annual_benchmark | no rejections | CURRENT |
| USJOLTSO | enabled | bls | JTS000000000000000JOL | M | Thousands → persons (k_persons, 1000) | 2017-01-01 | 2026-08-01 | 116 | 0 | 7,079 (p) | 2026-09-29 10:00 ET (scheduled) |  | 2/0/114/0 | annual_benchmark | no rejections | CURRENT |
| USICSA | enabled | dol | DOL ETA r539cy national InitialClaims/SA (history XML) + weekly news r | W/SAT | Number of claims → count (num0, 1) | 1967-01-01 | 2026-09-13 | 3116 | 0 | 197,000 (a) | 2026-09-25 08:30 ET (rule) | 2026-09-24 08:30 ET | 0/0/3116/0 | seasonal_factor_revision | no rejections | CURRENT |
| USGDP | enabled | bea | NIPA T10105 L1 (A191RC) | Q | Millions USD, SAAR → USD (usd_compact, 1000000) | 1947-01-01 | 2026-04-01 | 318 | 0 | 32,486,066.00 | 2026-08-01 08:30 ET (rule) | 2026-08-26 08:30 ET | 0/0/318/0 | comprehensive | no rejections | CURRENT |
| USRGDP | enabled | bea | NIPA T10106 L1 (A191RX) | Q | Millions chained 2017 USD, SAAR → USD (usd_compact, 1000000) | 1947-01-01 | 2026-04-01 | 318 | 0 | 24,269,613.00 | 2026-08-01 08:30 ET (rule) | 2026-08-26 08:30 ET | 0/0/318/0 | comprehensive | no rejections | CURRENT |
| USRGDPQA | enabled | bea | NIPA T10101 L1 (A191RL) | Q | Percent, annualized → % (pct1, 1) | 1947-04-01 | 2026-04-01 | 317 | 0 | 1.5 | 2026-08-01 08:30 ET (rule) | 2026-08-26 08:30 ET | 0/0/317/0 | comprehensive | no rejections | CURRENT |
| USPCEPI | enabled | bea | NIPA T20804 L1 (DPCERG) | M | Index 2017=100 → index (num3, 1) | 1959-01-01 | 2026-07-01 | 811 | 0 | 131.659 | 2026-09-04 08:30 ET (rule) | 2026-08-26 08:30 ET | 0/0/811/0 | comprehensive | no rejections | CURRENT |
| USCOREPCE | enabled | bea | NIPA T20804 L25 (DPCCRG) | M | Index 2017=100 → index (num3, 1) | 1959-01-01 | 2026-07-01 | 811 | 0 | 130.658 | 2026-09-04 08:30 ET (rule) | 2026-08-26 08:30 ET | 0/0/811/0 | comprehensive | no rejections | CURRENT |
| USPCEPIYOY | enabled | derived | yoy_pct(USPCEPI) | M | Percent → % (pct1, 1) | 1960-01-01 | 2026-07-01 | 799 | 0 | 3.70117 | 2026-09-04 08:30 ET (derived:yoy_pct@1) |  | 0/0/799/0 | comprehensive | no rejections | CURRENT |
| USRETAIL | unverified | census | marts/44X72/SM | M | Millions USD → USD (usd_compact, 1000000) |  |  | 0 | 0 |  |  |  | 0/0/0/0 | seasonal_factor_revision | no rejections |  |
| USHOUST | enabled | census | resconst/ASTARTS/TOTAL | M | Thousands of units, SAAR → units (num0, 1000) | 1959-01-01 | 2026-08-01 | 812 | 0 | 1,275 (p) | 2026-09-22 08:30 ET (rule) |  | 0/0/812/0 | seasonal_factor_revision | no rejections | CURRENT |
| USDURGOODS | enabled | census | m3/MDM/NO | M | Millions USD → USD (usd_compact, 1000000) | 1992-02-01 | 2026-08-01 | 415 | 0 | 338,604 (a) | 2026-09-28 22:41 ET (rule) |  | 0/0/415/0 | seasonal_factor_revision | no rejections | CURRENT |
| USTRADEBAL | enabled | census | ftd/BOPGS/BAL | M | Millions USD → USD (usd_compact, 1000000) | 1994-01-01 | 2026-07-01 | 391 | 0 | -88,576 | 2026-09-11 08:30 ET (rule) |  | 0/0/391/0 | seasonal_factor_revision | no rejections | CURRENT |
| UST2Y | enabled | fed_ddp | H15/H15/RIFLGFCY02_N.B | D | Percent → % (pct2, 1) | 1976-06-01 | 2026-09-25 | 13129 | 552 | 4.81 | 2026-09-28 16:15 ET (rule) |  | 0/13129/0/0 | none | no rejections | CURRENT |
| UST10Y | enabled | fed_ddp | H15/H15/RIFLGFCY10_N.B | D | Percent → % (pct2, 1) | 1962-01-02 | 2026-09-25 | 16889 | 720 | 5.17 | 2026-09-28 16:15 ET (rule) |  | 0/16889/0/0 | none | no rejections | CURRENT |
| UST10Y2Y | enabled | derived | spread(UST10Y, UST2Y) | D | Percentage points → pp (pp2, 1) | 1976-06-01 | 2026-09-25 | 13129 | 552 | 0.36 | 2026-09-28 16:15 ET (derived:spread@1) |  | 0/13129/0/0 | none | no rejections | CURRENT |
| USFEDBAL | enabled | fed_ddp | H41/H41/RESPPMA_N.WW | W/WED | Millions USD → USD (usd_compact, 1000000) | 2002-12-12 | 2026-09-17 | 1241 | 0 | 6,747,704.00 | 2026-09-25 16:30 ET (rule) |  | 0/1241/0/0 | none | no rejections | CURRENT |
| USM2 | enabled | fed_ddp | H6/H6_M2/M2.M | M | Billions USD → USD (usd_compact, 1000000000) | 1959-01-01 | 2026-08-01 | 812 | 0 | 23,342.8 | 2026-09-28 22:40 ET (rule) |  | 0/0/812/0 | seasonal_factor_revision | no rejections | CURRENT |
| USINDPRO | enabled | fed_ddp | G17/IP_MARKET_GROUPS/IP.B50001.S | M | Index 2017=100 → index (num1, 1) | 1919-01-01 | 2026-08-01 | 1292 | 0 | 103.068 | 2026-09-20 09:15 ET (rule) |  | 0/0/1292/0 | annual_benchmark | no rejections | CURRENT |
| USEFFR | enabled | nyfed | /api/rates/unsecured/effr (percentRate) | D | Percent → % (pct2, 1) | 2016-03-01 | 2026-09-28 | 2658 | 0 | 3.88 | 2026-09-29 09:00 ET (scheduled) |  | 1/0/2657/0 | minor_routine | no rejections | CURRENT |
| USFEDFUNDSU | enabled | nyfed | /api/rates/unsecured/effr (targetRateTo) | D | Percent → % (pct2, 1) | 2008-12-16 | 2026-09-28 | 4468 | 0 | 4 | 2026-09-29 09:00 ET (scheduled) |  | 1/4467/0/0 | none | no rejections | CURRENT |
| USFEDFUNDSL | enabled | nyfed | /api/rates/unsecured/effr (targetRateFrom) | D | Percent → % (pct2, 1) | 2008-12-16 | 2026-09-28 | 4468 | 0 | 3.75 | 2026-09-29 09:00 ET (scheduled) |  | 1/4467/0/0 | none | no rejections | CURRENT |
| USSOFR | enabled | nyfed | /api/rates/secured/sofr (percentRate) | D | Percent → % (pct2, 1) | 2018-04-02 | 2026-09-28 | 2121 | 0 | 3.9 | 2026-09-29 08:00 ET (scheduled) |  | 1/0/2120/0 | minor_routine | no rejections | CURRENT |
| USRRP | enabled | nyfed | /api/rp/results/search.json (Reverse Repo, Overnight, primary op: tota | D | USD → USD (usd_compact, 1) | 2013-09-23 | 2026-09-28 | 3250 | 0 | 851,000,000.00 | 2026-09-28 14:00 ET (rule) |  | 0/3250/0/0 | none | no rejections | CURRENT |
| USEMPIRE | enabled | nyfed_esms | esms_seasonallyadjusted_diffusion.csv:GACDISA | M | Diffusion index → index (num1, 1) | 2001-07-01 | 2026-09-01 | 303 | 0 | 7.6 | 2026-09-18 08:30 ET (rule) |  | 0/0/303/0 | seasonal_factor_revision | no rejections | CURRENT |
| USDEBT | enabled | fiscaldata | v2/accounting/od/debt_to_penny : tot_pub_debt_out_amt | D | USD → USD (usd_compact, 1) | 1993-04-01 | 2026-09-25 | 8401 | 0 | 40,097,178,119,750.91 | 2026-09-28 17:00 ET (rule) |  | 0/8401/0/0 | none | no rejections | CURRENT |
| USTGA | enabled | fiscaldata | v1/accounting/dts/operating_cash_balance : account_type='Treasury Gene | D | Millions USD → USD (usd_compact, 1000000) | 2005-10-03 | 2026-09-25 | 5271 | 0 | 945,290 | 2026-09-28 17:00 ET (rule) |  | 0/5271/0/0 | none | no rejections | CURRENT |
| USMTSDEF | enabled | fiscaldata | v1/accounting/mts/mts_table_1 : current_month_dfct_sur_amt (record_typ | M | USD → USD (usd_compact, 1) | 2013-10-01 | 2026-08-01 | 155 | 0 | 166,796,952,277.38 | 2026-09-15 14:00 ET (rule) |  | 0/0/155/0 | annual_benchmark | no rejections | CURRENT |
| USDEBTGDP | enabled | derived | ratio_pct(USDEBT, USGDP) | Q | Percent of GDP → % (pct1, 1) | 1993-04-01 | 2026-04-01 | 133 | 0 | 121.475 | 2026-08-01 08:30 ET (derived:ratio_pct@1) |  | 0/0/133/0 | comprehensive | no rejections | CURRENT |
| USCRUDEINV | enabled | eia | PET.WCESTUS1.W | W/FRI | Thousand barrels → bbl (mbbl, 1000) | 1982-08-14 | 2026-09-12 | 2295 | 0 | 426,398 | 2026-09-24 11:00 ET (rule) | 2026-09-23 11:48 ET | 0/0/2295/0 | minor_routine | no rejections | CURRENT |
| USGASPRICE | enabled | eia | PET.EMM_EPMR_PTE_NUS_DPG.W | W/MON | USD per gallon → USD/gal (usd3, 1) | 1990-08-14 | 2026-09-22 | 1885 | 6 | 4.465 | 2026-09-29 10:00 ET (scheduled) | 2026-09-29 08:45 ET | 1/0/1884/0 | minor_routine | no rejections | CURRENT |
| USFHFAHPI | enabled | fhfa | hpi_master.csv: traditional / purchase-only / monthly / 'USA or Census | M | Index Jan 1991=100 → index (num2, 1) | 1991-01-01 | 2026-07-01 | 427 | 0 | 443.52 | 2026-09-29 09:00 ET (scheduled) |  | 24/0/403/0 | comprehensive | no rejections | CURRENT |

### Units / frequency verification notes

- **USCPI** (M, Index 1982-84=100): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USCPINSA** (M, Index 1982-84=100): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USCORECPI** (M, Index 1982-84=100): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USCORECPINSA** (M, Index 1982-84=100): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USCPIYOY** (M, Percent): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USCPINSA
- **USCPIMOM** (M, Percent): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USCPI
- **USCORECPIYOY** (M, Percent): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USCORECPINSA
- **USPPIFD** (M, Index Nov 2009=100): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USECI** (Q, Percent change, 3-month): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USUNRATE** (M, Percent): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USNFP** (M, Thousands of jobs): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USNFPCHG** (M, Thousands of jobs): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USNFP
- **USJOLTSO** (M, Thousands): BLS v1 keyless; series id echoed in payload == requested (identity); units from registry, BLS gives none (index base checked vs Phase 0 values)
- **USICSA** (W/SAT, Number of claims): r539cy XML (history) + press PDF advance week, PDF cross-validated vs prose, table and XML seasonal factor (dol.txt)
- **USGDP** (Q, Millions USD, SAAR): NIPA flat file; SeriesRegister code/table/line + DefaultScale (-6 = millions) CONFIRMED (bea.txt)
- **USRGDP** (Q, Millions chained 2017 USD, SAAR): NIPA flat file; SeriesRegister code/table/line + DefaultScale (-6 = millions) CONFIRMED (bea.txt)
- **USRGDPQA** (Q, Percent, annualized): NIPA flat file; SeriesRegister code/table/line + DefaultScale (-6 = millions) CONFIRMED (bea.txt)
- **USPCEPI** (M, Index 2017=100): NIPA flat file; SeriesRegister code/table/line + DefaultScale (-6 = millions) CONFIRMED (bea.txt)
- **USCOREPCE** (M, Index 2017=100): NIPA flat file; SeriesRegister code/table/line + DefaultScale (-6 = millions) CONFIRMED (bea.txt)
- **USPCEPIYOY** (M, Percent): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USPCEPI
- **USRETAIL** (M, Millions USD): econ_export CSV; program/category/data_type/time-slot identity checked by adapter
- **USHOUST** (M, Thousands of units, SAAR): econ_export CSV; program/category/data_type/time-slot identity checked by adapter
- **USDURGOODS** (M, Millions USD): econ_export CSV; program/category/data_type/time-slot identity checked by adapter
- **USTRADEBAL** (M, Millions USD): econ_export CSV; program/category/data_type/time-slot identity checked by adapter
- **UST2Y** (D, Percent): release-page SDMX: mnemonic in dataset + UNIT/UNIT_MULT/CURRENCY vs registry units.raw (fail closed)
- **UST10Y** (D, Percent): release-page SDMX: mnemonic in dataset + UNIT/UNIT_MULT/CURRENCY vs registry units.raw (fail closed)
- **UST10Y2Y** (D, Percentage points): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs UST10Y,UST2Y
- **USFEDBAL** (W/WED, Millions USD): release-page SDMX: mnemonic in dataset + UNIT/UNIT_MULT/CURRENCY vs registry units.raw (fail closed)
- **USM2** (M, Billions USD): release-page SDMX: mnemonic in dataset + UNIT/UNIT_MULT/CURRENCY vs registry units.raw (fail closed)
- **USINDPRO** (M, Index 2017=100): release-page SDMX: mnemonic in dataset + UNIT/UNIT_MULT/CURRENCY vs registry units.raw (fail closed)
- **USEFFR** (D, Percent): markets API: path + field identity; percent / USD checked
- **USFEDFUNDSU** (D, Percent): markets API: path + field identity; percent / USD checked
- **USFEDFUNDSL** (D, Percent): markets API: path + field identity; percent / USD checked
- **USSOFR** (D, Percent): markets API: path + field identity; percent / USD checked
- **USRRP** (D, USD): markets API: path + field identity; percent / USD checked
- **USEMPIRE** (M, Diffusion index): ESMS CSV column GACDISA (SA diffusion) identity
- **USDEBT** (D, USD): fiscaldata API: dataset + field + label-era filters; weekend rows 0
- **USTGA** (D, Millions USD): fiscaldata API: dataset + field + label-era filters; weekend rows 0
- **USMTSDEF** (M, USD): fiscaldata API: dataset + field + label-era filters; weekend rows 0
- **USDEBTGDP** (Q, Percent of GDP): UCT calculation from stored inputs (derive.py); PIT = weakest input; available_at = max(input available_at); inputs USDEBT,USGDP
- **USCRUDEINV** (W/FRI, Thousand barrels): dnav leaf page; series code + unit string checked (Thousand Barrels / Dollars per Gallon)
- **USGASPRICE** (W/MON, USD per gallon): dnav leaf page; series code + unit string checked (Thousand Barrels / Dollars per Gallon)
- **USFHFAHPI** (M, Index Jan 1991=100): hpi_master.csv row filter (traditional/purchase-only/monthly/USA) + index_sa column

## 2. Derived series and their inputs

| symbol | op(inputs) | count | newest | latest value | independent recomputation from stored inputs | secondary |
|---|---|---:|---|---:|---:|---|
| USCPIYOY | yoy_pct(USCPINSA) | 104 | 2026-08-01 | 3.39655 | 3.39655 | 100*(USCPINSA/USCPINSA[-12m]-1) |
| USCPIMOM | mom_pct(USCPI) | 115 | 2026-08-01 | 0.396018 | 0.396018 | 100*(USCPI/USCPI[-1m]-1) |
| USCORECPIYOY | yoy_pct(USCORECPINSA) | 104 | 2026-08-01 | 2.44598 | 2.44598 | 100*(USCORECPINSA/USCORECPINSA[-12m]-1) |
| USNFPCHG | diff(USNFP) | 115 | 2026-08-01 | 162 | 162 | USNFP - USNFP[-1m] |
| USPCEPIYOY | yoy_pct(USPCEPI) | 799 | 2026-07-01 | 3.70117 |  | BEA BPCERO (T20811 L32) published 1dp, see full-series check |
| UST10Y2Y | spread(UST10Y, UST2Y) | 13129 | 2026-09-25 | 0.36 | 0.36 | UST10Y-UST2Y from store; Treasury par curve 09/25: 5.17-4.81=0.36 (fed_ddp.txt §4) |
| USDEBTGDP | ratio_pct(USDEBT, USGDP) | 133 | 2026-04-01 | 121.475 | 121.475 | 100*USDEBT[2026-06-30]/(USGDP*1e6) |

USPCEPIYOY full-series check vs BEA's own published *percent change from month one year ago* (`BPCERO`, NIPA T20811 line 32, same NipaDataM.txt payload, 1 dp): **799 months compared, 0 mismatches after rounding to 1 dp**, max |UCT − BEA| = 0.0499 (i.e. rounding only).

## 3. Latest-value verification (newest stored vs live adapter verification and Phase 0)

| symbol | period | stored (as-of 2026-09-29 03:20Z) | verification (file) | result | Phase 0 (proofs.md) | Phase 0 result / note |
|---|---|---:|---:|---|---:|---|
| USCPI | 2026-08-01 | 334.131 | 334.131 (bls.txt) | **MATCH** | 334.131 | MATCH |
| USCPINSA | 2026-08-01 | 334.98 | 334.98 (bls.txt) | **MATCH** | 334.98 | MATCH |
| USCORECPI | 2026-08-01 | 337.765 | 337.765 (bls.txt) | **MATCH** | 337.765 | MATCH |
| USCORECPINSA | 2026-08-01 | 338.041 | 338.041 (bls.txt) | **MATCH** | — |  |
| USPPIFD | 2026-08-01 | 157.411 | 157.411 (bls.txt) | **MATCH** | — |  |
| USECI | 2026-04-01 | 0.9 | 0.9 (bls.txt) | **MATCH** | — |  |
| USUNRATE | 2026-08-01 | 4.1 | 4.1 (bls.txt) | **MATCH** | 4.1 | MATCH |
| USNFP | 2026-08-01 | 159,075 | 159,075 (bls.txt) | **MATCH** | 159,075 | MATCH |
| USJOLTSO | 2026-07-01 | 7,271 | 7,271 (bls.txt) | **MATCH** | — |  newer period now held: 2026-08-01 = 7079; 2026-07-01 REVISED since (live 09-29 release): now 7335 |
| USGDP | 2026-04-01 | 32,486,066.00 | 32,486,066.00 (bea.txt) | **MATCH** | — |  |
| USRGDP | 2026-04-01 | 24,269,613.00 | 24,269,613.00 (bea.txt) | **MATCH** | 24,269,613.00 | MATCH |
| USRGDPQA | 2026-04-01 | 1.5 | 1.5 (bea.txt) | **MATCH** | 1.5 | MATCH |
| USPCEPI | 2026-07-01 | 131.659 | 131.659 (bea.txt) | **MATCH** | 131.659 | MATCH |
| USCOREPCE | 2026-07-01 | 130.658 | 130.658 (bea.txt) | **MATCH** | 130.658 | MATCH |
| USHOUST | 2026-08-01 | 1,275 | 1,275 (census.txt) | **MATCH** | 1,275 | MATCH |
| USDURGOODS | 2026-08-01 | 338,604 | 338,604 (census.txt) | **MATCH** | — |  |
| USTRADEBAL | 2026-07-01 | -88,576 | -88,576 (census.txt) | **MATCH** | — |  |
| USICSA | 2026-09-13 | 197,000 | 197,000 (dol.txt) | **MATCH** | 197,000 | MATCH |
| USCRUDEINV | 2026-09-12 | 426,398 | 426,398 (eia.txt) | **MATCH** | 426,398 | MATCH |
| USGASPRICE | 2026-09-15 | 4.478 | 4.478 (eia.txt) | **MATCH** | — |  newer period now held: 2026-09-22 = 4.465 |
| UST2Y | 2026-09-25 | 4.81 | 4.81 (fed_ddp.txt) | **MATCH** | — |  |
| UST10Y | 2026-09-25 | 5.17 | 5.17 (fed_ddp.txt) | **MATCH** | 5.17 | MATCH |
| USFEDBAL | 2026-09-17 | 6,747,704.00 | 6,747,704.00 (fed_ddp.txt) | **MATCH** | 6,747,704.00 | MATCH |
| USM2 | 2026-08-01 | 23,342.8 | 23,342.8 (fed_ddp.txt) | **MATCH** | 23,342.8 | MATCH |
| USINDPRO | 2026-08-01 | 103.068 | 103.068 (fed_ddp.txt) | **MATCH** | 103.068 | MATCH |
| USEFFR | 2026-09-25 | 3.88 | 3.88 (nyfed.txt) | **MATCH** | 3.88 | MATCH newer period now held: 2026-09-28 = 3.88 |
| USFEDFUNDSU | 2026-09-25 | 4 | 4 (nyfed.txt) | **MATCH** | 4 | MATCH newer period now held: 2026-09-28 = 4 |
| USFEDFUNDSL | 2026-09-25 | 3.75 | 3.75 (nyfed.txt) | **MATCH** | 3.75 | MATCH newer period now held: 2026-09-28 = 3.75 |
| USSOFR | 2026-09-25 | 3.9 | 3.9 (nyfed.txt) | **MATCH** | 3.9 | MATCH newer period now held: 2026-09-28 = 3.9 |
| USRRP | 2026-09-28 | 851,000,000.00 | 851,000,000.00 (nyfed.txt) | **MATCH** | 851,000,000.00 | MATCH |
| USEMPIRE | 2026-09-01 | 7.6 | 7.6 (nyfed.txt) | **MATCH** | — |  |
| USDEBT | 2026-09-25 | 40,097,178,119,750.91 | 40,097,178,119,750.91 (fiscaldata.txt) | **MATCH** | 40,097,178,119,750.91 | MATCH |
| USTGA | 2026-09-25 | 945,290 | 945,290 (fiscaldata.txt) | **MATCH** | 945,290 | MATCH |
| USMTSDEF | 2026-08-01 | 166,796,952,277.38 | 166,796,952,277.38 (fiscaldata.txt) | **MATCH** | 166,796,952,277.38 | MATCH |
| USFHFAHPI | 2026-06-01 | 442.53 | 442.53 (fhfa.txt) | **MATCH** | 442.53 | MATCH newer period now held: 2026-07-01 = 443.52; 2026-06-01 REVISED since (live 09-29 release): now 442.34 |

## 4. Independent secondary cross-check per adapter family

| family | secondary reference (independent of the stored payload) | result | evidence |
|---|---|---|---|
| BLS | Phase 0 FRED cross-check (CPIAUCSL 334.131, UNRATE 4.1, PAYEMS 159,075); manual FRED page read: PPIFIS 157.411, JTSJOL 7,271 | MATCH | verification/bls.txt analysis; proofs.md |
| BEA | Phase 0: A191RX 2026Q2 24,269,613 $M = FRED GDPC1 24,269.613 $bn; A191RL 1.5 = A191RL1Q225SBEA 1.5 | MATCH | verification/bea.txt; proofs.md |
| BEA (derived) | USPCEPIYOY vs BEA-published BPCERO (T20811 L32), every month 1960-01..2026-07 | MATCH (799/799 at 1 dp) | this census, section 2 |
| Census | USTRADEBAL Jul-2026 vs FT-900 exh1.xlsx (Jan-Jun identical too); USHOUST vs newresconst.xlsx | MATCH | verification/census.txt |
| Census USRETAIL | econ_export 737,763 vs marts_current.xlsx Table 1 773,947 | MISMATCH -> stays `unverified`, never ingested (refused by `ingest.backfill_refusal`) | verification/census.txt |
| DOL | advance week cross-validated in-adapter (prose, table, XML seasonal factor); FRED ICSA 09/19 197,000 (Phase 0) | MATCH | verification/dol.txt |
| EIA | USCRUDEINV vs ir.eia.gov table1.csv 426.398 MMbbl; USGASPRICE vs gasdiesel page + RSS 4.478 | MATCH | verification/eia.txt |
| Fed Board | release_xml vs DDP package (all 5 agree); UST2Y/UST10Y vs Treasury daily par curve 4.81/5.17 | MATCH | verification/fed_ddp.txt §2, §4 |
| Fed (derived) | UST10Y2Y 2026-09-25 0.36 vs Treasury par curve 10Y-2Y 5.17-4.81 = 0.36 | MATCH | verification/fed_ddp.txt §4 |
| NY Fed | EFFR vs H.15 RIFSPFF_N.B 3.88; FOMC 2026-09-17 target range 3.75-4.00; ESMS vs report prose 7.6 | MATCH | verification/nyfed.txt §4 |
| fiscaldata | MTS deficit = outlays - receipts from the same report; TGA label-era splices continuous | MATCH | verification/fiscaldata.txt |
| FHFA | index_nsa 452.26 == Phase 0 proof_log NSA | MATCH | verification/fhfa.txt |
| derived CPI/NFP/DEBTGDP | no published figure obtainable keylessly (BLS v1 has no `calculations`; www.bls.gov is Akamai-blocked and is not scraped around); recomputed independently from stored inputs | MATCH (recompute) | section 2 |

## 5. Failed closed, partial, and placement notes

- **USRETAIL — not ingested (by design).** Registry `status: unverified` (econ_export 737,763 vs `marts_current.xlsx`
  773,947 for Aug 2026, ~5 % on every month; owner decision pending). The cohort selector skips it and
  `ingest.backfill_refusal` refuses it even when named explicitly (`--backfill USRETAIL` → `REFUSED … status
  unverified`, exit 1, 0 rows). No other series failed validation on real history: **0 `validation_event` rows** across
  the whole backfill + a day of live polls (weekend daily rows 0, NA markers kept as `null`, revision windows not hit).
- **BLS history is partial: 2017-01 → 2026-08 only** (9 series, 965 rows from ONE keyless v1 query by the service at
  09:11 ET). The 1913–2016 windows (11 queries) are queued in `C:\w\econ1-data\tools\bls_backfill_when_ready.py`
  (running; one window per 10 min after 15:00Z, pauses 3 h on any quota refusal). BLS refused the 4th query at
  00:11 ET and 03:11 ET — see PERFORMANCE.md §1a. Re-run `census.py` + `census_md.py` after it logs `all windows done`.
  Consequences until then: USCPIYOY/USCORECPIYOY start 2018-01, USCPIMOM/USNFPCHG 2017-02.
- **Backfill placement is conservative, sometimes by weeks.** Backfilled rows use the registry `lag_rule` (late side),
  raised to a matched event's schedule but never LOWERED to it: Aug 2026 CPI is placed 2026-09-25 08:30 ET (period end
  + 25 d) although the configured PFEI event says 2026-09-11 08:30 ET. No leak, but an overlay would show the print two
  weeks late. Recommendation: when a backfilled period matches a known past event of precision `exact`/`time_configured`,
  place it at that event (it is the official release time). Rows already stored are append-only; a derivation-style
  version bump or a one-time re-placement release would be needed.
- **Derived float noise**: UST10Y2Y 2026-09-25 is stored as 0.3600000000000003 (5.17 − 4.81 in binary). Display
  formats hide it; a `round(v, 10)` in `derive.py` would make stored values canonical (needs a derivation version bump).
- **FHFA configured calendar has no past event**: `fhfa_hpi.json` starts at the 2026-09-29 release, so USFHFAHPI was
  `NO_EXPECTATION` until 09:00 ET, then CHECKING → CURRENT (logged). Adding the prior releases would give it a real state
  before the first live release.
