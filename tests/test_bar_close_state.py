"""⭐⭐ IS THE NEWEST BAR STILL FORMING — the one value that crosses the JS seam.

``indicator_compute.bar_close_state`` reduces (bars, tf, now, the two NYSE sets)
to ``True`` / ``False`` / ``None``, and that tri-state is the ONLY thing the
browser is handed. This file owns the clock-and-calendar half of barstate;
``app/src/components/chart/engine/ast/barstate.test.js`` owns the rendering half.

⛔⛔ THE SPLIT IS THE POINT, NOT A FILING CONVENIENCE. The calendar is read here
and only here, because a second copy of the NYSE dates in a second language is
the defect the whole seam exists to prevent. A JS test that walked the calendar
could only be written by putting one there.

⚰️ THIS FILE REPLACES THE CALENDAR HALF OF A JS SUITE that called
``computeClock(bars, tf, now, holidays)``. That seam was retired by owner ruling
(2026-09-09). Every property it asserted is still asserted — on the side that
owns it — and one of them is asserted the other way round now; see
``test_an_EARLY_CLOSE_is_known_now``.
"""
import pytest

from api.services.indicator_compute import bar_close_state, scheduled_close_seconds
from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
from api.services.liveflow_monitor import _NYSE_EARLY_CLOSES_YYYYMMDD

DAY = 86400
FIVE = 300


def _bars(n, start, step):
    return [{"t": start + i * step, "o": 1.0, "h": 1.0, "l": 1.0,
             "c": 1.0, "v": 1.0} for i in range(n)]


def intraday(n, start=1757331000):
    """5-minute bars from 2026-09-08 09:30 ET (13:30 UTC)."""
    return _bars(n, start, FIVE)


def daily(n, start=1757304000):
    """Daily bars stamped at ET midnight, from 2026-09-08."""
    return _bars(n, start, DAY)


def state(bars, tf, now, holidays=None, early=None):
    return bar_close_state(bars, tf, now,
                           _NYSE_HOLIDAYS_YYYYMMDD if holidays is None else holidays,
                           _NYSE_EARLY_CLOSES_YYYYMMDD if early is None else early)


# ─── the three states ────────────────────────────────────────────────────────

def test_the_three_states_are_all_reachable():
    """⛔ NON-VACUITY FIRST. A helper that could only ever answer one way would
    satisfy every other test in this file."""
    bars = intraday(4)
    newest = bars[-1]["t"]
    assert state(bars, "5", newest + 10) is True
    assert state(bars, "5", newest + FIVE + 1) is False
    assert state(bars, "5", None) is None


@pytest.mark.parametrize("why,args", [
    ("no bars", ([], "5", 1757331000)),
    ("no timeframe", (intraday(2), None, 1757331000)),
    ("unknown timeframe", (intraday(2), "7", 1757331000)),
    ("no now", (intraday(2), "5", None)),
    ("now is a bool", (intraday(2), "5", True)),
    ("now below the instant floor", (intraday(2), "5", 1.0)),
])
def test_it_answers_None_rather_than_guessing(why, args):
    """⛔ ``None`` IS AN ANSWER, NOT A FAILURE. Saying "not forming" instead would
    hand the column layer a confident ``isconfirmed = 1`` on a bar that may still
    be open — a wrong answer wearing a right one's clothes."""
    assert bar_close_state(*args) is None, why


# ─── intraday: exact, and no calendar at all ─────────────────────────────────

def test_an_intraday_bar_ends_span_seconds_after_it_starts():
    bars = intraday(3)
    newest = bars[-1]["t"]
    assert state(bars, "5", newest + 10) is True
    assert state(bars, "5", newest + FIVE + 1) is False


def test_a_PRE_MARKET_bar_is_no_different():
    """⚠️ OUR FETCH CAN CONTAIN THESE, MEASURED NOT ASSUMED.
    ``bars_fetch._fetch_intraday_yfinance`` asks ``prepost=True`` and the
    serve-time filter keeps the prints, so "the regular session was open" is not
    a precondition this may rely on. 2026-09-08 08:00 ET = 12:00 UTC."""
    pre = intraday(3, start=1757325600)
    newest = pre[-1]["t"]
    assert state(pre, "5", newest + 10) is True
    assert state(pre, "5", newest + FIVE + 1) is False


def test_an_INTRADAY_bar_needs_no_calendar__the_control():
    """⛔ THE CONTROL. If the intraday path ever started consulting a session or a
    date set, this would begin depending on the date rather than the arithmetic.
    2025-12-26 is an NYSE closure and it must change nothing."""
    on_a_holiday = intraday(1, start=1766763000)
    assert state(on_a_holiday, "5", 1766763000 + 10) is True
    assert state(on_a_holiday, "5", 1766763000 + FIVE + 1) is False


# ─── daily and above: the session close, on the last trading day ─────────────

def test_a_DAILY_bar_ends_at_1600_new_york():
    bars = daily(3)
    newest = bars[-1]["t"]
    assert state(bars, "D", newest + 15 * 3600 + 59 * 60) is True   # 15:59 ET
    assert state(bars, "D", newest + 16 * 3600 + 60) is False       # 16:01 ET


def test_an_EARLY_CLOSE_is_known_now():
    """⭐⭐ THIS ASSERTION IS THE INVERSE OF THE ONE IT REPLACES, AND THAT IS THE
    HEADLINE.

    ⚰️ The predecessor asserted the DEFECT on purpose: it said this engine has no
    way to know about 1pm ET half-days, so the newest daily bar read
    ``isrealtime`` for three hours after trading stopped. Its own comment said
    "the day a half-day calendar lands, this goes red BY NAME and the correct
    edit is to invert it."

    ⛔ THE CALENDAR WAS ALREADY THERE. ``liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD``
    is a real frozenset with five read sites and the parity rail
    ``tests/test_nyse_calendar_parity.py``. The predecessor reasoned from
    ``bars_fetch``'s comment that half-days are "intentionally NOT" in THAT set —
    true of that set, false of the repo. Wiring it in is what closed the gap.

    2025-11-28 is the day after Thanksgiving, a 13:00 ET close, and it is in the
    set.
    """
    assert 20251128 in _NYSE_EARLY_CLOSES_YYYYMMDD
    half_day = daily(1, start=1764306000)          # 2025-11-28, ET midnight
    two_pm = 1764306000 + 14 * 3600                # 14:00 ET — an hour after 13:00
    assert state(half_day, "D", two_pm) is False, \
        "an early-close session still read as forming an hour after the close"
    # ⭐ AND THE GUARD CAN FIRE THE OTHER WAY: at noon it is genuinely still open.
    noon = 1764306000 + 12 * 3600
    assert state(half_day, "D", noon) is True
    # ⛔ CONTROL — WITHOUT the set the old wrong answer comes back, so this test
    # is measuring the wiring rather than the date.
    assert state(half_day, "D", two_pm, early=frozenset()) is True


def test_a_WEEK_ends_on_its_last_trading_day():
    """The bar is stamped at the week's START; the period ends on the last
    trading day. Good Friday 2025-04-18 closes the NYSE, so the week beginning
    2025-04-15 ended on the Thursday."""
    monday = _bars(1, 1743480000, DAY)                    # 2025-04-01 ET
    friday_afternoon = 1743480000 + 3 * DAY + 15 * 3600
    assert state(monday, "W", friday_afternoon) is True

    good_friday_week = _bars(1, 1744689600, DAY)          # 2025-04-15 ET
    thursday_evening = 1744689600 + 2 * DAY + 20 * 3600
    assert 20250418 in _NYSE_HOLIDAYS_YYYYMMDD, \
        "Good Friday 2025 is not in the closure set — this test proves nothing"
    assert state(good_friday_week, "W", thursday_evening) is False, \
        "the closure set did not walk the week back off Good Friday"
    # ⛔ CONTROL — with no closure set the week is assumed to run to the Friday.
    assert state(good_friday_week, "W", thursday_evening,
                 holidays=frozenset()) is True


# ─── the seam itself ─────────────────────────────────────────────────────────

def test_scheduled_close_is_the_only_thing_that_reads_the_calendar():
    """⭐ THE SEAM, ASSERTED. ``scheduled_close_seconds`` takes both sets as
    PARAMETERS and imports neither, so there is exactly one place either list is
    resolved and it is not this module."""
    import inspect
    sig = inspect.signature(scheduled_close_seconds)
    assert list(sig.parameters) == ["t", "tf", "holidays", "early_closes"]
    src = inspect.getsource(scheduled_close_seconds)
    assert "_NYSE_HOLIDAYS_YYYYMMDD" not in src.split('"""')[2], \
        "the closure set is imported here instead of handed in"


def test_the_tri_state_is_a_bool_or_None_and_never_a_number():
    """⛔ WHAT CROSSES THE SEAM IS A TRI-STATE, NOT AN INSTANT. A number leaking
    across would be truthy in JavaScript and silently mean "forming"."""
    bars = intraday(3)
    newest = bars[-1]["t"]
    for now in (newest + 10, newest + FIVE + 1):
        got = state(bars, "5", now)
        assert got is True or got is False, repr(got)
        assert not isinstance(got, (int, float)) or isinstance(got, bool)
