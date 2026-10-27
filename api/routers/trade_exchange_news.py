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
import os
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from starlette.routing import Match

from api.middleware.auth_middleware import require_admin
from api.services.trade_exchange_news import config, pipeline as txn_pipeline
from api.services.trade_exchange_news import reconcile as txn_reconcile
from api.services.trade_exchange_news.records import RecordError

INGEST_PATH = "/api/trade-exchange-news/internal/ingest"
STATUS_PATH = "/api/admin/trade-exchange-news"
RECENT_PATH = "/api/trade-exchange-news/recent"
STREAM_PATH = "/api/trade-exchange-news/stream"
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
    try:
        out = await pipe.submit_live(raw)
    except RecordError as e:
        return JSONResponse({"detail": str(e)}, status_code=422)
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
    first, last = await asyncio.to_thread(lambda: (store.first_seq(), store.last_seq()))
    return JSONResponse({
        "epoch": store.epoch, "first_seq": first, "last_seq": last,
        "items": [txn_pipeline.headline_event(r, store.epoch) for r in rows],
        "coverage": _coverage(), "tickers_provisional": TICKERS_PROVISIONAL,
    })


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
        "reconcile": rec.snapshot() if rec else None,
        "storage_permission_confirmed": config.storage_permitted(),
        "streams": dict(_streams),
    }


async def start_background() -> None:
    """Called from main.py's lifespan when the flag is on. Starts the pipeline
    and the reconciler; the boot gate opens when the first scan finishes."""
    from api.services.trade_exchange_news.journal_reader import reader_from_env
    if not config.storage_permitted():
        # ⛔ Owner rule: nothing is stored until Trade Exchange's retention and
        # redistribution permission is confirmed (TXN_STORAGE_PERMISSION_CONFIRMED=1).
        import logging
        logging.getLogger(__name__).warning(
            "[txn] TXN_ENABLED=1 but storage permission is unconfirmed; pipeline not started")
        return
    pipe = txn_pipeline.start()
    txn_reconcile.start(pipe, reader_from_env())


def stop_background() -> None:
    txn_reconcile.stop()
    txn_pipeline.stop()
