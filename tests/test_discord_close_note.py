"""The written read that ships with the into-the-close charts.

Owner, 2026-08-27: "Also send a nice little message of insight and commentary
with it." It posts unattended to a PUBLIC channel, so what it refuses to say
matters more than what it says.
"""
import pytest

from api.services import discord_close_note as note
from api.services import discord_index_close as idx

GOOD = ("Semis carried the tape again while software lagged, and the broad index barely "
        "budged, which tells you how narrow the leadership still is. Breadth stayed thin "
        "underneath. Watch whether the laggards start catching a bid next session.")


@pytest.fixture(autouse=True)
def _armed(monkeypatch):
    monkeypatch.delenv("DISCORD_CLOSE_NOTE_ENABLED", raising=False)


# ── the guarantee: no numbers reach the channel from a model ──────────────

def test_a_note_may_not_contain_a_single_digit():
    """⛔ The whole safety design. A model writing market prose will invent
    "SPY closed at 645"; forbidding digits removes the class rather than
    policing it. Every number a member sees is computed, not written."""
    assert note.validate(GOOD) is None
    for bad in ("SPY closed up 0.4% today and semis led the tape higher again.",
                "The index added 12 handles into the bell while breadth stayed narrow.",
                "Semis led. Watch the 50 day."):
        assert note.validate(bad) == "contains a number", bad


def test_it_refuses_markdown_emoji_mentions_and_em_dashes():
    """It is pasted straight into a Discord message: markup would render, an @
    would ping the whole channel, and the owner's standing rule for member-facing
    prose is zero em-dashes."""
    assert note.validate(GOOD) is None, "the control clears every check, so a failure below is real"
    for bad, why in (
        ("**Semis** led the tape while software lagged and breadth stayed narrow all session.", "markdown"),
        ("Semis led the tape while software lagged, breadth stayed narrow. @everyone", "banned character"),
        ("Semis led the tape while software lagged, and breadth stayed narrow — watch it.", "banned character"),
        ("Semis led the tape while software lagged and breadth stayed narrow. \U0001F680", "markup"),
        ("- Semis led the tape\n- Software lagged\n- Breadth stayed narrow all session long", "list"),
        ("<b>Semis</b> led the tape while software lagged and breadth stayed narrow today.", "markup"),
    ):
        assert note.validate(bad) == why, bad
    assert note.validate("") == "empty" and note.validate(None) == "empty"


def test_it_refuses_a_note_that_is_too_short_or_a_speech():
    assert note.validate("Semis led.").startswith("length")
    assert note.validate(" ".join(["word"] * 200)).startswith("length")
    assert note.validate(" ".join(["word"] * note.MIN_WORDS)) is None


# ── the session, described without numbers ────────────────────────────────

def test_the_session_is_handed_over_as_words_never_as_figures():
    """The model cannot print a digit it was never given."""
    text = note.describe({"QQQ": 1.4, "SPY": 0.1, "IWM": -2.6, "DIA": -0.4, "SMH": 3.2})
    assert "1.4" not in text and "%" not in text
    assert "QQQ: solidly up" in text and "SPY: flat" in text
    assert "IWM: sharply down" in text and "DIA: barely down" in text
    assert "SMH: sharply up" in text
    assert note.describe({"QQQ": None, "SPY": "n/a"}) == ""
    assert note.describe({}) == ""


# ── composing, and every way it declines to ───────────────────────────────

def test_a_good_note_is_returned_and_a_bad_one_is_retried_once_then_dropped():
    calls = []

    def two_tries(prompt):
        calls.append(prompt)
        return "Semis led, SPY was up 0.4% on the day." if len(calls) == 1 else GOOD

    assert note.compose({"QQQ": 1.0}, client_fn=two_tries) == GOOD
    assert len(calls) == 2 and "rejected because it contains a number" in calls[1]

    # never usable -> "" rather than a bad note in a public channel
    bad = []
    assert note.compose({"QQQ": 1.0}, client_fn=lambda p: bad.append(1) or "SPY up 2%.") == ""
    assert len(bad) == 2, "one retry, then it gives up"


def test_every_failure_is_silence_not_an_exception(monkeypatch):
    """The charts are the product. Nothing here may break the post."""
    assert note.compose({"QQQ": 1.0}, client_fn=lambda p: (_ for _ in ()).throw(RuntimeError("api down"))) == ""
    assert note.compose({}, client_fn=lambda p: GOOD) == "", "no session, no note"
    assert note.compose({"QQQ": None}, client_fn=lambda p: GOOD) == "", "nothing describable"
    monkeypatch.setenv("DISCORD_CLOSE_NOTE_ENABLED", "0")
    assert note.compose({"QQQ": 1.0}, client_fn=lambda p: GOOD) == ""


def test_the_prompt_forbids_numbers_in_the_words_the_model_reads():
    """A rule the model is never told is not a rule; the validator is the
    backstop, not the instruction."""
    p = note._prompt(note.describe({"QQQ": 1.4}))
    low = p.lower()
    assert "never write a number" in low and "digit" in low
    assert "em-dash" in low and "emoji" in low and "markdown" in low
    assert "buy or sell" in low, "it must not give advice in a public channel"


# ── how it reaches the post ───────────────────────────────────────────────

def test_the_note_leads_the_post_and_its_absence_changes_nothing_else():
    import datetime as _dt
    now = _dt.datetime(2026, 8, 27, 15, 45)
    charts = [(s, b"png", f"{s}.png") for s in idx.INDEXES]
    with_note = idx.build_messages(now, charts, [], [], note=GOOD)[0][0]
    without = idx.build_messages(now, charts, [], [], note="")[0][0]
    assert GOOD in with_note and GOOD not in without
    assert with_note.startswith("**Into the close") and without.startswith("**Into the close")
    assert "QQQ" in without, "the roster line survives either way"


def test_the_movers_number_is_reused_rather_than_re_quoted():
    """`pick_notable` already paid for those quotes. Asking again would be a
    second authority over the same number and could disagree with the header."""
    asked = {}
    shown = ("QQQ", "SMH", "IGV", "XBI")          # exactly what rendered
    moves = idx.session_moves(shown, [("XBI", -3.9)],
                              snapshot_fn=lambda pool: asked.update(pool=pool) or {"QQQ": 1.0, "SMH": 2.0})
    assert "XBI" not in asked["pool"], "the mover is already known"
    assert moves["XBI"] == -3.9 and moves["QQQ"] == 1.0
    assert "IWM" not in moves, "a chart that did not render is not described"
    assert idx.session_moves((), [], snapshot_fn=lambda p: (_ for _ in ()).throw(RuntimeError("down"))) == {}


def test_a_note_that_cannot_be_written_still_posts_the_charts(monkeypatch, tmp_path):
    import datetime as _dt
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [])
    posts = []
    rep = idx.run_close_post(
        bars_fn=lambda s, tf, n: [{"t": 20260827, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 9}],
        house_fn=lambda *a: b"png", stats_fn=lambda b: {}, name_fn=lambda s, tf, t: f"{s}.png",
        note_fn=lambda moves: (_ for _ in ()).throw(RuntimeError("model down")),
        post_fn=lambda url, p, f: posts.append(p["content"]) or True,
        now_et=_dt.datetime(2026, 8, 27, 15, 45))
    assert rep["posted"] == 2 and rep["note"] == ""
    assert posts and "Into the close" in posts[0]


def test_the_note_only_ever_describes_charts_that_actually_posted(monkeypatch, tmp_path):
    """⛔ CAUGHT BY THE 2026-08-27 DRY RUN, before anything was public. The note
    was composed from the roster we INTENDED, so on a pod seconds out of a deploy
    it discussed QQQ, IWM and XME while none of the three had a chart in the
    message. Prose about something the member cannot see reads as broken."""
    import datetime as _dt
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DISCORD_INDEX_CLOSE_ENABLED", "1")
    monkeypatch.setenv("DISCORD_TSDR_WEBHOOK_URL", "https://discord.test/hook")
    monkeypatch.setattr(idx, "pick_notable", lambda **k: [("XME", 2.2), ("XLK", 3.1)])
    dead = {"QQQ", "IWM", "XME"}                      # exactly the three that failed that day
    import api.services.massive as massive
    monkeypatch.setattr(massive, "get_etf_snapshots",
                        lambda pool, **k: {s: 1.0 for s in pool}, raising=False)
    seen = {}
    rep = idx.run_close_post(
        bars_fn=lambda s, tf, n: ([] if s in dead else
                                  [{"t": 20260827, "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 9}]),
        house_fn=lambda *a: b"png", stats_fn=lambda b: {}, name_fn=lambda s, tf, t: f"{s}.png",
        note_fn=lambda moves: seen.update(moves=moves) or "A quiet, narrow tape with leadership "
                                                         "concentrated in a handful of places, and "
                                                         "little confirmation underneath it so far.",
        post_fn=lambda url, p, f: True, sleep_fn=lambda s: None,
        now_et=_dt.datetime(2026, 8, 27, 15, 45))
    assert rep["symbols"] == ["SPY", "DIA", "SMH", "IGV", "XLK"]
    assert set(seen["moves"]) == set(rep["symbols"]), "the note is told about the post, not the plan"
    assert not (dead & set(seen["moves"])), "a chart nobody can see is never described"
    # the mover that failed to render is dropped from the header too
    assert "XME" not in rep["messages"][1] and "XLK" in rep["messages"][1]
