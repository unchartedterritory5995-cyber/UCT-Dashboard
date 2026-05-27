"""Catalyst read endpoints (logged-in users) + admin force-refresh + stats."""
from __future__ import annotations

import datetime as dt
import logging
import re
import threading
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services.catalyst import engine, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["catalysts"])

_ET = ZoneInfo("America/New_York")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _today() -> str:
    return dt.datetime.now(_ET).date().isoformat()


@router.get("/catalysts/today")
def catalysts_today(user=Depends(get_current_user)):
    md = _today()
    rows = store.get_for_date(md, ranked_only=True)
    sector_contexts = engine.get_sector_contexts(md)
    return {
        "market_date": md,
        "generated_at": rows[0]["thesis_at"] if rows else None,
        "rows": rows,
        "sector_contexts": sector_contexts,
    }


@router.get("/catalysts/by-date/{ymd}")
def catalysts_by_date(ymd: str = Path(...), user=Depends(get_current_user)):
    if not _DATE_RE.match(ymd):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    rows = store.get_for_date(ymd, ranked_only=True)
    return {"market_date": ymd, "rows": rows}


@router.post("/catalysts/refresh")
def catalysts_refresh(user=Depends(require_admin)):
    """Trigger an immediate refresh. Runs in a background thread so the HTTP
    response returns immediately — refreshes can take 5–10s."""
    threading.Thread(target=engine.run_refresh, daemon=True,
                     name="catalyst-force-refresh").start()
    return {"ok": True, "message": "Refresh started in background."}


@router.get("/admin/catalyst-stats")
def catalyst_stats(user=Depends(require_admin)):
    today = _today()
    daily = store.cost_stats_for_date(today)
    ym = today[:7]
    mtd = store.cost_stats_mtd(ym)
    today_rows = store.get_for_date(today, ranked_only=False)
    last_refresh_at = max((r["thesis_at"] for r in today_rows
                           if r.get("thesis_at")), default=None)
    return {
        "today": daily,
        "mtd_cost_usd": round(mtd["total_cost_usd"], 4),
        "mtd_call_count": mtd["call_count"],
        "today_rows": len(today_rows),
        "today_ranked": len([r for r in today_rows if r["rank"] is not None]),
        "last_refresh_at": last_refresh_at,
    }
