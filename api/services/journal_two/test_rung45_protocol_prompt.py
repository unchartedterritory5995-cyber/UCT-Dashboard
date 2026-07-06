import re


def test_multi_name_portfolio_protocol_present():
    from api.services.journal_two import coach_prompts as cp
    t = cp.MENTOR_TWO_LANE
    n = re.sub(r"\s+", " ", t)  # normalize source line-wrapping
    assert "§11b" in t
    assert "grade_watchlist" in n and "portfolio_heat" in n
    assert "instead of verdicts" in n            # forbids a priority-order dodge
    assert "what's your account size" in n.lower()
    assert "10% aggregate" in n
    assert "sit on your hands" in n
    assert "average-down" in n.lower() and "red" in n.lower()


def test_voice_reexport_still_resolves():
    from api.services.journal_two import coach_prompts as cp
    from api.services.voice_prompts import compass as vp
    assert vp._MENTOR_TWO_LANE is cp.MENTOR_TWO_LANE
