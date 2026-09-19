"""⭐⭐ THE LIVE WINDOW READS THE WHOLE NYSE CALENDAR — closures AND half-days.

⛔ THE FAILURE THIS PINS IS A SWEEP THAT KEEPS FIRING AFTER THE EXCHANGE WENT
HOME. `_live_session_state` gated on `open <= now < open + REGULAR_SESSION_LENGTH`
— a FIXED 6h30m — and its trading-day test was `bars_fetch._is_nyse_holiday`,
FULL CLOSURES ONLY, whose own docstring says 1pm ET half-days are "intentionally
NOT included". So on a half-day the window ran to 16:00: three hours of live
cycles sweeping a universe whose newest bar the exchange had already settled, and
filing a receipt for each one.

⚰️⚰️ THE REPO ALREADY KNEW, IN THE ADJACENT SEAM. `bar_close_state` was wired to
BOTH sets (`tests/test_scan_sweep_bar_close_state.py`) precisely so the tri-state
would read CLOSED at 14:00 on a half-day — while the window that decided whether
to evaluate anything at all said the session was open. **Two answers to one
question, one of them right, and the cycle was on the wrong side.** Fixing the
bar's answer and leaving the window's is `lesson_a_second_authority_over_one_value`
with the two authorities four hundred lines apart in the same file.

⭐ SO THE DISCRIMINATOR IS THE POINT OF THIS FILE, NOT THE HALF-DAY CASE. "Closed
at 14:00 on 2025-11-28" is satisfied by a function that says closed always; only
the ORDINARY day at the SAME clock time proves the fix is reading the calendar
rather than shortening every session. Both are here, and each one's date is
asserted against the frozenset it depends on, inside the test — a calendar that
moves must fail loudly rather than quietly turn a rail vacuous
(`lesson_an_arming_condition_that_names_a_test_expires`).
"""
from __future__ import annotations

import ast as pyast
import datetime
import pathlib

import pytest

from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD,
    NYSE_HOLIDAYS_YYYYMMDD,
)
from api.services.screener import scan_evaluator

ET = scan_evaluator._ET
MODULE_PATH = pathlib.Path(scan_evaluator.__file__)

#: 2025-11-28 — the day after Thanksgiving, a real 1pm ET close, in the set.
HALF_DAY = datetime.date(2025, 11, 28)
#: 2025-12-01 — an ordinary Monday in neither set. The control's whole job.
ORDINARY = datetime.date(2025, 12, 1)
#: 2025-12-25 — Christmas, a full closure, and a WEEKDAY on purpose: a closure
#: that fell on a Saturday would pass through the weekend branch and prove
#: nothing about the holiday table.
CLOSURE = datetime.date(2025, 12, 25)
#: 2025-11-29 — a Saturday.
WEEKEND = datetime.date(2025, 11, 29)


def _ymd(day: datetime.date) -> int:
    return int(day.strftime("%Y%m%d"))


def _at(day: datetime.date, hour: int, minute: int = 0) -> datetime.datetime:
    return datetime.datetime(day.year, day.month, day.day, hour, minute, tzinfo=ET)


# ═══ the fixture dates are what this file claims they are ════════════════════

def test_every_date_this_file_uses_IS_STILL_the_kind_of_day_it_names():
    """⛔ THE CALENDAR IS DATA AND DATA MOVES. Every assertion below reads its
    date's membership FIRST, but a single place that states all four is what makes
    a refreshed 2027 table fail with the reason rather than with four confusing
    window answers."""
    assert _ymd(HALF_DAY) in NYSE_EARLY_CLOSES_YYYYMMDD, (
        f"{HALF_DAY} left NYSE_EARLY_CLOSES_YYYYMMDD — the discriminator below "
        "proves nothing without it")
    assert _ymd(HALF_DAY) not in NYSE_HOLIDAYS_YYYYMMDD, (
        "the half-day is being treated as a full closure — a half-day is a REAL "
        "session and the two sets must never be unioned")
    assert _ymd(ORDINARY) not in NYSE_EARLY_CLOSES_YYYYMMDD
    assert _ymd(ORDINARY) not in NYSE_HOLIDAYS_YYYYMMDD, (
        f"{ORDINARY} is no longer an ordinary trading day — the control that makes "
        "the half-day case non-vacuous has stopped being a control")
    assert _ymd(CLOSURE) in NYSE_HOLIDAYS_YYYYMMDD
    assert _ymd(CLOSURE) not in NYSE_EARLY_CLOSES_YYYYMMDD
    assert CLOSURE.weekday() < 5, (
        f"{CLOSURE} is a weekend now — the closure case would pass through the "
        "weekday branch and say nothing about the holiday table")
    assert WEEKEND.weekday() >= 5


# ═══ the five cases ══════════════════════════════════════════════════════════

def test_the_HALF_DAY_window_is_CLOSED_at_1400_ET():
    """⛔⛔ THE DISCRIMINATOR. 14:00 ET on a 1pm ET half-day. The old gate had two
    more hours to run here and kept starting definitions over a universe whose
    newest bar the exchange settled at 13:00."""
    assert scan_evaluator._live_session_state(_at(HALF_DAY, 14)) == "closed", (
        "the live window is still open at 14:00 ET on a 1pm ET half-day — the "
        "sweep is evaluating a session the exchange closed an hour ago, and "
        "`bar_close_state` already reads that same bar as CLOSED")


def test_an_ORDINARY_day_is_OPEN_at_the_SAME_1400_ET__the_control():
    """⭐⭐ WITHOUT THIS, the test above passes for a function that answers
    "closed" always, or for one that shortened EVERY session to 3h30m. Same clock
    time, same shape, a day in neither set — and the answer must DIFFER."""
    assert scan_evaluator._live_session_state(_at(ORDINARY, 14)) is None, (
        "an ordinary trading day is closed at 14:00 ET — the early-close length is "
        "being applied to days that are not in the early-close set, which stops "
        "the live sweep for the last three hours of every normal session")


def test_the_SAME_HALF_DAY_is_OPEN_at_NOON__the_window_SHORTENED_not_VANISHED():
    """⭐ A HALF-DAY IS A REAL SESSION. Answering "closed" all day would be the
    opposite error and just as silent: the cycle would skip a morning that trades,
    and `closed` is a recorded, unalarming receipt."""
    assert scan_evaluator._live_session_state(_at(HALF_DAY, 12)) is None, (
        "the live window is closed at noon on a half-day — the early-close date is "
        "being treated as a full closure and a real trading morning is being skipped")


def test_a_FULL_CLOSURE_is_CLOSED_at_MIDDAY():
    """⛔ NO SESSION AT ALL, on a WEEKDAY. `market_open_et` still answers 09:30 on
    Christmas — it is the clock-time open, not a session test — so the closure
    table is the only thing standing between the sweep and a day with no bars."""
    assert scan_evaluator._live_session_state(_at(CLOSURE, 12)) == "closed", (
        f"the live window is open at midday on {CLOSURE}, a full NYSE closure — "
        "the sweep would evaluate a day the exchange never opened")


def test_a_WEEKEND_is_CLOSED():
    """⭐ THE CHEAPEST CONTROL, AND THE ONE THAT CANNOT BE FIXED BY A CALENDAR
    TABLE. Saturday is in neither frozenset; if the weekday branch ever goes, the
    two set lookups would both miss and the window would open."""
    assert scan_evaluator._live_session_state(_at(WEEKEND, 12)) == "closed"


# ═══ the boundary, and where the boundary comes from ═════════════════════════

@pytest.mark.parametrize("hour, minute, state", [
    (12, 59, None),        # one minute before the early close: INSIDE
    (13, 0, "closed"),     # the early close itself: OUTSIDE
])
def test_the_half_day_close_is_HALF_OPEN_like_the_regular_one(hour, minute, state):
    """⚠️ `open <= now < close`, and the shortened end inherits it. A cycle firing
    AT 13:00 would read a bar the exchange had just settled and file it as live —
    the same reason the 16:00 end is exclusive."""
    assert scan_evaluator._live_session_state(_at(HALF_DAY, hour, minute)) == state


def test_the_13_00_CLOSE_is_DERIVED_from_the_stores_own_open__never_typed():
    """⛔ ONE AUTHORITY OVER THE OPEN. The half-day close is stated as a LENGTH
    from `market_open_et` — the bars store's own session anchor — exactly as the
    regular one is. A typed 13:00 beside a derived 09:30 is the second-authority
    shape that has already cost this repo three outages."""
    opened = scan_evaluator.market_open_et(HALF_DAY)
    assert (opened.hour, opened.minute) == (9, 30)
    closes = opened + scan_evaluator.EARLY_CLOSE_SESSION_LENGTH
    assert (closes.hour, closes.minute) == (13, 0), (
        f"the half-day session ends at {closes:%H:%M} ET, not 13:00")
    assert (scan_evaluator.REGULAR_SESSION_LENGTH
            - scan_evaluator.EARLY_CLOSE_SESSION_LENGTH
            == datetime.timedelta(hours=3)), (
        "a half-day is no longer three hours shorter than a regular session")


def test_the_CALENDAR_QUESTION_HAS_ONE_OWNER_and_it_types_no_boundary__BY_AST():
    """⛔ THE STRUCTURAL HALF. "Is there a session" and "how long is it" are one
    question, and the defect was answering them in two places — gated on closures,
    then adding a fixed length regardless. `_session_length_et` is now the single
    owner, so the "derive it, never type it" rail that guarded `_live_session_state`
    has to follow the derivation rather than stay pointed at the caller."""
    src = MODULE_PATH.read_text(encoding="utf-8")
    tree = pyast.parse(src)
    fns = {n.name: n for n in pyast.walk(tree) if isinstance(n, pyast.FunctionDef)}
    owner = fns.get("_session_length_et")
    assert owner is not None, "_session_length_et is gone — who owns the calendar now?"

    literals = {n.value for n in pyast.walk(owner)
                if isinstance(n, pyast.Constant) and isinstance(n.value, int)}
    assert not ({9, 13, 16, 930, 1300, 1600} & literals), (
        f"_session_length_et types a session boundary ({sorted(literals)}) — every "
        "end of every session in this module is a LENGTH from the derived open")

    # ⭐ THE CONTROL. The probe above is an absence, and an absence over a function
    # that reads no sets at all would be green and worthless. Both frozensets must
    # actually be consulted here, by name.
    names = {n.id for n in pyast.walk(owner) if isinstance(n, pyast.Name)}
    assert {"NYSE_HOLIDAYS_YYYYMMDD", "NYSE_EARLY_CLOSES_YYYYMMDD"} <= names, (
        f"_session_length_et no longer reads both NYSE tables: {sorted(names)}")

    # ⛔ AND THE CALLER MUST NOT HAVE GROWN ITS OWN COPY BACK.
    caller = fns["_live_session_state"]
    caller_names = {n.id for n in pyast.walk(caller) if isinstance(n, pyast.Name)}
    assert not ({"NYSE_HOLIDAYS_YYYYMMDD", "NYSE_EARLY_CLOSES_YYYYMMDD"}
                & caller_names), (
        "_live_session_state reads the NYSE tables directly again — that is the "
        "second authority this consolidation removed")
    assert "_session_length_et" in caller_names, (
        "_live_session_state stopped asking the owner how long the day is")

    # ⛔ THE SETS COME FROM THE LEAF. `api.services.nyse_calendar` imports NOTHING;
    # reaching them through `bars_fetch` drags fastapi, massive, the cache and a
    # thread pool in behind a session test.
    assert "from api.services.nyse_calendar import" in src, (
        "the NYSE sets are no longer read from the leaf module that owns them")


def test_session_length_et_ANSWERS_ALL_THREE_KINDS_and_they_are_DISTINCT():
    """⭐ THE OWNER, TESTED DIRECTLY. Three kinds of day, three distinct answers —
    a version that collapsed any two of them would still satisfy some of the window
    cases above while being wrong about what a day IS."""
    assert scan_evaluator._session_length_et(ORDINARY) == scan_evaluator.REGULAR_SESSION_LENGTH
    assert scan_evaluator._session_length_et(HALF_DAY) == scan_evaluator.EARLY_CLOSE_SESSION_LENGTH
    assert scan_evaluator._session_length_et(CLOSURE) is None
    assert scan_evaluator._session_length_et(WEEKEND) is None
    answers = {scan_evaluator._session_length_et(ORDINARY),
               scan_evaluator._session_length_et(HALF_DAY),
               scan_evaluator._session_length_et(CLOSURE)}
    assert len(answers) == 3, (
        f"two kinds of day answer the same thing ({answers}) — a session that "
        "trades, a session that trades a short day, and no session at all are "
        "three different facts")
