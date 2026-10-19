"""The base drawing reads nothing after its session -- on synthetic bars, so it runs everywhere.

tests/test_base_draw_lab_parity.py checks lookahead on real bars but skips without the lab and
bars.db (so CI never runs it). This rail needs neither: every series of tests/flat_top_sweep.py
(24 seeded series, trends that end in bases plus random walks with bursts), at every session from
bar 220 on, is drawn on bars[:i+1], on the REAL rest of the series, and with 30 wild future bars
appended -- and all three answers must be identical. The sweep must contain drawings.
"""
import importlib.util
import json
import os

from api.services.pattern_engine import base_draw as BD

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_lookahead", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)


def _wild(b, n=30):
    c = b[-1]["c"]
    return b + [{"t": b[-1]["t"] + 1 + j, "o": c * 1.3, "h": c * 1.6, "l": c * 0.5, "c": c * 1.5, "v": 1e9}
                for j in range(n)]


def test_the_drawing_at_a_session_ignores_every_later_bar():
    seen = drawn = 0
    for s in range(SW.SERIES):
        bars = SW.series(s)
        for i in range(220, len(bars), 2):
            now = BD.base_drawing(bars[:i + 1], i)
            key = json.dumps(now, sort_keys=True)
            assert json.dumps(BD.base_drawing(bars, i), sort_keys=True) == key, (s, i)
            assert json.dumps(BD.base_drawing(_wild(bars[:i + 1]), i), sort_keys=True) == key, (s, i)
            seen += 1
            drawn += now is not None
    assert seen > 600 and drawn >= 10, (seen, drawn)
