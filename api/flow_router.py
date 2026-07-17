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

Performance design:
  Three-layer caching pipeline tuned for large CSV responses (90d / All can
  hit 50-70MB raw) without exceeding Cloudflare's 100s origin timeout:

  1. Stream-compress on the fly via GzipFile rather than buffering then
     compressing. Peak memory drops from ~75MB (60MB string + 15MB compressed)
     to ~15MB (compressed only) for the 90-day response.

  2. gzip level 1 instead of 4 — drops compression time ~60% in exchange for
     ~10% larger output. For CF caching, speed-to-first-byte matters more
     than absolute size; CF caches the result either way.

  3. In-memory LRU cache (8 entries) keyed by (source, days, version) — if
     CF cache misses (e.g. after a version bump) and multiple users hit at
     once, only the first request rebuilds; the rest serve from RAM.

  Buffered Response (not StreamingResponse) is mandatory because Cloudflare
  won't cache chunked responses lacking Content-Length. The streaming above
  is internal to the handler; the response itself is sent as a single buffered
  payload.
"""

from fastapi import APIRouter, Request, Depends
from api.flow_admin_auth import require_flow_admin
from fastapi.responses import JSONResponse, Response
from api.flow_db import FlowDB
from collections import OrderedDict
import os
import gzip
import io
import time
import threading

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
db = FlowDB(DB_PATH)

flow_router = APIRouter(prefix="/api/flow", tags=["flow"])

_FLOW_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    "Vary": "Accept-Encoding",
}

# ── In-memory response cache ────────────────────────────────────────────────
# Keyed by (source, days_or_None_for_all). Values: (version, gzipped_bytes).
# Bounded at 8 entries with LRU eviction. Realistic working set is ~12-14
# (2 sources × 6-7 ranges) but most users hit ≤4 ranges in practice.
# At ~15MB per large entry, 8 entries caps cache at ~120MB worst case.
_RESPONSE_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_RESPONSE_CACHE_MAX = 8
# Single-flight: bound concurrent CSV builds to 1 per process. Without this,
# every cache miss (and the version bucket rolls every 60s) launched its own
# full build; N of them GIL-thrash on the same process as the OPRA consumer and
# none finish inside the bucket, so the cache can never be populated. Mirrors
# _day_stats_lock in live_massive_router.
_BUILD_LOCK = threading.Lock()

# Manual bump offset for in-place row updates (admin endpoints that mutate
# Color, Side, source, etc. without changing total row count).
#
# Background: _current_version() returns DB row count, which works as a cache
# key for inserts/deletes (uploads, pruning) but NOT for in-place updates.
# When cluster_filter / apply_cancel_patches / rebuild_color set Color on
# existing rows, row count is unchanged, so the version stays the same, so
# _RESPONSE_CACHE happily serves the pre-update payload forever.
#
# Admin mutation endpoints call bump_data_version() after a successful update.
# That increments this counter, which shifts the version up by 10M (well above
# any realistic row count growth), guaranteeing a fresh build on next request.
# Cache is also cleared explicitly so even with the same version offset, the
# next request rebuilds.
#
# Process-local (matches the per-process in-memory cache design). If Railway
# scales to multi-worker in the future, this would need to move to a shared
# store (DB metadata table, file mtime, etc.).
_FORCE_BUMP_OFFSET = 0

# Cache-key quantum for the CSV data version (seconds). The version changes at
# most once per bucket, so continuous market-hours WS inserts no longer
# invalidate the response cache on every client poll. 60s keeps the historical
# /data CSV reasonably fresh while collapsing N concurrent users into ONE
# rebuild per bucket. (The LIVE tape is /api/live/massive/recent at 5s — this
# endpoint is the heavier day/multi-day CSV, where ≤60s staleness is invisible.)
_VERSION_BUCKET_SEC = 60


def _current_version() -> int:
    """Cache-invalidation key for the CSV responses. O(1): a coarse time bucket
    plus the manual bump offset — NO per-request DB work.

    Prior implementation called db.stats() (3× COUNT(*) + a DISTINCT scan over
    ~835K rows ≈ 300ms) on EVERY /version poll and EVERY /data request, AND
    returned the live row count, which changes every few seconds as the WS
    worker ingests — so during market hours the in-memory cache was permanently
    stale and each of ~200 users refetched the full multi-MB CSV every 60s
    (the 2026-07-01 524 outage class; 2026-07-06 audit finding B1).

    Now: a request in a given 60s window sees a stable version, so the first
    request rebuilds+gzips once and the rest serve from the LRU / CF edge.
    Admin mutations (upload/prune/in-place updates) call bump_data_version(),
    which shifts the offset and clears the cache for an immediate refresh —
    they never wait for the bucket."""
    return int(time.time() // _VERSION_BUCKET_SEC) + _FORCE_BUMP_OFFSET * 10_000_000


def bump_data_version() -> int:
    """Manually bump the data version and clear the in-memory response cache.

    Call this from any admin endpoint that mutates rows in-place without
    changing row count — e.g. apply-cancel-patches, filter-arb (cluster
    filter), rebuild-color, ticker-types/backfill, backfill-from-patches.

    Effects:
      1. Increments _FORCE_BUMP_OFFSET → _current_version() returns a new
         value → next /api/flow/version call returns the new value → client
         re-fetches /api/flow/data with the new ?v=N → cache key changes
         → fresh CSV is built.
      2. Clears _RESPONSE_CACHE → even concurrent requests with the same
         version key get a fresh build.

    Returns the new version number (useful for endpoint responses)."""
    global _FORCE_BUMP_OFFSET
    _FORCE_BUMP_OFFSET += 1
    _RESPONSE_CACHE.clear()
    return _current_version()


def _build_gzipped_csv(source: str, days, dates=None) -> bytes:
    """Stream the CSV generator through the gzip compressor, returning the
    full gzipped bytes.

    For LONG ranges (all_data, or days >= FLOW_CSV_CAP_DAYS), the payload is
    capped to the top FLOW_CSV_CAP_ROWS trades by premium. A 60-day full pull is
    ~100MB / 770k rows, which OOM-crashes the browser tab on parse. Premium is
    heavily skewed, so the top rows capture the vast majority of the dollars and
    every meaningful trade — only the tiny-premium tail (which the premium-ranked
    page barely renders) is trimmed. Short ranges (<cap) stream in full so the
    delta-merge's days=1 refresh and small-range views stay complete.

    days=None means "all data" — passed to db.stream_csv without a days arg.

    `dates` (from the DateRail calendar via db.dates_in_range) overrides `days`
    and scopes the query to exactly those CreatedDates. The cap then keys off
    how many days the range ACTUALLY covers, so a one-day pick streams that day
    whole (2026-07-17: previously the calendar sent all_data=true, which is
    unconditionally capped, so a single historical day arrived as its ~0.4%
    share of the top-50K-by-premium across all 133 days — 511 rows of 128,525
    for 7/16)."""
    cap_days = int(os.environ.get("FLOW_CSV_CAP_DAYS", "20"))
    cap_rows = int(os.environ.get("FLOW_CSV_CAP_ROWS", "50000"))
    n_days = len(dates) if dates is not None else days
    should_cap = (n_days is None) or (n_days >= cap_days)

    # 2026-07-17: pass cap_rows through so SQLite does the top-N selection in C
    # (ORDER BY CAST(Premium AS REAL) DESC LIMIT ?). This router used to collect
    # the whole range into one Python string, split it into 275K-770K strings,
    # and sort them with a per-line split(",") key — GIL-held CPU on the same
    # process that owns the OPRA consumer, and past Cloudflare's 100s limit once
    # FLOW_CSV_CAP_DAYS dropped to 5 (which moved days=5 from the fast uncapped
    # branch into the slow collect+sort branch). stream_csv has had the cap_rows
    # param since the commit whose docstring promised exactly this; it was never
    # wired up. Row content is unchanged: the capped stream is Premium-DESC
    # ordered, same as the Python sort it replaces.
    cr = cap_rows if should_cap else None
    if dates is not None:
        gen = db.stream_csv(source=source, dates=dates, cap_rows=cr)
    elif days:
        gen = db.stream_csv(source=source, days=days, cap_rows=cr)
    else:
        gen = db.stream_csv(source=source, cap_rows=cr)

    buf = io.BytesIO()
    # compresslevel=1: ~60% faster than default level 6, ~10% larger output.
    # mtime=0: deterministic gzip header — same data → byte-identical output.
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=1, mtime=0) as gz:
        for chunk in gen:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            gz.write(chunk)
    return buf.getvalue()


def _get_cached_or_build(source: str, days, dates=None) -> bytes:
    """Returns gzipped CSV bytes for (source, days), using the in-memory cache
    when version matches. LRU eviction at _RESPONSE_CACHE_MAX entries.

    Single-flight + stale-serve (2026-07-17), mirroring live_massive_router's
    /day-stats. WHY: _current_version() rolls every _VERSION_BUCKET_SEC (60s).
    With no lock, every poll/retry/reload that missed the cache started its OWN
    full build; they piled into the threadpool, all holding the GIL on the same
    process as the OPRA consumer, so each got slower as more arrived. Once a
    build exceeded 60s the cache became impossible to populate: the entry is
    stamped with the version at build START and checked against the version at
    request TIME, so every finished build was already stale on arrival ->
    permanent miss -> more concurrent builds -> slower still. Self-reinforcing;
    only a restart cleared it. That is the 2026-07-01 524 outage class, and it
    is what made /data 502 at 122s on 7/17.

    Now: ONE build at a time per process. Concurrent callers serve the previous
    payload (bounded staleness — one extra bucket) instead of queueing behind
    the compute. First-ever request for a key has nothing stale to serve, so it
    blocks on the lock and double-checks the cache on acquire."""
    version = _current_version()
    # dates makes the key: two different calendar ranges must not share an entry.
    key = (source, days, tuple(dates) if dates is not None else None)
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
            return _store(_build_gzipped_csv(source, days, dates))
    try:
        return _store(_build_gzipped_csv(source, days, dates))
    finally:
        _BUILD_LOCK.release()


def _serve_csv(source: str, days, request: Request, dates=None):
    """Build (or fetch cached) gzipped CSV and return as Response with
    appropriate encoding header. Always sets Content-Length implicitly via
    Response so CF can cache."""
    try:
        gzipped = _get_cached_or_build(source, days, dates)
    except Exception as e:
        return Response(content=f"Error: {e}", status_code=500, media_type="text/plain")

    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        return Response(
            content=gzipped,
            media_type="text/csv",
            headers={**_FLOW_CACHE_HEADERS, "Content-Encoding": "gzip"},
        )
    # Rare path: client doesn't accept gzip. Decompress before sending.
    content = gzip.decompress(gzipped)
    return Response(content=content, media_type="text/csv", headers=_FLOW_CACHE_HEADERS)


def _parse_query_days(request: Request):
    """Returns days int (1-365) or None for all_data=true."""
    try:
        all_data = request.query_params.get("all_data", "false").lower() == "true"
        if all_data:
            return None
        days_str = request.query_params.get("days", "1")
        days = int(days_str)
        if days < 1:
            days = 1
        if days > 365:
            days = 365
        return days
    except (ValueError, TypeError):
        return 1


def _parse_query_range(request: Request):
    """(date_from, date_to) as ISO YYYY-MM-DD from the DateRail calendar, or None.

    Both must be present — a half-open range is treated as no range so the
    caller falls back to the days-back path rather than guessing an endpoint.
    """
    f = (request.query_params.get("date_from") or "").strip()
    t = (request.query_params.get("date_to") or "").strip()
    return (f, t) if f and t else None


def _resolve_request(source: str, request: Request):
    """(days, dates) for a /data request. `dates` is non-None only for an
    explicit calendar range, in which case `days` is ignored downstream."""
    rng = _parse_query_range(request)
    if rng:
        return None, db.dates_in_range(source, rng[0], rng[1])
    return _parse_query_days(request), None


@flow_router.post("/upload")
async def upload_flow(request: Request, _auth: dict = Depends(require_flow_admin)):
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

        # Upload changed the data — invalidate our in-memory cache so the next
        # request rebuilds against the new version (CF cache also invalidates
        # via the /version bump on the client side).
        _RESPONSE_CACHE.clear()

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


def _build_gzipped_symbol_csv(symbol: str, source: str) -> bytes:
    """Gzip the UNCAPPED flow for a single ticker (Search deep-dive). One symbol
    is a tiny result set, so no premium cap — unlike the bulk /data path."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=1, mtime=0) as gz:
        for chunk in db.stream_csv_symbol(symbol, source=source):
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            gz.write(chunk)
    return buf.getvalue()


@flow_router.get("/ticker/{symbol}")
def get_flow_ticker(symbol: str, source: str = "stocks"):
    """Uncapped flow for ONE ticker. The bulk /data endpoint keeps only the
    top-N rows by premium, which drops most of a small-cap's low-premium prints
    (ACI: 5 of 68 rows reached the browser, $1.5M of $3.84M). The Search tab
    calls this instead so a ticker's totals reflect its COMPLETE flow. Tiny
    payload (tens of rows), so no cap and no CF cache."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return Response(content="", status_code=400, media_type="text/plain")
    src = "indexes" if source == "indexes" else "stocks"
    try:
        gzipped = _build_gzipped_symbol_csv(sym, src)
    except Exception as e:
        return Response(content=f"Error: {e}", status_code=500, media_type="text/plain")
    return Response(
        content=gzipped, media_type="text/csv",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-store"},
    )


@flow_router.get("/data")
# sync def (not async): the gzip+stream build is CPU/sync work; a `def`
# handler runs in the threadpool instead of blocking the single event loop.
def get_flow_data(request: Request):
    """
    Serve stock flow data as gzipped CSV (cached at CF edge).
    ?days=N (default 1) — last N trading days.
    ?all_data=true — all available data (heavy; opt-in only)
    ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — explicit calendar range. Scoped
      server-side to exactly those trading days, and the premium cap keys off
      how many days the range covers, so a single-day pick streams that day
      whole instead of arriving as a slice of an all_data cap.
    """
    days, dates = _resolve_request("stocks", request)
    return _serve_csv("stocks", days, request, dates=dates)


@flow_router.get("/indexes-data")
def get_indexes_data(request: Request):
    """Serve indexes/ETF flow data as gzipped CSV (cached at CF edge).

    Same ?date_from/?date_to support as /data — see get_flow_data."""
    days, dates = _resolve_request("indexes", request)
    return _serve_csv("indexes", days, request, dates=dates)


@flow_router.get("/stats")
async def get_stats():
    """Database statistics for admin display."""
    try:
        return JSONResponse(db.stats())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@flow_router.get("/version")
def get_version():
    """Cache-busting version key. Returns DB row count, which changes whenever
    rows are inserted (uploads) or removed (prune). Clients append this as
    &v=<version> to /data and /indexes-data requests so CF treats each version
    as a separate cache entry — old cached responses naturally fall out of use
    when new data arrives.

    This endpoint itself is never cached (Cache-Control: no-store) so version
    bumps are seen immediately."""
    try:
        version = _current_version()
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


@flow_router.post("/bump-version")
async def bump_version_endpoint(_auth: dict = Depends(require_flow_admin)):
    """Manually bump the data version and clear in-memory response cache.

    Useful when:
      - You ran an admin mutation that didn't bump automatically
      - You suspect stale cache and want to force-refresh all clients
      - Testing / debugging cache behavior

    The next /version call will return the new value, causing clients to
    re-fetch /data with a new ?v=N (which bypasses both browser and CF
    edge cache).

    Safe to call repeatedly — idempotent-ish (just bumps the counter)."""
    try:
        new_version = bump_data_version()
        return JSONResponse(
            {"ok": True, "new_version": new_version},
            headers={"Cache-Control": "no-store, max-age=0"},
        )
    except Exception as e:
        return JSONResponse(
            {"ok": False, "error": str(e)},
            status_code=500,
            headers={"Cache-Control": "no-store, max-age=0"},
        )


@flow_router.post("/prune")
async def prune_expired(request: Request, _auth: dict = Depends(require_flow_admin)):
    """Manually prune expired contracts."""
    try:
        buffer_str = request.query_params.get("buffer_days", "7")
        buffer_days = max(0, min(90, int(buffer_str)))
    except (ValueError, TypeError):
        buffer_days = 7
    pruned = db.prune_expired(buffer_days=buffer_days)
    # Prune changed the data — invalidate the in-memory cache
    _RESPONSE_CACHE.clear()
    return JSONResponse({"pruned": pruned})


@flow_router.get("/dates")
async def get_dates(request: Request):
    """Get available trading dates for a source."""
    source = request.query_params.get("source", "stocks")
    if source not in ("stocks", "indexes"):
        source = "stocks"
    dates = db.get_available_dates(source)
    return JSONResponse({"dates": dates, "count": len(dates)})
