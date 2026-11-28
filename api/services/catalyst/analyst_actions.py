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
  ⚰️ 4. Finnhub `/stock/upgrade-downgrade` — DELETED 2026-11-28 (licensed-first
     pass 1). It 403'd on every call on this plan (below), so the "fallback"
     never returned a row; removing it removes no data.

analyst_meta shape: {action, firm, from_rating, to_rating, price_target, at}

── 2026-08-05: FMP promoted to primary for the per-candidate leg ────────────
Live probe (three rounds, 10s apart): Finnhub `/stock/upgrade-downgrade`
returned **403 on every call** — this Finnhub plan does not carry the
endpoint, not a throttle. `finnhub_recent_action()` (the function name is
kept for the existing `engine.py` call site) has therefore been returning
`None` 100% of the time for every catalyst refresh since the plan changed.
FMP `stable/grades` (already paid, verified 200 with real rows) is now tried
first. Finnhub was kept as an explicit fallback until 2026-11-28, when it was
deleted: a leg that 403s on every call is not a safety net.

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

from api.services import fmp_client

logger = logging.getLogger(__name__)

_TIMEOUT = 8


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


def _fmp_grades_rows(ticker: str) -> Optional[list]:
    """Most-recent FMP `stable/grades` rows for `ticker` via the D1
    `fmp_client` adapter. Returns the raw row list, or None on any failure
    (not configured, network error, rate-limited, no data) — mirrors the
    retired local `_fmp_get`'s "None on any failure" contract so both call
    sites below are unchanged."""
    try:
        result = fmp_client.get_analyst_grades(ticker)
    except fmp_client.FMPNotFound:
        return None
    except Exception as exc:
        logger.warning("FMP grades failed for %s: %s", ticker, exc)
        return None
    if result.degraded is not None:
        return None
    return result.value if isinstance(result.value, list) else None


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
    rows = _fmp_grades_rows(ticker)
    if not rows:
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
    months, so the payload was empty 100% of the time. The same leg as
    `finnhub_recent_action` (FMP; the dead Finnhub leg was deleted 2026-11-28),
    so a True here means the path that function depends on can actually deliver.

    Never raises.
    """
    if not ticker:
        return False
    return bool(_fmp_grades_rows(ticker.upper()))


def finnhub_recent_action(ticker: str, within_hours: int = 36, now: Optional[float] = None) -> Optional[dict]:
    """Most-recent analyst action for one ticker, if within the window.
    FMP `stable/grades` only — see module docstring "2026-08-05: FMP
    promoted to primary"; the Finnhub `/stock/upgrade-downgrade` fallback that
    403'd on every call was deleted 2026-11-28. Function name kept unchanged
    for the existing call site (api/services/catalyst/engine.py).

    `now` (unix seconds) is accepted for tests — defaults to `time.time()`.
    Returns analyst_meta or None; never an empty `_norm_meta` dict.
    """
    if not ticker:
        return None

    return _fmp_recent_action(ticker, within_hours=within_hours, now=now)
