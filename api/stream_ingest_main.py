"""Entrypoint of the `stream-ingest` service (ingest PR4a: the DARK skeleton).

    python -m api.stream_ingest_main          run forever on $PORT
    python -m api.stream_ingest_main --status print a status snapshot and exit

Railway: its own config-as-code file, railway.ingest.json (NEVER the shared
railway.json: editing that redeploys flow-worker). One asyncio loop, one port:

    GET  /api/health      200 "ok" (Railway deploy healthcheck)
    GET  /status          JSON status (Authorization: Bearer <PUSH_SECRET>)
    WS   /internal/feed   the web pods' feed (same auth), see ingest_feed_server

PR4a opens NO market-data socket. `STREAM_INGEST_CONNECT` is read only to be
REPORTED (status shows it); nothing here acts on it. PR4b adds the Massive reader
behind STREAM_INGEST_CONNECT=1 + vendor_socket_guard, break-before-make only (the
web pod releases its socket before ingest connects; never two stocks sockets).

Must not import api.main (no FastAPI app, no web startup jobs): the rail in
tests/test_stream_ingest_skeleton.py walks this module's import closure.
Env: PORT (default 8080), PUSH_SECRET (required to serve the feed; fail closed),
INGEST_CLIENT_LEASE_S (default 180), STREAM_INGEST_CONNECT (reported only).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys

from api.services import feed_protocol as fp
from api.services import ingest_feed_server as ifs

log = logging.getLogger("api.stream_ingest_main")


def _connect_requested() -> bool:
    return os.environ.get("STREAM_INGEST_CONNECT", "0") == "1"


def build_server() -> ifs.IngestFeedServer:
    lease = float(os.environ.get("INGEST_CLIENT_LEASE_S", str(fp.DEFAULT_LEASE_S)))
    return ifs.IngestFeedServer(
        secret=os.environ.get("PUSH_SECRET", ""),
        lease_s=lease,
        status_extra=lambda: {
            "service": "stream-ingest",
            "stage": "pr4a-dark",
            "vendor_socket": "none",
            "connect_requested": _connect_requested(),
            "secret_configured": bool(os.environ.get("PUSH_SECRET")),
        },
    )


def make_process_request(server: ifs.IngestFeedServer):
    """HTTP routing before the websocket upgrade (websockets' process_request hook)."""
    from http import HTTPStatus

    def process_request(connection, request):
        path = request.path.split("?", 1)[0]
        if path == ifs.HEALTH_PATH:
            return connection.respond(HTTPStatus.OK, "ok\n")
        if path not in (ifs.STATUS_PATH, ifs.FEED_PATH):
            return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
        if not server.secret:
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "PUSH_SECRET not configured\n")
        if not ifs.bearer_ok(request.headers.get("Authorization"), server.secret):
            server.counters.auth_rejected += 1
            return connection.respond(HTTPStatus.UNAUTHORIZED, "unauthorized\n")
        if path == ifs.STATUS_PATH:
            resp = connection.respond(HTTPStatus.OK, json.dumps(server.status(), default=str) + "\n")
            resp.headers["Content-Type"] = "application/json"
            return resp
        if server.closing:
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "shutting down\n")
        return None   # /internal/feed: proceed with the upgrade
    return process_request


async def _periodic(server: ifs.IngestFeedServer, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=ifs.EXPIRE_INTERVAL_S)
        except asyncio.TimeoutError:
            pass
        server.expire()


async def serve_forever(port: int, server: ifs.IngestFeedServer, stop: asyncio.Event) -> None:
    from websockets.asyncio.server import serve

    async def handler(connection):
        await server.handle(connection)

    async with serve(handler, "0.0.0.0", port,
                     process_request=make_process_request(server),
                     max_size=fp.MAX_MESSAGE_BYTES,
                     # The feed is its own liveness signal (a batch at least every
                     # STATUS_INTERVAL_S); keep the library ping too, generously.
                     ping_interval=20, ping_timeout=60,
                     compression=None) as ws_server:
        log.info("[stream-ingest] listening on :%d (epoch %d, dark: no vendor socket)", port, server.epoch)
        periodic = asyncio.create_task(_periodic(server, stop))
        await stop.wait()
        log.info("[stream-ingest] stopping: final batches, closing clients 1001")
        ws_server.close(close_connections=False)
        await server.shutdown()
        periodic.cancel()
        await ws_server.wait_closed()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m api.stream_ingest_main")
    ap.add_argument("--status", action="store_true", help="print a status snapshot and exit")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    server = build_server()
    if args.status:
        print(json.dumps(server.status(), indent=2, default=str))
        return 0
    if not server.secret:
        log.warning("[stream-ingest] PUSH_SECRET is not set: the feed refuses every client (fail closed)")
    port = int(os.environ.get("PORT", "8080"))

    async def run():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, stop.set)
            except (NotImplementedError, RuntimeError):   # Windows dev boxes
                signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
        await serve_forever(port, server, stop)

    asyncio.run(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
