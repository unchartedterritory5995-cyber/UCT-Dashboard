"""Deep statement history for the fundamentals panels — FMP, not yfinance.

The existing `financials.py` reads yfinance's `quarterly_income_stmt`, which
returns about five quarters. Five points cannot show a cycle: a business that
has been compounding for six years and one that just bounced look identical.

FMP Ultimate — already paid for — returns **24 quarters and 12 annual periods**
(measured: AAPL 2020-09 through 2026-06), and carries the balance sheet and
cash flow at the same depth. That is the whole six-panel picture from one
provider.

Three statements, fetched CONCURRENTLY: they are independent, and in series a
cold call would cost their sum on the request path.

Returns SERIES, not a grid: the consumer is a chart, and the periods must be
oldest-first so time runs left to right. Reversing at the edge here means no
chart has to remember to do it.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from api.services import fmp_client

_logger = logging.getLogger(__name__)

_TTL = 12 * 3_600          # statements change quarterly; 12h is generous
_TTL_FAIL = 600
MAX_QUARTERS = 24
MAX_ANNUAL = 12


# ── The line items, declared as DATA: (key, statement leg, FMP field names) ──
#
# Field names are FMP's `/stable/*-statement` spellings, with the legacy v3
# spelling beside them where the two differ (`epsDiluted` / `epsdiluted`), so a
# row in either shape is read. The first NUMERIC field wins. A field FMP does
# not send for a company (a bank has no `inventory`) is None — a GAP, never a
# zero, because a zero reads as a fact about the business.
#
# ⛔ The first ten keys are what the six statement PANELS read
# (statementSeries.js); they keep their names and fields exactly.
LINE_ITEMS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("revenue", "income", ("revenue",)),
    ("operating_income", "income", ("operatingIncome",)),
    ("net_income", "income", ("netIncome",)),
    ("eps", "income", ("eps", "epsdiluted")),
    ("gross_profit", "income", ("grossProfit",)),
    ("operating_expenses", "income", ("operatingExpenses", "costAndExpenses")),
    ("total_assets", "balance", ("totalAssets",)),
    ("total_liabilities", "balance", ("totalLiabilities",)),
    ("free_cash_flow", "cash", ("freeCashFlow",)),
    ("operating_cash_flow", "cash", ("operatingCashFlow", "netCashProvidedByOperatingActivities")),
    # income statement
    ("cost_of_revenue", "income", ("costOfRevenue",)),
    ("research_and_development", "income", ("researchAndDevelopmentExpenses",)),
    ("sga", "income", ("sellingGeneralAndAdministrativeExpenses",)),
    ("ebitda", "income", ("ebitda",)),
    ("interest_expense", "income", ("interestExpense",)),
    ("pretax_income", "income", ("incomeBeforeTax",)),
    ("income_tax", "income", ("incomeTaxExpense",)),
    ("eps_diluted", "income", ("epsDiluted", "epsdiluted")),
    ("shares_diluted", "income", ("weightedAverageShsOutDil",)),
    # balance sheet
    ("cash_and_equivalents", "balance", ("cashAndCashEquivalents",)),
    ("short_term_investments", "balance", ("shortTermInvestments",)),
    ("receivables", "balance", ("netReceivables",)),
    ("inventory", "balance", ("inventory",)),
    ("total_current_assets", "balance", ("totalCurrentAssets",)),
    ("ppe_net", "balance", ("propertyPlantEquipmentNet",)),
    ("goodwill", "balance", ("goodwill",)),
    ("accounts_payable", "balance", ("accountPayables", "accountsPayables")),
    ("total_current_liabilities", "balance", ("totalCurrentLiabilities",)),
    ("long_term_debt", "balance", ("longTermDebt",)),
    ("total_debt", "balance", ("totalDebt",)),
    ("net_debt", "balance", ("netDebt",)),
    ("total_equity", "balance", ("totalStockholdersEquity", "totalEquity")),
    # cash flow
    ("depreciation_amortization", "cash", ("depreciationAndAmortization",)),
    ("stock_based_compensation", "cash", ("stockBasedCompensation",)),
    ("capital_expenditure", "cash", ("capitalExpenditure", "investmentsInPropertyPlantAndEquipment")),
    ("acquisitions", "cash", ("acquisitionsNet",)),
    ("dividends_paid", "cash", ("commonDividendsPaid", "netDividendsPaid", "dividendsPaid")),
    ("buybacks", "cash", ("commonStockRepurchased",)),
)

SOURCE_ENDPOINTS = ("/stable/income-statement", "/stable/balance-sheet-statement",
                    "/stable/cash-flow-statement")


def _ratio(a, b, scale: float = 100.0):
    """a / b (x scale), or None when either side is missing or b is zero. A
    ratio over a negative denominator (negative equity) is returned as
    computed: the sign is information, and hiding it would be a judgement."""
    if a is None or b is None or b == 0:
        return None
    return round(a / b * scale, 2)


def _yoy(values: list, back: int) -> list:
    """Growth against the same period one year earlier (4 quarters / 1 year
    back), in percent. None for the first `back` points, and across a zero or
    a sign change, where a percentage stops meaning anything."""
    out = []
    for i, v in enumerate(values):
        p = values[i - back] if i >= back else None
        if v is None or p is None or p == 0 or (p < 0) != (v < 0):
            out.append(None)
        else:
            out.append(round((v - p) / abs(p) * 100, 2))
    return out


def _ttm(values: list, period: str) -> list:
    """Trailing-twelve-month sum of a quarterly flow (None until four quarters
    are present, or when any of the four is missing); the value itself for an
    annual series."""
    if period == "annual":
        return list(values)
    out = []
    for i in range(len(values)):
        win = values[i - 3:i + 1] if i >= 3 else []
        out.append(sum(win) if len(win) == 4 and all(x is not None for x in win) else None)
    return out


def derive_ratios(series: dict, period: str) -> dict:
    """Key ratios per period, DERIVED from the statements in this same payload
    — no second fetch, so a ratio can never disagree with the line items it is
    shown beside.

    Margins are per period. Returns (ROE, ROA) use TRAILING-twelve-month net
    income on quarterly data: one quarter's income over a balance sheet would
    understate them four-fold. The client labels them "(TTM)" on that basis."""
    n = len(series.get("revenue") or [])

    def col(k):
        return series.get(k) or [None] * n

    rev, ni = col("revenue"), col("net_income")
    back = 1 if period == "annual" else 4
    ni_ttm = _ttm(ni, period)
    return {
        "gross_margin": [_ratio(a, b) for a, b in zip(col("gross_profit"), rev)],
        "operating_margin": [_ratio(a, b) for a, b in zip(col("operating_income"), rev)],
        "ebitda_margin": [_ratio(a, b) for a, b in zip(col("ebitda"), rev)],
        "net_margin": [_ratio(a, b) for a, b in zip(ni, rev)],
        "fcf_margin": [_ratio(a, b) for a, b in zip(col("free_cash_flow"), rev)],
        "revenue_growth": _yoy(rev, back),
        "eps_growth": _yoy(col("eps"), back),
        "roe": [_ratio(a, b) for a, b in zip(ni_ttm, col("total_equity"))],
        "roa": [_ratio(a, b) for a, b in zip(ni_ttm, col("total_assets"))],
        "debt_to_equity": [_ratio(a, b, 1.0) for a, b in zip(col("total_debt"), col("total_equity"))],
        "current_ratio": [_ratio(a, b, 1.0) for a, b in zip(col("total_current_assets"),
                                                           col("total_current_liabilities"))],
    }


def _cache():
    from api.services.cache import cache
    return cache


_FMP_STATEMENT_FNS = {
    "income-statement": fmp_client.get_income_statement,
    "balance-sheet-statement": fmp_client.get_balance_sheet_statement,
    "cash-flow-statement": fmp_client.get_cash_flow_statement,
}


def _fmp(path: str, sym: str, period: str, limit: int):
    """One statement leg via the D1 `fmp_client` adapter. Left to raise on
    failure (including `FMPNotFound` for a genuinely empty statement) —
    `get_history`'s own `except Exception: got[k] = None` around each
    future's `.result()` already treats a missing leg as None, which
    `income = got.get("income") or []` / `_by_date(None)` both already
    handle as "no data", identically to the retired `_fmp_get`'s "empty
    list" outcome."""
    fn = _FMP_STATEMENT_FNS[path]
    return fn(sym, period=period, limit=limit).value


def _by_date(rows) -> dict:
    """Index a statement by its date so three statements can be joined."""
    out = {}
    for r in (rows or []):
        if isinstance(r, dict) and r.get("date"):
            out[r["date"]] = r
    return out


def _label(date: str, period_field: str, period: str) -> str:
    """'2026-06-27' + 'Q3' → 'Q3 2026'; annual → '2026'."""
    year = (date or "")[:4]
    if period == "annual":
        return year
    p = (period_field or "").upper()
    return f"{p} {year}" if p.startswith("Q") else year


def get_history(sym: str, period: str = "quarter") -> dict[str, Any]:
    """Aligned statement series, oldest first. Never raises."""
    sym = (sym or "").upper().strip()
    if not sym:
        return {"sym": "", "period": period, "periods": [], "series": {}}
    period = "annual" if period == "annual" else "quarter"
    limit = MAX_ANNUAL if period == "annual" else MAX_QUARTERS

    # v2: the payload grew the full line-item set, `dates`, `ratios` and
    # `source`; a v1 entry still in the process cache would lack all four.
    ck = f"fin_hist::v2::{sym}::{period}"
    hit = _cache().get(ck)
    if hit is not None:
        return hit

    jobs = {
        "income": "income-statement",
        "balance": "balance-sheet-statement",
        "cash": "cash-flow-statement",
    }
    got: dict[str, Any] = {}
    try:
        with ThreadPoolExecutor(max_workers=3,
                                thread_name_prefix="fin-hist") as ex:
            futures = {k: ex.submit(_fmp, path, sym, period, limit)
                       for k, path in jobs.items()}
            for k, f in futures.items():
                try:
                    got[k] = f.result()
                except Exception as exc:
                    _logger.warning("[fin_hist] %s failed for %s: %s", k, sym, exc)
                    got[k] = None
    except Exception as exc:
        _logger.warning("[fin_hist] fetch failed for %s: %s", sym, exc)
        return {"sym": sym, "period": period, "periods": [], "series": {}}

    income = got.get("income") or []
    if not isinstance(income, list) or not income:
        out = {"sym": sym, "period": period, "periods": [], "series": {}}
        _cache().set(ck, out, _TTL_FAIL)
        return out

    bal = _by_date(got.get("balance"))
    cash = _by_date(got.get("cash"))

    # Income is the spine: a date with no income statement is not a period we
    # can describe. The other two are joined ON it and contribute None when
    # absent, so a short cash-flow history cannot shorten the whole chart.
    rows = sorted((r for r in income if isinstance(r, dict) and r.get("date")),
                  key=lambda r: r["date"])

    def num(r, *names):
        for n in names:
            v = (r or {}).get(n)
            if isinstance(v, (int, float)):
                return v
        return None

    periods, dates = [], []
    series: dict[str, list] = {key: [] for key, _leg, _names in LINE_ITEMS}
    for r in rows:
        d = r["date"]
        periods.append(_label(d, r.get("period"), period))
        dates.append(d[:10])
        legs = {"income": r, "balance": bal.get(d), "cash": cash.get(d)}
        for key, leg, names in LINE_ITEMS:
            series[key].append(num(legs[leg], *names))

    out = {"sym": sym, "period": period, "periods": periods, "dates": dates,
           "series": series, "ratios": derive_ratios(series, period),
           "count": len(periods),
           # Provenance the client shows on screen: who, which endpoints, on
           # what period basis, and when this server read them.
           "source": {"vendor": "FMP", "basis": "fiscal",
                      "endpoints": list(SOURCE_ENDPOINTS),
                      "fetched_at": int(time.time())}}
    _cache().set(ck, out, _TTL)
    return out
