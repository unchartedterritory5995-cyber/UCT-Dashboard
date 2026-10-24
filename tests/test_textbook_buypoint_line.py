"""Textbook round 2: the bc:base top line is drawn where `metrics_textbook.line` says, one price with the buy point.

Round 1 kept the line on the base's highest BODY (draw_base.pivot) while the printed buy point was the ceiling bar's
WICK high + $0.10, so a close could sit between the two while the label said "-2.3% from buy point". Round 2 stamps
`line` = buy_point - $0.10 (the base high) on every bc:base row; the chart draws the top line there. Synthetic bars
where the wick and the body disagree.
"""
from __future__ import annotations

import pytest

import api.routers.patterns as patterns_router  # noqa: F401 -- registers every detector
from api.services import auto_structures, textbook_numbers as tn
from tests.authclients import PAID_MEMBER
from tests.test_base_draw_member_drawing import _synth
from tests.test_base_metrics import _serve
from tests.test_member_drawing_set import _flags, _get
from tests.test_textbook_numbers import FLAT, _base_row, _hand


@pytest.fixture(autouse=True)
def stateless_base_released(monkeypatch):
    """The STATELESS bc:base is WITHHELD from members since 2026-10-24 (recert A: MEMBER_BASE_STATELESS_ROUND is
    None). This module tests the mechanism a released stateless base runs through, so it re-enables the literal in
    memory; tests/test_stateless_base_withheld_from_members.py rails the withholding."""
    from api.services import auto_structures as _as
    monkeypatch.setattr(_as, "MEMBER_BASE_STATELESS_ROUND", 5)


@pytest.fixture(autouse=True)
def _complete_sessions(monkeypatch):
    monkeypatch.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)


def test_the_line_is_the_wick_high_not_the_body_and_sits_ten_cents_under_the_buy_point():
    b = _hand(FLAT)                                   # bodies top at 50.00, one wick to 51.20
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    assert m["buy_point"] == 51.30
    assert m["line"] == 51.20                          # the wick high, NOT the body pivot 50.00
    assert m["line"] == round(m["buy_point"] - tn.BUY_POINT_TICK, 2)
    assert m["line"] != 50.0


def test_a_close_between_the_body_and_the_wick_is_under_the_drawn_line_and_under_the_buy_point():
    # the round-1 contradiction: the close 50.60 is over the body pivot 50.00 but under the buy point 51.30
    rows = list(FLAT[:-1]) + [(50.0, 50.8, 49.9, 50.6)]
    b = _hand(rows)
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    close = b[-1]["c"]
    assert 50.0 < close < m["buy_point"]               # through the old line, still under the buy point
    assert close < m["line"]                           # and under the line the chart now draws
    assert m["pct_from_buy_point"] < 0


def test_the_body_and_the_wick_agree_the_line_is_that_price():
    rows = [(r[0], max(r[0], r[3]), r[2], r[3]) for r in FLAT[:-1]] + [FLAT[-1]]   # no wick over any body
    b = _hand(rows)
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    assert m["line"] == 50.0 and m["buy_point"] == 50.10


def test_only_a_bc_base_row_carries_a_line():
    b = _hand(FLAT)
    fb = {"id": "fb", "pattern_id": "bc:flat-base", "end_t": b[-1]["t"], "geometry": {"extras": {
        "top": 51.2, "floor": 46.0, "draw_pivot": {"start_t": b[3]["t"], "end_t": b[-1]["t"], "price": 50.0}}}}
    cup = {"id": "cup", "pattern_id": "bc:cup-with-handle", "end_t": b[-1]["t"], "geometry": {"extras": {
        "draw_pivot": {"start_t": b[6]["t"], "end_t": b[-1]["t"], "price": 50.0},
        "draw_rim_ref": {"start_t": b[0]["t"], "end_t": b[-1]["t"], "price": 50.0}}}}
    for row in (fb, cup):
        m = tn.compute(row, b)
        assert m is not None and "line" not in m


def test_the_line_changes_no_printed_number():
    b = _hand(FLAT)
    m = tn.compute(_base_row(b, 0, pivot=50.0, low=46.0), b)
    assert set(m) - {"line"} == {"buy_point", "base_high", "asof_t", "depth_pct", "length_weeks", "buy_zone_top",
                                 "pct_from_buy_point", "extended", "stage"} - ({"stage"} - set(m))


def test_a_member_on_the_released_round_gets_the_line():
    b = _synth()
    _flags(monkeypatch_ := pytest.MonkeyPatch(), True, True)
    try:
        _serve(monkeypatch_, [auto_structures.base_draw_row("SYN", b)], b)
        monkeypatch_.setattr(auto_structures, "last_bar_forming", lambda t, now=None: False)
        monkeypatch_.setenv("AUTO_STRUCTURES_METRICS_ENABLED", "1")
        monkeypatch_.setenv("AUTO_STRUCTURES_TEXTBOOK_NUMBERS_ENABLED", "1")
        ex = _get(PAID_MEMBER).json()["structures"][0]["geometry"]["extras"]
        tb = ex["metrics_textbook"]
        assert ex["metrics_textbook_round"] == tn.TEXTBOOK_ROUND == auto_structures.MEMBER_TEXTBOOK_ROUND
        assert tb["line"] == round(tb["buy_point"] - tn.BUY_POINT_TICK, 2)
        assert tb["line"] >= ex["draw_base"]["pivot"]          # never under the body line it replaces
    finally:
        monkeypatch_.undo()


def test_support_resistance_keeps_clear_of_the_drawn_buy_point_line():
    """sr_served_prices lists every price a served drawing puts on the chart; round 2 draws the bc:base top line at
    metrics_textbook.line, so that price must be listed (beside the body pivot) or a zone could land on the line."""
    b = _hand(FLAT)
    row = _base_row(b, 0, pivot=50.0, low=46.0)
    row = tn.with_textbook([row], b)[0]
    line = row["geometry"]["extras"]["metrics_textbook"]["line"]
    assert line == 51.20
    served = auto_structures.sr_served_prices([row])
    assert 51.2 in served and 50.0 in served
    plain = _base_row(b, 0, pivot=50.0, low=46.0)
    assert 51.2 not in auto_structures.sr_served_prices([plain])      # no textbook numbers: the body line only
