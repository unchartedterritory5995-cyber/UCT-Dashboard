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


@pytest.fixture(autouse=True)
def _own_store(tmp_path, monkeypatch):
    """Each test's persisted capability sets live in its own store."""
    from api.services import user_definitions as svc
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    rt._reset_capability_cache()
    yield
    rt._reset_capability_cache()


def caps(body: str) -> set:
    return set(pc.capabilities_of(V5 + body))


# ─── the vocabulary ──────────────────────────────────────────────────────────

def test_the_vocabulary_is_core_plus_census_features_plus_objects_plus_runtime_only():
    assert pc.CAPABILITY_IDS == ({pc.CORE_ID} | set(pc.FEATURE_IDS) | set(pc.OBJ_IDS) | set(pc.COLLECTION_IDS)
                                 | set(pc.RUNTIME_ONLY_IDS))
    assert set(pc.COLLECTION_IDS) == {"collections:array", "collections:matrix", "collections:map"}
    assert set(pc.OBJ_IDS) == {"obj:line", "obj:label", "obj:box", "obj:table", "obj:linefill",
                               "obj:polyline", "obj:delete", "obj:getter", "obj:collection"}
    assert set(pc.RUNTIME_ONLY_IDS) == {"varip", "calc-bars", "realtime-state", "request-other"}
    assert pc.UNREADABLE not in pc.CAPABILITY_IDS


def test_the_census_reimports_the_detector_never_a_copy():
    from tools.pine_coverage import coverage_map as cm
    for name in ("strip_code", "FEATURES", "features_of", "conditional_ta_in", "join_continuations", "usage_of",
                 "version_of", "KEYWORD_FEATURE", "order_calls_in", "engine_order_calls", "METHOD_CALL_RX"):
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
    # C1: the collection namespaces, and generics through `<ns>.new<T>`
    ("var a = array.new_float()\n", {"collections:array"}),
    ("float[] a = na\n", {"collections:array", "typed-array"}),
    ("parts = str.split(s, ',')\n", {"collections:array"}),
    ("m = matrix.new<float>(2, 2)\n", {"collections:matrix", "generics"}),
    ("var mp = map.new<string, float>()\n", {"collections:map", "generics"}),
    ("var a = array.new<float>()\n", {"collections:array", "generics"}),
    # C2: wrapped lines are read as the logical line they continue
    ("f(a,\n  b) =>\n    ta.sma(a, b)\n", {"conditional-ta", "fn-multi"}),
    ("x = c\n  ? a\n  : b\n", {"ternary"}),
    ("x = c ?\n  a :\n  b\n", {"ternary"}),
    ("y = if c and\n   d\n    ta.sma(close, 3)\n", {"conditional-ta", "if-block"}),
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


def test_a_source_over_the_cap_is_UNREADABLE_in_constant_time():
    """B1/e: the detector never reads more than the runtime document's own cap."""
    assert pc.MAX_SOURCE_BYTES == rt.RUNTIME_MAX_DEFINITION_BYTES
    big = V5 + "x = close\n" * (pc.MAX_SOURCE_BYTES // 10)
    assert len(big.encode("utf-8")) > pc.MAX_SOURCE_BYTES
    assert pc.capabilities_of(big) == frozenset({pc.UNREADABLE})
    wide = V5 + "// " + "\u00e9" * (pc.MAX_SOURCE_BYTES // 2)      # under the cap in chars, over in bytes
    assert len(wide) < pc.MAX_SOURCE_BYTES < len(wide.encode("utf-8"))
    assert pc.capabilities_of(wide) == frozenset({pc.UNREADABLE})


#: C3: a source the repaint classifier cannot read (an unterminated string).
UNTERMINATED = V5 + "plot(close)\nx = 'abc\n"


def test_C3_a_source_the_repaint_classifier_refuses_is_UNREADABLE():
    from api.services import runtime_repaint
    assert runtime_repaint.runtime_repaint_of(UNTERMINATED)["ok"] is False
    assert pc.UNREADABLE in pc.capabilities_of(UNTERMINATED)


def test_C3_and_capability_admission_refuses_it_naming_only_unreadable(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    rt._reset_capability_cache(persisted=True)
    assert rt.capability_admitted(UNTERMINATED) == (False, ["unreadable"])
    assert rt.not_graded(UNTERMINATED)


def test_C2_a_continuation_line_at_top_level_is_not_a_block():
    assert "conditional-ta" not in caps("plot(a,\n     color = ta.sma(close, 3) > 0 ? color.red : na)\n")
    assert pc.join_continuations("a\n    b\n") == "a\n    b\n"           # a block, not a wrap
    assert pc.join_continuations("a = f(1,\n    2)\nb\n") == "a = f(1, 2)\nb\n"
    assert pc.join_continuations("a = c\n  ? 1\n  : 2\n") == "a = c ? 1 : 2\n"


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
        got = set(pc.capabilities_of(src))
        if got == {pc.UNREADABLE} and len(src.encode("utf-8")) > pc.MAX_SOURCE_BYTES:
            continue                       # over the cap: read as nothing, so admitted as nothing
        missing = set(want) - got
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


# ─── B1 (review 2026-11-13): the detector is LINEAR. One paid request must never freeze the pod. ───
# The regex it replaced (`COND_TA_RX`) took 15.3 s on the reported shape (200 lines of `x = if c`
# at indent 160, 33.8 KB) and 230 s on a 126 KB one; the `^\s*` rows took 56 s on 16 KB of blank
# lines. The two small cases run FIRST so a regression fails in under a second, not in minutes.
# Bound: the reported shapes 250 ms; every adversarial 128 KiB shape 1 s (measured locally at
# 0.02-0.3 s, the repaint classifier included; the headroom is for a slower CI runner).

import time  # noqa: E402

_H = "//@version=5\nindicator('x')\n"
_CAP = pc.MAX_SOURCE_BYTES


def _fill(unit):
    return (_H + unit * ((_CAP - len(_H)) // len(unit)))[:_CAP]


def _clock(src):
    best = None
    for _ in range(2):
        t0 = time.perf_counter()
        pc.capabilities_of(src)
        d = time.perf_counter() - t0
        best = d if best is None else min(best, d)
    return best


def test_B1_0_the_reported_shape_is_fast():
    src = _H + (" " * 160 + "x = if c\n") * 200
    assert 33000 < len(src) < 35000
    assert _clock(src) < 0.25


def test_B1_1_blank_lines_are_fast():
    assert _clock(_H + "\n" * 16000) < 0.25
    assert _clock(_H + (" " * 40 + "\n") * 400) < 0.25


def _deep():
    out, i = [_H], 0
    while sum(map(len, out)) < _CAP - 200:
        out.append(" " * (4 * (i % 40)) + ("x = if c\n" if i % 2 else "if close > open\n"))
        i += 1
    return "".join(out)


ADVERSARIAL = {
    "indent 160, x = if c": lambda: _fill(" " * 160 + "x = if c\n"),
    "deep nested headers": _deep,
    "repeated x = if c": lambda: _fill("x = if c\n"),
    "one long line": lambda: _H + "a" * (_CAP - len(_H)),
    "long spaced words": lambda: _fill("a b "),
    "nested brackets": lambda: _H + "(" * ((_CAP - len(_H)) // 2) + ")" * ((_CAP - len(_H)) // 2),
    "blank lines": lambda: _H + "\n" * (_CAP - len(_H)),
    "whitespace lines": lambda: _fill(" " * 60 + "\n"),
    "unclosed calls": lambda: _fill("f(a, b\n"),
    "tuple opens": lambda: _fill("[a, b\n"),
    "question marks": lambda: _fill("x = c ? a\n"),
    "function headers": lambda: _fill("f(a) =>\n"),
    "else chain": lambda: _fill("else\n    "),
    "wrapped continuation": lambda: _fill("x = a +\n   b\n"),
}


@pytest.mark.parametrize("name", list(ADVERSARIAL))
def test_B1_2_every_adversarial_128_KiB_source_is_bounded(name):
    src = ADVERSARIAL[name]()
    assert len(src.encode("utf-8")) <= _CAP
    assert _clock(src) < 1.0, name


def test_B1_3_it_scales_linearly():
    """4x the source, at most ~4x the time (a quadratic scan is 16x)."""
    small = _H + (" " * 160 + "x = if c\n") * 200
    big = _H + (" " * 160 + "x = if c\n") * 800
    assert _clock(big) < 8 * max(_clock(small), 0.002)
