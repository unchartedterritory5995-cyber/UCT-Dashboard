"""P3 truth corpus -- slice "vocab": conversation can author LEVELS, a LINE STYLE
and a FILL, which the engine and the manual Builder already draw.

  * the contract is still ``uct.authoring.patch/1`` -- the ops are additive, and
    the server's composed tool schema picks them up FROM THE FILE (no second list)
  * the shared structural fixture (``tests/fixtures/ast/p2_patches.json``) holds
    the new ops to the same answer in both lanes
  * the documents conversation saves for them
    (``tests/fixtures/ast/p3_vocab_docs.json``, built by
    ``p3.vocab.truth.test.js``) pass the server's presentation validation and the
    REAL save door, unchanged

Every case states ASKED / CLAIMED / DID and its outcome class. No model calls.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from api.services import alert_user_series as aus
from api.services import definition_conversation as conv
from api.services import presentation_schema as ps
from api.services import user_definitions as ud

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "ast"
PATCHES = json.loads((FIX / "p2_patches.json").read_text("utf-8"))
DOCS = json.loads((FIX / "p3_vocab_docs.json").read_text("utf-8"))["docs"]
SCHEMA_PATH = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json"
NEW_OPS = ("set_levels", "set_fill", "remove_fill")
USER = "p3-vocab-user"


def _p3(cases):
    return [c for c in cases if c["name"].startswith("P3 ")]


def test_the_contract_is_unchanged_and_the_new_ops_are_additive():
    """ASKED: did the patch contract move? CLAIMED: no -- still uct.authoring.patch/1,
    three new optional ops and one optional set_style field. DID: read off the file (EXACT)."""
    raw = json.loads(SCHEMA_PATH.read_text("utf-8"))
    assert raw["properties"]["contract"]["const"] == "uct.authoring.patch/1"
    names = [raw["$defs"][b["$ref"].split("/")[-1]]["properties"]["op"]["const"]
             for b in raw["$defs"]["patchOp"]["oneOf"]]
    assert len(names) == 22 and all(op in names for op in NEW_OPS)
    style = raw["$defs"]["op_set_style"]
    assert style["properties"]["lineStyle"]["enum"] == ["solid", "dashed", "dotted", "largeDashed"]
    assert "lineStyle" not in style["required"]
    assert raw["x-uct-limits"]["maxLevels"] == raw["$defs"]["op_set_levels"]["properties"]["values"]["maxItems"] == 8


def test_the_server_composes_the_new_ops_into_the_model_tool_from_the_file():
    """ASKED: does the model's tool offer the new ops without a hand-kept list?
    CLAIMED: composed_schema() reads patchSchema.json. DID: the ops and the field are
    in the composed schema and in the tool the model is handed (EXACT)."""
    schema = conv.composed_schema()
    Draft202012Validator.check_schema(schema)
    for op in NEW_OPS:
        assert f"op_{op}" in schema["$defs"]
    tool = conv.anthropic_tool()["input_schema"]
    for op in NEW_OPS:
        assert f"op_{op}" in tool["$defs"]
    assert "lineStyle" in tool["$defs"]["op_set_style"]["properties"]


@pytest.mark.parametrize("case", _p3(PATCHES["valid"]), ids=lambda c: c["name"])
def test_P3_valid_patches_pass_the_servers_own_validator(case):
    """ASKED: the new ops, well formed. CLAIMED: the model's answer passes the
    server's structural check (the JS walker agrees: p2.engine.truth SHARED FIXTURE). DID (EXACT)."""
    errors = list(conv._validator().iter_errors(case["patch"]))
    assert errors == [], [e.message for e in errors]


@pytest.mark.parametrize("case", _p3(PATCHES["invalid"]), ids=lambda c: c["name"])
def test_P3_invalid_patches_are_refused_by_the_server(case):
    """ASKED: a malformed new op. CLAIMED: refused before it reaches the client
    engine. DID (REFUSAL)."""
    assert case.get("lane") != "engine"
    assert list(conv._validator().iter_errors(case["patch"])), case["name"]


@pytest.mark.parametrize("name", sorted(DOCS))
def test_P3_saved_documents_pass_server_presentation_validation(name):
    """ASKED: is what conversation saves for levels / dashed / fill accepted by the
    server's presentation check? CLAIMED: exactly what is authored, no refusal. DID (EXACT)."""
    assert ps.presentation_errors(DOCS[name]) == []


def test_P3_the_golden_documents_carry_exactly_the_authored_presentation():
    """ASKED: what did each turn author? CLAIMED: the guide, the line style, the
    band -- nothing else. DID: read off the shared documents (EXACT)."""
    lv = [p for p in DOCS["levels"]["plots"] if p.get("style") == "hlines"]
    assert lv and lv[0]["key"] == "levels" and lv[0]["levels"] == [70, 30]
    slow = next(p for p in DOCS["dashed"]["plots"] if p["key"] == "slow")
    assert slow["lineStyle"] == "dashed"
    fast = next(p for p in DOCS["filled"]["plots"] if p["key"] == "fast")
    assert fast["fill"] == {"with": "slow"} and fast["fillColor"] == "#26a69a" and fast["fillOpacity"] == 0.2


@pytest.fixture
def defs_db(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    aus.forget()
    try:
        yield path
    finally:
        aus.forget()


@pytest.mark.parametrize("i,name", list(enumerate(sorted(DOCS))))
def test_P3_the_real_save_door_stores_each_document_unchanged(defs_db, i, name):
    """ASKED: save the conversational levels / dashed / fill definition. CLAIMED:
    the store accepts it and keeps the presentation verbatim. DID: ud.save then
    ud.get (EXACT)."""
    def_id = f"u_0000000003a{i}"
    doc = copy.deepcopy(DOCS[name])
    doc["id"] = def_id
    doc["version"] = 1
    out = ud.save(USER, def_id, doc)
    assert out["version"] == 1
    got = ud.get(USER, def_id)
    stored = got["definition"] if "definition" in got else got
    assert json.dumps(stored["plots"], sort_keys=True) == json.dumps(doc["plots"], sort_keys=True)
