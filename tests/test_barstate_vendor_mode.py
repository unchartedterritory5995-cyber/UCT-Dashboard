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


@pytest.mark.parametrize("row", _rows(), ids=lambda r: r["instantET"][11:19])
def test_vendor_mode_reproduces_every_timeline_reading(row):
    """Every column the vendor showed, back out of our own derivation."""
    bars = _bars_for(row)
    now = float(row["session"]["scheduledCloseUnix"]) + \
        float(row["session"]["secondsPastScheduledClose"])

    # ⭐ THE TWO INPUTS COME FROM THE PRODUCER, NOT FROM THE ROW'S OWN ANSWERS.
    # Reading the vendor's `isconfirmed` and feeding it back in would make this
    # test a tautology; both are derived from the INSTANT instead.
    forming, confirmed = ic.bar_close_state_full(bars, "D", now=now)
    assert forming is False, "every row is past the scheduled close"
    assert confirmed is not None, "the confirmation instant must resolve for D"

    cols = ic.compute_clock(bars, "D", newest_bar_is_forming=forming,
                            confirmed=confirmed, mode=ic.BARSTATE_MODE_VENDOR)
    got = {c: cols[c][-1] for c in COLS}
    want = {c: float(row["vendor"][c]) for c in COLS}
    assert got == want, (
        f"{row['instantET']}: vendor mode produced {got}, the chart showed {want}")


def test_the_replay_is_not_vacuous_the_two_regimes_DIFFER():
    """⛔⛔ THE CONTROL. Six rows that all read the same would be reproduced by a
    derivation that ignores its inputs entirely. They do not: `isconfirmed` is 0
    before the transition and 1 after, so the fixture separates the two regimes
    and the parametrised test above has something to be right about.
    """
    seen = {int(r["vendor"]["isconfirmed"]) for r in _rows()}
    assert seen == {0, 1}, f"the timeline no longer spans the transition: {seen}"


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
    ven = ic.compute_clock(bars, "D", newest_bar_is_forming=False, confirmed=True,
                           mode=ic.BARSTATE_MODE_VENDOR)
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
