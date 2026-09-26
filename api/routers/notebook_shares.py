"""Note share links -- the five routes, MOVED here from journal_two.py (wave 8, seam S8-2).

Why a separate router: lane 8B (sharing + publish-to-web) works on these routes this
wave, and lane 8C adds export formats in the same neighbourhood. `journal_two.py` is
one 5,000-line file, and a pathspec commit to it carries every lane's hunks at once --
so the share routes live here and `journal_two.py` is touched by no lane in wave 8.

⛔ A MOVE, NOT A CHANGE. The block below is byte-for-byte the block that stood in
`journal_two.py` (paths, handlers, flag checks, 404 bodies); the router carries the
same prefix and tags, and `api/main.py` mounts it BEFORE `journal_two`.
`tests/test_notebook_share_routes.py` asks the REAL app that each route is served
exactly once and answered first by the handler below.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from api.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/j2", tags=["journal-2-0"])


# ── Note share links (post-v1; screener-share idiom: token IS the credential).
# ⛔ ALL FIVE endpoints are flag-gated (J2_SHARE_LINKS_ENABLED, default OFF →
# 404, nothing reachable) — owner-side (mint/status/revoke) AND the public
# read pair alike. Until 2026-09-22 only the public pair checked the flag;
# the owner-side three relied entirely on the frontend's separate `isAdmin`
# gate (NoteEditorPage.jsx) to keep the Share button from ever being clicked
# while the mechanism is off. That was inert (an admin-minted token still
# 404s on public resolution while the flag is off) but was the one place this
# design leaned on a second gate doing work the backend could do on its own —
# competitive audit finding Collaboration F2, 2026-09-22.
from api.services.journal_two import note_shares


@router.get("/notes/{note_id}/share")
def get_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if not note_shares.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return {"share": note_shares.get_share(user["id"], note_id)}


@router.post("/notes/{note_id}/share")
def create_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if not note_shares.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    share = note_shares.create_share(user["id"], note_id)
    if share is None:
        raise HTTPException(status_code=404, detail="note not found")
    return {"share": share}


@router.delete("/notes/{note_id}/share")
def revoke_note_share_endpoint(note_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if not note_shares.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return {"revoked": note_shares.revoke_share(user["id"], note_id)}


@router.get("/shared/{token}")
def resolve_shared_note_endpoint(token: str) -> dict[str, Any]:
    """PUBLIC — no auth by design (a link that only opens for people with an
    account is not sharing). The token is the credential; the payload is
    sanitized; the flag is the master switch."""
    if not note_shares.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    payload = note_shares.resolve_share(token)
    if payload is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"note": payload}


@router.get("/shared/{token}/att/{sub}/{filename}")
def serve_shared_attachment_endpoint(token: str, sub: str, filename: str) -> Any:
    """PUBLIC image proxy for a shared note — images only, token-scoped to
    exactly that note's directory, path-traversal guarded downstream."""
    if not note_shares.enabled():
        raise HTTPException(status_code=404, detail="Not found")
    path = note_shares.resolve_share_attachment(token, sub, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path))
