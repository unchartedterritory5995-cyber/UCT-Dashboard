"""scripts/study/gen_kicker_levels.py: `levels` items (the entry line and the
stop) for the Kicker charts the owner kept, per his rulings of 2026-11-02
(entry = a stop-buy 0.01 over the red day's high; stop = the Kicker's low
when within 3.5% of the fill, else 3.5% under it; no target, sell rules are
not ruled). Run alone: python -m pytest tests/test_study_gen_kicker_levels.py -q
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import study_import as si
from api.services.study_scoring import score_levels
from scripts.study import _common, gen_kicker_levels as gk

REPO = pathlib.Path(__file__).resolve().parent.parent
SEGMENT = REPO / "docs" / "study" / "bank" / "levels.kicker.json"


def _bar(t, o, h, l, c):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": 1_000_000}


def _tape(red, kicker):
    flat = [_bar(20240100 + d, 100, 101, 99, 100) for d in range(1, 30)]
    return flat + [red, kicker]


def test_the_line_is_a_cent_over_the_red_high_and_the_stop_is_the_kicker_low_when_tight():
    bars = _tape(_bar(20240130, 100.5, 101.0, 99.0, 99.2), _bar(20240131, 100.2, 104.0, 99.6, 103.8))
    f = gk.house_levels(bars)
    assert f["entry"] == 101.01 and f["gapped_over_trigger"] is False and f["fill"] == 101.01
    assert f["stop"] == 99.6 and f["stop_basis"] == "kicker_low"
    assert f["kicker_low_pct"] == round((101.01 - 99.6) / 101.01 * 100, 2) and f["stop_wider_than_max"] is False
    assert f["atr14"] and f["tolerance"] >= 0.01 * f["entry"]


def test_a_gap_over_the_line_fills_at_the_open_and_the_stop_is_judged_from_the_fill():
    # the Kicker's low sits ABOVE the line: a stop under the low still protects a fill at the open
    bars = _tape(_bar(20240130, 100.5, 101.0, 99.0, 99.2), _bar(20240131, 103.0, 105.0, 102.2, 104.6))
    f = gk.house_levels(bars)
    assert f["entry"] == 101.01 and f["gapped_over_trigger"] is True and f["fill"] == 103.0
    assert f["stop"] == 102.2 and f["stop_basis"] == "kicker_low" and f["kicker_low_pct"] == round(0.8 / 103.0 * 100, 2)
    text = gk.lesson(f)
    assert "opened at 103.00, above the line, so the order filled at the open" in text
    assert "the stop is 102.20, the Kicker's low" in text and "None" not in text


def test_a_wide_kicker_low_gives_the_three_and_a_half_percent_stop_and_is_flagged():
    bars = _tape(_bar(20240130, 100.5, 101.0, 99.0, 99.2), _bar(20240131, 100.5, 108.0, 96.0, 107.5))
    f = gk.house_levels(bars)
    assert f["stop_basis"] == "max_stop_pct" and f["stop_wider_than_max"] is True
    assert f["stop"] == round(101.01 * 0.965, 2) and f["stop_pct"] == 3.5
    assert "wider than 3.5%, so the stop is" in gk.lesson(f) and "3.5% under the fill" in gk.lesson(f)


def test_a_last_bar_that_did_not_clear_the_red_high_is_refused():
    with pytest.raises(ValueError, match="not the Kicker"):
        gk.house_levels(_tape(_bar(20240130, 100.5, 101.0, 99.0, 99.2), _bar(20240131, 99.5, 100.9, 98.0, 100.5)))


def test_the_committed_segment_validates_and_every_key_scores_itself():
    items = json.loads(SEGMENT.read_text(encoding="utf-8"))
    assert len(items) >= 10
    assert _common.validate(items) == []
    for it in items:
        assert it["type"] == "levels" and it["skill_id"] == gk.SKILL and it["review_status"] == "draft"
        assert it["prompt_json"]["roles"] == ["entry", "stop"] and "target" not in it["answer_json"]
        key = it["answer_json"]
        ok = score_levels({"entry": key["entry"], "stop": key["stop"]}, key)
        assert ok.correct
        # a line two tolerances off is wrong; the tolerance is the scorer's own (0.75 ATR14 or 1%)
        tol = ok.detail["levels"]["entry"]["tolerance"]
        off = score_levels({"entry": key["entry"] + 2 * tol, "stop": key["stop"]}, key)
        assert not off.correct and off.score == 0.5
        facts = it["reveal_json"]["facts"]
        assert facts["kicker_low"] <= facts["fill"] and facts["stop"] <= facts["fill"]
        assert it["reveal_json"]["example_grade"] in ("okay", "good", "great")
        assert si.grounding_check(it) == [] and "None" not in it["lesson_text"]


def test_only_the_owners_kept_kickers_are_drafted():
    kept = gk.kept_kickers()
    assert ("JBI", "2023-12-14") in kept and kept[("JBI", "2023-12-14")]["grade"] == "great"
    assert ("GRMN", "2024-05-01") not in kept          # "plainly just an earnings gapper": cut
    assert ("ISRG", "2025-01-15") in kept and kept[("ISRG", "2025-01-15")]["verdict"] == "keep_lesser"
    items = json.loads(SEGMENT.read_text(encoding="utf-8"))
    assert {(i["sym"], i["asof"]) for i in items} <= set(kept)
