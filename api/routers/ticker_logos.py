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

# A real cached logo is content-addressed and never changes → immutable + 7 days.
# This is what a Cloudflare cache rule on `/api/ticker-logo/*` edge-caches: served
# once per PoP instead of a per-browser origin round-trip (the DYNAMIC-cache-status
# origin hit that made a watchlist's worth of logos pop in over 1-2s). The `?v=`
# asset-version + `?name=`/`?alt=` hints stay in the cache key (distinct variants =
# distinct keys), so they cache correctly too.
_HIT_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}

# A cold miss returns a transparent 1x1 pixel while the real logo resolves in the
# background. This MUST NOT be shared-cached: if Cloudflare pinned the pixel at the
# edge, every OTHER viewer would get a blank for that ticker until the (short) TTL
# expired, even after the logo resolved. `no-store` keeps it origin-only + tells the
# browser to re-request next render, so the real logo is picked up as soon as it's
# warm (the client's own retry loop also re-hits with `?_r=`). The frontend detects
# the pixel via naturalWidth<=2 and shows a monogram, so this is never a broken image.
_MISS_HEADERS = {"Cache-Control": "no-store"}


@router.get("/api/ticker-logo/{sym}")
def ticker_logo(sym: str, name: str = None, alt: str = None):
    """`name` (company name) + `alt` (exchange-suffixed provider symbol, e.g.
    005930.KS) are optional resolution hints for non-US tickers that have no logo
    under their bare symbol — passed by the Model Book for foreign stocks."""
    path = tl.get_logo_path(sym)
    if path:
        return FileResponse(path, media_type="image/png", headers=_HIT_HEADERS)
    tl.schedule_resolve(sym, name=name, alt=alt)
    return Response(content=tl.TRANSPARENT_PNG, media_type="image/png",
                    headers=_MISS_HEADERS)


@router.post("/api/logos/prewarm")
def prewarm_logos(misses: int = 0, hires: int = 0):
    """Kick a logo warm pass.

    Query params:
        hires=1   Re-cache every existing logo at the current (256px) resolution.
        misses=1  Run the slow miss-retry pass (≤2 workers, extended source chain).
        (default) Run the normal full universe warm pass (12 workers, CDN-fast).
    """
    if hires:
        result = pw.run_hires_upgrade_now()
        return {"ok": True, "mode": "hires", **result}
    if misses:
        result = pw.run_miss_retry_now()
        return {"ok": True, "mode": "miss_retry", **result}
    started = pw.run_now()
    return {"ok": True, "started": started, "progress": pw.get_progress()}


@router.get("/api/logos/status")
def logos_status():
    """Live progress of the logo warm pass + real disk coverage."""
    return {**pw.get_progress(), "coverage": pw.coverage()}
