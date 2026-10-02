"""H1 -- a RATCHET in the Python lane, held to the JS lane's own output.

A trailing stop (``up := close[1] > nz(up[1], up) ? max(up, nz(up[1], up)) : up``)
resets on a test that READS the stop. The translator admits it as a switched
recurrence and ``interpret.js::rangeSwitchedColumn`` decides it with the RANGE
window: a bar is published only where every earlier history gives one value.
``ast_interpret`` carries the same algorithm.

⛔ THE FIXTURE IS THE ONE AUTHORITY. ``ratchetRecurrence.test.js`` writes it
(``H1_RATCHET_WRITE=1``) and reads it, so a lane that drifts fails against the
OTHER LANE'S OWN OUTPUT rather than against a number retyped here.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "ratchet_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _bars(n: int) -> list:
    out = []
    for i in range(n):
        c = 100 + math.sin(i / 9) * 8 + i * 0.06 + 3 * math.sin(i / 2.7)
        out.append({"o": c - 0.3, "h": c + 0.8, "l": c - 0.8, "c": c, "v": 100000})
    return out


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got = ai.interpret(case["ast"], _bars(doc["bars"]), {}, opts=case.get("opts"))
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other produced nothing"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) <= 1e-9 * max(1.0, abs(b)), f"{case['name']} bar {i}: {a} vs {b}"


def test_the_fixture_is_not_vacuous():
    cases = {c["name"]: c["expected"] for c in _doc()["cases"]}
    up = cases["ratchet-up"]
    assert sum(1 for v in up if v is None) > 0
    assert sum(1 for v in up if v is not None) > 200
    assert {0, 1} <= set(v for v in cases["ratchet-reader"] if v is not None)


def test_the_range_join_is_sound_and_narrows():
    """The domain's own arithmetic, at the edges a ratchet reaches."""
    top = ai.RANGE_TOP
    # max(band, anything) is at least the band
    got = ai._r_call("max", [98.0, top])
    assert ai._r_is_range(got) and got.lo == 98.0 and got.na
    # nz(anything, 98) has no na left
    got = ai._r_call("nz", [top, 98.0])
    assert ai._r_is_range(got) and not got.na
    # a range that narrows to one number IS that number
    assert ai._r_norm(5.0, 5.0, False) == 5.0
    assert ai._r_join(5.0, 5.0) == 5.0
