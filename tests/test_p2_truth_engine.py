"""P2 truth, slice "engine" — the Python lane of the conversational patch contract.

The engine itself is browser JS (``app/src/components/chart/builder/authoring``);
the CONTRACT is one JSON Schema file both lanes read
(``builder/authoring/patchSchema.json``). The server slice validates the model's
tool output with ``jsonschema`` after substituting the concierge's ADVERTISED
``emit_formula`` node ``$defs`` for the placeholder ``$defs.node``. These cases
pin that composition and its agreement with the JS walker
(``patchValidate.validatePatchShape``) over one shared fixture
(``tests/fixtures/ast/p2_patches.json``).

Each case states ASKED / CLAIMED / DID.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from api.services import definition_concierge as dc

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json"
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "ast" / "p2_patches.json").read_text(encoding="utf-8"))


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def composed_schema() -> dict:
    """The schema the server hands the model: the placeholder node replaced by the
    concierge's advertised node union (num, series, op, call, offset)."""
    schema = _schema()
    advertised = copy.deepcopy(dc.tool_schema()["input_schema"]["$defs"])
    for key in advertised:
        assert key not in schema["$defs"] or key == "node", f"$defs collision on {key}"
    schema["$defs"].update(advertised)
    return schema


def test_schema_is_valid_draft_2020_12():
    """ASKED: is the contract a real JSON Schema? CLAIMED: yes. DID: check_schema passes, raw and composed (EXACT)."""
    Draft202012Validator.check_schema(_schema())
    Draft202012Validator.check_schema(composed_schema())


def test_placeholder_node_union_equals_the_concierge_advertised_union():
    """ASKED: does the patch carry the SAME tree language the model already emits?
    CLAIMED: the placeholder names exactly the advertised node types. DID: equal (EXACT)."""
    placeholder = _schema()["$defs"]["node"]
    assert placeholder["x-uct-node-schema"] == "concierge.advertised"
    advertised = set(dc.tool_schema()["input_schema"]["$defs"]) - {"node"}
    assert set(placeholder["properties"]["type"]["enum"]) == advertised == {"num", "series", "op", "call", "offset"}


@pytest.mark.parametrize("case", FIXTURE["valid"], ids=lambda c: c["name"])
def test_valid_patches_pass_the_composed_schema(case):
    """ASKED: a well-formed patch (every op). CLAIMED: structurally valid with real
    concierge node schemas. DID: no errors (EXACT)."""
    errors = list(Draft202012Validator(composed_schema()).iter_errors(case["patch"]))
    assert errors == [], [e.message for e in errors]


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda c: c["name"])
def test_invalid_patches_are_refused_by_the_schema(case):
    """ASKED: a malformed / forged patch. CLAIMED: refused before the engine. DID:
    refused — except rules the ENGINE adds beyond the schema (lane 'engine'), which
    the schema accepts and the JS engine refuses (REFUSAL)."""
    errors = list(Draft202012Validator(composed_schema()).iter_errors(case["patch"]))
    if case.get("lane") == "engine":
        assert errors == []
    else:
        assert errors, f"{case['name']} should be refused by the schema"


def test_no_op_can_name_a_server_owned_or_derived_field():
    """ASKED: can a patch set semantics, description, repaint, ids, versions or a type?
    CLAIMED: no op carries such a field. DID: none of those names appears as an op
    property anywhere in the schema (REFUSAL by construction)."""
    schema = _schema()
    forbidden = {"semantics", "description", "repaint", "freshness", "id", "version", "rev", "type",
                 "outputType", "meta", "compute", "definition"}
    for name, d in schema["$defs"].items():
        if not name.startswith("op_"):
            continue
        assert not (set(d["properties"]) & forbidden), name
        assert d["additionalProperties"] is False, name
