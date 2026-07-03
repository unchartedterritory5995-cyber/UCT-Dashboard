def test_verdict_protocol_in_mentor_two_lane():
    from api.services.journal_two import coach_prompts as cp
    t = cp.MENTOR_TWO_LANE
    assert "Verdict protocol" in t
    assert "grade_ticker" in t
    assert "GO/HOLD/SKIP" in t or "GO / HOLD / SKIP" in t
    # regime-first + no free-form trade call are mandated
    assert "regime" in t.lower() and "never" in t.lower()


def test_voice_reexport_still_resolves():
    from api.services.journal_two import coach_prompts as cp
    from api.services.voice_prompts import compass as vp
    assert vp._MENTOR_TWO_LANE is cp.MENTOR_TWO_LANE
