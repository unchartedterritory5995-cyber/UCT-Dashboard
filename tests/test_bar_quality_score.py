from unittest.mock import patch
from api.services import bar_quality_score as qs


def test_perfect_score():
    """No quarantines, all bars validated, all sources verified, fresh, complete."""
    with patch.object(qs, "_validation_pass_rate", return_value=1.0), \
         patch.object(qs, "_source_agreement_rate", return_value=1.0), \
         patch.object(qs, "_hours_since_last_corruption", return_value=999), \
         patch.object(qs, "_completeness_score", return_value=1.0), \
         patch.object(qs, "_freshness_score", return_value=1.0):
        score = qs.compute("QQQ")
    assert score == 100


def test_zero_score_with_no_data():
    """Empty cache → 0 score."""
    with patch.object(qs, "_validation_pass_rate", return_value=0.0), \
         patch.object(qs, "_source_agreement_rate", return_value=0.0), \
         patch.object(qs, "_hours_since_last_corruption", return_value=0), \
         patch.object(qs, "_completeness_score", return_value=0.0), \
         patch.object(qs, "_freshness_score", return_value=0.0):
        score = qs.compute("QQQ")
    assert score == 0


def test_partial_score_weights_signals():
    """50% validation + everything else perfect → ~80%."""
    with patch.object(qs, "_validation_pass_rate", return_value=0.5), \
         patch.object(qs, "_source_agreement_rate", return_value=1.0), \
         patch.object(qs, "_hours_since_last_corruption", return_value=999), \
         patch.object(qs, "_completeness_score", return_value=1.0), \
         patch.object(qs, "_freshness_score", return_value=1.0):
        score = qs.compute("QQQ")
    # Validation has 40% weight; 50% validation = -20pts → ~80
    assert 75 <= score <= 85


def test_corruption_age_decay():
    """Recent corruption (1hr ago) lowers score; old corruption (>72hr) doesn't."""
    with patch.object(qs, "_validation_pass_rate", return_value=1.0), \
         patch.object(qs, "_source_agreement_rate", return_value=1.0), \
         patch.object(qs, "_completeness_score", return_value=1.0), \
         patch.object(qs, "_freshness_score", return_value=1.0):
        with patch.object(qs, "_hours_since_last_corruption", return_value=0):
            recent = qs.compute("QQQ")
        with patch.object(qs, "_hours_since_last_corruption", return_value=72):
            old = qs.compute("QQQ")
    assert recent < old
    assert old == 100  # everything perfect, oldest corruption


def test_compute_universe_returns_dict():
    with patch.object(qs, "compute", side_effect=lambda t: 95):
        scores = qs.compute_universe(["QQQ", "SPY", "AAPL"])
    assert scores == {"QQQ": 95, "SPY": 95, "AAPL": 95}


def test_compute_returns_int():
    score = qs.compute("QQQ")  # uses real defaults
    assert isinstance(score, int)
    assert 0 <= score <= 100
