"""stream-ingest: the internal feed server (ingest PR4a, the DARK skeleton).

Web pods connect to `ws://stream-ingest.railway.internal:$PORT/internal/feed`, say
`hello`, then send their `desired` set (and `patch` deltas). The server holds every
client's set in one `feed_protocol.DesiredUnion` (with the client lease, so a web
deploy keeps the feed warm), and sends each client `batch` messages from that client's
own `CoalescingBuffer`.

PR4a ships this WITHOUT a market-data socket. Desired-set changes only update the
union and its counters (`on_delta` is a no-op hook PR4b wires to bar_stream), and the
only data a client receives is a status batch about once a second: the heartbeat that
lets the web side track epoch and seq from day one. Nothing here opens a socket to a
vendor. The rail `tests/test_stream_ingest_skeleton.py` keeps it that way.

Auth: `Authorization: Bearer <PUSH_SECRET>` on the upgrade request, the same
service-auth convention as the repo's other internal endpoints, compared in constant
time. Fail closed: with no secret configured, every feed request gets 503.

Lifecycle per connection:
  1. the upgrade request is authenticated (process_request; HTTP 401 on failure)
  2. the first message must be `hello` within HELLO_TIMEOUT_S, otherwise close 1008
  3. a decode error / stale gen / out-of-order patch closes 1008 with the reason
  4. a buffer STALL (the client cannot keep up) closes 1013; the client reconnects,
     re-sends desired, and (from PR4b) gets a full snapshot
  5. on disconnect the client's set is HELD for the lease, then released by expire()
Shutdown (SIGTERM): stop accepting, send one final batch to each client, close 1001.
"""
from __future__ import annotations

import asyncio
import hmac
import itertools
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from api.services import feed_protocol as fp

log = logging.getLogger("api.services.ingest_feed_server")

FEED_PATH = "/internal/feed"
HEALTH_PATH = "/api/health"
STATUS_PATH = "/status"
HELLO_TIMEOUT_S = 5.0
#: How often each client gets a batch (data when there is any; in PR4a, status only).
BATCH_INTERVAL_S = float(os.environ.get("INGEST_BATCH_INTERVAL_S", "0.05"))
#: How often the status block is refreshed into every buffer (also the heartbeat).
STATUS_INTERVAL_S = 1.0
EXPIRE_INTERVAL_S = 1.0
#: A websockets send that takes longer than this means the client is not draining.
SEND_TIMEOUT_S = 10.0

CLOSE_POLICY = 1008      # protocol / auth violation
CLOSE_TRY_AGAIN = 1013   # stalled buffer: reconnect for a fresh snapshot
CLOSE_GOING_AWAY = 1001  # shutdown


def bearer_ok(header_value: Optional[str], secret: str) -> bool:
    """Constant-time `Bearer <secret>` check. An empty secret never authenticates."""
    if not secret or not header_value:
        return False
    return hmac.compare_digest(header_value.encode("utf-8"), f"Bearer {secret}".encode("utf-8"))


@dataclass
class _Client:
    client_id: str
    conn: object
    buffer: fp.CoalescingBuffer
    connected_at: float
    batches_sent: int = 0
    last_send_s: Optional[float] = None


@dataclass
class FeedCounters:
    connections_total: int = 0
    auth_rejected: int = 0
    protocol_closes: int = 0
    stall_closes: int = 0
    hello_timeouts: int = 0
    desired_total: int = 0
    patches_total: int = 0
    deltas_applied: int = 0
    leases_expired: int = 0
    send_errors: int = 0
    last_close_reason: Optional[str] = None
    extra: dict = field(default_factory=dict)


class IngestFeedServer:
    """Protocol + lifecycle; the transport (websockets) is passed in per connection,
    so the logic is testable without a real socket."""

    def __init__(self, *, secret: str, lease_s: float = fp.DEFAULT_LEASE_S,
                 epoch: Optional[int] = None,
                 monotonic: Callable[[], float] = time.monotonic,
                 on_delta: Optional[Callable[[fp.ChannelDelta], None]] = None,
                 status_extra: Optional[Callable[[], dict]] = None,
                 limits: fp.BufferLimits = fp.BufferLimits()):
        self.secret = secret
        # A new epoch per boot: the web mirror resets on an epoch change (invariant 8).
        self.epoch = int(epoch if epoch is not None else time.time() * 1000)
        self._mono = monotonic
        self.union = fp.DesiredUnion(lease_s=lease_s)
        self._on_delta = on_delta or (lambda d: None)
        self._status_extra = status_extra or (lambda: {})
        self._limits = limits
        self.clients: dict[str, _Client] = {}
        self.counters = FeedCounters()
        self.started_mono = monotonic()
        self.closing = False
        self._conn_ids = itertools.count(1)

    # -- desired-set changes --

    def _apply(self, delta: fp.ChannelDelta) -> None:
        if delta.is_empty():
            return
        self.counters.deltas_applied += 1
        try:
            self._on_delta(delta)
        except Exception as e:  # noqa: BLE001 - one bad delta must not drop the client
            log.warning("[ingest-feed] on_delta failed: %s", e)

    def expire(self) -> None:
        delta = self.union.expire(self._mono())
        if delta.released_clients:
            self.counters.leases_expired += len(delta.released_clients)
        self._apply(delta)

    # -- status --

    def status(self) -> dict:
        now = self._mono()
        return {
            "epoch": self.epoch,
            "uptime_s": round(now - self.started_mono, 1),
            "closing": self.closing,
            "clients": {cid: {"connected_s": round(now - c.connected_at, 1),
                              "batches_sent": c.batches_sent,
                              "pending": c.buffer.pending_size(),
                              "buffer": dict(c.buffer.counters)}
                        for cid, c in self.clients.items()},
            "union": {"clients": {k: {"gen": v["gen"], "connected": v["connected"]}
                                  for k, v in self.union.clients().items()},
                      "symbols": len(self.union.channels()),
                      "keys": len(self.union.keys()),
                      "tas_syms": len(self.union.tas_syms())},
            "counters": {k: v for k, v in vars(self.counters).items() if k != "extra"},
            **self._status_extra(),
        }

    def _wire_status(self) -> dict:
        # What every client sees in its batches: small, JSON-safe, no secrets.
        return {"epoch": self.epoch, "connect": False, "closing": self.closing,
                "clients": len(self.clients)}

    # -- one connection --

    async def handle(self, conn) -> None:
        """Run one authenticated client connection to completion.

        `conn` needs: `await recv()`, `await send(bytes)`, `await close(code, reason)`.
        """
        self.counters.connections_total += 1
        client: Optional[_Client] = None
        sender: Optional[asyncio.Task] = None
        try:
            try:
                first = await asyncio.wait_for(conn.recv(), timeout=HELLO_TIMEOUT_S)
            except asyncio.TimeoutError:
                self.counters.hello_timeouts += 1
                await self._close(conn, CLOSE_POLICY, "hello timeout")
                return
            try:
                hello = fp.decode(first)
                if not isinstance(hello, fp.Hello):
                    raise fp.MalformedMessage(f"first message must be hello, got {type(hello).__name__}")
                self._apply(self.union.hello(hello.client_id, hello.gen, self._mono()))
            except fp.ProtocolError as e:
                self.counters.protocol_closes += 1
                await self._close(conn, CLOSE_POLICY, f"{type(e).__name__}: {e}")
                return
            old = self.clients.get(hello.client_id)
            if old is not None:
                # Same client id reconnected (its old socket is dead or about to be):
                # the newest connection owns the id.
                await self._close(old.conn, CLOSE_POLICY, "superseded by a newer connection")
            client = _Client(client_id=hello.client_id, conn=conn,
                             buffer=fp.CoalescingBuffer(self.epoch, self._limits),
                             connected_at=self._mono())
            self.clients[hello.client_id] = client
            client.buffer.set_status(self._wire_status())
            sender = asyncio.create_task(self._send_loop(client))
            await self._recv_loop(client)
        finally:
            if sender is not None:
                sender.cancel()
            if client is not None and self.clients.get(client.client_id) is client:
                del self.clients[client.client_id]
                if not self.closing:
                    self._apply(self.union.disconnect(client.client_id, self._mono()))

    async def _recv_loop(self, client: _Client) -> None:
        conn = client.conn
        while True:
            try:
                data = await conn.recv()
            except Exception:  # noqa: BLE001 - the connection closed
                return
            try:
                msg = fp.decode(data)
                now = self._mono()
                if isinstance(msg, fp.Desired):
                    self.counters.desired_total += 1
                    self._apply(self.union.set_desired(client.client_id, msg, now))
                elif isinstance(msg, fp.Patch):
                    self.counters.patches_total += 1
                    self._apply(self.union.apply_patch(client.client_id, msg, now))
                else:
                    raise fp.MalformedMessage(f"unexpected {type(msg).__name__} from a client")
            except fp.ProtocolError as e:
                self.counters.protocol_closes += 1
                await self._close(conn, CLOSE_POLICY, f"{type(e).__name__}: {e}")
                return

    async def _send_loop(self, client: _Client) -> None:
        last_status = self._mono()
        while True:
            await asyncio.sleep(BATCH_INTERVAL_S)
            now = self._mono()
            if now - last_status >= STATUS_INTERVAL_S:
                last_status = now
                client.buffer.set_status(self._wire_status())
            if not await self.flush_client(client):
                return

    async def flush_client(self, client: _Client) -> bool:
        """Send whatever is pending. False when the client was closed (stall/error)."""
        buf = client.buffer
        if buf.stalled:
            self.counters.stall_closes += 1
            await self._close(client.conn, CLOSE_TRY_AGAIN, f"stalled: {buf.stall_reason}")
            return False
        batch = buf.drain()
        if batch is None:
            return True
        try:
            await asyncio.wait_for(client.conn.send(fp.encode(batch)), timeout=SEND_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001
            self.counters.send_errors += 1
            await self._close(client.conn, CLOSE_TRY_AGAIN, f"send failed: {type(e).__name__}")
            return False
        client.batches_sent += 1
        client.last_send_s = self._mono()
        return True

    async def _close(self, conn, code: int, reason: str) -> None:
        self.counters.last_close_reason = reason[:120]
        try:
            await conn.close(code, reason[:120])
        except Exception:  # noqa: BLE001
            pass

    async def shutdown(self) -> None:
        """SIGTERM: one final batch to each client, then close 1001."""
        self.closing = True
        for client in list(self.clients.values()):
            client.buffer.set_status(self._wire_status())
            try:
                await self.flush_client(client)
            except Exception:  # noqa: BLE001
                pass
            await self._close(client.conn, CLOSE_GOING_AWAY, "stream-ingest shutting down")
        self.clients.clear()
