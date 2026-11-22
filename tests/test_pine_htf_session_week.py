"""Q-CLOSURE (coordinator ruling 2026-11-21) in the Python lane: a daily bar is keyed to its week or month by the session
it belongs to, never by the calendar date of its open; a week the exchange's own calendar decides is withheld by name.

The twin of ``app/src/components/chart/engine/ast/htfSessionWeek.test.js``, over the fixture it writes
(``tests/fixtures/ast/htf_session_week.json``; synthetic bars shaped like the captures
``vw-req-w-closure-day-{eurusd,es1}-1d-2026-11-20``). TradingView stamps an FX or futures daily bar at its session open,
the evening before its trading day; keyed by that open's date, a weekly read was wrong on 13,852 of 14,365 EURUSD bars
and 7,160 of 7,386 ES1 bars. ``ast_interpret._session_keying`` keys each bar by the session it opens (S0), carries a
closure's session to the next trading day when that day holds no bar of its own (S2), and lists what no capture
witnesses; ``htf_venue_calendar_mask`` withholds it, with the close of a week ending before a weekday with no session,
by ``request:htf-venue-calendar``. The committed SPY and BTCUSD daily captures keep their dates (coordinator condition 1).
"""
from __future__ import annotations

import datetime
import json
import math
import pathlib

import pytest

from api.services import ast_interpret

ROOT = pathlib.Path(__file__).parent
FIXTURE = ROOT / "fixtures" / "ast" / "htf_session_week.json"
FIX = json.loads(FIXTURE.read_text(encoding="utf-8"))
CASES = FIX["cases"]
HARNESS = ROOT / "fixtures" / "vendor" / "harness"


def _opts(case, sink=None):
    opts = {k: v for k, v in case["opts"].items() if k != "newestBarIsForming"}
    opts["newest_bar_is_forming"] = case["opts"]["newestBarIsForming"]
    if sink is not None:
        opts["chartClockSink"] = sink
    return opts


def _column(tree, bars, opts):
    col = ast_interpret.interpret(tree, bars, {}, opts=opts)
    return [None if v is None or (isinstance(v, float) and math.isnan(v)) else v for v in col]


def test_the_fixture_is_not_vacuous():
    assert len(CASES) >= 20
    assert FIX["witnessedThrough"] == ast_interpret.SESSION_CARRY_WITNESSED_THROUGH
    assert sum(c["name"].startswith("CONTROL") for c in CASES) >= 4
    assert sum(None in c["expect"] for c in CASES) >= 6
    assert {"eur", "es", "esFuture", "esNewest", "esFar", "spyLike", "stray", "everyDay", "midnight"} <= set(FIX["sets"])


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_python_lane_gives_the_hand_written_answer_the_js_column_and_the_same_codes(case):
    sink: dict = {}
    col = _column(case["tree"], FIX["sets"][case["set"]], _opts(case, sink))
    for j, want in zip(case["pick"], case["expect"]):
        if want is None:
            assert col[j] is None, f"{case['name']} bar {j}: {col[j]}"
        else:
            assert col[j] == pytest.approx(want, abs=1e-9), f"{case['name']} bar {j}: {col[j]} != {want}"
    assert len(col) == len(case["served"])
    for j, (g, w) in enumerate(zip(col, case["served"])):
        assert (g is None) == (w is None) and (w is None or g == pytest.approx(w, abs=1e-9)), \
            f"{case['name']} bar {j}: {g} != the JS lane's {w}"
    assert sorted(sink) == case["codes"], case["name"]


@pytest.mark.parametrize("name", sorted(FIX["keying"]))
def test_each_set_is_keyed_as_the_js_lane_keys_it(name):
    assert ast_interpret._bar_days(FIX["sets"][name]) == FIX["keying"][name]


def test_s0_everywhere_on_the_fx_shape_and_s2_on_exactly_three_es1_sessions():
    plus = lambda d, k: (datetime.date.fromisoformat(d) + datetime.timedelta(days=k)).isoformat()   # noqa: E731
    eur = FIX["sets"]["eur"]
    assert ast_interpret._bar_days(eur) == [plus(b["t"], 1) for b in eur]
    es = FIX["sets"]["es"]
    moved = [(b["t"], d) for b, d in zip(es, ast_interpret._bar_days(es)) if d != plus(b["t"], 1)]
    assert moved == [("2021-05-30", "2021-06-01"), ("2025-07-03", "2025-07-07"), ("2026-06-18", "2026-06-22")]
    for name in ("spyLike", "stray", "everyDay", "midnight"):
        assert ast_interpret._bar_days(FIX["sets"][name]) == [ast_interpret._iso_day(b["t"]) for b in FIX["sets"][name]]


def _reference(bars, days, code, field):
    """The W / M look-ahead aggregate of each bar keyed by its own date (the keying before Q-CLOSURE)."""
    def key(d):
        x = datetime.date.fromisoformat(d)
        return (x.year, x.month) if code == "M" else tuple(x.isocalendar()[:2])
    agg: dict = {}
    for b, d in zip(bars, days):
        k = key(d)
        a = agg.get(k)
        if a is None:
            agg[k] = dict(o=b["o"], h=b["h"], l=b["l"], c=b["c"], v=b["v"])
        else:
            a["h"] = max(a["h"], b["h"])
            a["l"] = min(a["l"], b["l"])
            a["c"] = b["c"]
            a["v"] += b["v"]
    return [agg[key(d)][field] for d in days]


@pytest.mark.parametrize("file", ["vw-request-htf-alignment-spy-1d-2026-10-02.json",
                                  "vw-bt-session-overnight-value-btcusd-1d-2026-11-16.json"])
def test_committed_spy_and_btcusd_daily_captures_keep_their_dates_and_their_aggregates(file):
    """Coordinator condition 1: a stock's and a 24x7 symbol's W / M aggregates are byte-equal to their dates' keying."""
    cap = json.loads((HARNESS / file).read_text(encoding="utf-8"))
    bars = [{"t": t, "o": o, "h": h, "l": lo, "c": c, "v": 0 if v is None else v}
            for t, o, h, lo, c, v in (r[:6] for r in cap["bars"]["rows"])]
    days = [ast_interpret._iso_day(b["t"]) for b in bars]
    assert ast_interpret._bar_days(bars) == days
    opts = {"tf": "D", "newest_bar_is_forming": False, "historyFromListing": True}
    for code in ("W", "M"):
        for field in ("open", "high", "low", "close", "volume"):
            got = _column({"type": "tf_live", "value": code, "args": [{"type": "series", "name": field}]}, bars, opts)
            assert got == _reference(bars, days, code, field[0]), (file, code, field)


def _capture(cid):
    """A committed Q-CLOSURE capture's bars as the harness hands them: each dated by its open's calendar date in the
    exchange's zone (``ourSide.js::toProductBars``), and a TradingView plot by title, per bar."""
    from zoneinfo import ZoneInfo
    cap = json.loads((HARNESS / f"vw-req-w-closure-day-{cid}-1d-2026-11-20.json").read_text(encoding="utf-8"))
    zone = ZoneInfo(cap["symbol"]["timezone"])
    bars = [{"t": datetime.datetime.fromtimestamp(t, datetime.timezone.utc).astimezone(zone).strftime("%Y-%m-%d"),
             "o": o, "h": h, "l": lo, "c": c, "v": 0 if v is None else v}
            for t, o, h, lo, c, v in (r[:6] for r in cap["bars"]["rows"])]
    titles = [p.get("title") or p.get("id") for p in cap["study"]["plots"]]

    def tv(title):
        j = 1 + titles.index(title)
        at = {r[0]: r[j] for r in cap["plotValues"]["rows"]}
        return [at.get(r[0]) for r in cap["bars"]["rows"]]
    return bars, tv


@pytest.mark.parametrize("cid", ["eurusd", "es1"])
def test_the_python_lane_gives_tradingviews_look_ahead_weekly_close_on_both_captures(cid):
    bars, tv = _capture(cid)
    want = tv("W_close_on")
    got = _column({"type": "tf_live", "value": "W", "args": [{"type": "series", "name": "close"}]}, bars,
                  {"tf": "D", "newest_bar_is_forming": False, "historyFromListing": False})
    compared = 0
    for i, (g, w) in enumerate(zip(got, want)):
        if w is None:
            continue
        compared += 1
        assert g == pytest.approx(w, abs=1e-9), (cid, i, bars[i]["t"], g, w)
    assert compared > 7000


def test_s2_on_the_captures_is_exactly_the_witnessed_list():
    def crossings(bars):
        out = []
        for b, d in zip(bars, ast_interpret._bar_days(bars)):
            s0 = (datetime.date.fromisoformat(b["t"]) + datetime.timedelta(days=1)).isoformat()
            x, y = datetime.date.fromisoformat(s0), datetime.date.fromisoformat(d)
            if d != s0 and (x.isocalendar()[:2] != y.isocalendar()[:2] or (x.year, x.month) != (y.year, y.month)):
                out.append((b["t"], s0, d))
        return out
    assert crossings(_capture("eurusd")[0]) == []
    assert crossings(_capture("es1")[0]) == [
        ("2009-07-02", "2009-07-03", "2009-07-06"), ("2010-05-30", "2010-05-31", "2010-06-01"),
        ("2014-07-03", "2014-07-04", "2014-07-07"), ("2015-07-02", "2015-07-03", "2015-07-06"),
        ("2020-07-02", "2020-07-03", "2020-07-06"), ("2021-05-30", "2021-05-31", "2021-06-01"),
        ("2025-07-03", "2025-07-04", "2025-07-07"), ("2026-06-18", "2026-06-19", "2026-06-22"),
        ("2026-07-02", "2026-07-03", "2026-07-06")]
