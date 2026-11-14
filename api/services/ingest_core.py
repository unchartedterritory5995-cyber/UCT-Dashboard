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
    logger: logging.Logger = field(default_factory=lambda: logging.getLogger("api.services.bar_stream"))


#: ev types the telemetry counts (bar_stream._feed_counts keys).
COUNTED_EVENTS = frozenset({"A", "AM", "T"})


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
    for ev in events:
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
