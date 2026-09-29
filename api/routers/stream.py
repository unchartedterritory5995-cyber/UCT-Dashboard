"""
Server-Sent Events (SSE) endpoint for real-time price streaming.
Fans out WebSocket price data from Massive/Polygon to browser clients.
"""

import asyncio
import json
import logging
import os
import time
import uuid

from fastapi import APIRouter, Depends, Query, Request
from api.bars_auth import require_bars_access
from fastapi.responses import JSONResponse, StreamingResponse

from api.services import bars_liveness, realtime_candle, realtime_stream
from api.services.realtime_stream import (
    get_realtime_prices, subscribe_tickers, unsubscribe_tickers, get_stream_status
)

_logger = logging.getLogger(__name__)

router = APIRouter()

MAX_SSE_TICKERS = 50  # Finnhub free tier cap; prevents unbounded subscription growth

#: The per-connection cap on `sym:tf` BARS pairs. Named 2026-09-15 (D3 CP2): it was
#: an inline `pairs[:50]` several hundred lines below, and `barsStreamManager.js`
#: carried a second 50 whose comment called itself a "mirror of
#: api/routers/stream.py pairs[:50]" — a magic number citing a magic number, with
#: nothing able to notice if one moved. Same VALUE as MAX_SSE_TICKERS, different
#: FACT: that one is Finnhub's per-key subscription ceiling, this one bounds how
#: much one browser may ask this pod to fan out. They are free to diverge.
MAX_BARS_PAIRS = 50

# ── admission control ────────────────────────────────────────────────────────
# ⭐ COPIED, NOT INVENTED. Every other stream in this codebase already owns this
# exact shape — `massive_stream.MAX_SUBSCRIBERS` (300),
# `massive_curated_stream.MAX_SUBSCRIBERS` (300), `chat_stream.MAX_SUBSCRIBERS`
# (400): an env-read module constant, a `subscribe()` that returns None once the
# registry is at the cap, and a router that answers 503 `at_capacity` so the
# client falls back to polling. These two sleep-polling loops were the only
# streams without it, and they are the ones that hold a coroutine on the SINGLE
# shared event loop for the life of the connection. Tickers were capped at 50 per
# connection; connections themselves were capped at nothing.
MAX_SUBSCRIBERS = int(os.environ.get("STREAM_MAX_SUBSCRIBERS", "300"))

# Per-STREAM registries, like the two massive streams each holding their own —
# so a wall of chart tabs on /api/stream/bars can never crowd out the price
# quotes every page depends on. One counter issues tokens for both.
_subscribers: dict = {"prices": set(), "bars": set()}
_conn_seq = 0


def subscribe(stream: str):
    """Register one SSE connection. Returns its token, or None if the subscriber
    cap is hit (the caller should refuse with 503 and let the client poll)."""
    global _conn_seq
    conns = _subscribers.setdefault(stream, set())
    if len(conns) >= MAX_SUBSCRIBERS:
        return None
    _conn_seq += 1
    conns.add(_conn_seq)
    return _conn_seq


def unsubscribe(stream: str, token) -> None:
    if token is None:
        return
    _subscribers.get(stream, set()).discard(token)


def subscriber_count(stream: str) -> int:
    return len(_subscribers.get(stream, ()))


def _at_capacity(stream: str):
    """The refusal, worded once. 503 + `at_capacity` mirrors
    `massive_stream_router`'s so a client already handles it."""
    _logger.warning("[stream_%s] refused: at capacity (%d/%d)",
                    stream, subscriber_count(stream), MAX_SUBSCRIBERS)
    return JSONResponse(
        {"error": "at capacity", "reason": "at_capacity",
         "stream": stream, "max_subscribers": MAX_SUBSCRIBERS},
        status_code=503,
    )


# ── event ids + Last-Event-ID (TERM-054 / FB-D3-01) ──────────────────────────
# Every frame on both streams carries `id: <boot>-<seq>`. `<seq>` is ONE
# counter per stream for this process, shared by every connection, so ids are
# strictly increasing within a connection and comparable across connections of
# this process. `<boot>` names the process: a pod restart (every web deploy)
# mints a new one, which is how a reconnect tells "same server" from "the server
# I was talking to is gone". The web pod is ONE uvicorn process — this is
# in-process state, like the subscriber registry above, and a second process
# would mint its own `<boot>` rather than share a sequence.
#
# ⛔ BOTH STREAMS ARE LAST-VALUE-WINS, SO NOTHING IS REPLAYED. The replay window
# is ZERO events, by design, not by omission (ARCH-07 §3 Q6; the same vocabulary
# as `app/src/lib/panelContract.js` DELIVERY, which a vitest rail pins against
# STREAM_DELIVERY below). A missed price snapshot or developing bar is superseded
# by the next one, so replaying it would only repaint history the client is
# about to overwrite. What a reconnect presenting a Last-Event-ID gets instead is
# a DECLARATION, as the first frame (`event: resume`): resume is
# `not_applicable`, `replayed: 0`, and what the stream serves in its place —
# never a silent refetch and never a claimed resume that cannot be served.
# The one every-message-matters stream (the options tape) is served by
# flow-worker and is not this module's.
#
# Why no gap counter: an id makes a gap DETECTABLE, and a counter of detected
# gaps would need a reader (PERF-6 / FB-OBS-02). On a last-value-wins stream a
# gap is not loss — the loss that IS real (slow-consumer drops) is already
# counted by `bar_broadcaster` and read by TERM-013's `bars_rail_monitor`.
STREAM_DELIVERY = {"prices": "last-value-wins", "bars": "last-value-wins"}

#: What each stream sends after a resume declaration, in place of a replay.
#: The test suite drives each generator and checks the claim is kept.
_SERVED_INSTEAD = {
    # the loop's first pass compares against an empty `last_prices`, so it
    # emits every subscribed ticker that has a price at that moment
    "prices": "current_snapshot",
    # each pair's queue is fresh; the next bar the broadcaster emits for a pair
    # is that pair's current developing bar
    "bars": "next_bar_per_pair",
}

#: Replay window, in events. Zero for both: see the block comment above.
REPLAY_WINDOW_EVENTS = 0

_EVENT_BOOT = uuid.uuid4().hex[:8]
_event_seq: dict = {"prices": 0, "bars": 0}

#: A Last-Event-ID longer than this is not one of ours; it is echoed truncated.
_MAX_LAST_EVENT_ID = 64


def _next_event_id(stream: str) -> str:
    """Mint the next id for `stream`. Single event loop ⇒ no lock needed."""
    _event_seq[stream] = _event_seq.get(stream, 0) + 1
    return f"{_EVENT_BOOT}-{_event_seq[stream]}"


def _frame(stream: str, data: str, event: str | None = None) -> str:
    """One SSE frame with a fresh id. `data` is already serialized."""
    head = f"id: {_next_event_id(stream)}\n"
    if event:
        head += f"event: {event}\n"
    return f"{head}data: {data}\n\n"


def _parse_event_id(raw):
    """`<boot>-<seq>` → (boot, seq), or None for anything else."""
    if not isinstance(raw, str):
        return None
    boot, sep, seq = raw.strip().rpartition("-")
    if not sep or not boot or not seq.isdigit():
        return None
    return boot, int(seq)


def _requested_last_event_id(request, query_value):
    """The id a reconnecting client presents, or None.

    Two doors: the `Last-Event-ID` HEADER, which a browser's own EventSource
    auto-reconnect sends, and the `last_event_id` QUERY parameter, which the
    pooled client managers send — they close and re-create their EventSource on
    error, and a new EventSource cannot set a header. The header wins.
    """
    headers = getattr(request, "headers", None)
    raw = None
    if headers is not None:
        try:
            raw = headers.get("last-event-id")
        except Exception:
            raw = None
    if not raw and isinstance(query_value, str):
        raw = query_value
    raw = (raw or "").strip()
    return raw or None


def _resume_declaration(stream: str, last_event_id):
    """What the server says to a reconnect that presented `last_event_id`.

    Returns None when no id was presented (a first connection is not a resume).
    `origin` says whose id it was:
      • this_process   — minted here, at or below the current sequence
      • other_process  — well-formed but another process's (a deploy happened)
      • unrecognised   — malformed, or claims a sequence this process never reached
    It never reports a count of missed events: the sequence is shared by every
    connection of the stream, so the distance between two ids is not what THIS
    client missed.
    """
    if not last_event_id:
        return None
    parsed = _parse_event_id(last_event_id)
    if parsed is None:
        origin = "unrecognised"
    elif parsed[0] != _EVENT_BOOT:
        origin = "other_process"
    elif parsed[1] > _event_seq.get(stream, 0):
        origin = "unrecognised"
    else:
        origin = "this_process"
    return {
        "type": "resume",
        "stream": stream,
        "delivery": STREAM_DELIVERY[stream],
        "resume": "not_applicable",
        "replayed": 0,
        "replay_window_events": REPLAY_WINDOW_EVENTS,
        "last_event_id": str(last_event_id)[:_MAX_LAST_EVENT_ID],
        "origin": origin,
        "served_instead": _SERVED_INSTEAD[stream],
    }


def _build_candle_events(tickers, last_state: dict) -> list[dict]:
    """Detect candle state changes and produce event dicts.

    Args:
      tickers: iterable of ticker symbols to check
      last_state: dict {sym: (t, c, v)} mutated in-place to track current state

    Returns:
      List of event dicts: {"type": "tick", "sym", "price", "ts", "vol"} or
                            {"type": "bar_close", "sym", "tf", "bar"}
    """
    events: list[dict] = []
    for sym in tickers:
        sym_u = sym.upper()
        cur = realtime_candle.get_current(sym_u, "1")
        if not cur:
            continue
        cur_key = (cur["t"], cur["c"], cur["v"])
        prev = last_state.get(sym_u)
        if prev == cur_key:
            continue
        # Detect bar boundary close: prev existed and prev_t != cur_t
        if prev and prev[0] != cur["t"]:
            # Emit bar_close for the prior bar
            events.append({
                "type": "bar_close",
                "sym": sym_u,
                "tf": "1",
                "bar": {"t": prev[0], "c": prev[1], "v": prev[2]},
            })
        # Always emit tick on any change
        events.append({
            "type": "tick",
            "sym": sym_u,
            "price": cur["c"],
            "ts": cur.get("last_tick_ts"),
            "vol": cur["v"],
        })
        last_state[sym_u] = cur_key
    return events


def _build_stale_events(tickers, now=None, bb=None):
    """Return list of stale event dicts for tickers whose last tick is too old.

    A symbol is stale only when EVERY live source has gone quiet. `last_seen`
    alone tracks the FINNHUB trade feed, whose free tier legitimately trickles
    (a ticker can go minutes between prints) — while the Massive feed keeps
    powering the price/candle the user actually sees. Judging staleness off
    Finnhub alone produced the "badge says STALE but the price is ticking"
    bug, so the Massive developing-partial timestamp (via `bb`) counts as
    activity too and the newest of the two sources decides.

    Args:
      tickers: iterable of ticker symbols
      now: epoch seconds; defaults to time.time()
      bb: optional bar_broadcaster — its `get_last_price(sym)["ts"]` is the
          Massive developing 1-min partial's bucket start (ms; ≤60s behind the
          newest Massive tick while trades flow).

    Returns:
      List of {"type": "stale", "sym": SYM, "last_seen": ts} dicts.
    """
    if now is None:
        now = int(time.time())
    events = []
    for sym in tickers:
        last_seen = realtime_stream.get_last_seen(sym)
        if bb is not None:
            try:
                mp = bb.get_last_price(sym)
                mts = mp.get("ts") if mp else None
                if mts:
                    # Bucket starts are ms; normalize defensively so a future
                    # seconds-valued source can't zero out staleness detection.
                    msec = int(mts / 1000) if mts > 1_000_000_000_000 else int(mts)
                    last_seen = msec if last_seen is None else max(last_seen, msec)
            except Exception:
                pass  # best-effort — Finnhub-only staleness is the fallback
        if last_seen is None:
            continue
        if bars_liveness.is_stale(last_seen, tf="1", market_open=None):
            events.append({"type": "stale", "sym": sym.upper(), "last_seen": last_seen})
    return events


@router.get("/api/stream/prices")
async def stream_prices(
    request: Request,
    tickers: str = Query(..., description="Comma-separated ticker symbols"),
    last_event_id: str | None = Query(None, description=(
        "Id of the last event a reconnecting client received (the pooled "
        "managers' door; a browser auto-reconnect sends the Last-Event-ID "
        "header instead). Answered with an `event: resume` declaration.")),
):
    """SSE endpoint — streams real-time price updates to the browser.

    Connect via EventSource:
      const es = new EventSource('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
      es.onmessage = (e) => { const prices = JSON.parse(e.data) }

    Every frame carries `id:`. A reconnect presenting a Last-Event-ID gets an
    `event: resume` first frame declaring resume not applicable (last-value-wins,
    zero events replayed) and that a current snapshot follows — see the TERM-054
    block above `_next_event_id`.
    """
    resume = _resume_declaration("prices", _requested_last_event_id(request, last_event_id))
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return JSONResponse({"error": "No tickers provided"}, status_code=400)

    # Cap to MAX_SSE_TICKERS to prevent subscription bloat
    ticker_list = ticker_list[:MAX_SSE_TICKERS]

    # Admission BEFORE any upstream subscription — a refused connection must not
    # leave Finnhub/Massive interest registered for tickers nobody is watching.
    _token = subscribe("prices")
    if _token is None:
        return _at_capacity("prices")

    # Subscribe these tickers to the Finnhub WebSocket stream (fallback source).
    subscribe_tickers(ticker_list)

    # ALSO register interest on the MASSIVE feed (the same sub-second feed that
    # drives the candle). Finnhub's free tier trickles trades out (a given ticker
    # can go minutes between updates), so watchlist/theme/header quotes looked
    # frozen; Massive delivers tick-by-tick. We read its developing bar directly
    # (get_last_price) below — interest keeps the symbol subscribed upstream
    # WITHOUT a per-tick queue on the request loop. Best-effort: if the bars feed
    # is disabled/uninitialized we silently fall back to Finnhub-only.
    _bb = None
    try:
        from api.services.bar_broadcaster import get_broadcaster
        _bb = get_broadcaster()
        _bb.add_interest(ticker_list)
    except Exception:
        _bb = None

    async def event_generator():
        last_prices = {}  # {sym: price} — only compare price field to avoid unnecessary pushes
        heartbeat_interval = 15  # seconds
        last_heartbeat = time.time()

        # Liveness tracking: emit stale/fresh events on transitions only (not steady-state)
        already_stale: set[str] = set()
        last_stale_check = 0  # epoch seconds

        # Candle event tracking: {sym: (t, c, v)} — last seen state per ticker
        last_candle_state: dict = {}

        # Correction queue handle (drain once per loop)
        correction_queue = realtime_candle.get_correction_queue()

        try:
            if resume is not None:
                yield _frame("prices", json.dumps(resume), "resume")
            while True:
                # Exit immediately when browser disconnects — prevents zombie coroutines
                if await request.is_disconnected():
                    break

                # Get latest prices for requested tickers (Finnhub store — fallback).
                current = get_realtime_prices(ticker_list)

                # Overlay the MASSIVE live price where we have a fresh tick — it's
                # the same sub-second feed powering the candle, vs Finnhub's
                # throttled trickle. Only the `price` is overlaid; the client
                # recomputes the day % from this price + the REST prev close.
                if _bb is not None:
                    for sym in ticker_list:
                        mp = _bb.get_last_price(sym)
                        if mp and mp.get("price") is not None:
                            entry = current.get(sym)
                            if entry is None:
                                entry = {}
                                current[sym] = entry
                            entry["price"] = mp["price"]
                            # Live cumulative day volume (Massive `av`) overlays the
                            # 15s REST value so the Volume column ticks too.
                            if mp.get("volume") is not None:
                                entry["volume"] = mp["volume"]
                            entry["updated_at"] = int(time.time())

                # Only send if any ticker's price OR live volume actually changed
                # (volume is included so the Volume column still ticks on a trade
                # that prints at the same price).
                prices_now = (
                    {s: (d.get("price"), d.get("volume")) for s, d in current.items()}
                    if current else {}
                )
                if prices_now != last_prices and current:
                    last_prices = prices_now
                    yield _frame("prices", json.dumps(current))

                # Candle events: tick + bar_close emissions (per-iteration, cheap)
                candle_events = _build_candle_events(ticker_list, last_candle_state)
                for ev in candle_events:
                    if ev["type"] == "tick":
                        yield _frame("prices", json.dumps(ev), "tick")
                    elif ev["type"] == "bar_close":
                        yield _frame("prices", json.dumps(ev), "bar_close")

                # Drain bar_correction events from reconciliation worker (non-blocking)
                try:
                    while True:
                        ev = correction_queue.get_nowait()
                        yield _frame("prices", json.dumps(ev), "bar_correction")
                except asyncio.QueueEmpty:
                    pass
                except Exception:
                    pass

                # Liveness probe: at most once per second, detect stale/fresh transitions
                now_int = int(time.time())
                if now_int > last_stale_check:
                    last_stale_check = now_int
                    stale_events = _build_stale_events(ticker_list, now=now_int, bb=_bb)
                    currently_stale = {e["sym"] for e in stale_events}
                    # Emit stale for newly-stale tickers
                    for e in stale_events:
                        if e["sym"] not in already_stale:
                            yield _frame("prices", json.dumps(e), "stale")
                            already_stale.add(e["sym"])
                    # Emit fresh for recovered tickers
                    for sym in list(already_stale - currently_stale):
                        yield _frame("prices", json.dumps({'type': 'fresh', 'sym': sym}), "fresh")
                        already_stale.discard(sym)

                # Heartbeat to keep connection alive through proxies. Sent as a
                # NAMED event (not an SSE comment) so the client's watchdog can
                # reset on it and tell a quiet-but-healthy stream from a dead one.
                if time.time() - last_heartbeat > heartbeat_interval:
                    yield _frame("prices", "{}", "heartbeat")
                    last_heartbeat = time.time()

                # 250ms cadence (was 100ms). Every open tab holds one of these
                # loops on the SINGLE event loop; at launch scale the 10Hz tick
                # (snapshot + diff per connection) was measurable pure overhead.
                # 4Hz is still far below human perception for price updates.
                await asyncio.sleep(0.25)
        finally:
            # Clean up subscriptions when client disconnects so _subscribed
            # doesn't grow unbounded as users navigate between pages.
            unsubscribe("prices", _token)
            unsubscribe_tickers(ticker_list)
            if _bb is not None:
                try:
                    _bb.remove_interest(ticker_list)
                except Exception:
                    pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable Nginx/proxy buffering
        },
    )


@router.get("/api/stream/bars")
async def stream_bars(
    request: Request,
    bars: str = Query(..., description="Comma-separated SYM:TF pairs, e.g. AAPL:5,MSFT:1"),
    _access: dict = Depends(require_bars_access),
    last_event_id: str | None = Query(None, description=(
        "Id of the last event a reconnecting client received (the pooled "
        "manager's door; a browser auto-reconnect sends the Last-Event-ID "
        "header instead). Answered with an `event: resume` declaration.")),
):
    """SSE — streams real-time bar updates per (symbol, timeframe).

    Connect via EventSource:
      const es = new EventSource('/api/stream/bars?bars=AAPL:5,MSFT:1')
      es.addEventListener('bar', e => { const {sym, tf, bar} = JSON.parse(e.data) })

    Each `event: bar` message contains the latest in-progress (or just-closed) bar
    for the (sym, tf) pair. Frontend should call series.update(bar) to apply.

    Every frame carries `id:`. A reconnect presenting a Last-Event-ID gets an
    `event: resume` first frame declaring resume not applicable (last-value-wins,
    zero events replayed); each pair's next bar supersedes what was missed.
    """
    if os.environ.get("STREAM_BARS_ENABLED") != "1":
        return JSONResponse({"error": "Bar streaming disabled"}, status_code=503)

    pairs: list[tuple[str, str]] = []
    for raw in bars.split(","):
        s = raw.strip()
        if not s or ":" not in s:
            continue
        sym, tf = s.split(":", 1)
        sym = sym.strip().upper()
        tf = tf.strip()
        if sym and tf in ("1", "5", "15", "30", "60"):  # 60-min uses canonical ET-anchored bucket
            pairs.append((sym, tf))

    if not pairs:
        return JSONResponse({"error": "No valid sym:tf pairs"}, status_code=400)
    pairs = pairs[:MAX_BARS_PAIRS]  # cap to prevent runaway subscriptions per connection

    # Admission BEFORE the broadcaster subscribe, for the same reason as
    # /api/stream/prices: a refused connection must leave no queues behind.
    _token = subscribe("bars")
    if _token is None:
        return _at_capacity("bars")

    from api.services.bar_broadcaster import get_broadcaster
    bb = get_broadcaster()
    queues = [(sym, tf, bb.subscribe(sym, tf)) for (sym, tf) in pairs]
    _logger.info("[stream_bars] subscribed %d pairs: %s", len(pairs), pairs[:10])

    resume = _resume_declaration("bars", _requested_last_event_id(request, last_event_id))

    async def event_generator():
        last_heartbeat = time.time()
        try:
            if resume is not None:
                yield _frame("bars", json.dumps(resume), "resume")
            while True:
                if await request.is_disconnected():
                    break
                # Drain whatever is ready from any queue without blocking forever.
                # We round-robin one wait at a time so no queue starves.
                got_one = False
                for (sym, tf, q) in queues:
                    try:
                        msg = q.get_nowait()
                    except asyncio.QueueEmpty:
                        continue
                    got_one = True
                    yield _frame("bars", json.dumps(msg), "bar")

                if not got_one:
                    # 250ms idle floor — MATCH stream_prices (deliberately slowed
                    # 100ms→250ms because every open tab holds one of these loops on the
                    # single shared event loop; 20Hz here was 2x that tuned budget). The
                    # broadcaster's 10Hz upstream throttle already caps freshness, so the
                    # extra ≤250ms drain latency is imperceptible.
                    await asyncio.sleep(0.25)

                if time.time() - last_heartbeat > 15:
                    # NAMED event (not a `:` comment): a bare comment keeps the
                    # connection alive through proxies but is NOT surfaced to
                    # EventSource as a JS event, so the pooled client's liveness
                    # watchdog could never see it and would false-reconnect a
                    # healthy-but-idle stream. A named heartbeat both keeps the
                    # pipe warm AND lets the client touch its last-seen timer.
                    yield _frame("bars", "{}", "heartbeat")
                    last_heartbeat = time.time()
        finally:
            unsubscribe("bars", _token)
            for (sym, tf, q) in queues:
                bb.unsubscribe(sym, tf, q)
            _logger.info("[stream_bars] disconnected, unsubscribed %d pairs", len(queues))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/stream/status")
def stream_status():
    """Return WebSocket stream connection status.

    Carries the admission-control counters too — `chat_stream.stats()` and
    `/curated-stream-status` already publish theirs, and a cap nobody can see
    hit is a cap nobody knows they hit.

    D3-D: `bars_overlay_live` names the SAME degradation the same sentence
    above already covers, one layer up. `/api/stream/prices`'s Massive
    broadcaster coupling is a best-effort `try/except: _bb = None` — if the
    bars overlay never initialized (`init_broadcaster` only runs under
    `STREAM_BARS_ENABLED == "1"`), every live quote silently falls back to
    Finnhub-only and nothing anywhere said so until now. Additive and
    read-only; no existing caller's behaviour changes.
    """
    out = dict(get_stream_status() or {})
    out["max_subscribers"] = MAX_SUBSCRIBERS
    out["subscribers"] = {name: len(conns) for name, conns in _subscribers.items()}
    try:
        from api.services.bar_broadcaster import get_broadcaster
        get_broadcaster()
        out["bars_overlay_live"] = True
    except Exception:
        out["bars_overlay_live"] = False
    return out
