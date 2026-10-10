"""TERM-018: the /buzz missed-checkpoint page, observed red-before-green (G-24).

`discord_buzz_digest.catch_up` rides the 60 s ingest poll. A checkpoint the scheduler
never fired is posted late while it is still inside the 20-minute honesty window;
past it the slot is recorded as missed and `_alert_missed` raises a `critical` on the
chart-health channel, the only severity that pages Discord.

These rails drive the REAL `catch_up` with only the clock, the renderer, the poster
and the sink replaced, on both sides of the window, so a page demoted to a warning
and a page raised for an honest catch-up both go red.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services import chart_health_alerts

ET = dt.timezone(dt.timedelta(hours=-4))


@pytest.fixture
def pages(monkeypatch):
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None: seen.append((key, sev)) or True)
    return seen


@pytest.fixture
def buzz(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_STATE_PATH", str(tmp_path / "buzz_state.json"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_CHANNEL", "123")
    monkeypatch.delenv("BUZZ_DIGEST_TIMES", raising=False)
    from api.services import buzz_store, discord_buzz_digest
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return discord_buzz_digest


def _at(h, m, day=1):
    return int(dt.datetime(2026, 9, day, h, m, tzinfo=ET).timestamp())    # 2026-09-01 is a Tuesday


def test_buzz_a_checkpoint_missed_past_the_window_pages_critical(buzz, pages):
    posts: list[dict] = []
    out = buzz.catch_up(now=_at(10, 25),        # 25m after 10:00, 10:30 not due yet
                        render_fn=lambda w, **k: None,
                        post_fn=lambda **k: posts.append(k) or True)
    assert out["posted"] is False
    assert posts == []
    assert pages == [("buzz_slot_missed:10:00", "critical")], pages


def test_buzz_a_written_off_checkpoint_pages_once(buzz, pages):
    kw = dict(render_fn=lambda w, **k: None, post_fn=lambda **k: True)
    buzz.catch_up(now=_at(10, 25), **kw)
    buzz.catch_up(now=_at(10, 26), **kw)
    assert pages == [("buzz_slot_missed:10:00", "critical")]


def test_buzz_CONTROL_a_checkpoint_inside_the_window_never_pages(buzz, pages):
    out = buzz.catch_up(now=_at(10, 10), render_fn=lambda w, **k: None,
                        post_fn=lambda **k: True)
    assert "past the catch-up window" not in str(out.get("reason")), out
    assert pages == []


def test_buzz_CONTROL_before_the_first_checkpoint_nothing_pages(buzz, pages):
    buzz.catch_up(now=_at(9, 45), render_fn=lambda w, **k: None, post_fn=lambda **k: True)
    assert pages == []
