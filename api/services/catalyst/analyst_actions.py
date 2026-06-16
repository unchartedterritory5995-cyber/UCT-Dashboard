# api/services/catalyst/analyst_actions.py
"""Analyst-action discovery for the catalyst engine.

Three free / already-paid layers (no new subscription):
  1. Wire push  — engine.get_analyst_actions() (AlphaVantage+TheFly, market-wide,
     lands ~7:43 AM ET). The discovery backbone.
  2. TheFly     — only if THEFLY_API_KEY is set (graceful no-op otherwise).
  3. Finnhub    — per-candidate /stock/upgrade-downgrade enrichment (see
     finnhub_recent_action), called by the engine for pool names lacking
     analyst_meta so analyst-driven gappers are caught before the wire lands.

analyst_meta shape: {action, firm, from_rating, to_rating, price_target, at}
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_FH_BASE = "https://finnhub.io/api/v1"
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


def finnhub_recent_action(ticker: str, within_hours: int = 36) -> Optional[dict]:
    """Most-recent Finnhub upgrade/downgrade for one ticker, if within the
    window. Already-paid FINNHUB_API_KEY. Returns analyst_meta or None."""
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    if not key or not ticker:
        return None
    try:
        r = requests.get(
            f"{_FH_BASE}/stock/upgrade-downgrade",
            params={"symbol": ticker.upper(), "token": key},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        rows = r.json() or []
    except Exception as e:
        logger.debug("[catalyst-analyst] finnhub failed for %s: %s", ticker, e)
        return None
    if not isinstance(rows, list) or not rows:
        return None
    rows.sort(key=lambda x: x.get("gradeTime", 0), reverse=True)
    top = rows[0]
    grade_time = top.get("gradeTime", 0)
    if not grade_time or grade_time < time.time() - within_hours * 3600:
        return None
    return _norm_meta({
        "action": top.get("action"),
        "company": top.get("company"),
        "fromGrade": top.get("fromGrade"),
        "toGrade": top.get("toGrade"),
        "at": int(grade_time),
    })
