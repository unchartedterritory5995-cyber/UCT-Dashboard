"""`vendor` barstate mode, replayed against the six readings it was built from.

⭐⭐ THE POINT OF A SECOND MODE IS THAT IT CAN BE CHECKED. The vendor's barstate
was measured on a live TradingView chart across 2026-09-10 and the readings are
in `tests/fixtures/vendor/barstate-daily-timeline.json`. This file replays every
one of them through `compute_clock(..., mode="vendor")` and requires the column
values back, exactly — so "we reproduce the vendor" is a measurement rather than
a design intention.

⛔⛔ AND THE FLAG IS OFF. Nothing member-facing selects `vendor`; the default is
`calendar` and this file asserts that too. Flipping it changes every barstate
column a member can read and needs the confirmation instant MEASURED rather than
hypothesised — `nyse_calendar.EXTENDED_CLOSE_HOUR` says so at the literal.

⚠️ WHAT THIS FILE DOES *NOT* ESTABLISH: that 20:00 ET is the confirmation hour.
The timeline brackets it to (19:22, 20:55) and no row falls inside. Every row here
is reproduced by ANY hour in that bracket, which is exactly why the hour is marked
a hypothesis — this test would pass unchanged if the true hour were 19:45.
"""

import io
import json
import pathlib

import pytest

from api.services import indicator_compute as ic
from api.services import nyse_calendar

ROOT = pathlib.Path(__file__).resolve().parents[1]
TIMELINE = ROOT / "tests" / "fixtures" / "vendor" / "barstate-daily-timeline.json"

#: the four the vendor and this engine both spell
COLS = ("isrealtime", "isconfirmed", "ishistory", "islastconfirmedhistory")


def _rows():
    return json.loads(io.open(TIMELINE, encoding="utf-8").read())["rows"]


def _bars_for(row, count=3):
    """A synthetic daily series whose NEWEST bar is the one the row read."""
    newest = float(row["newestBarUnix"])
    return [{"t": newest - 86400 * (count - 1 - i), "o": 1.0, "h": 2.0,
             "l": 0.0, "c": 1.0, "v": 10.0} for i in range(count)]


def _clock_inputs(row):
    """`forming` and `confirmed` (instant A), derived from the INSTANT alone."""
    bars = _bars_for(row)
    now = float(row["session"]["scheduledCloseUnix"]) + \
        float(row["session"]["secondsPastScheduledClose"])
    forming, confirmed = ic.bar_close_state_full(bars, "D", now=now)
    return bars, forming, confirmed


def _historical_of(row):
    """Instant B, OBSERVED -- there is no clock that answers it.

    ⛔ READ OFF THE PAGE'S OWN `isrealtime`, and that is not circular. The engine
    is asked to reproduce FOUR columns from TWO axes, and this supplies one axis;
    it would be circular only if the derivation then echoed it straight back.
    `ishistory` and `islastconfirmedhistory` are checked too, and both are DERIVED
    from this axis and the bar's position rather than restated -- which is what
    makes the replay a test and not a mirror.
    """
    return int(row["vendor"]["isrealtime"]) == 0


@pytest.mark.parametrize("row", _rows(), ids=lambda r: r["instantET"][11:19])
def test_vendor_mode_reproduces_EVERY_timeline_reading(row):
    """All seven rows, both regimes, from the two axes the producer supplies."""
    bars, forming, confirmed = _clock_inputs(row)

    # ⭐ INSTANT A COMES FROM THE PRODUCER, NOT FROM THE ROW'S OWN ANSWER.
    # Reading the vendor's `isconfirmed` and feeding it back would make this a
    # tautology; it is derived from the INSTANT instead.
    assert forming is False, "every row is past the scheduled close"
    assert confirmed is not None, "the confirmation instant must resolve for D"

    cols = ic.compute_clock(bars, "D", newest_bar_is_forming=forming,
                            confirmed=confirmed, historical=_historical_of(row),
                            mode=ic.BARSTATE_MODE_VENDOR)
    got = {c: cols[c][-1] for c in COLS}
    want = {c: float(row["vendor"][c]) for c in COLS}
    assert got == want, (
        f"{row['instantET']}: vendor mode produced {got}, the chart showed {want}")


def test_the_replay_spans_BOTH_regimes_of_instant_B():
    """⛔ THE CONTROL ON THE PARAMETRISED TEST ABOVE.

    If every row sat on one side of instant B, supplying `historical` would be a
    constant and the replay would prove nothing about that axis.
    """
    seen = {_historical_of(r) for r in _rows()}
    assert seen == {False, True}, (
        f"the timeline no longer spans instant B: {seen}. Rows 1-6 read "
        f"isrealtime=1 and row 7 reads 0; without both, the `historical` axis is "
        f"untested.")


@pytest.mark.parametrize("missing", ["confirmed", "historical"])
def test_vendor_mode_FAILS_CLOSED_when_either_axis_is_unknown(missing):
    """⛔⛔ NEITHER INSTANT IS PINNED, SO NEITHER MAY BE GUESSED.

    `None` means nobody told us. A default would be this function quietly
    asserting an instant it cannot know, and a confident wrong column is the one
    outcome these four exist to prevent.
    """
    row = _rows()[-1]
    bars, forming, confirmed = _clock_inputs(row)
    kwargs = {"newest_bar_is_forming": forming, "confirmed": confirmed,
              "historical": _historical_of(row), "mode": ic.BARSTATE_MODE_VENDOR}
    kwargs[missing] = None
    cols = ic.compute_clock(bars, "D", **kwargs)
    for c in COLS:
        assert all(v is None for v in cols[c]), (
            f"{c} answered while {missing} was unknown: {cols[c]}")


def test_instant_B_HAS_NO_VALUE_AND_SAYS_SO():
    """⭐ `historical_instant` is always None, and that IS the measurement.

    Instant A at least has a candidate that fits its bracket -- 20:00, the
    extended-hours close. Instant B has none: bracketed (20:55, 23:57) ET with no
    proposed mechanism at all. The day somebody pins it, this goes red and the
    ruling gets revisited instead of the guess quietly shipping.
    """
    bars = _bars_for(_rows()[-1])
    assert ic.historical_instant(bars, "D") is None
    assert ic.historical_instant(bars, "5") is None


def test_the_replay_is_not_vacuous_the_two_regimes_DIFFER():
    """⛔⛔ THE CONTROL. Rows that all read the same would be reproduced by a
    derivation that ignores its inputs entirely. They do not: `isconfirmed` is 0
    before the transition and 1 after, so the fixture separates the two regimes
    and the parametrised test above has something to be right about.
    """
    seen = {int(r["vendor"]["isconfirmed"]) for r in _rows()}
    assert seen == {0, 1}, f"the timeline no longer spans the transition: {seen}"


def test_the_TWO_AXES_MOVE_AT_DIFFERENT_INSTANTS_which_is_the_whole_finding():
    """⭐⭐ A TRI-STATE CANNOT SPELL TWO FLAGS THAT FLIP HOURS APART.

    This is the evidence the divergence row rests on, and it is read off the
    fixture rather than restated: there is an instant where `isconfirmed` has
    already moved and `isrealtime` has not. One axis cannot produce that.
    """
    rows = _rows()
    both = [r for r in rows
            if int(r["vendor"]["isconfirmed"]) == 1 and int(r["vendor"]["isrealtime"]) == 1]
    assert both, (
        "no row shows isconfirmed=1 WITH isrealtime=1, so the timeline no longer "
        "witnesses the state our tri-state cannot spell")
    assert [r for r in rows if int(r["vendor"]["isrealtime"]) == 0], (
        "no row shows isrealtime=0, so the timeline no longer witnesses the "
        "position axis moving at all")


def test_calendar_mode_is_the_DEFAULT_and_is_untouched():
    """⛔ NO MEMBER-VISIBLE CHANGE. The default path must be byte-identical to
    what it produced before the mode existed, and asking for `calendar` by name
    must be the same call.
    """
    bars = _bars_for(_rows()[0])
    plain = ic.compute_clock(bars, "D", newest_bar_is_forming=False)
    named = ic.compute_clock(bars, "D", newest_bar_is_forming=False,
                             mode=ic.BARSTATE_MODE_CALENDAR)
    assert plain == named
    # and it is still the tri-state, which is the thing vendor mode is NOT
    assert plain["isrealtime"][-1] == 0.0
    assert plain["isconfirmed"][-1] == 1.0
    assert plain["ishistory"][-1] == 1.0


def test_the_two_modes_DISAGREE_where_the_vendor_and_we_disagree():
    """⭐ THE EXACT COLUMN DIFF, asserted rather than described.

    In the post-confirm, pre-open window the vendor reads isrealtime/isconfirmed/
    ishistory as 1/1/0 and this engine reads 0/1/1. A mode that produced the same
    answer as `calendar` would be a switch with nothing behind it.
    """
    bars = _bars_for(_rows()[-1])
    cal = ic.compute_clock(bars, "D", newest_bar_is_forming=False)
    # historical=False -- the POST-CONFIRM, PRE-OPEN window this test is about,
    # where instant A has passed and instant B has not. Supplying it is required:
    # neither axis has a default (G5), because neither instant is pinned.
    ven = ic.compute_clock(bars, "D", newest_bar_is_forming=False, confirmed=True,
                           historical=False, mode=ic.BARSTATE_MODE_VENDOR)
    triple = lambda c: (c["isrealtime"][-1], c["isconfirmed"][-1], c["ishistory"][-1])
    assert triple(cal) == (0.0, 1.0, 1.0)
    assert triple(ven) == (1.0, 1.0, 0.0)


def test_vendor_mode_FAILS_CLOSED_when_either_input_is_unknown():
    """⛔ An unknown must blank all four, never guess — the same rule the
    tri-state already follows. `vendor` has TWO inputs and so has two ways to be
    unknown; both are asserted, because a mode that blanked on one and guessed on
    the other would be the more dangerous half working correctly.
    """
    bars = _bars_for(_rows()[0])
    for forming, confirmed in ((None, True), (False, None), (None, None)):
        cols = ic.compute_clock(bars, "D", newest_bar_is_forming=forming,
                                confirmed=confirmed, mode=ic.BARSTATE_MODE_VENDOR)
        assert all(cols[c][-1] is None for c in COLS), (
            f"forming={forming} confirmed={confirmed} produced a value")


def test_an_unknown_mode_RAISES_rather_than_defaulting():
    """A typo must not silently select the shipped behaviour."""
    bars = _bars_for(_rows()[0])
    with pytest.raises(ValueError):
        ic.compute_clock(bars, "D", newest_bar_is_forming=False, mode="vendorr")


def test_the_confirmation_hour_is_a_HYPOTHESIS_and_says_so():
    """⚠️ The literal must keep announcing that it is not measured. If somebody
    promotes it to a fact, they have to delete this test to do it — which is the
    point.
    """
    src = io.open(ROOT / "api" / "services" / "nyse_calendar.py",
                  encoding="utf-8").read()
    assert nyse_calendar.EXTENDED_CLOSE_HOUR == 20
    assert nyse_calendar.EARLY_EXTENDED_CLOSE_HOUR == 17
    assert "HYPOTHESIS, NOT A MEASUREMENT" in src
    assert "(19:22, 20:55)" in src, "the bracket the hour has to sit inside"


def test_intraday_has_NO_separate_confirmation_instant():
    """⭐ A 5-minute bar's closing update IS its period ending, and
    `scheduled_close_seconds` already owns that. Inventing a second clock for it
    would be a second authority over one question.
    """
    bars = _bars_for(_rows()[0])
    for tf in ("1", "5", "15", "30", "60"):
        assert ic.confirmation_instant(bars, tf) is None
