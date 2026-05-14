"""Tests for CAN SLIM scoring (William O'Neil's 7-pillar framework)."""
from api.services.pattern_engine.primitives.can_slim import can_slim_score


def _bars(closes, vols=None):
    if vols is None:
        vols = [1000000] * len(closes)
    return [{"t": i * 86400, "o": c, "h": c * 1.005, "l": c * 0.995, "c": c, "v": v}
            for i, (c, v) in enumerate(zip(closes, vols))]


def test_can_slim_score_returns_required_keys():
    bars = _bars([100 + i for i in range(300)])
    ctx = {"trend_stage": 2, "regime": "bull", "rs_trend": "up",
           "dcr_signature": "accumulation", "volume_signature": "contracting"}
    r = can_slim_score(bars, ctx)
    for key in ("composite_score", "c_score", "a_score", "n_score",
                "s_score", "l_score", "i_score", "m_score", "grade", "interpretation"):
        assert key in r


def test_can_slim_strong_uptrend_grades_high():
    """Strong uptrend + high volume + accumulation + bull regime should grade A or B."""
    bars = _bars([100 + i * 0.5 for i in range(300)], [2_000_000] * 300)
    ctx = {"trend_stage": 2, "regime": "bull", "rs_trend": "up",
           "dcr_signature": "accumulation", "volume_signature": "contracting"}
    r = can_slim_score(bars, ctx)
    assert r["grade"] in ("A", "B")
    assert r["composite_score"] >= 65


def test_can_slim_downtrend_grades_low():
    """Strong downtrend + low volume + distribution + bear regime should grade C or D."""
    bars = _bars([200 - i * 0.3 for i in range(300)], [200_000] * 300)
    ctx = {"trend_stage": 4, "regime": "bear", "rs_trend": "down",
           "dcr_signature": "distribution", "volume_signature": "expanding"}
    r = can_slim_score(bars, ctx)
    assert r["grade"] in ("C", "D")
    assert r["composite_score"] <= 50


def test_n_score_at_52w_high():
    """At 52w high, N score should be 100."""
    bars = _bars([90 + i * 0.1 for i in range(250)] + [115] * 5)
    ctx = {}
    r = can_slim_score(bars, ctx)
    assert r["n_score"] >= 90


def test_i_score_low_volume_penalizes():
    bars = _bars([100] * 100, [50_000] * 100)
    ctx = {}
    r = can_slim_score(bars, ctx)
    assert r["i_score"] < 40


def test_short_series_returns_empty_result():
    bars = _bars([100, 101, 102])
    ctx = {}
    r = can_slim_score(bars, ctx)
    assert r["interpretation"].startswith("Insufficient data")


def test_grade_thresholds_consistent():
    """Verify the grade thresholds line up with composite scores."""
    # Tweak inputs to land exactly in each band
    # Grade A: strong uptrend with everything firing
    strong_bars = _bars([100 + i * 0.8 for i in range(300)], [8_000_000] * 300)
    strong_ctx = {"trend_stage": 2, "regime": "bull", "rs_trend": "up",
                  "sector_strength_rank": 1,
                  "dcr_signature": "accumulation", "volume_signature": "contracting"}
    strong = can_slim_score(strong_bars, strong_ctx)
    assert strong["composite_score"] >= 80
    assert strong["grade"] == "A"


def test_interpretation_mentions_grade():
    bars = _bars([100 + i * 0.5 for i in range(300)], [2_000_000] * 300)
    ctx = {"trend_stage": 2, "regime": "bull", "rs_trend": "up",
           "dcr_signature": "accumulation", "volume_signature": "contracting"}
    r = can_slim_score(bars, ctx)
    assert f"Grade {r['grade']}" in r["interpretation"]
