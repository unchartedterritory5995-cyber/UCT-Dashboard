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
    # (two: the ratchet and F5's held level, both `var`s from the listing)
    assert len(PARITY_CASES) == len(doc["cases"]) - 2
    # F5 -- a hold-or-set state off the listing is withheld where its window saw no
    # set, and named; the bounded window (no Pine claim) draws its seed there
    held = cases["held level · off the listing"]
    assert "seed:held" in held["codes"]
    assert all(v is None for v in held["expected"][580:])
    bounded = cases["held level · the formula language's own document"]
    assert all(v == 0 for v in bounded["expected"][580:])
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


def _acc(body):
    return {"type": "call", "name": "accum",
            "args": [{"type": "num", "value": 0}, body, {"type": "num", "value": 250}]}


_SELF = {"type": "series", "name": "self"}
_CLOSE = {"type": "series", "name": "close"}
_TEST = {"type": "op", "name": ">", "args": [_CLOSE, {"type": "num", "value": 1}]}


def _tern(c, a, b):
    return {"type": "op", "name": "?:", "args": [c, a, b]}


def test_a_hold_or_set_state_is_the_js_lanes_shape_and_gate():
    """F5 (F6's leviathan class) -- ``holds_until_set`` / ``held_seed_switched_of``
    answer as ``interpret.js``'s twins do (``seedWarmup.test.js``, the same trees)."""
    assert ai.holds_until_set(_acc(_tern(_TEST, _CLOSE, _SELF)))
    assert ai.holds_until_set(_acc(_tern(_TEST, _SELF, _CLOSE)))
    assert ai.holds_until_set(_acc(_tern(_TEST, _CLOSE, {"type": "call", "name": "nz",
                                                           "args": [_SELF, {"type": "num", "value": 0}]})))
    assert not ai.holds_until_set(_acc(_SELF))
    assert not ai.holds_until_set(_acc(_CLOSE))
    assert not ai.holds_until_set(_acc(_tern(_TEST, _CLOSE, {"type": "op", "name": "*",
                                                               "args": [_SELF, {"type": "num", "value": 0.9}]})))
    assert not ai.holds_until_set(_acc(_tern(_TEST, _CLOSE, {"type": "offset", "value": 1, "args": [_SELF]})))
    assert not ai.holds_until_set(_acc(_tern({"type": "op", "name": "!=", "args": [_CLOSE, _SELF]}, _CLOSE, _SELF)))
    lane = ai.lane_opts_for({"meta": {"recurrenceOrigin": "pine"}})
    assert ai.held_seed_switched_of(lane)
    assert not ai.held_seed_switched_of(dict(lane, historyFromListing=True))
    assert not ai.held_seed_switched_of(dict(lane, heldSeedNested=True))
    assert not ai.held_seed_switched_of({"tf": "D"})
    assert "seed:held" in ai.CHART_CLOCK_WITHHELD_CODES
    assert "seed:held" not in ai.CHART_CLOCK_WHOLE


def test_a_reader_is_withheld_along_the_paths_that_hold_the_state():
    a = _acc(_tern(_TEST, _CLOSE, _SELF))
    read = {"type": "offset", "value": 3,
            "args": [{"type": "call", "name": "sma", "args": [a, {"type": "num", "value": 20}]}]}
    other = {"type": "call", "name": "sma", "args": [_CLOSE, {"type": "num", "value": 400}]}
    root = {"type": "op", "name": "+", "args": [read, other]}
    assert ai.path_reach(root, a) == 23
    assert ai.max_lookback(root) - ai.max_lookback(a) == 150
    assert ai.path_reach(a, a) == 0


def test_the_dependency_mask_reaches_a_held_state_along_its_own_paths():
    """``seedWarmup.test.js``'s twin: a reader beside a 400-bar window is withheld on
    the held state's own unknown bars, not 150 more (``path_reach``)."""
    doc = _doc()
    case = next(c for c in doc["cases"] if c["name"] == "held level · off the listing")
    lvl = case["ast"]
    assert ai.holds_until_set(lvl)
    root = {"type": "op", "name": "+",
            "args": [lvl, {"type": "call", "name": "sma", "args": [_CLOSE, {"type": "num", "value": 400}]}]}
    dep = ai.switched_dependency_mask(root, doc["bars"], {}, opts=case["opts"])
    unknown = [1 if v is None else 0 for v in case["expected"]]
    assert list(dep) == unknown
    assert sum(unknown) == 1 + 120


def test_a_running_total_and_a_seed_on_one_tree_name_one_code():
    """H6 x F5 -- ``ta.ema(ta.obv, 10)`` off the listing: the running total withholds the
    whole tree (``cum:window``) and the seed mask is not asked beside it."""
    doc = _doc()
    case = next(c for c in doc["cases"] if c["name"] == "ema of obv · off the listing")
    got, codes, withheld = _run(case, doc)
    assert all(v is None for v in got)
    assert "cum:window" in codes and "seed:window" not in codes
    assert withheld == 0
