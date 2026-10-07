# UCT Terminal — accuracy audit, 2026-10-06

**Lane:** ACCURACY (branch `terminal/fn4-accuracy`, base `origin/master` `0ae75faf3`).
**Question:** are the numbers the terminal's functions show right?
**Method:** for every calculation a registry function (`app/src/pages/terminal/functions.js`)
performs or displays, an INDEPENDENT reference was written in different code (pandas / numpy,
or a hand-derived value), fed the same inputs, and compared with the product's own function.
Inputs are real public market data fetched on this PC without credentials (Yahoo Finance via
`yfinance 1.2.0` in `C:\Users\pgosz\uct-venv`), plus hand-built edge cases. Production was not
read; no credentials were used.

## Headline

| | count |
|---|---|
| Checks run | **208** — 138 REL/RRG/CORR harness rows (R) · 34 MOST + formatting rows (M) · 35 backend rows (B, run as 35 pytest cases) · 1 weekly-anchor vitest case (W1) |
| PASS on the product as found | 199 |
| FAIL on the product as found | **9** (R131, R132, W1, B27, B29, B30, B31, B32, B33), from **5 real defects** — all five fixed, each with a regression test; all 208 pass after the fixes |
| Vendor / data issues flagged (not ours to fix) | 4 |
| Design choices flagged for an owner (arithmetic correct, presentation debatable) | 6 |

### Defects found and fixed

| # | Function(s) | Defect | Fix | Commit |
|---|---|---|---|---|
| D1 | **CORR** | Returns were computed per name on its OWN series, so the session after a day one name did not trade paired its two-session return with the other's one-session return — breaking the module's own "one alignment rule". NVDA/AMD with one AMD session removed: product r = 0.389592 on 62 returns, pandas reference 0.382459 on 63. | A pair's returns are taken on the pair's common closes. | `2eb6d8ad2` |
| D2 | **RRG** (weekly) | Two weekly anchors: equity/ETF weekly bars are Friday-keyed (`bars_fetch._resample_weekly_iso`), the index path (SPX/NDX/VIX via yfinance `1wk`) is Monday-keyed (verified: `^GSPC` weekly stamps are all Mondays). `RRG SPX` against the SPY benchmark shared **zero** dates and read "not enough history". | `closesFromBars(_, {weekly})` re-keys every W bar to its ISO Friday; `useCloses` passes it for `tf=W`. | `2eb6d8ad2` |
| D3 | **ERX / ERN / CAL** expected move | The straddle expiry was "first expiry ON or after the report date". Single names now list Mon/Wed/Fri expiries (read live: NVDA, AAPL, TSLA, AMD all list 2026-10-07 Wed). A **Wednesday after-close** reporter (NVDA, TSLA, MSFT, META) took the Wednesday expiry, which settles at 4 PM *before* the print — the "expected move" was a one-day non-event straddle. | `select_report_expiry` / `get_implied_move` take an optional `timing`; `'amc'` selects the first expiry strictly after the date. The calendar enrichment passes it for its AMC bucket (both the in-house and the legacy path); the expected-move cache keys an AMC read apart. | `632825545` |
| D4 | **EE** quarterly consensus | Quarters were labelled by CALENDAR month (`_quarter_label`) under a panel that says "by fiscal quarter": NVIDIA's Oct-2026 quarter read "Q3 2026" beside an annual row "FY2027" (NVIDIA calls it Q3 FY2027); Apple's Dec-2026 quarter read "Q4 2026" (Apple: Q1 FY2027). | `fiscal_relabel` re-labels through `fiscal_calendar.FiscalCalendar`, anchored on FMP's own ANNUAL estimate rows (their `date` is the fiscal year end). December filers keep their label byte for byte. | `d8c436bf9` |
| D5 | fiscal-quarter resolution (`FiscalCalendar`, used by ERN/EE/earnings intel) | The month-anchored branch counted completed months, exact only when the period end sits on the boundary. FMP's Apple rows put the year end on 09-27 and fiscal Q2 on 2026-03-28 → Q2 resolved as **Q3**, so two quarters shared one label. | Nearest quarter boundary (identical on every exact boundary; all truth cases still pass). | `d8c436bf9` |

### Vendor / data issues (flagged, not fixable here)

| # | Source | Issue |
|---|---|---|
| V1 | Yahoo, TSM | `financialCurrency = TWD`, but Yahoo's EPS estimates (0q avg 4.48, trailing 13.66) are on a **per-ADR US-dollar** basis while its revenue estimates (0q 1.456 trillion) are **TWD**. One table, two currencies, neither stated. The product already renders Yahoo EPS for a foreign filer with no symbol and says why (`ConsensusEstimates.jsx` `yahooNote`) — correct handling of an ambiguous vendor field. |
| V2 | Yahoo index weekly (`1wk`) | Monday-keyed weeks while every equity weekly bar in the store is Friday-keyed (root of D2; now normalised client-side). |
| V3 | FMP estimate dates | Fiscal year ends normalised to a fixed month-day (AAPL `09-27` every year) while quarter ends drift a day (`2026-03-28`) — the input that exposed D5. |
| V4 | Yahoo price basis | `auto_adjust=False` closes are split-adjusted but NOT dividend-adjusted. REL/RRG/CORR inherit whatever basis `/api/bars` serves; SPX vs SPY drifts ~1.3 %/yr on dividends alone, visible as RS-Ratio ≈ 100.05 in a SPX-vs-SPY RRG. Not a defect — worth one line in the REL method note if members compare an index to its ETF. |

### Design choices flagged for an owner (arithmetic correct, presentation debatable)

> **All six were resolved on 2026-10-06 (branch `terminal/fn5-acc2`), plus the foreign-filer
> "$" gap — see "Follow-ups fixed" directly below this list.** The list is kept as it was
> written so the before-state stays readable.

1. **Two realized-vol definitions.** VOL/IVH `hv()` uses the SAMPLE std (n−1) of log returns; ERX `realized_vol()` uses the POPULATION std (n). Both match their own reference exactly, but the same 20-day vol differs by √(20/19) ≈ 2.6 % between two panels a member can open side by side.
2. **`formatCompact` picks the tier before rounding** (documented in source as deliberate): 999,999 → "1000K", 999,950,000 → "1000.0M" on the terminal ladder.
3. **`formatPercent(-0.001, {signed})` → "-0.00%"** (a negative zero survives `toFixed`).
4. **CORR silently ignores `2Y` / `YTD`** (the lookback arg accepts them; `CORR_WINDOWS` does not, so the panel stays on 3M). Not a wrong number, but the typed window is not echoed as unapplied.
5. **Callers of the implied move without session timing** — the ERX panel (`earnings_reaction_panel._read_implied`), Discord chart context and `enrich_earnings_response` still use the on-or-after rule; they need the report's BMO/AMC to benefit from D3.
6. **ERN modal parity.** `estimates_consensus._quarter_label`'s docstring says EE and the ERN modal number a quarter the same way; after D4, EE uses the company's fiscal label for non-December filers while the ERN modal's estimate rows still use the calendar mapper (`earnings_estimates._fiscal_q_from_period_end`). Same arithmetic class; the ERN side is a separate surface and was left for its owner.

### Follow-ups fixed (branch `terminal/fn5-acc2`, base `f7524c40d`)

Each with a regression test whose expected values come from an independent reference
(numpy / a hand-written Pearson / each company's own fiscal label), never from the product.

| # | Was | Fix | Commit | Rail |
|---|---|---|---|---|
| F1 (note 5) | ERX panel, Discord chart context and `enrich_earnings_response` passed no BMO/AMC, so every after-close reporter still got the same-day (pre-print) expiry | `implied_move.report_timing(sym, date)` resolves the session from the engine weekly calendar (cache/disk, no vendor) then Finnhub `/calendar/earnings` `hour`; cached 6 h per (sym, date), None included. ERX `_read_implied` and Discord `_implied` pass it (ERX result carries `timing`); `enrich_earnings_response(..., timing=)` takes the row's own session (warm rows carry BMO/AMC; `engine._row_timing`, TBD = unknown) and resolves otherwise. **Documented default:** dmh / unlisted / a vendor failure = unknown = on-or-after (the same-day expiry) — right for a pre-market or intraday print, one expiry early for an after-close print no source states. The click path's rows (`routers/earnings._resolve_row`) carry no report date at all, so they take the front expiry and timing does not apply. | `67500f6cf` | `tests/test_implied_move_timing_callers.py` (NVDA Wed 2026-10-07 AMC → Fri 2026-10-09, hand-picked) |
| F2 (note 6) | ERN modal history rows used FMP's join identity with a calendar-month fallback; its upcoming row was numbered by the REPORT date's calendar month | One authority: `fiscal_calendar.display_label(fy, q, period_end)` — `Q3 2026` when the fiscal quarter equals the calendar one (every December filer, byte for byte), else `Q3 FY2027`. EE's `fiscal_relabel` uses it. `earnings_history_fmp.fmp_history` builds a `FiscalCalendar` from the same income-statement rows (Q4 dates = filed year ends), stamps `year`/`quarter`/`label` on every history row, places an unjoinable print with `period_end_for_report`, and returns `next_report_fiscal` for the earliest forward report; `get_earnings_intel` → calendar enrichment → `mergeEnrichment` + `toModalRow` carry it; `buildQuarters` prints the backend label and takes `next_report_fiscal` only for THIS report (±7 days). | `e32ca6f08` | `tests/test_ern_fiscal_labels.py` (Apple Dec-2025 quarter = Q1 FY2026, NVIDIA Oct-2025 = Q3 FY2026; ERN == EE on every quarter), `earningsHistoryModel.fiscal.test.js` |
| F3 (note 4) | `CORR … 2Y` / `YTD` parsed, then ignored (panel stayed on 3M) | Supported: `CORR_WINDOWS` = 1M 3M 6M 1Y 2Y YTD (every window `args.js` accepts; the 600-bar D read holds 2Y's 504 returns). `relativeMath.corrWindow`: 2Y = 504 sessions, YTD = every return dated in the newest session's year (`since` bound on `correlationMatrix`). A window the panel cannot draw now renders "Window X is not available here; showing 3M." | `233a44ba0` | `CorrPanel.windows.test.jsx` (independent Pearson; 2Y n = 504, YTD from 2026-01-01; rendered cells) |
| F4 (note 2) | `formatCompact` picked the tier before rounding: 999,999 → "1000K" (terminal), 999,950 → "1000.0K" (default), 999,950,000 → "$1000.0M" | The tier is chosen on the magnitude, then promoted once if rounding reached the next tier's threshold, in that tier's own decimals: 999,999 → "1.0M", 999,950,000 → "$1.00B" (terminal money), 999.6 → "1.0K" (below the smallest tier too). A ladder with no larger tier keeps counting (COT "1000.00M"; terminal T is the top). | `0180b66a0` | `presentationPrimitives.test.js` (typed boundaries + a 20,000-value sweep: no rendered number reads ≥ 1000 of a unit that has a next tier) |
| F5 (note 3) | `formatPercent(-0.001, {signed})` → "-0.00%" | A negative that rounds to zero is "0.00%" — no sign, signed render or not. A real -0.01 keeps its sign; a positive/exact zero keeps "+0.00%" when signed. | `0180b66a0` | `presentationPrimitives.test.js` |
| F6 (note 1) | VOL/IVH sample std (n−1), ERX population std (n): 20-session vols √(20/19) ≈ 2.6 % apart | Both call `api/services/realized_vol.annualized_hv` — the SAMPLE standard deviation of daily log returns × √252, the conventional HV estimator. ERX's figure moves up ~2.6 % at 20 sessions. VOL's `HV_METHOD` and ERX's `method.realized_vol` (now rendered under the ERX realized-vol line) both name it and point at the other panel. | `7bfe32051` | B5 now numpy `ddof=1`; new: VOL HV20 == ERX realized vol on the NVDA fixture; `EarningsReactionPanel.test.jsx` rendered method |
| F7 | FundamentalsWidget, BusinessTrend and CompanySearch printed "$" on a foreign filer's figures (TSM reports in TWD) | Shared helpers (`currencyPrefix` / `reportingCurrencyNote` / `isForeignCurrency`) on the reporting currency the backend already serves, EE/FA's rule: amounts in the reporting currency, EPS without a symbol, USD/unknown byte-for-byte unchanged. `/api/fundamentals/earnings-table` stamps `currency` (from `research.reporting_currency`, EE/FA's source) on a COPY so the cached payload and `_PAYLOAD_VERSION` are untouched; BusinessTrend takes the earnings-intel payload's `currency` (DockProfile already holds it); CompanySearch uses `/api/fundamentals-full`'s `reporting_currency` (Yahoo `financialCurrency`, the statements' own source). | `2ff6af7c5` | `widgetCurrency.accuracy.test.jsx`, `FundamentalsWidget.test.jsx` (rendered TWD, no "$"; USD unchanged), `test_earnings_table_router.py` |

**Edge changes members will see (F4), and only these:** every grammar on `formatCompact`
prints a value that rounds up to its next tier in that tier. Boundary values that moved
(examples, each pinned in its test): profile `fmtVol(999,950)` "$1000.0K" → "$1.0M" and
`fmtVol(999,999,999)` "$1000.0M" → "$1.0B"; `fmtShares(999,500)` "1000K" → "1.0M";
`fmtRevenue(-999,995,000)` "$-1000.00M" → "-$1.00B"; COT `fmtCompact(999,500)` "1000K" →
"1.00M" (its 1e9 "1000.00M" is unchanged — no B tier); dock `fmtSales(999,500)` "$1000K" →
"$1M", `fmtShares(999,999)` → "1.0M", `fmtMoney(999,999)` → "$1.0M", `stripSales(999,500)` →
"$1M"; board `CompanySearch.fmtMoney(999,950)` "$1000.0K" → "$1.0M",
`BusinessTrend.fmtMoney(999,999,999)` "$1000M" → "$1.0B", OptionsFlow `fmt(999,999)` "$1000K" →
"$1.0M", Scatter `abbrev(999,999)` "1000K" → "1.0M", VolumeScan `fmtDollar(999,600)` "$1000K" →
"$1.0M", LeverageInverse `fmtVol(999,999,999)` "$1000.0M/d" → "$1.0B/d"; watchlist
`fmtVol(999,999)` "1000K" → "1.0M", `fmtDolVol(999,999)` "$1000K" → "$1.0M"; and below the
smallest tier, 999.5 → "1.0K" (default) / "1K" (terminal). The frozen TERM-066 oracles in
`compactAdoption.test.jsx`, `dockFormatters.term066.test.js`, `widgetFormatters.term066.test.js`
and `Watchlists.term066.test.js` are unchanged verbatim; each is wrapped by
`lib/presentation/__fixtures__/compactBoundary.withPromotion`, which expects the next tier ONLY
where the oracle's own printed number reached a threshold the value is below — every other
input is still byte-for-byte the frozen body. `columnDefs.compact.test.js` needed no change.

**Other edge changes:** ERX realized vol reads √(20/19) higher (F6); a non-December filer's ERN
labels read `Q1 FY2026` (was `Q1 26` on a joined row, and a calendar-month guess such as
`Q4 25` on an unjoined row or the upcoming row) — December filers are unchanged (F2); a tiny
negative percent reads "0.00%" (F5); a foreign filer's dock sales/revenue read "TWD …" (F7).

## What was checked, function by function

Registry functions that only **embed** a vendor value without computing on it (DES, CN, ANR,
OWN, PPL, CF, FEED, FIL, TRAN, MB, DR, HIS, RSCH, ASK, EVTS, FSRC, FTD, ATTN, BRKE, OMON, OVS,
OSCR, FLOW, GEX, TIDE, STRS, LIVE, DP, FREC, WIRE, BRD, SCR, U20, DASH, CHRT, PMKT, CATH, SETL,
FORM, DESK, JRNL, NB, RISK, COMM, EXP, HELP, MYST, MOVE/WIIM) were covered through the shared
calculations they display: compact money/volume formatting, currency labels, % change vs prior
close, session labels and the NYSE session calendar. Functions with their own arithmetic were
checked directly:

| Function | Calculation | Where checked |
|---|---|---|
| REL | window sessions (1M…2Y, YTD base = last close of prior year), return, max drawdown, excess vs base, A/B ratio change, ratio vs 50-session SMA, rebased lines | R4–R81 |
| RRG | RS = 100·sym/bench, RS-Ratio = 100·RS/SMA10, RS-Momentum = 100·Ratio/SMA5, quadrant, periods in quadrant, tail relative return, weekly anchors | R82–R105, vitest `relativeMath.accuracy` |
| CORR | Pearson of daily simple returns, pair n, most-correlated pair, average r, missing-session alignment | R106–R132, vitest |
| shared | bar date keys (ISO + unix seconds, ET-midnight vs UTC), SMA, zero/NaN/non-numeric closes, constant series, one-session series | R1–R3, R133–R138 |
| MOST | % change per session (regular / pre / post), after-hours vs the 4 PM close, ext print session gating, vol-vs-average source precedence, catalyst time units, lenses, price/volume floors, sort with missing values last, session labels | M1–M18 |
| formatting | terminal compact ladder (T/B 2dp, M 1dp, K 0dp), sign outside currency, NaN → em dash, signed %, TWD currency labels | M19–M34 |
| VOL / IVH | HV10/20/30, IV rank, IV percentile, constant-maturity IV (total-variance interpolation, no extrapolation) | B1–B4, B9, B23 |
| ERX | realized vol, reacting session choice, gap, reaction, run-in, 5-day drift, summary stats | B5–B7 |
| SEAS | monthly returns (first month base only, running month dropped), weekday returns, coverage | B8 |
| POS | max pain, payout at max pain, distance from spot | B10 |
| EE / ERN / FA | EPS/revenue surprise % (three helpers), near-zero / zero estimate, fiscal-quarter labels | B11–B13, B14–B22 |
| short interest | FINRA settlement dates across holidays/weekends, derived shares short, % of outstanding | B24–B25 |
| session calendar | every weekday SPY did not trade (2023-01-03…2026-10-02) is in `NYSE_HOLIDAYS_YYYYMMDD`, and none it traded is | B26 |
| CAL / ERN expected move | expiry choice for AMC vs BMO vs unknown timing | B27–B29 |

## Backend checks (pytest: `tests/test_terminal_accuracy_reference.py`)

Fixture: `tests/fixtures/terminal_accuracy/nvda_spy_daily_2023_2026.json` — Yahoo daily OHLC,
NVDA + SPY, 2023-01-03 … 2026-10-02 (936 sessions each, split-adjusted).

| # | Check | Method (reference) | Reference | Product | Verdict |
|---|---|---|---|---|---|
| B1 | HV10 NVDA | `np.std(diff(log(c)), ddof=1)·√252` | identical to 1e-12 | `vol.hv` | PASS |
| B2 | HV20 NVDA | same | identical | | PASS |
| B3 | HV30 NVDA | same | identical | | PASS |
| B4 | HV with < n+1 closes | definition | None | None | PASS |
| B5 | ERX realized vol, 20 sessions | `np.std(..., ddof=1)·√252·100`, 1dp (was ddof=0 — F6) | identical; through 2026-10-02 | `realized_vol` | PASS |
| B6 | ERX rows, 8 NVDA AMC reports 2024-02-21…2025-11-19 | pandas: reacting session = report day or next by \|gap\|; gap, reaction, run-in (5), drift (5) | all 8 × 6 fields equal (2dp); every AMC print reacts next session | `quarter_rows` | PASS |
| B7 | ERX stat block | numpy mean / mean\|x\| / median / share > 0 | identical | `_stat` | PASS |
| B8 | SEAS months + weekdays | pandas `resample('ME').last().pct_change()`, first & running month excluded; weekday `pct_change` | n, avg, median, % up equal for all 12 months, 5 weekdays; coverage 2023-01-03…2026-10-02 | `seasonality.compute` | PASS |
| B9 | constant-maturity IV, 30d from 9d/37d | hand-derived total variance √((w9 + (w37−w9)·21/28)/30) | 0.4547 (rounded 4dp) | identical; 5d & 90d → None | PASS |
| B10 | max pain, 17 strikes, random OI | numpy brute force over listed strikes | strike, payout, distance equal | `max_pain_from` | PASS |
| B11–B13 | surprise % for (0.81, 0.75), (−0.12, −0.20), (1.05, 1.10), (2.0, −0.5) | (a−e)/\|e\|·100 | e.g. +8.0 %, +40.0 %, −4.5 %, +500.0 % | `earnings_estimates._surprise_pct` (1dp), `earnings_history_fmp._pct`, `earnings_intel._surprise` | PASS |
| B14 | surprise on a zero / near-zero estimate | definition: not a percentage | None | None | PASS |
| B15–B23 | fiscal quarter of NVDA ×2, AAPL ×2, MSFT ×2, WMT, MU, TSM | each company's own reported label | e.g. NVDA 2025-10-26 = FY2026 Q3, AAPL 2025-12-27 = FY2026 Q1, MU 2025-11-27 = FY2026 Q1 | `FiscalCalendar.resolve` | PASS (9/9) |
| B23b | IV rank / percentile, 60 random IVs; flat window | numpy (cur−lo)/(hi−lo); share of prior < cur | identical; flat → None | `iv_history.rank_of` | PASS |
| B24 | FINRA settlement dates | hand-derived: 2024-01-15 MLK → Fri 01-12; 2026-02-15 Sun → 02-13; 2026-05-31 Sun → 05-29; 2025-11-30 Sun → 11-28 | as derived | `settlement_dates_before` | PASS |
| B25 | shares short from % float | pct/100·float; /outstanding·100 | equal | `_derive` | PASS |
| B26 | NYSE holiday table vs SPY's traded sessions, 2023-01-03…2026-10-02 | set difference | no missing holiday, no phantom | `NYSE_HOLIDAYS_YYYYMMDD` | PASS |
| B27 | AMC on a day with an expiry (NVDA 2026-10-07 Wed) | an expiry settling at 4 PM cannot hold a post-close print | 2026-10-09 | **as found: 2026-10-07** → fixed | **FAIL → fixed (D3)** |
| B28 | BMO / unknown timing same day | same-day expiry settles after the reaction | 2026-10-07 | 2026-10-07 | PASS |
| B29 | AMC read cached apart from a BMO read; calendar AMC bucket passes timing | wiring | `[None, 'amc']`; `{NVDA: amc, JPM: None}` | as found: no timing existed → fixed | **FAIL → fixed (D3)** |
| B30 | AAPL fiscal Q2 ending 2026-03-28 against FMP's 09-27 year ends | Apple's own label | Q2 | **as found: Q3** → fixed | **FAIL → fixed (D5)** |
| B31 | EE quarter labels on the recorded FMP AAPL payloads | Apple's own labels | 2026-12-27 = Q1 FY2027, 2027-03-27 = Q2 FY2027, 2027-09-27 = Q4 FY2027, all distinct | **as found: Q4 2026 / Q1 2027 / Q3 2027** → fixed | **FAIL → fixed (D4)** |
| B32 | EE December filer / no anchors / NVIDIA Jan year end | own labels | unchanged ×2; NVDA 2026-10-31 = Q3 FY2027 | as found: Q3 2026 → fixed | **FAIL → fixed (D4)** |
| B33 | `get_consensus` serves the fiscal labels (the wire) | | Q1 FY2027 | Q1 FY2027 (mutation: removing the call reds it) | PASS after fix |
| B34 | TSM reporting currency at the vendor | Yahoo `financialCurrency` | TWD | product labels TWD revenue, bare EPS | PASS (see V1) |

## Frontend harness results

Reproduce: `docs/terminal-research/15-accuracy/harness/` — `fetch.py` / `fetch_w.py` (Yahoo
closes into the working directory), `prod_rel.mjs` (runs the product's `relativeMath.js` on
them), `ref_rel.py` (pandas reference + comparison), `wk.mjs` (weekly anchor), `most.mjs`
(MOST + formatting; run with `npx vite-node` from `app/` because it resolves vite paths).
The scripts import the product from this worktree's absolute path.

Daily closes: NVDA, SPY, XLK, XLE, AMD, TSM, ^GSPC, 2023-09-01 … 2026-10-02 (774 sessions).
Rows R131–R132 are the two that failed on the product as found (r 0.389592 / n 62); the table
shows the run after the D1 fix. The weekly anchor case W1 (D2) is the vitest regression
`relativeMath.accuracy.test.js` (as found: `rrgPath` → null; after: ratio 100.0513, momentum
100.0234, as of 2026-10-02, equal to pandas to 1e-9).

### REL / RRG / CORR (R1–R138)

| # | Check | Reference | Product | Verdict |
|---|---|---|---|---|
| R1 | A unix-seconds index dates == yfinance session dates (774) | 2023-09-01/2023-09-05/2023-09-06/2023-09-07/2023… | 2023-09-01/2023-09-05/2023-09-06/2023-09-07/2023… | PASS |
| R2 | B SMA50 NVDA max /diff/ (774 points) | 0 | 0 | PASS |
| R3 | B SMA50 first-defined index | 49 | 49 | PASS |
| R4 | C REL 1M sessions | 21 | 21 | PASS |
| R5 | C REL 1M base date | 2026-09-02 | 2026-09-02 | PASS |
| R6 | C REL 1M NVDA return % | 4.251147 | 4.251147 | PASS |
| R7 | C REL 1M NVDA max drawdown % | -8.421601 | -8.421601 | PASS |
| R8 | C REL 1M SPY return % | 0.585498 | 0.585498 | PASS |
| R9 | C REL 1M SPY max drawdown % | -2.472936 | -2.472936 | PASS |
| R10 | C REL 1M SPY excess vs NVDA (pts) | -3.665649 | -3.665649 | PASS |
| R11 | C REL 1M AMD return % | 38.692951 | 38.692951 | PASS |
| R12 | C REL 1M AMD max drawdown % | -5.313759 | -5.313759 | PASS |
| R13 | C REL 1M AMD excess vs NVDA (pts) | 34.441803 | 34.441803 | PASS |
| R14 | C REL 1M NVDA/SPY ratio change % | 3.644312 | 3.644312 | PASS |
| R15 | C REL 1M ratio above 50d avg | 1 | 1 | PASS |
| R16 | C REL 1M rebased line last pt == return | 38.692951 | 38.692951 | PASS |
| R17 | C REL 3M sessions | 63 | 63 | PASS |
| R18 | C REL 3M base date | 2026-07-06 | 2026-07-06 | PASS |
| R19 | C REL 3M NVDA return % | 19.636922 | 19.636922 | PASS |
| R20 | C REL 3M NVDA max drawdown % | -10.583529 | -10.583529 | PASS |
| R21 | C REL 3M SPY return % | 2.443829 | 2.443829 | PASS |
| R22 | C REL 3M SPY max drawdown % | -3.376383 | -3.376383 | PASS |
| R23 | C REL 3M SPY excess vs NVDA (pts) | -17.193092 | -17.193092 | PASS |
| R24 | C REL 3M AMD return % | 14.828367 | 14.828367 | PASS |
| R25 | C REL 3M AMD max drawdown % | -23.002742 | -23.002742 | PASS |
| R26 | C REL 3M AMD excess vs NVDA (pts) | -4.808555 | -4.808555 | PASS |
| R27 | C REL 3M NVDA/SPY ratio change % | 16.782946 | 16.782946 | PASS |
| R28 | C REL 3M ratio above 50d avg | 1 | 1 | PASS |
| R29 | C REL 3M rebased line last pt == return | 14.828367 | 14.828367 | PASS |
| R30 | C REL 6M sessions | 126 | 126 | PASS |
| R31 | C REL 6M base date | 2026-04-02 | 2026-04-02 | PASS |
| R32 | C REL 6M NVDA return % | 31.884548 | 31.884548 | PASS |
| R33 | C REL 6M NVDA max drawdown % | -19.39849 | -19.39849 | PASS |
| R34 | C REL 6M SPY return % | 17.353582 | 17.353582 | PASS |
| R35 | C REL 6M SPY max drawdown % | -4.494648 | -4.494648 | PASS |
| R36 | C REL 6M SPY excess vs NVDA (pts) | -14.530966 | -14.530966 | PASS |
| R37 | C REL 6M AMD return % | 191.452874 | 191.452874 | PASS |
| R38 | C REL 6M AMD max drawdown % | -26.05395 | -26.05395 | PASS |
| R39 | C REL 6M AMD excess vs NVDA (pts) | 159.568325 | 159.568325 | PASS |
| R40 | C REL 6M NVDA/SPY ratio change % | 12.382209 | 12.382209 | PASS |
| R41 | C REL 6M ratio above 50d avg | 1 | 1 | PASS |
| R42 | C REL 6M rebased line last pt == return | 191.452874 | 191.452874 | PASS |
| R43 | C REL 1Y sessions | 252 | 252 | PASS |
| R44 | C REL 1Y base date | 2025-10-01 | 2025-10-01 | PASS |
| R45 | C REL 1Y NVDA return % | 24.946593 | 24.946593 | PASS |
| R46 | C REL 1Y NVDA max drawdown % | -20.223145 | -20.223145 | PASS |
| R47 | C REL 1Y SPY return % | 15.138006 | 15.138006 | PASS |
| R48 | C REL 1Y SPY max drawdown % | -9.133129 | -9.133129 | PASS |
| R49 | C REL 1Y SPY excess vs NVDA (pts) | -9.808587 | -9.808587 | PASS |
| R50 | C REL 1Y AMD return % | 286.50692 | 286.50692 | PASS |
| R51 | C REL 1Y AMD max drawdown % | -27.760754 | -27.760754 | PASS |
| R52 | C REL 1Y AMD excess vs NVDA (pts) | 261.560328 | 261.560328 | PASS |
| R53 | C REL 1Y NVDA/SPY ratio change % | 8.518983 | 8.518983 | PASS |
| R54 | C REL 1Y ratio above 50d avg | 1 | 1 | PASS |
| R55 | C REL 1Y rebased line last pt == return | 286.50692 | 286.50692 | PASS |
| R56 | C REL 2Y sessions | 504 | 504 | PASS |
| R57 | C REL 2Y base date | 2024-09-27 | 2024-09-27 | PASS |
| R58 | C REL 2Y NVDA return % | 92.710049 | 92.710049 | PASS |
| R59 | C REL 2Y NVDA max drawdown % | -36.886837 | -36.886837 | PASS |
| R60 | C REL 2Y SPY return % | 34.677236 | 34.677236 | PASS |
| R61 | C REL 2Y SPY max drawdown % | -18.998907 | -18.998907 | PASS |
| R62 | C REL 2Y SPY excess vs NVDA (pts) | -58.032814 | -58.032814 | PASS |
| R63 | C REL 2Y AMD return % | 285.707332 | 285.707332 | PASS |
| R64 | C REL 2Y AMD max drawdown % | -54.739583 | -54.739583 | PASS |
| R65 | C REL 2Y AMD excess vs NVDA (pts) | 192.997282 | 192.997282 | PASS |
| R66 | C REL 2Y NVDA/SPY ratio change % | 43.090291 | 43.090291 | PASS |
| R67 | C REL 2Y ratio above 50d avg | 1 | 1 | PASS |
| R68 | C REL 2Y rebased line last pt == return | 285.707332 | 285.707332 | PASS |
| R69 | C REL YTD sessions | 189 | 189 | PASS |
| R70 | C REL YTD base date | 2025-12-31 | 2025-12-31 | PASS |
| R71 | C REL YTD NVDA return % | 25.442359 | 25.442359 | PASS |
| R72 | C REL YTD NVDA max drawdown % | -19.39849 | -19.39849 | PASS |
| R73 | C REL YTD SPY return % | 12.863679 | 12.863679 | PASS |
| R74 | C REL YTD SPY max drawdown % | -9.133129 | -9.133129 | PASS |
| R75 | C REL YTD SPY excess vs NVDA (pts) | -12.57868 | -12.57868 | PASS |
| R76 | C REL YTD AMD return % | 195.998319 | 195.998319 | PASS |
| R77 | C REL YTD AMD max drawdown % | -26.46719 | -26.46719 | PASS |
| R78 | C REL YTD AMD excess vs NVDA (pts) | 170.55596 | 170.55596 | PASS |
| R79 | C REL YTD NVDA/SPY ratio change % | 11.145021 | 11.145021 | PASS |
| R80 | C REL YTD ratio above 50d avg | 1 | 1 | PASS |
| R81 | C REL YTD rebased line last pt == return | 195.998319 | 195.998319 | PASS |
| R82 | D RRG-D XLK RS-Ratio | 101.723614 | 101.723614 | PASS |
| R83 | D RRG-D XLK RS-Momentum | 100.184183 | 100.184183 | PASS |
| R84 | D RRG-D XLK quadrant | Leading | Leading | PASS |
| R85 | D RRG-D XLK periods in quadrant | 2 | 2 | PASS |
| R86 | D RRG-D XLK tail rel return % | 2.045103 | 2.045103 | PASS |
| R87 | D RRG-D XLK as-of | 2026-10-02 | 2026-10-02 | PASS |
| R88 | D RRG-D XLE RS-Ratio | 100.785275 | 100.785275 | PASS |
| R89 | D RRG-D XLE RS-Momentum | 101.357359 | 101.357359 | PASS |
| R90 | D RRG-D XLE quadrant | Leading | Leading | PASS |
| R91 | D RRG-D XLE periods in quadrant | 2 | 2 | PASS |
| R92 | D RRG-D XLE tail rel return % | 0.482012 | 0.482012 | PASS |
| R93 | D RRG-D XLE as-of | 2026-10-02 | 2026-10-02 | PASS |
| R94 | D RRG-D NVDA RS-Ratio | 102.348581 | 102.348581 | PASS |
| R95 | D RRG-D NVDA RS-Momentum | 100.237432 | 100.237432 | PASS |
| R96 | D RRG-D NVDA quadrant | Leading | Leading | PASS |
| R97 | D RRG-D NVDA periods in quadrant | 3 | 3 | PASS |
| R98 | D RRG-D NVDA tail rel return % | 3.495955 | 3.495955 | PASS |
| R99 | D RRG-D NVDA as-of | 2026-10-02 | 2026-10-02 | PASS |
| R100 | D RRG-D TSM RS-Ratio | 103.821198 | 103.821198 | PASS |
| R101 | D RRG-D TSM RS-Momentum | 100.810645 | 100.810645 | PASS |
| R102 | D RRG-D TSM quadrant | Leading | Leading | PASS |
| R103 | D RRG-D TSM periods in quadrant | 1 | 1 | PASS |
| R104 | D RRG-D TSM tail rel return % | 5.617452 | 5.617452 | PASS |
| R105 | D RRG-D TSM as-of | 2026-10-02 | 2026-10-02 | PASS |
| R106 | F CORR 1M 6x6 max /r diff/ vs pandas | 0 | 0 | PASS |
| R107 | F CORR 1M max /r diff/ vs numpy.corrcoef | 0 | 0 | PASS |
| R108 | F CORR 1M n per pair | 21 | 21 | PASS |
| R109 | F CORR 1M most-correlated pair | SPY/XLK | SPY/XLK | PASS |
| R110 | F CORR 1M avg r NVDA | 0.468842 | 0.468842 | PASS |
| R111 | F CORR 3M 6x6 max /r diff/ vs pandas | 0 | 0 | PASS |
| R112 | F CORR 3M max /r diff/ vs numpy.corrcoef | 0 | 0 | PASS |
| R113 | F CORR 3M n per pair | 63 | 63 | PASS |
| R114 | F CORR 3M most-correlated pair | XLK/TSM | XLK/TSM | PASS |
| R115 | F CORR 3M avg r NVDA | 0.38686 | 0.38686 | PASS |
| R116 | F CORR 6M 6x6 max /r diff/ vs pandas | 0 | 0 | PASS |
| R117 | F CORR 6M max /r diff/ vs numpy.corrcoef | 0 | 0 | PASS |
| R118 | F CORR 6M n per pair | 126 | 126 | PASS |
| R119 | F CORR 6M most-correlated pair | SPY/XLK | SPY/XLK | PASS |
| R120 | F CORR 6M avg r NVDA | 0.41371 | 0.41371 | PASS |
| R121 | F CORR 1Y 6x6 max /r diff/ vs pandas | 0 | 0 | PASS |
| R122 | F CORR 1Y max /r diff/ vs numpy.corrcoef | 0 | 0 | PASS |
| R123 | F CORR 1Y n per pair | 252 | 252 | PASS |
| R124 | F CORR 1Y most-correlated pair | SPY/XLK | SPY/XLK | PASS |
| R125 | F CORR 1Y avg r NVDA | 0.461541 | 0.461541 | PASS |
| R126 | F CORR 2Y 6x6 max /r diff/ vs pandas | 0 | 0 | PASS |
| R127 | F CORR 2Y max /r diff/ vs numpy.corrcoef | 0 | 0 | PASS |
| R128 | F CORR 2Y n per pair | 504 | 504 | PASS |
| R129 | F CORR 2Y most-correlated pair | SPY/XLK | SPY/XLK | PASS |
| R130 | F CORR 2Y avg r NVDA | 0.572865 | 0.572865 | PASS |
| R131 | G CORR with 1 missing AMD session (pairwise-aligned ref) | 0.382459 | 0.382459 | PASS |
| R132 | G CORR missing-session n | 63 | 63 | PASS |
| R133 | H closesFromBars drops 0/NaN/non-numeric; last bar of a date wins; accepts close | [{"d": "2026-01-07", "c": 11}, {"d": "2026-01-08… | [{"d": "2026-01-07", "c": 11}, {"d": "2026-01-08… | PASS |
| R134 | H pearson constant series -> null | None | None | PASS |
| R135 | H pearson n<2 -> null | None | None | PASS |
| R136 | H rebase zero base -> all null | [null, null, null] | [null, null, null] | PASS |
| R137 | H windowSessions with 1 date -> 0 | 0 | 0 | PASS |
| R138 | H REL one common session -> null | None | None | PASS |

### MOST and shared formatting (M1–M34)

Hand-derived fixtures (prev close 187.62, regular close 189.11, after-hours 186.40; AMD pre-market 165.00 vs 164.31). M26, M27 and M29 assert the product's documented behaviour; see design notes 2–3.

| # | Check | Reference | Product | Verdict |
|---|---|---|---|---|
| M1 | MOST post: NVDA % = regular close vs prev close | 0.794158 | 0.794158 | PASS |
| M2 | MOST post: NVDA after-hours % = ext vs 4 PM close | -1.433028 | -1.433028 | PASS |
| M3 | MOST post: AMD ext print from PRE session is not shown as after-hours | null | null | PASS |
| M4 | MOST: TSLA tracked-but-not-lit, on no list -> not a mover | false | false | PASS |
| M5 | MOST: vol vs avg prefers scanner rvol_day (1.9) | [1.9,"scanner"] | [1.9,"scanner"] | PASS |
| M6 | MOST: catalyst vol_x used when scanner absent | [2.2,"catalyst"] | [2.2,"catalyst"] | PASS |
| M7 | MOST: catalyst_at seconds -> ms | 1.79e+12 | 1.79e+12 | PASS |
| M8 | MOST pre: AMD % = pre-market print vs prev close | 0.419938 | 0.419938 | PASS |
| M9 | MOST pre: last = pre-market print | 165 | 165 | PASS |
| M10 | MOST pre: NVDA with a POST ext print falls back to movers % | 0.79 | 0.79 | PASS |
| M11 | MOST up lens keeps pct>0 only | ["A","D"] | ["A","D"] | PASS |
| M12 | MOST down lens | ["B"] | ["B"] | PASS |
| M13 | MOST min price $5 drops a no-price row | ["B","D"] | ["B","D"] | PASS |
| M14 | MOST min vol 500K | ["B","D"] | ["B","D"] | PASS |
| M15 | MOST sort /%/ desc, missing last, ties by symbol | ["B","A","D","C"] | ["B","A","D","C"] | PASS |
| M16 | MOST sort pct asc, missing last | ["B","A","D","C"] | ["B","A","D","C"] | PASS |
| M17 | MOST parsePct | [34.4,-3.1,3.1,null,null] | [34.4,-3.1,3.1,null,null] | PASS |
| M18 | MOST session labels | ["regular","pre","post","closed"] | ["regular","pre","post","closed"] | PASS |
| M19 | compact terminal: 2.9134e12 money | "$2.91T" | "$2.91T" | PASS |
| M20 | compact terminal: 391.04e9 | "$391.04B" | "$391.04B" | PASS |
| M21 | compact terminal: 45.26e6 | "45.3M" | "45.3M" | PASS |
| M22 | compact terminal: 950_400 | "950K" | "950K" | PASS |
| M23 | compact terminal: 812 | "$812" | "$812" | PASS |
| M24 | compact terminal: negative money sign outside | "-$1.25B" | "-$1.25B" | PASS |
| M25 | compact terminal: NaN -> em dash | "â€”" | "â€”" | PASS |
| M26 | compact terminal: tier boundary 999_999 (tier picked pre-rounding) — **now "1.0M" (F4)** | "1000K" | "1000K" | PASS |
| M27 | compact terminal: 999_950_000 — **now "1.00B" (F4)** | "1000.0M" | "1000.0M" | PASS |
| M28 | compact default ladder: 1.234e9 | "1.2B" | "1.2B" | PASS |
| M29 | formatPercent signed — **the third is now "0.00%" (F5)** | ["+1.50%","-0.25%","-0.00%"] | ["+1.50%","-0.25%","-0.00%"] | PASS |
| M30 | currency TWD label | "TWD 535.87" | "TWD 535.87" | PASS |
| M31 | currency negative TWD | "-TWD 2.90" | "-TWD 2.90" | PASS |
| M32 | currency USD/unknown = $ | ["$1.00","$1.00"] | ["$1.00","$1.00"] | PASS |
| M33 | relabel $ text for TWD | "TWD 1.59B" | "TWD 1.59B" | PASS |
| M34 | relabel negative $ text for TWD | "-TWD 450M" | "-TWD 450M" | PASS |

## Test totals

### Follow-ups (`terminal/fn5-acc2`), one suite at a time, memory checked first

```
pytest 27 files (implied-move callers + timing, ERX panel, Discord context, enrichment,
       earnings analysis/warm/router, ERN fiscal labels, earnings_history_fmp,
       fiscal_calendar, EE fiscal key, FA/EE depth, implied_store fiscal identity,
       earnings_intel model, earnings_table + router, reporting_currency x2,
       options vol, iv_history, vol_surface, earnings_reaction,
       terminal_accuracy_reference)                                             526 passed
vitest src/lib/presentation src/pages/terminal src/components/terminal
       src/pages/research src/components/research src/pages/calendar src/pages/cot
       Watchlists.term066 columnDefs.compact                                    254 files: 3283 passed, 5 skipped
vitest src/pages/charts/widgets (dock/widget TERM-066 oracles, currency)         49 files: 598 passed
Not this lane's (environmental): tests/test_hub_sandbox_model_keys.py 2 failures
(installed SDK env-var set + socket listener control) -- unrelated to these changes.
```

### Original lane (`terminal/fn4-accuracy`)

Run on branch `terminal/fn4-accuracy` after the last fix, one suite at a time, memory checked first:

```
pytest tests/test_terminal_accuracy_reference.py                                  35 passed
pytest test_implied_move + test_terminal_accuracy_reference                       42 passed
pytest calendar_enrichment x4, earnings_enrichment_spot_source, enrichment_implied_cutover,
       expected_move_router, implied_move_bounds, implied_reason_on_the_wire,
       implied_store, earnings_reaction_panel                                    188 passed
pytest fiscal_calendar, earnings_estimates_fiscal_key, implied_store_fiscal_identity,
       fa_ee_fmp_depth, reporting_currency (+ reference)                         177 passed
pytest earnings_intel_model, _consensus_fmp, _partial_cache, earnings_report_date,
       earnings_table, earnings_reaction, hist_stats, analyst_intel,
       transcript_chapters, reporting_currency_gaps, terminal_fund_awareness,
       calls_transcript_modernization                                            171 passed
vitest src/pages/terminal/panels (9 files)                                        73 passed
```

Pre-existing red, not this lane's: `tests/test_implied_backfill.py` — 15 failures,
`TypeError: fake_fmp() got an unexpected keyword argument 'timeout'` in its own fixture against
`implied_backfill.py:340`; neither file is touched by this branch.
