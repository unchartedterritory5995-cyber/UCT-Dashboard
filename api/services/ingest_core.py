"""ingest_core: one Massive stocks WebSocket frame in, the same calls out.

Ingest-process PR1 (INGEST-PROCESS-DESIGN, 2026-11-13). This is the per-frame body of
`bar_stream._run_websocket`, moved here verbatim so that two hosts can run the exact
same code:

* today: the in-web bar_stream reader thread;
* next: the `stream-ingest` service (PR4), which must emit byte-identical bar frames.

`apply_frame` owns NO state. Everything it touches comes in through a `FrameContext`
that the host builds once per connection: the bar callback, the live `_active` set
(read, never mutated), the trade-listener list, the universe AM hook and the two
telemetry hooks. The golden tapes in tests/golden_tapes/ pin its output: every call
to on_bar / the trade listeners / the universe hook, plus every bar frame the
BarBroadcaster derives from them, byte for byte.

Hot path: this runs once per WS frame, on the reader loop that 11-13 RTH proved is
GIL-starved, so it binds every context field to a local once per frame and adds no
locks, no allocations beyond the old body's, and no logging on routine events.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional


OnBar = Callable[[str, dict, str], None]          # (sym, payload, kind) -> None

_AGGREGATE_EVENT_TYPES = frozenset({"AM", "A"})
_TRADE_EVENT_TYPE = "T"


def parse_aggregate_event(raw: dict) -> Optional[dict]:
    """Validate + normalize a Massive AM, A, or T event or return None.

    For AM/A events: returns {sym, bar: {t, o, h, l, c, v}, kind: "AM"|"A"}.
    For T events:   returns {sym, trade: {t, p, s}, kind: "T"}.

    Returns None for non-aggregate/non-trade events (status, Q, etc.) and events
    missing required fields. Caller should treat None as "skip silently".

    Phase 4.5: accepts ev=AM and ev=A (same OHLCV field layout).
    Phase 4.6: accepts ev=T (per-trade ticks); extracts p, s, t fields.
    """
    if not isinstance(raw, dict):
        return None
    ev = raw.get("ev")

    # T-event path (Phase 4.6)
    if ev == _TRADE_EVENT_TYPE:
        sym = raw.get("sym")
        if not sym:
            return None
        # Required: p (price), s (size), t (ms timestamp)
        if any(raw.get(k) is None for k in ("p", "s", "t")):
            return None
        return {
            "sym": sym,
            "trade": {
                "t": raw["t"],
                "p": raw["p"],
                "s": raw["s"],
                # SIP sale-condition codes (Polygon `c`). Carried so the broadcaster
                # can drop ghost prints (odd-lot / out-of-sequence / form-T / average-
                # priced) from the developing candle's high/low + last — matching how
                # TC2000/TradingView filter the consolidated tape. Absent on some feeds
                # → treated as a plain regular trade (fully eligible).
                "c": raw.get("c"),
            },
            "kind": "T",
        }

    # AM/A aggregate path (Phase 4.5)
    if ev not in _AGGREGATE_EVENT_TYPES:
        return None
    sym = raw.get("sym")
    if not sym:
        return None
    required = ("o", "h", "l", "c", "v", "s")
    if any(raw.get(k) is None for k in required):
        return None
    return {
        "sym": sym,
        "bar": {
            "t": raw["s"],
            "o": raw["o"],
            "h": raw["h"],
            "l": raw["l"],
            "c": raw["c"],
            "v": raw["v"],
            # av = today's ACCUMULATED (cumulative day) volume — authoritative,
            # unlike summing T-tick sizes (which drifts on reconnects). Carried so
            # the quote feed can serve a live-ticking Volume column. May be absent.
            "av": raw.get("av"),
        },
        "kind": ev,  # "AM" or "A"
    }


@dataclass
class FrameContext:
    """What one frame's processing may touch. Built once per connection."""
    on_bar: OnBar
    #: Symbols a chart / owner subscribed (the live set object; read-only here).
    active: set
    #: Extra per-trade listeners (the NH/NL print tap). Live list; empty = zero cost.
    trade_listeners: list
    #: Universe AM.* wildcard on for this connection.
    universe: bool = False
    #: Universe hook for every AM event (bars_live_ingest.on_am); None when off.
    on_universe_am: Optional[Callable[[str, dict], None]] = None
    #: Per-event telemetry for AM/A/T (feed counters + ingest lag); None = skip.
    count_event: Optional[Callable[[str, dict], None]] = None
    #: AM delivery-lag telemetry, given the event's `e` (minute end ms); None = skip.
    note_am_lag: Optional[Callable[[object], None]] = None
    #: Every NON-routine status event's `status` (e.g. "max_connections" when another
    #: connection kicks this one); None = skip. stream-ingest's reconnect policy.
    on_status: Optional[Callable[[object], None]] = None
    logger: logging.Logger = field(default_factory=lambda: logging.getLogger("api.services.bar_stream"))
    #: HOT STANDBY: `first(ev) -> bool`, False for an AM/A/T event another connection already
    #: delivered (EventDedup). None (one connection) = every event is applied, as before.
    dedup: Optional[Callable[[dict], bool]] = None


#: ev types the telemetry counts (bar_stream._feed_counts keys).
COUNTED_EVENTS = frozenset({"A", "AM", "T"})


# ── HOT STANDBY: the same feed on two connections, applied once (2026-11-19) ────────────────────────
# Massive confirmed (support, 2026-11-19) that both of our stocks connections may carry the same
# channels at once. bar_stream runs two sockets with the same subscriptions when INGEST_HOT_STANDBY
# is on, so one dropping leaves the other delivering; every AM/A/T event then arrives TWICE and must
# be applied ONCE (a trade applied twice doubles its volume). The key is the event's identity AND its
# values: a duplicate is byte-for-byte the same event; an aggregate the vendor re-sends with corrected
# values for the same window is NOT a duplicate and is applied.
def dedup_key(ev) -> Optional[tuple]:
    """The duplicate key of an AM/A/T event, or None (status events, anything else: never dropped)."""
    if not isinstance(ev, dict):
        return None
    k = ev.get("ev")
    if k == _TRADE_EVENT_TYPE:
        return ("T", ev.get("sym"), ev.get("q"), ev.get("i"), ev.get("x"), ev.get("t"), ev.get("p"), ev.get("s"))
    if k in ("A", "AM"):
        return (k, ev.get("sym"), ev.get("s"), ev.get("e"), ev.get("o"), ev.get("h"), ev.get("l"), ev.get("c"), ev.get("v"))
    return None


class EventDedup:
    """`first(ev)`: True the first time an event is seen within `window_s` (by arrival time), False
    for its copy from the other connection. Two generations swapped every `window_s / 2`, so a key is
    remembered for between window/2 and window seconds and memory stays bounded by the event rate
    (the copies of one event arrive milliseconds apart, from the same vendor stream). Thread-safe
    enough for its single caller: both sockets run on bar_stream's one event loop."""

    def __init__(self, window_s: float = 10.0, monotonic: Callable[[], float] = time.monotonic):
        self.half = float(window_s) / 2.0
        self._mono = monotonic
        self._cur: set = set()
        self._prev: set = set()
        self._swap_at = self._mono() + self.half
        self.kept = 0
        self.dropped = 0

    def first(self, ev) -> bool:
        key = dedup_key(ev)
        if key is None:
            return True
        now = self._mono()
        if now >= self._swap_at + self.half:
            # a whole window with no rotation (a quiet feed): everything remembered is too old
            self._prev, self._cur = set(), set()
            self._swap_at = now + self.half
        elif now >= self._swap_at:
            self._prev, self._cur = self._cur, set()
            self._swap_at = now + self.half
        if key in self._cur or key in self._prev:
            self.dropped += 1
            return False
        self._cur.add(key)
        self.kept += 1
        return True

    def stats(self) -> dict:
        return {"kept": self.kept, "dropped": self.dropped, "remembered": len(self._cur) + len(self._prev)}


def apply_frame(raw_msg, ctx: FrameContext) -> int:
    """Process one raw WS frame. Returns the number of events in it (0 for bad JSON).

    Never raises for a bad frame or a failing callback: a bad frame is skipped, a
    callback error is logged (on_bar) or swallowed (listeners), exactly as before.
    """
    try:
        payload = json.loads(raw_msg)
    except json.JSONDecodeError:
        return 0
    # Massive frames messages as a JSON array of events
    events = payload if isinstance(payload, list) else [payload]
    on_bar = ctx.on_bar
    active = ctx.active
    listeners = ctx.trade_listeners
    universe = ctx.universe
    on_universe_am = ctx.on_universe_am
    count_event = ctx.count_event
    note_am_lag = ctx.note_am_lag
    logger = ctx.logger
    dedup = ctx.dedup
    for ev in events:
        # HOT STANDBY: the other connection already delivered this exact event (EventDedup).
        if dedup is not None and not dedup(ev):
            continue
        if isinstance(ev, dict):
            _ec = ev.get("ev")
            if _ec in COUNTED_EVENTS and count_event is not None:
                count_event(_ec, ev)
        parsed = parse_aggregate_event(ev)
        if parsed is None:
            # Status events: routine per-subscription "success" acks arrive in bursts
            # of up to ~133 (one per active symbol) on every resubscribe, and each
            # logger.info is a SYNCHRONOUS write on the WS event-loop task — 10+/ms of
            # it added latency to every request the pod served (seen in a congestion
            # diagnosis). Log routine acks at DEBUG; keep real problems (auth/error) at INFO.
            if isinstance(ev, dict) and ev.get("ev") == "status":
                _st = ev.get("status")
                if _st in ("success", "connected", "auth_success"):
                    logger.debug("[bar_stream] status: %s", _st)
                else:
                    logger.info("[bar_stream] status: %s (%s)", _st, ev.get("message"))
                    if ctx.on_status is not None:
                        try:
                            ctx.on_status(_st)
                        except Exception:  # noqa: BLE001 - a hook never breaks the frame loop
                            pass
            continue
        kind = parsed["kind"]
        sym = parsed["sym"]
        # T events carry "trade" dict; AM/A events carry "bar" dict
        payload_dict = parsed["trade"] if kind == "T" else parsed["bar"]
        if kind == "AM" and note_am_lag is not None:
            note_am_lag(ev.get("e"))
        if universe and kind == "AM":
            if on_universe_am is not None:
                try:
                    on_universe_am(sym, payload_dict)
                except Exception as ing_err:
                    logger.debug("[bar_stream] universe ingest error: %s", ing_err)
            # The wildcard delivers every ticker; only the ones a chart or owner
            # subscribed reach the broadcaster.
            if sym not in active:
                continue
        try:
            on_bar(sym, payload_dict, kind)
        except Exception as cb_err:
            logger.warning("[bar_stream] on_bar callback error: %s", cb_err)
        # Fan T. prints to any extra listeners (NH/NL print tap).
        # Guard keeps this zero-cost when none are registered.
        if kind == "T" and listeners:
            for _lst in listeners:
                try:
                    _lst(sym, payload_dict)
                except Exception:
                    pass
    return len(events)
