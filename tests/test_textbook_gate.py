"""The strict textbook gate on the member inside-day drawing (recert B round 2).

Three kinds of rail:
  * PARITY: the lab rule that passed the blind round, frozen as verdicts on the golden_judged inside-day charts
    (tests/fixtures/textbook_gate_parity.json, written by the lab), must equal pattern_engine.textbook_gate on the
    same charts -- the 32 passing charts AND the 32 it withholds, failure names in order;
  * SYNTHETIC: one clean uptrend inside day passes, and each rule, broken alone, fails by its own name;
  * WIRING: the member route withholds a failing inside day and keeps a passing one; a wrong gate literal withholds
    every inside day (fail closed); None turns the gate off.
"""
import json
import os

import pytest

from api.services.pattern_engine import textbook_gate as TG
from tests.golden_judged import member_path as MP

HERE = os.path.dirname(os.path.abspath(__file__))
PARITY = os.path.join(HERE, "fixtures", "textbook_gate_parity.json")
GOLDEN = os.path.join(HERE, "golden_judged", "fixtures", "inside_day.json.gz")


def _row(trigger, stop, end_t):
    return {"pattern_id": "draw:inside-day",
            "geometry": {"extras": {"draw_inside_day": {"trigger": trigger, "stop": stop, "end_t": end_t}}}}


def _golden_cases():
    return MP.load_family(GOLDEN)["cases"]


# ---------------------------------------------------------------- parity

def test_the_parity_file_covers_every_golden_chart_and_both_outcomes():
    verdicts = json.load(open(PARITY, encoding="utf-8"))["verdicts"]
    ids = {c["id"] for c in _golden_cases()}
    assert set(verdicts) == ids
    passing = [v for v in verdicts.values() if not v]
    failing = [v for v in verdicts.values() if v]
    assert len(passing) >= 20 and len(failing) >= 20, (len(passing), len(failing))   # non-vacuity


@pytest.mark.parametrize("case", _golden_cases(), ids=lambda c: c["id"])
def test_the_gate_matches_the_lab_rule_on_every_golden_chart(case):
    verdicts = json.load(open(PARITY, encoding="utf-8"))["verdicts"]
    bars = MP.decode_bars(case)
    e, k = case["expect"], float(case["bars"]["scale"])
    row = _row(float(e["trigger"]) / k, float(e["stop"]) / k, bars[-1]["t"])
    assert TG.inside_day_fails(bars, row) == verdicts[case["id"]]


def test_a_golden_chart_is_retired_exactly_when_the_gate_withholds_it():
    verdicts = json.load(open(PARITY, encoding="utf-8"))["verdicts"]
    for c in _golden_cases():
        assert bool(verdicts[c["id"]]) == ("retired" in c), c["id"]


# ---------------------------------------------------------------- synthetic

def _uptrend(n=300):
    """A steady ~0.15%/day uptrend with a small daily range, the last two bars a tight inside day."""
    bars, p = [], 50.0
    for i in range(n):
        p *= 1.0015
        bars.append({"t": 20200101 + i, "o": p * 0.999, "h": p * 1.008, "l": p * 0.992, "c": p, "v": 1e6})
    m = bars[-2]
    m.update(o=m["c"] * 0.995, h=m["c"] * 1.01, l=m["c"] * 0.985)
    x = bars[-1]
    x.update(o=m["c"] * 0.999, c=m["c"] * 1.001, h=m["c"] * 1.004, l=m["c"] * 0.994)
    return bars


def _clean():
    b = _uptrend()
    return b, _row(b[-1]["h"], b[-1]["l"], b[-1]["t"])


def test_a_clean_uptrend_inside_day_passes():
    b, r = _clean()
    assert TG.inside_day_fails(b, r) == []


def test_a_bar_poking_outside_the_mother_is_not_an_inside_day():
    b, r = _clean()
    b[-1]["h"] = b[-2]["h"] * 1.001
    assert "I1_not_inside" in TG.inside_day_fails(b, r)


def test_a_wide_inside_bar_fails_contraction():
    b, r = _clean()
    m = b[-2]
    b[-1].update(h=m["h"] * 0.9999, l=m["l"] * 1.0001)
    assert "I3_wide" in TG.inside_day_fails(b, _row(b[-1]["h"], b[-1]["l"], b[-1]["t"]))


def test_an_extended_stock_fails():
    b = _uptrend()
    for x in b[-15:]:                       # a run far above the 50-day
        for k in ("o", "h", "l", "c"):
            x[k] *= 1.12
    assert "I6_extended" in TG.inside_day_fails(b, _row(b[-1]["h"], b[-1]["l"], b[-1]["t"]))


def test_a_falling_stock_fails_trend():
    b = _uptrend()
    b = [dict(x, o=200 - x["o"], h=200 - x["l"], l=200 - x["h"], c=200 - x["c"]) for x in b]
    m, x = b[-2], b[-1]
    x.update(h=min(x["h"], m["h"]), l=max(x["l"], m["l"]))
    fails = TG.inside_day_fails(b, _row(x["h"], x["l"], x["t"]))
    assert "close<=sma200" in fails and "sma50<=sma200" in fails


def test_a_stop_off_both_lows_and_a_trigger_off_both_highs_fail():
    b, r = _clean()
    d = r["geometry"]["extras"]["draw_inside_day"]
    mid = (b[-1]["h"] + b[-1]["l"]) / 2
    assert "I5_stop_not_at_a_low" in TG.inside_day_fails(b, _row(d["trigger"], mid, d["end_t"]))
    assert "I4_trigger_not_at_a_high" in TG.inside_day_fails(b, _row(mid, d["stop"], d["end_t"]))


def test_a_short_history_or_a_malformed_row_fails_closed():
    b, r = _clean()
    assert TG.inside_day_fails(b[-100:], r) == ["short_history"]
    assert TG.inside_day_fails(b, {"pattern_id": "draw:inside-day"}) == ["unreadable"]


# ---------------------------------------------------------------- wiring

def _member(monkeypatch, bars):
    from api.services import auto_structures as AS
    monkeypatch.setattr(AS, "_daily_bars", lambda sym: bars)
    monkeypatch.setattr(AS, "last_bar_forming", lambda t, now=None: False)
    return AS


def test_the_member_gate_withholds_a_failing_inside_day_and_keeps_a_passing_one(monkeypatch):
    b, good = _clean()
    AS = _member(monkeypatch, b)
    bad = _row(good["geometry"]["extras"]["draw_inside_day"]["trigger"], (b[-1]["h"] + b[-1]["l"]) / 2, b[-1]["t"])
    other = {"pattern_id": "bc:base"}
    det, st = AS.member_textbook_gate("X", [other], [good, bad, other])
    assert det == [other] and st == [good, other]


def test_a_wrong_gate_literal_withholds_every_inside_day(monkeypatch):
    b, good = _clean()
    AS = _member(monkeypatch, b)
    monkeypatch.setattr(AS, "MEMBER_INSIDE_DAY_GATE_ROUND", TG.INSIDE_DAY_GATE_ROUND + 1)
    assert AS.member_textbook_gate("X", [], [good])[1] == []


def test_a_none_literal_turns_the_gate_off(monkeypatch):
    b, good = _clean()
    AS = _member(monkeypatch, b)
    bad = _row(b[-1]["h"], (b[-1]["h"] + b[-1]["l"]) / 2, b[-1]["t"])
    monkeypatch.setattr(AS, "MEMBER_INSIDE_DAY_GATE_ROUND", None)
    assert AS.member_textbook_gate("X", [], [good, bad])[1] == [good, bad]


def test_unreadable_bars_withhold_the_inside_day(monkeypatch):
    from api.services import auto_structures as AS
    _b, good = _clean()

    def boom(sym):
        raise RuntimeError("store down")
    monkeypatch.setattr(AS, "_daily_bars", boom)
    assert AS.member_textbook_gate("X", [], [good, {"pattern_id": "bc:base"}])[1] == [{"pattern_id": "bc:base"}]


def test_the_member_route_calls_the_gate_after_the_shelf():
    src = open(os.path.join(HERE, "..", "api", "routers", "patterns.py"), encoding="utf-8").read()
    shelf = src.index("member_shelf_over_forming(sym, rows, boxes)")
    gate = src.index("member_after_shelf(sym, rows, boxes)")   # the post-shelf passes: member_textbook_gate
    assert shelf < gate < src.index('mout["structures"] = boxes', gate)
