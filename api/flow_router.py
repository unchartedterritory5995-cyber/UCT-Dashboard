"""
flow_router.py — FastAPI router for flow database operations.

Endpoints:
    POST /api/flow/upload          — Upload CSV (stocks or indexes)
    GET  /api/flow/data            — Query flow data as CSV (replaces /flow-data.csv)
    GET  /api/flow/indexes-data    — Query indexes data as CSV (replaces /Indexes-data.csv)
    GET  /api/flow/stats           — DB statistics for admin
    POST /api/flow/prune           — Manually trigger expired contract cleanup
    GET  /api/flow/dates           — Available trading dates

Integration in main.py:
    from flow_router import flow_router
    app.include_router(flow_router)
"""

from fastapi import APIRouter, UploadFile, File, Query
from fastapi.responses import PlainTextResponse, JSONResponse
from flow_db import FlowDB
import os

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
db = FlowDB(DB_PATH)

flow_router = APIRouter(prefix="/api/flow", tags=["flow"])


@flow_router.post("/upload")
async def upload_flow(
    file: UploadFile = File(...),
    source: str = Query("stocks", regex="^(stocks|indexes)$"),
):
    """
    Upload a BBS CSV file. Automatically deduplicates.
    Source: 'stocks' for regular flow, 'indexes' for ETF/index flow.
    """
    try:
        content = await file.read()
        csv_text = content.decode("utf-8-sig")  # handles BOM

        result = db.insert_csv(csv_text, source=source)

        # Auto-prune expired contracts after each upload
        pruned = db.prune_expired()

        return JSONResponse({
            "status": "ok",
            "inserted": result["inserted"],
            "skipped": result["skipped"],
            "dates": result["dates"],
            "pruned": pruned,
            "source": source,
        })
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=500,
        )


@flow_router.get("/data")
async def get_flow_data(
    days: int = Query(20, ge=1, le=365),
    all_data: bool = Query(False, alias="all"),
):
    """
    Serve stock flow data as CSV.
    ?days=20 (default) — last 20 trading days
    ?all=true — all available data (use with caution)
    """
    if all_data:
        csv_text = db.query_all_csv(source="stocks")
    else:
        csv_text = db.query_csv(source="stocks", days=days)
    return PlainTextResponse(csv_text, media_type="text/csv")


@flow_router.get("/indexes-data")
async def get_indexes_data(
    days: int = Query(20, ge=1, le=365),
    all_data: bool = Query(False, alias="all"),
):
    """Serve indexes/ETF flow data as CSV."""
    if all_data:
        csv_text = db.query_all_csv(source="indexes")
    else:
        csv_text = db.query_csv(source="indexes", days=days)
    return PlainTextResponse(csv_text, media_type="text/csv")


@flow_router.get("/stats")
async def get_stats():
    """Database statistics for admin dashboard."""
    return JSONResponse(db.stats())


@flow_router.post("/prune")
async def prune_expired(
    buffer_days: int = Query(7, ge=0, le=90),
):
    """Manually prune expired contracts."""
    pruned = db.prune_expired(buffer_days=buffer_days)
    return JSONResponse({"pruned": pruned})


@flow_router.get("/dates")
async def get_dates(
    source: str = Query("stocks", regex="^(stocks|indexes)$"),
):
    """Get available trading dates for a source."""
    dates = db.get_available_dates(source)
    return JSONResponse({"dates": dates, "count": len(dates)})
