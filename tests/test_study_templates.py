"""Templated lessons (spec §6.4): rule-filled from facts only, passing the
importer's grounding and voice checks by construction.

Run alone: python -m pytest tests/test_study_templates.py -q
"""
from __future__ import annotations

import random

import pytest

from api.services import study_import as si
from api.services import study_templates as st

DET = {"id": "d1", "pattern_id": "vcp", "direction": "bullish", "confidence": 84.6, "status": "completed"}
OUT = {"target_hit": 1, "stop_hit": 0, "bars_to_resolve": 13, "mfe_pct": 11.237, "mae_pct": 2.04}
GEOM = {"contractions": 3, "base_depth_pct": 12.44, "pivot": 51.25, "notes": "x"}
LEVELS = {"entry": 51.25, "stop": 48.1, "target_primary": 60.0}


def _facts(**over):
    kw = dict(name="VCP", family="Bases & Breakouts", geometry=GEOM, levels=LEVELS,
              regime_bucket="bull", rubric_essence="Three pullbacks, each one smaller.")
    kw.update(over)
    return st.facts_from_detection(DET, OUT, **kw)


def test_facts_round_and_derive_risk_reward():
    f = _facts()
    assert f["geometry"] == {"contractions": 3, "base_depth_pct": 12.44, "pivot": 51.25}
    assert f["levels"] == {"entry": 51.25, "stop": 48.1, "target": 60.0}
    assert f["outcome"] == "target_hit" and f["bars_to_resolve"] == 13
    assert f["mfe_pct"] == 11.2 and f["mae_pct"] == 2.0 and f["confidence"] == 85
    assert f["risk_pct"] == 6.1 and f["reward_pct"] == 17.1 and f["rr"] == 2.8
    assert f["window"] == st.NEXT_WINDOW_SESSIONS == 20
    assert f["rubric_essence"] == "Three pullbacks, each one smaller."


def test_a_rubric_essence_that_fails_voice_is_dropped_not_rewritten():
    f = _facts(rubric_essence="A coil — then the pop.")
    assert "rubric_essence" not in f


def test_outcome_from_status_when_no_outcome_row():
    f = st.facts_from_detection({**DET, "status": "failed"}, None, name="VCP", family=None)
    assert f["outcome"] == "stop_hit" and "bars_to_resolve" not in f


@pytest.mark.parametrize("item_type", ["spot", "levels", "next", "family"])
def test_each_template_passes_grounding_and_voice(item_type):
    f = _facts()
    lesson = st.render(item_type, f)
    assert lesson and st.verify(lesson, f) == [], lesson
    assert "—" not in lesson


def test_spot_lesson_reads_the_facts():
    f = _facts()
    s = st.render("spot", f)
    assert s.startswith("This is a VCP, one of the Bases & Breakouts setups.")
    assert "85 confidence" in s and "contractions 3" in s and "base depth 12.44%" in s
    assert "Entry 51.25, stop 48.1, target 60." in s
    assert "The market read bull at the time." in s
    assert "after 13 sessions" in s and "11.2% of room" in s
    assert s.endswith("Three pullbacks, each one smaller.")


def test_levels_and_next_and_family_lessons():
    f = _facts()
    assert "Risk to the stop 6.1%, room to the target 17.1%, 2.8R." in st.render("levels", f)
    assert st.render("next", f).startswith("Cut at the detection bar. One window: the next 20 sessions.")
    fam = st.render("family", f)
    assert fam.startswith("VCP sits in Bases & Breakouts.") and st.FAMILY_LINES["Bases & Breakouts"] in fam


def test_stop_and_expired_outcomes():
    f = st.facts_from_detection({**DET, "status": "failed"},
                                {"target_hit": 0, "stop_hit": 1, "bars_to_resolve": 4, "mfe_pct": 1.5, "mae_pct": 7.26},
                                name="Bull Flag", family="Bases & Breakouts", levels=LEVELS)
    s = st.render("spot", f)
    assert "It failed. The stop printed after 4 sessions. The worst point was 7.3% against it." in s
    assert st.verify(s, f) == []
    f2 = st.facts_from_detection({**DET, "status": "expired"}, None, name="Bull Flag", family=None)
    s2 = st.render("next", f2)
    assert "Undecided. Neither the stop nor the target printed inside 20 sessions." in s2
    assert st.verify(s2, f2) == []


def test_unknown_type_raises():
    with pytest.raises(ValueError):
        st.render("recall", _facts())


def test_fuzz_many_random_facts_stay_grounded_and_in_voice():
    """The whole point of a template: no fact set can make it write a number
    it does not hold or a sentence the voice rules reject."""
    rng = random.Random(7)
    names = ["VCP", "20 EMA Pullback", "2B Reversal", "Kicker Candle", "High Tight Flag"]
    fams = list(st.FAMILY_LINES) + [None]
    for i in range(300):
        det = {"pattern_id": "p", "direction": rng.choice(["bullish", "bearish"]),
               "confidence": rng.uniform(70, 99.99), "status": rng.choice(["completed", "failed", "expired"])}
        out = None if rng.random() < 0.2 else {
            "target_hit": int(det["status"] == "completed"), "stop_hit": int(det["status"] == "failed"),
            "bars_to_resolve": rng.randint(1, 210), "mfe_pct": rng.uniform(0, 40), "mae_pct": rng.uniform(0, 15)}
        geom = {k: rng.uniform(0.01, 300) for k in rng.sample(st.GEOMETRY_ORDER, rng.randint(0, 5))}
        geom["contractions"] = rng.randint(1, 6)
        entry = rng.uniform(1, 900)
        levels = {"entry": entry, "stop": entry * rng.uniform(0.8, 0.99), "target_primary": entry * rng.uniform(1.01, 1.5)}
        if rng.random() < 0.15:
            levels = {}
        f = st.facts_from_detection(det, out, name=rng.choice(names), family=rng.choice(fams),
                                    geometry=geom, levels=levels,
                                    regime_bucket=rng.choice(["bull", "bear", "neutral", None]))
        for t in ("spot", "levels", "next", "family"):
            lesson = st.render(t, f)
            assert st.verify(lesson, f) == [], (i, t, lesson, f)
            assert si.voice_check(lesson, lesson=True) == []


def test_lesson_origin_constant():
    assert st.LESSON_ORIGIN == "template"
