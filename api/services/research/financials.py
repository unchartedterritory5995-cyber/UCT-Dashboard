"""Financials for the research page.

Annual (5yr) + quarterly (8q) revenue/EPS/margin growth grids, plus a summary
balance-sheet and profitability block.

WHERE THE GRIDS COME FROM
-------------------------
The FMP statements first: `financial_history.get_history`, the cached FMP
reader behind the Terminal's FA panel and the earnings modal's six statement
panels. Every caller of `get_financials` (the /research Financials tab, the
Calendar earnings modal, the "Ask AI" financials evidence) therefore reads the
figures the FA panel shows, under the company's own FISCAL period labels, with
no second statements feed behind them.

The yfinance statement frames are the FALLBACK, read only for a ticker the
FMP feed returned nothing for: it holds no statements for it, or both of
its reads failed. A ticker the feed covers on one basis only (annual but no
quarterly, say) keeps the feed and shows the other grid as empty; the two
vendors are never mixed inside one answer, because they label periods
differently (fiscal against calendar).

The payload says which one supplied the grids, per ticker:

    sources.statements  "FMP" | "Yahoo Finance" | None (no grid rows at all)
    sources.summary     "Yahoo Finance" | None  (the balance / metrics block,
                        which still reuses the `get_fundamentals` service)
    sources.statements_fetched_at
                        epoch seconds the FMP statements were read (the
                        older of the two bases); FMP grids only
    fmp_unavailable     True when an FMP read FAILED (never when it answered
                        with no statements)
    unread              the grids ("annual" / "quarterly") whose read failed at
                        the source that supplied this answer, so an empty grid
                        there is a gap in what could be read, not a finding

CACHE
-----
The shared in-memory cache singleton, keyed `research_fin::v2::{SYM}` (v2: the
payload gained `sources`; the shared cache is carried across a deploy, and a v1
entry would lack it). The TTL follows the source and ONLY applies when every
leg actually resolved:

    FMP grids   12h, the statements reader's own TTL
    fallback grids   48h, as before
    any failed leg   the short `_FAIL_TTL`, so a transient blip self-heals in
                     minutes rather than leaving the tab blank or on the fallback
                     for days (the original bug: a single 12s pool timeout
                     poisoned the 48h cache with an all-empty payload -- see
                     `test_research_financials.py`)

A ticker that genuinely has, say, no quarterly statement is NOT the same as a
failure: the completeness check below distinguishes "the fetch raised" from "the
fetch succeeded and returned nothing," and only the former is a failure.
"""
from __future__ import annotations

import logging
import math

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.fundamentals import get_fundamentals
from api.services.yfinance_pool import run_in_pool
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 172_800     # 48h -- fallback grids, only for a COMPLETE fetch (every leg resolved)
_FMP_TTL = 43_200   # 12h -- FMP grids, complete: the statements reader's own TTL
_FAIL_TTL = 300          # 5 min -- a partial/failed fetch self-heals fast

_ANNUAL_ROWS = 5
_QUARTERLY_ROWS = 8

#: The names the payload's `sources` block uses, as a member reads them on screen.
SOURCE_FMP = "FMP"
SOURCE_FALLBACK = "Yahoo Finance"


def _cache_key(sym):
    return f"research_fin::v2::{sym}"


# yfinance income-statement row labels vary; try each in order.
_REVENUE = ["Total Revenue", "TotalRevenue", "Operating Revenue", "OperatingRevenue"]
_GROSS = ["Gross Profit", "GrossProfit"]
_OPINC = ["Operating Income", "OperatingIncome", "Total Operating Income As Reported"]
_NETINC = ["Net Income", "NetIncome", "Net Income Common Stockholders", "Net Income Continuous Operations"]
_EPS = ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _series(df, names):
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _period_label(ts, quarterly):
    try:
        year, month = ts.year, ts.month
    except AttributeError:
        return str(ts)
    if quarterly:
        return f"Q{(month - 1) // 3 + 1} {year}"
    return str(year)


def _grid_rows(points, n, quarterly):
    """Pure: the grid rows for the newest `n` of `points`, whichever source read them.

    `points` is every period the source returned, NEWEST FIRST, each
    `{period, revenue, gross, opinc, netinc, eps}` with None for a figure the
    source does not state. Margins are per period; growth compares the same
    period one year earlier (1 point back for annual, 4 for quarterly), so the
    comparison periods must be in `points` even when they fall outside `n`.
    One implementation for both sources: a grid cannot change its arithmetic
    with the vendor behind it.
    """
    yoy_back = 4 if quarterly else 1
    rows = []
    for i, p in enumerate(points[:n]):
        r, e, ni = p["revenue"], p["eps"], p["netinc"]

        def margin(x):
            return round(x / r * 100, 1) if (r and x is not None and r != 0) else None

        rev_yoy = eps_yoy = None
        j = i + yoy_back
        if j < len(points):
            rp, ep = points[j]["revenue"], points[j]["eps"]
            if rp and r is not None and rp != 0:
                rev_yoy = round((r - rp) / abs(rp) * 100, 1)
            if ep and e is not None and ep != 0:
                eps_yoy = round((e - ep) / abs(ep) * 100, 1)

        rows.append({
            "period": p["period"],
            "revenue": r,
            "net_income": ni,
            "eps": e,
            "gross_margin": margin(p["gross"]),
            "operating_margin": margin(p["opinc"]),
            "net_margin": margin(ni),
            "revenue_yoy": rev_yoy,
            "eps_yoy": eps_yoy,
        })
    return rows


def _income_grid(df, n, quarterly):
    """Pure: turn a yfinance income-statement DataFrame into the grid rows.

    Columns are period-end dates; we order them newest-first and compute
    per-period margins + YoY growth (1 column back for annual, 4 for
    quarterly).
    """
    if df is None or getattr(df, "empty", True):
        return []

    cols = list(df.columns)
    try:
        cols = sorted(cols, reverse=True)
    except TypeError:
        pass

    rev = _series(df, _REVENUE)
    gross = _series(df, _GROSS)
    opinc = _series(df, _OPINC)
    netinc = _series(df, _NETINC)
    eps = _series(df, _EPS)

    def cell(row, c):
        return _num(row[c]) if row is not None else None

    points = [{
        "period": _period_label(c, quarterly),
        "revenue": cell(rev, c),
        "gross": cell(gross, c),
        "opinc": cell(opinc, c),
        "netinc": cell(netinc, c),
        "eps": cell(eps, c),
    } for c in cols]
    return _grid_rows(points, n, quarterly)


def _statement_grid(hist, n, quarterly):
    """Pure: turn the FMP statements payload into the grid rows.

    `hist` is `financial_history.get_history`'s answer: `periods` (fiscal
    labels) and one aligned list per line item under `series`, OLDEST first.
    The grid is newest first, so it is reversed here, once.

    EPS is the DILUTED figure, the one the fallback reads first from Yahoo's
    frame; basic EPS stands in only when the feed states no diluted EPS for any
    period, so one grid never mixes the two.
    """
    periods = list((hist or {}).get("periods") or [])
    if not periods:
        return []
    series = hist.get("series") or {}
    count = len(periods)

    def col(key):
        vals = [_num(v) for v in (series.get(key) or [])][:count]
        return vals + [None] * (count - len(vals))

    eps = col("eps_diluted")
    if all(v is None for v in eps):
        eps = col("eps")
    rev, gross, opinc, netinc = (col("revenue"), col("gross_profit"),
                                 col("operating_income"), col("net_income"))
    points = [{
        "period": periods[i],
        "revenue": rev[i],
        "gross": gross[i],
        "opinc": opinc[i],
        "netinc": netinc[i],
        "eps": eps[i],
    } for i in range(count - 1, -1, -1)]
    return _grid_rows(points, n, quarterly)


def _fetch_statements(sym, quarterly):
    """Return (history_or_None, ok) from the FMP statements reader.

    The SAME read `/api/research/financial-history/{sym}` makes, through the
    same cache (12h per symbol and period), so a symbol whose FA panel or
    statement panels were opened costs nothing here. ``ok`` is False ONLY when
    the read FAILED: it raised, or it answered `state: "error"` (which the
    reader does not cache). An answer with no periods is `ok=True`: the feed
    holds no statements for this ticker, which is a finding, not a failure.
    """
    try:
        # The module, never the function: a `from ... import get_history` would
        # bind a copy no monkeypatch or reload of the reader could reach.
        from api.services.research import financial_history
        hist = financial_history.get_history(sym, period="quarter" if quarterly else "annual")
    except Exception as exc:
        _logger.warning("FMP statements failed for %s (q=%s): %s", sym, quarterly, exc)
        return None, False
    if not isinstance(hist, dict) or hist.get("state") == "error":
        return None, False
    return hist, True


def _fetch_income(sym, quarterly):
    """Return (df_or_None, ok). ``ok`` is False ONLY when the pool call itself
    raised (timeout or any yfinance error) -- a genuine provider failure. A
    successful call that returns an empty/short DataFrame (a young company
    with fewer than 5 years of statements, say) is `ok=True` -- that is real
    data, not a failure, and must not shorten the cache TTL."""
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return t.quarterly_income_stmt if quarterly else t.income_stmt
    try:
        return run_in_pool(_do, timeout=12), True
    except Exception as exc:  # TimeoutError or any yfinance error → no data
        _logger.warning("yf income stmt failed for %s (q=%s): %s", sym, quarterly, exc)
        return None, False


def _statement_currency(q_hist, quarterly, a_hist, annual):
    """The currency the FMP grids are reported in, as the feed states it on
    the statements themselves (TSM "TWD"). Read only off a basis that supplied
    rows. None when the feed does not say, or when the two bases disagree: a
    figure is shown with no symbol before it is shown with the wrong one."""
    stated = []
    for hist, rows in ((q_hist, quarterly), (a_hist, annual)):
        code = (hist or {}).get("currency") if rows else None
        if isinstance(code, str) and code.strip():
            stated.append(code.strip().upper())
    return stated[0] if stated and all(c == stated[0] for c in stated) else None


def get_financials(sym):
    """S6 (terminal backend fixes, 2026-10-05): a cold symbol is composed ONCE however
    many members open it at the same moment. The cache answers first; on a miss the
    first caller builds and the rest wait for its result (`single_flight`), so N cold
    opens cost one vendor walk instead of N on the shared threadpool. A follower that
    waits past the single-flight bound raises, and the route answers that as a failed
    read rather than an empty record."""
    s = (sym or "").upper().strip()
    if not s:
        return {}
    cached = cache.get(_cache_key(s))
    if cached is not None:
        return cached
    from api.services import single_flight
    return single_flight.run(_cache_key(s), lambda: _build_financials(s))


def _build_financials(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = _cache_key(sym)
    cached = cache.get(ck)
    if cached is not None:
        return cached

    # S3 (Entity Master) resolution, reported honestly so the tab can say when a
    # symbol has no canonical identity yet, without blocking the fetch.
    entity, _ = resolve_entity(sym)

    # The FMP statements first. One basis after the other, never side by
    # side: each read already fans out to three statement calls, and this route
    # must not put more on the vendor at once than the FA panel's own route does.
    # ANNUAL first: the earnings modal asks /financial-history for the QUARTERLY
    # statements in the same moment it asks this route, so by the time the annual
    # read returns, that request has usually filled the reader's cache and the
    # quarterly read here costs nothing.
    a_hist, a_ok = _fetch_statements(sym, False)
    q_hist, q_ok = _fetch_statements(sym, True)
    quarterly = _statement_grid(q_hist, _QUARTERLY_ROWS, True)
    annual = _statement_grid(a_hist, _ANNUAL_ROWS, False)
    fmp_ok = q_ok and a_ok
    from_fmp = bool(quarterly or annual)

    if from_fmp:
        legs = (("quarterly", q_ok), ("annual", a_ok))
        statements_ok = fmp_ok
    else:
        # The fallback: the FMP feed returned nothing for this ticker (it
        # holds no statements, or its reads failed), so the yfinance frames stand
        # in, and the payload says so.
        annual_df, annual_ok = _fetch_income(sym, False)
        quarterly_df, quarterly_ok = _fetch_income(sym, True)
        annual = _income_grid(annual_df, _ANNUAL_ROWS, False)
        quarterly = _income_grid(quarterly_df, _QUARTERLY_ROWS, True)
        legs = (("quarterly", quarterly_ok), ("annual", annual_ok))
        # A fallback shown because the FMP read FAILED is not a settled
        # answer: it takes the short TTL so the FMP grids return in minutes.
        statements_ok = annual_ok and quarterly_ok and fmp_ok
    unread = [name for name, ok in legs if not ok]
    has_rows = bool(quarterly or annual)

    fund = {}
    fund_ok = True
    try:
        fund = get_fundamentals(sym) or {}
        if isinstance(fund, dict) and "error" in fund:
            # get_fundamentals never raises -- it negative-caches its own
            # failures into an {"error": ...} dict instead. That IS a failed
            # leg from this module's point of view.
            fund_ok = False
            fund = {}
    except Exception as exc:
        fund_ok = False
        _logger.warning("get_fundamentals failed for %s: %s", sym, exc)

    if from_fmp:
        currency = _statement_currency(q_hist, quarterly, a_hist, annual)
    else:
        # yfinance statement frames are in the company's REPORTING currency
        # (Yahoo `financialCurrency`: TSM -> "TWD", TM -> "JPY"), not dollars, so
        # the fallback grids' revenue / EPS carry it. Read off the same `.info`
        # call the balance card already uses; None = not known.
        currency = fund.get("reporting_currency")

    # Who supplied what, for the on-screen source line. `statements` names a
    # vendor only when that vendor's rows are in the grids; `summary` is the
    # balance / metrics block, which `get_fundamentals` reads.
    sources = {
        "statements": (SOURCE_FMP if from_fmp else SOURCE_FALLBACK) if has_rows else None,
        "summary": SOURCE_FALLBACK if fund else None,
    }
    if from_fmp:
        stamps = [((hist or {}).get("source") or {}).get("fetched_at")
                  for hist, rows in ((q_hist, quarterly), (a_hist, annual)) if rows]
        stamps = [s for s in stamps if isinstance(s, (int, float))]
        if stamps:
            sources["statements_fetched_at"] = int(min(stamps))

    out = {
        "sym": sym,
        "entity": entity,
        # The currency of the grids' revenue / EPS, as the source that supplied
        # them states it. Nothing is converted.
        "currency": currency,
        "annual": annual,
        "quarterly": quarterly,
        "balance": {
            "cash": fund.get("total_cash"),
            "total_debt": fund.get("total_debt"),
            "debt_to_equity": fund.get("debt_to_equity"),
            "current_ratio": fund.get("current_ratio"),
            "fcf": fund.get("free_cash_flow"),
        },
        "metrics": {
            "roe": fund.get("roe_pct"),
            "roa": fund.get("roa_pct"),
            "gross_margin": fund.get("gross_margin_pct"),
            "operating_margin": fund.get("operating_margin_pct"),
            "net_margin": fund.get("profit_margin_pct"),
        },
        "sources": sources,
    }
    if not fmp_ok:
        # The FMP read FAILED (it did not answer "no statements").
        out["fmp_unavailable"] = True
    if unread:
        out["unread"] = unread
    complete = statements_ok and fund_ok
    set_by_completeness(ck, out, complete=complete,
                        ttl_ok=_FMP_TTL if from_fmp else _CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
