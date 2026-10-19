"""/lesson: a private search of the video-lesson library from Discord."""
from __future__ import annotations

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

EPHEMERAL = 64


def _lesson(about="stop loss", uid="900", token="tok"):
    opts = [] if about is None else [{"name": "about", "type": 3, "value": about}]
    return {"type": 2, "application_id": "123", "token": token, "guild_id": UT_GUILD,
            "member": {"user": {"id": uid}}, "data": {"name": "lesson", "options": opts}}


@pytest.fixture()
def route(monkeypatch, tmp_path):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    monkeypatch.setenv("TSDR_LESSONS_DB_PATH", str(tmp_path / "lessons.db"))
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    return client, sk, rt


def test_lesson_is_registered_once_with_one_required_text_field():
    from api.services import discord_interactions as di
    cmds = [c for c in di.build_commands() if c["name"] == "lesson"]
    assert len(cmds) == 1
    cmd = cmds[0]
    assert cmd["integration_types"] == [0] and cmd["contexts"] == [0]          # guild only, like the rest
    assert [o["name"] for o in cmd["options"]] == ["about"]
    assert cmd["options"][0]["required"] is True and cmd["options"][0]["type"] == 3
    assert "autocomplete" not in cmd["options"][0]


def test_a_search_defers_EPHEMERALLY_and_schedules_the_job(route, monkeypatch):
    client, sk, rt = route
    scheduled = []
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: scheduled.append(a))
    r = _post(client, sk, _lesson("stop loss")).json()
    assert r["type"] == 5, "defer first, search after"
    assert r["data"]["flags"] == EPHEMERAL, "the reply would have gone to the whole channel"
    assert scheduled == [("123", "tok", "stop loss")]


def test_an_empty_or_missing_query_is_answered_at_once_with_an_example(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: pytest.fail("no search for an empty query"))
    for body in (_lesson("   "), _lesson(None)):
        r = _post(client, sk, body).json()
        assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL
        assert "/lesson stop loss" in r["data"]["content"]


def test_no_reply_token_still_answers_immediately(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: pytest.fail("nothing to deliver to"))
    r = _post(client, sk, _lesson(token="")).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL and "token" in r["data"]["content"].lower()


def test_a_member_is_throttled_like_the_other_commands(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "1/60")
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: None)
    assert _post(client, sk, _lesson()).json()["type"] == 5
    r = _post(client, sk, _lesson()).json()
    assert r["type"] == 4 and "searches" in r["data"]["content"]


def test_the_job_delivers_the_reply_privately_and_survives_a_failing_search(route):
    client, sk, rt = route
    edits = []
    rt.run_lesson_search_job("APP", "TOK", "stop loss",
                             search_fn=lambda q: [{"attachment_id": "a", "title": "Stops", "url": "https://d/1",
                                                   "level": "beginner", "section": "Trade Management",
                                                   "day": "Mar 1, 2026", "score": 1, "at": "", "watch": "",
                                                   "quote": ""}],
                             edit_fn=lambda a, t, **kw: edits.append((a, t, kw)))
    assert edits[0][0:2] == ("APP", "TOK")
    assert "**Lessons on “stop loss”**" in edits[0][2]["content"] and "[Stops](<https://d/1>)" in edits[0][2]["content"]

    def boom(q):
        raise RuntimeError("db locked")
    rt.run_lesson_search_job("APP", "TOK", "stop loss", search_fn=boom,
                             edit_fn=lambda a, t, **kw: edits.append((a, t, kw)))
    assert "hit a snag" in edits[1][2]["content"]

    def cannot_send(a, t, **kw):
        raise RuntimeError("discord down")
    rt.run_lesson_search_job("APP", "TOK", "stop loss", search_fn=lambda q: [], edit_fn=cannot_send)   # never raises


def test_the_job_searches_the_real_library_by_default(route, monkeypatch):
    client, sk, rt = route
    from api.services import tsdr_lessons as tl
    tl.init_db() if hasattr(tl, "init_db") else None
    edits = []
    rt.run_lesson_search_job("APP", "TOK", "zebra", edit_fn=lambda a, t, **kw: edits.append(kw["content"]))
    assert len(edits) == 1 and "Nothing in the lesson library" in edits[0]
