# Phase 4 — Real-Time Bar Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream minute-aggregate (`AM`) bars from Massive WebSocket → server broadcaster → SSE → React hook → `StockChart.jsx` so the chart's current bar updates without REST polling, and 5/15/30-min charts roll up server-side from 1-min bars. (60-min deferred to v1.1 because existing 60-min bars are ET-anchored, not UTC-aligned.)

**Architecture:** A new background asyncio task on the **web** service connects to `wss://socket.massive.com/stocks`, authenticates with `MASSIVE_API_KEY`, subscribes lazily to `AM.<sym>` channels for symbols any SSE client is watching, and pushes parsed bars into an in-memory `BarBroadcaster`. The broadcaster maintains per-(sym, tf) ring buffers and per-(sym, tf) subscriber sets; a roll-up module aggregates incoming 1-min bars into 5/15/30/60-min bars and emits them at boundary-close. `/api/stream/bars?bars=AAPL:5,MSFT:1` is a new SSE endpoint on `api/routers/stream.py` that follows the same disconnect-cleanup pattern as `/api/stream/prices`. Client side, `useRealtimeBars(symbol, tf)` opens an EventSource, calls `series.update()` on `lightweight-charts` when bars arrive, and on reconnect fires one `/api/bars/{ticker}?since=<lastBarT>` REST call for gap fill. Everything is gated behind `STREAM_BARS_ENABLED` (backend env) and `VITE_REALTIME_BARS` (frontend build flag) for instant rollback.

**Tech Stack:** Python 3.12 + `websockets` (already in `requirements.txt`), FastAPI lifespan + `StreamingResponse` (existing pattern in `api/routers/stream.py`), threaded asyncio loop (mirroring `realtime_stream.py`), React 18 + EventSource + TradingView Lightweight Charts v5 (existing in `StockChart.jsx`).

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `api/services/bar_stream.py` | **Create** | Massive WS client: connect, auth, subscribe/unsubscribe, parse `AM` events, reconnect with exponential backoff |
| `api/services/bar_stream_test.py` | **Create** | Unit tests for parser, subscribe queue, reconnect |
| `api/services/bar_rollup.py` | **Create** | Pure functions: aggregate 1-min bars into 5/15/30-min bars + boundary detection |
| `api/services/bar_rollup_test.py` | **Create** | Unit tests for aggregation, boundaries, partial bars |
| `api/services/bar_broadcaster.py` | **Create** | In-memory per-(sym,tf) state + thread-safe subscriber set + roll-up dispatch |
| `api/services/bar_broadcaster_test.py` | **Create** | Unit tests for state, subscribe/unsubscribe, broadcast |
| `api/main.py` | **Modify** | Start `bar_stream` task in lifespan when `STREAM_BARS_ENABLED=1` |
| `api/routers/stream.py` | **Modify** | Add `GET /api/stream/bars` SSE endpoint |
| `app/src/hooks/useRealtimeBars.js` | **Create** | EventSource wrapper: parse `event: bar`, call `onBar` callback, gap-backfill on reconnect |
| `app/src/components/StockChart.jsx` | **Modify** | Use the hook behind `VITE_REALTIME_BARS`; coexist with existing tick-driven `liveBarRef`/`lastBarRef` logic |
| `api/routers/bars.py` | **No change** | `since` query param + `{ticker, tf, bars}` shape already exist |
| `requirements.txt` | **No change** | `websockets>=12.0` and `pytest-asyncio==0.24.0` already present |

---

## Environment Variables Added

| Var | Service | Purpose |
|---|---|---|
| `STREAM_BARS_ENABLED` | web (Railway) | `1` to start the bar-stream WS thread; default off for safe rollback |
| `MASSIVE_WS_URL` | web (Railway) | `wss://socket.massive.com/stocks` (override-able for testing) |
| `MASSIVE_API_KEY` | web (Railway) | **Already set** — reused from REST client |
| `VITE_REALTIME_BARS` | web build (Railway) | `1` to compile in the realtime hook; default off |

---

### Task 1: `bar_rollup.py` — pure aggregation functions

**Files:**
- Create: `api/services/bar_rollup.py`
- Test: `api/services/bar_rollup_test.py`

This is pure compute, no IO. Build it first because the broadcaster and stream client both depend on it.

- [ ] **Step 1: Write the failing test for `bucket_start`**

Create `api/services/bar_rollup_test.py`:

```python
"""Unit tests for bar_rollup."""
import pytest

from api.services.bar_rollup import (
    bucket_start, aggregate, TF_TO_SECONDS,
)


def test_bucket_start_5min_aligns_to_minute_boundary():
    # 2026-05-05 14:32:17 ET == 2026-05-05 18:32:17 UTC == 1778005937000 ms
    # 5-min bucket starts at 14:30:00 ET == 18:30:00 UTC == 1778005800000 ms
    ts_ms = 1778005937000
    expected = 1778005800000
    assert bucket_start(ts_ms, "5") == expected


def test_bucket_start_15min_aligns():
    # Same 14:32:17 ET → bucket starts 14:30:00 (15-min)
    assert bucket_start(1778005937000, "15") == 1778005800000


def test_bucket_start_30min_aligns():
    # Same 14:32:17 ET → bucket starts 14:30:00 (30-min)
    assert bucket_start(1778005937000, "30") == 1778005800000


def test_bucket_start_60min_not_supported_in_v1():
    # 60-min uses ET-anchored buckets per existing _session_resample_hourly;
    # UTC rounding would mismatch. Defer to v1.1.
    with pytest.raises(ValueError):
        bucket_start(1778005937000, "60")


def test_bucket_start_unknown_tf_raises():
    with pytest.raises(ValueError):
        bucket_start(1778005937000, "D")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest api/services/bar_rollup_test.py -v
```

Expected: `ImportError: cannot import name 'bucket_start' from 'api.services.bar_rollup'`

- [ ] **Step 3: Implement `bar_rollup.py`**

Create `api/services/bar_rollup.py`:

```python
"""Aggregate 1-minute bars into multi-minute timeframes.

Polygon/Massive AM events deliver 1-minute OHLCV bars. For a 5/15/30-minute (60-min excluded in v1; see bar_rollup.py)
chart we accumulate consecutive 1-min bars in the same bucket and emit when the
bucket closes. Pure functions only — IO and state live in bar_broadcaster.
"""
from typing import Optional

# Supported intraday timeframes that roll up from 1-min bars.
# D/W are not in this list — those use end-of-day data via the existing prewarmer/SQLite path.
# 60-min is NOT included in v1: existing 60-min bars in the codebase are
# ET-anchored (9:30-10:30 = first hour bucket) per api/services/bars_fetch
# `_session_resample_hourly`, which UTC-rounding here would mismatch. Add ET-aware
# 60-min support in v1.1 — see Future Enhancements.
TF_TO_SECONDS = {
    "1":  60,
    "5":  300,
    "15": 900,
    "30": 1800,
}


def bucket_start(ts_ms: int, tf: str) -> int:
    """Return the start-of-bucket timestamp (ms) that contains ts_ms for the given tf.

    Raises ValueError if tf is not one of TF_TO_SECONDS keys.
    """
    if tf not in TF_TO_SECONDS:
        raise ValueError(f"Unsupported timeframe for rollup: {tf!r}")
    sec = TF_TO_SECONDS[tf]
    bucket_sec = (ts_ms // 1000) // sec * sec
    return bucket_sec * 1000


def aggregate(prev: Optional[dict], bar: dict) -> dict:
    """Merge a new 1-min bar into the partial bucket bar.

    `prev` is the in-progress bar for this bucket, or None if this is the first bar.
    `bar` is a single 1-min bar with keys: t (ms), o, h, l, c, v.
    Returns the new partial bucket bar.
    """
    if prev is None:
        return {
            "t": bar["t"],   # bucket start (caller computes via bucket_start before first call)
            "o": bar["o"],
            "h": bar["h"],
            "l": bar["l"],
            "c": bar["c"],
            "v": bar["v"],
        }
    return {
        "t": prev["t"],
        "o": prev["o"],
        "h": max(prev["h"], bar["h"]),
        "l": min(prev["l"], bar["l"]),
        "c": bar["c"],
        "v": prev["v"] + bar["v"],
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest api/services/bar_rollup_test.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Add aggregation tests**

Append to `api/services/bar_rollup_test.py`:

```python
def test_aggregate_first_bar_produces_partial_bucket():
    bar = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    out = aggregate(None, bar)
    assert out == {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}


def test_aggregate_extends_high_low_and_sums_volume():
    prev = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bar  = {"t": 1778005860000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    out = aggregate(prev, bar)
    assert out["o"] == 100.0   # open from first bar of bucket
    assert out["h"] == 102.0   # extended high
    assert out["l"] == 99.5    # unchanged low
    assert out["c"] == 101.8   # close from latest bar
    assert out["v"] == 1750    # summed volume
    assert out["t"] == 1778005800000  # bucket start unchanged


def test_aggregate_does_not_lower_existing_low():
    prev = {"t": 1778005800000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bar  = {"t": 1778005860000, "o": 100.5, "h": 100.7, "l": 100.4, "c": 100.6, "v": 500}
    out = aggregate(prev, bar)
    assert out["l"] == 99.5  # not raised — keeps prev low even though new bar's low is higher
```

- [ ] **Step 6: Run all tests**

```bash
pytest api/services/bar_rollup_test.py -v
```

Expected: 8 passed.

- [ ] **Step 7: Commit**

```bash
git add api/services/bar_rollup.py api/services/bar_rollup_test.py
git commit -m "feat(phase-4): add bar_rollup pure aggregation functions"
```

---

### Task 2: `bar_stream.py` — Massive WebSocket client

**Files:**
- Create: `api/services/bar_stream.py`
- Test: `api/services/bar_stream_test.py`

Mirrors the structural pattern of `api/services/realtime_stream.py` (background asyncio loop in a daemon thread, reconnect with backoff, thread-safe subscribe/unsubscribe queue), but consumes `AM` events instead of Finnhub trade ticks and forwards parsed bars to `BarBroadcaster` via callback.

- [ ] **Step 1: Write the failing test for `parse_am_event`**

Create `api/services/bar_stream_test.py`:

```python
"""Unit tests for bar_stream parsing and subscription queue."""
import pytest

from api.services.bar_stream import parse_am_event, BarStreamClient


def test_parse_am_event_extracts_ohlcv_and_symbol():
    # Massive/Polygon AM event shape (camel-compatible with Polygon docs):
    # ev=event type, sym=symbol, o/h/l/c=OHLC, v=volume in this minute,
    # s=start of aggregate (ms), e=end of aggregate (ms)
    raw = {
        "ev": "AM", "sym": "AAPL",
        "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40,
        "v": 12500, "s": 1746468600000, "e": 1746468660000,
    }
    out = parse_am_event(raw)
    assert out == {
        "sym": "AAPL",
        "bar": {"t": 1746468600000, "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40, "v": 12500},
    }


def test_parse_am_event_returns_none_on_non_am():
    # Status / other event types must be filtered out at the parse layer
    assert parse_am_event({"ev": "status", "status": "auth_success"}) is None
    assert parse_am_event({"ev": "T", "sym": "AAPL", "p": 150.0}) is None  # trade tick


def test_parse_am_event_returns_none_on_missing_fields():
    assert parse_am_event({"ev": "AM", "sym": "AAPL"}) is None  # missing OHLCV
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest api/services/bar_stream_test.py -v
```

Expected: `ImportError: cannot import name 'parse_am_event'`

- [ ] **Step 3: Implement skeleton of `bar_stream.py`**

Create `api/services/bar_stream.py`:

```python
"""Real-time bar streaming via Massive WebSocket.

Connects to wss://socket.massive.com/stocks (Polygon-protocol-compatible),
authenticates with MASSIVE_API_KEY, subscribes to AM.<sym> channels for
the lazy-managed active set, and forwards parsed 1-min bars to a callback
(usually BarBroadcaster.push_minute_bar).

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

OnBarCallback = Callable[[str, dict], None]  # (symbol, bar_dict) -> None


def parse_am_event(raw: dict) -> Optional[dict]:
    """Validate + normalize a Massive AM event into {sym, bar} or return None.

    Returns None for non-AM events (status, T, Q, etc.) and AM events missing
    required OHLCV fields. Caller should treat None as "skip silently".
    """
    if not isinstance(raw, dict) or raw.get("ev") != "AM":
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
        },
    }


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
    """Polygon-compatible subscribe message: AM.AAPL,AM.MSFT comma-joined."""
    params = ",".join(f"AM.{s}" for s in sorted(syms))
    return json.dumps({"action": "subscribe", "params": params})


def _build_unsubscribe_message(syms: Iterable[str]) -> str:
    params = ",".join(f"AM.{s}" for s in sorted(syms))
    return json.dumps({"action": "unsubscribe", "params": params})


def _build_auth_message(api_key: str) -> str:
    return json.dumps({"action": "auth", "params": api_key})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest api/services/bar_stream_test.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Add subscribe-queue tests**

Append to `api/services/bar_stream_test.py`:

```python
def test_queue_subscribe_adds_to_active_and_pending():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL", "msft"])  # mixed-case input must be uppercased
    assert c.active == {"AAPL", "MSFT"}
    assert c.pending_subscribe == {"AAPL", "MSFT"}
    assert c.pending_unsubscribe == set()


def test_queue_subscribe_does_not_re_add_existing():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL"])
    c.pending_subscribe.clear()  # simulate "we already sent the SUB on the wire"
    c.queue_subscribe(["AAPL"])  # idempotent re-add
    assert c.pending_subscribe == set()


def test_queue_unsubscribe_removes_from_active():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL", "MSFT"])
    c.pending_subscribe.clear()
    c.queue_unsubscribe(["AAPL"])
    assert c.active == {"MSFT"}
    assert c.pending_unsubscribe == {"AAPL"}


def test_queue_unsubscribe_then_resubscribe_cancels_unsub():
    c = BarStreamClient()
    c.queue_subscribe(["AAPL"])
    c.pending_subscribe.clear()
    c.queue_unsubscribe(["AAPL"])
    c.queue_subscribe(["AAPL"])
    assert "AAPL" in c.active
    assert c.pending_unsubscribe == set()    # canceled
    assert c.pending_subscribe == {"AAPL"}    # re-queued
```

- [ ] **Step 6: Run all tests**

```bash
pytest api/services/bar_stream_test.py -v
```

Expected: 7 passed.

- [ ] **Step 7: Add the `_run_websocket` async loop**

Append to `api/services/bar_stream.py`:

```python
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

                # Auth handshake
                await ws.send(_build_auth_message(_API_KEY))
                # Massive sends a status frame back; we don't block on it but we do
                # log it for ops visibility.
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
                            parsed = parse_am_event(ev)
                            if parsed is None:
                                # Log status events at info level for ops visibility
                                if isinstance(ev, dict) and ev.get("ev") == "status":
                                    _logger.info("[bar_stream] status: %s", ev.get("status"))
                                continue
                            try:
                                on_bar(parsed["sym"], parsed["bar"])
                            except Exception as cb_err:
                                _logger.warning("[bar_stream] on_bar callback error: %s", cb_err)
                finally:
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
                    _pending_subscribe |= set(sub)  # re-queue
        if unsub:
            try:
                await ws.send(_build_unsubscribe_message(unsub))
            except Exception as e:
                _logger.warning("[bar_stream] unsubscribe flush failed: %s", e)
                with _state_lock:
                    _pending_unsubscribe |= set(unsub)


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

    def _thread_target():
        global _ws_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _ws_loop = loop
        loop.run_until_complete(_run_websocket(on_bar))

    threading.Thread(target=_thread_target, daemon=True, name="bar-stream").start()
    _logger.info("[bar_stream] thread started")
```

- [ ] **Step 8: Run tests to confirm nothing broke**

```bash
pytest api/services/bar_stream_test.py -v
```

Expected: 7 passed (the new code does not affect existing tests).

- [ ] **Step 9: Commit**

```bash
git add api/services/bar_stream.py api/services/bar_stream_test.py
git commit -m "feat(phase-4): add Massive WS client (bar_stream) with parser, sub queue, reconnect"
```

---

### Task 3: `bar_broadcaster.py` — state + subscriber routing

**Files:**
- Create: `api/services/bar_broadcaster.py`
- Test: `api/services/bar_broadcaster_test.py`

The broadcaster owns:
- A per-(sym, tf) ring buffer of recent bars (last 5 closed + 1 in-progress)
- A per-(sym, tf) set of asyncio Queues (one per SSE client)
- Reference counting so we know when no one is watching a symbol → unsubscribe upstream

When a 1-min bar arrives via `push_minute_bar(sym, bar)`, the broadcaster:
1. Updates the (sym, "1") in-progress bar (and emits to subscribers)
2. For each tf in (5, 15, 30, 60), bucket-aggregates the new bar into the in-progress (sym, tf) bar via `bar_rollup.aggregate` and emits the (possibly-still-partial) bucket bar
3. If the new minute closes a bucket, finalizes that bucket bar and starts a new one

- [ ] **Step 1: Write the failing test for `BarBroadcaster.push_minute_bar` emits to (sym, "1")**

Create `api/services/bar_broadcaster_test.py`:

```python
"""Unit tests for BarBroadcaster."""
import asyncio
import pytest

from api.services.bar_broadcaster import BarBroadcaster


@pytest.fixture
def bb():
    return BarBroadcaster()


@pytest.mark.asyncio
async def test_push_minute_bar_emits_to_1min_subscriber(bb):
    q = bb.subscribe("AAPL", "1")
    bar = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bb.push_minute_bar("AAPL", bar)
    out = await asyncio.wait_for(q.get(), timeout=0.1)
    assert out == {"sym": "AAPL", "tf": "1", "bar": bar}


@pytest.mark.asyncio
async def test_push_minute_bar_does_not_emit_to_unsubscribed_symbol(bb):
    q = bb.subscribe("MSFT", "1")
    bb.push_minute_bar("AAPL", {"t": 1746468600000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q.get(), timeout=0.05)


@pytest.mark.asyncio
async def test_unsubscribe_removes_queue(bb):
    q = bb.subscribe("AAPL", "1")
    bb.unsubscribe("AAPL", "1", q)
    bb.push_minute_bar("AAPL", {"t": 1746468600000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q.get(), timeout=0.05)
```

- [ ] **Step 2: Confirm pytest-asyncio is installed**

```bash
pip show pytest-asyncio
```

`pytest-asyncio==0.24.0` is already in `requirements.txt` (verified). If it's not installed in your local venv, run `pip install pytest-asyncio==0.24.0`.

Confirm `pytest.ini` has `asyncio_mode = auto`. If not, add it under `[pytest]`:

```ini
[pytest]
asyncio_mode = auto
```

Verify by running `pytest api/services/bar_broadcaster_test.py -v` (it will fail with import error, that's expected).

- [ ] **Step 3: Implement `BarBroadcaster`**

Create `api/services/bar_broadcaster.py`:

```python
"""In-memory state and subscriber routing for real-time bars.

For each (symbol, timeframe) we maintain:
- An in-progress bar (latest bucket, possibly still being filled by 1-min bars)
- A set of asyncio Queues, one per connected SSE client subscribed to that pair

When a fresh 1-min bar arrives:
- Emit it to (sym, "1") subscribers as-is
- For tf in (5, 15, 30, 60): aggregate into the (sym, tf) in-progress bar and emit the
  partial bucket bar to subscribers. When the new minute closes a bucket, the next minute
  bar starts a new bucket.

Reference counting: subscribe() returns a Queue. Caller must call unsubscribe() with the
same queue when done. on_last_unsubscribe is invoked when (sym, *) drops to zero
subscribers across all timeframes — used to tell bar_stream.py to unsubscribe upstream.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Callable, Optional

from api.services.bar_rollup import TF_TO_SECONDS, aggregate, bucket_start

_logger = logging.getLogger(__name__)

ROLLUP_TFS = ("5", "15", "30")  # we don't roll up "1" — it's pass-through. "60" excluded in v1 (ET-anchor needed).


class BarBroadcaster:
    def __init__(self,
                 on_first_subscribe: Optional[Callable[[str], None]] = None,
                 on_last_unsubscribe: Optional[Callable[[str], None]] = None):
        self._partials: dict[tuple[str, str], dict] = {}     # (sym, tf) -> in-progress bar
        self._subscribers: dict[tuple[str, str], set[asyncio.Queue]] = {}
        self._lock = threading.Lock()
        self._on_first_subscribe = on_first_subscribe or (lambda sym: None)
        self._on_last_unsubscribe = on_last_unsubscribe or (lambda sym: None)

    # ── Subscription management (called from SSE endpoint coroutines) ──

    def subscribe(self, sym: str, tf: str) -> asyncio.Queue:
        sym = sym.upper()
        if tf != "1" and tf not in ROLLUP_TFS:
            raise ValueError(f"Unsupported tf: {tf!r}")
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        key = (sym, tf)
        with self._lock:
            had_any = self._symbol_has_any_subscriber(sym)
            self._subscribers.setdefault(key, set()).add(q)
        if not had_any:
            try:
                self._on_first_subscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)
        return q

    def unsubscribe(self, sym: str, tf: str, q: asyncio.Queue) -> None:
        sym = sym.upper()
        key = (sym, tf)
        with self._lock:
            subs = self._subscribers.get(key)
            if subs and q in subs:
                subs.discard(q)
                if not subs:
                    self._subscribers.pop(key, None)
            still_any = self._symbol_has_any_subscriber(sym)
        if not still_any:
            try:
                self._on_last_unsubscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    def _symbol_has_any_subscriber(self, sym: str) -> bool:
        return any(s == sym for (s, _tf) in self._subscribers.keys())

    # ── Inbound from bar_stream ──

    def push_minute_bar(self, sym: str, bar: dict) -> None:
        """Called from bar_stream's on_bar callback (background asyncio loop)."""
        sym = sym.upper()
        # 1-min: pass-through
        self._emit(sym, "1", bar)
        # 5/15/30/60: bucket-aggregate
        for tf in ROLLUP_TFS:
            new_start = bucket_start(bar["t"], tf)
            key = (sym, tf)
            with self._lock:
                prev = self._partials.get(key)
                if prev is None or prev["t"] != new_start:
                    # New bucket: replace partial with first-bar-of-bucket
                    next_partial = aggregate(None, {**bar, "t": new_start})
                else:
                    next_partial = aggregate(prev, bar)
                self._partials[key] = next_partial
                emit_bar = dict(next_partial)
            self._emit(sym, tf, emit_bar)

    # ── Internal: dispatch to subscriber queues ──

    def _emit(self, sym: str, tf: str, bar: dict) -> None:
        key = (sym, tf)
        with self._lock:
            queues = list(self._subscribers.get(key, ()))
        msg = {"sym": sym, "tf": tf, "bar": bar}
        for q in queues:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # Slow consumer — drop the oldest, push the new. Real-time data:
                # freshness > completeness.
                try:
                    q.get_nowait()
                    q.put_nowait(msg)
                except Exception:
                    pass

    def get_status(self) -> dict:
        with self._lock:
            return {
                "subscriber_pairs": len(self._subscribers),
                "tracked_partials": len(self._partials),
                "symbols": sorted({s for (s, _) in self._subscribers.keys()}),
            }


# Module-level singleton — initialized at app startup, importable everywhere
_singleton: Optional[BarBroadcaster] = None


def get_broadcaster() -> BarBroadcaster:
    global _singleton
    if _singleton is None:
        raise RuntimeError("BarBroadcaster not initialized — call init_broadcaster() first")
    return _singleton


def init_broadcaster(*, on_first_subscribe=None, on_last_unsubscribe=None) -> BarBroadcaster:
    global _singleton
    _singleton = BarBroadcaster(
        on_first_subscribe=on_first_subscribe,
        on_last_unsubscribe=on_last_unsubscribe,
    )
    return _singleton
```

- [ ] **Step 4: Run tests**

```bash
pytest api/services/bar_broadcaster_test.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Add roll-up tests**

Append to `api/services/bar_broadcaster_test.py`:

```python
@pytest.mark.asyncio
async def test_push_minute_bar_aggregates_into_5min_bucket(bb):
    q5 = bb.subscribe("AAPL", "5")
    # First minute of a new 5-min bucket (14:30:00 ET = 1746468600000 ms)
    bar1 = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bb.push_minute_bar("AAPL", bar1)
    msg1 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg1["tf"] == "5"
    assert msg1["bar"]["t"] == 1746468600000  # bucket start
    assert msg1["bar"]["o"] == 100.0
    assert msg1["bar"]["c"] == 100.5
    assert msg1["bar"]["v"] == 1000

    # Second minute, same bucket
    bar2 = {"t": 1746468660000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    bb.push_minute_bar("AAPL", bar2)
    msg2 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg2["bar"]["t"] == 1746468600000  # same bucket start
    assert msg2["bar"]["h"] == 102.0
    assert msg2["bar"]["c"] == 101.8
    assert msg2["bar"]["v"] == 1750


@pytest.mark.asyncio
async def test_push_minute_bar_starts_new_bucket_at_boundary(bb):
    q5 = bb.subscribe("AAPL", "5")
    # 14:34:00 ET — last minute of the 14:30 bucket
    bb.push_minute_bar("AAPL", {"t": 1746468840000, "o": 100, "h": 100, "l": 100, "c": 100, "v": 100})
    await asyncio.wait_for(q5.get(), timeout=0.1)
    # 14:35:00 ET — first minute of a new bucket
    bb.push_minute_bar("AAPL", {"t": 1746468900000, "o": 110, "h": 110, "l": 110, "c": 110, "v": 50})
    msg = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg["bar"]["t"] == 1746468900000  # new bucket start
    assert msg["bar"]["o"] == 110            # open from new bucket's first bar
    assert msg["bar"]["v"] == 50             # not summed across buckets


@pytest.mark.asyncio
async def test_first_subscribe_callback_fires_only_once_per_symbol(bb):
    fired = []
    bb._on_first_subscribe = lambda s: fired.append(s)
    bb.subscribe("AAPL", "1")
    bb.subscribe("AAPL", "5")  # second tf for same symbol — should NOT fire again
    assert fired == ["AAPL"]


@pytest.mark.asyncio
async def test_last_unsubscribe_callback_fires_only_when_all_tfs_drop(bb):
    fired = []
    bb._on_last_unsubscribe = lambda s: fired.append(s)
    q1 = bb.subscribe("AAPL", "1")
    q5 = bb.subscribe("AAPL", "5")
    bb.unsubscribe("AAPL", "1", q1)
    assert fired == []  # still subscribed on tf=5
    bb.unsubscribe("AAPL", "5", q5)
    assert fired == ["AAPL"]
```

- [ ] **Step 6: Run all broadcaster tests**

```bash
pytest api/services/bar_broadcaster_test.py -v
```

Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add api/services/bar_broadcaster.py api/services/bar_broadcaster_test.py pytest.ini
git commit -m "feat(phase-4): add BarBroadcaster with rollup, subscriber routing, ref-counted callbacks"
```

---

### Task 4: Wire `bar_stream` → `bar_broadcaster` in app lifespan

**Files:**
- Modify: `api/main.py`

Wires the WS client to the broadcaster at startup. The broadcaster's `on_first_subscribe` calls `bar_stream.subscribe_symbols`; `on_last_unsubscribe` calls `bar_stream.unsubscribe_symbols`. The stream client's `on_bar` callback calls `broadcaster.push_minute_bar`.

- [ ] **Step 1: Read the existing lifespan to find the insertion point**

```bash
grep -n "S3 snapshot puller thread started" api/main.py
```

Expected: line ~260 (the puller startup print, just after the `_s3_pull_loop` thread start).

- [ ] **Step 2: Insert the bar-stream startup block**

In `api/main.py`, find the block that ends with the line:

```python
        print(f"[startup] S3 snapshot puller thread started ({data_sync.SNAPSHOT_INTERVAL_SECONDS // 60}-min cadence)")
```

After that block (and before `def _build_deep_cache():`), insert:

```python
    # Real-time bar streaming (Phase 4): Massive WS → BarBroadcaster → SSE.
    # Off by default; flip STREAM_BARS_ENABLED=1 to enable.
    if os.environ.get("STREAM_BARS_ENABLED") == "1":
        from api.services import bar_stream, bar_broadcaster
        bb = bar_broadcaster.init_broadcaster(
            on_first_subscribe=bar_stream.subscribe_symbols_one,
            on_last_unsubscribe=bar_stream.unsubscribe_symbols_one,
        )
        bar_stream.start_stream(on_bar=bb.push_minute_bar)
        print("[startup] Bar stream thread started (Massive WS → BarBroadcaster)")
```

- [ ] **Step 3: Add helper functions to `bar_stream.py` for single-symbol callbacks**

Append to `api/services/bar_stream.py`:

```python
def subscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_first_subscribe."""
    subscribe_symbols([symbol])


def unsubscribe_symbols_one(symbol: str) -> None:
    """Single-symbol convenience used by BarBroadcaster.on_last_unsubscribe."""
    unsubscribe_symbols([symbol])
```

- [ ] **Step 4: Verify `api/main.py` parses cleanly**

```bash
python -c "import ast; ast.parse(open('api/main.py').read()); print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/services/bar_stream.py
git commit -m "feat(phase-4): wire bar_stream to BarBroadcaster in lifespan behind STREAM_BARS_ENABLED"
```

---

### Task 5: SSE endpoint `/api/stream/bars`

**Files:**
- Modify: `api/routers/stream.py`

Mirrors the existing `/api/stream/prices` pattern: parse query, subscribe per (sym, tf), drain queues into SSE frames, heartbeat, cleanup on disconnect.

- [ ] **Step 1: Append the new endpoint to `api/routers/stream.py`**

Append below the existing `stream_prices` function and before `stream_status`:

```python
@router.get("/api/stream/bars")
async def stream_bars(
    request: Request,
    bars: str = Query(..., description="Comma-separated SYM:TF pairs, e.g. AAPL:5,MSFT:1"),
):
    """SSE — streams real-time bar updates per (symbol, timeframe).

    Connect via EventSource:
      const es = new EventSource('/api/stream/bars?bars=AAPL:5,MSFT:1')
      es.addEventListener('bar', e => { const {sym, tf, bar} = JSON.parse(e.data) })

    Each `event: bar` message contains the latest in-progress (or just-closed) bar
    for the (sym, tf) pair. Frontend should call series.update(bar) to apply.
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
        if sym and tf in ("1", "5", "15", "30"):  # 60-min excluded in v1 (ET-anchor needed)
            pairs.append((sym, tf))

    if not pairs:
        return JSONResponse({"error": "No valid sym:tf pairs"}, status_code=400)
    pairs = pairs[:50]  # cap to prevent runaway subscriptions per connection

    from api.services.bar_broadcaster import get_broadcaster
    bb = get_broadcaster()
    queues = [(sym, tf, bb.subscribe(sym, tf)) for (sym, tf) in pairs]

    async def event_generator():
        import time as _t
        last_heartbeat = _t.time()
        try:
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
                    yield f"event: bar\ndata: {json.dumps(msg)}\n\n"

                if not got_one:
                    await asyncio.sleep(0.05)

                if _t.time() - last_heartbeat > 15:
                    yield ": heartbeat\n\n"
                    last_heartbeat = _t.time()
        finally:
            for (sym, tf, q) in queues:
                bb.unsubscribe(sym, tf, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

Note the `import os` may need to be added at the top of the file if not already imported. Check:

```bash
grep -n "^import os" api/routers/stream.py
```

If missing, add `import os` near the other top-level imports.

- [ ] **Step 2: Smoke-test the endpoint locally is gated**

```bash
# With STREAM_BARS_ENABLED unset, endpoint must 503
STREAM_BARS_ENABLED= python -c "
from fastapi.testclient import TestClient
from api.main import app
c = TestClient(app)
r = c.get('/api/stream/bars?bars=AAPL:1')
print(r.status_code)
"
```

Expected: `503`.

- [ ] **Step 3: AST-parse to confirm no syntax errors**

```bash
python -c "import ast; ast.parse(open('api/routers/stream.py').read()); print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add api/routers/stream.py
git commit -m "feat(phase-4): add /api/stream/bars SSE endpoint"
```

---

### Task 6: `useRealtimeBars.js` — client hook

**Files:**
- Create: `app/src/hooks/useRealtimeBars.js`

Mirrors `useRealtimePrices.js` (EventSource + exponential backoff + cleanup) but specialized for bars: it takes a single `(symbol, tf)` pair, opens an EventSource, and invokes a callback on each incoming `event: bar`. Returns a `lastBarT` ref that the chart uses to drive gap-backfill on reconnect.

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/useRealtimeBars.js`:

```javascript
import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Real-time bar streaming via Server-Sent Events.
 *
 * Opens an EventSource for `/api/stream/bars?bars=<sym>:<tf>` and invokes
 * `onBar({sym, tf, bar})` for every incoming event. On connection drop, retries
 * with exponential backoff (5s → 10s → ... → 120s cap). On (re)connect, calls
 * `onReconnect(lastBarT)` so the consumer can fire a REST gap-backfill.
 *
 * Disabled entirely when VITE_REALTIME_BARS !== '1' — returns {connected:false}
 * and never opens an EventSource.
 *
 * Pass empty `symbol` or `tf` to disable.
 */
export default function useRealtimeBars({ symbol, tf, onBar, onReconnect }) {
  const enabled = import.meta.env.VITE_REALTIME_BARS === '1' && !!symbol && !!tf
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)
  const reconnectRef = useRef(null)
  const retryDelayRef = useRef(5000)
  const lastBarTRef = useRef(null)
  const onBarRef = useRef(onBar)
  const onReconnectRef = useRef(onReconnect)

  // Keep refs current without re-running connect()
  useEffect(() => { onBarRef.current = onBar }, [onBar])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  const connect = useCallback(() => {
    if (!enabled || esRef.current) return

    const url = `/api/stream/bars?bars=${encodeURIComponent(symbol)}:${encodeURIComponent(tf)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      retryDelayRef.current = 5000
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      // On (re)connect, ask consumer to backfill from last seen bar.
      if (onReconnectRef.current) {
        try { onReconnectRef.current(lastBarTRef.current) } catch {}
      }
    }

    es.addEventListener('bar', (event) => {
      try {
        const data = JSON.parse(event.data)  // {sym, tf, bar:{t,o,h,l,c,v}}
        if (data?.bar?.t != null) lastBarTRef.current = data.bar.t
        if (onBarRef.current) onBarRef.current(data)
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      es.close()
      esRef.current = null
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, 120000)
      reconnectRef.current = setTimeout(() => connect(), delay)
    }
  }, [enabled, symbol, tf])

  useEffect(() => {
    if (enabled) connect()
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      setConnected(false)
    }
  }, [enabled, connect])

  return { connected, lastBarT: lastBarTRef }
}
```

- [ ] **Step 2: Quick lint check (the project's ESLint config catches React hook dep array issues)**

```bash
cd app && npx eslint src/hooks/useRealtimeBars.js
```

Expected: zero errors. If `react-hooks/exhaustive-deps` complains about `connect` not depending on `enabled/symbol/tf`, that's expected (it does — they're already in the dep array).

- [ ] **Step 3: Commit**

```bash
git add app/src/hooks/useRealtimeBars.js
git commit -m "feat(phase-4): add useRealtimeBars hook with EventSource + backoff + onReconnect"
```

---

### Task 7: Wire `useRealtimeBars` into `StockChart.jsx`

**Files:**
- Modify: `app/src/components/StockChart.jsx`

**Critical context — read before coding:** The chart already has tick-driven live update logic at lines ~822-919. A `useEffect` consumes Finnhub trade ticks via `livePrices[sym]` → builds `liveBarRef.current` → calls `candleSeriesRef.current.update(liveBarRef.current)` for sub-second flicker on the developing candle. Phase 4 must **coexist** with this, not duplicate it. The split:

- **Existing tick logic owns:** sub-second flicker on the currently-developing bar
- **Phase 4 AM stream owns:** authoritative just-closed bar data (replaces tick-aggregated values when the minute closes) and real-time updates on 5/15/30-min charts

When an AM bar arrives, we (a) update the candle in lightweight-charts and (b) sync `liveBarRef`/`lastBarRef` if the AM bar matches their time, so the next tick logic iteration starts from the authoritative state instead of overwriting it.

Notes for this task:
- The chart has only `candleSeriesRef` (used for both OHLC and line/area) and `volumeSeriesRef`. There is **no `lineSeriesRef`**. The chart type is branched via `useOhlc = isOhlcType(cs.chartType)`.
- The component prop is `sym`. The timeframe is `resolvedTf`. Both confirmed during pre-flight.

- [ ] **Step 1: Add the hook import**

Find the existing import line for `useLivePrices`:

```bash
grep -n "useLivePrices" app/src/components/StockChart.jsx | head -3
```

Add immediately below that line:

```javascript
import useRealtimeBars from '../hooks/useRealtimeBars'
```

- [ ] **Step 2: Confirm `useRef` and `useCallback` are already imported**

```bash
grep -n "useRef\|useCallback" app/src/components/StockChart.jsx | head -3
```

Expected: both already in the React import line. If not, add them.

- [ ] **Step 3: Add the realtime-bars hook usage in the component body**

Find the existing tick-driven `useEffect` (search for `Real-time candle updates — tick-by-tick via WebSocket`). Insert the new hook block **after** that `useEffect` closes (the one ending with `}, [livePrices, sym, resolvedTf, cs.chartType])`).

Add:

```javascript
  // Real-time bar streaming (Phase 4) — Massive AM events.
  // Only on intraday timeframes 1/5/15/30 (60-min uses ET-anchor REST path until v1.1).
  // Coexists with the tick-driven useEffect above:
  //  - Tick logic drives sub-second flicker on the current developing candle
  //  - AM events deliver authoritative just-closed minute bars (1m chart) or
  //    server-rolled partial bucket bars (5/15/30m charts)
  //  - When an AM bar matches liveBarRef/lastBarRef.time, we sync them so the
  //    next tick iteration doesn't overwrite the authoritative values
  const realtimeTfEligible = ['1', '5', '15', '30'].includes(resolvedTf)

  const onRealtimeBar = useCallback((data) => {
    if (!candleSeriesRef.current) return
    // AM `t` is bucket-start in ms; lightweight-charts wants seconds.
    const tSec = Math.floor(data.bar.t / 1000)
    const useOhlc = isOhlcType(cs.chartType)

    try {
      if (useOhlc) {
        candleSeriesRef.current.update({
          time: tSec,
          open: data.bar.o, high: data.bar.h, low: data.bar.l, close: data.bar.c,
        })
      } else {
        candleSeriesRef.current.update({ time: tSec, value: data.bar.c })
      }
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.update({
          time: tSec,
          value: data.bar.v,
          color: data.bar.c >= data.bar.o ? 'rgba(74,222,128,0.5)' : 'rgba(239,83,80,0.5)',
        })
      }
      // Sync the tick-logic refs so the next tick starts from authoritative state.
      // Only sync if the AM bar matches the current developing/last bar's time —
      // otherwise this is an older bar's update and shouldn't disturb live state.
      if (liveBarRef.current && liveBarRef.current.time === tSec) {
        liveBarRef.current = {
          time: tSec, open: data.bar.o, high: data.bar.h, low: data.bar.l, close: data.bar.c,
        }
      }
      if (lastBarRef.current && lastBarRef.current.time === tSec) {
        lastBarRef.current = {
          time: tSec, open: data.bar.o, high: data.bar.h, low: data.bar.l, close: data.bar.c,
          volume: data.bar.v,
        }
      }
    } catch {
      // lightweight-charts throws if `time` regresses below the series' last bar.
      // Silently ignore — out-of-order frames are rare and self-correct on next bar.
    }
  }, [cs.chartType])

  const onRealtimeReconnect = useCallback((lastBarT) => {
    // Gap-backfill on reconnect — uses the existing `since` param of /api/bars.
    if (lastBarT == null || !sym) return
    fetch(`/api/bars/${encodeURIComponent(sym)}?tf=${encodeURIComponent(resolvedTf)}&since=${lastBarT}`)
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        if (!payload?.bars?.length) return
        for (const b of payload.bars) {
          onRealtimeBar({ sym, tf: resolvedTf, bar: { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v } })
        }
      })
      .catch(() => {})
  }, [sym, resolvedTf, onRealtimeBar])

  useRealtimeBars({
    symbol: realtimeTfEligible && liveUpdates ? sym : null,
    tf: realtimeTfEligible && liveUpdates ? resolvedTf : null,
    onBar: onRealtimeBar,
    onReconnect: onRealtimeReconnect,
  })
```

Note: `liveUpdates` is an existing prop (line ~249 of `StockChart.jsx`) that disables live SSE for closed-trade historical charts. We respect it for parity with the existing tick logic.

- [ ] **Step 4: Confirm `isOhlcType` is in scope**

```bash
grep -n "isOhlcType" app/src/components/StockChart.jsx | head -5
```

Expected: defined or imported near the top of the file. If missing, locate it (likely in `chart/chartDefaults.js` or a sibling util) and add an import. The existing tick-logic useEffect uses it on line ~839 so it must already be available.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/StockChart.jsx
git commit -m "feat(phase-4): wire useRealtimeBars into StockChart behind VITE_REALTIME_BARS"
```

---

### Task 8: Deploy + acceptance test

**Files:** None — config + verification only.

- [ ] **Step 1: Set Railway env vars on the web service**

Via Railway dashboard → web service → Variables, add:

```
STREAM_BARS_ENABLED=1
MASSIVE_WS_URL=wss://socket.massive.com/stocks
VITE_REALTIME_BARS=1
```

`MASSIVE_API_KEY` is already set (used by `services/massive.py` REST). If the WS endpoint URL differs (Massive's docs may show a different host), update `MASSIVE_WS_URL` to match.

- [ ] **Step 2: Push the branch**

```bash
git push origin master
```

Expected output: deploy triggers via the GitHub integration. Build (~3 min) → Deploy (~15 s) → Healthcheck (should be green within 10 s — boot is unchanged from Phase 1 path).

- [ ] **Step 3: Verify the bar-stream thread connected**

In Railway → web → Deploy logs, search for:

```
[startup] Bar stream thread started
[bar_stream] Connecting to wss://socket.massive.com/stocks
[bar_stream] status: auth_success
```

Or if `MASSIVE_WS_URL` was wrong:

```
[bar_stream] disconnected: <reason> — reconnect in 1s
```

If you see repeated "disconnected" lines: the WS URL or auth handshake is wrong. Check Massive's docs for the exact URL and message format and adjust `_build_auth_message` / `_WS_URL`.

- [ ] **Step 4: End-to-end smoke from a browser**

During US market hours (9:30 AM – 4:00 PM ET):

1. Hard-refresh `https://uctintelligence.com` (Ctrl+Shift+R)
2. Open DevTools → Network tab → filter `stream`
3. Open any chart on a 1m or 5m timeframe (e.g. AAPL on 5m)
4. You should see one Network row: `EventSource /api/stream/bars?bars=AAPL:5` — type `eventsource`, status `200 (pending)`
5. Click that row → Messages/EventStream panel shows `event: bar` frames arriving every minute (5m bars also arrive on each 1-min boundary, with the partial bar updating)
6. Watch the chart's most recent candle — it should update without a manual refresh as new minutes close

- [ ] **Step 5: Reconnect / gap-backfill test**

1. Open DevTools → Network → throttle to "Offline" for 30 s, then back to "Online"
2. Console: confirm one `/api/bars/AAPL?tf=5&since=<ms>` request fires shortly after reconnect
3. The chart should fill in any minutes that elapsed during the offline window without leaving a visible gap

- [ ] **Step 6: Off-hours fallback verification**

Outside market hours, no AM events fire from Massive. The chart still loads normally via REST; the EventSource connects but receives only heartbeats. This is the expected idle state.

- [ ] **Step 7: Mark plan complete**

Update the front matter of this plan (or the strategic-overview Phase 4 section) to reflect "shipped".

---

## Future Enhancements (post-Phase 4)

- **ET-anchored 60-minute bucket support.** v1 omits 60-min from streaming because existing 60-min bars are ET-anchored (9:30/10:30 ET buckets) per `_session_resample_hourly`, which UTC-rounding in `bar_rollup.py` would mismatch. Add a tf-aware `bucket_start` that takes a tz argument and uses ET 9:30 anchor for tf=60.
- **First-subscribe partial-bucket backfill.** When a client first subscribes to a (sym, tf) where tf > 1, the server's `_partials[(sym, tf)]` is empty and the first AM event creates a partial that only reflects that one minute (not the full bucket). Server should fetch the in-bucket 1-min bars from REST and replay them through `aggregate()` so the partial reflects true bucket state. Mostly a polish issue — chart's existing REST fetch already shows correct historical bars; this is for the brief window between subscribe and bucket close.
- **`A.*` second aggregates for Bloomberg-feel sub-second updates.** Subscribe to `A.<sym>` alongside `AM.<sym>`. The broadcaster overlays the latest A bar onto the in-progress AM bucket, pushing every (debounced to ≥250ms) update. Adds ~1 day of work, ~10× WS message volume, and noticeable chart "flicker" that matches TradingView Pro / Bloomberg. (Note: existing tick-driven flicker via Finnhub already provides this for 1-min effective resolution; A events would extend it to authoritative server-side flicker.)
- **Universe-wide subscription with active filtering.** Today we subscribe per symbol on demand. If active symbol count exceeds ~500, switch to subscribing `AM.*` once and filtering server-side — same total bandwidth, fewer protocol messages. Cross over only when the metric warrants it.
- **Replace Finnhub with Massive `T.*` for the live price ticker.** One provider, one WS connection, one auth. Migration is mostly mechanical (port `_process_finnhub_trade` to the Massive trade event shape). Defer until Phase 4 has been stable in prod for ≥1 week.

---

## Self-Review

### Spec coverage

| Spec requirement (strategic overview §4) | Task |
|---|---|
| `api/services/bar_stream.py` — WebSocket client to `wss://socket.polygon.io/stocks` | Task 2 (uses Massive — same protocol, configurable URL) |
| `BarBroadcaster` class with per-(sym, tf) deques + SSE broadcast | Task 3 |
| Server-side roll-up worker (5/15/30-min in v1; 60-min deferred) | Task 1 + Task 3 |
| Extend `api/routers/stream.py` with `event: bar` typed events + `bars=AAPL:5,MSFT:1` query | Task 5 |
| `app/src/hooks/useRealtimeBars.js` + wire into `StockChart.jsx` | Tasks 6, 7 |
| Gap-backfill on EventSource reconnect | Task 7 (uses existing `since` param of `/api/bars` — already shipped) |
| Feature flags `VITE_REALTIME_BARS` + `STREAM_BARS_ENABLED` | Tasks 5, 6, 7, 8 |
| Acceptance: chart updates without REST poll on actively-viewed timeframe | Task 8 step 4 |
| Acceptance: gap-backfill works after a 30s WS blip | Task 8 step 5 |

### Placeholder scan

No "TBD" / "implement later" / "appropriate error handling" / "similar to Task N" — verified each step contains either runnable code, exact bash, or exact reading-grep instructions.

### Type consistency

- Bar shape on the wire (`{t, o, h, l, c, v}` with `t` in ms) — same in `parse_am_event` (Task 2), `aggregate` (Task 1), `BarBroadcaster.push_minute_bar` (Task 3), SSE payload (Task 5), and hook callback (Task 6).
- `tf` strings (`"1"`, `"5"`, `"15"`, `"30"`, `"60"`) — same in `TF_TO_SECONDS` (Task 1), `ROLLUP_TFS` (Task 3), endpoint allow-list (Task 5), hook caller (Task 7).
- `lightweight-charts` time field is in seconds (not ms) — explicitly converted in Task 7 (`Math.floor(data.bar.t / 1000)`).

### Dependency check

- `websockets>=12.0` — already in `requirements.txt` (verified during planning)
- `pytest-asyncio` — Task 3 step 2 installs/configures
- `lightweight-charts` v5 — already in use; `.update(bar)` is its v5 incremental-update API
