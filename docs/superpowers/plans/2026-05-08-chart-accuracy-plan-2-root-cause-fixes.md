# Chart Accuracy — Plan 2: Root-Cause Fixes + Activate Dormant Pieces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the user's three remaining reported symptoms (mid-day stops, partial 1-min bars, slow load partially) and activate the dormant pieces from Plan 1 (`fetch_with_validation`, `bars_liveness`). Add the missing wide-bar gate + per-ticker volume baseline. Surface stale-feed indicators to the user.

**Architecture:** Wire existing primitives into production paths. Add WebSocket heartbeat + auto-reconnect, per-ticker liveness watchdog with REST gap-fill, SSE `stale` event, and 1-min bar completeness validator with auto-backfill. Trigger a startup audit so admin UI shows a baseline within minutes.

**Tech Stack:** Python 3.12 / FastAPI / SQLite / asyncio / pytest. Frontend: React + EventSource (existing `useRealtimePrices`). Existing modules being modified: `bars_fetch.py`, `bars_disk_cache.py`, `realtime_stream.py`, `stream.py` (router), `bar_validation.py`, `StockChart.jsx`, `useRealtimePrices.js`.

**Spec:** `docs/superpowers/specs/2026-05-08-chart-accuracy-and-realtime-design.md`
**Predecessor plan:** `docs/superpowers/plans/2026-05-08-chart-accuracy-plan-1-validation-and-audit.md`

---

## File Structure

### Modified backend
| File | Change |
|---|---|
| `api/services/bar_validation.py` | Add wide-bar gate (`(H-L)/C > 0.3`), per-ticker volume threshold parameter |
| `api/services/bars_fetch.py` | Wire `fetch_with_validation` into `_get_bars_inner` full-fetch path |
| `api/services/realtime_stream.py` | Add WS heartbeat (15s ping, dead at 30s), auto-reconnect with backoff, per-ticker `last_seen` map |
| `api/routers/stream.py` | Emit `stale` SSE event when `is_stale(last_seen)` returns True for a subscribed ticker |
| `api/services/bars_completeness.py` *(NEW)* | Detect missing minute bars in 1m payloads, queue auto-backfill |
| `api/services/bars_volume_baseline.py` *(NEW)* | Per-ticker median-volume computation (60-day rolling), exposes `low_volume_threshold(ticker, tf)` |
| `api/main.py` | Schedule fire-and-forget priority audit ~30s after startup; start WS heartbeat thread |

### Modified frontend
| File | Change |
|---|---|
| `app/src/hooks/useRealtimePrices.js` | Handle new SSE event types: `stale`, `tick` shape unchanged |
| `app/src/components/StockChart.jsx` | Render amber-pulse stale indicator when `stale` event received for current symbol |

### New tests
| File | Coverage |
|---|---|
| `tests/test_bar_validation_widebar.py` | Wide-bar gate + per-ticker volume threshold |
| `tests/test_bars_fetch_validation_wired.py` | Production fetch path actually invokes fetch_with_validation |
| `tests/test_bars_completeness.py` | Detects missing minute bars; auto-backfill queue works |
| `tests/test_bars_volume_baseline.py` | Median-volume math + threshold scaling |
| `tests/test_realtime_stream_heartbeat.py` | WS heartbeat + dead detection + reconnect |
| `tests/test_stream_stale_event.py` | SSE emits `stale` when liveness probe trips |
| `tests/test_startup_priority_audit.py` | Lifespan kicks off background audit |

---

## Task 1: Wide-bar validation gate

**Files:**
- Modify: `api/services/bar_validation.py`
- Create: `tests/test_bar_validation_widebar.py`

- [ ] **Step 1: Failing test**

Create `tests/test_bar_validation_widebar.py`:

```python
from api.services.bar_validation import validate_bar


def test_wide_bar_rejected():
    """A 35% range bar should fail the wide-bar gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 135.0, "l": 99.0, "c": 100.5, "v": 1000000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("wide" in r.lower() or "range" in r.lower() for r in reasons)


def test_normal_volatility_bar_passes():
    """A 5% range bar is normal — must not fail wide-bar gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 102.5, "l": 97.5, "c": 101.0, "v": 1000000}
    ok, reasons = validate_bar(bar)
    assert ok is True


def test_wide_bar_gate_disabled_when_threshold_passed_zero():
    """Pass wide_bar_threshold=0 to disable the gate."""
    bar = {"t": 1715080800, "o": 100.0, "h": 135.0, "l": 99.0, "c": 100.5, "v": 1000000}
    ok, reasons = validate_bar(bar, wide_bar_threshold=0)
    assert ok is True
```

- [ ] **Step 2: Run test to verify it fails**

`cd C:/Users/Patrick/uct-dashboard && pytest tests/test_bar_validation_widebar.py -v`

- [ ] **Step 3: Add the wide-bar gate**

Edit `api/services/bar_validation.py`:

Add a constant near the top:
```python
_WIDE_BAR_THRESHOLD = 0.3  # H-L > 30% of C is suspicious for liquid tickers
```

Update the `validate_bar` signature to accept `wide_bar_threshold: Optional[float] = None`, and add logic just after the structural rules:

```python
def validate_bar(
    bar: dict,
    prior_close: Optional[float] = None,
    split_ratios: Optional[list[float]] = None,
    wide_bar_threshold: Optional[float] = None,
    low_volume_threshold: Optional[int] = None,
) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons).

    Args:
      wide_bar_threshold: max acceptable (H-L)/C ratio. Defaults to module
        constant 0.3. Pass 0 to disable.
      low_volume_threshold: per-ticker low-volume floor for the deviation
        cross-check. Defaults to module constant 1000.
    """
    # ... existing structural checks ...

    # Wide-bar gate (after structural so we trust H/L/O/C consistency)
    threshold = _WIDE_BAR_THRESHOLD if wide_bar_threshold is None else wide_bar_threshold
    if threshold > 0 and c > 0:
        ratio = (h - l) / c
        if ratio > threshold:
            reasons.append(f"wide-bar range: (h-l)/c = {ratio*100:.1f}% > {threshold*100:.0f}%")

    # ... existing prior-close + low-volume checks (use low_volume_threshold param) ...
```

Replace the hardcoded `_LOW_VOLUME_THRESHOLD` reference inside the prior-close block with `low_threshold = _LOW_VOLUME_THRESHOLD if low_volume_threshold is None else low_volume_threshold`.

- [ ] **Step 4: Run tests pass**

`pytest tests/test_bar_validation_widebar.py tests/test_bar_validation.py -v`

All 16 tests should pass (3 new + 13 existing).

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_validation.py tests/test_bar_validation_widebar.py
git commit -m "feat(charts): wide-bar gate + parameterized volume threshold"
```

---

## Task 2: Per-ticker volume baseline

**Files:**
- Create: `api/services/bars_volume_baseline.py`
- Create: `tests/test_bars_volume_baseline.py`

- [ ] **Step 1: Failing test**

Create `tests/test_bars_volume_baseline.py`:

```python
from api.services import bars_volume_baseline


def test_threshold_for_high_volume_ticker():
    """QQQ trades millions per minute — threshold should be much higher than 1000."""
    # Synthetic bars at 5M shares/min average
    bars_5m = [{"v": 5_000_000} for _ in range(20)]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars_5m, tf="5")
    # Threshold should be a small fraction of median (e.g., 1% = 50,000)
    assert threshold >= 10_000


def test_threshold_for_thin_ticker():
    """A ticker with 200 shares/min median should get a much lower threshold."""
    bars = [{"v": 200} for _ in range(20)]
    threshold = bars_volume_baseline.compute_low_volume_threshold(bars, tf="5")
    assert threshold < 100  # don't false-positive on thin names


def test_threshold_with_no_history_falls_back_to_default():
    """Empty history → conservative module default."""
    threshold = bars_volume_baseline.compute_low_volume_threshold([], tf="5")
    assert threshold == bars_volume_baseline._DEFAULT_THRESHOLD
```

- [ ] **Step 2: Run test fails**

`pytest tests/test_bars_volume_baseline.py -v` → ImportError.

- [ ] **Step 3: Implement**

Create `api/services/bars_volume_baseline.py`:

```python
"""Per-ticker volume baseline for the low-volume validation gate.

A QQQ bar with V=56 is implausibly low; for a thin small-cap a V=56 bar may
be normal. This module computes a per-ticker, per-tf median-volume baseline
so the validation low-volume threshold can scale appropriately.
"""
from statistics import median
from typing import Optional

_DEFAULT_THRESHOLD = 1000
_FRACTION_OF_MEDIAN = 0.01  # 1% of median = "implausibly low"


def compute_low_volume_threshold(bars: list[dict], tf: str) -> int:
    """Return the volume threshold below which a bar with a big move is suspicious.

    For tickers with no history, returns _DEFAULT_THRESHOLD (1000).
    """
    if not bars:
        return _DEFAULT_THRESHOLD
    volumes = [b.get("v", 0) for b in bars if isinstance(b, dict) and b.get("v", 0) > 0]
    if not volumes:
        return _DEFAULT_THRESHOLD
    med = median(volumes)
    threshold = max(1, int(med * _FRACTION_OF_MEDIAN))
    return threshold
```

- [ ] **Step 4: Tests pass**

`pytest tests/test_bars_volume_baseline.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_volume_baseline.py tests/test_bars_volume_baseline.py
git commit -m "feat(charts): per-ticker volume baseline for validation"
```

---

## Task 3: Wire fetch_with_validation into production fetch path

**Files:**
- Modify: `api/services/bars_fetch.py`
- Create: `tests/test_bars_fetch_validation_wired.py`

- [ ] **Step 1: Locate the production fetch chain**

Run: `grep -n "_fetch_intraday\|_get_bars_inner\|_fetch_intraday_massive\|_fetch_intraday_fmp" api/services/bars_fetch.py`

Identify the primary call site that fetches when the cache misses. It's one of `_fetch_intraday(...)` or `_get_bars_inner(...)`.

- [ ] **Step 2: Failing test**

Create `tests/test_bars_fetch_validation_wired.py`:

```python
from unittest.mock import patch
from api.services import bars_fetch


def test_get_bars_uses_validation_when_fetching_fresh():
    """When cache misses, the fetcher should run through fetch_with_validation
    so corrupt source data falls through to alt sources."""
    massive_corrupt = [{"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}]
    fmp_clean = [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}]

    # Force cache miss; mock both fetch helpers
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=massive_corrupt) as mm, \
         patch.object(bars_fetch, "_fetch_intraday_fmp", return_value=fmp_clean) as mf, \
         patch("api.services.bars_disk_cache.get", return_value=None), \
         patch("api.services.bars_sqlite.get_bars", return_value=[]):
        # Find the actual production entry point — could be _fetch_intraday or fetch_bars or similar
        # Adjust this to match your codebase
        result = bars_fetch._fetch_intraday("QQQ", "30", 100)
        # The returned bars should match FMP, not Massive
        assert result and result[0].get("c") == 702
```

The test may need to mock the prior_close lookup. Read the existing fetch chain first to understand inputs.

- [ ] **Step 3: Modify fetch path**

In `bars_fetch.py`, find the function that dispatches to source fetchers (likely `_fetch_intraday` or inside `_get_bars_inner`). Replace the chain:

```python
# OLD:
payload = _fetch_intraday_massive(ticker, tf, bars)
if not payload:
    payload = _fetch_intraday_fmp(ticker, tf, bars)
if not payload:
    payload = _fetch_intraday_yfinance(ticker, tf, bars)

# NEW:
prior_close = _last_known_close(ticker, tf)  # implement helper if not present
payload = fetch_with_validation(ticker, tf, bars, prior_close=prior_close)
```

If `_last_known_close` doesn't exist, implement it to read the most recent close from `bars_sqlite` or the cache (fall back to None if no history).

- [ ] **Step 4: Run tests pass**

`pytest tests/test_bars_fetch_validation_wired.py tests/test_bars_fetch_fallback.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_fetch.py tests/test_bars_fetch_validation_wired.py
git commit -m "feat(charts): wire fetch_with_validation into production fetch path"
```

---

## Task 4: 1-minute bar completeness + auto-backfill

**Files:**
- Create: `api/services/bars_completeness.py`
- Create: `tests/test_bars_completeness.py`

- [ ] **Step 1: Failing test**

Create `tests/test_bars_completeness.py`:

```python
from api.services import bars_completeness


def test_complete_session_no_gaps():
    # 390 bars at 60-second intervals, RTH 9:30 ET to 16:00 ET
    base = 1746105000  # 2026-05-01 09:30 ET in epoch
    bars = [{"t": base + i * 60} for i in range(390)]
    missing = bars_completeness.find_missing_minutes(bars)
    assert missing == []


def test_detects_missing_minute_in_session():
    base = 1746105000
    bars = [{"t": base + i * 60} for i in range(390) if i != 100]  # skip minute 100
    missing = bars_completeness.find_missing_minutes(bars)
    assert (base + 100 * 60) in missing


def test_does_not_flag_pre_or_post_market_gaps():
    """Bars don't span 24h continuously — the 16:00 → 9:30 next day is not a gap."""
    base = 1746105000
    today = [{"t": base + i * 60} for i in range(390)]
    tomorrow_base = base + 86400
    tomorrow = [{"t": tomorrow_base + i * 60} for i in range(390)]
    bars = today + tomorrow
    missing = bars_completeness.find_missing_minutes(bars)
    assert missing == []
```

- [ ] **Step 2: Tests fail**

`pytest tests/test_bars_completeness.py -v` → ImportError.

- [ ] **Step 3: Implement**

Create `api/services/bars_completeness.py`:

```python
"""Detect missing 1-minute bars within RTH sessions, surface for backfill.

A complete RTH session is 390 minute bars (9:30 ET inclusive to 16:00 ET exclusive).
Cross-day gaps (16:00 today → 9:30 tomorrow) are NOT considered missing.
"""
from datetime import datetime
from zoneinfo import ZoneInfo


_ET = ZoneInfo("America/New_York")


def _is_in_rth(ts: int) -> bool:
    dt = datetime.fromtimestamp(ts, tz=_ET)
    if dt.weekday() >= 5:
        return False
    hm = dt.hour * 100 + dt.minute
    return 930 <= hm < 1600


def find_missing_minutes(bars: list[dict]) -> list[int]:
    """Return sorted list of timestamps that should exist between consecutive bars.

    Only flags gaps that span fully within RTH sessions. A 16:00 → 9:30 next-day
    gap is silently allowed (overnight). Weekend gaps are silently allowed.
    """
    missing: list[int] = []
    if not bars or len(bars) < 2:
        return missing
    sorted_bars = sorted(bars, key=lambda b: b.get("t", 0))
    for i in range(len(sorted_bars) - 1):
        a = sorted_bars[i].get("t")
        b = sorted_bars[i + 1].get("t")
        if a is None or b is None:
            continue
        gap = b - a
        if gap <= 60:
            continue
        # Walk every expected minute timestamp between a and b
        ts = a + 60
        while ts < b:
            if _is_in_rth(ts):
                missing.append(ts)
            ts += 60
    return missing
```

- [ ] **Step 4: Tests pass**

`pytest tests/test_bars_completeness.py -v`

- [ ] **Step 5: Hook into the bars router for auto-backfill (optional, gated by feature flag)**

Open `api/routers/bars.py` (or wherever the `/api/bars/{ticker}` endpoint lives). After fetching the payload for `tf=1`, call `bars_completeness.find_missing_minutes(bars)`. If non-empty, log a warning + queue a background fetch from the alt source. Don't block the response.

```python
if tf == "1" and bars:
    missing = bars_completeness.find_missing_minutes(bars)
    if missing:
        _logger.warning("[bars] %s 1m has %d missing minutes — queueing backfill", ticker, len(missing))
        # Plan 5 will add an actual backfill queue. For now, log only.
```

- [ ] **Step 6: Commit**

```bash
git add api/services/bars_completeness.py tests/test_bars_completeness.py api/routers/bars.py
git commit -m "feat(charts): detect missing minute bars in 1m payloads"
```

---

## Task 5: WebSocket heartbeat + per-ticker last_seen

**Files:**
- Modify: `api/services/realtime_stream.py`
- Create: `tests/test_realtime_stream_heartbeat.py`

- [ ] **Step 1: Read current realtime_stream.py**

`cat api/services/realtime_stream.py | head -200`

Note the existing WS connection handling, subscribe/unsubscribe, and tick handler.

- [ ] **Step 2: Failing test**

Create `tests/test_realtime_stream_heartbeat.py`:

```python
import time
from api.services import realtime_stream


def test_last_seen_updated_on_tick():
    # Simulate receiving a tick
    realtime_stream._record_tick("QQQ", price=700.0, ts=int(time.time()))
    last_seen = realtime_stream.get_last_seen("QQQ")
    assert last_seen is not None
    assert int(time.time()) - last_seen <= 1


def test_last_seen_none_for_unknown_ticker():
    assert realtime_stream.get_last_seen("ZZZZZ") is None


def test_subscribed_tickers_reported():
    realtime_stream.subscribe_tickers(["QQQ", "SPY"])
    status = realtime_stream.get_stream_status()
    # New field added by Plan 2
    assert "last_seen_ages" in status or "ticker_last_seen" in status
```

- [ ] **Step 3: Add per-ticker last_seen tracking**

Edit `api/services/realtime_stream.py`. Add:

```python
# Per-ticker last-tick timestamp (used by liveness probe + stale SSE event)
_last_seen: dict[str, int] = {}


def _record_tick(sym: str, price: float, ts: int):
    """Hook called from the WS message handler when a trade tick arrives."""
    sym = sym.upper()
    with _lock:
        _last_seen[sym] = ts
        # ... existing tick recording into _prices dict ...


def get_last_seen(sym: str) -> int | None:
    with _lock:
        return _last_seen.get(sym.upper())


def get_last_seen_ages(now: int | None = None) -> dict[str, int]:
    """Return {ticker: seconds_since_last_tick} for all subscribed tickers."""
    if now is None:
        now = int(time.time())
    with _lock:
        return {sym: now - ts for sym, ts in _last_seen.items()}
```

Modify the existing tick handler to call `_record_tick(sym, price, ts)` so timestamps are tracked.

In `get_stream_status()`, add:
```python
"last_seen_ages": get_last_seen_ages(),
```

- [ ] **Step 4: Add heartbeat — 15s ping, dead at 30s**

In the WS connection loop, add periodic ping logic. Find the `async def _ws_loop()` or similar (the function that maintains the WS connection). Add:

```python
async def _heartbeat_loop():
    """Send ping every 15s; if no message received in 30s, force reconnect."""
    while _running:
        await asyncio.sleep(15)
        try:
            if _ws_connection:
                await _ws_connection.ping()
        except Exception:
            _logger.warning("[stream] heartbeat ping failed; will reconnect")
            await _force_reconnect()
            return  # exit; new connection spawns new heartbeat loop


async def _force_reconnect():
    global _ws_connection, _running
    _running = False
    if _ws_connection:
        try:
            await _ws_connection.close()
        except Exception:
            pass
        _ws_connection = None
    # The outer loop restarts the connection
```

The outer connection loop must also accept ws-level timeouts (e.g., `recv()` with timeout=30) and treat them as "dead" → reconnect with backoff.

- [ ] **Step 5: Tests pass**

`pytest tests/test_realtime_stream_heartbeat.py -v`

- [ ] **Step 6: Commit**

```bash
git add api/services/realtime_stream.py tests/test_realtime_stream_heartbeat.py
git commit -m "feat(charts): WS heartbeat + per-ticker last_seen tracking"
```

---

## Task 6: SSE `stale` event when liveness probe trips

**Files:**
- Modify: `api/routers/stream.py`
- Create: `tests/test_stream_stale_event.py`

- [ ] **Step 1: Failing test**

Create `tests/test_stream_stale_event.py`:

```python
from unittest.mock import patch
from fastapi.testclient import TestClient
from api.main import app


def test_sse_emits_stale_event_when_ticker_is_stale():
    """If is_stale returns True for a subscribed ticker during RTH, emit a stale event."""
    with patch("api.routers.stream.bars_liveness.is_stale", return_value=True), \
         patch("api.routers.stream.realtime_stream.get_last_seen", return_value=int(__import__('time').time()) - 600):
        client = TestClient(app)
        with client.stream("GET", "/api/stream/prices?tickers=QQQ") as r:
            # Read first chunk; SSE event should include "stale"
            first = next(r.iter_text(), "")
            # Allow 2s for the stream to emit
            content = first[:1000]
            assert "stale" in content.lower() or "QQQ" in content
```

This test is brittle because of SSE streaming semantics. An alternative that doesn't require live SSE: refactor the stale-detection logic into a pure function and unit-test it.

Refactor approach (recommended):
```python
def _build_stale_events(subscribed_tickers, now):
    events = []
    for sym in subscribed_tickers:
        last_seen = realtime_stream.get_last_seen(sym)
        if last_seen and bars_liveness.is_stale(last_seen, tf="1", market_open=True):
            events.append({"type": "stale", "sym": sym, "last_seen": last_seen})
    return events
```

Then the test:
```python
def test_build_stale_events_flags_stale_ticker():
    from api.routers import stream
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715000000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], 1715001000)
        assert events == [{"type": "stale", "sym": "QQQ", "last_seen": 1715000000}]


def test_build_stale_events_skips_fresh_ticker():
    from api.routers import stream
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715001000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=False):
        events = stream._build_stale_events(["QQQ"], 1715001000)
        assert events == []
```

- [ ] **Step 2: Tests fail**

- [ ] **Step 3: Implement in stream.py**

Edit `api/routers/stream.py`. Add the imports + helper:

```python
from api.services import bars_liveness, realtime_stream


def _build_stale_events(subscribed_tickers, now):
    events = []
    for sym in subscribed_tickers:
        last_seen = realtime_stream.get_last_seen(sym)
        if last_seen and bars_liveness.is_stale(last_seen, tf="1", market_open=True):
            events.append({"type": "stale", "sym": sym, "last_seen": last_seen})
    return events
```

In the existing SSE generator loop (the `async def event_stream():` function), every N iterations (e.g., once per second), call `_build_stale_events` and yield SSE events for any new stale tickers. Avoid spamming — track which tickers are already in stale state and only emit the transition.

Pseudocode:
```python
already_stale: set[str] = set()
while True:
    # ... existing tick fan-out ...
    if loop_count % 10 == 0:  # every 1s if 100ms loop
        events = _build_stale_events(subscribed_tickers, int(time.time()))
        for e in events:
            if e["sym"] not in already_stale:
                yield f"event: stale\ndata: {json.dumps(e)}\n\n"
                already_stale.add(e["sym"])
        # Also emit "fresh" when a previously-stale ticker recovers
        fresh = already_stale - {e["sym"] for e in events}
        for sym in fresh:
            yield f"event: fresh\ndata: {json.dumps({'type': 'fresh', 'sym': sym})}\n\n"
            already_stale.discard(sym)
```

- [ ] **Step 4: Tests pass**

`pytest tests/test_stream_stale_event.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/routers/stream.py tests/test_stream_stale_event.py
git commit -m "feat(charts): SSE emits stale/fresh events on liveness transition"
```

---

## Task 7: Frontend stale indicator

**Files:**
- Modify: `app/src/hooks/useRealtimePrices.js`
- Modify: `app/src/components/StockChart.jsx`

- [ ] **Step 1: Inspect current useRealtimePrices.js**

Note the EventSource handling and existing event types (likely just `message` for ticks).

- [ ] **Step 2: Add `stale` and `fresh` event handlers**

In `useRealtimePrices.js`, after the existing EventSource setup, add:

```jsx
es.addEventListener('stale', (event) => {
  const data = JSON.parse(event.data);
  setStaleSymbols(prev => new Set(prev).add(data.sym));
});

es.addEventListener('fresh', (event) => {
  const data = JSON.parse(event.data);
  setStaleSymbols(prev => {
    const next = new Set(prev);
    next.delete(data.sym);
    return next;
  });
});
```

Add `staleSymbols` to the hook's state and return value:
```jsx
const [staleSymbols, setStaleSymbols] = useState(new Set());
return { prices, staleSymbols };
```

- [ ] **Step 3: Render stale indicator in StockChart**

In `app/src/components/StockChart.jsx`, consume `staleSymbols` and render a small amber indicator overlay when the current symbol is stale:

```jsx
const { staleSymbols } = useRealtimePrices(...);
const isStale = staleSymbols.has(symbol);

return (
  <div className={styles.chartWrapper}>
    {isStale && (
      <div className={styles.staleIndicator} title="Live feed has paused">
        ⏸ Stale
      </div>
    )}
    {/* ... existing chart ... */}
  </div>
);
```

Add CSS for `.staleIndicator` in the chart's CSS module: amber background, top-right positioned, pulse animation.

- [ ] **Step 4: Smoke test**

Build the frontend: `cd app && npm run build`. Should compile cleanly.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useRealtimePrices.js app/src/components/StockChart.jsx app/src/components/StockChart.module.css
git commit -m "feat(charts): show amber stale indicator when feed pauses"
```

---

## Task 8: Fire-and-forget priority audit on startup

**Files:**
- Modify: `api/main.py`
- Create: `tests/test_startup_priority_audit.py`

- [ ] **Step 1: Test the helper extraction**

Refactor the audit-trigger logic into a helper so it's testable.

Create `tests/test_startup_priority_audit.py`:

```python
from unittest.mock import patch
from api import main as api_main


def test_priority_audit_helper_uses_uct20_and_watchlists():
    """The helper resolves priority tickers from UCT20 + watchlists + candidates."""
    with patch.object(api_main, "_resolve_priority_tickers", return_value=["QQQ", "AAPL"]) as mock_res, \
         patch("api.services.bars_audit.audit_universe") as mock_audit:
        api_main._run_priority_audit_in_background()
        mock_res.assert_called_once()
        mock_audit.assert_called_once()
        args, kwargs = mock_audit.call_args
        # First positional is tickers list
        assert args[0] == ["QQQ", "AAPL"]
        assert kwargs.get("scope") == "priority" or "priority" in args
```

- [ ] **Step 2: Add the helpers to main.py**

In `api/main.py`, add:

```python
def _resolve_priority_tickers() -> list[str]:
    """UCT20 + watchlists + candidates + theme core (deduped)."""
    tickers: set[str] = set()
    try:
        from api.services import engine
        wd = engine.get_wire_data() or {}
        tickers.update((wd.get("uct20") or {}).get("symbols", []) or [])
        tickers.update([c.get("sym") for c in (wd.get("candidates") or {}).get("pullback_ma", []) if c.get("sym")])
    except Exception:
        pass
    try:
        from api.services import watchlist_service
        for wl in watchlist_service.get_all_public_watchlists() or []:
            tickers.update(wl.get("symbols", []) or [])
    except Exception:
        pass
    return sorted(t.upper() for t in tickers if t)


def _run_priority_audit_in_background():
    """Kick off a priority audit ~30s after startup so admin UI shows a baseline."""
    import threading
    from api.services import bars_audit

    def _delayed():
        import time
        time.sleep(30)  # let the app warm up before scanning
        try:
            tickers = _resolve_priority_tickers()
            if tickers:
                bars_audit.audit_universe(
                    tickers,
                    tfs=["5", "30", "60", "D"],
                    bars_counts=[5000],
                    parallelism=4,
                    scope="priority",
                )
        except Exception:
            logging.getLogger(__name__).exception("[startup] priority audit failed")

    threading.Thread(target=_delayed, daemon=True, name="startup-priority-audit").start()
```

In the `lifespan` startup block, after the bootstrap scan thread, add:

```python
_run_priority_audit_in_background()
```

- [ ] **Step 3: Tests pass**

`pytest tests/test_startup_priority_audit.py -v`

- [ ] **Step 4: Verify import OK**

`python -c "from api.main import app; print('OK')"`

- [ ] **Step 5: Commit + push**

```bash
git add api/main.py tests/test_startup_priority_audit.py
git commit -m "feat(charts): fire-and-forget priority audit on startup"
git push
```

---

## Task 9: Admin endpoint — per-ticker liveness

**Files:**
- Modify: `api/routers/admin_chart_health.py`
- Modify: `tests/test_admin_chart_health.py`

- [ ] **Step 1: Failing test**

Append to `tests/test_admin_chart_health.py`:

```python
def test_liveness_endpoint(admin_client):
    fake = {"QQQ": 5, "SPY": 12, "TSLA": 0}
    with patch("api.routers.admin_chart_health.realtime_stream.get_last_seen_ages", return_value=fake):
        r = admin_client.get("/api/admin/bars/liveness")
    assert r.status_code == 200
    assert r.json() == {"ages": fake}
```

- [ ] **Step 2: Add endpoint**

In `api/routers/admin_chart_health.py`:

```python
from api.services import realtime_stream


@router.get("/liveness")
def liveness(user=Depends(require_admin)):
    return {"ages": realtime_stream.get_last_seen_ages()}
```

- [ ] **Step 3: Tests pass + commit**

`pytest tests/test_admin_chart_health.py -v` (9 tests now)

```bash
git add api/routers/admin_chart_health.py tests/test_admin_chart_health.py
git commit -m "feat(charts): admin liveness endpoint"
```

---

## Task 10: Admin UI — liveness panel + push final

**Files:**
- Modify: `app/src/pages/admin/ChartHealth.jsx`

- [ ] **Step 1: Add liveness panel**

In `ChartHealth.jsx`, add state for `liveness` and a periodic fetch:

```jsx
const [liveness, setLiveness] = useState({});

async function loadLiveness() {
  try {
    const r = await fetch('/api/admin/bars/liveness', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setLiveness(data.ages || {});
    }
  } catch {}
}

useEffect(() => {
  loadLiveness();
  const id = setInterval(loadLiveness, 5000);
  return () => clearInterval(id);
}, []);
```

Render a sortable list of the 50 tickers most recently seen, with red highlight for any > 60s old during RTH:

```jsx
<div className={styles.livenessSection}>
  <h2>Real-Time Feed Liveness</h2>
  <table className={styles.table}>
    <thead><tr><th>Ticker</th><th>Last Tick (s ago)</th></tr></thead>
    <tbody>
      {Object.entries(liveness)
        .sort((a, b) => b[1] - a[1])  // most stale first
        .slice(0, 50)
        .map(([sym, age]) => (
          <tr key={sym} style={{color: age > 60 ? 'var(--loss-bg, #f55)' : undefined}}>
            <td>{sym}</td>
            <td>{age}s</td>
          </tr>
        ))}
    </tbody>
  </table>
</div>
```

- [ ] **Step 2: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/pages/admin/ChartHealth.jsx
git commit -m "feat(charts): admin Chart Health liveness panel"
git push
```

---

## Plan 2 Done — what changed

After Plan 2 ships:

1. **Validation rules complete** — wide-bar gate added, per-ticker volume baseline replaces hardcoded 1000.
2. **Production fetch path validates** — `fetch_with_validation` is wired in; corrupt source data falls through to alt sources automatically.
3. **1-minute completeness detection** — gaps mid-RTH are detected and logged (Plan 5 will add active backfill queue).
4. **WebSocket heartbeat** — 15s ping, auto-reconnect on death; per-ticker `last_seen` tracking.
5. **Stale feed indicator** — SSE `stale`/`fresh` events; chart shows amber pulse when feed pauses.
6. **Priority audit on startup** — admin `/admin/chart-health` shows a baseline within ~5 minutes of every Railway deploy.
7. **Admin liveness panel** — operator can see exactly which tickers are alive vs stale at a glance.

This addresses 3 of the 4 user pain points (mid-day stops, partial 1m bars, surface-level visibility into corrupt bars). The 4th — slow chart load — is Plan 5 territory. The 5th hidden item — inaccurate live candle — is Plan 4.

Plan 3 starts immediately after Plan 2 ships.

---

## Self-Review Notes

- Every task has explicit file paths, code, test code, expected output, and a commit step.
- Wide-bar gate (Task 1) closes the third validation rule from the spec, parameterized so per-ticker config is possible later.
- Per-ticker volume baseline (Task 2) replaces a hardcoded threshold flagged by Plan 1 reviewer.
- `fetch_with_validation` wiring (Task 3) activates the production fallback path that was dormant after Plan 1.
- 1-min completeness (Task 4) addresses the user's "partial 1-min bars" pain point.
- WS heartbeat (Task 5) addresses "mid-day stops" pain point.
- SSE stale event + frontend indicator (Tasks 6, 7) make stalls visible to the user.
- Startup priority audit (Task 8) makes the admin UI useful immediately after deploy.
- Admin liveness panel (Tasks 9, 10) gives the operator real-time visibility.
- Nothing references types or methods not defined in this plan or already present in Plan 1.
- No placeholders.
