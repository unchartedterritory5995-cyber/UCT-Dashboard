"""Pine's ``ta.mfi`` (``mfiPine``) in the PYTHON lane, pinned to the VENDOR'S numbers.

The JS lane is pinned to the same capture by
``app/src/components/chart/engine/ast/mfiPine.vendor.test.js`` -- one rule, one
shared fixture, two interpreters. Neither file compares a lane with the other
lane; each compares its lane with TradingView.

The capture reaches the symbol's FIRST bar, which is the only place the rule is
observable (it moves exactly one bar, bar n-1):

* ``tests/fixtures/vendor/harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json``
  Pine v5, NYSE:RDDT 1D, all 632 bars from listing. ``vpMid =
  compress(ta.sma(ta.mfi(hlc3, 11) * 0.5 + ta.mfi(hlc3, 19) * 0.5, 2), 0.7) / 2 + 50``,
  plotted as ``VP Bull = max(vpMid, 50)`` and ``VP Bear = min(vpMid, 50)``.

The rule, from TradingView's published source for ``ta.mfi``: ``ta.change(src)``
is ``na`` on bar 0 and both ``<= 0`` and ``>= 0`` are false there, so bar 0's
flow sits in BOTH sums and the first value is on bar ``length - 1``.
"""
import json
import math
from pathlib import Path

from api.services import ast_interpret

ROOT = Path(__file__).resolve().parent.parent
ARTEMIS = ROOT / "tests" / "fixtures" / "vendor" / "harness" / "artemis-oscillator-pro-rddt-1d-2026-09-28.json"


def _series(name):
    return {"type": "series", "name": name}


def _num(v):
    return {"type": "num", "value": v}


def _mfi(name, n):
    return {"type": "call", "name": name,
            "args": [_series("high"), _series("low"), _series("close"), _series("volume"), _num(n)]}


def _artemis():
    d = json.loads(ARTEMIS.read_text(encoding="utf-8"))
    assert d["history"]["startsAtBar0"] is True, "the first window is only observable from bar 0"
    rows = d["bars"]["rows"]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]

    def col(title):
        pid = next(p["id"] for p in d["study"]["plots"] if p["title"] == title)
        k = d["plotValues"]["fields"].index(pid)
        by_time = {r[0]: r[k] for r in d["plotValues"]["rows"]}
        return [by_time.get(r[0]) for r in rows]

    return bars, col("VP Bull"), col("VP Bear")


def _vp_mid(fast, slow):
    """The script's own arithmetic after the two MFIs, in plain Python."""
    def compress(x):
        n = (x / 100.0 - 0.5) * 2.0
        return 0.7 * 100.0 * (1.0 if n > 0 else -1.0) * math.pow(abs(n), 0.75)

    blend = [None if (a is None or b is None) else a * 0.5 + b * 0.5 for a, b in zip(fast, slow)]
    out = [None] * len(blend)
    for i in range(1, len(blend)):
        if blend[i] is not None and blend[i - 1] is not None:
            out[i] = compress((blend[i] + blend[i - 1]) / 2.0) / 2.0 + 50.0
    return out


def _close(a, b, rel=1e-12, abs_=1e-9):
    return abs(a - b) <= max(abs_, rel * abs(b))


def test_vp_bull_and_bear_match_the_vendor_on_every_bar_na_included():
    bars, bull, bear = _artemis()
    vp = _vp_mid(ast_interpret.interpret(_mfi("mfiPine", 11), bars, {}),
                 ast_interpret.interpret(_mfi("mfiPine", 19), bars, {}))
    compared = 0
    for i, v in enumerate(vp):
        for vendor, ours in ((bull[i], None if v is None else max(v, 50.0)),
                             (bear[i], None if v is None else min(v, 50.0))):
            assert (ours is None) == (vendor is None), (i, ours, vendor)
            if vendor is not None:
                assert _close(ours, vendor), (i, ours, vendor)
                compared += 1
    assert compared == 613 * 2
    assert vp[18] is None
    assert _close(min(vp[19], 50.0), 40.08191730469555)


def test_bar_n_minus_1_counts_bar_0_on_both_sides_and_bar_n_is_the_house_mfi():
    bars, _, _ = _artemis()
    pine = ast_interpret.interpret(_mfi("mfiPine", 19), bars, {})
    house = ast_interpret.interpret(_mfi("mfi", 19), bars, {})
    assert pine[17] is None and pine[18] is not None and house[18] is None
    tp = [(b["h"] + b["l"] + b["c"]) / 3.0 for b in bars]
    up = down = tp[0] * bars[0]["v"]
    for j in range(1, 19):
        if tp[j] > tp[j - 1]:
            up += tp[j] * bars[j]["v"]
        elif tp[j] < tp[j - 1]:
            down += tp[j] * bars[j]["v"]
    assert _close(pine[18], 100.0 - 100.0 / (1 + up / down), abs_=1e-12)
    for i in range(19, len(bars)):
        assert pine[i] == house[i], i


def test_by_hand_three_flat_bars_n_2():
    bars = [{"t": t, "o": c, "h": c, "l": c, "c": c, "v": v}
            for t, (c, v) in enumerate([(10.0, 1.0), (12.0, 1.0), (11.0, 2.0)])]
    pine = ast_interpret.interpret(_mfi("mfiPine", 2), bars, {})
    house = ast_interpret.interpret(_mfi("mfi", 2), bars, {})
    assert pine[0] is None
    assert pine[1] == 68.75          # up 10 + 12, down 10 (bar 0 on both sides)
    assert house[1] is None
    assert pine[2] == house[2] == 100.0 - 100.0 / (1 + 12.0 / 22.0)


def test_CONTROL_the_house_mfi_misses_bar_19():
    """Without this, every case above would pass if ``mfiPine`` were quietly
    pointed back at the house ``mfi``: the house column answers a bar later, so
    the vendor's bar-19 value has nothing to meet."""
    bars, _, bear = _artemis()
    vp = _vp_mid(ast_interpret.interpret(_mfi("mfi", 11), bars, {}),
                 ast_interpret.interpret(_mfi("mfi", 19), bars, {}))
    assert vp[19] is None and bear[19] is not None
