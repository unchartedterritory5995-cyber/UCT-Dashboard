# tests/test_buzz_digest.py
"""Buzz image + digest: blank guard, disarmed default, one post per day, lock."""
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
