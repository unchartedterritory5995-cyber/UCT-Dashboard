"""In-memory pub/sub hub for The Floor's live chat (Pulse channels + live Boards).

Modeled on api/services/bar_broadcaster.py — in particular its CROSS-THREAD fix:
our producer is the sync-`def` POST handler running in FastAPI's threadpool, so we
capture each subscriber's event loop at subscribe() time and dispatch every message
via `loop.call_soon_threadsafe(...)`. A bare cross-thread `put_nowait` would race the
waiter wakeup and stall delivery until the SSE coroutine's wait_for timeout (1–5s late).

Single web process = one event loop; this in-memory hub needs no Redis. The only
Redis-touch point later is broadcast(); everything else is process-local.

Design notes:
- One SSE connection per pooled client, subscribed to MANY channels (rooms keyed by
  slug). broadcast(channel, ...) fans out to every connection subscribed to that room.
- Bounded per-connection queue with drop-oldest backpressure. EPHEMERAL frames
  (typing/presence) yield when the queue is half-full so a busy channel's typing spam
  can never evict a real message.
- Presence is derived from live connections (never persisted): "on the floor" = a
  connected client subscribed to that channel. A periodic coalesced snapshot is
  broadcast by a background task (see broadcast_presence_all / main.py).
- Subscriber cap is PER-USER pooled-connection accounting, not user×tab×channel.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time as _time
from typing import Optional

_logger = logging.getLogger(__name__)

MAX_SUBSCRIBERS = int(os.environ.get("CHAT_MAX_SUBSCRIBERS", "400"))
MAX_PER_USER = int(os.environ.get("CHAT_MAX_PER_USER", "6"))
QUEUE_MAX = int(os.environ.get("CHAT_QUEUE_MAX", "400"))

# Telemetry (GIL-atomic; off the lock hot path)
_msgs_broadcast_total = 0
_dropped_total = 0
_last_emit_at = 0.0


def _safe_put(q: "asyncio.Queue", msg: dict, ephemeral: bool) -> None:
    """Runs on the queue's owner loop via call_soon_threadsafe."""
    global _dropped_total
    if ephemeral and q.qsize() >= max(1, q.maxsize // 2):
        # Under pressure, drop the ephemeral frame rather than risk evicting a real
        # message. typing/presence are best-effort; messages are not.
        return
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        # Slow consumer — drop oldest, push newest (freshness > completeness).
        try:
            q.get_nowait()
            q.put_nowait(msg)
            _dropped_total += 1
        except Exception:
            pass


class _Conn:
    __slots__ = ("id", "user_id", "queue", "loop", "channels")

    def __init__(self, cid, user_id, queue, loop, channels):
        self.id = cid
        self.user_id = user_id
        self.queue = queue
        self.loop = loop
        self.channels = set(channels)


class ChatHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._conns: dict[int, _Conn] = {}
        self._by_channel: dict[str, set[int]] = {}
        self._counter = 0

    # ── Subscription (called from the SSE endpoint coroutine) ──

    def subscribe(self, user_id: str, channels) -> "Optional[_Conn]":
        """Register one pooled connection subscribed to many channels. Returns None if
        at capacity (caller should send `event: full` and fall back to polling)."""
        loop = asyncio.get_running_loop()
        channels = [c for c in (channels or []) if c]
        with self._lock:
            if len(self._conns) >= MAX_SUBSCRIBERS:
                return None
            if user_id is not None:
                per_user = sum(1 for c in self._conns.values() if c.user_id == user_id)
                if per_user >= MAX_PER_USER:
                    return None
            self._counter += 1
            cid = self._counter
            conn = _Conn(cid, user_id, asyncio.Queue(maxsize=QUEUE_MAX), loop, channels)
            self._conns[cid] = conn
            for ch in channels:
                self._by_channel.setdefault(ch, set()).add(cid)
        return conn

    def unsubscribe(self, conn: "_Conn") -> None:
        if conn is None:
            return
        with self._lock:
            self._conns.pop(conn.id, None)
            for ch in conn.channels:
                s = self._by_channel.get(ch)
                if s:
                    s.discard(conn.id)
                    if not s:
                        self._by_channel.pop(ch, None)

    # ── Broadcast (called from sync POST handlers in the threadpool) ──

    def broadcast(self, channel: str, event: str, data: dict, *, ephemeral: bool = False) -> None:
        with self._lock:
            cids = list(self._by_channel.get(channel, ()))
            conns = [self._conns[c] for c in cids if c in self._conns]
        if not conns:
            return
        msg = {"event": event, "channel": channel, "data": data}
        for conn in conns:
            try:
                conn.loop.call_soon_threadsafe(_safe_put, conn.queue, msg, ephemeral)
            except RuntimeError:
                pass   # loop closed — dead session, skip
        global _msgs_broadcast_total, _last_emit_at
        if not ephemeral:
            _msgs_broadcast_total += 1
            _last_emit_at = _time.time()

    # ── Presence (derived from live connections; never persisted) ──

    def presence_users(self, channel: str):
        with self._lock:
            cids = self._by_channel.get(channel, set())
            users = {self._conns[c].user_id for c in cids
                     if c in self._conns and self._conns[c].user_id}
        return sorted(users)

    def presence_count(self, channel: str) -> int:
        return len(self.presence_users(channel))

    def active_channels(self):
        with self._lock:
            return list(self._by_channel.keys())

    def broadcast_presence_all(self) -> None:
        """Coalesced presence snapshot per active channel — call on a ~5-10s timer."""
        for ch in self.active_channels():
            users = self.presence_users(ch)
            self.broadcast(ch, "presence", {"count": len(users), "users": users},
                           ephemeral=True)

    def stats(self) -> dict:
        with self._lock:
            conns = len(self._conns)
            channels = {ch: len(s) for ch, s in self._by_channel.items()}
        return {
            "connections": conns,
            "max_subscribers": MAX_SUBSCRIBERS,
            "channels": channels,
            "messages_broadcast_total": _msgs_broadcast_total,
            "dropped_total": _dropped_total,
            "last_emit_age_s": (round(_time.time() - _last_emit_at, 1) if _last_emit_at else None),
        }


# ── Module singleton ──
_hub: Optional[ChatHub] = None


def get_hub() -> ChatHub:
    global _hub
    if _hub is None:
        _hub = ChatHub()
    return _hub


def reset_hub_for_tests() -> None:
    global _hub
    _hub = None
