"""Phase 6, Group 2 — shared liquidity/price-floor primitive (2026-09-03).

⛔⛔ THE CONFIRMED DEFECT (six families). Phase 5's Tier-1 validation audit
reproduced live false positives on penny-stock / corporate-action-style /
near-dead-volume synthetic series across bull_flag, bullish_engulfing,
bearish_engulfing, high_tight_flag, flat_base (System A) plus
flat_base_state/ascending_base_state (System D), and power_earnings_gap.
None of the six gated on price or liquidity anywhere -- confirmed by grep
(no 'min_price'/'penny'/'liquidity'/'adv_dollars' in any of the six files)
and by direct reproduction:
  - bull_flag: $1.00 penny stock, 250-500 shares/day, fired at 92.5%.
  - bullish_engulfing: sub-$1 penny two-bar pair, 91.5%-wick, fired at 57.19
    (geometry_score only 26.73/100 -- volume/context scores compensated).
  - high_tight_flag: 3-bar pole, flag_volume_ratio as low as 0.013, fired
    at 82.5 -- despite the module docstring's claimed-but-fictional
    "avg daily volume >= 200K" gate.
  - flat_base (System A): $0.35/share, ~$750/day dollar volume, fired at
    67.6 with "institutional sponsorship" narrative.
  - ascending_base_state (System D): pivot=0.225 on a $0.10-$0.125 stock,
    fired True.
  - power_earnings_gap: $0.45 stock, 150K-480K share volume, fired at
    78.62 with full entry/stop/target levels.

The fix: one shared primitive, `api/services/pattern_engine/primitives/
liquidity.py::liquidity_floor` (min_price=$2.00, min_avg_dollar_volume=
$10,000 over 20 bars -- both calibrated against MEASURED fixture data, see
that module's docstring), wired as a hard gate at the top of all six
detect_* entry points plus base_catalog.py's flat_base_qualifies (which
flat_base_state/base_on_base_state/base_stack all route through) and
ascending_base_state.

This file proves the fix two ways per family: (1) a PRICE-SCALED variant
of a real, geometrically-valid positive fixture -- same relative geometry
(all ratios preserved by uniform scaling), only priced as a penny stock --
must now be refused; (2) the same fixture at its real price must still
fire, proving the scaling didn't accidentally break the geometry and that
legitimate positives survive the correction.
"""
import json
import pathlib

import pytest

from api.services.pattern_engine.detectors.classical.bull_flag import detect_bull_flag
from api.services.pattern_engine.detectors.candlestick.bullish_engulfing import detect_bullish_engulfing
from api.services.pattern_engine.detectors.candlestick.bearish_engulfing import detect_bearish_engulfing
from api.services.pattern_engine.detectors.uct.high_tight_flag import detect_high_tight_flag
from api.services.pattern_engine.detectors.uct.flat_base import detect_flat_base
from api.services.pattern_engine.detectors.uct.power_earnings_gap import detect_power_earnings_gap
from api.services.pattern_engine.primitives.context import build_context
from api.services.pattern_engine.primitives.liquidity import liquidity_floor
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures

FIXTURES_ROOT = pathlib.Path(__file__).resolve().parents[2] / "fixtures"

_FAMILIES = [
    ("bull_flag", "clean_textbook.json", detect_bull_flag),
    ("bullish_engulfing", "after_decline_distribution_signature.json", detect_bullish_engulfing),
    ("bearish_engulfing", "after_advance_accumulation_signature.json", detect_bearish_engulfing),
    ("high_tight_flag", "clean_textbook.json", detect_high_tight_flag),
    ("flat_base", "clean_textbook.json", detect_flat_base),
    ("power_earnings_gap", "clean_textbook.json", detect_power_earnings_gap),
]

# Scales a real, geometrically-valid fixture down to penny-stock pricing
# while preserving every ratio the detectors actually gate on (all of
# geometry/volume scoring is ratio-based, so uniform scaling can't change
# whether the SHAPE would have fired -- only the liquidity gate can).
_PENNY_PRICE_FACTOR = 0.02   # e.g. $50 -> $1.00
_PENNY_VOLUME_FACTOR = 0.05  # thin the tape too, matching the reproduced cases


def _load(fam, name):
    with open(FIXTURES_ROOT / fam / name, encoding="utf-8") as f:
        fx = json.load(f)
    return fx["bars"], fx.get("context")


def _scaled_penny_bars(bars):
    out = []
    for b in bars:
        out.append({
            "t": b["t"],
            "o": round(b["o"] * _PENNY_PRICE_FACTOR, 4),
            "h": round(b["h"] * _PENNY_PRICE_FACTOR, 4),
            "l": round(b["l"] * _PENNY_PRICE_FACTOR, 4),
            "c": round(b["c"] * _PENNY_PRICE_FACTOR, 4),
            "v": max(1.0, round(b["v"] * _PENNY_VOLUME_FACTOR, 0)),
        })
    return out


def _ctx(bars, context):
    return context if context is not None else build_context(bars, sym="TEST")


# ─── the primitive itself ─────────────────────────────────────────────────

def test_liquidity_floor_rejects_a_penny_price():
    bars = [{"t": i, "o": 1.0, "h": 1.05, "l": 0.95, "c": 1.0, "v": 100_000.0} for i in range(25)]
    check = liquidity_floor(bars)
    assert not check.passes
    assert "price" in check.reason


def test_liquidity_floor_rejects_near_dead_volume_even_at_a_healthy_price():
    bars = [{"t": i, "o": 20.0, "h": 20.1, "l": 19.9, "c": 20.0, "v": 10.0} for i in range(25)]
    check = liquidity_floor(bars)
    assert not check.passes
    assert "dollar volume" in check.reason


def test_liquidity_floor_passes_a_normal_liquid_series():
    bars = [{"t": i, "o": 50.0, "h": 50.5, "l": 49.5, "c": 50.0, "v": 1000.0} for i in range(25)]
    check = liquidity_floor(bars)
    assert check.passes
    assert check.reason is None


def test_liquidity_floor_reproduces_each_phase5_penny_case_by_price_alone():
    """Every Phase-5-reproduced false positive was priced at or under $1.00 --
    confirm the floor rejects each one on price, independent of its volume."""
    for price, vol in [(1.00, 375.0), (0.45, 300_000.0), (0.35, 2143.0), (0.125, 50_000.0)]:
        bars = [{"t": i, "o": price, "h": price * 1.02, "l": price * 0.98,
                  "c": price, "v": vol} for i in range(25)]
        assert not liquidity_floor(bars).passes, (
            f"price=${price} volume={vol} should have been refused"
        )


# ─── per-family: penny-scaled variant refused, real-price variant fires ──

@pytest.mark.parametrize("fam,fixture_name,detect_fn", _FAMILIES, ids=[f[0] for f in _FAMILIES])
def test_penny_scaled_variant_of_a_real_positive_fixture_is_refused(fam, fixture_name, detect_fn):
    """⭐⭐ THE FIX. Same geometry, penny pricing -- must not fire."""
    bars, context = _load(fam, fixture_name)
    penny_bars = _scaled_penny_bars(bars)
    ctx = _ctx(penny_bars, context)
    detections = detect_fn(penny_bars, ctx)
    assert detections == [], (
        f"{fam}/{fixture_name}: a penny-scaled variant of a real positive "
        f"fixture still fired {len(detections)} detection(s)"
    )


@pytest.mark.parametrize("fam,fixture_name,detect_fn", _FAMILIES, ids=[f[0] for f in _FAMILIES])
def test_the_same_fixture_at_its_real_price_still_fires(fam, fixture_name, detect_fn):
    """Control: the scaling itself didn't break the geometry, and the
    liquidity fix didn't create a new false-negative class at real prices."""
    bars, context = _load(fam, fixture_name)
    ctx = _ctx(bars, context)
    detections = detect_fn(bars, ctx)
    assert detections, (
        f"{fam}/{fixture_name}: expected to still fire at its real price"
    )


# ─── System D: base_catalog.py's flat_base_qualifies / ascending_base_state ─

def test_flat_base_qualifies_rejects_a_penny_scaled_qualifying_base():
    from api.services.screener import base_catalog as bc

    bars = []
    t = 20240000
    price = 40.0
    for i in range(60):  # prior advance
        price += 0.33
        bars.append({"t": t + i, "o": price, "c": price,
                      "h": price * 1.0025, "l": price * 0.9975, "v": 1_000_000})
    top = price
    for i in range(30):  # tight flat base
        c = top - (0.0 if i == 0 else (0.03 if i % 2 else 0.05))
        bars.append({"t": t + 60 + i, "o": c, "c": c,
                      "h": c * 1.0015, "l": c * 0.9985, "v": 1_000_000})

    st = bc.flat_base_state(bars)
    assert bc.flat_base_qualifies(st, bars), "control fixture must qualify at real pricing"

    penny_bars = _scaled_penny_bars(bars)
    penny_st = bc.flat_base_state(penny_bars)
    assert not bc.flat_base_qualifies(penny_st, penny_bars), (
        "a penny-scaled variant of a qualifying flat base must be refused"
    )


def test_ascending_base_state_rejects_a_penny_priced_staircase():
    from api.services.screener import base_catalog as bc
    from api.services.screener import bases

    # A clean 3-pullback staircase, well within ASC_MIN_BARS..ASC_MAX_BARS.
    bars = []
    t = 20240000
    price = 40.0
    for i in range(60):
        price += 0.5
        bars.append({"t": t + i, "o": price, "c": price,
                      "h": price * 1.003, "l": price * 0.997, "v": 500_000})
    swings = []
    cur = price
    idx = 60
    # ASC_MIN_BARS=45..ASC_MAX_BARS=80 is measured from the FIRST high to the
    # THIRD low (span = end - start) -- a 12-bar gap each side of every
    # pullback (24 bars/step) gives a 48-bar span across the 2 inter-step
    # gaps, comfortably inside the window.
    for step in range(3):
        hi = cur
        swings.append({"type": "high", "price": hi, "bar_index": idx})
        bars.append({"t": t + idx, "o": hi, "c": hi, "h": hi * 1.001, "l": hi * 0.999, "v": 500_000})
        idx += 12
        lo = hi * (1.0 - 0.15)
        swings.append({"type": "low", "price": lo, "bar_index": idx})
        bars.append({"t": t + idx, "o": lo, "c": lo, "h": lo * 1.001, "l": lo * 0.999, "v": 500_000})
        idx += 12
        cur = hi * 1.05

    class _Ctx:
        pass

    ctx = _Ctx()
    ctx.bars = bars
    ctx.swings = swings
    st = bc.ascending_base_state(ctx)
    assert st is not None, "control fixture must qualify at real pricing"

    penny_bars = _scaled_penny_bars(bars)
    penny_ctx = _Ctx()
    penny_ctx.bars = penny_bars
    penny_ctx.swings = swings  # bar_index positions are unaffected by price scaling
    penny_st = bc.ascending_base_state(penny_ctx)
    assert penny_st is None, (
        "a penny-priced variant of a qualifying ascending-base staircase "
        "must be refused"
    )


# ─── classification unchanged at real prices, across the full battery ───

@pytest.mark.parametrize("fam,_fixture_name,detect_fn", _FAMILIES, ids=[f[0] for f in _FAMILIES])
def test_full_battery_classification_preserved_at_real_prices(fam, _fixture_name, detect_fn):
    fixtures = load_all_fixtures(fam, include_internal=False)
    assert len(fixtures) >= 10
    for fixture in fixtures:
        ctx = fixture.context if fixture.context is not None else build_context(fixture.bars, sym="TEST")
        detections = detect_fn(fixture.bars, ctx)
        if fixture.expected_fires:
            assert len(detections) >= 1, f"{fam}/{fixture.name} stopped firing"
            d = max(detections, key=lambda x: x["confidence"])
            assert fixture.min_confidence <= d["confidence"] <= fixture.max_confidence, (
                f"{fam}/{fixture.name}: confidence {d['confidence']:.1f} moved "
                f"outside its previously-passing band"
            )
        else:
            for d in detections:
                assert d["confidence"] < 50.0, (
                    f"{fam}/{fixture.name}: a previously-non-firing case now "
                    f"clears the confidence floor"
                )
