"""Off-market freshness must mean SESSION COMPLETE, not DATE MATCHES.

⚰️ Measured on production Sunday 2026-09-20 against Friday 2026-09-18 (post-market
ran to 19:55): PLTR 5m ended 15:15 · AEHR 5m 13:20 · CELH 5m 10:10 · BATRK 5m 09:50
and 60m 10:00. Five of nine sampled symbols served a truncated session 55 hours
later, each reporting `newest_bar_is_forming: false`.

⭐ The cooldown is as load-bearing as the predicate: without it a genuinely thin
symbol re-fires a delta every prewarm cycle forever (the Memorial-Day-2026
saturation class the off-market shortcut was written to prevent), so it is railed
here beside the fix rather than left as a comment.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch as bf

ET = ZoneInfo("America/New_York")
FRIDAY = (2026, 9, 18)          # a normal full session in the measured week


def ts(h, m, day=FRIDAY):
    return int(datetime(day[0], day[1], day[2], h, m, tzinfo=ET).timestamp())


@pytest.fixture(autouse=True)
def _clear_attempts():
    bf._completeness_attempt.clear()
    yield
    bf._completeness_attempt.clear()


# ── the predicate ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tf,h,m", [
    ("5", 15, 15),    # PLTR, measured
    ("5", 13, 20),    # AEHR, measured
    ("5", 10, 10),    # CELH, measured
    ("5", 9, 50),     # BATRK, measured
    ("60", 10, 0),    # BATRK 60m, measured
])
def test_the_measured_truncated_tails_are_incomplete(tf, h, m):
    assert bf.intraday_session_complete(tf, ts(h, m)) is False


@pytest.mark.parametrize("tf,h,m", [
    ("5", 15, 55),    # the last RTH 5m bucket
    ("5", 19, 55),    # a post-market tail is complete by construction
    ("60", 15, 0),    # the last session-anchored hourly bucket
    ("1", 15, 59),
    ("30", 15, 30),
    ("15", 15, 45),
])
def test_a_tail_that_reaches_its_close_is_complete(tf, h, m):
    assert bf.intraday_session_complete(tf, ts(h, m)) is True


def test_an_early_close_shortens_the_bar_it_must_reach():
    """⭐ Reads the EXISTING NYSE calendar. On a 13:00 half day a 12:55 5m tail is
    complete; the same clock time on a full day is not."""
    from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    early = sorted(NYSE_EARLY_CLOSES_YYYYMMDD)
    assert early, "calendar carries no early closes — this test would be vacuous"
    y, mo, d = int(str(early[-1])[:4]), int(str(early[-1])[4:6]), int(str(early[-1])[6:])
    assert bf.intraday_session_complete("5", ts(12, 55, (y, mo, d))) is True
    assert bf.intraday_session_complete("5", ts(12, 55, FRIDAY)) is False


def test_daily_and_unparseable_abstain_rather_than_force_a_refetch():
    assert bf.intraday_session_complete("D", ts(10, 0)) is True
    assert bf.intraday_session_complete("5", None) is True
    assert bf.intraday_session_complete("5", "not-a-number") is True


# ── the wiring into _needs_fresh ─────────────────────────────────────────────

def _off_market_sunday(monkeypatch):
    """Freeze the clock to the Sunday the truncation was measured on."""
    monkeypatch.setattr(bf, "_is_market_open", lambda: False)
    real = bf.datetime

    class _DT(real):
        @classmethod
        def now(cls, tz=None):
            return real(2026, 9, 20, 21, 0, tzinfo=ET) if tz else real(2026, 9, 20, 21, 0)
    monkeypatch.setattr(bf, "datetime", _DT)


def test_a_truncated_tail_now_needs_fresh_off_market(monkeypatch):
    _off_market_sunday(monkeypatch)
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is True


def test_a_complete_tail_is_still_left_alone_off_market(monkeypatch):
    """The off-market shortcut must keep doing its job — this is the regression
    guard on the Memorial-Day fix, not just on the new behaviour."""
    _off_market_sunday(monkeypatch)
    assert bf._needs_fresh(ts(19, 55), "5", "AAPL") is False


def test_omitting_the_ticker_keeps_the_old_behaviour_exactly(monkeypatch):
    """Callers that never opted in (alert_bars_freshness, the tests above it) must
    be byte-identical, which is what makes this change safe to land."""
    _off_market_sunday(monkeypatch)
    assert bf._needs_fresh(ts(10, 10), "5") is False


def test_the_escalation_fires_once_per_tail_then_backs_off(monkeypatch):
    _off_market_sunday(monkeypatch)
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is True
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is False, "no cooldown → saturation"
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is False


def test_a_tail_that_actually_advanced_heals_immediately(monkeypatch):
    """The cooldown keys on the tail INSTANT, so progress is never throttled."""
    _off_market_sunday(monkeypatch)
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is True
    assert bf._needs_fresh(ts(12, 30), "5", "CELH") is True


def test_the_flag_reverts_it_without_a_deploy(monkeypatch):
    _off_market_sunday(monkeypatch)
    monkeypatch.setenv("BARS_SESSION_COMPLETENESS", "0")
    assert bf._needs_fresh(ts(10, 10), "5", "CELH") is False


def test_the_attempt_map_is_bounded(monkeypatch):
    monkeypatch.setattr(bf, "_COMPLETENESS_MAX_KEYS", 10)
    for i in range(40):
        bf._completeness_heal_allowed(f"SYM{i}", "5", 1_700_000_000)
    assert len(bf._completeness_attempt) <= 10
