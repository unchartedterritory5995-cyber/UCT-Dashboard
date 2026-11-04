"""C48 / C45 -- ``meta.blockRuns`` in the Python lane, held to the JS lane's own
output.

A member pane attaches ONE document. Its chart's bind refuses a stamped plot
(``engine/blockRuns.js``) wherever the code the gate guards -- a ``ta.*`` written in
an ``if`` block, in one arm of a ``?:``, on the right of a Pine v6 ``and`` / ``or`` --
runs after a bar it skipped. The server's user-series alert and scan sweep evaluate
the same saved document with ``ast_interpret``; ``api/services/block_runs.py`` is the
twin that asks them the same question.

THE FIXTURE IS THE ONE AUTHORITY. ``blockRunsParity.test.js`` writes it from the JS
lane (the member door's own documents, the chart's own bind) and reads it back; this
file holds the Python lane to the same file, so a lane that drifts fails against the
OTHER LANE'S OWN OUTPUT rather than against a sentence retyped here.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai
from api.services import block_runs

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "block_runs_parity.json"


def _doc() -> dict:
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _nan(column):
    return [math.nan if v is None else v for v in column]


@pytest.mark.parametrize("case", _doc()["columns"], ids=lambda c: json.dumps(c["column"]))
def test_first_run_after_skip_is_the_js_lanes(case):
    want = case["expected"]
    got = block_runs.first_run_after_skip(_nan(case["column"]))
    assert (list(got) if got is not None else None) == want
    # `None` reads exactly as NaN does: neither a run nor a skip
    got_none = block_runs.first_run_after_skip(case["column"])
    assert (list(got_none) if got_none is not None else None) == want


@pytest.mark.parametrize("case", _doc()["cases"], ids=lambda c: c["name"])
def test_the_refusal_is_the_charts_own_sentence(case):
    doc = _doc()
    definition = case["definition"]
    inputs = aus._inputs_for(definition, None)

    def evaluate(guard):
        return ai.interpret(guard, doc["bars"], inputs=inputs)

    assert block_runs.block_runs_refusal(definition, case["key"], evaluate) == case["expected"]


def test_the_fixture_is_not_vacuous():
    doc = _doc()
    refused = [c for c in doc["cases"] if c["expected"]]
    drawn = [c for c in doc["cases"] if not c["expected"]]
    assert len(refused) >= 5 and len(drawn) >= 3
    # every drawn case is STAMPED -- the gate is there and the bars keep the plot
    assert all(c["definition"]["meta"].get("blockRuns") for c in drawn)
    words = " ".join(c["expected"] for c in refused)
    for phrase in ("that arm skips bar", "that right side skips bar", "the block skips bar"):
        assert phrase in words


def test_a_document_without_a_stamp_is_never_asked():
    asked = []
    assert block_runs.block_runs_refusal({"meta": {}}, "value", lambda t: asked.append(t) or [0, 1]) is None
    assert block_runs.block_runs_refusal(None, "value", lambda t: asked.append(t) or [0, 1]) is None
    stamped = {"meta": {"blockRuns": {"keys": [{"key": "value", "gates": [
        {"why": "W", "guard": {"type": "num", "value": 1}}]}]}}}
    assert block_runs.block_runs_refusal(stamped, "out2", lambda t: asked.append(t) or [0, 1]) is None
    assert asked == []
    assert block_runs.block_runs_refusal(stamped, "value", lambda t: [1, 1]) is None
    assert block_runs.block_runs_refusal(stamped, "value", lambda t: [1, 0, 1]) == (
        "W — on this chart the block skips bar 1 and runs again on bar 2, so its calls have not run on every bar")


def test_a_guard_that_cannot_be_evaluated_refuses_the_plot():
    stamped = {"meta": {"blockRuns": {"keys": [{"key": "value", "gates": [
        {"why": "W", "guard": {"type": "num", "value": 1}, "what": "that arm"}]}]}}}

    def boom(_tree):
        raise ai.TableRefusal("interpret:node", "too deep")

    got = block_runs.block_runs_refusal(stamped, "value", boom)
    assert got.startswith("W — and whether the block runs on every bar of this chart could not be computed (")


def test_the_scan_plot_key_is_the_documents_own():
    assert block_runs.scan_plot_key({"compute": {"ast": {}}, "plots": [{"key": "value", "style": "line"}]}) == "value"
    # an hlines guide is not data-bearing (`nativeRegistry.js::astPlotKey`)
    assert block_runs.scan_plot_key({"compute": {"ast": {}}, "plots": [
        {"key": "value", "style": "line"}, {"key": "lv", "style": "hlines"}]}) == "value"
    # two data-bearing plots and no trees: not decidable, never guessed
    assert block_runs.scan_plot_key({"compute": {"ast": {}}, "plots": [{"key": "a"}, {"key": "b"}]}) is None
    # a multi-tree document names its scan plot
    assert block_runs.scan_plot_key({"compute": {"ast": {}, "trees": {"a": {}, "b": {}}, "scanPlot": "b"},
                                     "plots": [{"key": "a"}, {"key": "b"}]}) == "b"
    assert block_runs.scan_plot_key({"compute": {"ast": {}, "trees": {"a": {}}}, "plots": [{"key": "a"}]}) is None
