"""Base metrics on the Auto Structures base drawings (api/services/base_metrics.py), and their gates.

Rails: the arithmetic on hand-checkable numbers; the stage is base_catalog.base_stage_count or absent
(never guessed); no lookahead (appending later bars changes nothing); AUTO_STRUCTURES_METRICS_ENABLED off
leaves the route's payload byte-identical; a member gets metrics only while MEMBER_METRICS_ROUND (a
literal, None today) equals the stamped round. Synthetic bars only (public repo).
"""
from __future__ import annotations

import copy
import datetime
import json

import pytest

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_structures, base_metrics
from api.services.screener import base_catalog
from tests.authclients import ADMIN, PAID_MEMBER
from tests.test_base_draw_member_drawing import _synth
from tests.test_member_drawing_set import _flags, _get, _store


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


def _bars(n, start=datetime.date(2025, 6, 2), close=lambda k: 100.0):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            c = float(close(len(out)))
            out.append({"t": int(d.strftime("%Y%m%d")), "o": c, "h": c * 1.01, "l": c * 0.99, "c": c,
                        "v": 1e6})
        d += datetime.timedelta(days=1)
    return out


def _flat_row(bars, start_i, end_i, top=100.0, floor=90.0, pivot=99.0, asof_i=None):
    asof_i = len(bars) - 1 if asof_i is None else asof_i
    return {
        "id": "bc:flat-base:SYN", "pattern_id": "bc:flat-base", "start_t": bars[start_i]["t"],
        "end_t": bars[asof_i]["t"],
        "geometry": {"shape": "base_box", "anchors": [], "extras": {
            "top": top, "floor": floor, "pivot": pivot, "draw_box": False,
            "draw_pivot": {"start_t": bars[start_i]["t"], "end_t": bars[end_i]["t"], "price": pivot}}},
    }


def _future(bars, n=30):
    """`n` later sessions with wild prices: anything reading past the as-of bar would move."""
    last = datetime.datetime.strptime(str(bars[-1]["t"]), "%Y%m%d").date() + datetime.timedelta(days=1)
    return _bars(n, start=last, close=lambda k: 400.0 + 37 * (k % 5))


# -- the arithmetic ---------------------------------------------------------------------------------

def test_the_arithmetic_on_hand_checked_numbers():
    assert base_metrics.depth_pct(100, 88) == 12.0
    assert base_metrics.depth_pct(81.98, 72.14) == 12.0          # 9.84 / 81.98 = 12.003%
    assert base_metrics.buy_zone_top(81.98) == 86.08              # 81.98 * 1.05 = 86.079
    assert base_catalog.IBD_BUY_ZONE == 0.05
    assert base_metrics.pct_from_pivot(84.44, 81.98) == 3.0       # 2.46 / 81.98 = 3.0007%
    assert base_metrics.pct_from_pivot(80.0, 100.0) == -20.0
    b = _bars(40)
    assert base_metrics.length_weeks(b, b[3]["t"], b[28]["t"]) == 5.2   # 26 sessions / 5
    assert base_metrics.length_weeks(b, b[0]["t"], b[0]["t"]) == 0.2
    # nonsense in, nothing out
    assert base_metrics.depth_pct(90, 100) is None and base_metrics.depth_pct(None, 1) is None
    assert base_metrics.buy_zone_top(0) is None and base_metrics.pct_from_pivot(1, 0) is None
    assert base_metrics.length_weeks(b, b[5]["t"], b[2]["t"]) is None


def test_a_flat_base_row_is_measured_from_its_box_and_drawn_pivot(monkeypatch):
    monkeypatch.setattr(base_catalog, "base_stage_count", lambda bars: 0)
    b = _bars(60, close=lambda k: 95.0 if k < 59 else 101.97)
    m = base_metrics.compute(_flat_row(b, 30, 55), b)
    assert m == {"pivot": 99.0, "asof_t": b[-1]["t"], "depth_pct": 10.0, "length_weeks": 5.2,
                 "buy_zone_top": 103.95, "pct_from_pivot": 3.0}    # 26 sessions; 2.97/99 = 3.0%


def test_a_bc_base_row_is_measured_from_its_drawing():
    b = _synth()
    row = auto_structures.base_draw_row("SYN", b)
    d = row["geometry"]["extras"]["draw_base"]
    m = base_metrics.compute(row, b)
    n = sum(1 for x in b if d["start_t"] <= x["t"] <= d["end_t"])
    assert m["asof_t"] == d["end_t"] == b[-1]["t"]
    assert m["depth_pct"] == round((d["pivot"] - d["low"]) / d["pivot"] * 100, 1)
    assert m["length_weeks"] == round(n / 5, 1)
    assert m["buy_zone_top"] == round(d["pivot"] * 1.05, 2)
    assert m["pct_from_pivot"] == round((b[-1]["c"] - d["pivot"]) / d["pivot"] * 100, 1)


def test_the_stage_is_base_stage_count_or_absent_never_guessed(monkeypatch):
    b = _bars(60)
    row = _flat_row(b, 30, 55, asof_i=50)
    seen = []

    def count(bars):
        seen.append(bars[-1]["t"])
        return 2
    monkeypatch.setattr(base_catalog, "base_stage_count", count)
    assert base_metrics.compute(row, b)["stage"] == 2
    assert seen == [b[50]["t"]]                       # counted on bars up to the as-of bar only
    monkeypatch.setattr(base_catalog, "base_stage_count", lambda bars: 0)
    assert "stage" not in base_metrics.compute(row, b)

    def boom(bars):
        raise RuntimeError("no stack")
    monkeypatch.setattr(base_catalog, "base_stage_count", boom)
    assert "stage" not in base_metrics.compute(row, b)


def test_a_row_without_its_as_of_bar_or_a_drawn_pivot_gets_nothing():
    b = _bars(60)
    row = _flat_row(b, 30, 55)
    assert base_metrics.compute(row, b[:-1]) is None          # the as-of bar is not in the series
    no_pivot = copy.deepcopy(row)
    del no_pivot["geometry"]["extras"]["draw_pivot"]
    assert base_metrics.compute(no_pivot, b) is None
    assert base_metrics.compute({**row, "pattern_id": "bull_flag"}, b) is None
    assert base_metrics.compute(None, b) is None and base_metrics.compute(row, None) is None


# -- no lookahead -----------------------------------------------------------------------------------

def test_appending_future_bars_changes_no_metric():
    b = _synth()
    rows = [auto_structures.base_draw_row("SYN", b), _flat_row(b, len(b) - 30, len(b) - 3)]
    cup = _flat_row(b, len(b) - 60, len(b) - 2)
    cup["pattern_id"] = "bc:cup-with-handle"
    cup["geometry"]["extras"]["sub_boxes"] = [
        {"start_t": b[-60]["t"], "end_t": b[-10]["t"], "top": 100.0, "floor": 80.0},
        {"start_t": b[-9]["t"], "end_t": b[-1]["t"], "top": 99.0, "floor": 95.0}]
    rows.append(cup)
    longer = b + _future(b)
    for r in rows:
        m = base_metrics.compute(r, b)
        assert m is not None, r["pattern_id"]
        assert base_metrics.compute(r, longer) == m, r["pattern_id"]
    # and the as-of bar is honoured even when it is not the series' last bar
    r = _flat_row(b, len(b) - 30, len(b) - 3, asof_i=len(b) - 5)
    assert base_metrics.compute(r, b) == base_metrics.compute(r, b[:len(b) - 4])


def test_with_metrics_never_mutates_a_cached_row_and_passes_others_through():
    b = _synth()
    base = auto_structures.base_draw_row("SYN", b)
    other = {"id": "x", "pattern_id": "draw:inside-day", "geometry": {"extras": {}}}
    before = copy.deepcopy([base, other])
    out = base_metrics.with_metrics([base, other], b)
    assert [base, other] == before                       # inputs untouched
    assert out[1] is other
    ex = out[0]["geometry"]["extras"]
    assert ex["metrics_round"] == base_metrics.METRICS_ROUND and set(ex["metrics"]) >= {
        "depth_pct", "length_weeks", "buy_zone_top", "pct_from_pivot", "pivot", "asof_t"}


# -- the gates --------------------------------------------------------------------------------------

def _serve(monkeypatch, rows, bars):
    _store(monkeypatch, [])
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: json.loads(json.dumps(rows)))
    monkeypatch.setattr(auto_structures, "drawn_for", lambda sym: None)
    monkeypatch.setattr(auto_structures, "_daily_bars", lambda sym: json.loads(json.dumps(bars)))


def _today(monkeypatch, user):
    """The payload as it was before metrics existed: with_metrics replaced by the identity."""
    with monkeypatch.context() as m:
        m.setattr(auto_structures, "with_metrics", lambda sym, rows, member=False: rows)
        return _get(user).content


@pytest.mark.parametrize("user", [ADMIN, PAID_MEMBER], ids=["admin", "member"])
@pytest.mark.parametrize("flag", [None, "0", "false"])
def test_flag_off_the_payload_is_byte_identical_and_nothing_is_computed(monkeypatch, user, flag):
    b = _synth()
    _flags(monkeypatch, True, True)
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    if flag is None:
        monkeypatch.delenv("AUTO_STRUCTURES_METRICS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", flag)
    want = _today(monkeypatch, user)

    reads = []

    def counted(sym):   # NOT a raise: with_metrics swallows errors, so a raise would hide a computed read
        reads.append(sym)
        return json.loads(json.dumps(b))
    monkeypatch.setattr(auto_structures, "_daily_bars", counted)
    got = _get(user).content
    assert got == want
    assert b"metrics" not in got and b"structures" in got
    assert reads == []                                   # nothing was even computed


def test_flag_on_an_admin_sees_the_metrics(monkeypatch):
    b = _synth()
    _flags(monkeypatch, True, True)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    ex = _get(ADMIN).json()["structures"][0]["geometry"]["extras"]
    assert ex["metrics"] == base_metrics.compute(auto_structures.base_draw_row("SYN", b), b)
    assert ex["metrics_round"] == base_metrics.METRICS_ROUND


def test_the_member_round_is_a_literal_and_starts_closed():
    assert auto_structures.MEMBER_METRICS_ROUND is None


@pytest.mark.parametrize("member_round,shown", [
    (None, False), (1, True), (2, False), ("1", False), (True, False), (1.0, False)])
def test_a_member_sees_metrics_only_on_the_confirmed_round(monkeypatch, member_round, shown):
    b = _synth()
    _flags(monkeypatch, True, True)
    _serve(monkeypatch, [auto_structures.base_draw_row("SYN", b)], b)
    monkeypatch.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
    monkeypatch.setattr(base_metrics, "METRICS_ROUND", 1)
    monkeypatch.setattr(auto_structures, "MEMBER_METRICS_ROUND", member_round)
    got = _get(PAID_MEMBER)
    assert [s["pattern_id"] for s in got.json()["structures"]] == ["bc:base"]
    ex = got.json()["structures"][0]["geometry"]["extras"]
    assert ("metrics" in ex) is shown and ("metrics_round" in ex) is shown
    if not shown:   # a closed gate serves the member exactly today's payload
        assert got.content == _today(monkeypatch, PAID_MEMBER)
