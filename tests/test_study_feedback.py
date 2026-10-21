"""Study feedback (owner 2026-10-21: "a system for reviewing in site or in the
discord and giving feedback for the quiz and test so we can manually do this
and ingest and update the information").

Store: one row per piece of feedback, the owner's approve / reject applied at
once, a member's verdict never applied. Router: the member door on the reveal
card, the admin list / handle / export. Discord: the `/study` command writes
the same row (owner only) and answers privately.
Run alone: python -m pytest tests/test_study_feedback.py -q
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import study_store as ss


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    ss.upsert_items([
        {"id": "si_872a0a87de98", "type": "recall", "skill_id": "vocab.candle", "difficulty": 2,
         "sym": "IWM", "asof": "2025-04-09",
         "prompt_json": {"q": "Which candle name fits the last 2 bars?", "choices": ["Bullish Engulfing", "Doji"],
                         "subject": "Bullish Engulfing"},
         "answer_json": {"answer": "Bullish Engulfing"}, "reveal_json": {"label": "Bullish Engulfing"},
         "source_kind": "candles", "source_ref": "candles#bullish-engulfing", "lesson_text": "Two bars."},
        {"id": "si_21a45eab27a0", "type": "recall", "skill_id": "vocab.candle", "difficulty": 2,
         "sym": "CAVA", "asof": "2025-12-10",
         "prompt_json": {"q": "Which candle?", "choices": ["Hanging Man", "Hammer"], "subject": "Hanging Man"},
         "answer_json": {"answer": "Hanging Man"}, "source_kind": "candles", "lesson_text": "One bar."},
    ])
    ss.approve("si_872a0a87de98", "owner")
    return ss


MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}
ADMIN = {"id": "a1", "email": "a@t.dev", "role": "admin", "plan": "pro"}


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(study_router.router)
    return app


def _client(user, admin=False):
    app = _app()
    app.dependency_overrides[study_router.require_paid] = lambda: user
    app.dependency_overrides[get_current_user] = lambda: user
    if admin:
        app.dependency_overrides[require_admin] = lambda: user
    return TestClient(app)


@pytest.fixture()
def member(store):
    return _client(MEMBER)


@pytest.fixture()
def owner(store):
    return _client(ADMIN, admin=True)


# ── store ─────────────────────────────────────────────────────────────────────

def test_short_ref_and_find_by_ref(store):
    assert ss.short_ref("si_872a0a87de98") == "872a0a"
    assert ss.find_item_by_ref("872a0a")["id"] == "si_872a0a87de98"
    assert ss.find_item_by_ref("SI_872A0A87DE98")["id"] == "si_872a0a87de98"      # whole id, any case
    assert ss.find_item_by_ref("ref 872a0a")["id"] == "si_872a0a87de98"           # pasted with the label
    assert ss.find_item_by_ref("zzz") is None
    assert ss.find_item_by_ref("8") is None                                         # too short to be one item


def test_a_member_row_is_stored_and_its_verdict_is_dropped(store):
    res = ss.add_feedback("si_872a0a87de98", "u1", role="member", channel="site", kind="unclear_lesson",
                          text="  the 'where' part lost me  ", verdict="reject", answer_json="Doji", correct=False)
    fb = res["feedback"]
    assert res["applied"] is None and fb["verdict"] is None, "a member never retires an item"
    assert fb["text"] == "the 'where' part lost me" and fb["answer_json"] == "Doji" and fb["correct"] is False
    assert fb["sym"] == "IWM" and fb["subject"] == "Bullish Engulfing" and fb["ref"] == "872a0a"
    assert store.get_item_full("si_872a0a87de98")["review_status"] == "approved"


def test_an_owner_reject_retires_the_item_and_is_logged_as_a_correction(store):
    res = ss.add_feedback("si_872a0a87de98", "a1", role="owner", channel="discord", kind="bad_chart",
                          text="bars too small", verdict="reject")
    assert res["applied"] == "reject"
    assert store.get_item_full("si_872a0a87de98")["review_status"] == "rejected"
    corr = store.export_corrections()
    assert corr[-1]["action"] == "reject" and "discord feedback #1" in corr[-1]["reason"]
    assert "bars too small" in corr[-1]["reason"]


def test_an_owner_approve_publishes_a_draft_and_fix_is_only_a_note(store):
    res = ss.add_feedback("si_21a45eab27a0", "a1", role="owner", channel="site", kind="great", verdict="approve")
    assert res["applied"] == "approve"
    assert store.get_item_full("si_21a45eab27a0")["review_status"] == "approved"
    res = ss.add_feedback("si_21a45eab27a0", "a1", role="owner", channel="site", kind="unclear_lesson",
                          text="say where the stop goes", verdict="fix")
    assert res["applied"] is None and res["feedback"]["verdict"] == "fix"
    assert store.get_item_full("si_21a45eab27a0")["review_status"] == "approved", "a fix note changes nothing yet"


@pytest.mark.parametrize("bad", [
    dict(role="guest", channel="site", kind="other"),
    dict(role="member", channel="email", kind="other"),
    dict(role="member", channel="site", kind="meh"),
    dict(role="owner", channel="site", kind="other", verdict="retire"),
])
def test_bad_words_are_refused(store, bad):
    with pytest.raises(ValueError):
        ss.add_feedback("si_872a0a87de98", "u1", **bad)
    with pytest.raises(ValueError):
        ss.add_feedback("si_nope", "u1", role="member", channel="site", kind="other")


def test_list_counts_handle_and_export(store):
    ss.add_feedback("si_872a0a87de98", "u1", role="member", channel="site", kind="too_easy")
    ss.add_feedback("si_872a0a87de98", "u2", role="member", channel="site", kind="wrong_answer", text="it is a doji")
    ss.add_feedback("si_21a45eab27a0", "a1", role="owner", channel="discord", kind="other", text="fine")
    assert [f["id"] for f in ss.list_feedback()] == [3, 2, 1], "newest first for the screen"
    assert [f["id"] for f in ss.list_feedback(item_id="si_872a0a87de98")] == [2, 1]
    counts = ss.feedback_counts()
    assert counts == {"open": {"si_872a0a87de98": 2, "si_21a45eab27a0": 1}, "open_screens": {}, "open_total": 3, "total": 3}
    assert ss.handle_feedback([1, 2, 999], "session", note="lesson rewritten") == 2
    assert ss.handle_feedback([1], "session") == 0, "already handled rows are not re-stamped"
    assert [f["id"] for f in ss.list_feedback(unhandled_only=True)] == [3]
    assert ss.feedback_counts()["open"] == {"si_21a45eab27a0": 1}
    exp = ss.export_feedback(since_id=1)
    assert [f["id"] for f in exp] == [2, 3], "oldest first for the ingest"
    assert exp[0]["handled_note"] == "lesson rewritten" and exp[0]["q"].startswith("Which candle name")


# ── router ────────────────────────────────────────────────────────────────────

def test_the_member_door_records_the_attempt_it_came_from_and_ignores_a_verdict(member, store):
    att = member.post("/api/study/attempts", json={"item_id": "si_872a0a87de98", "answer": "Doji"}).json()
    assert att["reveal"]["ref"] == "872a0a", "the reveal names the ref a member can use from Discord"
    r = member.post("/api/study/items/si_872a0a87de98/feedback",
                    json={"kind": "unclear_question", "text": "which two bars?", "attempt_id": att["attempt_id"],
                          "verdict": "reject"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "member" and body["applied"] is None and body["ref"] == "872a0a"
    row = store.get_feedback(body["id"])
    assert row["answer_json"] == "Doji" and row["correct"] is False and row["attempt_id"] == att["attempt_id"]
    assert row["verdict"] is None
    assert store.get_item_full("si_872a0a87de98")["review_status"] == "approved"


def test_another_members_attempt_id_is_not_attached(member, store):
    other = _client({"id": "u9", "email": "o@t.dev", "role": "member", "plan": "pro"})
    att = other.post("/api/study/attempts", json={"item_id": "si_872a0a87de98", "answer": "Doji"}).json()
    r = member.post("/api/study/items/si_872a0a87de98/feedback",
                    json={"kind": "other", "attempt_id": att["attempt_id"]})
    assert store.get_feedback(r.json()["id"])["attempt_id"] is None


def test_the_owner_door_applies_a_verdict(owner, store):
    r = owner.post("/api/study/items/si_21a45eab27a0/feedback", json={"kind": "great", "verdict": "approve"})
    assert r.status_code == 200 and r.json()["applied"] == "approve" and r.json()["role"] == "owner"
    assert store.get_item_full("si_21a45eab27a0")["review_status"] == "approved"


@pytest.mark.parametrize("body,code", [
    ({"kind": "meh"}, 400),
    ({"kind": "other", "verdict": "retire"}, 400),
])
def test_bad_bodies_are_400(owner, body, code):
    assert owner.post("/api/study/items/si_21a45eab27a0/feedback", json=body).status_code == code


def test_unknown_item_is_404(member):
    assert member.post("/api/study/items/si_nope/feedback", json={"kind": "other"}).status_code == 404


def test_admin_list_handle_export_and_the_queue_counts(owner, member, store):
    member.post("/api/study/items/si_872a0a87de98/feedback", json={"kind": "too_hard", "text": "whoa"})
    lst = owner.get("/api/study/admin/feedback").json()
    assert [f["kind"] for f in lst["feedback"]] == ["too_hard"] and lst["counts"]["open_total"] == 1
    assert owner.get("/api/study/admin/review").json()["feedback"]["open"] == {"si_872a0a87de98": 1}
    h = owner.post("/api/study/admin/feedback/handle", json={"ids": [lst["feedback"][0]["id"]], "note": "ok"}).json()
    assert h["handled"] == 1 and h["counts"]["open_total"] == 0
    assert owner.get("/api/study/admin/feedback").json()["feedback"] == []
    assert len(owner.get("/api/study/admin/feedback?unhandled=0").json()["feedback"]) == 1
    exp = owner.get("/api/study/admin/feedback/export?since_id=0").json()
    assert exp["next_since_id"] == 1 and exp["feedback"][0]["handled_note"] == "ok"


def test_admin_routes_need_an_admin(member):
    for path in ("/api/study/admin/feedback", "/api/study/admin/feedback/export"):
        assert member.get(path).status_code in (401, 403)
    assert member.post("/api/study/admin/feedback/handle", json={"ids": [1]}).status_code in (401, 403)
