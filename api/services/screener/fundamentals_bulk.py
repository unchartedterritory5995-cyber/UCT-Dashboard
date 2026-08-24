"""The bulk fundamentals pass — Group A's ten columns, plus `exchange`.

🔴 WHAT WAS WRONG. Eleven columns of `snapshot_db.COLUMNS` were declared ahead
of any collector and were NULL on all 3,708 rows of the live snapshot:

    dividend_yield  pe_ttm  ps  pb  gross_margin  net_margin
    roa  debt_to_equity  current_ratio  beta          + exchange

⭐ AND THREE MORE JOINED THEM ON 2026-08-09 — `op_margin`, `roe`, `peg` — not
because they lacked a collector but because they had TWO. See "THREE COLUMNS
CHANGED HANDS" below; that is an ownership decision, and it is the reason this
module now writes FOURTEEN columns rather than eleven.

The values exist in this repo — `research/financials.py` and
`research/snapshot.py` build them for the research page — but ONE SYMBOL AT A
TIME, on demand. Filling ~3,700 names that way is ~3,700 provider calls per
night, and a bulk job that starves a shared provider budget is a measured defect
here. This module is the bulk pass: **six HTTP requests for the whole market.**

──────────────────────────────────────────────────────────────────────────────
WHICH ENDPOINTS, AND WHY — PROBED, NOT ASSUMED
──────────────────────────────────────────────────────────────────────────────
Every line below was measured against the live FMP account on 2026-08-09, not
read off the documentation. The repo has already been bitten by assuming: the
legacy v3 family 403s on this plan, and it still does —

    GET /api/v3/ratios-ttm/AAPL -> 403 "Legacy Endpoint ... only available for
                                   legacy users ... prior August 31, 2025"

⭐ THE BULK ENDPOINTS RETURN **CSV**, NOT JSON. That is not a detail: the
existing `api/services/fmp_bulk.py` calls them through `earnings_estimates
._fmp_get`, which ends in `r.json()`, so it raises on every response, returns
`None`, and `fetch_fundamentals_bulk()` has been returning `{}` unconditionally.
(It is a different consumer — the ratings gather — and it is left alone here,
but it is reported.) This module parses CSV, streamed.

    ENDPOINT                        BYTES   COVERS OF OUR 3,742-NAME UNIVERSE
    /stable/ratios-ttm-bulk         69.7MB  3,679  10 of the thirteen
    /stable/key-metrics-ttm-bulk    44.3MB  3,679  roa + roe
    /stable/profile-bulk?part=0..3 114.0MB  3,738  beta + exchange

`/stable/company-screener` was the cheaper candidate for beta+exchange (JSON,
~2MB, three calls) and was REJECTED after measuring: `exchange=NASDAQ` returned
EXACTLY 10,000 rows, i.e. it was truncated at its cap, and it reached 3,718
names against profile-bulk's 3,738. A silently-capped list is the failure this
whole phase exists to remove. profile-bulk paginates over the entire database,
so its coverage is a property of the walk rather than of a limit we hope is big
enough — and the walk's end is DERIVED (a part that 400s) rather than a part
count restated here, which is how such a number goes stale.

──────────────────────────────────────────────────────────────────────────────
🔴 THE ZERO QUESTION — THE ONE WAY THIS FEATURE COULD SHIP A LIE
──────────────────────────────────────────────────────────────────────────────
The dangerous outcome is not a missing number, it is a PLAUSIBLE WRONG one.
FMP emits a literal `0` where a ratio is UNDEFINED, and `0` is a perfectly
well-formed float that passes every consistency check downstream. Measured over
our universe:

    currentRatioTTM == 0 on 163 rows — AB, ABCB, ACGL, AFG, AGO, AIZ, AMAL,
    ARCC ... every one a BANK, INSURER or BDC. They have no current/non-current
    balance-sheet split, so FMP has no ratio and prints 0. Writing it makes
    `current_ratio < 1` return every financial in America.

⭐ SO A ZERO IS WRITTEN ONLY WHEN AN INDEPENDENT FIELD IN THE SAME ROW SAYS THE
NUMERATOR IS GENUINELY ZERO. That is ONE principle, not ten judgement calls,
and each column names its own corroborator in `SPECS` below. The two directions
were both measured:

  * `dividendYieldTTM == 0` on 1,712 rows, and `dividendPerShareTTM == 0` on
    **all 1,712 of them**. A non-payer's yield IS 0. ⭐ KEPT — refusing these
    would blank 47% of the column and make "no dividend" unscreenable.
  * `debtToEquityRatioTTM == 0` on 240 rows, of which **238** also read 0 for
    `debtToAssetsRatioTTM` AND `debtToCapitalRatioTTM` — three quotients with
    three different denominators agreeing, which is a debt-free company
    (ANET, AFL, AL, ARCC). KEPT. The other 2 (AHRT, MARA) are refused.
  * Everything else has no corroborator and its zeros track a dead denominator:
    `pe_ttm` 4 zeros / 4 with zero EPS · `ps` 226 / 225 with zero revenue ·
    `net_margin` 228 / 228 with zero revenue. REFUSED.
  * `pb` reads 0 for MARA, PTON, VST, ABX with *non-zero* book value per share —
    provider noise, not a price/book of zero. REFUSED.

⛔ NO DEFAULTS, NO ZERO-FILL, NO CARRY-FORWARD. A ticker FMP has no row for
keeps NULL and is COUNTED as a miss (`fmp_bulk: {'no_row': N}`), because a
provider failure that reads as success is the other half of the same defect —
`built=3708 skipped=0 errors=0` was printed over a column that was NULL 3,708
times.

⛔ AND NO SANITY BOUND. `beta` genuinely ranges (-43.73, 10.00) over this
universe and a P/E of 5,000 is a real barely-profitable company. A clamp here
would be a threshold with nothing to tune it against; only non-finite values
are refused. ⭐ STILL TRUE AFTER 2026-08-23. The three refusals the accuracy
audit added are not clamps — each is one row contradicting itself (a long-term
ratio against its own total-debt reading, a P/B against its own book value, a
gross margin against its own revenue), and each is stated with the measurement
that shows what it costs. The two audit-proposed rails that WERE plausibility
bounds in disguise were measured and rejected; see the last section.

──────────────────────────────────────────────────────────────────────────────
⚠️ UNITS — THE OTHER SILENT-WRONG-NUMBER TRAP
──────────────────────────────────────────────────────────────────────────────
FMP returns margins, yields and returns as FRACTIONS (AAPL grossProfitMargin
0.4865). This table stores them as PERCENT, and that is not a preference: it is
the convention the columns beside them already carry (`op_margin`/`roe` arrive
via `enrich.ratings_fields` from `get_fundamentals`, whose `_round_pct` is a
×100) and it is stated in `app/src/pages/screener/columnDefs.js`:

    // NOTE: margins / growth / roe / roa / dividend_yield are stored as PERCENT
    // numbers by the snapshot builder (e.g. 25.0 == 25%), so format directly.

Writing 0.4865 into `gross_margin` would render "0%" and make every margin
filter a silent zero-hit. The ×100 is carried in `SPECS.scale` so the scaling
lives beside the field it scales and cannot drift from it.

⭐ `pe_ttm`/`ps`/`pb`/`debt_to_equity`/`current_ratio`/`beta` are PLAIN RATIOS
(scale 1.0). `filters.py` used to claim `debt_to_equity` was "the yfinance value
(percent-ish, e.g. 47.5)" — a description of a column that had never held a
value, from a provider that never wrote it. FMP's native form is the ratio, the
manifest sentence is "the debt-to-equity ratio", and `columnDefs.js` renders it
with `num(1)` rather than a percent formatter. That docstring is corrected in
the same commit rather than left to contradict the data.

──────────────────────────────────────────────────────────────────────────────
⭐ ONE AUTHORITY PER COLUMN
──────────────────────────────────────────────────────────────────────────────
This module writes ELEVEN columns and no others. In particular it does **not**
write `market_cap` even though `key-metrics-ttm-bulk` carries it and
`profile-bulk` carries it again — `massive.get_market_cap` is that column's
authority as of `12071063`, and a second computation of one value is this
repo's most repeated defect. Nor does it write `company`/`sector`/`industry`
(the `ticker_meta` cache owns those). `test_the_bulk_map_is_disjoint_from_every
_other_source` is the rail on that, derived from the source maps rather than
from a list retyped in a test.

🔴 THREE COLUMNS CHANGED HANDS ON 2026-08-09, AND THAT NEEDED A DECISION, NOT
A COMMIT. `op_margin`, `roe` and `peg` were sitting in the files this pass
already downloads (`operatingProfitMarginTTM`, `returnOnEquityTTM`,
`priceToEarningsGrowthRatioTTM`) — zero extra requests. But
`enrich.ratings_fields` ALREADY CLAIMED all three, and
`RATINGS_PERCENTILE_ENABLED=1` on Railway, so that path RUNS IN PRODUCTION.
Wiring them here without settling ownership would have created a live second
authority resolved by nothing but the merge order in `build_row` — the defect
`12071063` spent its whole effort removing from `rs_rank`/`rs_return`.

⭐ THIS MODULE WON, ON FOUR MEASURED GROUNDS:

  1. COVERAGE. This pass answers for 3,679 of 3,742 names EVERY night in six
     requests. The ratings gather is per-symbol yfinance behind a
     `RATINGS_PERCENTILE_MAX_PER_RUN` cap and a 6-day TTL, so its coverage is a
     function of how many nights it has managed to run — and on this box its
     store is 0 bytes.
  2. ONE BASIS PER ROW. `gross_margin`, `net_margin` and `roa` already come from
     here, on an FMP TTM basis. Leaving `op_margin` and `roe` on yfinance would
     put two different accounting bases in ADJACENT COLUMNS of one row, where a
     member comparing three margins is comparing two providers.
  3. PROVIDER HEALTH. yfinance has silently dropped whole symbol families on
     this box (`lesson_a_dead_symbol_may_be_a_dead_provider`). FMP Ultimate is
     the paid plan the other ten already depend on.
  4. NOTHING IS LOST. `enrich` needs `op_margin`/`roe`/`peg` as INPUTS to the
     SMR and Value legs of `uct_composite`, and it still reads them — from
     `metrics`, which is the ratings store, not from the snapshot row. It has
     simply stopped ALSO emitting them as columns. That is exactly the shape
     `enrich` already uses for `rs`: still computed, no longer an output.

⛔ THE OTHER WRITER WAS REMOVED, NOT LEFT TO AGREE.
`test_no_two_screener_sources_write_the_same_column` derives every source's key
set BY RUNNING IT and fails on any pair that overlaps, so a second writer is a
red test rather than a silent race decided by dict order.

`exchange` DOES come from here, and that supersedes the plan to add a Massive
accessor. The objection to the Massive route was sound — `get_ticker_details`
is uncached and `get_market_cap` discards the payload, so a naive map is a
second HTTP round-trip × 3,708, and Polygon's `primary_exchange` is a MIC
(`XNAS`), so writing it raw would make `exchange == "NASDAQ"` a silent
zero-hit and create a MIC→name mapping to own. None of that applies here:
profile-bulk is a call this module already makes, and its `exchange` field is
ALREADY the plain name — measured over our universe: NYSE 1,926 · NASDAQ 1,711
· AMEX 95 · CBOE 5 · PNK 1. No mapping, no extra request, one authority.

──────────────────────────────────────────────────────────────────────────────
⭐ WHAT THE DENOMINATORS ACTUALLY ARE — MEASURED 2026-08-23, NOT ASSUMED
──────────────────────────────────────────────────────────────────────────────
`roe` and `roa` do NOT stand on the same balance-sheet vintage, and until this
was measured nobody could have known, because it is written in no FMP
documentation this repo has ever cited. Recomputed from as-reported quarterly
statements and matched against the value this module stores:

    roe = TTM net income ÷ the AVERAGE of the last four quarters' equity
    roa = TTM net income ÷ ENDING total assets

    ticker   stored roe   NI ÷ avg equity      stored roa   NI ÷ ending assets
    NVDA       111.6575          111.657          61.5141           61.514
    RDDT        29.0241           29.024          23.9535           23.954
    ARM         13.0008           13.001           9.3248            9.325
    PLD          7.9006            7.901           4.1661            4.166
    VALU        20.3973           20.397          14.2381           14.238

Five names to five significant figures, so this is settled. Two consequences,
and the second is the one that bites:

  1. THE AVERAGE-EQUITY DENOMINATOR IS DEFENSIBLE AND UNPUBLISHED. It is the
     standard textbook ROE and it is why a fast-growing company reads high
     against an ending-equity computation — NVDA 111.66 here vs 81.65 on ending
     equity, a THIRTY POINT difference on the most-screened name in the market.
     ⛔ DO NOT "fix" this to ending equity: it is correct, and changing it
     would move `roe` for every growing company on the board. The gap is a
     DOCUMENTATION defect — the number needs a member-facing `desc`, which
     lives in `app/src/pages/screener/columnDefs.js` and not in this file.
     (Corroboration from inside the payload itself: `key-metrics-ttm-bulk` also
     ships `averageInventoryTTM` / `averageReceivablesTTM` /
     `averagePayablesTTM`, so averaged balance-sheet inputs are this provider's
     house style, not a surprise.)
  2. `roe >= roa` IS THEREFORE NOT A FREE IDENTITY HERE. It holds when both
     stand on the same vintage. These do not, so a fund whose equity is
     essentially its assets and whose assets shrank over the year reads
     roe < roa legitimately. That is measured, and it is why the audit's
     proposed rail is not shipped. See below.

──────────────────────────────────────────────────────────────────────────────
🔬 WHAT THE 2026-08-23 ACCURACY AUDIT ASKED FOR AND DID NOT GET
──────────────────────────────────────────────────────────────────────────────
The audit named four columns. Two were repaired above; two were re-measured
over the whole 3,681-name universe and the proposed repair was REFUSED, because
every candidate detector blanked more correct values than wrong ones. Recorded
here rather than in the report alone, because the next reader will otherwise
"fix" them, and the counts are the whole argument.

⛔ `roe` — GBLI's 0.019% IS WRONG (reported TTM net income $34.306M ÷ equity
$710.905M = 4.83%; yfinance 4.879%; FMP's own netIncomePerShare ÷
bookValuePerShare 4.80%). It is not repaired here, because:
  * the class is THREE rows in 3,674 — GBLI, GNK, TSLX, each publishing ~1/250
    of its own payload's ending-equity ROE;
  * `roe >= roa` (both positive) fires on 23 rows. Adjudicated one by one
    against `netIncomePerShareTTM / bookValuePerShareTTM`: 3 are the real break,
    5 are rows whose ROA is the broken half (NVST publishes roa 1,697,307% and
    SR 3,891,136% — see the requirement below), and 15 are legitimate, being
    closed-end funds and shrunken balance sheets caught by the mixed vintage in
    (2) above. Refusing on it blanks five correct values for every wrong one;
  * cross-checking `roe` against that same-row oracle needs an order-of-
    magnitude band, and there is no cliff to put one on: |log10(roe/oracle)|
    ≥ 3 catches 3 rows, ≥ 2 catches 12, ≥ 1 catches 22, and the rows it picks up
    between 1 and 2 (BCAR, RHLD, SORN, OPAL) are companies whose equity crossed
    through zero mid-year, so their average equity is genuinely tiny and their
    huge ROE is genuinely what the definition produces.
  ⇒ REQUIREMENT, not a patch: this is the detect-heal-alert shape
    `api/services/fundamentals_monitor.py` already runs for the earnings table.
    A monitor may ALERT on a row whose `roe` and its own ending-equity ROE
    differ by 100×; a nightly build may not silently blank it.

⛔ `gross_margin` — PLD's 29.05 against a reported 74.31 IS WRONG, and it is
below PLD's own `op_margin` of 38.43, which no non-negative operating expense
allows. It is not repaired here, because `gross_margin >= op_margin` is not
airtight against this provider either: it fires on 199 of 3,452 rows (5.76%),
and the violation runs continuously from LMT at −0.09pp (two line items rounded
off one another) through PLD at −9.4pp to FVR at −74pp, with no gap to cut at.
129 of the 199 have an `op_margin` ABOVE 100% — closed-end funds and commodity
trusts where the broken half is the operating margin, not the gross one — so
refusing the gross side alone would blank 129 good values to remove 70 bad, and
refusing both would take PLD's `op_margin`, which is exact.
  ⇒ Same requirement: alert, don't blank. What IS shipped is the sub-case with
    no escape — a gross margin above 100% (28 rows), where revenue and gross
    profit contradict each other outright.

⛔ `gross_margin` for entities with no gross-profit line (JPM 62.60, GBLI 25.77,
BRK-B 23.52 — yfinance returns 0.0 for JPM precisely because a bank has no cost
of revenue) is an OWNER DECISION and is deliberately left as-is. The number has
a definition (revenue minus what FMP books as cost of revenue, which for a bank
is interest expense) and it is stable across banks. Blanking it would need a
`sector` signal, and `sector` is a column this module deliberately does NOT own
(`ticker_meta` does) — reaching for it here would put this column's
correctness downstream of another source's coverage, which is the coupling the
ownership section above exists to prevent. The cost of leaving it: a
`gross_margin > 40%` screen mixes manufacturers with financials computed on a
different basis. The cost of blanking it: every financial silently disappears
from any screen touching the column.

⛔ `pb` for LCID (1.14 published against a reported stockholders' equity of
MINUS $1.058B at 2026-06-30, confirmed against the quarterly statements and
yfinance's independent −2.685/share) IS WRONG and IS NOT DETECTABLE FROM THIS
PAYLOAD. FMP's whole balance sheet for LCID is stale in one direction and
perfectly self-consistent: `bookValuePerShareTTM` 4.837,
`shareholdersEquityPerShareTTM` 4.837, `tangibleBookValuePerShareTTM` 4.837,
`debtToEquityRatioTTM` 1.819, `financialLeverageRatioTTM` 4.165,
`tangibleAssetValueTTM` +$1.848B — every equity view positive and agreeing, and
`pb × bookValuePerShareTTM` reproduces the quoted price to the cent. There is
no in-row witness, so catching it requires a SECOND SOURCE for book value, and
that is a per-symbol call × 3,700 plus a second authority over one value.
  ⇒ REQUIREMENT for the controller: an as-reported equity oracle, in a
    monitor, not in this pass.
  ⚠️ Also recorded, not fixed: 191 rows publish a NEGATIVE `pb`, and a classic
    "cheap on assets" filter (`pb <= 1`) returns every one of them. That is the
    same shape as the `peg` finding and it is an owner decision about the whole
    valuation family, not a change to make in one column on one lane's say-so.

⛔ SMCI AND BABA ARE A PROVIDER WINDOW, NOT A DEFECT HERE — do not patch per
ticker. SMCI's whole row reads ~1.5× high on every profitability figure and low
on every value figure, BABA ~0.70×. Checked from inside the payload:
`netProfitMarginTTM` equals `netIncomePerShareTTM / revenuePerShareTTM` to
1.0000 on all 17 audited names INCLUDING both of them, so FMP is internally
consistent and its TTM window simply covers different quarters than the filed
statements. Nothing in this module can see that, and nothing in this module
should try.
"""
from __future__ import annotations

import contextlib
import csv
import io
import logging
import math
import os
import time
from typing import NamedTuple

log = logging.getLogger(__name__)

_BASE = "https://financialmodelingprep.com"

#: How long to wait for a bulk body. These are 30-70MB CSVs; the measured
#: transfer was 1-4s, but a slow pod must not abort a whole night's fill.
_TIMEOUT = 300
#: Politeness between bulk calls. A back-to-back walk of profile-bulk earned a
#: 429 during probing, so the pass paces itself and retries a 429 once.
_GAP_SECONDS = 1.5
_RETRY_429 = 2
#: A bound on the profile-bulk walk so a provider that stops returning 400 at
#: the end cannot spin forever. The REAL end is a 400 — this is a guard rail,
#: not the part count.
_MAX_PARTS = 32


class _Spec(NamedTuple):
    """One column's contract with the provider.

    `field`         the FMP column it is read from
    `scale`         1.0 for a plain ratio, 100.0 for a fraction stored as percent
    `zero_ok_when`  the OTHER fields that must ALSO read exactly 0 before a 0 is
                    written. Empty means a literal 0 is FMP's undefined sentinel
                    and the column stays NULL. See the module note.

    The three below were added 2026-08-23 by the accuracy audit. Each is a
    DEFINITIONAL impossibility, never a plausibility clamp — see "⛔ AND NO
    SANITY BOUND" above, which still stands and is why the audit's two *other*
    proposed rails were measured and rejected (see "WHAT THE AUDIT ASKED FOR
    AND DID NOT GET").

    `zero_ok_if_resolves`
                    sibling `_Spec`s whose own `value_for` must return non-None
                    before a literal 0 is written. This is the corroboration
                    shape for a numerator that has NO field of its own in the
                    payload: instead of witnessing "the numerator is zero", it
                    witnesses "the reading this ratio stands on is trustworthy".
                    `lt_debt_to_capital` is the only user and the only column
                    that needs it.
    `same_sign_as`  a field this value's SIGN must match. Only `pb` uses it:
                    `priceToBookRatioTTM = price / bookValuePerShareTTM` and a
                    traded price is positive, so a positive P/B beside a
                    negative book value is not a disagreement about basis — it
                    is two halves of one division that cannot both be right.
    `requires_positive`
                    fields in the SAME row that must be present and positive
                    for this value to mean anything. Only `peg` uses it, and
                    only for the case a sign test cannot see: PEG = P/E ÷
                    growth, so two negatives make an ATTRACTIVE POSITIVE.
    `impossible_above`
                    a ceiling in STORED units that the definition itself
                    implies. Only `gross_margin` uses it: gross profit is
                    revenue minus cost of revenue and cost of revenue is not
                    negative, so a gross margin above 100% is revenue and
                    gross profit disagreeing, not a very profitable company.
                    ⭐ Strictly above — a company with no cost of revenue
                    genuinely reads exactly 100.0 and there are 100+ of them.
    """
    field: str
    scale: float
    zero_ok_when: tuple
    zero_ok_if_resolves: tuple = ()
    same_sign_as: str = ""
    impossible_above: float | None = None
    requires_positive: tuple = ()


#: Hoisted out of `RATIO_SPECS` so `lt_debt_to_capital` can name it as the
#: reading it stands on. ⛔ ONE WRITER: the debt-zero rule is stated here once
#: and DERIVED there, not restated as a second copy of the same three fields —
#: which is exactly how `lt_debt_to_capital` acquired the WRONG corroborators
#: in the first place.
_DEBT_TO_EQUITY = _Spec("debtToEquityRatioTTM", 1.0,
                        ("debtToAssetsRatioTTM", "debtToCapitalRatioTTM"))


# ⭐ DICT LITERALS KEYED BY SNAPSHOT COLUMN. That shape is load-bearing twice
# over: it is the mapping `_row_from` iterates to write the row, and it is what
# `tests/test_scalar_population_rail.py`'s AST walker reads to answer "does any
# code in this package write `pe_ttm`?". A tuple of (column, field) pairs would
# be correct code and an INVISIBLE collector — §1 of that rail would stay red
# while the column filled, which is the same class of drift as a hand-typed
# count.

#: /stable/ratios-ttm-bulk -> eight of the ten.
RATIO_SPECS = {
    "dividend_yield": _Spec("dividendYieldTTM", 100.0, ("dividendPerShareTTM",)),
    "pe_ttm":         _Spec("priceToEarningsRatioTTM", 1.0, ()),
    "ps":             _Spec("priceToSalesRatioTTM", 1.0, ()),
    # ⛔ `same_sign_as` IS NOT A NEGATIVE-BOOK GUARD — read the pb section of
    # "WHAT THE AUDIT ASKED FOR AND DID NOT GET" before assuming it is. It
    # catches only the 2 rows (MAX, XWIN, measured 2026-08-23) where FMP's own
    # P/B and its own book value per share have OPPOSITE signs. The other 166
    # negative-book rows already publish a negative P/B and are untouched, and
    # LCID — the case the audit named — is invisible to it, because FMP's whole
    # balance sheet for LCID is stale-but-self-consistent and POSITIVE.
    "pb":             _Spec("priceToBookRatioTTM", 1.0, (),
                            same_sign_as="bookValuePerShareTTM"),
    # 28 rows publish a gross margin above 100% (AUR 7,040 · KTF 519 · TYG 486
    # · PHYS 476 · CEF 278 — measured over the 3,681-name universe 2026-08-23),
    # which requires a negative cost of revenue. ⭐ This does NOT touch PLD, the
    # case the audit named; see the gross_margin section below.
    "gross_margin":   _Spec("grossProfitMarginTTM", 100.0, (),
                            impossible_above=100.0),
    "net_margin":     _Spec("netProfitMarginTTM", 100.0, ()),
    # ⭐ ONE OF THE THREE FREE SCALARS (see the ownership note above). 228 zeros
    # measured, and ALL 228 read `revenuePerShareTTM == 0` — a dead REVENUE
    # denominator, not a zero operating income. 225 of them carry a NON-ZERO
    # `netIncomePerShareTTM` (SPACs on trust interest, pre-revenue biotech:
    # ABVX, ALLO, AMLX, AURA). Identical population and identical shape to
    # `net_margin`/`gross_margin`, which refuse for the same reason. REFUSED.
    "op_margin":      _Spec("operatingProfitMarginTTM", 100.0, ()),
    # 3 zeros (AGCC, MGRT, NPCT), each with `priceToEarningsRatioTTM == 0` and
    # `netIncomePerShareTTM == 0`. PEG = P/E ÷ growth, so a PEG of exactly 0
    # requires a P/E of exactly 0 — the same dead numerator `pe_ttm` refuses.
    "peg":            _Spec("priceToEarningsGrowthRatioTTM", 1.0, (),
                            requires_positive=("priceToEarningsRatioTTM",)),
    # 238 of 240 zeros are corroborated by two further debt quotients reading
    # zero — a genuinely debt-free balance sheet, not a missing denominator.
    "debt_to_equity": _DEBT_TO_EQUITY,
    # No corroborator exists in this payload for current LIABILITIES, and all
    # 163 zeros are banks/insurers/BDCs. A literal 0 is refused.
    "current_ratio":  _Spec("currentRatioTTM", 1.0, ()),
    # ── Wave 2 additions — same file, same six requests, zero new cost ──
    # The same ~163 banks/insurers/BDCs that print `currentRatioTTM == 0`
    # print quick 0 for the same no-current-split reason — refused, NULL by
    # design, matching `current_ratio`.
    "quick_ratio":        _Spec("quickRatioTTM", 1.0, ()),
    # A zero P/FCF or P/OCF requires a zero PRICE; both are undefined-sentinels.
    "p_fcf":              _Spec("priceToFreeCashFlowRatioTTM", 1.0, ()),
    "p_ocf":              _Spec("priceToOperatingCashFlowRatioTTM", 1.0, ()),
    # A non-payer's payout genuinely IS 0 — same corroborator as dividend_yield.
    # ⚠️ MEASURED NAME, NOT THE DOCUMENTED ONE: the header census
    # (`tools/screener_wave2_fmp_headers.py`, run 2026-08-21) found this field
    # as `dividendPayoutRatioTTM` — FMP's docs/convention would suggest
    # `payoutRatioTTM`, which does not exist in the live bulk CSV.
    "payout_ratio":       _Spec("dividendPayoutRatioTTM", 100.0,
                                ("dividendPerShareTTM",)),
    # 🔴 FIXED 2026-08-23 — THE CORROBORATOR WAS MEASURING THE WRONG DEBT.
    # This read `zero_ok_when=("debtToEquityRatioTTM", "debtToAssetsRatioTTM")`,
    # which demanded that TOTAL debt be zero before a LONG-TERM debt ratio of
    # zero could be written. Those are not views of one number: a company can
    # have no long-term debt and still carry a revolver or a lease. So the true
    # answer was refused for exactly the companies the column exists to find.
    #
    # ⭐ WHAT REPLACES IT, AND WHY IT IS THE SAME PRINCIPLE. There is no
    # long-term-debt field anywhere in this payload to witness the numerator
    # with — `longTermDebtToCapitalRatioTTM` is the ONLY one of the 62 fields
    # with a long-term-debt numerator (field census, 2026-08-23). But long-term
    # debt cannot exceed total debt, so:
    #   * total debt is a corroborated ZERO  ⇒ long-term debt is zero too;
    #   * total debt is non-zero             ⇒ the capital denominator is alive,
    #                                          so a ratio of 0 means a numerator
    #                                          of 0.
    # Both branches are "`debt_to_equity` resolved for this row", which is why
    # the gate is the sibling spec rather than a second list of debt fields.
    #
    # Measured over the 3,681-name universe, 2026-08-23: 830 rows (22.5% of the
    # column) read a raw 0 and were ALL refused; every one of them now carries a
    # real 0 — 190 via a corroborated zero D/E (debt-free outright) and 640 via
    # a non-zero D/E (no long-term debt, some total debt). ⚠️ AND THE GATE
    # REFUSES NONE OF THEM: `debtToEquityRatioTTM` resolves on all 3,681 rows
    # today, so on this snapshot the new rule is indistinguishable from "always
    # write the zero". It is kept because the principle is what makes the write
    # honest, and `test_the_lt_debt_gate_can_still_refuse` holds a row where it
    # fires. ⛔ The change is strictly additive — it only ever runs on a value
    # of 0, which previously always became NULL, so no non-zero value can move.
    "lt_debt_to_capital": _Spec("longTermDebtToCapitalRatioTTM", 1.0, (),
                                zero_ok_if_resolves=(_DEBT_TO_EQUITY,)),
}

#: /stable/key-metrics-ttm-bulk -> roa and roe. Neither denominator (total
#: assets, shareholders' equity) is carried here, so a literal 0 has nothing to
#: corroborate it and is refused.
#:
#: 🔴 THE NEAR-MISS WORTH READING. `returnOnEquityTTM` is 0 on 6 of our names,
#: and on every one of them `returnOnAssetsTTM`, `returnOnInvestedCapitalTTM`
#: and `returnOnCapitalEmployedTTM` ALSO read 0. That looks exactly like the
#: `debt_to_equity` corroboration — three quotients over three denominators
#: agreeing — and it is NOT. The per-symbol endpoint says why: ARCI, HACQ and
#: SAAQ carry a non-zero `netIncomePerShareTTM` (-0.0023, -0.0016, -0.0027)
#: with `bookValuePerShareTTM == 0` and `shareholdersEquityPerShareTTM == 0`.
#: The numerator is alive; the whole BALANCE SHEET is zero, so every ratio
#: standing on it prints 0 together.
#:
#: ⭐ AGREEMENT AMONG QUOTIENTS IS ONLY CORROBORATION WHEN THE DENOMINATORS ARE
#: GENUINELY INDEPENDENT. Assets, equity, invested capital and capital employed
#: are four views of one balance sheet; debt-to-equity / debt-to-assets /
#: debt-to-capital are three views of one DEBT figure, which is why they can
#: witness a debt-free company and these four cannot witness a zero return.
#:
#: ⛔ `marketCap` is in this payload and is deliberately NOT read: Massive owns
#: that column.
KEY_METRIC_SPECS = {
    "roa": _Spec("returnOnAssetsTTM", 100.0, ()),
    "roe": _Spec("returnOnEquityTTM", 100.0, ()),
    # Wave 2: the balance-sheet-zero near-miss documented above (ROA/ROE)
    # applies verbatim here too — no corroborator in this payload, zeros
    # refused.
    "roic": _Spec("returnOnInvestedCapitalTTM", 100.0, ()),
}

#: /stable/profile-bulk -> beta. `exchange` is TEXT and handled beside these.
PROFILE_SPECS = {
    "beta": _Spec("beta", 1.0, ()),
}

#: The one TEXT column, and the FMP field it is read from. `exchange` is the
#: SHORT name ("NASDAQ"), not `exchangeFullName` ("NASDAQ Global Select") —
#: the short form is what a member would type and what the column's siblings
#: (`sector`, `industry`) look like.
PROFILE_TEXT = {
    "exchange": "exchange",
    # Wave 2: both measured verbatim against the probe (`ipoDate`, `country`).
    "ipo_date": "ipoDate",
    "country":  "country",
}

#: Every snapshot column this module can write. DERIVED from the maps above so
#: it cannot fall out of step with them.
COLUMNS_WRITTEN = (
    set(RATIO_SPECS) | set(KEY_METRIC_SPECS) | set(PROFILE_SPECS)
    | set(PROFILE_TEXT)
)


def _num(value):
    """A finite float, or None. Empty string, junk and NaN/inf all become None."""
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def value_for(spec: _Spec, raw_row: dict):
    """One column's value from one provider row, or None. **PURE.**

    ⭐ EVERY REFUSAL LIVES HERE AND NOWHERE ELSE, so there is one place to read
    them and one place to mutate when proving the gauntlet can go red.

    Two kinds, and they are not the same kind:
      * the ZERO rule — is this 0 a value or the provider's "undefined"?
      * the CONTRADICTION rules — this value and another field of the SAME row
        cannot both be right, so neither is published. `same_sign_as` and
        `impossible_above`; both definitional, neither a plausibility bound.
    """
    val = _num(raw_row.get(spec.field))
    if val is None:
        return None
    # 🔴 ACCURACY AUDIT DEFECT #1 — the worst case in the audit, and
    # the ONLY half of it that is still live. Re-derived 2026-08-24, because
    # the audit's own account of the mechanism had gone stale:
    #
    # The audit reported that `filters.py` ships
    # `_range("peg", …, {"label": "Under 1", "op": "lte", "max": 1})` rendered
    # as a bare `peg <= ?`, so negative PEGs passed the preset. THAT IS NO
    # LONGER TRUE — the presets are `{"op": "between", "min": 0, "max": 1}`
    # and `query.py` renders `between` as a real `>= ? AND <= ?`, so a negative
    # PEG is already excluded from every PEG preset we ship.
    #
    # ⭐ WHAT SURVIVES THAT GUARD IS THE HALF A SIGN TEST CANNOT SEE. PEG =
    # P/E ÷ growth, so two negatives make an ATTRACTIVE POSITIVE, and a
    # positive sails through `>= 0`. Measured against the live provider over
    # our universe, 2026-08-24 (3,655 of 3,714 symbols matched):
    # **614 rows publish a positive PEG off a NON-POSITIVE P/E** — ACHC 0.0025
    # on a P/E of −2.23, ABVX 0.3369 on −20.50, AAL 0.1797 on −28.20. LCID,
    # the audit's headline, is this shape: peg 0.019 off a P/E of −0.40 with a
    # −264% net margin, the LOWEST PEG in its sample. +0.0025 is
    # indistinguishable from the cheapest real growth stock on the board, and
    # it is what "PEG Under 1" hands a member today.
    #
    # ⛔ A NEGATIVE PEG IS NOT REFUSED, and that is a deliberate reversal of
    # this pass's first cut. A negative PEG is a REAL answer — a positive P/E
    # against shrinking earnings — and `test_a_peg_of_zero_is_refused_because
    # _it_needs_a_pe_of_zero` already defends ABCB at −6.01 by name. Blanking
    # it would delete 1,185 true values to fix a preset that is already
    # guarded. The same argument applies to `pe_ttm`, `pb`, `p_fcf` and
    # `p_ocf`: all four are `_open_range` with NO shipped preset, so the only
    # way to select their negatives is for a member to type a range, and the
    # honest answer to that is the member-facing `desc` those columns still
    # lack — not a mass refusal. Measured cost of the mass refusal that was
    # NOT taken: 1,005 pe_ttm + 981 p_fcf + 713 p_ocf + 164 pb rows.
    for gate_field in spec.requires_positive:
        gate = _num(raw_row.get(gate_field))
        if gate is None or gate <= 0:
            # An ABSENT gate refuses too: a multiple we cannot show to be
            # meaningful is not one to publish. ⚠️ Measured cost of the absent
            # branch: 0 rows — `priceToEarningsRatioTTM` and
            # `priceToEarningsGrowthRatioTTM` are present on exactly the same
            # 3,653 rows.
            return None
    if val == 0:
        # An uncorroborated zero is the provider saying "undefined", not "zero".
        if not spec.zero_ok_when and not spec.zero_ok_if_resolves:
            return None
        for other in spec.zero_ok_when:
            if _num(raw_row.get(other)) != 0:
                return None
        for sibling in spec.zero_ok_if_resolves:
            # ⛔ Recursion is one level deep BY CONSTRUCTION: the only spec ever
            # named here is `_DEBT_TO_EQUITY`, whose own tuple is empty. Do not
            # make two specs name each other.
            if value_for(sibling, raw_row) is None:
                return None
    elif spec.same_sign_as:
        other = _num(raw_row.get(spec.same_sign_as))
        if other is not None and other != 0 and (other > 0) != (val > 0):
            return None
    out = val * spec.scale
    if spec.impossible_above is not None and out > spec.impossible_above:
        return None
    return out


def _row_from(specs: dict, raw_row: dict) -> dict:
    out = {}
    for column, spec in specs.items():
        val = value_for(spec, raw_row)
        if val is not None:
            out[column] = val
    return out


# ── the provider (network; thin; monkeypatchable) ────────────────────────────

def _fmp_key() -> str:
    return os.environ.get("FMP_API_KEY", "")


class _ChunkReader(io.RawIOBase):
    """A binary file-like over ``requests``' own chunk iterator.

    🔴 WHY NOT JUST WRAP `resp.raw`. Because it half-works, which is worse than
    failing. `TextIOWrapper(resp.raw)` reads until `read()` returns empty, but
    urllib3 CLOSES the underlying response the moment content-length bytes have
    been consumed — so the final read lands on a closed file and raises
    `ValueError: I/O operation on closed file` AT THE NATURAL END OF THE BODY.

    Measured 2026-08-09: every one of the three pulls raised it. The rows
    already parsed survived, so the ratios pull looked complete; the damage was
    in `_walk_profile_parts`, which treats an exception as "stop walking" and so
    never fetched parts 1-3. `beta` and `exchange` came back for names in part 0
    and were SILENTLY ABSENT for T and XOM. A partial pull that reads as a
    finished one is exactly this task's defect.

    `iter_content` terminates cleanly at EOF and handles transfer/content
    decoding, so EOF here is a real 0 rather than a raise.
    """

    def __init__(self, chunks):
        self._chunks = chunks
        self._buf = b""

    def readable(self) -> bool:
        return True

    def readinto(self, target) -> int:
        while not self._buf:
            try:
                self._buf = next(self._chunks)
            except StopIteration:
                return 0
        n = min(len(target), len(self._buf))
        target[:n] = self._buf[:n]
        self._buf = self._buf[n:]
        return n


@contextlib.contextmanager
def _open_bulk_csv(path: str, params: dict, timeout: int = _TIMEOUT):
    """Yield ``(rows, status, body)`` for an FMP bulk CSV, streamed.

    ⚠️ `csv.reader` over `iter_lines()` would be WRONG: profile-bulk carries
    free-text `description` fields containing newlines, and a line-oriented
    split corrupts every row after the first one. Wrapping `raw` in a
    `TextIOWrapper` hands `csv` a real text stream, so quoting and embedded
    newlines are the csv module's problem, as they should be.

    🔴 IT IS A CONTEXT MANAGER BECAUSE THE RESPONSE'S LIFETIME IS LOAD-BEARING.
    The first cut returned the `DictReader` and let the `requests.Response` fall
    out of scope; CPython collected it and closed the socket mid-walk. See
    `_ChunkReader` for the second, subtler half of the same bug — and for what
    the per-source failure census caught that the row counts did not.

    `rows` is None on any non-200, so a caller that ignores `status` still
    cannot mistake a dead endpoint for a market with no fundamentals.
    """
    import requests

    query = dict(params)
    query["apikey"] = _fmp_key()
    resp = requests.get(f"{_BASE}{path}", params=query, stream=True, timeout=timeout)
    try:
        if resp.status_code != 200:
            yield None, resp.status_code, resp.text[:200]
            return
        stream = io.TextIOWrapper(
            io.BufferedReader(_ChunkReader(resp.iter_content(65536))),
            encoding="utf-8", errors="replace", newline="")
        yield csv.DictReader(stream), 200, ""
    finally:
        resp.close()


def _note(failures: dict, source: str, outcome) -> None:
    """Count a miss under `{source: {outcome: count}}` — the shape
    `snapshot_builder.run_build` already reports."""
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _collect(path: str, params: dict, specs: dict, wanted: set, into: dict,
             failures: dict, source: str, text_specs: dict | None = None) -> int:
    """Stream one bulk CSV, keep only `wanted` symbols, merge into `into`.

    Returns the number of universe symbols this endpoint contributed a row for.
    """
    seen = 0
    try:
        with _open_bulk_csv(path, params) as (rows, status, body):
            if status != 200:
                _note(failures, source, f"HTTP {status}")
                log.warning("[screener] bulk %s HTTP %s: %s", path, status, body)
                return 0
            seen = _absorb(rows, specs, wanted, into, text_specs)
    except Exception as exc:                                   # noqa: BLE001
        # A truncated body mid-stream must not lose the rows already parsed,
        # and must not be mistaken for a complete pull.
        _note(failures, source, exc)
        log.warning("[screener] bulk %s failed after %s rows: %s", path, seen, exc)
    return seen


def _absorb(rows, specs: dict, wanted: set, into: dict,
            text_specs: dict | None = None) -> int:
    """Merge the `wanted` rows of one provider stream into `into`. **PURE** over
    its inputs, so the mapping is unit-testable without a socket."""
    seen = 0
    for raw in rows:
        sym = (raw.get("symbol") or "").strip().upper()
        if not sym or sym not in wanted:
            continue
        merged = _row_from(specs, raw)
        for column, field in (text_specs or {}).items():
            text = (raw.get(field) or "").strip()
            if text:
                merged[column] = text
        if merged:
            into.setdefault(sym, {}).update(merged)
        seen += 1
    return seen


def _walk_profile_parts(wanted: set, into: dict, failures: dict) -> int:
    """profile-bulk is paginated; the END OF THE WALK IS DERIVED.

    A part past the end answers `400 Query Error: Invalid or missing query
    parameter - part`, so the walk stops on 400 and on nothing else. A 429 is
    retried — treating a rate limit as the end would silently halve coverage
    and look exactly like a shorter database.
    """
    seen = 0
    for part in range(_MAX_PARTS):
        for attempt in range(_RETRY_429 + 1):
            try:
                with _open_bulk_csv("/stable/profile-bulk",
                                    {"part": str(part)}) as (rows, status, body):
                    if status == 429 and attempt < _RETRY_429:
                        _note(failures, "fmp_profile_bulk", "HTTP 429 retried")
                        time.sleep(_GAP_SECONDS * 4 * (attempt + 1))
                        continue
                    if status == 400:
                        return seen                    # the end of the walk
                    if status != 200:
                        _note(failures, "fmp_profile_bulk", f"HTTP {status}")
                        log.warning("[screener] profile-bulk part %s HTTP %s: %s",
                                    part, status, body)
                        return seen
                    seen += _absorb(rows, PROFILE_SPECS, wanted, into,
                                    PROFILE_TEXT)
            except Exception as exc:                           # noqa: BLE001
                _note(failures, "fmp_profile_bulk", exc)
                log.warning("[screener] profile-bulk part %s failed: %s", part, exc)
                return seen
            break
        time.sleep(_GAP_SECONDS)
    _note(failures, "fmp_profile_bulk", "walk hit _MAX_PARTS")
    return seen


# ── the entry point ──────────────────────────────────────────────────────────

_CACHE: dict = {}


def fetch_bulk(wanted, failures: dict | None = None, force: bool = False) -> dict:
    """``{TICKER: {snapshot_column: value}}`` for every name FMP answered for.

    `wanted` bounds the parse to our universe — the ratios file holds 71,370
    rows and we keep ~3,679 of them, so nothing but the kept rows is ever
    materialised. `failures` is the optional `{source: {outcome: count}}`
    out-dict `run_build` already reports; **a missing key or a dead endpoint is
    counted there, never swallowed into an empty result that reads like a
    market with no fundamentals.**

    ⛔ Returns `{}` (with the reason counted) rather than raising: one dead
    provider must not cost the night's technicals, candles and patterns.
    """
    wanted = {str(t).strip().upper() for t in (wanted or []) if t}
    if not wanted:
        return {}

    key = (time.strftime("%Y-%m-%d"), frozenset(wanted))
    if not force and key in _CACHE:
        return _CACHE[key]

    if not _fmp_key():
        # The single loudest failure mode, and the one that produced the
        # original defect under a different provider's name: no credential.
        # ⚠️ FMP_API_KEY lives in `uct-intelligence/.env`, NOT in
        # `uct-dashboard/.env` — the same split that left MASSIVE_API_KEY
        # unresolved for the 03:05 build.
        _note(failures, "fmp_bulk", "no_api_key")
        # ⛔ THE COLUMN LIST IS DERIVED, NEVER TYPED. This line read "the ten
        # bulk fundamentals and exchange" and was wrong within a day of the
        # module gaining `op_margin`/`roe`/`peg` — a hand-typed count beside the
        # set that owns it is this repo's most re-committed defect, and an
        # operator reading a diagnostic deserves the real names.
        log.warning("[screener] FMP_API_KEY absent — these %s columns will be "
                    "NULL for this build: %s",
                    len(COLUMNS_WRITTEN), ", ".join(sorted(COLUMNS_WRITTEN)))
        return {}

    out: dict = {}
    _collect("/stable/ratios-ttm-bulk", {}, RATIO_SPECS, wanted, out,
             failures, "fmp_ratios_bulk")
    time.sleep(_GAP_SECONDS)
    _collect("/stable/key-metrics-ttm-bulk", {}, KEY_METRIC_SPECS, wanted, out,
             failures, "fmp_key_metrics_bulk")
    time.sleep(_GAP_SECONDS)
    _walk_profile_parts(wanted, out, failures)

    log.info("[screener] fmp bulk fundamentals: %s/%s universe symbols answered",
             len(out), len(wanted))
    if out:
        _CACHE.clear()
        _CACHE[key] = out
    return out
