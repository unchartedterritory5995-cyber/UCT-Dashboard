"""
darkpool_router.py — FastAPI routes for dark pool data.
Mount in main.py:  app.include_router(darkpool_router.router)

Architecture mirrors flow_router.py exactly. Three-layer caching for
moderate-to-large CSV responses (90d at ~3M rows / ~250MB raw):

1. Stream-compress through GzipFile rather than buffer-then-compress.
   For 60+ day windows, the previous build-full-string approach allocated
   250MB+ of uncompressed CSV in RAM before gzipping, OOM-killing the
   Railway worker. Streaming chunks through gzip caps peak memory at the
   compressed size (~30MB for 90d), independent of raw size.

2. compresslevel=1 (not the default 6) cuts gzip CPU ~60% in exchange for
   ~10% larger output. Speed-to-first-byte beats absolute size when CF
   caches the result either way.

3. In-memory LRU cache (8 entries) keyed by (days, version). If CF
   misses (e.g. after a version bump) and multiple users hit at once,
   only the first request rebuilds; the rest serve from RAM.

Buffered Response (not StreamingResponse) is mandatory because
Cloudflare won't cache chunked responses without Content-Length. The
streaming above is internal to the handler; the response itself ships
as a single buffered payload.

Cache invalidation: total_rows from the DB acts as the version key.
Uploads/prunes change the count → /version endpoint reports the new
number → clients append it as ?v=N → CF treats it as a fresh URL.
Both client-side and server-side caches invalidate in sync.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Request, Depends
from api.flow_admin_auth import require_flow_admin
from fastapi.responses import JSONResponse, Response
from collections import OrderedDict
from api.darkpool_db import (
    insert_csv_rows, stream_csv, get_available_dates,
    get_stats, prune_old_data, clear_all, get_ticker_prints
)
from api.darkpool_aggregator import (
    get_aggregated as get_aggregated_payload,
    prebuild_all_windows_background,
    invalidate_cache as invalidate_agg_cache,
)
import gzip
import io
import json

router = APIRouter(prefix="/api/darkpool", tags=["darkpool"])

_DARKPOOL_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}

# ── In-memory response cache ────────────────────────────────────────────────
# Keyed by (days,)  where days=None means "all". Values: (version, gzipped_bytes).
# Bounded at 8 entries with LRU eviction. Working set is small (~6 windows:
# 1d/5d/20d/60d/90d/all). At ~30MB per large entry, 8 entries caps RAM at
# ~240MB worst case — fits comfortably in a Railway dyno.
_RESPONSE_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_RESPONSE_CACHE_MAX = 8


def _current_version() -> int:
    """DB total row count — used as cache invalidation key. Same number the
    /version endpoint returns so client and server caches invalidate together."""
    try:
        return get_stats().get("total_rows") or 0
    except Exception:
        return 0


def _build_gzipped_csv(days) -> bytes:
    """Stream the CSV generator through the gzip compressor, returning
    full gzipped bytes. Memory peak ~= compressed size, NOT raw CSV size.

    days=None means "all data" — stream_csv handles that path."""
    gen = stream_csv(days=days) if days is not None else stream_csv()
    buf = io.BytesIO()
    # compresslevel=1: ~60% faster than the default level 6 / ~10% larger
    # output. CF caches either way, so first-byte speed wins.
    # mtime=0: deterministic gzip header — same data -> byte-identical output,
    # so HTTP intermediaries can compare-and-skip on revalidation.
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=1, mtime=0) as gz:
        for chunk in gen:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            gz.write(chunk)
    return buf.getvalue()


def _get_cached_or_build(days) -> bytes:
    """Return gzipped CSV bytes for (days,), using the in-memory cache when
    version matches. LRU eviction at _RESPONSE_CACHE_MAX entries."""
    version = _current_version()
    key = (days,)
    cached = _RESPONSE_CACHE.get(key)
    if cached and cached[0] == version:
        _RESPONSE_CACHE.move_to_end(key)  # touch — most recently used
        return cached[1]

    payload = _build_gzipped_csv(days)
    if len(_RESPONSE_CACHE) >= _RESPONSE_CACHE_MAX:
        _RESPONSE_CACHE.popitem(last=False)  # evict LRU
    _RESPONSE_CACHE[key] = (version, payload)
    return payload


def _serve_csv(days, request: Request):
    """Build (or fetch cached) gzipped CSV and return as Response with
    Content-Length set implicitly. CF caches by full URL incl. ?v= and ?days=."""
    try:
        gzipped = _get_cached_or_build(days)
    except Exception as e:
        return Response(content=f"Error: {e}", status_code=500, media_type="text/plain")

    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        return Response(
            content=gzipped,
            media_type="text/csv",
            headers={**_DARKPOOL_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    # Rare path: client doesn't accept gzip. Decompress before sending.
    content = gzip.decompress(gzipped)
    return Response(content=content, media_type="text/csv", headers=_DARKPOOL_CACHE_HEADERS)


# ── Public: Retrieve dark pool data as CSV ────────────────────────────────────
@router.get("/data")
async def get_darkpool_data(
    request: Request,
    days: int = Query(default=1, ge=0, description="Number of trading days (0 = all)"),
    all_data: bool = Query(default=False),
):
    """Serve dark pool data as gzipped CSV (cached at CF edge via ?v=)."""
    if all_data or days == 0:
        return _serve_csv(None, request)  # all
    if days < 1:
        days = 1
    if days > 365:
        days = 365
    return _serve_csv(days, request)


# ── Public: Aggregated JSON (new primary endpoint) ────────────────────────────
@router.get("/aggregated")
async def get_darkpool_aggregated(
    days: int = Query(default=1, ge=0, description="Trading days (0 = all)"),
    all_data: bool = Query(default=False),
):
    """Return aggregated dark pool data as JSON.

    Output matches the dpData shape that DarkPool.jsx parseCSVtoD used to
    produce client-side, so the UI components consume it directly without
    further processing.

    File-cached on /data volume. Cache key includes a DB signature so any
    upload (or prune) automatically invalidates. First request after a
    cache miss takes 5-15s; subsequent identical requests are sub-second.
    """
    try:
        if all_data or days == 0:
            payload = get_aggregated_payload(all_data=True)
        else:
            if days > 365:
                days = 365
            payload = get_aggregated_payload(days=days)
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return Response(
            content=body,
            media_type="application/json",
            headers=_DARKPOOL_CACHE_HEADERS,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Manually trigger aggregation pre-build ────────────────────────────
@router.post("/prebuild")
async def prebuild_now(_auth: dict = Depends(require_flow_admin)):
    """Kick off background pre-compute of all common windows.
    Called automatically on upload — exposed here for manual ops use."""
    prebuild_all_windows_background()
    return JSONResponse({"status": "prebuild started"})


# ── Public: Get available trading dates ───────────────────────────────────────
@router.get("/dates")
async def get_dates():
    """Return list of available trading dates for the date picker."""
    try:
        dates = get_available_dates()
        return JSONResponse({"dates": dates, "count": len(dates)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Public: Cache-busting version key ────────────────────────────────────────
@router.get("/version")
async def get_version():
    """Returns DB total_rows. Changes whenever rows are inserted (uploads) or
    removed (prune). Clients append this as &v=<version> to /data requests so
    CF treats each version as a separate cache entry — old cached responses
    naturally fall out of use when new data arrives.

    This endpoint itself is never cached (Cache-Control: no-store) so version
    bumps are seen immediately."""
    try:
        return JSONResponse(
            {"version": _current_version()},
            headers={"Cache-Control": "no-store, max-age=0"},
        )
    except Exception as e:
        return JSONResponse(
            {"version": 0, "error": str(e)},
            status_code=500,
            headers={"Cache-Control": "no-store, max-age=0"},
        )


# ── Admin: Upload CSV data ────────────────────────────────────────────────────
@router.post("/upload")
async def upload_darkpool_csv(file: UploadFile = File(...), _auth: dict = Depends(require_flow_admin)):
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
        _RESPONSE_CACHE.clear()  # version bumped, in-memory CSV cache stale
        invalidate_agg_cache()   # JSON aggregation cache also stale
        prebuild_all_windows_background()  # warm the cache for end users
        return JSONResponse({"status": "ok", "filename": file.filename, **result})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Upload CSV as raw text (for admin JSX fetch) ───────────────────────
@router.post("/upload-text")
async def upload_darkpool_text(body: dict, _auth: dict = Depends(require_flow_admin)):
    """Upload CSV as raw text in JSON body { "csv_text": "..." }."""
    try:
        csv_text = body.get("csv_text", "")
        filename = body.get("filename", "upload.csv")
        if not csv_text.strip():
            raise HTTPException(status_code=400, detail="Empty CSV text")
        result = insert_csv_rows(csv_text)
        _RESPONSE_CACHE.clear()  # version bumped, in-memory CSV cache stale
        invalidate_agg_cache()   # JSON aggregation cache also stale
        prebuild_all_windows_background()  # warm the cache for end users
        return JSONResponse({"status": "ok", "filename": filename, **result})
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
async def prune_data(keep_days: int = Query(default=120), _auth: dict = Depends(require_flow_admin)):
    """Remove data older than keep_days trading days."""
    try:
        deleted = prune_old_data(keep_days)
        _RESPONSE_CACHE.clear()
        invalidate_agg_cache()
        prebuild_all_windows_background()
        return JSONResponse({"status": "ok", "deleted": deleted, "kept_days": keep_days})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Clear all data ────────────────────────────────────────────────────
@router.delete("/clear")
async def clear_data(_auth: dict = Depends(require_flow_admin)):
    """Delete ALL dark pool data. Use with caution."""
    try:
        clear_all()
        _RESPONSE_CACHE.clear()
        invalidate_agg_cache()
        return JSONResponse({"status": "ok", "message": "All dark pool data cleared"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Public: Ticker drill-down (print history for one ticker) ─────────────────
@router.get("/ticker-detail")
async def get_ticker_detail(
    sym: str = Query(..., description="Ticker symbol", min_length=1, max_length=10),
    days: int = Query(default=30, ge=5, le=365, description="Trading-day window"),
    limit: int = Query(default=30, ge=5, le=100, description="Max prints to return"),
):
    """Return the dark pool print history for a single ticker.

    Powers the expandable row in the Patterns Detected panel. Frontend
    pairs this with /api/schwab/chart-ohlc to overlay print bars on a
    candlestick chart over the requested timeframe.

    Response shape:
        {
          "ticker": "UBER",
          "days": 30,
          "count": 12,
          "totalNotional": 42500000,
          "prints": [
            {"date": "5/8", "dateLong": "May 8, 2026", "dateRaw": "5/8/2026",
             "price": 128.50, "notional": 12500000, "pctAvgVol": 350,
             "volume": 97276, "type": "B"},
            ...
          ]
        }
    """
    try:
        prints = get_ticker_prints(sym.upper().strip(), days=days, limit=limit)
        total = sum(p.get("notional") or 0 for p in prints)
        if prints:
            prints[0]["isLatest"] = True  # mark most-recent print
        return JSONResponse({
            "ticker": sym.upper().strip(),
            "days": days,
            "count": len(prints),
            "totalNotional": total,
            "prints": prints,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ticker-detail failed: {e}")
