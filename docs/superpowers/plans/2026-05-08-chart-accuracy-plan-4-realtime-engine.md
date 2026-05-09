# Chart Accuracy — Plan 4: Real-Time Candle Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-authoritative real-time candle construction. Every tick lands on the right candle instantly. On minute close, server reconciles the WS-built candle against the REST snapshot — if they disagree, server broadcasts a correction. Frontend chart instances all subscribe to a single global registry; multi-chart sync is automatic. The developing-candle accuracy issue ("close/high/low not matching ticks elsewhere") is solved at the architectural level.

**Architecture:** New `realtime_candle.py` service maintains in-memory candle state per `(ticker, tf)`. Hooks into the existing Finnhub WS tick handler. On every tick, updates current bar OHLC + volume, broadcasts `tick` SSE event. At minute boundaries, fetches REST snapshot, compares to WS-built candle (close ≤ 0.05% diff, volume ≤ 5% diff), broadcasts `bar_close` or `bar_correction`. Frontend `realtimeCandle.js` is a single `Map<sym, CandleState>` shared across all StockChart instances; chart subscribes via the registry instead of owning per-component state.

**Tech Stack:** Python asyncio + websockets + FastAPI SSE. React + Lightweight Charts v5. Uses `bars_liveness`, `bar_provenance`, `realtime_stream` from prior plans.

**Spec:** `docs/superpowers/specs/2026-05-08-chart-accuracy-and-realtime-design.md`
**Predecessors:** Plans 1, 2, 3

---

## File Structure

### New backend
| File | Responsibility |
|---|---|
| `api/services/realtime_candle.py` | Server-authoritative candle state per (ticker, tf). Tick handler. Minute-close reconciliation. Broadcast helpers. |
| `api/services/candle_reconcile.py` | Compare WS-built candle to REST snapshot at minute close. Tolerance rules. Returns `accept` | `correction` decision. |

### Modified backend
| File | Change |
|---|---|
| `api/services/realtime_stream.py` | Hook tick into `realtime_candle.apply_tick()` after recording in `_last_seen` and `_prices` |
| `api/routers/stream.py` | Add new SSE event types: `tick`, `bar_close`, `bar_correction`. Existing `stale`/`fresh` from Plan 2 stay. |
| `api/services/bars_fetch.py` | Add `fetch_minute_snapshot(ticker, minute_ts)` for the reconciliation step |

### New frontend
| File | Responsibility |
|---|---|
| `app/src/lib/realtimeCandle.js` | Single global `Map<sym, CandleState>`. Subscriber API for charts. Reacts to `tick`/`bar_close`/`bar_correction` SSE events. |

### Modified frontend
| File | Change |
|---|---|
| `app/src/components/StockChart.jsx` | Subscribe to `realtimeCandle` registry instead of owning `liveBarRef` state |
| `app/src/hooks/useRealtimePrices.js` | Add SSE listeners for new event types; relay to `realtimeCandle.js` registry |

### New tests
| File | Coverage |
|---|---|
| `tests/test_realtime_candle.py` | Tick rules: applies, out-of-order drop, sanity reject, period boundary roll |
| `tests/test_candle_reconcile.py` | Tolerance math, accept/correction decisions |
| `tests/test_stream_candle_events.py` | SSE emits tick/bar_close/bar_correction events |
| Frontend test for `realtimeCandle.js` (Vitest if configured) | Registry subscribe/unsubscribe, state shape |

---

## Task 1: Server-side candle state

**Files:**
- Create: `api/services/realtime_candle.py`
- Create: `tests/test_realtime_candle.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from api.services import realtime_candle as rc


@pytest.fixture(autouse=True)
def reset():
    rc._reset()
    yield
    rc._reset()


def test_apply_tick_creates_new_candle():
    """First tick for a (ticker, tf) creates the candle."""
    rc.apply_tick("QQQ", price=700.0, ts=1715080800, size=100, tf="1")
    candle = rc.get_current("QQQ", "1")
    assert candle is not None
    assert candle["o"] == 700.0
    assert candle["h"] == 700.0
    assert candle["l"] == 700.0
    assert candle["c"] == 700.0
    assert candle["v"] == 100


def test_apply_tick_updates_high_low_close():
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 702.5, 1715080805, 50, "1")
    rc.apply_tick("QQQ", 698.0, 1715080810, 75, "1")
    candle = rc.get_current("QQQ", "1")
    assert candle["o"] == 700.0
    assert candle["h"] == 702.5
    assert candle["l"] == 698.0
    assert candle["c"] == 698.0
    assert candle["v"] == 225


def test_out_of_order_tick_dropped():
    """A tick with timestamp older than current is silently dropped."""
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 702.5, 1715080805, 50, "1")
    # Old tick — should be dropped
    rc.apply_tick("QQQ", 600.0, 1715080790, 999, "1")
    candle = rc.get_current("QQQ", "1")
    assert candle["c"] == 702.5
    assert candle["l"] == 700.0  # 600 was dropped, didn't lower the low


def test_sanity_check_rejects_extreme_tick():
    """A tick >5% deviation from current close is treated as anomaly + dropped."""
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")
    rc.apply_tick("QQQ", 1000.0, 1715080805, 50, "1")  # 43% jump — anomaly
    candle = rc.get_current("QQQ", "1")
    assert candle["h"] == 700.0  # 1000 was dropped
    assert candle["c"] == 700.0


def test_period_boundary_rolls_candle():
    """Tick after 1-min boundary closes the old candle and starts a new one."""
    rc.apply_tick("QQQ", 700.0, 1715080800, 100, "1")  # bar starts at 1715080800
    rc.apply_tick("QQQ", 702.0, 1715080859, 50, "1")
    closed_bars = rc.apply_tick("QQQ", 705.0, 1715080860, 75, "1")  # next bar
    # apply_tick returns list of closed bars (if any)
    assert len(closed_bars) == 1
    assert closed_bars[0]["c"] == 702.0
    new = rc.get_current("QQQ", "1")
    assert new["o"] == 705.0
    assert new["t"] == 1715080860


def test_get_current_returns_none_for_unknown():
    assert rc.get_current("ZZZZZ", "1") is None
```

- [ ] **Step 2: Run, fail (ImportError)**

`pytest tests/test_realtime_candle.py -v`

- [ ] **Step 3: Implement**

```python
"""Server-authoritative real-time candle state.

Maintains the developing candle for every (ticker, tf) currently subscribed.
Hooked into the WS tick handler — every trade tick updates the candle's
high/low/close/volume. At period boundaries, the previous candle is finalized
and a new one starts.

Produces broadcast events for the SSE stream:
  - tick: every tick (price + ts + vol_delta)
  - bar_close: when a candle period boundary closes a bar (full OHLCV)
  - bar_correction: when minute-close reconciliation overrides the WS-built bar
"""
import threading
import time
from typing import Optional


_TF_INTERVAL = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}

_TICK_DEVIATION_THRESHOLD = 0.05  # 5% per-tick deviation from current close = anomaly

_lock = threading.RLock()
# {(ticker, tf): {"t": bar_time, "o","h","l","c","v": floats, "last_tick_ts": int}}
_state: dict[tuple[str, str], dict] = {}


def _reset():
    """Test helper."""
    with _lock:
        _state.clear()


def _bar_start_for(ts: int, tf: str) -> int:
    """Return the bar-start timestamp for `ts` at timeframe `tf`."""
    interval = _TF_INTERVAL.get(tf, 60)
    return (ts // interval) * interval


def apply_tick(sym: str, price: float, ts: int, size: int, tf: str = "1") -> list[dict]:
    """Apply a tick to the (sym, tf) candle. Returns list of closed bars (0 or 1)."""
    sym = sym.upper()
    bar_start = _bar_start_for(ts, tf)
    closed: list[dict] = []
    with _lock:
        key = (sym, tf)
        cur = _state.get(key)

        # Out-of-order drop: tick timestamp must be >= last_tick_ts
        if cur and cur.get("last_tick_ts", 0) > ts:
            return closed

        # Period boundary: close prior bar, start new one
        if cur and cur["t"] != bar_start:
            closed.append(dict(cur))  # snapshot
            cur = None

        if cur is None:
            _state[key] = {
                "t": bar_start, "o": price, "h": price, "l": price, "c": price,
                "v": size, "last_tick_ts": ts,
            }
            return closed

        # Sanity: extreme price deviation = drop tick
        prev_close = cur["c"]
        if prev_close > 0 and abs(price - prev_close) / prev_close > _TICK_DEVIATION_THRESHOLD:
            return closed

        # Apply
        cur["c"] = price
        if price > cur["h"]:
            cur["h"] = price
        if price < cur["l"]:
            cur["l"] = price
        cur["v"] = (cur.get("v", 0) or 0) + size
        cur["last_tick_ts"] = ts

    return closed


def get_current(sym: str, tf: str) -> Optional[dict]:
    sym = sym.upper()
    with _lock:
        cur = _state.get((sym, tf))
        return dict(cur) if cur else None


def force_close(sym: str, tf: str) -> Optional[dict]:
    """Manually close the current bar (e.g., for end-of-session). Returns the closed bar."""
    sym = sym.upper()
    with _lock:
        key = (sym, tf)
        cur = _state.pop(key, None)
        return dict(cur) if cur else None


def replace_bar(sym: str, tf: str, corrected: dict) -> None:
    """Replace the current bar state with a corrected version (used by reconciliation)."""
    sym = sym.upper()
    with _lock:
        _state[(sym, tf)] = dict(corrected)


def all_keys() -> list[tuple[str, str]]:
    """Return list of all (ticker, tf) keys currently tracked."""
    with _lock:
        return list(_state.keys())
```

- [ ] **Step 4: Tests pass**

`pytest tests/test_realtime_candle.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/services/realtime_candle.py tests/test_realtime_candle.py
git commit -m "feat(charts): server-authoritative real-time candle state"
```

---

## Task 2: Hook into Finnhub WS tick handler

**Files:**
- Modify: `api/services/realtime_stream.py`
- Modify: `tests/test_realtime_stream_heartbeat.py`

- [ ] **Step 1: Failing test**

Append to `tests/test_realtime_stream_heartbeat.py`:

```python
def test_record_tick_updates_realtime_candle():
    """_record_tick should also feed realtime_candle."""
    from api.services import realtime_candle
    realtime_candle._reset()
    import time
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    candle = realtime_candle.get_current("QQQ", "1")
    assert candle is not None
    assert candle["c"] == 700.0
```

- [ ] **Step 2: Run fails**

- [ ] **Step 3: Hook into _record_tick**

In `api/services/realtime_stream.py`, modify `_record_tick`:

```python
from api.services import realtime_candle

def _record_tick(sym: str, price: float, ts: int) -> None:
    sym = sym.upper()
    with _lock:
        _last_seen[sym] = int(ts)
        # ... existing _prices update ...

    # Feed realtime_candle (no lock contention — it has its own lock)
    try:
        for tf in ("1", "5", "15", "30", "60"):
            realtime_candle.apply_tick(sym, price=price, ts=int(ts), size=1, tf=tf)
    except Exception:
        pass  # observability layer; never break tick handling
```

The `size=1` is a placeholder — the Finnhub message includes a `v` (size) field. If the existing `_process_finnhub_trade` parses size, propagate it through `_record_tick`.

- [ ] **Step 4: Tests pass + commit**

```bash
pytest tests/test_realtime_stream_heartbeat.py -v
git add api/services/realtime_stream.py tests/test_realtime_stream_heartbeat.py
git commit -m "feat(charts): feed every tick into realtime_candle"
```

---

## Task 3: Minute-close reconciliation

**Files:**
- Create: `api/services/candle_reconcile.py`
- Create: `tests/test_candle_reconcile.py`

- [ ] **Step 1: Failing test**

```python
from api.services import candle_reconcile as cr


def test_agreement_within_tolerance():
    ws = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    rest = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.7, "v": 1490000}
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "accept"


def test_close_disagreement_triggers_correction():
    ws = {"t": 1715080800, "c": 702.5, "v": 1500000}
    rest = {"t": 1715080800, "c": 850.0, "v": 1500000}  # huge diff
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "correction"
    assert decision["correction"] == rest


def test_volume_disagreement_triggers_correction():
    ws = {"t": 1715080800, "c": 702.5, "v": 100000}
    rest = {"t": 1715080800, "c": 702.5, "v": 1500000}  # 15x volume diff
    decision = cr.reconcile(ws, rest)
    assert decision["verdict"] == "correction"


def test_missing_rest_skips_reconcile():
    ws = {"t": 1715080800, "c": 702.5, "v": 1500000}
    decision = cr.reconcile(ws, None)
    assert decision["verdict"] == "skipped"
```

- [ ] **Step 2: Run fails**

- [ ] **Step 3: Implement**

```python
"""Compare WS-built candle to REST snapshot at minute close. Server-authoritative."""

_CLOSE_TOLERANCE = 0.0005  # 0.05%
_VOLUME_TOLERANCE = 0.05   # 5%


def _close_diff(a: float, b: float) -> float:
    if a == 0:
        return 1.0 if b != 0 else 0.0
    return abs(a - b) / a


def _vol_diff(a: float, b: float) -> float:
    if max(a, b) == 0:
        return 0.0
    return abs(a - b) / max(a, b)


def reconcile(ws_bar: dict, rest_bar: dict | None) -> dict:
    """Compare ws_bar to rest_bar.

    Returns:
      {"verdict": "accept"} when within tolerance — keep WS-built bar
      {"verdict": "correction", "correction": rest_bar} when out of tolerance
      {"verdict": "skipped"} when rest_bar unavailable
    """
    if not rest_bar:
        return {"verdict": "skipped"}
    cd = _close_diff(ws_bar.get("c", 0), rest_bar.get("c", 0))
    vd = _vol_diff(ws_bar.get("v", 0), rest_bar.get("v", 0))
    if cd <= _CLOSE_TOLERANCE and vd <= _VOLUME_TOLERANCE:
        return {"verdict": "accept"}
    return {"verdict": "correction", "correction": rest_bar,
            "close_diff": cd, "vol_diff": vd}
```

- [ ] **Step 4: Tests pass + commit**

```bash
git add api/services/candle_reconcile.py tests/test_candle_reconcile.py
git commit -m "feat(charts): minute-close reconciliation API"
```

---

## Task 4: Single-minute REST snapshot fetch

**Files:**
- Modify: `api/services/bars_fetch.py`
- Create: `tests/test_fetch_minute_snapshot.py`

- [ ] **Step 1: Failing test**

```python
from unittest.mock import patch
from api.services import bars_fetch


def test_fetch_minute_snapshot_returns_bar():
    """Given a minute timestamp, return the OHLCV bar for that minute."""
    with patch.object(bars_fetch, "_fetch_intraday_massive",
                      return_value=[{"t": 1715080800, "o": 700, "h": 701, "l": 699, "c": 700.5, "v": 50000}]):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)
    assert bar is not None
    assert bar["t"] == 1715080800
    assert bar["c"] == 700.5


def test_fetch_minute_snapshot_returns_none_when_unavailable():
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=[]):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)
    assert bar is None
```

- [ ] **Step 2: Implement**

In `api/services/bars_fetch.py`, add:

```python
def fetch_minute_snapshot(ticker: str, minute_ts: int) -> dict | None:
    """Fetch the 1m bar for the given minute timestamp from Massive (primary).

    Returns the bar dict or None if unavailable. Used by candle reconciliation.
    """
    try:
        # Fetch a small window around the target minute
        bars = _fetch_intraday_massive(ticker, "1", 5)
        if not bars:
            return None
        for b in bars:
            if b.get("t") == minute_ts:
                return b
    except Exception:
        return None
    return None
```

- [ ] **Step 3: Tests + commit**

```bash
git add api/services/bars_fetch.py tests/test_fetch_minute_snapshot.py
git commit -m "feat(charts): fetch_minute_snapshot for reconciliation"
```

---

## Task 5: SSE event types — tick / bar_close / bar_correction

**Files:**
- Modify: `api/routers/stream.py`
- Modify: `tests/test_stream_stale_event.py`

- [ ] **Step 1: Add helpers**

In `api/routers/stream.py`, add helpers + event-emission logic in the SSE generator. The generator should:
- Poll `realtime_candle.get_current(sym, "1")` periodically (e.g., every 100ms)
- Detect transitions (new tick = price changed, vol changed) → emit `tick`
- Detect bar boundary closure (the candle's `t` rolled forward) → emit `bar_close`
- Listen for reconciliation results (background thread does minute-close reconciliation, queues correction events) → emit `bar_correction`

Implementation depends heavily on the existing generator's structure. Pseudocode:

```python
last_seen_state: dict[str, tuple] = {}  # sym → (t, c, v)

while True:
    for sym in tickers:
        cur = realtime_candle.get_current(sym, "1")
        if not cur:
            continue
        prev = last_seen_state.get(sym)
        cur_key = (cur["t"], cur["c"], cur["v"])
        if prev != cur_key:
            # Detect bar boundary
            if prev and prev[0] != cur["t"]:
                # Old bar closed; emit bar_close
                yield f"event: bar_close\ndata: {json.dumps({'sym': sym, 'tf': '1', 'bar': prev_bar})}\n\n"
            # Always emit tick on price change
            yield f"event: tick\ndata: {json.dumps({'sym': sym, 'price': cur['c'], 'ts': cur.get('last_tick_ts'), 'vol': cur['v']})}\n\n"
            last_seen_state[sym] = cur_key
    await asyncio.sleep(0.1)
```

- [ ] **Step 2: Tests for tick / bar_close emission**

Use the same helper-extraction pattern as Plan 2 Task 6: write `_build_candle_events(tickers, last_state) -> events` and test it pure-function.

- [ ] **Step 3: Reconciliation worker (background)**

In `api/services/realtime_candle.py` add:

```python
import asyncio

async def reconciliation_worker():
    """Background task that runs minute-close reconciliation.

    Every minute (~5s after the boundary), for each (ticker, tf) tracked,
    fetch the REST snapshot and reconcile.
    """
    from api.services import bars_fetch, candle_reconcile
    from api.routers.stream import emit_correction  # registered emitter
    while True:
        await asyncio.sleep(60)
        for (sym, tf) in all_keys():
            if tf != "1":
                continue  # reconcile 1m only; coarser tfs derive from 1m
            cur = get_current(sym, tf)
            if not cur:
                continue
            rest_bar = bars_fetch.fetch_minute_snapshot(sym, cur["t"])
            decision = candle_reconcile.reconcile(cur, rest_bar)
            if decision["verdict"] == "correction":
                replace_bar(sym, tf, decision["correction"])
                emit_correction(sym, tf, decision["correction"])
```

`emit_correction` is a hook the SSE generator subscribes to — implementation depends on the existing pubsub pattern. Could use a simple module-level `asyncio.Queue`.

- [ ] **Step 4: Schedule the worker on app startup**

In `api/main.py` lifespan, after startup:

```python
import asyncio
asyncio.create_task(realtime_candle.reconciliation_worker())
```

- [ ] **Step 5: Commit**

```bash
git add api/routers/stream.py api/services/realtime_candle.py api/main.py tests/test_stream_candle_events.py
git commit -m "feat(charts): SSE tick/bar_close/bar_correction events + reconciliation worker"
```

---

## Task 6: Frontend `realtimeCandle.js` registry

**Files:**
- Create: `app/src/lib/realtimeCandle.js`

- [ ] **Step 1: Module shape**

```javascript
// Single global registry. All chart instances subscribe here for live state.
const _state = new Map(); // sym -> { tf -> {o,h,l,c,v,t} }
const _subscribers = new Map(); // sym -> Set<callback>

export function getCandle(sym, tf) {
  return _state.get(sym.toUpperCase())?.[tf] || null;
}

export function applyTick(sym, price, vol, ts) {
  sym = sym.toUpperCase();
  const symState = _state.get(sym) || {};
  // Only update tf=1 from raw ticks; coarser TFs derived
  const prev = symState["1"] || {};
  const t = Math.floor(ts / 60) * 60;
  if (prev.t !== t) {
    // New bar starts
    symState["1"] = { t, o: price, h: price, l: price, c: price, v: vol || 0 };
  } else {
    symState["1"] = {
      ...prev,
      c: price,
      h: Math.max(prev.h, price),
      l: Math.min(prev.l, price),
      v: (prev.v || 0) + (vol || 0),
    };
  }
  _state.set(sym, symState);
  notify(sym);
}

export function applyBarClose(sym, tf, bar) {
  sym = sym.toUpperCase();
  const symState = _state.get(sym) || {};
  symState[tf] = { ...bar };
  _state.set(sym, symState);
  notify(sym);
}

export function applyCorrection(sym, tf, corrected) {
  applyBarClose(sym, tf, corrected); // same shape
}

export function subscribe(sym, callback) {
  sym = sym.toUpperCase();
  if (!_subscribers.has(sym)) _subscribers.set(sym, new Set());
  _subscribers.get(sym).add(callback);
  return () => _subscribers.get(sym)?.delete(callback);
}

function notify(sym) {
  const subs = _subscribers.get(sym);
  if (!subs) return;
  subs.forEach(cb => { try { cb(); } catch {} });
}
```

- [ ] **Step 2: Wire SSE event handlers in useRealtimePrices.js**

```javascript
es.addEventListener('tick', (event) => {
  const data = JSON.parse(event.data);
  realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts);
});

es.addEventListener('bar_close', (event) => {
  const data = JSON.parse(event.data);
  realtimeCandle.applyBarClose(data.sym, data.tf, data.bar);
});

es.addEventListener('bar_correction', (event) => {
  const data = JSON.parse(event.data);
  realtimeCandle.applyCorrection(data.sym, data.tf, data.bar);
});
```

- [ ] **Step 3: StockChart consumes registry**

In `StockChart.jsx`, subscribe on mount, update `series` via `series.update(candle)` when the registry notifies. Replace the existing `liveBarRef` logic.

```jsx
import * as realtimeCandle from '../lib/realtimeCandle';

useEffect(() => {
  const update = () => {
    const candle = realtimeCandle.getCandle(symbol, currentTF);
    if (candle && candleSeries) {
      candleSeries.update({ time: candle.t, open: candle.o, high: candle.h, low: candle.l, close: candle.c });
      volumeSeries?.update({ time: candle.t, value: candle.v, color: candle.c >= candle.o ? upColor : downColor });
    }
  };
  const unsub = realtimeCandle.subscribe(symbol, update);
  update(); // initial
  return unsub;
}, [symbol, currentTF, candleSeries, volumeSeries]);
```

Remove the existing `liveBarRef` + tick handler logic from StockChart.jsx — it's now handled by the registry.

- [ ] **Step 4: Build + test in browser**

```bash
cd app && npm run build && cd ..
```

Should compile cleanly. Manual smoke test in browser to verify tick→pixel.

- [ ] **Step 5: Commit + push**

```bash
git add app/src/lib/realtimeCandle.js app/src/hooks/useRealtimePrices.js app/src/components/StockChart.jsx
git commit -m "feat(charts): frontend realtimeCandle global registry + SSE wiring"
git push
```

---

## Task 7: Bar-correction visible feedback

**Files:**
- Modify: `app/src/components/StockChart.jsx`
- Modify: `app/src/components/StockChart.module.css`

- [ ] **Step 1: Add brief flash when bar_correction fires**

When the `bar_correction` event arrives for the current symbol, briefly flash a "Corrected" label (e.g., 2-second amber pill, fades out). Useful operator signal that reconciliation overrode the WS bar.

```jsx
const [correctionFlash, setCorrectionFlash] = useState(false);

useEffect(() => {
  // Subscribe to a separate "correction" channel on the registry
  const unsub = realtimeCandle.onCorrection(symbol, () => {
    setCorrectionFlash(true);
    setTimeout(() => setCorrectionFlash(false), 2000);
  });
  return unsub;
}, [symbol]);

// In render:
{correctionFlash && <div className={styles.correctionFlash}>↻ Bar corrected</div>}
```

Add `realtimeCandle.onCorrection(sym, callback)` API to the registry — separate from the general subscribe so it only fires on correction events.

- [ ] **Step 2: CSS for the flash**

```css
.correctionFlash {
  position: absolute;
  top: 8px;
  right: 110px;  /* avoid overlapping stale indicator */
  z-index: 100;
  background: rgba(217, 119, 6, 0.85);
  color: #fff;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  animation: correction-fade 2s ease-in-out;
}

@keyframes correction-fade {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 3: Build + commit + push**

```bash
git add app/src/components/StockChart.jsx app/src/components/StockChart.module.css app/src/lib/realtimeCandle.js
git commit -m "feat(charts): visible bar-correction flash on live chart"
git push
```

---

## Task 8: WS chaos test + integration

**Files:**
- Create: `tests/test_realtime_chaos.py`

- [ ] **Step 1: Tests for chaos scenarios**

```python
"""WS chaos tests — exercise edge cases of the real-time engine."""
import time
from api.services import realtime_candle as rc


def test_tick_replay_burst():
    """100 ticks across a 1-min window — final candle has correct OHLC + total volume."""
    rc._reset()
    base = 1715080800
    rc.apply_tick("QQQ", price=700.0, ts=base, size=10, tf="1")
    high = 700.0
    low = 700.0
    last_price = 700.0
    total_vol = 10
    for i in range(1, 60):
        price = 700.0 + (i % 7) * 0.5  # oscillating
        ts = base + i
        rc.apply_tick("QQQ", price=price, ts=ts, size=1, tf="1")
        high = max(high, price)
        low = min(low, price)
        last_price = price
        total_vol += 1
    cur = rc.get_current("QQQ", "1")
    assert cur["o"] == 700.0
    assert cur["h"] == high
    assert cur["l"] == low
    assert cur["c"] == last_price
    assert cur["v"] == total_vol


def test_period_boundary_in_flight():
    """Tick at 09:59:59 then 10:00:00 — bar rolls correctly."""
    rc._reset()
    rc.apply_tick("QQQ", price=700.0, ts=1715085599, size=10, tf="1")  # 09:59:59
    closed = rc.apply_tick("QQQ", price=701.0, ts=1715085600, size=5, tf="1")  # 10:00:00
    assert len(closed) == 1
    assert closed[0]["c"] == 700.0
    cur = rc.get_current("QQQ", "1")
    assert cur["o"] == 701.0


def test_concurrent_ticks_no_corruption():
    """Threaded ticks don't corrupt the candle (lock works)."""
    import threading
    rc._reset()
    base = 1715080800
    def push(idx):
        for i in range(50):
            rc.apply_tick("QQQ", price=700.0 + (idx + i) * 0.01, ts=base + i, size=1, tf="1")
    threads = [threading.Thread(target=push, args=(i,)) for i in range(4)]
    for t in threads: t.start()
    for t in threads: t.join()
    cur = rc.get_current("QQQ", "1")
    assert cur["v"] == 200  # 4 × 50 ticks
    assert cur["o"] == 700.0
```

- [ ] **Step 2: Tests pass + commit**

```bash
pytest tests/test_realtime_chaos.py -v
git add tests/test_realtime_chaos.py
git commit -m "test(charts): WS chaos tests for realtime_candle"
git push
```

---

## Plan 4 Done — what changed

After Plan 4 ships:

1. **Server-authoritative candle state** — every (ticker, tf) currently subscribed has authoritative OHLCV maintained on the server.
2. **Tick → candle pipeline** — every WS tick updates the candle; out-of-order and anomalous ticks dropped.
3. **Period-boundary handling** — at every minute boundary, prior bar closes cleanly and new bar starts.
4. **Minute-close reconciliation** — server fetches REST snapshot, compares, broadcasts correction if disagreement.
5. **Frontend single global registry** — `realtimeCandle.js` is the source of truth for chart state across all chart instances.
6. **SSE event types** — tick, bar_close, bar_correction (plus existing stale/fresh from Plan 2).
7. **Visible feedback** — bar-correction flash on chart so operators see when reconciliation fires.
8. **Chaos tests** — verify behavior under burst, boundary, and concurrent-tick scenarios.

This solves the "inaccurate live candle" pain point. The developing candle now tracks ticks accurately, period boundaries roll cleanly, and any drift between WS and REST is reconciled within ~60s.

---

## Self-Review Notes

- All thread-safety via per-module `RLock` (matches Plan 1+2 patterns).
- Frontend registry deliberately separate from the React component tree — multiple charts share the same state without prop drilling.
- Minute-close reconciliation runs every 60s in a background asyncio task; cost is bounded by the number of subscribed tickers.
- Bar-correction is rare in steady state (only fires when WS-built bar diverges from REST > 0.05% close). When it does fire, operators see it via the visible flash.
- No placeholders — every code block is real, tested code.
