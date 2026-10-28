"""trade-exchange-news-receiver -- the one door Trade Exchange's webhook knocks on.

    POST /hook/{token}   the webhook. Answers 2xx only once the record is durable.
    GET  /health         readiness for Railway (200 ready / 503 not), no data.

⭐ THE ORDER OF A DELIVERY, and why each step sits where it does:
    verify path secret      -- before anything is read; unknown = a plain 404
    rate (token bucket)     -- before the body, so a flood costs us nothing
    read body (capped)      -- declared length over the cap is refused unread
    parse (strict on documented fields only)
    START the push to web   -- the live path; does not wait on storage
    journal PUT (durable)   -- the ack waits on THIS, never on the push
    answer 2xx              -- or 503 + Retry-After when the PUT failed

⛔ THE FULL URL IS A CREDENTIAL. The path secret never reaches a log line
(access log off, plus ``txn_redaction.PathSecretFilter`` on every handler as a
backstop) or Sentry (``txn_redaction.scrub_event``). The env holds only its hash.

⛔ DARK: with ``TXN_RECEIVER_ENABLED`` unset the hook answers 404 for every
token, exactly as if it did not exist.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

import txn_receiver as rx
from txn_forwarder import Forwarder
from txn_journal import Journal, JournalError, journal_from_env
from txn_redaction import install_log_redaction

logger = logging.getLogger("txn.receiver")

NOT_FOUND = {"detail": "Not Found"}
SUMMARY_EVERY_S = 300
#: Background journal retries when web holds the record but R2 refused it.
REJOURNAL_DELAYS_S = (1.0, 5.0, 15.0, 60.0)


def readiness(cfg: rx.Config, journal: Journal) -> list[str]:
    problems = []
    if not cfg.enabled:
        problems.append("receiver_disabled")
    if not cfg.token_hashes:
        problems.append("no_webhook_token_hash")
    if not (cfg.storage_permitted or cfg.synthetic_only):
        problems.append("storage_permission_unconfirmed")
    if cfg.on_railway and not journal.durable and not cfg.allow_ephemeral:
        # ⛔ Fail CLOSED: a deploy whose journal is not durable never passes its
        # healthcheck, so Railway keeps the previous (good) deployment serving.
        problems.append("journal_not_durable")
    return problems


async def _read_capped(request: Request, cap: int) -> bytes | None:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > cap:
                return None
        except ValueError:
            return None
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _ack(cfg: rx.Config, record_id: str) -> Response:
    if cfg.ack_status == 204:
        return Response(status_code=204)
    status = cfg.ack_status if cfg.ack_status in (200, 201, 202) else 200
    return JSONResponse({"accepted": True, "id": record_id}, status_code=status)


def create_app(cfg: rx.Config | None = None, journal: Journal | None = None,
               forwarder: Forwarder | None = None) -> FastAPI:
    cfg = cfg or rx.Config()
    journal = journal if journal is not None else journal_from_env(dict(os.environ))
    forwarder = forwarder or Forwarder(cfg.web_ingest_url, cfg.ingest_token)
    bucket = rx.TokenBucket(cfg.rate_burst, cfg.rate_per_sec)
    counters = rx.Counters()

    async def _summary_loop() -> None:
        while True:
            await asyncio.sleep(SUMMARY_EVERY_S)
            logger.info("[txn] summary %s", counters.snapshot())

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        problems = readiness(cfg, journal)
        logger.info("[txn] receiver up journal=%s ready=%s problems=%s forwarder=%s",
                    journal.kind, not problems, problems, forwarder.configured)
        task = asyncio.get_running_loop().create_task(_summary_loop())
        try:
            yield
        finally:
            task.cancel()
            await forwarder.drain()
            if rejournal_tasks:
                await asyncio.wait(set(rejournal_tasks), timeout=3.0)
            await forwarder.aclose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.cfg, app.state.journal = cfg, journal
    app.state.forwarder, app.state.counters = forwarder, counters

    rejournal_tasks: set[asyncio.Task] = set()

    async def _put(record: dict[str, Any]) -> None:
        await asyncio.wait_for(asyncio.to_thread(journal.put, record),
                               timeout=cfg.journal_timeout_s)

    async def _rejournal(record: dict[str, Any]) -> None:
        """Web already holds the record durably; keep trying to give the journal
        its copy too, so recovery and audit see every delivery."""
        for delay in REJOURNAL_DELAYS_S:
            await asyncio.sleep(delay)
            try:
                await _put(record)
                counters.inc("rejournaled")
                return
            except (JournalError, asyncio.TimeoutError):
                continue
        counters.inc("rejournal_failed")
        logger.warning("[txn] journal copy abandoned id=%s (web holds it)", record["id"])

    def _schedule_rejournal(record: dict[str, Any]) -> None:
        t = asyncio.get_running_loop().create_task(_rejournal(record))
        rejournal_tasks.add(t)
        t.add_done_callback(rejournal_tasks.discard)

    def _late_put(record: dict[str, Any]):
        def cb(t: asyncio.Task) -> None:
            if t.cancelled() or t.exception() is None:
                return
            counters.inc("journal_failed")
            _schedule_rejournal(record)
        return cb

    app.state.rejournal_tasks = rejournal_tasks

    async def _deliver(record: dict[str, Any]) -> str | None:
        """Start the push and the journal PUT together; return which durable store
        confirmed FIRST ("journal" | "web"), or None if neither did in time.

        ⭐ DURABLE MEANS ONE OF TWO INDEPENDENT STORES HAS IT: the R2 journal, or
        web's SQLite (web answers 2xx only after a synchronous=FULL commit). A
        headline reaches a subscriber only through web's commit, so nothing is
        ever visible that is not durable somewhere -- and an R2 failure no longer
        means "shown but unacknowledged": if web committed, the sender gets its 2xx.
        The background retry here is only a FAST PATH: it lives in memory and dies
        with a restart. The durable owner of "R2 still lacks this record" is web's
        ledger (``deliveries.journaled`` + reconcile.repair_once), which rewrites
        the identical object once R2 accepts writes (Checkpoint D1 audit).
        """
        push = forwarder.start(record, on_done=_forward_done)
        put = asyncio.get_running_loop().create_task(_put(record))
        pending: set[asyncio.Task] = {push, put}
        via = None
        deadline = time.monotonic() + cfg.journal_timeout_s
        while pending and via is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            done, pending = await asyncio.wait(pending, timeout=remaining,
                                               return_when=asyncio.FIRST_COMPLETED)
            if not done:
                break
            if put in done and put.exception() is None:
                via = "journal"
            elif push in done and push.result() is True:
                via = "web"
        if put.done():
            if put.exception() is not None:
                counters.inc("journal_failed")
                if via == "web":
                    _schedule_rejournal(record)
        else:
            # Still in flight. If it fails late and web holds the record, retry the
            # journal copy; if it lands late after a 503, the record IS durable and
            # a sender retry becomes a counted repeat on web.
            put.add_done_callback(_late_put(record) if via == "web" else
                                  (lambda t: t.cancelled() or t.exception()))
        return via

    def _forward_done(ok: bool) -> None:
        counters.inc("forwarded" if ok else "forward_failed")

    @app.post("/hook")
    @app.post("/hook/{token}")
    async def hook(request: Request, token: str = "") -> Response:
        counters.inc("received")
        presented = rx.presented_credential(token, request.headers, cfg.auth_modes)
        if not cfg.enabled or not rx.verify_token(presented, cfg.token_hashes):
            counters.inc("refused_unknown")
            return JSONResponse(NOT_FOUND, status_code=404)
        if not (cfg.storage_permitted or cfg.synthetic_only):
            # ⛔ Owner rule: no real Trade Exchange content is stored anywhere
            # until retention/redistribution permission is confirmed in writing.
            counters.inc("refused_unpermitted")
            return JSONResponse({"detail": "temporarily unavailable"}, status_code=503,
                                headers={"Retry-After": "60"})
        if not bucket.take():
            counters.inc("rate_limited")
            return JSONResponse({"detail": "rate limited"}, status_code=429,
                                headers={"Retry-After": "5"})
        raw = await _read_capped(request, cfg.max_body_bytes)
        if raw is None:
            counters.inc("refused_oversize")
            return JSONResponse({"detail": "body too large"}, status_code=413)
        try:
            source, content, extra = rx.parse_payload(raw, cfg)
        except rx.PayloadError as e:
            counters.inc("refused_source" if e.reason.startswith("source is not")
                         else "refused_oversize" if e.status == 413 else "refused_malformed")
            return JSONResponse({"detail": e.reason}, status_code=e.status)
        if cfg.synthetic_only and not content.startswith(rx.SYNTHETIC_PREFIX):
            # Staging never stores or forwards anything that is not synthetic.
            counters.inc("refused_not_synthetic")
            return JSONResponse({"detail": "synthetic-only deployment"}, status_code=422)

        meta = rx.delivery_meta(dict(request.headers), len(raw),
                                request.headers.get("x-real-ip")
                                or (request.client.host if request.client else None))
        record = rx.build_record(source, content, extra, meta, cfg)
        via = await _deliver(record)
        if via is None:
            # ⛔ NEITHER store confirmed => NOT acknowledged.
            logger.warning("[txn] not durable in time id=%s", record["id"])
            return JSONResponse({"detail": "temporarily unavailable"}, status_code=503,
                                headers={"Retry-After": "5"})
        counters.inc("accepted")
        counters.inc(f"durable_via_{via}")
        counters.last_accepted_ms = record["received_at_ms"]
        return _ack(cfg, record["id"])

    @app.get("/health")
    async def health() -> JSONResponse:
        problems = readiness(cfg, journal)
        return JSONResponse({"ok": not problems, "problems": problems,
                             "journal": journal.kind, "t": int(time.time())},
                            status_code=200 if not problems else 503)

    return app


def _boot_app() -> Any:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    install_log_redaction()
    from txn_redaction import init_sentry
    init_sentry(os.environ.get("TXN_SENTRY_DSN", ""))
    return create_app()
