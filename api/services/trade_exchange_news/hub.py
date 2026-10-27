"""In-process fan-out: every subscriber receives the same events in the same order.

⭐ ORDER IS DECIDED ONCE, UPSTREAM. ``pipeline``'s single writer thread commits a
headline (which assigns its ``seq``) and only then schedules ``publish`` onto
the event loop with ``call_soon_threadsafe`` -- a FIFO -- so publishes happen in
commit order, and every subscriber queue receives them in that order.

⛔ A SLOW SUBSCRIBER IS NEVER SILENTLY SHORTED. ``api/chat_stream.py`` drops the
oldest frame when a queue fills (freshness over completeness, right for chat).
News is the other way round: a full queue is cleared and replaced by ONE
``resync`` marker, and the subscriber's stream re-reads the store from its last
seq (``pipeline.stream``). It may arrive late; it never arrives with a hole.

Single web process => no external pub/sub, the house rule chat_stream states.
"""
from __future__ import annotations

import asyncio
from typing import Any

RESYNC = {"type": "resync"}


class Subscription:
    __slots__ = ("queue", "resyncs")

    def __init__(self, maxsize: int) -> None:
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
        self.resyncs = 0


class Hub:
    def __init__(self, queue_max: int = 512) -> None:
        self.queue_max = queue_max
        self._subs: set[Subscription] = set()
        self.published = 0
        self.resyncs = 0

    def subscribe(self) -> Subscription:
        sub = Subscription(self.queue_max)
        self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        self._subs.discard(sub)

    @property
    def subscribers(self) -> int:
        return len(self._subs)

    def publish(self, event: dict[str, Any]) -> None:
        """Runs ON THE LOOP (scheduled by the writer thread)."""
        self.published += 1
        for sub in list(self._subs):
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:
                while not sub.queue.empty():
                    sub.queue.get_nowait()
                sub.queue.put_nowait(RESYNC)
                sub.resyncs += 1
                self.resyncs += 1
