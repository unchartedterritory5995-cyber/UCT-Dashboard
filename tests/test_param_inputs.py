"""SETTINGS PARITY (2a): the server lanes compute a folded Pine parameter at the instance's value.

Reads ``tests/fixtures/ast/param_inputs_parity.json``, written by the JS lane
(``app/src/components/chart/engine/paramInputs.test.js``, PARAM_INPUTS_PARITY_WRITE=1):
  P1 the same settings are declared from the same stored document;
  P2 every settings case specialises to the same trees, or is refused with the same sentence;
  P3 the chart and the alert agree at a NON-default value: the chart's column (JS lane) equals
     the alert lane's column for the same document, bars and ``params_json``;
  P4 CONTROL: at the default the alert lane's column differs from the chart's non-default one
     (the rail can see a wrong alert), and a refused value answers no number, never a value.
"""
from __future__ import annotations

import json
import math
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret
from api.services import param_inputs as pi

REPO = pathlib.Path(__file__).resolve().parents[1]
FIX = json.loads((REPO / "tests" / "fixtures" / "ast" / "param_inputs_parity.json").read_text(encoding="utf-8"))


def _norm(spec):
    return {k: spec.get(k) for k in ("key", "label", "type", "default", "min", "max", "step", "fromParam")}


def test_P1_the_same_settings_are_declared():
    got = [_norm(s) for s in pi.param_input_specs(FIX["stored"])]
    assert got == [_norm(s) for s in FIX["specs"]]
    assert got and got[0]["key"].startswith("param")


@pytest.mark.parametrize("case", FIX["cases"], ids=lambda c: json.dumps(c["params"]))
def test_P2_each_case_specialises_to_the_same_trees_or_is_refused_alike(case):
    special, why = pi.specialize(FIX["stored"], case["params"])
    if "refused" in case:
        assert special is None and why == case["refused"]
        return
    assert why is None
    compute = special["compute"]
    assert json.loads(json.dumps(compute["ast"])) == case["ast"]
    assert json.loads(json.dumps(compute.get("trees"))) == case["trees"]


def _bars():
    return [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for b in FIX["chart"]["bars"]]


def _alert_column(params):
    """The alert lane's own evaluation path (`alert_user_series` per-plot column)."""
    chart = FIX["chart"]
    definition = FIX["stored"]
    trees = definition["compute"].get("trees") or {}
    tree_key = chart["treeKey"] if chart["treeKey"] in trees else None
    special, why = pi.specialize(definition, params)
    if why:
        return None
    sc = special["compute"]
    tree = sc["trees"][tree_key] if tree_key is not None else sc["ast"]
    out = ast_interpret.interpret(tree, _bars(), inputs=aus._inputs_for(definition, params),
                                  budget=definition["compute"].get("budget"))
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in out]


def _close(a, b):
    assert len(a) == len(b)
    for i, (x, y) in enumerate(zip(a, b)):
        if x is None or y is None:
            assert x is None and y is None, (i, x, y)
        else:
            assert abs(x - y) <= 1e-9 * max(1.0, abs(x)), (i, x, y)


def test_P3_the_chart_and_the_alert_agree_at_a_non_default_value():
    chart = FIX["chart"]
    got = _alert_column(chart["params"])
    _close(got, chart["column"])
    assert sum(1 for v in got if v is not None) > 50   # not vacuous


def test_P4_the_rail_can_see_a_wrong_alert_and_a_refused_value_answers_nothing():
    chart = FIX["chart"]
    at_default = _alert_column({})
    with pytest.raises(AssertionError):
        _close(at_default, chart["column"])
    key = FIX["specs"][0]["key"]
    assert _alert_column({key: 500}) is None
    special, why = pi.specialize(FIX["stored"], {key: 500})
    assert special is None and "must be at most" in why


def test_P5_an_alert_label_names_the_length_its_chart_set():
    definition = FIX["stored"]
    key = FIX["specs"][0]["key"]
    a = aus._instance_label(definition, "u_param2a", {key: 30})
    b = aus._instance_label(definition, "u_param2a", {})
    assert a != b and "30" in a and "14" in b


# ─── ⭐⭐ P6 A SAVED COPY: A NULL `treeIndex` NAMES THE SCAN PLOT'S TREE (2026-11-18) ──────────────────────────
# A saved Pine copy reads back as a shared graph whose hydration names the scan plot's locators `treeIndex: null`;
# a multi-tree document runs its scan plot from `trees[scanPlot]`. Mirrors `paramInputs.js::specializeParams`
# (railed there and in rsSavedCopySettings.test.js). Here on a JSON-loaded document, where `ast` and
# `trees[scanPlot]` are two equal objects (a materialised graph aliases them; nothing else does).

def _saved_copy_shape():
    import copy
    d = copy.deepcopy(FIX["stored"])
    c = d["compute"]
    scan = c.get("scanPlot") or "value"
    c["scanPlot"] = scan
    c["ast"] = copy.deepcopy(c["trees"][scan])
    for entry in c["paramManifest"].values():
        for loc in entry["locators"]:
            if loc.get("treeIndex") == scan:
                loc["treeIndex"] = None
    return d, scan


def test_P6_a_null_locator_writes_the_scan_plots_tree_too():
    d, scan = _saved_copy_shape()
    key = pi.param_input_specs(d)[0]["key"]
    entry = next(iter(d["compute"]["paramManifest"].values()))
    loc = next(l for l in entry["locators"] if l.get("treeIndex") is None)
    special, why = pi.specialize(d, {key: 30})
    assert why is None
    from api.services.param_manifest import _literal_value, _walk
    path = list(loc["astPath"])
    assert _literal_value(_walk(special["compute"]["ast"], path)) == 30
    assert _literal_value(_walk(special["compute"]["trees"][scan], path)) == 30, "the scan plot's own tree stayed at the default"


def test_P6_control_a_scan_tree_holding_another_literal_is_never_written_blind():
    d, scan = _saved_copy_shape()
    key = pi.param_input_specs(d)[0]["key"]
    entry = next(iter(d["compute"]["paramManifest"].values()))
    path = list(next(l for l in entry["locators"] if l.get("treeIndex") is None)["astPath"])
    from api.services.param_manifest import _literal_value, _walk
    _walk(d["compute"]["trees"][scan], path)["value"] = 99
    special, why = pi.specialize(d, {key: 30})
    assert why is None
    assert _literal_value(_walk(special["compute"]["ast"], path)) == 30
    assert _literal_value(_walk(special["compute"]["trees"][scan], path)) == 99
