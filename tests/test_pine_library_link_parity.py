"""U15 -- a library the member door linked is evaluated by the server lanes exactly as the chart
draws it, held to the JS lane's own output.

The alert and scan lanes evaluate a saved host document's trees with ``ast_interpret`` and never
read a library store: the member door splices the library's code into the trees. THE FIXTURE IS THE
ONE AUTHORITY: ``app/src/components/chart/engine/__tests__/libraryLinkParity.test.js`` writes it
from the member door's own documents and the chart's own bind; this file holds the Python lane to
it, for the script that imports a fixture library and for the same script with the code pasted in.
"""
from __future__ import annotations

import io
import json
import math
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret as ai

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ast" / "library_link_parity.json"


def _doc():
    return json.load(io.open(FIXTURE, encoding="utf-8"))


def _same(got, want):
    assert len(got) == len(want)
    for i, (g, w) in enumerate(zip(got, want)):
        if w is None:
            assert g is None or (isinstance(g, float) and math.isnan(g)), (i, g)
        else:
            assert g is not None and abs(g - w) <= 1e-9 * max(1.0, abs(w)), (i, g, w)


@pytest.mark.parametrize("name", ["imported", "pasted"])
def test_the_server_lane_draws_what_the_chart_draws(name):
    doc = _doc()
    case = next(c for c in doc["cases"] if c["name"] == name)
    inputs = aus._inputs_for({"inputs": case["inputs"]}, None)
    for plot in case["plots"]:
        got = ai.interpret(plot["tree"], doc["bars"], inputs=inputs)
        _same(list(got), plot["expected"])


def test_the_imported_document_is_the_pasted_one_on_the_server_lane():
    doc = _doc()
    by = {c["name"]: c for c in doc["cases"]}
    assert by["imported"]["meta"]["libraries"][0]["path"] == "tester/linkparity/1"
    assert len(by["imported"]["meta"]["libraries"][0]["sha256"]) == 64
    for a, b in zip(by["imported"]["plots"], by["pasted"]["plots"]):
        ga = list(ai.interpret(a["tree"], doc["bars"], inputs={}))
        gb = list(ai.interpret(b["tree"], doc["bars"], inputs={}))
        _same(ga, [None if (isinstance(v, float) and math.isnan(v)) else v for v in gb])
        assert sum(1 for v in ga if v is not None and not (isinstance(v, float) and math.isnan(v))) > 100
