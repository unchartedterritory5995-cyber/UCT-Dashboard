"""WS-I Part 2 (2026-11-13): the ONE Pine capability detector (`api/services/pine_capabilities.py`).

It over-declares and never under-declares, and its world is closed. A6 holds it to the coverage
census: for every script whose source this repo holds (the committed corpus and every vendor
capture), `capabilities_of` names at least what the census snapshot names
(`docs/pine/evidence/2026-11-13-capability-admission/census-capabilities.json`, written by
`tools/pine_coverage/capability_admission.py census` over all 679 corpus scripts plus the captures,
from `coverage_map.usage_of` and TradingView's reference inventory, not from the detector's regexes).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from api.services import pine_capabilities as pc
from api.services import runtime_definitions as rt

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "docs" / "pine" / "evidence" / "2026-11-13-capability-admission" / "census-capabilities.json"
VERDICTS_RT = ROOT / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"

V5 = "//@version=5\nindicator('x')\n"


def caps(body: str) -> set:
    return set(pc.capabilities_of(V5 + body))


# ─── the vocabulary ──────────────────────────────────────────────────────────

def test_the_vocabulary_is_core_plus_census_features_plus_objects_plus_runtime_only():
    assert pc.CAPABILITY_IDS == ({pc.CORE_ID} | set(pc.FEATURE_IDS) | set(pc.OBJ_IDS) | set(pc.RUNTIME_ONLY_IDS))
    assert set(pc.OBJ_IDS) == {"obj:line", "obj:label", "obj:box", "obj:table", "obj:linefill",
                               "obj:polyline", "obj:delete", "obj:getter", "obj:collection"}
    assert set(pc.RUNTIME_ONLY_IDS) == {"varip", "calc-bars", "realtime-state", "request-other"}
    assert pc.UNREADABLE not in pc.CAPABILITY_IDS


def test_the_census_reimports_the_detector_never_a_copy():
    from tools.pine_coverage import coverage_map as cm
    for name in ("strip_code", "FEATURES", "usage_of", "version_of", "KEYWORD_FEATURE", "COND_TA_RX",
                 "order_calls_in", "engine_order_calls", "METHOD_CALL_RX"):
        assert getattr(cm, name) is getattr(pc, name), name
    src = (ROOT / "tools" / "pine_coverage" / "coverage_map.py").read_text(encoding="utf-8")
    assert "\nFEATURES = [" not in src and "\ndef strip_code(" not in src and "\ndef usage_of(" not in src


def test_the_server_import_never_reads_the_front_end_order_set():
    """`strategy_orders` is lazy: importing the detector opens no front-end file."""
    import importlib
    import sys
    sys.modules.pop("api.services.pine_capabilities", None)
    fresh = importlib.import_module("api.services.pine_capabilities")
    assert fresh.strategy_orders.cache_info().currsize == 0
    assert fresh.capabilities_of(V5 + "plot(close)\n") == frozenset({"core"})
    assert fresh.strategy_orders.cache_info().currsize == 0


# ─── what it declares ────────────────────────────────────────────────────────

@pytest.mark.parametrize("body,want", [
    ("plot(close)\n", {"core"}),
    ("var float x = na\nx := close\nplot(x)\n", {"core", "var", "reassign"}),
    ("x = close > open ? 1 : 0\nplot(x)\n", {"core", "ternary"}),
    ("l = line.new(bar_index, low, bar_index, high)\n", {"obj:line"}),
    ("var label lb = na\n", {"obj:label"}),
    ("b = box.new(0, 1, 2, 0)\nb.delete()\n", {"obj:box", "obj:delete"}),
    ("t = table.new(position.top_right, 1, 1)\n", {"obj:table"}),
    ("lf = linefill.new(l1, l2, color.red)\n", {"obj:linefill"}),
    ("p = polyline.new(pts)\n", {"obj:polyline"}),
    ("y = myLine.get_y1()\n", {"obj:getter", "method-call"}),
    ("var lines = array.new_line()\n", {"obj:collection", "obj:line"}),
    ("var a = array.new<box>()\n", {"obj:collection", "obj:box"}),
    ("for l in line.all\n    line.delete(l)\n", {"obj:collection", "obj:delete", "for-in"}),
    ("varip int n = 0\nn += 1\n", {"varip", "compound-assign"}),
    ("x = request.security(syminfo.tickerid, timeframe.period, close)\n", {"request-other"}),
    ("x = request.security('SPY', 'W', close)\n", {"request-other"}),
    ("plot(barstate.isconfirmed ? close : na)\n", {"realtime-state"}),
    ("plot(timenow)\n", {"realtime-state"}),
])
def test_it_declares_at_least(body, want):
    got = caps(body)
    assert want <= got, sorted(want - got)


def test_calc_bars_count_is_declared():
    assert "calc-bars" in pc.capabilities_of("//@version=5\nindicator('x', calc_bars_count=50)\nplot(close)\n")


@pytest.mark.parametrize("body", [
    "// line.new(0, 0, 1, 1) in a comment\nplot(close)\n",
    "plot(close, title='line.new label.new box.delete()')\n",
    "plot(close, style=plot.style_linebr)\n",
    "hline(50, linestyle=hline.style_dashed)\nplot(close)\n",
    "plotshape(close > open, style=shape.labelup)\n",
    "plot(barstate.isfirst and close > open)\n",
])
def test_comments_strings_and_lookalike_words_declare_nothing_extra(body):
    """Over-declaring is safe, but these are not uses, and a word inside a string or a
    `style_line` must not withhold a plain script."""
    assert caps(body) == {"core"}, sorted(caps(body))


@pytest.mark.parametrize("source", [None, "", "   \n", 42])
def test_an_unreadable_source_is_UNREADABLE_never_empty(source):
    assert pc.capabilities_of(source) == frozenset({pc.UNREADABLE})


def test_the_repaint_classifiers_reads_reach_the_runtime_only_ids():
    """`realtime-state` / `request-other` / `varip` also come from the repaint classifier's own
    reads (derived from its rule table): a read it names past the run's bar is never silent."""
    got = pc.capabilities_of(V5 + "x = request.financial('NASDAQ:AAPL', 'EPS', 'FQ')\nplot(x)\n")
    assert "request-other" in got


def test_the_method_call_namespaces_are_never_wider_than_the_census():
    """A namespace here the census inventory lacks would let `capabilities_of` miss a
    `method-call` the census finds. Its subset of the measured inventory set is the rule."""
    measured = {"array", "box", "color", "input", "label", "line", "log", "map", "math", "matrix",
                "polyline", "request", "session", "str", "strategy", "syminfo", "ta", "table",
                "ticker", "timeframe"}
    assert pc.BUILTIN_NAMESPACES <= measured
    assert "method-call" in caps("x = myObject.compute(close)\n")
    assert "method-call" not in caps("x = ta.sma(close, 14)\n")


# ─── A6: never fewer than the census ─────────────────────────────────────────

def _sources_in_repo():
    """Every Pine source this repo holds: the committed corpus and the vendor captures."""
    out = {}
    for f in sorted((ROOT / "corpus" / "committed").glob("*.pine")):
        out["committed:" + f.stem] = f.read_text(encoding="utf-8")
    for r in json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"]:
        try:
            d = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        text = (d.get("source") or {}).get("text") if isinstance(d, dict) else None
        if isinstance(text, str) and text.strip():
            out["capture:" + r["id"]] = text
    return out


def _under_declared(census: dict, sources: dict) -> dict:
    gaps = {}
    for key, src in sources.items():
        want = census.get(rt.source_hash(src))
        if want is None:
            continue
        missing = set(want) - set(pc.capabilities_of(src))
        if missing:
            gaps[key] = sorted(missing)
    return gaps


def test_A6_the_detector_never_under_declares_against_the_census():
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert snap["populations"] == {"builtin": 142, "capture": 353, "committed": 266, "reference": 271}
    census = snap["census"]
    assert len(census) == snap["distinct"] >= 679
    sources = _sources_in_repo()
    checked = [k for k, s in sources.items() if rt.source_hash(s) in census]
    assert len([k for k in checked if k.startswith("committed:")]) == 266
    assert len([k for k in checked if k.startswith("capture:")]) >= 300
    gaps = _under_declared(census, sources)
    assert gaps == {}, gaps


def test_A6_the_rail_can_fail():
    """CONTROL: a census entry naming a capability the source does not show is caught."""
    src = (ROOT / "corpus" / "committed" / "adx-and-di-for-v4__932.pine").read_text(encoding="utf-8")
    fake = {rt.source_hash(src): ["core", "obj:box"]}
    assert _under_declared(fake, {"x": src}) == {"x": ["obj:box"]}


def test_A6_every_census_id_is_in_the_vocabulary():
    census = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["census"]
    assert set().union(*map(set, census.values())) <= pc.CAPABILITY_IDS
    assert not re.search(r'"text"\s*:', SNAPSHOT.read_text(encoding="utf-8"))   # hashes only, no source
