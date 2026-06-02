"""Company logo serving + bulk warm.

GET /api/ticker-logo/{sym} — cache hit streams the cached PNG with a long
immutable header; miss returns a 1x1 transparent PNG (short-cached) AND kicks
off a bounded background resolve so the next request is warm. The frontend
detects the transparent pixel (naturalWidth<=2) and renders a monogram, so a
cold logo shows a clean letter tile, never a broken/blank image.

POST /api/logos/prewarm — trigger a full universe warm pass on demand.
GET  /api/logos/status  — live progress of the warm pass.
"""
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from api.services import ticker_logos as tl
from api.services import ticker_logos_prewarm as pw

router = APIRouter()
_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}


@router.get("/api/ticker-logo/{sym}")
def ticker_logo(sym: str):
    path = tl.get_logo_path(sym)
    if path:
        return FileResponse(path, media_type="image/png", headers=_HEADERS)
    tl.schedule_resolve(sym)
    # Short cache (60s) so a just-warmed logo is picked up on the next render/visit.
    return Response(content=tl.TRANSPARENT_PNG, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=60"})


@router.post("/api/logos/prewarm")
def prewarm_logos():
    """Kick a full cap-universe logo warm pass (idempotent — one at a time)."""
    started = pw.run_now()
    return {"ok": True, "started": started, "progress": pw.get_progress()}


@router.get("/api/logos/status")
def logos_status():
    """Live progress of the logo warm pass."""
    return pw.get_progress()
