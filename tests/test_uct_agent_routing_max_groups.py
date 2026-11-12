"""MAX_GROUPS (api/services/uct_agent/turn.py): routing.groups past the limit are still cut, but never silently —
the first over-limit request in a process logs ONE warning naming the dropped group ids (like #1078's args-schema
drop). The JS side (app/src/agent/routingMaxGroups.test.js) fails when routing.js GROUPS outgrows the limit."""
import logging

from api.services.uct_agent import turn


def _groups(n):
    letters = "abcdefghijklmnopqrstuvwxyz"
    return [{"id": "grp" + letters[i // 26] + letters[i % 26], "title": f"group {i}"} for i in range(n)]


def test_over_limit_groups_are_cut_and_logged_once_per_process(monkeypatch, caplog):
    monkeypatch.setattr(turn, "_GROUPS_DROP_LOGGED", False)
    groups = _groups(turn.MAX_GROUPS + 2)
    dropped = [g["id"] for g in groups[turn.MAX_GROUPS:]]
    with caplog.at_level(logging.WARNING, logger=turn.log.name):
        r = turn.validate_routing({"groups": groups, "selected": [groups[0]["id"]]})
        turn.validate_routing({"groups": groups, "selected": [groups[0]["id"]]})      # every turn runs this
        turn.validate_routing({"groups": _groups(turn.MAX_GROUPS + 5), "selected": []})
    ids = [g["id"] for g in r["unselected"]]
    assert len(ids) == turn.MAX_GROUPS - 1 and not set(dropped) & set(ids)          # behaviour unchanged: still cut
    hits = [rec for rec in caplog.records if "MAX_GROUPS" in rec.getMessage()]
    assert len(hits) == 1, "logged once per process"
    assert hits[0].levelno == logging.WARNING
    msg = hits[0].getMessage()
    assert all(d in msg for d in dropped) and f"MAX_GROUPS={turn.MAX_GROUPS}" in msg


def test_within_limit_groups_log_nothing(monkeypatch, caplog):
    monkeypatch.setattr(turn, "_GROUPS_DROP_LOGGED", False)
    with caplog.at_level(logging.WARNING, logger=turn.log.name):
        r = turn.validate_routing({"groups": _groups(turn.MAX_GROUPS), "selected": []})
    assert len(r["unselected"]) == turn.MAX_GROUPS
    assert not [rec for rec in caplog.records if "MAX_GROUPS" in rec.getMessage()]
    assert turn._GROUPS_DROP_LOGGED is False
