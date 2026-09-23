# Historical Fundamentals — SEC point-in-time proof of concept and foundation

**Date:** 2026-09-22 · **Branch:** `feat/historical-fundamentals` (local only, not pushed) · **Base:** origin/master = origin/production = `85b3a3355`
**Code:** `api/services/fundamentals_pit/` · `app/src/components/chart/engine/fundamentalAsOf.js` · tests in `tests/fundamentals_pit/` · reproducible harness in `tools/fundamentals_pit_poc/`

This pass made no production changes. There was no DB migration, no production backfill, no deploy, no provider purchase, and nothing was pushed.

---

## 0. Verdict

**All seven hard gates pass**, each with explicit limits.

For any past instant T, UCT can answer "what fundamental value was legitimately knowable at T?" It can also show *why*: every point names the SEC accessions it was computed from, and the answer depends only on the filing's public time.

The work surfaced sixteen real-data failure classes, and each is now handled by a written, tested rule (§7, §10, §11):
- restatements
- restatements visible only through XBRL dimensions
- sign-flip tagging errors
- rounding re-reports
- proxy-statement contamination
- tag switches
- scope-different tags
- cross-tag sign errors
- 52/53-week and 16-week quarters
- splits
- delinquent filers
- after-hours dissemination
- combined filings
- non-additive EPS
- XBRL phase-in blind spots
- company extension tags

**Recommendation:** proceed to the production foundation. Two production dependencies must come first: a persisted split ledger, and a restating-filing signal extracted from each 10-K/10-Q instance (§42).

---

## 1–2. State and isolation

| | |
|---|---|
| main checkout | `C:\Users\blake\projects\UCT-Dashboard` on `feat/app-themes` @ `1a5cb38a0`, dirty with another session's work. **Not touched.** |
| origin/master = origin/production | `85b3a3355` |
| worktree | `C:\w\fund`, a fresh path (checked: not a symlink, realpath = itself). Branch `feat/historical-fundamentals`. `app/node_modules` is a real copy, not a link (see the worktree-hazard memo). |
| untouched | Main Trading, Breadth V2, intraday, daily-history, Market Indicators, bars proxy, production env and DB. The local `C:\data\bars.db` and `screener.db` were opened **read-only** (`mode=ro`). |

## 3. SEC sources tested

Every source below was confirmed against official SEC documentation, fetched 2026-09-22.

| Source | Use | Measured |
|---|---|---|
| `data.sec.gov/api/xbrl/companyfacts/CIK#.json` | Raw facts, with every filing's copy of a period (`accn`, `form`, `filed`, `fy`/`fp` of the *filing*) | Keeps restated and original copies side by side: AAPL FY2019 revenue appears in 3 accessions |
| `data.sec.gov/submissions/CIK#.json` (+ `files[]` pages) | Accession → form, `filingDate`, `acceptanceDateTime` | `acceptanceDateTime` is true UTC. Checked against 34 raw EDGAR SGML headers (`*.hdr.sgml`): **34/34 exact** |
| `Archives/edgar/daily-index/xbrl/companyfacts.zip` | Bulk backfill and nightly reconciliation | 1.41 GB zipped / 19.3 GB, 20,393 entities; rebuilt nightly around 3 a.m. ET |
| `Archives/edgar/daily-index/bulkdata/submissions.zip` | Bulk accession metadata | 1.56 GB zipped / 5.74 GB, 991,200 members |
| Filing index plus the filing's own XBRL instance (`*_htm.xml`) | Restating-filing signal (§10) | Required. companyfacts cannot see dimension-only restatements |
| 8-K Exhibit 99 and 10-K/10-Q HTML | **Independent** validation text (§19) | A separate document from the XBRL aggregation |

**Fair access** (sec.gov "Accessing EDGAR Data"; privacy/security policy): at most **10 requests/s** across all machines, and a declared `User-Agent: <Company> <contact email>` is required. The harness uses UCT's existing UA and stays at 3–4 requests/s. **Update cadence:** the APIs update in real time (under a second for submissions, under a minute for XBRL), and the bulk ZIPs are rebuilt nightly. **Dissemination:** "submissions that begin after 5:30 p.m. ET … disseminated the next business day".

## 4–5. Company matrix and coverage

| Ticker | CIK | FYE | Facts | Accessions (10-K / 10-Q / amendments) | Weirdness exercised |
|---|---|---|---|---|---|
| AAPL | 320193 | late Sep | 25,135 | 17 / 52 / 10-K/A | **FY2009 10-K/A restatement.** 7:1 and 4:1 splits. 22 after-17:30 filings. `Cash` is a narrower tag |
| NVDA | 1045810 | late Jan (52/53-wk) | 27,281 | 17 / 52 | 4:1 (2021) and 10:1 (2024) splits. Revenue tag differs between 10-K and 10-Q. Capex is a company extension tag FY2013–23 |
| JPM | 19617 | Dec | 53,802 | 17 / 52 / 10-Q/A | Bank: no GP / OpInc / capex. 3,725 424B2 facts. **Proxy rounding contamination** |
| CAT | 18230 | Dec | 39,403 | 17 / 50 / 10-Q/A ×2 | `Revenues` (total) vs `SalesRevenueNet` (machinery) differ in scope. Net income tag switch. Equity incl. NCI only |
| CAVA | 1639438 | late Dec (52/53-wk) | 4,227 | 3 / 10 | IPO 2023. **16-week Q1.** 12 of 14 filings after 17:30. Stopped tagging GrossProfit |
| CELH | 1341766 | Dec | 12,550 | 10 / 30 / 10-K/A ×2 | **2021 restatement tagged only through dimensions.** 3:1 split. Sign flips. OCF cross-tag negatives |
| PLUG | 1093691 | Dec | 21,103 | 15 / 46 / 10-K/A ×4 | Rounding re-reports (−46,958,921 → −47,000,000). **Sign-flip tagging errors.** Negative revenue (2020) |
| SMCI | 1375365 | Jun | 24,315 | 14 / 42 / 10-Q/A ×3, 10-K/A | **2019 wave of 10-Q/A restatements.** No 10-K from 2017 to 2019 (delinquent). 10:1 split. 0.24% OCF revision |
| MSFT | 789019 | Jun | 32,671 | 17 / 50 / 10-Q/A | ASC 606 full-retrospective restatement under a new tag |

**Universe scan** (bulk archives, 46 s on 10 processes):
- 6,435 active 10-K/10-Q filers; 5,355 have tickers.
- **UCT screener universe:** 3,665 tickers.
  - 96.0% map to an SEC filer. The unmapped ones are ETFs and closed-end funds, which have no fundamentals.
  - Of the mapped filers, 3,094 file US-GAAP and 227 are IFRS-only.

## 6–7. Raw concepts and tag normalisation

**Primitives** are defined in `concepts.py`: revenue, gross profit, operating income, net income, diluted EPS, diluted weighted shares, operating cash flow, capex, cash, assets, liabilities, equity, long-term debt, DPS, and shares outstanding (dei cover page).

**Rules.** Each rule was measured on the data, and each has a test.

1. **Period identity comes only from (start, end).** A fact's `fy`/`fp` describe the *filing*: the FY2021 10-K reports FY2019 with `fy=2021`.
2. **Recency first, then priority.** For each period, the candidate tag **disclosed most recently** wins; if two tags come from the same filing, priority order decides. Restatements do arrive under new tags (SMCI's restated FY2015 revenue is `Revenues`, the original was `SalesRevenueNet`; MSFT's ASC 606 restatement also switched tags).
3. **Per-issuer equivalence pools.** Two tags are merged for derivation only when they co-report at least one period and agree on all of them. NVDA's `Revenues` and `RevenueFromContract…` agree on 15 of 15 periods and are merged. CAT's `Revenues` and `SalesRevenueNet` disagree on 79 of 79 and are not.
4. **Candidates must share scope.** Component tags are excluded: `SalesRevenueGoodsNet` (PLUG product sales, 2.2M of 15.2M) and bare `Cash` (AAPL 1.14B vs 5.26B).
5. **Cross-tag exact negatives are sign errors.** When two candidate tags report exact negatives for one period, the priority tag wins (CELH 2018 Q1 operating cash flow).
6. **Knowledge comes only from periodic and 8-K forms.** DEF 14A pay-versus-performance tables re-tag net income rounded (JPM FY2025 57,048M → 57,000M), and 424B/S-* facts are prospectus exhibits.
7. **A rounder copy never replaces a precise value.**

**Coverage** is the share of UCT's US-GAAP universe with the primitive: net income 99.9%, OCF 99.1%, assets 99.8%, cash 98.2%, equity 98.0%, EPS 92.5%, liabilities 91.1%, shares 87.7%, operating income 84.5%, revenue 83.4%, capex 81.1%, long-term debt 65.2%, gross profit **48.3%**, DPS 37.5%.

## 8. Accession → acceptance (GATE A)

| Scope | Accessions carrying relevant facts | Joined | Rate |
|---|---|---|---|
| 9-company matrix | 4,238 | 4,238 | **100%** |
| Whole SEC universe | 428,345 | 428,051 | **99.93%** |
| Active filers | 254,814 | 254,794 | **99.992%** |

- **Unjoined facts are excluded, never guessed.** That is 294 accessions across the universe, all from inactive or pre-EDGAR-JSON filers.
- **Combined filings** (one accession listed under two form types, 1 case in the universe) merge with a recorded anomaly: the periodic form wins, and the later public time wins.
- **Acceptance times match the raw EDGAR SGML headers 34/34.** The sample covers market-hours filings (CAT 12:14), 16:00–17:30 filings (CAT 17:15, same day), after-17:30 filings (AAPL 18:03 → next day), and Friday-night filings (NVDA 19:36, SMCI 21:58 → **Monday**).

## 9. Point-in-time temporal semantics

```
public_at  = max(acceptanceDateTime, filingDate 06:00 ET)      # the 17:30 rule, and EDGAR's opening hour
known(key, T) = the value from the latest filing with public_at <= T that reported key
bar value     = the last point with t_eff <= the bar's close   # daily 16:00 ET; W/M bucket end; intraday bar end
```

- A filing accepted at 16:42 ET is used from the **next** daily bar.
- Silence is not a retraction: a period not repeated in a later filing keeps its last disclosed value.
- **Staleness:** a point stops applying once its fiscal period is more than 200 days old at the bar. SMCI's 2017–2019 delinquency therefore shows **blank**, not a flat line.
- ⚠ **Known-by-filing is deliberately late, never early.** The 10-Q often follows the earnings press release by days or weeks. Aligning to the announcement date is deferred (§41).

## 10. Restatements and amendments (GATE B)

**Case 1 — AAPL FY2009** (10-K/A for new revenue-recognition standards). Both numbers were confirmed in the filing text itself.

| Instant (ET) | FY2009 revenue known |
|---|---|
| 2009-10-27 16:18:28 (T1 − 1 s) | none |
| 2009-10-27 16:18:29 (T1, 10-K) | **$36,537M**; the 10-K text states "Net sales $36,537" |
| 2010-01-25 16:25:57 (T2 − 1 s) | **$36,537M** |
| 2010-01-25 16:25:58 (T2, 10-K/A) | **$42,905M**; the 10-K/A text states "Net sales $42,905" |
| today | $42,905M, and the original is still reconstructable from the append-only history |

B is never shown before T2.

**Restatement epochs.** A value change opens an epoch only if it replaces a value that was on the current basis, and only if it exceeds **0.5%** (materiality). Facts known before an overlapping epoch are **stale for derivation**, so FY(restated) − 9M(original) can never manufacture a quarter.
- A **catch-up** filing, one that re-reports an already-stale value on the new basis, does not open a new epoch. Without this rule, AAPL's July 2010 10-Q voided correct data.
- A **sub-threshold** revision, such as SMCI's 0.24% OCF change, still applies to its own period but voids nothing else. Treating it as an epoch had blanked TTM cash flow for 3.5 months.

**Case 2 — CELH 2021.** This is where **companyfacts alone is not enough.**
- **What happened.** The FY2021 10-K (public 2022-03-16) tagged its restated quarters **only through dimensions** (`srt:RestatementAdjustmentMember`), and companyfacts carries only non-dimensional facts. The first non-dimensional restated Q3 value arrived in the 2022-11-09 10-Q.
- **Effect without a signal.** Between those dates, companyfacts-only derivation produced Q4'21 net income of −$3,354K (FY restated minus 9M original).
- **The fix.** Scan each filing's own XBRL instance for restatement-axis contexts (`restatement_signals.py`). With that signal the engine **withholds** Q3 and Q4 2021 from 2022-03-16, then shows −$9,371K and $11,942K once non-dimensional restated values exist. The −9,371 figure appears in the 10-Q text; 11,942 = FY 3,937 − 9M (8,005), and both inputs appear in the filings.
- **Additional source required: the filing-level XBRL instance.** Alternatively, the SEC Financial Statement & Notes data sets, which include dimensional facts.

**Other rules:**
- **Sign-flip tagging errors are quarantined** (PLUG FY2010 −47M/+47M/−47M; CELH Q2 2019).
- **Rounding re-reports are not restatements.**
- **XBRL phase-in warm-up:** for filers whose XBRL began before 2011-07, derived points are withheld for the first 365 days. Measured case: AAPL's Q1 FY10 10-Q, with restated comparatives, landed two minutes before the 10-K/A; the mixed-basis TTM was 40,340M against a true 46,708M. Applying the warm-up to *all* filers would hide every recent IPO for a year (PTRN, AIRO, EVMN, UROY), so it is scoped to that cohort.

## 11–12. Quarterly and Q4 reconstruction (GATE C)

**Quarter derivation, in order:**
1. A **DIRECT** quarter-length fact.
2. A **YTD** difference within one fiscal year and one tag pool: Q2 = 6M − Q1, Q3 = 9M − 6M, **Q4 = FY − 9M**.
3. **FY-SUM:** Q4 = FY − (three contiguous quarters), when no 9M figure was filed.

Durations of 75–125 days count as quarters, which covers 52/53-week and 16-week quarters. Subtraction is never allowed across different starts, tags, units, or non-quarter spans. When both a direct and a derived value exist, the direct one wins and the discrepancy is logged.

**Validated against press releases** (8-K EX-99), which are independent of XBRL:
- AAPL Q4 FY25 revenue 102,466 and NI 27,466 (**derived**) ✓
- NVDA Q4 FY26 revenue 68,127, NI 42,960, EPS 1.76 ✓
- JPM Q4'25 net revenue 45,798 and NI 13,025 ✓
- CAT Q4'25 revenue 19,133 and EPS 5.12 ✓
- CAVA Q4 FY25 (**16-week Q1 year**) revenue 274,985 and NI 4,921 ✓
- MSFT Q4 FY26 revenue 90,007, NI 35,766, EPS 4.81 ✓
- CELH Q4'25 revenue 721,628 ✓

⚠ **Derived Q4 EPS** differs by $0.01 in 2 of 5 cases (AAPL 1.84 vs 1.85; JPM 4.64 vs 4.63). EPS is not additive across periods. This is documented in the catalogue.

## 13. TTM (GATE D)

- **At fiscal year-end**, TTM is the **reported FY value**.
- **Otherwise**, TTM = FY(prev) + YTD(current) − YTD(prior-year comparative). The two YTD figures normally come from the same 10-Q, so they are on one basis even right after a restatement.
- **Fallback:** the sum of 4 contiguous standalone quarters.

Validated TTM values:
- AAPL revenue 416,161 ✓, EPS 7.46 ✓
- NVDA revenue 215,938 ✓
- CAT revenue 67,589 ✓, EPS 18.81 ✓
- CAVA revenue 1,179,664 ✓
- CELH revenue 2,515,269 ✓
- PLUG revenue 709,919 ✓
- SMCI revenue 39,063,072, NI 2,230,453, OCF (6,809,886) ✓ (10-K text)
- JPM NI 57,048 ✓
- MSFT OCF 182,935 and capex 115,948 ✓

**EPS TTM method:** exact at fiscal year-end. In between, the YTD roll can differ by $0.01–0.02 from vendors who sum four reported quarters. This is chosen and documented.

## 14. Derived metric results

These are coverage figures on UCT's universe. "Any" means the metric has any history; "Current" means its latest period is 2025-06 or later.

| Metric | Any | Current | Verdict |
|---|---|---|---|
| Net income TTM / quarterly | 95.4 / 93.8% | 94.2 / 92.2% | READY |
| ROA / ROE (TTM, average of two period ends) | 94.7 / 94.2% | 93.6 / 92.9% | READY |
| Assets / Equity / Cash | 97 / 96 / 97% | 96 / 95 / 95% | READY |
| OCF TTM | 95.0% | 92.8% | READY |
| EPS TTM (diluted, today's basis) | 90.8% | 87.0% | READY (requires split ledger) |
| EPS quarterly | 89.6% | 85.4% | DERIVABLE (Q4 ±$0.01) |
| Revenue TTM / quarterly | 85.5 / 83.2% | 82.4 / 79.4% | READY |
| Net margin TTM | 85.0% | 81.5% | READY |
| Revenue growth TTM / quarterly YoY | 84.4 / 81.7% | 80.7 / 78.4% | READY |
| Liabilities | 84.8% | 82.6% | READY (issuer must report the total) |
| Shares outstanding (dei) | 86.1% | 82.0% | READY (requires split ledger) |
| FCF TTM | 84.4% | 74.5% | READY (gaps where capex is an extension tag) |
| Operating margin / FCF margin | 73.8 / 77.7% | 67.6 / 67.9% | READY |
| EPS growth TTM / quarterly | 81.3 / 80.7% | 66.2 / 70.3% | READY (blank on a loss base) |
| NI growth / FCF growth | 82.2 / 73.8% | 70.9 / 58.4% | DERIVABLE (not in V1) |
| Gross margin TTM | 44.3% | **36.8%** | READY but low coverage (never synthesised) |
| Long-term debt, Debt/Equity | 75% | 58% | **AMBIGUOUS** (definitions disagree: 64 of 64 MSFT periods) |
| DPS TTM | 49.3% | 41.3% | DERIVABLE, V1.1 |

## 15–16. Market cap and valuation ratios

Checked against the local `bars.db` (split-adjusted to today) and the PIT series:
- **NVDA across the 10:1 split:** market cap $2.97T on 2024-06-07 and $3.00T on 2024-06-10, with P/E continuous.
- **Historical spot checks:** AAPL $2.91T, MSFT $2.53T, JPM $468B, CAT $111.8B (2021-12-31), MSFT $402B (2016-06-30).
- **AAPL P/E at 2021-12-31** = 177.57 / 5.61 = 31.65.

Rules:
- Price-derived metrics use contemporaneous denominators only; today's share count is never used.
- P/E is blank when EPS ≤ 0, and P/B is blank when equity ≤ 0.
- A genuine near-zero revenue gives a genuine extreme P/S (PLUG 2021: 519×) rather than a clipped one.

**Dependency:** a persisted **split ledger**. The POC used Yahoo's split history as a stand-in. The SEC-inferred split events match it for every split in the matrix: NVDA 4:1 in (2021-05-26, 2021-08-20] against an ex-date of 07-20, and 10:1 in (2024-05-29, 2024-08-28] against 06-10; AAPL 7:1 and 4:1 also match. The same inference picked up AAPL's 2009 restatement as a non-split, correctly.

## 17. Beta

- **Current state.** UCT's beta is a vendor snapshot only (FMP profile / yfinance), with no stated method. It is not historical.
- **Proposed.** **Beta (1Y vs SPY):** the OLS slope of 252 aligned daily price returns (minimum 200), split-adjusted, **not** dividend-adjusted, computed over common trading days so gaps never fabricate zero returns.
- **Checks.** Sanity values: SMCI 3.8, AAPL 0.68–1.3, JPM 0.67–1.34. Tests pin β(SPY, SPY) = 1 and a 2× levered series = 2.
- **Owner decision:** the name and window. 1Y daily is responsive; Bloomberg's default is 2Y weekly, and Yahoo uses 5Y monthly.

## 18. As-of projection (GATE F)

- **Implementations.** Python `asof.py` and JS `fundamentalAsOf.js` implement the same rule with the same cases.
- **Tests.** 10 JS tests; the Python suite has 60 tests in total.
- **Separate from `sym:`.** `projectSymbolField` keeps exact-`t`, no fill, and that stays pinned by the same test file.
- **Operator.** O(bars + points) with one forward pointer; DST-aware 16:00 ET close.

## 19. Independent SEC comparison matrix

"Ours" is the engine's output; "Document" is the separate human-readable filing.

| Company | Period | Metric (method) | Ours | Document | Result |
|---|---|---|---|---|---|
| AAPL | Q4 FY25 | Revenue (Q4 = FY − 9M) | 102,466 | 8-K EX-99 "Total net sales 102,466" | ✓ |
| AAPL | Q4 FY25 | Net income (derived) | 27,466 | "Net income $27,466" | ✓ |
| AAPL | Q4 FY25 | EPS (derived) | 1.84 | "Diluted $1.85" | **±0.01** |
| AAPL | FY25 | Revenue / EPS TTM (FY) | 416,161 / 7.46 | same | ✓ |
| AAPL | FY09 | Original / restated revenue | 36,537 → 42,905 at T2 | 10-K / 10-K/A text | ✓ |
| NVDA | Q4 FY26 | Revenue / NI / EPS (derived) | 68,127 / 42,960 / 1.76 | EX-99 | ✓ |
| NVDA | FY26 | Revenue TTM | 215,938 | EX-99 | ✓ |
| JPM | Q4'25 | Net revenue / NI (derived) | 45,798 / 13,025 | EX-99 | ✓ |
| JPM | Q4'25 | EPS (derived) | 4.64 | "Diluted 4.63" | **±0.01** |
| JPM | FY25 | NI TTM | 57,048 | EX-99 | ✓ (was 57,000 before the proxy fix) |
| CAT | Q4'25 / FY25 | Revenue, EPS | 19,133 / 5.12 / 67,589 / 18.81 | EX-99 | ✓ |
| CAVA | Q4 FY25 | Revenue / NI / TTM | 274,985 / 4,921 / 1,179,664 | EX-99 | ✓ |
| MSFT | Q4 FY26 | Revenue / NI / EPS; OCF, capex FY | 90,007 / 35,766 / 4.81; 182,935 / 115,948 | EX-99 | ✓ |
| CELH | Q4'25 | Revenue / TTM | 721,628 / 2,515,269 | EX-99 | ✓ |
| CELH | Q3'21 | NI original → restated | 2,745,791 → (9,371)K at 2022-11-09 | 10-Q texts | ✓ |
| SMCI | FY26 | Revenue, NI, OCF, equity | 39,063,072 / 2,230,453 / (6,809,886) / 14,479,452 | 10-K text | ✓ |
| PLUG | FY25 | Revenue TTM | 709,919 | EX-99 | ✓ |
| — | — | Acceptance times | 34 filings | EDGAR SGML headers | 34/34 ✓ |

**Not verifiable from the documents:** PLUG Q4'25 standalone revenue and AAPL Q2 FY26 balance sheet. The press release does not state them, and the harness had the wrong 10-Q accession for the balance sheet.

## 20. Hard gates

| Gate | Verdict |
|---|---|
| **A** accession → acceptance | **PASS.** 100% on the matrix, 99.992% across active filers, 34/34 against raw headers. |
| **B** original vs amended knowledge | **PASS, with a characterised limit.** Restatements that are only dimensional need the filing-level instance signal. It is implemented and proven on CELH, and must be ingested in production. |
| **C** standalone quarters | **PASS.** Derived Q4 matched the press release in every flow case; EPS Q4 is ±$0.01. |
| **D** deterministic TTM | **PASS.** Validated against 10+ documents; byte-identical on re-run. |
| **E** tag normalisation | **PASS for 14 primitives.** Debt is AMBIGUOUS, IFRS is out of scope, and extension tags are an honest gap. |
| **F** no lookahead | **PASS.** Close-referenced as-of, the 17:30 rule, and the staleness cap, in both languages. |
| **G** ≥15 truthful metrics | **PASS.** 29 in the V1 catalogue: 22 SEC-quarterly, 6 daily price-derived, and Beta. |

## 21–24. Metric classification

- **READY (V1):** revenue TTM and quarterly, net income TTM and quarterly, OCF TTM, FCF TTM, revenue growth TTM and quarterly, net margin, operating margin, FCF margin, gross margin (low coverage), ROE, ROA, cash, total assets, total liabilities, equity, and Beta 1Y.
- **READY once the split ledger exists:** EPS TTM, EPS growth TTM and quarterly, shares outstanding, market cap, P/E TTM, P/S, P/B, FCF yield.
- **DERIVABLE:**
  - Needs a footnote: EPS quarterly (Q4 ±$0.01).
  - V1.1: NI growth, FCF growth, DPS and dividend yield, current ratio, 5-year growth rates.
- **BLOCKED:**
  - No point-in-time source exists: forward P/E, PEG, EPS next-5Y, analyst targets.
  - Source exists but is not ingested: institutional and insider ownership (13F; Forms 3/4/5).
- **AMBIGUOUS:** total debt, Debt/Equity, and enterprise value (inconsistent debt tags); IFRS filers (US-GAAP map only).

## 25. V1 Fundamentals catalogue

Defined in `api/services/fundamentals_pit/catalog.py`. `assert_catalogue_truthful()` enforces that every entry is point-in-time sourced and that nothing snapshot-only can appear.

| Category | Metric (default style) |
|---|---|
| **Financials** | Revenue (TTM), Revenue (Quarterly), Net Income (TTM), Net Income (Quarterly), EPS (TTM, Diluted), EPS (Quarterly, Diluted), Operating Cash Flow (TTM), Free Cash Flow (TTM), all **step** |
| **Growth** | Revenue Growth (TTM YoY), Revenue Growth (Quarterly YoY), EPS Growth (TTM YoY), EPS Growth (Quarterly YoY), all **step** |
| **Profitability** | Gross Margin, Operating Margin, Net Margin, FCF Margin, ROE, ROA, all **step** |
| **Financial Health** | Cash & Equivalents, Total Assets, Total Liabilities, Shareholders' Equity, all **step** |
| **Shares** | Shares Outstanding, **step** |
| **Valuation** | Market Cap, P/E (TTM), Price/Sales, Price/Book, FCF Yield, all **line** (daily) |
| **Market** | Beta (1Y vs SPY), **line** |

Each entry carries its id, member name, unit, format, methodology text, measured coverage, dependencies, the linked screener column, and whether its definition differs from the screener's.

## 26. Canonical metric identity

- **The id is the concept plus its definition.** Screener column names become ids where the definition matches (`net_margin`, `roe`, `gross_margin`, `op_margin`); new ids are used otherwise.
- **Linking.** `screener` links the lanes, and `screener_definition_differs` marks cases like ROA (FMP uses ending assets; ours averages two period ends).
- **No migration.** Saved screens and formulas keep `pe_fwd`-style ids, as the audit recommended.
- **Next step:** a registry endpoint serving this catalogue plus the screener's `meta()` from one module, with a rail that compares the latest point per id across lanes within a tolerance.

## 27. Storage design (proposal; no schema created)

The schema is benchmarked in `tools/fundamentals_pit_poc/bulk/storebench.py`:

```
filing(filing_id, cik, accn UNIQUE, form, filing_date, accepted_at, public_at, retrieved_at)
concept(concept_id, tag UNIQUE)
fact(cik, concept_id, unit, period_start, period_end, val, filing_id)   PK(all but val)  WITHOUT ROWID   -- APPEND-ONLY
filing_signal(filing_id, kind='restating', span_start, span_end, source='instance')           -- §10
split(ticker|cik, ex_date, ratio, source, verified_by_sec_inference)                         -- ledger
series_point(cik, metric, t_eff, v, period_end, method, sources JSON, derivation_version)     -- DERIVED, rebuildable
ticker_cik(ticker, cik, valid_from, valid_to)                                                  -- ticker reuse
snapshot_capture(day, symbol, metric, value, provider, retrieved_at)                          -- §30
```

- `fact` rows are never updated or deleted.
- `series_point` is a pure function of `fact`, `filing_signal`, `split` and `derivation_version`, so it can be dropped and rebuilt at any time.

## 28. Series / API design

`GET /api/fundamentals/pit/{symbol}?metrics=net_margin,revenue_ttm`
→ `{symbol, cik, derivation_version, as_of, metrics: {id: {unit, fmt, presentation, points: [[t_eff_unix, v, "period_end"]]}}}`

- **Payloads.** One metric is about 64 points / 2.9 KB of JSON. All metrics for a symbol are 107 KB, or about 15 KB gzipped.
- **Caching.** The payload is immutable until the next filing, so it can be edge-cached: ETag = derivation_version plus the last accession, the same pattern as sealed bars history.
- **Price metrics.** Market Cap, P/E and the others are composed **on the client** from the chart's own split-adjusted close multiplied by the as-of denominator. They then work on every timeframe, including live intraday, and use the exact bars on screen.
- **Beta** is a server-computed daily sparse series, projected as-of.

## 29. Indicators integration

- **Source kind.** Add `fund:<SYM>:<metric>` to `parseSource`, plus the roughly 12 `kind ===` branch sites the audit listed. Consider a source-kind registry at the same time.
- **Fetch.** A cache module modelled on `secondaryBars`.
- **Binder.** For a `fund` source, call `projectAsOf(points, bars, tf)`. The `sym:` path is untouched.
- **Rendering.** `dataSeries` passes the column through, and the existing pane, legend, micro-rail, Display and Style controls apply.
- **Default style.** A `fundamental` presentation that defaults to **step** for quarterly metrics. The 2026-09-21 ruling (surveys `step` → `line`) stays as it is; fundamentals need their own mapping.
- **Formatting.** Unit-aware legend and axis formats: compact USD, percent, `×`.
- **Discovery tab.** A catalogue hook plus a `fundamentalResults` adapter, with rows grouped by category. Only rows with `history.point_in_time` appear, so the "not chartable yet" copy retires.
- **Formulas, later.** A fundamental enters as a `type:'source'` input on native definitions now; AST series references come later.

## 30. Snapshot archive for forward and analyst metrics

**Why.** Forward P/E, PEG, EPS next-5Y, consensus, targets and forward EPS/sales can never be reconstructed. Every day not captured is history lost for good.

**Design.** A nightly append-only row per metric: `(day, symbol, metric, value, provider, retrieved_at)`, written after the screener build. Charts label it "UCT-captured since <date>" and start at the first capture, with no backfill.

**Storage.**
- 5–8 metrics × 3,665 symbols × 252 days ≈ 4.6–7.4M rows per year, about 150–250 MB per year at ~30 bytes/row.
- Alternatively, reuse or verify the R2 D12 archive, which may already hold daily `screener_rows` from 2026-09-16 (unverified).

## 31–33. Backfill, incremental ingestion, and reconciliation

**Initial backfill:**
1. Download both bulk ZIPs: 3 GB, about 2.5 minutes at the measured 12–22 MB/s.
2. Stream-parse them (the zip is never extracted).
3. Append facts and filings for the universe.
4. Build the series.

Measured: the whole SEC universe in **277 s on 10 processes**. UCT's 3,133 filers loaded into SQLite in 624 s single-process.

**Incremental** (worker, filing hours 06:00–22:00 ET):
- Poll EDGAR's latest-filings feed every ~5–10 minutes for 10-K, 10-Q, their amendments, 10-KT and 8-K from mapped CIKs.
- For each hit:
  - fetch submissions (~0.2 MB) and companyfacts (median 2.6 MB, p95 5 MB);
  - append new (key, accession) rows;
  - fetch the filing instance to detect a restating signal;
  - rebuild that CIK (0.03–0.9 s);
  - publish and purge its cache.
- Latency is under 15 minutes from dissemination. No member action is involved.

**Nightly reconciliation**, after SEC's ~3 a.m. rebuild:
- Re-diff the bulk ZIPs against the store; any missing (key, accession) is appended.
- Recompute the per-CIK series hash; mismatches are rebuilt and reported.
- Check that the split ledger agrees with SEC-inferred splits.
- The run is self-healing, and a missed poll can never persist.

## 34. Storage and performance (measured)

| | Rows | Size |
|---|---|---|
| UCT universe (3,133 US-GAAP filers): filings | 137,645 | |
| Raw facts | **3.82M** | |
| Derived series points | **2.88M** | |
| SQLite, all three | | **391 MB** |
| Whole SEC history, relevant tags | 15.5M raw facts | ~1.5 GB extrapolated |
| Reads | AAPL one metric 64 pts | <0.1 ms; all metrics 1.5 ms |

The audit's estimate of 12–20M rows and 1–2 GB was for all SEC tags. UCT needs **~0.4 GB**.

## 35–37. Cost

| | One-time | Ongoing per month (ranges; assumptions noted) |
|---|---|---|
| **Data licensing** | **$0** | **$0.** SEC EDGAR data is public and free under fair access (10 requests/s, declared UA). No new provider. |
| Download | ~3 GB bulk | Incremental ~0.2–1 GB/day in peak season, plus a nightly 3 GB reconciliation pull (ingress, normally free) |
| Compute | ~1 CPU-hour (backfill plus rebuild) | Nightly reconciliation ≈ 5–45 CPU-minutes; incremental seconds per filing. **< $5/mo** at typical Railway vCPU rates |
| Storage | ~0.4 GB (+0.2 GB/yr snapshot archive) | **< $1/mo** at ~$0.15–0.25/GB-month volume pricing |
| Egress / API | — | ~3–15 KB per chart open, edge-cacheable; negligible next to bars |

Exact dollar amounts depend on the current Railway plan, which this pass did not query.

## 38–39. Tests, files, commits

- **Python:** `tests/fundamentals_pit/`, **60 tests**, all passing. They cover:
  - filings: the 17:30 rule, Friday nights, combined filings
  - knowledge: no-lookahead, amendments, reconstruction, sign flips, rounding, proxy exclusion, epochs (catch-up, materiality, filing signal)
  - quarters: YTD, Q4, FY-SUM, 16-week quarters, refusals
  - metrics: TTM, YTD roll, YoY, margins, zero denominators, units, tag pools, cross-tag rules, stale withholding, ROE
  - as-of, price-derived, splits and beta
  - golden real-SEC fixtures (AAPL FY2009, NVDA 2024 split)
  - catalogue truthfulness and series emission
- **JS:** `fundamentalAsOf.test.js`, 10 tests, plus `symbolProjection.test.js` (21) still passing.
- **Repo guards:** `test_test_discovery_coverage.py` and `test_cross_module_imports_resolve.py` pass.
- **Commit:** see the git log on `feat/historical-fundamentals`. It is local only.

## 40. Risks

1. **Split-ledger completeness** gates every per-share and price metric; this is the same class as the breadth corporate-action P0. Mitigation: a ledger verified against SEC-inferred splits.
2. **Restatements visible only through dimensions** need instance scanning in production. Without it, derived quarters can be wrong (CELH) for months.
3. **First-year restatements** by post-2011 filers with no dimension signal: a residual risk, detected once the next comparative arrives.
4. **Extension tags:** honest gaps (NVDA capex).
5. **Multi-class share counts** are dimensional, so market cap is unavailable for those issuers.
6. **Filing lag vs press release:** late, never early.
7. **EPS non-additivity:** ±$0.01.
8. **10-KT fiscal-year changes** are not exercised by this matrix.
9. **Fair access:** the production UA must name a monitored contact, with one global rate limiter across pods.
10. **Any `api/**` push restarts the Breadth worker** (per memory). Ingestion deploys must be sequenced around Breadth V2.

## 41. Deferred

- Earnings-announcement-date alignment (known-by-press-release).
- DPS and dividend yield.
- Current ratio.
- 5-year growth rates.
- Debt / EV / D/E, which needs an issuer-validated debt definition.
- IFRS filers.
- 13F and insider ownership history.
- Formula, Condition and Alert consumers.
- An "as first reported" toggle.
- Multi-class market cap.
- Forward and analyst metrics, which become possible only through snapshot capture from now on.

## 42. Next implementation phase — the production foundation

These steps are behind flags and shadow-only until acceptance:

1. **Split ledger.** Persisted, with a scheduled writer (Massive `/v3/reference/splits`, which is already called in code), and reconciled nightly against SEC-inferred splits.
2. **PIT store and ingestion worker.** The §27 schema plus the §31–33 jobs, including restating-signal extraction from each filing instance.
3. **API and edge publish** per §28.
4. **Engine integration** per §29, accepted in a ChartWidget **extra tab**, the one surface that never writes global `chart_settings`.
5. **Start the forward-metric snapshot capture now.** It is independent and cheap, and it is the only way that history will ever exist.

## 43. Recommendation

**Proceed to the production foundation.** Owner decisions needed:
- Beta naming and window.
- Whether quarterly EPS ships with its ±$0.01 Q4 note.
- Gross margin at 37% coverage: ship it, or synthesise from cost lines later.
- Where the store lives: a worker DB plus R2/edge publish is recommended.
- Starting snapshot capture immediately.
