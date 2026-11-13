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
import time
from bisect import bisect_left
from typing import Callable, Iterable, Optional

_logger = logging.getLogger(__name__)

_WS_URL = os.environ.get("MASSIVE_WS_URL", "wss://socket.massive.com/stocks")
_API_KEY = os.environ.get("MASSIVE_API_KEY", "")

# State (module globals — single connection per process by design)
_active: set[str] = set()              # symbols currently subscribed
_pending_subscribe: set[str] = set()   # queued for next send (when ws live)
_pending_unsubscribe: set[str] = set()
# Owner refcount: a symbol is protocol-subscribed while ANY owner wants it, and
# only unsubscribed when its last owner drops it. Lets independent consumers (the
# chart bars feed, owner "bars"; the NH/NL print-exact tap, owner "nhnl") share the
# one connection without one's unsubscribe cutting the other's feed.
_sub_owners: dict[str, set[str]] = {}
_state_lock = threading.Lock()

# Extra per-trade listeners (beyond the primary on_bar). Only T. events fan out to
# these; the list is empty (zero cost) unless a consumer registers one. Used by the
# NH/NL scanner to count every print without a second WebSocket connection.
_trade_listeners: list = []             # list[Callable[[str, dict], None]]

_ws_loop: Optional[asyncio.AbstractEventLoop] = None
_ws_connection = None
_running = False

# ── Feed-load instrumentation (measurement-only, zero effect on the feed) ──────
# Per-channel message + byte counters so we can measure the REAL cost of the live
# feed (and project what adding an A.* aggregate consumer for the volume scanner
# would add) without a second connection or any subscription change. Incremented
# on the WS thread; read via get_status(). Plain ints (GIL-atomic enough for a
# monitor); reset_feed_counters() starts a clean measurement window.
_feed_counts = {"A": 0, "AM": 0, "T": 0}
_feed_bytes = 0
_feed_frames = 0
_feed_since = time.time()

# ── Liveness + stall diagnosis (2026-10-14) ──────────────────────────────────
# The library keepalive (ping every 30 s, close if no pong within 30 s) dropped the
# socket at 15:37:57 and 16:00:27 ET with the universe feed on. A pong travels in the
# same TCP stream as the data, so whenever this loop falls behind the inbound frames
# (or is starved of the GIL) the pong waits behind them and the library declares a
# live connection dead. Every drop costs a reconnect and a bucket the stream did not
# see whole. So the decision moved here: the socket is dead only when NEITHER a data
# frame NOR a pong has arrived for LIVENESS_S of time this loop was actually running.
# A stall of the loop itself is measured (max, count, and the WS thread's stack while
# it is stalled) instead of being mistaken for a dead peer.
LIVENESS_S = float(os.environ.get("BAR_STREAM_LIVENESS_S", "90"))
_PING_EVERY_S = 10.0
#: The WS loop is "stalled" when its 0.5 s beat is this late.
_STALL_S = float(os.environ.get("BAR_STREAM_STALL_S", "3"))
_loop_beat_mono: Optional[float] = None
_ws_thread_ident: Optional[int] = None
_stall = {"count": 0, "max_s": 0.0, "last_s": 0.0, "last_at": None, "dumps": 0}
_liveness = {"pongs": 0, "dead_closes": 0, "last_pong_rtt_ms": None}
#: Minute-bar delivery lag (receipt time minus the minute's end), current minute window.
_am_lag = {"window_start": 0.0, "max_ms": 0, "prev_window_max_ms": 0, "worst_ms": 0}

# ── Ingest telemetry (2026-11-13, measurement-only) ─────────────────────────────
# Answers ONE question in production: is live-price lag a LOCAL consumer backlog
# (this loop starved of the GIL, frames piling up in kernel/upstream buffers once
# websockets' max_queue pauses reads) or an UPSTREAM delay? Per wall-clock minute:
#   trade_lag_ms  now - T.t, taken when the event is processed
#   recv_lag_ms   frame-dequeue time - T.t (the moment `async for` handed us the frame)
#   idle_s/busy_s time awaiting the next frame vs processing frames; busy_ratio -> 1
#                 means the consumer never waits, i.e. it is the bottleneck
#   busy_cpu_s    time.thread_time() over the busy slices; busy_cpu_over_wall far
#                 below 1 means the thread was runnable but waiting for the GIL
#   recv_queue    library receive-queue depth at dequeue (max) + frames dequeued
#                 while the library had paused socket reads
#   events        per-minute arrival counts per ev type (feed.msgs_per_sec is since boot)
# Hot-path cost: plain int/float updates + one bisect per T event; no locks, no logs.
# Lag percentiles come from fixed buckets: p50/p90 are the bucket's upper edge (ms),
# capped at the observed max, so they are "<=" bounds, never sorted samples.
# Clock skew: a T.t ahead of this pod's clock gives a NEGATIVE lag; it lands in
# bucket 0 and max/p50/p90 can then read negative (a skew signal, not an error).
_LAG_EDGES_MS = (100, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000,
                 30000, 45000, 60000, 90000, 120000, 180000, 300000)


def _new_hist() -> dict:
    return {"n": 0, "max": None, "b": [0] * (len(_LAG_EDGES_MS) + 1)}


def _new_ingest_window(minute) -> dict:
    return {"minute": minute, "frames": 0, "events": {"A": 0, "AM": 0, "T": 0},
            "trade": _new_hist(), "recv": _new_hist(),
            "idle_s": 0.0, "busy_s": 0.0, "busy_cpu_s": 0.0, "await_cpu_s": 0.0,
            "q_max": None, "paused_frames": 0}


_ing_cur = _new_ingest_window(None)
_ing_prev: Optional[dict] = None
_ing_recv_ms = 0.0          # wall ms at which the frame being processed was dequeued
_ing_queue_source = "unavailable"

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
    universe = _universe_stream_enabled()
    for s in sorted(syms):
        if not universe:  # under the universe feed, AM.* already carries every symbol
            parts.append(f"AM.{s}")
        parts.append(f"A.{s}")
        parts.append(f"T.{s}")
    params = ",".join(parts)
    return json.dumps({"action": "subscribe", "params": params})


def _build_unsubscribe_message(syms: Iterable[str]) -> str:
    """Unsubscribe from AM.*, A.*, and T.* for each symbol (Phase 4.6)."""
    parts = []
    universe = _universe_stream_enabled()
    for s in sorted(syms):
        if not universe:  # never drop AM.<sym> out from under the AM.* wildcard
            parts.append(f"AM.{s}")
        parts.append(f"A.{s}")
        parts.append(f"T.{s}")
    params = ",".join(parts)
    return json.dumps({"action": "unsubscribe", "params": params})


def _universe_stream_enabled() -> bool:
    """Universe live bars (`bars_live_ingest`): subscribe AM.* for every ticker."""
    try:
        from api.services import bars_live_ingest
        return bars_live_ingest.enabled()
    except Exception:
        return False


def _build_auth_message(api_key: str) -> str:
    return json.dumps({"action": "auth", "params": api_key})


async def _run_websocket(on_bar: OnBarCallback) -> None:
    """Main reconnect loop. Returns only when the process exits."""
    global _ws_connection, _running, _feed_bytes, _feed_frames
    import websockets

    if not _API_KEY:
        _logger.warning("[bar_stream] MASSIVE_API_KEY not set — bar stream disabled")
        return


    backoff = 1
    while True:
        try:
            _logger.info("[bar_stream] Connecting to %s", _WS_URL)
            # Library keepalive OFF: `_liveness_watch` decides (see LIVENESS_S).
            async with websockets.connect(_WS_URL, ping_interval=None, ping_timeout=None) as ws:
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

                # Universe live bars: every minute bar for every ticker, rolled into 5m
                # and forwarded to the serving tier (`bars_live_ingest`). A new socket
                # starts a new epoch, so the tier re-backfills the gap it left.
                universe = _universe_stream_enabled()
                if universe:
                    from api.services import bars_live_ingest
                    bars_live_ingest.mark_connected()
                    bars_live_ingest.start_flusher(asyncio.get_running_loop())
                    await ws.send(json.dumps({"action": "subscribe", "params": "AM.*"}))
                    _logger.info("[bar_stream] universe feed: subscribed AM.*")

                _running = True
                backoff = 1

                # Concurrent tasks: drain pending sub/unsub queue + read messages
                drain_task = asyncio.create_task(_drain_pending_queue(ws))
                live_task = asyncio.create_task(_liveness_watch(ws))
                try:
                    async for raw_msg in _timed_frames(ws):
                        # Measurement: frame size + count (cheap; monitoring only).
                        try:
                            _feed_bytes += len(raw_msg)
                            _feed_frames += 1
                        except Exception:
                            pass
                        try:
                            payload = json.loads(raw_msg)
                        except json.JSONDecodeError:
                            continue
                        # Massive frames messages as a JSON array of events
                        events = payload if isinstance(payload, list) else [payload]
                        for ev in events:
                            if isinstance(ev, dict):
                                _ec = ev.get("ev")
                                if _ec in _feed_counts:
                                    _feed_counts[_ec] += 1
                                    _note_ingest_event(_ec, ev)
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
                            kind = parsed["kind"]
                            # T events carry "trade" dict; AM/A events carry "bar" dict
                            payload_dict = parsed["trade"] if kind == "T" else parsed["bar"]
                            if kind == "AM":
                                _note_am_lag(ev.get("e"))
                            if universe and kind == "AM":
                                try:
                                    bars_live_ingest.on_am(parsed["sym"], payload_dict)
                                except Exception as ing_err:
                                    _logger.debug("[bar_stream] universe ingest error: %s", ing_err)
                                # The wildcard delivers every ticker; only the ones a
                                # chart or owner subscribed reach the broadcaster.
                                if parsed["sym"] not in _active:
                                    continue
                            try:
                                on_bar(parsed["sym"], payload_dict, kind)
                            except Exception as cb_err:
                                _logger.warning("[bar_stream] on_bar callback error: %s", cb_err)
                            # Fan T. prints to any extra listeners (NH/NL print tap).
                            # Guard keeps this zero-cost when none are registered.
                            if kind == "T" and _trade_listeners:
                                for _lst in _trade_listeners:
                                    try:
                                        _lst(parsed["sym"], payload_dict)
                                    except Exception:
                                        pass
                finally:
                    _running = False
                    drain_task.cancel()
                    live_task.cancel()
        except Exception as e:
            _logger.warning("[bar_stream] disconnected: %s — reconnect in %ds", e, backoff)
            _running = False
            _ws_connection = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


def _note_am_lag(end_ms) -> None:
    try:
        lag = int(time.time() * 1000) - int(end_ms)
    except (TypeError, ValueError):
        return
    now = time.time()
    if now - _am_lag["window_start"] >= 60:
        _am_lag["prev_window_max_ms"] = _am_lag["max_ms"]
        _am_lag["max_ms"] = 0
        _am_lag["window_start"] = now
    if lag > _am_lag["max_ms"]:
        _am_lag["max_ms"] = lag
        if lag > _am_lag["worst_ms"]:
            _am_lag["worst_ms"] = lag


def _recv_queue_of(ws):
    """(queue, assembler, source) for the library's receive queue, or Nones.
    Private attributes, so every access is guarded; absent -> depth not reported."""
    try:  # websockets >= 14 asyncio implementation (prod runs 16.x)
        asm = ws.recv_messages
        q = asm.frames
        len(q)
        return q, asm, "websockets.recv_messages.frames"
    except Exception:  # noqa: BLE001
        pass
    try:  # legacy implementation (websockets < 14)
        q = ws.messages
        len(q)
        return q, None, "websockets.legacy.messages"
    except Exception:  # noqa: BLE001
        return None, None, "unavailable"


async def _timed_frames(ws):
    """Yield ws's frames unchanged while timing the consumer (measurement only).
    Time between asking for a frame and getting it = idle; time from handing a frame
    to the loop body until it asks for the next = busy (the body never awaits)."""
    global _ing_cur, _ing_prev, _ing_recv_ms, _ing_queue_source
    q, asm, _ing_queue_source = _recv_queue_of(ws)
    mono, cpu, wall = time.monotonic, time.thread_time, time.time
    t_wait, c_wait = mono(), cpu()
    async for raw in ws:
        t_got, c_got, now = mono(), cpu(), wall()
        w = _ing_cur
        m = int(now // 60)
        if m != w["minute"]:
            _ing_prev, w = w, _new_ingest_window(m)
            _ing_cur = w
        _ing_recv_ms = now * 1000.0
        w["frames"] += 1
        w["idle_s"] += t_got - t_wait
        w["await_cpu_s"] += c_got - c_wait
        if q is not None:
            try:
                d = len(q)
                if w["q_max"] is None or d > w["q_max"]:
                    w["q_max"] = d
                if asm is not None and asm.paused:
                    w["paused_frames"] += 1
            except Exception:  # noqa: BLE001
                q = None
        yield raw
        t_wait, c_wait = mono(), cpu()
        w["busy_s"] += t_wait - t_got
        w["busy_cpu_s"] += c_wait - c_got


def _hist_add(h: dict, v: float) -> None:
    # Order matters: get_status() reads from another thread, so max and the bucket
    # are written BEFORE n — a reader that sees n > 0 always sees a max.
    if h["max"] is None or v > h["max"]:
        h["max"] = v
    h["b"][bisect_left(_LAG_EDGES_MS, v)] += 1
    h["n"] += 1


def _note_ingest_event(ec, ev, now_ms: Optional[float] = None) -> None:
    """Per-minute arrival count by ev type, plus trade/receive lag for T events.
    A T event without a usable numeric `t` is counted but never enters the lag stats."""
    w = _ing_cur
    w["events"][ec] += 1
    if ec != "T":
        return
    try:
        t = float(ev["t"])
        if t != t:  # NaN
            return
        if now_ms is None:
            now_ms = time.time() * 1000.0
        _hist_add(w["trade"], now_ms - t)
        _hist_add(w["recv"], _ing_recv_ms - t)
    except Exception:  # noqa: BLE001 — missing/garbage t is ignored, never raises
        return


def _hist_summary(h: dict) -> dict:
    n, mx = h["n"], h["max"]
    if not n or mx is None:  # mid-update read from another thread reads as empty
        return {"n": 0, "max": None, "p50": None, "p90": None}
    b = list(h["b"])

    def pct(p):
        need, acc = max(1, -(-n * p // 100)), 0
        for i, c in enumerate(b):
            acc += c
            if acc >= need:
                return round(min(_LAG_EDGES_MS[i], mx)) if i < len(_LAG_EDGES_MS) else round(mx)
        return round(mx)
    return {"n": n, "max": round(mx), "p50": pct(50), "p90": pct(90)}


def _ingest_window_summary(w: Optional[dict]) -> dict:
    if w is None:
        w = _new_ingest_window(None)
    idle, busy, cpu = w["idle_s"], w["busy_s"], w["busy_cpu_s"]
    return {
        "frames": w["frames"],
        "events": dict(w["events"]),
        "trade_lag_ms": _hist_summary(w["trade"]),
        "recv_lag_ms": _hist_summary(w["recv"]),
        "idle_s": round(idle, 3),
        "busy_s": round(busy, 3),
        "busy_ratio": round(busy / (idle + busy), 3) if idle + busy > 0 else None,
        "busy_cpu_s": round(cpu, 3),
        "busy_cpu_over_wall": round(cpu / busy, 3) if busy > 0 else None,
        "await_cpu_s": round(w["await_cpu_s"], 3),
        "recv_queue_max": w["q_max"],
        "frames_read_paused": w["paused_frames"],
    }


def _ingest_status(now: Optional[float] = None) -> dict:
    """this_minute / last_minute views keyed on the wall-clock minute. Read-only: a
    minute with no frames reads as empty instead of showing a stale window."""
    m = int((time.time() if now is None else now) // 60)
    cur, prev = _ing_cur, _ing_prev
    if cur["minute"] == m:
        this, last = cur, (prev if prev is not None and prev["minute"] == m - 1 else None)
    elif cur["minute"] == m - 1:
        this, last = None, cur
    else:
        this = last = None
    return {
        "minute_start": m * 60,
        "recv_queue_source": _ing_queue_source,
        "lag_bucket_edges_ms": list(_LAG_EDGES_MS),
        "this_minute": _ingest_window_summary(this),
        "last_minute": _ingest_window_summary(last),
    }


async def _liveness_watch(ws) -> None:
    """Close the socket only when it is really dead (see LIVENESS_S)."""
    pongs = [0]
    sent_at = [0.0]

    def _on_pong(fut) -> None:
        if not fut.cancelled() and fut.exception() is None:
            pongs[0] += 1
            _liveness["pongs"] += 1
            _liveness["last_pong_rtt_ms"] = round((time.monotonic() - sent_at[0]) * 1000)

    pending = None
    seen = (_feed_frames, 0)
    quiet = 0.0
    last = time.monotonic()
    while True:
        await asyncio.sleep(_PING_EVERY_S)
        now = time.monotonic()
        dt, last = now - last, now
        if pending is None or pending.done():
            try:
                sent_at[0] = now
                pending = await ws.ping()
                pending.add_done_callback(_on_pong)
            except Exception:
                return  # the socket is closing; the reader loop handles it
        progress = (_feed_frames, pongs[0])
        if progress != seen:
            seen, quiet = progress, 0.0
        elif dt < _PING_EVERY_S + _STALL_S:
            quiet += dt  # only time this loop was really running counts as silence
        if quiet >= LIVENESS_S:
            _liveness["dead_closes"] += 1
            _logger.warning("[bar_stream] no frame and no pong for %.0fs of running time; "
                            "closing the socket to reconnect", quiet)
            await ws.close()
            return


async def _loop_beat() -> None:
    """0.5 s heartbeat of the WS loop; a late beat is a measured stall."""
    global _loop_beat_mono
    _loop_beat_mono = time.monotonic()
    while True:
        await asyncio.sleep(0.5)
        now = time.monotonic()
        late = now - _loop_beat_mono - 0.5
        _loop_beat_mono = now
        if late >= _STALL_S:
            _stall["count"] += 1
            _stall["last_s"] = round(late, 2)
            _stall["last_at"] = time.time()
            _stall["max_s"] = max(_stall["max_s"], round(late, 2))
            _logger.warning("[bar_stream] WS loop stalled %.1fs", late)


def _stall_watch() -> None:
    """Separate OS thread: while the WS loop is stalled, record where it is stuck (its
    own stack) and where every other thread is, once per stall, at most once a minute."""
    import sys
    import traceback
    dumped_beat = None
    last_dump = 0.0
    while True:
        time.sleep(1.0)
        beat = _loop_beat_mono
        if beat is None or _ws_thread_ident is None:
            continue
        age = time.monotonic() - beat
        if age < _STALL_S or dumped_beat == beat or time.monotonic() - last_dump < 60:
            continue
        dumped_beat, last_dump = beat, time.monotonic()
        try:
            frames = sys._current_frames()
            names = {t.ident: t.name for t in threading.enumerate()}
            ws_stack = "".join(traceback.format_stack(frames.get(_ws_thread_ident)))[-2500:]
            others = []
            for tid, fr in frames.items():
                if tid == _ws_thread_ident:
                    continue
                code = fr.f_code
                others.append(f"{names.get(tid, tid)}@{code.co_filename.rsplit('/', 1)[-1]}:"
                              f"{fr.f_lineno}:{code.co_name}")
            _stall["dumps"] += 1
            _logger.warning("[bar_stream] WS loop stalled %.1fs so far. WS thread: %s | "
                            "other threads: %s", age, ws_stack, " | ".join(others)[:3000])
        except Exception as e:  # noqa: BLE001
            _logger.warning("[bar_stream] stall dump failed: %s", e)


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


def subscribe_symbols(symbols: Iterable[str], owner: str = "bars") -> None:
    """Thread-safe: register `owner`'s interest in `symbols`; a symbol is queued for
    a protocol subscribe only when it gains its FIRST owner. Flush happens via
    _drain_pending_queue. `owner` defaults to "bars" so existing callers are unchanged."""
    syms = {s.upper() for s in symbols}
    if not syms:
        return
    with _state_lock:
        newly_active = set()
        for s in syms:
            owners = _sub_owners.get(s)
            if owners is None:
                _sub_owners[s] = {owner}
                if s not in _active:
                    newly_active.add(s)
            else:
                owners.add(owner)
        if newly_active:
            _active.update(newly_active)
            _pending_subscribe.update(newly_active)
            _pending_unsubscribe.difference_update(newly_active)


def unsubscribe_symbols(symbols: Iterable[str], owner: str = "bars") -> None:
    """Thread-safe: drop `owner`'s interest; a symbol is queued for a protocol
    unsubscribe only when its LAST owner releases it. Flush via _drain_pending_queue."""
    syms = {s.upper() for s in symbols}
    if not syms:
        return
    with _state_lock:
        now_gone = set()
        for s in syms:
            owners = _sub_owners.get(s)
            if not owners:
                continue
            owners.discard(owner)
            if not owners:
                _sub_owners.pop(s, None)
                if s in _active:
                    now_gone.add(s)
        if now_gone:
            _active.difference_update(now_gone)
            _pending_unsubscribe.update(now_gone)
            _pending_subscribe.difference_update(now_gone)


def add_trade_listener(fn) -> None:
    """Register an extra per-trade callback fn(sym, trade_dict) for T. events.
    Idempotent. The listener runs on the WS event-loop thread — keep it minimal and
    exception-safe; a raise is swallowed so it can never break the bars path."""
    if fn not in _trade_listeners:
        _trade_listeners.append(fn)


def remove_trade_listener(fn) -> None:
    try:
        _trade_listeners.remove(fn)
    except ValueError:
        pass


def get_active_symbols() -> list[str]:
    with _state_lock:
        return sorted(_active)


def reset_feed_counters() -> None:
    """Start a clean measurement window (per-channel counts + bytes)."""
    global _feed_bytes, _feed_frames, _feed_since
    for k in _feed_counts:
        _feed_counts[k] = 0
    _feed_bytes = 0
    _feed_frames = 0
    _feed_since = time.time()


def get_status() -> dict:
    with _state_lock:
        active_n = len(_active)
    elapsed = max(1e-6, time.time() - _feed_since)
    total_msgs = sum(_feed_counts.values())
    return {
        "connected": _running,
        "ws_url": _WS_URL,
        "active_count": active_n,
        "active_symbols": sorted(_active)[:50],
        # Feed-load measurement over the current window (since boot / last reset).
        "feed": {
            "window_secs": round(elapsed, 1),
            "active_symbols": active_n,
            "frames": _feed_frames,
            "bytes": _feed_bytes,
            "bytes_per_sec": round(_feed_bytes / elapsed),
            "msgs": dict(_feed_counts),
            "msgs_per_sec": {k: round(v / elapsed, 1) for k, v in _feed_counts.items()},
            "total_msgs_per_sec": round(total_msgs / elapsed, 1),
            # Per-symbol A-rate (the aggregate channel the volume push would use) —
            # the number to project the 300-name cost from.
            "a_msgs_per_sym_per_sec": round(_feed_counts["A"] / elapsed / active_n, 3) if active_n else None,
        },
        "universe": _universe_status(),
        "loop_stalls": dict(_stall),
        "liveness": dict(_liveness),
        "am_lag_ms": {"this_minute_max": _am_lag["max_ms"],
                      "last_minute_max": _am_lag["prev_window_max_ms"],
                      "worst": _am_lag["worst_ms"]},
        "ingest": _ingest_status(),
    }


def _universe_status() -> dict:
    try:
        from api.services import bars_live_ingest
        return bars_live_ingest.status()
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


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
        global _ws_loop, _ws_thread_ident
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _ws_loop = loop
        _ws_thread_ident = threading.get_ident()
        loop.create_task(_loop_beat())
        loop.run_until_complete(_run_websocket(on_bar))

    threading.Thread(target=_thread_target, daemon=True, name="bar-stream").start()
    threading.Thread(target=_stall_watch, daemon=True, name="bar-stream-stallwatch").start()
    _logger.info("[bar_stream] thread started")


def subscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_first_subscribe."""
    subscribe_symbols([symbol])


def unsubscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_last_unsubscribe."""
    unsubscribe_symbols([symbol])
