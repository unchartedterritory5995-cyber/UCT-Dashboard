"""Track 4, unit E1: `tools/vendor_harness/event_grade.py`, the grade of production's event fetch against
TradingView's probe captures. Each verdict is proved on a synthetic capture, and each can be reached only by the
shape it names: an exact placement with float32-equal values (MATCH-CAPABLE), an exact placement with other values
(SUBSTITUTED), a placement one bar off (DIVERGE), events TradingView has before our first held one (COVERAGE).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools", "vendor_harness"))
import event_grade as eg  # noqa: E402
import event_witness as ew  # noqa: E402

DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
        "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"]


def _t(day):
    return int(dt.datetime.fromisoformat(day + "T14:30:00+00:00").timestamp())


def _f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def _cap(tmp_path, title, cols, tf="1D", sym="NYSE:TEST", name="c"):
    titles = list(cols)
    plots = [{"id": f"plot_{i}", "title": f"{t} x"} for i, t in enumerate(titles)]
    doc = {"id": name, "capturedAtUTC": "x", "symbol": {"full_name": sym}, "timeframe": tf,
           "study": {"title": title, "plots": plots},
           "plotValues": {"fields": ["time"] + [p["id"] for p in plots],
                          "rows": [[_t(d)] + [cols[t][k] for t in titles] for k, d in enumerate(DAYS)]}}
    p = tmp_path / f"{name}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return ew.load(str(p))


def _col(**at):
    return [at.get(f"i{k}") for k in range(len(DAYS))]


def _div_cap(tmp_path, on):
    return _cap(tmp_path, "UCTPROBE_VW_DATA_DIVIDENDS", {"D01": on, "D07": [1] * len(DAYS)})


def _ours(rows, family="dividends", splits=None):
    fam = {"state": "ok", "rows": rows, "knownFrom": rows[0][eg.DATE_KEY[family]] if rows else None}
    out = {"families": {family: fam}}
    if splits is not None:
        out["families"]["splits"] = {"rows": splits}
    return out


def test_MATCH_CAPABLE_exact_placement_and_float32_values(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=_f32(0.77)))            # TradingView stores the float32 of 0.77
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.77}]))
    assert r["verdict"] == "MATCH-CAPABLE" and r["values"]["gross"]["float32"] == 1


def test_SUBSTITUTED_exact_placement_other_values(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.75}]))
    assert r["verdict"] == "SUBSTITUTED" and r["placement"]["both"] == 1


def test_SUBSTITUTED_values_close_but_not_float32_equal(tmp_path):
    """Within 1% is still another figure: only an exact or float32-equal value is MATCH-capable."""
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.7705}]))
    assert r["verdict"] == "SUBSTITUTED" and r["values"]["gross"]["rel1pct"] == 1


def test_DIVERGE_a_placement_one_bar_off(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-08", "gross": 0.77}]))
    assert r["verdict"] == "DIVERGE" and r["placement"]["tvOnly"] == 1 and r["placement"]["oursOnly"] == 1


def test_COVERAGE_tradingview_holds_events_before_our_first(tmp_path):
    cap = _div_cap(tmp_path, _col(i1=0.5, i6=0.5))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-13", "gross": 0.5}]))
    assert r["verdict"] == "COVERAGE" and r["placement"]["tvOnlyBeforeKnownFrom"] == 1


def test_a_weekend_dated_vendor_event_is_placed_on_monday(tmp_path):
    cap = _div_cap(tmp_path, _col(i5=0.59))                  # Monday 2026-01-12
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-10", "gross": 0.59}]))   # dated Saturday
    assert r["verdict"] == "MATCH-CAPABLE"


def test_weekly_placement_and_a_weekend_event_goes_to_the_next_week():
    weeks = ["2026-01-05", "2026-01-12", "2026-01-19"]
    assert eg.place("2026-01-08", weeks, weekly=True) == "2026-01-05"
    assert eg.place("2026-01-10", weeks, weekly=True) == "2026-01-12"
    assert eg.place("2026-01-12", weeks, weekly=True) == "2026-01-12"


def test_earnings_values_are_also_tried_on_todays_share_basis(tmp_path):
    cap = _cap(tmp_path, "UCTPROBE_VW_DATA_EARNINGS", {"E01": _col(i2=0.612), "E05": _col(i2=0.56)})
    ours = _ours([{"date": "2026-01-07", "actual": 6.12, "estimate": 5.6}], family="earnings",
                 splits=[{"date": "2026-01-14", "numerator": 10, "denominator": 1}])
    r = eg.grade_one(cap, ours)
    v = r["values"]["actual"]
    assert v["exact"] == 0 and v["splitAdjustedRel1e-6"] == 1 and r["verdict"] == "SUBSTITUTED"


def test_NO_DATA_when_we_hold_nothing_and_tradingview_does(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    assert eg.grade_one(cap, {"families": {"dividends": {"state": "unavailable", "rows": []}}})["verdict"] == "NO-DATA"


def test_the_report_carries_no_tradingview_value(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.123456))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.5}]))
    assert "0.123456" not in json.dumps(r)
