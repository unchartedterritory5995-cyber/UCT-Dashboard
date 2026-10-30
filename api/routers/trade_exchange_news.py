"""Trade Exchange News -- web's routes (Checkpoint B: the handoff only).

  * ``POST /api/trade-exchange-news/internal/ingest`` -- the RECEIVER's door, over
    Railway's private network. NO session: the credential is the receiver's
    bearer (``TXN_INGEST_TOKEN``; web holds only its SHA-256 in
    ``TXN_INGEST_TOKEN_SHA256``), checked inline by ``_check_ingest_auth`` --
    recorded in ``auth_surface_check.ALLOWED_OPEN`` with the paired assertion in
    ``tests/test_trade_exchange_news_web.py``.
  * ``GET /api/admin/trade-exchange-news`` -- counts and times (admin). No content.

⛔ DARK: with ``TXN_ENABLED`` unset every route here returns ``Match.NONE`` from
routing itself (the TERM-086 ``DarkUnlessEnabledRoute`` idiom), so the app
answers as though the router were never mounted.

⛔ NEVER FROM THE EDGE. A request carrying Cloudflare's ``cf-ray`` came through
the public domain, which the receiver never uses; it is refused as Not Found
before the bearer is even compared.

Member surface (Checkpoint C) -- ADMIN-ONLY while dark (``require_admin``):
  * ``GET /api/trade-exchange-news/recent`` -- bounded history page (newest
    ``limit``, or the page before ``before=<seq>``), plus epoch and coverage.
  * ``POST /api/trade-exchange-news/pages`` -- one numbered page of the retained
    archive with the widget's filters applied ON THE SERVER, cut from a stable
    ``seq <= top`` snapshot (pages.py). POST only because a watchlist filter's
    symbol set can outgrow a URL; it reads, never writes.
  * ``GET /api/trade-exchange-news/stream`` -- SSE. Resumes from
    ``Last-Event-ID: <epoch>:<seq>`` (sent by the browser on its own reconnect)
    or ``?after=<seq>&epoch=<epoch>`` (a pooled manager reopening). Opens with
    ``event: hello`` saying whether the cursor was honoured (``reset`` when the
    epoch changed, ``truncated`` when history before the cursor was pruned), then
    replays every headline after the cursor in seq order, then goes live. Named
    ``heartbeat`` every 10 s so the client watchdog can tell silence from death.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from starlette.routing import Match

from api.middleware.auth_middleware import require_admin
from api.services.trade_exchange_news import config, pipeline as txn_pipeline, records
from api.services.trade_exchange_news import pages as txn_pages
from api.services.trade_exchange_news import reconcile as txn_reconcile
from api.services.trade_exchange_news.loop_lag import LAG as _loop_lag
from api.services.trade_exchange_news.records import RecordError

INGEST_PATH = "/api/trade-exchange-news/internal/ingest"
STATUS_PATH = "/api/admin/trade-exchange-news"
TIMING_PATH = "/api/trade-exchange-news/client-timing"
CLOCK_PATH = "/api/trade-exchange-news/clock"
RECENT_PATH = "/api/trade-exchange-news/recent"
STREAM_PATH = "/api/trade-exchange-news/stream"
PAGES_PATH = "/api/trade-exchange-news/pages"
MAX_PAGES_BODY = 96 * 1024
_page_slots: asyncio.Semaphore | None = None
HEARTBEAT_S = 10.0
MAX_STREAMS = int(os.environ.get("TXN_MAX_STREAMS", "200"))
MAX_STREAMS_PER_USER = int(os.environ.get("TXN_MAX_STREAMS_PER_USER", "6"))
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive",
               "X-Accel-Buffering": "no"}
#: ⚠️ Ticker extraction is the existing resolver in its HEADLINE context, not yet
#: tuned on real Trade Exchange samples. Every payload says so.
TICKERS_PROVISIONAL = True
MAX_INGEST_BYTES = 64 * 1024

NOT_FOUND = {"detail": "Not Found"}


class DarkUnlessEnabledRoute(APIRoute):
    """Does not MATCH while ``TXN_ENABLED`` is off (path first, flag on a hit)."""

    def matches(self, scope):  # noqa: D401 -- Starlette's name
        match, child = super().matches(scope)
        if match is not Match.NONE and not config.enabled():
            return Match.NONE, {}
        return match, child


router = APIRouter(route_class=DarkUnlessEnabledRoute, tags=["trade-exchange-news"])


def _check_ingest_auth(request: Request) -> bool:
    """The receiver's bearer, compared as a digest against every configured
    digest (no early exit). Fails closed when no digest is configured."""
    if request.headers.get("cf-ray"):
        return False
    hashes = config.ingest_token_hashes()
    auth = request.headers.get("authorization", "")
    if not hashes or not auth.startswith("Bearer ") or len(auth) > 256:
        return False
    digest = config.sha256_hex(auth[len("Bearer "):])
    ok = False
    for h in hashes:
        ok |= hmac.compare_digest(digest, h)
    return ok


@router.post(INGEST_PATH)
async def ingest(request: Request) -> JSONResponse:
    if not _check_ingest_auth(request):
        return JSONResponse(NOT_FOUND, status_code=404)
    t_route = time.perf_counter()        # ⏱ after the bearer check, which stays FIRST
    lag_at_entry = _loop_lag.samples[-1] if _loop_lag.samples else None
    pipe = txn_pipeline.get()
    if pipe is None:
        return JSONResponse({"detail": "not started"}, status_code=503)
    body = await request.body()
    if len(body) > MAX_INGEST_BYTES:
        return JSONResponse({"detail": "too large"}, status_code=413)
    try:
        raw = json.loads(body)
    except ValueError:
        return JSONResponse({"detail": "not JSON"}, status_code=400)
    t_body = time.perf_counter()
    try:
        out = await pipe.submit_live(raw)
    except RecordError as e:
        return JSONResponse({"detail": str(e)}, status_code=422)
    # ⏱ LATENCY AUDIT: where the receiver's wait went on web (ids and ms only).
    _timing_log.info("[txn] timing ingest id=%s status=%s body_ms=%.1f submit_ms=%.1f route_ms=%.1f "
                     "loop_lag_last_ms=%s loop_lag_1m=%s", raw.get("id") if isinstance(raw, dict) else None,
                     out["kind"], (t_body - t_route) * 1000, (time.perf_counter() - t_body) * 1000,
                     (time.perf_counter() - t_route) * 1000,
                     None if lag_at_entry is None else round(lag_at_entry, 1), _loop_lag.snapshot())
    return JSONResponse({"status": out["kind"], "seq": out["seq"]})


# ── member surface (admin-only while dark) ───────────────────────────────────

_streams: dict[str, int] = {}


def _coverage() -> dict[str, Any] | None:
    rec = txn_reconcile.get()
    return rec.coverage() if rec else None


def _parse_cursor(raw: str) -> tuple[str, int] | None:
    """``<epoch>:<seq>`` -> (epoch, seq); anything else -> None."""
    if not raw or ":" not in raw or len(raw) > 64:
        return None
    epoch, _, seq = raw.partition(":")
    return (epoch, int(seq)) if seq.isdigit() else None


def _sse(event: str, data: dict[str, Any], event_id: str | None = None) -> str:
    head = f"id: {event_id}\n" if event_id else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


@router.get(RECENT_PATH)
async def recent(limit: int = Query(200, ge=1, le=500), before: int | None = Query(None, ge=1),
                 _admin: dict = Depends(require_admin)) -> JSONResponse:
    pipe = txn_pipeline.get()
    if pipe is None:
        return JSONResponse({"reason": "not_started"}, status_code=503)
    store = pipe.store
    rows = await asyncio.to_thread(store.before if before else store.recent,
                                   *((before, limit) if before else (limit,)))
    # Built on a worker thread from the cached derivation (pages.event_fields): the
    # same fields, never re-derived per request and never on the event loop.
    items = await asyncio.to_thread(lambda: [
        txn_pipeline.headline_event(r, store.epoch, txn_pages.event_fields(r["source"], r["content"])) for r in rows])
    first, last = await asyncio.to_thread(lambda: (store.first_seq(), store.last_seq()))
    return JSONResponse({
        "epoch": store.epoch, "first_seq": first, "last_seq": last,
        "items": items,
        "coverage": _coverage(), "tickers_provisional": TICKERS_PROVISIONAL,
        "server_ms": int(time.time() * 1000),
    })


@router.post(PAGES_PATH)
async def pages(request: Request, _admin: dict = Depends(require_admin)) -> JSONResponse:
    pipe = txn_pipeline.get()
    if pipe is None:
        return JSONResponse({"reason": "not_started"}, status_code=503)
    body = await request.body()
    if len(body) > MAX_PAGES_BODY:
        return JSONResponse({"detail": "too large"}, status_code=413)
    try:
        d = json.loads(body or b"{}")
    except ValueError:
        return JSONResponse({"detail": "not JSON"}, status_code=400)
    if not isinstance(d, dict):
        return JSONResponse({"detail": "expected an object"}, status_code=422)

    def _int(k: str, default: int | None) -> int | None:
        v = d.get(k, default)
        return v if isinstance(v, int) and not isinstance(v, bool) else default

    cats, syms = d.get("categories"), d.get("symbols")
    if (cats is not None and not isinstance(cats, list)) or (syms is not None and not isinstance(syms, list)):
        return JSONResponse({"detail": "categories and symbols are lists"}, status_code=422)
    store = pipe.store
    # A snapshot from another epoch (database recreated) means nothing here: serve
    # the newest page and say so, so the widget returns to the live view.
    reset = bool(d.get("epoch")) and d.get("epoch") != store.epoch
    top = None if reset else _int("top", None)
    sym = d.get("symbol") if isinstance(d.get("symbol"), str) else None

    t_req = time.perf_counter()

    def build() -> dict[str, Any]:
        t0 = time.perf_counter()
        misses0 = txn_pages.stats["misses"]
        out = txn_pages.page(store, page_no=_int("page", 1) or 1, size=_int("size", txn_pages.DEFAULT_SIZE) or 25,
                             top=top, query=d.get("query") if isinstance(d.get("query"), str) else "",
                             categories=cats, symbol=sym, symbols=syms,
                             hide_placeholders=d.get("hide_placeholders", True) is not False)
        t1 = time.perf_counter()
        seqs = out.pop("seqs")
        out["items"] = [txn_pipeline.headline_event(r, store.epoch, txn_pages.event_fields(r["source"], r["content"]))
                        for r in store.by_seqs(seqs)]
        first = store.first_seq()
        oldest = store.by_seqs([first]) if first else []
        out.update(first_seq=first, last_seq=store.last_seq(),
                   oldest_ms=oldest[0]["received_at_ms"] if oldest else None)
        # ⏱ times and counts only: where a slow page spends its time.
        out["timing_ms"] = {"wait": round((t0 - t_req) * 1000, 1), "scan": round((t1 - t0) * 1000, 1),
                            "events": round((time.perf_counter() - t1) * 1000, 1),
                            "derived": txn_pages.stats["misses"] - misses0}
        return out

    global _page_slots
    if _page_slots is None:
        _page_slots = asyncio.Semaphore(txn_pages.CONCURRENT)
    async with _page_slots:
        out = await asyncio.to_thread(build)
    out.update(epoch=store.epoch, reset=reset, coverage=_coverage(),
               tickers_provisional=TICKERS_PROVISIONAL, server_ms=int(time.time() * 1000))
    return JSONResponse(out)


@router.get(STREAM_PATH)
async def stream(request: Request, after: int | None = Query(None, ge=0), epoch: str = "",
                 last_event_id: str = "", admin: dict = Depends(require_admin)):
    pipe = txn_pipeline.get()
    if pipe is None:
        return JSONResponse({"reason": "not_started"}, status_code=503)
    uid = str(admin.get("id"))
    if sum(_streams.values()) >= MAX_STREAMS or _streams.get(uid, 0) >= MAX_STREAMS_PER_USER:
        return JSONResponse({"reason": "at_capacity"}, status_code=503)
    store = pipe.store
    cur = _parse_cursor(request.headers.get("last-event-id", "") or last_event_id)
    client_epoch, cursor = cur if cur else (epoch, after)
    first, last = await asyncio.to_thread(lambda: (store.first_seq(), store.last_seq()))
    reset = bool(client_epoch) and client_epoch != store.epoch
    if reset or cursor is None or cursor > last:
        # No usable cursor: start at "now"; the client loads /recent for history.
        cursor = last
    truncated = bool(first) and cursor < first - 1
    _streams[uid] = _streams.get(uid, 0) + 1

    async def gen():
        agen = pipe.stream(cursor).__aiter__()
        nxt: asyncio.Future | None = None
        try:
            yield _sse("hello", {"epoch": store.epoch, "cursor": cursor, "last_seq": last,
                                 "first_seq": first, "reset": reset, "truncated": truncated,
                                 "coverage": _coverage(),
                                 "tickers_provisional": TICKERS_PROVISIONAL})
            while True:
                if await request.is_disconnected():
                    break
                if nxt is None:
                    nxt = asyncio.ensure_future(agen.__anext__())
                done, _ = await asyncio.wait({nxt}, timeout=HEARTBEAT_S)
                if not done:
                    yield _sse("heartbeat", {"coverage_complete": bool((_coverage() or {}).get("complete", True))})
                    continue
                ev, nxt = nxt.result(), None
                if ev["type"] == "headline":
                    yield _sse("headline", ev, f"{ev['epoch']}:{ev['seq']}")
                else:
                    yield _sse(ev["type"], ev)
        except StopAsyncIteration:
            pass
        finally:
            if nxt is not None and not nxt.done():
                nxt.cancel()
                try:
                    await nxt                  # let the pending read unwind before closing
                except BaseException:          # noqa: BLE001 -- CancelledError et al.
                    pass
            await agen.aclose()
            _streams[uid] = _streams.get(uid, 1) - 1
            if _streams[uid] <= 0:
                _streams.pop(uid, None)

    # ⛔ the literal stays in THIS handler: tests/api/test_sse_gzip_exempt.py finds
    # SSE routes by reading their source for it.
    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


_timing_log = logging.getLogger("api.services.trade_exchange_news.timing")


def _num(v: Any, lo: float, hi: float) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


@router.get(CLOCK_PATH)
async def clock(_admin: dict = Depends(require_admin)) -> JSONResponse:
    """⏱ LATENCY AUDIT: web's wall clock, for the admin browser's clock sync."""
    return JSONResponse({"server_ms": int(time.time() * 1000)}, headers={"Cache-Control": "no-store"})


@router.post(TIMING_PATH)
async def client_timing(request: Request, _admin: dict = Depends(require_admin)) -> JSONResponse:
    """⏱ LATENCY AUDIT: an admin browser reports publish -> SSE receipt and
    receipt -> paint for one headline. Numbers and an event id only."""
    body = await request.body()
    if len(body) > 512:
        return JSONResponse({"detail": "too large"}, status_code=413)
    try:
        d = json.loads(body)
    except ValueError:
        return JSONResponse({"detail": "not JSON"}, status_code=400)
    eid = d.get("id") if isinstance(d, dict) else None
    if not isinstance(eid, str) or not records.EVENT_ID_RE.match(eid):
        return JSONResponse({"detail": "bad id"}, status_code=422)
    _timing_log.info("[txn] timing client id=%s sse_ms=%s render_ms=%s e2e_ms=%s clock_rtt_ms=%s "
                     "clock_samples=%s", eid, _num(d.get("sse_ms"), -60000, 600000),
                     _num(d.get("render_ms"), 0, 600000), _num(d.get("e2e_ms"), -60000, 600000),
                     _num(d.get("clock_rtt_ms"), 0, 600000), _num(d.get("clock_samples"), 0, 100))
    return JSONResponse({"ok": True})


@router.get(STATUS_PATH)
def status(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    pipe = txn_pipeline.get()
    rec = txn_reconcile.get()
    return {
        "enabled": config.enabled(),
        "started": pipe is not None,
        "ready": bool(pipe and pipe.ready.is_set()),
        "ingest_token_configured": bool(config.ingest_token_hashes()),
        "dedupe_window_ms": config.dedupe_window_ms(),
        "history": {"max_age_ms": config.history_max_age_ms(), "max_items": config.history_max_items()},
        "pipeline": dict(pipe.counts) if pipe else None,
        "last_ingest_latency_ms": pipe.last_ingest_latency_ms if pipe else None,
        "subscribers": pipe.hub.subscribers if pipe else 0,
        "resyncs": pipe.hub.resyncs if pipe else 0,
        "store": pipe.store.stats() if pipe else None,
        "pages_cache": txn_pages.cache_stats(),
        "reconcile": rec.snapshot() if rec else None,
        "storage_permission_confirmed": config.storage_permitted(),
        "synthetic_only": config.synthetic_only(),
        "streams": dict(_streams),
        "loop_lag": _loop_lag.snapshot(),
    }


async def start_background() -> None:
    """Called from main.py's lifespan when the flag is on. Starts the pipeline
    and the reconciler; the boot gate opens when the first scan finishes."""
    from api.services.trade_exchange_news.journal_reader import reader_from_env
    if not config.storage_allowed():
        # ⛔ Owner rule: nothing is stored until Trade Exchange's retention and
        # redistribution permission is confirmed (TXN_STORAGE_PERMISSION_CONFIRMED=1),
        # except in a synthetic-only staging deployment (TXN_SYNTHETIC_ONLY=1).
        import logging
        logging.getLogger(__name__).warning(
            "[txn] TXN_ENABLED=1 but storage permission is unconfirmed; pipeline not started")
        return
    pipe = txn_pipeline.start()
    txn_reconcile.start(pipe, reader_from_env())
    _loop_lag.start()
    # Company-name links: built on a side thread from the on-disk name cache, never
    # on the delivery path (until it is ready, headlines simply carry no name links).
    import threading
    from api.services.ticker_resolver import prewarm_company_index
    threading.Thread(target=prewarm_company_index, name="txn-company-index", daemon=True).start()


def stop_background() -> None:
    _loop_lag.stop()
    txn_reconcile.stop()
    txn_pipeline.stop()
