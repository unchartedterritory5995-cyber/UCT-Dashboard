"""
darkpool_router.py — FastAPI routes for dark pool data.
Mount in main.py:  app.include_router(darkpool_router.router)

Mirrors the flow_router.py architecture:
- /data uses streaming SQL cursor → incremental gzip → chunked response
- Cache-Control SWR matches flow's policy so CDN behavior is identical
- ?days=N query param is part of the cache key (each window caches separately)

Why streaming gzip:
  The previous version buffered the full CSV string in memory before
  gzip-compressing it ("".join(gen).encode + gzip.compress). That worked
  for small windows but OOM'd the Railway worker on large responses
  (e.g. ?all_data=true at 2.7M rows ≈ 600MB peak). The streaming approach
  here keeps peak memory flat regardless of response size.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
import zlib
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


def _gzip_stream(gen):
    """
    Wrap an upstream str-or-bytes generator with incremental gzip compression.

    Uses zlib.compressobj with wbits=16+MAX_WBITS to emit gzip-formatted
    output (not raw deflate). Peak memory is O(chunk size + compressor
    window) — no full-response buffering.
    """
    compressor = zlib.compressobj(level=4, wbits=16 + zlib.MAX_WBITS)
    for chunk in gen:
        if not chunk:
            continue
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8")
        out = compressor.compress(chunk)
        if out:
            yield out
    tail = compressor.flush()
    if tail:
        yield tail


def _bytes_stream(gen):
    """Convert str chunks to utf-8 bytes for non-gzip clients."""
    for chunk in gen:
        if not chunk:
            continue
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8")
        yield chunk


def _gzip_csv_response(gen, request: Request):
    """Stream CSV from a generator, gzip-compressing incrementally if client accepts."""
    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        return StreamingResponse(
            _gzip_stream(gen),
            media_type="text/csv",
            headers={**_DARKPOOL_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    return StreamingResponse(
        _bytes_stream(gen),
        media_type="text/csv",
        headers=_DARKPOOL_CACHE_HEADERS,
    )


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
    """
    try:
        if all_data or days == 0:
            gen = stream_csv(all_data=True)
        else:
            if days > 365:
                days = 365
            gen = stream_csv(days=days)
        return _gzip_csv_response(gen, request)
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
