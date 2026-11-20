"""RULING 2 (coordinator, 2026-11-20) in the Python lane: a resampler keys a bar's week or month by the exchange's local
session date, never its UTC date, and the two lanes never disagree on a week.

The twin of ``app/src/components/chart/engine/ast/htfExchangeDay.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_exchange_day.json``). This lane read an intraday bar's day as the UTC one and its resampler (a
week is its sessions) then left New York's winter Friday 19:00 bar (a UTC Saturday) out of the week: on the server's
indicator alerts (``alert_user_series``, intraday timeframes, a ``request.security`` weekly or monthly read), a weekly
close or high was another number than the chart's. TradingView keys the bar to its local Friday (capture
``vw-bi-time-d-extended-spy-60-2026-11-19``). The SPY cases are the capture's own rows; a series holding a session the
exchange never held keeps every bar in both lanes (one aggregate). Whether TradingView's week holds such a bar is
unmeasured (Q-REQ-CLOSURE); ruling (C) defers the withhold, and ``tests/test_htf_closure_week_unreachable.py`` pins why
no served series reaches it.
"""
from __future__ import annotations

import datetime
import json
import math
import pathlib
from zoneinfo import ZoneInfo

import pytest

from api.services import ast_interpret, bars_fetch

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "htf_exchange_day.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]


def _opts(case, sink=None):
    opts = {k: v for k, v in case["opts"].items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = case["opts"]["newestBarIsForming"]
    if sink is not None:
        opts["chartClockSink"] = sink
    return opts


def _column(case, sink=None):
    col = ast_interpret.interpret(case["tree"], FIX["sets"][case["set"]], {}, opts=_opts(case, sink))
    return [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col]


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 10
    assert len(FIX["sets"]["feb"]) == 96 and len(FIX["sets"]["nov"]) == 48
    assert sum(c["set"] == "goodFriday" for c in CASES) >= 2
    assert sum(c["name"].startswith("CONTROL") for c in CASES) >= 2


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_gives_the_hand_written_answer_the_js_column_and_the_same_codes(case):
    sink: dict = {}
    col = _column(case, sink)
    for j, want in zip(case["pick"], case["expect"]):
        if want is None:
            assert col[j] is None, f"{case['name']} bar {j}: {col[j]}"
        else:
            assert col[j] == pytest.approx(want, abs=1e-9), f"{case['name']} bar {j}: {col[j]} != {want}"
    assert len(col) == len(case["served"])
    for j, (g, w) in enumerate(zip(col, case["served"])):
        assert (g is None) == (w is None) and (w is None or g == pytest.approx(w, abs=1e-9)), \
            f"{case['name']} bar {j}: {g} != the JS lane's {w}"
    assert sorted(k for k in sink) == case["codes"], case["name"]


def test_the_exchange_day_is_new_yorks_on_every_half_hour_1990_to_2035():
    ny = ZoneInfo("America/New_York")
    t = int(datetime.datetime(1990, 1, 1, tzinfo=datetime.timezone.utc).timestamp())
    end = int(datetime.datetime(2036, 1, 1, tzinfo=datetime.timezone.utc).timestamp())
    stamps = []
    while t < end:
        stamps.append(t)
        t += 7193
    # an intraday series (two-hour spacing): each bar keyed by its New York day
    days = ast_interpret._bar_days([{"t": x} for x in stamps])
    for x, got in zip(stamps, days):
        want = datetime.datetime.fromtimestamp(x, datetime.timezone.utc).astimezone(ny).strftime("%Y-%m-%d")
        assert got == want, x
    assert len(stamps) > 200000
    # a single stamp is no series: its UTC day, as before (a date stamped at midnight UTC stays that date)
    assert ast_interpret._iso_day(1613174400) == "2021-02-13"
    assert ast_interpret._bar_days([{"t": 1613174400}]) == ["2021-02-13"]


def test_the_resampler_keeps_every_row_when_asked_and_drops_none_by_default():
    rows = [{"t": "2024-03-28", "o": 1, "h": 9.5, "l": 1, "c": 2, "v": 1},
            {"t": "2024-03-29", "o": 1, "h": 10.5, "l": 1, "c": 3, "v": 1}]
    assert bars_fetch._resample_weekly_iso(rows)[0]["h"] == 9.5              # the store's week: its sessions
    assert bars_fetch._resample_weekly_iso(rows, sessions_only=False)[0]["h"] == 10.5
    assert bars_fetch._resample_monthly_iso(rows, sessions_only=False)[0]["c"] == 3
    # the interpreter's resample (the one authority over a request's higher-timeframe bars) keeps the Good Friday bar:
    # week 13's high is its 10.5, the JS lane's ``resampleTo`` answer, and every bucket has its bar
    _iso, _keys, _at, order, htf = ast_interpret._htf_resampled(FIX["sets"]["goodFriday"], "W")
    assert len(htf) == len(order) == 4
    assert htf[1]["h"] == 10.5
