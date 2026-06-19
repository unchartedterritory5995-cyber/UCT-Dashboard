"""Morning Wire per-segment feedback: user vote POST + PUSH_SECRET internal GET."""
from __future__ import annotations

import os
import re
from typing import Optional

from fastapi import APIRouter, Body, Header, HTTPException, Depends

from api.middleware.auth_middleware import get_current_user
from api.services import wire_feedback_store as store
from api.services import engine

router = APIRouter(prefix="/api", tags=["wire-feedback"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SEG_KEYS = {"overall", "tape", "macro", "earn", "analyst", "movers", "setups", "close"}


def _segment_text(market_date: str, segment_key: str) -> str:
    """Best-effort: pull the voted segment's <p> text from the CURRENT rundown_html.
    Only today's wire is retained; if the displayed date differs we store ''."""
    if segment_key == "overall":
        return ""
    wire = engine._load_wire_data() or {}
    if wire.get("date") != market_date:
        return ""
    html = wire.get("rundown_html") or ""
    m = re.search(
        r'<section class="rd-seg"[^>]*data-seg="' + re.escape(segment_key) + r'"[^>]*>.*?<p>(.*?)</p>',
        html, re.DOTALL)
    if not m:
        return ""
    return re.sub(r"<[^>]+>", "", m.group(1)).strip()[:4000]


@router.post("/wire-feedback")
def wire_feedback_vote(body: dict = Body(...), user=Depends(get_current_user)):
    market_date = str(body.get("market_date") or "").strip()
    segment_key = str(body.get("segment_key") or "").strip()
    verdict = str(body.get("verdict") or "").lower().strip()
    if not _DATE_RE.match(market_date):
        raise HTTPException(400, "market_date must be YYYY-MM-DD")
    if segment_key not in _SEG_KEYS:
        raise HTTPException(400, "invalid segment_key")
    if verdict not in ("up", "down"):
        raise HTTPException(400, "verdict must be 'up' or 'down'")
    is_admin = 1 if user.get("role") == "admin" else 0
    store.record_vote(user_id=str(user["id"]), market_date=market_date,
                      segment_key=segment_key, verdict=verdict,
                      segment_text=_segment_text(market_date, segment_key),
                      is_admin=is_admin)
    return {"ok": True, "segment_key": segment_key, "verdict": verdict}


@router.get("/wire-feedback/recent-internal")
def wire_feedback_recent_internal(authorization: Optional[str] = Header(None),
                                  days: int = 30):
    secret = os.environ.get("PUSH_SECRET", "")
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"votes": store.recent_admin_votes(days=days)}
