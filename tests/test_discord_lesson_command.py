"""/lesson: a search of the video-lesson library from Discord. The answer is
visible to the channel (owner ruling 2026-11-13; it was private before that);
the throttle, the empty-query nudge and the missing-token refusal stay private."""
from __future__ import annotations

import pytest

from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

EPHEMERAL = 64


def _lesson(about="stop loss", uid="900", token="tok", channel=None):
    opts = [] if about is None else [{"name": "about", "type": 3, "value": about}]
    body = {"type": 2, "application_id": "123", "token": token, "guild_id": UT_GUILD,
            "member": {"user": {"id": uid}}, "data": {"name": "lesson", "options": opts}}
    if channel is not None:
        body["channel_id"] = channel
    return body


@pytest.fixture()
def route(monkeypatch, tmp_path):
    from api.services import discord_interactions as di
    di.reset_rate_for_tests()
    # The command-channel gate reads these; a value left in the shell would
    # decide every test below instead of the test deciding it.
    monkeypatch.delenv("CHART_FLOW_CHANNEL_ID", raising=False)
    monkeypatch.delenv("FLOW_CMD_CHANNEL_ID", raising=False)
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


def test_a_search_defers_PUBLICLY_and_schedules_the_job(route, monkeypatch):
    """Discord fixes a deferred reply's visibility at the defer, so the defer is
    the one place this is decided: no flags = the channel sees the answer."""
    client, sk, rt = route
    scheduled = []
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: scheduled.append(a))
    r = _post(client, sk, _lesson("stop loss")).json()
    assert r["type"] == 5, "defer first, search after"
    assert r == {"type": 5}, "the reply would have gone to the asking member only"
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


def test_the_job_delivers_the_reply_and_survives_a_failing_search(route):
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


# ── /lesson is HELD TO THE COMMAND CHANNEL. Owner ruling 2026-11-13: "just in
# UCT Intelligence" -- #uct-intelligence, the channel /chart, /flow and /cot
# already answer in. It reads the SAME allowlist (CHART_FLOW_CHANNEL_ID), so
# there is one list of where the bot answers and not two that can disagree.

COMMAND_CHANNEL = "777"      # the member-facing one: first on the list
ADMIN_CHANNEL = "888"        # a later entry: private, admins + bot
ELSEWHERE = "555"


def _scheduled(rt, monkeypatch) -> list:
    jobs: list = []
    monkeypatch.setattr(rt, "run_lesson_search_job", lambda *a, **k: jobs.append(a))
    return jobs


def test_lesson_outside_the_command_channel_is_refused_privately(route, monkeypatch):
    client, sk, rt = route
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f"{COMMAND_CHANNEL},{ADMIN_CHANNEL}")
    jobs = _scheduled(rt, monkeypatch)
    r = _post(client, sk, _lesson(channel=ELSEWHERE)).json()
    assert r["type"] == 4 and r["data"]["flags"] == EPHEMERAL, "the refusal is for one member"
    assert f"<#{COMMAND_CHANNEL}>" in r["data"]["content"], "the member is told where it does work"
    assert ADMIN_CHANNEL not in r["data"]["content"], "never point a member at a private channel"
    assert "/lesson" in r["data"]["content"], "the nudge names the command the member ran"
    assert jobs == [], "a refused search still ran"


def test_lesson_inside_the_command_channel_still_answers_publicly(route, monkeypatch):
    """Non-vacuity for the row above: a gate that refused everything would pass it."""
    client, sk, rt = route
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", f"{COMMAND_CHANNEL},{ADMIN_CHANNEL}")
    jobs = _scheduled(rt, monkeypatch)
    assert _post(client, sk, _lesson(channel=COMMAND_CHANNEL)).json() == {"type": 5}
    assert _post(client, sk, _lesson(uid="901", channel=ADMIN_CHANNEL)).json() == {"type": 5}
    assert len(jobs) == 2


def test_lesson_is_unrestricted_when_no_channel_is_configured(route, monkeypatch):
    """Unset = allowed anywhere, exactly as /chart behaves (local dev, tests)."""
    client, sk, rt = route
    jobs = _scheduled(rt, monkeypatch)
    assert _post(client, sk, _lesson(channel=ELSEWHERE)).json() == {"type": 5}
    assert len(jobs) == 1


def test_a_refused_lesson_does_not_spend_the_members_budget(route, monkeypatch):
    """The gate is checked BEFORE the throttle. Otherwise a member who tries the
    command in the wrong channel, reads the nudge and walks to the right one is
    told to slow down for following the instruction."""
    client, sk, rt = route
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", COMMAND_CHANNEL)
    monkeypatch.setenv("DISCORD_CHART_USER_RATE", "1/60")
    _scheduled(rt, monkeypatch)
    assert _post(client, sk, _lesson(channel=ELSEWHERE)).json()["type"] == 4
    assert _post(client, sk, _lesson(channel=COMMAND_CHANNEL)).json() == {"type": 5}


def test_the_chart_nudge_still_reads_as_it_did(route, monkeypatch):
    """The nudge now names the command. /chart's own wording is what members
    already see in the guide, so it is pinned rather than left to drift."""
    client, sk, rt = route
    monkeypatch.setenv("CHART_FLOW_CHANNEL_ID", COMMAND_CHANNEL)
    assert rt._channel_nudge()["data"]["content"] == f"Please use <#{COMMAND_CHANNEL}> for chart & flow requests."
    monkeypatch.delenv("CHART_FLOW_CHANNEL_ID")
    assert rt._channel_nudge("/lesson")["data"]["content"] == "Not available in this channel."
