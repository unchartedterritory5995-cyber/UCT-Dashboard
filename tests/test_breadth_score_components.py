from api.services.breadth_monitor import _score_breakdown, _compute_breadth_score

FULL_ROW = {
    "pct_above_50sma": 65, "ratio_5day": 1.5, "magna_up": 70, "magna_down": 30,
    "hi_ratio": 5.0, "cboe_putcall": 0.85, "aaii_spread": -30, "vix": 18,
    "stage2_count": 1250, "universe_count": 5000, "adv_decline": 900,
}


def test_breakdown_total_matches_the_score_function():
    total, _ = _score_breakdown(FULL_ROW)
    assert total == _compute_breadth_score(FULL_ROW)


def test_points_renormalize_to_the_reported_total():
    total, comps = _score_breakdown(FULL_ROW)
    have = sum(c["weight"] for c in comps if c["present"])
    earned = sum(c["points"] for c in comps if c["present"])
    assert round(min(100, max(0, earned / have * 100)), 1) == total


def test_a_missing_input_is_dropped_from_both_sides_not_scored_zero():
    row = dict(FULL_ROW)
    row["cboe_putcall"] = None
    total, comps = _score_breakdown(row)
    pc = next(c for c in comps if c["key"] == "cboe_putcall")
    assert pc["present"] is False
    assert pc["points"] == 0
    # Renormalization means dropping a maxed component must NOT lower the score
    # the way scoring it zero would have.
    assert total == _compute_breadth_score(row)
    have = sum(c["weight"] for c in comps if c["present"])
    assert have == 100 - pc["weight"]


def test_returns_none_below_the_minimum_available_weight():
    total, comps = _score_breakdown({"vix": 18})
    assert total is None
    assert sum(c["weight"] for c in comps if c["present"]) < 60


def test_every_component_reports_its_ceiling():
    _, comps = _score_breakdown(FULL_ROW)
    for c in comps:
        assert c["max_points"] == c["weight"]
        assert c["points"] <= c["max_points"] + 1e-9
