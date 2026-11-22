"""e95 unit 2 -- the anchored VWAP (``vwapAnchor`` / ``vwapAnchorDev``): the Python twin is the JS lane's arithmetic.

Pine's anchored ``ta.vwap(source, anchor[, stdev_mult])`` is TradingView's published ``computeVWAP``: sums from each
bar the anchor fires, ``na`` before the first, an ``na`` term poisoning the sums to the next reset. The JS columns
(``interpret.js::FN.vwapAnchor`` / ``vwapAnchorDev``, the runtime's ``CARRIED2.vwapAnchorPine``) and this lane
(``ast_interpret._vwap_anchor_col``) must give one number, bar for bar, on the committed RDDT bars and on a long
synthetic series (the sums run from the RESET, so a long history must not move a value).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

from api.services import ast_interpret

ROOT = Path(__file__).resolve().parent.parent
RDDT = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json"
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402


def _bars():
    rows = json.loads(RDDT.read_text(encoding="utf-8"))["bars"]["rows"]
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def _long_bars(n=6000):
    """A long synthetic series: prices near 1e4 and volumes near 1e8, so sums from the series start would lose
    digits a sum from the reset keeps."""
    out, px = [], 10000.0
    for i in range(n):
        o = px * (1 + 0.004 * math.sin(i * 0.37))
        px = o * (1 + 0.006 * math.cos(i * 0.11))
        out.append({"t": 1_500_000_000 + i * 86400, "o": o, "h": max(o, px) * 1.003, "l": min(o, px) * 0.997, "c": px,
                    "v": 1e8 * (1.5 + math.sin(i * 0.05))})
    return out


def S(name):
    return {"type": "series", "name": name}


def N(v):
    return {"type": "num", "value": v}


def C(name, *args):
    return {"type": "call", "name": name, "args": list(args)}


def O(name, *args):
    return {"type": "op", "name": name, "args": list(args)}


HLC3 = O("/", O("+", O("+", S("high"), S("low")), S("close")), N(3))
ANCHOR = C("crossOver", S("close"), C("sma", S("close"), N(20)))


def _by_hand(bars, anchor, dev=False):
    """The published body, written out: sums from each reset, ``na`` before the first."""
    out, spv, sv, sppv = [], math.nan, math.nan, math.nan
    for b, a in zip(bars, anchor):
        p = (b["h"] + b["l"] + b["c"]) / 3
        v = b["v"]
        if a == a and a != 0:
            spv, sv, sppv = p * v, v, v * (p * p)
        else:
            spv, sv, sppv = p * v + spv, v + sv, v * (p * p) + sppv
        vwap = spv / sv if sv > 0 else math.nan
        if not dev:
            out.append(vwap)
            continue
        var = sppv / sv - vwap * vwap if sv > 0 else math.nan
        out.append(math.sqrt(0.0 if var < 0 else var) if var == var else math.nan)
    return out


def _same(got, want):
    assert len(got) == len(want)
    for i, (g, w) in enumerate(zip(got, want)):
        if w != w:
            assert g != g, (i, g)
        else:
            assert g == w, (i, g, w)


@pytest.mark.parametrize("bars_of", [_bars, _long_bars], ids=["rddt", "long"])
def test_the_twin_is_the_published_body_bit_for_bit(bars_of):
    bars = bars_of()
    hlc3 = [(b["h"] + b["l"] + b["c"]) / 3 for b in bars]
    vol = [b["v"] for b in bars]
    anchor = [1.0 if i % 37 == 5 else 0.0 for i in range(len(bars))]
    _same(ast_interpret.FN["vwapAnchor"](hlc3, anchor, vol), _by_hand(bars, anchor))
    _same(ast_interpret.FN["vwapAnchorDev"](hlc3, anchor, vol), _by_hand(bars, anchor, dev=True))


def test_na_before_the_first_anchor_and_an_na_term_poisons_to_the_next_reset():
    src = [1.0, 2.0, 3.0, math.nan, 5.0, 6.0, 7.0]
    vol = [1.0] * 7
    anchor = [0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    got = ast_interpret.FN["vwapAnchor"](src, anchor, vol)
    assert got[0] != got[0]                                  # before the first anchor
    assert got[1] == 2.0 and got[2] == 2.5                   # from the reset
    assert all(v != v for v in got[3:5])                     # poisoned by the na term
    assert got[5] == 6.0 and got[6] == 6.5                   # the next reset clears it


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
@pytest.mark.parametrize("bars_of", [_bars, _long_bars], ids=["rddt", "long"])
def test_js_and_python_lanes_agree(bars_of):
    bars = bars_of()
    cases = [
        {"id": "vwap_anchor", "ast": C("vwapAnchor", HLC3, ANCHOR, S("volume"))},
        {"id": "vwap_anchor_dev", "ast": C("vwapAnchorDev", HLC3, ANCHOR, S("volume"))},
        {"id": "vwap_anchor_close", "ast": C("vwapAnchor", S("close"), ANCHOR, S("volume"))},
    ]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    verdict = ac.compare_lanes(js, py)
    assert verdict["differences"] == [], verdict["differences"][:5]
    for c in cases:
        assert sum(1 for v in py[c["id"]] if v is not None) > 100, c["id"]


# ─── THE HAZARD RULING (coordinator, 2026-11-22): its own class, served per bar from the first in-window anchor ───

def _synthetic(n=80):
    """``vwapAnchored.test.js``'s bars: ``close < 95`` first fires on bar 9."""
    t0 = 1704153600
    return [{"t": t0 + i * 86400, "o": 100 + math.sin(i * 0.4) * 5,
             "h": 106 + math.sin(i * 0.4) * 5 + (i % 3), "l": 95 + math.sin(i * 0.4) * 5 - (i % 2),
             "c": 100 + math.cos(i * 0.3) * 6, "v": 1000 + ((i * 7919) % 613)} for i in range(n)]


LOW_ANCHOR = O("<", S("close"), N(95))


def test_the_anchored_sums_are_their_own_class_not_a_running_total():
    from api.services import ast_bar_index_shift as bis
    assert bis.ANCHOR_RESET_CALLS == ("vwapAnchor", "vwapAnchorDev")
    assert bis.RUNNING_TOTAL_CALLS == ("cum",)
    assert not bis.reads_running_total(C("vwapAnchor", HLC3, LOW_ANCHOR, S("volume")))


@pytest.mark.parametrize("name,dev", [("vwapAnchor", False), ("vwapAnchorDev", True)])
def test_off_the_listing_served_from_the_first_in_window_anchor_and_withheld_by_name_before_it(name, dev):
    bars = _synthetic()
    first = next(i for i, b in enumerate(bars) if b["c"] < 95)
    assert first == 9
    anchor = [1.0 if b["c"] < 95 else 0.0 for b in bars]
    want = _by_hand(bars, anchor, dev=dev)
    sink: dict = {}
    got = ast_interpret.interpret(C(name, HLC3, LOW_ANCHOR, S("volume")), bars,
                                  opts={"historyFromListing": False, "barIndexAbsolute": True, "chartClockSink": sink})
    assert got[:first] == [None] * first
    _same([math.nan if v is None else v for v in got[first:]], want[first:])
    assert sorted(sink) == [ast_interpret.VWAP_BEFORE_FIRST_ANCHOR]
    assert "running-total:window" not in sink


def test_nz_of_the_vwap_and_its_own_history_are_withheld_until_the_read_reaches_the_anchor():
    """``nz(v) - nz(v[5])``: never served by the additive-constant algebra, never drawn from the bars before it."""
    bars = _synthetic()
    v = C("vwapAnchor", HLC3, LOW_ANCHOR, S("volume"))
    tree = O("-", C("nz", v, N(0)), C("nz", {"type": "offset", "value": 5, "args": [v]}, N(0)))
    sink: dict = {}
    got = ast_interpret.interpret(tree, bars, opts={"historyFromListing": False, "barIndexAbsolute": True,
                                                    "chartClockSink": sink})
    assert got[:14] == [None] * 14
    assert all(g is not None for g in got[14:])
    assert ast_interpret.VWAP_BEFORE_FIRST_ANCHOR in sink


def test_from_the_listing_nothing_is_named():
    bars = _synthetic()
    sink: dict = {}
    got = ast_interpret.interpret(C("vwapAnchor", HLC3, LOW_ANCHOR, S("volume")), bars,
                                  opts={"historyFromListing": True, "barIndexAbsolute": True, "chartClockSink": sink})
    assert sink == {}
    assert got[:9] == [None] * 9 and got[9] is not None
