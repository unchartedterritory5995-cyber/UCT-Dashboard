"""F5 -- a recursive series seeded at the window, off the listing, in the Python
lane, held to the JS lane's own output.

TradingView runs ``ta.ema`` / ``ta.rma`` / ``ta.rsi`` / ``ta.atr`` / a MACD line /
the DMI legs from the symbol's first bar; a series that starts later seeds them at
ITS first bar. ``interpret.js::seedWarmupMask`` withholds each such bar from the
series' own decay; ``api/services/ast_seed_warmup.py`` is the port, reached through
``ast_interpret.interpret`` whenever a Pine document (``barIndexAbsolute``) is
evaluated off the listing -- which is every server lane (the scan sweep, a
user-series alert, the screen backtest: ``ast_interpret.lane_opts_for``).

THE FIXTURE IS THE ONE AUTHORITY. ``seedWarmup.test.js`` writes and reads the same
file, so a lane that drifts fails against the OTHER LANE'S OWN OUTPUT rather than
against a value retyped here.
"""
from __future__ import annotations

import io
import json
import pathlib

import pytest

from api.services import ast_interpret as ai
from api.services import ast_seed_warmup as sw

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "seed_warmup_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _run(case: dict, doc: dict):
    sink: dict = {}
    seed: dict = {}
    opts = dict(case.get("opts") or {}, chartClockSink=sink, seedWarmupSink=seed)
    got = ai.interpret(case["ast"], doc["bars"], {}, opts=opts)
    return got, sorted(sink), sum(seed.get("mask") or [])


def _reads_accum(tree) -> bool:
    stack = [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "call" and n.get("name") == "accum":
                return True
            stack.extend(n.get("args") or [])
    return False


#: ⛔ THE LISTING PASS IS THE CHART'S ALONE (C12w): a server lane never states
#: ``historyFromListing`` (it holds no listing date), so a ``var`` from the listing
#: has no Python counterpart to compare -- those cases pin the JS lane only.
PARITY_CASES = [c for c in _doc()["cases"]
                if not ((c.get("opts") or {}).get("historyFromListing") and _reads_accum(c["ast"]))]


@pytest.mark.parametrize("case", PARITY_CASES, ids=lambda c: c["name"])
def test_the_python_lane_reproduces_the_js_lane(case):
    doc = _doc()
    got, codes, withheld = _run(case, doc)
    expected = case["expected"]
    assert len(got) == len(expected)
    for i, (a, b) in enumerate(zip(got, expected)):
        if b is None:
            assert a is None, f"{case['name']} bar {i}: this lane produced {a} where the other withheld"
            continue
        assert a is not None, f"{case['name']} bar {i}: this lane produced nothing where the other produced {b}"
        assert abs(a - b) <= 1e-9 * max(1.0, abs(b)), f"{case['name']} bar {i}: {a} vs {b}"
    assert codes == case["codes"], case["name"]
    assert withheld == case["withheld"], case["name"]


def test_the_fixture_is_not_vacuous():
    doc = _doc()
    cases = {c["name"]: c for c in doc["cases"]}
    assert len(doc["bars"]) == 700
    # a seeded series is withheld off the listing, by name ...
    for k in ("ema 10", "rsi 14", "atr 14", "macd signal", "adx", "a ratchet reading atr"):
        c = cases[f"{k} · off the listing"]
        assert c["withheld"] > 0, k
        assert "seed:window" in c["codes"], k
    # a weekly read is withheld on its own bars by the nested evaluation, and named
    weekly = cases["weekly ema · off the listing"]
    assert "seed:window" in weekly["codes"]
    assert next(i for i, v in enumerate(weekly["expected"]) if v is not None) > 300
    # the listing cases that read a `var` are the chart's alone, and nothing else is skipped
    assert len(PARITY_CASES) == len(doc["cases"]) - 1
    # ... never from the listing, and never in a document that claims no Pine number
    for k in ("ema 10", "rsi 14", "keltner upper", "a ratchet reading atr"):
        assert cases[f"{k} · from the listing"]["withheld"] == 0, k
    for k in ("ema 10", "macd signal"):
        assert cases[f"{k} · the formula language's own document"]["withheld"] == 0, k
    # and a tree with no seed in it is untouched
    assert cases["sma alone · off the listing"]["withheld"] == 0


def test_the_server_lanes_reach_it_through_the_declaration_they_already_carry():
    """Every server lane hands a Pine document ``barIndexAbsolute`` (C45,
    ``lane_opts_for``) and never ``historyFromListing`` -- so the seed gate is
    open there with no key of its own to thread."""
    lane = ai.lane_opts_for({"meta": {"recurrenceOrigin": "pine"}})
    assert sw.seed_from_window_of(lane)
    assert not sw.seed_from_window_of(ai.lane_opts_for({"meta": {}}))
    assert not sw.seed_from_window_of(dict(lane, historyFromListing=True))
    assert "seed:window" in ai.CHART_CLOCK_WITHHELD_CODES
    assert "seed:window" not in ai.CHART_CLOCK_WHOLE
