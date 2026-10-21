"""/study: the owner's feedback on a Study item from Discord (owner 2026-10-21)."""
from __future__ import annotations

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

EPHEMERAL = 64
ADMIN_PERMS = "8"            # ADMINISTRATOR
MEMBER_PERMS = "2147483648"  # some other bit, no administrator


def _study(ref="872a0a", say="the lesson never says where the stop goes", verdict=None, kind=None,
           uid="900", perms=ADMIN_PERMS):
    opts = []
    if ref is not None:
        opts.append({"name": "ref", "type": 3, "value": ref})
    if say is not None:
        opts.append({"name": "say", "type": 3, "value": say})
    if verdict:
        opts.append({"name": "verdict", "type": 3, "value": verdict})
    if kind:
        opts.append({"name": "kind", "type": 3, "value": kind})
    return {"type": 2, "application_id": "123", "token": "tok", "guild_id": UT_GUILD,
            "member": {"user": {"id": uid}, "permissions": perms},
            "data": {"name": "study", "options": opts}}


@pytest.fixture()
def route(monkeypatch, tmp_path):
    from api.services import discord_interactions as di
    from api.services import study_store as ss
    di.reset_rate_for_tests()
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    ss.init_db()
    ss.upsert_items([
        {"id": "si_872a0a87de98", "type": "recall", "skill_id": "vocab.candle", "difficulty": 2,
         "sym": "IWM", "asof": "2025-04-09",
         "prompt_json": {"q": "Which candle?", "choices": ["Bullish Engulfing", "Doji"], "subject": "Bullish Engulfing"},
         "answer_json": {"answer": "Bullish Engulfing"}, "source_kind": "candles", "lesson_text": "Two bars."},
    ])
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    return client, sk, rt, ss


def test_study_is_registered_once_admin_only_with_ref_and_say_required():
    from api.services import discord_interactions as di
    cmds = [c for c in di.build_commands() if c["name"] == "study"]
    assert len(cmds) == 1
    cmd = cmds[0]
    assert cmd["default_member_permissions"] == "8", "members must not see it"
    assert cmd["integration_types"] == [0] and cmd["contexts"] == [0]
    names = [o["name"] for o in cmd["options"]]
    assert names == ["ref", "say", "verdict", "kind"]
    assert [o["required"] for o in cmd["options"]] == [True, True, False, False]
    assert [c["value"] for c in cmd["options"][2]["choices"]] == ["approve", "fix", "reject"]
    from api.services.study_store import FEEDBACK_KINDS
    assert [c["value"] for c in cmd["options"][3]["choices"]] == list(FEEDBACK_KINDS), \
        "the kind choices are the store's words, so the ingest can group them"


def test_a_note_is_stored_as_owner_feedback_and_answered_privately(route):
    client, sk, rt, ss = route
    r = _post(client, sk, _study()).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL
    assert "Bullish Engulfing" in r["data"]["content"] and "IWM 2025-04-09" in r["data"]["content"]
    assert "ref 872a0a" in r["data"]["content"] and "Noted." in r["data"]["content"]
    rows = ss.list_feedback()
    assert len(rows) == 1
    fb = rows[0]
    assert fb["channel"] == "discord" and fb["role"] == "owner" and fb["user_id"] == "discord:900"
    assert fb["kind"] == "other" and fb["text"] == "the lesson never says where the stop goes"
    assert fb["verdict"] is None
    assert ss.get_item_full("si_872a0a87de98")["review_status"] == "draft"


def test_a_verdict_is_applied_on_the_spot(route):
    client, sk, rt, ss = route
    r = _post(client, sk, _study(verdict="approve", kind="great")).json()
    assert "Approved and live." in r["data"]["content"]
    assert ss.get_item_full("si_872a0a87de98")["review_status"] == "approved"
    r = _post(client, sk, _study(say="bars too small", verdict="reject", kind="bad_chart")).json()
    assert "Retired from the bank." in r["data"]["content"]
    assert ss.get_item_full("si_872a0a87de98")["review_status"] == "rejected"
    r = _post(client, sk, _study(say="say where the stop goes", verdict="fix", kind="unclear_lesson")).json()
    assert "Noted for the next build." in r["data"]["content"]
    assert [f["verdict"] for f in ss.list_feedback()] == ["fix", "reject", "approve"]


def test_a_non_administrator_is_refused_and_nothing_is_stored(route):
    client, sk, rt, ss = route
    for perms in (MEMBER_PERMS, "0", "", None, "not-a-number"):
        body = _study(perms=perms)
        if perms is None:
            del body["member"]["permissions"]
        r = _post(client, sk, body).json()
        assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "admins" in r["data"]["content"]
    assert ss.list_feedback() == []


def test_a_missing_ref_or_note_and_an_unknown_ref_are_answered_at_once(route):
    client, sk, rt, ss = route
    for body in (_study(ref=None), _study(say="  "), _study(ref="  ")):
        r = _post(client, sk, body).json()
        assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "/study ref:872a0a" in r["data"]["content"]
    r = _post(client, sk, _study(ref="zzzzzz")).json()
    assert "No Study item matches" in r["data"]["content"]
    assert ss.list_feedback() == []


def test_the_ref_may_be_pasted_with_its_label_or_as_the_whole_id(route):
    client, sk, rt, ss = route
    for ref in ("ref 872a0a", "SI_872A0A87DE98", "872a0a87"):
        r = _post(client, sk, _study(ref=ref)).json()
        assert "Feedback saved" in r["data"]["content"], ref
    assert len(ss.list_feedback()) == 3
