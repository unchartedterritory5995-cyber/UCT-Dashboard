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
    # 31st == 00:00 UTC on the 1st: a UTC-day reader opens a session there, and an
    # ET one does not.
    #
    # ⛔ THE COUNT IS "ET DAYS MINUS ONE", AND THE MINUS ONE IS THE WARM-UP BAR.
    # The oldest bar has no previous day to differ from, so the session it opens
    # is the one day this column cannot claim -- exactly as `change(close)` cannot
    # claim the first bar's change. Asserting the raw day count here would be
    # asserting the fabricated 1 this fix removed.
    days = set(zip(exp["year"], exp["month"], exp["dayofmonth"]))
    assert exp["sessionfirst"][0] is None, "the warm-up bar carries a value"
    assert exp["sessionfirst"].count(None) == 1, (
        "more than the warm-up bar is blank -- something else is refusing")
    assert sum(v for v in exp["sessionfirst"] if v is not None) == len(days) - 1, (
        f"`sessionfirst` marks {sum(v for v in exp['sessionfirst'] if v)} openings "
        f"for {len(days)} ET calendar days (one is the warm-up bar's)")
    # ⚠️ AND THE DISCRIMINATOR IS NOT THE DAY COUNT — THIS FIXTURE HAPPENS TO
    # HAVE SEVEN OF EACH. It is that at least one bar opens a UTC day WITHOUT
    # opening an ET session: bar 5 is 20:00 ET on the 31st, which IS 00:00 UTC on
    # the 1st. A lane bucketing by the UTC day marks it 1; the ET lane marks it 0
    # because the Friday session has not ended. That single bar is the measured
    # $14.45 open-gap defect `VWAP_SESSION_ANCHOR` retired, in a new column.
    utc_only = [i for i in range(1, len(exp["time"]))
                if exp["time"][i] // 86400 != exp["time"][i - 1] // 86400
                and exp["sessionfirst"][i] == 0]
    assert utc_only, (
        "no bar opens a UTC day without opening an ET session — the fixture no "
        "longer distinguishes the two bucketings and this whole case is vacuous")


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


def test_sessionfirst_is_WINDOW_INDEPENDENT_and_declares_the_bar_it_reads():
    """⛔⛔ THE ONE CLOCK VALUE THAT READS A SECOND BAR, AND THE DEFECT IT CARRIED.

    ``sessionfirst`` compares this bar's ET day against the PREVIOUS bar's, so it
    is a function of two bars exactly as ``change(close)`` is. It declared
    ``lookback: 0`` and answered 1 on the leading bar of ANY window -- so the same
    bar of the same tape said "opens a session" or "does not" depending on where
    the series happened to start. Measured before the fix: ``bars[1:]`` and
    ``bars[4:]`` both read ``[1, 0, 1, 0]`` where the full series read
    ``[0, 0, 1, 0]``.

    Two halves, and BOTH are needed. The declaration is what a budget and a
    warm-up pad read; the blank is what makes the remaining values true.
    """
    doc = _doc()
    bars = doc["bars"]
    full = _column("sessionfirst", bars, doc["tf"])

    # 1. THE DECLARATION IS TRUE. It is the only clock entry with a window, and
    #    the manifest is what says so -- read, never typed.
    windows = {n: spec["lookback"] for n, spec in ast_table.TABLE[
        ast_table.CLOCK_SECTION].items()}
    assert windows["sessionfirst"] == 1, windows
    assert [n for n, w in windows.items() if w] == ["sessionfirst"], (
        f"another clock entry grew a window and nothing bounded it: {windows}")

    # 2. THE VALUE IS WINDOW-INDEPENDENT. Every slice agrees with the full series
    #    from its SECOND bar on, and its first bar is blank rather than guessed.
    for cut, expected in sorted(doc["sliced_sessionfirst"].items()):
        i = int(cut)
        got = _column("sessionfirst", bars[i:], doc["tf"])
        _same(got, expected, f"sessionfirst on bars[{i}:]")
        assert got[0] is None, f"bars[{i}:] fabricated a value on its warm-up bar"
        assert got[1:] == full[i + 1:], (
            f"bars[{i}:] disagrees with the full series from its second bar on: "
            f"{got[1:6]} vs {full[i + 1:i + 6]}")

    # ⛔ NON-VACUITY: at least one slice must START inside a session, or every
    # assertion above is satisfied by a series whose every bar opens one.
    assert any(full[int(c) + 1] == 0 for c in doc["sliced_sessionfirst"]), (
        "no slice begins mid-session -- the rail would pass on a fixture where "
        "the fabricated 1 was accidentally correct")


def test_a_clock_leaf_is_LIVE_and_NON_REPAINTING_and_both_branches_can_be_DELETED():
    """⛔⛔ TWO BRANCHES THAT SHIPPED WITH NO RAIL, IN THIS LANE.

    ``ast_freshness`` gained ``if name in clock: continue`` and ``ast_lint``
    gained a clock arm resolving reach from the manifest; nothing in
    ``tests/test_ast_lint.py`` or ``tests/test_ast_indicators.py`` mentions a
    clock name, so DELETING either kept every suite green —
    ``lesson_built_tested_green_and_unreachable``, in the two modules whose whole
    job is to fail closed.

    Each assertion is PAIRED with the same walk over a table missing only the
    ``clock`` section, which is exactly what deleting the branch produces:
    freshness falls to ``unknown`` and the linter to ``repaints``.
    """
    from api.services import ast_freshness, ast_lint

    names = sorted(ast_table.clock_names())
    assert names, "no clock section — this rail would be vacuous"
    stripped = dict(ast_table.TABLE)
    stripped[ast_table.CLOCK_SECTION] = {}

    for name in names:
        tree = _leaf(name)
        fresh = ast_freshness.freshness_for(tree)
        assert fresh["mode"] == "live", f"{name}: {fresh['mode']}"
        assert fresh["scalars"] == [], f"{name} was counted as a per-symbol value"
        assert ast_freshness.freshness_for(tree, {"table": stripped})["mode"] == "unknown", (
            f"{name} read live off a table that does not declare it")

        assert ast_lint.lint_repaint(tree)["mode"] == "non-repainting", name
        assert ast_lint.lint_repaint(tree, {"table": stripped})["mode"] == "repaints", (
            f"{name} was bounded by a table that does not declare it")

    # ⚠️ AND A CLOCK LEAF DOES NOT LAUNDER A SCALAR: the snapshot still dominates,
    # or the branch above would be a way to make anything read live.
    mixed = {"type": "op", "name": ">",
             "args": [_leaf("hour"), _leaf("market_cap")]}
    assert ast_freshness.freshness_for(mixed)["mode"] == "as-of-snapshot"
    assert ast_freshness.scalars_in(mixed) == {"market_cap"}


def test_a_clock_leafs_REACH_is_the_manifests_own_lookback_not_a_hardcoded_zero():
    """⛔ THE LINTERS READ THE DECLARATION RATHER THAN ASSUMING IT.

    Both hardcoded ``(0, 0)`` for every clock name, which was true for twelve and
    FALSE for ``sessionfirst`` — and a hardcoded zero would go on being false for
    the next entry that declares a window. The reach is now
    ``own_window(<the entry>, [])``: the same call a function's reach is, so the
    manifest is the one authority and a fourteenth entry is bounded on the day it
    lands.
    """
    from api.services import ast_lint

    for name, spec in sorted(ast_table.TABLE[ast_table.CLOCK_SECTION].items()):
        reach = ast_lint.ast_reach(_leaf(name))
        assert reach["back"] == spec["lookback"], (
            f"{name}: linter says back={reach['back']}, the manifest declares "
            f"lookback={spec['lookback']}")
        assert reach["forward"] == 0, f"{name} claims to read a later bar"
        assert reach["reasons"] == [], f"{name} was unanalysable: {reach['reasons']}"

    # ⭐ NON-VACUITY, AND IT IS THE WHOLE FINDING: at least one clock entry must
    # declare a NON-ZERO window, or `back == lookback` is satisfied by the
    # hardcoded zero this replaced.
    assert any(spec["lookback"] for spec
               in ast_table.TABLE[ast_table.CLOCK_SECTION].values()), (
        "every clock entry declares lookback 0 — this rail cannot tell a derived "
        "reach from a hardcoded one")

    # ⛔ AND THE DERIVATION IS REAL: a PLANTED entry with a three-bar window is
    # bounded at three without this file (or the linter) knowing its name.
    planted = dict(ast_table.TABLE)
    planted[ast_table.CLOCK_SECTION] = dict(
        planted[ast_table.CLOCK_SECTION],
        **{"zzPlantedWindow": {"lookback": 3, "yields": "num",
                               "sentence": "a planted windowed clock value"}})
    got = ast_lint.ast_reach(_leaf("zzPlantedWindow"), {"table": planted})
    assert (got["back"], got["forward"]) == (3, 0), got


def test_the_five_ZERO_ONE_clock_values_are_DECLARED_bool_and_a_consumer_READS_it():
    """⛔ A `yields` NOBODY READS IS AN INERT KNOB.

    ``ast_table.yields_of`` hand-listed the sections it consulted and skipped the
    fifth, so all thirteen clock declarations resolved to nothing: ``yields_of``
    raised ``KeyError`` and ``is_boolean_tree`` fell to False. The visible cost was
    a member being refused a bare ``isintraday`` as a scan while the identical 0/1
    shape on a scalar was accepted -- and the invisible one was that DECLARING it
    correctly would have changed nothing.
    ``lesson_a_measured_knob_is_inert_if_the_consumer_skips_its_stage``.
    """
    from api.services import scan_definition

    declared = {n: ast_table.yields_of(n) for n in sorted(ast_table.clock_names())}
    bools = sorted(n for n, y in declared.items() if y == "bool")
    assert bools == sorted(TF_FLAGS + ("sessionfirst",)), declared
    # ⚠️ AND THE OTHER EIGHT ARE MAGNITUDES. Both halves, so a lane that declared
    # everything `bool` -- or everything `num` -- fails.
    assert sorted(n for n, y in declared.items() if y == "num") == sorted(
        set(declared) - set(bools)), declared

    # THE CONSUMER, not the declaration: this is the reader that was skipping it.
    for name in bools:
        assert scan_definition.is_boolean_tree(_leaf(name)) is True, name
    for name in set(declared) - set(bools):
        assert scan_definition.is_boolean_tree(_leaf(name)) is False, name

    # ⭐ THE CONTROL. A planted clock entry declaring `bool` must reach the same
    # consumer, so the section is genuinely being walked rather than a list of
    # five names having been typed somewhere.
    planted = dict(ast_table.TABLE)
    planted[ast_table.CLOCK_SECTION] = dict(
        planted[ast_table.CLOCK_SECTION],
        **{"zzPlantedFlag": {"lookback": 0, "yields": "bool",
                             "sentence": "a planted flag"}})
    assert ast_table.yields_of("zzPlantedFlag", planted) == "bool"
    assert ast_table.yields_of("hour", planted) == "num"


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
