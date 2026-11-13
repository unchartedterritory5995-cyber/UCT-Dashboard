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
- subscribe_symbols(syms, owner, channels) / unsubscribe_symbols(syms, owner) are
  thread-safe entry points, refcounted per (symbol, channel) across owners
  (channels honoured only with STREAM_SCOPED_CHANNELS=1; off = every channel)
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
_active: set[str] = set()              # symbols subscribed on at least one channel
# Per-channel protocol state: sym -> the channels ("AM"/"A"/"T") currently wanted
# upstream, i.e. the UNION of every owner's channels for that symbol.
_active_channels: dict[str, set[str]] = {}
# Queued for next send (when ws live): sym -> channels to subscribe / unsubscribe.
_pending_subscribe: dict[str, set[str]] = {}
_pending_unsubscribe: dict[str, set[str]] = {}
# Owner refcount, PER CHANNEL: sym -> {owner: channels}. A symbol is subscribed on a
# channel while ANY owner needs that channel, and a channel is unsubscribed only
# when its last owner releases it. Lets independent consumers (the chart bars feed,
# owner "bars"; the NH/NL print-exact tap, owner "nhnl"; the volume push, owner
# "volume") share the one connection without one's release narrowing another's feed.
_sub_owners: dict[str, dict[str, frozenset[str]]] = {}
_state_lock = threading.Lock()

# ── Owner-scoped channels (STREAM_SCOPED_CHANNELS) ───────────────────────────
# Wire order of the channels for one symbol. Fixed so the messages stay
# byte-identical to the pre-scoping builder (AM.X,A.X,T.X per symbol, sorted).
_CHANNEL_ORDER = ("AM", "A", "T")
#: Every channel: what each owner got before owner scoping existed.
CHANNELS_FULL: frozenset[str] = frozenset(_CHANNEL_ORDER)
#: Aggregates only (AM + per-second A), no per-trade T. AM is dropped on the wire
#: whenever the universe AM.* wildcard is on, exactly as before.
CHANNELS_AGGREGATE: frozenset[str] = frozenset({"AM", "A"})


def _scoped_channels_enabled() -> bool:
    """STREAM_SCOPED_CHANNELS=1: each owner gets only the channels it declares.
    Unset/0 (default): every owner gets CHANNELS_FULL, i.e. exactly today's messages."""
    return os.environ.get("STREAM_SCOPED_CHANNELS", "0") == "1"

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


def _wire_parts(entries, universe: bool) -> list[str]:
    """`CH.SYM` params for `entries`, in wire order: symbols sorted, then AM, A, T.

    `entries` is either an iterable of symbols (every channel, the pre-scoping
    shape) or a mapping sym -> channels (owner-scoped). Under the universe feed
    AM.<sym> is never sent: the AM.* wildcard already carries every symbol, and an
    AM.<sym> unsubscribe must never be sent out from under it."""
    # Local import: keeps this PR off the module import block (PR #1183 edits it).
    from collections.abc import Mapping
    if isinstance(entries, Mapping):
        pairs = [(s, entries[s]) for s in sorted(entries)]
    else:
        pairs = [(s, CHANNELS_FULL) for s in sorted(entries)]
    parts = []
    for s, chans in pairs:
        for ch in _CHANNEL_ORDER:
            if ch not in chans or (ch == "AM" and universe):
                continue
            parts.append(f"{ch}.{s}")
    return parts


def _channel_message(action: str, entries, universe: Optional[bool] = None) -> Optional[str]:
    """The subscribe/unsubscribe frame for `entries`, or None when nothing is left
    to send (e.g. only AM.<sym> changed while the universe wildcard is on)."""
    if universe is None:
        universe = _universe_stream_enabled()
    parts = _wire_parts(entries, universe)
    if not parts:
        return None
    return json.dumps({"action": action, "params": ",".join(parts)})


def _build_subscribe_message(syms, universe: Optional[bool] = None) -> str:
    """Polygon-compatible subscribe message.

    `syms` as a plain iterable subscribes AM.*, A.*, and T.* for each symbol (the
    pre-scoping shape). As a mapping sym -> channels it subscribes only those.

    Phase 4.5: includes A.<sym> alongside AM.<sym> so we receive per-second aggregates
    for sub-second chart flicker in addition to the authoritative 1-min closes.
    Phase 4.6: adds T.<sym> for per-trade tick events enabling true tick-by-tick updates.
    Example: AM.AAPL,A.AAPL,T.AAPL,AM.MSFT,A.MSFT,T.MSFT
    """
    if universe is None:
        universe = _universe_stream_enabled()
    params = ",".join(_wire_parts(syms, universe))
    return json.dumps({"action": "subscribe", "params": params})


def _build_unsubscribe_message(syms, universe: Optional[bool] = None) -> str:
    """Unsubscribe counterpart of _build_subscribe_message (same two input shapes)."""
    if universe is None:
        universe = _universe_stream_enabled()
    params = ",".join(_wire_parts(syms, universe))
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

                # Resubscribe whatever was active before the disconnect, channel by
                # channel (the per-channel union every owner currently needs).
                n_resub, resub_msg = _take_resubscribe_message()
                if resub_msg:
                    await ws.send(resub_msg)
                    _logger.info("[bar_stream] Resubscribed %d symbols on (re)connect", n_resub)

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

    Runs every 250 ms. Cheap because most ticks the queues are empty. The queues
    are sym -> channels; each flush sends one subscribe and one unsubscribe frame
    built per channel, and on a failed send re-queues only the channels that are
    still wanted (subscribe) or still unwanted (unsubscribe).
    """
    # KEEP this declaration. The re-queue paths now mutate the queue dicts in
    # place (`.setdefault(...).update(...)`), which needs no `global`. But an
    # earlier version re-queued with `_pending_subscribe |= ...` (augmented
    # assignment) and had no declaration: Python made both names function-LOCAL,
    # the first read raised UnboundLocalError, the task died silently and bars
    # never subscribed. The declaration means a future `|=` or `=` here cannot
    # bring that back. tests/test_bar_stream_drain_globals.py pins it.
    global _pending_subscribe, _pending_unsubscribe
    while True:
        await asyncio.sleep(0.25)
        with _state_lock:
            sub = {s: set(c) for s, c in _pending_subscribe.items()}
            unsub = {s: set(c) for s, c in _pending_unsubscribe.items()}
            _pending_subscribe.clear()
            _pending_unsubscribe.clear()
        universe = _universe_stream_enabled() if (sub or unsub) else False
        sub_msg = _channel_message("subscribe", sub, universe) if sub else None
        if sub_msg:
            try:
                await ws.send(sub_msg)
            except Exception as e:
                _logger.warning("[bar_stream] subscribe flush failed: %s", e)
                with _state_lock:
                    # Fix 4: only re-queue channels still wanted
                    for s, chans in sub.items():
                        keep = chans & _active_channels.get(s, set())
                        if keep:
                            _pending_subscribe.setdefault(s, set()).update(keep)
                return  # Fix 3: stop retrying on dead ws; reconnect loop starts fresh drain task
        unsub_msg = _channel_message("unsubscribe", unsub, universe) if unsub else None
        if unsub_msg:
            try:
                await ws.send(unsub_msg)
            except Exception as e:
                _logger.warning("[bar_stream] unsubscribe flush failed: %s", e)
                with _state_lock:
                    # Fix 4: only re-queue channels still unwanted
                    for s, chans in unsub.items():
                        keep = chans - _active_channels.get(s, set())
                        if keep:
                            _pending_unsubscribe.setdefault(s, set()).update(keep)
                return  # Fix 3: stop retrying on dead ws; reconnect loop starts fresh drain task


def _take_resubscribe_message() -> tuple[int, Optional[str]]:
    """On (re)connect: clear the pending queues (Massive does not persist subs, so the
    full state is resent) and build ONE subscribe frame carrying, per symbol, exactly
    the channels the owners currently need. Returns (symbol count, frame or None)."""
    with _state_lock:
        snapshot = {s: set(c) for s, c in _active_channels.items() if c}
        _pending_subscribe.clear()
        _pending_unsubscribe.clear()
    if not snapshot:
        return 0, None
    return len(snapshot), _channel_message("subscribe", snapshot)


def _normalize_channels(channels: Optional[Iterable[str]]) -> frozenset[str]:
    """The channels an owner actually gets. Flag off: always CHANNELS_FULL (exactly
    the pre-scoping behaviour, whatever the owner declares). Flag on: the declared
    set, or CHANNELS_FULL when the caller declares none."""
    if channels is None:
        declared = CHANNELS_FULL
    else:
        declared = frozenset(str(c).upper() for c in channels)
        unknown = declared - CHANNELS_FULL
        if unknown or not declared:
            raise ValueError(f"bar_stream channels must be a non-empty subset of "
                             f"{sorted(CHANNELS_FULL)}; got {sorted(declared)}")
    if not _scoped_channels_enabled():
        return CHANNELS_FULL
    return declared


def _reconcile_locked(sym: str) -> None:
    """Caller holds _state_lock. Recompute `sym`'s wanted channels as the union over
    its owners and queue only the per-channel difference against what is subscribed."""
    owners = _sub_owners.get(sym)
    want: set[str] = set().union(*owners.values()) if owners else set()
    have = _active_channels.get(sym, set())
    added = want - have
    removed = have - want
    if added:
        _pending_subscribe.setdefault(sym, set()).update(added)
        left = _pending_unsubscribe.get(sym)
        if left is not None:
            left -= added
            if not left:
                del _pending_unsubscribe[sym]
    if removed:
        _pending_unsubscribe.setdefault(sym, set()).update(removed)
        left = _pending_subscribe.get(sym)
        if left is not None:
            left -= removed
            if not left:
                del _pending_subscribe[sym]
    if want:
        _active_channels[sym] = want
        _active.add(sym)
    else:
        _active_channels.pop(sym, None)
        _active.discard(sym)


def subscribe_symbols(symbols: Iterable[str], owner: str = "bars",
                      channels: Optional[Iterable[str]] = None) -> None:
    """Thread-safe: register `owner`'s interest in `symbols` on `channels`.

    A symbol is subscribed on a channel while ANY owner needs that channel, so only
    channels the symbol does not already carry are queued. Calling again for the same
    (symbol, owner) replaces that owner's channel set. `channels` defaults to every
    channel; with STREAM_SCOPED_CHANNELS off every owner gets every channel, which
    reproduces the pre-scoping messages byte for byte. Flush via _drain_pending_queue."""
    syms = {s.upper() for s in symbols}
    if not syms:
        return
    chans = _normalize_channels(channels)
    with _state_lock:
        for s in syms:
            _sub_owners.setdefault(s, {})[owner] = chans
            _reconcile_locked(s)


def unsubscribe_symbols(symbols: Iterable[str], owner: str = "bars") -> None:
    """Thread-safe: drop `owner`'s interest. A channel is queued for a protocol
    unsubscribe only when no remaining owner needs it, so releasing one owner never
    narrows another owner's channels. Flush via _drain_pending_queue."""
    syms = {s.upper() for s in symbols}
    if not syms:
        return
    with _state_lock:
        for s in syms:
            owners = _sub_owners.get(s)
            if not owners or owner not in owners:
                continue
            del owners[owner]
            if not owners:
                del _sub_owners[s]
            _reconcile_locked(s)


def get_channel_counts() -> dict:
    """Read-only: how many symbols are subscribed on each channel, and each owner's
    symbol count + channels. Lets the STREAM_SCOPED_CHANNELS flip be verified live
    (the T count should fall to the symbols the T-owning owners hold)."""
    with _state_lock:
        per_channel = {ch: sum(1 for c in _active_channels.values() if ch in c)
                       for ch in _CHANNEL_ORDER}
        owners: dict[str, dict] = {}
        for owned in _sub_owners.values():
            for o, c in owned.items():
                row = owners.setdefault(o, {"symbols": 0, "channels": set()})
                row["symbols"] += 1
                row["channels"] |= c
    return {
        "scoped": _scoped_channels_enabled(),
        "symbols_per_channel": per_channel,
        "owners": {o: {"symbols": r["symbols"],
                       "channels": [ch for ch in _CHANNEL_ORDER if ch in r["channels"]]}
                   for o, r in sorted(owners.items())},
    }


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


#: Owner "bars" = the BarBroadcaster's refcounted interest. Every consumer that comes
#: in through the broadcaster (chart bars SSE, the live quote, Time & Sales via
#: add_interest, D3's add_interest) shares it, so it keeps every channel: T drives
#: the tick-by-tick developing bar, the last price and the T&S prints.
BARS_OWNER = "bars"
BARS_CHANNELS: frozenset[str] = CHANNELS_FULL


def subscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_first_subscribe."""
    subscribe_symbols([symbol], owner=BARS_OWNER, channels=BARS_CHANNELS)


def unsubscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_last_unsubscribe."""
    unsubscribe_symbols([symbol], owner=BARS_OWNER)
