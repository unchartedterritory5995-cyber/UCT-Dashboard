"""
darkpool_router.py — FastAPI routes for dark pool data.
Mount in main.py:  app.include_router(darkpool_router.router)

Mirrors the flow_router.py architecture:
- /data uses streaming SQL cursor → buffered gzip → Response with Content-Length
- 60-day cap on /data to keep response sizes manageable for both server and browser
- Cache-Control SWR so Cloudflare caches each ?days=N window at the edge

Why buffered (not streaming):
  An earlier version used StreamingResponse for incremental gzip. That kept
  peak server memory flat but Cloudflare won't cache chunked responses
  without Content-Length — every request became a Railway origin hit
  (~10s instead of ~100ms edge hits). The 60-day cap below keeps response
  sizes well within memory budget, so buffering is the right tradeoff.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Request
from fastapi.responses import JSONResponse, Response
import gzip
from api.darkpool_db import (
    insert_csv_rows, stream_csv, get_available_dates,
    get_stats, prune_old_data, clear_all
)

router = APIRouter(prefix="/api/darkpool", tags=["darkpool"])

# Same caching policy as flow_router — SWR with a 5-min max-age. The
# ?days=N query string is part of CF's cache key, so each window caches
# independently and a stale response can serve while a fresh one warms.
_DARKPOOL_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}


def _gzip_csv_response(gen, request: Request):
    """Collect CSV generator into bytes, gzip if client accepts, return Response
    with Content-Length set so Cloudflare can cache."""
    content = "".join(gen).encode("utf-8")
    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        compressed = gzip.compress(content, compresslevel=4)
        return Response(
            content=compressed,
            media_type="text/csv",
            headers={**_DARKPOOL_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    return Response(content=content, media_type="text/csv", headers=_DARKPOOL_CACHE_HEADERS)


# Hard cap on response size in trading days. The browser can't reliably
# Papa.parse + render more than this many days of raw darkpool prints
# without blowing past Chrome's JS heap limit (~1.5GB). At ~25K rows/day
# this lands around 1.5M rows / 180MB decompressed CSV — the highest
# empirically-working window.
#
# When this fires for a request, response carries X-Data-Capped-Days so the
# frontend can show "Showing most recent 60d — DB contains N" if it wants.
MAX_RESPONSE_DAYS = 60


# ── Public: Retrieve dark pool data as CSV ────────────────────────────────────
@router.get("/data")
async def get_darkpool_data(
    request: Request,
    days: int = Query(default=1, ge=0, description="Number of trading days (0 = use all_data)"),
    all_data: bool = Query(default=False, description="Return all data"),
):
    """
    Returns dark pool data as CSV text (gzipped if client accepts).
    Frontend (DarkPool.jsx) parses this the same way it parsed the static CSV.

    Capped at MAX_RESPONSE_DAYS trading days to keep the browser stable.
    For full-history views, build a server-side aggregation endpoint instead
    of shipping raw rows.
    """
    try:
        capped = False
        if all_data or days == 0:
            effective_days = MAX_RESPONSE_DAYS
            capped = True
        else:
            if days > MAX_RESPONSE_DAYS:
                capped = True
            effective_days = min(days, MAX_RESPONSE_DAYS)

        gen = stream_csv(days=effective_days)
        response = _gzip_csv_response(gen, request)
        if capped:
            response.headers["X-Data-Capped-Days"] = str(MAX_RESPONSE_DAYS)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Public: Get available trading dates ───────────────────────────────────────
@router.get("/dates")
async def get_dates():
    """Return list of available trading dates for the date picker."""
    try:
        dates = get_available_dates()
        return JSONResponse({"dates": dates, "count": len(dates)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Upload CSV data ────────────────────────────────────────────────────
@router.post("/upload")
async def upload_darkpool_csv(file: UploadFile = File(...)):
    """Upload a BBS dark pool CSV export. Deduplicates automatically."""
    try:
        content = await file.read()
        csv_text = content.decode("utf-8-sig")  # Handle BOM from Excel exports

        if not csv_text.strip():
            raise HTTPException(status_code=400, detail="Empty file")

        first_line = csv_text.strip().split("\n")[0]
        if "Date" not in first_line or "Ticker" not in first_line:
            raise HTTPException(
                status_code=400,
                detail="CSV must have Date and Ticker columns. Got: " + first_line[:100]
            )

        result = insert_csv_rows(csv_text)
        return JSONResponse({
            "status": "ok",
            "filename": file.filename,
            **result
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Upload CSV as raw text (for admin JSX fetch) ───────────────────────
@router.post("/upload-text")
async def upload_darkpool_text(body: dict):
    """
    Upload CSV as raw text in JSON body { "csv_text": "..." }.
    Used by the admin dashboard drag-and-drop upload.
    """
    try:
        csv_text = body.get("csv_text", "")
        filename = body.get("filename", "upload.csv")

        if not csv_text.strip():
            raise HTTPException(status_code=400, detail="Empty CSV text")

        result = insert_csv_rows(csv_text)
        return JSONResponse({
            "status": "ok",
            "filename": filename,
            **result
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: DB stats ───────────────────────────────────────────────────────────
@router.get("/stats")
async def darkpool_stats():
    """Return database statistics."""
    try:
        return JSONResponse(get_stats())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Prune old data ────────────────────────────────────────────────────
@router.post("/prune")
async def prune_data(keep_days: int = Query(default=120)):
    """Remove data older than keep_days trading days."""
    try:
        deleted = prune_old_data(keep_days)
        return JSONResponse({"status": "ok", "deleted": deleted, "kept_days": keep_days})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Clear all data ────────────────────────────────────────────────────
@router.delete("/clear")
async def clear_data():
    """Delete ALL dark pool data. Use with caution."""
    try:
        clear_all()
        return JSONResponse({"status": "ok", "message": "All dark pool data cleared"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
