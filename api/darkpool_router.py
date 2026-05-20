"""
darkpool_router.py — FastAPI routes for dark pool data.
Mount in main.py:  app.include_router(darkpool_router.router)
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse
from api.darkpool_db import (
    insert_csv_rows, get_data_csv, get_available_dates,
    get_stats, prune_old_data, clear_all
)

router = APIRouter(prefix="/api/darkpool", tags=["darkpool"])


# ── Public: Retrieve dark pool data as CSV ────────────────────────────────────
@router.get("/data")
async def get_darkpool_data(
    days: int = Query(default=1, ge=0, description="Number of trading days (0 = use all_data)"),
    all_data: bool = Query(default=False, description="Return all data"),
):
    """
    Returns dark pool data as CSV text.
    Frontend parses this the same way it parsed the static CSV.
    """
    try:
        csv_text = get_data_csv(
            days=days if not all_data else None,
            all_data=all_data
        )
        return PlainTextResponse(csv_text, media_type="text/csv")
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
    """
    Upload a BBS dark pool CSV export. Deduplicates automatically.
    """
    try:
        content = await file.read()
        csv_text = content.decode("utf-8-sig")  # Handle BOM from Excel exports

        if not csv_text.strip():
            raise HTTPException(status_code=400, detail="Empty file")

        # Validate it looks like a CSV
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
