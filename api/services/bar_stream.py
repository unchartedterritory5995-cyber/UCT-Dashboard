"""Real-time bar streaming via Massive WebSocket.

Connects to wss://socket.massive.com/stocks (Polygon-protocol-compatible),
authenticates with MASSIVE_API_KEY, subscribes to AM.<sym>, A.<sym>, and T.<sym>
channels for the lazy-managed active set, and forwards parsed events to a callback
(usually BarBroadcaster.push_aggregate).

Phase 4.5: subscribes to both AM.* (authoritative 1-min closes) and A.* (per-second
aggregates) so the chart's developing candle updates sub-second instead of once per
minute. The callback receives a third `kind` arg ("AM" or "A") so the broadcaster
can treat them differently.

Phase 4.6: also subscribes to T.* (per-trade ticks) for true tick-by-tick updates.
T events carry {sym, trade: {t, p, s}, kind: "T"} — NOT a bar dict, because trades
are not OHLCV aggregates. The broadcaster's push_aggregate branches on kind="T".

Lifecycle:
- start_stream(on_bar) launches a daemon thread running an asyncio event loop
- subscribe_symbols(syms) / unsubscribe_symbols(syms) are thread-safe entry points
- reconnect uses exponential backoff capped at 60s; on reconnect the full active
  set is resubscribed from scratch (Massive protocol does not persist subs)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from typing import Callable, Iterable, Optional

_logger = logging.getLogger(__name__)

_WS_URL = os.environ.get("MASSIVE_WS_URL", "wss://socket.massive.com/stocks")
_API_KEY = os.environ.get("MASSIVE_API_KEY", "")

# State (module globals — single connection per process by design)
_active: set[str] = set()              # symbols currently subscribed
_pending_subscribe: set[str] = set()   # queued for next send (when ws live)
_pending_unsubscribe: set[str] = set()
_state_lock = threading.Lock()

_ws_loop: Optional[asyncio.AbstractEventLoop] = None
_ws_connection = None
_running = False

OnBarCallback = Callable[[str, dict, str], None]  # (symbol, payload_dict, kind) -> None
# kind is "AM" (authoritative 1-min close), "A" (per-second aggregate), or "T" (per-trade tick)
# For AM/A: payload is a bar dict {t, o, h, l, c, v}
# For T: payload is a trade dict {t, p, s}

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


def parse_am_event(raw: dict) -> Optional[dict]:
    """Backward-compat wrapper around parse_aggregate_event for AM events only.

    Returns {sym, bar} (without the `kind` key) to preserve the original signature
    used by existing tests. New code should call parse_aggregate_event directly.
    """
    result = parse_aggregate_event(raw)
    if result is None or result["kind"] != "AM":
        return None
    return {"sym": result["sym"], "bar": result["bar"]}


class BarStreamClient:
    """Container for state — used in tests; in production we use module globals."""

    def __init__(self, ws_url: str = _WS_URL, api_key: str = _API_KEY):
        self.ws_url = ws_url
        self.api_key = api_key
        self.active: set[str] = set()
        self.pending_subscribe: set[str] = set()
        self.pending_unsubscribe: set[str] = set()

    def queue_subscribe(self, syms: Iterable[str]) -> None:
        new = {s.upper() for s in syms} - self.active
        self.active |= new
        self.pending_subscribe |= new
        self.pending_unsubscribe -= new  # cancel pending unsub if re-added

    def queue_unsubscribe(self, syms: Iterable[str]) -> None:
        gone = {s.upper() for s in syms} & self.active
        self.active -= gone
        self.pending_unsubscribe |= gone
        self.pending_subscribe -= gone


def _build_subscribe_message(syms: Iterable[str]) -> str:
    """Polygon-compatible subscribe message: subscribes to AM.*, A.*, and T.* for each symbol.

    Phase 4.5: includes A.<sym> alongside AM.<sym> so we receive per-second aggregates
    for sub-second chart flicker in addition to the authoritative 1-min closes.
    Phase 4.6: adds T.<sym> for per-trade tick events enabling true tick-by-tick updates.
    Example: AM.AAPL,A.AAPL,T.AAPL,AM.MSFT,A.MSFT,T.MSFT
    """
    parts = []
    for s in sorted(syms):
        parts.append(f"AM.{s}")
        parts.append(f"A.{s}")
        parts.append(f"T.{s}")
    params = ",".join(parts)
    return json.dumps({"action": "subscribe", "params": params})


def _build_unsubscribe_message(syms: Iterable[str]) -> str:
    """Unsubscribe from AM.*, A.*, and T.* for each symbol (Phase 4.6)."""
    parts = []
    for s in sorted(syms):
        parts.append(f"AM.{s}")
        parts.append(f"A.{s}")
        parts.append(f"T.{s}")
    params = ",".join(parts)
    return json.dumps({"action": "unsubscribe", "params": params})


def _build_auth_message(api_key: str) -> str:
    return json.dumps({"action": "auth", "params": api_key})


async def _run_websocket(on_bar: OnBarCallback) -> None:
    """Main reconnect loop. Returns only when the process exits."""
    global _ws_connection, _running
    import websockets

    if not _API_KEY:
        _logger.warning("[bar_stream] MASSIVE_API_KEY not set — bar stream disabled")
        return


    backoff = 1
    while True:
        try:
            _logger.info("[bar_stream] Connecting to %s", _WS_URL)
            async with websockets.connect(_WS_URL, ping_interval=30, ping_timeout=10) as ws:
                _ws_connection = ws

                # Auth handshake — block on auth_success before proceeding
                await ws.send(_build_auth_message(_API_KEY))
                try:
                    auth_resp_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    auth_resp = json.loads(auth_resp_raw)
                    events = auth_resp if isinstance(auth_resp, list) else [auth_resp]
                    auth_ok = any(
                        isinstance(ev, dict) and ev.get("ev") == "status" and ev.get("status") == "auth_success"
                        for ev in events
                    )
                    if not auth_ok:
                        msg = next((ev for ev in events if isinstance(ev, dict) and ev.get("ev") == "status"), {})
                        status_str = msg.get("status", "unknown")
                        if status_str == "connected":
                            # Massive often sends 'connected' before 'auth_success' — read one more frame.
                            auth_resp2_raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            auth_resp2 = json.loads(auth_resp2_raw)
                            events2 = auth_resp2 if isinstance(auth_resp2, list) else [auth_resp2]
                            auth_ok = any(
                                isinstance(ev, dict) and ev.get("ev") == "status" and ev.get("status") == "auth_success"
                                for ev in events2
                            )
                            if not auth_ok:
                                status_str = next(
                                    (ev.get("status", "unknown") for ev in events2 if isinstance(ev, dict) and ev.get("ev") == "status"),
                                    "unknown",
                                )
                                raise RuntimeError(f"Auth rejected after 'connected' frame: status={status_str!r}")
                        else:
                            raise RuntimeError(f"Auth rejected: status={status_str!r}")
                    _logger.info("[bar_stream] auth_success")
                except (asyncio.TimeoutError, json.JSONDecodeError, RuntimeError) as auth_err:
                    _logger.error("[bar_stream] auth handshake failed: %s — backing off 60s", auth_err)
                    _running = False
                    _ws_connection = None
                    await asyncio.sleep(60)
                    continue  # back to outer while True; async with closes ws cleanly

                # Resubscribe whatever was active before the disconnect.
                with _state_lock:
                    syms_to_resubscribe = sorted(_active)
                    _pending_subscribe.clear()
                    _pending_unsubscribe.clear()
                if syms_to_resubscribe:
                    await ws.send(_build_subscribe_message(syms_to_resubscribe))
                    _logger.info("[bar_stream] Resubscribed %d symbols on (re)connect", len(syms_to_resubscribe))

                _running = True
                backoff = 1

                # Concurrent tasks: drain pending sub/unsub queue + read messages
                drain_task = asyncio.create_task(_drain_pending_queue(ws))
                try:
                    async for raw_msg in ws:
                        try:
                            payload = json.loads(raw_msg)
                        except json.JSONDecodeError:
                            continue
                        # Massive frames messages as a JSON array of events
                        events = payload if isinstance(payload, list) else [payload]
                        for ev in events:
                            parsed = parse_aggregate_event(ev)
                            if parsed is None:
                                # Status events: routine per-subscription "success"
                                # acks arrive in bursts of up to ~133 (one per active
                                # symbol) on every resubscribe, and each _logger.info
                                # is a SYNCHRONOUS write on this WS EVENT-LOOP task —
                                # 10+/ms of it added latency to every request the pod
                                # served (seen in a congestion diagnosis). Log routine
                                # acks at DEBUG; keep real problems (auth/error) at INFO.
                                if isinstance(ev, dict) and ev.get("ev") == "status":
                                    _st = ev.get("status")
                                    if _st in ("success", "connected", "auth_success"):
                                        _logger.debug("[bar_stream] status: %s", _st)
                                    else:
                                        _logger.info("[bar_stream] status: %s (%s)",
                                                     _st, ev.get("message"))
                                continue
                            try:
                                kind = parsed["kind"]
                                # T events carry "trade" dict; AM/A events carry "bar" dict
                                payload_dict = parsed["trade"] if kind == "T" else parsed["bar"]
                                on_bar(parsed["sym"], payload_dict, kind)
                            except Exception as cb_err:
                                _logger.warning("[bar_stream] on_bar callback error: %s", cb_err)
                finally:
                    _running = False
                    drain_task.cancel()
        except Exception as e:
            _logger.warning("[bar_stream] disconnected: %s — reconnect in %ds", e, backoff)
            _running = False
            _ws_connection = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def _drain_pending_queue(ws) -> None:
    """Periodically flush queued subscribe/unsubscribe messages to the live WS.

    Runs every 250 ms. Cheap because most ticks the queues are empty.
    """
    # REQUIRED: the re-queue paths below do `_pending_subscribe |= ...` /
    # `_pending_unsubscribe |= ...` (augmented assignment). Without this global
    # declaration Python treats both names as function-LOCAL for the entire
    # scope, so the reads at the top of the loop (`sorted(_pending_subscribe)`)
    # raise UnboundLocalError on the drain task's very first tick — the task
    # dies silently and the subscribe queue NEVER flushes (bars never subscribe
    # when STREAM_BARS_ENABLED=1). Mirrors _run_websocket's global declaration.
    global _pending_subscribe, _pending_unsubscribe
    while True:
        await asyncio.sleep(0.25)
        with _state_lock:
            sub = sorted(_pending_subscribe)
            unsub = sorted(_pending_unsubscribe)
            _pending_subscribe.clear()
            _pending_unsubscribe.clear()
        if sub:
            try:
                await ws.send(_build_subscribe_message(sub))
            except Exception as e:
                _logger.warning("[bar_stream] subscribe flush failed: %s", e)
                with _state_lock:
                    _pending_subscribe |= (set(sub) & _active)  # Fix 4: only re-queue symbols still wanted
                return  # Fix 3: stop retrying on dead ws; reconnect loop starts fresh drain task
        if unsub:
            try:
                await ws.send(_build_unsubscribe_message(unsub))
            except Exception as e:
                _logger.warning("[bar_stream] unsubscribe flush failed: %s", e)
                with _state_lock:
                    _pending_unsubscribe |= (set(unsub) - _active)  # Fix 4: only re-queue symbols still unwanted
                return  # Fix 3: stop retrying on dead ws; reconnect loop starts fresh drain task


def subscribe_symbols(symbols: Iterable[str]) -> None:
    """Thread-safe: add symbols to the active set; flush happens via _drain_pending_queue."""
    syms = {s.upper() for s in symbols}
    if not syms:
        return
    with _state_lock:
        new = syms - _active
        _active.update(new)
        _pending_subscribe.update(new)
        _pending_unsubscribe.difference_update(new)


def unsubscribe_symbols(symbols: Iterable[str]) -> None:
    """Thread-safe: remove symbols from active set; flush happens via _drain_pending_queue."""
    syms = {s.upper() for s in symbols}
    with _state_lock:
        gone = syms & _active
        _active.difference_update(gone)
        _pending_unsubscribe.update(gone)
        _pending_subscribe.difference_update(gone)


def get_active_symbols() -> list[str]:
    with _state_lock:
        return sorted(_active)


def get_status() -> dict:
    return {
        "connected": _running,
        "ws_url": _WS_URL,
        "active_count": len(_active),
        "active_symbols": sorted(_active)[:50],
    }


def start_stream(on_bar: OnBarCallback) -> None:
    """Launch the WS thread. Safe to call once per process."""
    global _ws_loop
    if _ws_loop is not None:
        _logger.warning("[bar_stream] start_stream called twice — ignoring duplicate call")
        return

    # 🔴 SAME SLOT-THEFT AS FINNHUB, AND ALREADY A DOCUMENTED TRAP: CLAUDE.md
    # warns that `MASSIVE_WS_DRY_RUN=1` does NOT protect the connection slot
    # because "any local run with the prod key kicks production off the feed
    # (Massive allows ~1 conn/key)". That warning existed for weeks as a thing
    # to remember; remembering is what failed on 2026-08-10. Gated at the entry
    # point, not in the reconnect loop — see realtime_stream.start_stream.
    from api.services import vendor_socket_guard
    if vendor_socket_guard.refuse_if_local("massive-bars"):
        return

    def _thread_target():
        global _ws_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _ws_loop = loop
        loop.run_until_complete(_run_websocket(on_bar))

    threading.Thread(target=_thread_target, daemon=True, name="bar-stream").start()
    _logger.info("[bar_stream] thread started")


def subscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_first_subscribe."""
    subscribe_symbols([symbol])


def unsubscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_last_unsubscribe."""
    unsubscribe_symbols([symbol])
