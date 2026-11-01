"""fix/fx-clock-blank (2026-10-31) -- the bar's own clock in the Python lane, held to
the JS lane's own output.

Two defects, one clock (``sessionClockParity.test.js`` states both):

1. A date-keyed series holding ONE bar before 1990-01-01 blanked every clock column
   on every bar. The 1990 floor guards a NUMBER that is not unix seconds (a
   ``YYYYMMDD`` int); ``bar_open_instant`` applied it to an ISO date as well.
2. On a daily chart of the FX shape (one weekend day, not both) a time-of-day read
   (``SESSION_CLOCK_LEAVES``) is withheld whole and named
   (``time-clock:weekend-session``); a date read is drawn.

THE FIXTURE IS THE ONE AUTHORITY: ``sessionClockParity.test.js`` writes and reads
``tests/fixtures/ast/session_clock_parity.json``.
"""
from __future__ import annotations

import io
import json
import pathlib

import pytest

from api.services import ast_interpret as ai
from api.services import indicator_compute as ic

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "session_clock_parity.json"
CODE = "time-clock:weekend-session"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _run(case: dict, doc: dict):
    sink: dict = {}
    opts = dict(case.get("opts") or {}, chartClockSink=sink)
    return ai.interpret(case["ast"], doc["bars"][case["bars"]], {}, opts=opts), sorted(sink)


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got, codes = _run(case, doc)
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other withheld"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) < 1e-9, f"{case['name']} bar {i}: {a} vs {b}"
    assert codes == case["codes"], case["name"]


def test_the_fixture_is_not_vacuous():
    cases = {c["name"]: c for c in _doc()["cases"]}
    # before 1990: served, every bar
    assert all(v is not None for v in cases["time · 1985 sessions · D"]["expected"])
    assert cases["dow · 1971 sundays · D"]["expected"][0] == 1
    # the FX shape: a time-of-day read withheld whole and named, a date read drawn
    assert all(v is None for v in cases["hour · sundays · D"]["expected"])
    assert cases["hour · sundays · D"]["codes"] == [CODE]
    assert all(v is not None for v in cases["dow · sundays · D"]["expected"])
    assert cases["dow · sundays · D"]["codes"] == []
    # session bars: unchanged
    assert cases["time · weekdays · D"]["codes"] == []


def test_the_code_is_a_whole_one_and_the_leaf_list_mirrors_the_js_one():
    assert CODE in ai.CHART_CLOCK_WHOLE
    assert CODE in ai.CHART_CLOCK_WITHHELD_CODES
    js = (pathlib.Path(__file__).parent.parent / "app" / "src" / "components" / "chart"
          / "engine" / "ast" / "interpret.js").read_text(encoding="utf-8")
    start = js.index("export const SESSION_CLOCK_LEAVES = Object.freeze([")
    body = js[start:js.index("])", start)]
    import re
    assert tuple(re.findall(r"'([a-z]+)'", body)) == ai.SESSION_CLOCK_LEAVES


def test_bar_open_instant_reads_a_date_before_1990_and_keeps_the_number_floor():
    # Wed 1985-01-02 09:30 EST
    assert ic.bar_open_instant("1985-01-02", "D") == 473524200.0
    # Sun 1971-01-03 09:30 EST -- FX:EURUSD's first day
    assert ic.bar_open_instant("1971-01-03", "D") == 31761000.0
    # before the epoch too (KO's weekly store reaches 1962)
    assert ic.bar_open_instant("1962-01-05", "D") == -252063000.0
    # the NUMBER door keeps its floor
    assert ic.bar_open_instant(20250101, "D") is None
    assert ic.bar_open_instant(31788000, "D") is None
    # New York local mean time: unreadable through Sunday 1883-11-18, read from the 19th
    assert ic.bar_open_instant("1883-11-17", "D") is None
    assert ic.bar_open_instant("1883-11-18", "D") is None
    assert ic.bar_open_instant("1883-11-19", "D") == -2717573400.0


def test_compute_clock_reads_a_pre_1990_series_and_a_pre_epoch_one():
    cols = ic.compute_clock([{"t": "1985-01-02"}, {"t": "1985-01-03"}], "D")
    assert cols["time"] == [473524200.0, 473610600.0]
    assert cols["dayofweek"] == [4, 5]
    cols = ic.compute_clock([{"t": "1962-01-05"}, {"t": "1962-01-08"}], "D")
    assert cols["dayofweek"] == [6, 2]
    assert cols["hour"] == [9, 9]
