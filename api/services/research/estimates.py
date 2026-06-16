"""Forward estimates, revision trends, and rating changes for the research page.

All from yfinance analysis data (earnings_estimate / revenue_estimate /
eps_trend / eps_revisions / upgrades_downgrades) — free and available on
yfinance 1.x. Run through the bounded yfinance pool, cached 12h.
"""
from __future__ import annotations

import logging
import math

from api.services.cache import cache
from api.services.yfinance_pool import run_in_pool

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h

_PERIOD_LABEL = {"0q": "Current Qtr", "+1q": "Next Qtr", "0y": "Current Yr", "+1y": "Next Yr"}
_PERIOD_ORDER = ["0q", "+1q", "0y", "+1y"]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _cell(df, idx, col):
    if df is None or getattr(df, "empty", True):
        return None
    try:
        if idx in df.index and col in df.columns:
            return _num(df.loc[idx, col])
    except Exception:
        return None
    return None


def _forward(eps_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        eps_avg = _cell(eps_df, p, "avg")
        rev_avg = _cell(rev_df, p, "avg")
        if eps_avg is None and rev_avg is None:
            continue
        growth = _cell(eps_df, p, "growth")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "eps_avg": eps_avg,
            "eps_low": _cell(eps_df, p, "low"),
            "eps_high": _cell(eps_df, p, "high"),
            "num_analysts": _cell(eps_df, p, "numberOfAnalysts"),
            "eps_growth": round(growth * 100, 1) if growth is not None else None,
            "rev_avg": rev_avg,
        })
    return rows


def _revisions(trend_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        cur = _cell(trend_df, p, "current")
        if cur is None:
            continue
        up = _cell(rev_df, p, "upLast30days")
        down = _cell(rev_df, p, "downLast30days")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "current": cur,
            "ago30": _cell(trend_df, p, "30daysAgo"),
            "ago90": _cell(trend_df, p, "90daysAgo"),
            "up30": int(up) if up is not None else None,
            "down30": int(down) if down is not None else None,
        })
    return rows


def _rating_changes(ud_df, n=8):
    if ud_df is None or getattr(ud_df, "empty", True):
        return []
    rows = []
    try:
        df = ud_df.sort_index(ascending=False).head(n)
    except Exception:
        df = ud_df.head(n)
    for idx, r in df.iterrows():
        try:
            date = idx.strftime("%Y-%m-%d")
        except Exception:
            date = str(idx)[:10]
        rows.append({
            "date": date,
            "firm": r.get("Firm"),
            "from_grade": r.get("FromGrade") or None,
            "to_grade": r.get("ToGrade") or None,
            "action": (str(r.get("Action")).lower() if r.get("Action") is not None else None),
        })
    return rows


def _fetch(sym):
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return {
            "eps_est": getattr(t, "earnings_estimate", None),
            "rev_est": getattr(t, "revenue_estimate", None),
            "eps_trend": getattr(t, "eps_trend", None),
            "eps_rev": getattr(t, "eps_revisions", None),
            "ud": getattr(t, "upgrades_downgrades", None),
        }
    try:
        return run_in_pool(_do, timeout=15)
    except Exception as exc:
        _logger.warning("yf estimates fetch failed for %s: %s", sym, exc)
        return {}


def get_estimates(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_est::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    raw = _fetch(sym) or {}
    out = {
        "sym": sym,
        "forward": _forward(raw.get("eps_est"), raw.get("rev_est")),
        "revisions": _revisions(raw.get("eps_trend"), raw.get("eps_rev")),
        "rating_changes": _rating_changes(raw.get("ud")),
    }
    cache.set(ck, out, _CACHE_TTL)
    return out
