from api.services.pattern_vision import rubrics


def test_every_focused_setup_has_a_rubric():
    for s in rubrics.FOCUSED_SETUPS:
        assert s in rubrics.RUBRICS and len(rubrics.RUBRICS[s]) > 40


def test_rubric_for_fallback():
    assert "chart" in rubrics.rubric_for("unknown_setup").lower()
