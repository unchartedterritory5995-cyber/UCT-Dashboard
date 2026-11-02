"""QA F-11 (agent-lead, turn.py `_row_actions`): a stored outcome row that does not name its `actions` cannot show
it carried no local-only result, so history treats it as local (fail closed) — unless its kind is one of the
browser's own action-less notes (undo, clarify, refusal, cancel), whose text is UCT's fixed wording."""
from __future__ import annotations

import pathlib
import re

import pytest

from api.services.uct_agent import turn

SECRET = "987.654"
ROOT = pathlib.Path(__file__).resolve().parents[1]


def _history(outcome_data):
    rows = [{"role": "member", "text": "q", "data": {}},
            {"role": "outcome", "text": f"rating {SECRET}", "data": outcome_data}]
    return str(turn.history_messages(rows))


@pytest.mark.parametrize("data", [
    {"kind": "answered"},                    # the F-11 shape
    {"kind": "applied"},
    {"kind": "something-new"},               # an unknown kind without actions
    {},                                      # no kind at all
    {"kind": "answered", "actions": None},   # unreadable actions
    {"kind": "answered", "actions": [1]},
])
def test_a_row_that_cannot_show_its_actions_is_never_replayed(data):
    out = _history(data)
    assert SECRET not in out


@pytest.mark.parametrize("kind", sorted(turn.ACTIONLESS_OUTCOME_KINDS))
def test_the_browsers_action_less_notes_still_replay(kind):
    assert SECRET in _history({"kind": kind})


def test_a_row_naming_ordinary_actions_still_replays():
    assert SECRET in _history({"kind": "answered", "actions": ["stock.profile"]})


def test_a_row_naming_a_local_only_action_is_never_replayed():
    assert SECRET not in _history({"kind": "answered", "actions": ["breadth.show"]})


def test_the_action_less_list_matches_what_the_browser_records():
    """Rail: a new browser outcome kind recorded WITHOUT `actions` must be added here on purpose (it then
    replays) — otherwise it stays fail-closed. A listed kind the browser no longer records is stale."""
    src = ROOT / "app" / "src" / "agent"
    seen = set()
    for p in src.rglob("*.js*"):
        if ".test." in p.name:
            continue
        text = p.read_text(encoding="utf-8")
        for m in re.finditer(r"outcomeData:\s*\{\s*kind:\s*'([a-z-]+)'([^}]*)\}", text):
            if "actions" not in m.group(2):
                seen.add(m.group(1))
    assert seen, "found no outcome records: the rail would check nothing"
    assert seen <= turn.ACTIONLESS_OUTCOME_KINDS, f"decide these: {sorted(seen - turn.ACTIONLESS_OUTCOME_KINDS)}"
    assert turn.ACTIONLESS_OUTCOME_KINDS <= seen, f"stale: {sorted(turn.ACTIONLESS_OUTCOME_KINDS - seen)}"
