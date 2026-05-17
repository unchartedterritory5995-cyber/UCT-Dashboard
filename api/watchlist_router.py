"""
watchlist_router.py — API routes for daily watchlist.

POST /api/watchlist/save     — save today's finalized watchlist
GET  /api/watchlist/load/:day — load a specific day's watchlist
GET  /api/watchlist/dates     — list available dates (last 7)
"""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistItem(BaseModel):
    sym: str = ""
    score: float = 0
    autoScore: float = 0
    tier: str = "WATCH"  # FULL | HALF | PAPER_MAX | PAPER | WATCH | POST_ER | DQ
    strike: str = ""
    exp: str = ""
    cp: str = ""
    grade: str = ""
    dir: str = ""
    hits: int = 0
    prem: float = 0
    side: str = ""
    notes: str = ""
    # Fields needed by Discord bot for cap filtering / flags
    er: bool = False
    uoa: bool = False
    cap: str = ""
    oi: float = 0
    volume: float = 0
    volOI: float = 0
    liveOI: float = 0
    liveOIDelta: float = 0
    actionLog: list = []
    mktcap: float = 0
    DTE: int = 0

    model_config = {"extra": "allow"}  # forward-compat: don't strip unknown fields


class RemovedItem(BaseModel):
    sym: str = ""
    reason: str = ""
    model_config = {"extra": "allow"}


class WatchlistSave(BaseModel):
    date: str
    bull: list[WatchlistItem]
    bear: list[WatchlistItem]
    removed: list[RemovedItem] = []


@router.post("/save")
def save_watchlist(payload: WatchlistSave):
    from api.watchlist_tracker import save_watchlist as _save
    return _save(
        payload.date,
        [item.model_dump() for item in payload.bull],
        [item.model_dump() for item in payload.bear],
        removed=[item.model_dump() for item in payload.removed],
    )


@router.get("/load/{day}")
def load_watchlist(day: str):
    from api.watchlist_tracker import get_watchlist
    return get_watchlist(day)


@router.get("/dates")
def get_dates():
    from api.watchlist_tracker import get_recent_dates
    return get_recent_dates()
