"""
Server-Sent Events (SSE) endpoint for real-time price streaming.
Fans out WebSocket price data from Massive/Polygon to browser clients.
"""

import asyncio
import json
import logging
import math
import os
import threading
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


# ── the rows ahead (2026-11-25) ───────────────────────────────────────────────
# ⭐ A watchlist puts the next 1-2 rows the member is moving towards on its bars connection as `ahead=` pairs
# (app/src/lib/barsStreamManager.js AHEAD_MAX_PAIRS = 4 a page), so the first press after a minute roll finds that row
# as current as the chart on screen. They are SPECULATIVE: a refused one costs the member one wait after a roll (~100 ms),
# never a wrong chart. So they are the first thing this pod sheds:
#   * at most AHEAD_MAX_PER_CONN a connection (the client's own page cap; a rail reads it from the JS);
#   * a pod-wide budget, STREAM_MAX_AHEAD_PAIRS, admitted per connection at its open and released at its end (a member's
#     connection is rebuilt on every symbol switch, so the budget re-applies within seconds as load moves). Its default
#     (review of #2721, at 1 Hz) is what the load line lets through: ceil(0.8 x 300) x 4 = 960, so below the line the
#     budget never refuses and the shed is what binds; set the env var lower to cap it below that;
#   * none at all while the bars subscriber registry is at or past STREAM_AHEAD_LOAD_FRACTION of MAX_SUBSCRIBERS;
#   * they count against the same 50-pair cap per connection as the chart's own pairs (admitted after them).
# A refused ahead pair is simply not subscribed: the client keeps its old rule for that row (it asks after a roll).
# Counted in-process (one uvicorn process per pod): `ahead_stats()`, on /api/stream/status.
AHEAD_LOAD_FRACTION = float(os.environ.get("STREAM_AHEAD_LOAD_FRACTION", "0.8"))
AHEAD_MAX_PER_CONN = 4


def _default_max_ahead_pairs() -> int:
    """The most ahead pairs the load line can ever let through: every connection below it at its cap."""
    return math.ceil(AHEAD_LOAD_FRACTION * MAX_SUBSCRIBERS) * AHEAD_MAX_PER_CONN


MAX_AHEAD_PAIRS = int(os.environ.get("STREAM_MAX_AHEAD_PAIRS") or _default_max_ahead_pairs())
# ⭐ (review of #2721, 2026-11-25) AN AHEAD PAIR IS SENT AT ABOUT 1 Hz. A row ahead is not on screen: it needs its bar M at the
# next roll, not every trade. Its developing bar goes out at most once per AHEAD_INTERVAL_S (the newest value then), while
# every FINAL and a new bucket's first frame go out at the next poll; the chart's own pairs are untouched (every frame, at
# once). Ahead queues hold no pending get(): the generator drains them every AHEAD_POLL_S, so a frame the member will not
# see costs a queue put, never a wake of this loop, an encode or a write.
AHEAD_INTERVAL_S = float(os.environ.get("STREAM_AHEAD_INTERVAL_S", "1.0"))
AHEAD_POLL_S = 0.25
_ahead = {"live": 0, "admitted": 0, "refused": 0}


def _admit_ahead(n: int) -> int:
    """How many of `n` ahead pairs one connection may subscribe now (counted live until `_release_ahead`)."""
    if n <= 0:
        return 0
    if subscriber_count("bars") >= AHEAD_LOAD_FRACTION * MAX_SUBSCRIBERS:
        _ahead["refused"] += n
        return 0
    k = min(n, max(0, MAX_AHEAD_PAIRS - _ahead["live"]))
    _ahead["live"] += k
    _ahead["admitted"] += k
    _ahead["refused"] += n - k
    return k


def _release_ahead(k: int) -> None:
    _ahead["live"] = max(0, _ahead["live"] - k)


def ahead_stats() -> dict:
    """The rows-ahead counters: live (now), admitted / refused (since boot), and the budget."""
    return {**_ahead, "max": MAX_AHEAD_PAIRS, "load_fraction": AHEAD_LOAD_FRACTION}


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
        (plus last_state["__ohlc__"][sym] = (o, h, l) so bar_close is a full bar)

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
        ohlc = last_state.setdefault("__ohlc__", {})
        prev = last_state.get(sym_u)
        if prev == cur_key:
            continue
        # Detect bar boundary close: prev existed and prev_t != cur_t
        if prev and prev[0] != cur["t"]:
            # Emit bar_close for the prior bar — a FULL OHLCV bar (D1: it used to
            # carry only {t, c, v}, and the client stored it verbatim, painting
            # the just-closed 1m candle with undefined o/h/l until the next setData).
            bar = {"t": prev[0], "c": prev[1], "v": prev[2]}
            o, h, l = ohlc.get(sym_u) or (None, None, None)
            bar["o"] = o if o is not None else prev[1]
            bar["h"] = h if h is not None else max(bar["o"], prev[1])
            bar["l"] = l if l is not None else min(bar["o"], prev[1])
            events.append({
                "type": "bar_close",
                "sym": sym_u,
                "tf": "1",
                "bar": bar,
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
        ohlc[sym_u] = (cur.get("o"), cur.get("h"), cur.get("l"))
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


#: How much NEWER a Finnhub trade must be than the live feed's last trade before Finnhub's price is
#: sent (the two feeds stamp the same print within about a second of each other).
FRESHER_SOURCE_MARGIN_MS = 2000


def _trade_ms(v) -> int | None:
    """A trade time in epoch ms whatever unit it was stored in (Finnhub's trade handler keeps ms, the
    tick recorder seconds); None when absent or not a time."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not x > 0:
        return None
    return int(x) if x > 1e12 else int(x * 1000)


def _overlay_live(current: dict, sym: str, mp) -> None:
    """Overlay the MASSIVE live quote (`mp`, bar_broadcaster.get_last_price) on the Finnhub entry in
    `current`, in place. Only the price, the live day volume and the trade time are overlaid; the
    client recomputes the day % from the price and the REST previous close.

    ⭐ THE FRESHER SOURCE WINS (2026-11-17 audit, gap 2: stale shown as live). The live price used to
    overlay Finnhub's whenever it existed, so a symbol whose live trades stopped arriving (the vendor
    socket up, that symbol's flow lost) held a frozen price while Finnhub's own trades moved on. Now a
    Finnhub trade more than FRESHER_SOURCE_MARGIN_MS newer than the live one keeps its own price."""
    if not mp or mp.get("price") is None:
        return
    entry = current.get(sym)
    live_ms = _trade_ms(mp.get("trade_ts"))
    other_ms = _trade_ms(entry.get("timestamp")) if entry else None
    if live_ms is not None and other_ms is not None and other_ms - live_ms > FRESHER_SOURCE_MARGIN_MS:
        return
    if entry is None:
        entry = {}
        current[sym] = entry
    entry["price"] = mp["price"]
    # Live cumulative day volume (Massive `av`) overlays the 15s REST value so the Volume column ticks too.
    if mp.get("volume") is not None:
        entry["volume"] = mp["volume"]
    # Stamp the TRADE time, not this loop's send time: the client buckets the live price into a candle
    # by `updated_at`, and send time put a 9:59:59.9 print into the 10:00 candle. `trade_ts` (ms) is the
    # exact value; send time is only the fallback.
    tts = mp.get("trade_ts")
    if tts:
        entry["updated_at"] = int(tts // 1000)
        entry["trade_ts"] = int(tts)
    else:
        entry["updated_at"] = int(time.time())


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

        # This connection's OWN bounded correction queue, for its tickers
        # (drained once per loop). Subscribed inside the `try` so the `finally`
        # below unsubscribes it on every exit path -- a disconnect, a closed
        # body iterator, a cancelled task -- and a generator that is never
        # iterated never subscribes at all.
        correction_queue = None

        try:
            correction_queue = realtime_candle.subscribe_corrections(ticker_list)
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
                        _overlay_live(current, sym, _bb.get_last_price(sym))

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

                # Drain this connection's bar_correction events (non-blocking)
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
            realtime_candle.unsubscribe_corrections(correction_queue)
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


# D8 seed fetches (one provider REST call per newly streamed symbol) run on a
# SMALL DEDICATED pool, never the shared default executor every to_thread() in
# the app uses, and are BOUNDED: when _SEED_MAX_INFLIGHT are already queued or
# running (a fast scan across tickers), further seeds are skipped — the chart
# still streams, its bucket is "since subscribe" until the next AM-backed bucket.
_SEED_WORKERS = int(os.environ.get("STREAM_BARS_SEED_WORKERS", "4"))
_SEED_MAX_INFLIGHT = int(os.environ.get("STREAM_BARS_SEED_MAX_INFLIGHT", "16"))
_seed_pool = None
_seed_inflight = 0
_seed_skipped_total = 0
_seed_lock = threading.Lock()
#: Set by shutdown_seed_pool(): from then on no seed starts and no pool is made.
_seed_closed = False


def shutdown_seed_pool() -> None:
    """At process shutdown (the web lifespan's last steps): let the seed pool's IDLE workers exit now.

    Measured at a web pod swap: "[serve-dual] exiting with 4 non-daemon thread(s) still running after 5s:
    bars-seed_0..3" ("exit after 12.0s (shutdown 7.0s, join 5.00s)"). Idle ThreadPoolExecutor workers wait
    on the work queue until interpreter shutdown wakes them, which api/serve_dual.py's `os._exit` never
    reaches, so the bounded join spent its whole 5 s on them. The cold-preload pool's fix exactly
    (cold_start_guard.shutdown, #2478): `wait=False`, because a seed still running is a bars read for a
    stream that is going away and finishes on its own (the join bounds it); `cancel_futures=True`, because
    one not yet started never needs to. After this `_kick_seed` refuses (False, its "not started"), and
    no new pool is made. Safe to call twice, and when no stream ever made the pool. A seed cancelled here
    never runs its `finally`, so `_seed_inflight` stays one high per cancelled seed: harmless, every kick
    is already refused and the process is about to exit."""
    global _seed_pool, _seed_closed
    with _seed_lock:
        _seed_closed = True
        pool, _seed_pool = _seed_pool, None
    if pool is not None:
        pool.shutdown(wait=False, cancel_futures=True)


def _kick_seed(fn, sym: str) -> bool:
    """Run fn(sym) on the bounded seed pool. Returns False when it was skipped (saturated, or the
    process is shutting down: shutdown_seed_pool)."""
    global _seed_pool, _seed_inflight, _seed_skipped_total
    with _seed_lock:
        if _seed_closed:
            return False
        if _seed_inflight >= _SEED_MAX_INFLIGHT:
            _seed_skipped_total += 1
            return False
        if _seed_pool is None:
            from concurrent.futures import ThreadPoolExecutor
            _seed_pool = ThreadPoolExecutor(max_workers=_SEED_WORKERS, thread_name_prefix="bars-seed")
        pool = _seed_pool
        _seed_inflight += 1

    def _run():
        global _seed_inflight
        try:
            fn(sym)
        except Exception as e:  # noqa: BLE001
            _logger.debug("[stream_bars] seed failed for %s: %s", sym, type(e).__name__)
        finally:
            with _seed_lock:
                _seed_inflight -= 1

    try:
        pool.submit(_run)
    except Exception:  # noqa: BLE001 — pool shut down at exit (a kick racing shutdown_seed_pool)
        with _seed_lock:
            _seed_inflight -= 1
        return False
    return True


def _contract_event(bar_contract, msg: dict, session: str) -> dict:
    """⭐ BAR CONTRACT on a stream frame (docs/architecture/bar-contract.md): the same
    identity as the REST answer for this series (grid, session, cache_key, series_rev)
    plus the frame's own `rev` (set by the broadcaster) and `final` lifted from `bar`.
    `t_s` = the bucket start in unix SECONDS (REST's unit; `bar.t` stays ms for old
    clients). Additive; a failure leaves the frame exactly as the broadcaster built it."""
    try:
        out = dict(msg)
        out.update(bar_contract.stream_fields(msg.get("sym"), str(msg.get("tf")),
                                              msg.get("session") or session))
        bar = msg.get("bar") or {}
        out["final"] = bool(bar.get("final"))
        if isinstance(bar.get("t"), (int, float)):
            out["t_s"] = int(bar["t"]) // 1000
        return out
    except Exception:                      # noqa: BLE001
        return msg


@router.get("/api/stream/bars")
async def stream_bars(
    request: Request,
    bars: str = Query(..., description="Comma-separated SYM:TF pairs, e.g. AAPL:5,MSFT:1"),
    _access: dict = Depends(require_bars_access),
    session: str = Query("rth", description=(
        "60m bucket alignment, TradingView-style: 'rth' = 9:30, 10:30 ... 15:30 "
        "(default), 'eth' = clock hours 04:00 ... 19:00. 1-30m are identical in both.")),
    v: int = Query(1, description=(
        "Wire version. v=2 opts in to OLDER-t `final` correction frames (a late "
        "AM re-emitting a closed bucket). v=1 (default) never receives a frame "
        "older than one it already got, so legacy consumers that take bar.c as "
        "the live price cannot snap back.")),
    last_event_id: str | None = Query(None, description=(
        "Id of the last event a reconnecting client received (the pooled "
        "manager's door; a browser auto-reconnect sends the Last-Event-ID "
        "header instead). Answered with an `event: resume` declaration.")),
    ahead: str | None = Query(None, description=(
        "Comma-separated SYM:TF pairs of the rows the member is about to reach "
        "(a watchlist's next rows). Speculative: admitted within the pod's "
        "STREAM_MAX_AHEAD_PAIRS budget and never under load; a refused one is "
        "simply not subscribed.")),
):
    """SSE — streams real-time bar updates per (symbol, timeframe).

    Connect via EventSource:
      const es = new EventSource('/api/stream/bars?bars=AAPL:5,MSFT:1')
      es.addEventListener('bar', e => { const {sym, tf, bar} = JSON.parse(e.data) })

    Each `event: bar` message contains the latest in-progress (or just-closed) bar
    for the (sym, tf) pair: {sym, tf, bar: {t, o, h, l, c, v, final, trade_ts?}}
    (+ `session` on 60m). `final: true` = the bucket is closed; a later
    `final` for the same `t` is an authoritative correction — replace that bar.

    Every frame carries `id:`. A reconnect presenting a Last-Event-ID gets an
    `event: resume` first frame declaring resume not applicable (last-value-wins,
    zero events replayed); each pair's next bar supersedes what was missed.
    """
    if os.environ.get("STREAM_BARS_ENABLED") != "1":
        return JSONResponse({"error": "Bar streaming disabled"}, status_code=503)

    def _parse_pairs(raw_list: str) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for raw in raw_list.split(","):
            s = raw.strip()
            if not s or ":" not in s:
                continue
            sym, tf = s.split(":", 1)
            sym = sym.strip().upper()
            tf = tf.strip()
            if sym and tf in ("1", "5", "15", "30", "60"):  # 60-min uses canonical ET-anchored bucket
                out.append((sym, tf))
        return out

    pairs: list[tuple[str, str]] = _parse_pairs(bars)

    if not pairs:
        return JSONResponse({"error": "No valid sym:tf pairs"}, status_code=400)
    session = (session if isinstance(session, str) else "rth").strip().lower() or "rth"
    if session not in ("rth", "eth"):
        return JSONResponse({"error": "session must be rth or eth"}, status_code=400)
    pairs = pairs[:MAX_BARS_PAIRS]  # cap to prevent runaway subscriptions per connection
    # the rows ahead: never a pair the chart already holds, within the same 50-pair cap, after the chart's own
    ahead_pairs: list[tuple[str, str]] = []
    for pair in (_parse_pairs(ahead) if isinstance(ahead, str) else []):
        if pair not in pairs and pair not in ahead_pairs:
            ahead_pairs.append(pair)
    ahead_pairs = ahead_pairs[:max(0, min(AHEAD_MAX_PER_CONN, MAX_BARS_PAIRS - len(pairs)))]

    # Admission BEFORE the broadcaster subscribe, for the same reason as
    # /api/stream/prices: a refused connection must leave no queues behind.
    _token = subscribe("bars")
    if _token is None:
        return _at_capacity("bars")
    # (after the connection's own admission, so the load line counts it)
    ahead_pairs = ahead_pairs[:_admit_ahead(len(ahead_pairs))]
    n_ahead = len(ahead_pairs)

    # ⛔ (review of #2721, LOW) EVERYTHING ADMITTED IS RELEASED IF THE STREAM NEVER STARTS: a failure between the admission
    # and the response (a broadcaster that raises) used to leave the connection's token and its ahead budget counted until
    # the process restarted, and the queues already made behind.
    queues: list = []
    bb = None
    try:
        from api.services.bar_broadcaster import get_broadcaster
        bb = get_broadcaster()
        v2 = isinstance(v, int) and v >= 2

        def _sub(sym, tf):
            kw = {}
            if session != "rth":
                kw["session"] = session
            if v2:
                kw["v2"] = True
            return bb.subscribe(sym, tf, **kw)

        for (sym, tf) in pairs + ahead_pairs:
            queues.append((sym, tf, _sub(sym, tf)))
        from api.services import bar_contract as _bar_contract
        _logger.info("[stream_bars] subscribed %d pairs (+%d ahead): %s", len(pairs), n_ahead, pairs[:10])
        # D8: fold the day's stored/REST minute bars into each symbol's minute map
        # (once per upstream subscription) so a mid-bucket subscriber gets the true
        # bucket-to-date O/H/L/V. Off the event loop; the broadcaster re-emits the
        # corrected bucket when the seed lands. Best-effort: a failed seed only
        # means "bucket since subscribe" until the next AM-backed bucket.
        _seed = getattr(bb, "ensure_seeded", None)
        if _seed is not None:
            for _sym in sorted({p[0] for p in pairs + ahead_pairs}):
                _kick_seed(_seed, _sym)

        resume = _resume_declaration("bars", _requested_last_event_id(request, last_event_id))
    except BaseException:
        unsubscribe("bars", _token)
        _release_ahead(n_ahead)
        for (sym, tf, q) in queues:
            try:
                if session == "rth":
                    bb.unsubscribe(sym, tf, q)
                else:
                    bb.unsubscribe(sym, tf, q, session)
            except Exception:  # noqa: BLE001 - releasing what was made, never a second failure
                pass
        raise
    n_chart = len(queues) - n_ahead   # queues[:n_chart] are the chart's pairs, the rest the rows ahead

    async def event_generator():
        last_heartbeat = time.time()
        # ⭐ EVENT-DRIVEN, NOT POLLED (2026-11-16). One pending `get()` per subscribed pair; the
        # loop wakes the moment any queue receives a frame and sends it. This replaced a poll that
        # slept 250 ms whenever nothing was ready, so a frame landing during the sleep waited up to
        # 250 ms (~125 ms on average) before leaving the pod: production measured exchange -> pod
        # dequeue at most 100 ms at the median and ~310 ms exchange -> browser, so most of the gap
        # was this wait. It also costs less CPU than the poll it replaced (the reason the poll was
        # slowed from 100 ms): an idle connection wakes once a second (WAIT_S) to notice a
        # disconnect and keep the heartbeat on time, instead of four times a second.
        WAIT_S = 1.0
        getters: dict[int, asyncio.Task] = {}
        # the rows ahead (see AHEAD_INTERVAL_S): per ahead queue, the last developing frame sent (bucket t, monotonic s)
        # and the newest one not sent yet
        ahead_sent: dict[int, tuple] = {}
        ahead_pend: dict[int, dict] = {}
        ahead_final: dict[int, int] = {}
        # ⭐ THE UPSTREAM'S WORD, AS IT CHANGES (2026-11-18). A mirror of stream-ingest (web in
        # remote mode, stream-edge) knows when the Massive socket behind it is down (`feed_fresh`:
        # ingest's `connect` status, or no batch at all). Without telling the browser, a chart kept
        # `delivering` for up to 150 s of silence (barsStreamManager's hysteresis) with the Finnhub
        # tick writers suppressed: a frozen candle. `event: status` {"live": bool} goes out once at
        # the start and on every change; the browser drops `delivering` at once on live:false. A
        # broadcaster without `feed_fresh` (web's own socket, local mode) sends none, as before.
        feed_live = getattr(bb, "feed_fresh", None)
        last_live = None
        try:
            if resume is not None:
                yield _frame("bars", json.dumps(resume), "resume")
            while True:
                if await request.is_disconnected():
                    break
                if feed_live is not None:
                    try:
                        live = bool(feed_live())
                    except Exception:  # noqa: BLE001 - a status read must never end the stream
                        live = None
                    if live is not None and live != last_live:
                        last_live = live
                        yield _frame("bars", json.dumps({"live": live}), "status")
                for i, (_sym, _tf, q) in enumerate(queues[:n_chart]):
                    if i not in getters:
                        getters[i] = asyncio.ensure_future(q.get())
                wait_s = min(WAIT_S, AHEAD_POLL_S) if n_ahead else WAIT_S
                if getters:
                    done, _pending = await asyncio.wait(
                        set(getters.values()), timeout=wait_s, return_when=asyncio.FIRST_COMPLETED)
                else:
                    done = set()
                    await asyncio.sleep(wait_s)
                # Pairs in subscription order; within a pair, the frame the getter took and then
                # whatever queued behind it, so each pair's frames keep their order.
                for i, (_sym, _tf, q) in enumerate(queues):
                    task = getters.get(i)
                    if task is None or task not in done:
                        continue
                    del getters[i]
                    msg = task.result()
                    yield _frame("bars", json.dumps(_contract_event(_bar_contract, msg, session)), "bar")
                    while True:
                        try:
                            msg = q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                        yield _frame("bars", json.dumps(_contract_event(_bar_contract, msg, session)), "bar")

                # the rows ahead: drained here, never awaited (see AHEAD_INTERVAL_S)
                if n_ahead:
                    now_m = time.monotonic()
                    for j in range(n_chart, len(queues)):
                        q = queues[j][2]
                        while True:
                            try:
                                msg = q.get_nowait()
                            except asyncio.QueueEmpty:
                                break
                            bar = msg.get("bar") if isinstance(msg, dict) else None
                            t = bar.get("t") if isinstance(bar, dict) else None
                            final = bool(bar.get("final")) if isinstance(bar, dict) else False
                            last = ahead_sent.get(j)
                            if not final and t is not None and ahead_final.get(j) is not None and t <= ahead_final[j]:
                                continue                      # a developing frame of a bucket already sent final
                            if final and t is not None:
                                ahead_final[j] = max(t, ahead_final.get(j, t))
                            if final or last is None or t != last[0]:
                                # a final, the pair's first frame, or a new bucket: now. A held developing frame of the
                                # bucket it closes, or of an older bucket, is superseded (its final comes, or came).
                                held = ahead_pend.get(j)
                                if held is not None and (held.get("bar") or {}).get("t") != t and not final:
                                    ahead_pend.pop(j, None)
                                elif held is not None and final and (held.get("bar") or {}).get("t") == t:
                                    ahead_pend.pop(j, None)
                                yield _frame("bars", json.dumps(_contract_event(_bar_contract, msg, session)), "bar")
                                if not final:
                                    ahead_sent[j] = (t, now_m)
                            else:
                                ahead_pend[j] = msg          # the same bucket, developing: the newest wins
                        held = ahead_pend.get(j)
                        last = ahead_sent.get(j)
                        if held is not None and last is not None and now_m - last[1] >= AHEAD_INTERVAL_S:
                            ahead_pend.pop(j, None)
                            yield _frame("bars", json.dumps(_contract_event(_bar_contract, held, session)), "bar")
                            ahead_sent[j] = ((held.get("bar") or {}).get("t"), now_m)

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
            for task in getters.values():   # a disconnect leaves one pending get() per pair
                task.cancel()
            unsubscribe("bars", _token)
            _release_ahead(n_ahead)
            for (sym, tf, q) in queues:
                if session == "rth":
                    bb.unsubscribe(sym, tf, q)
                else:
                    bb.unsubscribe(sym, tf, q, session)
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
    out["ahead"] = ahead_stats()
    try:
        from api.services.bar_broadcaster import get_broadcaster
        get_broadcaster()
        out["bars_overlay_live"] = True
    except Exception:
        out["bars_overlay_live"] = False
    # The bars market-publication probe (review #2732): `stale_probes` counts probe rounds whose watermark trailed
    # the frontier by > 2 min — thin names then stay `unverified` and every poll costs a heal.
    try:
        from api.services.bars_fetch import market_probe_status
        out["bars_market_probe"] = market_probe_status()
    except Exception:
        out["bars_market_probe"] = None
    return out
