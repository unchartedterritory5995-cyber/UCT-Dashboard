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


# ── FT-027: standing alerts on a filter-list screen (membership snapshot) ────
# DARK: SCREENER_SPEC_ALERTS_ENABLED. Off: every route 404s.

def _spec_alerts_armed() -> None:
    from api.services.screener import spec_alerts
    if not spec_alerts.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class SpecAlertIn(BaseModel):
    spec: dict
    name: str | None = None
    mode: str = "both"
    saved_screen_id: int | None = None


@router.get("/api/screener/spec-alerts", dependencies=[Depends(_spec_alerts_armed)])
def spec_alerts_list(user: dict = Depends(require_paid)):
    from api.services.screener import spec_alerts
    return {"alerts": spec_alerts.list_subs(user["id"]),
            "max": spec_alerts.MAX_SUBS_PER_USER, "cadence": "nightly"}


@router.post("/api/screener/spec-alerts", dependencies=[Depends(_spec_alerts_armed)])
def spec_alerts_create(body: SpecAlertIn, user: dict = Depends(require_paid)):
    """Be told, overnight, when a name enters or leaves this screen."""
    from api.services.screener import spec_alerts
    try:
        return spec_alerts.subscribe(user, body.name, body.spec, body.mode,
                                     body.saved_screen_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/screener/spec-alerts/{sub_id}/suspend",
             dependencies=[Depends(_spec_alerts_armed)])
def spec_alerts_suspend(sub_id: int, user: dict = Depends(require_paid)):
    """Off, never deleted: the spec, its snapshots and its history stay."""
    from api.services.screener import spec_alerts
    if not spec_alerts.set_suspended(user["id"], sub_id, True):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"id": sub_id, "suspended": True}


@router.post("/api/screener/spec-alerts/{sub_id}/resume",
             dependencies=[Depends(_spec_alerts_armed)])
def spec_alerts_resume(sub_id: int, user: dict = Depends(require_paid)):
    from api.services.screener import spec_alerts
    if not spec_alerts.set_suspended(user["id"], sub_id, False):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"id": sub_id, "suspended": False}


# ── AC-11 / UC-4: the save-time fork ────────────────────────────────────────
# Saving a result set asks WHAT it should become -- a frozen list, a
# re-runnable definition, or a standing alert -- and never guesses (PRD AC-11:
# "no code path that silently defaults to one choice"). A request without a
# choice is a 400. Each choice runs the function its own surface already owns;
# a choice whose surface is dark is OFFERED as unavailable, with the reason.
# DARK: SCREENER_SAVE_FORK_ENABLED.

SAVE_FORK_FLAG = "SCREENER_SAVE_FORK_ENABLED"
FORK_CHOICES = ("frozen_list", "definition", "standing_alert")


def save_fork_enabled() -> bool:
    return os.environ.get(SAVE_FORK_FLAG, "0").strip() == "1"


def _fork_armed() -> None:
    if not save_fork_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def fork_choices() -> list[dict]:
    from api.services.screener import spec_alerts
    return [
        {"id": "frozen_list", "label": "A frozen list",
         "detail": "Today's matches, as a watchlist. It will not change.",
         "available": is_enabled(),
         **({} if is_enabled() else {"reason": "Saving results as a list is not switched on yet."})},
        {"id": "definition", "label": "A re-runnable screen",
         "detail": "The criteria, saved. Every run shows that day's matches.",
         "available": True},
        {"id": "standing_alert", "label": "A standing alert",
         "detail": "The criteria, saved, and you are told overnight when names enter or leave.",
         "available": spec_alerts.is_enabled(),
         **({} if spec_alerts.is_enabled() else
            {"reason": "Standing screen alerts are not switched on yet."})},
    ]


class SaveForkIn(BaseModel):
    choice: str | None = None
    name: str | None = None
    spec: dict
    mode: str = "both"


@router.get("/api/screener/save-fork", dependencies=[Depends(_fork_armed)])
def save_fork_offer(_user: dict = Depends(require_paid)):
    return {"choices": fork_choices()}


@router.post("/api/screener/save-fork", dependencies=[Depends(_fork_armed)])
def save_fork(body: SaveForkIn, user: dict = Depends(require_paid)):
    choice = (body.choice or "").strip()
    if choice not in FORK_CHOICES:
        raise HTTPException(
            status_code=400,
            detail="Choose what this becomes: a frozen list, a re-runnable screen, "
                   "or a standing alert.")
    offered = {c["id"]: c for c in fork_choices()}[choice]
    if not offered["available"]:
        raise HTTPException(status_code=409, detail=offered["reason"])
    name = (body.name or "").strip()[:80] or "Untitled screen"
    if choice == "frozen_list":
        out = promote_to_watchlist(PromoteIn(spec=body.spec, name=name), user)
        return {"choice": choice, **out}
    from api.services.screener import saved_screens
    saved_screens.init()
    rec = saved_screens.create(user["id"], name, body.spec, False)
    if choice == "definition":
        return {"choice": choice, "saved_screen": rec}
    from api.services.screener import spec_alerts
    try:
        alert = spec_alerts.subscribe(user, name, body.spec, body.mode, rec["id"])
    except ValueError as e:
        # The definition is kept (never rolled back by a delete); the member is
        # told the alert half did not happen and why.
        raise HTTPException(status_code=400, detail=f"Saved the screen, but not the alert: {e}")
    return {"choice": choice, "saved_screen": rec, "alert": alert}
