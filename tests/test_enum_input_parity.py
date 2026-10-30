"""ONE enum rule, client and server.

The tree lanes read a text enum as its option's index (the client's
`nativeRegistry.treeScalars`); the alert evaluator does the same here
(`alert_user_series._inputs_for`). Both suites read ONE fixture,
`tests/fixtures/enum_input_parity.json` -- the vitest twin is
`app/src/components/chart/engine/__tests__/enumInputParity.test.js` -- so the
two implementations cannot drift apart again.
"""
import json
import pathlib

import pytest

from api.services.alert_user_series import _inputs_for

FIXTURE = json.loads((pathlib.Path(__file__).parent / "fixtures" / "enum_input_parity.json").read_text(encoding="utf-8"))


def test_fixture_covers_every_disputed_case():
    assert len(FIXTURE["cases"]) >= 12


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=[c["name"] for c in FIXTURE["cases"]])
def test_enum_reaches_the_tree_as_one_index(case):
    definition = {"inputs": [case["input"]]}
    stored = {} if case.get("absent") else {case["input"]["key"]: case["value"]}
    assert _inputs_for(definition, stored)[case["input"]["key"]] == float(case["index"])
