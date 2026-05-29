"""
flow_router.py — FastAPI router for flow database operations.

Endpoints:
    POST /api/flow/upload          — Upload CSV (stocks or indexes)
    GET  /api/flow/data            — Query flow data as CSV (streamed)
    GET  /api/flow/indexes-data    — Query indexes data as CSV (streamed)
    GET  /api/flow/stats           — DB statistics for admin
    POST /api/flow/prune           — Manually trigger expired contract cleanup
    GET  /api/flow/dates           — Available trading dates

Integration in main.py:
    from api.flow_router import flow_router
    app.include_router(flow_router)

Why streaming gzip:
  Previously this router collected the CSV generator into one string and
  gzipped the whole thing in memory. Fine for small windows, but for
  ?all_data=true (or any wide ?days=N) at multi-million-row scale that
  buffer was several hundred MB and could OOM the Railway worker. The
  streaming approach below keeps peak memory flat regardless of size.
"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.responses import StreamingResponse
from api.flow_db import FlowDB
import os
import zlib

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
db = FlowDB(DB_PATH)

flow_router = APIRouter(prefix="/api/flow", tags=["flow"])

# Same caching policy as the legacy CSV endpoints in main.py — SWR with a
# 5-min max-age. Query string (?days=N) is part of CF's cache key, so each
# window caches independently.
_FLOW_CACHE_HEADERS = {
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
            headers={**_FLOW_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    return StreamingResponse(
        _bytes_stream(gen),
        media_type="text/csv",
        headers=_FLOW_CACHE_HEADERS,
    )


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
        return StreamingResponse(
            iter([f"Error: {e}".encode("utf-8")]),
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
        return StreamingResponse(
            iter([f"Error: {e}".encode("utf-8")]),
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
