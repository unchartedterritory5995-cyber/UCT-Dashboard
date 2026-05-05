"""In-memory state and subscriber routing for real-time bars.

For each (symbol, timeframe) we maintain:
- An in-progress bar (latest bucket, possibly still being filled by 1-min bars)
- A set of asyncio Queues, one per connected SSE client subscribed to that pair

When a fresh 1-min bar arrives:
- Emit it to (sym, "1") subscribers as-is
- For tf in (5, 15, 30): aggregate into the (sym, tf) in-progress bar and emit the
  partial bucket bar to subscribers. When the new minute closes a bucket, the next minute
  bar starts a new bucket. (60-min excluded in v1 — ET-anchor required.)

Reference counting: subscribe() returns a Queue. Caller must call unsubscribe() with the
same queue when done. on_last_unsubscribe is invoked when (sym, *) drops to zero
subscribers across all timeframes — used to tell bar_stream.py to unsubscribe upstream.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Callable, Optional

from api.services.bar_rollup import TF_TO_SECONDS, aggregate, bucket_start

_logger = logging.getLogger(__name__)

ROLLUP_TFS = ("5", "15", "30")  # we don't roll up "1" — it's pass-through. "60" excluded in v1 (ET-anchor needed).


class BarBroadcaster:
    def __init__(self,
                 on_first_subscribe: Optional[Callable[[str], None]] = None,
                 on_last_unsubscribe: Optional[Callable[[str], None]] = None):
        self._partials: dict[tuple[str, str], dict] = {}     # (sym, tf) -> in-progress bar
        self._subscribers: dict[tuple[str, str], set[asyncio.Queue]] = {}
        self._lock = threading.Lock()
        self._on_first_subscribe = on_first_subscribe or (lambda sym: None)
        self._on_last_unsubscribe = on_last_unsubscribe or (lambda sym: None)

    # ── Subscription management (called from SSE endpoint coroutines) ──

    def subscribe(self, sym: str, tf: str) -> asyncio.Queue:
        sym = sym.upper()
        if tf != "1" and tf not in ROLLUP_TFS:
            raise ValueError(f"Unsupported tf: {tf!r}")
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        key = (sym, tf)
        with self._lock:
            had_any = self._symbol_has_any_subscriber(sym)
            self._subscribers.setdefault(key, set()).add(q)
        if not had_any:
            try:
                self._on_first_subscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)
        return q

    def unsubscribe(self, sym: str, tf: str, q: asyncio.Queue) -> None:
        sym = sym.upper()
        key = (sym, tf)
        with self._lock:
            subs = self._subscribers.get(key)
            if subs and q in subs:
                subs.discard(q)
                if not subs:
                    self._subscribers.pop(key, None)
            still_any = self._symbol_has_any_subscriber(sym)
        if not still_any:
            try:
                self._on_last_unsubscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    def _symbol_has_any_subscriber(self, sym: str) -> bool:
        return any(s == sym for (s, _tf) in self._subscribers.keys())

    # ── Inbound from bar_stream ──

    def push_minute_bar(self, sym: str, bar: dict) -> None:
        """Called from bar_stream's on_bar callback (background asyncio loop)."""
        sym = sym.upper()
        # 1-min: pass-through
        self._emit(sym, "1", bar)
        # 5/15/30: bucket-aggregate
        for tf in ROLLUP_TFS:
            new_start = bucket_start(bar["t"], tf)
            key = (sym, tf)
            with self._lock:
                prev = self._partials.get(key)
                if prev is None or prev["t"] != new_start:
                    # New bucket: replace partial with first-bar-of-bucket
                    next_partial = aggregate(None, {**bar, "t": new_start})
                else:
                    next_partial = aggregate(prev, bar)
                self._partials[key] = next_partial
                emit_bar = dict(next_partial)
            self._emit(sym, tf, emit_bar)

    # ── Internal: dispatch to subscriber queues ──

    def _emit(self, sym: str, tf: str, bar: dict) -> None:
        key = (sym, tf)
        with self._lock:
            queues = list(self._subscribers.get(key, ()))
        msg = {"sym": sym, "tf": tf, "bar": bar}
        for q in queues:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # Slow consumer — drop the oldest, push the new. Real-time data:
                # freshness > completeness.
                try:
                    q.get_nowait()
                    q.put_nowait(msg)
                except Exception:
                    pass

    def get_status(self) -> dict:
        with self._lock:
            return {
                "subscriber_pairs": len(self._subscribers),
                "tracked_partials": len(self._partials),
                "symbols": sorted({s for (s, _) in self._subscribers.keys()}),
            }


# Module-level singleton — initialized at app startup, importable everywhere
_singleton: Optional[BarBroadcaster] = None


def get_broadcaster() -> BarBroadcaster:
    global _singleton
    if _singleton is None:
        raise RuntimeError("BarBroadcaster not initialized — call init_broadcaster() first")
    return _singleton


def init_broadcaster(*, on_first_subscribe=None, on_last_unsubscribe=None) -> BarBroadcaster:
    global _singleton
    _singleton = BarBroadcaster(
        on_first_subscribe=on_first_subscribe,
        on_last_unsubscribe=on_last_unsubscribe,
    )
    return _singleton
