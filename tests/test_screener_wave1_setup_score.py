"""Deterministic score fixture, hand-walked against the scanner rubric."""
from api.services.screener import setup_score


def bar(c, o=None, h=None, l=None, v=1000):
    o = c if o is None else o
    return {"o": o, "h": h if h is not None else max(o, c) + 0.5,
            "l": l if l is not None else min(o, c) - 0.5, "c": c, "v": v}


def test_flat_tape_score_hand_computed():
    """25 flat bars @100, equal volume, o==c, h/l ±0.5.
    EMA kiss (low 99.5 <= 100*1.005)      +25
    vol at 20-bar min (all equal)          +20
    avg body 0.0 < 0.30                    +15
    close_position 0.5 -> no points          0
    close CV 0 < 2.5                       +10
    pole 0                                   0
    vol_updown: no up days -> sentinel 1.0  +5
    total                                    75
    """
    bars = [bar(100.0) for _ in range(25)]
    out = setup_score.compute(bars, pole_pct=0.0)
    assert out["candle_score"] == 75
    assert out["vol_nweek_low"] == 20
    # ema20_series is SMA-seeded at bar 20, so with exactly 25 bars it only
    # has 6 entries (len(closes)-20+1) — the touch-count window checks the
    # last 15 bars but only the last 6 have a computed EMA20 to compare
    # against (0 <= idx < len(ema20_series) correctly skips the other 9).
    # Verified independently against a 40-bar flat tape (realistic scanner
    # history), where ema20_series has 21 entries and the count reaches the
    # full 15 — this fixture is simply shorter than the touch-count window.
    assert out["ema_touch_count"] == 6
    assert out["ema20_rising"] is False        # zero slope is not rising
    assert out["ema_stack_intact"] is False    # close == ema10, not above
    assert out["vol_updown_ratio"] is None     # no up days -> undefined COLUMN


def test_pole_points_ride_on_top():
    bars = [bar(100.0) for _ in range(25)]
    base = setup_score.compute(bars, pole_pct=0.0)["candle_score"]
    assert setup_score.compute(bars, pole_pct=45.0)["candle_score"] == base + 15
    assert setup_score.compute(bars, pole_pct=25.0)["candle_score"] == base + 10
    assert setup_score.compute(bars, pole_pct=12.0)["candle_score"] == base + 5


def test_insufficient_or_zero_range_is_all_none():
    assert setup_score.compute([bar(100.0)] * 20)["candle_score"] is None
    bars = [bar(100.0) for _ in range(24)] + [
        {"o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0, "v": 1000}]
    assert setup_score.compute(bars)["candle_score"] is None


def test_emits_only_its_own_columns():
    out = setup_score.compute([bar(100.0) for _ in range(25)])
    assert "avg_body_pct_5" not in out and "close_cv_pct" not in out
    assert "pct_vs_ema20" not in out and "vol_ratio" not in out
