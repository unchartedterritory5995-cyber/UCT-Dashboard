"""The inside-day drawing reads nothing after its session -- on synthetic bars, so it runs everywhere.

tests/test_inside_day_draw_lab_parity.py checks lookahead on real bars but skips without the lab and
bars.db (so CI never runs it). This rail needs neither: every series of tests/flat_top_sweep.py
(24 seeded series), at every session from bar 220 on, is drawn on bars[:i+1], on the REAL rest of the
series, with 30 wild bars up and with 30 crash bars appended -- and all four answers must be
identical. The sweep must contain drawings, including some from a prior session (age > 0).
"""
import importlib.util
import json
import os

from api.services.pattern_engine import inside_day_draw as ID

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flat_top_sweep_id_lookahead", os.path.join(_HERE, "flat_top_sweep.py"))
SW = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SW)


def _future(b, up, n=30):
    c = b[-1]["c"]
    if up:
        bar = {"o": c * 1.3, "h": c * 1.6, "l": c * 0.5, "c": c * 1.5}
    else:
        bar = {"o": c * 0.7, "h": c * 0.75, "l": c * 0.4, "c": c * 0.45}
    return b + [dict(bar, t=b[-1]["t"] + 1 + j, v=1e9) for j in range(n)]


def test_the_drawing_at_a_session_ignores_every_later_bar():
    seen = drawn = 0
    for s in range(SW.SERIES):
        bars = SW.series(s)
        for i in range(220, len(bars)):
            now = ID.inside_day_drawing(bars[:i + 1], i)
            key = json.dumps(now, sort_keys=True)
            assert json.dumps(ID.inside_day_drawing(bars, i), sort_keys=True) == key, (s, i)
            assert json.dumps(ID.inside_day_drawing(_future(bars[:i + 1], True), i), sort_keys=True) == key, (s, i)
            assert json.dumps(ID.inside_day_drawing(_future(bars[:i + 1], False), i), sort_keys=True) == key, (s, i)
            seen += 1
            drawn += now is not None
    assert seen > 1500 and drawn >= 20, (seen, drawn)
