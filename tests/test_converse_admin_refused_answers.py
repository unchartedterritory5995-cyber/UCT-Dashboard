"""A BUILDER READS WHAT EACH REFUSED ATTEMPT SAID; A MEMBER NEVER DOES; NOTHING NEW IS STORED (2026-11-24).

`test_converse_admin_diagnostic.py` holds WHY an attempt was refused (the gate and the validator's words, cut at
600 characters). Two rulings of 2026-11-24 needed more than that: a mend that drops an op can be judged only from
what the attempt TOLD the member about that op (its reply, its notes), and a list that arrived as text and did not
parse (`envelope:schema`, measured once in the regression sweep after #2599) only from the text itself, which the
diagnostic cut at 200 characters.

So an ADMIN's response carries `refused_answers`: each refused attempt's whole answer as JSON text (bounded, and
said when cut), and for a list that came as text and did not parse, the parser's own message and the text around
where it stopped. Coordinator's conditions, held here:
  * a MEMBER's response never carries it, called directly or through the route (the role gate);
  * response only: it is added after the turn is recorded, and the recorded turn holds nothing new.

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
#: a list of changes sent as TEXT that does not parse: a missing comma between two objects
BROKEN = '[{"op": "set_slot", "slot": "value#1", "value": 80} {"op": "set_slot", "slot": "value#1", "value": 81}]'


def as_text():
    answer = env(1, [])
    answer["ops"] = BROKEN
    return emits(answer)


def test_an_admin_reads_what_each_refused_attempt_said(conv, clean_env, model):
    model([BAD(), GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is True and r["attempts"] == 2
    (first,) = r["refused_answers"]
    assert first["attempt"] == 1 and first["truncated"] is False and first["list_text_errors"] == []
    said = json.loads(first["answer"])
    assert said["ops"] == [{"op": "delete_everything"}]            # the attempt itself, whole
    # beside the diagnostic, which says why: the two line up attempt by attempt
    assert [d["attempt"] for d in r["diagnostic"]] == [a["attempt"] for a in r["refused_answers"]]


def test_a_member_never_reads_it(conv, clean_env, model):
    model([BAD(), GOOD()])
    m = conv.converse("make it 80", user_id="u1", view=VIEW())
    assert m["ok"] is True and m["attempts"] == 2
    assert "refused_answers" not in m and "delete_everything" not in json.dumps(m)
    model([BAD(), BAD()])
    m = conv.converse("make it 80", user_id="u1", view=VIEW())
    assert m["ok"] is False and "refused_answers" not in m and "delete_everything" not in json.dumps(m)


def test_through_the_route_the_role_decides(conv, clean_env, model, http_as):
    body = {"message": "make it 80", "view": VIEW()}
    model([BAD(), GOOD()])
    a = http_as(ADMIN).post("/api/user-definitions/converse", json=body).json()
    assert a.get("refused_answers"), a
    model([BAD(), GOOD()])
    m = http_as(MEMBER).post("/api/user-definitions/converse", json=body).json()
    assert m.get("ok") is True and "refused_answers" not in m and "delete_everything" not in json.dumps(m)


def test_a_list_sent_as_text_that_did_not_parse_says_where_and_why(conv, clean_env, model):
    model([as_text(), GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is True and r["attempts"] == 2
    (err,) = r["refused_answers"][0]["list_text_errors"]
    gap = BROKEN.index("} {") + 2                                   # where the missing comma is
    assert err["field"] == "ops" and err["length"] == len(BROKEN) and err["at"] == gap
    assert "Expecting ',' delimiter" in err["error"] and BROKEN[gap - 10:gap + 10] in err["near"]


def test_a_text_list_that_parses_is_no_error_and_a_list_is_none():
    from api.services import definition_conversation as dc
    assert dc.list_text_errors({"ops": '[{"op": "x"}]'}) == []
    assert dc.list_text_errors({"ops": [{"op": "x"}]}) == []
    assert dc.list_text_errors({"ops": "not a list"}) == []
    assert dc.list_text_errors("not an answer") == []


def test_the_attempt_is_bounded_and_says_when_it_was_cut(conv, clean_env, model, monkeypatch):
    monkeypatch.setattr(conv, "REFUSED_ANSWER_MAX_CHARS", 20)
    model([BAD(), GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    (first,) = r["refused_answers"]
    assert len(first["answer"]) == 20 and first["truncated"] is True


def test_CONTROL_a_turn_that_needed_no_repair_carries_none(conv, clean_env, model):
    model([GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["ok"] is True and r["attempts"] == 1 and "refused_answers" not in r


def test_nothing_new_is_stored_the_recorded_turn_holds_no_attempt(conv, clean_env, model, monkeypatch):
    """Response only (coordinator's condition): the turn is recorded BEFORE the attempts are added, and what the
    record reads from the trace is a closed list of names."""
    recorded = []
    real = conv._record_turn
    monkeypatch.setattr(conv, "_record_turn", lambda *a, **k: recorded.append(json.dumps(a[2], default=str)
                                                                              + json.dumps(conv.learned_fields(a[2], k.get("learned")), default=str))
                        or real(*a, **k))
    model([BAD(), GOOD()])
    r = conv.converse("make it 80", user_id="a1", view=VIEW(), admin=True)
    assert r["refused_answers"] and len(recorded) == 1
    assert "refused_answers" not in recorded[0] and "delete_everything" not in recorded[0]
