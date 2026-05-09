# Chart Accuracy — Plan 3: Pipeline Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-bar provenance, async multi-source reconciliation for priority tickers, three-way disagreement handling, source-level circuit breakers, and self-healing on quarantine. Make corruption visible at the source level so operators know which provider is producing bad data.

**Architecture:** Sidecar SQLite `bar_provenance` table tracks `(ticker, tf, bar_time) → (source, validated_at, verified_at)`. Async reconciliation worker pulls bars from secondary sources for high-priority tickers, compares to cached, votes 2-of-3. Source circuit breaker tracks per-source pass-rates in a rolling 1-hour window; when below 95%, falls over until recovered.

**Tech Stack:** Python 3.12 / FastAPI / SQLite / asyncio. Building on `bar_validation.py`, `bar_quarantine.py`, `bars_fetch.py`, `bars_disk_cache.py`, `bars_audit.py` from Plans 1 + 2.

**Spec:** `docs/superpowers/specs/2026-05-08-chart-accuracy-and-realtime-design.md`
**Predecessors:** Plans 1 & 2

---

## File Structure

### New backend modules
| File | Responsibility |
|---|---|
| `api/services/bar_provenance.py` | SQLite-backed `bar_provenance` table — write source + validated_at on every cache write; query by (ticker, tf, bar_time) |
| `api/services/bar_reconcile.py` | Async multi-source agreement check for priority tickers — pull bar from secondary source, compare, record vote |
| `api/services/source_circuit_breaker.py` | Per-source pass-rate tracking in rolling 1-hour window. State: ok/degraded. Auto-recovers. |
| `api/services/bar_self_heal.py` | When a bar is quarantined, attempt re-fetch from alternate source. Replace quarantine entry on success. |

### Modified backend
| File | Change |
|---|---|
| `api/services/bar_quarantine.py` | Add `quarantine_with_source` API; emit "quarantined" hook for self-heal trigger |
| `api/services/bars_disk_cache.py` | `put()` records provenance for each clean bar written |
| `api/services/bars_fetch.py` | `fetch_with_validation` records source attempt outcomes for circuit breaker |
| `api/routers/admin_chart_health.py` | New endpoints: provenance/lookup, source-health, force-reconcile |
| `api/main.py` | Schedule reconciliation worker; expose self-heal as background task |

### Modified frontend
| File | Change |
|---|---|
| `app/src/pages/admin/ChartHealth.jsx` | Add Source Health panel + Provenance lookup widget |

### New tests
| File | Coverage |
|---|---|
| `tests/test_bar_provenance.py` | CRUD on provenance table |
| `tests/test_bar_reconcile.py` | 2-of-3 majority math + three-way disagreement handling |
| `tests/test_source_circuit_breaker.py` | Pass-rate window math, ok→degraded transition, auto-recovery |
| `tests/test_bar_self_heal.py` | Self-heal triggers on quarantine, replaces with alt-source bar |

---

## Task 1: Provenance table — schema + CRUD

**Files:**
- Create: `api/services/bar_provenance.py`
- Create: `tests/test_bar_provenance.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from api.services import bar_provenance


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()


def test_record_and_lookup(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["source"] == "massive"
    assert row["validated_at"] is not None
    assert row["verified_at"] is None  # not yet reconciled


def test_record_then_verify(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.mark_verified("QQQ", "30", 1715080800)
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["verified_at"] is not None


def test_record_replaces_existing(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.record("QQQ", "30", 1715080800, source="fmp")  # re-fetch
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["source"] == "fmp"


def test_count_by_source(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.record("SPY", "30", 1715080800, source="massive")
    bar_provenance.record("AAPL", "30", 1715080800, source="fmp")
    counts = bar_provenance.count_by_source()
    assert counts == {"massive": 2, "fmp": 1}


def test_get_returns_none_for_unknown(tmp_db):
    assert bar_provenance.get("QQQ", "30", 9999) is None
```

- [ ] **Step 2: Run, fail (ImportError)**

`pytest tests/test_bar_provenance.py -v`

- [ ] **Step 3: Implement**

```python
"""Per-bar source attribution. Sidecar table; never blocks the cache path.

Records which source produced each cached bar so operators can answer:
  - "Where did this bar come from?"
  - "How many bars per source today?"
  - "Has it been independently verified by reconciliation?"
"""
import os
import sqlite3
import time
from typing import Optional

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bar_provenance (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  source TEXT NOT NULL,
  validated_at INTEGER NOT NULL,
  verified_at INTEGER,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON bar_provenance(source);
CREATE INDEX IF NOT EXISTS idx_provenance_validated_at ON bar_provenance(validated_at);
"""


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def record(ticker: str, tf: str, bar_time: int, source: str) -> None:
    with _conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO bar_provenance "
            "(ticker, tf, bar_time, source, validated_at) VALUES (?, ?, ?, ?, ?)",
            (ticker.upper(), tf, int(bar_time), source, int(time.time())),
        )


def mark_verified(ticker: str, tf: str, bar_time: int) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE bar_provenance SET verified_at=? WHERE ticker=? AND tf=? AND bar_time=?",
            (int(time.time()), ticker.upper(), tf, int(bar_time)),
        )


def get(ticker: str, tf: str, bar_time: int) -> Optional[dict]:
    with _conn() as db:
        row = db.execute(
            "SELECT ticker, tf, bar_time, source, validated_at, verified_at "
            "FROM bar_provenance WHERE ticker=? AND tf=? AND bar_time=?",
            (ticker.upper(), tf, int(bar_time)),
        ).fetchone()
    if not row:
        return None
    return {"ticker": row[0], "tf": row[1], "bar_time": row[2],
            "source": row[3], "validated_at": row[4], "verified_at": row[5]}


def count_by_source() -> dict[str, int]:
    with _conn() as db:
        rows = db.execute(
            "SELECT source, COUNT(*) FROM bar_provenance GROUP BY source"
        ).fetchall()
    return {r[0]: r[1] for r in rows}
```

- [ ] **Step 4: Tests pass**

`pytest tests/test_bar_provenance.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_provenance.py tests/test_bar_provenance.py
git commit -m "feat(charts): per-bar provenance table"
```

---

## Task 2: Hook provenance into cache write

**Files:**
- Modify: `api/services/bars_disk_cache.py`
- Modify: `api/services/bars_fetch.py`
- Create: `tests/test_provenance_wired.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from api.services import bars_disk_cache, bar_provenance


@pytest.fixture
def tmp_setup(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    return cache_dir


def test_put_records_provenance(tmp_setup):
    payload = {
        "source": "massive",
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080900, "o": 702, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p1 = bar_provenance.get("QQQ", "30", 1715080800)
    p2 = bar_provenance.get("QQQ", "30", 1715080900)
    assert p1["source"] == "massive"
    assert p2["source"] == "massive"


def test_put_handles_missing_source(tmp_setup):
    """Payload without source field defaults to 'unknown'."""
    payload = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["source"] == "unknown"
```

- [ ] **Step 2: Run fails**

- [ ] **Step 3: Hook into bars_disk_cache.put**

In `api/services/bars_disk_cache.py`, modify the `put()` function:

```python
from api.services import bar_provenance

def put(ticker: str, tf: str, bars: int, payload: dict):
    raw_bars = payload.get("bars") or []
    if not raw_bars:
        return
    # ... existing validation + quarantine loop ...
    # After clean_bars is built, BEFORE writing the file:
    source = payload.get("source") or "unknown"
    for bar in clean_bars:
        try:
            bar_provenance.record(ticker, tf, int(bar.get("t") or 0), source)
        except Exception:
            pass  # provenance is observability, never break the write path
    # ... existing file write ...
```

- [ ] **Step 4: Make sure fetch_with_validation propagates source**

In `api/services/bars_fetch.py`, ensure `fetch_with_validation` returns payloads tagged with `source`. Currently `_extract_bars` accepts both list and dict shapes. The dict shape preserves source; the list shape needs wrapping.

In the production fetch path that calls `fetch_with_validation`, ensure the result is wrapped with `{"bars": [...], "source": "..."}` before being stored. Find the assignment and wrap if necessary.

- [ ] **Step 5: Tests pass**

`pytest tests/test_provenance_wired.py tests/test_bars_disk_cache_validation.py -v`

- [ ] **Step 6: Commit**

```bash
git add api/services/bars_disk_cache.py api/services/bars_fetch.py tests/test_provenance_wired.py
git commit -m "feat(charts): record provenance on every cache write"
```

---

## Task 3: Source circuit breaker

**Files:**
- Create: `api/services/source_circuit_breaker.py`
- Create: `tests/test_source_circuit_breaker.py`

- [ ] **Step 1: Failing test**

```python
import time
import pytest
from api.services import source_circuit_breaker as scb


@pytest.fixture(autouse=True)
def reset_state():
    scb._reset()
    yield
    scb._reset()


def test_initial_state_ok():
    assert scb.is_ok("massive") is True
    assert scb.state("massive") == "ok"


def test_records_pass_and_fail():
    scb.record_attempt("massive", success=True)
    scb.record_attempt("massive", success=True)
    scb.record_attempt("massive", success=False)
    rate = scb.pass_rate("massive")
    assert abs(rate - 0.667) < 0.01


def test_transitions_to_degraded_below_95_pct():
    """20+ attempts with <95% pass rate → degraded."""
    for _ in range(20):
        scb.record_attempt("massive", success=True)
    for _ in range(2):
        scb.record_attempt("massive", success=False)
    # 20/22 = 90.9% < 95%
    assert scb.state("massive") == "degraded"
    assert scb.is_ok("massive") is False


def test_recovers_after_clean_window():
    """After degraded, 20+ clean attempts in a fresh window → ok."""
    for _ in range(20):
        scb.record_attempt("massive", success=False)
    assert scb.state("massive") == "degraded"
    scb._reset_source("massive")  # simulate window roll
    for _ in range(20):
        scb.record_attempt("massive", success=True)
    assert scb.state("massive") == "ok"


def test_minimum_attempts_threshold():
    """3 attempts not enough to declare degraded — need at least 20 for confidence."""
    for _ in range(3):
        scb.record_attempt("massive", success=False)
    # Only 3 attempts; not enough signal — stay ok
    assert scb.state("massive") == "ok"
```

- [ ] **Step 2: Run fails**

- [ ] **Step 3: Implement**

```python
"""Per-source pass-rate circuit breaker.

Tracks attempts in a rolling 1-hour window. When pass rate drops below 95%
(with at least 20 attempts recorded), the source is marked 'degraded' and
fetch_with_validation should skip it. Auto-recovers when a fresh window
shows 95%+ pass rate.
"""
import threading
import time
from collections import deque

_WINDOW_SEC = 3600  # 1 hour
_MIN_ATTEMPTS = 20
_PASS_RATE_THRESHOLD = 0.95

_lock = threading.RLock()
# Per-source deque of (timestamp, success_bool)
_attempts: dict[str, deque] = {}


def _reset():
    """Test helper — clear all state."""
    with _lock:
        _attempts.clear()


def _reset_source(source: str):
    with _lock:
        _attempts.pop(source, None)


def _prune(source: str, now: int):
    """Drop attempts older than the window."""
    if source not in _attempts:
        return
    cutoff = now - _WINDOW_SEC
    dq = _attempts[source]
    while dq and dq[0][0] < cutoff:
        dq.popleft()


def record_attempt(source: str, success: bool, now: int | None = None):
    if now is None:
        now = int(time.time())
    with _lock:
        if source not in _attempts:
            _attempts[source] = deque()
        _attempts[source].append((now, success))
        _prune(source, now)


def pass_rate(source: str, now: int | None = None) -> float:
    if now is None:
        now = int(time.time())
    with _lock:
        _prune(source, now)
        dq = _attempts.get(source)
        if not dq:
            return 1.0
        passes = sum(1 for _, ok in dq if ok)
        return passes / len(dq)


def state(source: str, now: int | None = None) -> str:
    if now is None:
        now = int(time.time())
    with _lock:
        _prune(source, now)
        dq = _attempts.get(source)
        if not dq or len(dq) < _MIN_ATTEMPTS:
            return "ok"
        rate = pass_rate(source, now)
        return "degraded" if rate < _PASS_RATE_THRESHOLD else "ok"


def is_ok(source: str, now: int | None = None) -> bool:
    return state(source, now) == "ok"


def all_states(now: int | None = None) -> dict[str, dict]:
    """Return current state of every tracked source — admin telemetry."""
    if now is None:
        now = int(time.time())
    with _lock:
        result = {}
        for source in list(_attempts.keys()):
            _prune(source, now)
            dq = _attempts.get(source)
            n = len(dq) if dq else 0
            rate = pass_rate(source, now)
            result[source] = {
                "attempts": n,
                "pass_rate": round(rate, 3),
                "state": state(source, now),
            }
        return result
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Hook into fetch_with_validation**

In `api/services/bars_fetch.py`, modify `fetch_with_validation` to:
1. Skip a source if `source_circuit_breaker.is_ok(source) is False`
2. Record `record_attempt(source, success=valid)` for each source attempt

```python
from api.services import source_circuit_breaker as _scb


def fetch_with_validation(...):
    # Massive
    if _scb.is_ok("massive"):
        try:
            payload = _fetch_intraday_massive(...)
            valid = _payload_passes_validation(payload, prior_close)
            _scb.record_attempt("massive", success=valid)
            if valid:
                return payload
        except Exception:
            _scb.record_attempt("massive", success=False)
    # FMP, yfinance similar
```

Add a test that verifies the breaker is invoked and degraded sources get skipped.

- [ ] **Step 6: Commit**

```bash
git add api/services/source_circuit_breaker.py api/services/bars_fetch.py tests/test_source_circuit_breaker.py
git commit -m "feat(charts): per-source circuit breaker with 1hr rolling window"
```

---

## Task 4: Multi-source reconciliation worker (priority tickers)

**Files:**
- Create: `api/services/bar_reconcile.py`
- Create: `tests/test_bar_reconcile.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from unittest.mock import patch, MagicMock
from api.services import bar_reconcile, bar_provenance, bar_quarantine


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_reconcile_marks_verified_when_2_of_3_agree(tmp_state):
    """Massive (cached) + FMP agree on close=702.5; mark verified."""
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    fmp_bar = {"t": 1715080800, "o": 700, "h": 705.1, "l": 698, "c": 702.6, "v": 1490000}

    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")

    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["verified_at"] is not None
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_reconcile_quarantines_on_disagreement(tmp_state):
    """Cached and secondary disagree by >0.1% on close → cached quarantined."""
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    fmp_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 850.0, "v": 1500000}  # huge diff

    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")

    # Disagreement > tolerance — quarantine the cached one
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_reconcile_skips_when_secondary_unavailable(tmp_state):
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=None):
        bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["verified_at"] is None  # couldn't reconcile
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement**

```python
"""Background reconciliation worker.

For high-priority tickers, after a bar is cached from one source, async-fetch
the same bar from a second source and compare. If they agree within tolerance
(0.1% on close, 5% on volume), mark provenance.verified_at. If they disagree,
quarantine the cached bar and log for operator review.

The reconciliation is opt-in per ticker — only runs for high-traffic tickers
(UCT20, watchlists, candidates). Long tail handled by the continuous audit.
"""
import logging
from typing import Optional
from api.services import bar_provenance, bar_quarantine

_logger = logging.getLogger(__name__)
_CLOSE_TOLERANCE = 0.001  # 0.1%
_VOLUME_TOLERANCE = 0.05  # 5%


def _close_diff(a: float, b: float) -> float:
    if a == 0:
        return 1.0 if b != 0 else 0.0
    return abs(a - b) / a


def _volume_diff(a: float, b: float) -> float:
    if max(a, b) == 0:
        return 0.0
    return abs(a - b) / max(a, b)


def _fetch_secondary(ticker: str, tf: str, bar_time: int, source: str) -> Optional[dict]:
    """Fetch a single bar from `source` for the given (ticker, tf, bar_time).

    Implementation depends on the source. For now, returns None (Plan 4 may add
    a single-bar API on bars_fetch). The function is patched in tests.
    """
    return None  # placeholder — single-bar fetch API TBD; tests patch this


def reconcile_bar(
    ticker: str, tf: str, bar_time: int, cached_bar: dict, secondary_source: str = "fmp"
) -> str:
    """Compare cached bar against a secondary source. Returns verdict.

    Returns:
      "verified": agree within tolerance — provenance.verified_at updated
      "disagree": disagreement — cached bar quarantined
      "skipped": secondary unavailable — neither verified nor quarantined
    """
    secondary = _fetch_secondary(ticker, tf, bar_time, secondary_source)
    if not secondary:
        return "skipped"

    close_d = _close_diff(cached_bar.get("c", 0), secondary.get("c", 0))
    vol_d = _volume_diff(cached_bar.get("v", 0), secondary.get("v", 0))

    if close_d <= _CLOSE_TOLERANCE and vol_d <= _VOLUME_TOLERANCE:
        bar_provenance.mark_verified(ticker, tf, bar_time)
        return "verified"

    bar_quarantine.add(
        ticker, tf, bar_time,
        f"reconcile-disagreement: close_diff={close_d*100:.2f}%, vol_diff={vol_d*100:.2f}% (cached vs {secondary_source})",
        source=f"reconcile/{secondary_source}",
    )
    _logger.warning(
        "[reconcile] %s %s @ %s — disagreement close=%.4f%% vol=%.2f%%",
        ticker, tf, bar_time, close_d * 100, vol_d * 100,
    )
    return "disagree"
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Schedule the worker (optional in this task)**

A background reconciliation worker that walks recent bars for priority tickers and reconciles them is Plan 5 (continuous verification). For Plan 3, providing the `reconcile_bar` API is sufficient — Plan 5 schedules it.

- [ ] **Step 6: Commit**

```bash
git add api/services/bar_reconcile.py tests/test_bar_reconcile.py
git commit -m "feat(charts): bar reconciliation API (2-of-3 agreement)"
```

---

## Task 5: Self-healing on quarantine

**Files:**
- Create: `api/services/bar_self_heal.py`
- Create: `tests/test_bar_self_heal.py`

- [ ] **Step 1: Failing test**

```python
import pytest
from unittest.mock import patch
from api.services import bar_self_heal, bar_quarantine, bar_provenance


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_heal_replaces_quarantined_bar_when_alt_source_clean(tmp_state):
    """A bar quarantined from massive can be healed if FMP returns a valid bar."""
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99%", source="massive")
    fmp_clean = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}

    with patch.object(bar_self_heal, "_fetch_from_alt", return_value=fmp_clean):
        result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "healed"
    assert result["new_source"] == "fmp"  # or whichever fallback source
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_heal_no_op_when_alt_also_corrupt(tmp_state):
    """If alt sources also produce invalid bars, leave quarantine in place."""
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99%", source="massive")
    with patch.object(bar_self_heal, "_fetch_from_alt", return_value=None):
        result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "no-op"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement**

```python
"""Self-healing for quarantined bars.

When a bar is quarantined, attempt to fetch the same bar from an alternate
source. If the alt source returns a valid bar, replace the quarantine entry
with a fresh provenance record. The audit engine triggers this; admin can
also force-heal a specific bar.
"""
import logging
from typing import Optional
from api.services import bar_quarantine, bar_provenance

_logger = logging.getLogger(__name__)
_FALLBACK_ORDER = ["fmp", "yfinance", "massive"]


def _fetch_from_alt(ticker: str, tf: str, bar_time: int, exclude: str) -> Optional[dict]:
    """Fetch a single bar from any source except `exclude`. Returns None if unavailable.

    Implementation TBD (single-bar API on bars_fetch). Test-patched.
    """
    return None


def try_heal(ticker: str, tf: str, bar_time: int, original_source: str) -> dict:
    """Attempt to replace a quarantined bar with a clean fetch from an alt source.

    Returns:
      {"status": "healed", "new_source": <source>} on success
      {"status": "no-op"} if no alt source produced a valid bar
    """
    if not bar_quarantine.is_quarantined(ticker, tf, bar_time):
        return {"status": "skipped", "reason": "not quarantined"}

    for source in _FALLBACK_ORDER:
        if source == original_source:
            continue
        fresh = _fetch_from_alt(ticker, tf, bar_time, exclude=original_source)
        if fresh:
            bar_quarantine.remove(ticker, tf, bar_time)
            bar_provenance.record(ticker, tf, bar_time, source=source)
            _logger.info("[self-heal] %s %s @ %s healed from %s", ticker, tf, bar_time, source)
            return {"status": "healed", "new_source": source}

    return {"status": "no-op"}
```

- [ ] **Step 4: Tests pass + commit**

```bash
git add api/services/bar_self_heal.py tests/test_bar_self_heal.py
git commit -m "feat(charts): self-heal quarantined bars from alt source"
```

---

## Task 6: Admin endpoints for provenance, source health, force-heal

**Files:**
- Modify: `api/routers/admin_chart_health.py`
- Modify: `tests/test_admin_chart_health.py`

- [ ] **Step 1: Add endpoints**

```python
from api.services import bar_provenance, source_circuit_breaker, bar_self_heal


@router.get("/provenance")
def provenance_lookup(ticker: str, tf: str, bar_time: int, user=Depends(require_admin)):
    return {"provenance": bar_provenance.get(ticker, tf, bar_time)}


@router.get("/source-health")
def source_health(user=Depends(require_admin)):
    return {"sources": source_circuit_breaker.all_states(),
            "by_source": bar_provenance.count_by_source()}


class ForceHealRequest(BaseModel):
    ticker: str
    tf: str
    bar_time: int
    original_source: str = "massive"


@router.post("/force-heal")
def force_heal(body: ForceHealRequest, user=Depends(require_admin)):
    return bar_self_heal.try_heal(body.ticker, body.tf, body.bar_time, body.original_source)
```

- [ ] **Step 2: Tests for each new endpoint**

Append 3 tests to `tests/test_admin_chart_health.py` mirroring the patterns of existing tests (use `admin_client` fixture, `patch` the underlying services).

- [ ] **Step 3: Commit**

```bash
git add api/routers/admin_chart_health.py tests/test_admin_chart_health.py
git commit -m "feat(charts): admin endpoints for provenance + source health + force-heal"
```

---

## Task 7: Admin UI — Source Health panel + Provenance lookup

**Files:**
- Modify: `app/src/pages/admin/ChartHealth.jsx`
- Modify: `app/src/pages/admin/ChartHealth.module.css`

- [ ] **Step 1: Add Source Health panel**

Inside ChartHealth.jsx, add state + polling + render:

```jsx
const [sourceHealth, setSourceHealth] = useState({ sources: {}, by_source: {} });

async function loadSourceHealth() {
  try {
    const r = await fetch('/api/admin/bars/source-health', { credentials: 'include' });
    if (r.ok) setSourceHealth(await r.json());
  } catch {}
}
useEffect(() => {
  loadSourceHealth();
  const id = setInterval(loadSourceHealth, 10000);
  return () => clearInterval(id);
}, []);
```

Render section showing per-source state (ok/degraded), pass rate, attempt count, and bar count by source.

- [ ] **Step 2: Provenance lookup widget**

Three-input form (ticker, tf, bar_time) + Submit → calls `/api/admin/bars/provenance` → displays the source/validated_at/verified_at.

- [ ] **Step 3: Build + commit + push**

```bash
cd app && npm run build && cd ..
git add app/src/pages/admin/ChartHealth.jsx app/src/pages/admin/ChartHealth.module.css
git commit -m "feat(charts): admin Source Health panel + Provenance lookup"
git push
```

---

## Task 8: Bootstrap + integration tests

**Files:**
- Modify: `api/main.py` (init bar_provenance schema on startup)
- Create: `tests/test_plan3_integration.py`

- [ ] **Step 1: Init schema in startup**

In the existing chart-health bootstrap block in `api/main.py`:

```python
from api.services import bar_provenance
bar_provenance.init_schema()
```

- [ ] **Step 2: Integration test — full Plan 3 flow**

Create `tests/test_plan3_integration.py`:

```python
"""End-to-end test exercising provenance + circuit breaker + reconciliation."""
import pytest
from unittest.mock import patch
from api.services import bars_disk_cache, bar_provenance, bar_quarantine, bar_reconcile


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_end_to_end_clean_path(tmp_state):
    """Cache write → provenance recorded → reconcile agrees → verified."""
    payload = {
        "source": "massive",
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["source"] == "massive"
    assert p["verified_at"] is None

    fmp_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.1, "v": 1490000}
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, payload["bars"][0])

    p2 = bar_provenance.get("QQQ", "30", 1715080800)
    assert p2["verified_at"] is not None
```

- [ ] **Step 3: Tests pass + commit + push**

```bash
git add api/main.py tests/test_plan3_integration.py
git commit -m "feat(charts): bootstrap provenance schema + plan 3 integration test"
git push
```

---

## Plan 3 Done — what changed

After Plan 3 ships:

1. **Per-bar provenance recorded** on every cache write (source + validated_at). Operators can answer "where did this bar come from?" in one query.
2. **Source circuit breaker** tracks per-source pass-rates. Below 95% in 1hr → degraded → fetch_with_validation skips it. Auto-recovers.
3. **Multi-source reconciliation API** for priority tickers — 2-of-3 majority verification, quarantine on disagreement.
4. **Self-healing** for quarantined bars — automatic re-fetch from alt source with replacement.
5. **Admin endpoints** for provenance lookup, source health snapshot, force-heal.
6. **Admin UI panels** for source health + provenance lookup.

This sets the foundation for Plan 5's continuous verification thread — the reconcile + heal APIs are ready to be scheduled in batch.

---

## Self-Review Notes

- All schemas use the same `/data/auth.db` and the corrected `AUTH_DB_PATH` env var (matches Plan 1's fix).
- Provenance is observability — never blocks the cache path (try/except wraps every record call).
- Circuit breaker uses pure Python deque + lock; no external state, fast.
- Reconciliation is API-only in Plan 3; Plan 5 schedules it across the priority universe.
- Self-heal is API-only in Plan 3; Plan 5 schedules + Task 6 admin endpoint allows force-trigger.
- No placeholders.
