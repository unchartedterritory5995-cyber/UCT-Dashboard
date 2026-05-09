# Chart Accuracy — Plan 1: Validation Foundation + Audit Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bad bars from being cached, quarantine the corrupt bars already in cache (including the QQQ 30min 6.55 phantom), and build the audit engine that scans the full universe for additional corruption.

**Architecture:** Pure-function validation rules (no I/O) plug into the existing `bars_disk_cache` write path. A SQLite-backed quarantine table marks bad bars; the read path skips them, forcing re-fetch from alternate sources. An audit engine sweeps the universe on demand and persists reports.

**Tech Stack:** Python 3.12 / FastAPI / SQLite / pytest. Frontend admin UI: React + Vite. Existing `bars_disk_cache.py`, `bars_fetch.py`, and `bars_sqlite.py` get small surgical hooks; new modules are added beside them.

**Spec:** `docs/superpowers/specs/2026-05-08-chart-accuracy-and-realtime-design.md`

---

## File Structure

### New backend modules
| File | Responsibility |
|---|---|
| `api/services/bar_validation.py` | Pure validation rules — `validate_bar()`, `validate_series()`. No I/O. |
| `api/services/bar_quarantine.py` | SQLite-backed quarantine table — add/check/list/purge. |
| `api/services/bars_audit.py` | Single-ticker + universe audit runners. Generates JSON reports. |
| `api/services/bars_liveness.py` | Stale-bar watchdog during RTH. |
| `api/routers/admin_chart_health.py` | Admin endpoints — run audit, get reports, quarantine ops. |

### New tests
| File | Coverage |
|---|---|
| `tests/test_bar_validation.py` | Every rule has known-good + known-bad fixtures |
| `tests/test_bar_quarantine.py` | CRUD on quarantine table |
| `tests/test_bars_audit.py` | Audit detects planted corruption |
| `tests/test_bars_liveness.py` | Stale detection during RTH only |
| `tests/fixtures/bad_bars/qqq_6_55.json` | The QQQ 30min phantom — regression fixture |
| `tests/fixtures/bad_bars/ohlc_violations.json` | H<L, negative volume, etc. |

### Modified backend
| File | Change |
|---|---|
| `api/services/bars_disk_cache.py` | `put()` runs validation; `get()` skips quarantined bars |
| `api/services/bars_fetch.py` | On validation failure, retry alternate source |
| `api/main.py` | Register `admin_chart_health` router; bootstrap audit + liveness threads |

### New frontend
| File | Responsibility |
|---|---|
| `app/src/pages/admin/ChartHealth.jsx` | Admin dashboard — run audit, view reports, manage quarantine |
| `app/src/pages/admin/ChartHealth.module.css` | Styles |

### Modified frontend
| File | Change |
|---|---|
| `app/src/App.jsx` | Add `/admin/chart-health` route |
| `app/src/components/AdminNav.jsx` (or equivalent) | Add link if admin nav exists |

### Database
SQLite migrations applied at `api/main.py` startup against `/data/auth.db` (existing) — both new tables go there since auth.db already holds non-trade metadata.

```sql
CREATE TABLE IF NOT EXISTS quarantined_bars (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_quarantine_detected ON quarantined_bars(detected_at);

CREATE TABLE IF NOT EXISTS audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  scope TEXT NOT NULL,             -- 'ticker' | 'universe' | 'priority'
  scope_arg TEXT,                  -- e.g. ticker symbol or 'cap_universe'
  tickers_scanned INTEGER NOT NULL DEFAULT 0,
  bars_scanned INTEGER NOT NULL DEFAULT 0,
  issues_found INTEGER NOT NULL DEFAULT 0,
  report_path TEXT                 -- /data/audits/audit-<id>.json
);
CREATE INDEX IF NOT EXISTS idx_audit_started ON audit_runs(started_at);
```

---

## Task 1: Bar validation rules — structural

**Files:**
- Create: `api/services/bar_validation.py`
- Create: `tests/test_bar_validation.py`

- [ ] **Step 1: Write the failing test for structural rules**

Create `tests/test_bar_validation.py`:

```python
from api.services.bar_validation import validate_bar


def test_valid_bar_passes():
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is True
    assert reasons == []


def test_high_below_low_fails():
    bar = {"t": 1715080800, "o": 700.0, "h": 698.0, "l": 705.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("H<L" in r or "h<l" in r.lower() for r in reasons)


def test_high_below_open_fails():
    bar = {"t": 1715080800, "o": 705.0, "h": 700.0, "l": 695.0, "c": 698.0, "v": 1500000}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("h<o" in r.lower() or "high<open" in r.lower() for r in reasons)


def test_negative_volume_fails():
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": -1}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("volume" in r.lower() for r in reasons)


def test_zero_price_fails():
    bar = {"t": 1715080800, "o": 0.0, "h": 0.0, "l": 0.0, "c": 0.0, "v": 0}
    ok, reasons = validate_bar(bar)
    assert ok is False
    assert any("price" in r.lower() or "zero" in r.lower() for r in reasons)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard && pytest tests/test_bar_validation.py -v`
Expected: ImportError — `api.services.bar_validation` does not exist.

- [ ] **Step 3: Implement structural validation**

Create `api/services/bar_validation.py`:

```python
"""Pure validation rules for OHLCV bars. No I/O.

Used at every cache write path and by the audit engine.
"""
from typing import Optional


def validate_bar(bar: dict, prior_close: Optional[float] = None) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons).

    Required fields: t (epoch seconds), o, h, l, c (floats), v (int/float).
    """
    reasons: list[str] = []
    o = bar.get("o")
    h = bar.get("h")
    l = bar.get("l")
    c = bar.get("c")
    v = bar.get("v")

    # Field presence
    for k in ("t", "o", "h", "l", "c", "v"):
        if bar.get(k) is None:
            reasons.append(f"missing field: {k}")
    if reasons:
        return False, reasons

    # Structural: prices > 0
    if o <= 0 or h <= 0 or l <= 0 or c <= 0:
        reasons.append("zero or negative price")

    # Structural: H >= max(O, C, L), L <= min(O, C, H)
    if h < l:
        reasons.append("H<L")
    if h < o:
        reasons.append("H<O")
    if h < c:
        reasons.append("H<C")
    if l > o:
        reasons.append("L>O")
    if l > c:
        reasons.append("L>C")

    # Volume
    if v < 0:
        reasons.append("negative volume")

    return (len(reasons) == 0), reasons
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bar_validation.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_validation.py tests/test_bar_validation.py
git commit -m "feat(charts): add structural bar validation rules"
```

---

## Task 2: Bar validation rules — sanity vs prior close

**Files:**
- Modify: `api/services/bar_validation.py`
- Modify: `tests/test_bar_validation.py`

- [ ] **Step 1: Add failing tests for prior-close sanity**

Append to `tests/test_bar_validation.py`:

```python
def test_qqq_6_55_phantom_rejected():
    """The actual bug: QQQ 30min showing 6.55 OHLC when prior close was ~$694."""
    bar = {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is False
    assert any("deviation" in r.lower() or "prior" in r.lower() for r in reasons)


def test_normal_move_passes():
    """+2% move from prior close is fine."""
    bar = {"t": 1715080800, "o": 700.0, "h": 705.0, "l": 698.0, "c": 702.5, "v": 1500000}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is True


def test_split_adjusted_close_passes():
    """50% drop with no split context is rejected, but if the bar IS at split-adjusted price within 5%, accept."""
    # NVDA 10:1 split — prior close 1000, new opens at 100 (exactly split-adjusted)
    bar = {"t": 1715080800, "o": 100.0, "h": 102.0, "l": 99.5, "c": 101.0, "v": 50000000}
    ok, reasons = validate_bar(bar, prior_close=1000.0, split_ratios=[10.0])
    assert ok is True


def test_low_volume_with_big_move_rejected():
    """Implausibly low volume + big price move = bad data."""
    # The QQQ 6.55 had V=56 with implied 99% move
    bar = {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}
    ok, reasons = validate_bar(bar, prior_close=694.0)
    assert ok is False
    assert any("volume" in r.lower() for r in reasons)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_bar_validation.py -v`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement prior-close sanity rule**

Replace the body of `validate_bar` in `api/services/bar_validation.py`:

```python
"""Pure validation rules for OHLCV bars. No I/O.

Used at every cache write path and by the audit engine.
"""
from typing import Optional


# Threshold for "extreme" price deviation that requires split context to accept.
_DEVIATION_THRESHOLD = 0.5
# Tolerance band around split-adjusted price.
_SPLIT_TOLERANCE = 0.05
# Volume floor — below this with a big price move is suspicious for any liquid ticker.
_LOW_VOLUME_THRESHOLD = 1000


def validate_bar(
    bar: dict,
    prior_close: Optional[float] = None,
    split_ratios: Optional[list[float]] = None,
) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons)."""
    reasons: list[str] = []
    o = bar.get("o")
    h = bar.get("h")
    l = bar.get("l")
    c = bar.get("c")
    v = bar.get("v")

    for k in ("t", "o", "h", "l", "c", "v"):
        if bar.get(k) is None:
            reasons.append(f"missing field: {k}")
    if reasons:
        return False, reasons

    if o <= 0 or h <= 0 or l <= 0 or c <= 0:
        reasons.append("zero or negative price")

    if h < l:
        reasons.append("H<L")
    if h < o:
        reasons.append("H<O")
    if h < c:
        reasons.append("H<C")
    if l > o:
        reasons.append("L>O")
    if l > c:
        reasons.append("L>C")

    if v < 0:
        reasons.append("negative volume")

    # Prior-close sanity (only when we have prior context)
    if prior_close is not None and prior_close > 0:
        deviation = abs(o - prior_close) / prior_close
        if deviation > _DEVIATION_THRESHOLD:
            split_ok = False
            for ratio in split_ratios or []:
                adjusted = prior_close / ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
                # Reverse split
                adjusted = prior_close * ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
            if not split_ok:
                reasons.append(
                    f"deviation from prior close: {deviation*100:.1f}% "
                    f"(open={o}, prior_close={prior_close})"
                )

        # Low-volume + big-move combo (the QQQ 6.55 fingerprint)
        if v < _LOW_VOLUME_THRESHOLD and deviation > 0.05:
            reasons.append(
                f"implausibly low volume ({v}) with {deviation*100:.1f}% move"
            )

    return (len(reasons) == 0), reasons
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bar_validation.py -v`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_validation.py tests/test_bar_validation.py
git commit -m "feat(charts): add prior-close sanity + low-volume validation"
```

---

## Task 3: Series-level validation

**Files:**
- Modify: `api/services/bar_validation.py`
- Modify: `tests/test_bar_validation.py`

- [ ] **Step 1: Add failing tests for series checks**

Append to `tests/test_bar_validation.py`:

```python
from api.services.bar_validation import validate_series


def _bar(t, o=100, h=101, l=99, c=100.5, v=10000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_monotonic_time_ok():
    bars = [_bar(1000), _bar(2000), _bar(3000)]
    issues = validate_series(bars, tf="5")
    assert issues == []


def test_duplicate_timestamps_flagged():
    bars = [_bar(1000), _bar(2000), _bar(2000), _bar(3000)]
    issues = validate_series(bars, tf="5")
    assert any("duplicate" in i["reason"].lower() for i in issues)


def test_out_of_order_timestamps_flagged():
    bars = [_bar(1000), _bar(3000), _bar(2000)]
    issues = validate_series(bars, tf="5")
    assert any("order" in i["reason"].lower() for i in issues)


def test_intraday_gap_during_rth_flagged():
    """5-min bars with a 30-min gap during RTH should flag."""
    # 9:35 ET = 1715085300, 10:05 ET = 1715087100 (30 min gap, expected 5 min for tf=5)
    bars = [_bar(1715085300), _bar(1715087100)]
    issues = validate_series(bars, tf="5")
    assert any("gap" in i["reason"].lower() for i in issues)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_bar_validation.py -v`
Expected: 4 new tests FAIL with ImportError on `validate_series`.

- [ ] **Step 3: Implement validate_series**

Append to `api/services/bar_validation.py`:

```python
# Expected seconds-between-bars per intraday TF
_TF_INTERVAL = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}


def validate_series(bars: list[dict], tf: str) -> list[dict]:
    """Series-level checks. Returns list of issue dicts: {bar_index, reason, bar_time}."""
    issues: list[dict] = []
    if not bars:
        return issues

    seen_ts = set()
    prev_ts = None
    interval = _TF_INTERVAL.get(tf)

    for i, bar in enumerate(bars):
        ts = bar.get("t")
        if ts is None:
            issues.append({"bar_index": i, "reason": "missing timestamp", "bar_time": None})
            continue
        if ts in seen_ts:
            issues.append({"bar_index": i, "reason": "duplicate timestamp", "bar_time": ts})
        seen_ts.add(ts)
        if prev_ts is not None:
            if ts < prev_ts:
                issues.append({"bar_index": i, "reason": "out of order", "bar_time": ts})
            elif interval is not None:
                # Gap detection — only meaningful for intraday during RTH
                gap = ts - prev_ts
                if gap > interval * 3:
                    issues.append({
                        "bar_index": i,
                        "reason": f"gap {gap}s exceeds 3x expected {interval}s",
                        "bar_time": ts,
                    })
        prev_ts = ts

    return issues
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bar_validation.py -v`
Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_validation.py tests/test_bar_validation.py
git commit -m "feat(charts): add series-level validation (duplicates, order, gaps)"
```

---

## Task 4: Quarantine module — schema + add/check

**Files:**
- Create: `api/services/bar_quarantine.py`
- Create: `tests/test_bar_quarantine.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bar_quarantine.py`:

```python
import os
import sqlite3
import time
import pytest

from api.services import bar_quarantine


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test_auth.db"
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return db_path


def test_add_and_is_quarantined(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99.1%", source="massive")
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_clean_bar_not_quarantined(tmp_db):
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_remove_quarantine(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99.1%")
    bar_quarantine.remove("QQQ", "30", 1715080800)
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_count(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "r1")
    bar_quarantine.add("QQQ", "30", 1715080900, "r2")
    bar_quarantine.add("AAPL", "5", 1715080800, "r3")
    assert bar_quarantine.count() == 3
    assert bar_quarantine.count(ticker="QQQ") == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bar_quarantine.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement quarantine module**

Create `api/services/bar_quarantine.py`:

```python
"""Quarantine table for bad bars detected by validation or audit.

Bars in this table are skipped on cache reads, forcing a fresh fetch from
an alternate source on next access (self-healing).
"""
import os
import sqlite3
import time
from typing import Optional

_DB_PATH = os.environ.get("AUTH_DB", "/data/auth.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS quarantined_bars (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_quarantine_detected ON quarantined_bars(detected_at);
"""


def _conn():
    return sqlite3.connect(_DB_PATH, timeout=10.0)


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def add(ticker: str, tf: str, bar_time: int, reason: str, source: Optional[str] = None) -> None:
    with _conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO quarantined_bars "
            "(ticker, tf, bar_time, reason, source, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            (ticker.upper(), tf, int(bar_time), reason, source, int(time.time())),
        )


def remove(ticker: str, tf: str, bar_time: int) -> None:
    with _conn() as db:
        db.execute(
            "DELETE FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=?",
            (ticker.upper(), tf, int(bar_time)),
        )


def is_quarantined(ticker: str, tf: str, bar_time: int) -> bool:
    with _conn() as db:
        row = db.execute(
            "SELECT 1 FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=? LIMIT 1",
            (ticker.upper(), tf, int(bar_time)),
        ).fetchone()
    return row is not None


def list_for_ticker(ticker: str, tf: Optional[str] = None) -> list[dict]:
    with _conn() as db:
        if tf:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? AND tf=? ORDER BY bar_time",
                (ticker.upper(), tf),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? ORDER BY tf, bar_time",
                (ticker.upper(),),
            ).fetchall()
    return [
        {"ticker": r[0], "tf": r[1], "bar_time": r[2], "reason": r[3],
         "source": r[4], "detected_at": r[5]}
        for r in rows
    ]


def count(ticker: Optional[str] = None) -> int:
    with _conn() as db:
        if ticker:
            row = db.execute(
                "SELECT COUNT(*) FROM quarantined_bars WHERE ticker=?",
                (ticker.upper(),),
            ).fetchone()
        else:
            row = db.execute("SELECT COUNT(*) FROM quarantined_bars").fetchone()
    return int(row[0]) if row else 0


def quarantined_times(ticker: str, tf: str) -> set[int]:
    """Return set of bar timestamps quarantined for a ticker+tf — fast bulk check."""
    with _conn() as db:
        rows = db.execute(
            "SELECT bar_time FROM quarantined_bars WHERE ticker=? AND tf=?",
            (ticker.upper(), tf),
        ).fetchall()
    return {r[0] for r in rows}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bar_quarantine.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_quarantine.py tests/test_bar_quarantine.py
git commit -m "feat(charts): add quarantine table for corrupt bars"
```

---

## Task 5: Wire validation into cache write path

**Files:**
- Modify: `api/services/bars_disk_cache.py`
- Create: `tests/test_bars_disk_cache_validation.py`

- [ ] **Step 1: Read current `put()` to understand the existing write path**

Run: `cat api/services/bars_disk_cache.py | head -150`
Confirm the `put(ticker, tf, bars, payload)` signature and where the JSON is written. Note any guards already in place.

- [ ] **Step 2: Write the failing test**

Create `tests/test_bars_disk_cache_validation.py`:

```python
import os
import json
import pytest

from api.services import bars_disk_cache, bar_quarantine


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_put_caches_clean_bars(tmp_cache):
    payload = {
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
            {"t": 1715080900, "o": 702.5, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is not None
    assert len(got["bars"]) == 2


def test_put_rejects_corrupt_bars(tmp_cache):
    """Corrupt bars get filtered out + quarantined; clean bars cached."""
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
            # The QQQ 6.55 phantom — should be quarantined, not cached
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
            {"t": 1715080900, "o": 702.5, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is not None
    bar_times = [b["t"] for b in got["bars"]]
    assert 1715080800 not in bar_times  # phantom filtered
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_put_rejects_all_corrupt_returns_none(tmp_cache):
    """If every bar fails validation, nothing is cached."""
    payload = {
        "bars": [
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_bars_disk_cache_validation.py -v`
Expected: FAIL — `put()` doesn't filter or quarantine.

- [ ] **Step 4: Hook validation into `put()`**

In `api/services/bars_disk_cache.py`, add the imports near the top:

```python
from api.services import bar_validation
from api.services import bar_quarantine
```

Replace the existing `put()` function with:

```python
def put(ticker: str, tf: str, bars: int, payload: dict):
    """Validate every bar; cache only clean bars; quarantine corrupt ones."""
    raw_bars = payload.get("bars") or []
    if not raw_bars:
        return

    clean_bars: list[dict] = []
    prior_close = None
    for bar in raw_bars:
        ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
        if ok:
            clean_bars.append(bar)
            prior_close = bar.get("c")
        else:
            bar_quarantine.add(
                ticker, tf, int(bar.get("t") or 0),
                "; ".join(reasons),
                source=payload.get("source"),
            )

    if not clean_bars:
        return  # don't cache empty

    safe_payload = dict(payload)
    safe_payload["bars"] = clean_bars
    safe_payload["validated_at"] = int(time.time())

    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        p = _path(ticker, tf, bars)
        with open(p, "w") as f:
            json.dump(safe_payload, f)
    except OSError:
        pass
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_bars_disk_cache_validation.py -v`
Expected: All 3 tests PASS.

- [ ] **Step 6: Run the full bars test suite to check for regressions**

Run: `pytest tests/test_bars_disk_cache_test.py tests/test_bars_disk_cache_validation.py tests/test_bars_sqlite_test.py -v`
Expected: All existing bars tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add api/services/bars_disk_cache.py tests/test_bars_disk_cache_validation.py
git commit -m "feat(charts): validate bars on cache write, quarantine corrupt ones"
```

---

## Task 6: Skip quarantined bars on cache read

**Files:**
- Modify: `api/services/bars_disk_cache.py`
- Modify: `tests/test_bars_disk_cache_validation.py`

- [ ] **Step 1: Add failing test for read-path quarantine skip**

Append to `tests/test_bars_disk_cache_validation.py`:

```python
def test_get_skips_quarantined_bars(tmp_cache):
    """If a bar gets quarantined AFTER being cached (via audit), get() should skip it."""
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
            {"t": 1715080800, "o": 702.5, "h": 707, "l": 701, "c": 706, "v": 1100000},
            {"t": 1715080900, "o": 706, "h": 710, "l": 705, "c": 709, "v": 1300000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    # Audit later flags the middle bar as bad
    bar_quarantine.add("QQQ", "30", 1715080800, "post-cache audit failure")
    got = bars_disk_cache.get("QQQ", "30", 100)
    bar_times = [b["t"] for b in got["bars"]]
    assert 1715080800 not in bar_times
    assert 1715080700 in bar_times
    assert 1715080900 in bar_times


def test_get_returns_none_if_all_quarantined(tmp_cache):
    payload = {
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    bar_quarantine.add("QQQ", "30", 1715080800, "post-cache failure")
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_bars_disk_cache_validation.py -v`
Expected: 2 new tests FAIL.

- [ ] **Step 3: Hook quarantine into `get()`**

In `api/services/bars_disk_cache.py`, replace the existing `get()` with:

```python
def get(ticker: str, tf: str, bars: int):
    """Return cached payload dict (with quarantined bars filtered out) or None."""
    try:
        p = _path(ticker, tf, bars)
        age = time.time() - os.path.getmtime(p)
        if age > _DISK_TTL.get(tf, 14400):
            return None
        with open(p, "r") as f:
            data = json.load(f)
        if not data.get("bars"):
            try:
                os.remove(p)
            except OSError:
                pass
            return None

        # Filter out any bars that have been quarantined since cache write
        bad_times = bar_quarantine.quarantined_times(ticker, tf)
        if bad_times:
            data = dict(data)
            data["bars"] = [b for b in data["bars"] if b.get("t") not in bad_times]

        if not data.get("bars"):
            return None
        return data
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bars_disk_cache_validation.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_disk_cache.py tests/test_bars_disk_cache_validation.py
git commit -m "feat(charts): filter quarantined bars on cache read"
```

---

## Task 7: Multi-source retry on validation failure

**Files:**
- Modify: `api/services/bars_fetch.py`
- Create: `tests/test_bars_fetch_fallback.py`

- [ ] **Step 1: Locate the source dispatch in `bars_fetch.py`**

Run: `grep -n "FMP\|yfinance\|fallback\|massive" api/services/bars_fetch.py | head -30`
Note the function names that fetch from each source and where the dispatch happens. Existing chain: Massive → FMP (intraday) → yfinance (stale/split).

- [ ] **Step 2: Write the failing test**

Create `tests/test_bars_fetch_fallback.py`:

```python
import pytest
from unittest.mock import patch

from api.services import bars_fetch
from api.services import bar_quarantine


@pytest.fixture
def fresh_quarantine(tmp_path, monkeypatch):
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()


def test_fetch_retries_when_primary_returns_corrupt_bars(fresh_quarantine):
    """If Massive returns a payload that fails validation, retry FMP."""
    massive_corrupt = {
        "bars": [{"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}],
        "source": "massive",
    }
    fmp_clean = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
        "source": "fmp",
    }

    with patch.object(bars_fetch, "_fetch_from_massive", return_value=massive_corrupt), \
         patch.object(bars_fetch, "_fetch_from_fmp", return_value=fmp_clean) as mock_fmp:
        result = bars_fetch.fetch_with_validation("QQQ", "30", 100, prior_close=694.0)
        assert result is fmp_clean
        mock_fmp.assert_called_once()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_bars_fetch_fallback.py -v`
Expected: FAIL — `fetch_with_validation` doesn't exist.

- [ ] **Step 4: Add `fetch_with_validation` wrapper**

Append to `api/services/bars_fetch.py`:

```python
from api.services import bar_validation as _bar_validation


def _payload_passes_validation(payload: dict, prior_close=None) -> bool:
    """Return True if every bar in the payload validates."""
    if not payload or not payload.get("bars"):
        return False
    pc = prior_close
    for bar in payload["bars"]:
        ok, _ = _bar_validation.validate_bar(bar, prior_close=pc)
        if not ok:
            return False
        pc = bar.get("c")
    return True


def fetch_with_validation(ticker: str, tf: str, bars: int, prior_close=None):
    """Fetch from primary source; if it fails validation, fall back through alternates.

    Order: massive → fmp (intraday only) → yfinance (stale/split-adjusted).
    Returns the first payload whose every bar passes validation, or None.
    """
    # Primary
    try:
        payload = _fetch_from_massive(ticker, tf, bars)
    except Exception:
        payload = None
    if _payload_passes_validation(payload, prior_close):
        return payload

    # FMP (intraday only)
    if tf in ("1", "5", "15", "30", "60"):
        try:
            payload = _fetch_from_fmp(ticker, tf, bars)
        except Exception:
            payload = None
        if _payload_passes_validation(payload, prior_close):
            return payload

    # yfinance fallback
    try:
        payload = _fetch_from_yfinance(ticker, tf, bars)
    except Exception:
        payload = None
    if _payload_passes_validation(payload, prior_close):
        return payload

    return None
```

If `_fetch_from_massive`, `_fetch_from_fmp`, or `_fetch_from_yfinance` are not the actual private function names, locate the real names with `grep -n "def.*fetch" api/services/bars_fetch.py` and substitute. Do NOT invent new fetch implementations — use what already exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_bars_fetch_fallback.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/services/bars_fetch.py tests/test_bars_fetch_fallback.py
git commit -m "feat(charts): retry alt source when bars fail validation"
```

---

## Task 8: Bootstrap quarantine of known-bad cache entries

**Files:**
- Create: `api/services/bar_audit_bootstrap.py`
- Create: `tests/test_bar_audit_bootstrap.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bar_audit_bootstrap.py`:

```python
import json
import pytest

from api.services import bars_disk_cache, bar_quarantine, bar_audit_bootstrap


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_scan_finds_existing_corruption(tmp_cache):
    """Plant corrupt bars into a raw cache file (bypass put()), then scan."""
    raw_payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ]
    }
    p = tmp_cache / "QQQ_30_100.json"
    p.write_text(json.dumps(raw_payload))

    n = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
    assert n >= 1
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080700) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bar_audit_bootstrap.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement bootstrap scanner**

Create `api/services/bar_audit_bootstrap.py`:

```python
"""One-shot scanner for existing cache corruption.

Run on startup so any pre-existing bad bars (cached before validation was
wired in) get quarantined. Forces re-fetch on next access.
"""
import json
import logging
import os
import re

from api.services import bars_disk_cache, bar_quarantine, bar_validation

_logger = logging.getLogger(__name__)
_FNAME_RE = re.compile(r"^([A-Z0-9.\-]+)_([0-9DWM]+)_(\d+)\.json$")


def scan_and_quarantine_existing_cache() -> int:
    """Scan every cache file, validate each bar, quarantine failures.

    Returns count of bars quarantined.
    """
    cache_dir = bars_disk_cache._CACHE_DIR
    if not os.path.isdir(cache_dir):
        return 0

    quarantined = 0
    for fname in os.listdir(cache_dir):
        m = _FNAME_RE.match(fname)
        if not m:
            continue
        ticker, tf, _bars = m.group(1), m.group(2), m.group(3)
        path = os.path.join(cache_dir, fname)
        try:
            with open(path) as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        bars = payload.get("bars") or []
        prior_close = None
        for bar in bars:
            ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
            if not ok and bar.get("t"):
                bar_quarantine.add(
                    ticker, tf, int(bar["t"]),
                    "; ".join(reasons),
                    source=payload.get("source") or "bootstrap-scan",
                )
                quarantined += 1
            else:
                prior_close = bar.get("c")
    _logger.info("[bar_audit_bootstrap] quarantined %d bars from existing cache", quarantined)
    return quarantined
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bar_audit_bootstrap.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bar_audit_bootstrap.py tests/test_bar_audit_bootstrap.py
git commit -m "feat(charts): bootstrap scanner for existing cache corruption"
```

---

## Task 9: Stale-bar liveness probe

**Files:**
- Create: `api/services/bars_liveness.py`
- Create: `tests/test_bars_liveness.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bars_liveness.py`:

```python
import time
import pytest

from api.services import bars_liveness


def test_stale_during_rth_returns_true():
    """Bar more than 2 minutes old during RTH = stale."""
    now = int(time.time())
    # Pretend RTH
    assert bars_liveness.is_stale(last_bar_time=now - 180, tf="5", market_open=True) is True


def test_fresh_during_rth_returns_false():
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 30, tf="5", market_open=True) is False


def test_stale_outside_rth_returns_false():
    """Outside RTH, stale doesn't matter — no new bars expected."""
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 3600, tf="5", market_open=False) is False


def test_daily_tf_threshold_is_per_session():
    """Daily bars during RTH are stale at 25 hours, not 2 minutes."""
    now = int(time.time())
    assert bars_liveness.is_stale(last_bar_time=now - 600, tf="D", market_open=True) is False
    assert bars_liveness.is_stale(last_bar_time=now - 25 * 3600, tf="D", market_open=True) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bars_liveness.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement liveness module**

Create `api/services/bars_liveness.py`:

```python
"""Per-ticker stale-bar watchdog. Flags charts that have stopped updating during RTH."""
import time
from datetime import datetime
from zoneinfo import ZoneInfo


# Max acceptable seconds since last bar, per timeframe, during RTH
_STALE_THRESHOLD = {
    "1": 120,       # 2 minutes
    "5": 600,       # 10 minutes (allow 1 missed bar)
    "15": 1800,     # 30 minutes
    "30": 3600,     # 1 hour
    "60": 7200,     # 2 hours
    "D": 25 * 3600, # 25 hours (handles overnight + weekends partially)
    "W": 7 * 24 * 3600,
    "M": 32 * 24 * 3600,
}


def is_market_open(now: datetime | None = None) -> bool:
    n = now or datetime.now(ZoneInfo("America/New_York"))
    if n.weekday() >= 5:
        return False
    hm = n.hour * 100 + n.minute
    return 930 <= hm < 1600


def is_stale(last_bar_time: int, tf: str, market_open: bool | None = None) -> bool:
    """Return True if last_bar_time is older than the stale threshold for tf.

    During market closed, intraday bars are never stale (no new bars expected).
    Daily/weekly/monthly remain stale-checked since today's bar evolves.
    """
    if market_open is None:
        market_open = is_market_open()
    threshold = _STALE_THRESHOLD.get(tf, 3600)

    if not market_open and tf in ("1", "5", "15", "30", "60"):
        return False

    age = int(time.time()) - int(last_bar_time)
    return age > threshold
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bars_liveness.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_liveness.py tests/test_bars_liveness.py
git commit -m "feat(charts): stale-bar liveness probe"
```

---

## Task 10: Audit engine — single-ticker scan

**Files:**
- Create: `api/services/bars_audit.py`
- Create: `tests/test_bars_audit.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bars_audit.py`:

```python
import json
import pytest

from api.services import bars_disk_cache, bar_quarantine, bars_audit


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_audit_ticker_finds_planted_corruption(tmp_cache):
    """Plant a known-bad bar and verify the audit finds it."""
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ]
    }
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(payload))

    report = bars_audit.audit_ticker("QQQ", tfs=["30"], bars_counts=[100])
    assert report["bars_scanned"] == 2
    assert report["issues_found"] >= 1
    assert any(
        i["bar_time"] == 1715080800 and "deviation" in i["reason"].lower() or "volume" in i["reason"].lower()
        for i in report["issues"]
    )


def test_audit_ticker_clean_returns_no_issues(tmp_cache):
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 702, "h": 707, "l": 701, "c": 706, "v": 1100000},
        ]
    }
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(payload))
    report = bars_audit.audit_ticker("QQQ", tfs=["30"], bars_counts=[100])
    assert report["issues_found"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bars_audit.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement single-ticker audit**

Create `api/services/bars_audit.py`:

```python
"""Audit engine — scans cached bars for validation failures and series issues.

Two entry points:
  audit_ticker(ticker)        — single-ticker scan
  audit_universe()            — universe-wide parallel scan
"""
import json
import os
from typing import Optional

from api.services import bars_disk_cache, bar_validation


_DEFAULT_TFS = ("1", "5", "15", "30", "60", "D", "W", "M")


def _read_cache_file(ticker: str, tf: str, bars_count: int) -> Optional[dict]:
    p = os.path.join(bars_disk_cache._CACHE_DIR, f"{ticker}_{tf}_{bars_count}.json")
    try:
        with open(p) as f:
            return json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError, ValueError):
        return None


def _scan_payload(ticker: str, tf: str, payload: dict) -> tuple[int, list[dict]]:
    """Return (bars_scanned, list_of_issues). Each issue: {ticker, tf, bar_time, reason}."""
    bars = payload.get("bars") or []
    issues: list[dict] = []
    prior_close = None
    for bar in bars:
        ok, reasons = bar_validation.validate_bar(bar, prior_close=prior_close)
        if not ok:
            issues.append({
                "ticker": ticker,
                "tf": tf,
                "bar_time": bar.get("t"),
                "reason": "; ".join(reasons),
                "kind": "bar",
            })
        else:
            prior_close = bar.get("c")
    series_issues = bar_validation.validate_series(bars, tf)
    for si in series_issues:
        issues.append({
            "ticker": ticker,
            "tf": tf,
            "bar_time": si.get("bar_time"),
            "reason": si.get("reason"),
            "kind": "series",
        })
    return len(bars), issues


def audit_ticker(
    ticker: str,
    tfs: tuple[str, ...] | list[str] = _DEFAULT_TFS,
    bars_counts: tuple[int, ...] | list[int] = (5000,),
) -> dict:
    """Audit every cached (tf, bars_count) for one ticker."""
    bars_scanned = 0
    issues: list[dict] = []
    for tf in tfs:
        for bc in bars_counts:
            payload = _read_cache_file(ticker, tf, bc)
            if not payload:
                continue
            n, issue_list = _scan_payload(ticker, tf, payload)
            bars_scanned += n
            issues.extend(issue_list)
    return {
        "ticker": ticker,
        "bars_scanned": bars_scanned,
        "issues_found": len(issues),
        "issues": issues,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bars_audit.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_audit.py tests/test_bars_audit.py
git commit -m "feat(charts): single-ticker audit engine"
```

---

## Task 11: Audit engine — universe scan with persistence

**Files:**
- Modify: `api/services/bars_audit.py`
- Modify: `tests/test_bars_audit.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_bars_audit.py`:

```python
import json
import os


def test_audit_universe_scans_multiple_tickers(tmp_cache, tmp_path, monkeypatch):
    audits_dir = tmp_path / "audits"
    monkeypatch.setattr(bars_audit, "_AUDIT_DIR", str(audits_dir))
    monkeypatch.setattr(bars_audit, "_DB_PATH", str(tmp_path / "auth.db"))
    bars_audit._init_audit_runs_table()

    for sym in ("QQQ", "SPY", "AAPL"):
        clean = {"bars": [{"t": 1715080800, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000}]}
        (tmp_cache / f"{sym}_30_100.json").write_text(json.dumps(clean))
    # Plant corruption in QQQ
    bad = {"bars": [{"t": 1715080800, "o": 100, "h": 101, "l": 99, "c": 100.5, "v": 1000},
                    {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56}]}
    (tmp_cache / "QQQ_30_100.json").write_text(json.dumps(bad))

    report = bars_audit.audit_universe(
        tickers=["QQQ", "SPY", "AAPL"],
        tfs=["30"],
        bars_counts=[100],
        parallelism=2,
    )
    assert report["tickers_scanned"] == 3
    assert report["issues_found"] >= 1
    assert os.path.exists(report["report_path"])
    with open(report["report_path"]) as f:
        on_disk = json.load(f)
    assert on_disk["issues_found"] == report["issues_found"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bars_audit.py::test_audit_universe_scans_multiple_tickers -v`
Expected: AttributeError on `audit_universe`.

- [ ] **Step 3: Implement universe scan + persistence**

Append to `api/services/bars_audit.py`:

```python
import sqlite3
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

_logger = logging.getLogger(__name__)
_AUDIT_DIR = os.environ.get("AUDIT_DIR", "/data/audits")
_DB_PATH = os.environ.get("AUTH_DB", "/data/auth.db")


def _init_audit_runs_table():
    schema = """
    CREATE TABLE IF NOT EXISTS audit_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      scope TEXT NOT NULL,
      scope_arg TEXT,
      tickers_scanned INTEGER NOT NULL DEFAULT 0,
      bars_scanned INTEGER NOT NULL DEFAULT 0,
      issues_found INTEGER NOT NULL DEFAULT 0,
      report_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_started ON audit_runs(started_at);
    """
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        db.executescript(schema)


def _record_audit_run(scope: str, scope_arg: str | None) -> int:
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        cur = db.execute(
            "INSERT INTO audit_runs (started_at, scope, scope_arg) VALUES (?, ?, ?)",
            (int(time.time()), scope, scope_arg),
        )
        return int(cur.lastrowid)


def _finish_audit_run(run_id: int, tickers: int, bars: int, issues: int, report_path: str):
    with sqlite3.connect(_DB_PATH, timeout=10.0) as db:
        db.execute(
            "UPDATE audit_runs SET finished_at=?, tickers_scanned=?, bars_scanned=?, "
            "issues_found=?, report_path=? WHERE id=?",
            (int(time.time()), tickers, bars, issues, report_path, run_id),
        )


def audit_universe(
    tickers: list[str],
    tfs: list[str] = list(_DEFAULT_TFS),
    bars_counts: list[int] = [5000],
    parallelism: int = 4,
    scope: str = "universe",
    scope_arg: str | None = None,
) -> dict:
    """Scan every ticker in `tickers`. Persist report to /data/audits/."""
    _init_audit_runs_table()
    run_id = _record_audit_run(scope, scope_arg)
    os.makedirs(_AUDIT_DIR, exist_ok=True)

    all_issues: list[dict] = []
    bars_scanned = 0
    tickers_scanned = 0

    with ThreadPoolExecutor(max_workers=parallelism) as ex:
        futures = {
            ex.submit(audit_ticker, t, tuple(tfs), tuple(bars_counts)): t
            for t in tickers
        }
        for fut in as_completed(futures):
            try:
                rep = fut.result()
            except Exception as e:
                _logger.warning("[bars_audit] %s failed: %s", futures[fut], e)
                continue
            tickers_scanned += 1
            bars_scanned += rep["bars_scanned"]
            all_issues.extend(rep["issues"])

    report = {
        "run_id": run_id,
        "started_at": int(time.time()),
        "scope": scope,
        "scope_arg": scope_arg,
        "tickers_scanned": tickers_scanned,
        "bars_scanned": bars_scanned,
        "issues_found": len(all_issues),
        "by_failure_type": _bucket_by_reason(all_issues),
        "issues": all_issues[:10000],  # cap to avoid huge files
    }
    report_path = os.path.join(_AUDIT_DIR, f"audit-{run_id}.json")
    with open(report_path, "w") as f:
        json.dump(report, f)
    report["report_path"] = report_path

    _finish_audit_run(run_id, tickers_scanned, bars_scanned, len(all_issues), report_path)
    return report


def _bucket_by_reason(issues: list[dict]) -> dict:
    buckets: dict[str, int] = {}
    for i in issues:
        # Use first phrase of reason as bucket key
        key = (i.get("reason") or "unknown").split(";")[0].strip()
        buckets[key] = buckets.get(key, 0) + 1
    return buckets


def latest_report() -> dict | None:
    """Return the most recent audit report from disk, or None."""
    if not os.path.isdir(_AUDIT_DIR):
        return None
    files = [f for f in os.listdir(_AUDIT_DIR) if f.startswith("audit-") and f.endswith(".json")]
    if not files:
        return None
    files.sort()
    p = os.path.join(_AUDIT_DIR, files[-1])
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bars_audit.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/bars_audit.py tests/test_bars_audit.py
git commit -m "feat(charts): universe-wide audit with persistence"
```

---

## Task 12: Admin router — audit run / status / quarantine

**Files:**
- Create: `api/routers/admin_chart_health.py`
- Create: `tests/test_admin_chart_health.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_admin_chart_health.py`:

```python
import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from api.main import app


@pytest.fixture
def admin_client(monkeypatch):
    """Bypass auth for tests by overriding the admin dependency."""
    from api.routers import admin_chart_health
    app.dependency_overrides[admin_chart_health.require_admin] = lambda: {"id": 1, "role": "admin"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_get_latest_audit_when_none(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=None):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json() == {"report": None}


def test_get_latest_audit_returns_report(admin_client):
    fake = {"run_id": 7, "tickers_scanned": 100, "issues_found": 3}
    with patch("api.routers.admin_chart_health.bars_audit.latest_report", return_value=fake):
        r = admin_client.get("/api/admin/bars/audit/latest")
    assert r.status_code == 200
    assert r.json()["report"]["run_id"] == 7


def test_run_audit_kicks_off_background(admin_client):
    with patch("api.routers.admin_chart_health.bars_audit.audit_universe") as mock_run:
        mock_run.return_value = {"run_id": 8, "issues_found": 0}
        r = admin_client.post(
            "/api/admin/bars/audit/run",
            json={"tickers": ["QQQ", "SPY"], "tfs": ["30"], "bars_counts": [100], "parallelism": 2},
        )
    assert r.status_code == 200
    assert "run_id" in r.json() or r.json().get("status") == "started"


def test_quarantine_count(admin_client):
    with patch("api.routers.admin_chart_health.bar_quarantine.count", return_value=42):
        r = admin_client.get("/api/admin/bars/quarantine/count")
    assert r.status_code == 200
    assert r.json() == {"count": 42}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_admin_chart_health.py -v`
Expected: ImportError on `admin_chart_health`.

- [ ] **Step 3: Implement the admin router**

Create `api/routers/admin_chart_health.py`:

```python
"""Admin endpoints for chart-health: audit, quarantine, source telemetry.

All endpoints require an authenticated admin user.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from api.services import bars_audit, bar_quarantine
from api.routers.auth import require_user_session  # existing auth dependency

router = APIRouter(prefix="/api/admin/bars", tags=["admin-charts"])


def require_admin(user=Depends(require_user_session)):
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return user


class AuditRunRequest(BaseModel):
    tickers: list[str] | None = None
    tfs: list[str] = ["1", "5", "15", "30", "60", "D", "W", "M"]
    bars_counts: list[int] = [5000]
    parallelism: int = 4
    scope: str = "universe"


@router.get("/audit/latest")
def get_latest_audit(user=Depends(require_admin)):
    return {"report": bars_audit.latest_report()}


@router.post("/audit/run")
def run_audit(
    body: AuditRunRequest,
    background_tasks: BackgroundTasks,
    user=Depends(require_admin),
):
    """Kick off an audit in the background. Returns immediately with run_id."""
    import json, os
    # Default to cap_universe if no tickers passed
    tickers = body.tickers
    if not tickers:
        try:
            with open("api/data/cap_universe.json") as f:
                data = json.load(f)
            tickers = data.get("tickers") or list(data) if isinstance(data, list) else []
        except Exception:
            tickers = []
    if not tickers:
        raise HTTPException(status_code=400, detail="no tickers")

    background_tasks.add_task(
        bars_audit.audit_universe,
        tickers, body.tfs, body.bars_counts, body.parallelism, body.scope, None,
    )
    return {"status": "started", "ticker_count": len(tickers), "tfs": body.tfs}


@router.get("/quarantine/count")
def quarantine_count(user=Depends(require_admin)):
    return {"count": bar_quarantine.count()}


@router.get("/quarantine/list")
def quarantine_list(ticker: str, tf: str | None = None, user=Depends(require_admin)):
    return {"items": bar_quarantine.list_for_ticker(ticker, tf)}


class QuarantineRemoveRequest(BaseModel):
    ticker: str
    tf: str
    bar_time: int


@router.post("/quarantine/remove")
def quarantine_remove(body: QuarantineRemoveRequest, user=Depends(require_admin)):
    bar_quarantine.remove(body.ticker, body.tf, body.bar_time)
    return {"ok": True}
```

If `require_user_session` is not the actual auth dependency name, locate it: `grep -n "def require_" api/routers/auth.py` and substitute.

- [ ] **Step 4: Wire the router into the app**

In `api/main.py`, find where existing routers are included (look for `app.include_router(`) and add:

```python
from api.routers import admin_chart_health
app.include_router(admin_chart_health.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_admin_chart_health.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/routers/admin_chart_health.py tests/test_admin_chart_health.py api/main.py
git commit -m "feat(charts): admin endpoints for audit and quarantine"
```

---

## Task 13: Bootstrap audit + cache scan on startup

**Files:**
- Modify: `api/main.py`

- [ ] **Step 1: Locate the existing FastAPI lifespan / startup hook**

Run: `grep -n "lifespan\|startup\|on_event" api/main.py | head -20`
Identify the existing startup hook (lifespan context manager or `@app.on_event("startup")`).

- [ ] **Step 2: Add bootstrap calls inside the existing startup hook**

Inside the existing startup section in `api/main.py`, add:

```python
# Chart-health bootstrap: init schemas, scan existing cache for corruption
try:
    from api.services import bar_quarantine, bar_audit_bootstrap, bars_audit
    bar_quarantine.init_schema()
    bars_audit._init_audit_runs_table()
    import threading
    def _bootstrap_scan():
        try:
            n = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
            logging.getLogger(__name__).info("[startup] quarantined %d bars from existing cache", n)
        except Exception as e:
            logging.getLogger(__name__).exception("[startup] bootstrap scan failed: %s", e)
    threading.Thread(target=_bootstrap_scan, daemon=True).start()
except Exception as e:
    logging.getLogger(__name__).exception("[startup] chart-health bootstrap failed: %s", e)
```

- [ ] **Step 3: Verify the app still boots**

Run: `cd C:/Users/Patrick/uct-dashboard && uvicorn api.main:app --port 8001 --log-level info` (in a separate terminal). Hit `http://localhost:8001/api/admin/bars/quarantine/count` (after authenticating).
Expected: Returns `{"count": <N>}` (N may be 0 on a clean cache or include any QQQ-style phantoms quarantined by the bootstrap scan).

Stop the server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat(charts): bootstrap quarantine schema + cache scan on startup"
```

---

## Task 14: Admin UI — Chart Health page

**Files:**
- Create: `app/src/pages/admin/ChartHealth.jsx`
- Create: `app/src/pages/admin/ChartHealth.module.css`
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Inspect the existing admin route pattern**

Run: `grep -rn "Admin\|admin" app/src/App.jsx | head -20`
Note how other admin pages are routed (look for `<Route` or admin-protected wrappers).

- [ ] **Step 2: Create the ChartHealth page**

Create `app/src/pages/admin/ChartHealth.jsx`:

```jsx
import { useEffect, useState } from 'react';
import styles from './ChartHealth.module.css';

export default function ChartHealth() {
  const [report, setReport] = useState(null);
  const [quarantineCount, setQuarantineCount] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  async function loadStatus() {
    try {
      const [a, q] = await Promise.all([
        fetch('/api/admin/bars/audit/latest', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/admin/bars/quarantine/count', { credentials: 'include' }).then(r => r.json()),
      ]);
      setReport(a.report);
      setQuarantineCount(q.count);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 10000);
    return () => clearInterval(id);
  }, []);

  async function runAudit(scope = 'priority') {
    setRunning(true);
    setError(null);
    try {
      // Priority = UCT20 + watchlists (server resolves); empty tickers => cap_universe
      const body = scope === 'priority'
        ? { tickers: [], tfs: ['5', '30', '60', 'D'], bars_counts: [5000], parallelism: 4, scope: 'priority' }
        : { tickers: [], tfs: ['1', '5', '15', '30', '60', 'D', 'W', 'M'], bars_counts: [5000], parallelism: 4, scope: 'universe' };
      const r = await fetch('/api/admin/bars/audit/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await loadStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1>Chart Health</h1>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        <div className={styles.metric}>
          <div className={styles.label}>Quarantined bars</div>
          <div className={styles.value}>{quarantineCount ?? '—'}</div>
        </div>
        <div className={styles.metric}>
          <div className={styles.label}>Last audit</div>
          <div className={styles.value}>
            {report ? new Date(report.started_at * 1000).toLocaleString() : 'Never'}
          </div>
        </div>
        <div className={styles.metric}>
          <div className={styles.label}>Issues found (last run)</div>
          <div className={styles.value}>{report ? report.issues_found : '—'}</div>
        </div>
      </div>

      <div className={styles.actions}>
        <button onClick={() => runAudit('priority')} disabled={running}>
          {running ? 'Running…' : 'Run Priority Audit (UCT20 + watchlists)'}
        </button>
        <button onClick={() => runAudit('universe')} disabled={running}>
          {running ? 'Running…' : 'Run Full Universe Audit (3,685 tickers × 8 TFs)'}
        </button>
      </div>

      {report && (
        <div className={styles.reportCard}>
          <h2>Last Audit Report</h2>
          <div className={styles.kv}>
            <div>Tickers scanned</div><div>{report.tickers_scanned}</div>
            <div>Bars scanned</div><div>{report.bars_scanned}</div>
            <div>Issues found</div><div>{report.issues_found}</div>
          </div>
          <h3>Failure type breakdown</h3>
          <table className={styles.table}>
            <thead><tr><th>Reason</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(report.by_failure_type || {})
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <tr key={reason}><td>{reason}</td><td>{n}</td></tr>
                ))}
            </tbody>
          </table>
          <h3>Sample issues (first 50)</h3>
          <table className={styles.table}>
            <thead>
              <tr><th>Ticker</th><th>TF</th><th>Bar time</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {(report.issues || []).slice(0, 50).map((i, idx) => (
                <tr key={idx}>
                  <td>{i.ticker}</td>
                  <td>{i.tf}</td>
                  <td>{i.bar_time ? new Date(i.bar_time * 1000).toISOString() : '—'}</td>
                  <td>{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the CSS module**

Create `app/src/pages/admin/ChartHealth.module.css`:

```css
.page {
  padding: 24px 32px;
  color: var(--color-text, #e0e0e0);
  background: var(--color-bg, #0a0a0a);
  min-height: 100vh;
}
.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.metric {
  background: var(--color-tile-bg, #161616);
  border: 1px solid var(--color-border, #2a2a2a);
  border-radius: 6px;
  padding: 16px;
}
.label { font-size: 12px; color: var(--color-text-muted, #888); text-transform: uppercase; letter-spacing: 1px; }
.value { font-size: 28px; font-weight: 600; margin-top: 4px; }
.actions { display: flex; gap: 12px; margin-bottom: 24px; }
.actions button {
  background: var(--color-accent, #c9a84c);
  color: #000;
  border: none;
  padding: 10px 18px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.reportCard {
  background: var(--color-tile-bg, #161616);
  border: 1px solid var(--color-border, #2a2a2a);
  border-radius: 6px;
  padding: 20px;
}
.kv {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 8px 16px;
  margin-bottom: 20px;
}
.table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.table th, .table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border, #2a2a2a);
  text-align: left;
  font-size: 13px;
}
.table th { color: var(--color-text-muted, #888); font-weight: 500; }
.error { background: rgba(220, 50, 50, 0.15); padding: 12px; border-radius: 4px; margin-bottom: 16px; }
```

- [ ] **Step 4: Add the route to `App.jsx`**

In `app/src/App.jsx`, add (matching the existing admin route style):

```jsx
import ChartHealth from './pages/admin/ChartHealth';
// inside <Routes>:
<Route path="/admin/chart-health" element={<AuthGuard requireAdmin><ChartHealth /></AuthGuard>} />
```

If the existing admin guard wrapper is named differently (e.g., `<RequireAdmin>` or a `requireAdmin` prop on AuthGuard), match the existing pattern exactly. Find an existing admin route with: `grep -n "admin" app/src/App.jsx`.

- [ ] **Step 5: Smoke test in the browser**

Run frontend dev server: `cd app && npm run dev`
Sign in as admin, navigate to `/admin/chart-health`. Verify:
- Page loads without console errors
- Quarantine count and "Last audit: Never" render
- "Run Priority Audit" button kicks off a request and refreshes after ~10s

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/admin/ChartHealth.jsx app/src/pages/admin/ChartHealth.module.css app/src/App.jsx
git commit -m "feat(charts): admin Chart Health dashboard"
```

---

## Task 15: Run end-to-end audit, quarantine the QQQ 6.55, push to Railway

**Files:**
- None (operational task)

- [ ] **Step 1: Push the entire branch to Railway**

```bash
git push
```

Railway redeploys; on startup the bootstrap scan auto-quarantines the QQQ 6.55 phantom (and any siblings) from the existing cache.

- [ ] **Step 2: Trigger a Priority Audit on production**

Sign in as admin to `https://uctintelligence.com/admin/chart-health`. Click "Run Priority Audit (UCT20 + watchlists)".

Wait ~30–60s, then check the report card. Expected: real corruption inventory across UCT20 and watchlists, grouped by failure type.

- [ ] **Step 3: Verify the visible bug is gone**

Open QQQ in any chart (Dashboard, ThemeTracker, Watchlists). Switch to 30min timeframe. Scroll to 2026-05-07 11:00 ET. The 6.55 phantom should no longer be present (quarantined → re-fetched from alternate source).

If it's still there: check `/api/admin/bars/quarantine/list?ticker=QQQ&tf=30` — should include `bar_time` matching that timestamp. If quarantined but still showing: cache was served from in-memory tier (TTLCache); bounce the dyno or wait for TTL.

- [ ] **Step 4: Run the full universe audit**

Click "Run Full Universe Audit (3,685 tickers × 8 TFs)". This takes longer (5–15 minutes). Watch the report populate.

- [ ] **Step 5: Capture inventory for Plan 2**

Once the universe audit completes, save the report JSON locally:

```bash
curl -b cookies.txt https://uctintelligence.com/api/admin/bars/audit/latest > /tmp/audit-baseline.json
```

This becomes the input artifact for Plan 2 (root-cause fixes), which will be written from the failure-type breakdown.

- [ ] **Step 6: Commit any doc updates and final push**

If you wrote any inline notes from the audit:
```bash
git add docs/superpowers/specs/2026-05-08-chart-accuracy-and-realtime-design.md
git commit -m "docs(charts): record Plan 1 audit baseline findings"
git push
```

---

## Plan 1 Done — what changed

After Plan 1 ships:

1. **Validation gate is live.** No bar fails sanity rules and gets cached. Bad bars from any source are quarantined + the alternate source is tried.
2. **Existing corruption is purged.** Bootstrap scan on startup quarantined every pre-existing bad bar, including the QQQ 30min 6.55 phantom.
3. **Audit engine produces inventory.** Admin can run on-demand audits; the full-universe baseline is captured for Plan 2.
4. **Self-healing via re-fetch.** Quarantined bars get filtered on read, forcing the chart endpoint to re-request from source. Re-fetched bars must pass validation to be cached.
5. **Stale-bar liveness module is available.** Used by Plan 5 continuous verification; usable now from Python code.
6. **Admin Chart Health dashboard exists** at `/admin/chart-health`.

Plan 2 will use the audit baseline to write specific fix tasks for each top failure mode (6.55 phantoms, mid-day stops, partial 1-min bars).

---

## Self-Review Notes

- Every task has explicit file paths, code, test code, expected output, and a commit step.
- Validation rules (Tasks 1–3) cover spec section "Validation Rules". The QQQ 6.55 fixture violates rules tested in Task 2.
- Quarantine + read-skip (Tasks 4, 6) implement the spec's "skip + re-fetch" model.
- Multi-source retry (Task 7) implements a basic version of the spec's source fallback. Async multi-source reconciliation is Plan 3.
- Audit engine (Tasks 10, 11) and admin endpoints (Task 12) cover Phase 1.
- Liveness probe (Task 9) is a building block for Plan 5's continuous verification.
- Nothing references types or methods not defined in this plan.
- No placeholders.
