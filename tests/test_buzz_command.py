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


def test_the_picker_cannot_offer_a_window_the_board_cannot_compute():
    """⛔ There were THREE lists: this picker, buzz_boards.WINDOW_LABEL, and
    window_bounds' if-chain -- and only the picker was pinned, by a HAND-TYPED
    literal set. Adding "yesterday" to the picker would have turned that test
    red, been "fixed" by editing the literal, and shipped a board headed
    "Most talked about - yesterday" over TODAY's numbers, because
    window_bounds' bare fallthrough returned today-since-the-open for anything
    it did not recognise. Wrong data, confident label, nothing raised.

    The picker now DERIVES from WINDOW_LABEL, and window_bounds refuses an
    unknown name. This asserts all three agree by construction, so the test
    above can stay a hand-typed statement of the owner's ask without being the
    only thing standing between the picker and the bounds.
    """
    import datetime as _dt
    from zoneinfo import ZoneInfo
    from api.services import buzz_boards, discord_interactions as di

    # Mid-afternoon on a weekday, so every window's start is genuinely behind
    # `now` (asking "since noon" at 11am is a legitimately empty range).
    now = int(_dt.datetime(2026, 9, 21, 15, 0,
                           tzinfo=ZoneInfo("America/New_York")).timestamp())
    assert set(di.WINDOW_CHOICES) == set(buzz_boards.WINDOW_LABEL)
    for name in di.WINDOW_CHOICES:
        start, end = buzz_boards.window_bounds(name, now)   # must not raise
        assert start < end == now
        # And the picker's display form is the board's own label, so the two
        # surfaces can never name one window two different ways.
        assert di.WINDOW_CHOICES[name].lower() == buzz_boards.WINDOW_LABEL[name]


def test_window_bounds_refuses_a_window_it_cannot_compute():
    """A window with no branch must raise, not quietly serve today's numbers
    under someone else's label."""
    from api.services import buzz_boards
    with pytest.raises(ValueError):
        buzz_boards.window_bounds("yesterday", 1_800_000_000)
    # The boundary that takes outside input coerces instead of raising, so the
    # bounds and the label always answer the same question.
    assert buzz_boards.normalize_window("yesterday") == buzz_boards.DEFAULT_WINDOW
    assert buzz_boards.normalize_window("month") == "month"


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


def test_the_text_bars_never_step_up_below_a_higher_ranked_row(mods):
    """⛔ THE BOARD MUST NOT CONTRADICT ITS OWN ORDER. Bars drew MENTIONS while
    the board ranks by PEOPLE, so the widest element on each row came from a
    different number than the sort. Measured live 2026-09-02 12:56p: three of
    fourteen rows stepped UP, e.g. DELL (8 people / 18 mentions) below COIN
    (9 / 9) with nearly double the bar. A reader takes the long bar as the
    rank. Drawing people makes it monotonic BY CONSTRUCTION."""
    store, reply = mods
    import datetime as dt
    ET = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=ET).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    mid = 9000
    # LOUD leads on mentions; BROAD has more people but fewer mentions. Under
    # the current ruling LOUD ranks first, and the bar must follow that order.
    for i in range(9):
        store.record_mentions([(str(mid), CH, f"b{i}", "BROAD", ts, "exact")]); mid += 1
    for i in range(20):
        store.record_mentions([(str(mid), CH, f"l{i % 4}", "LOUD", ts, "exact")]); mid += 1

    text = reply.build_board_text(now, "open")
    bars = [ln.count("█") for ln in text.splitlines() if ln.startswith(("BROAD", "LOUD"))]
    assert len(bars) == 2, text
    assert bars == sorted(bars, reverse=True), f"bar stepped up below a higher row: {bars}"
    assert all(1 <= b <= reply.BAR_W for b in bars)


# ⚰️ test_no_bar_overflows_its_column_when_the_leader_is_not_the_loudest lived
# here until 2026-09-02. It asserted the LOUDEST row draws the longest bar,
# which was right while bars drew mentions and is wrong now that they draw
# PEOPLE -- the quantity the board is actually ranked by. Its real content
# (no bar exceeds BAR_W) is carried by the monotonicity rail above, which is
# strictly stronger: a bar that overflows also breaks the ordering it belongs
# to. Removed rather than left contradicting its replacement.

