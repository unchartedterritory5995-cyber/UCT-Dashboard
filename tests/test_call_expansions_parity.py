"""BATCH 2 -- the server's mirror of the exact-identity formula functions builds the SAME
trees as the browser's authority (``callExpansions.js``), byte for byte, and the converse
door checks a model's ``linreg`` call as the tree the browser stores.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from api.services import call_expansions as ce
from tests.test_p2_truth_server import (  # noqa: F401  (pytest fixtures by import)
    RSI_GT_70, conv, emits, env, model, out, view,
)

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "app/src/components/chart/engine/ast/callExpansions.js").as_uri()

CLOSE = {"type": "series", "name": "close"}
SPY = {"type": "sym", "value": "SPY", "args": [CLOSE]}
HL2 = {"type": "op", "name": "/", "args": [
    {"type": "op", "name": "+", "args": [{"type": "series", "name": "high"}, {"type": "series", "name": "low"}]},
    {"type": "num", "value": 2}]}


def n(v):
    return {"type": "num", "value": v}


CASES = [
    ("roc", [CLOSE, n(10)]), ("roc", [HL2, n(1)]),
    ("mom", [CLOSE, n(10)]),
    ("vwma", [CLOSE, n(20)]), ("vwma", [HL2, n(3)]),
    ("linreg", [CLOSE, n(50)]), ("linreg", [CLOSE, n(50), n(0)]), ("linreg", [CLOSE, n(20), n(3)]),
    ("linreg", [CLOSE, n(2), n(5)]), ("linreg", [CLOSE, n(7), n(1.5)]), ("linreg", [CLOSE, n(200), n(0)]),
    ("correlation", [CLOSE, SPY, n(20)]), ("correlation", [CLOSE, {"type": "series", "name": "volume"}, n(2)]),
    ("kcMiddle", [CLOSE, n(20)]), ("kcUpper", [CLOSE, n(20), n(2)]), ("kcLower", [CLOSE, n(20), n(1.5)]),
    # declined (null) in both lanes
    ("linreg", [CLOSE, n(1)]), ("linreg", [CLOSE, {"type": "series", "name": "len"}]),
    ("vwma", [CLOSE, n(2.5)]), ("correlation", [CLOSE, SPY, n(1)]), ("roc", [CLOSE, n(0)]),
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_two_lanes_build_byte_identical_trees():
    script = (f"import {{ expandCall }} from {json.dumps(JS)};"
              f"const C = {json.dumps(CASES)};"
              "process.stdout.write(JSON.stringify(C.map(([name, args]) => expandCall({type: 'call', name, args}))))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    browser = json.loads(res.stdout)
    server = [ce.expand_call({"type": "call", "name": name, "args": args}) for name, args in CASES]
    assert json.dumps(server, sort_keys=True) == json.dumps(browser, sort_keys=True)
    assert sum(1 for t in server if t is None) == 5     # the declined cases are declined in both


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_two_lanes_name_the_same_functions_and_signatures():
    script = (f"import {{ CALL_EXPANSIONS }} from {json.dumps(JS)};"
              "process.stdout.write(JSON.stringify(Object.entries(CALL_EXPANSIONS).map(([k, v]) => [k, v.min, v.max, v.signature])))")
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    assert json.loads(res.stdout) == [[k, v[0], v[1], v[2]] for k, v in ce.CALL_EXPANSIONS.items()]


def test_nested_expansion_and_the_declared_guard():
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "call", "name": "linreg", "args": [CLOSE, n(50), n(0)]}]}
    expanded = ce.expand_calls(tree)
    names = []

    def walk(t):
        if isinstance(t, dict):
            if t.get("type") == "call":
                names.append(t["name"])
            for a in t.get("args") or []:
                walk(a)
    walk(expanded)
    assert "linreg" not in names and {"sum", "wma"} <= set(names)
    assert ce.expand_calls(tree, lambda name: name == "linreg") is tree
    with pytest.raises(ce.ExpansionRefused) as exc:
        ce.expand_calls({"type": "call", "name": "linreg", "args": [CLOSE, n(1)]})
    assert exc.value.guard == "resolve:expansion" and "at least 2" in str(exc.value)


def test_the_converse_door_admits_and_checks_a_linreg_call(conv, model):
    """ASKED: a change whose tree calls linreg. CLAIMED: the schema admits the name, the
    server checks the expansion (budget / lint pass), the change is accepted. DID."""
    tree = {"type": "op", "name": ">", "args": [CLOSE, {"type": "call", "name": "linreg", "args": [CLOSE, n(50), n(0)]}]}
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": tree}]))])
    r = conv.converse("make it close above its 50-bar linear regression", user_id="u1",
                      view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is True and r["disposition"] == "change", r
    enum = conv.composed_schema()["$defs"]["call"]["properties"]["name"]["enum"]
    assert {"linreg", "correlation", "vwma", "roc", "mom", "kcUpper", "kcLower", "kcMiddle"} <= set(enum)


def test_the_converse_door_refuses_an_unusable_length_by_name(conv, model):
    bad = {"type": "call", "name": "linreg", "args": [CLOSE, n(1)]}
    model([emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": bad}])),
           emits(env(1, [{"op": "set_output_tree", "output": "value", "tree": bad}]))])
    r = conv.converse("use a 1-bar regression", user_id="u1", view=view(1, [out("value", RSI_GT_70)]))
    assert r["ok"] is False and r["gate"] == "resolve:expansion", r


# --------------------------------------------------------------------------- #
# the VALUES agree across the two interpreters (the frozen corpus bars)
# --------------------------------------------------------------------------- #

import sys  # noqa: E402

if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
def test_browser_and_server_compute_the_same_values_for_every_expansion():
    bars = ac.corpus_bars()
    calls = [
        ("linreg_50", "linreg", [CLOSE, n(50), n(0)]),
        ("linreg_20_3", "linreg", [CLOSE, n(20), n(3)]),
        ("correlation_close_volume_20", "correlation", [CLOSE, {"type": "series", "name": "volume"}, n(20)]),
        ("vwma_20", "vwma", [CLOSE, n(20)]),
        ("roc_10", "roc", [CLOSE, n(10)]),
        ("mom_10", "mom", [CLOSE, n(10)]),
        ("kc_upper", "kcUpper", [CLOSE, n(20), n(2)]),
        ("kc_lower", "kcLower", [CLOSE, n(20), n(1.5)]),
    ]
    cases = [{"id": cid, "ast": ce.expand_call({"type": "call", "name": name, "args": args})}
             for cid, name, args in calls]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    verdict = ac.compare_lanes(js, py)
    assert verdict["differences"] == [], verdict["differences"][:5]
    for cid, _, _ in calls:     # non-vacuity: real numbers, in both lanes
        assert sum(1 for v in py[cid] if v is not None) > len(bars) // 2, cid
