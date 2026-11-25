"""Pushed list prices: ONE price channel per symbol, conflated, serialised once, fanned out as bytes.

    Massive -> stream-ingest (per-trade last price, coalesced per 50 ms batch)
            -> RemoteBroadcaster.apply_batch (stream-edge, or web in remote mode)
            -> QuoteHub.on_prices  ->  per symbol: latest wins, at most MAX_HZ frames a second
            -> one `bytes` frame per symbol update, the SAME object put in every member's pending map
            -> /api/stream/quotes (api/routers/quote_stream.py) writes a member's pending frames in one chunk

Why this shape (docs: the PR that added this file, "Scale arithmetic"):
  * SERIALISE ONCE. The work that grows with members is a dict store per (member, symbol update) and one
    socket write per member per ingest batch. JSON encoding grows with SYMBOLS, never with members.
  * CONFLATE PER SYMBOL, LATEST WINS. A symbol leaves at most `max_hz` times a second (default 4). The first
    change after a quiet spell leaves AT ONCE (no timer between a trade and the wire); changes inside the
    interval are held and the newest leaves when it ends (`schedule` arms one timer for the earliest).
    A volume-only change (the same price) is held to `volume_interval_s` (default 1 s): the Volume column
    may tick once a second, the price column up to `max_hz`.
  * THE PER-CONNECTION BOUND IS STRUCTURAL. A member's pending map holds at most ONE frame per symbol it
    asked for (a newer frame replaces the older), so a member who stops reading costs at most
    len(symbols) frames of memory, never a queue that grows; a slow reader always gets the newest price.
  * ALL ON ONE EVENT LOOP. apply_batch runs on the uvicorn loop (feed_client), so do the SSE generators:
    no lock, no cross-thread hop. `schedule` (loop.call_later) is the only timer.

Frame (one SSE message, no `event:` line, so it arrives as EventSource `message`):
    data: ["AAPL",231.45,12345678,1732550000123,1732550000180]\\n\\n
           sym     price  day vol  trade time ms  serialised at (server wall ms)
The last field lets a browser measure serialise -> receive; trade -> receive needs the browser clock
(lib/quotePush.js getPushStats reads both).

Counted in-process (one uvicorn process per pod): `stats()`.
"""
from __future__ import annotations

import json
import logging
import os
import time as _time
from typing import Callable, Optional

log = logging.getLogger("api.services.quote_hub")


def _env_float(name: str, default: float) -> float:
    try:
        v = float(os.environ.get(name, "") or default)
        return v if v > 0 else default
    except ValueError:
        return default


#: Per symbol, at most this many frames a second leave the hub (latest wins inside the interval).
DEFAULT_MAX_HZ = _env_float("QUOTE_STREAM_MAX_HZ", 4.0)
#: A change of volume alone (same price) leaves at most once per this many seconds.
DEFAULT_VOLUME_INTERVAL_S = _env_float("QUOTE_STREAM_VOLUME_INTERVAL_S", 1.0)


def encode_frame(sym: str, price, volume, trade_ms, sent_ms) -> bytes:
    """One SSE message. Compact on purpose: at 10k members this is most of the egress."""
    body = json.dumps([sym, price, volume, trade_ms, sent_ms], separators=(",", ":"))
    return b"data: " + body.encode("ascii") + b"\n\n"


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return x
    return None


class QuoteConn:
    """One member connection: its symbols, its pending frames (at most one per symbol), its wake-up."""

    __slots__ = ("syms", "pending", "event", "replaced", "delivered")

    def __init__(self, syms):
        import asyncio
        self.syms = tuple(syms)
        self.pending: dict = {}
        self.event = asyncio.Event()
        self.replaced = 0
        self.delivered = 0

    def _deliver(self, sym: str, frame: bytes) -> None:
        if sym in self.pending:
            self.replaced += 1
        self.pending[sym] = frame
        self.delivered += 1
        self.event.set()

    def take(self) -> bytes:
        """Every pending frame, in one chunk (one write), and clear."""
        self.event.clear()
        if not self.pending:
            return b""
        out = b"".join(self.pending.values())
        self.pending.clear()
        return out


class _Sym:
    __slots__ = ("latest", "sent", "sent_at", "frame", "dirty")

    def __init__(self):
        self.latest = None      # (price, volume, trade_ms) offered last
        self.sent = None        # (price, volume, trade_ms) in the last frame
        self.sent_at = None     # monotonic s of the last frame
        self.frame = None       # the last frame's bytes (a new member's snapshot)
        self.dirty = False


class QuoteHub:
    def __init__(self, *, max_hz: Optional[float] = None, volume_interval_s: Optional[float] = None,
                 monotonic: Callable[[], float] = _time.monotonic,
                 wall_ms: Optional[Callable[[], int]] = None,
                 schedule="loop"):
        self.max_hz = float(max_hz or DEFAULT_MAX_HZ)
        self.min_interval = 1.0 / self.max_hz
        self.volume_interval = float(volume_interval_s or DEFAULT_VOLUME_INTERVAL_S)
        self._mono = monotonic
        self._wall_ms = wall_ms or (lambda: int(_time.time() * 1000))
        # schedule(delay_s, fn): "loop" = the running event loop's call_later; None = no timer (tests
        # drive flush() themselves).
        self._schedule = self._loop_schedule if schedule == "loop" else schedule
        self._syms: dict = {}           # sym -> _Sym
        self._subs: dict = {}           # sym -> set[QuoteConn]
        self._dirty: set = set()
        self._timer = None
        self._conns = 0
        self.counters = {"offers": 0, "serialised": 0, "fanout": 0, "held": 0, "snapshots": 0,
                         "opened": 0, "closed": 0}

    # ── members ──────────────────────────────────────────────────────────────

    def open(self, syms, snapshot: Optional[Callable[[str], Optional[dict]]] = None) -> QuoteConn:
        """Register a member for `syms` and put the current quote of each in its pending map at once
        (the hub's last frame, else `snapshot(sym)`, the mirror's latest quote)."""
        conn = QuoteConn(syms)
        self._conns += 1
        self.counters["opened"] += 1
        for sym in conn.syms:
            self._subs.setdefault(sym, set()).add(conn)
            st = self._syms.get(sym)
            if st is None:
                st = self._syms[sym] = _Sym()
            if st.frame is None and snapshot is not None:
                try:
                    q = snapshot(sym)
                except Exception:  # noqa: BLE001 - a snapshot is best-effort
                    q = None
                if q:
                    self._accept(sym, st, q)
                    if st.dirty:
                        # to every member of the symbol still without a first frame, this one included
                        self._emit(sym, st, self._mono())
                        self.counters["snapshots"] += 1
            if st.frame is not None and sym not in conn.pending:
                conn._deliver(sym, st.frame)
        return conn

    def close(self, conn: QuoteConn) -> None:
        self._conns = max(0, self._conns - 1)
        self.counters["closed"] += 1
        for sym in conn.syms:
            subs = self._subs.get(sym)
            if subs is None:
                continue
            subs.discard(conn)
            if not subs:
                del self._subs[sym]
                self._syms.pop(sym, None)
                self._dirty.discard(sym)
        conn.pending.clear()

    def wants(self, sym: str) -> bool:
        return sym in self._subs

    # ── the data plane (apply_batch, on the loop) ───────────────────────────

    def on_prices(self, prices: dict) -> None:
        """RemoteBroadcaster.quote_sink: one ingest batch's prices {sym: {price, ts, trade_ts, volume}}."""
        any_offer = False
        for sym, q in prices.items():
            if sym in self._subs:
                st = self._syms.get(sym)
                if st is None:
                    st = self._syms[sym] = _Sym()
                self.counters["offers"] += 1
                if self._accept(sym, st, q):
                    any_offer = True
        if any_offer:
            self.flush()

    def _accept(self, sym: str, st: _Sym, q: dict) -> bool:
        price = _num(q.get("price"))
        if price is None or not price > 0:
            return False
        vol = _num(q.get("volume"))
        tms = _num(q.get("trade_ts")) or _num(q.get("ts"))
        cur = (price, vol, int(tms) if tms is not None else None)
        if st.latest is not None and st.latest[0] == cur[0] and st.latest[1] == cur[1]:
            return False          # nothing a list row shows changed
        st.latest = cur
        if st.sent is not None and st.sent[0] == cur[0] and st.sent[1] == cur[1]:
            st.dirty = False      # back to what was sent
            self._dirty.discard(sym)
            return False
        st.dirty = True
        self._dirty.add(sym)
        return True

    def flush(self, now: Optional[float] = None) -> int:
        """Emit every dirty symbol whose interval has passed; arm one timer for the earliest held one."""
        if not self._dirty:
            return 0
        now = self._mono() if now is None else now
        emitted = 0
        wait = None
        for sym in list(self._dirty):
            st = self._syms.get(sym)
            if st is None or not st.dirty or st.latest is None:
                self._dirty.discard(sym)
                continue
            if st.sent_at is None:
                due = 0.0
            else:
                price_moved = st.sent is None or st.latest[0] != st.sent[0]
                gap = self.min_interval if price_moved else self.volume_interval
                due = st.sent_at + gap - now
            if due <= 1e-9:
                self._emit(sym, st, now)
                emitted += 1
            else:
                self.counters["held"] += 1
                wait = due if wait is None else min(wait, due)
        if wait is not None:
            self._arm(wait)
        return emitted

    def _emit(self, sym: str, st: _Sym, now: float) -> None:
        price, vol, tms = st.latest
        frame = encode_frame(sym, price, vol, tms, int(self._wall_ms()))
        self.counters["serialised"] += 1
        st.frame, st.sent, st.sent_at, st.dirty = frame, st.latest, now, False
        self._dirty.discard(sym)
        subs = self._subs.get(sym, ())
        for c in subs:
            c._deliver(sym, frame)          # the SAME bytes object for every member
        self.counters["fanout"] += len(subs)

    # ── the one timer ────────────────────────────────────────────────────────

    def _arm(self, delay: float) -> None:
        if self._timer is not None or self._schedule is None:
            return
        self._timer = self._schedule(max(0.0, delay), self._fire)

    def _fire(self) -> None:
        self._timer = None
        try:
            self.flush()
        except Exception as e:  # noqa: BLE001 - a timer must never take the loop down
            log.warning("[quote_hub] flush failed: %s: %s", type(e).__name__, e)

    @staticmethod
    def _loop_schedule(delay: float, fn):
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return None
        return loop.call_later(delay, fn)

    def stats(self) -> dict:
        """Counters only: no symbols, no prices."""
        return {"connections": self._conns, "symbols": len(self._subs), "dirty": len(self._dirty),
                "max_hz": self.max_hz, "volume_interval_s": self.volume_interval, **self.counters}


_hub: Optional[QuoteHub] = None


def get_hub() -> QuoteHub:
    global _hub
    if _hub is None:
        _hub = QuoteHub()
    return _hub


def hub_for(bb, hub: Optional[QuoteHub] = None) -> Optional[QuoteHub]:
    """The hub fed by `bb`'s ingest batches, or None when `bb` has no price sink (local mode: the
    in-process BarBroadcaster). Installs the hub as the sink on first use."""
    if bb is None or not hasattr(bb, "quote_sink"):
        return None
    h = hub if hub is not None else get_hub()
    if getattr(bb, "quote_sink", None) != h.on_prices:
        bb.quote_sink = h.on_prices
    return h
