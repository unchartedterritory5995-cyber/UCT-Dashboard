"""Study scoring: pure functions per item type (spec §7.1 "Scoring").

Run alone: python -m pytest tests/test_study_scoring.py -q
"""
from __future__ import annotations

import pytest

from api.services import study_scoring as sc


# ── exact family ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("t", ["recall", "regime", "family", "call_scan", "call_archive", "grade",
                               "spot", "listen", "scenario"])
def test_exact_types_match_case_and_whitespace_insensitively(t):
    assert sc.score(t, " yellow ", {"answer": "YELLOW"}).correct
    assert sc.score(t, {"answer": "Yellow"}, "YELLOW").correct
    v = sc.score(t, "green", {"answer": "YELLOW"})
    assert not v.correct and v.score == 0.0 and v.detail["expected"] == "YELLOW"


def test_exact_accepts_aliases_and_the_watch_band():
    key = {"answer": "take", "accept": ["watch"]}      # C17: neither trigger nor stop printed
    assert sc.score("call_scan", "watch", key).correct
    assert not sc.score("call_scan", "pass", key).correct


def test_exact_empty_answer_is_wrong():
    assert not sc.score("recall", None, {"answer": "a"}).correct
    assert not sc.score("recall", "", {"answer": ""}).correct


def test_match_scores_fraction_and_needs_all_for_correct():
    key = {"pairs": {"bid": "d1", "ask": "d2", "spread": "d3", "float": "d4", "volume": "d5"}}
    v = sc.score("match", {"bid": "d1", "ask": "d2", "spread": "d3", "float": "d5", "volume": "d4"}, key)
    assert not v.correct and v.score == 0.6
    assert sc.score("match", dict(key["pairs"]), key).correct
    assert sc.score("match", "junk", key).score == 0.0
    assert not sc.score("match", {}, {"pairs": {}}).correct


def test_rubric_rows_score_hits_minus_false_ticks():
    key = {"rows": ["idea", "execution", "preparation"]}
    assert sc.score("autopsy", {"rows": ["idea", "execution", "preparation"]}, key).correct
    v = sc.score("autopsy", ["idea", "sizing"], key)
    assert not v.correct and v.score == 0.0           # 1 hit − 1 extra = 0
    v = sc.score("autopsy", ["idea", "execution"], key)
    assert v.score == pytest.approx(2 / 3, abs=1e-3) and v.detail["missed"] == 1
    # a grade key carrying rows routes to the rubric too
    assert sc.score("grade", {"rows": ["a"]}, {"rows": ["a"]}).correct


# ── size ──────────────────────────────────────────────────────────────────────

def test_size_from_stop_house_formula():
    r = sc.size_from_stop(100_000, 1.0, 50.0, 47.5)
    assert r == {"skip": False, "shares": 400, "dollars": 20000.0, "risk_dollars": 1000.0}
    assert sc.size_from_stop(1_000, 0.25, 500.0, 480.0)["skip"] is True
    with pytest.raises(ValueError):
        sc.size_from_stop(100_000, 2.5, 50, 47.5)
    with pytest.raises(ValueError):
        sc.size_from_stop(100_000, 1.0, 50, 50)


def test_size_within_one_share_or_one_dollar_after_rounding():
    key = {"shares": 400, "dollars": 20000}
    assert sc.score("size", {"shares": 400.6, "dollars": 19999.4}, key).correct      # rounds to 401 / 19999
    assert sc.score("size", {"shares": 399, "dollars": 20001}, key).correct
    v = sc.score("size", {"shares": 398, "dollars": 20000}, key)
    assert not v.correct and v.score == 0.5 and v.detail["parts"] == {"shares": False, "dollars": True}
    assert not sc.score("size", {"shares": 400, "dollars": 20002}, key).correct
    assert sc.score("size", {"shares": 12}, {"shares": 12}).correct                  # key with shares only
    assert not sc.score("size", "400", key).correct


def test_size_skip_cases():
    assert sc.score("size", {"skip": True}, {"skip": True}).correct
    assert not sc.score("size", {"shares": 1}, {"skip": True}).correct
    assert not sc.score("size", {"skip": True}, {"shares": 10}).correct


# ── levels ────────────────────────────────────────────────────────────────────

def test_level_tolerance_is_max_of_atr_and_one_percent():
    assert sc.level_tolerance(100.0, 2.0) == 1.5          # 0.75×2 beats 1%
    assert sc.level_tolerance(100.0, 1.0) == 1.0          # 1% beats 0.75
    assert sc.level_tolerance(100.0, None) == 1.0
    assert sc.level_tolerance(100.0, 0) == 1.0


def test_levels_scored_per_level():
    key = {"entry": 100.0, "stop": 95.0, "target": 115.0, "atr14": 2.0}   # tol 1.5 / 0.95 / 1.5
    assert sc.score("levels", {"entry": 101.4, "stop": 94.1, "target": 113.6}, key).correct
    v = sc.score("levels", {"entry": 101.6, "stop": 95.0, "target": 115.0}, key)
    assert not v.correct and v.score == pytest.approx(2 / 3, abs=1e-3) and v.detail["levels"]["entry"]["ok"] is False
    pts = {"points": [{"role": "entry", "price": 100}, {"role": "stop", "price": 95},
                      {"role": "target", "price": 115}]}
    assert sc.score("levels", pts, key).correct
    assert sc.score("levels", {"entry": 100}, {"entry": 100, "stop": 95}).score == 0.5
    assert not sc.score("levels", {}, {}).correct


# ── next ──────────────────────────────────────────────────────────────────────

def test_next_direction_vs_outcome_with_synonyms():
    assert sc.score("next", "higher", {"outcome": "up"}).correct
    assert sc.score("next", "flat", {"outcome": "undecided"}).correct     # C14: expired is undecided
    assert not sc.score("next", "down", {"outcome": "up"}).correct
    assert not sc.score("next", "up", {"outcome": "sideways"}).correct
    assert not sc.score("next", "sideways", {}).correct


# ── tap ───────────────────────────────────────────────────────────────────────

def test_tap_box_region():
    key = {"bar_from": 40, "bar_to": 44, "price_lo": 98.0, "price_hi": 102.0}
    assert sc.score("tap", {"bar_index": 42, "price": 100.0}, key).correct
    assert not sc.score("tap", {"bar_index": 45, "price": 100.0}, key).correct
    assert not sc.score("tap", {"bar_index": 42, "price": 103.0}, key).correct
    assert sc.score("tap", {"bar_index": 40}, {"bar_from": 40, "bar_to": 44}).correct   # bar-only key
    assert not sc.score("tap", {}, key).correct


def test_tap_point_with_tolerances():
    key = {"bar_index": 50, "bar_tol": 1, "price": 200.0, "price_tol_pct": 2.0}
    assert sc.score("tap", {"bar_index": 51, "price": 203.9}, key).correct
    assert not sc.score("tap", {"bar_index": 52, "price": 200.0}, key).correct
    assert not sc.score("tap", {"bar_index": 50, "price": 205.0}, key).correct
    assert sc.score("tap", {"bar_index": 50}, {"bar_index": 50}).correct


# ── plan ──────────────────────────────────────────────────────────────────────

def test_plan_all_four_rules():
    key = {"account": 100_000, "entry": 50.0, "stop": 47.5, "target": 56.0}
    good = {"steps": ["regime", "setup", "stop", "size", "entry"], "shares": 400}
    v = sc.score("plan", good, key)
    assert v.correct and v.score == 1.0
    assert v.detail["risk_pct"] == 1.0 and v.detail["rr"] == 2.4


def test_plan_each_rule_fails_on_its_own():
    key = {"account": 100_000, "entry": 50.0, "stop": 47.5, "target": 56.0}
    base = {"steps": ["regime", "stop", "size"], "shares": 400}
    v = sc.score("plan", {**base, "steps": ["stop", "regime", "size"]}, key)
    assert v.detail["checks"]["regime_first"] is False and v.score == 0.75
    v = sc.score("plan", {**base, "steps": ["regime", "size", "stop"]}, key)
    assert v.detail["checks"]["stop_before_size"] is False
    v = sc.score("plan", {**base, "shares": 1000}, key)           # 2.5% risk
    assert v.detail["checks"]["risk_within_ceiling"] is False
    v = sc.score("plan", base, {**key, "target": 53.0})            # R:R 1.2
    assert v.detail["checks"]["rr_at_least_floor"] is False
    v = sc.score("plan", {"steps": ["regime", "stop", "size"], "risk_pct": 2.0, "rr": 2.0}, {})
    assert v.correct                                                 # the answer's own numbers


def test_dispatcher_unknown_type_falls_back_to_exact():
    assert sc.score("mystery", "x", {"answer": "x"}).correct


# ── walkthrough: seen, never graded (§13.9 #1) ────────────────────────────────

def test_walkthrough_is_unscored_ok_with_a_null_score():
    v = sc.score("walkthrough", {"seen": 3}, {"unscored": True})
    assert v.correct is True and v.score is None and v.unscored is True
    assert v.detail == {"seen": 3, "unscored": True}
    assert sc.score("WALKTHROUGH", None, None) == sc.Verdict(True, None, {"seen": None, "unscored": True}, True)
    assert sc.score("walkthrough", {"seen": "junk"}, {}).detail["seen"] is None


def test_every_other_verdict_is_scored_by_default():
    for t in ("recall", "size", "levels", "next", "tap", "plan", "match", "autopsy", "bogus"):
        v = sc.score(t, None, {"answer": "a"})
        assert v.unscored is False and isinstance(v.score, float), t
    assert sc.Verdict._field_defaults == {"unscored": False}


# ── the member drills' real answer shape (2026-10-21) ─────────────────────────
# app/src/pages/study/drills/types.js `choiceAnswer` posts {choice: <value>}.
# Only {answer: <value>} was unwrapped, so every choice answer from the live app
# scored wrong; seen live as "Not quite. The answer: Matching Low" for the
# choice "Matching Low". These pin the shape the drills actually send.

@pytest.mark.parametrize("item_type", ["recall", "regime", "spot", "scenario", "family", "grade",
                                       "call_scan", "call_archive", "listen"])
def test_the_drills_choice_shape_scores_like_the_bare_value(item_type):
    right = sc.score(item_type, {"choice": "Matching Low"}, {"answer": "Matching Low"})
    assert right.correct and right.score == 1.0, item_type
    wrong = sc.score(item_type, {"choice": "Doji"}, {"answer": "Matching Low"})
    assert not wrong.correct
    assert sc.score(item_type, {"choice": "  matching   LOW "}, {"answer": "Matching Low"}).correct
    assert not sc.score(item_type, {"choice": None}, {"answer": "Matching Low"}).correct


def test_a_numeric_fill_in_and_the_call_drills_lowercase_choice_both_score():
    assert sc.score("recall", {"choice": 42}, {"answer": "42"}).correct
    assert sc.score("recall", {"choice": 42.0}, {"answer": 42}).correct
    assert sc.score("call_scan", {"choice": "trigger"}, {"answer": "TRIGGER", "accept": ["watch"]}).correct
    assert sc.score("call_scan", {"choice": "watch"}, {"answer": "TRIGGER", "accept": ["watch"]}).correct


def test_a_two_field_dict_is_not_unwrapped():
    # only a ONE-field {choice} / {answer} is a single chosen value
    assert not sc.score("recall", {"choice": "Matching Low", "extra": 1}, {"answer": "Matching Low"}).correct
