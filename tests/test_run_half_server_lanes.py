"""PARITY UNIT 1 (`objects`) -- a host document carrying a run half is read by every server lane through
its FORMULA, exactly as the same document without the run half is.

The chart pane draws a host document's lost drawings from its run half (``compute.runtimeObjects``,
engine 53; ``runHalfObjectRail.js``, the lost-drawings rule). That is CHART-PANE ONLY by construction:
the document stays ``compute.kind == "ast"``, and every server lane decides a document's lane by
``runtime_definitions.is_runtime`` alone. So a member's alert, scan or backtest on such a script keeps
reading the host formula it read before (a runtime document would be withheld by name while
``PINE_RUNTIME_SERVER_STAGE`` is dark). The client half of this rail is
``app/src/components/chart/builder/memberPane/runHalfLostDrawings.test.js`` (the door saves the host
document, its formula half byte for byte the pane-off member's).
"""
from __future__ import annotations

import copy
import math

import pytest

from api.services import alert_user_series as aus
from api.services import param_inputs
from api.services import runtime_definitions as rt
from api.services.screener import scan_evaluator, scan_runtime

SOURCE = ('//@version=5\nindicator("lost drawings", overlay = true)\nlen = input.int(3, "len")\n'
          'plot(ta.sma(close, len))\nif barstate.islast\n    line.new(bar_index - 1, low, bar_index, high)\n')
DEF_ID = "u_0123456789ab"
CLOSE = {"type": "series", "name": "close"}
TREE = {"type": "call", "name": "sma", "args": [CLOSE, {"type": "num", "value": 3}]}


def host(run_half: bool) -> dict:
    """A host (formula) document, with or without the run half the door mints beside it."""
    compute = {"kind": "ast", "ast": TREE}
    meta = {}
    if run_half:
        compute["runtimeObjects"] = {"source": SOURCE, "outputs": {"p": 0}, "sites": {"s1": "6:5"}}
        meta["pineSourceSha256"] = rt.source_hash(SOURCE)
    return {"id": DEF_ID, "inputs": [], "plots": [{"key": "p"}], "compute": compute, "meta": meta}


def bars(n=40):
    return [{"t": 20200101 + i, "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}
            for i in range(n)]


def test_a_run_half_document_is_not_a_runtime_document():
    assert rt.is_runtime(host(True)) is False
    assert aus.is_runtime_document(host(True)) is False
    # CONTROL: the reader answers yes for a runtime document
    assert rt.is_runtime({"compute": {"kind": "runtime", "source": SOURCE, "outputs": {"p": 0}}}) is True


def test_the_alert_lane_admits_it_as_a_formula_and_never_asks_the_server_lane(monkeypatch):
    def server_lane_asked(row):
        raise AssertionError("a run-half host document was sent to the runtime server lane")
    monkeypatch.setattr(aus, "_gate_server_lane", server_lane_asked)
    row = {"def_id": DEF_ID, "definition": host(True)}
    assert aus._gate_lane(row) is row["definition"]


def test_the_alert_lane_computes_its_formula_exactly_as_without_the_run_half():
    b = bars()
    with_half = aus._make_value_fn(DEF_ID, "p", host(True))
    without = aus._make_value_fn(DEF_ID, "p", host(False))
    col = with_half.column(b, {})
    assert col == without.column(b, {})
    assert len(col) == len(b)
    finite = [v for v in col if isinstance(v, float) and math.isfinite(v)]
    assert finite and finite[-1] == pytest.approx(sum(r["c"] for r in b[-3:]) / 3, abs=1e-9)
    assert aus.call_series(with_half, b, {}, tf="D", sym="AAPL") == aus.call_series(without, b, {}, tf="D", sym="AAPL")


def test_specialize_keeps_it_a_host_document_with_its_run_half():
    doc = host(True)
    special, why = param_inputs.specialize(doc, {"len": 5})
    assert why is None
    assert special["compute"]["kind"] == "ast"
    assert special["compute"].get("runtimeObjects") == doc["compute"]["runtimeObjects"]
    assert rt.is_runtime(special) is False


def test_the_scan_lane_files_it_as_a_formula(monkeypatch):
    def runtime_asked(definition):
        raise AssertionError("a run-half host document was filed as a runtime scan")
    monkeypatch.setattr(scan_runtime, "runtime_scan_spec", runtime_asked)
    # a scan is a 0/1 tree: `close > sma(close, 3)`
    cond = {"type": "op", "name": ">", "args": [CLOSE, TREE]}
    with_half, without = host(True), host(False)
    with_half["compute"]["ast"] = without["compute"]["ast"] = cond
    a = scan_evaluator._scannable_handle(copy.deepcopy(with_half))
    assert isinstance(a, str) and a
    assert a == scan_evaluator._scannable_handle(copy.deepcopy(without)), "filed under the formula's own hash"
