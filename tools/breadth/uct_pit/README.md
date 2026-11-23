# UCT point-in-time breadth history (2008 → 2025)

Builds `breadth_uct_pit_v1.json`, served by `api/services/breadth_uct_pit.py` (off unless
`BREADTH_UCT_PIT=1`). Runs on the breadth runner under `/data/_audit/uct_pit/` (scripts in
`code/`). Every script prints counts, ratios and differences only — never a market value.

| stage | script | what |
|---|---|---|
| 1 | `acquire.py ref \| grouped_s3 a b \| sec` | reference tickers (active + delisted), splits, S3 day flat files, SEC companyfacts + submissions |
| 2 | `build_shares.py` | XBRL share counts per CIK (cover, balance sheet, weighted average, IFRS) |
| 2b | `harvest_pre.py` (env `H_LO H_HI W_LO W_HI H_OUT`) | 10-K/10-Q cover-page counts for issuers lacking XBRL counts (`l4.sh`) |
| 2c | `clean_text.py` (env `C_IN C_OUT`), `qa_text.py` | scale guard on cover-page counts |
| 3 | `membership.py <ledger>` | the list per session (collector rule) + grade vs the real 2026 lists |
| 4 | `compute.py lo hi` (env `LEDGER`) | production's engine over the list (`l5.sh` full history, `l3.sh` 2026 validation) |
| 5 | `grade2.py`, `coverage.py`, `audit_runner.py` | readings vs real lists, share-count coverage per year, drift audit |
| 6 | `finalize.py [LAST]` | the served series |
