"""
darkpool_router.py — FastAPI routes for dark pool data.
Mount in main.py:  app.include_router(darkpool_router.router)

History note (why this changed):
  Previous version buffered the full CSV into memory and gzipped it before
  returning a Response with Content-Length, on the theory that Cloudflare
  could then edge-cache windows by ?days=N. That theory didn't hold up:
  DarkPool.jsx appends ?_t=Date.now() to every request, so the cache key
  changes every fetch — Cloudflare never serves a cached response. Meanwhile
  the buffer cost was real: at 36K rows/day actual (not the 25K we'd
  assumed), 60+ days = 250MB+ raw CSV being held in memory plus a gzip
  output buffer, OOM-killing the Railway worker mid-response. The browser
  saw a truncated/empty body and parseCSV returned 0 rows → "No data
  returned" error on the dashboard.

  Now using StreamingResponse with the stream_csv() generator (same pattern
  as flow_router). Memory stays flat regardless of window size, first byte
  arrives in ~100ms, and the app-level GZipMiddleware (main.py:1792)
  auto-compresses each chunk. Cap raised to 120 days to match the DB
  auto-prune retention policy.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from api.darkpool_db import (
    insert_csv_rows, stream_csv, get_available_dates,
    get_stats, prune_old_data, clear_all
)

router = APIRouter(prefix="/api/darkpool", tags=["darkpool"])

# Cap matches the DB retention policy (auto-prune at 120 days in main.py).
# With streaming, memory cost on the server is flat regardless of window —
# the practical ceiling is the browser's ability to parse and render the
# row count. ~36K rows/day → 120 days ≈ 4.3M rows / ~500MB raw CSV.
# If the browser struggles at the high end, lower this rather than going
# back to buffering on the server.
MAX_RESPONSE_DAYS = 120


# ── Public: Retrieve dark pool data as CSV ────────────────────────────────────
@router.get("/data")
async def get_darkpool_data(
    request: Request,
    days: int = Query(default=1, ge=0, description="Number of trading days (0 = all available)"),
    all_data: bool = Query(default=False, description="Return all data"),
):
    """
    Stream dark pool data as CSV text (auto-gzipped by app middleware).
    Frontend (DarkPool.jsx) parses the response the same way it parsed the
    static CSV — header row + comma-separated trade rows.

    Capped at MAX_RESPONSE_DAYS trading days. X-Data-Capped-Days header is
    set when the cap fires so the frontend can surface a user-facing notice
    ("Showing most recent 120d — DB contains N").
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

        # Cache-Control kept for the day when the frontend stops cache-busting.
        # Currently DarkPool.jsx appends ?_t=Date.now() so Cloudflare never
        # hits, but the headers are cheap and correct.
        headers = {
            "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
            "Vary": "Accept-Encoding",
        }
        if capped:
            headers["X-Data-Capped-Days"] = str(MAX_RESPONSE_DAYS)

        return StreamingResponse(
            stream_csv(days=effective_days),
            media_type="text/csv",
            headers=headers,
        )
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
