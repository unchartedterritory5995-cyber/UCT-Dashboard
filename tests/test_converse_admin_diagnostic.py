"""A refused turn tells a BUILDER why each attempt was refused; it never tells a member.

Found by the house set, 2026-11-15: requests that fail twice at a name or reference
check returned only the gate's phrase, and the validator's own words (which name, which
key) went to a DEBUG log production does not keep. The failure could be counted and
never fixed.

No paid calls: every model call is the scripted stub of ``test_p2_truth_server``.
"""
from __future__ import annotations

import json

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, conv, emits, env, model, out, view,
)
from tests.test_p2x_truth_converse import (  # noqa: F401 -- fixtures by name
    ADMIN, MEMBER, clean_env, http_as,
)

BAD = lambda: emits(env(1, [{"op": "delete_everything"}]))  # noqa: E731
GOOD = lambda: emits(env(1, [{"op": "set_slot", "slot": "value#1", "value": 80}]))  # noqa: E731
VIEW = lambda: view(1, [out("value", RSI_GT_70)])  # noqa: E731


def test_an_admin_reads_what_each_attempt_was_refused_for(conv, clean_env, model):
    model([BAD(), BAD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is False and r["gate"] == "envelope:schema"
    d = r["diagnostic"]
    assert [x["attempt"] for x in d] == [1, 2]
    assert all(x["gate"] == "envelope:schema" for x in d)
    assert all("ops" in x["detail"] for x in d)              # the validator's own words
    assert r["reason"] == conv.REFUSALS["envelope:schema"]   # the member phrase is unchanged


def test_a_member_never_reads_it(conv, clean_env, model):
    model([BAD(), BAD()])
    r = conv.converse("make it 80", user_id="u1", view=VIEW())
    assert r["ok"] is False and r["gate"] == "envelope:schema"
    assert "diagnostic" not in r
    assert "delete_everything" not in json.dumps(r)


def test_a_turn_repaired_into_a_change_tells_a_builder_what_the_repair_was_for(conv, clean_env, model):
    """2026-11-17: a repaired turn SUCCEEDED and still cost a second call. A builder reads what
    the first attempt was refused for; a member's repaired turn carries nothing."""
    model([BAD(), GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is True and r["attempts"] == 2
    assert [x["attempt"] for x in r["diagnostic"]] == [1]
    assert r["diagnostic"][0]["gate"] == "envelope:schema" and "ops" in r["diagnostic"][0]["detail"]
    model([BAD(), GOOD()])
    m = conv.converse("make it 80", user_id="u1", view=VIEW())
    assert m["ok"] is True and m["attempts"] == 2 and "diagnostic" not in m


def test_CONTROL_a_turn_that_needed_no_repair_carries_none(conv, clean_env, model):
    model([GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is True and r["attempts"] == 1 and "diagnostic" not in r


def test_the_detail_is_bounded(conv, clean_env, model, monkeypatch):
    monkeypatch.setattr(conv, "DIAGNOSTIC_MAX_CHARS", 12)
    model([BAD(), BAD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert all(len(x["detail"]) <= 12 for x in r["diagnostic"])
    assert any(len(x["detail"]) == 12 for x in r["diagnostic"])     # control: it was cut


def test_through_the_route_the_role_decides(conv, clean_env, model, http_as):
    body = {"message": "make it 80", "view": VIEW()}
    model([BAD(), BAD()])
    a = http_as(ADMIN).post("/api/user-definitions/converse", json=body).json()
    assert a.get("diagnostic"), a
    model([BAD(), BAD()])
    m = http_as(MEMBER).post("/api/user-definitions/converse", json=body).json()
    assert m.get("ok") is False and "diagnostic" not in m
