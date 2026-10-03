"""H3 (2026-10-02) -- ``vwapOf(source)``, the Python lane, graded on the same
TradingView capture as ``vendorHarness.h3VwapSource.test.js``.

``vw-clock-vwap-spy-5-ext-2026-09-28`` (AMEX:SPY 5m, extended hours) carries V09
= ``ta.vwap`` and V08 = ``ta.vwap(close) - ta.vwap``, so TradingView's
``ta.vwap(close)`` is V08 + V09 on every bar. The capture's leading partial ET
session is left out (the vendor's sum started on bars before the capture). Both
lanes are held to the vendor, which holds them to each other.
"""
from __future__ import annotations

import json
import math
import pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import ast_interpret
from api.services.indicator_compute import compute_vwap_raw

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAP = json.loads((ROOT / "tests/fixtures/vendor/harness/vw-clock-vwap-spy-5-ext-2026-09-28.json")
                 .read_text(encoding="utf-8"))
ET = ZoneInfo("America/New_York")
TOL = 1e-6


def _bars():
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5] or 0}
            for r in CAP["bars"]["rows"]]


def _col(title):
    plot = next(p for p in CAP["study"]["plots"] if p["title"] == title)
    k = CAP["plotValues"]["fields"].index(plot["id"])
    return [row[k] for row in CAP["plotValues"]["rows"]]


BARS = _bars()
V08 = _col("V08_vwap_close_minus_vwap_CONTROL_NONZERO")
V09 = _col("V09_vwap_bare_RAW")


def _day(t):
    return datetime.fromtimestamp(t, ET).strftime("%Y-%m-%d")


FIRST_FULL = next(i for i, b in enumerate(BARS) if _day(b["t"]) != _day(BARS[0]["t"]))
TREE = {"type": "call", "name": "vwapOf", "args": [{"type": "series", "name": "close"}]}


def _worst(ours, vendor):
    worst, compared = 0.0, 0
    for i in range(FIRST_FULL, len(BARS)):
        if vendor[i] is None:
            continue
        compared += 1
        worst = max(worst, abs(ours[i] - vendor[i]))
    return compared, worst


def test_control_our_vwap_is_the_vendor_v09():
    compared, worst = _worst(compute_vwap_raw(BARS), V09)
    assert compared > 150
    assert worst < TOL


def test_vwap_of_close_is_v08_plus_v09_through_the_interpreter():
    vendor = [a + b if a is not None and b is not None else None for a, b in zip(V08, V09)]
    ours = ast_interpret.interpret(TREE, BARS)
    compared, worst = _worst(ours, vendor)
    assert compared > 150
    assert worst < TOL
    # non-vacuity: the close-weighted column differs from the typical-price one here
    assert sum(1 for i in range(FIRST_FULL, len(BARS)) if abs(V08[i]) > 1e-3) > 150


def test_a_non_finite_price_blanks_the_rest_of_its_session_only():
    ours = ast_interpret.interpret(TREE, BARS)
    holed_bars = [dict(b, c=float("nan")) if i == 3 else b for i, b in enumerate(BARS)]
    holed = ast_interpret.interpret(TREE, holed_bars)
    assert holed[2] is not None and math.isfinite(holed[2])
    assert all(holed[i] is None or math.isnan(holed[i]) for i in range(3, FIRST_FULL))
    assert holed[FIRST_FULL:] == pytest.approx(ours[FIRST_FULL:], abs=0)


def test_the_typical_price_default_is_unchanged():
    # every existing caller passes no price; the column must be the one it always was
    assert compute_vwap_raw(BARS) == compute_vwap_raw(BARS, None)
    assert ast_interpret.BAR_READERS and "vwapOf" in ast_interpret.BAR_READERS
