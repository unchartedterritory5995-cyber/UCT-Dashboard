"""AN INTERNAL ERROR SAYS WHAT IS TRUE, AND IS COUNTED (ruling 2026-11-18).

Found live: a remembered choice broke a turn inside the door (#1822), and the member read "The UCT
Agent couldn't produce a valid change for that. Try rephrasing it." Rephrasing cannot help a
failure of ours. So:

* the member reads "That didn't work on our side and nothing was changed. Try again in a moment.",
  from the door and from the window alike (one sentence, held together here);
* the turn is recorded as its own outcome, and the weekly report counts it, so the owner sees it.
"""
from __future__ import annotations

import pathlib
import re

from api.services import definition_concierge as dc
from api.services import indicator_telemetry as tel
from tests.test_learned_record import last_turn, turn
from tests.test_p2_truth_server import conv, emits, empty_view, env, model  # noqa: F401 -- fixtures by name
from tests.test_p2x_truth_converse import clean_env  # noqa: F401 -- fixture by name
from tests.test_rollout_telemetry import store  # noqa: F401 -- fixture by name
from tests.test_named_indicators import create

ROOT = pathlib.Path(__file__).resolve().parents[1]
SENTENCE = "That didn't work on our side and nothing was changed. Try again in a moment."
CHART = {"sym": "NVDA", "tf": "D"}


def _code_of(js: str) -> str:
    """The JavaScript with its comments taken out (a sentence quoted in a comment is not the code)."""
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    return "\n".join(line for line in js.splitlines() if not line.lstrip().startswith("//"))


def test_the_door_and_the_window_say_the_same_true_sentence():
    assert dc.REFUSALS["internal:error"] == SENTENCE
    assert not re.search(r"rephras|valid change", SENTENCE, re.I)
    code = _code_of((ROOT / "app/src/components/chart/builder/authoring/memberWords.js").read_text(encoding="utf-8"))
    (line,) = [ln for ln in code.splitlines() if ln.startswith("export const INTERNAL = ")]
    assert line == f'export const INTERNAL = "{SENTENCE}"'
    # CONTROL: the comment stripper can see code, and does drop a comment that quotes the sentence
    assert "INTERNAL" in code and _code_of(f'// "{SENTENCE}"\nconst x = 1') == "const x = 1"


def test_a_turn_that_fails_inside_the_door_is_answered_with_it_and_recorded_as_its_own_outcome(
        store, conv, clean_env, model, monkeypatch):
    def broken(*_a, **_k):
        raise RuntimeError("a defect of ours")
    monkeypatch.setattr(conv, "check_named", broken)
    client = model([emits(env(0, [create("on_balance_volume")]))])
    r = conv.converse("Add On Balance Volume", user_id="u1", view=empty_view(0), chart=CHART)
    assert r["ok"] is False and r["gate"] == "internal:error" and r["reason"] == SENTENCE
    assert len(client.calls) == 1                                           # it failed AFTER the call was paid for
    assert last_turn()["failure_class"] == "internal"


def test_the_weekly_report_counts_them_apart_and_against_the_week_before(store):
    turn("m1", failure_class="internal")
    turn("m1", failure_class="internal")
    turn("builder", admin=True, failure_class="internal")
    turn("m2", built=True)
    turn("m4")                                             # refused for a reason of the member's request: NOT ours
    turn("m3", days_ago=9, failure_class="internal")
    report = tel.weekly_report(7)
    assert report["internal_error"] == {
        "this": {"turns": 3, "members_turns": 2, "builders_turns": 1, "share_of_turns": 0.6},
        "previous": {"turns": 1, "members_turns": 1, "builders_turns": 0, "share_of_turns": 1.0}}
    text = tel.weekly_report_text(report)
    assert "FAILED ON OUR SIDE" in text
    assert "  3 turns: 2 for members, 1 for the builders' own accounts (the 7 days before: 1)" in text


def test_one_member_is_enough_to_show_it_and_none_reads_as_none(store):
    """Not withheld below three members, unlike a row about what members asked for: the count says
    what UCT did, and nothing about any request."""
    turn("m1", built=True)
    report = tel.weekly_report(7)
    assert report["internal_error"]["this"] == {"turns": 0, "members_turns": 0, "builders_turns": 0, "share_of_turns": 0.0}
    assert "  0 turns (the 7 days before: 0)" in tel.weekly_report_text(report)
    turn("m1", failure_class="internal")
    report = tel.weekly_report(7)
    assert report["internal_error"]["this"]["turns"] == 1 and report["internal_error"]["this"]["members_turns"] == 1
    assert "  1 turn: 1 for members, 0 for the builders' own accounts (the 7 days before: 0)" in tel.weekly_report_text(report)
    assert report["internal_error"]["previous"]["share_of_turns"] is None
