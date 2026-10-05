"""Research > Depth > News desk (Lane R: D-6 versions, D-7 importance, D-8 read state).

  GET  /api/research/news-desk/{sym}                    any of the three flags
  GET  /api/research/news-desk/story/{news_id}/versions NEWS_STORY_VERSIONS_ENABLED
  POST /api/research/news-desk/read                     NEWS_READ_STATE_ENABLED

Each gate is read per request; unset, the route answers 404 before identity.
Every handler is a plain `def`: each reads local SQLite (the company-news store,
auth.db), which is blocking I/O and must not run on the event loop. No handler
calls a provider.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The news desk requires a paid plan")
    return user


def _desk_armed() -> None:
    from api.services import news_desk
    if not news_desk.any_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _versions_armed() -> None:
    from api.services import news_versions
    if not news_versions.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _read_armed() -> None:
    from api.services import news_read_state
    if not news_read_state.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/news-desk/{sym}", dependencies=[Depends(_desk_armed)])
def news_desk_route(sym: str, limit: int = Query(default=25, ge=1, le=100),
                    cursor: Optional[str] = Query(default=None),
                    user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    from api.services import news_desk as svc
    return svc.desk(s, user["id"], limit=limit, cursor=cursor)


@router.get("/api/research/news-desk/story/{news_id}/versions",
            dependencies=[Depends(_versions_armed)])
def news_versions_route(news_id: int, _user: dict = Depends(require_paid)):
    from api.services import news_versions as svc
    out = svc.history(news_id)
    if out is None:
        raise HTTPException(status_code=404, detail="No such story")
    return out


@router.post("/api/research/news-desk/read", dependencies=[Depends(_read_armed)])
def news_read_route(body: dict = Body(...), user: dict = Depends(require_paid)):
    """{ids: [story id, ...], read: true|false}. Idempotent; owner-scoped."""
    from api.services import news_read_state as svc
    raw = (body or {}).get("ids")
    read = (body or {}).get("read")
    if not isinstance(raw, list) or not raw or not isinstance(read, bool):
        raise HTTPException(status_code=400, detail="Send ids (a non-empty list) and read (true or false)")
    if len(raw) > svc.MAX_IDS:
        raise HTTPException(status_code=400, detail=f"At most {svc.MAX_IDS} ids per request")
    try:
        ids = [int(i) for i in raw]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="ids must be story ids") from exc
    unknown = sorted(set(ids) - svc.existing_story_ids(ids))
    if unknown:
        raise HTTPException(status_code=404, detail=f"No such story: {', '.join(map(str, unknown[:10]))}")
    state = svc.set_read(user["id"], ids, read)
    return {"read": {str(k): v for k, v in state.items()}, "ids": ids}
