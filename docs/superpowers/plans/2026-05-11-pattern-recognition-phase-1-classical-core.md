# Pattern Recognition — Phase 1 (Classical Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 classical chart pattern detectors to the engine, following the bull_flag template. Each detector ships with its own 15-fixture battery (5 positive, 8 negative, 2 edge). At the end, `verify_phase.py 1` reports PASS across all 9 checks with **11 detectors** registered (bull_flag + 10 new).

**Architecture:** Each new detector follows the `bull_flag` pattern exactly:
- Pure function `(bars, context) -> list[Detection]` at `api/services/pattern_engine/detectors/classical/{name}.py`
- Module-level `register(_PATTERN_ID, detect_fn)` for self-registration
- Composite confidence: `0.40 * geometry + 0.25 * volume + 0.20 * context + 0.15 * historical`
- Hard floor at confidence < 50
- 15-fixture battery in `tests/fixtures/{name}/` + `_generate.py` deterministic generator
- `tests/pattern_engine/detectors/test_{name}.py` parametrized over fixtures + coverage check

Each detector also registers in `api/routers/patterns.py` `_PATTERN_METADATA` for the `/types` endpoint.

**Tech Stack:** Same as Phase 0 — Python, the existing primitives (`pivots`, `trendlines`, `volume`, `geometry`, `context`).

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Section 3.1 (catalog) + Section 5 (methodology).

**Phase 0 template reference:** `api/services/pattern_engine/detectors/classical/bull_flag.py` + `tests/fixtures/bull_flag/_generate.py` + `tests/pattern_engine/detectors/test_bull_flag.py`.

---

## Detector geometric definitions

Each detector below lists its core geometric rules. The implementer uses these to write the detection logic + fixture generator parameters. Confidence scoring follows the same composite formula as bull_flag.

### 1. `bear_flag` (direction: bearish)
- **Pole:** ≥8% DECLINE from a swing high to a swing low, over ≤20 bars
- **Flag:** 3-20 bar consolidation after the pole bottom
- **Flag retrace:** 15-50% of the pole height, slightly UP-sloping or horizontal channel
- **Channel:** upper + lower trendlines roughly parallel (channel_width_parallel_score ≥ 0.55)
- **Volume:** contracting in the flag
- **Entry:** breakdown below flag low
- **Stop:** above flag high
- **Target:** flag bottom - pole height
- **Direction:** `"bearish"`

### 2. `pennant` (direction: bullish OR bearish, parameterized)
- **Pole:** ≥8% advance OR decline over ≤20 bars
- **Pennant:** 3-20 bar consolidation with CONVERGING trendlines (NOT parallel)
- **Geometry test:** upper line slopes down, lower line slopes up, lines converge toward an apex
- **Apex constraint:** projected intersection within 1-30 bars ahead of current bar
- **Volume:** contracting
- **Entry/stop/target:** same logic as flag but use pennant top/bottom anchors
- **Two variants** in one detector: bullish_pennant (pole up) + bearish_pennant (pole down). Emit as `pennant` with `direction` set per detection.

### 3. `falling_wedge` (direction: bullish — reversal/continuation)
- **Window:** 20-60 bars of price action
- **Geometry:** both upper and lower trendlines slope DOWN, but lower slopes less steeply (converging downward)
- **Touches:** ≥2 touches on each line
- **Depth:** 10-40% from start high to end low
- **Volume:** contracting through the wedge
- **Entry:** breakout above upper trendline
- **Stop:** below wedge low
- **Target:** start of wedge high + (wedge depth)

### 4. `rising_wedge` (direction: bearish — reversal)
- **Mirror of falling_wedge:** both lines slope UP, upper slopes less steeply (converging upward)
- **Geometric mirror** of falling_wedge logic.
- **Entry:** breakdown below lower trendline
- **Stop:** above wedge high
- **Target:** start of wedge low - (wedge depth)

### 5. `head_shoulders` (direction: bearish)
- **Window:** 30-100 bars
- **Three peaks:** left shoulder, head (highest), right shoulder
- **Geometry:**
  - Left shoulder peak < head peak
  - Right shoulder peak < head peak
  - |left shoulder - right shoulder| / head < 0.15 (rough symmetry)
  - Neckline: line connecting the two troughs between peaks (roughly horizontal or slight slope)
- **Volume:** declining through the pattern (esp. lower on right shoulder)
- **Entry:** breakdown below neckline
- **Stop:** above right shoulder
- **Target:** neckline - (head_peak - neckline)

### 6. `inverse_head_shoulders` (direction: bullish)
- **Mirror of head_shoulders:** three TROUGHS (left shoulder, head, right shoulder), head is lowest
- **Same symmetry rules** flipped to lows
- **Entry:** breakout above neckline
- **Stop:** below right shoulder
- **Target:** neckline + (neckline - head_trough)

### 7. `double_top` (direction: bearish)
- **Window:** 20-80 bars
- **Two peaks:** first peak, retrace (trough), second peak ≈ first peak
- **Peak similarity:** |peak1 - peak2| / peak1 < 0.04 (within 4%)
- **Retrace depth:** 5-25% between peaks
- **Volume:** declining on second peak
- **Entry:** breakdown below retrace trough
- **Stop:** above second peak
- **Target:** retrace trough - (peak - retrace trough)

### 8. `double_bottom` (direction: bullish)
- **Mirror of double_top:** two TROUGHS with a rally between
- **Entry:** breakout above rally peak
- **Stop:** below second trough
- **Target:** rally peak + (rally peak - trough)

### 9. `cup_handle` (direction: bullish)
- **Window:** 30-120 bars (cup) + 5-25 bars (handle)
- **Cup:** rounded U-shape — left rim ≈ right rim within 5%, depth 12-50% from rim to bottom
- **Roundness test:** polynomial fit (degree 2) on cup section, residual sum < threshold
- **Handle:** small pullback after right rim, depth ≤ 50% of cup depth, ≤ 25 bars
- **Volume:** contracting through cup + handle
- **Entry:** breakout above right rim (or handle high)
- **Stop:** below handle low
- **Target:** right rim + cup depth

### 10. `inverse_cup_handle` (direction: bearish)
- **Mirror of cup_handle:** inverted U + small upward consolidation
- **Cup is convex** (peaks rather than bottoms), depth 12-50% from rim to peak
- **Entry:** breakdown below right rim (or handle low)
- **Stop:** above handle high
- **Target:** right rim - cup depth

---

## Per-task template

Each of Tasks 1-10 follows this template:

### Task N: `{detector_name}`

**Files:**
- Create: `api/services/pattern_engine/detectors/classical/{name}.py`
- Create: `tests/fixtures/{name}/_generate.py`
- Create: 15 fixture JSON files under `tests/fixtures/{name}/`
- Create: `tests/pattern_engine/detectors/test_{name}.py`
- Modify: `api/routers/patterns.py` (add to `_PATTERN_METADATA` + import the detector module)

**Steps:**

- [ ] **Step 1: Write the battery test**

Use the bull_flag battery test as template (`tests/pattern_engine/detectors/test_bull_flag.py`). Substitute `{name}` for `bull_flag` in imports, fixture loader call, and test name. The structural shape is identical:

```python
"""Battery test for the {name} detector."""
import pytest
from api.services.pattern_engine.detectors.classical.{name} import detect_{name}
from api.services.pattern_engine.primitives.context import build_context
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

FIXTURES = load_all_fixtures("{name}", include_internal=False)

@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_{name}_fixture(fixture):
    ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
    detections = detect_{name}(fixture.bars, ctx)
    if fixture.expected_fires:
        assert len(detections) >= 1
        d = max(detections, key=lambda x: x["confidence"])
        assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence
    else:
        if detections:
            for d in detections:
                assert d["confidence"] < 50.0


def test_{name}_battery_has_minimum_coverage():
    fixtures = load_all_fixtures("{name}", include_internal=False)
    pos = [f for f in fixtures if f.category == "positive"]
    neg = [f for f in fixtures if f.category == "negative"]
    edge = [f for f in fixtures if f.category == "edge"]
    assert len(pos) >= 5
    assert len(neg) >= 8
    assert len(edge) >= 2
```

- [ ] **Step 2: Implement the detector**

Use `api/services/pattern_engine/detectors/classical/bull_flag.py` as the template. Replace pole+flag extraction with the pattern-specific geometric extraction per the spec section above. Composite confidence formula stays the same. Hard floor at 50 stays the same. The `register(_PATTERN_ID, detect_fn)` line MUST be at module bottom.

Required imports (use only what the detector actually needs):
```python
from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline, fit_pair_parallel
from api.services.pattern_engine.primitives.geometry import channel_width_parallel_score, polynomial_fit
from api.services.pattern_engine.types import Bar, Detection
```

The `_build_detection()` helper assembles the Detection dict. Geometry shape varies per pattern:
- flags/wedges/pennants/channels → `"trendline_pair"`
- H&S, double top/bottom → `"neckline"` (anchors include neckline endpoints + shoulder/peak points)
- cup_handle → `"cup_curve"` (anchors include left rim, bottom, right rim, handle low/high)
- rectangle → `"rectangle"`

- [ ] **Step 3: Write the fixture generator**

Use `tests/fixtures/bull_flag/_generate.py` as the template. Write a `_build_bars(...)` function with pattern-specific parameters (e.g., `pole_pct`, `flag_retrace_pct` for flags; `left_shoulder_pct`, `head_pct`, `right_shoulder_pct`, `neckline_slope` for H&S; etc.).

Generate exactly 15 fixtures with these categories + counts:
- **5 positive:** clean canonical example + 4 variants (tighter/looser/different magnitudes)
- **8 negative:** common false positives — wrong direction, depth out of bounds, wrong duration, missing element, volume wrong, noisy/choppy, etc.
- **2 edge:** boundary of validity (just within min/max thresholds)

Each fixture must specify `expected.fires`, and if `fires=true` also `min_confidence` + `max_confidence` band.

- [ ] **Step 4: Generate fixtures + run battery test**

```bash
python tests/fixtures/{name}/_generate.py
python -m pytest tests/pattern_engine/detectors/test_{name}.py -v
```

Iterate detector + fixture parameters until 16/16 pass (15 fixtures + coverage). Expect 2-4 rounds of tuning per detector. DO NOT relax assertions to make fixtures pass — the point is convergence on real, defensible behavior.

- [ ] **Step 5: Wire into patterns.py**

In `api/routers/patterns.py`:
1. Add `from api.services.pattern_engine.detectors.classical import {name} as _{name}  # noqa: F401` to the import block.
2. Add an entry to `_PATTERN_METADATA`:
```python
"{name}": {
    "name": "Display Name",
    "category": "classical",
    "direction": "bullish" | "bearish",
    "description": "One-sentence description.",
},
```

- [ ] **Step 6: Run full pattern_engine suite**

```bash
python -m pytest tests/pattern_engine -v 2>&1 | tail -3
```

Expected: total tests grows by 16+ (15 fixtures + coverage check). No regressions on bull_flag.

- [ ] **Step 7: Commit**

```bash
git add api/services/pattern_engine/detectors/classical/{name}.py \
        api/routers/patterns.py \
        tests/fixtures/{name} \
        tests/pattern_engine/detectors/test_{name}.py
git commit -m "feat(patterns): {name} detector + 15-fixture battery"
```

Push to Railway after every 2-3 detectors complete.

---

## Tasks 1-10 (one detector each)

### Task 1: `bear_flag`
Apply per-task template above with the bear_flag definition. Confidence floor 50.

### Task 2: `pennant`
Apply template. Note: emits BOTH bullish + bearish pennants as a single detector — direction field varies per detection.

### Task 3: `falling_wedge`
Apply template. Both trendlines slope down, lower less steeply (converging).

### Task 4: `rising_wedge`
Apply template. Both trendlines slope up, upper less steeply.

### Task 5: `head_shoulders`
Apply template. Three peaks + neckline geometry. May need to bump fixture battery to 18 if positive variants need to cover symmetry tolerance.

### Task 6: `inverse_head_shoulders`
Apply template. Mirror of Task 5.

### Task 7: `double_top`
Apply template. Two peaks within 4% + retrace trough.

### Task 8: `double_bottom`
Apply template. Mirror of Task 7.

### Task 9: `cup_handle`
Apply template. Polynomial roundness fit + handle detection. The most algorithmically complex of Phase 1.

### Task 10: `inverse_cup_handle`
Apply template. Mirror of Task 9.

---

## Task 11: Run verify_phase.py 1 + commit report

After all 10 detectors are committed and pushed to Railway:

- [ ] **Step 1: Wait for Railway redeploy**

```bash
until curl -s -m 10 https://uctintelligence.com/api/admin/patterns/health 2>/dev/null | python -c "import sys, json; print(json.loads(sys.stdin.read())['detector_count'])" | grep -q "^11$"; do sleep 20; done
echo "11 detectors live"
```

- [ ] **Step 2: Run verify_phase.py 1**

```bash
python scripts/verify_phase.py 1
```

Expected:
- Test Suite: 80+ pattern_engine tests passing (Phase 0's 82 + 10 detectors × ~16 tests each = ~240+)
- Detector Inventory: 11 detectors registered
- Live API Smoke: 3/3 endpoints OK (more types in `/types` response)
- Fixture Batteries: all batteries pass across 11 detectors
- False-Positive Sweep: each detector's rate ≤ 2× median rate
- Performance Bench: p99 should still be <100ms for 500 bars even with 11 detectors

- [ ] **Step 3: Review the report**

If any check FAILs:
- Confidence band too tight → adjust expected band
- A detector fires on synthetic data (FP sweep flag) → tune detector floor or add a stricter filter
- Performance degraded → profile and optimize the slow detector

- [ ] **Step 4: Commit + push the report**

```bash
git add docs/superpowers/phase-reports/
git commit -m "verify(patterns): Phase 1 verification report — 11 detectors, all 9 checks pass"
git push
```

---

## Phase 1 Done — what shipped

After this plan:
- 11 total detectors registered (bull_flag from Phase 0 + 10 new classical)
- 165 fixtures total (15 per detector)
- ~240+ tests in `tests/pattern_engine/`
- `_PATTERN_METADATA` in patterns.py covers all 11 with display name + direction + description
- Phase 1 verification report committed

Ready for Phase 2 (UCT setups + structure detectors).

## Self-review

- 10 detectors covered, each with its own task following identical template structure.
- Geometric definitions are concrete (specific %s, bar counts, slope conditions).
- bull_flag template is referenced — no greenfield work.
- Phasing of the verify_phase.py 1 run is explicit.
- No placeholders. Each step is actionable. Confidence floor 50 is consistent across all detectors. Composite weighting consistent. Required imports listed.
- Fixture coverage gate (≥5/≥8/≥2) is enforced by the battery's coverage test.
