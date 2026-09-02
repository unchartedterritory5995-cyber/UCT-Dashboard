# tests/test_buzz_command.py
"""/buzz: registration payload, reply text, autocomplete backed by real data."""
from __future__ import annotations

import pytest

CH = "CH1"


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", CH)
    from api.services import buzz_store, buzz_reply
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_reply


def test_buzz_is_registered_as_exactly_one_command():
    from api.services import discord_interactions as di
    names = [c["name"] for c in di.build_commands()]
    assert names.count("buzz") == 1
    assert not {"trending", "mentions", "hot"} & set(names), "one command, one picker row"


def test_buzz_command_is_guild_only():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    assert cmd["integration_types"] == [0]
    assert cmd["contexts"] == [0]


def test_buzz_options_are_ticker_and_window_only():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    assert [o["name"] for o in cmd.get("options", [])] == ["ticker", "window"]
    ticker = cmd["options"][0]
    assert ticker.get("autocomplete") is True
    assert ticker.get("required") in (False, None)


def test_window_choices_cover_what_the_owner_asked_for():
    from api.services import discord_interactions as di
    assert set(di.WINDOW_CHOICES) == {"open", "today", "noon", "week", "month"}


def test_every_choice_obeys_discord_limits():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    for opt in cmd["options"]:
        for ch in opt.get("choices", []):
            assert len(ch["name"]) <= 100 and len(str(ch["value"])) <= 100
        assert len(opt.get("choices", [])) <= 25


def test_board_text_names_both_boards(mods):
    store, reply = mods
    import datetime as dt
    ET = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=ET).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), CH, f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    text = reply.build_board_text(now, "open")
    assert "NVDA" in text
    assert "6" in text
    assert "counted through" in text


def test_board_text_when_empty_says_so_rather_than_showing_a_blank_board(mods):
    store, reply = mods
    import time
    text = reply.build_board_text(int(time.time()), "open")
    assert "nothing" in text.lower() or "no mentions" in text.lower()


def test_ticker_text_includes_a_jump_link(mods):
    store, reply = mods
    import datetime as dt
    ET = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=ET).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([("1544451055910129726", CH, "a", "NVDA", ts, "exact")])
    text = reply.build_ticker_text("NVDA", "open", now)
    assert "discord.com/channels/" in text


def test_autocomplete_is_backed_by_real_mentions_not_the_universe(mods):
    """v20: a suggestion list that cannot offer a name members actually use
    reads as a refusal. Here the only valid suggestions ARE the counted ones."""
    store, _ = mods
    store.record_mentions([
        ("1", CH, "a", "NVDA", 1, "exact"),
        ("2", CH, "b", "NVDA", 2, "exact"),
        ("3", CH, "c", "NVAX", 3, "exact"),
    ])
    from api.routers import discord_interactions as rt
    choices = rt.buzz_ticker_choices("NV")
    assert [c["value"] for c in choices] == ["NVDA", "NVAX"]
    assert len(choices) <= 25


def test_autocomplete_returns_at_most_25(mods):
    store, _ = mods
    store.record_mentions([(str(i), CH, "a", f"T{i:03d}", i, "exact") for i in range(40)])
    from api.routers import discord_interactions as rt
    assert len(rt.buzz_ticker_choices("T")) <= 25


# ── run_buzz_image_job: the ticker-less /buzz board image, defer-and-PATCH ──
#
# `BUZZ_IMAGE_ENABLED` defaults ON (gated only on CHART_RENDERER_URL, already
# set in production for /chart) -- unlike the digest, this interaction path is
# LIVE the moment this ships, not dark. Pin it directly: fake render_fn/edit_fn
# capturing the call, across the three outcomes a background render can have.
# The member must always end up with a resolved reply, never a stuck
# "thinking...".

def test_buzz_image_job_attaches_the_png_when_the_render_succeeds():
    from api.routers import discord_interactions as rt
    calls = []
    rt.run_buzz_image_job("APP1", "TOK1", "board text", "open",
                          render_fn=lambda w: b"\x89PNGdata",
                          edit_fn=lambda *a, **kw: calls.append(kw))
    assert len(calls) == 1, "the reply is resolved exactly once"
    assert calls[0]["content"] == "board text"
    assert calls[0]["png"] == b"\x89PNGdata"
    assert calls[0]["filename"] == "buzz.png"


def test_buzz_image_job_keeps_the_text_reply_when_the_render_is_empty():
    from api.routers import discord_interactions as rt
    calls = []
    rt.run_buzz_image_job("APP1", "TOK1", "board text", "open",
                          render_fn=lambda w: None,
                          edit_fn=lambda *a, **kw: calls.append(kw))
    assert len(calls) == 1, "text-only edit still resolves the reply"
    assert calls[0]["content"] == "board text"
    assert calls[0].get("png") is None


def test_buzz_image_job_keeps_the_text_reply_when_the_render_raises():
    from api.routers import discord_interactions as rt
    calls = []

    def boom(window):
        raise RuntimeError("renderer is down")

    rt.run_buzz_image_job("APP1", "TOK1", "board text", "open",
                          render_fn=boom,
                          edit_fn=lambda *a, **kw: calls.append(kw))
    assert len(calls) == 1, "a render exception must not leave the reply stuck"
    assert calls[0]["content"] == "board text"
    assert calls[0].get("png") is None
