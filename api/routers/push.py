# api/routers/push.py
import os
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from api.services.cache import cache

router = APIRouter()

INVALIDATE_KEYS = [
    "wire_data", "breadth", "themes_1W", "themes_1M", "themes_3M",
    "leadership", "rundown", "earnings", "screener", "movers",
]


@router.post("/api/push")
def push_wire_data(
    payload: dict,
    authorization: Optional[str] = Header(None),
):
    """Receive wire_data from the local morning wire engine.

    Secured with PUSH_SECRET env var. Invalidates all derived caches
    then stores the full payload so engine_data endpoints serve fresh data.
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    for key in INVALIDATE_KEYS:
        cache.invalidate(key)

    cache.set("wire_data", payload, ttl=82800)  # 23 hours

    return {"ok": True, "date": payload.get("date", "")}
