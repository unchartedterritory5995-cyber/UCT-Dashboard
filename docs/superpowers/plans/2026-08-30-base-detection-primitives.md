# Base Detection Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three detection primitives every base/chart-structure detector composes from — a non-repainting volatility-scaled segmenter, log-space trendline fitting, and pivot-shape comparison — plus the coverage harness that gates every future structure at authoring time.

**Architecture:** Three new pure-function modules under `api/services/pattern_engine/primitives/`, one modification to the existing `trendlines.py`, and one dev tool. No detector, no column, no UI in this plan — those are the next plan. Everything here is a pure function over `list[Bar]`, unit-testable without a database.

**Tech Stack:** Python 3, stdlib only (`math`, `statistics`, `typing`). pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-base-structure-library-design.md`

## Global Constraints

- **Non-repainting is the headline property.** A confirmed pivot MUST NOT change when later bars arrive. Any window statistic (sigma, average) must be computed over a TRAILING window ending at the bar being evaluated — never over the whole series, which would recompute historical thresholds every night. Spec §5.2, F6.
- **Line fitting is log-space.** Edwards & Magee: a constant-percentage decline converges in points by construction, so arithmetic fitting manufactures falling wedges. Spec §3, §5.2.
- **A criterion with no published number is `None`, never a guess.** Where this plan picks a number, the docstring says `origin: uct` and says why. Spec §5.1.
- **No volume gate may be presented as a quality upgrade** anywhere in this codebase. Spec F3. (No task here ships one; the rail arrives with the catalog.)
- **Style:** match the surrounding package — module docstring explaining WHY, `from __future__ import annotations`, TypedDict for record shapes imported from `api/services/pattern_engine/types.py`.
- **Run tests from the repo root** (`C:/Users/Patrick/uct-worktrees/pattern-audit`), which is where `pytest.ini` lives.

---

## File Structure

| File | Responsibility |
|---|---|
| `api/services/pattern_engine/primitives/zigzag.py` | **Create.** Volatility-scaled, causal, non-repainting swing segmentation. Emits `Swing` records; the trailing one is `provisional`. |
| `api/services/pattern_engine/primitives/shape.py` | **Create.** Comparisons *between* pivots: roundness (U vs V), rim equality, symmetry. The primitive whose absence actually blocks cup-with-handle. |
| `api/services/pattern_engine/primitives/trendlines.py` | **Modify.** Add opt-in log-space fitting. |
| `tools/base_coverage.py` | **Create.** Reports a predicate's universe hit-rate so a structure can never ship at 0% or 35% unnoticed. |
| `tests/pattern_engine/test_zigzag.py` | **Create.** |
| `tests/pattern_engine/test_shape.py` | **Create.** |
| `tests/pattern_engine/test_trendlines_logspace.py` | **Create.** |

---

### Task 1: Volatility-scaled zigzag segmentation

The segmenter. Everything downstream consumes its output, so it lands first.

**Why a zigzag and not the existing `detect_pivots`:** `detect_pivots` uses a fixed ±N-bar fractal window, so on a quiet stock it emits noise pivots and on a volatile one it misses real swings — the window is in BARS but the question is in PRICE. Osler's method scales the reversal threshold to each security's own return volatility, which is the best-argued answer to threshold selection in the literature (spec §5.2). `detect_pivots` stays; it has existing callers.

**Files:**
- Create: `api/services/pattern_engine/primitives/zigzag.py`
- Test: `tests/pattern_engine/test_zigzag.py`

**Interfaces:**
- Consumes: `Bar` from `api/services/pattern_engine/types.py` — `{t:int, o:float, h:float, l:float, c:float, v:float}`
- Produces:
  - `class Swing(TypedDict)` with keys `t:int`, `price:float`, `type:Literal["high","low"]`, `bar_index:int`, `provisional:bool`
  - `segment(bars: list[Bar], k: float = 3.0, sigma_window: int = 60) -> list[Swing]`
  - Module constants `DEFAULT_K = 3.0`, `SIGMA_WINDOW = 60`, `MIN_SIGMA_BARS = 30`, `DEDUP_BARS = 2`

- [ ] **Step 1: Write the failing tests**

Create `tests/pattern_engine/test_zigzag.py`:

```python
import math

from api.services.pattern_engine.primitives.zigzag import (
    DEDUP_BARS, segment,
)


def _bar(i, price, spread=0.005):
    """One synthetic bar centred on `price`. t is a plausible unix day."""
    return {
        "t": 1_600_000_000 + i * 86400,
        "o": price, "h": price * (1 + spread), "l": price * (1 - spread),
        "c": price, "v": 1_000_000,
    }


def _series(prices, spread=0.005):
    return [_bar(i, p, spread) for i, p in enumerate(prices)]


def _noise(n, seed=7):
    """Deterministic pseudo-random walk — no numpy, no random module state."""
    out, p = [], 100.0
    x = seed
    for _ in range(n):
        x = (1103515245 * x + 12345) % (2 ** 31)
        p *= 1.0 + ((x / (2 ** 31)) - 0.5) * 0.04
        out.append(p)
    return out


def test_monotone_rise_has_no_confirmed_interior_pivot():
    """A series that only goes up never reverses, so nothing is confirmed."""
    bars = _series([100.0 * (1.01 ** i) for i in range(120)])
    swings = segment(bars)
    confirmed = [s for s in swings if not s["provisional"]]
    assert confirmed == []


def test_the_trailing_swing_is_always_provisional():
    bars = _series(_noise(200))
    swings = segment(bars)
    assert swings, "expected at least the running extreme"
    assert swings[-1]["provisional"] is True
    assert all(s["provisional"] is False for s in swings[:-1])


def test_confirmed_pivots_alternate_high_low():
    bars = _series(_noise(300))
    confirmed = [s for s in segment(bars) if not s["provisional"]]
    for a, b in zip(confirmed, confirmed[1:]):
        assert a["type"] != b["type"], "zigzag must alternate by construction"


def test_confirmed_pivots_are_prefix_stable_as_bars_arrive():
    """THE non-repainting rail.

    Extending the series must never rewrite an already-confirmed pivot.
    This is what fails if sigma is computed over the whole series instead of
    a trailing window — every added bar would shift every historic threshold.
    """
    bars = _series(_noise(400))
    prev = [s for s in segment(bars[:200]) if not s["provisional"]]
    for n in range(210, 401, 10):
        cur = [s for s in segment(bars[:n]) if not s["provisional"]]
        assert cur[:len(prev)] == prev, f"confirmed history changed at n={n}"
        prev = cur


def test_a_reversal_smaller_than_the_threshold_confirms_nothing():
    """Rise 30%, dip 0.5%, rise again. The dip is far below k*sigma."""
    up1 = [100.0 * (1.01 ** i) for i in range(60)]
    dip = [up1[-1] * (1 - 0.005)]
    up2 = [dip[-1] * (1.01 ** i) for i in range(1, 60)]
    swings = segment(_series(up1 + dip + up2))
    assert [s for s in swings if not s["provisional"]] == []


def test_a_large_reversal_confirms_the_prior_extreme():
    """Rise to a clear top, then fall hard enough to exceed the threshold."""
    up = [100.0 * (1.01 ** i) for i in range(80)]
    peak = up[-1]
    down = [peak * (1 - 0.01 * i) for i in range(1, 40)]
    confirmed = [s for s in segment(_series(up + down)) if not s["provisional"]]
    assert len(confirmed) >= 1
    first = confirmed[0]
    assert first["type"] == "high"
    # The confirmed high is the actual peak bar, not the bar that confirmed it.
    assert first["bar_index"] == len(up) - 1
    assert math.isclose(first["price"], peak * 1.005, rel_tol=1e-6)


def test_too_little_history_returns_empty_rather_than_guessing():
    assert segment(_series([100.0, 101.0, 102.0])) == []


def test_zero_and_negative_prices_do_not_crash_or_emit():
    bars = _series(_noise(120))
    for b in bars[40:45]:
        b["h"] = b["l"] = b["c"] = b["o"] = 0.0
    swings = segment(bars)
    assert all(s["price"] > 0 for s in swings)


def test_dedup_bars_constant_is_exposed_for_callers():
    assert DEDUP_BARS == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/test_zigzag.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'api.services.pattern_engine.primitives.zigzag'`

- [ ] **Step 3: Write the implementation**

Create `api/services/pattern_engine/primitives/zigzag.py`:

```python
"""Volatility-scaled swing segmentation — the causal, non-repainting one.

⭐ WHY NOT `detect_pivots`. That primitive uses a fixed +/-N-BAR fractal
window, but the question a base asks is in PRICE, not in bars: the same
5-bar window that finds real swings on a 2%-ADR name emits pure noise on a
0.4%-ADR one. Osler's method scales the reversal threshold to each
security's own return volatility, which the academic corpus
(`docs/superpowers/research/bases/12-academic-algorithmic-detection.md`)
identifies as the best-argued answer to threshold selection. `detect_pivots`
is untouched and keeps its existing callers.

⛔⛔ SIGMA IS A TRAILING WINDOW, AND THAT IS THE WHOLE NON-REPAINTING
PROPERTY. Computing sigma over the entire series is the obvious
implementation and it silently repaints: every new bar changes sigma, which
changes the threshold at EVERY historical bar, which can retroactively
confirm or un-confirm pivots years old. A member who screened yesterday and
re-screens today would get a different history with no code change. The
trailing window makes the threshold at bar `i` a function only of bars
<= `i`, so a confirmed pivot is permanent.
`test_confirmed_pivots_are_prefix_stable_as_bars_arrive` is the rail.

⚠️ THE TRAILING SWING IS ALWAYS PROVISIONAL. A swing is only knowable once
price has reversed away from it by the threshold; until then the running
extreme may still extend. Publishing it as confirmed is exactly the
repainting that six of ten charting vendors do not disclose
(`13-vendor-detection-implementations.md`). Callers must branch on
`provisional`, and a detector must never place an entry or stop on a
provisional swing.

`k` is `origin: uct`. Osler swept ten cutoffs and published no single
preferred value, so 3.0 is OUR choice, not hers: it is the smallest integer
multiple of daily sigma that suppresses the noise swings in a 3,700-name
universe. It is a module constant so a sweep can move it in one place.
"""
from __future__ import annotations

import math
from typing import List, Literal, TypedDict

from api.services.pattern_engine.types import Bar

DEFAULT_K = 3.0        # origin: uct — see module docstring
SIGMA_WINDOW = 60      # trailing bars used to estimate daily sigma
MIN_SIGMA_BARS = 30    # below this we refuse rather than estimate
DEDUP_BARS = 2         # Osler's explicit +/-2-day de-duplication


class Swing(TypedDict):
    t: int
    price: float
    type: Literal["high", "low"]
    bar_index: int
    provisional: bool


def _trailing_sigma(bars: List[Bar], i: int, window: int) -> float:
    """Stdev of log returns over the `window` bars ending at `i`.

    Causal by construction: reads no bar after `i`. `window` is a parameter,
    never a module global read at call time — threading it through is what
    keeps `segment` re-entrant and free of the shared-state bug a global
    would introduce under concurrent builds.
    """
    lo = max(1, i - window + 1)
    rets = []
    for j in range(lo, i + 1):
        p0, p1 = bars[j - 1]["c"], bars[j]["c"]
        if p0 > 0 and p1 > 0:
            rets.append(math.log(p1 / p0))
    if len(rets) < MIN_SIGMA_BARS:
        return 0.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var)


def _usable(bar: Bar) -> bool:
    """A bar that never traded cannot extend or confirm a swing.

    Same refusal the candle library applies: a zero-range, zero-price bar is
    an absence of data, and building a structure on it fabricates one (the
    island-reversal defect, 2026-08-24).
    """
    return bar["h"] > 0 and bar["l"] > 0 and bar["h"] >= bar["l"]


def _dedup(swings: List[Swing]) -> List[Swing]:
    """Collapse adjacent same-type swings within DEDUP_BARS, keeping the
    more extreme. Alternation is guaranteed by the walk below, so this only
    fires on the degenerate case where two extremes land within the window.
    """
    out: List[Swing] = []
    for s in swings:
        if out and out[-1]["type"] == s["type"] \
                and s["bar_index"] - out[-1]["bar_index"] <= DEDUP_BARS:
            better = (s["price"] > out[-1]["price"]) if s["type"] == "high" \
                else (s["price"] < out[-1]["price"])
            if better:
                out[-1] = s
            continue
        out.append(s)
    return out


def segment(bars: List[Bar], k: float = DEFAULT_K,
            sigma_window: int = SIGMA_WINDOW) -> List[Swing]:
    """Segment `bars` into alternating swing highs and lows.

    Returns confirmed swings in bar order, followed by exactly one
    `provisional` swing (the running extreme) when there is one. An empty
    list means we refuse: too little history to estimate sigma.
    """
    n = len(bars)
    if n < MIN_SIGMA_BARS + 2:
        return []
    return _walk(bars, k, sigma_window, n)


def _walk(bars: List[Bar], k: float, window: int, n: int) -> List[Swing]:
    start = None
    for i in range(n):
        if _usable(bars[i]):
            start = i
            break
    if start is None:
        return []

    direction: str | None = None
    hi_i, hi = start, bars[start]["h"]
    lo_i, lo = start, bars[start]["l"]
    confirmed: List[Swing] = []

    def _mk(idx: int, price: float, kind: str, prov: bool) -> Swing:
        return {"t": bars[idx]["t"], "price": price, "type": kind,
                "bar_index": idx, "provisional": prov}

    for i in range(start + 1, n):
        bar = bars[i]
        if not _usable(bar):
            continue
        thr = k * _trailing_sigma(bars, i, window)
        if thr <= 0:
            continue
        h, l = bar["h"], bar["l"]

        if direction != "down":
            if h > hi:
                hi, hi_i = h, i
            if hi > 0 and (hi - l) / hi >= thr:
                confirmed.append(_mk(hi_i, hi, "high", False))
                direction = "down"
                lo, lo_i = l, i
                continue
        if direction != "up":
            if l < lo:
                lo, lo_i = l, i
            if lo > 0 and (h - lo) / lo >= thr:
                confirmed.append(_mk(lo_i, lo, "low", False))
                direction = "up"
                hi, hi_i = h, i

    out = _dedup(confirmed)
    # Exactly one trailing provisional swing: the extreme we are still
    # tracking. `direction is None` means price never moved k*sigma in
    # either direction, so there is nothing to report — not even a guess.
    if direction == "down":
        out.append(_mk(lo_i, lo, "low", True))
    elif direction == "up":
        out.append(_mk(hi_i, hi, "high", True))
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_zigzag.py -v`
Expected: 9 passed.

If `test_confirmed_pivots_are_prefix_stable_as_bars_arrive` fails, the cause is almost certainly a non-causal statistic — check that nothing reads `bars[j]` for `j > i`.

- [ ] **Step 5: Verify the rail actually discriminates**

A rail that passes for the wrong reason is worse than none
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). Temporarily break
causality and confirm the test catches it:

Run:
```bash
python - <<'EOF'
import re, pathlib
p = pathlib.Path("api/services/pattern_engine/primitives/zigzag.py")
src = p.read_text(encoding="utf-8")
p.with_suffix(".py.bak").write_text(src, encoding="utf-8")
# Make sigma read the WHOLE series (the repainting implementation).
p.write_text(src.replace("lo = max(1, i - SIGMA_WINDOW + 1)", "lo = 1; i = len(bars) - 1"), encoding="utf-8")
EOF
python -m pytest tests/pattern_engine/test_zigzag.py::test_confirmed_pivots_are_prefix_stable_as_bars_arrive -v
```
Expected: **FAIL** — "confirmed history changed at n=...". This proves the rail
discriminates. Now restore:
```bash
python -c "import pathlib,shutil; p=pathlib.Path('api/services/pattern_engine/primitives/zigzag.py'); shutil.move(str(p.with_suffix('.py.bak')), str(p))"
python -m pytest tests/pattern_engine/test_zigzag.py -v
```
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add api/services/pattern_engine/primitives/zigzag.py tests/pattern_engine/test_zigzag.py
git commit -m "feat(primitives): volatility-scaled non-repainting zigzag segmentation"
```

---

### Task 2: Log-space trendline fitting

**Files:**
- Modify: `api/services/pattern_engine/primitives/trendlines.py`
- Test: `tests/pattern_engine/test_trendlines_logspace.py`

**Interfaces:**
- Consumes: existing `fit_trendline(pivots, touch_tolerance_pct=0.5) -> Trendline`
- Produces: `fit_trendline(pivots, touch_tolerance_pct=0.5, log_space: bool = False) -> Trendline`. Default `False` preserves every existing caller's behaviour byte-for-byte.

- [ ] **Step 1: Write the failing test**

Create `tests/pattern_engine/test_trendlines_logspace.py`:

```python
"""Edwards & Magee: arithmetic price scaling MANUFACTURES falling wedges.

A constant-percentage decline converges in POINTS by construction — a 5%
drop from 100 is 5 points, from 50 it is 2.5 — so two lines fitted through
its highs and lows in arithmetic space appear to converge even though the
decline is perfectly uniform in percentage terms. E&M prescribe log-space
fitting; Murphy gives no scaling caveat at all. Our `falling_wedge.py`,
`rising_wedge.py` and `trendlines.py` contained zero references to `log`.

Source: docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md
"""
import math

from api.services.pattern_engine.primitives.trendlines import fit_trendline


def _pivot(i, price, kind):
    return {"t": 1_600_000_000 + i * 86400, "price": price,
            "type": kind, "strength": 60, "bar_index": i}


def _constant_pct_decline(n=40, rate=0.03, band=0.02):
    """Uniform -3%/bar. Highs and lows sit a constant PERCENTAGE apart, so
    the channel is parallel in log space and converging in arithmetic space.
    """
    highs, lows = [], []
    for i in range(n):
        mid = 100.0 * ((1 - rate) ** i)
        highs.append(_pivot(i, mid * (1 + band), "high"))
        lows.append(_pivot(i, mid * (1 - band), "low"))
    return highs, lows


def test_arithmetic_fit_makes_a_uniform_decline_look_convergent():
    """Documents the defect. Slopes differ materially in arithmetic space."""
    highs, lows = _constant_pct_decline()
    up = fit_trendline(highs)
    dn = fit_trendline(lows)
    assert up["slope"] < 0 and dn["slope"] < 0
    # The upper line falls FASTER than the lower one -> apparent convergence.
    assert up["slope"] < dn["slope"]
    gap = abs(up["slope"] - dn["slope"]) / abs(dn["slope"])
    assert gap > 0.02, "expected visible arithmetic convergence"


def test_log_space_fit_reports_a_uniform_decline_as_parallel():
    """THE CONTROL. In log space the same series has equal slopes."""
    highs, lows = _constant_pct_decline()
    up = fit_trendline(highs, log_space=True)
    dn = fit_trendline(lows, log_space=True)
    assert math.isclose(up["slope"], dn["slope"], rel_tol=1e-6), (
        f"log-space slopes should match: {up['slope']} vs {dn['slope']}"
    )


def test_log_space_is_opt_in_and_default_is_unchanged():
    highs, _ = _constant_pct_decline()
    assert fit_trendline(highs) == fit_trendline(highs, log_space=False)


def test_log_space_refuses_non_positive_prices():
    """log(0) is undefined; refuse rather than emit a fabricated slope."""
    pivots = [_pivot(0, 10.0, "high"), _pivot(1, 0.0, "high"),
              _pivot(2, 8.0, "high")]
    line = fit_trendline(pivots, log_space=True)
    assert line["validity"] == 0.0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/pattern_engine/test_trendlines_logspace.py -v`
Expected: `test_log_space_fit_reports_a_uniform_decline_as_parallel` and
`test_log_space_refuses_non_positive_prices` FAIL with
`TypeError: fit_trendline() got an unexpected keyword argument 'log_space'`.
`test_arithmetic_fit_makes_a_uniform_decline_look_convergent` should PASS
already — it documents current behaviour.

- [ ] **Step 3: Implement log-space fitting**

Read `api/services/pattern_engine/primitives/trendlines.py` first — keep its
existing return shape and validity/touch logic exactly. Add the parameter and
transform the y-values before fitting, transforming the reported anchors back:

```python
def fit_trendline(pivots, touch_tolerance_pct: float = 0.5,
                  log_space: bool = False):
    """Fit a line through `pivots`.

    ⛔ `log_space=True` FOR ANY CONVERGENCE OR DIVERGENCE JUDGEMENT.
    Edwards & Magee: a constant-percentage decline converges in POINTS by
    construction, so an arithmetic fit emits a falling wedge on essentially
    any sustained uniform downtrend. They prescribe log-space fitting;
    Murphy gives no scaling caveat, which is why the arithmetic version is
    the one that propagated. Default stays False so existing callers are
    untouched; wedge, triangle and channel detectors must pass True.
    Source: docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md
    """
    if log_space:
        if any((p["price"] or 0) <= 0 for p in pivots):
            # log(x<=0) is undefined. A fabricated slope here would be a
            # confident wrong answer; an unusable line is the honest one.
            return _empty_trendline()
        pivots = [{**p, "price": math.log(p["price"])} for p in pivots]

    line = _fit_arithmetic(pivots, touch_tolerance_pct)

    if log_space:
        line = {**line,
                "p1": {**line["p1"], "price": math.exp(line["p1"]["price"])},
                "p2": {**line["p2"], "price": math.exp(line["p2"]["price"])}}
    return line
```

Rename the existing body (everything after the `len(pivots) < 2` guard) to
`_fit_arithmetic(pivots, touch_tolerance_pct)` as a **pure rename** — do not
alter a line of its arithmetic. Keep the `ValueError` guard in the public
`fit_trendline`. Add `import math`.

⚠️ **There is no existing empty-Trendline shape** — today `fit_trendline`
*raises* on fewer than 2 pivots and has no other failure path. So
`_empty_trendline` is new and must be written out in full, matching the
`Trendline` TypedDict in `api/services/pattern_engine/types.py` exactly:

```python
def _empty_trendline() -> Trendline:
    """An unusable line. Returned ONLY when log-space is requested on data
    that has no logarithm — never as a general error path, because
    `fit_trendline` still raises on <2 pivots and callers depend on that.

    `validity: 0.0` is the caller's signal to discard. Every numeric field
    is zeroed rather than left absent so the TypedDict stays total.
    """
    zero = {"t": 0, "price": 0.0}
    return {"p1": zero, "p2": dict(zero), "slope": 0.0,
            "r_squared": 0.0, "touches": 0, "validity": 0.0}
```

⚠️ `slope` stays in **log units per unit `t`** when `log_space=True` — the
existing arithmetic slope is price per unit `t` where `t` is unix seconds
(see the module docstring: "price-per-unit-t"), and the log version is the
same denominator with a log numerator. That is exactly the quantity a
convergence test needs, so it is deliberately NOT converted back. Only the
two anchors are exponentiated, for drawing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_trendlines_logspace.py -v`
Expected: 4 passed.

- [ ] **Step 5: Verify no existing caller regressed**

Run: `python -m pytest tests/pattern_engine -v`
Expected: all pass. `log_space` defaults to False, so any failure here means
the `_fit_arithmetic` extraction changed behaviour — revert and redo it as a
pure rename.

- [ ] **Step 6: Commit**

```bash
git add api/services/pattern_engine/primitives/trendlines.py tests/pattern_engine/test_trendlines_logspace.py
git commit -m "feat(primitives): opt-in log-space trendline fitting with the E&M control"
```

---

### Task 3: Pivot-shape comparison

The primitive whose absence — not pivot detection — actually blocks
cup-with-handle. `INDEX_bulkowski_patterns.md` corrected this on 2026-08-10:
*"cup-with-handle's 'U-shaped, not V-shaped' and 'rims near the same price
level' are still not expressible — those need shape comparison between pivots."*

**Files:**
- Create: `api/services/pattern_engine/primitives/shape.py`
- Test: `tests/pattern_engine/test_shape.py`

**Interfaces:**
- Consumes: `Bar` from `types.py`
- Produces:
  - `roundness(bars, start_idx, end_idx) -> float | None` — 0.0 = perfect V, 1.0 = perfect U
  - `rim_equality(left_price, right_price) -> float | None` — 1.0 = identical rims, decaying to 0.0
  - `symmetry(bars, start_idx, low_idx, end_idx) -> float | None` — 1.0 = low sits exactly midway

- [ ] **Step 1: Write the failing tests**

Create `tests/pattern_engine/test_shape.py`:

```python
from api.services.pattern_engine.primitives.shape import (
    rim_equality, roundness, symmetry,
)


def _bar(i, price):
    return {"t": 1_600_000_000 + i * 86400, "o": price, "h": price,
            "l": price, "c": price, "v": 1_000_000}


def _v_shape(depth=0.30, half=20):
    """Sharp V: straight down, straight up, single touch at the bottom."""
    prices = [100.0 * (1 - depth * (i / half)) for i in range(half)]
    prices += [100.0 * (1 - depth * (1 - i / half)) for i in range(half + 1)]
    return [_bar(i, p) for i, p in enumerate(prices)]


def _u_shape(depth=0.30, half=20):
    """Rounded U: cosine easing, so the series lingers near the low."""
    import math
    prices = []
    n = 2 * half
    for i in range(n + 1):
        frac = (1 - math.cos(2 * math.pi * i / n)) / 2  # 0 -> 1 -> 0
        prices.append(100.0 * (1 - depth * frac))
    return [_bar(i, p) for i, p in enumerate(prices)]


def test_a_sharp_v_scores_low_roundness():
    assert roundness(_v_shape(), 0, 40) < 0.35


def test_a_rounded_u_scores_high_roundness():
    assert roundness(_u_shape(), 0, 40) > 0.65


def test_u_is_rounder_than_v_at_identical_depth_and_width():
    assert roundness(_u_shape(), 0, 40) > roundness(_v_shape(), 0, 40)


def test_roundness_refuses_a_window_too_short_to_have_a_shape():
    assert roundness(_u_shape(), 0, 3) is None


def test_roundness_refuses_a_flat_window_rather_than_dividing_by_zero():
    flat = [_bar(i, 50.0) for i in range(40)]
    assert roundness(flat, 0, 39) is None


def test_identical_rims_score_one():
    assert rim_equality(100.0, 100.0) == 1.0


def test_rim_equality_decays_with_the_gap():
    near = rim_equality(100.0, 102.0)
    far = rim_equality(100.0, 120.0)
    assert 0.0 < far < near < 1.0


def test_rim_equality_refuses_non_positive_prices():
    assert rim_equality(0.0, 100.0) is None


def test_a_centred_low_is_perfectly_symmetric():
    assert symmetry(_u_shape(), 0, 20, 40) == 1.0


def test_an_off_centre_low_scores_below_one():
    assert symmetry(_u_shape(), 0, 5, 40) < 0.6


def test_symmetry_refuses_an_out_of_order_window():
    assert symmetry(_u_shape(), 0, 40, 20) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/test_shape.py -v`
Expected: collection error — `No module named '...primitives.shape'`

- [ ] **Step 3: Write the implementation**

Create `api/services/pattern_engine/primitives/shape.py`:

```python
"""Comparisons BETWEEN pivots — roundness, rim equality, symmetry.

⭐ THIS IS THE PRIMITIVE THAT WAS ACTUALLY MISSING. `INDEX_bulkowski_patterns.md`
recorded a correction on 2026-08-10: pivot detection was wrongly blamed as
"the missing primitive" when it was already expressible. What genuinely is
not expressible with pivots alone is cup-with-handle's "U-shaped, not
V-shaped" and "rims near the same price level" — both are comparisons of
SHAPE between pivots, not detections of pivots.

⛔ EVERY FUNCTION HERE RETURNS `None` RATHER THAN A DEFAULT. A shape score
of 0.0 means "measured, and it is a V"; `None` means "not measurable" — a
window too short, a flat series, an out-of-order index. Collapsing those two
is the honest-None rule this repo keeps relearning, most recently as a
synthetic 0.0 expectancy shipping to members as a measurement.

All thresholds in the CALLERS are `origin: uct`. No house in the corpus
publishes a numeric roundness cutoff — Bulkowski, O'Neil and Minervini all
describe cup shape in words only ("U-shaped, not V-shaped"), so any cutoff
is ours and must be labelled as ours.
"""
from __future__ import annotations

import math
from typing import List, Optional

from api.services.pattern_engine.types import Bar

MIN_SHAPE_BARS = 8
RIM_DECAY_PCT = 10.0    # origin: uct — gap at which equality has decayed to ~1/e


def roundness(bars: List[Bar], start_idx: int, end_idx: int) -> Optional[float]:
    """How U-shaped is `bars[start_idx:end_idx+1]`? 0.0 = V, 1.0 = U.

    Method: compare the window's actual mean depth against the mean depth of
    a perfect V spanning the same endpoints and low. A V is straight-sided,
    so its average depth is exactly half its maximum; a U lingers near the
    low, so its average depth is a larger fraction of the maximum. The score
    normalizes that fraction onto [0, 1].

    ⚠️ Deliberately shape-only. It says nothing about whether the structure
    is tradeable, and no measured performance is attached to it.
    """
    if end_idx - start_idx + 1 < MIN_SHAPE_BARS:
        return None
    if start_idx < 0 or end_idx >= len(bars) or start_idx >= end_idx:
        return None

    window = bars[start_idx:end_idx + 1]
    closes = [b["c"] for b in window if b["c"] > 0]
    if len(closes) < MIN_SHAPE_BARS:
        return None

    rim = max(closes[0], closes[-1])
    low = min(closes)
    span = rim - low
    if span <= 0:
        return None

    mean_depth = sum(rim - c for c in closes) / len(closes)
    frac = mean_depth / span            # V ~ 0.5, U -> 1.0
    return max(0.0, min(1.0, (frac - 0.5) / 0.5))


def rim_equality(left_price: float, right_price: float) -> Optional[float]:
    """1.0 when the two rims match, decaying smoothly as they diverge.

    ⚠️ The corpus publishes NO numeric rim tolerance. O'Neil says the right
    side should return "near" the left-side high; Bulkowski's identification
    guidelines say the rims should be "near the same price". Neither
    quantifies it, so this returns a continuous score and lets each caller
    state its own cutoff as `origin: uct`.
    """
    if (left_price or 0) <= 0 or (right_price or 0) <= 0:
        return None
    gap_pct = abs(left_price - right_price) / max(left_price, right_price) * 100.0
    return math.exp(-gap_pct / RIM_DECAY_PCT)


def symmetry(bars: List[Bar], start_idx: int, low_idx: int,
             end_idx: int) -> Optional[float]:
    """1.0 when the low sits exactly midway between the two rims.

    Edwards & Magee require rough symmetry for a head-and-shoulders; O'Neil
    prefers a cup whose low is not jammed against one rim. Both describe it
    in words, so this is a continuous score, not a gate.
    """
    if not (start_idx < low_idx < end_idx):
        return None
    if start_idx < 0 or end_idx >= len(bars):
        return None
    left = low_idx - start_idx
    right = end_idx - low_idx
    total = left + right
    if total <= 0:
        return None
    return 1.0 - abs(left - right) / total
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_shape.py -v`
Expected: 11 passed.

If `test_a_sharp_v_scores_low_roundness` or the U test misses its bound,
print `roundness()` for both fixtures and adjust the fixtures' `half`/`depth`
before touching the formula — the formula's V=0.5 anchor is analytic.

- [ ] **Step 5: Commit**

```bash
git add api/services/pattern_engine/primitives/shape.py tests/pattern_engine/test_shape.py
git commit -m "feat(primitives): pivot-shape comparison (roundness, rim equality, symmetry)"
```

---

### Task 4: Universe coverage harness

The authoring rail from spec §8.1. `cup_handle_uct` gates on six conditions at
once and fires on **2 of 2,890 symbols**; `Compression Bar (NR4)` was deleted
for firing on **35%**. Both were found long after shipping. This makes the
hit-rate visible while a structure is being written.

**Files:**
- Create: `tools/base_coverage.py`
- Test: `tests/pattern_engine/test_base_coverage.py`

**Interfaces:**
- Consumes: `segment` from Task 1 (only as an example predicate in the CLI docstring)
- Produces: `coverage(predicate, bars_by_ticker) -> CoverageReport` where
  `CoverageReport` is a TypedDict with `hits:int`, `total:int`, `pct:float`,
  `verdict:Literal["dead","thin","ok","noise"]`, and
  `classify(pct: float) -> str`

- [ ] **Step 1: Write the failing tests**

Create `tests/pattern_engine/test_base_coverage.py`:

```python
from tools.base_coverage import classify, coverage


def _bars(price):
    return [{"t": 1_600_000_000 + i * 86400, "o": price, "h": price,
             "l": price, "c": price, "v": 100} for i in range(60)]


UNIVERSE = {f"T{i}": _bars(10.0 + i) for i in range(100)}


def test_a_predicate_that_never_fires_is_dead():
    r = coverage(lambda bars: False, UNIVERSE)
    assert r["hits"] == 0 and r["verdict"] == "dead"


def test_a_predicate_that_always_fires_is_noise():
    r = coverage(lambda bars: True, UNIVERSE)
    assert r["pct"] == 100.0 and r["verdict"] == "noise"


def test_a_selective_predicate_is_ok():
    r = coverage(lambda bars: bars[0]["c"] < 20.0, UNIVERSE)
    assert r["hits"] == 10 and r["pct"] == 10.0 and r["verdict"] == "ok"


def test_a_very_rare_predicate_is_thin():
    r = coverage(lambda bars: bars[0]["c"] < 10.5, UNIVERSE)
    assert r["verdict"] == "thin"


def test_a_raising_predicate_counts_as_a_miss_not_a_crash():
    def boom(bars):
        raise ValueError("bad bar")
    r = coverage(boom, UNIVERSE)
    assert r["hits"] == 0 and r["errors"] == 100


def test_classify_boundaries_are_explicit():
    assert classify(0.0) == "dead"
    assert classify(0.4) == "thin"
    assert classify(0.5) == "ok"
    assert classify(35.0) == "ok"
    assert classify(35.1) == "noise"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/pattern_engine/test_base_coverage.py -v`
Expected: collection error — `No module named 'tools.base_coverage'`

- [ ] **Step 3: Write the implementation**

Create `tools/base_coverage.py` (add an empty `tools/__init__.py` if the
package does not already exist):

```python
"""Report a structure predicate's hit-rate across the real universe.

⭐ WHY THIS IS A RAIL AND NOT A NICETY. Two measured failures motivate it,
both found long after shipping:
  - `cup_handle_uct` gates on six conditions simultaneously and fires on
    **2 of 2,890 symbols** — shipped, tested, green, and effectively dead.
  - `Compression Bar (NR4)` fired on **1,304 of 3,707 (35%)**. A label a
    third of the market carries is not information; it was deleted.
Neither is a correctness bug, so no unit test could have caught either. Only
running the predicate over the real universe shows it.

⛔ THE VERDICT IS ADVISORY, NOT A GATE. A genuinely rare structure (high
tight flag: 8 symbols) is legitimately "thin" and should still ship. The
point is that the number appears in the author's face and lands in the
catalog entry, so a surprising one is a decision rather than an accident.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Literal, TypedDict

DEAD_PCT = 0.0
THIN_PCT = 0.5      # origin: uct — below this, expect to justify the rarity
NOISE_PCT = 35.0    # origin: uct — the measured NR4 deletion threshold


class CoverageReport(TypedDict):
    hits: int
    total: int
    pct: float
    errors: int
    verdict: Literal["dead", "thin", "ok", "noise"]


def classify(pct: float) -> str:
    if pct <= DEAD_PCT:
        return "dead"
    if pct < THIN_PCT:
        return "thin"
    if pct > NOISE_PCT:
        return "noise"
    return "ok"


def coverage(predicate: Callable[[List[dict]], bool],
             bars_by_ticker: Dict[str, List[dict]]) -> CoverageReport:
    """Run `predicate` over every ticker's bars and report the hit-rate.

    A predicate that raises counts as a MISS and is tallied in `errors` —
    a structure that crashes on real data must not read as 0% coverage
    indistinguishable from one that simply never matches.
    """
    hits = errors = 0
    total = len(bars_by_ticker)
    for bars in bars_by_ticker.values():
        try:
            if predicate(bars):
                hits += 1
        except Exception:
            errors += 1
    pct = (100.0 * hits / total) if total else 0.0
    return {"hits": hits, "total": total, "pct": pct,
            "errors": errors, "verdict": classify(pct)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/pattern_engine/test_base_coverage.py -v`
Expected: 6 passed.

- [ ] **Step 5: Run the whole affected suite**

Run: `python -m pytest tests/pattern_engine -v`
Expected: all pass, including the pre-existing pattern-engine tests.

- [ ] **Step 6: Commit**

```bash
git add tools/base_coverage.py tests/pattern_engine/test_base_coverage.py
git commit -m "feat(tools): universe coverage harness for structure authoring"
```

---

## Done when

- `python -m pytest tests/pattern_engine -v` is green.
- `segment()` is prefix-stable under the extension test, and that test has been
  demonstrated to FAIL against a whole-series-sigma implementation (Task 1 Step 5).
- `fit_trendline(..., log_space=True)` reports a constant-percentage decline as
  parallel, and the arithmetic default is byte-for-byte unchanged.
- `roundness`, `rim_equality`, `symmetry` return `None` — never a default — on
  every unmeasurable input.
- No detector, column, filter or UI has been touched. That is the next plan.

## What this plan deliberately does NOT do

- No `base_catalog.py`, no `bases.py`, no structures. Next plan.
- No lift ledger. Plan after that.
- No change to `detect_pivots` or its callers.
- No volume gate anywhere, in any form (spec F3).
