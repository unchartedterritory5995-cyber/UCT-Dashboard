"""Annual EPS/Sales history + forward analyst estimates for the fundamentals
widget. Actuals source chain: FMP stable/income-statement → yfinance annual
income_stmt → roll-up of get_year_earnings quarters. Forward estimates: yfinance
earnings_estimate/revenue_estimate (current FY + next FY). YoY % computed here;
▲/▼ revision markers from the snapshot store."""
from __future__ import annotations

import logging
import math
import os
import re
import time
from datetime import datetime, timezone

# How many forward analyst-estimate years to surface in the annual table.
# FMP analyst-estimates (Ultimate plan) supplies ~5 forward years; yfinance
# backstop supplies 2. Capped here so the table stays readable.
_FWD_YEARS = 4

from api.services import earnings_estimates as ee
from api.services import fundamentals_estimates_store as store
from api.services import yf_util

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = timezone.utc

_log = logging.getLogger(__name__)


def _pct_chg(cur, prev):
    try:
        c, p = float(cur), float(prev)
    except (TypeError, ValueError):
        return None
    if p == 0:
        return None
    return round((c - p) / abs(p) * 100)


# ── Actuals sources (mockable) ───────────────────────────────────────────────
def _annual_actuals_from_fmp(ticker: str) -> dict[int, dict]:
    """{year: {eps, sales}} from FMP stable/income-statement (annual)."""
    data = ee._fmp_get("/stable/income-statement", {"symbol": ticker, "limit": 12})
    out: dict[int, dict] = {}
    if isinstance(data, list):
        for row in data:
            try:
                y = int(str(row.get("date") or row.get("calendarYear") or "")[:4])
            except (TypeError, ValueError):
                continue
            eps = row.get("epsdiluted") if row.get("epsdiluted") is not None else row.get("eps")
            sales = row.get("revenue")
            if eps is None and sales is None:
                continue
            out[y] = {"eps": _num(eps), "sales": _num(sales)}
    return out


def _annual_actuals_from_yf(ticker: str) -> dict[int, dict]:
    """{year: {eps, sales}} from yfinance annual income statement (~4 fiscal years)."""
    try:
        import math
        import yfinance as yf
    except Exception:
        return {}
    try:
        # Bound the (otherwise unlimited) Yahoo fetch so a hung response frees the
        # worker thread — the 2026-07-01 thread-exhaustion class.
        df = yf_util.bounded_call(lambda: yf.Ticker(ticker).income_stmt, None)
        if df is None or getattr(df, "empty", True):
            return {}

        def _row(names):
            for n in names:
                if n in df.index:
                    return df.loc[n]
            return None

        rev = _row(["Total Revenue", "TotalRevenue", "Operating Revenue"])
        eps = _row(["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"])
        out: dict[int, dict] = {}
        for col in df.columns:
            try:
                y = int(col.year)
            except Exception:
                continue

            def _v(series):
                if series is None:
                    return None
                try:
                    fv = float(series.get(col))
                    return None if math.isnan(fv) else fv
                except Exception:
                    return None

            ev, sv = _v(eps), _v(rev)
            if ev is None and sv is None:
                continue
            out[y] = {"eps": ev, "sales": sv}
        return out
    except Exception as exc:
        _log.info("yfinance annual income_stmt failed for %s: %s", ticker, exc)
        return {}


def _annual_rollup_from_quarters(ticker: str, years: list[int]) -> dict[int, dict]:
    """{year: {eps, sales}} by summing get_year_earnings quarterly actuals.
    Last-resort; reuses the multi-source merged quarterly data."""
    out: dict[int, dict] = {}
    for y in years:
        rows = ee.get_year_earnings(ticker, y)
        eps_vals = [r.get("eps_actual") for r in rows if r.get("eps_actual") is not None]
        rev_vals = [r.get("revenue_actual") for r in rows if r.get("revenue_actual") is not None]
        if not eps_vals and not rev_vals:
            continue
        out[y] = {
            "eps": round(sum(eps_vals), 2) if eps_vals else None,
            "sales": sum(rev_vals) if rev_vals else None,
        }
    return out


# ── Forward estimates (mockable) ─────────────────────────────────────────────
def _forward_estimates_fmp(ticker: str, now: float, last_actual_year: int | None = None) -> list[dict]:
    """Up to `_FWD_YEARS` forward fiscal-year estimates (mean EPS + revenue) from
    FMP stable/analyst-estimates (period=annual), each carrying its authoritative
    `fiscal_year` (the calendar year of the fiscal period end) so the caller
    labels rows by real fiscal year rather than a blind sequence.

    FMP's `date` is the fiscal period END, not the report date — a fiscal year
    that has ENDED but not yet reported (e.g. a Dec filer viewed in January) is
    still forward-looking. So a row is kept when its fiscal_year is newer than
    the last reported actual (`last_actual_year`); with no anchor supplied, the
    in-progress fiscal year (now.year) and beyond are kept. Filtering on
    `period_end < today` instead would drop the just-ended-but-unreported year
    and shift every estimate one year (the annual twin of the quarterly
    off-by-one). Empty when gated off (FMP Ultimate feature) → yfinance backstop."""
    if os.environ.get("FUNDAMENTALS_FMP_ANALYST_ESTIMATES", "0").lower() not in ("1", "true", "yes"):
        return []
    data = ee._fmp_get("/stable/analyst-estimates",
                       {"symbol": ticker, "period": "annual", "limit": 20})
    if not isinstance(data, list):
        return []
    floor = (last_actual_year if last_actual_year is not None
             else datetime.fromtimestamp(now, tz=timezone.utc).year - 1)
    fut, seen = [], set()
    for row in data:
        m = re.match(r"(\d{4})-\d{2}-\d{2}", str(row.get("date") or "")[:10])
        if not m:
            continue
        fy = int(m.group(1))
        if fy <= floor or fy in seen:
            continue
        eps = _num(row.get("epsAvg"))
        sales = _num(row.get("revenueAvg"))
        if sales == 0:
            sales = None
        if eps is None and sales is None:
            continue
        seen.add(fy)
        fut.append((fy, {"fiscal_year": fy, "eps": eps, "sales": sales}))
    fut.sort(key=lambda r: r[0])
    return [v for _, v in fut[:_FWD_YEARS]]


def _forward_estimates_yf(ticker: str, now: float, last_actual_year: int | None = None) -> list[dict]:
    """Current FY (0y) + next FY (+1y) mean EPS & revenue from yfinance —
    the broad-coverage backstop when FMP analyst-estimates is gated/empty.
    Yahoo gives no fiscal-year anchor, so rows omit `fiscal_year` and the caller
    assigns years sequentially (last_actual+1, +2). `last_actual_year` is
    accepted for a uniform source signature and ignored."""
    try:
        import yfinance as yf
    except Exception:
        return []
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year
    out: list[dict] = []
    try:
        # Bound each Yahoo fetch so a hung response frees the worker thread.
        eps_df = yf_util.bounded_call(lambda: yf.Ticker(ticker).earnings_estimate, None)
        rev_df = yf_util.bounded_call(lambda: yf.Ticker(ticker).revenue_estimate, None)

        def _avg(df, idx):
            try:
                if df is None or idx not in df.index:
                    return None
                return _num(df.loc[idx].get("avg"))   # NaN → None
            except Exception:
                return None

        mapping = [("0y", cur_y), ("+1y", cur_y + 1)]
        for idx, year in mapping:
            eps = _avg(eps_df, idx)
            sales = _avg(rev_df, idx)
            if eps is None and sales is None:
                continue
            out.append({"year": year, "eps": eps, "sales": sales})
    except Exception as exc:
        _log.info("yfinance forward estimates failed for %s: %s", ticker, exc)
    return out


def _forward_estimates(ticker: str, now: float, last_actual_year: int | None = None) -> list[dict]:
    """Forward annual estimates, depth-maximizing: FMP analyst-estimates
    (~5 yrs, real consensus, FMP Ultimate) → yfinance (2 near FYs). First
    non-empty wins. Chronological order. FMP rows carry `fiscal_year` (the
    caller labels by it); yfinance rows omit it and the caller assigns
    last_actual+1, +2, … so non-December filers stay correct and no estimate
    collides with a reported actual."""
    for src in (_forward_estimates_fmp, _forward_estimates_yf):
        try:
            rows = src(ticker, now, last_actual_year)
        except Exception:
            rows = []
        if rows:
            return rows[:_FWD_YEARS]
    return []


def _num(v):
    # Coerce to a finite float; NaN/inf → None. yfinance estimate cells are NaN
    # for thin names, and a raw NaN poisons the JSON render (allow_nan=False →
    # HTTP 500) and every downstream YoY %.
    try:
        if v is None:
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _contiguous_recent(actuals: dict[int, dict], years_back: int) -> list[int]:
    """The longest unbroken run of consecutive years ending at the latest year
    present, capped to `years_back`. yfinance/FMP often return a sparse far-back
    year plus a gap (e.g. 2020 alone, 2021 missing, then 2022-2025); walking back
    from the newest year and stopping at the first hole drops the orphan + keeps
    the YoY chain valid (each row's prior is exactly year-1)."""
    if not actuals:
        return []
    latest = max(actuals)
    run = [latest]
    y = latest - 1
    while y in actuals:
        run.append(y)
        y -= 1
    return sorted(run)[-years_back:]


def get_annual_financials(ticker: str, years_back: int = 8, now: float | None = None) -> list[dict]:
    now = time.time() if now is None else now
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return []
    cur_y = datetime.fromtimestamp(now, tz=_ET).year   # ET: fiscal-year boundary

    # 1. Actuals — FMP (deepest), then yfinance fills gaps. These are REPORTED
    #    fiscal years labeled by fiscal-year-end (e.g. AAPL FY2024 ended Sep 2024
    #    → 2024); the latest one is the most recent COMPLETED fiscal year.
    actuals = dict(_annual_actuals_from_fmp(ticker))
    source = "fmp" if actuals else None
    # yfinance is a BACKSTOP. Consult it only when FMP did NOT already return a
    # deep (≥years_back) AND recent (newest ≥ cur_y-1) contiguous window — that
    # skips a wasted, rate-limited Yahoo fetch on every cold load of the FMP
    # happy path, while still deepening/refreshing thin or stale FMP coverage.
    fmp_recent = _contiguous_recent(actuals, years_back)
    fmp_covers = len(fmp_recent) >= years_back and fmp_recent[-1] >= cur_y - 1
    if not fmp_covers:
        for y, v in _annual_actuals_from_yf(ticker).items():
            if y not in actuals:
                actuals[y] = v
                source = source or "yfinance"

    actual_years = _contiguous_recent(actuals, years_back)

    # Last-resort: if no statement source resolved, roll up quarters for a recent
    # calendar window, then re-derive the contiguous run. EXCLUDE the in-progress
    # year (range ends at cur_y, exclusive) — a partial current year would sum to
    # an understated total that would be mislabeled as a full-year ACTUAL; the
    # current year's value comes from forward estimates instead.
    if not actual_years:
        roll = _annual_rollup_from_quarters(ticker, list(range(cur_y - years_back, cur_y)))
        for y, v in roll.items():
            actuals.setdefault(y, v)
        if roll:
            source = source or "rollup"
        actual_years = _contiguous_recent(actuals, years_back)

    # 2. Forward estimates. FMP rows carry an authoritative `fiscal_year` (from
    #    their fiscal period end) and are kept when newer than the last actual —
    #    so a Dec filer's just-ended FY stays visible in January instead of
    #    being dropped and shifting every estimate a year. yfinance rows lack a
    #    fiscal anchor and get sequential years (last_actual+1 / +2), which keeps
    #    non-December filers correct and never collides with an actual year.
    last_actual_year = actual_years[-1] if actual_years else None
    fwd_vals = _forward_estimates(ticker, now, last_actual_year)

    if not actual_years and not fwd_vals:
        return []

    rows: list[dict] = []
    prev = None
    for y in actual_years:
        v = actuals[y]
        row = {
            "year": y, "eps": v.get("eps"), "sales": v.get("sales"),
            "eps_chg_pct": _pct_chg(v.get("eps"), prev.get("eps")) if prev else None,
            "sales_chg_pct": _pct_chg(v.get("sales"), prev.get("sales")) if prev else None,
            "estimate": False, "eps_revision": None, "sales_revision": None,
            "_source": source or "unknown",
        }
        rows.append(row)
        prev = v

    base_year = actual_years[-1] if actual_years else cur_y - 1
    emitted = set(actual_years)
    seq = 0
    for est in fwd_vals[:_FWD_YEARS]:
        fy = est.get("fiscal_year")
        if fy is None:                      # yfinance rows: no fiscal anchor
            seq += 1
            fy = base_year + seq
        if fy in emitted:                   # never duplicate an actual/estimate year
            continue
        emitted.add(fy)
        rev = store.revision_for(ticker, fy, est.get("eps"), est.get("sales"), now=now)
        store.record_snapshot(ticker, fy, est.get("eps"), est.get("sales"), now=now)
        row = {
            "year": fy, "eps": est.get("eps"), "sales": est.get("sales"),
            "eps_chg_pct": _pct_chg(est.get("eps"), prev.get("eps")) if prev else None,
            "sales_chg_pct": _pct_chg(est.get("sales"), prev.get("sales")) if prev else None,
            "estimate": True,
            "eps_revision": rev.get("eps"), "sales_revision": rev.get("sales"),
            "_source": "estimate",
        }
        rows.append(row)
        prev = est

    return rows
