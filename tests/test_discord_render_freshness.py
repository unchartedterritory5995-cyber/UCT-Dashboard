"""The market clock and the freshness envelope (step 2.4b, 03 §3.8).

Boundaries are the whole point, so they are tested to the second: 09:29:50 → 09:30:10 ET,
16:00 ET, a holiday, and a weekend. A clock that is right at 11:00 and wrong at the open is a clock
that fires every alert on the one minute the desk is watching.
"""
from __future__ import annotations

import datetime as dt

import pytest

from api.services.discord_render import freshness as fr

ET = fr.ET


def at(y, m, d, hh=0, mm=0, ss=0) -> dt.datetime:
    return dt.datetime(y, m, d, hh, mm, ss, tzinfo=ET)


# ── the clock ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("when,expected", [
    (at(2026, 9, 14, 3, 59, 59), fr.OVERNIGHT),   # Monday, before the first pre-market print
    (at(2026, 9, 14, 4, 0, 0), fr.PRE),
    (at(2026, 9, 14, 9, 29, 50), fr.PRE),         # ⛔ ten seconds before the open
    (at(2026, 9, 14, 9, 29, 59), fr.PRE),
    (at(2026, 9, 14, 9, 30, 0), fr.RTH),          # ⛔ the open itself
    (at(2026, 9, 14, 9, 30, 10), fr.RTH),
    (at(2026, 9, 14, 15, 59, 59), fr.RTH),
    (at(2026, 9, 14, 16, 0, 0), fr.POST),         # ⛔ the close itself is already POST
    (at(2026, 9, 14, 19, 59, 59), fr.POST),
    (at(2026, 9, 14, 20, 0, 0), fr.OVERNIGHT),
    (at(2026, 9, 14, 23, 59, 59), fr.OVERNIGHT),
])
def test_the_session_boundaries_are_exact(when, expected):
    assert fr.session_state(when) == expected


@pytest.mark.parametrize("when", [
    at(2026, 9, 12, 11, 0),    # Saturday
    at(2026, 9, 13, 11, 0),    # Sunday
])
def test_the_weekend_is_the_weekend_even_during_market_hours(when):
    assert fr.session_state(when) == fr.WEEKEND


def test_a_holiday_beats_the_clock():
    """2026-11-26 is Thanksgiving — a Thursday. 10:00 on that day is NOT rth."""
    assert at(2026, 11, 26).weekday() == 3, "control: the fixture is a weekday"
    assert fr.session_state(at(2026, 11, 26, 10, 0)) == fr.HOLIDAY
    assert fr.session_state(at(2026, 11, 26, 6, 0)) == fr.HOLIDAY
    # The day after is an ordinary (half) session — half days are NOT closures.
    assert fr.session_state(at(2026, 11, 27, 10, 0)) == fr.RTH


def test_the_holiday_list_is_the_one_in_bars_fetch():
    """⛔ Imported, never copied: a second table drifts the first time one is refreshed."""
    from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
    assert fr.is_holiday(dt.date(2026, 12, 25)) is True
    assert fr.is_holiday(dt.date(2026, 12, 24)) is False
    assert 20261225 in _NYSE_HOLIDAYS_YYYYMMDD
    src = open(fr.__file__, encoding="utf-8").read()
    assert "_NYSE_HOLIDAYS_YYYYMMDD" in src and "20261225" not in src, (
        "the closure list has been copied into freshness.py — import it instead")


def test_is_open_agrees_with_the_state():
    assert fr.is_open(at(2026, 9, 14, 10, 0)) is True
    for when in (at(2026, 9, 14, 9, 29, 59), at(2026, 9, 14, 16, 0), at(2026, 9, 13, 10, 0)):
        assert fr.is_open(when) is False


# ── budgets ─────────────────────────────────────────────────────────────────

def test_the_intraday_budget_is_two_bar_intervals_in_rth():
    assert fr.budget_s("5", fr.RTH) == 600
    assert fr.budget_s("60", fr.RTH) == 7200


def test_outside_rth_intraday_there_is_no_age_budget_at_all():
    """⛔ `None`, not a big number: the session rule decides there, and inventing an age budget
    would be a fiction two readers would disagree about."""
    for state in (fr.WEEKEND, fr.HOLIDAY, fr.OVERNIGHT, fr.PRE, fr.POST):
        assert fr.budget_s("5", state) is None, state
    assert fr.budget_s("D", fr.RTH) is None, "a daily bar forms all session; the session rule owns it"


def test_the_expected_session_is_the_last_completed_one():
    # Monday pre-open and the weekend before it all expect FRIDAY.
    for when in (at(2026, 9, 12, 12, 0), at(2026, 9, 13, 22, 0),
                 at(2026, 9, 14, 2, 0), at(2026, 9, 14, 9, 0)):
        assert fr.expected_session_date(when) == dt.date(2026, 9, 11), when
    # Once the session opens (and after its close), today is expected.
    for when in (at(2026, 9, 14, 9, 30), at(2026, 9, 14, 17, 0), at(2026, 9, 14, 22, 0)):
        assert fr.expected_session_date(when) == dt.date(2026, 9, 14), when
    # A holiday expects the trading day before it: 2026-11-26 is Thanksgiving (Thursday).
    assert fr.expected_session_date(at(2026, 11, 26, 10, 0)) == dt.date(2026, 11, 25)


# ── the envelope ────────────────────────────────────────────────────────────

def test_a_fresh_intraday_bar_in_rth_is_not_stale():
    now = at(2026, 9, 14, 11, 0)
    env = fr.envelope(now - dt.timedelta(minutes=4), tf="5", provider="bars-sqlite", now=now)
    assert env.stale is False and env.session_state == fr.RTH
    assert env.provider == "bars-sqlite" and env.age_s == pytest.approx(240, abs=1)
    assert env.badge is None


def test_a_late_intraday_bar_in_rth_is_stale_and_the_badge_says_when():
    now = at(2026, 9, 14, 11, 0)
    env = fr.envelope(now - dt.timedelta(minutes=25), tf="5", now=now)
    assert env.stale is True
    assert env.badge == "⚠ data as of 2026-09-14 10:35 ET (stale)"


def test_the_same_bars_are_fine_early_and_stale_late_the_same_day():
    """⛔ Stale is a verdict about the SESSION, not a fixed age: yesterday's close is the last
    completed session at 09:00 and a missing session at 15:00."""
    friday_close = at(2026, 9, 11, 16, 0)
    early = fr.envelope(friday_close, tf="D", now=at(2026, 9, 14, 9, 0))
    late = fr.envelope(friday_close, tf="D", now=at(2026, 9, 14, 15, 0))
    assert early.stale is False and early.expected_session == "2026-09-11"
    assert late.stale is True and late.expected_session == "2026-09-14"
    assert early.rule == late.rule == fr.SESSION


def test_nothing_is_stale_overnight_or_at_the_weekend():
    """A badge that shows all weekend is a badge everyone learns to ignore."""
    friday_close = at(2026, 9, 11, 16, 0)
    for when in (at(2026, 9, 12, 12, 0), at(2026, 9, 13, 22, 0), at(2026, 9, 14, 2, 0)):
        assert fr.envelope(friday_close, tf="5", now=when).stale is False, when


def test_unknown_vintage_is_not_fresh():
    """⛔ `stale=None` means unknown. A caller that renders None as "fine" is the bug this guards."""
    env = fr.envelope(None, tf="D", now=at(2026, 9, 14, 11, 0))
    assert env.stale is None and env.as_of_utc is None and env.age_s is None
    assert env.badge is None
    assert env.stale is not False, "unknown must not equal fresh"


@pytest.mark.parametrize("raw", [
    1789000000, 1789000000.0, 1789000000000,          # epoch s, float, ms
    "2026-09-14T13:00:00Z", "2026-09-14 09:00:00-0400", "2026-09-14",
    dt.datetime(2026, 9, 14, 9, 0, tzinfo=ET),
])
def test_every_vintage_shape_the_bars_layer_carries_is_understood(raw):
    env = fr.envelope(raw, tf="D", now=at(2026, 9, 14, 15, 0))
    assert env.as_of_utc is not None and env.age_s is not None, raw


def test_an_unparseable_vintage_is_unknown_rather_than_a_crash():
    for junk in ("not-a-date", {}, [], "??"):
        assert fr.envelope(junk, tf="D", now=at(2026, 9, 14, 11, 0)).stale is None


def test_a_future_bar_is_not_stale_and_keeps_a_negative_age():
    """A provider clock ahead of ours must not read as stale; the negative age is kept so the
    caller can log it rather than having it quietly normalised away.

    ⛔ The offset must EXCEED the budget, or an `abs(age) > budget` bug survives the test: at 5
    minutes ahead with a 10-minute budget both the right and the wrong answer are "not stale"
    (a mutation proved exactly that)."""
    now = at(2026, 9, 14, 11, 0)
    assert fr.budget_s("5", fr.RTH) == 600
    env = fr.envelope(now + dt.timedelta(minutes=30), tf="5", now=now)      # 1800 s ahead > 600 s
    assert env.stale is False and env.age_s == pytest.approx(-1800, abs=1)


def test_the_envelope_carries_every_field_the_spec_names():
    env = fr.envelope(at(2026, 9, 14, 10, 55), tf="5", provider="massive", now=at(2026, 9, 14, 11, 0))
    assert set(env.as_dict()) == {"as_of_utc", "as_of_et", "provider", "session_state",
                                  "age_s", "budget_s", "stale", "rule", "expected_session"}
    assert env.rule == fr.AGE and env.budget_s == 600


def test_the_stamp_is_the_vintage_not_the_wall_clock():
    """§3.10 determinism: the same closed-market input renders the same stamp at any wall time."""
    bar = at(2026, 9, 11, 16, 0)
    a = fr.envelope(bar, tf="D", now=at(2026, 9, 13, 12, 0))
    b = fr.envelope(bar, tf="D", now=at(2026, 9, 13, 20, 30))
    assert a.as_of_utc == b.as_of_utc and a.as_of_et == b.as_of_et
