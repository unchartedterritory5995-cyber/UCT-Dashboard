"""Chart IQ: pattern recognition drawn onto a chart (api/services/chart_iq).

GET /api/chart-iq/{sym}?date=YYYY-MM-DD  ->  the engine's read of one daily chart as of that day (default: the latest session):
the drawn objects (levels, zones, trendlines, bases, key candles, cycle stages), the one-paragraph thesis and plan, the read box,
the context line (RS, group, weekly), every candle event and cycle stage, buy days at support, unfilled gaps, what is setting up
(trigger and stop) and the market line. The chart's toggle draws it over the member's own StockChart.

Gates, read per call (docs/feature_flags.json):
  * CHART_IQ_ENABLED=1          the route answers at all; admins only. Unset: 404 for everyone.
  * CHART_IQ_MEMBERS_ENABLED=1  paid members too (only while CHART_IQ_ENABLED is also on).

The web pod is one process on one event loop: the engine runs in a worker thread, at most CHART_IQ_MAX_CONCURRENT (2) at once,
each bounded by a timeout, and every answer is cached (a past day for a day, the latest session for 15 minutes).
"""
from __future__ import annotations

import asyncio
import os
import re
import weakref

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.cache import TTLCache

router = APIRouter(prefix="/api/chart-iq", tags=["chart-iq"])

_SYM = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_CACHE = TTLCache(max_size=400)
_MAX_CONCURRENT = 2
_TIMEOUT_S = 25.0
_SEMS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()
_MEMBER_FIELDS = ("ticker", "asof", "requested", "window", "clean", "card", "thesis", "context", "rs", "candles", "cycle",
                  "buydays", "gaps", "watches", "market", "version", "built_s")


def enabled() -> bool:
    return os.environ.get("CHART_IQ_ENABLED", "0") == "1"


def members_enabled() -> bool:
    return enabled() and os.environ.get("CHART_IQ_MEMBERS_ENABLED", "0") == "1"


def _is_admin(user: dict) -> bool:
    return (user or {}).get("role") == "admin"


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for Chart IQ, defined here with its own sentence (tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Chart IQ requires a paid plan")
    return user


def _sem() -> asyncio.Semaphore:
    """One limiter per event loop (an asyncio primitive binds to the loop that first uses it)."""
    loop = asyncio.get_running_loop()
    s = _SEMS.get(loop)
    if s is None:
        s = _SEMS[loop] = asyncio.Semaphore(_MAX_CONCURRENT)
    return s


def _gate(user: dict) -> bool:
    """404 unless this viewer may use Chart IQ now; returns whether the viewer is an admin."""
    if not enabled():
        raise HTTPException(status_code=404, detail="Not found")
    admin = _is_admin(user)
    if not admin and not members_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return admin


def _clean_sym(sym: str) -> str:
    sym = (sym or "").upper().strip()
    if not _SYM.match(sym):
        raise HTTPException(status_code=400, detail="bad ticker")
    return sym


class FeedbackIn(BaseModel):
    asof: str = Field(..., description="the as-of day of the read being judged, YYYY-MM-DD")
    vote: str = Field(..., description="useful | partly | noise")
    note: str = Field(default="", max_length=4000)
    version: str = Field(default="", max_length=40)


@router.get("/feedback/export")
async def chart_iq_feedback_export(since: float = Query(default=0.0), limit: int = Query(default=5000, ge=1, le=20000),
                                   user: dict = Depends(require_paid)):
    """Admin only: every vote updated after ``since`` (epoch seconds), member ids hashed. The lab pulls this nightly."""
    if not _gate(user):
        raise HTTPException(status_code=404, detail="Not found")
    from api.services.chart_iq import feedback
    rows = await run_in_threadpool(feedback.export, since, limit)
    return {"rows": rows, "next_since": rows[-1]["updated"] if rows else since}


@router.post("/{sym}/feedback")
async def chart_iq_feedback(sym: str, body: FeedbackIn, user: dict = Depends(require_paid)):
    admin = _gate(user)
    sym = _clean_sym(sym)
    if not _DATE.match(body.asof or ""):
        raise HTTPException(status_code=400, detail="asof must be YYYY-MM-DD")
    from api.services.chart_iq import feedback
    try:
        return await run_in_threadpool(feedback.save, str(user.get("id")), sym, body.asof, body.vote, body.note, body.version, admin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except feedback.CapReached:
        raise HTTPException(status_code=429, detail="Daily feedback limit reached")


@router.get("/{sym}")
async def chart_iq(sym: str, date: str | None = Query(default=None, description="YYYY-MM-DD; default the latest session"),
                   user: dict = Depends(require_paid)):
    admin = _gate(user)
    sym = _clean_sym(sym)
    if date is not None and not _DATE.match(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    from api.services.chart_iq import pipeline   # lazy: the engine loads on first use, never at boot
    key = "chart_iq:%s:%s" % (sym, date or "latest")
    res = _CACHE.get(key)
    if res is None:
        async with _sem():
            res = _CACHE.get(key)
            if res is None:
                try:
                    res = await asyncio.wait_for(run_in_threadpool(pipeline.analyze, sym, date), timeout=_TIMEOUT_S)
                except asyncio.TimeoutError:
                    raise HTTPException(status_code=503, detail="Chart IQ is busy, try again")
                if "error" not in res:
                    _CACHE.set(key, res, ttl=900 if date is None else 86400)
    if "error" in res:
        raise HTTPException(status_code=404, detail=res["error"])
    out = {k: res[k] for k in _MEMBER_FIELDS if k in res}
    if not admin:   # members see no performance numbers yet (tracked privately, not displayed): drop each buy day's run since
        out["buydays"] = [{k: v for k, v in b.items() if k != "run"} for b in out.get("buydays") or []]
    from api.services.chart_iq import feedback
    out["my_feedback"] = await run_in_threadpool(feedback.mine, str(user.get("id")), sym, out.get("asof") or "")
    if admin:
        out["raw"] = res.get("raw", [])            # every level / line the engines found, not only the drawn ones (admin debugging)
    return out
