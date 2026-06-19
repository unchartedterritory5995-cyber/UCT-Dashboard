from api.services.pattern_vision import rubrics


def test_every_focused_setup_has_a_structured_rubric():
    for s in rubrics.FOCUSED_SETUPS:
        r = rubrics.RUBRICS[s]
        assert r["essence"] and len(r["must_haves"]) >= 2 and len(r["disqualifiers"]) >= 1


def test_rubric_for_renders_criteria():
    text = rubrics.rubric_for("vcp")
    assert "MUST be visibly true" in text and "REJECT if" in text
    assert "tighter" in text.lower()


def test_rubric_for_fallback():
    assert "chart" in rubrics.rubric_for("unknown_setup").lower()


def test_criteria_for_returns_must_haves():
    crit = rubrics.criteria_for("bull_flag")
    assert isinstance(crit, list) and len(crit) >= 2
    assert rubrics.criteria_for("nope") == []
