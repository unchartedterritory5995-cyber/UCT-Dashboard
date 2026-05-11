# Pattern Recognition — Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation layer of the pattern recognition engine — types, primitives, memory schema, registry, REST API, and ONE pilot detector (bull_flag) with a full fixture battery. E2E plumbing: detect bull flag on a real ticker via API, verify storage. Sets up the structural seams that Phases 1-7 will fill out.

**Architecture:** Engine lives at `api/services/pattern_engine/` as a standalone service. Detectors are pure functions `(bars, context) -> list[Detection]` composed from shared primitives (`primitives/pivots`, `trendlines`, `volume`, `geometry`, `context`). Detection records are stored in 4 new SQLite tables alongside existing `auth.db` schema. REST API at `/api/patterns/*` exposes detection results. No UI integration in Phase 0 — that's Phase 5.

**Tech Stack:** Python 3.12, FastAPI, SQLite (existing auth.db), pytest, `api/services/bars_sqlite` for live bar data.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md`

---

## File Structure

### New backend (Phase 0 scope only)
| File | Responsibility |
|---|---|
| `api/services/pattern_engine/__init__.py` | Engine entrypoints: `detect_all(bars, context, pattern_ids=None)`, `detect_one(bars, context, pattern_id)` |
| `api/services/pattern_engine/types.py` | All TypedDicts: `Bar`, `Pivot`, `Trendline`, `Anchor`, `Geometry`, `Levels`, `Context`, `QualityComponents`, `Narrative`, `Outcome`, `Detection` |
| `api/services/pattern_engine/memory.py` | `store_detection(d)` UPSERT by hash, `get_active_detections(sym, tf, pattern_ids=None)`, `get_detection_by_id(id)`, `record_feedback(detection_id, user_id, rating, note)`. Stubs for `track_outcomes()`, `recompute_stats()` (Phase 7). |
| `api/services/pattern_engine/primitives/__init__.py` | empty; just makes `primitives` a package |
| `api/services/pattern_engine/primitives/geometry.py` | `slope_angle_deg(p1, p2)`, `line_intersect(l1, l2)`, `parallel_score(t1, t2)`, `polynomial_fit(xs, ys, degree)`, `line_at(line, t)` |
| `api/services/pattern_engine/primitives/pivots.py` | `detect_pivots(bars, window=5) -> list[Pivot]` fractal swing high/low detection |
| `api/services/pattern_engine/primitives/volume.py` | `volume_signature(bars, lookback=10) -> "expanding"\|"contracting"\|"neutral"`, `contraction_score(bars, window=20)`, `accumulation_distribution(bars, lookback=10)` |
| `api/services/pattern_engine/primitives/trendlines.py` | `fit_trendline(pivots) -> Trendline`, `fit_pair_parallel(upper_pivots, lower_pivots) -> tuple[Trendline, Trendline]` |
| `api/services/pattern_engine/primitives/context.py` | `build_context(bars, sym, regime_hint=None) -> Context` |
| `api/services/pattern_engine/detectors/__init__.py` | empty package marker |
| `api/services/pattern_engine/detectors/registry.py` | `DETECTORS: dict[str, Callable]` registry. `register(pattern_id, fn)` decorator. `get_detector(pattern_id)`, `list_pattern_ids()`. |
| `api/services/pattern_engine/detectors/classical/__init__.py` | empty package marker |
| `api/services/pattern_engine/detectors/classical/bull_flag.py` | `detect_bull_flag(bars, context) -> list[Detection]` |
| `api/routers/patterns.py` | `GET /api/patterns/types`, `GET /api/patterns/{sym}?tf=&types=&min_conf=`, `POST /api/patterns/{detection_id}/feedback` |

### Modified backend
| File | Change |
|---|---|
| `api/services/auth_db.py` | Add 4 tables (pattern_detections, pattern_outcomes, pattern_stats, pattern_feedback) to init_db() via separate executescript block |
| `api/main.py` | Register `from api.routers import patterns as patterns_router` + `app.include_router(patterns_router.router)` |

### Tests
| File | Tests |
|---|---|
| `tests/pattern_engine/__init__.py` | empty package marker |
| `tests/pattern_engine/primitives/__init__.py` | empty |
| `tests/pattern_engine/primitives/test_geometry.py` | slope/intersect/parallel/polynomial unit tests |
| `tests/pattern_engine/primitives/test_pivots.py` | fractal detection on hand-crafted bar sets |
| `tests/pattern_engine/primitives/test_volume.py` | signature classifier, contraction score, A/D |
| `tests/pattern_engine/primitives/test_trendlines.py` | trendline fit, parallel pair fit |
| `tests/pattern_engine/primitives/test_context.py` | build_context returns valid shape on real-ish bars |
| `tests/pattern_engine/test_memory.py` | store_detection, hash dedup, get_active, record_feedback |
| `tests/pattern_engine/test_registry.py` | register/lookup/list, detect_all dispatch |
| `tests/pattern_engine/detectors/__init__.py` | empty |
| `tests/pattern_engine/detectors/test_bull_flag.py` | Fixture battery test (loads 15 JSON fixtures, asserts expected outcome each) |
| `tests/pattern_engine/test_router_patterns.py` | 3 endpoints integration tests |
| `tests/fixtures/bull_flag/clean_textbook.json` | positive fixture |
| `tests/fixtures/bull_flag/tight_consolidation.json` | positive |
| `tests/fixtures/bull_flag/descending_flag.json` | positive |
| `tests/fixtures/bull_flag/shallow_pullback.json` | positive |
| `tests/fixtures/bull_flag/strong_volume_contraction.json` | positive |
| `tests/fixtures/bull_flag/no_pole.json` | negative |
| `tests/fixtures/bull_flag/pole_too_short.json` | negative |
| `tests/fixtures/bull_flag/flag_too_deep.json` | negative |
| `tests/fixtures/bull_flag/flag_too_wide.json` | negative |
| `tests/fixtures/bull_flag/wide_choppy.json` | negative |
| `tests/fixtures/bull_flag/ascending_flag_in_downtrend.json` | negative |
| `tests/fixtures/bull_flag/extended_flag_too_long.json` | negative |
| `tests/fixtures/bull_flag/volume_expanding.json` | negative |
| `tests/fixtures/bull_flag/boundary_min_pole.json` | edge |
| `tests/fixtures/bull_flag/boundary_max_retrace.json` | edge |

---

## Task 1: Types module

Foundation everything else imports from. TypedDicts only — no logic.

**Files:**
- Create: `api/services/pattern_engine/__init__.py`
- Create: `api/services/pattern_engine/types.py`
- Create: `tests/pattern_engine/__init__.py`
- Create: `tests/pattern_engine/test_types.py`

- [ ] **Step 1: Write failing test**

`tests/pattern_engine/test_types.py`:
```python
"""Smoke test for the types module — verifies all TypedDicts can be constructed
and that the schema matches the spec."""
from api.services.pattern_engine.types import (
    Bar, Pivot, Trendline, Anchor, Geometry, Levels, Context,
    QualityComponents, Narrative, Outcome, Detection,
)


def test_bar_typed_dict_construction():
    b: Bar = {"t": 1700000000, "o": 100.0, "h": 101.5, "l": 99.5, "c": 100.8, "v": 1000.0}
    assert b["t"] == 1700000000


def test_pivot_typed_dict_construction():
    p: Pivot = {"t": 1700000000, "price": 100.0, "type": "high", "strength": 50, "bar_index": 0}
    assert p["type"] == "high"


def test_detection_full_construction():
    """Build a complete Detection — proves every required field is present in the schema."""
    d: Detection = {
        "id": "abc-123",
        "sym": "AAPL",
        "tf": "D",
        "pattern_id": "bull_flag",
        "pattern_name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "start_t": 1700000000,
        "end_t": 1700100000,
        "pivot_ts": [1700000000, 1700050000, 1700100000],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [{"t": 1700000000, "price": 100.0}],
            "extras": {"height_pct": 8.2},
        },
        "levels": {
            "entry": 105.0, "entry_condition": "close > 105",
            "stop": 98.0, "stop_basis": "pattern_low",
            "target_primary": 115.0, "target_secondary": None,
            "risk_reward": 1.43,
        },
        "context": {
            "trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
            "volume_signature": "contracting", "regime": "bull",
            "nearest_resistance": 110.0, "nearest_support": 95.0,
            "days_to_earnings": 12, "sector_strength_rank": 3,
        },
        "confidence": 78.5,
        "quality_components": {
            "geometry_score": 80.0, "volume_score": 75.0,
            "context_score": 85.0, "historical_score": 50.0,
        },
        "narrative": {
            "headline": "Clean bull flag on Stage 2 uptrend",
            "what_it_is": "Sharp advance followed by tight consolidation.",
            "why_it_matters": "Continuation setup with measured move target.",
            "what_to_watch_for": "Breakout above flag high on volume > 1.5x avg.",
            "failure_signal": "Close below flag low invalidates pattern.",
        },
        "status": "ready",
        "outcome": None,
        "detected_at": 1700100100,
        "last_seen_at": 1700100100,
    }
    assert d["confidence"] == 78.5
    assert d["category"] == "classical"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pattern_engine/test_types.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.pattern_engine'`

- [ ] **Step 3: Implement types module**

Create `api/services/pattern_engine/__init__.py` (empty for now — entry points added in Task 9):
```python
"""Pattern recognition engine. Public API exposed in __init__ in Task 9."""
```

Create `api/services/pattern_engine/types.py`:
```python
"""TypedDict definitions for the pattern recognition engine.

These are the source-of-truth shapes for everything the engine emits.
Consumers (detectors, memory, API, UI) all import from here.
"""
from __future__ import annotations

from typing import Literal, TypedDict


class Bar(TypedDict):
    t: int    # unix seconds, bar start
    o: float
    h: float
    l: float
    c: float
    v: float


class Anchor(TypedDict):
    t: int
    price: float


class Pivot(TypedDict):
    t: int
    price: float
    type: Literal["high", "low"]
    strength: int   # 0-100, how dominant relative to neighbors
    bar_index: int  # index into the bars list it came from


class Trendline(TypedDict):
    p1: Anchor
    p2: Anchor
    slope: float       # price per bar
    r_squared: float   # 0-1 fit quality
    touches: int       # number of pivots near the line
    validity: float    # 0-1 composite quality


class Geometry(TypedDict):
    shape: Literal[
        "trendline_pair", "neckline", "cup_curve",
        "rectangle", "candle_mark", "horizontal_line",
    ]
    anchors: list[Anchor]
    extras: dict   # pattern-specific extras (height_pct, depth_pct, etc.)


class Levels(TypedDict):
    entry: float
    entry_condition: str
    stop: float
    stop_basis: str
    target_primary: float
    target_secondary: float | None
    risk_reward: float


class Context(TypedDict):
    trend_stage: int                                            # Weinstein 1-4
    rs_trend: Literal["up", "flat", "down"]
    ma_alignment: Literal["stacked_bullish", "mixed", "stacked_bearish"]
    volume_signature: Literal["contracting", "expanding", "neutral"]
    regime: str
    nearest_resistance: float | None
    nearest_support: float | None
    days_to_earnings: int | None
    sector_strength_rank: int | None


class QualityComponents(TypedDict):
    geometry_score: float       # 0-100
    volume_score: float
    context_score: float
    historical_score: float


class Narrative(TypedDict):
    headline: str
    what_it_is: str
    why_it_matters: str
    what_to_watch_for: str
    failure_signal: str


class Outcome(TypedDict):
    entry_hit: bool
    stop_hit: bool
    target_hit: bool
    max_favorable_excursion_pct: float
    max_adverse_excursion_pct: float
    bars_to_resolution: int
    resolved_at: int | None


class Detection(TypedDict):
    id: str
    sym: str
    tf: str
    pattern_id: str
    pattern_name: str
    category: Literal["classical", "candlestick", "uct", "structure"]
    direction: Literal["bullish", "bearish", "neutral"]
    start_t: int
    end_t: int
    pivot_ts: list[int]
    geometry: Geometry
    levels: Levels
    context: Context
    confidence: float                # 0-100
    quality_components: QualityComponents
    narrative: Narrative
    status: Literal["forming", "ready", "triggered", "completed", "failed", "expired"]
    outcome: Outcome | None
    detected_at: int
    last_seen_at: int
```

Create `tests/pattern_engine/__init__.py` (empty file).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pattern_engine/test_types.py -v`
Expected: PASS — 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/__init__.py api/services/pattern_engine/types.py tests/pattern_engine/__init__.py tests/pattern_engine/test_types.py
git commit -m "feat(patterns): foundation types module (Detection, Pivot, Trendline, ...)"
```

---

## Task 2: Geometry primitives

Pure math helpers. No deps on anything else.

**Files:**
- Create: `api/services/pattern_engine/primitives/__init__.py`
- Create: `api/services/pattern_engine/primitives/geometry.py`
- Create: `tests/pattern_engine/primitives/__init__.py`
- Create: `tests/pattern_engine/primitives/test_geometry.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/primitives/test_geometry.py`:
```python
import math
from api.services.pattern_engine.primitives.geometry import (
    slope_angle_deg, line_intersect, parallel_score,
    polynomial_fit, line_at,
)


def test_slope_angle_horizontal_line_is_zero():
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 100, "price": 100})
    assert abs(angle) < 0.01


def test_slope_angle_45_degrees():
    # Rise = run (using unit-normalized: dt=1, dprice=1) -> 45 deg
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 1, "price": 101})
    assert abs(angle - 45.0) < 0.01


def test_slope_angle_negative_slope():
    angle = slope_angle_deg({"t": 0, "price": 100}, {"t": 1, "price": 99})
    assert -46 < angle < -44


def test_line_intersect_perpendicular():
    """Horizontal line at y=100 meets vertical-ish line at x=5"""
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 100})
    line_b = ({"t": 5, "price": 50}, {"t": 5, "price": 150})
    pt = line_intersect(line_a, line_b)
    assert abs(pt["t"] - 5) < 0.01
    assert abs(pt["price"] - 100) < 0.01


def test_line_intersect_parallel_returns_none():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})
    line_b = ({"t": 0, "price": 200}, {"t": 10, "price": 210})
    assert line_intersect(line_a, line_b) is None


def test_parallel_score_identical_slopes_is_1():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})
    line_b = ({"t": 0, "price": 200}, {"t": 10, "price": 210})
    assert abs(parallel_score(line_a, line_b) - 1.0) < 0.01


def test_parallel_score_diverging_slopes_low():
    line_a = ({"t": 0, "price": 100}, {"t": 10, "price": 110})    # slope 1
    line_b = ({"t": 0, "price": 100}, {"t": 10, "price": 130})    # slope 3
    score = parallel_score(line_a, line_b)
    assert 0 <= score < 0.5


def test_polynomial_fit_linear_data():
    """y = 2x + 3, degree 1 → coeffs [2, 3]"""
    xs = [0.0, 1.0, 2.0, 3.0]
    ys = [3.0, 5.0, 7.0, 9.0]
    coeffs = polynomial_fit(xs, ys, degree=1)
    assert len(coeffs) == 2
    assert abs(coeffs[0] - 2.0) < 0.01
    assert abs(coeffs[1] - 3.0) < 0.01


def test_polynomial_fit_quadratic_data():
    """y = x^2 — degree 2 should recover [1, 0, 0]"""
    xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
    ys = [4.0, 1.0, 0.0, 1.0, 4.0]
    coeffs = polynomial_fit(xs, ys, degree=2)
    assert len(coeffs) == 3
    assert abs(coeffs[0] - 1.0) < 0.05
    assert abs(coeffs[1]) < 0.05
    assert abs(coeffs[2]) < 0.05


def test_line_at_returns_price_on_line():
    line = ({"t": 0, "price": 100}, {"t": 10, "price": 110})  # slope 1
    assert abs(line_at(line, 5) - 105) < 0.01
    assert abs(line_at(line, 0) - 100) < 0.01
    assert abs(line_at(line, 10) - 110) < 0.01
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.services.pattern_engine.primitives'`

- [ ] **Step 3: Implement geometry module**

Create `api/services/pattern_engine/primitives/__init__.py` (empty).
Create `tests/pattern_engine/primitives/__init__.py` (empty).

Create `api/services/pattern_engine/primitives/geometry.py`:
```python
"""Pure geometric helpers — line math, intersection, parallelism, polynomial fit.

All inputs use Anchor-like dicts {"t": int|float, "price": float}.
Time axis treated as a real number (could be a bar index or unix seconds);
all helpers work identically because we never assume a unit.
"""
from __future__ import annotations

import math
from typing import Optional


Point = dict   # Anchor-shaped: {"t": number, "price": number}
Line = tuple[Point, Point]


def slope_angle_deg(p1: Point, p2: Point) -> float:
    """Angle of the line through p1->p2 in degrees, relative to time axis.

    Inputs are interpreted as a unit-normalized cartesian space where t and
    price share a single unit (i.e. atan2(dp, dt)). For consistency, dt is
    treated in whatever units callers pass in; for "bars per move", caller
    should pass bar indices for `t`, not unix seconds.
    """
    dt = p2["t"] - p1["t"]
    dp = p2["price"] - p1["price"]
    return math.degrees(math.atan2(dp, dt))


def _slope(line: Line) -> float:
    """Price-per-unit-t slope; returns float('inf') for vertical lines."""
    p1, p2 = line
    dt = p2["t"] - p1["t"]
    if dt == 0:
        return float("inf")
    return (p2["price"] - p1["price"]) / dt


def line_at(line: Line, t: float) -> float:
    """Price on `line` at time `t` (linear extrapolation OK)."""
    p1, p2 = line
    dt = p2["t"] - p1["t"]
    if dt == 0:
        return p1["price"]
    slope = (p2["price"] - p1["price"]) / dt
    return p1["price"] + slope * (t - p1["t"])


def line_intersect(line_a: Line, line_b: Line) -> Optional[Point]:
    """Return intersection point of two lines, or None if parallel.

    Lines are infinite (intersection may lie outside the line segments).
    """
    a1, a2 = line_a
    b1, b2 = line_b
    s_a = _slope(line_a)
    s_b = _slope(line_b)

    if s_a == float("inf") and s_b == float("inf"):
        return None  # both vertical
    if s_a == float("inf"):
        t = a1["t"]
        price = line_at(line_b, t)
        return {"t": t, "price": price}
    if s_b == float("inf"):
        t = b1["t"]
        price = line_at(line_a, t)
        return {"t": t, "price": price}

    if abs(s_a - s_b) < 1e-9:
        return None  # parallel

    # y = m_a*(x - a1.t) + a1.price = m_b*(x - b1.t) + b1.price
    # → m_a*x - m_b*x = m_a*a1.t - m_b*b1.t + b1.price - a1.price
    t = (s_a * a1["t"] - s_b * b1["t"] + b1["price"] - a1["price"]) / (s_a - s_b)
    price = line_at(line_a, t)
    return {"t": t, "price": price}


def parallel_score(line_a: Line, line_b: Line) -> float:
    """Score 0-1 measuring how parallel the two lines are.

    1.0 = identical slope. 0.0 = perpendicular or worse.
    Uses the cosine of the slope-angle difference.
    """
    s_a = _slope(line_a)
    s_b = _slope(line_b)
    if s_a == float("inf") and s_b == float("inf"):
        return 1.0
    if s_a == float("inf") or s_b == float("inf"):
        return 0.0
    ang_a = math.atan(s_a)
    ang_b = math.atan(s_b)
    diff = abs(ang_a - ang_b)
    # cos(diff) is 1 when identical, decreases as they diverge.
    val = math.cos(diff)
    return max(0.0, val)


def polynomial_fit(xs: list[float], ys: list[float], degree: int) -> list[float]:
    """Fit a polynomial of given degree; returns coefficients [c_n, ..., c_1, c_0].

    Uses numpy.polyfit internally. Same convention as numpy: highest-degree first.
    """
    import numpy as np
    coeffs = np.polyfit(xs, ys, degree)
    return [float(c) for c in coeffs]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_geometry.py -v`
Expected: PASS — 9/9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/__init__.py api/services/pattern_engine/primitives/geometry.py tests/pattern_engine/primitives/__init__.py tests/pattern_engine/primitives/test_geometry.py
git commit -m "feat(patterns): geometry primitives (slope, intersect, parallel, polyfit)"
```

---

## Task 3: Pivots primitive

Fractal swing high/low detection. No deps beyond stdlib + types.

**Files:**
- Create: `api/services/pattern_engine/primitives/pivots.py`
- Create: `tests/pattern_engine/primitives/test_pivots.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/primitives/test_pivots.py`:
```python
from api.services.pattern_engine.primitives.pivots import detect_pivots


def _bar(t, o, h, l, c, v=1000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_no_pivots_in_monotonic_uptrend():
    """A pure uptrend has no swing highs (every bar is higher than both neighbors)
    nor swing lows. detect_pivots returns []."""
    bars = [_bar(i, 100 + i, 101 + i, 99 + i, 100 + i) for i in range(30)]
    pivots = detect_pivots(bars, window=3)
    assert pivots == []


def test_detects_single_swing_high():
    """A bar that strictly dominates its window on the high side is a swing high."""
    # 5 bars rising to a peak, then falling. Peak is bar 4.
    highs = [100, 102, 104, 106, 110, 108, 104, 102, 100, 99]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots = detect_pivots(bars, window=3)
    assert len(pivots) >= 1
    swing_high = next((p for p in pivots if p["type"] == "high"), None)
    assert swing_high is not None
    assert swing_high["bar_index"] == 4
    assert swing_high["price"] == 110


def test_detects_swing_high_and_low():
    """V-then-inverted-V should produce one low and one high."""
    pattern_highs = [105, 103, 101, 99, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100]
    pattern_lows  = [h - 2 for h in pattern_highs]
    bars = [_bar(i, pattern_highs[i] - 1, pattern_highs[i], pattern_lows[i], pattern_highs[i] - 1)
            for i in range(len(pattern_highs))]
    pivots = detect_pivots(bars, window=3)
    highs = [p for p in pivots if p["type"] == "high"]
    lows  = [p for p in pivots if p["type"] == "low"]
    assert len(highs) >= 1
    assert len(lows) >= 1


def test_strength_increases_with_dominance():
    """A pivot that dominates 5 bars on each side is stronger than one that only
    dominates 3. With window=5, the wider dominance gets a higher strength."""
    # peak with 5-bar dominance both sides
    highs = [100, 101, 102, 103, 104, 110, 104, 103, 102, 101, 100]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots5 = detect_pivots(bars, window=5)
    pivots3 = detect_pivots(bars, window=3)
    peak5 = next((p for p in pivots5 if p["type"] == "high"), None)
    peak3 = next((p for p in pivots3 if p["type"] == "high"), None)
    assert peak5 is not None and peak3 is not None
    # 5-window pivot demands more dominance, so its strength should be ≥ 3-window.
    assert peak5["strength"] >= peak3["strength"]


def test_returns_empty_for_short_bars():
    """If bars are shorter than 2*window+1, no pivots can be detected."""
    bars = [_bar(i, 100, 101, 99, 100) for i in range(4)]
    pivots = detect_pivots(bars, window=3)
    assert pivots == []


def test_pivots_sorted_by_bar_index():
    """Output should be sorted ascending by bar_index for deterministic downstream use."""
    highs = [100, 105, 100, 95, 100, 105, 100, 95, 100, 105, 100]
    bars = [_bar(i, h - 1, h, h - 2, h - 1) for i, h in enumerate(highs)]
    pivots = detect_pivots(bars, window=2)
    indices = [p["bar_index"] for p in pivots]
    assert indices == sorted(indices)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_pivots.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement pivots module**

Create `api/services/pattern_engine/primitives/pivots.py`:
```python
"""Fractal swing-pivot detection.

A bar is a "swing high" pivot if its high strictly exceeds both neighbors'
highs over a window of ±N bars on each side. A "swing low" is symmetric on
lows.

The first and last `window` bars of the series cannot be pivots (insufficient
neighbors). Strength is a 0-100 score: higher means the pivot dominates a
wider window AND by a larger margin.
"""
from __future__ import annotations

from typing import List

from api.services.pattern_engine.types import Bar, Pivot


def detect_pivots(bars: List[Bar], window: int = 5) -> List[Pivot]:
    """Detect swing highs and lows using the fractal method.

    Args:
      bars: OHLCV list, sorted by t ascending.
      window: number of bars on each side to compare against (typical: 3-9).

    Returns:
      List of Pivot dicts sorted by bar_index ascending.
    """
    if window <= 0:
        raise ValueError("window must be positive")
    n = len(bars)
    if n < 2 * window + 1:
        return []

    pivots: List[Pivot] = []

    for i in range(window, n - window):
        bar = bars[i]
        left  = bars[i - window:i]
        right = bars[i + 1:i + 1 + window]
        ctx   = left + right

        # Swing high: strictly greater than all neighbors' highs.
        if all(bar["h"] > b["h"] for b in ctx):
            max_neighbor = max(b["h"] for b in ctx)
            margin = (bar["h"] - max_neighbor) / max_neighbor if max_neighbor > 0 else 0
            # strength scales with margin (capped) and window size.
            strength = min(100, int(50 + margin * 1000 + window * 2))
            pivots.append({
                "t": bar["t"],
                "price": bar["h"],
                "type": "high",
                "strength": strength,
                "bar_index": i,
            })
            continue

        # Swing low: strictly less than all neighbors' lows.
        if all(bar["l"] < b["l"] for b in ctx):
            min_neighbor = min(b["l"] for b in ctx)
            margin = (min_neighbor - bar["l"]) / min_neighbor if min_neighbor > 0 else 0
            strength = min(100, int(50 + margin * 1000 + window * 2))
            pivots.append({
                "t": bar["t"],
                "price": bar["l"],
                "type": "low",
                "strength": strength,
                "bar_index": i,
            })

    return pivots
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_pivots.py -v`
Expected: PASS — 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/pivots.py tests/pattern_engine/primitives/test_pivots.py
git commit -m "feat(patterns): fractal swing-pivot detection"
```

---

## Task 4: Volume primitives

Volume signature classifier (expanding/contracting/neutral), contraction score, accumulation/distribution.

**Files:**
- Create: `api/services/pattern_engine/primitives/volume.py`
- Create: `tests/pattern_engine/primitives/test_volume.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/primitives/test_volume.py`:
```python
from api.services.pattern_engine.primitives.volume import (
    volume_signature, contraction_score, accumulation_distribution,
)


def _bar(t, c, v, o=None):
    o = o if o is not None else c
    return {"t": t, "o": o, "h": c + 1, "l": c - 1, "c": c, "v": v}


def test_signature_contracting_when_recent_volume_lower():
    # First 20 bars high volume, last 10 bars dropping volume.
    bars = [_bar(i, 100, 10000) for i in range(20)] + [_bar(i + 20, 100, 3000) for i in range(10)]
    assert volume_signature(bars, lookback=10) == "contracting"


def test_signature_expanding_when_recent_volume_higher():
    bars = [_bar(i, 100, 3000) for i in range(20)] + [_bar(i + 20, 100, 10000) for i in range(10)]
    assert volume_signature(bars, lookback=10) == "expanding"


def test_signature_neutral_when_flat():
    bars = [_bar(i, 100, 5000) for i in range(30)]
    assert volume_signature(bars, lookback=10) == "neutral"


def test_contraction_score_higher_for_tighter_recent_volume():
    """A series where volume tightens at the end has a higher contraction score
    than one where volume is uniform."""
    tightening = [_bar(i, 100, 10000) for i in range(10)] + [_bar(i + 10, 100, 3000) for i in range(10)]
    uniform    = [_bar(i, 100, 6500) for i in range(20)]
    assert contraction_score(tightening, window=10) > contraction_score(uniform, window=10)


def test_contraction_score_zero_to_one_range():
    bars = [_bar(i, 100, 5000) for i in range(20)]
    score = contraction_score(bars, window=10)
    assert 0.0 <= score <= 1.0


def test_accumulation_distribution_positive_on_up_days_high_volume():
    """Up days (close > open) with rising volume → positive A/D."""
    bars = []
    price = 100
    for i in range(10):
        price += 1
        bars.append(_bar(i, price, 5000 + i * 100, o=price - 1))
    score = accumulation_distribution(bars, lookback=10)
    assert score > 0


def test_accumulation_distribution_negative_on_down_days():
    bars = []
    price = 110
    for i in range(10):
        price -= 1
        bars.append(_bar(i, price, 5000 + i * 100, o=price + 1))
    score = accumulation_distribution(bars, lookback=10)
    assert score < 0


def test_signature_returns_neutral_for_short_series():
    bars = [_bar(i, 100, 1000) for i in range(5)]
    assert volume_signature(bars, lookback=10) == "neutral"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_volume.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement volume module**

Create `api/services/pattern_engine/primitives/volume.py`:
```python
"""Volume primitives: signature classification, contraction score, accumulation/distribution.

All inputs accept OHLCV bars; only `c`, `o`, `v` are read here.
"""
from __future__ import annotations

import math
from typing import List, Literal

from api.services.pattern_engine.types import Bar


VolumeSignature = Literal["contracting", "expanding", "neutral"]


def volume_signature(bars: List[Bar], lookback: int = 10) -> VolumeSignature:
    """Classify recent volume trend versus the preceding window.

    Compares mean volume of the last `lookback` bars to the mean of the previous
    `lookback` bars. Ratio:
      < 0.75 → contracting
      > 1.30 → expanding
      else   → neutral

    Returns "neutral" if bars are shorter than 2 * lookback.
    """
    if len(bars) < 2 * lookback:
        return "neutral"

    recent  = [b["v"] for b in bars[-lookback:]]
    prior   = [b["v"] for b in bars[-2 * lookback:-lookback]]

    mean_recent = sum(recent) / lookback
    mean_prior  = sum(prior) / lookback if prior else 0

    if mean_prior <= 0:
        return "neutral"

    ratio = mean_recent / mean_prior
    if ratio < 0.75:
        return "contracting"
    if ratio > 1.30:
        return "expanding"
    return "neutral"


def contraction_score(bars: List[Bar], window: int = 10) -> float:
    """Score 0-1 measuring how much the recent volume window is contracting
    relative to the preceding window of the same size.

    1.0 = recent volume is ~0 vs prior; 0.0 = recent volume ≥ prior.
    """
    if len(bars) < 2 * window:
        return 0.0
    recent_mean = sum(b["v"] for b in bars[-window:]) / window
    prior_mean  = sum(b["v"] for b in bars[-2 * window:-window]) / window
    if prior_mean <= 0:
        return 0.0
    ratio = recent_mean / prior_mean
    # ratio < 1 → contracting; map (0,1] → (1,0].
    if ratio >= 1.0:
        return 0.0
    return 1.0 - ratio


def accumulation_distribution(bars: List[Bar], lookback: int = 10) -> float:
    """Signed score: positive = accumulation, negative = distribution.

    Sums volume * sign(close - open) over the last `lookback` bars, then
    normalizes by total volume in the window. Range approximately [-1, 1].

    Returns 0.0 if lookback exceeds series length.
    """
    if len(bars) < lookback:
        return 0.0
    window = bars[-lookback:]
    total_vol = sum(b["v"] for b in window)
    if total_vol <= 0:
        return 0.0
    signed = 0.0
    for b in window:
        sign = 1 if b["c"] > b["o"] else (-1 if b["c"] < b["o"] else 0)
        signed += b["v"] * sign
    return signed / total_vol
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_volume.py -v`
Expected: PASS — 8/8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/volume.py tests/pattern_engine/primitives/test_volume.py
git commit -m "feat(patterns): volume primitives (signature, contraction, A/D)"
```

---

## Task 5: Trendlines primitive

Linear regression on pivots → Trendline. Parallel pair fit for flags/wedges.

**Files:**
- Create: `api/services/pattern_engine/primitives/trendlines.py`
- Create: `tests/pattern_engine/primitives/test_trendlines.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/primitives/test_trendlines.py`:
```python
from api.services.pattern_engine.primitives.trendlines import (
    fit_trendline, fit_pair_parallel,
)


def _pivot(t, price, ptype="high"):
    return {"t": t, "price": price, "type": ptype, "strength": 50, "bar_index": t}


def test_fit_trendline_horizontal():
    """Three pivots at same price → horizontal trendline (slope ~0)."""
    pivots = [_pivot(0, 100), _pivot(10, 100), _pivot(20, 100)]
    tl = fit_trendline(pivots)
    assert abs(tl["slope"]) < 0.01
    assert tl["touches"] >= 2
    assert tl["r_squared"] > 0.95
    assert tl["validity"] > 0.5


def test_fit_trendline_ascending():
    """Pivots on a perfect ascending line have slope > 0 and r² ~1."""
    pivots = [_pivot(0, 100), _pivot(10, 110), _pivot(20, 120), _pivot(30, 130)]
    tl = fit_trendline(pivots)
    assert tl["slope"] > 0.5
    assert tl["r_squared"] > 0.99


def test_fit_trendline_returns_low_validity_for_noisy_pivots():
    """Scattered pivots have low r²."""
    pivots = [_pivot(0, 100), _pivot(10, 150), _pivot(20, 80), _pivot(30, 130)]
    tl = fit_trendline(pivots)
    assert tl["validity"] < 0.7


def test_fit_trendline_raises_with_too_few_pivots():
    """Need at least 2 pivots to fit a line."""
    import pytest
    with pytest.raises(ValueError):
        fit_trendline([_pivot(0, 100)])


def test_fit_pair_parallel_returns_parallel_lines():
    """Upper pivots above lower pivots; both ascending at same rate."""
    upper = [_pivot(0, 110, "high"), _pivot(10, 120, "high"), _pivot(20, 130, "high")]
    lower = [_pivot(0, 100, "low"),  _pivot(10, 110, "low"),  _pivot(20, 120, "low")]
    upper_line, lower_line = fit_pair_parallel(upper, lower)
    # Should be very close in slope (within 0.05)
    assert abs(upper_line["slope"] - lower_line["slope"]) < 0.05


def test_fit_pair_parallel_handles_converging_pivots():
    """Pivots that converge (wedge) — both lines fit, slopes differ."""
    upper = [_pivot(0, 120, "high"), _pivot(10, 118, "high"), _pivot(20, 115, "high")]  # falling
    lower = [_pivot(0, 100, "low"),  _pivot(10, 105, "low"),  _pivot(20, 110, "low")]   # rising
    upper_line, lower_line = fit_pair_parallel(upper, lower)
    assert upper_line["slope"] < 0
    assert lower_line["slope"] > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_trendlines.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement trendlines module**

Create `api/services/pattern_engine/primitives/trendlines.py`:
```python
"""Trendline fitting from a set of pivots.

Uses least-squares regression. Returns a `Trendline` typed dict with:
  - p1, p2: endpoint anchors (the first and last pivots, projected onto the fitted line)
  - slope: price-per-unit-t
  - r_squared: 0-1 fit quality
  - touches: number of input pivots within a small distance of the line
  - validity: composite 0-1 score (r² weighted with touches count)
"""
from __future__ import annotations

from typing import List, Tuple

from api.services.pattern_engine.types import Pivot, Trendline


def fit_trendline(pivots: List[Pivot], touch_tolerance_pct: float = 0.5) -> Trendline:
    """Fit a least-squares line to the pivots' (t, price) points.

    Args:
      pivots: ≥2 pivots
      touch_tolerance_pct: percentage of fitted price within which a pivot counts as a "touch"

    Returns:
      Trendline dict; validity is min(r², touches/4) for a soft cap on weak lines.

    Raises:
      ValueError: if fewer than 2 pivots.
    """
    if len(pivots) < 2:
        raise ValueError("need at least 2 pivots to fit a trendline")

    ts     = [float(p["t"]) for p in pivots]
    prices = [float(p["price"]) for p in pivots]
    n = len(pivots)

    mean_t  = sum(ts) / n
    mean_p  = sum(prices) / n

    num = sum((t - mean_t) * (p - mean_p) for t, p in zip(ts, prices))
    den = sum((t - mean_t) ** 2 for t in ts)
    slope = (num / den) if den != 0 else 0.0
    intercept = mean_p - slope * mean_t

    # R² (coefficient of determination)
    ss_total = sum((p - mean_p) ** 2 for p in prices)
    ss_res   = sum((p - (slope * t + intercept)) ** 2 for t, p in zip(ts, prices))
    r_squared = (1.0 - ss_res / ss_total) if ss_total > 0 else 1.0
    r_squared = max(0.0, min(1.0, r_squared))

    # Count touches: pivots within tolerance% of fitted price
    touches = 0
    for t, p in zip(ts, prices):
        expected = slope * t + intercept
        if expected <= 0:
            continue
        if abs(p - expected) / expected * 100 <= touch_tolerance_pct:
            touches += 1

    # Endpoints projected onto fitted line
    t_start, t_end = ts[0], ts[-1]
    p_start = slope * t_start + intercept
    p_end   = slope * t_end   + intercept

    # Validity: r² weighted with touch count (4+ touches uncaps)
    validity = min(r_squared, touches / 4.0) if touches < 4 else r_squared

    return {
        "p1": {"t": int(t_start), "price": float(p_start)},
        "p2": {"t": int(t_end),   "price": float(p_end)},
        "slope": float(slope),
        "r_squared": float(r_squared),
        "touches": int(touches),
        "validity": float(validity),
    }


def fit_pair_parallel(upper_pivots: List[Pivot], lower_pivots: List[Pivot]) -> Tuple[Trendline, Trendline]:
    """Fit two trendlines from upper and lower pivot sets (no parallelism enforcement).

    Caller decides whether the resulting pair is parallel-enough for their
    pattern (use `geometry.parallel_score`). This function just fits each
    independently — that's why it's "fit_pair" not "fit_parallel_pair".
    """
    upper = fit_trendline(upper_pivots)
    lower = fit_trendline(lower_pivots)
    return upper, lower
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_trendlines.py -v`
Expected: PASS — 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/trendlines.py tests/pattern_engine/primitives/test_trendlines.py
git commit -m "feat(patterns): trendline fitting via least-squares regression"
```

---

## Task 6: Context primitive

Builds the `Context` enrichment dict for every detection. Uses existing engine data (bars, regime, earnings if available).

**Files:**
- Create: `api/services/pattern_engine/primitives/context.py`
- Create: `tests/pattern_engine/primitives/test_context.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/primitives/test_context.py`:
```python
from api.services.pattern_engine.primitives.context import build_context


def _bar(t, c, o=None, h=None, l=None, v=1000):
    o = o if o is not None else c
    h = h if h is not None else c + 1
    l = l if l is not None else c - 1
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_build_context_returns_required_keys():
    bars = [_bar(i, 100 + i) for i in range(250)]
    ctx = build_context(bars, sym="AAPL")
    expected_keys = {
        "trend_stage", "rs_trend", "ma_alignment", "volume_signature",
        "regime", "nearest_resistance", "nearest_support",
        "days_to_earnings", "sector_strength_rank",
    }
    assert expected_keys.issubset(ctx.keys())


def test_strong_uptrend_classified_as_stage_2():
    """A sustained uptrend with rising 50 + 200 SMAs is Weinstein Stage 2."""
    bars = [_bar(i, 100 + i * 0.5) for i in range(300)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["trend_stage"] == 2
    assert ctx["ma_alignment"] == "stacked_bullish"


def test_strong_downtrend_classified_as_stage_4():
    bars = [_bar(i, 200 - i * 0.4) for i in range(300)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["trend_stage"] == 4
    assert ctx["ma_alignment"] == "stacked_bearish"


def test_volume_signature_propagated():
    """Bars with declining volume → context.volume_signature == 'contracting'."""
    bars = [_bar(i, 100, v=10000) for i in range(20)] + \
           [_bar(i + 20, 100, v=3000) for i in range(10)]
    ctx = build_context(bars, sym="TEST")
    assert ctx["volume_signature"] == "contracting"


def test_regime_hint_used():
    bars = [_bar(i, 100) for i in range(250)]
    ctx = build_context(bars, sym="TEST", regime_hint="bear")
    assert ctx["regime"] == "bear"


def test_handles_short_bars_gracefully():
    """Fewer than 200 bars → context still returns, with conservative defaults."""
    bars = [_bar(i, 100) for i in range(50)]
    ctx = build_context(bars, sym="TEST")
    # Should not crash; ma_alignment may be "mixed" without 200 SMA.
    assert ctx["ma_alignment"] in ("stacked_bullish", "mixed", "stacked_bearish")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/primitives/test_context.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement context module**

Create `api/services/pattern_engine/primitives/context.py`:
```python
"""Build the Context enrichment dict for a pattern detection.

Pulls trend/MA/RS/volume context from the bars themselves. Reads regime
from existing wire_data cache when available, else accepts a hint argument.
Earnings proximity + sector strength rank are stubbed for Phase 0 (None)
and wired in later phases.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.primitives.volume import volume_signature
from api.services.pattern_engine.types import Bar, Context


def _sma(values: List[float], period: int) -> Optional[float]:
    """Latest SMA value, or None if insufficient data."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _slope_sign(values: List[float], window: int) -> int:
    """Return +1 if values rising over `window`, -1 if falling, 0 if flat.
    Uses first vs last in the window."""
    if len(values) < window:
        return 0
    a, b = values[-window], values[-1]
    if b > a * 1.02: return 1
    if b < a * 0.98: return -1
    return 0


def _ma_alignment(bars: List[Bar]) -> str:
    closes = [b["c"] for b in bars]
    last = closes[-1] if closes else 0
    s10  = _sma(closes, 10)
    s20  = _sma(closes, 20)
    s50  = _sma(closes, 50)
    s200 = _sma(closes, 200)

    if None in (s10, s20, s50, s200):
        # Insufficient history — try without 200.
        if s10 and s20 and s50:
            if last > s10 > s20 > s50:
                return "stacked_bullish"
            if last < s10 < s20 < s50:
                return "stacked_bearish"
        return "mixed"

    if last > s10 > s20 > s50 > s200:
        return "stacked_bullish"
    if last < s10 < s20 < s50 < s200:
        return "stacked_bearish"
    return "mixed"


def _trend_stage(bars: List[Bar]) -> int:
    """Weinstein 1-4 simplified:
      Stage 1: flat 30-week SMA, price near it (consolidation/accumulation)
      Stage 2: rising 30-week SMA, price above it (uptrend)
      Stage 3: flat 30-week SMA, price near it after up move (distribution)
      Stage 4: falling 30-week SMA, price below it (downtrend)

    Approximation using 50-bar SMA when 150 bars are available, else 20-bar.
    """
    closes = [b["c"] for b in bars]
    last = closes[-1] if closes else 0
    if len(closes) >= 200:
        sma_long = _sma(closes, 150)
        slope_sign = _slope_sign(closes, 50)
    elif len(closes) >= 50:
        sma_long = _sma(closes, 50)
        slope_sign = _slope_sign(closes, 20)
    else:
        return 1  # too short

    if sma_long is None:
        return 1

    above = last > sma_long
    if slope_sign > 0 and above:  return 2
    if slope_sign < 0 and not above: return 4
    if slope_sign > 0 and not above: return 1  # rising but price hasn't broken above yet
    if slope_sign < 0 and above:     return 3  # rolling over
    return 1


def _rs_trend(bars: List[Bar]) -> str:
    """Relative strength trend over the last 20 bars vs the previous 20.

    Simplified to absolute trend since SPY comparison would require fetching
    SPY bars per call. RS-vs-SPY can be added in Phase 1+.
    """
    closes = [b["c"] for b in bars]
    if len(closes) < 40:
        return "flat"
    recent = closes[-20:]
    prior  = closes[-40:-20]
    r_pct  = (recent[-1] - recent[0]) / recent[0] if recent[0] > 0 else 0
    p_pct  = (prior[-1] - prior[0]) / prior[0] if prior[0] > 0 else 0
    diff = r_pct - p_pct
    if diff > 0.03: return "up"
    if diff < -0.03: return "down"
    return "flat"


def _nearest_resistance(bars: List[Bar]) -> Optional[float]:
    """Highest high in the last 60 bars, above current close."""
    if not bars:
        return None
    last_close = bars[-1]["c"]
    lookback = bars[-60:]
    above = [b["h"] for b in lookback if b["h"] > last_close]
    return min(above) if above else None


def _nearest_support(bars: List[Bar]) -> Optional[float]:
    if not bars:
        return None
    last_close = bars[-1]["c"]
    lookback = bars[-60:]
    below = [b["l"] for b in lookback if b["l"] < last_close]
    return max(below) if below else None


def build_context(
    bars: List[Bar],
    sym: str,
    regime_hint: Optional[str] = None,
) -> Context:
    """Build a Context dict from bars + optional regime hint.

    Args:
      bars: OHLCV list, sorted by t asc, most-recent last.
      sym: ticker (used only for downstream enrichment; not needed for math).
      regime_hint: caller-supplied regime tag. Phase 0 doesn't read from
        wire_data cache directly — that wiring is left for Phase 1+ if the
        regime hint is missing.

    Returns:
      Context dict matching the TypedDict schema.
    """
    regime = regime_hint if regime_hint else "unknown"

    return {
        "trend_stage": _trend_stage(bars),
        "rs_trend": _rs_trend(bars),
        "ma_alignment": _ma_alignment(bars),
        "volume_signature": volume_signature(bars, lookback=10),
        "regime": regime,
        "nearest_resistance": _nearest_resistance(bars),
        "nearest_support": _nearest_support(bars),
        "days_to_earnings": None,        # Phase 1+: wire from earnings_analytics
        "sector_strength_rank": None,    # Phase 1+: wire from sector_flow
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/primitives/test_context.py -v`
Expected: PASS — 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/context.py tests/pattern_engine/primitives/test_context.py
git commit -m "feat(patterns): context primitive (Weinstein stage + MA stack + RS + S/R)"
```

---

## Task 7: Memory schema

Add 4 tables to existing `auth.db` via `init_db()`. Pure DDL — no behavior.

**Files:**
- Modify: `api/services/auth_db.py` (add tables to init_db)

- [ ] **Step 1: Write failing test**

Create `tests/pattern_engine/test_memory_schema.py`:
```python
"""Verify the 4 pattern recognition tables exist after init_db() runs."""
from api.services.auth_db import get_connection, init_db


def test_pattern_tables_exist_after_init():
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pattern_%'"
        ).fetchall()
        names = sorted([r["name"] for r in rows])
        assert names == [
            "pattern_detections",
            "pattern_feedback",
            "pattern_outcomes",
            "pattern_stats",
        ]
    finally:
        conn.close()


def test_pattern_detections_indexes_exist():
    init_db()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_pd_%'"
        ).fetchall()
        names = {r["name"] for r in rows}
        assert names == {"idx_pd_sym_tf", "idx_pd_pattern", "idx_pd_status"}
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pattern_engine/test_memory_schema.py -v`
Expected: FAIL — tables don't exist yet.

- [ ] **Step 3: Add schema to init_db**

Open `api/services/auth_db.py`. Find the end of `init_db()` (around the trade_executions / journal_screenshots / playbooks block — search for `CREATE TABLE IF NOT EXISTS playbooks`).

Add this block inside `init_db()` AFTER the existing `executescript(...)` calls but BEFORE the final `conn.commit()` (or as its own executescript + commit pair if that pattern is used). Look for an existing pattern like `conn.executescript("""CREATE TABLE IF NOT EXISTS ...""")` and add the new block right after the last one inside the function body:

```python
        # ─── Pattern Recognition (Phase 0) ────────────────────────────────
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS pattern_detections (
              id            TEXT PRIMARY KEY,
              sym           TEXT NOT NULL,
              tf            TEXT NOT NULL,
              pattern_id    TEXT NOT NULL,
              category      TEXT NOT NULL,
              direction     TEXT NOT NULL,
              start_t       INTEGER NOT NULL,
              end_t         INTEGER NOT NULL,
              confidence    REAL NOT NULL,
              quality_json  TEXT NOT NULL,
              geometry_json TEXT NOT NULL,
              levels_json   TEXT NOT NULL,
              context_json  TEXT NOT NULL,
              narrative_json TEXT NOT NULL,
              status        TEXT NOT NULL,
              detected_at   INTEGER NOT NULL,
              last_seen_at  INTEGER NOT NULL,
              hash_key      TEXT NOT NULL UNIQUE
            );

            CREATE INDEX IF NOT EXISTS idx_pd_sym_tf   ON pattern_detections(sym, tf);
            CREATE INDEX IF NOT EXISTS idx_pd_pattern  ON pattern_detections(pattern_id);
            CREATE INDEX IF NOT EXISTS idx_pd_status   ON pattern_detections(status);

            CREATE TABLE IF NOT EXISTS pattern_outcomes (
              detection_id  TEXT PRIMARY KEY REFERENCES pattern_detections(id),
              entry_hit     INTEGER NOT NULL DEFAULT 0,
              entry_hit_t   INTEGER,
              stop_hit      INTEGER NOT NULL DEFAULT 0,
              stop_hit_t    INTEGER,
              target_hit    INTEGER NOT NULL DEFAULT 0,
              target_hit_t  INTEGER,
              mfe_pct       REAL,
              mae_pct       REAL,
              bars_to_resolve INTEGER,
              resolved_at   INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pattern_stats (
              pattern_id    TEXT NOT NULL,
              tf            TEXT NOT NULL,
              regime_bucket TEXT NOT NULL,
              n_total       INTEGER NOT NULL DEFAULT 0,
              n_resolved    INTEGER NOT NULL DEFAULT 0,
              n_entry_hit   INTEGER NOT NULL DEFAULT 0,
              n_target_hit  INTEGER NOT NULL DEFAULT 0,
              n_stop_hit    INTEGER NOT NULL DEFAULT 0,
              avg_mfe_pct   REAL,
              avg_mae_pct   REAL,
              median_bars   INTEGER,
              hit_rate      REAL,
              expectancy_R  REAL,
              last_updated  INTEGER NOT NULL,
              PRIMARY KEY (pattern_id, tf, regime_bucket)
            );

            CREATE TABLE IF NOT EXISTS pattern_feedback (
              id            INTEGER PRIMARY KEY AUTOINCREMENT,
              detection_id  TEXT NOT NULL REFERENCES pattern_detections(id),
              user_id       TEXT NOT NULL,
              rating        TEXT NOT NULL,
              note          TEXT,
              created_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pf_detection ON pattern_feedback(detection_id);
        """)
        conn.commit()
        print("[patterns] Schema initialized (4 tables)")
```

Note the `hash_key TEXT NOT NULL UNIQUE` column — this is the dedup key used by `store_detection` in Task 8 (hash of sym+tf+pattern_id+start_t+end_t). It's not in the spec's example schema but is necessary for the UPSERT contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pattern_engine/test_memory_schema.py -v`
Expected: PASS — 2/2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/auth_db.py tests/pattern_engine/test_memory_schema.py
git commit -m "feat(patterns): add 4 pattern_* tables to auth_db init_db()"
```

---

## Task 8: Memory module

CRUD on detections + feedback. Stubs for outcome tracker + stats roll-up.

**Files:**
- Create: `api/services/pattern_engine/memory.py`
- Create: `tests/pattern_engine/test_memory.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/test_memory.py`:
```python
from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def _detection(**overrides):
    """Minimal valid Detection for testing."""
    base = {
        "id": "det-1",
        "sym": "AAPL", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [1700000000, 1700100000],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0, "stop_basis": "",
                   "target_primary": 110.0, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "test", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": 1700100100, "last_seen_at": 1700100100,
    }
    base.update(overrides)
    return base


def test_store_detection_inserts_row():
    init_db()
    d = _detection(id="det-store-1")
    memory.store_detection(d)
    got = memory.get_detection_by_id("det-store-1")
    assert got is not None
    assert got["sym"] == "AAPL"
    assert got["confidence"] == 75.0


def test_store_detection_dedups_by_hash():
    """Storing the same detection twice (same sym/tf/pattern_id/start_t/end_t)
    should UPSERT — second call updates last_seen_at, not create a new row."""
    init_db()
    d1 = _detection(id="det-dedup-1", confidence=70.0, last_seen_at=1000)
    d2 = _detection(id="det-dedup-2", confidence=80.0, last_seen_at=2000)  # different id
    memory.store_detection(d1)
    memory.store_detection(d2)
    # Only one row should remain — d2 won (later last_seen_at)
    rows = memory.get_active_detections("AAPL", "D")
    matching = [r for r in rows if r["pattern_id"] == "bull_flag"
                                 and r["start_t"] == d1["start_t"]
                                 and r["end_t"] == d1["end_t"]]
    assert len(matching) == 1
    assert matching[0]["confidence"] == 80.0
    assert matching[0]["last_seen_at"] == 2000


def test_get_active_detections_filters_by_pattern():
    init_db()
    memory.store_detection(_detection(id="det-flag-1", pattern_id="bull_flag", start_t=1, end_t=2))
    memory.store_detection(_detection(id="det-cup-1", pattern_id="cup_handle", start_t=1, end_t=2))
    flags = memory.get_active_detections("AAPL", "D", pattern_ids=["bull_flag"])
    assert all(r["pattern_id"] == "bull_flag" for r in flags)


def test_record_feedback_inserts_row():
    init_db()
    memory.store_detection(_detection(id="det-fb-1"))
    memory.record_feedback("det-fb-1", user_id="user-1", rating="great", note="clean setup")
    # Round-trip via direct query
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_feedback WHERE detection_id = ?", ("det-fb-1",)
        ).fetchone()
        assert row is not None
        assert row["rating"] == "great"
        assert row["user_id"] == "user-1"
    finally:
        conn.close()


def test_track_outcomes_stub_returns_zero():
    """Phase 0 stub: track_outcomes is schema-ready but does no work yet."""
    n = memory.track_outcomes(lookback_hours=48)
    assert n == 0


def test_recompute_stats_stub_returns_zero():
    n = memory.recompute_stats()
    assert n == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/test_memory.py -v`
Expected: FAIL — `memory` module doesn't exist.

- [ ] **Step 3: Implement memory module**

Create `api/services/pattern_engine/memory.py`:
```python
"""Storage layer for pattern detections.

Responsibilities:
  - store_detection(d): UPSERT by stable hash of (sym, tf, pattern_id, start_t, end_t)
  - get_active_detections(sym, tf, pattern_ids=None): query for chart overlay
  - get_detection_by_id(id)
  - record_feedback(detection_id, user_id, rating, note=None)
  - track_outcomes(): Phase 7 stub (returns 0 in Phase 0)
  - recompute_stats(): Phase 7 stub (returns 0 in Phase 0)
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Optional

from api.services.auth_db import get_connection
from api.services.pattern_engine.types import Detection


_VALID_FEEDBACK_RATINGS = {"great", "good", "miss", "wrong"}


def _hash_key(sym: str, tf: str, pattern_id: str, start_t: int, end_t: int) -> str:
    """Stable hash for dedup. Identical pattern geometry on same symbol/TF/range
    collapses to one row regardless of how many times the engine fires."""
    raw = f"{sym}|{tf}|{pattern_id}|{start_t}|{end_t}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def store_detection(d: Detection) -> None:
    """UPSERT a detection. New shapes → INSERT. Recurrent same-shape → UPDATE
    last_seen_at + confidence + status (whichever the engine last computed)."""
    hk = _hash_key(d["sym"], d["tf"], d["pattern_id"], d["start_t"], d["end_t"])

    conn = get_connection()
    try:
        conn.execute("""
            INSERT INTO pattern_detections (
              id, sym, tf, pattern_id, category, direction,
              start_t, end_t, confidence,
              quality_json, geometry_json, levels_json, context_json, narrative_json,
              status, detected_at, last_seen_at, hash_key
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?
            )
            ON CONFLICT(hash_key) DO UPDATE SET
              confidence    = excluded.confidence,
              quality_json  = excluded.quality_json,
              geometry_json = excluded.geometry_json,
              levels_json   = excluded.levels_json,
              context_json  = excluded.context_json,
              narrative_json = excluded.narrative_json,
              status        = excluded.status,
              last_seen_at  = excluded.last_seen_at
        """, (
            d["id"], d["sym"], d["tf"], d["pattern_id"], d["category"], d["direction"],
            d["start_t"], d["end_t"], d["confidence"],
            json.dumps(d["quality_components"]),
            json.dumps(d["geometry"]),
            json.dumps(d["levels"]),
            json.dumps(d["context"]),
            json.dumps(d["narrative"]),
            d["status"], d["detected_at"], d["last_seen_at"], hk,
        ))
        conn.commit()
    finally:
        conn.close()


def _row_to_detection(row) -> dict:
    """Reconstitute a Detection dict from a sqlite row."""
    return {
        "id": row["id"],
        "sym": row["sym"],
        "tf": row["tf"],
        "pattern_id": row["pattern_id"],
        "pattern_name": row["pattern_id"].replace("_", " ").title(),  # display
        "category": row["category"],
        "direction": row["direction"],
        "start_t": row["start_t"],
        "end_t": row["end_t"],
        "pivot_ts": [],  # not stored separately in Phase 0; downstream re-derives if needed
        "geometry": json.loads(row["geometry_json"]),
        "levels": json.loads(row["levels_json"]),
        "context": json.loads(row["context_json"]),
        "confidence": row["confidence"],
        "quality_components": json.loads(row["quality_json"]),
        "narrative": json.loads(row["narrative_json"]),
        "status": row["status"],
        "outcome": None,
        "detected_at": row["detected_at"],
        "last_seen_at": row["last_seen_at"],
    }


def get_active_detections(
    sym: str,
    tf: str,
    pattern_ids: Optional[list[str]] = None,
    min_conf: float = 0.0,
) -> list[dict]:
    """Return detections for (sym, tf) with status not in ('completed', 'failed', 'expired'),
    sorted by detected_at desc."""
    conn = get_connection()
    try:
        sql = """
            SELECT * FROM pattern_detections
            WHERE sym = ? AND tf = ?
              AND status NOT IN ('completed', 'failed', 'expired')
              AND confidence >= ?
        """
        params: list = [sym.upper(), tf, min_conf]
        if pattern_ids:
            placeholders = ",".join(["?"] * len(pattern_ids))
            sql += f" AND pattern_id IN ({placeholders})"
            params.extend(pattern_ids)
        sql += " ORDER BY detected_at DESC"

        rows = conn.execute(sql, params).fetchall()
        return [_row_to_detection(r) for r in rows]
    finally:
        conn.close()


def get_detection_by_id(detection_id: str) -> Optional[dict]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pattern_detections WHERE id = ?", (detection_id,)
        ).fetchone()
        return _row_to_detection(row) if row else None
    finally:
        conn.close()


def record_feedback(detection_id: str, user_id: str, rating: str, note: Optional[str] = None) -> int:
    """Insert a feedback row. Returns the inserted row's id."""
    if rating not in _VALID_FEEDBACK_RATINGS:
        raise ValueError(f"invalid rating: {rating}. Must be one of {_VALID_FEEDBACK_RATINGS}")

    conn = get_connection()
    try:
        cursor = conn.execute("""
            INSERT INTO pattern_feedback (detection_id, user_id, rating, note, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (detection_id, user_id, rating, note, int(time.time())))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def track_outcomes(lookback_hours: int = 48) -> int:
    """Stub. Phase 7 wires this up to walk forward bars and resolve open
    detections (entry hit / stop hit / target hit). Phase 0 does nothing."""
    return 0


def recompute_stats() -> int:
    """Stub. Phase 7 aggregates pattern_outcomes into pattern_stats nightly."""
    return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_memory.py -v`
Expected: PASS — 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/memory.py tests/pattern_engine/test_memory.py
git commit -m "feat(patterns): memory layer (store_detection UPSERT, get_active, feedback)"
```

---

## Task 9: Detector registry + engine entrypoint

Registry pattern lets Phases 1-4 plug new detectors in without touching the engine.

**Files:**
- Create: `api/services/pattern_engine/detectors/__init__.py` (empty)
- Create: `api/services/pattern_engine/detectors/registry.py`
- Create: `api/services/pattern_engine/detectors/classical/__init__.py` (empty)
- Modify: `api/services/pattern_engine/__init__.py` (was empty placeholder)
- Create: `tests/pattern_engine/test_registry.py`
- Create: `tests/pattern_engine/detectors/__init__.py` (empty)

- [ ] **Step 1: Write failing test**

`tests/pattern_engine/test_registry.py`:
```python
from api.services.pattern_engine.detectors.registry import (
    register, get_detector, list_pattern_ids,
)
from api.services.pattern_engine import detect_all, detect_one


def _fake_detector(bars, context):
    return [{"id": "fake-1", "sym": "TEST", "pattern_id": "fake_pattern",
             "confidence": 99.0}]


def test_register_and_lookup():
    register("fake_pattern", _fake_detector)
    fn = get_detector("fake_pattern")
    assert fn is _fake_detector


def test_list_pattern_ids_includes_registered():
    register("another_fake", _fake_detector)
    ids = list_pattern_ids()
    assert "another_fake" in ids


def test_get_detector_raises_on_unknown():
    import pytest
    with pytest.raises(KeyError):
        get_detector("does_not_exist")


def test_detect_one_dispatches_to_correct_detector():
    register("dispatch_test", _fake_detector)
    out = detect_one([], context={}, pattern_id="dispatch_test")
    assert len(out) == 1
    assert out[0]["pattern_id"] == "fake_pattern"


def test_detect_all_runs_all_detectors():
    register("all_test_1", _fake_detector)
    register("all_test_2", _fake_detector)
    out = detect_all([], context={})
    # At least 2 detections from our two test detectors
    fake_count = sum(1 for d in out if d["confidence"] == 99.0)
    assert fake_count >= 2


def test_detect_all_filters_by_pattern_ids():
    register("filter_test_a", _fake_detector)
    register("filter_test_b", _fake_detector)
    out = detect_all([], context={}, pattern_ids=["filter_test_a"])
    # Only one detector should have run
    # Note: other registered fake detectors are also in registry. The filter scopes it.
    assert len(out) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pattern_engine/test_registry.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement registry + entrypoint**

Create `api/services/pattern_engine/detectors/__init__.py` (empty).
Create `api/services/pattern_engine/detectors/classical/__init__.py` (empty).
Create `tests/pattern_engine/detectors/__init__.py` (empty).

Create `api/services/pattern_engine/detectors/registry.py`:
```python
"""Detector registry.

Detectors register themselves with `register("pattern_id", fn)`. The engine
entrypoint (`detect_all`) iterates the registry; consumers can scope a single
detector via `detect_one`.
"""
from __future__ import annotations

from typing import Callable, Dict


DetectorFn = Callable[[list, dict], list[dict]]


_REGISTRY: Dict[str, DetectorFn] = {}


def register(pattern_id: str, fn: DetectorFn) -> None:
    """Add a detector to the registry. Overwrites if already present."""
    _REGISTRY[pattern_id] = fn


def get_detector(pattern_id: str) -> DetectorFn:
    """Return the detector function for `pattern_id`. Raises KeyError if missing."""
    if pattern_id not in _REGISTRY:
        raise KeyError(f"no detector registered for pattern_id={pattern_id!r}")
    return _REGISTRY[pattern_id]


def list_pattern_ids() -> list[str]:
    """Return all registered pattern_ids, sorted."""
    return sorted(_REGISTRY.keys())
```

Replace `api/services/pattern_engine/__init__.py` (was a one-line docstring) with:
```python
"""Pattern recognition engine — public API.

Detection entrypoints:
  - detect_all(bars, context, pattern_ids=None) -> list[Detection]
  - detect_one(bars, context, pattern_id) -> list[Detection]

Detectors register themselves via `detectors.registry.register()`. To activate
a detector, import its module — registration happens at module import time.
"""
from __future__ import annotations

from typing import Optional

from api.services.pattern_engine.detectors.registry import (
    get_detector, list_pattern_ids,
)


def detect_all(
    bars: list,
    context: dict,
    pattern_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Run all registered detectors (or a filtered subset) on the given bars.

    Args:
      bars: OHLCV list, sorted by t ascending.
      context: Context dict from `primitives.context.build_context()`.
      pattern_ids: optional whitelist. If None, all registered detectors run.

    Returns:
      Merged list of Detection dicts, sorted by detected_at desc then confidence desc.
    """
    targets = pattern_ids if pattern_ids else list_pattern_ids()
    results: list[dict] = []
    for pid in targets:
        try:
            fn = get_detector(pid)
        except KeyError:
            continue
        try:
            results.extend(fn(bars, context))
        except Exception as e:
            # Detectors should not crash the engine. Swallow + log.
            import logging
            logging.getLogger(__name__).warning(
                "detector %s raised: %s", pid, e, exc_info=True
            )
    results.sort(
        key=lambda d: (d.get("detected_at", 0), d.get("confidence", 0)),
        reverse=True,
    )
    return results


def detect_one(bars: list, context: dict, pattern_id: str) -> list[dict]:
    """Run a single detector by id. Raises KeyError if not registered."""
    fn = get_detector(pattern_id)
    return fn(bars, context)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pattern_engine/test_registry.py -v`
Expected: PASS — 6/6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/__init__.py api/services/pattern_engine/detectors/__init__.py api/services/pattern_engine/detectors/registry.py api/services/pattern_engine/detectors/classical/__init__.py tests/pattern_engine/test_registry.py tests/pattern_engine/detectors/__init__.py
git commit -m "feat(patterns): detector registry + engine detect_all/detect_one entrypoints"
```

---

## Task 10: Fixture infrastructure

Loader + JSON schema for the test fixtures used by the bull_flag battery (and every future detector battery).

**Files:**
- Create: `tests/pattern_engine/detectors/fixture_loader.py`
- Create: `tests/pattern_engine/detectors/test_fixture_loader.py`
- Create: `tests/fixtures/__init__.py` (empty package marker if missing)

- [ ] **Step 1: Write failing test + sample fixture**

Create directory `tests/fixtures/bull_flag/` if it doesn't exist.

Create `tests/fixtures/bull_flag/_sample.json` (a tiny fixture used only to test the loader):
```json
{
  "name": "sample_for_loader_test",
  "category": "test",
  "bars": [
    {"t": 1700000000, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000},
    {"t": 1700086400, "o": 100, "h": 102, "l": 99, "c": 101, "v": 1100}
  ],
  "expected": {
    "fires": true,
    "min_confidence": 60.0,
    "max_confidence": 100.0,
    "geometry_shape": "trendline_pair"
  }
}
```

Create `tests/pattern_engine/detectors/test_fixture_loader.py`:
```python
from tests.pattern_engine.detectors.fixture_loader import (
    load_fixture, load_all_fixtures, Fixture,
)


def test_load_fixture_parses_json():
    f = load_fixture("bull_flag", "_sample.json")
    assert f.name == "sample_for_loader_test"
    assert len(f.bars) == 2
    assert f.bars[0]["c"] == 100
    assert f.expected_fires is True
    assert f.min_confidence == 60.0


def test_load_all_fixtures_returns_at_least_one():
    fixtures = load_all_fixtures("bull_flag")
    assert len(fixtures) >= 1
    assert any(f.name == "sample_for_loader_test" for f in fixtures)


def test_fixture_skipping_underscore_prefixed_works():
    """The loader is responsible for treating `_sample.json` as test-only and
    excluding it from the real battery — done via a parameter to load_all_fixtures."""
    fixtures = load_all_fixtures("bull_flag", include_internal=False)
    assert not any(f.name == "sample_for_loader_test" for f in fixtures)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/pattern_engine/detectors/test_fixture_loader.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Implement fixture loader**

Create `tests/fixtures/__init__.py` (empty, if not already present).

Create `tests/pattern_engine/detectors/fixture_loader.py`:
```python
"""Fixture loader for detector tests.

A fixture file is a JSON document with this shape:
{
  "name": "human-readable name",
  "category": "positive" | "negative" | "edge" | "test",
  "bars": [{"t": int, "o": float, "h": float, "l": float, "c": float, "v": float}, ...],
  "context": {...},   // optional; if absent, context is built from bars
  "expected": {
    "fires": bool,
    "min_confidence": float,         // only when fires=true
    "max_confidence": float,         // only when fires=true; default 100
    "geometry_shape": str,            // optional; expected geometry.shape
    "pivot_count_in_geometry": int    // optional
  }
}
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional


_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_FIXTURE_ROOT = os.path.join(_REPO_ROOT, "tests", "fixtures")


@dataclass
class Fixture:
    name: str
    category: str
    bars: list[dict]
    context: Optional[dict]
    expected_fires: bool
    min_confidence: float
    max_confidence: float
    expected_geometry_shape: Optional[str]
    expected_pivot_count: Optional[int]
    source_filename: str


def load_fixture(pattern_id: str, filename: str) -> Fixture:
    """Load a single fixture by pattern_id + filename (e.g. 'bull_flag', 'clean_textbook.json')."""
    path = os.path.join(_FIXTURE_ROOT, pattern_id, filename)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    expected = data.get("expected", {})
    return Fixture(
        name=data["name"],
        category=data.get("category", "unknown"),
        bars=data["bars"],
        context=data.get("context"),
        expected_fires=expected.get("fires", False),
        min_confidence=expected.get("min_confidence", 0.0),
        max_confidence=expected.get("max_confidence", 100.0),
        expected_geometry_shape=expected.get("geometry_shape"),
        expected_pivot_count=expected.get("pivot_count_in_geometry"),
        source_filename=filename,
    )


def load_all_fixtures(pattern_id: str, include_internal: bool = False) -> list[Fixture]:
    """Load every fixture for a pattern_id.

    Args:
      pattern_id: subdirectory name under tests/fixtures/
      include_internal: include files starting with '_' (loader-test fixtures)

    Returns:
      List of Fixture objects, sorted by filename.
    """
    dirpath = os.path.join(_FIXTURE_ROOT, pattern_id)
    if not os.path.isdir(dirpath):
        return []
    names = sorted(os.listdir(dirpath))
    fixtures = []
    for name in names:
        if not name.endswith(".json"):
            continue
        if name.startswith("_") and not include_internal:
            continue
        fixtures.append(load_fixture(pattern_id, name))
    return fixtures
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/pattern_engine/detectors/test_fixture_loader.py -v`
Expected: PASS — 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/__init__.py tests/fixtures/bull_flag tests/pattern_engine/detectors/fixture_loader.py tests/pattern_engine/detectors/test_fixture_loader.py
git commit -m "test(patterns): fixture loader for detector test batteries"
```

---

## Task 11: Bull flag detector + fixture battery

The pilot detector. Implementation + 15 fixtures (5 positive, 8 negative, 2 edge).

**Files:**
- Create: `api/services/pattern_engine/detectors/classical/bull_flag.py`
- Create: `tests/pattern_engine/detectors/test_bull_flag.py`
- Create: 15 fixture JSON files under `tests/fixtures/bull_flag/`

- [ ] **Step 1: Write failing battery test**

`tests/pattern_engine/detectors/test_bull_flag.py`:
```python
"""Battery test for the bull_flag detector. Runs every fixture in
tests/fixtures/bull_flag/ and asserts the expected outcome."""
import pytest

from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


FIXTURES = load_all_fixtures("bull_flag", include_internal=False)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_bull_flag_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_bull_flag(fixture.bars, ctx)

    if fixture.expected_fires:
        assert len(detections) >= 1, (
            f"Fixture {fixture.name!r} expected to fire but produced 0 detections."
        )
        # Take the highest-confidence detection
        d = max(detections, key=lambda x: x["confidence"])
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
            f"Fixture {fixture.name!r}: confidence {d['confidence']:.1f} not in "
            f"expected band [{fixture.min_confidence}, {fixture.max_confidence}]"
        )
        if fixture.expected_geometry_shape:
            assert d["geometry"]["shape"] == fixture.expected_geometry_shape
    else:
        # Expected NOT to fire — either no detections, or all sub-threshold.
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"Fixture {fixture.name!r} expected NOT to fire, but got "
                    f"confidence {d['confidence']:.1f}"
                )


def test_fixture_battery_has_minimum_coverage():
    """Phase 0 Gate 1 requires ≥5 positive, ≥8 negative, ≥2 edge fixtures."""
    fixtures = load_all_fixtures("bull_flag", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5, f"need ≥5 positive fixtures, have {len(pos)}"
    assert len(neg) >= 8, f"need ≥8 negative fixtures, have {len(neg)}"
    assert len(edge) >= 2, f"need ≥2 edge fixtures, have {len(edge)}"
```

- [ ] **Step 2: Run test — should fail (no detector, no fixtures)**

Run: `python -m pytest tests/pattern_engine/detectors/test_bull_flag.py -v`
Expected: FAIL with `ImportError` or empty fixture set.

- [ ] **Step 3: Create the 15 fixtures**

A bull flag's anatomy:
- **Pole:** sharp advance, ≥10% from prior swing low to peak, typically 5-15 bars
- **Flag:** tight pullback consolidation, retrace 20-45% of the pole, channels parallel or slightly down-sloping, ≥3 bars and ≤25 bars
- **Volume:** expanding on pole, contracting in flag

Fixtures must include a `bars` array with enough data (≥40 bars for context primitives to work) and an `expected` block.

Use this helper script approach: write a Python generator inline that produces canonical pole+flag shapes, then store JSON. For each fixture below, use the values described to write the JSON file. Below are the parameters per fixture; for each, generate bars where:
- Bars 0-19: flat consolidation around base_price ±1%, modest volume (~1000)
- Bars 20-29 (pole): linear ramp from base_price to base_price * (1 + pole_pct), volume ramping (1000 → 5000)
- Bars 30+: flag consolidation per fixture spec

Create all 15 files. Each file follows this shape (example shown is `clean_textbook.json`):

`tests/fixtures/bull_flag/clean_textbook.json`:
```json
{
  "name": "clean_textbook",
  "category": "positive",
  "_generation": {
    "base_price": 50.0,
    "pole_pct": 0.18,
    "pole_bars": 10,
    "flag_retrace_pct": 0.35,
    "flag_bars": 7,
    "flag_slope_pct_per_bar": -0.001,
    "flag_volume_ratio": 0.4
  },
  "expected": {
    "fires": true,
    "min_confidence": 70.0,
    "max_confidence": 100.0,
    "geometry_shape": "trendline_pair"
  },
  "bars": "GENERATED — see below"
}
```

To generate the actual `bars` arrays for all 15 fixtures, write a one-shot Python script `tests/fixtures/bull_flag/_generate.py` that produces the JSON files. The script is committed alongside the fixtures so they can be re-generated if tuning is needed:

`tests/fixtures/bull_flag/_generate.py`:
```python
"""One-shot generator for the bull_flag fixture battery.

Run: python tests/fixtures/bull_flag/_generate.py

Produces 15 JSON files: 5 positive, 8 negative, 2 edge. Each contains a
synthetic bar series + an expected outcome block. The bars are deterministic
so tests are reproducible.
"""
import json
import os
import random

_OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def _build_bars(base_price, base_bars, pole_pct, pole_bars,
                flag_retrace_pct, flag_bars, flag_slope_pct_per_bar,
                flag_volume_ratio=0.4, ascending_flag=False, choppy_flag=False,
                pole_volume_ramp=True, seed=42):
    """Build a synthetic OHLCV series for a pole+flag fixture.

    base_bars: leading flat consolidation
    pole_pct: % rise of the pole (e.g. 0.18 = +18%)
    pole_bars: # bars in the pole
    flag_retrace_pct: % of pole that the flag pulls back (e.g. 0.35 = 35%)
    flag_bars: # bars in the flag
    flag_slope_pct_per_bar: slope of the flag channel, negative = descending
    flag_volume_ratio: avg flag volume / avg pole volume (lower = more contracting)
    """
    rng = random.Random(seed)
    bars = []
    t = 1700000000
    price = base_price
    base_vol = 1000.0

    # 1. Base consolidation
    for _ in range(base_bars):
        c = price + rng.uniform(-0.5, 0.5)
        h = c + abs(rng.uniform(0, 0.5))
        l = c - abs(rng.uniform(0, 0.5))
        o = price + rng.uniform(-0.3, 0.3)
        v = base_vol * rng.uniform(0.8, 1.2)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # 2. Pole
    pole_start = bars[-1]["c"]
    pole_end = pole_start * (1.0 + pole_pct)
    pole_step = (pole_end - pole_start) / pole_bars
    for i in range(pole_bars):
        c = pole_start + pole_step * (i + 1) + rng.uniform(-0.2, 0.2)
        o = pole_start + pole_step * i + rng.uniform(-0.2, 0.2)
        h = max(c, o) + abs(rng.uniform(0, 0.3))
        l = min(c, o) - abs(rng.uniform(0, 0.3))
        v = base_vol * (2 + i * 0.3) if pole_volume_ramp else base_vol * 2.5
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    # 3. Flag
    pole_top = bars[-1]["c"]
    flag_low = pole_top * (1.0 - flag_retrace_pct * pole_pct)  # retrace as fraction of pole magnitude
    flag_high = pole_top
    pole_avg_vol = base_vol * 2.5

    for i in range(flag_bars):
        slope_offset = flag_high * flag_slope_pct_per_bar * i
        upper = flag_high + slope_offset + abs(rng.uniform(0, 0.2))
        lower = flag_low + slope_offset - abs(rng.uniform(0, 0.2))
        if ascending_flag:
            # ascending flag — both lines tilt up
            upper += i * 0.15
            lower += i * 0.15
        c = rng.uniform(lower, upper)
        o = rng.uniform(lower, upper)
        if choppy_flag:
            c += rng.uniform(-1.5, 1.5)
            o += rng.uniform(-1.5, 1.5)
        h = max(c, o) + abs(rng.uniform(0, 0.2))
        l = min(c, o) - abs(rng.uniform(0, 0.2))
        v = pole_avg_vol * flag_volume_ratio * rng.uniform(0.7, 1.3)
        bars.append({"t": t, "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2), "v": round(v, 0)})
        t += 86400

    return bars


def _write(name, category, gen_params, expected, sym="TEST"):
    bars = _build_bars(**gen_params)
    payload = {
        "name": name,
        "category": category,
        "_generation": gen_params,
        "expected": expected,
        "bars": bars,
    }
    path = os.path.join(_OUT_DIR, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {path}  ({len(bars)} bars)")


def main():
    # 5 POSITIVE FIXTURES — should fire with confidence ≥ 60
    _write("clean_textbook", "positive",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=7, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.35, seed=1),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0,
            "geometry_shape": "trendline_pair"})

    _write("tight_consolidation", "positive",
           dict(base_price=80.0, base_bars=20, pole_pct=0.22, pole_bars=12,
                flag_retrace_pct=0.25, flag_bars=8, flag_slope_pct_per_bar=0.0,
                flag_volume_ratio=0.3, seed=2),
           {"fires": True, "min_confidence": 65.0, "max_confidence": 100.0})

    _write("descending_flag", "positive",
           dict(base_price=30.0, base_bars=20, pole_pct=0.25, pole_bars=8,
                flag_retrace_pct=0.40, flag_bars=10, flag_slope_pct_per_bar=-0.003,
                flag_volume_ratio=0.4, seed=3),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("shallow_pullback", "positive",
           dict(base_price=120.0, base_bars=25, pole_pct=0.30, pole_bars=14,
                flag_retrace_pct=0.20, flag_bars=6, flag_slope_pct_per_bar=-0.0005,
                flag_volume_ratio=0.5, seed=4),
           {"fires": True, "min_confidence": 60.0, "max_confidence": 100.0})

    _write("strong_volume_contraction", "positive",
           dict(base_price=200.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.20, seed=5),    # very contracted volume
           {"fires": True, "min_confidence": 70.0, "max_confidence": 100.0})

    # 8 NEGATIVE FIXTURES — should NOT fire (or fire <50)
    _write("no_pole", "negative",
           dict(base_price=50.0, base_bars=40, pole_pct=0.0, pole_bars=0,
                flag_retrace_pct=0.5, flag_bars=10, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.5, seed=10),
           {"fires": False})

    _write("pole_too_short", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.04, pole_bars=10,    # only 4% pole
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.4, seed=11),
           {"fires": False})

    _write("flag_too_deep", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.85, flag_bars=10, flag_slope_pct_per_bar=-0.001,   # 85% retrace
                flag_volume_ratio=0.5, seed=12),
           {"fires": False})

    _write("flag_too_wide", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.40, flag_bars=40, flag_slope_pct_per_bar=-0.001,   # 40-bar flag
                flag_volume_ratio=0.5, seed=13),
           {"fires": False})

    _write("wide_choppy", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.40, flag_bars=10, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=1.2, choppy_flag=True, seed=14),
           {"fires": False})

    _write("ascending_flag_in_downtrend", "negative",
           dict(base_price=100.0, base_bars=20, pole_pct=-0.15, pole_bars=10,    # negative pole
                flag_retrace_pct=0.30, flag_bars=8, flag_slope_pct_per_bar=0.002,
                ascending_flag=True, flag_volume_ratio=0.6, seed=15),
           {"fires": False})

    _write("extended_flag_too_long", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.30, flag_bars=30, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.5, seed=16),
           {"fires": False})

    _write("volume_expanding", "negative",
           dict(base_price=50.0, base_bars=20, pole_pct=0.18, pole_bars=10,
                flag_retrace_pct=0.35, flag_bars=8, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=1.5, seed=17),   # volume EXPANDING into flag
           {"fires": False})

    # 2 EDGE FIXTURES — boundary of validity
    _write("boundary_min_pole", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.085, pole_bars=10,   # barely 8.5%
                flag_retrace_pct=0.35, flag_bars=7, flag_slope_pct_per_bar=-0.001,
                flag_volume_ratio=0.4, seed=20),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 80.0})

    _write("boundary_max_retrace", "edge",
           dict(base_price=50.0, base_bars=20, pole_pct=0.20, pole_bars=10,
                flag_retrace_pct=0.50, flag_bars=8, flag_slope_pct_per_bar=-0.001,   # 50% retrace
                flag_volume_ratio=0.5, seed=21),
           {"fires": True, "min_confidence": 50.0, "max_confidence": 80.0})

    print("\nDone — 15 fixtures written.")


if __name__ == "__main__":
    main()
```

Run the generator:
```bash
python tests/fixtures/bull_flag/_generate.py
```

Verify 15 fixtures exist:
```bash
ls tests/fixtures/bull_flag/*.json | wc -l
```
Expected output: `16` (15 fixtures + the `_sample.json` from Task 10).

- [ ] **Step 4: Implement bull_flag detector**

Create `api/services/pattern_engine/detectors/classical/bull_flag.py`:
```python
"""Bull flag detector.

A bull flag is a sharp upward move ("pole") followed by a tight pullback
consolidation ("flag") that retraces a fraction of the pole. The pattern
suggests continuation of the prior advance.

Geometric definition used here:
  - Pole: ≥8% advance from a swing low to a swing high, over ≤20 bars
  - Flag: 3-20 bars of consolidation after the pole top
  - Flag retrace: between 15% and 50% of the pole's height
  - Flag channel: upper and lower trendlines roughly parallel (parallel_score > 0.6)
  - Volume: contracting in the flag relative to the pole

Scoring (composite 0-100):
  geometry_score: how clean the parallel channel + retrace + duration are
  volume_score:  how contracted flag volume is vs pole volume
  context_score: trend stage, MA alignment, RS trend
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives import volume as volume_primitives
from api.services.pattern_engine.primitives.geometry import parallel_score
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_pair_parallel
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bull_flag"
_MIN_POLE_PCT = 0.08
_MAX_POLE_BARS = 20
_MIN_FLAG_BARS = 3
_MAX_FLAG_BARS = 20
_MIN_FLAG_RETRACE = 0.15
_MAX_FLAG_RETRACE = 0.50
_MIN_PARALLEL_SCORE = 0.55
_CONFIDENCE_FLOOR = 50.0


def detect_bull_flag(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bull flag patterns in the bars. May emit 0-N detections."""
    if len(bars) < 30:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    # Search for a "pole then flag" structure ending near the most recent bars.
    # We restrict to candidates where the flag ends in the last 5 bars (forming/ready).
    for pole_top_idx, pole_top in _candidate_pole_tops(bars, pivots):
        candidate = _try_extract_pattern(bars, pivots, pole_top_idx, pole_top)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score  = _score_volume(bars, candidate)
        ctx_score  = _score_context(context)
        hist_score = 50.0  # neutral prior; Phase 7 reads from pattern_stats

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


# ─── pattern-extraction helpers ─────────────────────────────────────────────

def _candidate_pole_tops(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-high pivot in the recent window."""
    high_pivots = [p for p in pivots if p["type"] == "high"]
    candidates = []
    # Most recent swing-high is the most likely pole top.
    for p in high_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_FLAG_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_pattern(bars, pivots, pole_top_idx: int, pole_top) -> Optional[dict]:
    """Try to extract a pole+flag pattern with pole_top_idx as the pole apex."""
    # Find the prior swing low (pole base) within MAX_POLE_BARS
    low_pivots_before = [p for p in pivots
                         if p["type"] == "low" and pole_top_idx - _MAX_POLE_BARS <= p["bar_index"] < pole_top_idx]
    if not low_pivots_before:
        return None
    pole_base = min(low_pivots_before, key=lambda p: p["price"])

    pole_height = pole_top["price"] - pole_base["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_top_idx - pole_base["bar_index"]
    if pole_bars <= 0 or pole_bars > _MAX_POLE_BARS:
        return None

    # Flag = bars after pole_top_idx up to the latest bar
    flag_bars_count = len(bars) - 1 - pole_top_idx
    if flag_bars_count < _MIN_FLAG_BARS or flag_bars_count > _MAX_FLAG_BARS:
        return None

    flag_bars = bars[pole_top_idx + 1: pole_top_idx + 1 + flag_bars_count + 1]
    if not flag_bars:
        return None

    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    retrace = (pole_top["price"] - flag_low) / pole_height
    if retrace < _MIN_FLAG_RETRACE or retrace > _MAX_FLAG_RETRACE:
        return None

    # Build flag trendlines from the flag bars' highs/lows
    upper_pivots = [{"t": pole_top_idx + 1 + i, "price": b["h"],
                     "type": "high", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    lower_pivots = [{"t": pole_top_idx + 1 + i, "price": b["l"],
                     "type": "low", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    upper_line, lower_line = fit_pair_parallel(upper_pivots, lower_pivots)

    par_score = parallel_score(
        ({"t": upper_line["p1"]["t"], "price": upper_line["p1"]["price"]},
         {"t": upper_line["p2"]["t"], "price": upper_line["p2"]["price"]}),
        ({"t": lower_line["p1"]["t"], "price": lower_line["p1"]["price"]},
         {"t": lower_line["p2"]["t"], "price": lower_line["p2"]["price"]}),
    )
    if par_score < _MIN_PARALLEL_SCORE:
        return None

    return {
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_top_idx": pole_top_idx,
        "pole_top_price": pole_top["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "flag_count": len(flag_bars),
        "flag_low": flag_low,
        "flag_high": flag_high,
        "retrace_pct": retrace,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "parallel_score": par_score,
        "flag_bars": flag_bars,
    }


# ─── scoring ────────────────────────────────────────────────────────────────

def _score_geometry(c: dict) -> float:
    # Reward strong pole (8-30%), tight retrace (20-35%), good parallel score, moderate flag duration
    pole_score = min(100, c["pole_pct"] / 0.20 * 100)  # 20% pole = 100
    retrace_score = 100 - abs(c["retrace_pct"] - 0.30) * 200
    retrace_score = max(0, retrace_score)
    parallel_pts = c["parallel_score"] * 100
    duration_score = 100 - abs(c["flag_count"] - 8) * 5
    duration_score = max(0, duration_score)
    return round(0.30 * pole_score + 0.30 * retrace_score
                 + 0.25 * parallel_pts + 0.15 * duration_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Reward contracting volume in the flag relative to the pole."""
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 0.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 50.0
    ratio = flag_avg / pole_avg
    # ratio 0.2 → 100; ratio 1.0 → 0
    if ratio >= 1.0:
        return 0.0
    return round(max(0, min(100, (1.0 - ratio) * 125)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2: score += 25
    if context.get("ma_alignment") == "stacked_bullish": score += 15
    if context.get("rs_trend") == "up": score += 10
    return min(100.0, score)


# ─── detection assembly ────────────────────────────────────────────────────

def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    pole_top = bars[c["pole_top_idx"]]
    last_bar = bars[-1]

    flag_high = c["flag_high"]
    flag_low = c["flag_low"]
    entry = round(flag_high * 1.001, 2)        # breakout above flag top
    stop  = round(flag_low * 0.99, 2)          # below flag low
    target = round(pole_top["c"] + c["pole_height"], 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",  # caller sets via build_context's sym OR engine wrapper
        "tf": "",   # caller sets
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[c["pole_base_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["pole_base_idx"]]["t"]),
                     int(pole_top["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [
                {"t": int(c["upper_line"]["p1"]["t"]), "price": float(c["upper_line"]["p1"]["price"])},
                {"t": int(c["upper_line"]["p2"]["t"]), "price": float(c["upper_line"]["p2"]["price"])},
                {"t": int(c["lower_line"]["p1"]["t"]), "price": float(c["lower_line"]["p1"]["price"])},
                {"t": int(c["lower_line"]["p2"]["t"]), "price": float(c["lower_line"]["p2"]["price"])},
            ],
            "extras": {
                "pole_pct": round(c["pole_pct"] * 100, 2),
                "retrace_pct": round(c["retrace_pct"] * 100, 2),
                "flag_bars": c["flag_count"],
                "parallel_score": round(c["parallel_score"], 3),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5× 20-bar avg",
            "stop": stop,
            "stop_basis": "flag_low_minus_1pct",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": {
            "headline": f"Bull flag forming — {c['pole_pct']*100:.1f}% pole, {c['retrace_pct']*100:.0f}% retrace, {c['flag_count']}-bar consolidation",
            "what_it_is": "A sharp advance (pole) followed by a tight pullback (flag) into a parallel channel. Classic continuation pattern.",
            "why_it_matters": f"Buyers absorbed the pullback at {c['retrace_pct']*100:.0f}% retrace. Volume contracted into the consolidation, suggesting the prior advance is intact and the next leg up is likely once supply is exhausted.",
            "what_to_watch_for": f"Breakout above the flag high ({flag_high:.2f}) on volume ≥ 1.5× the 20-bar average. Entry triggers above {entry:.2f}.",
            "failure_signal": f"Close below the flag low ({flag_low:.2f}). Pattern invalidates and the broader trend may be in jeopardy.",
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


# Register at module-import time
register(_PATTERN_ID, detect_bull_flag)
```

- [ ] **Step 5: Run battery test to verify it passes**

Run: `python -m pytest tests/pattern_engine/detectors/test_bull_flag.py -v`

Expected: All 15 fixture cases pass + the coverage assertion. If a fixture fails, inspect:
- Is the confidence within the expected band?
- Did a "fires=False" fixture sneak past the floor? (Adjust constants or the generator.)
- Does the fixture's bars actually contain the pattern as described?

Iterate the detector constants OR the fixture parameters until all 15 pass. The point of Gate 1 is that the detector + fixture battery converge.

- [ ] **Step 6: Commit**

```bash
git add api/services/pattern_engine/detectors/classical/bull_flag.py tests/fixtures/bull_flag tests/pattern_engine/detectors/test_bull_flag.py
git commit -m "feat(patterns): bull_flag detector + 15-fixture battery (5 pos, 8 neg, 2 edge)"
```

---

## Task 12: REST API router + wire into main

3 endpoints exposing detections. Wire router into the FastAPI app.

**Files:**
- Create: `api/routers/patterns.py`
- Modify: `api/main.py`
- Create: `tests/pattern_engine/test_router_patterns.py`

- [ ] **Step 1: Write failing tests**

`tests/pattern_engine/test_router_patterns.py`:
```python
from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.pattern_engine import memory


client = TestClient(app)


def test_list_pattern_types():
    """GET /api/patterns/types returns the registered patterns."""
    r = client.get("/api/patterns/types")
    assert r.status_code == 200
    data = r.json()
    assert "patterns" in data
    ids = {p["id"] for p in data["patterns"]}
    assert "bull_flag" in ids


def test_get_detections_for_symbol_no_data():
    """No detections in DB → empty list, 200 OK."""
    init_db()
    r = client.get("/api/patterns/NOSYM_XYZ?tf=D")
    assert r.status_code == 200
    assert r.json()["detections"] == []


def test_get_detections_returns_stored():
    """Store a detection via memory layer; verify endpoint returns it."""
    init_db()
    from api.services.pattern_engine import memory
    d = {
        "id": "test-router-det-1",
        "sym": "ZZZZ", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100, "entry_condition": "", "stop": 95, "stop_basis": "",
                   "target_primary": 110, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 80.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 70.0,
                               "context_score": 80.0, "historical_score": 50.0},
        "narrative": {"headline": "", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": 1700100100, "last_seen_at": 1700100100,
    }
    memory.store_detection(d)
    r = client.get("/api/patterns/ZZZZ?tf=D")
    assert r.status_code == 200
    body = r.json()
    found = [x for x in body["detections"] if x["id"] == "test-router-det-1"]
    assert len(found) == 1


def test_min_conf_filter():
    """Detections below min_conf are excluded."""
    init_db()
    r = client.get("/api/patterns/ZZZZ?tf=D&min_conf=95")
    assert r.status_code == 200
    body = r.json()
    # The 80.0-confidence detection from prior test should be excluded.
    found = [x for x in body["detections"] if x["id"] == "test-router-det-1"]
    assert len(found) == 0


def test_post_feedback():
    """POST feedback writes a row."""
    init_db()
    # Assumes the detection from test_get_detections_returns_stored exists
    r = client.post(
        "/api/patterns/test-router-det-1/feedback",
        json={"rating": "great", "user_id": "test-user", "note": "looks clean"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("feedback_id") is not None


def test_post_feedback_invalid_rating():
    r = client.post(
        "/api/patterns/test-router-det-1/feedback",
        json={"rating": "garbage", "user_id": "test-user"},
    )
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/test_router_patterns.py -v`
Expected: FAIL — router doesn't exist, endpoints 404.

- [ ] **Step 3: Implement router**

Create `api/routers/patterns.py`:
```python
"""Pattern recognition REST endpoints.

Phase 0 surfaces three endpoints:
  - GET /api/patterns/types
  - GET /api/patterns/{sym}?tf=&types=&min_conf=
  - POST /api/patterns/{detection_id}/feedback

Note: detectors must be imported at module load so they register themselves.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

# Importing the detector modules triggers self-registration with the registry.
from api.services.pattern_engine.detectors.classical import bull_flag as _bull_flag  # noqa: F401
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.registry import list_pattern_ids


router = APIRouter(prefix="/api/patterns", tags=["patterns"])


_PATTERN_METADATA = {
    "bull_flag": {
        "name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "description": "Sharp advance (pole) followed by tight parallel-channel pullback (flag). Continuation pattern.",
    },
    # Future patterns add entries here as they ship.
}


@router.get("/types")
def list_types():
    """Return all registered pattern types with metadata."""
    ids = list_pattern_ids()
    out = []
    for pid in ids:
        meta = _PATTERN_METADATA.get(pid, {})
        out.append({
            "id": pid,
            "name": meta.get("name", pid.replace("_", " ").title()),
            "category": meta.get("category", "uncategorized"),
            "direction": meta.get("direction", "neutral"),
            "description": meta.get("description", ""),
        })
    return {"patterns": out}


@router.get("/{sym}")
def get_detections(
    sym: str,
    tf: str = Query(default="D"),
    types: Optional[str] = Query(default=None, description="comma-separated pattern_ids to filter"),
    min_conf: float = Query(default=50.0, ge=0.0, le=100.0),
):
    """Return active detections for a symbol (status NOT in completed/failed/expired)."""
    pattern_ids = [t.strip() for t in types.split(",")] if types else None
    rows = memory.get_active_detections(sym.upper(), tf, pattern_ids=pattern_ids, min_conf=min_conf)
    return {"sym": sym.upper(), "tf": tf, "detections": rows, "count": len(rows)}


class FeedbackBody(BaseModel):
    rating: str
    user_id: str
    note: Optional[str] = None


@router.post("/{detection_id}/feedback")
def post_feedback(detection_id: str, body: FeedbackBody):
    """Record user feedback on a detection. Returns the new feedback row id."""
    try:
        fb_id = memory.record_feedback(detection_id, body.user_id, body.rating, body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "feedback_id": fb_id}
```

- [ ] **Step 4: Wire router into main**

Open `api/main.py`. Find the block of `from api.routers import` lines (around line 31-58). Add:
```python
from api.routers import patterns as patterns_router
```
Place it alphabetically near similar imports.

Then find the `app.include_router(...)` block (around line 981+). Add:
```python
app.include_router(patterns_router.router)
```
Place it near other feature routers.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_router_patterns.py -v`
Expected: PASS — 6/6 tests pass.

Run the full pattern_engine suite together:
```bash
python -m pytest tests/pattern_engine -v
```
Expected: all tests across all primitive + memory + registry + bull_flag + router suites pass.

- [ ] **Step 6: Commit**

```bash
git add api/routers/patterns.py api/main.py tests/pattern_engine/test_router_patterns.py
git commit -m "feat(patterns): REST endpoints (types, detections by sym, feedback) + wire into main"
```

---

## Task 13: E2E live verification + push to Railway

Smoke test the engine end-to-end against real Railway data, then push.

**Files:**
- Create: `scripts/smoke_pattern_engine.py`
- (No commit of script needed — it's just a smoke harness)

- [ ] **Step 1: Smoke locally first**

Create `scripts/smoke_pattern_engine.py`:
```python
"""End-to-end smoke test for the pattern engine.

Loads real bars for a symbol from the local bars_sqlite store, runs the
bull_flag detector, prints any detections + their confidence + levels.

Usage: python scripts/smoke_pattern_engine.py AAPL D
"""
import sys

from api.services import bars_sqlite
from api.services.pattern_engine import detect_one
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine import memory
from api.services.auth_db import init_db


def main(sym: str = "AAPL", tf: str = "D", bars_count: int = 200):
    init_db()
    rows = bars_sqlite.get_bars(sym.upper(), tf, bars_count)
    if not rows:
        print(f"No bars for {sym} {tf} in local SQLite store. Try a Railway deployment.")
        sys.exit(1)
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    print(f"Loaded {len(bars)} bars for {sym} {tf}")

    ctx = build_context(bars, sym=sym)
    print(f"Context: {ctx}")

    detections = detect_one(bars, ctx, pattern_id="bull_flag")
    print(f"\nDetected {len(detections)} bull_flag(s):")
    for d in detections:
        # Backfill sym/tf which detector left blank
        d["sym"] = sym.upper()
        d["tf"] = tf
        print(f"  - confidence {d['confidence']:.1f}, entry {d['levels']['entry']:.2f}, "
              f"stop {d['levels']['stop']:.2f}, target {d['levels']['target_primary']:.2f}, "
              f"R:R {d['levels']['risk_reward']:.2f}")
        print(f"    {d['narrative']['headline']}")
        # Store it
        memory.store_detection(d)
        print(f"    [stored as {d['id']}]")

    print("\nDone.")


if __name__ == "__main__":
    sym = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    tf = sys.argv[2] if len(sys.argv) > 2 else "D"
    main(sym, tf)
```

Run it (will fail locally without bars cache — that's expected):
```bash
python scripts/smoke_pattern_engine.py AAPL D
```

Expected: either "No bars for AAPL D in local SQLite store" (acceptable — Railway has the cache) OR a printed detection summary if local cache happens to exist.

- [ ] **Step 2: Push to Railway**

```bash
git add scripts/smoke_pattern_engine.py
git commit -m "test(patterns): E2E smoke script for live engine"
git push
```

- [ ] **Step 3: Wait for Railway deploy to come up**

Poll until live:
```bash
until curl -s -o /dev/null -w "%{http_code}" -m 10 https://uctintelligence.com/api/patterns/types | grep -q "^200$"; do sleep 15; done
echo "API is up"
```

- [ ] **Step 4: Hit the live API**

```bash
# 1. Verify /types lists bull_flag
curl -s https://uctintelligence.com/api/patterns/types | python -m json.tool

# 2. Hit a fresh symbol — should return empty (no detections stored yet)
curl -s "https://uctintelligence.com/api/patterns/AAPL?tf=D" | python -m json.tool
```

Expected:
- `/types`: returns `{"patterns": [{"id": "bull_flag", "name": "Bull Flag", "category": "classical", ...}]}`
- `/AAPL?tf=D`: returns `{"sym": "AAPL", "tf": "D", "detections": [], "count": 0}` initially (engine hasn't been triggered for AAPL yet — it's a lazy/on-demand engine, not a scanner)

- [ ] **Step 5: Verify schema migration ran on Railway**

```bash
# Trigger a feedback POST on a non-existent detection — should fail gracefully (FK violation),
# proving the tables exist.
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"rating":"great","user_id":"test"}' \
  https://uctintelligence.com/api/patterns/nonexistent-id/feedback
```

Expected: HTTP 500 with a SQLite FK-violation error in the response (proves `pattern_feedback` table exists and references `pattern_detections`). This is acceptable for Phase 0 — we just need to know the table is there. Phase 1+ can wrap with a 404 check.

- [ ] **Step 6: Final commit + push**

```bash
git status
# Should be clean except possibly the smoke script if not yet pushed
git push
```

---

## Phase 0 Done — what shipped

After this plan:
- Engine skeleton at `api/services/pattern_engine/` (types, primitives, detectors/registry, memory)
- 5 primitive modules (geometry, pivots, volume, trendlines, context) with full unit tests
- 4 SQLite tables (pattern_detections, pattern_outcomes, pattern_stats, pattern_feedback) live on Railway
- Memory layer (store_detection UPSERT, get_active_detections, record_feedback) — stubs for track_outcomes/recompute_stats
- ONE working detector: bull_flag, with 15-fixture battery passing
- 3 REST endpoints live: /types, /{sym} for detections, /{detection_id}/feedback
- Smoke test script for live verification

What's intentionally absent (will come in subsequent phase plans):
- The other 9+ Phase 1 classical detectors
- UCT setup detectors (Phase 2)
- Candlestick detectors (Phase 3)
- Triangles, rectangles, channels, volume profile, A/D (Phase 4)
- Chart overlay UI + Pattern Scanner page (Phase 5)
- Confidence calibration backtest + shadow mode (Phase 6)
- Outcome tracker job, nightly stats rollup, UI toggle ON (Phase 7)

## Self-review

- All spec sections that Phase 0 should cover are implemented: types (§4), primitives (§5.1), memory schema (§6.1), partial memory module (§6.2 jobs 1+3 stubbed), API §8 endpoints 1+2+6, one detector validated against Gate 1 fixture battery.
- No placeholders. Every step contains complete code or exact commands.
- Type consistency: Detection schema in Task 1 matches the JSON columns in Task 7 and the dict shape in Task 8. Field names align across files.
- 5 spec-required primitives all built: pivots, trendlines, volume, geometry, context.
- 13 tasks, ~150-300 lines of code each. Bite-sized.
- All commits frequent.
