"""Pushed list prices: ONE price channel per symbol, serialised once, fanned out as shared bytes.

    Massive -> stream-ingest (per-trade last price, coalesced per batch: INGEST_BATCH_INTERVAL_S, 50 ms)
            -> RemoteBroadcaster.apply_batch (stream-edge / a quote-edge, or web in remote mode)
            -> QuoteHub.on_prices -> per symbol: one compact fragment per change, the SAME bytes object
               put in every member's pending map
            -> /api/stream/quotes (api/routers/quote_stream.py): one write per wake = ONE SSE message
               carrying every pending fragment

Why this shape (the PR that added this file: "Scale arithmetic" and "Latency budget"):
  * NOTHING IS HELD BY DEFAULT (owner target 2026-11-25: <= 40 ms p50 from a trade at our servers to the
    row painted). Ingest already coalesces each symbol to its latest price per batch, so a symbol changes at
    most once per batch (20 Hz at 50 ms). `QUOTE_STREAM_MAX_HZ` defaults to 0 = "every change leaves on the
    batch that brought it". Set it (e.g. 4) to cap a symbol's rate at a larger scale: then the first change
    after a quiet spell still leaves at once, a change inside the interval is held and the newest leaves
    when it ends (one timer, re-armed EARLIER when a sooner deadline appears). A volume-only change (same
    price) is held to `QUOTE_STREAM_VOLUME_INTERVAL_S` (1 s) in both modes: the Volume column ticks once a
    second, and every price frame carries the newest volume anyway.
  * SERIALISE ONCE. A change costs one small JSON encode however many members hold the symbol; a member
    costs a dict store per (member, change) and one write per wake. Encoding grows with SYMBOLS only.
  * FAN-OUT IS INLINE AND MINIMAL. It runs inside apply_batch (the feed's recv loop), so it is a plain loop:
    a dict store, and `Event.set()` only for a member's FIRST pending quote. Bars frames of the batch are
    queued before this runs (the sink is called after the mirror), so their writers wake first.
  * THE PER-CONNECTION BOUND IS STRUCTURAL: at most one pending fragment per symbol (newest replaces),
    so a member who stops reading costs len(symbols) references, never a growing queue.
  * ALL ON ONE EVENT LOOP: apply_batch and the SSE generators share the uvicorn loop; no lock, no hop.
  * MEASURED HERE: `stats()['hold_ms']` (how long the hub held a change: 0 by default) and
    `stats()['queue_ms']` (a member's first pending quote -> its write: the edge loop's queueing).

Wire: a fragment is `["AAPL",231.45,12345678,1732550000123]` (sym, price, day volume, trade time ms); one
write is `data: [<server write ms>,<fragment>,<fragment>,...]\\n\\n` (one EventSource `message`).
"""
from __future__ import annotations

import json
import logging
import math
import os
import time as _time
from collections import deque
from typing import Callable, Optional

log = logging.getLogger("api.services.quote_hub")


def _env_nonneg(name: str, default: float) -> float:
    try:
        v = float(os.environ.get(name, "") or default)
        return v if v >= 0 else default
    except ValueError:
        return default


#: Per symbol, at most this many frames a second; 0 (default) = every change leaves on its ingest batch.
DEFAULT_MAX_HZ = _env_nonneg("QUOTE_STREAM_MAX_HZ", 0.0)
#: A change of volume alone (same price) leaves at most once per this many seconds.
DEFAULT_VOLUME_INTERVAL_S = _env_nonneg("QUOTE_STREAM_VOLUME_INTERVAL_S", 1.0) or 1.0
#: How often every member's generator is woken for its heartbeat / status / disconnect checks.
TICK_S = 1.0
_SAMPLES = 1024


def encode_quote(sym: str, price, volume, trade_ms) -> bytes:
    """One quote's fragment, shared by every member's message. Compact: at scale this is the egress."""
    return json.dumps([sym, price, volume, trade_ms], separators=(",", ":")).encode("ascii")


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return x
    return None


def _pct(samples, p: float):
    """Nearest-rank percentile of `samples` (ms), or None."""
    if not samples:
        return None
    s = sorted(samples)
    return s[max(0, math.ceil(p / 100.0 * len(s)) - 1)]


class QuoteConn:
    """One member connection: its symbols, its pending fragments (at most one per symbol), its wake-up."""

    __slots__ = ("syms", "pending", "event", "first", "_hub")

    def __init__(self, syms, hub: "QuoteHub"):
        import asyncio
        self.syms = tuple(syms)
        self.pending: dict = {}
        self.event = asyncio.Event()
        self.first = None          # monotonic s when the pending map last went from empty to non-empty
        self._hub = hub

    def take(self) -> bytes:
        """Every pending fragment as ONE SSE message (one write, one browser event), and clear."""
        self.event.clear()
        if not self.pending:
            return b""
        hub = self._hub
        if self.first is not None:
            hub._queue_ms.append(round((hub._mono() - self.first) * 1000.0, 1))
            self.first = None
        out = b"data: [" + str(int(hub._wall_ms())).encode("ascii") + b"," + b",".join(self.pending.values()) + b"]\n\n"
        self.pending.clear()
        return out


class _Sym:
    __slots__ = ("latest", "sent", "sent_at", "frag", "dirty", "dirty_since")

    def __init__(self):
        self.latest = None       # (price, volume, trade_ms) offered last
        self.sent = None         # (price, volume, trade_ms) in the last fragment
        self.sent_at = None      # monotonic s of the last fragment
        self.frag = None         # the last fragment (a new member's snapshot)
        self.dirty = False
        self.dirty_since = None  # monotonic s of the first change not yet sent


class QuoteHub:
    def __init__(self, *, max_hz: Optional[float] = None, volume_interval_s: Optional[float] = None,
                 monotonic: Callable[[], float] = _time.monotonic,
                 wall_ms: Optional[Callable[[], int]] = None,
                 schedule="loop", tick_schedule="loop"):
        self.max_hz = float(DEFAULT_MAX_HZ if max_hz is None else max_hz)
        self.min_interval = 1.0 / self.max_hz if self.max_hz > 0 else 0.0
        self.volume_interval = float(volume_interval_s or DEFAULT_VOLUME_INTERVAL_S)
        self._mono = monotonic
        self._wall_ms = wall_ms or (lambda: int(_time.time() * 1000))
        # schedule(delay_s, fn) -> handle with .cancel(): "loop" = the running loop's call_later;
        # None = no timer (tests drive flush() themselves).
        self._schedule = self._loop_schedule if schedule == "loop" else schedule
        # the members' 1 s wake-up has its own scheduler (tests that drive `schedule` see only the hub timer)
        self._tick_schedule = self._loop_schedule if tick_schedule == "loop" else tick_schedule
        self._syms: dict = {}           # sym -> _Sym
        self._subs: dict = {}           # sym -> set[QuoteConn]
        self._conns: set = set()
        self._dirty: set = set()
        self._timer = None
        self._timer_due = None
        self._ticker = None
        self._hold_ms: deque = deque(maxlen=_SAMPLES)
        self._queue_ms: deque = deque(maxlen=_SAMPLES)
        self.counters = {"offers": 0, "serialised": 0, "fanout": 0, "held": 0, "snapshots": 0,
                         "opened": 0, "closed": 0}

    # ── members ──────────────────────────────────────────────────────────────

    def open(self, syms, snapshot: Optional[Callable[[str], Optional[dict]]] = None) -> QuoteConn:
        """Register a member for `syms` and put the current quote of each in its pending map at once
        (the hub's last fragment, else `snapshot(sym)`, the mirror's latest quote)."""
        conn = QuoteConn(syms, self)
        self._conns.add(conn)
        self.counters["opened"] += 1
        for sym in conn.syms:
            self._subs.setdefault(sym, set()).add(conn)
            st = self._syms.get(sym)
            if st is None:
                st = self._syms[sym] = _Sym()
            if st.frag is None and snapshot is not None:
                try:
                    q = snapshot(sym)
                except Exception:  # noqa: BLE001 - a snapshot is best-effort
                    q = None
                if q and self._accept(sym, st, q):
                    self._emit(sym, st, self._mono())      # to every member still without a first quote
                    self.counters["snapshots"] += 1
            if st.frag is not None and sym not in conn.pending:
                if not conn.pending:
                    conn.first = self._mono()
                    conn.event.set()
                conn.pending[sym] = st.frag
        self._start_ticker()
        return conn

    def close(self, conn: QuoteConn) -> None:
        if conn not in self._conns:
            return                       # release-once: a second close is a no-op
        self._conns.discard(conn)
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
        subs = self._subs
        for sym, q in prices.items():
            if sym in subs:
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
            st.dirty_since = None
            self._dirty.discard(sym)
            return False
        if not st.dirty:
            st.dirty = True
            st.dirty_since = self._mono()
        self._dirty.add(sym)
        return True

    def flush(self, now: Optional[float] = None) -> int:
        """Emit every dirty symbol that is due; arm one timer for the earliest held one."""
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
            self._arm(now, wait)
        return emitted

    def _emit(self, sym: str, st: _Sym, now: float) -> None:
        price, vol, tms = st.latest
        frag = encode_quote(sym, price, vol, tms)
        self.counters["serialised"] += 1
        self._hold_ms.append(round((now - (st.dirty_since if st.dirty_since is not None else now)) * 1000.0, 1))
        st.frag, st.sent, st.sent_at, st.dirty, st.dirty_since = frag, st.latest, now, False, None
        self._dirty.discard(sym)
        subs = self._subs.get(sym)
        if not subs:
            return
        for c in subs:                      # inline: this runs inside apply_batch
            p = c.pending
            if not p:
                c.first = now
                c.event.set()
            p[sym] = frag                   # the SAME bytes object for every member
        self.counters["fanout"] += len(subs)

    # ── timers ───────────────────────────────────────────────────────────────

    def _arm(self, now: float, delay: float) -> None:
        if self._schedule is None:
            return
        due_at = now + max(0.0, delay)
        if self._timer is not None:
            if self._timer_due is not None and self._timer_due <= due_at + 1e-9:
                return                       # the armed timer fires first anyway
            try:
                self._timer.cancel()         # a sooner deadline: move the timer EARLIER
            except Exception:  # noqa: BLE001
                pass
            self._timer = None
        self._timer = self._schedule(max(0.0, delay), self._fire)
        self._timer_due = due_at if self._timer is not None else None

    def _fire(self) -> None:
        self._timer = None
        self._timer_due = None
        try:
            self.flush()
        except Exception as e:  # noqa: BLE001 - a timer must never take the loop down
            log.warning("[quote_hub] flush failed: %s: %s", type(e).__name__, e)

    def _start_ticker(self) -> None:
        """One timer wakes EVERY member once a TICK_S (heartbeat, status, disconnect checks), so a
        generator awaits its event with no per-wake timeout."""
        if self._ticker is None and self._tick_schedule is not None and self._conns:
            self._ticker = self._tick_schedule(TICK_S, self._tick)

    @property
    def ticking(self) -> bool:
        """The 1 s member wake-up is armed (a generator may await its event with no timeout)."""
        return self._ticker is not None

    def _tick(self) -> None:
        self._ticker = None
        for c in self._conns:
            c.event.set()
        self._start_ticker()

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
        def dist(d):
            return {"n": len(d), "p50": _pct(d, 50), "p90": _pct(d, 90)}
        return {"connections": len(self._conns), "symbols": len(self._subs), "dirty": len(self._dirty),
                "max_hz": self.max_hz, "volume_interval_s": self.volume_interval,
                "hold_ms": dist(self._hold_ms), "queue_ms": dist(self._queue_ms), **self.counters}


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
