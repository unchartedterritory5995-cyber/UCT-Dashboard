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
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

_logger = logging.getLogger(__name__)

_TTL = 12 * 3_600          # statements change quarterly; 12h is generous
_TTL_FAIL = 600
MAX_QUARTERS = 24
MAX_ANNUAL = 12


def _cache():
    from api.services.cache import cache
    return cache


def _fmp(path: str, sym: str, period: str, limit: int):
    from api.services.earnings_estimates import _fmp_get
    params = {"symbol": sym, "limit": limit}
    if period == "quarter":
        params["period"] = "quarter"
    return _fmp_get(f"/stable/{path}", params, timeout=20)


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

    ck = f"fin_hist::{sym}::{period}"
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

    periods, series = [], {
        "revenue": [], "operating_income": [], "net_income": [], "eps": [],
        "gross_profit": [], "operating_expenses": [],
        "total_assets": [], "total_liabilities": [],
        "free_cash_flow": [], "operating_cash_flow": [],
    }
    for r in rows:
        d = r["date"]
        periods.append(_label(d, r.get("period"), period))
        series["revenue"].append(num(r, "revenue"))
        series["operating_income"].append(num(r, "operatingIncome"))
        series["net_income"].append(num(r, "netIncome"))
        series["eps"].append(num(r, "eps", "epsdiluted"))
        series["gross_profit"].append(num(r, "grossProfit"))
        series["operating_expenses"].append(num(r, "operatingExpenses", "costAndExpenses"))
        b, c = bal.get(d), cash.get(d)
        series["total_assets"].append(num(b, "totalAssets"))
        series["total_liabilities"].append(num(b, "totalLiabilities"))
        series["free_cash_flow"].append(num(c, "freeCashFlow"))
        series["operating_cash_flow"].append(num(c, "operatingCashFlow"))

    out = {"sym": sym, "period": period, "periods": periods, "series": series,
           "count": len(periods)}
    _cache().set(ck, out, _TTL)
    return out
