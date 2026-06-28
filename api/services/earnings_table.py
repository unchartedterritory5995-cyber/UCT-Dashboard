"""Orchestrates the fundamentals widget payload: annual table (annual_financials)
+ quarterly strip (get_year_earnings) + next earnings date. Picks a cache TTL
that collapses to 15 min around a ticker's earnings (the event fast-path)."""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

from api.services import earnings_estimates as ee
from api.services.annual_financials import get_annual_financials
from api.services.cache import cache

_log = logging.getLogger(__name__)

_FAST_TTL = 900       # 15 min — within the earnings window
_SLOW_TTL = 21_600    # 6 h — normal cadence

# Indirection so tests can monkeypatch the annual builder by name.
get_annual_financials_fn = get_annual_financials

_Q_LABEL = lambda year, q: f"{year} Q{q}"


def _next_q_label(label):
    """Increment a 'YYYY Qn' fiscal-quarter label by one (Q4 rolls to next-year
    Q1). Used to label the next (unreported) earnings row in sequence with the
    reported quarters — avoids the calendar-derived label colliding with an
    already-reported fiscal quarter (the duplicate '2026 Q3' bug)."""
    m = re.match(r"(\d{4})\s*Q([1-4])$", str(label or "").strip())
    if not m:
        return None
    y, q = int(m.group(1)), int(m.group(2))
    q += 1
    if q > 4:
        q = 1
        y += 1
    return f"{y} Q{q}"


def _parse_date(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _in_earnings_window(next_date, last_report, now, days=1):
    nowdt = datetime.fromtimestamp(now, tz=timezone.utc)
    nd = _parse_date(next_date)
    if nd is not None and abs((nd - nowdt).days) <= days:
        return True
    lr = _parse_date(last_report)
    if lr is not None and 0 <= (nowdt - lr).days <= days + 1:
        return True
    return False


def _next_earnings(ticker):
    """Upcoming earnings date + consensus from Finnhub /calendar/earnings."""
    from datetime import date, timedelta
    today = date.today()
    to = today + timedelta(days=120)
    data = ee._fh_get("/calendar/earnings",
                      {"symbol": ticker, "from": today.isoformat(), "to": to.isoformat()})
    rows = (data or {}).get("earningsCalendar") if isinstance(data, dict) else None
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: str(r.get("date") or ""))
    nxt = rows[0]
    return {
        "date": str(nxt.get("date") or "")[:10] or None,
        "eps_estimate": nxt.get("epsEstimate"),
        "rev_estimate": nxt.get("revenueEstimate"),
    }


def _last_report_date(ticker):
    intel = ee.get_earnings_intel(ticker) or {}
    hist = intel.get("beat_history") or []
    dates = [h.get("period") for h in hist if h.get("period")]
    return max(dates) if dates else None


def _choose_ttl(ticker, now):
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    try:
        last = _last_report_date(ticker)
    except Exception:
        last = None
    nd = nxt.get("date") if nxt else None
    return _FAST_TTL if _in_earnings_window(nd, last, now) else _SLOW_TTL


_FWD_QUARTERS = 4   # how many forward-estimate quarters to surface


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _fmp_forward_quarters(ticker, limit):
    """Up to `limit` upcoming quarters of analyst consensus (EPS + revenue) from
    FMP stable/analyst-estimates (period=quarter). Returns chronological
    [{date, eps_estimate, rev_estimate}] for periods ending today-or-later; []
    when the endpoint is unavailable on the plan (falls back to Finnhub next)."""
    data = ee._fmp_get("/stable/analyst-estimates",
                       {"symbol": ticker, "period": "quarter", "limit": 40})
    if not isinstance(data, list):
        return []
    from datetime import date
    today = date.today().isoformat()

    def _pick(row, *keys):
        for k in keys:
            v = row.get(k)
            if v is not None:
                return _num(v)
        return None

    fut = []
    for row in data:
        d = str(row.get("date") or "")[:10]
        if not d or d < today:
            continue
        eps = _pick(row, "epsAvg", "estimatedEpsAvg")
        rev = _pick(row, "revenueAvg", "estimatedRevenueAvg")
        if eps is None and rev is None:
            continue
        fut.append({"date": d, "eps_estimate": eps, "rev_estimate": rev})
    fut.sort(key=lambda r: r["date"])
    return fut[:limit]


def _forward_quarters(ticker, limit):
    """Forward-estimate quarters for the strip: FMP analyst-estimates (multi-
    quarter) first, else the single next-earnings event from Finnhub."""
    try:
        fwd = _fmp_forward_quarters(ticker, limit)
    except Exception:
        fwd = []
    if fwd:
        return fwd
    try:
        nxt = _next_earnings(ticker)
    except Exception:
        nxt = None
    if nxt and nxt.get("date"):
        return [{"date": nxt["date"], "eps_estimate": nxt.get("eps_estimate"),
                 "rev_estimate": nxt.get("rev_estimate")}]
    return []


def _build_quarterly(ticker, now):
    cur_y = datetime.fromtimestamp(now, tz=timezone.utc).year
    reported = []
    for y in (cur_y - 1, cur_y):
        for r in ee.get_year_earnings(ticker, y):
            if r.get("eps_actual") is None and r.get("revenue_actual") is None:
                continue
            reported.append({
                "label": _Q_LABEL(r.get("year"), r.get("quarter")),
                "_sort": (r.get("year") or 0, r.get("quarter") or 0),
                "eps_actual": r.get("eps_actual"),
                "eps_estimate": r.get("eps_estimate"),
                "eps_surprise_pct": r.get("eps_surprise_pct"),
                "rev_actual": r.get("revenue_actual"),
                "rev_estimate": r.get("revenue_estimate"),
                "rev_surprise_pct": r.get("revenue_surprise_pct"),
                "reported": True,
            })
    reported.sort(key=lambda r: r["_sort"])
    last5 = reported[-5:]
    for r in last5:
        r.pop("_sort", None)

    out = list(last5)
    # Forward estimate quarters: label each in sequence with the reported
    # quarters (increment of the last reported fiscal quarter) so they never
    # duplicate a reported label and stay fiscal-consistent across sources.
    last_label = last5[-1]["label"] if last5 else None
    label = last_label
    for q in _forward_quarters(ticker, _FWD_QUARTERS):
        next_label = _next_q_label(label)
        if next_label is None:
            qd = _parse_date(q.get("date"))
            next_label = _Q_LABEL(qd.year, (qd.month - 1) // 3 + 1) if qd else None
        out.append({
            "label": next_label,
            "report_date": q.get("date"),
            "eps_estimate": q.get("eps_estimate"),
            "rev_estimate": q.get("rev_estimate"),
            "eps_est_chg_pct": None,
            "rev_est_chg_pct": None,
            "reported": False,
        })
        label = next_label
    return out


def get_earnings_table(ticker, now=None, debug=False):
    now = time.time() if now is None else now
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"ticker": "", "annual": [], "quarterly": []}

    ckey = f"earnings_table::{ticker}"
    if not debug:
        hit = cache.get(ckey)
        if hit is not None:
            return hit

    annual = get_annual_financials_fn(ticker, now=now)
    quarterly = _build_quarterly(ticker, now)
    result = {"ticker": ticker, "annual": annual, "quarterly": quarterly}
    if debug:
        result["_sources"] = {
            "annual": (annual[0].get("_source") if annual else None),
            "quarterly": "get_year_earnings",
        }
        return result

    ttl = _choose_ttl(ticker, now)
    cache.set(ckey, result, ttl)
    return result
