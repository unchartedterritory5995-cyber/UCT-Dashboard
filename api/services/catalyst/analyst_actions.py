# api/services/catalyst/analyst_actions.py
"""Analyst-action discovery for the catalyst engine.

Layers (no new subscription):
  1. Wire push  — engine.get_analyst_actions() (AlphaVantage+TheFly, market-wide,
     lands ~7:43 AM ET). The discovery backbone.
  2. TheFly     — only if THEFLY_API_KEY is set (graceful no-op otherwise).
  3. FMP        — per-candidate `stable/grades` enrichment (see
     finnhub_recent_action), called by the engine for pool names lacking
     analyst_meta so analyst-driven gappers are caught before the wire lands.
     PRIMARY as of 2026-08-05 (see below).
  4. Finnhub    — `/stock/upgrade-downgrade` fallback leg of the same
     function, kept for when FMP is down.

analyst_meta shape: {action, firm, from_rating, to_rating, price_target, at}

── 2026-08-05: FMP promoted to primary for the per-candidate leg ────────────
Live probe (three rounds, 10s apart): Finnhub `/stock/upgrade-downgrade`
returned **403 on every call** — this Finnhub plan does not carry the
endpoint, not a throttle. `finnhub_recent_action()` (the function name is
kept for the existing `engine.py` call site) has therefore been returning
`None` 100% of the time for every catalyst refresh since the plan changed.
FMP `stable/grades` (already paid, verified 200 with real rows) is now tried
first; Finnhub stays as an explicit fallback — it costs nothing once FMP
succeeds (fh_get short-circuits the cached 403 for 24h,
finnhub_client.py:239-240) and is the safety net if FMP has an outage.

FMP `stable/grades` carries only a plain ISO date (`"2026-07-31"`), not a
unix timestamp like Finnhub's `gradeTime` — so the FMP leg's `within_hours`
window is honored at DAY granularity (ceil(within_hours / 24) calendar days),
never claimed at hour precision the endpoint can't actually deliver.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import requests

from api.services.finnhub_client import fh_get

logger = logging.getLogger(__name__)

_TIMEOUT = 8
_FMP_TIMEOUT = 6


def _norm_meta(raw: dict) -> dict:
    return {
        "action": str(raw.get("action") or "").lower() or None,
        "firm": raw.get("firm") or raw.get("company") or None,
        "from_rating": raw.get("from_rating") or raw.get("fromGrade") or None,
        "to_rating": raw.get("to_rating") or raw.get("toGrade") or None,
        "price_target": raw.get("price_target") or None,
        "at": raw.get("at"),
    }


def get_analyst_candidates() -> dict[str, dict]:
    """Market-wide {ticker: analyst_meta} for today. Wire backbone + optional
    TheFly. Never raises — returns {} on any failure."""
    out: dict[str, dict] = {}
    try:
        from api.services.engine import get_analyst_actions
        data = get_analyst_actions() or {}
        for key in ("upgrades", "downgrades", "pt_changes"):
            for a in (data.get(key) or []):
                sym = str(a.get("ticker") or "").upper()
                if sym and sym not in out:
                    out[sym] = _norm_meta(a)
    except Exception as e:
        logger.warning("[catalyst-analyst] wire analyst_actions failed: %s", e)

    # Optional TheFly market-wide analyst Squawk (only if a key is configured).
    if os.environ.get("THEFLY_API_KEY", "").strip():
        try:
            from api.services.thefly_news import get_squawks
            res = get_squawks(category="analyst", count=50)
            for item in (res.get("items") or []):
                sym = str(item.get("symbol") or "").upper()
                if sym and sym not in out:
                    out[sym] = _norm_meta({
                        "action": item.get("category"),
                        "firm": None,
                        "at": None,
                    })
        except Exception as e:
            logger.debug("[catalyst-analyst] thefly squawk failed: %s", e)

    return out


def _fmp_get(path: str, params: dict, timeout: int = _FMP_TIMEOUT):
    """Fire a Financial Modeling Prep GET. Returns parsed JSON or None on
    failure. Own tiny client (matches the idiom already in
    api/services/analyst_grades.py / api/services/engine.py::_fmp_get) —
    FMP is a different provider from Finnhub and must never touch
    finnhub_client's token bucket / cooldown."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    call_params = dict(params)
    call_params["apikey"] = key
    try:
        r = requests.get(f"https://financialmodelingprep.com{path}", params=call_params, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("FMP %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def _fmp_recent_action(ticker: str, within_hours: int, now: Optional[float] = None) -> Optional[dict]:
    """Most-recent FMP `stable/grades` action for one ticker, if within the
    window. PRIMARY leg of `finnhub_recent_action` — see module docstring.

    `within_hours` is honored at DAY granularity (FMP gives only an ISO
    date, no time-of-day): a 36h window becomes "dated within the last
    ceil(36/24)=2 calendar days." A row with no parseable `date` is
    EXCLUDED, never defaulted to epoch-zero (would otherwise sort as
    infinitely old — the `Number(null) === 0` bug class, in date form).
    """
    if not ticker:
        return None
    rows = _fmp_get("/stable/grades", {"symbol": ticker.upper()}, timeout=_FMP_TIMEOUT)
    if not isinstance(rows, list) or not rows:
        return None

    days = max(1, -(-int(within_hours) // 24))  # ceiling division
    now_ts = now if now is not None else time.time()
    today = datetime.fromtimestamp(now_ts, tz=timezone.utc).date()
    cutoff = today - timedelta(days=days)

    best_row: Optional[dict] = None
    best_date: Optional[date] = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        ds = row.get("date")
        if not ds:
            continue
        try:
            d = date.fromisoformat(str(ds)[:10])
        except (ValueError, TypeError):
            continue
        if best_date is None or d > best_date:
            best_date, best_row = d, row

    if best_row is None or best_date is None or best_date < cutoff:
        return None

    at_ts = int(datetime(best_date.year, best_date.month, best_date.day, tzinfo=timezone.utc).timestamp())
    return _norm_meta({
        "action": best_row.get("action"),
        "company": best_row.get("gradingCompany"),
        "fromGrade": best_row.get("previousGrade"),
        "toGrade": best_row.get("newGrade"),
        "at": at_ts,
    })


def analyst_grades_available(ticker: str) -> bool:
    """Did a provider return a usable analyst-grades payload for `ticker` at all?

    This is the COVERAGE question, and it is deliberately NOT the question
    `finnhub_recent_action` answers. That one asks "was this name re-rated
    inside the window", which is a fact about the market: on a quiet tape — a
    weekend above all — the honest answer is None for every ticker while every
    provider is perfectly healthy. Grading a coverage floor against it made the
    monitor red every weekend (2026-08-09: 8 megacaps, newest grades 6 to 68
    days old, all providers answering with hundreds of rows).

    What DID regress in the incident this monitor was built for is exactly what
    this measures: Finnhub `/stock/upgrade-downgrade` 403'd on every call for
    months, so the payload was empty 100% of the time. Same two legs in the
    same order as `finnhub_recent_action` (FMP primary, Finnhub fallback) so a
    True here means the path that function depends on can actually deliver.

    Never raises.
    """
    if not ticker:
        return False
    sym = ticker.upper()
    try:
        rows = _fmp_get("/stable/grades", {"symbol": sym}, timeout=_FMP_TIMEOUT)
        if isinstance(rows, list) and rows:
            return True
    except Exception:
        logger.debug("[catalyst-analyst] FMP grades availability probe failed for %s", sym)
    try:
        rows = fh_get("/stock/upgrade-downgrade", {"symbol": sym}, timeout=_TIMEOUT)
        return isinstance(rows, list) and bool(rows)
    except Exception:
        logger.debug("[catalyst-analyst] Finnhub grades availability probe failed for %s", sym)
        return False


def _finnhub_recent_action(ticker: str, within_hours: int, now: Optional[float] = None) -> Optional[dict]:
    """Fallback leg — Finnhub `/stock/upgrade-downgrade` (403s on this plan
    as of 2026-08-05; kept because `fh_get` short-circuits the cached 403 for
    24h, so this costs nothing once FMP succeeds, and it's the safety net if
    FMP has an outage)."""
    rows = fh_get("/stock/upgrade-downgrade", {"symbol": ticker.upper()}, timeout=_TIMEOUT)
    if not isinstance(rows, list) or not rows:
        return None
    rows.sort(key=lambda x: x.get("gradeTime", 0), reverse=True)
    top = rows[0]
    grade_time = top.get("gradeTime", 0)
    now_ts = now if now is not None else time.time()
    if not grade_time or grade_time < now_ts - within_hours * 3600:
        return None
    return _norm_meta({
        "action": top.get("action"),
        "company": top.get("company"),
        "fromGrade": top.get("fromGrade"),
        "toGrade": top.get("toGrade"),
        "at": int(grade_time),
    })


def finnhub_recent_action(ticker: str, within_hours: int = 36, now: Optional[float] = None) -> Optional[dict]:
    """Most-recent analyst action for one ticker, if within the window.
    FMP `stable/grades` primary, Finnhub `/stock/upgrade-downgrade` fallback
    — see module docstring "2026-08-05: FMP promoted to primary". Function
    name kept unchanged for the existing call site
    (api/services/catalyst/engine.py:829).

    Routed through the shared api.services.finnhub_client.fh_get for the
    fallback leg so it shares the process-wide token bucket / 429 cooldown
    with every other Finnhub caller. The FMP leg is a different provider
    entirely and never touches that budget.

    `now` (unix seconds) is accepted for tests — defaults to `time.time()`.
    Returns analyst_meta or None; never an empty `_norm_meta` dict.
    """
    if not ticker:
        return None

    fmp_result = _fmp_recent_action(ticker, within_hours=within_hours, now=now)
    if fmp_result is not None:
        return fmp_result

    return _finnhub_recent_action(ticker, within_hours=within_hours, now=now)
