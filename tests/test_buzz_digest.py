# tests/test_buzz_digest.py
"""Buzz image + digest: blank guard, disarmed default, one post per SLOT, lock."""
from __future__ import annotations

import datetime as dt

import pytest

ET = dt.timezone(dt.timedelta(hours=-4))


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_STATE_PATH", str(tmp_path / "buzz_state.json"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_store, buzz_image, discord_buzz_digest
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_image, discord_buzz_digest


def test_digest_is_disarmed_by_default(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.delenv("BUZZ_DIGEST_ENABLED", raising=False)
    assert digest.digest_enabled() is False


def test_digest_refuses_to_post_while_disarmed(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.delenv("BUZZ_DIGEST_ENABLED", raising=False)
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: b"\x89PNG-fake",
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert posts == []
    assert out["posted"] is False


def test_armed_without_a_destination_warns_rather_than_failing_silently(mods, monkeypatch, caplog):
    """Armed + unconfigured must be distinguishable from a quiet day. Otherwise
    a mistyped destination produces the same silence as 'nothing to report' --
    every slot, forever. The warning must name BOTH ways to fix it, since a
    reader who only knows about the webhook cannot tell that a channel id would
    also do."""
    _, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.delenv("BUZZ_DIGEST_WEBHOOK", raising=False)
    monkeypatch.delenv("BUZZ_DIGEST_CHANNEL", raising=False)
    with caplog.at_level("WARNING"):
        out = digest.run_digest(now=1788300000)
    assert out["reason"] == "no destination"
    assert any("BUZZ_DIGEST_WEBHOOK" in r.message for r in caplog.records)
    assert any("BUZZ_DIGEST_CHANNEL" in r.message for r in caplog.records)


def test_digest_posts_once_per_day(mods, monkeypatch):
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    now = int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp())
    posts = []

    def post(**kw):
        posts.append(kw)
        return True

    first = digest.run_digest(now=now, render_fn=lambda w: b"\x89PNGdata", post_fn=post)
    assert first["posted"] is True and len(posts) == 1
    second = digest.run_digest(now=now + 60, render_fn=lambda w: b"\x89PNGdata", post_fn=post)
    assert second["posted"] is False, "already posted today"
    assert len(posts) == 1


def test_digest_posts_text_when_the_render_fails(mods, monkeypatch):
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: None,
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is True
    assert posts[0]["png"] is None and "NVDA" in posts[0]["content"]


def test_digest_skips_a_day_with_nothing_to_say(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: b"\x89PNG",
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is False and posts == []


def test_a_non_png_body_is_rejected(mods, monkeypatch):
    """A 200 that is not a PNG is a failed render, not a board. The chart work
    shipped blank images twice by trusting the status code."""
    _, image, _ = mods
    monkeypatch.setenv("CHART_RENDERER_URL", "https://renderer.invalid")

    class FakeResp:
        is_success = True
        content = b"<html>error</html>"
        status_code = 200
        text = "error"

    class FakeClient:
        def post(self, *a, **k):
            return FakeResp()

    assert image.render_board_png("open", client=FakeClient()) is None


def test_a_ready_but_empty_board_is_rejected(mods, monkeypatch):
    """⭐ ADDED beyond the brief's Step 1 sample: `window.__buzzReady` (BuzzRender.jsx)
    flips true even when there are zero rows to draw (the `nothingToMeasure`
    branch) -- readiness is not drawn-ness. `probe_js` counts [data-buzz-row]
    elements and the renderer echoes it back as X-Chart-Probe; a 0 there must be
    discarded exactly like a non-PNG body, per this task's own brief. Not in the
    given test file, so added here rather than left unverified."""
    _, image, _ = mods
    monkeypatch.setenv("CHART_RENDERER_URL", "https://renderer.invalid")

    class FakeResp:
        is_success = True
        content = b"\x89PNGdata"
        status_code = 200
        text = ""
        headers = {"X-Chart-Probe": "0"}

    class FakeClient:
        def post(self, *a, **k):
            return FakeResp()

    assert image.render_board_png("open", client=FakeClient()) is None


def test_a_ready_and_drawn_board_is_kept(mods, monkeypatch):
    """Control for the test above: a non-zero probe count must NOT be discarded,
    or the guard above would be passing for the wrong reason (it could reject
    every render, never just the empty one)."""
    _, image, _ = mods
    monkeypatch.setenv("CHART_RENDERER_URL", "https://renderer.invalid")

    class FakeResp:
        is_success = True
        content = b"\x89PNGdata"
        status_code = 200
        text = ""
        headers = {"X-Chart-Probe": "5"}

    class FakeClient:
        def post(self, *a, **k):
            return FakeResp()

    assert image.render_board_png("open", client=FakeClient()) == b"\x89PNGdata"


def _arm(monkeypatch):
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")


def _seed(store, day=1, hour=9, minute=45, n=6, sym="NVDA", start=5000):
    ts = int(dt.datetime(2026, 9, day, hour, minute, tzinfo=ET).timestamp())
    store.record_mentions([(str(start + i), "CH1", f"u{i}", sym, ts, "exact") for i in range(n)])


def test_a_later_slot_is_NOT_blocked_by_an_earlier_one(mods, monkeypatch):
    """⛔ THE REGRESSION THIS CADENCE CREATED. The dedup was a single
    last-posted DAY, which is correct for one post a day and silently wrong for
    seven: the 10:00 post would stamp the day and every later slot would find
    it and skip -- one post instead of seven, with "already posted today" in
    the log looking entirely reasonable."""
    store, _, digest = mods
    _arm(monkeypatch)
    _seed(store)
    posts = []

    def post(**kw):
        posts.append(kw)
        return True

    for h, m in [(10, 0), (10, 30), (11, 30), (12, 30), (14, 0), (16, 15), (17, 30)]:
        now = int(dt.datetime(2026, 9, 1, h, m, tzinfo=ET).timestamp())
        out = digest.run_digest(now=now, slot=digest.slot_label(h, m),
                                render_fn=lambda w: b"\x89PNGdata", post_fn=post)
        assert out["posted"] is True, f"{h:02d}:{m:02d} was blocked: {out}"
    assert len(posts) == 7

    # ...and each one is still individually idempotent.
    now = int(dt.datetime(2026, 9, 1, 11, 30, tzinfo=ET).timestamp())
    again = digest.run_digest(now=now, slot="11:30",
                              render_fn=lambda w: b"\x89PNGdata", post_fn=post)
    assert again["posted"] is False
    assert len(posts) == 7


def test_the_owner_cadence_is_the_default(mods, monkeypatch):
    """Seven slots through the session (owner, 2026-09-02), not one at the close."""
    _, _, digest = mods
    monkeypatch.delenv("BUZZ_DIGEST_TIMES", raising=False)
    assert digest.digest_times() == ((10, 0), (10, 30), (11, 30), (12, 30),
                                     (14, 0), (16, 15), (17, 30))


def test_a_malformed_times_list_posts_NOTHING_rather_than_falling_back(mods, monkeypatch, caplog):
    """⛔ Falling back to the default on a typo would post at times the owner
    never asked for AND make the typo invisible. Empty + a warning is the
    honest failure -- same contract as armed-but-unconfigured."""
    import logging
    _, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_TIMES", "banana, 99:99, :")
    with caplog.at_level(logging.WARNING):
        assert digest.digest_times() == ()
    assert "BUZZ_DIGEST_TIMES" in caplog.text
    # CONTROL: a good list still parses, so this is not just "always empty".
    monkeypatch.setenv("BUZZ_DIGEST_TIMES", "09:30, 16:00")
    assert digest.digest_times() == ((9, 30), (16, 0))


def test_a_quiet_slot_does_not_cancel_the_next_one(mods, monkeypatch):
    """"Nothing to say" must NOT mark the slot posted. At 10:00 the room may
    genuinely have said nothing; that cannot be allowed to consume 10:30."""
    store, _, digest = mods
    _arm(monkeypatch)
    posts = []
    quiet = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    out = digest.run_digest(now=quiet, slot="10:00", post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is False and out["reason"] == "nothing to say"
    assert digest.already_posted("2026-09-01 10:00") is False

    # The room speaks, and the SAME slot can still post later in its window.
    _seed(store)
    out2 = digest.run_digest(now=quiet + 300, slot="10:00",
                             render_fn=lambda w: None, post_fn=lambda **kw: posts.append(kw) or True)
    assert out2["posted"] is True and len(posts) == 1


def test_a_late_misfire_dedups_against_the_slot_it_was_meant_to_be(mods, monkeypatch):
    """APScheduler fires within misfire_grace_time, so a run can land minutes
    late. Without slot mapping it would key off the wall clock ("16:18") and
    post a second time next to the real 16:15."""
    store, _, digest = mods
    _arm(monkeypatch)
    _seed(store)
    posts = []

    def post(**kw):
        posts.append(kw)
        return True

    on_time = int(dt.datetime(2026, 9, 1, 16, 15, tzinfo=ET).timestamp())
    assert digest.run_digest(now=on_time, slot="16:15",
                             render_fn=lambda w: None, post_fn=post)["posted"] is True
    late = int(dt.datetime(2026, 9, 1, 16, 18, tzinfo=ET).timestamp())
    out = digest.run_digest(now=late, render_fn=lambda w: None, post_fn=post)  # no slot passed
    assert out["slot"] == "16:15", out
    assert out["posted"] is False
    assert len(posts) == 1


def test_a_channel_id_posts_as_the_bot_and_needs_no_webhook(mods, monkeypatch):
    """⛔ Activating the digest should not require a human to create a webhook.
    The bot already holds SEND_MESSAGES, so a channel id is a complete
    destination. Asserts the ROUTE taken, not merely that something posted."""
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.delenv("BUZZ_DIGEST_WEBHOOK", raising=False)
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "1216816863313657886")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "tok")
    _seed(store)
    seen = {}

    def fake_bot_post(channel_id, content, png):
        seen["channel"] = channel_id
        seen["content"] = content
        return True

    monkeypatch.setattr(digest, "_post_as_bot", fake_bot_post)
    monkeypatch.setattr(digest, "_post", lambda *a, **k: pytest.fail("webhook path must not run"))
    now = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    out = digest.run_digest(now=now, slot="10:00", render_fn=lambda w: None)
    assert out["posted"] is True
    assert seen["channel"] == "1216816863313657886"
    assert "Most talked about" in seen["content"]


def test_the_channel_wins_when_both_destinations_are_set(mods, monkeypatch):
    """CONTROL for the test above -- and the tie-break has to be stated, or a
    leftover webhook silently keeps winning after someone sets a channel."""
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "999")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "tok")
    _seed(store)
    route = []
    monkeypatch.setattr(digest, "_post_as_bot", lambda c, t, p: route.append("bot") or True)
    monkeypatch.setattr(digest, "_post", lambda u, t, p: route.append("webhook") or True)
    now = int(dt.datetime(2026, 9, 1, 12, 30, tzinfo=ET).timestamp())
    assert digest.run_digest(now=now, slot="12:30", render_fn=lambda w: None)["posted"] is True
    assert route == ["bot"]


def test_a_channel_without_a_bot_token_fails_loudly_instead_of_posting(mods, monkeypatch, caplog):
    """The digest can be armed independently of a working ingest, so the token
    it borrows may be missing. That must be a named failure, not a silent one."""
    import logging
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "999")
    monkeypatch.delenv("BUZZ_DIGEST_WEBHOOK", raising=False)
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    _seed(store)
    now = int(dt.datetime(2026, 9, 1, 14, 0, tzinfo=ET).timestamp())
    with caplog.at_level(logging.WARNING):
        out = digest.run_digest(now=now, slot="14:00", render_fn=lambda w: None)
    assert out["posted"] is False
    assert "DISCORD_BOT_TOKEN" in caplog.text
    assert digest.already_posted("2026-09-01 14:00") is False, "a failed post must not consume the slot"


# ── Catch-up for a checkpoint the scheduler never fired.
#
# APScheduler's jobs live in an in-memory store here, so a pod restarting
# across 16:15 does not MISS that fire -- it never creates it. misfire_grace_time
# is blind to a job that was never scheduled, and the slot disappears without a
# log line. That is the same "silence reads as not-yet" trap that let a
# truncated backfill pass for a finished one on this branch.

def _at(h, m, day=1):
    return int(dt.datetime(2026, 9, day, h, m, tzinfo=ET).timestamp())


def test_a_slot_the_scheduler_never_fired_is_posted_within_the_window(mods, monkeypatch):
    store, _, digest = mods
    _seed(store)
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    posts = []
    out = digest.catch_up(now=_at(16, 25),          # 10m after the 16:15 slot
                          render_fn=lambda w: None,
                          post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is True
    assert out["slot"] == "16:15", "it must post under the SLOT's label, not the clock's"
    assert len(posts) == 1


def test_a_caught_up_slot_is_not_posted_a_second_time(mods, monkeypatch):
    store, _, digest = mods
    _seed(store)
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    posts = []
    kw = dict(render_fn=lambda w: None, post_fn=lambda **k: posts.append(k) or True)
    assert digest.catch_up(now=_at(16, 20), **kw)["posted"] is True
    assert digest.catch_up(now=_at(16, 21), **kw)["posted"] is False
    assert digest.catch_up(now=_at(16, 22), **kw)["posted"] is False
    assert len(posts) == 1


def test_a_slot_missed_by_an_hour_is_recorded_and_warned_not_posted(mods, monkeypatch, caplog):
    """⛔ 20 minutes is an HONESTY limit, not a retry budget. The board is
    captioned "since the open" and stamped with its own coverage time, so a
    modestly late post is still true; an hour-late one is a different board
    wearing an old slot's label. The slot must cost a log line, never a lie."""
    _, _, digest = mods
    import logging
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    posts = []
    with caplog.at_level(logging.WARNING):
        out = digest.catch_up(now=_at(17, 25),      # 70m after 16:15
                              render_fn=lambda w: None,
                              post_fn=lambda **k: posts.append(k) or True)
    assert out["posted"] is False
    assert posts == []
    assert "16:15" in caplog.text and "MISSED" in caplog.text
    assert "2026-09-01 16:15" in digest.missed_keys()


def test_a_slot_written_off_is_not_re_warned_every_minute(mods, monkeypatch, caplog):
    """CONTROL on the warning: one that fires 60 times an hour is one nobody
    reads, and it would bury the checkpoint that actually needs attention."""
    _, _, digest = mods
    import logging
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    digest.catch_up(now=_at(17, 25), render_fn=lambda w: None, post_fn=lambda **k: True)
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        digest.catch_up(now=_at(17, 26), render_fn=lambda w: None, post_fn=lambda **k: True)
    assert "MISSED" not in caplog.text


def test_nothing_is_caught_up_before_the_first_slot(mods, monkeypatch):
    """CONTROL. Without it, a catch-up that posted unconditionally would pass
    every test above."""
    store, _, digest = mods
    _seed(store, hour=9, minute=35)   # a board IS available; only the clock says no
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    posts = []
    out = digest.catch_up(now=_at(9, 45), render_fn=lambda w: None,
                          post_fn=lambda **k: posts.append(k) or True)
    assert out["posted"] is False and posts == []


def test_the_weekend_is_never_caught_up(mods, monkeypatch):
    """The cron is mon-fri, so a Saturday catch-up would post a board no
    schedule would ever have produced. 2026-09-05 is a Saturday."""
    store, _, digest = mods
    _seed(store, day=5, hour=9, minute=45)  # a full board; only the DAY says no
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    sat = int(dt.datetime(2026, 9, 5, 16, 25, tzinfo=ET).timestamp())
    assert dt.datetime.fromtimestamp(sat, ET).weekday() == 5, "fixture must be a Saturday"
    posts = []
    out = digest.catch_up(now=sat, render_fn=lambda w: None,
                          post_fn=lambda **k: posts.append(k) or True)
    assert out["posted"] is False and posts == []


def test_a_disarmed_digest_catches_nothing_up_and_stays_quiet(mods, monkeypatch, caplog):
    """Not posting is the easy half -- run_digest refuses a disarmed post on its
    own. The half that needs its own guard is SILENCE: without the check in
    catch_up, a feature nobody turned on would still walk the day's slots,
    write them off as MISSED and warn about each one. A disarmed feature must
    leave no state and no log behind."""
    import logging
    store, _, digest = mods
    _seed(store)                     # a board IS available; only the flag says no
    monkeypatch.delenv("BUZZ_DIGEST_ENABLED", raising=False)
    posts = []
    with caplog.at_level(logging.WARNING):
        out = digest.catch_up(now=_at(17, 25), render_fn=lambda w: None,
                              post_fn=lambda **k: posts.append(k) or True)
    assert out["posted"] is False and posts == []
    assert "MISSED" not in caplog.text
    assert digest.missed_keys() == set(), "a disarmed digest must not write state"


def test_the_state_writer_merges_rather_than_replacing(mods, monkeypatch):
    """⛔ It used to write {"posted": [...]} wholesale. The day a second key was
    added, the first write of the day would have deleted it silently -- a
    projection dropping what it does not name. Both keys must survive each
    other's writes."""
    _, _, digest = mods
    digest.mark_missed("2026-09-01 10:00")
    digest.mark_posted("2026-09-01 10:30")
    assert digest.missed_keys() == {"2026-09-01 10:00"}
    assert "2026-09-01 10:30" in digest.posted_keys()


def test_catch_up_is_actually_called_by_the_poll_job():
    """⛔ THE WIRE, NOT THE FUNCTION. This repo's signature defect is a correct
    routine that no scheduler ever calls -- the Desk insights pass sat
    "written, documented as scheduled, wired into no scheduler" for weeks, and
    the buzz catch-up is worth exactly nothing if `_buzz_poll` does not run it.
    Derived by AST from api/main.py rather than grepped, so a renamed call or a
    commented-out line cannot pass."""
    import ast
    import pathlib as _p
    tree = ast.parse(_p.Path("api/main.py").read_text(encoding="utf-8"))
    poll = next((n for n in ast.walk(tree)
                 if isinstance(n, ast.FunctionDef) and n.name == "_buzz_poll"), None)
    assert poll is not None, "api/main.py no longer defines _buzz_poll"
    called = {n.func.attr for n in ast.walk(poll)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "catch_up" in called, "_buzz_poll does not call catch_up -- a missed slot is silent again"
    # NON-VACUITY: the probe can see a sibling it is not looking for, so a
    # walker that returned everything (or nothing) cannot pass by accident.
    assert "poll_once" in called
