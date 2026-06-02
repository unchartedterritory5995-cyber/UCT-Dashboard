"""GET /api/ticker-logo/{sym} — serve cached company logo PNG.

Cache hit → stream the file with a long immutable cache header. Miss →
return a 1x1 transparent PNG immediately AND kick off a bounded background
resolve so the next request is warm. The frontend renders a monogram
fallback over the transparent pixel, so a logo is never a broken image.
"""
from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from api.services import ticker_logos as tl

router = APIRouter()
_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}


@router.get("/api/ticker-logo/{sym}")
def ticker_logo(sym: str):
    path = tl.get_logo_path(sym)
    if path:
        return FileResponse(path, media_type="image/png", headers=_HEADERS)
    tl.schedule_resolve(sym)
    return Response(content=tl.TRANSPARENT_PNG, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=300"})
