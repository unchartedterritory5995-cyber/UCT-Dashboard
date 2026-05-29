"""
flow_router.py — FastAPI router for flow database operations.

Endpoints:
    POST /api/flow/upload          — Upload CSV (stocks or indexes)
    GET  /api/flow/data            — Query flow data as CSV (cached at CF edge)
    GET  /api/flow/indexes-data    — Query indexes data as CSV (cached at CF edge)
    GET  /api/flow/stats           — DB statistics for admin
    GET  /api/flow/version         — Cache-busting version key (changes on upload/prune)
    POST /api/flow/prune           — Manually trigger expired contract cleanup
    GET  /api/flow/dates           — Available trading dates

Integration in main.py:
    from api.flow_router import flow_router
    app.include_router(flow_router)

Why buffered (not streaming):
  An earlier version used StreamingResponse for incremental gzip. That kept
  peak server memory flat but Cloudflare won't cache chunked responses
  without Content-Length — every request became a Railway origin hit
  (~10s end-to-end instead of ~100ms edge hits). Buffering is fine here
  because the flow DB responses stay under ~30MB gzipped, and CF caching
  is the bigger throughput win.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from api.flow_db import FlowDB
import os
import gzip

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
db = FlowDB(DB_PATH)

flow_router = APIRouter(prefix="/api/flow", tags=["flow"])

# Same caching policy as the legacy CSV endpoints — SWR with a 5-min
# max-age. Query string (?days=N) is part of CF's cache key, so each
# window caches independently.
_FLOW_CACHE_HEADERS = {
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
            headers={**_FLOW_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    return Response(content=content, media_type="text/csv", headers=_FLOW_CACHE_HEADERS)


@flow_router.post("/upload")
async def upload_flow(request: Request):
    """
    Upload a BBS CSV file. Automatically deduplicates.
    ?source=stocks (default) or ?source=indexes
    Accepts raw CSV text in request body.
    """
    source = request.query_params.get("source", "stocks")
    if source not in ("stocks", "indexes"):
        source = "stocks"
    try:
        body = await request.body()
        csv_text = body.decode("utf-8-sig")

        if not csv_text or len(csv_text.strip()) < 50:
            return JSONResponse(
                {"status": "error", "message": "Empty or invalid CSV body"},
                status_code=400,
            )

        result = db.insert_csv(csv_text, source=source)
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
async def get_flow_data(request: Request):
    """
    Serve stock flow data as CSV (streamed).
    ?days=N (default 1) — last N trading days.
    ?all_data=true — all available data (heavy; opt-in only)
    """
    try:
        days_str = request.query_params.get("days", "1")
        all_data = request.query_params.get("all_data", "false").lower() == "true"
        days = int(days_str)
        if days < 1:
            days = 1
        if days > 365:
            days = 365
    except (ValueError, TypeError):
        days = 1
        all_data = False

    try:
        if all_data:
            gen = db.stream_csv(source="stocks")
        else:
            gen = db.stream_csv(source="stocks", days=days)
        return _gzip_csv_response(gen, request)
    except Exception as e:
        return Response(
            content=f"Error: {e}",
            status_code=500,
            media_type="text/plain",
        )


@flow_router.get("/indexes-data")
async def get_indexes_data(request: Request):
    """Serve indexes/ETF flow data as CSV (streamed)."""
    try:
        days_str = request.query_params.get("days", "1")
        all_data = request.query_params.get("all_data", "false").lower() == "true"
        days = int(days_str)
        if days < 1:
            days = 1
        if days > 365:
            days = 365
    except (ValueError, TypeError):
        days = 1
        all_data = False

    try:
        if all_data:
            gen = db.stream_csv(source="indexes")
        else:
            gen = db.stream_csv(source="indexes", days=days)
        return _gzip_csv_response(gen, request)
    except Exception as e:
        return Response(
            content=f"Error: {e}",
            status_code=500,
            media_type="text/plain",
        )


@flow_router.get("/stats")
async def get_stats():
    """Database statistics for admin display."""
    try:
        return JSONResponse(db.stats())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@flow_router.get("/version")
async def get_version():
    """Cache-busting version key. Returns DB row count, which changes whenever
    rows are inserted (uploads) or removed (prune). Clients append this as
    &v=<version> to /data and /indexes-data requests so CF treats each version
    as a separate cache entry — old cached responses naturally fall out of use
    when new data arrives.

    This endpoint itself is never cached (Cache-Control: no-store) so version
    bumps are seen immediately."""
    try:
        stats = db.stats()
        # Whatever changes on inserts/deletes works; total_rows is the obvious one
        version = (stats.get("total_rows")
                   or stats.get("count")
                   or stats.get("rows")
                   or 0)
        return JSONResponse(
            {"version": version},
            headers={"Cache-Control": "no-store, max-age=0"},
        )
    except Exception as e:
        return JSONResponse(
            {"version": 0, "error": str(e)},
            status_code=500,
            headers={"Cache-Control": "no-store, max-age=0"},
        )


@flow_router.post("/prune")
async def prune_expired(request: Request):
    """Manually prune expired contracts."""
    try:
        buffer_str = request.query_params.get("buffer_days", "7")
        buffer_days = max(0, min(90, int(buffer_str)))
    except (ValueError, TypeError):
        buffer_days = 7
    pruned = db.prune_expired(buffer_days=buffer_days)
    return JSONResponse({"pruned": pruned})


@flow_router.get("/dates")
async def get_dates(request: Request):
    """Get available trading dates for a source."""
    source = request.query_params.get("source", "stocks")
    if source not in ("stocks", "indexes"):
        source = "stocks"
    dates = db.get_available_dates(source)
    return JSONResponse({"dates": dates, "count": len(dates)})
