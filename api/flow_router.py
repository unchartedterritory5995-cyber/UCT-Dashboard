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
import os
import gzip
import io
import time
import threading

DB_PATH = os.environ.get("FLOW_DB_PATH", "/data/flow.db")
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

    built = flow_aggregate.get_cached_or_build(
        key, version,
        lambda: gzip.decompress(_get_cached_or_build(source, days)[1]).decode("utf-8"),
        date_filter,
    )
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
