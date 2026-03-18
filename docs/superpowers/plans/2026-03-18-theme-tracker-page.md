# Theme Tracker Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-page Theme Tracker as a top-level nav item between Breadth and Traders, showing collapsible theme groups with per-stock multi-period returns (1D/1W/1M/3M/1Y/YTD) on the left and an inline TradingView chart on the right.

**Architecture:** A new `/theme-tracker` route renders `ThemeTrackerPage.jsx` — a two-panel layout (45% table / 55% chart). The backend fetches ~14 months of daily bars per holding from Massive agg API (parallel, `ThreadPoolExecutor`), computes all 6 return periods, and caches the result for 15 min. Source themes come from `wire_data` (daily engine push), with US holdings extracted from the existing `holdings` field.

**Tech Stack:** React + CSS Modules (frontend), FastAPI + Python (backend), Massive REST API (`/v2/aggs/`), TTLCache (in-memory, 15 min), useSWR (frontend polling), TradingView widget iframe (chart panel)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `api/services/massive.py` | Modify | Add `get_agg_bars(ticker, from_date, to_date)` public function |
| `api/services/theme_performance.py` | Create | Load themes from wire_data, fetch bars, compute returns, cache |
| `api/routers/theme_performance.py` | Create | `GET /api/theme-performance` endpoint |
| `api/main.py` | Modify | Register new router |
| `app/src/pages/ThemeTrackerPage.jsx` | Create | Full-page two-panel component |
| `app/src/pages/ThemeTrackerPage.module.css` | Create | Page styles |
| `app/src/components/NavBar.jsx` | Modify | Add nav item between Breadth and Traders |
| `app/src/App.jsx` | Modify | Add `/theme-tracker` route |
| `tests/test_theme_performance.py` | Create | Unit tests for return computation and service |

---

## Task 1: Add `get_agg_bars()` to Massive service

**Files:**
- Modify: `api/services/massive.py`

Add a public function that fetches daily OHLCV bars from the Massive agg endpoint for a single ticker. This is the building block for multi-period return computation.

- [ ] **Step 1: Write the failing test**

Create `tests/test_theme_performance.py`:

```python
# tests/test_theme_performance.py
import pytest
from unittest.mock import patch, MagicMock


# ── Task 1 tests ──────────────────────────────────────────────────────────────

def test_get_agg_bars_returns_results():
    """get_agg_bars returns a list of bar dicts on success."""
    mock_response = {
        "status": "OK",
        "results": [
            {"t": 1700000000000, "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100000},
            {"t": 1700086400000, "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.0, "v": 120000},
        ]
    }
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client = MagicMock()
        mock_client._get.return_value = mock_response
        mock_client_fn.return_value = mock_client

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert len(bars) == 2
    assert bars[0]["c"] == 10.5


def test_get_agg_bars_returns_empty_on_error():
    """get_agg_bars returns [] on any exception (graceful degradation)."""
    with patch("api.services.massive._get_client") as mock_client_fn:
        mock_client_fn.side_effect = RuntimeError("Massive unavailable")

        from api.services.massive import get_agg_bars
        bars = get_agg_bars("RKLB", "2025-01-01", "2026-03-18")

    assert bars == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-dashboard
pytest tests/test_theme_performance.py::test_get_agg_bars_returns_results tests/test_theme_performance.py::test_get_agg_bars_returns_empty_on_error -v
```

Expected: `FAILED` — `ImportError: cannot import name 'get_agg_bars'`

- [ ] **Step 3: Add `get_agg_bars()` to `api/services/massive.py`**

Add after the `get_etf_snapshots()` function (around line 234):

```python
def get_agg_bars(ticker: str, from_date: str, to_date: str) -> list[dict]:
    """Return daily OHLCV bars for a ticker from the Massive agg endpoint.

    Args:
        ticker:    Equity ticker symbol (e.g. "RKLB")
        from_date: Start date in "YYYY-MM-DD" format
        to_date:   End date in "YYYY-MM-DD" format

    Returns:
        List of bar dicts with keys: t (unix ms), o, h, l, c, v
        Empty list on any error or if ticker not found.
    """
    try:
        client = _get_client()
        url = (
            f"{_REST_BASE}/v2/aggs/ticker/{ticker.upper()}/range/1/day"
            f"/{from_date}/{to_date}"
            f"?adjusted=true&sort=asc&limit=400&apiKey={client._api_key}"
        )
        data = client._get(url)
        return data.get("results") or []
    except Exception:
        return []
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_theme_performance.py::test_get_agg_bars_returns_results tests/test_theme_performance.py::test_get_agg_bars_returns_empty_on_error -v
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add api/services/massive.py tests/test_theme_performance.py
git commit -m "feat: add get_agg_bars() to Massive service for historical OHLCV"
```

---

## Task 2: Create `theme_performance` service

**Files:**
- Create: `api/services/theme_performance.py`
- Modify: `tests/test_theme_performance.py`

Core backend logic: load themes from wire_data, collect all unique US holdings, fetch bars in parallel, compute returns, return structured response.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_theme_performance.py`:

```python
# ── Task 2 tests ──────────────────────────────────────────────────────────────

def test_compute_returns_all_periods():
    """_compute_returns returns correct values for all 6 periods."""
    from api.services.theme_performance import _compute_returns

    # Build fake bars: 300 daily bars, closing prices 1..300
    from datetime import datetime, timedelta
    import time

    base_ms = int(datetime(2025, 1, 2).timestamp() * 1000)
    day_ms = 86400 * 1000
    bars = [
        {"t": base_ms + i * day_ms, "c": float(i + 1)}
        for i in range(300)
    ]

    result = _compute_returns(bars)

    # Last close = 300, prev close = 299 → 1D ≈ +0.33%
    assert result["1d"] == pytest.approx((300 - 299) / 299 * 100, abs=0.01)
    # 5 sessions ago = bar[294] = close 295 → 1W ≈ +1.69%
    assert result["1w"] == pytest.approx((300 - 295) / 295 * 100, abs=0.01)
    # All periods are floats (not None)
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is not None


def test_compute_returns_handles_sparse_bars():
    """_compute_returns returns available periods when bars < full history."""
    from api.services.theme_performance import _compute_returns

    # Only 3 bars — can compute 1D, but not 1W/1M/etc (falls back to first bar)
    bars = [
        {"t": 1700000000000, "c": 100.0},
        {"t": 1700086400000, "c": 105.0},
        {"t": 1700172800000, "c": 110.0},
    ]
    result = _compute_returns(bars)
    assert result["1d"] == pytest.approx((110 - 105) / 105 * 100, abs=0.01)
    # When not enough bars, falls back to first bar close (100.0)
    assert result["1w"] == pytest.approx((110 - 100) / 100 * 100, abs=0.01)


def test_compute_returns_empty_bars():
    """_compute_returns returns all None for empty bar list."""
    from api.services.theme_performance import _compute_returns

    result = _compute_returns([])
    for key in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert result[key] is None


def test_build_theme_performance_shape():
    """get_theme_performance returns correct shape with mocked data."""
    MOCK_WIRE = {
        "themes": {
            "UFO": {
                "name": "Space",
                "etf_name": "Procure Space ETF",
                "holdings": [
                    {"sym": "RKLB", "name": "Rocket Lab", "pct": 8.5},
                    {"sym": "ASTS", "name": "AST SpaceMobile", "pct": 6.1},
                ],
                "intl_holdings": [],
                "1W": 5.2, "1M": 12.3, "3M": 30.1,
            }
        }
    }
    FAKE_BARS = [{"t": 1700000000000 + i * 86400000, "c": float(100 + i)} for i in range(300)]

    with patch("api.services.theme_performance._load_wire_data", return_value=MOCK_WIRE), \
         patch("api.services.theme_performance.get_agg_bars", return_value=FAKE_BARS), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None  # no cached value

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    assert "themes" in result
    assert len(result["themes"]) == 1
    theme = result["themes"][0]
    assert theme["name"] == "Space"
    assert theme["ticker"] == "UFO"
    assert len(theme["holdings"]) == 2
    holding = theme["holdings"][0]
    assert holding["sym"] == "RKLB"
    assert "returns" in holding
    for period in ("1d", "1w", "1m", "3m", "1y", "ytd"):
        assert period in holding["returns"]


def test_build_theme_performance_no_wire_data():
    """get_theme_performance returns empty themes when wire_data unavailable."""
    with patch("api.services.theme_performance._load_wire_data", return_value=None), \
         patch("api.services.theme_performance.cache") as mock_cache:
        mock_cache.get.return_value = None

        from api.services.theme_performance import get_theme_performance
        result = get_theme_performance()

    assert result["themes"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_theme_performance.py -k "compute_returns or build_theme" -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'api.services.theme_performance'`

- [ ] **Step 3: Create `api/services/theme_performance.py`**

```python
"""api/services/theme_performance.py

Loads themes from wire_data, fetches daily OHLCV bars from Massive for
each holding, computes 1D/1W/1M/3M/1Y/YTD returns, and returns a
structured themes-with-holdings response.

Cache TTL: 15 min (covers intraday refreshes without hammering Massive).
"""
from __future__ import annotations

import concurrent.futures
from datetime import date, datetime, timedelta
from typing import Optional

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars


_CACHE_KEY = "theme_performance"
_CACHE_TTL = 900  # 15 minutes
_MAX_WORKERS = 10
_BAR_DAYS = 420   # ~14 months of calendar days → ≥252 trading days for 1Y


def _compute_returns(bars: list[dict]) -> dict[str, Optional[float]]:
    """Compute 1D/1W/1M/3M/1Y/YTD % returns from a sorted list of daily bars.

    Each bar must have: t (unix ms), c (close price).
    Falls back to the first available bar when history is shorter than needed.
    Returns None for all periods when bars is empty.
    """
    null = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}
    if not bars:
        return null

    closes = [b["c"] for b in bars]
    cur = closes[-1]

    def pct(ref: Optional[float]) -> Optional[float]:
        if ref is None or ref == 0:
            return None
        return round((cur - ref) / ref * 100, 2)

    def close_at(n: int) -> float:
        """Close n sessions ago; falls back to earliest bar if history too short."""
        idx = -n
        if abs(idx) > len(closes):
            return closes[0]
        return closes[idx]

    # YTD: first bar whose timestamp falls in the current calendar year
    current_year = date.today().year
    ytd_close = None
    for b in bars:
        if datetime.utcfromtimestamp(b["t"] / 1000).year == current_year:
            ytd_close = b["c"]
            break
    if ytd_close is None:
        ytd_close = closes[0]

    return {
        "1d":  pct(close_at(2)),   # today vs yesterday
        "1w":  pct(close_at(6)),   # today vs 5 sessions ago
        "1m":  pct(close_at(23)),  # today vs 22 sessions ago
        "3m":  pct(close_at(67)),  # today vs 66 sessions ago
        "1y":  pct(close_at(253)), # today vs 252 sessions ago
        "ytd": pct(ytd_close),
    }


def _fetch_returns_for(ticker: str, from_date: str, to_date: str) -> dict:
    """Fetch bars and compute returns for a single ticker. Used in thread pool."""
    bars = get_agg_bars(ticker, from_date, to_date)
    return _compute_returns(bars)


def get_theme_performance() -> dict:
    """Return all themes with per-holding multi-period returns.

    Response shape:
    {
        "themes": [
            {
                "name": "Space",
                "ticker": "UFO",
                "etf_name": "Procure Space ETF",
                "holdings": [
                    {
                        "sym": "RKLB",
                        "name": "Rocket Lab",
                        "weight_pct": 8.5,
                        "returns": {"1d": 10.2, "1w": 14.0, "1m": 16.5,
                                    "3m": 27.8, "1y": 317.8, "ytd": 3.4}
                    },
                    ...
                ]
            },
            ...
        ],
        "generated_at": "2026-03-18T09:30:00"
    }
    """
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return cached

    wire = _load_wire_data()
    raw_themes = wire.get("themes", {}) if wire else {}

    if not raw_themes or not isinstance(raw_themes, dict):
        result = {"themes": [], "generated_at": datetime.utcnow().isoformat()}
        cache.set(_CACHE_KEY, result, ttl=60)  # retry sooner if no data
        return result

    today = date.today()
    from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    # Collect all unique US holdings across all themes
    all_syms: set[str] = set()
    for theme_data in raw_themes.values():
        if not isinstance(theme_data, dict):
            continue
        for h in theme_data.get("holdings", []):
            if isinstance(h, dict) and h.get("sym"):
                all_syms.add(h["sym"])

    # Fetch bars in parallel
    returns_map: dict[str, dict] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        future_to_sym = {
            executor.submit(_fetch_returns_for, sym, from_date, to_date): sym
            for sym in all_syms
        }
        for future in concurrent.futures.as_completed(future_to_sym):
            sym = future_to_sym[future]
            try:
                returns_map[sym] = future.result()
            except Exception:
                returns_map[sym] = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}

    # Build structured response — preserve wire_data theme order
    themes_out = []
    for etf_ticker, theme_data in raw_themes.items():
        if not isinstance(theme_data, dict):
            continue

        raw_holdings = theme_data.get("holdings", [])
        holdings_out = []
        for h in raw_holdings:
            if not isinstance(h, dict) or not h.get("sym"):
                continue
            sym = h["sym"]
            holdings_out.append({
                "sym": sym,
                "name": h.get("name", sym),
                "weight_pct": h.get("pct", 0.0),
                "returns": returns_map.get(sym, {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}),
            })

        themes_out.append({
            "name": theme_data.get("name", etf_ticker),
            "ticker": etf_ticker,
            "etf_name": theme_data.get("etf_name", ""),
            "holdings": holdings_out,
        })

    result = {
        "themes": themes_out,
        "generated_at": datetime.utcnow().isoformat(),
    }
    cache.set(_CACHE_KEY, result, ttl=_CACHE_TTL)
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_theme_performance.py -k "compute_returns or build_theme" -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add api/services/theme_performance.py tests/test_theme_performance.py
git commit -m "feat: add theme_performance service with multi-period return computation"
```

---

## Task 3: Create the router and register it

**Files:**
- Create: `api/routers/theme_performance.py`
- Modify: `api/main.py`

- [ ] **Step 1: Write the failing test**

First, add these two imports at the **top of `tests/test_theme_performance.py`** (before all other imports):

```python
from fastapi.testclient import TestClient
from api.main import app
```

Then append the test function to `tests/test_theme_performance.py`:

```python
# ── Task 3 tests ──────────────────────────────────────────────────────────────

def test_theme_performance_endpoint_returns_200():
    """GET /api/theme-performance returns 200 with correct shape."""
    MOCK_RESULT = {
        "themes": [{"name": "Space", "ticker": "UFO", "etf_name": "Procure Space ETF", "holdings": []}],
        "generated_at": "2026-03-18T09:00:00",
    }

    # Patch at the service level (not the router alias) so the mock is reliable
    # even when api.main is already cached in sys.modules from prior test imports.
    with patch("api.services.theme_performance.get_theme_performance", return_value=MOCK_RESULT):
        client = TestClient(app)
        resp = client.get("/api/theme-performance")

    assert resp.status_code == 200
    data = resp.json()
    assert "themes" in data
    assert "generated_at" in data
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_theme_performance.py::test_theme_performance_endpoint_returns_200 -v
```

Expected: `FAILED` — `ImportError: cannot import name 'theme_performance' from 'api.routers'`

- [ ] **Step 3: Create `api/routers/theme_performance.py`**

```python
"""api/routers/theme_performance.py

GET /api/theme-performance — returns all themes with per-holding
multi-period returns (1D/1W/1M/3M/1Y/YTD).
"""
from fastapi import APIRouter, HTTPException
import api.services.theme_performance as svc

router = APIRouter()


@router.get("/api/theme-performance")
def get_theme_performance():
    try:
        return svc.get_theme_performance()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
```

- [ ] **Step 4: Register router in `api/main.py`**

Add import near the other router imports (line ~11):
```python
from api.routers import theme_performance as theme_performance_router
```

Add `app.include_router()` call after `breadth_monitor_router` (around line 133):
```python
app.include_router(theme_performance_router.router)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_theme_performance.py::test_theme_performance_endpoint_returns_200 -v
```

Expected: `1 passed`

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
pytest tests/ -v --tb=short
```

Expected: all previously passing tests still pass

- [ ] **Step 7: Commit**

```bash
git add api/routers/theme_performance.py api/main.py tests/test_theme_performance.py
git commit -m "feat: add /api/theme-performance endpoint"
```

---

## Task 4: Frontend — `ThemeTrackerPage.jsx` + CSS

**Files:**
- Create: `app/src/pages/ThemeTrackerPage.jsx`
- Create: `app/src/pages/ThemeTrackerPage.module.css`

Two-panel layout. Left: scrollable theme table with collapsible groups and colored return columns. Right: TradingView iframe for the selected ticker.

- [ ] **Step 1: Create `app/src/pages/ThemeTrackerPage.module.css`**

```css
/* app/src/pages/ThemeTrackerPage.module.css */

/* ── Page shell ─────────────────────────────────────────────────────────── */
.page {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

/* ── Left panel — theme table ───────────────────────────────────────────── */
.leftPanel {
  width: 45%;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

/* Sticky column header */
.tableHeader {
  display: grid;
  grid-template-columns: 1fr repeat(6, 72px);
  padding: 8px 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.colLabel {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  text-transform: uppercase;
  text-align: right;
}

.colLabel:first-child {
  text-align: left;
}

/* Scrollable rows area */
.tableBody {
  overflow-y: auto;
  flex: 1;
}

/* ── Theme group row ────────────────────────────────────────────────────── */
.groupRow {
  display: grid;
  grid-template-columns: 1fr repeat(6, 72px);
  align-items: center;
  padding: 7px 12px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  user-select: none;
}

.groupRow:hover {
  background: var(--bg-hover);
}

.groupName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--ut-gold);
  text-transform: uppercase;
}

.groupCaret {
  font-size: 9px;
  color: var(--text-muted);
}

.groupCount {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  padding: 1px 5px;
}

/* ── Stock row ──────────────────────────────────────────────────────────── */
.stockRow {
  display: grid;
  grid-template-columns: 1fr repeat(6, 72px);
  align-items: center;
  padding: 5px 12px 5px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.1s;
}

.stockRow:hover {
  background: var(--bg-hover);
}

.stockRow.selected {
  background: rgba(201, 168, 76, 0.08);
  border-left: 2px solid var(--ut-gold);
  padding-left: 18px;
}

.stockName {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dotPos  { background: var(--gain, #4ade80); }
.dotNeg  { background: var(--loss, #f87171); }
.dotFlat { background: var(--text-muted); }

.sym {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text);
}

/* ── Return cell ────────────────────────────────────────────────────────── */
.ret {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}

.retPos   { color: var(--gain, #4ade80); }
.retNeg   { color: var(--loss, #f87171); }
.retFlat  { color: var(--text-muted); }

/* ── Loading / empty states ─────────────────────────────────────────────── */
.loading {
  padding: 40px 24px;
  text-align: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: var(--text-muted);
}

/* ── Right panel — chart ────────────────────────────────────────────────── */
.rightPanel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.chartHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.chartSym {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--ut-gold);
}

.chartName {
  font-size: 12px;
  color: var(--text-muted);
}

.chartFrame {
  flex: 1;
  border: none;
  min-height: 0;
}

.newsLabel {
  padding: 8px 16px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

/* ── Empty right panel ──────────────────────────────────────────────────── */
.chartEmpty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Create `app/src/pages/ThemeTrackerPage.jsx`**

```jsx
// app/src/pages/ThemeTrackerPage.jsx
import { useState } from 'react'
import useSWR from 'swr'
import styles from './ThemeTrackerPage.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

const PERIODS = ['1d', '1w', '1m', '3m', '1y', 'ytd']
const PERIOD_LABELS = { '1d': '1D', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', 'ytd': 'YTD' }

function fmtRet(val) {
  if (val === null || val === undefined) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function retClass(val, styles) {
  if (val === null || val === undefined) return styles.retFlat
  if (val > 0) return styles.retPos
  if (val < 0) return styles.retNeg
  return styles.retFlat
}

function dotClass(val, styles) {
  if (val === null || val === undefined) return styles.dotFlat
  if (val > 0) return styles.dotPos
  if (val < 0) return styles.dotNeg
  return styles.dotFlat
}

function ThemeGroup({ theme, selectedSym, onSelectSym }) {
  const [open, setOpen] = useState(true)

  return (
    <>
      <div className={styles.groupRow} onClick={() => setOpen(o => !o)}>
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        {PERIODS.map(p => (
          <span key={p} className={`${styles.ret} ${styles.retFlat}`} />
        ))}
      </div>

      {open && theme.holdings.map(h => {
        const ret1d = h.returns?.['1d']
        const isSelected = h.sym === selectedSym
        return (
          <div
            key={h.sym}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name)}
          >
            <span className={styles.stockName}>
              <span className={`${styles.dot} ${dotClass(ret1d, styles)}`} />
              <span className={styles.sym}>{h.sym}</span>
            </span>
            {PERIODS.map(p => (
              <span
                key={p}
                className={`${styles.ret} ${retClass(h.returns?.[p], styles)}`}
              >
                {fmtRet(h.returns?.[p])}
              </span>
            ))}
          </div>
        )
      })}
    </>
  )
}

export default function ThemeTrackerPage() {
  const { data, isLoading } = useSWR('/api/theme-performance', fetcher, {
    refreshInterval: 900_000, // 15 min — matches server cache TTL
  })

  const [selectedSym, setSelectedSym] = useState(null)
  const [selectedName, setSelectedName] = useState('')

  function handleSelect(sym, name) {
    setSelectedSym(sym)
    setSelectedName(name || sym)
  }

  const tvUrl = selectedSym
    ? `https://s.tradingview.com/widgetembed/?frameElementId=tv_theme&symbol=${selectedSym}&interval=D&theme=dark&style=1&locale=en&toolbar_bg=161b22&enable_publishing=false&hide_top_toolbar=false&save_image=false&hide_legend=false&hide_volume=false`
    : null

  return (
    <div className={styles.page}>
      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>
        <div className={styles.tableHeader}>
          <span className={styles.colLabel}>Theme</span>
          {PERIODS.map(p => (
            <span key={p} className={styles.colLabel}>{PERIOD_LABELS[p]}</span>
          ))}
        </div>

        <div className={styles.tableBody}>
          {isLoading && (
            <p className={styles.loading}>Loading theme data…</p>
          )}
          {!isLoading && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {data?.themes?.map(theme => (
            <ThemeGroup
              key={theme.ticker}
              theme={theme}
              selectedSym={selectedSym}
              onSelectSym={handleSelect}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={styles.rightPanel}>
        {selectedSym ? (
          <>
            <div className={styles.chartHeader}>
              <span className={styles.chartSym}>{selectedSym}</span>
              <span className={styles.chartName}>{selectedName}</span>
            </div>
            <iframe
              key={selectedSym}
              src={tvUrl}
              className={styles.chartFrame}
              title={`${selectedSym} chart`}
              allowFullScreen
            />
            <div className={styles.newsLabel}>News — {selectedSym}</div>
          </>
        ) : (
          <div className={styles.chartEmpty}>
            Select a ticker to view chart
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify the frontend renders (manual check)**

Start the backend and frontend dev servers:
```bash
# Terminal 1
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000

# Terminal 2
cd C:\Users\Patrick\uct-dashboard\app
npm run dev
```

Navigate to `http://localhost:5173/theme-tracker` — you'll get a 404 until Task 5 adds the route, but the component files should import without errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/ThemeTrackerPage.jsx app/src/pages/ThemeTrackerPage.module.css
git commit -m "feat: add ThemeTrackerPage component with two-panel layout"
```

---

## Task 5: Wire up nav and route

**Files:**
- Modify: `app/src/components/NavBar.jsx`
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Add nav item to `NavBar.jsx`**

In the `NAV_ITEMS` array, insert the new item between Breadth and Traders:

```js
// Before:
{ to: '/breadth',      label: 'Breadth',       icon: '📶' },
{ to: '/traders',      label: 'Traders',       icon: '👥' },

// After:
{ to: '/breadth',        label: 'Breadth',        icon: '📶' },
{ to: '/theme-tracker',  label: 'Theme Tracker',  icon: '🎯' },
{ to: '/traders',        label: 'Traders',        icon: '👥' },
```

- [ ] **Step 2: Add route to `App.jsx`**

Add import at the top with other page imports:
```js
import ThemeTrackerPage from './pages/ThemeTrackerPage'
```

Add route inside `<Route element={<Layout />}>` after the Breadth route:
```jsx
<Route path="/breadth" element={<Breadth />} />
<Route path="/theme-tracker" element={<ThemeTrackerPage />} />
<Route path="/traders" element={<Traders />} />
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:5173/theme-tracker`:
- Sidebar shows "Theme Tracker" between Breadth and Traders
- Page loads with two panels
- Left panel shows "Loading theme data…" while fetching (or "No theme data" if no wire_data)
- Clicking any ticker updates the right panel with a TradingView chart

- [ ] **Step 4: Commit**

```bash
git add app/src/components/NavBar.jsx app/src/App.jsx
git commit -m "feat: add Theme Tracker nav item and /theme-tracker route"
```

---

## Task 6: Run full test suite + final verification

- [ ] **Step 1: Run all tests**

```bash
cd C:\Users\Patrick\uct-dashboard
pytest tests/ -v --tb=short
```

Expected: all tests pass, including all 8 new tests in `test_theme_performance.py`

- [ ] **Step 2: Manually verify with engine data**

If wire_data has been pushed (run `python morning_wire_engine.py` in `morning-wire/` or check Railway cache), navigate to `/theme-tracker` and verify:
- Themes are grouped (Space, Defense, Energy, etc.)
- Each group is collapsible
- Stock rows show colored 1D/1W/1M/3M/1Y/YTD returns
- Clicking a stock loads its TradingView daily chart on the right
- "NEWS — {SYM}" label appears below the chart

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Theme Tracker page complete — nav, route, backend, frontend"
```
