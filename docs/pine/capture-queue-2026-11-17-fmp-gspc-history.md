# Capture queue: FMP ^GSPC history against TradingView's SP:SPX (2026-11-17)

Found while grading RS Rating on NASDAQ:NVDA 1D (`rs-rating-fred6724-nvda-1d-2026-11-15`, coordinator ruling on #1541).
TradingView's RS line is NVDA close / TradingView's own SP:SPX close * 3360, bit for bit, on all 6997 bars (witness
`rs-spx-daily-spy-1d-2026-11-15`: `request.security("SP:SPX", "D", close)` read on each chart bar, the previous
session's SPX close). The SPX our server serves (FMP ^GSPC, the primary in `api/index_bars.py`; the record
`tests/fixtures/vendor-supply/rs-rating-fred6724-nvda-1d-2026-11-15.json`) differs from TradingView's on 1292 of the
6997 read dates, all before 2023-12-05: mostly cents, float32-looking values from 2021 to 2023 (4554.89014 against
4554.90), and 32 sessions off by more than 0.1% between 1999 and 2008, several of them FMP's value for the
neighbouring session (2005-02/03, 2005-10, 2006-01). The engine is not the cause: on the witness's values every bar
agrees, which is what the supply-attributed grade checks (`compare.mjs::attributableToSupply`), so the RS line now
grades MATCH_SUBSTITUTED there, naming FMP. The data itself is a separate data-source decision, recorded here.

The 32 sessions (FMP close against TradingView's, the session's own date; TradingView reads it on the next session):
1999-06-17 1339.90/1338.09, 2000-02-08 1441.72/1436.68, 2000-02-29 1366.42/1359.78, 2000-04-14 1356.56/1346.22,
2000-04-28 1452.43/1456.04, 2000-05-05 1432.63/1426.70, 2001-06-29 1224.38/1226.99, 2002-07-23 797.70/798.61,
2002-10-08 798.55/796.42, 2005-02-14 1206.14/1210.12, 2005-02-16 1210.34/1200.75, 2005-02-22 1184.16/1190.80,
2005-02-23 1190.80/1200.20, 2005-02-24 1200.20/1211.37, 2005-02-28 1203.60/1210.41, 2005-03-03 1210.47/1222.12,
2005-03-07 1225.31/1219.43, 2005-03-08 1219.43/1207.01, 2005-03-09 1207.01/1209.25, 2005-03-10 1209.25/1200.08,
2005-09-08 1231.67/1241.48, 2005-10-17 1190.10/1178.14, 2005-10-18 1178.14/1195.76, 2005-10-19 1195.76/1177.80,
2005-10-20 1177.80/1179.59, 2005-12-05 1262.09/1263.70, 2005-12-06 1263.70/1257.37, 2006-01-12 1286.06/1287.61,
2006-01-17 1282.93/1277.93, 2006-01-18 1277.93/1285.04, 2006-01-19 1285.04/1261.49 (+1.87%), 2008-12-24 868.15/865.42.

| id | probe | symbol / tf | refusal kept | unblocks | owner |
|---|---|---|---|---|---|
| fmp-gspc-history | none: a data-source question (TradingView's SP:SPX is already witnessed by `rs-spx-daily-spy-1d-2026-11-15`) | `SP:SPX 1D` | none: the RS line is served on FMP's SPX and graded MATCH_SUBSTITUTED, naming FMP | a decision on the index history members are served before 2023-12-05 (correct FMP's sessions, prefer another source for that span, or keep FMP named) | owner (data source) |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).

| not a capture | disposition | reason |
|---|---|---|
| fmp-gspc-history | ruling | FMP ^GSPC differs from TradingView's SP:SPX on 1292 sessions before 2023-12-05, 32 of them by more than 0.1% (1999-2008); which index history members are served is a data-source decision for the owner, not a TradingView reading and not an engine fix |
