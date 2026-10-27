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

Member-facing stream and history routes are Checkpoint C.
"""
from __future__ import annotations

import hmac
import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.routing import Match

from api.middleware.auth_middleware import require_admin
from api.services.trade_exchange_news import config, pipeline as txn_pipeline
from api.services.trade_exchange_news import reconcile as txn_reconcile
from api.services.trade_exchange_news.records import RecordError

INGEST_PATH = "/api/trade-exchange-news/internal/ingest"
STATUS_PATH = "/api/admin/trade-exchange-news"
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
    }


async def start_background() -> None:
    """Called from main.py's lifespan when the flag is on. Starts the pipeline
    and the reconciler; the boot gate opens when the first scan finishes."""
    from api.services.trade_exchange_news.journal_reader import reader_from_env
    pipe = txn_pipeline.start()
    txn_reconcile.start(pipe, reader_from_env())


def stop_background() -> None:
    txn_reconcile.stop()
    txn_pipeline.stop()
