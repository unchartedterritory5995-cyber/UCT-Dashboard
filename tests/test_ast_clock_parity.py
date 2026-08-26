"""The ``clock`` section in the Python lane, held to the JS lane's own output.

⭐⭐ THE ONE SECTION WHOSE VALUES COME FROM A CALENDAR RATHER THAN A PRICE, so it
is the one section where the two lanes can disagree without either being wrong
about arithmetic. ``Intl.DateTimeFormat('America/New_York')`` and
``zoneinfo.ZoneInfo('America/New_York')`` read the same IANA database, but they
are two different readers of it, and "both resolve the zone per instant" is
exactly the kind of claim this branch has found vacuous a dozen ways.

⛔ THE FIXTURE IS THE ONE AUTHORITY. ``tests/fixtures/ast/clock_parity.json``
was RECORDED from ``indicators.js::computeClock`` and is asserted here, the
``self_lag_parity.json`` idiom: a lane that drifts fails against the OTHER
LANE'S OWN OUTPUT rather than against numbers somebody retyped in a docstring.

⛔ AND IT GOES THROUGH ``interpret``, NOT THROUGH ``compute_clock``. Asserting
the helper directly would prove the maths agrees and say nothing about whether a
member's formula can reach it: the seeding, the ``opts`` thread and the
manifest's own list of names are all between the two, and every one of them is a
place a name can be declared and never arrive.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai
from api.services import ast_table
from api.services.indicator_compute import compute_clock

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "clock_parity.json"

#: The four columns whose answer is the TIMEFRAME's, not the bar's.
TF_FLAGS = ("isintraday", "isdaily", "isweekly", "ismonthly")


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _leaf(name: str) -> dict:
    """The minimal tree that reads ONE clock name."""
    return {"type": "series", "name": name}


def _column(name: str, bars: list, tf=None) -> list:
    opts = None if tf is None else {"tf": tf}
    return ai.interpret(_leaf(name), bars, opts=opts)


def _same(got: list, expected: list, name: str) -> None:
    assert len(got) == len(expected), (
        f"{name}: this lane returned {len(got)} values for {len(expected)} bars")
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None or (isinstance(a, float) and math.isnan(a)), (
                f"{name} bar {i}: this lane produced {a!r} where the other produced nothing")
            continue
        assert a is not None and not (isinstance(a, float) and math.isnan(a)), (
            f"{name} bar {i}: this lane produced nothing where the other produced {b}")
        assert abs(a - b) < 1e-9, f"{name} bar {i}: {a} vs {b}"


# ─── the parity ──────────────────────────────────────────────────────────────

def test_every_clock_column_matches_the_other_lane_bar_for_bar():
    doc = _doc()
    declared = sorted(ast_table.clock_names())
    assert set(declared) == set(doc["expected"]), (
        "the manifest's clock section and the recorded fixture name different "
        f"columns: manifest {declared}, fixture {sorted(doc['expected'])}")
    for name in declared:
        _same(_column(name, doc["bars"], doc["tf"]), doc["expected"][name], name)


def test_the_fixture_actually_spans_a_DST_CHANGE_and_a_WEEKEND():
    """⛔ NON-VACUITY, AND IT IS THE WHOLE REASON THIS FIXTURE IS SYNTHETIC.

    Every equality above passes on a series that sits inside one ET day in one
    ET offset — which is what an ordinary session fixture IS, and it is precisely
    the series a fixed-offset implementation is correct on.
    """
    doc = _doc()
    exp = doc["expected"]
    assert len(doc["bars"]) >= 20

    # A WEEKEND: Saturday is 7 and Sunday is 1 on Pine's 1-based day.
    assert len(set(exp["dayofweek"])) >= 5, sorted(set(exp["dayofweek"]))
    assert {1, 7} <= set(exp["dayofweek"]), (
        "no Saturday or Sunday bar — `dayofweek` never leaves the trading week")

    # THE FALLBACK ITSELF: two instants ONE UTC HOUR APART that are both 01:30 ET.
    at_0130 = [i for i, (h, m) in enumerate(zip(exp["hour"], exp["minute"]))
               if h == 1 and m == 30]
    assert len(at_0130) == 2, (
        f"the fixture has {len(at_0130)} bars at 01:30 ET; the repeated hour of "
        "the EDT->EST fallback needs exactly two")
    a, b = (exp["time"][i] for i in at_0130)
    assert b - a == 3600, (
        f"the two 01:30 ET bars are {b - a}s apart, not 3600 — they are not the "
        "two sides of the fallback and this fixture proves nothing about it")

    # AND ONE MORE ET DAY THAN A UTC READER WOULD FIND. Bar 5 is 20:00 ET on the
    # 31st == 00:00 UTC on the 1st: a UTC-day reader opens a session there.
    assert sum(exp["sessionfirst"]) == len(set(zip(
        exp["year"], exp["month"], exp["dayofmonth"]))), (
        "`sessionfirst` does not count the ET calendar days in the fixture")


def test_the_timeframe_booleans_agree_on_EVERY_code_INCLUDING_the_refused_ones():
    """⭐ THE TIMEFRAME VOCABULARY IS THE ONE LIST EACH LANE SPELLS FOR ITSELF.

    `indicators.js` cannot import the manifest — `interpret.test.js` pins it as a
    LEAF with no imports at all — so the eight codes are literals in each lane.
    That is a hand copy, and the only honest answer to a hand copy is to measure
    it: every code the fixture probes, including the five that are NOT codes.

    ⛔ THE `null` ROWS ARE THE POINT. A lane that guessed from the string's shape
    would call `3` intraday and `2D` daily with total confidence.
    """
    doc = _doc()
    bars = doc["bars"]
    probes = doc["tf_booleans"]
    assert len(probes) >= 10, "the probe set stopped covering the vocabulary"
    for tf, expected in probes.items():
        arg = None if tf == "__absent__" else tf
        for flag, want in expected.items():
            col = _column(flag, bars, arg)
            got = col[0]
            if want is None:
                assert got is None or (isinstance(got, float) and math.isnan(got)), (
                    f"tf={tf!r} {flag}: this lane answered {got!r}; the other "
                    "refused to classify that code")
            else:
                assert got == want, f"tf={tf!r} {flag}: {got!r} vs {want}"
            # Flat for the whole column, by construction — a timeframe is not a
            # per-bar fact and a lane that made it one would agree on bar 0.
            assert all((v is None or (isinstance(v, float) and math.isnan(v)))
                       if want is None else v == want for v in col), (
                f"tf={tf!r} {flag} is not flat across the column")


def test_an_absent_tf_FAILS_CLOSED_and_never_guesses_a_default():
    """⛔ THE CONTRACT'S OWN WORDS. `opts.tf` absent ⇒ not-computable, never a
    guessed default — a guessed `D` makes `isdaily` a confident 1 on a 5-minute
    chart, which is a wrong answer wearing a right one's clothes.

    ⚠️ AND THE WALL CLOCK IS UNAFFECTED, WHICH IS THE OTHER HALF: `hour` does not
    depend on the timeframe, so failing it closed too would refuse a column that
    has everything it needs.
    """
    doc = _doc()
    bars = doc["bars"]
    for flag in TF_FLAGS:
        assert all(v is None for v in _column(flag, bars)), (
            f"{flag} answered without being told the timeframe")
    _same(_column("hour", bars), doc["expected"]["hour"], "hour")
    _same(_column("barindex", bars), doc["expected"]["barindex"], "barindex")


def test_a_series_that_is_not_in_SECONDS_refuses_the_TIME_columns_and_only_those():
    """⛔ THE UNIT GATE, AND THAT IT IS PARTIAL.

    `bars_sqlite` stores daily `t` as YYYYMMDD ints and the alert lane passes
    them straight through, which is how `compute_vwap` once anchored 400 daily
    bars in 1970. The eight time-derived columns must refuse together; `barindex`
    and the timeframe booleans must not, because they never read `t`.
    """
    doc = _doc()
    bars = doc["non_instant_bars"]
    exp = doc["non_instant_expected"]
    time_derived = [n for n, col in exp.items() if all(v is None for v in col)]
    assert len(time_derived) == 8, sorted(time_derived)
    for name in sorted(exp):
        _same(_column(name, bars, "D"), exp[name], name)


# ─── the seam between the manifest and the maths ─────────────────────────────

def test_the_manifest_is_the_authority_over_WHICH_names_exist(monkeypatch):
    """⭐ AND THE MATHS IS THE AUTHORITY OVER WHAT EACH ONE MEANS. A clock name
    the manifest declares and `compute_clock` has no column for must RAISE, by
    name — seeding NaN would be a declared name that reads "not computable" on
    every bar of every symbol forever, and nothing anywhere would be red."""
    doc = _doc()
    planted = dict(ai.TABLE)
    planted[ast_table.CLOCK_SECTION] = dict(
        planted[ast_table.CLOCK_SECTION],
        **{"zzPlantedClock": {"lookback": 0, "yields": "num",
                              "sentence": "a planted clock value"}})
    monkeypatch.setattr(ai, "TABLE", planted)
    with pytest.raises(ValueError) as caught:
        ai.interpret(_leaf("close"), doc["bars"], opts={"tf": "5"})
    assert "zzPlantedClock" in str(caught.value), caught.value

    # The control: the SAME call against the shipped manifest does not raise, so
    # the assertion above cannot be satisfied by an interpreter that always does.
    monkeypatch.undo()
    ai.interpret(_leaf("close"), doc["bars"], opts={"tf": "5"})


def test_compute_clock_produces_EXACTLY_the_declared_names():
    """The seam from the other side: a column the maths produces that the table
    never declared is a vocabulary nobody granted, and one the table declares
    that the maths does not produce is the raise above waiting to happen."""
    doc = _doc()
    produced = set(compute_clock(doc["bars"], doc["tf"]))
    assert produced == ast_table.clock_names(), (
        f"only in compute_clock: {sorted(produced - ast_table.clock_names())}; "
        f"only in the manifest: {sorted(ast_table.clock_names() - produced)}")
