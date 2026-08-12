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

🔴 EVERY READ HERE IS GATED (`require_flow_user`, 2026-08-09). Before that,
`GET /api/darkpool/aggregated` answered an anonymous caller with **710 KB of the
firm's aggregated off-exchange print dataset**, and `/data` served the raw CSV.
`/dates`, `/version`, `/stats` and the two `*-ingest/status` siblings went with
the payload routes where they describe the dataset (row counts, coverage dates)
rather than the pod.

The comment banners below still read "Public:" in a few places — they described
the ACCIDENT, not a ruling. They now say "Member:".

⚠️ Same Cloudflare residual as `flow_router.py`: `/data` and `/aggregated` are
`Cache-Control: public, max-age=300, stale-while-revalidate=86400`, and CF keys
on the URL, not the cookie — so the ORIGIN is closed but a warmed edge body can
still reach an anonymous caller inside that window. Closing it fully is a
Cloudflare Cache Rule, not a code change. Written up as an owner action in
`.superpowers/sdd/audit/fix-exposed-routes-report.md`.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Request, Depends
from api.flow_admin_auth import require_flow_admin, require_flow_user
from fastapi.responses import JSONResponse, Response
from fastapi.concurrency import run_in_threadpool
from collections import OrderedDict
from api.darkpool_db import (
    insert_csv_rows, stream_csv, get_available_dates,
    get_stats, prune_old_data, clear_all, get_ticker_prints
)
from api.darkpool_aggregator import (
    get_aggregated as get_aggregated_payload,
    prebuild_all_windows_background,
    invalidate_cache as invalidate_agg_cache,
    is_window_warm,
    build_window_background,
)
import gzip
import io
import json
import threading

router = APIRouter(prefix="/api/darkpool", tags=["darkpool"])

_DARKPOOL_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}
# The "computing" stub must NEVER be cached (by CF or the browser) — otherwise a
# cold-cache poll response would be served in place of the real data once warm.
_DARKPOOL_NO_CACHE_HEADERS = {"Cache-Control": "no-store, max-age=0"}

# ── In-memory response cache ────────────────────────────────────────────────
# Keyed by (days,)  where days=None means "all". Values: (version, gzipped_bytes).
# Bounded at 8 entries with LRU eviction. Working set is small (~6 windows:
# 1d/5d/20d/60d/90d/all). At ~30MB per large entry, 8 entries caps RAM at
# ~240MB worst case — fits comfortably in a Railway dyno.
_RESPONSE_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_RESPONSE_CACHE_MAX = 8
# Single-flight: bound concurrent CSV builds to 1 per process. Without this the
# docstring's promise ("only the first request rebuilds; the rest serve from
# RAM") is false — every cache MISS builds independently. Unlike flow_router,
# the version key here is total_rows (not a 60s time bucket), so a populated
# entry stays valid until the next upload/prune; the herd window is therefore
# narrow but SHARP — right after an upload clears the cache, concurrent hits on
# a 60-90d window each allocate a full multi-hundred-MB build at once (this
# module's own header records that OOM-killing the Railway worker). Mirrors
# flow_router._BUILD_LOCK and live_massive_router._day_stats_lock.
_BUILD_LOCK = threading.Lock()


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
    version matches. LRU eviction at _RESPONSE_CACHE_MAX entries.

    Single-flight + stale-serve (2026-07-18): only ONE build runs at a time per
    process. Concurrent callers serve the previous payload if one exists rather
    than launching their own build; the first-ever caller for a key (nothing
    stale to serve) blocks on the lock and re-checks the cache on acquire."""
    version = _current_version()
    key = (days,)
    cached = _RESPONSE_CACHE.get(key)
    if cached and cached[0] == version:
        _RESPONSE_CACHE.move_to_end(key)  # touch — most recently used
        return cached[1]

    def _store(payload):
        if key not in _RESPONSE_CACHE and len(_RESPONSE_CACHE) >= _RESPONSE_CACHE_MAX:
            _RESPONSE_CACHE.popitem(last=False)  # evict LRU
        _RESPONSE_CACHE[key] = (version, payload)
        _RESPONSE_CACHE.move_to_end(key)
        return payload

    if not _BUILD_LOCK.acquire(blocking=False):
        if cached:
            return cached[1]        # serve stale rather than queue behind the build
        with _BUILD_LOCK:           # first-ever for this key: must build once
            c2 = _RESPONSE_CACHE.get(key)
            if c2 and c2[0] == _current_version():
                return c2[1]
            return _store(_build_gzipped_csv(days))
    try:
        return _store(_build_gzipped_csv(days))
    finally:
        _BUILD_LOCK.release()


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


# ── Member: Retrieve dark pool data as CSV ────────────────────────────────────
@router.get("/data")
async def get_darkpool_data(
    request: Request,
    _auth: dict = Depends(require_flow_user),
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


# ── Member: Aggregated JSON (new primary endpoint) ────────────────────────────
@router.get("/aggregated")
async def get_darkpool_aggregated(
    days: int = Query(default=1, ge=0, description="Trading days (0 = all)"),
    all_data: bool = Query(default=False),
    _auth: dict = Depends(require_flow_user),
):
    """Return aggregated dark pool data as JSON.

    Output matches the dpData shape that DarkPool.jsx parseCSVtoD used to
    produce client-side, so the UI components consume it directly without
    further processing.

    File-cached on /data volume. Cache key includes a DB signature so any
    upload (or prune) automatically invalidates.

    NON-BLOCKING (2026-08-09): a WARM window is served immediately (the cache
    read runs off the event loop). A COLD window is NOT built inline — the 90d
    build takes >100s, which Cloudflare kills with a 524 (the "stuck on Building
    aggregation" bug) and, run inline in this async handler, would pin the single
    event loop for the whole site. Instead we kick a background build and return a
    small {"status":"computing"} stub; the client polls until the window is warm.
    """
    try:
        _all = bool(all_data or days == 0)
        _days = None if _all else min(days, 365)
        if is_window_warm(days=_days, all_data=_all):
            # Cache hit — read + serialize off the loop (belt-and-suspenders; the
            # read is fast, but a rare race to cold must never block the loop).
            payload = await run_in_threadpool(
                get_aggregated_payload, **({"all_data": True} if _all else {"days": _days}))
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            return Response(
                content=body,
                media_type="application/json",
                headers=_DARKPOOL_CACHE_HEADERS,
            )
        # Cold — build in the background (immune to the 100s request limit) and
        # tell the client to poll. Idempotent: the per-window single-flight lock
        # coalesces concurrent cold callers onto ONE build.
        build_window_background(days=_days, all_data=_all)
        return JSONResponse(
            {"status": "computing", "days": (0 if _all else _days), "all_data": _all},
            headers=_DARKPOOL_NO_CACHE_HEADERS,
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


# ── Admin: Dark Pool EOD / EOW summary card (preview + manual post) ───────────
@router.get("/eod-summary")
async def darkpool_eod_summary(
    post: int = Query(default=0, description="0 = preview the PNG, 1 = post to Discord"),
    weekly: int = Query(default=0, description="0 = EOD (last session), 1 = EOW (week)"),
    _auth: dict = Depends(require_flow_admin),
):
    """Build the by-market-cap Dark Pool summary card. `post=0` returns the PNG
    inline for preview (open in a browser while signed in); `post=1` posts it to
    the options-EOD Discord channel. Runs the build off the event loop (it does
    per-ticker bars/print reads + an async mkt-cap fetch)."""
    from api import darkpool_eod
    res = await run_in_threadpool(
        darkpool_eod.run_eod_summary, force=True, post=bool(post), weekly=bool(weekly))
    if not post and res.get("png"):
        return Response(content=res["png"], media_type="image/png",
                        headers=_DARKPOOL_NO_CACHE_HEADERS)
    res.pop("png", None)
    return JSONResponse(res)


# ── Dark Pool records — per-ticker biggest-ever prints + new-record alerts ────
@router.get("/records")
async def darkpool_records_list(
    limit: int = Query(default=300, ge=1, le=6000),
    sort: str = Query(default="notional", description="notional | date | ticker"),
    enrich: bool = Query(default=False, description="attach mktcap for cap banding"),
    _auth: dict = Depends(require_flow_user),
):
    """Per-ticker biggest-ever dark-pool prints (for the Records panel)."""
    from api import darkpool_records as dr
    records = await run_in_threadpool(dr.get_records, limit, sort, enrich)
    return JSONResponse({"records": records, "count": len(records)},
                        headers=_DARKPOOL_NO_CACHE_HEADERS)


@router.post("/records/seed")
async def darkpool_records_seed(_auth: dict = Depends(require_flow_admin)):
    """Populate the records table from the retained trades history (idempotent,
    no alerts). Also runs automatically on the first enabled ingest."""
    from api import darkpool_records as dr
    n = await run_in_threadpool(dr.seed_from_trades)
    return JSONResponse({"seeded_or_updated": n})


@router.post("/records/refresh")
async def darkpool_records_refresh(
    source: str = Query(default="trades", description="trades | today"),
    _auth: dict = Depends(require_flow_admin),
):
    """Manually run a record refresh (respects DARKPOOL_RECORDS_ENABLED) — for
    ops/testing; normally the ingest paths drive this."""
    from api import darkpool_records as dr
    fn = dr.refresh_from_today if source == "today" else dr.refresh_from_trades
    res = await run_in_threadpool(fn)
    return JSONResponse(res)


@router.get("/records/card")
async def darkpool_records_card(
    post: int = Query(default=0, description="0 = preview the PNG, 1 = post to Discord"),
    top_n: int = Query(default=25, ge=1, le=40),
    _auth: dict = Depends(require_flow_admin),
):
    """Dark Pool Records leaderboard card (all-time biggest prints). Preview the
    PNG (post=0) or post it to the Discord channel (post=1)."""
    from api import darkpool_records as dr
    res = await run_in_threadpool(dr.run_records_card, post=bool(post), top_n=top_n)
    if not post and res.get("png"):
        return Response(content=res["png"], media_type="image/png",
                        headers=_DARKPOOL_NO_CACHE_HEADERS)
    res.pop("png", None)
    return JSONResponse(res)


# ── Member: Get available trading dates ───────────────────────────────────────
@router.get("/dates")
async def get_dates(_auth: dict = Depends(require_flow_user)):
    """Return list of available trading dates for the date picker."""
    try:
        dates = get_available_dates()
        return JSONResponse({"dates": dates, "count": len(dates)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Member: Cache-busting version key ────────────────────────────────────────
@router.get("/version")
async def get_version(_auth: dict = Depends(require_flow_user)):
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
# ── Admin: Massive ingest (manual trigger / backfill) ─────────────────────────
@router.post("/massive-ingest")
async def massive_ingest(
    date: str = Query(None, description="M/D/YYYY — defaults to today ET"),
    tickers: str = Query(None, description="Optional comma-separated override, e.g. SPY,QQQ"),
    top_n: int = Query(None, ge=1, le=1000, description="Universe size (default env DARKPOOL_TOP_N_TICKERS)"),
    dry_run: bool = Query(False, description="Fetch + report, do not write to the DB"),
    _auth: dict = Depends(require_flow_admin),
):
    """Run the Massive dark-pool ingest on demand.

    Same code path as the nightly 19:20 ET job, but callable for backfilling a
    specific date or proving the pipeline before arming the scheduler. Ignores
    DARKPOOL_MASSIVE_INGEST_ENABLED (that gate only governs the cron job) so a
    manual run always works.

    Re-running a date is safe: darkpool_db dedups on
    (date, timestamp, ticker, price, notional, message).

    NOTE this is a long call — the tape is filtered client-side, so a 150-ticker
    run pulls millions of prints. Use dry_run=true or a small `tickers` list to
    sanity-check first.
    """
    try:
        from api.darkpool_massive_ingest import run_ingest_background, TOP_N_TICKERS
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingest module unavailable: {e}")
    tk_list = [t.strip().upper() for t in tickers.split(",") if t.strip()] if tickers else None
    # Fire-and-forget: a real ingest runs for minutes and Cloudflare kills the
    # origin connection at ~100s (observed 7/24: 524 + an HTML error page that
    # broke JSON parsing client-side). Start it in a thread and poll instead.
    result = run_ingest_background(
        date_mdyyyy=date,
        tickers=tk_list,
        top_n=top_n or TOP_N_TICKERS,
        dry_run=dry_run,
    )
    return JSONResponse(result)


@router.get("/massive-ingest/status")
async def massive_ingest_status():
    """Progress + last result of the Massive dark-pool ingest.

    `phase` shows the ticker currently being pulled (e.g. "QQQ (2/3)").
    When `running` flips to false, `last_result` holds the summary — the same
    dict the nightly job logs.
    """
    try:
        from api.darkpool_massive_ingest import get_run_state
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ingest module unavailable: {e}")
    return JSONResponse(get_run_state())


# ── Admin: ALL-SYMBOLS dark-pool ingest from the daily stocks flat file ────────
@router.post("/flatfile-ingest")
async def flatfile_ingest(
    date: str = Query(None, description="M/D/YYYY — defaults to the prior trading day (flat files are T+1)"),
    dry_run: bool = Query(False, description="Scan + report, do not write to the DB"),
    _auth: dict = Depends(require_flow_admin),
):
    """Scan the WHOLE day's US-stocks flat file and ingest EVERY ticker's
    off-exchange (dark) prints >= $4M — no universe. This is the all-symbols
    authoritative pass; the per-ticker /massive-ingest stays for real-time.

    Long call (~5-15 min, streams ~3.5GB) — fire-and-forget; poll
    /flatfile-ingest/status. Ignores DARKPOOL_FLATFILE_ENABLED (that gate only
    governs the scheduled job) so a manual run always works. Safe to re-run
    (darkpool_db dedups on date+timestamp+ticker+price+notional+message)."""
    try:
        from api.darkpool_flatfile_ingest import run_flatfile_ingest_background
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"flatfile module unavailable: {e}")
    return JSONResponse(run_flatfile_ingest_background(date_mdyyyy=date, dry_run=dry_run))


@router.get("/flatfile-ingest/status")
async def flatfile_ingest_status():
    """Progress + last result of the all-symbols flat-file ingest. `phase` shows
    scan progress (e.g. "40M scanned, 3120 kept")."""
    try:
        from api.darkpool_flatfile_ingest import get_run_state
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"flatfile module unavailable: {e}")
    return JSONResponse(get_run_state())


# ── Member: Today's live intraday preview ─────────────────────────────────────
@router.get("/today")
async def get_darkpool_today(_auth: dict = Depends(require_flow_user)):
    """Aggregated view of TODAY's live off-exchange prints (the darkpool_today
    preview table), refreshed by the intraday poller every few minutes.

    Separate from /aggregated (which serves completed sessions from
    darkpool_trades): this reads the ephemeral preview table and is empty
    pre-open / when the intraday poller is disabled. The `stats` block carries
    the freshness line the live strip renders (row/ticker counts + last print
    timestamp).
    """
    try:
        from api.darkpool_aggregator import get_today_aggregated
        from api.darkpool_db import get_today_stats
        payload = await run_in_threadpool(get_today_aggregated)
        stats = await run_in_threadpool(get_today_stats)
        body = json.dumps(
            {"payload": payload, "stats": stats}, separators=(",", ":")
        ).encode("utf-8")
        # Short cache only — this is live data. Never CF-cache aggressively.
        return Response(
            content=body,
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=30", "Vary": "Accept-Encoding"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/intraday-ingest/status")
async def intraday_ingest_status():
    """Progress + last result of the intraday dark-pool poller (mirrors
    /massive-ingest/status). `phase` shows the ticker currently being pulled;
    `last_result` holds the last cycle's summary."""
    try:
        from api.darkpool_intraday_ingest import get_run_state
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"intraday module unavailable: {e}")
    return JSONResponse(get_run_state())


@router.get("/stats")
async def darkpool_stats(_auth: dict = Depends(require_flow_user)):
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


# ── Member: Ticker drill-down (print history for one ticker) ─────────────────
@router.get("/ticker-detail")
async def get_ticker_detail(
    sym: str = Query(..., description="Ticker symbol", min_length=1, max_length=10),
    _auth: dict = Depends(require_flow_user),
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
