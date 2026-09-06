"""Phase 4D-4C — read-only HTTP surface for `api/services/media_evidence_bridge.py`.

Mirrors the `desk_zoom_webhook.py` internal-service idiom exactly: PUSH_SECRET
bearer auth (curlable without a browser session), no writes, no LLM calls.
Consumed by uct-clips, a separate local repo with no session cookie of its own."""
from __future__ import annotations

import os

from fastapi import APIRouter, Query, Request, Response

from api.services import media_evidence_bridge

router = APIRouter(prefix="/api/internal/media-evidence", tags=["media-evidence-bridge"])


def _push_secret_ok(request: Request) -> bool:
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    return bool(expected) and auth == f"Bearer {expected}"


@router.get("/session-time/{video_id}")
def session_time(video_id: int, request: Request):
    """Authoritative Zoom start-time for a published Desk session video.
    PUSH_SECRET bearer. See media_evidence_bridge.get_session_time docstring
    for the fail-closed contract."""
    if not _push_secret_ok(request):
        return Response(status_code=401)
    return media_evidence_bridge.get_session_time(video_id)


@router.get("/trades")
def trades(
    request: Request,
    email: str = Query(..., description="Owner's account email — resolved server-side to a user_id"),
    symbol: str | None = Query(default=None),
    date_from: str | None = Query(default=None, description="YYYY-MM-DD, inclusive"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD, inclusive"),
):
    """Read-only j2_trades/j2_positions/j2_option_strategies rows for one user,
    each carrying its stable trade_ref. PUSH_SECRET bearer. See
    media_evidence_bridge.get_trade_linkage docstring — this returns evidence,
    not a linkage-confidence verdict."""
    if not _push_secret_ok(request):
        return Response(status_code=401)
    return media_evidence_bridge.get_trade_linkage(email, symbol, date_from, date_to)
