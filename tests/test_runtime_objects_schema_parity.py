"""ENGINE 53 -- ONE rule set for a host document's run half (``compute.runtimeObjects``).

The browser's ``defSchema.runtimeObjectsErrors`` and the server's
``presentation_schema._check_runtime_objects`` agree by ONE fixture both suites read:
``tests/fixtures/runtime_objects_schema.json`` (the vitest twin is
``app/src/components/chart/engine/__tests__/runtimeObjectsSchemaParity.test.js``). Each case names
the error PATHS both sides must report; a rule on one side only is red here by name.
"""
import json
import pathlib

import pytest

from api.services import presentation_schema as ps

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "runtime_objects_schema.json").read_text(encoding="utf-8"))


def doc(case):
    return {
        "compute": {"kind": case["kind"], "runtimeObjects": case["runtimeObjects"]},
        "plots": [{"key": k, "style": "line", "color": "#2962FF"} for k in case["plots"]],
    }


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_the_rule_set(case):
    errs = [e for e in ps.presentation_errors(doc(case)) if e["code"] == "runtime-objects"]
    assert sorted({e["path"] for e in errs}) == sorted(case["paths"]), errs


def test_absent_is_silent():
    d = {"compute": {"kind": "ast"}, "plots": [{"key": "value", "style": "line", "color": "#2962FF"}]}
    assert [e for e in ps.presentation_errors(d) if e["code"] == "runtime-objects"] == []


def test_a_save_that_introduces_a_bad_run_half_is_refused_and_a_stored_one_grandfathered():
    bad = doc({"kind": "ast", "plots": ["value"], "runtimeObjects": {"source": "x", "outputs": {"zz": 0}}})
    refused, kept = ps.new_presentation_errors(bad)
    assert [e["code"] for e in refused] == ["runtime-objects"] and kept == []
    refused, kept = ps.new_presentation_errors(bad, stored=json.loads(json.dumps(bad)))
    assert refused == [] and [e["code"] for e in kept] == ["runtime-objects"]
