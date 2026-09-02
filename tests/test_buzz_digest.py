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


def test_armed_without_a_webhook_warns_rather_than_failing_silently(mods, monkeypatch, caplog):
    """Armed + unconfigured must be distinguishable from a quiet day. Otherwise
    a mistyped webhook produces the same silence as 'nothing to report' -- every
    day, forever."""
    _, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.delenv("BUZZ_DIGEST_WEBHOOK", raising=False)
    with caplog.at_level("WARNING"):
        out = digest.run_digest(now=1788300000)
    assert out["reason"] == "no webhook"
    assert any("BUZZ_DIGEST_WEBHOOK" in r.message for r in caplog.records)


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
