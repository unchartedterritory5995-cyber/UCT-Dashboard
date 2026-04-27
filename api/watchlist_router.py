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


class WatchlistSave(BaseModel):
    date: str
    bull: list[WatchlistItem]
    bear: list[WatchlistItem]


@router.post("/save")
def save_watchlist(payload: WatchlistSave):
    from api.watchlist_tracker import save_watchlist as _save
    return _save(
        payload.date,
        [item.model_dump() for item in payload.bull],
        [item.model_dump() for item in payload.bear],
    )


@router.get("/load/{day}")
def load_watchlist(day: str):
    from api.watchlist_tracker import get_watchlist
    return get_watchlist(day)


@router.get("/dates")
def get_dates():
    from api.watchlist_tracker import get_recent_dates
    return get_recent_dates()
