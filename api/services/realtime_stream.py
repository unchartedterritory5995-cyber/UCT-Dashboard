"""
Real-time price streaming via Finnhub WebSocket (primary) + Massive REST (fallback).

Connects to wss://ws.finnhub.io for tick-by-tick trade data and maintains
an in-memory price dict that the SSE endpoint fans out to frontend clients.

Falls back to Massive REST polling (2s interval) if WebSocket unavailable.
"""

import asyncio
import json
import logging
import os
import threading
import time
from collections import Counter

from api.services import trade_conditions

_logger = logging.getLogger(__name__)

# Finnhub WebSocket (free tier, real-time US equity trades)
_FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY", "")
_WS_URL = f"wss://ws.finnhub.io?token={_FINNHUB_KEY}" if _FINNHUB_KEY else ""

# In-memory price store: {SYM: {price, change_pct, volume, prev_close, timestamp, updated_at}}
_prices = {}
_lock = threading.Lock()

# Subscribed tickers — the EFFECTIVE set (count >= 1). Read by get_stream_status()
# and the WS reconnect re-subscribe loop; semantics are unchanged by refcounting.
_subscribed = set()
# Per-ticker refcount: how many SSE connections currently want this ticker.
# subscribe_tickers()/unsubscribe_tickers() only touch the upstream WS + _subscribed
# on a 0->1 / 1->0 transition, so overlapping connections (e.g. two SSE clients
# both watching AAPL) don't tear down the shared subscription when just one of
# them disconnects. See docs/superpowers/specs/2026-07-02-sse-connection-pooling-design.md
# "Amendment (final review)".
_sub_counts: Counter = Counter()
_ws_connection = None
_ws_loop = None
_running = False

# Per-ticker last-tick timestamp (epoch seconds) — feeds liveness probe + stale SSE event
_last_seen: dict[str, int] = {}


_STREAM_FIELDS = {"price", "change_pct", "change", "timestamp", "updated_at"}

# ── WS reconnect backoff / circuit-breaker (2026-08-05) ─────────────────────
# See _run_websocket's docstring for the full incident writeup. Cap the
# reconnect gap low in the NORMAL case: this is the live-quote feed, so a
# long backoff is a long visible quote freeze. 15s max (was 60s, then 15s —
# unchanged from before this fix for a run-of-the-mill blip).
_WS_BASE_BACKOFF_S = 1
_WS_MAX_BACKOFF_S = 15
# A connection must stay open this long before a subsequent drop is treated
# as "recovered, start over" rather than "continuation of the same failure
# storm" — see _ws_reconnect_transition's docstring for the bug this fixes
# (backoff resetting on a connect-then-immediate-kick pattern).
_WS_MIN_STABLE_CONNECT_S = 10
# Ceiling on consecutive non-stable failures before the loop concludes the
# account is being rejected persistently (not just blipping) and goes quiet
# for a real recovery window instead of retrying every _WS_MAX_BACKOFF_S
# forever.
_WS_MAX_CONSECUTIVE_FAILURES = 8
_WS_CIRCUIT_BREAKER_S = 120
# How often to re-check the shared Finnhub budget while a reconnect attempt
# is being withheld (fh_ws_reconnect_allowed() returned False).
_WS_BUDGET_POLL_S = 5


def get_realtime_prices(tickers=None):
    """Get latest prices from the stream.
    Returns dict of {SYM: {price, change_pct, change, timestamp, updated_at}}.

    prev_close is stripped — it starts seeded to trade_price on first tick, which
    would overwrite REST polling's correct prev_close value in the browser merge.
    REST polling owns prev_close; stream owns only the live tick fields.
    """
    with _lock:
        if tickers:
            raw = {s: _prices[s] for s in tickers if s in _prices}
        else:
            raw = dict(_prices)
    return {s: {k: v for k, v in d.items() if k in _STREAM_FIELDS} for s, d in raw.items()}


def get_stream_status():
    """Return WebSocket connection status."""
    return {
        "connected": _running,
        "provider": "finnhub" if _FINNHUB_KEY else "none",
        "subscribed_count": len(_subscribed),
        "prices_cached": len(_prices),
        "subscribed_tickers": sorted(_subscribed)[:50],
        "last_seen_ages": get_last_seen_ages(),
    }


def _record_tick(sym: str, price: float, ts: int) -> None:
    """Record a tick. Updates _last_seen and the existing _prices dict.

    Called from the WS message handler when a trade tick arrives, and exposed
    for tests and any future synthetic tick injection. Complements (does not
    replace) the richer prev_close-aware update in _process_finnhub_trade.

    Also feeds realtime_candle.apply_tick for every intraday timeframe — the
    candle state machine owns the developing-bar OHLCV that the SSE layer
    streams to chart clients. Wrapped in try/except so observability failures
    never break tick handling.
    """
    sym = sym.upper()
    with _lock:
        _last_seen[sym] = int(ts)
        # Also update _prices so existing /api/stream/prices behavior is preserved
        if sym in _prices:
            _prices[sym]["price"] = price
            _prices[sym]["timestamp"] = int(ts)
            _prices[sym]["updated_at"] = int(time.time())
        else:
            _prices[sym] = {
                "price": price,
                "timestamp": int(ts),
                "updated_at": int(time.time()),
            }

    # Feed realtime_candle (separate lock — no contention with _lock above).
    # Lazy import avoids any future circular-dep risk if realtime_candle ever
    # needs to reach back into realtime_stream. size=1 is a placeholder; when
    # _process_finnhub_trade gains a size-aware path it can call apply_tick
    # directly with the real trade volume.
    try:
        from api.services import realtime_candle
        for tf in ("1", "5", "15", "30", "60"):
            realtime_candle.apply_tick(sym, price=price, ts=int(ts), size=1, tf=tf)
    except Exception:
        pass  # observability layer; never break tick handling


def get_last_seen(sym: str) -> int | None:
    """Return the most recent tick timestamp (epoch seconds) for sym, or None."""
    with _lock:
        return _last_seen.get(sym.upper())


def get_last_seen_ages(now: int | None = None) -> dict[str, int]:
    """Return {ticker: seconds_since_last_tick} for all tracked tickers."""
    if now is None:
        now = int(time.time())
    with _lock:
        return {sym: now - ts for sym, ts in _last_seen.items()}


def subscribe_tickers(tickers):
    """Add tickers to the subscription set. Thread-safe. Refcounted: a ticker
    already wanted by another connection just has its count bumped — only a
    0->1 transition sends a new upstream WS subscribe / joins the effective
    _subscribed set. This is what lets multiple SSE connections (or the
    client-side connection pool's bucket reconnects) share a ticker safely.
    """
    up = set(t.upper() for t in tickers)
    # Mutate under _lock so the WS reconnect thread never iterates _subscribed
    # mid-mutation ("set changed size during iteration").
    with _lock:
        new = set()
        for t in up:
            _sub_counts[t] += 1
            if _sub_counts[t] == 1:
                new.add(t)
        if not new:
            return
        _subscribed.update(new)
        total = len(_subscribed)
    # If WebSocket is running, send subscribe messages
    if _ws_loop and _running:
        asyncio.run_coroutine_threadsafe(_async_subscribe(new), _ws_loop)
    _logger.info("[stream] Subscribed %d new tickers (total: %d)", len(new), total)


def unsubscribe_tickers(tickers):
    """Decrement refcounts and remove/unsubscribe upstream only tickers whose
    count reaches 0. A ticker still wanted by another connection (count stays
    >= 1) is left alone — this is the fix for the bucket-reconnect / overlapping-
    connection freeze (see spec amendment). Unsubscribing a ticker that was
    never subscribed (or already at 0) is a safe no-op — counts are clamped at
    0, never negative.
    """
    down = set(t.upper() for t in tickers)
    with _lock:
        to_remove = set()
        for t in down:
            count = _sub_counts.get(t, 0)
            if count <= 0:
                _sub_counts.pop(t, None)  # clamp: never go negative
                continue
            count -= 1
            if count <= 0:
                _sub_counts.pop(t, None)
                to_remove.add(t)
            else:
                _sub_counts[t] = count
        if not to_remove:
            return
        _subscribed.difference_update(to_remove)
    if _ws_loop and _running:
        asyncio.run_coroutine_threadsafe(_async_unsubscribe(to_remove), _ws_loop)
    _logger.debug("[stream] Unsubscribed %d tickers (total: %d)", len(to_remove), len(_subscribed))


async def _async_unsubscribe(tickers):
    """Send unsubscribe messages on the existing Finnhub WebSocket."""
    global _ws_connection
    if not _ws_connection:
        return
    for sym in tickers:
        try:
            await _ws_connection.send(json.dumps({"type": "unsubscribe", "symbol": sym}))
        except Exception as e:
            _logger.warning("[stream] Unsubscribe %s failed: %s", sym, e)


async def _async_subscribe(tickers):
    """Send subscribe messages on the existing Finnhub WebSocket."""
    global _ws_connection
    if not _ws_connection:
        return
    for sym in tickers:
        try:
            await _ws_connection.send(json.dumps({"type": "subscribe", "symbol": sym}))
        except Exception as e:
            _logger.warning("[stream] Subscribe %s failed: %s", sym, e)


def _load_full_universe():
    """Load all tickers from cap_universe.json for full WebSocket subscription."""
    import json as _json
    try:
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
        with open(path) as f:
            tickers = _json.load(f)
        return set(t.upper() for t in tickers if t)
    except Exception:
        return set()


def _ws_reconnect_transition(consecutive_failures: int, backoff_s: float, was_stable: bool) -> dict:
    """Pure state transition for the WS reconnect loop's backoff + circuit-
    breaker bookkeeping (factored out for unit testing — no asyncio/websockets
    involved).

    `was_stable` = the connection that just dropped stayed open for at least
    `_WS_MIN_STABLE_CONNECT_S` before dying — treated as genuinely recovered,
    not a continuation of the same failure storm. This is the fix for a real
    production bug: the OLD loop reset its backoff to 1s the instant a
    connection was ACCEPTED (entered `async with`), even if Finnhub kicked it
    again immediately after — so a connect-then-immediate-kick pattern reset
    backoff on every cycle and the loop never actually backed off. Observed
    live: "reconnecting in 8s" ... "15s" ... "2s" — non-monotonic, because a
    momentary accept-then-kick kept resetting the counter.

    Returns {"consecutive_failures", "sleep_s", "next_backoff_s",
    "circuit_break"}:
      • `sleep_s` — how long THIS cycle should sleep before retrying.
      • `next_backoff_s` — the backoff to carry into the NEXT cycle.
      • `circuit_break` — True once `_WS_MAX_CONSECUTIVE_FAILURES` consecutive
        non-stable failures have piled up: the account is being rejected
        persistently, not just blipping, so the loop goes quiet for
        `_WS_CIRCUIT_BREAKER_S` instead of retrying every `_WS_MAX_BACKOFF_S`.
        The caller also reports this into the SHARED cooldown
        (finnhub_client.fh_note_429) so REST backs off in step too.
    """
    if was_stable:
        return {"consecutive_failures": 0, "sleep_s": _WS_BASE_BACKOFF_S,
                "next_backoff_s": _WS_BASE_BACKOFF_S, "circuit_break": False}
    consecutive_failures += 1
    if consecutive_failures >= _WS_MAX_CONSECUTIVE_FAILURES:
        return {"consecutive_failures": 0, "sleep_s": _WS_CIRCUIT_BREAKER_S,
                "next_backoff_s": _WS_BASE_BACKOFF_S, "circuit_break": True}
    return {"consecutive_failures": consecutive_failures, "sleep_s": backoff_s,
            "next_backoff_s": min(backoff_s * 2, _WS_MAX_BACKOFF_S), "circuit_break": False}


_RECV_TIMEOUT_S = 45

# How many consecutive silent windows force a reconnect. DURING regular
# hours one is right: trades flow constantly, so 45s of nothing means a
# dead-but-open socket. OUTSIDE them silence is the NORMAL state, and the
# 1-window rule turned that into a reconnect + full resubscribe every
# ~60s, all night, every night, on the pod that serves members (observed
# on prod 2026-08-29 post-market). The watchdog is kept — a socket that
# dies at 02:00 must still be caught before the open — just given a
# tolerance that matches what silence actually means at that hour.
_CLOSED_SILENCE_WINDOWS = int(os.environ.get("STREAM_CLOSED_SILENCE_WINDOWS", "13"))


async def _run_websocket():
    """Main WebSocket loop — connect, subscribe, process Finnhub trade messages.

    ── Shared-budget coordination (2026-08-05) ─────────────────────────────
    This loop shares Finnhub's per-ACCOUNT rate limit with every REST caller
    in the codebase (see api/services/finnhub_client.py's module docstring —
    the production incident this fixes: a WS reconnect storm burning the
    account's request budget continuously, starving the REST calls the
    earnings modal depends on). Two mechanisms enforce that REST — the
    user-facing path — always wins:
      1. `finnhub_client.fh_ws_reconnect_allowed()` is consulted before EVERY
         (re)connect attempt. It requires MORE token-bucket headroom than a
         bare REST call before allowing a connect — so under contention the
         bucket runs dry for WS well before it runs dry for REST — and it
         defers entirely while a REST-or-WS-triggered 429 cooldown is active.
         A denied check does NOT attempt the handshake at all: an attempt we
         already know competes for scarce budget is worse than no attempt.
      2. A WS-side 429 (`"429" in str(exception)` — the exact shape Finnhub
         sends on a rejected handshake, e.g. "server rejected WebSocket
         connection: HTTP 429") reports into the SAME shared cooldown via
         `fh_note_429`, so REST backs off in step instead of continuing to
         spend budget the account has just signaled it doesn't have.
    `_ws_reconnect_transition` (above) is the OTHER half of the fix: proper
    exponential backoff with a real ceiling AND a circuit breaker on
    consecutive failures, plus the corrected stability check described there.
    """
    global _ws_connection, _running
    import websockets
    from api.services import finnhub_client as _fhc

    if not _FINNHUB_KEY:
        _logger.warning("[stream] FINNHUB_API_KEY not set — WebSocket disabled")
        return


    # Force a reconnect if the socket goes totally silent this long while we have
    # active subscriptions (dead-but-open feed: TCP alive, not pushing). A healthy
    # Finnhub connection always emits trades or its own app-level pings well within it.

    backoff = _WS_BASE_BACKOFF_S
    consecutive_failures = 0
    connect_started: float | None = None
    while True:
        # Yield to the shared account budget — see module/function docstring.
        # A background reconnect must never compete with a user-facing REST
        # request for Finnhub's per-minute budget. Non-blocking: on denial we
        # just wait and re-check rather than attempting a handshake we
        # already know is unwelcome right now.
        if not _fhc.fh_ws_reconnect_allowed():
            await asyncio.sleep(_WS_BUDGET_POLL_S)
            continue

        try:
            _logger.info("[stream] Connecting to Finnhub WebSocket...")
            async with websockets.connect(_WS_URL, ping_interval=30, ping_timeout=10) as ws:
                _ws_connection = ws
                _running = True
                connect_started = time.monotonic()
                _logger.info("[stream] Finnhub WebSocket connected")

                # Re-subscribe only already-requested tickers (lazy subscription model).
                # Bulk-subscribing the full 3,685-ticker universe on every connect
                # saturates Finnhub free-tier limits and wastes bandwidth.
                with _lock:  # snapshot under lock (mutated from the event-loop thread)
                    all_tickers = sorted(_subscribed)
                for sym in all_tickers:
                    await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                if all_tickers:
                    _logger.info("[stream] Re-subscribed %d active tickers on reconnect", len(all_tickers))

                # Consecutive 45s windows with no message. Reset by any traffic.
                silent_windows = 0

                # Process messages with a liveness ceiling. Total silence for
                # _RECV_TIMEOUT_S while tickers are subscribed = dead-but-open feed →
                # break to force a full reconnect + resubscribe rather than waiting on
                # the protocol ping timeout. Cancelling a timed-out recv() leaves the
                # socket usable for the next iteration.
                while True:
                    try:
                        raw_msg = await asyncio.wait_for(ws.recv(), timeout=_RECV_TIMEOUT_S)
                    except asyncio.TimeoutError:
                        with _lock:
                            n_sub = len(_subscribed)
                        if n_sub > 0:
                            silent_windows += 1
                            from api.services.bars_liveness import is_market_open
                            tolerance = 1 if is_market_open() else _CLOSED_SILENCE_WINDOWS
                            if silent_windows < tolerance:
                                # Expected quiet (market closed). Keep waiting —
                                # the websocket ping/pong still proves the socket
                                # is alive, so nothing is being ignored here.
                                continue
                            _logger.warning(
                                "[stream] No Finnhub messages for %ds x%d with %d active subs — feed silent, forcing reconnect",
                                _RECV_TIMEOUT_S, silent_windows, n_sub,
                            )
                            # This path exits the `async with` block WITHOUT an
                            # exception, so the `except` handler below (and its
                            # was_stable/backoff bookkeeping) never runs — the
                            # loop just retries from the top immediately. But
                            # `connect_started` must still be cleared here: left
                            # stale, a LATER genuine connect failure would compute
                            # was_stable against THIS session's (possibly
                            # long-ago) start time instead of "we don't know,
                            # treat it as a fresh failure" — silently forgiving a
                            # real failure streak's backoff.
                            connect_started = None
                            break  # exit inner loop → context manager closes ws → outer reconnect
                        continue   # nothing subscribed: silence is expected, keep waiting
                    silent_windows = 0
                    try:
                        data = json.loads(raw_msg)
                        msg_type = data.get("type", "")
                        if msg_type == "trade":
                            for trade in (data.get("data") or []):
                                _process_finnhub_trade(trade)
                        elif msg_type == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
                    except json.JSONDecodeError:
                        pass
                    except Exception as e:
                        _logger.warning("[stream] Message processing error: %s", e)

        except Exception as e:
            _running = False
            _ws_connection = None
            was_stable = (
                connect_started is not None
                and (time.monotonic() - connect_started) >= _WS_MIN_STABLE_CONNECT_S
            )
            connect_started = None

            # A WS-side 429 reports into the SHARED cooldown so REST backs off
            # too — see _run_websocket's docstring, point 2.
            if "429" in str(e):
                _fhc.fh_note_429("ws")

            t = _ws_reconnect_transition(consecutive_failures, backoff, was_stable)
            consecutive_failures, backoff = t["consecutive_failures"], t["next_backoff_s"]
            if t["circuit_break"]:
                _logger.warning(
                    "[stream] %d consecutive WS reconnect failures — circuit breaker: "
                    "quiet for %ds (last error: %s)",
                    _WS_MAX_CONSECUTIVE_FAILURES, t["sleep_s"], e,
                )
                _fhc.fh_note_429("ws-circuit-breaker")
            else:
                _logger.warning("[stream] WebSocket disconnected: %s — reconnecting in %ds", e, t["sleep_s"])
            await asyncio.sleep(t["sleep_s"])


def _process_finnhub_trade(trade):
    """Process a single Finnhub trade event.

    trade = {"p": 150.25, "s": "AAPL", "t": 1713200000000, "v": 100, "c": [...]}
      p = price, s = symbol, t = timestamp (ms), v = volume, c = conditions
    """
    sym = trade.get("s", "")
    if not sym:
        return
    trade_price = trade.get("p", 0)
    trade_vol = trade.get("v", 0)
    timestamp = trade.get("t", 0)  # milliseconds

    # SIP sale-condition gate (matches TC2000/TradingView tape filtering): an
    # odd-lot / out-of-sequence / form-T / average-priced print may NOT move the
    # last price (last_ok) or extend a candle's high/low (hl_ok). Missing/unknown
    # conditions → (True, True) = fully eligible, so real trades are never hidden.
    hl_ok, last_ok = trade_conditions.classify(trade.get("c"))

    # Record liveness regardless — a print DID occur (Finnhub ms → epoch seconds).
    ts_seconds = int(timestamp / 1000) if timestamp else int(time.time())

    with _lock:
        _last_seen[sym] = ts_seconds
        # Only a LAST-SALE-eligible print advances the displayed last price; an
        # ineligible print (odd-lot etc.) leaves the quote at the prior real trade.
        if last_ok:
            prev = _prices.get(sym, {})
            prev_close = prev.get("prev_close", trade_price)
            if prev_close and prev_close > 0:
                change_pct = round((trade_price - prev_close) / prev_close * 100, 4)
            else:
                change_pct = 0.0
            _prices[sym] = {
                "price": round(trade_price, 2),
                "change_pct": change_pct,
                "change": round(trade_price - prev_close, 4) if prev_close else 0,
                # volume intentionally omitted: REST polling owns accurate day volume.
                # Accumulating tick volumes here produced unbounded runaway totals.
                "prev_close": prev_close,
                "timestamp": timestamp,
                "updated_at": time.time(),
            }

    # Feed realtime_candle (separate lock — no contention with _lock above).
    # _record_tick is NOT called from this production path, so we hook the
    # candle state machine directly here. Wrapped in try/except so observability
    # failures never break tick handling.
    try:
        from api.services import realtime_candle
        actual_size = int(trade_vol) if trade_vol else 1
        for tf in ("1", "5", "15", "30", "60"):
            realtime_candle.apply_tick(
                sym, price=trade_price, ts=ts_seconds, size=actual_size, tf=tf,
                update_hl=hl_ok, update_last=last_ok,
            )
    except Exception:
        pass  # observability layer; never break tick handling


def start_stream():
    """Start the WebSocket stream in a background thread."""
    global _ws_loop

    # 🔴 A LOCAL RUN MUST NOT TAKE PRODUCTION'S ONE CONNECTION SLOT. On
    # 2026-08-10 six forgotten dev servers on the owner's PC held this exact
    # socket with the production key; prod connected, was kicked ~1 s later,
    # and looped into a circuit breaker for hours while live charts sat dead.
    # See api/services/vendor_socket_guard.py for why this is structural.
    #
    # ⚠️ THE GATE IS HERE, AT THE STARTUP ENTRY POINT, NOT INSIDE THE RECONNECT
    # LOOP. Two reasons, one of which the test suite told me: the decision
    # "should this PROCESS stream at all" is answered once at boot, not
    # re-litigated on every reconnect — and putting it in `_run_websocket`
    # short-circuits the connect/backoff/circuit-breaker tests that drive that
    # coroutine directly, which is a real signal that it was the wrong layer.
    from api.services import vendor_socket_guard
    if vendor_socket_guard.refuse_if_local("finnhub"):
        return

    def _thread_target():
        global _ws_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _ws_loop = loop
        loop.run_until_complete(_run_websocket())

    t = threading.Thread(target=_thread_target, daemon=True, name="realtime-stream")
    t.start()
    _logger.info("[stream] Finnhub WebSocket stream thread started")


def stop_stream():
    """Stop the WebSocket stream."""
    global _running, _ws_connection
    _running = False
    if _ws_connection and _ws_loop:
        asyncio.run_coroutine_threadsafe(_ws_connection.close(), _ws_loop)
    _logger.info("[stream] WebSocket stream stopped")
