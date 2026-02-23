# api/routers/push.py
import os
import json
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from api.services.cache import cache

router = APIRouter()

INVALIDATE_KEYS = [
    "wire_data", "breadth", "themes_1W", "themes_1M", "themes_3M",
    "leadership", "rundown", "earnings", "screener", "movers",
]

PERSISTENT_WIRE_DATA_FILE = "/data/wire_data.json"


@router.post("/api/push")
def push_wire_data(
    payload: dict,
    authorization: Optional[str] = Header(None),
):
    """Receive wire_data from the local morning wire engine.

    Secured with PUSH_SECRET env var. Invalidates all derived caches
    then stores the full payload so engine_data endpoints serve fresh data.
    Persists to /data/wire_data.json (Railway volume) so cache survives redeploys.
    """
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    for key in INVALIDATE_KEYS:
        cache.invalidate(key)

    cache.set("wire_data", payload, ttl=82800)  # 23 hours

    # Persist to Railway volume so data survives redeploys
    try:
        os.makedirs(os.path.dirname(PERSISTENT_WIRE_DATA_FILE), exist_ok=True)
        with open(PERSISTENT_WIRE_DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except OSError:
        pass  # Volume not mounted in local dev — safe to ignore

    return {"ok": True, "date": payload.get("date", "")}
