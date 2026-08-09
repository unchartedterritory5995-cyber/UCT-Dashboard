"""
watchlist_router.py — API routes for the CURATED daily options watchlist.

POST /api/watchlist/save      — save today's finalized watchlist   — ADMIN
GET  /api/watchlist/load/:day — load a specific day's watchlist    — LOGGED-IN
GET  /api/watchlist/dates     — list available dates (last 7)      — LOGGED-IN

⚠️ This is NOT the per-user watchlists feature (`api/routers/watchlists.py`,
`/api/watchlists/*`, owner-scoped and already gated). This is the ONE curated
firm watchlist behind the Options Flow tab — the desk's tiered bull/bear picks
with sizing tiers (FULL / HALF / PAPER / DQ) and the reasons names were dropped.

🔴 ALL THREE WERE ANONYMOUS UNTIL 2026-08-09.

`POST /save` is the sharp one: it takes a caller-supplied `date` and REPLACES
that day's list wholesale. Anyone could have overwritten the desk's published
picks — or written a list of their own into the firm's product — with one curl
and no credential. It is `require_flow_admin` now (admin session OR
`Bearer PUSH_SECRET`), the same door `/api/top-flow/wipe` uses.

The two reads are `require_flow_user` (any logged-in member): the list is
proprietary output, and its only consumers are the two `OptionsFlow` copies,
which `AuthGuard` serves to paid/admin only. Using the flow-family gate rather
than a new `require_paid` keeps this file on ONE auth idiom with its siblings —
and it is a real gate, not a badge (`_push_secret_ok` OR a validated session).
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.flow_admin_auth import require_flow_admin, require_flow_user

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
def save_watchlist(payload: WatchlistSave,
                   _auth: dict = Depends(require_flow_admin)):
    from api.watchlist_tracker import save_watchlist as _save
    return _save(
        payload.date,
        [item.model_dump() for item in payload.bull],
        [item.model_dump() for item in payload.bear],
        removed=[item.model_dump() for item in payload.removed],
    )


@router.get("/load/{day}")
def load_watchlist(day: str, _auth: dict = Depends(require_flow_user)):
    from api.watchlist_tracker import get_watchlist
    return get_watchlist(day)


@router.get("/dates")
def get_dates(_auth: dict = Depends(require_flow_user)):
    from api.watchlist_tracker import get_recent_dates
    return get_recent_dates()
