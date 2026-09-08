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

🔴 EVERY READ HERE IS GATED (`require_flow_user`, 2026-08-09). Before that,
`GET /api/flow/data` answered an anonymous caller with **3.07 MB of the firm's
options-flow tape** and `/ticker/{symbol}` served an UNCAPPED per-symbol dump —
the single largest raw-data leak in the product. `/stats`, `/version` and
`/dates` went with them: row counts and coverage dates are the dataset's size
and shape, which is competitive information even when the rows are withheld.

  * `require_flow_user` (not `require_paid`) is deliberate — it is the gate the
    flow family already uses on `/upload`, `/prune`, `/bump-version`, and on the
    normal-browsing `POST /api/live/massive/{current-quotes,enrich-oi}`. It is a
    real gate (`Bearer PUSH_SECRET` OR a validated session), and it is the ONLY
    one that survives the P5 proxy hop: post-cutover these handlers run on
    FLOW-WORKER, which has no auth.db, so web validates the cookie in
    `flow_proxy._inject_proxy_auth` and vouches by HMAC. A `require_paid` here
    would consult `get_user_plan` on a pod that cannot reach the users table.
  * The frontend is unaffected: same-origin `fetch` sends `uct_session`, and
    `OptionsFlow.jsx` is served by `AuthGuard` to paid/admin only.

⚠️ ONE RESIDUAL, AND IT IS INFRASTRUCTURE, NOT CODE. `/data` and `/indexes-data`
are deliberately `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`
so Cloudflare absorbs the herd (see the freshness contract below — removing that
re-opened a measured 25.5s TTFB / 502 class). Cloudflare keys on the URL, not the
cookie, so a body warmed by a logged-in member can still be served from the EDGE
to an anonymous caller for the length of that window. The origin is closed; the
edge is not. Fully closing it is a Cloudflare Cache Rule ("bypass cache on
cookie: uct_session", or serve these paths only to authenticated requests), which
is dashboard configuration and cannot be committed from this repo. It is written
up as an owner action in `.superpowers/sdd/audit/fix-exposed-routes-report.md`.

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
from api.flow_admin_auth import require_flow_admin, require_flow_user
from fastapi.responses import JSONResponse, Response
from api.flow_db import FlowDB, parse_columns
from api.services import flow_aggregate
from collections import OrderedDict
import json
import os
import gzip
import io
import time
import threading
import subprocess
import logging

# ~19.5k rows of [ticker, asset_type] is ~600 KB of JSON; 8 MB is generous
# headroom without being an unbounded write into a single-process pod.
_MAX_REPLICA_PUSH_BYTES = int(os.environ.get("OPTIONSFLOW_ETF_MAX_PUSH_BYTES", str(8 * 1024 * 1024)))

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
log = logging.getLogger(__name__)
db = FlowDB(DB_PATH)

flow_router = APIRouter(prefix="/api/flow", tags=["flow"])

# ── Freshness contract ──────────────────────────────────────────────────────
# The bare `/api/flow/data?days=N` URL is version-STABLE so Cloudflare can cache
# it. That means a client can be handed a body built minutes — or, through an
# over-long edge TTL, HOURS — ago. Measured on prod 2026-07-27 15:41 ET: the
# edge served a body with `Age: 21238` (5h54m) whose newest print was 9:48 AM,
# while the origin had 111,046 rows through 3:24 PM. The page rendered Friday's
# tape on a Monday afternoon and never corrected itself.
#
#   max-age=0                   the BROWSER may not reuse a body as FRESH; it
#                               revalidates, which is what stops a stale copy
#                               from being pinned in the disk cache for hours.
#   s-maxage=60                 shared caches (Cloudflare) still absorb the herd,
#                               so the ~2s origin build stays a ~60ms edge hit.
#   stale-while-revalidate=600  a cache MAY serve the slightly-stale body while
#                               it refreshes in the background.
#
# ⚠️ THAT LAST ONE IS LOAD-BEARING — do not remove it again. The original value
# was 86400, which licensed any cache to serve a DAY-OLD tape, so the first pass
# at this fix deleted it outright. That was an over-correction: it made every
# 60s edge expiry block a real user on a full origin rebuild. Measured right
# after deploy: `cf-cache-status: MISS`, **TTFB 25.5s**, and the page rendered
# "Failed to load flow data — Server returned 502". Serving stale is the
# AVAILABILITY mechanism that keeps the 12MB build off the request path, and
# removing it re-opens the 502/524 overload class.
#
# Bounded staleness is safe NOW in a way it was not before: X-Flow-Version means
# the client can SEE that it holds an old payload and correct it. The danger was
# never staleness itself — it was staleness the client could not detect. So the
# window is bounded (600s, not 86400) and made self-correcting, rather than
# traded away for a 25s cold build.
#
# `must-revalidate` is deliberately ABSENT: it forbids serving stale and would
# cancel stale-while-revalidate outright.
#
# ⚠️ A Cloudflare Cache Rule can OVERRIDE both of these (prod was rewriting the
# browser TTL to max-age=14400). That is why correctness does NOT rest on these
# headers — `X-Flow-Version` below lets the client verify what it actually got.
_FLOW_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
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

# ── Change gate (2026-07-26) ────────────────────────────────────────────────
# The time bucket alone makes the version a CLOCK, not a change signal: it
# advances every 60s whether or not a single row moved. Clients treat a new
# version as "refetch", so a quiet tape (lunch, a halted name, an ingest
# outage, and every minute outside RTH) still cost every user a full multi-MB
# CSV download per minute for byte-identical data.
#
# So the bucket is now GATED on the data actually having changed. The gate is
# deliberately cheap and deliberately conservative — a false "changed" costs
# one rebuild, a false "unchanged" serves STALE DATA, so every uncertain path
# below fails OPEN (advance).
#
# Signature is (MAX(rowid), COUNT(*)):
#   MAX(rowid) catches inserts and is essentially free — SQLite special-cases
#     it to a seek of the rowid btree's rightmost leaf. Measured on a real
#     flow.db: 0.003 ms.
#   COUNT(*) catches DELETES, which MAX(rowid) alone would miss entirely when
#     the prune job removes OLD rows (max rowid unchanged → version frozen →
#     pruned rows served forever). 0.006 ms measured.
# Both together are ~250× cheaper than the single DISTINCT scan that made the
# original db.stats() version so expensive, and they are probed at most once
# per _SIG_PROBE_SEC no matter how many requests arrive.
_SIG_PROBE_SEC = 5.0
_SIG_LOCK = threading.Lock()
_SIG_LAST = None        # last observed (max_rowid, row_count)
_SIG_VERSION = None     # version last handed out for that signature
_SIG_PROBED_AT = 0.0


def _data_signature():
    """Cheap (max_rowid, row_count) probe, or None if it cannot be taken.

    None means 'unknown' and callers MUST fail open — never freeze on it."""
    try:
        return db.data_signature()
    except Exception:
        return None


def _current_version() -> int:
    """Cache-invalidation key for the CSV responses. Effectively O(1): a coarse
    time bucket, gated on the data having actually changed.

    Prior implementation called db.stats() (3× COUNT(*) + a DISTINCT scan over
    ~835K rows ≈ 300ms) on EVERY /version poll and EVERY /data request, AND
    returned the live row count, which changes every few seconds as the WS
    worker ingests — so during market hours the in-memory cache was permanently
    stale and each of ~200 users refetched the full multi-MB CSV every 60s
    (the 2026-07-01 524 outage class; 2026-07-06 audit finding B1). Do NOT go
    back to a row-count version — that IS the outage.

    Now: within a 60s window every request sees a stable version, so the first
    rebuilds+gzips once and the rest serve from the LRU / CF edge — AND the
    version only moves to a new bucket once the underlying rows have changed,
    so identical data keeps its version (and its caches) indefinitely.

    Fails OPEN: if the signature can't be read, or hasn't been read yet, the
    raw bucket is returned. Serving a needless rebuild is cheap; serving stale
    data is not. Admin mutations call bump_data_version(), which releases the
    freeze explicitly — see there for why that is required, not optional."""
    global _SIG_LAST, _SIG_VERSION, _SIG_PROBED_AT

    bucket = int(time.time() // _VERSION_BUCKET_SEC) + _FORCE_BUMP_OFFSET * 10_000_000

    now = time.monotonic()
    with _SIG_LOCK:
        # Inside the probe window, reuse the last decision. Never extend the
        # freeze on an unprobed signature — if we have no version yet, fail open.
        if _SIG_VERSION is not None and (now - _SIG_PROBED_AT) < _SIG_PROBE_SEC:
            return _SIG_VERSION

        sig = _data_signature()
        _SIG_PROBED_AT = now

        if sig is None:                     # unknown → fail open
            _SIG_LAST, _SIG_VERSION = None, None
            return bucket

        if sig != _SIG_LAST or _SIG_VERSION is None:
            _SIG_LAST, _SIG_VERSION = sig, bucket
            return bucket

        # Unchanged data: hold the version so clients (and Cloudflare) keep
        # what they already have. Monotonic by construction — _SIG_VERSION is
        # only ever assigned a bucket, and buckets only increase.
        return _SIG_VERSION


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

      3. Releases the change-gate freeze. This is REQUIRED, not belt-and-
         braces: the whole reason this function exists is in-place updates that
         leave row count unchanged — which means they also leave the
         (MAX(rowid), COUNT(*)) signature unchanged, so the gate in
         _current_version() would hold the OLD version and silently swallow the
         bump. Clearing the signature forces the next call to re-adopt the
         current bucket.

    Returns the new version number (useful for endpoint responses)."""
    global _FORCE_BUMP_OFFSET, _SIG_LAST, _SIG_VERSION, _SIG_PROBED_AT
    _FORCE_BUMP_OFFSET += 1
    _RESPONSE_CACHE.clear()
    with _SIG_LOCK:
        _SIG_LAST, _SIG_VERSION, _SIG_PROBED_AT = None, None, 0.0
    return _current_version()


def _build_gzipped_csv(source: str, days, dates=None, max_mktcap=None) -> bytes:
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
    # A small-cap-scoped stream (max_mktcap set) is UNCAPPED: the whole point is
    # to keep every low-premium print of small names, which the market-wide
    # top-N-by-premium cap drops. Small-cap volume is a tiny slice of the tape,
    # so streaming it in full is cheap and can't OOM the browser.
    should_cap = (max_mktcap is None) and ((n_days is None) or (n_days >= cap_days))

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
        gen = db.stream_csv(source=source, dates=dates, cap_rows=cr, max_mktcap=max_mktcap)
    elif days:
        gen = db.stream_csv(source=source, days=days, cap_rows=cr, max_mktcap=max_mktcap)
    else:
        gen = db.stream_csv(source=source, cap_rows=cr, max_mktcap=max_mktcap)

    buf = io.BytesIO()
    # compresslevel=1: ~60% faster than default level 6, ~10% larger output.
    # mtime=0: deterministic gzip header — same data → byte-identical output.
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=1, mtime=0) as gz:
        for chunk in gen:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            gz.write(chunk)
    return buf.getvalue()


def _get_cached_or_build(source: str, days, dates=None, max_mktcap=None) -> tuple:
    """Returns (version, gzipped_csv_bytes) for (source, days), using the
    in-memory cache when version matches. LRU eviction at _RESPONSE_CACHE_MAX.

    ⚠️ The returned version is the one the PAYLOAD WAS BUILT FROM — never simply
    "the current version". The stale-serve branch below deliberately hands back
    an OLDER payload, and `_serve_csv` stamps `X-Flow-Version` from this value,
    so the bytes always describe themselves honestly. Stamping the current
    version onto a stale payload is precisely the defect this header exists to
    kill — do not "simplify" this back to a bare `_current_version()` read.

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
    # max_mktcap too: the uncapped small-cap payload is a different body than the
    # capped all-cap one for the same (source, days).
    key = (source, days, tuple(dates) if dates is not None else None, max_mktcap)
    cached = _RESPONSE_CACHE.get(key)
    if cached and cached[0] == version:
        _RESPONSE_CACHE.move_to_end(key)  # touch — most recently used
        return version, cached[1]

    def _store(payload):
        if key not in _RESPONSE_CACHE and len(_RESPONSE_CACHE) >= _RESPONSE_CACHE_MAX:
            _RESPONSE_CACHE.popitem(last=False)  # evict LRU
        _RESPONSE_CACHE[key] = (version, payload)
        _RESPONSE_CACHE.move_to_end(key)
        return version, payload

    if not _BUILD_LOCK.acquire(blocking=False):
        if cached:
            # Serve stale rather than queue behind the build — but report the
            # STALE payload's own version so the client can tell it is behind.
            return cached[0], cached[1]
        with _BUILD_LOCK:           # first-ever for this key: must build once
            c2 = _RESPONSE_CACHE.get(key)
            if c2 and c2[0] == _current_version():
                return c2[0], c2[1]
            return _store(_build_gzipped_csv(source, days, dates, max_mktcap))

    # ── We hold the build lock. ────────────────────────────────────────────
    # A STALE-but-usable payload exists, so REFRESH IT OFF THE REQUEST PATH and
    # answer this caller immediately. Previously whoever won this lock paid the
    # full rebuild: measured 25.5s / 10s / 4.9s TTFB on prod against a 2.7GB
    # SQLite. Cloudflare cannot mask it either — a Cache Rule is overriding the
    # edge directives, so real users were eating the build.
    #
    # This is the "serve-stale-and-revalidate-in-background" fix that was noted
    # as the right answer but was NOT SAFE to take before: handing back a stale
    # body used to be undetectable by the client, which is the whole
    # Friday's-tape-on-Monday bug. `X-Flow-Version` now stamps this payload with
    # its OWN older version, so the page sees the mismatch and refetches. That
    # is what makes trading latency for bounded, VISIBLE staleness correct here.
    #
    # The background thread owns the lock and must release it — threading.Lock
    # is not owner-bound, so that is legal. A failed rebuild leaves the previous
    # entry in place and frees the lock, so the next request simply retries.
    if cached:
        def _refresh_off_request_path():
            try:
                _store(_build_gzipped_csv(source, days, dates, max_mktcap))
            except Exception:
                pass   # keep serving the last good payload; never wedge the lock
            finally:
                _BUILD_LOCK.release()
        try:
            threading.Thread(target=_refresh_off_request_path, daemon=True,
                             name="flow-csv-refresh").start()
        except RuntimeError:
            pass       # could not spawn — fall through and build synchronously
        else:
            return cached[0], cached[1]
    try:
        return _store(_build_gzipped_csv(source, days, dates, max_mktcap))
    finally:
        _BUILD_LOCK.release()


def _serve_csv(source: str, days, request: Request, dates=None, max_mktcap=None):
    """Build (or fetch cached) gzipped CSV and return as Response with
    appropriate encoding header. Always sets Content-Length implicitly via
    Response so CF can cache. `max_mktcap` scopes to uncapped small-cap flow."""
    try:
        version, gzipped = _get_cached_or_build(source, days, dates, max_mktcap)
    except Exception as e:
        return Response(content=f"Error: {e}", status_code=500, media_type="text/plain")

    # Stamp the payload with the data version it was BUILT from, making the bytes
    # self-describing. A client can now compare this against /api/flow/version and
    # know for certain whether what it is holding is current — including when the
    # body was replayed from the browser disk cache or a stale Cloudflare object,
    # which is exactly the case the client could not previously detect. Cloudflare
    # stores response headers alongside the cached body, so a stale edge copy
    # carries its ORIGINAL (old) version and the mismatch is visible.
    headers = {**_FLOW_CACHE_HEADERS, "X-Flow-Version": str(version)}

    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        return Response(
            content=gzipped,
            media_type="text/csv",
            headers={**headers, "Content-Encoding": "gzip"},
        )
    # Rare path: client doesn't accept gzip. Decompress before sending.
    content = gzip.decompress(gzipped)
    return Response(content=content, media_type="text/csv", headers=headers)


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


def _build_gzipped_symbol_csv(symbol: str, source: str, columns=None) -> bytes:
    """Gzip the UNCAPPED flow for a single ticker (Search deep-dive). No premium
    cap — unlike the bulk /data path.

    `columns` is the caller's projection (already validated by
    `parse_columns`); None means every column, which is what every caller that
    does not ask got before this parameter existed."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=1, mtime=0) as gz:
        for chunk in db.stream_csv_symbol(symbol, source=source, columns=columns):
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            gz.write(chunk)
    return buf.getvalue()


@flow_router.get("/ticker/{symbol}")
def get_flow_ticker(symbol: str, source: str = "stocks", cols: str = "",
                    _auth: dict = Depends(require_flow_user)):
    """Uncapped flow for ONE ticker. The bulk /data endpoint keeps only the
    top-N rows by premium, which drops most of a small-cap's low-premium prints
    (ACI: 5 of 68 rows reached the browser, $1.5M of $3.84M). The Search tab
    calls this instead so a ticker's totals reflect its COMPLETE flow.

    `?cols=A,B,C` narrows the projection to those columns, in that order, with
    a header that describes them. It is OPTIONAL and defaults to every column,
    so an older caller — and an older deploy of this service answering a newer
    caller — behaves exactly as before. An UNKNOWN column is a 400, never a
    quietly narrower body: the consumers of this surface resolve fields by name,
    and a wrong question must not come back looking like a quiet tape."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return Response(content="", status_code=400, media_type="text/plain")
    src = "indexes" if source == "indexes" else "stocks"
    try:
        columns = parse_columns(cols)
    except ValueError as e:
        return Response(content=f"Error: {e}", status_code=400, media_type="text/plain")
    try:
        gzipped = _build_gzipped_symbol_csv(sym, src, columns=columns)
    except Exception as e:
        return Response(content=f"Error: {e}", status_code=500, media_type="text/plain")
    return Response(
        content=gzipped, media_type="text/csv",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-store"},
    )


# ── Search deep-dive: the DERIVED product, not the raw ticker tape ──────────
# Measured on prod for AMD: /api/flow/ticker ships 3,651 KB gz / 20,252 KB
# decoded / 4,232 ms, and the browser then runs the FULL processFlowData over it
# in the worker to render ~17 rows. Same defect class as TOP 10 before 3b.
#
# ⛔ THE BRAIN IS NOT REIMPLEMENTED. This runs the SAME flowCompute bundle the
# browser runs (`flow-facts search`), over the SAME uncapped feed, and returns
# only the two keys Search consumes.
#
# ⛔ CACHE IDENTITY = (ticker, source, version), proven from code, not assumed:
#   ticker/source  select the rows        -> in the key
#   version        new tape, new rows     -> in the key
#   range/days     NOT a parameter here — get_flow_ticker returns COMPLETE
#                  history and the page scopes it at render time
#                  (_scopeAllDirectional)  -> deliberately NOT in the key
#   erSoon         changes ONLY the `er` flag, which the client re-applies as a
#                  copy-on-overlay        -> deliberately NOT in the key, which
#                  is what makes this product user-independent and cacheable.
# `tests/test_flow_ticker_cache_dimensions.py` fails if a range dimension ever
# enters get_flow_ticker without this key changing: a fast wrong-range Search is
# a failure, not a win.
_SEARCH_PRODUCT_CACHE = OrderedDict()
_SEARCH_PRODUCT_CACHE_MAX = 48
_SEARCH_PRODUCT_LOCK = threading.Lock()
_SEARCH_PRODUCT_SCHEMA = 1


def _search_product_cache_get(key):
    with _SEARCH_PRODUCT_LOCK:
        hit = _SEARCH_PRODUCT_CACHE.get(key)
        if hit is not None:
            _SEARCH_PRODUCT_CACHE.move_to_end(key)
        return hit


def _search_product_cache_put(key, gz):
    with _SEARCH_PRODUCT_LOCK:
        _SEARCH_PRODUCT_CACHE[key] = gz
        _SEARCH_PRODUCT_CACHE.move_to_end(key)
        while len(_SEARCH_PRODUCT_CACHE) > _SEARCH_PRODUCT_CACHE_MAX:
            _SEARCH_PRODUCT_CACHE.popitem(last=False)


def search_product_cache_state() -> dict:
    """Diagnostics. Sizes are what a member actually downloads."""
    with _SEARCH_PRODUCT_LOCK:
        return {
            "entries": [{"key": list(k), "gz_bytes": len(v)} for k, v in _SEARCH_PRODUCT_CACHE.items()],
            "max": _SEARCH_PRODUCT_CACHE_MAX,
            "schema": _SEARCH_PRODUCT_SCHEMA,
        }


def _search_response(gz: bytes, version: str, cache_state: str) -> Response:
    """One place that decides the Search product response headers."""
    return Response(
        content=gz, media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "no-store",
                 "X-Flow-Version": version, "X-Flow-Product": "search",
                 "X-Flow-Cache": cache_state},
    )


# STAGE EVIDENCE MUST SURVIVE A TIMEOUT. The first cold-miss attempt died at the
# proxy's 120 s read timeout and left NO log line at all, because the only
# logging was on the success path -- so "which stage consumed it" was
# unanswerable. Stages are recorded as they BEGIN and flushed on every exit
# path, so a killed request still says where it got to.
class _Stages:
    def __init__(self, label):
        self.label = label
        self.t0 = time.monotonic()
        self.marks = []

    def mark(self, name, **extra):
        self.marks.append((name, int((time.monotonic() - self.t0) * 1000), extra))

    def render(self):
        out = []
        prev = 0
        for name, at, extra in self.marks:
            bits = "".join(" %s=%s" % (k, v) for k, v in extra.items())
            out.append("%s@%dms(+%d)%s" % (name, at, at - prev, bits))
            prev = at
        return " | ".join(out)

    def flush(self, outcome):
        log.info("[flow-search] %s %s total=%dms :: %s", self.label, outcome,
                 int((time.monotonic() - self.t0) * 1000), self.render())


# SINGLE-FLIGHT, GLOBAL, NON-BLOCKING -- the same contract flow_aggregate uses.
# Deriving one ticker's product spawns a node process over that ticker's COMPLETE
# uncapped history; two concurrent misses would run two of them on one shared
# pod, and a retrying caller could stack a third. A busy build DECLINES (503) so
# the caller falls back to the legacy path instead of queueing behind an
# expensive computation.
#
# A DISAPPEARING CALLER DOES NOT CANCEL THE BUILD. If the proxy or the browser
# gives up, the derivation still finishes and installs its cache entry: the work
# is useful warming, and request lifetime must not decide product lifecycle.
class _Lane:
    """A bounded set of build slots, with the mutex's exact call shape.

    ⛔ WHY A SEMAPHORE AND NOT A BIGGER LOCK. The single slot existed to stop
    concurrent derivations saturating a shared pod. The pod probe says memory is
    not the constraint (limit 30,517 MB, idle ~3.4 GB, worker 346 MB, zero node
    children), and every job is now bounded at 48 MB / 20 s -- so a slot can
    only ever hold a bounded amount of work. Two slots therefore cost at most
    two bounded jobs, which the measured headroom absorbs comfortably.

    ⛔ THIS DOES NOT WEAKEN "SAME TICKER -> ONE BUILD". That invariant never came
    from this lane: it is `_SEARCH_WARMING` (one warm per symbol) plus the
    cache re-check inside the slot. The lane only ever bounded how many
    DIFFERENT tickers derive at once, which is precisely what starved cheap
    tickers behind a heavy one.

    Keeps `.acquire(blocking=False)` / `.release()` / `.locked()` so all three
    existing call sites and the pod probe are unchanged.
    """

    def __init__(self, slots: int):
        self.slots = max(1, slots)
        self._sem = threading.BoundedSemaphore(self.slots)
        self._active = 0
        self._guard = threading.Lock()

    def acquire(self, blocking=False):
        got = self._sem.acquire(blocking=blocking)
        if got:
            with self._guard:
                self._active += 1
        return got

    def release(self):
        with self._guard:
            self._active -= 1
        self._sem.release()

    def locked(self) -> bool:
        """True when every slot is taken -- what the old `.locked()` meant."""
        with self._guard:
            return self._active >= self.slots

    @property
    def active(self) -> int:
        with self._guard:
            return self._active


# 2 by default: measured on prod 2026-09-08, one bounded job at a time left a
# cheap ticker waiting ~30 s behind a heavy ticker's budget. Env-overridable so
# it can be returned to 1 without a code change.
_SEARCH_LANES = int(os.environ.get("FLOW_SEARCH_LANES", "2") or 2)
_SEARCH_BUILD_LOCK = _Lane(_SEARCH_LANES)

# The materialisation budget for ONE ticker's Search product. Derived from the
# measured cost curve, not chosen: p50 ALIT 5 KB / 242 ms, p90 WPM 125 KB /
# 596 ms, p99 CRWD 3.1 MB / 863 ms. 48 MB / 20 s admits everything through p99
# with orders of magnitude to spare and excludes only the head, which cannot be
# derived inside a member's patience anyway.
_SEARCH_CSV_MAX_BYTES = int(os.environ.get("FLOW_SEARCH_CSV_MAX_MB", "48") or 48) * 1024 * 1024
_NEWLINE = bytes([10])   # written this way so no escape survives three layers of quoting
_SEARCH_CSV_DEADLINE_S = float(os.environ.get("FLOW_SEARCH_CSV_DEADLINE_S", "20") or 20)


def _build_search_product(sym: str, src: str, key: tuple, version: str, st):
    """Derive, serialise, gzip and CACHE one ticker's Search product.

    Returns `(gz_bytes, None)` on success or `(None, error_response)` on any
    failure, so the request path can return the error and the background warmer
    can simply drop it.

    ⛔ ONE IMPLEMENTATION, TWO CALLERS. This was inline in the endpoint; the
    background warmer needs exactly the same derivation, and a second copy would
    be free to drift into producing a different product for the same key -- the
    quietest possible cache-poisoning bug. The CALLER owns the build lock.
    """
    st.mark("csv_query_begin")
    try:
        # FULL COLUMN SET. processFlowData resolves columns by name, so a
        # narrowed projection could change the derivation.
        # ⛔ THIS PHASE IS BOUNDED, AND IT WAS NOT. `BUILD_TIMEOUT_S` bounds the
        # node subprocess below; NOTHING bounded the materialisation above it.
        # Measured on prod 2026-09-08 during RTH: one NVDA build held the single
        # search lane for 7.5+ MINUTES and never reached node at all, while pod
        # RSS climbed 3.4 GB -> 11.2 GB. A member searching a head ticker can
        # trigger that, and while it runs no other ticker can warm.
        #
        # ⛔ EXCEEDING THE BUDGET IS A DECLINE, NOT AN ERROR IN THE PRODUCT. The
        # member is already on the legacy tape and sees no difference; the
        # ticker enters the warm cooldown instead of holding the lane. Nothing
        # about what Options Flow computes changes -- only whether we attempt it.
        parts = []
        rows_seen = 0
        csv_len = 0
        t_csv = time.monotonic()
        overrun = None
        for chunk in db.stream_csv_symbol(sym, source=src, columns=None):
            b = chunk if isinstance(chunk, bytes) else str(chunk).encode("utf-8")
            parts.append(b)
            csv_len += len(b)
            rows_seen += b.count(_NEWLINE)
            if csv_len > _SEARCH_CSV_MAX_BYTES:
                overrun = "bytes>%d" % _SEARCH_CSV_MAX_BYTES
                break
            if (time.monotonic() - t_csv) > _SEARCH_CSV_DEADLINE_S:
                overrun = "seconds>%g" % _SEARCH_CSV_DEADLINE_S
                break
        if overrun:
            parts = None
            st.mark("csv_overrun", why=overrun, kb=csv_len // 1024, rows=rows_seen)
            st.flush("TOO_BIG")
            log.info("[flow-search] %s/%s exceeds the warm budget (%s) - declining "
                     "so the lane stays available", sym, src, overrun)
            return None, JSONResponse(
                {"ok": False, "error": "too big to derive within budget"},
                status_code=503)
        csv_bytes = b"".join(parts)
    except Exception as e:
        st.mark("csv_failed")
        st.flush("CSV_ERROR")
        log.exception("[flow-search] csv build failed for %s/%s", sym, src)
        return None, JSONResponse({"ok": False, "error": "csv: " + str(e)}, status_code=500)
    st.mark("csv_query_end", rows=rows_seen, kb=len(csv_bytes) // 1024)

    st.mark("spawn_begin")
    try:
        proc = subprocess.run(
            [flow_aggregate.node_bin(), flow_aggregate.bundle_path(), "search"],
            input=csv_bytes, capture_output=True,
            timeout=flow_aggregate.BUILD_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        st.mark("derive_timeout", limit_s=flow_aggregate.BUILD_TIMEOUT_S)
        st.flush("TIMEOUT")
        return None, JSONResponse({"ok": False, "error": "timeout"}, status_code=504)
    except Exception as e:
        st.mark("spawn_failed")
        st.flush("SPAWN_ERROR")
        log.exception("[flow-search] subprocess failed for %s/%s", sym, src)
        return None, JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    st.mark("derive_end", rc=proc.returncode, out_kb=len(proc.stdout or b"") // 1024)

    if proc.returncode != 0:
        st.flush("DERIVE_FAILED")
        log.warning("[flow-search] %s/%s exited %s: %s", sym, src, proc.returncode,
                    (proc.stderr or b"")[:300].decode("utf-8", "replace"))
        return None, JSONResponse({"ok": False, "error": "derive failed"}, status_code=502)
    try:
        derived = json.loads(proc.stdout)
    except Exception:
        st.mark("parse_failed")
        st.flush("BAD_PRODUCT")
        log.warning("[flow-search] %s/%s produced unparseable stdout", sym, src)
        return None, JSONResponse({"ok": False, "error": "bad product"}, status_code=502)
    st.mark("parsed")

    body = {
        "ok": True, "sym": sym, "source": src, "version": version,
        "schema": _SEARCH_PRODUCT_SCHEMA,
        "product": derived.get("product"),
        "rows": derived.get("rows", 0),
    }
    st.mark("serialize_begin")
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    st.mark("serialize_end", kb=len(raw) // 1024)
    gz = gzip.compress(raw, compresslevel=6)
    st.mark("gzip_end", kb=len(gz) // 1024)
    _search_product_cache_put(key, gz)
    st.mark("cache_installed")
    st.flush("BUILT")

    return gz, None


def _search_freshness(sym: str, src: str) -> str:
    """The cache identity for ONE ticker's Search product.

    ⛔ PER-SYMBOL, NOT THE GLOBAL TAPE VERSION, and that is a measured decision.
    During RTH `_current_version()` rolls EVERY 60 SECONDS (observed 2026-09-08:
    consecutive buckets, one per minute) because it moves whenever ANY symbol
    ticks. Keyed on it, a per-ticker product is thrown away once a minute no
    matter how quiet that ticker is -- which makes warming per-ticker products
    close to pointless during the exact hours members use Search.

    `symbol_freshness` is "<max_id>.<prune_generation>": exact for inserts (ids
    are monotonic and never reused) and exact for prunes (any prune bumps the
    generation). So a ticker that has not traded keeps its product indefinitely,
    and one that HAS invalidates immediately rather than up to 60 s late --
    faster AND fresher, not a trade of one for the other.

    ⛔ FAILS BACK, NEVER FAILS. If the probe cannot run we fall back to the
    global version: that is the previous behaviour, so the worst case is the
    cache we already had, never an error on the member path.
    """
    try:
        return db.symbol_freshness(sym, src)
    except Exception as e:  # noqa: BLE001
        log.warning("[flow-search] freshness probe failed for %s (%s) — "
                    "falling back to the global version", sym, e)
        return "v" + str(_current_version())


def _truthy(v) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


# Symbols with a warm-build already in flight. Without this a member typing into
# the search box would spawn a thread per keystroke-completed symbol; each would
# decline on the lock, but the churn is pointless and the set makes the intent
# explicit rather than relying on the lock to absorb it.
_SEARCH_WARMING = set()
_SEARCH_WARMING_LOCK = threading.Lock()

# How long a ticker whose warm FAILED sits out before anything tries it again.
# It exists to stop one un-buildable symbol monopolising the single build lane;
# it is not a circuit breaker for the endpoint, which stays available throughout.
_WARM_COOLDOWN_S = float(os.environ.get("FLOW_SEARCH_WARM_COOLDOWN_S", "600") or 600)
_WARM_FAILED_UNTIL = {}
_WARM_STATS = {"built": 0, "failed": 0, "declined": 0, "already": 0, "last_ms": None}


def _note_warm_failure(sym: str) -> None:
    with _SEARCH_WARMING_LOCK:
        _WARM_FAILED_UNTIL[sym] = time.monotonic() + _WARM_COOLDOWN_S


def search_warm_state() -> dict:
    """Diagnostics for the background warmer. Counters are process-local."""
    with _SEARCH_WARMING_LOCK:
        return {**_WARM_STATS, "in_flight": sorted(_SEARCH_WARMING),
                "cooling_off": sorted(_WARM_FAILED_UNTIL)}


def _spawn_search_warm(sym: str, src: str, key: tuple, version: str) -> bool:
    """Build one ticker's Search product in the background. Never raises.

    ⛔ FIRE AND FORGET, DELIBERATELY. The caller has already been answered with a
    503 and is on the legacy path; this exists only so the NEXT search for this
    ticker is a hit. It must therefore never block, never retry aggressively, and
    never let an exception escape into a thread that nothing is watching.
    """
    now = time.monotonic()
    with _SEARCH_WARMING_LOCK:
        if sym in _SEARCH_WARMING:
            return False
        # ⛔ A TICKER THAT CANNOT BE BUILT MUST NOT OWN THE LANE FOREVER.
        # Observed live: MU (465,956 rows) exceeds the 60 s derive timeout, and
        # because every search for it re-spawned a warm, one symbol held the
        # single build lane almost continuously and starved every other ticker's
        # warm — silently. A failed warm now sits out `_WARM_COOLDOWN_S`.
        until = _WARM_FAILED_UNTIL.get(sym)
        if until is not None and now < until:
            return False
        _SEARCH_WARMING.add(sym)

    def _run():
        try:
            if not _SEARCH_BUILD_LOCK.acquire(blocking=False):
                # ⛔ SAY SO. This declined SILENTLY and cost an hour of live
                # debugging: warm builds simply never happened and the logs held
                # no record of them being skipped, so "the warmer is broken" and
                # "the warmer never got the lane" were indistinguishable.
                _WARM_STATS["declined"] += 1
                log.info("[flow-search] warm %s declined — build lane busy", sym)
                return
            t0 = time.monotonic()
            try:
                if _search_product_cache_get(key) is not None:
                    _WARM_STATS["already"] += 1
                    return
                gz, err = _build_search_product(
                    sym, src, key, version, _Stages(sym + "/" + src + " warm"))
                if err is not None:
                    _note_warm_failure(sym)
                    _WARM_STATS["failed"] += 1
                else:
                    _WARM_STATS["built"] += 1
            finally:
                _SEARCH_BUILD_LOCK.release()
                _WARM_STATS["last_ms"] = int((time.monotonic() - t0) * 1000)
        except Exception as e:  # noqa: BLE001
            _note_warm_failure(sym)
            _WARM_STATS["failed"] += 1
            log.warning("[flow-search] warm build failed for %s: %s", sym, e)
        finally:
            with _SEARCH_WARMING_LOCK:
                _SEARCH_WARMING.discard(sym)

    threading.Thread(target=_run, name=f"flow-search-warm-{sym}", daemon=True).start()
    return True


@flow_router.get("/ticker-product/{symbol}")
def get_flow_ticker_product(symbol: str, source: str = "stocks",
                            warm_only: str = "",
                            _auth: dict = Depends(require_flow_user)):
    """The Search deep-dive product for ONE ticker: {all_directional, TICKER_DB}.

    Stamped with the identity the client validates before trusting it. A client
    whose ticker/source/version disagrees declines and falls back to the legacy
    raw-tape path, which stays semantically identical.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        return JSONResponse({"ok": False, "error": "no symbol"}, status_code=400)
    src = "indexes" if source == "indexes" else "stocks"
    st = _Stages(sym + "/" + src)
    st.mark("accepted")
    version = _search_freshness(sym, src)
    key = (sym, src, version)

    cached = _search_product_cache_get(key)
    st.mark("cache_lookup", hit=bool(cached))
    if cached is not None:
        st.flush("HIT")
        return _search_response(cached, version, "hit")

    if not flow_aggregate.available():
        st.flush("NO_BUNDLE")
        return JSONResponse({"ok": False, "error": "bundle unavailable"}, status_code=503)

    # ⛔ A MISS MUST NOT COST THE MEMBER ANYTHING. Measured on prod: a warm hit
    # is 178-337 ms flat, a cold AMD build is 10,787 ms, and the legacy tape the
    # client falls back to is 4,232 ms. If the client has to WAIT OUT a deadline
    # before starting that fallback, a cold search costs deadline + 4,232 ms --
    # strictly worse than never having asked. So on `warm_only` the answer to a
    # miss is an immediate 503: the client starts the tape now, and the build it
    # would have waited for runs in the background and warms the entry for every
    # later search of that ticker.
    #
    # ⛔ The background build takes the SAME non-blocking single-flight lock, so
    # it cannot stack: a thread that finds the lock held exits immediately rather
    # than queueing. Many distinct symbols searched at once therefore cost at
    # most one running derivation, not one per symbol.
    if _truthy(warm_only):
        _spawn_search_warm(sym, src, key, version)
        st.flush("MISS_WARM_ONLY")
        return JSONResponse({"ok": False, "error": "not warm"}, status_code=503)

    if not _SEARCH_BUILD_LOCK.acquire(blocking=False):
        st.flush("DECLINED_BUSY")
        return JSONResponse({"ok": False, "error": "busy"}, status_code=503)

    try:
        again = _search_product_cache_get(key)
        if again is not None:
            st.mark("cache_recheck", hit=True)
            st.flush("HIT_AFTER_WAIT")
            return _search_response(again, version, "hit")

        gz, err = _build_search_product(sym, src, key, version, st)
        if err is not None:
            return err
        return _search_response(gz, version, "miss")
    finally:
        _SEARCH_BUILD_LOCK.release()


# ---------------------------------------------------------------------------
# TEMPORARY INVESTIGATION SURFACE. Admin-gated, read-only, bounded, removable.
#
# It exists to answer a specific set of questions about Options Flow product
# preparation lifecycle -- cardinality, per-ticker history sizes, the cost of an
# exact per-ticker freshness probe, and how derivation cost scales with rows.
# It changes NO Options Flow semantics and writes nothing.
#
# DELETE IT once the lifecycle design is settled unless it earns lasting
# operational value. It is deliberately NOT a general benchmarking framework.
#
# SAFETY: this runs on the shared flow-worker pod.
#   - builds are OPT-IN (`builds=0` by default) and hard-capped;
#   - builds run SERIALLY and take the same single-flight lock member requests
#     use, so a diagnostic can never run a derivation alongside a member's;
#   - every scan is bounded and the whole call is time-budgeted.
_DIAG_MAX_BUILDS = 6
_DIAG_TIME_BUDGET_S = 90.0


def _diag_percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    i = int(round((len(sorted_vals) - 1) * q))
    return sorted_vals[max(0, min(i, len(sorted_vals) - 1))]


# ── Pod cost probe: what does ONE build actually consume? ───────────────────
# TEMPORARY, admin-gated, read-only, no dependencies. It exists to answer a
# specific question -- "how many Search derivations can this pod safely run at
# once" -- which cannot be answered from the lane counters alone.
#
# ⛔ CHOOSING A CONCURRENCY WITHOUT THIS WOULD BE A GUESS. The single-slot lane
# exists to stop concurrent node processes from saturating a shared pod with OOM
# history, so raising it is only defensible against measured headroom: peak RSS
# of one build, the node children it spawns, and what the container has spare.
# Reads /proc, which is the container's own accounting, not an estimate.
def _read_meminfo() -> dict:
    out = {}
    try:
        with open("/proc/meminfo", "r") as fh:
            for line in fh:
                k, _, v = line.partition(":")
                out[k.strip()] = int(v.strip().split()[0]) // 1024   # MB
    except Exception:  # noqa: BLE001
        pass
    return out


def _cgroup_limit_mb() -> dict:
    """The limit that actually kills the pod, v2 first then v1."""
    for path, key in (("/sys/fs/cgroup/memory.max", "v2"),
                      ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "v1")):
        try:
            raw = open(path).read().strip()
            if raw == "max":
                return {"cgroup": key, "limit_mb": None}
            return {"cgroup": key, "limit_mb": int(raw) // (1024 * 1024)}
        except Exception:  # noqa: BLE001
            continue
    return {"cgroup": None, "limit_mb": None}


def _cgroup_current_mb():
    for path in ("/sys/fs/cgroup/memory.current",
                 "/sys/fs/cgroup/memory/memory.usage_in_bytes"):
        try:
            return int(open(path).read().strip()) // (1024 * 1024)
        except Exception:  # noqa: BLE001
            continue
    return None


def _proc_table() -> list:
    """Every process in the container, with RSS and command."""
    procs = []
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open(f"/proc/{pid}/statm") as fh:
                    rss_pages = int(fh.read().split()[1])
                with open(f"/proc/{pid}/cmdline", "rb") as fh:
                    cmd = fh.read().decode("utf-8", "replace").replace(chr(0), " ").strip()
            except Exception:  # noqa: BLE001
                continue
            procs.append({"pid": int(pid), "rss_mb": rss_pages * 4 // 1024,
                          "cmd": cmd[:120]})
    except Exception:  # noqa: BLE001
        pass
    return sorted(procs, key=lambda p: -p["rss_mb"])


@flow_router.get("/_diag/pod")
def diag_pod(_auth: dict = Depends(require_flow_admin)):
    """What one build costs, and what the pod has spare. Read-only."""
    procs = _proc_table()
    node = [p for p in procs if "/node" in p["cmd"] or p["cmd"].startswith("node")]
    mem = _read_meminfo()
    lim = _cgroup_limit_mb()
    try:
        load = os.getloadavg()
    except Exception:  # noqa: BLE001
        load = None
    return JSONResponse({
        "cgroup": {**lim, "current_mb": _cgroup_current_mb()},
        "meminfo_mb": {k: mem.get(k) for k in ("MemTotal", "MemAvailable", "MemFree")},
        "loadavg": load,
        "cpu_count": os.cpu_count(),
        "node_children": node,
        "node_child_count": len(node),
        "top_procs": procs[:8],
        "search_lane": {**search_warm_state(),
                        "lock_held": _SEARCH_BUILD_LOCK.locked(),
                        "lanes": _SEARCH_BUILD_LOCK.slots,
                        "active": _SEARCH_BUILD_LOCK.active},
        "prepare": prepare_state(),
    })


@flow_router.get("/_diag/search-capacity")
def diag_search_capacity(source: str = "stocks", builds: int = 0, top: int = 12,
                         _auth: dict = Depends(require_flow_admin)):
    """Cardinality, history-size distribution, freshness-probe cost and the
    rows->derivation curve. Read-only. `builds` is opt-in and capped."""
    src = "indexes" if source == "indexes" else "stocks"
    n_builds = max(0, min(int(builds or 0), _DIAG_MAX_BUILDS))
    t_start = time.monotonic()
    out = {"source": src, "budget_s": _DIAG_TIME_BUDGET_S, "builds_requested": n_builds}

    def elapsed():
        return time.monotonic() - t_start

    # --- 1/2: cardinality + per-ticker row-count distribution ----------------
    t0 = time.monotonic()
    try:
        with db._conn() as conn:
            rows = conn.execute(
                "SELECT Symbol, COUNT(*) AS c FROM flow WHERE source=? GROUP BY Symbol",
                (src,),
            ).fetchall()
    except Exception as e:
        return JSONResponse({"ok": False, "stage": "distribution", "error": str(e)},
                            status_code=500)
    counts = sorted(int(r[1]) for r in rows)
    by_sym = sorted(((str(r[0]), int(r[1])) for r in rows), key=lambda x: -x[1])
    out["distribution_ms"] = int((time.monotonic() - t0) * 1000)
    out["cardinality"] = {"distinct_symbols": len(rows), "total_rows": sum(counts)}
    out["row_counts"] = {
        "min": counts[0] if counts else None,
        "p50": _diag_percentile(counts, 0.50),
        "p90": _diag_percentile(counts, 0.90),
        "p95": _diag_percentile(counts, 0.95),
        "p99": _diag_percentile(counts, 0.99),
        "max": counts[-1] if counts else None,
    }
    out["heaviest"] = [{"sym": s_, "rows": c} for s_, c in by_sym[: max(1, min(top, 40))]]

    # --- 3: exact per-ticker freshness probe cost, across buckets ------------
    # The candidate identity is the SAME construction the global signature uses
    # (MAX(rowid) catches inserts, COUNT(*) catches prunes) -- neither alone is
    # sound. Measured here rather than assumed cheap because MAX(rowid) filtered
    # by Symbol is NOT SQLite's rightmost-leaf special case.
    def pick(q):
        v = _diag_percentile(counts, q)
        if v is None:
            return None
        for s_, c in by_sym:
            if c <= v:
                return (s_, c)
        return by_sym[-1] if by_sym else None

    probe_targets = []
    for label, cand in (("p50", pick(0.50)), ("p90", pick(0.90)), ("p99", pick(0.99)),
                        ("max", by_sym[0] if by_sym else None)):
        if cand:
            probe_targets.append((label, cand[0], cand[1]))

    # TWO probes per bucket, measured side by side on the SAME symbol in the
    # SAME call, because the question is not "is a probe fast" but "is the
    # COUNT(*) the thing that costs" -- and only a paired measurement answers
    # that. The MAX(id) form is the candidate; MAX(rowid),COUNT(*) is the
    # incumbent that measured 1,006-1,493 ms on MU and was rejected.
    #
    # `id` is INTEGER PRIMARY KEY AUTOINCREMENT => monotonic, never reused, so
    # MAX(id) is EXACT for inserts. It is NOT exact for prunes (a delete by
    # CreatedDate can remove a mid-range id and move neither MIN nor MAX);
    # pairing it with a global prune generation counter is what would close
    # that, and that is a DESIGN question this measurement only informs.
    _PROBE_REPS = 7

    def _time_probe(sql, sym):
        timings, val, err = [], None, None
        for _ in range(_PROBE_REPS):
            t1 = time.monotonic()
            try:
                with db._conn() as conn:
                    row = conn.execute(sql, (sym, src)).fetchone()
                val = list(row) if row else None
            except Exception as e:
                err = str(e)
            timings.append(round((time.monotonic() - t1) * 1000, 2))
        srt = sorted(timings)
        return {
            "ms": timings,
            "cold_ms": timings[0],
            "p50_ms": _diag_percentile(srt, 0.50),
            "p90_ms": _diag_percentile(srt, 0.90),
            "p95_ms": _diag_percentile(srt, 0.95),
            "p99_ms": _diag_percentile(srt, 0.99),
            "max_ms": srt[-1],
            "spread_ms": round(srt[-1] - srt[0], 2),
            "value": val,
            "error": err,
        }

    SQL_MAXID = "SELECT MAX(id) FROM flow WHERE Symbol=? AND source=?"
    SQL_INCUMBENT = "SELECT MAX(rowid), COUNT(*) FROM flow WHERE Symbol=? AND source=?"

    probes = []
    for label, sym, nrows in probe_targets:
        probes.append({
            "bucket": label, "sym": sym, "rows": nrows,
            "max_id": _time_probe(SQL_MAXID, sym),
            "max_rowid_count": _time_probe(SQL_INCUMBENT, sym),
        })
    out["freshness_probe"] = probes
    out["probe_reps"] = _PROBE_REPS

    # --- 4: the query plan SQLite actually chooses ---------------------------
    try:
        with db._conn() as conn:
            plans = {}
            for nm, sql in (("max_id", SQL_MAXID), ("max_rowid_count", SQL_INCUMBENT)):
                rowsp = conn.execute("EXPLAIN QUERY PLAN " + sql, ("AAPL", src)).fetchall()
                plans[nm] = [" ".join(str(x) for x in r) for r in rowsp]
        out["probe_query_plan"] = plans
    except Exception as e:
        out["probe_query_plan"] = ["error: %s" % e]

    # --- 5: rows -> derivation curve (OPT-IN, serial, single-flight) ---------
    out["builds"] = []
    if n_builds and flow_aggregate.available():
        picks, seen = [], set()
        for q in (0.50, 0.90, 0.99):
            c = pick(q)
            if c and c[0] not in seen:
                seen.add(c[0]); picks.append(c)
        if by_sym and by_sym[0][0] not in seen:
            picks.append(by_sym[0])
        picks = picks[:n_builds]
        for sym, nrows in picks:
            if elapsed() > _DIAG_TIME_BUDGET_S:
                out["builds"].append({"sym": sym, "skipped": "time budget"})
                continue
            if not _SEARCH_BUILD_LOCK.acquire(blocking=False):
                out["builds"].append({"sym": sym, "skipped": "build lock busy"})
                continue
            try:
                b = {"sym": sym, "rows_in_db": nrows}
                t1 = time.monotonic()
                parts, nl_count = [], 0
                for chunk in db.stream_csv_symbol(sym, source=src, columns=None):
                    x = chunk if isinstance(chunk, bytes) else str(chunk).encode("utf-8")
                    parts.append(x); nl_count += x.count(b"\n")
                csv_bytes = b"".join(parts)
                b["csv_ms"] = int((time.monotonic() - t1) * 1000)
                b["csv_kb"] = len(csv_bytes) // 1024
                b["csv_rows"] = nl_count
                t2 = time.monotonic()
                try:
                    proc = subprocess.run(
                        [flow_aggregate.node_bin(), flow_aggregate.bundle_path(), "search"],
                        input=csv_bytes, capture_output=True,
                        timeout=flow_aggregate.BUILD_TIMEOUT_S)
                    b["derive_ms"] = int((time.monotonic() - t2) * 1000)
                    b["rc"] = proc.returncode
                    if proc.returncode == 0:
                        try:
                            d = json.loads(proc.stdout)
                            prod = d.get("product") or {}
                            b["out_kb"] = len(proc.stdout) // 1024
                            b["all_directional"] = len(prod.get("all_directional") or [])
                            b["ticker_db"] = len(prod.get("TICKER_DB") or [])
                            gz = gzip.compress(json.dumps(prod, separators=(",", ":")).encode("utf-8"), 6)
                            b["product_gz_kb"] = len(gz) // 1024
                        except Exception as e:
                            b["parse_error"] = str(e)
                    else:
                        b["stderr"] = (proc.stderr or b"")[:200].decode("utf-8", "replace")
                except subprocess.TimeoutExpired:
                    b["derive_ms"] = int((time.monotonic() - t2) * 1000)
                    b["timeout"] = True
                b["total_ms"] = b.get("csv_ms", 0) + b.get("derive_ms", 0)
                out["builds"].append(b)
            finally:
                _SEARCH_BUILD_LOCK.release()

    out["ok"] = True
    out["elapsed_ms"] = int(elapsed() * 1000)
    return JSONResponse(out)


@flow_router.get("/data")
# sync def (not async): the gzip+stream build is CPU/sync work; a `def`
# handler runs in the threadpool instead of blocking the single event loop.
def get_flow_data(request: Request, _auth: dict = Depends(require_flow_user)):
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


@flow_router.get("/small-data")
def get_flow_small_data(request: Request, _auth: dict = Depends(require_flow_user)):
    """Serve UNCAPPED small-cap stock flow (0 < MktCap < ceiling) as gzipped CSV.

    The bulk /data caps to the top-50k rows by premium, which drops most of a
    small-cap's low-premium prints — AXTI's ~$63M of true 20-day bull flow
    arrives as ~$22M capped, and its still-open collapses because the building
    contracts are exactly the ones cut. Small-cap volume is a tiny slice of the
    tape, so this streams in FULL. The Mid-Small cap-filter views (Leaderboard,
    Market Read, Top Flow) load THIS so a small name's totals AND still-open
    reflect its complete flow. Same ?days / ?date_from&date_to scoping as /data;
    ?maxcap=<dollars> overrides the $10B ceiling."""
    days, dates = _resolve_request("stocks", request)
    try:
        ceiling = float(request.query_params.get("maxcap") or 10_000_000_000)
    except (ValueError, TypeError):
        ceiling = 10_000_000_000.0
    return _serve_csv("stocks", days, request, dates=dates, max_mktcap=ceiling)


@flow_router.get("/indexes-data")
def get_indexes_data(request: Request, _auth: dict = Depends(require_flow_user)):
    """Serve indexes/ETF flow data as gzipped CSV (cached at CF edge).

    Same ?date_from/?date_to support as /data — see get_flow_data."""
    days, dates = _resolve_request("indexes", request)
    return _serve_csv("indexes", days, request, dates=dates)


@flow_router.get("/stats")
async def get_stats(_auth: dict = Depends(require_flow_user)):
    """Database statistics for admin display."""
    try:
        return JSONResponse(db.stats())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@flow_router.get("/version")
def get_version(_auth: dict = Depends(require_flow_user)):
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
    """Apply trade-date retention: drop WHOLE trading days past the window.

    ?retain_days=N — override FLOW_RETAIN_TRADE_DAYS for this call. 0 disables.
    ?dry_run=1     — report what WOULD go, delete nothing. Use this first.

    The legacy ?buffer_days is accepted and IGNORED (it described a contract-
    expiry buffer — the behaviour that was hollowing out historical days). It is
    deliberately not remapped onto retain_days: the nightly job passed
    buffer_days=1, which as a retention would mean "keep one day, delete the
    tape".
    """
    dry_run = request.query_params.get("dry_run", "").lower() in ("1", "true", "yes")

    retain_days = None
    raw = request.query_params.get("retain_days")
    if raw is not None:
        try:
            retain_days = max(0, min(3650, int(raw)))
        except (ValueError, TypeError):
            retain_days = None

    max_days = None
    raw_max = request.query_params.get("max_days")
    if raw_max is not None:
        try:
            max_days = max(0, min(400, int(raw_max)))
        except (ValueError, TypeError):
            max_days = None

    # dry_run=None means "use the FLOW_PRUNE_ENABLED default" (unarmed). Only an
    # explicit ?dry_run=0 arms a manual call.
    explicit = request.query_params.get("dry_run")
    res = db.prune_old_trade_days(retain_days=retain_days,
                                  dry_run=(dry_run if explicit is not None else None),
                                  max_days=max_days)
    if res["pruned"] and not dry_run:
        # Retention changed the data — invalidate the in-memory cache and move
        # the version so clients refetch instead of holding a payload whose days
        # no longer exist.
        bump_data_version()
    return JSONResponse({
        "pruned": res["pruned"],
        "days_removed": res["days_removed"],
        "days_kept": res["days_kept"],
        "backlog_days": res["backlog_days"],
        "cutoff": res["cutoff"],
        "dry_run": res["dry_run"],
        "armed": res["armed"],
        "ignored_buffer_days": request.query_params.get("buffer_days"),
    })


def build_aggregate(source: str, days: int, date_filter, version=None):
    """Build (or serve cached) the aggregate for one view. (version, gz) or None.

    ⛔ THE ONE PLACE THE CACHE KEY IS FORMED. The endpoint and the flow-worker's
    boot warmer both call this, because a warmer that computes its key even
    slightly differently from the reader populates a DIFFERENT entry and warms
    nothing — while looking, in logs and in code review, exactly like a warmer
    that works. That is the second-authority-over-one-value defect this repo
    keeps paying for, and the failure here is completely silent.
    """
    if version is None:
        version = _current_version()
    key = (source, days, date_filter)
    return flow_aggregate.get_cached_or_build(
        key, version,
        lambda: gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8"),
        date_filter,
    )


@flow_router.post("/etf-replica/install")
async def etf_replica_install(request: Request, _auth: dict = Depends(require_flow_admin)):
    """Receive one canonical ETF/INDEX snapshot from web. Internal, not member-facing.

    ⛔ THIS IS NOT THE ROUTING TABLE. It installs the Options-Flow-only replica.
    `ticker_types` — which drives massive_processor.is_index_source() and
    therefore where every live OPRA trade is stored — is untouched.

    AUTH FIRST, BEFORE THE BODY IS READ. require_flow_admin runs as a dependency,
    so an unauthenticated caller is rejected before any parsing or installing
    happens. The bearer comparison is constant-time (flow_admin_auth).

    The caller's `generation` is NOT trusted: the receiver recomputes the digest
    from the rows it actually got, so a truncated or altered body is detectable
    without trusting the sender. Response is small and operational — never the
    dataset echoed back.
    """
    from api.services import optionsflow_etf_replica as _rep
    if not _rep.receive_enabled():
        return JSONResponse({"status": "rejected", "reason": "receive disabled"},
                            status_code=503)
    # Bound the body BEFORE reading it into memory: this pod is a single process
    # that has OOM'd before, and an unbounded POST is a trivial way to hurt it.
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared and declared > _MAX_REPLICA_PUSH_BYTES:
        return JSONResponse({"status": "rejected", "reason": "body too large"},
                            status_code=413)
    raw = await request.body()
    if len(raw) > _MAX_REPLICA_PUSH_BYTES:
        return JSONResponse({"status": "rejected", "reason": "body too large"},
                            status_code=413)
    try:
        payload = json.loads(raw)
    except Exception:
        # Never log the body — it is large and this path is authenticated.
        return JSONResponse({"status": "rejected", "reason": "invalid json"},
                            status_code=400)
    out = _rep.install_pushed_snapshot(payload)
    code = 200 if out.get("status") in ("accepted", "already-current") else 400
    return JSONResponse(out, status_code=code)


@flow_router.get("/etf-replica-status")
async def etf_replica_status():
    """Is Options Flow's ETF classification replica current, and when did it last converge?

    ⛔ THIS IS NOT THE ROUTING TABLE. `ticker_types` still drives
    massive_processor.is_index_source() and is untouched by the replica; this
    reports the SEPARATE Options-Flow-only copy.

    Exists because the 55-day freeze found on 2026-09-07 (flow-worker stuck at
    the 2026-07-14 generation while web synced daily) was invisible: nothing
    reported replica age. A test can prove the stale-state logic; only telemetry
    catches the next freeze.
    """
    from api.services import optionsflow_etf_replica as _rep
    return JSONResponse(_rep.status())


# ── Prepare the first paint BEFORE a member asks for it ────────────────────
#
# THE PROBLEM THIS SOLVES, measured rather than assumed. A cold parts build for
# an uncached view costs ~3.5-7.4 s of intrinsic work (processFlowData 4,203 ms
# + node CSV parse 1,270 ms + process start and 24.8 MB of stdout ~1,915 ms).
# The client gives up at 3 s and falls back to the raw tape, so the FIRST member
# to open Options Flow after any version roll pays ~3.7 MB and a multi-second
# wait -- for a page every later member gets in ~200 ms.
#
# ⛔ THE BUILD IS NOT MADE CHEAPER, AND THE BRAIN IS NOT TOUCHED. This changes
# WHO triggers the work and WHEN: the same `get_cached_or_build_part` call a
# member request makes, with the same key, the same CSV provider and the same
# single-flight lock, run from a background thread the moment the data changes.
# Byte-for-byte the same product -- it is simply already there.
#
# ⛔ NO NEW MEMORY PEAK. This build already happens on the member path; the peak
# is whatever one `build_parts` holds, unchanged. What is new is CPU on a quiet
# pod, and that is bounded by the version cadence, not by a timer -- see below.
#
# ⛔ IT IS VERSION-TRIGGERED, WHICH MAKES IT SELF-GATING TO MARKET HOURS. The
# version only moves when the underlying rows actually change, so on a closed
# tape this thread does nothing at all (observed 2026-09-08: one version held
# for 5 h 07 m). No market-hours clock is needed, and adding one would be a
# second authority over "is the tape live".
#
# ⛔ IT YIELDS TO MEMBERS, ALWAYS. `get_cached_or_build_part` acquires the build
# lock non-blockingly and declines when it is held, so a preparer tick during a
# member's build simply does nothing and tries again next tick. The preparer can
# never queue ahead of, or compete with, a real request.
_PREPARE_POLL_S = int(os.environ.get("FLOW_PREPARE_POLL_S", "20") or 20)
_PREPARE_STATE = {"enabled": False, "prepared": 0, "declined": 0, "failed": 0,
                  "last_version": None, "last_ms": None, "last_error": None}


def prepare_state() -> dict:
    """Diagnostics for the preparer. `warm` in health() is the real verdict."""
    return dict(_PREPARE_STATE)


def _prepare_once(last_version):
    """Warm the default view for the current version. Returns the version that
    is now prepared (unchanged if this tick did not manage it).

    ⛔ A DECLINED OR FAILED TICK MUST NOT RECORD PROGRESS. Returning `version`
    on a decline would mark the roll as handled and this thread would never
    retry it -- the preparer would go quietly idle while every member paid the
    cold build, with its own counters reporting success.
    """
    version = _current_version()
    if version == last_version:
        return last_version

    source, days, date_filter = flow_aggregate.DEFAULT_VIEW
    key = (source, days, date_filter)
    t0 = time.monotonic()
    try:
        # ⛔ TWO PASSES: PUBLISH THE CRITICAL PATH, THEN FILL THE REST.
        # A single full build pipes 23.8 MB of parts back and took 23-34 s on
        # every RTH roll (measured across four consecutive rolls), while the
        # version rolls every 60 s -- so preparation kept losing the race and
        # members fell to the 8-12 MB raw tape. node's own work in that build is
        # only ~6.3 s; the rest is IPC for parts first paint never reads.
        #
        # Pass 1 emits ONLY what first paint fetches, so the page becomes fast as
        # early as possible. Pass 2 then warms everything else in the same tick,
        # so the deferred TICKER_DB/CONV fetch and the 3b raw fallback stay warm
        # too -- nothing stops being prepared, it is only ORDERED now.
        provider = lambda: gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8")
        got = flow_aggregate.get_cached_or_build_part(
            key, version, provider, date_filter, "bootstrap",
            only=flow_aggregate.FIRST_PAINT_PARTS)
    except Exception as e:  # noqa: BLE001
        _PREPARE_STATE["failed"] += 1
        _PREPARE_STATE["last_error"] = repr(e)[:200]
        log.warning("[flow-prepare] build raised: %s", e)
        return last_version

    ms = int((time.monotonic() - t0) * 1000)
    # `get_cached_or_build_part` hands back a STALE entry when the lock was held,
    # so "did we get bytes" is not the question -- "are they THIS version" is.
    if got and got[0] == version:
        _PREPARE_STATE["prepared"] += 1
        _PREPARE_STATE["last_version"] = version
        _PREPARE_STATE["last_ms"] = ms
        _PREPARE_STATE["last_error"] = None
        log.info("[flow-prepare] first paint warmed %s v=%s in %dms", key, version, ms)
        # Pass 2 -- everything else, so the deferred and fallback paths stay warm.
        # Failure here is NOT a failure of the roll: first paint is already
        # published, which is the member-visible property.
        try:
            t1 = time.monotonic()
            rest = tuple(p for p in flow_aggregate.SERVED_PART_NAMES
                         if p not in flow_aggregate.FIRST_PAINT_PARTS)
            flow_aggregate.get_cached_or_build_part(
                key, version, provider, date_filter, rest[0], only=rest)
            log.info("[flow-prepare] remainder warmed v=%s in %dms",
                     version, int((time.monotonic() - t1) * 1000))
        except Exception as e:  # noqa: BLE001
            log.warning("[flow-prepare] remainder pass failed (first paint is "
                        "already live): %s", e)
        return version

    _PREPARE_STATE["declined"] += 1
    log.info("[flow-prepare] declined (build busy) v=%s after %dms", version, ms)
    return last_version


def _prepare_loop():
    last = None
    while True:
        try:
            last = _prepare_once(last)
        except Exception as e:  # noqa: BLE001
            log.warning("[flow-prepare] tick failed: %s", e)
        time.sleep(_PREPARE_POLL_S)


def start_background_prepare() -> bool:
    """Start the first-paint preparer. Returns whether it started.

    Self-gated on FLOW_PREPARE_ENABLED so the caller cannot start it by accident,
    and on parts being enabled at all -- warming a transport nobody serves would
    burn CPU for nothing and report healthy while doing it.
    """
    if os.environ.get("FLOW_PREPARE_ENABLED", "0") != "1":
        return False
    if not flow_aggregate.parts_enabled():
        log.info("[flow-prepare] not started: parts transport is off")
        return False
    _PREPARE_STATE["enabled"] = True
    threading.Thread(target=_prepare_loop, name="flow-prepare", daemon=True).start()
    return True


@flow_router.get("/aggregate-health")
async def aggregate_health():
    """Is Options Flow's server-computed first paint actually working?

    Deliberately UNAUTHENTICATED and read-only, matching /api/flow-gap-fill/status:
    it returns booleans, byte counts and a reason string — no tape data — and a
    health check nobody can reach without a session is a health check nobody runs.

    ⛔ THE VERDICT IS `warm`, AND IT IS AN ARTIFACT READ. "Is there a usable
    aggregate for the CURRENT version, right now" is answerable from state, so
    it is true immediately after a restart with no traffic and no history. The
    tallies beside it are process-local and reset on every deploy — read them
    as colour, never as the verdict (a resetting counter is how the desk
    insights pass reported healthy through a total failure).
    """
    out = flow_aggregate.health(current_version=_current_version())
    # Colour, not verdict: `warm` above already answers "is the first paint
    # ready". These say whether the preparer is the reason it is.
    out["prepare"] = prepare_state()
    out["search_warm"] = search_warm_state()
    return JSONResponse(out)


@flow_router.get("/aggregate")
async def get_aggregate(request: Request, _auth: dict = Depends(require_flow_user)):
    """The PROCESSED dataset — the same thing the browser computes, computed once.

    Measured on prod 2026-08-29 from the page's own `[perf]` logs: every member,
    on every first load, downloads 14 MB of raw prints and then spends
    ~854 ms parsing + 1,617-3,433 ms in processFlowData to reduce 107,346 prints
    to ~26,800 trades. This endpoint does that once per data version instead.

    And it is SMALLER on the wire, which was not obvious going in — measured on
    the sample fixture: 83,643 gzipped for the aggregate against 122,093 for the
    equivalent CSV, a 0.69x ratio. The processed set drops the ~75% of raw prints
    that filtering discards, which more than pays for JSON being wordier than CSV.

    ⛔ ADDITIVE. `/data` is untouched and remains the page's path today. A 503
    here means "not built", never "no flow" — the caller falls back to the CSV
    and loses speed, never correctness.
    """
    if not flow_aggregate.available():
        # Deliberately explicit: a missing bundle or missing node is a DEPLOY
        # fact, not a data fact, and saying so stops it being diagnosed as an
        # empty tape.
        return JSONResponse(
            {"error": "aggregate unavailable", "detail": flow_aggregate.cache_state()},
            status_code=503,
        )

    source = request.query_params.get("source", "stocks")
    if source not in ("stocks", "indexes"):
        source = "stocks"
    days = _parse_query_days(request)
    # The page renders a DATE SELECTION, not the whole fetch window (it opens on
    # 'Last1'). Aggregating the window and letting the page filter is not an
    # option -- what comes back is an aggregate, not rows -- so the selection has
    # to be applied here or the prehydrated numbers describe a different set than
    # the page then shows. Unrecognised values fall back to the whole CSV rather
    # than erroring, and the allowlist is what keeps this out of argv.
    date_filter = flow_aggregate.valid_date_filter(
        request.query_params.get("date_filter"))
    version = _current_version()
    key = (source, days, date_filter)

    # ── Bootstrap parts (flag-gated, additive) ─────────────────────────────
    # `?part=bootstrap` serves only what the first screen reads; `?part=WATCH`
    # etc. serve one deferred array each. Same computation, same values — only
    # the partition differs, and the parts recombine into the identical object
    # this endpoint returns without the flag. See flowBootstrap.js for the
    # consumption audit that decided the split.
    #
    # ⛔ An unknown/absent part falls through to the WHOLE-D path rather than
    # erroring: the flag is a performance opt-in, and a member must never get a
    # 4xx because a part name drifted.
    part = request.query_params.get("part")
    if part and flow_aggregate.parts_enabled() and flow_aggregate.is_part_name(part):
        got = flow_aggregate.get_cached_or_build_part(
            key, version,
            lambda: gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8"),
            date_filter, part)
        if got:
            pv, pgz = got
            ph = {**_FLOW_CACHE_HEADERS, "X-Flow-Version": str(pv), "X-Flow-Part": part}
            if "gzip" in (request.headers.get("accept-encoding") or "").lower():
                return Response(content=pgz, media_type="application/json",
                                headers={**ph, "Content-Encoding": "gzip"})
            return Response(content=gzip.decompress(pgz),
                            media_type="application/json", headers=ph)
        # ⛔ A KNOWN PART THAT COULD NOT BE BUILT MUST NOT FALL THROUGH TO WHOLE-D.
        # This used to drop into the whole-D path, which answers a ~200 KB request
        # for one part with the ~2,900 KB (24 MB decoded) full aggregate. On a cold
        # cache that is the WORST case, not a graceful one: the single-flight lock
        # means the first part request builds while its two siblings are declined,
        # so a three-part first paint would have pulled the full aggregate TWICE.
        #
        # 503 is this endpoint's own documented contract — "a 503 here means 'not
        # built', never 'no flow'" — and it is what lets the caller choose: retry
        # the sibling parts once the build that declined it has landed, or fall
        # back to the tape. Answering with 24 MB takes that choice away.
        #
        # An UNKNOWN part name still falls through (see the guard above): that is a
        # contract drift, not a build failure, and must never cost a member an error.
        return JSONResponse(
            {"error": "part not built", "part": part},
            status_code=503,
            headers={"Cache-Control": "no-store, max-age=0"},
        )

    flow_aggregate._STATS["endpoint_requests"] += 1   # member traffic only
    built = build_aggregate(source, days, date_filter, version)
    if not built:
        return JSONResponse({"error": "aggregate build failed"}, status_code=503)

    built_version, gz = built
    # Same self-describing contract as _serve_csv: the version is the one the
    # BODY was built from, so a stale-served payload never claims to be current.
    headers = {**_FLOW_CACHE_HEADERS, "X-Flow-Version": str(built_version)}
    accept = (request.headers.get("accept-encoding") or "").lower()
    if "gzip" in accept:
        return Response(content=gz, media_type="application/json",
                        headers={**headers, "Content-Encoding": "gzip"})
    return Response(content=gzip.decompress(gz), media_type="application/json", headers=headers)


@flow_router.get("/dates")
async def get_dates(request: Request, _auth: dict = Depends(require_flow_user)):
    """Get available trading dates for a source."""
    source = request.query_params.get("source", "stocks")
    if source not in ("stocks", "indexes"):
        source = "stocks"
    dates = db.get_available_dates(source)
    return JSONResponse({"dates": dates, "count": len(dates)})
