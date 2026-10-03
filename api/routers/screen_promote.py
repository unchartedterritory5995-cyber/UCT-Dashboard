"""Scan -> watchlist promotion (FT-027's missing third leg).

A screen could already be saved as a named query (saved screens) and, for a
definition scan, watched by a nightly alert. What it could not do is BECOME A
WATCHLIST: the only path was flagging rows one by one. This takes the whole
result set -- in the order the screen shows it, up to `MAX_SYMBOLS` -- into a
new list or one the member already owns.

⛔ The rows come from `query.run_scan` with the CALLER's id (a `list` filter
resolves the caller's own watchlists), the same function /api/screener/scan
runs, so the list holds exactly what the screen showed. Nothing is invented.
⛔ A list LINKED to a source (TERM-077) is refused with that feature's own
sentence, via the watchlists router's own guard.
DARK: `SCREENER_PROMOTE_ENABLED` (default off). Off: both routes 404.
Plain `def`: SQLite only.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()

FLAG = "SCREENER_PROMOTE_ENABLED"
MAX_SYMBOLS = 500
PAGE = 500


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _armed() -> None:
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The screener requires a paid plan")
    return user


class PromoteIn(BaseModel):
    spec: dict
    watchlist_id: str | None = None
    name: str | None = None
    limit: int = MAX_SYMBOLS


def screen_tickers(spec: dict, user: dict, limit: int) -> tuple[list[str], int, str | None]:
    from api.services.screener import query as scr_query
    spec = {**(spec or {}), "page_size": PAGE}
    out: list[str] = []
    total, snapshot, page = 0, None, 1
    while len(out) < limit:
        res = scr_query.run_scan({**spec, "page": page}, user_id=user.get("id"), user=user)
        rows = res.get("rows") or []
        total = res.get("total") or total
        snapshot = snapshot or res.get("snapshot_date")
        for r in rows:
            t = (r.get("ticker") or "").strip().upper()
            if t and t not in out:
                out.append(t)
        if len(rows) < PAGE or len(out) >= total:
            break
        page += 1
    return out[:limit], int(total or len(out)), snapshot


@router.get("/api/screener/to-watchlist", dependencies=[Depends(_armed)])
def promote_available(_user: dict = Depends(require_paid)):
    return {"available": True, "max_symbols": MAX_SYMBOLS}


@router.post("/api/screener/to-watchlist", dependencies=[Depends(_armed)])
def promote_to_watchlist(body: PromoteIn, user: dict = Depends(require_paid)):
    from api.services import watchlist_service
    limit = max(1, min(int(body.limit or MAX_SYMBOLS), MAX_SYMBOLS))
    try:
        tickers, matched, snapshot = screen_tickers(body.spec, user, limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not tickers:
        raise HTTPException(status_code=400, detail="This screen matches nothing, so there is nothing to add.")
    if body.watchlist_id:
        from api.routers.watchlists import _refuse_if_linked
        _refuse_if_linked(body.watchlist_id)
        wl_id = body.watchlist_id
        created = False
    else:
        name = (body.name or "").strip()[:80] or f"Screen {snapshot or ''}".strip()
        wl_id = watchlist_service.create_watchlist(user["id"], name)["id"]
        created = True
    result = watchlist_service.bulk_add_items(user["id"], wl_id, tickers)
    if not result:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return {"watchlist_id": wl_id, "created": created, "added": result.get("added", 0),
            "taken": len(tickers), "matched": matched, "truncated": matched > len(tickers),
            "snapshot_date": snapshot}
